// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/membership-lifecycle.js — keeps subscription members in sync.
// Three inputs of truth, in priority order:
//   1. Stripe webhooks (real-time renewal/failure/cancel events)
//   2. Nightly reconcile (pulls subscription truth from Stripe; heals missed
//      webhooks — an unmanned Pi can be offline when a renewal fires)
//   3. Grace enforcement (OUR per-tier grace_days policy: Stripe retries the
//      card on its schedule; WE decide how long benefits continue past-due,
//      and we cancel the subscription when the tier's grace runs out)
// Also: annual renewal reminder emails (state auto-renewal law requirement).
const dbModule = require('./db');
const billing = require('./membership-billing');
const { getConfig } = require('./config');

const db = () => dbModule.db;
const today = () => require('./revenue').facilityToday();   // the facility's date, not UTC's

function memberBySub(subId) {
  return db().prepare(`SELECT m.*, t.grace_days, t.name AS tier_name FROM members m
    JOIN membership_tiers t ON t.id = m.tier_id WHERE m.stripe_subscription_id = ?`).get(subId);
}

// ── Webhook event application (idempotent by design) ─────────────────────────
async function applyEvent(event) {
  const type = event.type;
  const obj = event.data?.object || {};

  // ── CARD READER (Terminal): the webhook is the ONLY thing that turns a
  // reader charge into money. Handled first and returned so reader traffic
  // never falls through membership branches.
  if (type === 'payment_intent.succeeded' && obj.metadata && obj.metadata.source === 'ba_terminal') {
    try { require('./terminal').finalizePaidIntent(obj); } catch (e) { console.error('terminal finalize:', e.message); }
    return;
  }
  // a GIFT CARD whose payment finished after the buyer left the page (Oct 3 2026): issued now, once
  if (type === 'payment_intent.succeeded' && obj.metadata && obj.metadata.kind === 'gift_card') {
    try { require('./gifts').issueForPaidIntent(obj, 'webhook'); } catch (e) { console.error('gift issue:', e.message); }
    return;
  }
  if ((type === 'payment_intent.payment_failed' || type === 'payment_intent.canceled')
      && obj.metadata && obj.metadata.source === 'ba_terminal') {
    try { require('./terminal').failIntent(obj, obj.last_payment_error?.message || type); } catch {}
    return;
  }
  if (type === 'terminal.reader.action_failed') {
    try {
      const pi = obj.action && obj.action.process_payment_intent && obj.action.process_payment_intent.payment_intent;
      if (pi) require('./terminal').failIntent({ id: pi }, obj.action.failure_message || 'reader action failed');
    } catch {}
    return;
  }

  if (type === 'invoice.paid') {
    const subId = obj.subscription || obj.parent?.subscription_details?.subscription;
    if (!subId) return;
    const m = memberBySub(subId);
    if (!m) return;
    // the money, not only the date (Sep 23 2026 - services/revenue.js reads it)
    try { dbModule.recordMembershipPayment(obj, m.id, 'webhook'); } catch {}
    const periodEnd = obj.lines?.data?.[0]?.period?.end
      ? new Date(obj.lines.data[0].period.end * 1000).toISOString() : m.current_period_end;
    db().prepare(`UPDATE members SET status='active', sub_status='active',
      past_due_since='', current_period_end=?, annual_reminder_sent='' WHERE id=?`)
      .run(periodEnd || '', m.id);
    // Multi-code: the whole group reactivates with the paying primary.
    try { db().prepare(`UPDATE members SET status='active', sub_status='active' WHERE parent_member_id=?`).run(m.id); } catch {} try { const ma = require('./memberaccess'); ma.touch(m.id); ma.touchFamily(m.id); } catch {}   // the door console follows (Sep 25 2026)
    dbModule.adminLog('MEMBERSHIP_RENEWED', `${m.name} — ${m.tier_name}`);
  } else if (type === 'refund.failed') {
    // US card refunds normally succeed synchronously; a later FAILURE (e.g.
    // insufficient balance) must never pass silently - the owner sees it.
    try { dbModule.adminLog('STRIPE_REFUND_FAILED', 'Refund ' + (obj.id || '?') + ' for ' + ((obj.amount | 0) / 100).toFixed(2) + ' failed: ' + (obj.failure_reason || 'unknown')); } catch {}
    // ...and it stops coming off revenue (services/refunds.js)
    try { await require('./refunds').recordStripeRefund(obj, 'webhook'); } catch (e) { console.error('refund pickup:', e.message); }
  } else if (type === 'refund.created' || type === 'refund.updated') {
    // A refund made anywhere - by this unit or in Stripe's dashboard - is recorded
    // once against what it came off (Sep 24 2026). The nightly check asks Stripe too,
    // so nothing depends on this arriving.
    try { await require('./refunds').recordStripeRefund(obj, 'webhook'); } catch (e) { console.error('refund pickup:', e.message); }
  } else if (type === 'charge.refunded') {
    try { await require('./refunds').recordChargeRefunds(obj, 'webhook'); } catch (e) { console.error('refund pickup:', e.message); }
  } else if (type === 'invoice.payment_failed') {
    const subId = obj.subscription || obj.parent?.subscription_details?.subscription;
    if (!subId) return;
    const m = memberBySub(subId);
    if (!m) return;
    db().prepare(`UPDATE members SET sub_status='past_due',
      past_due_since = CASE WHEN past_due_since='' OR past_due_since IS NULL THEN ? ELSE past_due_since END
      WHERE id=?`).run(today(), m.id);
    dbModule.adminLog('MEMBERSHIP_PAYMENT_FAILED', `${m.name} — ${m.tier_name} (grace ${m.grace_days}d)`);
    try {
      const email = require('./email');
      if (email.sendMembershipPaymentFailed && m.email) {
        await email.sendMembershipPaymentFailed({ to: m.email, name: m.name, tierName: m.tier_name, graceDays: m.grace_days });
      }
    } catch {}
  } else if (type === 'customer.subscription.deleted') {
    const m = memberBySub(obj.id);
    if (!m) return;
    db().prepare(`UPDATE members SET status='inactive', sub_status='canceled' WHERE id=?`).run(m.id);
    // Multi-code: the whole family/business group lives and dies together.
    try { db().prepare(`UPDATE members SET status='inactive', sub_status='canceled' WHERE parent_member_id=?`).run(m.id); } catch {} try { const ma = require('./memberaccess'); ma.touch(m.id); ma.touchFamily(m.id); } catch {}   // the door console follows (Sep 25 2026)
    dbModule.adminLog('MEMBERSHIP_CANCELED', `${m.name} — ${m.tier_name}`);
  } else if (type === 'customer.subscription.updated') {
    const m = memberBySub(obj.id);
    if (!m) return;
    const periodEnd = require('./membership-billing').subPeriodEndISO(obj) || m.current_period_end;
    db().prepare(`UPDATE members SET cancel_at_period_end=?, current_period_end=? WHERE id=?`)
      .run(obj.cancel_at_period_end ? 1 : 0, periodEnd || '', m.id);
  }
  // checkout.session.completed: member creation is handled by the success
  // redirect (idempotent on subscription id); nothing extra needed here.
}

