// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-refunds.js - MONEY GIVEN BACK, WHEREVER IT WAS GIVEN BACK (maintainer, Sep 24 2026)
//
// "Refunds picked up from Stripe is the important one - an owner refunding in
//  Stripe's dashboard and the unit never knowing is the tax-time surprise we're
//  trying to prevent, and it affects online bookings too, not just the counter."
// "Who can refund: any staff member, with a reason, on the daily review like a void."
//
// A stand-in Stripe that answers as the spec says ([R1]-[R5] in services/refunds.js)
// and REFUSES the way Stripe does - an unknown payment, a refund larger than what
// is left on it, a path it does not know. The unit's state is staged on disk before
// it boots and the Stripe side already holds refunds made "in the dashboard", so the
// pickup is proven against existing state and across two restarts (rule 22):
//   A  the boot check records every refund made in Stripe against what it came off -
//      a booking, a counter card payment, a gift-card purchase, a membership payment -
//      leaves a stranger's alone, and counts neither a failed refund nor one still
//      waiting on the customer
//   B  a restart, and another, record nothing twice
//   C  the counter refund: any staff member, a reason, the sale first then the tip,
//      cash out of End of Day, card back through Stripe with our marker, refused
//      when it cannot be right, and on the owner's daily review
//   D  the webhook: our own refund echoed back keeps the staff member's reason and
//      is not recorded twice; a refund Stripe later fails stops counting
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 420) : '')); } };
const root = __dirname;
const PORT = 3136, SPORT = 3137;
const B = 'http://127.0.0.1:' + PORT;
const PW = 'refunds-battery-pw';
const H = { 'x-admin-password': PW, 'Content-Type': 'application/json' };
const WHSEC = 'whsec_refunds_battery_' + 'x'.repeat(16);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Math.floor(Date.now() / 1000);

// ── the stand-in Stripe ─────────────────────────────────────────────────────
// payments it knows: amount that was charged, what is refunded so far
const PI = {
  pi_book1:   { amount: 5350, charge: 'ch_book1' },   // an online booking, $50 + $3.50 tax
  pi_card1:   { amount: 2300, charge: 'ch_card1' },   // a counter reader payment, $20 + $3 tip
  pi_card2:   { amount: 1000, charge: 'ch_card2' },   // a second reader payment, refunded at the pad
  pi_refuse:  { amount: 1500, charge: 'ch_refuse', refuse: true },   // Stripe will not refund this one
  pi_gift1:   { amount: 5000, charge: 'ch_gift1' },   // a gift card bought online
  pi_mem1:    { amount: 5900, charge: 'ch_mem1' },    // a membership invoice payment
  pi_foreign: { amount: 9900, charge: 'ch_foreign' }  // a payment this unit never made
};
const REFUNDS = [];   // newest first, like Stripe's list
const CALLS = [];
function refundObj(pi, amount, extra) {
  const r = Object.assign({ id: 're_' + crypto.randomBytes(6).toString('hex'), object: 'refund', amount, charge: PI[pi].charge, payment_intent: pi,
    status: 'succeeded', created: NOW - 60, currency: 'usd', metadata: {}, reason: null }, extra || {});
  REFUNDS.unshift(r); return r;
}
// made "in the dashboard" before the unit ever boots
const DASH = {
  book:    refundObj('pi_book1', 1000, { reason: 'requested_by_customer' }),
  card:    refundObj('pi_card1', 2100),                       // more than the $20 sale: $20 off the sale, $1 off the tip
  gift:    refundObj('pi_gift1', 5000),                       // the whole card
  mem:     refundObj('pi_mem1', 5900),
  foreign: refundObj('pi_foreign', 9900),
  failed:  refundObj('pi_book1', 300, { status: 'failed', failure_reason: 'expired_or_canceled_card' }),
  waiting: refundObj('pi_book1', 200, { status: 'requires_action' })
};
const refundedOn = pi => REFUNDS.filter(r => r.payment_intent === pi && ['succeeded', 'pending'].includes(r.status)).reduce((s, r) => s + r.amount, 0);
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const form = Object.fromEntries(new URLSearchParams(body));
    CALLS.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), form });
    const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const err = (st, code, message) => send(st, { error: { type: 'invalid_request_error', code, message } });
    if (!/^Bearer sk_test_/.test(req.headers.authorization || '')) return send(401, { error: { type: 'authentication_error', message: 'Invalid API Key provided' } });
    if (req.method === 'POST' && u.pathname === '/v1/refunds') {            // [R3]
      const pi = form.payment_intent;
      if (!pi || !PI[pi]) return err(400, 'resource_missing', `No such payment_intent: '${pi}'`);
      if (PI[pi].refuse) return err(400, 'charge_disputed', 'This charge has been disputed and cannot be refunded.');
      const amt = form.amount ? parseInt(form.amount, 10) : PI[pi].amount - refundedOn(pi);
      const left = PI[pi].amount - refundedOn(pi);
      if (amt > left) return err(400, 'amount_too_large', `Refund amount ($${(amt / 100).toFixed(2)}) is greater than unrefunded amount on charge ($${(left / 100).toFixed(2)})`);
      const meta = {}; for (const [k, v] of Object.entries(form)) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) meta[m[1]] = v; }
      return send(200, refundObj(pi, amt, { created: Math.floor(Date.now() / 1000), metadata: meta, reason: form.reason || null }));
    }
    if (req.method === 'GET' && u.pathname === '/v1/refunds') {             // [R2]
      let list = REFUNDS.slice();
      const gte = u.searchParams.get('created[gte]'); if (gte) list = list.filter(r => r.created >= Number(gte));
      if (u.searchParams.get('charge')) list = list.filter(r => r.charge === u.searchParams.get('charge'));
      if (u.searchParams.get('payment_intent')) list = list.filter(r => r.payment_intent === u.searchParams.get('payment_intent'));
      const after = u.searchParams.get('starting_after'); if (after) { const i = list.findIndex(r => r.id === after); list = i >= 0 ? list.slice(i + 1) : list; }
      const limit = Math.min(100, parseInt(u.searchParams.get('limit') || '10', 10));
      return send(200, { object: 'list', url: '/v1/refunds', data: list.slice(0, limit), has_more: list.length > limit });
    }
    if (req.method === 'GET' && u.pathname === '/v1/invoice_payments') {    // [R5]
      const pi = u.searchParams.get('payment[payment_intent]');
      if (u.searchParams.get('payment[type]') !== 'payment_intent') return err(400, 'parameter_missing', 'Missing required param: payment[type].');
      const data = pi === 'pi_mem1' ? [{ id: 'inpay_1', object: 'invoice_payment', invoice: 'in_mem1', payment: { type: 'payment_intent', payment_intent: pi }, status: 'paid' }] : [];
      return send(200, { object: 'list', url: '/v1/invoice_payments', data, has_more: false });
    }
    return err(404, 'resource_missing', `Unrecognized request URL (${req.method}: ${u.pathname}).`);
  });
});

