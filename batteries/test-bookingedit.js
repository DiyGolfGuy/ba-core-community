// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-bookingedit.js — staff MOVE and CANCEL. The two traps under test:
// (1) a move must reset notification flags and kill the old door code,
// (2) a cancel must release member usage/credit and never leave a live code.
const fs = require('fs');
const { spawn } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
const BASE = 'http://127.0.0.1:3001';
// LOCAL date, never UTC: on the Pi (CDT) the UTC day rolls at 7 PM local and
// every toISOString fixture slid a day forward - caught by the first on-Pi
// suite run (maintainer, Aug 13). The server was right; the seeds were wrong.
const ymdL = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dplus = n => ymdL(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (n), 12));

(async () => {
  { const p = './config.json'; let c = {}; if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
    c.server = Object.assign({}, c.server, { businessName: 'Edit Test', adminPassword: 'battery-owner-pass-1',
      staff: [{ name: 'Dana', code: '4321', active: true }] });
    c.setup = Object.assign({}, c.setup, { completed: true });
    c.booking = Object.assign({}, c.booking, { staffedAccess: true, pricePerHalfHour: 40 });
    // Bay 1 and Bay 3 each have a plug set to switch off after a session (the move-run section)
    c.bays = [{ id: 'bay1', name: 'Bay 1', active: true, shellyDevices: [{ name: 'Plug 1', ip: '10.9.9.1', gen: 2, turnOffAfter: true }] }, { id: 'bay2', name: 'Bay 2', active: true },
      { id: 'bay3', name: 'Bay 3', active: true, shellyDevices: [{ name: 'Plug 3', ip: '10.9.9.3', gen: 2, turnOffAfter: true }] }, { id: 'bay4', name: 'Bay 4', active: true }, { id: 'bay5', name: 'Bay 5', active: true }];
    c.cancellationPolicy = { windowHours: 24 };
    c.stripe = Object.assign({}, c.stripe, { secretKey: '' });
    fs.writeFileSync(p, JSON.stringify(c, null, 2)); }

  const dbM = require('./services/db'); await dbM.initDb();
  const edit = require('./services/bookingedit');
  const D = dbM.db;

  // Own the slate: this battery's rows only, so reruns are deterministic.
  for (const id of ['b-soon','b-far','b-move','b-block','b-mover','b-late','b-cancel','b-late-cancel','b-mem','b-http','b-run','b-run2','b-next2','b-up','b-near5','b-near1','b-mail']) {
    try { D.prepare(`DELETE FROM automation_jobs WHERE booking_id=?`).run(id); } catch {}
    try { D.prepare(`DELETE FROM bookings WHERE id=?`).run(id); } catch {}
    try { D.prepare(`DELETE FROM member_usage WHERE booking_id=?`).run(id); } catch {}
    try { D.prepare(`DELETE FROM member_credit WHERE booking_id=?`).run(id); } catch {}
  }
  try { D.prepare(`DELETE FROM members WHERE id='m1'`).run(); } catch {}
  try { D.prepare(`DELETE FROM membership_tiers WHERE id='t1'`).run(); } catch {}

  const mk = (id, date, start, end, bay = 'bay1', extra = {}) => {
    D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,
      duration_minutes,price_cents,status,sms_reminder_sent,sms_code_sent,door_code,remotelock_person_id,member_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?)`)
      .run(id, bay, bay === 'bay1' ? 'Bay 1' : 'Bay 2', extra.name || 'Pat', '+15551230000', extra.email || '',
        date, start, end, date, 60, 8000,
        extra.reminded ? 1 : 0, extra.coded ? 1 : 0, extra.door || null, extra.person || null, extra.member || null);
    return D.prepare(`SELECT * FROM bookings WHERE id=?`).get(id);
  };

  console.log('── policy window ──');
  const soon = mk('b-soon', ymdL(new Date(Date.now() + 3 * 3600000)),
    new Date(Date.now() + 3 * 3600000).toTimeString().slice(0, 5), '23:59');
  const w = edit.windowState(soon);
  ok('window: a session 3h out is flagged late', w.late === true && w.limit === 24, w);
  const far = mk('b-far', dplus(5), '10:00', '11:00');
  ok('window: a session 5 days out is inside policy', edit.windowState(far).inside_policy === true);

  console.log('── MOVE ──');
  const b1 = mk('b-move', dplus(3), '10:00', '11:00', 'bay1', { reminded: true, coded: true, door: '4821', person: 'person_1' });
  let r = await edit.moveBooking('b-move', { date: dplus(3), start_time: '14:00', duration_minutes: 60, bay_id: 'bay1', actor: 'Dana' });
  ok('move: accepted', r.ok === true, r);
  const moved = D.prepare(`SELECT * FROM bookings WHERE id='b-move'`).get();
  ok('move: time updated', moved.start_time === '14:00' && moved.end_time === '15:00', { s: moved.start_time, e: moved.end_time });
  ok('move: THE TRAP - reminder flag reset so it fires for the new time', moved.sms_reminder_sent === 0, moved.sms_reminder_sent);
  ok('move: THE TRAP - door-code flag reset', moved.sms_code_sent === 0, moved.sms_code_sent);
  ok('move: stale door code cleared (cannot open at the old window)', !moved.door_code && !moved.remotelock_person_id, { c: moved.door_code, p: moved.remotelock_person_id });

  // THE CUSTOMER IS EMAILED (maintainer, Oct 4 2026: "If staff move a booking sure email them")
  {
    process.env.EMAIL_DRYRUN = '1';
    const cs = require('./services/config');
    const mails = () => D.prepare(`SELECT detail FROM admin_log WHERE event='EMAIL_DRYRUN' AND detail LIKE '%moved@edit.example%' ORDER BY id`).all().map(r => r.detail);
    const settle = () => new Promise(r => setTimeout(r, 150));
    mk('b-mail', dplus(5), '10:00', '11:00', 'bay1', { email: 'moved@edit.example' });
    r = await edit.moveBooking('b-mail', { date: dplus(5), start_time: '15:00', duration_minutes: 60, bay_id: 'bay1', actor: 'Dana' }); await settle();
    const m1 = mails();
    ok('move: the customer is emailed "Booking Changed" with the new time - staff moved it', r.ok === true && m1.length === 1 && /Booking Changed/.test(m1[0]) && /3:00 PM/.test(m1[0]), m1);
    r = await edit.moveBooking('b-mail', { date: dplus(5), start_time: '15:00', duration_minutes: 90, bay_id: 'bay1', actor: 'Dana' }); await settle();
    ok('move: ...a change of length only (same day, time and bay) is not a move of where or when to come - no email', r.ok === true && mails().length === 1, mails());
    cs.saveConfig({ resend: { sendMoved: false } });
    r = await edit.moveBooking('b-mail', { date: dplus(5), start_time: '16:30', duration_minutes: 90, bay_id: 'bay1', actor: 'Dana' }); await settle();
    ok('move: ...and with the owner\'s "Booking changed by staff" switch off, nothing is sent', r.ok === true && mails().length === 1, mails());
    cs.saveConfig({ resend: { sendMoved: true } });
    delete process.env.EMAIL_DRYRUN;
  }

  // conflict
  mk('b-block', dplus(4), '10:00', '11:00', 'bay1');
  const b2 = mk('b-mover', dplus(4), '14:00', '15:00', 'bay1');
  r = await edit.moveBooking('b-mover', { date: dplus(4), start_time: '10:00', duration_minutes: 60, bay_id: 'bay1' });
  ok('move: refuses a conflicting slot', !!r.error && r.code === 409, r);
  ok('move: the booking is untouched after a refused move',
     D.prepare(`SELECT start_time FROM bookings WHERE id='b-mover'`).get().start_time === '14:00');
  r = await edit.moveBooking('b-mover', { date: dplus(4), start_time: '10:00', duration_minutes: 60, bay_id: 'bay2' });
  ok('move: the SAME time in a free bay is allowed', r.ok === true, r);
  ok('move: bay name follows the bay id', D.prepare(`SELECT bay_name FROM bookings WHERE id='b-mover'`).get().bay_name === 'Bay 2');
  r = await edit.moveBooking('b-mover', { date: dplus(4), start_time: '10:00', duration_minutes: 60, bay_id: 'bay2' });
  ok('move: a no-op move is refused', !!r.error, r);
  r = await edit.moveBooking('nope', { date: dplus(4), start_time: '10:00' });
  ok('move: unknown booking 404', r.code === 404);
  r = await edit.moveBooking('b-move', { date: 'not-a-date' });
  ok('move: bad date rejected', !!r.error && r.code === 400);
  // midnight crossing
  const b3 = mk('b-late', dplus(6), '23:00', '23:59');
  r = await edit.moveBooking('b-late', { date: dplus(6), start_time: '23:30', duration_minutes: 90, bay_id: 'bay1' });
  const late = D.prepare(`SELECT * FROM bookings WHERE id='b-late'`).get();
  ok('move: a session crossing midnight sets end_date to the next day', r.ok && late.end_time === '01:00' && late.end_date === dplus(7), { e: late.end_time, ed: late.end_date });

  console.log('── a RUNNING session moved to another bay (Oct 3 2026; pilot facility\'s handoff section 3) ──');
  {
    // the move QUEUES the old bay's switch-offs for the scheduler's cancel settle (the review, Oct 3 2026 - the first cut
    // pressed the bay's Off button, which knew no shared device, no "switch off after" and no toggle guard); the settle
    // itself, the PC first and every guard, is driven with devices by test-device-skips M. Here: what the move queues.
    const A = require('./services/automation'); A.ensureSchema();
    const leftRows = id => D.prepare(`SELECT kind, device_key, status FROM automation_jobs WHERE booking_id=? AND device_key LIKE 'left:%' ORDER BY kind`).all(id);
    const at = m => { const t = new Date(Date.now() + m * 60000); return { d: ymdL(t), hm: String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') }; };
    const run = (id, bay, s0, e0, switchedOn) => { const a = at(s0), b = at(e0);
      D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'active')`)
        .run(id, bay, 'Bay ' + bay.slice(3), 'Pat ' + id, '+15551230000', '', a.d, a.hm, b.hm, b.d, e0 - s0);
      if (switchedOn) { A.ensureJob({ booking_id: id, kind: 'power_on', device_key: '10.9.9.' + bay.slice(3), due_at: new Date(Date.now() + (s0 - 10) * 60000), deadline_at: new Date(Date.now() + e0 * 60000) }); A.succeed(id, 'power_on', '10.9.9.' + bay.slice(3)); } };
    const settle = () => new Promise(r => setTimeout(r, 50));
    const movedLog = id => (D.prepare(`SELECT detail FROM admin_log WHERE event='BOOKING_MOVED' AND detail LIKE ? ORDER BY id DESC`).get(id + ' |%') || {}).detail || '';
    run('b-run', 'bay1', -20, 40, true);              // playing on Bay 1 for twenty minutes; the bay was switched on for it
    r = await edit.moveBooking('b-run', { bay_id: 'bay2', actor: 'Dana', reason: 'projector died' }); await settle();
    const lr = leftRows('b-run');
    ok('move-run: a session that switched its bay on, moved to another bay mid-session - the OLD bay\'s plug is queued to switch off now, with the record that this session switched it on (it was left on all night: the move dropped its OFF and the scheduler then drives only the new bay)',
       r.ok === true && lr.some(x => x.kind === 'power_off' && x.device_key === 'left:bay1|10.9.9.1' && x.status === 'pending') && lr.some(x => x.kind === 'power_on' && x.device_key === 'left:bay1|10.9.9.1' && x.status === 'done') && lr.length === 2, { r: r.error, lr });
    ok('move-run: ...and the owner\'s log says so on the move\'s own line', /Bay 1 switching off/.test(movedLog('b-run')), movedLog('b-run'));
    run('b-run2', 'bay3', -50, 10, true);             // ending in ten minutes on Bay 3 ...
    run('b-next2', 'bay3', 10, 70, false);            // ... and the next group starts there in ten
    r = await edit.moveBooking('b-run2', { bay_id: 'bay4', actor: 'Dana' }); await settle();
    ok('move-run: the old bay is LEFT ON when the next group starts there inside the keep-on gap - that session owns the equipment', r.ok === true && leftRows('b-run2').length === 0 && /Bay 3 left on/.test(movedLog('b-run2')), { left: leftRows('b-run2'), log: movedLog('b-run2') });
    run('b-up', 'bay1', 120, 180, false);             // two hours out: nothing was ever switched on for it
    r = await edit.moveBooking('b-up', { bay_id: 'bay3', actor: 'Dana' }); await settle();
    ok('move-run: control - moving a booking that switched nothing on switches nothing off', r.ok === true && leftRows('b-up').length === 0 && !/switching off/.test(movedLog('b-up')), { left: leftRows('b-up'), log: movedLog('b-up') });
    r = await edit.moveBooking('b-run', { bay_id: 'bay5', actor: 'Dana', reason: 'moved again' }); await settle();
    ok('move-run: moved AGAIN - the first bay\'s queued switch-off is kept (a move drops the booking\'s jobs, never a bay it left)', r.ok === true && leftRows('b-run').some(x => x.kind === 'power_off' && x.device_key === 'left:bay1|10.9.9.1'), leftRows('b-run'));
    // a NEW booking about to start skips the switch-offs of ITS bay (automation.cancelBayShutdownJobs) - a moved session's
    // belong to the bay it LEFT, not the bay it is on now (the critic, Oct 3 2026)
    run('b-near5', 'bay5', 5, 65, false);
    A.cancelBayShutdownJobs('bay5', 'b-near5', 30);
    const keptLeft = leftRows('b-run').find(x => x.kind === 'power_off');
    run('b-near1', 'bay1', 5, 65, false);
    A.cancelBayShutdownJobs('bay1', 'b-near1', 30);
    const tookLeft = leftRows('b-run').find(x => x.kind === 'power_off');
    ok('move-run: a new group about to start on the bay the session moved TO leaves the old bay\'s switch-off alone; one starting on the bay it LEFT takes it over (skipped - that group needs the bay on)',
       keptLeft && keptLeft.status === 'pending' && tookLeft && tookLeft.status === 'skipped', { keptLeft, tookLeft });
  }

  console.log('── CANCEL ──');
  const b4 = mk('b-cancel', dplus(3), '10:00', '11:00', 'bay1', { door: '9911', person: 'person_9' });
  r = await edit.cancelBooking('b-cancel', { actor: 'Dana', refund_type: 'none' });
  ok('cancel: accepted outside the window', r.ok === true, r);
  const cancelled = D.prepare(`SELECT * FROM bookings WHERE id='b-cancel'`).get();
  ok('cancel: status is cancelled', cancelled.status === 'cancelled');
  ok('cancel: door code cleared (no live code on a dead session)', !cancelled.door_code && !cancelled.remotelock_person_id, { c: cancelled.door_code });
  r = await edit.cancelBooking('b-cancel', { actor: 'Dana' });
  ok('cancel: cancelling twice is refused', !!r.error, r);

  // late cancel requires an explicit override
  const b5 = mk('b-late-cancel', ymdL(new Date(Date.now() + 2 * 3600000)),
    new Date(Date.now() + 2 * 3600000).toTimeString().slice(0, 5), '23:59');
  r = await edit.cancelBooking('b-late-cancel', { actor: 'Dana' });
  ok('cancel: inside the window it REFUSES and asks for an override', !!r.error && r.requires_override === true, r);
  ok('cancel: the booking survives a refused late cancel',
     D.prepare(`SELECT status FROM bookings WHERE id='b-late-cancel'`).get().status === 'active');
  r = await edit.cancelBooking('b-late-cancel', { actor: 'Dana', override_policy: true, reason: 'customer sick' });
  ok('cancel: staff CAN override with a reason', r.ok === true, r);
  const logRow = D.prepare(`SELECT * FROM admin_log WHERE event='BOOKING_CANCELLED' ORDER BY rowid DESC LIMIT 1`).get();
  ok('cancel: the override is recorded as a LATE CANCEL in the audit log', /LATE CANCEL/.test(logRow.detail), logRow && logRow.detail);
  ok('cancel: the employee name is on the audit row', /Dana/.test(logRow.detail), logRow && logRow.detail);

  console.log('── member release ──');
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value) VALUES ('t1','Gold','percentage',20)`).run();
  D.prepare(`INSERT INTO members (id,tier_id,name,phone,pin,status) VALUES ('m1','t1','Casey','+15551110000','1234','active')`).run();
  const b6 = mk('b-mem', dplus(3), '12:00', '13:00', 'bay1', { member: 'm1' });
  D.prepare(`INSERT INTO member_usage (id,member_id,booking_id,date,duration_minutes) VALUES ('mu1','m1','b-mem',?,60)`).run(dplus(3));
  D.prepare(`INSERT INTO member_credit (member_id,delta_cents,reason,booking_id) VALUES ('m1',-2000,'Applied to booking','b-mem')`).run();
  r = await edit.cancelBooking('b-mem', { actor: 'Dana', refund_type: 'none' });
  ok('cancel: member usage released', D.prepare(`SELECT COUNT(*) c FROM member_usage WHERE booking_id='b-mem'`).get().c === 0);
  const bal = D.prepare(`SELECT COALESCE(SUM(delta_cents),0) b FROM member_credit WHERE member_id='m1'`).get().b;
  ok('cancel: consumed member credit restored', bal === 0, bal);

  console.log('── HTTP surface ──');
  const child = spawn('node', ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
  for (let i = 0; i < 60; i++) { try { const x = await fetch(BASE + '/api/time'); if (x.ok) break; } catch {} await new Promise(r2 => setTimeout(r2, 300)); }
  const j = async (m, p, { headers = {}, body } = {}) => {
    const x = await fetch(BASE + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: body !== undefined ? JSON.stringify(body) : undefined });
    let d = null; try { d = await x.json(); } catch {}
    return { status: x.status, data: d };
  };
  let q = await j('POST', '/api/staff/login', { body: { code: '4321' } });
  const SH = { 'x-staff-token': q.data && q.data.token };
  q = await j('POST', '/api/staff/bookings', { headers: SH, body: {
    name: 'HTTP Pat', phone: '5551239999', bay_id: 'bay1', date: dplus(3),
    start_time: '09:00', duration_minutes: 60, payment: 'pay_here' } });
  const httpId = q.data && (q.data.bookingId || q.data.id || (q.data.booking && q.data.booking.id));
  ok('http: fixture booking created through the server', !!httpId, q.data);
  q = await j('GET', '/api/staff/booking/' + httpId + '/edit-context');
  ok('http: edit context requires staff auth', q.status === 401, q.status);
  q = await j('GET', '/api/staff/booking/' + httpId + '/edit-context', { headers: SH });
  ok('http: edit context returns booking + window + bays', q.status === 200 && !!q.data.booking && !!q.data.window && q.data.bays.length === 5, q.data && Object.keys(q.data));   // the facility's five bays (two until Oct 3 2026; the running-session moves need four, and a fifth free one for a second move)
  q = await j('POST', '/api/staff/booking/' + httpId + '/move', { headers: SH, body: { date: dplus(3), start_time: '16:00', duration_minutes: 60, bay_id: 'bay1' } });
  ok('http: staff can move', q.status === 200 && q.data.ok === true, q.data);
  q = await j('POST', '/api/staff/booking/' + httpId + '/cancel', { headers: SH, body: { refund_type: 'none', reason: 'test' } });
  ok('http: staff can cancel', q.status === 200 && q.data.ok === true, q.data);
  q = await j('POST', '/api/staff/booking/' + httpId + '/cancel', { headers: SH, body: {} });
  ok('http: double cancel refused', q.status === 400, q.status);

  // Leave no trace: the HTTP fixture booking is server-side, so clear it by
  // name through the same process that owns that db after shutdown.
  try { D.prepare(`DELETE FROM bookings WHERE name='HTTP Pat'`).run(); } catch {}
  child.kill('SIGTERM');
  await new Promise(r2 => setTimeout(r2, 600));
  try {
    const fresh = require('./services/db');
    fresh.db.prepare(`DELETE FROM bookings WHERE name='HTTP Pat'`).run();
    if (typeof fresh.save === 'function') fresh.save();
  } catch {}
  console.log(`\nBOOKING EDIT: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 400);
})().catch(e => { console.error(e); process.exit(1); });