// ── Nightly maintenance ──────────────────────────────────────────────────────
// ── THE PAID SIGNUP THE BROWSER NEVER BROUGHT BACK (maintainer, Sep 20 2026) ────────
// Money taken with nothing behind it. The success redirect was the ONLY place a
// member was created; the webhook did nothing for checkout.session.completed and
// the nightly walk started from members that already existed. This looks the
// other way - INTO Stripe, at our own sessions (rule 25: the marker, never a
// name) - and finishes any join whose session is complete and paid but has no
// member row. Same function the success route calls, idempotent on the
// subscription id. Runs at boot and nightly inside runMaintenance, and on the
// owner's Check now.
// Rule 31: Stripe unreachable is "could not check", never a failure.
let _lastOrphanReconcile = null;   // { at, checked, recovered, pending, failed:[{name,email,sessionId,error}], error }
function lastOrphanReconcile() { return _lastOrphanReconcile; }

async function reconcileOrphanJoins() {
  const out = { at: new Date().toISOString(), checked: 0, recovered: 0, pending: 0, failed: [], error: null, skipped: false };
  // Rule 31: no Stripe key means no online joins can exist - nothing to look for,
  // and nothing to be wrong. Never a call to Stripe with an empty key.
  if (!billing.isMock() && !(getConfig().stripe && getConfig().stripe.secretKey)) {
    out.skipped = true; _lastOrphanReconcile = out; return out;
  }
  // NOTHING SELLS ONLINE = NOTHING TO RECOVER (maintainer, Sep 20 2026). No sell_online
  // tier means no Checkout session could ever have been created, so there is no
  // orphan to look for - and this skips a real Stripe round-trip at every boot
  // on a facility that does not sell memberships online (most of them, and every
  // battery that boots with a key). The nightly and the owner's Check now still
  // run it the moment a tier is sold online.
  try {
    const sells = db().prepare(`SELECT COUNT(*) AS n FROM membership_tiers WHERE sell_online=1 AND active=1`).get();
    if (!sells || !sells.n) { out.skipped = true; _lastOrphanReconcile = out; return out; }
  } catch (e) {}
  let sessions;
  try { sessions = await billing.listRecentSessions(30); }
  catch (e) { out.error = 'could not list sessions: ' + e.message; _lastOrphanReconcile = out; return out; }
  const join = require('./membership-join');
  for (const sess of sessions) {
    if (sess.status !== 'complete' || !sess.subscription) continue;
    out.checked++;
    const have = db().prepare(`SELECT id FROM members WHERE stripe_subscription_id=?`).get(sess.subscription);
    if (have) continue;
    let result;
    try { result = await billing.retrieveSession(sess.id); }
    catch (e) { out.failed.push({ sessionId: sess.id, name: sess.metadata?.name || '', error: 'retrieve: ' + e.message }); continue; }
    if (!result || !result.paid) { out.pending++; continue; }     // complete but still settling - next pass
    try {
      const r = await join.createMemberFromSession(result, { source: 'reconcile' });
      if (r.ok && r.created) out.recovered++;
      else if (!r.ok) out.failed.push({ sessionId: sess.id, name: result.applicant?.name || '', email: result.applicant?.email || '', error: r.error || 'unknown' });
    } catch (e) {
      out.failed.push({ sessionId: sess.id, name: result.applicant?.name || '', email: result.applicant?.email || '', error: e.message });
    }
  }
  if (out.failed.length) {
    dbModule.adminLog('MEMBERSHIP_JOIN_ORPHANED',
      `${out.failed.length} paid signup(s) have no member record and the unit could not create one: `
      + out.failed.map(f => `${f.name || f.email || f.sessionId} (${f.error})`).join('; ').slice(0, 400));
  }
  _lastOrphanReconcile = out;
  return out;
}

