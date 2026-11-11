// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/checkin.js — Wave B core: per-seat group check-in + staff bookings.
//
// CASES (detected from the booking row, never client-supplied):
//   prepaid         stripe PI, not deposit  -> arrival only; $0 golf on seats
//   member_deposit  is_deposit + member_id  -> the Segment-B-proven math,
//                   bay-aware standard; surplus -> member_credit (member_tab
//                   mode) or reduces the group bill (group mode)
//   booking_deposit is_deposit, no member   -> facility per-30 deposit; the
//                   deposit credits the GROUP; remaining splits across seats
//   pay_here        no PI                   -> full collect, per-seat shares
//
// Per-seat member codes: a valid PIN prices THAT seat at its own tier
// (share_discount_pct if set, else a percentage discount_value), honors
// day/time/bay restrictions with the honest still-welcome message, exposes
// credit balance + guest passes, and credits a waiver already on file.
//
// Every seat gets a POS tab (openTab) and, when owed, a golf line at its own
// number. Waivers write to the EXISTING signed_waivers table (method digital
// with the typed legal name, or a one-tap paper attestation stamped with the
// employee). Settlement + member_credit writes mirror the admin route so the
// self-auditing ledger stays the single source of truth.
'use strict';

const crypto = require('crypto');
const dbMod = require('./db');
const configService = require('./config');
const pos = require('./pos');
const { calculatePrice } = require('./pricing');

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function cfg() { return configService.getConfig(); }
function uid() { return crypto.randomUUID(); }
function toMins(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; }
function minsToTime(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

// penny-fair split: parts sum EXACTLY to total (remainder pennies to the front)
function fairSplit(total, n) {
  const base = Math.floor(total / n), rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

// ── seat member info ───────────────────────────────────────────────────────

function creditBalance(memberId) {
  try {
    const r = dbMod.db.prepare(`SELECT COALESCE(SUM(delta_cents),0) AS bal FROM member_credit WHERE member_id = ?`).get(memberId);
    return Math.max(0, r.bal | 0);
  } catch { return 0; }
}

function passesLeft(member, monthPrefix) {
  if (!member.guest_allowed || !(member.guest_passes_per_month > 0)) return 0;
  try {
    const used = dbMod.db.prepare(
      `SELECT COALESCE(SUM(guest_count),0) AS c FROM member_guests WHERE member_id = ? AND date LIKE ?`
    ).get(member.id, monthPrefix + '%').c | 0;
    return Math.max(0, (member.guest_passes_per_month | 0) - used);
  } catch { return 0; }
}

// Membership waivers credit by MEMBER IDENTITY ONLY. The old name-match
// fallback is dead on purpose: a waiver binds the person who signed it, and
// two different John Smiths must never credit each other — a facility that
// believes it holds a signature it does not hold is worse off than one that
// knows to collect. Validity (lapse, annual expiry) lives in one place:
// services/memberwaiver.memberWaiverStatus.
function memberWaiver(memberId) {
  try { return require('./memberwaiver').memberWaiverStatus(memberId); }
  catch { return { on_file: false, expired: false, reason: 'none', signed_id: null }; }
}

function restrictionFor(member, booking) {
  const dayName = DAY_NAMES[new Date(booking.date + 'T12:00:00').getDay()];
  if (member.allowed_days && member.allowed_days.trim()) {
    const days = member.allowed_days.split(',').map(d => d.trim().toLowerCase());
    if (!days.includes(dayName)) return `${member.tier_name} is not valid on ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}s`;
  }
  const startM = toMins(booking.start_time);
  if (member.earliest_time && member.earliest_time.trim() && startM < toMins(member.earliest_time))
    return `${member.tier_name} starts at ${member.earliest_time}`;
  if (member.latest_time && member.latest_time.trim() && startM > toMins(member.latest_time))
    return `${member.tier_name} ends at ${member.latest_time}`;
  if (member.allowed_bays && member.allowed_bays.trim()) {
    const bays = member.allowed_bays.split(',').map(b => b.trim());
    if (booking.bay_id && !bays.includes(booking.bay_id))
      return `${member.tier_name} is not valid on this bay`;
  }
  return null;
}

function seatDiscountPct(member) {
  if (member.share_discount_pct > 0) return Number(member.share_discount_pct);
  if (member.discount_type === 'percentage' && member.discount_value > 0) return Number(member.discount_value);
  return 0; // fixed-amount and hour-based tiers keep full share at the seat level (v1; documented)
}

// SEAT PRICING TRUNK (Aug 25, late): a member code on a seat prices that seat
// the way the tier prices online - for EVERY style, not just percentage.
//   share_discount_pct set (deposit-share model, Example Owner's locked tier) -> share x (1 - pct)
//   percentage   -> share x (1 - value%)
//   fixed        -> share - $value (floored at 0)
//   flat_rate    -> the member's own time at their rate, never more than the share
//                   (a flat-rate tier in DEPOSIT mode keeps Value as the deposit,
//                    so it stays on the share% model)
//   free_hours   -> their free time first (the blend engine with the free hours
//                   as the monthly meter), the after-rate for the rest
//   daily_blend  -> the meter (blendSeatCents)
//   restricted (day/time/bay) -> full share
function seatCents(m, b, shareCents, standardCents) {
  if (!m || !m.valid || m.restricted) return shareCents;
  if (m.blend) return blendSeatCents(m.blend, b, standardCents);
  const t = m.tier || {};
  const pct = Number(m.share_discount_pct != null ? m.share_discount_pct : t.share_discount_pct) || 0;
  if (pct > 0) return Math.round(shareCents * (1 - pct / 100));
  const v = Number(t.discount_value) || 0;
  switch (t.discount_type) {
    case 'percentage': return Math.round(shareCents * (1 - v / 100));
    case 'fixed':      return Math.max(0, shareCents - Math.round(v * 100));
    case 'flat_rate':
      if (t.deposit_mode || t.settlement_mode === 'deposit') return shareCents;   // Value is the deposit, not a rate
      return Math.min(shareCents, Math.round(v * 100 * ((b.duration_minutes || 30) / 30)));
    default: return shareCents;
  }
}

// The booker, shaped like a seat's member info, from the check-in context row.
function bookerSeatInfo(b) {
  if (!b || !b.mid) return null;
  return { valid: true, member_id: b.mid, restricted: null,
    blend: require('./pricing').meterFor({ id: b.mid, discount_type: b.t_discount_type, discount_value: b.t_discount_value,
      hours_per_day: b.t_hpd, hours_per_week: b.t_hpw, hours_per_month: b.t_hpm,
      over_limit_discount_type: b.t_ol_type, over_limit_discount_value: b.t_ol_value }),
    share_discount_pct: b.booker_pct || 0,
    tier: { discount_type: b.t_discount_type, discount_value: b.t_discount_value, share_discount_pct: b.booker_pct,
            deposit_mode: b.t_deposit_mode, settlement_mode: b.t_settlement,
            hours_per_day: b.t_hpd, hours_per_week: b.t_hpw, hours_per_month: b.t_hpm,
            over_limit_discount_type: b.t_ol_type, over_limit_discount_value: b.t_ol_value } };
}

function seatMemberInfo(pin, booking) {
  const member = dbMod.getMemberByPin(String(pin || '').trim());
  if (!member) return { valid: false, message: 'Code not recognized' };
  const restricted = restrictionFor(member, booking);
  const pct = seatDiscountPct(member);
  const mw = memberWaiver(member.id);
  return {
    valid: true,
    member_id: member.id,
    name: member.name,
    tier_name: member.tier_name,
    blend: require('./pricing').meterFor(member),   // blended OR free hours per period (null otherwise)
    badge_color: member.badge_color || '',
    tier: { discount_type: member.discount_type, discount_value: member.discount_value,
            share_discount_pct: member.share_discount_pct, deposit_mode: member.deposit_mode, settlement_mode: member.settlement_mode,
            hours_per_day: member.hours_per_day, hours_per_week: member.hours_per_week, hours_per_month: member.hours_per_month,
            over_limit_discount_type: member.over_limit_discount_type, over_limit_discount_value: member.over_limit_discount_value },
    share_discount_pct: member.share_discount_pct || 0,
    discount_pct: restricted ? 0 : pct,
    restricted: restricted || null,
    restricted_message: restricted ? `${restricted} - golf at regular price today; membership perks still apply.` : null,
    credit_cents: creditBalance(member.id),
    passes_left: passesLeft(member, booking.date.slice(0, 7)),
    waiver_on_file: !!mw.on_file,
    waiver_signed_id: mw.on_file ? mw.signed_id : null,
    waiver_expired: !!mw.expired,
    waiver_expired_message: mw.expired
      ? (mw.reason === 'annual_expired'
          ? 'Membership waiver expired (annual term) - collect a new one.'
          : 'Membership waiver is no longer valid - collect a new one.')
      : null
  };
}

// ── check-in ───────────────────────────────────────────────────────────────

// BLEND SEAT PRICING (Aug 2026): a 'daily_blend' tier seat is priced by ITS
// OWN membership - free time left on the session's date, then the tier's
// after-rate - never by a percentage of the group split. The booking's own
// usage row (recorded at booking time for the booker) is excluded so a
// booking can't eat its own free time. Every other tier style prices exactly
// as before; this dispatch is one more style in the lineup, not a rewrite.
function blendSeatCents(memberRow, b, standardCents) {
  return require('./pricing').computeBlend(memberRow, b.date, b.duration_minutes, standardCents,
    { excludeBookingId: b.id }).memberCents;
}

// Record a blend seat member's hours at check-in (booker's were recorded at
// booking). Idempotent per member+booking - a re-run never double-burns.
function recordSeatUsage(memberId, b) {
  try {
    const has = dbMod.db.prepare(`SELECT 1 AS x FROM member_usage WHERE member_id=? AND booking_id=?`).get(memberId, b.id);
    if (has) return;
    dbMod.db.prepare(`INSERT INTO member_usage (id, member_id, booking_id, date, duration_minutes, guest_count)
      VALUES (?,?,?,?,?,0)`).run(require('uuid').v4(), memberId, b.id, b.date, b.duration_minutes);
  } catch (e) { console.error('seat usage record:', e.message); }
}

function detectCase(b) {
  if (b.is_deposit && b.member_id) return 'member_deposit';
  if (b.is_deposit) return 'booking_deposit';
  if (b.stripe_payment_intent) return 'prepaid';
  return 'pay_here';
}

function checkinContext(bookingId) {
  const b = dbMod.db.prepare(`SELECT b.*, m.id AS mid, m.name AS member_name, mt.name AS tier_name,
      mt.share_discount_pct, mt.deposit_mode,
      mt.discount_type AS t_discount_type, mt.settlement_mode AS t_settlement,
      mt.over_limit_discount_type AS t_ol_type, mt.over_limit_discount_value AS t_ol_value,
      mt.hours_per_day AS t_hpd, mt.hours_per_week AS t_hpw, mt.hours_per_month AS t_hpm
      FROM bookings b LEFT JOIN members m ON m.id = b.member_id
      LEFT JOIN membership_tiers mt ON mt.id = m.tier_id
     WHERE b.id = ?`).get(bookingId);
  if (!b) return null;
  const already = dbMod.db.prepare(`SELECT id, settled_by, settled_at FROM settlements WHERE booking_id = ?`).get(bookingId);
  // (less a booking deal it was made with, or a package's own price - the door's share is worked from what the booking really costs)
  const standard = b.package_id ? (b.price_cents | 0) : Math.max(0, calculatePrice(b.date, b.start_time, b.duration_minutes, b.bay_id) - (b.deal_cents | 0));
  const ctxMw = b.member_id ? memberWaiver(b.member_id) : null;
  const wMode = require('./memberwaiver').cfgWaiver().mode;
  return {
    booking: {
      id: b.id, name: b.name, phone: b.phone, email: b.email, bay_id: b.bay_id, bay_name: b.bay_name,
      date: b.date, start_time: b.start_time, end_time: b.end_time, duration_minutes: b.duration_minutes,
      price_cents: b.price_cents, is_deposit: !!b.is_deposit, has_pi: !!b.stripe_payment_intent,
      member_id: b.member_id || null, member_name: b.member_name || null, tier_name: b.tier_name || null,
      member_due_cents: (b.member_due_cents != null) ? (b.member_due_cents | 0) : null,
      share_discount_pct: b.share_discount_pct || 0,
      member_guest_count: b.member_guest_count || 0,
      waiver_signed: !!b.signature_name || !!(ctxMw && ctxMw.on_file),
      member_waiver: ctxMw ? (ctxMw.on_file ? (ctxMw.renew_due ? 'renew_soon' : 'on_file') : (ctxMw.expired ? 'expired' : null)) : null,
      member_waiver_until: ctxMw && ctxMw.on_file ? (ctxMw.expires_at || null) : null,
      // a package deal (Oct 22 2026): its name, and what it includes - each thing, used and left - for the counter to say
      package_name: b.package_name || '', package_left: b.package_id ? require('./packages').leftFor(b) : null, deal_name: b.deal_name || '',
      // free things a deal gave it (Oct 22 2026, night): each one, used and left - handed over here, $0 on its tabs
      deal_items_left: require('./packages').dealLeftFor(b),
      // a code checked at the door (a military, first-responder, senior or student rate): what to ask to see - Oct 22 2026, night
      door_check: (() => { if (!b.discount_code_id) return ''; try { const c = dbMod.db.prepare(`SELECT code, door_check FROM discount_codes WHERE id=?`).get(b.discount_code_id); return c && c.door_check ? `${c.door_check} (code ${c.code})` : ''; } catch { return ''; } })()
    },
    case: detectCase(b),
    standard_total_cents: standard,
    deposit_cents: b.is_deposit ? (b.price_cents || 0) : 0,
    already_checked_in: already || null,
    credit_mode: (cfg().membership?.depositCreditMode === 'group') ? 'group' : 'member_tab',
    // The counter honours the facility MODE, not just document existence
    // (waiver audit, Sep 1 2026): off = nothing is needed anywhere; offered =
    // chips show, check-in never blocks; required = blocks until every seat signs.
    active_waiver: wMode !== 'off' && (dbMod.getActiveWaiver() ? true : false),
    waiver_enforce: wMode === 'required',
    waiver_guests: require('./memberwaiver').cfgWaiver().guests
  };
}

// Counter collections record against the document this person signs: a
// member signs their TIER's document when the tier pins one (the same one
// they saw at signup - waiver audit, Sep 1 2026), everyone else the facility's
// ACTIVE document. When the signer is a member, the row rides the membership
// (scope + member_id) so it credits their future visits per the tier's term;
// guardian capacity and the document fingerprint ride every row.
function docForSigner(memberId) {
  let w = null;
  if (memberId) {
    try {
      const mrow = dbMod.db.prepare(`SELECT tier_id FROM members WHERE id = ?`).get(memberId);
      w = require('./memberwaiver').docForTier(mrow ? (mrow.tier_id || '') : '');
    } catch {}
  }
  return w || dbMod.getActiveWaiver();
}
function insertWaiverRow(booking, seatName, { method, typedName, employee, ip, memberId, guardianFor }) {
  const w = docForSigner(memberId);
  if (!w) return null; // facility runs with no waiver document — nothing to record
  const id = uid();
  let docHash = '';
  try { docHash = require('./memberwaiver').docSha256(w); } catch {}
  dbMod.db.prepare(`INSERT INTO signed_waivers
    (id, booking_id, waiver_id, waiver_name, waiver_version, customer_name, customer_phone,
     agreed_at, ip_address, signature_name, signed_pdf_path, bay_name, session_date, session_time, method, employee,
     scope, member_id, doc_sha256, guardian_for)
    VALUES (?,?,?,?,?,?,?,datetime('now'),?,?,NULL,?,?,?,?,?,?,?,?,?)`)
    .run(id, booking.id, w.id, w.name, w.version, String(seatName).slice(0, 80), booking.phone || '',
         ip || null, method === 'digital' ? String(typedName).slice(0, 80) : null,
         booking.bay_name || '', booking.date, booking.start_time, method, String(employee || '').slice(0, 40),
         memberId ? 'membership' : 'booking', memberId || '', docHash,
         String(guardianFor || '').slice(0, 80));
  return id;
}

// PRICE FIRST, WRITE SECOND (Aug 25, late). Everything the counter needs to
// know BEFORE committing a check-in - who is on which seat, what each seat
// owes, what the deposit covers - is computed here with no writes at all, so
// the staff stepper can show the SERVER's numbers live (previewCheckin) and
// performCheckin commits exactly those numbers. One trunk, no client math.
function priceCheckin({ booking_id, seats, split_mode }) {
  const b = dbMod.db.prepare(`SELECT b.*, mt.share_discount_pct AS booker_pct, m.id AS mid,
      mt.discount_type AS t_discount_type, mt.settlement_mode AS t_settlement,
      mt.discount_value AS t_discount_value, mt.deposit_mode AS t_deposit_mode,
      mt.over_limit_discount_type AS t_ol_type, mt.over_limit_discount_value AS t_ol_value,
      mt.hours_per_day AS t_hpd, mt.hours_per_week AS t_hpw, mt.hours_per_month AS t_hpm,
      mt.guest_allowed AS t_guest_allowed, mt.guest_max_per_visit AS t_guest_max, mt.guest_passes_per_month AS t_guest_passes,
      mt.guest_pricing_type AS t_guest_type, mt.guest_pricing_value AS t_guest_value, mt.guest_overflow_price AS t_guest_overflow,
      mt.guest_pricing_basis AS t_guest_basis, mt.guest_pricing_set AS t_guest_set, mt.guest_included_per_visit AS t_guest_included, mt.guest_collect AS t_guest_collect
      FROM bookings b LEFT JOIN members m ON m.id = b.member_id
      LEFT JOIN membership_tiers mt ON mt.id = m.tier_id WHERE b.id = ?`).get(booking_id);
  if (!b) return { status: 404, body: { error: 'Booking not found' } };
  if (b.status !== 'active') return { status: 400, body: { error: 'Booking is not active' } };
  const existing = dbMod.db.prepare(`SELECT id FROM settlements WHERE booking_id = ?`).get(booking_id);
  if (existing) return { status: 409, body: { error: 'Already checked in' } };

  if (!Array.isArray(seats) || seats.length < 1 || seats.length > 30)
    return { status: 400, body: { error: 'seats must be 1-30 entries' } };
  const n = seats.length;
  const kase = detectCase(b);
  // (less a booking deal it was made with, or a package's own price - the door's share is worked from what the booking really costs)
  const standard = b.package_id ? (b.price_cents | 0) : Math.max(0, calculatePrice(b.date, b.start_time, b.duration_minutes, b.bay_id) - (b.deal_cents | 0));
  const creditMode = (cfg().membership?.depositCreditMode === 'group') ? 'group' : 'member_tab';
  // Booking-level membership waiver: when the booker is a member with a valid
  // membership waiver, the group is covered per the facility model.
  const bookingMemberWaiver = b.mid ? memberWaiver(b.mid) : null;

  // Resolve members per seat
  const resolved = seats.map((s, i) => {
    const name = String(s.name || '').trim() || (i === 0 ? b.name : 'Guest ' + (i + 1));
    let member = null;
    if (s.member_pin) {
      member = seatMemberInfo(s.member_pin, b);
      if (!member.valid) return { err: `Seat ${i + 1}: code not recognized` };
    }
    return { name, member, raw: s };
  });
  const bad = resolved.find(r => r.err);
  if (bad) return { status: 400, body: { error: bad.err } };

  // Golf math per case (all cents)
  let shares = fairSplit(standard, n);           // pay_here / booking_deposit basis
  let golf = new Array(n).fill(0);
  let memberShare = 0, discountGiven = 0, creditToMember = 0, collect = 0;
  let guestLaw = null;
  const deposit = b.is_deposit ? (b.price_cents || 0) : 0;

  if (kase === 'prepaid') {
    collect = 0;
  } else if (kase === 'member_deposit') {
    // Admin-identical semantics (Segment B proven), now bay-aware.
    const share = Math.round(standard / n);
    const dPct = b.booker_pct || 0;
    const bookerMeter = bookerSeatInfo(b) && bookerSeatInfo(b).blend;
    if (bookerMeter) {
      memberShare = (b.member_due_cents != null) ? (b.member_due_cents | 0)
        : blendSeatCents(bookerMeter, b, standard);
      discountGiven = Math.max(0, share - memberShare);
    } else {
      memberShare = seatCents(bookerSeatInfo(b), b, share, standard);
      discountGiven = share - memberShare;
    }
    // Booker occupies seat 0 by contract; other seats may still carry their OWN
    // member codes for their own tier share.
    const seatShare = (i) => {
      if (i === 0) return memberShare;
      return seatCents(resolved[i].member, b, share, standard);
    };
    if (creditMode === 'member_tab') {
      const bookerOwes = Math.max(0, memberShare - deposit);
      creditToMember = Math.max(0, deposit - memberShare);
      golf = resolved.map((_, i) => i === 0 ? bookerOwes : seatShare(i));
      { const gl = applyGuestLaw(b, resolved, golf, shares, standard); if (gl) { guestLaw = gl; } }
      collect = golf.reduce((a, c) => a + c, 0);
    } else {
      const pool = resolved.reduce((a, _, i) => a + seatShare(i), 0);
      collect = Math.max(0, pool - deposit);
      golf = applySplit(resolved, collect, split_mode, seats, 0);
      if (golf.error) return { status: 400, body: { error: golf.error } };
    }
  } else if (kase === 'booking_deposit') {
    // Seats may discount their own share via member codes; deposit credits the group.
    const adj = resolved.map((r, i) => {
      const m = r.member;
      return seatCents(m, b, shares[i], standard);
    });
    const pool = adj.reduce((a, c) => a + c, 0);
    collect = Math.max(0, pool - deposit);
    golf = applySplit(resolved, collect, split_mode, seats, 0);
    if (golf.error) return { status: 400, body: { error: golf.error } };
  } else { // pay_here
    const bookerBlend = b.mid ? (bookerSeatInfo(b).blend || null) : null;   // blended OR free hours
    golf = resolved.map((r, i) => {
      const m = r.member;
      // seat-level blend tier: priced by its own membership NOW (their
      // check-in is their booking moment), not the split
      if (m && m.valid && !m.restricted && m.blend && !(i === 0 && bookerBlend)) return blendSeatCents(m.blend, b, standard);
      // booker on a blend tier: the price frozen at booking wins - a later
      // same-day booking must never reshuffle whose hour was free. Live
      // compute only if the stamp is missing (legacy rows).
      if (i === 0 && bookerBlend) return (b.member_due_cents != null) ? (b.member_due_cents | 0) : blendSeatCents(bookerBlend, b, standard);
      if (m && m.valid) return seatCents(m, b, shares[i], standard);
      // DOOR-SETTLED non-blend tier: the booking path stamped member_due_cents
      // (nothing charged online), so the booker's own membership prices seat 0
      // without retyping the code. Any other member booking without a payment
      // intent keeps today's behaviour (a typed code prices the seat).
      if (i === 0 && b.mid && b.member_due_cents != null) return seatCents(bookerSeatInfo(b), b, shares[i], standard);
      return shares[i];
    });
    if (bookerBlend) memberShare = golf[0];
    // THE GUEST LAW: the booker's guests by their tier's guest policy
    { const gl = applyGuestLaw(b, resolved, golf, shares, standard); if (gl) { guestLaw = gl; } }
    // guest passes: a member seat can cover another seat's golf entirely
    for (let i = 0; i < n; i++) {
      const from = seats[i] && Number.isInteger(seats[i].use_pass_from_seat) ? seats[i].use_pass_from_seat : null;
      if (from === null) continue;
      if (guestLaw && guestLaw.notes[i]) continue;   // already priced by the booker's guest policy
      const donor = resolved[from] && resolved[from].member;
      if (!donor || !donor.valid) return { status: 400, body: { error: `Seat ${i + 1}: pass donor has no valid member code` } };
      if (donor.passes_left <= 0) return { status: 400, body: { error: `Seat ${i + 1}: ${donor.name} has no guest passes left this month` } };
      donor.passes_left--;
      resolved[i].passBurnFrom = donor;
      golf[i] = 0;
    }
    collect = golf.reduce((a, c) => a + c, 0);
  }

  return { b, n, kase, standard, creditMode, bookingMemberWaiver, resolved, shares, golf, memberShare, discountGiven, creditToMember, collect, deposit, guestLaw };
}

// THE GUEST LAW at the counter (Sep 1 2026): when the booker is a member
// whose tier takes guests, every seat without its own member code is one of
// the booker's guests and is priced by services/guests.js - a pass covers it
// at the tier's covered price, beyond the passes the after-passes price,
// beyond the per-visit cap the regular share. Seats with their own code keep
// their own tier price on their share. A tier that simply says "regular
// share" leaves today's split exactly as it was. Returns null when the law
// does not apply.
function bookerGuestTier(b) {
  if (!b || !b.mid || !b.t_guest_allowed) return null;
  return { id: b.member_id, guest_allowed: 1, guest_max_per_visit: b.t_guest_max | 0, guest_passes_per_month: b.t_guest_passes | 0,
    guest_pricing_type: b.t_guest_type || 'free', guest_pricing_value: b.t_guest_value || 0, guest_overflow_price: b.t_guest_overflow || 0,
    guest_pricing_basis: b.t_guest_basis || 'booking', guest_pricing_set: b.t_guest_set | 0, guest_included_per_visit: b.t_guest_included | 0, guest_collect: b.t_guest_collect || 'auto',
    settlement_mode: b.t_settlement || 'online', deposit_mode: b.t_deposit_mode };
}
function applyGuestLaw(b, resolved, golf, shares, standard) {
  const tier = bookerGuestTier(b);
  if (!tier) return null;
  const guestsSvc = require('./guests');
  const type = guestsSvc.effectiveGuestType(tier);
  if (type === 'share' && !((tier.guest_passes_per_month | 0) > 0) && !((Number(tier.guest_overflow_price) || 0) > 0)) return null;   // plain split - nothing to change
  const guestIdx = [];
  for (let i = 1; i < resolved.length; i++) if (!(resolved[i].member && resolved[i].member.valid)) guestIdx.push(i);
  if (!guestIdx.length) return null;
  const q = guestsSvc.guestQuote({ tier, memberId: b.mid, guests: guestIdx.length, date: b.date, durationMinutes: b.duration_minutes,
    standardCents: standard, excludeBookingId: b.id, context: 'counter' });
  const notes = new Array(resolved.length).fill(null);
  const paidOnline = (b.guest_fee_online_cents | 0) > 0;
  guestIdx.forEach((seat, k) => {
    const g = q.seats[k];
    if (!g) return;
    if (paidOnline && g.kind !== 'over_max') { golf[seat] = 0; notes[seat] = 'Guest - paid online with the booking'; return; }
    if (g.cents !== null) golf[seat] = g.cents;          // null = their regular share, untouched
    const beyond = q.included > 0 && q.passes_left === null ? 'beyond the included' : 'beyond the passes';
    notes[seat] = g.kind === 'included' ? (g.cents === 0 ? 'Guest - included with the membership' : g.cents === null ? 'Guest - regular share' : 'Guest - ' + guestsSvc.money(g.cents) + ' (member guest rate)')
      : g.kind === 'covered' ? (g.cents === 0 ? 'Guest - covered by a pass' : g.cents === null ? 'Guest - regular share' : 'Guest - ' + guestsSvc.money(g.cents) + ' (member guest rate)')
      : g.kind === 'overflow' ? (g.cents === null ? 'Guest - ' + beyond + ', regular share' : g.cents === 0 ? 'Guest - ' + beyond + ', free' : 'Guest - ' + guestsSvc.money(g.cents) + ' ' + beyond)
      : 'Guest - over the ' + q.max + '-guest limit, regular share';
  });
  return { quote: q, notes, covered: q.passes_used };
}

// Dry run for the stepper: the same seats, the same numbers, nothing written.
function previewCheckin({ booking_id, seats, split_mode }) {
  const q = priceCheckin({ booking_id, seats, split_mode });
  if (q.status) return q;
  return { status: 200, body: {
    case: q.kase, standard_total_cents: q.standard, deposit_cents: q.deposit, credit_mode: q.creditMode,
    golf_cents: q.golf, collect_cents: q.collect, member_share_cents: q.memberShare,
    member_discount_cents: q.discountGiven, credit_to_member_cents: q.creditToMember,
    guest_note: q.guestLaw ? q.guestLaw.quote.note : null,
    seats: q.resolved.map((r, i) => ({ name: r.name, golf_cents: q.golf[i], guest: q.guestLaw ? q.guestLaw.notes[i] : null, member: r.member ? { name: r.member.name, tier_name: r.member.tier_name, restricted: r.member.restricted || null } : null }))
  } };
}

function performCheckin({ booking_id, seats, employee, ip, split_mode }) {
  const q = priceCheckin({ booking_id, seats, split_mode });
  if (q.status) return q;
  const { b, n, kase, standard, creditMode, bookingMemberWaiver, resolved, shares, golf, memberShare, discountGiven, creditToMember, collect, deposit, guestLaw } = q;
  // W16 (waiver audit, Sep 1 2026): "required" is required at the SERVER, not
  // only on the pad. Any seat that would end up 'needed' refuses the whole
  // check-in before a single write. 'offered' and 'off' never refuse. The
  // conditions mirror the seat loop below exactly - keep them in step.
  {
    const wcfg = require('./memberwaiver').cfgWaiver();
    if (wcfg.mode === 'required' && dbMod.getActiveWaiver()) {
      let missing = 0;
      for (let i = 0; i < n; i++) {
        const r = resolved[i]; const wreq = seats[i] && seats[i].waiver;
        const covered = (i === 0 && !!b.signature_name)
          || !!(r.member && r.member.valid && r.member.waiver_on_file)
          || !!(wreq && wreq.method === 'digital' && String(wreq.typed_name || '').trim())
          || !!(wreq && wreq.method === 'paper')
          || !!(bookingMemberWaiver && bookingMemberWaiver.on_file && (i === 0 || wcfg.guests !== 'each'));
        if (!covered) missing++;
      }
      if (missing) return { status: 400, body: { error: missing + ' waiver' + (missing > 1 ? 's' : '') + ' still needed before check-in.', waivers_needed: missing } };
    }
  }
  // ── writes ───────────────────────────────────────────────────────────────
  // blend hour-burning: seat members on blend tiers burn their own free time
  // now; the booker's hours were recorded at booking (skip via idempotency).
  resolved.forEach((r) => {
    if (r.member && r.member.valid && r.member.blend) recordSeatUsage(r.member.member_id, b);
  });
  dbMod.db.prepare(`INSERT INTO settlements (booking_id, actual_golfers, standard_total_cents,
      member_share_cents, member_discount_cents, deposit_cents, credit_to_member_cents,
      collect_cents, credit_mode, settled_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(booking_id, n, standard, memberShare, discountGiven,
         (kase === 'prepaid' ? (b.price_cents || 0) : deposit), creditToMember, collect,
         kase === 'prepaid' ? 'prepaid' : (kase === 'pay_here' ? 'pay_here' : creditMode),
         String(employee || 'Staff').slice(0, 60));

  if (creditToMember > 0 && b.mid) {
    dbMod.db.prepare(`INSERT INTO member_credit (member_id, delta_cents, reason, booking_id)
      VALUES (?,?,?,?)`).run(b.mid, creditToMember, 'Deposit surplus at check-in', booking_id);
  }

  // THE GUEST LAW's passes: the booker's covered guests are ONE row for this
  // booking (replacing whatever booking time recorded), never a second burn.
  if (guestLaw && b.mid) {
    try {
      dbMod.db.prepare(`DELETE FROM member_guests WHERE booking_id = ? AND member_id = ?`).run(booking_id, b.mid);
      if (guestLaw.covered > 0) dbMod.db.prepare(`INSERT INTO member_guests (id, member_id, booking_id, date, guest_count) VALUES (?,?,?,?,?)`)
        .run(uid(), b.mid, booking_id, b.date, guestLaw.covered);
    } catch (e) { console.error('guest pass record:', e.message); }
  }
  const outSeats = [];
  for (let i = 0; i < n; i++) {
    const r = resolved[i];
    const memberId = i === 0 && kase === 'member_deposit' ? b.mid : (r.member && r.member.valid ? r.member.member_id : null);
    const tab = pos.openTab({
      booking_id, label: r.name, bay_id: b.bay_id, bay_name: b.bay_name,
      member_id: memberId, employee: String(employee || '').slice(0, 40)
    });
    // A PACKAGE PAID AT THE DOOR (Oct 22 2026): each share named for the package and split by its own tax lines - its golf part
    // as golf, the rest at its counter code - so the counter charges the tax the owner set for it
    const snapP = b.package_json ? (() => { try { return JSON.parse(b.package_json); } catch { return null; } })() : null;
    if (golf[i] > 0 && snapP && snapP.tax && (snapP.tax.lines || []).length) {
      const lines = snapP.tax.lines.filter(l => l.cents > 0), all = lines.reduce((a, l) => a + l.cents, 0) || 1;
      let left = golf[i];
      lines.forEach((l, j) => { const c = j === lines.length - 1 ? left : Math.round(golf[i] * l.cents / all); left -= c; if (c > 0) pos.addGolfLine(tab.id, c, `${snapP.name} - share${lines.length > 1 ? ' (' + l.label + ')' : ''}`, l.category === 'sim' ? 'sim' : l.category); });
    } else if (golf[i] > 0) pos.addGolfLine(tab.id, golf[i], 'Golf - share');

    // credit application (member seats, against their golf, capped by balance)
    let creditApplied = 0;
    const want = seats[i] && (seats[i].apply_credit_cents | 0);
    if (want > 0 && memberId) {
      const bal = creditBalance(memberId);
      creditApplied = Math.min(want, bal, golf[i]);
      if (creditApplied > 0) {
        pos.addGolfLine(tab.id, -creditApplied, 'Member credit applied');
        dbMod.db.prepare(`INSERT INTO member_credit (member_id, delta_cents, reason, booking_id)
          VALUES (?,?,?,?)`).run(memberId, -creditApplied, 'Applied at check-in', booking_id);
      }
    }

    // pass burn record
    if (r.passBurnFrom) {
      dbMod.db.prepare(`INSERT INTO member_guests (id, member_id, booking_id, date, guest_count)
        VALUES (?,?,?,?,1)`).run(uid(), r.passBurnFrom.member_id, booking_id, b.date);
    }

    // waivers — a collection by a member seat (or the booker's own seat on a
    // member booking) records MEMBERSHIP scope so it rides their membership.
    // Booking-member coverage last: the facility model is "the member is
    // responsible for their guests - one waiver covers the group" (an
    // explicit staff collection on a guest seat still records normally).
    let waiverId = null, waiverStatus = 'needed';
    const wreq = seats[i] && seats[i].waiver;
    const waiverMemberId = (i === 0 && b.mid) ? b.mid
      : (r.member && r.member.valid ? r.member.member_id : null);
    const wGuardian = wreq && wreq.guardian_for ? String(wreq.guardian_for) : null;
    // An EXPLICIT collection at the counter always records (a member whose
    // waiver is about to run out re-signs here - renewal, Sep 1 2026); only
    // then do the passive coverages apply.
    if (wreq && wreq.method === 'digital' && String(wreq.typed_name || '').trim()) {
      waiverId = insertWaiverRow(b, r.name, { method: 'digital', typedName: wreq.typed_name.trim(), employee, ip, memberId: waiverMemberId, guardianFor: wGuardian });
      waiverStatus = waiverId ? 'signed' : 'no_waiver_configured';
    } else if (wreq && wreq.method === 'paper') {
      waiverId = insertWaiverRow(b, r.name, { method: 'paper', typedName: null, employee, ip, memberId: waiverMemberId, guardianFor: wGuardian });
      waiverStatus = waiverId ? 'paper' : 'no_waiver_configured';
    } else if (i === 0 && b.signature_name) { waiverStatus = 'signed_online'; }
    else if (r.member && r.member.valid && r.member.waiver_on_file) { waiverId = r.member.waiver_signed_id; waiverStatus = 'on_file'; }
    else if (bookingMemberWaiver && bookingMemberWaiver.on_file && (i === 0 || require('./memberwaiver').cfgWaiver().guests !== 'each')) {
      // facility policy: the member's waiver covers their guests (default);
      // under 'each guest signs' a guest seat with no collection stays 'needed'
      waiverId = bookingMemberWaiver.signed_id;
      waiverStatus = i === 0 ? 'on_file' : 'covered_member';
    }

    const seatId = uid();
    dbMod.db.prepare(`INSERT INTO seats (id, booking_id, name, member_id, tab_id, waiver_signed_id, pass_covered, golf_cents)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(seatId, booking_id, r.name, memberId, tab.id, waiverId, r.passBurnFrom ? 1 : 0, golf[i]);

    outSeats.push({
      id: seatId, name: r.name, tab_id: tab.id, golf_cents: golf[i], guest: guestLaw ? guestLaw.notes[i] : null,
      credit_applied_cents: creditApplied, waiver: waiverStatus,
      member: r.member && r.member.valid ? {
        name: r.member.name, tier: r.member.tier_name, discount_pct: r.member.discount_pct,
        restricted_message: r.member.restricted_message, credit_cents: creditBalance(memberId || ''),
        passes_left: r.member.passes_left
      } : null
    });
  }

  try {
    require('./webhooks').dispatch('checkin.completed', {
      booking_id: b.id, bay: b.bay_name, golfers: n, collect_cents: collect,
      employee: String(employee || '').trim()
    });
  } catch {}
  try {
    dbMod.adminLog('GROUP_CHECKIN', `${b.name} ${b.date} ${b.start_time} - ${n} golfers, ${kase}, collect $${(collect / 100).toFixed(2)}${creditToMember ? `, member credit +$${(creditToMember / 100).toFixed(2)}` : ''} (${String(employee || 'Staff').slice(0, 40)})`);
  } catch {}

  return { status: 200, body: {
    success: true, case: kase, actual_golfers: n,
    standard_total_cents: standard, deposit_cents: deposit,
    member_share_cents: memberShare, member_discount_cents: discountGiven,
    credit_to_member_cents: creditToMember, collect_cents: collect,
    seats: outSeats
  } };
}

// split helper for group-credited remainders (booking_deposit + group-mode deposits):
// custom golf_cents per seat must sum EXACTLY to `remaining`; default = booker
// covered, penny-fair across the other seats (or the booker alone if solo).
function applySplit(resolved, remaining, split_mode, seats, bookerIndex) {
  const n = resolved.length;
  const provided = seats.some(s => s && Number.isFinite(s.golf_cents));
  if (provided) {
    const vals = seats.map(s => (s && Number.isFinite(s.golf_cents)) ? (s.golf_cents | 0) : 0);
    if (vals.some(v => v < 0)) return { error: 'golf_cents cannot be negative' };
    const sum = vals.reduce((a, c) => a + c, 0);
    if (sum !== remaining) return { error: `Split must total ${remaining} cents (got ${sum})` };
    return vals;
  }
  if (split_mode === 'all_even' || n === 1) return fairSplit(remaining, n);
  // friends-even default: booker covered by the deposit
  const out = new Array(n).fill(0);
  const others = fairSplit(remaining, n - 1);
  let k = 0;
  for (let i = 0; i < n; i++) if (i !== bookerIndex) out[i] = others[k++];
  return out;
}

// ── staff bookings ─────────────────────────────────────────────────────────

function overlapsAbs(aStartM, aEndM, bStartM, bEndM) { return aStartM < bEndM && bStartM < aEndM; }

function staffCreateBooking({ bay_id, date, start_time, duration_minutes, name, phone, email, sms_consent, employee, package_id, players }) {
  const c = cfg();
  // MEMBERS-ONLY NOTE: staff bookings deliberately BYPASS the members-only
  // gate (maintainer ruling, Aug 20). It is the owner's facility - comps, walk-in
  // exceptions, and maintenance holds need a path, and this surface is
  // already behind staff credentials.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { status: 400, body: { error: 'Valid date required' } };
  if (!/^\d{2}:\d{2}$/.test(String(start_time || ''))) return { status: 400, body: { error: 'Valid start_time required' } };
  // Same 30-minute grid as the public path. A walk-in at 2:40 is booked for
  // 3:00; staff may power the bay on early, but the booking stays on grid.
  if (!require('./bookingcore').isOnGrid(start_time)) {
    const next = require('./bookingcore').nextSlot(start_time);
    return { status: 400, body: { error: `Sessions start on the hour or half hour - next start is ${next}.`, next_slot: next } };
  }
  const dur = parseInt(duration_minutes);
  if (!dur || dur % 30 || dur < (c.booking.minSessionMins || 30) || dur > (c.booking.maxSessionMins || 240))
    return { status: 400, body: { error: 'duration_minutes must be a 30-min multiple within session limits' } };
  const nm = String(name || '').trim(), ph = require('./phone').normalize(phone);   // one phone shape (Sep 25 2026)
  if (!nm || !ph) return { status: 400, body: { error: 'Name and phone are required - they drive the confirmation and the waiver record' } };

  const bay = (c.bays || []).find(x => x.id === bay_id && x.active !== false);
  if (!bay) return { status: 400, body: { error: 'Unknown bay' } };

  // open day + hours (public windowDays deliberately NOT enforced for staff)
  const dayName = DAY_NAMES[new Date(date + 'T12:00:00').getDay()].slice(0, 3);
  if ((c.booking.openDays || []).length && !c.booking.openDays.includes(dayName))
    return { status: 400, body: { error: 'Facility is closed that day' } };
  const startM = toMins(start_time), endM = startM + dur;
  if (!c.booking.open24Hours) {
    const h = require('./hours').on(c.booking, date);   // (that day's own hours, if it has them)
    if (startM < toMins(h.openTime || '00:00'))
      return { status: 400, body: { error: 'Starts before opening time' } };
    const closeM = toMins(h.closeTime || '23:59') + (h.closeNextDay ? 1440 : 0);
    if (endM > closeM) return { status: 400, body: { error: 'Runs past closing time' } };
  }
  // Cross-midnight is fine now: the trunk computes end_date and the conflict
  // rule compares absolute intervals (tree wave, Aug 11).

  // conflicts on the bay (half-open intervals, buffer honored) — explicit query,
  // never a helper whose column set we haven't verified
  // THE TRUNK: identical conflict rule to the customer path. This used to be
  // its own query that was BLIND TO MID-CHECKOUT bookings, so staff could
  // book straight over a customer who was actively paying.
  {
    const clash = require('./bookingcore').findConflict({
      bay_id, date, start_time, duration_minutes: dur
    });
    if (clash) return { status: 409, body: { error: `Conflicts with ${clash.name} ${clash.start_time}-${clash.end_time}` } };
  }

  // (a booking deal that fits is taken here too, and kept on the row - the counter works the door's share from it)
  const dp = require('./pricing').dealPrice(date, start_time, dur, bay_id);
  // A PACKAGE SOLD AT THE COUNTER (Oct 22 2026; maintainer: "make it possible"): a walk-in party on the birthday package - its price, its
  // copy on the booking, what it includes at $0 on its tabs - as online, collected at the door; never a deal on top
  let pkgC = null, pkgSnap = null;
  if (package_id) {
    const P = require('./packages'); pkgC = P.get(package_id);
    const av = P.availableAt(pkgC, date, start_time, { online: false });
    if (!av.ok) return { status: 400, body: { error: av.why } };
    if (dur !== pkgC.minutes) return { status: 400, body: { error: `That package is ${P.hrs(pkgC.minutes)} of bay time.` } };
    const pl = P.playersFor(pkgC, players);
    if (pl.error) return { status: 400, body: { error: pl.error } };
    pkgSnap = P.snapshot(pkgC, pl.players);
  }
  const price = pkgSnap ? pkgSnap.price_cents : dp.cents;
  const id = uid();
  const span = require('./bookingcore').computeEnd(date, start_time, dur);
  // Under whole-facility mode a staff booking owns the building too - the
  // stamped row blocks every bay and fires every bay's automation, with the
  // staff-chosen bay recorded as the primary. Per-bay mode: unchanged.
  const _wf = c.booking?.wholeFacility ? 1 : 0;
  dbMod.db.prepare(`INSERT INTO bookings
      (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date,
       duration_minutes, price_cents, status, sms_consent, is_deposit, whole_facility)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?, 0, ?)`)
    .run(id, bay.id, _wf ? (c.server?.businessName || 'Entire facility') : bay.name, nm.slice(0, 80), ph.slice(0, 30), String(email || '').trim().slice(0, 120) || null,
         date, start_time, span.end_time, span.end_date, dur, price, sms_consent ? 1 : 0, _wf);

  if (pkgSnap) { try { dbMod.db.prepare(`UPDATE bookings SET package_id=?, package_name=?, package_json=? WHERE id=?`).run(pkgC.id, pkgC.name, JSON.stringify(pkgSnap), id); } catch (e) {} }
  else if (dp.deal) { try { dbMod.db.prepare(`UPDATE bookings SET deal_name=?, deal_cents=? WHERE id=?`).run(dp.deal.name, dp.deal.cents | 0, id); } catch (e) {} }
  // (free things with it - "2 pitchers free with 2 hours" - as online: kept on the row, $0 at the counter; never with a package)
  if (!pkgSnap) require('./deals').stampItems(id, date, start_time, dur);
  const booking = dbMod.db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id);

  // THE TRUNK: the identical post-create fan-out the customer path runs -
  // receipt, webhook, confirmation SMS, confirmation email. Kept in one place
  // so a new effect added later reaches staff bookings automatically.
  require('./bookingcore').afterCreate(booking, { source: 'staff' }).catch(() => {});
  try { dbMod.adminLog('STAFF_BOOKING', `${booking.name} ${booking.date} ${booking.start_time}-${booking.end_time} ${booking.bay_name} $${(price / 100).toFixed(2)} pay-at-facility (${String(employee || 'Staff').slice(0, 40)})`); } catch {}

  // A STARTED SLOT, FROM THE COUNTER (maintainer, Sep 27 2026): staff may book one - the customer is
  // standing there - and are told plainly how far in it already is. Online it is refused.
  const ss = require('./startedslot');
  const startedMinsAgo = ss.startedMinsAgo(booking.date, booking.start_time);
  return { status: 200, body: { success: true, booking: {
    id: booking.id, bay_id: booking.bay_id, bay_name: booking.bay_name, name: booking.name,
    date: booking.date, start_time: booking.start_time, end_time: booking.end_time,
    duration_minutes: booking.duration_minutes, price_cents: booking.price_cents,
    payment: 'pay_here'
  }, startedMinsAgo, warning: ss.staffWarning(startedMinsAgo) } };
}

function groupView(bookingId) {
  // The facility's waiver MODE, read here at the top of the function that uses
  // it. checkinContext has its own copy; a helper from another function's body
  // is not in scope here, and reaching for one is how a handler dies silently
  // (pilot facility failure #5, and the reason test-scope.js exists).
  const gvWaiverMode = (() => { try { return require('./memberwaiver').cfgWaiver().mode; } catch { return 'required'; } })();
  const b = dbMod.db.prepare(`SELECT id, name, bay_id, bay_name, date, start_time, end_time FROM bookings WHERE id = ?`).get(bookingId);
  if (!b) return null;
  const settle = dbMod.db.prepare(`SELECT settled_by, settled_at, actual_golfers, collect_cents FROM settlements WHERE booking_id = ?`).get(bookingId);
  const rows = dbMod.db.prepare(`SELECT * FROM seats WHERE booking_id = ? ORDER BY created_at`).all(bookingId);
  const seats = rows.map(s => {
    let tab = null;
    try { tab = s.tab_id ? pos.getTab(s.tab_id) : null; } catch { tab = null; }
    return {
      id: s.id, name: s.name, member_id: s.member_id, tab_id: s.tab_id,
      // No active waiver configured = nothing to demand (maintainer, Aug 14), AND the
      // facility's MODE decides too (W37): 'off' deliberately keeps the
      // document and the whole archive so the owner can flip back instantly,
      // so "a document exists" was never the right question. This said
      // "Waiver needed" on a pad at a facility that had switched waivers off.
      waiver: s.waiver_signed_id ? 'signed'
        : ((gvWaiverMode !== 'off' && dbMod.getActiveWaiver && dbMod.getActiveWaiver()) ? 'needed' : 'none'),
      pass_covered: !!s.pass_covered, golf_cents: s.golf_cents,
      tab_status: tab ? tab.status : null,
      due_cents: tab ? tab.due_cents : 0,
      items_count: tab ? tab.items.filter(i => i.kind !== 'golf' && i.status !== 'voided').length : 0
    };
  });
  return {
    booking: b,
    checked_in: !!settle,
    checked_in_by: settle ? settle.settled_by : null,
    seats,
    all_settled: seats.length > 0 && seats.every(s => s.tab_status === 'closed' || s.due_cents === 0)
  };
}

// Extend a running session by 30-minute steps. The next booking on the bay
// (plus buffer) is the wall; the new end must stay same-day (cross-midnight
// staff work lands in a later wave). When a tab_id is given, the extension
// golf goes on that tab at the bay-aware price for the ADDED window - prepaid
// and deposit groups can extend without a charge by omitting it. The scheduler
// reads end_time fresh every tick, so warnings and shutdown follow the new end
// with zero extra wiring.
function extendBooking({ booking_id, minutes, tab_id, employee, pay_checks, pay_split, pay_tabs }) {
  const b = dbMod.db.prepare(`SELECT b.*, m.id AS mid,
      mt.discount_type AS t_discount_type, mt.discount_value AS t_discount_value,
      mt.over_limit_discount_type AS t_ol_type, mt.over_limit_discount_value AS t_ol_value,
      mt.hours_per_day AS t_hpd, mt.hours_per_week AS t_hpw, mt.hours_per_month AS t_hpm
      FROM bookings b LEFT JOIN members m ON m.id = b.member_id
      LEFT JOIN membership_tiers mt ON mt.id = m.tier_id WHERE b.id = ?`).get(booking_id);
  if (!b) return { status: 404, body: { error: 'Booking not found' } };
  if (b.status !== 'active') return { status: 400, body: { error: 'Booking is not active' } };
  const add = parseInt(minutes);
  if (!add || add % 30 || add < 30 || add > 120)
    return { status: 400, body: { error: 'minutes must be 30-120 in 30-minute steps' } };
  const oldEndM = toMins(b.end_time);
  const newEndM = oldEndM + add;
  // Cross-midnight is fine - the trunk computes end_date and compares absolute
  // intervals (staff bookings already allow it).
  const c = cfg();
  if (!c.booking.open24Hours) {
    const h = require('./hours').on(c.booking, b.date);
    const closeM = toMins(h.closeTime || '23:59') + (h.closeNextDay ? 1440 : 0);
    if (newEndM > Math.min(closeM, 1440))
      return { status: 400, body: { error: 'Extension runs past closing time' } };
  }
  // THE TRUNK. This was a FIFTH independent conflict check (missed in the tree
  // wave): it only looked at same-date rows, so a session already running past
  // midnight was invisible, and it ignored bookings in mid-checkout - a
  // customer actively paying for the next slot could be extended straight over.
  const core = require('./bookingcore');
  const clash = core.findConflict({
    bay_id: b.bay_id, date: b.date, start_time: b.end_time,
    duration_minutes: add, excludeId: booking_id
  });
  if (clash) return { status: 409, body: { error: `Bay has ${clash.name} at ${clash.start_time} - extension blocked` } };

  const addPublic = calculatePrice(b.date, b.end_time, add, b.bay_id);
  // MEMBERSHIP ON EXTENSIONS (Aug 25): "additional bay time is just $X/hour"
  // applies to extensions too. A blend booker's slice of the added time is
  // priced by their tier's blend on the ADD alone - member_usage already holds
  // the session so far, so free time is naturally current. Guests split the
  // public price of THEIR heads' share. Heads = booker + booked guests.
  let addPrice = addPublic, extMemberCents = null, extGuestsCents = null;
  const extMeter = require('./pricing').meterFor({ id: b.mid, discount_type: b.t_discount_type, discount_value: b.t_discount_value,
    hours_per_day: b.t_hpd, hours_per_week: b.t_hpw, hours_per_month: b.t_hpm,
    over_limit_discount_type: b.t_ol_type, over_limit_discount_value: b.t_ol_value });
  if (extMeter && b.mid) {
    const heads = 1 + (b.member_guest_count | 0);
    const memberSlicePublic = Math.round(addPublic / heads);
    extMemberCents = require('./pricing').computeBlend(extMeter, b.date, add, memberSlicePublic).memberCents;
    extGuestsCents = addPublic - memberSlicePublic;   // guests' heads at public rate
    addPrice = extMemberCents + extGuestsCents;
    // the member's meter burns the added minutes (idempotent per booking+ext not
    // needed: one row per extension keeps future blends honest)
    try { dbMod.db.prepare(`INSERT INTO member_usage (id, member_id, booking_id, date, duration_minutes, guest_count)
      VALUES (?,?,?,?,?,0)`).run(require('uuid').v4(), b.mid, b.id + ':ext:' + Date.now(), b.date, add); } catch (e) {}
  }
  dbMod.db.prepare(`UPDATE bookings SET end_time = ?, duration_minutes = duration_minutes + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(minsToTime(newEndM), add, booking_id);
  // the owner's automations hear the new end (Oct 19 2026)
  try { const wh = require('./webhooks'); const now = dbMod.db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(booking_id); if (now) wh.dispatch('booking.changed', Object.assign(wh.bookingFields(now), { change: 'extended', extended_minutes: add, was: { end_time: b.end_time } })); } catch {}
  // A-wave 11b: the after-end work was scheduled from the ORIGINAL end and
  // ensureJob is INSERT OR IGNORE, so the old times stood - the door code was
  // revoked and the bay powered down twenty minutes after the end the customer
  // just paid to move. Drop the rows that have not run; the next tick reads
  // end_time fresh and schedules them again on the new end. (Anything already
  // done or running is left exactly as it is.)
  try {
    dbMod.db.prepare(
      `DELETE FROM automation_jobs WHERE booking_id=? AND status='pending'
         AND kind IN ('door_revoke','shutdown','power_off','ir_off','ending_warning')
         AND device_key NOT LIKE 'left:%'`).run(booking_id);   // a bay the session LEFT keeps its switch-offs (the review)
  } catch {}
  // AND TELL THE DOOR (Sep 16 2026). A-wave 11b moved the after-end JOBS onto
  // the new end; the credential itself still expired at the old one, because a
  // UniFi visitor's only bound is the epoch pair sent when it was created. The
  // customer paid for another hour and their code stopped working partway
  // through it - with every health signal green, because from our side nothing
  // had failed. The scheduler's next tick picks this up and moves the window at
  // the door; it retries on its own if the console is briefly unreachable, and
  // it expires at the new end because moving a window after that means nothing.
  if (b.remotelock_person_id) {
    try {
      const dl = require('./doorlock');
      const { endDt } = dl.codeWindow(Object.assign({}, b, { end_time: minsToTime(newEndM) }));
      // ONCE IS NOT ENOUGH (Sep 16 2026). ensureJob is INSERT OR IGNORE, so the
      // row left behind by the FIRST extension - status 'done' - silently
      // swallowed the second one, and a customer who extended twice was locked
      // out from the first new end. The blanket DELETE above only takes 'pending'
      // rows, which a finished door_window is not. Clear it whatever its status,
      // then queue: this job is idempotent by nature (it sets an absolute window
      // from the booking's current end, it does not accumulate).
      try { dbMod.db.prepare(`DELETE FROM automation_jobs WHERE booking_id=? AND kind='door_window'`).run(booking_id); } catch {}
      // A provider that cannot move a window must not be handed a job that can
      // only fail. RemoteLock is the DEFAULT provider, so queueing one there
      // turned every routine counter extension into six retries and an
      // AUTOMATION_FAILED on the health line.
      // THE OWNER IS TOLD WHAT IS ACTUALLY TRUE (Sep 17 2026). This asked a
      // yes/no and used the NO for both of the two very different cases behind
      // it. A UniFi MEMBER BOOST needs nothing moved - its door access is
      // bounded by the booking and the revoke job has already been put on the
      // new end - so the owner was reading "the code still expires at the
      // original end" about a code that kept working, and being sent to the
      // console to fix nothing. Three states now (rule 31).
      const moveState = dl.windowMoveState(b.remotelock_person_id);
      if (moveState === 'follows-booking') {
        try { dbMod.adminLog('DOOR_WINDOW_FOLLOWS_BOOKING', `${booking_id}: this member's door access follows the booking, so the extra time is already covered - nothing to change at the door`); } catch {}
        throw { handled: true };
      }
      if (moveState !== 'move') {
        try { dbMod.adminLog('DOOR_WINDOW_MANUAL', `${booking_id}: the session was extended but this lock cannot have a live code's window moved from here - the code still expires at the original end`); } catch {}
        throw { handled: true };
      }
      require('./automation').ensureJob({
        booking_id: booking_id, kind: 'door_window',
        due_at: new Date(), deadline_at: endDt
      });
    } catch (e) {
      if (!(e && e.handled)) { try { dbMod.adminLog('DOOR_WINDOW_QUEUE_ERROR', `${booking_id}: ${e.message.slice(0, 140)}`); } catch {} }
    }
  }

  let charged = null;
  if (tab_id) {
    const tab = pos.getTab(tab_id);
    if (!tab || tab.status !== 'open')
      return { status: 400, body: { error: 'Extension time was added, but that tab is not open - add the golf line by hand', extended_to: minsToTime(newEndM) } };
    // Two lines when membership priced the extension: the member's slice at
    // their rate, the guests' slice at public - each movable like any line.
    let lineId;
    if (extMemberCents != null) {
      if (extMemberCents > 0) pos.addGolfLine(tab_id, extMemberCents, `Golf - extension ${add} min (member rate)`);
      lineId = pos.addGolfLine(tab_id, extGuestsCents, `Golf - extension ${add} min (guests)`);
    } else {
      lineId = pos.addGolfLine(tab_id, addPrice, `Golf - extension ${add} min`);
    }
    // WHO PAYS FOR THE EXTRA TIME. One person may cover it, or the group
    // splits it evenly - the same question the counter asks out loud. Extra
    // time is a normal line, so it can also be moved or re-shared afterwards.
    try {
      const checksSvc = require('./checks');
      checksSvc.ensureDefaultCheck(tab_id);
      checksSvc.attachNewItems(tab_id);
      const all = checksSvc.listChecks(tab_id).map(x => x.id);
      let targets = null;
      if (pay_split === 'even') targets = all;
      else if (Array.isArray(pay_checks) && pay_checks.length) {
        targets = pay_checks.filter(id => all.includes(id));
      }
      if (targets && targets.length > 1) checksSvc.shareItem(tab_id, lineId, targets);
      else if (targets && targets.length === 1) checksSvc.moveItem(tab_id, lineId, targets[0]);
    } catch (e) { /* unsplit tabs keep today's behaviour: one line, one check */ }

    // GROUPS: every seat has its own tab, so "who pays for the extra time" is
    // which PEOPLE it lands on. Pick three and it splits three ways; pick two
    // and it is 50/50; pick one and they cover it. Same rules as a shared
    // plate, and it can still be re-shared afterwards.
    try {
      if (Array.isArray(pay_tabs) && pay_tabs.length > 1) {
        const others = pay_tabs.filter(id => id !== tab_id);
        if (others.length) {
          const all = [tab_id, ...others];
          // MEMBERSHIP FOLLOWS THE PERSON: a member's share of the extra time
          // carries their golf discount, exactly as their original share did.
          // Their code was typed in at the counter and is remembered on the
          // seat - it must not be forgotten the moment time is added.
          const perksMod = require('./memberperks');
          const pcts = all.map(id => perksMod.golfPct(perksMod.perksForTab(id)));
          const out = require('./checks').shareItemAcrossTabs(lineId, all, employee, pcts);
          charged = { tab_id, amount_cents: addPrice, shared_across: all.length,
                      paid_by: `split ${all.length} ways`,
                      member_discounts: pcts.some(p => p > 0), shares: out.shares };
        }
      }
    } catch (e) {
      try { dbMod.adminLog('EXTEND_SPLIT_FAILED', `${booking_id}: ${e.message}`); } catch {}
    }
    if (!charged) {
      charged = { tab_id, amount_cents: addPrice, line_id: lineId,
                  paid_by: pay_split === 'even' ? 'split evenly' : (pay_checks && pay_checks.length === 1 ? 'one person' : 'tab') };
    }
  }
  try { dbMod.adminLog('BOOKING_EXTENDED', `${b.name} ${b.date} +${add} min to ${minsToTime(newEndM)}${charged ? ` - $${(addPrice / 100).toFixed(2)} on tab` : ' - no charge line'} (${String(employee || 'Staff').slice(0, 40)})`); } catch {}
  return { status: 200, body: { success: true, end_time: minsToTime(newEndM), added_minutes: add, price_cents: addPrice, charged } };
}


