// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/terminal.js — Stripe Terminal card readers (P5).
//
// ARCHITECTURE (the part people get wrong):
//   Our Pi NEVER talks to the reader. We call Stripe's cloud; Stripe pushes
//   the charge down to the terminal over its own connection; the customer
//   taps; Stripe tells us what happened. No drivers, no Python bridge, no
//   local network handshake with the device. This is "server-driven" mode.
//
// THE LAW (POS-HARDWARE V2, mandatory): THE WEBHOOK IS THE TRUTH.
//   A staff button press means "I asked Stripe to charge" - never "paid".
//   Money is only real when payment_intent.succeeded arrives and
//   finalizePaidIntent() records it. Every other path (polling, the API
//   response to process_payment_intent, an optimistic UI) is a hint.
//   This is why a yanked card, a dead reader, or a closed browser can never
//   leave a tab marked paid when it is not.
//
// TIPS: all modes built, default OFF (maintainer, Aug 11).
//   off    - reader never prompts
//   server - reader prompts; tip attributed to the employee who rang it
//   pooled - reader prompts; tip recorded to the house
//   manual - no reader prompt; staff enters a tip amount themselves
'use strict';

const dbM = require('./db');
const { getConfig, saveConfig } = require('./config');

function stripeKey() { return getConfig().stripe?.secretKey || ''; }
function isMock() { return stripeKey().startsWith('sk_mock') || !stripeKey(); }

// BA_STRIPE_API_BASE points a battery's stand-in Stripe here - honoured ONLY with an sk_test_ key
function apiBase() { return (process.env.BA_STRIPE_API_BASE && /^sk_test_/.test(stripeKey())) ? process.env.BA_STRIPE_API_BASE : 'https://api.stripe.com'; }
async function stripeCall(method, path, params) {
  const flat = params ? flatten(params) : null;
  const body = flat ? new URLSearchParams(flat).toString() : '';
  const res = await fetch(`${apiBase()}/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${stripeKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-03-31.basil'
    },
    body: method === 'GET' ? undefined : body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${res.status}`);
  return data;
}
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? flatten(x, `${key}[${i}]`, out) : (out[`${key}[${i}]`] = x)));
    else out[key] = v;
  }
  return out;
}

function ensureSchema() {
  try {
    const cols = dbM.db.prepare(`PRAGMA table_info(terminal_intents)`).all().map(c => c.name);
    if (cols.length && !cols.includes('check_id')) dbM.db.exec(`ALTER TABLE terminal_intents ADD COLUMN check_id TEXT`);
  } catch (e) {}
  const D = dbM.db;
  // Reader-driven intents we are waiting on. The webhook resolves these;
  // nothing else may mark a tab paid.
  D.exec(`CREATE TABLE IF NOT EXISTS terminal_intents (
    id TEXT PRIMARY KEY,
    payment_intent TEXT UNIQUE NOT NULL,
    tab_id TEXT,
    booking_id TEXT,
    reader_id TEXT,
    amount_cents INTEGER NOT NULL,
    tip_cents INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    employee TEXT DEFAULT '',
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    settled_at TEXT)`);
}

// ── READER REGISTRY (owner-managed, stored in config) ────────────────────
function readers() {
  const r = getConfig().terminal?.readers;
  return Array.isArray(r) ? r : [];
}
function tipsCfg() {
  const t = getConfig().terminal?.tips || {};
  // DEFAULT OFF per maintainer's ruling.
  return { mode: ['off', 'server', 'pooled', 'manual'].includes(t.mode) ? t.mode : 'off',
           presets: Array.isArray(t.presets) && t.presets.length ? t.presets : [15, 18, 20] };
}
function defaultReaderId() {
  const cfg = getConfig().terminal || {};
  if (cfg.defaultReader && readers().some(r => r.id === cfg.defaultReader)) return cfg.defaultReader;
  const first = readers()[0];
  return first ? first.id : null;
}

function saveTerminalCfg(mutate) {
  const cfg = getConfig();
  cfg.terminal = Object.assign({ readers: [], tips: { mode: 'off', presets: [15, 18, 20] }, defaultReader: null }, cfg.terminal);
  mutate(cfg.terminal);
  saveConfig(cfg);
  return cfg.terminal;
}

