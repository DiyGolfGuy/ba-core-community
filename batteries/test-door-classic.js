// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// test-door-classic.js - THE OPT-OUT PATH IS MAIN'S PATH, JOB FOR JOB
// (feature/door-interface, maintainer's ruling Sep 21 2026: nothing changes for an
// owner who changes nothing.)
//
// MAIN_FIXTURE below is what main produced: one tick of the
// real scheduler over a RemoteLock facility with three bookings - inside the
// lead, an hour out, two hours out - every automation job with its due and
// deadline relative to the booking's start, and whether the customer was
// texted. It was captured by running main's own code, not written by hand -
// first from 2d9fa49, and again from main bdbf742 on Oct 2 2026 after main's own
// reminder rule changed (a booking made inside its reminder window gets none, so
// the 10- and 60-minute bookings, made "now", carry no reminder job). The door branch
// merged into main the same day, so main itself now carries the door flow and this
// record stays frozen at bdbf742 - the last main without it. A later change to the
// classic scheduling changes this record on purpose, in the same commit, with the
// reason written here; never recapture it from a main that has the door flow.
// A facility that switches confirm-before-text OFF must reproduce it exactly - at ANY "works BEFORE" lead (Oct 3
// 2026, the pack review: this proved only a 15-minute lead; the classic path texts at 15 whatever the lead).
// And with it ON (the default) the differences allowed are one extra job, door_text, due at the classic text minute
// - the customer's timing is untouched - and, for RemoteLock, the code itself made an HOUR before the session
// (Oct 3 2026, pilot facility's Sep 18 lockout: a code made the minute it began to work never reached two customers' lock).
process.env.SMS_DRYRUN = '1'; process.env.EMAIL_DRYRUN = '1';
// THE CLOCK IS PINNED - ON THE BOUNDARY (Oct 4 2026): on the Pi a pack sweep failed this once (one job more than main's
// record) and it passed alone a minute later. The bookings are made at "now", and when now fell in the FIRST SECOND of a
// minute the booking an hour out was made exactly at its reminder moment - and the scheduler, testing made > moment, sent
// its reminder on top of the confirmation. A product bug (fixed: made AT the moment is inside the window), so every run
// now starts at exactly 2:00:00 PM tomorrow (a fixed time of day, never near midnight) and is reset to it: the boundary
// is exercised every time instead of one run in sixty.
{ const t = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (1), 12), p2 = n => String(n).padStart(2, '0');
  process.env.BA_FAKE_NOW = `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}T14:00:00`; }   // a fixed time of day, computed from now
require('./tools/fake-clock.js');
const fs = require('fs');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const MAIN_FIXTURE = {"jobs":[{"booking":"cl-10","kind":"door_code","device_key":"","dueMinsFromStart":-15,"deadlineMinsFromStart":60,"status":"done"},{"booking":"cl-10","kind":"ending_warning","device_key":"","dueMinsFromStart":45,"deadlineMinsFromStart":60,"status":"pending"},{"booking":"cl-120","kind":"door_code","device_key":"","dueMinsFromStart":-15,"deadlineMinsFromStart":60,"status":"pending"},{"booking":"cl-120","kind":"ending_warning","device_key":"","dueMinsFromStart":45,"deadlineMinsFromStart":60,"status":"pending"},{"booking":"cl-120","kind":"reminder","device_key":"","dueMinsFromStart":-60,"deadlineMinsFromStart":0,"status":"pending"},{"booking":"cl-60","kind":"door_code","device_key":"","dueMinsFromStart":-15,"deadlineMinsFromStart":60,"status":"pending"},{"booking":"cl-60","kind":"ending_warning","device_key":"","dueMinsFromStart":45,"deadlineMinsFromStart":60,"status":"pending"}],"bookings":[{"id":"cl-10","sms_code_sent":1,"hasCode":1},{"id":"cl-120","sms_code_sent":0,"hasCode":0},{"id":"cl-60","sms_code_sent":0,"hasCode":0}]};
const pad = n => String(n).padStart(2, '0');
const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

