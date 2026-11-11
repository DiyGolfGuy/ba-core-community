// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/stripestatus.js  —  ONE TRUTH about whether Stripe is set up
//
//  A live customer on a drift-61 unit, fresh out of the wizard, saw the Getting
//  Started checklist tick "Stripe connected" GREEN while the header badge in the
//  same admin page read NO STRIPE. Two indicators, one config, opposite answers -
//  and both were wrong:
//
//    the checklist  routes/admin.js  done: !!cfg.stripe?.secretKey
//        A bare truthy check. ANY non-empty string ticked it: a publishable key
//        pasted into the secret box, a leftover PASTE_YOUR_KEY_HERE, a space.
//
//    the badge      public/admin.html updateEnvBadge(cfg)
//        key.startsWith('sk_live') / ('sk_test') else 'NO STRIPE' - computed in
//        the BROWSER, from the config the browser is given. That config is
//        masked: services/auth.js sanitizeConfigForClient replaces
//        stripe.secretKey with '__SECRET_UNCHANGED__:<last4>' precisely so a
//        secret never reaches a browser. So the badge could never match either
//        prefix and read NO STRIPE on EVERY unit that had a key saved. The same
//        masked-sentinel defect the UniFi audit found at Test Connection.
//
//  So: the browser cannot answer this question - it is not allowed to see the
//  answer. It is computed HERE, on the real config, and both surfaces render what
//  this says. The wording names what is actually missing, because "NO STRIPE" to
//  an owner who has just pasted their keys in is not information, it is a
//  contradiction. (Sep 17 2026.)
//
//  What this can and cannot know: it reads the SHAPE of what is saved. It does
//  not call Stripe - a page load must not, and an owner opening admin on a unit
//  with no internet should not see "invalid". A key that is well-formed but
//  rejected by Stripe is reported by whoever actually made the call; this says
//  what is on disk and says so plainly.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const SK = /^sk_(live|test)_[A-Za-z0-9]/;
const PK = /^pk_(live|test)_[A-Za-z0-9]/;
const PLACEHOLDER = /^(PASTE|YOUR|xxx|<)/i;

function clean(v) { return String(v == null ? '' : v).trim(); }
function isPlaceholder(v) { return !v || PLACEHOLDER.test(v); }

/**
 * The one answer. Returns:
 *   ready   - true only when a usable SECRET key is saved (money can be taken)
 *   level   - 'live' | 'test' | 'none' | 'broken'
 *   badge   - the short words for the header badge
 *   label   - the sentence for the checklist and anywhere with room
 *   detail  - what to do about it, empty when nothing is wrong
 */
function stripeStatus(cfg) {
  const s = (cfg && cfg.stripe) || {};
  const sk = clean(s.secretKey), pk = clean(s.publishableKey);
  const skOk = SK.test(sk), pkOk = PK.test(pk);

  if (isPlaceholder(sk) && isPlaceholder(pk)) {
    return { ready: false, level: 'none', badge: 'NO STRIPE',
      label: 'Stripe not set up', detail: 'Settings > Connections: paste your Stripe secret and publishable keys to take payments.' };
  }
  // SOMETHING IS IN THE SECRET BOX AND IT IS NOT A SECRET KEY. This is checked
  // BEFORE the empty-secret cases: it is the more specific diagnosis, and the
  // owner needs to be told the box has the wrong key in it rather than that a key
  // is "missing" when they can see one sitting there. (Caught by B1 - my first
  // cut ordered these the other way round and gave the vaguer answer.)
  if (!skOk && sk && !isPlaceholder(sk)) {
    const looksPublishable = PK.test(sk);
    return { ready: false, level: 'broken', badge: looksPublishable ? 'KEYS SWAPPED' : 'STRIPE KEY WRONG',
      label: looksPublishable ? 'Stripe: the publishable key is in the secret key box' : 'Stripe: the secret key is not a Stripe key',
      detail: looksPublishable
        ? 'The value in the Secret Key box begins pk_ - that is the publishable key, which cannot take a payment. Settings > Connections: put the key beginning sk_ in the Secret Key box.'
        : 'The Secret Key box does not hold a Stripe secret key (they begin sk_live_ or sk_test_). Settings > Connections: paste it again.' };
  }
  // A publishable key alone is the commonest half-finished state: the owner
  // copied the one Stripe shows first. It cannot take a payment.
  if (!skOk && pkOk) {
    return { ready: false, level: 'broken', badge: 'NO SECRET KEY',
      label: 'Stripe half set up - no secret key saved',
      detail: 'Only the publishable key is saved. Settings > Connections: paste the SECRET key too (it begins sk_) - payments cannot be taken without it.' };
  }
  if (!skOk) {
    // name the publishable half too if THAT is what is wrong - the mk_ case
    if (pk && !pkOk) {
      return { ready: false, level: 'broken', badge: 'STRIPE KEYS WRONG',
        label: 'Stripe: neither key is a Stripe key',
        detail: 'Neither box holds a Stripe key. The secret begins sk_ and the publishable begins pk_ - both are in Stripe under Developers > API keys.' };
    }
    return { ready: false, level: 'none', badge: 'NO SECRET KEY',
      label: 'Stripe: no secret key saved',
      detail: 'Settings > Connections: paste your Stripe SECRET key (it begins sk_) - payments cannot be taken without it.' };
  }
  // A usable secret key. Say so, and say if the publishable half is missing -
  // the booking page needs it to mount Stripe's card form.
  const live = sk.startsWith('sk_live');
  if (pk && !pkOk) {
    return { ready: false, level: 'broken', badge: 'PUBLISHABLE KEY WRONG',
      label: 'Stripe: the publishable key is not a Stripe key',
      detail: 'The secret key is fine, but the Publishable Key box does not hold a key beginning pk_ - your booking page cannot show a card form without it.' };
  }
  if (!pkOk) {
    return { ready: true, level: live ? 'live' : 'test', badge: live ? 'LIVE - NO PUBLISHABLE KEY' : 'TEST - NO PUBLISHABLE KEY',
      label: 'Stripe: secret key saved, publishable key missing',
      detail: 'The card form on your booking page needs the publishable key (it begins pk_). Settings > Connections.' };
  }
  // Both halves present - and they must be the same mode, or checkout fails in a
  // way that is very hard to read from the customer's side.
  const pkLive = pk.startsWith('pk_live');
  if (live !== pkLive) {
    return { ready: false, level: 'broken', badge: 'STRIPE KEYS MISMATCHED',
      label: 'Stripe: one key is live and the other is test',
      detail: `The secret key is ${live ? 'LIVE' : 'TEST'} and the publishable key is ${pkLive ? 'LIVE' : 'TEST'}. They must be the same pair from the same Stripe account. Settings > Connections.` };
  }
  // The shape is right. But if Stripe itself has refused us since, THAT is the
  // truth - a well-formed key Stripe will not accept is not "connected".
  if (_fail) {
    return { ready: false, level: 'broken', badge: _fail.badge,
      label: 'Stripe is refusing this unit: ' + _fail.message.slice(0, 120),
      detail: _fail.hint, since: _fail.at, stripeCode: _fail.code || _fail.type || '' };
  }
  return { ready: true, level: live ? 'live' : 'test', badge: live ? 'LIVE' : 'TEST MODE',
    label: live ? 'Stripe connected (live)' : 'Stripe connected (test mode)', detail: '' };
}

