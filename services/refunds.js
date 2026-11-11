// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/refunds.js - MONEY GIVEN BACK, WHEREVER IT WAS GIVEN BACK (maintainer, Sep 24 2026)
//
// "Refunds picked up from Stripe is the important one - an owner refunding in
//  Stripe's dashboard and the unit never knowing is the tax-time surprise we're
//  trying to prevent, and it affects online bookings too, not just the counter."
// Revenue is money taken minus refunds (rule 38). Until this file, the unit only
// knew about the refunds IT made: a refund an owner made in Stripe's dashboard -
// of an online booking, a counter card payment, a gift card or a membership
// payment - never came off anything, and the counter had no way to give money
// back at all (it refused to void a paid check and said "Refund it instead",
// with no refund anywhere).
//
// Two things live here:
//  1. THE COUNTER REFUND. Any staff member, with a reason, onto the owner's daily
//     review like a void (maintainer: "The person taking the money is the one standing
//     there when it goes back, and a manager isn't always on site. If it were
//     manager-only, staff would hand cash out of the drawer instead, which is
//     worse than a logged refund."). Card goes back through Stripe, cash out of
//     the drawer (End of Day expects less), a check is recorded. The payment it
//     came off is never changed.
//  2. THE PICKUP. Every refund Stripe knows about is matched to what it came
//     off - a booking, a counter card payment, a gift-card purchase, a membership
//     payment - and recorded once, by Stripe's own refund id. It arrives by the
//     webhook when there is one, and by a check that asks Stripe directly at boot,
//     every night and on the owner's Check now - never depending on the webhook
//     (a unit on a private network registers none). A refund on a payment that is
//     none of ours is left alone (rule 25).
//
// SOURCES - every Stripe shape used here, from Stripe's published OpenAPI spec
// (github.com/stripe/openapi, spec3.json, read Sep 24 2026) or its docs:
//  [R1] Refund object: id, amount ("Amount, in cents"), charge ("ID of the charge
//       that's refunded"), payment_intent ("ID of the PaymentIntent that's
//       refunded"), status ("pending, requires_action, succeeded, failed, or
//       canceled"), created (unix seconds), metadata, reason, failure_reason.
//  [R2] GET /v1/refunds - parameters charge, created (gt/gte/lt/lte), ending_before,
//       expand, limit, payment_intent, starting_after; a list with data + has_more.
//  [R3] POST /v1/refunds with payment_intent and an optional amount "as an integer
//       in cents" - docs.stripe.com/terminal/features/refunds (server-driven):
//       "To refund the customer's payment after the PaymentIntent has succeeded,
//       create a refund by passing in the PaymentIntent ID or the charge ID. You can
//       also optionally refund part of a payment by specifying an amount." and
//       "Online refunds are available on all card networks except for Interac."
//  [R4] Webhook event types (the spec's enabled_events enum): charge.refunded,
//       refund.created, refund.updated, refund.failed. refund.* carry a refund
//       object; charge.refunded a charge (charge.refunds is a list the event does
//       not expand, so the refunds are asked for by charge - [R2]).
//  [R5] GET /v1/invoice_payments - parameters include invoice and
//       payment[type] / payment[payment_intent]; an invoice_payment carries
//       `invoice` and `payment`. It is how a membership payment's invoice is found
//       from the PaymentIntent a refund names (a PaymentIntent has no invoice field
//       in the spec).
// ASSUMPTIONS - [A1] a refund Stripe reports `pending` is counted (money going
//  back that almost always completes); `failed` or `canceled` stops counting when
//  Stripe says so, `requires_action` waits for the next word. [A2] an account's
//  refunds of the last 400 days are enough on a unit's first check (the Revenue
//  tab's widest everyday view is a year).
'use strict';
const dbM = require('./db');

const COUNTS = ['succeeded', 'pending'];          // [A1] what counts as money given back
const FIRST_LOOKBACK_DAYS = 400;                   // [A2]
const OVERLAP_DAYS = 3;                            // each check re-reads the last three days - late webhooks, clocks, a missed night

function D() { return dbM.db; }
function cfg() { return require('./config').getConfig(); }
function billing() { return require('./membership-billing'); }
function stripeKey() { return (cfg().stripe && cfg().stripe.secretKey) || ''; }
function stripeIsLive() { const k = stripeKey(); return !!k && !k.startsWith('sk_mock') && !/^PASTE/.test(k); }
function isMock() { return stripeKey().startsWith('sk_mock'); }
const iso = unix => new Date((Number(unix) || Date.now() / 1000) * 1000).toISOString();
const usd = c => '$' + ((c | 0) / 100).toFixed(2);
function ensure() { try { require('./pos').ensureSchema(); } catch (e) {} }

