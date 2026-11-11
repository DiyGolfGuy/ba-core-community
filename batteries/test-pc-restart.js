// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-pc-restart.js - RESTART THE BAY PC BEFORE THE NEXT GROUP (maintainer, Oct 2 2026).
//
// maintainer: "Someone has a booking ... and no booking till 1:30 the bay blocker thing comes on. Then 10 min
// before the 1:30 tee time the PC restarts to put the new people back to the main menu. If someone has
// a tee time from 1-3 and next one starts at 3 then the PC stays on and the next group jumps in. If
// there is a tee time from 1-3 and next booking at 4 the bay powers down at 3." And: "people can book
// right up to the last second." So the restart is a job on the NEXT booking, 10 minutes before its
// start, made only when the PC STAYED ON through a gap before it (inside the keep-on window, or with
// auto-shutdown off), and re-checked when it fires. The real services/simulator.js runs end to end: a
// stand-in `net` on the PATH records the command and can refuse it; stand-in PCs answer the network
// probe on loopback addresses (no listener = switched off). Rule 22's shape: the bookings are in the
// table first, every scheduler pass is a fresh process, a second pass restarts nothing twice, a refused
// restart is retried (rule 29), a PC that is off is not a failure (rule 31).
// Oct 3 2026 (maintainer: "even if the next T time is the next day ... 10 min before the next Tee time even the next
// day the bay will restart fully"): whatever the gap, the restart is decided when it fires - a PC that is
// ON behind the reserved screen is restarted, one that is off is left to wake fresh (not logged: the ordinary
// case). The stand-in PCs are their own processes, and one that takes a shutdown goes OFF (the stand-in
// `net` stops it) - it used to keep answering the probe, which no real PC does.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };
const root = __dirname;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-pc-restart-'));
const NETLOG = path.join(WORK, 'net.log'), REFUSE = path.join(WORK, 'refuse');
const PORT = 3189;
const IP = { b1: '127.0.0.21', b2: '127.0.0.22', b3: '127.0.0.23', b4: '127.0.0.24', b5: '127.0.0.25', b6: '127.0.0.26', b7: '127.0.0.27', b8: '127.0.0.28', b9: '127.0.0.29', b10: '127.0.0.30', b11: '127.0.0.31', b12: '127.0.0.32', b13: '127.0.0.33' };