(async () => {
  const { startLock } = require('./tools/remotelock-standin');
  const L = await startLock({ port: 18127 });
  process.env.BA_REMOTELOCK_BASE = L.base; process.env.BA_REMOTELOCK_AUTH = L.auth;
  const stage = (confirmBeforeText, lead = 15) => {
    const c = { server: { adminPassword: 'x1', businessName: 'Classic Facility' }, setup: { completed: true },
      doorAccess: { provider: 'remotelock', confirmBeforeText, textLeadMins: 15 },
      remotelock: { clientId: 'rl-client', clientSecret: 'rl-secret', deviceId: 'lock-1' },
      booking: { staffedAccess: false, doorCodeLeadMins: lead, doorCodeLagMins: 15, openDays: ['mon','tue','wed','thu','fri','sat','sun'], open24Hours: true },
      sms: { enabled: true, sendDoorCode: true, sendConfirmation: true, sendReminder: true },
      resend: { sendDoorCode: true, sendConfirmation: true, sendReminder: true, apiKey: 're_test', fromEmail: 'unit@example.com' },
      twilio: { accountSid: 'ACbattery', authToken: 'tok', phoneNumber: '+15550001234' },
      bays: [{ id: 'bay1', name: 'Bay 1', active: true }] };
    fs.writeFileSync('config.json', JSON.stringify(c, null, 2));
  };
  stage(false);
  try { fs.unlinkSync('./bookings.db'); } catch {}
  const dbM = require('./services/db'); await dbM.initDb();
  const sched = require('./services/scheduler');
  const rel = (iso, base) => iso ? Math.round((new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z')).getTime() - base.getTime()) / 60000) : null;

  const runOnce = async (prefix) => {
    global.__baFakeClock.set(process.env.BA_FAKE_NOW);   // each run from the same moment
    const starts = {};
    for (const [tag, mins] of [['10', 10], ['60', 60], ['120', 120]]) {
      const id = prefix + tag;
      const st = new Date(Date.now() + mins * 60000); st.setSeconds(0, 0); const en = new Date(st.getTime() + 60 * 60000); starts[id] = st;
      dbM.db.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,sms_consent)
                      VALUES (?,'bay1','Bay 1',?,?,?,?,?,?,?,60,0,'active',1)`).run(id, 'C ' + id, '+1555' + String((Number(prefix.replace(/\D/g, '')) || 0) * 1000 + mins).padStart(7, '0').slice(-7), 'c@example.invalid', ymd(st), hm(st), hm(en), ymd(en));
    }
    await sched.checkBookings();
    const rows = dbM.db.prepare(`SELECT booking_id, kind, device_key, due_at, deadline_at, status FROM automation_jobs WHERE booking_id LIKE ? ORDER BY booking_id, kind, device_key`).all(prefix + '%');
    const jobs = rows.map(r => ({ booking: r.booking_id.replace(prefix, 'cl-'), kind: r.kind, device_key: r.device_key || '', dueMinsFromStart: rel(r.due_at, starts[r.booking_id]), deadlineMinsFromStart: rel(r.deadline_at, starts[r.booking_id]), status: r.status }));
    const bookings = dbM.db.prepare(`SELECT id, sms_code_sent, door_code IS NOT NULL AS hasCode, door_code_state FROM bookings WHERE id LIKE ? ORDER BY id`).all(prefix + '%')
      .map(b => ({ id: b.id.replace(prefix, 'cl-'), sms_code_sent: b.sms_code_sent, hasCode: b.hasCode, state: b.door_code_state }));
    return { jobs, bookings };
  };
  const strip = o => ({ jobs: o.jobs, bookings: o.bookings.map(b => ({ id: b.id, sms_code_sent: b.sms_code_sent, hasCode: b.hasCode })) });

  console.log('── OFF: the opt-out path against main\'s own job table ──');
  const off = await runOnce('off-');
  ok('OFF: every job main makes, the branch makes - same kind, same due, same deadline, same status (' + off.jobs.length + ' jobs)',
     JSON.stringify(strip(off).jobs) === JSON.stringify(MAIN_FIXTURE.jobs), { branch: off.jobs, main: MAIN_FIXTURE.jobs });
  ok('OFF: the customer outcome matches main - texted inside the lead, not before it', JSON.stringify(strip(off).bookings) === JSON.stringify(MAIN_FIXTURE.bookings), { branch: strip(off).bookings, main: MAIN_FIXTURE.bookings });
  ok('OFF: no door_text job exists', !off.jobs.some(j => j.kind === 'door_text'));
  ok('OFF: no state column was written for any booking', off.bookings.every(b => b.state == null), off.bookings);
  ok('MAIN itself never had a door_text job (the fixture is honest)', !MAIN_FIXTURE.jobs.some(j => j.kind === 'door_text'));
  // THE CLASSIC PATH AT ANOTHER LEAD (Oct 3 2026, the pack review): the code is texted at 15 whatever the "works BEFORE"
  // lead - a lead of 5 or 30 changes the door's window, never when the classic text goes
  for (const lead of [5, 30]) {
    stage(false, lead);
    const o = await runOnce('off' + lead + '-');
    ok(`OFF at a ${lead}-minute lead: the same jobs at the same minutes as main, the code texted at 15`, JSON.stringify(strip(o).jobs) === JSON.stringify(MAIN_FIXTURE.jobs) && JSON.stringify(strip(o).bookings) === JSON.stringify(MAIN_FIXTURE.bookings), { branch: o.jobs.filter(j => j.kind === 'door_code'), outcome: strip(o).bookings });
  }

  console.log('── ON (the default): the only difference is door_text, at the same minute ──');
  stage(true);
  const on = await runOnce('on-');
  const onNoText = on.jobs.filter(j => j.kind !== 'door_text');
  // main's jobs, with RemoteLock's code made an hour ahead - the one change to them, on purpose (Oct 3 2026)
  // (the booking an hour out has reached its hour, so its code is already made - done, not yet texted)
  const mainHourAhead = MAIN_FIXTURE.jobs.map(j => j.kind === 'door_code' ? Object.assign({}, j, { dueMinsFromStart: -60 }, j.booking === 'cl-60' ? { status: 'done' } : {}) : j);
  ok('ON: every job main makes is still made, identically - except that RemoteLock\'s code is made an hour before the session, so the lock has it in time', JSON.stringify(onNoText) === JSON.stringify(mainHourAhead), { branch: onNoText, main: mainHourAhead });
  const texts = on.jobs.filter(j => j.kind === 'door_text');
  ok('ON: exactly one door_text per booking is the only addition', texts.length === 3 && on.jobs.length === MAIN_FIXTURE.jobs.length + 3, texts);
  ok('ON: each door_text is due at 15 minutes before - main\'s text minute; the customer\'s timing is unchanged',
     texts.every(t => t.dueMinsFromStart === -15), texts);
  // the customer outcome: texted inside the lead, not before it - as main; the hour-out booking's code exists already
  const mainOutcomeAhead = MAIN_FIXTURE.bookings.map(b => b.id === 'cl-60' ? Object.assign({}, b, { hasCode: 1 }) : b);
  ok('ON: the customer outcome is the same as main - texted inside the lead, not before it (the booking an hour out has its code made, not sent)', JSON.stringify(strip(on).bookings) === JSON.stringify(mainOutcomeAhead), { branch: strip(on).bookings, want: mainOutcomeAhead });
  ok('ON: RemoteLock answered unknown for the one it created', on.bookings.find(b => b.id === 'cl-10').state === 'unknown', on.bookings);

  try { fs.unlinkSync('./bookings.db'); } catch {}
  await L.stop();
  console.log(`\nDOOR CLASSIC: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