// ── what has already gone back off a counter payment ──────────────────────
function refundedOff(paymentId) {
  ensure();
  const r = D().prepare(`SELECT COALESCE(SUM(amount_cents),0) a, COALESCE(SUM(tip_cents),0) t FROM tab_refunds
    WHERE payment_id = ? AND status IN ('succeeded','pending','requested')`).get(paymentId) || {};   // 'requested': a card refund on its way to Stripe - a second press cannot give back twice
  return { amount: r.a | 0, tip: r.t | 0 };
}
// how much of a counter payment can still go back: the sale first, then the tip
function refundable(payment) {
  const off = refundedOff(payment.id);
  const sale = Math.max(0, (payment.amount_cents | 0) - off.amount);
  const tip = Math.max(0, (payment.tip_cents | 0) - off.tip);
  return { sale, tip, total: sale + tip };
}
function split(payment, cents) {
  const left = refundable(payment);
  const sale = Math.min(cents, left.sale);
  return { amount: sale, tip: Math.min(cents - sale, left.tip) };
}

// ═══ 1. THE COUNTER REFUND ═════════════════════════════════════════════════
// Card, cash and check are money; member credit and gift-card payments are
// stored value and are not refunded as money here.
async function counterRefund({ tabId, paymentId, amountCents, reason, employee }) {
  ensure();
  const why = String(reason || '').trim();
  if (!why) throw new Error('Say why - a refund needs a reason, like a void.');
  const tab = D().prepare(`SELECT * FROM tabs WHERE id = ?`).get(tabId);
  if (!tab) throw new Error('tab not found');
  const p = D().prepare(`SELECT * FROM tab_payments WHERE id = ? AND tab_id = ?`).get(paymentId, tabId);
  if (!p) throw new Error('That payment is not on this tab.');
  if (!['card', 'cash', 'check'].includes(p.method)) throw new Error('Only card, cash and check payments are money that can go back.');
  const left = refundable(p);
  if (left.total <= 0) throw new Error('This payment has already been given back in full.');
  const want = amountCents == null || amountCents === '' ? left.total : Math.round(Number(amountCents));
  if (!Number.isFinite(want) || want <= 0) throw new Error('Enter an amount above zero.');
  if (want > left.total) throw new Error(`At most ${usd(left.total)} of this payment can go back.`);
  const part = split(p, want);
  const id = 'crf_' + require('crypto').randomBytes(8).toString('hex');
  const at = new Date().toISOString();
  const who = String(employee || 'Staff').slice(0, 60);
  D().prepare(`INSERT INTO tab_refunds (id, tab_id, payment_id, method, amount_cents, tip_cents, reason, employee, status, source, at)
    VALUES (?,?,?,?,?,?,?,?,?, 'counter', ?)`)
    .run(id, tabId, paymentId, p.method, part.amount, part.tip, why.slice(0, 200), who, p.method === 'card' ? 'requested' : 'succeeded', at);

  if (p.method === 'card') {
    // back through Stripe onto the card it was paid with [R3]
    if (!p.stripe_pi) { D().prepare(`UPDATE tab_refunds SET status='error', error=? WHERE id=?`).run('no card payment id recorded', id); throw new Error('This card payment has no Stripe record to refund against - give it back another way and write down why.'); }
    let rf;
    try {
      if (isMock()) rf = { id: 're_mock_' + id.slice(4), status: 'succeeded', amount: want };
      else {
        if (!stripeIsLive()) throw new Error('Stripe is not set up on this unit.');
        rf = await billing().stripeCall('POST', '/refunds', Object.assign({ payment_intent: p.stripe_pi, amount: want, reason: 'requested_by_customer',
          metadata: Object.assign({}, require('./stripemark').marker(), { ba_counter_refund: id, tab_id: tabId, payment_id: paymentId }) }));
      }
    } catch (e) {
      D().prepare(`UPDATE tab_refunds SET status='error', error=? WHERE id=?`).run(String(e.message).slice(0, 200), id);
      try { dbM.adminLog('COUNTER_REFUND_FAILED', `${usd(want)} card on "${tab.label}" by ${who}: Stripe said ${e.message}`); } catch {}
      throw new Error('Stripe did not take the refund: ' + e.message);
    }
    D().prepare(`UPDATE tab_refunds SET stripe_refund_id=?, status=? WHERE id=?`).run(rf.id, rf.status || 'pending', id);
  } else if (p.method === 'cash') {
    // the drawer opens when one is wired, like a cash sale
    try { const pos = require('./pos'); if (pos.posCfg(cfg()).drawer.enabled) pos.openDrawer({ employee: who, reason: 'cash refund', txn_id: id }); } catch (e) {}
  }
  const row = D().prepare(`SELECT * FROM tab_refunds WHERE id=?`).get(id);
  // the sale's tax given back with it, at a facility on Stripe Tax (Oct 3 2026): the sale part only - a tip carries no tax
  if (part.amount > 0) { try { require('./pos').stxReverse(tabId, 'rev-' + id, part.amount); } catch (e) {} }
  try { dbM.adminLog('COUNTER_REFUND', `${usd(want)} ${p.method} back on "${tab.label}" by ${who}: ${why.slice(0, 120)}${row.status === 'pending' ? ' (Stripe: pending)' : ''}`); } catch {}
  return { refund: row, tab: require('./pos').getTab(tabId) };
}

