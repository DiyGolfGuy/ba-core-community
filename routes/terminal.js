// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/terminal.js — card reader endpoints.
// Owner routes manage the registry; staff routes collect payment.
// NOTHING here marks a tab paid: only the webhook does (see services/terminal).
const express = require('express');
const router  = express.Router();
const term    = require('../services/terminal');
const staff   = require('../services/staff');
const auth    = require('../services/auth');

function adminOnly(req, res, next) {
  if (auth.verifyAdminRequest(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── OWNER: registry ───────────────────────────────────────────────────────
// Staff need the reader LIST to send a check to one - this is a staff screen
// dependency, not an owner setting (maintainer, Aug 14: the phone blip). Creating and
// deleting readers below stay owner-only.
router.get('/readers', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const list = term.readers();
    const withStatus = await Promise.all(list.map(async r =>
      Object.assign({}, r, { live: await term.readerStatus(r.id) })));
    res.json({ readers: withStatus, default: term.defaultReaderId(), tips: term.tipsCfg(), simulated: term.isMock() });
  } catch (e) { res.status(500).json({ error: 'Could not load readers' }); }
});

router.post('/readers', adminOnly, async (req, res) => {
  try { res.json({ ok: true, reader: await term.registerReader(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/readers/:id', adminOnly, (req, res) => {
  term.removeReader(req.params.id);
  res.json({ ok: true });
});

router.post('/settings', adminOnly, (req, res) => {
  const { defaultReader, tipMode, tipPresets } = req.body || {};
  if (tipMode !== undefined && !['off', 'server', 'pooled', 'manual'].includes(tipMode)) {
    return res.status(400).json({ error: 'Tip mode must be off, server, pooled, or manual' });
  }
  const out = term.saveTerminalCfg(t => {
    if (defaultReader !== undefined) t.defaultReader = defaultReader || null;
    if (tipMode !== undefined) t.tips = Object.assign({}, t.tips, { mode: tipMode });
    if (Array.isArray(tipPresets)) {
      const clean = tipPresets.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n >= 0 && n <= 100).slice(0, 4);
      if (clean.length) t.tips = Object.assign({}, t.tips, { presets: clean });
    }
  });
  res.json({ ok: true, terminal: { defaultReader: out.defaultReader, tips: term.tipsCfg() } });
});

// ── STAFF: collect on the reader ──────────────────────────────────────────
router.post('/collect', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const { tab_id, booking_id, amount_cents, reader_id, check_id } = req.body || {};
    const out = await term.collect({
      tab_id, booking_id, amount_cents, check_id,
      reader_id, employee: req.staffName || ''
    });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Polled while the customer taps. Reports OUR webhook-written record.
router.get('/state/:pi', staff.requireStaffOrAdmin, async (req, res) => {
  try { res.json(await term.intentStateLive(req.params.pi)); }   // asks Stripe itself once a tap has waited longer than a tap takes (Sep 12 2026)
  catch (e) { res.json(term.intentState(req.params.pi)); }
});

router.post('/cancel', staff.requireStaffOrAdmin, async (req, res) => {
  try { res.json(await term.cancelCollect((req.body || {}).payment_intent)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Simulator helper: only meaningful against Stripe test keys + a simulated
// reader. Lets a facility (or our battery) prove the whole path with no
// hardware. Refused on live keys.
router.post('/simulate-tap', adminOnly, async (req, res) => {
  const key = require('../services/config').getConfig().stripe?.secretKey || '';
  if (key.startsWith('sk_live')) return res.status(403).json({ error: 'Not available on live keys' });
  try { res.json(await term.simulatePresentCard((req.body || {}).reader_id || term.defaultReaderId())); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
