// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/specials.js - SPECIALS THAT REALLY CHANGE THE PRICE (Oct 22 2026)
//
//  maintainer: "it needs to reflect in the price in the drinks for that night. like if they say tuesday special and an ammount off
//  the beer needs to be that ammount off." Until now a special was words on the website, and the counter charged the menu's
//  price. A special here is the counter's own rule: a name ("Taco Tuesday"), its days or one date, a time (it may run past
//  midnight - "Friday 9 PM to 1 AM" is still Friday's), what it covers (items, whole parts of the menu, every drink, every
//  food, or the whole menu) and the deal (a set price, an amount off, or a percent off). While it is on:
//    - the counter rings the item up at the special's price, the reason on the line ("Taco Tuesday") - on the unit price, so
//      totals, tax, splitting, receipts and refunds all work untouched (the member perks' own path);
//    - a member gets the better of their perk and the special, never both;
//    - the servers' pad shows the special price on the item;
//    - the website's weekly specials show it, live, from the same rule (one special, everywhere).
//  The facility's own clock and time zone decide when a special is on (services/revenue.js tzOf).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const dbM = require('./db');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const D = () => dbM.db;
const csv = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

function ensureSchema() {
  D().exec(`CREATE TABLE IF NOT EXISTS menu_specials (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    days TEXT DEFAULT '',                -- mon,tue,... ('' every day)
    date TEXT DEFAULT '',                -- one day only, YYYY-MM-DD ('' every week)
    start_time TEXT DEFAULT '',          -- HH:MM ('' from opening)
    end_time TEXT DEFAULT '',            -- HH:MM ('' until closing; before start_time = past midnight)
    item_ids TEXT DEFAULT '', category_ids TEXT DEFAULT '',
    tax_category TEXT DEFAULT '',        -- 'beverage' every drink, 'food' every food ('' with no items or parts: the whole menu)
    kind TEXT NOT NULL,                  -- price | off | percent
    value INTEGER NOT NULL,              -- cents (price, off) or whole percent
    words TEXT DEFAULT '',               -- its line on the website
    show_on_site INTEGER DEFAULT 1, active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
}

/** The facility's own date, weekday and HH:MM. */
function clock(now = new Date()) {
  let tz; try { tz = require('./config').getConfig().server.timezone || undefined; } catch {}
  const p = {}, fmt = (zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  let f; try { f = fmt(tz); } catch { f = fmt(undefined); }   // a zone the system does not know: the box's own
  for (const x of f.formatToParts(now)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, dow: String(p.weekday || '').slice(0, 3).toLowerCase(), hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
function dayBefore(c) {
  const d = new Date(c.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return { date: d.toISOString().slice(0, 10), dow: DAYS[d.getUTCDay()] };
}
const dayOk = (sp, date, dow) => (sp.date ? sp.date === date : (!csv(sp.days).length || csv(sp.days).includes(dow)));

/** Is this special on at this moment of the facility's clock? */
function onAt(sp, c) {
  if (!sp || !sp.active) return false;
  const s = sp.start_time || '', e = sp.end_time || '';
  if (!s && !e) return dayOk(sp, c.date, c.dow);
  const start = s || '00:00', end = e || '24:00';
  if (end > start) return dayOk(sp, c.date, c.dow) && c.hm >= start && c.hm < end;
  // past midnight: from its start to midnight on its own day, then on until its end the morning after - still its day
  if (c.hm >= start) return dayOk(sp, c.date, c.dow);
  if (c.hm < end) { const b = dayBefore(c); return dayOk(sp, b.date, b.dow); }
  return false;
}

const taxOf = (item) => {
  if (item.tax_category) return item.tax_category;
  try { const c = D().prepare('SELECT tax_category FROM menu_categories WHERE id=?').get(item.category_id); return (c && c.tax_category) || 'food'; } catch { return 'food'; }
};
/** Does this special cover this menu item? With no items, parts or kind named it covers the whole menu. */
function covers(sp, item) {
  const ids = csv(sp.item_ids), cats = csv(sp.category_ids);
  if (!ids.length && !cats.length && !sp.tax_category) return true;
  return ids.includes(item.id) || cats.includes(item.category_id) || (!!sp.tax_category && sp.tax_category === taxOf(item));
}
/** One unit's price under this special (never above the menu's price, never below nothing). */
function priceUnder(sp, unit) {
  let p = unit;
  if (sp.kind === 'price') p = Math.min(unit, sp.value | 0);
  else if (sp.kind === 'off') p = unit - (sp.value | 0);
  else if (sp.kind === 'percent') p = unit - Math.round(unit * Math.min(100, Math.max(0, sp.value | 0)) / 100);
  return Math.max(0, p);
}

function list() { try { return D().prepare('SELECT * FROM menu_specials ORDER BY active DESC, name').all(); } catch { return []; } }
function get(id) { try { return D().prepare('SELECT * FROM menu_specials WHERE id=?').get(id) || null; } catch { return null; } }

/** The special a menu item is under right now (the lowest price of those on), or null. */
function priceFor(item, c = clock()) {
  if (!item || !(item.price_cents > 0)) return null;
  let best = null;
  for (const sp of list()) {
    if (!onAt(sp, c) || !covers(sp, item)) continue;
    const p = priceUnder(sp, item.price_cents | 0);
    if (p < item.price_cents && (!best || p < best.unit_cents)) best = { unit_cents: p, saved_cents: item.price_cents - p, reason: sp.name, special_id: sp.id };
  }
  return best;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Make or change a special. o: { id?, name, days[], date, start_time, end_time, item_ids[], category_ids[], tax_category, kind, value, words, show_on_site, active } */
function upsert(o) {
  const name = String(o.name || '').trim().slice(0, 60);
  if (!name) throw new Error('a special needs a name');
  const days = (Array.isArray(o.days) ? o.days : csv(o.days)).map(d => String(d).trim().toLowerCase().slice(0, 3)).filter(Boolean);
  const bad = days.find(d => !DAYS.includes(d)); if (bad) throw new Error(`"${bad}" is not a day`);
  const date = String(o.date || '').trim();
  if (date && !DATE.test(date)) throw new Error('the date is YYYY-MM-DD');
  const start = String(o.start_time || '').trim(), end = String(o.end_time || '').trim();
  if (start && !TIME.test(start)) throw new Error('the start time is HH:MM');
  if (end && !TIME.test(end)) throw new Error('the end time is HH:MM');
  if (start && end && start === end) throw new Error('a special starts and ends at different times');
  const items = (Array.isArray(o.item_ids) ? o.item_ids : csv(o.item_ids)).map(String), cats = (Array.isArray(o.category_ids) ? o.category_ids : csv(o.category_ids)).map(String);
  for (const id of items) if (!D().prepare('SELECT 1 FROM menu_items WHERE id=?').get(id)) throw new Error('no menu item ' + id);
  for (const id of cats) if (!D().prepare('SELECT 1 FROM menu_categories WHERE id=?').get(id)) throw new Error('no part of the menu ' + id);
  const tax = String(o.tax_category || '').trim();
  if (tax && !['beverage', 'food'].includes(tax)) throw new Error('the kind covered is "beverage" (every drink) or "food"');
  const kind = String(o.kind || '');
  if (!['price', 'off', 'percent'].includes(kind)) throw new Error('the deal is a price, an amount off or a percent off');
  const value = Math.round(Number(o.value));
  if (!Number.isFinite(value) || value < 0 || (kind === 'percent' && (value < 1 || value > 100)) || (kind !== 'percent' && value > 100000)) throw new Error('the deal\'s amount is out of range');
  const row = { name, days: days.join(','), date, start_time: start, end_time: end, item_ids: items.join(','), category_ids: cats.join(','), tax_category: tax, kind, value,
    words: String(o.words || '').trim().slice(0, 200), show_on_site: o.show_on_site === false || o.show_on_site === 0 ? 0 : 1, active: o.active === false || o.active === 0 ? 0 : 1 };
  const id = o.id && get(o.id) ? String(o.id) : crypto.randomBytes(6).toString('hex');
  D().prepare(`INSERT INTO menu_specials (id,name,days,date,start_time,end_time,item_ids,category_ids,tax_category,kind,value,words,show_on_site,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, days=excluded.days, date=excluded.date, start_time=excluded.start_time, end_time=excluded.end_time,
      item_ids=excluded.item_ids, category_ids=excluded.category_ids, tax_category=excluded.tax_category, kind=excluded.kind, value=excluded.value,
      words=excluded.words, show_on_site=excluded.show_on_site, active=excluded.active, updated_at=datetime('now')`)
    .run(id, row.name, row.days, row.date, row.start_time, row.end_time, row.item_ids, row.category_ids, row.tax_category, row.kind, row.value, row.words, row.show_on_site, row.active);
  return get(id);
}
function remove(id) { const had = !!get(id); try { D().prepare('DELETE FROM menu_specials WHERE id=?').run(id); } catch {} return had; }

// ── words, for the website and the pad ──
const money = (c) => '$' + ((c | 0) % 100 ? ((c | 0) / 100).toFixed(2) : String((c | 0) / 100));
function dealWords(sp) { return sp.kind === 'price' ? money(sp.value) : sp.kind === 'off' ? money(sp.value) + ' off' : (sp.value | 0) + '% off'; }
function hourWords(hm) { const [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; }
function timeWords(sp) { const s = sp.start_time, e = sp.end_time; return s && e ? `${hourWords(s)} - ${hourWords(e)}` : s ? `from ${hourWords(s)}` : e ? `until ${hourWords(e)}` : ''; }
function coverWords(sp) {
  const parts = [];
  const ids = csv(sp.item_ids), cats = csv(sp.category_ids);
  try { for (const id of ids) { const r = D().prepare('SELECT name FROM menu_items WHERE id=?').get(id); if (r) parts.push(r.name); } } catch {}
  try { for (const id of cats) { const r = D().prepare('SELECT name FROM menu_categories WHERE id=?').get(id); if (r) parts.push('every ' + r.name); } } catch {}
  if (sp.tax_category === 'beverage') parts.push('every drink'); else if (sp.tax_category === 'food') parts.push('all food');
  return parts.length ? parts.join(', ') : 'the whole menu';
}
/** The specials the website shows: on the site, every week or a date still ahead - in the weekly specials' own shape. */
function forWebsite(c = clock()) {
  return list().filter(sp => sp.active && sp.show_on_site && (!sp.date || sp.date >= c.date))
    .map(sp => ({ counter: sp.id, title: sp.name, text: sp.words || `${dealWords(sp)} - ${coverWords(sp)}`, price: dealWords(sp), days: sp.days || 'every day', date: sp.date || '', time: timeWords(sp) }));
}

module.exports = { ensureSchema, clock, onAt, covers, priceUnder, priceFor, list, get, upsert, remove, forWebsite, dealWords, timeWords, coverWords, DAYS };
