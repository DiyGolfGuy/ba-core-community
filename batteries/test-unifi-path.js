// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-unifi-path.js - A UNIFI DOOR CODE FROM BOOKING TO REMOVAL, WITH THE CONSOLE
//                      GOING AWAY AT BOTH ENDS (Sep 25 2026, maintainer's item 10)
//
// maintainer: "Walk the full path and prove it with the fakes: code created for a booking, when
// it's created relative to the session, when it's removed after, and what happens if the
// console doesn't answer at either step. A failure is recorded and shows on health. When
// the console comes back, the unit reconciles, including removing codes that should
// already be gone."
// The console is the shared stand-in (tools/unifi-console-standin.js), living in THIS
// process so it keeps its visitors while the product's processes come and go - the way a
// real console does. Every tick, sweep and health reading is the product's own code in a
// fresh process (rule 22), reading the job table on disk.
//   1  when: the door-code job is due 15 minutes before the session; the code the
//      console is given works from the owner's lead before the start to their lag after
//      the end (15 and 15 here); a session 45 minutes out has nothing at the console yet
//   2  the console does not answer at CREATE: no code, the failure in the owner's log,
//      and the Door codes line RED straight away (it used to stay green ~38 minutes)
//   3  the console does not answer at REMOVAL: a finished session's code and a cancelled
//      booking's code are both kept on record, retried, and the cancel is RED
//   4  the console comes back: the waiting code is created and sent, both codes that
//      should be gone are removed (forced), every record cleared, the line green
//   5  the nightly sweep removes a code of ours the unit has no live record of (its
//      create answer was lost), never a visitor that is not ours, never a live one
//   6  two more restarts: nothing is created or removed twice
//   7  a busy night: six sessions playing with live codes and one cancelled whose removal
//      the console refused - the next tick removes the cancelled one, not waiting behind
//      six codes that are not due (the sweep takes five a tick)
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };
const root = __dirname;
const PORT = 12474, TOKEN = 'tok-path-battery', UNIT = 'unit-path-battery';
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
const { startConsole } = require('./tools/unifi-console-standin');
const pad = n => String(n).padStart(2, '0');
const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const hm = t => `${pad(t.getHours())}:${pad(t.getMinutes())}`;
// whole minutes, so the times stored as HH:MM are exactly the times the battery reasons with
const base = new Date(Math.floor(Date.now() / 60000) * 60000);
const at = m => new Date(base.getTime() + m * 60000);
const epoch = t => Math.floor(t.getTime() / 1000);

