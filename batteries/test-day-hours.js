// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-day-hours.js - A DAY'S OWN OPENING HOURS (Oct 22 2026)
//
// maintainer on his try box: "were open noon to 10pm weekdays and 9am to midnight on weekends" - the box kept ONE set of hours for every
// open day, so the 4B put up the weekdays alone and the weekends closed. A day may now have its own hours (booking.dayHours,
// services/hours.js), and everything that reads the hours for a date reads that day's:
//   H1  services/hours.js itself: the one set, a day's own, open around the clock over both, a malformed day ignored, the close
//   H2  the booking page's rules carry the days with their own hours
//   H3  the booking route: a weekday at 10 AM refused (opens at noon), Saturday at 10 AM never refused for the hours; a weekday
//       session past 10 PM refused, Saturday's until midnight not; past Saturday's midnight refused
//   H4  the durations offered at a start time stop at that day's close (a weekday 9 PM start: 1 hour; Saturday 9 PM: 3 hours)
//   H5  the staff pad's booking: the same hours on the counter's own route
//   H6  more time after a session ends at 10 PM: none on a weekday (closed), offered on a Saturday (open until midnight)
//   H7  the Hours card's save: a day cleared with null goes back to the one set, on the booking page as well
//   H8  the occupancy figure counts each day's own open hours (the server stopped first - one writer)
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 700) : '')); } };
const root = __dirname;
const SRV = 3157, B = 'http://127.0.0.1:' + SRV, PW = 'day-hours-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent', BA_DISABLE_SCHEDULER: '1', BA_UPDATE_LIST_URL: 'off' });
// the next Saturday and the next Wednesday, as calendar days (a day ahead is new Date(y, m, d + n, 12) - never n x 24 hours)
const t0 = new Date();
const dayAhead = (dow) => { const n = ((dow - t0.getDay() + 7) % 7) || 7; const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + n, 12); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const SAT = dayAhead(6), WED = dayAhead(3);
const call = async (method, p, body, headers) => { try { const r = await fetch(B + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d: d || {} }; } catch (e) { return { s: 0, d: { err: e.message } }; } };
const owner = { 'x-admin-password': PW };
let server = null, out = '';
async function boot() {
  out = '';
  server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: ENV });
  server.stdout.on('data', d => out += d); server.stderr.on('data', d => out += d);
  for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(B + '/api/time')).ok) return true; } catch {} }
  return false;
}
async function halt() { if (!server) return; const p = server; server = null; p.kill('SIGTERM'); for (let i = 0; i < 50 && p.exitCode === null; i++) await sleep(100); }
const BOOKING = { openTime: '12:00', closeTime: '22:00', closeNextDay: false, open24Hours: false, openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  dayHours: { sat: { open: '09:00', close: '00:00' } }, windowDays: 30, minSessionMins: 30, maxSessionMins: 240, staffedAccess: true, accessStyle: 'staffed', pricePerHalfHour: 20 };

