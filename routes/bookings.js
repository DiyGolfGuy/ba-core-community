// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/bookings.js  —  Customer Booking API (Bay-Aware + Membership)
// ═══════════════════════════════════════════════════════════════════════════════

const express        = require('express');
const { v4: uuidv4 } = require('uuid');
const { stripeClient } = require('../services/stripeclient');
const router         = express.Router();

const { getBookingsForDate, adminLog, getActiveWaiver, getMemberByPin } = require('../services/db');
const { sendConfirmation, sendCancellation } = require('../services/sms');
const { sendConfirmationEmail, sendCancellationEmail } = require('../services/email');
const { revokeDoorCode }   = require('../services/doorlock');
const { getConfig }        = require('../services/config');
const { calculatePrice, validateDiscountCode, applyMemberDiscount, calculateGuestPricing } = require('../services/pricing');


function timeToMins(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function addMinutes(timeStr, mins) {
  const total = timeToMins(timeStr) + mins;
  return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

// Add whole days to a YYYY-MM-DD string, returning YYYY-MM-DD (UTC-safe).
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Convert a booking's start/end into absolute minutes from an epoch day.
// Uses the date string as the day index so intervals on different days compare correctly.
function dayIndex(dateStr) {
  return Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 86400000);
}
function absStart(b) { return dayIndex(b.date) * 1440 + timeToMins(b.start_time); }
function absEnd(b)   { return dayIndex(b.end_date || b.date) * 1440 + timeToMins(b.end_time); }

// Do two bookings overlap as absolute time intervals? (half-open [start,end))
function bookingsOverlap(a, b) {
  return absStart(a) < absEnd(b) && absStart(b) < absEnd(a);
}

// Sanitize string input - strip HTML tags and limit length
function sanitize(str, maxLen = 100) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}
function minsToTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
function normalizePhone(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return `+${d}`;
}
// ── #19.2 + #19.4: what happens the moment a booking becomes ACTIVE ──────────
// (2) If this booking won the race against a prior session's end-of-session
//     shutdown, cancel that prior bay's still-PENDING shutdown/power_off/ir_off
//     jobs so the bay is not powered down out from under the new customer.
// (4) Kick the scheduler immediately so power-on / door code fire within ~1s
//     instead of waiting up to a full tick. Safe against double-fire: claim()
//     holds a DB lease, so a concurrent tick cannot fire the same job twice.
function onBookingActivated(bayId, bookingId) {
  try { require('../services/automation').cancelBayShutdownJobs(bayId, bookingId); } catch (e) { console.error('shutdown-cancel:', e.message); }
  try { setImmediate(() => { try { require('../services/scheduler').checkBookings(); } catch {} }); } catch {}
}

function getStripe() {
  const key = getConfig().stripe.secretKey;
  if (!key || key.startsWith('PASTE') || key === '') return null;
  return stripeClient(key);
}

// The facility's ONE checkout hold (W37). Module scope, never a local.
const holdMins = () => require('../services/bookingcore').holdMins();

// ── W37: the notify fan-out, AFTER the reply ────────────────────────────────
// Declared at MODULE scope on purpose. pilot facility hung every card payment twice by
// declaring a handler's own helpers inside the handler (once below the line
// that used it, once in a nested block 400 lines up); both times the handler
// died as an unhandled rejection and the server simply never replied. Shared
// helpers live out here where they cannot do that.
//
// Each provider is caught on its own and its failure is logged loudly. A text
// or an email that fails, or hangs, must never touch the booking - by the time
// this runs the customer already has their confirmation on screen.
async function sendBookingNotifications(id, smsBooking, emailBooking) {
  try { await sendConfirmation(smsBooking); }
  catch (err) {
    console.error('BOOKING_SMS_FAILED', id, err.message);
    try { require('../services/db').adminLog('BOOKING_SMS_FAILED', `Booking: ${id} | ${err.message}`); } catch {}
  }
  try { if (emailBooking && emailBooking.email) await sendConfirmationEmail(emailBooking); }
  catch (err) {
    console.error('BOOKING_EMAIL_FAILED', id, err.message);
    try { require('../services/db').adminLog('BOOKING_EMAIL_FAILED', `Booking: ${id} | ${err.message}`); } catch {}
  }
}

const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];

