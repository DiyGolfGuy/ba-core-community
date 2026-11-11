// Copyright (c) 2025-2026 BA Custom Products LLC.
// services/stripemark.js - THE PRODUCT OWNS ONLY WHAT IT CREATES (maintainer, Sep 12 2026, rule 25)
//
// A customer's Stripe account may hold products from their POS, their shop or
// an old site. Every Stripe object this product makes carries a marker in its
// metadata - ba_owner = 'ba-booking' and ba_unit = this unit's own id - and
// every sweep, cleanup, hygiene check and rule-24 assertion acts ONLY on
// marked objects and ignores everything else. Nothing we did not create is
// ever archived, cancelled or deleted by us.
//
//   marker()        { ba_owner, ba_unit }            for the Stripe SDK's metadata: {...}
//   metaParams(p)   { 'metadata[ba_owner]': .. }     for a form-encoded call (prefix per nesting)
//   isOurs(obj)     true when obj.metadata carries our owner marker
//   adoptReferenced() once per unit: mark the objects the unit's own rows and config
//                   reference (tiers' products and prices, members' customers and
//                   subscriptions, the webhook endpoint, the readers) - objects the
//                   product made BEFORE the rule; never by name, only by reference
'use strict';
const crypto = require('crypto');
const { getConfig, saveConfig } = require('./config');
const OWNER = 'ba-booking';

function unitId() {
  const cfg = getConfig();
  if (cfg.unit && cfg.unit.id) return cfg.unit.id;
  const id = crypto.randomUUID();
  try { const full = getConfig(); full.unit = Object.assign({}, full.unit, { id }); saveConfig(full); } catch {}
  return id;
}
function marker() { return { ba_owner: OWNER, ba_unit: unitId() }; }
function metaParams(prefix = 'metadata') { const m = marker(); return { [`${prefix}[ba_owner]`]: m.ba_owner, [`${prefix}[ba_unit]`]: m.ba_unit }; }
function isOurs(obj) { const m = obj && obj.metadata; return !!(m && m.ba_owner === OWNER); }
function isThisUnits(obj) { const m = obj && obj.metadata; return !!(m && m.ba_owner === OWNER && m.ba_unit === unitId()); }

// The references a unit holds: what it made before Sep 12 2026 and never marked.
function referenced() {
  const cfg = getConfig(); const out = { products: [], customers: [], subscriptions: [], endpoints: [], readers: [] };
  try {
    const db = require('./db').db;
    for (const r of db.prepare(`SELECT stripe_product_id FROM membership_tiers WHERE COALESCE(stripe_product_id,'')<>''`).all()) out.products.push(r.stripe_product_id);
    for (const r of db.prepare(`SELECT stripe_customer_id, stripe_subscription_id FROM members WHERE COALESCE(stripe_customer_id,'')<>'' OR COALESCE(stripe_subscription_id,'')<>''`).all()) { if (r.stripe_customer_id) out.customers.push(r.stripe_customer_id); if (r.stripe_subscription_id) out.subscriptions.push(r.stripe_subscription_id); }
  } catch {}
  if (cfg.stripe && cfg.stripe.webhookId) out.endpoints.push(cfg.stripe.webhookId);
  for (const r of ((cfg.terminal && cfg.terminal.readers) || [])) if (r && r.id) out.readers.push(r.id);
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  return out;
}
// Mark what the unit references and does not yet carry the marker. Once per
// unit (stripe.adoptedAt), because a unit with hundreds of members must not
// read every customer at every boot; everything made after the rule is born
// marked. Returns what it did. `call(method, path, params)` is the billing
// module's stripeCall so the test base override and the key apply.
async function adoptReferenced(call, opts = {}) {
  const cfg = getConfig();
  if (!cfg.stripe || !cfg.stripe.secretKey || String(cfg.stripe.secretKey).startsWith('sk_mock')) return { did: 'skip', why: 'no Stripe' };
  if (cfg.stripe.adoptedAt && !opts.force) return { did: 'skip', why: 'adopted ' + cfg.stripe.adoptedAt };
  const refs = referenced(); const marked = [], kept = [], missing = [];
  const paths = { products: '/products/', customers: '/customers/', subscriptions: '/subscriptions/', endpoints: '/webhook_endpoints/', readers: '/terminal/readers/' };
  for (const [kind, ids] of Object.entries(refs)) {
    for (const id of ids) {
      let obj = null; try { obj = await call('GET', paths[kind] + encodeURIComponent(id)); } catch (e) { missing.push(kind + ' ' + id); continue; }
      if (!obj || obj.deleted) { missing.push(kind + ' ' + id); continue; }
      if (isOurs(obj)) { kept.push(kind + ' ' + id); continue; }
      try { await call('POST', paths[kind] + encodeURIComponent(id), metaParams()); marked.push(kind + ' ' + id); } catch (e) { missing.push(kind + ' ' + id + ' (' + e.message + ')'); }
      if (kind === 'products') {
        // a product's prices go with it
        try { const prices = await call('GET', `/prices?product=${encodeURIComponent(id)}&limit=100`); for (const pr of (prices.data || [])) if (!isOurs(pr)) { await call('POST', '/prices/' + pr.id, metaParams()); marked.push('prices ' + pr.id); } } catch {}
      }
    }
  }
  try { const full = getConfig(); full.stripe = Object.assign({}, full.stripe, { adoptedAt: new Date().toISOString() }); saveConfig(full); } catch {}
  return { did: 'adopted', marked, kept, missing };
}
module.exports = { OWNER, unitId, marker, metaParams, isOurs, isThisUnits, referenced, adoptReferenced };