(async () => {
  try {
    // ── H1. the hours on a day ──
    const H = require(path.join(root, 'services', 'hours.js'));
    const sat = H.on(BOOKING, SAT), wed = H.on(BOOKING, WED), open24 = H.on(Object.assign({}, BOOKING, { open24Hours: true }), SAT);
    const bad = H.on(Object.assign({}, BOOKING, { dayHours: { sat: { open: '9am', close: '00:00' }, wed: { open: '10:00', close: '10:00' } } }), SAT);
    const late = H.on(Object.assign({}, BOOKING, { dayHours: { sat: { open: '18:00', close: '02:00' } } }), SAT);
    ok(`H1 a day's own hours stand over the one set (Saturday ${SAT} 9 AM - midnight, Wednesday ${WED} noon - 10 PM); open around the clock stands over both; a malformed day is the one set; a close after midnight is the next morning`,
       sat.openTime === '09:00' && sat.closeTime === '00:00' && sat.closeNextDay === true && H.closeMins(sat) === 1440 && wed.openTime === '12:00' && wed.closeTime === '22:00' && H.closeMins(wed) === 1320
       && open24.open24Hours === true && H.closeMins(open24) === Infinity && bad.openTime === '12:00' && late.closeNextDay === true && H.closeMins(late) === 1560
       && JSON.stringify(H.dayHours(Object.assign({}, BOOKING, { dayHours: { sat: { open: '09:00', close: '00:00' }, sun: null, mon: { open: 'x', close: 'y' } } }))) === '{"sat":{"open":"09:00","close":"00:00"}}',
       { sat, wed, open24, bad, late });

    try { if ((await fetch(B + '/api/time')).ok) { console.log('FAIL  port ' + SRV + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Day Hours Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: SRV, businessName: 'Day Hours Golf', adminPassword: PW, timezone: 'America/Chicago' },
      booking: BOOKING, bays: [{ id: 'dh-1', name: 'Bay 1', active: true }, { id: 'dh-2', name: 'Bay 2', active: true }], waiver: { mode: 'off' },
      staff: { codes: [{ code: '4321', name: 'Dee Desk' }] }
    }, null, 2));
    ok('the unit boots', await boot(), out.slice(-300));

    // ── H2. the booking page's rules ──
    const rules = await call('GET', '/api/booking-rules');
    ok('H2 the booking page is told the days with hours of their own (Saturday) beside the one set',
       rules.s === 200 && rules.d.openTime === '12:00' && rules.d.closeTime === '22:00' && JSON.stringify(rules.d.dayHours) === '{"sat":{"open":"09:00","close":"00:00"}}', rules.d);

    // ── H3. the booking route ──
    const body = (date, time, mins, bay) => ({ bay_id: bay || 'dh-1', date, start_time: time, duration_minutes: mins || 60, name: 'Hal Hours', phone: '5550142', email: 'hal@dayhours.example', sms_consent: false });
    const hoursErr = (r) => /no earlier than|closing time/i.test(String(r.d.error || ''));
    const wed10 = await call('POST', '/api/bookings/create-payment-intent', body(WED, '10:00'));
    const sat10 = await call('POST', '/api/bookings/create-payment-intent', body(SAT, '10:00'));
    const wed2130 = await call('POST', '/api/bookings/create-payment-intent', body(WED, '21:30'));
    const sat2230 = await call('POST', '/api/bookings/create-payment-intent', body(SAT, '22:30', 60, 'dh-2'));
    const sat2330 = await call('POST', '/api/bookings/create-payment-intent', body(SAT, '23:30', 60));
    ok('H3 the booking route reads each day\'s own hours: Wednesday 10 AM refused (opens at noon), Saturday 10 AM not refused for the hours; Wednesday 9:30 PM for an hour refused (closes at 10), Saturday 10:30 PM for an hour not; Saturday 11:30 PM for an hour refused (closes at midnight)',
       wed10.s === 400 && /no earlier than 12:00/.test(wed10.d.error || '') && !hoursErr(sat10)
       && wed2130.s === 400 && /closing time \(22:00\)/.test(wed2130.d.error || '') && !hoursErr(sat2230)
       && sat2330.s === 400 && /closing time \(00:00\)/.test(sat2330.d.error || ''),
       { wed10: wed10.d.error, sat10: [sat10.s, sat10.d.error], wed2130: wed2130.d.error, sat2230: [sat2230.s, sat2230.d.error], sat2330: sat2330.d.error });

    // ── H4. the durations offered ──
    const durW = await call('GET', `/api/bookings/availability-by-time?date=${WED}&start_time=21:00&duration=120`);
    const durS = await call('GET', `/api/bookings/availability-by-time?date=${SAT}&start_time=21:00&duration=120`);
    const lens = (r) => (r.d.available_durations || []).map(d => typeof d === 'object' ? (d.minutes || d.m || d.duration) : d);
    ok('H4 two hours from 9 PM: no bay on Wednesday (it closes at 10 - an hour is offered instead), Bay 1 on Saturday (open until midnight; Bay 2 holds the 10:30 PM booking from H3)',
       durW.s === 200 && durS.s === 200 && !(durW.d.available_bays || []).length && lens(durW).includes(60) && !lens(durW).some(m => m > 60) && (durS.d.available_bays || []).map(b => b.id).join() === 'dh-1', { wed: durW.d, sat: durS.d });

    // ── H5. the staff pad's booking ──
    const sw10 = await call('POST', '/api/staff/bookings', { bay_id: 'dh-1', date: WED, start_time: '10:00', duration_minutes: 60, name: 'Walk In', phone: '5550143' }, owner);
    const ss10 = await call('POST', '/api/staff/bookings', { bay_id: 'dh-2', date: SAT, start_time: '10:00', duration_minutes: 60, name: 'Walk In', phone: '5550144' }, owner);
    ok('H5 the counter\'s booking reads the same hours: Wednesday 10 AM refused (before opening), Saturday 10 AM booked',
       sw10.s === 400 && /before opening/i.test(sw10.d.error || '') && ss10.s === 200 && !ss10.d.error, { wed: [sw10.s, sw10.d], sat: [ss10.s, ss10.d] });

    // ── H6. more time after a session that ends at 10 PM ──
    const more = spawnSync(process.execPath, ['-e', `const bc=require('./services/bookingcore');const c={booking:${JSON.stringify(BOOKING)}};console.log(JSON.stringify([bc.moreTimeFits(c,'22:00',null,'${WED}'),bc.moreTimeFits(c,'22:00',null,'${SAT}'),bc.moreTimeFits(c,'23:45',null,'${SAT}')]));process.exit(0)`], { cwd: root, encoding: 'utf8', timeout: 30000 });
    ok('H6 more time after a session ending at 10 PM: none on a Wednesday (closed), offered on a Saturday (open until midnight) - and none at 11:45 PM on a Saturday',
       (more.stdout || '').trim() === '[false,true,false]', [more.stdout, (more.stderr || '').slice(-300)]);

    // ── H7. the Hours card's save ──
    const g = await call('GET', '/api/admin/config', null, owner);
    const cfg7 = g.d; cfg7.booking.dayHours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: { open: '10:00', close: '18:00' } };
    const s7 = await call('POST', '/api/admin/config', cfg7, owner);
    const r7 = await call('GET', '/api/booking-rules');
    ok('H7 the Hours card\'s save clears a day with null (a save merges) and sets another: the booking page reads Sunday alone',
       s7.s === 200 && JSON.stringify(r7.d.dayHours) === '{"sun":{"open":"10:00","close":"18:00"}}', { s7: s7.d, page: r7.d.dayHours });

    // ── H8. the occupancy figure (the server stopped: one writer) ──
    await halt();
    const occ = spawnSync(process.execPath, ['-e', `const db=require('./services/db');db.initDb().then(()=>{const rv=require('./services/revenue');const c=require('./services/config');const cfg=c.getConfig();cfg.booking.dayHours={sat:{open:'09:00',close:'00:00'}};c.saveConfig(cfg);
      const a=rv.activity('${WED}','${WED}'),b=rv.activity('${SAT}','${SAT}');console.log(JSON.stringify([a.capacity_hours,b.capacity_hours]));process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`], { cwd: root, env: ENV, encoding: 'utf8', timeout: 60000 });
    ok('H8 the occupancy figure counts each day\'s own open hours: two bays, Wednesday 10 hours each (20), Saturday 15 each (30)',
       (occ.stdout || '').trim().split('\n').pop() === '[20,30]', [occ.stdout, (occ.stderr || '').slice(-300)]);
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    await halt();
    console.log(`\nDAY HOURS: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
