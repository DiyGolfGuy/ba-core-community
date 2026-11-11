// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-device-skips.js - A DEVICE SKIP IS DECIDED WHEN THE JOB IS DUE, NEVER BEFORE
//                        (Sep 25 2026, maintainer's Monday pack item 5, the pilot facility handoff section 2)
//
// pilot facility: a 7 AM booking made the night before lost its TV-on at 9 PM - one minute of any
// session on that TV, hours before, wrote the ON as "skipped", which is final. The same shape
// here, and one pilot facility did not name: an OFF written off because a NEXT session needed the
// device, decided hours ahead - so cancelling that next session left the bay running all night.
// Every tick is a fresh process on a fake clock; the plugs and TVs are recorded stand-ins.
//   A  an evening session on the TV does not cancel the next morning's TV-on; it fires at 06:50
//   B  a next session cancelled after the old code would have decided: the bay's plug and TV
//      are switched OFF at the first session's OFF time
//   C  CONTROL: a next session still booked keeps them on; its own OFF switches them off later
//   D  a unit updated from the old code: skips it made too early for bookings still to come are
//      put back once at boot; past ones are left alone
// The build review (Sep 25 2026, evening) found four more, each here with its fail-first:
//   E  a two-hour session and the next one thirty minutes later on a toggle TV: the TV is kept on
//      for it - the ON is NOT sent (it used to switch the TV OFF ten minutes before the customer)
//   F  a later session's ON already done when an earlier session's long "turn off after" comes
//      due: the earlier OFF is written off - nothing switched off in front of the next customer
//   G  a customer booking the bay for NEXT WEEK does not write off tonight's switch-offs
//   H  a cancelled booking's switch-offs are settled: never switched on -> nothing sent and the
//      health line stays clear; cancelled mid-session -> the plug and the TV go off now
//   L  a session cancelled mid-session on a bay whose PC sits on a plug set to switch off (Oct 3 2026, the inventory's
//      critic): the PC is shut down first and its plug waits two minutes - it was cut in the same minute, plug first,
//      killing the PC mid-shutdown
//   L4 (the review, Oct 3 2026) the PC REFUSES its shutdown: its plug is not held behind it for half an hour of retries
//   M  a session MOVED to another bay mid-session (the review, Oct 3 2026 - the first cut pressed the bay's Off button):
//      the old bay's PC first and its plug after; a toggle TV the session never switched on is sent nothing (rule 16);
//      a plug shared with a bay where another group is playing stays on; a second move keeps the first bay's switch-offs;
//      moved straight back, nothing is switched off under the group
// The cancel is the PRODUCT's (bookingedit.cancelBooking, the staff pad's): until Oct 3 2026 this battery cancelled with a
// bare status UPDATE, and the real cancel deleted the "switched on" records the settle reads - H1 and L3 against it: 29/2
//   K  a toggle TV that REFUSED its on (Oct 3 2026, the cleanup audit - the stand-ins could only say
//      yes): the refusal is recorded as not taken, and the next session thirty minutes later is NOT
//      treated as "kept on" - its on is sent
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };
const root = __dirname;
const CALLS = path.join(root, '.ds-calls.jsonl');
const STUB = path.join(root, '.ds-device-stub.js');
const DOWN = path.join(root, '.ds-down');   // the devices that refuse, one address a line (section K)
fs.writeFileSync(STUB, `
const fs = require('fs'); const Module = require('module'); const orig = Module._load;
const log = o => fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify(Object.assign({ at: new Date().toISOString() }, o)) + '\\n');
// a stand-in must be able to refuse (rule 29), in the real module's shape: Shelly { success: false, ip, action, error },
// the BroadLink bridge { error } when it cannot be reached
const down = ip => { try { return fs.readFileSync(${JSON.stringify(DOWN)}, 'utf8').split('\\n').includes(ip); } catch { return false; } };
Module._load = function (req, parent) {
  const fromServices = parent && /services/.test(parent.filename || '');
  if (fromServices && req === './shelly') { const real = orig.apply(this, arguments); return Object.assign({}, real, { controlDevice: async (ip, gen, on) => { log({ dev: 'shelly', ip, op: on ? 'on' : 'off', refused: down(ip) }); return down(ip) ? { success: false, ip, action: on ? 'on' : 'off', error: 'stand-in relay: no answer' } : { success: true }; } }); }
  if (fromServices && req === './broadlink') { const real = orig.apply(this, arguments); return Object.assign({}, real, { sendCommand: async (ip, cmd) => { log({ dev: 'tv', ip, op: cmd, refused: down(ip) }); return down(ip) ? { error: 'stand-in bridge: no answer' } : { success: true }; } }); }
  // the bay PC (section L): a recorded stand-in that answers as the real module does - true for a shutdown it sent
  if (fromServices && req === './simulator') { const real = orig.apply(this, arguments); return Object.assign({}, real, {
    sendShutdown: async (bay) => { log({ dev: 'pc', ip: bay.simulatorPcIp, op: 'shutdown', refused: down(bay.simulatorPcIp) }); return !down(bay.simulatorPcIp); },
    sendRestart: async (bay) => { log({ dev: 'pc', ip: bay.simulatorPcIp, op: 'restart' }); return true; },
    probePc: async () => true }); }
  return orig.apply(this, arguments);
};
`);
const pad = n => String(n).padStart(2, '0');
const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const d1 = new Date(); d1.setDate(d1.getDate() + 1); const DAY = ymd(d1);
const d2 = new Date(); d2.setDate(d2.getDate() + 2); const NEXT = ymd(d2);
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
const run = (js, fake) => spawnSync(process.execPath, ['-r', STUB, '-r', './tools/fake-clock.js', '-e', js], { cwd: root, env: Object.assign({}, ENV, { BA_FAKE_NOW: fake }), encoding: 'utf8', timeout: 120000 });
const tick = fake => run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`, fake);
const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const jobs = () => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec("SELECT booking_id,kind,device_key,status,COALESCE(last_error,'') FROM automation_jobs");console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(String(r.stdout).trim().split('\n').pop()).map(([b, k, d, s, e]) => ({ b, k, d, s, e })); } catch { return []; } };
const job = (b, k, d) => jobs().find(j => j.b === b && j.k === k && j.d === d) || null;
const logs = ev => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec("SELECT event,detail FROM admin_log WHERE event='${ev}' ORDER BY id");console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(String(r.stdout).trim().split('\n').pop()).map(([e, d]) => ({ e, d })); } catch { return []; } };
const between = (from, fn) => { const b = calls().length; fn(); return calls().slice(b); };
const insert = (id, bay, d, st, en, fake) => run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES (?,?,'Bay','Pat Skip','','',?,?,?,?,60,5000,'active',datetime('now'),datetime('now'))").run('${id}','${bay}','${d}','${st}','${en}','${d}');await db.flushed();db.flushSync();process.exit(0)})`, fake);
// the staff pad's cancel, the product's own (it is what deletes and keeps job rows - a bare status UPDATE hid that)
const cancel = (id, fake) => run(`const db=require('./services/db');db.initDb().then(async()=>{const r=await require('./services/bookingedit').cancelBooking('${id}',{refund_type:'none',actor:'Dana',override_policy:true});if(!r||!r.ok)console.error('CANCEL '+JSON.stringify(r));await db.flushed();db.flushSync();process.exit(0)})`, fake);
const move = (id, toBay, fake) => { const r = run(`const db=require('./services/db');db.initDb().then(async()=>{const r=await require('./services/bookingedit').moveBooking('${id}',{bay_id:'${toBay}',actor:'Dana',reason:'projector died'});console.log('MOVE '+JSON.stringify(r));await db.flushed();db.flushSync();process.exit(0)})`, fake); try { return JSON.parse((/MOVE (.*)/.exec(r.stdout || '') || [])[1]); } catch { return { error: (r.stderr || '').slice(-300) }; } };

