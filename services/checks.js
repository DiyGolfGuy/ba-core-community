// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/checks.js — SPLITTING CHECKS AT THE COUNTER (maintainer, Aug 11).
//
// "We want to be able to split checks and split an app between different
//  checks evenly."
//
// This is the counter-side split. It is NOT the per-golfer split checkout that
// was ruled out forever - that was customers dividing a BAY BOOKING among
// themselves online. maintainer's words then were "the counter is the split engine",
// and this is that engine.
//
// THE MODEL
//   A tab has one or more CHECKS. Every item line is ALLOCATED to checks by
//   weight: one row at weight 1 means "all of it on this check"; four rows at
//   weight 1 means "split evenly four ways". Moving an item re-points its
//   allocation; sharing an item adds rows.
//
// THE INVARIANT THAT MATTERS
//   The check totals must add up to the tab total EXACTLY, to the penny,
//   always - otherwise the till never reconciles and staff lose trust in it.
//   A third of $10.00 is $3.33 three times, which is a penny short, so the
//   odd cents are handed out by LARGEST REMAINDER: the shares closest to
//   rounding up get them. Tax is allocated the same way, per category.
'use strict';

const dbM = require('./db');
const pos = require('./pos');

function D() { return dbM.db; }
const uuid = () => 'chk_' + Math.random().toString(36).slice(2, 12);

function ensureSchema() {
  D().exec(`CREATE TABLE IF NOT EXISTS tab_checks (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL,
    label TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')))`);
  D().exec(`CREATE TABLE IF NOT EXISTS item_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    check_id TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    UNIQUE (item_id, check_id))`);
  // Payments gain a check so a receipt belongs to the right person.
  try {
    const cols = D().prepare(`PRAGMA table_info(tab_payments)`).all().map(c => c.name);
    if (!cols.includes('check_id')) D().exec(`ALTER TABLE tab_payments ADD COLUMN check_id TEXT`);
  } catch {}
}

/**
 * Largest-remainder split of `total` cents across `weights`. Sums EXACTLY.
 *
 * `running` (optional) is each check's subtotal so far. Ties for the leftover
 * pennies go to whoever is currently BEHIND. Without this the extra penny on
 * every indivisible line lands on the first checks, so across a few items the
 * same person systematically pays more - a three-cent gap on an even split,
 * which is exactly the kind of thing a customer notices and staff cannot
 * explain.
 */
function allocateCents(total, weights, running = null) {
  const W = weights.reduce((a, b) => a + b, 0);
  if (!W) return weights.map(() => 0);
  const exact = weights.map(w => (total * w) / W);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v), behind: running ? running[i] : 0 }))
    .sort((a, b) => (b.frac - a.frac) || (a.behind - b.behind) || (a.i - b.i));
  const out = floors.slice();
  for (let k = 0; k < order.length && left > 0; k++) { out[order[k].i] += 1; left--; }
  return out;
}

function listChecks(tabId) {
  ensureSchema();
  return D().prepare(`SELECT * FROM tab_checks WHERE tab_id = ? ORDER BY position ASC, created_at ASC`).all(tabId);
}

/** Every tab implicitly has one check until it is split. */
function ensureDefaultCheck(tabId) {
  ensureSchema();
  let checks = listChecks(tabId);
  if (checks.length) return checks;
  const id = uuid();
  D().prepare(`INSERT INTO tab_checks (id, tab_id, label, position) VALUES (?,?,?,0)`).run(id, tabId, 'Check 1');
  // everything currently on the tab belongs to it
  for (const it of D().prepare(`SELECT id FROM tab_items WHERE tab_id = ? AND status != 'voided'`).all(tabId)) {
    D().prepare(`INSERT OR IGNORE INTO item_allocations (item_id, check_id, weight) VALUES (?,?,1)`).run(it.id, id);
  }
  return listChecks(tabId);
}

