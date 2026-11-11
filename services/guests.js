// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// THE GUEST LAW (Sep 1 2026, maintainer's prospect: "a members-only place allowing one
// guest - they come with 4 - the 2 uncovered guests have to pay").
//
// One rule for a member's guests, used by the booking page, the booking
// route and the counter, so the number a member sees online is the number
// the pad collects. A tier says:
//   guest_allowed            - may this tier bring guests at all
//   guest_max_per_visit      - hard cap per visit (0 = no cap); the booking
//                              page refuses more, the counter prices seats
//                              beyond it at the regular share
//   guest_included_per_visit - guests covered on EVERY visit (maintainer: "allow one
//                              guest"), before any monthly passes are touched
//   guest_passes_per_month   - a monthly pool of covered guests on top of that
//                              (both 0 = every guest is covered)
//   guest_collect            - where the fees are collected: 'auto' (with the
//                              member's golf: online when the tier charges
//                              online or nobody is at the door, the counter
//                              when the tier settles at the door), 'online'
//                              (always with the booking - honor-system clubs),
//                              'door' (the counter wherever someone is there)
//   guest_pricing_type       - what a COVERED guest pays:
//        'free'        nothing
//        'flat'        $guest_pricing_value each (x hours when basis = hour)
//        'percentage'  their regular per-head share minus guest_pricing_value %
//        'share'       their regular per-head share of the bay at the counter
//                      (nothing online); with passes, a covered guest is free
//   guest_overflow_price     - what a guest AFTER the passes pays each
//                              (0 = free on free/flat, the regular share on
//                              'share')
//   guest_pricing_basis      - 'booking' (flat per visit) or 'hour'
//
// Legacy rows: tiers saved before this law carry guest_pricing_set = 0. A
// legacy door/deposit tier that said "free" with no monthly limit really got
// "regular share" at the counter (that is what the counter did with it and
// what the guide promised), so that is what it still means. Explicit saves
// from the tier editor are honoured verbatim.
'use strict';
const dbMod = require('./db');

const TYPES = ['share', 'free', 'flat', 'percentage'];

function monthBounds(dateStr) {
  const d = new Date(String(dateStr || '').slice(0, 10) + 'T12:00:00');
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const fmt = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  return { monthStart: fmt(start), monthEnd: fmt(end) };
}

function effectiveGuestType(t) {
  const type = String((t && t.guest_pricing_type) || 'free');
  const settle = String((t && t.settlement_mode) || 'online');
  if (t && !t.guest_pricing_set && type === 'free' && !((t.guest_passes_per_month | 0) > 0) &&
      (settle === 'door' || settle === 'deposit' || !!t.deposit_mode)) return 'share';
  return TYPES.includes(type) ? type : 'free';
}

// Passes left this calendar month. null = unlimited (no monthly limit) or the
// tier takes no guests. excludeBookingId keeps a booking from eating its own
// passes when it is re-quoted at the counter.
// Where this tier's guest fees are collected for a given booking.
function collectMode(t, { staffedHere, doorSettle }) {
  const mode = String((t && t.guest_collect) || 'auto');
  if (mode === 'online') return 'online';
  if (mode === 'door') return staffedHere ? 'counter' : 'online';
  return doorSettle ? 'counter' : 'online';
}

function guestPassesLeft(memberId, t, dateStr, excludeBookingId) {
  if (!t || !t.guest_allowed || !((t.guest_passes_per_month | 0) > 0)) return null;
  const { monthStart, monthEnd } = monthBounds(dateStr);
  let used = 0;
  try {
    const sql = `SELECT COALESCE(SUM(guest_count),0) AS c FROM member_guests WHERE member_id=? AND date>=? AND date<=?` + (excludeBookingId ? ` AND booking_id != ?` : '');
    const args = excludeBookingId ? [memberId, monthStart, monthEnd, excludeBookingId] : [memberId, monthStart, monthEnd];
    used = (dbMod.db.prepare(sql).get(...args) || {}).c | 0;
  } catch {}
  return Math.max(0, (t.guest_passes_per_month | 0) - used);
}

