// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-bay-buttons.js - THE BAY BUTTONS AND THE SCHEDULER KEEP ONE COMMAND LEDGER
//                       (Sep 25 2026, maintainer's Monday pack item 6; the pilot facility handoff section 2)
//
// pilot facility: the manual bay buttons sent IR directly and wrote nothing; their TVs learn one power
// toggle, so a manual Off 13 seconds after the automatic off switched the set back ON. Here:
//   A  the automatic OFF of a TV on a TOGGLE code goes into the ledger; Bay Off pressed 13
//      seconds later does NOT send the toggle again (the TV would come back on) - and says why
//   B  Bay On sends it and records it; the next automatic OFF then sends (the ledger is current)
//   C  Bay Off pressed BEFORE the automatic OFF: the automatic OFF does not flip it back on
//   D  a TV on a DISCRETE code, and the plugs, are never guarded - sending twice is harmless
//   E  every button press is in the ledger with who pressed it; the owner's log names what was
//      not sent and what failed, not just a step count
//   F  a plug or a TV that REFUSES (Oct 3 2026, the cleanup audit - the stand-ins could only say yes):
//      the press says so, the ledger records it as not taken, the owner's log names it, and a
//      refused toggle is not taken as sent - the next press sends it
// Every process on a fake clock; the TVs and plugs are recorded stand-ins.
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };
const root = __dirname;
const CALLS = path.join(root, '.bb-calls.jsonl');
const STUB = path.join(root, '.bb-stub.js');
const DOWN = path.join(root, '.bb-down');   // the devices that refuse, one address a line (section F)
fs.writeFileSync(STUB, `
const fs = require('fs'); const Module = require('module'); const orig = Module._load;
const log = o => fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify(Object.assign({ at: new Date().toISOString() }, o)) + '\\n');
// a stand-in must be able to refuse (rule 29), in the real module's shape: Shelly answers { success: false, ip, action, error },
// the BroadLink bridge { error } when it cannot be reached
const down = ip => { try { return fs.readFileSync(${JSON.stringify(DOWN)}, 'utf8').split('\\n').includes(ip); } catch { return false; } };
Module._load = function (req, parent) {
  const p = parent && parent.filename || '';
  if (/services/.test(p) && req === './shelly') { const real = orig.apply(this, arguments); return Object.assign({}, real, { controlDevice: async (ip, gen, on) => { log({ dev: 'shelly', ip, op: on ? 'on' : 'off', refused: down(ip) }); return down(ip) ? { success: false, ip, action: on ? 'on' : 'off', error: 'stand-in relay: no answer' } : { success: true }; } }); }
  if (/services/.test(p) && req === './broadlink') { const real = orig.apply(this, arguments); return Object.assign({}, real, { sendCommand: async (ip, cmd) => { log({ dev: 'tv', ip, op: cmd, refused: down(ip) }); return down(ip) ? { error: 'stand-in bridge: no answer' } : { success: true }; } }); }
  return orig.apply(this, arguments);
};
`);
const pad = n => String(n).padStart(2, '0');
const d1 = new Date(); d1.setDate(d1.getDate() + 1);
const DAY = `${d1.getFullYear()}-${pad(d1.getMonth() + 1)}-${pad(d1.getDate())}`;
const at = hms => `${DAY}T${hms}`;
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
const run = (js, fake) => spawnSync(process.execPath, ['-r', STUB, '-r', './tools/fake-clock.js', '-e', js], { cwd: root, env: Object.assign({}, ENV, { BA_FAKE_NOW: fake }), encoding: 'utf8', timeout: 120000 });
const END = `await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`;
const tick = fake => run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();${END}`, fake);
const press = (bay, mode, fake) => run(`const db=require('./services/db');db.initDb().then(async()=>{const r=await require('./services/sequence').${mode === 'on' ? 'startBay' : 'stopBay'}('${bay}',{source:'staff pad'});console.log('R '+JSON.stringify(r));${END}`, fake);
const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const q = sql => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { return []; } };
const result = r => { const m = /R (.*)/.exec(r.stdout || ''); try { return JSON.parse(m[1]); } catch { return { err: (r.stderr || '').slice(-300) }; } };

try {
  for (const f of ['config.json', 'bookings.db', CALLS]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Button Golf', setup: { completed: true, eulaAccepted: true },
    server: { port: 3161, businessName: 'Button Golf', adminPassword: 'button-owner-pw', timezone: 'America/Chicago' },
    booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true },
    sms: { sendReminder: false, sendEndingWarning: false }, resend: { sendReminder: false, sendEndingWarning: false },
    bays: [
      { id: 'bb-1', name: 'Bay One', active: true, shellyDevices: [{ name: 'Plug One', ip: '10.66.0.1', gen: 2, turnOffAfter: true, minutesAfter: 30 }],
        broadlinkDevices: [{ name: 'TV One', ip: '10.66.0.2', onCommand: 'tv1-power', offCommand: 'tv1-power', turnOffAfter: true, minutesAfter: 30, minutesBefore: 10 }] },
      { id: 'bb-2', name: 'Bay Two', active: true, broadlinkDevices: [{ name: 'TV Two', ip: '10.66.0.3', onCommand: 'tv2-on', offCommand: 'tv2-off', turnOffAfter: true, minutesAfter: 30, codeStyle: 'discrete' }] }
    ]
  }, null, 2));
  const rows = [['bb-a', 'bb-1', '10:00', '11:00'], ['bb-b', 'bb-1', '13:00', '14:00'], ['bb-c', 'bb-1', '16:00', '17:00']];
  const seed = run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').ensureSchema();for(const [id,bay,s,e] of ${JSON.stringify(rows)}) db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,'active',datetime('now'),datetime('now'))").run(id,bay,'Bay','Pat Button','','','${DAY}',s,e,'${DAY}');${END}`, at('08:00:00'));
  ok('stage: Bay One with a plug and a TV on a TOGGLE code (the default), Bay Two with a TV on a discrete code; three sessions on Bay One', seed.status === 0, (seed.stderr || '').slice(-300));

  console.log('── A. Bay Off pressed 13 seconds after the automatic off ──');
  tick(at('09:51:00'));
  tick(at('11:31:00'));
  const autoOff = calls().filter(c => c.dev === 'tv' && c.ip === '10.66.0.2');
  ok('A1 the automatic ON and OFF of the toggle TV were each sent once', autoOff.length === 2, autoOff);
  const n0 = calls().length;
  const r1 = result(press('bb-1', 'off', at('11:31:13')));
  const after = calls().slice(n0);
  const tvStep = (r1.steps || []).find(s => s.kind === 'broadlink_off') || {};
  ok('A2 Bay Off 13 seconds later does NOT send the toggle again - the TV would have come back on - and the answer says why', !after.some(c => c.dev === 'tv') && /sent "off" at 11:31/.test(String(tvStep.skipped || '')) && /toggle/.test(String(tvStep.skipped || '')) && /press Off again within two minutes/.test(String(tvStep.skipped || '')), { after, tvStep });
  ok('A3 ...while the plug, an explicit relay, is still sent off (twice is harmless)', after.some(c => c.dev === 'shelly' && c.op === 'off'), after);
  // A PERSON CAN ALWAYS OVERRIDE THE LEDGER (the build review): IR is one-way, so the ledger can be
  // wrong - the TV's own remote, a code the TV missed. The same button pressed again sends it anyway;
  // a double tap on a phone (under three seconds) does not.
  const nA = calls().length;
  const tri = run(`const db=require('./services/db');db.initDb().then(async()=>{const q=require('./services/sequence');const C=global.__baFakeClock;
    const a=await q.stopBay('bb-1',{source:'staff pad'}); C.set('${DAY}T11:32:01'); const b=await q.stopBay('bb-1',{source:'staff pad'}); C.set('${DAY}T11:32:30'); const c=await q.stopBay('bb-1',{source:'staff pad'});
    const tv=r=>(r.steps||[]).find(s=>s.kind==='broadlink_off')||{};console.log('R '+JSON.stringify([tv(a),tv(b),tv(c)]));${END}`, at('11:32:00'));
  const [p1, p2, p3] = result(tri);
  const sentA = calls().slice(nA).filter(c => c.dev === 'tv');
  ok('A4 a double tap (a second press within three seconds) is still held back', !!(p1 && p1.skipped) && !!(p2 && p2.skipped), { p1, p2 });
  ok('A5 ...but Off pressed AGAIN half a minute later sends the TV code anyway, once, and the ledger says so', p3 && !p3.skipped && p3.ok && p3.forced && sentA.length === 1 && q("SELECT detail FROM device_commands WHERE source LIKE 'manual%' ORDER BY id DESC LIMIT 3").some(r => /sent anyway/.test(r[0])), { p3, sentA });

  console.log('\n── B. Bay On, then the next automatic OFF ──');
  const n1 = calls().length;
  const r2 = result(press('bb-1', 'on', at('12:40:00')));
  ok('B1 Bay On sends the TV\'s code (the ledger said off) and records it', calls().slice(n1).some(c => c.dev === 'tv' && c.op === 'tv1-power') && (r2.steps || []).some(s => s.kind === 'broadlink_on' && s.ok && !s.skipped), r2.steps);
  const n2 = calls().length;
  tick(at('12:51:00'));   // bb-b's automatic ON: the ledger says on (Bay On, 11 minutes ago) - not sent again
  ok('B2 the next session\'s automatic ON, eleven minutes after Bay On, is NOT sent - the ledger says the TV is on, and a toggle would switch it off', !calls().slice(n2).some(c => c.dev === 'tv'), calls().slice(n2));
  const n3 = calls().length;
  tick(at('14:31:00'));
  ok('B3 ...and that session\'s automatic OFF IS sent (the ledger\'s last word is "on")', calls().slice(n3).some(c => c.dev === 'tv' && c.op === 'tv1-power'), calls().slice(n3));

  console.log('\n── C. Bay Off pressed before the automatic off ──');
  tick(at('15:51:00'));   // bb-c ON
  const n4 = calls().length;
  const r3 = result(press('bb-1', 'off', at('17:05:00')));
  ok('C1 Bay Off at 17:05 (the session ended at 17:00) sends the toggle', calls().slice(n4).some(c => c.dev === 'tv'), r3.steps);
  const n5 = calls().length;
  tick(at('17:31:00'));
  ok('C2 the automatic OFF at 17:30 does NOT flip it back on - the ledger says a person already switched it off', !calls().slice(n5).some(c => c.dev === 'tv'), calls().slice(n5));

  console.log('\n── D. a discrete code is never guarded ──');
  const n6 = calls().length;
  press('bb-2', 'off', at('18:00:00')); press('bb-2', 'off', at('18:00:10'));
  ok('D1 Bay Off twice on a TV with a discrete "off" code sends it both times', calls().slice(n6).filter(c => c.dev === 'tv' && c.op === 'tv2-off').length === 2, calls().slice(n6));

  console.log('\n── E. the record ──');
  const led = q("SELECT device, op, source, ok FROM device_commands ORDER BY id");
  ok('E1 every command is in the ledger with who sent it - the scheduler and the staff pad', led.some(r => r[2] === 'automation' && /^ir:10\.66\.0\.2:/.test(r[0])) && led.some(r => /manual - staff pad/.test(r[2]) && /^ir:10\.66\.0\.2:/.test(r[0]) && r[1] === 'on') && led.some(r => /manual - staff pad/.test(r[2]) && r[0] === 'shelly:10.66.0.1'), led.slice(-8));
  const bs = q("SELECT detail FROM admin_log WHERE event='BAY_SEQUENCE' ORDER BY id");
  ok('E2 the owner\'s log names who pressed and what was NOT sent and why, not only a step count', bs.some(r => /staff pad/.test(r[0]) && /not sent: TV One - the unit sent "off"/.test(r[0])), bs.map(r => r[0]).slice(0, 3));
  const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8'), adm = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
  const one = (html.match(/async function shellyOne\(ip, gen, action\) \{[\s\S]*?\n\}/) || [''])[0];
  ok('E3 a plug\'s own ON/OFF buttons show what the plug SAID - a refusal is an error, never a green "ON" - and the press goes into the ledger', /res\.success === true/.test(one) && /did not switch/.test(one) && /source: 'manual - admin plug button'/.test(adm), one.slice(0, 200));

  console.log('\n── F. a plug or a TV that refuses ──');
  fs.writeFileSync(DOWN, '10.66.0.3\n');   // TV Two's bridge cannot be reached
  const rf = result(press('bb-2', 'off', at('18:10:00')));
  const tvF = (rf.steps || []).find(s => s.kind === 'broadlink_off') || {};
  ok('F1 Bay Off on a TV whose bridge does not answer: the press answers NOT ok and the step carries what the bridge said', rf.ok === false && tvF.ok === false && /stand-in bridge: no answer/.test(String(tvF.error || '')), rf);
  const ledF = q("SELECT ok, detail, source FROM device_commands WHERE device LIKE 'ir:10.66.0.3:%' ORDER BY id DESC LIMIT 1")[0] || [];
  ok('F2 ...the ledger records that command as NOT taken, with the reason and who pressed', ledF[0] === 0 && /no answer/.test(String(ledF[1])) && /staff pad/.test(String(ledF[2])), ledF);
  const bsF = q("SELECT detail FROM admin_log WHERE event='BAY_SEQUENCE' ORDER BY id DESC LIMIT 1")[0] || [];
  ok('F3 ...and the owner\'s log names the device that FAILED and why', /FAILED: TV Two \(stand-in bridge: no answer\)/.test(String(bsF[0])), bsF);
  // a refused toggle must not count as sent: TV One's ledger says "off" (C1); a refused On must leave it
  // "off", or the next On would be held back as "already on" and the TV would stay dark
  fs.writeFileSync(DOWN, '10.66.0.1\n10.66.0.2\n');   // Bay One's plug and TV both refuse
  const rOn = result(press('bb-1', 'on', at('18:20:00')));
  const failedKinds = (rOn.steps || []).filter(s => s.ok === false).map(s => s.kind).sort();
  ok('F4 Bay On with the plug and the TV refusing: both steps fail, each with the device\'s own answer', rOn.ok === false && failedKinds.join() === 'broadlink_on,shelly_on' && (rOn.steps || []).some(s => s.kind === 'shelly_on' && /relay: no answer/.test(String(s.error))), rOn.steps);
  fs.writeFileSync(DOWN, '');
  const n8 = calls().length;
  const rOn2 = result(press('bb-1', 'on', at('18:21:00')));
  ok('F5 ...and On pressed again once they answer SENDS the TV code - the refused On was not taken as the TV being on', rOn2.ok === true && calls().slice(n8).some(c => c.dev === 'tv' && c.ip === '10.66.0.2' && !c.refused) && (rOn2.steps || []).some(s => s.kind === 'broadlink_on' && s.ok && !s.skipped), { steps: rOn2.steps, sent: calls().slice(n8) });
} finally {
  for (const f of ['config.json', 'bookings.db', CALLS, STUB, DOWN]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
}
console.log(`\nBAY BUTTONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
