// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/memberships.js — PUBLIC online membership signup.
// Compliance notes (state auto-renewal laws, California baseline):
// - the signup page carries a clear auto-renewal disclosure + a SEPARATE
//   affirmative consent checkbox (enforced server-side here as arl_consent)
// - the welcome email restates the terms and how to cancel
// - no partial refunds; benefits run to period end (disclosed pre-purchase)
// The member-creating path lives in services/membership-join.js (Sep 20 2026)
// so the success redirect and the reconcile create a member the same way.

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getConfig } = require('../services/config');
const dbModule = require('../services/db');
const billing = require('../services/membership-billing');

const db = () => dbModule.db;

function baseUrl(req) {
  const cfg = getConfig();
  return (cfg.seo?.domain || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}
function activeCount(tierId) {
  return db().prepare(`SELECT COUNT(*) AS c FROM members WHERE tier_id=? AND status='active'`).get(tierId).c;
}
const join = require('../services/membership-join');

// GET /api/memberships/public — sellable tiers with prices + availability
router.get('/public', (req, res) => {
  try {
    const tiers = db().prepare(`SELECT id, name, description, badge_color,
        price_monthly, price_annual, roster_cap,
        (SELECT COUNT(*) FROM members m WHERE m.tier_id = membership_tiers.id AND m.status='active') AS roster_count
      FROM membership_tiers
      WHERE active=1 AND sell_online=1 AND (price_monthly > 0 OR price_annual > 0)
      ORDER BY sort_order ASC, name ASC`).all();
    // Whether joining can actually complete right now. Without it the page
    // had no way to know online signup was dead and showed a Join button that
    // could only ever fail at the last step (bench finding F7).
    const signupOnline = !!getConfig().stripe?.secretKey;
    res.json(tiers.map(t => ({
      id: t.id, name: t.name, description: t.description, badge_color: t.badge_color,
      price_monthly: t.price_monthly, price_annual: t.price_annual,
      full: t.roster_cap > 0 && t.roster_count >= t.roster_cap,
      spots_left: t.roster_cap > 0 ? Math.max(0, t.roster_cap - t.roster_count) : null,
      signup_online: signupOnline
    })));
  } catch (err) { res.status(500).json({ error: 'Unable to load memberships' }); }
});

// POST /api/memberships/checkout — start a subscription Checkout
router.post('/checkout', async (req, res) => {
  try {
    const { tier_id, cadence, name, email, phone, arl_consent, waiver_id, waiver_signature, waiver_guardian_for } = req.body || {};
    if (!name?.trim() || !email?.trim() || !phone?.trim())
      return res.status(400).json({ error: 'Name, email, and phone are required.' });
    if (!['monthly', 'annual'].includes(cadence))
      return res.status(400).json({ error: 'Please choose monthly or annual billing.' });
    if (arl_consent !== true)
      return res.status(400).json({ error: 'Please review and agree to the automatic renewal terms.' });
    const tier = db().prepare(`SELECT * FROM membership_tiers WHERE id=? AND active=1 AND sell_online=1`).get(tier_id);
    if (!tier) return res.status(404).json({ error: 'Membership not found.' });
    // ONLINE SIGNUP CHECK COMES FIRST (bench finding F7). It used to sit below
    // the waiver block, so a club with no Stripe key made the prospect read
    // and sign a liability document and THEN told them to phone in. Nobody
    // signs anything until we know the join can actually complete.
    if (!getConfig().stripe?.secretKey)
      return res.status(503).json({ error: 'Online signup is not available yet. Please contact us to join.' });
    // MEMBERSHIP WAIVER (Aug 2026): signed once here, rides the membership per
    // the facility's term setting. The signature is validated BEFORE Stripe
    // and carried through the session so /success records it against the
    // member row it creates. Tier-pinned documents resolve here.
    const mwSvc = require('../services/memberwaiver');
    let waiverPack = null;
    if (mwSvc.cfgWaiver().mode === 'required') {
      const doc = mwSvc.docForTier(tier);
      if (doc) {
        if (!waiver_id || !String(waiver_signature || '').trim())
          return res.status(400).json({ error: 'Please read and sign the membership liability waiver to join.' });
        if (waiver_id !== doc.id)
          return res.status(400).json({ error: 'Waiver version mismatch. Please refresh and try again.' });
        waiverPack = {
          doc_id: doc.id,
          signature: String(waiver_signature).trim().slice(0, 80),
          guardian_for: String(waiver_guardian_for || '').trim().slice(0, 80),
          ip: req.ip || '',
          ua: String(req.headers['user-agent'] || '').slice(0, 180)
        };
      }
    }
    const price = cadence === 'annual' ? tier.price_annual : tier.price_monthly;
    if (!(price > 0)) return res.status(400).json({ error: 'That billing option is not available for this tier.' });
    if (tier.roster_cap > 0 && activeCount(tier.id) >= tier.roster_cap)
      return res.status(409).json({ error: `${tier.name} is currently full. Check back later or contact us.` });

    const out = await billing.createCheckoutSession(tier, cadence,
      { name: name.trim(), email: email.trim(), phone: phone.trim(), waiver: waiverPack }, baseUrl(req));
    // persist the Stripe product id the first time we create it
    if (out.productId && !tier.stripe_product_id) {
      db().prepare(`UPDATE membership_tiers SET stripe_product_id=? WHERE id=?`).run(out.productId, tier.id);
    }
    dbModule.adminLog('MEMBERSHIP_CHECKOUT_STARTED', `${tier.name} ${cadence} — ${email.trim()}`);
    res.json({ url: out.url });
  } catch (err) {
    console.error('membership checkout:', err.message);
    // NEVER TELL SOMEONE TO RETRY A PERMANENT FAILURE (maintainer, Sep 17 2026, a live
    // customer). This said "Please try again" on an IP-restricted key - a fault
    // no amount of retrying could fix - so the member kept pressing the button
    // and the owner spent an hour guessing. If the failure is the facility's
    // Stripe setup, say that plainly and point them at a human; the OWNER gets
    // the diagnosis on their own health line, where it belongs.
    const permanent = !!(err && (err.permanent || (err.stripe && (err.stripe.status === 401 || err.stripe.status === 403))));
    if (permanent) {
      try { dbModule.adminLog('MEMBERSHIP_CHECKOUT_BLOCKED', `Stripe refused this unit: ${String(err.stripe && err.stripe.message || err.message).slice(0, 180)}`); } catch {}
      return res.status(503).json({ error: 'This facility cannot take payments online at the moment. Please contact them directly to join - nothing has been charged.', permanent: true });
    }
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// GET /api/memberships/success — Stripe returns here; verify + create member
router.get('/success', async (req, res) => {
  try {
    const result = await billing.retrieveSession(String(req.query.session_id || ''));
    // A PAYMENT STILL COMPLETING IS NOT A FAILURE (maintainer, Sep 20 2026). The old
    // guard returned a bare null for "still open" and "does not exist" alike,
    // and the page told both "we could not verify that payment" - to a customer
    // whose money was in flight. Now: open -> "completing", and the reconcile
    // (boot and nightly) finishes the join whether or not they ever come back.
    if (!result) return res.redirect('/memberships?verify=failed');
    if (!result.paid) {
      if (result.state === 'open') {
        dbModule.adminLog('MEMBERSHIP_JOIN_PENDING', `session ${String(req.query.session_id || '').slice(0, 30)} - customer returned while the payment was still completing; the reconcile will finish it`);
        return res.redirect('/memberships?pending=1');
      }
      return res.redirect('/memberships?verify=failed');
    }

    // ONE MEMBER-CREATING PATH (maintainer, Sep 20 2026): this is the same call the
    // reconcile makes for a session whose browser never came back.
    const out = await join.createMemberFromSession(result, { source: 'success' });
    if (!out.ok) return res.redirect('/memberships?verify=failed');
    if (out.existing) return res.redirect(`/memberships?joined=1`);
    res.redirect(`/memberships?joined=1&pin=${out.pin}`);
  } catch (err) {
    console.error('membership success:', err.message);
    res.redirect('/memberships?verify=failed');
  }
});

// GET /api/memberships/mock-pay — MOCK MODE ONLY: simulates Stripe's hosted page
router.get('/mock-pay', (req, res) => {
  if (!billing.isMock()) return res.status(404).send('Not found');
  const sid = String(req.query.session_id || '');
  if (!billing.mockMarkPaid(sid)) return res.status(404).send('Unknown session');
  res.redirect(`/api/memberships/success?session_id=${sid}`);
});

// ── MEMBER SELF-SERVICE (PIN-authenticated, from the member portal) ──────────
function portalAuth(req) {
  const { name, pin } = req.body || {};
  if (!pin?.trim() || !name?.trim()) return null;
  const member = dbModule.getMemberByPin(pin.trim());
  if (!member) return null;
  const a = member.name.toLowerCase().trim(), b = name.toLowerCase().trim();
  if (!a.includes(b) && !b.includes(a)) return null;
  return member;
}

// POST /api/memberships/portal/cancel — the easy cancel. One call, effective at
// period end, benefits continue until then, no further charges. (Auto-renewal
// law: cancellation must be as easy as signup — this is one confirm away.)
router.post('/portal/cancel', async (req, res) => {
  try {
    const member = portalAuth(req);
    if (!member) return res.status(401).json({ error: 'Name and PIN do not match.' });
    if (!member.stripe_subscription_id) {
      return res.status(400).json({ error: 'Your membership is managed by the facility. Contact us and we will take care of it right away.' });
    }
    if (member.cancel_at_period_end) {
      return res.json({ success: true, already: true, ends: member.current_period_end });
    }
    await billing.cancelSubscription(member.stripe_subscription_id, true);
    db().prepare(`UPDATE members SET cancel_at_period_end=1 WHERE id=?`).run(member.id);
    dbModule.adminLog('MEMBER_SELF_CANCELED', `${member.name} — ends ${(member.current_period_end || '').slice(0, 10)}`);
    try {
      const email = require('../services/email');
      if (email.sendCancellationConfirmed && member.email) {
        await email.sendCancellationConfirmed({ to: member.email, name: member.name, ends: (member.current_period_end || '').slice(0, 10) });
      }
    } catch {}
    res.json({ success: true, ends: member.current_period_end });
  } catch (err) {
    console.error('portal cancel:', err.message);
    res.status(500).json({ error: 'Could not cancel right now. Please try again or contact us.' });
  }
});

// POST /api/memberships/portal/billing — Stripe-hosted card update page.
router.post('/portal/billing', async (req, res) => {
  try {
    const member = portalAuth(req);
    if (!member) return res.status(401).json({ error: 'Name and PIN do not match.' });
    if (!member.stripe_customer_id) return res.status(400).json({ error: 'No online billing on this membership.' });
    const out = await billing.createBillingPortalSession(member.stripe_customer_id, `${baseUrl(req)}/my-membership`);
    res.json({ url: out.url });
  } catch (err) {
    console.error('portal billing:', err.message);
    res.status(500).json({ error: 'Could not open billing right now. Please try again.' });
  }
});

module.exports = router;
