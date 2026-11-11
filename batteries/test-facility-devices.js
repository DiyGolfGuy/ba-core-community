// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-facility-devices.js - THE WHOLE FACILITY'S DEVICES (Oct 21 2026)
//
// maintainer: "heat and Ac would be a facility one"; "if there's no bookings for 3 hours, then I'll turn it back down to the Standby
// mode ... the TV's, if there's no bookings within an hour, just turn the TV [off] and turn it back [on] 10 minutes before the
// next booking ... one [bay's] booking doesn't turn the heat off or turn the football game off"; "a facility automation cant
// fail because one device does not respond ... if a thermostat or facility tv does not turn on the bay still needs to do all
// its stuff".
//
// Rule 22's shape: every tick is its own process (a restart) reading the bookings and the job table on disk, the clock pinned
// per tick (tools/fake-clock.js) across two days; a second tick at the same moment sends nothing twice; a cancel lands between
// ticks. The devices are tools/homeassistant-standin.js - a Home Assistant that refuses, hangs, and ignores a setpoint that
// does not fit the thermostat's mode, as the real one does.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = __dirname;
const PORT = 18191;
const ENV = Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent', BA_WATCHDOG_OFF: '1', BA_UPDATE_LIST_URL: 'off' });
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// the two days, counted as calendar days from today (never n x 24 hours)
const T = new Date();
const D1 = ymd(new Date(T.getFullYear(), T.getMonth(), T.getDate() + 1, 12)), D2 = ymd(new Date(T.getFullYear(), T.getMonth(), T.getDate() + 2, 12));

