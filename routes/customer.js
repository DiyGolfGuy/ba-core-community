// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/customer.js  —  Customer Account Routes
//
//  No traditional login — customers look up bookings by phone number.
//  A 6-digit PIN is texted to verify identity, then they can cancel
//  any booking that is >24 hours away.
//
//  Endpoints:
//    POST /api/customer/request-pin   { phone }           → texts a PIN
//    POST /api/customer/verify-pin    { phone, pin }      → returns bookings
//    POST /api/customer/cancel        { phone, pin, bookingId } → cancel
// ═══════════════════════════════════════════════════════════════════════════════

const express        = require('express');
const { randomInt }  = require('node:crypto');
const router         = express.Router();
const { db, adminLog }         = require('../services/db');
const { sendVerificationCode, sendCancellation } = require('../services/sms');
const { sendEmail, sendCancellationEmail } = require('../services/email');
const { revokeDoorCode }       = require('../services/doorlock');
const { getConfig }            = require('../services/config');
const { stripeClient }        = require('../services/stripeclient');

// In-memory PIN store { phone/email: { pin, expires } }
// Pins expire after 10 minutes
const pinStore = Object.create(null);

function generatePin() {
  return String(randomInt(100000, 1000000));
}

function normalizePhone(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return `+${d}`;
}

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

// ── POST /api/customer/request-pin ───────────────────────────────────────────
// Supports phone (SMS) or email as identifier
router.post('/request-pin', async (req, res) => {
  const { phone, email } = req.body || {};
  if ((phone !== undefined && (typeof phone !== 'string' || phone.length > 32)) ||
      (email !== undefined && (typeof email !== 'string' || email.length > 254)) ||
      (!phone?.trim() && !email?.trim())) {
    return res.status(400).json({ error: 'Enter a valid phone number or email.' });
  }

  const cfg = getConfig();
  const pin     = generatePin();
  const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

  if (email) {
    // Email-based lookup
    const key = email.toLowerCase().trim();
    // the code the customer already holds stays good unless the new one actually reaches them
    // (Sep 25 2026, the Monday review: a failed Resend replaced it with one nobody received)
    const before = pinStore[key];
    const keepOld = () => { if (before) pinStore[key] = before; else delete pinStore[key]; };
    pinStore[key] = { pin, expires, type: 'email' };

    try {
      // THE ANSWER IS READ (Sep 25 2026, the pilot facility handoff: "a failed text or email still
      // answered 'PIN sent'"). The text path already read it; the email path told the
      // customer "sent" when the email failed, or when this unit sends no email at all.
      const sent = await sendEmail({
        to:      key,
        subject: `${cfg.server.businessName} — Your verification code`,
        text:    `Your verification code: ${pin}

Valid for 10 minutes. Do not share this code.

${cfg.server.businessName}`
      });
      if (sent === undefined) {
        adminLog('CUSTOMER_PIN_NOT_SENT', `Email: ${key} - this unit does not send email`);
        keepOld();
        return res.status(400).json({ error: 'This unit cannot email a code. Use your phone number instead.' });
      }
      if (sent !== true) {
        adminLog('CUSTOMER_PIN_FAILED', `Email: ${key}`);
        keepOld();
        // 503, not 502: Cloudflare shows its own page in place of an origin's 502, and the
        // customer would read "server error" instead of what to do
        return res.status(503).json({ error: 'The code could not be sent. Try your phone number instead.' });
      }
      adminLog('CUSTOMER_PIN_SENT', `Email: ${key}`);
      res.json({ success: true, message: 'Verification code sent to your email.' });
    } catch (err) {
      keepOld();
      res.status(500).json({ error: 'Could not send email. Please try again.' });
    }
  } else {
    // Phone-based lookup
    const normalized = normalizePhone(phone);
    const before = pinStore[normalized];
    const keepOld = () => { if (before) pinStore[normalized] = before; else delete pinStore[normalized]; };
    pinStore[normalized] = { pin, expires, type: 'phone' };

    try {
      const sent = await sendVerificationCode(normalized, pin);
      if (sent === undefined) {
        adminLog('CUSTOMER_PIN_NOT_SENT', `Phone: ${normalized} - texting is not available for this number`);
        keepOld();
        return res.status(400).json({ error: 'This unit cannot text that number. Use your email address instead.' });
      }
      if (sent === false || (sent && sent.success === false)) {
        adminLog('CUSTOMER_PIN_FAILED', `Phone: ${normalized}`);
        keepOld();
        return res.status(503).json({ error: 'The code could not be sent. Try using your email address instead.' });
      }
      adminLog('CUSTOMER_PIN_SENT', `Phone: ${normalized}`);
      res.json({ success: true, message: 'PIN sent to your phone.' });
    } catch (err) {
      keepOld();
      res.status(500).json({ error: 'Could not send SMS. Try using your email address instead.' });
    }
  }
});

