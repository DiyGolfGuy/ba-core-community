// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/staffing.js — is someone at the door for this booking?
//
// THE LAW (maintainer, Aug 2026): deposits of ANY kind — member deposit tiers and the
// facility booking deposit — only exist where a person can settle the
// remainder at the door. Unmanned means EVERYONE pays in full online,
// members included. Hybrid facilities (unmanned base + staffed_days calendar)
// qualify only when the booking's arrival falls inside staffed coverage.
//
// Sources of truth:
//   cfg.booking.staffedAccess  — fully manned facility: always staffed
//   staffed_days rows          — hybrid coverage. A row with empty
//                                start/end times means the WHOLE day is
//                                staffed; timed rows are a window, and the
//                                booking's START time (arrival = when the
//                                counter collects) must fall inside it,
//                                half-open [start, end).
'use strict';

const configService = require('./config');
const dbMod = require('./db');

/**
 * THE ACCESS STYLE, ONE ANSWER (maintainer, Sep 1 2026 — bench finding F6).
 *
 * The wizard's select and Admin > Facility Access both used to emit the string
 * `codes` for an unmanned facility, while server.js and routes/admin.js tested
 * for `unmanned` — a value NO screen in the product ever sent. The result: the
 * access-aware check-in default ("an unmanned facility runs no counter, so
 * check-in starts OFF") silently never fired, and every unmanned facility
 * launched with the full counter flow switched on.
 *
 * Both screens now send `unmanned`. This function still accepts `codes`
 * forever, because that is the value sitting in config.json on every unit
 * already in the field — they keep working untouched, and any config saved
 * from now on is rewritten to the canonical spelling by normalizeAccessStyle.
 *
 * Returns exactly one of: 'staffed' | 'hybrid' | 'unmanned'.
 */
function accessStyleOf(booking) {
  const raw = String((booking && booking.accessStyle) || '').trim().toLowerCase();
  if (raw === 'staffed') return 'staffed';
  if (raw === 'hybrid')  return 'hybrid';
  if (raw === 'unmanned' || raw === 'codes') return 'unmanned';
  // No style declared (a pre-wizard or legacy config): fall back to the
  // runtime boolean, which has always existed.
  return (booking && booking.staffedAccess) ? 'staffed' : 'unmanned';
}

/** Rewrite a booking block's style to the canonical spelling, in place. */
function normalizeAccessStyle(booking) {
  if (!booking || !booking.accessStyle) return booking;
  booking.accessStyle = accessStyleOf(booking);
  return booking;
}

// ── THE STAFFED-HOURS LAW, WITH SEASONS (Sep 2026) ──────────────────────
// effectiveWindow(date) answers "is someone at the counter that day, and
// when" for the WHOLE product: deposit eligibility at checkout, the booking
// page's deposit boxes and staffed line, the website's staffed list, the
// counter's door settlement, waiver auto-collection. Precedence:
//   1. accessStyleOf(cfg.booking) === 'staffed'  -> always staffed (whole day)
//   2. cfg.coverage.scheduleOff === true         -> never staffed, any date
//   3. an ACTIVE coverage season                 -> that weekday's window, then
//      a per-date exception overrides it (staffed=0 kills the day,
//      staffed=1 supplies custom times)
//   4. no season                                 -> the legacy staffed_days
//      rows, exactly as before this file learned about seasons
// Step 4 is why a unit that never touches scheduling behaves identically to
// yesterday. Owner rule preserved: hours marked "want staffed" count as
// staffed even with nobody assigned yet - the slot stays bookable, people get
// scheduled onto it. Never gate staffed-ness on a shift assignment.
//
// Returns null (not staffed) or { start, end, whole, note, source } where
// start/end are 'HH:MM' and whole=true means the entire day.

function coverageActiveId() {
  const cfg = configService.getConfig();
  const id = cfg.coverage && cfg.coverage.activeTemplateId;
  if (!id) return null;
  // Re-verify the row exists so a config pointer left behind by a restore or
  // an out-of-band delete can never produce a ghost season.
  try {
    const row = dbMod.db.prepare(`SELECT id FROM coverage_templates WHERE id = ?`).get(Number(id));
    return row ? Number(id) : null;
  } catch { return null; }
}

