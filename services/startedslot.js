// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/startedslot.js - A STARTED SLOT IS NOT FOR SALE (maintainer, Sep 27 2026)
//
// maintainer: "a customer cannot book or pay for a slot once it has started. The server refuses a started
// slot on every customer path: create, payment-intent creation, confirm, free-code and member-hours
// bookings, and an old checkout tab. If a payment still lands after the start, refund it
// automatically, cancel the booking, tell the customer, and log it. Staff pad, admin and walk-in
// bookings may still book a started slot (the customer is standing there), but show a plain warning
// of how many minutes have already passed."
//
// Until this, only the public page greyed a started slot out, in the browser; the server took a
// started time from any tab left open past the start, or any crafted request, at full price.
// "Started" is the unit's own clock and zone - the same reading of a booking's date and time the
// scheduler and the door window use - and a session has started AT its start minute.
'use strict';

function startMs(date, start_time) {
  return new Date(`${date}T${start_time}:00`).getTime();
}

/** Whole minutes since the session started - 0 at the start minute itself - or null when it has
 *  not started (or the time cannot be read, which is never taken for "started"). */
function startedMinsAgo(date, start_time, now = Date.now()) {
  const t = startMs(date, start_time);
  if (!Number.isFinite(t) || t > now) return null;
  return Math.floor((now - t) / 60000);
}

const REFUSAL = 'That time has already started, so it can no longer be booked online. Please choose a later start.';

/** The staff pad's plain warning: the booking goes ahead, the person at the counter is told. */
function staffWarning(mins) {
  if (mins === null || mins === undefined) return null;
  if (mins < 1) return 'This session is starting right now.';
  return `This session started ${mins} minute${mins === 1 ? '' : 's'} ago.`;
}

/** Did the payment land after the start? Read from the charge Stripe made - a confirm that
 *  arrives late for a charge made in time is a booking like any other. A charge that cannot be
 *  read is taken as after the start: the customer is refunded, never kept charged for a session
 *  the unit cannot show was bought in time (OPEN in DECISIONS, Sep 27 2026). */
async function landedAfterStart(stripeC, intent, booking) {
  const t = startMs(booking.date, booking.start_time);
  if (!Number.isFinite(t) || t > Date.now()) return { after: false, known: true };
  const lc = intent && intent.latest_charge;
  const chargeId = typeof lc === 'string' ? lc : (lc && lc.id) || booking.stripe_charge_id || '';
  let at = (lc && typeof lc === 'object' && lc.created) ? lc.created * 1000 : null;
  if (at === null && chargeId && stripeC) {
    try { const ch = await stripeC.charges.retrieve(chargeId); if (ch && ch.created) at = ch.created * 1000; } catch (e) {}
  }
  if (at === null) return { after: true, known: false, chargeId };
  return { after: at > t, known: true, at, chargeId };
}

/** What a checkout held - its discount or gift-card use, member credit it applied - goes back. */
function releaseHeld(row, why) {
  const D = require('./db').db;
  try { require('./pricing').releaseBookingCodes(row.id); } catch (e) {}
  try {
    const used = D.prepare(`SELECT member_id, COALESCE(SUM(-delta_cents),0) AS used FROM member_credit
      WHERE booking_id = ? AND reason = 'Applied to booking' GROUP BY member_id`).get(row.id);
    if (used && used.used > 0) {
      const already = D.prepare(`SELECT COUNT(*) AS c FROM member_credit WHERE booking_id = ? AND reason LIKE 'Restored%'`).get(row.id);
      if (!already || !already.c) D.prepare(`INSERT INTO member_credit (member_id, delta_cents, reason, booking_id) VALUES (?,?,?,?)`).run(used.member_id, used.used, 'Restored - ' + why, row.id);
    }
  } catch (e) {}
}

/** A payment that landed after the start: refund it, cancel the booking, tell the customer, log it.
 *  Only a checkout still waiting is touched. A refund Stripe refuses is logged as REFUND NEEDED
 *  (manual), and the booking - cancelled, charged, not refunded - is named on the Online checkout
 *  health line until a person refunds it. Returns { refunded, told }. */
