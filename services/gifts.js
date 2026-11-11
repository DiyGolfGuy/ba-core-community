// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/gifts.js — gift cards as stored-value discount codes.
const { v4: uuidv4 } = require('uuid');
const dbModule = require('./db');
const db = () => dbModule.db;

// No ambiguous characters (0/O, 1/I/L) — codes get read aloud over counters.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genGiftCode() {
  const seg = () => Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  let code, tries = 0;
  do { code = `GIFT-${seg()}-${seg()}`; tries++; }
  while (tries < 50 && db().prepare(`SELECT 1 FROM discount_codes WHERE code=?`).get(code));
  return code;
}

/** Create a gift card. amountCents > 0; paid=false marks a comp/prize. */
function createGiftCard({ amountCents, toEmail = '', fromName = '', message = '', paid = true, issuedBy = '' }) {
  const code = genGiftCode();
  const id = uuidv4();
  const desc = JSON.stringify({ gift: true, toEmail, fromName, message, paid, issuedBy });
  db().prepare(`INSERT INTO discount_codes (id, code, description, type, value, max_uses, uses_count, per_phone_limit, expires_at, active)
    VALUES (?,?,?,?,?,NULL,0,NULL,NULL,1)`)
    .run(id, code, desc, 'gift', amountCents / 100);
  // THE LOG NAMES THE CARD, IT DOES NOT CARRY IT (maintainer, Sep 21 2026). A gift code
  // is a bearer value - whoever reads it can spend it - and admin_log is kept at
  // least twelve months and rides inside every backup that leaves the unit. The
  // owner reads codes from their gift-card list, which is the place that is
  // supposed to hold them; the log only needs to say which card this was, so the
  // last four characters identify it without being spendable.
  const codeTail = '\u2026' + String(code).slice(-4);
  dbModule.adminLog('GIFTCARD_CREATED', `${codeTail} | $${(amountCents / 100).toFixed(2)}${paid ? '' : ' | COMP'}${toEmail ? ' | to ' + toEmail : ''}`);
  return { id, code, amountCents };
}

function giftBalanceCents(codeId, valueDollars) {
  const used = db().prepare(`SELECT COALESCE(SUM(discount_cents),0) AS c FROM discount_uses WHERE code_id=?`).get(codeId);
  return Math.max(0, Math.round(valueDollars * 100) - (used?.c || 0));
}

/** Refund-restore: a negative use row heals the balance, ledger-pure. */
function restoreGiftUse(bookingId) {
  const uses = db().prepare(`SELECT u.*, c.type FROM discount_uses u
    JOIN discount_codes c ON c.id = u.code_id
    WHERE u.booking_id = ? AND c.type = 'gift' AND u.discount_cents > 0`).all(bookingId);
  for (const u of uses) {
    const already = db().prepare(`SELECT 1 FROM discount_uses WHERE booking_id=? AND code_id=? AND discount_cents < 0`).get(bookingId, u.code_id);
    if (already) continue;
    db().prepare(`INSERT INTO discount_uses (id, code_id, booking_id, phone, discount_cents) VALUES (?,?,?,?,?)`)
      .run(uuidv4(), u.code_id, bookingId, u.phone || '', -u.discount_cents);
    dbModule.adminLog('GIFTCARD_RESTORED', `$${(u.discount_cents / 100).toFixed(2)} back to card for cancelled booking`);
  }
  return uses.length;
}

function listGiftCards() {
  const rows = db().prepare(`SELECT * FROM discount_codes WHERE type='gift' ORDER BY rowid DESC LIMIT 200`).all();
  return rows.map(r => {
    let meta = {}; try { meta = JSON.parse(r.description || '{}'); } catch {}
    return { id: r.id, code: r.code, active: !!r.active,
      initial_cents: Math.round(r.value * 100),
      balance_cents: giftBalanceCents(r.id, r.value),
      to_email: meta.toEmail || '', from_name: meta.fromName || '',
      paid: meta.paid !== false, issued_by: meta.issuedBy || '' };
  });
}

