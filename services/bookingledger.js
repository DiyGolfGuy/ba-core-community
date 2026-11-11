// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/bookingledger.js — THE ONE PLACE A BOOKING'S RECORDS ARE WRITTEN
//
//  W37 (Sep 8 2026), from the pilot facility lessons doc: a handler with several terminal
//  paths must route its side effects through ONE function that every path calls,
//  because the branch you do not exercise is the branch that rots. pilot facility lost five
//  months of waiver records that way. We had the same defect, in the same file,
//  in the same branch - and a second one they did not have.
//
//  Proved present on the bench before this module existed
//  (docs/internal/w37-repro.js):
//    - a 100%-discount booking took a signature and wrote no signed_waivers row
//    - a gift card spent on a Stripe-PAID booking never decremented, forever
//
//  EVERYTHING IS DERIVED FROM THE PERSISTED ROW. That is what lets the free
//  branch, the dev-mode branch and /confirm all call the same function at the
//  moment each of them makes a booking real, without three different context
//  objects drifting apart.
//
//  EVERYTHING IS IDEMPOTENT, keyed on booking_id. Calling it twice for one
//  booking writes one set of records. A retry, a double-submitted confirm, or a
//  later path re-running is safe by construction.
//
//  FAILURE IS LOUD. Each record is guarded on its own so one broken integration
//  cannot lose the booking, but every failure lands in admin_log with its own
//  event (WAIVER_RECORD_FAILED, DISCOUNT_RECORD_FAILED, ...) and on the console.
//  Never a silent catch - the whole point of the pilot facility lesson.
'use strict';

const { v4: uuidv4 } = require('uuid');

const D = () => require('./db').db;
const log = (e, d) => { try { require('./db').adminLog(e, d); } catch {} };

/** Has this booking already written a row of this kind? */
function already(table, bookingId, extra = '', params = []) {
  try {
    const r = D().prepare(`SELECT 1 AS x FROM ${table} WHERE booking_id = ?${extra} LIMIT 1`).get(bookingId, ...params);
    return !!r;
  } catch { return false; }
}

// ── the four records ────────────────────────────────────────────────────────

// A discount code or gift card spend. The code id and the amount ride the
// booking row (W37 additive columns), so this works identically whether the
// booking went free at creation or was paid through Stripe minutes later.
function recordDiscount(b) {
  const codeId = b.discount_code_id || '';
  const cents = b.discount_cents | 0;
  if (!codeId || cents <= 0) return 'skip';
  if (already('discount_uses', b.id, ' AND code_id = ?', [codeId])) return 'already';
  try {
    require('./pricing').recordDiscountUse(codeId, b.id, b.phone || '', cents);
    return 'wrote';
  } catch (err) {
    console.error('DISCOUNT_RECORD_FAILED', b.id, err.message);
    log('DISCOUNT_RECORD_FAILED', `Booking: ${b.id} | Code: ${codeId} | ${err.message}`);
    return 'failed';
  }
}

// A member's session against their allowance, and any guest passes it burned.
function recordMemberUsage(b) {
  if (!b.member_id) return 'skip';
  if (already('member_usage', b.id)) return 'already';
  try {
    D().prepare(
      `INSERT INTO member_usage (id, member_id, booking_id, date, duration_minutes, guest_count) VALUES (?,?,?,?,?,?)`
    ).run(uuidv4(), b.member_id, b.id, b.date, b.duration_minutes, b.member_guest_count || 0);
    const covered = (b.member_guest_covered != null) ? (b.member_guest_covered | 0) : (b.member_guest_count | 0);
    if (covered > 0 && !already('member_guests', b.id)) {
      D().prepare(
        `INSERT INTO member_guests (id, member_id, booking_id, date, guest_count) VALUES (?,?,?,?,?)`
      ).run(uuidv4(), b.member_id, b.id, b.date, covered);
    }
    return 'wrote';
  } catch (err) {
    console.error('MEMBER_USAGE_RECORD_FAILED', b.id, err.message);
    log('MEMBER_USAGE_RECORD_FAILED', `Booking: ${b.id} | Member: ${b.member_id} | ${err.message}`);
    return 'failed';
  }
}

