// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/bookingcore.js — THE TRUNK (maintainer's tree principle, Aug 11).
//
// "A server entering a time goes to the same route a person booking does."
// Every way a booking can be born or moved converges here, so a fix in one
// place is a fix everywhere. Branches may differ on POLICY (staff bypass the
// public advance-booking window on purpose); they may NOT differ on the
// MECHANICS below.
//
// WHY THIS EXISTS - four independent conflict checks had drifted apart:
//   availability display : no buffer, saw mid-checkout, midnight-safe
//   customer booking     : NO BUFFER, saw mid-checkout, midnight-safe
//   staff booking        : buffer, BLIND TO MID-CHECKOUT, refused midnight
//   move                 : NO BUFFER, BLIND TO MID-CHECKOUT, midnight-safe
// Two real bugs fell out of that: a facility's configured reset buffer was
// enforced for staff bookings but not customer ones, and staff could book
// straight over a customer who was actively paying. One rule now.
'use strict';

const dbM = require('./db');
const { getConfig } = require('./config');

// ── time math (absolute minutes since epoch-day; midnight-crossing safe) ──
function toMins(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minsToTime(m) {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}
function dayNum(d) { return Math.floor(Date.parse(String(d) + 'T00:00:00Z') / 86400000); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

function absStart(b) { return dayNum(b.date) * 1440 + toMins(b.start_time); }
function absEnd(b) { return dayNum(b.end_date || b.date) * 1440 + toMins(b.end_time); }
// THE ROWS THAT CAN TOUCH A WINDOW (Oct 20 2026). A row is read when it starts in the 63 days before the window's first
// day (a block spans at most 62 days - routes/admin.js) up to its last day, and ends on or after its first day. The old
// test read only rows that START or END on the window's own days, so a block over three days or more never held its middle
// days: they stayed on sale and could be booked (test-wholefacility F2). The minute test still decides every overlap; this
// only chooses which rows it sees. SQLite plans it as it planned the old test, on the status index - the live rows only,
// since past sessions are marked completed - so its cost follows the booking window, not the years (measured on 88,838
// bookings, DECISIONS Oct 20).
const SPAN_SQL = `date BETWEEN ? AND ? AND COALESCE(NULLIF(end_date, ''), date) >= ?`;
function spanArgs(date, endDate) { return [addDays(date, -63), endDate || date, date]; }

/**
 * THE 30-MINUTE GRID (maintainer, Aug 11 - a business rule, not a technical one).
 * Bookings exist only on :00 and :30, online and in person, for every
 * duration. Someone walking in at 2:40 books 3:00 - staff may turn the bay
 * on early as a courtesy, but the BOOKING never moves off the grid.
 * Off-grid starts would fracture the slot picker, make extensions ambiguous,
 * and invite 10/15-minute pricing, which the business deliberately refuses.
 */
const GRID_MINS = 30;
function isOnGrid(start_time) { return toMins(start_time) % GRID_MINS === 0; }
function isValidDuration(mins, { min = 30, max = 240 } = {}) {
  const d = parseInt(mins, 10);
  return Number.isInteger(d) && d % GRID_MINS === 0 && d >= min && d <= max;
}
/** The next bookable slot at or after a given time - "come back at 3:00". */
function nextSlot(start_time) {
  const m = toMins(start_time);
  return minsToTime(Math.ceil(m / GRID_MINS) * GRID_MINS);
}

/** Half-open [start,end) overlap of two absolute intervals. */
function overlaps(a, b) { return absStart(a) < absEnd(b) && absStart(b) < absEnd(a); }

/** End time + end date for a session, correct across midnight. */
function computeEnd(date, start_time, duration_minutes) {
  const raw = toMins(start_time) + (duration_minutes | 0);
  return {
    end_time: minsToTime(raw),
    end_date: raw >= 1440 ? addDays(date, Math.floor(raw / 1440)) : date
  };
}

/**
 * THE ONE CONFLICT RULE.
 *
 * - absolute intervals, so a session spilling past midnight is seen from
 *   both the night before and the morning after
 * - the facility's reset buffer expands EXISTING bookings on both sides, so
 *   a configured gap is honored no matter who is booking
 * - bookings still being paid for (pending_payment, inside a short grace)
 *   count as taken, so nobody can be booked over mid-checkout
 * - excludeId lets a MOVE ignore the booking being moved
 *
 * Returns the offending row, or null.
 */
/**
 * THE CHECKOUT HOLD, in minutes - one number, one place (W37).
 * A booking sitting in pending_payment counts as taken for exactly this long.
 * The availability grid, the create route's conflict check, the move/check-in
 * paths and the scheduler's sweeper all read THIS, so they cannot drift apart.
 * Floor of 1 minute: a facility may shorten the hold but never remove it.
 */
function holdMins() {
  const c = getConfig();
  const n = parseInt(c.booking && c.booking.bookingHoldMins, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** The three kinds of hold an owner can put on the calendar. A block is a
 *  WINDOW; a bay in maintenance is a STATE with no end (services/config bay
 *  flag `maintenance`); a facility closure is a block stamped whole_facility=1. */
const BLOCK_TYPES = ['event', 'tournament', 'maintenance'];

/** Is this stored row a hold on ONE BAY - a block that is not a facility-wide
 *  closure? Those never reach past their own bay (maintainer, Sep 19 2026). */
// WHAT THE CUSTOMER'S BOOKING IS CALLED (maintainer, Sep 19 2026). A venue that rents
// the whole building as one has no bays to its customers: "this reservation
// holds your bay" and "the bay is split by heads" are the wrong nouns, and a
// customer who booked the place reads them as a bay they were not sold. One
// helper, so the emails, the confirmation screen and the portal cannot drift.
function spaceWords(cfg) {
  const facility = !!(cfg && cfg.booking && cfg.booking.wholeFacility);
  return facility ? {
    facility: true,
    label:   'Facility',          // the receipt's field name
    your:    'the facility',      // "this reservation holds ___"
    reserves:'the facility',      // "this payment reserves ___"
    split:   'the facility is split by heads',
    per:     'for the whole facility'
  } : {
    facility: false,
    label:   'Bay',
    your:    'your bay',
    reserves:'your bay',
    split:   'the bay is split by heads',
    per:     'per bay'
  };
}

function isBayHold(r) {
  return BLOCK_TYPES.includes(String(r && r.booking_type || '')) && r.whole_facility !== 1;
}

/** Every bay that must stay DARK for this booking - its devices never wake.
 *  Two reasons: the bay is flagged out of service (a state, no end time), or a
 *  block overlaps the booking's window at all.
 *  OFF FOR THE WHOLE SESSION (maintainer's ruling, Sep 19 2026): a bay blocked for any
 *  part of a booking is dark for ALL of it. An owner working on a bay must
 *  never have it power up under him, and "it comes back on at 12" is not
 *  something anyone can reason about at 11:55. */
function darkBayIds(booking) {
  const cfg = getConfig();
  const out = new Set();
  for (const b of (cfg.bays || [])) if (b && b.maintenance) out.add(b.id);
  try {
    const date = booking.date, endDate = booking.end_date || booking.date;
    const rows = dbM.db.prepare(
      `SELECT bay_id, date, start_time, end_time, end_date, booking_type, whole_facility FROM bookings
        WHERE status = 'active' AND booking_type IN ('event','tournament','maintenance')
          AND ${SPAN_SQL}`
    ).all(...spanArgs(date, endDate));
    const cand = { date, start_time: booking.start_time, end_time: booking.end_time, end_date: endDate };
    for (const r of rows) {
      const ex = { date: r.date, start_time: r.start_time, end_time: r.end_time, end_date: r.end_date || r.date };
      if (absStart(cand) < absEnd(ex) && absStart(ex) < absEnd(cand)) {
        if (r.whole_facility === 1) for (const b of (cfg.bays || [])) out.add(b.id);   // the building is closed
        else if (r.bay_id) out.add(r.bay_id);
      }
    }
  } catch { /* a read we cannot make never turns a bay ON that should be dark */ }
  return out;
}

/** The bays a booking's automation should actually drive. ONE definition, so
 *  the scheduler's four fan-out sites cannot drift from each other. */
function baysToDrive(booking) {
  const cfg = getConfig();
  const dark = darkBayIds(booking);
  const all = (cfg.bays || []).filter(b => b.active !== false);
  if (booking.whole_facility) return all.filter(b => !dark.has(b.id));
  const one = all.find(b => b.id === booking.bay_id);
  return (one && !dark.has(one.id)) ? [one] : [];
}

// realOnly (Oct 3 2026): only a REAL booking or a bay block counts - never another customer's checkout still paying.
// /confirm asks this of a payment already taken: someone else merely holding the slot never costs the one who paid.
function findConflict({ bay_id, date, start_time, end_time, end_date, duration_minutes, excludeId = null, pendingGraceMins = null, wholeFacility = null, realOnly = false }) {
  // Default = the facility's ONE hold. Passing a number is still allowed, but
  // nothing in the tree does it any more; the old default of 1 minute was why
  // a slot could be sold over a live 10-minute checkout.
  if (pendingGraceMins === null || pendingGraceMins === undefined) pendingGraceMins = holdMins();
  if (!end_time) {
    const e = computeEnd(date, start_time, duration_minutes);
    end_time = e.end_time; end_date = e.end_date;
  }
  const candidate = { date, start_time, end_time, end_date: end_date || date };
  const buffer = (getConfig().booking && getConfig().booking.bufferMins | 0) || 0;

  // WHOLE-FACILITY SEMANTICS (Aug 2026), decided in THE TRUNK so every path
  // - customer, staff, move, availability - inherits it identically:
  //   0. A BAY-LEVEL HOLD IS NEVER THE BUILDING (maintainer's ruling, Sep 19 2026).
  //      A block or a bay in maintenance takes THAT BAY's devices out and
  //      nothing else: the building stays sellable, at the same price, and the
  //      owner tells members with the notice bar - his judgement, not the
  //      system's. Before this, facility mode made every candidate
  //      building-wide, so one bay out for a projector swap stopped the whole
  //      place being sold, and the owner could not even block the second bay.
  //      A facility-wide closure is a different object: a row STAMPED
  //      whole_facility=1, which rule 2 below already blocks everything with.
  //   1. A candidate born under facility mode conflicts with ANY overlapping
  //      booking on ANY bay (one booking owns the whole building).
  //   2. A stored row STAMPED whole_facility=1 conflicts with candidates on
  //      every bay forever - the stamp on the row wins over the live setting,
  //      so bookings keep the meaning they were born with across mode flips.
  //   3. Plain per-bay rows against plain per-bay candidates behave byte-for-
  //      byte as before.
  const candidateFacility = wholeFacility !== null
    ? !!wholeFacility
    : !!(getConfig().booking && getConfig().booking.wholeFacility);

  const rows = dbM.db.prepare(
    `SELECT id, name, date, start_time, end_time, end_date, status, bay_id, bay_name, whole_facility, booking_type FROM bookings
      WHERE ${SPAN_SQL}
        AND ( status = 'active'
              OR (status = 'pending_payment'
                  AND created_at >= datetime('now', ?)) )`
  ).all(...spanArgs(date, candidate.end_date), `-${pendingGraceMins} minutes`);

  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    if (realOnly && r.status === 'pending_payment') continue;
    // The clash test above time: same bay, OR either side owns the building -
    // EXCEPT that a bay-level hold is only ever its own bay (rule 0 above).
    if (isBayHold(r)) { if (r.bay_id !== bay_id) continue; }
    else if (!(candidateFacility || r.whole_facility === 1 || r.bay_id === bay_id)) continue;
    // Expand the existing booking by the reset buffer on both sides.
    const existing = {
      date: r.date,
      start_time: minsToTime(toMins(r.start_time) - buffer),
      end_time: minsToTime(toMins(r.end_time) + buffer),
      end_date: r.end_date || r.date
    };
    // Buffer can push the expanded window across a day edge; absolute math
    // below handles it because we compare computed minute totals directly.
    const exStart = dayNum(r.date) * 1440 + toMins(r.start_time) - buffer;
    const exEnd = dayNum(r.end_date || r.date) * 1440 + toMins(r.end_time) + buffer;
    const cStart = absStart(candidate), cEnd = absEnd(candidate);
    if (cStart < exEnd && exStart < cEnd) return r;
  }
  return null;
}

/** Is this bay free for this slot? Convenience wrapper over the one rule. */
function isBayFree(args) { return findConflict(args) === null; }

/**
 * POST-CREATE EFFECTS — the automation fan-out every new booking gets,
 * whoever created it. Each effect is independently guarded so one failing
 * integration (no printer, no Twilio) can never lose the booking itself.
 */
async function afterCreate(booking, { creditApplied = 0, source = 'unknown' } = {}) {
  const results = { receipt: false, webhook: false, sms: false, email: false };
  try { require('./printing').enqueueBookingReceipt(booking, { creditApplied }); results.receipt = true; } catch {}
  try {
    require('./webhooks').dispatch('booking.created', {
      id: booking.id, bay: booking.bay_name, date: booking.date,
      start_time: booking.start_time, end_time: booking.end_time,
      price_cents: booking.price_cents, name: booking.name,
      phone: booking.phone, email: booking.email || '', source
    });
    results.webhook = true;
  } catch {}
  // what each sender ANSWERED, never "we called it" (Sep 25 2026): true sent, false
  // failed (the sender has logged why), undefined this unit does not send that way
  try { const r = await require('./sms').sendConfirmation(booking); results.sms = r === undefined ? undefined : !!(r && r.success !== false); } catch { results.sms = false; }
  try {
    if (booking.email) { const r = await require('./email').sendConfirmationEmail(booking); results.email = r === undefined ? undefined : r === true; }
  } catch { results.email = false; }
  return results;
}

/**
 * CAN MORE TIME BE SOLD RIGHT AFTER A SESSION (Oct 3 2026). The facility's minimum session must fit before the
 * next tee time and - unless the facility is open around the clock - start at or after opening and end by closing,
 * the bounds the create route enforces (routes/bookings.js). The bay screen's "add more time" offer and the
 * 15-minute text both ask this, so neither offers time the booking page would refuse. `gapToNextMins`: minutes
 * from this session's end to the next booking on the bay (null or undefined: nothing after it).
 */
function moreTimeFits(cfg, endTime, gapToNextMins, date) {
  const minSess = Number(cfg.booking && cfg.booking.minSessionMins) || 30;
  if (gapToNextMins != null && gapToNextMins < minSess) return false;
  if (cfg.booking && cfg.booking.open24Hours) return true;
  // (the hours of the session's own day - a day may have its own: services/hours.js)
  const h = require('./hours').on(cfg.booking, date);
  const extStart = toMins(endTime), closeMins = require('./hours').closeMins(h);
  return !(extStart < toMins(h.openTime || '00:00') || extStart + minSess > closeMins);
}

module.exports = {
  moreTimeFits,
  spaceWords,
  toMins, minsToTime, addDays, overlaps, computeEnd,
  GRID_MINS, isOnGrid, isValidDuration, nextSlot,
  findConflict, isBayFree, afterCreate, holdMins,
  BLOCK_TYPES, isBayHold, darkBayIds, baysToDrive
};
