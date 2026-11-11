// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/calendarfeed.js  -  THE BOOKINGS IN THE OWNER'S OWN CALENDAR AND FILES
//
//  example facility's manager asked (Oct 19 2026) for "an easy way to export or syndicate the
//  booking calendar out of your system to like a Gmail calendar". maintainer, the same day:
//  "be able to export it. So they can have it in their own documents. Whatever they
//  want to do with their data is theirs ... minimize as much other outside services
//  that are paid for as we can." So the unit serves both itself, nothing in between:
//
//  - A PRIVATE CALENDAR LINK: an iCalendar feed [C1] that Google Calendar, Apple
//    Calendar and Outlook subscribe to directly. The link's key is the credential,
//    the way the backup pull's token is: 32 random bytes, compared in constant time,
//    rate-limited, and made new by the owner in one tap (the old link stops at once).
//    Off until the owner turns it on (rule 31). A wrong or old key answers 404, the
//    same as no feed at all. Google reads a subscribed calendar on its own schedule -
//    often half a day or more - so the card says it is a view, never an alarm.
//  - AN EXPORT the owner downloads for any dates: a calendar file (.ics) any calendar
//    imports, a spreadsheet (.xlsx, services/xlsxwriter.js) or CSV.
//
//  Customer names on or off, phone and email on or off: the owner's call (rule 1).
//  A door code never leaves, here or anywhere (the webhooks' rule). Each booking says
//  what is due at the door the way My Booking does (rule 4). Cancelled and unpaid
//  checkouts are not on it; a block (an event, a tournament, maintenance) is, so the
//  calendar shows when a bay is taken.
//
//  [C1] RFC 5545 (iCalendar): CRLF line ends (3.1); content lines folded at 75 octets
//       with CRLF + one space, never inside a character (3.1); TEXT escapes backslash,
//       semicolon, comma and line breaks (3.3.11); a DATE-TIME ending in Z is UTC
//       (3.3.5); every VEVENT carries UID and DTSTAMP (3.6.1); METHOD:PUBLISH for a
//       feed (RFC 5546 1.4). REFRESH-INTERVAL is RFC 7986 5.7 (Apple and Outlook read
//       it; Google sets its own pace). X-WR-CALNAME is the name calendars show.
//  Times are the facility's wall clock turned into UTC by the same local-time rule the
//  door window uses (services/doorlock.js bookingEndDate: the unit runs in the
//  facility's own time zone), so a calendar in any time zone - and the night the
//  clocks change - shows the session when it really is.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const { getConfig, saveConfig } = require('./config');

const WINDOW_BACK_DAYS = 30, WINDOW_AHEAD_DAYS = 180;       // what the subscribed calendar holds
const EXPORT_MAX_DAYS = 3660;                               // an export: up to ten years at once
const BLOCKS = { event: 'Event', tournament: 'Tournament', maintenance: 'Maintenance' };

const D = () => require('./db').db;
const cfgFeed = () => Object.assign({ enabled: false, token: '', names: true, contact: false }, (getConfig().calendarFeed || {}));
const facilityToday = () => { try { return require('./revenue').facilityToday(); } catch { return new Date().toISOString().slice(0, 10); } };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── what is on it ────────────────────────────────────────────────────────────
/** Bookings and blocks that take a bay between two facility dates (inclusive): confirmed or played, never cancelled
 *  or an unpaid checkout. */