// MEMBERSHIP MONEY, WITH OR WITHOUT A WEBHOOK (maintainer, Sep 23 2026). Revenue is money
// taken (services/revenue.js), and a membership payment lives in Stripe until the
// unit writes it down. The webhook writes it as it happens; this writes it from
// the subscription's latest invoice - at the join, and every night for every
// member - once, when it is paid. Keyed by the invoice id, so the two never
// write it twice, and an invoice already recorded costs no call at all.
async function recordInvoiceOf(sub, memberId, source) {
  const li = sub && sub.latest_invoice;
  const id = li && (typeof li === 'string' ? li : li.id);
  if (!id) return false;
  if (db().prepare(`SELECT invoice_id FROM membership_payments WHERE invoice_id=?`).get(String(id))) return false;
  const inv = (typeof li === 'object' && li.status) ? li : await billing.stripeCall('GET', '/invoices/' + encodeURIComponent(id));
  return dbModule.recordMembershipPayment(inv, memberId, source);
}
async function recordLatestInvoice(subId, memberId, source) {
  if (!subId || billing.isMock()) return false;
  const sub = await billing.getSubscription(subId);
  return sub ? recordInvoiceOf(sub, memberId, source) : false;
}

async function runMaintenance() {
  const cfg = getConfig();
  // FIRST, before anything that walks existing members: anyone who paid and was
  // never given a member row. Runs in mock mode too - the battery proves it.
  try { await reconcileOrphanJoins(); } catch (e) { console.error('orphan join reconcile:', e.message); }
  const billingMembers = db().prepare(`SELECT m.*, t.grace_days, t.name AS tier_name
    FROM members m JOIN membership_tiers t ON t.id = m.tier_id
    WHERE m.stripe_subscription_id != '' AND m.status = 'active'`).all();

  for (const m of billingMembers) {
    // 1. Reconcile from Stripe (real mode only): heal missed webhooks.
    if (!billing.isMock()) {
      try {
        const sub = await billing.getSubscription(m.stripe_subscription_id);
        if (sub) {
          try { await recordInvoiceOf(sub, m.id, 'reconcile'); } catch (e) {}
          const periodEnd = billing.subPeriodEndISO(sub) || m.current_period_end;
          if (sub.status === 'canceled') {
            db().prepare(`UPDATE members SET status='inactive', sub_status='canceled' WHERE id=?`).run(m.id);
    // Multi-code: the whole family/business group lives and dies together.
    try { db().prepare(`UPDATE members SET status='inactive', sub_status='canceled' WHERE parent_member_id=?`).run(m.id); } catch {} try { const ma = require('./memberaccess'); ma.touch(m.id); ma.touchFamily(m.id); } catch {}   // the door console follows (Sep 25 2026)
            dbModule.adminLog('MEMBERSHIP_CANCELED', `${m.name} — reconcile`);
            continue;
          }
          const subStatus = ['past_due', 'unpaid'].includes(sub.status) ? 'past_due' : 'active';
          db().prepare(`UPDATE members SET sub_status=?, current_period_end=?, cancel_at_period_end=?,
            past_due_since = CASE WHEN ?='past_due' AND (past_due_since='' OR past_due_since IS NULL) THEN ? ELSE
              CASE WHEN ?='active' THEN '' ELSE past_due_since END END
            WHERE id=?`)
            .run(subStatus, periodEnd || '', sub.cancel_at_period_end ? 1 : 0,
                 subStatus, today(), subStatus, m.id);
          // W37b (Sep 8 2026): SAY SO. The webhook path logs
          // MEMBERSHIP_PAYMENT_FAILED, but reconcile - the path every unit
          // without a public URL actually uses, and the one that heals a missed
          // webhook - moved a member into past_due silently. The owner saw a
          // past-due badge with nothing in the log explaining it. Logged on the
          // TRANSITION only, so a member sitting past due for a week does not
          // fill the log with one entry a night.
          // Sep 12 2026 (maintainer: memberships never depend on a webhook landing): a renewal the
          // reconcile sees - the period moved forward while no webhook arrived - is SAID, like
          // the webhook path says it, so the owner's log reads the same either way.
          if (subStatus === 'active' && periodEnd && m.current_period_end && String(periodEnd) > String(m.current_period_end)) {
            dbModule.adminLog('MEMBERSHIP_RENEWED', `${m.name} — ${m.tier_name} — seen by nightly reconcile (period now ends ${String(periodEnd).slice(0, 10)})`);
          }
          if (subStatus === 'past_due' && m.sub_status !== 'past_due') {
            dbModule.adminLog('MEMBERSHIP_PAYMENT_FAILED',
              `${m.name} — ${m.tier_name} (grace ${m.grace_days}d) — seen by nightly reconcile, Stripe says ${sub.status}`);
          } else if (subStatus === 'active' && m.sub_status === 'past_due') {
            dbModule.adminLog('MEMBERSHIP_RECOVERED',
              `${m.name} — ${m.tier_name} — payment caught up, back to active`);
          }
          m.sub_status = subStatus;
          if (subStatus === 'active') m.past_due_since = '';
        }
      } catch (e) { console.error('reconcile:', m.id, e.message); }
    }

    // 2. Grace enforcement: OUR per-tier policy.
    if (m.sub_status === 'past_due' && m.past_due_since) {
      const daysPast = Math.floor((Date.now() - new Date(m.past_due_since + 'T12:00:00')) / 86400000);
      const grace = (m.grace_days === undefined || m.grace_days === null) ? 14 : m.grace_days;
      if (daysPast > grace) {
        // the billing must really stop first (Oct 3 2026): a refusal was printed to the console and the member ended
        // anyway while Stripe kept charging. Refused: nothing changes, the owner's log says so, tomorrow night tries again.
        if (m.stripe_subscription_id) {
          try { await billing.stopBilling(m.stripe_subscription_id, false); }
          catch (e) {
            dbModule.adminLog('MEMBERSHIP_CANCEL_FAILED', `${m.name} — ${m.tier_name} — past its grace (${daysPast}d), but Stripe did not cancel the subscription: ${String(e.message).slice(0, 160)} - still billed; tried again tomorrow night`);
            continue;
          }
        }
        db().prepare(`UPDATE members SET status='inactive', sub_status='canceled' WHERE id=?`).run(m.id);
    // Multi-code: the whole family/business group lives and dies together.
    try { db().prepare(`UPDATE members SET status='inactive', sub_status='canceled' WHERE parent_member_id=?`).run(m.id); } catch {} try { const ma = require('./memberaccess'); ma.touch(m.id); ma.touchFamily(m.id); } catch {}   // the door console follows (Sep 25 2026)
        dbModule.adminLog('MEMBERSHIP_ENDED_GRACE', `${m.name} — ${m.tier_name} (${daysPast}d past due, grace ${grace}d)`);
        try {
          const email = require('./email');
          if (email.sendMembershipEnded && m.email) {
            await email.sendMembershipEnded({ to: m.email, name: m.name, tierName: m.tier_name });
          }
        } catch {}
        continue;
      }
    }

    // 3b. Monthly billing reminders (maintainer, Aug 20): the facility sets how many
    // days before the card is charged the member hears about it - amount and
    // date, so a $100/month club member is never surprised. 0 = off. Reuses
    // the per-period marker column (one member has one cadence, no clash).
    const monthlyLead = Math.max(0, parseInt(getConfig().membership?.reminderDays ?? 7) || 0);
    if (monthlyLead > 0 && m.billing_cadence !== 'annual' && m.current_period_end && !m.cancel_at_period_end) {
      const daysToRenewal = Math.floor((new Date(m.current_period_end) - Date.now()) / 86400000);
      const periodMarker = String(m.current_period_end).slice(0, 10);
      if (daysToRenewal >= 0 && daysToRenewal <= monthlyLead && m.annual_reminder_sent !== periodMarker) {
        try {
          const email = require('./email');
          const tier = db().prepare(`SELECT price_monthly FROM membership_tiers WHERE id=?`).get(m.tier_id);
          if (email.sendRenewalReminder && m.email) {
            await email.sendRenewalReminder({
              to: m.email, name: m.name, tierName: m.tier_name,
              renewDate: periodMarker, price: tier?.price_monthly || 0
            });
          }
          db().prepare(`UPDATE members SET annual_reminder_sent=? WHERE id=?`).run(periodMarker, m.id);
          dbModule.adminLog('MEMBERSHIP_RENEWAL_REMINDER', `${m.name} — monthly renewal ${periodMarker}`);
        } catch (e) { console.error('monthly reminder:', e.message); }
      }
    }

    // 3. Annual renewal reminders (auto-renewal law: notice before yearly charge).
    if (m.billing_cadence === 'annual' && m.current_period_end && !m.cancel_at_period_end) {
      const daysToRenewal = Math.floor((new Date(m.current_period_end) - Date.now()) / 86400000);
      const periodMarker = String(m.current_period_end).slice(0, 10);
      if (daysToRenewal >= 0 && daysToRenewal <= 30 && m.annual_reminder_sent !== periodMarker) {
        try {
          const email = require('./email');
          const tier = db().prepare(`SELECT price_annual FROM membership_tiers WHERE id=?`).get(m.tier_id);
          if (email.sendRenewalReminder && m.email) {
            await email.sendRenewalReminder({
              to: m.email, name: m.name, tierName: m.tier_name,
              renewDate: periodMarker, price: tier?.price_annual || 0
            });
          }
          db().prepare(`UPDATE members SET annual_reminder_sent=? WHERE id=?`).run(periodMarker, m.id);
          dbModule.adminLog('MEMBERSHIP_RENEWAL_REMINDER', `${m.name} — renews ${periodMarker}`);
        } catch (e) { console.error('reminder:', e.message); }
      }
    }
  }
  try { await runWaiverRenewalPass(); } catch (e) { console.error('waiver renewal pass:', e.message); }
}

