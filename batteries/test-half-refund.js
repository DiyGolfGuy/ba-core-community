// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-half-refund.js - A 50% REFUND IS HALF OF WHAT THE CUSTOMER PAID (Oct 2026, from pilot facility's 09-27 addendum)
//
// The owner's cancel and the staff pad's cancel refunded floor(price_cents / 2) for "50% refund". The
// session's tax is stored apart and charged on top, so a $50.00 session with $3.69 tax - $53.69 paid - gave
// back $25.00, not $26.85, and the owner's reply and log said a full refund was $50.00 when Stripe gave back
// $53.69. The bench's own sandbox battery could not see it: the bench sells with no tax.
//   H1  the owner's 50% refund asks Stripe for half of the charge ($26.85), and the reply says so
//   H2  the staff pad's 50% refund (services/bookingedit.js) asks for the same
//   H3  a full refund's reply names what Stripe gave back ($53.69), not the price without its tax
//   H4  when Stripe cannot say what it took, half of the price and tax the unit recorded
// The Stripe behind both is a stand-in living in this process (BA_STRIPE_API_BASE, an sk_test_ key only):
// it serves the charge and the intent, refuses to be read for one charge, and records every refund asked of it.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };
const root = __dirname, PORT = 3165, SPORT = 3166, B = 'http://127.0.0.1:' + PORT, PW = 'half-refund-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PRICE = 5000, TAX = 369, PAID = PRICE + TAX, HALF = Math.round(PAID / 2);   // 5369 -> 2685

const refunds = [];
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const u = req.url.split('?')[0];
    if (req.method === 'GET' && u.startsWith('/v1/charges/')) {
      const id = u.split('/')[3];
      if (id === 'ch_unreadable') { res.statusCode = 500; return res.end(JSON.stringify({ error: { type: 'api_error', message: 'An unknown error occurred' } })); }
      // a charge the owner already partly refunded in Stripe's dashboard (rule 39 picks those up): $20.00, or $30.00 (past half)
      const already = id === 'ch_part' ? 2000 : id === 'ch_pasthalf' ? 3000 : 0;
      return res.end(JSON.stringify({ id, object: 'charge', amount: PAID, amount_captured: PAID, amount_refunded: already, refunded: already >= PAID, paid: true }));
    }
    if (req.method === 'GET' && u.startsWith('/v1/payment_intents/')) {
      const id = u.split('/')[3];
      if (id === 'pi_unreadable') { res.statusCode = 500; return res.end(JSON.stringify({ error: { type: 'api_error', message: 'An unknown error occurred' } })); }
      return res.end(JSON.stringify({ id, object: 'payment_intent', status: 'succeeded', amount: PAID, amount_received: PAID, latest_charge: 'ch_' + id.slice(3) }));
    }
    if (req.method === 'POST' && u === '/v1/refunds') {
      const p = new URLSearchParams(body);
      const amount = p.get('amount') ? Number(p.get('amount')) : null;
      refunds.push({ charge: p.get('charge'), payment_intent: p.get('payment_intent'), amount });
      // as Stripe answers: an amount of 0 (or less) is refused
      if (p.get('amount') !== null && !(Number(p.get('amount')) > 0)) { res.statusCode = 400; return res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'parameter_invalid_integer', message: 'This value must be greater than or equal to 1.' } })); }
      return res.end(JSON.stringify({ id: 're_' + refunds.length, object: 'refund', amount: amount == null ? PAID : amount, status: 'succeeded', charge: p.get('charge'), payment_intent: p.get('payment_intent') }));
    }
    if (req.method === 'GET') return res.end(JSON.stringify({ object: 'list', data: [], has_more: false }));
    res.statusCode = 404; res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'stand-in: no route ' + req.method + ' ' + u } }));
  });
});
const refundFor = charge => refunds.filter(r => r.charge === charge).slice(-1)[0];

