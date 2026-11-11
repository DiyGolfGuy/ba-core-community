// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/money.js - the assistant's money and members actions (Oct 20 2026).
// Built with the helpers services/assistant/actions.js hands every area (HELPERS); same rules as the actions there.
//
// maintainer, Oct 20 2026: "they can set new prices for different days etc all of it". Every action here is a request the owner's
// own screens make (Pricing & Discounts, Members, the Gift Cards card, Revenue, End of Day), to the same route, so the
// route's own checks apply - and each is said back first, because each moves money or touches a customer, except whether
// slot prices show on the booking page (a look). Verified against the routes on Oct 20 2026; each action names its route
// by file:line. What the model is told never carries a member PIN, a gift card's code, or a customer's phone or email:
// members are named by first name and last initial, and the page's resultOf (public/assistant-apply.js:36) hands back
// only an id or 'ok' - the PIN a new member gets and the code a new gift card gets never reach the model.
'use strict';

module.exports = (H) => {
  const { ActionError, DATE, TIME, dayWords, timeWords, addDays } = H;

  // ── plain words ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const num = (v) => Number(v) || 0;
  const pad = (n) => String(n).padStart(2, '0');
  const dollars = (n) => { const v = Math.round(num(n) * 100) / 100; return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2).replace(/\.00$/, ''); };
  const cents = (c) => { const v = Math.round(num(c)) / 100; return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2); };
  const hours = (h) => `${num(h)} hour${num(h) === 1 ? '' : 's'}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const andList = (l) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);
  const toMins = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  // a time as the owner reads it; 23:59 (and 24:00) is how the price list says "until midnight"
  const clock = (t) => { const m = toMins(t); if (!Number.isFinite(m)) return `"${t}"`; if (m >= 1439) return 'midnight'; return timeWords(pad(Math.floor(m / 60)) + ':' + pad(m % 60)); };
  // a stored date or time (SQLite's UTC 'YYYY-MM-DD HH:MM:SS', an ISO string, or a plain date) as the facility's own
  // date - the unit's clock runs in the facility's zone (services/timezone.js)
  const localYmd = (ts) => { const s = String(ts || '').trim(); if (!s) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return isNaN(d) ? s.slice(0, 10) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  // a member as the AI may read them: the whole name on the box's own AI, the first name and last initial with the owner's own
  // AI service (services/assistant/privacy.js)
  const firstLast = (name) => { if (require('../privacy').full()) return require('../privacy').name(name, 'a member'); const p = String(name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return 'a member'; return p.length === 1 ? p[0] : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`; };
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  // a stored day list read the way the price list reads it (services/pricing.js:50 - split on commas, trimmed, lower
  // case); anything else in it never matches a day
  function dayList(str) { const parts = String(str || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean); return { keys: WEEK.filter(d => parts.includes(d)), bad: parts.filter(d => !WEEK.includes(d)) }; }
  function daysWords(keys) {
    const s = WEEK.filter(d => (keys || []).includes(d));
    if (!s.length) return 'no days';
    if (s.length === 7) return 'every day';
    const runs = [];
    s.forEach(d => { const i = WEEK.indexOf(d), last = runs[runs.length - 1]; if (last && WEEK.indexOf(last[1]) === i - 1) last[1] = d; else runs.push([d, d]); });
    return runs.map(([a, b]) => a === b ? DAY_LABEL[a] : WEEK.indexOf(b) - WEEK.indexOf(a) === 1 ? `${DAY_LABEL[a]}, ${DAY_LABEL[b]}` : `${DAY_LABEL[a]}-${DAY_LABEL[b]}`).join(', ');
  }
  // THE DAYS AS THE OWNER SAYS THEM, read here and never guessed (Oct 20 2026): helpers.normDays reads "mon-fri" as Monday
  // alone, and ["friday and saturday"] or ["fri, sat"] as Friday alone - for a price that is a silent money mistake. So
  // the money actions take the days as words and read ranges ("mon-thu", "monday through friday"), lists ("fri, sat",
  // "friday and saturday"), weekdays, weekends and every day; anything else is refused, never dropped.
  const DAY_WORD = { mon: 'mon', monday: 'mon', tue: 'tue', tues: 'tue', tuesday: 'tue', wed: 'wed', weds: 'wed', wednesday: 'wed', thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu', fri: 'fri', friday: 'fri', sat: 'sat', saturday: 'sat', sun: 'sun', sunday: 'sun' };
  const dayKey = (w) => { const x = String(w || '').replace(/\.$/, ''); return DAY_WORD[x] || (x.endsWith('s') ? DAY_WORD[x.slice(0, -1)] : null) || null; };
  function parseDays(v) {
    const text = String(Array.isArray(v) ? v.join(', ') : (v == null ? '' : v)).trim();
    const s = text.toLowerCase()
      .replace(/\b(every ?days?|daily|all week|all days|seven days|7 days)\b/g, ' everyday ')
      .replace(/\s*(?:-|–|—|\bthrough\b|\bthru\b|\bto\b|\buntil\b|\btill\b)\s*/g, '-')
      .replace(/\b(and|or|plus)\b/g, ',');
    const out = new Set(), bad = () => new ActionError(`"${text}" is not days I can read - say them like "fri, sat", "mon-thu", "weekdays", "weekends" or "every day"`);
    for (const tok of s.split(/[\s,&/+]+/).map(x => x.trim()).filter(Boolean)) {
      if (['on', 'the', 'only', 'each', 'every', 'night', 'nights', 'evening', 'evenings', 'morning', 'mornings', 'afternoon', 'afternoons'].includes(tok)) continue;
      if (tok === 'everyday') { WEEK.forEach(d => out.add(d)); continue; }
      if (tok === 'weekday' || tok === 'weekdays') { WEEK.slice(0, 5).forEach(d => out.add(d)); continue; }
      if (tok === 'weekend' || tok === 'weekends') { out.add('sat'); out.add('sun'); continue; }
      const range = tok.split('-').filter(Boolean);
      if (range.length === 2 && dayKey(range[0]) && dayKey(range[1])) {
        let i = WEEK.indexOf(dayKey(range[0])); const j = WEEK.indexOf(dayKey(range[1]));
        for (let k = 0; k < 7; k++) { out.add(WEEK[i]); if (i === j) break; i = (i + 1) % 7; }
        continue;
      }
      if (range.length === 1 && dayKey(range[0])) { out.add(dayKey(range[0])); continue; }
      throw bad();
    }
    if (!out.size) throw bad();
    return WEEK.filter(d => out.has(d));
  }
  const DAYS_PARAM = { type: 'string', minLength: 2, maxLength: 80, description: 'the days in words, like "weekdays", "fri, sat", "mon-thu", "weekends" or "every day"' };
  const perHalf = (p) => `${dollars(p)} a half hour (${dollars(num(p) * 2)} an hour)`;
  // "until midnight": the price list compares minutes on the booking's own day (services/pricing.js:54), so an end of
  // 00:00 would never match; 23:59 covers the 11:30 PM half hour, and the website reads 23:59 as the end of the day
  // (public/landing.html allDay) - 24:00 would print as "12:00 PM" there (landing.html fmt12)
  const endTime = (t) => (t === '00:00' ? '23:59' : t);
  const PAST_MIDNIGHT = 'a price window has to end after it starts, on the same day. For one that runs past midnight, add two: one until midnight, and one from midnight on the next days (for Friday and Saturday nights, the second one is on Saturday and Sunday)';

  // ── the price list (Pricing & Discounts > Time-Based Pricing Tiers; the owner hears "price windows") ─────────────────
  // GET /api/pricing/tiers (routes/pricing.js:77) answers every window in sort_order - the order the price check walks
  // them, first match wins (services/pricing.js:36-57); a half hour no window covers costs the base price.
  function windowOf(r, i) {
    const d = dayList(r.days), s = toMins(r.start_time), e = toMins(r.end_time);
    return { id: String(r.id), name: String(r.name || '(no name)'), idx: i, order: num(r.sort_order), on: Number(r.active) === 1,
      days: d.keys, bad: d.bad, s, e, ok: d.keys.length > 0 && Number.isFinite(s) && Number.isFinite(e) && e > s, price: num(r.price_per_half_hour), row: r };
  }
  const windowsOf = (ctx) => (Array.isArray(ctx.money_windows) ? ctx.money_windows : []).map(windowOf);
  const whenOf = (w) => `${daysWords(w.days)}, ${clock(w.row.start_time)} - ${clock(w.row.end_time)}`;
  const overlaps = (a, b) => a.ok && b.ok && a.days.some(d => b.days.includes(d)) && a.s < b.e && b.s < a.e;
  const area = (w) => w.days.length * (w.e - w.s);
  const inside = (b, n) => b.days.every(d => n.days.includes(d)) && b.s >= n.s && b.e <= n.e && area(b) < area(n);
  const ahead = (a, b) => a.order < b.order || (a.order === b.order && a.idx < b.idx);   // a is checked before b
  const names = (list) => andList(list.map(w => `"${w.name}"`));
  const basePrice = (ctx) => num(ctx.money_booking && ctx.money_booking.base) || 15;   // services/pricing.js:43 (|| 15)
  // WHERE A NEW WINDOW SITS (first match wins): inside its own days and times the new price applies, except where an
  // existing window lies wholly inside it (an exception the owner already made - a happy hour inside a weekday rate),
  // which keeps its own price; outside its days and times nothing changes. A = the windows it must beat, B = those inside it.
  function placeWindow(list, n) {
    const touching = list.filter(w => w.on && overlaps(w, n));
    const B = touching.filter(w => inside(w, n)), A = touching.filter(w => !inside(w, n));
    let x = 0; const moves = [];
    if (A.length || B.length) {
      const hiB = B.length ? Math.max(...B.map(w => w.order)) : null, loA = A.length ? Math.min(...A.map(w => w.order)) : null;
      if (!A.length) x = hiB + 1;
      else if (!B.length) x = loA - 1;
      else if (hiB + 1 < loA) x = hiB + 1;
      else if (hiB < loA) x = (hiB + loA) / 2;
      else {
        // the windows inside it sit level with or after one it must beat: they move just ahead of it, keeping their own
        // order - they lie inside the new window, so nothing outside it changes
        x = loA - 1;
        const bs = B.slice().sort((p, q) => (ahead(p, q) ? -1 : 1));
        bs.forEach((w, i) => { const to = x - bs.length + i; if (to !== w.order) moves.push({ w, to }); });
      }
    }
    return { x, A, B, moves };
  }
  const WINDOW_FIELDS = ['name', 'days', 'start_time', 'end_time', 'price_per_half_hour', 'sort_order', 'active'];   // routes/pricing.js:97-100 replaces all of these
  const windowMerge = (id, set) => ({ op: 'merge', get: '/api/pricing/tiers', find: ['id', id], fields: WINDOW_FIELDS, set, put: '/api/pricing/tiers/' + encodeURIComponent(id) });
  function findWindow(ctx, words) {
    const list = windowsOf(ctx), n = norm(words);
    let hit = list.filter(w => norm(w.name) === n);
    if (hit.length > 1) throw new ActionError(`more than one price window is called "${words}" - change or delete it on the Pricing screen (Pricing & Discounts)`);
    if (!hit.length) hit = list.filter(w => norm(w.name).includes(n) || (n.length > 3 && n.includes(norm(w.name))));
    if (hit.length === 1) return hit[0];
    throw new ActionError(`${hit.length ? 'more than one price window matches' : 'no price window called'} "${words}" (the windows: ${list.map(w => w.name).join(', ') || 'none yet - everything costs the base price'})`);
  }
  // the price as the owner said it: per half hour (what the list keeps) or per hour
  function priceOf(a, optional) {
    const half = a.price_per_half_hour, hour = a.price_per_hour;
    if (half === undefined && hour === undefined) { if (optional) return undefined; throw new ActionError('what does it cost? Give the price per half hour, or per hour'); }
    if (half !== undefined && hour !== undefined && Math.abs(half * 2 - hour) > 0.001) throw new ActionError(`$${half} a half hour is not $${hour} an hour - give the price one way`);
    const p = Math.round((half !== undefined ? half : hour / 2) * 100) / 100;
    // routes/pricing.js:86 refuses a price of 0 ("All fields required"); a free window is not something the list can hold
    if (!(p > 0)) throw new ActionError('a price window needs a price above $0 - to keep people from booking a time, block it off instead');
    return p;
  }
  // what a price change means for bookings already made: a booking paid online keeps its price; one settled at the door
  // is priced again at check-in from the windows then (services/checkin.js:219 and :309 call calculatePrice at check-in)
  const madeNote = (ctx) => ((ctx.money_booking || {}).style === 'unmanned' ? ' Bookings already made keep their price.'
    : ' Bookings already paid keep their price; anything still to pay at the door is worked out at check-in with the prices then.');
  // what a change to a window sends: the fields that change (its place in the list too, when it is made to win), and the
  // windows lying wholly inside it that move ahead of it to keep their own price - the same rule as a new window
  function changePlan(ctx, w, a) {
    const set = {};
    if (a.new_name && norm(a.new_name) !== norm(w.name)) {
      if (windowsOf(ctx).some(x => x.id !== w.id && norm(x.name) === norm(a.new_name))) throw new ActionError(`there is already a price window called "${a.new_name}"`);
      set.name = a.new_name;
    }
    if (a.days !== undefined) set.days = parseDays(a.days).join(',');
    if (a.start_time || a.end_time) {
      const s = a.start_time || w.row.start_time, e = a.end_time ? endTime(a.end_time) : w.row.end_time;
      if (!(toMins(e) > toMins(s))) throw new ActionError(PAST_MIDNIGHT);
      if (a.start_time) set.start_time = s;
      if (a.end_time) set.end_time = e;
    }
    const p = priceOf(a, true); if (p !== undefined) set.price_per_half_hour = p;
    const nw = windowOf(Object.assign({}, w.row, set), w.idx);
    let moves = [];
    if (a.wins) {
      if (!w.on) throw new ActionError(`"${w.name}" is switched off, so it never applies`);
      if (!nw.ok) throw new ActionError(`"${w.name}"'s days or times are not understood - fix them first`);
      const plan = placeWindow(windowsOf(ctx).filter(x => x.id !== w.id), nw);
      if (!(plan.A.every(x => ahead(nw, x)) && plan.B.every(x => ahead(x, nw)))) { set.sort_order = plan.x; nw.order = plan.x; moves = plan.moves; }
    }
    return { set, nw, moves };
  }

  // ── discount codes (Pricing & Discounts > Discount Codes) ─────────────────────────────────────────────────────────────
  // GET /api/pricing/codes (routes/pricing.js:114) answers EVERY row of discount_codes - gift cards too (services/gifts.js
  // stores them there as type 'gift', with the recipient's email in the description). A gift card's code is spendable by
  // whoever reads it, so gift rows never leave this file.
  const codeGives = (c) => {
    const v = num(c.value);
    if (c.type === 'percentage') return v >= 100 ? 'a free booking (100% off)' : `${v}% off a booking`;
    if (c.type === 'fixed') return `${dollars(v)} off a booking`;
    if (c.type === 'free_minutes') return `${v} free minutes`;
    // services/pricing.js:250-271 knows only these three (and gift): any other kind takes nothing off at checkout
    return `"${c.type}" - not a kind the checkout understands, so it takes nothing off`;
  };
  // when it stops: the checkout's own test, new Date(expires_at) < now (services/pricing.js:213). A date-only expiry (what
  // the Pricing screen's date box saves) is midnight UTC - the evening BEFORE that date in the US - so the moment is said
  const codeEnds = (c) => {
    if (!c.expires_at) return { words: 'never expires', over: false };
    const d = new Date(c.expires_at);
    if (isNaN(d)) return { words: `its expiry "${c.expires_at}" is not a date the checkout can read`, over: false };
    const when = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return d < new Date() ? { words: `expired ${when}`, over: true } : { words: `works until ${when}`, over: false };
  };
  const NO_LIMIT = 9999;   // uses per person that stand for "no limit" (see discount_code_create)
  // a code's uses per person: as said; a rate checked at the door every visit; any other code once
  const perPerson = (a) => a.per_person !== undefined ? a.per_person : a.check_at_door ? 0 : 1;
  // the group a rate is for, in the owner's words (typed as they type: "militery", "vets")
  const rateGroupOf = (w) => { const t = String(w || '').toLowerCase();
    return /\bmilit[ae]ry\b|\bsoldiers?\b/.test(t) ? 'military' : /\bveterans?\b|\bvets?\b/.test(t) ? 'veteran' : /\bseniors?\b|\belderly\b/.test(t) ? 'senior'
      : /\bstudents?\b|\bcollege\b/.test(t) ? 'student' : /\bteachers?\b|\beducators?\b/.test(t) ? 'teacher' : /\bfirst responders?\b/.test(t) ? 'first responder'
      : /\bpolice\b|\bcops?\b/.test(t) ? 'police' : /\bfire ?fighters?\b|\bfiremen\b/.test(t) ? 'firefighter' : /\bnurses?\b/.test(t) ? 'nurse' : ''; };
  // A RATE FOR A GROUP SAID PLAINLY (the 4B walk in maintainer's own typing, Oct 23 2026: "militery get 15% off they show id" answered in words
  // twice - "first, let me confirm the details" - and nothing made): the plainest shape is the box's own call, put up as the card the
  // owner approves: a group, an amount (or "too" right after a code was made), checked by the group's own ID at the door
  const RATE_WORD = { military: 'MILITARY', veteran: 'VETERAN', senior: 'SENIOR', student: 'STUDENT', teacher: 'TEACHER', 'first responder': 'RESPONDER', police: 'POLICE', firefighter: 'FIRE', nurse: 'NURSE' };
  // each group's own words, as rateGroupOf reads them (to tell one group from two)
  const GROUP_SAID = { military: /\bmilit[ae]ry\b|\bsoldiers?\b/, veteran: /\bveterans?\b|\bvets?\b/, senior: /\bseniors?\b|\belderly\b/, student: /\bstudents?\b|\bcollege\b/,
    teacher: /\bteachers?\b|\beducators?\b/, 'first responder': /\bfirst responders?\b/, police: /\bpolice\b|\bcops?\b/, firefighter: /\bfire ?fighters?\b|\bfiremen\b/, nurse: /\bnurses?\b/ };
  function codeRead(words, conv, ctx) {
    const s = String(words || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
    if (/\?/.test(s) || s.split(/\s+/).length > 20 || /^(?:how|what|why|when|where|who|which|do|does|did|is|are|can|could|should|would)\b/.test(s)) return null;
    const g = rateGroupOf(s); if (!g) return null;
    // (two groups named - "teachers and nurses 15% off" - are two codes: this read made the first and dropped the second; the model's,
    // Oct 27 2026)
    if (Object.values(GROUP_SAID).filter(re => re.test(s)).length > 1) return null;
    const pct = /(\d{1,3})\s*(?:%|percent|pct)/.exec(s), usd = /\$\s?(\d{1,4})\b|\b(\d{1,4})\s*(?:dollars|bucks)\b/.exec(s), lc = conv && conv.lastCode;
    const same = !pct && !usd && lc && /\b(?:too|to|also|as well|same)\b/.test(s);
    // (no amount said - "make a code for teachers they show id": put up with none, so the box asks "How many percent off for
    // teachers?" - the 4B answered it with an access-control menu, the walk, Oct 23 2026)
    const asking = !pct && !usd && !same && /\b(?:codes?|rates?|discounts?|deals?|off)\b/.test(s);
    if (!pct && !usd && !same && !asking) return null;
    const kind = pct ? 'percentage' : usd ? 'fixed' : same ? lc.kind : 'percentage', value = pct ? Number(pct[1]) : usd ? Number(usd[1] || usd[2]) : same ? lc.value : 0;
    const taken = new Set((ctx.money_codes || []).map(c => String(c.code).toUpperCase()));
    let code = RATE_WORD[g] + (value || ''); for (let n = 2; taken.has(code) && n < 10; n++) code = RATE_WORD[g] + (value || '') + '-' + n;
    return { code, kind, value, check_at_door: `a${/^[aeiou]/.test(g) ? 'n' : ''} ${g} ID`, description: g[0].toUpperCase() + g.slice(1) + ' rate' };
  }
  // a code's amount in the owner's words: the number itself, "half off", "free" for a free booking
  const amountSaid = (a, w) => { const v = Number(a.value);
    // (a number inside a code's name - "TEACHER15" - is not an amount said: $15 and 15% are different codes)
    return new RegExp('(?:^|[^\\w.])\\$?' + String(v).replace('.', '\\.') + '(?![\\d])').test(w) || (v === 50 && /\bhalf (?:off|price)\b/i.test(w))
      || (v === 100 && a.kind === 'percentage' && /\bfree\b/i.test(w)) || (a.kind === 'free_minutes' && v === 30 && /\bhalf (?:an )?hour\b/i.test(w)) || (a.kind === 'free_minutes' && v === 60 && /\b(?:an|one|1) hour\b/i.test(w)); };
  function findCode(ctx, words) {
    const want = String(words || '').trim().toUpperCase();
    const rows = Array.isArray(ctx.money_codes) ? ctx.money_codes : [];
    const hit = rows.find(c => String(c.code).toUpperCase() === want);
    if (hit && hit.type === 'gift') throw new ActionError('that is a gift card, not a discount code - a gift card is switched off with gift_card_switch_off, by the last four characters of its code');
    if (hit) return hit;
    throw new ActionError(`no discount code "${words}" (the codes: ${rows.filter(c => c.type !== 'gift').map(c => c.code + (c.active ? '' : ' (off)')).join(', ') || 'none yet'})`);
  }

  // ── membership tiers (Members > Tiers) ──────────────────────────────────────────────────────────────────────────────
  const tierSettle = (t) => (t.settlement_mode === 'door' || t.settlement_mode === 'deposit') ? t.settlement_mode : (t.deposit_mode ? 'deposit' : 'online');   // routes/members.js:677
  const afterWords = (t) => {
    const v = num(t.over_limit_discount_value);
    if (t.over_limit_discount_type === 'flat_rate') return `${dollars(v)} a half hour (${dollars(v * 2)} an hour)`;
    if (t.over_limit_discount_type === 'percentage') return `${v}% off the regular price`;
    if (t.over_limit_discount_type === 'fixed') return `${dollars(v)} off each booking`;
    return 'the regular price';
  };
  // what members get, the way the price check reads the tier: free time first on the Free Hours and blended styles
  // (services/pricing.js isMeterTier/meterFor :458-471, computeBlend :403), the hour limits as walls on the percentage
  // and fixed styles (memberEligibility :631), a flat rate in place of the price (:147, :484)
  function tierPriceWords(t) {
    const type = t.discount_type || 'percentage', v = num(t.discount_value);
    const hpd = num(t.hours_per_day), hpw = num(t.hours_per_week), hpm = num(t.hours_per_month);
    if (type === 'free_hours') {
      const month = hpm > 0 ? Math.min(hpm, v) : v;
      const spread = [hpd > 0 && `at most ${hours(hpd)} a day`, hpw > 0 && `${hours(hpw)} a week`].filter(Boolean);
      return `${hours(month)} free a month${spread.length ? ' (' + spread.join(', ') + ')' : ''}, then ${afterWords(t)}`;
    }
    if (type === 'daily_blend') {
      const allow = [hpd > 0 && `${hours(hpd)} free a day`, hpw > 0 && `up to ${hours(hpw)} a week`, hpm > 0 && `up to ${hours(hpm)} a month`].filter(Boolean);
      return allow.length ? `${allow.join(', ')}, then ${afterWords(t)}` : `no free time set, so every hour is ${afterWords(t)}`;
    }
    if (type === 'flat_rate') return tierSettle(t) === 'deposit' ? `a deposit of ${dollars(v)} a half hour online, the rest settled at the door` : `${dollars(v)} a half hour (${dollars(v * 2)} an hour) in place of the regular price`;
    const base = type === 'fixed' ? (v > 0 ? `${dollars(v)} off each booking` : 'no discount') : (v >= 100 ? 'free play (100% off)' : v > 0 ? `${v}% off` : 'no discount');
    const lim = [hpd > 0 && `${hours(hpd)} a day`, hpw > 0 && `${hours(hpw)} a week`, hpm > 0 && `${hours(hpm)} a month`].filter(Boolean);
    return lim.length ? `${base} for up to ${lim.join(', ')}, then ${afterWords(t)}` : base;
  }
  const tierPrice = (t) => { const m = num(t.price_monthly), y = num(t.price_annual); return m > 0 && y > 0 ? `${dollars(m)} a month or ${dollars(y)} a year` : m > 0 ? `${dollars(m)} a month` : y > 0 ? `${dollars(y)} a year` : 'no price set'; };
  const tierWhen = (t) => { const d = dayList(t.allowed_days).keys; const days = d.length && d.length < 7 ? daysWords(d) : 'any day'; return t.earliest_time && t.latest_time ? `${days}, sessions starting from ${clock(t.earliest_time)} and before ${clock(t.latest_time)}` : `${days}, any time`; };
  const guestType = (t) => { try { return require('../../guests').effectiveGuestType(t); } catch { return t.guest_pricing_type || 'free'; } };   // services/guests.js:54
  const tierGuests = (t) => {
    if (!t.guest_allowed) return 'no guests';
    const cap = num(t.guest_max_per_visit) > 0 ? `up to ${plural(num(t.guest_max_per_visit), 'guest')} a visit` : 'guests welcome (no cap per visit)';
    const g = guestType(t), val = num(t.guest_pricing_value);
    const pays = g === 'free' ? 'guests play free' : g === 'flat' ? `guests pay ${dollars(val)} each` : g === 'percentage' ? `guests pay their share of the bay less ${val}%` : 'guests pay their share of the bay at the counter';
    return `${cap}; ${pays} (the full guest rules are on the Members screen)`;
  };
  // a tier in plain words - also what tiers_read in actions.js could hand the model (its digest reads a Free Hours tier
  // as "$N off" and 0 free hours: see the report)
  function tierWords(t) {
    return { tier: t.name, price: tierPrice(t), members_get: tierPriceWords(t), when: tierWhen(t), guests: tierGuests(t),
      settles: { online: 'charged online at booking', deposit: 'a deposit online, the rest at the door', door: 'nothing online - settled at the door' }[tierSettle(t)],
      sold_online: !!t.sell_online, active_members: num(t.roster_count), retired: Number(t.active) === 1 ? undefined : true };
  }
  const tiersOf = (ctx) => (Array.isArray(ctx.money_member_tiers) ? ctx.money_member_tiers : []);
  function findTier(ctx, words) {
    const list = tiersOf(ctx), n = norm(words);
    let hit = list.filter(t => norm(t.name) === n);
    if (hit.length > 1) { const on = hit.filter(t => Number(t.active) === 1); if (on.length === 1) return on[0]; }
    if (!hit.length) hit = list.filter(t => norm(t.name).includes(n) || (n.length > 3 && n.includes(norm(t.name))));
    if (hit.length === 1) return hit[0];
    throw new ActionError(`${hit.length ? 'more than one membership tier matches' : 'no membership tier called'} "${words}" (the tiers: ${list.map(t => t.name + (Number(t.active) === 1 ? '' : ' (retired)')).join(', ') || 'none yet'})`);
  }
  // PUT /api/members/tiers/:id REPLACES the tier (routes/members.js:187-241): every field it reads goes back as it is
  const TIER_FIELDS = ['name', 'description', 'badge_color', 'discount_type', 'discount_value', 'hours_per_day', 'hours_per_week', 'hours_per_month',
    'allowed_days', 'earliest_time', 'latest_time', 'allowed_bays', 'booking_window_days', 'guest_allowed', 'guest_max_per_visit',
    'guest_passes_per_month', 'guest_pricing_type', 'guest_pricing_value', 'sort_order', 'active', 'max_active_bookings', 'price_monthly',
    'price_annual', 'grace_days', 'roster_cap', 'sell_online', 'over_limit_discount_type', 'over_limit_discount_value', 'guest_overflow_price',
    'guest_pricing_basis', 'deposit_mode', 'share_discount_pct', 'codes_included', 'settlement_mode', 'deposit_per30', 'food_discount_type',
    'food_discount_value', 'beverage_discount_type', 'beverage_discount_value', 'guest_included_per_visit', 'guest_collect'];
  // ── a tier's style, guests and rules as the tier editor saves them (Oct 21 2026) ──
  const STYLE_OF = { percentage: 'discount', fixed: 'discount', free_hours: 'free_hours', daily_blend: 'daily_free', flat_rate: 'flat_rate' };
  function tierStyleSet(t, a) {
    const was = STYLE_OF[t.discount_type || 'percentage'] || 'discount', style = a.style || was, same = style === was;
    const keep = (k) => same ? num(t[k]) : 0;
    const lim = (said, k) => said != null ? said : keep(k);
    const set = {};
    if (style === 'discount') {
      if (a.percent_off != null && a.dollars_off != null) throw new ActionError('a percent off or dollars off each booking - not both');
      if (a.dollars_off != null) Object.assign(set, { discount_type: 'fixed', discount_value: a.dollars_off });
      else if (a.percent_off != null) Object.assign(set, { discount_type: 'percentage', discount_value: a.percent_off });
      else if (!same) throw new ActionError('a discount style needs the percent off (or dollars off each booking)');
      Object.assign(set, { hours_per_day: lim(a.limit_hours_a_day, 'hours_per_day'), hours_per_week: lim(a.limit_hours_a_week, 'hours_per_week'), hours_per_month: lim(a.limit_hours_a_month, 'hours_per_month') });
    } else if (style === 'free_hours') {
      if (a.free_hours_a_month != null) { if (!(a.free_hours_a_month > 0)) throw new ActionError('free hours a month must be more than 0 - for none, use the discount style'); set.discount_value = a.free_hours_a_month; }
      else if (!same) throw new ActionError('how many free hours a month?');
      Object.assign(set, { discount_type: 'free_hours', hours_per_day: lim(a.limit_hours_a_day, 'hours_per_day'), hours_per_week: lim(a.limit_hours_a_week, 'hours_per_week'), hours_per_month: 0 });
    } else if (style === 'daily_free') {
      const d = a.free_hours_a_day != null ? a.free_hours_a_day : (same ? num(t.hours_per_day) : null);
      if (!(d > 0)) throw new ActionError('how many free hours each day?');
      Object.assign(set, { discount_type: 'daily_blend', discount_value: 0, hours_per_day: d, hours_per_week: lim(a.limit_hours_a_week, 'hours_per_week'), hours_per_month: lim(a.limit_hours_a_month, 'hours_per_month') });
    } else {
      const r = a.flat_rate_per_hour != null ? a.flat_rate_per_hour : (same ? num(t.discount_value) * 2 : null);
      if (!(r > 0)) throw new ActionError('the flat rate an hour members pay?');
      Object.assign(set, { discount_type: 'flat_rate', discount_value: Math.round(r / 2 * 100) / 100, hours_per_day: 0, hours_per_week: 0, hours_per_month: 0, over_limit_discount_type: '', over_limit_discount_value: 0 });
    }
    if (style !== 'flat_rate' && a.after) {
      if (a.after === 'regular') Object.assign(set, { over_limit_discount_type: '', over_limit_discount_value: 0 });
      else if (!(a.after_value > 0)) throw new ActionError(a.after === 'percent_off' ? 'the percent off past the free time or limits?' : 'the flat rate an hour past the free time or limits?');
      else if (a.after === 'percent_off') { if (a.after_value > 100) throw new ActionError('a percent off is at most 100'); Object.assign(set, { over_limit_discount_type: 'percentage', over_limit_discount_value: a.after_value }); }
      else Object.assign(set, { over_limit_discount_type: 'flat_rate', over_limit_discount_value: Math.round(a.after_value / 2 * 100) / 100 });
    } else if (style !== 'flat_rate' && !same && !a.after) Object.assign(set, { over_limit_discount_type: '', over_limit_discount_value: 0 });
    return set;
  }
  function tierGuestSet(t, a) {
    const set = { guest_pricing_type: guestType(t) };
    if (a.guests_allowed === false) return Object.assign(set, { guest_allowed: false });
    if (a.guests_allowed === true || a.max_per_visit != null || a.included_per_visit != null || a.passes_a_month != null || a.covered_guests_pay) set.guest_allowed = true;
    if (a.max_per_visit != null) set.guest_max_per_visit = a.max_per_visit;
    if (a.included_per_visit != null) set.guest_included_per_visit = a.included_per_visit;
    if (a.passes_a_month != null) set.guest_passes_per_month = a.passes_a_month;
    const cap = a.max_per_visit != null ? a.max_per_visit : num(t.guest_max_per_visit), inc = a.included_per_visit != null ? a.included_per_visit : num(t.guest_included_per_visit);
    if (cap > 0 && inc > cap) throw new ActionError(`${inc} guests covered each visit is more than the ${cap} a visit allows`);
    if (a.covered_guests_pay) {
      const T = { free: 'free', share: 'share', flat: 'flat', percent_off: 'percentage' }[a.covered_guests_pay];
      if ((T === 'flat' || T === 'percentage') && !(a.covered_value > 0)) throw new ActionError(T === 'flat' ? 'the fee each covered guest pays?' : 'the percent off a covered guest\'s share?');
      if (T === 'percentage' && a.covered_value > 100) throw new ActionError('a percent off is at most 100');
      Object.assign(set, { guest_pricing_type: T, guest_pricing_value: T === 'flat' || T === 'percentage' ? a.covered_value : 0 });
    }
    if (a.after_passes_price != null) set.guest_overflow_price = a.after_passes_price;
    if (a.charged) set.guest_pricing_basis = a.charged === 'per_hour' ? 'hour' : 'booking';
    if (a.collected) set.guest_collect = { with_the_golf: 'auto', online: 'online', at_the_counter: 'door' }[a.collected];
    if (Object.keys(set).length === 1 && !a.covered_guests_pay) throw new ActionError('say what to change about the guests');
    return set;
  }
  function tierRuleSet(t, a, ctx) {
    const set = {};
    if (a.member_cap != null) set.roster_cap = a.member_cap;
    if (a.max_upcoming_bookings != null) set.max_active_bookings = a.max_upcoming_bookings;
    if (a.book_days_ahead != null) set.booking_window_days = a.book_days_ahead;
    if (a.bays) {
      const all = a.bays.some(b => /^(all|every|any)( bays?)?$/i.test(String(b).trim()));
      if (all) set.allowed_bays = '';
      else { const bays = ctx.bays || []; set.allowed_bays = a.bays.map(nm => { const b = bays.find(x => norm(x.name) === norm(nm)) || bays.find(x => norm(x.id) === norm(nm)); if (!b) throw new ActionError(`no bay called "${nm}" (the bays: ${bays.map(x => x.name).join(', ')})`); return b.id; }).join(','); }
    }
    if (a.settles) { set.settlement_mode = a.settles; set.deposit_mode = a.settles === 'deposit' ? 1 : 0; }
    if (a.deposit_per_half_hour != null) set.deposit_per30 = a.deposit_per_half_hour;
    const settleNow = a.settles || tierSettle(t);
    if (settleNow === 'deposit' && !(num(a.deposit_per_half_hour != null ? a.deposit_per_half_hour : t.deposit_per30) > 0)) throw new ActionError('a deposit tier needs its deposit a half hour');
    if (a.family_codes != null) set.codes_included = a.family_codes;
    if (a.grace_days != null) set.grace_days = a.grace_days;
    const perk = (off, v, tk, vk, what) => {
      if (!off) return;
      if (off === 'none') { set[tk] = ''; set[vk] = 0; return; }
      if (!(v > 0)) throw new ActionError(`how much off ${what}?`);
      if (off === 'percent' && v > 100) throw new ActionError('a percent off is at most 100');
      set[tk] = off === 'percent' ? 'percent' : 'fixed'; set[vk] = v;
    };
    perk(a.food_off, a.food_value, 'food_discount_type', 'food_discount_value', 'food');
    perk(a.drink_off, a.drink_value, 'beverage_discount_type', 'beverage_discount_value', 'drinks');
    return set;
  }
  // the free hours and the discount beyond them, the way membership_tier_create builds them (free time first, rule 3) -
  // only where the change cannot quietly alter something else about how the tier is priced
  function tierPricing(t, a) {
    const F = a.free_hours_a_month, P = a.discount_percent;
    if (F === undefined && P === undefined) return {};
    const type = t.discount_type || 'percentage', v = num(t.discount_value);
    const walls = num(t.hours_per_day) > 0 || num(t.hours_per_week) > 0 || num(t.hours_per_month) > 0;
    const olT = t.over_limit_discount_type || '', olV = num(t.over_limit_discount_value);
    const editor = `change it on the Members screen (Tiers > Edit), so nothing else about how "${t.name}" is priced changes by accident`;
    const beyond = (p) => (p > 0 ? { over_limit_discount_type: 'percentage', over_limit_discount_value: p } : { over_limit_discount_type: '', over_limit_discount_value: 0 });
    if (type === 'flat_rate') throw new ActionError(`"${t.name}" charges members a flat rate (${tierPriceWords(t)}) - ${editor}`);
    if (type === 'daily_blend') {
      if (F !== undefined) throw new ActionError(`"${t.name}" counts free time by the day (${tierPriceWords(t)}) - ${editor}`);
      return beyond(P);
    }
    if (type === 'free_hours') {
      if (F === 0) {
        // free hours taken away: the discount beyond them becomes the whole discount, and the hour limits (which spread
        // the free time) go - on the percentage style they would be walls
        let dt = 'percentage', dv = 0;
        if (P !== undefined) dv = P;
        else if (olT === 'percentage') dv = olV;
        else if (olT === 'fixed') { dt = 'fixed'; dv = olV; }
        else if (olT === 'flat_rate') throw new ActionError(`"${t.name}" charges ${afterWords(t)} after its free hours - ${editor}`);
        return { discount_type: dt, discount_value: dv, hours_per_day: 0, hours_per_week: 0, hours_per_month: 0, over_limit_discount_type: '', over_limit_discount_value: 0 };
      }
      const set = {};
      // a monthly cap below the new number would hold it lower (meterFor takes the smaller), so it moves with it
      if (F !== undefined) { set.discount_value = F; if (num(t.hours_per_month) > 0) set.hours_per_month = F; }
      if (P !== undefined) Object.assign(set, beyond(P));
      return set;
    }
    if (F !== undefined && F > 0) {
      if (walls || olT) throw new ActionError(`"${t.name}" gives ${tierPriceWords(t)} - adding free hours would change how those limits work; ${editor}`);
      const b = P !== undefined ? beyond(P) : v > 0 ? { over_limit_discount_type: type === 'fixed' ? 'fixed' : 'percentage', over_limit_discount_value: v } : beyond(0);
      return Object.assign({ discount_type: 'free_hours', discount_value: F, hours_per_day: 0, hours_per_week: 0, hours_per_month: 0 }, b);
    }
    if (P !== undefined) return { discount_type: 'percentage', discount_value: P };
    throw new ActionError(`"${t.name}" has no free hours to take away (members get ${tierPriceWords(t)})`);
  }

  // ── members (Members > Members) ─────────────────────────────────────────────────────────────────────────────────────
  const membersOf = (ctx) => (Array.isArray(ctx.money_members) ? ctx.money_members : []);
  const ref = (m) => String(m.id).slice(0, 6);
  const who = (m) => firstLast(m.name);
  const groupOf = (ctx, m) => membersOf(ctx).filter(k => k.group_of && k.group_of === m.id);
  const primaryOf = (ctx, m) => (m.group_of ? membersOf(ctx).find(p => p.id === m.group_of) : null);
  // who "Brian" is: the full name, then the way the assistant names members ("Brian S."), then the first name - and the
  // #number a list gave, when two share a name. `prefer` picks among several (an active member for a suspension)
  function findMember(ctx, words, prefer) {
    const all = membersOf(ctx), raw = String(words || '').trim();
    const no = (raw.match(/#\s*([0-9a-z][0-9a-z-]{3,11})/i) || [])[1];
    if (no) {
      const hit = all.filter(m => String(m.id).toLowerCase().startsWith(no.toLowerCase()));
      if (hit.length === 1) return hit[0];
      if (!hit.length) throw new ActionError(`no member has the number #${no} - look them up again with members_read`);
    }
    const n = norm(raw.replace(/#\s*[0-9a-z][0-9a-z-]{3,11}/i, ''));
    if (!n) throw new ActionError('which member? Say their name');
    const pick = (list) => { if (list.length < 2 || !prefer) return list; const p = list.filter(prefer); return p.length ? p : list; };
    const many = (list) => new ActionError(`more than one member matches "${raw}": ${list.slice(0, 6).map(m => `${who(m)} #${ref(m)} (${m.tier_name || 'no tier'}, ${m.status}, joined ${m.joined || '?'})`).join('; ')} - ask the owner which one, then use its #number`);
    const tries = [
      (m) => norm(m.name) === n,
      (m) => { const f = n.match(/^(\S+)\s+([a-z])\.?$/); if (!f) return false; const p = norm(m.name).split(' '); return p.length > 1 && p[0] === f[1] && p[p.length - 1][0] === f[2]; },
      (m) => !n.includes(' ') && norm(m.name).split(' ')[0] === n,
    ];
    for (const t of tries) { const hit = pick(all.filter(t)); if (hit.length === 1) return hit[0]; if (hit.length > 1) throw many(hit); }
    throw new ActionError(`no member called "${raw}" - check the spelling, or look them up with members_read`);
  }
  // PUT /api/members/:id REPLACES the member (routes/members.js:530-579): these go back as they are. The PIN is never
  // sent (the route keeps it when none comes: pin=COALESCE(?,pin)), so a PIN never rides a request from here either.
  const MEMBER_FIELDS = ['tier_id', 'name', 'phone', 'email', 'status', 'notes'];
  const memberMerge = (id, set, extra) => ({ op: 'merge', get: '/api/members', find: ['id', id], fields: MEMBER_FIELDS.concat(extra || []), set, put: '/api/members/' + encodeURIComponent(id) });
  const steps = (list) => (list.length === 1 ? list[0] : { op: 'steps', steps: list });
  const billingWords = (m) => (m.billed ? `billed ${m.cadence === 'annual' ? 'yearly' : 'monthly'} online` : 'added by hand (not billed online)');
  const doorNote = (ctx) => ((ctx.money_booking || {}).memberDoor ? ' and at the door' : '');
  const tierOn = (ctx, id) => { const t = tiersOf(ctx).find(x => String(x.id) === String(id)); return t ? Number(t.active) === 1 : true; };
  const tierName = (ctx, id) => { const t = tiersOf(ctx).find(x => String(x.id) === String(id)); return t ? t.name : 'its tier'; };
  const codeNote = (ctx, m, what) => { const p = primaryOf(ctx, m); return p ? ` (one code on ${who(p)}'s group membership - only this code ${what})` : ''; };
  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '').trim());
  const phoneOk = (p) => String(p || '').replace(/\D/g, '').length >= 10;

  // ── periods for the money reads ─────────────────────────────────────────────────────────────────────────────────────
  // A DAY THAT HAS BEEN (Oct 20 2026): helpers.normDate reads a weekday name as the NEXT one and has no "yesterday" - right
  // for a shift, wrong for "how did the counter do Friday?". The reads that look back read a weekday as the latest one,
  // today included ("last friday" on a Friday is a week ago).
  const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function pastDate(v, today, what) {
    const s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s === 'today' || s === 'tonight') return today;
    if (s === 'yesterday' || s === 'last night') return addDays(today, -1);
    const m = s.match(/^(?:(last|this|on|past) )?([a-z]+)$/), w = m ? WEEKDAY_NAMES.findIndex(n => n === m[2] || n.slice(0, 3) === m[2]) : -1;
    if (w >= 0) { const cur = new Date(today + 'T12:00:00Z').getUTCDay(); let back = (cur - w + 7) % 7; if (back === 0 && m[1] === 'last') back = 7; return addDays(today, -back); }
    throw new ActionError(`"${v}" is not a date I can read for ${what} - give it as YYYY-MM-DD`);
  }
  const PAST_DATE = { type: 'string', maxLength: 20, description: 'a date as YYYY-MM-DD (today, yesterday and a weekday name - the latest one - are understood too)' };
  // a week is Monday to Sunday, as the members' weekly limits count it (services/pricing.js weekBounds)
  const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'last_7_days', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year'];
  const mondayOf = (d) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
  function rangeOf(a, today) {
    if (a.from || a.to) {
      const from = a.from ? pastDate(a.from, today, 'the start') : null, to = a.to ? pastDate(a.to, today, 'the end') : today;
      if (!from) return [to, to];   // one end only: that day
      if (to < from) throw new ActionError('the end of the range is before its start');
      return [from, to];
    }
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    switch (a.period || 'this_month') {
      case 'today': return [today, today];
      case 'yesterday': { const d = addDays(today, -1); return [d, d]; }
      case 'this_week': return [mondayOf(today), today];
      case 'last_week': { const mon = addDays(mondayOf(today), -7); return [mon, addDays(mon, 6)]; }
      case 'last_7_days': return [addDays(today, -6), today];
      case 'last_month': return [`${m === 1 ? y - 1 : y}-${pad(m === 1 ? 12 : m - 1)}-01`, addDays(today.slice(0, 8) + '01', -1)];
      case 'this_quarter': return [`${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, today];
      case 'last_quarter': { const q0 = Math.floor((m - 1) / 3) * 3 + 1, start = q0 === 1 ? `${y - 1}-10-01` : `${y}-${pad(q0 - 3)}-01`; return [start, addDays(`${y}-${pad(q0)}-01`, -1)]; }
      case 'this_year': return [`${y}-01-01`, today];
      case 'last_year': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
      default: return [today.slice(0, 8) + '01', today];
    }
  }
  const spanWords = (f, t) => (!f ? undefined : f === t ? dayWords(f) : `${dayWords(f)} - ${dayWords(t)}`);

  // ── what the actions read first (actions.js LOADERS; the engine runs each once a turn) - named money_* so another
  //    area's loader of the same name can never replace one (actions.js merges every area's loaders into one map) ──
  // the review's rows as one list: comps and voids off a tab, and refunds (at the counter, or found in Stripe)
  const reviewItems = (j) => ((j && j.rows) || []).map(r => ({ id: r.id, kind: r.comp ? 'comp' : 'void', what: r.name, amount_cents: Math.round((Number(r.unit_price_cents) || 0) * (Number(r.qty) || 1)), who: r.void_by || '', why: r.void_reason || '', tab: r.tab_label || r.bay_name || '', reviewed: !!r.reviewed }))
    .concat(((j && j.refunds) || []).map(r => ({ id: r.id, kind: 'refund', what: `${r.method || ''} refund`.trim(), amount_cents: (Number(r.amount_cents) || 0) + (Number(r.tip_cents) || 0), who: r.employee || '', why: r.reason || '', tab: r.tab_label || r.bay_name || '', reviewed: !!r.reviewed, failed: r.status === 'error' || r.status === 'failed' })));
  const reviewSay = (x) => ({ what: x.kind === 'refund' ? x.what : `${x.kind} of ${x.what}`, amount: cents(x.amount_cents), who: x.who || undefined, why: x.why || undefined, tab: x.tab || undefined, signed_off: x.reviewed, not_given_back: x.failed || undefined });
  function reviewPick(ctx, a) {
    const R = (ctx.reviewDays || {})[a.day === 'yesterday' ? 'yesterday' : 'today'];
    if (!R || R.error) throw new ActionError(`the review could not be read just now${R && R.error ? ' (' + R.error + ')' : ''} - try again in a moment`);
    let list = reviewItems(R).filter(x => !x.reviewed);
    if (!list.length) throw new ActionError(`nothing from ${a.day === 'yesterday' ? 'yesterday' : 'today'} is waiting to be signed off`);
    if (a.item) {
      const n = String(a.item).trim().toLowerCase(), hit = list.filter(x => String(x.what).toLowerCase().includes(n) || String(x.why).toLowerCase().includes(n));
      if (hit.length !== 1) throw new ActionError(hit.length ? `${hit.length} match "${a.item}" - say which, or sign them all off` : `no comp, void or refund waiting matches "${a.item}" (waiting: ${list.map(x => reviewSay(x).what).join(', ')})`);
      list = hit;
    }
    return list;
  }
  const loaders = {
    // today's and yesterday's review (routes/pos.js:145) - what a sign-off is checked against
    reviewDays: async (ctx) => {
      const day = (d) => ctx.call('GET', `/api/pos/review?date=${d}`).then(r => (r.status === 200 ? r.json : { error: 'it answered ' + r.status })).catch(e => ({ error: String((e && e.message) || e).slice(0, 120) }));
      const y = new Date(Date.parse(ctx.today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
      const [today, yesterday] = await Promise.all([day(ctx.today), day(y)]);
      return { today, yesterday };
    },
    // the price list, in the order it is checked (routes/pricing.js:77)
    money_windows: async (ctx) => { try { const r = await ctx.call('GET', '/api/pricing/tiers'); return Array.isArray(r.json) ? r.json : []; } catch { return []; } },
    // every code, gift cards included, ONLY so a new code's name is checked free and a code is found by its words; a gift
    // row keeps no description (it holds the recipient's email) and is never shown
    money_codes: async (ctx) => { try { const r = await ctx.call('GET', '/api/pricing/codes'); return (Array.isArray(r.json) ? r.json : []).map(c => ({ id: c.id, code: String(c.code || ''), type: c.type, value: c.value, active: Number(c.active) === 1, uses_count: num(c.uses_count), max_uses: c.max_uses, expires_at: c.expires_at || null, description: c.type === 'gift' ? '' : (c.description || '') })); } catch { return []; } },
    // gift cards, to switch one off by the end of its code (routes/gifts.js:92); the codes stay in here
    money_gifts: async (ctx) => { try { const r = await ctx.call('GET', '/api/gifts/admin/list'); return (Array.isArray(r.json) ? r.json : []).map(g => ({ id: g.id, code: String(g.code || ''), active: !!g.active, balance_cents: num(g.balance_cents), initial_cents: num(g.initial_cents) })); } catch { return []; } },
    // the membership tiers with how many active members each has (routes/members.js:98)
    money_member_tiers: async (ctx) => { try { const r = await ctx.call('GET', '/api/members/tiers'); return Array.isArray(r.json) ? r.json : []; } catch { return []; } },
    // the members, kept to what the actions need - never a PIN; a phone number and an email only on the box's own AI
    // (services/assistant/privacy.js; routes/members.js:324 answers all three); whether there is an email on file is kept as yes or no, for "they are emailed"
    money_members: async (ctx) => { try { const r = await ctx.call('GET', '/api/members'); return (Array.isArray(r.json) ? r.json : []).map(m => ({ id: String(m.id), name: String(m.name || ''), tier_id: m.tier_id || '', tier_name: m.tier_name || '', status: m.status || 'active', joined: localYmd(m.created_at), billed: !!m.stripe_subscription_id, cadence: m.billing_cadence || '', sub_status: m.sub_status || '', period_end: localYmd(m.current_period_end), ending: !!m.cancel_at_period_end, group_of: m.parent_member_id || '', has_email: !!String(m.email || '').trim() , ...require('../privacy').contact(m)})); } catch { return []; } },
    // the settings the money actions depend on (GET /api/admin/config, routes/admin.js:98 - secrets come masked; only a
    // yes or no about email is kept)
    money_booking: async (ctx) => {
      try {
        const r = await ctx.call('GET', '/api/admin/config'); const c = r.json || {}, b = c.booking || {};
        const raw = String(b.accessStyle || '').trim().toLowerCase();   // services/staffing.js:41 accessStyleOf
        const style = raw === 'staffed' ? 'staffed' : raw === 'hybrid' ? 'hybrid' : (raw === 'unmanned' || raw === 'codes') ? 'unmanned' : (b.staffedAccess ? 'staffed' : 'unmanned');
        return { style, membersOnly: !!b.membersOnly, depositMode: b.depositMode || 'off', depositPer30: b.depositPer30 == null ? 10 : num(b.depositPer30), base: num(b.pricePerHalfHour) || 15,
          showSlotPrices: b.showSlotPrices !== false, wholeFacility: !!b.wholeFacility, scheduleOff: !!(c.coverage && c.coverage.scheduleOff === true),
          emailReady: !!(c.resend && c.resend.apiKey && c.resend.fromEmail), waiversOn: ((c.waiver && c.waiver.mode) || 'required') !== 'off',
          memberDoor: String((c.doorAccess || {}).provider || '') === 'unifi' && !!(c.unifiAccess && c.unifiAccess.memberAccess && c.unifiAccess.memberAccess.enabled),
          bayAdjust: b.wholeFacility ? [] : (Array.isArray(c.bays) ? c.bays : []).filter(x => x && parseInt(x.priceAdjustCents, 10)).map(x => ({ bay: x.name, cents: parseInt(x.priceAdjustCents, 10) })) };
      } catch { return {}; }
    },
  };

  const MEMBER_PARAM = { type: 'string', minLength: 1, maxLength: 80, description: 'the member\'s name (as the owner says it, or as a list gave it, like "Brian S." - add its #number when two share a name)' };
  const TIER_PARAM = { type: 'string', minLength: 1, maxLength: 60, description: 'the membership tier\'s name' };
  const refused = (r) => ({ error: `that answered ${r ? r.status : 'nothing'}${r && r.json && r.json.error ? ': ' + r.json.error : ''}`, routeSaid: true });

  const sameWindow = (ctx, a, days, e) => { const list = windowsOf(ctx);
    return list.find(w => norm(w.name) === norm(a.name)) || list.find(w => String(w.days || '').split(',').sort().join() === days.slice().sort().join() && w.start_time === a.start_time && endTime(w.end_time) === e) || null; };
  const asChange = (a, w) => Object.assign({ window: w.name, days: a.days, start_time: a.start_time, end_time: a.end_time }, a.price_per_hour !== undefined ? { price_per_hour: a.price_per_hour } : {}, a.price_per_half_hour !== undefined ? { price_per_half_hour: a.price_per_half_hour } : {});
  const windowChange = () => actions.find(x => x.name === 'price_window_change');
  const actions = [
    // ═══ PRICES: the price list ═══════════════════════════════════════════════════════════════════════════════════════
    // GET /api/pricing/tiers (routes/pricing.js:77, owner only); the check that uses them: services/pricing.js:36
    { name: 'price_windows_read', area: 'money', kind: 'read', needs: ['money_booking'],
      say: 'Look at the booking prices: the base price and every price window (days, times and price per half hour, like a weekend or happy hour rate), in the order they are checked',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/pricing/tiers' }),
      digest: (j, ctx) => {
        const list = (Array.isArray(j) ? j : []).map(windowOf), on = list.filter(w => w.on), bk = ctx.money_booking || {};
        const out = {
          how_prices_work: 'Each half hour of a booking costs the price of the FIRST window in this list that covers its day and start time; a half hour no window covers costs the base price. Member prices are worked out from these.',
          base_price: perHalf(basePrice(ctx)),
          windows: list.length ? list.map(w => {
            const o = { window: w.name, when: whenOf(w), price: perHalf(w.price) };
            if (!w.on) o.note = 'switched off - it never applies';
            else if (!w.ok) o.note = w.days.length ? 'its times are not understood (it must end after it starts, as HH:MM), so it never applies - fix it with price_window_change' : `its days ("${w.row.days}") are not understood, so it never applies - fix it with price_window_change`;
            else {
              const first = on.filter(x => x !== w && ahead(x, w) && overlaps(x, w)), notes = [];
              if (w.bad.length) notes.push(`"${w.bad.join(', ')}" in its days is not understood, so it does not apply then`);
              // every half hour it covers, on every one of its days: is an earlier window there first?
              let all = true;
              for (const d of w.days) for (let t = Math.ceil(w.s / 30) * 30; t < w.e; t += 30) if (!first.some(x => x.days.includes(d) && x.s <= t && t < x.e)) all = false;
              if (first.length && all) notes.push(`it NEVER applies: ${names(first)} come${first.length === 1 ? 's' : ''} first and cover${first.length === 1 ? 's' : ''} all of it - price_window_change with wins fixes that`);
              else if (first.length) notes.push(`where ${names(first)} also cover${first.length === 1 ? 's' : ''} it, ${first.length === 1 ? 'that one comes' : 'they come'} first and win${first.length === 1 ? 's' : ''}`);
              if (notes.length) o.note = notes.join('; ');
            }
            return o;
          }) : 'none - every half hour costs the base price',
          slot_prices_on_booking_page: bk.membersOnly ? 'no - a members-only club shows the public no prices; members see their own after their code' : bk.showSlotPrices !== false,
        };
        if (bk.wholeFacility) out.whole_facility = 'these are the prices for the whole facility, not one bay';
        if ((bk.bayAdjust || []).length) out.bay_adjustments = bk.bayAdjust.map(x => `${x.bay}: ${x.cents > 0 ? '+' : ''}${cents(x.cents)} a half hour when a customer picks that bay`);
        return out;
      } },
    // POST /api/pricing/tiers (routes/pricing.js:83 - name, days, start_time, end_time and a price above 0 required;
    // sort_order optional; answers { success, id }); a window that must move ahead of it: PUT /api/pricing/tiers/:id
    // (routes/pricing.js:95, replaces the record - op 'merge')
    // A BAY PRICE FOR SET HOURS SAID PLAINLY (the 4B walk in maintainer's own typing, Oct 23 2026: "happy hr weekdays 2-5 its 15 a half hr"
    // was read as 3 to 5:30 and asked back, nothing made): days, an hour range and a price a half hour or an hour - the box's own
    // call, put up as the card the owner approves; anything less plain is the model's
    // (the window of that name, or one over the same days and hours, and the add said as a change of it)
    { name: 'price_window_add', area: 'money', kind: 'write', confirm: true, needs: ['money_windows', 'money_booking'],
      read: (words) => {
        const s = String(words || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
        if (/\?/.test(s) || s.split(/\s+/).length > 25 || /^(?:ok(?:ay)?,?\s+|so,?\s+|and\s+|also,?\s+)?(?:how|what|why|when|where|who|which|do|does|did|is|are|was|were|will|would|should|could|can)\b/.test(s) || /\b(?:members?|package|deal|code|tier|special)\b/.test(s)) return null;
        // A PRICE FOR SOMETHING ELSE IS NOT THE BAY'S (Oct 27 2026, the review of round 2: "lessons are $60 an hour saturdays 9 to noon" and a
        // karaoke room's price were each put up as a price window - the price of the BAYS for those hours): a price said of lessons, a
        // coach, a class, karaoke, a room, a party, an event, food or drink is never read here - the model's, or the owner's answer to it
        if (/\b(?:lessons?|coach\w*|instruct\w*|teach\w*|class(?:es)?|clinics?|camps?|karaoke|rooms?|lounge|part(?:y|ies)|events?|leagues?|tournaments?|rentals?|rent|clubs?|fittings?|food|drinks?|beers?|pitchers?|menu|wings|tacos|pizza|lane|lanes|darts?|pool|billiards?|axe|cornhole|ping ?pong)\b/.test(s)) return null;
        const p = /\$?\s?(\d+(?:\.\d\d)?)\s*(?:dollars|bucks)?\s*(?:a|an|per|\/)\s*(half[- ]hour|30 minutes|hour)\b/.exec(s); if (!p) return null;
        const r = H.rangeIn(s), days = H.daysIn(s, true); if (!r || !days) return null;
        const DN = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
        const name = /happy hour/.test(s) ? 'Happy hour' : days.length === 1 ? DN[days[0]] + ' price' : days.length === 5 && !days.includes('sat') ? 'Weekday price' : days.length === 2 && days.includes('sat') && days.includes('sun') ? 'Weekend price' : 'Set hours price';
        return Object.assign({ name, days: days.join(','), start_time: r.from, end_time: r.to }, /half|30/.test(p[2]) ? { price_per_half_hour: Number(p[1]) } : { price_per_hour: Number(p[1]) });
      },
      say: 'Add a price window: a price for certain days and hours, like "Friday and Saturday 6 PM to midnight is $30 a half hour" or "happy hour weekdays 2 to 5 is $15". Get the days, the from and to times and the price first - a NEW window only: a window that is there already (its price, days or times) is changed with price_window_change, never added again',
      params: { type: 'object', properties: {
        name: { type: 'string', minLength: 2, maxLength: 40, description: 'a short name, like "Weekend nights" or "Happy hour"' },
        days: DAYS_PARAM,
        start_time: { ...TIME, description: 'when it starts, HH:MM' }, end_time: { ...TIME, description: 'when it ends, HH:MM (00:00 for midnight)' },
        price_per_half_hour: { type: 'number', minimum: 0, maximum: 1000, description: 'dollars per half hour' },
        price_per_hour: { type: 'number', minimum: 0, maximum: 2000, description: 'dollars per hour - instead of per half hour, if that is how the owner said it' } },
        required: ['name', 'days', 'start_time', 'end_time'] },
      build: (a, ctx) => {
        const days = parseDays(a.days), price = priceOf(a), e = endTime(a.end_time);
        if (!(toMins(e) > toMins(a.start_time))) throw new ActionError(PAST_MIDNIGHT);
        const list = windowsOf(ctx);
        // A WINDOW THAT IS THERE ALREADY IS CHANGED, never refused (the walk in maintainer's typing, Oct 23 2026: "happy hr weekdays 2-5 its 15 a
        // half hr" with a happy hour set up was refused "there is already a price window called Happy hour"): one of that name, or one
        // over the same days and hours, takes what was said - the card says what it was
        const was = sameWindow(ctx, a, days, e);
        if (was) return windowChange().build(asChange(a, was), ctx);
        const plan = placeWindow(list, { days, s: toMins(a.start_time), e: toMins(e), ok: true });
        const post = { op: 'http', method: 'POST', path: '/api/pricing/tiers', body: { name: a.name, days: days.join(','), start_time: a.start_time, end_time: e, price_per_half_hour: price, sort_order: plan.x } };
        return steps([post].concat(plan.moves.map(m => windowMerge(m.w.id, { sort_order: m.to }))));
      },
      describe: (a, ctx) => {
        const days = parseDays(a.days), price = priceOf(a), e = endTime(a.end_time);
        { const was = sameWindow(ctx, a, days, e); if (was) return windowChange().describe(asChange(a, was), ctx); }
        const plan = placeWindow(windowsOf(ctx), { days, s: toMins(a.start_time), e: toMins(e), ok: true });
        let t = `New price window "${a.name}": ${daysWords(days)}, ${clock(a.start_time)} - ${clock(e)}, ${perHalf(price)}.`;
        if (plan.A.length) t += ` Where it overlaps ${names(plan.A)}, this price wins.`;
        if (plan.B.length) t += ` Inside it, ${names(plan.B)} keep${plan.B.length === 1 ? 's its' : ' their'} own price${plan.moves.length ? ' (moved up the list to keep that)' : ''}.`;
        if (!plan.A.length && !plan.B.length) t += ` Those times cost the base price (${dollars(basePrice(ctx))} a half hour) until now.`;
        return t + madeNote(ctx);
      } },
    // PUT /api/pricing/tiers/:id (routes/pricing.js:95) REPLACES name, days, start_time, end_time, price_per_half_hour,
    // sort_order and active - op 'merge' with the list from GET /api/pricing/tiers
    { name: 'price_window_change', area: 'money', kind: 'write', confirm: true, needs: ['money_windows', 'money_booking'],
      say: 'Change a price window: its price, days, times or name, or make it win where it overlaps another window (read the windows first for their names). Everything not mentioned stays as it is - for a window that is there already (read them first: price_windows_read); a new one is price_window_add',
      params: { type: 'object', properties: {
        window: { type: 'string', minLength: 1, maxLength: 40, description: 'the window\'s name now' },
        price_per_half_hour: { type: 'number', minimum: 0, maximum: 1000 }, price_per_hour: { type: 'number', minimum: 0, maximum: 2000, description: 'instead of per half hour, if that is how the owner said it' },
        days: DAYS_PARAM, start_time: TIME, end_time: { ...TIME, description: 'HH:MM (00:00 for midnight)' },
        new_name: { type: 'string', minLength: 2, maxLength: 40 },
        wins: { type: 'boolean', description: 'true to make this window\'s price win where it overlaps others (a window lying wholly inside it still keeps its own)' } }, required: ['window'] },
      build: (a, ctx) => {
        const w = findWindow(ctx, a.window), plan = changePlan(ctx, w, a), set = plan.set;
        if (!Object.keys(set).length && !plan.moves.length) throw new ActionError(a.wins ? `"${w.name}" already wins where it overlaps other windows` : 'say what to change: the price, the days, the times or the name');
        return steps((Object.keys(set).length ? [windowMerge(w.id, set)] : []).concat(plan.moves.map(m => windowMerge(m.w.id, { sort_order: m.to }))));
      },
      describe: (a, ctx) => {
        const w = findWindow(ctx, a.window), plan = changePlan(ctx, w, a), nw = plan.nw, set = plan.set, parts = [];
        if (set.price_per_half_hour !== undefined) parts.push(`${perHalf(set.price_per_half_hour)} (was ${dollars(w.price)} a half hour)`);
        if (set.days !== undefined || set.start_time !== undefined || set.end_time !== undefined) parts.push(`${whenOf(nw)} (was ${whenOf(w)})`);
        if (set.name !== undefined) parts.push(`renamed "${set.name}"`);
        if (a.wins) parts.push('it moves up the list so its price wins where it overlaps others');
        let t = `Change the price window "${w.name}": ${parts.join('; ')}.`;
        if (!w.on) return t + ' It is switched off, so it still does not apply.';
        const others = windowsOf(ctx).filter(x => x.id !== w.id && x.on && overlaps(x, nw));
        const moved = new Map(plan.moves.map(m => [m.w.id, m.to]));
        const after = (x) => Object.assign({}, x, moved.has(x.id) ? { order: moved.get(x.id) } : {});
        const before = others.filter(x => ahead(after(x), nw)), loses = others.filter(x => !ahead(after(x), nw));
        if (before.length) t += ` Where ${names(before)} also cover${before.length === 1 ? 's' : ''} it, ${before.length === 1 ? 'that one comes' : 'they come'} first and win${before.length === 1 ? 's' : ''}.`;
        if (loses.length) t += ` It wins over ${names(loses)} where they overlap.`;
        return t + madeNote(ctx);
      } },
    // DELETE /api/pricing/tiers/:id (routes/pricing.js:106) - a hard delete of the row
    { name: 'price_window_remove', area: 'money', kind: 'write', confirm: true, needs: ['money_windows', 'money_booking'],
      say: 'Delete a price window for good, so its days and times go back to the base price (or to another window that covers them)',
      params: { type: 'object', properties: { window: { type: 'string', minLength: 1, maxLength: 40, description: 'the window\'s name' } }, required: ['window'] },
      build: (a, ctx) => { const w = findWindow(ctx, a.window); return { op: 'http', method: 'DELETE', path: '/api/pricing/tiers/' + encodeURIComponent(w.id) }; },
      describe: (a, ctx) => {
        const w = findWindow(ctx, a.window);
        const rest = windowsOf(ctx).filter(x => x.id !== w.id && x.on && overlaps(x, w));
        let t = `Delete the price window "${w.name}" (${whenOf(w)}, ${perHalf(w.price)}) for good - it cannot be undone; adding it again is the only way back.`;
        if (!w.on) return t + ' It is switched off already, so prices do not change.';
        t += rest.length ? ` Those times then cost what ${names(rest)} say${rest.length === 1 ? 's' : ''} where ${rest.length === 1 ? 'it covers' : 'they cover'} them, and the base price (${dollars(basePrice(ctx))} a half hour) anywhere else.` : ` Those times then cost the base price (${dollars(basePrice(ctx))} a half hour).`;
        return t + madeNote(ctx);
      } },
    // booking.showSlotPrices: the Pricing card's checkbox (public/admin.html:1575; read by routes/bookings.js:294 - on unless
    // false, and never for the public at a members-only club); saved through the Settings save (POST /api/admin/config)
    { name: 'slot_prices_show', area: 'money', kind: 'write', confirm: false, needs: ['money_booking'],
      say: 'Show or hide the price under each time slot on the booking page',
      params: { type: 'object', properties: { show: { type: 'boolean' } }, required: ['show'] },
      build: (a) => ({ op: 'config', set: [['booking.showSlotPrices', a.show]] }),
      describe: (a, ctx) => `${a.show ? 'Show each time slot\'s price under it on the booking page' : 'Hide the prices under the time slots on the booking page (customers still see the total before they pay)'}${(ctx.money_booking || {}).membersOnly ? ' - your club is members-only, so the public sees no prices either way; members see their own after their code' : ''}` },

    // ═══ DISCOUNT CODES ═══════════════════════════════════════════════════════════════════════════════════════════════
    // GET /api/pricing/codes (routes/pricing.js:114, owner only). The uses route (:145) names who used a code - never read.
    { name: 'discount_codes_read', area: 'money', kind: 'read',
      say: 'Look at the discount codes: what each gives, how many times it has been used, its limits, when it expires and whether it is on. Codes cannot be edited once made - only switched off',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/pricing/codes' }),
      digest: (j) => {
        const codes = (Array.isArray(j) ? j : []).filter(c => c && c.type !== 'gift');
        if (!codes.length) return { codes: 'none yet' };
        return { codes: codes.slice(0, 60).map(c => {
          const end = codeEnds(c), full = !!c.max_uses && num(c.uses_count) >= num(c.max_uses);
          return { code: c.code, gives: codeGives(c), used: c.max_uses ? `${num(c.uses_count)} of ${c.max_uses} times` : `${num(c.uses_count)} times (no limit)`,
            per_person: c.per_phone_limit == null || num(c.per_phone_limit) <= 0 || num(c.per_phone_limit) >= NO_LIMIT ? 'no limit' : `${c.per_phone_limit} per person (by phone number)`,
            expires: end.words, works_now: Number(c.active) === 1 && !end.over && !full, switched_off: Number(c.active) === 1 ? undefined : true, used_up: full || undefined, note: c.description || undefined };
        }), more: codes.length > 60 ? `and ${codes.length - 60} more` : undefined };
      } },
    // POST /api/pricing/codes (routes/pricing.js:121 - code, type and value required; a code already used by ANY row is
    // refused; answers { success, id }); stored by services/pricing.js:363 (no limit per person: see the build)
    // (a rate checked at the door - military, seniors - is a standing rate: every visit, unless the owner says a limit; any other code
    // is once per person unless said)
    { name: 'discount_code_create', area: 'money', kind: 'write', confirm: true, needs: ['money_codes'],
      say: 'Make a discount code customers type when they book: a percent off (100 for a free booking), dollars off, or free minutes. Ask how many times it can be used, how many times per person, and when it ends, if the owner has not said - never fill in a limit or an end they did not say',
      // (the box drops a limit or an end the owner never said - engine.js, WHAT THE OWNER NEVER SAID STAYS OUT)
      unsaid: {
        max_uses: (v, w) => new RegExp('\\b' + Number(v) + '\\b').test(w) || /\b(?:uses?|used|times|limit(?:ed)?|redemptions?|first \d+)\b/i.test(w),
        check_at_door: (v, w) => /\b(?:id|i\.d\.|card|proof|check(?:ed|s)?|show(?:s|n)?|milit[ae]ry|veterans?|vets|first responders?|police|fire(?:fighters?)?|nurses?|teachers?|seniors?|students?|badge)\b/i.test(w),
        // (a limit per person only when the owner said one - the 4B put 1 on a military rate, so a soldier could use it once ever)
        per_person: (v, w) => /\b(?:once|twice|one time|\d+ times?|per (?:person|customer|phone|visit)|each (?:person|customer)|a person|uses?|every (?:time|visit)|unlimited|no limit)\b/i.test(w),
        expires: (v, w) => /\b(?:expires?|expiring|ends?|ending|until|through|thru|till|valid|last day|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|week|weekend|month|year|tomorrow|today|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday|christmas|holidays?|season|spring|summer|fall|winter)\b/i.test(w),
      },
      params: { type: 'object', properties: {
        code: { type: 'string', minLength: 2, maxLength: 30, description: 'what customers type, like SPRING20 (letters, numbers, - and _)' },
        kind: { type: 'string', enum: ['percentage', 'fixed', 'free_minutes'], description: 'percentage: a percent off; fixed: dollars off; free_minutes: minutes of play free' },
        value: { type: 'number', minimum: 0, maximum: 1440, description: 'the percent, the dollars or the minutes' },
        max_uses: { type: 'integer', minimum: 1, maximum: 100000, description: 'how many times it can be used in all; leave out for no limit' },
        per_person: { type: 'integer', minimum: 0, maximum: 100, description: 'how many times one person (one phone number) can use it; 0 for no limit; 1 when not said' },
        expires: { ...DATE, description: 'the last day it works (YYYY-MM-DD); leave out for never' },
        description: { type: 'string', maxLength: 120, description: 'a note for the owner, like "Spring promo"' },
        check_at_door: { type: 'string', maxLength: 80, description: 'what staff check at the door: "a military ID"' } }, required: ['code', 'kind', 'value'] },
      read: codeRead,
      // "seniors too" right after the military code (the 4B walk in maintainer's own typing, Oct 23 2026: "militery get 15% off they show id",
      // then "seniors to" - put up as 10% off, which nobody said): the same deal for another group, checked by their own ID
      fill: (a, ctx) => {
        const w = String(ctx.heard || ctx.newest || ''), lc = ctx.lastCode;
        // the group the owner named is the one checked at the door, and a code nobody named is the group's own ("make a code for
        // teachers they show id" was put up by the 4B as TEACHERS_ID, checked by "a military ID" - the walk, Oct 23 2026)
        { const g = rateGroupOf(w);
          if (g) {
            const cg = rateGroupOf(a.check_at_door || '');
            if (a.check_at_door !== undefined && cg && cg !== g) a = Object.assign({}, a, { check_at_door: `a${/^[aeiou]/.test(g) ? 'n' : ''} ${g} ID` });
            // (a code the owner said is one they typed as a code - with its number, or in capitals - "teachers" is not TEACHER)
            const cs = String(a.code || ''), saidCode = cs && new RegExp('\\b' + cs.replace(/[^A-Za-z0-9]/g, '.') + '\\b', 'i').test(w) && (/\d/.test(cs) || w.includes(cs.toUpperCase()));
            if (a.code && !saidCode) a = Object.assign({}, a, { code: RATE_WORD[g] + (Number(a.value) > 0 ? Math.round(Number(a.value)) : '') });
          } }
        if (!lc || /\d/.test(w) || !/\b(?:too|to|also|as well|same(?: thing| deal)?|them too)\b/i.test(w) || w.split(/\s+/).length > 8) return a;
        const b = Object.assign({}, a, { kind: lc.kind, value: lc.value, _same: true });
        const g = rateGroupOf(w); if (g && lc.check_at_door) b.check_at_door = `a${/^[aeiou]/.test(g) ? 'n' : ''} ${g} ID`;
        if (lc.per_person !== undefined) b.per_person = lc.per_person;
        if (b.code && /\d+$/.test(b.code) && String(b.code).match(/\d+$/)[0] !== String(b.value)) b.code = String(b.code).replace(/\d+$/, String(b.value));
        return b;
      },
      build: (a, ctx) => {
        // (the amount only as the owner said it - asked otherwise, never filled in)
        if (!a._same && !amountSaid(a, String(ctx.heard || ctx.newest || ''))) {
          const g = rateGroupOf(String(ctx.heard || ctx.newest || '')), who = g ? (g === 'military' || g === 'police' ? g : g + 's') : a.code.toUpperCase();
          const e = new ActionError('ask the owner how much the code takes off'); e.ask = { param: 'value', question: a.kind === 'fixed' ? `How many dollars off for ${who}?` : a.kind === 'free_minutes' ? `How many minutes free for ${who}?` : `How many percent off for ${who}?`, parse: a.kind === 'fixed' ? 'money' : 'number' }; throw e;
        }
        const code = a.code.toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(code)) throw new ActionError(`"${a.code}" cannot be a code - use letters, numbers, - and _, with no spaces`);
        const taken = (ctx.money_codes || []).find(c => String(c.code).toUpperCase() === code);
        if (taken) throw new ActionError(`the code ${code} is taken${taken.type !== 'gift' && !taken.active ? ' (by a code that was switched off - a switched-off code keeps its name)' : ''} - pick another`);
        if (a.kind === 'percentage' && !(a.value > 0 && a.value <= 100)) throw new ActionError('a percentage code is 1 to 100 percent off');
        if (a.kind === 'fixed' && !(a.value > 0 && a.value <= 1000)) throw new ActionError('a dollars-off code is more than $0 and at most $1000');
        if (a.kind === 'free_minutes' && !(Number.isInteger(a.value) && a.value >= 5)) throw new ActionError('free minutes are a whole number of minutes, 5 or more');
        if (a.expires && a.expires < ctx.today) throw new ActionError(`${dayWords(a.expires)} has passed - a code has to work for at least a day`);
        // the expiry is the END of that day on the unit's clock: the checkout reads new Date(expires_at) < now
        // (services/pricing.js:213), and a bare date is midnight UTC - the evening before, in the US.
        // NO LIMIT PER PERSON: the route turns null into null (routes/pricing.js:130) and then createDiscountCode stores
        // per_phone_limit ?? 1 (services/pricing.js:369) - so null, what the Pricing screen sends for "Unlimited per
        // person", is saved as 1. A limit nobody reaches is the one value that is kept and checked as no limit.
        return { op: 'http', method: 'POST', path: '/api/pricing/codes', body: { code, description: a.description || '', type: a.kind, value: a.kind === 'fixed' ? Math.round(a.value * 100) / 100 : a.value,
          max_uses: a.max_uses || null, per_phone_limit: perPerson(a) === 0 ? NO_LIMIT : perPerson(a), expires_at: a.expires ? a.expires + 'T23:59:59' : null, door_check: a.check_at_door || '' } };
      },
      describe: (a) => {
        const gives = codeGives({ type: a.kind, value: a.kind === 'fixed' ? Math.round(a.value * 100) / 100 : a.value });
        const per = perPerson(a) === 0 ? (a.check_at_door ? 'every visit (no limit per person)' : 'no limit per person') : `${perPerson(a)} per person (by phone number)`;
        return `New discount code ${a.code.toUpperCase()}: ${gives}, ${a.max_uses ? `up to ${plural(a.max_uses, 'use')} in all` : 'no limit on uses'}, ${per}, ${a.expires ? 'works through the end of ' + dayWords(a.expires) : 'never expires'}.${a.check_at_door ? ` Checked at the door: ${a.check_at_door} - the customer is told to bring it, and the staff pad shows it on their booking.` : ''} It comes off after any booking deal, and on top of member prices. Once made it cannot be changed - only switched off${!a.max_uses && !a.expires ? ', so say a limit or an end first if you want one (like "100 uses, ends Dec 31")' : ''}.`;
      } },
    // DELETE /api/pricing/codes/:id (routes/pricing.js:137) - sets active=0; no route turns a code back on
    { name: 'discount_code_off', area: 'money', kind: 'write', confirm: true, needs: ['money_codes'],
      say: 'Switch a discount code off so it stops working at checkout (also the way to "change" one: switch it off and make a new code with another name)',
      params: { type: 'object', properties: { code: { type: 'string', minLength: 2, maxLength: 30 } }, required: ['code'] },
      build: (a, ctx) => {
        const c = findCode(ctx, a.code);
        if (!c.active) throw new ActionError(`${c.code} is already switched off`);
        return { op: 'http', method: 'DELETE', path: '/api/pricing/codes/' + encodeURIComponent(c.id) };
      },
      describe: (a, ctx) => { const c = findCode(ctx, a.code); return `Switch off the code ${c.code} (${codeGives(c)}, used ${plural(num(c.uses_count), 'time')}): it stops working at checkout now. It cannot be switched back on, and a new code cannot reuse the name ${c.code}.`; } },

    // ═══ DEPOSITS ═════════════════════════════════════════════════════════════════════════════════════════════════════
    // booking.depositMode 'off' | 'per30' and booking.depositPer30 (services/config.js:138; Settings > Booking Rules,
    // public/admin.html:1049-1058). Applied by routes/bookings.js:884 - non-members only, and only where someone is at the
    // door (services/staffing.js isStaffedAt: always at a staffed facility, inside the staffed hours at a hybrid, never
    // when nobody is ever there); never above the session's price. Saved through the Settings save (POST /api/admin/config).
    { name: 'deposit_set', area: 'money', kind: 'write', confirm: true, needs: ['money_booking'],
      say: 'Turn the booking deposit on or off: instead of paying in full online, non-member customers pay a deposit per half hour and settle the rest at the door (only where someone is at the door)',
      params: { type: 'object', properties: { on: { type: 'boolean' }, per_half_hour: { type: 'number', minimum: 1, maximum: 500, description: 'dollars of deposit per half hour; leave out to keep the amount set now' } }, required: ['on'] },
      build: (a, ctx) => {
        const bk = ctx.money_booking || {};
        if (a.on && bk.membersOnly) throw new ActionError('your facility is members-only, so there are no non-member bookings to take a deposit from - members settle by their own tier\'s setting (Members > Tiers > Member golf settles)');
        const set = [['booking.depositMode', a.on ? 'per30' : 'off']];
        if (a.per_half_hour !== undefined) set.push(['booking.depositPer30', Math.round(a.per_half_hour * 100) / 100]);
        return { op: 'config', set };
      },
      describe: (a, ctx) => {
        const bk = ctx.money_booking || {};
        if (!a.on) return 'No booking deposit: non-member customers pay in full online when they book. Members are not affected.' + (a.per_half_hour !== undefined ? ` (The amount, ${dollars(a.per_half_hour)} a half hour, is kept for if you turn it back on.)` : '');
        const per = a.per_half_hour !== undefined ? a.per_half_hour : (num(bk.depositPer30) || 10);
        let t = `Booking deposit on: non-member customers pay ${dollars(per)} a half hour online (${dollars(per * 4)} for 2 hours) and settle the rest at the door - never more than the session's price. Members are not affected.`;
        if (bk.style === 'staffed') t += ' It applies to every non-member booking, since someone is always at the counter.';
        else if (bk.style === 'hybrid') t += bk.scheduleOff ? ' But your staffed hours are switched off (Settings > Schedule), so no booking has someone at the door: they all still pay in full online until those come back on.' : ' It applies only to bookings that arrive inside your staffed hours; the rest pay in full online.';
        else t += ' But your facility runs without anyone at the counter, so it will not apply: customers still pay in full online (it starts working if you switch to staffed or hybrid).';
        return t;
      } },

    // ═══ GIFT CARDS ═══════════════════════════════════════════════════════════════════════════════════════════════════
    // POST /api/gifts/admin/issue (routes/gifts.js:95 - owner only; amount_cents 100-100000; to_email optional and emailed
    // the code if given; note goes into that email; comp = no payment). It answers { success, code }: the page's resultOf
    // (public/assistant-apply.js:36) keeps neither, and the engine's safeResult has no 'code' - the code never reaches the
    // model. A card not marked comp counts as money taken today (services/revenue.js:186-196) - so the owner says which.
    { name: 'gift_card_issue', area: 'money', kind: 'write', confirm: true, needs: ['money_booking'],
      say: 'Issue a gift card by hand. Ask the owner whether it was paid for (sold - it counts as money taken in the revenue report) or free (a prize or a comp) - never guess. It can be emailed to the person',
      params: { type: 'object', properties: {
        amount: { type: 'number', minimum: 1, maximum: 1000, description: 'dollars on the card' },
        sold: { type: 'boolean', description: 'true when someone paid for it (it counts as money taken today); false for a free card - a prize, a comp, a replacement' },
        email: { type: 'string', maxLength: 120, description: 'the email to send the card to; leave out to not email it' },
        note: { type: 'string', maxLength: 200, description: 'a short message, shown in the email' } }, required: ['amount', 'sold'] },
      build: (a) => {
        if (a.email && !emailOk(a.email)) throw new ActionError(`"${a.email}" is not an email address`);
        return { op: 'http', method: 'POST', path: '/api/gifts/admin/issue', body: { amount_cents: Math.round(a.amount * 100), to_email: a.email ? a.email.trim() : '', note: a.note || '', comp: !a.sold }, reveal: [['The gift card\'s code', 'code']] };
      },
      describe: (a, ctx) => {
        const amt = cents(Math.round(a.amount * 100));
        let t = `Issue a ${amt} gift card - ${a.sold ? `sold: it counts as ${amt} taken today in your revenue` : 'free: not counted as money taken'}.`;
        if (!a.email) t += ' It is not emailed.';
        else if ((ctx.money_booking || {}).emailReady) t += ` It is emailed to the address you gave${a.note ? ', with your note' : ''}.`;
        else t += ' This unit is not set up to send email (Settings > Connections > Resend - Email Notifications), so it is NOT emailed.';
        return t + ' Its code shows here for you only (and stays in Gift Cards on the Members screen) - I never see it.';
      } },
    // GET /api/gifts/admin/list (routes/gifts.js:92 -> services/gifts.js:52, the newest 200): no code, email or name is kept
    { name: 'gift_cards_read', area: 'money', kind: 'read',
      say: 'See how many gift cards are out and how much unspent money is on them',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/gifts/admin/list' }),
      digest: (j) => {
        const list = Array.isArray(j) ? j : [];
        if (!list.length) return { gift_cards: 'none yet' };
        const on = list.filter(g => g.active), off = list.filter(g => !g.active);
        const sum = (l, k) => l.reduce((s, g) => s + num(g[k]), 0);
        const sold = list.filter(g => g.paid !== false), free = list.filter(g => g.paid === false);
        return { cards: list.length, still_usable: on.length, with_money_left: on.filter(g => num(g.balance_cents) > 0).length, unspent_on_usable_cards: cents(sum(on, 'balance_cents')),
          sold: `${sold.length} (${cents(sum(sold, 'initial_cents'))} when sold)`, free: `${free.length} (${cents(sum(free, 'initial_cents'))})`,
          switched_off: off.length ? `${off.length} (${cents(sum(off, 'balance_cents'))} was left on them)` : undefined,
          note: list.length >= 200 ? 'these are the newest 200 cards; older ones are not counted here' : undefined };
      } },
    // DELETE /api/pricing/codes/:id (routes/pricing.js:137) on a gift card's row - what the Discount Codes list's Deactivate
    // does to it (gift cards are rows there, services/gifts.js:23). Found by the last four characters only: the rest of the
    // code is what spends it.
    { name: 'gift_card_switch_off', area: 'money', kind: 'write', confirm: true, needs: ['money_gifts'],
      say: 'Switch off a lost or stolen gift card so nobody can spend it, by the last four characters of its code',
      params: { type: 'object', properties: { ending: { type: 'string', minLength: 4, maxLength: 4, description: 'the last four characters of the card\'s code' } }, required: ['ending'] },
      build: (a, ctx) => {
        const end = a.ending.toUpperCase();
        const hit = (ctx.money_gifts || []).filter(g => g.code.toUpperCase().endsWith(end)), live = hit.filter(g => g.active);
        if (!hit.length) throw new ActionError(`no gift card's code ends in ${end} (among the newest 200 cards)`);
        if (!live.length) throw new ActionError(`the gift card ending ${end} is already switched off`);
        if (live.length > 1) throw new ActionError(`${live.length} gift cards end in ${end} - switch the right one off on the Pricing screen's Discount Codes list`);
        return { op: 'http', method: 'DELETE', path: '/api/pricing/codes/' + encodeURIComponent(live[0].id) };
      },
      describe: (a, ctx) => {
        const g = (ctx.money_gifts || []).find(x => x.active && x.code.toUpperCase().endsWith(a.ending.toUpperCase())) || {};
        return `Switch off the gift card ending ${a.ending.toUpperCase()} (${cents(g.balance_cents)} still on it, of ${cents(g.initial_cents)}): nobody can spend it after this, and it cannot be switched back on. What it was sold for stays in your revenue. To give its owner a replacement, issue a free card for ${cents(g.balance_cents)}.`;
      } },

    // ═══ WHAT CAME IN ═════════════════════════════════════════════════════════════════════════════════════════════════
    // GET /api/admin/revenue/summary?start&end (routes/admin.js:1452, owner only) - services/revenue.js report(): money
    // actually taken minus refunds, each on the day it moved, in the facility's zone (rule 38)
    { name: 'revenue_read', area: 'money', kind: 'read',
      say: 'See the money that came in for a period - revenue (money actually taken, minus refunds), how it came in, tax, tips, card fees - plus the sessions played and how busy it was. Use period, or from and to for any other dates',
      params: { type: 'object', properties: { period: { type: 'string', enum: PERIODS, description: 'one of: ' + PERIODS.join(', ') + ' (this_month when not said)' },
        from: { ...PAST_DATE, description: 'the first day, for any other range (YYYY-MM-DD)' }, to: { ...PAST_DATE, description: 'the last day (today when not said; the same as from for one day)' } } },
      request: (a, ctx) => { const [s, e] = rangeOf(a, ctx.today); return { method: 'GET', path: `/api/admin/revenue/summary?start=${s}&end=${e}` }; },
      digest: (j) => {
        const r = j.range || {}, nr = r.not_revenue || {}, ex = nr.expired_unpaid || {};
        const quick = (k) => (j[k] && j[k].revenue_cents !== undefined ? cents(j[k].revenue_cents) : undefined);
        return { period: spanWords(j.rangeStart, j.rangeEnd), revenue: cents(r.revenue_cents), revenue_means: 'money actually taken, minus refunds, tax included',
          came_in: { sessions_paid_online: cents(r.sessions_cents), counter_card: cents(r.inperson_card_cents), counter_cash: cents(r.inperson_cash_cents), counter_check: cents(r.inperson_check_cents),
            gift_cards_sold: cents(r.gift_sales_cents), membership_payments: cents(r.membership_cents) },
          refunds: cents(r.refunds_cents), tax_collected: `${cents(r.tax_cents)} (on online sessions and memberships; the counter's tax is inside its money)`,
          tips_for_staff: `${cents(r.tips_cents)} (the staff's - not revenue)`, estimated_card_fees: cents(r.total_stripe_fees_cents), take_home_estimate: cents(r.combined_take_home_cents),
          not_money_taken: { checkouts_expired_unpaid: `${num(ex.count)} (${cents(ex.cents)} never taken)`, member_credit_spent: cents(nr.member_credit_cents), gift_cards_spent: cents(nr.gift_card_spend_cents) },
          sessions_played: num(r.count), hours_booked: num(j.bookedHours), busy: `${num(j.occupancy)}% of open bay hours`,
          by_bay: (j.byBay || []).slice(0, 8).map(b => ({ bay: b.bay_name || '(no bay)', sessions: num(b.count), money: cents(b.revenue_cents) })),
          membership_monthly_value: j.membership_mrr_cents !== undefined ? `${cents(j.membership_mrr_cents)} a month (members paying online, at today's tier prices)` : undefined,
          quick_totals: { today: quick('today'), last_7_days: quick('week'), this_month: quick('month'), this_quarter: quick('quarter'), this_year: quick('year') } };
      } },
    // GET /api/pos/eod?date (routes/pos.js:193 -> services/pos.js eodSummary :912) - the counter's day; staff names (tips by
    // employee, who counted) are left out
    // THE DAY'S COMPS, VOIDS AND REFUNDS, SIGNED OFF (Oct 20 2026, late - the gap audit's second: the daily close-
    // out): what came off a tab or went back, each with who and why (routes/pos.js:145 GET /api/pos/review), signed off one by
    // one or all at once (:162, :167) - said back first, because signing is the owner's own word that they looked at each
    { name: 'day_review_read', area: 'money', kind: 'read',
      say: 'See the day\'s comps, voids and refunds for the owner\'s review - each one: what, how much, who did it and why - and which are not signed off yet',
      params: { type: 'object', properties: { date: { ...PAST_DATE, description: 'the day (YYYY-MM-DD, yesterday, or a weekday name - the latest one); today when not said' } } },
      request: (a, ctx) => ({ method: 'GET', path: `/api/pos/review?date=${a.date ? pastDate(a.date, ctx.today, 'the review') : ctx.today}` }),
      digest: (j) => { const items = reviewItems(j); return items.length ? { items: items.map(reviewSay), not_signed_off: items.filter(x => !x.reviewed).length } : { items: 'no comp, void or refund that day' }; } },
    { name: 'day_review_sign_off', area: 'money', kind: 'write', confirm: true,
      say: 'Sign off the day\'s comps, voids and refunds the owner has looked at - all those not yet signed off, or one by its words (the item, or a refund\'s reason). Read them with day_review_read and say them first. Today or yesterday',
      params: { type: 'object', properties: { day: { type: 'string', enum: ['today', 'yesterday'], description: 'today unless the owner says yesterday' },
        item: { type: 'string', maxLength: 80, description: 'one of them by its words; leave out for all not yet signed off' } } },
      needs: ['reviewDays'],
      build: (a, ctx) => {
        const pick = reviewPick(ctx, a);
        const steps = pick.map(x => ({ op: 'http', method: 'POST', path: x.kind === 'refund' ? `/api/pos/review/refund/${encodeURIComponent(x.id)}/check` : `/api/pos/review/${encodeURIComponent(x.id)}/check`, body: { reviewer: 'Owner (the assistant)' } }));
        return steps.length === 1 ? steps[0] : { op: 'steps', steps };
      },
      describe: (a, ctx) => { const pick = reviewPick(ctx, a); return `Sign off ${pick.length === 1 ? 'this' : 'these ' + pick.length} from ${a.day === 'yesterday' ? 'yesterday' : 'today'}, as looked at: ${pick.map(x => { const r = reviewSay(x); return `${r.what} ${r.amount}${r.who ? ' by ' + r.who : ''}${r.why ? ' (' + r.why + ')' : ''}`; }).join('; ')}`; } },
    { name: 'end_of_day_read', area: 'money', kind: 'read',
      say: 'See the counter\'s End of Day for a day: sales by category, payments by card, cash and check, tips, refunds, comps and voids, and the cash that should be in the drawer',
      params: { type: 'object', properties: { date: { ...PAST_DATE, description: 'the day (YYYY-MM-DD, yesterday, or a weekday name - the latest one); today when not said' } } },
      request: (a, ctx) => ({ method: 'GET', path: `/api/pos/eod?date=${a.date ? pastDate(a.date, ctx.today, 'End of Day') : ctx.today}` }),
      digest: (j) => {
        const money = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, cents(v)]));
        const how = { card: 'card', cash: 'cash', check: 'check', credit: 'member credit (not new money)', gift: 'gift card (not new money)' };
        const pays = (j.payments || []).map(p => ({ how: how[p.method] || p.method, amount: cents(p.a), tips: cents(p.t), payments: num(p.n) }));
        const cv = j.comps_voids || {}, rp = j.report, day = j.date ? dayWords(j.date) : undefined;
        if (!pays.length && !Object.keys(j.sales_by_category || {}).length && !num(cv.count) && !Object.keys((j.refunds || {}).by_method || {}).length) return { day, counter: 'nothing was rung up at the counter that day' };
        return { day, sales_by_category: money(j.sales_by_category), tax_by_category: money(j.tax_by_category), payments: pays,
          tips_total: cents((j.tips || {}).shift_total), comps_and_voids: { count: num(cv.count), not_reviewed_yet: num(cv.unreviewed) },
          given_back: money((j.refunds || {}).by_method), cash_expected_in_drawer: cents(j.expected_cash_cents), opening_float: cents(j.opening_float_cents),
          closed: rp ? { counted: cents(rp.counted_cents), over_or_short: cents(rp.over_short_cents) } : 'not closed yet' };
      } },

    // ═══ MEMBERSHIP TIERS ═════════════════════════════════════════════════════════════════════════════════════════════
    // PUT /api/members/tiers/:id (routes/members.js:187, owner only) REPLACES the tier - op 'merge' with every field the
    // route reads, from GET /api/members/tiers (:98). guest_pricing_set turns on with any save that carries the guest fields
    // (:217), and a tier saved before the guest rules with "free" guests on a door or deposit tier really means "their
    // regular share" (services/guests.js:35-58) - so that tier is saved with what it means, never turned into free guests.
    { name: 'membership_tier_change', area: 'members', kind: 'write', confirm: true, needs: ['money_member_tiers'],
      say: 'Change a membership tier: its monthly or yearly price, free hours a month, discount beyond the free hours, the days and times members may book, guests, whether it is sold online, its description or name - or bring back a retired tier. Everything not mentioned stays as it is',
      params: { type: 'object', properties: {
        tier: TIER_PARAM,
        price_monthly: { type: 'number', minimum: 0, maximum: 10000, description: 'dollars a month; 0 = not offered monthly' },
        price_annual: { type: 'number', minimum: 0, maximum: 100000, description: 'dollars a year; 0 = not offered yearly' },
        free_hours_a_month: { type: 'number', minimum: 0, maximum: 744, description: 'free hours a month (used before anything is charged); 0 takes free hours away' },
        discount_percent: { type: 'number', minimum: 0, maximum: 100, description: 'percent off booked time beyond the free hours (or off all booked time when there are none); 0 for none' },
        days: { ...DAYS_PARAM, description: 'the days members may book, in words, like "weekdays", "mon-thu", "fri, sat" or "every day"' },
        earliest_time: TIME, latest_time: { ...TIME, description: 'members\' sessions must start before this (HH:MM)' },
        any_time: { type: 'boolean', description: 'true to take away the time limits' },
        guests_allowed: { type: 'boolean' }, guests_per_visit: { type: 'integer', minimum: 1, maximum: 20, description: 'how many guests a member may bring each visit' },
        sell_online: { type: 'boolean', description: 'shown on the memberships page for people to join online' },
        description: { type: 'string', maxLength: 300 }, new_name: { type: 'string', minLength: 2, maxLength: 60 },
        bring_back: { type: 'boolean', description: 'true to offer a retired tier again' } }, required: ['tier'] },
      build: (a, ctx) => {
        const t = findTier(ctx, a.tier), set = tierPricing(t, a);
        if (a.price_monthly !== undefined) set.price_monthly = Math.round(a.price_monthly * 100) / 100;
        if (a.price_annual !== undefined) set.price_annual = Math.round(a.price_annual * 100) / 100;
        if (a.days !== undefined) { const d = parseDays(a.days); set.allowed_days = d.length === 7 ? '' : d.join(','); }
        if (a.any_time) { if (a.earliest_time || a.latest_time) throw new ActionError('any time, or a start and end time - not both'); set.earliest_time = ''; set.latest_time = ''; }
        else if (a.earliest_time || a.latest_time) {
          if (!a.earliest_time || !a.latest_time) throw new ActionError('give both the earliest and the latest start time, or say any time');
          if (a.latest_time <= a.earliest_time) throw new ActionError('the latest start time must be after the earliest');
          set.earliest_time = a.earliest_time; set.latest_time = a.latest_time;
        }
        if (a.guests_allowed === false) { if (a.guests_per_visit) throw new ActionError('no guests, or guests per visit - not both'); set.guest_allowed = false; }
        else if (a.guests_allowed === true || a.guests_per_visit) { set.guest_allowed = true; if (a.guests_per_visit) set.guest_max_per_visit = a.guests_per_visit; }
        if (a.sell_online !== undefined) set.sell_online = a.sell_online;
        if (a.description !== undefined) set.description = a.description;
        if (a.new_name && norm(a.new_name) !== norm(t.name)) { if (tiersOf(ctx).some(x => x.id !== t.id && norm(x.name) === norm(a.new_name))) throw new ActionError(`there is already a tier called "${a.new_name}"`); set.name = a.new_name; }
        if (a.bring_back) { if (Number(t.active) === 1) throw new ActionError(`"${t.name}" is not retired - it is on offer now`); set.active = 1; }
        if (!Object.keys(set).length) throw new ActionError('say what to change about the tier');
        if (!t.guest_pricing_set) set.guest_pricing_type = guestType(t);   // what a tier from before the guest rules means, said outright
        return { op: 'merge', get: '/api/members/tiers', find: ['id', t.id], fields: TIER_FIELDS, set, put: '/api/members/tiers/' + encodeURIComponent(t.id) };
      },
      describe: (a, ctx) => {
        const t = findTier(ctx, a.tier), n = Object.assign({}, t, tierPricing(t, a)), parts = [];
        if (a.price_monthly !== undefined || a.price_annual !== undefined) {
          Object.assign(n, a.price_monthly !== undefined ? { price_monthly: a.price_monthly } : {}, a.price_annual !== undefined ? { price_annual: a.price_annual } : {});
          // Stripe bills a subscription the price it was started at (services/membership-billing.js:79 finds or makes a price
          // for each new join; nothing moves an existing subscription), while the renewal reminder emails read the tier's
          // price now (services/membership-lifecycle.js:292, :312)
          const priced = num(n.price_monthly) > 0 || num(n.price_annual) > 0;
          let p = `${tierPrice(n)} (was ${tierPrice(t)})`;
          if (num(t.roster_count) > 0) p += `${priced ? ' - new members pay this;' : ' -'} members already paying online keep paying the price they joined at (Stripe bills that), though their renewal reminder emails will quote ${priced ? 'the new price' : '$0'}`;
          parts.push(p);
        }
        if (a.free_hours_a_month !== undefined || a.discount_percent !== undefined) parts.push(`members get ${tierPriceWords(n)} (was ${tierPriceWords(t)})`);
        if (a.days !== undefined || a.any_time || a.earliest_time) {
          const d = a.days !== undefined ? parseDays(a.days) : null;
          Object.assign(n, d ? { allowed_days: d.length === 7 ? '' : d.join(',') } : {}, a.any_time ? { earliest_time: '', latest_time: '' } : a.earliest_time ? { earliest_time: a.earliest_time, latest_time: a.latest_time } : {});
          parts.push(`members may book ${tierWhen(n)} (was ${tierWhen(t)})`);
        }
        if (a.guests_allowed !== undefined || a.guests_per_visit) { Object.assign(n, { guest_allowed: a.guests_allowed !== false }, a.guests_per_visit ? { guest_max_per_visit: a.guests_per_visit } : {}); parts.push(`guests: ${tierGuests(n)}`); }
        if (a.sell_online !== undefined) parts.push(a.sell_online ? 'sold online - people can join on your memberships page' : 'not sold online - it comes off your memberships page (members on it now are not affected)');
        if (a.description !== undefined) parts.push('its description updated');
        if (a.new_name && norm(a.new_name) !== norm(t.name)) parts.push(`renamed "${a.new_name}"`);
        if (a.bring_back) parts.push('brought back: it can be given to members again');
        // routes/memberships.js:37 shows a tier online only with a price above 0
        const online = a.sell_online !== undefined ? a.sell_online : !!n.sell_online;
        if (online && (a.sell_online || a.price_monthly !== undefined || a.price_annual !== undefined || a.bring_back) && !(num(n.price_monthly) > 0 || num(n.price_annual) > 0)) parts.push('with no price set it does not show on your memberships page');
        return `Change the membership "${t.name}": ${parts.join('; ')}.${Number(t.active) === 1 || a.bring_back ? '' : ' It stays retired.'}`;
      } },
    // ── A TIER'S DETAILS (Oct 21 2026 - the gap audit's item 7: Members > Tiers > Edit's own fields): how it prices members'
    //    golf (the four styles services/pricing.js knows), its guest rules (services/guests.js, "the guest law"), and its member
    //    rules (the cap, bookings held, how far ahead, which bays, how it settles, perks). Each goes through the same merge as
    //    membership_tier_change: the tier as it is, only what was said changed, PUT whole (routes/members.js:197) ──
    { name: 'membership_tier_pricing_set', area: 'members', kind: 'write', confirm: true, needs: ['money_member_tiers'],
      say: 'Change HOW a membership tier prices members\' golf. The styles: "discount" (a percent off, or dollars off each booking; the discount can cover only so many hours a day, week or month), "free_hours" (free hours a month, which may be spread so no more than so many are used a day or a week), "daily_free" (free hours each day, with weekly or monthly pools if wanted) or "flat_rate" (members pay a set rate an hour in place of the regular price). Past their free time or limits members pay: the regular price, a percent off, or a flat rate an hour. Free time is always used first. Say it back in plain words',
      params: { type: 'object', properties: {
        tier: TIER_PARAM,
        style: { type: 'string', enum: ['discount', 'free_hours', 'daily_free', 'flat_rate'], description: 'left out: the tier keeps its style' },
        percent_off: { type: 'number', minimum: 0, maximum: 100, description: 'discount: percent off booked time' },
        dollars_off: { type: 'number', minimum: 0, maximum: 1000, description: 'discount: dollars off each booking instead of a percent' },
        free_hours_a_month: { type: 'number', minimum: 0, maximum: 744, description: 'free_hours: the free hours each month' },
        free_hours_a_day: { type: 'number', minimum: 0, maximum: 24, description: 'daily_free: the free hours each day' },
        flat_rate_per_hour: { type: 'number', minimum: 0, maximum: 2000, description: 'flat_rate: dollars an hour members pay' },
        limit_hours_a_day: { type: 'number', minimum: 0, maximum: 24, description: 'discount: the discount covers up to this a day; free_hours: no more free time than this a day (0 = no limit)' },
        limit_hours_a_week: { type: 'number', minimum: 0, maximum: 168, description: 'the same a week (daily_free: a weekly pool of free time)' },
        limit_hours_a_month: { type: 'number', minimum: 0, maximum: 744, description: 'discount: the discount covers up to this a month; daily_free: a monthly pool' },
        after: { type: 'string', enum: ['regular', 'percent_off', 'flat_rate'], description: 'what members pay past their free time or limits' },
        after_value: { type: 'number', minimum: 0, maximum: 2000, description: 'percent_off: the percent; flat_rate: dollars an hour' } }, required: ['tier'] },
      build: (a, ctx) => {
        const t = findTier(ctx, a.tier), set = tierStyleSet(t, a);
        if (!t.guest_pricing_set) set.guest_pricing_type = guestType(t);
        return { op: 'merge', get: '/api/members/tiers', find: ['id', t.id], fields: TIER_FIELDS, set, put: '/api/members/tiers/' + encodeURIComponent(t.id) };
      },
      describe: (a, ctx) => { const t = findTier(ctx, a.tier), n = Object.assign({}, t, tierStyleSet(t, a)); return `Change how "${t.name}" prices members' golf: members get ${tierPriceWords(n)} (was ${tierPriceWords(t)}). Members already booked keep the price they were quoted.`; } },
    { name: 'membership_tier_guests_set', area: 'members', kind: 'write', confirm: true, needs: ['money_member_tiers'],
      say: 'Change a membership tier\'s guest rules: whether members may bring guests and how many a visit; guests covered on every visit; a monthly pool of guest passes on top; what a covered guest pays (free, their regular share of the bay at the counter, a flat fee, or their share less a percent); what a guest past the passes pays; whether guest fees are per visit or per hour; and where they are collected (with the member\'s golf, always online, or at the counter when someone is there)',
      params: { type: 'object', properties: {
        tier: TIER_PARAM,
        guests_allowed: { type: 'boolean' },
        max_per_visit: { type: 'integer', minimum: 0, maximum: 50, description: 'the most guests a visit (0 = no cap)' },
        included_per_visit: { type: 'integer', minimum: 0, maximum: 50, description: 'guests covered on every visit' },
        passes_a_month: { type: 'integer', minimum: 0, maximum: 500, description: 'a monthly pool of covered guests on top (0 = none; with none included either, every guest is covered)' },
        covered_guests_pay: { type: 'string', enum: ['free', 'share', 'flat', 'percent_off'], description: 'free; share = their regular share of the bay at the counter; flat = a fee each; percent_off = their share less a percent' },
        covered_value: { type: 'number', minimum: 0, maximum: 1000, description: 'flat: dollars each; percent_off: the percent' },
        after_passes_price: { type: 'number', minimum: 0, maximum: 1000, description: 'dollars each for a guest past the passes (0 = free on free or flat, the regular share on share)' },
        charged: { type: 'string', enum: ['per_visit', 'per_hour'], description: 'whether guest fees are per guest per visit or per guest per hour' },
        collected: { type: 'string', enum: ['with_the_golf', 'online', 'at_the_counter'], description: 'where guest fees are paid' } }, required: ['tier'] },
      build: (a, ctx) => { const t = findTier(ctx, a.tier); return { op: 'merge', get: '/api/members/tiers', find: ['id', t.id], fields: TIER_FIELDS, set: tierGuestSet(t, a), put: '/api/members/tiers/' + encodeURIComponent(t.id) }; },
      describe: (a, ctx) => {
        const t = findTier(ctx, a.tier), n = Object.assign({}, t, tierGuestSet(t, a), { guest_pricing_set: 1 });
        if (!n.guest_allowed) return `"${t.name}": no guests.`;
        const parts = [tierGuests(n).replace(/ \(the full guest rules are on the Members screen\)$/, '')];
        const inc = num(n.guest_included_per_visit), pass = num(n.guest_passes_per_month);
        parts.push(inc || pass ? [inc && `${plural(inc, 'guest')} covered every visit`, pass && `${plural(pass, 'guest pass', 'guest passes')} a month on top`].filter(Boolean).join(' and ') : 'every guest is covered');
        if (pass || inc) parts.push(`a guest past those pays ${num(n.guest_overflow_price) > 0 ? dollars(n.guest_overflow_price) + ' each' : guestType(n) === 'share' ? 'their regular share' : 'nothing'}`);
        parts.push(n.guest_pricing_basis === 'hour' ? 'guest fees are per guest per hour' : 'guest fees are per guest per visit');
        parts.push({ auto: 'collected with the member\'s golf', online: 'always collected online with the booking', door: 'collected at the counter when someone is there, online otherwise' }[n.guest_collect || 'auto']);
        return `Change "${t.name}"'s guests: ${parts.join('; ')}.`;
      } },
    { name: 'membership_tier_rules_set', area: 'members', kind: 'write', confirm: true, needs: ['money_member_tiers', 'bays'],
      say: 'Change a membership tier\'s rules: the most members it may have, how many upcoming bookings a member may hold, how many days ahead members may book, which bays they may book, how members\' golf is paid (charged online at booking, a deposit online with the rest at the door, or all at the door), the deposit, family codes included, the grace days after a missed payment, and food and drink perks at the counter',
      params: { type: 'object', properties: {
        tier: TIER_PARAM,
        member_cap: { type: 'integer', minimum: 0, maximum: 100000, description: 'the most members on it (0 = no cap)' },
        max_upcoming_bookings: { type: 'integer', minimum: 0, maximum: 50, description: '0 = no limit' },
        book_days_ahead: { type: 'integer', minimum: 0, maximum: 365, description: '0 = the facility\'s own booking window' },
        bays: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 30, description: 'the bays members may book, by name; ["all"] for every bay' },
        settles: { type: 'string', enum: ['online', 'deposit', 'door'], description: 'online: charged at booking; deposit: a deposit online, the rest at the door; door: nothing online' },
        deposit_per_half_hour: { type: 'number', minimum: 0, maximum: 500, description: 'deposit: dollars a half hour' },
        family_codes: { type: 'integer', minimum: 1, maximum: 10, description: 'member codes included (1 = just the member)' },
        grace_days: { type: 'integer', minimum: 0, maximum: 60, description: 'days a member keeps access after a missed payment' },
        food_off: { type: 'string', enum: ['none', 'percent', 'dollars'], description: 'a food discount at the counter' }, food_value: { type: 'number', minimum: 0, maximum: 100 },
        drink_off: { type: 'string', enum: ['none', 'percent', 'dollars'], description: 'a drink discount at the counter' }, drink_value: { type: 'number', minimum: 0, maximum: 100 } }, required: ['tier'] },
      build: (a, ctx) => { const t = findTier(ctx, a.tier), set = tierRuleSet(t, a, ctx); if (!t.guest_pricing_set) set.guest_pricing_type = guestType(t); return { op: 'merge', get: '/api/members/tiers', find: ['id', t.id], fields: TIER_FIELDS, set, put: '/api/members/tiers/' + encodeURIComponent(t.id) }; },
      describe: (a, ctx) => {
        const t = findTier(ctx, a.tier), n = Object.assign({}, t, tierRuleSet(t, a, ctx)), parts = [];
        if (a.member_cap != null) parts.push(num(n.roster_cap) ? `at most ${plural(num(n.roster_cap), 'member')} (${num(t.roster_count)} now)` : 'no cap on members');
        if (a.max_upcoming_bookings != null) parts.push(num(n.max_active_bookings) ? `${plural(num(n.max_active_bookings), 'upcoming booking')} at a time` : 'no limit on upcoming bookings');
        if (a.book_days_ahead != null) parts.push(num(n.booking_window_days) ? `book up to ${plural(num(n.booking_window_days), 'day')} ahead` : 'book as far ahead as anyone');
        if (a.bays) { const ids = String(n.allowed_bays || '').split(',').filter(Boolean); parts.push(ids.length ? 'only ' + ids.map(id => (((ctx.bays || []).find(b => b.id === id)) || { name: id }).name).join(', ') : 'every bay'); }
        if (a.settles) parts.push({ online: 'golf charged online at booking', deposit: `a deposit of ${dollars(n.deposit_per30)} a half hour online, the rest at the door`, door: 'nothing online - golf settled at the door' }[tierSettle(n)]);
        else if (a.deposit_per_half_hour != null) parts.push(`the deposit ${dollars(n.deposit_per30)} a half hour`);
        if (a.family_codes != null) parts.push(num(n.codes_included) > 1 ? `${num(n.codes_included)} member codes (family)` : 'one member code');
        if (a.grace_days != null) parts.push(`${plural(num(n.grace_days), 'day')} of access after a missed payment`);
        const perk = (type, v, what) => !type ? `no ${what} discount` : type === 'percent' ? `${num(v)}% off ${what}` : `${dollars(v)} off each ${what} item`;
        if (a.food_off) parts.push(perk(n.food_discount_type, n.food_discount_value, 'food'));
        if (a.drink_off) parts.push(perk(n.beverage_discount_type, n.beverage_discount_value, 'drink'));
        if (!parts.length) throw new ActionError('say what to change about the tier\'s rules');
        return `Change "${t.name}": ${parts.join('; ')}.`;
      } },
    // DELETE /api/members/tiers/:id (routes/members.js:303) - sets active=0, refused while any ACTIVE member is on the tier.
    // A retired tier is off the memberships page (routes/memberships.js:37), cannot take new members (members.js:488), and
    // a member PIN on it stops working (services/db.js getMemberByPin :1298 needs mt.active = 1).
    { name: 'membership_tier_retire', area: 'members', kind: 'write', confirm: true, needs: ['money_member_tiers', 'money_members'],
      say: 'Retire a membership tier nobody active is on any more: it comes off the memberships page and cannot be given to anyone (to only stop selling it online, use membership_tier_change with sell_online false)',
      params: { type: 'object', properties: { tier: TIER_PARAM }, required: ['tier'] },
      build: (a, ctx) => {
        const t = findTier(ctx, a.tier);
        if (Number(t.active) !== 1) throw new ActionError(`"${t.name}" is retired already`);
        if (num(t.roster_count) > 0) throw new ActionError(`${plural(num(t.roster_count), 'active member is', 'active members are')} on "${t.name}" - move them to another tier first (member_tier_move), or keep it and stop selling it online instead`);
        return { op: 'http', method: 'DELETE', path: '/api/members/tiers/' + encodeURIComponent(t.id) };
      },
      describe: (a, ctx) => {
        const t = findTier(ctx, a.tier), on = membersOf(ctx).filter(m => String(m.tier_id) === String(t.id));
        const paused = on.filter(m => m.status === 'suspended').length, ended = on.filter(m => m.status !== 'active' && m.status !== 'suspended').length;
        const left = [paused && plural(paused, 'suspended member'), ended && plural(ended, 'past member')].filter(Boolean);
        return `Retire the membership "${t.name}" (${tierPrice(t)}): it comes off your memberships page and cannot be given to anyone. Nobody active is on it`
          + (left.length ? `; the ${andList(left)} on it cannot be switched back on while it is retired (move them to another tier first if they may come back)` : '') + '. You can bring it back later.';
      } },

    // ═══ MEMBERS ══════════════════════════════════════════════════════════════════════════════════════════════════════
    // GET /api/members (routes/members.js:324, owner only) through the money_members loader - names as first name and last
    // initial; never a phone, an email or a PIN
    { name: 'members_read', area: 'members', kind: 'read', needs: ['money_members', 'money_member_tiers'],
      say: 'Look at the members: how many there are by tier and status, and a list (name, tier, status, joined, billing). Narrow it by tier, status or name',
      params: { type: 'object', properties: { tier: TIER_PARAM, status: { type: 'string', enum: ['active', 'suspended', 'inactive', 'all'], description: 'active when not said; inactive means ended' }, name: { type: 'string', maxLength: 60 } } },
      local: (a, ctx) => {
        const all = membersOf(ctx);
        const ended = (m) => m.status !== 'active' && m.status !== 'suspended';
        const count = (l) => ({ active: l.filter(m => m.status === 'active').length, suspended: l.filter(m => m.status === 'suspended').length, ended: l.filter(ended).length });
        let list = all;
        if (a.tier) { const t = findTier(ctx, a.tier); list = list.filter(m => String(m.tier_id) === String(t.id)); }
        const st = a.status || 'active';
        if (st !== 'all') list = list.filter(m => (st === 'inactive' ? ended(m) : m.status === st));
        if (a.name) { const n = norm(a.name).replace(/\.$/, ''); list = list.filter(m => norm(m.name).includes(n) || norm(firstLast(m.name)).replace(/\.$/, '') === n); }
        const byTier = tiersOf(ctx).map(t => Object.assign({ tier: t.name + (Number(t.active) === 1 ? '' : ' (retired)') }, count(all.filter(m => String(m.tier_id) === String(t.id)))))
          .filter(x => !/\(retired\)$/.test(x.tier) || x.active || x.suspended || x.ended);
        return { totals: count(all), by_tier: byTier,
          members: list.slice(0, 40).map(m => {
            const p = primaryOf(ctx, m), g = groupOf(ctx, m).length;
            const note = [m.sub_status === 'past_due' && 'payment past due', m.billed && m.ending && m.period_end && `ends ${m.period_end}`, !m.billed && m.period_end && `shown as running until ${m.period_end}`,
              p && `a code on ${who(p)}'s group membership`, g && `group membership with ${plural(g, 'more code')}`].filter(Boolean).join('; ');
            return { who: who(m), number: '#' + ref(m), tier: m.tier_name || '(no tier)', status: m.status, joined: m.joined || undefined, billing: billingWords(m), note: note || undefined, phone: m.phone || undefined, email: m.email || undefined };
          }),
          showing: list.length > 40 ? `the first 40 of ${list.length} - narrow it by tier, status or name` : `${list.length} ${st === 'all' ? '' : (st === 'inactive' ? 'ended ' : st + ' ')}member${list.length === 1 ? '' : 's'}` };
      } },
    // GET /api/members/report (routes/members.js:425) and /api/members/stats (:392) - counts only (stats' first renewing
    // waiver carries a member's contact details and is left out)
    { name: 'members_report_read', area: 'members', kind: 'read',
      say: 'See the membership numbers: active members, billed online or by hand, past due, the monthly membership value, joins in the last 30 days, members by tier, and member hours this month',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const r = await ctx.call('GET', '/api/members/report');
        if (!r || r.status >= 400) return refused(r);
        const j = r.json || {};
        let s = {}; try { const q = await ctx.call('GET', '/api/members/stats'); if (q && q.status < 400) s = q.json || {}; } catch {}
        return { active_members: num(j.active_members), billed_online: num(j.billing_members), added_by_hand: num(j.manual_members), payment_past_due: num(j.past_due),
          monthly_value: `${dollars(j.mrr)} a month, ${dollars(j.arr)} a year (members billed online, at today's tier prices - Stripe bills each the price they joined at)`,
          joined_last_30_days: num(j.joins_30d),
          by_tier: (j.by_tier || []).map(t => ({ tier: t.name, active: num(t.active), cap: num(t.cap) > 0 ? `${t.cap}${num(t.active) >= num(t.cap) ? ' (full)' : ''}` : 'no cap', monthly_value: dollars(t.mrr) })),
          this_month: s.month_hours !== undefined ? { member_hours: num(s.month_hours), member_bookings: num(s.month_bookings) } : undefined,
          membership_waivers_to_renew: s.waivers_renewing ? num(s.waivers_renewing) : undefined };
      } },
    // GET /api/members/growth (routes/members.js) - who signed up in a period, against the period before and the same days a year
    // before, and the membership money paid in each (maintainer, Oct 25 2026: "Did anyone sign up this week? ... year over year, have we
    // grown? Do we have more members?" - the quick cards, quickcards.js); a span before the unit's first record is said to be
    { name: 'members_growth_read', area: 'members', kind: 'read',
      say: 'Who signed up as a member in a period (this week, this month, this year...) and how that compares with the period before and with the same days a year before, the membership money paid and by how many members, and how many members are active now. For "did anyone sign up", "new members", "do we have more members than last year", "are we growing"',
      params: { type: 'object', properties: { period: { type: 'string', enum: PERIODS, description: 'one of: ' + PERIODS.join(', ') + ' (this_month when not said; this_year for "than last year")' } } },
      local: async (a, ctx) => {
        const [from, to] = rangeOf(a, ctx.today);
        // the same day n months back, held to that month's last day (Mar 31 -> Feb 28)
        const back = (d, n) => { let y = +d.slice(0, 4), m = +d.slice(5, 7) - n; while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}-${pad(Math.min(+d.slice(8, 10), new Date(Date.UTC(y, m, 0)).getUTCDate()))}`; };
        const end = (d) => `${d.slice(0, 8)}${pad(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate())}`;
        const days = Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1;
        const before = { today: [addDays(from, -7), addDays(to, -7), 'the same day last week'], yesterday: [addDays(from, -7), addDays(to, -7), 'the same day the week before'],
          this_week: [addDays(from, -7), addDays(to, -7), 'the same days last week'], last_week: [addDays(from, -7), addDays(to, -7), 'the week before'],
          last_7_days: [addDays(from, -7), addDays(to, -7), 'the 7 days before'], this_month: [back(from, 1), back(to, 1), 'the same days last month'],
          last_month: [back(from, 1), end(back(from, 1)), 'the month before'], this_quarter: [back(from, 3), back(to, 3), 'the same days last quarter'],
          last_quarter: [back(from, 3), end(back(to, 3)), 'the quarter before'] }[a.from || a.to ? '' : (a.period || 'this_month')]
          || (a.period === 'this_year' || a.period === 'last_year' ? null : [addDays(from, -days), addDays(from, -1), days === 1 ? 'the day before' : `the ${days} days before`]);
        const year = [back(from, 12), back(to, 12)];
        const q = `from=${from}&to=${to}&yfrom=${year[0]}&yto=${year[1]}` + (before ? `&cfrom=${before[0]}&cto=${before[1]}` : '');
        const r = await ctx.call('GET', '/api/members/growth?' + q);
        if (!r || r.status >= 400) return refused(r);
        const j = r.json || {}, P = j.period || {};
        const said = (s, words) => (!s ? undefined : s.beforeRecords
          ? `${words} (${spanWords(s.from, s.to)}): the box has no records that far back - its first is ${j.firstRecord ? dayWords(j.firstRecord) : 'not yet'}`
          : `${words} (${spanWords(s.from, s.to)}): ${plural(num(s.joined), 'member')} signed up; ${cents(s.paid.cents)} in membership payments from ${plural(num(s.paid.members), 'member')}`);
        return { period: spanWords(from, to), signed_up: num(P.joined),
          who_signed_up: (P.who || []).length ? P.who.map(m => `${firstLast(m.name)}${m.tier ? ' - ' + m.tier : ''}, ${dayWords(m.day)}${m.status !== 'active' ? ' (' + m.status + ' now)' : ''}`) : 'nobody signed up',
          membership_payments: `${cents((P.paid || {}).cents)} from ${plural(num((P.paid || {}).members), 'member')}`,
          compared_with: [said(j.before, before && before[2]), said(j.yearBefore, 'the same days a year before')].filter(Boolean),
          active_members_now: num(j.activeNow),
          note: 'Signed up means the day a member was added to this box. The box keeps no count of members on a past day: "more than last year" is read from who signed up and who paid then and now.' };
      } },
    // GET /api/members/:id/usage (routes/members.js:633) - its `member` carries the PIN, phone and email: only the summary
    // and the last visits are kept
    { name: 'member_usage_read', area: 'members', kind: 'read', needs: ['money_members', 'money_member_tiers'],
      say: 'See how much a member has played: hours today, this week and this month, guests this month, their last visits, and the free time left on their tier',
      params: { type: 'object', properties: { member: MEMBER_PARAM }, required: ['member'] },
      local: async (a, ctx) => {
        const m = findMember(ctx, a.member);
        const r = await ctx.call('GET', '/api/members/' + encodeURIComponent(m.id) + '/usage');
        if (!r || r.status >= 400) return refused(r);
        const su = (r.json || {}).summary || {}, h = (x) => Math.round(num(x) / 6) / 10, left = (allow, used) => hours(Math.max(0, Math.round((allow - used) * 10) / 10));
        const t = tiersOf(ctx).find(x => String(x.id) === String(m.tier_id));
        const out = { member: who(m), phone: m.phone || undefined, email: m.email || undefined, tier: m.tier_name || '(no tier)', status: m.status,
          played: { today: hours(h(su.today_minutes)), this_week: hours(h(su.week_minutes)), this_month: hours(h(su.month_minutes)) }, guests_this_month: num(su.month_guest_count),
          last_visits: ((r.json || {}).usage || []).slice(0, 5).map(u => ({ date: u.date, minutes: num(u.duration_minutes), bay: u.bay_name || undefined, guests: num(u.guest_count) || undefined })) };
        if (t) {
          out.tier_gives = tierPriceWords(t);
          const v = num(t.discount_value), hpd = num(t.hours_per_day), hpw = num(t.hours_per_week), hpm = num(t.hours_per_month), free = [];
          if (t.discount_type === 'free_hours') free.push(`${left(hpm > 0 ? Math.min(hpm, v) : v, h(su.month_minutes))} free left this month`);
          if (t.discount_type === 'free_hours' || t.discount_type === 'daily_blend') {
            if (hpd > 0) free.push(`${left(hpd, h(su.today_minutes))} free left today`);
            if (hpw > 0) free.push(`${left(hpw, h(su.week_minutes))} free left this week (Monday to Sunday)`);
            if (t.discount_type === 'daily_blend' && hpm > 0) free.push(`${left(hpm, h(su.month_minutes))} free left this month`);
          }
          if (free.length) out.free_time = free.join('; ');
        }
        return out;
      } },
    // PUT /api/members/:id (routes/members.js:530) REPLACES the member - op 'merge'. The statuses the product knows: active,
    // suspended, inactive (public/admin.html:1978-1981, :6808). A member who is not active cannot book with their PIN
    // (services/db.js:1298) and the door console follows (services/memberaccess.js). Back to active moves the waiver anchor
    // (members.js:539 - a returning member signs the membership waiver again). Stripe is not told: a suspended member billed
    // online is still billed, and their next paid renewal sets them active again (services/membership-lifecycle.js:63).
    { name: 'member_status_set', area: 'members', kind: 'write', confirm: true, needs: ['money_members', 'money_member_tiers', 'money_booking'],
      say: 'Suspend a member (their PIN stops working until they are switched back on) or reactivate a suspended or ended member',
      params: { type: 'object', properties: { member: MEMBER_PARAM, status: { type: 'string', enum: ['suspended', 'active'], description: 'suspended to pause them, active to switch them back on' } }, required: ['member', 'status'] },
      build: (a, ctx) => {
        const m = findMember(ctx, a.member, a.status === 'suspended' ? (x) => x.status === 'active' : (x) => x.status !== 'active');
        const kids = groupOf(ctx, m).filter(k => k.status === m.status);
        if (a.status === 'suspended') {
          if (m.status !== 'active') throw new ActionError(`${who(m)} is not active (${m.status}) - there is nothing to suspend`);
          return steps([memberMerge(m.id, { status: 'suspended' })].concat(kids.map(k => memberMerge(k.id, { status: 'suspended' }))));
        }
        if (m.status === 'active') throw new ActionError(`${who(m)} is active already`);
        if (!tierOn(ctx, m.tier_id)) throw new ActionError(`${who(m)} is on "${tierName(ctx, m.tier_id)}", which is retired - their PIN would not work. Move them to a tier on offer (member_tier_move) or bring the tier back first`);
        // online billing that has ended (cancelled, or ended after its grace): the nightly check would switch them off again,
        // so they come back as a member the owner manages by hand - the subscription link goes, their Stripe customer stays
        const ended = m.billed && m.sub_status === 'canceled';
        return steps([ended ? memberMerge(m.id, { status: 'active', stripe_subscription_id: '' }, ['stripe_customer_id']) : memberMerge(m.id, { status: 'active' })]
          .concat(kids.map(k => memberMerge(k.id, { status: 'active' }))));
      },
      describe: (a, ctx) => {
        const m = findMember(ctx, a.member, a.status === 'suspended' ? (x) => x.status === 'active' : (x) => x.status !== 'active');
        const kids = groupOf(ctx, m).filter(k => k.status === m.status);
        const group = kids.length ? ` The ${plural(kids.length, 'other code')} on their group membership ${kids.length === 1 ? 'goes' : 'go'} with them.` : codeNote(ctx, m, 'changes');
        if (a.status === 'suspended') return `Suspend ${who(m)} (${m.tier_name || 'no tier'}): their member PIN stops working for booking${doorNote(ctx)} until you switch them back on. Bookings they already made stay on the schedule.` + group
          + (m.billed ? ' Stripe keeps billing them - suspending does not stop that, and their next paid renewal switches them back on by itself. To stop the billing, cancel the membership instead.' : '');
        const ended = m.billed && m.sub_status === 'canceled';
        return `Switch ${who(m)} back on (${m.tier_name || 'no tier'}): their member PIN works again for booking${doorNote(ctx)}.` + ((ctx.money_booking || {}).waiversOn === false ? '' : ' They sign the membership waiver again, as a returning member does.') + group
          + (ended ? ' Their online billing ended, so they come back as a member you manage by hand: no card is charged - you collect from them yourself; to pay online again they join on your memberships page.' : '');
      } },
    // PUT /api/members/:id (routes/members.js:530) with tier_id - op 'merge'. The route does not check the tier (POST does,
    // :488): a tier that is retired or unknown is refused here. Stripe is not told - billing stays at the old price.
    { name: 'member_tier_move', area: 'members', kind: 'write', confirm: true, needs: ['money_members', 'money_member_tiers'],
      say: 'Move a member to another membership tier (their benefits change at once)',
      params: { type: 'object', properties: { member: MEMBER_PARAM, tier: { ...TIER_PARAM, description: 'the tier to move them to' } }, required: ['member', 'tier'] },
      build: (a, ctx) => {
        const m = findMember(ctx, a.member, (x) => x.status === 'active'), t = findTier(ctx, a.tier);
        if (Number(t.active) !== 1) throw new ActionError(`"${t.name}" is retired - bring it back first (membership_tier_change with bring_back), or pick a tier on offer`);
        if (String(m.tier_id) === String(t.id)) throw new ActionError(`${who(m)} is on "${t.name}" already`);
        return steps([m].concat(groupOf(ctx, m)).map(x => memberMerge(x.id, { tier_id: t.id })));
      },
      describe: (a, ctx) => {
        const m = findMember(ctx, a.member, (x) => x.status === 'active'), t = findTier(ctx, a.tier), kids = groupOf(ctx, m);
        let s = `Move ${who(m)} from "${m.tier_name || 'no tier'}" to "${t.name}": from now on they get ${tierPriceWords(t)}, ${tierWhen(t)}.`;
        s += kids.length ? ` The ${plural(kids.length, 'other code')} on their group membership move${kids.length === 1 ? 's' : ''} too.` : codeNote(ctx, m, 'moves');
        if (num(t.roster_cap) > 0 && num(t.roster_count) >= num(t.roster_cap)) s += ` "${t.name}" is full (${t.roster_count} of ${t.roster_cap}), so this puts it over its cap.`;
        if (m.billed) s += ' Stripe keeps billing them the price they joined at - moving a tier here does not change their card\'s billing.';
        if (m.status !== 'active') s += ` They are ${m.status}, and stay that way.`;
        return s;
      } },
    // POST /api/members/:id/cancel { mode: 'period_end' | 'now' } (routes/members.js:1007) - Stripe's billing is stopped
    // first and a refusal changes nothing (:1012-1021); 'now' and any member not billed online end at once (:1024-1027);
    // 'period_end' on a billed member keeps them until the period ends and emails them the date (:1029-1035). The route does
    // not touch the other codes of a group membership, which "live and die together" everywhere else
    // (services/membership-lifecycle.js:102) - so those still active are switched off with it here: DELETE /api/members/:id
    // (routes/members.js:582, the Members screen's Deactivate). At a period end the nightly check ends them (:214-216).
    { name: 'membership_cancel', area: 'members', kind: 'write', confirm: true, needs: ['money_members', 'money_booking'],
      say: 'Cancel a member\'s membership. Ask the owner whether it ends now or at the end of the period they have paid for - never guess. Nothing is paid back either way',
      params: { type: 'object', properties: { member: MEMBER_PARAM, when: { type: 'string', enum: ['now', 'end_of_paid_period'] } }, required: ['member', 'when'] },
      build: (a, ctx) => {
        const m = findMember(ctx, a.member, (x) => x.status === 'active');
        if (m.status !== 'active') throw new ActionError(`${who(m)}'s membership is not active (${m.status}) - there is nothing to cancel`);
        if (m.billed && m.ending && a.when === 'end_of_paid_period') throw new ActionError(`${who(m)}'s membership is already set to end${m.period_end ? ' on ' + dayWords(m.period_end) : ''}`);
        const mode = a.when === 'now' ? 'now' : 'period_end', endsNow = mode === 'now' || !m.billed;
        const kids = endsNow ? groupOf(ctx, m).filter(k => k.status === 'active') : [];
        return steps([{ op: 'http', method: 'POST', path: '/api/members/' + encodeURIComponent(m.id) + '/cancel', body: { mode } }]
          .concat(kids.map(k => ({ op: 'http', method: 'DELETE', path: '/api/members/' + encodeURIComponent(k.id) }))));
      },
      describe: (a, ctx) => {
        const m = findMember(ctx, a.member, (x) => x.status === 'active');
        const endsNow = a.when === 'now' || !m.billed, kids = groupOf(ctx, m).filter(k => k.status === 'active');
        const group = kids.length ? ` The ${plural(kids.length, 'other code')} on their group membership ${endsNow ? 'stop' : 'end'}${kids.length === 1 ? 's' : ''} ${endsNow ? 'too' : 'with it'}.` : codeNote(ctx, m, 'ends');
        if (!endsNow) return `End ${who(m)}'s membership (${m.tier_name || 'no tier'}) when their paid period runs out${m.period_end ? ', on ' + dayWords(m.period_end) : ''}: Stripe makes no more charges, they keep their membership until then${m.has_email ? ', and they are emailed the date it ends' : ''}. Nothing is paid back.` + group;
        return `Cancel ${who(m)}'s membership (${m.tier_name || 'no tier'}) now: ` + (m.billed ? 'Stripe stops billing at once and nothing is paid back for the rest of this period; ' : `it is not billed online, so it ends now${a.when === 'end_of_paid_period' ? ' (there is no paid period to run out)' : ''}; `)
          + `their member PIN stops working for booking${doorNote(ctx)} today. Bookings they already made stay on the schedule.` + group;
      } },
    // POST /api/members/:id/extend { current_period_end } (routes/members.js:1042) - sets the date and makes the member
    // active. Only for members added by hand: for a member billed online, the nightly check writes Stripe's own date back
    // (services/membership-lifecycle.js:221). Nothing ends a by-hand membership on that date by itself (no reader of
    // current_period_end ends one).
    { name: 'membership_extend', area: 'members', kind: 'write', confirm: true, needs: ['money_members', 'money_member_tiers', 'money_booking'],
      say: 'Extend a membership you manage by hand (not billed online) through a date - it also switches an ended one back on',
      params: { type: 'object', properties: { member: MEMBER_PARAM, through: { ...DATE, description: 'the last day of the membership (YYYY-MM-DD)' } }, required: ['member', 'through'] },
      build: (a, ctx) => {
        const m = findMember(ctx, a.member);
        if (m.billed) throw new ActionError(`${who(m)} is billed online by Stripe, which keeps its own renewal date - the nightly check would put that date back, so extending it here would not stick`);
        if (a.through < ctx.today) throw new ActionError(`${dayWords(a.through)} has passed`);
        if (m.status !== 'active' && !tierOn(ctx, m.tier_id)) throw new ActionError(`${who(m)} is on "${tierName(ctx, m.tier_id)}", which is retired - their PIN would not work. Move them to a tier on offer (member_tier_move) or bring the tier back first`);
        const kids = m.status !== 'active' ? groupOf(ctx, m).filter(k => k.status === m.status) : [];
        return steps([{ op: 'http', method: 'POST', path: '/api/members/' + encodeURIComponent(m.id) + '/extend', body: { current_period_end: a.through } }].concat(kids.map(k => memberMerge(k.id, { status: 'active' }))));
      },
      describe: (a, ctx) => {
        const m = findMember(ctx, a.member), kids = m.status !== 'active' ? groupOf(ctx, m).filter(k => k.status === m.status) : [];
        return `Show ${who(m)}'s membership (${m.tier_name || 'no tier'}) as running through ${dayWords(a.through)}${m.period_end ? ` (it said ${dayWords(m.period_end)})` : ''}`
          + (m.status !== 'active' ? `, and switch it back on: their member PIN works again for booking${doorNote(ctx)}${kids.length ? `, with the ${plural(kids.length, 'other code')} on their group membership` : ''}` : '')
          + '. Nothing ends it on that date by itself - when it should end, cancel it.';
      } },
    // POST /api/members (routes/members.js:466 - tier_id, name and phone required; the tier must be active; a PIN is made
    // when none is typed). It answers { success, id, pin, ... }: the page's resultOf keeps only the id - the PIN never
    // reaches the model, and none is ever sent from here (a PIN typed in the chat would ride the conversation).
    { name: 'member_add', area: 'members', kind: 'write', confirm: true, needs: ['money_members', 'money_member_tiers', 'money_booking'],
      say: 'Add a member by hand (no card is charged - the owner collects from them). Needs their name, phone number and tier; email if they have one. The unit makes their PIN and shows it to the owner on their page (never to you)',
      params: { type: 'object', properties: { name: { type: 'string', minLength: 2, maxLength: 60, description: 'their full name' }, phone: { type: 'string', minLength: 1, maxLength: 20 }, email: { type: 'string', maxLength: 120 }, tier: TIER_PARAM }, required: ['name', 'phone', 'tier'] },
      build: (a, ctx) => {
        const t = findTier(ctx, a.tier);
        if (Number(t.active) !== 1) throw new ActionError(`"${t.name}" is retired - pick a tier on offer, or bring it back first`);
        if (!phoneOk(a.phone)) throw new ActionError(`"${a.phone}" is not a phone number`);
        if (a.email && !emailOk(a.email)) throw new ActionError(`"${a.email}" is not an email address`);
        // the PIN the unit makes is shown to the owner on the page only (op 'http' reveal) - never to the model
        return { op: 'http', method: 'POST', path: '/api/members', body: { tier_id: t.id, name: a.name, phone: a.phone, email: a.email ? a.email.trim() : '' }, reveal: [[`${a.name}'s member PIN`, 'pin']] };
      },
      describe: (a, ctx) => {
        const t = findTier(ctx, a.tier), same = membersOf(ctx).filter(m => norm(m.name) === norm(a.name) && m.status === 'active');
        return `Add ${a.name} as a "${t.name}" member, by hand: they get ${tierPriceWords(t)}, and no card is charged - you collect from them yourself (to pay online, people join on your memberships page). The unit makes their PIN${(ctx.money_booking || {}).memberDoor ? ', which also opens the door for their bookings' : ''}; it shows here for you only (and on the Members screen) - I never see it.`
          + (num(t.roster_cap) > 0 && num(t.roster_count) >= num(t.roster_cap) ? ` "${t.name}" is full (${t.roster_count} of ${t.roster_cap}), so this puts it over its cap.` : '')
          + (same.length ? ` There is already an active member called ${a.name} - this adds a second one.` : '');
      } },
    // POST /api/members/:id/new-pin (routes/members.js:120) - a new PIN, checked free on the door console; it answers the PIN,
    // which the page's resultOf drops ('ok')
    { name: 'member_new_pin', area: 'members', kind: 'write', confirm: true, needs: ['money_members', 'money_booking'],
      say: 'Give a member a new PIN (a lost or shared one): the old PIN stops working at once, and the new one shows to the owner on their page (never to you)',
      params: { type: 'object', properties: { member: MEMBER_PARAM }, required: ['member'] },
      build: (a, ctx) => { const m = findMember(ctx, a.member, (x) => x.status === 'active'); return { op: 'http', method: 'POST', path: '/api/members/' + encodeURIComponent(m.id) + '/new-pin', body: {}, reveal: [[`${who(m)}'s new member PIN`, 'pin']] }; },
      describe: (a, ctx) => { const m = findMember(ctx, a.member, (x) => x.status === 'active'); return `Give ${who(m)} a new member PIN: the old one stops working at once, for booking${doorNote(ctx)}. The new PIN shows here for you only (and on the Members screen) - I never see it.`; } },
    // PUT /api/members/:id (routes/members.js:530) with name, phone or email - op 'merge'. The route stores the phone the way
    // every phone is kept (services/phone.js normalize); Stripe keeps its own copy of a billed member's email.
    { name: 'member_details_set', area: 'members', kind: 'write', confirm: true, needs: ['money_members'],
      say: 'Correct a member\'s name, phone number or email',
      params: { type: 'object', properties: { member: MEMBER_PARAM, name: { type: 'string', minLength: 2, maxLength: 60, description: 'their name as it should be' }, phone: { type: 'string', minLength: 1, maxLength: 20 }, email: { type: 'string', maxLength: 120 } }, required: ['member'] },
      build: (a, ctx) => {
        const m = findMember(ctx, a.member), set = {};
        if (a.name) set.name = a.name;
        if (a.phone) { if (!phoneOk(a.phone)) throw new ActionError(`"${a.phone}" is not a phone number`); set.phone = a.phone; }
        if (a.email) { if (!emailOk(a.email)) throw new ActionError(`"${a.email}" is not an email address`); set.email = a.email.trim(); }
        if (!Object.keys(set).length) throw new ActionError('say what to correct: their name, phone number or email');
        return memberMerge(m.id, set);
      },
      describe: (a, ctx) => {
        const m = findMember(ctx, a.member), what = [a.name && `name to "${a.name}"`, a.phone && 'phone number', a.email && 'email'].filter(Boolean);
        return `Change ${who(m)}'s ${andList(what)}${a.phone || a.email ? ` to the ${a.phone && a.email ? 'ones' : 'one'} you gave` : ''}.` + (a.email && m.billed ? ' Their card receipts from Stripe still go to the email Stripe has.' : '');
      } },
  ];

  return { actions, loaders, words: { tierWords, tierPriceWords, pastDate, rangeOf, spanWords, PERIODS, PAST_DATE, cents, num } };
};
