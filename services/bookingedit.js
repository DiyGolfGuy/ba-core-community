// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/bookingedit.js — MOVE and CANCEL a booking after it exists.
//
// WHY THIS IS A SERVICE AND NOT ANOTHER ROUTE: cancelling correctly means
// revoking the door code, refunding, releasing member usage/credit, telling
// the customer, and stamping the audit log. A second hand-rolled cancel path
// that forgets the door revoke is a real-world security bug (a code that
// still opens the door for a session nobody is paying for). Staff and owner
// both call THIS.
//
// THE MOVE TRAP: notification flags are per-booking, not per-time. A booking
// moved from 2pm to 7pm whose reminder already fired would NEVER remind
// again, and one moved earlier could have a door code for the wrong window.
// Every move resets sms_reminder_sent / sms_code_sent (and revokes an issued
// door code) so the scheduler re-fires correctly for the new time.
'use strict';

const dbM = require('./db');
const { getConfig } = require('./config');
const { stripeClient } = require('./stripeclient');

function D() { return dbM.db; }

// ── time helpers (absolute minutes, midnight-crossing aware) ──────────────
function toMins(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function dayNum(d) { return Math.floor(Date.parse(d + 'T00:00:00') / 86400000); }
function absStart(b) { return dayNum(b.date) * 1440 + toMins(b.start_time); }
function absEnd(b) {
  const end = b.end_date || b.date;
  return dayNum(end) * 1440 + toMins(b.end_time);
}
function overlaps(a, b) { return absStart(a) < absEnd(b) && absStart(b) < absEnd(a); }

function hoursUntil(booking) {
  const start = Date.parse(`${booking.date}T${booking.start_time}:00`);
  return (start - Date.now()) / 3600000;
}

// Facility cancellation window. Default 24h, owner-configurable.
function policyHours() {
  const cfg = getConfig();
  const v = cfg.cancellationPolicy && cfg.cancellationPolicy.windowHours;
  return (v === 0 || v) ? Number(v) : 24;
}

// Does this actor need to override the window? Staff CAN override (someone is
// standing there), but the override is always recorded.
function windowState(booking) {
  const h = hoursUntil(booking);
  const limit = policyHours();
  return { hours_until: Math.round(h * 10) / 10, limit, inside_policy: h >= limit, late: h < limit };
}

// ── MOVE ──────────────────────────────────────────────────────────────────
// THE TRUNK. This was a FOURTH independent conflict check (added in the
// move wave) that ignored both the facility buffer and mid-checkout
// bookings - exactly the drift maintainer's tree principle exists to prevent.
function findConflict(booking, { date, start_time, end_time, end_date, bay_id }) {
  return require('./bookingcore').findConflict({
    bay_id, date, start_time, end_time, end_date, excludeId: booking.id
  });
}

function computeEnd(date, start_time, duration_minutes) {
  return require('./bookingcore').computeEnd(date, start_time, duration_minutes);
}

/**
 * A SESSION MOVED OFF A BAY IT HAD SWITCHED ON LEAVES THAT BAY OFF (Oct 3 2026; pilot facility's handoff section 3 - their move
 * deleted the OFF for hardware it had switched on). A move drops the booking's jobs and the scheduler then drives the
 * NEW bay only, so nothing would ever switch the old one off: a group moved off a broken bay left its projector, TV and
 * PC on all night. The old bay's switch-offs are queued for the scheduler's cancel settle (automation.queueLeftBay):
 * the PC first, then only what THIS session switched on, never a device another session is using, the toggle ledger
 * asked, retried and on the health line if one refuses. (The first cut pressed the bay buttons' Off, which knew none of
 * that - the review.) Nothing is queued while another session is on the old bay now or starts inside the keep-on gap:
 * that session owns the equipment, and its own end switches it off. `done` is the booking's done on-rows, read before
 * its jobs were dropped. Returns the words for the owner's log.
 */
function switchOffLeftBay(booking, toBay, cfg, done) {
  const oldBay = (cfg.bays || []).find(b => b.id === booking.bay_id);
  if (!oldBay) return '';
  const gap = Number(cfg.automation?.keepOnGapMins ?? 30), now = Date.now();
  const ymd = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  let next = null;
  try {
    next = D().prepare(`SELECT id, date, start_time, end_time, end_date FROM bookings WHERE (bay_id=? OR whole_facility=1) AND id<>? AND status='active' AND (date IN (?,?) OR end_date IN (?,?))`)
      .all(oldBay.id, booking.id, ymd(now), ymd(now + 86400000), ymd(now), ymd(now + 86400000))
      .find(r => { const s0 = new Date(`${r.date}T${r.start_time}:00`).getTime(), e0 = new Date(`${r.end_date || r.date}T${r.end_time}:00`).getTime(); return s0 <= now + gap * 60000 && e0 > now; }) || null;
  } catch {}
  if (next) return ` | ${oldBay.name} left on - the session at ${next.start_time} uses it`;
  const has = (kind, key) => (done || []).some(r => r.kind === kind && r.device_key === key);
  const irKey = require('./scheduler').irJobKey;
  const items = [];
  // only devices this session switched on, that the owner has set to switch off after a session, and that the bay it
  // moved to does not use as well (the session is still using a device both bays share)
  for (const d of oldBay.shellyDevices || []) if (d.ip && d.turnOffAfter && has('power_on', d.ip) && !(toBay.shellyDevices || []).some(x => x.ip === d.ip)) items.push({ on: 'power_on', off: 'power_off', key: d.ip });
  for (const d of oldBay.haDevices || []) if (d.entity_id && (d.kind === 'climate' ? d.ecoTemp != null : d.turnOffAfter) && has('power_on', d.entity_id + '_ha') && !(toBay.haDevices || []).some(x => x.entity_id === d.entity_id)) items.push({ on: 'power_on', off: 'power_off', key: d.entity_id + '_ha' });
  for (const d of oldBay.broadlinkDevices || []) { const k = d.ip && irKey(oldBay, d); if (k && d.offCommand && d.turnOffAfter && has('ir_on', k) && !(toBay.broadlinkDevices || []).some(x => x.ip === d.ip)) items.push({ on: 'ir_on', off: 'ir_off', key: k }); }
  const pcIp = String(oldBay.simulatorPcIp || '').trim();
  const begun = new Date(`${booking.date}T${booking.start_time}:00`).getTime() <= now;
  const pc = !!pcIp && pcIp !== String(toBay.simulatorPcIp || '').trim() && (begun || (done || []).some(r => r.kind === 'power_on' && /^wol/.test(r.device_key)));
  if (!items.length && !pc) return '';
  try { require('./automation').queueLeftBay(booking.id, oldBay.id, items, pc); } catch (e) { return ` | ${oldBay.name} NOT switched off - ${e.message}`; }
  return ` | ${oldBay.name} switching off (the session had switched it on${pc ? '; the PC first, then its power' : ''})`;
}

async function moveBooking(bookingId, { date, start_time, duration_minutes, bay_id, actor, reason }) {
  const booking = D().prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
  if (!booking) return { error: 'Booking not found', code: 404 };
  if (booking.status !== 'active') return { error: `This booking is ${booking.status} and cannot be moved.`, code: 400 };

  const cfg = getConfig();
  const newDate = date || booking.date;
  const newStart = start_time || booking.start_time;
  const newDur = duration_minutes ? (duration_minutes | 0) : booking.duration_minutes;
  const newBayId = bay_id || booking.bay_id;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { error: 'Invalid date', code: 400 };
  if (!/^\d{2}:\d{2}$/.test(newStart)) return { error: 'Invalid start time', code: 400 };
  if (newDur <= 0 || newDur > 24 * 60) return { error: 'Invalid duration', code: 400 };

  const bay = (cfg.bays || []).find(b => b.id === newBayId && b.active);
  if (!bay) return { error: 'That bay is not available.', code: 400 };

  const { end_time, end_date } = computeEnd(newDate, newStart, newDur);
  const clash = findConflict(booking, { date: newDate, start_time: newStart, end_time, end_date, bay_id: newBayId });
  if (clash) return { error: `${bay.name} is already booked at that time.`, code: 409 };

  const unchanged = newDate === booking.date && newStart === booking.start_time
    && newDur === booking.duration_minutes && newBayId === booking.bay_id;
  if (unchanged) return { error: 'Nothing changed.', code: 400 };

  // was the OLD bay switched on for this booking? Read before the jobs are dropped below
  const doneOn = newBayId !== booking.bay_id && !booking.whole_facility ? (() => {
    try { return D().prepare(`SELECT kind, device_key FROM automation_jobs WHERE booking_id=? AND kind IN ('power_on','ir_on') AND status='done' AND device_key NOT LIKE 'left:%'`).all(booking.id); } catch { return []; }
  })() : [];
  const leftBayOn = doneOn.length > 0;

  // A door code already issued belongs to the OLD window - revoke it so it
  // cannot open the door at a time nobody booked, and let the scheduler
  // issue a fresh one for the new window.
  // A-wave 11b: revokeDoorCode REPORTS - it never throws - so `revoked = true` after
  // the call was true whatever the lock said. If it did not take the code back, the
  // pointer must survive this edit or nothing will ever revoke it.
  let revoked = false, revokeHeld = false;
  if (booking.remotelock_person_id) {
    try {
      const res = await require('./doorlock').revokeDoorCode(booking.remotelock_person_id, { forBookingId: booking.id });
      revoked = !!(res && res.ok === true);
      if (!revoked) { revokeHeld = true; try { dbM.adminLog('DOOR_REVOKE_ERROR', `${booking.id}: ${(res && res.error) || 'no answer'} - the code is STILL LIVE and the unit will keep trying`); } catch {} }
    } catch (e) { revokeHeld = true; try { dbM.adminLog('DOOR_REVOKE_ERROR', `${booking.id}: ${e.message}`); } catch {} }
  }

  D().prepare(
    `UPDATE bookings
        SET date=?, start_time=?, end_time=?, end_date=?, duration_minutes=?,
            bay_id=?, bay_name=?,
            sms_reminder_sent=0, sms_code_sent=0,
            door_code=NULL, remotelock_person_id=CASE WHEN ?=1 THEN remotelock_person_id ELSE NULL END,
            updated_at=datetime('now')
      WHERE id=?`
  ).run(newDate, newStart, end_time, end_date, newDur, newBayId, bay.name, revokeHeld ? 1 : 0, booking.id);
  // the credential is still live at the lock: leave a revoke due NOW so the tick's
  // sweep takes it back rather than waiting for the booking's new end
  // queued AFTER the blanket cancelJobs below, and cancelJobs no longer takes a
  // door_revoke anyway - belt and braces, because this exact ordering already bit once
  const queueHeldRevoke = () => { if (revokeHeld) { try { require('./automation').dueNow(booking.id, 'door_revoke'); } catch {} } };   // NOW, even over a revoke already scheduled for the old end

  // Member usage rows carry the date - keep them aligned or monthly limit
  // math drifts against the booking they came from.
  if (booking.member_id) {
    try { D().prepare(`UPDATE member_usage SET date=? WHERE booking_id=?`).run(newDate, booking.id); } catch {}
  }

  // The old jobs were scheduled against the OLD time - drop them so the
  // scheduler re-registers them for the new one. (Same reason the
  // notification flags reset above.)
  try { require('./automation').cancelJobs(booking.id); } catch {}
  queueHeldRevoke();
  // the code is off the lock (or there never was one): the old window's removal job has nothing left
  // to do, and left waiting it would take the NEW code back at the OLD time (Sep 27 2026, the hotfix)
  if (!revokeHeld) { try { require('./automation').dropSpentDoorRevokes(booking.id); } catch {} }

  const leftNote = leftBayOn ? switchOffLeftBay(booking, bay, cfg, doneOn) : '';
  const detail = `${booking.id} | ${booking.date} ${booking.start_time} ${booking.bay_name}`
    + ` -> ${newDate} ${newStart} ${bay.name}${reason ? ' | ' + String(reason).slice(0, 60) : ''}`
    + (actor ? ` | by ${actor}` : '') + leftNote;
  try { dbM.adminLog('BOOKING_MOVED', detail); } catch {}

  const updated = D().prepare(`SELECT * FROM bookings WHERE id = ?`).get(booking.id);
  // the owner's automations hear the new day, time or bay, with where it was (Oct 19 2026)
  try { const wh = require('./webhooks'); if (updated) wh.dispatch('booking.changed', Object.assign(wh.bookingFields(updated), { change: 'moved', was: { bay: booking.bay_name, date: booking.date, start_time: booking.start_time, end_time: booking.end_time, end_date: booking.end_date || null } })); } catch {}
  // the customer is told (maintainer, Oct 4 2026) - when the day, the time or the bay changed; a length-only change is not a move
  // of where or when to come. Never waits on the provider, never fails the move (an email that fails is logged by sendEmail).
  if (updated && updated.email && (newDate !== booking.date || newStart !== booking.start_time || newBayId !== booking.bay_id)) {
    const was = { date: booking.date, start_time: booking.start_time, end_time: booking.end_time, end_date: booking.end_date, bay_name: booking.bay_name };
    setImmediate(() => { Promise.resolve().then(() => require('./email').sendBookingMovedEmail(updated, was)).catch(() => {}); });
  }
  return { ok: true, booking: updated, door_code_revoked: revoked, notifications_reset: true };
}

// HALF OF WHAT WAS PAID (Oct 2026, from pilot facility's 09-27 addendum). A "50% refund" gave back
// floor(price_cents / 2) - the session price alone - while the customer paid the session AND its tax
// (stored apart, charged on top), so $50.00 + $3.69 gave back $25.00 instead of $26.85. It is half of
// what Stripe actually took for this booking, read from the charge (or the intent); only when neither
// answers, half of the price and tax the unit recorded. Rounded to the nearest cent. test-half-refund.
// HALF IN ALL (Oct 3 2026, the pack review): a "50%" cancel leaves the customer with half of what they paid back IN TOTAL -
// so what was already refunded (an owner's refund in Stripe's dashboard, picked up by rule 39) comes off this one. It used
// to halve the captured amount and ignore it: $20 refunded in the dashboard, then a 50% cancel, gave $46.85 of $53.69 back.
// 0 means half or more has already gone back, and nothing more is sent.
async function halfOfPaid(stripe, booking, chargeId) {
  let paid = 0, already = 0;
  if (chargeId) { try { const ch = await stripe.charges.retrieve(chargeId); paid = Number(ch.amount_captured || ch.amount) || 0; already = Number(ch.amount_refunded) || 0; } catch (e) {} }
  if (!paid && booking.stripe_payment_intent) { try { const pi = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent); paid = Number(pi.amount_received) || 0; } catch (e) {} }
  if (!paid) paid = (booking.price_cents | 0) + (booking.tax_cents | 0);
  return Math.max(0, Math.round(paid / 2) - already);
}