// ── POST /api/customer/verify-pin ────────────────────────────────────────────
router.post('/verify-pin', (req, res) => {
  const { phone, email, pin } = req.body;
  if ((!phone && !email) || !pin) return res.status(400).json({ error: 'Phone or email and PIN required.' });

  const key    = email ? email.toLowerCase().trim() : normalizePhone(phone);
  const stored = pinStore[key];

  if (!stored) return res.status(401).json({ error: 'No PIN requested. Please request a new one.' });
  if (Date.now() > stored.expires) {
    delete pinStore[key];
    return res.status(401).json({ error: 'PIN expired. Please request a new one.' });
  }
  if (stored.pin !== String(pin).trim()) {
    // Five wrong codes and the code is gone (Sep 6 2026) - a guesser starts over
    // and the customer's phone gets a fresh one. String(pin): a numeric body
    // used to crash the route (pin.trim is not a function).
    stored.tries = (stored.tries || 0) + 1;
    if (stored.tries >= 5) {
      delete pinStore[key];
      adminLog('CUSTOMER_PIN_LOCKED', `${email ? 'Email' : 'Phone'}: ${key} | 5 wrong codes - code destroyed`);
      return res.status(429).json({ error: 'Too many wrong codes. Please request a new one.' });
    }
    return res.status(401).json({ error: 'Incorrect PIN.' });
  }

  // Look up bookings by email OR phone
  const bookings = email
    ? require('../services/db').db.prepare(
        `SELECT id, bay_name, date, start_time, end_time, duration_minutes, price_cents, status, door_code, sms_code_sent, created_at, is_deposit, member_id, member_due_cents, stripe_payment_intent, package_name, package_json, deal_name, deal_cents, deal_items_json, discount_code_id
         FROM bookings WHERE lower(trim(email)) = ? AND status IN ('active','completed') ORDER BY date DESC, start_time DESC`
      ).all(key)
    : require('../services/db').db.prepare(
        `SELECT id, bay_name, date, start_time, end_time, duration_minutes, price_cents, status, door_code, sms_code_sent, created_at, is_deposit, member_id, member_due_cents, stripe_payment_intent, package_name, package_json, deal_name, deal_cents, deal_items_json, discount_code_id
         FROM bookings WHERE phone = ? AND status IN ('active','completed') ORDER BY date DESC, start_time DESC`
      ).all(key);

  const now = new Date();
  const windowHours = cancelWindowHours();
  // THE CODE SHOWS FROM ITS TEXT MOMENT (Oct 4 2026): codes are on the lock an hour before (maintainer's ruling) and a Home
  // Assistant code works from then - this page handed it out the moment it existed, forty-five minutes before the text
  const textLead = (() => { try { return require('../services/doorlock').effectiveTextLeadMins(); } catch { return 15; } })();
  // (a package deal: what it includes, in words, from the booking's own copy - never the copy itself; Oct 22 2026)
  const enriched = bookings.map(({ sms_code_sent, package_json, deal_items_json, discount_code_id, ...b }) => {
    try { const snap = package_json ? JSON.parse(package_json) : null; if (snap) b.package_includes = (snap.includes || []).map(x => require('../services/deals').howMany(x.name, x.qty, x.kind)).join(', '); } catch {}
    // a code checked at the door: what they bring (Oct 23 2026)
    try { const c = require('../services/pricing').doorCheckOf({ discount_code_id }); if (c) b.door_check = `${c.check} - it is checked at the front desk (${c.code})`; } catch {}
    // free things a deal gave it, in words - picked up at the front desk (Oct 22 2026, night)
    try { const line = require('../services/deals').itemsLine({ deal_items_json }); if (line) b.free_items = line; } catch {}
    const startDt    = new Date(`${b.date}T${b.start_time}:00`);
    const hoursUntil = (startDt - now) / 3600000;
    const codeDue    = sms_code_sent === 1 || !(startDt.getTime() - now.getTime() > textLead * 60000);
    // !(x > w), not x <= w: a start time that cannot be read is NaN and must never read as cancellable
    return { ...b, door_code: codeDue ? b.door_code : null, cancellable: hoursUntil > windowHours, hoursUntil: Math.round(hoursUntil) };
  });

  adminLog('CUSTOMER_VERIFIED', `${email ? 'Email' : 'Phone'}: ${key} | ${enriched.length} booking(s)`);
  res.json({ success: true, bookings: enriched, identifier: key, type: stored.type, cancelWindowHours: windowHours });
});