function money(c) { return '$' + (Math.round(c) / 100).toFixed(2); }

// The quote. seats[] is one entry per guest in order: covered first, then
// overflow, then over the cap. cents === null means "their regular share of
// the bay" - the counter splits it; online it is nothing (the member's
// booking already paid for the bay).
function guestQuote({ tier, memberId, guests, date, durationMinutes, standardCents, excludeBookingId, context }) {
  const t = tier || {};
  const g = Math.max(0, parseInt(guests, 10) || 0);
  const type = effectiveGuestType(t);
  const max = t.guest_max_per_visit | 0;
  const inc = t.guest_included_per_visit | 0;
  const out = { allowed: !!t.guest_allowed, type, max, guests: g, included: inc, passes_left: null, passes_used: 0, covered: 0, overflow: 0, over_max: 0,
    per_covered_cents: 0, per_overflow_cents: null, seats: [], total_cents: 0, note: '', error: null, basis: t.guest_pricing_basis === 'hour' ? 'hour' : 'booking' };
  if (g === 0) return out;
  if (!t.guest_allowed) {
    // No guest POLICY on this tier: friends are simply heads - nothing online,
    // their regular share of the bay at the counter (today's behaviour, the
    // guide's promise). Refusing them would take an option away (rule 1).
    out.type = 'share';
    for (let i = 0; i < g; i++) out.seats.push({ kind: 'covered', cents: null });
    out.covered = g; out.per_covered_cents = null;
    out.note = (g === 1 ? '1 guest pays' : g + ' guests pay') + ' their regular share at the counter';
    return out;
  }
  if (max > 0 && g > max) out.error = `Your membership allows ${max} guest${max === 1 ? '' : 's'} per visit.`;
  const hoursMult = out.basis === 'hour' ? Math.max(0.5, (parseInt(durationMinutes, 10) || 30) / 60) : 1;
  const heads = 1 + g;
  const shareCents = Math.round((standardCents || 0) / heads);
  const perCovered = type === 'flat' ? Math.round((Number(t.guest_pricing_value) || 0) * 100 * hoursMult)
    : type === 'percentage' ? Math.max(0, Math.round(shareCents * (1 - (Number(t.guest_pricing_value) || 0) / 100)))
    : 0;
  const overflowPrice = Number(t.guest_overflow_price) || 0;
  const perOverflow = overflowPrice > 0 ? Math.round(overflowPrice * 100 * hoursMult) : (type === 'share' ? null : 0);
  out.passes_left = guestPassesLeft(memberId, t, date, excludeBookingId);
  const withinMax = max > 0 ? Math.min(g, max) : g;
  out.over_max = g - withinMax;
  // the allowance: included-per-visit first, then the monthly pool; neither
  // set = every guest is covered (the legacy "unlimited")
  const hasAllowance = inc > 0 || (t.guest_passes_per_month | 0) > 0;
  const byVisit = hasAllowance ? Math.min(withinMax, inc) : 0;
  const byPass = (hasAllowance && out.passes_left !== null) ? Math.min(withinMax - byVisit, out.passes_left) : 0;
  out.covered = hasAllowance ? byVisit + byPass : withinMax;   // no allowance = every guest is covered (at the covered price)
  out.passes_used = byPass;
  out.overflow = withinMax - out.covered;
  // a covered guest on a 'share' tier: free when the allowance covers them,
  // their share when the tier simply has no allowance at all
  const coveredCents = type === 'share' ? (hasAllowance ? 0 : null) : perCovered;
  out.per_covered_cents = coveredCents;
  out.per_overflow_cents = perOverflow;
  for (let i = 0; i < g; i++) {
    if (i < byVisit) out.seats.push({ kind: 'included', cents: coveredCents });
    else if (i < out.covered) out.seats.push({ kind: 'covered', cents: coveredCents });   // a pass, or every guest when there is no allowance
    else if (i < withinMax) out.seats.push({ kind: 'overflow', cents: perOverflow });
    else out.seats.push({ kind: 'over_max', cents: null });
  }
  out.total_cents = out.seats.reduce((a, s) => a + (s.cents || 0), 0);
  out.note = describe(out, context || 'booking');
  return out;
}