// Register a physical reader with Stripe using its on-screen pairing code.
// Stripe's simulated readers (docs.stripe.com/terminal/payments/connect-reader,
// server-driven, simulated): "use one of the designated registration codes
// (`simulated-wpe`, `simulated-s700`, or `simulated-s710`) ... in a sandbox only",
// with a location. Accepted on a test key only, so a facility (or the money gate)
// can prove the whole reader path with no hardware - the simulate-tap route below
// existed, but no simulated reader could ever be added to use it with.
const SIMULATED_CODE = /^simulated-(wpe|s700|s710)$/;
// A READER IS REGISTERED TO A LOCATION (Oct 19 2026, found reading the guide against the code). Stripe's own reference has
// `location` REQUIRED when a reader is created (docs.stripe.com/api/terminal/readers/create: "location (string, required)
// The location to assign the reader to"; docs.stripe.com/terminal/fleet/locations-and-zones: "Before you can use a reader,
// you must register it to a location"), and a United States Location needs line1, city, state, postal_code and country
// (the same page, Required Address Properties). The Card Readers card sends only the pairing code and a label, so every
// reader an owner added there was refused; the money gate's battery passed a location of its own and never saw it. The
// unit now registers to its own facility Location: made once from the facility's address in Settings, marked ours (rule
// 25), remembered in terminal.locationId, and made again if it has gone from Stripe.
async function facilityLocation() {
  const t = getConfig().terminal || {};
  if (t.locationId) {
    try { const l = await stripeCall('GET', '/terminal/locations/' + encodeURIComponent(t.locationId)); if (l && l.id && !l.deleted) return l.id; } catch (e) { /* gone or unreadable: make it again */ }
  }
  const c = getConfig();
  // the Street Address field's own placeholder is "123 Main St, City, State": line1 is what comes before the city
  const city = String((c.seo && c.seo.city) || '').trim();
  const parts = String((c.contact && c.contact.address) || '').split(',').map(x => x.trim()).filter(Boolean);
  const at = city ? parts.findIndex((x, i) => i > 0 && x.toLowerCase().startsWith(city.toLowerCase())) : -1;
  const street = (at > 0 ? parts.slice(0, at) : parts).join(', ');
  const a = { line1: street, city, state: String((c.seo && c.seo.state) || '').trim(), postal_code: String((c.seo && c.seo.zip) || '').trim(), country: 'US' };
  const missing = [['line1', 'the street address (Settings > Business & Content > Contact Information)'], ['city', 'the city'], ['state', 'the state'], ['postal_code', 'the ZIP code']]
    .filter(([k]) => !a[k]).map(([, words]) => words);
  if (missing.length) throw new Error(`Stripe needs your facility's address to pair a reader: fill in ${missing.join(', ')}${missing.some(w => /city|state|ZIP/.test(w)) ? ' (Settings > Business & Content > Local Search & SEO)' : ''}, save, then press Add reader again.`);
  const loc = await stripeCall('POST', '/terminal/locations', Object.assign({ display_name: (c.server && c.server.businessName) || 'Facility', address: a },
    require('./stripemark').metaParams()));   // rule 25: ours
  saveTerminalCfg(x => { x.locationId = loc.id; });
  try { dbM.adminLog('TERMINAL_LOCATION_MADE', `${loc.id} - ${a.line1}, ${a.city}, ${a.state} ${a.postal_code}`); } catch {}
  return loc.id;
}

