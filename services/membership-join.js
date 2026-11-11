// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// services/membership-join.js - THE ONE PLACE A PAID SIGNUP BECOMES A MEMBER
// (maintainer, Sep 20 2026).
//
// Until now the member row was created in exactly one place: the browser coming
// back from Stripe's hosted Checkout to /api/memberships/success. The webhook
// did nothing for checkout.session.completed and the nightly reconcile walked
// members that already existed - so a subscriber whose tab closed, whose phone
// slept, or who hit Back on the redirect had paid, was being billed monthly,
// and the unit had never heard of them. At a members-only club they could not
// book at all, and nothing anywhere would ever notice.
//
// So the success route's body lives here, and TWO callers use it: the success
// redirect (the normal day) and lifecycle.reconcileOrphanJoins (boot and
// nightly, looking INTO Stripe for sessions with no member behind them). One
// member-creating path, idempotent on the subscription id, so a customer who
// comes back AND gets reconciled is still one member.
'use strict';
const crypto = require('crypto');
const dbModule = require('./db');
const db = () => dbModule.db;

function genPin() { return require('./memberpin').generate(); }   // one generator for every member PIN (Sep 25 2026)

// UniFi Member Access Network: push new paid members to the console the
// moment they join (best-effort - never blocks the signup response).
function unifiMemberHookMS(memberId) { try { require('./memberaccess').touch(memberId); } catch {} }   // services/memberaccess (Sep 25 2026)

/**
 * Turn a PAID Checkout session (the shape billing.retrieveSession returns)
 * into a member. Idempotent on the subscription id.
 *
 * @param {object} result  billing.retrieveSession(...) with paid === true
 * @param {object} [opts]  source: 'success' | 'reconcile' (for the owner's log)
 * @returns {{ ok:boolean, created:boolean, existing:boolean, id?:string, pin?:string,
 *             familyPins?:string[], tier?:object, error?:string }}
 */