// Standing member credit consumed by this booking. The amount is not on the
// row (it is applied during pricing), so the caller passes it; the guard is
// still the booking id, so a second call cannot spend it twice.
function recordCredit(b, creditCents) {
  const cents = creditCents | 0;
  if (!b.member_id || cents <= 0) return 'skip';
  if (already('member_credit', b.id)) return 'already';
  try {
    D().prepare(
      `INSERT INTO member_credit (member_id, delta_cents, reason, booking_id) VALUES (?,?,?,?)`
    ).run(b.member_id, -cents, 'Applied to booking', b.id);
    return 'wrote';
  } catch (err) {
    console.error('CREDIT_RECORD_FAILED', b.id, err.message);
    log('CREDIT_RECORD_FAILED', `Booking: ${b.id} | Member: ${b.member_id} | ${err.message}`);
    return 'failed';
  }
}

// THE ONE THAT COST pilot facility FIVE MONTHS. The signature is on the row from the
// moment the booking is created; this turns it into the evidence record.
// A member signing records MEMBERSHIP scope (the self-correcting renewal);
// everyone else records BOOKING scope.
function recordWaiver(b, { ipAddress = '' } = {}) {
  const wId = b.waiver_id;
  const sig = b.signature_name;
  if (!wId || !sig) return 'skip';
  // A membership-scope row keeps its booking in captured_booking_id (W37), so
  // the guard has to ask for both or a member's signature would be re-recorded
  // on every call.
  if (already('signed_waivers', b.id, " OR (captured_booking_id = ? AND captured_booking_id <> '')", [b.id])) return 'already';
  try {
    const doc = require('./db').getWaiverById(wId);
    if (!doc) {
      console.error('WAIVER_RECORD_FAILED', b.id, 'document ' + wId + ' not found');
      log('WAIVER_RECORD_FAILED', `Booking: ${b.id} | Waiver document ${wId} is not on this unit - signature NOT recorded`);
      return 'failed';
    }
    require('./waiver').recordSignedWaiver(b, doc, {
      signatureName: sig,
      ipAddress: ipAddress || b.waiver_ip || '',
      userAgent: b.waiver_user_agent || '',
      guardianFor: b.waiver_guardian_for || '',
      email: b.email || '',
      memberId: b.member_id || null
    });
    return 'wrote';
  } catch (err) {
    console.error('WAIVER_RECORD_FAILED', b.id, err.message);
    log('WAIVER_RECORD_FAILED', `Booking: ${b.id} | Waiver: ${wId} | Signer: ${sig} | ${err.message}`);
    return 'failed';
  }
}

// ── the trunk ───────────────────────────────────────────────────────────────

/**
 * Write every record a real booking owes, from the persisted row.
 *
 * booking  a bookings row (or an id - it is re-read either way, so the row is
 *          always the one on disk and never a half-built object)
 * opts     { creditCents, ipAddress, source }
 *
 * Returns { discount, memberUsage, credit, waiver, failed[] } where each value
 * is 'wrote' | 'already' | 'skip' | 'failed'. Callers do not have to check it -
 * every failure is already in admin_log - but the batteries do.
 */
function recordAll(booking, opts = {}) {
  const id = typeof booking === 'string' ? booking : booking && booking.id;
  let b = null;
  try { b = D().prepare(`SELECT * FROM bookings WHERE id = ?`).get(id); } catch {}
  if (!b) {
    console.error('LEDGER_ROW_MISSING', id);
    log('LEDGER_ROW_MISSING', `No bookings row for ${id} - nothing recorded`);
    return { discount: 'failed', memberUsage: 'failed', credit: 'failed', waiver: 'failed', failed: ['row'] };
  }
  const out = {
    discount:    recordDiscount(b),
    memberUsage: recordMemberUsage(b),
    credit:      recordCredit(b, opts.creditCents),
    waiver:      recordWaiver(b, { ipAddress: opts.ipAddress })
  };
  out.failed = Object.keys(out).filter(k => out[k] === 'failed');
  // Written now without freezing the unit (Sep 24 2026): flushed() is the same export,
  // fdatasync, rename and directory sync as saveDb(), with the fsync in the thread pool.
  // saveDb() did it on the main thread - ~0.4 s for a year-old 12 MB database on the
  // Pi's card, and seconds when the card is busy, with every request waiting behind it.
  try { require('./db').flushed().catch(() => {}); } catch {}
  return out;
}

module.exports = { recordAll, recordDiscount, recordMemberUsage, recordCredit, recordWaiver };
