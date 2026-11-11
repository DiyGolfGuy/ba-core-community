// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-device-independence.js - ONE DEVICE NEVER STOPS ANOTHER, AND NOTHING IS LEFT WAITING (Oct 21 2026)
//
// maintainer: "a facility automation cant fail because one device does not respond. if a defice happens to be down or doing an update
// the other automations can not fail ... if a thermostate or facility tv does not turn on the bay still needs to do all its
// stuff. or if a spot light is missed then it still does everything else. unless one thing relies on the other". The device
// audit of the same day found where that did not hold, and this holds each fix:
//   A  a bay PC that takes the connection and never answers held up every later booking in the minute (runCmd had no time
//      limit); a Home Assistant device that refuses never stops a plug
//   B  a switch-off its booking's own pass no longer reaches - a device removed, a bay taken out of service, a device set to
//      stay on - sat "overdue" for ever (the health line red), and the heater on a bay taken out of service was never
//      switched off; a switch-on for a bay dark on purpose read as missed
//   C  a timing change never reached a job already waiting for today or tomorrow
//   D  at closing, a whole-facility booking shut down one bay's PC
//   E  the guards read the tick's start time: a switch-off that came due while a slow tick ran skipped them and switched a
//      plug off under the next group
//   F  Auto-Shutdown switched off after the day's shutdowns were made: the sweep shut the PCs down anyway (the review, Oct 24)
// Rule 22's shape: every tick a fresh process reading the bookings and the job table on disk, the clock pinned per tick
// (tools/fake-clock.js), seeded rows already in the table. The stand-ins can refuse and hang: a `net` that never answers, a
// plug slow enough to carry the tick past another device's due time, tools/homeassistant-standin.js.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const HA_PORT = 18197, PC_PORT = 18198;
const PW = 'independence-battery-pw';
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-di-bin-'));
const NET_LOG = path.join(BIN, 'net.log'), NET_HANG = path.join(BIN, 'hang');
const CALLS = path.join(root, '.di-plug-calls.log');
const STUB = path.join(root, '.di-plug-stub.js');
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// tomorrow, a calendar day (never n x 24 hours): every moment below is a time on it
const T = new Date(), DAY = ymd(new Date(T.getFullYear(), T.getMonth(), T.getDate() + 1, 12));
const at = (hm) => `${DAY}T${hm}:00`;

// the fake `net` the PC commands run: records its -I address, and never answers while the hang file exists
fs.writeFileSync(path.join(BIN, 'net'), `#!/bin/sh\nip=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-I" ]; then ip="$2"; fi; shift; done\necho "$ip" >> "${NET_LOG}"\nif [ -f "${NET_HANG}" ]; then sleep 60; fi\nexit 0\n`, { mode: 0o755 });
// the plugs: the real Shelly module with controlDevice recorded; the plug at 10.88.1.9 takes three minutes (the fake clock moves)
fs.writeFileSync(STUB, `
const fs = require('fs'); const Module = require('module'); const orig = Module._load;
Module._load = function (req, parent) {
  if (parent && /[\\\\/]services[\\\\/]/.test(parent.filename || '') && req === './broadlink') {
    const real = orig.apply(this, arguments);
    return Object.assign({}, real, { sendCommand: async (ip, cmd) => { fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify({ ip, op: 'ir:' + cmd, at: new Date().toISOString() }) + '\\n'); return { success: true }; } });
  }
  if (parent && /[\\\\/]services[\\\\/]/.test(parent.filename || '') && req === './shelly') {
    const real = orig.apply(this, arguments);
    return Object.assign({}, real, { controlDevice: async (ip, gen, on) => {
      if (ip === '10.88.1.9' && global.__baFakeClock) global.__baFakeClock.set(new Date(Date.now() + 180000).toISOString());
      fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify({ ip, op: on ? 'on' : 'off', at: new Date().toISOString() }) + '\\n');
      return { success: true, ip, action: on ? 'on' : 'off' };
    } });
  }
  return orig.apply(this, arguments);
};
`);
const ENV = Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent', BA_WATCHDOG_OFF: '1', BA_UPDATE_LIST_URL: 'off',
  PATH: BIN + path.delimiter + process.env.PATH, BA_PC_PROBE_PORT: String(PC_PORT), BA_PC_CMD_TIMEOUT_MS: '1500' });