/** New items land on the first open check automatically. */
function attachNewItems(tabId) {
  ensureSchema();
  const checks = ensureDefaultCheck(tabId);
  const target = checks.find(c => c.status === 'open') || checks[0];
  const rows = D().prepare(
    `SELECT i.id FROM tab_items i
      WHERE i.tab_id = ? AND i.status != 'voided'
        AND NOT EXISTS (SELECT 1 FROM item_allocations a WHERE a.item_id = i.id)`
  ).all(tabId);
  for (const r of rows) {
    D().prepare(`INSERT OR IGNORE INTO item_allocations (item_id, check_id, weight) VALUES (?,?,1)`).run(r.id, target.id);
  }
  return rows.length;
}

/** Split a tab into n checks (items stay on the first until moved). */
function splitTab(tabId, n, labels = null) {
  ensureSchema();
  const count = parseInt(n, 10);
  if (!Number.isInteger(count) || count < 2 || count > 12) throw new Error('Split between 2 and 12 checks');
  ensureDefaultCheck(tabId);
  const existing = listChecks(tabId);
  for (let i = existing.length; i < count; i++) {
    D().prepare(`INSERT INTO tab_checks (id, tab_id, label, position) VALUES (?,?,?,?)`)
      .run(uuid(), tabId, (labels && labels[i]) || `Check ${i + 1}`, i);
  }
  try { dbM.adminLog('CHECK_SPLIT', `Tab ${tabId} split into ${count}`); } catch {}
  return listChecks(tabId);
}

function addCheck(tabId, label) {
  ensureSchema();
  ensureDefaultCheck(tabId);
  const pos_ = listChecks(tabId).length;
  const id = uuid();
  D().prepare(`INSERT INTO tab_checks (id, tab_id, label, position) VALUES (?,?,?,?)`)
    .run(id, tabId, String(label || `Check ${pos_ + 1}`).slice(0, 40), pos_);
  return listChecks(tabId);
}

/** Remove a check; its items fall back to the first remaining check. */
function removeCheck(tabId, checkId) {
  ensureSchema();
  const checks = listChecks(tabId);
  if (checks.length <= 1) throw new Error('A tab must keep at least one check');
  const target = checks.find(c => c.id !== checkId);
  const paid = D().prepare(`SELECT COUNT(*) c FROM tab_payments WHERE check_id = ?`).get(checkId);
  if (paid && paid.c) throw new Error('That check already has a payment on it');
  // move allocations, merging weights if the item is already on the target
  for (const a of D().prepare(`SELECT * FROM item_allocations WHERE check_id = ?`).all(checkId)) {
    const dup = D().prepare(`SELECT * FROM item_allocations WHERE item_id=? AND check_id=?`).get(a.item_id, target.id);
    if (dup) D().prepare(`UPDATE item_allocations SET weight = weight + ? WHERE id = ?`).run(a.weight, dup.id);
    else D().prepare(`UPDATE item_allocations SET check_id = ? WHERE id = ?`).run(target.id, a.id);
  }
  D().prepare(`DELETE FROM item_allocations WHERE check_id = ?`).run(checkId);
  D().prepare(`DELETE FROM tab_checks WHERE id = ?`).run(checkId);
  return listChecks(tabId);
}

/** Move a whole line to one check (undoes any sharing). */
function moveItem(tabId, itemId, checkId) {
  ensureSchema();
  const chk = D().prepare(`SELECT * FROM tab_checks WHERE id=? AND tab_id=?`).get(checkId, tabId);
  if (!chk) throw new Error('Unknown check');
  D().prepare(`DELETE FROM item_allocations WHERE item_id = ?`).run(itemId);
  D().prepare(`INSERT INTO item_allocations (item_id, check_id, weight) VALUES (?,?,1)`).run(itemId, checkId);
  return true;
}