async function registerReader({ registration_code, label, location }) {
  const code = String(registration_code || '').trim();
  const simulated = SIMULATED_CODE.test(code) && /^sk_test_/.test(stripeKey());
  if (!simulated && !/^[a-z-]+-[a-z-]+-[a-z-]+$/i.test(code) && !isMock()) {
    throw new Error('Enter the three-word pairing code shown on the reader.');
  }
  let reader;
  if (isMock()) {
    reader = { id: 'tmr_mock_' + Math.random().toString(36).slice(2, 10),
               label: label || 'Simulated Reader', device_type: 'simulated_wisepos_e', status: 'online' };
  } else {
    const where = location || await facilityLocation();   // Stripe requires one (above)
    reader = await stripeCall('POST', '/terminal/readers', Object.assign(
      { registration_code: String(registration_code).trim(), label: label || 'Front Counter', location: where },
      require('./stripemark').metaParams()));   // rule 25: ours
  }
  const row = { id: reader.id, label: reader.label || label || 'Reader',
                device_type: reader.device_type || '', added_at: new Date().toISOString() };
  saveTerminalCfg(t => {
    t.readers = (t.readers || []).filter(r => r.id !== row.id).concat([row]);
    if (!t.defaultReader) t.defaultReader = row.id;
  });
  try { dbM.adminLog('TERMINAL_READER_ADDED', `${row.label} (${row.id})`); } catch {}
  return row;
}

function removeReader(id) {
  saveTerminalCfg(t => {
    t.readers = (t.readers || []).filter(r => r.id !== id);
    if (t.defaultReader === id) t.defaultReader = (t.readers[0] || {}).id || null;
  });
  try { dbM.adminLog('TERMINAL_READER_REMOVED', id); } catch {}
}

async function readerStatus(id) {
  if (isMock()) return { id, status: 'online', simulated: true };
  try {
    const r = await stripeCall('GET', `/terminal/readers/${encodeURIComponent(id)}`);
    return { id: r.id, status: r.status, label: r.label, device_type: r.device_type,
             ip: r.ip_address || '', serial: r.serial_number || '' };
  } catch (e) { return { id, status: 'unknown', error: e.message }; }
}

// ── COLLECT: create the intent, push it to the reader ─────────────────────
// Returns as soon as Stripe accepts the request. Payment is NOT complete
// here - the webhook decides. Callers must treat this as "asked".
async function collect({ tab_id, booking_id, amount_cents, reader_id, employee, description, check_id }) {
  ensureSchema();
  // never wrapped (Oct 3 2026; pilot facility's handoff section 2): `| 0` charged 4294967396 cents as $1.00
  const amt = Number(amount_cents);
  if (!Number.isSafeInteger(amt) || amt <= 0 || amt > 100000000) throw new Error('amount must be a positive number of cents');
  const rid = reader_id || defaultReaderId();
  if (!rid) throw new Error('No card reader is set up. Add one in Admin -> Settings -> Food & Payments -> Card Readers.');

  const tips = tipsCfg();
  const params = {
    amount: amt,
    currency: 'usd',
    payment_method_types: ['card_present'],
    capture_method: 'automatic',
    description: description || (tab_id ? `Tab ${tab_id}` : `Booking ${booking_id || ''}`),
    metadata: Object.assign({ source: 'ba_terminal' }, require('./stripemark').marker(),
      tab_id ? { tab_id } : {}, booking_id ? { booking_id } : {}, employee ? { employee } : {})
  };

  let pi;
  if (isMock()) {
    pi = { id: 'pi_mock_' + Math.random().toString(36).slice(2, 12), status: 'requires_payment_method' };
  } else {
    pi = await stripeCall('POST', '/payment_intents', params);
    // Reader tipping is configured on the process call; 'off' and 'manual'
    // send no tip config at all so the device never prompts.
    const processParams = { payment_intent: pi.id };
    if (tips.mode === 'server' || tips.mode === 'pooled') {
      processParams.process_config = { tipping: { amount_eligible: amt } };
    }
    await stripeCall('POST', `/terminal/readers/${encodeURIComponent(rid)}/process_payment_intent`, processParams);
  }

  const id = 'ti_' + Math.random().toString(36).slice(2, 12);
  dbM.db.prepare(`INSERT INTO terminal_intents (id,payment_intent,tab_id,booking_id,reader_id,amount_cents,employee,status,check_id)
                  VALUES (?,?,?,?,?,?,?,'pending',?)`)
    .run(id, pi.id, tab_id || null, booking_id || null, rid, amt, employee || '', check_id || null);
  try { dbM.adminLog('TERMINAL_COLLECT_STARTED', `${(amt / 100).toFixed(2)} on ${rid}`); } catch {}
  return { intent_id: id, payment_intent: pi.id, reader_id: rid, status: 'pending',
           tips_mode: tips.mode, simulated: isMock() };
}

