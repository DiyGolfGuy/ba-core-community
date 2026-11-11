// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-revenue-tax.js — the money surfaces the pilot facility rebase spec'd for golden.
// Tax shown on the booking form BEFORE the charge (#8); accountant-grade
// revenue reporting: real collected tax, Stripe fees, take-home, quarterly,
// day-of-week, remittance CSV (#9/#14/#10); UTC-correct timestamps (#12).
// All verified against a booted server with real seeded bookings.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

(async () => {
  const root = __dirname;
  const cfgPath = path.join(root, 'config.json');
  const dbPath = path.join(root, 'bookings.db');
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Battery Lounge', setup: { completed: true },
    tax: { enabled: true, rate: 10, label: 'Test Tax' },
    features: { memberships: false },
    booking: { staffedAccess: false, openTime: '08:00', closeTime: '23:00', pricePerHalfHour: 35 },
    bays: [{ id: 'bay1', name: 'Bay 1', active: true }],
    server: { port: 3097 }
  }));

  const db = require('./services/db');
  await db.initDb();
  const D = db.db;

  // ── #8: the shared tax helper the form AND the charge use ──────────────────
  console.log('\u2500\u2500 #8 tax on the booking form (shared quote) \u2500\u2500');
  {
    const pricing = require('./services/pricing');
    const q = pricing.quoteTax(7000);   // $70.00 pre-tax at 10%
    ok('#8: quoteTax returns subtotal, tax, total with the configured label',
       q.enabled && q.subtotal_cents === 7000 && q.tax_cents === 700 && q.total_cents === 7700 && q.label === 'Test Tax', q);
    ok('#8: the same rounding the charge uses (round, not floor/ceil)',
       pricing.quoteTax(516).tax_cents === Math.round(516 * 0.10));
    // form shows it: index.html renders Subtotal/Tax/Total rows
    const idx = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
    ok('#8: the booking form has Subtotal / Tax / Total rows wired to d.tax',
       idx.includes('sumSubtotalRow') && idx.includes('sumTaxRow') && idx.includes('taxInfo = d.tax'));
  }

  // ── #9/#14/#10: revenue reporting on REAL seeded bookings ──────────────────
  console.log('\u2500\u2500 #9/#14/#10 accountant revenue reporting \u2500\u2500');
  {
    const ins = (id, price, tax, pi, date) => D.prepare(`INSERT INTO bookings
      (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,'bay1','Bay 1','Cust '+id,'','',date,'14:00','15:00',date,60,price,tax,'completed',pi);
    // Two card-paid ($100 + $10 tax), one free (no PI, no tax). Dates: a Monday and a Saturday.
    ins('p1', 10000, 1000, 'pi_1', '2026-08-10');  // Monday
    ins('p2', 10000, 1000, 'pi_2', '2026-08-15');  // Saturday
    ins('f1', 0, 0, null, '2026-08-10');           // free, Monday
    db.save();

    // THE PRODUCT'S OWN FIGURES (Oct 2 2026, the cleanup audit). This block used to run the battery's own copy of
    // the SQL and the fee arithmetic, by booking date - the definition before rule 38 - and so graded the copy, not
    // services/revenue.js. Money is dated the day it moved (cash basis): these rows were written today, so the window
    // is the facility's today. (The busiest-days count is proven for real in test-revenue R13.)
    const rev = require('./services/revenue');
    const day = rev.facilityToday();
    const r = rev.report(day, day);
    ok('#9: the two card-paid sessions are the online money, tax included; the free one adds nothing', r.sessions_cents === 22000 && r.paid_count === 2, { sessions: r.sessions_cents, paid: r.paid_count });
    ok('#9: tax collected is the stored tax_cents (real, not reverse-engineered)', r.tax_cents === 2000, { tax: r.tax_cents });
    ok('#9: revenue is that money, and subtotal is it before tax', r.revenue_cents === 22000 && r.subtotal_cents === 20000, { revenue: r.revenue_cents, subtotal: r.subtotal_cents });
    ok('#9: Stripe fee = the configured 2.9% of online money + $0.30 per online charge (the free booking carries none)', r.stripe_fee_cents === Math.round(22000 * 0.029) + 2 * 30 && r.fee_percent === 2.9 && r.fee_fixed_cents === 30, { fee: r.stripe_fee_cents });
    ok('#9: take-home = revenue - every processor fee', r.take_home_cents === r.revenue_cents - r.stripe_fee_cents - r.inperson_fee_cents, { takeHome: r.take_home_cents });

    // admin.html surfaces
    const adm = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    ok('#9: Revenue tab has quarterly + last-month presets and a CSV export button',
       adm.includes('revPeriodQ3') && adm.includes('revPeriodLastmonth') && adm.includes('exportRevenueCsv'));
    ok('#9: Revenue tab shows Tax Collected, Stripe Fees, and Take-Home boxes',
       adm.includes('revTaxCollected') && adm.includes('revStripeFee') && adm.includes('revTakeHome'));
    ok('#10: MRR box hides itself when the server omits membership_mrr_cents',
       adm.includes('summary.membership_mrr_cents == null'));
  }

  // ── #12: UTC timestamps rendered as local ─────────────────────────────────
  console.log('\u2500\u2500 #12 UTC-correct timestamps \u2500\u2500');
  {
    const adm = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    ok('#12: fmtDbTime tags a bare SQLite timestamp as UTC before rendering local',
       adm.includes('function fmtDbTime') && adm.includes(".replace(' ', 'T') + 'Z'"));
    ok('#12: the admin log and waiver timestamps both use fmtDbTime',
       adm.includes('fmtDbTime(e.created_at)') && adm.includes('fmtDbTime(r.agreed_at)'));
  }

  // ── #ip in-person counter revenue + Terminal fees, shown here not just EOD ──
  console.log('\u2500\u2500 in-person counter revenue + combined totals \u2500\u2500');
  {
    const pos = require('./services/pos'); if (pos.ensureSchema) pos.ensureSchema();
    D.prepare("INSERT INTO tab_payments (id,tab_id,method,amount_cents,tip_cents,stripe_pi,created_at) VALUES ('ip1','tt1','card',20000,0,'pi_ip',datetime('now'))").run();
    D.prepare("INSERT INTO tab_payments (id,tab_id,method,amount_cents,tip_cents,stripe_pi,created_at) VALUES ('ip2','tt2','cash',5000,0,'',datetime('now'))").run();
    db.save();
    // the product's figures again (Oct 2 2026: this used to be the battery's own SQL and fee arithmetic)
    const ri = require('./services/revenue').report(require('./services/revenue').facilityToday(), require('./services/revenue').facilityToday());
    ok("in-person card sales are captured from tab_payments", ri.inperson_card_cents === 20000, { card: ri.inperson_card_cents });
    ok("in-person cash captured separately (no processor fee)", ri.inperson_cash_cents === 5000, { cash: ri.inperson_cash_cents });
    ok("Terminal fee is 2.7% + $0.05 per charge on in-person card, cash carries none", ri.inperson_fee_cents === Math.round(20000 * 0.027) + 5, { fee: ri.inperson_fee_cents });
    const adm = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
    ok("Revenue tab shows In-Person Counter Sales + Combined cards (not just EOD)",
       adm.includes("revIpCard") && adm.includes("revAllTakeHome") && adm.includes("Terminal Fees"));
    const rt = fs.readFileSync(path.join(root, "routes/admin.js"), "utf8");
    // Sep 23 2026: the CSV is money taken, line by line, then the summary by the one definition
    ok("the CSV report lists every payment and refund, the counter by method, fees and take-home, and what did not come in",
       rt.includes("Counter - card") && rt.includes("Counter - cash") && rt.includes("Estimated processor fees") && rt.includes("Take-home after estimated fees") &&
       rt.includes("REVENUE (money taken minus refunds)") && rt.includes("NOT REVENUE - what did not come in"));
  }

  console.log('\nREVENUE & TAX: ' + pass + ' passed, ' + fail + ' failed');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(dbPath); } catch {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
