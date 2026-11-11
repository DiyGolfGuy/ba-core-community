// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/bays.js - the assistant's bays actions (Oct 20 2026).
// Built with the helpers services/assistant/actions.js hands every area (HELPERS); same rules as the actions there.
//
// maintainer, Oct 20 2026: "control the bays ... the bays can still be part of the booking software inside the computer but the AI
// can control it all. turn on one smart thing or the full bay." Every action here is a request Bay Operations, the Shutdown
// & Warning Timing card, the bay editor or Automation Health already makes (routes/admin.js, cited per action), or the
// Settings save of the bay editor's own keys. The model never sees a customer's name, phone, email or door code, a Windows
// password (only "saved" or "not saved") or a learned IR code. A door lock is never locked or unlocked from here: a bay that
// holds a Home Assistant lock is switched from Bay Operations by the owner's own hand.
//
// What this file stands on (each read in the code, Oct 20 2026):
//  - Bay On / Bay Off (POST /api/admin/shelly/bay) is the TEE-TIME procedure, services/sequence.js: On wakes the PC (its
//    wake ID), switches every plug on, sends every learned IR on code, turns Home Assistant devices on (a thermostat to its
//    comfort temperature). Off shuts the PC down FIRST and waits up to automation.manualOffGraceSecs for it, then switches
//    off every plug not set to stay on, sends every IR off code, turns every HA device off (a thermostat to its eco
//    temperature). A one-button (toggle) TV the command ledger says is already that way is held back; the same press again
//    within two minutes sends it anyway. It answers ok:false when any step failed.
//  - All bays (POST /api/admin/shelly/on|off) runs that procedure bay after bay over every bay not switched off in the list -
//    out-of-service bays INCLUDED - and always answers ok:true.
//  - Out of service (POST /api/admin/bays/:id/maintenance) takes the bay off the booking page and darkens its devices for
//    EVERY session (services/bookingcore.darkBayIds), bookings already made included; it cancels and moves nothing. Taken
//    out mid-session, the unit stops driving that bay at once, so that session's switch-offs never run.
//  - The close override is a TOGGLE route (POST /api/admin/close-override/:bayId); the scheduler honours it once - the next
//    session on that bay ending exactly at closing keeps its PC on - and clears it. It touches the PC shutdown only.
//  - GET /api/session/status is NEVER called from here: every call is taken as the bay PC's watcher asking
//    (services/baypresence.note), which the Wake-on-LAN check reads as "the PC is up".
'use strict';
const crypto = require('crypto');

