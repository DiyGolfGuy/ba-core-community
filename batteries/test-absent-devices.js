// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-absent-devices.js — A FACILITY THAT DOES NOT OWN A DEVICE NEVER
//                          ACCUMULATES JOBS FOR IT (A-wave 4, Sep 11 2026)
//
// maintainer's question: on a facility with no IR (network TV control or nothing at
// all - example facility's case), what does the scheduler do with the IR legs? And the
// same for every device leg a facility may not have: Shelly, the door lock,
// wake-on-LAN / the PC, the printer, the card reader, texting, email.
// Proven here in the restart shape: for each facility shape, bookings seeded
// by a process that exits (one about to start, one just ended, one live),
// the scheduler run in a FRESH process, then again (a restart), then the job
// table read on disk and automation health read the way the route reads it:
// only the legs the facility owns appear, nothing is failed, nothing is
// overdue, health is green. The door lock was the dirty leg (a job for every
// unstaffed booking, failing on "RemoteLock not configured" - fail-first
// against the code before A-wave 4).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 320) : '')); } };
const root = __dirname;
const ENV = Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' });   // NO dry-run flags: the providers are simply absent, as on a real unit
// A-wave 12: this battery is about the devices a facility does NOT own, so the ones
// it DOES own must answer. It used to drive the real Shelly and BroadLink modules at
// unreachable 10.x addresses and assert "automation health reads green" - which held
// only because the scheduler threw every device answer away. Now that a refusal
// fails its job, the present devices get a stand-in that behaves like the real
// modules do when they work (services/shelly.js:28, broadlink.js:48,
// homeassistant.js:149, simulator.js:142).
const STUB = path.join(root, '.ad-device-stub.js');
fs.writeFileSync(STUB, `
const Module = require('module'); const orig = Module._load;
Module._load = function (req, parent) {
  const fromServices = parent && /[\\\\/]services[\\\\/]/.test(parent.filename || '');
  if (fromServices && req === './shelly') return Object.assign({}, orig.apply(this, arguments), { controlDevice: async (ip, gen, on) => ({ success: true, ip, action: on ? 'on' : 'off' }) });
  if (fromServices && req === './broadlink') return Object.assign({}, orig.apply(this, arguments), { sendCommand: async () => ({ success: true }) });
  // (Oct 2 2026, the cleanup audit: a whole-module Home Assistant stand-in stood here that always said yes and was
  // never reached - no shape configures a Home Assistant device. The real module loads, unconfigured: absent.)
  if (fromServices && req === './simulator') return Object.assign({}, orig.apply(this, arguments), {
    sendShutdown: async (bay) => (String((bay && bay.simulatorPcIp) || '').trim() ? true : { skipped: true, reason: 'no simulator PC is configured for this bay' }),
    wakePc: () => true });
  return orig.apply(this, arguments);
};
`);
process.on('exit', () => { try { fs.unlinkSync(STUB); } catch {} });
const oneShot = js => spawnSync(process.execPath, ['-r', STUB, '-e', js], { cwd: root, env: ENV, encoding: 'utf8', timeout: 180000 });
const tick = () => oneShot(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
const read = () => JSON.parse(oneShot(`const db=require('./services/db');db.initDb().then(()=>{const A=require('./services/automation');const h=A.health();const rows=db.db.prepare("SELECT booking_id,kind,device_key,status,COALESCE(last_error,'') AS why FROM automation_jobs WHERE booking_id LIKE 'ad-%'").all();console.log('READ '+JSON.stringify({ rows, health: { overdue: h.overdue, failed: h.failed.length, healthy: h.healthy, failedKinds: h.failed.map(f=>f.kind+':'+f.status) } }));process.exit(0)})`).stdout.split('\n').find(l => l.startsWith('READ ')).slice(5));
// every event a person would read as something having gone wrong
const logNoise = () => JSON.parse(oneShot(`require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec("SELECT event, COUNT(*) FROM admin_log WHERE (event LIKE '%_FAILED' OR event LIKE '%_ERROR' OR event LIKE '%NOT_CONFIGURED%') GROUP BY event");console.log(JSON.stringify(r.length?r[0].values.map(v=>v[0]+' x'+v[1]):[]));process.exit(0)})`).stdout.split('\n').filter(Boolean).pop() || '[]');
const logCount = ev => Number(oneShot(`require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec("SELECT COUNT(*) FROM admin_log WHERE event='${ev}'");console.log(r.length?r[0].values[0][0]:0);process.exit(0)})`).stdout.trim().split('\n').pop());

const SHAPES = [
  { name: 'nothing at all (unstaffed, no lock, no texting, no email, no devices, no PC) - example facility-like', cfg: { staffed: false, bays: [{ id: 'ad-b1', name: 'Bay One', active: true }] }, allowed: ['reminder', 'ending_warning'], never: ['door_code', 'door_revoke', 'ir_on', 'ir_off', 'power_on', 'power_off', 'shutdown'] },
  { name: 'IR absent, Shelly plug present (network TV or no TV control)', cfg: { staffed: false, bays: [{ id: 'ad-b1', name: 'Bay One', active: true, shellyDevices: [{ name: 'Plug', ip: '10.78.0.1', gen: 2, turnOffAfter: true, minutesAfter: 30 }] }] }, allowed: ['reminder', 'ending_warning', 'shutdown', 'power_on', 'power_off'], never: ['door_code', 'ir_on', 'ir_off'] },
  { name: 'staffed counter, nothing else', cfg: { staffed: true, bays: [{ id: 'ad-b1', name: 'Bay One', active: true }] }, allowed: ['reminder', 'ending_warning', 'shutdown'], never: ['door_code', 'ir_on', 'ir_off', 'power_on', 'power_off'] },
  { name: 'IR TV present, no Shelly, no PC, no lock', cfg: { staffed: false, bays: [{ id: 'ad-b1', name: 'Bay One', active: true, broadlinkDevices: [{ name: 'TV', ip: '10.78.0.2', onCommand: 'on', offCommand: 'off', codeStyle: 'discrete' }] }] }, allowed: ['reminder', 'ending_warning', 'shutdown', 'ir_on', 'ir_off'], never: ['door_code', 'power_on', 'power_off'] }
];

(async () => {
  const pad = n => String(n).padStart(2, '0');
  const hm = t => pad(t.getHours()) + ':' + pad(t.getMinutes());
  const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const at = m => new Date(Date.now() + m * 60000);
  for (const S of SHAPES) {
    console.log(`── ${S.name} ──`);
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Absent ' + S.name.slice(0, 12), setup: { completed: true, eulaAccepted: true },
      server: { port: 3001, businessName: 'Absent', adminPassword: 'absent-battery-pw' },
      booking: { staffedAccess: S.cfg.staffed, accessStyle: S.cfg.staffed ? 'staffed' : 'unmanned', pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true },
      // texting, email, the lock, the reader, the printer: ABSENT (the defaults a fresh unit ships with)
      bays: S.cfg.bays
    }, null, 2));
    const B = [
      { id: 'ad-soon', s: at(8), e: at(68), ago: 0 },     // starts in 8 min: every "before start" leg is due
      { id: 'ad-ended', s: at(-100), e: at(-40), ago: 180 },  // ended 40 min ago: every "after end" leg is due
      { id: 'ad-live', s: at(-30), e: at(30), ago: 60 }    // live now
    ];
    const seed = oneShot(`const db=require('./services/db');db.initDb().then(()=>{for (const b of ${JSON.stringify(B.map(b => ({ id: b.id, date: ymd(b.s), st: hm(b.s), et: hm(b.e), ed: ymd(b.e), ago: b.ago })))}) db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,'active',datetime('now', ?))").run(b.id,'ad-b1','Bay One','Absent '+b.id,'5558400001','a@example.com',b.date,b.st,b.et,b.ed,'-'+b.ago+' minutes');db.flushSync();process.exit(0)})`);
    const t1 = tick(); const t2 = tick();   // a fresh process, then a restart
    const r = read();
    const kinds = [...new Set(r.rows.map(x => x.kind))].sort();
    const bad = r.rows.filter(x => S.never.includes(x.kind));
    const failed = r.rows.filter(x => x.status === 'failed' || (x.status === 'pending' && x.why));
    ok(`${S.name}: across a restart, only the legs the facility owns appear (${kinds.join(', ') || 'none'})`, seed.status === 0 && t1.status === 0 && t2.status === 0 && bad.length === 0 && kinds.every(k => S.allowed.includes(k)), { kinds, bad: bad.map(x => x.kind), err: (t1.stderr || '').slice(-160) });
    ok(`${S.name}: nothing failed and nothing is overdue - automation health reads green`, failed.length === 0 && r.health.overdue === 0 && r.health.failed === 0 && r.health.healthy === true, { failed: failed.map(x => x.kind + ':' + x.status + ':' + x.why.slice(0, 40)), health: r.health });
    ok(`${S.name}: the legs the facility does own finished (done or skipped with a reason), never left pending past their time`, r.rows.filter(x => x.booking_id !== 'ad-live' && ['reminder', 'door_code', 'power_on', 'ir_on', 'shutdown', 'power_off', 'ir_off'].includes(x.kind) && x.status === 'pending').every(x => x.booking_id === 'ad-soon' && ['shutdown', 'power_off', 'ir_off', 'ending_warning'].includes(x.kind)), r.rows.map(x => x.booking_id + ' ' + x.kind + ':' + x.status));
    if (!S.cfg.staffed) ok(`${S.name}: no texting provider means the reminder leg completes quietly (the job is never red)`, r.rows.filter(x => x.kind === 'reminder' && x.status === 'failed').length === 0);
    const noise = logNoise();
    ok(`${S.name}: RULE 31 - a unit with nothing configured is SILENT: not one error in the owner's log (no SMS_FAILED, no EMAIL_*, no SHUTDOWN_FAILED, no AUTOMATION_FAILED), because absent is not failed`,
       noise.length === 0, noise.slice(0, 6));
  }
  ok('the printer and the card reader are not automation legs at all: no job kind exists for them anywhere in the scheduler', !/kind: '(print|receipt|reader|terminal)/.test(fs.readFileSync(path.join(root, 'services', 'scheduler.js'), 'utf8')));
  ok('the scheduler asks whether a lock is configured before it schedules a door code (RemoteLock client id or UniFi host + token, never a PASTE placeholder)', /function lockConfigured\(cfg\)/.test(fs.readFileSync(path.join(root, 'services', 'scheduler.js'), 'utf8')) && /&& lockConfigured\(cfg\)\)/.test(fs.readFileSync(path.join(root, 'services', 'scheduler.js'), 'utf8')));
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  console.log(`\nABSENT DEVICES: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\nABSENT DEVICES: ${pass} passed, ${fail + 1} failed`); process.exit(1); });