/** Share one line evenly across several checks - the shared appetizer. */
function shareItem(tabId, itemId, checkIds) {
  ensureSchema();
  const ids = [...new Set(checkIds || [])];
  if (ids.length < 2) throw new Error('Pick at least two checks to share across');
  for (const id of ids) {
    if (!D().prepare(`SELECT 1 FROM tab_checks WHERE id=? AND tab_id=?`).get(id, tabId)) throw new Error('Unknown check');
  }
  D().prepare(`DELETE FROM item_allocations WHERE item_id = ?`).run(itemId);
  for (const id of ids) {
    D().prepare(`INSERT INTO item_allocations (item_id, check_id, weight) VALUES (?,?,1)`).run(itemId, id);
  }
  try { dbM.adminLog('CHECK_ITEM_SHARED', `Item ${itemId} across ${ids.length} checks`); } catch {}
  return true;
}

/** Split EVERY line evenly across all checks - "just split it down the middle". */
function shareAllEvenly(tabId) {
  ensureSchema();
  const checks = listChecks(tabId);
  if (checks.length < 2) throw new Error('Split the tab into checks first');
  const items = D().prepare(`SELECT id FROM tab_items WHERE tab_id=? AND status!='voided'`).all(tabId);
  D().prepare(`DELETE FROM item_allocations WHERE item_id IN (SELECT id FROM tab_items WHERE tab_id=?)`).run(tabId);
  for (const it of items) {
    for (const c of checks) {
      D().prepare(`INSERT INTO item_allocations (item_id, check_id, weight) VALUES (?,?,1)`).run(it.id, c.id);
    }
  }
  return true;
}

/**
 * Per-check money. Guarantees the checks sum to the tab, exactly.
 */
function checkTotals(tabId) {
  ensureSchema();
  ensureDefaultCheck(tabId);
  attachNewItems(tabId);
  const tab = pos.getTab(tabId);
  const checks = listChecks(tabId);
  const idx = new Map(checks.map((c, i) => [c.id, i]));

  const sub = checks.map(() => 0);
  const byCat = checks.map(() => ({}));
  const lines = checks.map(() => []);

  for (const item of (tab.items || [])) {
    if (item.status === 'voided') continue;
    const allocs = D().prepare(`SELECT * FROM item_allocations WHERE item_id = ?`).all(item.id);
    if (!allocs.length) continue;
    const cents = lineCents(item);
    const runningForItem = allocs.map(a => {
      const i = idx.get(a.check_id);
      return i === undefined ? Number.MAX_SAFE_INTEGER : sub[i];
    });
    const shares = allocateCents(cents, allocs.map(a => a.weight), runningForItem);
    allocs.forEach((a, k) => {
      const i = idx.get(a.check_id);
      if (i === undefined) return;
      sub[i] += shares[k];
      const cat = item.tax_category || 'food';
      byCat[i][cat] = (byCat[i][cat] || 0) + shares[k];
      lines[i].push({ item_id: item.id, name: item.name, qty: item.qty,
                      shared: allocs.length > 1, share_of: allocs.length,
                      amount_cents: shares[k] });
    });
  }

  // Allocate the TAB's tax per category across checks by their share of that
  // category, so per-check tax always adds back to the tab's tax exactly.
  const tabTotals = pos.computeTotals(tab);
  const taxOut = checks.map(() => 0);
  for (const [cat, catTax] of Object.entries(tabTotals.tax_by_category || {})) {
    const weights = byCat.map(m => m[cat] || 0);
    if (!weights.some(w => w > 0)) continue;
    const parts = allocateCents(catTax, weights);
    parts.forEach((p, i) => { taxOut[i] += p; });
  }

  const payments = D().prepare(`SELECT * FROM tab_payments WHERE tab_id = ?`).all(tabId);
  const out = checks.map((c, i) => {
    const paid = payments.filter(p => p.check_id === c.id)
                         .reduce((s, p) => s + (p.amount_cents | 0), 0);
    const tips = payments.filter(p => p.check_id === c.id)
                         .reduce((s, p) => s + (p.tip_cents | 0), 0);
    const total = sub[i] + taxOut[i];
    return { id: c.id, label: c.label, status: c.status,
             lines: lines[i], subtotal_cents: sub[i], tax_cents: taxOut[i],
             total_cents: total, paid_cents: paid, tip_cents: tips,
             due_cents: Math.max(0, total - paid) };
  });

  // Unassigned payments (taken before the tab was split) belong to the tab.
  const loose = payments.filter(p => !p.check_id).reduce((s, p) => s + (p.amount_cents | 0), 0);
  return {
    checks: out,
    tab_total_cents: tabTotals.total_cents,
    checks_total_cents: out.reduce((s, c) => s + c.total_cents, 0),
    unassigned_paid_cents: loose,
    reconciles: out.reduce((s, c) => s + c.total_cents, 0) === tabTotals.total_cents
  };
}

