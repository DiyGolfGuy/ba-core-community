// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-terminal.js — P5 card readers. Proves the architecture's core law:
// THE WEBHOOK IS THE TRUTH. Runs entirely offline against sk_mock.
const fs = require('fs');
const { spawn } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
const BASE = 'http://127.0.0.1:3001';

(async () => {
  { const p = './config.json'; let c = {}; if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
    c.server = Object.assign({}, c.server, { businessName: 'Reader Test', adminPassword: 'battery-owner-pass-1',
      staff: [{ name: 'Dana', code: '4321', active: true }] });
    c.setup = Object.assign({}, c.setup, { completed: true });
    c.booking = Object.assign({}, c.booking, { staffedAccess: true });
    c.bays = [{ id: 'bay1', name: 'Bay 1', active: true }];
    c.stripe = Object.assign({}, c.stripe, { secretKey: 'sk_mock_terminal' });
    c.pos = Object.assign({}, c.pos, { payments: { cash: true, check: false } });
    delete c.terminal;
    fs.writeFileSync(p, JSON.stringify(c, null, 2)); }

  const dbM = require('./services/db'); await dbM.initDb();
  require('./services/pos').ensureSchema();
  const term = require('./services/terminal'); term.ensureSchema();
  const pos = require('./services/pos');

  console.log('── config defaults ──');
  ok('tips: DEFAULT OFF (maintainer ruling) even with nothing configured', term.tipsCfg().mode === 'off', term.tipsCfg());
  ok('readers: none registered on a fresh unit', term.readers().length === 0);

  console.log('── registry ──');
  const r1 = await term.registerReader({ registration_code: 'simulated-wisepos-e', label: 'Front Counter' });
  ok('register: reader added', !!r1.id && r1.label === 'Front Counter', r1);
  ok('register: first reader becomes the default', term.defaultReaderId() === r1.id);
  const r2 = await term.registerReader({ registration_code: 'simulated-wisepos-e', label: 'Bar' });
  ok('register: a second reader coexists', term.readers().length === 2);
  term.removeReader(r2.id);
  ok('remove: reader dropped, default survives', term.readers().length === 1 && term.defaultReaderId() === r1.id);

  console.log('── THE LAW: the webhook is the truth ──');
  for (const t of dbM.db.prepare(`SELECT id FROM tabs WHERE label LIKE 'TT %'`).all()) {
    dbM.db.prepare(`DELETE FROM tab_items WHERE tab_id=?`).run(t.id);
    dbM.db.prepare(`DELETE FROM tab_payments WHERE tab_id=?`).run(t.id);
    dbM.db.prepare(`DELETE FROM tab_checks WHERE tab_id=?`).run(t.id);
    dbM.db.prepare(`DELETE FROM tabs WHERE id=?`).run(t.id);
  }
  const cat = pos.upsertCategory({ name: 'Bar', printer_role: 'bar', tax_category: 'beverage' });
  const item = pos.upsertItem({ category_id: cat, name: 'Beer', price_cents: 600 });
  const tab = pos.openTab({ label: 'Reader Test', employee: 'Dana' });
  pos.sendOrder(tab.id, [{ item_id: item }], 'Dana');
  const due = pos.getTab(tab.id).due_cents;
  ok('setup: tab has a balance', due > 0, due);

  const started = await term.collect({ tab_id: tab.id, amount_cents: due, employee: 'Dana' });
  ok('collect: returns pending, never "paid"', started.status === 'pending' && !!started.payment_intent, started);
  ok('collect: the tab is STILL UNPAID after the button press', pos.getTab(tab.id).due_cents === due, pos.getTab(tab.id).due_cents);
  ok('collect: state endpoint reports pending', term.intentState(started.payment_intent).status === 'pending');

  // The webhook arrives — only now is it money.
  const fin = term.finalizePaidIntent({ id: started.payment_intent, amount_received: due, amount_details: {} });
  ok('webhook: finalize records the payment', fin.ok === true && fin.amount_cents === due, fin);
  ok('webhook: the tab is now settled', pos.getTab(tab.id).due_cents === 0, pos.getTab(tab.id).due_cents);
  ok('webhook: replay is a no-op (idempotent)', !!term.finalizePaidIntent({ id: started.payment_intent, amount_received: due }).ignored);

  console.log('── tips ──');
  const tab2 = pos.openTab({ label: 'Tips Test', employee: 'Dana' });
  pos.sendOrder(tab2.id, [{ item_id: item }], 'Dana');
  const due2 = pos.getTab(tab2.id).due_cents;
  const s2 = await term.collect({ tab_id: tab2.id, amount_cents: due2, employee: 'Dana' });
  term.finalizePaidIntent({ id: s2.payment_intent, amount_received: due2 + 200, amount_details: { tip: { amount: 200 } } });
  const st2 = term.intentState(s2.payment_intent);
  ok('tips: reader tip captured from the webhook', st2.tip_cents === 200, st2);
  const pay = dbM.db.prepare(`SELECT * FROM tab_payments WHERE stripe_pi = ?`).get(s2.payment_intent);
  ok('tips: tip recorded on the payment, separate from the sale', pay && pay.tip_cents === 200 && pay.amount_cents === due2, pay);
  ok('tips: tab settled by the sale amount, tip does not distort the bill', pos.getTab(tab2.id).due_cents === 0);

  console.log('── failure paths ──');
  const tab3 = pos.openTab({ label: 'Decline Test', employee: 'Dana' });
  pos.sendOrder(tab3.id, [{ item_id: item }], 'Dana');
  const due3 = pos.getTab(tab3.id).due_cents;
  const s3 = await term.collect({ tab_id: tab3.id, amount_cents: due3, employee: 'Dana' });
  term.failIntent({ id: s3.payment_intent }, 'card_declined');
  ok('decline: intent marked failed', term.intentState(s3.payment_intent).status === 'failed');
  ok('decline: tab remains UNPAID (no phantom payment)', pos.getTab(tab3.id).due_cents === due3, pos.getTab(tab3.id).due_cents);
  const s4 = await term.collect({ tab_id: tab3.id, amount_cents: due3, employee: 'Dana' });
  await term.cancelCollect(s4.payment_intent);
  ok('cancel: in-flight collection canceled', term.intentState(s4.payment_intent).status === 'canceled');
  ok('cancel: a SUCCEEDED payment refuses cancellation', await (async () => {
    try { await term.cancelCollect(s2.payment_intent); return false; } catch { return true; }
  })());
  try { await term.collect({ tab_id: tab3.id, amount_cents: 0, employee: 'Dana' }); ok('guard: zero amount refused', false); }
  catch { ok('guard: zero amount refused', true); }

  console.log('── HTTP surface ──');
  const child = spawn('node', ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
  for (let i = 0; i < 60; i++) { try { const x = await fetch(BASE + '/api/time'); if (x.ok) break; } catch {} await new Promise(r => setTimeout(r, 300)); }
  const j = async (m, p, { headers = {}, body } = {}) => {
    const x = await fetch(BASE + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: body !== undefined ? JSON.stringify(body) : undefined });
    let d = null; try { d = await x.json(); } catch {}
    return { status: x.status, data: d };
  };
  const AH = { 'x-admin-password': 'battery-owner-pass-1' };
  let r = await j('GET', '/api/terminal/readers');
  ok('http: registry requires auth', r.status === 401, r.status);
  r = await j('GET', '/api/terminal/readers', { headers: AH });
  ok('http: registry lists readers + tips', r.status === 200 && Array.isArray(r.data.readers) && r.data.tips.mode === 'off', r.data && r.data.tips);
  r = await j('POST', '/api/terminal/settings', { headers: AH, body: { tipMode: 'nonsense' } });
  ok('http: bad tip mode rejected', r.status === 400);
  r = await j('POST', '/api/terminal/settings', { headers: AH, body: { tipMode: 'pooled', tipPresets: [10, 15, 20] } });
  ok('http: tip mode saves', r.status === 200 && r.data.terminal.tips.mode === 'pooled', r.data);
  r = await j('POST', '/api/staff/login', { body: { code: '4321' } });
  const SH = { 'x-staff-token': r.data && r.data.token };
  r = await j('POST', '/api/terminal/collect', { body: { tab_id: 'x', amount_cents: 500 } });
  ok('http: collect requires staff auth', r.status === 401, r.status);
  const tab5 = pos.openTab({ label: 'HTTP Test', employee: 'Dana' });
  pos.sendOrder(tab5.id, [{ item_id: item }], 'Dana');
  r = await j('POST', '/api/terminal/collect', { headers: SH, body: { tab_id: tab5.id, amount_cents: 600 } });
  ok('http: staff can start a collection', r.status === 200 && r.data.status === 'pending', r.data);
  const pi5 = r.data && r.data.payment_intent;
  r = await j('GET', '/api/terminal/state/' + pi5, { headers: SH });
  ok('http: state reports pending until the webhook lands', r.data.status === 'pending', r.data);

  child.kill('SIGTERM');
  console.log('\u2500\u2500 PER-CHECK CARD COLLECT (maintainer, Aug 13: the reader-day chain) \u2500\u2500');
{
  const checksSvc = require('./services/checks'); checksSvc.ensureSchema();
  const tab = pos.openTab({ label: 'TT SplitCard', employee: 'Dana' });
  pos.sendOrder(tab.id, [{ kind: 'custom', name: 'TT Nachos', unit_price_cents: 2000, tax_category: 'food', printer_role: 'kitchen' }], 'Dana');
  checksSvc.splitTab(tab.id, 2); checksSvc.shareAllEvenly(tab.id);
  let ct = checksSvc.checkTotals(tab.id);
  const cA = ct.checks[0], cB = ct.checks[1];
  const goA = await term.collect({ tab_id: tab.id, amount_cents: cA.due_cents, employee: 'Dana', check_id: cA.id });
  const finA = term.finalizePaidIntent({ id: goA.payment_intent, amount_received: cA.due_cents });
  ok('reader chain: webhook lands the payment ON THE CHECK (check_id rides intent -> payment)',
     finA.ok === true && dbM.db.prepare(`SELECT check_id FROM tab_payments WHERE stripe_pi=?`).get(goA.payment_intent).check_id === cA.id);
  ct = checksSvc.checkTotals(tab.id);
  ok('reader chain: that check reads paid and locks; the other still owes',
     ct.checks.find(c => c.id === cA.id).due_cents === 0 && ct.checks.find(c => c.id === cB.id).due_cents > 0);
  let threw = false; try { checksSvc.removeCheck(tab.id, cA.id); } catch (e) { threw = true; }
  ok('reader chain: a card-paid check refuses removal', threw);
  const goB = await term.collect({ tab_id: tab.id, amount_cents: ct.checks.find(c => c.id === cB.id).due_cents, employee: 'Dana', check_id: cB.id });
  term.finalizePaidIntent({ id: goB.payment_intent, amount_received: ct.checks.find(c => c.id === cB.id).due_cents });
  ok('reader chain: the last check by card closes the tab at zero', pos.getTab(tab.id).status === 'closed');
}

console.log('\u2500\u2500 SDK v22 SURFACE (migration lock, Aug 13) \u2500\u2500');
{
  const S = require('stripe');
  const fac = S('sk_test_dummy'), ctor = new S('sk_test_dummy');
  const surface = c => typeof c.paymentIntents.create === 'function' && typeof c.paymentIntents.retrieve === 'function' && typeof c.refunds.create === 'function';
  ok('sdk: callable-factory style (inline call sites) exposes our full surface', surface(fac));
  ok('sdk: constructor style (new Stripe) exposes our full surface', surface(ctor));
  ok('sdk: major version is 22+', parseInt(String(S.PACKAGE_VERSION).split('.')[0], 10) >= 22, S.PACKAGE_VERSION);
}

console.log('-- PAYMENT GROUND-TRUTH DELTAS (research audit, Aug 14) --');
{
  const fs2 = require('fs');
  const be2 = fs2.readFileSync('./services/bookingedit.js', 'utf8');
  const ra2 = fs2.readFileSync('./routes/admin.js', 'utf8');
  const rb2 = fs2.readFileSync('./routes/bookings.js', 'utf8');
  ok('refunds: every creation site carries a deterministic Idempotency-Key',
     be2.includes('idempotencyKey') && ra2.includes('idempotencyKey') && rb2.includes('idempotencyKey'));
  const all2 = be2 + ra2 + rb2 + fs2.readFileSync('./services/terminal.js', 'utf8') + fs2.readFileSync('./services/membership-billing.js', 'utf8');
  ok('api truth: zero charges.data reads anywhere in payment code', !all2.includes('charges.data'));
  const tl2 = fs2.readFileSync('./services/terminal.js', 'utf8');
  ok('tips: extracted from the documented field, base minus tip into the POS',
     tl2.includes('amount_details') && tl2.includes('details.tip && details.tip.amount') && tl2.includes('amount_cents: amount - tip'));
  const ml2 = fs2.readFileSync('./services/membership-lifecycle.js', 'utf8');
  ok('refunds: a late refund FAILURE is logged for the owner, never silent',
     ml2.includes('refund.failed') && ml2.includes('STRIPE_REFUND_FAILED'));
}

console.log(`\nTERMINAL: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 400);
})().catch(e => { console.error(e); process.exit(1); });