function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** The gift card's email to its recipient (moved here from routes/gifts.js, Oct 3 2026, so every path that issues a
 *  card - the page's confirm, the webhook, the reconcile - sends the same one).
 *  THE REVIEW (Oct 3 2026): it went out as HTML source in a plain-text email, and its answer was never read - and on the
 *  webhook and the ten-minute check the email is the ONLY way the code reaches anyone. Sent as HTML now; a failure names
 *  the card (the code is in the owner's Gift Cards list), and a unit with no email says so unless the buyer saw the code
 *  on screen (opts.shown: the page's confirm, the owner's own Issue). Returns the email's answer. */
async function sendGiftEmail(card, { to_email, from_name, message }, opts = {}) {
  try {
    const email = require('./email');
    const cfg = require('./config').getConfig();
    const biz = cfg.server?.businessName || 'our facility';
    const last4 = String(card.code || '').slice(-4), amt = '$' + (card.amountCents / 100).toFixed(2);
    if (!to_email) return undefined;
    {
      const r = await email.sendHtmlEmail(String(to_email).trim(),
        `${from_name ? from_name + ' sent you' : 'You received'} a $${(card.amountCents / 100).toFixed(2)} gift card to ${biz}!`,
        `<div style="font-family:sans-serif;max-width:480px">`
        + (from_name ? `<p><b>${escapeHtml(from_name)}</b> sent you a gift card to <b>${escapeHtml(biz)}</b>!</p>` : `<p>You received a gift card to <b>${escapeHtml(biz)}</b>!</p>`)
        + (message ? `<p style="font-style:italic">"${escapeHtml(message)}"</p>` : '')
        + `<div style="font-family:monospace;font-size:24px;letter-spacing:3px;background:#14301d;color:#c9a227;padding:14px 18px;border-radius:8px;text-align:center;margin:14px 0">${card.code}</div>`
        + `<p>Worth <b>$${(card.amountCents / 100).toFixed(2)}</b>. Enter the code at checkout when booking. Balance carries over until used. Never expires.</p></div>`);
      if (r === false) { try { dbModule.adminLog('GIFTCARD_EMAIL_FAILED', `card ending ${last4} | ${amt} | the email to ${String(to_email).trim()} did not go - the code is in Gift Cards; give it to the buyer`); } catch {} }
      else if (r === undefined && !opts.shown) { try { dbModule.adminLog('GIFTCARD_NOT_EMAILED', `card ending ${last4} | ${amt} | this unit sends no email, and the buyer did not see the code on screen - give it to them from Gift Cards`); } catch {} }
      return r;
    }
  } catch (e) { console.error('gift email:', e.message); try { dbModule.adminLog('GIFTCARD_EMAIL_FAILED', `card ending ${String(card.code || '').slice(-4)} | ${e.message}`); } catch {} return false; }
}
/** Whether this unit can email a gift card (a Resend key and a From address, or the dry run). */
function canEmail() { const r = (require('./config').getConfig().resend) || {}; return process.env.EMAIL_DRYRUN === '1' || (/^re_/.test(String(r.apiKey || '')) && !!r.fromEmail); }

/**
 * A PAID GIFT CARD IS ISSUED, ONCE, WHICHEVER WAY THE PAYMENT IS SEEN (Oct 3 2026, the inventory's critic; the Sep 13
 * stand-in and catch audit's MEDIUM). The card was issued only by the page's confirm, and only for a payment already
 * 'succeeded' - so a gift paid by Klarna, Cash App, a bank payment, or by a buyer whose browser never came back was
 * charged and never issued, and the page promised a refund nothing made. Now the confirm, the Stripe webhook and a
 * reconcile that asks Stripe every ten minutes all call this. Once per payment: the card carries the payment's id, and
 * the check and the insert run with no await between them. Only a gift payment this unit made (rule 25).
 * Returns { code, already } or null when the payment is not a paid gift of ours.
 */
function issueForPaidIntent(pi, source) {
  if (!pi || pi.status !== 'succeeded' || !pi.metadata || pi.metadata.kind !== 'gift_card' || !pi.id) return null;
  const mark = require('./stripemark');
  // what Stripe lists or sends on its own is acted on only when this unit made it (rule 25); the page's confirm may
  // carry a payment made before the marker existed, so an UNMARKED one is accepted there only
  if (source === 'confirm' ? (pi.metadata.ba_owner && !mark.isThisUnits(pi)) : !mark.isThisUnits(pi)) return null;
  const dup = db().prepare(`SELECT code FROM discount_codes WHERE description LIKE ?`).get(`%${pi.id}%`);
  const issued = () => { try { db().prepare(`UPDATE gift_checkouts SET status='issued' WHERE pi_id=?`).run(pi.id); } catch {} };
  if (dup) { issued(); return { code: dup.code, already: true }; }
  const md = pi.metadata;
  // the card first, then the checkout marked (the review): marked first, a card that failed to save was never asked about again
  const card = createGiftCard({ amountCents: pi.amount, toEmail: md.to_email || '', fromName: md.from_name || '', message: md.message || '', paid: true, issuedBy: pi.id });
  issued();
  try { dbModule.adminLog('GIFTCARD_PAID', `${pi.id} | $${(pi.amount / 100).toFixed(2)} | issued by ${source || 'confirm'}`); } catch {}
  // shown on screen only on the page's own confirm; the webhook and the check have nobody there
  sendGiftEmail(card, { to_email: md.to_email, from_name: md.from_name, message: md.message }, { shown: source === 'confirm' }).catch(() => {});
  try { require('./printing').enqueueToRole('counter', `GIFT CARD SOLD\n$${(pi.amount / 100).toFixed(2)}  ${card.code}\nTo: ${md.to_email || ''}\n`); } catch {}
  try { require('./webhooks').dispatch('giftcard.purchased', { amount_cents: pi.amount, code_last4: card.code.slice(-4) }); } catch {}
  return { code: card.code, already: false };
}

/** Asks Stripe about each gift checkout this unit started in the last seven days that has no card yet (a bank payment
 *  can take days) and issues those that are paid. Older ones are closed - a checkout nobody paid in a week was
 *  abandoned. Nothing to do without a Stripe key. Returns how many it issued. */
async function reconcilePaidIntents() {
  const cfg = require('./config').getConfig();
  const key = cfg.stripe?.secretKey || '';
  if (!key || key.startsWith('PASTE') || key.startsWith('sk_mock')) return 0;
  try { db().prepare(`UPDATE gift_checkouts SET status='closed' WHERE status='open' AND created_at < datetime('now','-7 days')`).run(); } catch {}
  // THE REVIEW (Oct 3 2026): only checkouts made in THIS key's mode are asked about (one made while the owner practised
  // with Sandbox keys, asked with the live key, came back "similar object exists in test mode" - STRIPE WRONG MODE and
  // Taking payments red for a week); the newest first, so abandoned ones never bury a paid one
  const mode = stripeMode(key);
  const open = (() => { try { return db().prepare(`SELECT pi_id FROM gift_checkouts WHERE status='open' AND (mode='' OR mode=?) ORDER BY created_at DESC LIMIT 200`).all(mode); } catch { return []; } })();
  if (!open.length) return 0;
  const billing = require('./membership-billing');
  const close = id => { try { db().prepare(`UPDATE gift_checkouts SET status='closed' WHERE pi_id=?`).run(id); } catch {} };
  let issued = 0, failed = 0, firstErr = '';
  for (const { pi_id } of open) {
    try {
      const pi = await billing.stripeCall('GET', '/payment_intents/' + encodeURIComponent(pi_id), undefined, { missingIsAnswer: true });
      if (pi && pi.status === 'canceled') { close(pi_id); continue; }
      // still waiting for a way to pay a day later: the buyer left (a Klarna or bank payment that went through is
      // processing or succeeded by then, never back to waiting)
      if (pi && pi.status === 'requires_payment_method' && pi.created && pi.created * 1000 < Date.now() - 24 * 3600 * 1000) { close(pi_id); continue; }
      const out = issueForPaidIntent(pi, 'reconcile');
      if (out && !out.already) issued++;
    } catch (e) {
      // Stripe has no such payment for this key (another account since): nothing to issue, nothing wrong with the key
      if (e && e.stripe && e.stripe.status === 404 && e.stripe.code === 'resource_missing') { close(pi_id); continue; }
      failed++; if (!firstErr) firstErr = String(e.message).slice(0, 160);
    }
  }
  // one line per run, not one per checkout every ten minutes; the next run asks again
  if (failed) { try { dbModule.adminLog('GIFTCARD_CHECK_FAILED', `${failed} gift checkout(s) could not be checked with Stripe - asked again in ten minutes: ${firstErr}`); } catch {} }
  return issued;
}

/** Which of Stripe's modes a secret key belongs to: 'live' or 'test'. */
function stripeMode(key) { return /^(sk|rk)_live_/.test(String(key || '')) ? 'live' : 'test'; }

module.exports = { genGiftCode, createGiftCard, giftBalanceCents, restoreGiftUse, listGiftCards, sendGiftEmail, issueForPaidIntent, reconcilePaidIntents, stripeMode, canEmail };
