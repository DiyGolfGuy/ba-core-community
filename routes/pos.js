// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/pos.js — POS API. Phase 1: staff+owner behind admin auth; the
// role-scoped split (requireOwner vs requireStaff) lands with staff accounts.
'use strict';

const express = require('express');
const router = express.Router();
const pos = require('../services/pos');
const configService = require('../services/config');

// Wave A (P4 core): staff token OR admin password. A live staff session sets
// req.staffName server-side; employeeOf prefers it so stamps cannot be spoofed
// from the client. Admin-password callers keep the Phase-1 x-employee behavior.
const staffAuth = require('../services/staff');
router.use(staffAuth.requireStaffOrAdmin);

function employeeOf(req) {
  return String(req.staffName || req.headers['x-employee'] || req.body?.employee || '').slice(0, 40);
}

// ── menu ────────────────────────────────────────────────────────────────
router.get('/menu', (req, res) => {
  res.json({ menu: pos.getMenu(req.query.all === '1') });
});

// Building the menu is OWNER work (x-admin-password); staff's live control is
// the 86 toggle below. Reads stay open to any signed-in staff device.
router.post('/menu/category', staffAuth.requireAdminOnly, (req, res) => {
  try { res.json({ id: pos.upsertCategory(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/menu/item', staffAuth.requireAdminOnly, (req, res) => {
  try { res.json({ id: pos.upsertItem(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/menu/item/:id', staffAuth.requireAdminOnly, (req, res) => {
  try { res.json(pos.deleteItem(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/menu/category/:id', staffAuth.requireAdminOnly, (req, res) => {
  try { res.json(pos.deleteCategory(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/menu/choice-group/:id', staffAuth.requireAdminOnly, (req, res) => {
  try { res.json({ ok: pos.deleteChoiceGroup(req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/menu/choice/:id', staffAuth.requireAdminOnly, (req, res) => {
  try { res.json({ ok: pos.deleteChoice(req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/menu/item/:id/86', (req, res) => {
  const on = req.body && req.body.on !== false;
  if (!pos.setEightySix(req.params.id, on)) return res.status(404).json({ error: 'item not found' });
  res.json({ ok: true, eighty_sixed: on });
});

// ── specials (Oct 22 2026; maintainer: "if they say tuesday special and an ammount off the beer needs to be that ammount
// off") - the counter's own rule, services/specials.js: any signed-in device reads them (the pad shows what is on), only the
// owner makes, changes or takes one off - the menu's own split
router.get('/specials', (req, res) => {
  const S = require('../services/specials'), now = S.clock();
  res.json({ specials: S.list().map(sp => Object.assign({}, sp, { on_now: S.onAt(sp, now), deal: S.dealWords(sp), time: S.timeWords(sp), covers: S.coverWords(sp) })), now });
});
router.post('/specials', staffAuth.requireAdminOnly, (req, res) => {
  try { const sp = require('../services/specials').upsert(req.body || {}); res.json({ ok: true, special: sp }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/specials/:id', staffAuth.requireAdminOnly, (req, res) => {
  const had = require('../services/specials').remove(req.params.id);
  if (!had) return res.status(404).json({ error: 'no such special' });
  res.json({ ok: true });
});

// ── tabs ────────────────────────────────────────────────────────────────
router.get('/tabs', (req, res) => {
  // ?scope=paid → settled tabs for the day (default today); default stays open.
  if (req.query.scope === 'paid') {
    return res.json({ tabs: pos.listClosedTabs(req.query.date) });
  }
  res.json({ tabs: pos.listOpenTabs() });
});

// Bring a settled tab back to Open Tabs. Payments stay on record.
router.post('/tabs/:id/reopen', (req, res) => {
  try { res.json({ tab: pos.reopenTab(req.params.id, { employee: employeeOf(req) }) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Remove a tab nothing ever happened on (mis-typed). Guards live in the
// service: open, standalone, zero items ever, zero payments.
router.delete('/tabs/:id', (req, res) => {
  try { res.json(pos.deleteTab(req.params.id, { employee: employeeOf(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/tabs', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.label && !b.table_label) return res.status(400).json({ error: 'label or table_label required' });
    const tab = pos.openTab({ ...b, employee: employeeOf(req) });
    res.json({ tab });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/tabs/:id', (req, res) => {
  const tab = pos.getTab(req.params.id);
  if (!tab) return res.status(404).json({ error: 'tab not found' });
  res.json({ tab });
});

router.post('/tabs/:id/order', async (req, res) => {
  try {
    const lines = (req.body && req.body.lines) || [];
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'lines required' });
    const sent = pos.sendOrder(req.params.id, lines, employeeOf(req));
    await pos.refreshTabTax(req.params.id);   // Stripe's number lands before the screen redraws
    res.json(sent);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/tabs/:id/pay', (req, res) => {
  try {
    // CASH OR CHECK, BY NAME (Oct 3 2026; pilot facility's handoff section 2): any string was recorded, so "CHECK" got past the
    // checks-off switch and "card" closed a tab with no reader payment behind it. A card is recorded by the reader's own
    // path when Stripe says the money moved (services/terminal.js), never through this route.
    const method = String((req.body || {}).method || '');
    if (method !== 'cash' && method !== 'check') return res.status(400).json({ error: 'A payment here is cash or check - a card is taken on the reader.' });
    const out = pos.recordPayment(req.params.id, { ...(req.body || {}), method, employee: employeeOf(req) });
    pos.stxRecordSale(req.params.id, 'tab-' + req.params.id + '-' + Date.now().toString(36));
    res.json(out);
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── tax codes: read for staff surfaces, write owner-only ────────────────
router.get('/tax-codes', (req, res) => {
  try { res.json({ codes: pos.getTaxCodes() }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/tax-codes', staffAuth.requireAdminOnly, (req, res) => {
  try { res.json({ codes: pos.setTaxCodes(req.body && req.body.codes) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── voids / comps / review ──────────────────────────────────────────────
router.post('/items/:id/void', async (req, res) => {
  try {
    const b = req.body || {};
    const it = pos.voidItem(req.params.id, { comp: !!b.comp, reason: b.reason, employee: employeeOf(req) });
    await pos.refreshTabTax(it && it.tab_id ? it.tab_id : req.params.id);
    res.json({ item: it });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/review', (req, res) => {
  let refunds = [];
  try { refunds = require('../services/refunds').reviewList(req.query.date); } catch (e) {}
  res.json({ rows: pos.reviewList(req.query.date), refunds });
});

// MONEY BACK AT THE COUNTER (maintainer, Sep 24 2026): any staff member, with a reason,
// onto the owner's daily review like a void - "the person taking the money is the
// one standing there when it goes back". Card back through Stripe, cash out of
// the drawer, a check recorded; the payment itself never changes.
router.post('/tabs/:id/payments/:pid/refund', async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await require('../services/refunds').counterRefund({ tabId: req.params.id, paymentId: req.params.pid,
      amountCents: b.amount_cents, reason: b.reason, employee: employeeOf(req) }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/review/refund/:id/check', staffAuth.requireAdminOnly, (req, res) => {
  if (!require('../services/refunds').checkReview(req.params.id, (req.body && req.body.reviewer) || 'Owner')) return res.status(404).json({ error: 'not a refund row' });
  res.json({ ok: true });
});

router.post('/review/:id/check', staffAuth.requireAdminOnly, (req, res) => {
  if (!pos.checkReview(req.params.id, (req.body && req.body.reviewer) || 'Owner')) {
    return res.status(404).json({ error: 'not a comp/void row' });
  }
  res.json({ ok: true });
});

// Merge one open tab into another (walk-in joins a group, couple pays together).
// Items and payments MOVE - history keeps every line; the source closes with a
// merge stamp so the ledger never loses a row.
router.post('/tabs/:id/merge', (req, res) => {
  try {
    const into = req.body && req.body.into;
    if (!into) return res.status(400).json({ error: 'into (target tab id) required' });
    res.json(pos.mergeTabs(req.params.id, into, employeeOf(req)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── drawer / EOD ────────────────────────────────────────────────────────
router.post('/drawer/open', (req, res) => {
  const cfg = pos.posCfg(configService.getConfig());
  if (!cfg.drawer.enabled) return res.status(400).json({ error: 'cash drawer is not enabled' });
  const reason = (req.body && req.body.reason) || 'manager open';
  res.json(pos.openDrawer({ employee: employeeOf(req), reason, txn_id: '' }));
});

router.get('/eod', (req, res) => {
  const summary = pos.eodSummary(req.query.date);
  // the saved close (if any) rides along: the EOD screen needs the closed
  // banner, who counted, and over/short without a second endpoint
  let report = null;
  try {
    report = require('../services/db').db.prepare(
      `SELECT date, opening_float_cents, expected_cash_cents, counted_cents, over_short_cents, counted_by, created_at
         FROM eod_reports WHERE date = ?`).get(summary.date) || null;
  } catch {}
  res.json({ ...summary, report });
});

router.post('/eod/close', (req, res) => {
  try {
    const b = req.body || {};
    if (!Number.isFinite(b.counted_cents)) return res.status(400).json({ error: 'counted_cents required' });
    res.json(pos.closeDay({ date: b.date, counted_cents: b.counted_cents, counted_by: employeeOf(req) }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Void a whole check (staff mistake recovery). Lands on the owner's review.
router.post('/tabs/:id/items/:itemId/move', staffAuth.requireStaffOrAdmin, async (req, res) => {
  try {
    const out = pos.moveItemToTab(req.params.id, req.params.itemId, (req.body || {}).to_tab_id, req.staffName || (req.body || {}).employee);
    await pos.refreshTabTax(req.params.id);
    if ((req.body || {}).to_tab_id) await pos.refreshTabTax((req.body || {}).to_tab_id);
    res.json({ success: true, from: out.from, to: out.to });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/tabs/:id/void', staffAuth.requireStaffOrAdmin, (req, res) => {
  try { res.json(pos.voidTab(req.params.id, { reason: (req.body || {}).reason, employee: req.staffName || 'Staff' })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Print one person's check so they can see what they owe at the table.
router.post('/tabs/:id/print', staffAuth.requireStaffOrAdmin, (req, res) => {
  try {
    const tab = require('../services/pos').getTab(req.params.id);
    if (!tab) return res.status(404).json({ error: 'Tab not found' });
    const out = require('../services/printing').enqueueTabReceipt(tab, {
      employee: req.staffName || '', paid: tab.due_cents === 0
    });
    if (!out.printed) return res.status(409).json(out);
    try { require('../services/db').adminLog('CHECK_PRINTED', `${tab.label} (${req.staffName || 'staff'})`); } catch {}
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Could not print that check' }); }
});

// ── SPLIT CHECKS (maintainer, Aug 11): the counter is the split engine ────────────
const checks = require('../services/checks');
function chkGuard(req, res, fn) {
  try { return res.json(fn()); }
  catch (e) { return res.status(400).json({ error: e.message }); }
}
router.get("/tabs/:id/checks", staffAuth.requireStaffOrAdmin, (req, res) =>
  chkGuard(req, res, () => checks.checkTotals(req.params.id)));

router.post('/tabs/:id/checks/split', staffAuth.requireStaffOrAdmin, (req, res) =>
  chkGuard(req, res, () => { checks.splitTab(req.params.id, (req.body || {}).count); checks.shareAllEvenly(req.params.id); return checks.checkTotals(req.params.id); }));

router.post('/tabs/:id/checks/add', staffAuth.requireStaffOrAdmin, (req, res) =>
  chkGuard(req, res, () => { checks.addCheck(req.params.id, (req.body || {}).label); return checks.checkTotals(req.params.id); }));

router.post('/tabs/:id/checks/remove', staffAuth.requireStaffOrAdmin, (req, res) =>
  chkGuard(req, res, () => { checks.removeCheck(req.params.id, (req.body || {}).check_id); return checks.checkTotals(req.params.id); }));

router.post('/tabs/:id/checks/move-item', staffAuth.requireStaffOrAdmin, (req, res) =>
  chkGuard(req, res, () => { const b = req.body || {}; checks.moveItem(req.params.id, b.item_id, b.check_id); return checks.checkTotals(req.params.id); }));

router.post('/tabs/:id/checks/share-item', staffAuth.requireStaffOrAdmin, (req, res) =>
  chkGuard(req, res, () => { const b = req.body || {}; checks.shareItem(req.params.id, b.item_id, b.check_ids); return checks.checkTotals(req.params.id); }));

router.post('/tabs/:id/checks/share-all', staffAuth.requireStaffOrAdmin, (req, res) =>
  chkGuard(req, res, () => { checks.shareAllEvenly(req.params.id); return checks.checkTotals(req.params.id); }));

module.exports = router;
