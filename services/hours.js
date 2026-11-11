// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/hours.js - THE OPENING HOURS ON A DAY (Oct 22 2026)
//
//  maintainer on his try box: "noon to 10pm weekdays and 9am to midnight on weekends" - the box kept ONE set of hours for every open day,
//  so the 4B put up weekdays only and the weekends closed. A day may now have its own hours (booking.dayHours, keyed sun..sat:
//  { open: 'HH:MM', close: 'HH:MM' }); every other open day keeps the facility's one set (openTime, closeTime, closeNextDay).
//  Everything that reads the hours for a date reads them here, in the shape the booking rules always had. Open around the clock
//  stands over all of it, as before. A close at or before the opening is the next morning's (00:00 is the end of the day).
// ═════════════════════════════════════════════════════════════════════════════
'use strict';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayOf = (date) => DAYS[new Date(String(date).slice(0, 10) + 'T12:00:00Z').getUTCDay()];

/** A day's own hours, as set (or null): the ones kept are well formed and open before they close or close the next morning. */
function own(bk, day) {
  const d = ((bk || {}).dayHours || {})[day];
  return d && TIME.test(String(d.open || '')) && TIME.test(String(d.close || '')) && d.open !== d.close ? d : null;
}
/** The hours on a date: { openTime, closeTime, closeNextDay, open24Hours } - the day's own hours over the facility's one set. */
function on(bk, date) {
  bk = bk || {};
  const base = { openTime: bk.openTime || '05:00', closeTime: bk.closeTime || '23:30', closeNextDay: !!bk.closeNextDay, open24Hours: !!bk.open24Hours };
  if (base.open24Hours || !date || !/^\d{4}-\d{2}-\d{2}/.test(String(date))) return base;
  const d = own(bk, dayOf(date));
  return d ? { openTime: d.open, closeTime: d.close, closeNextDay: d.close <= d.open, open24Hours: false } : base;
}
/** The minute a session must END by on that day, counted from the day's midnight (Infinity when open around the clock). */
function closeMins(h) {
  if (h.open24Hours) return Infinity;
  const [hh, mm] = String(h.closeTime).split(':').map(Number), raw = hh * 60 + mm;
  return raw === 0 ? 1440 : raw + (h.closeNextDay ? 1440 : 0);
}
/** The days with hours of their own, for a page or a reply: { sat: { open, close }, ... } (only the well-formed ones). */
function dayHours(bk) { const out = {}; for (const d of DAYS) { const h = own(bk, d); if (h) out[d] = { open: h.open, close: h.close }; } return out; }

module.exports = { DAYS, dayOf, on, closeMins, dayHours };
