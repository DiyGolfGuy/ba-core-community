// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/stripetax.js — "Let Stripe compute tax" (maintainer, Aug 14 2026)
//
//  The owner's toggle between the manual tax engine (category rates, the
//  default) and Stripe Tax (Stripe computes by venue address + product codes).
//  Built against docs current Aug 2026:
//    - POST /v1/tax/calculations  (venue address as customer_details, billing)
//    - Card sales: link calc to the PaymentIntent via hooks[inputs][tax]
//      [calculation] (requires per-call Stripe-Version >= 2025-11-17.clover;
//      the rest of our integration stays pinned on basil) -> Stripe then
//      auto-creates the tax transaction on success and auto-reverses on
//      refunds, full or partial.
//    - Cash/check sales: create_from_calculation; refunds: create_reversal.
//  SAFETY: if Stripe answers $0 because the venue's state has no active
//  registration (taxability_reason 'not_collecting'), we FALL BACK to the
//  manual engine for that computation and log loudly — a misconfigured
//  toggle must never silently stop collecting tax.
// ═══════════════════════════════════════════════════════════════════════════════

const { getConfig } = require('./config');

const TAX_API_VERSION = '2025-11-17.clover';   // hooks[inputs][tax] minimum

function stripeKey() { return getConfig().stripe?.secretKey || ''; }
// A deliberate sk_mock key is a TEST fixture. NO key is not a mock - it is an
// unconfigured unit, and it must never be reported as working (maintainer, Aug 14:
// the status button said ACTIVE on a unit with no Stripe key at all).
function isMock()    { return stripeKey().startsWith('sk_mock'); }
function noKey()     { return !stripeKey(); }

function taxCfg() {
  const p = getConfig().pos || {};
  const t = Object.assign({ categories: {}, stripeTax: false, stripeCodes: {}, venueAddress: {} }, p.tax || {});
  return t;
}

/** The toggle: on only when the owner checked it AND a real key exists (mock counts for tests). */
function enabled() { return !!taxCfg().stripeTax; }

// Default Stripe product tax codes per our categories (GA codes only —
// the recreation participant code is preview-gated, so sim time ships as
// General Services until Stripe GAs it).
const DEFAULT_CODES = { sim: 'txcd_20030000', food: 'txcd_40060003', beverage: 'txcd_99999999' };
function codeFor(category) {
  const c = taxCfg().stripeCodes || {};
  return c[category] || DEFAULT_CODES[category] || 'txcd_99999999';
}

function venueAddress() {
  const v = taxCfg().venueAddress || {};
  return { line1: v.line1 || '', city: v.city || '', state: v.state || '', postal_code: v.postal_code || '', country: 'US' };
}

// ── raw REST (form-encoded, same discipline as terminal.js) ─────────────────
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? flatten(item, `${key}[${i}]`, out) : (out[`${key}[${i}]`] = String(item))));
    else out[key] = String(v);
  }
  return out;
}

let _lastRequest = null;   // test observability
function _test_lastRequest() { return _lastRequest; }

