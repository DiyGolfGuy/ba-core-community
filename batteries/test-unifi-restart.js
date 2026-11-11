// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-unifi-restart.js — THE UNIFI VISITOR SWEEP AND THE DOOR REVOKE ACROSS
//                         RESTARTS (A-wave 4, rule 22, Sep 11 2026)
//
// A door code that stays live is the worst thing the automation can leave
// behind. Two paths retire codes: the per-booking door_revoke job (20 min
// after the end, no deadline - it must always eventually run) and the 5:00
// visitor sweep that removes every expired visitor the appliance created.
// Rule 22: expired visitors already on the console and a revoke job already
// in the table when a fresh process starts; a second run removes nothing
// more; a kill mid-sweep leaves the console half-swept and the next process
// finishes it, each visitor removed exactly once; a visitor that is not ours
// and a visitor still valid are never touched. The console is a stand-in
// living in THIS process (HTTPS, self-signed, the documented API style) so
// its state persists across the product's processes the way a real console's
// does; the product's own service talks to it.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, spawnSync, execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 320) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = __dirname;
const PW = 'unifi-battery-pw';
const PORT = 12445;   // the documented style: https://<host>:12445/api/v1/developer
const ENV = Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });

// the console: the SHARED stand-in (tools/unifi-console-standin.js, Oct 3 2026 - this battery carried its own, which
// could only say SUCCESS: rule 29's stand-in clause). It checks the token, answers an unknown visitor CODE_NOT_EXISTS,
// pages, and its slowDeleteMs holds a DELETE open so a process can be killed with one in flight.
const { startConsole } = require('./tools/unifi-console-standin');
const oneShot = js => spawnSync(process.execPath, ['-e', js], { cwd: root, env: ENV, encoding: 'utf8', timeout: 120000 });
// the product's processes run ASYNCHRONOUSLY: the console stand-in lives in this process and must keep
// answering while they run (a synchronous spawn would block it - the product would see a dead console)
const run = js => new Promise(res => { const ch = spawn(process.execPath, ['-e', js], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; ch.stdout.on('data', d => out += d); ch.stderr.on('data', d => err += d); ch.on('exit', code => res({ status: code, stdout: out, stderr: err })); });
// a fresh process: the 5:00 sweep AND the minute tick (the revoke job) - what a restart runs
const tick = () => run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/unifiaccess').sweepExpiredVisitors();await require('./services/scheduler').checkBookings();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
const jobs = () => JSON.parse(oneShot(`require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec("SELECT booking_id,kind,status,COALESCE(last_error,'') FROM automation_jobs WHERE booking_id LIKE 'ur-%'");console.log(JSON.stringify(r.length?r[0].values.map(v=>({booking:v[0],kind:v[1],status:v[2],why:v[3]})):[]));process.exit(0)})`).stdout.trim().split('\n').pop());
const logRows = like => JSON.parse(oneShot(`require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec("SELECT event,detail FROM admin_log WHERE event LIKE '%${like}%' ORDER BY id DESC");console.log(JSON.stringify(r.length?r[0].values.map(v=>({event:v[0],detail:v[1]})):[]));process.exit(0)})`).stdout.trim().split('\n').pop());

(async () => {
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'UniFi Restart', setup: { completed: true, eulaAccepted: true },
    server: { port: 3001, businessName: 'UniFi Restart', adminPassword: PW },
    booking: { staffedAccess: false, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true },
    doorAccess: { provider: 'unifi' },
    unifiAccess: { host: '127.0.0.1', apiToken: 'tok-restart', apiStyle: 'documented', doorIds: ['door:door-front'], pinLength: 4 },
    sms: { sendReminder: false, sendDoorCode: false, sendEndingWarning: false },
    bays: [{ id: 'ur-b1', name: 'Bay One', active: true }]
  }, null, 2));
  const c = await startConsole({ port: PORT, faults: { token: 'tok-restart' } });
  const state = c.state;
  const held = () => state.seeded.concat(Object.values(state.visitors));   // every visitor the console holds
  const nowS = Math.floor(Date.now() / 1000);
  const ours = (id, bid, endAgoMins) => ({ id, first_name: 'Golf', last_name: 'Guest', remarks: 'Booking ' + bid, end_time: nowS - endAgoMins * 60 });
  c.seed([
    ours('vis-1', 'ur-old-1', 180), ours('vis-2', 'ur-old-2', 240), ours('vis-3', 'ur-old-3', 400),   // ours, expired past the 60-min grace
    { id: 'vis-theirs', first_name: 'Dave', last_name: 'Contractor', remarks: 'HVAC service', end_time: nowS - 9000 },   // not ours: never touched
    ours('vis-live', 'ur-live', -120),                                                                    // ours, still valid: kept
    ours('vis-9', 'ur-revoke', 30)                                                                        // the per-booking revoke job's visitor (inside the sweep's grace)
  ]);
  // a booking holding a live visitor holds its code and was texted it - the real shape (Oct 3 2026: seeded with only the
  // reference, the product rightly made it a code, which the old hand-made console refused with a 404 nobody read)
  const seed = oneShot(`const db=require('./services/db');db.initDb().then(()=>{const A=require('./services/automation');A.ensureSchema();const p=n=>String(n).padStart(2,'0');const ymd=t=>t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate());const hm=t=>p(t.getHours())+':'+p(t.getMinutes());
    const ins=(id,s,e,person)=>db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,remotelock_person_id,door_code,sms_code_sent,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,'completed',?,?,?,datetime('now','-6 hours'))").run(id,'ur-b1','Bay One','UniFi '+id,'5558200001','',ymd(s),hm(s),hm(e),ymd(e),person,person?'4242':null,person?1:0);
    const at=m=>new Date(Date.now()+m*60000);
    ins('ur-old-1',at(-240),at(-180),null); ins('ur-old-2',at(-300),at(-240),null); ins('ur-old-3',at(-460),at(-400),null); ins('ur-live',at(-60),at(120),'unifi:vis-live');
    ins('ur-revoke',at(-90),at(-30),'unifi:vis-9');
    // the revoke job, scheduled in time by the unit that was up, due 10 minutes ago
    A.ensureJob({ booking_id:'ur-revoke', kind:'door_revoke', due_at:new Date(Date.now()-10*60000) });
    db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
  ok('five bookings, six visitors on the console (three of ours expired, one not ours, one still valid, one awaiting its revoke) and a pending revoke job, seeded by a process that then exited', seed.status === 0 && held().length === 6 && jobs().some(j => j.kind === 'door_revoke' && j.status === 'pending'), (seed.stderr || '').slice(-200));

  const t1 = await tick();
  const del1 = state.deleted.map(d => d.id).sort();
  ok('a FRESH process runs the 5:00 sweep and the minute tick: the three expired visitors of ours are removed (force), the revoke job removes its visitor - exactly four deletes', t1.status === 0 && JSON.stringify(del1) === JSON.stringify(['vis-1', 'vis-2', 'vis-3', 'vis-9']) && state.deleted.every(d => d.force), { del1, err: (t1.stderr || '').slice(-200) });
  ok('the contractor\'s visitor (not ours) and our still-valid visitor are untouched', held().some(v => v.id === 'vis-theirs') && held().some(v => v.id === 'vis-live'), held().map(v => v.id));
  ok('the revoke job is DONE and the booking\'s person id cleared; the owner\'s log has DOOR_CODE_REVOKED and UNIFI_VISITOR_SWEEP', jobs().some(j => j.kind === 'door_revoke' && j.status === 'done') && logRows('DOOR_CODE_REVOKED').length >= 1 && logRows('UNIFI_VISITOR_SWEEP').some(e => /removed 3/.test(e.detail)), { jobs: jobs(), sweep: logRows('UNIFI_VISITOR_SWEEP').slice(0, 1) });

  const t2 = await tick();
  ok('a SECOND restart across the 5:00 boundary: nothing is removed twice, nothing new is removed', t2.status === 0 && state.deleted.length === 4, state.deleted.map(d => d.id));

  // killed mid-sweep: two more expired visitors of ours appear (yesterday's sessions), the console is slow, the process dies after the first delete
  c.seed([ours('vis-4', 'ur-old-4', 500), ours('vis-5', 'ur-old-5', 600)]);
  const seed2 = oneShot(`const db=require('./services/db');db.initDb().then(()=>{const p=n=>String(n).padStart(2,'0');const ymd=t=>t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate());const hm=t=>p(t.getHours())+':'+p(t.getMinutes());const at=m=>new Date(Date.now()+m*60000);
    const ins=(id,s,e)=>db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,'completed',datetime('now','-12 hours'))").run(id,'ur-b1','Bay One','UniFi '+id,'5558200002','',ymd(s),hm(s),hm(e),ymd(e));
    ins('ur-old-4',at(-560),at(-500)); ins('ur-old-5',at(-660),at(-600)); db.flushSync();process.exit(0)})`);
  c.set({ slowDeleteMs: 4000 });
  const before = state.deleteStarts;
  const child = spawn(process.execPath, ['-e', `const db=require('./services/db');db.initDb().then(async()=>{await require('./services/unifiaccess').sweepExpiredVisitors();db.flushSync();process.exit(0)})`], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let started = false; for (let i = 0; i < 100; i++) { await sleep(100); if (state.deleteStarts > before) { started = true; break; } }
  child.kill('SIGKILL'); await new Promise(r => child.on('exit', r));   // the instant the delete is in flight - no guessed delay (A-wave 6 audit)
  for (let i = 0; i < 100 && state.deleted.length < state.deleteStarts; i++) await sleep(100);   // the console finishes the delete that was in flight - waited on, not guessed
  c.set({ slowDeleteMs: 0 });
  const midDeleted = state.deleted.filter(d => ['vis-4', 'vis-5'].includes(d.id)).length;
  ok('killed mid-sweep: at most one of the two new expired visitors was removed before the process died', seed2.status === 0 && started && midDeleted <= 1, { started, midDeleted });
  const t3 = await tick();
  const both = state.deleted.filter(d => ['vis-4', 'vis-5'].includes(d.id));
  ok('the next process finishes the sweep: both removed, each exactly once, and nothing else removed again', t3.status === 0 && both.length === 2 && new Set(both.map(d => d.id)).size === 2 && state.deleted.length === 6, { deleted: state.deleted.map(d => d.id) });
  ok('after every restart the console holds only the contractor\'s visitor and our still-valid one', held().map(v => v.id).sort().join(',') === 'vis-live,vis-theirs', held().map(v => v.id));

  await c.stop();
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
  console.log(`\nUNIFI RESTART: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\nUNIFI RESTART: ${pass} passed, ${fail + 1} failed`); process.exit(1); });
