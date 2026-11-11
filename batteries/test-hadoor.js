// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// test-hadoor.js - A Z-WAVE LOCK THROUGH HOME ASSISTANT, AGAINST A LOCK THAT CAN
// REFUSE (feature/door-interface, Sep 21 2026)
//
// services/hadoor.js is driven against tools/homeassistant-standin.js, which
// answers zwave_js.set_lock_usercode / clear_lock_usercode / invoke_cc_api in
// the shapes the HA docs describe and speaks the real HA websocket. Every
// failure a lock can produce is here: it never confirms, it confirms late, it
// refuses, HA is unreachable, every slot is taken, the lock is dead, the code
// reads back masked, and the standing backup is used. Rule 29's shape holds:
// the stand-in can refuse, and nothing here is kinder than the real thing.
const fs = require('fs');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
const PORT = 18124;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { startHA } = require('./tools/homeassistant-standin');
  const H = await startHA({ port: PORT });

  // ── stage: the provider is Home Assistant, three booking slots, one backup ──
  {
    const p = './config.json'; let c = {};
    if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
    c.server = Object.assign({}, c.server, { adminPassword: 'x1', businessName: 'HA Door Facility' });
    delete c.server.adminAuth; delete c.server.adminAuthDefault; delete c.server.bootstrapAuth;
    c.setup = Object.assign({}, c.setup, { completed: true });
    c.doorAccess = { provider: 'ha' };
    c.homeAssistant = { enabled: true, url: H.url, token: 'ha-test-token', customActions: [],
      lock: { entityId: 'lock.front_door', slotFrom: 10, slotTo: 16, backupSlot: 30, backupCode: '', backupSetOn: '', mode: (typeof STAGE_MODE === 'string' ? STAGE_MODE : 'usercode') } };
    c.booking = Object.assign({}, c.booking, { staffedAccess: false, doorCodeLeadMins: 15, doorCodeLagMins: 15 });
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  }
  try { fs.unlinkSync('./bookings.db'); } catch {}
  const dbM = require('./services/db'); await dbM.initDb();
  const doorlock = require('./services/doorlock');
  const hadoor = require('./services/hadoor');
  const logHas = (ev, needle) => dbM.db.prepare(`SELECT detail FROM admin_log WHERE event=? ORDER BY rowid DESC LIMIT 20`).all(ev).some(r => !needle || String(r.detail || '').includes(needle));
  // FIVE DAYS AHEAD, ALWAYS (Oct 2026): this was the fixed date 2026-10-01 - five days out when it was written
  // on Sep 26 - and from Oct 2 every check that reads the session as upcoming (the reconcile setting a lost
  // code, a member's back-to-back slot) failed: a battery with a calendar date in it is a time bomb.
  const DAY = (() => { const t = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (5), 12); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); })();
  const mk = (id) => ({ id, name: 'Door ' + id, phone: '5550' + id.slice(-4), date: DAY, start_time: '10:00', end_time: '11:00', end_date: DAY, bay_name: 'Bay 1' });
  const insert = (id) => dbM.db.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES (?,'bay1','Bay 1',?,?,?,'10:00','11:00',?,60,0,'active')`).run(id, 'Door ' + id, '5550' + id.slice(-4), DAY, DAY);
  const setRef = (id, ref, pin) => dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=?, door_code=? WHERE id=?`).run(ref, pin, id);
  const reset = (f) => H.set(Object.assign({}, require('./tools/homeassistant-standin').DEFAULT_FAULTS, f || {}));

  console.log('── H0 the provider is wired into the dispatcher ──');
  ok('H0a provider() reads ha', doorlock.provider() === 'ha');
  ok('H0b providerConfigured(ha) with url+token+entity', doorlock.providerConfigured('ha') === true);
  ok('H0c an ha: ref routes to ha', doorlock.providerFor('ha:lock.front_door#10') === 'ha');
  ok('H0d capabilities: confirms, has a fallback, reports use, does not move a window',
     JSON.stringify(doorlock.capabilities('ha')) === JSON.stringify({ confirms: true, movesWindow: false, reportsUse: true, fallback: true, name: 'Home Assistant' }));
  ok('H0e a slot ref has no window of its own: follows-booking / moveWindow skipped',
     doorlock.windowMoveState('ha:lock.front_door#10') === 'follows-booking' && (await doorlock.moveDoorCodeWindow({ remotelock_person_id: 'ha:lock.front_door#10' })).skipped === true);

  console.log('── H1 create: a slot, a code, and the lock holds it ──');
  reset();
  insert('hb-1');
  const made = await doorlock.generateDoorCode(mk('hb-1'));
  setRef('hb-1', made.personId, made.pin);
  ok('H1a a ref in the ha:<entity>#<slot> shape, slot inside 10-12', /^ha:lock\.front_door#1[0-2]$/.test(made.personId), made.personId);
  ok('H1b a six-digit code (doorPinLength for a non-UniFi provider)', /^\d{6}$/.test(made.pin), made.pin);
  const slot1 = Number(made.personId.split('#')[1]);
  ok('H1c the stand-in lock holds exactly that code in that slot', H.lock.slots[slot1] && H.lock.slots[slot1].code === made.pin, H.lock.slots);
  ok('H1d HA was asked with the documented fields (entity_id, code_slot, usercode) and WITHOUT return_response - HA 400s a set that asks for one',
     H.state.calls.some(c => c.service === 'set_lock_usercode' && c.data.entity_id === 'lock.front_door' && c.data.code_slot === slot1 && c.data.usercode === made.pin && c.returnResponse === false));
  ok('H1e the owner log records the issue and NEVER the code', logHas('DOOR_CODE_CREATED', 'slot ' + slot1) && !logHas('DOOR_CODE_CREATED', made.pin));

  console.log('── H2 confirm: held, and masked read-back is still held ──');
  let c = await doorlock.confirmDoorCode(made.personId, mk('hb-1'));
  ok('H2a a code the lock holds confirms held', c.state === 'held', c);
  ok('H2b ...by asking the device (invoke_cc_api User Code get, no response asked) and then reading the slot HA holds (get_lock_usercode WITH return_response)',
     H.state.calls.some(x => x.service === 'invoke_cc_api' && x.data.command_class === 99 && x.data.method_name === 'get' && x.data.parameters[0] === slot1 && x.returnResponse === false)
     && H.state.calls.some(x => x.service === 'get_lock_usercode' && x.data.entity_id === 'lock.front_door' && x.data.code_slot === slot1 && x.returnResponse === true));
  reset({ maskCodes: true });
  c = await doorlock.confirmDoorCode(made.personId, mk('hb-1'));
  ok('H2c a lock that masks the code on read-back still confirms held (status is the proof)', c.state === 'held' && /masked/.test(c.detail), c);
  reset({ nullCodes: true });
  const made2 = await (async () => { insert('hb-2'); const m2 = await doorlock.generateDoorCode(mk('hb-2')); setRef('hb-2', m2.personId, m2.pin); return m2; })();
  c = await doorlock.confirmDoorCode(made2.personId, mk('hb-2'));
  ok('H2d a usercode that reads back null (in_use true) is held - in_use is the proof', c.state === 'held', c);
  reset();
  c = await doorlock.confirmDoorCode(made2.personId, Object.assign(mk('hb-2'), { door_code: '000000' }));
  ok('H2e a slot in use that reads back a DIFFERENT code is not held - and not failed either: pending, named', c.state === 'pending' && /different code/.test(c.detail), c);

  console.log('── H3 confirms late: pending, pending, then held ──');
  reset({ landsAfterReads: 2 });
  insert('hb-3');
  const made3 = await doorlock.generateDoorCode(mk('hb-3')); setRef('hb-3', made3.personId, made3.pin);
  // the hold's asks come a tick apart: the set is a minute old by then, so no re-ask (below)
  const ageSet = (ref) => { const v = hadoor._lastSet.get(ref); if (v) v.at -= 60000; };
  ageSet(made3.personId);
  const s1 = await doorlock.confirmDoorCode(made3.personId, mk('hb-3'));
  const s2 = await doorlock.confirmDoorCode(made3.personId, mk('hb-3'));
  const s3 = await doorlock.confirmDoorCode(made3.personId, mk('hb-3'));
  ok('H3a the first two asks are pending, the third is held', s1.state === 'pending' && s2.state === 'pending' && s3.state === 'held', [s1.state, s2.state, s3.state]);
  ok('H3b pending names what it saw', /empty|not read enabled/.test(s1.detail), s1.detail);

  console.log('── H3c RIGHT AFTER THE SET the lock is asked again for a few seconds (Sep 26 2026, the Yale: lands in ~3.5 s) ──');
  reset({ landsAfterReads: 2 });
  insert('hb-3c');
  const made3c = await doorlock.generateDoorCode(mk('hb-3c')); setRef('hb-3c', made3c.personId, made3c.pin);
  const gets3c0 = H.state.calls.filter(x => x.service === 'invoke_cc_api').length;
  const c3c = await doorlock.confirmDoorCode(made3c.personId, mk('hb-3c'));
  const gets3c = H.state.calls.filter(x => x.service === 'invoke_cc_api').length - gets3c0;
  ok('H3c one confirm straight after the set is HELD - it asked the lock again (three fresh reads), not a tick later', c3c.state === 'held' && gets3c === 3, { state: c3c.state, gets: gets3c });
  ok('H3d the HELD line gives the landing time and names what the first check saw', logHas('DOOR_CODE_HELD', 'Booking: hb-3c') && logHas('DOOR_CODE_HELD', 'the first check did not see it: slot'), null);
  reset({ landsAfterReads: 99 });
  insert('hb-3e');
  const made3e = await doorlock.generateDoorCode(mk('hb-3e')); setRef('hb-3e', made3e.personId, made3e.pin);
  const gets3e0 = H.state.calls.filter(x => x.service === 'invoke_cc_api').length;
  const c3e = await doorlock.confirmDoorCode(made3e.personId, mk('hb-3e'));
  ok('H3e a code that has not landed after the re-asks is pending - four reads at most, never an endless wait', c3e.state === 'pending' && H.state.calls.filter(x => x.service === 'invoke_cc_api').length - gets3e0 === 4, c3e);
  reset({});
  insert('hb-3f');
  const made3f = await doorlock.generateDoorCode(mk('hb-3f')); setRef('hb-3f', made3f.personId, made3f.pin);
  H.faults.batteryOut = true;
  const gets3f0 = H.state.calls.filter(x => x.service === 'invoke_cc_api').length;
  const c3f = await doorlock.confirmDoorCode(made3f.personId, mk('hb-3f'));
  ok('H3f a lock that does not answer the fresh read is not asked again right away (one read, pending, named)', c3f.state === 'pending' && /did not answer a fresh read/.test(c3f.detail) && H.state.calls.filter(x => x.service === 'invoke_cc_api').length - gets3f0 === 1, c3f);
  H.faults.batteryOut = false;
  dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE id IN ('hb-3c','hb-3e','hb-3f')`).run();   // give the slots back for H4

  console.log('── H4 the lock REFUSES the code - the three ways a refusal reaches a caller through HA ──');
  reset({ setRefused: true });
  insert('hb-4');
  const made4 = await doorlock.generateDoorCode(mk('hb-4')); setRef('hb-4', made4.personId, made4.pin);
  const callsBefore = H.state.calls.length;
  c = await doorlock.confirmDoorCode(made4.personId, mk('hb-4'));
  ok('H4a HA 400 at the set: create hands the ref back marked, confirm is FAILED at once without a read', made4.personId && c.state === 'failed' && /refused/.test(c.detail) && H.state.calls.length === callsBefore, c);
  ok('H4a2 ...and the owner log says HA refused it, never the code', logHas('DOOR_CODE_ERROR', 'refused the code') && !logHas('DOOR_CODE_ERROR', made4.pin));
  reset({ setError: true });
  let threw4 = null; try { await doorlock.generateDoorCode(mk('hb-4b')); } catch (e) { threw4 = e.message; }
  ok('H4b HA 500 at the set (a HomeAssistantError inside the integration): create THROWS - the job retries with backoff', /HA 500/.test(threw4 || ''), threw4);
  reset({ setDropped: true });
  insert('hb-4c');
  const made4c = await doorlock.generateDoorCode(mk('hb-4c')); setRef('hb-4c', made4c.personId, made4c.pin);
  c = await doorlock.confirmDoorCode(made4c.personId, mk('hb-4c'));
  ok('H4c HA 200 but the lock never stored it (the SetValueResult HA discards): create succeeds, confirm is PENDING "reads empty" - the hold decides, never a silent held', c.state === 'pending' && /empty/.test(c.detail), c);

  console.log('── H5 Home Assistant unreachable ──');
  reset({ down: true });
  let threw = null; try { await doorlock.generateDoorCode(mk('hb-5')); } catch (e) { threw = e.message; }
  ok('H5a create THROWS (the job retries with backoff)', !!threw, threw);
  c = await doorlock.confirmDoorCode(made.personId, mk('hb-1'));
  ok('H5b confirm answers PENDING, never failed - the code may well be on the lock', c.state === 'pending' && /did not answer/.test(c.detail), c);
  ok('H5c revoke answers ok:false with the reason', (await doorlock.revokeDoorCode(made.personId)).ok === false);
  reset({ rejectToken: true });
  c = await doorlock.confirmDoorCode(made.personId, mk('hb-1'));
  ok('H5d a rejected token is pending too (HA 401), not a silent held', c.state === 'pending', c);

  console.log('── H6 every slot is taken ──');
  reset();
  // hb-1, hb-2, hb-3 hold 10, 11, 12; the H4 rows hold 13-15. Free those and narrow
  // the owner's range to 10-12 (config is re-read on every call), so the lock is
  // genuinely full for the next booking - the way a busy evening fills it.
  for (const id of ['hb-4', 'hb-4b', 'hb-4c']) dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE id=?`).run(id);
  { const c = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c.homeAssistant.lock.slotTo = 12; fs.writeFileSync('./config.json', JSON.stringify(c, null, 2)); }
  const used = hadoor.usedSlots('lock.front_door');
  ok('H6a three bookings hold slots 10, 11, 12', used.size === 3 && [10, 11, 12].every(s => used.has(s)), [...used]);
  threw = null; try { await doorlock.generateDoorCode(mk('hb-6')); } catch (e) { threw = e.message; }
  ok('H6b a fourth create is refused, naming the range', /no free code slot/.test(threw || ''), threw);
  ok('H6c ...and the owner log says what to do', logHas('DOOR_CODE_ERROR', 'widen the slot range'));
  ok('H6d the backup slot (30) is never handed to a booking', !used.has(30) && hadoor.freeSlot('lock.front_door') === null);
  const rv = await doorlock.revokeDoorCode(made3.personId);
  dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE id='hb-3'`).run();
  ok('H6e revoking one frees its slot: clear_lock_usercode was called and the stand-in slot is gone', rv.ok === true && !H.lock.slots[Number(made3.personId.split('#')[1])]);
  ok('H6f the freed slot is the next one handed out', hadoor.freeSlot('lock.front_door') === Number(made3.personId.split('#')[1]));

  console.log('── H7 the lock is dead ──');
  reset({ lockDead: true });
  c = await doorlock.confirmDoorCode(made.personId, mk('hb-1'));
  ok('H7a a dead lock (entity unavailable) confirms FAILED, not pending', c.state === 'failed' && /unavailable|dead/.test(c.detail), c);
  insert('hb-7');
  const made7 = await doorlock.generateDoorCode(mk('hb-7')); setRef('hb-7', made7.personId, made7.pin);
  c = await doorlock.confirmDoorCode(made7.personId, mk('hb-7'));
  ok('H7b create against a dead lock: HA answers 400 (not currently available) - the ref comes back marked and confirm is failed at once, so the fallback flow runs instead of a job retrying a dead node', c.state === 'failed' && /refused/.test(c.detail), c);
  dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE id='hb-7'`).run();   // give slot 12 back for H10 (the scheduler's revoke does this on a real unit)

  console.log('── H8 revoke ──');
  reset();
  ok('H8a a code the lock holds is cleared (ok:true)', (await doorlock.revokeDoorCode(made.personId)).ok === true && !H.lock.slots[slot1]);
  ok('H8b clearing again is ok:true (already gone)', (await doorlock.revokeDoorCode(made.personId)).ok === true);
  ok('H8c an empty ref is nothing to revoke', (await doorlock.revokeDoorCode('')).ok === true);
  ok('H8d the log records the clear, never a code', logHas('DOOR_CODE_REVOKED', 'slot ' + slot1));

  console.log('── H9 the standing backup code ──');
  reset();
  const fb = await doorlock.fallbackDoorCode(mk('hb-1'));
  ok('H9a a fallback code comes back, six digits', fb && /^\d{6}$/.test(fb.pin) && fb.kind === 'backup', fb);
  ok('H9b it sits in the backup slot on the lock', H.lock.slots[30] && H.lock.slots[30].code === fb.pin, H.lock.slots[30]);
  const cfgNow = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
  ok('H9c config carries it with the day it was set', cfgNow.homeAssistant.lock.backupCode === fb.pin && /^\d{4}-\d{2}-\d{2}$/.test(cfgNow.homeAssistant.lock.backupSetOn));
  const fb2 = await doorlock.fallbackDoorCode(mk('hb-1'));
  ok('H9d asked again the same day, it is the SAME code - not re-minted per booking', fb2.pin === fb.pin);
  const forced = await hadoor.ensureBackup(true);
  ok('H9e "Set a new backup code now" rotates it', forced.pin && forced.pin !== fb.pin && forced.fresh === true && H.lock.slots[30].code === forced.pin);
  reset({ setRefused: true });
  const fbFail = await hadoor.ensureBackup(true);
  ok('H9f a lock that refuses a NEW backup keeps the old one - a day-old code still on the lock beats none - and says it is stale',
     fbFail.pin === forced.pin && fbFail.stale === true && JSON.parse(fs.readFileSync('./config.json', 'utf8')).homeAssistant.lock.backupCode === forced.pin, fbFail);
  ok('H9f2 ...and the owner log says the rotation failed and which code was kept', logHas('DOOR_BACKUP_CODE_ERROR', 'keeping the one set'));
  { // with NO old code at all, a refused backup is honestly ok:false
    const c = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c.homeAssistant.lock.backupCode = ''; c.homeAssistant.lock.backupSetOn = ''; fs.writeFileSync('./config.json', JSON.stringify(c, null, 2));
    const none = await hadoor.ensureBackup(true);
    ok('H9f3 with no backup ever set, a refused set is ok:false - nothing is invented', none.ok === false && !none.pin, none);
  }
  reset(); await hadoor.ensureBackup(true);   // put a fresh one back for H10
  ok('H9g the backup code is on the list the config route MASKS (never reaches a browser)', require('fs').readFileSync('services/auth.js', 'utf8').includes("'homeAssistant.lock.backupCode'"));
  ok('H9h the owner log records the backup was set, never the code', logHas('DOOR_BACKUP_CODE_SET', 'backup slot 30') && !logHas('DOOR_BACKUP_CODE_SET', forced.pin));

  console.log('── H10 the keypad event over the REAL websocket ──');
  reset();
  insert('hb-10');
  const made10 = await doorlock.generateDoorCode(mk('hb-10')); setRef('hb-10', made10.personId, made10.pin);
  const slot10 = Number(made10.personId.split('#')[1]);
  // THE LISTENER FOLLOWS THE LOCK (Sep 26 2026, found on the bench): nothing started it here - a lock
  // set up after the unit booted. The tick's watch() must start it.
  const wsBefore = hadoor.eventsState().connected;
  await hadoor.watch();
  for (let i = 0; i < 40 && !hadoor.eventsState().connected; i++) await sleep(100);
  ok('H10a a lock set up after boot is listened to: the tick\'s watch() opened the websocket and authenticated', wsBefore === false && hadoor.eventsState().connected && H.wsClients() === 1, { wsBefore, st: hadoor.eventsState() });
  hadoor.startEvents(); await hadoor.watch(); await sleep(200);
  ok('H10a2 ...and only once: another start or tick does not open a second connection', H.wsClients() === 1, H.wsClients());
  ok('H10b it subscribed to zwave_js_notification', H.state.requests.some(r => r.ws && r.msg.type === 'subscribe_events' && r.msg.event_type === 'zwave_js_notification'));
  const delivered = H.fireKeypadUnlock(slot10);
  for (let i = 0; i < 30 && !hadoor.eventsState().seen; i++) await sleep(100);
  const row10 = dbM.db.prepare(`SELECT door_used_at FROM bookings WHERE id='hb-10'`).get();
  ok('H10c a keypad unlock with that slot stamps the booking as used', delivered === 1 && row10 && !!row10.door_used_at, { delivered, row10 });
  ok('H10d ...and the owner log records the ARRIVAL against the booking, naming the slot, not the code (Sep 26 2026)', logHas('DOOR_ARRIVAL', 'Booking: hb-10') && logHas('DOOR_ARRIVAL', 'slot ' + slot10) && !logHas('DOOR_ARRIVAL', made10.pin));
  // WHO, WHEN AND WHICH SESSION IN ONE LINE (Oct 2026; maintainer, Sep 29 - shown, not only stored)
  ok('H10d2 the arrival line names the customer, the date and tee time, and the bay - not only the booking id', logHas('DOOR_ARRIVAL', 'Door hb-10') && logHas('DOOR_ARRIVAL', DAY + ' 10:00 on Bay 1'));
  { const st = fs.readFileSync('./routes/staff.js', 'utf8'), ad = fs.readFileSync('./public/admin.html', 'utf8'), sp = fs.readFileSync('./public/staff.html', 'utf8');
    ok('H10d3 the arrival is SHOWN: the staff pad\'s Today carries it and draws "Arrived <time>", the owner\'s Bookings list draws it under the code',
       /signature_name, door_used_at\s+FROM bookings/.test(st) && /arrived_at: b\.door_used_at/.test(st) && /class="badge arrived">Arrived ' \+ esc\(at\.toLocaleTimeString/.test(sp) &&
       /b\.door_used_at \? `<div[^`]*>Arrived \$\{arrivedAt\(b\.door_used_at\)\}/.test(ad) && /function arrivedAt\(utc\)/.test(ad)); }
  H.fireKeypadUnlock(30); await sleep(200);
  ok('H10e the backup slot being used is logged as the backup', logHas('DOOR_BACKUP_CODE_USED', 'slot 30'));
  H.fireKeypadUnlock(7); await sleep(200);
  ok('H10f a slot no booking holds is logged, with no booking', logHas('DOOR_CODE_USED', 'slot 7 used at the keypad - no booking holds it'));
  hadoor._onNotification({ data: { command_class: 113, type: 7, event: 6, parameters: { userId: slot10 } } });
  { // rule 29: a keypad report the unit cannot record is itself recorded, never dropped silently
    const dlm = require('./services/doorlock'), cw = dlm.codeWindow;
    dlm.codeWindow = () => { throw new Error('stand-in: the window could not be read'); };
    try { hadoor._onNotification({ data: { command_class: 113, type: 6, event: 6, parameters: { userId: slot10 } } }); } finally { dlm.codeWindow = cw; }
    ok('H10h a keypad report that cannot be matched is recorded (HA_DOOR_EVENTS_ERROR, naming the slot), never dropped', logHas('HA_DOOR_EVENTS_ERROR', 'slot ' + slot10));
  }
  ok('H10g a notification that is not Access Control is ignored', dbM.db.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event IN ('DOOR_ARRIVAL','DOOR_CODE_USED') AND detail LIKE '%hb-10%'`).get().c === 1);
  hadoor.stopEvents();

  console.log('── H11 the Test button tells the owner the truth ──');
  reset();
  const t = await hadoor.testLock();
  ok('H11a test reads the lock state, the slot range and the probe', t.ok === true && t.state === 'locked' && t.slotFrom === 10 && t.slotTo === 12 && t.backupSlot === 30 && t.probe && t.probe.slot === 10, t);
  ok('H11b it says whether the lock reads codes back, and whether the probe slot is in use (true / false / null = unknown)', typeof t.probe.readsCode === 'boolean' && [true, false, null].includes(t.probe.inUse));
  ok('H11c a non-lock entity is refused by name', /not a lock/.test((await hadoor.testLock({ entityId: 'switch.bay1_power' })).error || ''));
  ok('H11d an entity HA does not have is refused', (await hadoor.testLock({ entityId: 'lock.no_such' })).ok === false);
  reset({ down: true });
  ok('H11e HA down: the test says so instead of pretending', (await hadoor.testLock()).ok === false);

  console.log('── H13 THE CREDENTIAL PATH (Home Assistant 2026.6+): set_user answers with the slot, refusals come back at set time ──');
  const restage = () => { const c = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c.homeAssistant.lock.mode = STAGE_MODE; c.homeAssistant.lock.caps = null; c.homeAssistant.lock.slotTo = 16; c.homeAssistant.lock.backupCode = ''; c.homeAssistant.lock.backupSetOn = ''; fs.writeFileSync('./config.json', JSON.stringify(c, null, 2)); };
  const clearRefs = () => dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE remotelock_person_id LIKE 'ha:%'`).run();
  // a CREDENTIAL-ONLY lock (no User Code CC): the one kind that takes this path now - a User Code lock
  // is read back from the lock itself (Sep 26 2026)
  STAGE_MODE = ''; restage(); reset({ noUserCode: true }); hadoor._resetMode(); clearRefs(); H.lock.slots = {};
  { // every H13 booking gets its own rows; the lock is empty
    for (const id of ['hc-1', 'hc-2', 'hc-3', 'hc-4', 'hc-5']) insert(id);
  }
  let t13 = await hadoor.testLock();
  ok('H13a Test asks get_credential_capabilities and picks the credential path, naming the release and the limits', t13.ok === true && t13.mode === 'credentials' && /2026\.6/.test(t13.modeWhy) && t13.caps && t13.caps.pinMin === 4 && t13.caps.pinMax === 10 && t13.canManageCodes === true, t13);
  ok('H13b ...and remembers it in config (mode + the capabilities)', JSON.parse(fs.readFileSync('./config.json', 'utf8')).homeAssistant.lock.mode === 'credentials' && JSON.parse(fs.readFileSync('./config.json', 'utf8')).homeAssistant.lock.caps.maxUsers === 30);
  const mc1 = await doorlock.generateDoorCode(mk('hc-1')); setRef('hc-1', mc1.personId, mc1.pin);
  ok('H13c create goes through set_user with user_id in the owner\'s range, a pin_code credential, and asks for the response', H.state.calls.some(c => c.service === 'set_user' && c.returnResponse === true && c.data.user_id === 10 && c.data.credential_type === 'pin_code' && c.data.credential_data === mc1.pin && c.data.user_type === 'general'), H.state.calls.filter(c => c.service === 'set_user').map(c => c.data));
  ok('H13d the ref carries the user and the credential slot HA handed back (ha:<entity>#u10c10), the lock holds the code', mc1.personId === 'ha:lock.front_door#u10c10' && H.lock.slots[10] && H.lock.slots[10].code === mc1.pin, mc1.personId);
  ok('H13e the log records the issue with the user and slot, never the code', logHas('DOOR_CODE_CREATED', 'user 10, credential slot 10') && !logHas('DOOR_CODE_CREATED', mc1.pin));
  c = await doorlock.confirmDoorCode(mc1.personId, mk('hc-1'));
  ok('H13f confirm reads get_users and is HELD when the user lists a PIN credential - and says the digits are never read back on this path', c.state === 'held' && /PIN credential/.test(c.detail) && /never read back/.test(c.detail) && H.state.calls.some(x => x.service === 'get_users' && x.returnResponse === true), c);
  reset({ noUserCode: true, usersLandAfterReads: 2 });
  const mc2 = await doorlock.generateDoorCode(mk('hc-2')); setRef('hc-2', mc2.personId, mc2.pin);
  const w1 = await doorlock.confirmDoorCode(mc2.personId, mk('hc-2')), w2 = await doorlock.confirmDoorCode(mc2.personId, mk('hc-2')), w3 = await doorlock.confirmDoorCode(mc2.personId, mk('hc-2'));
  ok('H13g confirms late: get_users lists the user only after the driver catches up - pending, pending, held', w1.state === 'pending' && w2.state === 'pending' && w3.state === 'held', [w1.state, w2.state, w3.state]);
  reset({ noUserCode: true, rejectSets: 1 });
  { // a duplicate PIN: HA 500 "already registered" -> re-minted, never handed to a second customer
    const before = H.state.calls.filter(x => x.service === 'set_user').length;
    const mc3 = await doorlock.generateDoorCode(mk('hc-3')); setRef('hc-3', mc3.personId, mc3.pin);
    const tries = H.state.calls.filter(x => x.service === 'set_user').length - before;
    ok('H13h a code the lock refuses as a duplicate is re-minted: two set_user calls with two different codes, the second held', tries === 2 && /#u12c12$/.test(mc3.personId) && H.lock.slots[12].code === mc3.pin && H.state.calls.filter(x => x.service === 'set_user').slice(-2).map(x => x.data.credential_data).filter((v, i, a) => a.indexOf(v) === i).length === 2, { tries, ref: mc3.personId });
  }
  reset({ noUserCode: true, rejectSets: 10 });
  { // a lock that refuses every code: after four tries the ref comes back marked, confirm fails at once, the fallback flow runs
    insert('hc-3b');
    const mcx = await doorlock.generateDoorCode(mk('hc-3b')); setRef('hc-3b', mcx.personId, mcx.pin);
    const cx = await doorlock.confirmDoorCode(mcx.personId, mk('hc-3b'));
    ok('H13h2 a lock that refuses every code: four tries, then the ref is marked and confirm is FAILED at once (the fallback flow)', cx.state === 'failed' && /refused/.test(cx.detail) && logHas('DOOR_CODE_ERROR', 'refused every code'), cx);
    dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE id='hc-3b'`).run();
  }
  reset({ noUserCode: true });
  { // an occupied slot: HA 500 "already in use" -> the next free slot
    H.lock.slots[13] = { code: '999999', reportsLeft: 0 };   // something the owner put there by hand, unknown to this unit
    const mc4 = await doorlock.generateDoorCode(mk('hc-4')); setRef('hc-4', mc4.personId, mc4.pin);
    ok('H13i a slot something else occupies is skipped: HA refuses it as occupied and the next free slot is used', /#u14c14$/.test(mc4.personId) && H.lock.slots[14].code === mc4.pin, mc4.personId);
    delete H.lock.slots[13];
  }
  { // no slot free at all: HA 400 -> the ref comes back marked refused, confirm fails at once (the fallback flow)
    const c0 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c0.homeAssistant.lock.slotTo = 11; fs.writeFileSync('./config.json', JSON.stringify(c0, null, 2));
    H.lock.slots[11] = { code: '424242', reportsLeft: 0 };
    let threw13 = null; try { await doorlock.generateDoorCode(mk('hc-5')); } catch (e) { threw13 = e.message; }
    ok('H13j every slot in the owner\'s range taken: refused before HA is asked, naming the range', /no free code slot/.test(threw13 || ''), threw13);
    delete H.lock.slots[11];
    const c1 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c1.homeAssistant.lock.slotTo = 16; fs.writeFileSync('./config.json', JSON.stringify(c1, null, 2));
  }
  reset({ noUserCode: true, pinMin: 8, pinMax: 8 });
  hadoor._resetMode(); { const c2 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c2.homeAssistant.lock.mode = ''; c2.homeAssistant.lock.caps = null; fs.writeFileSync('./config.json', JSON.stringify(c2, null, 2)); }
  t13 = await hadoor.testLock();
  const mc5 = await doorlock.generateDoorCode(mk('hc-5')); setRef('hc-5', mc5.personId, mc5.pin);
  ok('H13k a lock that wants 8-digit PINs gets 8 digits: the length follows get_credential_capabilities, not the unit\'s default', t13.caps.pinMin === 8 && /^\d{8}$/.test(mc5.pin), { caps: t13.caps, pin: mc5.pin });
  reset({ noUserCode: true });
  ok('H13l revoke deletes the user (delete_user, no response asked)', (await doorlock.revokeDoorCode(mc1.personId)).ok === true && !H.lock.slots[10] && H.state.calls.some(x => x.service === 'delete_user' && x.data.user_id === 10 && x.returnResponse === false));
  ok('H13m revoking again is ok:true (HA says the slot is empty)', (await doorlock.revokeDoorCode(mc1.personId)).ok === true);
  reset({ noUserCode: true, down: true });
  c = await doorlock.confirmDoorCode(mc2.personId, mk('hc-2'));
  ok('H13n HA unreachable: confirm is pending on this path too', c.state === 'pending', c);
  reset({ noUserCode: true }); { const c3 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c3.homeAssistant.lock.mode = ''; c3.homeAssistant.lock.caps = null; c3.homeAssistant.lock.backupCode = ''; c3.homeAssistant.lock.backupSetOn = ''; fs.writeFileSync('./config.json', JSON.stringify(c3, null, 2)); } hadoor._resetMode();
  const fb13 = await hadoor.ensureBackup(true);
  ok('H13o the standing backup code goes through set_user on the backup slot', fb13.pin && H.lock.slots[30] && H.lock.slots[30].code === fb13.pin && H.state.calls.some(x => x.service === 'set_user' && x.data.user_id === 30));
  const fb13b = await hadoor.ensureBackup(true);
  ok('H13p rotating it when the slot is occupied: HA refuses, the old user is deleted, the new code set', fb13b.pin !== fb13.pin && H.lock.slots[30].code === fb13b.pin && H.state.calls.some(x => x.service === 'delete_user' && x.data.user_id === 30));

  console.log('── H14 an older Home Assistant, and a lock that cannot manage codes ──');
  reset({ haOld: true }); hadoor._resetMode(); { const c4 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c4.homeAssistant.lock.mode = ''; c4.homeAssistant.lock.caps = null; fs.writeFileSync('./config.json', JSON.stringify(c4, null, 2)); }
  t13 = await hadoor.testLock();
  ok('H14a HA older than 2026.6 (400 Service not found): Test says the User Code path is used and why', t13.ok === true && t13.mode === 'usercode' && /older than 2026\.6|read back from the lock itself/.test(t13.modeWhy) && t13.probe && typeof t13.probe.readsCode === 'boolean', t13);
  insert('hc-6');
  const mc6 = await doorlock.generateDoorCode(mk('hc-6')); setRef('hc-6', mc6.personId, mc6.pin);
  ok('H14b ...and create takes the User Code path (set_lock_usercode, a plain #slot ref) without anyone changing a setting', /^ha:lock\.front_door#\d+$/.test(mc6.personId) && H.state.calls.some(x => x.service === 'set_lock_usercode' && x.data.usercode === mc6.pin), mc6.personId);
  ok('H14c confirm on that ref reads the slot back (the User Code path)', (await doorlock.confirmDoorCode(mc6.personId, mk('hc-6'))).state === 'held');
  { // a modern HA whose mode was remembered as credentials, then downgraded: the 400 at set time flips the path for good
    reset({ noUserCode: true }); hadoor._resetMode(); { const c5 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c5.homeAssistant.lock.mode = 'credentials'; fs.writeFileSync('./config.json', JSON.stringify(c5, null, 2)); }
    H.set({ haOld: true });
    insert('hc-7');
    const mc7 = await doorlock.generateDoorCode(mk('hc-7')); setRef('hc-7', mc7.personId, mc7.pin);
    ok('H14d a remembered credential path meeting a 400 at set time falls back to the User Code path and records the switch', /^ha:lock\.front_door#\d+$/.test(mc7.personId) && JSON.parse(fs.readFileSync('./config.json', 'utf8')).homeAssistant.lock.mode === 'usercode' && logHas('HA_DOOR_PATH', 'no credential actions after all'), mc7.personId);
  }
  reset({ noUserCode: true, noAccessControl: true }); hadoor._resetMode(); { const c6 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c6.homeAssistant.lock.mode = ''; c6.homeAssistant.lock.caps = null; fs.writeFileSync('./config.json', JSON.stringify(c6, null, 2)); }
  t13 = await hadoor.testLock();
  ok('H14e a lock Z-Wave JS cannot manage codes on (500 not supported): Test says so plainly, ok:false, canManageCodes false', t13.ok === false && t13.mode === 'none' && t13.canManageCodes === false && /cannot manage codes/.test(t13.error || ''), t13);
  insert('hc-8');
  let threw14 = null; try { await doorlock.generateDoorCode(mk('hc-8')); } catch (e) { threw14 = e.message; }
  ok('H14f ...and create refuses with the reason instead of pretending', /cannot manage codes/.test(threw14 || '') && logHas('DOOR_CODE_ERROR', 'cannot manage codes'), threw14);
  reset(); STAGE_MODE = 'usercode'; restage(); hadoor._resetMode();

  console.log('── H12 the stand-in grades a request the way HA does - so the wrong call is caught here, not on an owner\'s lock ──');
  // Sep 21 2026: the first cut of this provider asked set_lock_usercode and invoke_cc_api for a
  // response and read a Supervision result out of it; HA's api view 400s both (services.py
  // registers neither with supports_response) and the first stand-in answered anyway. These
  // hold the stand-in to HA's own grading [R2][R3].
  reset();
  const raw = async (path, body) => { const r = await fetch(H.url + path, { method: 'POST', headers: { Authorization: 'Bearer ' + H.faults.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  let r = await raw('/api/services/zwave_js/set_lock_usercode?return_response', { entity_id: 'lock.front_door', code_slot: 11, usercode: '123456' });
  ok('H12a set_lock_usercode?return_response is a 400 with HA\'s own words', r.status === 400 && /does not support responses/.test(r.body && r.body.message), r);
  r = await raw('/api/services/zwave_js/invoke_cc_api?return_response', { entity_id: 'lock.front_door', command_class: 99, method_name: 'get', parameters: [11] });
  ok('H12b invoke_cc_api?return_response is a 400 too - it never carried a User Code slot', r.status === 400 && /does not support responses/.test(r.body && r.body.message), r);
  r = await raw('/api/services/zwave_js/get_lock_usercode', { entity_id: 'lock.front_door', code_slot: 11 });
  ok('H12c get_lock_usercode WITHOUT return_response is a 400 (SupportsResponse.ONLY)', r.status === 400 && /requires responses/.test(r.body && r.body.message), r);
  r = await raw('/api/services/zwave_js/set_lock_usercode', { entity_id: 'lock.front_door', code_slot: 11, usercode: '123456' });
  ok('H12d a set that HA takes answers 200 with the changed_states LIST and nothing about the lock', r.status === 200 && Array.isArray(r.body), r);
  r = await raw('/api/services/zwave_js/get_lock_usercode?return_response', { entity_id: 'lock.front_door', code_slot: 11 });
  ok('H12e get_lock_usercode answers {changed_states, service_response:{"<entity>":{"<slot>":{usercode,in_use}}}}', r.status === 200 && r.body && Array.isArray(r.body.changed_states) && r.body.service_response && r.body.service_response['lock.front_door'] && r.body.service_response['lock.front_door']['11'] && r.body.service_response['lock.front_door']['11'].in_use === true && r.body.service_response['lock.front_door']['11'].usercode === '123456', r.body);
  r = await raw('/api/services/zwave_js/get_lock_usercode?return_response', { entity_id: 'lock.front_door', code_slot: 250 });
  ok('H12f a slot the lock lacks is a 500 (get_lock_usercode_not_found)', r.status === 500, r);
  r = await raw('/api/services/zwave_js/no_such_service', { entity_id: 'lock.front_door' });
  ok('H12g an unknown service is a 400', r.status === 400, r);
  await raw('/api/services/zwave_js/clear_lock_usercode', { entity_id: 'lock.front_door', code_slot: 11 });

  // ═══ Sep 26 2026: what was proven live on the Yale, held here against the stand-in ═══
  const cfgSet = (fn) => { const c = JSON.parse(fs.readFileSync('./config.json', 'utf8')); fn(c); fs.writeFileSync('./config.json', JSON.stringify(c, null, 2)); };
  const emptyLock = () => { for (const k of Object.keys(H.lock.slots)) delete H.lock.slots[k]; };
  const uh = require('./services/unithealth');
  const doorSig = () => { uh._reset(); uh.noteTick(); return uh.compute().signals.find(x => x.key === 'doorcodes'); };
  const put = (slot, code) => { H.lock.slots[slot] = { code: String(code), reportsLeft: 0 }; };
  cfgSet(c => { c.alerts = { ownerMobile: '+15550009999' }; });
  dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL, door_code=NULL`).run();

  console.log('── H15 Home Assistant unreachable: said at once, red after a minute, the owner told at five, the lock put right on return ──');
  reset({ slotCap: 45 }); emptyLock(); hadoor._resetReach();
  dbM.db.prepare(`DELETE FROM admin_log WHERE event IN ('OWNER_ALERT','HA_DOOR_UNREACHABLE','HA_DOOR_BACK','DOOR_RECONCILE','DOOR_RECONCILE_SET','DOOR_RECONCILE_CLEARED','HA_DOOR_JOBS_RETRIED')`).run();
  const bk = hadoor.lockCfg();
  // the unit's record: two live bookings, one that finished; the lock: the first holds its code, the
  // second's code is missing, the finished one's is still there, a stranger sits in slot 15 and the
  // owner's own code is in slot 40 (outside the range)
  insert('hb-15a'); insert('hb-15b'); insert('hb-15c');
  dbM.db.prepare(`UPDATE bookings SET date='2026-01-05', end_date='2026-01-05' WHERE id='hb-15c'`).run();
  setRef('hb-15a', 'ha:lock.front_door#10', '410010'); put(10, '410010');
  setRef('hb-15b', 'ha:lock.front_door#11', '410011');
  setRef('hb-15c', 'ha:lock.front_door#12', '410012'); put(12, '410012');
  put(15, '999015'); put(40, '777040');
  if (bk.backupCode) put(bk.backupSlot, bk.backupCode);
  const automation_ = require('./services/automation');
  automation_.ensureJob({ booking_id: 'hb-15b', kind: 'door_code', due_at: new Date(Date.now() - 60000), deadline_at: new Date(Date.now() + 3600000) });
  dbM.db.prepare(`UPDATE automation_jobs SET status='failed', attempts=3, next_attempt_at=datetime('now','+30 minutes') WHERE booking_id='hb-15b' AND kind='door_code'`).run();

  H.set({ down: true });
  const T0 = Date.now() - 61000;
  const x1 = await hadoor.watch({ now: T0 });
  ok('H15a HA not answering: watch says so and the owner log records it once (HA_DOOR_UNREACHABLE)', x1.ok === false && logHas('HA_DOOR_UNREACHABLE', 'door codes cannot be set or taken off'), x1);
  const sig15 = doorSig();
  ok('H15b a minute on, About > Health reads Door codes RED, saying no code can be set or taken off', sig15 && sig15.level === 'red' && /has not answered for 1 minute/.test(sig15.detail) && /No door code can be set or taken off/.test(sig15.detail), sig15);
  await hadoor.watch({ now: T0 + 3 * 60000 });
  ok('H15c no owner alert before five minutes', !logHas('OWNER_ALERT', 'ha-door-down'));
  await hadoor.watch({ now: T0 + 5 * 60000 - 200 });   // the fifth tick lands a hair early (Sep 26, the bench: the text waited a sixth)
  ok('H15d at five minutes the owner is told (OWNER_ALERT ha-door-down) in plain words', logHas('OWNER_ALERT', 'ha-door-down') && logHas('OWNER_ALERT', 'has not answered for 5 minutes'));
  await hadoor.watch({ now: T0 + 6 * 60000 });
  ok('H15e ...once, not every minute after', dbM.db.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event='OWNER_ALERT'`).get().c === 1);
  let threw15 = null; insert('hb-15d'); try { await doorlock.generateDoorCode(mk('hb-15d')); } catch (e) { threw15 = e.message; }
  ok('H15f a code due while HA is down is not faked: create throws, so the job backs off and retries', !!threw15, threw15);

  H.set({ down: false });
  const x2 = await hadoor.watch({ now: T0 + 12 * 60000 });
  ok('H15g HA back: HA_DOOR_BACK names how long it was gone', x2.ok === true && logHas('HA_DOOR_BACK', 'after 12 min'), x2);
  ok('H15h the door jobs that were waiting run now (HA_DOOR_JOBS_RETRIED, the job pending with no backoff)', logHas('HA_DOOR_JOBS_RETRIED', '1 door job') && dbM.db.prepare(`SELECT status, attempts FROM automation_jobs WHERE booking_id='hb-15b' AND kind='door_code'`).get().status === 'pending');
  ok('H15i reconcile SETS the code the lock lost, from the unit\'s record', H.lock.slots[11] && H.lock.slots[11].code === '410011' && logHas('DOOR_RECONCILE_SET', 'slot 11') && logHas('DOOR_RECONCILE_SET', 'Booking: hb-15b'));
  ok('H15j ...CLEARS the finished booking\'s code and the stranger in its range', !H.lock.slots[12] && !H.lock.slots[15] && logHas('DOOR_RECONCILE_CLEARED', 'slot 12') && logHas('DOOR_STRANGER_CLEARED', 'slot 15'));
  ok('H15k ...leaves the code it already holds alone, and NEVER touches a slot outside its range (item 7)', H.lock.slots[10] && H.lock.slots[10].code === '410010' && H.lock.slots[40] && H.lock.slots[40].code === '777040'
     && !H.state.calls.some(x => (x.data || {}).code_slot === 40 || ((x.data || {}).parameters || [])[0] === 40));
  // maintainer's ruling (Sep 26 2026): a stranger in the range is cleared, but never silently
  ok('H15o the stranger (slot 15, a code this unit never issued) is logged as one, naming the reserved range', logHas('DOOR_STRANGER_CLEARED', 'slot 15 on lock.front_door held a code this booking system never issued') && logHas('DOOR_STRANGER_CLEARED', 'Slots 10-16 and 30 are reserved'));
  ok('H15p ...the finished booking\'s own code (slot 12) is a tidy-up, not a stranger', !logHas('DOOR_STRANGER_CLEARED', 'slot 12 ') && logHas('DOOR_RECONCILE_CLEARED', 'slot 12 '));
  ok('H15q ...and the owner is texted once, naming slot 15 and where their own codes go - not slot 12', dbM.db.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event='OWNER_ALERT' AND detail LIKE 'door-stranger-%'`).get().c === 1 && logHas('OWNER_ALERT', 'door-stranger-15 |') && logHas('OWNER_ALERT', 'had a code in slot 15 that this booking system never issued'));
  ok('H15r the lock card says the slots are reserved and the owner is texted (Settings > Devices)', /These slots are reserved for booking codes\.<\/b> Any code the unit finds in them that no booking needs is removed, written in the Log tab, and you are texted/.test(fs.readFileSync('./public/admin.html', 'utf8')));
  ok('H15l ...and writes one summary line', logHas('DOOR_RECONCILE', 'back after 12 min') && logHas('DOOR_RECONCILE', '1 set (11)') && logHas('DOOR_RECONCILE', '2 cleared (12, 15)'));
  const sig15b = doorSig();
  ok('H15m health is no longer red for the lock', !(sig15b && sig15b.level === 'red' && /has not answered/.test(sig15b.detail)), sig15b);
  put(15, '999015'); H.set({ batteryOut: true });
  const r15 = await hadoor.reconcile('a lock that does not answer');
  ok('H15n a reconcile that cannot READ a slot never clears or sets it (a failed read is not "empty")', r15.cleared.length === 0 && r15.set.length === 0 && r15.unreadable.length > 0 && H.lock.slots[15] && logHas('DOOR_RECONCILE', 'could not be read'), r15);
  H.set({ batteryOut: false }); delete H.lock.slots[15];
  dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL, door_code=NULL WHERE id LIKE 'hb-15%'`).run();

  console.log('── H16 members open the door with their own PIN; back-to-back keeps it in; it goes when the last booking ends ──');
  reset({ slotCap: 45 }); emptyLock();
  cfgSet(c => { c.homeAssistant.lock.memberPins = true; c.homeAssistant.lock.finishKey = ''; });
  dbM.db.prepare(`INSERT INTO members (id, tier_id, name, phone, pin, status) VALUES ('m-16','t-16','Mem Sixteen','+15550001616','4417','active')`).run();
  dbM.db.prepare(`INSERT INTO members (id, tier_id, name, phone, pin, status) VALUES ('m-16s','t-16','Mem Short','+15550001617','417','active')`).run();
  insert('hb-16a'); insert('hb-16b'); insert('hb-16c');
  dbM.db.prepare(`UPDATE bookings SET member_id='m-16' WHERE id IN ('hb-16a','hb-16b')`).run();
  dbM.db.prepare(`UPDATE bookings SET start_time='11:00', end_time='12:00' WHERE id='hb-16b'`).run();
  dbM.db.prepare(`UPDATE bookings SET member_id='m-16s' WHERE id='hb-16c'`).run();
  const bkA = Object.assign(mk('hb-16a'), { member_id: 'm-16' }), bkB = Object.assign(mk('hb-16b'), { member_id: 'm-16', start_time: '11:00', end_time: '12:00' });
  const m16a = await doorlock.generateDoorCode(bkA); setRef('hb-16a', m16a.personId, m16a.pin);
  const s16 = Number(m16a.personId.split('#')[1]);
  ok('H16a the member\'s own PIN goes into a slot of the unit\'s range', m16a.pin === '4417' && H.lock.slots[s16] && H.lock.slots[s16].code === '4417' && logHas('DOOR_CODE_CREATED', 'member PIN'), m16a);
  // the booking exactly as the scheduler hands it over: read at the start of the tick, BEFORE the code
  // existed - door_code empty (Sep 26 2026: the kinder call with the code filled in hid the bug)
  const note16 = doorlock.doorCodeNote(Object.assign({}, bkA, { door_code: null }), m16a.personId);
  ok('H16b the text says it is their member PIN and names the finishing key - from the booking as the tick holds it', /Your door code is your member PIN/.test(note16) && /press the check mark/.test(note16), note16);
  const sms16 = require('./services/sms').defaultBodies.doorCode({ server: { businessName: 'HA Door Facility' } }, bkA, '4417', 'member', { key: 'the check mark' });
  ok('H16b2 ...and the one text a member gets says so, in words, with the finishing key', /Door code 4417 \(your member PIN\)/.test(sms16) && /press the check mark\./.test(sms16) && sms16.length <= 160, sms16);
  const setsBefore = H.state.calls.filter(x => x.service === 'set_lock_usercode').length;
  const m16b = await doorlock.generateDoorCode(bkB); setRef('hb-16b', m16b.personId, m16b.pin);
  ok('H16c the back-to-back booking shares the SAME slot - nothing is written to the lock, no gap', m16b.personId === m16a.personId && m16b.pin === '4417' && H.state.calls.filter(x => x.service === 'set_lock_usercode').length === setsBefore && logHas('DOOR_CODE_CREATED', 'keeps it through both'), m16b);
  const rv16a = await doorlock.revokeDoorCode(m16a.personId, { forBookingId: 'hb-16a' });
  ok('H16d the first booking ending does NOT take the PIN off - the next booking still needs it (DOOR_CODE_KEPT)', rv16a.ok === true && H.lock.slots[s16] && H.lock.slots[s16].code === '4417' && logHas('DOOR_CODE_KEPT'), rv16a);
  ok('H16d2 ...and it says so to its caller (kept:true), so the sweep does not also log it as revoked', rv16a.kept === true, rv16a);
  dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE id='hb-16a'`).run();
  const rv16b = await doorlock.revokeDoorCode(m16b.personId, { forBookingId: 'hb-16b' });
  ok('H16e the last booking ending takes it off the lock', rv16b.ok === true && !H.lock.slots[s16], rv16b);
  const m16c = await doorlock.generateDoorCode(Object.assign(mk('hb-16c'), { member_id: 'm-16s' }));
  ok('H16f a member PIN the lock cannot take (3 digits) is not forced on it - the booking gets its own code', /^\d{6}$/.test(m16c.pin) && m16c.pin !== '417', m16c.pin);
  cfgSet(c => { c.homeAssistant.lock.memberPins = false; });
  insert('hb-16d'); dbM.db.prepare(`UPDATE bookings SET member_id='m-16' WHERE id='hb-16d'`).run();
  const m16d = await doorlock.generateDoorCode(Object.assign(mk('hb-16d'), { member_id: 'm-16' }));
  ok('H16g with member PINs off, a member gets a one-time code like anyone else', /^\d{6}$/.test(m16d.pin) && m16d.pin !== '4417', m16d.pin);
  dbM.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL, door_code=NULL WHERE id LIKE 'hb-16%'`).run(); emptyLock();

  console.log('── H17 the LOCK itself is asked, not only Home Assistant: batteries out while HA answers ──');
  reset({ slotCap: 45 }); hadoor._resetReach();
  dbM.db.prepare(`DELETE FROM admin_log WHERE event IN ('OWNER_ALERT','HA_DOOR_UNREACHABLE','HA_DOOR_BACK')`).run();
  const P0 = Date.now() - 61000;
  let gets = () => H.state.calls.filter(x => x.service === 'invoke_cc_api').length;
  let g0 = gets();
  const p1 = await hadoor.watch({ now: P0 });
  ok('H17a a lock that answers is asked once (one fresh read) and all is well', p1.ok === true && gets() - g0 === 1, { p1, reads: gets() - g0 });
  g0 = gets(); await hadoor.watch({ now: P0 + 5 * 60000 });
  ok('H17b ...and not again for ten minutes', gets() - g0 === 0, gets() - g0);
  H.set({ batteryOut: true });
  g0 = gets(); const p2 = await hadoor.watch({ now: P0 + 10 * 60000 });
  ok('H17c batteries out with HA still answering: the ten-minute read fails and the unit says the LOCK is not answering', p2.ok === false && /the lock itself did not answer/.test(p2.why) && logHas('HA_DOOR_UNREACHABLE', 'the lock itself did not answer'), p2);
  const sig17 = (() => { const rn = Date.now; Date.now = () => P0 + 11 * 60000 + 1000; try { return doorSig(); } finally { Date.now = rn; } })();
  ok('H17d a minute on, Door codes reads RED naming the lock', sig17 && sig17.level === 'red' && /the lock itself did not answer/.test(sig17.detail), sig17);
  g0 = gets(); await hadoor.watch({ now: P0 + 11 * 60000 });
  ok('H17e while it is failing the lock is asked every tick, not every ten minutes', gets() - g0 === 1, gets() - g0);
  await hadoor.watch({ now: P0 + 15 * 60000 });
  ok('H17f at five minutes the owner is told', logHas('OWNER_ALERT', 'the lock itself did not answer'));
  H.set({ batteryOut: false });
  const p3 = await hadoor.watch({ now: P0 + 16 * 60000 });
  ok('H17g batteries back: HA_DOOR_BACK and the lock is put back to the record', p3.ok === true && logHas('HA_DOOR_BACK', 'after 6 min') && logHas('DOOR_RECONCILE', 'back after 6 min'), p3);

  console.log('── H18 the token is an administrator\'s, or it is said (maintainer, Sep 29: "explained clearly and built in") ──');
  // Home Assistant gives the keypad reports only to an administrator's token (auth/permissions/events.py) and still
  // takes every code call from any token (zwave_js/services.py) - so a non-admin token used to fail in silence:
  // codes set and cleared, and no arrival ever reached the unit. The stand-in refuses as Home Assistant does.
  const waitListen = async () => { for (let i = 0; i < 40 && !(hadoor.eventsState().listening || hadoor.eventsState().refused); i++) await sleep(100); return hadoor.eventsState(); };
  hadoor._resetEvents(); hadoor.startEvents();
  let es = await waitListen();
  ok('H18a an administrator\'s token: the unit asked whose token it is and Home Assistant let it listen', es.listening === true && es.admin === true && es.refused === null && H.state.requests.some(r => r.ws && r.msg.type === 'auth/current_user'), es);
  let t18 = await hadoor.testLock();
  ok('H18a ...and Test the lock says the token is an administrator\'s, with no warning', t18.tokenAdmin === true && !t18.warning, { tokenAdmin: t18.tokenAdmin, warning: t18.warning });
  hadoor.stopEvents(); for (let i = 0; i < 30 && H.wsClients() > 0; i++) await sleep(100);
  H.faults.nonAdmin = true;
  hadoor._resetEvents(); hadoor.startEvents();
  es = await waitListen();
  ok('H18b a token that is NOT an administrator\'s: Home Assistant refuses the keypad reports (unauthorized) and the unit knows why', es.listening === false && es.refused === 'unauthorized' && es.admin === false && /not an administrator/.test(es.problem || ''), es);
  ok('H18c the owner\'s log says it in words - who opened the door is lost, codes still work, and how to fix it', logHas('HA_DOOR_EVENTS_ERROR', 'not an administrator') && logHas('HA_DOOR_EVENTS_ERROR', 'Codes are still set and cleared') && logHas('HA_DOOR_EVENTS_ERROR', 'Long-lived access tokens'));
  const sig18 = doorSig();
  ok('H18d the Door codes line is AMBER and says the unit cannot tell who opened the door', sig18 && sig18.level === 'amber' && /cannot tell who opened the door/.test(sig18.detail) && /administrator/.test(sig18.action || ''), sig18);
  t18 = await hadoor.testLock();
  ok('H18e Test the lock names it: the token is not an administrator\'s, with the fix', t18.tokenAdmin === false && /not an administrator/.test(t18.warning || '') && /Settings > Devices > Home Assistant/.test(t18.warning || ''), { tokenAdmin: t18.tokenAdmin, warning: t18.warning });
  reset({ nonAdmin: true }); insert('hb-18');
  const made18 = await doorlock.generateDoorCode(mk('hb-18'));
  ok('H18f ...while codes are still set on the lock, as Home Assistant allows any token', !!made18.personId && Object.values(H.lock.slots).some(s => s && s.code === made18.pin), { personId: made18.personId });
  ok('H18g ...and a keypad unlock never reaches this unit (nothing subscribed)', H.fireKeypadUnlock(Number(String(made18.personId).split('#')[1])) === 0);
  hadoor.stopEvents(); H.faults.nonAdmin = false;

  // H19 (Oct 3 2026, the pack review): the lock is still SAVED but the owner chose another door system - a unit booting
  // like that asks nothing of Home Assistant (it wrote a fresh backup code into the old lock every night, and with the box
  // unplugged logged an error every night). Last in the battery: a second process boots the scheduler on this database.
  {
    const c19 = JSON.parse(fs.readFileSync('./config.json', 'utf8')); c19.doorAccess = { provider: 'unifi' };
    fs.writeFileSync('./config.json', JSON.stringify(c19, null, 2));
    try { await dbM.flushed(); dbM.flushSync(); } catch {}
    const before = H.state.requests.length, wsBefore = H.wsClients();
    const child = require('child_process').spawn(process.execPath, ['-e', `require('./services/db').initDb().then(()=>{require('./services/scheduler').startScheduler();setTimeout(()=>process.exit(0),4000)})`],
      { cwd: __dirname, env: Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' }), stdio: ['ignore', 'ignore', 'ignore'] });
    await new Promise(r => child.on('exit', r));
    const asked = H.state.requests.slice(before);
    ok('H19 a Home Assistant lock still saved after the owner chose UniFi: the boot asks NOTHING of Home Assistant - no backup code written into the old lock, no keypad listener', asked.length === 0 && H.wsClients() === wsBefore, asked.slice(0, 3).map(r => r.url || (r.msg && r.msg.type)));
  }

  try { fs.unlinkSync('./bookings.db'); } catch {}
  await H.stop();
  console.log(`\nHA DOOR: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