/** Get week bounds for hour limit checks */
function getWeekBounds(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(d); mon.setDate(d.getDate() - diff);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = dt => dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

function getMonthBounds(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end   = new Date(d.getFullYear(), d.getMonth()+1, 0);
  const fmt = dt => dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  return { monthStart: fmt(start), monthEnd: fmt(end) };
}

/**
 * Check if member's tier pricing should apply.
 * Returns { applyDiscount:bool, member, reason }
 */
function checkMemberEligibility(member, date, start_time, dur, bay_id) {
  // ONE copy, in services/pricing.js (Sep 19 2026). It used to live here, which
  // meant the quote the customer read and the charge this route makes each had
  // their own idea of whether a member's tier applied.
  return require('../services/pricing').memberEligibility(member, date, start_time, dur, bay_id);
}


// ── POST /api/bookings/payment-library-unreachable ───────────────────────────
// THE PAGE TELLS THE UNIT WHEN IT CANNOT TAKE MONEY (maintainer, Sep 19 2026).
// Stripe Elements needs js.stripe.com in the CUSTOMER's browser. When it does
// not arrive - a content blocker, filtered DNS, no network - the booking page
// can still be drawn perfectly and simply cannot charge anybody. Before this
// the page ran into `Stripe(...)` and threw "Can't find variable: Stripe" at
// Confirm & Pay, and the owner never heard about it. Now the page says so
// plainly to the customer AND reports here, so unithealth's `paylib` signal
// goes red and the owner learns their booking page is turning people away.
// No body is trusted beyond a short user-agent note; nothing here can book.
router.post('/payment-library-unreachable', (req, res) => {
  try {
    const cfg = getConfig();
    // Rule 31: a facility that takes no card payments cannot have this fault.
    const st = require('../services/stripestatus').stripeStatus(cfg);
    if (st.level === 'none') return res.json({ recorded: false, reason: 'no card payments here' });
    // ONE ROW PER REPORTER PER HOUR (maintainer, Sep 20 2026, the security read).
    // This route takes no credential - it cannot, the whole point is that a
    // customer whose browser failed can still tell the unit. That makes it a
    // public write into the OWNER'S audit log, which is kept twelve months by
    // age, and the first cut had nothing but the general 500-per-15-minutes
    // limiter in front of it: 2,000 rows an hour from one address, and a
    // health signal an attacker could hold red with one request a day.
    // A second report from the same browser in the same hour tells the owner
    // nothing the first did not, so it is counted and not written.
    const db = require('../services/db');
    const ua = String(req.headers['user-agent'] || '').slice(0, 120).replace(/[\r\n]/g, ' ');
    const who = require('../services/auth').getClientIp(req) || 'unknown';
    const tag = 'rp:' + require('crypto').createHash('sha256').update(String(who)).digest('hex').slice(0, 12);
    const since = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').slice(0, 19);
    // THE HOUR STARTS AGAIN AT THE OWNER'S LINE (maintainer, Sep 23 2026). An
    // acknowledged drill (/payment-library-drill-clear) draws a line the health
    // signal already reads; the dedupe did not, so a second money gate from the
    // same machine inside the hour had its report swallowed, the line stayed
    // green, and the gate failed on a unit that was working. Only reports AFTER
    // the line count as "already". The line is the acknowledgement's ROW (the
    // log's id orders rows exactly), not its second - services/unithealth reads
    // the same line, so a report it counts is never one this dedupe swallowed.
    let already = 0;
    try {
      const r = db.db.prepare(
        `SELECT COUNT(*) AS n FROM admin_log
          WHERE event='PAYMENT_LIB_UNREACHABLE' AND detail LIKE ? AND created_at >= ?
            AND id > (SELECT COALESCE(MAX(id), 0) FROM admin_log WHERE event='PAYMENT_LIB_DRILL_CLEARED')`
      ).get('%' + tag + '%', since);
      already = (r && r.n) || 0;
    } catch (e) { already = 0; }
    if (already > 0) return res.json({ recorded: false, reason: 'already reported within the hour' });
    // The reporter is recorded as a SALT-FREE HASH of their address, never the
    // address itself: enough to collapse a flood, never a customer's IP sitting
    // in the owner's log for a year.
    db.adminLog('PAYMENT_LIB_UNREACHABLE',
      `A customer's browser could not load js.stripe.com on the booking page | ${tag} | ${ua}`);
    res.json({ recorded: true });
  } catch (e) { res.json({ recorded: false }); }
});

// ── POST /api/bookings/payment-library-drill-clear ───────────────────────────
// A PROOF LEAVES THE UNIT AS IT FOUND IT (maintainer, Sep 19 2026 - rule 24's principle,
// applied to the unit's own health line rather than to Stripe). The
// `moneypages` browser scenario deliberately blocks js.stripe.com to prove the
// page degrades honestly and the owner is told - which means it genuinely makes
// the paylib signal red, and the signal stays red for 24 hours. The health gate
// demands green, so after one proof run no wave could land for a day.
// The owner (and only the owner) can draw a line under the reports so far.
// Nothing is deleted - rule 6 - the drill and the line are both in the log.
router.post('/payment-library-drill-clear', (req, res) => {
  if (!require('../services/auth').requestRole(req)) return res.status(401).json({ error: 'Unauthorized' });
  require('../services/db').adminLog('PAYMENT_LIB_DRILL_CLEARED',
    'A payment-library drill was run and acknowledged - reports before this line are not counted on the health line');
  res.json({ cleared: true });
});

// ── POST /api/bookings/checkout-owed-ack ─────────────────────────────────────
// THE OWNER DRAWS THE LINE (maintainer, Sep 20 2026). The checkout signal reads a live
// condition - somebody paid for a session that did not happen and the money has
// not gone back - so it clears itself the moment a refund is stamped on the row.
// But an owner who refunded BY HAND in the Stripe dashboard leaves no stamp, and
// without this they would be stuck red for doing the right thing. Same shape as
// the payment-library drill acknowledgement: owner only, nothing deleted, the
// acknowledgement is its own row in their log.
router.post('/checkout-owed-ack', (req, res) => {
  if (!require('../services/auth').requestRole(req)) return res.status(401).json({ error: 'Unauthorized' });
  require('../services/db').adminLog('CHECKOUT_OWED_ACK',
    'The owner acknowledged the outstanding checkouts - anything before this line is not counted on the health line');
  res.json({ acknowledged: true });
});

// ── GET /api/bookings/pricing ─────────────────────────────────────────────────
router.get('/pricing', (req, res) => {
  const cfg = getConfig();
  res.json({ pricePerHalfHour: cfg.booking.pricePerHalfHour, currency: 'usd' });
});

// ── GET /api/bookings/packages (Oct 22 2026) ──────────
// The package deals and booking deals a customer can see on the booking page: their names, words, prices, what they include
// and when - nothing internal (services/packages.js forCustomer, services/deals.js forOnline). A members-only facility shows them
// too: a member books a package like anyone
router.get('/packages', (req, res) => {
  try {
    const today = require('../services/revenue').facilityToday();
    res.json({ packages: require('../services/packages').forOnline(today), deals: require('../services/deals').forOnline(today) });
  } catch (e) { res.json({ packages: [], deals: [] }); }
});

// ── GET /api/bookings/package-quote?id=&players= ───────────────────
// A package's price for this many players, its tax the owner's way and its total - the SAME taxFor the charge uses, so the
// page shows exactly what the card is charged (#8). With Stripe Tax on, the tax is worked out at checkout and said so
router.get('/package-quote', (req, res) => {
  const P = require('../services/packages'), pkg = P.get(req.query.id);
  if (!pkg || !pkg.active || !pkg.sell_online) return res.status(404).json({ error: 'That package is not offered online.' });
  const pl = P.playersFor(pkg, req.query.players);
  if (pl.error) return res.status(400).json({ error: pl.error });
  const t = P.taxFor(pkg, pl.players), stripeTax = require('../services/stripetax').enabled();
  res.json({ id: pkg.id, name: pkg.name, players: pl.players, minutes: pkg.minutes, price_cents: t.subtotal_cents, includes: P.includesWords(pkg),
    tax: stripeTax ? null : { lines: t.lines.map(l => ({ label: l.label, cents: l.cents, rate: l.rate, tax_cents: l.tax_cents })), tax_cents: t.tax_cents },
    total_cents: stripeTax ? null : t.subtotal_cents + t.tax_cents, tax_at_checkout: stripeTax });
});

// ── GET /api/bookings/bays ────────────────────────────────────────────────────
router.get('/bays', (req, res) => {
  const cfg = getConfig();
  res.json(cfg.bays.filter(b => b.active).map(b => ({
    id: b.id, name: b.name, description: b.description || '', maintenance: b.maintenance || false,
    features: Array.isArray(b.features) ? b.features : [],
    priceAdjustCents: parseInt(b.priceAdjustCents) || 0,
    premium: (parseInt(b.priceAdjustCents) || 0) > 0
  })));
});

// ── GET /api/availability?date=YYYY-MM-DD ─────────────────────────────────────
// Returns bookings per bay so frontend knows which slots are taken where
router.get('/availability', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date param required (YYYY-MM-DD)' });
  }
  const cfg      = getConfig();
  const allBays  = cfg.bays.filter(b => b.active);
  const bookings = getBookingsForDate(date);

  // WHAT THE GRID IS TOLD IS WHAT THE GRID READS (maintainer, Sep 21 2026).
  // This route is anonymous - it is the public booking page's grid - and it used
  // to hand every caller the whole row for every booking that day: the booking
  // id and the CUSTOMER'S NAME included. The page never read either. It reads
  // exactly four fields (index.html bookingRel/overlapsBooking: date,
  // start_time, end_time, end_date) to grey a slot out, and the server now
  // publishes exactly those four. The id was the other half of a pair: it was
  // what the retired-in-name-only cancel route took.
  // The full row is still read INTERNALLY below - bay_id buckets it and
  // whole_facility decides the fan-out - so the computation is unchanged and
  // only the published shape is narrower.
  const publicSlot = (b) => ({ date: b.date, start_time: b.start_time, end_time: b.end_time, end_date: b.end_date });

  // Group by bay
  const byBay = {};
  allBays.forEach(b => { byBay[b.id] = []; });
  bookings.forEach(b => {
    // A BOOKING OF THE WHOLE BUILDING FILLS THE WHOLE GRID (maintainer, Sep 20 2026).
    // The row carries ONE bay_id because a booking has to be stored somewhere,
    // and the grid bucketed on it alone - so an owner who had sold the entire
    // facility saw one bay busy and the rest apparently free, and could not
    // tell which of those he was allowed to sell. The customer side already
    // reads the truth (slotFree asks bookingcore), and now the owner's grid
    // reads the same stamp: whole_facility=1 shows on every active bay, in
    // per-bay mode too, because the stamp on the row wins over the live
    // setting (the same law findConflict enforces).
    if (b.whole_facility === 1) { allBays.forEach(x => byBay[x.id].push(publicSlot(b))); return; }
    if (byBay[b.bay_id] !== undefined) byBay[b.bay_id].push(publicSlot(b));
  });

  // Slot prices ride the same response (pilot facility parity, maintainer Aug 13): the map is
  // built through the REAL pricing fn - tiers, weekday/weekend, fallback -
  // so the chip on every time button is the truth, never a reimplementation.
  // The per-bay premium is added client-side for the selected bay.
  // A members-only club has no public customer, so an anonymous grid shows no
  // price at all rather than the public tier rates nobody there can be charged
  // (maintainer, Sep 19 2026). The member's own rates arrive with their PIN check.
  const membersOnlyHere = !!(cfg.booking && cfg.booking.membersOnly);
  const staffOrOwner    = !!require('../services/auth').requestRole(req);
  const memberRatesOnly = membersOnlyHere && !staffOrOwner;
  const showSlotPrices  = cfg.booking?.showSlotPrices !== false && !memberRatesOnly;
  let slotPrices = null;
  if (showSlotPrices) {
    const { getPricePerHalfHour } = require('../services/pricing');
    slotPrices = {};
    for (let m = 0; m < 1440; m += 30) {
      const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      slotPrices[t] = getPricePerHalfHour(date, t);
    }
  }
  // AND AVAILABILITY IS ANSWERED THE SAME WAY (maintainer, Sep 19 2026). The page used
  // to fold `byBay` itself - `active.every(bay => bay is busy)` - which is a
  // SECOND implementation of a question the server already answers, and it
  // drifted: in whole-facility mode one booking owns the building, but the page
  // only struck a slot out when EVERY bay was busy. So a customer was offered
  // 10:00 with one bay blocked, chose a duration, reached checkout, and only
  // there met a 409. Third time this week a second surface computed its own
  // answer (the three prices, the Stripe badge, this). The rule the server
  // enforces at create - bookingcore.findConflict - now answers the grid too,
  // and the page renders what it is told.
  const core = require('../services/bookingcore');
  const minSession = (cfg.booking && cfg.booking.minSessionMins) || 30;
  const bookable = allBays.filter(b => b.active !== false && !b.maintenance);
  const facilityMode = !!(cfg.booking && cfg.booking.wholeFacility);
  const slotFree = {};
  for (let m = 0; m < 1440; m += 30) {
    const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    if (!bookable.length) { slotFree[t] = false; continue; }
    // THE SAME TEST THE CREATE PATH RUNS, in both modes: it maps every bookable
    // bay through findConflict and refuses only when NONE is free
    // (`freeBays.length === 0`). Mirroring it exactly is the whole point - the
    // grid must offer precisely what create would allow.
    //   one bay blocked  -> the other is free -> OFFERED, same price
    //   facility closed  -> the stamped row clashes with every bay -> NOT OFFERED
    // Probing a single bay would have answered differently depending on WHICH
    // bay, which is how the two surfaces drift apart in the first place.
    slotFree[t] = bookable.some(b => core.isBayFree({ bay_id: b.id, date, start_time: t, duration_minutes: minSession }));
  }
  res.json({ date, byBay, bays: allBays.map(b => b.id), showSlotPrices, slotPrices, slotFree,
             minSession, facilityMode, memberRatesOnly,
             memberRatesNote: memberRatesOnly ? 'Enter your member code to see your rate.' : '' });
});