module.exports = (H) => {
  const { ActionError, dayWords, timeWords, addDays, bayIndex } = H;

  // ── words ────────────────────────────────────────────────────────────────────
  const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? d : Number(v);
  const mins = (n) => `${n} minute${Number(n) === 1 ? '' : 's'}`;
  const and = (xs) => { xs = (xs || []).filter(Boolean); return xs.length < 2 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; };
  const isAre = (xs) => (xs.length === 1 ? 'is' : 'are');
  const dollars = (c) => '$' + (Math.abs(c) / 100).toFixed(2).replace(/\.00$/, '');
  const cap = (s) => String(s).replace(/^./, c => c.toUpperCase());
  const arr = (v) => (Array.isArray(v) ? v : []);

  // ── which bay: its id, or its name as the owner says it (helpers.bayIndex) ──
  // (actions.js's bays loader answers an empty list when the settings cannot be read: that is said as what it is)
  const noBays = (ctx) => (ctx.bayConfig && ctx.bayConfig.read === false ? 'the settings could not be read just now - try again in a moment' : 'no bays are set up yet - they are added in Admin > Bays & Devices, or I can add one');
  function findBay(ctx, words) {
    const bays = ctx.bays || [];
    if (!bays.length) throw new ActionError(noBays(ctx));
    let i = bays.findIndex(b => lc(b.id) === lc(words));
    if (i < 0) i = bayIndex(ctx, words);
    return { i, bay: bays[i] };
  }
  const settingsRead = (ctx) => { const C = ctx.bayConfig; if (!C || !C.read) throw new ActionError('the settings could not be read just now - try again in a moment'); return C; };

  // ── the devices on a bay, as the bay editor keeps them (admin.html readBaysFromEditor) ──
  function devicesOn(bay) {
    const out = [];
    arr(bay.shellyDevices).forEach((d, j) => { if (d && d.ip) out.push({ family: 'plug', list: 'shellyDevices', j, key: 'ip', id: d.ip, name: d.name || '', d }); });
    arr(bay.broadlinkDevices).forEach((d, j) => { if (d && d.ip) out.push({ family: 'ir', list: 'broadlinkDevices', j, key: 'ip', id: d.ip, name: d.name || '', d }); });
    arr(bay.haDevices).forEach((d, j) => { if (d && d.entity_id) out.push({ family: d.kind === 'climate' ? 'climate' : 'ha', list: 'haDevices', j, key: 'entity_id', id: d.entity_id, name: d.name || '', d }); });
    return out;
  }
  const label = (x) => (x.name ? `${x.name} (${x.id})` : x.id);
  const FAMILY_WORD = { plug: 'smart plug', ir: 'TV remote (IR)', ha: 'smart-home device', climate: 'thermostat' };
  // a kind word ("the TV", "the thermostat") finds the one device of that kind on the bay
  const KIND_WORDS = [['ir', /\b(tvs?|televisions?|ir|remotes?|broadlink)\b/], ['climate', /\b(thermostats?|heat|heaters?|heating|a\/?c|cool|cooling|climate|temperature|furnace)\b/], ['plug', /\b(plugs?|shelly|outlets?|sockets?)\b/]];
  function deviceOnBay(bay, words, families) {
    const n = lc(words);
    const all = devicesOn(bay).filter(x => !families || families.includes(x.family));
    const one = (m) => (m.length === 1 ? m[0] : null);
    let hit = one(all.filter(x => lc(x.id) === n));
    if (!hit) {
      const exact = all.filter(x => x.name && lc(x.name) === n);
      if (exact.length > 1) throw new ActionError(`more than one device on ${bay.name} is called "${words}" - say its address: ${exact.map(label).join(', ')}`);
      hit = one(exact) || one(all.filter(x => x.name && (lc(x.name).includes(n) || n.includes(lc(x.name)))));
    }
    if (!hit) for (const [fam, re] of KIND_WORDS) if (re.test(n)) { hit = one(all.filter(x => x.family === fam)); if (hit) break; }
    if (!hit) throw new ActionError(`no ${families && families.length === 1 ? FAMILY_WORD[families[0]] : 'device'} called "${words}" on ${bay.name} (on it: ${all.map(label).join(', ') || 'nothing yet'})`);
    return hit;
  }
  // when a device comes on and goes off around a session - the scheduler's own reading (services/scheduler.js: a Shelly or
  // Home Assistant power device goes off only when turnOffAfter is set; a TV only with an off code learned; 10/30/15/10
  // when never set)
  function timingWords(x) {
    const d = x.d;
    if (x.family === 'climate') {
      const T = require('../../homeassistant').climateTargets(d);
      return `${d.comfortTemp != null ? `${d.comfortTemp} degrees from ${mins(num(d.leadTimeMins, 15))} before each session` : 'no session temperature set'}, `
        + `${T.eco ? `${mins(num(d.setbackDelayMins, 10))} after it ends: ${T.eco.heat} degrees while heating, ${T.eco.cool} with the AC on` : 'left as it is after'}`;
    }
    const on = x.family === 'ir' && !d.onCommand ? 'not switched on (no on code learned)' : `on ${mins(num(d.minutesBefore, 10))} before each session`;
    const off = x.family === 'ir' && !d.offCommand ? 'not switched off (no off code learned)' : d.turnOffAfter ? `off ${mins(num(d.minutesAfter, 30))} after it ends` : 'left on after';
    return `${on}, ${off}`;
  }

  // ── the facility's clock (its own time zone, as services/revenue.facilityToday reads it) and the bookings on a line ──
  function clockOf(tz) {
    const d = new Date();
    try {
      const p = {};
      for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)) p[x.type] = x.value;
      return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
    } catch {
      const pad = (v) => String(v).padStart(2, '0');
      return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, mins: d.getHours() * 60 + d.getMinutes() };
    }
  }
  const toMins = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const dayNo = (iso) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000);
  const abs = (date, time) => dayNo(date) * 1440 + toMins(time);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const endWords = (s, today) => timeWords(s.end) + (s.endDate === today ? '' : s.endDate === addDays(today, 1) ? ' (after midnight)' : ' on ' + dayWords(s.endDate));
  async function getJson(ctx, p) { try { const r = await ctx.call('GET', p); return r && r.status < 400 ? (r.json || null) : null; } catch { return null; } }

  // what is on each bay right now, and what is still to come today (no names: only times)
  function stateOf(ctx, bay) {
    const N = ctx.bayNow;
    if (!N || !N.read) return null;
    const now = dayNo(N.clock.date) * 1440 + N.clock.mins, dayEnd = (dayNo(N.clock.date) + 1) * 1440;
    const mine = N.sessions.filter(s => s.bay_id === bay.id || s.whole);
    const blocks = N.blocks.filter(k => k.bay_id === bay.id || k.whole);
    const playing = mine.find(s => s.a <= now && now < s.b) || blocks.find(k => k.type !== 'maintenance' && k.a <= now && now < k.b) || null;
    const down = blocks.find(k => k.type === 'maintenance' && k.a <= now && now < k.b) || null;
    const later = mine.filter(s => s.a > now && s.a < dayEnd).sort((x, y) => x.a - y.a);
    return { now, today: N.clock.date, playing, down, later, blocks: blocks.filter(k => k.b > now && k.a < dayEnd) };
  }
  const playingKind = (p) => (p.type ? `${p.type === 'tournament' ? 'a tournament' : 'an event'}${p.label ? ' (' + p.label + ')' : ''}` : p.whole ? 'a whole-facility booking' : 'a session');
  const playingWords = (p, today) => `${playingKind(p)} until ${endWords(p, today)}`;
  const playingNow = (bay, st) => `${cap(playingKind(st.playing))} is on ${bay.name} now, until ${endWords(st.playing, st.today)}`;
  // the side effect a change has on a session playing there now, in words
  function playingNote(ctx, bay, tail) {
    const st = stateOf(ctx, bay);
    if (!st) return ` (I could not check whether a session is on ${bay.name} now.)`;
    return st.playing ? ` ${playingNow(bay, st)} - ${tail}.` : '';
  }

  // ── the automation's jobs (GET /api/admin/automation/health, routes/admin.js:798 -> services/automation.health) ──
  // A job is named by a short code made from what the retry route needs (booking, kind, device), so the model copies six
  // characters, never a booking id, and the code stays the same from one look to the next.
  const jobCode = (bookingId, kind, key) => crypto.createHash('sha1').update(`${bookingId}|${kind}|${key}`).digest('hex').slice(0, 6);
  // the error a job failed with, with nothing personal left in it: no email address, phone number, door code or PIN (any run
  // of four or more digits that is not part of a network address, a date or a time), no key
  function plainWhy(s) {
    let t = String(s || '').replace(/^Retry pressed - it had failed: /, '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    try { t = require('../secrets').scrub(t).text; } catch {}
    t = t.replace(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/gi, '[an email address]');
    const kept = [];
    t = t.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b|\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b|\b\d{1,2}:\d{2}\b/g, m => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
    t = t.replace(/\+?\d[\d\s().-]{5,}\d/g, m => (m.replace(/\D/g, '').length >= 6 ? '[a number]' : m));
    t = t.replace(/\d{4,}/g, '[a number]');
    t = t.replace(/\u0000(\d+)\u0000/g, (_, k) => kept[Number(k)]);
    return t.length > 140 ? t.slice(0, 140).replace(/\s+\S*$/, '') + '...' : t;
  }
  function jobTarget(bays, kind, key, bookingBay, cfg) {
    const k = String(key || '');
    const owners = (pred) => bays.filter(pred);
    // the whole facility's own device (Oct 21 2026): 'fac:<entity>#<n>'
    const fac = /^fac:(.*)#\d+$/.exec(k);
    if (fac) { const d = arr(((cfg || {}).homeAssistant || {}).facilityDevices).find(x => x && x.entity_id === fac[1]); return { bay: 'the facility', name: d ? (d.name || fac[1]) : fac[1], climate: !!(d && d.kind === 'climate'), facility: true }; }
    if (/^(wol|restart)(:|$)/.test(k)) { const id = k.split(':')[1]; const b = id ? bays.find(x => x.id === id) : null; return { bay: b ? b.name : bookingBay, name: '' }; }
    if (k.endsWith('_ha')) {
      const e = k.slice(0, -3); const o = owners(b => arr(b.haDevices).some(d => d && d.entity_id === e));
      const d = o.length ? arr(o[0].haDevices).find(x => x && x.entity_id === e) : null;
      return { bay: o.length === 1 ? o[0].name : bookingBay, name: d ? (d.name || e) : e, climate: !!(d && d.kind === 'climate') };
    }
    if (kind === 'ir_on' || kind === 'ir_off') {
      const ip = k.split('#')[0]; const o = owners(b => arr(b.broadlinkDevices).some(d => d && d.ip === ip));
      const names = o.length ? arr(o[0].broadlinkDevices).filter(x => x && x.ip === ip).map(x => x.name || ip) : [ip];
      return { bay: o.length === 1 ? o[0].name : bookingBay, name: names.join(' or ') };
    }
    if (k) {
      const o = owners(b => arr(b.shellyDevices).some(d => d && d.ip === k));
      const d = o.length ? arr(o[0].shellyDevices).find(x => x && x.ip === k) : null;
      return { bay: o.length === 1 ? o[0].name : bookingBay, name: d ? (d.name || k) : k, plug: true };
    }
    return { bay: bookingBay, name: '' };
  }
  function jobWhat(kind, key, t) {
    const dev = t.name ? (t.plug ? `the plug "${t.name}"` : `"${t.name}"`) : '';
    if (/^wol(:|$)/.test(String(key || '')) && kind === 'power_on') return 'wake the PC before the session';
    switch (kind) {
      case 'power_on': return t.climate ? `set ${dev} to its session temperature` : `switch on ${dev || 'a device'}`;
      case 'power_off': return t.climate ? `set ${dev} back to its idle temperature` : `switch off ${dev || 'a device'}`;
      case 'facility_on': return t.climate ? `set ${dev} to its comfort temperature for the facility's bookings` : `switch on ${dev || 'a facility device'} for the facility's bookings`;
      case 'facility_off': return t.climate ? `set ${dev} back to standby` : `switch off ${dev || 'a facility device'} - nothing booked inside its gap`;
      case 'ir_on': return `send the on code to ${dev || 'the TV'}`;
      case 'ir_off': return `send the off code to ${dev || 'the TV'}`;
      case 'shutdown': return 'shut the PC down after the session';
      case 'pc_check': return 'check the PC came on after its wake-up';
      case 'pc_restart': return 'restart the PC before the next group';
      case 'door_code': return 'put the door code on the lock';
      case 'door_text': return 'send the customer their door code';
      case 'door_revoke': return 'take the door code off the lock after the session';
      case 'door_window': return 'move the door code\'s times';
      case 'reminder': return 'send the reminder';
      case 'ending_warning': return 'send the "your session is ending" message';
      default: return String(kind || 'a job').replace(/_/g, ' ');
    }
  }
  // kinds the unit can still run only up to a point (services/scheduler.js ensureJob deadlines): the session's end, its
  // start (the reminder), before its start (the restart). A retried job past that point is written off again as missed
  // (services/automation.js claim) while the retry route answers ok - so it is refused here instead, in words.
  const UNTIL_END = ['power_on', 'ir_on', 'pc_check', 'door_code', 'door_text', 'ending_warning'];
  const UNTIL_START = ['reminder', 'pc_restart'];
  function jobsOf(j, bays, facility) {
    const failed = arr(j.failed).map(f => {
      // a switch-off for a bay a moved session LEFT: its key is 'left:<bay id>|<device>' (services/automation.js
      // queueLeftBay); health() names that bay "<name> (the session moved from it)" and drops the prefix from the device
      let key = f.device || '', bookingBay = f.bay || '';
      const left = /^(.*) \(the session moved from it\)$/.exec(f.bay || '');
      if (left) { const b = bays.find(x => x.name === left[1]) || bays.find(x => x.id === left[1]); bookingBay = b ? b.name : left[1]; key = `left:${b ? b.id : left[1]}|${f.device || ''}`; }
      const dev = left ? (f.device || '') : key;
      const t = jobTarget(bays, f.kind, dev, bookingBay, { homeAssistant: { facilityDevices: Array.isArray(facility) ? facility : [] } });
      const [date, time] = String(f.when || '').split(' ');
      return { code: jobCode(f.booking_id, f.kind, key), booking_id: f.booking_id, kind: f.kind, device_key: key, moved: !!left, bay: t.bay || bookingBay || '',
        date: isDate(date) ? date : null, time: /^\d{2}:\d{2}$/.test(time || '') ? time : null,
        what: jobWhat(f.kind, dev, t), status: f.status, attempts: Number(f.attempts) || 0, why: plainWhy(f.error) };
    });
    return { read: true, failed, retrying: arr(j.retrying).length, overdue: Number(j.overdue) || 0, hours: Number(j.window_hours) || 48 };
  }
  const whenWords = (f) => (f.date ? `${dayWords(f.date)}${f.time ? ', ' + timeWords(f.time) : ''}` : null);
  const forSession = (f) => (f.date ? `for the ${whenWords(f)} session` : 'for an earlier session');
  const statusWords = (f) => (f.status === 'missed' ? 'was missed' : `failed${f.attempts ? ` after ${f.attempts} ${f.attempts === 1 ? 'try' : 'tries'}` : ''}`);
  const problemLine = (f) => `${f.what} ${forSession(f)}: ${statusWords(f)}${f.why ? ' - ' + f.why : ''} (job ${f.code})`;

  // which failed jobs to try again, from the job code or the bay - shared by automation_retry's build and its words
  function retryPlan(a, ctx) {
    const J = ctx.bayJobs;
    if (!J || !J.read) throw new ActionError('the automation list could not be read just now - try again in a moment');
    let jobs;
    if (a.job) {
      const code = lc(a.job).replace(/^job\s*/, '');
      const f = J.failed.find(x => x.code === code);
      if (!f) throw new ActionError(`no failed job "${a.job}" right now${J.failed.length ? ' - the failed ones: ' + J.failed.slice(0, 8).map(x => `${x.code} (${x.what}${x.bay ? ', ' + x.bay : ''})`).join('; ') : ' - nothing has failed'}`);
      jobs = [f];
    } else if (a.bay) {
      const { bay } = findBay(ctx, a.bay);
      jobs = J.failed.filter(x => x.bay === bay.name);
      if (!jobs.length) throw new ActionError(`nothing has failed on ${bay.name}`);
    } else throw new ActionError('say which job (its code from automation_read) or which bay');
    const N = ctx.bayNow;
    let gone = [];
    if (N && N.read) {
      const nowAbs = dayNo(N.clock.date) * 1440 + N.clock.mins;
      // still on or still to come: a customer booking not yet over, or an event or tournament not yet over
      const live = new Set(N.sessions.map(s => s.id).concat(N.blocks.filter(k => k.b > nowAbs).map(k => k.id)));
      const over = (f) => (UNTIL_END.includes(f.kind) && !f.moved && !live.has(f.booking_id) && f.date && f.date <= N.clock.date)
        || (UNTIL_START.includes(f.kind) && f.date && f.time && abs(f.date, f.time) <= nowAbs);
      gone = jobs.filter(over);
      if (gone.length === jobs.length) throw new ActionError(gone.length === 1 ? `that session is over (or has started), so the unit can no longer ${gone[0].what} for it - there is nothing to try again` : 'those sessions are over, so nothing there can run any more - there is nothing to try again');
      jobs = jobs.filter(f => !over(f));
    }
    jobs = jobs.slice(0, 10);
    const reqs = jobs.map(f => ({ op: 'http', method: 'POST', path: '/api/admin/automation/retry', body: { booking_id: f.booking_id, kind: f.kind, device_key: f.device_key } }));
    return { jobs, gone, op: reqs.length === 1 ? reqs[0] : { op: 'steps', steps: reqs } };
  }

  // ── what a whole-bay On or Off does, read from the bay as services/sequence.js planStart/planStop read it ──
  // a smart-home device on the whole facility's own list too: the facility's times decide it, never one bay
  const onFacility = (d) => { try { return require('../../facilitydevices').has(require('../../config').getConfig(), d.entity_id); } catch { return false; } };
  function switchPlan(bay, on) {
    const plugs = arr(bay.shellyDevices).filter(Boolean), ir = arr(bay.broadlinkDevices).filter(d => d && d.ip), ha = arr(bay.haDevices).filter(d => d && d.entity_id != null);
    const nm = (d, f) => d.name || d[f] || 'a device';
    const p = { parts: [], kept: [], noCode: [], toggles: [], ha: [], facility: [], pcOff: false, locks: ha.filter(d => /^lock\./i.test(String(d.entity_id)) && !onFacility(d)).map(d => nm(d, 'entity_id')) };
    if (on) {
      if (bay.pcMac) p.parts.push('wake its PC');
      if (plugs.length) p.parts.push(`switch on ${plugs.length === 1 ? 'the plug' : 'the plugs'} ${and(plugs.map(d => nm(d, 'ip')))}`);
      for (const d of ir) { if (d.onCommand) { p.parts.push(`send the on code to ${nm(d, 'ip')}`); if (d.codeStyle !== 'discrete') p.toggles.push(nm(d, 'ip')); } else p.noCode.push(nm(d, 'ip')); }
      for (const d of ha) { if (onFacility(d)) { p.facility.push(nm(d, 'entity_id')); continue; } p.parts.push(d.comfortTemp != null ? `set ${nm(d, 'entity_id')} to ${d.comfortTemp} degrees` : `switch on ${nm(d, 'entity_id')}`); p.ha.push(nm(d, 'entity_id')); }
    } else {
      p.pcOff = !!bay.simulatorPcIp;
      const off = plugs.filter(d => d.turnOffAfter !== false);
      p.kept = plugs.filter(d => d.turnOffAfter === false).map(d => nm(d, 'ip'));
      if (off.length) p.parts.push(`switch off ${off.length === 1 ? 'the plug' : 'the plugs'} ${and(off.map(d => nm(d, 'ip')))}`);
      // what the bay's Off really does (services/sequence.planStop - the device audit: these words said every TV and every
      // smart-home device went off): a device set to stay on is left on, a thermostat goes to its idle temperature for the mode
      // it is in, and the whole facility's own devices are never touched by one bay's Off
      for (const d of ir) { if (d.offCommand && d.turnOffAfter !== false) { p.parts.push(`send the off code to ${nm(d, 'ip')}`); if (d.codeStyle !== 'discrete') p.toggles.push(nm(d, 'ip')); } else if (d.offCommand) p.kept.push(nm(d, 'ip')); else p.noCode.push(nm(d, 'ip')); }
      for (const d of ha) {
        if (onFacility(d)) { p.facility.push(nm(d, 'entity_id')); continue; }
        if (d.ecoTemp != null) { const T = require('../../homeassistant').climateTargets(d).eco; p.parts.push(`set ${nm(d, 'entity_id')} to its idle temperature (${T.heat} heating, ${T.cool} cooling)`); }
        else if (d.turnOffAfter !== false) p.parts.push(`switch off ${nm(d, 'entity_id')}`);
        else { p.kept.push(nm(d, 'entity_id')); continue; }
        p.ha.push(nm(d, 'entity_id'));
      }
    }
    p.nothing = !p.parts.length && !p.pcOff;
    return p;
  }
  const lockRefusal = (names) => new ActionError(`${names}: a door lock is among its Home Assistant devices, and the assistant never locks or unlocks a door - switch it from Bay Operations in Admin, or I can switch its plugs and other devices one at a time`);

  // ── the bay entry bay_read gives the model (full: every device and its timing; short: one line each). The problems are
  //    written out only when one bay is asked about; the whole-facility look counts them (automation_read lists them) ──
  function bayEntry(ctx, bay, live, full, one) {
    const C = ctx.bayConfig || {};
    const st = stateOf(ctx, bay);
    const e = { bay: bay.name };
    if (bay.active === false) e.in_use = 'no - switched off in the bay list: not booked and not driven';
    e.service = bay.maintenance ? 'OUT OF SERVICE - customers cannot book it and its equipment stays off' : 'in service';
    if (!st) e.now = 'could not be read just now';
    else {
      e.now = st.down ? `blocked for maintenance until ${endWords(st.down, st.today)}${st.down.label ? ' (' + st.down.label + ')' : ''}` : st.playing ? playingWords(st.playing, st.today) : 'free';
      if (bay.maintenance && st.playing) e.now += ' - booked while out of service: nothing is switched on for it';
      if (st.later.length) e.next_today = timeWords(st.later[0].start) + (bay.maintenance ? ' - booked while out of service: nothing is switched on for it' : '');
      if (full && st.later.length > 1) e.sessions_still_to_come_today = st.later.length;
      const others = st.blocks.filter(k => k !== st.down && k !== st.playing);
      if (full && others.length) e.blocks_today = others.slice(0, 3).map(k => `${k.type}${k.whole ? ' (the whole facility)' : ''} ${timeWords(k.start)} - ${endWords(k, st.today)}${k.label ? ': ' + k.label : ''}`);
    }
    // the PC: how the unit reaches it and what it does with it (never the Windows password, only whether one is saved)
    const ip = String(bay.simulatorPcIp || '').trim(), mac = String(bay.pcMac || '').trim(), pass = !!bay.simulatorWinPass;
    const L = live && live[bay.id];
    if (!ip && !mac) e.pc = 'not set up (no address, no wake ID)';
    else {
      e.pc = [ip ? `address ${ip}` : 'no address', mac ? 'wake ID saved' : 'no wake ID', ip ? (pass ? 'Windows sign-in saved' : 'no Windows sign-in saved') : null,
        L && L.pc ? (L.pc.online ? 'answering now' : 'not answering now (off, or not reachable)') : null].filter(Boolean).join(', ');
      if (full) {
        const wake = C.pcWakeAll != null ? C.pcWakeAll : num(bay.pcWakeMinutesBefore, 10);
        const down = !C.read ? 'whether it is shut down after sessions could not be read'
          : !C.shutdown.enabled ? 'not shut down after sessions (auto-shutdown is off)'
          : ip && pass ? `shut down after each session (left on when the next starts within ${mins(C.keepOnGapMins)})`
          : `not shut down after sessions - ${ip ? 'no Windows sign-in saved' : 'no PC address'}`;
        e.pc_timing = `${mac ? `woken ${mins(wake)} before each session` : 'not woken by the unit'}; ${down}`;
      }
    }
    if (bay.closeOverride) e.closing_override = 'ON - the next session here that ends at closing keeps its PC on (then it resets itself)';
    const devs = devicesOn(bay);
    const by = (f) => devs.filter(x => f.includes(x.family));
    const P = by(['plug']).length && L && L.plug ? L.plug : null;   // the live answer, for a bay that has a plug
    if (full) {
      if (by(['plug']).length) e.plugs = by(['plug']).map(x => `${label(x)}: ${timingWords(x)}`);
      if (P) e.first_plug_now = P.unreachable ? 'not answering' : (P.on ? 'on' : 'off') + (P.on && P.watts != null ? `, drawing ${P.watts} W` : '');
      if (by(['ir']).length) e.tv_remotes = by(['ir']).map(x => `${label(x)}: ${x.d.codeStyle === 'discrete' ? 'separate on and off codes' : 'one power button (toggle)'}; ${timingWords(x)}`);
      if (by(['ha', 'climate']).length) e.smart_home = by(['ha', 'climate']).map(x => `${label(x)}: ${timingWords(x)}`);
    } else {
      const n = (f, w) => { const c = by(f).length; return c ? `${c} ${w}${c === 1 ? '' : 's'}` : null; };
      e.devices = and([n(['plug'], 'plug'), n(['ir'], 'TV remote'), n(['ha', 'climate'], 'smart-home device')]) || 'none';
      if (P) e.first_plug_now = P.unreachable ? 'not answering' : P.on ? 'on' : 'off';
    }
    // its routines on its PC beside its devices (Oct 21 2026, night): what happens on this bay when a session starts or ends
    // is one answer - "Start GSPro: 10 minutes before each session"
    const RT = ctx.bayRoutines && ctx.bayRoutines.read ? ((ctx.bayRoutines.bays || []).find(x => x.id === bay.id) || {}).routines || [] : [];
    if (RT.length) e.routines = full ? RT.map(r => `${r.name}: ${r.when.length ? r.when.join(', ') : 'only when asked'}${r.enabled ? '' : ' (paused)'}${r.last_run_at && !r.last_ok ? ` - last run stopped: ${r.last_detail}` : ''}`)
      : `${RT.length} on its PC (routines_read)`;
    const J = ctx.bayJobs && ctx.bayJobs.read ? ctx.bayJobs.failed.filter(f => f.bay === bay.name) : [];
    if (J.length) e.problems = one ? J.slice(0, 4).map(problemLine).concat(J.length > 4 ? [`and ${J.length - 4} more (automation_read)`] : []) : `${J.length} failed or missed (automation_read lists them)`;
    return e;
  }

  // bay_device_timing_set's work, shared by its build and its words: the op, and the sentence
  const PC_WORDS = /^(the\s+)?(pc|computer|simulator|simulator pc|sim|sim pc|pc wake|pc wake-?up|wake-?up)$/;
  // ── ROUTINES TAUGHT ON A BAY PC (Oct 21 2026; maintainer: "watch what I'm gonna do on Bay 2 ... and then I want it to start on
  //    windows startup, or ... when this program opens"; services/routines.js, routes/routines.js) ──
  // A BAY THE OWNER NAMED, for the box's own reads of a routine said plainly (Oct 23 2026): the longest of the facility's own bay
  // names in the words ("The Vault" also as "vault"), else nothing - a read never guesses a bay
  function bayNamedIn(ctx, words) {
    const t = ' ' + lc(words).replace(/[^a-z0-9 ]+/g, ' ') + ' ';
    const names = (Array.isArray(ctx.bays) ? ctx.bays : []).map(b => b && b.name).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const n of names) {
      const k = lc(n).replace(/[^a-z0-9 ]+/g, ' ').trim(), short = k.replace(/^the /, '');
      if (t.includes(' ' + k + ' ') || (short.length >= 4 && t.includes(' ' + short + ' '))) return n;
    }
    return null;
  }
  // "watch what I do on Bay 1, it starts GSPro" (Oct 23 2026, the 4B both times: it read the routines and asked instead of teaching)
  function teachRead(words, conv, ctx) {
    const s = String(words || '');
    if (!/\b(?:watch|record|learn|teach)\w*\b[^.?!]{0,25}?\b(?:what i(?:'?m| am)? (?:do|doing|click|clicking|gonna do|going to do)|me|this|my clicks|how i)\b/i.test(s)) return null;
    const bay = bayNamedIn(ctx, s); if (!bay) return null;
    const v = s.match(/\b(?:starts?|opens?|launch(?:es)?|loads?|fires? up|boots?)\s+(?:up\s+)?(?:the\s+)?/i);
    const p = v ? s.slice(v.index + v[0].length).match(/^([A-Za-z0-9][\w.+-]*(?:\s+[A-Z0-9][\w.+-]*)?)/) : null;
    const prog = p && !/^(?:it|a|an|the|up|and|then|my|our|on|at|in)$/i.test(p[1]) ? p[1] : null;
    return prog ? { bay, name: ('Start ' + prog).slice(0, 40) } : { bay };
  }
  // "close GSPro on Bay 1 when each session ends" (Oct 23 2026, the 4B both times: it changed a routine that does not exist) - a
  // program closed when a session ends or starts, made from words alone (nothing clicked, nothing opened)
  function closeRead(words, conv, ctx) {
    const s = String(words || '');
    const when = s.match(/\bwhen(?:ever)?\s+(?:each|every|a|the|any)?\s*(?:session|game|booking)\s+(ends|is over|finishes|is done|starts|begins)\b|\b(?:at the )?(end|start) of (?:each|every|a|the) (?:session|game|booking)\b|\bafter (?:each|every|a|the) (?:session|game|booking)\b/i);
    if (!when) return null;
    const v = s.match(/\b(?:close|quit|exit|kill|shut down)\s+(?:out of\s+)?(?:the\s+)?/i); if (!v) return null;
    const p = s.slice(v.index + v[0].length).match(/^([A-Za-z0-9][\w.+-]*(?:\s+[A-Z0-9][\w.+-]*)?)/);
    if (!p || /^(?:it|out|down|up|early|late|everything|all|bay|bays|on|at|for|when|after)$/i.test(p[1])) return null;
    // (a program is a name, never a doing or the routine itself: "exit closing gspro on bay 1 after each session" was a routine to close
    // a program called "closing", "kill the routine that closes gspro ..." one to close "routine" - the review, Oct 27 2026)
    // (Oct 27 2026, the review of that fix: every word ending in -ing was refused, so "close Swing Catalyst on Bay 1 after each session"
    // lost its program - the doings themselves are refused, a name that happens to end in -ing is a name)
    if (/^(?:clos|quitt|exit|kill|shutt|stopp|end|runn|open|start|launch|load|play|do|mak|hav|us|keep|leav|turn|switch|paus)ing$|^routines?$/i.test(p[1].split(/\s+/)[0])) return null;
    const bay = bayNamedIn(ctx, s); if (!bay) return null;
    const start = /starts|begins|^start/i.test(when[1] || when[2] || '');
    return Object.assign({ bay, name: ('Close ' + p[1]).slice(0, 40), steps: [{ do: 'close', program: p[1] }] }, start ? { on_session_start: true } : { on_session_end: true });
  }
  function bayRoutinesOf(ctx, bayWords) {
    const R = ctx.bayRoutines;
    if (!R || !R.read) throw new ActionError('the routines could not be read just now - try again in a moment');
    const { bay } = findBay(ctx, bayWords);
    return { bay, entry: (R.bays || []).find(b => b.id === bay.id) || { routines: [], teach: null } };
  }
  function findRoutine(ctx, bayWords, words) {
    const { bay, entry } = bayRoutinesOf(ctx, bayWords);
    const n = lc(words), all = entry.routines || [];
    const one = (m) => (m.length === 1 ? m[0] : null);
    const hit = one(all.filter(r => lc(r.name) === n)) || one(all.filter(r => lc(r.name).includes(n) || n.includes(lc(r.name))));
    if (!hit) throw new ActionError(`no routine called "${words}" on ${bay.name} (its routines: ${all.map(r => `"${r.name}"`).join(', ') || 'none yet - routine_teach teaches one'})`);
    return { bay, routine: hit };
  }
  // when it runs, from the action's plain parameters into the unit's own triggers (services/routines.js checkTriggers)
  const TRIGGER_PARAMS = {
    on_session_start: { type: 'boolean', description: 'run it when each session on the bay starts (after its PC wakes)' },
    minutes_before_session: { type: 'integer', minimum: 0, maximum: 30, description: 'with on_session_start: how many minutes before each session it runs (left out: 5)' },
    on_session_end: { type: 'boolean', description: 'run it when each session on the bay ends - to set the bay back for the next player (it runs before the next session\'s own routine)' },
    every_day_at: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 10 }, description: 'run it every day at these times, like ["3:00 AM"] or ["9:00", "21:30"] ([] for none)' },
    on_windows_start: { type: 'boolean', description: 'run it when the bay PC starts up and signs in' },
    when_program_opens: { type: 'string', maxLength: 80, description: 'run it when this program opens on the PC, like "GSPro.exe"' },
    when_program_closes: { type: 'string', maxLength: 80, description: 'run it when this program closes - to keep it running, like "Connector.exe"' },
    when_window_appears: { type: 'string', maxLength: 80, description: 'run it when a window with these words in its title appears, like "Sign in"' },
    hotkey: { type: 'string', maxLength: 30, description: 'a hotkey on the PC: two of Ctrl, Alt and Shift with one more key, like "Ctrl+Alt+1" ("" for none)' },
    staff_pad: { type: 'boolean', description: 'whether staff can run it from the staff pad (yes unless the owner says not)' },
  };
  const hasTrigger = (a) => Object.keys(TRIGGER_PARAMS).some(k => a[k] !== undefined);
  function triggersOf(a, cur) {
    const t = Object.assign({}, cur || { pad: true });
    const set = (k, v) => { if (v === undefined) return; if (v === false || v === '') delete t[k]; else t[k] = v; };
    set('session_start', a.on_session_start); set('session_end', a.on_session_end); set('startup', a.on_windows_start); set('program_starts', a.when_program_opens);
    if (a.minutes_before_session !== undefined) t.session_lead = a.minutes_before_session;
    if (a.every_day_at !== undefined) { if (Array.isArray(a.every_day_at) && a.every_day_at.length) t.at_times = a.every_day_at; else delete t.at_times; }
    if (!t.session_start) delete t.session_lead;
    set('program_stops', a.when_program_closes); set('window_appears', a.when_window_appears); set('hotkey', a.hotkey);
    if (a.staff_pad !== undefined) t.pad = a.staff_pad;
    return t;
  }
  const runsWhen = (t) => { const w = require('../../routines').triggerWords(t); return w.length ? w.join(', ') : 'only when you ask'; };
  // a routine's button colour by name or #RRGGBB (one list with the website's colours - services/assistant/colours.js); "none"
  // takes it off
  const routineColour = (v) => {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s || /^(none|no colou?r|plain|default)$/.test(s)) return '';
    const h = require('../colours').hexOf(s);
    if (!h) throw new ActionError(`"${v}" is not a colour I know - say a plain name like green, red, navy or gold, or #RRGGBB`);
    return h;
  };
  const colourWords = (hex) => (hex ? require('../colours').nameOf(hex) : 'none');
  // a program to close, named as the owner says it ("GSPro"): its file name - the bay PC matches it to the one it was shown
  const closeProgram = (routine, words) => String(words || '').trim().split(/[\\/]/).pop().replace(/\.exe$/i, '') + '.exe';

  // ── a plug's or a TV remote's own details, and a TV's codes (Oct 21 2026, the device audit: none of it could be done by
  //    talking - a TV was set up, learned, renamed or taken off only on the bay's page) ──
  const ipv4 = (s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(n => Number(n) <= 255);
  const address = (s, port) => { const t = String(s || '').trim(); const [h, p] = t.split(':'); if (!ipv4(h) || (p !== undefined && (!port || !/^\d{1,5}$/.test(p)))) throw new ActionError(`"${t}" is not a network address (like 192.168.1.50)`); return t; };
  const toggleTv = (d) => String((d && d.codeStyle) || '').toLowerCase() !== 'discrete';   // rule 16: a toggle unless said
  // which button a learn is for: one power button (a toggle - rule 16) is learned once and used for on and off; a remote
  // with separate buttons learns ON and OFF one at a time, the missing one first
  function learnWhich(a, x) {
    const b = a.button;
    if (toggleTv(x.d)) {
      if (b && b !== 'power') throw new ActionError(`${label(x)} has one power button (its remote toggles the TV), so its power button is learned once and used to switch it on and off. If its own remote really has separate ON and OFF buttons, say so first (bay_device_set separate_buttons)`);
      return 'power';
    }
    if (b === 'power') throw new ActionError(`${label(x)} is set to separate ON and OFF buttons - learn its ON button and its OFF button, one at a time. If its remote has one power button, say so first (bay_device_set separate_buttons false)`);
    if (b) return b;
    if (!x.d.onCommand) return 'on';
    if (!x.d.offCommand) return 'off';
    throw new ActionError(`${label(x)} has both codes learned already - say which to learn again, ON or OFF`);
  }
  function deviceSet(a, ctx) {
    const { i, bay } = findBay(ctx, a.bay);
    let x;
    try { x = deviceOnBay(bay, a.device, ['plug', 'ir']); }
    catch (e) { let other = null; try { other = deviceOnBay(bay, a.device); } catch {} if (other) throw new ActionError(`${label(other)} is a smart-home device - device_name_set renames it on the hub`); throw e; }
    if (a.name === undefined && a.address === undefined && a.separate_buttons === undefined) throw new ActionError('say its new name, its new address, or (a TV) whether its remote has separate ON and OFF buttons');
    if (a.separate_buttons !== undefined && x.family !== 'ir') throw new ActionError(`${label(x)} is a plug - only a TV's remote has buttons`);
    const base = `bays.${i}.${x.list}.${x.j}`, set = [], said = [];
    const same = arr(bay[x.list]).filter((d, j) => d && j !== x.j);
    if (a.name !== undefined) {
      const n = String(a.name).trim(); if (!n) throw new ActionError('say the new name');
      if (same.some(d => lc(d.name) === lc(n))) throw new ActionError(`${bay.name} already has a ${FAMILY_WORD[x.family]} called "${n}"`);
      if (n !== x.d.name) { set.push([`${base}.name`, n]); said.push(`called "${n}"${x.d.name ? ` (was "${x.d.name}")` : ''}`); }
    }
    if (a.address !== undefined) {
      const ip = address(a.address, x.family === 'plug');
      if (x.family === 'plug') {
        if (same.some(d => d.ip === ip)) throw new ActionError(`a plug at ${ip} is on ${bay.name} already`);
        const other = (ctx.bays || []).find((b, j) => j !== i && arr(b.shellyDevices).some(d => d && d.ip === ip));
        if (other) throw new ActionError(`the plug at ${ip} is on ${other.name} - take it off there first`);
      }
      if (ip !== x.d.ip) { set.push([`${base}.ip`, ip]); said.push(`at ${ip} (was ${x.d.ip})${x.family === 'ir' ? ' - its learned codes stay with it' : ''}`); }
    }
    if (a.separate_buttons !== undefined && a.separate_buttons !== !toggleTv(x.d)) {
      set.push([`${base}.codeStyle`, a.separate_buttons ? 'discrete' : 'toggle']);
      // one power button learned once is the same code for on and off: told it has separate buttons, that code is not an
      // ON or an OFF one - sent unguarded it could switch the TV the wrong way (rule 16) - so both are learned again
      const oneCode = x.d.onCommand && x.d.onCommand === x.d.offCommand;
      if (a.separate_buttons && oneCode) { set.push([`${base}.onCommand`, ''], [`${base}.offCommand`, '']); }
      said.push(a.separate_buttons ? `its remote has separate ON and OFF buttons${oneCode ? ' - the power button learned before is cleared, so learn its ON and its OFF button (bay_tv_learn); until then it is not switched' : ''}` : 'its remote has one power button (the unit keeps track of whether the TV is on, so a second press never switches it back)');
    }
    if (!set.length) throw new ActionError(`${label(x)} on ${bay.name} is already set that way`);
    return { op: { op: 'config', set, expect: [[`bays.${i}.id`, bay.id], [`${base}.${x.key}`, x.id]] },
      say: `${x.family === 'plug' ? 'The plug ' : ''}${label(x)} on ${bay.name}: ${said.join('; ')}.` };
  }

  function deviceTiming(a, ctx) {
    const C = settingsRead(ctx); const { i, bay } = findBay(ctx, a.bay);
    const given = ['minutes_before', 'turn_off_after', 'minutes_after', 'comfort_temp', 'eco_temp', 'cool_eco_temp'].filter(k => a[k] !== undefined);
    if (!given.length) throw new ActionError('say what to change: minutes before, minutes after, whether it is left on after, or a thermostat\'s temperatures');
    const range = (v, lo, hi, what) => { if (v !== undefined && (v < lo || v > hi)) throw new ActionError(`${what} must be from ${lo} to ${hi}`); };
    const expect = [[`bays.${i}.id`, bay.id]];
    // the PC's wake-up (the bay editor's "Wake PC - minutes before session"); a device named exactly so is that device.
    // services/scheduler.js:1007 - an older facility-wide booking.pcWakeMinutesBefore, when set, outranks every bay's own
    const named = devicesOn(bay).some(x => x.name && lc(x.name) === lc(a.device));
    if (PC_WORDS.test(lc(a.device)) && !named) {
      if (given.some(k => k !== 'minutes_before')) throw new ActionError('the PC is not on a timer after sessions - it is shut down at the end of each session by auto-shutdown (bay_timing_set); only how early it is woken is set here. Its plug, if it has one, is changed by naming the plug');
      const plugs = devicesOn(bay).filter(x => x.family === 'plug').map(x => `"${x.name || x.id}"`);
      if (!String(bay.pcMac || '').trim()) throw new ActionError(`${bay.name}'s PC has no wake ID saved, so the unit does not wake it before sessions - link it first (network_scan, then bay_pc_link)${plugs.length ? `; to change when its plug comes on, name the plug (${plugs.join(', ')})` : ''}`);
      if (C.pcWakeAll != null) throw new ActionError(`an older facility-wide wake time of ${mins(C.pcWakeAll)} is set and outranks every bay's own, so this would change nothing`);
      range(a.minutes_before, 0, 60, 'minutes before');
      return { op: { op: 'config', set: [[`bays.${i}.pcWakeMinutesBefore`, a.minutes_before]], expect },
        say: `${bay.name}'s PC is woken ${mins(a.minutes_before)} before each session (was ${mins(num(bay.pcWakeMinutesBefore, 10))}).` };
    }
    const x = deviceOnBay(bay, a.device);
    const base = `bays.${i}.${x.list}.${x.j}`;
    expect.push([`${base}.${x.key}`, x.id]);
    const set = [];
    if (x.family === 'climate') {
      if (a.turn_off_after !== undefined) throw new ActionError(`${label(x)} is a thermostat: it is not switched off after sessions, it goes to its idle temperature - say that temperature`);
      range(a.minutes_before, 1, 120, 'minutes before'); range(a.minutes_after, 0, 120, 'minutes after');
      if (a.minutes_before !== undefined) set.push([`${base}.leadTimeMins`, a.minutes_before]);
      if (a.minutes_after !== undefined) set.push([`${base}.setbackDelayMins`, a.minutes_after]);
      if (a.comfort_temp !== undefined) set.push([`${base}.comfortTemp`, a.comfort_temp]);
      if (a.eco_temp !== undefined) set.push([`${base}.ecoTemp`, a.eco_temp]);
      if (a.cool_eco_temp !== undefined) set.push([`${base}.coolEcoTemp`, a.cool_eco_temp]);
    } else {
      if (a.comfort_temp !== undefined || a.eco_temp !== undefined || a.cool_eco_temp !== undefined) throw new ActionError(`${label(x)} is not a thermostat - it has no temperatures`);
      range(a.minutes_before, 1, 60, 'minutes before'); range(a.minutes_after, 5, 120, 'minutes after');
      const wantsOff = a.turn_off_after === true || (a.turn_off_after === undefined && a.minutes_after !== undefined);
      if (x.family === 'ir' && wantsOff && !x.d.offCommand) throw new ActionError(`${label(x)} has no OFF code learned, so it cannot be switched off after sessions - bay_tv_learn learns it from the TV's own remote`);
      if (x.family === 'ir' && a.minutes_before !== undefined && !x.d.onCommand) throw new ActionError(`${label(x)} has no ON code learned, so it is not switched on before sessions - bay_tv_learn learns it from the TV's own remote`);
      // minutes after, for a device that is left on after sessions, is not taken as "switch it off" - that is said, never
      // assumed (the plug a PC runs from is left on so Windows can shut down first)
      if (a.minutes_after !== undefined && a.turn_off_after === undefined && !x.d.turnOffAfter) throw new ActionError(`${label(x)} is left on after sessions now - to have it go off ${mins(a.minutes_after)} after each session, say turn_off_after true as well`);
      if (a.minutes_before !== undefined) set.push([`${base}.minutesBefore`, a.minutes_before]);
      if (a.turn_off_after !== undefined) set.push([`${base}.turnOffAfter`, a.turn_off_after]);
      if (a.minutes_after !== undefined) set.push([`${base}.minutesAfter`, a.minutes_after]);
    }
    const now = Object.fromEntries(set.map(([p, v]) => [p.split('.').pop(), v]));
    if (Object.entries(now).every(([k, v]) => x.d[k] === v)) throw new ActionError(`${label(x)} on ${bay.name} is already set that way (${timingWords(x)})`);
    const after = Object.assign({}, x, { d: Object.assign({}, x.d, now) });
    const kind = { plug: 'plug', ir: 'TV remote', ha: 'smart-home device', climate: 'thermostat' }[x.family];
    const ha = (x.family === 'ha' || x.family === 'climate') && !C.haReady ? ' Home Assistant is not set up, so the unit does not switch it yet.' : '';
    const cut = x.family === 'plug' && x.d.turnOffAfter === false && a.turn_off_after === true ? ' It was set to stay on: if the bay\'s PC runs from this plug, the PC loses power then whether or not Windows has shut down.' : '';
    return { op: { op: 'config', set, expect },
      say: `${label(x)}, the ${kind} on ${bay.name}: ${timingWords(after)} (was: ${timingWords(x)}).${cut}${ha}` };
  }

  // ── the actions ──────────────────────────────────────────────────────────────
  const BAY = { type: 'string', minLength: 1, maxLength: 60, description: 'the bay\'s name, like "Bay 2"' };
  const actions = [
    // GET /api/admin/config (routes/admin.js:98), /api/admin/bookings (:151, the customer bookings of a day),
    // /api/admin/blocks (:269), /api/admin/automation/health (:798), /api/admin/baystate (:880, the live plug and PC - Bay
    // Operations' own read), /api/admin/broadlink/status (:640). Never /api/session/status (the file's head says why).
    { name: 'bay_read', area: 'bays', kind: 'read',
      say: 'Look at every bay right now in one go: whether a session is on and until when, the next one today, in or out of service, its PC (address, wake ID, Windows sign-in saved or not, answering or not), its plugs, TV remotes and smart-home devices with their timing, the routines on its PC and when each runs, and anything that went wrong. Use this first for any question about the bays ("what happens on bay 2 when a session starts"); give a bay to see just that one in full',
      params: { type: 'object', properties: { bay: { ...BAY, description: 'one bay to look at in full; leave out for every bay' } } },
      needs: ['bays', 'bayConfig', 'bayNow', 'bayJobs', 'bayRoutines'],
      local: async (a, ctx) => {
        const bays = ctx.bays || [];
        if (!bays.length) return ctx.bayConfig && ctx.bayConfig.read === false ? { error: 'the settings could not be read just now - try again in a moment' } : { bays: [], note: 'no bays are set up yet' };
        const C = ctx.bayConfig || {};
        const pick = a.bay ? [findBay(ctx, a.bay).bay] : bays;
        const anyIr = bays.some(b => arr(b.broadlinkDevices).some(d => d && d.ip));
        const [bs, irs] = await Promise.all([getJson(ctx, '/api/admin/baystate'), anyIr ? getJson(ctx, '/api/admin/broadlink/status') : Promise.resolve(null)]);
        const live = {}; for (const b of arr(bs && bs.bays)) live[b.id] = b;
        const J = ctx.bayJobs;
        const facility = {
          auto_shutdown: C.read ? (C.shutdown.enabled ? 'on' : 'off') : 'unknown',
          restart_pc_before_next_group: C.read ? (C.shutdown.restart ? 'on' : 'off') : 'unknown',
          keep_bays_on_between_sessions: C.read ? `when the next starts within ${mins(C.keepOnGapMins)}` : 'unknown',
          bay_off_waits_for_the_pc: C.read ? `${C.manualOffGraceSecs} seconds` : 'unknown',
          on_screen_warning: C.read ? `${mins(C.warnMins)} before the end` : 'unknown',
          closing_time: C.read ? (C.open24Hours ? 'open around the clock' : C.closeTime ? timeWords(C.closeTime) : 'not set') : 'unknown',
          home_assistant: C.read ? (C.haReady ? 'set up' : 'not set up - smart-home devices on bays are not switched by the unit') : 'unknown',
          tv_remote_bridge: anyIr ? (irs ? (irs.running ? 'running' : 'NOT running - TV codes cannot be sent') : 'could not be checked') : undefined,
          automation: !J || !J.read ? 'could not be read'
            : (J.failed.length || J.overdue) ? `${J.failed.length} failed or missed in the last ${J.hours} hours${J.overdue ? `, ${J.overdue} past their time and not run yet` : ''}${J.retrying ? `, ${J.retrying} retrying by themselves` : ''} (automation_read)`
            : `all well${J.retrying ? ` (${J.retrying} retrying by themselves)` : ''}`,
          live_plugs_and_pcs: bs ? 'read just now (the first plug of each bay)' : 'could not be read just now',
        };
        const one = pick.length === 1;
        let out = { facility, bays: pick.map(b => bayEntry(ctx, b, live, true, one)) };
        // one bay: every plug's own state (GET /api/admin/shelly/status, routes/admin.js:258 - it asks each plug in turn, so
        // only when one bay is looked at; Bay Operations' read above gives the first plug only). services/shelly.getAllStatus
        // walks bay.shellyDevices unguarded, so with any bay missing that list the route never answers - not asked then.
        if (one && arr(pick[0].shellyDevices).some(d => d && d.ip) && bays.every(b => Array.isArray(b.shellyDevices))) {
          const all = await getJson(ctx, '/api/admin/shelly/status');
          if (Array.isArray(all)) {
            const mine = all.filter(s => s && s.bayId === pick[0].id);
            if (mine.length) { out.bays[0].plugs_now = mine.map(s => `${s.name || s.ip}: ${s.success === false ? 'not answering' : s.on ? 'on' + (s.watts != null ? `, drawing ${s.watts} W` : '') : 'off'}`); delete out.bays[0].first_plug_now; }
          }
        }
        // the engine passes the model at most 3,000 characters: a big facility is said one line a bay
        if (JSON.stringify(out).length > 2800) out = { facility, bays: pick.map(b => bayEntry(ctx, b, live, false, one)), note: 'short form - ask about one bay to see its devices and their timing' };
        if (JSON.stringify(out).length > 2800) {
          const keep = [];
          for (const e of out.bays.map(x => ({ bay: x.bay, service: x.service, now: x.now, next_today: x.next_today, problems: x.problems }))) { keep.push(e); if (JSON.stringify({ facility, bays: keep }).length > 2600) { keep.pop(); break; } }
          out = { facility, bays: keep, note: keep.length < pick.length ? `${pick.length - keep.length} more bay(s) not shown - ask about one bay at a time` : 'shortest form - ask about one bay to see its PC, devices and their timing' };
        }
        return out;
      } },

    // POST /api/admin/shelly/bay { bay_id, action } (routes/admin.js:234 -> services/sequence.js startBay/stopBay) - Bay
    // Operations' On / Off (admin.html opsBay)
    { name: 'bay_switch', area: 'bays', kind: 'write',
      say: 'Turn a WHOLE bay on or off now, exactly as at the start or the end of a session: on wakes its PC and switches on its plugs, TV and smart-home devices; off shuts its PC down first, then switches the rest off. For one plug use plug_switch; for one smart-home device, device_switch; to restart a PC, bay_pc_restart - never this',
      params: { type: 'object', properties: { bay: BAY, on: { type: 'boolean', description: 'true to turn the bay on, false to turn it off' } }, required: ['bay', 'on'] },
      needs: ['bays', 'bayConfig', 'bayNow'],
      confirm: (a, ctx) => { if (a.on === false) return true; try { return !!findBay(ctx, a.bay).bay.maintenance; } catch { return true; } },
      confirmSay: ' (turning a bay off - or on while it is out of service - is shown to the owner to approve first)',
      build: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        const p = switchPlan(bay, a.on);
        if (p.locks.length) throw lockRefusal(bay.name);
        if (p.nothing) throw new ActionError(a.on ? `${bay.name} has nothing the unit can switch on: no smart plug, no learned TV on code, no smart-home device and no PC wake ID - they are added in Admin > Bays & Devices, or tell me`
          : `${bay.name} has nothing the unit can switch off: no PC address, no plug set to go off, no learned TV off code and no smart-home device`);
        return { op: 'http', method: 'POST', path: '/api/admin/shelly/bay', body: { bay_id: bay.id, action: a.on ? 'on' : 'off' } };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const C = ctx.bayConfig || {}; const p = switchPlan(bay, a.on);
        const it = p.toggles.length === 1;
        const toggle = p.toggles.length ? ` ${and(p.toggles)} ${isAre(p.toggles)} on a one-button (toggle) remote code: if the unit's own record says ${it ? 'it is' : 'they are'} already ${a.on ? 'on' : 'off'}, the code is held back so it cannot switch ${it ? 'it' : 'them'} the wrong way - if ${it ? 'it does' : 'one does'} not ${a.on ? 'come on' : 'go off'}, ask me again within 2 minutes and the code is sent anyway.` : '';
        const noCode = p.noCode.length ? ` ${and(p.noCode)} ha${p.noCode.length === 1 ? 's' : 've'} no ${a.on ? 'on' : 'off'} code learned and ${isAre(p.noCode)} not switched.` : '';
        const ha = p.ha.length && C.read && !C.haReady ? ` Home Assistant is not set up, so ${and(p.ha)} will not answer and the bay will be reported as not fully done.` : '';
        if (a.on) return `Turn ${bay.name} on now, as at the start of a session: ${and(p.parts)}.${bay.maintenance ? ` ${bay.name} is OUT OF SERVICE - this powers it anyway.` : ''}${toggle}${noCode}${ha}`;
        const grace = C.read ? C.manualOffGraceSecs : 90;
        const pc = !p.pcOff ? '' : (bay.simulatorWinPass ? `shut its PC down first (waiting up to ${grace} seconds for it to go off)`
          : `try to shut its PC down first (no Windows sign-in is saved for it, so if it is on, Windows refuses and the unit waits the full ${grace} seconds)`) + (p.parts.length ? ', then ' : '');
        return `Turn ${bay.name} off now, as at the end of a session: ${pc}${and(p.parts)}.${p.kept.length ? ` ${and(p.kept)} stay${p.kept.length === 1 ? 's' : ''} on (set to stay on after sessions).` : ''}${noCode}${toggle}${ha}${playingNote(ctx, bay, 'its equipment goes off for the players')}`;
      } },

    // POST /api/admin/shelly/on|off (routes/admin.js:385 -> services/sequence.js allBays) - Bay Operations' All On / All Off
    // (admin.html opsAll). The route answers ok:true whatever each bay did.
    { name: 'all_bays_switch', area: 'bays', kind: 'write',
      say: 'Turn EVERY bay on or off now, each exactly as at the start or the end of a session - for opening up or closing down the building',
      params: { type: 'object', properties: { on: { type: 'boolean', description: 'true for every bay on, false for every bay off' } }, required: ['on'] },
      needs: ['bays', 'bayConfig', 'bayNow'],
      confirm: (a) => a.on === false,
      confirmSay: ' (turning every bay off is shown to the owner to approve first)',
      build: (a, ctx) => {
        const bays = (ctx.bays || []).filter(b => b && b.active !== false);
        if (!bays.length) throw new ActionError('no bays are set up yet');
        const locks = bays.filter(b => switchPlan(b, a.on).locks.length).map(b => b.name);
        if (locks.length) throw lockRefusal(and(locks));
        if (bays.every(b => switchPlan(b, a.on).nothing)) throw new ActionError(`no bay has anything the unit can switch ${a.on ? 'on' : 'off'} - plugs, TV codes, smart-home devices and the PCs are added in Admin > Bays & Devices`);
        return { op: 'http', method: 'POST', path: `/api/admin/shelly/${a.on ? 'on' : 'off'}`, body: {} };
      },
      describe: (a, ctx) => {
        const C = ctx.bayConfig || {};
        const bays = (ctx.bays || []).filter(b => b && b.active !== false);
        const empty = bays.filter(b => switchPlan(b, a.on).nothing).map(b => b.name);
        const toggles = bays.some(b => switchPlan(b, a.on).toggles.length);
        const tail = `${empty.length ? ` (${and(empty)} ha${empty.length === 1 ? 's' : 've'} nothing to switch.)` : ''}${toggles ? ` A TV on a one-button (toggle) code the unit already turned ${a.on ? 'on' : 'off'} is not pressed again.` : ''} If a device on a bay does not answer, I will say which.`;
        if (a.on) {
          const oos = bays.filter(b => b.maintenance && !switchPlan(b, true).nothing).map(b => b.name);
          return `Turn every bay on now (${and(bays.map(b => b.name))}), each as at the start of a session: PCs woken, plugs, TV codes and smart-home devices on.${oos.length ? ` ${and(oos)} ${isAre(oos)} out of service and ${isAre(oos)} left off.` : ''}${tail}`;
        }
        const playing = bays.map(b => { const st = stateOf(ctx, b); return st && st.playing ? `${b.name} (until ${endWords(st.playing, st.today)})` : null; }).filter(Boolean);
        const unknown = !ctx.bayNow || !ctx.bayNow.read;
        return `Turn every bay off now (${and(bays.map(b => b.name))}), one after another, each as at the end of a session: its PC shut down first (waiting up to ${C.read ? C.manualOffGraceSecs : 90} seconds for it), then its plugs, TV codes and smart-home devices off - plugs set to stay on are left on. This can take a few minutes.${playing.length ? ` ${playing.length === 1 ? 'A session is' : 'Sessions are'} on now on ${and(playing)} - ${playing.length === 1 ? 'its' : 'their'} equipment goes off for the players.` : unknown ? ' (I could not check for sessions on now.)' : ''}${tail}`;
      } },

    // POST /api/admin/bays/:bayId/maintenance { maintenance } (routes/admin.js:761) - Bay Operations' Out of service / Back in
    // service (admin.html opsMaintenance). A state with no end date; the booking routes and bookingcore.darkBayIds read it.
    { name: 'bay_service_set', area: 'bays', kind: 'write', confirm: true,
      say: 'Take a bay out of service (broken or being repaired: customers cannot book it and its equipment stays off, with no end date) or put it back in service. For a few hours or days, a block on the bookings side fits better',
      params: { type: 'object', properties: { bay: BAY, in_service: { type: 'boolean', description: 'false to take the bay out of service, true to put it back' } }, required: ['bay', 'in_service'] },
      needs: ['bays', 'bayConfig', 'bayNow', 'bayAhead'],
      build: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        if (!!bay.maintenance === !a.in_service) throw new ActionError(`${bay.name} is already ${a.in_service ? 'in service' : 'out of service'}`);
        return { op: 'http', method: 'POST', path: `/api/admin/bays/${encodeURIComponent(bay.id)}/maintenance`, body: { maintenance: !a.in_service } };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const st = stateOf(ctx, bay);
        // a session under way catches up (services/scheduler.js: each switch-on runs late until the session's end) - except a
        // one-button TV more than 3 minutes into the session, which the scheduler never sends late (it could switch it off)
        const toggles = switchPlan(bay, true).toggles;
        if (a.in_service) return `Put ${bay.name} back in service: customers can book it again, and its equipment follows its sessions again${st && st.playing ? ` - the session on there now gets ${bay.pcMac ? 'its PC woken and ' : ''}its plugs and devices switched on within a minute${toggles.length ? ` (not ${and(toggles)}: a one-button TV is not switched on once a session is more than 3 minutes in - turn it on by hand)` : ''}` : ''}.`;
        const A = ctx.bayAhead || {};
        // still to start (the one playing now, if any, is said on its own below)
        const ahead = A.read ? arr(A.byBay[bay.id]).concat(arr(A.whole)).filter(s => !st || s.a > st.now).sort((x, y) => x.a - y.a) : [];
        const one = ahead.length === 1;
        const booked = !A.read ? ' (I could not check for bookings already made on it.)'
          : ahead.length ? ` ${ahead.length}${A.capped ? ' or more' : ''} booking${one ? ' is' : 's are'} already made on ${bay.name} (the next: ${dayWords(ahead[0].date)}, ${timeWords(ahead[0].start)}) - ${one ? 'it stays' : 'they stay'} booked, nothing is cancelled or moved, and nothing turns on for ${one ? 'it' : 'them'}: move or cancel ${one ? 'it' : 'them'} if ${one ? 'it' : 'they'} should not play there.`
            : ` No bookings are made on ${bay.name} from now on.`;
        const playing = st && st.playing ? ` ${playingNow(bay, st)}: the unit stops driving the bay at once, so what is on stays on after it ends - turn the bay off yourself when they finish.` : '';
        return `Take ${bay.name} out of service: customers cannot book it from now on, and its PC, plugs, TV and smart-home devices are not switched on for any session - with no end date, until you put it back.${booked}${playing}`;
      } },

    // POST /api/admin/pc/restart { bay_id } (routes/admin.js:926 -> services/simulator.sendRestart: net rpc shutdown -r -f -t 10
    // with the bay's Windows sign-in) - Bay Operations' Restart PC (admin.html opsRestart)
    { name: 'bay_pc_restart', area: 'bays', kind: 'write', confirm: true,
      say: 'Restart a bay\'s PC now with a normal Windows restart (the game closes; back in about 2 minutes) - when the simulator software misbehaves. For a frozen PC that will not restart, bay_power_cycle',
      params: { type: 'object', properties: { bay: BAY }, required: ['bay'] },
      needs: ['bays', 'bayConfig', 'bayNow'],
      build: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        if (!String(bay.simulatorPcIp || '').trim()) throw new ActionError(`${bay.name} has no PC address saved, so the unit cannot reach its PC - the address and the PC's Windows ADMIN sign-in go in first (the network scan finds the PC; bay_pc_signin_set saves the sign-in)`);
        if (!bay.simulatorWinPass) throw new ActionError(`no Windows sign-in is saved for ${bay.name}'s PC, so Windows would refuse the restart - save its ADMIN user and password first (bay_pc_signin_set)`);
        return { op: 'http', method: 'POST', path: '/api/admin/pc/restart', body: { bay_id: bay.id } };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        return `Restart ${bay.name}'s PC (${bay.simulatorPcIp}) now: Windows closes every program without saving and restarts in 10 seconds - back in about 2 minutes. If the PC is off or not answering, nothing happens.${playingNote(ctx, bay, 'the players\' game stops during the restart')}`;
      } },

    // POST /api/admin/pc/wake { bay_id } (routes/admin.js:909 -> services/simulator.wakePc: a Wake-on-LAN packet to the bay's
    // saved wake ID) - the bay editor's Wake PC (test) sends the same packet by its MAC (admin.html wakePcTest)
    { name: 'bay_pc_wake', area: 'bays', kind: 'write',
      say: 'Wake just a bay\'s PC now (Wake-on-LAN), without switching on the rest of the bay. For the whole bay, bay_switch',
      params: { type: 'object', properties: { bay: BAY }, required: ['bay'] },
      needs: ['bays'],
      confirm: (a, ctx) => { try { return !!findBay(ctx, a.bay).bay.maintenance; } catch { return true; } },
      confirmSay: ' (waking the PC of a bay that is out of service is shown to the owner to approve first)',
      build: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        if (!String(bay.pcMac || '').trim()) throw new ActionError(`${bay.name}'s PC has no wake ID saved, so the unit cannot wake it - the network scan finds it and bay_pc_link saves it (the PC's wired network card must allow waking)`);
        return { op: 'http', method: 'POST', path: '/api/admin/pc/wake', body: { bay_id: bay.id } };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        return `Send ${bay.name}'s PC its wake-up signal now: if it is off and has power, it starts in a minute or two; a PC already on is not affected. Nothing else on the bay is switched on.${bay.maintenance ? ` ${bay.name} is OUT OF SERVICE.` : ''}`;
      } },

    // POST /api/admin/bays/:bayId/restart (routes/admin.js:775 -> services/shelly.restartBay: every plug off, 8 seconds, every
    // plug on) - the staff pad's Power cycle (staff.html -> /api/staff/bays/:id/restart, the same service); admin.html
    // restartBayNow
    { name: 'bay_power_cycle', area: 'bays', kind: 'write', confirm: true,
      say: 'Cut a bay\'s power for about 8 seconds and turn it back on (every smart plug on the bay) - only when its PC is frozen and a normal restart (bay_pc_restart) does not work',
      params: { type: 'object', properties: { bay: BAY }, required: ['bay'] },
      needs: ['bays', 'bayConfig', 'bayNow'],
      build: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        // no plugs: the route answers success with skipped:true - "done" for nothing (rule 31: said plainly instead)
        if (!arr(bay.shellyDevices).some(d => d && d.ip)) throw new ActionError(`${bay.name} has no smart plugs, so its power cannot be cut and restored from here - ${String(bay.simulatorPcIp || '').trim() && bay.simulatorWinPass ? 'restart its PC instead (bay_pc_restart), or ' : ''}switch it off and on at the wall`);
        return { op: 'http', method: 'POST', path: `/api/admin/bays/${encodeURIComponent(bay.id)}/restart`, body: {} };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const plugs = arr(bay.shellyDevices).filter(d => d && d.ip).map(d => d.name || d.ip);
        return `Power-cycle ${bay.name} now: ${plugs.length === 1 ? 'its plug' : 'all its plugs'} (${and(plugs)}) go off for about 8 seconds, then all come back on - even one that was off - and the PC loses power without shutting down and starts again (a minute or two).${playingNote(ctx, bay, 'the players\' game stops when the power drops')}`;
      } },

    // The close-time override (POST /api/admin/close-override/:bayId, routes/admin.js:2149) is a TOGGLE: a proposal made while
    // it read one way and applied after it changed (the scheduler clears it the moment it is honoured,
    // services/scheduler.js:1378) would flip it the wrong way. So the same key the route writes, bays.<n>.closeOverride, is
    // SET to what the owner asked through the Settings save (POST /api/admin/config, :100) - idempotent, guarded by the bay.
    { name: 'bay_close_override_set', area: 'bays', kind: 'write', confirm: true,
      say: 'Keep a bay\'s PC on past closing tonight: skip the closing-time PC shutdown once (it resets itself after) - or cancel that',
      params: { type: 'object', properties: { bay: BAY, skip_closing_shutdown: { type: 'boolean', description: 'true to keep the PC on past closing once, false to cancel that' } }, required: ['bay', 'skip_closing_shutdown'] },
      needs: ['bays', 'bayConfig'],
      build: (a, ctx) => {
        const C = settingsRead(ctx); const { i, bay } = findBay(ctx, a.bay);
        if (a.skip_closing_shutdown) {
          if (C.open24Hours) throw new ActionError('the facility is open around the clock, so there is no closing-time shutdown to skip');
          if (!C.closeTime) throw new ActionError('no closing time is set, so there is no closing-time shutdown to skip');
          if (!C.shutdown.enabled) throw new ActionError('auto-shutdown is off for all bays, so no PC is shut down at closing anyway');
          if (!String(bay.simulatorPcIp || '').trim()) throw new ActionError(`${bay.name} has no PC address saved, so nothing is shut down there at closing anyway`);
        }
        if (!!bay.closeOverride === a.skip_closing_shutdown) throw new ActionError(a.skip_closing_shutdown ? `${bay.name} already keeps its PC on past closing once` : `${bay.name} has no closing-time override set`);
        return { op: 'config', set: [[`bays.${i}.closeOverride`, a.skip_closing_shutdown]], expect: [[`bays.${i}.id`, bay.id]] };
      },
      describe: (a, ctx) => {
        const C = ctx.bayConfig || {}; const { bay } = findBay(ctx, a.bay);
        if (!a.skip_closing_shutdown) return `Cancel the closing-time override on ${bay.name}: its PC is shut down at closing as usual.`;
        return `Keep ${bay.name}'s PC on past closing, once: the next session there that ends at closing (${timeWords(C.closeTime)}) - tonight's, if there is one - does not have its PC shut down, and the override then resets itself. Its plugs, TV and smart-home devices still switch off on their own timing.`;
      } },

    // GET /api/admin/automation/health (routes/admin.js:798) - Automation Health (admin.html loadAutomationHealth). Its rows
    // carry the customer's name ("who") and the raw error text: neither is passed on as it is.
    { name: 'automation_read', area: 'bays', kind: 'read',
      say: 'See what the automation could not do in the last two days: plugs, TVs and smart-home devices that did not switch, PC wake-ups, shutdowns and restarts, door codes and texts that failed or were missed - per bay and session time, each with a job code to try it again',
      params: { type: 'object', properties: { bay: { ...BAY, description: 'just this bay; leave out for all' } } },
      needs: ['bays', 'facility'],
      local: async (a, ctx) => {
        const j = await getJson(ctx, '/api/admin/automation/health');
        if (!j) return { error: 'the automation list could not be read just now' };
        const J = jobsOf(j, ctx.bays || [], ctx.facility);
        const bay = a.bay ? findBay(ctx, a.bay).bay : null;
        const list = bay ? J.failed.filter(f => f.bay === bay.name) : J.failed;
        return { all_well: !list.length && !J.overdue,
          problems: list.slice(0, 12).map(f => ({ job: f.code, bay: f.bay || 'not tied to one bay', session: whenWords(f) || 'earlier', what: f.what, status: statusWords(f), why: f.why || undefined })),
          more: list.length > 12 ? list.length - 12 : undefined,
          retrying_by_themselves: J.retrying || undefined,
          past_their_time_not_run_yet: J.overdue || undefined,
          note: list.length ? 'automation_retry tries one again by its job code, or every failed one on a bay' : undefined };
      } },

    // POST /api/admin/automation/retry { booking_id, kind, device_key } (routes/admin.js:802 -> services/automation.retryNow) -
    // Automation Health's "retry now". The job runs again through the scheduler's own checks.
    { name: 'automation_retry', area: 'bays', kind: 'write', confirm: true,
      say: 'Try a failed automation job again now - by its job code from automation_read, or every failed job on one bay',
      params: { type: 'object', properties: { job: { type: 'string', maxLength: 12, description: 'the job code from automation_read, like a3f9c1' }, bay: { ...BAY, description: 'instead of a job code: every failed job on this bay' } } },
      needs: ['bays', 'bayConfig', 'bayNow', 'bayJobs'],
      build: (a, ctx) => retryPlan(a, ctx).op,
      describe: (a, ctx) => {
        const { jobs, gone } = retryPlan(a, ctx);
        const after = ` The unit runs ${jobs.length === 1 ? 'it' : 'them'} within a minute with its usual checks: a switch-off is skipped if another session needs the device now, and a door code or a text goes only to a booking still on.`
          + (gone.length ? ` Left out, because ${gone.length === 1 ? 'its session is' : 'their sessions are'} over: ${gone.map(f => f.what).join('; ')}.` : '');
        if (jobs.length === 1) { const f = jobs[0]; return `Try this again now: ${f.what}${f.bay ? ' on ' + f.bay : ''}, ${forSession(f)} (it ${statusWords(f)}${f.why ? ': ' + f.why : ''}).${after}`; }
        return `Try ${jobs.length} failed jobs again now: ${jobs.map(f => `${f.what}${f.bay ? ' on ' + f.bay : ''} (${whenWords(f) || 'an earlier session'})`).join('; ')}.${after}`;
      } },

    // The Shutdown & Warning Timing card (admin.html: shutdown_enabled, shutdown_restart, automation_keepOnGapMins,
    // automation_manualOffGraceSecs, monitor_warnMins), saved by the Settings save (POST /api/admin/config, routes/admin.js:100).
    // Read by services/scheduler.js (shutdown.enabled :1333, shutdown.restart :950, keepOnGapMins :902 and :1401),
    // services/sequence.js (manualOffGraceSecs :116) and the bay watchers live (monitor.warnMins, server.js /api/session/status).
    { name: 'bay_timing_set', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Change the Shutdown & Warning Timing for all bays: whether PCs are shut down after sessions, whether a PC left on is restarted before the next group, how long bays stay on between back-to-back sessions, how long turning a bay off waits for its PC, and when the on-screen warning shows before the end',
      params: { type: 'object', properties: {
        auto_shutdown: { type: 'boolean', description: 'shut each bay\'s PC down after its sessions' },
        restart_before_next_group: { type: 'boolean', description: 'restart a PC left on, 10 minutes before the next group' },
        keep_on_between_sessions_minutes: { type: 'integer', minimum: 0, maximum: 240, description: 'bays stay on through a gap shorter than this between sessions (30 when never changed) - "leave a bay on when another group comes within an hour" is 60' },
        bay_off_waits_seconds: { type: 'integer', minimum: 0, maximum: 600, description: 'how long turning a bay off waits for its PC to shut down (90 when never changed)' },
        warning_minutes: { type: 'integer', minimum: 3, maximum: 60, description: 'minutes before a session ends that the on-screen warning shows (10 when never changed)' } } },
      needs: ['bays', 'bayConfig'],
      build: (a, ctx) => {
        settingsRead(ctx);
        const set = [['shutdown.enabled', a.auto_shutdown], ['shutdown.restart', a.restart_before_next_group], ['automation.keepOnGapMins', a.keep_on_between_sessions_minutes],
          ['automation.manualOffGraceSecs', a.bay_off_waits_seconds], ['monitor.warnMins', a.warning_minutes]].filter(([, v]) => v !== undefined);
        if (!set.length) throw new ActionError('say what to change: auto-shutdown on or off, the restart before the next group, the minutes bays stay on between sessions, how long turning a bay off waits for the PC, or the warning minutes');
        return { op: 'config', set };
      },
      describe: (a, ctx) => {
        const C = ctx.bayConfig || {}; const bays = ctx.bays || [];
        const cannot = bays.filter(b => !String(b.simulatorPcIp || '').trim() || !b.simulatorWinPass).map(b => `${b.name} (${String(b.simulatorPcIp || '').trim() ? 'no Windows sign-in saved' : 'no PC address'})`);
        const was = (w) => (C.read ? ` (was ${w})` : '');
        const parts = [];
        if (a.auto_shutdown === true) parts.push(`each bay's PC is shut down at the end of its sessions, unless the next session starts within the keep-on gap${cannot.length ? ` - ${and(cannot)} cannot be shut down until that is saved` : ''}`);
        if (a.auto_shutdown === false) parts.push('PCs are no longer shut down after sessions - they stay on until someone turns them off');
        if (a.restart_before_next_group === true) parts.push('a PC still on behind the reserved screen restarts 10 minutes before the next group, so they find the game\'s main menu (never between back-to-back sessions, never while anyone plays; it needs the bay\'s PC address, Windows sign-in and a watcher built from October 2026)');
        if (a.restart_before_next_group === false) parts.push('a PC left on is no longer restarted before the next group');
        if (a.keep_on_between_sessions_minutes !== undefined) parts.push(`when the next session on a bay starts within ${mins(a.keep_on_between_sessions_minutes)} of the last one ending, its plugs, TV and PC stay on through the gap${was(mins(C.keepOnGapMins))}`);
        if (a.bay_off_waits_seconds !== undefined) parts.push(`turning a bay off waits up to ${a.bay_off_waits_seconds} seconds for its PC to shut down before switching off its plugs and TV${was(C.manualOffGraceSecs + ' seconds')}`);
        if (a.warning_minutes !== undefined) parts.push(`the on-screen warning shows ${mins(a.warning_minutes)} before each session ends - the bay watchers pick it up by themselves${was(mins(C.warnMins))}`);
        return 'For every bay: ' + parts.join('; ') + '.';
      } },

    // One device's timing, through the bay editor's own keys (admin.html createDeviceRowHTML, createBroadlinkRowHTML,
    // createHARowHTML and the PC's "Wake PC - minutes before session"), saved by the Settings save (POST /api/admin/config,
    // routes/admin.js:100). Each field is set by its own path, guarded by the bay's id and the device's address at its place.
    { name: 'bay_device_timing_set', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Change when one device on a bay comes on before each session and goes off after it - a plug, a TV remote, a smart-home device or thermostat, or the PC\'s wake-up (say "PC") - or whether it is left on after',
      params: { type: 'object', properties: {
        bay: BAY,
        device: { type: 'string', minLength: 1, maxLength: 80, description: 'the device\'s name or address on that bay, or "PC" for the PC\'s wake-up' },
        minutes_before: { type: 'integer', minimum: 1, maximum: 120, description: 'minutes before each session it comes on, at least 1 (a thermostat: starts warming or cooling)' },
        turn_off_after: { type: 'boolean', description: 'false to leave it on after sessions (like the plug a PC runs from)' },
        minutes_after: { type: 'integer', minimum: 0, maximum: 120, description: 'minutes after each session it goes off - at least 5 for a plug or a TV (a thermostat: goes to its idle temperature, 0 for at once)' },
        comfort_temp: { type: 'number', minimum: 40, maximum: 95, description: 'a thermostat: degrees during sessions' },
        eco_temp: { type: 'number', minimum: 40, maximum: 95, description: 'a thermostat: degrees when idle and heating' },
        cool_eco_temp: { type: 'number', minimum: 40, maximum: 95, description: 'a thermostat: degrees when idle with the AC on' } }, required: ['bay', 'device'] },
      needs: ['bays', 'bayConfig'],
      build: (a, ctx) => deviceTiming(a, ctx).op,
      describe: (a, ctx) => deviceTiming(a, ctx).say },

    // A plug off a bay: the bay editor's X on a Shelly row, saved by the Settings save (POST /api/admin/config,
    // routes/admin.js:100) - guarded by the bay's id, the list's length and the plug's address at its place
    { name: 'bay_plug_remove', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Take a Shelly smart plug off a bay, so it no longer follows the bay\'s sessions (the plug itself is left as it is)',
      params: { type: 'object', properties: { bay: BAY, plug: { type: 'string', minLength: 1, maxLength: 60, description: 'the plug\'s name or address' } }, required: ['bay', 'plug'] },
      needs: ['bays'],
      build: (a, ctx) => {
        const { i, bay } = findBay(ctx, a.bay);
        let x;
        try { x = deviceOnBay(bay, a.plug, ['plug']); }
        catch (e) {
          let other = null; try { other = deviceOnBay(bay, a.plug); } catch {}
          if (other && other.family === 'ir') throw new ActionError(`${label(other)} is a TV remote (IR), not a plug - bay_tv_remove takes it off (its learned codes go with it)`);
          if (other) throw new ActionError(`${label(other)} is a smart-home device, not a plug - bay_device_remove takes it off`);
          throw e;
        }
        const cur = arr(bay.shellyDevices);
        return { op: 'config', set: [[`bays.${i}.shellyDevices`, cur.filter((d, j) => j !== x.j)]],
          expect: [[`bays.${i}.id`, bay.id], [`bays.${i}.shellyDevices.length`, cur.length], [`bays.${i}.shellyDevices.${x.j}.ip`, x.id]] };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const x = deviceOnBay(bay, a.plug, ['plug']);
        return `Take the plug ${label(x)} off ${bay.name}: it no longer switches with ${bay.name}'s sessions and is left as it is now (on or off)${x.d.turnOffAfter === false ? ' - it is set to stay on, like the plug a PC runs from' : ''}. The plug itself is not changed.`;
      } },

    // POST /api/admin/broadlink/send { ip, command } (routes/admin.js:633 -> services/broadlink.sendCommand). No screen sends a
    // learned code by itself today (the bay editor's Test only checks the connection), and this send is not written in the
    // command ledger (services/devicelog) the bay sequence and the scheduler read for a one-button TV - so a test press on a
    // TOGGLE code would leave the ledger believing the TV is the other way round, and the next session's switch-on could turn
    // the TV off in front of a customer (rule 16). Only a TV with separate on and off codes is tested from here.
    { name: 'bay_ir_test', area: 'baysetup', kind: 'write', confirm: (a) => a.on === false, confirmSay: ' (sending an off code is shown to the owner to approve first)',
      say: 'Send a bay TV\'s learned on or off code now, to test it - only for a TV whose remote has separate on and off buttons ("try the TV\'s on code", "does the TV come on")',
      params: { type: 'object', properties: { bay: BAY, device: { type: 'string', minLength: 1, maxLength: 60, description: 'the TV remote\'s name or address on that bay' }, on: { type: 'boolean', description: 'true for the on code, false for the off code' } }, required: ['bay', 'device', 'on'] },
      needs: ['bays'],
      build: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const x = deviceOnBay(bay, a.device, ['ir']);
        if (x.d.codeStyle !== 'discrete') throw new ActionError(`${label(x)} uses one power button (a toggle code), so a test press from here could leave the unit believing the TV is the other way round, and the next session could turn it off in front of a customer. Test it with the whole bay's on and off (bay_switch), which keep track - or with the TV's own remote`);
        const cmd = a.on ? x.d.onCommand : x.d.offCommand;
        if (!cmd) throw new ActionError(`no ${a.on ? 'ON' : 'OFF'} code is learned for ${label(x)} yet - bay_tv_learn learns it from the TV's own remote`);
        return { op: 'http', method: 'POST', path: '/api/admin/broadlink/send', body: { ip: x.d.ip, command: cmd } };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const x = deviceOnBay(bay, a.device, ['ir']);
        return `Send the learned ${a.on ? 'ON' : 'OFF'} code to ${label(x)} on ${bay.name} now, to test it (its remote has separate on and off buttons, so this cannot switch it the wrong way). If nothing happens, the BroadLink may not be in its line of sight, or the code needs learning again.`;
      } },

    // ── a TV by talking (Oct 21 2026, the device audit - maintainer: "make sure ... the AI can control it properly"): found, put on
    //    a bay, its codes learned from its own remote, renamed or moved, taken off - each the bay editor's own keys ──
    // GET /api/admin/broadlink/discover (routes/admin.js -> broadlink-bridge.py /discover: each BroadLink's address, MAC
    // and model). Nothing is changed.
    { name: 'tv_remote_find', area: 'baysetup', kind: 'read',
      say: 'Look for the BroadLink TV remotes (the small IR boxes that switch TVs and projectors) on the facility\'s network, and which bays each is on already',
      params: { type: 'object', properties: {} },
      needs: ['bays'],
      local: async (a, ctx) => {
        const j = await getJson(ctx, '/api/admin/broadlink/discover');
        if (!j || j.error || !Array.isArray(j.devices)) return { error: `the TV remote service (the BroadLink bridge, beside the booking system) did not answer${j && j.error ? ': ' + plainWhy(j.error) : ''}` };
        const onBays = (ip) => (ctx.bays || []).filter(b => arr(b.broadlinkDevices).some(d => d && d.ip === ip)).map(b => b.name);
        const found = j.devices.filter(d => d && d.ip).map(d => ({ address: d.ip, model: d.model || 'BroadLink', on: onBays(d.ip).length ? onBays(d.ip) : 'not on a bay' }));
        return { found, note: found.length ? 'bay_tv_add puts a TV on a bay through one of these; bay_tv_learn then learns its code from the TV\'s own remote' : 'no BroadLink answered: it must be plugged in and joined to the same network (its own app does that)' };
      } },
    // A TV on a bay: the bay editor's BroadLink row (admin.html createBroadlinkRowHTML / readBaysFromEditor - the same keys),
    // saved by the Settings save (POST /api/admin/config, routes/admin.js:100), guarded by the list's length. A TV is a TOGGLE
    // (one power button) unless the owner says its remote has separate ON and OFF buttons (rule 16). No code yet: until one is
    // learned (bay_tv_learn) the TV is not switched.
    { name: 'bay_tv_add', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Put a TV or projector on a bay through a BroadLink TV remote (tv_remote_find finds them): once its code is learned it comes on before each session and goes off after',
      params: { type: 'object', properties: { bay: BAY,
        address: { type: 'string', minLength: 7, maxLength: 15, description: 'the BroadLink\'s address, from tv_remote_find' },
        name: { type: 'string', minLength: 1, maxLength: 40, description: 'what it switches, like "TV" or "Projector"' },
        separate_buttons: { type: 'boolean', description: 'true only when the TV\'s own remote has separate ON and OFF buttons (most have one power button)' },
        minutes_before: { type: 'integer', minimum: 1, maximum: 60 }, minutes_after: { type: 'integer', minimum: 5, maximum: 120 },
        turn_off_after: { type: 'boolean', description: 'false to leave it on after sessions' } }, required: ['bay', 'address', 'name'] },
      needs: ['bays'],
      build: (a, ctx) => {
        const ip = address(a.address, false);
        const { i, bay } = findBay(ctx, a.bay); const cur = arr(bay.broadlinkDevices);
        if (cur.some(d => d && lc(d.name) === lc(a.name))) throw new ActionError(`${bay.name} already has a TV remote called "${a.name}"`);
        const dev = { name: String(a.name).trim(), ip, minutesBefore: a.minutes_before || 10, turnOffAfter: a.turn_off_after !== false, minutesAfter: a.minutes_after || 30, onCommand: '', offCommand: '', codeStyle: a.separate_buttons ? 'discrete' : 'toggle' };
        return { op: 'config', set: [[`bays.${i}.broadlinkDevices`, cur.concat([dev])]], expect: [[`bays.${i}.id`, bay.id]].concat(Array.isArray(bay.broadlinkDevices) ? [[`bays.${i}.broadlinkDevices.length`, cur.length]] : []) };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const ip = String(a.address).trim();
        const others = (ctx.bays || []).filter(b => b.id !== bay.id && arr(b.broadlinkDevices).some(d => d && d.ip === ip)).map(b => b.name);
        return `Put "${a.name}" on ${bay.name}, switched by the BroadLink at ${ip}${others.length ? ` (it switches a TV on ${and(others)} too)` : ''}: on ${mins(a.minutes_before || 10)} before each session, ${a.turn_off_after === false ? 'left on after' : `off ${mins(a.minutes_after || 30)} after it ends`}. `
          + `Its remote: ${a.separate_buttons ? 'separate ON and OFF buttons' : 'one power button (the unit keeps track of whether the TV is on, so a second press never switches it back)'}. Next its code is learned from its own remote (bay_tv_learn) - until then it is not switched.`;
      } },
    // POST /api/admin/broadlink/learn/assign (routes/admin.js): the BroadLink listens, the owner presses the button on the TV's
    // own remote within a few seconds of tapping Apply, and the code is saved on that bay's TV in the same step
    { name: 'bay_tv_learn', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Learn a bay TV\'s code from its own remote: the owner taps Apply, then points the remote at the BroadLink and presses the button within a few seconds. One power button: learned once, for on and off. Separate buttons: ON and OFF one at a time - not to test a code already learned (that is bay_ir_test)',
      params: { type: 'object', properties: { bay: BAY, device: { type: 'string', minLength: 1, maxLength: 60, description: 'the TV\'s name or the BroadLink\'s address on that bay' },
        button: { type: 'string', enum: ['power', 'on', 'off'], description: '"power" for a remote with one power button; "on" or "off" for one with separate buttons (left out: the one still missing)' } }, required: ['bay', 'device'] },
      needs: ['bays'],
      build: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const x = deviceOnBay(bay, a.device, ['ir']);
        return { op: 'http', method: 'POST', path: '/api/admin/broadlink/learn/assign', body: { bay_id: bay.id, index: x.j, ip: x.d.ip, which: learnWhich(a, x) } };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const x = deviceOnBay(bay, a.device, ['ir']); const w = learnWhich(a, x);
        const had = w === 'power' ? x.d.onCommand || x.d.offCommand : w === 'on' ? x.d.onCommand : x.d.offCommand;
        return `When you tap Apply, point the ${x.name || 'TV'}'s own remote at the BroadLink (${x.d.ip}) and press its ${w === 'power' ? 'POWER' : w.toUpperCase()} button within about five seconds. `
          + `The code is saved on ${bay.name}'s ${label(x)}${w === 'power' ? ' and used to switch it both on and off' : ''}${had ? ' - it replaces the one learned before' : ''}. `
          + `To try it, turn ${bay.name} on and off (bay_switch)${w === 'on' && !x.d.offCommand ? '; its OFF button is learned next' : ''}.`;
      } },
    // A TV off a bay: the bay editor's X on a BroadLink row, guarded like a plug. Its learned codes go with it.
    { name: 'bay_tv_remove', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Take a TV (its BroadLink TV remote) off a bay, with its learned codes - it no longer switches with the bay\'s sessions',
      params: { type: 'object', properties: { bay: BAY, device: { type: 'string', minLength: 1, maxLength: 60, description: 'the TV\'s name or the BroadLink\'s address on that bay' } }, required: ['bay', 'device'] },
      needs: ['bays'],
      build: (a, ctx) => {
        const { i, bay } = findBay(ctx, a.bay); const x = deviceOnBay(bay, a.device, ['ir']); const cur = arr(bay.broadlinkDevices);
        return { op: 'config', set: [[`bays.${i}.broadlinkDevices`, cur.filter((d, j) => j !== x.j)]],
          expect: [[`bays.${i}.id`, bay.id], [`bays.${i}.broadlinkDevices.length`, cur.length], [`bays.${i}.broadlinkDevices.${x.j}.ip`, x.id]] };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const x = deviceOnBay(bay, a.device, ['ir']);
        return `Take ${label(x)} off ${bay.name}: the TV is left as it is now (on or off) and no longer switches with ${bay.name}'s sessions.${x.d.onCommand || x.d.offCommand ? ' Its learned codes go with it - put back, they are learned again.' : ''}`;
      } },
    // A plug's or a TV's name and address, and whether a TV's remote has separate buttons: the bay editor's own fields, saved by
    // the Settings save, each at its place and guarded by its address there
    { name: 'bay_device_set', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Rename a smart plug or a TV on a bay, change its network address (a plug or a BroadLink that moved), or say whether a TV\'s own remote has separate ON and OFF buttons',
      params: { type: 'object', properties: { bay: BAY, device: { type: 'string', minLength: 1, maxLength: 60, description: 'the plug\'s or TV\'s name or address on that bay' },
        name: { type: 'string', minLength: 1, maxLength: 40, description: 'its new name' },
        address: { type: 'string', minLength: 7, maxLength: 21, description: 'its new network address' },
        separate_buttons: { type: 'boolean', description: 'a TV: true when its own remote has separate ON and OFF buttons, false for one power button' } }, required: ['bay', 'device'] },
      needs: ['bays'],
      build: (a, ctx) => deviceSet(a, ctx).op,
      describe: (a, ctx) => deviceSet(a, ctx).say },

    // ── routines: "watch me, then do it for me" (Oct 21 2026; BA-CORE-2-AI.md section 16; playbook 03 "Routines") ──
    // GET /api/admin/routines (routes/routines.js): each bay's routines in words, when each runs, its last runs, and a
    // teaching waiting for the PC or come back as a draft
    { name: 'routines_read', area: 'routines', kind: 'read',
      say: 'See the routines taught on the bays\' PCs - each one\'s steps in words, when it runs, how its last runs went - and a teaching waiting for the PC or come back with its steps',
      params: { type: 'object', properties: { bay: { ...BAY, description: 'just this bay; leave out for all' } } },
      needs: ['bays', 'bayRoutines'],
      local: async (a, ctx) => {
        const R = ctx.bayRoutines; if (!R || !R.read) return { error: 'the routines could not be read just now' };
        const only = a.bay ? findBay(ctx, a.bay).bay.id : null;
        return { bays: (R.bays || []).filter(b => !only || b.id === only).map(b => ({ bay: b.name,
          teaching: b.teach ? (b.teach.state === 'draft' ? { name: b.teach.name, back_from_the_pc: true, steps: (b.teach.steps || []).map((s, i) => `${i + 1}. ${require('../../routines').stepWords(s)}`) }
            : b.teach.program ? { showing_the_pc: b.teach.program, waiting_for_the_pc: true } : { name: b.teach.name, waiting_for_the_pc: true }) : undefined,
          pc: !b.pc ? 'its PC has not checked in for routines yet (bay_watcher_download, installed on that PC, and the PC on)'
            : Array.isArray(b.pc.taught) ? `checked in ${b.pc.seen_at} UTC; it was shown ${b.pc.taught.length ? b.pc.taught.join(', ') : 'no programs yet'}` : `checked in ${b.pc.seen_at} UTC (a watcher from before this update - it does not say which programs it was shown)`,
          routines: (b.routines || []).map(r => Object.assign({ name: r.name, steps: r.steps.map(s => `${s.n}. ${s.say}`), runs: r.when.length ? r.when : ['only when asked'],
            colour: colourWords(r.color), last: r.last_run_at ? `${r.last_ok ? 'worked' : 'stopped'} - ${r.last_detail}` : 'never run yet' },
            r.enabled ? {} : { paused: true }, (r.needs || []).length ? { its_pc_not_yet_shown: r.needs } : {})) })) };
      } },
    // POST /api/admin/routines/teach: the bay PC's watcher puts up its teaching bar on its next look (about ten seconds)
    { name: 'routine_teach', area: 'routines', kind: 'write', confirm: true,
      read: teachRead,
      say: 'Start teaching a routine on a bay\'s PC: the owner clicks through it there once (the watcher records the clicks, the words under them, Enter and the like - never letters typed), then names it and says when it runs',
      params: { type: 'object', properties: { bay: BAY, name: { type: 'string', minLength: 1, maxLength: 40, description: 'what it does, like "Start GSPro" or "Uneekor sign-in"' },
        program: { type: 'string', maxLength: 80, description: 'instead of a routine: only show the PC a program a copied routine opens (its name, like "GSPro.exe" - routines_read says which a bay\'s PC has not been shown)' } }, required: ['bay'] },
      needs: ['bays', 'bayRoutines'],
      build: (a, ctx) => {
        const { bay, entry } = bayRoutinesOf(ctx, a.bay);
        if (entry.teach && entry.teach.state === 'draft') throw new ActionError(`a teaching on ${bay.name} came back with its steps and is not saved yet - save it (routine_save) first, or teaching again replaces it`);
        if (!a.program && !a.name) throw new ActionError('say what the routine does, like "Start GSPro"');
        return { op: 'http', method: 'POST', path: '/api/admin/routines/teach', body: a.program ? { bay_id: bay.id, program: a.program } : { bay_id: bay.id, name: a.name } };
      },
      describe: (a, ctx) => { const { bay } = findBay(ctx, a.bay);
        if (a.program) return `Show ${bay.name}'s PC ${a.program}: within about ten seconds a bar across its screen says what to do - close ${a.program} if it is open, open it once, then press Ctrl+Shift+F11. From then on a routine on ${bay.name} may open and close it. Nothing else is kept.`;
        return `Teach "${a.name}" on ${bay.name}'s PC: within about ten seconds a bar across its screen says Teaching. Click through it the way you always do, then press Ctrl+Shift+F11 to finish (Ctrl+Shift+F10 stops it, nothing kept). `
          + 'At a password box, press Ctrl+Shift+F9 and type the password into the box the PC shows - it is kept on that PC only, and the routine types it from there. Letters you type are never recorded. The bay\'s watcher must be one downloaded after this update (bay_watcher_download).'; } },
    // POST /api/admin/routines/save: the steps the PC sent back, saved with when it runs (or onto a routine, to teach it again)
    { name: 'routine_save', area: 'routines', kind: 'write', confirm: true,
      say: 'Save the steps a bay PC sent back from teaching as a routine, with when it runs: when a session starts, when the PC starts, when a program opens or closes, when a window appears, on a hotkey, from the staff pad - or only when asked - this is the save after "watch me" (routine_teach): never routine_create for those steps',
      params: { type: 'object', properties: Object.assign({ bay: BAY, name: { type: 'string', minLength: 1, maxLength: 40, description: 'its name (left out: the name it was taught under)' },
        replaces: { type: 'string', maxLength: 40, description: 'the routine these steps replace, when it was taught again' },
        colour: { type: 'string', maxLength: 30, description: 'its button colour on the staff pad: a plain name (green, red, navy, gold ...) or #RRGGBB' } }, TRIGGER_PARAMS), required: ['bay'] },
      needs: ['bays', 'bayRoutines'],
      build: (a, ctx) => {
        const { bay, entry } = bayRoutinesOf(ctx, a.bay);
        if (!entry.teach || entry.teach.state !== 'draft') throw new ActionError(entry.teach ? `the teaching on ${bay.name} has not come back from its PC yet - finish it there with Ctrl+Shift+F11` : `nothing taught on ${bay.name} is waiting to be saved - routine_teach starts one`);
        const old = a.replaces ? findRoutine(ctx, a.bay, a.replaces).routine : null;
        return { op: 'http', method: 'POST', path: '/api/admin/routines/save', body: Object.assign({ bay_id: bay.id, id: old ? old.id : undefined, name: a.name || (old && old.name) || entry.teach.name, triggers: triggersOf(a, old ? old.triggers : null) },
          a.colour !== undefined ? { color: routineColour(a.colour) } : {}) };
      },
      describe: (a, ctx) => {
        const { bay, entry } = bayRoutinesOf(ctx, a.bay); const t = entry.teach || {};
        return `Save "${a.name || a.replaces || t.name}" on ${bay.name}${a.replaces ? ` in place of the old "${a.replaces}"` : ''}: ${(t.steps || []).length} steps - ${(t.steps || []).map((s, i) => `${i + 1}. ${require('../../routines').stepWords(s)}`).join('; ')}. It runs ${runsWhen(triggersOf(a, null))}.`;
      } },
    // PUT /api/admin/routines/:id: when it runs, its name, its colour, paused or running
    { name: 'routine_when_set', area: 'routines', kind: 'write', confirm: true,
      say: 'For a routine that is there already (routines_read; a new one from steps the owner says is routine_create): change it: when it runs (when a session starts - and how many minutes before - when a session ends, every day at a time, when the PC starts, when a program opens or closes, when a window appears, its hotkey, the staff pad), its name, its button colour on the staff pad, or pause it (nothing starts it but the owner) and resume it',
      params: { type: 'object', properties: Object.assign({ bay: BAY, routine: { type: 'string', minLength: 1, maxLength: 40 }, new_name: { type: 'string', minLength: 1, maxLength: 40 },
        colour: { type: 'string', maxLength: 30, description: 'its button colour on the staff pad: a plain name (green, red, navy, gold ...), #RRGGBB, or "none"' },
        paused: { type: 'boolean', description: 'true pauses it (no trigger starts it, it leaves the staff pad), false runs it again' } }, TRIGGER_PARAMS), required: ['bay', 'routine'] },
      needs: ['bays', 'bayRoutines'],
      build: (a, ctx) => {
        const { routine } = findRoutine(ctx, a.bay, a.routine);
        if (!hasTrigger(a) && a.new_name === undefined && a.colour === undefined && a.paused === undefined) throw new ActionError('say when it should run, its new name, its colour, or whether to pause it');
        return { op: 'http', method: 'PUT', path: `/api/admin/routines/${routine.id}`, body: Object.assign(hasTrigger(a) ? { triggers: triggersOf(a, routine.triggers) } : {}, a.new_name ? { name: a.new_name } : {},
          a.colour !== undefined ? { color: routineColour(a.colour) } : {}, a.paused !== undefined ? { enabled: !a.paused } : {}) };
      },
      describe: (a, ctx) => {
        const { bay, routine } = findRoutine(ctx, a.bay, a.routine);
        const parts = [];
        if (a.new_name) parts.push(`is called "${a.new_name}"`);
        if (hasTrigger(a)) parts.push(`runs ${runsWhen(triggersOf(a, routine.triggers))} (it ran ${routine.when.length ? routine.when.join(', ') : 'only when asked'})`);
        if (a.colour !== undefined) { const h = routineColour(a.colour); parts.push(h ? `has a ${colourWords(h)} button on the staff pad (${h})` : 'has a plain button on the staff pad'); }
        if (a.paused === true) parts.push('is paused - nothing starts it but you, and it leaves the staff pad');
        if (a.paused === false) parts.push('runs again');
        return `"${routine.name}" on ${bay.name} ${parts.join('; ')}.`;
      } },
    // POST /api/admin/routines/:id/steps: one step changed, taken out or added - each click keeps its picture
    { name: 'routine_step_set', area: 'routines', kind: 'write', confirm: true,
      say: 'Change one step of a routine: click it by its words (wait for them to show) or by its spot, how long a wait is, take a step out, or add a wait, a key press or the PC\'s kept password after a step',
      params: { type: 'object', properties: { bay: BAY, routine: { type: 'string', minLength: 1, maxLength: 40 },
        step: { type: 'integer', minimum: 0, maximum: 60, description: 'the step\'s number from routines_read (0 to add one at the start)' },
        change: { type: 'string', enum: ['click_by_words', 'click_by_spot', 'wait_seconds', 'remove', 'move_up', 'move_down', 'add_wait_after', 'add_key_after', 'add_password_after', 'add_text_after', 'add_close_after'] },
        seconds: { type: 'number', minimum: 0, maximum: 120, description: 'a wait\'s seconds; for a click by its words, how long to wait for them' },
        keys: { type: 'string', maxLength: 30, description: 'the key to add, like "enter" or "ctrl+s"' },
        password_name: { type: 'string', maxLength: 40, description: 'the name a password is kept under on the PC' },
        text: { type: 'string', maxLength: 200, description: 'words to type (never a password - those are kept on the PC)' },
        program: { type: 'string', maxLength: 80, description: 'a program to close, like "GSPro.exe" (one shown on that PC)' } }, required: ['bay', 'routine', 'step', 'change'] },
      needs: ['bays', 'bayRoutines'],
      build: (a, ctx) => {
        const { routine } = findRoutine(ctx, a.bay, a.routine);
        const n = a.step, path = `/api/admin/routines/${routine.id}/steps`;
        const body = a.change === 'click_by_words' ? { op: 'set', n, step: Object.assign({ by: 'words' }, a.seconds !== undefined ? { wait: a.seconds } : {}) }
          : a.change === 'click_by_spot' ? { op: 'set', n, step: { by: 'spot' } }
          : a.change === 'wait_seconds' ? { op: 'set', n, step: { seconds: a.seconds } }
          : a.change === 'remove' ? { op: 'remove', n }
          : a.change === 'add_wait_after' ? { op: 'insert', n, step: { do: 'wait', seconds: a.seconds } }
          : a.change === 'add_key_after' ? { op: 'insert', n, step: { do: 'key', keys: a.keys } }
          : a.change === 'move_up' ? { op: 'move', n, to: n - 1 }
          : a.change === 'move_down' ? { op: 'move', n, to: n + 1 }
          : a.change === 'add_text_after' ? { op: 'insert', n, step: { do: 'type', text: a.text } }
          : a.change === 'add_close_after' ? { op: 'insert', n, step: { do: 'close', program: closeProgram(routine, a.program) } }
          : { op: 'insert', n, step: { do: 'type_secret', name: a.password_name } };
        if (['wait_seconds', 'add_wait_after'].includes(a.change) && a.seconds === undefined) throw new ActionError('say how many seconds');
        if (a.change === 'add_key_after' && !a.keys) throw new ActionError('say which key');
        if (a.change === 'add_password_after' && !a.password_name) throw new ActionError('say the name the password is kept under on the PC (it was named when it was typed into the PC\'s own box)');
        if (a.change === 'add_text_after' && !a.text) throw new ActionError('say the words to type');
        if (a.change === 'add_close_after' && !a.program) throw new ActionError('say which program to close, like GSPro');
        const s = routine.steps[n - 1];
        if (/^click_by/.test(a.change) && (!s || s.do !== 'click')) throw new ActionError(`step ${n} is not a click (${s ? s.say : 'there is no such step'})`);
        return { op: 'http', method: 'POST', path, body };
      },
      describe: (a, ctx) => {
        const { bay, routine } = findRoutine(ctx, a.bay, a.routine); const s = routine.steps[a.step - 1];
        const what = { click_by_words: `click it by its words - wait${a.seconds !== undefined ? ` up to ${a.seconds} seconds` : ''} for them to show and click them wherever they are (it keeps working when a button moves)`,
          click_by_spot: 'click it by its spot in the window (for an icon with no words)', wait_seconds: `wait ${a.seconds} seconds`, remove: 'take it out',
          add_wait_after: `add a wait of ${a.seconds} seconds after it`, add_key_after: `add a press of ${a.keys} after it`, add_password_after: `add typing the password kept on the PC as "${a.password_name}" after it`,
          move_up: 'move it up one', move_down: 'move it down one', add_text_after: `add typing "${a.text}" after it`, add_close_after: `add closing ${a.program} after it` }[a.change];
        return `"${routine.name}" on ${bay.name}, step ${a.step}${s ? ` (${s.say})` : ''}: ${what}.`;
      } },
    // POST /api/admin/routines/:id/run: the PC's watcher picks it up on its next look (about ten seconds)
    { name: 'routine_run', area: 'routines', kind: 'write', confirm: true,
      say: 'Run a routine on its bay\'s PC now - the PC does the clicks within about ten seconds',
      params: { type: 'object', properties: { bay: BAY, routine: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['bay', 'routine'] },
      needs: ['bays', 'bayRoutines', 'bayNow'],
      build: (a, ctx) => { const { routine } = findRoutine(ctx, a.bay, a.routine); return { op: 'http', method: 'POST', path: `/api/admin/routines/${routine.id}/run`, body: {} }; },
      describe: (a, ctx) => { const { bay, routine } = findRoutine(ctx, a.bay, a.routine); return `Run "${routine.name}" on ${bay.name}'s PC now: ${routine.steps.length} steps, within about ten seconds.${playingNote(ctx, bay, 'its screen will be clicked while they play')}`; } },
    // POST /api/admin/routines/:id/copy: the same routine on other bays - each says how it went, and what its PC still needs shown
    { name: 'routine_copy', area: 'routines', kind: 'write', confirm: true,
      say: 'Copy a routine to other bays (or every other bay): the same steps, when it runs and its colour. A program it opens must be shown once on each of those bays\' PCs (routine_teach with program)',
      params: { type: 'object', properties: { bay: BAY, routine: { type: 'string', minLength: 1, maxLength: 40 },
        to: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string', maxLength: 40 }, description: 'the bays to copy it to, or ["all"] for every other bay' },
        replace: { type: 'boolean', description: 'replace a routine of the same name on those bays' } }, required: ['bay', 'routine', 'to'] },
      needs: ['bays', 'bayRoutines'],
      build: (a, ctx) => {
        const { bay, routine } = findRoutine(ctx, a.bay, a.routine);
        const all = (a.to || []).some(x => /^(all|every( other)? bay|all( the)?( other)? bays)$/i.test(String(x).trim()));
        const ids = all ? 'all' : [...new Set((a.to || []).map(x => findBay(ctx, x).bay.id))].filter(id => id !== bay.id);
        if (ids !== 'all' && !ids.length) throw new ActionError('say which other bays to copy it to');
        return { op: 'http', method: 'POST', path: `/api/admin/routines/${routine.id}/copy`, body: { bays: ids, replace: a.replace === true } };
      },
      describe: (a, ctx) => {
        const { bay, routine } = findRoutine(ctx, a.bay, a.routine);
        const all = (a.to || []).some(x => /^(all|every( other)? bay|all( the)?( other)? bays)$/i.test(String(x).trim()));
        const names = all ? 'every other bay' : and([...new Set((a.to || []).map(x => findBay(ctx, x).bay.name))].filter(n => n !== bay.name));
        const opens = [...new Set((routine.steps || []).filter(s => s.do === 'open').map(s => s.say.replace(/^Open /, '')))];
        return `Copy "${routine.name}" from ${bay.name} to ${names}: its ${routine.steps.length} steps, ${runsWhen(routine.triggers)}${routine.color ? `, its ${colourWords(routine.color)} button` : ''}.${a.replace ? ' A routine of the same name there is replaced.' : ''}`
          + (opens.length ? ` Each of those PCs must have been shown ${and(opens)} once (routine_teach with program) - the result says which have not.` : '');
      } },
    // POST /api/admin/routines: a routine made from words alone - no clicks and no program opened (those are shown on the PC)
    { name: 'routine_create', area: 'routines', kind: 'write', confirm: true,
      read: closeRead,
      say: 'Make a routine from words alone when it clicks nothing and opens nothing: close a program, press keys, wait, wait for a window, type words, or type a password kept on the PC - with when it runs and its colour. Anything with a click or a program to open is taught on the PC (routine_teach) - a NEW routine from steps the owner says; the steps a bay PC sent back after "watch me" are saved with routine_save',
      params: { type: 'object', properties: Object.assign({ bay: BAY, name: { type: 'string', minLength: 1, maxLength: 40, description: 'what it does, like "Close GSPro"' },
        steps: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {
          do: { type: 'string', enum: ['close', 'key', 'wait', 'wait_window', 'type', 'password'] },
          program: { type: 'string', maxLength: 80, description: 'close: the program, like "GSPro.exe"' },
          keys: { type: 'string', maxLength: 30, description: 'key: like "esc", "enter" or "alt+f4"' },
          seconds: { type: 'number', minimum: 0.2, maximum: 300, description: 'wait: seconds; wait_window: how long to wait for it' },
          window: { type: 'string', maxLength: 120, description: 'wait_window: words in its title' },
          text: { type: 'string', maxLength: 200, description: 'type: the words' },
          password_name: { type: 'string', maxLength: 40, description: 'password: the name it is kept under on the PC' } }, required: ['do'] } },
        colour: { type: 'string', maxLength: 30, description: 'its button colour on the staff pad: a plain name or #RRGGBB' } }, TRIGGER_PARAMS), required: ['bay', 'name', 'steps'] },
      needs: ['bays', 'bayRoutines'],
      build: (a, ctx) => {
        const { bay } = bayRoutinesOf(ctx, a.bay);
        const steps = (a.steps || []).map((x, i) => {
          if (x.do === 'close') { if (!x.program) throw new ActionError(`step ${i + 1}: say which program to close`); return { do: 'close', program: x.program }; }
          if (x.do === 'key') { if (!x.keys) throw new ActionError(`step ${i + 1}: say which key`); return { do: 'key', keys: x.keys }; }
          if (x.do === 'wait') { if (x.seconds === undefined) throw new ActionError(`step ${i + 1}: say how many seconds`); return { do: 'wait', seconds: x.seconds }; }
          if (x.do === 'wait_window') { if (!x.window) throw new ActionError(`step ${i + 1}: say which window`); return Object.assign({ do: 'wait_window', title: x.window }, x.seconds !== undefined ? { seconds: x.seconds } : {}); }
          if (x.do === 'type') { if (!x.text) throw new ActionError(`step ${i + 1}: say the words to type`); return { do: 'type', text: x.text }; }
          if (!x.password_name) throw new ActionError(`step ${i + 1}: say the name the password is kept under on the PC`);
          return { do: 'type_secret', name: x.password_name };
        });
        return { op: 'http', method: 'POST', path: '/api/admin/routines', body: Object.assign({ bay_id: bay.id, name: a.name, steps, triggers: triggersOf(a, null) }, a.colour !== undefined ? { color: routineColour(a.colour) } : {}) };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay);
        const W = require('../../routines');
        const said = (a.steps || []).map((x, i) => `${i + 1}. ${x.do === 'password' ? `Type the password kept on the PC as "${x.password_name}"` : x.do === 'wait_window' ? `Wait for the ${x.window} window` : W.stepWords(Object.assign({}, x, { title: x.window }))}`);
        return `Make "${a.name}" on ${bay.name}: ${said.join('; ')}. It runs ${runsWhen(triggersOf(a, null))}${a.colour ? `, with a ${colourWords(routineColour(a.colour))} button on the staff pad` : ''}.`;
      } },
    { name: 'routine_remove', area: 'routines', kind: 'write', confirm: true,
      say: 'Remove a routine from a bay (its PC stops running it on any trigger)',
      params: { type: 'object', properties: { bay: BAY, routine: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['bay', 'routine'] },
      needs: ['bays', 'bayRoutines'],
      build: (a, ctx) => { const { routine } = findRoutine(ctx, a.bay, a.routine); return { op: 'http', method: 'DELETE', path: `/api/admin/routines/${routine.id}` }; },
      describe: (a, ctx) => { const { bay, routine } = findRoutine(ctx, a.bay, a.routine); return `Remove "${routine.name}" from ${bay.name}: it no longer runs ${routine.when.length ? routine.when.join(', ') : 'when asked'}. A password it typed stays kept on the PC until it is changed there.`; } },

    // The bay editor's Bay Name, Description and Features (admin.html createBayBlock), saved by the Settings save (POST
    // /api/admin/config, routes/admin.js:100). The bay's id never changes - bookings and the watcher are tied to it.
    { name: 'bay_details_set', area: 'baysetup', kind: 'write', confirm: false,
      say: 'Rename a bay, or change its tagline or the feature chips shown for it on the booking page',
      params: { type: 'object', properties: { bay: BAY,
        name: { type: 'string', minLength: 1, maxLength: 40, description: 'the bay\'s new name' },
        description: { type: 'string', maxLength: 200, description: 'its tagline on the booking page' },
        features: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 40 }, description: 'short feature chips, like "GSPro", "Couch seating", "Left-handed friendly"' } }, required: ['bay'] },
      needs: ['bays'],
      build: (a, ctx) => {
        const { i, bay } = findBay(ctx, a.bay);
        if (a.name !== undefined && (ctx.bays || []).some((b, j) => j !== i && lc(b.name) === lc(a.name))) throw new ActionError(`another bay is already called "${a.name}"`);
        const set = [[`bays.${i}.name`, a.name], [`bays.${i}.description`, a.description], [`bays.${i}.features`, a.features && a.features.filter(Boolean)]].filter(([, v]) => v !== undefined);
        if (!set.length) throw new ActionError('say the new name, the tagline or the feature chips');
        return { op: 'config', set, expect: [[`bays.${i}.id`, bay.id]] };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const parts = [];
        if (a.name !== undefined && a.name !== bay.name) parts.push(`Rename ${bay.name} to "${a.name}": the booking page and the staff screens show the new name; bookings already made keep "${bay.name}" in their messages, and the bay's watcher shows the old name until it is built again (bay_watcher_download)`);
        if (a.description !== undefined) parts.push(`${a.name || bay.name}'s tagline: "${a.description}"`);
        if (a.features !== undefined) parts.push(`its feature chips: ${a.features.filter(Boolean).join(', ') || 'none'}`);
        return parts.join('; ') || `${bay.name} stays as it is`;
      } },

    // The bay editor's Price Adjustment ($ per 30 min -> priceAdjustCents), saved by the Settings save (POST /api/admin/config,
    // routes/admin.js:100); priced by services/pricing.js publicBlocks: added to every half hour only when the customer picks
    // that bay, never in whole-facility mode
    { name: 'bay_price_adjust_set', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Charge more (a premium bay) or less for one bay, per half hour on top of the regular rates, when a customer picks that bay - 0 for no difference',
      params: { type: 'object', properties: { bay: BAY, dollars_per_half_hour: { type: 'number', minimum: -100, maximum: 100, description: 'dollars added per half hour; a minus number for a cheaper bay; 0 for none' } }, required: ['bay', 'dollars_per_half_hour'] },
      needs: ['bays', 'bayConfig'],
      build: (a, ctx) => {
        const C = settingsRead(ctx); const { i, bay } = findBay(ctx, a.bay);
        if (C.wholeFacility) throw new ActionError('the facility is booked as a whole (nobody picks a bay), so a bay\'s own price adjustment never applies');
        const cents = Math.round(a.dollars_per_half_hour * 100);
        if (cents < 0 && C.pricePerHalfHour != null && -cents >= Math.round(C.pricePerHalfHour * 100)) throw new ActionError(`that would make a half hour on ${bay.name} free or less at your base price of $${C.pricePerHalfHour} - say a smaller discount`);
        if ((Number(bay.priceAdjustCents) || 0) === cents) throw new ActionError(`${bay.name} already has that price adjustment`);
        return { op: 'config', set: [[`bays.${i}.priceAdjustCents`, cents]], expect: [[`bays.${i}.id`, bay.id]] };
      },
      describe: (a, ctx) => {
        const { bay } = findBay(ctx, a.bay); const cents = Math.round(a.dollars_per_half_hour * 100);
        if (!cents) return `${bay.name} costs the same as the other bays: no price adjustment.`;
        return `${bay.name} costs ${dollars(cents)} ${cents > 0 ? 'more' : 'less'} per half hour than your regular rates when a customer picks it${cents > 0 ? ' (it shows as PREMIUM)' : ''}; a booking where the system picks the bay is never charged it.`;
      } },

    // A new bay: the bay editor's + Add Bay in the wizard's shape (public/setup.html: id bay-<n>, the same field names), saved
    // by the Settings save (POST /api/admin/config, routes/admin.js:100) at the end of the list, guarded by the list's length
    // ALL THE BAYS AT ONCE (Oct 21 2026, night - the customer's day one): "we have 4 simulator bays, call them Bay 1, Bay 2, Bay 3
    // and The Vault" on a box with one bay - the box's small model said "You have 4 bays" and added none. bay_add is one bay a
    // call (four calls and a rename for a small model), and two adds in one turn would want the same place in the list
    { name: 'bays_list_set', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Set the facility\'s bays all at once, in order, when the owner says how many bays there are or names them ("we have 4 bays: Bay 1, Bay 2, Bay 3 and The Vault"): the bays there now are renamed in order and the rest are added, bookable at once. Never takes a bay away (that is bay_remove)',
      params: { type: 'object', properties: {
        names: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'string', minLength: 1, maxLength: 40 }, description: 'every bay\'s name in order - "Bay 1", "Bay 2", ... when the owner said only how many' } }, required: ['names'] },
      needs: ['bays', 'bayConfig'],
      build: (a, ctx) => {
        settingsRead(ctx); const bays = ctx.bays || [];
        const names = a.names.map(x => String(x).trim()).filter(Boolean);
        if (names.length < bays.length) throw new ActionError(`there are ${bays.length} bays now (${bays.map(b => b.name).join(', ')}) - name every one of them, or take one away with bay_remove`);
        const seen = new Set(); for (const n of names) { if (seen.has(lc(n))) throw new ActionError(`two bays called "${n}"`); seen.add(lc(n)); }
        const set = [], ids = new Set(bays.map(b => String(b.id)));
        bays.forEach((b, i) => { if (b.name !== names[i]) set.push([`bays.${i}.name`, names[i]]); });
        let k = bays.length + 1;
        for (let i = bays.length; i < names.length; i++) {
          while (ids.has('bay-' + k)) k++; ids.add('bay-' + k);
          set.push([`bays.${i}`, { id: 'bay-' + k, name: names[i], description: 'Full swing simulator bay', features: [], priceAdjustCents: 0, active: true,
            shellyDevices: [], broadlinkDevices: [], haDevices: [], simulatorPcIp: '', pcMac: '', pcWakeMinutesBefore: 10, simulatorWinUser: 'Admin', simulatorWinPass: '' }]);
        }
        if (!set.length) throw new ActionError('the bays are already ' + names.join(', '));
        set.push(['setupAck.bays', true]);   // set up by talking: the owner's answer to "Your bays" (setup-status)
        return { op: 'config', set, expect: [['bays.length', bays.length]] };
      },
      describe: (a, ctx) => {
        const bays = ctx.bays || [], names = a.names.map(x => String(x).trim()).filter(Boolean);
        const renamed = bays.map((b, i) => b.name !== names[i] ? `${b.name} becomes "${names[i]}"` : null).filter(Boolean), added = names.slice(bays.length);
        return `Your bays: ${names.join(', ')}${renamed.length ? ` - ${renamed.join(', ')}` : ''}${added.length ? `${renamed.length ? ';' : ' -'} ${added.length === 1 ? 'a new bay' : added.length + ' new bays'} (${added.join(', ')}), bookable from now on` : ''}`;
      } },
    { name: 'bay_add', area: 'baysetup', kind: 'write', confirm: true,
      say: 'Add a new bay to the facility - customers can book it straight away, unless the owner says it is not ready yet',
      params: { type: 'object', properties: {
        name: { type: 'string', minLength: 1, maxLength: 40, description: 'the new bay\'s name, like "Bay 5"' },
        description: { type: 'string', maxLength: 200, description: 'its tagline on the booking page' },
        ready: { type: 'boolean', description: 'false to add it out of service until it is ready; true or left out: bookable now' } }, required: ['name'] },
      needs: ['bays', 'bayConfig'],
      build: (a, ctx) => {
        settingsRead(ctx); const bays = ctx.bays || [];
        if (bays.some(b => lc(b.name) === lc(a.name))) throw new ActionError(`a bay is already called "${a.name}"`);
        const ids = new Set(bays.map(b => String(b.id)));
        let k = bays.length + 1; while (ids.has('bay-' + k)) k++;
        const bay = { id: 'bay-' + k, name: a.name, description: a.description || 'Full swing simulator bay', features: [], priceAdjustCents: 0, active: true,
          shellyDevices: [], broadlinkDevices: [], haDevices: [], simulatorPcIp: '', pcMac: '', pcWakeMinutesBefore: 10, simulatorWinUser: 'Admin', simulatorWinPass: '' };
        if (a.ready === false) bay.maintenance = true;
        return { op: 'config', set: [[`bays.${bays.length}`, bay]], expect: [['bays.length', bays.length]] };
      },
      describe: (a) => `Add a new bay, "${a.name}"${a.description ? ` ("${a.description}")` : ''}: ${a.ready === false ? 'out of service until you put it in service - customers cannot book it yet' : 'customers can book it from now on, at your regular prices'}. It has no plugs, TV remotes, smart-home devices or PC set up yet.` },
  ];

  // ── what the actions read before they build (the engine runs each once a turn, in the order an action names them) ──
  const loaders = {
    // the settings the bays live by - only these, nothing masked kept (GET /api/admin/config, routes/admin.js:98)
    bayConfig: async (ctx) => {
      const c = await getJson(ctx, '/api/admin/config');
      if (!c) return { read: false };
      const b = c.booking || {}, ha = c.homeAssistant || {}, s = c.shutdown || {}, au = c.automation || {};
      const n = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
      return { read: true, tz: (c.server || {}).timezone || '', businessName: (c.server || {}).businessName || '',
        closeTime: b.closeTime || '', open24Hours: !!b.open24Hours, wholeFacility: !!b.wholeFacility,
        pricePerHalfHour: n(b.pricePerHalfHour), pcWakeAll: n(b.pcWakeMinutesBefore),
        // the card shows a missing one as on (admin.html populateSettings); the config's own defaults carry both
        shutdown: { enabled: s.enabled !== false, restart: s.restart !== false },
        keepOnGapMins: num(au.keepOnGapMins, 30), manualOffGraceSecs: num(au.manualOffGraceSecs, 90), warnMins: Number((c.monitor || {}).warnMins) || 10,
        // the scheduler's own test (services/scheduler.js haReady); the token arrives masked, which still says it is there
        haReady: !!(ha.enabled && ha.url && ha.token) };
    },
    // the sessions on the bays today (and yesterday's still running past midnight) and the blocks around them - times and
    // bays only, never a name (GET /api/admin/bookings?date=&status=active, routes/admin.js:151, customer bookings; GET
    // /api/admin/blocks, :269 - events, tournaments, maintenance). "active" there means not yet over: the route marks a
    // session that has ended completed before it answers, as the Bookings tab does.
    bayNow: async (ctx) => {
      const clock = clockOf(ctx.bayConfig && ctx.bayConfig.tz);
      const yesterday = addDays(clock.date, -1);
      const sessions = [];
      for (const day of [yesterday, clock.date]) {
        for (let page = 1; page <= 5; page++) {
          const j = await getJson(ctx, `/api/admin/bookings?date=${day}&status=active&per_page=200&page=${page}`);
          if (!j) return { read: false, clock };
          for (const b of arr(j.bookings)) {
            if (!b || !isDate(b.date) || !b.start_time || !b.end_time) continue;
            const endDate = isDate(b.end_date) ? b.end_date : b.date;
            sessions.push({ id: b.id, bay_id: b.bay_id, whole: Number(b.whole_facility) === 1, date: b.date, start: b.start_time, end: b.end_time, endDate, a: abs(b.date, b.start_time), b: abs(endDate, b.end_time) });
          }
          if (!(Number(j.pages) > page)) break;
        }
      }
      const bl = await getJson(ctx, `/api/admin/blocks?from=${yesterday}`);
      // a block on the whole facility is stored on the first bay under the business name (routes/admin.js POST /blocks)
      const names = new Set([((ctx.bayConfig || {}).businessName || ''), 'The whole facility'].filter(Boolean));
      const blocks = arr(bl && bl.blocks).filter(k => k && isDate(k.date) && k.start_time && k.end_time).map(k => {
        const endDate = isDate(k.end_date) ? k.end_date : k.date;
        return { id: k.id, bay_id: k.bay_id, whole: names.has(k.bay_name), type: k.booking_type, label: String(k.name || '').slice(0, 60), date: k.date, start: k.start_time, end: k.end_time, endDate, a: abs(k.date, k.start_time), b: abs(endDate, k.end_time) };
      });
      return { read: true, clock, sessions, blocks };
    },
    // every booking still to come or under way, per bay - only bay_service_set reads it, to say what taking a bay out of
    // service leaves behind (GET /api/admin/bookings?status=active, routes/admin.js:151, newest first, so every page is read)
    bayAhead: async (ctx) => {
      const out = { read: true, byBay: {}, whole: [], capped: false };
      for (let page = 1; page <= 10; page++) {
        const j = await getJson(ctx, `/api/admin/bookings?status=active&per_page=200&page=${page}`);
        if (!j) return { read: false };
        for (const b of arr(j.bookings)) {
          if (!b || !isDate(b.date) || !b.start_time || !b.end_time) continue;
          const endDate = isDate(b.end_date) ? b.end_date : b.date;
          const s = { date: b.date, start: b.start_time, a: abs(b.date, b.start_time), b: abs(endDate, b.end_time) };
          if (Number(b.whole_facility) === 1) out.whole.push(s); else (out.byBay[b.bay_id] = out.byBay[b.bay_id] || []).push(s);
        }
        if (!(Number(j.pages) > page)) break;
        if (page === 10) out.capped = true;
      }
      return out;
    },
    // the automation's failed and missed jobs, each with its code (GET /api/admin/automation/health, routes/admin.js:798)
    // the routines on each bay's PC (GET /api/admin/routines, routes/routines.js)
    bayRoutines: async (ctx) => { const j = await getJson(ctx, '/api/admin/routines'); return j && Array.isArray(j.bays) ? { read: true, bays: j.bays } : { read: false }; },
    bayJobs: async (ctx) => { const j = await getJson(ctx, '/api/admin/automation/health'); if (ctx.facility === undefined) { try { const c = await getJson(ctx, '/api/admin/config'); ctx.facility = ((c && c.homeAssistant) || {}).facilityDevices || false; } catch { ctx.facility = false; } } return j ? jobsOf(j, ctx.bays || [], ctx.facility) : { read: false }; },
  };

  return { actions, loaders };
};