// ═══ 2. THE PICKUP ═════════════════════════════════════════════════════════
// One Stripe refund [R1], recorded once against whatever it came off.
async function recordStripeRefund(rf, via) {
  ensure();
  if (!rf || !rf.id || String(rf.object || 'refund') !== 'refund') return { ignored: 'not a refund' };
  const pi = typeof rf.payment_intent === 'string' ? rf.payment_intent : (rf.payment_intent && rf.payment_intent.id) || '';
  const ch = typeof rf.charge === 'string' ? rf.charge : (rf.charge && rf.charge.id) || '';
  const status = String(rf.status || 'succeeded');
  const at = iso(rf.created);
  const amount = rf.amount | 0;
  const mine = rf.metadata && rf.metadata.ba_counter_refund;

  // Status only: Stripe changed its mind about a refund we already hold [A1].
  const heldBooking = D().prepare(`SELECT id, status FROM refunds WHERE id = ?`).get(rf.id);
  const heldCounter = D().prepare(`SELECT id, status FROM tab_refunds WHERE stripe_refund_id = ?`).get(rf.id)
    || (mine ? D().prepare(`SELECT id, status FROM tab_refunds WHERE id = ?`).get(mine) : null);
  if (heldBooking || heldCounter) {
    let changed = false;
    if (heldBooking && heldBooking.status !== status) { D().prepare(`UPDATE refunds SET status=? WHERE id=?`).run(status, rf.id); changed = true; }
    if (heldCounter && (heldCounter.status !== status || mine)) {
      D().prepare(`UPDATE tab_refunds SET status=?, stripe_refund_id=? WHERE id=?`).run(status, rf.id, heldCounter.id);
      changed = changed || heldCounter.status !== status;
    }
    if (changed && !COUNTS.includes(status)) { try { dbM.adminLog('STRIPE_REFUND_NOT_COMPLETED', `${usd(amount)} refund ${rf.id} is now ${status}${rf.failure_reason ? ' (' + rf.failure_reason + ')' : ''} - it no longer comes off revenue`); } catch {} }
    return { already: true, changed };
  }
  if (!COUNTS.includes(status)) return { waiting: status };    // requires_action: the next word decides; failed/canceled: nothing went back

  // a booking paid online
  const b = (pi && D().prepare(`SELECT id, name, date, start_time, price_cents FROM bookings WHERE stripe_payment_intent = ?`).get(pi))
    || (ch && D().prepare(`SELECT id, name, date, start_time, price_cents FROM bookings WHERE stripe_charge_id = ?`).get(ch));
  if (b) {
    dbM.markRefunded(b.id, at, rf, 'stripe-' + (via || 'check'));
    D().prepare(`UPDATE refunds SET kind='booking', status=?, payment_intent=? WHERE id=?`).run(status, pi, rf.id);
    if (!(rf.metadata && rf.metadata.ba_owner)) { try { dbM.adminLog('STRIPE_REFUND_RECORDED', `${usd(amount)} refunded in Stripe for the ${b.date} ${b.start_time} booking (${b.id}) - it now comes off revenue`); } catch {} }
    return { recorded: 'booking', booking: b.id };
  }
  // a counter card payment
  const p = pi && D().prepare(`SELECT * FROM tab_payments WHERE stripe_pi = ?`).get(pi);
  if (p) {
    const part = split(p, amount);
    const id = 'crf_' + require('crypto').randomBytes(8).toString('hex');
    D().prepare(`INSERT INTO tab_refunds (id, tab_id, payment_id, method, amount_cents, tip_cents, reason, employee, stripe_refund_id, status, source, at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'stripe', ?)`)
      .run(id, p.tab_id, p.id, p.method, part.amount, part.tip, 'Refunded in Stripe' + (rf.reason ? ' (' + String(rf.reason).replace(/_/g, ' ') + ')' : ''), 'Stripe', rf.id, status, at);
    // ...and its tax given back with it, at a facility on Stripe Tax (Oct 3 2026) - a refund that did not go through takes nothing back
    if (part.amount > 0 && status !== 'failed' && status !== 'canceled') { try { require('./pos').stxReverse(p.tab_id, 'rev-' + rf.id, part.amount); } catch (e) {} }
    const t = D().prepare(`SELECT label FROM tabs WHERE id=?`).get(p.tab_id) || {};
    try { dbM.adminLog('STRIPE_REFUND_RECORDED', `${usd(amount)} refunded in Stripe off a counter card payment on "${t.label || p.tab_id}" - it now comes off revenue and is on the daily review`); } catch {}
    return { recorded: 'counter', payment: p.id };
  }
  // a gift card bought online (the card keeps the intent that paid for it: gifts.createGiftCard issuedBy)
  if (pi) {
    const g = D().prepare(`SELECT id, code, value, active, description FROM discount_codes WHERE type='gift' AND description LIKE ?`).all('%' + pi + '%')
      .find(x => { try { return JSON.parse(x.description || '{}').issuedBy === pi; } catch { return false; } });
    if (g) {
      D().prepare(`INSERT OR IGNORE INTO refunds (id, booking_id, amount_cents, at, source, kind, ref, status, payment_intent) VALUES (?, '', ?, ?, ?, 'gift', ?, ?, ?)`)
        .run(rf.id, amount, at, 'stripe-' + (via || 'check'), g.id, status, pi);
      const back = (D().prepare(`SELECT COALESCE(SUM(amount_cents),0) c FROM refunds WHERE kind='gift' AND ref=? AND status IN ('succeeded','pending')`).get(g.id) || {}).c | 0;
      const whole = back >= Math.round(Number(g.value || 0) * 100);
      // A card whose purchase went back in full must not stay spendable; a partial
      // refund leaves the card as it is and says so (the owner decides).
      if (whole && g.active) D().prepare(`UPDATE discount_codes SET active=0 WHERE id=?`).run(g.id);
      try { dbM.adminLog('GIFTCARD_REFUNDED', `${usd(amount)} of gift card …${String(g.code).slice(-4)} refunded in Stripe - ${whole ? 'the whole purchase, so the card is switched off' : 'part of it; the card still holds its full value until you change it'}`); } catch {}
      return { recorded: 'gift', card: g.id };
    }
  }
  // a membership payment (found through the invoice the payment paid [R5])
  if (pi && !isMock() && stripeIsLive()) {
    let inv = null;
    try {
      const r = await billing().stripeCall('GET', '/invoice_payments?' + new URLSearchParams({ 'payment[type]': 'payment_intent', 'payment[payment_intent]': pi, limit: '1' }).toString());
      inv = r && r.data && r.data[0] && (typeof r.data[0].invoice === 'string' ? r.data[0].invoice : r.data[0].invoice && r.data[0].invoice.id);
    } catch (e) { inv = null; }
    const mp = inv && D().prepare(`SELECT invoice_id, member_id FROM membership_payments WHERE invoice_id = ?`).get(inv);
    if (mp) {
      D().prepare(`INSERT OR IGNORE INTO refunds (id, booking_id, amount_cents, at, source, kind, ref, status, payment_intent) VALUES (?, '', ?, ?, ?, 'membership', ?, ?, ?)`)
        .run(rf.id, amount, at, 'stripe-' + (via || 'check'), inv, status, pi);
      const m = D().prepare(`SELECT name FROM members WHERE id=?`).get(mp.member_id) || {};
      try { dbM.adminLog('STRIPE_REFUND_RECORDED', `${usd(amount)} of a membership payment refunded in Stripe${m.name ? ' (' + m.name + ')' : ''} - it now comes off revenue`); } catch {}
      return { recorded: 'membership', invoice: inv };
    }
  }
  return { foreign: true };   // a payment none of ours made - left alone (rule 25)
}