/**
 * REFUSE A BAD KEY AT THE POINT OF PASTING (maintainer, Sep 17 2026 - a second live
 * customer, who pasted a value beginning mk_ into the Publishable Key field).
 * The product accepted it, the wizard let him finish, and he was left with a
 * facility that cannot take a payment and two indicators telling him different
 * things about it. Reporting the state truthfully afterwards is not enough: he
 * should never have been able to save it.
 *
 * Returns an array of { field, message } - empty when what was typed is usable.
 * The messages name what the value actually looks like, because "invalid" tells
 * an owner nothing they can act on.
 */
function validateStripeKeys(next, prev) {
  const out = [];
  const s = (next && next.stripe) || {};
  // a masked sentinel means "unchanged" - compare against what is already saved
  const unchanged = v => typeof v === 'string' && v.startsWith('__SECRET_UNCHANGED__');
  const sk = unchanged(s.secretKey) ? clean(((prev || {}).stripe || {}).secretKey) : clean(s.secretKey);
  const pk = unchanged(s.publishableKey) ? clean(((prev || {}).stripe || {}).publishableKey) : clean(s.publishableKey);

  const nameIt = (v) => {
    if (/^mk_/i.test(v))  return 'a merchant id';
    if (/^rk_/i.test(v))  return 'a restricted key';
    if (/^whsec_/i.test(v)) return 'a webhook signing secret';
    if (/^acct_/i.test(v)) return 'an account id';
    if (/^price_|^prod_/i.test(v)) return 'a price or product id';
    return null;
  };

  if (pk && !PK.test(pk)) {
    const what = nameIt(pk);
    out.push({ field: 'stripe.publishableKey',
      message: what
        ? `That looks like ${what}, not a publishable key - it should start with pk_live_ or pk_test_. You will find it in Stripe under Developers > API keys.`
        : SK.test(pk)
          ? 'That is the SECRET key (it begins sk_). The Publishable Key box wants the one beginning pk_ - and the secret one belongs in the Secret Key box.'
          : 'That does not look like a Stripe publishable key - they start with pk_live_ or pk_test_. You will find it in Stripe under Developers > API keys.' });
  }
  if (sk && !SK.test(sk)) {
    const what = nameIt(sk);
    out.push({ field: 'stripe.secretKey',
      message: what
        ? `That looks like ${what}, not a secret key - it should start with sk_live_ or sk_test_.`
        : PK.test(sk)
          ? 'That is the PUBLISHABLE key (it begins pk_). The Secret Key box wants the one beginning sk_ - a publishable key cannot take a payment.'
          : 'That does not look like a Stripe secret key - they start with sk_live_ or sk_test_.' });
  }
  // both well-formed, but from different sides of the same account: checkout
  // fails at the customer with an error nobody can read back to a cause
  if (SK.test(sk) && PK.test(pk)) {
    const skLive = sk.startsWith('sk_live'), pkLive = pk.startsWith('pk_live');
    if (skLive !== pkLive) out.push({ field: 'stripe.publishableKey',
      message: `Those two keys are from different modes - the secret key is ${skLive ? 'LIVE' : 'TEST'} and the publishable key is ${pkLive ? 'LIVE' : 'TEST'}. Use the pair from the same place in Stripe, or checkout will fail for your customers.` });
  }
  return out;
}