// Stripe's cancel_action carries NOTHING that names an action: it cancels whatever
// that reader is doing at that instant. That was safe while only a staff member's
// Cancel button could reach it; it is not safe from a background sweep half an hour
// later, which would kill the tap of whoever is standing at the counter right now.
// So we ask the reader what it is doing first, and cancel only our own action.
// Cannot tell (offline, an error, no action) = never cancel a stranger's tap.
async function readerActionIsOurs(readerId, paymentIntent) {
  if (!readerId) return false;
  try {
    const r = await stripeCall('GET', `/terminal/readers/${encodeURIComponent(readerId)}`);
    const a = r && r.action;
    if (!a || a.status !== 'in_progress') return false;
    const ppi = a.process_payment_intent && a.process_payment_intent.payment_intent;
    return String((ppi && ppi.id) || ppi || '') === String(paymentIntent);
  } catch { return false; }
}
// Cancel at Stripe and REPORT WHAT HAPPENED. Both calls used to be swallowed and
// the record written 'canceled' either way, so a 429, a 500 or a refusal (an intent
// already processing cannot be cancelled) read exactly like a successful cancel -
// and a tab settled in cash on that word is a tab paid twice.
async function cancelAtStripe(row) {
  if (isMock()) return { cancelled: true, mock: true };
  if (await readerActionIsOurs(row.reader_id, row.payment_intent)) {
    try { await stripeCall('POST', `/terminal/readers/${encodeURIComponent(row.reader_id)}/cancel_action`, {}); } catch {}
  }
  try {
    const c = await stripeCall('POST', `/payment_intents/${encodeURIComponent(row.payment_intent)}/cancel`, {});
    if (c && c.status === 'canceled') return { cancelled: true };
    return { cancelled: false, error: 'Stripe left it ' + ((c && c.status) || 'unknown') };
  } catch (e) { return { cancelled: false, error: String(e.message).slice(0, 160) }; }
}

// Cancel an in-flight reader action (customer walked away, wrong amount).
async function cancelCollect(paymentIntent) {
  ensureSchema();
  const row = dbM.db.prepare(`SELECT * FROM terminal_intents WHERE payment_intent = ?`).get(paymentIntent);
  if (!row) throw new Error('unknown payment');
  if (row.status === 'succeeded') throw new Error('that payment already completed');
  const res = await cancelAtStripe(row);
  if (!res.cancelled) throw new Error('that payment could not be cancelled - it may already be going through (' + (res.error || 'Stripe refused') + '). Check the reader before taking another payment.');
  dbM.db.prepare(`UPDATE terminal_intents SET status='canceled', settled_at=datetime('now') WHERE payment_intent=?`).run(paymentIntent);
  try { dbM.adminLog('TERMINAL_COLLECT_CANCELED', paymentIntent); } catch {}
  return { ok: true };
}