// ── GET /api/bookings/availability-by-time ────────────────────────────────────
// Used by time-first booking flow.
// ?date=YYYY-MM-DD&start_time=HH:MM&duration=<minutes>
// Returns available bay objects for the exact slot, OR if none available,
// returns shorter durations (from pricing_tiers) that do have availability,
// sorted longest-to-shortest.
router.get('/availability-by-time', (req, res) => {
  const { date, start_time, duration } = req.query;

  if (!date || !start_time || !duration) {
    return res.status(400).json({ error: 'date, start_time, and duration are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  if (!/^\d{2}:\d{2}$/.test(start_time)) {
    return res.status(400).json({ error: 'start_time must be HH:MM' });
  }
  const durationMins = parseInt(duration, 10);
  if (isNaN(durationMins) || durationMins <= 0) {
    return res.status(400).json({ error: 'duration must be a positive number of minutes' });
  }

  const cfg      = getConfig();
  let   allBays  = cfg.bays.filter(b => b.active);
  const dbConn   = require('../services/db').db;

  // Optional bay filter (?bay=): used by the QR add-more-time flow in
  // time-first mode, so availability and shorter-duration suggestions are
  // computed for the customer's own bay only.
  if (req.query.bay) {
    allBays = allBays.filter(b => b.id === req.query.bay);
  }

  if (allBays.length === 0) {
    return res.json({ available_bays: [], available_durations: [] });
  }

  const endTime = addMinutes(start_time, durationMins);
  const endDate = (timeToMins(start_time) + durationMins) >= 1440
    ? addDays(date, Math.floor((timeToMins(start_time) + durationMins) / 1440))
    : date;

  // Closing-time cap (same rule as booking validation): midnight (00:00)
  // means end of day; closeNextDay adds a day for true after-midnight closes.
  // Without this, we'd report a duration "available" here that checkout would
  // then reject for running past close.
  let closeCap = Infinity;
  if (!cfg.booking.open24Hours) {
    const h = require('../services/hours').on(cfg.booking, date);   // (that day's own hours, if it has them)
    const rawClose = timeToMins(h.closeTime || '23:30');
    closeCap = rawClose === 0 ? 1440 : rawClose + (h.closeNextDay ? 1440 : 0);
  }
  const startMinsAbs = timeToMins(start_time);

  // W37: DISPLAY AND CREATE USE THE SAME HOLD. This used to be deliberately
  // asymmetric - the picker hid a slot for 10 minutes while the create path
  // only honoured 1 - on the theory that a stalled checkout should not block
  // the next person. What it actually did was sell the slot twice: 61 seconds
  // into a live checkout the second customer passed the conflict check, and
  // /confirm made both bookings active with both cards charged (reproduced on
  // the bench, docs/internal/w37-repro.js case C). One number now, from
  // cfg.booking.bookingHoldMins, read through the trunk by the picker, the
  // create path and the sweeper alike.
  const bayHasConflict = (bayId, candStart, candDur) => {
    const cStartMins = timeToMins(candStart);
    const cEndRaw    = cStartMins + candDur;
    const cand = {
      date,
      start_time: candStart,
      end_time: minsToTime(cEndRaw % 1440),
      end_date: cEndRaw >= 1440 ? addDays(date, Math.floor(cEndRaw / 1440)) : date
    };
    // Same trunk rule the create path uses, so what a customer SEES as free
    // is exactly what they will be ALLOWED to book (buffer included).
    return require('../services/bookingcore').findConflict({
      bay_id: bayId, date, start_time: cand.start_time,
      end_time: cand.end_time, end_date: cand.end_date,
      // no number here any more - the trunk uses the facility's ONE hold (W37)
    }) !== null;
  };

  // ---- check requested duration across all bays ----
  // If the requested length runs past close, no bay can host it — return only
  // shorter lengths that fit before close.
  if (startMinsAbs + durationMins > closeCap) {
    const minSess = cfg.booking.minSessionMins || 30;
    const fitDurations = [];
    for (let d = durationMins - 30; d >= minSess; d -= 30) {
      if (startMinsAbs + d > closeCap) continue;
      for (const bay of allBays) {
        if (bay.maintenance) continue;
        if (!bayHasConflict(bay.id, start_time, d)) { fitDurations.push(d); break; }
      }
    }
    return res.json({ available_bays: [], available_durations: fitDurations });
  }

  const availableBays = [];
  for (const bay of allBays) {
    if (bay.maintenance) continue;
    if (!bayHasConflict(bay.id, start_time, durationMins)) availableBays.push({ id: bay.id, name: bay.name });
  }

  if (availableBays.length > 0) {
    return res.json({ available_bays: availableBays, available_durations: [] });
  }

  // ---- no bays free for requested duration — find shorter durations that work ----
  const minSession = cfg.booking.minSessionMins || 30;
  const availableDurations = [];
  for (let d = durationMins - 30; d >= minSession; d -= 30) {
    if (startMinsAbs + d > closeCap) continue; // never suggest past close
    for (const bay of allBays) {
      if (bay.maintenance) continue;
      if (!bayHasConflict(bay.id, start_time, d)) {
        availableDurations.push(d);
        break;
      }
    }
  }

  return res.json({ available_bays: [], available_durations: availableDurations });
});

// ── POST /api/bookings/create-payment-intent ──────────────────────────────────
router.post('/create-payment-intent', async (req, res) => {
  let { phone, date, start_time, duration_minutes, bay_id, waiver_id, signature_name, waiver_guardian_for, ip_address, discount_code, member_pin, guest_count, sms_consent } = req.body;
  const cfg = getConfig();
  const smsConsent = require('../services/sms').bookingSmsAvailable(cfg) &&
    (sms_consent === true || sms_consent === 1) ? 1 : 0;

  // WHOLE-FACILITY MODE (Aug 2026): one booking takes every bay. The page
  // sends no bay choice; any submitted value is ignored ON PURPOSE so a stale
  // client can never book a single bay at a facility-rental venue. The 'auto'
  // machinery below resolves a primary bay for the row (rows need one for
  // joins and receipts), THE TRUNK makes every bay's conflicts count, and the
  // per-bay premium adder never applies ('auto' pricing law - a facility
  // renter is never surprise-charged a bay premium they could not choose).
  const wholeFacility = !!cfg.booking.wholeFacility;
  if (wholeFacility) bay_id = 'auto';

  // Sanitize inputs
  const name  = sanitize(req.body.name, 80);
  const email = sanitize(req.body.email, 100);

  if (!name?.trim() || !phone?.trim() || !date || !start_time || !duration_minutes || !bay_id) {
    return res.status(400).json({ error: 'All fields are required including bay selection.' });
  }

  // For time-first flow the frontend sends bay_id:'auto' — resolved to a real bay
  // during the conflict check below. For bay-first flow bay_id is a real ID.
  let bay = null;
  let resolvedBayId = bay_id;
  if (bay_id !== 'auto') {
    bay = cfg.bays.find(b => b.id === bay_id && b.active);
    if (!bay) return res.status(400).json({ error: 'Invalid bay selected.' });
    if (bay.maintenance) return res.status(400).json({ error: `${bay.name} is currently down for maintenance. Please check back later or select another bay.` });
  }

  // Bookings live on the 30-minute grid - start times too, not just lengths.
  if (!require('../services/bookingcore').isOnGrid(start_time)) {
    const next = require('../services/bookingcore').nextSlot(start_time);
    return res.status(400).json({ error: `Sessions start on the hour or half hour. The next available start is ${next}.` });
  }
  const dur = parseInt(duration_minutes, 10);
  if (dur < 30 || dur > 240 || dur % 30 !== 0) {
    return res.status(400).json({ error: 'Duration must be 30–240 minutes in 30-min increments.' });
  }

  // ── A PACKAGE DEAL (Oct 22 2026 - services/packages.js; maintainer: "any and all sorts of package deals") ───────
  // Bought online, the package is the booking's price: its own bay time, its players, paid in full - no member price, deposit
  // or code on top (the package is the deal; a member books it like anyone, so their free hours are never spent on it).
  // Checked here, before anything is priced, held or sent to Stripe
  let pkg = null, pkgPlayers = 0;
  if (req.body.package_id) {
    const P = require('../services/packages');
    pkg = P.get(req.body.package_id);
    const av = P.availableAt(pkg, date, start_time, { online: true });
    if (!av.ok) return res.status(400).json({ error: av.why, package: true });
    if (dur !== pkg.minutes) return res.status(400).json({ error: `That package is ${P.hrs(pkg.minutes)} of bay time.`, package: true });
    const pl = P.playersFor(pkg, req.body.players);
    if (pl.error) return res.status(400).json({ error: pl.error, package: true });
    pkgPlayers = pl.players;
    if (discount_code?.trim()) return res.status(400).json({ error: 'A discount code cannot be used with a package - the package is the deal.', codeInvalid: true, package: true });
  }

  // ── Member validation ──────────────────────────────────────────────────────
  let member = null;
  let memberEligible = false;
  let memberLimitReason = false;
  let memberCapApplied = false;
  let memberBookingWindow = 0;
  let memberEligibilityResult = null;

  if (member_pin?.trim()) {
    member = getMemberByPin(member_pin.trim());
    if (member) {
      const eligibility = checkMemberEligibility(member, date, start_time, dur, bay_id === 'auto' ? null : bay_id);
      memberEligibilityResult = eligibility;      // handed to the quote trunk - never asked twice
      memberEligible = eligibility.applyDiscount;
      memberLimitReason = !memberEligible && ['daily_limit','weekly_limit','monthly_limit'].includes(eligibility.reason);
      memberBookingWindow = member.booking_window_days || 0;
    }
  }

  // ── MEMBERS-ONLY FACILITY GATE (Aug 2026) ─────────────────────────────────
  // Some facilities are private clubs: pay monthly, book with your member
  // code, no code = no golf. The gate sits server-side so the rule holds no
  // matter what a client sends. A restricted or over-limit member still
  // passes here - they ARE a member; the existing rules then price or block
  // them honestly. Staff/admin bookings deliberately bypass this gate
  // (owner's facility - comps, blocks, and edge cases need a path).
  // members_only:true in the body lets the booking page render the join CTA.
  const membersOnly = !!cfg.booking.membersOnly;
  if (membersOnly) {
    if (!member_pin?.trim()) {
      return res.status(400).json({
        error: 'This is a members-only facility. Enter your member code to book - or become a member to get one.',
        members_only: true
      });
    }
    if (!member) {
      return res.status(400).json({
        error: 'That member code was not recognized or is no longer active. Check the code, or contact the facility about your membership.',
        members_only: true
      });
    }
  }

  // ── Max active bookings check ──────────────────────────────────────────────
  // If the member's tier sets a limit, count their upcoming confirmed bookings.
  if (member && (member.max_active_bookings > 0)) {
    const dbConn = require('../services/db').db;
    const activeCount = dbConn.prepare(
      `SELECT COUNT(*) as cnt FROM bookings
       WHERE member_id = ? AND status = 'active' AND date >= ?`
    ).get(member.id, require('../services/revenue').facilityToday());   // today's later bookings count (UTC's date turned at 7 PM)
    if (activeCount.cnt >= member.max_active_bookings) {
      return res.status(400).json({
        error: `Your membership allows a maximum of ${member.max_active_bookings} upcoming booking${member.max_active_bookings === 1 ? '' : 's'} at a time. Please cancel an existing booking before adding another.`
      });
    }
  }

  // (a package: the member's own pricing, window and hours stand aside - checked by the gate above, priced as anyone)
  if (pkg && member) { member = null; memberEligible = false; memberLimitReason = false; memberBookingWindow = 0; memberEligibilityResult = null; }

  // Date window — respect member's extended booking window if applicable
  const today    = new Date(); today.setHours(0,0,0,0);
  const bookDate = new Date(date + 'T12:00:00');
  const diffDays = Math.round((bookDate - today) / 86400000);
  const effectiveWindow = (memberBookingWindow > 0) ? memberBookingWindow : cfg.booking.windowDays;
  if (diffDays < 0)                    return res.status(400).json({ error: 'Cannot book in the past.' });
  if (diffDays > effectiveWindow)      return res.status(400).json({ error: `Bookings open up to ${effectiveWindow} days out.` });

  // Time bounds - that day's own hours, if it has them (services/hours.js)
  const dayH = require('../services/hours').on(cfg.booking, date);
  const openMins  = timeToMins(dayH.openTime);
  const startMins = timeToMins(start_time);
  const endMinsRaw = startMins + dur;            // may exceed 1440 if it crosses midnight
  const open24 = !!cfg.booking.open24Hours;

  // Start must be at or after opening time - unless the facility is open
  // around the clock (the wizard's "open 24 hours"; bench finding, Sep 2 2026:
  // this check ran before the flag was ever consulted, so a 3 AM booking at a
  // 24/7 club was refused with "no earlier than 06:00").
  if (!open24 && startMins < openMins) {
    return res.status(400).json({ error: `Sessions start no earlier than ${dayH.openTime}.` });
  }

  if (!open24) {
    // Close time = when the facility closes. Sessions must END by close.
    // Midnight (00:00) means END OF DAY (minute 1440), with or without the
    // closeNextDay flag. closeNextDay adds a day only for true after-midnight
    // closes (e.g. 02:00 → 1440+120).
    const rawClose  = timeToMins(dayH.closeTime);
    const closeMins = rawClose === 0 ? 1440 : rawClose + (dayH.closeNextDay ? 1440 : 0);
    if (endMinsRaw > closeMins) {
      return res.status(400).json({ error: `Sessions must end by closing time (${dayH.closeTime}).` });
    }
  }

  // Sanity guard: a session can't span more than 24 hours.
  if (dur > 1440) return res.status(400).json({ error: 'Session length is too long.' });

  // A STARTED SLOT IS NOT FOR SALE (maintainer, Sep 27 2026). Only the page greyed one out, in the browser:
  // a tab left open past the start, or any crafted request, bought a session already under way at
  // full price - paid, free-code and member-hours alike, since they all come through here. Refused
  // before anything is priced, held or sent to Stripe. (The staff pad may still book one, with a
  // warning - the customer is standing there: checkin.staffCreateBooking.)
  {
    const ago = require('../services/startedslot').startedMinsAgo(date, start_time);
    if (ago !== null) {
      try { adminLog('BOOKING_REFUSED', `${date} ${start_time} (${dur} min): that time had already started (${ago} min ago) - online booking refused`); } catch {}
      return res.status(400).json({ error: require('../services/startedslot').REFUSAL, started: true });
    }
  }

  // Roll the end past midnight into end_date. end_time is always 00:00–23:59.
  const crossesMidnight = endMinsRaw >= 1440;
  const end_time = minsToTime(endMinsRaw % 1440);
  const end_date = crossesMidnight ? addDays(date, Math.floor(endMinsRaw / 1440)) : date;

  // ── Conflict check / bay resolution ────────────────────────────────────────
  // Uses better-sqlite3 synchronous API — no BEGIN IMMEDIATE needed because
  // each .prepare().get() is its own implicit read transaction.
  // Race safety for 'auto': pending_payment records written by a concurrent
  // request are visible here (1-minute window), so a second simultaneous
  // checkout will see the first's record and pick a different bay (or 409).
  const db = require('../services/db').db;
  try {
    // Absolute-interval conflict check. Pull candidate bookings for the bay that
    // touch either the start date or the end date (covers midnight crossings both
    // ways — a session that spills into the next day, and a next-day booking that
    // a previous-night session overlaps). Compare as absolute [start,end) intervals.
    // THE TRUNK: one conflict rule for every path (services/bookingcore).
    // This previously ignored the facility's reset buffer, which staff
    // bookings honored - customers could book back-to-back with no gap.
    const core = require('../services/bookingcore');
    // W37: keep the clash, not just the fact of one. A CONFIRMED booking is
    // final; a checkout in progress frees itself if the other person walks
    // away. Telling someone "check back in N minutes" only when it is true is
    // the difference between a customer waiting and a customer phoning.
    const clashOn = (bayId) => core.findConflict({ bay_id: bayId, date, start_time, end_time, end_date });
    // A REFUSAL NAMES ITS REAL CAUSE (maintainer, Sep 19 2026). "Pick a different time"
    // is a lie when the building is closed for a private event, and a customer
    // who bounces off checkout is exactly the thing that never reaches BA. Say
    // what actually happened, and leave the owner a line for it.
    const HOLD_WORD = { event: 'a private event', tournament: 'a tournament', maintenance: 'maintenance' };
    const takenMsg = (clash, bayName) => {
      if (clash && clash.status === 'pending_payment')
        return `Someone is checking out for that time right now. If they do not finish, it frees up within ${holdMins()} minutes - try again then, or pick another time.`;
      const hold = clash && HOLD_WORD[String(clash.booking_type || '')];
      if (hold) {
        const who = clash.whole_facility === 1 ? 'The facility is closed' : `${clash.bay_name || 'That bay'} is out of service`;
        const label = clash.name && !/^(Event|Tournament|Maintenance)$/i.test(clash.name) ? ` (${clash.name})` : '';
        return `${who} for ${hold}${label} at that time. Please pick another time.`;
      }
      return bayName ? `${bayName} is already booked at that time. Try the other bay!`
                     : (wholeFacility ? 'The facility is already booked at that time. Pick a different time.'
                                      : 'This time slot is no longer available.');
    };
    // and the owner sees it, because a customer who could not book never calls
    const noteRefusal = (clash, why) => {
      try {
        require('../services/db').adminLog('BOOKING_REFUSED',
          `${date} ${start_time} (${dur || duration_minutes} min): ${why}`
          + (clash ? ` | held by: ${clash.name || clash.id}${clash.booking_type ? ' [' + clash.booking_type + (clash.whole_facility === 1 ? ', whole facility' : '') + ']' : ''}` : ''));
      } catch { /* never let the note cost the customer their answer */ }
    };

    if (bay_id === 'auto') {
      const activeBays = cfg.bays.filter(b => b.active && !b.maintenance);
      if (activeBays.length === 0) {
        return res.status(409).json({ error: 'No active bays are configured.' });
      }
      const clashes = activeBays.map(b => ({ bay: b, clash: clashOn(b.id) }));
      const freeBays = clashes.filter(c => !c.clash).map(c => c.bay);
      if (freeBays.length === 0) {
        const midCheckout = clashes.some(c => c.clash && c.clash.status === 'pending_payment');
        // name the cause from the REAL clash, not a placeholder - a facility
        // closure and a sold-out slot are different things to be told
        const first = (clashes.find(c => c.clash && c.clash.whole_facility === 1 && c.clash.booking_type)
                    || clashes.find(c => c.clash && c.clash.booking_type)
                    || clashes.find(c => c.clash) || {}).clash || null;
        const msg = takenMsg(midCheckout ? { status: 'pending_payment' } : first, null);
        noteRefusal(first, msg);
        return res.status(409).json({
          error: msg,
          notCharged: true, midCheckout, retryAfterMins: midCheckout ? holdMins() : null
        });
      }
      // Random pick distributes load evenly across bays
      bay = freeBays[Math.floor(Math.random() * freeBays.length)];
      resolvedBayId = bay.id;
    } else {
      const clash = clashOn(bay_id);
      if (clash) {
        const midCheckout = clash.status === 'pending_payment';
        const msg = takenMsg(clash, midCheckout || clash.booking_type ? null : bay.name);
        noteRefusal(clash, msg);
        return res.status(409).json({
          error: msg,
          notCharged: true, midCheckout, retryAfterMins: midCheckout ? holdMins() : null
        });
      }
    }
  } catch(e) {
    // If conflict check fails, allow through — same defensive behavior as original
  }

  // ── SHUTDOWN-IN-PROGRESS GUARD (race safety, BEFORE any charge) ──────────────
  // A booking created right as a prior session ends can collide with that prior
  // session's end-of-session shutdown. On an unmanned unit this means a paying
  // customer walks into a bay that is powering down. If a prior booking on THIS
  // bay already fired its shutdown (shutdown_sent=1) AND this new start falls
  // inside the PC power-down window, refuse the booking here - no charge, clear
  // message - rather than take money for a dead bay.
  //
  // TUNING (deliberate): the window is a FIXED config value, NOT derived from a
  // device's minutesAfter. On a real unit the PC plug is often turnOffAfter=false
  // and the actual ~10-min power-down is a device-side wattage rule the booking
  // system cannot see; reading minutesAfter (e.g. a 1-min light) gives the wrong
  // window. cfg.automation.pcShutdownGuardMins (default 10) matches how the PC
  // actually powers down on that unit. A plain late booking to a bay with NO
  // shutdown fired is unaffected and goes through.
  try {
    const guardMins = Number(cfg.automation?.pcShutdownGuardMins ?? 10);
    if (guardMins > 0 && resolvedBayId && resolvedBayId !== 'auto') {
      const core = require('../services/bookingcore');
      const newStartAbs = core.toMins(start_time) + (core.dayIndex ? 0 : 0); // start-of-day minutes; date compared below
      // Find a prior booking on this bay, same date, that already sent shutdown.
      const priors = require('../services/db').db.prepare(
        `SELECT end_time, end_date, date, shutdown_sent FROM bookings
          WHERE bay_id = ? AND status IN ('active','completed') AND shutdown_sent = 1
            AND (date = ? OR end_date = ?)`
      ).all(resolvedBayId, date, date);
      let blocked = false;
      for (const p of priors) {
        // The prior session's shutdown fires at its end. The guarded dead-zone is
        // [priorEnd, priorEnd + guardMins). Block if the new start lands inside it.
        const priorEndDate = p.end_date || p.date;
        if (priorEndDate !== date) continue; // only same-day power-down overlaps matter here
        const priorEndMins = core.toMins(p.end_time);
        const newMins = core.toMins(start_time);
        if (newMins >= priorEndMins && newMins < priorEndMins + guardMins) { blocked = true; break; }
      }
      if (blocked) {
        return res.status(409).json({
          error: `That bay is powering down from the previous session. Please pick a start about ${guardMins} minutes later so it has time to come back up.`
        });
      }
    }
  } catch (e) { /* guard is best-effort; never block a booking on an internal error */ }

  // ── Waiver check ────────────────────────────────────────────────────────────
  // Facility waiver MODE (maintainer ruled Aug 11): 'off' is a reversible switch -
  // nobody is asked, but the waiver record and every previously signed
  // waiver stay intact, so flipping back to 'required' works instantly.
  // COLLECTION (Aug 2026) rides the single decision engine in
  // services/memberwaiver: a member with a valid membership waiver is covered
  // (identity-anchored, never a name match); 'door' and staffed-hybrid
  // bookings sign at arrival; everyone else signs here. An expired member
  // signing here records MEMBERSHIP scope - the self-correcting renewal.
  const waiverMode = (cfg.waiver && cfg.waiver.mode) || 'required';
  const __wd = require('../services/memberwaiver').waiverDecision({ member, date, start_time });
  const activeWaiver = (waiverMode === 'off' || __wd.source === 'no_doc') ? null
    : (member ? require('../services/memberwaiver').docForTier(member.tier_id) : getActiveWaiver());
  const waiverAskHere = !!(activeWaiver && __wd.enforce);
  if (waiverAskHere) {
    if (!waiver_id) return res.status(400).json({ error: 'You must agree to the liability waiver to proceed.' });
    if (!signature_name?.trim()) return res.status(400).json({ error: 'Please type your full name to sign the waiver.' });
    if (waiver_id !== activeWaiver.id) return res.status(400).json({ error: 'Waiver version mismatch. Please refresh and try again.' });
  }

  // ── Pricing ─────────────────────────────────────────────────────────────────
  // basePriceCents (the public price of this session) comes off the same quote
  // as everything else, below - one walk of the half-hour blocks, never two.
  let basePriceCents = 0;
  let priceCents = 0;
  let memberDiscountCents = 0;
  let guestFeeCents = 0;
  const guests = parseInt(guest_count) || 0;

  // Apply member discount if eligible. HYBRID PRICING: when the member is over
  // an hour limit (daily/weekly/monthly - e.g. free hours used up) and the tier
  // defines a secondary over-limit discount, that applies instead of full price.
  // Restriction reasons (day/time/bay) never get the secondary discount.
  // BLENDED TIERS (Aug 2026): 'daily_blend' treats hour limits as a free-time
  // meter, never a wall - over-limit reasons from the eligibility check do not
  // disqualify, they just mean the blend has less free time to give. Day/time/
  // bay restrictions still disqualify exactly as for every other tier.
  let doorSettle = false, blendInfo = null, memberDepositApplied = false, memberDueCents = null;
  // THE STAFFING LAW, once: deposits and door settlement exist only where a
  // person can collect the rest at the counter.
  const staffedHere = require('../services/staffing').isStaffedAt(date, start_time);

  // ── ONE COMPUTATION (maintainer, Sep 19 2026) ──────────────────────────────────────
  // The golf price of this session is decided by pricing.sessionQuote - the
  // SAME call the booking page's slot chips, duration pills and price line
  // read - so what the customer was shown and what the card is charged cannot
  // drift apart. Before this the page asked the ANONYMOUS pricing route and
  // this route re-derived the member branches itself; a live members-only
  // facility showed pills of $170 for sessions it charged $150 for, and the
  // owner read the gap as his bay count doubling the price.
  // Guests, discount codes, gift cards, the walk-in cap and tax still ride on
  // top, below - this is the session itself.
  const __quote = require('../services/pricing').sessionQuote(
    member, date, start_time, dur,
    (bay_id && bay_id !== 'auto') ? resolvedBayId : null,
    { eligibility: memberEligibilityResult });
  if (__quote.kind === 'unknown') {
    // Rule 29: a price we could not compute is never a number we invent.
    console.error('[price] session quote failed:', __quote.error);
    return res.status(500).json({ error: 'We could not price that session just now. Please try again in a moment.' });
  }
  const __wasBlend = !!__quote.blend;
  basePriceCents      = __quote.publicCents;
  blendInfo           = __quote.blend;
  priceCents          = __quote.dueNowCents;
  memberDiscountCents = Math.max(0, __quote.publicCents - __quote.golfCents);
  doorSettle          = __quote.doorSettle;
  memberDepositApplied = __quote.depositApplied;
  // A blend booking settled at the door carries no separate "due at door"
  // figure on the row (it lands on the tab at check-in) - unchanged behaviour.
  memberDueCents = (!__wasBlend && (__quote.doorSettle || __quote.depositApplied))
    ? __quote.golfCents : null;
  // A BOOKING DEAL (Oct 22 2026 - services/deals.js): taken by the quote for a booking with no member; for a member, their own
  // price stands and the cap below holds it to the deal's price. Never with a package (the package is the deal)
  const dealTaken = !pkg && !member && __quote.deal && __quote.dealCents > 0 ? __quote.deal : null;
  if (!member) memberDiscountCents = 0;
  const anonCents = (__quote.anonCents == null ? basePriceCents : __quote.anonCents);
  if (pkg) {
    priceCents = require('../services/packages').priceFor(pkg, pkgPlayers);
    memberDiscountCents = 0; doorSettle = false; memberDepositApplied = false; memberDueCents = null; blendInfo = null;
  }

  // THE GUEST LAW (Sep 1 2026): one rule for a member's guests, shared with
  // the counter (services/guests.js). Passes cover guests at the tier's
  // covered price, guests beyond the passes pay the after-passes price, more
  // than the per-visit cap is refused here. Door-settled bookings charge
  // nothing for guests online - the counter collects by the same law.
  let guestQuote = null, guestCovered = 0, guestCollect = 'online';
  if (!pkg && member && guests > 0 && (memberEligible || memberLimitReason)) {
    const guestsSvc = require('../services/guests');
    // where the fees land is the OWNER's choice per tier (maintainer, Sep 1 2026):
    // online with the booking (the honor system at an unstaffed club), at the
    // counter where someone is there, or following the member's golf
    guestCollect = guestsSvc.collectMode(member, { staffedHere, doorSettle });
    guestQuote = guestsSvc.guestQuote({ tier: member, memberId: member.id, guests, date, durationMinutes: dur,
      standardCents: basePriceCents, context: guestCollect === 'counter' ? 'counter' : 'booking' });
    if (guestQuote.error) return res.status(400).json({ error: guestQuote.error, guest_limit: true });
    guestCovered = guestQuote.passes_used;   // only pass-covered guests burn a pass
    if (guestCollect === 'online') {
      guestFeeCents = guestQuote.total_cents;
      priceCents += guestFeeCents;
    }
  }

  // MEMBER PRICE CAP (always on): entering a member PIN can never cost more
  // than booking the exact same session anonymously. basePriceCents already
  // reflects the full standard rate for this slot (per-30-min base plus any
  // day/time pricing adjustments), so the comparison is apples-to-apples.
  // Guests are invisible on anonymous bookings, so anything above standard
  // would be a penalty for honesty - we never charge it.
  // MEMBERS-ONLY EXCEPTION: at a private club there IS no anonymous price -
  // nobody can book without a code, so the public per-30 rate is just a
  // leftover default. Clamping a $25/hr member rate down to an unused $15
  // public rate would silently undercharge every booking. The cap protects
  // members from paying more than walk-ins; with no walk-ins, it stands down.
  // The cap protects the member's own GOLF - guest fees the facility set on
  // purpose ride on top of it (bench sweep, Sep 2 2026: the cap was swallowing
  // a $15/hour guest policy at every public facility).
  if (!pkg && !membersOnly && member && (memberEligible || memberLimitReason) && (priceCents - guestFeeCents) > anonCents) {
    priceCents = anonCents + guestFeeCents;
    memberCapApplied = true;
  }

  // Apply discount code (on top of member pricing — discount codes still work separately)
  let discountResult = null;
  if (discount_code?.trim()) {
    discountResult = validateDiscountCode(discount_code, normalizePhone(phone), priceCents, dur);
    // A CODE THAT DOES NOT APPLY STOPS THE BOOKING WITH ITS REASON (Sep 25 2026, the pilot facility
    // handoff section 3). It used to be dropped here without a word and the customer was
    // charged the full price for a booking they believed was discounted.
    if (!discountResult.valid) return res.status(400).json({ error: discountResult.message || 'That code cannot be used for this booking.', codeInvalid: true });
    priceCents = discountResult.finalCents;
  }

  // ── FACILITY BOOKING DEPOSIT (non-members, online only) ────────────────────
  // 'per30' charges a per-half-hour deposit; the group settles the remainder at
  // the door and the deposit credits the GROUP (staff check-in splits it).
  // Guardrail: never above the full price; equal-to-full is just prepayment.
  let bookingDepositApplied = false;
  // THE STAFFING LAW: deposits of ANY kind exist only where a person can
  // settle the remainder at the door. Fully staffed = always; hybrid = the
  // staffed_days calendar must cover this booking's arrival; unmanned = never
  // (everyone pays in full online, members included).
  if (!pkg && !member && staffedHere && (cfg.booking.depositMode || 'off') === 'per30') {
    const depPer30 = Math.round((Number(cfg.booking.depositPer30) || 0) * 100);
    if (depPer30 > 0) {
      const dep = Math.min(depPer30 * (dur / 30), priceCents);
      if (dep > 0 && dep < priceCents) { priceCents = dep; bookingDepositApplied = true; }
    }
  }

  // ── INSERT HELPER ──────────────────────────────────────────────────────────
  // W37: the discount rides the ROW (discount_code_id / discount_cents). The
  // ledger is then written from the row at whichever moment the booking becomes
  // real - free at creation, or paid minutes later at /confirm - so the paid
  // path can no longer forget a gift card or a code's use limit.
  // Keep comments OUT of the .run(...) argument list below: test-sql-bindings
  // counts top-level commas there, and a comma inside a comment reads as one
  // more argument than the statement actually binds.
  // waiver_agreed_at / waiver_ip below: WHEN THEY AGREED, and from where,
  // captured at the moment they did it (maintainer, Sep 19 2026). signed_waivers.agreed_at
  // is stamped at INSERT and the record is written later - at /confirm normally,
  // but minutes later when the checkout sweeper rescues a paid booking. Stamping
  // the writer's clock would be a wrong record under rule 15, not a late one, so
  // the true time rides on the row from here. waiver_ip has been read by
  // bookingledger for months and never existed as a column until now.
  let __bookingTaxCents = 0;   // #9: set by the charge path before the paid insert
  function insertBooking(id, status, stripePI) {
    require('../services/db').db.prepare(`
      INSERT INTO bookings (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date, duration_minutes, price_cents, tax_cents, status, stripe_payment_intent, member_id, member_guest_count, waiver_id, signature_name, sms_consent, is_deposit, waiver_guardian_for, waiver_user_agent, waiver_agreed_at, waiver_ip, whole_facility, discount_code_id, discount_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, resolvedBayId, wholeFacility ? (cfg.server?.businessName || 'Entire facility') : bay.name, name.trim(), normalizePhone(phone), email?.trim()||'', date, start_time, end_time, end_date, dur, priceCents, __bookingTaxCents|0, status, stripePI||null, member?.id||null, guests, waiver_id||null, signature_name||null, smsConsent,
      (((memberEligible && member?.deposit_mode && staffedHere)) || bookingDepositApplied) ? 1 : 0,
      waiverAskHere ? String(waiver_guardian_for || '').slice(0, 80) : '',
      waiverAskHere ? String(req.headers['user-agent'] || '').slice(0, 300) : '',
      waiverAskHere ? new Date().toISOString() : null,
      waiverAskHere ? String(req.ip || '').slice(0, 64) : null,
      wholeFacility ? 1 : 0,
      discountResult?.valid ? String(discountResult.codeId || '') : '',
      discountResult?.valid ? (discountResult.discountCents | 0) : 0);
    if (pkg) {
      try { const P = require('../services/packages'), snap = P.snapshot(pkg, pkgPlayers); snap.charged_tax_cents = __bookingTaxCents | 0;
        require('../services/db').db.prepare(`UPDATE bookings SET package_id=?, package_name=?, package_json=? WHERE id=?`).run(pkg.id, pkg.name, JSON.stringify(snap), id); }
      catch (e) { console.error('package stamp:', e.message); }
    } else if (dealTaken) {
      try { require('../services/db').db.prepare(`UPDATE bookings SET deal_name=?, deal_cents=? WHERE id=?`).run(dealTaken.name, dealTaken.cents | 0, id); }
      catch (e) { console.error('deal stamp:', e.message); }
    }
    // free things with a booking that fits ("book 2 hours, 2 pitchers free" - services/deals.js): kept on the row, handed over at
    // the front desk; never with a package
    if (!pkg) require('../services/deals').stampItems(id, date, start_time, dur);
    if (guestQuote) {
      try { require('../services/db').db.prepare(`UPDATE bookings SET member_guest_covered=?, guest_fee_online_cents=? WHERE id=?`).run(guestQuote.passes_used | 0, guestCollect === 'online' ? (guestFeeCents | 0) : 0, id); } catch {}
    }
    // blend tiers: freeze the member's blended price onto the booking - the
    // counter reads it back, so a later same-day booking can never reshuffle
    // whose hour was free (the price you saw is the price you pay).
    if (blendInfo) {
      try { require('../services/db').db.prepare(`UPDATE bookings SET member_due_cents=? WHERE id=?`)
        .run(blendInfo.memberCents | 0, id); } catch (e) { console.error('member_due stamp:', e.message); }
    } else if (doorSettle && memberDueCents != null) {
      // non-blend door tier: the stamp marks "settled at the door" for the
      // counter; seat 0 is priced from the tier live (split by heads there)
      try { require('../services/db').db.prepare(`UPDATE bookings SET member_due_cents=? WHERE id=?`)
        .run(memberDueCents | 0, id); } catch (e) { console.error('member_due stamp:', e.message); }
    }
  }

  // Member usage and guest passes are written by services/bookingledger from the
  // persisted row (W37) - the row carries member_id, member_guest_count and
  // member_guest_covered, so every path records them identically and only once.

  // ── MEMBER CREDIT: standing balance auto-applies to the member's booking ──
  // Balance = SUM(member_credit.delta_cents). Consumption is recorded per
  // booking and RESTORED if the booking expires unpaid or is cancelled with
  // refund. If the remainder would fall under Stripe's 50-cent minimum, the
  // applied amount is trimmed so the charge is exactly 50 cents (never bump
  // the customer above what they owe).
  let creditApplied = 0;
  if (!pkg && memberEligible && member?.id && priceCents > 0) {
    try {
      const balRow = require('../services/db').db.prepare(
        `SELECT COALESCE(SUM(delta_cents),0) AS bal FROM member_credit WHERE member_id = ?`
      ).get(member.id);
      const bal = Math.max(0, balRow?.bal || 0);
      if (bal > 0) {
        creditApplied = Math.min(bal, priceCents);
        const remainder = priceCents - creditApplied;
        if (remainder > 0 && remainder < 50) creditApplied = Math.max(0, priceCents - 50);
        priceCents -= creditApplied;
      }
    } catch (err) { console.error('Member credit lookup error:', err.message); creditApplied = 0; }
  }
  // Credit consumption is written by services/bookingledger (W37): the amount is
  // decided here during pricing and handed to the trunk, which guards it on the
  // booking id so a retry can never spend the same credit twice.

  // ── W37: ONE SHAPE FOR AN IMMEDIATELY-ACTIVE BOOKING ──────────────────────
  // Two branches below create a booking that is active the moment it is made:
  // the price came to zero after discounts, or this unit has no Stripe key.
  // pilot facility shipped five months of unrecorded waivers because those two branches
  // did different things, and so did we (docs/internal/w37-repro.js proved it
  // on the bench before this existed). Every side effect now goes through the
  // same three helpers, so the branch nobody exercises cannot drift.
  const recordBookingLedger = (id) =>
    require('../services/bookingledger').recordAll(id, {
      creditCents: creditApplied,
      ipAddress: ip_address || req.ip,
      source: 'booking-page'
    });

  const activeExtras = (id) => {
    try { require('../services/printing').enqueueBookingReceipt({ id, bay_name: bay.name, name: name.trim(), date, start_time, end_time, price_cents: priceCents, is_deposit: (((memberEligible && member?.deposit_mode && staffedHere)) || bookingDepositApplied) ? 1 : 0 }, { creditApplied }); } catch {}
    try { require('../services/webhooks').dispatch('booking.created', { id, bay: bay.name, date, start_time, end_time, duration_minutes: dur, price_cents: priceCents, name: name.trim(), phone: normalizePhone(phone), email: email?.trim() || '' }); } catch {}
  };

  // NOTHING ON THE REPLY PATH THAT THE REPLY DOES NOT NEED (W37). These used to
  // be awaited before res.json: two provider round-trips of pure latency on
  // every booking, and - because Resend's fetch carried no timeout - a hung
  // provider meant the customer stared at a spinner for a booking that already
  // existed and would rebook. The reply goes out first; the text and the email
  // follow once it is flushed, each caught and logged on its own. A failed text
  // must never fail a booking.
  const notifyAfterReply = (id) => {
    const smsBooking = { id, bay_name: bay.name, name: name.trim(), phone: normalizePhone(phone), date, start_time, end_time, duration_minutes: dur, sms_consent: smsConsent };
    const emailBooking = { id, bay_name: bay.name, name: name.trim(), email: email?.trim()||'', phone: normalizePhone(phone), date, start_time, end_time, duration_minutes: dur, price_cents: priceCents, is_deposit: (((memberEligible && member?.deposit_mode && staffedHere)) || bookingDepositApplied) ? 1 : 0,
      door_settle: !!doorSettle, door_due_cents: doorSettle ? (blendInfo ? (blendInfo.memberCents || 0) : (memberDueCents || 0)) : 0, blend_note: blendInfo ? blendInfo.description : null, member_due_cents: memberDueCents, guest_note: guestQuote ? guestQuote.note : null, guest_fee_cents: guestFeeCents, guest_collect: guestQuote ? guestCollect : null };
    // a package's own copy (its tax, what it includes) and a booking deal, for the receipt (services/email.js) - Oct 22 2026
    try { Object.assign(emailBooking, require('../services/db').db.prepare(`SELECT package_json, deal_name, deal_cents, deal_items_json FROM bookings WHERE id=?`).get(id) || {}); } catch {}
    res.once('finish', () => { setImmediate(async () => { await sendBookingNotifications(id, smsBooking, emailBooking); }); });
  };

  // A LATE BOOKING IS TOLD ITS CODE IS MINUTES AWAY (feature/door-interface).
  const doorCodeNote = require('../services/doorlock').codeArrivesSoon({ date, start_time }, cfg)
    ? 'Your door code will be texted within 5 minutes.' : null;
  // free things a deal gave the booking, in words (picked up at the front desk) - from its own row
  // what they bring for a code checked at the door, in words ("a military ID - it is checked at the front desk")
  const doorCheckWords = (id) => { const c = require('../services/pricing').doorCheckOf({ id }); return c ? `${c.check} - it is checked at the front desk (${c.code})` : null; };
  const freeItemsOf = (id) => { try { return require('../services/deals').itemsLine(require('../services/db').db.prepare(`SELECT deal_items_json FROM bookings WHERE id=?`).get(id)) || null; } catch { return null; } };
  const activeReply = (id) => ({ devMode: true, doorCodeNote, bookingId: id, bayName: bay.name, creditApplied, bookingDeposit: bookingDepositApplied, depositCents: bookingDepositApplied ? priceCents : 0, priceCents, doorSettle: doorSettle || false, doorDueCents: doorSettle ? (blendInfo ? (blendInfo.memberCents || 0) : (memberDueCents || 0)) : 0, blendNote: blendInfo ? blendInfo.description : null, memberDeposit: memberDepositApplied, memberDueCents, guestNote: guestQuote ? guestQuote.note : null, guestFeeCents, guestCollect: guestQuote ? guestCollect : null ,
    package: pkg ? { name: pkg.name, includes: require('../services/packages').includesWords(pkg), players: pkgPlayers } : null,
    deal: dealTaken ? { name: dealTaken.name, cents: dealTaken.cents, words: dealTaken.words } : null, freeItems: freeItemsOf(id), doorCheck: doorCheckWords(id) });

  // ── Free booking (price is zero after all discounts) ───────────────────────
  // THE BRANCH THAT ROTTED. It took a signature, stored it on the row, and
  // never wrote the waiver record - member codes, comps, credit-covered and
  // free-hours bookings all landed here. It now records exactly what every
  // other path records.
  if (priceCents === 0) {
    const id = uuidv4();
    insertBooking(id, 'active', null);
    onBookingActivated(resolvedBayId, id);
    recordBookingLedger(id);
    activeExtras(id);
    adminLog('BOOKING_FREE', `${bay.name} | ${date} ${start_time} | ${name}${member ? ' | Member: '+member.name : ''}${discountResult?.codeName ? ' | Code: '+discountResult.codeName : ''}`);
    notifyAfterReply(id);
    return res.json(activeReply(id));
  }

  // Dev mode (no Stripe) — Stripe minimum is 50 cents
  if (priceCents > 0 && priceCents < 50) priceCents = 50;

  const stripe = getStripe();
  if (!stripe) {
    const id = uuidv4();
    insertBooking(id, 'active', null);
    onBookingActivated(resolvedBayId, id);
    recordBookingLedger(id);
    activeExtras(id);
    adminLog('BOOKING_CREATED_DEV', `${bay.name} | ${date} ${start_time} | ${name}${member ? ' | Member: '+member.name : ''}`);
    notifyAfterReply(id);
    return res.json(activeReply(id));
  }

  // ── TAX — configurable per facility via admin/wizard ──────────────────────
  // Business owner sets rate and label in Admin → Tax & Legal
  let taxCents   = 0;
  let totalCents = priceCents;
  let taxCalcId  = null;   // Stripe Tax linkage (maintainer, Aug 14)
  const stx = require('../services/stripetax');
  // A PACKAGE IS TAXED THE OWNER'S WAY (Oct 22 2026 - services/packages.js taxFor): the whole price at the bookings' rate, at a
  // counter tax code, or split - each line at its own rate, rounded a line at a time; with Stripe Tax, each line its category
  const __pkgTax = pkg ? require('../services/packages').taxFor(pkg, pkgPlayers) : null;
  if (__pkgTax && !stx.enabled()) {
    taxCents   = __pkgTax.tax_cents;
    totalCents = priceCents + taxCents;
  } else if (stx.enabled()) {
    const calcRef = 'bk-' + Date.now().toString(36);
    const c = __pkgTax ? await stx.calculate(__pkgTax.lines.map((l, i) => ({ amount_cents: l.cents, reference: 'package-' + i, category: l.category })), calcRef)
                       : await stx.calculate([{ amount_cents: priceCents, reference: 'session', category: 'sim' }], calcRef);
    taxCents   = c.tax_cents | 0;
    totalCents = c.total_cents | 0;
    taxCalcId  = c.engine === 'stripe' ? c.calc_id : null;
  } else if (cfg.tax?.enabled && cfg.tax?.rate > 0) {
    // #8: same helper the form preview uses - the customer is charged exactly
    // the Total they saw.
    const q = require('../services/pricing').quoteTax(priceCents);
    taxCents   = q.tax_cents;
    totalCents = q.total_cents;
  }
  __bookingTaxCents = taxCents | 0;   // #9: persist collected tax on the paid booking

  // ── Stripe payment ─────────────────────────────────────────────────────────
  // Hardened: a Stripe outage/failure returns a clean 502 instead of an
  // unhandled rejection (found in sandbox testing when the API was unreachable).
  let intent;
  try {
    const piParams = {
    amount: totalCents, currency: 'usd',
    metadata: {
      ...require('../services/stripemark').marker(),   // rule 25: ours
      name: name.trim(), phone: normalizePhone(phone), email: email?.trim()||'',
      bay_id: resolvedBayId, bay_name: bay.name, date, start_time, end_time,
      duration_minutes: String(dur), waiver_id: waiver_id||'', signature_name: signature_name||'',
      member_id: member?.id||'', guest_count: String(guests),
      subtotal_cents: String(priceCents),
      tax_cents: String(taxCents),
      package: pkg ? pkg.name : '', deal: dealTaken ? dealTaken.name : '',
      tax_label: cfg.tax?.enabled ? `${cfg.tax.label} ${cfg.tax.rate}%` : 'No tax'
    }
  };
    if (taxCalcId) piParams.hooks = { inputs: { tax: { calculation: taxCalcId } } };
    intent = await stripe.paymentIntents.create(piParams,
      taxCalcId ? { apiVersion: require('../services/stripetax').piVersionOverride() } : undefined);
  } catch (err) {
    console.error('Stripe intent creation failed:', err.message);
    // A key Stripe refuses is not "temporarily unavailable" and no amount of
    // trying again will change it (maintainer, Sep 17 2026, a live customer). Say what is
    // true, and tell the OWNER on their health line rather than the customer.
    { const SS = require('../services/stripestatus');
      try { SS.noteStripeFailure(err); } catch {}
      if (SS.isPermanent(err)) { try { require('../services/db').adminLog('CHECKOUT_BLOCKED', `Stripe refused this unit: ${String(err.message).slice(0, 180)}`); } catch {} }
      const out = SS.customerPaymentError(err);
      return res.status(out.status).json(out.body); }
  }

  // ── W37: CLOSE THE SLOT RACE ──────────────────────────────────────────────
  // The check that let this booking through happened before the tax call and
  // before the PaymentIntent - two awaits ago. Two customers can both pass it
  // and both sit waiting on Stripe. Re-check RIGHT HERE with nothing awaiting
  // between the check and the insert, and on a loss cancel the intent the
  // customer is holding and say so plainly. Proved on the bench before this
  // existed: two active bookings, one bay, one time, both paid
  // (docs/internal/w37-repro.js, case C).
  const lost = require('../services/bookingcore').findConflict({
    bay_id: resolvedBayId, date, start_time, end_time, end_date,
    wholeFacility: wholeFacility || null
  });
  if (lost) {
    // Nothing has been captured - the intent was only created. Cancel it so no
    // hold sits on the customer's card, then tell them which kind of loss it
    // was: a confirmed booking is final, a checkout in progress may free itself.
    let released = false;
    try { await stripe.paymentIntents.cancel(intent.id); released = true; }
    catch (err) { console.error('intent cancel after lost race:', err.message); }
    const midCheckout = lost.status === 'pending_payment';
    adminLog('BOOKING_RACE_LOST', `${bay.name} | ${date} ${start_time} | ${name} lost to ${lost.name || lost.id}${midCheckout ? ' (mid-checkout)' : ''} | card NOT charged${released ? ', intent cancelled' : ''}`);
    return res.status(409).json({
      error: midCheckout
        ? `Someone is checking out for that time right now. Your card was not charged. If they do not finish, the slot frees up within ${holdMins()} minutes - try again then, or pick another time.`
        : `${bay.name} was just booked for that time. Your card was not charged. Please pick another time or bay.`,
      notCharged: true,
      midCheckout,
      retryAfterMins: midCheckout ? holdMins() : null
    });
  }

  const id = uuidv4();
  insertBooking(id, 'pending_payment', intent.id);
  // The credit is consumed the moment the slot is held, so an abandoned
  // checkout cannot be replayed against the same balance. The scheduler
  // restores it when the booking expires unpaid.
  require('../services/bookingledger').recordCredit(
    require('../services/db').db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id), creditApplied);

  res.json({
    creditApplied,
    bookingDeposit:  bookingDepositApplied,
    depositCents:    bookingDepositApplied ? priceCents : 0,
    clientSecret:    intent.client_secret,
    publishableKey:  cfg.stripe.publishableKey,
    bookingId:       id,
    bayName:         bay.name,
    priceCents,
    taxCents,
    totalCents,
    taxEnabled:      !!cfg.tax?.enabled,
    taxLabel:        cfg.tax?.label || 'Sales Tax',
    taxRate:         cfg.tax?.rate || 0,
    originalCents:   basePriceCents + guestFeeCents,
    memberDiscountCents,
    guestFeeCents,
    // W40 (Sep 9 2026): the Stripe reply carries the same guest truth as the
    // dev/free reply - the note and where the guest fees are collected. The
    // bench's verify walk asserted them and only ever saw them with no Stripe
    // key on the unit; a reply that differs by payment mode is a dev-mode lie.
    guestNote:       guestQuote ? guestQuote.note : null,
    doorCodeNote,
    guestCollect:    guestQuote ? guestCollect : null,
    discountCents:   discountResult?.valid ? discountResult.discountCents : 0,
    discountMessage: discountResult?.valid ? discountResult.message : null,
    memberName:      member?.name || null,
    tierName:        member?.tier_name || null,
    durationMinutes: dur,
    // Blend/door settlement honesty (Aug 2026): the page tells the member
    // exactly what lands on their tab, and that guests settle at the counter.
    doorSettle:      doorSettle || false,
    doorDueCents:    doorSettle ? (blendInfo ? (blendInfo.memberCents || 0) : (memberDueCents || 0)) : 0,
    blendNote:       blendInfo ? blendInfo.description : null,
    memberDeposit:   memberDepositApplied,
    memberDueCents:  memberDueCents,
    // a package (its name, what it includes, its players) and a booking deal, for the page's own words
    package:         pkg ? { name: pkg.name, includes: require('../services/packages').includesWords(pkg), players: pkgPlayers } : null,
    deal:            dealTaken ? { name: dealTaken.name, cents: dealTaken.cents, words: dealTaken.words } : null,
    freeItems:       freeItemsOf(id),
    doorCheck:       doorCheckWords(id)
  });
});

// ── POST /api/bookings/confirm ────────────────────────────────────────────────
router.post('/confirm', async (req, res) => {
  // THE INTENT IS THE ROW'S, NEVER THE CALLER'S (maintainer, Sep 19 2026, the redirect
  // review). This route used to prefer `paymentIntentId` from the request body
  // over the id stamped on the booking at create, and never checked that the
  // two matched. A customer with the browser console open could pay for slot A,
  // start slot B, and confirm B with A's succeeded intent - both ids are on
  // their own screen, nothing is guessed, and the second session is free. The
  // same untrusted id drove the late-confirm REFUND below, so it could also
  // refund an intent belonging to somebody else's booking.
  // The row has held the right id since create; the body parameter is
  // redundant. It is still accepted and still logged when it disagrees, so an
  // old page that sends it keeps working, but it is never used.
  const claimedIntent = req.body.paymentIntentId;
  let { bookingId } = req.body;
  // FIND THE BOOKING FROM WHAT COMES BACK (maintainer, Sep 19 2026). A customer
  // returning from a redirect payment method may carry nothing of ours - a page
  // loaded before this wave sent return_url: window.location.href, and Stripe
  // appends only its own parameters. The intent id is enough to find the row,
  // and looking a row UP by it is not the same as trusting it: whatever row we
  // land on, the charge is then verified against that row's OWN stored intent
  // below, so a caller cannot point one booking at another booking's payment.
  if (!bookingId && claimedIntent) {
    const byIntent = require('../services/db').db.prepare(
      `SELECT id FROM bookings WHERE stripe_payment_intent = ?`).get(String(claimedIntent));
    if (byIntent) bookingId = byIntent.id;
  }
  // A REQUEST THAT NAMES NOTHING IS ANSWERED, NOT SWALLOWED (maintainer, Sep 21 2026,
  // found by the canary walk). With neither a bookingId nor an intent id this
  // reached `.get(undefined)`, and sql.js refuses to bind undefined - it THROWS.
  // This handler is async, Express 4 does not catch a rejected async handler,
  // and so the request was never answered at all: an anonymous caller could
  // open connections that hang for ever with a one-line POST. Answer first.
  if (!bookingId) return res.status(400).json({ error: 'Booking not found.' });
  const booking = require('../services/db').db.prepare(`SELECT * FROM bookings WHERE id=?`).get(String(bookingId));
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  // WHAT THE PAGE NEEDS TO DRAW THE CONFIRMATION (maintainer, Sep 19 2026, the redirect
  // review). A customer coming back from Klarna / Affirm / Cash App / Amazon Pay
  // loads this page FRESH - it never picked a bay, so the page's own selBay /
  // selTime / selDur are null and the success screen had nothing to render from.
  // The row holds every value already, so the answer carries them. Additive: the
  // ordinary in-page path ignores these fields and draws from its own selection.
  // THE NAME ONLY TO A CALLER WHO PROVES THE PAYMENT (maintainer, Sep 23 2026 - rule 37).
  // A booking id is not a credential: /api/session/status hands anyone the id of
  // whoever is in a bay right now (the bay PC watcher needs it - rule 36), so an
  // id alone here meant "the name of the person playing in Bay 2, from the
  // internet, in two calls". The name comes back only when the caller also sends
  // the payment id THIS booking holds - which the customer returning from Klarna
  // has in the address Stripe sent them back to, and nobody else has. Bay and
  // times are not a person, and stay.
  const provesPayment = !!(claimedIntent && booking.stripe_payment_intent &&
    String(claimedIntent) === String(booking.stripe_payment_intent));
  const confirmSummary = b => Object.assign({
    id: b.id, bay_name: b.bay_name, date: b.date,
    start_time: b.start_time, end_time: b.end_time, end_date: b.end_date || b.date,
    duration_minutes: b.duration_minutes,
    doorCodeNote: require('../services/doorlock').codeArrivesSoon(b) ? 'Your door code will be texted within 5 minutes.' : null,
    // a customer back from Klarna, Affirm or Cash App lands on a FRESH page that has not read the facility's rules yet:
    // the answer carries what the success screen says about getting in (the review, Oct 3 2026 - it said "about 15
    // minutes", and promised a door code at a staffed facility)
    codeTiming: require('../services/doorlock').codeTimingForPage(),
    staffed: !!(getConfig().booking && getConfig().booking.staffedAccess)
  }, provesPayment ? { name: b.name } : {});
  if (booking.status === 'active') return res.json({ success: true, booking: confirmSummary(booking) });

  // The one id this route will act on.
  const intentId = booking.stripe_payment_intent;
  if (claimedIntent && claimedIntent !== intentId) {
    adminLog('CONFIRM_INTENT_MISMATCH', `ID: ${bookingId} | the page sent ${String(claimedIntent).slice(0, 40)} but this booking holds ${String(intentId || 'none').slice(0, 40)} - the row's own intent was used`);
  }

  const stripe = getStripe();
  // A1 (Sep 11 2026): a confirm that arrives AFTER the hold expired must never
  // re-activate the row - the slot was given back and may be sold. The sweeper
  // cancels the intent at expiry, so normally the card never went through; if
  // it did (the cancel lost a race with the customer's confirm), refund it here
  // and say so. Either way the answer is 409 with notCharged/refunded, never a
  // silent activation.
  if (booking.status === 'expired' || booking.status === 'cancelled') {
    // ALREADY REFUNDED IS REFUNDED (Oct 3 2026): the sweeper refunds a paid checkout it expires (a slot sold, a session
    // over) and stamps refunded_at - a confirm arriving after that asked Stripe again, was refused (already refunded),
    // and told the customer "Your card was not charged" about money that was taken and given back
    let refunded = !!booking.refunded_at;
    if (stripe && intentId && !refunded) {
      try {
        const late = await stripe.paymentIntents.retrieve(intentId);
        if (late && late.status === 'succeeded') {
          const rf = await stripe.refunds.create({ payment_intent: late.id, metadata: require('../services/stripemark').marker() }, { idempotencyKey: 'rf-late-' + booking.id });
          try { require('../services/db').markRefunded(booking.id, null, rf, 'late-confirm'); } catch (e) {}
          refunded = true;
        }
      } catch (err) {
        if (err && (err.code === 'charge_already_refunded' || /already been refunded/i.test(String(err.message || '')))) refunded = true;
        else console.error('late confirm on an expired booking:', err.message);
      }
    }
    adminLog('CHECKOUT_LATE_CONFIRM', `ID: ${bookingId} | ${booking.bay_name} | ${booking.date} ${booking.start_time} | confirm arrived after the checkout ${booking.status} - ${refunded ? 'the charge was REFUNDED' : 'card not charged'}; booking NOT activated`);
    return res.status(409).json({
      error: refunded
        ? 'Your checkout ran out of time before the payment finished. The charge has been refunded to your card. Please choose a time and book again.'
        : 'Your checkout ran out of time. Your card was not charged. Please choose a time and book again.',
      notCharged: !refunded, refunded, expired: true
    });
  }
  // A checkout stays pending if its Stripe connection was removed after creation.
  if (booking.status === 'pending_payment' && (!stripe || !intentId)) {
    return res.status(503).json({ error: 'Could not verify payment. Please contact the facility.' });
  }
  let paidIntent = null;
  if (stripe) {
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status !== 'succeeded') return res.status(402).json({ error: 'Payment not completed.' });
      paidIntent = intent;
      // #18a async-capture: with automatic_async (and often automatic) capture, the
      // PaymentIntent reaches 'succeeded' a beat BEFORE latest_charge attaches. Writing
      // it unconditionally stored NULL, which later made refunds silently fail. Only
      // write when the charge is actually present; never overwrite a good id with null.
      if (intent.latest_charge) {
        require('../services/db').db.prepare(`UPDATE bookings SET stripe_charge_id=?, updated_at=datetime('now') WHERE id=?`).run(intent.latest_charge, bookingId);
      }
    } catch (err) {
      return res.status(500).json({ error: 'Could not verify payment.' });
    }
  }

  // ONLY A PENDING CHECKOUT BECOMES ACTIVE (maintainer, Sep 19 2026, the redirect
  // review). This UPDATE carried no status guard, so any row that reached it -
  // a COMPLETED session, for instance, which is neither 'active' nor
  // 'expired'/'cancelled' and so passes both early returns above - was flipped
  // back to active and announced to the customer all over again. The sweeper's
  // own equivalents have carried `AND status='pending_payment'` since A-wave 1;
  // this one never did.
  // (the db proxy's run() returns nothing, so the guard is read back from the
  // row rather than from a changes count that does not exist)
  if (booking.status !== 'pending_payment') {
    adminLog('CONFIRM_NOT_PENDING', `ID: ${bookingId} | a confirm arrived for a booking in status '${booking.status}' - nothing was changed`);
    return res.status(409).json({ error: 'That booking is not waiting for payment.', status: booking.status });
  }
  // A PAYMENT THAT LANDED AFTER THE START (maintainer, Sep 27 2026): an old checkout tab, or a slow
  // redirect, can finish paying once the session has begun. Refunded automatically, the booking
  // cancelled, the customer told, the owner's log says so - never activated. A charge made BEFORE
  // the start whose confirm simply arrived late is a booking like any other.
  if (stripe && paidIntent) {
    const ss = require('../services/startedslot');
    const ago = ss.startedMinsAgo(booking.date, booking.start_time);
    if (ago !== null) {
      const landed = await ss.landedAfterStart(stripe, paidIntent, booking);
      if (landed.after) {
        const out = await ss.refundStartedPayment(stripe, booking, { source: 'confirm', chargeId: landed.chargeId, minsAgo: ago });
        return res.status(409).json({
          error: out.refunded
            ? 'That session had already started by the time your payment went through, so it could not be booked. Your payment has been refunded in full - please choose a later time.'
            : 'That session had already started by the time your payment went through, so it could not be booked. The automatic refund did not go through; the facility has been told and will refund you.',
          started: true, refunded: out.refunded
        });
      }
    }
  }
  // A SLOT SOLD WHILE THE PAYMENT WAS FINISHING (Oct 3 2026, the pack review). A customer away on Klarna's,
  // Affirm's or another provider's page is kept up to 30 minutes past the hold (the sweeper, Oct 2), but the slot
  // goes back on sale AT the hold - so the customer who comes back can find it sold. This confirm activated the
  // row without looking: two paid groups for one bay. Now the same answer the sweeper's slot-taken branch gives:
  // refunded, cancelled, told, never activated. Only a real booking counts - another customer merely holding the
  // slot in a checkout of their own never costs someone who has already paid (realOnly).
  if (stripe && paidIntent) {
    let taken = false;
    try {
      taken = !!require('../services/bookingcore').findConflict({
        bay_id: booking.bay_id, date: booking.date, start_time: booking.start_time, end_time: booking.end_time,
        end_date: booking.end_date, duration_minutes: Number(booking.duration_minutes) || 60,
        excludeId: booking.id, realOnly: true, wholeFacility: booking.whole_facility ? true : null });
    } catch (e) { taken = false; }   // unknown is not a refusal (rule 31)
    if (taken) {
      const lc = paidIntent.latest_charge;
      const out = await require('../services/startedslot').refundStartedPayment(stripe, booking, { source: 'confirm', chargeId: typeof lc === 'string' ? lc : (lc && lc.id) || '', taken: true });
      return res.status(409).json({
        error: out.refunded
          ? 'That time was booked by someone else while your payment was still finishing, so it could not be held for you. Your payment has been refunded in full - please choose another time.'
          : 'That time was booked by someone else while your payment was still finishing. The automatic refund did not go through; the facility has been told and will refund you.',
        taken: true, refunded: out.refunded
      });
    }
  }
  // TWO CONFIRMS IN FLIGHT ACTIVATE ONCE (Oct 3 2026; pilot facility's handoff section 2): the status above was read before the
  // Stripe calls, so a double tap - or the page and a retry - both got here, and both texted, emailed, printed a
  // receipt and sent the webhook. Read again with no await between the read and the write: in one Node process that
  // pair cannot interleave, so exactly one request activates; the other answers as a confirm of an active booking.
  const nowStatus = (require('../services/db').db.prepare(`SELECT status FROM bookings WHERE id=?`).get(bookingId) || {}).status;
  if (nowStatus === 'active') return res.json({ success: true, booking: confirmSummary(booking) });
  if (nowStatus !== 'pending_payment') {
    adminLog('CONFIRM_NOT_PENDING', `ID: ${bookingId} | a confirm arrived for a booking in status '${nowStatus}' - nothing was changed`);
    return res.status(409).json({ error: 'That booking is not waiting for payment.', status: nowStatus });
  }
  require('../services/db').db.prepare(
    `UPDATE bookings SET status='active', confirmed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='pending_payment'`).run(bookingId);
  onBookingActivated(booking.bay_id, bookingId);
  try { require('../services/printing').enqueueBookingReceipt(booking, {}); } catch {}
  try { require('../services/webhooks').dispatch('booking.created', { id: booking.id, bay: booking.bay_name, date: booking.date, start_time: booking.start_time, end_time: booking.end_time, price_cents: booking.price_cents, name: booking.name, phone: booking.phone, email: booking.email || '' }); } catch {}
  adminLog('BOOKING_CONFIRMED', `ID: ${bookingId} | ${booking.bay_name} | ${booking.date} ${booking.start_time}`);

  // W37: THE SAME TRUNK the free and dev-mode branches call, from the same
  // persisted row. This is the moment a paid booking becomes real, so this is
  // where its records are written: the discount or gift-card spend (stamped on
  // the row at create - the paid path used to record NOTHING, so a gift card
  // never decremented), member usage and guest passes, and the waiver
  // signature. Every write is idempotent on the booking id, so a customer who
  // double-taps Confirm writes one set of records.
  require('../services/bookingledger').recordAll(bookingId, { ipAddress: req.ip, source: 'stripe-confirm' });

  // Reply BEFORE the providers (W37). The money is already taken and the
  // booking is already active; a slow or hung Twilio or Resend must not hold
  // the customer's browser on a booking that exists.
  res.once('finish', () => {
    setImmediate(async () => {
      const fresh = require('../services/db').db.prepare(`SELECT * FROM bookings WHERE id=?`).get(bookingId) || booking;
      await sendBookingNotifications(bookingId, fresh, fresh);
    });
  });
  res.json({ success: true, booking: confirmSummary(booking) });
});

// ── POST /api/bookings/cancel/:id ─────────────────────────────────────────────
// RETIRED: this legacy route had no authentication and no 24-hour policy gate,
// so it allowed refund-policy bypass by anyone holding a booking id. Customer
// cancels go through /api/customer/cancel (identity-verified + 24h rule);
// admin cancels through /api/admin/booking/cancel/:id (refund choice + audit).
router.post('/cancel/:id', (req, res) => {
  return res.status(410).json({ error: 'This endpoint has been retired. Use your booking management page to cancel.' });
});
// RETIRED, AND THIS TIME THE RETIREMENT IS ON THE RIGHT ROUTE (maintainer, Sep 21 2026).
// The 410 above was written for this endpoint and landed on its neighbour, so
// for months `/cancel/:id` politely refused while THIS one - unauthenticated,
// taking nothing but a booking id - cancelled any booking, refunded the card
// and revoked the door code. The id it needed was handed out by
// /api/bookings/availability, which is how the two became one chain.
// The body is deleted rather than commented out: dead code that still works is
// how this happened. Customer cancels go through /api/customer/cancel
// (identity-verified + the 24h rule); staff and owner cancels through
// /api/admin/booking/cancel/:id (refund choice + audit).
router.post('/cancel-legacy-disabled/:id', (req, res) => {
  try {
    adminLog('LEGACY_CANCEL_REFUSED', `ID: ${String(req.params.id || '').slice(0, 64)} | IP: ${require('../services/auth').getClientIp(req)}`);
  } catch {}
  return res.status(410).json({ error: 'This endpoint has been retired. Use your booking management page to cancel.' });
});

module.exports = router;
// The scheduler's checkout sweeper announces a booking it rescues with the SAME
// function /confirm uses, so a rescued customer gets exactly the confirmation a
// normal one does (maintainer, Sep 19 2026). Attached to the router rather than moved:
// this file's only reference to the scheduler is a lazy require inside a
// function (line 67), so there is no module-scope cycle either way.
module.exports.sendBookingNotifications = sendBookingNotifications;