// charge.refunded [R4]: the refunds are asked for by charge [R2]
async function recordChargeRefunds(charge, via) {
  if (!charge || !charge.id || isMock() || !stripeIsLive()) return { skipped: true };
  const r = await billing().stripeCall('GET', '/refunds?' + new URLSearchParams({ charge: charge.id, limit: '100' }).toString());
  const out = [];
  for (const rf of (r && r.data) || []) out.push(await recordStripeRefund(rf, via));
  return { refunds: out.length, out };
}

// THE CHECK: every refund in the account since the last check (less an overlap),
// page by page [R2]. At boot, every night and on the owner's Check now.
let _last = null;
function lastCheck() { return _last || (cfg().stripe && cfg().stripe.refundsCheck) || null; }
async function checkStripe({ now = Date.now() } = {}) {
  const out = { at: new Date(now).toISOString(), checked: 0, recorded: 0, updated: 0, foreign: 0, error: null, skipped: false };
  // Rule 31: a unit with no Stripe key has no refunds to find - never an error
  if (isMock() || !stripeIsLive()) { out.skipped = true; _last = out; return out; }
  ensure();
  const prev = cfg().stripe && cfg().stripe.refundsCheck;
  const sinceMs = prev && prev.through ? Date.parse(prev.through) - OVERLAP_DAYS * 86400000 : now - FIRST_LOOKBACK_DAYS * 86400000;
  const gte = Math.floor(Math.max(sinceMs, now - FIRST_LOOKBACK_DAYS * 86400000) / 1000);
  try {
    let after = null;
    for (let page = 0; page < 200; page++) {
      const q = { 'created[gte]': String(gte), limit: '100' }; if (after) q.starting_after = after;
      const r = await billing().stripeCall('GET', '/refunds?' + new URLSearchParams(q).toString());
      const list = (r && r.data) || [];
      for (const rf of list) {
        out.checked++;
        const res = await recordStripeRefund(rf, 'check');
        if (res.recorded) out.recorded++; else if (res.changed) out.updated++; else if (res.foreign) out.foreign++;
      }
      if (!r || !r.has_more || !list.length) break;
      after = list[list.length - 1].id;
    }
    try { const c = require('./config'); const all = c.getConfig(); all.stripe = Object.assign({}, all.stripe, { refundsCheck: { through: out.at, checked: out.checked, recorded: out.recorded } }); c.saveConfig(all); } catch (e) {}
    try { await dbM.flushed(); } catch (e) {}
  } catch (e) { out.error = String(e.message || e).slice(0, 200); }
  if (out.recorded || out.updated || out.error) { try { dbM.adminLog('STRIPE_REFUNDS_CHECKED', `${out.checked} refund(s) in Stripe looked at, ${out.recorded} new, ${out.updated} changed${out.error ? ' - could not finish: ' + out.error : ''}`); } catch {} }
  _last = out;
  return out;
}

