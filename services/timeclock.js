// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/timeclock.js — the employee system's shared clock/period helpers.
//
// ONE SOURCE. routes/staff.js and routes/me.js both import these; there are
// no private copies anywhere (the pilot facility port had mirrored copies - not here).
// Everything is facility-local: dates are 'YYYY-MM-DD' strings in the
// facility timezone, durations come from epoch ms so DST never shortens a
// shift. "Hours period" is deliberately not called a pay period (rule 12).
'use strict';

const { getConfig } = require('./config');
const dbMod = require('./db');

function tz() { return (getConfig().server && getConfig().server.timezone) || 'America/Chicago'; }

const p2 = n => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for now (or ms) in the facility timezone. */
function localToday(ms) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(ms ? new Date(ms) : new Date());
  } catch { const d = new Date(ms || Date.now()); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
}

/** 'YYYY-MM-DD HH:MM:SS' local stamp for ms (default now). */
function localStamp(ms) {
  const d = new Date(ms || Date.now());
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
    const g = t => (parts.find(x => x.type === t) || {}).value;
    return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:${g('second')}`;
  } catch {
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }
}

function minutesBetweenMs(a, b) { return Math.max(0, Math.round((b - a) / 60000)); }

/** Minutes between two local stamps of the SAME day (admin edits, no ms). */
function minutesBetweenStamps(a, b) {
  const m = s => { const t = String(s || '').slice(11, 16).split(':').map(Number); return (t[0] || 0) * 60 + (t[1] || 0); };
  const da = String(a || '').slice(0, 10), db = String(b || '').slice(0, 10);
  const dayGap = da && db && db !== da ? daysBetween(da, db) * 1440 : 0;
  return Math.max(0, m(b) + dayGap - m(a));
}

// ── date arithmetic on 'YYYY-MM-DD', UTC-normalized so DST cannot bite ────
function toUTC(ymd) { const [y, m, d] = String(ymd).split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fromUTC(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; }
function addDays(ymd, n) { return fromUTC(toUTC(ymd) + n * 86400000); }
function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
/** Monday on or before ymd. */
function mondayOf(ymd) { const dow = new Date(toUTC(ymd)).getUTCDay(); return addDays(ymd, -((dow + 6) % 7)); }
function lastDayOfMonth(ymd) { const [y, m] = ymd.split('-').map(Number); return fromUTC(Date.UTC(y, m, 0)); }

/**
 * The hours period that contains todayStr, per the facility's setting.
 *   weekly      - 7 days from the anchor-aligned Monday
 *   biweekly    - 14 days from the anchor (or the most recent Monday)
 *   semimonthly - [1..15] and [16..end], or the facility's own two days
 *   monthly     - the 1st to the last day of the month (W29, Sep 3 2026)
 */
const PERIODS = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
function currentPeriodStart(cfg, todayStr) {
  const sc = (cfg && cfg.scheduling) || {};
  const period = PERIODS.includes(sc.hoursPeriod) ? sc.hoursPeriod : 'weekly';
  const today = todayStr || localToday();
  if (period === 'monthly') return today.slice(0, 8) + '01';
  if (period === 'semimonthly') {
    const days = Array.isArray(sc.semiMonthlyDays) && sc.semiMonthlyDays.length === 2
      ? sc.semiMonthlyDays.map(Number).sort((a, b) => a - b) : [1, 16];
    const [y, m, d] = today.split('-').map(Number);
    if (d >= days[1]) return `${y}-${p2(m)}-${p2(days[1])}`;
    if (d >= days[0]) return `${y}-${p2(m)}-${p2(days[0])}`;
    // before the first cut: the previous month's second cut
    const prev = fromUTC(Date.UTC(y, m - 2, days[1]));
    return prev;
  }
  const step = period === 'biweekly' ? 14 : 7;
  let anchor = /^\d{4}-\d{2}-\d{2}$/.test(sc.anchorDate || '') ? sc.anchorDate : mondayOf(today);
  if (period === 'weekly') anchor = mondayOf(anchor);
  const diff = daysBetween(anchor, today);
  const k = Math.floor(diff / step);
  return addDays(anchor, k * step);
}

function periodEnd(cfg, start) {
  const sc = (cfg && cfg.scheduling) || {};
  const period = sc.hoursPeriod || 'weekly';
  if (period === 'monthly') return lastDayOfMonth(start);
  if (period === 'semimonthly') {
    const days = Array.isArray(sc.semiMonthlyDays) && sc.semiMonthlyDays.length === 2
      ? sc.semiMonthlyDays.map(Number).sort((a, b) => a - b) : [1, 16];
    const d = Number(start.slice(8, 10));
    if (d === days[0]) return addDays(start.slice(0, 8) + p2(days[1]), -1);
    return lastDayOfMonth(start);
  }
  return addDays(start, (period === 'biweekly' ? 14 : 7) - 1);
}

/** { thisStart, thisEnd, lastStart, lastEnd, period } - one call fills the export range. */
function periodBounds(cfg, todayStr) {
  const thisStart = currentPeriodStart(cfg, todayStr);
  const thisEnd = periodEnd(cfg, thisStart);
  const lastStart = currentPeriodStart(cfg, addDays(thisStart, -1));
  const lastEnd = periodEnd(cfg, lastStart);
  return { thisStart, thisEnd, lastStart, lastEnd, period: ((cfg && cfg.scheduling) || {}).hoursPeriod || 'weekly' };
}

function sumMinutes(rows) { return (rows || []).reduce((a, r) => a + (Number(r.worked_minutes) || 0), 0); }

function openEntryFor(code) {
  try {
    return dbMod.db.prepare(`SELECT * FROM time_entries WHERE staff_code = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1`).get(String(code)) || null;
  } catch { return null; }
}

/** Closed-entry minutes for one code between two local dates (inclusive). */
function minutesForRange(code, start, end) {
  try {
    const rows = dbMod.db.prepare(
      `SELECT worked_minutes FROM time_entries WHERE staff_code = ? AND clock_out IS NOT NULL AND date(clock_in) BETWEEN ? AND ?`
    ).all(String(code), start, end);
    return sumMinutes(rows);
  } catch { return 0; }
}

module.exports = { PERIODS, tz, localToday, localStamp, minutesBetweenMs, minutesBetweenStamps,
  addDays, daysBetween, mondayOf, lastDayOfMonth,
  currentPeriodStart, periodEnd, periodBounds, sumMinutes, openEntryFor, minutesForRange };