function activeSeason() {
  const id = coverageActiveId();
  if (!id) return null;
  try {
    const row = dbMod.db.prepare(`SELECT * FROM coverage_templates WHERE id = ?`).get(id);
    if (!row) return null;
    let days = []; let blocks = [];
    try { days = JSON.parse(row.payload || '[]'); } catch {}
    try { blocks = JSON.parse(row.shifts || '[]'); } catch {}
    return { id: row.id, name: row.name, days: Array.isArray(days) ? days : [], blocks: Array.isArray(blocks) ? blocks : [] };
  } catch { return null; }
}

// Monday = 0 ... Sunday = 6, from a 'YYYY-MM-DD' string, DST-proof.
function dowMon0(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function effectiveWindow(dateStr) {
  const cfg = configService.getConfig();
  const date = String(dateStr || '');
  if (accessStyleOf(cfg.booking) === 'staffed') return { start: '', end: '', whole: true, note: '', source: 'always' };
  if (cfg.coverage && cfg.coverage.scheduleOff === true) return null;
  const season = activeSeason();
  if (season) {
    let win = null;
    const day = season.days[dowMon0(date)];
    if (day && (day.staffed === 1 || day.staffed === true)) {
      const s = String(day.start || '').trim(), e = String(day.end || '').trim();
      win = (s && e) ? { start: s, end: e, whole: false, note: season.name || '', source: 'season' }
                     : { start: '', end: '', whole: true, note: season.name || '', source: 'season' };
    }
    try {
      const ex = dbMod.db.prepare(`SELECT * FROM coverage_exceptions WHERE date = ? ORDER BY id DESC LIMIT 1`).get(date);
      if (ex) {
        if (!ex.staffed) return null;
        const s = String(ex.start_time || '').trim(), e = String(ex.end_time || '').trim();
        win = (s && e) ? { start: s, end: e, whole: false, note: ex.note || '', source: 'exception' }
                       : { start: '', end: '', whole: true, note: ex.note || '', source: 'exception' };
      }
    } catch {}
    return win;
  }
  try {
    const row = dbMod.db.prepare(`SELECT start_time, end_time, note FROM staffed_days WHERE date = ?`).get(date);
    if (!row) return null;
    const s = (row.start_time || '').trim(), e = (row.end_time || '').trim();
    return (s && e) ? { start: s, end: e, whole: false, note: row.note || '', source: 'calendar' }
                    : { start: '', end: '', whole: true, note: row.note || '', source: 'calendar' };
  } catch { return null; }
}

function isStaffedAt(dateStr, startTime) {
  const w = effectiveWindow(dateStr);
  if (!w) return false;
  if (w.whole) return true;
  const t = String(startTime || '').trim();
  if (!t) return false;                          // a timed window needs a time
  return t >= w.start && t < w.end;              // HH:MM lexicographic, half-open
}

// Upcoming coverage for the PUBLIC booking page and the website - windows,
// not just dates, so deposit boxes and the staffed line render only where a
// person will actually be. Always-staffed returns null (the page reads
// staffedAccess); the master switch returns [] so the website stops
// publishing windows the moment the owner turns it off.
function upcomingStaffedWindows(days) {
  const cfg = configService.getConfig();
  if (accessStyleOf(cfg.booking) === 'staffed') return null;
  if (cfg.coverage && cfg.coverage.scheduleOff === true) return [];
  const n = Math.max(1, Math.min(366, days || 60));
  const today = require('./timeclock').localToday();
  const out = [];
  if (activeSeason()) {
    const { addDays } = require('./timeclock');
    for (let i = 0; i < n; i++) {
      const d = addDays(today, i);
      const w = effectiveWindow(d);
      if (w) out.push({ date: d, start_time: w.whole ? '' : w.start, end_time: w.whole ? '' : w.end, note: w.note || '' });
    }
    return out;
  }
  try {
    const until = require('./timeclock').addDays(today, n);
    return dbMod.db.prepare(
      `SELECT date, start_time, end_time, note FROM staffed_days WHERE date >= ? AND date <= ? ORDER BY date ASC`
    ).all(today, until);
  } catch { return []; }
}

/** True when the facility has ANY staffed coverage from today forward. Feeds the setup checklist. */
function hasUpcomingCoverage() {
  const w = upcomingStaffedWindows(366);
  return w === null ? true : w.length > 0;
}

module.exports = { isStaffedAt, upcomingStaffedWindows, effectiveWindow, activeSeason, coverageActiveId, hasUpcomingCoverage, dowMon0, accessStyleOf, normalizeAccessStyle };
