// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/deals.js - BOOKING DEALS: A DEAL ON THE GOLF, ON ITS OWN (Oct 22 2026)
//
//  maintainer: "Even say book 2 hours get the last 30 min free Tuesdays or something like all that needs to not only be possible in
//  the admin, the Ai needs to do and and sometimes even say this is what I can do." A booking deal needs no code: when a
//  session fits it, its price is lower, on the booking page, at checkout and at the counter alike - it is worked into
//  pricing.sessionQuote, the one computation all of them read.
//    - its kind: the last N minutes free, a percent off, or dollars off the session
//    - when it applies: a session of at least N minutes, its days, the window the session STARTS in, a first and last day
//  The best deal that fits is the one taken (never two at once). A member books at their member price, and never pays more
//  than the same session without their code would cost - the deal included (the booking route's member cap).
//
//  FREE THINGS WITH A BOOKING (Oct 22 2026, night; maintainer: "Id say if its 2 hours and free pitches they just get the pitchers at the
//  front desk no need for a special booking. That gets confusing"): a deal of kind free_items gives things off the menu with a
//  booking that fits - "book 2 hours, get 2 pitchers free". Nothing to pick and no code: the customer books as usual, the
//  booking keeps its own copy of what it comes with (bookings.deal_items_json - a later change to the deal never changes it),
//  and at the counter those things ring up at $0 on that booking's tabs until they are used, as a package's do
//  (packages.includedFor). It never changes the bay's price, so it stands beside the best money deal - one of each at most.
//  Any booking that fits gets it - a member's too: it is the facility's offer to whoever books, not a price.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const dbM = require('./db');

const D = () => dbM.db;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const csv = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/, DATE = /^\d{4}-\d{2}-\d{2}$/;