// One implementation of what a line costs - pos.lineCents. A second copy
// here had already drifted (it missed the `choices` fallback), which would
// have valued a line with a paid add-on differently on a split check.
const lineCents = (i) => pos.lineCents(i);

// NOTE (Aug 14): splits move lines BETWEEN checks on one tab - the tab-level
// line set is identical, so the Stripe tax fingerprint still matches and no
// recalculation is needed here. Only add/void/comp/move change it.
module.exports = {
  ensureSchema, allocateCents, listChecks, ensureDefaultCheck, attachNewItems,
  splitTab, addCheck, removeCheck, moveItem, shareItem, shareAllEvenly, checkTotals
};


// ═══════════════════════════════════════════════════════════════════════════
//  ACROSS TABS - the model production actually uses for a GROUP.
//
//  VERIFIED IN THE CODE (not assumed): every seat already has its OWN tab.
//  services/checkin.groupView reads the `seats` table, each row carrying a
//  tab_id and golf_cents, and the staff group screen opens s.tab_id per
//  person. So a group is ALREADY split by person at check-in - what was
//  missing is moving one line to a different person, and sharing one line
//  (the table appetizer, or golf time) across several people.
//
//  HOW SHARING WORKS: the line is replaced by one real line per person, each
//  holding that person's exact share. That means every existing path -
//  totals, tax, receipts, payments, the kitchen ticket - keeps working with
//  no parallel money model layered on top. The shares are allocated by
//  largest remainder so they add back to the original price exactly.
// ═══════════════════════════════════════════════════════════════════════════

function ensureShareColumn() {
  try {
    const cols = D().prepare(`PRAGMA table_info(tab_items)`).all().map(c => c.name);
    if (!cols.includes('share_group')) D().exec(`ALTER TABLE tab_items ADD COLUMN share_group TEXT`);
  } catch {}
}

/** Move one line to another person's tab. */
function moveItemToTab(itemId, destTabId, employee) {
  ensureShareColumn();
  const item = D().prepare(`SELECT * FROM tab_items WHERE id = ?`).get(itemId);
  if (!item) throw new Error('item not found');
  if (item.status === 'voided') throw new Error('that item was voided');
  const dest = D().prepare(`SELECT * FROM tabs WHERE id = ?`).get(destTabId);
  if (!dest) throw new Error('unknown tab');
  if (dest.status !== 'open') throw new Error('that tab is already closed');
  if (item.tab_id === destTabId) return { ok: true, unchanged: true };
  D().prepare(`UPDATE tab_items SET tab_id = ?, person = ? WHERE id = ?`)
    .run(destTabId, dest.label || '', itemId);
  try { dbM.adminLog('ITEM_MOVED', `${item.name} -> ${dest.label} (${employee || 'staff'})`); } catch {}
  return { ok: true, moved_to: destTabId };
}

/**
 * Share one line across several people's tabs, evenly.
 * The original line is replaced by one line per tab holding that person's
 * exact share; the shares sum to the original price to the penny.
 */
