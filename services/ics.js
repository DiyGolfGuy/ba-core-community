// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/ics.js — calendar invite for a booking. Stable UID enables
// METHOD:CANCEL later so cancelled sessions can clear themselves.
const { getConfig } = require('./config');

function dt(dateStr, timeStr) {
  return dateStr.replace(/-/g, '') + 'T' + timeStr.replace(':', '') + '00';
}
function esc(s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }

// The facility's address on one line (Oct 19 2026): the Street Address (Settings > Business & Content > Contact
// Information - its own placeholder is "123 Main St, City, State") with the city, state and ZIP from Local Search & SEO
// added where the street line does not already carry them. This read seo.address, which no screen has ever set, so an
// invite and the calendar feed carried the city and state and never the street.
function addressLine(cfg) {
  const street = String(cfg.contact?.address || '').trim();
  const rest = street.split(',').slice(1).join(',');   // what follows the street itself ("100 Fargo St" in Fargo still gets its city)
  const has = w => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i').test(rest);
  const city = String(cfg.seo?.city || '').trim(), state = String(cfg.seo?.state || '').trim(), zip = String(cfg.seo?.zip || '').trim();
  const tail = [state && !has(state) ? state : '', zip && !has(zip) ? zip : ''].filter(Boolean).join(' ');
  return [street, city && !has(city) ? city : '', tail].filter(Boolean).join(', ');
}

function buildIcs(b, method = 'REQUEST') {
  const cfg = getConfig();
  const biz = cfg.server?.businessName || 'Booking';
  const domain = (cfg.seo?.siteUrl || 'booking.local').replace(/^https?:\/\//, '').replace(/\/.*/, '');
  const loc = addressLine(cfg);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${esc(biz)}//Booking//EN`,
    `METHOD:${method}`, 'BEGIN:VEVENT',
    `UID:${b.id}@${domain}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z')}`,
    `DTSTART:${dt(b.date, b.start_time)}`,
    `DTEND:${dt(b.date, b.end_time)}`,
    `SUMMARY:${esc(biz)} - ${esc(b.bay_name || 'Simulator Bay')}`,
    loc ? `LOCATION:${esc(loc)}` : null,
    `DESCRIPTION:${esc('Booked under ' + (b.name || '') + '. See you there!')}`,
    method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}

function googleLink(b) {
  const cfg = getConfig();
  const biz = cfg.server?.businessName || 'Booking';
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${biz} - ${b.bay_name || 'Simulator Bay'}`,
    dates: `${dt(b.date, b.start_time)}/${dt(b.date, b.end_time)}`
  });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

module.exports = { buildIcs, googleLink, addressLine };
