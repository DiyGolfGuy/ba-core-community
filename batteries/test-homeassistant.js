// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-homeassistant.js — THE SECOND DOOR CREDENTIAL, WHICH HAD NO BATTERY
//                         (maintainer, Sep 16 2026)
//
// Of the five services with zero coverage, this one goes first because of what it
// can do: setEntity() maps the `lock` DOMAIN to unlock/lock and discoverEntities()
// offers lock: entities for an owner to pick, so a Home Assistant long-lived token
// is a DOOR-OPENING credential on the facility LAN. 219 lines, wired end to end,
// and not one assertion had ever driven it.
//
// No product seam was needed: haAuth() reads cfg.homeAssistant.url at call time.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); } };
const root = __dirname;
const cfgPath = path.join(root, 'config.json');
const PORT = 18123;

(async () => {
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  const { startHA, DEFAULT_FAULTS } = require('./tools/homeassistant-standin');
  const H = await startHA({ port: PORT });

  const writeCfg = (ha) => {
    fs.writeFileSync(cfgPath, JSON.stringify({
      businessName: 'HA', setup: { completed: true }, server: { port: 3093 },
      booking: {}, bays: [{ id: 'bay1', name: 'B1', active: true, haDevices: [
        { entity_id: 'switch.bay1_power', name: 'Bay 1 Power', kind: 'power' },
        { entity_id: 'climate.bay1', name: 'Bay 1 Climate', kind: 'climate', onTemp: 21, offTemp: 16 } ] }],
      homeAssistant: Object.assign({ enabled: true, url: H.url, token: 'ha-test-token' }, ha || {})
    }));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/homeassistant')];
    return require('./services/homeassistant');
  };
  const caught = async fn => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
  const reset = f => H.set(Object.assign({}, DEFAULT_FAULTS, f || {}));
  const db = require('./services/db'); await db.initDb();
  const logRows = () => { try { return db.db.prepare('SELECT event, detail FROM admin_log ORDER BY id DESC LIMIT 6').all(); } catch { return []; } };

  console.log('── A. it can talk to a real-shaped Home Assistant at all ──');
  reset();
  {
    let ha = writeCfg();
    const t = await caught(() => ha.testConnection());
    ok('A1 Test Connection reaches HA and reports success', t.ok && t.v && (t.v.ok === true || t.v.success === true), t.ok ? t.v : t.e);
    const d = await caught(() => ha.discoverEntities());
    ok('A2 discovery groups entities by domain, friendly names included',
       d.ok && d.v.groups && d.v.groups.switch.length >= 1 && d.v.groups.lock.length >= 1 && d.v.groups.lock.some(l => l.entity_id === 'lock.front_door') && d.v.total >= 6, d.ok ? { total: d.v.total } : d.e);   // the stand-in carries a second (Matter) lock since Sep 22 2026
    ok('A3 a sensor is NOT offered as something to switch', d.ok && (d.v.groups.other || []).some(x => /sensor\./.test(x.entity_id)), d.ok ? d.v.groups.other : d.e);
  }

  console.log('\n── B. the lock domain: this is a door, and it is treated as one ──');
  {
    const ha = writeCfg();
    const r = await caught(() => ha.setEntity('lock.front_door', true));
    ok('B1 setEntity on a lock: entity calls lock.unlock, not homeassistant.turn_on',
       r.ok && r.v.success === true && H.state.calls.slice(-1)[0].domain === 'lock' && H.state.calls.slice(-1)[0].service === 'unlock',
       H.state.calls.slice(-1)[0]);
    ok('B2 ...and the door is actually unlocked on the other side', H.stateOf('lock.front_door') === 'unlocked');
    await ha.setEntity('lock.front_door', false);
    ok('B3 off locks it again', H.stateOf('lock.front_door') === 'locked' && H.state.calls.slice(-1)[0].service === 'lock');
  }

  console.log('\n── C. every other domain maps to the right service ──');
  {
    const ha = writeCfg();
    for (const [id, onSvc, dom] of [['switch.bay1_power', 'turn_on', 'switch'], ['light.bay1', 'turn_on', 'light'], ['cover.bay1_blind', 'open_cover', 'cover']]) {
      await ha.setEntity(id, true);
      const c = H.state.calls.slice(-1)[0];
      ok(`C1 ${id} -> ${dom}.${onSvc}`, c.domain === dom && c.service === onSvc, c);
    }
    const r = await caught(() => ha.setEntity('input_boolean.thing', true));
    ok('C2 an unknown domain falls back to homeassistant.turn_on rather than guessing a service',
       r.ok && ['input_boolean', 'homeassistant'].includes(H.state.calls.slice(-1)[0].domain), H.state.calls.slice(-1)[0]);
  }

  console.log('\n── D. rule 29: a refusal is never recorded as a success ──');
  {
    const ha = writeCfg();
    reset({ serviceFails: true });
    const r = await caught(() => ha.setEntity('switch.bay1_power', true));
    ok('D1 a service call HA refuses returns success:false, never true', r.ok && r.v.success === false && !!r.v.error, r.ok ? r.v : r.e);
    ok('D2 ...and the owner is told, in their log', logRows().some(x => x.event === 'HA_ERROR'), logRows().map(x => x.event));
    reset({ rejectToken: true });
    const r2 = await caught(() => ha.setEntity('switch.bay1_power', true));
    ok('D3 a token HA rejects is a failure, not a quiet no-op', r2.ok && r2.v.success === false, r2.ok ? r2.v : r2.e);
    reset({ down: true });
    const r3 = await caught(() => ha.setEntity('switch.bay1_power', true));
    ok('D4 an HA that is down is a failure', r3.ok && r3.v.success === false, r3.ok ? r3.v : r3.e);
    reset({ htmlBody: true });
    const r4 = await caught(() => ha.testConnection());
    ok('D5 a 200 that is a login page is not accepted as a working connection',
       !r4.ok || (r4.v && r4.v.ok !== true && r4.v.success !== true), r4.ok ? r4.v : r4.e);
    reset();
  }

  console.log('\n── E. rule 31: a facility that does not use Home Assistant ──');
  {
    const ha = writeCfg({ enabled: false });
    const r = await caught(() => ha.setEntity('switch.bay1_power', true));
    ok('E1 HA switched off is NOT APPLICABLE - never a failure that retries', !r.ok || (r.v && r.v.success === false), r.ok ? r.v : r.e);
    const before = logRows().length;
    const ha2 = writeCfg({ token: '' });
    await caught(() => ha2.setEntity('switch.bay1_power', true));
    ok('E2 no token configured does not fill the owner\'s log with errors they cannot act on', logRows().length >= before);
  }

  console.log('\n── F. what a booking ACTUALLY drives ──');
  // My first cut of this drove haBayOn/haBayOff, which the scheduler never
  // called and which are now deleted (section G). It drives setEntity per
  // device with mustHaveWorked (scheduler.js
  // around :528-588, the rule-29 wrapper). Testing the helpers would have been
  // asserting my model of the product instead of the product, which is the
  // mistake the project notes names as the worst one. So: drive what the scheduler drives.
  {
    reset();
    const ha = writeCfg();
    const cfg = require('./services/config').getConfig();
    const dev = cfg.bays[0].haDevices[0];
    const r = await caught(() => ha.setEntity(dev.entity_id, true));
    ok('F1 the scheduler\'s own call turns the bay device on and the device really changes',
       r.ok && r.v.success === true && H.stateOf('switch.bay1_power') === 'on', r.ok ? r.v : r.e);
    ok('F2 it returns a READ result the scheduler can refuse on (rule 29 - mustHaveWorked throws on success:false)',
       r.ok && typeof r.v === 'object' && 'success' in r.v, r.ok ? r.v : r.e);
    const t = await caught(() => ha.setTemperature('climate.bay1', 21));
    ok('F3 a climate device is set to the number given, not a hardcoded one',
       t.ok && t.v.success === true && (H.state.calls.find(c => c.service === 'set_temperature') || {}).data?.temperature === 21,
       H.state.calls.filter(c => c.service === 'set_temperature'));
    const off = await caught(() => ha.setEntity(dev.entity_id, false));
    ok('F4 and off turns it off', off.ok && H.stateOf('switch.bay1_power') === 'off', off.ok ? off.v : off.e);
  }
  console.log('\n── G. the dead helpers are gone, and stay gone ──');
  {
    // haBayOn/haBayOff were exported and never called by anything. They also
    // swallowed their own outcome - no return value, errors to console - which
    // is the exact shape rule 29 exists to forbid, so the choice was delete or
    // rewrite, and nothing called them. Removed Sep 17 2026. This guard is what
    // the old "recorded rather than tested" assertion turned into: the next
    // reader cannot mistake them for the live path because they are not there.
    const src = fs.readFileSync('./services/homeassistant.js', 'utf8');
    const sch = fs.readFileSync('./services/scheduler.js', 'utf8');
    const ha = require('./services/homeassistant');
    ok('G1 haBayOn/haBayOff are gone from the module and its exports',
       !/function haBayOn|function haBayOff/.test(src) && !ha.haBayOn && !ha.haBayOff);
    ok('G2 ...and nothing has quietly reintroduced a call to them',
       !/\bhaBayOn\s*\(|\bhaBayOff\s*\(/.test(sch + src));
    ok('G3 what the scheduler really drives is still there - setEntity per device, with the rule-29 wrapper',
       typeof ha.setEntity === 'function' && /mustHaveWorked/.test(sch));
  }

  // ── H. A THERMOSTAT IS SET FOR THE SEASON IT IS IN (Oct 21 2026) ──
  // One number used to be sent whatever the thermostat was doing: a thermostat cooling for the summer was set back to the
  // HEATING setback after every session (60 - the AC flat out in an empty room), and one in heat/cool was sent a number
  // Z-Wave JS ignores in that mode without a word. climate.room in the stand-in is a Z-Wave thermostat as Home Assistant
  // shows one: it refuses what HA refuses and, like the integration, ignores a setpoint that does not fit its mode.
  console.log('\n── H. a thermostat is set for the mode it is in: heat, cool, heat/cool, off ──');
  {
    reset();
    const ha = writeCfg();
    const room = () => H.state.entities.find(e => e.entity_id === 'climate.room');
    const mode = (m) => { const e = room(); e.state = m; const a = e.attributes; if (m === 'heat_cool') { a.temperature = null; a.target_temp_low = a.target_temp_low || 64; a.target_temp_high = a.target_temp_high || 78; } else { a.target_temp_low = null; a.target_temp_high = null; a.temperature = a.temperature || 66; } };
    const sent = () => H.state.calls.filter(c => c.service === 'set_temperature' && c.entity_id === 'climate.room');
    const T = ha.climateTargets({ comfortTemp: 70, ecoTemp: 60 });
    ok('H0 the numbers: comfort 70 either way and 68-72 in heat/cool; idle 60 heating, 80 cooling (the setback mirrored around comfort), 60-80 in heat/cool',
       JSON.stringify(T) === JSON.stringify({ comfort: { heat: 70, cool: 70, range: [68, 72] }, eco: { heat: 60, cool: 80, range: [60, 80] } }), T);
    mode('heat'); H.state.calls.length = 0;
    const h1 = await ha.setClimate('climate.room', T.comfort), h2 = await ha.setClimate('climate.room', T.eco);
    ok('H1 heating: comfort 70 for the session, 60 idle - one setpoint, as before', h1.success && h2.success && sent().map(c => c.data.temperature).join() === '70,60' && room().attributes.temperature === 60, sent().map(c => c.data));
    mode('cool'); H.state.calls.length = 0;
    const c1 = await ha.setClimate('climate.room', T.comfort), c2 = await ha.setClimate('climate.room', T.eco);
    ok('H2 COOLING: comfort 70 for the session, and idle is 80 - never the heating 60 that ran the AC flat out in an empty room', c1.success && c2.success && sent().map(c => c.data.temperature).join() === '70,80' && room().attributes.temperature === 80, sent().map(c => c.data));
    H.state.calls.length = 0;
    await ha.setClimate('climate.room', ha.climateTargets({ comfortTemp: 70, ecoTemp: 60, coolEcoTemp: 78 }).eco);
    ok('H3 the owner\'s own cooling setback is used when given (78)', sent().map(c => c.data.temperature).join() === '78', sent().map(c => c.data));
    mode('heat_cool'); H.state.calls.length = 0;
    const r1 = await ha.setClimate('climate.room', T.comfort);
    const afterComfort = [room().attributes.target_temp_low, room().attributes.target_temp_high].join('-');
    const r2 = await ha.setClimate('climate.room', T.eco);
    ok('H4 HEAT/COOL: the low and high setpoints - 68-72 for the session, 60-80 idle - and the thermostat really moved (one number is ignored in this mode)',
       r1.success && r2.success && afterComfort === '68-72' && [room().attributes.target_temp_low, room().attributes.target_temp_high].join('-') === '60-80' && sent().every(c => c.data.temperature === undefined), { afterComfort, calls: sent().map(c => c.data) });
    H.state.calls.length = 0;
    const ignored = await caught(() => ha.setTemperature('climate.room', 70));
    ok('H5 (the stand-in is honest) one number sent to a heat/cool thermostat answers success and changes nothing - the silent no-op the old code recorded as done',
       ignored.ok && ignored.v.success === true && [room().attributes.target_temp_low, room().attributes.target_temp_high].join('-') === '60-80', room().attributes);
    mode('off'); H.state.calls.length = 0;
    const o1 = await ha.setClimate('climate.room', T.comfort);
    ok('H6 a thermostat someone switched OFF is left alone: nothing is sent, and the answer says why (skipped, never a failure - rule 31)', o1.skipped === true && /set to off/.test(o1.reason) && sent().length === 0, o1);
    room().state = 'unavailable'; H.state.calls.length = 0;
    const u1 = await ha.setClimate('climate.room', T.comfort);
    ok('H7 a thermostat Home Assistant cannot reach is a FAILURE the scheduler retries (rule 29), with nothing sent', u1.success === false && /unavailable/.test(u1.error) && sent().length === 0, u1);
    const L = ha.climateTargets({ comfortTemp: 72, ecoTemp: 80 });
    ok('H8 an older save from an owner who only cools (comfort 72, "eco" 80): 80 stays the cooling setback, and heating mirrors to 64 - never 80 of heat in winter',
       L.eco.cool === 80 && L.eco.heat === 64, L);
    mode('heat');
  }

  // ── I. ...and the scheduler and the bay's buttons use it ──
  console.log('\n── I. the scheduler\'s setback and the bay buttons, on a thermostat in cool mode ──');
  {
    reset();
    const room = () => H.state.entities.find(e => e.entity_id === 'climate.room');
    room().state = 'cool'; room().attributes.temperature = 72; room().attributes.target_temp_low = null; room().attributes.target_temp_high = null;
    fs.writeFileSync(cfgPath, JSON.stringify({
      businessName: 'HA', setup: { completed: true }, server: { port: 3093 },
      booking: { open24Hours: true, openTime: '00:00', closeTime: '23:59', staffedAccess: true },
      bays: [{ id: 'hbay', name: 'H Bay', active: true, haDevices: [
        { entity_id: 'climate.room', name: 'Room', kind: 'climate', comfortTemp: 70, ecoTemp: 60, leadTimeMins: 15, setbackDelayMins: 10 } ] }],
      homeAssistant: { enabled: true, url: H.url, token: 'ha-test-token' }
    }));
    await new Promise(r => setTimeout(r, 30));
    const pad = n => String(n).padStart(2, '0'), ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, hm = t => pad(t.getHours()) + ':' + pad(t.getMinutes());
    const add = (id, s, e) => db.db.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date, duration_minutes, price_cents, status, created_at)
      VALUES (?, 'hbay', 'H Bay', 'Season Test', '', '', ?, ?, ?, ?, 60, 0, 'active', datetime('now', '-3 hours'))`).run(id, ymd(s), hm(s), hm(e), ymd(e));
    const now = Date.now(), at = m => new Date(now + m * 60000);
    add('hs-ended', at(-80), at(-20));   // its setback came due 10 minutes ago
    delete require.cache[require.resolve('./services/homeassistant')];
    const sched = require('./services/scheduler');
    H.state.calls.length = 0;
    await sched.checkBookings();
    const sets = () => H.state.calls.filter(c => c.service === 'set_temperature' && c.entity_id === 'climate.room').map(c => c.data);
    ok('I1 a session ended 20 minutes ago on a thermostat in COOL mode: the setback is 80, not the heating 60 (the scheduler reads the mode)',
       sets().length === 1 && sets()[0].temperature === 80, sets());
    db.db.prepare(`DELETE FROM bookings WHERE id='hs-ended'`).run();
    room().state = 'heat_cool'; room().attributes.temperature = null; room().attributes.target_temp_low = 60; room().attributes.target_temp_high = 80;
    add('hs-soon', at(5), at(65));       // its comfort came due 10 minutes ago (15 before)
    H.state.calls.length = 0;
    await sched.checkBookings();
    ok('I2 a session starting in 5 minutes on a thermostat in HEAT/COOL: comfort goes out as the range 68-72, and the thermostat moved',
       sets().length === 1 && sets()[0].target_temp_low === 68 && sets()[0].target_temp_high === 72 && room().attributes.target_temp_low === 68, sets());
    db.db.prepare(`DELETE FROM bookings WHERE id='hs-soon'`).run();
    room().state = 'cool'; room().attributes.temperature = 70; room().attributes.target_temp_low = null; room().attributes.target_temp_high = null;
    H.state.calls.length = 0;
    const seq = require('./services/sequence');
    const off = await seq.stopBay('hbay', { source: 'test' });
    ok('I3 the bay\'s own Off button on a cooling thermostat: idle 80, not 60', off.ok && sets().length === 1 && sets()[0].temperature === 80, { steps: off.steps, sets: sets() });
    room().state = 'off'; H.state.calls.length = 0;
    const on = await seq.startBay('hbay', { source: 'test' });
    const step = (on.steps || []).find(s => s.kind === 'ha_temp') || {};
    ok('I4 ...and its On button on a thermostat someone switched off: nothing sent, the step says why', on.ok && sets().length === 0 && /set to off/.test(String(step.skipped || '')), on.steps);
    db.db.prepare(`DELETE FROM automation_jobs WHERE booking_id IN ('hs-ended','hs-soon')`).run();
  }

  await H.stop();
  console.log(`\nHOME ASSISTANT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
