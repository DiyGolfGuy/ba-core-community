// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/pos.js — POS engine: menu, tabs, orders, payments, drawer, EOD.
// Phase 1 backend per WHITE-LABEL-BUILD-PLAN-AUG2026 POS spec.
// Doctrine: options not hard rules; standard-POS baseline; every action stamped.
'use strict';

const dbM = require('./db');
const { v4: uuid } = require('uuid');
const printing = require('./printing');

// ── schema ───────────────────────────────────────────────────────────────
function ensureSchema() {
  const D = dbM.db;
  D.exec(`CREATE TABLE IF NOT EXISTS menu_categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0,
    printer_role TEXT DEFAULT 'kitchen', tax_category TEXT DEFAULT 'food',
    active INTEGER DEFAULT 1)`);
  D.exec(`CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL,
    price_cents INTEGER NOT NULL, printer_role TEXT, tax_category TEXT,
    active INTEGER DEFAULT 1, eighty_sixed INTEGER DEFAULT 0, sort INTEGER DEFAULT 0)`);
  D.exec(`CREATE TABLE IF NOT EXISTS item_choice_groups (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL, name TEXT NOT NULL,
    required INTEGER DEFAULT 0, sort INTEGER DEFAULT 0)`);
  D.exec(`CREATE TABLE IF NOT EXISTS item_choices (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL,
    delta_cents INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, sort INTEGER DEFAULT 0)`);
  D.exec(`CREATE TABLE IF NOT EXISTS tabs (
    id TEXT PRIMARY KEY, booking_id TEXT, label TEXT NOT NULL,
    bay_id TEXT, bay_name TEXT, table_label TEXT, member_id TEXT,
    status TEXT DEFAULT 'open', opened_by TEXT, opened_at TEXT DEFAULT (datetime('now')),
    closed_by TEXT, closed_at TEXT)`);
  D.exec(`CREATE TABLE IF NOT EXISTS tab_items (
    id TEXT PRIMARY KEY, tab_id TEXT NOT NULL, item_id TEXT,
    name TEXT NOT NULL, qty REAL DEFAULT 1, unit_price_cents INTEGER NOT NULL,
    choices_json TEXT DEFAULT '[]', note TEXT DEFAULT '',
    tax_category TEXT DEFAULT 'food', printer_role TEXT,
    kind TEXT DEFAULT 'menu',            -- menu | golf | custom
    status TEXT DEFAULT 'sent',          -- sent | voided
    comp INTEGER DEFAULT 0,
    order_no INTEGER, person TEXT DEFAULT '',
    sent_at TEXT DEFAULT (datetime('now')), sent_by TEXT DEFAULT '',
    void_reason TEXT, void_by TEXT, void_at TEXT,
    reviewed INTEGER DEFAULT 0, reviewed_by TEXT, reviewed_at TEXT)`);
  D.exec(`CREATE TABLE IF NOT EXISTS tab_payments (
    id TEXT PRIMARY KEY, tab_id TEXT NOT NULL,
    method TEXT NOT NULL,                -- card | cash | check | credit | gift
    amount_cents INTEGER NOT NULL, tip_cents INTEGER DEFAULT 0,
    tendered_cents INTEGER, change_cents INTEGER, memo TEXT DEFAULT '',
    stripe_pi TEXT DEFAULT '', employee TEXT,
    check_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')))`);
  D.exec(`CREATE TABLE IF NOT EXISTS drawer_events (
    id TEXT PRIMARY KEY, at TEXT DEFAULT (datetime('now')),
    employee TEXT DEFAULT '', reason TEXT NOT NULL, txn_id TEXT DEFAULT '')`);
  D.exec(`CREATE TABLE IF NOT EXISTS eod_reports (
    id TEXT PRIMARY KEY, date TEXT UNIQUE NOT NULL,
    opening_float_cents INTEGER DEFAULT 0, expected_cash_cents INTEGER DEFAULT 0,
    counted_cents INTEGER, over_short_cents INTEGER,
    counted_by TEXT, data_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')))`);
  // check_id on payments is POS truth now (per-check collect, Aug 13): ensure it here, not only in checks.ensureShareColumn, so every caller of
  // recordPayment gets the column regardless of which schemas it booted.
  try {
    const cols = dbM.db.prepare(`PRAGMA table_info(tab_payments)`).all().map(c => c.name);
    if (cols.length && !cols.includes('check_id')) dbM.db.exec(`ALTER TABLE tab_payments ADD COLUMN check_id TEXT`);
  } catch (e) {}
  // the tab's sale as Stripe Tax recorded it (Oct 3 2026): kept on the tab, so a refund after a restart can still reverse it
  try { D.exec(`ALTER TABLE tabs ADD COLUMN stx_txn_id TEXT DEFAULT ''`); } catch (e) {}
  // a line about a menu item (Oct 20 2026): the ONE menu is this one - the website's menu section shows it live
  // and its words ride here, never typed twice (rule 2). The pad and the receipts never read it.
  try { D.exec(`ALTER TABLE menu_items ADD COLUMN description TEXT DEFAULT ''`); } catch (e) {}
  // MONEY GIVEN BACK AT THE COUNTER (maintainer, Sep 24 2026): one row per refund of a
  // counter payment - pressed on the pad by whoever is standing there, with a
  // reason, or made in Stripe's dashboard and picked up (source 'stripe'). The
  // payment it came off is never changed; the owner reviews each like a void.
  // amount_cents is the part of the sale given back, tip_cents the part of the
  // tip (a refund comes off the sale first). services/refunds.js writes it.
  D.exec(`CREATE TABLE IF NOT EXISTS tab_refunds (
    id TEXT PRIMARY KEY, tab_id TEXT NOT NULL, payment_id TEXT NOT NULL,
    method TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0, tip_cents INTEGER DEFAULT 0,
    reason TEXT DEFAULT '', employee TEXT DEFAULT '',
    stripe_refund_id TEXT DEFAULT '', status TEXT DEFAULT 'succeeded', source TEXT DEFAULT 'counter',
    error TEXT DEFAULT '', at TEXT NOT NULL,
    reviewed INTEGER DEFAULT 0, reviewed_by TEXT, reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);
  try { D.exec(`CREATE INDEX IF NOT EXISTS idx_tab_refunds_payment ON tab_refunds (payment_id)`); } catch (e) {}
  try { D.exec(`CREATE INDEX IF NOT EXISTS idx_tab_refunds_stripe ON tab_refunds (stripe_refund_id)`); } catch (e) {}
  // the counter's specials (Oct 22 2026): services/specials.js
  try { require('./specials').ensureSchema(); } catch (e) {}
  // package deals (Oct 22 2026): which of a booking's package an order line was (services/packages.js), and the packages
  try { D.exec(`ALTER TABLE tab_items ADD COLUMN package_include TEXT DEFAULT ''`); } catch (e) {}
  try { require('./packages').ensureSchema(); } catch (e) {}
  // once per boot (the review, Oct 3 2026): ensureSchema runs on every tab read through refunds.ensure, and the rekey reads
  // every End of Day row ever kept (rule 6) - a year of nightly closes made each Paid list seconds of a blocked unit
  if (!rekeyedThisBoot) { try { rekeyEveningCloses(); rekeyedThisBoot = true; } catch (e) {} }
}
let rekeyedThisBoot = false;

// AN EVENING CLOSE FILED UNDER TOMORROW GOES BACK TO ITS OWN DAY (Oct 3 2026, the pack review). Before the facility's day
// (Oct 2026) End of Day was keyed by the UTC date, so a close at 10 PM Central sat under the NEXT date - on the day the pack
// lands, the staff pad showed that day as already closed, and the day's own close OVERWROTE last night's counted cash
// (ON CONFLICT(date) DO UPDATE). A close cannot be made before its own day begins, so a row first saved on an earlier
// facility day than its date AND filed under the UTC date of that moment is one of those, and it moves to the day it was
// made - only when that day has no close of its own (nothing is ever overwritten or deleted, rule 6). Idempotent; every boot.
function rekeyEveningCloses() {
  const D = dbM.db, rev = require('./revenue'), tz = rev.tzOf();
  const rows = D.prepare(`SELECT id, date, created_at, expected_cash_cents, data_json FROM eod_reports ORDER BY date`).all();
  let moved = 0;
  for (const r of rows) {
    const made = rev.localDate(r.created_at, tz);
    // exactly the old code's mistake: filed under the UTC date of the moment it was saved, which was a later day than the
    // facility's own. A close saved for another date on purpose (the owner's date picker) never has that shape.
    if (!made || !(made < r.date) || String(r.created_at || '').slice(0, 10) !== r.date) continue;
    if (D.prepare(`SELECT 1 FROM eod_reports WHERE date=?`).get(made)) continue;
    // ...BUT NEVER A ROW A LATER CLOSE OVERWROTE (Oct 19 2026, the pack review). The old save's ON CONFLICT(date) kept the
    // first close's created_at and expected cash and replaced its count and summary: Saturday's 10 PM close filed under
    // Sunday, then Sunday's own afternoon close on the same key, leaves SUNDAY's count under Saturday evening's time -
    // moving it files Sunday's count under Saturday and shows Sunday as never closed. It stays, and the owner's log says so.
    const over = eodOverwritten(r);
    if (over) { eodSkipLogged(r, over); continue; }
    D.prepare(`UPDATE eod_reports SET date=? WHERE id=?`).run(made, r.id);
    moved++;
    try { dbM.adminLog('EOD_REKEYED', `End of Day ${r.id} moved from ${r.date} to ${made} - it was closed on the evening of ${made} and filed under the UTC date`); } catch (e) {}
  }
  return moved;
}

// The two marks an overwrite leaves: the summary expects a different drawer than the column the first save wrote, or the
// summary names something (a payment, a refund, a drawer event) from after the row was first saved.
function eodOverwritten(r) {
  let s = null; try { s = JSON.parse(r.data_json || '{}'); } catch (e) {}
  if (s && s.expected_cash_cents != null && Number(s.expected_cash_cents) !== Number(r.expected_cash_cents || 0)) {
    return `its summary expects ${s.expected_cash_cents} cents in the drawer, the first close ${r.expected_cash_cents || 0}`;
  }
  const first = String(r.created_at || '').replace('T', ' ').slice(0, 19);
  const later = (String(r.data_json || '').match(/"[a-z_]*(?:_at|time)"\s*:\s*"\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/g) || [])
    .map(m => m.slice(-19).replace('T', ' ')).filter(t => first && t > first).sort();
  return later.length ? `its summary names something from ${later[later.length - 1]} UTC, after it was first saved at ${first}` : null;
}
function eodSkipLogged(r, why) {
  try { if (dbM.db.prepare(`SELECT 1 FROM admin_log WHERE event='EOD_REKEY_SKIPPED' AND detail LIKE ?`).get('%' + r.id + '%')) return; } catch (e) {}
  try { dbM.adminLog('EOD_REKEY_SKIPPED', `End of Day ${r.id} stays under ${r.date} - a later close overwrote it (${why}); moving it would file that day's count under the evening before`); } catch (e) {}
}

function posCfg(cfg) {
  const p = (cfg && cfg.pos) || {};
  return {
    checkinMode: p.checkinMode || 'full',                 // off | arrival | full
    // CASH AND CHECKS ARE ON (maintainer's ruling, Sep 1 2026). A counter that cannot
    // take cash is not a counter, and a facility that takes cash can decide
    // for itself about checks - they are rare enough that it is the
    // facility's call, not ours. Both start on; the owner turns checks off in
    // Admin > Settings > Staff > The Counter and the tile stops rendering for staff.
    // The DRAWER is a SEPARATE question and stays off until one is wired:
    // recordPayment only kicks a drawer when cfg.drawer.enabled, so a
    // facility takes cash on day one with no drawer at all.
    payments: Object.assign({ cash: true, check: true }, p.payments || {}),
    tips: Object.assign({ enabled: true, mode: 'server' }, p.tips || {}), // server|pooled|manual
    tax: (function () {
      // First-class TAX CODES: when cfg.pos.tax.codes = [{id,name,rate,stripe_code}]
      // exists, it is the source of truth — compiled here into the same
      // categories rate-map computeTotals and eodSummary already read, so the
      // math paths stay byte-identical. Legacy three-key configs keep working.
      const t = Object.assign({ categories: { sim: 0, food: 0, beverage: 0 }, stripeTax: false }, p.tax || {});
      if (Array.isArray(t.codes) && t.codes.length) {
        const map = {};
        for (const c of t.codes) if (c && c.id) map[c.id] = Number(c.rate) || 0;
        t.categories = map;
      }
      return t;
    })(),
    drawer: Object.assign({ enabled: false }, p.drawer || {}),
    openingFloatCents: Number.isFinite(p.openingFloatCents) ? p.openingFloatCents : 0
  };
}

// ── tax codes (owner-defined, first-class) ───────────────────────────────
const TAX_DEFAULT_NAMES = { sim: 'Simulator time', food: 'Prepared food', beverage: 'Beverage' };

function getTaxCodes() {
  const cfg = require('./config').getConfig();
  const t = (cfg.pos && cfg.pos.tax) || {};
  if (Array.isArray(t.codes) && t.codes.length) {
    return t.codes.map(c => ({
      id: String(c.id), name: String(c.name || c.id).slice(0, 40),
      rate: Number(c.rate) || 0, stripe_code: String(c.stripe_code || '').slice(0, 60)
    }));
  }
  // derive from the legacy categories map so existing facilities see their
  // exact current rates the first time the codes screen opens
  const cats = t.categories || { sim: 0, food: 0, beverage: 0 };
  return Object.keys(cats).map(id => ({
    id, name: TAX_DEFAULT_NAMES[id] || id, rate: Number(cats[id]) || 0, stripe_code: ''
  }));
}

function setTaxCodes(list) {
  if (!Array.isArray(list) || !list.length || list.length > 30) throw new Error('Provide 1-30 tax codes');
  const seen = new Set();
  const clean = list.map(c => {
    const id = String(c && c.id || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,24}$/.test(id)) throw new Error('Code ids are 1-24 chars: a-z, 0-9, dash, underscore');
    if (seen.has(id)) throw new Error('Code ids must be unique');
    seen.add(id);
    const rate = Number(c.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error(`Rate for "${id}" must be 0-100`);
    const name = String(c.name || '').trim().slice(0, 40);
    if (!name) throw new Error(`Name required for "${id}"`);
    return { id, name, rate, stripe_code: String(c.stripe_code || '').trim().slice(0, 60) };
  });
  if (!seen.has('sim')) throw new Error('A "sim" code is required - the golf line on every tab is taxed under it');
  const cfgMod = require('./config');
  const cfg = cfgMod.getConfig();
  cfg.pos = cfg.pos || {};
  cfg.pos.tax = cfg.pos.tax || {};
  cfg.pos.tax.codes = clean;
  // keep the compiled map in sync for any external readers and reference configs
  cfg.pos.tax.categories = Object.fromEntries(clean.map(c => [c.id, c.rate]));
  cfgMod.saveConfig(cfg);
  return clean;
}

// ── menu ─────────────────────────────────────────────────────────────────
function getMenu(includeInactive) {
  const D = dbM.db;
  const cats = D.prepare(`SELECT * FROM menu_categories ${includeInactive ? '' : 'WHERE active=1'} ORDER BY sort, name`).all();
  const items = D.prepare(`SELECT * FROM menu_items ${includeInactive ? '' : 'WHERE active=1'} ORDER BY sort, name`).all();
  const groups = D.prepare('SELECT * FROM item_choice_groups ORDER BY sort').all();
  const choices = D.prepare('SELECT * FROM item_choices ORDER BY sort').all();
  for (const g of groups) g.choices = choices.filter(c => c.group_id === g.id);
  for (const it of items) it.choiceGroups = groups.filter(g => g.item_id === it.id);
  // what is on special right now (Oct 22 2026): the pad shows it on the item; price_cents stays the menu's own
  try { const S = require('./specials'), now = S.clock(); for (const it of items) { const sp = S.priceFor(it, now); if (sp) { it.special_price_cents = sp.unit_cents; it.special_name = sp.reason; } } } catch {}
  for (const c of cats) c.items = items.filter(i => i.category_id === c.id);
  return cats;
}

function upsertCategory(o) {
  const D = dbM.db;
  const id = o.id || uuid();
  D.prepare(`INSERT INTO menu_categories (id,name,sort,printer_role,tax_category,active)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort=excluded.sort,
      printer_role=excluded.printer_role, tax_category=excluded.tax_category, active=excluded.active`)
   .run(id, String(o.name || '').slice(0, 60), o.sort | 0,
        o.printer_role || 'kitchen', o.tax_category || 'food', o.active === false ? 0 : 1);
  return id;
}

function upsertItem(o) {
  const D = dbM.db;
  const id = o.id || uuid();
  // description: kept as it is when a save does not carry one (the Admin menu builder never sends it)
  D.prepare(`INSERT INTO menu_items (id,category_id,name,price_cents,printer_role,tax_category,active,eighty_sixed,sort,description)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id, name=excluded.name,
      price_cents=excluded.price_cents, printer_role=excluded.printer_role,
      tax_category=excluded.tax_category, active=excluded.active, sort=excluded.sort,
      description=COALESCE(excluded.description, menu_items.description)`)
   .run(id, o.category_id, String(o.name || '').slice(0, 80), o.price_cents | 0,
        o.printer_role || null, o.tax_category || null,
        o.active === false ? 0 : 1, o.eighty_sixed ? 1 : 0, o.sort | 0,
        o.description === undefined || o.description === null ? null : String(o.description).slice(0, 300));
  if (Array.isArray(o.choiceGroups)) {
    for (const g of o.choiceGroups) {
      const gid = g.id || uuid();
      D.prepare(`INSERT INTO item_choice_groups (id,item_id,name,required,sort) VALUES (?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, required=excluded.required, sort=excluded.sort`)
       .run(gid, id, String(g.name || '').slice(0, 60), g.required ? 1 : 0, g.sort | 0);
      for (const c of (g.choices || [])) {
        D.prepare(`INSERT INTO item_choices (id,group_id,name,delta_cents,is_default,sort) VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, delta_cents=excluded.delta_cents,
            is_default=excluded.is_default, sort=excluded.sort`)
         .run(c.id || uuid(), gid, String(c.name || '').slice(0, 60), c.delta_cents | 0, c.is_default ? 1 : 0, c.sort | 0);
      }
    }
  }
  return id;
}

// The builder needs a real removal path: a group delete cascades its choices.
// Items and categories deactivate (active=0) so history keeps its names.
/**
 * DELETE a menu item. Safe for history: tab_items copies the name and price
 * at the moment it is ordered, so past receipts, Z reports and open tabs are
 * untouched by removing the menu entry.
 */
function deleteItem(id) {
  const row = dbM.db.prepare(`SELECT * FROM menu_items WHERE id = ?`).get(id);
  if (!row) throw new Error('item not found');
  dbM.db.prepare(`DELETE FROM menu_items WHERE id = ?`).run(id);
  try { dbM.adminLog('MENU_ITEM_DELETED', row.name); } catch {}
  return { ok: true, name: row.name };
}

/**
 * DELETE a category. Refuses while it still holds items rather than silently
 * taking them with it - losing a menu section by accident is expensive to
 * rebuild. Deactivating instead hides it from staff and keeps the history.
 */
function deleteCategory(id) {
  const row = dbM.db.prepare(`SELECT * FROM menu_categories WHERE id = ?`).get(id);
  if (!row) throw new Error('category not found');
  const n = dbM.db.prepare(`SELECT COUNT(*) c FROM menu_items WHERE category_id = ?`).get(id).c;
  if (n > 0) {
    throw new Error(`"${row.name}" still has ${n} item${n > 1 ? 's' : ''}. Delete or move them first, or switch the category to inactive to hide it.`);
  }
  dbM.db.prepare(`DELETE FROM menu_categories WHERE id = ?`).run(id);
  try { dbM.adminLog('MENU_CATEGORY_DELETED', row.name); } catch {}
  return { ok: true, name: row.name };
}

function deleteChoiceGroup(groupId) {
  const D = dbM.db;
  D.prepare('DELETE FROM item_choices WHERE group_id=?').run(groupId);
  const r = D.prepare('DELETE FROM item_choice_groups WHERE id=?').run(groupId);
  return true;
}

function deleteChoice(choiceId) {
  dbM.db.prepare('DELETE FROM item_choices WHERE id=?').run(choiceId);
  return true;
}

function setEightySix(itemId, on) {
  const D = dbM.db;
  D.prepare('UPDATE menu_items SET eighty_sixed=? WHERE id=?').run(on ? 1 : 0, itemId);
  const row = D.prepare('SELECT eighty_sixed FROM menu_items WHERE id=?').get(itemId);
  return !!row && (row.eighty_sixed === (on ? 1 : 0));
}

// ── tabs ─────────────────────────────────────────────────────────────────
function openTab({ booking_id, label, bay_id, bay_name, table_label, member_id, employee }) {
  const D = dbM.db;
  const id = uuid();
  D.prepare(`INSERT INTO tabs (id, booking_id, label, bay_id, bay_name, table_label, member_id, opened_by)
             VALUES (?,?,?,?,?,?,?,?)`)
   .run(id, booking_id || null, String(label || '').slice(0, 60) || 'Guest',
        bay_id || null, bay_name || null, table_label || null, member_id || null, employee || '');
  // opening a tab on a booking implies arrival (one source of truth)
  if (booking_id) {
    try {
      D.prepare(`UPDATE bookings SET no_show=0 WHERE id=? AND no_show=1`).run(booking_id);
    } catch (_) { /* column may not exist on older trees */ }
  }
  return getTab(id);
}

function getTab(id) {
  const D = dbM.db;
  const tab = D.prepare('SELECT * FROM tabs WHERE id=?').get(id);
  if (!tab) return null;
  tab.items = D.prepare('SELECT * FROM tab_items WHERE tab_id=? ORDER BY sent_at, name').all(id)
    .map(i => ({ ...i, choices: safeJson(i.choices_json, []) }));
  tab.payments = D.prepare('SELECT * FROM tab_payments WHERE tab_id=? ORDER BY created_at').all(id);
  Object.assign(tab, computeTotals(tab));
  // Money given back off this tab (Sep 24 2026) - the payments themselves never change.
  try {
    const rf = require('./refunds');
    tab.refunds = rf.forTab(id);
    tab.refunded_cents = tab.refunds.filter(r => rf.COUNTS.includes(r.status)).reduce((s, r) => s + (r.amount_cents | 0) + (r.tip_cents | 0), 0);
    for (const p of tab.payments) p.refundable_cents = ['card', 'cash', 'check'].includes(p.method) ? rf.refundable(p).total : 0;
  } catch (e) { tab.refunds = []; tab.refunded_cents = 0; }
  return tab;
}

// W22 (bench load test, Sep 2 2026): the open-tabs list is what every pad
// polls, and it used to run three queries and a config read PER TAB - three
// quarters of the Pi's CPU under load once tabs piled up. Now three queries
// for the whole list and one config read, grouped in memory.
function listOpenTabs() {
  const D = dbM.db;
  const tabs = D.prepare(`SELECT * FROM tabs WHERE status='open' ORDER BY bay_name, table_label, label`).all();
  if (!tabs.length) return [];
  const items = D.prepare(`SELECT i.* FROM tab_items i JOIN tabs t ON t.id = i.tab_id WHERE t.status='open' ORDER BY i.sent_at, i.name`).all();
  const pays = D.prepare(`SELECT p.* FROM tab_payments p JOIN tabs t ON t.id = p.tab_id WHERE t.status='open' ORDER BY p.created_at`).all();
  const byTab = new Map(), payBy = new Map();
  for (const i of items) { const arr = byTab.get(i.tab_id) || []; arr.push({ ...i, choices: safeJson(i.choices_json, []) }); byTab.set(i.tab_id, arr); }
  for (const p of pays) { const arr = payBy.get(p.tab_id) || []; arr.push(p); payBy.set(p.tab_id, arr); }
  const taxRates = posCfg(require('./config').getConfig()).tax.categories || {};
  return tabs.map(t => { t.items = byTab.get(t.id) || []; t.payments = payBy.get(t.id) || []; Object.assign(t, computeTotals(t, taxRates)); return t; });
}

function safeJson(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

// ── money ────────────────────────────────────────────────────────────────
function lineCents(i) {
  if (i.status === 'voided') return 0;
  const choiceDelta = (safeJson(i.choices_json, i.choices || [])).reduce((s, c) => s + (c.delta_cents | 0), 0);
  const unit = (i.unit_price_cents | 0) + choiceDelta;
  const gross = Math.round(unit * (i.qty || 1));
  return i.comp ? 0 : gross;
}

// ── COUNTER-SIDE STRIPE TAX (maintainer, Aug 14) ────────────────────────────────────
// computeTotals is synchronous and called on every staff refresh, so it can
// never make a network call. Instead: every mutation that changes a tab's
// money (send, void, comp, move, share) kicks an async recalculation that
// stores the answer against a FINGERPRINT of the tab's lines. computeTotals
// uses that answer only while the fingerprint still matches - the instant an
// item changes, the stale number is refused and manual rates carry the bill
// until the fresh answer lands. A tab therefore can never show tax that
// belongs to a different set of items.
const STX_CACHE = new Map();   // tab_id -> { fp, tax_cents, by_cat, calc_id }

function stxFingerprint(tab) {
  return (tab.items || [])
    .filter(i => !i.voided_at)
    .map(i => `${i.id}:${lineCents(i)}:${i.tax_category || 'food'}:${i.comped ? 'c' : ''}`)
    .join('|');
}

function stxLines(tab) {
  return (tab.items || [])
    .filter(i => !i.voided_at && lineCents(i) > 0)
    .map(i => ({ amount_cents: lineCents(i), reference: i.id, category: i.tax_category || 'food' }));
}

/** Recalculate a tab's tax through Stripe. Safe to call anywhere; never throws. */
async function refreshTabTax(tabId) {
  try {
    const stx = require('./stripetax');
    if (!stx.enabled()) { STX_CACHE.delete(tabId); return null; }
    const tab = getTab(tabId);
    if (!tab) return null;
    const lines = stxLines(tab);
    const fp = stxFingerprint(tab);
    if (!lines.length) { STX_CACHE.set(tabId, { fp, tax_cents: 0, by_cat: {}, calc_id: null }); return null; }
    const res = await stx.calculate(lines, 'tab-' + tabId);
    // Only a real Stripe answer is cached; a fallback leaves the manual math
    // in charge, which is exactly what computeTotals does without a cache hit.
    if (res.engine !== 'stripe') { STX_CACHE.delete(tabId); return null; }
    // Stripe's per-line numbers, grouped by OUR tax codes - the Z report keeps
    // its per-category lines whatever the manual rates say (maintainer, Aug 14).
    const byCat = {};
    const byRef = res.by_reference || {};
    let mapped = 0;
    for (const l of lines) {
      const t = byRef[('tab-' + tabId + '-' + l.reference)] ?? byRef[l.reference];
      if (t === undefined) continue;
      byCat[l.category] = (byCat[l.category] || 0) + (t | 0);
      mapped += (t | 0);
    }
    // Any rounding remainder rides the largest category so the parts always
    // add to Stripe's total exactly.
    const diff = (res.tax_cents | 0) - mapped;
    if (diff !== 0 && Object.keys(byCat).length) {
      const big = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0];
      byCat[big] += diff;
    }
    STX_CACHE.set(tabId, { fp, tax_cents: res.tax_cents | 0, by_cat: byCat, calc_id: res.calc_id });
    return res;
  } catch { STX_CACHE.delete(tabId); return null; }
}

function stxCached(tab) {
  const c = STX_CACHE.get(tab.id);
  if (!c) return null;
  return c.fp === stxFingerprint(tab) ? c : null;
}

/** Fire-and-forget: record the committed sale with Stripe once money lands.
 *  THE SALE IS RECORDED EVEN AFTER A RESTART, AND KEPT (Oct 3 2026; the Sep 13 audit's MEDIUM): the calculation lived only
 *  in memory, so a unit restarted between the order and the payment never recorded the sale with Stripe Tax - nothing in
 *  the log. With no cached answer the tab is calculated again first; the transaction id is written on the tab. */
// ONCE, WHEN THE TAB CLOSES (the review, Oct 3 2026): this ran on every payment, so a tab paid in parts recorded its
// whole calculation once per part - and after a restart the next part asked Stripe for a fresh calculation and recorded
// the whole tab again. A tab still owing records nothing yet; one whose sale is on file records nothing more.
const STX_RECORDING = new Set();
function stxRecordSale(tabId, reference) {
  let stx; try { stx = require('./stripetax'); if (!stx.enabled()) return; } catch { return; }
  try { const t = dbM.db.prepare(`SELECT status, stx_txn_id FROM tabs WHERE id=?`).get(tabId); if (!t || t.status !== 'closed' || t.stx_txn_id) return; } catch { return; }
  if (STX_RECORDING.has(tabId)) return;
  STX_RECORDING.add(tabId);
  setImmediate(async () => {
    try {
      let c = STX_CACHE.get(tabId);
      if (!c || !c.calc_id) { await refreshTabTax(tabId); c = STX_CACHE.get(tabId); }
      if (!c || !c.calc_id) return;   // Stripe gave no answer for these lines (manual rates) - nothing to record there
      const r = await stx.recordSale(c.calc_id, reference);
      if (r && r.id) {
        STX_CACHE.set(tabId, Object.assign({}, STX_CACHE.get(tabId) || c, { txn_id: r.id }));
        try { dbM.db.prepare(`UPDATE tabs SET stx_txn_id=? WHERE id=?`).run(r.id, tabId); } catch {}
      }
    } catch (e) {}
    finally { STX_RECORDING.delete(tabId); }
  });
}

/** Fire-and-forget: reverse recorded tax when money goes back.
 *  CALLED BY THE COUNTER'S REFUND NOW (Oct 3 2026): it existed and nothing called it, so every counter refund at a Stripe
 *  Tax facility left the tax standing in Stripe's filing. Read from the tab when memory has it no more; a sale that was
 *  never recorded there is said in the owner's log, never skipped in silence (rule 29). */
function stxReverse(tabId, reference, partialCents) {
  let stx; try { stx = require('./stripetax'); if (!stx.enabled()) return; } catch { return; }
  const c = STX_CACHE.get(tabId);
  let txn = c && c.txn_id;
  if (!txn) { try { const r = dbM.db.prepare(`SELECT stx_txn_id FROM tabs WHERE id=?`).get(tabId); txn = r && r.stx_txn_id; } catch {} }
  // no record here is not "never recorded" (the review): a sale made before October 2026 kept its record in memory only, and
  // a tab not yet closed has none yet - say what the unit knows, and where to put it right
  if (!txn) { try { dbM.adminLog('STRIPE_TAX', `a refund on tab ${tabId} could not be reversed in Stripe Tax - this unit holds no Stripe Tax record of that sale (a sale before the October 2026 update kept it only until a restart; a tab still open has none yet); adjust it in Stripe's dashboard`); } catch {} return; }
  setImmediate(() => { stx.reverseSale(txn, reference, partialCents).catch(() => {}); });
}

function computeTotals(tab, taxRatesIn) {
  const taxRates = taxRatesIn || (posCfg(require('./config').getConfig()).tax.categories || {});
  const stxHit = stxCached(tab);   // Stripe's answer, only if it matches these exact lines
  let subtotal = 0; const taxByCat = {};
  for (const i of tab.items) {
    const c = lineCents(i);
    subtotal += c;
    const cat = i.tax_category || 'food';
    const rate = Number(taxRates[cat] || 0);
    taxByCat[cat] = (taxByCat[cat] || 0) + Math.round(c * rate / 100);
  }
  let tax = Object.values(taxByCat).reduce((a, b) => a + b, 0);
  if (stxHit) {
    // Stripe computed this exact set of lines: its number is the bill. The
    // per-category split stays proportional so the Z report still breaks out.
    const stripeTax = stxHit.tax_cents | 0;
    const sByCat = stxHit.by_cat || {};
    if (Object.keys(sByCat).length) {
      for (const k of Object.keys(taxByCat)) delete taxByCat[k];
      for (const [k, v] of Object.entries(sByCat)) taxByCat[k] = v | 0;
    } else if (tax > 0) {
      const f = stripeTax / tax; for (const k of Object.keys(taxByCat)) taxByCat[k] = Math.round(taxByCat[k] * f);
    } else if (subtotal > 0) { taxByCat.stripe = stripeTax; }
    tax = stripeTax;
  }
  const paid = tab.payments.reduce((s, p) => s + (p.amount_cents | 0), 0);
  const tips = tab.payments.reduce((s, p) => s + (p.tip_cents | 0), 0);
  return { subtotal_cents: subtotal, tax_cents: tax, tax_by_category: taxByCat,
           total_cents: subtotal + tax, paid_cents: paid, tip_cents: tips,
           due_cents: Math.max(0, subtotal + tax - paid) };
}

// ── ordering: pad → send (commit + print, atomic) ───────────────────────
let ORDER_SEQ = null;
function nextOrderNo() {
  const D = dbM.db;
  if (ORDER_SEQ === null) {
    const r = D.prepare('SELECT MAX(order_no) m FROM tab_items').get();
    ORDER_SEQ = (r && r.m) || 0;
  }
  return ++ORDER_SEQ;
}

function resolveItemMeta(itemRow) {
  const D = dbM.db;
  const cat = D.prepare('SELECT * FROM menu_categories WHERE id=?').get(itemRow.category_id) || {};
  return {
    printer_role: itemRow.printer_role || cat.printer_role || 'kitchen',
    tax_category: itemRow.tax_category || cat.tax_category || 'food'
  };
}

// lines: [{ item_id, qty, choices:[{name,delta_cents}], note }]  (menu items)
//        or { kind:'custom', name, unit_price_cents, tax_category, printer_role }
function sendOrder(tabId, lines, employee) {
  const D = dbM.db;
  const tab = D.prepare('SELECT * FROM tabs WHERE id=?').get(tabId);
  if (!tab) throw new Error('tab not found');
  if (tab.status !== 'open') throw new Error('tab is closed');
  const orderNo = nextOrderNo();
  const committed = [];
  for (const l of lines) {
    let name, unit, meta, kind = 'menu';
    if (l.kind === 'custom') {
      name = String(l.name || 'Item').slice(0, 80);
      unit = l.unit_price_cents | 0;
      meta = { printer_role: l.printer_role || 'kitchen', tax_category: l.tax_category || 'food' };
      kind = 'custom';
    } else {
      const it = D.prepare('SELECT * FROM menu_items WHERE id=?').get(l.item_id);
      if (!it) throw new Error('menu item not found: ' + l.item_id);
      if (it.eighty_sixed) throw new Error(`"${it.name}" is 86'd (out of stock)`);
      if (!it.active) throw new Error(`"${it.name}" is not active`);
      name = it.name; unit = it.price_cents; meta = resolveItemMeta(it);
    }
    // A SPECIAL ON NOW (Oct 22 2026; maintainer: "if they say tuesday special and an ammount off the beer needs to be that
    // ammount off"): the special's price on the unit price, its name on the line - the member perks' own path below
    let specialNote = '', listUnit = unit;
    if (kind === 'menu') {
      try { const sp = require('./specials').priceFor(D.prepare('SELECT * FROM menu_items WHERE id=?').get(l.item_id)); if (sp) { unit = sp.unit_cents; specialNote = sp.reason; } } catch { /* no special - the menu's price */ }
    }
    // MEMBER PERKS. If a member is sitting behind this tab - because their
    // code was typed in at the counter - their food and drink benefits apply
    // to every round they order, not just the first. The discount lands on
    // the unit price so totals, tax, splitting, receipts and the kitchen
    // ticket all keep working untouched; the reason rides along in the note
    // so the guest check shows WHY it is cheaper.
    let memberNote = '';
    try {
      const perks = require('./memberperks').perksForTab(tabId);
      // a member gets the better of their perk and a special on now, never both (the perk is worked from the menu's price)
      const priced = require('./memberperks').priceForMember(listUnit, meta.tax_category, perks);
      if (priced && priced.unit_cents < unit) { unit = priced.unit_cents; memberNote = priced.reason; specialNote = ''; }
    } catch { /* no member behind this tab - list price */ }

    const qty = (typeof l.qty === 'number' && l.qty > 0) ? l.qty : 1;
    const note = [String(l.note || '').slice(0, 100), memberNote, specialNote].filter(Boolean).join(' - ').slice(0, 140);
    // A PACKAGE'S INCLUDED ITEM (Oct 22 2026 - services/packages.js): on a tab of a booking bought as a package,
    // what the package includes rings up at $0, "Included in <package>", until it is used up - past that, as usual. A line of
    // more than are left is two lines: the ones left included, the rest charged
    let parts = [{ qty, unit, note, include: '' }];
    if (kind === 'menu') {
      try {
        const inc = require('./packages').includedFor(tabId, D.prepare('SELECT * FROM menu_items WHERE id=?').get(l.item_id));
        if (inc) {
          // (its choices still charge: their prices ride the line's choices, apart from its unit price - computeTotals)
          const free = Math.min(qty, inc.left);
          const inNote = [String(l.note || '').slice(0, 100), `Included in ${inc.package}`].filter(Boolean).join(' - ').slice(0, 140);
          parts = [{ qty: free, unit: 0, note: inNote, include: inc.key }].concat(qty > free ? [{ qty: qty - free, unit, note, include: '' }] : []);
        }
      } catch { /* not a package booking's tab - as usual */ }
    }
    for (const p of parts) {
      const row = {
        id: uuid(), tab_id: tabId, item_id: l.item_id || null, name,
        qty: p.qty,
        unit_price_cents: p.unit,
        choices_json: JSON.stringify(l.choices || []),
        note: p.note,
        tax_category: meta.tax_category, printer_role: meta.printer_role,
        kind, order_no: orderNo, person: tab.label, sent_by: employee || '', package_include: p.include
      };
      D.prepare(`INSERT INTO tab_items (id,tab_id,item_id,name,qty,unit_price_cents,choices_json,note,
                 tax_category,printer_role,kind,order_no,person,sent_by,package_include)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
       .run(row.id, row.tab_id, row.item_id, row.name, row.qty, row.unit_price_cents,
            row.choices_json, row.note, row.tax_category, row.printer_role, row.kind,
            row.order_no, row.person, row.sent_by, row.package_include);
      committed.push(row);
    }
  }
  // route tickets per printer role — each printer only its own items
  const where = tab.bay_name || (tab.table_label ? ('TABLE ' + tab.table_label) : tab.label);
  const byRole = {};
  for (const r of committed) {
    if (r.kind === 'golf') continue;
    (byRole[r.printer_role] = byRole[r.printer_role] || []).push(r);
  }
  const ticketJobs = [];
  for (const [role, rows] of Object.entries(byRole)) {
    const text = buildOrderTicket(role, where, orderNo, rows, employee);
    const jobIds = printing.enqueueToRole(role, text);
    ticketJobs.push({ role, jobIds, count: rows.length });
  }
  return { order_no: orderNo, items: committed, tickets: ticketJobs, tab: getTab(tabId) };
}

function buildOrderTicket(role, where, orderNo, rows, employee) {
  const W = 42, line = '-'.repeat(W);
  const out = [];
  out.push(center(role.toUpperCase() + ' TICKET', W));
  out.push(line);
  out.push(center('*** ' + String(where || '').toUpperCase() + ' ***', W));
  out.push(line);
  for (const r of rows) {
    out.push(`${qtyStr(r.qty)} ${r.name}`.slice(0, W));
    for (const c of safeJson(r.choices_json, [])) out.push(('   * ' + c.name).slice(0, W));
    if (r.note) out.push(('   * ' + r.note.toUpperCase()).slice(0, W));
    out.push(('   -> ' + r.person).slice(0, W));
  }
  out.push(line);
  out.push(`Order #${orderNo}` + (employee ? ` · sent by ${employee}` : ''));
  out.push(new Date().toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }));
  return out.join('\n') + '\n';
}
function qtyStr(q) { return q === 1 ? '1 ' : (Number.isInteger(q) ? q + ' ' : q + 'x'); }
function center(s, w) { const pad = Math.max(0, Math.floor((w - s.length) / 2)); return ' '.repeat(pad) + s; }

// golf line — check-in integration point (tabs = whole visit)
// (taxCategory: a package's share is taxed the package's way - its golf part as golf, the rest at its counter code; Oct 22 2026)
function addGolfLine(tabId, cents, label, taxCategory) {
  const D = dbM.db;
  const tab = D.prepare('SELECT label FROM tabs WHERE id=?').get(tabId);
  if (!tab) throw new Error('tab not found');
  const id = uuid();
  D.prepare(`INSERT INTO tab_items (id,tab_id,name,qty,unit_price_cents,tax_category,printer_role,kind,person)
             VALUES (?,?,?,1,?,?,NULL,'golf',?)`)
   .run(id, tabId, String(label || 'Golf').slice(0, 80), cents | 0, /^[a-z0-9_-]{1,24}$/.test(String(taxCategory || '')) ? taxCategory : 'sim', tab.label);
  return id;
}

// ── voids & comps: any staff, memo required, daily review ───────────────
// Move a MENU item to another open tab (maintainer, Aug 13: 'split it onto another
// tab'). Golf shares stay put - moving those is the group split's job, and
// letting them wander here would break the group's settlement math. Any
// check allocations on the item are cleared: it lands on the destination
// tab's single implicit check until staff split there again.
function moveItemToTab(tabId, itemId, toTabId, employee) {
  const D = dbM.db;
  if (!toTabId || tabId === toTabId) throw new Error('pick a different tab');
  const item = D.prepare(`SELECT * FROM tab_items WHERE id=? AND tab_id=?`).get(itemId, tabId);
  if (!item) throw new Error('item not found on this tab');
  if (item.status === 'voided') throw new Error('item is voided');
  if (item.kind === 'golf') throw new Error('golf shares move in the group split, not here');
  const from = D.prepare(`SELECT * FROM tabs WHERE id=? AND status='open'`).get(tabId);
  const to   = D.prepare(`SELECT * FROM tabs WHERE id=? AND status='open'`).get(toTabId);
  if (!from || !to) throw new Error('both tabs must be open');
  D.prepare(`UPDATE tab_items SET tab_id=? WHERE id=?`).run(toTabId, itemId);
  try { D.prepare(`DELETE FROM item_allocations WHERE item_id=?`).run(itemId); } catch (e) {}
  try { dbM.adminLog('ITEM_MOVED', item.name + ' | ' + from.label + ' -> ' + to.label + ' | by ' + (employee || '?')); } catch (e) {}
  dbM.flushed().catch(() => {});   // written now, never freezing the unit (see bookingledger)
  return { from: getTab(tabId), to: getTab(toTabId) };
}

function voidItem(tabItemId, { comp, reason, employee }) {
  const D = dbM.db;
  const row = D.prepare('SELECT * FROM tab_items WHERE id=?').get(tabItemId);
  if (!row) throw new Error('item not found');
  if (row.status === 'voided') throw new Error('already voided');
  if (!reason || !String(reason).trim()) throw new Error('a reason memo is required');
  if (comp) {
    D.prepare(`UPDATE tab_items SET comp=1, void_reason=?, void_by=?, void_at=datetime('now') WHERE id=?`)
     .run(String(reason).slice(0, 140), employee || '', tabItemId);
  } else {
    D.prepare(`UPDATE tab_items SET status='voided', void_reason=?, void_by=?, void_at=datetime('now') WHERE id=?`)
     .run(String(reason).slice(0, 140), employee || '', tabItemId);
    // fire a VOID ticket so the kitchen stops cooking it
    if (row.printer_role) {
      const W = 42;
      const txt = [center('*** VOID ***', W), '-'.repeat(W),
        `${qtyStr(row.qty)} ${row.name}`, ('   -> ' + row.person), '-'.repeat(W),
        `by ${employee || 'staff'} · ${String(reason).slice(0, 30)}`].join('\n') + '\n';
      try { printing.enqueueToRole(row.printer_role, txt); } catch (_) {}
    }
  }
  return D.prepare('SELECT * FROM tab_items WHERE id=?').get(tabItemId);
}

/**
 * VOID A WHOLE CHECK. Staff mistake recovery: a tab opened on the wrong
 * person, a duplicate, an order rung on the wrong table.
 *
 * It voids every line (so the kitchen gets VOID tickets for anything already
 * fired), closes the tab, and lands on the OWNER'S DAILY REVIEW exactly like
 * a single voided item - staff can fix their own mistake immediately, and the
 * owner sees every one of them afterwards with a name and a reason attached.
 *
 * A tab with money already taken is REFUSED. That is a refund, not a void,
 * and quietly erasing a paid check would hide real money.
 */
function voidTab(tabId, { reason, employee }) {
  const D = dbM.db;
  const tab = getTab(tabId);
  if (!tab) throw new Error('tab not found');
  if (tab.status !== 'open') throw new Error('that tab is already closed');
  if (!reason || !String(reason).trim()) throw new Error('a reason is required');
  const paid = (tab.payments || []).reduce((n, p) => n + (p.amount_cents | 0), 0);
  if (paid > 0) {
    throw new Error('This check already has a payment on it. Refund it instead - voiding would hide money that was taken.');
  }
  const live = (tab.items || []).filter(i => i.status !== 'voided');
  for (const it of live) {
    try { voidItem(it.id, { comp: false, reason: `Check voided: ${reason}`, employee }); } catch (_) {}
  }
  D.prepare(`UPDATE tabs SET status='voided', closed_at=datetime('now') WHERE id=?`).run(tabId);
  try { dbM.adminLog('CHECK_VOIDED', `${tab.label} - ${live.length} item(s) - ${employee || 'staff'} - ${String(reason).slice(0, 80)}`); } catch {}
  return { ok: true, label: tab.label, items_voided: live.length };
}

// ── tab lifecycle: delete a mistake, see and reopen the settled ─────────
// maintainer, Aug 13: "we need to be able to remove tabs if they get created on
// accident" and a settled tab must stay visible and reopenable.

// DELETE — mistake recovery for a tab NOTHING ever happened on. A tab with
// items is a VOID (built, lands on the owner's review); a tab with a payment
// is a refund. Delete is only for the mis-typed shell, so the guards are the
// feature: open, standalone (a booking seat's tab is created by check-in and
// is part of the group model), zero items ever, zero payments.
function deleteTab(tabId, { employee }) {
  const D = dbM.db;
  const tab = D.prepare(`SELECT * FROM tabs WHERE id=?`).get(tabId);
  if (!tab) throw new Error('tab not found');
  if (tab.status !== 'open') throw new Error('only an open tab can be deleted');
  if (tab.booking_id) throw new Error('this tab belongs to a booking seat - it cannot be deleted');
  const items = D.prepare(`SELECT COUNT(*) n FROM tab_items WHERE tab_id=?`).get(tabId).n;
  if (items > 0) throw new Error('this tab has items on it - void the check instead');
  const pays = D.prepare(`SELECT COUNT(*) n FROM tab_payments WHERE tab_id=?`).get(tabId).n;
  if (pays > 0) throw new Error('this tab has a payment on it - it cannot be deleted');
  try { D.prepare(`DELETE FROM tab_checks WHERE tab_id=?`).run(tabId); } catch {}
  D.prepare(`DELETE FROM tabs WHERE id=?`).run(tabId);
  try { dbM.adminLog('TAB_DELETED', `${tab.label} - empty tab removed - ${employee || 'staff'}`); } catch {}
  return { ok: true, label: tab.label };
}

// REOPEN — a settled tab comes back to Open Tabs. Payments already taken
// stay on record (EOD counts tab_payments by date, so the day's numbers do
// not move); the tab simply gets a live balance again so more items can be
// added. Voided tabs stay voided - they live on the owner's review.
function reopenTab(tabId, { employee }) {
  const D = dbM.db;
  const tab = D.prepare(`SELECT * FROM tabs WHERE id=?`).get(tabId);
  if (!tab) throw new Error('tab not found');
  if (tab.status === 'open') throw new Error('that tab is already open');
  if (tab.status !== 'closed') throw new Error('a voided check cannot be reopened');
  D.prepare(`UPDATE tabs SET status='open', closed_by=NULL, closed_at=NULL WHERE id=?`).run(tabId);
  try { dbM.adminLog('TAB_REOPENED', `${tab.label} - ${employee || 'staff'}`); } catch {}
  return getTab(tabId);
}

// THE COUNTER'S DAY IS THE FACILITY'S DAY (Oct 2026, from pilot facility's 09-27 addendum). Every counter time is
// stored in UTC, and these reports used to pick a day with date(timestamp) = the day - a UTC day, so from
// 7 PM Central every sale, payment, tip, void, refund and drawer opening landed on TOMORROW's End of Day,
// expected cash missed the evening's cash, and "Paid today" dropped the day's tabs once the UTC date
// turned. A day is now the facility's own: rows are fetched in a UTC window a day wider each side and kept
// when their LOCAL date (services/revenue.js localDate - the one definition revenue already uses) is the
// day asked for; "today" with no date is the facility's today. test-facility-day.
function dayOf(ts) { const r = require('./revenue'); return r.localDate(ts, r.tzOf()); }
function facilityToday() { return require('./revenue').facilityToday(); }
function rowsOnDay(sql, col, d, ...pre) {
  const [u0, u1] = require('./revenue').utcWindow(d, d);
  return dbM.db.prepare(sql).all(...pre, u0, u1).filter(r => dayOf(r[col]) === d);
}

// PAID LIST — settled tabs for one business day, with enough to render the
// row: what was collected, how, who closed it and when.
function listClosedTabs(date) {
  const d = date || facilityToday();
  const tabs = rowsOnDay(`SELECT * FROM tabs WHERE status='closed' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC`, 'closed_at', d);
  return tabs.map(t => {
    const full = getTab(t.id);
    const methods = [...new Set((full.payments || []).map(p => p.method))];
    return Object.assign(full, { methods });
  });
}

function reviewList(date) {
  const d = date || facilityToday();
  return rowsOnDay(`SELECT ti.*, t.label tab_label, t.bay_name FROM tab_items ti
    JOIN tabs t ON t.id = ti.tab_id
    WHERE (ti.status='voided' OR ti.comp=1) AND ti.void_at >= ? AND ti.void_at < ?
    ORDER BY ti.void_at`, 'void_at', d);
}

function checkReview(tabItemId, reviewer) {
  const D = dbM.db;
  D.prepare(`UPDATE tab_items SET reviewed=1, reviewed_by=?, reviewed_at=datetime('now')
    WHERE id=? AND (status='voided' OR comp=1)`).run(reviewer || 'owner', tabItemId);
  const row = D.prepare('SELECT reviewed FROM tab_items WHERE id=?').get(tabItemId);
  return !!row && row.reviewed === 1;
}

// ── payments ─────────────────────────────────────────────────────────────
// a plain whole number of cents from 0 to $1,000,000, or null
function centsOrNull(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isSafeInteger(n) && n >= 0 && n <= 100000000 ? n : null;
}

function recordPayment(tabId, { method, amount_cents, tip_cents, tendered_cents, memo, stripe_pi, employee, check_id }) {
  const D = dbM.db;
  const tab = getTab(tabId);
  if (!tab) throw new Error('tab not found');
  if (tab.status !== 'open') throw new Error('tab is closed');
  const cfg = posCfg(require('./config').getConfig());
  if (method === 'cash' && !cfg.payments.cash) throw new Error('cash payments are not enabled for this facility');
  if (method === 'check' && !cfg.payments.check) throw new Error('check payments are not enabled for this facility');
  // A WHOLE NUMBER OF CENTS, NEVER WRAPPED (Oct 3 2026; pilot facility's handoff section 2): `| 0` turned 4294967396 into 100
  // and recorded a mistyped amount as $1.00. An amount that is not a plain count of cents up to $1,000,000 is refused.
  const amt = centsOrNull(amount_cents);
  if (amt === null || amt <= 0) throw new Error('amount must be a positive number of cents');
  if (tip_cents != null && tip_cents !== '' && centsOrNull(tip_cents) === null) throw new Error('tip must be a number of cents');
  const tip = tip_cents == null || tip_cents === '' ? 0 : centsOrNull(tip_cents);
  let change = null;
  if (method === 'cash') {
    // THE CASH HANDED OVER COVERS THE BILL AND THE TIP (the review, Oct 3 2026): the pad asks for both and End of Day
    // expects both in the drawer, but the change was worked out from the bill alone - a $2 tip on $18 paid with a $20
    // showed "Change due: $2.00" and the tip went back across the counter.
    const tend = centsOrNull(tendered_cents);
    if (tend === null) throw new Error('tendered must be a number of cents');
    if (tend < amt + tip) throw new Error(tip ? 'tendered is less than the amount and the tip' : 'tendered is less than amount');
    change = tend - amt - tip;
  }
  const id = uuid();
  D.prepare(`INSERT INTO tab_payments (id,tab_id,method,amount_cents,tip_cents,tendered_cents,change_cents,memo,stripe_pi,employee,check_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
   .run(id, tabId, method, amt, tip_cents | 0, method === 'cash' ? (tendered_cents | 0) : null,
        change, String(memo || '').slice(0, 80), stripe_pi || '', employee || '', check_id || null);
  const events = [];
  if (method === 'cash' && cfg.drawer.enabled) {
    events.push(openDrawer({ employee, reason: 'cash sale', txn_id: id }));
  }
  const after = getTab(tabId);
  let closed = false;
  if (after.due_cents === 0) { closeTab(tabId, employee); closed = true; }
  return { payment_id: id, change_cents: change, drawer: events[0] || null, closed, tab: getTab(tabId) };
}

// Merge src tab INTO dst: items and payments move (totals follow), src closes
// with a merge stamp. Both must be open; self-merge refuses.
function mergeTabs(srcId, dstId, employee) {
  const D = dbM.db;
  if (srcId === dstId) throw new Error('cannot merge a tab into itself');
  const src = D.prepare('SELECT * FROM tabs WHERE id=?').get(srcId);
  const dst = D.prepare('SELECT * FROM tabs WHERE id=?').get(dstId);
  if (!src || !dst) throw new Error('tab not found');
  if (src.status !== 'open' || dst.status !== 'open') throw new Error('both tabs must be open to merge');
  // A SPLIT TAB'S CHECKS COME WITH IT (Oct 3 2026; pilot facility's handoff section 2): items and payments moved by tab, but their
  // check allocations and the payments' check_id still pointed at the SOURCE tab's checks - on the merged tab those
  // items and part payments were in no check, so the split screen's amounts no longer added up. The checks move too,
  // named for the tab they came from; the destination's own items get their own check first if it was never split.
  let srcChecks = [];
  try { srcChecks = D.prepare('SELECT id FROM tab_checks WHERE tab_id=?').all(srcId); } catch {}
  if (srcChecks.length) {
    try { if (D.prepare(`SELECT COUNT(*) c FROM tab_items WHERE tab_id=? AND status != 'voided'`).get(dstId).c > 0) require('./checks').ensureDefaultCheck(dstId); } catch {}
  }
  D.prepare('UPDATE tab_items SET tab_id=? WHERE tab_id=?').run(dstId, srcId);
  D.prepare('UPDATE tab_payments SET tab_id=? WHERE tab_id=?').run(dstId, srcId);
  if (srcChecks.length) D.prepare(`UPDATE tab_checks SET tab_id=?, position=position+100, label=? || ' - ' || label WHERE tab_id=?`).run(dstId, String(src.label || 'Merged').slice(0, 30), srcId);
  D.prepare(`UPDATE tabs SET status='closed', closed_by=?, closed_at=datetime('now') WHERE id=?`)
   .run('merge:' + String(employee || '').slice(0, 34), srcId);
  try { dbM.adminLog('TABS_MERGED', `"${src.label}" -> "${dst.label}" (${String(employee || 'Staff').slice(0, 40)})`); } catch {}
  return { merged: true, from: { id: src.id, label: src.label }, tab: getTab(dstId) };
}

function closeTab(tabId, employee) {
  dbM.db.prepare(`UPDATE tabs SET status='closed', closed_by=?, closed_at=datetime('now') WHERE id=? AND status='open'`)
   .run(employee || '', tabId);
}

// ── drawer: printer-kick via CloudPRNT X-Star-CashDrawer header ─────────
function openDrawer({ employee, reason, txn_id }) {
  const D = dbM.db;
  const id = uuid();
  D.prepare('INSERT INTO drawer_events (id, employee, reason, txn_id) VALUES (?,?,?,?)')
   .run(id, employee || '', reason || 'manual', txn_id || '');
  // enqueue a zero-content job flagged drawer=1 to the counter printer;
  // the CloudPRNT GET response for a flagged job carries X-Star-CashDrawer: start
  let jobIds = [];
  try { jobIds = printing.enqueueToRole('counter', '\n', { drawer: 1 }); } catch (_) {}
  return { event_id: id, jobIds };
}

// ── EOD ──────────────────────────────────────────────────────────────────
function expectedCash(date, openingFloatCents) {
  const d = date || facilityToday();
  const cashIn = r => (r.amount_cents | 0) + (r.tip_cents | 0);
  const sales = rowsOnDay(`SELECT amount_cents, tip_cents, created_at FROM tab_payments WHERE method='cash' AND created_at >= ? AND created_at < ?`, 'created_at', d)
    .reduce((s, r) => s + cashIn(r), 0);
  // cash handed back at the counter came out of this drawer (Sep 24 2026)
  let back = 0;
  try { back = rowsOnDay(`SELECT amount_cents, tip_cents, at FROM tab_refunds WHERE method='cash' AND status IN ('succeeded','pending') AND at >= ? AND at < ?`, 'at', d)
    .reduce((s, r) => s + cashIn(r), 0); } catch (e) { back = 0; }
  return (openingFloatCents | 0) + sales - back;
}

function eodSummary(date) {
  const d = date || facilityToday();
  const cfg = posCfg(require('./config').getConfig());
  const items = rowsOnDay(`SELECT ti.* FROM tab_items ti WHERE ti.sent_at >= ? AND ti.sent_at < ?`, 'sent_at', d);
  const salesByCat = {}, taxByCat = {};
  const rates = cfg.tax.categories || {};
  for (const i of items) {
    const c = lineCents(i);
    const cat = i.tax_category || 'food';
    salesByCat[cat] = (salesByCat[cat] || 0) + c;
    taxByCat[cat] = (taxByCat[cat] || 0) + Math.round(c * Number(rates[cat] || 0) / 100);
  }
  // the same shapes the SQL GROUP BYs gave (method a/t/n, employee t), added up in the facility's day
  const payRows = rowsOnDay(`SELECT method, amount_cents, tip_cents, employee, created_at FROM tab_payments WHERE created_at >= ? AND created_at < ?`, 'created_at', d);
  const byMethod = {}, byEmp = {};
  for (const p of payRows) {
    const m = byMethod[p.method] || (byMethod[p.method] = { method: p.method, a: 0, t: 0, n: 0 });
    m.a += p.amount_cents | 0; m.t += p.tip_cents | 0; m.n++;
    if ((p.tip_cents | 0) > 0) { const k = p.employee == null ? '' : p.employee; byEmp[k] = (byEmp[k] || 0) + (p.tip_cents | 0); }
  }
  const pays = Object.keys(byMethod).sort().map(k => byMethod[k]);
  const tipsByEmp = Object.keys(byEmp).sort().map(k => ({ employee: k, t: byEmp[k] }));
  const compsVoids = reviewList(d);
  let refunds = [];
  try { refunds = require('./refunds').reviewList(d); } catch (e) { refunds = []; }
  const drawer = rowsOnDay(`SELECT * FROM drawer_events WHERE at >= ? AND at < ? ORDER BY at`, 'at', d);
  return {
    date: d,
    sales_by_category: salesByCat,
    tax_by_category: taxByCat,
    payments: pays,
    tips: { by_employee: tipsByEmp, shift_total: tipsByEmp.reduce((s, r) => s + r.t, 0), mode: cfg.tips.mode },
    comps_voids: { count: compsVoids.length, unreviewed: compsVoids.filter(r => !r.reviewed).length, rows: compsVoids },
    // money given back today, by how (Sep 24 2026) - cash is already out of expected_cash_cents
    refunds: { rows: refunds, by_method: refunds.filter(r => ['succeeded', 'pending'].includes(r.status)).reduce((m, r) => { m[r.method] = (m[r.method] || 0) + (r.amount_cents | 0) + (r.tip_cents | 0); return m; }, {}) },
    drawer_events: drawer,
    expected_cash_cents: expectedCash(d, cfg.openingFloatCents),
    opening_float_cents: cfg.openingFloatCents
  };
}

function closeDay({ date, counted_cents, counted_by }) {
  const D = dbM.db;
  const d = date || facilityToday();
  const summary = eodSummary(d);
  const over_short = (counted_cents | 0) - summary.expected_cash_cents;
  const id = uuid();
  D.prepare(`INSERT INTO eod_reports (id, date, opening_float_cents, expected_cash_cents, counted_cents, over_short_cents, counted_by, data_json)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET counted_cents=excluded.counted_cents,
      over_short_cents=excluded.over_short_cents, counted_by=excluded.counted_by, data_json=excluded.data_json,
      expected_cash_cents=excluded.expected_cash_cents, opening_float_cents=excluded.opening_float_cents`)
   .run(id, d, summary.opening_float_cents, summary.expected_cash_cents,
        counted_cents | 0, over_short, counted_by || '', JSON.stringify(summary));
  // a second close of the same day used to keep the FIRST close's expected cash beside the new count and over/short, so
  // the End of Day screen read "expected $100, counted $150, over/short $0" (Oct 19 2026, the pack review)
  return { date: d, expected_cash_cents: summary.expected_cash_cents,
           counted_cents: counted_cents | 0, over_short_cents: over_short, summary };
}

module.exports = {
  refreshTabTax, stxRecordSale, stxReverse,
  ensureSchema, posCfg,
  getMenu, upsertCategory, upsertItem, setEightySix,
  openTab, getTab, listOpenTabs,
  sendOrder, addGolfLine, computeTotals, lineCents,
  voidItem, voidTab, reviewList, checkReview,
  deleteTab, reopenTab, listClosedTabs,
  recordPayment, closeTab, openDrawer,
  eodSummary, closeDay, expectedCash, rekeyEveningCloses,
  getTaxCodes, setTaxCodes,
  deleteChoiceGroup, deleteChoice, deleteItem, deleteCategory,
  mergeTabs,
  moveItemToTab };
