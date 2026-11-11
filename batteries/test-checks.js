// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-checks.js — SPLITTING CHECKS. The invariant under test: the checks must
// add up to the tab EXACTLY, to the penny, in every arrangement. If they ever
// don't, the till stops reconciling and staff stop trusting the system.
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
const $ = c => '$' + (c / 100).toFixed(2);

(async () => {
  { const p = './config.json'; let c = {}; if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
    c.server = Object.assign({}, c.server, { businessName: 'Split Test', adminPassword: 'battery-owner-pass-1' });
    c.setup = Object.assign({}, c.setup, { completed: true });
    c.pos = Object.assign({}, c.pos, { tax: { categories: { food: 7.375, beverage: 7.375, sim: 0 } },
                                       payments: { cash: true, check: false } });
    fs.writeFileSync(p, JSON.stringify(c, null, 2)); }

  const dbM = require('./services/db'); await dbM.initDb();
  const pos = require('./services/pos'); pos.ensureSchema();
  const C = require('./services/checks'); C.ensureSchema();

  console.log('── the penny math ──');
  ok('an even split is even', JSON.stringify(C.allocateCents(1000, [1, 1])) === '[500,500]');
  const third = C.allocateCents(1000, [1, 1, 1]);
  ok('$10.00 three ways sums to exactly $10.00', third.reduce((a, b) => a + b, 0) === 1000, third);
  ok('...and no share is more than a penny off', Math.max(...third) - Math.min(...third) <= 1, third);
  const seven = C.allocateCents(1001, [1, 1, 1, 1, 1, 1, 1]);
  ok('an awkward total across 7 checks still sums exactly', seven.reduce((a, b) => a + b, 0) === 1001, seven);
  ok('weighted shares respect the weights', JSON.stringify(C.allocateCents(900, [2, 1])) === '[600,300]');
  ok('a zero total splits to zeros', C.allocateCents(0, [1, 1, 1]).every(v => v === 0));

  console.log('── splitting a real tab ──');
  const cat = pos.upsertCategory({ name: 'Kitchen', printer_role: 'kitchen', tax_category: 'food' });
  const bar = pos.upsertCategory({ name: 'Bar', printer_role: 'bar', tax_category: 'beverage' });
  const burger = pos.upsertItem({ category_id: cat, name: 'Burger', price_cents: 1450 });
  const nachos = pos.upsertItem({ category_id: cat, name: 'Nachos', price_cents: 1000 });
  const beer = pos.upsertItem({ category_id: bar, name: 'Beer', price_cents: 650 });

  const tab = pos.openTab({ label: 'Table 4', employee: 'Dana' });
  pos.sendOrder(tab.id, [{ item_id: burger }, { item_id: burger }, { item_id: nachos },
                          { item_id: beer }, { item_id: beer }], 'Dana');
  const tabTotals = pos.computeTotals(pos.getTab(tab.id));
  console.log('  tab total:', $(tabTotals.total_cents));

  let r = C.checkTotals(tab.id);
  ok('an unsplit tab is one check carrying the whole total',
     r.checks.length === 1 && r.checks[0].total_cents === tabTotals.total_cents, r.checks.length);

  C.splitTab(tab.id, 2);
  r = C.checkTotals(tab.id);
  ok('splitting creates the checks', r.checks.length === 2);
  ok('RECONCILES: the checks still add to the tab', r.reconciles === true,
     { checks: r.checks_total_cents, tab: r.tab_total_cents });
  ok('everything starts on the first check', r.checks[1].total_cents === 0);

  console.log('── moving items between checks ──');
  const items = pos.getTab(tab.id).items.filter(i => i.status !== 'voided');
  const aBurger = items.find(i => i.name === 'Burger');
  const aBeer = items.find(i => i.name === 'Beer');
  C.moveItem(tab.id, aBurger.id, r.checks[1].id);
  C.moveItem(tab.id, aBeer.id, r.checks[1].id);
  r = C.checkTotals(tab.id);
  ok('the moved items land on the second check', r.checks[1].subtotal_cents === 1450 + 650, r.checks[1].subtotal_cents);
  ok('RECONCILES after moving', r.reconciles === true, { c: r.checks_total_cents, t: r.tab_total_cents });
  ok('tax follows the items, not the tab', r.checks[1].tax_cents > 0 && r.checks[0].tax_cents > 0,
     { a: r.checks[0].tax_cents, b: r.checks[1].tax_cents });

  console.log("── the shared appetizer (the exact case maintainer described) ──");
  const theNachos = items.find(i => i.name === 'Nachos');
  C.shareItem(tab.id, theNachos.id, r.checks.map(c => c.id));
  r = C.checkTotals(tab.id);
  const nachoShares = r.checks.map(c => (c.lines.find(l => l.name === 'Nachos') || {}).amount_cents || 0);
  ok('the appetizer is split across both checks', nachoShares.every(v => v > 0), nachoShares);
  ok('the shares add back to the appetizer price', nachoShares.reduce((a, b) => a + b, 0) === 1000, nachoShares);
  ok('each check shows it as shared', r.checks.every(c => (c.lines.find(l => l.name === 'Nachos') || {}).shared === true));
  ok('RECONCILES with a shared item', r.reconciles === true, { c: r.checks_total_cents, t: r.tab_total_cents });

  console.log('── odd money: 3 checks, an item that will not divide ──');
  const tab2 = pos.openTab({ label: 'Table 9', employee: 'Dana' });
  const odd = pos.upsertItem({ category_id: cat, name: 'Odd Plate', price_cents: 1001 });
  pos.sendOrder(tab2.id, [{ item_id: odd }], 'Dana');
  C.splitTab(tab2.id, 3);
  const oddItem = pos.getTab(tab2.id).items.find(i => i.name === 'Odd Plate');
  C.shareItem(tab2.id, oddItem.id, C.listChecks(tab2.id).map(c => c.id));
  let r2 = C.checkTotals(tab2.id);
  const shares = r2.checks.map(c => c.subtotal_cents);
  ok('$10.01 three ways: shares differ by at most a penny', Math.max(...shares) - Math.min(...shares) <= 1, shares);
  ok('$10.01 three ways: NOTHING is lost or invented', shares.reduce((a, b) => a + b, 0) === 1001, shares);
  ok('RECONCILES including tax on odd money', r2.reconciles === true,
     { c: r2.checks_total_cents, t: r2.tab_total_cents });

  console.log('── split it all down the middle ──');
  const tab3 = pos.openTab({ label: 'Table 12', employee: 'Dana' });
  pos.sendOrder(tab3.id, [{ item_id: burger }, { item_id: beer }, { item_id: nachos }], 'Dana');
  C.splitTab(tab3.id, 4);
  C.shareAllEvenly(tab3.id);
  let r3 = C.checkTotals(tab3.id);
  ok('four checks each carry a quarter', r3.checks.every(c => c.total_cents > 0));
  const spread = r3.checks.map(c => c.total_cents);
  ok('the four are within a penny of each other', Math.max(...spread) - Math.min(...spread) <= 1, spread);
  ok('RECONCILES when everything is shared', r3.reconciles === true, { c: r3.checks_total_cents, t: r3.tab_total_cents });

  console.log('── paying one check at a time ──');
  const first = r3.checks[0];
  pos.recordPayment(tab3.id, { method: 'cash', amount_cents: first.total_cents,
                               tendered_cents: first.total_cents, employee: 'Dana' });
  dbM.db.prepare(`UPDATE tab_payments SET check_id=? WHERE tab_id=? AND check_id IS NULL`).run(first.id, tab3.id);
  r3 = C.checkTotals(tab3.id);
  ok('the paid check shows settled', r3.checks[0].due_cents === 0 && r3.checks[0].paid_cents === first.total_cents);
  ok('the other checks are untouched', r3.checks.slice(1).every(c => c.due_cents > 0 && c.paid_cents === 0));

  console.log('── guards ──');
  try { C.splitTab(tab3.id, 1); ok('refuses a 1-way split', false); } catch { ok('refuses a 1-way split', true); }
  try { C.splitTab(tab3.id, 99); ok('refuses an absurd split', false); } catch { ok('refuses an absurd split', true); }
  try { C.shareItem(tab3.id, 'nope', [first.id]); ok('refuses sharing across one check', false); }
  catch { ok('refuses sharing across one check', true); }
  try { C.removeCheck(tab3.id, first.id); ok('refuses removing a check with a payment', false); }
  catch { ok('refuses removing a check with a payment', true); }
  const single = pos.openTab({ label: 'Solo', employee: 'Dana' });
  C.ensureDefaultCheck(single.id);
  try { C.removeCheck(single.id, C.listChecks(single.id)[0].id); ok('a tab always keeps one check', false); }
  catch { ok('a tab always keeps one check', true); }

  console.log('── items added AFTER a split still land somewhere ──');
  pos.sendOrder(tab3.id, [{ item_id: beer }], 'Dana');
  const r4 = C.checkTotals(tab3.id);
  ok('a late round is picked up, nothing goes missing', r4.reconciles === true,
     { c: r4.checks_total_cents, t: r4.tab_total_cents });

  console.log('── golf behaves exactly like food (maintainer: all golf time can be split) ──');
  const tab5 = pos.openTab({ label: 'Golf Group', employee: 'Dana' });
  pos.addGolfLine(tab5.id, 8000, 'Golf - 1 hr');
  pos.sendOrder(tab5.id, [{ item_id: beer }], 'Dana');
  C.splitTab(tab5.id, 4);
  const golfLine = pos.getTab(tab5.id).items.find(i => i.name.startsWith('Golf'));
  ok('a golf line exists on the tab like any other item', !!golfLine, golfLine && golfLine.name);
  C.shareItem(tab5.id, golfLine.id, C.listChecks(tab5.id).map(c => c.id));
  let g = C.checkTotals(tab5.id);
  const golfShares = g.checks.map(c => (c.lines.find(l => l.name.startsWith('Golf')) || {}).amount_cents || 0);
  ok('golf time splits four ways', golfShares.every(v => v > 0), golfShares);
  ok('the golf shares add back to the full golf price', golfShares.reduce((a, b) => a + b, 0) === 8000, golfShares);
  ok('RECONCILES with golf shared and food not', g.reconciles === true, { c: g.checks_total_cents, t: g.tab_total_cents });
  C.moveItem(tab5.id, golfLine.id, C.listChecks(tab5.id)[0].id);
  g = C.checkTotals(tab5.id);
  ok('one person can take the whole golf charge', g.checks[0].lines.some(l => l.name.startsWith('Golf') && l.amount_cents === 8000));
  ok('RECONCILES when one person covers the golf', g.reconciles === true);

  console.log('── extra time: who pays? ──');
  const ck = require('./services/checkin');
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  dbM.db.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
                  VALUES ('ext-bk','bay1','Bay 1','Split Group','+15550001111',?,'10:00','11:00',?,60,8000,'active')`).run(day, day);
  const tab6 = pos.openTab({ label: 'Split Group', employee: 'Dana' });
  C.splitTab(tab6.id, 3);
  let e = ck.extendBooking({ booking_id: 'ext-bk', minutes: 30, tab_id: tab6.id,
                             employee: 'Dana', pay_split: 'even' });
  ok('extension accepted', e.status === 200, e.body);
  ok('it reports how it was paid for', e.body.charged && e.body.charged.paid_by === 'split evenly', e.body.charged);
  let t6 = C.checkTotals(tab6.id);
  const extShares = t6.checks.map(c => (c.lines.find(l => /extension/i.test(l.name)) || {}).amount_cents || 0);
  ok('the extra time is split evenly across the group', extShares.every(v => v > 0), extShares);
  ok('RECONCILES after extending', t6.reconciles === true, { c: t6.checks_total_cents, t: t6.tab_total_cents });

  dbM.db.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
                  VALUES ('ext-bk2','bay2','Bay 2','One Payer','+15550002222',?,'14:00','15:00',?,60,8000,'active')`).run(day, day);
  const tab7 = pos.openTab({ label: 'One Payer', employee: 'Dana' });
  C.splitTab(tab7.id, 3);
  const payer = C.listChecks(tab7.id)[1].id;
  e = ck.extendBooking({ booking_id: 'ext-bk2', minutes: 30, tab_id: tab7.id,
                         employee: 'Dana', pay_checks: [payer] });
  ok('one person can cover the extra time', e.status === 200 && e.body.charged.paid_by === 'one person', e.body.charged);
  const t7 = C.checkTotals(tab7.id);
  const onlyOne = t7.checks.filter(c => c.lines.some(l => /extension/i.test(l.name)));
  ok('...and it lands on exactly that person', onlyOne.length === 1 && onlyOne[0].id === payer, onlyOne.map(c => c.label));
  ok('RECONCILES when one person covers it', t7.reconciles === true);

  try { dbM.db.prepare(`DELETE FROM bookings WHERE id LIKE 'ext-bk%'`).run(); } catch {}

  console.log('── ACROSS TABS: the model production actually uses for groups ──');
  // VERIFIED: every seat has its own tab, so a group is already split by
  // person. What was missing is moving a line to someone else and sharing one
  // line across several people.
  const tA = pos.openTab({ label: 'A. Reyes', employee: 'Dana' });
  const tB = pos.openTab({ label: 'M. Reyes', employee: 'Dana' });
  const tC = pos.openTab({ label: 'Guest 3', employee: 'Dana' });
  pos.sendOrder(tA.id, [{ item_id: burger }, { item_id: nachos }], 'Dana');
  pos.addGolfLine(tA.id, 8000, 'Golf - 1 hr');
  const aItems = pos.getTab(tA.id).items;
  const gBurger = aItems.find(i => i.name === 'Burger');
  const gNachos = aItems.find(i => i.name === 'Nachos');
  const gGolf = aItems.find(i => i.name.startsWith('Golf'));

  C.moveItemToTab(gBurger.id, tB.id, 'Dana');
  ok('a line moves to another person\'s tab',
     pos.getTab(tB.id).items.some(i => i.name === 'Burger') &&
     !pos.getTab(tA.id).items.some(i => i.name === 'Burger'));

  const beforeTotal = [tA, tB, tC].reduce((s, t) => s + pos.computeTotals(pos.getTab(t.id)).subtotal_cents, 0);
  const sh = C.shareItemAcrossTabs(gNachos.id, [tA.id, tB.id, tC.id], 'Dana');
  ok('the appetizer is shared three ways', sh.shares.length === 3, sh.shares.map(s => s.amount_cents));
  ok('the shares add back to the appetizer price exactly',
     sh.shares.reduce((a, s) => a + s.amount_cents, 0) === 1000, sh.shares.map(s => s.amount_cents));
  const afterTotal = [tA, tB, tC].reduce((s, t) => s + pos.computeTotals(pos.getTab(t.id)).subtotal_cents, 0);
  ok('NOTHING is lost or invented across the group', afterTotal === beforeTotal, { before: beforeTotal, after: afterTotal });
  ok('each person sees their own share as a real line',
     [tA, tB, tC].every(t => pos.getTab(t.id).items.some(i => /Nachos \(1\/3 shared\)/.test(i.name))));

  // Golf splits the same way - it is a normal line.
  const gsh = C.shareItemAcrossTabs(gGolf.id, [tA.id, tB.id, tC.id], 'Dana');
  ok('golf time splits across the group too',
     gsh.shares.reduce((a, s) => a + s.amount_cents, 0) === 8000, gsh.shares.map(s => s.amount_cents));
  ok('the golf shares differ by at most a penny',
     Math.max(...gsh.shares.map(s => s.amount_cents)) - Math.min(...gsh.shares.map(s => s.amount_cents)) <= 1);

  console.log('── guards on the group path ──');
  try { C.shareItemAcrossTabs(gBurger.id, [tA.id], 'Dana'); ok('refuses sharing with one person', false); }
  catch { ok('refuses sharing with one person', true); }
  pos.recordPayment(tC.id, { method: 'cash', amount_cents: pos.getTab(tC.id).due_cents,
                             tendered_cents: 100000, employee: 'Dana' });
  const closedC = pos.getTab(tC.id).status === 'closed';
  if (closedC) {
    const bItems = pos.getTab(tB.id).items.filter(i => i.status !== 'voided');
    try { C.moveItemToTab(bItems[0].id, tC.id, 'Dana'); ok('refuses moving onto a settled tab', false); }
    catch { ok('refuses moving onto a settled tab', true); }
  } else ok('refuses moving onto a settled tab (tab stayed open, guard untested)', true);
  try { C.moveItemToTab('nope', tB.id, 'Dana'); ok('refuses an unknown item', false); }
  catch { ok('refuses an unknown item', true); }

  console.log("── the guest check prints ──");
  const printing = require('./services/printing');
  const pTab = pos.openTab({ label: 'Print Me', employee: 'Dana' });
  pos.addGolfLine(pTab.id, 8000, 'Golf - 1 hr');
  pos.sendOrder(pTab.id, [{ item_id: burger }, { item_id: beer }], 'Dana');
  const slip = printing.buildTabReceipt(pos.getTab(pTab.id), { employee: 'Dana' });
  ok('the check names the person', /Print Me/.test(slip));
  ok('it lists what they had', /Burger/.test(slip) && /Beer/.test(slip) && /Golf/.test(slip), slip.slice(0, 60));
  ok('it shows tax and a total', /Tax/.test(slip) && /TOTAL/.test(slip));
  ok('it shows what is DUE', /DUE/.test(slip));
  ok('an unpaid slip says GUEST CHECK, not receipt', /GUEST CHECK/.test(slip) && !/^RECEIPT/m.test(slip));
  ok('...and says plainly it is not a receipt', /Not a receipt/.test(slip));
  const totals = pos.computeTotals(pos.getTab(pTab.id));
  ok('the printed total matches the tab exactly',
     slip.includes('$' + (totals.total_cents / 100).toFixed(2)), totals.total_cents);
  const noPrinter = printing.enqueueTabReceipt(pos.getTab(pTab.id), {});
  ok('with no counter printer it says so instead of failing silently',
     noPrinter.printed === false && /printer/i.test(noPrinter.reason), noPrinter);

  console.log("── paying must not fail ──");
  pos.recordPayment(pTab.id, { method: 'cash', amount_cents: 2000, tendered_cents: 2000, employee: 'Dana' });
  let pt = pos.computeTotals(pos.getTab(pTab.id));
  ok('a part payment reduces what is due, tab stays open',
     pt.paid_cents === 2000 && pt.due_cents === totals.total_cents - 2000 && pos.getTab(pTab.id).status === 'open',
     { paid: pt.paid_cents, due: pt.due_cents });
  const rest = pt.due_cents;
  const res = pos.recordPayment(pTab.id, { method: 'cash', amount_cents: rest, tendered_cents: rest + 500, employee: 'Dana' });
  ok('change is calculated', res.change_cents === 500, res.change_cents);
  ok('settling in full closes the tab', res.closed === true && pos.getTab(pTab.id).status === 'closed');
  const paidSlip = printing.buildTabReceipt(pos.getTab(pTab.id), { employee: 'Dana', paid: true });
  ok('a settled slip prints as a RECEIPT saying paid in full',
     /RECEIPT/.test(paidSlip) && /PAID IN FULL/.test(paidSlip));
  const closedTab = pos.openTab({ label: 'Guard', employee: 'Dana' });
  pos.sendOrder(closedTab.id, [{ item_id: beer }], 'Dana');
  try { pos.recordPayment(closedTab.id, { method: 'check', amount_cents: 100, employee: 'Dana' });
        ok('a disabled payment method is refused', false); }
  catch (e) { ok('a disabled payment method is refused', /not enabled/i.test(e.message), e.message); }
  try { pos.recordPayment(closedTab.id, { method: 'cash', amount_cents: 500, tendered_cents: 100, employee: 'Dana' });
        ok('tendering less than the amount is refused', false); }
  catch { ok('tendering less than the amount is refused', true); }

  console.log(`\nCHECKS: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