// a child that talks to the stand-ins in this process: never spawnSync
const child = (js, fakeNow, timeoutMs = 60000) => new Promise(res => {
  const t0 = Date.now();
  const c = spawn(process.execPath, ['-r', STUB, '-r', './tools/fake-clock.js', '-e', js], { cwd: root, env: Object.assign({}, ENV, { BA_FAKE_NOW: fakeNow }) });
  let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
  let killed = false; const t = setTimeout(() => { killed = true; c.kill('SIGKILL'); }, timeoutMs);
  c.on('close', code => { clearTimeout(t); res({ code, out, err, killed, ms: Date.now() - t0 }); });
});
const TICK = `const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e&&e.stack||e);process.exit(1)})`;
const dbRun = (sqls, fakeNow) => child(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').ensureSchema();for(const q of ${JSON.stringify(sqls)})db.db.prepare(q).run();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`, fakeNow);
const rows = async (sql) => { const r = await child(`require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`, at('00:00')); try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return { error: r.err.slice(-300) }; } };
const job = async (booking, kind, key) => ((await rows(`SELECT status, COALESCE(last_error,''), attempts, due_at FROM automation_jobs WHERE booking_id='${booking}' AND kind='${kind}' AND device_key='${key}'`))[0] || [null]);
const plugCalls = () => { try { return fs.readFileSync(CALLS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const netCalls = () => { try { return fs.readFileSync(NET_LOG, 'utf8').split('\n').filter(Boolean); } catch { return []; } };

(async () => {
  for (const f of ['config.json', 'bookings.db', CALLS]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
  const pc = net.createServer(s => s.on('error', () => {})); await new Promise(r => pc.listen(PC_PORT, '0.0.0.0', r));   // the PCs answer port "445"
  const { startHA, DEFAULT_FAULTS } = require('./tools/homeassistant-standin');
  const H = await startHA({ port: HA_PORT, entities: [
    { entity_id: 'switch.bay3_heater', state: 'on', attributes: { friendly_name: 'Bay Three Heater' } },
    { entity_id: 'fan.bay2_fan', state: 'off', attributes: { friendly_name: 'Bay Two Fan' } } ] });
  H.set(Object.assign({}, DEFAULT_FAULTS, { failEntities: ['fan.bay2_fan'] }));
  const plug = (name, ip, extra) => Object.assign({ name, ip, gen: 2, minutesBefore: 10, turnOffAfter: true, minutesAfter: 10 }, extra || {});
  const cfg = {
    businessName: 'Independence', setup: { completed: true, eulaAccepted: true }, server: { port: 3001, businessName: 'Independence', adminPassword: PW },
    booking: { staffedAccess: true, openTime: '06:00', closeTime: '23:00', open24Hours: false, windowDays: 30, pricePerHalfHour: 20 },
    automation: { keepOnGapMins: 30 }, shutdown: { enabled: true },
    homeAssistant: { enabled: true, url: `http://127.0.0.1:${HA_PORT}`, token: 'ha-test-token' },
    bays: [
      { id: 'd1', name: 'Bay One', active: true, simulatorPcIp: '127.0.0.1', simulatorWinUser: 'Admin', simulatorWinPass: 'pc-pass' },
      { id: 'd2', name: 'Bay Two', active: true, shellyDevices: [plug('Plug Two', '10.88.0.2')], haDevices: [{ entity_id: 'fan.bay2_fan', name: 'Bay Two Fan', kind: 'power', minutesBefore: 10, turnOffAfter: true, minutesAfter: 10 }] },
      { id: 'd3', name: 'Bay Three', active: true, maintenance: true, haDevices: [{ entity_id: 'switch.bay3_heater', name: 'Bay Three Heater', kind: 'power', minutesBefore: 10, turnOffAfter: true, minutesAfter: 10 }] },
      { id: 'd4', name: 'Bay Four', active: true, shellyDevices: [plug('Plug Four', '10.88.0.4')] },
      { id: 'd6', name: 'Bay Six', active: true },
      { id: 'd7', name: 'Bay Seven', active: true, shellyDevices: [plug('Plug Seven', '10.88.0.7', { turnOffAfter: false })] },
      { id: 'd8', name: 'Bay Eight', active: true, simulatorPcIp: '127.0.0.2', simulatorWinUser: 'Admin', simulatorWinPass: 'pc-pass' },
      { id: 'd9', name: 'Bay Nine', active: true, shellyDevices: [plug('Plug Nine', '10.88.1.9')] },
      { id: 'd10', name: 'Bay Ten', active: true, shellyDevices: [plug('Plug Ten', '10.88.1.10', { minutesAfter: 2 })] },
      // a TV on a one-button (toggle) code, on a bay out of service
      { id: 'd11', name: 'Bay Eleven', active: true, maintenance: true, broadlinkDevices: [{ name: 'TV Eleven', ip: '10.88.2.11', onCommand: 'tog11', offCommand: 'tog11', turnOffAfter: true, minutesAfter: 10 }] } ]
  };
  const writeCfg = () => fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(cfg, null, 2));
  writeCfg();
  const B = (id, bay, name, s, e, status, extra) => `INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at${extra ? ',whole_facility' : ''}) VALUES ('${id}','${bay}','${name}','Independence ${id}','','','${DAY}','${s}','${e}','${DAY}',60,0,'${status}',datetime('now','-5 hours'),datetime('now','-60 minutes')${extra ? ',1' : ''})`;
  const J = (b, kind, key, due, status) => `INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,next_attempt_at,status) VALUES ('${b}','${kind}','${key}','${due}','${due}','${status}')`;
  const utc = (hm) => new Date(at(hm)).toISOString().slice(0, 19).replace('T', ' ');
  const seed = await dbRun([
    // A: the PC session that just ended on Bay One, then a session about to start on Bay Two
    B('a1', 'd1', 'Bay One', '12:30', '13:58', 'active'),
    B('a2', 'd2', 'Bay Two', '14:05', '15:05', 'active'),
    // B: switch-offs and a switch-on made before the change that strands them
    B('o1', 'd6', 'Bay Six', '12:00', '13:00', 'completed'), J('o1', 'power_on', '10.88.0.66', utc('11:50'), 'done'), J('o1', 'power_off', '10.88.0.66', utc('13:10'), 'pending'),
    B('o2', 'd3', 'Bay Three', '12:00', '13:30', 'completed'), J('o2', 'power_on', 'switch.bay3_heater_ha', utc('11:50'), 'done'), J('o2', 'power_off', 'switch.bay3_heater_ha', utc('13:40'), 'pending'),
    B('o3', 'd7', 'Bay Seven', '12:00', '13:00', 'completed'), J('o3', 'power_on', '10.88.0.7', utc('11:50'), 'done'), J('o3', 'power_off', '10.88.0.7', utc('13:10'), 'pending'),
    B('o4', 'd3', 'Bay Three', '14:00', '15:00', 'active'), J('o4', 'power_on', 'switch.bay3_heater_ha', utc('13:50'), 'pending'),
    B('o5', 'd11', 'Bay Eleven', '09:00', '10:00', 'completed'), J('o5', 'ir_on', '10.88.2.11', utc('08:50'), 'done'), J('o5', 'ir_off', '10.88.2.11', utc('10:10'), 'pending'),
    // C: a session this evening on Bay Four
    B('r1', 'd4', 'Bay Four', '18:00', '19:00', 'active'),
    // E: Bay Nine's slow plug comes due at 2:30; Bay Ten's session ends at 2:30 (its plug off due 2:32) and the next is at 2:45
    B('p1', 'd9', 'Bay Nine', '14:40', '15:40', 'active'),
    B('q1', 'd10', 'Bay Ten', '13:30', '14:30', 'active'),
    B('q2', 'd10', 'Bay Ten', '14:45', '15:45', 'active'),
    // D: the whole facility, ending at closing
    B('w1', 'd1', 'Facility', '22:00', '23:00', 'active', true),
  ], at('12:00'));
  ok('seeded the bookings and the jobs a pass made earlier, from a process that then exited', seed.code === 0, seed.err.slice(-300));

  console.log('── A. a PC that never answers, and a device that refuses, hold up nothing else ──');
  fs.writeFileSync(NET_HANG, '');
  const tA = await child(TICK, at('14:00'), 25000);
  try { fs.unlinkSync(NET_HANG); } catch {}
  const plugA = plugCalls().filter(c => c.ip === '10.88.0.2' && c.op === 'on');
  const sdA = await job('a1', 'shutdown', '');
  ok('A1 Bay One\'s PC takes the connection and never answers: the shutdown is ended after its time limit and retried - the minute is not held',
     !tA.killed && tA.code === 0 && sdA[0] === 'pending' && sdA[2] === 1 && /did not answer within 2 seconds/.test(sdA[1]), { killed: tA.killed, code: tA.code, ms: tA.ms, job: sdA, err: tA.err.slice(-300) });
  ok('A2 ...and the next booking\'s plug on Bay Two goes on in the same minute', plugA.length === 1, plugCalls());
  const fanA = await job('a2', 'power_on', 'fan.bay2_fan_ha');
  ok('A3 Bay Two\'s fan (Home Assistant) refuses: it is retried, and the plug beside it went on all the same', fanA[0] === 'pending' && fanA[2] === 1 && plugA.length === 1, { fan: fanA });

  console.log('\n── B. a switch-off its booking\'s own pass no longer reaches ──');
  const tB = await child(TICK, at('14:20'));
  const o1 = await job('o1', 'power_off', '10.88.0.66'), o2 = await job('o2', 'power_off', 'switch.bay3_heater_ha'), o3 = await job('o3', 'power_off', '10.88.0.7'), o4 = await job('o4', 'power_on', 'switch.bay3_heater_ha');
  ok('B1 a plug removed after it was switched on: its switch-off is settled with the reason, not left "overdue" for ever', tB.code === 0 && o1[0] === 'skipped' && /no longer set up/.test(o1[1]), o1);
  ok('B2 Bay Three taken out of service: its heater is still switched off (Home Assistant was told), the job done - the session still booked on that bay holds nothing on, since nothing is switched on for it',
     o2[0] === 'done' && H.stateOf('switch.bay3_heater') === 'off', { job: o2, heater: H.stateOf('switch.bay3_heater') });
  ok('B3 a plug set to stay on after it was switched on: never switched off, and the job says why', o3[0] === 'skipped' && /set to stay on/.test(o3[1]) && !plugCalls().some(c => c.ip === '10.88.0.7' && c.op === 'off'), o3);
  ok('B4 a switch-on for the bay that is out of service: written off as not applicable, never sent and never "missed" (rule 31)', o4[0] === 'skipped' && /out of service/.test(o4[1]), o4);
  const o5 = await job('o5', 'ir_off', '10.88.2.11');
  ok('B6 a TV on a one-button (toggle) code whose switch-off was left waiting four hours: never sent that late (it could switch a TV that is off by now back on), written off with the reason',
     o5[0] === 'skipped' && /toggle/.test(o5[1]) && !plugCalls().some(c => c.ip === '10.88.2.11'), { o5, calls: plugCalls().filter(c => c.ip === '10.88.2.11') });
  const hB = await child(`require('./services/db').initDb().then(()=>{const h=require('./services/automation').health({hours:48});console.log(JSON.stringify({overdue:h.overdue,failed:h.failed.map(f=>f.kind+' '+f.device+' '+f.status)}));process.exit(0)})`, at('14:20'));
  let hb = {}; try { hb = JSON.parse(hB.out.trim().split('\n').pop()); } catch {}
  ok('B5 the health line: nothing overdue, nothing failed or missed', hb.overdue === 0 && Array.isArray(hb.failed) && hb.failed.length === 0, hb);

  console.log('\n── C. a timing change reaches a job already waiting ──');
  await child(TICK, at('14:21'));
  const before = await job('r1', 'power_on', '10.88.0.4');
  cfg.bays.find(b => b.id === 'd4').shellyDevices[0].minutesBefore = 25; writeCfg();
  await child(TICK, at('14:22'));
  const after = await job('r1', 'power_on', '10.88.0.4');
  ok('C1 Bay Four\'s plug changed from 10 to 25 minutes before: tonight\'s 6:00 session now switches it on at 5:35, not 5:50', before[3] === utc('17:50') && after[3] === utc('17:35') && after[0] === 'pending', { before, after });

  console.log('\n── E. a guard reads the clock when it decides ──');
  const fromE = plugCalls().length;
  const tE = await child(TICK, at('14:30'));
  const offTen = plugCalls().slice(fromE).filter(c => c.ip === '10.88.1.10' && c.op === 'off'), q1off = await job('q1', 'power_off', '10.88.1.10');
  ok('E1 Bay Nine\'s plug took three minutes, carrying the minute past Bay Ten\'s switch-off: it is still kept on for the 2:45 group, never switched off under them',
     tE.code === 0 && plugCalls().slice(fromE).some(c => c.ip === '10.88.1.9' && c.op === 'on') && offTen.length === 0 && q1off[0] === 'skipped' && /another session/.test(q1off[1]), { calls: plugCalls().slice(fromE), q1off });

  console.log('\n── F. Auto-Shutdown switched off after the jobs were made ──');
  // the review, Oct 24 2026: a shutdown made while Auto-Shutdown was on was picked up by the left-waiting sweep after the owner
  // turned it off - Bay Eight's PC forced off fifteen minutes after each session made that day. Switched off is the owner's
  // choice (rule 31): written off with the reason, the PC never told.
  const seedF = await dbRun([B('f1', 'd8', 'Bay Eight', '20:00', '21:00', 'completed'), J('f1', 'shutdown', '', utc('21:00'), 'pending')], at('21:01'));
  cfg.shutdown.enabled = false; writeCfg();
  const fromF = netCalls().length;
  const tF = await child(TICK, at('21:20'));
  const f1 = await job('f1', 'shutdown', '');
  ok('F1 Auto-Shutdown switched off: a shutdown made while it was on is written off with the reason, and Bay Eight\'s PC is never told',
     seedF.code === 0 && tF.code === 0 && f1[0] === 'skipped' && /Auto-Shutdown is switched off/.test(f1[1]) && !netCalls().slice(fromF).includes('127.0.0.2'), { job: f1, calls: netCalls().slice(fromF), err: tF.err.slice(-300) });
  cfg.shutdown.enabled = true; writeCfg();

  console.log('\n── D. at closing, every bay\'s PC ──');
  const fromD = netCalls().length;
  const tD = await child(TICK, at('23:01'));
  const nD = netCalls().slice(fromD);
  ok('D1 a whole-facility booking ending at closing shuts down every bay\'s PC - Bay One\'s and Bay Eight\'s', tD.code === 0 && nD.includes('127.0.0.1') && nD.includes('127.0.0.2'), { calls: nD, err: tD.err.slice(-300) });

  await H.stop(); pc.close();
  for (const f of ['config.json', 'bookings.db', CALLS, STUB]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
  try { fs.rmSync(BIN, { recursive: true, force: true }); } catch {}
  console.log(`\nDEVICE INDEPENDENCE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
