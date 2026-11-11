// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/gifts.js — public purchase + admin management.
const express = require('express');
const router = express.Router();
const { getConfig } = require('../services/config');
const { stripeClient } = require('../services/stripeclient');
const gifts = require('../services/gifts');
// Same inline admin gate as sibling routes (no shared middleware module).
function requireAdmin(req, res, next) {
  // OWNER-ONLY: gift cards are stored value - money stuff (maintainer, Aug 20).
  return require('../services/auth').requireOwner(req, res, next);
}

const MIN_CENTS = 500, MAX_CENTS = 100000;

function getStripe() {
  const key = getConfig().stripe?.secretKey;
  if (!key) return null;
  try { return stripeClient(key); } catch { return null; }
}

// POST /api/gifts/checkout { amount_cents, to_email, from_name, message }
router.post('/checkout', async (req, res) => {
  try {
    const { amount_cents, to_email, from_name, message } = req.body || {};
    const amt = parseInt(amount_cents);
    if (!amt || amt < MIN_CENTS || amt > MAX_CENTS)
      return res.status(400).json({ error: 'Gift amount must be between $5 and $1,000.' });
    if (!to_email || !/.+@.+\..+/.test(String(to_email)))
      return res.status(400).json({ error: 'Please enter the recipient\'s email.' });
    const stripe = getStripe();
    if (!stripe) {
      // Dev mode: instant issue
      const card = gifts.createGiftCard({ amountCents: amt, toEmail: String(to_email).trim(),
        fromName: String(from_name || '').trim().slice(0, 60), message: String(message || '').trim().slice(0, 300), paid: true });
      sendGiftEmail(card, req.body);
      try { require('../services/printing').enqueueToRole('counter',
        `GIFT CARD SOLD\n$${(amt/100).toFixed(2)}  ${card.code}\nTo: ${to_email}\n`); } catch {}
      try { require('../services/webhooks').dispatch('giftcard.purchased', { amount_cents: amt, code_last4: card.code.slice(-4) }); } catch {}
      return res.json({ devMode: true, code: card.code });
    }
    let intent;
    try {
      intent = await stripe.paymentIntents.create({
        amount: amt, currency: 'usd',
        metadata: { ...require('../services/stripemark').marker(), kind: 'gift_card', to_email: String(to_email).trim(),
          from_name: String(from_name || '').trim().slice(0, 60), message: String(message || '').trim().slice(0, 300) }
      });
    } catch (err) {
      console.error('Gift intent failed:', err.message);
      { const SS = require('../services/stripestatus');
        try { SS.noteStripeFailure(err); } catch {}
        const out = SS.customerPaymentError(err);
        return res.status(out.status).json(out.body); }
    }
    // kept so the card is issued even when the buyer never comes back to this page (services/gifts.js)
    try { require('../services/db').db.prepare(`INSERT OR IGNORE INTO gift_checkouts (pi_id, mode) VALUES (?, ?)`).run(intent.id, require('../services/gifts').stripeMode(getConfig().stripe?.secretKey)); } catch {}
    res.json({ clientSecret: intent.client_secret, publishableKey: getConfig().stripe.publishableKey });
  } catch (err) { res.status(500).json({ error: 'Something went wrong.' }); }
});

// POST /api/gifts/confirm { payment_intent_id } - after Stripe confirms client-side
router.post('/confirm', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(400).json({ error: 'Not available' });
    const pi = await stripe.paymentIntents.retrieve(String(req.body?.payment_intent_id || ''));
    if (!pi || pi.metadata?.kind !== 'gift_card') return res.status(400).json({ error: 'Payment not verified.' });
    // STILL BEING PAID (Oct 3 2026): Klarna, Cash App or a bank payment can answer 'processing' when the buyer comes
    // back. That was a 400 and "you will be refunded" - and nothing ever issued the card once the money landed. The
    // card is issued the moment Stripe says the payment succeeded (the webhook, or the ten-minute reconcile).
    if (pi.status === 'processing' || pi.status === 'requires_capture')
      return res.json({ success: false, pending: true, to_email: pi.metadata.to_email || '', emails: gifts.canEmail() });
    if (pi.status !== 'succeeded') return res.status(400).json({ error: 'Payment not verified.' });
    // WHO IT WENT TO, FOR A BUYER WHO CAME BACK FROM A REDIRECT (maintainer, Sep 19 2026).
    // The gift page draws 'we emailed it to ...' from its own form field, and a
    // buyer returning from Klarna or Cash App loads that page FRESH with the
    // field empty. The intent's metadata has held the address all along.
    const out = gifts.issueForPaidIntent(pi, 'confirm');
    if (!out) return res.status(400).json({ error: 'Payment not verified.' });
    if (out.already) return res.json({ success: true, already: true, to_email: pi.metadata.to_email || '' });
    res.json({ success: true, code: out.code, to_email: pi.metadata.to_email || '' });
  } catch (err) { res.status(500).json({ error: 'Something went wrong.' }); }
});

const sendGiftEmail = (card, who) => gifts.sendGiftEmail(card, who, { shown: true }).catch(() => {});   // these two show the code on screen

// ── Admin ──
router.get('/admin/list', requireAdmin, (req, res) => {
  try { res.json(gifts.listGiftCards()); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/admin/issue', requireAdmin, (req, res) => {
  try {
    const { amount_cents, to_email, note, comp } = req.body || {};
    const amt = parseInt(amount_cents);
    if (!amt || amt < 100 || amt > MAX_CENTS) return res.status(400).json({ error: 'Amount out of range.' });
    const card = gifts.createGiftCard({ amountCents: amt, toEmail: String(to_email || '').trim(),
      fromName: '', message: String(note || '').trim().slice(0, 200), paid: !comp, issuedBy: 'admin' });
    if (to_email) sendGiftEmail(card, { to_email, from_name: '', message: note });
    res.json({ success: true, code: card.code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