// ── Seat rename + paper waiver (maintainer mobile findings, Aug 14) ──────────────────
function renameSeat(seatId, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Name required.');
  const seat = dbMod.db.prepare(`SELECT * FROM seats WHERE id=?`).get(seatId);
  if (!seat) throw new Error('Seat not found.');
  dbMod.db.prepare(`UPDATE seats SET name=? WHERE id=?`).run(clean, seatId);
  if (seat.tab_id) dbMod.db.prepare(`UPDATE tabs SET label=? WHERE id=?`).run(clean, seat.tab_id);
  dbMod.flushed().catch(() => {});   // written now, never freezing the unit (see bookingledger)
  return { ok: true, name: clean };
}

function markWaiverPaper(seatId, staffName) {
  const seat = dbMod.db.prepare(`SELECT * FROM seats WHERE id=?`).get(seatId);
  if (!seat) throw new Error('Seat not found.');
  if (seat.waiver_signed_id) return { ok: true, already: true };
  const w = docForSigner(seat.member_id || null);
  if (!w) throw new Error('No active waiver is configured.');
  const b = dbMod.db.prepare(`SELECT * FROM bookings WHERE id=?`).get(seat.booking_id);
  if (!b) throw new Error('Booking not found for this seat.');
  // Through the one true insert: method='paper' + the verifying employee are
  // recorded properly (the old inline INSERT here left method at its 'digital'
  // default and wrote an ISO timestamp where every other row uses
  // datetime('now') — both fixed by unifying). A member seat rides membership.
  const sigId = insertWaiverRow(b, seat.name, {
    method: 'paper', typedName: null, employee: staffName || 'staff', ip: null,
    memberId: seat.member_id || null, guardianFor: null
  });
  if (!sigId) throw new Error('No active waiver is configured.');
  dbMod.db.prepare(`UPDATE seats SET waiver_signed_id=? WHERE id=?`).run(sigId, seatId);
  dbMod.flushed().catch(() => {});   // written now, never freezing the unit (see bookingledger)
  return { ok: true };
}

module.exports = { seatMemberInfo, checkinContext, performCheckin, previewCheckin, staffCreateBooking, fairSplit, groupView, extendBooking, renameSeat, markWaiverPaper };
