// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/pricing.js  —  Tiered Pricing, Discount Codes & Membership Pricing
//
//  Pricing tiers defined in database via admin panel.
//  Falls back to config.json pricePerHalfHour if no tiers configured.
//
//  Days format: "mon,tue,wed,thu,fri" or "sat,sun" or "mon,tue,wed,thu,fri,sat,sun"
// ═══════════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');
const { getConfig }  = require('./config');

const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];

function dbModule() { return require('./db'); }
function db()       { return require('./db').db; }

/** Get day name from a date string YYYY-MM-DD */
function getDayName(dateStr) {
  return DAY_NAMES[new Date(dateStr + 'T12:00:00').getDay()];
}

/** Convert HH:MM to minutes */
function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Get the price per half hour for a given date and start time.
 * Checks pricing tiers in order — first match wins.
 * Falls back to config pricePerHalfHour if no tiers set.
 */
function getPricePerHalfHour(dateStr, startTime) {
  try {
    const tiers = db().prepare(
      `SELECT * FROM pricing_tiers WHERE active=1 ORDER BY sort_order ASC`
    ).all();

    const dayName  = getDayName(dateStr);
    const startMin = toMins(startTime);

    for (const tier of tiers) {
      const days      = tier.days.split(',').map(d => d.trim().toLowerCase());
      const tierStart = toMins(tier.start_time);
      const tierEnd   = toMins(tier.end_time);

      if (days.includes(dayName) && startMin >= tierStart && startMin < tierEnd) {
        return tier.price_per_half_hour;
      }
    }

  } catch {
    // Use the configured base rate if pricing tiers are unavailable.
  }
  const basePrice = getConfig().booking.pricePerHalfHour;
  return basePrice === 0 ? 0 : (basePrice || 15);
}

/**
 * Calculate total price in cents for a booking.
 * Splits the session across pricing tier boundaries so each 30-min
 * block is charged at the correct rate for that time of day.
 */
function publicBlocks(dateStr, startTime, durationMins, bayId) {
  const blocks = durationMins / 30;
  // Per-bay premium/discount: a flat cents adjustment per half-hour block,
  // applied ONLY when a specific bay is known (never for 'auto' assignment -
  // customers are never surprise-charged for a bay they didn't choose).
  // In whole-facility mode nobody picks a bay, so this is always zero there.
  let bayAdj = 0;
  if (bayId && bayId !== 'auto') {
    try {
      const bay = (require('./config').getConfig().bays || []).find(b => b.id === bayId);
      bayAdj = bay ? (parseInt(bay.priceAdjustCents) || 0) : 0;
    } catch { bayAdj = 0; }
  }

  const out = [];
  for (let i = 0; i < blocks; i++) {
    const blockStartMins = toMins(startTime) + (i * 30);
    const blockStartTime = `${String(Math.floor(blockStartMins/60)).padStart(2,'0')}:${String(blockStartMins%60).padStart(2,'0')}`;
    const pricePerHalf   = getPricePerHalfHour(dateStr, blockStartTime);
    out.push({ startMins: blockStartMins, cents: Math.max(0, Math.round(pricePerHalf * 100) + bayAdj) });
  }
  return out;
}

// The session total is the sum of its blocks - ONE walk, so the number a
// customer is charged and the breakdown explaining it can never disagree.
function calculatePrice(dateStr, startTime, durationMins, bayId) {
  return publicBlocks(dateStr, startTime, durationMins, bayId)
    .reduce((total, b) => total + b.cents, 0);
}

/**
 * THE PRICE WITH NO CODE, A BOOKING DEAL TAKEN (Oct 22 2026 - services/deals.js): what a session costs anyone
 * who books it - the public price less the best booking deal that fits. The booking page's price, the counter's own bookings
 * and the online charge (sessionQuote) all read it, so none of them can say a different number.
 * @returns {{ publicCents, cents, deal }}  deal: { id, name, cents, words } or null
 */
function dealPrice(dateStr, startTime, durationMins, bayId) {
  const blocks = publicBlocks(dateStr, startTime, durationMins, bayId);
  const publicCents = blocks.reduce((t, b) => t + b.cents, 0);
  let deal = null;
  try { deal = require('./deals').bestFor(dateStr, startTime, durationMins, blocks); } catch { deal = null; }
  return { publicCents, cents: Math.max(0, publicCents - (deal ? deal.cents : 0)), deal };
}

/**
 * Get all active pricing tiers
 */
function getPricingTiers() {
  try {
    return db().prepare(`SELECT * FROM pricing_tiers ORDER BY sort_order ASC`).all();
  } catch { return []; }
}

/**
 * Apply membership discount to a base price.
 * Returns { discountCents, finalCents, description }
 *
 * Discount types:
 *   percentage  — % off the base price
 *   fixed       — flat $ amount off
 *   free_hours  — X hours free per period (value = hours, converted to cents)
 *   flat_rate   — flat $ per half hour (replaces base price entirely)
 */