// `taken` (Oct 3 2026, the pack review): the same refund for a slot SOLD to someone else while this customer's
// payment was still finishing on Klarna's, Affirm's or another provider's page - kept past the hold, the slot
// given back at it, and the customer back afterwards. Never activated: two paid groups for one bay.
async function refundStartedPayment(stripeC, booking, { source, chargeId, minsAgo, taken = false }) {
  const dbm = require('./db');
  const D = dbm.db;
  if (chargeId && !booking.stripe_charge_id) {
    try { D.prepare(`UPDATE bookings SET stripe_charge_id=? WHERE id=?`).run(chargeId, booking.id); } catch (e) {}
  }
  let refunded = false, why = '';
  try {
    if (!stripeC) throw new Error('Stripe is not configured on this unit');
    const opts = (chargeId || booking.stripe_charge_id) ? { charge: chargeId || booking.stripe_charge_id } : { payment_intent: booking.stripe_payment_intent };
    opts.metadata = require('./stripemark').marker();   // rule 25: ours
    const rf = await stripeC.refunds.create(opts, { idempotencyKey: (taken ? 'rf-taken-' : 'rf-started-') + booking.id });
    try { dbm.markRefunded(booking.id, null, rf, taken ? 'slot-taken' : 'started-slot'); } catch (e) {}
    refunded = true;
  } catch (e) { why = String(e && e.message || e).slice(0, 160); }
  D.prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=? AND status='pending_payment'`).run(booking.id);
  releaseHeld(booking, taken ? 'refunded - the slot was sold while the payment was finishing' : 'refunded - the payment went through after the session had started');
  const when = `${booking.date} ${booking.start_time} on ${booking.bay_name}`;
  const ago = minsAgo === null || minsAgo === undefined ? '' : ` (${minsAgo} min after the start)`;
  let told = null;
  // the whole row, whoever called: a caller's list may not carry the customer's email and phone
  let full = booking;
  try { full = D.prepare(`SELECT * FROM bookings WHERE id=?`).get(booking.id) || booking; } catch (e) {}
  if (refunded) {
    if (taken) dbm.adminLog('SLOT_TAKEN_REFUNDED', `Booking: ${booking.id} | ${booking.name} ${when} - the slot was sold to someone else while this payment was still finishing on the payment provider's page; refunded automatically and the booking cancelled (${source})`);
    else dbm.adminLog('STARTED_SLOT_REFUNDED', `Booking: ${booking.id} | ${booking.name} ${when} - the payment went through after the session had started${ago}; refunded automatically and the booking cancelled (${source})`);
    try {
      told = await require('./notifycancel').tellCustomerRefunded(full, taken
        ? 'that time was booked by someone else while your payment was still finishing, so it could not be held for you'
        : 'your payment went through after the session had already started, and a session that has started cannot be booked online');
    } catch (e) { dbm.adminLog('NOTIFY_FAILED', `Refunded booking ${booking.id} - the customer could not be told: ${String(e.message).slice(0, 120)}`); }
  } else {
    dbm.adminLog('REFUND NEEDED (manual)', `${booking.name} ${when} - ${taken ? 'paid for a slot sold to someone else while the payment was finishing' : 'paid after the session had started' + ago}; AUTOMATIC REFUND FAILED (${why}), refund by hand`);
    // the owner is told now, not only on the health line (the customer cancel's refused refund does the same)
    try { await Promise.race([require('./owneralert').alert('refund-failed:' + booking.id, `${booking.name} paid for ${when} ${taken ? 'after the slot had been sold to someone else' : 'after the session had started'}, and the automatic refund did not go through (${why}). Refund them in Stripe.`), new Promise(r => setTimeout(r, 10000))]); } catch (e) {}
  }
  return { refunded, told };
}

module.exports = { startedMinsAgo, staffWarning, landedAfterStart, refundStartedPayment, releaseHeld, REFUSAL };
