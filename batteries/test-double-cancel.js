// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-double-cancel.js - TWO TAPS ON CANCEL ARE ONE CANCEL (Oct 2026, from the pilot facility handoff's Part 2)
//
// A customer who tapped Cancel twice on /my-booking got two cancellation texts (and two emails): both
// requests passed the "already cancelled" check before either had finished asking Stripe for the refund.
// The staff pad's cancel had the same shape. The Stripe here is a stand-in that holds every refund for a
// second, so the two taps really do overlap (BA_STRIPE_API_BASE, an sk_test_ key only).
//   X1  two cancels sent at the same moment: one does it, the other is told it is already under way
//   X2  the customer gets ONE cancellation text, and the owner's log ONE CUSTOMER_CANCEL line
//   X3  the staff pad's cancel, tapped twice at once: one cancel, one "already being cancelled"
//   X4  the OWNER's cancel on Admin > Bookings, clicked twice at once: one cancel, one "already being cancelled", one
//       text (Oct 3 2026 - the Oct 2 fix covered the customer's and the pad's cancels only)
//   X5  the owner cancelling a booking the customer already cancelled (a stale list): refused, no second text
//   X6  A MEMBER'S OWN CANCEL GIVES BACK WHAT THE BOOKING HELD (Oct 27 2026, finding 15 of the Oct 25 review - the one
//       shipped bug): the customer's cancel only set the status, while the owner's and the staff pad's cancels give the
//       member back the free time, the guest passes and the credit. A member's 90-minute session (60 free minutes, 30 paid,
//       2 covered guests, $15.00 of her $30.00 credit applied, $10.00 on her card) is written BEFORE the unit starts by
//       the booking page's own ledger (bookingledger.recordAll). She cancels it herself on /my-booking: another hour that
//       month quotes 60 free minutes again, her 4 guest passes are back, her $30.00 is back - once, as 'Restored - booking
//       cancelled', the words the other two cancels write - and her card's $10.00 goes back as before
//   X7  ...and it all still holds after the unit restarts (a fresh process answers the same; then read on disk)
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };
const root = __dirname, PORT = 3168, SPORT = 3169, B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// what each payment took: $50.00, and the member's $10.00 (X6) - a refund with no amount gives back the whole charge, as Stripe does
const amountOf = id => /_mem$/.test(String(id || '')) ? 1000 : 5000;
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', async () => {
    res.setHeader('Content-Type', 'application/json');
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && u.startsWith('/v1/payment_intents/')) { const id = u.split('/')[3]; return res.end(JSON.stringify({ id, object: 'payment_intent', status: 'succeeded', amount: amountOf(id), amount_received: amountOf(id), latest_charge: 'ch_' + id.slice(3) })); }
    if (req.method === 'GET' && u.startsWith('/v1/charges/')) return res.end(JSON.stringify({ id: u.split('/')[3], object: 'charge', amount: amountOf(u.split('/')[3]), amount_captured: amountOf(u.split('/')[3]) }));
    if (req.method === 'POST' && u === '/v1/refunds') { await sleep(1000); const p = new URLSearchParams(body); return res.end(JSON.stringify({ id: 're_' + Date.now(), object: 'refund', amount: Number(p.get('amount')) || amountOf(p.get('charge') || p.get('payment_intent')), status: 'succeeded', charge: p.get('charge') })); }
    if (req.method === 'GET') return res.end(JSON.stringify({ object: 'list', data: [], has_more: false }));
    res.statusCode = 404; res.end('{}');
  });
});
const call = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let d = {}; try { d = await r.json(); } catch {} return { s: r.status, d }; };