function applyMemberDiscount(priceCents, durationMins, discountType, discountValue) {
  if (!discountType || !discountValue) return { discountCents: 0, finalCents: priceCents, description: '' };

  let discountCents = 0;
  let description = '';

  switch (discountType) {
    case 'percentage':
      discountCents = Math.round(priceCents * (discountValue / 100));
      description = `${discountValue}% member discount`;
      break;

    case 'fixed':
      discountCents = Math.round(discountValue * 100);
      description = `$${discountValue} member discount`;
      break;

    case 'free_hours':
      // Convert free hours to equivalent cents at session rate
      const freeMinutes = discountValue * 60;
      const effectiveFreeMin = Math.min(freeMinutes, durationMins);
      const ratePerMin = priceCents / durationMins;
      discountCents = Math.round(ratePerMin * effectiveFreeMin);
      description = `${discountValue} free hr${discountValue !== 1 ? 's' : ''} included`;
      break;

    case 'flat_rate':
      // Flat rate per half hour replaces the base price
      const blocks = durationMins / 30;
      const flatTotal = Math.round(discountValue * 100 * blocks);
      discountCents = Math.max(0, priceCents - flatTotal);
      description = `Member rate: $${discountValue}/30min`;
      break;

    default:
      return { discountCents: 0, finalCents: priceCents, description: '' };
  }

  // Cap discount at full price
  discountCents = Math.min(discountCents, priceCents);

  return {
    discountCents,
    finalCents: priceCents - discountCents,
    description
  };
}

/**
 * Calculate guest pricing for a member booking.
 * Returns additional cents to charge for guests.
 *
 * Guest pricing types:
 *   free       — guests are free
 *   flat       — flat $ per guest
 *   percentage — % off regular session price per guest
 */
function calculateGuestPricing(basePriceCents, guestCount, guestPricingType, guestPricingValue, basis, durationMinutes) {
  if (!guestCount || guestCount <= 0) return 0;
  // basis: 'booking' (default) = the flat fee is per guest per booking;
  //        'hour' = per guest per hour, scaled by session length.
  const hoursMult = (basis === 'hour' && durationMinutes > 0) ? durationMinutes / 60 : 1;

  switch (guestPricingType) {
    case 'free':
      return 0;
    case 'flat':
      // Flat fee per guest (per booking or per hour)
      return Math.round(guestPricingValue * 100 * guestCount * hoursMult);
    case 'percentage':
      // Each guest pays X% off the regular price
      const guestPrice = Math.round(basePriceCents * ((100 - guestPricingValue) / 100));
      return guestPrice * guestCount;
    default:
      return 0;
  }
}

/**
 * Validate and apply a discount code
 * Returns { valid, discountCents, message, codeId, type, value }
 */