// ═══ the owner's daily review ═════════════════════════════════════════════
function reviewList(date) {
  ensure();
  // the facility's day, not the UTC date (Oct 2026 - services/pos.js "THE COUNTER'S DAY"; test-facility-day)
  const rv = require('./revenue');
  const d = date || rv.localDate(new Date().toISOString(), rv.tzOf());
  const [u0, u1] = rv.utcWindow(d, d);
  return D().prepare(`SELECT r.*, t.label tab_label, t.bay_name FROM tab_refunds r LEFT JOIN tabs t ON t.id = r.tab_id
    WHERE r.at >= ? AND r.at < ? ORDER BY r.at`).all(u0, u1).filter(r => rv.localDate(r.at, rv.tzOf()) === d);
}
function checkReview(id, reviewer) {
  ensure();
  D().prepare(`UPDATE tab_refunds SET reviewed=1, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`).run(String(reviewer || 'Owner').slice(0, 60), id);
  const row = D().prepare(`SELECT reviewed FROM tab_refunds WHERE id=?`).get(id);
  return !!row && row.reviewed === 1;
}
function forTab(tabId) {
  ensure();
  return D().prepare(`SELECT * FROM tab_refunds WHERE tab_id = ? ORDER BY at`).all(tabId);
}

module.exports = { counterRefund, refundable, recordStripeRefund, recordChargeRefunds, checkStripe, lastCheck, reviewList, checkReview, forTab, COUNTS };