function shareItemAcrossTabs(itemId, tabIds, employee, discountPcts) {
  ensureShareColumn();
  const item = D().prepare(`SELECT * FROM tab_items WHERE id = ?`).get(itemId);
  if (!item) throw new Error('item not found');
  if (item.status === 'voided') throw new Error('that item was voided');
  const ids = [...new Set(tabIds || [])];
  if (ids.length < 2) throw new Error('Pick at least two people to share across');
  const tabs = ids.map(id => {
    const t = D().prepare(`SELECT * FROM tabs WHERE id = ?`).get(id);
    if (!t) throw new Error('unknown tab');
    if (t.status !== 'open') throw new Error(`${t.label} is already closed`);
    return t;
  });

  const total = pos.lineCents(item);
  let shares = allocateCents(total, tabs.map(() => 1));
  // Optional per-person discount (a member's share of golf time carries their
  // tier rate). The shares deliberately no longer sum to the list price -
  // members pay less, which is the point.
  let saved = 0;
  if (Array.isArray(discountPcts) && discountPcts.length === tabs.length) {
    shares = shares.map((c, i) => {
      const pct = Math.max(0, Math.min(100, Number(discountPcts[i]) || 0));
      const off = Math.round(c * pct / 100);
      saved += off;
      return c - off;
    });
  }
  const group = 'shr_' + Math.random().toString(36).slice(2, 10);

  // The original line goes; per-person lines take its place.
  D().prepare(`DELETE FROM tab_items WHERE id = ?`).run(itemId);
  D().prepare(`DELETE FROM item_allocations WHERE item_id = ?`).run(itemId);

  const made = [];
  tabs.forEach((t, i) => {
    const id = 'it_' + Math.random().toString(36).slice(2, 12);
    const disc = Array.isArray(discountPcts) ? (Number(discountPcts[i]) || 0) : 0;
    const label = `${item.name} (1/${tabs.length} shared${disc ? ` - member ${disc}% off` : ''})`;
    D().prepare(
      `INSERT INTO tab_items (id, tab_id, item_id, name, qty, unit_price_cents, choices_json,
                              note, tax_category, printer_role, kind, status, comp, order_no,
                              person, sent_at, sent_by, share_group)
       VALUES (?,?,?,?,1,?,'[]',?,?,?,?,'sent',0,?,?,datetime('now'),?,?)`
    ).run(id, t.id, item.item_id, label,
          shares[i], item.note || '', item.tax_category || 'food', item.printer_role,
          item.kind || 'menu', item.order_no, t.label || '', employee || item.sent_by || '', group);
    made.push({ tab_id: t.id, item_id: id, amount_cents: shares[i] });
  });
  try { dbM.adminLog('ITEM_SHARED', `${item.name} split ${tabs.length} ways${saved ? ` - ${(saved/100).toFixed(2)} member discount` : ''} (${employee || 'staff'})`); } catch {}
  return { ok: true, share_group: group, total_cents: total, member_saved_cents: saved, shares: made };
}

/** What a group's tabs look like side by side, for the split screen. */
function groupSplitView(bookingId) {
  const gv = require('./checkin').groupView(bookingId);
  if (!gv) return null;
  const seats = gv.seats.map(s => {
    let tab = null;
    try { tab = s.tab_id ? pos.getTab(s.tab_id) : null; } catch {}
    const lines = tab ? tab.items.filter(i => i.status !== 'voided').map(i => ({
      id: i.id, name: i.name, kind: i.kind, amount_cents: pos.lineCents(i),
      shared: !!i.share_group, comp: !!i.comp
    })) : [];
    const t = tab ? pos.computeTotals(tab) : null;
    return { seat_id: s.id, name: s.name, tab_id: s.tab_id, lines,
             subtotal_cents: t ? t.subtotal_cents : 0, tax_cents: t ? t.tax_cents : 0,
             total_cents: t ? t.total_cents : 0, paid_cents: t ? t.paid_cents : 0,
             due_cents: t ? t.due_cents : 0, settled: !!(tab && tab.status === 'closed') };
  });
  const groupTotal = seats.reduce((a, s) => a + s.total_cents, 0);
  return { booking: gv.booking, seats, group_total_cents: groupTotal,
           all_settled: gv.all_settled };
}

module.exports.moveItemToTab = moveItemToTab;
module.exports.shareItemAcrossTabs = shareItemAcrossTabs;
module.exports.groupSplitView = groupSplitView;
module.exports.ensureShareColumn = ensureShareColumn;
