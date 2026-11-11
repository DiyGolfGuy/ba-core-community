// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-housekeeping-restart.js - THE TICK'S HOUSEKEEPING ACROSS RESTARTS (rule 22; Oct 3 2026, the inventory: the
// Sep 11 audit's ranked list still had no restart-shape proof for these two)
//
// Two jobs the owner never sees until they go wrong: every minute, sessions whose end has passed are marked
// completed (the reports, the "today" lists and the shutdown logic read that status); every night at 4:30, automation
// records older than thirty days are pruned (the ledger the scheduler asks "did I already do this?").
//   H1  existing rows, a fresh process: the sessions that ended are completed - one that ended yesterday, one that
//       ended a minute ago - and the ones still running are not, a session crossing midnight included
//   H2  a second process right after: nothing changes, nothing is touched twice
//   H3  the clock moved BACK an hour (a correction): the tick changes nothing - the sessions not yet over by the corrected
//       clock stay active, nothing is touched twice. (A session a clock running an hour AHEAD completed early is not
//       reopened; the bay screen then shows it as over - written down for maintainer, not chased: rule 32, the review Oct 3 2026)
//   H4  the prune, in its own process: finished records past thirty days go; a PENDING one that old stays (it is
//       still owed - deleting it would lose work), and a finished one ten days old stays
//   H5  a second prune deletes nothing more, and a tick afterwards re-creates nothing for the pruned booking; the owed
//       switch-off (a TV no bay has) is settled by the tick as never sent, with the reason (rule 46, Oct 21 2026)
// Every database touch is its own process; the clock is tools/fake-clock.js; state is read from the file on disk.
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
// a fixed date: the clock is pinned, so "now" is this moment in every process (the project notes, Oct 2 2026)
const NOW = '2026-11-12T21:30:00-06:00';          // 9:30 PM Central - past 7 PM, so the UTC date has already turned
const run = (js, at) => spawnSync(process.execPath, ['-r', './tools/fake-clock.js', '-e', js], { cwd: root, env: Object.assign({}, ENV, { BA_FAKE_NOW: at || NOW }), encoding: 'utf8', timeout: 120000 });
const tick = at => run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`, at);
const read = sql => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return []; } };
const status = () => Object.fromEntries(read("SELECT id, status FROM bookings WHERE id LIKE 'hk-%'"));

for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
  businessName: 'Housekeeping', setup: { completed: true, eulaAccepted: true },
  server: { port: 3001, businessName: 'Housekeeping', adminPassword: 'hk-owner-pw', timezone: 'America/Chicago' },
  booking: { staffedAccess: true, pricePerHalfHour: 25, open24Hours: true },
  sms: { sendReminder: false, sendEndingWarning: false }, resend: { sendReminder: false, sendEndingWarning: false },
  bays: [{ id: 'hk-b1', name: 'Bay 1', active: true }, { id: 'hk-b2', name: 'Bay 2', active: true }]
}, null, 2));

// rows on disk before anything runs (rule 22): Nov 12 2026, 9:30 PM Central
const seed = run(`const db=require('./services/db');db.initDb().then(async()=>{const A=require('./services/automation');A.ensureSchema();
  const B=(id,bay,date,st,en,ed)=>db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at,updated_at) VALUES (?,?,?,?,'','',?,?,?,?,60,0,'active',datetime('now','-3 days'),datetime('now','-3 days'))").run(id,bay,'Bay',id,date,st,en,ed);
  B('hk-yday','hk-b1','2026-11-11','18:00','19:00','2026-11-11');     // ended yesterday
  B('hk-just','hk-b1','2026-11-12','20:29','21:29','2026-11-12');     // ended a minute ago
  B('hk-play','hk-b2','2026-11-12','21:00','22:00','2026-11-12');     // playing now
  B('hk-cross','hk-b1','2026-11-12','23:30','00:30','2026-11-13');    // tonight, across midnight - not even started
  B('hk-old','hk-b2','2026-10-01','10:00','11:00','2026-10-01');      // six weeks ago, its jobs long done
  db.db.prepare("UPDATE bookings SET status='completed' WHERE id='hk-old'").run();
  const J=(b,k,dk,st,ago)=>db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,status,attempts,created_at) VALUES (?,?,?,datetime('now',?),?,0,datetime('now',?))").run(b,k,dk,'-'+ago+' days',st,'-'+ago+' days');
  J('hk-old','power_on','10.0.0.1','done',42); J('hk-old','power_off','10.0.0.1','failed',42); J('hk-yday','power_on','10.0.0.1','done',10);
  await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