(async () => {
  await new Promise(r => stripe.listen(SPORT, '127.0.0.1', r));
  try { if ((await fetch(B + '/api/time')).ok) { ok('port ' + PORT + ' is free', false); process.exit(1); } } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Half Club', setup: { completed: true, eulaAccepted: true },
    server: { port: PORT, businessName: 'Half Club', adminPassword: PW, timezone: 'America/Chicago' },
    booking: { staffedAccess: true, pricePerHalfHour: 25, cancelWindowHours: 24 }, waiver: { mode: 'off' },
    stripe: { secretKey: 'sk_test_halfrefund', publishableKey: 'pk_test_halfrefund' },
    bays: [{ id: 'hr-b1', name: 'Bay 1', active: true }]
  }, null, 2));
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    db.initDb().then(async () => {
      const B = "INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent,stripe_charge_id) VALUES (?,'hr-b1','Bay 1',?,'5550199','h@r.c','2030-06-0'||?,'10:00','11:00',60,${PRICE},${TAX},'active',?,?)";
      db.db.prepare(B).run('hr-owner', 'Owner Half', '1', 'pi_owner', 'ch_owner');
      db.db.prepare(B).run('hr-staff', 'Staff Half', '2', 'pi_staff', 'ch_staff');
      db.db.prepare(B).run('hr-full',  'Owner Full', '3', 'pi_full',  'ch_full');
      db.db.prepare(B).run('hr-blind', 'Blind Half', '4', 'pi_unreadable', 'ch_unreadable');
      db.db.prepare(B).run('hr-part',  'Part Half',  '5', 'pi_part', 'ch_part');
      db.db.prepare(B).run('hr-past',  'Past Half',  '6', 'pi_pasthalf', 'ch_pasthalf');
      await db.flushed(); process.exit(0);
    }).catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  ok('stage: six paid bookings ($50.00 + $3.69 tax each) written before the unit starts', seed.status === 0, (seed.stderr || '').slice(-300));

  const env = Object.assign({}, process.env, { BA_STRIPE_API_BASE: 'http://127.0.0.1:' + SPORT, SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' });
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  let up = false; for (let i = 0; i < 50; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
  ok('stage: the unit is up', up, log.slice(-300));
  const cancel = async (id, type) => { const r = await fetch(B + '/api/admin/booking/cancel/' + id, { method: 'POST', headers: { 'x-admin-password': PW, 'Content-Type': 'application/json' }, body: JSON.stringify({ refund_type: type }) }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };

  const h1 = await cancel('hr-owner', 'half');
  ok('H1 the owner\'s 50% refund asks Stripe for half of what was paid ($26.85 of $53.69)', (refundFor('ch_owner') || {}).amount === HALF, { asked: refundFor('ch_owner'), want: HALF });
  ok('H1 ...and the reply says what went back', h1.s === 200 && h1.j.refund_amount_cents === HALF, { s: h1.s, cents: h1.j.refund_amount_cents, msg: h1.j.message });
  const h3 = await cancel('hr-full', 'full');
  ok('H3 a full refund asks for the whole charge (no amount) and the reply names $53.69, the price AND its tax', (refundFor('ch_full') || {}).amount === null && h3.j.refund_amount_cents === PAID, { asked: refundFor('ch_full'), cents: h3.j.refund_amount_cents });
  const h4 = await cancel('hr-blind', 'half');
  ok('H4 when Stripe cannot say what it took, half of the price and tax the unit recorded', (refundFor('ch_unreadable') || {}).amount === HALF, { asked: refundFor('ch_unreadable'), s: h4.s });
  // H5/H6 (Oct 3 2026, the pack review): half IN ALL - what the owner already refunded in Stripe comes off
  const h5 = await cancel('hr-part', 'half');
  ok('H5 $20.00 already refunded in Stripe\'s dashboard, then a 50% cancel: Stripe is asked for $6.85 more - $26.85 back in all, not $46.85', (refundFor('ch_part') || {}).amount === HALF - 2000 && h5.s === 200, { asked: refundFor('ch_part'), s: h5.s });
  const h6 = await cancel('hr-past', 'half');
  ok('H6 $30.00 already refunded (past half), then a 50% cancel: nothing more is sent - no refusal, no error - and the booking is cancelled', !refundFor('ch_pasthalf') && h6.s === 200 && h6.j.success === true, { asked: refundFor('ch_pasthalf'), s: h6.s, j: h6.j });
  child.kill('SIGTERM'); for (let i = 0; i < 25 && child.exitCode === null; i++) await sleep(200); if (child.exitCode === null) child.kill('SIGKILL');

  // the staff pad's cancel - the same module the pad's route calls - in its own process, the server stopped
  const staff = await new Promise(resolve => {
    const c = spawn(process.execPath, ['-e', `
      const db = require('./services/db');
      db.initDb().then(async () => {
        const r = await require('./services/bookingedit').cancelBooking('hr-staff', { refund_type: 'half', actor: 'Sam', reason: 'battery' });
        await db.flushed(); console.log('CANCEL ' + JSON.stringify({ ok: r.ok, error: r.error, refunded: r.refunded, amount: r.refund_amount_cents })); process.exit(0);
      }).catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; c.stdout.on('data', d => o += d); c.stderr.on('data', d => o += d); c.on('exit', () => resolve(o));
  });
  ok('H2 the staff pad\'s 50% refund asks Stripe for the same half ($26.85)', (refundFor('ch_staff') || {}).amount === HALF, { asked: refundFor('ch_staff'), out: staff.slice(-300) });

  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  stripe.close();
  console.log(`\nHALF REFUND: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