// the product's processes run ASYNCHRONOUSLY: the console lives in this process and must
// keep answering while they run (a synchronous spawn would block it)
const run = js => new Promise(res => { const ch = spawn(process.execPath, ['-e', js], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; ch.stdout.on('data', d => o += d); ch.stderr.on('data', d => e += d); ch.on('exit', code => res({ status: code, out: o, err: e })); });
const tick = () => run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
// a tick at another moment (tools/fake-clock.js): the product's clock, and sql.js's datetime('now'), read `iso`
const tickAt = iso => new Promise(res => { const ch = spawn(process.execPath, ['-r', './tools/fake-clock.js', '-e', `const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`], { cwd: root, env: Object.assign({}, ENV, { BA_FAKE_NOW: iso }), stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; ch.stdout.on('data', d => o += d); ch.stderr.on('data', d => e += d); ch.on('exit', code => res({ status: code, out: o, err: e })); });
const nightly = () => run(`const db=require('./services/db');db.initDb().then(async()=>{const r=await require('./services/unifiaccess').sweepExpiredVisitors();await db.flushed();db.flushSync();console.log('SWEEP '+JSON.stringify(r));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
const health = async () => { const r = await run(`const db=require('./services/db');db.initDb().then(async()=>{const h=require('./services/unithealth').compute();console.log('HEALTH '+JSON.stringify(h.signals||h));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
  const m = /HEALTH (.*)/.exec(r.out); const all = m ? JSON.parse(m[1]) : []; return (Array.isArray(all) ? all : []).find(s => s.key === 'doorcodes' || s.id === 'doorcodes') || { none: r.out.slice(-200) + r.err.slice(-200) }; };
const read = () => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const q=s=>{const r=d.exec(s);return r.length?r[0].values:[]};
  console.log(JSON.stringify({ log:q("SELECT event,detail FROM admin_log ORDER BY id"),
    bk:q("SELECT id,status,COALESCE(door_code,''),COALESCE(remotelock_person_id,''),sms_code_sent FROM bookings WHERE id LIKE 'up-%'"),
    jobs:q("SELECT booking_id,kind,status,attempts,due_at,COALESCE(last_error,'') FROM automation_jobs WHERE booking_id LIKE 'up-%'") }));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const j = JSON.parse(r.stdout.trim().split('\n').pop());
  return { log: j.log.map(([event, detail]) => ({ event, detail })), bk: Object.fromEntries(j.bk.map(([id, status, code, ref, sent]) => [id, { status, code, ref, sent }])),
    job: (id, kind) => { const x = j.jobs.find(v => v[0] === id && v[1] === kind); return x ? { status: x[2], attempts: x[3], due_at: x[4], error: x[5] } : null; } }; };
const since = (st, n) => st.log.slice(n);

let c = null;
(async () => {
  try {
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Path Golf', setup: { completed: true, eulaAccepted: true }, unit: { id: UNIT },
      server: { port: 3156, businessName: 'Path Golf', adminPassword: 'path-owner-pw', timezone: 'America/Chicago' },
      booking: { staffedAccess: false, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, doorCodeLeadMins: 15, doorCodeLagMins: 15 },
      sms: { sendReminder: false, sendDoorCode: true, sendEndingWarning: false },
      resend: { apiKey: 're_path_battery', fromEmail: 'desk@path.example', sendDoorCode: true, sendReminder: false, sendEndingWarning: false },
      doorAccess: { provider: 'unifi' },
      unifiAccess: { host: '127.0.0.1:' + PORT, apiToken: TOKEN, apiStyle: 'documented', doorIds: ['door:door-front'], pinLength: 4 },
      bays: [{ id: 'up-b1', name: 'Bay One', active: true }, { id: 'up-b2', name: 'Bay Two', active: true }, { id: 'up-b3', name: 'Bay Three', active: true }]
    }, null, 2));
    c = await startConsole({ port: PORT, faults: { token: TOKEN } });
    // what is already at the console before the product runs (rule 22): the finished
    // session's code, the cancelled booking's code, one of ours whose create answer was
    // lost (no record here), and a contractor's visitor that is none of ours
    const ours = (id, bid, endAt) => ({ id, first_name: 'Golf', last_name: 'Guest', remarks: `BA:${UNIT} Booking ${bid}`, start_time: epoch(endAt) - 5400, end_time: epoch(endAt), resources: [{ id: 'door-front', type: 'door' }] });
    c.state.visitors['vis-ended'] = Object.assign(ours('vis-ended', 'up-ended', at(-25)), { pin: '4401' });
    c.state.visitors['vis-cancel'] = Object.assign(ours('vis-cancel', 'up-cancel', at(65)), { pin: '4402' });
    c.state.visitors['vis-lost'] = Object.assign(ours('vis-lost', 'up-lost', at(-185)), { pin: '4403' });
    c.state.visitors['vis-theirs'] = { id: 'vis-theirs', first_name: 'Dave', last_name: 'Contractor', remarks: 'HVAC service', end_time: epoch(at(-600)), pin: '4404' };
    const B = [
      { id: 'up-soon',   bay: 'up-b1', s: at(10),   e: at(70),   ref: '',                code: '' },     // its code is due now
      { id: 'up-later',  bay: 'up-b2', s: at(45),   e: at(105),  ref: '',                code: '' },     // its code is due in 30 minutes
      { id: 'up-ended',  bay: 'up-b2', s: at(-100), e: at(-40),  ref: 'unifi:vis-ended', code: '4401', sent: 1 },   // over 40 min ago: removal due
      { id: 'up-cancel', bay: 'up-b3', s: at(-10),  e: at(50),   ref: 'unifi:vis-cancel', code: '4402', sent: 1 },  // playing now; about to be cancelled
      { id: 'up-lost',   bay: 'up-b3', s: at(-260), e: at(-200), ref: '',                code: '', status: 'completed' }
    ];
    const rows = B.map(b => `db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,sms_consent,door_code,remotelock_person_id,sms_code_sent,created_at,updated_at) VALUES ('${b.id}','${b.bay}','Bay','Pat Path','+1555010060${B.indexOf(b)}','${b.id}@path.example','${ymd(b.s)}','${hm(b.s)}','${hm(b.e)}','${ymd(b.e)}',60,5000,'${b.status || 'active'}',1,${b.code ? `'${b.code}'` : 'NULL'},${b.ref ? `'${b.ref}'` : 'NULL'},${b.sent || 0},datetime('now','-1 day'),datetime('now','-1 day'))").run();`).join('');
    const seed = await run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').ensureSchema();${rows}await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
    ok('stage: five bookings seeded by a process that then exited; four visitors already at the console', seed.status === 0 && Object.keys(c.state.visitors).length === 4, seed.err.slice(-300));

    // ── 2. the console does not answer when the code is due ──
    console.log('── the console does not answer when a code is due ──');
    c.set({ down: true });
    let st0 = read(), n0 = st0.log.length;
    let t = await tick();
    let st = read();
    const soonJob = st.job('up-soon', 'door_code'), laterJob = st.job('up-later', 'door_code');
    ok('1a WHEN: the door-code job for a session starting in 10 minutes is due 15 minutes before its start', t.status === 0 && soonJob && Math.abs(Date.parse(soonJob.due_at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(soonJob.due_at) ? '' : 'Z')) - (at(10).getTime() - 15 * 60000)) < 61000, { soonJob, err: t.err.slice(-300) });
    ok('1b ...and a session 45 minutes out is not due yet: its job waits for 15 minutes before its own start, untried', laterJob && laterJob.attempts === 0 && laterJob.status === 'pending' && Math.abs(Date.parse(laterJob.due_at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(laterJob.due_at) ? '' : 'Z')) - (at(45).getTime() - 15 * 60000)) < 61000, laterJob);
    ok('2a with the console silent, no code exists for the session about to start - nothing recorded as a code, nothing sent to the customer', !st.bk['up-soon'].code && !st.bk['up-soon'].ref && !since(st, n0).some(l => /DRYRUN/.test(l.event) && /Pat Path|\+15550100600|up-soon@/.test(l.detail)), { bk: st.bk['up-soon'], log: since(st, n0).map(l => l.event) });
    ok('2b the failure is in the owner\'s log straight away, naming the door code and the booking', soonJob && soonJob.attempts === 1 && soonJob.status === 'pending' && since(st, n0).some(l => l.event === 'AUTOMATION_RETRY' && /door_code/.test(l.detail) && /up-soon/.test(l.detail)), { soonJob, log: since(st, n0).filter(l => /AUTOMATION|DOOR/.test(l.event)) });
    let h = await health();
    ok('2c ...and the Door codes line is RED now - an upcoming session has no working code and the lock did not answer - not green for the ~38 minutes of retries', h.level === 'red' || h.status === 'red' ? /do not have a working door code yet/.test(h.detail || h.text || '') && /lock did not answer/.test(h.detail || h.text || '') : false, h);

    // ── 3. the console does not answer when codes must be removed ──
    console.log('\n── the console does not answer when codes must be removed ──');
    ok('3a the finished session\'s code (40 minutes over, lag 15) was due for removal: tried, refused, still on record, still at the console', st.bk['up-ended'].ref === 'unifi:vis-ended' && st.job('up-ended', 'door_revoke') && st.job('up-ended', 'door_revoke').attempts >= 1 && !!c.state.visitors['vis-ended'], { bk: st.bk['up-ended'], job: st.job('up-ended', 'door_revoke') });
    ok('3b ...and the refusal is in the owner\'s log', since(st, n0).some(l => (l.event === 'DOOR_CODE_REVOKE_ERROR' && /vis-ended/.test(l.detail)) || (l.event === 'AUTOMATION_RETRY' && /door_revoke/.test(l.detail) && /up-ended/.test(l.detail))), since(st, n0).filter(l => /REVOKE|AUTOMATION/.test(l.event)));
    n0 = st.log.length;
    const cx = await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("UPDATE bookings SET status='cancelled' WHERE id='up-cancel'").run();const b=db.db.prepare("SELECT * FROM bookings WHERE id='up-cancel'").get();const r=await require('./services/doorlock').revokeOnCancel(b,'the owner');await db.flushed();db.flushSync();console.log('CANCEL '+JSON.stringify(r||null));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
    t = await tick();
    st = read();
    ok('3c the owner cancels a session in progress while the console is silent: the code stays on record and a removal is queued for now, not for the session\'s end', cx.status === 0 && st.bk['up-cancel'].ref === 'unifi:vis-cancel' && st.job('up-cancel', 'door_revoke') && st.job('up-cancel', 'door_revoke').attempts >= 1 && !!c.state.visitors['vis-cancel'], { out: cx.out.slice(-200), err: cx.err.slice(-200), job: st.job('up-cancel', 'door_revoke') });
    h = await health();
    ok('3d ...and the Door codes line is RED for the cancelled booking whose code is still live', (h.level === 'red' || h.status === 'red') && /CANCELLED/.test(h.detail || h.text || ''), h);

    // ── 4. the console comes back ──
    console.log('\n── the console comes back ──');
    c.set({ down: false });
    // the retry backoff is minutes long; move every retry to now (a clock that moved)
    await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("UPDATE automation_jobs SET next_attempt_at=datetime('now','-1 minute') WHERE booking_id LIKE 'up-%' AND status IN ('pending','failed')").run();await db.flushed();db.flushSync();process.exit(0)})`);
    n0 = read().log.length;
    const madeBefore = c.state.counters.visitorsCreated;
    t = await tick();
    st = read();
    const soon = st.bk['up-soon'];
    const vid = String(soon.ref || '').replace(/^unifi:/, '');
    const v = c.state.visitors[vid] || {};
    ok('4a the waiting code is created at the console as soon as it answers, and recorded against the booking', t.status === 0 && /^unifi:/.test(soon.ref) && /^\d{4}$/.test(soon.code) && v.pin === soon.code && c.state.counters.visitorsCreated === madeBefore + 1, { soon, v, err: t.err.slice(-300) });
    ok('4b WHEN IT WORKS: from 15 minutes before the start to 15 minutes after the end (the owner\'s lead and lag), on the front door', v.start_time === epoch(at(10 - 15)) && v.end_time === epoch(at(70 + 15)) && JSON.stringify(v.resources || []).includes('door-front'), { start: v.start_time, want: epoch(at(-5)), end: v.end_time, wantEnd: epoch(at(85)), res: v.resources });
    ok('4c the customer is sent the code by text and by email, and the owner\'s log has DOOR_CODE_CREATED', soon.sent === 1 && since(st, n0).some(l => l.event === 'SMS_DRYRUN' && /\+15550100600/.test(l.detail) && !/REFUSED/.test(l.detail)) && since(st, n0).some(l => l.event === 'EMAIL_DRYRUN' && /up-soon@path\.example/.test(l.detail)) && since(st, n0).some(l => l.event === 'DOOR_CODE_CREATED' && l.detail.includes(vid)), since(st, n0).map(l => l.event + ' ' + l.detail.slice(0, 60)));
    ok('4d the finished session\'s code is removed (forced, not merely cancelled) and its record cleared', !c.state.visitors['vis-ended'] && c.state.deleted.some(d => d.id === 'vis-ended' && d.force) && !st.bk['up-ended'].ref && st.job('up-ended', 'door_revoke').status === 'done', { bk: st.bk['up-ended'], job: st.job('up-ended', 'door_revoke') });
    ok('4e the cancelled booking\'s code is removed and its record cleared', !c.state.visitors['vis-cancel'] && c.state.deleted.some(d => d.id === 'vis-cancel' && d.force) && !st.bk['up-cancel'].ref && st.job('up-cancel', 'door_revoke').status === 'done', { bk: st.bk['up-cancel'], job: st.job('up-cancel', 'door_revoke') });
    ok('4f ...each removal written to the owner\'s log', ['vis-ended', 'vis-cancel'].every(id => since(st, n0).some(l => l.event === 'DOOR_CODE_REVOKED' && l.detail.includes(id))), since(st, n0).filter(l => /REVOKED/.test(l.event)));
    { const lines = since(st, n0).filter(l => l.event === 'DOOR_CODE_REVOKED' && /Booking: up-cancel/.test(l.detail));
      ok('4f2 ...and the cancelled session\'s line says the booking was cancelled - never "the session is over" for a session cut short (the review)', lines.length >= 1 && lines.every(l => /the booking was cancelled/.test(l.detail) && !/session is over/.test(l.detail)), lines); }
    h = await health();
    ok('4g the Door codes line is green again', (h.level || h.status) === 'green', h);
    ok('4h the session 45 minutes out still has nothing at the console - its code is not due for another half hour', !st.bk['up-later'].ref && st.job('up-later', 'door_code').attempts === 0 && !Object.values(c.state.visitors).some(x => /up-later/.test(String(x.remarks || ''))), st.job('up-later', 'door_code'));

    // ── 5. the nightly sweep ──
    console.log('\n── the nightly sweep ──');
    n0 = st.log.length;
    const sw = await nightly();
    st = read();
    const swr = (/SWEEP (.*)/.exec(sw.out) || [])[1]; const swj = swr ? JSON.parse(swr) : {};
    ok('5a a code of ours the unit has no live record of (its create answer was lost), three hours past its window, is removed by the nightly sweep', sw.status === 0 && !c.state.visitors['vis-lost'] && c.state.deleted.some(d => d.id === 'vis-lost' && d.force), { swj, err: sw.err.slice(-300) });
    ok('5b the contractor\'s visitor (not ours) and the code for the session about to start are untouched', !!c.state.visitors['vis-theirs'] && !!c.state.visitors[vid], Object.keys(c.state.visitors));
    ok('5c the owner\'s log has the night\'s line saying what was scanned, what was ours and what was removed', since(st, n0).some(l => l.event === 'UNIFI_VISITOR_SWEEP' && /removed 1/.test(l.detail) && /not ours 1/.test(l.detail)), since(st, n0).filter(l => /SWEEP/.test(l.event)));

    // ── 6. restarts ──
    console.log('\n── two more restarts ──');
    const made = c.state.counters.visitorsCreated, gone = c.state.deleted.length;
    await tick(); await nightly(); await tick(); await nightly();
    st = read();
    ok('6a two more ticks and two more nightly sweeps: no code created twice, nothing removed twice', c.state.counters.visitorsCreated === made && c.state.deleted.length === gone && st.bk['up-soon'].ref === soon.ref, { made: c.state.counters.visitorsCreated - made, gone: c.state.deleted.length - gone });

    // ── 7. a busy night ──
    console.log('\n── a busy night ──');
    const busy = [0, 1, 2, 3, 4, 5].map(i => ({ id: 'up-busy-' + i, bay: 'up-b' + (1 + (i % 3)), s: at(-5), e: at(40 + i), ref: 'unifi:vis-busy-' + i, code: '55' + (10 + i) }))
      .concat([{ id: 'up-busy-cx', bay: 'up-b1', s: at(-5), e: at(150), ref: 'unifi:vis-busy-cx', code: '5599' }]);
    for (const b of busy) c.state.visitors[b.ref.slice(6)] = Object.assign(ours(b.ref.slice(6), b.id, new Date(b.e.getTime() + 15 * 60000)), { pin: b.code });
    const rows7 = busy.map(b => `db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,sms_consent,door_code,remotelock_person_id,sms_code_sent,created_at,updated_at) VALUES ('${b.id}','${b.bay}','Bay','Pat Busy','+15550100699','','${ymd(b.s)}','${hm(b.s)}','${hm(b.e)}','${ymd(b.e)}',60,5000,'active',1,'${b.code}','${b.ref}',1,datetime('now','-1 day'),datetime('now','-1 day'))").run();`).join('');
    await run(`const db=require('./services/db');db.initDb().then(async()=>{${rows7}await db.flushed();db.flushSync();process.exit(0)})`);
    await tick();   // the tick schedules each live code's removal for its session's end
    c.set({ down: true });
    await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("UPDATE bookings SET status='cancelled' WHERE id='up-busy-cx'").run();const b=db.db.prepare("SELECT * FROM bookings WHERE id='up-busy-cx'").get();await require('./services/doorlock').revokeOnCancel(b,'the owner');await db.flushed();db.flushSync();process.exit(0)})`);
    c.set({ down: false });
    const gone7 = c.state.deleted.length;
    await tick();
    st = read();
    ok('7a one tick after the console is back, the CANCELLED booking\'s code is removed - it does not wait behind six live codes whose sessions are still playing', !c.state.visitors['vis-busy-cx'] && !st.bk['up-busy-cx'].ref, { cx: st.bk['up-busy-cx'], job: st.job('up-busy-cx', 'door_revoke'), deleted: c.state.deleted.slice(gone7).map(d => d.id) });
    ok('7b ...and not one of the six playing sessions lost its code', busy.slice(0, 6).every(b => !!c.state.visitors[b.ref.slice(6)] && st.bk[b.id].ref === b.ref), c.state.deleted.slice(gone7).map(d => d.id));

    // ── 8. a cancel the console takes at once (Oct 3 2026; the Yale, Oct 2: DOOR_CODE_REVOKED twice) ──
    console.log('\n── a cancel the console takes at once ──');
    const cx2 = { id: 'up-cx2', bay: 'up-b2', s: at(-5), e: at(20), ref: 'unifi:vis-cx2', code: '5601' };
    c.state.visitors['vis-cx2'] = Object.assign(ours('vis-cx2', cx2.id, new Date(cx2.e.getTime() + 15 * 60000)), { pin: cx2.code });
    await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,sms_consent,door_code,remotelock_person_id,sms_code_sent,created_at,updated_at) VALUES ('${cx2.id}','${cx2.bay}','Bay','Pat Twice','+15550100698','','${ymd(cx2.s)}','${hm(cx2.s)}','${hm(cx2.e)}','${ymd(cx2.e)}',25,5000,'active',1,'${cx2.code}','${cx2.ref}',1,datetime('now','-1 day'),datetime('now','-1 day'))").run();await db.flushed();db.flushSync();process.exit(0)})`);
    const n8 = read().log.length;
    const r8 = await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("UPDATE bookings SET status='cancelled' WHERE id='up-cx2'").run();const b=db.db.prepare("SELECT * FROM bookings WHERE id='up-cx2'").get();const r=await require('./services/doorlock').revokeOnCancel(b,'the owner');await db.flushed();db.flushSync();console.log('CANCEL '+JSON.stringify(r));process.exit(0)})`);
    st = read();
    ok('8a the owner cancels mid-session with the console answering: the code is removed at once and the booking lets go of it', r8.status === 0 && !c.state.visitors['vis-cx2'] && !st.bk['up-cx2'].ref && !st.bk['up-cx2'].code, { bk: st.bk['up-cx2'], out: r8.out.slice(-200) });
    // the session's own end plus the lag passes: nothing is removed a second time
    const t8 = await tickAt(new Date(cx2.e.getTime() + 21 * 60000).toISOString());
    st = read();
    const rev8 = since(st, n8).filter(l => l.event === 'DOOR_CODE_REVOKED' && /vis-cx2|up-cx2/.test(l.detail));
    ok('8b ...and when the session\'s end and the lag have passed, the sweep does not remove it again: one DOOR_CODE_REVOKED line, one removal at the console', t8.status === 0 && rev8.length === 1 && c.state.deleted.filter(d => d.id === 'vis-cx2').length === 1, { rev8, deleted: c.state.deleted.filter(d => d.id === 'vis-cx2').length, err: t8.err.slice(-200) });
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    if (c) { try { await c.stop(); } catch {} }
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  console.log(`\nUNIFI PATH: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