// The owner's cancellation window (Settings > Booking) - the one number staff moves and
// cancels are already held to (services/bookingedit.js). Default 24.
function cancelWindowHours() {
  const v = (getConfig().cancellationPolicy || {}).windowHours;
  const n = Number(v);
  return (v === 0 || (v !== undefined && v !== null && v !== '')) && Number.isFinite(n) && n >= 0 ? n : 24;
}
// what /my-booking tells a customer before they sign in - nothing about any person (rule 37)
router.get('/policy', (req, res) => res.json({ cancelWindowHours: cancelWindowHours() }));

// ── POST /api/customer/cancel ─────────────────────────────────────────────────
// ONE CANCEL PER BOOKING AT A TIME (Oct 2026, from the pilot facility handoff's Part 2). Two quick taps on Cancel
// both passed the "already cancelled" check before either had finished its refund, so both texted and
// emailed the customer that the booking was cancelled (the idempotency key kept the refund single). The
// unit is one process, so a claim on the booking id held for the whole cancel closes the race; the second
// tap is told the cancel is already under way. The status is read again, after every await, right
// before the booking is marked cancelled - a staff or owner cancel in between means no second message.
// the one claim every cancel path holds - the customer's, the staff pad's and the owner's (services/bookingedit)
const CANCELLING = require('../services/bookingedit').CANCELLING;
router.post('/cancel', async (req, res) => {
  const { phone, email, pin, bookingId } = req.body;
  if ((!phone && !email) || !pin || !bookingId) return res.status(400).json({ error: 'Phone or email, PIN and bookingId required.' });

  const key    = email ? email.toLowerCase().trim() : normalizePhone(phone);
  const stored = pinStore[key];

  // Re-verify PIN
  if (!stored || Date.now() > stored.expires || stored.pin !== String(pin).trim()) {
    if (stored && stored.pin !== String(pin).trim()) {
      stored.tries = (stored.tries || 0) + 1;
      if (stored.tries >= 5) { delete pinStore[key]; adminLog('CUSTOMER_PIN_LOCKED', `${email ? 'Email' : 'Phone'}: ${key} | 5 wrong codes - code destroyed`); }
    }
    return res.status(401).json({ error: 'Invalid or expired PIN. Please start over.' });
  }

  const booking = email
    ? require('../services/db').db.prepare(`SELECT * FROM bookings WHERE id = ? AND lower(trim(email)) = ?`).get(bookingId, key)   // an email is never case-sensitive (Sep 25 2026)
    : require('../services/db').db.prepare(`SELECT * FROM bookings WHERE id = ? AND phone = ?`).get(bookingId, key);
  if (!booking)                       return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'cancelled') return res.status(400).json({ error: 'Already cancelled.' });
  if (CANCELLING.has(booking.id))     return res.status(409).json({ error: 'This booking is already being cancelled - one moment.', inProgress: true });
  CANCELLING.add(booking.id);
  try { return await cancelOne(req, res, booking); }
  finally { CANCELLING.delete(booking.id); }
});
async function cancelOne(req, res, booking) {

  // THE OWNER'S WINDOW, NOT A FIXED 24 HOURS (maintainer, Sep 25 2026 - the same number staff moves
  // and cancels are held to, Settings > Booking > Cancellation window). And !(x > w), never
  // x <= w: a start time that cannot be read is NaN, and NaN <= 24 is false - such a booking
  // slipped past the check and was refunded in full (the pilot facility handoff section 3).
  const windowHours = cancelWindowHours();
  const startDt    = new Date(`${booking.date}T${booking.start_time}:00`);
  const hoursUntil = (startDt - new Date()) / 3600000;
  if (!(hoursUntil > windowHours)) {
    return res.status(403).json({
      error: Number.isFinite(hoursUntil)
        ? `Cancellations must be made more than ${windowHours} hours before your session. Your session starts in ${Math.max(0, Math.round(hoursUntil))} hours.`
        : 'This booking cannot be cancelled online. Please contact the facility.'
    });
  }

  // Stripe refund — full refund for customer cancels outside 24 hours
  const cfg    = getConfig();
  const sk = cfg.stripe?.secretKey || '';
  const stripe = sk && !sk.startsWith('PASTE') ? stripeClient(sk) : null;

  let refunded = false, refundFailed = '', alreadyRefunded = false, ownerTold = false, chargeId = null;
  if (stripe && booking.stripe_payment_intent && booking.price_cents > 0) {
    try {
      // #18c async-capture resilience (same latent bug as the admin path): this
      // used to refund ONLY when intent.latest_charge was present and silently do
      // nothing when null. Refund by the charge if present (backfilling the row),
      // otherwise by payment_intent, so a succeeded payment always refunds. The
      // idempotency key stops a retry from double-refunding.
      const intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent);
      chargeId = booking.stripe_charge_id || (intent && intent.latest_charge) || null;
      if (chargeId && !booking.stripe_charge_id) {
        try { require('../services/db').db.prepare(`UPDATE bookings SET stripe_charge_id=? WHERE id=?`).run(chargeId, booking.id); } catch {}
      }
      const refundOpts = Object.assign(chargeId ? { charge: chargeId, reason: 'requested_by_customer' } : { payment_intent: booking.stripe_payment_intent, reason: 'requested_by_customer' }, { metadata: require('../services/stripemark').marker() });
      const rf = await stripe.refunds.create(refundOpts, { idempotencyKey: 'rf-' + booking.id + '-customer' });
      refunded = true;
      try { require('../services/db').markRefunded(booking.id, null, rf, 'customer-cancel'); } catch (e) {}
      adminLog('STRIPE_REFUND', `Booking: ${booking.id} | Customer cancel | $${(booking.price_cents/100).toFixed(2)} | via ${chargeId ? 'charge' : 'payment_intent'}`);
    } catch (err) {
     // MONEY ALREADY GIVEN BACK IS NOT A FAILED REFUND (Sep 25 2026, the build review): the owner
     // refunded in Stripe's dashboard first, and the customer then cancelled here - they were told the
     // facility "will refund you" and the owner was texted to refund money already returned. Stripe's
     // own refund is recorded now (rule 39's pickup, for this charge) and the customer told the truth.
     if (err && (err.code === 'charge_already_refunded' || /already been refunded/i.test(String(err.message || '')))) {
      alreadyRefunded = true; refunded = true;
      adminLog('STRIPE_REFUND', `Booking: ${booking.id} | Customer cancel | $${(booking.price_cents/100).toFixed(2)} | already refunded in Stripe`);
      try { if (chargeId) await require('../services/refunds').recordChargeRefunds({ id: chargeId }, 'customer-cancel'); } catch (e) {}
     } else {
      // A REFUND THAT FAILED IS SAID (Sep 25 2026, the pilot facility handoff section 3): it was written to
      // the console only - the booking cancelled, the customer's money kept, nobody told. Now the
      // owner's log names it (the Online checkout health line reads that line), the owner is
      // texted and emailed, and the customer is told the truth below.
      refundFailed = String(err && err.message || err).slice(0, 160);
      console.error('Refund error:', refundFailed);
      adminLog('CUSTOMER_REFUND_FAILED', `Booking: ${booking.id} | $${(booking.price_cents / 100).toFixed(2)} | ${booking.name} | Stripe said: ${refundFailed}`);
      try {
        const told = await Promise.race([require('../services/owneralert').alert('refund-failed:' + booking.id, `${booking.name} cancelled their ${booking.bay_name} session on ${booking.date} online, but the $${(booking.price_cents / 100).toFixed(2)} refund did not go through (${refundFailed.slice(0, 100)}). Refund them in Stripe.`), new Promise(r => setTimeout(() => r(null), 10000))]);
        ownerTold = !!(told && (told.text === 'sent' || told.email === 'sent'));
      } catch {}
     }
    }
  }

  // Revoke door access if already generated
  // a refusal is logged against this booking and retried now, never thrown away (doorlock.revokeOnCancel)
  if (booking.remotelock_person_id) await require('../services/doorlock').revokeOnCancel(booking, 'the customer');

  // read again after the awaits above: cancelled meanwhile by staff or the owner - their cancel told the customer
  const nowStatus = (require('../services/db').db.prepare(`SELECT status FROM bookings WHERE id=?`).get(booking.id) || {}).status;
  if (nowStatus === 'cancelled') return res.json({ success: true, refunded, refundFailed: !!refundFailed, alreadyCancelled: true });
  require('../services/db').db.prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(booking.id);
  try { require('../services/pricing').releaseBookingCodes(booking.id); } catch (e) { console.error('code release:', e.message); }
  // A MEMBER'S OWN CANCEL GIVES BACK WHAT THE BOOKING HELD (Oct 25 2026, the review): this cancel only set the status, so a member
  // who cancelled on /my-booking kept the free hour counted as used (their next booking that month was charged - rule 3, free time
  // first), their guest passes spent and any member credit the booking applied gone. Given back exactly as the owner's cancel
  // (routes/admin.js) and the staff pad's (services/bookingedit.js) give it back: the usage and guest-pass rows go, and the credit
  // comes back once, as 'Restored - booking cancelled' (services/startedslot.releaseHeld - the helper the late-payment refund uses;
  // its own code release finds nothing more to give back after the line above).
  if (booking.member_id) {
    try {
      require('../services/db').db.prepare(`DELETE FROM member_usage WHERE booking_id=?`).run(booking.id);
      require('../services/db').db.prepare(`DELETE FROM member_guests WHERE booking_id=?`).run(booking.id);
    } catch (e) { console.error('Member usage cleanup error:', e.message); }
  }
  try { require('../services/startedslot').releaseHeld(booking, 'booking cancelled'); } catch (e) { console.error('Credit restore error:', e.message); }
  // the owner's automations hear about it too (Oct 19 2026 - a customer's own cancel never went out)
  try { const wh = require('../services/webhooks'); wh.dispatch('booking.cancelled', Object.assign(wh.bookingFields(booking), { by: 'customer' })); } catch {}
  await sendCancellation(booking);
  if (booking.email) await sendCancellationEmail(booking);
  adminLog('CUSTOMER_CANCEL', `ID: ${booking.id} | ${booking.bay_name} | ${booking.date} ${booking.start_time}`);

  res.json({
    success: true,
    refunded,
    refundFailed: !!refundFailed,
    // the customer is promised only what is true: told the facility knows only when someone was told
    message: `Your ${booking.bay_name} session on ${fmtDate(booking.date)} at ${fmt12(booking.start_time)} has been cancelled.${alreadyRefunded ? ' Your payment has already been refunded.' : refunded ? ' A refund has been issued.' : refundFailed ? (ownerTold ? ' Your refund did not go through automatically - the facility has been told and will refund you.' : ' Your refund did not go through automatically - please contact the facility so they can refund you.') : ''}`
  });
}

module.exports = router;
