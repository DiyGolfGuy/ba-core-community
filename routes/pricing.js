// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/pricing.js  —  Pricing Tiers & Discount Codes API
// ═══════════════════════════════════════════════════════════════════════════════

const express  = require('express');
const router   = express.Router();
const { getConfig }  = require('../services/config');
const {
  getPricePerHalfHour, calculatePrice, getPricingTiers,
  validateDiscountCode, createPricingTier, createDiscountCode
} = require('../services/pricing');

function db()       { return require('../services/db').db; }
function adminLog(e,d) { return require('../services/db').adminLog(e,d); }

function isAdmin(req) {
  // OWNER-ONLY: discount codes and premium pricing are money stuff (maintainer, Aug 20).
  return require('../services/auth').requestRole(req) === 'owner';
}

// ── PUBLIC: CALCULATE PRICE ───────────────────────────────────────────────────
router.get('/calculate', (req, res) => {
  // Every other booking endpoint spells this duration_minutes; this one wanted
  // `duration` and answered a flat 400 to the common spelling (bench finding
  // F5). Both are accepted now - duration_minutes first, since that is the
  // name the rest of the API uses.
  const { date, start_time, bay_id } = req.query;
  const duration = req.query.duration_minutes ?? req.query.duration;
  if (!date || !start_time || !duration) {
    return res.status(400).json({ error: 'date, start_time and duration_minutes required' });
  }
  const durationMins   = parseInt(duration);
  const priceCents     = calculatePrice(date, start_time, durationMins, bay_id);
  const pricePerHalf   = getPricePerHalfHour(date, start_time);
  // THE CROSSING IS SAID OUT LOUD (maintainer's ruling 2, Sep 19 2026). A session that
  // spans two pricing tiers is not a clean multiple of the headline rate, and
  // with nothing on screen to explain it an owner reads the difference as a
  // per-bay multiply - which is exactly what happened to a live customer.
  // Empty string when the whole session sits in one tier: nothing to explain.
  // AT A MEMBERS-ONLY CLUB THERE IS NO PUBLIC CUSTOMER (maintainer, Sep 19 2026).
  // Nobody can book without a member code, so the public tiered rates are a
  // number no customer there can ever be charged - showing one is the same
  // defect as showing the wrong one. An anonymous caller is told to identify
  // instead. Staff and the owner still read the standard price: the admin
  // screens compare a booking against it.
  const __cfgB = (getConfig().booking) || {};
  const __staff = !!require('../services/auth').requestRole(req);
  if (__cfgB.membersOnly && !__staff) {
    return res.json({ memberRequired: true, priceCents: null, pricePerHalfHour: null,
                      durationMins, tax: null, segments: null, breakdown: '',
                      message: 'Enter your member code to see your rate.' });
  }
  const __pr = require('../services/pricing');
  // A BOOKING DEAL (Oct 22 2026 - services/deals.js): the price the customer is charged, the deal taken, and its own line in
  // place of the half-hour split (which would not add up to it); the price before it, for the page to show crossed out
  const __dp = __pr.dealPrice(date, start_time, durationMins, (bay_id && bay_id !== 'auto') ? bay_id : null);
  const segments  = __dp.deal ? null : __pr.segmentsOf(__pr.publicBlocks(date, start_time, durationMins, (bay_id && bay_id !== 'auto') ? bay_id : null));
  const breakdown = __dp.deal ? '' : __pr.breakdownLine(segments);
  // #8: hand the form a tax breakdown so it can show Subtotal / Tax / Total
  // BEFORE the charge - the old form showed only a pre-tax Total, then charged
  // more. quoteTax is the shared helper the charge path uses too.
  const tax = require('../services/pricing').quoteTax(__dp.cents);
  // free things with this session (a free-things deal: "book 2 hours, 2 pitchers free"), in words - for the page to say before paying
  let __free = null; try { const it = require('../services/deals').itemsFor(date, start_time, durationMins); if (it) __free = { name: it.name, words: require('../services/deals').itemsLine({ deal_items_json: JSON.stringify(it) }) }; } catch {}
  res.json({ priceCents: __dp.cents, pricePerHalfHour: pricePerHalf, durationMins, tax, segments, breakdown,
    deal: __dp.deal ? { name: __dp.deal.name, cents: __dp.deal.cents, words: __dp.deal.words } : null, originalCents: __dp.deal ? priceCents : undefined, freeItems: __free });
});

// ── PUBLIC: VALIDATE DISCOUNT CODE ───────────────────────────────────────────
router.post('/validate-code', (req, res) => {
  const { code, phone, date, start_time, duration_minutes } = req.body;
  if (!code || !phone || !date || !start_time || !duration_minutes) {
    return res.status(400).json({ valid: false, message: 'Missing required fields' });
  }
  // (a code is worked from the price the customer is charged - a booking deal already taken, as the charge path does)
  const priceCents = require('../services/pricing').dealPrice(date, start_time, parseInt(duration_minutes), null).cents;
  const result     = validateDiscountCode(code, phone, priceCents, parseInt(duration_minutes));
  res.json(result);
});

// ── ADMIN: LIST TIERS ─────────────────────────────────────────────────────────
router.get('/tiers', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json(getPricingTiers());
});

// ── ADMIN: CREATE TIER ────────────────────────────────────────────────────────
router.post('/tiers', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { name, days, start_time, end_time, price_per_half_hour, sort_order } = req.body;
  if (!name || !days || !start_time || !end_time || !price_per_half_hour) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const id = createPricingTier({ name, days, start_time, end_time, price_per_half_hour, sort_order });
  adminLog('PRICING_TIER_CREATED', `${name} | ${days} | ${start_time}-${end_time} | $${price_per_half_hour}`);
  res.json({ success: true, id });
});

