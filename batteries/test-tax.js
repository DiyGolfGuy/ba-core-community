// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-tax.js — Wave C: first-class tax codes.
// Proves: legacy derivation shows exact current rates; setTaxCodes compiles the
// map computeTotals/eodSummary read (math paths untouched); custom codes tax
// per-code including 0% clothing and the mock-5 merch rounding ($12 @ 7.375%
// = $0.89 via Math.round half-up); validation guards incl. the required 'sim'.
'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const dbM = require('./services/db');
  await dbM.initDb();
  const cs = require('./services/config');
  const pos = require('./services/pos');
  pos.ensureSchema();

  // clean slate for this battery's tabs
  for (const t of ['tab_items', 'tab_payments', 'tabs']) {
    try { dbM.db.prepare(`DELETE FROM ${t} WHERE 1=1 AND EXISTS (SELECT 1)`).run(); } catch {}
  }
  dbM.db.prepare(`DELETE FROM tab_items`).run();
  dbM.db.prepare(`DELETE FROM tab_payments`).run();
  dbM.db.prepare(`DELETE FROM tabs`).run();

  // ── derivation: legacy categories -> codes with friendly names ───────────
  const cfg = cs.getConfig();
  cfg.pos = cfg.pos || {};
  cfg.pos.tax = { categories: { sim: 7.375, food: 7.375, beverage: 9.875 }, stripeTax: false, codes: [] };
  cs.saveConfig(cfg);
  let codes = pos.getTaxCodes();
  ok('derives from legacy map: exact rates + friendly trio names + every key represented',
     codes.find(c => c.id === 'beverage' && c.rate === 9.875) &&
     codes.find(c => c.id === 'sim' && c.name === 'Simulator time' && c.rate === 7.375) &&
     Object.keys(pos.posCfg(cs.getConfig()).tax.categories).every(k => codes.some(c => c.id === k)),
     codes);

  // ── validation guards ────────────────────────────────────────────────────
  let threw = '';
  try { pos.setTaxCodes([{ id: 'food', name: 'Food', rate: 5 }]); } catch (e) { threw = e.message; }
  ok('missing sim rejected (golf line law)', /sim/.test(threw), threw);
  threw = '';
  try { pos.setTaxCodes([{ id: 'sim', name: 'S', rate: 5 }, { id: 'sim', name: 'S2', rate: 6 }]); } catch (e) { threw = e.message; }
  ok('duplicate ids rejected', /unique/i.test(threw));
  threw = '';
  try { pos.setTaxCodes([{ id: 'sim', name: 'S', rate: 200 }]); } catch (e) { threw = e.message; }
  ok('rate bounds enforced', /0-100/.test(threw));
  threw = '';
  try { pos.setTaxCodes([{ id: 'BAD ID', name: 'x', rate: 1 }, { id: 'sim', name: 'S', rate: 1 }]); } catch (e) { threw = e.message; }
  ok('id charset enforced', /1-24/.test(threw));

  // ── codes as source of truth ─────────────────────────────────────────────
  pos.setTaxCodes([
    { id: 'sim',   name: 'Simulator time', rate: 7.375, stripe_code: 'txcd_sim' },
    { id: 'food',  name: 'Prepared food',  rate: 7.375 },
    { id: 'beverage', name: 'Beverage',    rate: 9.875 },
    { id: 'cloth', name: 'Clothing',       rate: 0 },
    { id: 'merch', name: 'General merch',  rate: 7.375 }
  ]);
  const compiled = pos.posCfg(cs.getConfig()).tax.categories;
  ok('compiled map carries all five codes', compiled.cloth === 0 && compiled.merch === 7.375 && compiled.beverage === 9.875, compiled);
  ok('readback keeps stripe mapping', pos.getTaxCodes().find(c => c.id === 'sim').stripe_code === 'txcd_sim');

  // ── per-code math on a live tab (mock-5 numbers) ─────────────────────────
  const tab = pos.openTab({ label: 'Tax Test', employee: 'Dana' });
  pos.addGolfLine(tab.id, 1400, 'Golf - share');   // sim 7.375% -> 103
  pos.sendOrder(tab.id, [
    { kind: 'custom', name: 'Club Polo', unit_price_cents: 4500, tax_category: 'cloth', printer_role: 'kitchen' },
    { kind: 'custom', name: 'Divot Tool', unit_price_cents: 1200, tax_category: 'merch', printer_role: 'kitchen' }
  ], 'Dana');
  const t = pos.getTab(tab.id);
  ok('clothing taxed at 0', (t.tax_by_category.cloth | 0) === 0, t.tax_by_category);
  ok('merch $12 @ 7.375% = $0.89 (half-up, mock-5 parity)', t.tax_by_category.merch === 89, t.tax_by_category.merch);
  ok('golf under sim: $14 -> $1.03', t.tax_by_category.sim === 103, t.tax_by_category.sim);
  ok('tab total = 7100 + 192 tax', t.total_cents === 7292, t.total_cents);

  // ── EOD files per code ───────────────────────────────────────────────────
  // the counter's day is the FACILITY's (Oct 2 2026): a UTC date is tomorrow every evening
  const today = require('./services/revenue').facilityToday();
  const eod = pos.eodSummary(today);
  ok('eod sales keyed per code (cloth + merch + sim present)',
     eod.sales_by_category && eod.sales_by_category.cloth === 4500 && eod.sales_by_category.merch === 1200 && eod.sales_by_category.sim === 1400,
     eod.sales_by_category);
  ok('eod tax per code matches the tab', eod.tax_by_category.merch === 89 && (eod.tax_by_category.cloth | 0) === 0, eod.tax_by_category);

  console.log('\u2500\u2500 STRIPE TAX (the switch, maintainer Aug 14: bookings v1) \u2500\u2500');
{
  const cs3 = require('./services/config');
  const stx = require('./services/stripetax');
  // stage: mock key, rates, venue, toggle ON
  cs3.saveConfig({ stripe: { secretKey: 'sk_mock_tax' },
    pos: { tax: { stripeTax: true, categories: { sim: 7.375, food: 8, beverage: 9 },
                  venueAddress: { line1: '1 Fairway', city: 'Maplewood', state: 'MN', postal_code: '55109' } } } });
  delete require.cache[require.resolve('./services/stripetax')];
  const st = require('./services/stripetax');
  const lines = [{ amount_cents: 3500, reference: 'sim', category: 'sim' },
                 { amount_cents: 1200, reference: 'food', category: 'food' }];
  const manual = st.manualTax(lines);
  const calc = await st.calculate(lines, 'bat-1');
  ok('stripe tax: mock engine matches the manual engine to the penny (wiring provable, bills undriftable)',
     calc.engine === 'stripe' && calc.tax_cents === manual.tax_cents && calc.total_cents === manual.total_cents,
     { stripe: calc.tax_cents, manual: manual.tax_cents });
  const rec = await st.recordSale(calc.calc_id, 'bat-1');
  const rq = st._test_lastRequest();
  ok('stripe tax: cash-path recording hits create_from_calculation with an idempotency key',
     rq.path === '/tax/transactions/create_from_calculation' && rq.idempotencyKey === 'taxrec-bat-1');
  await st.reverseSale(rec.id, 'bat-1-r1', 700);
  const rq2 = st._test_lastRequest();
  ok('stripe tax: partial reversal is mode=partial with a NEGATIVE flat amount',
     rq2.params.mode === 'partial' && rq2.params.flat_amount === -700);
  await st.reverseSale(rec.id, 'bat-1-r2');
  ok('stripe tax: full reversal is mode=full', st._test_lastRequest().params.mode === 'full');
  ok('stripe tax: the PI link fragment and version override are exactly the documented shapes',
     JSON.stringify(st.piLinkParams('taxcalc_x')) === JSON.stringify({ 'hooks[inputs][tax][calculation]': 'taxcalc_x' })
     && st.piVersionOverride() === '2025-11-17.clover');
  const rd = await st.readiness();
  ok('stripe tax: readiness reports settings, states, and venue coverage',
     rd.configured === true && rd.settings_active === true && rd.venue_covered === true, rd);
  // the $0 foot-gun: zero rates make the mock answer not_collecting -> manual fallback
  cs3.saveConfig({ pos: { tax: { categories: { sim: 0, food: 0, beverage: 0 } } } });
  const zero = await st.calculate(lines, 'bat-zero');
  ok('stripe tax: a not-registered $0 answer FALLS BACK to manual and flags it - tax never silently stops',
     zero.engine === 'manual-fallback' && zero.not_collecting === true);
  // toggle OFF: byte-identical manual behavior
  cs3.saveConfig({ pos: { tax: { stripeTax: false, categories: { sim: 7.375, food: 8, beverage: 9 } } } });
  const off = await st.calculate(lines, 'bat-off');
  ok('stripe tax: switch OFF means the manual engine, untouched',
     off.engine === 'manual' && off.tax_cents === st.manualTax(lines).tax_cents);
  // maintainer, Aug 14: the status button reported ACTIVE on a unit with NO Stripe key.
  cs3.saveConfig({ stripe: { secretKey: '' }, pos: { tax: { stripeTax: true } } });
  const rdNo = await st.readiness();
  ok('stripe tax: a unit with NO Stripe key reports NOT configured, never ACTIVE',
     rdNo.configured === false && /No Stripe key/.test(rdNo.reason || ''), rdNo);
  const noKeyCalc = await st.calculate(lines, 'bat-nokey');
  ok('stripe tax: switched on with no key still bills correctly on manual rates',
     noKeyCalc.engine === 'manual-fallback' && noKeyCalc.tax_cents === st.manualTax(lines).tax_cents);
  cs3.saveConfig({ stripe: { secretKey: 'sk_mock_tax' } });
  const fs4 = require('fs');
  const rb = fs4.readFileSync('./routes/bookings.js', 'utf8');
  ok('stripe tax: bookings quote and PaymentIntent are wired (calc drives totals, hooks link, version override)',
     rb.includes("stx.calculate([{ amount_cents: priceCents") && rb.includes('hooks = { inputs: { tax: { calculation: taxCalcId } } }') && rb.includes('piVersionOverride()'));
  const ad2 = fs4.readFileSync('./public/admin.html', 'utf8');
  const ra2 = fs4.readFileSync('./routes/admin.js', 'utf8');
  ok('stripe tax: the owner card exists with codes, venue address, and a live status check',
     ad2.includes('cfg_stx_enabled') && ad2.includes('stxCheckStatus') && ra2.includes('stripetax/status'));

  console.log('\u2500\u2500 STRIPE TAX: a counter sale recorded, a RESTART, then a refund (Oct 3 2026) \u2500\u2500');
  // The sale's Stripe Tax record lived only in memory and nothing called the reversal: every counter refund at a
  // Stripe Tax facility left the tax standing in Stripe's filing. Mock Stripe (sk_mock), stripeTax ON.
  {
    cs3.saveConfig({ stripe: { secretKey: 'sk_mock_tax' }, pos: { tax: { stripeTax: true, categories: { sim: 7.375, food: 8, beverage: 9, merch: 7.375 },
      venueAddress: { line1: '1 Fairway', city: 'Maplewood', state: 'MN', postal_code: '55109' } }, payments: { cash: true, check: true } } });
    const posA = require('./services/pos');
    const tabS = posA.openTab({ label: 'Stripe Tax Refund', employee: 'Dana' });
    posA.sendOrder(tabS.id, [{ kind: 'custom', name: 'Divot Tool', unit_price_cents: 2000, tax_category: 'merch', printer_role: 'kitchen' }], 'Dana');
    await posA.refreshTabTax(tabS.id);
    const dueS = posA.getTab(tabS.id).due_cents;
    const payS = posA.recordPayment(tabS.id, { method: 'cash', amount_cents: dueS, tendered_cents: dueS, employee: 'Dana' });
    posA.stxRecordSale(tabS.id, 'tab-' + tabS.id + '-sale');
    let txn = ''; for (let i = 0; i < 40 && !txn; i++) { await new Promise(r => setTimeout(r, 50)); try { txn = (require('./services/db').db.prepare('SELECT stx_txn_id FROM tabs WHERE id=?').get(tabS.id) || {}).stx_txn_id || ''; } catch {} }
    ok('stripe tax: the counter sale is recorded with Stripe Tax and its transaction is KEPT on the tab (it lived only in memory)', /^taxtxn_mock_/.test(txn), txn);
    // the unit restarts: a fresh copy of the counter's code, its memory empty
    delete require.cache[require.resolve('./services/pos')];
    const pay = (posA.getTab(tabS.id).payments || [])[0] || {};
    await require('./services/refunds').counterRefund({ tabId: tabS.id, paymentId: pay.id, amountCents: 700, reason: 'one item back', employee: 'Dana' });
    let rq = null; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 50)); rq = st._test_lastRequest(); if (rq && /create_reversal/.test(rq.path || '')) break; }
    ok('stripe tax: after a restart, the counter refund REVERSES the tax in Stripe - partial, a negative $7.00, against the transaction kept on the tab (nothing ever called the reversal)',
       !!rq && /create_reversal/.test(rq.path || '') && rq.params.mode === 'partial' && rq.params.flat_amount === -700 && rq.params.original_transaction === txn, rq);
    // ONCE, WHEN THE TAB CLOSES (the review): a tab paid in parts recorded its whole calculation once per part, and again
    // after a restart. The mock's transaction id carries the caller's reference, so a second recording shows on the tab.
    { const posB = require('./services/pos'), dbx = require('./services/db').db;
      const txnOf = id => (dbx.prepare('SELECT stx_txn_id FROM tabs WHERE id=?').get(id) || {}).stx_txn_id || '';
      const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 25)); };
      const tabP = posB.openTab({ label: 'Split Tax', employee: 'Dana' });
      posB.sendOrder(tabP.id, [{ kind: 'custom', name: 'Glove', unit_price_cents: 3000, tax_category: 'merch', printer_role: 'kitchen' }], 'Dana');
      await posB.refreshTabTax(tabP.id);
      const dueP = posB.getTab(tabP.id).due_cents, half = Math.floor(dueP / 2);
      posB.recordPayment(tabP.id, { method: 'cash', amount_cents: half, tendered_cents: half, employee: 'Dana' });
      posB.stxRecordSale(tabP.id, 'part-a'); await settle();
      const afterA = txnOf(tabP.id);
      posB.recordPayment(tabP.id, { method: 'check', amount_cents: dueP - half, employee: 'Dana' });
      posB.stxRecordSale(tabP.id, 'part-b'); await settle();
      const afterB = txnOf(tabP.id);
      posB.stxRecordSale(tabP.id, 'part-c'); await settle();
      delete require.cache[require.resolve('./services/pos')];
      require('./services/pos').stxRecordSale(tabP.id, 'part-d'); await settle();
      ok('stripe tax: a tab paid in two parts is recorded ONCE, when it closes - nothing while it still owes, nothing more on a second call or after a restart (it was recorded once per part, and again after a restart)',
         afterA === '' && afterB === 'taxtxn_mock_part-b' && txnOf(tabP.id) === 'taxtxn_mock_part-b', { afterA, afterB, now: txnOf(tabP.id) }); }
    cs3.saveConfig({ pos: { tax: { stripeTax: false } } });
  }
}

console.log(`\nTAX SEGMENT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
