// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-backup-restart.js — THE NIGHTLY BACKUP ACROSS RESTARTS
//                          (A-wave 4, rule 22, Sep 11 2026)
//
// A facility whose nightly backup silently stopped finds out on the day it
// needs one. Rule 22: the tick runs in a FRESH process against config.json as
// a unit left it (a night three days behind), with the REAL clock (any hour
// past the configured one is the catch-up path the product ships); a second
// process does nothing more that day; the state a process killed mid-zip
// leaves behind (a start recorded, no file, no done mark) is retried by the
// next process past its lease; and the ordering bug this battery was written
// against - the day marked DONE before the backup was written, so a killed
// run skipped the night - fails it (fail-first against the code before
// A-wave 4). The per-destination result is kept on disk for the health line.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 320) : '')); } };
const root = __dirname;
const ENV = Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });
const oneShot = js => spawnSync(process.execPath, ['-e', js], { cwd: root, env: ENV, encoding: 'utf8', timeout: 180000 });
// the hourly tick, in a fresh process, with the real clock - exactly what the cron calls
const tick = () => oneShot(`const db=require('./services/db');db.initDb().then(async()=>{const r=await require('./services/backup').maybeNightlyTick();db.flushSync();console.log('TICK '+JSON.stringify(r&&{local:!!r.localPath,copies:(r.copies||[]).length}));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`);
const cfg = () => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const setBackup = patch => { const c = cfg(); c.backup = Object.assign({}, c.backup, patch); fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(c, null, 2)); };
const zips = () => { try { return fs.readdirSync(path.join(root, 'backups')).filter(f => f.startsWith('auto-backup-') && f.endsWith('.zip')); } catch { return []; } };
const logRows = like => JSON.parse(oneShot(`require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec("SELECT event,detail FROM admin_log WHERE event LIKE '%${like}%' ORDER BY id DESC");console.log(JSON.stringify(r.length?r[0].values.map(v=>({event:v[0],detail:v[1]})):[]));process.exit(0)})`).stdout.trim().split('\n').pop());

