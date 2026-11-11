// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/packages.js - PACKAGE DEALS (Oct 22 2026)
//
//  maintainer: "Yes definitely allow them to make package deals. For sure any and all sorts of package deals. People will want that."
//  A package is bay time and what comes with it, sold as one price: "2 hours + a pitcher for $60", "Birthday party - 2 hours,
//  up to 8 players, a pizza and a soda each, $25 a person (6 at least)", "Happy hour - 1 hour and 2 beers, weekdays 3 to 6".
//    - its bay time: a fixed length (30 minutes to 4 hours, on the half hour)
//    - its price: flat, or per person with the least and the most players
//    - what it includes at the counter: an item ("a pitcher of Bud Light") or any of a part of the menu ("2 from Beer"),
//      each a number of them in all or per person
//    - when it can be booked: its days, the window its session may START in, and a first and last day if it is seasonal
//    - its tax, the owner's to say (maintainer: "be very very cautious on all things requiring tax and money"): the whole price at the
//      bookings' rate, or at one of the counter's tax codes, or split - its golf part at the bookings' rate and the rest at a
//      counter code. Never a rate the box decided (rule 15: the owner's own policy, never a legal opinion)
//  Bought online, it is the booking's price (paid in full; no member discount, deposit or code on top - the package is the
//  deal), and the booking keeps a snapshot of the package as bought, so a later change to the package never changes a
//  booking already made. At the counter, what it includes rings up at $0 on that booking's tabs ("Included in <package>")
//  until it is used up; anything past that is charged as usual. A void gives the included one back.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const dbM = require('./db');

const D = () => dbM.db;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const csv = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/, DATE = /^\d{4}-\d{2}-\d{2}$/;