// ── ADMIN: UPDATE TIER ────────────────────────────────────────────────────────
router.put('/tiers/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { name, days, start_time, end_time, price_per_half_hour, sort_order, active } = req.body;
  db().prepare(
    `UPDATE pricing_tiers SET name=?, days=?, start_time=?, end_time=?, price_per_half_hour=?, sort_order=?, active=? WHERE id=?`
  ).run(name, days, start_time, end_time, price_per_half_hour, sort_order ?? 0, active ?? 1, req.params.id);
  adminLog('PRICING_TIER_UPDATED', `ID: ${req.params.id}`);
  res.json({ success: true });
});

// ── ADMIN: DELETE TIER ────────────────────────────────────────────────────────
router.delete('/tiers/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  db().prepare(`DELETE FROM pricing_tiers WHERE id=?`).run(req.params.id);
  adminLog('PRICING_TIER_DELETED', `ID: ${req.params.id}`);
  res.json({ success: true });
});

// ── ADMIN: LIST CODES ─────────────────────────────────────────────────────────
// ── ADMIN: PACKAGE DEALS AND BOOKING DEALS (Oct 22 2026 - services/packages.js, services/deals.js) ──────────
// The owner's: listed with their words (what each includes, when, its price and its tax as the owner set them), saved, removed
router.get('/packages', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const P = require('../services/packages');
  res.json({ packages: P.list().map(p => Object.assign({}, p, { includes_list: P.includesOf(p), includes_words: P.includesWords(p), when: P.whenWords(p), price_words: P.priceWords(p), tax_words: P.taxWords(p), length: P.hrs(p.minutes) })) });
});
router.post('/packages', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try { const p = require('../services/packages').upsert(req.body || {}); try { require('../services/db').adminLog('PACKAGE_SAVED', `${p.name}: ${require('../services/packages').priceWords(p)}`); } catch {} res.json({ ok: true, package: p }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/packages/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const P = require('../services/packages'), p = P.get(req.params.id);
  if (!P.remove(req.params.id)) return res.status(404).json({ error: 'no such package' });
  try { require('../services/db').adminLog('PACKAGE_REMOVED', `${p.name} (bookings already made keep it)`); } catch {}
  res.json({ ok: true });
});
router.get('/deals', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const Dl = require('../services/deals');
  // (a free-things deal's own list too - each thing with its name - for the card and the assistant to change it by)
  res.json({ deals: Dl.list().map(d => Object.assign({}, d, { words_auto: Dl.words(d), includes_list: Dl.includesOf(d).map(x => Object.assign({}, x, { name: (x.kind === 'part' ? 'from ' : '') + Dl.nameOf(x) })) })) });
});
router.post('/deals', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try { const d = require('../services/deals').upsert(req.body || {}); try { require('../services/db').adminLog('DEAL_SAVED', `${d.name}: ${require('../services/deals').words(d)}`); } catch {} res.json({ ok: true, deal: d }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/deals/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const Dl = require('../services/deals'), d = Dl.get(req.params.id);
  if (!Dl.remove(req.params.id)) return res.status(404).json({ error: 'no such deal' });
  try { require('../services/db').adminLog('DEAL_REMOVED', d.name); } catch {}
  res.json({ ok: true });
});

router.get('/codes', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const codes = db().prepare(`SELECT * FROM discount_codes ORDER BY created_at DESC`).all();
  res.json(codes);
});

// ── ADMIN: CREATE CODE ────────────────────────────────────────────────────────
router.post('/codes', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { code, description, type, value, max_uses, per_phone_limit, expires_at, door_check } = req.body;
  if (!code || !type || value === undefined) {
    return res.status(400).json({ error: 'code, type and value required' });
  }
  const existing = db().prepare(`SELECT id FROM discount_codes WHERE UPPER(code)=UPPER(?)`).get(code.trim());
  if (existing) return res.status(400).json({ error: 'That code already exists.' });

  const resolvedPerPhone = per_phone_limit === null || per_phone_limit === 'null' ? null : (parseInt(per_phone_limit) || 1);
  const id = createDiscountCode({ code, description, type, value, max_uses, per_phone_limit: resolvedPerPhone, expires_at, door_check });
  adminLog('DISCOUNT_CODE_CREATED', `${code.toUpperCase()} | ${type} | ${value}${door_check ? ' | checked at the door: ' + String(door_check).slice(0, 80) : ''}`);
  res.json({ success: true, id });
});

// ── ADMIN: DEACTIVATE CODE ────────────────────────────────────────────────────
router.delete('/codes/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  db().prepare(`UPDATE discount_codes SET active=0 WHERE id=?`).run(req.params.id);
  adminLog('DISCOUNT_CODE_DEACTIVATED', `ID: ${req.params.id}`);
  res.json({ success: true });
});

// ── ADMIN: CODE USAGE ─────────────────────────────────────────────────────────
router.get('/codes/:id/uses', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const uses = db().prepare(
    `SELECT du.*, b.name as customer_name, b.date, b.start_time
     FROM discount_uses du
     LEFT JOIN bookings b ON du.booking_id = b.id
     WHERE du.code_id = ? ORDER BY du.used_at DESC`
  ).all(req.params.id);
  res.json(uses);
});

module.exports = router;