// ── WHAT STRIPE ACTUALLY SAID (rule 26, maintainer Sep 17 2026) ─────────────────────
// The same customer's secret key turned out to be IP-restricted in Stripe. Every
// call failed, Stripe said so in the error body - and the product threw that away
// and went on showing a bare NO STRIPE. He spent an hour guessing at something we
// had been told. We made the call; we must read the answer.
//
// Held in memory, not on disk: it is a live fact about right now, and a unit that
// restarts should find out for itself rather than remember a complaint.
let _fail = null;   // { at, type, code, message, hint }

/** Read a Stripe error body and say, in an owner's words, what it means. */
function explainStripeError(err) {
  const e = (err && err.stripe) || {};
  const type = String(e.type || '');
  const code = String(e.code || '');
  const msg  = String(e.message || (err && err.message) || '');
  const m = msg.toLowerCase();
  if (/ip address|ip_address|not allowed from|allowlist|allow list/.test(m))
    return { badge: 'STRIPE BLOCKED THIS UNIT', hint: 'Stripe is refusing this unit\'s requests because the key is restricted to certain IP addresses and this unit is not one of them. In Stripe: Developers > API keys > that key > edit its allowed IPs, or use a key without an IP restriction. Retrying will not help until that changes.' };
  if (/expired/.test(m) || code === 'api_key_expired')
    return { badge: 'STRIPE KEY EXPIRED', hint: 'Stripe says this key has expired. Create a new secret key in Stripe (Developers > API keys) and paste it into Settings > Connections.' };
  if (/test mode key|live mode key|similar object exists in (test|live) mode/.test(m))
    return { badge: 'STRIPE WRONG MODE', hint: 'Stripe says this key is for the other mode - a test key is being used against live data or the reverse. Check the pair in Settings > Connections are both live or both test.' };
  if (/restricted|permission|insufficient|does not have the required/.test(m) || /^rk_/.test(String(e.key || '')))
    // a restricted key (rk_) is refused when it is saved (nameIt above) - the system also makes products, prices, its
    // webhook, the billing portal and reader registrations - so the only advice that works is the standard key
    return { badge: 'STRIPE KEY RESTRICTED', hint: 'Stripe says this key does not have permission for what the booking system needs. Use your standard secret key (it begins sk_live_, or sk_test_ to practise) from Developers > API keys - the booking system does not take a restricted key.' };
  if (type === 'authentication_error' || code === 'api_key_invalid' || /invalid api key|no api key/.test(m))
    return { badge: 'STRIPE KEY REFUSED', hint: 'Stripe is refusing this key. Re-copy the secret key from Stripe (Developers > API keys) into Settings > Connections - if it was recently rolled, the old one stops working immediately.' };
  return null;   // not an auth-class problem: a one-off, not a configuration fault
}

/** Called by the Stripe client on a failure. Only auth-class problems stick. */
function noteStripeFailure(err) {
  try {
    const x = explainStripeError(err);
    if (!x) return;
    const e = (err && err.stripe) || {};
    _fail = { at: new Date().toISOString(), type: e.type || '', code: e.code || '',
              message: String(e.message || err.message || '').slice(0, 300), badge: x.badge, hint: x.hint };
  } catch { /* never let the reporting break the call that failed */ }
}
/** Called on any successful Stripe call - the complaint is over. */
function clearStripeFailure() { _fail = null; }
function lastStripeFailure() { return _fail; }

/** Is this failure one that retrying can never fix? Stripe's own 401/403 and
 *  authentication_error are the permanent ones; a network blip is not. */
function isPermanent(err) {
  if (!err) return false;
  if (err.permanent) return true;
  const st = err.stripe || {};
  if (st.status === 401 || st.status === 403) return true;
  if (st.type === 'authentication_error') return true;
  // the node-stripe SDK shape, used by the booking and gift paths
  const raw = err.raw || err;
  if (raw && (raw.statusCode === 401 || raw.statusCode === 403)) return true;
  if (raw && raw.type === 'StripeAuthenticationError') return true;
  if (raw && raw.type === 'StripePermissionError') return true;
  return false;
}
/** The words a CUSTOMER sees. Never "try again" on something that cannot change. */
function customerPaymentError(err) {
  return isPermanent(err)
    ? { status: 503, body: { error: 'This facility cannot take card payments at the moment. Please contact them directly - nothing has been charged.', permanent: true } }
    : { status: 502, body: { error: 'Payment system is temporarily unavailable. Please try again in a moment.' } };
}

module.exports = { stripeStatus, validateStripeKeys, SK, PK, isPermanent, customerPaymentError,
  explainStripeError, noteStripeFailure, clearStripeFailure, lastStripeFailure };