async function taxCall(method, path, params, idempotencyKey) {
  _lastRequest = { method, path, params: params || null, idempotencyKey: idempotencyKey || null };
  if (isMock()) return mockRespond(method, path, params);
  const body = params ? new URLSearchParams(flatten(params)).toString() : '';
  const headers = {
    'Authorization': `Bearer ${stripeKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': TAX_API_VERSION,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body: body || undefined });
  const data = await res.json();
  if (!res.ok) { const e = new Error(data.error?.message || `stripe tax ${res.status}`); e.stripe = data.error; throw e; }
  return data;
}

// Deterministic mock: taxes at the MANUAL category rates so mock-mode totals
// stay identical whichever engine is on — batteries prove the WIRING, and no
// mock can ever drift a real bill.
function mockRespond(method, path, params) {
  if (path === '/tax/calculations') {
    const rates = taxCfg().categories || {};
    let total = 0, tax = 0;
    const items = [];
    let i = 0;
    while (params && params.line_items && params.line_items[i] !== undefined) {
      const li = params.line_items[i];
      const cat = Object.keys(DEFAULT_CODES).find(c => codeFor(c) === li.tax_code) || 'food';
      const t = Math.round((li.amount | 0) * (Number(rates[cat] || 0) / 100));
      items.push({ amount: li.amount | 0, amount_tax: t, reference: li.reference });
      total += (li.amount | 0) + t; tax += t; i++;
    }
    const h = String(Math.abs(JSON.stringify(params).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)));
    return { id: 'taxcalc_mock_' + h, amount_total: total, tax_amount_exclusive: tax, tax_amount_inclusive: 0,
             tax_breakdown: [{ amount: tax, taxability_reason: tax > 0 ? 'standard_rated' : 'not_collecting' }],
             line_items: { data: items }, expires_at: Math.floor(Date.now() / 1000) + 86400 * 90, mock: true };
  }
  if (path === '/tax/transactions/create_from_calculation') return { id: 'taxtxn_mock_' + (params.reference || 'x'), reference: params.reference, mock: true };
  if (path.includes('/tax/transactions/create_reversal')) return { id: 'taxrev_mock_' + (params.reference || 'x'), mock: true };
  if (path === '/tax/settings') return { status: 'active', mock: true };
  // Rule 15: no state default anywhere, a mock included. The stub reports the
  // registration for the state the OPERATOR entered as their venue address, and
  // reports none at all when they have not entered one - it never invents a
  // jurisdiction on their behalf.
  if (path.startsWith('/tax/registrations')) {
    const st = venueAddress().state;
    return { data: st ? [{ country: 'US', state: st, status: 'active' }] : [], mock: true };
  }
  return { mock: true };
}

// ── the four verbs ──────────────────────────────────────────────────────────

/**
 * Calculate tax for line items at the venue.
 * lines: [{ amount_cents, reference, category }]
 * Returns { ok, calc_id, tax_cents, total_cents, not_collecting, engine }.
 * On 'not_collecting' or any Stripe error: engine='manual-fallback' with the
 * manual category math, and a loud admin log — the sale always proceeds.
 */
async function calculate(lines, refBase) {
  const manual = manualTax(lines);
  if (!enabled()) return Object.assign(manual, { engine: 'manual' });
  if (noKey()) {
    logLoud('Stripe Tax is switched on but no Stripe key is saved - manual rates used.');
    return Object.assign(manual, { engine: 'manual-fallback', error: 'no stripe key' });
  }
  try {
    const addr = venueAddress();
    if (!addr.state || !addr.postal_code) throw new Error('venue address incomplete');
    const params = {
      currency: 'usd',
      customer_details: { address: addr, address_source: 'billing' },
      line_items: lines.map((l, i) => ({
        amount: l.amount_cents | 0,
        reference: `${refBase}-${l.reference || i}`,
        tax_code: codeFor(l.category),
        tax_behavior: 'exclusive',
        quantity: 1,
      })),
    };
    const calc = await taxCall('POST', '/tax/calculations', params);
    const notCollecting = (calc.tax_breakdown || []).some(b => b.taxability_reason === 'not_collecting') && !(calc.tax_amount_exclusive | 0);
    if (notCollecting) {
      logLoud(`Stripe Tax returned $0 (state not registered) for ${refBase} — manual tax applied instead`);
      return Object.assign(manual, { engine: 'manual-fallback', not_collecting: true });
    }
    // Per-line tax is what makes an honest Z report: the caller groups these
    // by ITS OWN categories instead of scaling a lump sum (maintainer, Aug 14).
    const byRef = {};
    for (const li of (calc.line_items?.data || [])) {
      if (li && li.reference) byRef[li.reference] = li.amount_tax | 0;
    }
    return { ok: true, engine: 'stripe', calc_id: calc.id, tax_cents: calc.tax_amount_exclusive | 0,
             total_cents: calc.amount_total | 0, not_collecting: false, by_reference: byRef };
  } catch (e) {
    logLoud(`Stripe Tax calculation failed for ${refBase}: ${e.message} — manual tax applied instead`);
    return Object.assign(manual, { engine: 'manual-fallback', error: e.message });
  }
}

/** The manual engine, shared shape. */
function manualTax(lines) {
  const rates = taxCfg().categories || {};
  let tax = 0, sub = 0;
  for (const l of lines) {
    sub += l.amount_cents | 0;
    tax += Math.round((l.amount_cents | 0) * (Number(rates[l.category] || 0) / 100));
  }
  return { ok: true, calc_id: null, tax_cents: tax, total_cents: sub + tax, not_collecting: false };
}

/** Record a committed sale (cash/check paths — card paths record themselves via the PI link). */
async function recordSale(calc_id, reference) {
  if (!enabled() || !calc_id) return { skipped: true };
  try {
    return await taxCall('POST', '/tax/transactions/create_from_calculation',
      { calculation: calc_id, reference }, 'taxrec-' + reference);
  } catch (e) { logLoud(`Stripe Tax record failed for ${reference}: ${e.message}`); return { error: e.message }; }
}

/** Reverse for a cash refund: full, or partial by flat negative amount. */
async function reverseSale(txn_id, reference, partial_cents) {
  if (!enabled() || !txn_id) return { skipped: true };
  const params = partial_cents
    ? { mode: 'partial', original_transaction: txn_id, reference, flat_amount: -Math.abs(partial_cents | 0) }
    : { mode: 'full', original_transaction: txn_id, reference };
  try { return await taxCall('POST', '/tax/transactions/create_reversal', params, 'taxrev-' + reference); }
  catch (e) { logLoud(`Stripe Tax reversal failed for ${reference}: ${e.message}`); return { error: e.message }; }
}

/** PI params fragment for card sales: link the calculation; caller merges. */
function piLinkParams(calc_id) {
  return calc_id ? { 'hooks[inputs][tax][calculation]': calc_id } : {};
}
function piVersionOverride() { return TAX_API_VERSION; }

/** Readiness for the admin card: settings active + registered states. */
async function readiness() {
  if (noKey()) return { configured: false, reason: 'No Stripe key is saved on this system yet - add your Stripe keys first (Settings > Connections).' };
  try {
    const settings = await taxCall('GET', '/tax/settings', null);
    const regs = await taxCall('GET', '/tax/registrations?status=active', null);
    const states = (regs.data || []).filter(r => r.country === 'US').map(r => r.state || r.country_options?.us?.state).filter(Boolean);
    const venueState = venueAddress().state;
    return { configured: true, settings_active: settings.status === 'active', states,
             venue_state: venueState, venue_covered: !venueState || states.includes(venueState) };
  } catch (e) { return { configured: false, error: e.message }; }
}

function logLoud(msg) {
  try { require('./db').adminLog('STRIPE_TAX', msg); } catch {}
  try { console.warn('[stripe-tax]', msg); } catch {}
}

module.exports = { enabled, isMock, noKey, calculate, manualTax, recordSale, reverseSale,
                   piLinkParams, piVersionOverride, readiness, codeFor, DEFAULT_CODES,
                   _test_lastRequest };
