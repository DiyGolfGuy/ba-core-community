// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-endtoend.js — THE FULL-DAY STORY (maintainer, Aug 13 2026)
// "no matter how something is done everything that was supposed to happen
//  needs to happen" - this battery walks one day through EVERY system and
// asserts the cross-effects to the penny: early check-in -> seats -> orders
// -> cross-tab move -> split into checks -> shared item -> per-check collect
// (cash w/ tip + check method) -> auto-close at zero -> void + owner review
// -> EOD sales/payments/tips/expected-cash -> till close over/short.
'use strict';
let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
(async () => {
  const fs = require('fs');
  { const p = './config.json'; let c = {}; if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {} }
    c.businessName = 'E2E'; c.setupComplete = true;
    c.booking = Object.assign(c.booking || {}, { staffedAccess: true, open24Hours: true, pricePerHalfHour: 35 });
    c.bays = [{ id: 'bay1', name: 'Bay 1', active: true }];
    c.pos = Object.assign({}, c.pos, {
      payments: { cash: true, check: true },
      tips: { enabled: true, mode: 'pooled' },
      openingFloatCents: 20000,
      tax: { stripeTax: false, codes: [], categories: { sim: 0, food: 5, beverage: 0 } }
    });
    fs.writeFileSync(p, JSON.stringify(c, null, 2)); }

  const dbM = require('./services/db');
  await dbM.initDb();
  const pos = require('./services/pos'); pos.ensureSchema();
  const checks = require('./services/checks'); checks.ensureSchema(); checks.ensureShareColumn && checks.ensureShareColumn();
  const ck = require('./services/checkin');
  const D = dbM.db;

  // slate: everything from prior runs of THIS battery
  for (const b of D.prepare(`SELECT id FROM bookings WHERE phone LIKE '558%'`).all()) {
    for (const t of D.prepare(`SELECT id FROM tabs WHERE booking_id=?`).all(b.id)) {
      D.prepare(`DELETE FROM item_allocations WHERE item_id IN (SELECT id FROM tab_items WHERE tab_id=?)`).run(t.id);
      D.prepare(`DELETE FROM tab_checks WHERE tab_id=?`).run(t.id);
      D.prepare(`DELETE FROM tab_items WHERE tab_id=?`).run(t.id);
      D.prepare(`DELETE FROM tab_payments WHERE tab_id=?`).run(t.id);
    }
    D.prepare(`DELETE FROM tabs WHERE booking_id=?`).run(b.id);
    D.prepare(`DELETE FROM settlements WHERE booking_id=?`).run(b.id);
  }
  D.prepare(`DELETE FROM bookings WHERE phone LIKE '558%'`).run();
  for (const t of D.prepare(`SELECT id FROM tabs WHERE label LIKE 'E2E P%'`).all()) {
    D.prepare(`DELETE FROM tab_items WHERE tab_id=?`).run(t.id);
    D.prepare(`DELETE FROM tab_payments WHERE tab_id=?`).run(t.id);
    D.prepare(`DELETE FROM tabs WHERE id=?`).run(t.id);
  }
  // a closed day is the FACILITY's day (Oct 2 2026) - a UTC date missed the evening's own close on a second run
  D.prepare(`DELETE FROM eod_reports WHERE date=?`).run(require('./services/revenue').facilityToday());

  const pad2 = n => String(n).padStart(2, '0');
  const hh = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const now = new Date();
  const st = new Date(now.getTime() + 120 * 60000), en = new Date(now.getTime() + 180 * 60000);

  console.log('\u2500\u2500 CHAPTER 1: the early birds \u2500\u2500');
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('e2e-b1','bay1','Bay 1','E2E Group','5580001',?,?,?,?,60,10500,'active')`)
   .run(ymd(st), hh(st), hh(en), ymd(en));
  // W16 (Sep 1 2026): the server refuses unsigned seats under 'required' - paper attests, as staff would record
  const early = ck.performCheckin({ booking_id: 'e2e-b1', seats: [{ name: 'Mike', waiver: { method: 'paper' } }, { name: 'Sara', waiver: { method: 'paper' } }, { name: 'Lee', waiver: { method: 'paper' } }], employee: 'Dana' });
  ok('early check-in accepted two hours before the tee time', early && early.status >= 200 && early.status < 300, early && early.status);
  const gv = ck.groupView('e2e-b1');
  // Pricing truth: check-in prices from CONFIG (35/half-hour x 60 min = 7000),
  // not the raw booking row - and largest remainder hands out the odd cent.
  const shares = gv.seats.map(x => x.due_cents).sort((p, q) => q - p);
  ok('three seats, config-priced 7000 split by largest remainder',
     gv.seats.length === 3 && shares.reduce((p, q) => p + q, 0) === 7000 && shares[0] - shares[2] <= 1, shares);
  const sara0 = gv.seats.find(s => s.name === 'Sara').due_cents;
  const lee0  = gv.seats.find(s => s.name === 'Lee').due_cents;
  const tabMike = gv.seats.find(s => s.name === 'Mike').tab_id;
  const tabSara = gv.seats.find(s => s.name === 'Sara').tab_id;
  const tabLee  = gv.seats.find(s => s.name === 'Lee').tab_id;

  console.log('\u2500\u2500 CHAPTER 2: orders and the wandering soda \u2500\u2500');
  pos.sendOrder(tabMike, [
    { kind: 'custom', name: 'E2E Burger', unit_price_cents: 1599, tax_category: 'food', printer_role: 'kitchen' },
    { kind: 'custom', name: 'E2E Pitcher', unit_price_cents: 1800, tax_category: 'beverage', printer_role: 'bar' }
  ], 'Dana');
  pos.sendOrder(tabSara, [{ kind: 'custom', name: 'E2E Soda', unit_price_cents: 300, tax_category: 'beverage', printer_role: 'bar' }], 'Dana');
  const soda = pos.getTab(tabSara).items.find(i => i.name === 'E2E Soda');
  const mv = pos.moveItemToTab(tabSara, soda.id, tabMike, 'Dana');
  const mike0 = gv.seats.find(s => s.name === 'Mike').due_cents;
  ok('the soda moved tabs and both dues follow to the penny',
     mv.from.due_cents === sara0 && mv.to.due_cents === mike0 + 1599 + 80 + 1800 + 300,
     { from: mv.from.due_cents, to: mv.to.due_cents });

  console.log('\u2500\u2500 CHAPTER 3: split into checks, share the pitcher \u2500\u2500');
  checks.splitTab(tabMike, 2);
  let ct = checks.checkTotals(tabMike);
  const c1 = ct.checks[0], c2 = ct.checks[1];
  const burger = pos.getTab(tabMike).items.find(i => i.name === 'E2E Burger');
  const pitcher = pos.getTab(tabMike).items.find(i => i.name === 'E2E Pitcher');
  checks.moveItem(tabMike, burger.id, c2.id);
  checks.shareItem(tabMike, pitcher.id, [c1.id, c2.id]);
  ct = checks.checkTotals(tabMike);
  ok('checks reconcile to the tab exactly', ct.reconciles === true && ct.checks_total_cents === ct.tab_total_cents,
     { checks: ct.checks_total_cents, tab: ct.tab_total_cents });
  const tabTax = pos.computeTotals(pos.getTab(tabMike)).tax_cents;
  ok('per-check tax adds back to the tab tax exactly',
     ct.checks.reduce((s, c) => s + c.tax_cents, 0) === tabTax, { sum: ct.checks.reduce((s, c) => s + c.tax_cents, 0), tab: tabTax });
  const sharedLine = ct.checks[0].lines.find(l => l.shared);
  ok('the pitcher is shared two ways with largest-remainder pennies',
     sharedLine && sharedLine.share_of === 2
     && ct.checks[0].lines.find(l => l.shared).amount_cents + ct.checks[1].lines.find(l => l.shared).amount_cents === 1800);

  console.log('\u2500\u2500 CHAPTER 4: collect per check, tab closes itself at zero \u2500\u2500');
  const c1due = ct.checks.find(c => c.id === c1.id).due_cents;
  pos.recordPayment(tabMike, { method: 'cash', amount_cents: c1due, tendered_cents: c1due + 1000, tip_cents: 200, employee: 'Dana', check_id: c1.id });
  ct = checks.checkTotals(tabMike);
  ok('check 1 shows paid with its tip; check 2 still due',
     ct.checks.find(c => c.id === c1.id).due_cents === 0 && ct.checks.find(c => c.id === c1.id).tip_cents === 200
     && ct.checks.find(c => c.id === c2.id).due_cents > 0);
  ok('the tab stays open while any check is unpaid', pos.getTab(tabMike).status === 'open');
  let threw = false; try { checks.removeCheck(tabMike, c1.id); } catch (e) { threw = true; }
  ok('a collected check is locked against removal', threw);
  const c2due = ct.checks.find(c => c.id === c2.id).due_cents;
  const payOut = pos.recordPayment(tabMike, { method: 'check', amount_cents: c2due, memo: 'Check #101', employee: 'Dana', check_id: c2.id });
  ok('the last check collected closes the tab at zero due', payOut.closed === true && pos.getTab(tabMike).status === 'closed');

  console.log('\u2500\u2500 CHAPTER 5: a void, and the owner reviews it \u2500\u2500');
  pos.sendOrder(tabSara, [{ kind: 'custom', name: 'E2E Wings', unit_price_cents: 1200, tax_category: 'food', printer_role: 'kitchen' }], 'Dana');
  const wings = pos.getTab(tabSara).items.find(i => i.name === 'E2E Wings');
  pos.voidItem(wings.id, { comp: false, reason: 'rung wrong', employee: 'Dana' });
  ok('the void restores the due', pos.getTab(tabSara).due_cents === sara0, pos.getTab(tabSara).due_cents);
  let review = pos.reviewList();
  const wRow = review.find(r => r.name === 'E2E Wings');
  ok('the void lands on the owner review list unreviewed', wRow && !wRow.reviewed);
  pos.checkReview(wRow.id, 'maintainer');
  review = pos.reviewList();
  ok('the owner Reviewed stamp sticks with the name', review.find(r => r.name === 'E2E Wings').reviewed === 1
     && review.find(r => r.name === 'E2E Wings').reviewed_by === 'maintainer');

  pos.recordPayment(tabSara, { method: 'cash', amount_cents: sara0, tendered_cents: sara0, employee: 'Dana' });
  pos.recordPayment(tabLee,  { method: 'cash', amount_cents: lee0, tendered_cents: lee0, employee: 'Dana' });
  ok('every seat settled - the group reads done', ck.groupView('e2e-b1').all_settled === true);

  console.log('\u2500\u2500 CHAPTER 5.5: split one plate across PEOPLE (the golfers) \u2500\u2500');
  {
    const p1 = pos.openTab({ label: 'E2E P1', employee: 'Dana' });
    const p2 = pos.openTab({ label: 'E2E P2', employee: 'Dana' });
    pos.sendOrder(p1.id, [{ kind: 'custom', name: 'E2E Nachos', unit_price_cents: 999, tax_category: 'food', printer_role: 'kitchen' }], 'Dana');
    const nach = pos.getTab(p1.id).items.find(i => i.name === 'E2E Nachos');
    checks.shareItemAcrossTabs(nach.id, [p1.id, p2.id], 'Dana');
    const l1 = pos.getTab(p1.id).items.filter(i => i.name.indexOf('Nachos') >= 0);
    const l2 = pos.getTab(p2.id).items.filter(i => i.name.indexOf('Nachos') >= 0);
    ok('the plate splits across two PEOPLE, penny-exact, original replaced',
       l1.length === 1 && l2.length === 1 && l1[0].unit_price_cents + l2[0].unit_price_cents === 999,
       { p1: l1.map(x => x.unit_price_cents), p2: l2.map(x => x.unit_price_cents) });
    ok('both people owe their share and nothing else lingers',
       // shares re-tax per tab: 25 + 25 = 50, same as the single plate would owe
       pos.getTab(p1.id).due_cents + pos.getTab(p2.id).due_cents === 999 + 50,
       { d1: pos.getTab(p1.id).due_cents, d2: pos.getTab(p2.id).due_cents });
    pos.recordPayment(p1.id, { method: 'cash', amount_cents: pos.getTab(p1.id).due_cents, tendered_cents: 1000, employee: 'Dana' });
    pos.recordPayment(p2.id, { method: 'cash', amount_cents: pos.getTab(p2.id).due_cents, tendered_cents: 1000, employee: 'Dana' });
  }

  console.log('\u2500\u2500 CHAPTER 6: the day adds up - EOD to the penny \u2500\u2500');
  const s = pos.eodSummary();
  ok('sales by category: golf shares, food (void excluded), beverage',
     s.sales_by_category.sim === 7000 && s.sales_by_category.food === 1599 + 999 && s.sales_by_category.beverage === 2100,
     s.sales_by_category);
  ok('tax by category: burger 80 plus the shared plate 50', s.tax_by_category.food === 80 + 50, s.tax_by_category);
  const cash = s.payments.find(p => p.method === 'cash'), chk = s.payments.find(p => p.method === 'check');
  const cashExpected = c1due + sara0 + lee0 + 999 + 50;
  ok('payments by method reconcile to what was taken', cash && cash.a === cashExpected && chk && chk.a === c2due,
     { cash: cash && cash.a, expect: cashExpected, chk: chk && chk.a });
  ok('the tip rides to the employee', s.tips.by_employee.some(t => t.employee === 'Dana' && t.t === 200), s.tips.by_employee);
  ok('sales plus tax equals money collected, to the penny',
     7000 + 1599 + 999 + 2100 + 80 + 50 === (cash.a + chk.a), { sales: 7000 + 1599 + 999 + 2100 + 80 + 50, collected: cash.a + chk.a });
  // The drawer truth: a cash tip physically enters the drawer, so expected
  // cash counts it. The battery first forgot the tip; the system had not.
  ok('expected cash = opening float + cash taken + cash tips', s.expected_cash_cents === 20000 + cashExpected + 200,
     { exp: s.expected_cash_cents, want: 20000 + cashExpected + 200 });
  ok('review card counts: one void, zero unreviewed', s.comps_voids.count >= 1 && s.comps_voids.unreviewed === 0, s.comps_voids);

  const closed = pos.closeDay({ counted_cents: s.expected_cash_cents - 100, counted_by: 'Robin' });
  ok('the till closes one dollar short and says so', closed.over_short_cents === -100, closed.over_short_cents);

  console.log(`\nEND TO END: ${pass} passed, ${fail} failed`);
  dbM.saveDb && dbM.saveDb();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