(async () => {
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  for (const z of zips()) { try { fs.unlinkSync(path.join(root, 'backups', z)); } catch {} }
  const hourNow = new Date().getHours();
  const hour = Math.max(0, hourNow - 1);   // "the configured hour has passed" - the catch-up path, on the real clock
  // BETWEEN MIDNIGHT AND 01:00 THE CATCH-UP HALF CANNOT BE BUILT (Sep 17 2026).
  // hourNow is 0, so the configured hour is also 0, and the product's own test
  // for "we are running late" is getHours() > hour - which 0 > 0 is not. There is
  // no earlier hour today to be late from. The backup itself is still asserted
  // (it is the thing that matters); only the BACKUP_CAUGHT_UP line stands down,
  // and it stands down VISIBLY here rather than making the suite a coin toss on
  // what time of night it runs. This is the same class as test-employees'
  // semimonthly fixture, found the same way: a red suite at 00:39.
  if (hourNow === 0) console.log('NOTE  the 00:00 hour: BACKUP_CAUGHT_UP is not assertable (no earlier hour to be late from); the backup itself still is');
  // the nightly's day is the UNIT's local day (services/backup.js localYmd, Oct 2 2026) - a UTC date is
  // tomorrow every evening, so "today" and "three days ago" are read the way the product reads them
  const localYmd = t => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const daysAgo = n => localYmd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - (n), 12));
  const today = localYmd(new Date());
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Backup Restart', setup: { completed: true, eulaAccepted: true },
    server: { port: 3001, businessName: 'Backup Restart', adminPassword: 'backup-battery-pw' },
    booking: { staffedAccess: false, pricePerHalfHour: 25 },
    backup: { enabled: true, hour, destination: 'off', lastNightlyDate: daysAgo(3) },
    bays: [{ id: 'bk-b1', name: 'Bay One', active: true }]
  }, null, 2));
  const seed = oneShot(`const db=require('./services/db');db.initDb().then(()=>{for(let i=0;i<5;i++)db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,'completed',datetime('now','-2 days'))").run('bk-'+i,'bk-b1','Bay One','Backup '+i,'5558300001','','2026-09-09','1'+i+':00','1'+(i+1)+':00','2026-09-09');db.flushSync();process.exit(0)})`);
  ok('a unit three nights behind (lastNightlyDate three days ago, the configured hour passed) with bookings in its database, left by a process that exited', seed.status === 0 && cfg().backup.lastNightlyDate === daysAgo(3) && zips().length === 0);

  const t1 = tick();
  const c1 = cfg().backup;
  ok('a FRESH process runs the hourly tick on the real clock: the nightly backup is written (a zip in backups/), the day marked done ONLY NOW, BACKUP_CAUGHT_UP logged (the hour had passed)', t1.status === 0 && /TICK \{"local":true/.test(t1.stdout) && zips().length === 1 && c1.lastNightlyDate === today && (hourNow === 0 || logRows('BACKUP_CAUGHT_UP').length >= 1), { out: (t1.stdout || '').trim().split('\n').pop(), zips: zips(), date: c1.lastNightlyDate, err: (t1.stderr || '').slice(-200) });
  ok('the per-destination result is kept on disk for the health line (backup.lastNightly: date, at, ok, local file, copies)', c1.lastNightly && c1.lastNightly.date === today && c1.lastNightly.ok === true && typeof c1.lastNightly.local === 'string' && Array.isArray(c1.lastNightly.copies), c1.lastNightly);

  const t2 = tick();
  ok('a SECOND restart the same day: nothing runs again (null), still one zip', t2.status === 0 && /TICK null/.test(t2.stdout) && zips().length === 1, { out: (t2.stdout || '').trim().split('\n').pop(), zips: zips().length });

  // the state a process KILLED MID-ZIP leaves behind: a start recorded for today, no done mark, no new file
  setBackup({ lastNightlyDate: daysAgo(1), lastNightlyStartedAt: new Date(Date.now() - 3 * 60000).toISOString(), lastNightlyStartedFor: today });
  for (const z of zips()) { try { fs.unlinkSync(path.join(root, 'backups', z)); } catch {} }
  const t3 = tick();
  ok('a run that started three minutes ago and never finished holds its lease: the next tick waits (no second run inside the lease)', t3.status === 0 && /TICK null/.test(t3.stdout) && zips().length === 0, (t3.stdout || '').trim().split('\n').pop());
  setBackup({ lastNightlyStartedAt: new Date(Date.now() - 60 * 60000).toISOString() });   // an hour passes
  const t4 = tick();
  const c4 = cfg().backup;
  ok('past the lease, the night whose run died is RUN AGAIN: a zip appears and only then is the day marked done (the code before A-wave 4 marked the day done first and skipped the night)', t4.status === 0 && zips().length === 1 && c4.lastNightlyDate === today && c4.lastNightly && c4.lastNightly.ok === true, { out: (t4.stdout || '').trim().split('\n').pop(), zips: zips().length, date: c4.lastNightlyDate });

  // the ordering itself, read from the tree: done is written after the run, never before
  const src = fs.readFileSync(path.join(root, 'services', 'backup.js'), 'utf8');
  const iStart = src.indexOf('lastNightlyStartedAt: now.toISOString()'), iRun = src.indexOf('const result = await runNightlyV2();'), iDone = src.indexOf('c.backup.lastNightlyDate = today;');
  ok('the tick records a START before the run and the DONE date only after the backup file exists', iStart > -1 && iRun > iStart && iDone > iRun && /if \(result && result\.localPath\) c\.backup\.lastNightlyDate = today;/.test(src));

  for (const z of zips()) { try { fs.unlinkSync(path.join(root, 'backups', z)); } catch {} }
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  console.log(`\nBACKUP RESTART: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\nBACKUP RESTART: ${pass} passed, ${fail + 1} failed`); process.exit(1); });