(async () => {
  await new Promise(r => stripe.listen(SPORT, '127.0.0.1', r));
  try { if ((await fetch(B + '/api/time')).ok) { ok('port ' + PORT + ' is free', false); process.exit(1); } } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Tap Club', setup: { completed: true, eulaAccepted: true },
    server: { port: PORT, businessName: 'Tap Club', adminPassword: 'tap-pw', timezone: 'America/Chicago' },
    booking: { staffedAccess: true, pricePerHalfHour: 25, cancelWindowHours: 24 }, waiver: { mode: 'off' },
    stripe: { secretKey: 'sk_test_doubletap', publishableKey: 'pk_test_doubletap' },
    bays: [{ id: 'dc-b1', name: 'Bay 1', active: true }]
  }, null, 2));
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    db.initDb().then(async () => {
      const t = new Date(Date.now() + 72 * 3600000), p = n => String(n).padStart(2, '0'), d = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
      const B = "INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent,stripe_charge_id,sms_consent) VALUES (?,'dc-b1','Bay 1',?,?,?,?,?,?,60,5000,0,'active',?,?,1)";
      db.db.prepare(B).run('dc-cust',  'Tap Customer', '+15550202001', 'tap@double.example', d, '10:00', '11:00', 'pi_cust', 'ch_cust');
      db.db.prepare(B).run('dc-staff', 'Pad Customer', '+15550202002', 'pad@double.example', d, '12:00', '13:00', 'pi_staff', 'ch_staff');
      db.db.prepare(B).run('dc-owner', 'Owner Customer', '+15550202003', 'own@double.example', d, '14:00', '15:00', 'pi_owner', 'ch_owner');
      // X6: a member on one free hour a month with 4 guest passes and $30.00 of credit books 90 minutes with 2 guests -
      // the row as the booking page writes it, then the booking page's own ledger writes her usage, passes and credit
      db.db.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,guest_allowed,guest_passes_per_month,guest_max_per_visit,price_monthly,active) VALUES ('dc-gold','Gold Club','free_hours',1,1,4,4,99,1)").run();
      db.db.prepare("INSERT INTO members (id,tier_id,name,phone,email,pin,status) VALUES ('dc-m1','dc-gold','Kit Lane','+15550202004','kit@double.example','7105','active')").run();
      db.db.prepare("INSERT INTO member_credit (member_id,delta_cents,reason,booking_id) VALUES ('dc-m1',3000,'Opening credit','')").run();
      db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent,stripe_charge_id,sms_consent,member_id,member_guest_count,member_guest_covered) VALUES ('dc-mem','dc-b1','Bay 1','Kit Lane','+15550202004','kit@double.example',?,'16:00','17:30',90,1000,0,'active','pi_mem','ch_mem',1,'dc-m1',2,2)").run(d);
      console.log('LEDGER ' + JSON.stringify(require('./services/bookingledger').recordAll('dc-mem', { creditCents: 1500 })));
      console.log('DATE ' + d);
      await db.flushed(); process.exit(0);
    }).catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  ok('stage: two paid bookings three days out, written before the unit starts', seed.status === 0, (seed.stderr || '').slice(-300));
  const ledger = JSON.parse(((seed.stdout || '').match(/LEDGER (\{.*\})/) || [])[1] || '{}');
  const mDay = ((seed.stdout || '').match(/DATE (\d{4}-\d\d-\d\d)/) || [])[1] || '';
  ok('stage: the member\'s session and its ledger rows (usage with 2 guest passes, $15.00 of credit applied) are on the unit before it starts', ledger.memberUsage === 'wrote' && ledger.credit === 'wrote' && !!mDay, { ledger, mDay });

  const env = Object.assign({}, process.env, { BA_STRIPE_API_BASE: 'http://127.0.0.1:' + SPORT, SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' });
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  let up = false; for (let i = 0; i < 50; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
  ok('stage: the unit is up', up, out.slice(-300));

  await call('POST', '/api/customer/request-pin', { email: 'tap@double.example' });
  await sleep(400);
  const code = ((out.match(/verification code: (\d{6})/g) || []).pop() || '').slice(-6);
  const v = await call('POST', '/api/customer/verify-pin', { email: 'tap@double.example', pin: code });
  ok('stage: the customer signs in to /my-booking with the code they were sent', v.s === 200 && (v.d.bookings || []).some(b => b.id === 'dc-cust'), { s: v.s, code: !!code });

  const before = out.length;
  const both = await Promise.all([1, 2].map(() => call('POST', '/api/customer/cancel', { email: 'tap@double.example', pin: code, bookingId: 'dc-cust' })));
  await sleep(600);
  const st = both.map(r => r.s).sort();
  ok('X1 two cancels at once: one cancels (200), the other is told it is already under way (409)', JSON.stringify(st) === '[200,409]', both.map(r => ({ s: r.s, e: r.d.error })));
  const texts = (out.slice(before).match(/\[DRYRUN SMS to \+15550202001\][^\n]*\n[^\n]*cancelled/g) || []).length;
  ok('X2 the customer gets ONE cancellation text', texts === 1, { texts });
  // X4, X5: the owner's cancel
  const ownerCall = async (p, b) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': 'tap-pw' }, body: JSON.stringify(b) }); let d = {}; try { d = await r.json(); } catch {} return { s: r.status, d }; };
  const beforeOwner = out.length;
  const twice = await Promise.all([1, 2].map(() => ownerCall('/api/admin/booking/cancel/dc-owner', { refund_type: 'full' })));
  await sleep(600);
  ok('X4 the owner\'s cancel clicked twice at once: one cancels (200), the other is told it is already under way (409)', JSON.stringify(twice.map(r => r.s).sort()) === '[200,409]', twice.map(r => ({ s: r.s, e: r.d.error })));
  const ownerTexts = (out.slice(beforeOwner).match(/\[DRYRUN SMS to \+15550202003\][^\n]*\n[^\n]*cancelled/g) || []).length;
  ok('X4 ...and that customer gets ONE cancellation text', ownerTexts === 1, { ownerTexts });
  const beforeStale = out.length;
  const stale = await ownerCall('/api/admin/booking/cancel/dc-cust', { refund_type: 'full' });
  await sleep(400);
  ok('X5 the owner cancelling a booking the customer already cancelled (a stale list): refused, and no second cancellation text', stale.s === 400 && /Already cancelled/.test(stale.d.error || '') && !/DRYRUN SMS to \+15550202001/.test(out.slice(beforeStale)), { stale });

  // X6: the member cancels her own session on /my-booking. What she holds is read the way the booking page reads it -
  // her PIN's quote for another hour that month (the free minutes), her guest passes left and her credit
  const quote = async () => { const r = await call('POST', '/api/members/validate-pin', { pin: '7105', date: mDay, start_time: '12:00', duration_minutes: 60 }); const b = r.d.blend || {}; return { s: r.s, free: b.free_minutes, cents: b.member_cents, pub: b.public_cents, passes: r.d.guest_passes_remaining, credit: r.d.credit_cents }; };
  const q0 = await quote();
  ok('stage: before her cancel the session holds her free hour (another hour that month quotes 0 free minutes, the full public price), 2 of her 4 guest passes and $15.00 of her $30.00 credit',
    q0.free === 0 && q0.cents > 0 && q0.cents === q0.pub && q0.passes === 2 && q0.credit === 1500, q0);
  const markM = out.length;
  await call('POST', '/api/customer/request-pin', { email: 'kit@double.example' });
  let kCode = ''; for (let i = 0; i < 20 && !kCode; i++) { await sleep(150); kCode = ((out.slice(markM).match(/verification code: (\d{6})/g) || []).pop() || '').slice(-6); }
  const kv = await call('POST', '/api/customer/verify-pin', { email: 'kit@double.example', pin: kCode });
  ok('stage: she signs in to /my-booking with the code she was sent and sees her session, cancellable', kv.s === 200 && (kv.d.bookings || []).some(b => b.id === 'dc-mem' && b.cancellable), { s: kv.s, code: !!kCode });
  const kc = await call('POST', '/api/customer/cancel', { email: 'kit@double.example', pin: kCode, bookingId: 'dc-mem' });
  ok('stage: she cancels it herself and her card is refunded (the amount is read on disk in X7)', kc.s === 200 && kc.d.success === true && kc.d.refunded === true, kc);
  const q1 = await quote();
  ok('X6 her free hour is hers again: another hour that month quotes 60 free minutes, $0.00 (rule 3, free time first)', q1.free === 60 && q1.cents === 0, q1);
  ok('X6 the 2 guest passes the session spent are back - 4 left that month', q1.passes === 4, q1);
  ok('X6 the $15.00 of credit it applied is back - $30.00 again', q1.credit === 3000, q1);
  const kc2 = await call('POST', '/api/customer/cancel', { email: 'kit@double.example', pin: kCode, bookingId: 'dc-mem' });
  const q1b = await quote();
  ok('X6 a second tap is refused at the route ("Already cancelled") - her credit stays $30.00, nothing given twice', kc2.s === 400 && /Already cancelled/.test(kc2.d.error || '') && q1b.credit === 3000, { kc2, q1b });
  child.kill('SIGTERM'); for (let i = 0; i < 25 && child.exitCode === null; i++) await sleep(200); if (child.exitCode === null) child.kill('SIGKILL');
  const logs = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=db.exec("SELECT COUNT(*) FROM admin_log WHERE event='CUSTOMER_CANCEL' AND detail LIKE '%dc-cust%'");console.log('N '+r[0].values[0][0]);process.exit(0)})`], { cwd: root, encoding: 'utf8' });
  ok('X2 ...and the owner\'s log has ONE CUSTOMER_CANCEL line for it', /N 1\b/.test(logs.stdout), logs.stdout.trim());

  // X7: the unit restarts - a fresh process reads what she was given back from the file, then the file itself is read
  const child2 = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  let out2 = ''; child2.stdout.on('data', d => out2 += d); child2.stderr.on('data', d => out2 += d);
  let up2 = false; for (let i = 0; i < 50; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) { up2 = true; break; } } catch {} }
  ok('stage: the unit is up again after a restart', up2, out2.slice(-300));
  const q2 = await quote();
  ok('X7 after the restart her free hour, her 4 guest passes and her $30.00 are still hers', q2.free === 60 && q2.cents === 0 && q2.passes === 4 && q2.credit === 3000, q2);
  child2.kill('SIGTERM'); for (let i = 0; i < 25 && child2.exitCode === null; i++) await sleep(200); if (child2.exitCode === null) child2.kill('SIGKILL');
  const held = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const one=s=>{const r=db.exec(s);return r.length?r[0].values:[]};console.log('HELD '+JSON.stringify({usage:one("SELECT COUNT(*) FROM member_usage WHERE booking_id='dc-mem'")[0][0],guests:one("SELECT COUNT(*) FROM member_guests WHERE booking_id='dc-mem'")[0][0],restored:one("SELECT delta_cents, reason FROM member_credit WHERE booking_id='dc-mem' AND reason LIKE 'Restored%'"),status:one("SELECT status FROM bookings WHERE id='dc-mem'")[0][0],refunded:one("SELECT amount_cents FROM refunds WHERE booking_id='dc-mem'")}));process.exit(0)})`], { cwd: root, encoding: 'utf8' });
  const H = JSON.parse(((held.stdout || '').match(/HELD (\{.*\})/) || [])[1] || '{}');
  ok('X7 on disk: the session is cancelled, no usage or guest-pass row is left for it, and ONE restore of $15.00 in the words the owner\'s and the staff pad\'s cancels write',
    H.status === 'cancelled' && H.usage === 0 && H.guests === 0 && JSON.stringify(H.restored) === JSON.stringify([[1500, 'Restored - booking cancelled']]), H);
  // Oct 27 2026 (the review of 9a10c2d): the stage's "$10.00 goes back" was never checked - the unit's own refund record says it
  ok('X7 on disk: the unit recorded her card\'s $10.00 refunded (rule 38: revenue less the refund) - once', JSON.stringify(H.refunded) === JSON.stringify([[1000]]), H.refunded);

  // async, never spawnSync: the stand-in Stripe lives in THIS process and must keep answering while the child waits
  const staff = await new Promise(resolve => { const c = spawn(process.execPath, ['-e', `
    const db = require('./services/db');
    db.initDb().then(async () => {
      const be = require('./services/bookingedit');
      const r = await Promise.all([1, 2].map(() => be.cancelBooking('dc-staff', { refund_type: 'full', actor: 'Sam', reason: 'battery' })));
      await db.flushed(); console.log('PAD ' + JSON.stringify(r.map(x => x.ok ? 'ok' : (x.code + ' ' + x.error))));
      process.exit(0);
    }).catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const o = { stdout: '', stderr: '' }; c.stdout.on('data', d => o.stdout += d); c.stderr.on('data', d => o.stderr += d);
    const t = setTimeout(() => c.kill('SIGKILL'), 60000); c.on('exit', () => { clearTimeout(t); resolve(o); }); });
  const pad = JSON.parse(((staff.stdout || '').match(/PAD (\[.*\])/) || [])[1] || '[]');
  ok('X3 the staff pad\'s cancel tapped twice at once: one cancel, one "already being cancelled"', pad.filter(x => x === 'ok').length === 1 && pad.some(x => /^409 /.test(x)), { pad, err: (staff.stderr || '').slice(-200) });
  const padTexts = ((staff.stdout || '').match(/\[DRYRUN SMS to \+15550202002\][^\n]*\n[^\n]*cancelled/g) || []).length;
  ok('X3 ...and that customer gets ONE cancellation text', padTexts === 1, { padTexts });

  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  stripe.close();
  console.log(`\nDOUBLE CANCEL: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