// ── Waiver renewal reminders (maintainer, Sep 1 2026) ───────────────────────────────
// Any waiver that lasts a set time is asked for again as the period comes up:
// one email per member per expiry date (waiver_reminder_sent holds the date
// it was sent for, so a fresh signature - new expiry - re-arms it). Runs
// inside runMaintenance (4:15 nightly + boot); `now` is injectable for
// batteries. Members with no email are still listed for the owner (roster,
// dashboard) - nothing is sent, nothing is marked.
async function runWaiverRenewalPass() {
  const mw = require('./memberwaiver');
  const out = { due: 0, sent: 0, skipped: 0 };
  let due = [];
  try { due = mw.renewalsDue(); } catch (e) { console.error('waiver renewals:', e.message); return out; }
  out.due = due.length;
  for (const m of due) {
    if (m.reminder_sent === m.expires_at) { out.skipped++; continue; }
    if (!m.email) { out.skipped++; continue; }
    try {
      const email = require('./email');
      if (email.sendWaiverRenewalReminder) {
        await email.sendWaiverRenewalReminder({ to: m.email, name: m.name, expiresAt: m.expires_at, daysLeft: m.days_left });
      }
      db().prepare(`UPDATE members SET waiver_reminder_sent=? WHERE id=?`).run(m.expires_at, m.id);
      dbModule.adminLog('WAIVER_RENEWAL_REMINDER', `${m.name} — waiver runs out ${m.expires_at} (${m.days_left}d)`);
      out.sent++;
    } catch (e) { console.error('waiver reminder:', m.id, e.message); }
  }
  return out;
}