try {
  for (const f of ['config.json', 'bookings.db', CALLS]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Skip Golf', setup: { completed: true, eulaAccepted: true },
    server: { port: 3159, businessName: 'Skip Golf', adminPassword: 'skip-owner-pw', timezone: 'America/Chicago' },
    booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true },
    sms: { sendReminder: false, sendEndingWarning: false }, resend: { sendReminder: false, sendEndingWarning: false },
    bays: [
      { id: 'ds-b1', name: 'Bay One', active: true, shellyDevices: [{ name: 'Plug One', ip: '10.88.0.1', gen: 2, turnOffAfter: true, minutesAfter: 30 }],
        broadlinkDevices: [{ name: 'TV One', ip: '10.88.0.2', onCommand: 'tv1-power', offCommand: 'tv1-power', turnOffAfter: true, minutesAfter: 30, minutesBefore: 10, codeStyle: 'toggle' }] },
      { id: 'ds-b2', name: 'Bay Two', active: true, shellyDevices: [{ name: 'Plug Two', ip: '10.88.0.3', gen: 2, turnOffAfter: true, minutesAfter: 30 }],
        broadlinkDevices: [{ name: 'TV Two', ip: '10.88.0.4', onCommand: 'tv2-on', offCommand: 'tv2-off', turnOffAfter: true, minutesAfter: 30, minutesBefore: 10, codeStyle: 'discrete' }] },
      { id: 'ds-b3', name: 'Bay Three', active: true, shellyDevices: [{ name: 'Plug Three', ip: '10.88.0.5', gen: 2, turnOffAfter: true, minutesAfter: 55 }],
        broadlinkDevices: [{ name: 'TV Three', ip: '10.88.0.6', onCommand: 'tv3-power', offCommand: 'tv3-power', turnOffAfter: true, minutesAfter: 55, minutesBefore: 10, codeStyle: 'toggle' }] },
      { id: 'ds-b4', name: 'Bay Four', active: true, shellyDevices: [{ name: 'Plug Four', ip: '10.88.0.7', gen: 2, turnOffAfter: true, minutesAfter: 90 }] },
      { id: 'ds-b5', name: 'Bay Five', active: true, broadlinkDevices: [
        { name: 'TV Five', ip: '10.88.0.8', onCommand: 'tv5-on', offCommand: 'tv5-off', turnOffAfter: true, minutesAfter: 30, minutesBefore: 10, codeStyle: 'discrete' },
        { name: 'Projector Five', ip: '10.88.0.8', onCommand: 'pj5-on', offCommand: 'pj5-off', turnOffAfter: true, minutesAfter: 30, minutesBefore: 10, codeStyle: 'discrete' }] },
      { id: 'ds-b6', name: 'Bay Six', active: true, broadlinkDevices: [{ name: 'TV Six', ip: '10.88.0.10', onCommand: 'tv6-power', offCommand: 'tv6-power', turnOffAfter: true, minutesAfter: 30, minutesBefore: 10, codeStyle: 'toggle' }] },
      { id: 'ds-b7', name: 'Bay Seven', active: true, simulatorPcIp: '10.88.0.20', shellyDevices: [{ name: 'PC Plug Seven', ip: '10.88.0.21', gen: 2, turnOffAfter: true, minutesAfter: 30 }] },
      // section M: a plug that comes on 15 minutes ahead and a toggle TV 5 minutes ahead; two bays sharing one plug
      { id: 'ds-b8', name: 'Bay Eight', active: true, shellyDevices: [{ name: 'Plug Eight', ip: '10.88.0.40', gen: 2, turnOffAfter: true, minutesAfter: 30, minutesBefore: 15 }],
        broadlinkDevices: [{ name: 'TV Eight', ip: '10.88.0.41', onCommand: 'tv8-power', offCommand: 'tv8-power', turnOffAfter: true, minutesAfter: 30, minutesBefore: 5, codeStyle: 'toggle' }] },
      { id: 'ds-b9', name: 'Bay Nine', active: true, shellyDevices: [{ name: 'Plug Nine', ip: '10.88.0.31', gen: 2, turnOffAfter: true, minutesAfter: 30 }, { name: 'Shared Lights', ip: '10.88.0.30', gen: 2, turnOffAfter: true, minutesAfter: 30 }] },
      { id: 'ds-b10', name: 'Bay Ten', active: true, shellyDevices: [{ name: 'Shared Lights', ip: '10.88.0.30', gen: 2, turnOffAfter: true, minutesAfter: 30 }] },
      { id: 'ds-b11', name: 'Bay Eleven', active: true, shellyDevices: [{ name: 'Plug Eleven', ip: '10.88.0.50', gen: 2, turnOffAfter: true, minutesAfter: 30 }] },
      { id: 'ds-b12', name: 'Bay Twelve', active: true, shellyDevices: [{ name: 'Plug Twelve', ip: '10.88.0.51', gen: 2, turnOffAfter: true, minutesAfter: 30 }] }
    ]
  }, null, 2));
  const rows = [['ds-p', 'ds-b2', DAY, '10:00', '11:00'],
                ['ds-p2', 'ds-b1', DAY, '13:00', '14:00'], ['ds-q2', 'ds-b1', DAY, '14:10', '15:10'],
                ['ds-x', 'ds-b1', DAY, '21:00', '22:00'], ['ds-y', 'ds-b1', NEXT, '07:00', '08:00'],
                ['ds-z', 'ds-b2', NEXT, '18:00', '19:00'], ['ds-old', 'ds-b2', DAY, '08:00', '09:00']];
  const seed = run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').ensureSchema();for(const [id,bay,d,s,e] of ${JSON.stringify(rows)}) db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,'active',datetime('now'),datetime('now'))").run(id,bay,'Bay','Pat Skip','','',d,s,e,d);await db.flushed();db.flushSync();process.exit(0)})`, `${DAY}T07:00:00`);
  ok('stage: two bays with a plug and a TV each (Bay One\'s TV learned a toggle code); eight bookings', seed.status === 0, (seed.stderr || '').slice(-300));

  console.log('── B. a next session cancelled after the old code would have decided ──');
  // the first session's OFF job exists (made at 09:00), THEN a next session is booked right after it
  tick(`${DAY}T09:00:00`);
  run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES ('ds-q','ds-b2','Bay','Pat Next','','','${DAY}','11:15','12:15','${DAY}',60,5000,'active',datetime('now'),datetime('now'))").run();await db.flushed();db.flushSync();process.exit(0)})`, `${DAY}T09:30:00`);
  let t = tick(`${DAY}T10:30:00`);
  ok('B1 10:30, the first session playing and the next one still booked: the first session\'s OFF is NOT written off hours ahead - it waits for its moment', t.status === 0 && job('ds-p', 'power_off', '10.88.0.3') && (job('ds-p', 'power_off', '10.88.0.3') || {}).s === 'pending' && (job('ds-p', 'ir_off', '10.88.0.4') || {}).s === 'pending', { p: jobs().filter(j => j.b === 'ds-p'), err: (t.stderr || '').slice(-300) });
  run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("UPDATE bookings SET status='cancelled' WHERE id='ds-q'").run();await db.flushed();db.flushSync();process.exit(0)})`, `${DAY}T10:45:00`);
  const before = calls().length;
  t = tick(`${DAY}T11:31:00`);
  const offs = calls().slice(before);
  ok('B2 the next session was cancelled at 10:45: at 11:30 the bay\'s plug AND TV are switched off - not left on all night', offs.some(c => c.dev === 'shelly' && c.ip === '10.88.0.3' && c.op === 'off') && offs.some(c => c.dev === 'tv' && c.ip === '10.88.0.4' && c.op === 'tv2-off'), offs);

  console.log('\n── C. CONTROL: the next session still booked ──');
  tick(`${DAY}T13:30:00`);
  const b3 = calls().length;
  tick(`${DAY}T14:31:00`);
  const at1431 = calls().slice(b3).filter(c => c.ip === '10.88.0.1' || c.ip === '10.88.0.2');
  ok('C1 14:30, the next session on Bay One playing: the first session\'s OFF is decided NOW and skipped - nothing switched off under it', !at1431.some(c => c.op === 'off' || (c.ip === '10.88.0.2' && c.op === 'tv1-power')) && (job('ds-p2', 'power_off', '10.88.0.1') || {}).s === 'skipped' && (job('ds-p2', 'ir_off', '10.88.0.2') || {}).s === 'skipped', { at1431, job: job('ds-p2', 'power_off', '10.88.0.1') });
  const b4 = calls().length;
  tick(`${DAY}T15:41:00`);
  ok('C2 ...and the next session\'s own OFF switches the plug off at 15:40', calls().slice(b4).some(c => c.dev === 'shelly' && c.ip === '10.88.0.1' && c.op === 'off'), calls().slice(b4));

  console.log('\n── A. the evening session and the next morning\'s TV-on ──');
  tick(`${DAY}T20:51:00`);
  tick(`${DAY}T21:30:00`);
  ok('A1 21:30, a session playing on Bay One\'s TV (a toggle code): the next MORNING\'s TV-on is left for its own moment - not written off 9 hours early', job('ds-y', 'ir_on', '10.88.0.2') && (job('ds-y', 'ir_on', '10.88.0.2') || {}).s === 'pending', job('ds-y', 'ir_on', '10.88.0.2'));
  const b5 = calls().length;
  tick(`${NEXT}T06:51:00`);
  ok('A2 06:50 the next morning, nothing playing: the TV-on is sent', calls().slice(b5).some(c => c.dev === 'tv' && c.ip === '10.88.0.2' && c.op === 'tv1-power'), calls().slice(b5));

  console.log('\n── D. a unit updated from the old code ──');
  run(`const db=require('./services/db');db.initDb().then(async()=>{const A=require('./services/automation');A.ensureSchema();
    const q=(b,k,d,due)=>db.db.prepare("INSERT OR REPLACE INTO automation_jobs (booking_id,kind,device_key,due_at,status,last_error,next_attempt_at) VALUES (?,?,?,?,'skipped',?,?)").run(b,k,d,due,k==='ir_on'?'a session is already running on this device and the code is a toggle - sending "on" would switch it off':'another session needs this device',due);
    q('ds-z','ir_on','10.88.0.4','${NEXT} 23:50:00'); q('ds-z','power_off','10.88.0.3','${NEXT} 23:59:00'); q('ds-old','power_off','10.88.0.3','${DAY} 09:30:00');
    await db.flushed();db.flushSync();process.exit(0)})`, `${NEXT}T07:00:00`);
  const r = run(`const db=require('./services/db');db.initDb().then(async()=>{const n=require('./services/scheduler').reopenEarlySkips();await db.flushed();db.flushSync();console.log('REOPENED '+n);process.exit(0)})`, `${NEXT}T07:05:00`);
  ok('D1 the boot repair puts back the too-early skips of a booking still to come - and leaves a past one alone', /REOPENED 2/.test(r.stdout || '') && (job('ds-z', 'ir_on', '10.88.0.4') || {}).s === 'pending' && (job('ds-z', 'power_off', '10.88.0.3') || {}).s === 'pending' && (job('ds-old', 'power_off', '10.88.0.3') || {}).s === 'skipped', { out: (r.stdout || '').slice(-120), err: (r.stderr || '').slice(-200), z: jobs().filter(j => j.b === 'ds-z'), old: job('ds-old', 'power_off', '10.88.0.3') });
  const r2 = run(`const db=require('./services/db');db.initDb().then(async()=>{console.log('REOPENED '+require('./services/scheduler').reopenEarlySkips());process.exit(0)})`, `${NEXT}T07:06:00`);
  ok('D2 ...once: a second boot has nothing to put back', /REOPENED 0/.test(r2.stdout || ''), (r2.stdout || '').slice(-80));

  console.log('\n── E. a two-hour session, the next one thirty minutes later, one toggle TV ──');
  const d5 = new Date(); d5.setDate(d5.getDate() + 5); const WEEK = ymd(d5);
  const setup = [['ds-e1', 'ds-b1', NEXT, '09:00', '11:00'], ['ds-e2', 'ds-b1', NEXT, '11:30', '12:30'],
                 ['ds-f1', 'ds-b3', NEXT, '10:00', '10:30'], ['ds-f2', 'ds-b3', NEXT, '11:30', '12:30'],
                 ['ds-g1', 'ds-b2', NEXT, '14:00', '15:00'], ['ds-h1', 'ds-b2', NEXT, '17:00', '17:30'], ['ds-h2', 'ds-b3', NEXT, '15:00', '16:00']];
  for (const [id, bay, d, st, en] of setup) insert(id, bay, d, st, en, `${NEXT}T07:30:00`);
  tick(`${NEXT}T08:51:00`);
  tick(`${NEXT}T09:51:00`);
  const at1121 = between(0, () => tick(`${NEXT}T11:21:00`));
  ok('E1 11:20, the next session\'s TV-on is due: the TV was kept on from the 9:00-11:00 session - NOTHING is sent to it (a toggle would switch it off before the customer arrives)', !at1121.some(c => c.ip === '10.88.0.2') && (job('ds-e2', 'ir_on', '10.88.0.2') || {}).s === 'skipped' && /kept on from the previous session/.test((job('ds-e2', 'ir_on', '10.88.0.2') || {}).e || ''), { at1121: at1121.filter(c => c.ip === '10.88.0.2'), job: job('ds-e2', 'ir_on', '10.88.0.2') });

  console.log('\n── F. a later session already switched on when an earlier OFF comes due ──');
  const at1126 = between(0, () => tick(`${NEXT}T11:26:00`));
  ok('F1 11:25, the 10:00-10:30 session\'s OFF (turn off after 55 minutes) comes due while the 11:30 session is already switched on: its plug and TV are NOT switched off', !at1126.some(c => c.ip === '10.88.0.5' || c.ip === '10.88.0.6') && (job('ds-f1', 'power_off', '10.88.0.5') || {}).s === 'skipped' && (job('ds-f1', 'ir_off', '10.88.0.6') || {}).s === 'skipped', { at1126, jobs: jobs().filter(j => j.b === 'ds-f1') });
  const at1131 = between(0, () => tick(`${NEXT}T11:31:00`));
  ok('E2 11:30, the first session\'s own TV-off: kept for the next session, nothing sent', !at1131.some(c => c.ip === '10.88.0.2'), at1131);
  tick(`${NEXT}T12:00:00`); tick(`${NEXT}T12:10:00`);
  const at1301 = between(0, () => tick(`${NEXT}T13:01:00`));
  ok('E3 13:00, the next session\'s own OFF: the TV gets exactly one "off" - it was on all along', at1301.filter(c => c.ip === '10.88.0.2' && c.op === 'tv1-power').length === 1, at1301);
  ok('E4 ...and the owner\'s log has the skip ONCE, not a line every minute after the unit\'s own "on"', logs('BROADLINK_ON_SKIPPED').filter(l => /ds-e2/.test(l.d)).length === 1 && logs('BROADLINK_ON_SKIPPED').filter(l => /ds-e1/.test(l.d)).length === 0 && logs('BROADLINK_OFF_SKIPPED').filter(l => /ds-e2|ds-y/.test(l.d)).length === 0, { on: logs('BROADLINK_ON_SKIPPED').slice(-5), off: logs('BROADLINK_OFF_SKIPPED').slice(-5) });
  const at1326 = between(0, () => tick(`${NEXT}T13:26:00`));
  ok('F2 ...and the later session\'s own OFF switches the plug and the TV off at 13:25', at1326.some(c => c.ip === '10.88.0.5' && c.op === 'off') && at1326.some(c => c.ip === '10.88.0.6' && c.op === 'tv3-power'), at1326);

  console.log('\n── G. a booking for another day does not write off tonight\'s switch-offs ──');
  tick(`${NEXT}T13:51:00`);
  insert('ds-g2', 'ds-b2', WEEK, '14:00', '15:00', `${NEXT}T14:05:00`);
  const cb = run(`const db=require('./services/db');db.initDb().then(async()=>{const r=require('./services/automation').cancelBayShutdownJobs('ds-b2','ds-g2');console.log('CB '+JSON.stringify(r));await db.flushed();db.flushSync();process.exit(0)})`, `${NEXT}T14:06:00`);
  ok('G1 a customer books Bay Two for next week (the booking page\'s activation): nothing on Bay Two is written off', /CB \{"changes":0\}/.test(cb.stdout || '') && (job('ds-g1', 'power_off', '10.88.0.3') || {}).s === 'pending' && (job('ds-g1', 'ir_off', '10.88.0.4') || {}).s === 'pending', { out: (cb.stdout || '').slice(-80), g1: jobs().filter(j => j.b === 'ds-g1') });
  tick(`${NEXT}T14:51:00`);
  const at1531 = between(0, () => tick(`${NEXT}T15:31:00`));
  ok('G2 ...and at 15:30 Bay Two\'s plug and TV are switched off as they should be', at1531.some(c => c.ip === '10.88.0.3' && c.op === 'off') && at1531.some(c => c.ip === '10.88.0.4' && c.op === 'tv2-off'), at1531);

  console.log('\n── H. a cancelled booking\'s switch-offs ──');
  // ds-h2 on Bay Three was switched on at 14:50; it is cancelled at 15:20, mid-session
  cancel('ds-h2', `${NEXT}T15:20:00`);
  const at1521 = between(0, () => tick(`${NEXT}T15:21:00`));
  ok('H1 a session cancelled while it was playing: its plug and TV are switched off NOW', at1521.some(c => c.ip === '10.88.0.5' && c.op === 'off') && at1521.filter(c => c.ip === '10.88.0.6' && c.op === 'tv3-power').length === 1, at1521);
  const at1522 = between(0, () => tick(`${NEXT}T15:22:00`));
  ok('H2 ...once: the next tick sends nothing more', !at1522.some(c => c.ip === '10.88.0.5' || c.ip === '10.88.0.6'), at1522);
  // ds-h1 (17:00-17:30) never started: cancelled at 16:10, its OFF jobs already exist
  cancel('ds-h1', `${NEXT}T16:10:00`);
  const at1611 = between(0, () => tick(`${NEXT}T16:11:00`));
  ok('H3 a session cancelled before anything was switched on: nothing is sent (a toggle TV sent "off" would come ON) and its switch-offs are settled', !at1611.some(c => c.ip === '10.88.0.3' || c.ip === '10.88.0.4') && (job('ds-h1', 'power_off', '10.88.0.3') || {}).s === 'skipped' && (job('ds-h1', 'ir_off', '10.88.0.4') || {}).s === 'skipped', { at1611, h1: jobs().filter(j => j.b === 'ds-h1') });
  tick(`${NEXT}T18:05:00`);
  const odr = run(`const db=require('./services/db');db.initDb().then(()=>{console.log('O '+db.db.prepare("SELECT COUNT(*) AS n FROM automation_jobs WHERE booking_id='ds-h1' AND status='pending' AND due_at <= datetime('now','-5 minutes')").get().n);process.exit(0)})`, `${NEXT}T18:10:00`);
  const od = (/O (\d+)/.exec(odr.stdout || '') || [])[1];
  ok('H4 ...and after the cancelled session\'s end nothing of it is overdue on the Automation line (it read red, "restart the unit", for ever)', od === '0', { overdue: od, h1: jobs().filter(j => j.b === 'ds-h1') });

  console.log('\n── I. "turn off after" longer than an hour ──');
  insert('ds-i1', 'ds-b4', NEXT, '19:00', '19:30', `${NEXT}T18:20:00`);
  tick(`${NEXT}T18:51:00`); tick(`${NEXT}T19:31:00`);
  const at2101 = between(0, () => tick(`${NEXT}T21:01:00`));
  console.log('\n── J. a TV and a projector on ONE BroadLink ──');
  insert('ds-j1', 'ds-b5', NEXT, '22:00', '22:30', `${NEXT}T21:00:00`);
  const at2151 = between(0, () => tick(`${NEXT}T21:51:00`));
  ok('J1 both are switched ON - each device on the bridge has its own job (it was one job per bridge, so only the first was ever sent)', at2151.some(c => c.op === 'tv5-on') && at2151.some(c => c.op === 'pj5-on'), at2151);
  const at2301 = between(0, () => tick(`${NEXT}T23:01:00`));
  ok('J2 ...and both are switched OFF after the session', at2301.some(c => c.op === 'tv5-off') && at2301.some(c => c.op === 'pj5-off'), at2301);
  ok('I1 a plug set to turn off 90 minutes after the session (the card allows 120) IS switched off at 21:00 - past the old one-hour walk it never was', at2101.some(c => c.ip === '10.88.0.7' && c.op === 'off') && (job('ds-i1', 'power_off', '10.88.0.7') || {}).s === 'done', { at2101, job: job('ds-i1', 'power_off', '10.88.0.7') });

  console.log('\n── K. a toggle TV that refused its on ──');
  insert('ds-k1', 'ds-b6', WEEK, '18:00', '19:00', `${WEEK}T17:00:00`);
  insert('ds-k2', 'ds-b6', WEEK, '19:30', '20:30', `${WEEK}T17:00:00`);
  fs.writeFileSync(DOWN, '10.88.0.10\n');   // TV Six's bridge cannot be reached
  const at1751 = between(0, () => tick(`${WEEK}T17:51:00`));
  tick(`${WEEK}T18:05:00`);
  const led = run(`const db=require('./services/db');db.initDb().then(()=>{console.log('L '+JSON.stringify(db.db.prepare("SELECT op, ok, detail FROM device_commands WHERE device LIKE 'ir:10.88.0.10:%' ORDER BY id").all()));process.exit(0)})`, `${WEEK}T18:06:00`);
  const ledK = (() => { try { return JSON.parse((/L (.*)/.exec(led.stdout || '') || [])[1]); } catch { return null; } })() || [];
  const k1on = job('ds-k1', 'ir_on', '10.88.0.10') || {};
  // past the start a toggle is never sent late - but a refused "on" written off as "skipped" (not applicable) left the
  // customer with the TV off and the owner's line green (Oct 3 2026): it is MISSED, the bridge's words kept, on the line
  const hk = run(`const db=require('./services/db');db.initDb().then(()=>{console.log('H '+JSON.stringify((require('./services/unithealth').compute().signals||[]).find(s=>s.key==='automation')||{}));process.exit(0)})`, `${WEEK}T18:06:00`);
  const hK = (() => { try { return JSON.parse((/H (.*)/.exec(hk.stdout || '') || [])[1]); } catch { return {}; } })();
  ok('K1 17:50, TV Six refuses its on: the command ledger records it as NOT taken, with the bridge\'s words', at1751.some(c => c.ip === '10.88.0.10' && c.refused) && ledK.length > 0 && ledK.every(r => r.ok === 0 && r.op === 'on' && /no answer/.test(r.detail)), { at1751, ledK });
  ok('K1b ...and once the session is under way and a late toggle is no longer sent, the job is MISSED - never "skipped" - keeping the bridge\'s words, and the Automation line says so', k1on.s === 'missed' && /no answer/.test(k1on.e) && hK.level && hK.level !== 'green' && /failed or missed/.test(hK.detail || ''), { k1on, health: hK });
  // the owner presses Retry on the Automation card (Oct 3 2026, the pack review): Retry put attempts back to 0, so the
  // next tick wrote it off as "skipped" - the line went green with nothing sent and the bridge's words gone
  run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').retryNow('ds-k1','ir_on','10.88.0.10');await db.flushed();db.flushSync();process.exit(0)})`, `${WEEK}T18:07:00`);
  const at1808 = between(0, () => tick(`${WEEK}T18:08:00`));
  const k1re = job('ds-k1', 'ir_on', '10.88.0.10') || {};
  ok('K1c the owner presses Retry on it: still past the point a toggle is sent, so nothing is sent - and it stays MISSED with the bridge\'s words, never turned green as "skipped"', !at1808.some(c => c.ip === '10.88.0.10') && k1re.s === 'missed' && /no answer/.test(k1re.e), { at1808, k1re });
  fs.writeFileSync(DOWN, '');
  const at1921 = between(0, () => tick(`${WEEK}T19:21:00`));
  const k2on = job('ds-k2', 'ir_on', '10.88.0.10') || {};
  ok('K2 19:20, the next session thirty minutes after: its on IS sent - the refused on was never the TV being on, so nothing was "kept on"', at1921.filter(c => c.ip === '10.88.0.10' && c.op === 'tv6-power' && !c.refused).length === 1 && k2on.s === 'done', { at1921, k2on });

  console.log('\n── L. a cancelled session on a bay whose PC sits on a switched plug ──');
  insert('ds-l1', 'ds-b7', WEEK, '21:00', '22:00', `${WEEK}T20:00:00`);
  tick(`${WEEK}T20:51:00`);   // the plug comes on for it
  cancel('ds-l1', `${WEEK}T21:20:00`);
  const at2121 = between(0, () => tick(`${WEEK}T21:21:00`));
  ok('L1 cancelled mid-session: the PC is shut down, and its plug is NOT cut in the same minute (plug first killed the PC mid-shutdown)', at2121.some(c => c.dev === 'pc' && c.ip === '10.88.0.20' && c.op === 'shutdown') && !at2121.some(c => c.ip === '10.88.0.21' && c.op === 'off'), at2121);
  const at2122 = between(0, () => tick(`${WEEK}T21:22:00`));
  ok('L2 ...a minute later the plug still waits for the PC', !at2122.some(c => c.ip === '10.88.0.21' && c.op === 'off'), at2122);
  const at2124 = between(0, () => tick(`${WEEK}T21:24:00`));
  ok('L3 ...and once the PC has had two minutes to shut down, the plug goes off - once', at2124.filter(c => c.ip === '10.88.0.21' && c.op === 'off').length === 1, at2124);
  // L4: the PC refuses (wrong Windows password, say) - the shutdown backs off for half an hour; its plug is not held with it
  insert('ds-l2', 'ds-b7', WEEK, '22:00', '23:00', `${WEEK}T21:30:00`);
  tick(`${WEEK}T21:51:00`);
  fs.writeFileSync(DOWN, '10.88.0.20\n');
  cancel('ds-l2', `${WEEK}T22:20:00`);
  const at2221 = between(0, () => tick(`${WEEK}T22:21:00`));
  const at2222 = between(0, () => tick(`${WEEK}T22:22:00`));
  fs.writeFileSync(DOWN, '');
  ok('L4 the PC REFUSES its shutdown: the refusal is kept as a failure to retry, and its plug is not held behind it - once the shutdown was refused nothing is on its way down, so it goes off then (once), not half an hour of backoff later',
     at2221.some(c => c.ip === '10.88.0.20' && c.refused) && at2221.concat(at2222).filter(c => c.ip === '10.88.0.21' && c.op === 'off').length === 1 && /did not answer|refused/.test((job('ds-l2', 'shutdown', '') || {}).e || ''), { at2221, at2222, sd: job('ds-l2', 'shutdown', '') });

  console.log('\n── M. a session moved to another bay mid-session ──');
  const d6 = new Date(); d6.setDate(d6.getDate() + 6); const MDAY = ymd(d6);
  insert('ds-m1', 'ds-b7', MDAY, '12:00', '13:00', `${MDAY}T08:00:00`);    // PC + its plug
  insert('ds-m2', 'ds-b8', MDAY, '14:00', '15:00', `${MDAY}T08:00:00`);    // plug 15 min ahead, toggle TV 5 min ahead
  insert('ds-m3', 'ds-b9', MDAY, '16:00', '17:00', `${MDAY}T08:00:00`);    // its own plug + the shared lights
  insert('ds-m4', 'ds-b10', MDAY, '16:00', '17:00', `${MDAY}T08:00:00`);   // another group on the bay sharing the lights
  tick(`${MDAY}T11:51:00`);
  const mv1 = move('ds-m1', 'ds-b11', `${MDAY}T12:20:00`);
  const atM1 = between(0, () => tick(`${MDAY}T12:21:00`));
  const mv1b = move('ds-m1', 'ds-b12', `${MDAY}T12:21:30`);                 // moved again inside the PC's two minutes
  const atM2 = between(0, () => tick(`${MDAY}T12:22:00`));
  const atM4 = between(0, () => tick(`${MDAY}T12:24:00`));
  const movedLog = logs('SHELLY_OFF').filter(e => /10\.88|PC Plug Seven/.test(e.d) && /moved to another bay/.test(e.d));
  ok('M1 moved off a bay with a PC mid-session: the old bay\'s PC is shut down at the next tick and its plug is NOT cut in the same minute; the bay it moved to comes on',
     mv1 && mv1.ok !== false && !mv1.error && atM1.some(c => c.dev === 'pc' && c.ip === '10.88.0.20' && c.op === 'shutdown') && !atM1.some(c => c.ip === '10.88.0.21' && c.op === 'off') && atM1.some(c => c.ip === '10.88.0.50' && c.op === 'on'), { mv1, atM1 });
  ok('M2 ...moved AGAIN inside those two minutes: the first bay\'s switch-offs are kept - its plug goes off once the PC has had two minutes, once, and the owner\'s log says why',
     mv1b && !mv1b.error && !atM2.some(c => c.ip === '10.88.0.21' && c.op === 'off') && atM4.filter(c => c.ip === '10.88.0.21' && c.op === 'off').length === 1 && movedLog.some(e => /PC Plug Seven/.test(e.d)), { mv1b, atM2, atM4, movedLog });
  tick(`${MDAY}T13:46:00`);   // 13:46: Bay Eight's plug is on (15 ahead), its toggle TV not yet (5 ahead)
  const mv2 = move('ds-m2', 'ds-b4', `${MDAY}T13:47:00`);
  const atM5 = between(0, () => tick(`${MDAY}T13:48:00`));
  ok('M3 moved before its toggle TV came on: the plug it switched on goes off, and the TV is sent NOTHING - a toggle "off" to a TV that is off turns it ON in an empty bay (rule 16)',
     mv2 && !mv2.error && atM5.some(c => c.ip === '10.88.0.40' && c.op === 'off') && !atM5.some(c => c.ip === '10.88.0.41'), { mv2, atM5 });
  tick(`${MDAY}T15:51:00`);   // both groups' plugs and the shared lights on
  const mv3 = move('ds-m3', 'ds-b4', `${MDAY}T16:20:00`);
  const atM6 = between(0, () => tick(`${MDAY}T16:21:00`));
  ok('M4 moved off a bay whose lights are shared with a bay where another group is playing: the bay\'s own plug goes off, the shared lights stay ON for that group',
     mv3 && !mv3.error && atM6.some(c => c.ip === '10.88.0.31' && c.op === 'off') && !atM6.some(c => c.ip === '10.88.0.30' && c.op === 'off'), { mv3, atM6 });
  insert('ds-m5', 'ds-b11', MDAY, '18:00', '19:00', `${MDAY}T08:00:00`);
  tick(`${MDAY}T17:51:00`);
  const mv5 = move('ds-m5', 'ds-b12', `${MDAY}T18:20:00`), mv5b = move('ds-m5', 'ds-b11', `${MDAY}T18:20:30`);   // staff change their mind
  const atM7 = between(0, () => tick(`${MDAY}T18:21:00`));
  // M6 (the critic): staff move a group and at once give them more time on the pad - the extension used to delete the old
  // bay's queued switch-offs; and the old bay's plug refuses, so the Automation line must name THAT bay and that plug
  insert('ds-m6', 'ds-b12', MDAY, '20:00', '21:00', `${MDAY}T08:00:00`);
  tick(`${MDAY}T19:51:00`);
  const mv6 = move('ds-m6', 'ds-b4', `${MDAY}T20:20:00`);
  const ext6 = run(`const db=require('./services/db');db.initDb().then(async()=>{const r=require('./services/checkin').extendBooking({booking_id:'ds-m6',minutes:30,employee:'Dana'});console.log('EXT '+JSON.stringify(r&&r.error?r:{ok:true}));await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`, `${MDAY}T20:20:30`);
  fs.writeFileSync(DOWN, '10.88.0.51\n');
  const atM8 = between(0, () => tick(`${MDAY}T20:21:00`));
  const h6 = run(`const db=require('./services/db');db.initDb().then(()=>{const h=require('./services/automation').health({hours:48});console.log('H6 '+JSON.stringify((h.failed||[]).concat(h.retrying||[]).filter(x=>x.booking_id==='ds-m6')));process.exit(0)})`, `${MDAY}T20:22:00`);
  fs.writeFileSync(DOWN, '');
  const h6r = (() => { try { return JSON.parse((/H6 (.*)/.exec(h6.stdout || '') || [])[1]); } catch { return []; } })();
  ok('M6 moved and then given more time at once: the old bay\'s switch-off still goes out (the extension deleted it); when that plug refuses, the Automation line names the plug and the bay it is on - not the bay the group moved to, not a raw key',
     mv6 && !mv6.error && /EXT \{"ok":true\}/.test(ext6.stdout || '') && atM8.some(c => c.ip === '10.88.0.51' && c.op === 'off' && c.refused)
     && h6r.some(x => x.device === '10.88.0.51' && /^Bay Twelve \(the session moved from it\)$/.test(x.bay || '')), { mv6, ext: (ext6.stdout || '') + (ext6.stderr || '').slice(-200), atM8, h6r });
  ok('M5 moved and moved straight BACK before the next tick: the bay is the group\'s again - its plug is NOT switched off under them',
     mv5 && !mv5.error && mv5b && !mv5b.error && !atM7.some(c => c.ip === '10.88.0.50' && c.op === 'off'), { mv5b, atM7 });
} finally {
  for (const f of ['config.json', 'bookings.db', CALLS, STUB, DOWN]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
}
console.log(`\nDEVICE SKIPS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
