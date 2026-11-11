// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-payment-integrity.js — #18 async-capture: a succeeded payment must ALWAYS
// be refundable, even when stripe_charge_id was stored null because the charge
// attached after confirm. Guards all four refund sites + the confirm write.
// (pilot facility "Yolanda" incident, Aug 16 2026.)
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

  // ── #18a confirm must never store a null charge_id ─────────────────────────
  console.log('\u2500\u2500 #18a confirm never writes null charge_id \u2500\u2500');
  {
    const bk = fs.readFileSync(path.join(root, 'routes/bookings.js'), 'utf8');
    ok('confirm only writes stripe_charge_id when latest_charge is present',
       /if \(intent\.latest_charge\) \{[\s\S]{0,200}UPDATE bookings SET stripe_charge_id/.test(bk));
  }

  // ── #18b/c/d every refund site falls back to payment_intent ────────────────
  console.log('\u2500\u2500 #18b/c/d all refund sites fall back when charge_id is null \u2500\u2500');
  {
    const admin = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
    ok('admin refund uses charge OR payment_intent (never gated on charge alone)',
       admin.includes('{ payment_intent: piId }') && admin.includes('booking.stripe_payment_intent) && refundType'));
    ok('admin refund backfills a retrieved charge id',
       /intent\.latest_charge[\s\S]{0,160}UPDATE bookings SET stripe_charge_id/.test(admin));

    const cust = fs.readFileSync(path.join(root, 'routes/customer.js'), 'utf8');
    ok('customer refund falls back to payment_intent (was skipping on null charge)',
       cust.includes('payment_intent: booking.stripe_payment_intent') && cust.includes("idempotencyKey: 'rf-' + booking.id + '-customer'"));

    const edit = fs.readFileSync(path.join(root, 'services/bookingedit.js'), 'utf8');
    ok('staff-cancel refund falls back to payment_intent',
       edit.includes('{ payment_intent: booking.stripe_payment_intent }') && edit.includes('booking.stripe_payment_intent))'));
  }

  // ── idempotency on every refund (no double-refund on retry) ────────────────
  console.log('\u2500\u2500 refunds are idempotent \u2500\u2500');
  {
    for (const [f, label] of [['routes/admin.js','admin'],['routes/customer.js','customer'],['routes/bookings.js','customer-alt'],['services/bookingedit.js','staff']]) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      const hasKeys = (src.match(/idempotencyKey:/g) || []).length;
      ok(label + ' refund passes an idempotency key', hasKeys >= 1, { file: f, keys: hasKeys });
    }
  }

  // (Oct 23 2026, the battery audit - maintainer: "clean old tests up": three checks of a copy of the refund decision written inside this
  // battery are gone - they ran no product code. The refund sites themselves are read above, and refunds are driven for real by
  // test-refunds and the money gate's test-payments-sandbox.)

  console.log('\nPAYMENT INTEGRITY: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
