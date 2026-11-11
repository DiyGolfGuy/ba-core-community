// Copyright (c) 2025-2026 BA Custom Products LLC.
// test-stripe-status.js — ONE TRUTH ABOUT STRIPE (a live customer, Sep 17 2026)
//
// Reported from a drift-61 unit, fresh out of the wizard: the Getting Started
// checklist showed "Stripe connected" ticked GREEN while the header badge in the
// same admin page read NO STRIPE. The owner had set Stripe up.
//
// Both were wrong, in opposite directions:
//   checklist  routes/admin.js   done: !!cfg.stripe?.secretKey   - any non-empty
//              string ticked it, including a publishable key in the wrong box.
//   badge      admin.html        key.startsWith('sk_live'|'sk_test') - computed in
//              the BROWSER from a config where stripe.secretKey is MASKED to
//              '__SECRET_UNCHANGED__:<last4>', so it matched neither prefix and
//              said NO STRIPE on every unit that had a key.
//
// The states below are the ones maintainer named, plus the two this turned up on the way.
'use strict';
const fs = require('fs'); const path = require('path');
let pass = 0, fail = 0;
const ok = (n,c,x)=>{ if(c){pass++;console.log('PASS  '+n);} else {fail++;console.log('FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,280):''));} };
const root = __dirname;
const { stripeStatus } = require('./services/stripestatus');
const auth = require('./services/auth');

const S = (secretKey, publishableKey) => ({ stripe: { secretKey, publishableKey } });

console.log('── A. every state maintainer named, one answer each ──');
{
  const none = stripeStatus(S('', ''));
  ok('A1 NO KEYS: not ready, and the badge says so without pretending', none.ready === false && none.level === 'none' && /NO STRIPE/.test(none.badge), none);
  ok('A1b ...and it tells the owner what to do', /paste your Stripe secret and publishable keys/i.test(none.detail), none.detail);

  const pkOnly = stripeStatus(S('', 'pk_test_51abcDEF'));
  ok('A2 PUBLISHABLE ONLY: not ready - a publishable key cannot take a payment', pkOnly.ready === false, pkOnly);
  ok('A2b ...and the badge names the missing half rather than saying NO STRIPE',
     /NO SECRET KEY/.test(pkOnly.badge) && /secret key/i.test(pkOnly.label), pkOnly);

  const skOnly = stripeStatus(S('sk_test_51abcDEF', ''));
  ok('A3 SECRET ONLY: ready to take money, but the card form needs the other half',
     skOnly.ready === true && /PUBLISHABLE/.test(skOnly.badge) && /publishable key/i.test(skOnly.detail), skOnly);

  const both = stripeStatus(S('sk_test_51abcDEF', 'pk_test_51abcDEF'));
  ok('A4 BOTH: ready, and the mode is named', both.ready === true && both.level === 'test' && /TEST/.test(both.badge), both);
  const live = stripeStatus(S('sk_live_51abcDEF', 'pk_live_51abcDEF'));
  ok('A4b BOTH, LIVE: ready and says LIVE, so an owner never takes real money thinking it is a test',
     live.ready === true && live.level === 'live' && /LIVE/.test(live.badge), live);

  // "both but invalid" - the shapes are the only thing readable without calling
  // Stripe, and a page load must not. These are the invalid shapes.
  const placeholder = stripeStatus(S('PASTE_YOUR_SECRET_KEY', 'PASTE_YOUR_PUBLISHABLE_KEY'));
  ok('A5 BOTH BUT INVALID (the wizard placeholders still in the boxes): not ready, and not called connected',
     placeholder.ready === false, placeholder);
  const junk = stripeStatus(S('hello', 'world'));
  ok('A5b BOTH BUT INVALID (not Stripe keys at all): not ready, and the message says they are not Stripe keys',
     junk.ready === false && /not a Stripe key/i.test(junk.label + junk.detail), junk);
}

console.log('\n── B. the two states that caused the customer report ──');
{
  const swapped = stripeStatus(S('pk_test_51abcDEF', 'pk_test_51abcDEF'));
  ok('B1 the publishable key pasted into the SECRET box is caught and named exactly',
     swapped.ready === false && /publishable key is in the secret key box/i.test(swapped.label), swapped);
  ok('B1b ...which the old checklist would have ticked GREEN (it was a bare truthy check)',
     !!'pk_test_51abcDEF' === true && swapped.ready === false);
  const mixed = stripeStatus(S('sk_live_51abcDEF', 'pk_test_51abcDEF'));
  ok('B2 a live secret with a test publishable is refused - checkout would fail in a way nobody could read',
     mixed.ready === false && /MISMATCH/i.test(mixed.badge), mixed);
}

console.log('\n── C. the browser is given the VERDICT, never the secret ──');
{
  const cfg = { stripe: { secretKey: 'sk_live_51abcSECRET', publishableKey: 'pk_live_51abcDEF' }, server: {} };
  const sent = auth.sanitizeConfigForClient(cfg);
  ok('C1 the secret key is still masked on its way to the browser - this fix does not leak it',
     typeof sent.stripe.secretKey === 'string' && sent.stripe.secretKey.startsWith('__SECRET_UNCHANGED__'), sent.stripe.secretKey);
  ok('C2 ...and the verdict rides alongside it, so the badge has something true to render',
     sent.stripe.status && sent.stripe.status.ready === true && sent.stripe.status.badge === 'LIVE', sent.stripe.status);
  ok('C3 the real key never appears anywhere in what the browser receives',
     !JSON.stringify(sent).includes('51abcSECRET'), 'the secret leaked into the config response');
  const none = auth.sanitizeConfigForClient({ stripe: { secretKey: '', publishableKey: '' }, server: {} });
  ok('C4 an unconfigured unit still gets a verdict rather than nothing', none.stripe.status && none.stripe.status.ready === false, none.stripe.status);
}

console.log('\n── D. the two surfaces cannot disagree again ──');
{
  const adm = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
  ok('D1 the checklist reads services/stripestatus, not a truthy check on the key',
     /stripestatus/.test(adm) && !/done:\s*!!cfg\.stripe\?\.secretKey/.test(adm), 'routes/admin.js still derives its own answer');
  const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
  ok('D2 the badge renders cfg.stripe.status and no longer matches key prefixes in the browser',
     /cfg\.stripe\?\.status/.test(html) && !/key\.startsWith\('sk_live'\)/.test(html), 'admin.html still works it out itself');
  ok('D3 nothing else in the browser decides Stripe readiness from the masked key',
     !/stripe\?\.secretKey\s*\|\|\s*''/.test(html) || !/startsWith\('sk_/.test(html), 'another client-side derivation remains');
}

console.log('\n── E. the product REFUSES a key that cannot work, at the point of pasting ──');
// The second live customer pasted a merchant id (mk_...) into the Publishable
// Key field. The product accepted it and let him finish the wizard. Reporting
// the state honestly afterwards is not the fix - he should never have got past
// the box. maintainer: "that looks like a merchant id, not a publishable key".
{
  const { validateStripeKeys } = require('./services/stripestatus');
  const v = (sk, pk, prev) => validateStripeKeys({ stripe: { secretKey: sk, publishableKey: pk } }, prev);

  const mk = v('', 'mk_51abcMERCHANT');
  ok('E1 a merchant id in the Publishable Key box is REFUSED', mk.length >= 1 && mk[0].field === 'stripe.publishableKey', mk);
  ok('E1b ...and the refusal names what it actually looks like, in the owner\'s words',
     /looks like a merchant id, not a publishable key/i.test(mk[0].message) && /pk_live_ or pk_test_/.test(mk[0].message), mk[0].message);
  ok('E1c ...and says where to find the right one', /Developers > API keys/.test(mk[0].message), mk[0].message);

  ok('E2 a webhook signing secret in a key box is named for what it is',
     /webhook signing secret/i.test(v('', 'whsec_abc')[0].message), v('', 'whsec_abc'));
  ok('E3 the two keys swapped between boxes is named as swapped, not as invalid',
     /is the SECRET key/i.test(v('', 'sk_test_abc')[0].message) && /is the PUBLISHABLE key/i.test(v('pk_test_abc', '')[0].message));
  ok('E4 a live secret with a test publishable is refused at save, not just reported later',
     v('sk_live_a1', 'pk_test_b2').some(x => /different modes/i.test(x.message)), v('sk_live_a1', 'pk_test_b2'));
  ok('E5 a good pair saves with no complaint', v('sk_test_a1', 'pk_test_b2').length === 0);
  ok('E6 empty boxes are not an error - an owner may set Stripe up later', v('', '').length === 0);
  ok('E7 the masked sentinel means UNCHANGED and is judged against what is already saved, never refused as junk',
     v('__SECRET_UNCHANGED__:1234', 'pk_test_b2', { stripe: { secretKey: 'sk_test_a1', publishableKey: 'pk_test_b2' } }).length === 0);

  // and the state the customer was left in reads correctly
  const st = stripeStatus(S('', 'mk_51abcMERCHANT'));
  ok('E8 if such a value is already on a unit, the badge names it rather than saying NO STRIPE',
     st.ready === false && /WRONG/.test(st.badge) && /Stripe key/i.test(st.label), st);
}

console.log('\n── F. both save paths enforce it, not just Settings ──');
{
  const adm = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
  const srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  ok('F1 the admin Settings save refuses before it writes', /validateStripeKeys/.test(adm));
  ok('F2 the setup wizard refuses before it completes - an owner cannot finish setup with a config that cannot charge anyone',
     /validateStripeKeys/.test(srv) && srv.indexOf('validateStripeKeys') > srv.indexOf("app.post('/api/setup/complete'"), 'the wizard does not validate');
  ok('F3 one validator, not two ideas of what a Stripe key looks like',
     (adm.match(/validateStripeKeys/g) || []).length >= 1 && (srv.match(/validateStripeKeys/g) || []).length >= 1
     && !/startsWith\('pk_/.test(adm) && !/startsWith\('sk_/.test(adm));
}

console.log('\n── G. what Stripe actually said (rule 26) ──');
// The same customer's key was IP-restricted in Stripe. Every call failed, Stripe
// SAID SO in the error body, and the product threw it away and went on showing a
// bare NO STRIPE while the customer got "Please try again" on a fault retrying
// could never fix. He spent an hour guessing at something we had been told.
{
  const SS = require('./services/stripestatus');
  const mk = (type, message, status) => Object.assign(new Error(message), { stripe: { type, code: '', message, status } });

  SS.clearStripeFailure();
  const ipErr = mk('invalid_request_error', 'Requests from this IP address are not allowed for this key.', 403);
  SS.noteStripeFailure(ipErr);
  const st = stripeStatus(S('sk_live_51abcDEF', 'pk_live_51abcDEF'));
  ok('G1 a key Stripe REFUSES is not reported as connected, however well-formed it is', st.ready === false, st);
  ok('G2 the badge names the actual cause - an IP restriction, not a bare NO STRIPE', /BLOCKED THIS UNIT/.test(st.badge), st.badge);
  ok('G3 the action tells the owner exactly where to change it, and that retrying will not help',
     /allowed IPs/i.test(st.detail) && /Retrying will not help/i.test(st.detail), st.detail);
  ok('G4 Stripe\'s own sentence is carried through, not paraphrased away', /not allowed for this key/i.test(st.label), st.label);

  SS.clearStripeFailure();
  ok('G5 a successful call clears the complaint - an owner who fixes it sees it clear',
     stripeStatus(S('sk_live_51abcDEF', 'pk_live_51abcDEF')).ready === true);

  for (const [name, e, want] of [
    ['an expired key',    mk('invalid_request_error', 'Expired API Key provided: sk_live_***', 401), /EXPIRED/],
    ['a restricted key',  mk('invalid_request_error', 'This key does not have the required permissions.', 403), /RESTRICTED/],
    ['the wrong mode',    mk('invalid_request_error', 'a similar object exists in test mode, but a live mode key was used', 400), /WRONG MODE/],
    ['a refused key',     mk('authentication_error', 'Invalid API Key provided: sk_live_***', 401), /REFUSED/],
  ]) {
    SS.clearStripeFailure(); SS.noteStripeFailure(e);
    const r = stripeStatus(S('sk_live_51abcDEF', 'pk_live_51abcDEF'));
    ok(`G6 ${name} is named on the badge (${want})`, want.test(r.badge), { badge: r.badge, hint: r.detail.slice(0, 80) });
  }
  SS.clearStripeFailure();
  SS.noteStripeFailure(mk('api_error', 'Stripe had an internal problem', 500));
  ok('G7 a one-off Stripe outage is NOT recorded as a configuration fault - only auth-class problems stick',
     stripeStatus(S('sk_live_51abcDEF', 'pk_live_51abcDEF')).ready === true, SS.lastStripeFailure());
  SS.clearStripeFailure();
}

console.log('\n── H. a customer is never told to retry a permanent failure ──');
{
  const SS = require('./services/stripestatus');
  const perm = Object.assign(new Error('Requests from this IP address are not allowed'), { stripe: { status: 403, type: 'invalid_request_error' } });
  const blip = Object.assign(new Error('network down'), {});
  const p1 = SS.customerPaymentError(perm), p2 = SS.customerPaymentError(blip);
  ok('H1 a permanent failure tells the customer the facility cannot take payments, and to contact them',
     p1.status === 503 && /cannot take card payments/i.test(p1.body.error) && /contact them/i.test(p1.body.error) && !/try again/i.test(p1.body.error), p1.body);
  ok('H2 ...and says nothing has been charged, so nobody wonders', /nothing has been charged/i.test(p1.body.error));
  ok('H3 a genuine blip still says try again - the honest answer there', p2.status === 502 && /try again/i.test(p2.body.error), p2.body);
  ok('H4 the SDK shape is recognised too (the booking and gift paths use node-stripe, not our own client)',
     SS.isPermanent({ raw: { type: 'StripeAuthenticationError', statusCode: 401 } }) === true);

  const bk = fs.readFileSync(path.join(root, 'routes', 'bookings.js'), 'utf8');
  const gf = fs.readFileSync(path.join(root, 'routes', 'gifts.js'), 'utf8');
  const mb = fs.readFileSync(path.join(root, 'routes', 'memberships.js'), 'utf8');
  ok('H5 all three customer payment paths go through the one helper, so they cannot drift apart',
     /customerPaymentError/.test(bk) && /customerPaymentError/.test(gf) && /permanent/.test(mb));
  ok('H6 no customer payment path still says "try again" unconditionally on a Stripe failure',
     !/Payment system is temporarily unavailable\. Please try again in a moment\.' \}\);/.test(bk));
}

console.log('\n── I. the owner sees it on the health line, and a save re-tests ──');
{
  const uh = fs.readFileSync(path.join(root, 'services', 'unithealth.js'), 'utf8');
  ok('I1 there is a Taking payments signal - there was none at all before', /sig\('stripe', 'Taking payments'/.test(uh));
  ok('I2 ...and it reads the ONE truth, so it cannot disagree with the badge', /stripestatus/.test(uh));
  const adm = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
  ok('I3 saving Settings re-tests the keys, so an owner fixing one sees it change without a restart',
     /clearStripeFailure/.test(adm) && /stripeCall\('GET', '\/balance'\)/.test(adm), 'the save does not re-test');
}

console.log(`\nSTRIPE STATUS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
