// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/membership-billing.js — Stripe subscription layer for memberships.
// The owner never touches the Stripe dashboard: products/prices are created via
// their API keys automatically. MOCK MODE: if the secret key starts with
// 'sk_mock', all Stripe calls are simulated locally (sandbox/demo testing).
// Real keys (sk_test_/sk_live_) hit the real Stripe API.
const { getConfig } = require('./config');
const crypto = require('crypto');

const mockSessions = new Map(); // mock mode only

function stripeKey() { return getConfig().stripe?.secretKey || ''; }
const mark = require('./stripemark');   // rule 25: every object we make carries our marker
function isMock() { return stripeKey().startsWith('sk_mock'); }

// BA_STRIPE_API_BASE points a battery's stand-in Stripe at this module. It is
// honoured ONLY with an sk_test_ key (test-stripe-hygiene): a live key always
// goes to api.stripe.com whatever the environment says.
function apiBase() { return (process.env.BA_STRIPE_API_BASE && /^sk_test_/.test(stripeKey())) ? process.env.BA_STRIPE_API_BASE : 'https://api.stripe.com'; }
async function stripeCall(method, path, params, opts) {
  const body = params ? new URLSearchParams(flatten(params)).toString() : '';
  const res = await fetch(`${apiBase()}/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${stripeKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Pin the API version: field locations are version-dependent (Basil moved
      // current_period_end from the subscription onto its items). Pinning keeps
      // our parsing correct regardless of the account's default version.
      'Stripe-Version': '2025-03-31.basil'
    },
    body: method === 'GET' ? undefined : body
  });
  const data = await res.json();
  if (!res.ok) {
    // RULE 26: WE MADE THE CALL, WE READ THE ANSWER (Sep 17 2026). This kept only
    // the message string and dropped Stripe's type and code - so an IP-restricted
    // key produced "Could not start checkout. Please try again." to a customer and
    // a bare NO STRIPE to the owner, on a failure retrying can never fix.
    const err = new Error(data.error?.message || `Stripe ${res.status}`);
    err.stripe = { type: data.error?.type || '', code: data.error?.code || '',
                   message: data.error?.message || '', status: res.status };
    err.permanent = res.status === 401 || res.status === 403 || data.error?.type === 'authentication_error';
    // a caller asking whether something EXISTS (the gift check, Oct 3 2026) takes "no such object" as its answer, not as a
    // fault of the key - noted, a stale row read as STRIPE WRONG MODE and held Taking payments red
    const missing = res.status === 404 && data.error?.code === 'resource_missing';
    if (!(missing && opts && opts.missingIsAnswer)) { try { require('./stripestatus').noteStripeFailure(err); } catch {} }
    throw err;
  }
  try { require('./stripestatus').clearStripeFailure(); } catch {}
  return data;
}
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? flatten(x, `${key}[${i}]`, out) : out[`${key}[${i}]`] = x));
    else out[key] = v;
  }
  return out;
}

// Basil+ keeps billing periods on subscription ITEMS; older versions kept them
// on the subscription itself. Read both.
function subPeriodEndISO(sub) {
  const ts = sub?.items?.data?.[0]?.current_period_end || sub?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : '';
}

// Ensure a Stripe Product + monthly/annual Prices exist for a tier. Returns
// { productId, priceMonthlyId, priceAnnualId } (ids empty where not offered).
async function ensureTierPrices(tier) {
  if (isMock()) {
    return { productId: `prod_mock_${tier.id}`,
      priceMonthlyId: tier.price_monthly > 0 ? `price_mock_m_${tier.id}` : '',
      priceAnnualId:  tier.price_annual  > 0 ? `price_mock_a_${tier.id}` : '' };
  }
  const cfg = getConfig();
  let productId = tier.stripe_product_id;
  if (!productId) {
    const p = await stripeCall('POST', '/products', Object.assign({
      name: `${cfg.server.businessName} — ${tier.name} Membership`
    }, mark.metaParams()));
    productId = p.id;
  }
  // find-or-create prices matching current amounts (price objects are immutable)
  const prices = await stripeCall('GET', `/prices?product=${productId}&active=true&limit=100`);
  const find = (cents, interval) => (prices.data || []).find(pr =>
    pr.unit_amount === cents && pr.recurring?.interval === interval)?.id || '';
  let priceMonthlyId = tier.price_monthly > 0 ? find(Math.round(tier.price_monthly * 100), 'month') : '';
  let priceAnnualId  = tier.price_annual  > 0 ? find(Math.round(tier.price_annual  * 100), 'year')  : '';
  if (tier.price_monthly > 0 && !priceMonthlyId) {
    const pr = await stripeCall('POST', '/prices', Object.assign({
      product: productId, currency: 'usd',
      unit_amount: Math.round(tier.price_monthly * 100),
      recurring: { interval: 'month' }
    }, mark.metaParams()));
    priceMonthlyId = pr.id;
  }
  if (tier.price_annual > 0 && !priceAnnualId) {
    const pr = await stripeCall('POST', '/prices', Object.assign({
      product: productId, currency: 'usd',
      unit_amount: Math.round(tier.price_annual * 100),
      recurring: { interval: 'year' }
    }, mark.metaParams()));
    priceAnnualId = pr.id;
  }
  return { productId, priceMonthlyId, priceAnnualId };
}

// Create a subscription Checkout Session. Returns { url, sessionId }.
async function createCheckoutSession(tier, cadence, applicant, baseUrl) {
  const priceInfo = await ensureTierPrices(tier);
  const priceId = cadence === 'annual' ? priceInfo.priceAnnualId : priceInfo.priceMonthlyId;
  if (!priceId) throw new Error('That billing option is not available for this tier.');
  if (isMock()) {
    const sessionId = 'cs_mock_' + crypto.randomBytes(8).toString('hex');
    mockSessions.set(sessionId, {
      paid: false, tierId: tier.id, cadence, applicant,
      subscriptionId: 'sub_mock_' + crypto.randomBytes(6).toString('hex'),
      customerId: 'cus_mock_' + crypto.randomBytes(6).toString('hex')
    });
    return { url: `${baseUrl}/api/memberships/mock-pay?session_id=${sessionId}`, sessionId, productId: priceInfo.productId };
  }
  const session = await stripeCall('POST', '/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    customer_email: applicant.email,
    success_url: `${baseUrl}/api/memberships/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/memberships?canceled=1`,
    subscription_data: { metadata: mark.marker() },   // the subscription Checkout creates is ours too
    metadata: Object.assign(
      mark.marker(),
      { tier_id: tier.id, cadence, name: applicant.name, phone: applicant.phone },
      applicant.waiver ? {
        w_doc: applicant.waiver.doc_id,
        w_sig: applicant.waiver.signature,
        w_guard: applicant.waiver.guardian_for || '',
        w_ip: applicant.waiver.ip || '',
        w_ua: String(applicant.waiver.ua || '').slice(0, 180)
      } : {})
  });
  return { url: session.url, sessionId: session.id, productId: priceInfo.productId };
}

// Verify a completed session server-side. Returns normalized result or null.
async function retrieveSession(sessionId) {
  if (isMock()) {
    const s = mockSessions.get(sessionId);
    // A STATE, NEVER A BARE NULL (maintainer, Sep 20 2026): "still on the payment
    // page" and "this session does not exist" are different answers and the
    // customer is told different things.
    if (!s) return { paid: false, state: 'missing', sessionId };
    if (!s.paid) return { paid: false, state: 'open', sessionId };
    return { paid: true, tierId: s.tierId, cadence: s.cadence, applicant: s.applicant,
      customerId: s.customerId, subscriptionId: s.subscriptionId,
      periodEnd: new Date(Date.now() + (s.cadence === 'annual' ? 365 : 30) * 86400000).toISOString() };
  }
  let s;
  try { s = await stripeCall('GET', `/checkout/sessions/${sessionId}`); }
  catch (e) { return { paid: false, state: 'missing', sessionId, error: e.message }; }
  // Stripe's session status is open / complete / expired. A session that is
  // COMPLETE but not yet PAID is a subscription settling through a slower
  // method - the member is created and the reconcile fills the period in. A
  // session still OPEN means the customer is on the payment page (or arrived
  // here early): tell them it is completing, never that it failed. EXPIRED
  // and unknown are the only real failures.
  if (s.payment_status !== 'paid' && s.status !== 'complete') {
    return { paid: false, state: s.status === 'open' ? 'open' : 'expired', sessionId };
  }
  // the customer Checkout made for this session is ours: mark it (Checkout takes no customer metadata)
  if (s.customer) { try { await stripeCall('POST', `/customers/${encodeURIComponent(s.customer)}`, mark.metaParams()); } catch {} }
  let periodEnd = '';
  if (s.subscription) {
    try {
      const sub = await stripeCall('GET', `/subscriptions/${s.subscription}`);
      periodEnd = subPeriodEndISO(sub);
    } catch { /* period end fills in via reconcile */ }
  }
  return { paid: true, tierId: s.metadata?.tier_id, cadence: s.metadata?.cadence,
    applicant: { name: s.metadata?.name || '', email: s.customer_details?.email || '', phone: s.metadata?.phone || '',
      waiver: s.metadata?.w_doc ? { doc_id: s.metadata.w_doc, signature: s.metadata.w_sig || '',
        guardian_for: s.metadata.w_guard || '', ip: s.metadata.w_ip || '', ua: s.metadata.w_ua || '' } : null },
    customerId: s.customer, subscriptionId: s.subscription, periodEnd };
}

/**
 * The sessions this unit created in the last `days` days, ours only (rule 25 -
 * the marker is on the session metadata, never a name). This is the reconcile's
 * way of looking INTO Stripe for a paid signup with no member behind it, which
 * nothing in the product did before Sep 20 2026.
 * Returns [{ id, status, payment_status, subscription, customer, metadata }].
 */
async function listRecentSessions(days = 30) {
  if (isMock()) {
    return [...mockSessions.entries()].map(([id, s]) => ({
      id, status: s.paid ? 'complete' : 'open', payment_status: s.paid ? 'paid' : 'unpaid',
      subscription: s.subscriptionId, customer: s.customerId,
      metadata: Object.assign({}, mark.marker(), { tier_id: s.tierId, cadence: s.cadence, name: s.applicant?.name || '' })
    }));
  }
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const out = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const qs = `limit=100&created[gte]=${since}` + (after ? `&starting_after=${encodeURIComponent(after)}` : '');
    const r = await stripeCall('GET', `/checkout/sessions?${qs}`);
    const rows = (r && r.data) || [];
    for (const s of rows) {
      if (!mark.isOurs(s)) continue;                     // rule 25: never anyone else's
      if (s.mode !== 'subscription') continue;
      out.push({ id: s.id, status: s.status, payment_status: s.payment_status,
                 subscription: s.subscription, customer: s.customer, metadata: s.metadata || {} });
    }
    if (!r || !r.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return out;
}

function mockMarkPaid(sessionId) {
  const s = mockSessions.get(sessionId);
  if (s) s.paid = true;
  return !!s;
}


// ── Webhook registration ─────────────────────────────────────────────────────
// Registers this device's webhook endpoint in the owner's Stripe account and
// returns { id, secret }. Called at boot when Stripe is configured, a PUBLIC
// https domain exists, and no webhook is registered yet. The owner never
// touches Stripe. ONE ENDPOINT PER URL (Sep 11 2026): Stripe never hands a
// secret out twice, so an endpoint whose secret this unit has lost is useless
// and Stripe keeps retrying it forever (1,118 retries on the bench's dead
// twin) - the lifecycle deletes every existing endpoint on our URL before it
// registers, never registers a second one, and never registers at all for a
// host that is not public (membership-lifecycle.publicWebhookBase).
function webhookUrl(publicBase) { return `${publicBase}/api/stripe/webhook`; }
// EVERY event membership-lifecycle.applyEvent handles - the membership ones AND
// the card reader's (Sep 11 2026, A-wave 6): the list was written for
// memberships only, so a unit with a reader would never have received
// payment_intent.succeeded and no tab would ever have been marked paid by the
// webhook. test-stripe-hygiene holds this list and applyEvent in lockstep; an
// endpoint already registered with a shorter list is updated in place at boot.
const WEBHOOK_EVENTS = ['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted', 'refund.failed',
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled', 'terminal.reader.action_failed',
  // a refund made anywhere - our own or in Stripe's dashboard - comes off revenue (services/refunds.js, Sep 24 2026)
  'charge.refunded', 'refund.created', 'refund.updated'];
function eventParams(prefix = 'enabled_events') { const o = {}; WEBHOOK_EVENTS.forEach((e, i) => { o[`${prefix}[${i}]`] = e; }); return o; }
async function updateWebhookEvents(id) {
  if (isMock()) return { id };
  return stripeCall('POST', `/webhook_endpoints/${encodeURIComponent(id)}`, eventParams());
}
async function listWebhookEndpoints(url) {
  if (isMock()) return [];
  const r = await stripeCall('GET', '/webhook_endpoints?limit=100');
  return (r.data || []).filter(e => !url || e.url === url);
}
async function getWebhookEndpoint(id) {
  if (isMock()) return { id, status: 'enabled' };
  try { return await stripeCall('GET', `/webhook_endpoints/${encodeURIComponent(id)}`); }
  catch (e) { if (/No such webhook endpoint|resource_missing/i.test(e.message)) return null; throw e; }
}
async function deleteWebhookEndpoint(id) {
  if (isMock()) return true;
  await stripeCall('DELETE', `/webhook_endpoints/${encodeURIComponent(id)}`);
  return true;
}
async function registerWebhook(publicBase) {
  if (isMock()) return { id: 'we_mock', secret: 'whsec_mock' };
  const ep = await stripeCall('POST', '/webhook_endpoints', Object.assign({
    url: webhookUrl(publicBase),
    api_version: '2025-03-31.basil',
    description: 'Booking system membership billing + card reader (auto-registered)'
  }, eventParams(), mark.metaParams()));
  return { id: ep.id, secret: ep.secret };
}

// Verify a Stripe-Signature header against the raw body. Returns true/false.
function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (isMock()) return true; // mock mode: unsigned local calls allowed
  // AN EMPTY SIGNING SECRET IS NOT A SECRET (maintainer, Sep 21 2026). crypto accepts ''
  // as an HMAC key quite happily, so with no secret configured the "expected"
  // signature was one ANYONE could compute - a forged invoice.paid reactivated a
  // member and a forged event was simply believed. Units that never register a
  // webhook keep an empty secret by design (rule 24 skips reserved and private
  // hosts), so this is the normal state of a unit on a private LAN, not an edge
  // case. No secret now means no signature can be valid: fail closed.
  if (!String(secret || '').trim()) return false;
  try {
    const parts = Object.fromEntries(String(sigHeader || '').split(',').map(p => p.split('=')));
    if (!parts.t || !parts.v1) return false;
    // Replay protection: reject events signed more than 5 minutes ago.
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
    const expected = crypto.createHmac('sha256', secret)
      .update(`${parts.t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(parts.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

async function getSubscription(subId) {
  if (isMock()) return null;
  return stripeCall('GET', `/subscriptions/${subId}`);
}
// Cancel immediately (grace expired) or at period end (member self-cancel, M4).
async function cancelSubscription(subId, atPeriodEnd) {
  if (isMock()) return { status: atPeriodEnd ? 'active' : 'canceled', cancel_at_period_end: !!atPeriodEnd };
  if (atPeriodEnd) return stripeCall('POST', `/subscriptions/${subId}`, { cancel_at_period_end: 'true' });
  return stripeCall('DELETE', `/subscriptions/${subId}`);
}

/**
 * STOP THE BILLING, OR SAY IT DID NOT STOP (Oct 3 2026; the Sep 13 stand-in and catch audit's HIGH, never fixed). The
 * owner's Cancel and the grace cancel caught Stripe's refusal, printed it to the console and marked the member cancelled
 * anyway - so Stripe kept charging a member the unit called cancelled, and nothing looked again (the nightly reconcile
 * walks active members). A refusal is checked against the subscription itself: one Stripe already shows cancelled (or
 * set to end at the period, when that was asked) or no longer has is stopped; anything else throws, in Stripe's words.
 */
async function stopBilling(subId, atPeriodEnd) {
  try { return await cancelSubscription(subId, atPeriodEnd); }
  catch (e) {
    let sub = null;
    try { sub = await stripeCall('GET', `/subscriptions/${encodeURIComponent(subId)}`); }
    catch (e2) { if (e2.stripe && (e2.stripe.code === 'resource_missing' || e2.stripe.status === 404)) return { status: 'canceled', gone: true }; }
    if (sub && (sub.status === 'canceled' || sub.status === 'incomplete_expired' || (atPeriodEnd && sub.cancel_at_period_end))) return sub;
    throw e;
  }
}


// Stripe hosted billing portal session — where members update their card.
// Creates a default portal configuration on first use if none exists.
async function createBillingPortalSession(customerId, returnUrl) {
  if (isMock()) return { url: returnUrl + '?mock_portal=1' };
  try {
    return await stripeCall('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
  } catch (e) {
    if (!/configuration/i.test(e.message)) throw e;
    await stripeCall('POST', '/billing_portal/configurations', Object.assign({
      'features[customer_update][enabled]': 'true',
      'features[customer_update][allowed_updates][0]': 'email',
      'features[payment_method_update][enabled]': 'true',
      'features[invoice_history][enabled]': 'true',
      'business_profile[headline]': 'Manage your membership payment method'
    }, mark.metaParams()));
    return await stripeCall('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
  }
}

module.exports = { stopBilling, ensureTierPrices, createCheckoutSession, retrieveSession, listRecentSessions, mockMarkPaid, isMock,
  registerWebhook, webhookUrl, listWebhookEndpoints, getWebhookEndpoint, deleteWebhookEndpoint, updateWebhookEvents, WEBHOOK_EVENTS, verifyWebhookSignature, stripeCall, getSubscription, cancelSubscription, createBillingPortalSession, subPeriodEndISO };
