// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-no-freeze.js - A REQUEST NEVER WAITS ON THE CARD (Sep 24 2026)
//
// Found by the aged year on the Pi in the first deep sweep: a booking on a year-old
// unit (12 MB database) took 6.7 to 9.9 seconds, and the whole unit froze for up to 3 s
// after one - the pad, the bay PCs' session polls, everyone. The booking ledger, which
// every booking passes through BEFORE its reply, ended with saveDb(): the synchronous
// flush, whose fdatasync on the Pi's card is ~0.4 s for 12 MB and seconds when the card
// is busy - on the main thread, so every request waited behind it. Five more request
// paths did the same (a seat renamed, a paper waiver at check-in, a membership waiver,
// an item moved between tabs, the wizard's first tier). Each now writes through
// flushed(): the same export, fdatasync, rename and directory sync, the fsync in the
// thread pool.
//   A  a stand-in card whose fsync takes 1.5 s - the blocking call and the thread-pool
//      call both - and a booking made through the booking page: the reply does not
//      wait for the card, the unit keeps answering while it writes, and the booking is
//      on disk moments later all the same
//   B  no request path calls the synchronous flush; only the backup and the restore do
//      (they need the file whole before they go on)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const PORT = 3142, B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SLOW = path.join(root, '.nofreeze-slow-card');
const STUB = path.join(root, '.nofreeze-stub.js');
// THE SLOW CARD: every fsync takes 1.5 s while the flag file exists - the blocking
// call blocks for it, the thread-pool call waits for it. Both are the real calls after.
fs.writeFileSync(STUB, `
const fs = require('fs');
const slow = () => fs.existsSync(${JSON.stringify(SLOW)});
const busy = ms => { const t = Date.now(); while (Date.now() - t < ms) {} };
for (const k of ['fdatasyncSync', 'fsyncSync']) { const o = fs[k]; fs[k] = function () { if (slow()) busy(1500); return o.apply(this, arguments); }; }
const open = fs.promises.open;
fs.promises.open = async function () {
  const fh = await open.apply(this, arguments);
  for (const k of ['datasync', 'sync']) { const o = fh[k].bind(fh); fh[k] = async () => { if (slow()) await new Promise(r => setTimeout(r, 1500)); return o(); }; }
  return fh;
};`);

let child = null;
(async () => {
  try {
    try { if ((await fetch(B + '/api/time')).ok) { console.log('FAIL  port ' + PORT + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    for (const f of ['config.json', 'bookings.db', SLOW]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'No Freeze Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: PORT, businessName: 'No Freeze Golf', adminPassword: 'no-freeze-pw', timezone: 'America/Chicago' },
      booking: { staffedAccess: false, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, windowDays: 30 },
      waiver: { mode: 'off' }, sms: { sendReminder: false, sendDoorCode: false, sendEndingWarning: false },
      bays: [{ id: 'nf-b1', name: 'Bay One', active: true }]
    }, null, 2));
    child = spawn(process.execPath, ['-r', STUB, 'server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' }) });
    let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    let up = false; for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
    ok('A0 the unit boots', up, log.slice(-300));

    console.log('── A. a booking on a card that takes 1.5 s to fsync ──');
    fs.writeFileSync(SLOW, '1');
    const d = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (2), 12); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let polling = true; const polls = [];
    const poller = (async () => { while (polling) { const t = Date.now(); try { await fetch(B + '/api/time'); } catch {} polls.push([t, Date.now() - t]); await sleep(40); } })();
    await sleep(300);
    const t0 = Date.now();
    const r = await fetch(B + '/api/bookings/create-payment-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Freeze', phone: '7015559002', email: '', date: day, start_time: '14:00', duration_minutes: 60, bay_id: 'nf-b1', sms_consent: false, ip_address: '127.0.0.1' }) });
    const replyMs = Date.now() - t0; let body = null; try { body = await r.json(); } catch {}
    await sleep(2500); polling = false; await poller;
    const window = polls.filter(([t]) => t >= t0 - 100);
    const worst = Math.max(0, ...window.map(p => p[1]));
    ok(`A1 the booking is made and the reply does not wait for the card: ${replyMs} ms (a blocking fsync alone is 1500)`, r.status === 200 && body && body.bookingId && replyMs < 1000, { status: r.status, replyMs, body: body && (body.error || body.bookingId) });
    ok(`A2 the unit keeps answering while the booking is written: the slowest /api/time in the 2.5 s after is ${worst} ms (${window.length} polls; frozen would be 1500+)`, window.length >= 20 && worst < 700, { worst, n: window.length });
    let onDisk = false;
    for (let i = 0; i < 40 && !onDisk; i++) {
      const q = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec("SELECT COUNT(*) FROM bookings WHERE id='${body && body.bookingId}'");console.log(r.length?r[0].values[0][0]:0);process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 30000 });
      onDisk = String(q.stdout).trim() === '1'; if (!onDisk) await sleep(250);
    }
    ok('A3 ...and the booking is on disk moments later all the same - written, fsynced and renamed into place, just not on the reply\'s time', onDisk);
    fs.unlinkSync(SLOW);

    console.log('\n── B. no request path calls the synchronous flush ──');
    const files = ['server.js'].concat(fs.readdirSync('services').map(f => 'services/' + f), fs.readdirSync('routes').map(f => 'routes/' + f)).filter(f => f.endsWith('.js') && f !== 'services/db.js');
    const sync = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => { const code = l.replace(/\/\/.*$/, ''); if (/\bsaveDb\s*\(|\bflushSync\s*\(/.test(code)) sync.push(`${f}:${i + 1}`); });
    }
    const allowed = s => /^services\/backup\.js:|^services\/schema\.js:/.test(s);
    ok('B1 the synchronous flush is called only by the backup (the file must be whole before it is archived) and the restore\'s migration - never a request path', sync.length >= 2 && sync.every(allowed), sync);
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    if (child) { child.kill('SIGINT'); await new Promise(r => { child.on('exit', r); setTimeout(r, 4000); }); }
    for (const f of ['config.json', 'bookings.db', SLOW, STUB]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
  }
  console.log(`\nNO FREEZE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