function ensureSchema() {
  D().exec(`CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    words TEXT DEFAULT '',               -- what customers read about it
    minutes INTEGER NOT NULL,            -- its bay time (30-240, on the half hour)
    price_type TEXT DEFAULT 'flat',      -- flat | per_person
    price_cents INTEGER NOT NULL,        -- the price, or the price a person
    min_players INTEGER DEFAULT 1, max_players INTEGER DEFAULT 0,   -- 0: no most
    includes TEXT DEFAULT '[]',          -- JSON [{ kind: 'item'|'part', id, qty, per_person }]
    days TEXT DEFAULT '',                -- mon,tue,... ('' every day)
    start_from TEXT DEFAULT '', start_until TEXT DEFAULT '',        -- the window its session may start in ('' any time)
    date_from TEXT DEFAULT '', date_to TEXT DEFAULT '',             -- its first and last day ('' always)
    tax_mode TEXT DEFAULT 'bookings',    -- bookings | code | split
    tax_code TEXT DEFAULT '',            -- the counter's tax code (code, split)
    golf_cents INTEGER DEFAULT 0,        -- split: the golf part of the price (a person, when priced per person)
    sell_online INTEGER DEFAULT 1, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
}
function list() { try { ensureSchema(); return D().prepare('SELECT * FROM packages ORDER BY active DESC, sort, name').all(); } catch { return []; } }
function get(id) { try { ensureSchema(); return D().prepare('SELECT * FROM packages WHERE id=?').get(String(id || '')) || null; } catch { return null; } }
const includesOf = (pkg) => { try { const a = JSON.parse((pkg && pkg.includes) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

// ── the counter's tax codes and the bookings' tax, as set by the owner ──
function taxCodes() { try { return require('./pos').getTaxCodes(); } catch { return []; } }
function bookingsRate() { const t = require('./config').getConfig().tax || {}; return t.enabled && Number(t.rate) > 0 ? Number(t.rate) : 0; }
function codeOf(id) { return taxCodes().find(c => c.id === id) || null; }

/** Save a package (a new one, or the one with this id). Every refusal names what is wrong. */
function upsert(o) {
  ensureSchema();
  const name = String(o.name || '').trim().slice(0, 60);
  if (!name) throw new Error('a package needs a name');
  const minutes = Math.round(Number(o.minutes));
  if (!(minutes >= 30 && minutes <= 240 && minutes % 30 === 0)) throw new Error('its bay time is 30 minutes to 4 hours, on the half hour');
  const price_type = o.price_type === 'per_person' ? 'per_person' : 'flat';
  const price_cents = Math.round(Number(o.price_cents));
  if (!(Number.isFinite(price_cents) && price_cents >= 0 && price_cents <= 1000000)) throw new Error('its price is out of range');
  const min_players = Math.max(1, Math.round(Number(o.min_players) || 1)), max_players = Math.max(0, Math.round(Number(o.max_players) || 0));
  if (max_players && max_players < min_players) throw new Error('the most players is less than the least');
  const inc = (Array.isArray(o.includes) ? o.includes : (() => { try { return JSON.parse(o.includes || '[]'); } catch { return []; } })()).map(x => ({
    kind: x.kind === 'part' ? 'part' : 'item', id: String(x.id || ''), qty: Math.max(1, Math.round(Number(x.qty) || 1)), per_person: !!x.per_person }));
  // (maintainer: "not every place will be staffed with food and drink"): a facility with no food and drink at the counter sells bay time
  if (inc.length && ((require('./config').getConfig().pos || {}).fnb === false)) throw new Error('this facility has no food and drink at the counter (Settings > Staff > The Counter: Food & Drink off) - a package here is bay time only, or switch food and drink on first');
  for (const x of inc) {
    const row = x.kind === 'part' ? D().prepare('SELECT id FROM menu_categories WHERE id=?').get(x.id) : D().prepare('SELECT id FROM menu_items WHERE id=?').get(x.id);
    if (!row) throw new Error(`no ${x.kind === 'part' ? 'part of the menu' : 'menu item'} ${x.id}`);
  }
  const days = (Array.isArray(o.days) ? o.days : csv(o.days)).map(d => String(d).trim().toLowerCase().slice(0, 3)).filter(Boolean);
  const bad = days.find(d => !DAYS.includes(d)); if (bad) throw new Error(`"${bad}" is not a day`);
  const start_from = String(o.start_from || '').trim(), start_until = String(o.start_until || '').trim();
  if (start_from && !TIME.test(start_from)) throw new Error('the earliest start is HH:MM');
  if (start_until && !TIME.test(start_until)) throw new Error('the latest start is HH:MM');
  if (start_from && start_until && start_until < start_from) throw new Error('the latest start is before the earliest');
  const date_from = String(o.date_from || '').trim(), date_to = String(o.date_to || '').trim();
  if ((date_from && !DATE.test(date_from)) || (date_to && !DATE.test(date_to))) throw new Error('its first and last day are YYYY-MM-DD');
  if (date_from && date_to && date_to < date_from) throw new Error('its last day is before its first');
  const tax_mode = ['bookings', 'code', 'split'].includes(o.tax_mode) ? o.tax_mode : 'bookings';
  const tax_code = String(o.tax_code || '').trim();
  if (tax_mode !== 'bookings' && !codeOf(tax_code)) throw new Error(`"${tax_code}" is not one of the counter's tax codes`);
  const golf_cents = tax_mode === 'split' ? Math.round(Number(o.golf_cents) || 0) : 0;
  if (tax_mode === 'split' && !(golf_cents >= 0 && golf_cents <= price_cents)) throw new Error('the golf part is more than the price');
  const row = { name, words: String(o.words || '').trim().slice(0, 300), minutes, price_type, price_cents, min_players, max_players, includes: JSON.stringify(inc),
    days: days.join(','), start_from, start_until, date_from, date_to, tax_mode, tax_code: tax_mode === 'bookings' ? '' : tax_code, golf_cents,
    sell_online: o.sell_online === false || o.sell_online === 0 ? 0 : 1, active: o.active === false || o.active === 0 ? 0 : 1, sort: Math.round(Number(o.sort) || 0) };
  const id = o.id && get(o.id) ? String(o.id) : crypto.randomBytes(6).toString('hex');
  D().prepare(`INSERT INTO packages (id,name,words,minutes,price_type,price_cents,min_players,max_players,includes,days,start_from,start_until,date_from,date_to,tax_mode,tax_code,golf_cents,sell_online,active,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, words=excluded.words, minutes=excluded.minutes, price_type=excluded.price_type, price_cents=excluded.price_cents,
      min_players=excluded.min_players, max_players=excluded.max_players, includes=excluded.includes, days=excluded.days, start_from=excluded.start_from,
      start_until=excluded.start_until, date_from=excluded.date_from, date_to=excluded.date_to, tax_mode=excluded.tax_mode, tax_code=excluded.tax_code,
      golf_cents=excluded.golf_cents, sell_online=excluded.sell_online, active=excluded.active, sort=excluded.sort, updated_at=datetime('now')`)
    .run(id, row.name, row.words, row.minutes, row.price_type, row.price_cents, row.min_players, row.max_players, row.includes, row.days, row.start_from, row.start_until,
      row.date_from, row.date_to, row.tax_mode, row.tax_code, row.golf_cents, row.sell_online, row.active, row.sort);
  return get(id);
}
/** Take a package off for good. Bookings already made keep it: each carries its own snapshot. */
function remove(id) { const had = !!get(id); try { D().prepare('DELETE FROM packages WHERE id=?').run(String(id || '')); } catch {} return had; }

// ── when it can be booked ──
const dowOf = (date) => DAYS[new Date(date + 'T12:00:00Z').getUTCDay()];
/** Can this package's session start on this day at this time? { ok, why } - the why in a customer's words. */
function availableAt(pkg, date, start, opts = {}) {
  if (!pkg || !pkg.active) return { ok: false, why: 'That package is not offered right now.' };
  if (opts.online && !pkg.sell_online) return { ok: false, why: 'That package is booked at the counter, not online.' };
  if (pkg.date_from && date < pkg.date_from) return { ok: false, why: `That package starts on ${pkg.date_from}.` };
  if (pkg.date_to && date > pkg.date_to) return { ok: false, why: `That package ended on ${pkg.date_to}.` };
  const days = csv(pkg.days);
  if (days.length && !days.includes(dowOf(date))) return { ok: false, why: `That package is offered on ${days.map(d => d[0].toUpperCase() + d.slice(1)).join(', ')}.` };
  if (start && pkg.start_from && start < pkg.start_from) return { ok: false, why: `That package starts at ${pkg.start_from} at the earliest.` };
  if (start && pkg.start_until && start > pkg.start_until) return { ok: false, why: `That package starts by ${pkg.start_until} at the latest.` };
  return { ok: true };
}
/** The players a package is for: the number asked, held to its least and most. Null and a reason when it cannot be. */
function playersFor(pkg, asked) {
  const n = Math.round(Number(asked) || 0) || pkg.min_players || 1;
  if (n < (pkg.min_players || 1)) return { error: `That package is for ${pkg.min_players} players at the least.` };
  if (pkg.max_players && n > pkg.max_players) return { error: `That package is for ${pkg.max_players} players at the most.` };
  return { players: n };
}
/** Its price for this many players, in cents. */
const priceFor = (pkg, players) => pkg.price_type === 'per_person' ? pkg.price_cents * Math.max(players || 1, pkg.min_players || 1) : pkg.price_cents;

/** Its tax, the owner's way: lines { label, cents, rate, category } and the tax of each, rounded a line at a time. */
function taxFor(pkg, players) {
  const total = priceFor(pkg, players), heads = pkg.price_type === 'per_person' ? Math.max(players || 1, pkg.min_players || 1) : 1;
  const code = codeOf(pkg.tax_code);
  let lines;
  if (pkg.tax_mode === 'code' && code) lines = [{ label: pkg.name, cents: total, rate: Number(code.rate) || 0, category: code.id }];
  else if (pkg.tax_mode === 'split' && code) {
    const golf = Math.min(total, (pkg.golf_cents | 0) * heads);
    lines = [{ label: 'Golf', cents: golf, rate: bookingsRate(), category: 'sim' }, { label: code.name, cents: total - golf, rate: Number(code.rate) || 0, category: code.id }].filter(l => l.cents > 0);
  } else lines = [{ label: pkg.name, cents: total, rate: bookingsRate(), category: 'sim' }];
  for (const l of lines) l.tax_cents = Math.round(l.cents * l.rate / 100);
  return { lines, subtotal_cents: total, tax_cents: lines.reduce((a, l) => a + l.tax_cents, 0) };
}

// ── words ──
const money = (c) => '$' + ((c | 0) % 100 ? ((c | 0) / 100).toFixed(2) : String((c | 0) / 100));
const hrs = (m) => m % 60 ? `${m / 60} hours`.replace(/^0\.5 hours$/, '30 minutes') : `${m / 60} hour${m === 60 ? '' : 's'}`;
function nameOf(x) {
  try { const r = x.kind === 'part' ? D().prepare('SELECT name FROM menu_categories WHERE id=?').get(x.id) : D().prepare('SELECT name FROM menu_items WHERE id=?').get(x.id); return r ? r.name : '(gone from the menu)'; } catch { return '?'; }
}
/** "a Pitcher, 2 from Beer a person" - what it includes, in words. */
function includesWords(pkg) {
  const inc = includesOf(pkg);
  if (!inc.length) return '';
  return inc.map(x => `${require('./deals').howMany(nameOf(x), x.qty, x.kind)}${x.per_person ? ' a person' : ''}`).join(', ');
}
function hourWords(hm) { const [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; }
function whenWords(pkg) {
  const days = csv(pkg.days), d = days.length ? days.map(x => x[0].toUpperCase() + x.slice(1)).join(', ') : 'every day';
  const t = pkg.start_from && pkg.start_until ? `starting ${hourWords(pkg.start_from)} - ${hourWords(pkg.start_until)}` : pkg.start_from ? `starting from ${hourWords(pkg.start_from)}` : pkg.start_until ? `starting by ${hourWords(pkg.start_until)}` : '';
  const span = pkg.date_from || pkg.date_to ? ` (${pkg.date_from || 'now'} to ${pkg.date_to || 'on'})` : '';
  return [d, t].filter(Boolean).join(', ') + span;
}
function priceWords(pkg) {
  return pkg.price_type === 'per_person' ? `${money(pkg.price_cents)} a person (${pkg.min_players} at the least${pkg.max_players ? `, ${pkg.max_players} at the most` : ''})`
    : `${money(pkg.price_cents)}${pkg.max_players ? ` for up to ${pkg.max_players} players` : ''}`;
}
function taxWords(pkg) {
  const code = codeOf(pkg.tax_code);
  if (pkg.tax_mode === 'code' && code) return `taxed as ${code.name} (${Number(code.rate) || 0}%)`;
  if (pkg.tax_mode === 'split' && code) return `the golf part (${money(pkg.golf_cents)}${pkg.price_type === 'per_person' ? ' a person' : ''}) taxed as a booking (${bookingsRate()}%), the rest as ${code.name} (${Number(code.rate) || 0}%)`;
  return `taxed as a booking (${bookingsRate()}%)`;
}
/** What a customer reads about it (the booking page, the website): nothing internal. */
function forCustomer(pkg) {
  return { id: pkg.id, name: pkg.name, words: pkg.words || '', minutes: pkg.minutes, length: hrs(pkg.minutes), price_type: pkg.price_type, price_cents: pkg.price_cents,
    price: priceWords(pkg), min_players: pkg.min_players, max_players: pkg.max_players, includes: includesWords(pkg), when: whenWords(pkg),
    days: pkg.days, start_from: pkg.start_from, start_until: pkg.start_until, date_from: pkg.date_from, date_to: pkg.date_to };
}
/** The packages a customer can book online (today's and later ones). */
function forOnline(today) { return list().filter(p => p.active && p.sell_online && (!p.date_to || !today || p.date_to >= today)).map(forCustomer); }

// ── the booking's own copy, and the counter ──
/** What a booking keeps of the package it was bought with - never changed by a later change to the package. */
function snapshot(pkg, players) {
  const heads = Math.max(players || 1, pkg.min_players || 1);
  const tax = taxFor(pkg, players);
  return { id: pkg.id, name: pkg.name, minutes: pkg.minutes, players: heads, price_cents: priceFor(pkg, players), tax,
    includes: includesOf(pkg).map((x, i) => ({ key: `${pkg.id}:${i}`, kind: x.kind, id: x.id, name: nameOf(x), qty: x.qty * (x.per_person ? heads : 1) })) };
}
const snapOf = (booking) => { try { const s = JSON.parse((booking && booking.package_json) || ''); return s && Array.isArray(s.includes) ? s : null; } catch { return null; } };
/** How many of one included thing this booking has used, on every tab it has (a voided line given back). */
function usedOf(bookingId, key) {
  try { return Number((D().prepare(`SELECT COALESCE(SUM(ti.qty),0) AS n FROM tab_items ti JOIN tabs t ON t.id = ti.tab_id WHERE t.booking_id = ? AND ti.package_include = ? AND COALESCE(ti.status,'sent') != 'voided'`).get(bookingId, key) || {}).n) || 0; } catch { return 0; }
}
/** What is left of a booking's package: each included thing, its number in all, used and left. */
function leftFor(booking) {
  const s = snapOf(booking); if (!s) return null;
  return { name: s.name, players: s.players, includes: s.includes.map(x => { const used = usedOf(booking.id, x.key); return Object.assign({}, x, { used, left: Math.max(0, x.qty - used) }); }) };
}
/** At the counter: the included thing an item on this tab is, and how many are left of it - or null (charged as usual). The
 *  booking's package first, then what a free-things deal gave it (services/deals.js - "2 pitchers free with 2 hours", Oct 22 2026,
 *  night: the same $0 line, its own key) */
function includedFor(tabId, item) {
  if (!tabId || !item) return null;
  try {
    const tab = D().prepare('SELECT booking_id FROM tabs WHERE id=?').get(tabId);
    if (!tab || !tab.booking_id) return null;
    const bk = D().prepare('SELECT id, package_json, deal_items_json FROM bookings WHERE id=?').get(tab.booking_id);
    for (const s of [snapOf(bk), require('./deals').itemsSnapOf(bk)]) {
      if (!s) continue;
      // the item named outright first, then a part of the menu it is in
      const order = s.includes.filter(x => x.kind === 'item' && x.id === item.id).concat(s.includes.filter(x => x.kind === 'part' && x.id === item.category_id));
      for (const x of order) { const left = x.qty - usedOf(bk.id, x.key); if (left > 0) return { key: x.key, left, package: s.name }; }
    }
  } catch {}
  return null;
}
/** What is left of a booking's free things from a deal: each thing, its number, used and left - or null. */
function dealLeftFor(booking) {
  const s = require('./deals').itemsSnapOf(booking); if (!s) return null;
  const D2 = require('./deals');
  return { name: s.name, includes: s.includes.map(x => { const used = usedOf(booking.id, x.key); return Object.assign({}, x, { used, left: Math.max(0, x.qty - used), words: D2.howMany(x.name, x.qty, x.kind) }); }) };
}

module.exports = { ensureSchema, list, get, upsert, remove, includesOf, availableAt, playersFor, priceFor, taxFor, snapshot, snapOf, leftFor, dealLeftFor, includedFor,
  forCustomer, forOnline, includesWords, whenWords, priceWords, taxWords, money, hrs, DAYS };