// ── THE TRUTH PATH: webhook-driven finalization ───────────────────────────
// Called from the Stripe webhook ONLY. Idempotent: replays are no-ops.
function finalizePaidIntent(pi) {
  ensureSchema();
  const row = dbM.db.prepare(`SELECT * FROM terminal_intents WHERE payment_intent = ?`).get(pi.id);
  if (!row) return { ignored: 'not a terminal intent' };
  if (row.status === 'succeeded') return { ignored: 'already finalized' };

  // Stripe reports the tip separately when the reader collected one.
  let tip = 0;
  try {
    const details = pi.amount_details || {};
    tip = (details.tip && details.tip.amount) | 0;
  } catch { tip = 0; }
  const amount = (pi.amount_received || pi.amount || row.amount_cents) | 0;

  dbM.db.prepare(`UPDATE terminal_intents SET status='succeeded', tip_cents=?, settled_at=datetime('now') WHERE payment_intent=?`)
    .run(tip, pi.id);

  // Record into the POS tab when this was a tab collection.
  let posResult = null, unapplied = null;
  if (row.tab_id) {
    try {
      const pos = require('./pos');
      posResult = pos.recordPayment(row.tab_id, {
        method: 'card', amount_cents: amount - tip, tip_cents: tip,
        stripe_pi: pi.id, employee: row.employee, memo: 'card reader', check_id: row.check_id || null
      });
      // Card sale settled: record the tax sale with Stripe too (maintainer, Aug 14).
      try { pos.stxRecordSale(row.tab_id, 'tab-' + row.tab_id + '-' + Date.now().toString(36)); } catch {}
    } catch (e) {
      // The card was charged and the tab was NOT credited (staff closed the tab
      // another way while this sat pending). This used to be written into a column
      // no screen reads, while the owner's log said the payment succeeded - money
      // in the log that appears in no report. It is now named for what it is.
      unapplied = String(e.message).slice(0, 200);
      dbM.db.prepare(`UPDATE terminal_intents SET error=? WHERE payment_intent=?`).run(unapplied, pi.id);
      try { dbM.adminLog('TERMINAL_PAYMENT_UNAPPLIED', `${(amount / 100).toFixed(2)} ${pi.id} tab ${row.tab_id}: ${unapplied} - the card WAS charged and the tab was NOT credited; refund it or credit the tab by hand`); } catch {}
    }
  }
  try { dbM.adminLog('TERMINAL_PAYMENT_SUCCEEDED', `${(amount / 100).toFixed(2)}${tip ? ' (tip ' + (tip / 100).toFixed(2) + ')' : ''} ${pi.id}`); } catch {}
  return { ok: true, amount_cents: amount, tip_cents: tip, unapplied, tab: posResult && posResult.tab, closed: posResult && posResult.closed };
}

function failIntent(pi, reason) {
  ensureSchema();
  const row = dbM.db.prepare(`SELECT * FROM terminal_intents WHERE payment_intent = ?`).get(pi.id || pi);
  if (!row || row.status === 'succeeded') return { ignored: true };
  dbM.db.prepare(`UPDATE terminal_intents SET status='failed', error=?, settled_at=datetime('now') WHERE payment_intent=?`)
    .run(String(reason || 'declined').slice(0, 200), row.payment_intent);
  try { dbM.adminLog('TERMINAL_PAYMENT_FAILED', `${row.payment_intent}: ${reason || 'declined'}`); } catch {}
  return { ok: true };
}

