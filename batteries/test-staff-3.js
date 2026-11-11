// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-staff-3.js — Wave D: merge-tabs + extend-booking.
'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const uid = () => require('crypto').randomUUID();

(async () => {
  const dbM = require('./services/db');
  await dbM.initDb();
  const cs = require('./services/config');
  const pos = require('./services/pos');
  pos.ensureSchema();
  const D = dbM.db;

  // deterministic rerun slate for this battery's fixtures (phone 556-prefixed)
  const oldIds = D.prepare(`SELECT id FROM bookings WHERE phone LIKE '556%'`).all().map(r => r.id);
  for (const bid of oldIds) {
    for (const t of D.prepare(`SELECT id FROM tabs WHERE booking_id=?`).all(bid)) {
      D.prepare(`DELETE FROM tab_items WHERE tab_id=?`).run(t.id);
      D.prepare(`DELETE FROM tab_payments WHERE tab_id=?`).run(t.id);
    }
    D.prepare(`DELETE FROM tabs WHERE booking_id=?`).run(bid);
    D.prepare(`DELETE FROM settlements WHERE booking_id=?`).run(bid);
  }
  D.prepare(`DELETE FROM bookings WHERE phone LIKE '556%'`).run();
  for (const t of D.prepare(`SELECT id FROM tabs WHERE label LIKE 'W3 %'`).all()) {
    D.prepare(`DELETE FROM tab_items WHERE tab_id=?`).run(t.id);
    D.prepare(`DELETE FROM tab_payments WHERE tab_id=?`).run(t.id);
  }
  D.prepare(`DELETE FROM tabs WHERE label LIKE 'W3 %'`).run();

  // stage config: bay1 with the same premium, cash on, zero tax for pure cents
  const cfg = cs.getConfig();
  cfg.booking = Object.assign(cfg.booking || {}, {
    staffedAccess: true, open24Hours: false, openTime: '05:00', closeTime: '23:30',
    closeNextDay: false, bufferMins: 0, pricePerHalfHour: 30
  });
  cfg.bays = [{ id: 'bay1', name: 'Bay 1', active: true, priceAdjustCents: 1000 }];
  cfg.pos = Object.assign({}, cfg.pos, {
    payments: { cash: true, check: true },
    tax: { categories: { sim: 0, food: 0, beverage: 0 }, stripeTax: false, codes: [] }
  });
  cs.saveConfig(cfg);

  const ck = require('./services/checkin');

  // ── MERGE ────────────────────────────────────────────────────────────────
  const tA = pos.openTab({ label: 'W3 Beth', employee: 'Dana' });
  const tB = pos.openTab({ label: 'W3 Table 4', employee: 'Dana' });
  pos.sendOrder(tA.id, [{ kind: 'custom', name: 'W3 Soda', unit_price_cents: 300, tax_category: 'beverage', printer_role: 'bar' }], 'Dana');
  pos.sendOrder(tB.id, [{ kind: 'custom', name: 'W3 Wings', unit_price_cents: 1200, tax_category: 'food', printer_role: 'kitchen' }], 'Dana');
  pos.recordPayment(tA.id, { method: 'cash', amount_cents: 100, tendered_cents: 100, employee: 'Dana' });
  let m = pos.mergeTabs(tA.id, tB.id, 'Dana');
  ok('merge: dst totals = 300+1200 items, 100 paid, due 1400',
     m.tab.subtotal_cents === 1500 && m.tab.paid_cents === 100 && m.tab.due_cents === 1400,
     { s: m.tab.subtotal_cents, p: m.tab.paid_cents, d: m.tab.due_cents });
  const srcRow = D.prepare(`SELECT status, closed_by FROM tabs WHERE id=?`).get(tA.id);
  ok('merge: source closed with merge stamp', srcRow.status === 'closed' && /^merge:Dana/.test(srcRow.closed_by), srcRow);
  ok('merge: source holds zero items', D.prepare(`SELECT COUNT(*) c FROM tab_items WHERE tab_id=?`).get(tA.id).c === 0);
  let threw = ''; try { pos.mergeTabs(tA.id, tB.id, 'Dana'); } catch (e) { threw = e.message; }
  ok('merge: closed source refuses a second merge', /open/.test(threw), threw);
  threw = ''; try { pos.mergeTabs(tB.id, tB.id, 'Dana'); } catch (e) { threw = e.message; }
  ok('merge: self-merge refused', /itself/.test(threw));
  // A SPLIT TAB MERGED (Oct 3 2026; pilot facility's handoff section 2): its items and part payments stayed on the closed tab's
  // checks, so on the merged tab they were in no check and the split screen did not add up
  { const checks = require('./services/checks');
    const tC = pos.openTab({ label: 'W3 Split', employee: 'Dana' }), tD = pos.openTab({ label: 'W3 Bar', employee: 'Dana' });
    pos.sendOrder(tC.id, [{ kind: 'custom', name: 'W3 Burger', unit_price_cents: 1000, tax_category: 'food', printer_role: 'kitchen' },
                          { kind: 'custom', name: 'W3 Salad', unit_price_cents: 800, tax_category: 'food', printer_role: 'kitchen' }], 'Dana');
    pos.sendOrder(tD.id, [{ kind: 'custom', name: 'W3 Beer', unit_price_cents: 600, tax_category: 'beverage', printer_role: 'bar' }], 'Dana');
    checks.splitTab(tC.id, 2);
    const cs0 = checks.listChecks(tC.id), items = pos.getTab(tC.id).items;
    checks.moveItem(tC.id, items.find(i => i.name === 'W3 Salad').id, cs0[1].id);
    pos.recordPayment(tC.id, { method: 'cash', amount_cents: 800, tendered_cents: 800, employee: 'Dana', check_id: cs0[1].id });   // the salad's check paid
    pos.mergeTabs(tC.id, tD.id, 'Dana');
    const ct = checks.checkTotals(tD.id);
    const inChecks = ct.checks.reduce((n, c) => n + c.subtotal_cents, 0), paidInChecks = ct.checks.reduce((n, c) => n + c.paid_cents, 0);
    ok('merge: a SPLIT tab merged keeps its checks - every item is in a check (600 + 1000 + 800) and the part payment stays on its check (it was in no check: the amounts did not add up)',
       inChecks === 2400 && paidInChecks === 800 && ct.checks.some(c => /W3 Split/.test(c.label) && c.paid_cents === 800 && c.due_cents === 0), { inChecks, paidInChecks, checks: ct.checks.map(c => ({ label: c.label, sub: c.subtotal_cents, paid: c.paid_cents })) }); }

  // ── EXTEND ───────────────────────────────────────────────────────────────
  const B1 = uid(), B2 = uid();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active')`)
    .run(B1, 'bay1', 'Bay 1', 'Ext Group', '5561110001', '2026-08-24', '10:00', '11:00', 60, 8000);
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active')`)
    .run(B2, 'bay1', 'Bay 1', 'Next Group', '5561110002', '2026-08-24', '12:00', '13:00', 60, 8000);

  const tabX = pos.openTab({ booking_id: B1, label: 'Ext Group', bay_id: 'bay1', bay_name: 'Bay 1', employee: 'Dana' });
  let r = ck.extendBooking({ booking_id: B1, minutes: 30, tab_id: tabX.id, employee: 'Dana' });
  ok('extend: +30 lands, end 11:30, bay-aware $40 on the tab',
     r.status === 200 && r.body.end_time === '11:30' && r.body.price_cents === 4000 && r.body.charged.amount_cents === 4000, r.body);
  const tx = pos.getTab(tabX.id);
  ok('extend: golf line present on the tab', tx.items.some(i => /extension 30/.test(i.name)) && tx.due_cents === 4000, tx.due_cents);
  const bRow = D.prepare(`SELECT end_time, duration_minutes FROM bookings WHERE id=?`).get(B1);
  ok('extend: booking row updated for the scheduler', bRow.end_time === '11:30' && bRow.duration_minutes === 90, bRow);

  r = ck.extendBooking({ booking_id: B1, minutes: 30, employee: 'Dana' });
  ok('extend: no-charge extension (deposit/prepaid path) to exactly 12:00 allowed - half-open vs the 12:00 next',
     r.status === 200 && r.body.end_time === '12:00' && r.body.charged === null, r.body);
  r = ck.extendBooking({ booking_id: B1, minutes: 30, employee: 'Dana' });
  ok('extend: next booking blocks with a named 409', r.status === 409 && /Next Group/.test(r.body.error), r.body);

  const B3 = uid();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active')`)
    .run(B3, 'bay1', 'Bay 1', 'Late Night', '5561110003', '2026-08-24', '22:30', '23:30', 60, 8000);
  r = ck.extendBooking({ booking_id: B3, minutes: 30, employee: 'Dana' });
  ok('extend: closing time blocks', r.status === 400 && /closing/.test(r.body.error), r.body);
  r = ck.extendBooking({ booking_id: B3, minutes: 45, employee: 'Dana' });
  ok('extend: non-30 step rejected', r.status === 400);

  const closedTab = pos.openTab({ label: 'W3 Closer', employee: 'Dana' });
  pos.closeTab(closedTab.id, 'Dana');
  const B4 = uid();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active')`)
    .run(B4, 'bay1', 'Bay 1', 'Honest Path', '5561110004', '2026-08-25', '10:00', '11:00', 60, 8000);
  r = ck.extendBooking({ booking_id: B4, minutes: 30, tab_id: closedTab.id, employee: 'Dana' });
  ok('extend: closed charge tab -> time still added, honest 400 tells staff to add the line by hand',
     r.status === 400 && /by hand/.test(r.body.error) && r.body.extended_to === '11:30'
     && D.prepare(`SELECT end_time FROM bookings WHERE id=?`).get(B4).end_time === '11:30', r.body);

  // ── TAB LIFECYCLE (maintainer, Aug 13): delete a mistake, reopen the settled ──
  // Delete: only the mis-typed shell dies. Anything with history is refused.
  const shell = pos.openTab({ label: 'W3 Mistake', employee: 'Dana' });
  let del = pos.deleteTab(shell.id, { employee: 'Dana' });
  ok('lifecycle: pristine tab deletes, row gone',
     del.ok === true && !D.prepare(`SELECT id FROM tabs WHERE id=?`).get(shell.id), del);

  const withItem = pos.openTab({ label: 'W3 HasItem', employee: 'Dana' });
  pos.sendOrder(withItem.id, [{ kind: 'custom', name: 'Test Beer', unit_price_cents: 650 }], 'Dana');
  threw = null;
  try { pos.deleteTab(withItem.id, { employee: 'Dana' }); } catch (e) { threw = e.message; }
  ok('lifecycle: tab with items refuses delete and points at Void',
     /void/i.test(threw || '') && !!D.prepare(`SELECT id FROM tabs WHERE id=?`).get(withItem.id), threw);

  const withPay = pos.openTab({ label: 'W3 HasPay', employee: 'Dana' });
  D.prepare(`INSERT INTO tab_payments (id, tab_id, method, amount_cents, tip_cents, employee)
             VALUES (?,?,?,?,?,?)`).run(uid(), withPay.id, 'cash', 500, 0, 'Dana');
  threw = null;
  try { pos.deleteTab(withPay.id, { employee: 'Dana' }); } catch (e) { threw = e.message; }
  ok('lifecycle: tab with a payment refuses delete',
     /payment/i.test(threw || '') && !!D.prepare(`SELECT id FROM tabs WHERE id=?`).get(withPay.id), threw);

  const seatTab = D.prepare(`SELECT id FROM tabs WHERE booking_id=? LIMIT 1`).get(B1);
  threw = null;
  try { pos.deleteTab(seatTab.id, { employee: 'Dana' }); } catch (e) { threw = e.message; }
  ok('lifecycle: a booking seat tab refuses delete',
     /seat/i.test(threw || ''), threw);

  // Reopen: settled comes back live; payments and the day's money hold still.
  const paidBefore = D.prepare(`SELECT COUNT(*) n FROM tab_payments WHERE tab_id=?`).get(closedTab.id).n;
  const reopened = pos.reopenTab(closedTab.id, { employee: 'Dana' });
  ok('lifecycle: closed tab reopens with status open and payments intact',
     reopened.status === 'open'
     && D.prepare(`SELECT COUNT(*) n FROM tab_payments WHERE tab_id=?`).get(closedTab.id).n === paidBefore
     && D.prepare(`SELECT closed_at FROM tabs WHERE id=?`).get(closedTab.id).closed_at === null, reopened);
  ok('lifecycle: reopened tab is in the open list again',
     pos.listOpenTabs().some(t => t.id === closedTab.id));
  threw = null;
  try { pos.reopenTab(closedTab.id, { employee: 'Dana' }); } catch (e) { threw = e.message; }
  ok('lifecycle: reopening an already-open tab refuses', /already open/i.test(threw || ''), threw);

  // Paid list: closed today shows with what was collected; voided never shows.
  pos.closeTab(closedTab.id, 'Dana');
  // the counter's day is the FACILITY's (Oct 2 2026): a UTC date is tomorrow every evening
  const today = require('./services/revenue').facilityToday();
  const paidList = pos.listClosedTabs(today);
  ok('lifecycle: paid list carries the settled tab with collected cents and methods',
     paidList.some(t => t.id === closedTab.id && Array.isArray(t.methods)), paidList.length);
  const voided = pos.openTab({ label: 'W3 VoidMe', employee: 'Dana' });
  pos.sendOrder(voided.id, [{ kind: 'custom', name: 'Test Beer', unit_price_cents: 650 }], 'Dana');
  pos.voidTab(voided.id, { reason: 'wrong table', employee: 'Dana' });
  ok('lifecycle: a voided check never appears in the paid list',
     !pos.listClosedTabs(today).some(t => t.id === voided.id));
  threw = null;
  try { pos.reopenTab(voided.id, { employee: 'Dana' }); } catch (e) { threw = e.message; }
  ok('lifecycle: a voided check cannot be reopened', /voided/i.test(threw || ''), threw);

  console.log('\u2500\u2500 ITEM MOVE + EARLY CHECK-IN (maintainer, Aug 13) \u2500\u2500');
{
  // Move a menu item between open tabs - the burger goes where it belongs.
  const mA = pos.openTab({ label: 'W3 MvA', employee: 'Dana' });
  const mB = pos.openTab({ label: 'W3 MvB', employee: 'Dana' });
  pos.sendOrder(mA.id, [{ kind: 'custom', name: 'W3 Burger', unit_price_cents: 1599, tax_category: 'food', printer_role: 'kitchen' }], 'Dana');
  const itm = pos.getTab(mA.id).items.find(x => x.name === 'W3 Burger');
  const mv = pos.moveItemToTab(mA.id, itm.id, mB.id, 'Dana');
  ok('move: the burger lands on the destination tab', mv.to.items.some(x => x.id === itm.id) && !mv.from.items.some(x => x.id === itm.id));
  ok('move: dues follow the item to the penny', mv.from.due_cents === 0 && mv.to.due_cents === 1599, { f: mv.from.due_cents, t: mv.to.due_cents });
  let threw = false; try { pos.moveItemToTab(mB.id, itm.id, mB.id, 'Dana'); } catch (e) { threw = true; }
  ok('move: same-tab move is refused', threw);
  pos.voidItem(itm.id, { comp: false, reason: 'test', employee: 'Dana' });
  threw = false; try { pos.moveItemToTab(mB.id, itm.id, mA.id, 'Dana'); } catch (e) { threw = true; }
  ok('move: a voided item cannot move', threw);

  // Early check-in: a booking two hours out checks in fine - the screen was
  // the only gate, never the server.
  const now = new Date(); const p2 = n => String(n).padStart(2, '0');
  const st = new Date(now.getTime() + 120 * 60000), en = new Date(now.getTime() + 180 * 60000);
  const hh = d => p2(d.getHours()) + ':' + p2(d.getMinutes());
  const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('w3-early','bay1','Bay 1','EarlyBird','5569000',?,?,?,?,60,6000,'active')`)
   .run(ymd(st), hh(st), hh(en), ymd(en));
  // W16 (Sep 1 2026): the server refuses unsigned seats under 'required' - staff attest paper, as they would at the counter
  const early = ck.performCheckin({ booking_id: 'w3-early', seats: [{ name: 'EarlyBird', waiver: { method: 'paper' } }, { name: 'Guest 2', waiver: { method: 'paper' } }], employee: 'Dana' });
  ok('early check-in: accepted two hours before start', early && early.status >= 200 && early.status < 300, early && early.status);
  const gv = ck.groupView('w3-early');
  ok('early check-in: the group opens with its seats', gv && Array.isArray(gv.seats) && gv.seats.length === 2, gv && gv.seats && gv.seats.length);
  D.prepare(`DELETE FROM bookings WHERE id='w3-early'`).run();
}

console.log(`\nWAVE D SEGMENT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