function ensureSchema() {
  D().exec(`CREATE TABLE IF NOT EXISTS booking_deals (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    words TEXT DEFAULT '',               -- its line for customers
    kind TEXT NOT NULL,                  -- free_minutes | percent | off | free_items
    value INTEGER NOT NULL,              -- minutes free, a whole percent, or cents off (free_items: 0)
    min_minutes INTEGER DEFAULT 0,       -- a session of at least this long (0: any)
    days TEXT DEFAULT '',                -- mon,tue,... ('' every day)
    start_from TEXT DEFAULT '', start_until TEXT DEFAULT '',        -- the window the session starts in ('' any time)
    date_from TEXT DEFAULT '', date_to TEXT DEFAULT '',             -- its first and last day ('' always)
    show_online INTEGER DEFAULT 1, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  // free_items: what comes with the booking, JSON [{ kind: 'item'|'part', id, qty }] (Oct 22 2026, night - additive)
  try { D().exec(`ALTER TABLE booking_deals ADD COLUMN includes TEXT DEFAULT '[]'`); } catch {}
}
let schemaDone = false;
const ready = () => { if (!schemaDone) { ensureSchema(); schemaDone = true; } };
const includesOf = (d) => { try { const a = JSON.parse((d && d.includes) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
function nameOf(x) {
  try { const r = x.kind === 'part' ? D().prepare('SELECT name FROM menu_categories WHERE id=?').get(x.id) : D().prepare('SELECT name FROM menu_items WHERE id=?').get(x.id); return r ? r.name : '(gone from the menu)'; } catch { return '?'; }
}
/** A thing's name for how many: "2 Bud Light Pitchers", "2 Wings", "2 Pitchers of Bud Light" - the last word of a name with no "of",
 *  the first of one with it. Never a part of the menu ("2 from Beer"). */
function plural(name, qty) {
  const n = String(name || '');
  if (!(qty > 1) || !n) return n;
  const one = (w) => /(?:s|ss|x|z|ch|sh)$/i.test(w) ? (/[^s]s$/i.test(w) ? w : w + 'es') : /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : w + 's';
  const of = n.match(/^(.*?)(\S+)( of .*)$/i);
  if (of) return of[1] + one(of[2]) + of[3];
  return n.replace(/(\S+)$/, (w) => /[A-Za-z]$/.test(w) ? one(w) : w);
}
/** How many of a thing, in words: "1 Pizza", "2 Bud Light Pitchers", "2 from Beer" (any from that part of the menu) - and a name
 *  that is already plural by orders, "1 order of Nachos", "2 orders of Wings" ("1 Nachos" read wrong, and "2 Wings" could be two
 *  wings - the 4B walk, Oct 22 2026). One place, for deals and packages alike. */
function howMany(name, qty, kind) {
  const n = String(name || ''), q = qty | 0 || 1;
  if (kind === 'part') return `${q} from ${n}`;
  const pl = (w) => !!w && w.length > 3 && /[a-z]s$/i.test(w) && !/(?:ss|us|is)$/i.test(w);
  const last = (n.match(/([A-Za-z]+)[^A-Za-z]*$/) || [])[1], lead = (n.match(/^([A-Za-z]+)\s*(?:&|and)\s/i) || [])[1];
  if (!/^(?:orders?|plates?|baskets?|bowls?|sides?|servings?|rounds?) of /i.test(n) && (pl(last) || pl(lead))) return `${q} order${q > 1 ? 's' : ''} of ${n}`;
  return `${q} ${plural(n, q)}`;
}
const thingWords = (x, name) => howMany(name, x.qty, x.kind);
/** "2 Pitchers of Bud Light and 1 from Appetizers" - what a free-items deal gives, in words. */
function itemsWords(d) {
  const l = includesOf(d).map(x => thingWords(x, nameOf(x)));
  return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
}
function list() { try { ready(); return D().prepare('SELECT * FROM booking_deals ORDER BY active DESC, sort, name').all(); } catch { return []; } }
function get(id) { try { ready(); return D().prepare('SELECT * FROM booking_deals WHERE id=?').get(String(id || '')) || null; } catch { return null; } }

/** Save a deal (a new one, or the one with this id). Every refusal names what is wrong. */
function upsert(o) {
  ready();
  const name = String(o.name || '').trim().slice(0, 60);
  if (!name) throw new Error('a deal needs a name');
  const kind = String(o.kind || '');
  if (!['free_minutes', 'percent', 'off', 'free_items'].includes(kind)) throw new Error('a deal is minutes free, a percent off, dollars off or free things with the booking');
  // free things: what comes with it, each off the menu (an item, or any one from a part of it) - never a price
  const inc = kind !== 'free_items' ? [] : (Array.isArray(o.includes) ? o.includes : (() => { try { return JSON.parse(o.includes || '[]'); } catch { return []; } })())
    .map(x => ({ kind: x.kind === 'part' ? 'part' : 'item', id: String(x.id || ''), qty: Math.max(1, Math.min(50, Math.round(Number(x.qty) || 1))) })).filter(x => x.id);
  if (kind === 'free_items') {
    if (!inc.length) throw new Error('say what comes free with the booking - something off the menu');
    if (((require('./config').getConfig().pos || {}).fnb === false)) throw new Error('this facility has no food and drink at the counter (Settings > Staff > The Counter: Food & Drink off) - switch it on first, or make the deal minutes free or money off');
    for (const x of inc) {
      const row = x.kind === 'part' ? D().prepare('SELECT id FROM menu_categories WHERE id=?').get(x.id) : D().prepare('SELECT id FROM menu_items WHERE id=?').get(x.id);
      if (!row) throw new Error(`no ${x.kind === 'part' ? 'part of the menu' : 'menu item'} ${x.id}`);
    }
  }
  const value = kind === 'free_items' ? 0 : Math.round(Number(o.value));
  if (kind !== 'free_items' && (!Number.isFinite(value) || value <= 0)) throw new Error('say how much: the minutes free, the percent or the dollars off');
  if (kind === 'free_minutes' && (value % 30 || value > 210)) throw new Error('the minutes free are on the half hour (30, 60 ...)');
  if (kind === 'percent' && value > 100) throw new Error('a percent off is 1 to 100');
  if (kind === 'off' && value > 100000) throw new Error('the dollars off are out of range');
  const min_minutes = Math.max(0, Math.round(Number(o.min_minutes) || 0));
  if (min_minutes % 30) throw new Error('the session it needs is on the half hour (60, 90, 120 ...)');
  // (with no booking named, "the last 30 minutes free" made a 30-minute booking free - the research, Oct 23 2026)
  if (kind === 'free_minutes' && !min_minutes) throw new Error('say how long the booking must be - the minutes free come off the end of a longer booking (book 2 hours, the last 30 minutes free)');
  if (kind === 'free_minutes' && min_minutes && value >= min_minutes) throw new Error('the minutes free must be fewer than the session it needs');
  const days = (Array.isArray(o.days) ? o.days : csv(o.days)).map(d => String(d).trim().toLowerCase().slice(0, 3)).filter(Boolean);
  const bad = days.find(d => !DAYS.includes(d)); if (bad) throw new Error(`"${bad}" is not a day`);
  const start_from = String(o.start_from || '').trim(), start_until = String(o.start_until || '').trim();
  if ((start_from && !TIME.test(start_from)) || (start_until && !TIME.test(start_until))) throw new Error('the start window is HH:MM');
  if (start_from && start_until && start_until < start_from) throw new Error('the latest start is before the earliest');
  const date_from = String(o.date_from || '').trim(), date_to = String(o.date_to || '').trim();
  if ((date_from && !DATE.test(date_from)) || (date_to && !DATE.test(date_to))) throw new Error('its first and last day are YYYY-MM-DD');
  if (date_from && date_to && date_to < date_from) throw new Error('its last day is before its first');
  const id = o.id && get(o.id) ? String(o.id) : crypto.randomBytes(6).toString('hex');
  D().prepare(`INSERT INTO booking_deals (id,name,words,kind,value,min_minutes,days,start_from,start_until,date_from,date_to,show_online,active,sort,includes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, words=excluded.words, kind=excluded.kind, value=excluded.value, min_minutes=excluded.min_minutes,
      days=excluded.days, start_from=excluded.start_from, start_until=excluded.start_until, date_from=excluded.date_from, date_to=excluded.date_to,
      show_online=excluded.show_online, active=excluded.active, sort=excluded.sort, includes=excluded.includes, updated_at=datetime('now')`)
    .run(id, name, String(o.words || '').trim().slice(0, 200), kind, value, min_minutes, days.join(','), start_from, start_until, date_from, date_to,
      o.show_online === false || o.show_online === 0 ? 0 : 1, o.active === false || o.active === 0 ? 0 : 1, Math.round(Number(o.sort) || 0), JSON.stringify(inc));
  return get(id);
}
function remove(id) { const had = !!get(id); try { D().prepare('DELETE FROM booking_deals WHERE id=?').run(String(id || '')); } catch {} return had; }

const dowOf = (date) => DAYS[new Date(date + 'T12:00:00Z').getUTCDay()];
/** Does this deal fit this session? (its day, its start, its length) */
function fits(d, date, start, minutes) {
  if (!d || !d.active) return false;
  if (d.date_from && date < d.date_from) return false;
  if (d.date_to && date > d.date_to) return false;
  const days = csv(d.days); if (days.length && !days.includes(dowOf(date))) return false;
  if (d.start_from && start < d.start_from) return false;
  if (d.start_until && start > d.start_until) return false;
  return minutes >= (d.min_minutes || 0);
}
/** What the deal takes off this session, from its own half-hour blocks (pricing.publicBlocks: { cents } each, in order). */
function centsOff(d, blocks) {
  if (d.kind === 'free_items' || !(d.value > 0)) return 0;   // (free things never change the price - and slice(-0) is every block)
  const total = blocks.reduce((a, b) => a + (b.cents | 0), 0);
  if (d.kind === 'percent') return Math.round(total * d.value / 100);
  if (d.kind === 'off') return Math.min(total, d.value);
  // the last N minutes free: the blocks at the end of the session, at their own prices (a price window may cover them)
  // (never the whole session: a deal saved before a booking was required, on a session no longer than the minutes free, takes nothing)
  const n = Math.round(d.value / 30); if (blocks.length <= n) return 0;
  return blocks.slice(-n).reduce((a, b) => a + (b.cents | 0), 0);
}
/** The best deal that fits a session, and what it takes off - or null. */
function bestFor(date, start, minutes, blocks) {
  let best = null;
  for (const d of list()) {
    if (d.kind === 'free_items' || !fits(d, date, start, minutes)) continue;
    const cents = centsOff(d, blocks || []);
    if (cents > 0 && (!best || cents > best.cents)) best = { id: d.id, name: d.name, cents, words: d.words || words(d) };
  }
  return best;
}
/** The free-items deal that fits a session, as the booking keeps it - or null. The most things wins; on a tie, the deal first
 *  in the owner's order. { id, name, words, includes: [{ key, kind, id, name, qty }] } */
function itemsFor(date, start, minutes) {
  let best = null, most = 0;
  for (const d of list()) {
    if (d.kind !== 'free_items' || !fits(d, date, start, minutes)) continue;
    const inc = includesOf(d), n = inc.reduce((a, x) => a + (x.qty | 0), 0);
    if (n > most) { most = n; best = { id: d.id, name: d.name, words: d.words || words(d), includes: inc.map((x, i) => ({ key: `deal:${d.id}:${i}`, kind: x.kind, id: x.id, name: nameOf(x), qty: x.qty | 0 })) }; }
  }
  return best;
}
/** Keep what a new booking comes with on its row (bookings.deal_items_json) - never with a package (the package is the deal).
 *  Called by every place a booking is made; a failure never fails the booking. Returns the copy kept, or null. */
function stampItems(bookingId, date, start, minutes) {
  try {
    const it = itemsFor(date, start, minutes); if (!it) return null;
    D().prepare(`UPDATE bookings SET deal_items_json=? WHERE id=? AND COALESCE(package_id,'')=''`).run(JSON.stringify(it), String(bookingId));
    return it;
  } catch (e) { console.error('deal items stamp:', e.message); return null; }
}
const itemsSnapOf = (booking) => { try { const s = JSON.parse((booking && booking.deal_items_json) || ''); return s && Array.isArray(s.includes) && s.includes.length ? s : null; } catch { return null; } };
/** "2 Pitchers of Bud Light free at the front desk (Tuesday Pitchers)" - for the email, the confirmation and the counter. */
function itemsLine(booking) {
  const s = itemsSnapOf(booking); if (!s) return '';
  const l = s.includes.map(x => thingWords(x, x.name));
  return `${l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]} free at the front desk (${s.name})`;
}

// ── words ──
const money = (c) => '$' + ((c | 0) % 100 ? ((c | 0) / 100).toFixed(2) : String((c | 0) / 100));
const len = (m) => m % 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`;
function hourWords(hm) { const [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; }
/** "Book 2 hours, the last 30 minutes free - Tuesdays, starting 4 PM - 8 PM" */
// (in words a customer reads at a glance - the research, Oct 23 2026: "the last hour free", "Weekdays", "through Nov 30", and a start
// window said as start times so it is not read as the hours of play)
const shortDate = (x) => new Date(x + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
function spanWords(from, to) { return from && to ? `${shortDate(from)} - ${shortDate(to)}` : to ? `through ${shortDate(to)}` : from ? `from ${shortDate(from)}` : ''; }
function words(d) {
  const what = d.kind === 'free_items' ? `get ${itemsWords(d) || 'something'} free at the front desk` : d.kind === 'free_minutes' ? `the last ${d.value === 60 ? 'hour' : len(d.value)} free` : d.kind === 'percent' ? `${d.value}% off` : `${money(d.value)} off`;
  const need = d.min_minutes ? `Book ${len(d.min_minutes)} or more, ` : d.kind === 'free_items' ? 'With any booking, ' : '';
  const PLURAL = { sun: 'Sundays', mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays' };
  const days = csv(d.days), L = require('../public/site-layout.js'), lw = days.length >= 2 ? L.daysWords(days.join(',')) : '';
  const day = !days.length || days.length === 7 ? 'every day' : /^(?:Weekdays|Weekends|\w+ to \w+)$/.test(lw) ? lw : days.map(x => PLURAL[x] || x).join(', ');
  const t = d.start_from && d.start_until ? `, start times ${hourWords(d.start_from)} - ${hourWords(d.start_until)}` : d.start_from ? `, start times from ${hourWords(d.start_from)}` : d.start_until ? `, start times until ${hourWords(d.start_until)}` : '';
  const span = d.date_from || d.date_to ? ` (${spanWords(d.date_from, d.date_to)})` : '';
  const s = `${need}${what} - ${day}${t}${span}`;
  return s[0].toUpperCase() + s.slice(1);
}
/** The deals a customer can see (the booking page): their name and their line. */
function forOnline(today) { return list().filter(d => d.active && d.show_online && (!d.date_to || !today || d.date_to >= today)).map(d => ({ id: d.id, name: d.name, words: d.words || words(d) })); }

/** "2 Bud Light Pitchers" - what a booking comes with, short (the staff pad's badge). */
function itemsShort(booking) { const s = itemsSnapOf(booking); return s ? s.includes.map(x => thingWords(x, x.name)).join(', ') : ''; }

module.exports = { spanWords, ensureSchema, list, get, upsert, remove, fits, centsOff, bestFor, itemsFor, stampItems, itemsSnapOf, itemsLine, itemsShort, itemsWords, includesOf, nameOf, plural, howMany, words, forOnline };
