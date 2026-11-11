// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-door-revoke-cleanup.js - A DOOR REMOVAL WITH NOTHING LEFT TO REMOVE IS DELETED,
//                               NOT LEFT WAITING (maintainer, Sep 27 2026 - the hotfix pack)
//
// Found on the bench the night before the Monday pack went out: the staff pad's cancel takes
// the code off the lock and clears the booking's pointer, but its door_revoke job stayed
// pending for ever - nothing claims a revoke for a booking that holds no code - and Automation
// read "overdue - queued but never claimed" with no way to clear it. The staff pad's MOVE had
// the same shape and worse: the old job kept the OLD time (ensureJob never moves a waiting
// job), so once the moved session's new code was issued the stale job, already due, took the
// NEW code back off the lock.
// maintainer: "a door removal task whose booking no longer holds a code is deleted, not left waiting";
// "repair existing stuck removal tasks at boot, one time, and log it"; "moving a booking:
// confirm the same fix covers it, with its own check".
// The console is the shared stand-in (tools/unifi-console-standin.js) living in THIS process;
// every boot, tick, cancel and move is the product's own code in a fresh process (rule 22),
// reading and writing the tables on disk.
//   1  BOOT on a unit that ran the older code: a stuck removal job is deleted before the first
//      tick and the owner's log says so (DOOR_JOBS_REPAIRED) - once; a second boot adds nothing
//   2  the staff cancel: the code comes off the lock and its removal job goes with it; when the
//      old end passes, Automation has nothing overdue
//   3  a cancel the lock REFUSES still keeps the pointer and its job, due now (A-wave 11c), and
//      the next tick takes the code back
//   4  the staff move: the old code comes off, the old window's job goes; the new code is issued
//      and gets a fresh job for the NEW end; when the OLD time arrives the new code stays on
//   5  a removal job that turns up later for a booking with no code is deleted by the tick, quietly
//   6  two more ticks: nothing created or removed twice; Automation healthy
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };
const root = __dirname;
const PORT = 12476, TOKEN = 'tok-revoke-battery', UNIT = 'unit-revoke-battery';
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
const { startConsole } = require('./tools/unifi-console-standin');
const pad = n => String(n).padStart(2, '0');
const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const hm = t => `${pad(t.getHours())}:${pad(t.getMinutes())}`;
const base = new Date(Math.floor(Date.now() / 60000) * 60000);
const at = m => new Date(base.getTime() + m * 60000);
const epoch = t => Math.floor(t.getTime() / 1000);
const isoUtc = t => t.toISOString().slice(0, 19).replace('T', ' ');

// the product's processes run ASYNCHRONOUSLY: the console lives in this process and must keep
// answering while they run
const run = js => new Promise(res => { const ch = spawn(process.execPath, ['-e', js], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; ch.stdout.on('data', d => o += d); ch.stderr.on('data', d => e += d); ch.on('exit', code => res({ status: code, out: o, err: e })); });
const inDb = body => run(`const db=require('./services/db');db.initDb().then(async()=>{${body};await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e&&e.stack||e);process.exit(1)})`);
const tick = () => inDb(`await require('./services/scheduler').checkBookings()`);
// THE BOOT: the scheduler's own start, the way server.js starts it - then wait for its first tick
// to have scheduled the live codes' removals before the process goes
const boot = () => inDb(`require('./services/scheduler').startScheduler();
  const t0=Date.now(); while(Date.now()-t0<30000){ const n=db.db.prepare("SELECT COUNT(*) c FROM automation_jobs WHERE kind='door_revoke' AND booking_id IN ('dr-cancel','dr-move','dr-refuse')").get().c; if(n>=3) break; await new Promise(r=>setTimeout(r,250)); }
  await new Promise(r=>setTimeout(r,1500))`);
const autoHealth = async () => { const r = await inDb(`const h=require('./services/automation').health(48);console.log('AH '+JSON.stringify({overdue:h.overdue,failed:h.failed.length,healthy:h.healthy}))`); const m = /AH (.*)/.exec(r.out); return m ? JSON.parse(m[1]) : { none: r.err.slice(-300) }; };
const read = () => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const q=s=>{const r=d.exec(s);return r.length?r[0].values:[]};
  console.log(JSON.stringify({ log:q("SELECT event,detail FROM admin_log ORDER BY id"),
    bk:q("SELECT id,status,COALESCE(door_code,''),COALESCE(remotelock_person_id,''),start_time,end_time FROM bookings WHERE id LIKE 'dr-%'"),
    jobs:q("SELECT booking_id,kind,status,attempts,due_at,COALESCE(last_error,'') FROM automation_jobs WHERE booking_id LIKE 'dr-%'") }));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const j = JSON.parse(r.stdout.trim().split('\n').pop());
  const jobs = j.jobs.map(([booking_id, kind, status, attempts, due_at, error]) => ({ booking_id, kind, status, attempts, due_at, error }));
  return { log: j.log.map(([event, detail]) => ({ event, detail })), bk: Object.fromEntries(j.bk.map(([id, status, code, ref, s, e]) => [id, { status, code, ref, s, e }])),
    revokes: id => jobs.filter(x => x.booking_id === id && x.kind === 'door_revoke'), jobs }; };