function sign(raw) { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=` + crypto.createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex'); }

(async () => {
  for (const p of [PORT, SPORT]) { try { const r = await fetch('http://127.0.0.1:' + p + '/'); if (r) { console.log('FAIL  port ' + p + ' already answers - an orphaned server is running.'); process.exit(1); } } catch {} }
  await new Promise(r => stripe.listen(SPORT, '127.0.0.1', r));
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Refund Club', setup: { completed: true, eulaAccepted: true },
    server: { port: PORT, businessName: 'Refund Club', adminPassword: PW, timezone: 'America/Chicago',
      staff: [{ name: 'Sarah', code: '1234', active: true }] },
    stripe: { secretKey: 'sk_test_refundsbattery', publishableKey: 'pk_test_refundsbattery', webhookSecret: WHSEC },
    booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '09:00', closeTime: '21:00' }, waiver: { mode: 'off' },
    pos: { drawer: { enabled: true }, payments: { cash: true, check: true } },
    bays: [{ id: 'rf-b1', name: 'Bay 1', active: true }]
  }, null, 2));
  const ts = new Date(Date.now() - 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const today = new Date().toISOString().slice(0, 10);
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    (async () => {
      await db.initDb(); require('./services/pos').ensureSchema();
      const T = ${JSON.stringify(ts)}, D = ${JSON.stringify(today)};
      db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent,stripe_charge_id,created_at) VALUES ('rf-book','rf-b1','Bay 1','Customer Rf','+15550100','',?,'18:00','19:00',?,60,5000,350,'active','pi_book1','ch_book1',?)").run(D, D, T);
      db.db.prepare("INSERT INTO tabs (id,label,status,opened_by) VALUES ('rf-tab','Bar Rf','closed','Sarah')").run();
      db.db.prepare("INSERT INTO tab_items (id,tab_id,name,qty,unit_price_cents,tax_category,kind,status,sent_at) VALUES ('rf-it','rf-tab','Burgers',1,5000,'food','menu','sent',?)").run(T);
      const pay = (id, m, a, tip, pi, memo) => db.db.prepare("INSERT INTO tab_payments (id,tab_id,method,amount_cents,tip_cents,stripe_pi,employee,memo,created_at) VALUES (?,'rf-tab',?,?,?,?, 'Sarah', ?, ?)").run(id, m, a, tip, pi, memo, T);
      pay('rf-pcard', 'card', 2000, 300, 'pi_card1', 'card reader');
      pay('rf-pcard2', 'card', 1000, 0, 'pi_card2', 'card reader');
      pay('rf-prefuse', 'card', 1500, 0, 'pi_refuse', 'card reader');
      pay('rf-pcash', 'cash', 1200, 200, '', '');
      pay('rf-pcheck', 'check', 800, 0, '', 'Check #101');
      pay('rf-pcredit', 'credit', 500, 0, '', 'member credit');
      db.db.prepare("INSERT INTO discount_codes (id,code,description,type,value,max_uses,uses_count,active,created_at) VALUES ('rf-gift','GCRFGIFT01',?,'gift',50,NULL,0,1,?)").run(JSON.stringify({ gift: true, paid: true, issuedBy: 'pi_gift1' }), T);
      db.db.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,price_monthly,active) VALUES ('rf-tier','Gold','percentage',10,59,1)").run();
      db.db.prepare("INSERT INTO members (id,tier_id,name,phone,pin,status) VALUES ('rf-mem','rf-tier','Member Rf','+15550101','8811','active')").run();
      db.recordMembershipPayment({ id: 'in_mem1', status: 'paid', amount_paid: 5900, tax: 0, status_transitions: { paid_at: Math.floor(Date.now() / 1000) - 7200 } }, 'rf-mem', 'webhook');
      await db.flushed(); process.exit(0);
    })().catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  ok('stage: a booking, a closed tab with card/cash/check/credit payments, a gift card and a membership payment on disk; refunds already made in Stripe', seed.status === 0, (seed.stderr || '').slice(-400));

  let child = null;
  const boot = async () => {
    child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { BA_STRIPE_API_BASE: 'http://127.0.0.1:' + SPORT, SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '' }) });
    let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d); child._log = () => log;
    for (let i = 0; i < 60; i++) { await sleep(300); try { if ((await fetch(B + '/api/time')).ok) return true; } catch {} }
    return false;
  };
  const stop = async () => { if (child) { child.kill('SIGINT'); await new Promise(r => { child.on('exit', r); setTimeout(r, 4000); }); child = null; } };
  process.on('exit', () => { try { child && child.kill('SIGKILL'); } catch {} try { stripe.close(); } catch {} });
  const j = async (m, p, body, h) => { const r = await fetch(B + p, { method: m, headers: h || H, body: body !== undefined ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d }; };
  const range = `start=${new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)}&end=${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}`;
  const summary = async () => ((await j('GET', '/api/admin/revenue/summary?' + range)).d || {}).range || {};
  const tab = async () => ((await j('GET', '/api/pos/tabs/rf-tab')).d || {}).tab || {};
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };

  console.log('── A. the boot check: refunds made in Stripe, recorded against what they came off ──');
  ok('A0 the unit boots', await boot(), child && child._log().slice(-300));
  const booted = await waitFor(async () => { const s = await j('GET', '/api/admin/refunds/status'); return s.d && s.d.last && s.d.last.at ? s.d : null; });
  ok('A1 the boot asked Stripe for its refunds on its own - no webhook, no button', !!booted && CALLS.some(c => c.method === 'GET' && c.path === '/v1/refunds' && c.query['created[gte]']), booted);
  let S = await summary();
  const expectOnline = 1000 + 5000 + 5900;         // the booking's partial, the gift card, the membership payment
  const expectCounter = 2000;                      // $21 off the reader payment: $20 of it off the sale
  ok('A2 revenue now carries every refund made in Stripe: the booking\'s $10, the gift card\'s $50, the membership\'s $59 and the counter card\'s $20 of sale', S.refunds_cents === expectOnline + expectCounter, { refunds: S.refunds_cents, expected: expectOnline + expectCounter });
  const bookRows = ((await j('GET', '/api/admin/log?limit=80')).d || {}).entries || [];
  ok('A3 ...and NOT the stranger\'s $99, the refund Stripe says failed ($3) or the one still waiting on the customer ($2): exactly the four, and the stranger named nowhere', S.refunds_cents === expectOnline + expectCounter && !bookRows.some(e => /99\.00/.test(e.detail || '')), S.refunds_cents);
  let T = await tab();
  const dashRow = (T.refunds || []).find(r => r.stripe_refund_id === DASH.card.id);
  ok('A4 the counter card refund is on its tab, made in Stripe: $20 off the sale and $1 off the tip, the payment itself unchanged', !!dashRow && dashRow.source === 'stripe' && dashRow.amount_cents === 2000 && dashRow.tip_cents === 100 && /Refunded in Stripe/.test(dashRow.reason) && (T.payments || []).find(p => p.id === 'rf-pcard').amount_cents === 2000, dashRow);
  ok('A5 ...so the tips beside revenue lose that $1 too', S.tips_cents === 300 + 200 - 100, S.tips_cents);
  const rev = await j('GET', '/api/pos/review');
  ok('A6 ...and it waits on the owner\'s daily review, marked as made in Stripe', (rev.d && rev.d.refunds || []).some(r => r.stripe_refund_id === DASH.card.id && r.source === 'stripe' && !r.reviewed), rev.d && rev.d.refunds);
  const csv = await (await fetch(B + '/api/admin/revenue/csv?from=' + range.split('&')[0].slice(6) + '&to=' + range.split('&')[1].slice(4), { headers: H })).text();
  ok('A7 the owner\'s CSV lists each: the booking refund, "gift card purchase refunded", "membership payment refunded" with the member', /Refund,Customer Rf,.*-10\.00/.test(csv) && /gift card purchase refunded,-50\.00/.test(csv) && /Member Rf,membership payment refunded,-59\.00/.test(csv), csv.split('\n').filter(l => /Refund/.test(l)));
  const gl = await j('GET', '/api/gifts/admin/list');
  const card = (Array.isArray(gl.d) ? gl.d : []).find(c => c.id === 'rf-gift') || null;
  ok('A8 the gift card whose purchase went back in full is switched off - the customer cannot have the money and the card', !!card && card.active === false, card);
  const lg = await j('GET', '/api/admin/log?limit=60');
  ok('A9 the owner\'s log says what came off revenue and why', ((lg.d && lg.d.entries) || []).filter(e => e.event === 'STRIPE_REFUND_RECORDED').length >= 3 && ((lg.d && lg.d.entries) || []).some(e => e.event === 'GIFTCARD_REFUNDED'), ((lg.d && lg.d.entries) || []).filter(e => /REFUND/.test(e.event)).map(e => e.event));

  console.log('\n── B. across restarts: nothing twice ──');
  const before = { refunds: S.refunds_cents, tabRows: (T.refunds || []).length };
  await stop(); ok('B1 a restart', await boot());
  await waitFor(async () => { const s = await j('GET', '/api/admin/refunds/status'); return s.d && s.d.last && s.d.last.at ? s.d : null; });
  S = await summary(); T = await tab();
  ok('B2 the second boot asked Stripe again and recorded nothing twice', before.refunds > 0 && before.tabRows > 0 && S.refunds_cents === before.refunds && (T.refunds || []).length === before.tabRows, { refunds: S.refunds_cents, rows: (T.refunds || []).length, before });
  await stop(); ok('B3 and another restart', await boot());
  await sleep(1500);
  const again = await j('POST', '/api/admin/refunds/check', {});
  S = await summary(); T = await tab();
  ok('B4 ...and the owner\'s Check now after it: every refund seen, none new, still nothing twice', again.s === 200 && again.d.recorded === 0 && again.d.checked >= 7 && S.refunds_cents === before.refunds && (T.refunds || []).length === before.tabRows, { again: again.d, refunds: S.refunds_cents });

  console.log('\n── C. the counter refund: any staff member, with a reason ──');
  const login = await j('POST', '/api/staff/login', { code: '1234' }, { 'Content-Type': 'application/json' });
  const SH = { 'x-staff-token': (login.d && login.d.token) || '', 'Content-Type': 'application/json' };
  ok('C0 Sarah signs in on the pad - staff, not the owner', login.s === 200 && !!(login.d && login.d.token), login.d);
  const refund = (pid, body, h) => j('POST', `/api/pos/tabs/rf-tab/payments/${pid}/refund`, body, h || SH);
  let r = await refund('rf-pcash', { amount_cents: 500 });
  ok('C1 no reason, no refund - in words', r.s === 400 && /reason/.test(r.d && r.d.error || ''), r.d);
  r = await refund('rf-pcash', { amount_cents: 1401, reason: 'too much' });
  ok('C2 more than the payment (sale + tip, $14.00) is refused, naming what can go back', r.s === 400 && /\$14\.00/.test(r.d && r.d.error || ''), r.d);
  r = await refund('rf-pcredit', { reason: 'member credit' });
  ok('C3 member credit is stored value, not money - refused', r.s === 400 && /card, cash and check/.test(r.d && r.d.error || ''), r.d);
  const eodBefore = ((await j('GET', '/api/pos/eod')).d || {}).expected_cash_cents;
  r = await refund('rf-pcash', { amount_cents: 1300, reason: 'charged for a burger never served' });
  const cashRow = r.d && r.d.refund;
  ok('C4 Sarah gives back $13.00 cash with a reason: $12 off the sale, $1 off the tip, stamped with HER name (the session, not the client)', r.s === 200 && cashRow && cashRow.amount_cents === 1200 && cashRow.tip_cents === 100 && cashRow.employee === 'Sarah' && cashRow.status === 'succeeded', r.d);
  const eod = (await j('GET', '/api/pos/eod')).d || {};
  ok('C5 End of Day expects $13.00 less cash, lists cash given back, and the drawer opened for it', eod.expected_cash_cents === eodBefore - 1300 && eod.refunds && eod.refunds.by_method.cash === 1300 && (eod.drawer_events || []).some(e => e.reason === 'cash refund'), { before: eodBefore, after: eod.expected_cash_cents, refunds: eod.refunds && eod.refunds.by_method });
  const callsBefore = CALLS.length;
  r = await refund('rf-pcard2', { amount_cents: 600, reason: 'charged twice' });
  const cardCall = CALLS.slice(callsBefore).find(c => c.method === 'POST' && c.path === '/v1/refunds');
  ok('C6 a card refund goes back through Stripe on that payment, for that amount, carrying our marker and the tab', r.s === 200 && !!cardCall && cardCall.form.payment_intent === 'pi_card2' && cardCall.form.amount === '600' && !!cardCall.form['metadata[ba_owner]'] && cardCall.form['metadata[ba_counter_refund]'] === r.d.refund.id && cardCall.form['metadata[tab_id]'] === 'rf-tab', { st: r.s, call: cardCall && cardCall.form });
  const cardRow = r.d && r.d.refund;
  ok('C7 ...and is recorded with Stripe\'s refund id, succeeded', !!cardRow && /^re_/.test(cardRow.stripe_refund_id) && cardRow.status === 'succeeded' && cardRow.source === 'counter', cardRow);
  r = await refund('rf-pcheck', { reason: 'returned the check' });
  ok('C8 a check refund with no amount gives back the whole $8.00', r.s === 200 && r.d.refund.amount_cents === 800 && r.d.refund.method === 'check', r.d);
  r = await refund('rf-pcheck', { reason: 'again' });
  ok('C9 ...and a second one is refused - it has all gone back', r.s === 400 && /in full/.test(r.d && r.d.error || ''), r.d);
  const logBefore = ((await j('GET', '/api/admin/log?limit=5')).d || {}).entries || [];
  r = await refund('rf-prefuse', { reason: 'wrong tab' });
  ok('C10 when Stripe refuses, Sarah is told in Stripe\'s words and nothing counts as given back', r.s === 400 && /disputed/.test(r.d && r.d.error || ''), r.d);
  T = await tab();
  const refusedRow = (T.refunds || []).find(x => x.payment_id === 'rf-prefuse');
  const lg2 = ((await j('GET', '/api/admin/log?limit=10')).d || {}).entries || [];
  ok('C11 ...the attempt stays on the tab as NOT given back, and the owner\'s log names it', !!refusedRow && refusedRow.status === 'error' && lg2.some(e => e.event === 'COUNTER_REFUND_FAILED'), { refusedRow, events: lg2.map(e => e.event).slice(0, 5) });
  S = await summary();
  ok('C12 revenue drops by exactly the sale parts given back at the counter ($12 cash + $6 card + $8 check), the tips by the $1', S.refunds_cents === before.refunds + 1200 + 600 + 800 && S.tips_cents === 300 + 200 - 100 - 100, { refunds: S.refunds_cents, tips: S.tips_cents });
  const review = ((await j('GET', '/api/pos/review')).d || {}).refunds || [];
  ok('C13 every counter refund is on the owner\'s daily review with its reason and who', review.filter(x => x.source === 'counter' && x.employee === 'Sarah').length >= 4 && review.some(x => x.reason === 'charged for a burger never served'), review.map(x => [x.method, x.status, x.employee]));
  const cashId = (cashRow && cashRow.id) || 'none';
  r = await j('POST', `/api/pos/review/refund/${cashId}/check`, { reviewer: 'Owner' }, SH);
  ok('C14 staff cannot tick their own refund off the review', r.s === 401 || r.s === 403, r.s);
  r = await j('POST', `/api/pos/review/refund/${cashId}/check`, { reviewer: 'Owner' });
  ok('C15 the owner checks it; the row records who', r.s === 200 && (((await j('GET', '/api/pos/review')).d || {}).refunds || []).some(x => x.id === cashId && x.reviewed === 1 && x.reviewed_by === 'Owner'), r.d);

  console.log('\n── D. the webhook ──');
  const stripeRf = REFUNDS.find(x => cardRow && x.id === cardRow.stripe_refund_id) || refundObj('pi_card2', 1, {});
  const echo = JSON.stringify({ id: 'evt_echo', type: 'refund.created', data: { object: stripeRf } });
  let w = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(echo) }, body: echo });
  T = await tab();
  const rows2 = (T.refunds || []).filter(x => cardRow && x.stripe_refund_id === cardRow.stripe_refund_id);
  ok('D1 our own card refund echoed back by Stripe\'s webhook is not recorded twice and keeps Sarah\'s reason', w.status === 200 && rows2.length === 1 && rows2[0].reason === 'charged twice' && rows2[0].employee === 'Sarah', rows2);
  const fresh = refundObj('pi_book1', 700, { created: Math.floor(Date.now() / 1000) });
  const ev1 = JSON.stringify({ id: 'evt_new', type: 'refund.created', data: { object: fresh } });
  w = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(ev1) }, body: ev1 });
  const withNew = await waitFor(async () => { const s = await summary(); return s.refunds_cents === before.refunds + 2600 + 700 ? s : null; }, 5000);
  ok('D2 a refund made in the dashboard just now arrives by the webhook and comes off revenue at once', w.status === 200 && !!withNew, { st: w.status });
  const failedNow = Object.assign({}, fresh, { status: 'failed', failure_reason: 'expired_or_canceled_card' });
  const ev2 = JSON.stringify({ id: 'evt_fail', type: 'refund.failed', data: { object: failedNow } });
  w = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(ev2) }, body: ev2 });
  const back = await waitFor(async () => { const s = await summary(); return s.refunds_cents === before.refunds + 2600 ? s : null; }, 5000);
  ok('D3 when Stripe then says that refund FAILED, it stops coming off revenue - the money never went back', w.status === 200 && !!back, { st: w.status });
  const forged = JSON.stringify({ id: 'evt_forged', type: 'refund.created', data: { object: refundObj('pi_book1', 1, {}) } });
  w = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=00' }, body: forged });
  ok('D4 an unsigned refund event is refused', w.status === 400, w.status);

  console.log('\n── E. the page ──');
  const pad = fs.readFileSync(path.join(root, 'public', 'staff.html'), 'utf8');
  ok('E1 the pad draws each payment with a Refund button while any of it can go back, and each refund made off it', /function renderPays\(t\)/.test(pad) && /p\.refundable_cents > 0/.test(pad) && /id="tbRefundBack"/.test(pad) && /Reason \(required\)/.test(pad) && /\/payments\/' \+ encodeURIComponent\(rfPay\.id\) \+ '\/refund'/.test(pad));
  const adm = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
  ok('E2 the owner\'s daily review and the Revenue tab carry refunds and the Check Stripe now button', /function checkRefundRow\(id\)/.test(adm) && /id="revRefundsBtn"/.test(adm) && /\/api\/admin\/refunds\/check/.test(adm));
  const T3 = await tab();
  ok('E3 the tab reply carries what the pad needs: each payment\'s refundable amount, the refunds', (T3.payments || []).find(p => p.id === 'rf-pcash').refundable_cents === 100 && (T3.payments || []).find(p => p.id === 'rf-pcredit').refundable_cents === 0 && T3.refunded_cents > 0, (T3.payments || []).map(p => [p.id, p.refundable_cents]));

  await stop();
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  try { stripe.close(); } catch {}
  console.log(`\nREFUNDS: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); try { child && child.kill('SIGKILL'); } catch {} process.exit(1); });