// ── RECONCILE: A READER PAYMENT IS VERIFIABLE WITHOUT A WEBHOOK (maintainer, Sep 12 2026) ──
// The webhook is still the first word, but never the only one. A tab can never
// be left unpaid or paid twice because a webhook did not land: while our
// record still says pending, the scheduler's tick (every minute), the boot,
// and the pad's own poll ask Stripe for the intent and apply the same
// idempotent finalize / fail the webhook would - the memberships' reconcile
// path, for the reader. A tap that never comes is cancelled at Stripe after
// half an hour and failed here with the reason, so nothing waits forever.
const RECONCILE_AFTER_MS = 20 * 1000;
const GIVE_UP_AFTER_MS = 30 * 60 * 1000;
// opts.allowGiveUp=false: the PAD's own poll may ask Stripe, but must never end a
// payment. The give-up belongs to the scheduler alone - a staff screen left open on
// the counter used to be able to fire it at whoever was tapping.
async function reconcileIntent(row, opts = {}) {
  if (isMock()) return { skipped: 'mock' };
  const allowGiveUp = opts.allowGiveUp !== false;
  let pi;
  try { pi = await stripeCall('GET', `/payment_intents/${encodeURIComponent(row.payment_intent)}`); }
  catch (e) {
    // An intent this account cannot see can NEVER resolve (the facility re-keyed
    // Stripe, the object belongs to another account). Retrying it every minute in
    // silence and dropping it at seven days leaves the tab due with no explanation.
    if (/no such payment_intent|resource_missing/i.test(String(e.message))) {
      failIntent(row.payment_intent, 'Stripe does not know this payment - the account may have been re-keyed. Take the payment again.');
      return { did: 'failed', why: 'unknown at Stripe' };
    }
    throw e;
  }
  const ageMs = Date.now() - Date.parse(String(row.created_at).replace(' ', 'T') + 'Z');
  if (pi.status === 'succeeded') {
    const fin = finalizePaidIntent(pi);
    if (fin.ok) { try { dbM.adminLog('TERMINAL_RECONCILED', `${row.payment_intent} paid - seen by the reconcile, no webhook`); } catch {} }
    return { did: 'paid', fin, unapplied: fin && fin.unapplied || null };
  }
  if (pi.status === 'canceled') { failIntent(row.payment_intent, 'canceled at Stripe - seen by the reconcile'); return { did: 'failed', why: 'canceled' }; }
  // MONEY IN FLIGHT IS NEVER WRITTEN OFF. 'processing' on a card_present intent
  // means a card WAS presented and the charge is going through; it used to sit in
  // the give-up list and be recorded as "no card presented", after which nothing
  // looked at the row again and the charge settled against an open tab.
  if (pi.status === 'processing') return { did: 'waiting', status: 'processing' };
  if (allowGiveUp && ageMs > GIVE_UP_AFTER_MS && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
    const res = await cancelAtStripe(row);
    if (!res.cancelled) {
      // The cancel did not happen, so the money may still land: the record stays
      // pending and the next tick tries again. Writing 'failed' here is how a tab
      // gets settled in cash and charged to the card as well.
      try { dbM.adminLog('TERMINAL_GIVEUP_DEFERRED', `${row.payment_intent}: ${res.error || 'Stripe refused the cancel'} - still open, the reconcile will try again`); } catch {}
      return { did: 'waiting', why: 'give-up deferred: ' + (res.error || 'Stripe refused the cancel') };
    }
    failIntent(row.payment_intent, 'no card presented in 30 minutes - cancelled by the reconcile');
    return { did: 'gave-up' };
  }
  if (pi.last_payment_error && pi.last_payment_error.message && ageMs > RECONCILE_AFTER_MS) {
    // A decline the reader reported: the customer may tap again while the intent is
    // open, so this is REPORTED, not final - and the give-up above ends it either
    // way (it used to return above the give-up, so a declined tap sat pending for
    // ever and the pad showed "waiting for the customer to tap" all night).
    try { dbM.db.prepare(`UPDATE terminal_intents SET error=? WHERE payment_intent=? AND status='pending'`).run(String(pi.last_payment_error.message).slice(0, 200), row.payment_intent); } catch {}
    return { did: 'waiting', why: pi.last_payment_error.message };
  }
  return { did: 'waiting', status: pi.status };
}
async function reconcileWaiting({ minAgeMs = RECONCILE_AFTER_MS } = {}) {
  ensureSchema();
  if (isMock()) return { skipped: 'mock' };
  const rows = dbM.db.prepare(`SELECT * FROM terminal_intents WHERE status='pending' AND created_at < datetime('now', ?) AND created_at > datetime('now', '-7 days')`).all('-' + Math.round(minAgeMs / 1000) + ' seconds');
  const out = { checked: rows.length, paid: 0, failed: 0, gaveUp: 0, waiting: 0, errors: 0, unapplied: 0 };
  for (const row of rows) {
    try { const r = await reconcileIntent(row); if (r.did === 'paid') { out.paid++; if (r.unapplied) out.unapplied++; } else if (r.did === 'failed') out.failed++; else if (r.did === 'gave-up') out.gaveUp++; else out.waiting++; }
    catch (e) { out.errors++; try { dbM.adminLog('TERMINAL_RECONCILE_ERROR', `${row.payment_intent}: ${String(e.message).slice(0, 160)}`); } catch {} console.error('terminal reconcile:', row.payment_intent, e.message); }
  }
  return out;
}
// RULE 23: if the unit can tell a card payment is not completing, something must
// say so out loud. A-wave 8 added a whole money failure mode with no signal on it.
function terminalHealth() {
  try {
    ensureSchema();
    if (!readers().length && !defaultReaderId()) return { configured: false, level: 'green', detail: 'no card reader on this unit' };
    // No seven-day floor here on purpose: reconcileWaiting stops looking after a week,
    // so a payment still pending at day eight is precisely the one nobody is working
    // on. It must stay visible to the owner, not quietly leave the panel.
    const stuck = dbM.db.prepare(`SELECT COUNT(*) AS n FROM terminal_intents WHERE status='pending' AND created_at < datetime('now','-45 minutes')`).get().n | 0;
    const abandoned = dbM.db.prepare(`SELECT COUNT(*) AS n FROM terminal_intents WHERE status='pending' AND created_at < datetime('now','-7 days')`).get().n | 0;
    const errs = dbM.db.prepare(`SELECT COUNT(*) AS n FROM admin_log WHERE event='TERMINAL_RECONCILE_ERROR' AND created_at > datetime('now','-2 hours')`).get().n | 0;
    const unap = dbM.db.prepare(`SELECT COUNT(*) AS n FROM admin_log WHERE event='TERMINAL_PAYMENT_UNAPPLIED' AND created_at > datetime('now','-7 days')`).get().n | 0;
    return { configured: true, stuck, abandoned, errors: errs, unapplied: unap,
             level: (unap || stuck) ? 'red' : errs ? 'amber' : 'green' };
  } catch (e) { return { configured: false, level: 'amber', detail: 'could not read the reader\'s payments: ' + e.message }; }
}