// a child that talks to the stand-in in THIS process: never spawnSync (it would starve the stand-in of its own event loop)
const child = (js, fakeNow) => new Promise(res => {
  const args = fakeNow ? ['-r', './tools/fake-clock.js', '-e', js] : ['-e', js];
  const c = spawn(process.execPath, args, { cwd: root, env: Object.assign({}, ENV, fakeNow ? { BA_FAKE_NOW: fakeNow } : {}) });
  let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
  const t = setTimeout(() => c.kill('SIGKILL'), 120000);
  c.on('close', code => { clearTimeout(t); res({ code, out, err }); });
});
// a scheduler tick in a fresh process at a pinned moment: what a unit restarted at that minute does
const TICK = `const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();await require('./services/facilitydevices').idle();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e&&e.stack||e);process.exit(1)})`;
const at = (day, hm) => `${day}T${hm}:00`;
const rows = async (sql) => { const r = await child(`require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`); try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return { error: r.err.slice(-300) }; } };
const dbRun = (sql, fakeNow) => child(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare(${JSON.stringify(sql)}).run();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`, fakeNow);

(async () => {
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  const { startHA, DEFAULT_FAULTS } = require('./tools/homeassistant-standin');
  const H = await startHA({ port: PORT, entities: [
    { entity_id: 'climate.room', state: 'cool', attributes: { friendly_name: 'Room Thermostat', hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], min_temp: 45, max_temp: 95, current_temperature: 76, temperature: 75, target_temp_low: null, target_temp_high: null } },
    { entity_id: 'media_player.lounge_tv', state: 'off', attributes: { friendly_name: 'Lounge TV' } },
    { entity_id: 'light.lobby', state: 'off', attributes: { friendly_name: 'Lobby Lights' } },
    { entity_id: 'switch.bay1_power', state: 'off', attributes: { friendly_name: 'Bay One Power' } },
  ] });
  const faults = f => H.set(Object.assign({}, DEFAULT_FAULTS, f || {}));
  const cfgOf = (haOn) => ({
    businessName: 'Facility Test', setup: { completed: true, eulaAccepted: true },
    server: { port: 3194, businessName: 'Facility Test', adminPassword: 'facility-battery-pw' },
    booking: { staffedAccess: true, openDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], openTime: '09:00', closeTime: '23:00', open24Hours: false, windowDays: 30, pricePerHalfHour: 20 },
    homeAssistant: { enabled: haOn, url: `http://127.0.0.1:${PORT}`, token: 'ha-test-token', facilityDevices: [
      { entity_id: 'climate.room', name: 'Room Thermostat', kind: 'climate', follows: 'bookings', leadTimeMins: 15, keepOnGapMins: 180, setbackDelayMins: 10, comfortTemp: 70, ecoTemp: 60 },
      { entity_id: 'media_player.lounge_tv', name: 'Lounge TV', kind: 'power', follows: 'bookings', minutesBefore: 10, keepOnGapMins: 60, minutesAfter: 10 },
      { entity_id: 'light.lobby', name: 'Lobby Lights', kind: 'power', follows: 'hours', minutesBefore: 15, minutesAfter: 15, keepOnGapMins: 0 } ] },
    bays: [
      { id: 'fb1', name: 'Bay One', active: true, haDevices: [{ entity_id: 'switch.bay1_power', name: 'Bay One Power', kind: 'power', minutesBefore: 5, turnOffAfter: true, minutesAfter: 5 }] },
      // the facility's thermostat on a bay's list too: the facility's times decide it, the bay never touches it
      { id: 'fb2', name: 'Bay Two', active: true, haDevices: [{ entity_id: 'climate.room', name: 'Room Thermostat', kind: 'climate', comfortTemp: 72, ecoTemp: 55 }] } ]
  });
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(cfgOf(true), null, 2));

  const book = (id, bay, bayName, day, s, e) => `INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at) VALUES ('${id}','${bay}','${bayName}','Facility ${id}','','','${day}','${s}','${e}','${day}',60,0,'active',datetime('now','-3 hours'))`;
  for (const b of [['fa', 'fb1', 'Bay One', '14:00', '15:00'], ['fb', 'fb2', 'Bay Two', '14:30', '16:00'], ['fc', 'fb1', 'Bay One', '17:30', '18:30'], ['fd', 'fb1', 'Bay One', '22:00', '23:00']]) {
    const r = await dbRun(book(b[0], b[1], b[2], D1, b[3], b[4]), at(D1, '12:00'));
    if (r.code !== 0) ok('seed ' + b[0], false, r.err.slice(-300));
  }

  // what each tick sent, by entity
  let tickErr = '';
  const tick = async (day, hm, opts = {}) => {
    H.state.calls.length = 0; if (opts.faults) faults(opts.faults);
    const r = await child(TICK, at(day, hm));
    if (r.code !== 0) tickErr += `${day} ${hm}: ${r.err.slice(-300)}\n`;
    if (opts.faults) faults();
    return H.state.calls.filter(c => !c.hung).map(c => ({ e: c.entity_id, s: c.domain + '.' + c.service, t: c.data && (c.data.temperature != null ? c.data.temperature : c.data.target_temp_low != null ? c.data.target_temp_low + '-' + c.data.target_temp_high : undefined), refused: !!c.refused }));
  };
  const of = (calls, e) => calls.filter(c => c.e === e);
  const words = calls => calls.map(c => `${c.e} ${c.s}${c.t != null ? ' ' + c.t : ''}${c.refused ? ' REFUSED' : ''}`);

  console.log('── A. one afternoon and evening, four bookings across two bays ──');
  const c1 = await tick(D1, '13:40');
  ok('A1 first sight at 1:40 PM: the lobby lights follow the opening hours and go on; the thermostat (on at 1:45) and the TV (on at 1:50) are left as they are - nothing is sent before its time',
     words(c1).join() === 'light.lobby homeassistant.turn_on' || words(c1).join() === 'light.lobby light.turn_on', words(c1));
  const c2 = await tick(D1, '13:46');
  ok('A2 1:46 PM, 15 minutes before the first booking in any bay: the thermostat (cooling) is set to comfort, 70', words(c2).join() === 'climate.room climate.set_temperature 70', words(c2));
  const c3 = await tick(D1, '13:51');
  ok('A3 1:51 PM: the lounge TV goes on, 10 minutes ahead', of(c3, 'media_player.lounge_tv').length === 1 && /turn_on/.test(of(c3, 'media_player.lounge_tv')[0].s) && c3.length === 1, words(c3));
  const c3b = await tick(D1, '13:51');
  ok('A4 a second restart at the same minute sends nothing twice', c3b.length === 0, words(c3b));
  const c4 = await tick(D1, '13:56');
  ok('A5 1:56 PM: Bay One\'s own power goes on for its booking (the bay\'s automation is its own)', words(c4).join() === 'switch.bay1_power switch.turn_on', words(c4));
  const c5 = await tick(D1, '15:06');
  ok('A6 3:06 PM, Bay One\'s booking over and Bay Two\'s still on: Bay One\'s power goes off - and the heat and the TV are NOT touched (one bay\'s booking ending never turns them off)',
     words(c5).join() === 'switch.bay1_power switch.turn_off', words(c5));
  const c6 = await tick(D1, '16:12');
  ok('A7 4:12 PM, the last booking ended at 4:00 and the next is at 5:30: the TV goes off (90 minutes is past its hour); the thermostat stays (inside its three hours)',
     of(c6, 'media_player.lounge_tv').length === 1 && /turn_off/.test(of(c6, 'media_player.lounge_tv')[0].s) && of(c6, 'climate.room').length === 0, words(c6));
  const c7 = await tick(D1, '17:21');
  ok('A8 5:21 PM: the TV is back on, 10 minutes before the 5:30 booking', of(c7, 'media_player.lounge_tv').length === 1 && /turn_on/.test(of(c7, 'media_player.lounge_tv')[0].s), words(c7));
  const c8 = await tick(D1, '18:42');
  ok('A9 6:42 PM, nothing booked until 10:00 (past three hours): the thermostat goes to standby - 80 while cooling, never the heating 60 - and the TV goes off',
     of(c8, 'climate.room').map(c => c.t).join() === '80' && of(c8, 'media_player.lounge_tv').length === 1 && /turn_off/.test(of(c8, 'media_player.lounge_tv')[0].s), words(c8));
  const c9 = await tick(D1, '21:46');
  ok('A10 9:46 PM: the thermostat back to comfort for the 10:00 booking', of(c9, 'climate.room').map(c => c.t).join() === '70', words(c9));

  console.log('\n── B. one device down never stops another (maintainer: "the bay still needs to do all its stuff") ──');
  // 9:56 PM: the TV's on (due 9:50) and Bay One's power (due 9:55) come due in the same tick; the TV never answers
  H.state.calls.length = 0; faults({ hangEntities: ['media_player.lounge_tv'] });
  const t0 = Date.now(); const pend = child(TICK, at(D1, '21:56'));
  let bayAt = null;
  while (Date.now() - t0 < 30000) { if (!bayAt && H.state.calls.some(c => c.entity_id === 'switch.bay1_power')) bayAt = Date.now() - t0; if (bayAt) break; await sleep(25); }
  const r10 = await pend; faults();
  if (r10.code !== 0) tickErr += 'B1 tick: ' + r10.err.slice(-300) + '\n';
  ok('B1 the TV hangs (no answer at all) and Bay One\'s power still goes on at once - it never waits for the TV', bayAt !== null && bayAt < 6000, { bayAt, took: Date.now() - t0 });
  const hb = await child(`require('./services/db').initDb().then(()=>{console.log(JSON.stringify(require('./services/automation').health({hours:48})));process.exit(0)})`, at(D1, '21:57'));
  let health = {}; try { health = JSON.parse(hb.out.trim().split('\n').pop()); } catch {}
  const tvRetry = (health.retrying || []).concat(health.failed || []).find(j => j.name === 'Lounge TV');
  ok('B2 the TV that did not answer is on the health line by its own name, on "the facility", being retried - never silent (and its row keeps the job\'s own key, so Retry reaches it)',
     !!tvRetry && tvRetry.bay === 'the facility' && /^fac:media_player\.lounge_tv#\d+$/.test(tvRetry.device || '') && /timeout|aborted|did not answer/i.test(tvRetry.error || ''), { retrying: health.retrying, failed: health.failed });
  const c11 = await tick(D1, '21:58');
  ok('B3 the TV answers again: the retry turns it on (one try later, nothing else re-sent)', words(c11).join() === 'media_player.lounge_tv homeassistant.turn_on' || words(c11).join() === 'media_player.lounge_tv media_player.turn_on', words(c11));

  const c12 = await tick(D1, '23:12');
  ok('B4 11:12 PM, the last booking over: the thermostat to standby (80) and the TV off; the lobby lights stay until 15 minutes past closing',
     of(c12, 'climate.room').map(c => c.t).join() === '80' && of(c12, 'media_player.lounge_tv').length === 1 && of(c12, 'light.lobby').length === 0, words(c12));
  const c13 = await tick(D1, '23:16');
  ok('B5 11:16 PM: the lobby lights off, 15 minutes after closing', of(c13, 'light.lobby').length === 1 && /turn_off/.test(of(c13, 'light.lobby')[0].s), words(c13));
  const bayJobs = await rows(`SELECT COUNT(*) FROM automation_jobs WHERE device_key='climate.room_ha'`);
  ok('B6 the thermostat is on Bay Two\'s list too, and the bay never made a job for it: the facility\'s times decide it', Array.isArray(bayJobs) && bayJobs[0] && bayJobs[0][0] === 0, bayJobs);

  console.log('\n── C. the next day: a cancel, a thermostat someone switched off, and a bay device that hangs ──');
  for (const b of [['ga', 'fb1', 'Bay One', '10:00', '11:00'], ['gb', 'fb2', 'Bay Two', '12:00', '13:00']]) {
    const r = await dbRun(book(b[0], b[1], b[2], D2, b[3], b[4]), at(D2, '08:00'));
    if (r.code !== 0) ok('seed ' + b[0], false, r.err.slice(-300));
  }
  const c14 = await tick(D2, '09:00');
  ok('C1 9:00 AM the next day: the lobby lights on (opening at 9:00, 15 minutes ahead)', of(c14, 'light.lobby').length === 1 && /turn_on/.test(of(c14, 'light.lobby')[0].s), words(c14));
  const room = H.state.entities.find(e => e.entity_id === 'climate.room'); room.state = 'off';
  const c15 = await tick(D2, '09:46');
  room.state = 'cool';
  const notSent = await rows(`SELECT event, detail FROM admin_log WHERE event='HA_NOT_SENT' ORDER BY id DESC LIMIT 1`);
  ok('C2 a thermostat someone switched OFF at the wall: nothing is sent, and the owner\'s log says why (never written up as done, never a failure)',
     of(c15, 'climate.room').length === 0 && Array.isArray(notSent) && notSent[0] && /set to off/.test(notSent[0][1]), { calls: words(c15), log: notSent });
  // 9:56: the TV's on (due 9:50) and Bay One's power (due 9:55) together - this time the BAY'S device hangs
  H.state.calls.length = 0; faults({ hangEntities: ['switch.bay1_power'] });
  const t1 = Date.now(); const pend2 = child(TICK, at(D2, '09:56'));
  let tvAt = null;
  while (Date.now() - t1 < 30000) { if (!tvAt && H.state.calls.some(c => c.entity_id === 'media_player.lounge_tv')) tvAt = Date.now() - t1; if (tvAt) break; await sleep(25); }
  const r16 = await pend2; faults();
  if (r16.code !== 0) tickErr += 'C3 tick: ' + r16.err.slice(-300) + '\n';
  ok('C3 Bay One\'s power hangs and the lounge TV still goes on at once - the facility never waits for a bay', tvAt !== null && tvAt < 6000, { tvAt });
  await dbRun(`UPDATE bookings SET status='cancelled' WHERE id='gb'`, at(D2, '10:30'));
  const c17 = await tick(D2, '11:12');
  ok('C4 Bay Two\'s noon booking was cancelled at 10:30: at 11:12, with nothing booked after the 11:00 end, the TV goes off and the thermostat to standby - a cancel turns the facility down on the next tick',
     of(c17, 'media_player.lounge_tv').length === 1 && /turn_off/.test(of(c17, 'media_player.lounge_tv')[0].s) && of(c17, 'climate.room').map(c => c.t).join() === '80', words(c17));

  console.log('\n── D. no Home Assistant, nothing to do (rule 31) ──');
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(cfgOf(false), null, 2));
  const before = await rows(`SELECT COUNT(*) FROM automation_jobs WHERE booking_id='facility'`);
  const lastLog = ((await rows(`SELECT COALESCE(MAX(id),0) FROM admin_log`))[0] || [0])[0];
  const c18 = await tick(D2, '13:00');
  const after = await rows(`SELECT COUNT(*) FROM automation_jobs WHERE booking_id='facility'`);
  const errs = await rows(`SELECT COUNT(*) FROM admin_log WHERE id > ${Number(lastLog) || 0} AND event IN ('AUTOMATION_ERROR','AUTOMATION_FAILED','HA_ERROR','HA_CLIMATE_ERROR')`);
  ok('D1 Home Assistant switched off: nothing is sent, no job is made, and nothing is written up as an error', c18.length === 0 && JSON.stringify(before) === JSON.stringify(after) && Array.isArray(errs) && errs[0] && errs[0][0] === 0, { calls: words(c18), before, after, errs });

  ok('every tick ran clean', !tickErr, tickErr);
  await H.stop();
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  console.log(`\nFACILITY DEVICES: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