// ── CANCEL (staff-facing; delegates the money/door/notify work) ───────────
// ONE CANCEL PER BOOKING AT A TIME (Oct 2026, the customer route's double tap - routes/customer.js): a
// double tap on the staff pad ran two cancels side by side, each past the "already cancelled" check.
const CANCELLING = new Set();
async function cancelBooking(bookingId, opts = {}) {
  if (CANCELLING.has(bookingId)) return { error: 'This booking is already being cancelled - one moment.', code: 409 };
  CANCELLING.add(bookingId);
  try { return await cancelBookingOnce(bookingId, opts); }
  finally { CANCELLING.delete(bookingId); }
}
async function cancelBookingOnce(bookingId, { refund_type = 'full', actor, reason, override_policy = false }) {
  const booking = D().prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
  if (!booking) return { error: 'Booking not found', code: 404 };
  if (booking.status === 'cancelled') return { error: 'Already cancelled.', code: 400 };

  const win = windowState(booking);
  if (win.late && !override_policy) {
    return { error: `This session starts in ${win.hours_until} hours, inside the ${win.limit}-hour cancellation window.`,
             code: 409, requires_override: true, window: win };
  }

  // Door access dies first - a live code on a cancelled session is the worst
  // failure mode here.
  let revoked = false, revokeHeld = false;
  if (booking.remotelock_person_id) {
    try {
      const res = await require('./doorlock').revokeDoorCode(booking.remotelock_person_id, { forBookingId: booking.id });
      revoked = !!(res && res.ok === true);
      if (!revoked) { revokeHeld = true; try { dbM.adminLog('DOOR_REVOKE_ERROR', `${booking.id}: ${(res && res.error) || 'no answer'} - the code is STILL LIVE on a cancelled session and the unit will keep trying`); } catch {} }
    } catch (e) { revokeHeld = true; try { dbM.adminLog('DOOR_REVOKE_ERROR', `${booking.id}: ${e.message}`); } catch {} }
  }

  // Refund through the same helper the owner console uses.
  // #18d async-capture resilience: was gated on stripe_charge_id and would silently
  // skip the refund when it was stored null. Now refunds by charge if present
  // (retrieving/backfilling from the intent), else by payment_intent.
  let refunded = false, refundAmount = 0;
  if (refund_type !== 'none' && (booking.stripe_charge_id || booking.stripe_payment_intent)) {
    try {
      const key = getConfig().stripe?.secretKey || '';
      if (key && !key.startsWith('sk_mock') && !key.startsWith('PASTE')) {
        const stripe = stripeClient(key);
        let chargeId = booking.stripe_charge_id;
        if (!chargeId && booking.stripe_payment_intent) {
          try {
            const intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent);
            if (intent && intent.latest_charge) {
              chargeId = intent.latest_charge;
              try { D().prepare(`UPDATE bookings SET stripe_charge_id=? WHERE id=?`).run(chargeId, booking.id); } catch {}
            }
          } catch (e) { /* fall through to payment_intent */ }
        }
        const opts = Object.assign(chargeId ? { charge: chargeId } : { payment_intent: booking.stripe_payment_intent }, { metadata: require('./stripemark').marker() });
        if (refund_type === 'half') { opts.amount = await halfOfPaid(stripe, booking, chargeId); refundAmount = opts.amount; }
        else refundAmount = (booking.price_cents | 0) + (booking.tax_cents | 0);
        if (refund_type === 'half' && !(opts.amount > 0)) {
          // half or more already went back (an owner's refund in Stripe) - the customer has their half; Stripe refuses 0
          refunded = true; refundAmount = 0;
          try { dbM.adminLog('STRIPE_REFUND', `Booking: ${booking.id} | Staff cancel | $0.00 | half or more of what was paid had already been refunded in Stripe - nothing more sent`); } catch {}
        } else {
        const rf = await stripe.refunds.create(opts, { idempotencyKey: 'rf-' + booking.id + '-' + refund_type });   // retries can never double-refund
        if (rf && rf.amount) refundAmount = rf.amount;   // what Stripe gave back, in the log and the message - not what we guessed
        refunded = true;
        try { dbM.markRefunded(booking.id, null, rf, 'staff-cancel'); } catch (e) {}
        try { dbM.adminLog('STRIPE_REFUND', `Booking: ${booking.id} | Staff cancel | $${(refundAmount / 100).toFixed(2)} | via ${chargeId ? 'charge' : 'payment_intent'}`); } catch {}
        }
      }
    } catch (e) {
      try { dbM.adminLog('STRIPE_REFUND_ERROR', `${booking.id}: ${e.message}`); } catch {}
    }
  }

  // A-wave 11b: this said `id`, which does not exist in this function (the parameter
  // is bookingId) - so every staff cancellation threw a ReferenceError into the catch
  // and NO discount or gift-card use was ever released. A customer's gift card stayed
  // spent on a session that never happened.
  try { require('./pricing').releaseBookingCodes(booking.id); } catch (e) { console.error('code release:', e.message); }
  D().prepare(`UPDATE bookings SET status='cancelled', door_code=NULL, remotelock_person_id=CASE WHEN ?=1 THEN remotelock_person_id ELSE NULL END, updated_at=datetime('now') WHERE id=?`)
    .run(revokeHeld ? 1 : 0, booking.id);
  // queued AFTER the blanket cancelJobs below, and cancelJobs no longer takes a
  // door_revoke anyway - belt and braces, because this exact ordering already bit once
  const queueHeldRevoke = () => { if (revokeHeld) { try { require('./automation').dueNow(booking.id, 'door_revoke'); } catch {} } };   // NOW, even over a revoke already scheduled for the old end

  // Release member usage + guest rows so the allowance is not eaten.
  if (booking.member_id) {
    try {
      D().prepare(`DELETE FROM member_usage WHERE booking_id=?`).run(booking.id);
      D().prepare(`DELETE FROM member_guests WHERE booking_id=?`).run(booking.id);
    } catch {}
    // Restore consumed member credit (idempotent - never double-restore).
    try {
      const used = D().prepare(
        `SELECT member_id, COALESCE(SUM(-delta_cents),0) AS used FROM member_credit
          WHERE booking_id = ? AND reason = 'Applied to booking' GROUP BY member_id`).get(booking.id);
      if (used && used.used > 0) {
        const already = D().prepare(
          `SELECT COUNT(*) AS c FROM member_credit WHERE booking_id = ? AND reason LIKE 'Restored%'`).get(booking.id);
        if (!already?.c) {
          D().prepare(`INSERT INTO member_credit (member_id, delta_cents, reason, booking_id) VALUES (?,?,?,?)`)
            .run(used.member_id, used.used, 'Restored - booking cancelled', booking.id);
        }
      }
    } catch {}
  }

  // A cancelled session must never power on a bay or text a door code. Its plug-off, TV-off and
  // shutdown stay, for the scheduler to settle (automation.cancelJobs keepCleanup, Sep 25 2026).
  try { require('./automation').cancelJobs(booking.id, null, { keepCleanup: true }); } catch {}
  queueHeldRevoke();
  // the owner's automations hear about it (Oct 19 2026 - a cancel from the staff pad never went out)
  try { const wh = require('./webhooks'); wh.dispatch('booking.cancelled', Object.assign(wh.bookingFields(booking), { by: actor ? 'staff: ' + String(actor).slice(0, 40) : 'staff' })); } catch {}
  // the lock took the code back: its removal job has nothing left to do, and left waiting it read
  // "overdue - never claimed" on the health line for ever (Sep 27 2026, the hotfix)
  if (!revokeHeld) { try { require('./automation').dropSpentDoorRevokes(booking.id); } catch {} }

  // Gift/discount codes the booking consumed go back on the shelf.
  try { require('./gifts').restoreGiftUse(booking.id); } catch {}

  // Tell the customer (same senders the owner path uses).
  try {
    // SMS cancellation lives in services/sms.js (same sender the owner console
    // uses); it honors the facility's own notification toggles internally.
    const { sendCancellation } = require('./sms');
    if (booking.status === 'active' || booking.status === 'completed') await sendCancellation(booking);
  } catch (e) { try { dbM.adminLog('CANCEL_SMS_ERROR', `${booking.id}: ${e.message}`); } catch {} }
  try {
    const email = require('./email');
    if (booking.email && typeof email.sendCancellationEmail === 'function') await email.sendCancellationEmail(booking);
  } catch {}

  const label = refund_type === 'full' ? 'Full refund' : refund_type === 'half' ? '50% refund' : 'No refund';
  try {
    dbM.adminLog('BOOKING_CANCELLED', `${booking.id} | ${booking.date} ${booking.start_time} | ${label}`
      + `${refunded ? ' OK' : booking.stripe_charge_id && refund_type !== 'none' ? ' FAILED' : ''}`
      + `${win.late ? ` | LATE CANCEL (${win.hours_until}h, policy ${win.limit}h)` : ''}`
      + `${reason ? ' | ' + String(reason).slice(0, 60) : ''}${actor ? ' | by ' + actor : ''}`);
  } catch {}

  return { ok: true, refunded, refund_cents: refundAmount, door_code_revoked: revoked, window: win };
}

module.exports = { CANCELLING, moveBooking, cancelBooking, windowState, policyHours, computeEnd, findConflict, stripeClient, halfOfPaid };