const count = (st, ev) => st.log.filter(l => l.event === ev).length;
const dueMs = s => Date.parse(String(s).replace(' ', 'T') + 'Z');

let c = null;
(async () => {
  try {
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Revoke Golf', setup: { completed: true, eulaAccepted: true }, unit: { id: UNIT },
      server: { port: 3157, businessName: 'Revoke Golf', adminPassword: 'revoke-owner-pw', timezone: 'America/Chicago' },
      booking: { staffedAccess: false, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, doorCodeLeadMins: 15, doorCodeLagMins: 15 },
      sms: { sendReminder: false, sendDoorCode: true, sendEndingWarning: false },
      resend: { apiKey: 're_revoke_battery', fromEmail: 'desk@revoke.example', sendDoorCode: true, sendReminder: false, sendEndingWarning: false },
      doorAccess: { provider: 'unifi' },
      unifiAccess: { host: '127.0.0.1:' + PORT, apiToken: TOKEN, apiStyle: 'documented', doorIds: ['door:door-front'], pinLength: 4 },
      bays: [{ id: 'dr-b1', name: 'Bay One', active: true }, { id: 'dr-b2', name: 'Bay Two', active: true }, { id: 'dr-b3', name: 'Bay Three', active: true }, { id: 'dr-b4', name: 'Bay Four', active: true }]
    }, null, 2));
    c = await startConsole({ port: PORT, faults: { token: TOKEN } });
    const ours = (id, bid, endAt) => ({ id, first_name: 'Golf', last_name: 'Guest', remarks: `BA:${UNIT} Booking ${bid}`, start_time: epoch(endAt) - 5400, end_time: epoch(endAt), resources: [{ id: 'door-front', type: 'door' }] });
    // at the console before the product runs (rule 22): the three live codes
    c.state.visitors['vis-dc'] = Object.assign(ours('vis-dc', 'dr-cancel', at(65)), { pin: '4411' });
    c.state.visitors['vis-dm'] = Object.assign(ours('vis-dm', 'dr-move', at(50)), { pin: '4412' });
    c.state.visitors['vis-dr'] = Object.assign(ours('vis-dr', 'dr-refuse', at(65)), { pin: '4413' });
    const B = [
      { id: 'dr-cancel', bay: 'dr-b1', s: at(-10), e: at(50), ref: 'unifi:vis-dc', code: '4411' },   // playing now; the staff pad cancels it
      { id: 'dr-move',   bay: 'dr-b2', s: at(5),   e: at(35), ref: 'unifi:vis-dm', code: '4412' },   // starts in 5; its code is out; the staff pad moves it
      { id: 'dr-refuse', bay: 'dr-b3', s: at(-10), e: at(50), ref: 'unifi:vis-dr', code: '4413' },   // playing; cancelled while the console is silent
      { id: 'dr-stuck',  bay: 'dr-b4', s: at(-200), e: at(-140), ref: '', code: '', status: 'cancelled' }  // cancelled on the older code: its job was left behind
    ];
    const rows = B.map((b, i) => `db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,sms_consent,door_code,remotelock_person_id,sms_code_sent,created_at,updated_at) VALUES ('${b.id}','${b.bay}','Bay','Rae Revoke','+1555070${i}','${b.id}@revoke.example','${ymd(b.s)}','${hm(b.s)}','${hm(b.e)}','${ymd(b.e)}',${Math.round((b.e - b.s) / 60000)},5000,'${b.status || 'active'}',1,${b.code ? `'${b.code}'` : 'NULL'},${b.ref ? `'${b.ref}'` : 'NULL'},${b.code ? 1 : 0},datetime('now','-1 day'),datetime('now','-1 day'))").run();`).join('');
    // the stuck job exactly as the older code left it: pending, due two hours ago, never claimed
    const stuck = `db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,deadline_at,next_attempt_at,status,attempts) VALUES ('dr-stuck','door_revoke','','${isoUtc(at(-125))}',NULL,'${isoUtc(at(-125))}','pending',0)").run();`;
    const seed = await inDb(`require('./services/automation').ensureSchema();${rows}${stuck}`);
    let st = read();
    ok('stage: four bookings and a stuck removal job seeded by a process that then exited; three live codes at the console', seed.status === 0 && Object.keys(c.state.visitors).length === 3 && st.revokes('dr-stuck').length === 1 && st.revokes('dr-stuck')[0].status === 'pending', { err: seed.err.slice(-300), stuck: st.revokes('dr-stuck') });
    let ah = await autoHealth();
    ok('stage: ...and Automation reads it as the unit in the field does - overdue, "queued but never claimed"', ah.overdue >= 1 && ah.healthy === false, ah);

    // ── 1. the boot ──
    console.log('── 1. boot on a unit that ran the older code ──');
    let b1 = await boot();
    st = read();
    ok('1a the stuck removal job is gone after the boot', b1.status === 0 && st.revokes('dr-stuck').length === 0, { jobs: st.revokes('dr-stuck'), err: b1.err.slice(-300) });
    const rep = st.log.filter(l => l.event === 'DOOR_JOBS_REPAIRED');
    ok('1b the owner\'s log says so, once: how many, that their codes were already off the lock, and which booking', rep.length === 1 && /^1 door removal task\(s\) left waiting by an earlier cancel or move were removed - their codes were already off the lock/.test(rep[0].detail) && /Booking: dr-stuck/.test(rep[0].detail), rep);
    ok('1c the live codes\' removals were scheduled by the first tick, each for its own end + the lag', ['dr-cancel', 'dr-refuse'].every(id => st.revokes(id).length === 1 && st.revokes(id)[0].status === 'pending' && Math.abs(dueMs(st.revokes(id)[0].due_at) - at(65).getTime()) < 61000) && st.revokes('dr-move').length === 1 && Math.abs(dueMs(st.revokes('dr-move')[0].due_at) - at(50).getTime()) < 61000, st.jobs.filter(j => j.kind === 'door_revoke'));
    let b2 = await boot();
    st = read();
    ok('1d a second boot finds nothing to repair and writes no second line', b2.status === 0 && count(st, 'DOOR_JOBS_REPAIRED') === 1, { n: count(st, 'DOOR_JOBS_REPAIRED'), err: b2.err.slice(-200) });

    // ── 2. the staff cancel ──
    console.log('\n── 2. the staff pad cancels a session whose code is out ──');
    let cx = await inDb(`const r=await require('./services/bookingedit').cancelBooking('dr-cancel',{refund_type:'none',actor:'staff',reason:'battery',override_policy:true});console.log('CANCEL '+JSON.stringify(r))`);
    st = read();
    ok('2a the code comes off the lock and the booking\'s pointer is cleared', cx.status === 0 && /"ok":true/.test(cx.out) && !c.state.visitors['vis-dc'] && st.bk['dr-cancel'].status === 'cancelled' && !st.bk['dr-cancel'].ref, { out: cx.out.slice(-200), err: cx.err.slice(-200), bk: st.bk['dr-cancel'] });
    ok('2b ...and its removal job goes with it - nothing is left waiting that nothing will ever claim', st.revokes('dr-cancel').length === 0, st.revokes('dr-cancel'));
    // the old end (+ the lag) arrives: a job still waiting for it would now read overdue
    await inDb(`db.db.prepare("UPDATE automation_jobs SET due_at='${isoUtc(at(-10))}', next_attempt_at='${isoUtc(at(-10))}' WHERE booking_id='dr-cancel' AND kind='door_revoke'").run()`);
    await tick();
    ah = await autoHealth();
    ok('2c when the cancelled session\'s old end has passed, Automation has nothing overdue', ah.overdue === 0, ah);

    // ── 3. the refused cancel keeps its job ──
    console.log('\n── 3. a cancel the lock refuses keeps the pointer and the job (A-wave 11c) ──');
    c.set({ down: true });
    cx = await inDb(`const r=await require('./services/bookingedit').cancelBooking('dr-refuse',{refund_type:'none',actor:'staff',reason:'battery',override_policy:true});console.log('CANCEL '+JSON.stringify(r))`);
    st = read();
    const rj = st.revokes('dr-refuse');
    ok('3a the console silent: the pointer is KEPT and the removal job is kept, due now, never deleted', st.bk['dr-refuse'].ref === 'unifi:vis-dr' && rj.length === 1 && ['pending', 'failed'].includes(rj[0].status) && dueMs(rj[0].due_at) <= Date.now() + 1000 && !!c.state.visitors['vis-dr'], { bk: st.bk['dr-refuse'], rj, out: cx.out.slice(-200) });
    ok('3b ...and the owner\'s log says the code is still live', st.log.some(l => l.event === 'DOOR_REVOKE_ERROR' && /dr-refuse/.test(l.detail)));
    c.set({ down: false });
    await tick();
    st = read();
    ok('3c the console back: the next tick takes the code off, clears the pointer and finishes the job', !c.state.visitors['vis-dr'] && !st.bk['dr-refuse'].ref && st.revokes('dr-refuse').length === 1 && st.revokes('dr-refuse')[0].status === 'done', { bk: st.bk['dr-refuse'], jobs: st.revokes('dr-refuse') });

    // ── 4. the staff move ──
    console.log('\n── 4. the staff pad moves a session whose code is out ──');
    const oldDue = isoUtc(at(50));   // the old end (+35) + the lag (15)
    const mv = await inDb(`const r=await require('./services/bookingedit').moveBooking('dr-move',{date:'${ymd(at(10))}',start_time:'${hm(at(10))}',duration_minutes:30,actor:'staff',reason:'battery'});console.log('MOVE '+JSON.stringify(r))`);
    st = read();
    ok('4a the old code comes off the lock and the pointer is cleared', mv.status === 0 && !/"error"/.test(mv.out) && !c.state.visitors['vis-dm'] && !st.bk['dr-move'].ref && st.bk['dr-move'].s === hm(at(10)), { out: mv.out.slice(-300), err: mv.err.slice(-200), bk: st.bk['dr-move'] });
    ok('4b ...and the OLD window\'s removal job is gone at once - it cannot fire at the old time', !st.revokes('dr-move').some(j => j.due_at === oldDue), st.revokes('dr-move'));
    await tick(); await tick();
    st = read();
    const newRef = st.bk['dr-move'].ref, newVis = newRef.replace(/^unifi:/, '');
    const nj = st.revokes('dr-move');
    ok('4c the moved session\'s NEW code is issued at the console', /^unifi:/.test(newRef) && newVis !== 'vis-dm' && !!c.state.visitors[newVis], { bk: st.bk['dr-move'], visitors: Object.keys(c.state.visitors) });
    ok('4d ...and it has a removal job of its own, for the NEW end + the lag', nj.length === 1 && nj[0].status === 'pending' && Math.abs(dueMs(nj[0].due_at) - at(55).getTime()) < 61000, nj);
    // THE OLD TIME ARRIVES: any job still carrying the old window's due time comes due now
    await inDb(`db.db.prepare("UPDATE automation_jobs SET due_at='${isoUtc(at(-1))}', next_attempt_at='${isoUtc(at(-1))}' WHERE booking_id='dr-move' AND kind='door_revoke' AND due_at='${oldDue}'").run()`);
    await tick();
    st = read();
    ok('4e when the OLD end + lag arrives, the moved session\'s new code STAYS on the lock - nothing takes it back early', st.bk['dr-move'].ref === newRef && !!c.state.visitors[newVis] && !st.log.some(l => l.event === 'DOOR_CODE_REVOKED' && /dr-move/.test(l.detail)), { bk: st.bk['dr-move'], jobs: st.revokes('dr-move'), vis: !!c.state.visitors[newVis] });

    // ── 5. a later one, quietly ──
    console.log('\n── 5. a removal job that turns up later for a booking with no code ──');
    const lines0 = count(st, 'DOOR_JOBS_REPAIRED');
    await inDb(`db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,deadline_at,next_attempt_at,status,attempts) VALUES ('dr-cancel','door_revoke','','${isoUtc(at(30))}',NULL,'${isoUtc(at(30))}','pending',0)").run()`);
    await tick();
    st = read();
    ok('5a the next tick deletes it', st.revokes('dr-cancel').length === 0, st.revokes('dr-cancel'));
    ok('5b ...without a line in the owner\'s log (the cancel already said the code came off)', count(st, 'DOOR_JOBS_REPAIRED') === lines0);

    // ── 6. steady ──
    console.log('\n── 6. two more ticks ──');
    const vis0 = JSON.stringify(Object.keys(c.state.visitors).sort()), created0 = (c.state.created || []).length, deleted0 = (c.state.deleted || []).length;
    await tick(); await tick();
    st = read();
    ok('6a nothing is created or removed twice at the console', JSON.stringify(Object.keys(c.state.visitors).sort()) === vis0 && (c.state.created || []).length === created0 && (c.state.deleted || []).length === deleted0, { vis: Object.keys(c.state.visitors) });
    ah = await autoHealth();
    ok('6b Automation is healthy: nothing overdue, nothing failed', ah.overdue === 0 && ah.failed === 0 && ah.healthy === true, ah);
  } catch (e) {
    fail++; console.log('FAIL  the battery crashed: ' + (e && e.stack || e));
  } finally {
    try { if (c) await c.stop(); } catch {}
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  console.log(`\nDOOR REVOKE CLEANUP: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