function validateDiscountCode(code, phone, priceCents, durationMins) {
  if (!code?.trim()) return { valid: false, message: 'No code entered' };

  const record = db().prepare(
    `SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?) AND active = 1`
  ).get(code.trim());

  if (!record) return { valid: false, message: 'Invalid discount code.' };

  // Check expiry
  // A bare date is the code's LAST DAY, on the facility's own calendar - the Pricing card says it "stops working at the END of
  // this date". Read as a moment it was UTC midnight: 7 PM the evening before in Central (Oct 20 2026, test-customer-money A6).
  // A full date and time (the assistant sends one) is the moment itself.
  if (record.expires_at) {
    const e = String(record.expires_at).trim();
    const expired = /^\d{4}-\d{2}-\d{2}$/.test(e) ? require('./revenue').facilityToday() > e : new Date(e) < new Date();
    if (expired) return { valid: false, message: 'This code has expired.' };
  }

  // A CODE HELD BY A CHECKOUT IN PROGRESS COUNTS (Sep 25 2026, the pilot facility handoff section 3).
  // A use is recorded when the payment lands, so two customers paying at the same moment were
  // both let through on a one-use code. Every checkout still waiting on its payment holds the
  // code it was quoted; the checkout hold expires it, and the sweeper gives the code back.
  const held = (() => { try { return db().prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(discount_cents),0) AS cents FROM bookings WHERE status='pending_payment' AND discount_code_id=?`).get(record.id) || { c: 0, cents: 0 }; } catch { return { c: 0, cents: 0 }; } })();
  const HELD_MSG = 'This code is being used in a checkout that has not finished yet. Try again in a few minutes.';

  // Check max uses
  if (record.max_uses !== null && record.uses_count >= record.max_uses) {
    return { valid: false, message: 'This code has reached its usage limit.' };
  }
  if (record.max_uses !== null && record.uses_count + (held.c || 0) >= record.max_uses) {
    return { valid: false, message: HELD_MSG };
  }

  // Check per-phone limit (null = unlimited uses per phone — for member codes)
  if (record.per_phone_limit !== null && record.per_phone_limit > 0) {
    const phoneUses = db().prepare(
      `SELECT COUNT(*) as c FROM discount_uses WHERE code_id=? AND phone=?`
    ).get(record.id, phone);
    if (phoneUses?.c >= record.per_phone_limit) {
      return { valid: false, message: 'You have already used this code.' };
    }
    let phoneHeld = { c: 0 };
    try { phoneHeld = db().prepare(`SELECT COUNT(*) AS c FROM bookings WHERE status='pending_payment' AND discount_code_id=? AND phone=?`).get(record.id, phone) || { c: 0 }; } catch {}
    if ((phoneUses?.c || 0) + (phoneHeld.c || 0) >= record.per_phone_limit) {
      return { valid: false, message: HELD_MSG };
    }
  }

  // Calculate discount
  let discountCents = 0;

  if (record.type === 'percentage') {
    discountCents = Math.round(priceCents * (record.value / 100));
  } else if (record.type === 'fixed') {
    discountCents = Math.round(record.value * 100);
  } else if (record.type === 'gift') {
    // Stored value: live balance = initial value minus every recorded use.
    // Restores are negative use rows, so the same SUM heals refunds.
    const used = db().prepare(
      `SELECT COALESCE(SUM(discount_cents),0) AS c FROM discount_uses WHERE code_id = ?`
    ).get(record.id);
    const balanceCents = Math.max(0, Math.round(record.value * 100) - (used?.c || 0));
    if (balanceCents <= 0) return { valid: false, message: 'This gift card has a $0.00 balance.' };
    // what checkouts still in progress are holding comes off the balance they can spend
    const spendable = Math.max(0, balanceCents - (held.cents || 0));
    if (spendable <= 0) return { valid: false, message: HELD_MSG };
    discountCents = Math.min(spendable, priceCents);
  } else if (record.type === 'free_minutes') {
    // Calculate value of free minutes at session rate
    const freeHalfHours = record.value / 30;
    const pricePerHalf  = priceCents / (durationMins / 30);
    discountCents = Math.round(freeHalfHours * pricePerHalf);
  }

  // Cap discount at full price
  discountCents = Math.min(discountCents, priceCents);

  let message = `Code applied! You save $${(discountCents / 100).toFixed(2)}`;
  let giftRemainingCents;
  if (record.type === 'gift') {
    const used = db().prepare(
      `SELECT COALESCE(SUM(discount_cents),0) AS c FROM discount_uses WHERE code_id = ?`
    ).get(record.id);
    const balanceCents = Math.max(0, Math.round(record.value * 100) - (used?.c || 0));
    giftRemainingCents = balanceCents - discountCents;
    message = `Gift card applied: -$${(discountCents / 100).toFixed(2)} · $${(giftRemainingCents / 100).toFixed(2)} remains on card`;
  }
  return {
    valid:         true,
    discountCents,
    finalCents:    priceCents - discountCents,
    message,
    codeId:        record.id,
    codeName:      record.code,
    type:          record.type,
    value:         record.value,
    giftRemainingCents,
    doorCheck:     record.door_check || ''   // what is checked at the front desk for this code (the page tells the customer)
  };
}

/**
 * Record a discount code use after booking is confirmed
 */
function recordDiscountUse(codeId, bookingId, phone, discountCents) {
  db().prepare(
    `INSERT INTO discount_uses (id, code_id, booking_id, phone, discount_cents) VALUES (?,?,?,?,?)`
  ).run(uuidv4(), codeId, bookingId, phone, discountCents);

  db().prepare(
    `UPDATE discount_codes SET uses_count = uses_count + 1 WHERE id = ?`
  ).run(codeId);
}

/**
 * Free every discount code AND gift-card use tied to a booking, so a CANCELLED
 * or never-completed booking releases the code for use again (maintainer, Aug 15).
 * - Regular codes: the use row is removed, so the per-person / max-uses counters
 *   no longer count it.
 * - Gift cards: an offsetting NEGATIVE row is inserted (history preserved), which
 *   restores the balance - same convention services/gifts.restoreGiftUse uses.
 * Idempotent: a booking already released won't double-refund a gift or error.
 */
function releaseBookingCodes(bookingId) {
  if (!bookingId) return 0;
  const D = db();
  let freed = 0;
  const uses = D.prepare(
    `SELECT u.id, u.code_id, u.phone, u.discount_cents, c.type, c.code
       FROM discount_uses u JOIN discount_codes c ON c.id = u.code_id
      WHERE u.booking_id = ? AND u.discount_cents >= 0`
  ).all(bookingId);
  for (const u of uses) {
    if (u.type === 'gift') {
      // gift: insert an offsetting negative row unless already offset
      const already = D.prepare(`SELECT 1 FROM discount_uses WHERE booking_id=? AND code_id=? AND discount_cents < 0`).get(bookingId, u.code_id);
      if (already) continue;
      D.prepare(`INSERT INTO discount_uses (id, code_id, booking_id, phone, discount_cents) VALUES (?,?,?,?,?)`)
        .run(uuidv4(), u.code_id, bookingId, u.phone || '', -Math.abs(u.discount_cents));
      try { dbModule().adminLog('GIFTCARD_RESTORED', `$${(u.discount_cents/100).toFixed(2)} back to gift card (booking cancelled)`); } catch {}
    } else {
      // regular code: delete the use row so counters free up
      D.prepare(`DELETE FROM discount_uses WHERE id = ?`).run(u.id);
      try { dbModule().adminLog('DISCOUNT_RELEASED', `Code ${u.code || u.code_id} freed (booking cancelled)`); } catch {}
    }
    freed++;
  }
  return freed;
}

/**
 * Create a pricing tier
 */
function createPricingTier({ name, days, start_time, end_time, price_per_half_hour, sort_order = 0 }) {
  const id = uuidv4();
  db().prepare(
    `INSERT INTO pricing_tiers (id, name, days, start_time, end_time, price_per_half_hour, sort_order)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, name, days, start_time, end_time, price_per_half_hour, sort_order);
  return id;
}

/**
 * Create a discount code
 */
function createDiscountCode({ code, description, type, value, max_uses, per_phone_limit, expires_at, door_check }) {
  const id = uuidv4();
  // null is the Pricing card's "unlimited per person" - kept as null (it was turned into 1, test-customer-money A5); a
  // limit not given at all is one per person, as before
  const perPerson = per_phone_limit === undefined ? 1 : per_phone_limit;
  db().prepare(
    `INSERT INTO discount_codes (id, code, description, type, value, max_uses, per_phone_limit, expires_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, code.toUpperCase().trim(), description || '', type, value,
    max_uses || null, perPerson, expires_at || null);
  // what staff check at the door for it ("a military ID") - Oct 22 2026, night
  const chk = String(door_check || '').trim().slice(0, 80);
  if (chk) { try { db().prepare(`UPDATE discount_codes SET door_check=? WHERE id=?`).run(chk, id); } catch {} }
  return id;
}


// ── TAX QUOTE (shared by the booking form and the charge) ────────────────────
function quoteTax(subtotalCents) {
  const cfg = require('./config').getConfig();
  const sub = Math.max(0, subtotalCents | 0);
  const enabled = !!(cfg.tax && cfg.tax.enabled && Number(cfg.tax.rate) > 0);
  if (!enabled) return { enabled: false, subtotal_cents: sub, tax_cents: 0, total_cents: sub, rate: 0, label: (cfg.tax && cfg.tax.label) || 'Tax' };
  const rate = Number(cfg.tax.rate);
  const tax = Math.round(sub * (rate / 100));   // SAME rounding as the charge path
  return { enabled: true, subtotal_cents: sub, tax_cents: tax, total_cents: sub + tax, rate: rate, label: cfg.tax.label || 'Tax' };
}

/**
 * BLENDED MEMBERSHIP PRICING (Aug 2026) - discount_type 'daily_blend'.
 * The tier's hour allowances are a FREE-TIME METER, not a wall: the front of a
 * session is covered by whatever free time the member has left (daily allowance
 * first, capped by the weekly/monthly pools), and every minute past that is
 * priced by the tier's After-Hours setting (flat_rate $X/30min is the headline
 * use: "first hour free, $5/hr after"). No After-Hours setting = paid minutes
 * at the public rate. One function, called at booking, at preview, and at the
 * counter, so the numbers can never disagree.
 *
 * @param {object} m    member row joined with tier fields (hours_per_day/week/
 *                      month, over_limit_discount_type/value, id)
 * @param {string} dateStr  session date YYYY-MM-DD (allowances judged on THIS day)
 * @param {number} durationMins
 * @param {number} publicPriceCents  full public price of the whole session
 * @param {object} [opts] excludeBookingId: ignore that booking's usage rows
 *                        (a booking's own row must not eat its own free time)
 */
function computeBlend(m, dateStr, durationMins, publicPriceCents, opts = {}) {
  const ex = opts.excludeBookingId || null;
  const month = String(dateStr).slice(0, 7);
  const q = (sql, args) => { try { return db().prepare(sql).get(...args)?.mins || 0; } catch { return 0; } };
  const exSql = ex ? ' AND booking_id != ?' : '';
  const exArg = ex ? [ex] : [];
  const usedToday = q(`SELECT COALESCE(SUM(duration_minutes),0) AS mins FROM member_usage WHERE member_id=? AND date=?${exSql}`, [m.id, dateStr, ...exArg]);
  const usedMonth = q(`SELECT COALESCE(SUM(duration_minutes),0) AS mins FROM member_usage WHERE member_id=? AND date LIKE ?${exSql}`, [m.id, month + '%', ...exArg]);
  const dayAllow   = (Number(m.hours_per_day)   > 0) ? Number(m.hours_per_day)   * 60 : Infinity;
  const monthAllow = (Number(m.hours_per_month) > 0) ? Number(m.hours_per_month) * 60 : Infinity;
  let weekFree = Infinity;
  if (Number(m.hours_per_week) > 0) {
    const d = new Date(dateStr + 'T12:00:00');
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const monStr = mon.toISOString().slice(0, 10);
    const usedWeek = q(`SELECT COALESCE(SUM(duration_minutes),0) AS mins FROM member_usage WHERE member_id=? AND date>=? AND date<=?${exSql}`, [m.id, monStr, dateStr, ...exArg]);
    weekFree = Math.max(0, Number(m.hours_per_week) * 60 - usedWeek);
  }
  const freeLeft = Math.min(
    dayAllow   === Infinity ? Infinity : Math.max(0, dayAllow   - usedToday),
    monthAllow === Infinity ? Infinity : Math.max(0, monthAllow - usedMonth),
    weekFree);
  const freeMinutes = Math.min(durationMins, freeLeft === Infinity ? durationMins : freeLeft);
  const paidMinutes = durationMins - freeMinutes;
  let memberCents = 0, paidDesc = '';
  if (paidMinutes > 0) {
    const paidPublic = Math.round(publicPriceCents * (paidMinutes / durationMins));
    if (m.over_limit_discount_type) {
      const r = applyMemberDiscount(paidPublic, paidMinutes, m.over_limit_discount_type, m.over_limit_discount_value);
      memberCents = r.finalCents;
      paidDesc = m.over_limit_discount_type === 'flat_rate'
        ? `$${m.over_limit_discount_value}/30min after free time`
        : 'after-hours member rate';
    } else { memberCents = paidPublic; paidDesc = 'regular rate after free time'; }
  }
  const fh = (freeMinutes / 60), ph = (paidMinutes / 60);
  const description = paidMinutes === 0
    ? `${fh} free hr${fh !== 1 ? 's' : ''} (membership)`
    : (freeMinutes === 0 ? paidDesc : `${fh} free hr${fh !== 1 ? 's' : ''} + ${ph} hr${ph !== 1 ? 's' : ''} ${paidDesc}`);
  return { freeMinutes, paidMinutes, memberCents, description };
}

// ── SETTLEMENT FOR EVERY TIER STYLE (Aug 25, late) ───────────────────────
// One place decides what a non-blend member pays online for a session and
// what (if anything) waits for the door. create-payment-intent, the
// validate-pin quote the booking page renders, and the counter all call
// these - so the page, the charge, and the tab can never disagree.
// THE METER (maintainer, Aug 25): "if someone has an hour to use they get it free,
// then they are charged whatever the facility says". Two styles run on the
// free-time meter: the blended style (daily allowance, weekly/monthly pools)
// and Free Hours Per Period (the Value is the free hours per month; Hours Per
// Day / Per Week spread them). Both: free minutes first, the After Hours rate
// (or regular price) for the rest - online, at the counter, and on extensions.
// A member never pays full price for a session just because it runs past
// what they have left.
function isMeterTier(m) {
  return !!m && (m.discount_type === 'daily_blend' || m.discount_type === 'free_hours');
}
function meterFor(m) {
  if (!isMeterTier(m)) return null;
  const base = { id: m.id, hours_per_day: m.hours_per_day || 0, hours_per_week: m.hours_per_week || 0,
                 hours_per_month: m.hours_per_month || 0,
                 over_limit_discount_type: m.over_limit_discount_type || '', over_limit_discount_value: m.over_limit_discount_value || 0 };
  if (m.discount_type === 'free_hours') {
    const v = Number(m.discount_value) || 0;
    base.hours_per_month = (Number(m.hours_per_month) > 0) ? Math.min(Number(m.hours_per_month), v) : v;
  }
  return base;
}

function tierSettlement(m) {
  const sm = m && m.settlement_mode;
  if (sm === 'door' || sm === 'deposit') return sm;
  if (m && m.deposit_mode) return 'deposit';
  return 'online';
}

// The member price of the whole session (before guests). Mirrors the payment
// path exactly, including the members-only flat-rate replacement rule.
function memberSessionPrice(m, publicCents, durationMins) {
  const cfg = require('./config').getConfig();
  if (cfg.booking && cfg.booking.membersOnly && m.discount_type === 'flat_rate') {
    return Math.max(0, Math.round((Number(m.discount_value) || 0) * 100 * (durationMins / 30)));
  }
  return applyMemberDiscount(publicCents, durationMins, m.discount_type, m.discount_value).finalCents;
}

// The deposit per half-hour for a tier in deposit mode. A flat-rate tier's
// Value IS its deposit (the locked Aug 2026 model); every other style uses
// deposit_per30 from the tier editor.
function tierDepositPer30(m) {
  if (m.discount_type === 'flat_rate') return Number(m.discount_value) || 0;
  return Number(m.deposit_per30) || 0;
}

// What the page shows and the charge does, for a non-blend member with a
// chosen session. door/deposit only exist where someone is at the door.
function settlementQuote(m, dateStr, startTime, durationMins, bayId) {
  const publicCents = calculatePrice(dateStr, startTime, durationMins, bayId);
  const memberCents = memberSessionPrice(m, publicCents, durationMins);
  const settlement = tierSettlement(m);
  const staffed = require('./staffing').isStaffedAt(dateStr, startTime);
  const out = { settlement, staffed, door_settle: false, deposit: false, public_cents: publicCents,
                member_cents: memberCents, due_now_cents: memberCents, door_due_cents: 0, deposit_cents: 0,
                note: applyMemberDiscount(publicCents, durationMins, m.discount_type, m.discount_value).description || '' };
  if (settlement === 'door' && staffed) {
    out.door_settle = true; out.due_now_cents = 0; out.door_due_cents = memberCents;
  } else if (settlement === 'deposit' && staffed) {
    if (m.discount_type === 'flat_rate') {
      // Value is the deposit: the online charge is the flat amount, the door
      // share is governed by share_discount_pct (unchanged locked behaviour)
      out.deposit = true; out.deposit_cents = memberCents; out.due_now_cents = memberCents; out.door_due_cents = 0;
    } else {
      const dep = Math.min(Math.round(tierDepositPer30(m) * 100 * (durationMins / 30)), memberCents);
      if (dep > 0 && dep < memberCents) {
        out.deposit = true; out.deposit_cents = dep; out.due_now_cents = dep; out.door_due_cents = memberCents - dep;
      }
    }
  }
  return out;
}


// ═══════════════════════════════════════════════════════════════════════════
//  THE ONE SESSION QUOTE (maintainer, Sep 19 2026)
//
//  A customer must never be shown a price that is not the price they will be
//  charged. Until now the booking page's slot chips and duration pills were
//  drawn from the ANONYMOUS /api/pricing/calculate while the charge came from
//  the member branches inside routes/bookings.js - two implementations of one
//  question, and they disagreed for every member of every facility. A live
//  customer reported pills reading $170 for a session his card was charged
//  $150 for, and read the gap as his bay count doubling the price; bay count
//  never entered it (proven at 1 bay and 2 bays, identical on every surface).
//  The gap was the member's own rate being invisible until checkout.
//
//  So sessionQuote() is the one place that decides what a session costs a
//  given person, and the grid, the pills, the price line and
//  create-payment-intent all read it. It answers three ways and never guesses:
//    kind 'exact'    - this is the number, with the rate breakdown
//    kind 'included' - covered by the member's hours, so a price is a lie
//    kind 'unknown'  - it cannot be known before checkout, and says so
//  (maintainer's ruling, Sep 19 2026: "It must never show a number that isn't what
//  they'd be charged... Where the honest answer can't be known until checkout,
//  say that instead of guessing.")
// ═══════════════════════════════════════════════════════════════════════════

const DAY_NAMES_Q = ['sun','mon','tue','wed','thu','fri','sat'];

function hhmm(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/**
 * Consecutive half-hour blocks charged at the same rate collapse into one
 * readable segment. This is the line that explains why a session crossing a
 * pricing tier is not a clean multiple - the thing that made one owner's
 * numbers look like a per-bay doubling (maintainer's ruling 2, Sep 19 2026).
 */
function segmentsOf(blocks) {
  const segs = [];
  for (const b of blocks) {
    const last = segs[segs.length - 1];
    if (last && last.per30Cents === b.cents && last.endMins === b.startMins) {
      last.endMins += 30; last.mins += 30; last.cents += b.cents;
    } else {
      segs.push({ startMins: b.startMins, endMins: b.startMins + 30,
                  per30Cents: b.cents, mins: 30, cents: b.cents });
    }
  }
  return segs.map(s => ({ from: hhmm(s.startMins), to: hhmm(s.endMins),
                          per30Cents: s.per30Cents, mins: s.mins, cents: s.cents }));
}

/** "10:00-11:00 at $25, 11:00-13:00 at $30" - one line, public or member. */
function breakdownLine(segs) {
  if (!segs || segs.length < 2) return '';
  const money = c => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');
  return segs.map(s => s.per30Cents === 0
    ? `${s.from}-${s.to} included`
    : `${s.from}-${s.to} at ${money(s.per30Cents)}`).join(', ');
}

/**
 * A member's own per-half-hour blocks, where they HONESTLY exist.
 *
 * The first cut of this scaled the member's total by the shape of the public
 * rates, which produced a breakdown reading "10:00-11:00 at $22.06,
 * 11:00-13:00 at $26.47" for a member whose rate is a flat $25 - three numbers
 * none of which is anybody's price, on a session with no crossing at all.
 * test-memberprice B1.9 caught it. So a split is only ever drawn from rates
 * the member's tier ACTUALLY sets, and where the tier prices the session as a
 * whole (a percentage or a fixed amount off) there is no per-half-hour story
 * to tell and the caller shows the total alone.
 */
function memberBlockRates(member, membersOnly, publicBlks, golfCents, freeMinutes) {
  const n = publicBlks.length;
  if (!n || !member) return null;
  const flatCents = v => Math.round((Number(v) || 0) * 100);
  const out = [];

  if (isMeterTier(member)) {
    const freeBlocks = Math.min(n, Math.round((freeMinutes || 0) / 30));
    const olt = member.over_limit_discount_type;
    for (let i = 0; i < n; i++) {
      if (i < freeBlocks) { out.push({ startMins: publicBlks[i].startMins, cents: 0 }); continue; }
      if (olt === 'flat_rate')      out.push({ startMins: publicBlks[i].startMins, cents: flatCents(member.over_limit_discount_value) });
      else if (!olt)                out.push({ startMins: publicBlks[i].startMins, cents: publicBlks[i].cents });
      else return null;             // percentage/fixed after free time: session-level, no honest split
    }
  } else if (membersOnly && member.discount_type === 'flat_rate') {
    for (let i = 0; i < n; i++) out.push({ startMins: publicBlks[i].startMins, cents: flatCents(member.discount_value) });
  } else {
    return null;                    // percentage, fixed: the tier prices the SESSION, not the half hour
  }

  // Never a split that does not add up to what the card is charged.
  if (out.reduce((a, b) => a + b.cents, 0) !== golfCents) return null;
  if (out.some(b => b.cents < 0)) return null;
  return out;
}

/**
 * Does this member's tier pricing apply to this session?
 * Moved here from routes/bookings.js (Sep 19 2026) so the quote the customer
 * reads and the charge the route makes ask ONE function, never two copies.
 */
function memberEligibility(member, date, start_time, dur, bay_id) {
  if (!member) return { applyDiscount: false, member: null, reason: 'no_member' };
  const dbMod = dbModule();
  const dayName = DAY_NAMES_Q[new Date(date + 'T12:00:00').getDay()];

  if (member.allowed_days && member.allowed_days.trim()) {
    const days = member.allowed_days.split(',').map(d => d.trim().toLowerCase());
    if (!days.includes(dayName)) return { applyDiscount: false, member, reason: 'day_restricted' };
  }
  if (start_time && member.earliest_time && member.latest_time) {
    const startMin = toMins(start_time);
    const earliest = toMins(member.earliest_time);
    const latest   = toMins(member.latest_time);
    if (startMin < earliest || startMin >= latest) return { applyDiscount: false, member, reason: 'time_restricted' };
  }
  if (bay_id && member.allowed_bays && member.allowed_bays.trim()) {
    const bays = member.allowed_bays.split(',').map(b => b.trim());
    if (!bays.includes(bay_id)) return { applyDiscount: false, member, reason: 'bay_restricted' };
  }
  if (member.hours_per_day > 0) {
    const used = dbMod.getMemberUsageForDay(member.id, date);
    if (used + dur > member.hours_per_day * 60) return { applyDiscount: false, member, reason: 'daily_limit' };
  }
  if (member.hours_per_week > 0) {
    const { weekStart, weekEnd } = weekBounds(date);
    const used = dbMod.getMemberUsageForWeek(member.id, weekStart, weekEnd);
    if (used + dur > member.hours_per_week * 60) return { applyDiscount: false, member, reason: 'weekly_limit' };
  }
  if (member.hours_per_month > 0) {
    const { monthStart, monthEnd } = monthBounds(date);
    const used = dbMod.getMemberUsageForMonth(member.id, monthStart, monthEnd);
    if (used + dur > member.hours_per_month * 60) return { applyDiscount: false, member, reason: 'monthly_limit' };
  }
  return { applyDiscount: true, member, reason: 'eligible' };
}

function weekBounds(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(d); mon.setDate(d.getDate() - diff);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = dt => dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}
function monthBounds(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end   = new Date(d.getFullYear(), d.getMonth()+1, 0);
  const fmt = dt => dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  return { monthStart: fmt(start), monthEnd: fmt(end) };
}

/**
 * WHAT THIS SESSION COSTS THIS PERSON. The single source for the slot chip,
 * the duration pill, the price line and the charge.
 *
 * @param {object|null} member  member row joined with tier fields, or null
 * @param {object} [opts] eligibility: a pre-computed memberEligibility result
 *                        (the create route already has one - never ask twice)
 * @returns {object} { kind, publicCents, golfCents, dueNowCents, doorDueCents,
 *                     depositCents, settlement, doorSettle, depositApplied,
 *                     memberApplied, overLimit, reason, freeMinutes,
 *                     paidMinutes, segments, breakdown, note, blend }
 */
function sessionQuote(member, dateStr, startTime, durationMins, bayId, opts = {}) {
  const priceBayId = (bayId && bayId !== 'auto') ? bayId : null;
  const publicBlks = publicBlocks(dateStr, startTime, durationMins, priceBayId);
  const publicCents = publicBlks.reduce((a, b) => a + b.cents, 0);

  const out = {
    kind: 'exact', publicCents, golfCents: publicCents, dueNowCents: publicCents,
    doorDueCents: 0, depositCents: 0, settlement: 'online', doorSettle: false,
    depositApplied: false, memberApplied: false, overLimit: false, reason: 'no_member',
    freeMinutes: 0, paidMinutes: durationMins, blend: null, note: '',
    segments: segmentsOf(publicBlks), breakdown: ''
  };
  out.breakdown = breakdownLine(out.segments);

  // A BOOKING DEAL (Oct 22 2026 - services/deals.js; maintainer: "book 2 hours get the last 30 min free Tuesdays"): the
  // best deal that fits this session comes off the public price - the price with no code, which the page, the charge and the
  // counter all read. A member's own price is worked below as before, and the booking route holds it to this one (anonCents):
  // a member code never costs more than the same session without it
  out.deal = null; out.dealCents = 0; out.anonCents = publicCents;
  if (!opts.noDeal) {
    let deal = null;
    try { deal = require('./deals').bestFor(dateStr, startTime, durationMins, publicBlks); } catch { deal = null; }
    if (deal && deal.cents > 0) {
      out.deal = deal; out.dealCents = deal.cents; out.anonCents = Math.max(0, publicCents - deal.cents);
      // (a split by the half hour would not add up to the deal's price - its own line instead)
      if (!member) { out.golfCents = out.dueNowCents = out.anonCents; out.note = deal.words; out.segments = null; out.breakdown = ''; }
    }
  }

  if (!member) return out;

  try {
    const cfg = getConfig();
    const membersOnly = !!(cfg.booking && cfg.booking.membersOnly);
    const elig = opts.eligibility || memberEligibility(member, dateStr, startTime, durationMins, priceBayId);
    const memberEligible   = elig.applyDiscount;
    const memberLimitReason = !memberEligible && ['daily_limit','weekly_limit','monthly_limit'].includes(elig.reason);
    out.reason = elig.reason;
    out.overLimit = !!memberLimitReason;

    const staffed = require('./staffing').isStaffedAt(dateStr, startTime);
    const settlement = tierSettlement(member);
    let golfCents = publicCents;

    // The three member branches, in the order create-payment-intent runs them.
    const blendEligible = isMeterTier(member) && (memberEligible || memberLimitReason === true);
    if (blendEligible) {
      const info = computeBlend(meterFor(member), dateStr, durationMins, publicCents,
                                opts.excludeBookingId ? { excludeBookingId: opts.excludeBookingId } : {});
      out.blend = info;
      out.freeMinutes = info.freeMinutes;
      out.paidMinutes = info.paidMinutes;
      out.note = info.description || '';
      golfCents = info.memberCents;
      out.memberApplied = true;
      if ((member.settlement_mode || 'online') === 'door' && staffed) {
        out.doorSettle = true;
      }
    } else if (memberEligible) {
      out.memberApplied = true;
      if (membersOnly && member.discount_type === 'flat_rate') {
        golfCents = Math.max(0, Math.round((Number(member.discount_value) || 0) * 100 * (durationMins / 30)));
        out.note = `member rate $${Number(member.discount_value) || 0}/30min`;
      } else {
        const r = applyMemberDiscount(publicCents, durationMins, member.discount_type, member.discount_value);
        golfCents = r.finalCents;
        out.note = r.description || '';
      }
    } else if (memberLimitReason && member.over_limit_discount_type) {
      out.memberApplied = true;
      const r = applyMemberDiscount(publicCents, durationMins, member.over_limit_discount_type, member.over_limit_discount_value);
      golfCents = r.finalCents;
      out.note = r.description || '';
    }

    out.golfCents = golfCents;
    out.settlement = settlement;
    out.dueNowCents = golfCents;

    // Door and deposit settlement, by the staffing law: they exist only where
    // a person can collect the rest at the counter.
    if (blendEligible) {
      if (out.doorSettle) { out.dueNowCents = 0; out.doorDueCents = golfCents; }
    } else if (out.memberApplied) {
      if (settlement === 'door' && staffed) {
        out.doorSettle = true; out.dueNowCents = 0; out.doorDueCents = golfCents;
      } else if (settlement === 'deposit' && staffed && member.discount_type !== 'flat_rate') {
        const dep = Math.min(Math.round(tierDepositPer30(member) * 100 * (durationMins / 30)), golfCents);
        if (dep > 0 && dep < golfCents) {
          out.depositApplied = true; out.depositCents = dep;
          out.dueNowCents = dep; out.doorDueCents = golfCents - dep;
        }
      }
    }

    // THE HONEST ANSWER (maintainer's ruling 1). Free hours covering the whole session
    // is not a price of zero - it is "included in your hours", and saying $0.00
    // invites the member to think their card is being charged nothing unusual.
    if (out.memberApplied && golfCents === 0 && out.paidMinutes === 0 && out.freeMinutes > 0) {
      out.kind = 'included';
    }

    // The member's own breakdown, or none at all - never a split that does not
    // add up to what the card is charged.
    const mBlocks = memberBlockRates(member, membersOnly, publicBlks, golfCents, out.freeMinutes);
    if (mBlocks) {
      out.segments = segmentsOf(mBlocks);
      out.breakdown = breakdownLine(out.segments);
    } else {
      out.segments = null;
      out.breakdown = '';
    }
  } catch (e) {
    // Rule 29 / maintainer's ruling 1: a quote that cannot be computed is NEVER a
    // number. The surface says it is settled at checkout.
    return { kind: 'unknown', publicCents, golfCents: null, dueNowCents: null,
             doorDueCents: 0, depositCents: 0, settlement: 'online', doorSettle: false,
             depositApplied: false, memberApplied: true, overLimit: false,
             reason: 'quote_failed', freeMinutes: 0, paidMinutes: durationMins,
             blend: null, note: '', segments: null, breakdown: '',
             error: String(e && e.message || e) };
  }
  return out;
}

/**
 * The per-half-hour rate this person sees on each slot chip. A member on a
 * meter tier whose hours cover the next half hour reads "included", never a
 * price they will not be charged.
 */
function slotRateFor(member, dateStr, startTime, minSessionMins, bayId) {
  const q = sessionQuote(member, dateStr, startTime, minSessionMins || 30, bayId);
  if (q.kind === 'unknown') return { unknown: true };
  if (q.kind === 'included') return { included: true };
  const units = (minSessionMins || 30) / 30;
  return { per30Cents: units > 0 ? Math.round(q.golfCents / units) : q.golfCents };
}

/** What a booking's customer brings to the front desk for a code checked at the door ("a military ID"), with the code - or null.
 *  booking: a row with discount_code_id, or { id } (Oct 23 2026: said in the email, the confirmation and /my-booking as well as on
 *  the staff pad - the research: an ID checked at check-in is the norm, and what is checked at the door is shown everywhere, rule 4). */
function doorCheckOf(booking) {
  try {
    const D = db(); let cid = booking && booking.discount_code_id;
    if (cid === undefined && booking && booking.id) cid = (D.prepare('SELECT discount_code_id FROM bookings WHERE id=?').get(String(booking.id)) || {}).discount_code_id;
    if (!cid) return null;
    const c = D.prepare('SELECT code, door_check FROM discount_codes WHERE id=?').get(cid);
    return c && String(c.door_check || '').trim() ? { code: c.code, check: String(c.door_check).trim() } : null;
  } catch { return null; }
}

module.exports = {
  doorCheckOf,
  computeBlend,
  tierSettlement, memberSessionPrice, tierDepositPer30, settlementQuote, isMeterTier, meterFor,
  sessionQuote, memberEligibility, slotRateFor, publicBlocks, segmentsOf, breakdownLine,
  getPricePerHalfHour,
  quoteTax,
  calculatePrice, dealPrice,
  getPricingTiers,
  applyMemberDiscount,
  calculateGuestPricing,
  validateDiscountCode,
  recordDiscountUse,
  releaseBookingCodes,
  createPricingTier,
  createDiscountCode
};