function rows(from, to) {
  return D().prepare(`SELECT id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date, duration_minutes,
      price_cents, tax_cents, status, stripe_payment_intent, is_deposit, member_id, member_due_cents, member_guest_count,
      booking_type, whole_facility, created_at, updated_at
    FROM bookings WHERE status IN ('active','completed') AND date >= ? AND date <= ? ORDER BY date, start_time, bay_name`).all(from, to);
}
const isBlock = (b) => Object.prototype.hasOwnProperty.call(BLOCKS, String(b.booking_type || ''));
/** What is due at the door, in the words My Booking uses (rule 4). */
function paymentLine(b) {
  if (isBlock(b)) return '';
  const usd = c => '$' + ((c | 0) / 100).toFixed(2);
  if (b.member_id && b.member_due_cents != null && !b.stripe_payment_intent && !((b.price_cents | 0) > 0)) return `Nothing paid - about ${usd(b.member_due_cents)} settles at the door`;
  if (b.is_deposit) return `Deposit paid ${usd(b.price_cents)} - the balance settles at the door`;
  if (b.stripe_payment_intent && (b.price_cents | 0) > 0) return `Paid online ${usd((b.price_cents | 0) + (b.tax_cents | 0))}`;
  if ((b.price_cents | 0) > 0) return `${usd((b.price_cents | 0) + (b.tax_cents | 0))} - pays at the counter`;
  return 'Nothing to pay';
}
const startOf = (b) => { const m = String(b.start_time || '').match(/^(\d{1,2}):(\d{2})/), d = String(b.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m && d ? new Date(+d[1], +d[2] - 1, +d[3], +m[1], +m[2], 0, 0) : null; };
const endOf = (b) => require('./doorlock').bookingEndDate(b);
function shown(b, opts) {
  if (isBlock(b)) return { title: `${b.bay_name || 'Bay'} - ${BLOCKS[b.booking_type]}${b.name ? ': ' + b.name : ''}`, who: '' };
  const who = opts.names ? String(b.name || '').trim() : '';
  return { title: `${b.whole_facility ? 'Whole facility' : (b.bay_name || 'Bay')} - ${who || 'Booked'}`, who };
}

// ── the calendar (RFC 5545) ──────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function fold(line) {
  // 75 octets a line; a character is never split (a name with an accent or an emoji is several octets)
  const out = []; let cur = '', octets = 0, limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (octets + n > limit) { out.push(cur); cur = ' ' + ch; octets = 1 + n; limit = 75; }
    else { cur += ch; octets += n; }
  }
  out.push(cur);
  return out.join('\r\n');
}
function calendar(list, opts = {}) {
  const c = getConfig();
  const biz = (c.server && c.server.businessName) || 'Bookings';
  const unit = (c.unit && c.unit.id) || 'unit';
  const loc = require('./ics').addressLine(c);
  const stamp = utc(new Date());
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//BA Core//Booking calendar//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(biz + ' bookings')}`, `X-WR-CALDESC:${esc('Every booking at ' + biz + ', from its booking system')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const b of list) {
    const s = startOf(b), e = endOf(b);
    if (!s || !e || !(e > s)) continue;
    const { title } = shown(b, opts);
    const desc = [isBlock(b) ? '' : `Booking ${b.id}`, paymentLine(b), b.member_id ? 'Member' + (b.member_guest_count ? ` + ${b.member_guest_count} guest${b.member_guest_count === 1 ? '' : 's'}` : '') : '',
      opts.contact && !isBlock(b) && b.phone ? 'Phone: ' + b.phone : '', opts.contact && !isBlock(b) && b.email ? 'Email: ' + b.email : ''].filter(Boolean).join('\n');
    const mod = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(b.updated_at || '')) ? String(b.updated_at).replace(/[-:]/g, '').replace(' ', 'T') + 'Z' : stamp;
    // [C1] 3.8.4.7: globally unique - the booking's own id is a random UUID; the unit's id on the right of the @
    L.push('BEGIN:VEVENT', `UID:${b.id}@${unit}`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${mod}`,
      `DTSTART:${utc(s)}`, `DTEND:${utc(e)}`, `SUMMARY:${esc(title)}`);
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    if (loc) L.push(`LOCATION:${esc(loc)}`);
    L.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ── the private link ─────────────────────────────────────────────────────────
/** The feed for a key - or null (no feed, switched off, wrong or old key: all the same to the caller). */
function feedFor(key) {
  const f = cfgFeed();
  const want = String(f.token || ''), got = String(key || '');
  // the lengths compared in BYTES (the pack review, Oct 24 2026): an accented key of the right character count threw here
  const g = Buffer.from(got), w = Buffer.from(want);
  if (!f.enabled || want.length < 40 || g.length !== w.length) return null;
  if (!crypto.timingSafeEqual(g, w)) return null;
  const today = facilityToday();
  _lastRead = Date.now();
  return calendar(rows(addDays(today, -WINDOW_BACK_DAYS), addDays(today, WINDOW_AHEAD_DAYS)), { names: f.names !== false, contact: !!f.contact });
}
let _lastRead = 0;
const newKey = () => crypto.randomBytes(32).toString('base64url');
/** The link as the owner pastes it: the website's own address when there is one a calendar service can reach. */
function linkFor(cfg) {
  const f = Object.assign({ token: '' }, cfg.calendarFeed || {});
  if (!f.token) return { link: '', why: 'off' };
  const pub = require('./membership-lifecycle').publicWebhookBase(cfg);
  if (pub.base) return { link: `${pub.base}/api/calendar/${f.token}.ics`, why: '' };
  return { link: `/api/calendar/${f.token}.ics`, why: 'Set your website address first, starting with https:// (Settings > Business & Content > Local Search & SEO, the Domain): Google, Apple and Outlook read the calendar from the internet, so the link needs your public address.' };
}
/** The card: on or off, the options, the link, when a calendar last read it. */
function state() {
  const cfg = getConfig(), f = cfgFeed();
  const l = linkFor(cfg);
  return { enabled: !!(f.enabled && f.token), names: f.names !== false, contact: !!f.contact, link: f.enabled ? l.link : '', note: f.enabled ? l.why : '',
    lastReadAt: _lastRead ? new Date(_lastRead).toISOString() : null, aheadDays: WINDOW_AHEAD_DAYS, backDays: WINDOW_BACK_DAYS };
}
/** The owner's changes: { enabled, names, contact, newLink }. Turning it on the first time makes the key. */
function update({ enabled, names, contact, newLink } = {}) {
  const f = cfgFeed();
  const patch = {};
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (typeof names === 'boolean') patch.names = names;
  if (typeof contact === 'boolean') patch.contact = contact;
  const on = typeof enabled === 'boolean' ? enabled : f.enabled;
  if (newLink || (on && !f.token)) patch.token = newKey();
  saveConfig({ calendarFeed: patch });
  const log = (ev, d) => { try { require('./db').adminLog(ev, d); } catch {} };
  if (patch.token && f.token) log('CALENDAR_LINK_NEW', 'a new calendar link was made - the old one no longer works');
  else if (patch.token) log('CALENDAR_LINK_ON', 'the private calendar link was turned on');
  if (enabled === false && f.enabled) log('CALENDAR_LINK_OFF', 'the private calendar link was turned off');
  return state();
}

// ── the export ───────────────────────────────────────────────────────────────
const COLS = [
  { h: 'Booking', k: 'id' }, { h: 'Date', k: 'date' }, { h: 'Start', k: 'start_time' }, { h: 'End', k: 'end_time' }, { h: 'Ends on', k: 'end_date' },
  { h: 'Bay', k: 'bay' }, { h: 'Kind', k: 'kind' }, { h: 'Status', k: 'status' }, { h: 'Customer', k: 'name', who: true },
  { h: 'Phone', k: 'phone', contact: true }, { h: 'Email', k: 'email', contact: true }, { h: 'Member', k: 'member' }, { h: 'Guests', k: 'guests', type: 'int' },
  { h: 'Minutes', k: 'minutes', type: 'int' }, { h: 'Price', k: 'price', type: 'money' }, { h: 'Tax', k: 'tax', type: 'money' },
  { h: 'Payment', k: 'payment' }, { h: 'Booked at (UTC)', k: 'created_at' },
];
function table(from, to, opts) {
  const cols = COLS.filter(c => (!c.who || opts.names) && (!c.contact || opts.contact));
  const data = rows(from, to).map(b => ({ id: b.id, date: b.date, start_time: b.start_time, end_time: b.end_time, end_date: b.end_date || '',
    bay: b.whole_facility ? 'Whole facility' : (b.bay_name || ''), kind: isBlock(b) ? BLOCKS[b.booking_type] : 'Booking', status: b.status === 'completed' ? 'played' : 'booked',
    name: isBlock(b) ? (b.name || '') : (b.name || ''), phone: isBlock(b) ? '' : (b.phone || ''), email: isBlock(b) ? '' : (b.email || ''),
    member: b.member_id ? 'yes' : '', guests: b.member_guest_count || '', minutes: b.duration_minutes || '', price: isBlock(b) ? '' : (b.price_cents | 0) / 100,
    tax: isBlock(b) ? '' : (b.tax_cents | 0) / 100, payment: paymentLine(b), created_at: b.created_at || '' }));
  return { cols, data };
}
// a cell a spreadsheet would run as a formula is written as text (a name typed as =HYPERLINK(...) stays a name);
// a phone number like +15551234567 or a plain signed number is left as it is
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(t) {
  const L = [t.cols.map(c => csvCell(c.h)).join(',')];
  for (const r of t.data) L.push(t.cols.map(c => csvCell(c.type === 'money' && r[c.k] !== '' ? Number(r[c.k]).toFixed(2) : r[c.k])).join(','));
  return L.join('\r\n') + '\r\n';
}
/** One export: { from, to, format: 'ics' | 'csv' | 'xlsx', names, contact } -> { filename, type, body | path }.
 *  A spreadsheet is written in workDir (the caller's - on a unit, the card's own work folder, never /tmp). */
async function exportBookings({ from, to, format, names = true, contact = false } = {}, workDir) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) throw Object.assign(new Error('choose the first and the last day (YYYY-MM-DD)'), { status: 400 });
  if (to < from) throw Object.assign(new Error('the last day is before the first'), { status: 400 });
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (span > EXPORT_MAX_DAYS) throw Object.assign(new Error('ten years at a time at most - export it in two parts'), { status: 400 });
  const opts = { names: !!names, contact: !!contact };
  const biz = String((getConfig().server && getConfig().server.businessName) || 'bookings').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'bookings';
  const base = `${biz}-bookings-${from}-to-${to}`;
  if (format === 'ics') return { filename: base + '.ics', type: 'text/calendar; charset=utf-8', body: calendar(rows(from, to), opts) };
  const t = table(from, to, opts);
  if (format === 'csv') return { filename: base + '.csv', type: 'text/csv; charset=utf-8', body: toCsv(t) };
  if (format === 'xlsx') {
    const out = require('path').join(workDir, base + '.xlsx');
    await require('./xlsxwriter').writeXlsx([{ name: 'Bookings', columns: t.cols.map(c => ({ h: c.h, type: c.type || 'text' })), rows: t.data.map(r => t.cols.map(c => r[c.k])) }], out, { title: `${biz} bookings ${from} to ${to}` });
    return { filename: base + '.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', path: out };
  }
  throw Object.assign(new Error('the format is ics, csv or xlsx'), { status: 400 });
}

module.exports = { feedFor, state, update, linkFor, exportBookings, calendar, paymentLine, rows, fold, esc, WINDOW_AHEAD_DAYS, WINDOW_BACK_DAYS };
