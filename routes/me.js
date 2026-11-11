// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/me.js — the employee app's API (Sep 2026). Mounted at /api/me.
//
// THE ANYWHERE LANE. An employee opens /me from home to see their schedule,
// their hours, and to ASK for things: time off, an open shift, dropping one
// of theirs. Every action lands as a pending request the owner decides -
// nothing here changes the schedule directly (owner rule, not a preference).
// Sessions are 'remote' scope: no idle lock, 30-day cap, and refused by
// requireStaffOrAdmin everywhere else, so a phone token can never run the
// counter, the clock, or a bay. Only requireAnyStaff lives on this router.
'use strict';
const express = require('express');
const router = express.Router();
const staff = require('../services/staff');
const configService = require('../services/config');
const dbMod = require('../services/db');
const tc = require('../services/timeclock');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.use((req, res, next) => {
  const c = configService.getConfig();
  if (!(c.scheduling && c.scheduling.enabled)) return res.status(404).json({ error: 'Employee scheduling is turned off for this facility.' });
  if (!staff.surfaceEnabled()) return res.status(404).json({ error: 'No staff sign-in codes are set up for this facility.' });
  next();
});

router.post('/login', (req, res) => {
  const out = staff.login(req.body?.code, req, { remote: true });
  if (out.locked) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  if (!out.ok) return res.status(401).json({ error: 'Code not recognized' });
  res.json({ token: out.token, name: out.name });
});
router.post('/logout', (req, res) => { staff.logout(req.headers['x-staff-token']); res.json({ ok: true }); });

function person(req) {
  // an admin has no code and nothing personal to see here
  if (req.staffAuth !== 'staff' || !req.staffCode) return null;
  return { code: req.staffCode, name: req.staffName };
}

router.get('/dashboard', staff.requireAnyStaff, (req, res) => {
  const me = person(req); if (!me) return res.status(403).json({ error: 'Sign in with your staff code.' });
  const cfg = configService.getConfig();
  const today = tc.localToday();
  const start = tc.addDays(today, -7), end = tc.addDays(today, 28);
  const myShifts = dbMod.db.prepare(`SELECT * FROM shifts WHERE staff_code = ? AND date BETWEEN ? AND ? ORDER BY date, start_time`).all(me.code, start, end);
  const openShifts = dbMod.db.prepare(`SELECT * FROM shifts WHERE staff_code IS NULL AND date BETWEEN ? AND ? ORDER BY date, start_time`).all(today, end);
  const myRequests = dbMod.db.prepare(`SELECT r.*, s.date, s.start_time, s.end_time, s.label FROM shift_requests r LEFT JOIN shifts s ON s.id = r.shift_id WHERE r.staff_code = ? ORDER BY r.created_at DESC LIMIT 30`).all(me.code);
  const myTimeoff = dbMod.db.prepare(`SELECT * FROM timeoff_requests WHERE staff_code = ? ORDER BY created_at DESC LIMIT 30`).all(me.code);
  const b = tc.periodBounds(cfg, today);
  const open = tc.openEntryFor(me.code);
  const hours = { today: tc.minutesForRange(me.code, today, today), period: tc.minutesForRange(me.code, b.thisStart, b.thisEnd), periodStart: b.thisStart, periodEnd: b.thisEnd,
    onClock: !!open, since: open ? open.clock_in : null };
  res.json({ name: me.name, facility: (cfg.server && cfg.server.businessName) || '', today, range: { start, end }, myShifts, openShifts, myRequests, myTimeoff, hours });
});

router.post('/timeoff', staff.requireAnyStaff, (req, res) => {
  const me = person(req); if (!me) return res.status(403).json({ error: 'Sign in with your staff code.' });
  const { start_date, end_date, note } = req.body || {};
  if (!DATE_RE.test(String(start_date || '')) || !DATE_RE.test(String(end_date || '')) || end_date < start_date) return res.status(400).json({ error: 'Give a start and end date, end on or after start' });
  if (start_date < tc.localToday()) return res.status(400).json({ error: 'Time off starts today or later' });
  dbMod.db.prepare(`INSERT INTO timeoff_requests (staff_code, staff_name, start_date, end_date, note) VALUES (?,?,?,?,?)`).run(me.code, me.name, start_date, end_date, String(note || '').slice(0, 200));
  try { dbMod.adminLog('TIMEOFF_REQUESTED', `${me.name} ${start_date}..${end_date}`); } catch {}
  res.json({ ok: true });
});
router.post('/shift-claim', staff.requireAnyStaff, (req, res) => {
  const me = person(req); if (!me) return res.status(403).json({ error: 'Sign in with your staff code.' });
  const sh = dbMod.db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(parseInt(req.body?.shift_id, 10));
  if (!sh) return res.status(404).json({ error: 'Shift not found' });
  if (sh.staff_code) return res.status(409).json({ error: 'That shift is not open' });
  const dup = dbMod.db.prepare(`SELECT id FROM shift_requests WHERE shift_id = ? AND staff_code = ? AND kind = 'claim' AND status = 'pending'`).get(sh.id, me.code);
  if (dup) return res.status(409).json({ error: 'You already asked for this shift' });
  dbMod.db.prepare(`INSERT INTO shift_requests (shift_id, staff_code, staff_name, kind, note) VALUES (?,?,?,'claim',?)`).run(sh.id, me.code, me.name, String(req.body?.note || '').slice(0, 200));
  try { dbMod.adminLog('SHIFT_CLAIM_REQUESTED', `${me.name} shift #${sh.id}`); } catch {}
  res.json({ ok: true });
});
router.post('/shift-drop', staff.requireAnyStaff, (req, res) => {
  const me = person(req); if (!me) return res.status(403).json({ error: 'Sign in with your staff code.' });
  const sh = dbMod.db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(parseInt(req.body?.shift_id, 10));
  if (!sh) return res.status(404).json({ error: 'Shift not found' });
  if (String(sh.staff_code || '') !== me.code) return res.status(403).json({ error: 'That is not your shift' });
  const dup = dbMod.db.prepare(`SELECT id FROM shift_requests WHERE shift_id = ? AND staff_code = ? AND kind = 'drop' AND status = 'pending'`).get(sh.id, me.code);
  if (dup) return res.status(409).json({ error: 'You already asked to drop this shift' });
  dbMod.db.prepare(`INSERT INTO shift_requests (shift_id, staff_code, staff_name, kind, note) VALUES (?,?,?,'drop',?)`).run(sh.id, me.code, me.name, String(req.body?.note || '').slice(0, 200));
  try { dbMod.adminLog('SHIFT_DROP_REQUESTED', `${me.name} shift #${sh.id}`); } catch {}
  res.json({ ok: true });   // the shift stays theirs until the owner approves
});

module.exports = router;
