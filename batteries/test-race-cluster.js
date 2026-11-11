// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-race-cluster.js — #19/#20/#21, the pilot facility "Yolanda" money+unmanned-safety
// cluster. A customer must never be charged for a booking that did not happen,
// and a payment that DID succeed must never be lost. Built for golden.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}


(async () => {
  const root = __dirname;
  const cfgPath = path.join(root, 'config.json');
  const dbPath = path.join(root, 'bookings.db');
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Race', setup: { completed: true }, booking: { staffedAccess: false },
    bays: [{ id: 'bay1', name: 'B1', active: true }], server: { port: 3093 }
  }));
  const db = require('./services/db');
  await db.initDb();
  const auto = require('./services/automation');
  auto.ensureSchema();
  const D = db.db;

  // ── automation primitives against a real DB ────────────────────────────────
  console.log('\u2500\u2500 automation primitives: defer + cancelBayShutdownJobs \u2500\u2500');
  {
    auto.ensureJob({ booking_id: 'A', kind: 'shutdown', due_at: new Date(Date.now() - 60000), deadline_at: new Date(Date.now() + 3600000) });
    D.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES ('A','bay1','B1','A','','2026-08-20','14:00','15:00','2026-08-20',60,7000,'active')").run();
    db.save();

    auto.defer('A', 'shutdown', '', 2, 'mid-checkout');
    const j = D.prepare("SELECT status, attempts, next_attempt_at FROM automation_jobs WHERE booking_id='A' AND kind='shutdown'").get();
    ok('defer re-arms to pending without burning the retry budget', j.status === 'pending' && j.attempts === 0);
    ok('defer schedules the re-check in the future', new Date(j.next_attempt_at + 'Z') > new Date());

    // the new booking starts NOW on the bay (the race this exists for); one for NEXT WEEK must not touch
    // anything (Sep 25 2026, the build review - it used to write off every switch-off on the bay)
    const pad = n => String(n).padStart(2, '0'), t = new Date(), wk = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (7), 12);
    const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const later = new Date(Date.now() + 3600000);
    D.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES ('W','bay1','B1','W','',?,?,?,?,60,7000,'active')").run(ymd(wk), '10:00', '11:00', ymd(wk));
    auto.defer('A', 'shutdown', '', 0, 'x'); D.prepare("UPDATE automation_jobs SET next_attempt_at=due_at WHERE booking_id='A'").run();
    const rw = auto.cancelBayShutdownJobs('bay1', 'W');
    ok('a booking for NEXT WEEK writes off nothing on the bay', rw.changes === 0 && D.prepare("SELECT status FROM automation_jobs WHERE booking_id='A' AND kind='shutdown'").get().status === 'pending');
    D.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES ('B','bay1','B1','B','',?,?,?,?,60,7000,'active')").run(ymd(t), hm(t), hm(later), ymd(later));
    const res = auto.cancelBayShutdownJobs('bay1', 'B');
    const ja = D.prepare("SELECT status FROM automation_jobs WHERE booking_id='A' AND kind='shutdown'").get();
    ok('a new booking starting now cancels a prior bay shutdown already due (pending -> skipped)', res.changes === 1 && ja.status === 'skipped');

    auto.ensureJob({ booking_id: 'B', kind: 'shutdown', due_at: new Date(), deadline_at: null });
    auto.cancelBayShutdownJobs('bay1', 'B');
    const jb = D.prepare("SELECT status FROM automation_jobs WHERE booking_id='B' AND kind='shutdown'").get();
    ok('the cancel never touches the NEW booking\u2019s own jobs', jb.status === 'pending');
  }

  // ── #19.1 shutdown-in-progress guard (pre-payment) ─────────────────────────
  console.log('\u2500\u2500 #19.1 shutdown-in-progress guard \u2500\u2500');
  {
    // (Oct 23 2026, the battery audit: three checks of this battery's own copy of the guard - "mirror the code exactly" - are gone;
    // they graded the copy, never routes/bookings.js. The Oct 2 cleanup removed two other copies from this file and missed these.)
    const bk = fs.readFileSync(path.join(root, 'routes/bookings.js'), 'utf8');
    ok('the guard reads a FIXED config window (not device minutesAfter)', bk.includes('pcShutdownGuardMins ?? 10') && bk.includes('SHUTDOWN-IN-PROGRESS GUARD'));
    ok('the guard returns 409 before charging', /powering down from the previous session/.test(bk));
  }

  // ── #19.3 shutdown re-checks activeNow at fire time ────────────────────────
  console.log('\u2500\u2500 #19.3 shutdown re-checks active-now \u2500\u2500');
  {
    // (Oct 2 2026, the cleanup audit: this battery's own copy of the check is gone - it graded the copy, not the
    // scheduler. The real drive is test-pc-restart's "a session running on the bay as the last one ends".)
    const sch = fs.readFileSync(path.join(root, 'services/scheduler.js'), 'utf8');
    ok('the scheduler checks activeNow before firing', sch.includes('const activeNow') && sch.includes('A session is active on this bay right now'));
  }

  // ── #20 defer for a mid-checkout hold + extended deadline ──────────────────
  console.log('\u2500\u2500 #20 defer-don\u2019t-skip for a live checkout + 90-min deadline \u2500\u2500');
  {
    const sch = fs.readFileSync(path.join(root, 'services/scheduler.js'), 'utf8');
    ok('a pending_payment hold DEFERS the shutdown (not fire, not permanent skip)', sch.includes("automation.defer(booking.id, 'shutdown'") && sch.includes('SHUTDOWN_DEFERRED'));
    ok('the defer is decided BEFORE run() so succeed() cannot mark it done', sch.includes('must be decided BEFORE automation.run()') && sch.includes('shutdownDue = false;'));
    ok('the shutdown deadline is extended to 90 min so a long defer isn\u2019t marked missed', sch.includes('endDt.getTime() + 90 * 60000'));
  }

  // ── #21 sweep refunds an undeliverable paid booking ────────────────────────
  console.log('\u2500\u2500 #21 sweep refunds instead of reactivating a dead session \u2500\u2500');
  {
    // (Oct 2 2026, the cleanup audit: this battery's own copy of the sweeper's decision is gone - it graded the copy.
    // The real sweeper is driven for a session already over by test-sweeper-restart and test-started-slot C4, and for a
    // payment landing after the start by test-started-slot C1. A payment made in time into a bay whose PC shut down at
    // the start (bayWasDown) has NO real drive yet - on the later list, OPEN-AND-PARKED section 5.)
    const sch = fs.readFileSync(path.join(root, 'services/scheduler.js'), 'utf8');
    ok('the sweep has the deliverability gate (sessionOver / bayWasDown)', sch.includes('const sessionOver') && sch.includes('let bayWasDown'));
    ok('an undeliverable paid booking is refunded + logged, not reactivated', sch.includes('BOOKING_LAPSED_REFUNDED') && sch.includes("idempotencyKey: 'rf-lapsed-'"));
    ok('a failed auto-refund surfaces a manual-refund alert', sch.includes('REFUND NEEDED (manual)'));
  }

  console.log('\nRACE CLUSTER: ' + pass + ' passed, ' + fail + ' failed');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(dbPath); } catch {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
