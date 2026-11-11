// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-clock-change.js - THE NIGHTS THE CLOCKS CHANGE (Sep 24 2026)
//
// Found by the aged year in the first deep sweep: two year-old units read RED on the
// health line - "1 job(s) overdue - queued but never claimed" - for an ending warning
// on March 8, the night the clocks sprang forward. bookingEndDate took local midnight
// and added the end time as minutes, and that day is 23 hours long, so every end after
// the change came out an hour late: the warning, the PC shutdown, the plugs and TV off
// and the door window all an hour after the session. On November 1 (25 hours) every
// end came out an hour EARLY - every bay shut down an hour before its session ended.
// And the warning, due after its booking had completed, was never claimed again: it
// read overdue for the rest of the year.
//   A  the end of a booking, on both change days, an ordinary day and a 24-hour club's
//      "25:30", against an independent reckoning of Chicago's wall clock
//   B  the scheduler's own tick, in a fresh process on a moved clock, writes the jobs at
//      the real instants on both change days
//   C  rule 22: the aged year's exact row on disk - a completed booking's warning past
//      its deadline - a fresh tick records it missed with the reason, the owner's log
//      names it, nothing reads overdue, and a second restart changes nothing
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const TZ = 'America/Chicago';
const CLOCK = path.join(root, 'tools', 'fake-clock.js');
const run = (js, fakeNow) => spawnSync(process.execPath, (fakeNow ? ['-r', CLOCK] : []).concat(['-e', js]), { cwd: root, encoding: 'utf8', timeout: 120000,
  env: Object.assign({}, process.env, { TZ, BA_FAKE_NOW: fakeNow || '', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
const out = r => { try { return JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { return { error: (r.stderr || r.stdout || '').slice(-400) }; } };

// AN INDEPENDENT RECKONING: the UTC instant whose Chicago wall clock reads day + hh:mm
// (hh may pass 24). It searches the offsets and asks Intl what Chicago's clock says -
// it shares no code with the product.
function chicago(day, hm) {
  const [y, mo, d] = day.split('-').map(Number); const [h, mi] = hm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);                 // the wall time as if it were UTC (h >= 24 rolls the day)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const want = new Date(wall).toISOString().slice(0, 16);
  for (const off of [5, 6, 4, 7]) {
    const t = wall + off * 3600000;
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === want) return new Date(t).toISOString();
  }
  return null;
}

// the facility, staged on disk by processes that exit (ONE WRITER)
const cfg = {
  businessName: 'Clock Change Golf', setup: { completed: true, eulaAccepted: true },
  server: { port: 3141, businessName: 'Clock Change Golf', adminPassword: 'clock-change-pw', timezone: TZ },
  booking: { staffedAccess: false, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, windowDays: 30 },
  sms: { sendReminder: false, sendDoorCode: false, sendEndingWarning: true },
  bays: [{ id: 'cc-b1', name: 'Bay One', active: true, shellyDevices: [{ name: 'Plug One', ip: '10.88.0.1', gen: 2, turnOffAfter: true, minutesAfter: 30 }] }]
};
const fresh = () => { for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} } fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(cfg, null, 2)); };
const insertBooking = (id, day, s, e, status) => `db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES ('${id}','cc-b1','Bay One','Clock Customer','+15550300','','${day}','${s}','${e}','${day}',60,5000,'${status}',datetime('now'),datetime('now'))").run();`;
const jobsOnDisk = () => out(run(`require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec("SELECT booking_id,kind,device_key,status,due_at,deadline_at,COALESCE(last_error,'') FROM automation_jobs");console.log(JSON.stringify(r.length?r[0].values.map(v=>({booking:v[0],kind:v[1],device:v[2],status:v[3],due:v[4],deadline:v[5],err:v[6]})):[]));process.exit(0)})`));
const tick = fakeNow => run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`, fakeNow);
const sqlUtc = iso => iso ? iso.slice(0, 19).replace('T', ' ') : null;

try {
  console.log('── A. the end of a booking, against Chicago\'s own clock ──');
  const CASES = [
    ['2026-03-08', '23:30', 'the spring night, after the change (was an hour LATE)'],
    ['2026-03-08', '01:30', 'the spring night, before the change'],
    ['2026-11-01', '20:00', 'the autumn day, after the change (was an hour EARLY)'],
    ['2026-09-24', '21:00', 'an ordinary evening'],
    ['2026-09-20', '25:30', 'a 24-hour club\'s half past one the next morning'],
    ['2026-03-07', '25:30', '"25:30" rolling INTO the spring night']
  ];
  const got = out(run(`const d=require('./services/doorlock');const C=${JSON.stringify(CASES)};
    console.log(JSON.stringify(C.map(([day,t])=>{const a=d.bookingEndDate({date:day,end_time:t});
    const w=d.codeWindow({date:day,start_time:'00:00',end_time:t});return {end:a&&a.toISOString(),windowEnd:w.endDt.toISOString(),lag:w.lag};})));process.exit(0)`));
  CASES.forEach(([day, t, what], i) => {
    const want = chicago(day, t); const g = (Array.isArray(got) && got[i]) || {};
    ok(`A${i + 1} ${day} ${t} - ${what}: ${want} (the one bookingEndDate, and the door window built on it; the scheduler's use of it is B)`, !!want && g.end === want && g.windowEnd === new Date(Date.parse(want) + g.lag * 60000).toISOString(), { want, got: g });
  });

  console.log('\n── B. the scheduler\'s own tick, on a moved clock ──');
  for (const [label, day, s, e, fakeNow] of [['spring', '2026-03-08', '21:30', '23:30', '2026-03-08T12:00:00'], ['autumn', '2026-11-01', '19:00', '20:00', '2026-11-01T12:00:00']]) {
    fresh();
    const seed = run(`const db=require('./services/db');db.initDb().then(async()=>{${insertBooking('cc-' + label, day, s, e, 'active')}await db.flushed();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`, fakeNow);
    const tk = tick(fakeNow);
    const J = Array.isArray(jobsOnDisk()) ? jobsOnDisk() : [];
    const end = chicago(day, e);
    const warn = J.find(j => j.kind === 'ending_warning'), off = J.find(j => j.device === '10.88.0.1' && /off/.test(j.kind));
    ok(`B-${label} the tick (a fresh process at ${fakeNow} Chicago) writes the ending warning 15 minutes before the real end (${sqlUtc(new Date(Date.parse(end) - 900000).toISOString())} UTC), its deadline the end itself`,
      seed.status === 0 && tk.status === 0 && !!warn && warn.due === sqlUtc(new Date(Date.parse(end) - 900000).toISOString()) && warn.deadline === sqlUtc(end), { seed: seed.status, tick: tk.status, err: (tk.stderr || '').slice(-200), warn });
    ok(`B-${label} ...and the plug goes off 30 minutes after the real end (${sqlUtc(new Date(Date.parse(end) + 1800000).toISOString())} UTC), not an hour either side`,
      !!off && off.due === sqlUtc(new Date(Date.parse(end) + 1800000).toISOString()), { off, jobs: J.map(j => [j.kind, j.due]) });
  }

  console.log('\n── C. rule 22: a job nothing will ever claim, on disk before the code runs ──');
  fresh();
  // the aged year's exact row: March 8's warning, an hour late, past its deadline; the booking completed
  const staged = run(`const db=require('./services/db');db.initDb().then(async()=>{${insertBooking('cc-march', '2026-03-08', '21:30', '23:30', 'completed')}
    require('./services/automation').ensureSchema();
    db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,deadline_at,status,attempts,last_error,next_attempt_at,created_at) VALUES ('cc-march','ending_warning','','2026-03-09 05:15:00','2026-03-09 05:30:00','pending',0,'','2026-03-09 05:15:00','2026-03-07 20:00:13')").run();
    await db.flushed();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`, '2026-09-25T05:00:00');
  const healthNow = fakeNow => out(run(`const db=require('./services/db');db.initDb().then(()=>{const h=require('./services/automation').health();console.log(JSON.stringify({overdue:h.overdue}));process.exit(0)})`, fakeNow));
  const before = healthNow('2026-09-25T05:00:00');
  ok('C0 staged: a completed booking\'s warning, past its deadline since March, reads overdue 1 before the code runs - the red line the aged year showed', staged.status === 0 && before.overdue === 1, { staged: (staged.stderr || '').slice(-200), before });
  const t1 = tick('2026-09-25T05:00:00');
  let row = (jobsOnDisk() || []).find(j => j.booking === 'cc-march') || {};
  const after = healthNow('2026-09-25T05:00:00');
  const logged = out(run(`require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec("SELECT event,detail FROM admin_log WHERE detail LIKE '%cc-march%'");console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`));
  ok('C1 a fresh tick records it MISSED with the reason - never fired, never pretended - and nothing reads overdue', t1.status === 0 && row.status === 'missed' && /booking had already finished/.test(row.err) && after.overdue === 0, { tick: (t1.stderr || '').slice(-200), row, after });
  ok('C2 the owner\'s log names it', Array.isArray(logged) && logged.some(([ev, det]) => ev === 'AUTOMATION_MISSED' && /ending_warning/.test(det)), logged);
  const t2 = tick('2026-09-25T05:01:00');
  row = (jobsOnDisk() || []).find(j => j.booking === 'cc-march') || {};
  const logged2 = out(run(`require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec("SELECT COUNT(*) FROM admin_log WHERE event='AUTOMATION_MISSED' AND detail LIKE '%cc-march%'");console.log(JSON.stringify(r[0].values[0][0]));process.exit(0)})`));
  ok('C3 a second restart changes nothing - still missed, logged once', t2.status === 0 && row.status === 'missed' && logged2 === 1, { row, logged2 });
} finally {
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
}
console.log(`\nCLOCK CHANGE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
