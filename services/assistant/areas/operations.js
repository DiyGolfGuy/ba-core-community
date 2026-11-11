// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/operations.js - the assistant's operations actions (Oct 20 2026).
// Built with the helpers services/assistant/actions.js hands every area (HELPERS); same rules as the actions there.
//
// THREE AREAS IN ONE FILE (maintainer, Oct 20 2026: "the end user facility owner should be able to do everything from the AI ...
// make schedules"):
//   bookings  look at a day, price a slot, book a customer in, move a booking, cancel one (the owner says the refund),
//             clear an unfinished checkout, block off a bay or the whole facility, the check-in mode
//   setup     the Hours & Booking Rules card (session lengths, how far ahead, the buffer, the booking flow, open 24 hours,
//             members only, one booking per bay or the whole facility), Contact Information, the legal name, the time
//             zone, early bay access
//   staff     change a shift, the seasons (which one decides staffed hours, their weekly hours, a day put back), the
//             staffed-hours switch, shift patterns, the time clock, who may sign in
// Every write is the request the owner's own screen makes, to the same route; every read goes through the owner's own
// route. What the model sees of a customer is a first name and a last initial - never a phone, an email or a door code
// (the loaders keep only what the actions need, and that stays on the box); what it sees of the staff is a name - never
// a sign-in code (a code travels only inside a request the owner's own page sends). Hours are hours and the schedule is
// the schedule - no payroll words (rule 12). A refund is never chosen here: the owner says full, half or none.
'use strict';