async function createMemberFromSession(result, opts = {}) {
  const source = opts.source || 'success';
  if (!result || !result.paid) return { ok: false, created: false, existing: false, error: 'not paid' };

  // Idempotency: if this subscription already created a member, don't duplicate.
  const existing = db().prepare(`SELECT id, pin FROM members WHERE stripe_subscription_id=?`).get(result.subscriptionId || '');
  if (existing) return { ok: true, created: false, existing: true, id: existing.id, pin: existing.pin };

  const tier = db().prepare(`SELECT * FROM membership_tiers WHERE id=?`).get(result.tierId);
  if (!tier) return { ok: false, created: false, existing: false, error: 'tier ' + (result.tierId || '(none)') + ' not found' };

  const applicant = result.applicant || {};
  const id = crypto.randomUUID();
  const pin0 = genPin();
  db().prepare(`INSERT INTO members (id, tier_id, name, phone, email, pin, status,
      stripe_customer_id, stripe_subscription_id, billing_cadence, sub_status, current_period_end, notes)
    VALUES (?,?,?,?,?,?,'active',?,?,?,?,?,?)`)
    .run(id, tier.id, applicant.name || 'New Member', applicant.phone || '',
      applicant.email || '', pin0,
      result.customerId || '', result.subscriptionId || '', result.cadence || 'monthly',
      'active', result.periodEnd || '', source === 'reconcile' ? 'Joined online (recovered by the unit - the browser never came back)' : 'Joined online');
  db().prepare(`UPDATE members SET last_activated_at=datetime('now') WHERE id=?`).run(id);
  // the PIN is checked free on the door console BEFORE the success page and the welcome email
  // show it (maintainer, Sep 25 2026); a console that does not answer in ten seconds does not hold the
  // join up - a refusal later is re-picked and texted (ruling 1)
  let pin = pin0;
  try { const sy = await require('./memberaccess').syncNow(id); if (sy && sy.pin) pin = sy.pin; } catch {}

  // Membership waiver signed at checkout: record it against the member row
  // that now exists. Never blocks the join - the money already moved; a
  // recording failure is logged and the owner attests or the next booking
  // self-corrects. On the reconcile path this is the ONLY copy of what was
  // agreed (it rode in Stripe session metadata), so recovering it here is
  // rule 15's record, not a nicety.
  let waiverRecorded = false;
  try {
    const wp = applicant.waiver;
    if (wp && wp.doc_id) {
      const mwSvc = require('./memberwaiver');
      const doc = db().prepare(`SELECT * FROM waivers WHERE id=?`).get(wp.doc_id) || mwSvc.docForTier(tier);
      const memberRow = db().prepare(`SELECT * FROM members WHERE id=?`).get(id);
      if (doc && memberRow) {
        mwSvc.recordMembershipWaiver(memberRow, doc, {
          method: 'digital', signatureName: wp.signature,
          guardianFor: wp.guardian_for || null, ipAddress: wp.ip || '',
          userAgent: wp.ua || '', email: memberRow.email || '',
          context: source === 'reconcile' ? 'online membership signup (recovered)' : 'online membership signup'
        });
        waiverRecorded = true;
      }
    }
  } catch (e) { console.error('membership waiver record at join:', e.message); }

  // Multi-code tiers: the purchase generates the additional codes NOW - the
  // tier's promise fulfills itself. Primary named at join; additional codes
  // named later in admin. All linked to the primary; the whole group lives and
  // dies with this one subscription.
  const extraCodes = Math.max(0, (tier.codes_included || 1) - 1);
  const familyPins = [];
  for (let k = 1; k <= extraCodes; k++) {
    const cid = crypto.randomUUID();
    const cpin = genPin();
    db().prepare(`INSERT INTO members (id, tier_id, name, phone, email, pin, status,
        stripe_customer_id, stripe_subscription_id, billing_cadence, sub_status, current_period_end, notes, parent_member_id)
      VALUES (?,?,?,?,?,?,'active','','', ?, 'active', ?, ?, ?)`)
      .run(cid, tier.id, `${applicant.name || 'Member'} — Code ${k + 1}`, '', '', cpin,
        result.cadence || 'monthly', result.periodEnd || '', 'Additional membership code', id);
    // each code is its own console user, checked like the primary (this called the hook with the
    // PRIMARY's id, so the additional codes never reached the console at all)
    let finalPin = cpin;
    try { const sy = await require('./memberaccess').syncNow(cid, 5000); if (sy && sy.pin) finalPin = sy.pin; } catch {}
    familyPins.push(finalPin);
  }
  try { require('./webhooks').dispatch('member.joined', { member_id: id, tier: tier.name, cadence: result.cadence, name: applicant.name, email: applicant.email }); } catch {}
  dbModule.adminLog(source === 'reconcile' ? 'MEMBERSHIP_JOIN_RECOVERED' : 'MEMBER_JOINED_ONLINE',
    `${applicant.name} — ${tier.name} (${result.cadence})${extraCodes ? ` + ${extraCodes} additional code(s)` : ''}`
    + (source === 'reconcile' ? ' — paid in Stripe but the browser never came back; the unit created the member itself' : ''));

  try {
    const email = require('./email');
    if (email.sendMembershipWelcome) {
      await email.sendMembershipWelcome({
        to: applicant.email, name: applicant.name, tierName: tier.name,
        pin, cadence: result.cadence,
        price: result.cadence === 'annual' ? tier.price_annual : tier.price_monthly
      });
    }
  } catch (e) { console.error('welcome email:', e.message); }

  // The first payment, as money taken (Sep 23 2026 - services/revenue.js). Not
  // awaited: the member is created whatever Stripe answers, and the webhook and
  // the nightly reconcile record the same invoice if this call does not.
  setImmediate(() => { try { require('./membership-lifecycle').recordLatestInvoice(result.subscriptionId, id, 'join').catch(() => {}); } catch {} });
  return { ok: true, created: true, existing: false, id, pin, familyPins, tier, waiverRecorded };
}

module.exports = { createMemberFromSession, genPin, unifiMemberHookMS };