function describe(q, context) {
  const atCounter = context === 'counter';
  const shareTxt = atCounter ? 'their regular share at the counter' : 'their regular share at the counter';
  const parts = [];
  const cov = q.covered, ov = q.overflow, om = q.over_max;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const incN = q.seats.filter(s => s.kind === 'included').length, passN = q.seats.filter(s => s.kind === 'covered').length;
  const priceTxt = q.per_covered_cents ? ' at ' + money(q.per_covered_cents) + ' each' : '';
  if (incN > 0) parts.push(plural(incN, 'guest') + ' included with your membership' + priceTxt);
  if (passN > 0) {
    if (q.passes_left !== null) parts.push(plural(passN, 'guest') + ' covered by your pass' + (passN === 1 ? '' : 'es') + priceTxt);
    else if (q.per_covered_cents === null) parts.push(plural(passN, 'guest') + ' pay' + (passN === 1 ? 's' : '') + ' ' + shareTxt);
    else if (q.per_covered_cents === 0) parts.push(plural(passN, 'guest') + ' free');
    else parts.push(plural(passN, 'guest') + priceTxt);
  }
  const beyond = q.included > 0 && q.passes_left === null ? 'beyond the included' : 'beyond your passes';
  const perHr = q.basis === 'hour' ? ' (per hour)' : '';
  if (ov > 0) {
    if (q.per_overflow_cents === null) parts.push(plural(ov, 'guest') + ' ' + beyond + ' pay' + (ov === 1 ? 's' : '') + ' ' + shareTxt);
    else if (q.per_overflow_cents === 0) parts.push(plural(ov, 'guest') + ' ' + beyond + ' free');
    else parts.push(plural(ov, 'guest') + ' ' + beyond + ' at ' + money(q.per_overflow_cents) + ' each' + perHr);
  }
  if (om > 0) parts.push(plural(om, 'guest') + ' over the ' + q.max + '-guest limit pay' + (om === 1 ? 's' : '') + ' ' + shareTxt);
  return parts.join(' - ');
}

// One sentence for the tier editor / plain-words box, from tier fields.
function policySentence(t) {
  if (!t || !t.guest_allowed) return 'No guests on this tier.';
  const type = effectiveGuestType(t);
  const max = t.guest_max_per_visit | 0, passes = t.guest_passes_per_month | 0;
  const basis = t.guest_pricing_basis === 'hour' ? ' per hour' : '';
  const covered = type === 'free' ? 'free' : type === 'flat' ? money((Number(t.guest_pricing_value) || 0) * 100) + basis + ' each' : type === 'percentage' ? (Number(t.guest_pricing_value) || 0) + '% off their regular share' : (passes > 0 ? 'free' : 'their regular share of the bay at the counter');
  const ovp = Number(t.guest_overflow_price) || 0;
  const after = ovp > 0 ? money(ovp * 100) + basis + ' each' : (type === 'share' ? 'their regular share at the counter' : 'free');
  const inc = t.guest_included_per_visit | 0;
  let s = 'Guests: ' + (max > 0 ? 'up to ' + max + ' per visit' : 'no per-visit cap') + '. ';
  const allow = [];
  if (inc > 0) allow.push(inc + ' included every visit');
  if (passes > 0) allow.push(passes + ' more per month from passes');
  if (allow.length) s += allow.join(', ') + ' (' + covered + '); after that each guest pays ' + after + '.';
  else s += 'Every guest pays ' + covered + '.';
  const mode = String(t.guest_collect || 'auto');
  s += mode === 'online' ? ' Guest fees are collected online with the booking.' : mode === 'door' ? ' Guest fees are collected at the counter wherever someone is there, online otherwise.' : ' Guest fees follow the member\'s golf: online when the tier charges online or nobody is at the door, at the counter when the tier settles there.';
  return s;
}

module.exports = { TYPES, monthBounds, effectiveGuestType, guestPassesLeft, guestQuote, policySentence, collectMode, money };