module.exports = (H) => {
  const { ActionError, DATE, TIME, dayWords, timeWords, addDays, staffCode, rosterName, bayIndex } = H;

  // ── small words and sums ─────────────────────────────────────────────────────────────────────────────────────────
  const money = (c) => '$' + ((Number(c) || 0) / 100).toFixed(2);
  const toMins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  const hhmm = (m) => String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const dayNo = (iso) => { const s = String(iso || ''); return Math.round(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86400000); };
  const absAt = (date, time) => dayNo(date) * 1440 + toMins(time);
  const nowAbs = (ctx) => absAt(ctx.today, ctx.time || '00:00');
  // a window's absolute minutes; an end at or before its start on the same day is the next day's
  const spanOf = (w) => { const s = absAt(w.date, w.start_time); let e = absAt(w.end_date || w.date, w.end_time); if (e <= s) e += 1440; return [s, e]; };
  // the end of a session that starts at `time` and lasts `minutes`
  const endOf = (date, time, minutes) => { const m = toMins(time) + minutes; return { end_date: addDays(date, Math.floor(m / 1440)), end_time: hhmm(m) }; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const people = (n) => n === 1 ? '1 person' : `${n} people`;
  const lenWords = (n) => { n = Number(n) || 0; const h = Math.floor(n / 60), m = n % 60; return h && m ? `${h} h ${m} min` : h ? plural(h, 'hour') : `${m} min`; };
  const clock = (t) => (t === '23:59' || t === '24:00') ? 'midnight' : timeWords(t);
  const mondayOf = (iso) => addDays(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const dowMon0 = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
  // a UTC stamp from the database ("2026-10-20 23:41:07") on the facility's own clock (the unit runs in the facility's zone)
  const localHM = (utc) => { const s = String(utc || ''); const d = new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')); return isNaN(d) ? '' : hhmm(d.getHours() * 60 + d.getMinutes()); };
  const minutesAgo = (utc) => { const t = Date.parse(String(utc || '').replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 60000) : null; };
  const onGrid = (t) => toMins(t) % 30 === 0;
  const nextGrid = (t) => hhmm(Math.ceil(toMins(t) / 30) * 30);
  const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  // what the engine gives the model is cut at 3000 characters: a list is shortened to fit, and says how many it left out
  const fit = (obj, key, more) => { const list = obj[key]; let n = list.length; while (n > 1 && JSON.stringify(obj).length > 2700) { n--; obj[key] = list.slice(0, n); } if (n < list.length) obj.left_out = `${list.length - n} more - ${more}`; return obj; };
  // a loader that could not read its route says why (the route's own words: "Employee scheduling is turned off ...")
  const offIf = (x) => { if (x && x.off) throw new ActionError(x.off); return x || {}; };
  const read = async (ctx, path) => {
    const r = await ctx.call('GET', path);
    if (!r || r.status >= 400) throw new Error((r && r.json && r.json.error) || `it answered ${r ? r.status : 'nothing'}`);
    return r.json || {};
  };
  // a read whose route refused: the facility's answer, not the model's mistake (engine.js: routeSaid); a wrong argument stays
  // the model's to fix
  const routeRead = (fn) => async (a, ctx) => {
    try { return await fn(a, ctx); }
    catch (e) { if (e instanceof ActionError) throw e; return { error: String((e && e.message) || e).slice(0, 300), routeSaid: true }; }
  };

  // ── people: a customer as the model may see them, and a name as the owner says it ───────────────────────────────
  // On the box's own AI the whole name (and the phone and email - lineOf); with the owner's own AI service, the first name and
  // last initial, a word holding an @ or a run of digits (an email or a phone typed into the name box) left out
  // (services/assistant/privacy.js - maintainer, Oct 21 2026, latest: "the admin should be able to ask the chat anything and everything")
  function shortName(full) { return require('../privacy').name(full); }
  // "Brian", "johnson", "Brian J." all find "Brian Johnson": every word said starts a word of the name
  function nameMatches(full, said) {
    const toks = String(full || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const want = String(said || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
    return want.length > 0 && want.every(w => toks.some(t => t.startsWith(w)));
  }

  // ── bays: one bay by its name, or the whole facility ─────────────────────────────────────────────────────────────
  const WHOLE = /\b(whole|entire|all bays|every bay|all the bays|building|facility|everything)\b/i;
  function bayPick(ctx, said) {
    if (WHOLE.test(String(said || ''))) return { whole: true, name: 'the whole facility' };
    const b = (ctx.bays || [])[bayIndex(ctx, said)];
    return { id: b.id, name: b.name, active: b.active !== false, maintenance: !!b.maintenance };
  }
  const activeBays = (ctx) => (ctx.bays || []).filter(b => b && b.active !== false);
  const firstBayId = (ctx) => ((ctx.bays || [])[0] || {}).id;

  // ── a booking: what the loader keeps of a row (never its phone, email, door code or payment ids) ────────────────
  const real = (v) => !!v && v !== 'null' && v !== 'purged';
  function slimBooking(b) {
    return { id: String(b.id), bay_id: b.bay_id, bay_name: b.bay_name || '', name: String(b.name || ''), date: b.date, start_time: b.start_time,
      end_time: b.end_time, end_date: b.end_date || b.date, minutes: Number(b.duration_minutes) || 0, price_cents: Number(b.price_cents) || 0,
      tax_cents: Number(b.tax_cents) || 0, status: b.status, deposit: !!b.is_deposit, member: !!b.member_id,
      member_due_cents: b.member_due_cents == null ? null : (Number(b.member_due_cents) || 0),
      paid_online: real(b.stripe_charge_id) || real(b.stripe_payment_intent), refunded: !!b.refunded_at,
      texts_ok: b.sms_consent !== 0 && b.sms_consent !== '0', has_email: !!String(b.email || '').trim(), door_code_live: !!b.remotelock_person_id,
      whole_facility: !!b.whole_facility, discounted: (Number(b.discount_cents) || 0) > 0, created_at: b.created_at || '', arrived_at: b.door_used_at || '',
      // the phone and email, only on the box's own AI (services/assistant/privacy.js)
      ...require('../privacy').contact(b) };
  }
  const whereWords = (b) => b.whole_facility ? 'whole facility' : (b.bay_name || 'a bay');
  // WHAT IS DUE AT THE DOOR (rule 4), in the words the customer's own pages use (my-booking.html's booking card, the
  // confirmation email services/email.js:206, the staff pad's chips - staff.html chipLabel): paid online, a deposit with the rest at the
  // door, a member settling at the door, or paid at the counter
  function payWords(b) {
    const total = b.price_cents + b.tax_cents;
    if (b.status === 'pending_payment') return 'checkout not finished - nothing paid yet';
    if (b.status === 'expired') return 'checkout given up - nothing paid';
    if (b.status === 'cancelled') return 'cancelled' + (b.paid_online ? (b.refunded ? ' - refund given' : ' - no refund') : '');
    if (b.deposit) return `deposit ${money(total)} paid online - the rest is settled at the door` + (b.member_due_cents > b.price_cents ? ` (about ${money(b.member_due_cents - b.price_cents)} more for the member)` : '');
    if (b.member && b.member_due_cents != null && !b.paid_online && !(b.price_cents > 0)) return `member - nothing paid online, about ${money(b.member_due_cents)} settles at the door`;
    if (b.paid_online) return `paid online ${money(total)}` + (b.refunded ? ' (some refunded since)' : '');
    if (b.price_cents > 0) return `nothing paid online - ${money(b.price_cents)} due at the door`;
    return 'nothing to pay';
  }
  // the facility's own message switches (Settings > Connections: sms.* and resend.*); a sender also needs its provider set up
  // the settings as read this turn; a read that failed is said, never answered from empty settings ("already off")
  const cfgOf = (ctx) => { const c = ctx.opsConfig || {}; if (c.error) throw new ActionError(`the settings could not be read just now (${c.error}) - try again in a moment`); return c; };
  const switchOn = (ctx, group, key, byDefault) => { const v = ((ctx.opsConfig || {})[group] || {})[key]; return v === undefined ? byDefault : v !== false; };
  const brief = (b) => `${shortName(b.name)}, ${whereWords(b)}, ${dayWords(b.date)} ${timeWords(b.start_time)}-${timeWords(b.end_time)}`;
  const lineOf = (b, withDay, extra) => [`${withDay ? dayWords(b.date) + ' ' : ''}${timeWords(b.start_time)}-${timeWords(b.end_time)}${b.end_date > b.date ? ' (next day)' : ''}`,
    whereWords(b), lenWords(b.minutes), shortName(b.name) + (b.member ? ' (member)' : ''), payWords(b)].concat(b.phone || b.email ? [[b.phone, b.email].filter(Boolean).join(', ')] : []).concat(extra ? [extra] : []).join(' | ');

  // THE BOOKING THE OWNER MEANS: by its day and its time, bay or the customer's name - or, with no day, the customer's
  // upcoming ones. One match is used; more than one, or none, goes back to the model with what there is, to ask which.
  function findBooking(ctx, a, statuses, verb) {
    const L = ctx.opsBookings || {};
    if (L.error) throw new ActionError(`the bookings could not be read just now (${L.error}) - try again in a moment`);
    if (!a.date && !a.name) throw new ActionError('say the day of the booking, or the customer\'s name');
    const pool = (L.list || []).filter(b => a.date ? b.date === a.date : b.date >= ctx.today);
    const narrow = (list) => {
      if (a.bay) { const p = bayPick(ctx, a.bay); list = list.filter(b => p.whole ? b.whole_facility : (b.bay_id === p.id || b.whole_facility)); }
      if (a.name) list = list.filter(b => nameMatches(b.name, a.name));
      if (a.time) {
        const exact = list.filter(b => b.start_time === a.time);
        list = exact.length ? exact : list.filter(b => { const [s, e] = spanOf(b); const t = absAt(b.date, a.time); return t >= s && t < e; });
      }
      return list;
    };
    const hits = narrow(pool.filter(b => statuses.includes(b.status)));
    if (hits.length === 1) return hits[0];
    const said = [a.date && dayWords(a.date), a.time && timeWords(a.time), a.bay, a.name].filter(Boolean).join(', ');
    if (hits.length > 1) throw new ActionError(`${hits.length} bookings match (${said}) - ask the owner which one: ${hits.slice(0, 8).map(brief).join('; ')}${hits.length > 8 ? '; ...' : ''}`);
    const other = narrow(pool.filter(b => !statuses.includes(b.status)));
    if (other.length === 1) {
      const o = other[0];
      if (o.status === 'pending_payment') throw new ActionError(`${brief(o)} is a checkout the customer never finished (nothing was paid) - that is cleared with booking_clear_pending, not ${verb === 'move' ? 'moved' : 'cancelled'}`);
      if (o.status === 'active') throw new ActionError(`${brief(o)} is paid and confirmed, not an unfinished checkout - to call it off, cancel it (the owner says the refund)`);
      if (o.status === 'completed') throw new ActionError(`${brief(o)} is over already - a past session cannot be ${verb === 'move' ? 'moved' : 'changed'}`);
    }
    const there = pool.filter(b => statuses.includes(b.status));
    throw new ActionError(`no booking to ${verb} matches (${said})` + (there.length
      ? ` - ${a.date ? 'that day' : 'coming up'}: ${there.slice(0, 8).map(brief).join('; ')}${there.length > 8 ? '; ...' : ''}`
      : a.date ? ` - there is none to ${verb} on ${dayWords(a.date)}` : ''));
  }

  // ── blocks: a window taken out of booking (routes/admin.js:269) ──────────────────────────────────────────────────
  // A block closing the whole facility is stored on the first bay's row under the business name (routes/admin.js:359) and
  // GET /blocks does not say whole_facility, so it is told by its name.
  const blockIsFacility = (ctx, k) => { const biz = ((ctx.opsConfig || {}).server || {}).businessName || ''; return !(ctx.bays || []).some(b => b.name === k.bay_name) && (k.bay_name === biz || k.bay_name === 'The whole facility' || k.bay_id === firstBayId(ctx)); };
  const blockWhen = (k) => (k.end_date && k.end_date !== k.date)
    ? `${dayWords(k.date)} ${clock(k.start_time)} to ${dayWords(k.end_date)} ${clock(k.end_time)}`
    : `${dayWords(k.date)}, ${clock(k.start_time)} - ${clock(k.end_time)}`;

  // WHAT ALREADY HOLDS A WINDOW on a bay (or anywhere, for the whole facility) - the picture findConflict draws
  // (services/bookingcore.js:175): confirmed bookings, checkouts still inside the hold, and blocks, each widened by the
  // buffer. The route decides in the end; this is so the model can say who is in the way before the owner is asked.
  function clashes(ctx, cand, { bayId, whole, skipId }) {
    const bk = (ctx.opsConfig || {}).booking || {};
    const buffer = Number(bk.bufferMins) || 0, hold = Number(bk.bookingHoldMins) || 10;   // bookingcore.js:91 holdMins
    const [cs, ce] = spanOf(cand);
    const hit = (w) => { const [s, e] = spanOf(w); return cs < e + buffer && s - buffer < ce; };
    const out = [];
    for (const b of ((ctx.opsBookings || {}).list || [])) {
      if (b.id === skipId) continue;
      const ago = minutesAgo(b.created_at);
      const live = b.status === 'active' || (b.status === 'pending_payment' && ago != null && ago < hold);
      if (!live || !(whole || b.whole_facility || b.bay_id === bayId)) continue;
      if (hit(b)) out.push(`${b.status === 'pending_payment' ? 'a checkout in progress: ' : ''}${brief(b)}`);
    }
    for (const k of ((ctx.opsBlocks || {}).list || [])) {
      if (!(blockIsFacility(ctx, k) || (!whole && k.bay_id === bayId) || (whole && k.bay_id === firstBayId(ctx)))) continue;
      if (hit(k)) out.push(`a ${k.booking_type} block ${blockWhen(k)}${k.name ? ' ("' + k.name + '")' : ''}`);
    }
    return out;
  }

  // the opening window on a day from the Hours & Booking Rules card - for a plain note, never a refusal here
  function outsideHours(ctx, date, start, minutes) {
    const b = (ctx.opsConfig || {}).booking || {};
    if (b.open24Hours) return '';
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
    if (Array.isArray(b.openDays) && b.openDays.length && !b.openDays.includes(day)) return `the facility is closed on ${day[0].toUpperCase() + day.slice(1)}s`;
    const s = toMins(start), e = s + minutes, open = toMins(b.openTime || '05:00');
    const close = toMins(b.closeTime || '23:30') + (b.closeNextDay || b.closeTime === '00:00' ? 1440 : 0);
    return (s < open || e > close) ? `that is outside your opening hours (${clock(b.openTime || '05:00')} - ${clock(b.closeTime || '23:30')})` : '';
  }

  // ── WHAT THE ACTIONS READ FIRST (once a turn, through the owner's own routes; the model never sees these) ─────────
  const loaders = {
    // every confirmed booking from today on, the unfinished checkouts and the latest finished sessions (routes/admin.js:151).
    // The list comes furthest date first, so the nearest bookings are on its LAST pages: those are read, up to ten pages.
    opsBookings: async (ctx) => {
      const list = [], seen = new Set();
      const take = (j) => { for (const b of (j && j.bookings) || []) if (b && b.id && !seen.has(b.id)) { seen.add(b.id); list.push(slimBooking(b)); } };
      try {
        const first = await read(ctx, '/api/admin/bookings?status=active&per_page=200&page=1');
        const pages = Math.max(1, Number(first.pages) || 1);
        for (let p = pages; p >= Math.max(1, pages - 9); p--) take(p === 1 ? first : await read(ctx, `/api/admin/bookings?status=active&per_page=200&page=${p}`));
        take(await read(ctx, '/api/admin/bookings?status=pending_payment&per_page=200&page=1'));
        take(await read(ctx, '/api/admin/bookings?status=completed&per_page=200&page=1'));
        return { list };
      } catch (e) { return { list, error: String((e && e.message) || e).slice(0, 120) }; }
    },
    // the blocks from today on (routes/admin.js:269)
    opsBlocks: async (ctx) => { try { return { list: (await read(ctx, `/api/admin/blocks?from=${ctx.today}`)).blocks || [] }; } catch (e) { return { list: [], error: String((e && e.message) || e).slice(0, 120) }; } },
    // the settings as the Settings screen reads them, secrets masked (routes/admin.js:98)
    opsConfig: async (ctx) => { try { return await read(ctx, '/api/admin/config'); } catch (e) { return { error: String((e && e.message) || e).slice(0, 120) }; } },
    // the membership tiers (routes/members.js:98)
    opsTiers: async (ctx) => { try { const j = await read(ctx, '/api/members/tiers'); return { list: Array.isArray(j) ? j : (j.tiers || []) }; } catch (e) { return { list: [] }; } },
    // eight weeks of the schedule: shifts, time off, requests, single-day changes, the season (routes/staff.js:837)
    opsShifts: async (ctx) => {
      const from = addDays(ctx.today, -7), to = addDays(ctx.today, 55);
      try { const j = await read(ctx, `/api/staff/schedule?start=${from}&end=${to}`); return { from, to, shifts: j.shifts || [], timeoff: j.timeoff || [], pendingReq: j.pendingReq || [], covExceptions: j.covExceptions || [], season: j.season || null, scheduleOff: !!j.scheduleOff }; }
      catch (e) { return { off: String((e && e.message) || e).slice(0, 200) }; }
    },
    // the seasons, the one in use and the staffed-hours switch (routes/staff.js:981)
    opsCoverage: async (ctx) => { try { const j = await read(ctx, '/api/staff/coverage'); return { templates: j.templates || [], activeId: j.activeId || null, scheduleOff: !!j.scheduleOff }; } catch (e) { return { off: String((e && e.message) || e).slice(0, 200) }; } },
    // the saved shift patterns (routes/staff.js:909)
    opsPatterns: async (ctx) => { try { return { list: (await read(ctx, '/api/staff/schedule/templates')).templates || [] }; } catch (e) { return { off: String((e && e.message) || e).slice(0, 200) }; } },
    // who is on the clock now, and the employees' own clock fixes waiting for review (routes/staff.js:1053)
    opsClock: async (ctx) => { try { const j = await read(ctx, '/api/staff/ops-today'); return { onClock: j.onClock || [], flagged: j.flagged || [] }; } catch (e) { return { off: String((e && e.message) || e).slice(0, 200) }; } },
    // the last five weeks of clock entries (routes/staff.js:728)
    // the hours export's state (routes/staff.js:633)
    opsHoursSend: async (ctx) => { try { return await read(ctx, '/api/staff/hours/send'); } catch (e) { return { error: String((e && e.message) || e).slice(0, 120) }; } },
    opsClockEntries: async (ctx) => { try { return { list: (await read(ctx, `/api/staff/clock/entries?start=${addDays(ctx.today, -35)}&end=${ctx.today}`)).entries || [] }; } catch (e) { return { off: String((e && e.message) || e).slice(0, 200) }; } },
  };

  // ── the counter's view of a day (routes/staff.js:144): came in, checked in, a no-show, a waiver to sign, a tab open ──
  function counterWords(s, mode, isToday) {
    if (!s) return '';
    const bits = [];
    if (s.arrived_at) { const t = localHM(s.arrived_at); if (t) bits.push('came in by the door at ' + timeWords(t)); }
    if (mode !== 'off') {
      if (s.checked_in) bits.push('checked in' + (s.checked_in_by ? ' by ' + s.checked_in_by : '') + (s.heads ? `, ${people(s.heads)}` : ''));
      else if (isToday && s.state === 'no_show') bits.push('not checked in - a no-show so far');
      else if (isToday && s.state === 'due') bits.push('due now, not checked in yet');
    }
    if (s.state === 'ended_open_tab') bits.push(`session over, tab still open (${money(s.open_due_cents)} due)`);
    else if (s.open_tabs) bits.push(`tab open (${money(s.open_due_cents)} so far)`);
    if (s.waiver_signed === false) bits.push('waiver not signed yet');
    return bits.join(', ');
  }

  // ── a season's week in plain words (days are Monday first, routes/staff.js:989; a blank start and end = all day) ──
  const DAYN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayHours = (d) => !d || !(d.staffed === 1 || d.staffed === true) ? 'not staffed' : (d.start && d.end) ? `staffed ${clock(d.start)} - ${clock(d.end)}` : 'staffed all day';
  function weekWords(days) {
    const out = [];
    for (let i = 0; i < 7;) { let j = i; const w = dayHours(days[i]); while (j + 1 < 7 && dayHours(days[j + 1]) === w) j++; out.push(`${i === j ? DAYN[i] : DAYN[i] + '-' + DAYN[j]} ${w}`); i = j + 1; }
    return out.join('; ');
  }
  const blockDays = (b) => Array.isArray(b.days) && b.days.length && b.days.length < 7 ? b.days.map(n => DAYN[n]).join(', ') : 'every day';
  function findSeason(cov, said) {
    const n = String(said || '').trim().toLowerCase();
    const list = cov.templates || [];
    const exact = list.filter(t => String(t.name).toLowerCase() === n);
    if (exact.length === 1) return exact[0];
    const some = list.filter(t => String(t.name).toLowerCase().includes(n) || n.includes(String(t.name).toLowerCase()));
    if (some.length === 1) return some[0];
    throw new ActionError(`${some.length > 1 ? 'more than one season matches' : 'there is no season called'} "${said}" (the seasons: ${list.map(t => t.name).join(', ') || 'none saved yet - they are made in Settings > Schedule'})`);
  }
  const NONE = /^(none|no season|no|off|calendar|the calendar|the website calendar)$/i;

  // ── a staff member by name - including someone who may no longer sign in (staffCode finds only those who can) ─────
  function rosterPerson(ctx, said) {
    const roster = ctx.roster || [];
    const n = String(said || '').trim().toLowerCase();
    const exact = roster.filter(s => String(s.name).toLowerCase() === n);
    if (exact.length === 1) return exact[0];
    const first = roster.filter(s => String(s.name).toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
    if (first.length === 1) return first[0];
    if (first.length > 1) throw new ActionError(`more than one person on the staff list is called "${said}" (${first.map(s => s.name).join(', ')}) - say which`);
    throw new ActionError(`no one called "${said}" is on the staff list (on it: ${roster.map(s => s.name).join(', ') || 'no one yet'})`);
  }
  const whoOf = (ctx, code) => code ? (rosterName(ctx, code) || 'someone no longer on the staff list') : 'open (nobody yet)';
  // a clock entry's local stamp ("2026-10-20 16:02:11", services/timeclock.js localStamp) in words
  const stampWords = (s) => s ? `${dayWords(String(s).slice(0, 10))} ${timeWords(String(s).slice(11, 16))}` : '';
  const hoursOf = (m) => Math.round(((Number(m) || 0) / 60) * 100) / 100;
  const entryName = (e) => e.display_name || e.name || e.staff_name || 'someone';

  const ZONES = { eastern: 'America/New_York', et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York',
    central: 'America/Chicago', ct: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago',
    mountain: 'America/Denver', mt: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver', arizona: 'America/Phoenix',
    pacific: 'America/Los_Angeles', pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles',
    alaska: 'America/Anchorage', hawaii: 'Pacific/Honolulu', utc: 'UTC' };
  const ZONE_SAY = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona',
    'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' };
  // the same allowlist the route checks (services/timezone.js isValidZone: the runtime's own IANA zones, and UTC)
  function zoneOf(said) {
    const s = String(said || '').trim();
    const k = s.toLowerCase().replace(/\s+(standard|daylight)?\s*time$/, '').replace(/\s+time$/, '').trim();
    if (ZONES[k]) return ZONES[k];
    let all = []; try { all = Intl.supportedValuesOf('timeZone'); } catch {}
    if (!all.includes('UTC')) all = ['UTC'].concat(all);
    return all.find(z => z.toLowerCase() === s.toLowerCase().replace(/\s+/g, '_')) || null;
  }
  const OWNER = 'Owner (assistant)';   // what the staff routes stamp as the actor for the owner's own session (services/staff.js:133)

  const actions = [
    // ════════════════════════════ BOOKINGS ════════════════════════════
    // GET /api/admin/bookings?date= (routes/admin.js:151) for each day, with the counter's view of it - GET /api/staff/today
    // (routes/staff.js:144). A customer as a first name and last initial; never a phone, an email or a door code.
    { name: 'bookings_read', area: 'bookings', kind: 'read',
      say: 'Look at the bookings for a day or a few days, or a customer\'s upcoming bookings by name: the time, bay, length, the customer, how it was paid and what is due at the door, and today who has come in, checked in or not shown up. Use it before cancelling, moving or clearing one',
      params: { type: 'object', properties: {
        date: { ...DATE, description: 'the day (YYYY-MM-DD; today, tomorrow and a weekday name work too); today when left out' },
        days: { type: 'integer', minimum: 1, maximum: 7, description: 'how many days from that day (1 when left out)' },
        name: { type: 'string', minLength: 2, maxLength: 60, description: 'only this customer (their first name, last name or both); with no date, their upcoming bookings' },
        bay: { type: 'string', maxLength: 60, description: 'only this bay' } } },
      needs: ['bays'],
      local: routeRead(async (a, ctx) => {
        const byBay = a.bay ? (() => { const p = bayPick(ctx, a.bay); return (b) => p.whole ? b.whole_facility : (b.bay_id === p.id || b.whole_facility); })() : () => true;
        if (a.name && !a.date) {
          const j = await read(ctx, `/api/admin/bookings?status=active&per_page=100&search=${encodeURIComponent(a.name)}`);
          const rows = (j.bookings || []).map(slimBooking).filter(b => nameMatches(b.name, a.name) && byBay(b)).sort((x, y) => (x.date + x.start_time).localeCompare(y.date + y.start_time));
          return fit({ upcoming_for: a.name, bookings: rows.length ? rows.map(b => lineOf(b, true)) : ['none coming up'] }, 'bookings', 'ask for one day');
        }
        const from = a.date || ctx.today, n = a.days || 1;
        const lines = []; let count = 0, cancelled = 0, unfinished = 0;
        for (let i = 0; i < n; i++) {
          const d = addDays(from, i);
          const j = await read(ctx, `/api/admin/bookings?date=${d}&per_page=200`);
          let counter = {}, mode = 'full';
          try { const t = await read(ctx, `/api/staff/today?date=${d}`); mode = t.checkin_mode || 'full'; for (const s of t.bookings || []) counter[s.id] = s; } catch { counter = {}; }
          const rows = (j.bookings || []).map(slimBooking).filter(b => b.status !== 'expired' && byBay(b) && (!a.name || nameMatches(b.name, a.name)))
            .sort((x, y) => x.start_time.localeCompare(y.start_time));
          for (const b of rows) {
            if (b.status === 'cancelled') cancelled++; else if (b.status === 'pending_payment') unfinished++; else count++;
            lines.push(lineOf(b, n > 1, counterWords(counter[b.id], mode, d === ctx.today)));
          }
        }
        return fit({ from: dayWords(from), to: n > 1 ? dayWords(addDays(from, n - 1)) : undefined, booked: count,
          cancelled: cancelled || undefined, unfinished_checkouts: unfinished || undefined, bookings: lines.length ? lines : ['no bookings'] }, 'bookings', 'ask for one day, one bay or one customer');
      }) },

    // GET /api/staff/quote (routes/staff.js:489) for each bay - the counter's own price peek - with what it cannot see
    // (a bay out of service, a block, the opening hours) added from the settings and the blocks
    { name: 'booking_quote', area: 'bookings', kind: 'read',
      say: 'See what a session would cost and which bays are free at a time - before booking a customer in, or when the owner asks what a time costs',
      params: { type: 'object', properties: { date: DATE, time: { ...TIME, description: 'the start time (HH:MM)' },
        minutes: { type: 'integer', minimum: 30, maximum: 720, description: 'how long, in minutes (60 for an hour)' },
        bay: { type: 'string', maxLength: 60, description: 'one bay; every bay when left out' } }, required: ['date', 'time', 'minutes'] },
      needs: ['bays', 'opsConfig', 'opsBlocks'],
      local: routeRead(async (a, ctx) => {
        const bk = (ctx.opsConfig || {}).booking || {};
        if (!onGrid(a.time)) return { error: `sessions start on the hour or half hour - the next start is ${timeWords(nextGrid(a.time))}` };
        if (a.minutes % 30) return { error: 'a session is a whole number of half hours (30, 60, 90 ...)' };
        const notes = [];
        const lo = Number(bk.minSessionMins) || 30, hi = Number(bk.maxSessionMins) || 240;
        if (a.minutes < lo || a.minutes > hi) notes.push(`sessions here are ${lenWords(lo)} to ${lenWords(hi)} long`);
        const shut = outsideHours(ctx, a.date, a.time, a.minutes); if (shut) notes.push(shut);
        let bays;
        if (bk.wholeFacility) { const f = activeBays(ctx)[0]; bays = f ? [{ id: f.id, name: 'the whole facility' }] : []; }
        else if (a.bay) { const p = bayPick(ctx, a.bay); if (p.whole) return { error: 'one booking takes one bay here - say which bay, or leave it out for every bay' }; bays = [p]; }
        else bays = activeBays(ctx).slice(0, 8).map(b => ({ id: b.id, name: b.name, maintenance: !!b.maintenance }));
        const cand = Object.assign({ date: a.date, start_time: a.time }, endOf(a.date, a.time, a.minutes));
        const [cs, ce] = spanOf(cand);
        const out = [];
        for (const b of bays) {
          if (b.maintenance) { out.push({ bay: b.name, answer: 'out of service' }); continue; }
          const blocked = ((ctx.opsBlocks || {}).list || []).find(k => (blockIsFacility(ctx, k) || k.bay_id === b.id) && (() => { const [s, e] = spanOf(k); return cs < e && s < ce; })());
          if (blocked) { out.push({ bay: b.name, answer: `blocked (${blocked.booking_type}${blocked.name ? ' "' + blocked.name + '"' : ''})` }); continue; }
          const q = await read(ctx, `/api/staff/quote?bay_id=${encodeURIComponent(b.id)}&date=${a.date}&start_time=${a.time}&duration_minutes=${a.minutes}`);
          out.push({ bay: b.name, answer: q.conflict ? `taken (${shortName(q.conflict.name)} ${timeWords(q.conflict.start_time)}-${timeWords(q.conflict.end_time)})` : `free - ${money(q.price_cents)}` });
        }
        return { when: `${dayWords(a.date)}, ${timeWords(a.time)} - ${timeWords(cand.end_time)}${cand.end_date > a.date ? ' (next day)' : ''} (${lenWords(a.minutes)})`, bays: out.length ? out : 'no bays are set up', note: notes.join('; ') || undefined };
      }) },

    // POST /api/staff/bookings (routes/staff.js:507 -> services/checkin.js:644 staffCreateBooking): the staff pad's own New
    // booking - active at once, paid at the counter, the confirmation (and the door code) sent as the customer agreed
    { name: 'booking_make', area: 'bookings', kind: 'write', confirm: true,
      say: 'Book a customer in yourself (someone who called or walked in): their name and phone (the confirmation goes there), the day, time, length and bay. Nothing is charged online - they pay at the counter. Check the price and the free bays with booking_quote first. Ask whether they agree to get texts; never assume it',
      params: { type: 'object', properties: {
        name: { type: 'string', minLength: 2, maxLength: 80, description: 'the customer\'s name' },
        phone: { type: 'string', minLength: 7, maxLength: 30, description: 'the customer\'s phone number' },
        email: { type: 'string', maxLength: 120, description: 'their email, if they gave one' },
        texts_ok: { type: 'boolean', description: 'true only when the customer agreed to get texts' },
        date: DATE, time: { ...TIME, description: 'the start time (HH:MM, on the hour or half hour)' },
        minutes: { type: 'integer', minimum: 30, maximum: 720, description: 'how long, in minutes (60 for an hour)' },
        bay: { type: 'string', maxLength: 60, description: 'the bay\'s name' },
        package: { type: 'string', maxLength: 60, description: 'a package deal they are booking, by its name (its length and price are the package\'s)' },
        players: { type: 'integer', minimum: 1, maximum: 100, description: 'how many players, for a package' } }, required: ['name', 'phone', 'date', 'time', 'minutes'] },
      needs: ['bays', 'opsConfig', 'opsBookings', 'opsBlocks', 'packages'],
      build: (a, ctx) => {
        const bay = makeBay(a, ctx);
        // a package sold at the counter (Oct 22 2026): its length is the session's, its players the price's
        const pk = a.package ? pkgNamed(ctx, a.package) : null;
        return { op: 'http', method: 'POST', path: '/api/staff/bookings', body: Object.assign({ bay_id: bay.id, date: a.date, start_time: a.time, duration_minutes: pk ? pk.minutes : a.minutes,
          name: a.name, phone: a.phone, email: a.email || '', sms_consent: !!a.texts_ok, employee: OWNER }, pk ? { package_id: pk.id, players: a.players || pk.min_players } : {}) };
      },
      describe: (a, ctx) => {
        const bk = (ctx.opsConfig || {}).booking || {};
        const bay = makeBay(a, ctx), end = endOf(a.date, a.time, a.minutes);
        // services/sms.js:267 sendConfirmation (texts only with their yes), services/email.js:170 (email); door codes the same
        // two ways (sms.js:305, email.js:246) - each behind the facility's own switch
        const text = !!a.texts_ok && switchOn(ctx, 'sms', 'sendConfirmation', true), mail = !!a.email && switchOn(ctx, 'resend', 'sendConfirmation', false);
        const by = text && mail ? 'by text and email' : text ? 'by text' : mail ? 'by email' : '';
        const codes = (bk.accessStyle || (bk.staffedAccess ? 'staffed' : 'unmanned')) !== 'staffed';
        const codeWay = (a.texts_ok && switchOn(ctx, 'sms', 'sendDoorCode', true)) || (a.email && switchOn(ctx, 'resend', 'sendDoorCode', false));
        const pk = a.package ? pkgNamed(ctx, a.package) : null;
        if (pk) { const n = Math.max(a.players || pk.min_players || 1, pk.min_players || 1), cents = pk.price_type === 'per_person' ? pk.price_cents * n : pk.price_cents, endP = endOf(a.date, a.time, pk.minutes);
          return `Book ${shortName(a.name)} on the ${pk.name} package (${pk.length}, ${n} player${n === 1 ? '' : 's'}): ${bk.wholeFacility ? 'the whole facility' : bay.name}, ${dayWords(a.date)}, ${timeWords(a.time)} - ${timeWords(endP.end_time)}. $${(cents / 100).toFixed(2)} plus its tax, paid at the counter${pk.includes_words ? '; what it includes (' + pk.includes_words + ') rings up at $0 on this booking' : ''}.`; }
        return `Book ${shortName(a.name)} into ${bk.wholeFacility ? 'the whole facility' : bay.name} on ${dayWords(a.date)}, ${timeWords(a.time)} - ${timeWords(end.end_time)}${end.end_date > a.date ? ' (next day)' : ''} (${lenWords(a.minutes)}). Nothing is charged online: they pay at the counter. `
          + (by ? `Their confirmation goes ${by} (${text && mail ? 'as far as each is set up' : text ? 'if texting is set up' : 'if email is set up'}).` : `No confirmation goes to them (${a.texts_ok || a.email ? 'those messages are switched off in your settings' : 'no email was given and they did not agree to texts'}).`)
          + (codes ? (codeWay ? ' Their door code comes before the session the same way.' : ' They will not get a door code - add an email, or ask whether they agree to texts.') : '');
      } },

    // POST /api/staff/booking/:id/move (routes/staff.js:301 -> services/bookingedit.js:107 moveBooking): another day, time
    // or bay; same length, same price; a door code already made is taken back and a new one comes for the new time; the
    // customer is emailed when the day, time or bay changes (bookingedit.js:195) - a move sends no text
    { name: 'booking_move', area: 'bookings', kind: 'write', confirm: true,
      say: 'Move a confirmed booking to another day, start time or bay (its length and price stay the same). Find it by its day and its time, bay or the customer\'s name; say where it goes with to_date, to_time and/or to_bay',
      params: { type: 'object', properties: {
        date: { ...DATE, description: 'the day the booking is on now' }, time: { ...TIME, description: 'its start time now (HH:MM)' },
        bay: { type: 'string', maxLength: 60, description: 'its bay now' }, name: { type: 'string', minLength: 2, maxLength: 60, description: 'the customer\'s name, or part of it' },
        to_date: { ...DATE, description: 'the new day' }, to_time: { ...TIME, description: 'the new start time (HH:MM, on the hour or half hour)' },
        to_bay: { type: 'string', maxLength: 60, description: 'the new bay' } } },
      needs: ['bays', 'opsConfig', 'opsBookings', 'opsBlocks'],
      build: (a, ctx) => {
        const m = moveOf(a, ctx), b = m.b;
        const body = { reason: 'moved by the owner through the assistant', employee: OWNER };
        if (m.date !== b.date) body.date = m.date;
        if (m.time !== b.start_time) body.start_time = m.time;
        if (m.bayId !== b.bay_id) body.bay_id = m.bayId;
        return { op: 'http', method: 'POST', path: `/api/staff/booking/${encodeURIComponent(b.id)}/move`, body };
      },
      describe: (a, ctx) => {
        const m = moveOf(a, ctx), b = m.b;
        const [s, e] = spanOf(b), now = nowAbs(ctx);
        const shut = outsideHours(ctx, m.date, m.time, b.minutes);
        return `Move ${shortName(b.name)}'s booking (${whereWords(b)}, ${dayWords(b.date)}, ${timeWords(b.start_time)} - ${timeWords(b.end_time)}) to ${b.whole_facility ? 'the whole facility' : m.bayName}, ${dayWords(m.date)}, ${timeWords(m.time)} - ${timeWords(m.end.end_time)}. Same length, same price (${payWords(b)}).`
          + (now >= s && now < e ? ' They are playing right now.' : '')
          + (b.door_code_live ? ' Their door code stops working and a new one comes for the new time.' : '')
          + (!b.has_email ? ' They are not told automatically (no email on the booking) - let them know.'
            : !switchOn(ctx, 'resend', 'sendMoved', true) ? ' They are not told automatically (moved-booking emails are switched off in your settings) - let them know.'
            : ' They are emailed the new time, if email is set up.')
          + (shut ? ` Note: ${shut}.` : '');
      } },

    // POST /api/admin/booking/cancel/:id {refund_type} (routes/admin.js:393, ownerCancelOnce :407) - the Bookings tab's
    // Cancel: refunds through Stripe (full = what was paid with its tax, half = half of what Stripe took), takes back a
    // door code already made, gives back free hours, member credit and gift cards, and texts the customer (only when they
    // agreed to texts; this route sends no email). A missing refund_type means FULL to that route - so it is required here.
    // CHECKING A GROUP IN (Oct 20 2026, late - the gap audit's first: daily, every booking that paid a deposit):
    // the Dashboard's Check In Group - how many golfers came; the unit works out each one's share, what the deposit covers (a
    // member's surplus becomes their credit) and what to collect at the door (routes/admin.js:992 POST /api/admin/checkin -
    // deposit bookings only, once each)
    { name: 'booking_check_in', area: 'bookings', kind: 'write', confirm: true,
      say: 'Check a group in for a booking that paid a deposit online: how many golfers came. The unit works out each one\'s share, what the deposit covers (a member\'s surplus becomes their credit) and what to collect at the door - said back first. Find it by its day and time, bay or the customer\'s name (today unless said)',
      params: { type: 'object', properties: {
        date: { ...DATE, description: 'the day of the booking - today unless the owner says' }, time: { ...TIME, description: 'its start time (HH:MM)' },
        bay: { type: 'string', maxLength: 60, description: 'its bay' }, name: { type: 'string', minLength: 2, maxLength: 60, description: 'the customer\'s name, or part of it' },
        golfers: { type: 'integer', minimum: 1, maximum: 30, description: 'how many golfers came' } }, required: ['golfers'] },
      needs: ['bays', 'opsBookings'],
      build: (a, ctx) => {
        const b = findBooking(ctx, Object.assign({}, a, { date: a.date || (a.name ? undefined : ctx.today) }), ['active'], 'check in');
        if (!b.deposit) throw new ActionError(`${brief(b)} was paid in full online - there is no deposit to settle and nothing to collect at the door; staff check it in on the pad`);
        return { op: 'http', method: 'POST', path: '/api/admin/checkin', body: { booking_id: b.id, actual_golfers: a.golfers, settled_by: 'Owner (the assistant)' } };
      },
      describe: (a, ctx) => {
        const b = findBooking(ctx, Object.assign({}, a, { date: a.date || (a.name ? undefined : ctx.today) }), ['active'], 'check in');
        return `Check in ${brief(b)}: ${a.golfers} golfer${a.golfers === 1 ? '' : 's'} - the unit works out each share and what to collect at the door, the ${money(b.price_cents)} deposit counted`;
      } },
    { name: 'booking_cancel', area: 'bookings', kind: 'write', confirm: true,
      say: 'Cancel a customer\'s booking. Find it by its day and its time, bay or the customer\'s name. Ask the owner which refund before calling - full, half or none - and never choose it yourself; a booking with nothing paid online is none. Afterwards bookings_read shows whether the refund went through',
      params: { type: 'object', properties: {
        date: { ...DATE, description: 'the day of the booking; leave out to look through the customer\'s upcoming bookings by name' },
        time: { ...TIME, description: 'its start time (HH:MM)' }, bay: { type: 'string', maxLength: 60, description: 'its bay' },
        name: { type: 'string', minLength: 2, maxLength: 60, description: 'the customer\'s name, or part of it' },
        refund_type: { type: 'string', enum: ['full', 'half', 'none'], description: 'exactly what the owner said: full, half or none' } }, required: ['refund_type'] },
      needs: ['bays', 'opsBookings', 'opsConfig'],
      build: (a, ctx) => {
        const b = findBooking(ctx, a, ['active', 'completed'], 'cancel');
        if (a.refund_type !== 'none' && !b.paid_online) throw new ActionError(`nothing was paid online for this booking (${payWords(b)}), so no money can go back through the unit - cancel it with refund none${b.price_cents > 0 ? '; money taken at the counter is given back at the counter' : ''}`);
        // with no Stripe keys at all the route cancels, refunds nothing and logs the refund FAILED (routes/admin.js:430, :500) -
        // a refund that cannot happen is said before the owner says yes, never found in the log after
        if (a.refund_type !== 'none' && (((ctx.opsConfig || {}).stripe || {}).status || {}).level === 'none') throw new ActionError('Stripe is not set up on this unit, so no refund can go through it - set Stripe up first, or cancel with refund none and give the money back yourself');
        return { op: 'http', method: 'POST', path: `/api/admin/booking/cancel/${encodeURIComponent(b.id)}`, body: { refund_type: a.refund_type } };
      },
      describe: (a, ctx) => {
        const b = findBooking(ctx, a, ['active', 'completed'], 'cancel');
        const total = b.price_cents + b.tax_cents;
        const [s, e] = spanOf(b), now = nowAbs(ctx);
        const refund = a.refund_type === 'full' ? `They get back the ${money(total)} they paid online.`
          : a.refund_type === 'half' ? `They get back half of what they paid online (about ${money(Math.round(total / 2))}).`
          : b.paid_online ? `No refund: the ${money(total)} they paid online is kept.` : 'Nothing was paid online, so there is nothing to refund.';
        return `Cancel ${shortName(b.name)}'s booking: ${whereWords(b)}, ${dayWords(b.date)}, ${timeWords(b.start_time)} - ${timeWords(b.end_time)}${b.status === 'completed' ? ' (this session is already over)' : ''}. ${refund}`
          + (b.refunded && a.refund_type !== 'none' ? ' (Some of it was refunded already - only what is left can go back.)' : '')
          + (now >= s && now < e && b.status === 'active' ? ' They are playing right now - their bay is switched off.' : '')
          + (b.door_code_live ? ' Their door code stops working.' : '')
          + (b.member || b.discounted ? ' Free hours, member credit or a gift card it used are given back.' : '')
          + (!b.texts_ok ? ' No text or email goes to them (they did not agree to texts) - let them know yourself.'
            : !switchOn(ctx, 'sms', 'sendCancellation', true) ? ' No text or email goes to them (cancellation texts are switched off in your settings) - let them know yourself.'
            : ' They are sent the cancellation text, if texting is set up (no email goes from here).')
          + (a.refund_type !== 'none' ? ' If Stripe refuses the refund, the booking is still cancelled and the refund shows as failed in the log.' : '');
      } },

    // POST /api/admin/booking/expire/:id (routes/admin.js:553) - the Bookings tab's Clear on a pending booking: asks Stripe
    // first, refuses when the customer paid after all (409) or the bank is still processing, else frees the slot
    { name: 'booking_clear_pending', area: 'bookings', kind: 'write', confirm: true,
      say: 'Clear a checkout a customer never finished (a booking shown as "checkout not finished"), so its time can be booked again. Stripe is asked first: if they did pay, nothing is cleared',
      params: { type: 'object', properties: { date: { ...DATE, description: 'the day of the booking' }, time: { ...TIME, description: 'its start time (HH:MM)' },
        bay: { type: 'string', maxLength: 60 }, name: { type: 'string', minLength: 2, maxLength: 60, description: 'the customer\'s name, or part of it' } } },
      needs: ['bays', 'opsBookings', 'opsConfig'],
      build: (a, ctx) => { const b = findBooking(ctx, a, ['pending_payment'], 'clear'); return { op: 'http', method: 'POST', path: `/api/admin/booking/expire/${encodeURIComponent(b.id)}` }; },
      describe: (a, ctx) => {
        const b = findBooking(ctx, a, ['pending_payment'], 'clear');
        const ago = minutesAgo(b.created_at), hold = Number(((ctx.opsConfig || {}).booking || {}).bookingHoldMins) || 10;
        return `Clear ${shortName(b.name)}'s unfinished checkout (${whereWords(b)}, ${dayWords(b.date)}, ${timeWords(b.start_time)} - ${timeWords(b.end_time)}) so the time can be booked again. Stripe is asked first: if they did pay, nothing is cleared and you are told.`
          + (ago != null && ago >= 0 && ago < hold ? ` It started ${plural(ago, 'minute')} ago - they may still be paying, and clearing it stops their payment.` : '');
      } },

    // GET /api/admin/blocks?from= (routes/admin.js:269)
    { name: 'blocks_read', area: 'bookings', kind: 'read', say: 'Look at the blocks: bays (or the whole facility) taken out of booking for an event, a tournament or maintenance',
      params: { type: 'object', properties: { from: { ...DATE, description: 'from this day on (today when left out)' } } },
      needs: ['bays', 'opsConfig'],
      request: (a, ctx) => ({ method: 'GET', path: `/api/admin/blocks?from=${a.from || ctx.today}` }),
      digest: (j, ctx) => fit({ blocks: (j.blocks || []).length ? j.blocks.map(k => `${blockWhen(k)} | ${blockIsFacility(ctx, k) ? 'whole facility' : k.bay_name} | ${k.booking_type}${k.name ? ' | ' + k.name : ''}`) : ['no blocks'] }, 'blocks', 'ask from a later day') },

    // POST /api/admin/blocks (routes/admin.js:284): one bay, or bay_id 'facility' to close the building as ONE block. It is
    // refused (409) over a customer's booking. "All day" is worked out here from the opening hours rather than sent as
    // all_day, so the window can be checked against the bookings first; it is the window the route's own all_day gives since
    // Oct 20 2026 (before that, a close after midnight made it end before it started).
    { name: 'block_add', area: 'bookings', kind: 'write', confirm: true,
      say: 'Block off a bay, or close the whole facility, for an event, a tournament or maintenance - customers cannot book it then. Give the day and the hours, or all day; several days with end_date',
      params: { type: 'object', properties: {
        bay: { type: 'string', minLength: 1, maxLength: 60, description: 'the bay\'s name, or "whole facility" to close the building' },
        kind: { type: 'string', enum: ['event', 'tournament', 'maintenance'] },
        label: { type: 'string', maxLength: 60, description: 'its name on the calendar, like "Spring league" (optional)' },
        date: { ...DATE, description: 'the first day' }, end_date: { ...DATE, description: 'the last day, for a block over several days' },
        start_time: TIME, end_time: TIME, all_day: { type: 'boolean', description: 'true for the whole opening day (from opening to closing)' } }, required: ['bay', 'kind', 'date'] },
      needs: ['bays', 'opsConfig', 'opsBookings', 'opsBlocks'],
      // its name from the owner's own words when the model left it out (Oct 22 2026, the owner's second day: "... from noon to 4pm
      // for a birthday party" was put up as an unnamed event)
      fill: (a, ctx) => { if (a.label) return a; const m = /\bfor (?:a|an|the|our|my)\s+([a-z][a-z0-9' -]{2,40}?)\s*(?=[.,!?;]|$|\s(?:on|from|at|for|this|next|until|till|tomorrow|today|tonight)\b)/i.exec(ctx.newest || '');
        const n = m && m[1].trim(); return n && !/^(?:(?:whole |entire )?(?:day|afternoon|morning|evening|night|weekend|week|hour|hours|while|bit)|event|tournament|maintenance)$/i.test(n) ? Object.assign({}, a, { label: (n[0].toUpperCase() + n.slice(1)).slice(0, 60) }) : a; },
      build: (a, ctx) => { const w = blockWindow(a, ctx); return { op: 'http', method: 'POST', path: '/api/admin/blocks', body: { bay_id: w.where.whole ? 'facility' : w.where.id, type: a.kind, label: a.label || '', date: w.date, end_date: w.end_date, start_time: w.start_time, end_time: w.end_time } }; },
      describe: (a, ctx) => {
        const w = blockWindow(a, ctx);
        const what = { event: 'an event', tournament: 'a tournament', maintenance: 'maintenance' }[a.kind] + (a.label ? ` ("${a.label}")` : '');
        return w.where.whole
          ? `Close the whole facility for ${what}: ${blockWhen(w)}. Nobody can book any bay then.`
          : `Block ${w.where.name} for ${what}: ${blockWhen(w)}. Customers cannot book ${w.where.name} then${a.kind === 'maintenance' ? ', and nothing on it is switched on automatically' : ''}.`;
      } },

    // DELETE /api/admin/blocks/:id (routes/admin.js:372)
    { name: 'block_remove', area: 'bookings', kind: 'write', confirm: true,
      say: 'Take a block off, so the bay (or the facility) can be booked again then. Find it by a day it covers, and its bay or kind when there are several',
      params: { type: 'object', properties: { date: { ...DATE, description: 'a day the block covers' }, bay: { type: 'string', maxLength: 60, description: 'its bay, or "whole facility"' },
        kind: { type: 'string', enum: ['event', 'tournament', 'maintenance'] } }, required: ['date'] },
      needs: ['bays', 'opsConfig', 'opsBlocks'],
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: `/api/admin/blocks/${encodeURIComponent(findBlock(a, ctx).id)}` }),
      describe: (a, ctx) => { const k = findBlock(a, ctx); const fac = blockIsFacility(ctx, k); return `Remove the ${k.booking_type} block on ${fac ? 'the whole facility' : k.bay_name} (${blockWhen(k)}${k.name ? ', "' + k.name + '"' : ''}): ${fac ? 'every bay' : k.bay_name} can be booked again then.`; } },

    // the Facility Policies card's Check-in (admin.html #cfg_pos_checkinMode, saved by saveSettings() through POST
    // /api/admin/config, routes/admin.js:100). The setup checklist's "Check-in mode reviewed" (routes/admin.js:1392) is the
    // owner's conscious choice - choosing it here is that review, so it is marked done too (setupAck.checkin).
    { name: 'checkin_mode_set', area: 'bookings', kind: 'write', confirm: true,
      say: 'Choose how check-in works at the counter: full (staff check people in and settle the group), arrival only (staff mark people as arrived, nothing settled) or off (no check-in at all - most unstaffed facilities)',
      params: { type: 'object', properties: { mode: { type: 'string', enum: ['full', 'arrival', 'off'] } }, required: ['mode'] },
      build: (a) => ({ op: 'config', set: [['pos.checkinMode', a.mode], ['setupAck.checkin', true]] }),
      describe: (a) => a.mode === 'full' ? 'Check-in: full - staff check each group in at the counter and settle what they owe.'
        : a.mode === 'arrival' ? 'Check-in: arrival only - staff mark people as arrived; nothing is settled at check-in.'
        : 'Check-in off: a booking is simply valid - there is no check-in, and nothing for staff to settle a group with at the counter.' },

    // ════════════════════════════ SETUP: the Hours & Booking Rules card and its neighbours ════════════════════════════
    // GET /api/admin/config (routes/admin.js:98); the admin.html cards Hours & Booking Rules, Contact Information,
    // Business (the legal name) and Facility Policies
    { name: 'booking_rules_read', area: 'setup', kind: 'read',
      say: 'Look at the booking rules and the facility\'s details: opening hours, who can book, session lengths, how far ahead, the gap between bookings, the booking flow, cancelling, early bay access, check-in, the time zone, contact details and the legal name',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/admin/config' }),
      digest: (j) => {
        const b = j.booking || {}, c = j.contact || {}, s = j.server || {};
        const style = b.accessStyle || (b.staffedAccess ? 'staffed' : 'unmanned');
        return {
          open: b.open24Hours ? 'open 24 hours' : `${clock(b.openTime || '05:00')} - ${clock(b.closeTime || '23:30')}${b.closeNextDay ? ' (the next morning)' : ''}`,
          days_open: Array.isArray(b.openDays) && b.openDays.length && b.openDays.length < 7 ? b.openDays.join(', ') : 'every day',
          // the days with hours of their own (services/hours.js)
          days_with_own_hours: b.open24Hours ? undefined : (() => { const dh = require('../../hours').dayHours(b), k = Object.keys(dh); return k.length ? k.map(d => `${d} ${clock(dh[d].open)} - ${clock(dh[d].close)}`).join(', ') : undefined; })(),
          how_it_runs: style === 'staffed' ? 'staffed' : style === 'hybrid' ? 'hybrid (staffed some hours, door codes otherwise)' : 'unstaffed (door codes)',
          who_can_book: b.membersOnly ? 'members only' : 'anyone', one_booking_takes: b.wholeFacility ? 'the whole facility' : 'one bay',
          session_length: `${lenWords(Number(b.minSessionMins) || 30)} to ${lenWords(Number(b.maxSessionMins) || 240)}`,
          book_ahead_days: Number(b.windowDays) || 7, minutes_between_bookings: Number(b.bufferMins) || 0,
          customers_pick: (b.bookingFlow || 'bay-first') === 'time-first' ? 'a time, and the bay is given to them' : 'a bay, then a time',
          cancel_up_to_hours_before: (j.cancellationPolicy || {}).windowHours != null ? Number(j.cancellationPolicy.windowHours) : 24,
          early_bay_access: j.allowEarlyBayOn === false ? 'not allowed' : 'allowed', check_in: (j.pos || {}).checkinMode || 'full',
          time_zone: s.timezone || 'not set',
          contact: { phone: c.phone || '', email: c.email || '', street_address: c.address || '', website: c.website || '', hours_shown: c.hours || '' },
          legal_name: s.legalEntity || '(none - the business name is used)' };
      } },

    // the Hours & Booking Rules card's selects (admin.html #cfg_booking_minSessionMins ... #cfg_booking_flow_*), saved as saveSettings() saves them
    // through POST /api/admin/config (routes/admin.js:100); the values offered are the card's own
    { name: 'booking_rules_set', area: 'setup', kind: 'write', confirm: true,
      say: 'Change the booking rules: the shortest and longest session, how many days ahead customers can book, the minutes kept free between bookings, and whether customers pick a bay first or a time first',
      params: { type: 'object', properties: {
        shortest_minutes: { type: 'integer', enum: [30, 60, 90], description: 'the shortest session: 30, 60 or 90' },
        longest_minutes: { type: 'integer', enum: [60, 120, 180, 240], description: 'the longest session: 60, 120, 180 or 240' },
        days_ahead: { type: 'integer', enum: [3, 7, 14, 30, 60, 90, 180, 365], description: 'how far ahead customers can book: 3, 7, 14, 30, 60, 90, 180 or 365 days' },
        buffer_minutes: { type: 'integer', enum: [0, 5, 10, 15, 30], description: 'minutes kept free between bookings: 0, 5, 10, 15 or 30' },
        customers_pick: { type: 'string', enum: ['bay_first', 'time_first'], description: 'bay_first: customers pick their bay; time_first: they pick a time and a bay is given at checkout' } } },
      needs: ['opsConfig'],
      build: (a, ctx) => {
        const b = cfgOf(ctx).booking || {};
        const set = [];
        if (a.shortest_minutes !== undefined) set.push(['booking.minSessionMins', a.shortest_minutes]);
        if (a.longest_minutes !== undefined) set.push(['booking.maxSessionMins', a.longest_minutes]);
        if (a.days_ahead !== undefined) set.push(['booking.windowDays', a.days_ahead]);
        if (a.buffer_minutes !== undefined) set.push(['booking.bufferMins', a.buffer_minutes]);
        if (a.customers_pick !== undefined) set.push(['booking.bookingFlow', a.customers_pick === 'time_first' ? 'time-first' : 'bay-first']);
        if (!set.length) throw new ActionError('say which rule to change: the shortest or longest session, the days ahead, the gap between bookings, or bay first / time first');
        const lo = a.shortest_minutes !== undefined ? a.shortest_minutes : (Number(b.minSessionMins) || 30), hi = a.longest_minutes !== undefined ? a.longest_minutes : (Number(b.maxSessionMins) || 240);
        if (lo > hi) throw new ActionError(`the shortest session (${lenWords(lo)}) would be longer than the longest (${lenWords(hi)})`);
        return { op: 'config', set };
      },
      describe: (a, ctx) => {
        const b = (ctx.opsConfig || {}).booking || {};
        const parts = [];
        if (a.shortest_minutes !== undefined || a.longest_minutes !== undefined) parts.push(`sessions from ${lenWords(a.shortest_minutes !== undefined ? a.shortest_minutes : (Number(b.minSessionMins) || 30))} to ${lenWords(a.longest_minutes !== undefined ? a.longest_minutes : (Number(b.maxSessionMins) || 240))}`);
        if (a.days_ahead !== undefined) parts.push(`customers can book up to ${plural(a.days_ahead, 'day')} ahead`);
        if (a.buffer_minutes !== undefined) parts.push(a.buffer_minutes ? `${a.buffer_minutes} minutes kept free between bookings` : 'no gap kept between bookings');
        if (a.customers_pick !== undefined) parts.push(a.customers_pick === 'time_first' ? 'customers pick a time and a bay is given to them at checkout' : 'customers pick their bay first' + (b.wholeFacility ? ' (while one booking takes the whole facility, nobody picks a bay)' : ''));
        return 'Booking rules: ' + parts.join('; ') + '. Bookings already made do not change.';
      } },

    // the card's "Open 24 hours" (admin.html #cfg_booking_open24Hours, saved by saveSettings()): the opening and closing times stop applying
    { name: 'open_24_hours_set', area: 'setup', kind: 'write', confirm: true,
      say: 'Turn "open 24 hours" on or off: on, customers can book any time of day or night; off, only inside the opening hours',
      params: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
      needs: ['opsConfig'],
      build: (a, ctx) => { const b = cfgOf(ctx).booking || {}; if (!!b.open24Hours === a.on) throw new ActionError(`the facility is ${a.on ? 'already' : 'not'} open 24 hours`); return { op: 'config', set: [['booking.open24Hours', a.on], ['setupAck.hours', true]] }; },   // (set up by talking: an answer to "your opening hours" - setup-status; Oct 25 2026, "24/7" was asked again)
      describe: (a, ctx) => { const b = (ctx.opsConfig || {}).booking || {}; return a.on
        ? `Open 24 hours: customers can book any time of day or night, and a session may run past midnight (up to ${lenWords(Number(b.maxSessionMins) || 240)}). Your opening and closing times are not used while this is on.`
        : `Not open 24 hours: customers can book only inside your opening hours, ${clock(b.openTime || '05:00')} - ${clock(b.closeTime || '23:30')}${b.closeNextDay ? ' (the next morning)' : ''}.`; } },

    // the card's "Who Can Book" (admin.html #cfg_booking_membersOnly, saved by saveSettings())
    { name: 'members_only_set', area: 'setup', kind: 'write', confirm: true,
      say: 'Make booking members only (a private club: a current member code is needed to book online) or open to the public again',
      params: { type: 'object', properties: { members_only: { type: 'boolean' } }, required: ['members_only'] },
      needs: ['opsConfig', 'opsTiers'],
      build: (a, ctx) => { const b = cfgOf(ctx).booking || {}; if (!!b.membersOnly === a.members_only) throw new ActionError(`booking is ${a.members_only ? 'already members only' : 'already open to the public'}`); return { op: 'config', set: [['booking.membersOnly', a.members_only]] }; },
      describe: (a, ctx) => {
        if (!a.members_only) return 'Open to the public: anyone can book online again.';
        const tiers = ((ctx.opsTiers || {}).list || []).filter(t => t.active !== 0 && t.active !== false);
        return 'Members only: nobody can book online without a current member code; the booking page shows a Become a Member button that goes to your memberships page. You and your staff can still book anyone in. Member prices stand on their own (the "never more than the public price" cap is off).'
          + (!tiers.length ? ' You have no membership tiers yet, so nobody can book online until you make one.' : !tiers.some(t => t.sell_online) ? ' None of your tiers is sold online yet, so new people cannot join from the website.' : '');
      } },

    // the card's "Booking Unit" (admin.html #cfg_booking_wholeFacility, saved by saveSettings())
    { name: 'whole_facility_set', area: 'setup', kind: 'write', confirm: true,
      say: 'Choose whether one booking takes one bay (customers pick a bay) or the whole facility (a venue rented as one: one booking takes every bay)',
      params: { type: 'object', properties: { whole_facility: { type: 'boolean', description: 'true: one booking takes every bay; false: one booking takes one bay' } }, required: ['whole_facility'] },
      needs: ['opsConfig'],
      build: (a, ctx) => { const b = cfgOf(ctx).booking || {}; if (!!b.wholeFacility === a.whole_facility) throw new ActionError(`one booking ${a.whole_facility ? 'already takes the whole facility' : 'already takes one bay'}`); return { op: 'config', set: [['booking.wholeFacility', a.whole_facility]] }; },
      describe: (a, ctx) => { const b = (ctx.opsConfig || {}).booking || {}; return a.whole_facility
        ? `The whole facility: one booking takes every bay - customers pick a time with no bay choice, and each booking switches every bay on and off. The base price (${money(Math.round((Number(b.pricePerHalfHour) || 0) * 100))} per half hour now) becomes the price for the whole building, and bay premiums no longer apply. Bookings already made keep the meaning they were made with.`
        : 'One bay per booking: customers pick a bay, and each booking holds just that bay. Bookings already made keep the meaning they were made with.'; } },

    // the Contact Information card (admin.html #cfg_contact_*, saved by saveSettings()). The email gets the unit's alerts
    // (services/owneralert.js:44), website inquiries (routes/website.js:507) and replies to the facility's emails
    // (services/email.js:60 reply_to); the street address goes on calendar invites (services/ics.js:17) and is what Stripe
    // is given when a card reader is first paired (services/terminal.js:133). The website's Visit section shows this phone
    // and email unless it has its own (landing.html #visitContact and renderVisit(); website_contact_set)
    { name: 'contact_info_set', area: 'setup', kind: 'write', confirm: (a) => a.email !== undefined || a.street_address !== undefined,
      confirmSay: ' (a new email or street address is shown to the owner to approve first)',
      say: 'Change the facility\'s contact details shown on the website and booking pages: phone, email, street address, website, and the hours as words. The email also gets the unit\'s alerts and website inquiries',
      params: { type: 'object', properties: {
        phone: { type: 'string', minLength: 7, maxLength: 30 }, email: { type: 'string', minLength: 5, maxLength: 120 },
        street_address: { type: 'string', minLength: 3, maxLength: 160, description: 'like "123 Main St" (the city, state and ZIP are the location, set apart)' },
        website: { type: 'string', minLength: 4, maxLength: 200 },
        hours_text: { type: 'string', minLength: 2, maxLength: 120, description: 'the hours as words at the top of the booking page, like "Open daily 9 AM - 11 PM" (the hours customers can book are the opening hours)' } } },
      build: (a) => {
        if (a.email !== undefined && !EMAIL.test(a.email)) throw new ActionError(`"${a.email}" is not an email address`);
        const set = [];
        if (a.phone !== undefined) set.push(['contact.phone', a.phone]);
        if (a.email !== undefined) set.push(['contact.email', a.email]);
        if (a.street_address !== undefined) set.push(['contact.address', a.street_address]);
        if (a.website !== undefined) set.push(['contact.website', websiteOf(a.website)]);
        if (a.hours_text !== undefined) set.push(['contact.hours', a.hours_text]);
        if (!set.length) throw new ActionError('say what to change: the phone, email, street address, website or the hours words');
        return { op: 'config', set };
      },
      describe: (a) => 'Contact details: ' + [
        a.phone !== undefined && `phone ${a.phone}`,
        a.email !== undefined && `email ${a.email} - the unit's alerts, website inquiries and replies to your emails go to it`,
        a.street_address !== undefined && `street address ${a.street_address} - on calendar invites, and what Stripe is given when a card reader is first paired`,
        a.website !== undefined && `website ${websiteOf(a.website)}`,
        a.hours_text !== undefined && `"${a.hours_text}" shown as your hours (the hours customers can book do not change)`].filter(Boolean).join('; ')
        + '. They show on your website and booking pages (the website\'s Visit section keeps its own phone and email if it has them).' },

    // the Business card's Legal Entity (admin.html #cfg_legalEntity, saved by saveSettings()) - the company's name on the Privacy Policy and
    // Terms pages (server.js:796 LEGAL_ENTITY). A name the owner gives; no legal wording is written here (rule 15)
    // the registered company behind the business (server.legalEntity) - a NAME the site prints, never words of a document
    { name: 'company_name_set', area: 'setup', kind: 'write', confirm: false,
      say: 'Set the registered company name behind the business (like "City Golf Ventures LLC") - the name the site prints where it names who runs it; never any wording of a document',
      params: { type: 'object', properties: { name: { type: 'string', minLength: 2, maxLength: 120 } }, required: ['name'] },
      build: (a) => ({ op: 'config', set: [['server.legalEntity', a.name]] }),
      describe: (a) => `Company name: "${a.name}" - the registered company the site names as running the business` },

    // POST /api/admin/timezone/set {timezone} (routes/admin.js:2178): checked against the runtime's own zones
    // (services/timezone.js isValidZone), applied to the running unit and the system clock, and saved as server.timezone
    { name: 'timezone_set', area: 'setup', kind: 'write', confirm: true,
      say: 'Set the facility\'s time zone (Eastern, Central, Mountain, Pacific, Arizona, Alaska, Hawaii, or a full name like America/Chicago) - every booking time, reminder and door code runs on it',
      params: { type: 'object', properties: { zone: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['zone'] },
      needs: ['opsConfig'],
      build: (a, ctx) => {
        const z = zoneOf(a.zone);
        if (!z) throw new ActionError(`"${a.zone}" is not a time zone this unit knows - say Eastern, Central, Mountain, Pacific, Arizona, Alaska or Hawaii, or a full name like America/Chicago`);
        if (z === (cfgOf(ctx).server || {}).timezone) throw new ActionError(`the time zone is already ${z}`);
        return { op: 'http', method: 'POST', path: '/api/admin/timezone/set', body: { timezone: z } };
      },
      describe: (a, ctx) => { const z = zoneOf(a.zone), cur = ((ctx.opsConfig || {}).server || {}).timezone; return `Time zone: ${z}${ZONE_SAY[z] ? ' (' + ZONE_SAY[z] + ')' : ''}${cur ? ', was ' + cur : ''}. Every booking time, reminder, door code and bay power-on runs on this clock, so it must be where the facility is.`; } },

    // the Facility Policies card's Early bay access (admin.html #cfg_allowEarlyBayOn, saved by saveSettings()); read by the staff pad's bay
    // switch (routes/staff.js:373) - a bay with a session on, or starting within 30 minutes, can always be switched on
    { name: 'early_bay_access_set', area: 'setup', kind: 'write', confirm: true,
      say: 'Allow or stop early bay access: whether staff may switch an empty bay on early for someone who arrives before their booked time',
      params: { type: 'object', properties: { allowed: { type: 'boolean' } }, required: ['allowed'] },
      needs: ['opsConfig'],
      build: (a, ctx) => { const now = cfgOf(ctx).allowEarlyBayOn !== false; if (now === a.allowed) throw new ActionError(`early bay access is already ${a.allowed ? 'allowed' : 'off'}`); return { op: 'config', set: [['allowEarlyBayOn', a.allowed]] }; },
      describe: (a) => a.allowed ? 'Early bay access allowed: staff may switch an empty bay on early as a courtesy. It never changes the booking or its price.'
        : 'Early bay access off: staff cannot switch an empty bay on early - sessions start at their booked time (a bay with a session on, or starting within 30 minutes, can still be switched on).' },

    // ════════════════════════════ STAFF ════════════════════════════
    // POST /api/staff/schedule/shift/:id (routes/staff.js:870) - only the fields sent change; a staff_code of null makes it
    // open. The code comes from the roster by name and rides only in the request.
    { name: 'schedule_change_shift', area: 'staff', kind: 'write', confirm: true,
      say: 'Change a shift on the schedule: its day, its times, who works it, or make it an open shift (look at the schedule first for its number)',
      params: { type: 'object', properties: { shift_id: { type: 'integer', minimum: 1 }, date: { ...DATE, description: 'the new day' },
        start_time: TIME, end_time: TIME, staff: { type: 'string', maxLength: 60, description: 'who works it now (their name on the staff list)' },
        open: { type: 'boolean', description: 'true to make it an open shift with nobody on it' },
        label: { type: 'string', maxLength: 40, description: 'a short name for the shift, like "Evening"' }, note: { type: 'string', maxLength: 200 } }, required: ['shift_id'] },
      needs: ['roster', 'opsShifts'],
      build: (a, ctx) => {
        const sh = shiftOf(a, ctx);
        if (a.staff && a.open) throw new ActionError('say a person or an open shift, not both');
        const body = {};
        if (a.date !== undefined && a.date !== sh.date) body.date = a.date;
        if (a.start_time !== undefined && a.start_time !== sh.start_time) body.start_time = a.start_time;
        if (a.end_time !== undefined && a.end_time !== sh.end_time) body.end_time = a.end_time;
        if (a.staff) { const who = staffCode(ctx, a.staff); if (String(who.code) !== String(sh.staff_code || '')) body.staff_code = who.code; }
        if (a.open && sh.staff_code) body.staff_code = null;
        if (a.label !== undefined && a.label !== (sh.label || '')) body.label = a.label;
        if (a.note !== undefined && a.note !== (sh.note || '')) body.note = a.note;
        if (!Object.keys(body).length) throw new ActionError(a.date || a.start_time || a.end_time || a.staff || a.open || a.label || a.note ? 'that is how the shift is already' : 'say what to change: the day, the times, who works it, or make it open');
        if ((body.end_time || sh.end_time) <= (body.start_time || sh.start_time)) throw new ActionError('the shift must end after it starts (a shift past midnight is two shifts)');
        return { op: 'http', method: 'POST', path: `/api/staff/schedule/shift/${sh.id}`, body };
      },
      describe: (a, ctx) => {
        const sh = shiftOf(a, ctx), S = ctx.opsShifts || {};
        const d = a.date || sh.date, s = a.start_time || sh.start_time, e = a.end_time || sh.end_time;
        const person = a.staff ? staffCode(ctx, a.staff) : null;
        const code = a.open ? null : person ? person.code : sh.staff_code;
        const who = a.open ? 'open (nobody yet)' : person ? person.name : whoOf(ctx, sh.staff_code);
        const notes = [];
        if (code) {
          const off = (S.timeoff || []).find(t => String(t.staff_code) === String(code) && t.start_date <= d && t.end_date >= d);
          if (off) notes.push(off.status === 'approved' ? `${who} has time off that day` : `${who} has asked for that day off - still waiting for your answer`);
          const both = (S.shifts || []).find(x => x.id !== sh.id && String(x.staff_code) === String(code) && x.date === d && x.start_time < e && s < x.end_time);
          if (both) notes.push(`${who} already works ${timeWords(both.start_time)} - ${timeWords(both.end_time)} that day`);
        }
        const req = (S.pendingReq || []).find(r => Number(r.shift_id) === Number(sh.id));
        if (req) notes.push(`${req.staff_name || 'someone'}'s request to ${req.kind === 'claim' ? 'pick up' : 'drop'} this shift is still waiting`);
        return `Change shift #${sh.id} (${dayWords(sh.date)}, ${timeWords(sh.start_time)} - ${timeWords(sh.end_time)}, ${whoOf(ctx, sh.staff_code)}) to ${dayWords(d)}, ${timeWords(s)} - ${timeWords(e)}, ${who}`
          + (a.label !== undefined ? ` ("${a.label}")` : '') + (notes.length ? `. Note: ${notes.join('; ')}.` : '.');
      } },

    // GET /api/staff/coverage (routes/staff.js:981) and GET /api/staff/schedule/templates (routes/staff.js:909)
    { name: 'schedule_setup_read', area: 'staffing', kind: 'read',
      say: 'Look at the seasons (which weekdays and hours are staffed), which season is in use, whether staffed hours are switched on, and the saved shift patterns',
      params: { type: 'object', properties: {} },
      needs: ['roster'],
      local: routeRead(async (a, ctx) => {
        const cov = await read(ctx, '/api/staff/coverage');
        let pats = []; try { pats = (await read(ctx, '/api/staff/schedule/templates')).templates || []; } catch { pats = []; }
        const act = (cov.templates || []).find(t => t.id === cov.activeId);
        return {
          staffed_hours: cov.scheduleOff ? 'switched OFF everywhere - no day counts as staffed' : 'on',
          season_in_use: act ? act.name : 'none - the Website\'s Staffed Days calendar decides',
          seasons: (cov.templates || []).map(t => ({ season: t.name, week: weekWords(t.days || []), shift_blocks: (t.blocks || []).map(b => `${b.name} ${clock(b.start)} - ${clock(b.end)} (${blockDays(b)})`).join('; ') || 'none' })),
          shift_patterns: pats.map(p => ({ pattern: p.name, shifts: (p.shifts || []).length,
            people: [...new Set((p.shifts || []).map(s => s.staff_code ? (rosterName(ctx, s.staff_code) || 'someone no longer on the staff list') : 'open shifts'))].join(', ') })) };
      }) },

    // POST /api/staff/coverage/activate {id|null} (routes/staff.js:1024) - Settings > Schedule's season list, "No season"
    // included (admin.html schActivate())
    { name: 'season_use', area: 'staffing', kind: 'write', confirm: true,
      say: 'Choose which season decides the staffed hours, or "none" so the Website\'s Staffed Days calendar decides',
      params: { type: 'object', properties: { season: { type: 'string', minLength: 2, maxLength: 60, description: 'the season\'s name, or "none"' } }, required: ['season'] },
      needs: ['opsCoverage'],
      build: (a, ctx) => {
        const cov = offIf(ctx.opsCoverage);
        const t = NONE.test(a.season.trim()) ? null : findSeason(cov, a.season);
        if ((t ? t.id : null) === (cov.activeId || null)) throw new ActionError(t ? `"${t.name}" is already in use` : 'no season is in use already - the Website\'s Staffed Days calendar decides');
        return { op: 'http', method: 'POST', path: '/api/staff/coverage/activate', body: { id: t ? t.id : null } };
      },
      describe: (a, ctx) => {
        const cov = ctx.opsCoverage || {};
        const off = cov.scheduleOff ? ' (Staffed hours are switched off right now, so no day is staffed until they are switched back on.)' : '';
        if (NONE.test(a.season.trim())) return 'No season: the Website\'s Staffed Days calendar decides which days are staffed again.' + off;
        const t = findSeason(cov, a.season);
        return `Use the season "${t.name}" for staffed hours: ${weekWords(t.days || [])}. While a season is in use, the Website's Staffed Days calendar is not used.` + off;
      } },

    // POST /api/staff/coverage/template {id, name, days, blocks} (routes/staff.js:986) replaces the season whole, so it goes
    // through the page's merge op on the season as it is (GET /api/staff/coverage) with only its days changed
    { name: 'season_hours_set', area: 'staffing', kind: 'write', confirm: true,
      say: 'Change a season\'s weekly staffed hours: which weekdays are staffed and from when to when, or all day, or not staffed (the season in use unless one is named)',
      params: { type: 'object', properties: {
        weekdays: { type: 'array', items: { type: 'string' }, description: 'the days: mon tue wed thu fri sat sun, weekdays, weekends or every day', 'x-days': true },
        staffed: { type: 'boolean', description: 'false makes those days not staffed' },
        start_time: TIME, end_time: { ...TIME, description: 'until (HH:MM; midnight is 23:59)' },
        season: { type: 'string', maxLength: 60, description: 'the season\'s name (the one in use when left out)' } }, required: ['weekdays', 'staffed'] },
      needs: ['opsCoverage'],
      build: (a, ctx) => { const { t, days } = seasonDays(a, ctx); return { op: 'merge', get: '/api/staff/coverage', list: 'templates', find: ['id', t.id], fields: ['id', 'name', 'days', 'blocks'], set: { days }, put: '/api/staff/coverage/template', method: 'POST' }; },
      describe: (a, ctx) => {
        const { t, days } = seasonDays(a, ctx);
        const inUse = t.id === (ctx.opsCoverage || {}).activeId;
        return `In the season "${t.name}": ${a.weekdays.map(k => DAYN[KEYS.indexOf(k)]).join(', ')} ${dayHours(days[KEYS.indexOf(a.weekdays[0])])}, every week.`
          + (inUse ? ' It is the season in use, so this counts from now on; a day changed on its own keeps its own hours.' : ' (This season is not in use right now.)');
      } },

    // POST /api/staff/coverage/schedule-off {off} (routes/staff.js:1045) - Settings > Schedule's master switch (admin.html schToggleOff())
    // EMPLOYEE SCHEDULING (the wizard's money step, The Counter card): schedules, the time clock and the hours export on or off,
    // and the words the booking page shows for staffed hours
    { name: 'scheduling_switch', area: 'staffing', kind: 'write', confirm: true,
      say: 'Switch employee scheduling on or off (schedules, the time clock and the hours export), and/or set the words the booking page shows for staffed hours (like "Staffed hours") - ONLY when the owner asks to switch scheduling on or off; never on your own while doing something else',
      params: { type: 'object', properties: { on: { type: 'boolean' }, label: { type: 'string', minLength: 2, maxLength: 40 } } },
      build: (a) => {
        const set = [];
        if (a.on !== undefined) set.push(['scheduling.enabled', !!a.on]);
        if (a.label !== undefined) set.push(['scheduling.staffedLabel', a.label.trim()]);
        if (!set.length) throw new ActionError('say whether scheduling is on or off, or the words for staffed hours');
        return { op: 'config', set };
      },
      describe: (a) => [a.on !== undefined && (a.on ? 'Employee scheduling on: schedules, the time clock and the hours export' : 'Employee scheduling off: no schedules, time clock or hours export (nothing recorded is lost)'), a.label !== undefined && `the booking page calls staffed hours "${a.label.trim()}"`].filter(Boolean).join('; ') },
    { name: 'staffed_hours_switch', area: 'staffing', kind: 'write', confirm: true,
      say: 'Switch staffed hours off everywhere (no day counts as staffed: no deposits or paying at the door, everyone pays in full online) or back on',
      params: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
      needs: ['opsCoverage', 'opsConfig'],
      build: (a, ctx) => { const cov = offIf(ctx.opsCoverage); if (!cov.scheduleOff === a.on) throw new ActionError(`staffed hours are ${a.on ? 'already on' : 'already switched off'}`); return { op: 'http', method: 'POST', path: '/api/staff/coverage/schedule-off', body: { off: !a.on } }; },
      describe: (a, ctx) => {
        const cov = ctx.opsCoverage || {}, b = (ctx.opsConfig || {}).booking || {};
        const act = (cov.templates || []).find(t => t.id === cov.activeId);
        const always = (b.accessStyle || (b.staffedAccess ? 'staffed' : '')) === 'staffed' ? ' (Your facility is set as always staffed, so this changes nothing until that changes.)' : '';
        return (a.on ? `Staffed hours back on: ${act ? 'the season "' + act.name + '"' : 'the Website\'s Staffed Days calendar'} decides which days are staffed again.`
          : 'Staffed hours OFF everywhere: no day counts as staffed, whatever the season or the calendar says - deposits and paying at the door stop, and everyone pays in full online until you switch them back on.') + always;
      } },

    // DELETE /api/staff/coverage/exception/:date (routes/staff.js:1042) - the Schedule tab's way back to the season for a day
    // changed on its own (admin.html schExceptionClear()). A day's change only counts while a season is in use (services/staffing.js:109)
    { name: 'staffed_day_restore', area: 'staffing', kind: 'write', confirm: true,
      say: 'Put a day that was changed on its own back to its season\'s staffed hours (undo a one-day change)',
      params: { type: 'object', properties: { date: DATE }, required: ['date'] },
      needs: ['opsShifts', 'opsCoverage'],
      build: (a, ctx) => { restoreCheck(a, ctx); return { op: 'http', method: 'DELETE', path: `/api/staff/coverage/exception/${a.date}` }; },
      describe: (a, ctx) => {
        const { t, ex } = restoreCheck(a, ctx);
        return `${dayWords(a.date)} goes back to the season "${t.name}": ${dayHours((t.days || [])[dowMon0(a.date)])}${ex ? ` (it was changed to: ${ex.staffed ? (ex.start_time && ex.end_time ? `staffed ${clock(ex.start_time)} - ${clock(ex.end_time)}` : 'staffed all day') : 'not staffed'})` : ''}.`;
      } },

    // ── SEASONS MADE AND REMOVED, THEIR SHIFT BLOCKS, A SAVED PATTERN REMOVED (Oct 21 2026 - the gap audit's item 13; Settings >
    //    Schedule's own season editor and pattern list). POST /api/staff/coverage/template {name, days, blocks} makes a season
    //    (routes/staff.js:989 - the first one a facility saves is put in use); DELETE .../template/:id removes one (the one in
    //    use: the Website's Staffed Days calendar decides again); DELETE /api/staff/schedule/templates/:id removes a pattern ──
    { name: 'season_create', area: 'staffing', kind: 'write', confirm: true,
      say: 'Make a new season of staffed hours (like "Summer" or "Winter"): the weekdays staffed and their hours (all day when no hours), and optionally a second group of days with other hours (weekdays 4 to 10, weekends all day). Days in neither group are not staffed. It is not used until season_use picks it (the first season ever made is used at once)',
      params: { type: 'object', properties: {
        name: { type: 'string', minLength: 2, maxLength: 40 },
        weekdays: { type: 'array', items: { type: 'string' }, description: 'the days staffed: mon tue wed thu fri sat sun, weekdays, weekends or every day', 'x-days': true },
        start_time: TIME, end_time: { ...TIME, description: 'until (HH:MM; midnight is 23:59)' },
        other_weekdays: { type: 'array', items: { type: 'string' }, description: 'a second group of staffed days with other hours', 'x-days': true },
        other_start_time: TIME, other_end_time: { ...TIME, description: 'until, for the second group' } }, required: ['name', 'weekdays'] },
      needs: ['opsCoverage'],
      build: (a, ctx) => {
        const cov = offIf(ctx.opsCoverage);
        if ((cov.templates || []).some(t => String(t.name).toLowerCase() === a.name.trim().toLowerCase())) throw new ActionError(`there is already a season called "${a.name}" - change it with season_hours_set, or choose another name`);
        const hours = (s, e, label) => {
          if (!!s !== !!e) throw new ActionError(`give both the start and the end${label}, or neither for all day`);
          if (!s) return { start: '', end: '' };
          const end = untilOf(e); if (end <= s) throw new ActionError(`in a season a staffed day ends by midnight (23:59)${label} - hours after midnight go on the next day`);
          return { start: s, end };
        };
        const days = KEYS.map((k, i) => ({ dow: i, staffed: 0, start: '', end: '' }));
        const first = hours(a.start_time, a.end_time, '');
        for (const k of a.weekdays) days[KEYS.indexOf(k)] = Object.assign({ dow: KEYS.indexOf(k), staffed: 1 }, first);
        if (a.other_weekdays) {
          const second = hours(a.other_start_time, a.other_end_time, ' for the second group');
          for (const k of a.other_weekdays) { if (a.weekdays.includes(k)) throw new ActionError(`${DAYN[KEYS.indexOf(k)]} is in both groups - give each day once`); days[KEYS.indexOf(k)] = Object.assign({ dow: KEYS.indexOf(k), staffed: 1 }, second); }
        }
        return { op: 'http', method: 'POST', path: '/api/staff/coverage/template', body: { name: a.name.trim(), days, blocks: [] } };
      },
      describe: (a, ctx) => {
        const days = KEYS.map(() => ({ staffed: 0 }));
        const put = (list, s, e) => { for (const k of list || []) days[KEYS.indexOf(k)] = { staffed: 1, start: s || '', end: s ? untilOf(e) : '' }; };
        put(a.weekdays, a.start_time, a.end_time); put(a.other_weekdays, a.other_start_time, a.other_end_time);
        const first = !((ctx.opsCoverage || {}).templates || []).length;
        return `A new season, "${a.name.trim()}": ${weekWords(days)}. ${first ? 'It is your first season, so it is used from now on (the Website\'s Staffed Days calendar stops deciding).' : 'It is not used until you say so.'}`;
      } },
    { name: 'season_remove', area: 'staffing', kind: 'write', confirm: true,
      say: 'Remove a season of staffed hours. When it is the one in use, the Website\'s Staffed Days calendar decides again',
      params: { type: 'object', properties: { season: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['season'] },
      needs: ['opsCoverage'],
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: `/api/staff/coverage/template/${findSeason(offIf(ctx.opsCoverage), a.season).id}` }),
      describe: (a, ctx) => { const cov = ctx.opsCoverage || {}, t = findSeason(cov, a.season); return `Remove the season "${t.name}" (${weekWords(t.days || [])}).${t.id === cov.activeId ? ' It is the season in use: the Website\'s Staffed Days calendar decides which days are staffed from now on.' : ''}`; } },
    { name: 'season_blocks_set', area: 'staffing', kind: 'write', confirm: true,
      say: 'Set a season\'s shift blocks - the named shifts a staffed day is covered by (like "Open" 9 to 3 and "Close" 3 to 11), each on every day or on some days. The schedule shows hours no shift covers against them. Replaces the season\'s blocks; an empty list removes them',
      params: { type: 'object', properties: {
        season: { type: 'string', maxLength: 60, description: 'the season\'s name (the one in use when left out)' },
        blocks: { type: 'array', maxItems: 12, items: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 30 }, start_time: TIME, end_time: TIME, weekdays: { type: 'string', maxLength: 80, description: 'the days it is on (every day when left out)' } }, required: ['name', 'start_time', 'end_time'] } } }, required: ['blocks'] },
      needs: ['opsCoverage'],
      build: (a, ctx) => {
        const cov = offIf(ctx.opsCoverage);
        const t = a.season ? findSeason(cov, a.season) : (cov.templates || []).find(x => x.id === cov.activeId);
        if (!t) throw new ActionError('no season is in use - name the season');
        const blocks = (a.blocks || []).map(b => {
          const s = H.normTime(b.start_time), e = untilOf(H.normTime(b.end_time) || '');
          if (!s || !e || e <= s) throw new ActionError(`the shift "${b.name}" needs a start and an end after it, by midnight (23:59)`);
          const d = b.weekdays ? H.normDays(b.weekdays) : null;
          if (b.weekdays && !d) throw new ActionError(`"${b.weekdays}" is not days of the week`);
          return Object.assign({ name: String(b.name).trim().slice(0, 30), start: s, end: e }, d && d.length < 7 ? { days: d.map(k => KEYS.indexOf(k)).sort() } : {});
        });
        return { op: 'merge', get: '/api/staff/coverage', list: 'templates', find: ['id', t.id], fields: ['id', 'name', 'days', 'blocks'], set: { blocks }, put: '/api/staff/coverage/template', method: 'POST' };
      },
      describe: (a, ctx) => {
        const cov = ctx.opsCoverage || {}, t = a.season ? findSeason(cov, a.season) : (cov.templates || []).find(x => x.id === cov.activeId) || { name: 'the season in use' };
        if (!(a.blocks || []).length) return `Take the shift blocks off the season "${t.name}".`;
        return `The season "${t.name}"'s shifts: ` + a.blocks.map(b => `${b.name} ${clock(H.normTime(b.start_time))} - ${clock(untilOf(H.normTime(b.end_time)))}${b.weekdays ? ' (' + (H.normDays(b.weekdays) || []).map(k => DAYN[KEYS.indexOf(k)]).join(', ') + ')' : ''}`).join('; ') + '.';
      } },
    { name: 'pattern_remove', area: 'staff', kind: 'write', confirm: true,
      say: 'Remove a saved shift pattern (nothing on the schedule changes)',
      params: { type: 'object', properties: { pattern: { type: 'string', minLength: 2, maxLength: 40, description: 'the pattern\'s name' } }, required: ['pattern'] },
      needs: ['opsPatterns'],
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: `/api/staff/schedule/templates/${findPattern(a, ctx).id}` }),
      describe: (a, ctx) => `Remove the saved pattern "${findPattern(a, ctx).name}". Nothing on the schedule changes.` },

    // POST /api/staff/schedule/templates {name, weekStart} (routes/staff.js:913) - Save as pattern (admin.html schSavePattern())
    { name: 'pattern_save', area: 'staff', kind: 'write', confirm: true,
      say: 'Save a week\'s shifts as a pattern (like "Standard week") to put on other weeks later. Nothing on the schedule changes',
      params: { type: 'object', properties: { name: { type: 'string', minLength: 2, maxLength: 40 }, week: { ...DATE, description: 'any day in the week to save (this week when left out)' } }, required: ['name'] },
      needs: ['opsPatterns', 'opsShifts'],
      build: (a, ctx) => { const w = patternWeek(a, ctx); return { op: 'http', method: 'POST', path: '/api/staff/schedule/templates', body: { name: a.name, weekStart: w.monday } }; },
      describe: (a, ctx) => { const w = patternWeek(a, ctx); return `Save the shifts of the week of ${dayWords(w.monday)}${w.count != null ? ' (' + plural(w.count, 'shift') + ')' : ''} as the pattern "${a.name}". Nothing on the schedule changes.`; } },

    // POST /api/staff/schedule/templates/:id/apply {weekStart} (routes/staff.js:924) - Apply pattern (admin.html schApplyPattern()): a shift
    // already there is not doubled; a shift of someone no longer on the staff list goes on open
    { name: 'pattern_apply', area: 'staff', kind: 'write', confirm: true,
      say: 'Put a saved shift pattern on a week of the schedule',
      params: { type: 'object', properties: { pattern: { type: 'string', minLength: 2, maxLength: 40, description: 'the pattern\'s name' }, week: { ...DATE, description: 'any day in the week to fill' } }, required: ['pattern', 'week'] },
      needs: ['opsPatterns', 'roster'],
      build: (a, ctx) => ({ op: 'http', method: 'POST', path: `/api/staff/schedule/templates/${findPattern(a, ctx).id}/apply`, body: { weekStart: mondayOf(a.week) } }),
      describe: (a, ctx) => {
        const p = findPattern(a, ctx);
        const codes = [...new Set((p.shifts || []).filter(s => s.staff_code).map(s => String(s.staff_code)))];
        const gone = codes.filter(c => !(ctx.roster || []).some(r => String(r.code) === c)).length;
        const away = codes.map(c => (ctx.roster || []).find(r => String(r.code) === c)).filter(r => r && r.active === false).map(r => r.name);
        return `Put the ${plural((p.shifts || []).length, 'shift')} of "${p.name}" on the week of ${dayWords(mondayOf(a.week))}. A shift already there is not doubled.`
          + (gone ? ` ${gone === 1 ? 'One person' : gone + ' people'} in it ${gone === 1 ? 'is' : 'are'} no longer on the staff list - those shifts go on as open shifts.` : '')
          + (away.length ? ` ${away.join(', ')} can no longer sign in, but their shifts still go on under their name - change them after.` : '');
      } },

    // GET /api/staff/clock/entries (routes/staff.js:728) and GET /api/staff/ops-today (routes/staff.js:1053): names and
    // times, never a code; hours, never payroll words (rule 12)
    { name: 'clock_read', area: 'staff', kind: 'read',
      say: 'Look at the time clock: who is clocked in now, each person\'s clock-ins, clock-outs and hours for a day or a range, and employees\' own clock fixes waiting for review',
      params: { type: 'object', properties: { from: { ...DATE, description: 'first day (today when left out)' }, to: { ...DATE, description: 'last day (the same day when left out)' },
        staff: { type: 'string', maxLength: 60, description: 'only this person' } } },
      local: routeRead(async (a, ctx) => {
        const from = a.from || ctx.today, to = a.to && a.to >= from ? a.to : from;
        if (dayNo(to) - dayNo(from) > 62) return { error: 'ask for at most two months at a time' };
        const j = await read(ctx, `/api/staff/clock/entries?start=${from}&end=${to}`);
        let now = {}; try { now = await read(ctx, '/api/staff/ops-today'); } catch { now = {}; }
        const mine = (n) => !a.staff || nameMatches(n, a.staff);
        const entries = (j.entries || []).filter(e => mine(entryName(e))).sort((x, y) => String(x.clock_in).localeCompare(String(y.clock_in)));
        const totals = {};
        for (const e of entries) if (e.worked_minutes != null) totals[entryName(e)] = Math.round(((totals[entryName(e)] || 0) + e.worked_minutes / 60) * 100) / 100;
        const out = {
          on_the_clock_now: (now.onClock || []).filter(o => mine(o.name)).map(o => ({ entry_id: o.id, who: o.name, since: stampWords(o.since), hours_so_far: o.minutes != null ? hoursOf(o.minutes) : undefined })),
          waiting_for_review: (now.flagged || []).filter(f => mine(f.staff_name)).map(f => ({ entry_id: f.id, who: f.staff_name, in: stampWords(f.clock_in), out: stampWords(f.clock_out), hours: hoursOf(f.worked_minutes), why: f.flag_reason || undefined })),
          hours_by_person: totals,
          entries: entries.map(e => `#${e.id} ${entryName(e)}: ${stampWords(e.clock_in)} - ${e.clock_out ? (String(e.clock_out).slice(0, 10) === String(e.clock_in).slice(0, 10) ? timeWords(String(e.clock_out).slice(11, 16)) : stampWords(e.clock_out)) : 'still clocked in'}`
            + `${e.break_minutes ? `, ${e.break_minutes} min break` : ''}${e.worked_minutes != null ? `, ${hoursOf(e.worked_minutes)} hours` : ''}${e.flagged && !e.reviewed ? ' (their own fix - waiting for review)' : ''}${e.edited_by ? ' (changed by ' + e.edited_by + ')' : ''}`) };
        if (!out.entries.length) out.entries = ['no clock entries then'];
        return fit(out, 'entries', 'ask for fewer days or one person');
      }) },

    // POST /api/staff/clock/entry/:id/out-now (routes/staff.js:756) - the time clock card's "Clock out now" (admin.html clkLoad())
    { name: 'clock_out_now', area: 'staff', kind: 'write', confirm: true,
      say: 'Clock someone out now (they left without clocking out)',
      params: { type: 'object', properties: { staff: { type: 'string', minLength: 1, maxLength: 60, description: 'their name' } }, required: ['staff'] },
      needs: ['opsClock'],
      build: (a, ctx) => ({ op: 'http', method: 'POST', path: `/api/staff/clock/entry/${onClockOf(a, ctx).id}/out-now` }),
      describe: (a, ctx) => { const o = onClockOf(a, ctx); return `Clock ${o.name} out now (clocked in since ${stampWords(o.since)}${o.minutes != null ? ', about ' + hoursOf(o.minutes) + ' hours' : ''}).`; } },

    // POST /api/staff/clock/entry/:id {clock_in?, clock_out?, break_minutes?, note?} (routes/staff.js:735) - the card's Edit
    // (admin.html clkEdit()): only what is sent changes, and the entry is marked as reviewed by the owner
    { name: 'clock_entry_fix', area: 'staff', kind: 'write', confirm: true,
      say: 'Fix a clock entry: the time someone clocked in or out, or their break minutes. Find it by its number from clock_read, or by the person and the day they clocked in',
      params: { type: 'object', properties: { entry_id: { type: 'integer', minimum: 1 }, staff: { type: 'string', maxLength: 60, description: 'their name' },
        date: { ...DATE, description: 'the day they clocked in' }, clock_in: { ...TIME, description: 'the right clock-in time (HH:MM)' },
        clock_out: { ...TIME, description: 'the right clock-out time (HH:MM; earlier than the clock-in means the next day)' },
        break_minutes: { type: 'integer', minimum: 0, maximum: 240 }, note: { type: 'string', maxLength: 200 },
        still_clocked_in: { type: 'boolean', description: 'true puts them back on the clock: their latest entry\'s clock-out taken away (they clocked out by mistake)' } } },
      needs: ['opsClockEntries'],
      build: (a, ctx) => { const f = entryFix(a, ctx); return { op: 'http', method: 'POST', path: `/api/staff/clock/entry/${f.e.id}`, body: f.body }; },
      describe: (a, ctx) => {
        const f = entryFix(a, ctx), e = f.e;
        const was = `${stampWords(e.clock_in)} - ${e.clock_out ? stampWords(e.clock_out) : 'still clocked in'}${e.break_minutes ? ', ' + e.break_minutes + ' min break' : ''}`;
        return `${entryName(e)}'s clock entry: in ${stampWords(f.ci)}, out ${f.co ? stampWords(f.co) : 'still clocked in'}${f.brk ? ', ' + f.brk + ' min break' : ''}${f.hours != null ? ' - ' + f.hours + ' hours' : ''} (it was: ${was}). It is marked as reviewed by you.`;
      } },

    // POST /api/staff/clock/entry/:id/review (routes/staff.js:752) - "Reviewed" on an employee's own clock fix (admin.html loadStaffOps())
    { name: 'clock_fix_accept', area: 'staff', kind: 'write', confirm: true,
      say: 'Accept an employee\'s own clock fix as it is (they entered the time they left after forgetting to clock out)',
      params: { type: 'object', properties: { staff: { type: 'string', maxLength: 60, description: 'their name' }, entry_id: { type: 'integer', minimum: 1 } } },
      needs: ['opsClock'],
      build: (a, ctx) => ({ op: 'http', method: 'POST', path: `/api/staff/clock/entry/${flaggedOf(a, ctx).id}/review`, body: {} }),
      describe: (a, ctx) => { const f = flaggedOf(a, ctx); return `Accept ${f.staff_name}'s own fix of their clock entry: in ${stampWords(f.clock_in)}, out ${stampWords(f.clock_out)} - ${hoursOf(f.worked_minutes)} hours${f.flag_reason ? ' ("' + f.flag_reason + '")' : ''}.`; } },

    // A CLOCK ENTRY TAKEN OUT (Oct 20 2026, late - the gap audit: the weekly tidy-up of a duplicate or a mistaken punch):
    // DELETE /api/staff/clock/entry/:id (routes/staff.js:766) - said back first with the entry's times
    { name: 'clock_entry_delete', area: 'staff', kind: 'write', confirm: true,
      say: 'Take a clock entry out entirely (a duplicate, or a punch made by mistake) - by its number from clock_read, or the person and the day. To change its times instead use clock_entry_fix',
      params: { type: 'object', properties: { entry_id: { type: 'integer', minimum: 1 }, staff: { type: 'string', maxLength: 60, description: 'their name' }, date: { ...DATE, description: 'the day they clocked in' } } },
      needs: ['opsClockEntries'],
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: `/api/staff/clock/entry/${entryOnly(a, ctx).id}` }),
      describe: (a, ctx) => { const e = entryOnly(a, ctx); return `Take out ${entryName(e)}'s clock entry #${e.id}: in ${stampWords(e.clock_in)}, out ${e.clock_out ? stampWords(e.clock_out) : 'still clocked in'}${e.worked_minutes != null ? ' (' + hoursOf(e.worked_minutes) + ' hours)' : ''} - its hours leave the period's total`; } },

    // THE HOURS EXPORT (Oct 20 2026, late - the gap audit: every period): the scheduled send of the hours to whoever the
    // owner named (routes/staff.js:633-653) - what is held for the owner's sign-off, then approve, skip, or send last period now
    { name: 'hours_send_read', area: 'staff', kind: 'read',
      say: 'See the hours export: whether it sends itself, to how many people, when next, and whether a period is waiting for the owner to approve or skip',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/staff/hours/send' }),
      digest: (j) => { const c = j.config || {}, p = j.pending, n = j.next;
        return { sends_itself: !!c.enabled, to: Array.isArray(c.recipients) ? `${c.recipients.length} address${c.recipients.length === 1 ? '' : 'es'}` : undefined, waits_for_owner: c.mode === 'hold' || undefined,
          waiting_for_you: p ? { period: `${dayWords(p.start)} to ${dayWords(p.end)}`, people: p.people, hours: p.totalHours } : 'nothing',
          next: n ? { period: `${dayWords(n.start)} to ${dayWords(n.end)}`, sends: String(n.at || '').replace('T', ' ').slice(0, 16), overdue: !!n.overdue || undefined } : undefined,
          last_sent: j.last ? { period: `${dayWords(j.last.start)} to ${dayWords(j.last.end)}`, at: String(j.last.sent_at || '').slice(0, 16) } : 'never',
          clock_fixes_to_review: Number(j.flaggedOpen) || 0 }; } },
    { name: 'hours_send_decide', area: 'staff', kind: 'write', confirm: true,
      say: 'The hours export held for the owner\'s sign-off: approve it (it goes to its addresses now) or skip it (that period is not sent). Read hours_send_read first',
      params: { type: 'object', properties: { decision: { type: 'string', enum: ['approve', 'skip'] } }, required: ['decision'] },
      needs: ['opsHoursSend'],
      build: (a, ctx) => { const p = heldPeriod(ctx); return { op: 'http', method: 'POST', path: `/api/staff/hours/send/${a.decision}`, body: { id: p.id } }; },
      describe: (a, ctx) => { const p = heldPeriod(ctx); return `${a.decision === 'approve' ? 'Send' : 'Skip'} the hours for ${dayWords(p.start)} to ${dayWords(p.end)} - ${p.people || 0} people, ${p.totalHours} hours${a.decision === 'approve' ? ', to its addresses now' : '; that period is not sent'}`; } },
    { name: 'hours_send_now', area: 'staff', kind: 'write', confirm: true,
      say: 'Send the last period\'s hours to the export\'s addresses now, without waiting for its time',
      params: { type: 'object', properties: {} },
      needs: ['opsHoursSend'],
      build: (a, ctx) => { const H = ctx.opsHoursSend || {}; if (H.error) throw new ActionError(`the hours export could not be read (${H.error})`); if (!(H.config || {}).enabled) throw new ActionError('the hours export is not switched on - Settings > Staff > Send the hours export'); return { op: 'http', method: 'POST', path: '/api/staff/hours/send/now', body: {} }; },
      describe: (a, ctx) => { const pr = (ctx.opsHoursSend || {}).period || {}; return `Send the hours for ${pr.lastStart ? dayWords(pr.lastStart) + ' to ' + dayWords(pr.lastEnd) : 'the last period'} to the export's addresses now`; } },

    // POST /api/staff/roster {staff: [...]} (routes/staff.js:94) replaces the whole list, sign-in codes included - so the list
    // sent is the roster as read (the roster loader, on the box) with one person's Active switched; the codes ride only in
    // the request the owner's page sends. Their upcoming shifts are opened under the same yes (POST /api/staff/schedule/
    // shift/:id {staff_code: null}, routes/staff.js:870) - "people leave; their shifts come back open" (routes/staff.js:934)
    // STAFF ADDED AND CHANGED (Oct 20 2026, late - the gap audit: every hire). The roster is saved whole (routes/staff.js POST
    // /api/staff/roster), every code as it is; a new sign-in code is made by the unit and shown to the owner only (FOR YOUR
    // EYES - the page shows it, the result the assistant hears never carries it). Someone who leaves is staff_signin_set,
    // kept on the list so past shifts and hours keep their name
    { name: 'staff_add', area: 'staff', kind: 'write', confirm: true,
      say: 'Add someone to the staff list: their name, and an employee number if the owner uses them. The unit makes their sign-in code and shows it to the owner only - never ask for a code, never say one',
      params: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 40 }, employee_number: { type: 'string', maxLength: 20 } }, required: ['name'] },
      needs: ['roster'],
      build: (a, ctx) => {
        const roster = rosterWhole(ctx), name = String(a.name).trim().replace(/\s+/g, ' ').slice(0, 40);
        if (roster.some(s => lowerName(s.name) === lowerName(name))) throw new ActionError(`${name} is on the staff list already${roster.find(s => lowerName(s.name) === lowerName(name)).active === false ? ' (switched off - staff_signin_set lets them sign in again)' : ''}`);
        const emp = String(a.employee_number || '').trim();
        if (emp && roster.some(s => String(s.empNumber || '') === emp)) throw new ActionError(`employee number ${emp} is someone else's`);
        const code = freshCode(roster);
        return { op: 'http', method: 'POST', path: '/api/staff/roster', body: { staff: roster.concat([{ name, code, active: true, empNumber: emp }]) }, showOwner: [[`${name}'s sign-in code`, code]] };
      },
      describe: (a) => `Add ${String(a.name).trim()} to the staff list${a.employee_number ? ` (employee #${String(a.employee_number).trim()})` : ''} - the unit makes their sign-in code and shows it to you only` },
    { name: 'staff_details_set', area: 'staff', kind: 'write', confirm: true,
      say: 'Change a staff member on the staff list: their name or employee number (their code stays) - or give them a new sign-in code (made by the unit, shown to the owner only; their old one stops working)',
      params: { type: 'object', properties: { staff: { type: 'string', minLength: 1, maxLength: 60, description: 'their name now' }, name: { type: 'string', minLength: 1, maxLength: 40, description: 'their new name' },
        employee_number: { type: 'string', maxLength: 20 }, new_code: { type: 'boolean', description: 'true gives them a new sign-in code' } }, required: ['staff'] },
      needs: ['roster'],
      build: (a, ctx) => {
        const roster = rosterWhole(ctx), who = staffOf(roster, a.staff), show = [];
        if (a.name === undefined && a.employee_number === undefined && a.new_code !== true) throw new ActionError('say what to change: their name, their employee number, or a new sign-in code');
        const name = a.name !== undefined ? String(a.name).trim().replace(/\s+/g, ' ').slice(0, 40) : who.name;
        if (a.name !== undefined && roster.some(s => s !== who && lowerName(s.name) === lowerName(name))) throw new ActionError(`${name} is someone else on the staff list`);
        const emp = a.employee_number !== undefined ? String(a.employee_number).trim() : String(who.empNumber || '');
        if (emp && roster.some(s => s !== who && String(s.empNumber || '') === emp)) throw new ActionError(`employee number ${emp} is someone else's`);
        let code = String(who.code);
        if (a.new_code === true) { code = freshCode(roster); show.push([`${name}'s new sign-in code`, code]); }
        // (each row says the code it had, as the admin page does - so a new code carries the person's shifts, clock entries and requests
        // with it: routes/staff.js, services/staff.js codeMoves, Oct 25 2026)
        const list = roster.map(s => (s === who ? { name, code, active: s.active !== false, empNumber: emp, was: String(who.code) } : Object.assign({}, s, { was: String(s.code) })));
        // A NEW NAME AND A NEW CODE ARE TWO SAVES (Oct 25 2026, the adversarial review: "change Bob's name to Robert and give him a new
        // code" moved nothing - the roster route moves a code's rows only to the same person, and with the name changed and no employee
        // number codeMoves rightly cannot tell Robert from a new hire typed over Bob's row - while the card promised "their shifts and
        // hours stay theirs"). The owner named the person, so: the new name first, the code kept (nothing to move), then the new code
        // under that name, which carries every row with it. The code is shown with the second save, so a first save refused leaves
        // nothing changed and no code made that nobody saw
        if (a.new_code === true && lowerName(name) !== lowerName(who.name)) {
          const renamed = roster.map(s => (s === who ? { name, code: String(who.code), active: s.active !== false, empNumber: emp, was: String(who.code) } : Object.assign({}, s, { was: String(s.code) })));
          return { op: 'steps', steps: [{ op: 'http', method: 'POST', path: '/api/staff/roster', body: { staff: renamed } }, { op: 'http', method: 'POST', path: '/api/staff/roster', body: { staff: list }, showOwner: show }] };
        }
        return Object.assign({ op: 'http', method: 'POST', path: '/api/staff/roster', body: { staff: list } }, show.length ? { showOwner: show } : {});
      },
      describe: (a, ctx) => {
        const who = staffOf(rosterWhole(ctx), a.staff), what = [];
        if (a.name !== undefined) what.push(`their name to ${String(a.name).trim()}`);
        if (a.employee_number !== undefined) what.push(String(a.employee_number).trim() ? `their employee number to ${String(a.employee_number).trim()}` : 'their employee number taken off');
        if (a.new_code === true) what.push('a new sign-in code, made by the unit and shown to you only (the old one stops working; their shifts and hours stay theirs)');
        return `${who.name} on the staff list: ${what.join(', ')}`;
      } },
    { name: 'staff_signin_set', area: 'staff', kind: 'write', confirm: true,
      say: 'Stop a staff member signing in (they left or are away: their code stops working and their upcoming shifts become open shifts), or let them sign in again. They stay on the staff list, so past shifts and hours keep their name',
      params: { type: 'object', properties: { staff: { type: 'string', minLength: 1, maxLength: 60, description: 'their name' }, can_sign_in: { type: 'boolean' } }, required: ['staff', 'can_sign_in'] },
      needs: ['roster', 'opsShifts', 'opsClock'],
      build: (a, ctx) => {
        const p = signinChange(a, ctx);
        const list = ctx.roster.map(s => ({ name: String(s.name), code: String(s.code), active: s === p.person ? a.can_sign_in : s.active !== false, empNumber: String(s.empNumber || '') }));
        const steps = [{ op: 'http', method: 'POST', path: '/api/staff/roster', body: { staff: list } }]
          .concat(p.upcoming.map(sh => ({ op: 'http', method: 'POST', path: `/api/staff/schedule/shift/${sh.id}`, body: { staff_code: null } })));
        return steps.length === 1 ? steps[0] : { op: 'steps', steps };
      },
      describe: (a, ctx) => {
        const p = signinChange(a, ctx), n = p.person.name;
        if (a.can_sign_in) return `${n} can sign in again with their code (the staff pad and the time clock).`;
        return `${n} can no longer sign in to the staff pad or the time clock - their code stops working. They stay on the staff list (inactive), so past shifts and hours keep their name.`
          + (p.upcoming.length ? ` Their ${plural(p.upcoming.length, 'upcoming shift')} become${p.upcoming.length === 1 ? 's' : ''} open: ${p.upcoming.slice(0, 5).map(sh => `${dayWords(sh.date)} ${timeWords(sh.start_time)} - ${timeWords(sh.end_time)}`).join('; ')}${p.upcoming.length > 5 ? '; ...' : ''}.` : '')
          + (p.clockedIn ? ` ${n} is clocked in right now - clock them out too.` : '');
      } },
  ];

  // ── the pieces the actions above share ───────────────────────────────────────────────────────────────
  const lowerName = (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
  // the staff list as it is, every entry whole (a name and a 4-6 digit code) - or nothing is sent; codes stay in the request
  function rosterWhole(ctx) {
    const roster = ctx.roster || [];
    if (roster.some(s => !s || !String(s.name || '').trim() || !/^[0-9]{4,6}$/.test(String(s.code || '')))) throw new ActionError('the staff list could not be read whole just now - change it on Settings > Staff');
    return roster.map(s => ({ name: String(s.name), code: String(s.code), active: s.active !== false, empNumber: String(s.empNumber || '') }));
  }
  function staffOf(roster, ref) {
    const hit = roster.filter(s => nameMatches(s.name, ref));
    if (hit.length !== 1) throw new ActionError(hit.length ? `more than one on the staff list matches "${ref}": ${hit.map(s => s.name).join(', ')} - say which` : `"${ref}" is not on the staff list (on it: ${roster.map(s => s.name).join(', ') || 'nobody yet'})`);
    return hit[0];
  }
  // a sign-in code nobody has: four digits, never an easy one
  function freshCode(roster) {
    const used = new Set(roster.map(s => String(s.code)));
    const weak = (c) => /^(\d)\1{3}$/.test(c) || '0123456789'.includes(c) || '9876543210'.includes(c);
    for (let i = 0; i < 500; i++) { const c = String(require('crypto').randomInt(1000, 10000)); if (!used.has(c) && !weak(c)) return c; }
    throw new ActionError('no free four-digit code - give someone a code on Settings > Staff');
  }
  // the bay for a booking made at the counter: the one named, the only one, or - asked - the free ones
  // a package deal by its name (the Pricing tab's, routes/pricing.js) - for a booking made at the counter on a package
function pkgNamed(ctx, ref) {
  const list = ((ctx.packages || {}).packages || []).filter(p => p.active), n = String(ref || '').trim().toLowerCase();
  const hit = list.filter(p => p.name.toLowerCase() === n).concat(list.filter(p => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())));
  if (!hit.length) throw new ActionError(`there is no package called "${ref}"${list.length ? ' - the packages are ' + list.map(p => `"${p.name}"`).join(', ') : ''}`);
  return hit[0];
}
function makeBay(a, ctx) {
    const bk = (ctx.opsConfig || {}).booking || {};
    if (a.date < ctx.today) throw new ActionError(`${dayWords(a.date)} has passed`);
    if (!onGrid(a.time)) throw new ActionError(`sessions start on the hour or half hour - the next start is ${timeWords(nextGrid(a.time))}`);
    const lo = Number(bk.minSessionMins) || 30, hi = Number(bk.maxSessionMins) || 240;
    if (a.minutes % 30 || a.minutes < lo || a.minutes > hi) throw new ActionError(`a session here is ${lenWords(lo)} to ${lenWords(hi)}, in half hours`);
    if (a.phone.replace(/\D/g, '').length < 10) throw new ActionError('that phone number looks short - ask for the whole number with its area code');
    if (a.email && !EMAIL.test(a.email)) throw new ActionError(`"${a.email}" is not an email address`);
    const cand = Object.assign({ date: a.date, start_time: a.time }, endOf(a.date, a.time, a.minutes));
    const whole = !!bk.wholeFacility;
    let bay;
    if (whole) bay = activeBays(ctx)[0];
    else if (a.bay) { const p = bayPick(ctx, a.bay); if (p.whole) throw new ActionError('one booking takes one bay here - say which bay'); bay = (ctx.bays || []).find(b => b.id === p.id); }
    else if (activeBays(ctx).length === 1) bay = activeBays(ctx)[0];
    else {
      const free = activeBays(ctx).filter(b => !b.maintenance && !clashes(ctx, cand, { bayId: b.id }).length).map(b => b.name);
      const e = new ActionError(`which bay? ${free.length ? 'free then: ' + free.join(', ') : 'every bay is taken then'}`);
      // the box asks, the bays free then as the answers to tap (Oct 22 2026, the 4B on the laptop: a walk-in party on a package
      // stopped at the model's own "which bay would you like?" with nothing to tap)
      if (free.length) e.ask = { param: 'bay', question: `Which bay for ${a.name || 'them'}, ${dayWords(a.date)} at ${timeWords(a.time)}? Free then: ${free.join(', ')}.`, choices: free.slice(0, 8) };
      throw e;
    }
    if (!bay || bay.active === false) throw new ActionError('that bay is not in use - choose another');
    if (bay.maintenance && !whole) throw new ActionError(`${bay.name} is out of service`);
    const inWay = clashes(ctx, cand, { bayId: bay.id, whole });
    if (inWay.length) throw new ActionError(`${whole ? 'the facility' : bay.name} is taken then: ${inWay.slice(0, 4).join('; ')} - choose another time${whole ? '' : ' or bay'}`);
    return bay;
  }
  // where a booking moves to, checked the way the route will check it
  function moveOf(a, ctx) {
    if (!a.to_date && !a.to_time && !a.to_bay) throw new ActionError('say where it goes: a new day (to_date), a new start time (to_time) or another bay (to_bay)');
    const b = findBooking(ctx, a, ['active'], 'move');
    const date = a.to_date || b.date, time = a.to_time || b.start_time;
    if (date < ctx.today) throw new ActionError(`${dayWords(date)} has passed`);
    if (!onGrid(time)) throw new ActionError(`sessions start on the hour or half hour - the next start is ${timeWords(nextGrid(time))}`);
    let bayId = b.bay_id, bayName = b.bay_name;
    if (a.to_bay) {
      if (b.whole_facility) throw new ActionError('that booking takes the whole facility - it has no bay to change');
      const p = bayPick(ctx, a.to_bay);
      if (p.whole) throw new ActionError('a booking moves onto one bay - say which');
      if (!p.active) throw new ActionError(`${p.name} is not in use`);
      if (p.maintenance) throw new ActionError(`${p.name} is out of service`);
      bayId = p.id; bayName = p.name;
    }
    if (date === b.date && time === b.start_time && bayId === b.bay_id) throw new ActionError('that is where and when it is already');
    const end = endOf(date, time, b.minutes);
    const inWay = clashes(ctx, Object.assign({ date, start_time: time }, end), { bayId, whole: b.whole_facility, skipId: b.id });
    if (inWay.length) throw new ActionError(`${b.whole_facility ? 'the facility' : bayName} is taken then: ${inWay.slice(0, 4).join('; ')} - choose another time${b.whole_facility ? '' : ' or bay'}`);
    return { b, date, time, bayId, bayName, end };
  }
  // a block's window from the owner's words; "all day" is the opening day, worked out from the Hours card
  function blockWindow(a, ctx) {
    const where = bayPick(ctx, a.bay);
    if (!where.whole && where.active === false) throw new ActionError(`${where.name} is not in use`);
    if (a.date < ctx.today) throw new ActionError(`${dayWords(a.date)} has passed`);
    if (a.end_date && a.end_date < a.date) throw new ActionError('the last day is before the first');
    const b = (ctx.opsConfig || {}).booking || {};
    let s, e, ed = a.end_date || a.date;
    if (a.all_day) {
      if (b.open24Hours) { s = '00:00'; e = '00:00'; ed = addDays(ed, 1); }
      else { s = b.openTime || '05:00'; const close = b.closeTime || '23:30'; if (b.closeNextDay) { e = close; ed = addDays(ed, 1); } else e = close === '00:00' ? '23:59' : close; }
    } else {
      if (!a.start_time || !a.end_time) throw new ActionError('say the hours (from and until), or all day');
      s = a.start_time; e = a.end_time;
      if (!a.end_date && e <= s) ed = addDays(a.date, 1);   // 8 PM to 1 AM ends the next day
      else if (ed === a.date && e <= s) throw new ActionError('the block must end after it starts');
    }
    if (dayNo(ed) - dayNo(a.date) > 62) throw new ActionError('a block can span at most 62 days');
    const w = { where, date: a.date, start_time: s, end_date: ed, end_time: e };
    const inWay = clashes(ctx, w, { bayId: where.whole ? null : where.id, whole: !!where.whole });
    if (inWay.length) throw new ActionError(`${where.whole ? 'the facility' : where.name} already has ${inWay.length === 1 ? 'something' : 'things'} in that time: ${inWay.slice(0, 5).join('; ')}${inWay.length > 5 ? '; ...' : ''} - a block is refused over a customer's booking: cancel or move it first, or choose other hours`);
    return w;
  }
  function findBlock(a, ctx) {
    const L = ctx.opsBlocks || {};
    if (L.error) throw new ActionError(`the blocks could not be read just now (${L.error})`);
    let list = (L.list || []).filter(k => k.date <= a.date && (k.end_date || k.date) >= a.date);
    if (a.bay) { const p = bayPick(ctx, a.bay); list = list.filter(k => p.whole ? blockIsFacility(ctx, k) : (k.bay_id === p.id && !blockIsFacility(ctx, k))); }
    if (a.kind) list = list.filter(k => k.booking_type === a.kind);
    if (list.length === 1) return list[0];
    const say = (k) => `${k.booking_type} on ${blockIsFacility(ctx, k) ? 'the whole facility' : k.bay_name}, ${blockWhen(k)}${k.name ? ' ("' + k.name + '")' : ''}`;
    if (list.length > 1) throw new ActionError(`${list.length} blocks match - ask the owner which: ${list.slice(0, 6).map(say).join('; ')}`);
    const all = L.list || [];
    throw new ActionError(`no block covers ${dayWords(a.date)}${a.bay ? ' on ' + a.bay : ''}${a.kind ? ' (' + a.kind + ')' : ''}${all.length ? ' - the blocks from today: ' + all.slice(0, 6).map(say).join('; ') : ' - there are no blocks from today on'}`);
  }
  function shiftOf(a, ctx) {
    const S = offIf(ctx.opsShifts);
    const sh = (S.shifts || []).find(x => Number(x.id) === Number(a.shift_id));
    if (!sh) throw new ActionError(`shift #${a.shift_id} is not on the schedule between ${dayWords(S.from)} and ${dayWords(S.to)} - look at the schedule for its number`);
    return sh;
  }
  const untilOf = (t) => t === '00:00' ? '23:59' : t;   // "until midnight" is 23:59 in a season (admin.html schEditSeason(): "23:59 = midnight")
  function seasonDays(a, ctx) {
    const cov = offIf(ctx.opsCoverage);
    const t = a.season ? findSeason(cov, a.season) : (cov.templates || []).find(x => x.id === cov.activeId);
    if (!t) throw new ActionError(`no season is in use - name the season to change${(cov.templates || []).length ? ' (the seasons: ' + cov.templates.map(x => x.name).join(', ') + ')' : ', or make one in Settings > Schedule'}`);
    let s = '', e = '';
    if (a.staffed) {
      if (!!a.start_time !== !!a.end_time) throw new ActionError('give both the start and the end, or neither for all day');
      if (a.start_time) { s = a.start_time; e = untilOf(a.end_time); if (e <= s) throw new ActionError('in a season a staffed day ends by midnight (23:59) - hours after midnight go on the next day'); }
    }
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => { const d = (t.days || [])[i] || {}; return { dow: i, staffed: (d.staffed === 1 || d.staffed === true) ? 1 : 0, start: d.start || '', end: d.end || '' }; });
    for (const k of a.weekdays) { const i = KEYS.indexOf(k); days[i] = { dow: i, staffed: a.staffed ? 1 : 0, start: a.staffed ? s : '', end: a.staffed ? e : '' }; }
    return { t, days };
  }
  function restoreCheck(a, ctx) {
    const cov = offIf(ctx.opsCoverage), S = ctx.opsShifts || {};
    const t = (cov.templates || []).find(x => x.id === cov.activeId);
    if (!t) throw new ActionError('no season is in use, so a day has nothing to go back to - the Website\'s Staffed Days calendar decides: mark the day staffed or not instead');
    const inWindow = !S.off && S.from <= a.date && a.date <= S.to;
    const ex = inWindow ? (S.covExceptions || []).filter(x => x.date === a.date).slice(-1)[0] : null;
    if (inWindow && !ex) throw new ActionError(`${dayWords(a.date)} already follows the season "${t.name}" (${dayHours((t.days || [])[dowMon0(a.date)])})`);
    return { t, ex };
  }
  function patternWeek(a, ctx) {
    const P = offIf(ctx.opsPatterns), S = ctx.opsShifts || {};
    if ((P.list || []).some(p => String(p.name).toLowerCase() === a.name.toLowerCase())) throw new ActionError(`a pattern called "${a.name}" is saved already - choose another name`);
    const monday = mondayOf(a.week || ctx.today);
    let count = null;
    if (!S.off && S.from <= monday && addDays(monday, 6) <= S.to) {
      count = (S.shifts || []).filter(x => x.date >= monday && x.date <= addDays(monday, 6)).length;
      if (!count) throw new ActionError(`the week of ${dayWords(monday)} has no shifts to save`);
    }
    return { monday, count };
  }
  function findPattern(a, ctx) {
    const P = offIf(ctx.opsPatterns);
    const n = a.pattern.trim().toLowerCase();
    const list = P.list || [];
    const hit = list.filter(p => String(p.name).toLowerCase() === n);
    const some = hit.length ? hit : list.filter(p => String(p.name).toLowerCase().includes(n));
    if (some.length === 1) return some[0];
    throw new ActionError(`${some.length > 1 ? 'more than one pattern matches' : 'there is no pattern called'} "${a.pattern}" (the patterns: ${list.map(p => p.name).join(', ') || 'none saved yet'})`);
  }
  function onClockOf(a, ctx) {
    const C = offIf(ctx.opsClock);
    const hits = (C.onClock || []).filter(o => nameMatches(o.name, a.staff));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new ActionError(`more than one person on the clock matches "${a.staff}": ${hits.map(o => o.name).join(', ')} - say which`);
    throw new ActionError(`${a.staff} is not clocked in (on the clock now: ${(C.onClock || []).map(o => o.name).join(', ') || 'nobody'})`);
  }
  function flaggedOf(a, ctx) {
    const C = offIf(ctx.opsClock);
    const all = C.flagged || [];
    if (!all.length) throw new ActionError('no employee clock fixes are waiting for review');
    const list = all.filter(f => (!a.entry_id || Number(f.id) === Number(a.entry_id)) && (!a.staff || nameMatches(f.staff_name, a.staff)));
    if (list.length === 1) return list[0];
    throw new ActionError(`${list.length > 1 ? 'more than one fix matches' : 'no fix matches'} - waiting for review: ${all.map(f => `#${f.id} ${f.staff_name} ${stampWords(f.clock_in)}`).join('; ')}`);
  }
  // a clock entry's fix: the entry by its number, or by the person and the day; the new stamps as "YYYY-MM-DD HH:MM"
  // one clock entry, by its number or the person and the day - for taking it out
  function entryOnly(a, ctx) {
    const L = offIf(ctx.opsClockEntries);
    let list = L.list || [];
    if (a.entry_id) list = list.filter(e => Number(e.id) === Number(a.entry_id));
    else {
      if (!a.staff || !a.date) throw new ActionError('give the entry\'s number from clock_read, or the person and the day they clocked in');
      list = list.filter(e => nameMatches(entryName(e), a.staff) && String(e.clock_in).slice(0, 10) === a.date);
    }
    if (list.length !== 1) throw new ActionError(list.length ? `${a.staff} has ${list.length} clock entries that day - say which by its number: ${list.map(e => `#${e.id} ${stampWords(e.clock_in)}`).join('; ')}`
      : a.entry_id ? `no clock entry #${a.entry_id} in the last five weeks - look at clock_read for its number` : `${a.staff} has no clock entry on ${dayWords(a.date)}`);
    return list[0];
  }
  // the period the hours export holds for the owner's sign-off
  function heldPeriod(ctx) {
    const H = ctx.opsHoursSend || {};
    if (H.error) throw new ActionError(`the hours export could not be read (${H.error})`);
    if (!H.pending) throw new ActionError('no hours export is waiting for you - nothing to approve or skip');
    return H.pending;
  }
  function entryFix(a, ctx) {
    const L = offIf(ctx.opsClockEntries);
    let list = L.list || [];
    if (a.entry_id) list = list.filter(e => Number(e.id) === Number(a.entry_id));
    else {
      if (!a.staff || !a.date) throw new ActionError('give the entry\'s number from clock_read, or the person and the day they clocked in');
      list = list.filter(e => nameMatches(entryName(e), a.staff) && String(e.clock_in).slice(0, 10) === a.date);
    }
    if (list.length !== 1) throw new ActionError(list.length ? `${a.staff} has ${list.length} clock entries that day - say which by its number: ${list.map(e => `#${e.id} ${stampWords(e.clock_in)}`).join('; ')}`
      : a.entry_id ? `no clock entry #${a.entry_id} in the last five weeks - look at clock_read for its number` : `${a.staff} has no clock entry on ${dayWords(a.date)}`);
    const e = list[0];
    if (a.clock_in === undefined && a.clock_out === undefined && a.break_minutes === undefined && a.note === undefined && a.still_clocked_in !== true) throw new ActionError('say what to fix: the clock-in time, the clock-out time or the break minutes')
    // back on the clock (Oct 20 2026, late - the gap audit): only the person's latest entry, and only when nothing else of
    // theirs is open - their clock-out taken away, as if they never clocked out
    if (a.still_clocked_in === true) {
      if (!e.clock_out) throw new ActionError(`${entryName(e)} is still clocked in on that entry`);
      const theirs = (L.list || []).filter(x => entryName(x) === entryName(e));
      if (theirs.some(x => !x.clock_out)) throw new ActionError(`${entryName(e)} is clocked in already - one open entry at a time`);
      if (theirs.some(x => String(x.clock_in) > String(e.clock_in))) throw new ActionError(`that is not ${entryName(e)}'s latest entry - only the latest can be put back on the clock`);
    };
    const day = String(e.clock_in).slice(0, 10);
    const ci = a.clock_in !== undefined ? `${day} ${a.clock_in}` : String(e.clock_in).slice(0, 16);
    let co = e.clock_out ? String(e.clock_out).slice(0, 16) : null;
    if (a.clock_out !== undefined) co = `${a.clock_out <= ci.slice(11, 16) ? addDays(day, 1) : day} ${a.clock_out}`;
    if (a.still_clocked_in === true) co = null;
    if (co && co <= ci) throw new ActionError('the clock-out must be after the clock-in');
    if (co && co > `${ctx.today} ${ctx.time || '23:59'}`) throw new ActionError('that clock-out time has not come yet');
    const brk = a.break_minutes !== undefined ? a.break_minutes : (Number(e.break_minutes) || 0);
    const body = {};
    if (a.clock_in !== undefined) body.clock_in = ci;
    if (a.clock_out !== undefined) body.clock_out = co;
    if (a.still_clocked_in === true) body.clock_out = '';   // the route reads a blank clock-out as none (routes/staff.js:739)
    if (a.break_minutes !== undefined) body.break_minutes = a.break_minutes;
    if (a.note !== undefined) body.note = a.note;
    const hours = co ? Math.round(((absAt(co.slice(0, 10), co.slice(11, 16)) - absAt(ci.slice(0, 10), ci.slice(11, 16)) - brk) / 60) * 100) / 100 : null;
    return { e, body, ci, co, brk, hours };
  }
  function signinChange(a, ctx) {
    const roster = ctx.roster || [];
    // the list goes back whole: every entry must have come with its name and code, or nothing is sent
    if (roster.some(s => !s || !String(s.name || '').trim() || !/^[0-9]{4,6}$/.test(String(s.code || '')))) throw new ActionError('the staff list could not be read whole just now - change it on Settings > Staff');
    const person = rosterPerson(ctx, a.staff);
    if ((person.active !== false) === a.can_sign_in) throw new ActionError(`${person.name} ${a.can_sign_in ? 'can already sign in' : 'already cannot sign in'}`);
    const S = ctx.opsShifts || {}, now = nowAbs(ctx);
    const upcoming = a.can_sign_in || S.off ? [] : (S.shifts || []).filter(sh => String(sh.staff_code) === String(person.code) && absAt(sh.date, sh.start_time) > now)
      .sort((x, y) => (x.date + x.start_time).localeCompare(y.date + y.start_time));
    const clockedIn = !a.can_sign_in && ((ctx.opsClock || {}).onClock || []).some(o => String(o.code) === String(person.code));
    return { person, upcoming, clockedIn };
  }
  // a website address as the Contact card holds it: https:// in front of a bare name
  function websiteOf(w) {
    const s = String(w || '').trim();
    const u = /^https?:\/\//i.test(s) ? s : 'https://' + s;
    let ok = false; try { ok = /\./.test(new URL(u).hostname); } catch { ok = false; }
    if (!ok) throw new ActionError(`"${s}" is not a website address (like fairwaygolf.com)`);
    return u.replace(/\/+$/, '');
  }

  return { actions, loaders };
};