// ── Boot-time webhook registration (owner never touches Stripe) ──────────────
// A webhook needs a PUBLIC https host: Stripe must be able to reach it. A
// reserved name (.invalid / .test / .example / .localhost / example.com, RFC
// 2606 and 6761), localhost, a bare IP address or a LAN name is never public,
// and registering one leaves an endpoint Stripe retries forever (the bench's
// seeded domain is https://bench.example.invalid on purpose - it registered
// sixteen of them). Returns the base to register, or '' with the reason.
function publicWebhookBase(cfg) {
  const raw = String((cfg && cfg.seo && cfg.seo.domain) || '').trim().replace(/\/+$/, '');
  if (!raw) return { base: '', why: 'no domain' };
  let u; try { u = new URL(raw); } catch { return { base: '', why: 'not a URL' }; }
  if (u.protocol !== 'https:') return { base: '', why: 'not https' };
  if (u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) return { base: '', why: 'not a bare origin' };
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h === 'localhost') return { base: '', why: 'not a public name' };
  if (/\.(invalid|test|example|localhost|local|internal|home\.arpa|lan|home)$/.test(h)) return { base: '', why: 'reserved name' };
  if (/^example\.(com|net|org)$/.test(h) || /\.example\.(com|net|org)$/.test(h)) return { base: '', why: 'reserved name' };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || /^\[?[0-9a-f:]+\]?$/i.test(h) && h.includes(':')) return { base: '', why: 'an IP address' };
  return { base: `https://${h}${u.port ? ':' + u.port : ''}`, why: '' };
}
async function ensureWebhookRegistered() {
  const cfg = getConfig();
  if (!cfg.stripe?.secretKey || billing.isMock()) return { did: 'skip', why: 'no Stripe' };
  // rule 25: what this unit made before the marker existed is adopted by its own references, once
  try { const a = await require('./stripemark').adoptReferenced(billing.stripeCall); if (a.did === 'adopted' && a.marked.length) console.log('Stripe objects adopted (marked as ours): ' + a.marked.join(', ')); } catch (e) { console.error('stripe adoption:', e.message); }
  const pub = publicWebhookBase(cfg);
  if (!pub.base) return { did: 'skip', why: pub.why };
  const url = billing.webhookUrl(pub.base);
  const { saveConfig } = require('./config');
  try {
    // Already registered: make sure the endpoint still exists (an owner can
    // delete it in the Stripe dashboard; then renewals would go silent).
    if (cfg.stripe.webhookSecret && cfg.stripe.webhookId) {
      const live = await billing.getWebhookEndpoint(cfg.stripe.webhookId);
      if (live && live.url === url) {
        // the list of events grew (the card reader's, Sep 11 2026): update the
        // endpoint in place - the secret stays, nothing is re-registered
        const have = new Set(live.enabled_events || []);
        const missing = billing.WEBHOOK_EVENTS.filter(e => !have.has(e));
        if (missing.length) { await billing.updateWebhookEvents(cfg.stripe.webhookId); console.log('Stripe webhook events updated: +' + missing.join(' +')); return { did: 'events-updated', id: cfg.stripe.webhookId, added: missing }; }
        return { did: 'kept', id: cfg.stripe.webhookId };
      }
      console.log('Stripe webhook ' + cfg.stripe.webhookId + ' is gone or points elsewhere - re-registering');
    } else if (cfg.stripe.webhookSecret) return { did: 'kept', why: 'secret without id (pre-Sep 11 unit)' };
    // ONE endpoint per URL: every existing endpoint on our URL is a twin whose
    // secret nobody holds - delete them, then register exactly one.
    const twins = await billing.listWebhookEndpoints(url);
    for (const t of twins) { try { await billing.deleteWebhookEndpoint(t.id); console.log('Stripe webhook twin removed: ' + t.id); } catch (e) { console.error('webhook twin ' + t.id + ':', e.message); } }
    const wh = await billing.registerWebhook(pub.base);
    const full = getConfig();
    full.stripe.webhookSecret = wh.secret;
    full.stripe.webhookId = wh.id;
    saveConfig(full);
    console.log('Stripe webhook registered for membership billing');
    return { did: 'registered', id: wh.id, removed: twins.length };
  } catch (e) { console.error('webhook registration:', e.message); return { did: 'error', why: e.message }; }
}

module.exports = { applyEvent, runMaintenance, reconcileOrphanJoins, lastOrphanReconcile, ensureWebhookRegistered, publicWebhookBase, runWaiverRenewalPass, recordLatestInvoice };