ok('stage: five bookings and four automation records on disk before the unit runs, by a process that then exited', seed.status === 0, (seed.stderr || '').slice(-300));

// H1, H2
const t1 = tick(); const s1 = status();
ok('H1 a fresh process: the session that ended yesterday and the one that ended a minute ago are completed; the one playing and tonight\'s cross-midnight one are not',
   t1.status === 0 && s1['hk-yday'] === 'completed' && s1['hk-just'] === 'completed' && s1['hk-play'] === 'active' && s1['hk-cross'] === 'active', { s1, err: (t1.stderr || '').slice(-300) });
const upd = () => Object.fromEntries(read("SELECT id, updated_at FROM bookings WHERE id LIKE 'hk-%'"));
const u1 = upd();
const t2 = tick(); const s2 = status(), u2 = upd();
ok('H2 a second process right after: nothing changes - the same statuses, and no completed row touched again', t2.status === 0 && JSON.stringify(s2) === JSON.stringify(s1) && JSON.stringify(u2) === JSON.stringify(u1), { s2, u1, u2 });

// H3: the clock corrected back an hour
const t3 = tick('2026-11-12T20:30:00-06:00'); const s3 = status(), u3 = upd();
ok('H3 the clock moved BACK an hour (a correction): the tick changes nothing - the playing and the late-night sessions stay active, no row touched again',
   t3.status === 0 && JSON.stringify(s3) === JSON.stringify(s1) && s3['hk-play'] === 'active' && s3['hk-cross'] === 'active' && JSON.stringify(u3) === JSON.stringify(u1), { s3, u1, u3 });

// H4, H5: the 4:30 prune, in its own process
const prune = () => run(`const db=require('./services/db');db.initDb().then(async()=>{require('./services/automation').pruneOld(30);await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
const jobsOf = () => read("SELECT booking_id||'/'||kind||'/'||status FROM automation_jobs WHERE booking_id IN ('hk-old','hk-yday') ORDER BY 1").map(r => r[0]);
// the PENDING record is written just before the prune, by its own process (Oct 21 2026 - a changed fixture: since rule 46 a
// tick writes off a switch-off no booking's pass reaches - this one names a device no bay has - so seeded before the ticks it
// was settled, and pruned, before the prune was ever asked about it; what H4 proves is unchanged: the prune keeps owed work)
const pend = run(`const db=require('./services/db');db.initDb().then(async()=>{db.db.prepare("INSERT INTO automation_jobs (booking_id,kind,device_key,due_at,status,attempts,created_at) VALUES ('hk-old','ir_off','10.0.0.2',datetime('now','-42 days'),'pending',0,datetime('now','-42 days'))").run();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
const p1 = prune(); const j1 = jobsOf();
ok('H4 the prune: finished records past thirty days go (done, failed); a PENDING one that old stays - it is still owed; a finished one ten days old stays',
   pend.status === 0 && p1.status === 0 && !j1.includes('hk-old/power_on/done') && !j1.includes('hk-old/power_off/failed') && j1.includes('hk-old/ir_off/pending') && j1.includes('hk-yday/power_on/done'), j1);
const p2 = prune(); const t5 = tick(); const j2 = jobsOf();
// a ruling (rule 46, maintainer Oct 21 2026): the tick settles a switch-off nothing would claim - the owed one names a TV no bay has -
// as never sent ('skipped', with the reason), never 'done'; the record stays for the next nightly prune
const kindsOf = js => js.map(s => s.split('/').slice(0, 2).join('/'));
const why5 = (read("SELECT last_error FROM automation_jobs WHERE booking_id='hk-old' AND kind='ir_off'")[0] || [])[0] || '';
ok('H5 a second prune deletes nothing more, and a tick afterwards re-creates nothing for the pruned six-week-old booking; the owed switch-off for a TV no bay has is settled as never sent, with the reason (rule 46)',
   p2.status === 0 && t5.status === 0 && JSON.stringify(kindsOf(j2)) === JSON.stringify(kindsOf(j1)) && j2.includes('hk-old/ir_off/skipped') && j2.includes('hk-yday/power_on/done') && /no longer set up/.test(why5), { j1, j2, why5 });

for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
console.log(`\nHOUSEKEEPING RESTART: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
