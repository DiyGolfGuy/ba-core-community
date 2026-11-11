// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-wake-devices.js - A PC THAT DID NOT WAKE, AND A PLUG THAT DROPPED OFF, ARE SAID
//                        (Sep 25 2026, maintainer's Monday pack item 6 and the automation re-checks)
//   W  Wake-on-LAN: "WOL sent" is not "the PC came up" (pilot facility). A few minutes after the packet
//      the unit asks the PC (the port-445 probe) - up: PC_UP; not up: woken again, the check
//      retries, the Automation line says so at once and the owner is told; back: it clears.
//      A bay with no PC address and no watcher cannot be checked: said, never a failure.
//   W8 a PC address the wake cannot use (a mistyped MAC - Oct 3 2026, the cleanup audit: the stand-in
//      could only say yes): the wake is recorded as NOT taken and never as PC_WAKE, it retries, and the
//      unit never claims the PC came up
//   S  a Shelly plug unplugged between sessions: the two-minute probe writes DEVICE_UNREACHABLE
//      once, the Automation line names the plug, and it clears on its own when the plug is back
// The PC and the plug are stand-ins in THIS process; every product process is spawned
// asynchronously so they keep answering, and the ticks run on a fake clock.
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };
const root = __dirname;
const PCPORT = 3197, PLUGPORT = 3198;
const CALLS = path.join(root, '.wd-calls.jsonl');
const STUB = path.join(root, '.wd-stub.js');
fs.writeFileSync(STUB, `
const fs = require('fs'); const Module = require('module'); const orig = Module._load;
Module._load = function (req, parent) {
  if (parent && /services/.test(parent.filename || '') && req === './simulator') {
    const real = orig.apply(this, arguments);
    // the real wakePc's shape (rule 29): SYNCHRONOUS, false for an address it cannot use - only the broadcast is left out
    return Object.assign({}, real, { wakePc: (mac) => { fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify({ wake: mac, at: new Date().toISOString() }) + '\\n'); return String(mac || '').replace(/[^0-9a-fA-F]/g, '').length === 12; } });
  }
  return orig.apply(this, arguments);
};
`);
const pad = n => String(n).padStart(2, '0');
const d1 = new Date(); d1.setDate(d1.getDate() + 1);
const DAY = `${d1.getFullYear()}-${pad(d1.getMonth() + 1)}-${pad(d1.getDate())}`;
const at = hm => `${DAY}T${hm}:00`;
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_PC_PROBE_PORT: String(PCPORT), BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
const run = (js, fake) => new Promise(res => {
  const ch = spawn(process.execPath, ['-r', STUB, '-r', './tools/fake-clock.js', '-e', js], { cwd: root, env: Object.assign({}, ENV, { BA_FAKE_NOW: fake }), stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = ''; ch.stdout.on('data', d => o += d); ch.stderr.on('data', d => e += d); ch.on('exit', code => res({ status: code, out: o, err: e }));
});
const END = `await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`;
const tick = fake => run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();${END}`, fake);
const health = async fake => { const r = await run(`const db=require('./services/db');db.initDb().then(async()=>{console.log('H '+JSON.stringify((require('./services/unithealth').compute().signals||[]).find(s=>s.key==='automation')||{}));process.exit(0)})`, fake); const m = /H (.*)/.exec(r.out); try { return JSON.parse(m[1]); } catch { return { none: (r.out + r.err).slice(-300) }; } };
const logOf = async (ev, fake) => { const r = await run(`const db=require('./services/db');db.initDb().then(async()=>{console.log('L '+JSON.stringify(db.db.prepare("SELECT event,detail FROM admin_log WHERE event IN (${ev.map(e => "'" + e + "'").join(',')}) ORDER BY id").all()));process.exit(0)})`, fake); const m = /L (.*)/.exec(r.out); try { return JSON.parse(m[1]); } catch { return []; } };
const wakes = () => { try { return fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const writeCfg = extra => fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(Object.assign({
  businessName: 'Wake Golf', setup: { completed: true, eulaAccepted: true },
  server: { port: 3160, businessName: 'Wake Golf', adminPassword: 'wake-owner-pw', timezone: 'America/Chicago' },
  booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, pcWakeMinutesBefore: 10 },
  automation: { pcBootCheckMins: 5 },
  contact: { email: 'owner@wake.example' }, alerts: { ownerMobile: '+15550100902' },
  sms: { sendReminder: false, sendEndingWarning: false }, resend: { apiKey: 're_wake_battery', fromEmail: 'desk@wake.example', sendReminder: false, sendEndingWarning: false },
  bays: [{ id: 'wd-b1', name: 'Bay One', active: true, pcMac: 'AA:BB:CC:DD:EE:01', simulatorPcIp: '127.0.0.1' },
         { id: 'wd-b2', name: 'Bay Two', active: true, pcMac: 'AA:BB:CC:DD:EE:02' }]
}, extra || {}), null, 2));

let pc = null, plug = null;
const pcUp = () => new Promise(r => { pc = net.createServer(s => s.destroy()); pc.listen(PCPORT, '127.0.0.1', r); });
const pcDown = () => new Promise(r => { if (!pc) return r(); pc.close(() => r()); pc = null; });
const plugUp = () => new Promise(r => { plug = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify({ 'switch:0': { output: false } })); }); plug.listen(PLUGPORT, '127.0.0.1', r); });
const plugDown = () => new Promise(r => { if (!plug) return r(); plug.close(() => r()); plug = null; });

(async () => {
  try {
    for (const f of ['config.json', 'bookings.db', CALLS]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
    writeCfg();
    const rows = [['wd-1', 'wd-b1', '10:00', '11:00'], ['wd-2', 'wd-b1', '12:00', '13:00'], ['wd-3', 'wd-b2', '14:00', '15:00']];
    const seed = await run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').ensureSchema();for(const [id,bay,s,e] of ${JSON.stringify(rows)}) db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,'active',datetime('now'),datetime('now'))").run(id,bay,'Bay','Pat Wake','','','${DAY}',s,e,'${DAY}');${END}`, at('08:00'));
    ok('stage: two bays with a simulator PC (Bay One with its address, Bay Two with none), three bookings', seed.status === 0, seed.err.slice(-300));

    console.log('── W. Wake-on-LAN ──');
    await pcUp();
    await tick(at('09:51'));
    await tick(at('09:57'));
    let log = await logOf(['PC_UP', 'PC_UP_UNCHECKED', 'OWNER_ALERT'], at('09:58'));
    ok('W1 woken at 09:50; five minutes later the PC answers on the network: PC_UP in the owner\'s log', wakes() === 1 && log.some(l => l.event === 'PC_UP' && /Booking: wd-1/.test(l.detail)), { wakes: wakes(), log });
    await pcDown();
    await tick(at('11:51'));
    const t = await tick(at('11:57'));
    log = await logOf(['PC_UP', 'OWNER_ALERT', 'AUTOMATION_RETRY'], at('11:57'));
    ok('W2 the PC does NOT answer five minutes after its wake: it is woken AGAIN and the check retries - the owner is NOT texted yet (a PC a minute slow to boot texts nobody)', wakes() === 3 && !log.some(l => l.event === 'PC_UP' && /wd-2/.test(l.detail)) && log.some(l => l.event === 'AUTOMATION_RETRY' && /pc_check/.test(l.detail) && /wd-2/.test(l.detail)) && !log.some(l => l.event === 'OWNER_ALERT'), { wakes: wakes(), log, err: t.err.slice(-300) });
    await tick(`${DAY}T11:58:30`);
    log = await logOf(['OWNER_ALERT'], at('11:59'));
    ok('W2b ...the retry a minute later still finds nothing: NOW the owner is texted and emailed, naming the bay', log.some(l => l.event === 'OWNER_ALERT' && /pc-down:wd-b1/.test(l.detail) && /text: sent/.test(l.detail) && /email: sent/.test(l.detail)), { wakes: wakes(), log });
    let h = await health(at('11:59'));
    ok('W3 ...and the Automation line says so AT ONCE - not after every retry has run out', h.level === 'amber' && /simulator PC did not come up/.test(h.detail || ''), h);
    await pcUp();
    await tick(at('12:01'));
    log = await logOf(['PC_UP'], at('12:01'));
    h = await health(at('12:02'));
    ok('W4 the PC answers on the retry: PC_UP, and the line is green again', log.some(l => /wd-2/.test(l.detail)) && h.level === 'green', { h, log });
    await tick(at('13:51'));
    await tick(at('13:57'));
    log = await logOf(['PC_UP_UNCHECKED', 'AUTOMATION_RETRY'], at('13:57'));
    h = await health(at('13:58'));
    ok('W5 a bay with no PC address and no watcher seen: the wake cannot be checked - said once in the log, never a failure', log.some(l => l.event === 'PC_UP_UNCHECKED' && /Bay Two/.test(l.detail)) && !log.some(l => l.event === 'AUTOMATION_RETRY' && /wd-3/.test(l.detail)) && !/Bay Two|wd-3/.test(h.detail || ''), { log, h });

    // a WHOLE-FACILITY booking drives every bay: every bay's PC is woken and each one checked (the
    // build review - the job was keyed per booking, so only the first bay's PC was ever woken)
    await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,whole_facility,created_at,updated_at) VALUES ('wd-4','wd-b1','Whole facility','Pat Rental','','','${DAY}','16:00','17:00','${DAY}',60,50000,'active',1,datetime('now'),datetime('now'))").run();${END}`, at('15:00'));
    const w0 = wakes();
    await tick(at('15:51'));
    const macs = (() => { try { return fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).slice(w0).map(l => JSON.parse(l).wake); } catch { return []; } })();
    await tick(at('15:57'));
    log = await logOf(['PC_UP', 'PC_UP_UNCHECKED'], at('15:57'));
    ok('W6 a whole-facility booking wakes EVERY bay\'s PC - and checks each: Bay One answers, Bay Two (no address) is said to be unchecked', macs.includes('AA:BB:CC:DD:EE:01') && macs.includes('AA:BB:CC:DD:EE:02') && log.some(l => l.event === 'PC_UP' && /Bay One/.test(l.detail) && /wd-4/.test(l.detail)) && log.some(l => l.event === 'PC_UP_UNCHECKED' && /Bay Two/.test(l.detail) && log.filter(x => x.event === 'PC_UP_UNCHECKED').length >= 2), { macs, log: log.slice(-4) });

    // the PC does not answer on the network (file sharing off) but its bay watcher is asking the unit
    // for its session: that is up (the build review - this path had no test)
    await pcDown();
    await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES ('wd-5','wd-b1','Bay One','Pat Watch','','','${DAY}','18:00','19:00','${DAY}',60,5000,'active',datetime('now'),datetime('now'))").run();${END}`, at('17:00'));
    await tick(at('17:51'));
    await run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/baypresence').note('wd-b1');require('./services/baypresence').note('no-such-bay');console.log('SEEN '+require('./services/baypresence').lastSeen('no-such-bay'));await require('./services/scheduler').checkBookings();${END}`, at('17:57'));
    log = await logOf(['PC_UP', 'OWNER_ALERT'], at('17:57'));
    ok('W7 the PC does not answer on the network, but its bay watcher asked the unit since the wake: PC_UP, "its watcher is asking the unit" - no second wake, no alert', log.some(l => l.event === 'PC_UP' && /wd-5/.test(l.detail) && /watcher is asking/.test(l.detail)) && !log.some(l => l.event === 'OWNER_ALERT' && /wd-5|17:5/.test(l.detail)), log.slice(-3));

    // W8: a bay whose MAC was mistyped (ten hex digits) - the real wakePc answers false
    writeCfg({ bays: [{ id: 'wd-b1', name: 'Bay One', active: true, pcMac: 'AA:BB:CC:DD:EE:01', simulatorPcIp: '127.0.0.1' },
                      { id: 'wd-b2', name: 'Bay Two', active: true, pcMac: 'AA:BB:CC:DD:EE:02' },
                      { id: 'wd-b9', name: 'Bay Nine', active: true, pcMac: 'AA:BB:CC:DD:EE', simulatorPcIp: '127.0.0.1' }] });
    await run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES ('wd-9','wd-b9','Bay Nine','Pat Wake','','','${DAY}','19:00','20:00','${DAY}',60,5000,'active',datetime('now'),datetime('now'))").run();${END}`, at('18:30'));
    await tick(at('18:51'));
    await tick(at('18:57'));
    const w8 = await run(`const db=require('./services/db');db.initDb().then(()=>{console.log('J '+JSON.stringify({ job: db.db.prepare("SELECT status, attempts, COALESCE(last_error,'') AS e FROM automation_jobs WHERE booking_id='wd-9' AND kind='power_on'").get() || null, led: db.db.prepare("SELECT ok, detail FROM device_commands WHERE device='pc:AA:BB:CC:DD:EE' ORDER BY id").all(), log: db.db.prepare("SELECT event FROM admin_log WHERE detail LIKE '%wd-9%' OR detail LIKE '%Bay Nine%'").all().map(r => r.event) }));process.exit(0)})`, at('18:58'));
    const j8 = (() => { try { return JSON.parse((/J (.*)/.exec(w8.out) || [])[1]); } catch { return null; } })() || {};
    ok('W8 a mistyped PC address: the wake is recorded as NOT taken, the job is not done and says why, and neither PC_WAKE nor PC_UP is written - the unit never claims a PC it could not wake', !!j8.job && j8.job.status !== 'done' && /did not answer/.test(j8.job.e) && (j8.led || []).length > 0 && j8.led.every(r => r.ok === 0) && !(j8.log || []).includes('PC_WAKE') && !(j8.log || []).includes('PC_UP'), j8);

    // W9 (Oct 3 2026, the pack review): the restart before the next group and the wake fire in the same minute - after a
    // restart, the "did it come up" check waits for the session's start (a restart can run Windows updates), not five minutes
    await run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').ensureSchema();db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES ('wd-10','wd-b1','Bay One','Pat Wake','','','${DAY}','19:30','20:30','${DAY}',60,5000,'active',datetime('now'),datetime('now'))").run();db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,status,attempts,fired_at,created_at) VALUES ('wd-10','pc_restart','restart:wd-b1',datetime('now'),'done',0,datetime('now'),datetime('now'))").run();db.adminLog('PC_RESTART_BEFORE_GROUP','Bay: Bay One | Booking: wd-10 | restarted 10 minutes before the group');${END}`, at('19:19'));
    await tick(at('19:21'));
    const w9 = await run(`const db=require('./services/db');db.initDb().then(()=>{console.log('J '+JSON.stringify(db.db.prepare("SELECT due_at FROM automation_jobs WHERE booking_id='wd-10' AND kind='pc_check'").get()||null));process.exit(0)})`, at('19:22'));
    const due9 = (() => { try { const j = JSON.parse((/J (.*)/.exec(w9.out) || [])[1]); return j && new Date(String(j.due_at).replace(' ', 'T') + 'Z'); } catch { return null; } })();
    ok('W9 after a restart for the group, the "did it come up" check is due at the session start (19:30) - not five minutes after the wake, while Windows may still be updating', !!due9 && String(due9.getHours()).padStart(2, '0') + ':' + String(due9.getMinutes()).padStart(2, '0') === '19:30', { due: due9 && due9.toString() });

    console.log('\n── S. a plug unplugged between sessions ──');
    // a fresh unit for this part: part W's own unfinished jobs must not colour the line
    try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
    writeCfg({ bays: [{ id: 'wd-b1', name: 'Bay One', active: true, shellyDevices: [{ name: 'Plug One', ip: '127.0.0.1:' + PLUGPORT, gen: 2 }] }] });
    await plugUp();
    const probe = fake => run(`const db=require('./services/db');db.initDb().then(async()=>{console.log('P '+JSON.stringify(await require('./services/deviceprobe').probe({force:true})));${END}`, fake);
    let p = await probe(at('15:00'));
    ok('S1 the plug answers the two-minute check: nothing written', /"down":0/.test(p.out) && !(await logOf(['DEVICE_UNREACHABLE'], at('15:00'))).length, p.out.slice(-200));
    await plugDown();
    p = await probe(at('15:02'));
    await probe(at('15:04'));
    log = await logOf(['DEVICE_UNREACHABLE'], at('15:04'));
    h = await health(at('15:05'));
    ok('S2 unplugged: DEVICE_UNREACHABLE written ONCE across two checks, naming the plug and its bay', log.length === 1 && /Plug One \(Bay One\)/.test(log[0].detail), log);
    ok('S3 ...and the Automation line names it - no session had to find it first', h.level === 'amber' && /smart plug\(s\) not answering/.test(h.detail || '') && /Plug One/.test(h.detail || ''), h);
    await plugUp();
    await probe(at('15:06'));
    log = await logOf(['DEVICE_BACK'], at('15:06'));
    h = await health(at('15:07'));
    ok('S4 plugged back in: DEVICE_BACK, and the line clears on its own', log.length === 1 && h.level === 'green', { log, h });
    // an old failed job on the line must not hide a plug that drops off NOW (the build review: the
    // plug was the last branch of the chain, so any failed reminder or test job replaced its name)
    await run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').ensureSchema();db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,next_attempt_at,status,attempts,last_error) VALUES ('wd-old','reminder','',datetime('now','-3 hours'),datetime('now','-3 hours'),'failed',6,'no answer')").run();${END}`, at('15:08'));
    await plugDown();
    await probe(at('15:10')); await probe(at('15:12'));
    h = await health(at('15:13'));
    ok('S5 a failed reminder from earlier on the line AND the plug unplugged now: the line still names the plug', h.level === 'amber' && /smart plug\(s\) not answering/.test(h.detail || '') && /Plug One/.test(h.detail || ''), h);
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    await pcDown(); await plugDown();
    for (const f of ['config.json', 'bookings.db', CALLS, STUB]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
  }
  console.log(`\nWAKE AND DEVICES: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