// The pad's poll: OUR record - and when it has waited longer than a tap takes,
// Stripe is asked on the spot so the counter never stares at "pending" for a
// payment that already went through.
const _liveChecked = new Map();   // payment_intent -> last live check (ms). The pad polls every 2 s.
async function intentStateLive(paymentIntent) {
  ensureSchema();
  const row = dbM.db.prepare(`SELECT * FROM terminal_intents WHERE payment_intent = ?`).get(paymentIntent);
  if (row && row.status === 'pending' && !isMock()) {
    const ageMs = Date.now() - Date.parse(String(row.created_at).replace(' ', 'T') + 'Z');
    const last = _liveChecked.get(paymentIntent) || 0;
    // The pad's poll is every two seconds; one Stripe call per row per 20 s is
    // plenty and keeps a screen left open off the rate limiter. And the pad NEVER
    // gives up a payment - that is the scheduler's job, on its own clock.
    if (ageMs > RECONCILE_AFTER_MS && Date.now() - last > RECONCILE_AFTER_MS) {
      _liveChecked.set(paymentIntent, Date.now());
      if (_liveChecked.size > 200) for (const [k, v] of _liveChecked) if (Date.now() - v > 3600000) _liveChecked.delete(k);
      try { await reconcileIntent(row, { allowGiveUp: false }); } catch (e) { console.error('terminal live check:', e.message); }
    }
  }
  return intentState(paymentIntent);
}

// What the staff screen polls while the customer is tapping. This reports
// OUR record (webhook-written or reconcile-written), never Stripe's optimistic state.
function intentState(paymentIntent) {
  ensureSchema();
  const row = dbM.db.prepare(`SELECT * FROM terminal_intents WHERE payment_intent = ?`).get(paymentIntent);
  if (!row) return { status: 'unknown' };
  return { status: row.status, amount_cents: row.amount_cents, tip_cents: row.tip_cents,
           error: row.error || '', reader_id: row.reader_id, tab_id: row.tab_id, booking_id: row.booking_id };
}

// TEST/SIMULATOR ONLY: present a card to Stripe's simulated reader.
async function simulatePresentCard(readerId) {
  if (isMock()) return { simulated: 'local-mock' };
  return stripeCall('POST', `/test_helpers/terminal/readers/${encodeURIComponent(readerId)}/present_payment_method`, {});
}

module.exports = {
  reconcileIntent, reconcileWaiting, intentStateLive, RECONCILE_AFTER_MS, GIVE_UP_AFTER_MS,
  ensureSchema, readers, tipsCfg, defaultReaderId, saveTerminalCfg,
  registerReader, removeReader, readerStatus,
  collect, cancelCollect, finalizePaidIntent, failIntent, intentState, terminalHealth,
  simulatePresentCard, isMock
};