// the stand-in `net`: records every call, refuses for an address listed in REFUSE (as net rpc fails), and a
// PC that takes a SHUTDOWN (not a restart -r, not a cancel -a) goes off: its process is stopped before
// net returns, so the next probe finds nothing - as a real PC that shut down
fs.writeFileSync(path.join(WORK, 'net'), `#!/bin/sh
echo "$*" >> ${JSON.stringify(NETLOG)}
for a in "$@"; do if [ -f ${JSON.stringify(REFUSE)} ] && grep -qx -- "$a" ${JSON.stringify(REFUSE)}; then echo "Connection to $a failed (Error NT_STATUS_ACCESS_DENIED)" >&2; exit 1; fi; done
case " $* " in *" -r "*|*" -a "*) ;; *" shutdown "*)
  ip=""; prev=""; for a in "$@"; do [ "$prev" = "-I" ] && ip="$a"; prev="$a"; done
  pf=${JSON.stringify(WORK)}/pc-$ip.pid
  if [ -n "$ip" ] && [ -f "$pf" ]; then p=$(cat "$pf"); rm -f "$pf"; kill "$p" 2>/dev/null; while kill -0 "$p" 2>/dev/null; do sleep 0.05; done; fi;;
esac
exit 0
`, { mode: 0o755 });
const ENV = Object.assign({}, process.env, { PATH: WORK + ':' + process.env.PATH, BA_PC_PROBE_PORT: String(PORT), SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
const netCalls = () => { try { return fs.readFileSync(NETLOG, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const callsFor = ip => netCalls().filter(l => l.includes(' -I ' + ip + ' '));

// a fresh process per database touch, never waiting synchronously on it (the PCs live in this process)
const run = js => new Promise(res => { const c = spawn(process.execPath, ['-e', js], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('exit', code => res({ code, out, err })); });
// every bay's watcher checks in (as it does every half minute, to the same server the scheduler runs in) and
// says its reserved screen is UP through the gap (guard=1, 15 and 3 minutes ago) - except b8's PC, which runs
// no watcher (nothing reported), and b10's, where staff pressed Ctrl+Shift+F12 five minutes ago (guard=0)
const WATCHING = ['b1', 'b2', 'b3', 'b4', 'b5', 'b7', 'b9', 'b10', 'b11', 'b12', 'b13'];   // not b6: its PC is off, and an off PC reports nothing (the review's stand-in reader, Oct 3)
const tick = () => run(`const db=require('./services/db');db.initDb().then(async()=>{const bp=require('./services/baypresence'),n=Date.now();
  bp.note('b13','0',${minute - 20 * 60000 + 60000});   // b13's session ended at minute-20: its watcher's first poll a minute after that still saw no screen
  for(const b of ${JSON.stringify(WATCHING)}){bp.note(b,'1',n-15*60000);bp.note(b,b==='b10'?'0':'1',n-5*60000);bp.note(b,'1',n-3*60000);}
  await require('./services/scheduler').checkBookings();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
const read = async () => { const r = await run(`const db=require('./services/db');db.initDb().then(()=>{const D=db.db;
  console.log('OUT '+JSON.stringify({ rows: D.prepare("SELECT id, shutdown_sent FROM bookings WHERE id LIKE 'pr-%'").all(),
    jobs: D.prepare("SELECT booking_id, kind, status, attempts FROM automation_jobs WHERE kind IN ('shutdown','pc_restart') AND booking_id LIKE 'pr-%'").all(),
    log: D.prepare("SELECT event, detail FROM admin_log WHERE event LIKE 'RESTART%' OR event LIKE 'SHUTDOWN%' OR event LIKE 'PC_RESTART%' ORDER BY id").all() }));process.exit(0)})`);
  const m = /OUT (.*)/.exec(r.out); return m ? JSON.parse(m[1]) : { rows: [], jobs: [], log: [], err: r.err.slice(-300) }; };
const row = (s, id) => s.rows.find(r => r.id === id) || {};
const job = (s, id, kind = 'pc_restart') => s.jobs.find(j => j.booking_id === id && j.kind === kind) || {};
const logFor = (s, bay) => s.log.filter(e => String(e.detail).includes('Bay: Bay ' + bay.slice(1) + ' '));   // the log names the bay, not its id

const pad = n => String(n).padStart(2, '0');
const hm = t => pad(t.getHours()) + ':' + pad(t.getMinutes());
const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const minute = Math.floor(Date.now() / 60000) * 60000;
const at = m => new Date(minute + m * 60000);
const stage = (restart, shutdownOn = true, keepDb = false) => {   // restart undefined: no setting saved - the product's default
  for (const f of keepDb ? ['config.json'] : ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Restart Test', setup: { completed: true, eulaAccepted: true },
    server: { port: 3001, businessName: 'Restart Test', adminPassword: 'restart-pw' },
    booking: { staffedAccess: true, open24Hours: true, pricePerHalfHour: 25 },
    automation: { keepOnGapMins: 30 },
    shutdown: { enabled: shutdownOn, restart },
    sms: { sendReminder: false, sendDoorCode: false, sendEndingWarning: false, sendConfirmation: false },
    bays: Object.entries(IP).map(([id, ip]) => ({ id, name: 'Bay ' + id.slice(1), active: true, simulatorPcIp: ip, simulatorWinUser: 'Admin', simulatorWinPass: 'pc-pass' }))
  }, null, 2));
};
const seed = (rows) => run(`const db=require('./services/db');db.initDb().then(()=>{
  for (const r of ${JSON.stringify(rows)}) db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,datetime('now','-2 hours'))")
    .run(r.id, r.bay, 'Bay ' + r.bay.slice(1), 'Restart ' + r.id, '5550001111', '', r.date, r.st, r.et, r.ed, r.dur, r.status || 'active');
  for (const r of ${JSON.stringify(rows)}.filter(x => x.shutdownDone)) {   // existing state: this session's shutdown was SKIPPED at its end (a next booking was inside the keep-on window then)
    require('./services/automation').ensureSchema();
    db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,status,attempts,created_at) VALUES (?,'shutdown','',datetime('now','-100 minutes'),'done',0,datetime('now','-2 hours'))").run(r.id);
    db.db.prepare("UPDATE bookings SET shutdown_sent=1 WHERE id=?").run(r.id);
  }
  db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
const booking = (id, bay, startIn, mins) => { const s = at(startIn), e = at(startIn + mins); return { id, bay, date: ymd(s), st: hm(s), et: hm(e), ed: ymd(e), dur: mins }; };

(async () => {
  // the PCs that are switched on answer the network probe; b3's is off
  const pcs = [];
  const startPc = b => new Promise((res, rej) => {
    const c = spawn(process.execPath, ['-e', `const s=require('net').createServer(c=>c.destroy());s.on('error',e=>{console.error(e.message);process.exit(1)});s.listen(${PORT},'${IP[b]}',()=>{require('fs').writeFileSync(${JSON.stringify(path.join(WORK, 'pc-'))}+'${IP[b]}.pid',String(process.pid));console.log('UP')})`], { stdio: ['ignore', 'pipe', 'pipe'] });
    pcs.push(c); c.stdout.once('data', () => res(c)); c.on('exit', code => { if (code) rej(new Error('PC ' + b + ' could not listen')); });
  });
  for (const b of ['b1', 'b2', 'b3', 'b4', 'b5', 'b7', 'b8', 'b9', 'b10', 'b11', 'b12', 'b13']) await startPc(b);
  const restarts = ip => callsFor(ip).filter(l => / -r /.test(' ' + l + ' '));
  try {
    // ── the next group starts in 10 minutes on every bay; what came before differs ──
    stage(true);
    fs.writeFileSync(REFUSE, IP.b7 + '\n');
    const sd = await seed([
      booking('pr-1', 'b1', -80, 60), booking('pr-1-next', 'b1', 10, 60),    // ended 20 min ago, next at +10: a 30-minute gap - KEPT ON, restart now
      booking('pr-2', 'b2', -50, 60), booking('pr-2-next', 'b2', 10, 60),    // ends exactly as the next starts: back to back - the next group steps in
      booking('pr-3', 'b3', -110, 60), booking('pr-3-next', 'b3', 10, 60),   // ended 50 min ago: outside the keep-on window - shut down at its end
      booking('pr-5', 'b5', -80, 60), booking('pr-5-gap', 'b5', -20, 30), booking('pr-5-next', 'b5', 10, 60),   // the gap was booked (more time): playing now
      booking('pr-6', 'b6', -80, 60), booking('pr-6-next', 'b6', 10, 60),    // kept on, but the PC is switched off
      booking('pr-7', 'b7', -80, 60), booking('pr-7-next', 'b7', 10, 60),    // kept on, the PC refuses the restart
      booking('pr-4', 'b4', -80, 60), booking('pr-4-late', 'b4', 3, 60),     // a booking made 3 minutes before its start: too late to restart
      booking('pr-8', 'b8', -80, 60), booking('pr-8-next', 'b8', 10, 60),    // kept on, but NO watcher runs on that PC: the reserved screen never came up
      booking('pr-9', 'b9', -60, 60), booking('pr-9-next', 'b9', 10, 60),    // a 10-minute gap: the watcher never covers the bay for that
      booking('pr-10', 'b10', -80, 60), booking('pr-10-next', 'b10', 10, 60), // kept on, but staff took the reserved screen down mid-gap
      // maintainer's case (Oct 3): the shutdown at the end was SKIPPED for a next booking that was then cancelled, so the PC
      // stayed on behind the reserved screen for two hours - far past the keep-on window
      Object.assign(booking('pr-11', 'b11', -170, 60), { shutdownDone: true }), Object.assign(booking('pr-11-gone', 'b11', -80, 60), { status: 'cancelled' }), booking('pr-11-next', 'b11', 10, 60),
      booking('pr-12-next', 'b12', 10, 60),                                    // the next tee time is the first one booked on the bay (the next day, say): the PC is on
      booking('pr-13', 'b13', -80, 60), booking('pr-13-next', 'b13', 10, 60)  // kept on; the watcher's first poll after the session (before it drew the screen) said "down"
    ]);
    ok('the bookings are in the table before any scheduler runs', sd.code === 0, sd.err.slice(-300));
    const t1 = await tick(); let s = await read();
    ok('a fresh process runs the scheduler over them and exits clean', t1.code === 0, t1.err.slice(-300));
    ok('1:00-3:00, next at 3:30: the PC stayed on through the gap and is RESTARTED 10 minutes before the next tee time - net rpc shutdown -r, RESTART_SENT, the job done',
       restarts(IP.b1).length === 1 && /^rpc shutdown -r -f -I 127\.0\.0\.21 /.test(restarts(IP.b1)[0]) && logFor(s, 'b1').some(e => e.event === 'RESTART_SENT') && job(s, 'pr-1-next').status === 'done',
       { calls: callsFor(IP.b1), log: logFor(s, 'b1'), job: job(s, 'pr-1-next') });
    // the line the wake check reads to tell a restart from a fault (test-wake-devices W9 plants it by hand): written by the
    // restart itself, in the shape that reader matches ('% | Booking: <id> | %') - the review, Oct 3 2026
    ok('...and the owner\'s log has PC_RESTART_BEFORE_GROUP naming the booking in the shape the wake check reads ("| Booking: pr-1-next |")',
       s.log.some(e => e.event === 'PC_RESTART_BEFORE_GROUP' && String(e.detail).includes(' | Booking: pr-1-next | ')), s.log.filter(e => /RESTART/.test(e.event)).slice(0, 6));
    ok('...and at the first session\'s end the PC was NOT shut down - the next group was inside the keep-on window',
       callsFor(IP.b1).length === 1 && logFor(s, 'b1').some(e => e.event === 'SHUTDOWN_SKIPPED' && /Next within 30min/.test(e.detail)), logFor(s, 'b1'));
    ok('back to back (next starts as this one ends): no restart and no job - the next group steps straight in',
       restarts(IP.b2).length === 0 && !job(s, 'pr-2-next').status, { calls: callsFor(IP.b2), job: job(s, 'pr-2-next') });
    // (Oct 3: the restart is decided when it fires, so the job exists; the PC it finds is off)
    ok('next tee time an hour after the end: the PC was SHUT DOWN at the end (no -r) and is not restarted - it is off, and wakes fresh; nothing in the owner\'s log about a restart',
       restarts(IP.b3).length === 0 && callsFor(IP.b3).length === 1 && /^rpc shutdown -f -I 127\.0\.0\.23 /.test(callsFor(IP.b3)[0]) && !logFor(s, 'b3').some(e => /^RESTART/.test(e.event)),
       { calls: callsFor(IP.b3), job: job(s, 'pr-3-next'), log: logFor(s, 'b3') });
    ok('somebody booked the gap (more time, right up to the last second): it is back to back now - no restart, and their game is never touched',
       restarts(IP.b5).length === 0, { calls: callsFor(IP.b5), log: logFor(s, 'b5') });
    // (Oct 3: a PC that is off is the ordinary case once the restart is asked before every group - not logged)
    ok('a PC that is switched off: nothing to clear, nothing sent, NOT a failure (rule 31) - and no line in the owner\'s log',
       callsFor(IP.b6).length === 0 && !logFor(s, 'b6').some(e => /^RESTART/.test(e.event)) && job(s, 'pr-6-next').status === 'done',
       { log: logFor(s, 'b6'), job: job(s, 'pr-6-next') });
    ok('maintainer\'s case: the shutdown was skipped for a next booking that was then cancelled, so the PC stayed on behind the reserved screen for two hours - it is RESTARTED 10 minutes before the next tee time, a clean slate',
       restarts(IP.b11).length === 1 && logFor(s, 'b11').some(e => e.event === 'RESTART_SENT') && job(s, 'pr-11-next').status === 'done',
       { calls: callsFor(IP.b11), log: logFor(s, 'b11'), job: job(s, 'pr-11-next') });
    ok('the watcher\'s first poll a minute after the session ended (before it drew the reserved screen) is not "taken down" - the first 90 seconds are not counted, and the PC is restarted',
       restarts(IP.b13).length === 1 && !logFor(s, 'b13').some(e => e.event === 'RESTART_SKIPPED'), { calls: callsFor(IP.b13), log: logFor(s, 'b13') });
    ok('...and the next day too: the first tee time booked on a bay whose PC is on behind the reserved screen is restarted 10 minutes before',
       restarts(IP.b12).length === 1 && job(s, 'pr-12-next').status === 'done', { calls: callsFor(IP.b12), job: job(s, 'pr-12-next') });
    ok('a PC that refuses the restart: the job FAILS and retries, and the owner\'s log says so (rule 29)',
       restarts(IP.b7).length === 1 && job(s, 'pr-7-next').status !== 'done' && logFor(s, 'b7').some(e => e.event === 'RESTART_ERROR'),
       { job: job(s, 'pr-7-next'), log: logFor(s, 'b7') });
    // ...and the Automation line names it in words (Oct 3 2026): it printed the job's raw key, "restart:pr-b7"
    { const hr = await run(`const db=require('./services/db');db.initDb().then(()=>{const a=(require('./services/unithealth').compute().signals||[]).find(x=>x.key==='automation')||{};console.log('A '+JSON.stringify(a));process.exit(0)})`);
      const a = (() => { try { return JSON.parse((/A (.*)/.exec(hr.out) || [])[1]); } catch { return {}; } })();
      ok('...and the Automation line says it in words - "a simulator PC did not take its restart" - never the job\'s raw key', /did not take its restart before the next group/.test(a.detail || '') && !/restart:/.test(a.detail || ''), a); }
    ok('a booking made 3 minutes before its start: too late to restart - no job, nothing sent (the group may be standing there)',
       restarts(IP.b4).length === 0 && !job(s, 'pr-4-late').status, { calls: callsFor(IP.b4), job: job(s, 'pr-4-late') });
    ok('no bay watcher reporting on the PC (none running, or one built before October 2026): the PC is LEFT AS IT IS - said in the owner\'s log',
       restarts(IP.b8).length === 0 && logFor(s, 'b8').some(e => e.event === 'RESTART_SKIPPED' && /has not reported the reserved screen/.test(e.detail)), { calls: callsFor(IP.b8), log: logFor(s, 'b8') });
    ok('staff took the reserved screen down mid-gap (the kill code - someone may be playing): the PC is LEFT AS IT IS - said in the owner\'s log',
       restarts(IP.b10).length === 0 && logFor(s, 'b10').some(e => e.event === 'RESTART_SKIPPED' && /taken down on that PC during the gap/.test(e.detail)), { calls: callsFor(IP.b10), log: logFor(s, 'b10') });
    ok('a gap of 10 minutes or less: the watcher never put the reserved screen up - no restart, no job',
       restarts(IP.b9).length === 0 && !job(s, 'pr-9-next').status, { calls: callsFor(IP.b9), job: job(s, 'pr-9-next') });
    const t2 = await tick(); s = await read();
    ok('a second process: nothing is restarted twice', t2.code === 0 && restarts(IP.b1).length === 1 && restarts(IP.b11).length === 1 && restarts(IP.b12).length === 1 && restarts(IP.b2).length === 0 && restarts(IP.b5).length === 0, { b1: restarts(IP.b1).length, b11: restarts(IP.b11).length });
    // the start moves n minutes nearer (its due time with it) and the backoff has elapsed: "n minutes later"
    const nearer = n => run(`const db=require('./services/db');db.initDb().then(()=>{const b=db.db.prepare("SELECT date,start_time FROM bookings WHERE id='pr-7-next'").get();const t=new Date(b.date+'T'+b.start_time+':00');t.setMinutes(t.getMinutes()-${n});const p=n=>String(n).padStart(2,'0');db.db.prepare("UPDATE bookings SET start_time=? WHERE id='pr-7-next'").run(p(t.getHours())+':'+p(t.getMinutes()));db.db.prepare("UPDATE automation_jobs SET next_attempt_at=datetime('now','-1 minute') WHERE booking_id='pr-7-next' AND kind='pc_restart'").run();db.flushSync();process.exit(0)})`);
    // THE RETRY IS SENT (the review, Oct 3 2026): a minute after the refusal (nine minutes before the start, a few seconds
    // in) its retry goes - it used to be written off on that very tick, so no refused restart was ever retried
    await nearer(1);
    { const tR = await tick(); s = await read();
      ok('a refused restart gets its ONE retry a minute later, nine minutes before the start - sent, not written off on that tick',
         tR.code === 0 && restarts(IP.b7).length === 2 && job(s, 'pr-7-next').status !== 'missed', { calls: restarts(IP.b7).length, job: job(s, 'pr-7-next') }); }
    fs.unlinkSync(REFUSE);
    // Oct 3 2026 (the pack review; pilot facility's guide - "not retried into the session: the PC answered, so the group still has a
    // working PC"): the reserved screen lifted at the ten minutes and the next group may be setting up - the refusal had its
    // retry, and once its window has passed (seven minutes before) it is recorded as missed, never sent into the session
    await run(`const db=require('./services/db');db.initDb().then(()=>{const b=db.db.prepare("SELECT date,start_time FROM bookings WHERE id='pr-7-next'").get();const t=new Date(b.date+'T'+b.start_time+':00');t.setMinutes(t.getMinutes()-2);const p=n=>String(n).padStart(2,'0');db.db.prepare("UPDATE bookings SET start_time=? WHERE id='pr-7-next'").run(p(t.getHours())+':'+p(t.getMinutes()));db.db.prepare("UPDATE automation_jobs SET next_attempt_at=datetime('now','-1 minute') WHERE booking_id='pr-7-next' AND kind='pc_restart'").run();db.flushSync();process.exit(0)})`);
    const t3 = await tick(); s = await read();
    ok('a refused restart whose retry window has passed is NOT retried into the session (the PC answered; the next group may be setting up) - it is recorded as missed, for the owner',
       t3.code === 0 && restarts(IP.b7).length === 2 && job(s, 'pr-7-next').status === 'missed',
       { calls: restarts(IP.b7).length, job: job(s, 'pr-7-next') });

    // ── auto-shutdown OFF: the PC stays on through ANY gap, so an hour's gap is restarted too ──
    stage(true, false);
    try { fs.unlinkSync(NETLOG); } catch {}
    await startPc('b3');   // shut down in the first part; on again
    await seed([booking('pr-8', 'b3', -110, 60), booking('pr-8-next', 'b3', 10, 60)]);
    const t4 = await tick(); s = await read();
    ok('auto-shutdown off: an hour\'s gap left the PC on, so it is restarted before the next group (and nothing was shut down)',
       t4.code === 0 && restarts(IP.b3).length === 1 && callsFor(IP.b3).length === 1, callsFor(IP.b3));

        // ── shut-down mode: a session still running on the bay when the last one ends - the PC is never shut down under it ──
    // (the real drive for what test-race-cluster only copied: scheduler.js's activeNow re-check at fire time)
    stage(false);
    try { fs.unlinkSync(NETLOG); } catch {}
    await seed([booking('pr-a', 'b6', -61, 60), booking('pr-a-over', 'b6', -10, 60)]);   // overlapping: someone is on the bay right now
    await startPc('b6');
    const t6 = await tick(); s = await read();
    ok('shut-down mode, a session running on the bay as the last one ends: no shutdown is sent - SHUTDOWN_SKIPPED "a session is active"',
       t6.code === 0 && callsFor(IP.b6).length === 0 && logFor(s, 'b6').some(e => e.event === 'SHUTDOWN_SKIPPED' && /A session is active on this bay right now/.test(e.detail)),
       { calls: callsFor(IP.b6), log: logFor(s, 'b6') });

// ── the restart switched off by the owner: nothing new happens ──
    stage(false);
    try { fs.unlinkSync(NETLOG); } catch {}
    await seed([booking('pr-9', 'b1', -80, 60), booking('pr-9-next', 'b1', 10, 60)]);
    const t5 = await tick(); s = await read();
    ok('the restart switched off by the owner: no restart job, nothing sent - the facility runs as it always did',
       t5.code === 0 && restarts(IP.b1).length === 0 && !job(s, 'pr-9-next').status, { calls: callsFor(IP.b1), jobs: s.jobs });

    // ── switched off with restarts already queued: settled, never left overdue (Oct 3 2026, the pack review) ──
    stage(true);
    try { fs.unlinkSync(NETLOG); } catch {}
    await seed([booking('pr-q', 'b1', -80, 60), booking('pr-q-next', 'b1', 40, 60)]);   // its restart is due in 30 minutes: queued now
    await tick(); s = await read();
    const queued = job(s, 'pr-q-next').status;
    stage(false, true, true);                                                            // the owner switches it off; the bookings stay
    const t7 = await tick(); s = await read();
    ok('switched off with a restart already queued: the queued restart is settled (skipped, saying why) - never left to go overdue and turn Automation red with "restart the unit"',
       t7.code === 0 && queued === 'pending' && job(s, 'pr-q-next').status === 'skipped' && restarts(IP.b1).length === 0, { queued, job: job(s, 'pr-q-next') });

    // ── no setting saved (every unit this pack reaches): the restart is ON (maintainer, Oct 3 2026: "ON by default") ──
    stage(undefined);
    try { fs.unlinkSync(NETLOG); } catch {}
    await startPc('b1');   // shut down at the end of the session above (its next was an hour off); on again, behind the reserved screen
    await seed([booking('pr-d', 'b1', -80, 60), booking('pr-d-next', 'b1', 10, 60)]);
    const t8 = await tick(); s = await read();
    ok('no setting saved - the product\'s own default: the restart is ON, and the PC left on behind the reserved screen is restarted before the next group',
       t8.code === 0 && restarts(IP.b1).length === 1 && job(s, 'pr-d-next').status === 'done', { calls: callsFor(IP.b1), job: job(s, 'pr-d-next') });
  } catch (e) {
    fail++; console.log('FAIL  the battery crashed: ' + (e && e.stack || e));
  } finally {
    for (const c of pcs) { try { c.kill(); } catch {} }
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nPC RESTART: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
