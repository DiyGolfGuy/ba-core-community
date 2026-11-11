// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// Full POS lifecycle proof: menu → tab → send (routing+tickets) → 86 →
// void w/ ticket → comp → review → cash pay (change+drawer) → close → EOD.
'use strict';
const dbM = require('./services/db');
const cs = require('./services/config');

(async () => {
  await dbM.initDb();
  const pos = require('./services/pos');
  pos.ensureSchema();

  // Deterministic reruns: this battery asserts EXACT counts for "today", so it
  // must own its slate. Wipe the transactional POS tables at start (menu CRUD
  // upserts on stable ids; eod_reports upserts on date, so it may stay).
  for (const t of ['tab_items', 'tab_payments', 'tabs', 'drawer_events', 'print_jobs']) {
    try { dbM.db.prepare(`DELETE FROM ${t}`).run(); } catch {}
  }

  // stage config: taxes, cash+drawer on, float $150
  const cfg = cs.getConfig();
  cfg.pos = {
    checkinMode: 'full',
    payments: { cash: true, check: true },
    tips: { enabled: true, mode: 'server' },
    tax: { categories: { sim: 7.375, food: 7.375, beverage: 9.875 }, stripeTax: false, codes: [] },
    drawer: { enabled: true }, openingFloatCents: 15000
  };
  cs.saveConfig(cfg);
  // counter printer must exist for drawer jobs
  if (!(cfg.printers || []).some(p => p.role === 'counter')) {
    cfg.printers = cfg.printers || [];
    cfg.printers.push({ id: 'prn-counter', name: 'Front Counter', role: 'counter', token: 'tok-counter' });
    cs.saveConfig(cfg);
  }
  if (!(cfg.printers || []).some(p => p.role === 'bar')) {
    cfg.printers.push({ id: 'prn-bar', name: 'Bar', role: 'bar', token: 'tok-bar' });
    cs.saveConfig(cfg);
  }
  // kitchen printer must exist or kitchen tickets have nowhere to enqueue
  if (!(cfg.printers || []).some(p => p.role === 'kitchen')) {
    cfg.printers.push({ id: 'prn-kitchen', name: 'Kitchen', role: 'kitchen', token: 'tok-kitchen' });
    cs.saveConfig(cfg);
  }
  cfg.setup = Object.assign({}, cfg.setup, { completed: true });
  cs.saveConfig(cfg);
  const A = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('  ok:', msg); };

  console.log('── menu ──');
  const catB = pos.upsertCategory({ name: 'Burgers', printer_role: 'kitchen', tax_category: 'food' });
  const catBeer = pos.upsertCategory({ name: 'Beer', printer_role: 'bar', tax_category: 'beverage' });
  const itBbq = pos.upsertItem({
    category_id: catB, name: 'Bacon BBQ Burger', price_cents: 1450,
    choiceGroups: [{ name: 'Side', choices: [
      { name: 'Fries', delta_cents: 0, is_default: true },
      { name: 'Onion Rings', delta_cents: 200 }] }]
  });
  const itIpa = pos.upsertItem({ category_id: catBeer, name: 'Craft IPA', price_cents: 650 });
  const menu = pos.getMenu();
  A(menu.some(c => c.name === 'Burgers' && c.items.some(i => i.choiceGroups.length === 1)), 'menu with choice groups');

  console.log('── tab + send order ──');
  const tab = pos.openTab({ label: 'Marcus Vale', bay_id: 'bay-2', bay_name: 'Bay 2', employee: 'Dana' });
  const sent = pos.sendOrder(tab.id, [
    { item_id: itBbq, choices: [{ name: 'Onion Rings', delta_cents: 200 }], note: 'no onions' },
    { item_id: itIpa }
  ], 'Dana');
  A(sent.order_no > 0, 'order number assigned');
  const roles = sent.tickets.map(t => t.role).sort();
  A(roles.join(',') === 'bar,kitchen', 'routed to kitchen AND bar: ' + roles.join(','));
  const kJob = dbM.db.prepare(`SELECT body FROM print_jobs WHERE printer_id IN
      (SELECT 'prn-counter' WHERE 0) OR body LIKE '%KITCHEN TICKET%' ORDER BY id DESC LIMIT 1`).get();
  A(kJob && kJob.body.includes('BAY 2') && kJob.body.includes('Marcus Vale')
      && kJob.body.includes('Onion Rings') && kJob.body.includes('NO ONIONS'),
    'kitchen ticket carries BAY + person + side + note');
  // money: burger 14.50+2.00=16.50 (food 7.375%) + ipa 6.50 (bev 9.875%)
  A(sent.tab.subtotal_cents === 2300, 'subtotal 23.00');
  const expectedTax = Math.round(1650 * 7.375 / 100) + Math.round(650 * 9.875 / 100);
  A(sent.tab.tax_cents === expectedTax, `tax by category = ${expectedTax}c (food+bev split)`);

  console.log('── 86 ──');
  pos.setEightySix(itBbq, true);
  let threw = null;
  try { pos.sendOrder(tab.id, [{ item_id: itBbq }], 'Dana'); } catch (e) { threw = e.message; }
  A(threw && threw.includes("86"), '86d item refuses to send: ' + threw);
  pos.setEightySix(itBbq, false);

  console.log('── void + comp + review ──');
  const ipaRow = sent.items.find(i => i.name === 'Craft IPA');
  let noReason = null;
  try { pos.voidItem(ipaRow.id, { comp: false, reason: '', employee: 'Dana' }); } catch (e) { noReason = e.message; }
  A(noReason && noReason.includes('reason'), 'void without memo rejected');
  pos.voidItem(ipaRow.id, { comp: false, reason: 'never made', employee: 'Dana' });
  const voidTicket = dbM.db.prepare(`SELECT body FROM print_jobs WHERE body LIKE '%*** VOID ***%' ORDER BY id DESC LIMIT 1`).get();
  A(voidTicket && voidTicket.body.includes('Craft IPA'), 'VOID ticket fired to bar');
  const burgRow = sent.items.find(i => i.name === 'Bacon BBQ Burger');
  pos.voidItem(burgRow.id, { comp: true, reason: 'made it right - comped', employee: 'Dana' });
  const t2 = pos.getTab(tab.id);
  A(t2.subtotal_cents === 0 && t2.due_cents === 0, 'comp keeps item at $0; void removes — due now 0');
  const review = pos.reviewList();
  A(review.length === 2 && review.every(r => !r.reviewed), 'daily review shows both, unreviewed');
  pos.checkReview(review[0].id, 'Owner');
  A(pos.reviewList().filter(r => r.reviewed).length === 1, 'owner checked one off');

  console.log('── fresh tab: cash payment + drawer + close ──');
  const tab2 = pos.openTab({ label: 'Table 4 — Beth', table_label: '4', employee: 'Dana' });
  const s2 = pos.sendOrder(tab2.id, [{ item_id: itIpa, qty: 2 }], 'Dana');
  const due = s2.tab.due_cents;
  const pay = pos.recordPayment(tab2.id, { method: 'cash', amount_cents: due, tip_cents: 200, tendered_cents: 2000, employee: 'Dana' });
  // the tip stays (the review, Oct 3 2026): this check used to assert change = tendered - bill, the bug itself - the pad
  // asks the customer to cover bill + tip and End of Day expects bill + tip in the drawer, so the change is what is left
  A(pay.change_cents === 2000 - due - 200, `change math: tendered 20.00, tip 2.00 → change ${(pay.change_cents/100).toFixed(2)} (the tip is kept, not handed back)`);
  { const drawerIn = 2000 - pay.change_cents, row = dbM.db.prepare('SELECT amount_cents, tip_cents FROM tab_payments WHERE id=?').get(pay.payment_id);
    A(drawerIn === row.amount_cents + row.tip_cents, 'what stays in the drawer (tendered - change) is what End of Day expects for it (amount + tip)'); }
  let shortErr = ''; { const tS = pos.openTab({ label: 'Short', employee: 'Dana' }); pos.sendOrder(tS.id, [{ item_id: itIpa, qty: 1 }], 'Dana'); const dS = pos.getTab(tS.id).due_cents;
    try { pos.recordPayment(tS.id, { method: 'cash', amount_cents: dS, tip_cents: 300, tendered_cents: dS + 100, employee: 'Dana' }); } catch (e) { shortErr = e.message; }
    A(/less than the amount and the tip/.test(shortErr) && pos.getTab(tS.id).payments.length === 0, 'cash that covers the bill but not the tip is refused - nothing recorded');
    dbM.db.prepare('DELETE FROM tab_items WHERE tab_id=?').run(tS.id); dbM.db.prepare('DELETE FROM tabs WHERE id=?').run(tS.id); }
  A(pay.drawer && pay.drawer.event_id, 'drawer event logged on cash sale');
  const dJob = dbM.db.prepare('SELECT * FROM print_jobs WHERE drawer=1 ORDER BY id DESC LIMIT 1').get();
  A(dJob, 'drawer-flagged print job queued to counter (X-Star-CashDrawer path)');
  A(pay.closed === true && pay.tab.status === 'closed', 'tab auto-closed at zero due');

  // NEVER WRAPPED (Oct 3 2026; pilot facility's handoff section 2): `| 0` recorded 4294967396 cents as 100 - a mistyped amount as $1.00
  const tabW = pos.openTab({ label: 'Wrap check', employee: 'Dana' });
  pos.sendOrder(tabW.id, [{ item_id: itIpa, qty: 1 }], 'Dana');
  let wrapErr = ''; try { pos.recordPayment(tabW.id, { method: 'cash', amount_cents: 4294967396, tendered_cents: 4294967396, employee: 'Dana' }); } catch (e) { wrapErr = e.message; }
  A(/positive number of cents/.test(wrapErr) && pos.getTab(tabW.id).payments.length === 0, 'an amount past 2^31 cents is REFUSED - never wrapped into a tiny one');
  let junkErr = ''; try { pos.recordPayment(tabW.id, { method: 'cash', amount_cents: '12abc', tendered_cents: 2000, employee: 'Dana' }); } catch (e) { junkErr = e.message; }
  A(/positive number of cents/.test(junkErr) && pos.getTab(tabW.id).payments.length === 0, 'an amount that is not a number of cents is refused');
  dbM.db.prepare('DELETE FROM tab_items WHERE tab_id=?').run(tabW.id); dbM.db.prepare('DELETE FROM tabs WHERE id=?').run(tabW.id);   // leave the day's numbers as they were

  console.log('── EOD ──');
  const eod = pos.eodSummary();
  A(eod.payments.some(p => p.method === 'cash'), 'EOD payment breakdown has cash');
  A(eod.tips.by_employee.some(r => r.employee === 'Dana' && r.t === 200), 'tips attributed to Dana');
  A(eod.comps_voids.count === 2 && eod.comps_voids.unreviewed === 1, 'EOD carries comps/voids + review state');
  A(eod.expected_cash_cents === 15000 + due + 200, 'expected till = float + cash sale + cash tip');
  const close = pos.closeDay({ counted_cents: eod.expected_cash_cents - 500, counted_by: 'Dana' });
  A(close.over_short_cents === -500, 'over/short computed: $5.00 short, stamped');

  console.log('\u2500\u2500 choice removal (owner builder) \u2500\u2500');
  const delItem = pos.upsertItem({ category_id: catB, name: 'Del Test', price_cents: 100,
    choiceGroups: [{ name: 'Size', choices: [{ name: 'Small' }, { name: 'Large', delta_cents: 100 }] }] });
  let menu2 = pos.getMenu(true);
  let it2 = null; for (const c of menu2) { const f = c.items.find(x => x.id === delItem); if (f) it2 = f; }
  A(it2 && it2.choiceGroups.length === 1 && it2.choiceGroups[0].choices.length === 2, 'nested group + choices created');
  pos.deleteChoice(it2.choiceGroups[0].choices[0].id);
  pos.deleteChoiceGroup(it2.choiceGroups[0].id);
  menu2 = pos.getMenu(true);
  it2 = null; for (const c of menu2) { const f = c.items.find(x => x.id === delItem); if (f) it2 = f; }
  A(it2 && it2.choiceGroups.length === 0, 'choice + group removed; item intact');

console.log('\u2500\u2500 COUNTER + STRIPE TAX (maintainer, Aug 14: the switch covers the bar too) \u2500\u2500');
{
  const cfgS = require('./services/config');
  cfgS.saveConfig({ stripe: { secretKey: 'sk_mock_tax' },
    pos: { tax: { stripeTax: true, categories: { sim: 10, food: 10, beverage: 10 },
                  venueAddress: { line1: '1 Fairway', city: 'Maplewood', state: 'MN', postal_code: '55109' } } } });
  const stab = pos.openTab({ label: 'Stripe Bar', employee: 'Dana' });
  pos.sendOrder(stab.id, [{ item_id: itBbq }], 'Dana');
  const manualFirst = pos.computeTotals(pos.getTab(stab.id));
  await pos.refreshTabTax(stab.id);
  const stripeTotals = pos.computeTotals(pos.getTab(stab.id));
  A(stripeTotals.tax_cents > 0 && stripeTotals.total_cents === stripeTotals.subtotal_cents + stripeTotals.tax_cents, 'counter tax: a tab is taxed by Stripe once the answer lands');
  // the safety that matters: a changed tab must never wear the old answer
  pos.sendOrder(stab.id, [{ item_id: itIpa }], 'Dana');
  const afterAdd = pos.computeTotals(pos.getTab(stab.id));
  A(afterAdd.tax_cents !== stripeTotals.tax_cents && afterAdd.total_cents === afterAdd.subtotal_cents + afterAdd.tax_cents, 'counter tax: adding an item REFUSES the stale Stripe number and re-bills honestly');
  await pos.refreshTabTax(stab.id);
  const afterRecalc = pos.computeTotals(pos.getTab(stab.id));
  A(afterRecalc.tax_cents >= afterAdd.tax_cents - 1 && afterRecalc.subtotal_cents > stripeTotals.subtotal_cents, 'counter tax: the fresh answer covers the new line set');
  // switch OFF: the counter returns to manual rates, unchanged
  cfgS.saveConfig({ pos: { tax: { stripeTax: false } } });
  const offTotals = pos.computeTotals(pos.getTab(stab.id));
  A(offTotals.tax_cents === Math.round(offTotals.subtotal_cents * 0.10), 'counter tax: switch OFF and the counter bills on your own rates again');
  const fsP = require('fs');
  const rp = fsP.readFileSync('./routes/pos.js', 'utf8');
  const tl = fsP.readFileSync('./services/terminal.js', 'utf8');
  // The Z report lines your accountant asks for must survive the switch.
  cfgS.saveConfig({ pos: { tax: { stripeTax: true } } });
  await pos.refreshTabTax(stab.id);
  const zt = pos.computeTotals(pos.getTab(stab.id));
  const zcats = Object.keys(zt.tax_by_category || {});
  A(zcats.length > 0 && !zcats.includes('stripe'),
    'counter tax: Stripe tax still breaks out BY CATEGORY - no lump sum on the Z report');
  A(Object.values(zt.tax_by_category).reduce((x, y) => x + y, 0) === zt.tax_cents,
    'counter tax: the category lines add to the Stripe total exactly, to the penny');
  A(require('fs').readFileSync('./services/pos.js', 'utf8').includes('res.by_reference'),
    'counter tax: the split comes from Stripe per-line numbers, not scaled guesses');
  A(rp.includes('await pos.refreshTabTax') && rp.includes('pos.stxRecordSale(') && tl.includes('stxRecordSale'),
    'counter tax: every money-changing counter action recalculates, and both cash and card record the sale');
  cfgS.saveConfig({ pos: { tax: { stripeTax: false } }, stripe: { secretKey: '' } });
}

  console.log('\nALL POS LIFECYCLE TESTS PASS');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
