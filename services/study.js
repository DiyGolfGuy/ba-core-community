// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/study.js - THE FACILITY, STUDIED IN ITS QUIET HOURS (Oct 25 2026)
//
//  maintainer, Oct 25 2026: "The AI over time should know what the facility owner asks most frequently so it can answers quicker over time.
//  Always real data never guessed. So the Ai will.learn and study the facility in down times and see growth progress revenue over
//  time busy months slow months if a special actually worked and got more people in. Even through it was a special did more people
//  come in so they actually made more money. For facilities that run special etc"
//
//  Every figure here is worked out from the unit's own records - nothing estimated, nothing remembered by a model:
//   - trends(): month by month for up to two years - the money taken (services/revenue.js, the one definition), the bookings, the
//     hours played, the players (by their phone number) and the members who signed up; the busiest and the slowest whole month;
//     this year so far against the same days last year, and the last three whole months against the same three a year before;
//   - specials(): each counter special against the days before it started - its own days (its weekdays since it began, at most the
//     last eight) beside the same weekdays just before it: bookings, players and money taken a day, and what sold at the special's
//     price (the line it rang up carries its name - services/pos.js). The days are put side by side; what else changed (the weather,
//     a holiday, a league) the unit cannot know, and the answer says so - it says what came in, never why.
//  It is worked out at 4:30 each night (services/scheduler.js - the quiet hours, before the records' nightly) and kept, so the
//  owner's question is answered at once - with when it was worked out; a day with no study yet (a box started after 4:30) works it
//  out when first asked.
//  And what the owner asks: each question the box answers from its own records is counted (asks), so the questions they ask most
//  lead the cards, and a card asked often is answered straight from the records (services/assistant/engine.js).
// ═════════════════════════════════════════════════════════════════════════════
'use strict';
const dbM = require('./db');
const rv = require('./revenue');

const D = () => dbM.db;
const all = (sql, ...p) => { try { return D().prepare(sql).all(...p); } catch { return []; } };
const one = (sql, ...p) => { try { return D().prepare(sql).get(...p) || {}; } catch { return {}; } };
const pad = (n) => String(n).padStart(2, '0');
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();

let ready = false;
function ensureSchema() {
  if (ready) return;
  // (rule 14: two new tables, nothing changed; what is in them is worked out again from the records any time)
  D().exec(`CREATE TABLE IF NOT EXISTS facility_study (kind TEXT PRIMARY KEY, day TEXT DEFAULT '', json TEXT DEFAULT '', computed_at TEXT DEFAULT '')`);
  D().exec(`CREATE TABLE IF NOT EXISTS assistant_asks (what TEXT PRIMARY KEY, count INTEGER DEFAULT 0, last_at TEXT DEFAULT '')`);
  ready = true;
}

const monthOf = (d) => d.slice(0, 7);
const monthAdd = (m, n) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${pad(mo)}`; };
const monthEnd = (m) => `${m}-${pad(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate())}`;
const yearBack = (d) => { const y = +d.slice(0, 4) - 1, m = +d.slice(5, 7); return `${y}-${pad(m)}-${pad(Math.min(+d.slice(8, 10), new Date(Date.UTC(y, m, 0)).getUTCDate()))}`; };
const kept = `status IN ('active','completed') AND COALESCE(booking_type,'customer') = 'customer'`;

/** The first day the unit holds anything: a booking, a member, a payment, a counter sale. */
function firstRecord() {
  const tz = rv.tzOf();
  const days = [one(`SELECT MIN(date) AS d FROM bookings WHERE ${kept}`).d, rv.localDate(one(`SELECT MIN(created_at) AS d FROM members`).d, tz),
    rv.localDate(one(`SELECT MIN(paid_at) AS d FROM membership_payments`).d, tz), rv.localDate(one(`SELECT MIN(sent_at) AS d FROM tab_items`).d, tz)].filter(Boolean).sort();
  return days[0] || null;
}
// the money taken a day or a month (services/revenue.js series - money actually taken, minus refunds)
const moneyBy = (from, to, unit) => { const m = rv.series(from, to, unit), out = {}; for (const [k, v] of m) out[k] = v.revenue_cents; return out; };
// bookings, hours and players (a player is a phone number) over [from, to], grouped by the key of a date
function playBy(from, to, key) { return playOf(all(`SELECT date, duration_minutes, phone, name FROM bookings WHERE ${kept} AND date >= ? AND date <= ?`, from, to), key); }
function playOf(rows, key) {
  const out = {};
  for (const b of rows) {
    const k = key(b.date), o = out[k] || (out[k] = { bookings: 0, minutes: 0, players: new Set() });
    o.bookings++; o.minutes += Number(b.duration_minutes) || 0; o.players.add(String(b.phone || b.name || '').replace(/\D/g, '') || String(b.name || '').toLowerCase());
  }
  return out;
}

/** Month by month for up to two years, the busiest and slowest whole month, and the growth against a year before. */
function trends(today) {
  const t = today || rv.facilityToday(), first = firstRecord();
  if (!first) return { first_record: null, months: [] };
  const thisMonth = monthOf(t), from = monthOf(first) > monthAdd(thisMonth, -23) ? monthOf(first) : monthAdd(thisMonth, -23);
  // (the money and the bookings read ONCE for the whole window, a day at a time - every month and every comparison is added up from
  // them: a busy two years took 17 s when each comparison read its own; Oct 25 2026)
  const daily = moneyBy(from + '-01', t, 'day'), rows = all(`SELECT date, duration_minutes, phone, name FROM bookings WHERE ${kept} AND date >= ? AND date <= ?`, from + '-01', t);
  const money = {}; for (const [d, c] of Object.entries(daily)) money[monthOf(d)] = (money[monthOf(d)] || 0) + c;
  const play = playOf(rows, monthOf);
  const joined = {}; const tz = rv.tzOf();
  for (const m of all(`SELECT created_at FROM members`)) { const d = rv.localDate(m.created_at, tz); if (d && d >= from + '-01') joined[monthOf(d)] = (joined[monthOf(d)] || 0) + 1; }
  const months = [];
  for (let m = from; m <= thisMonth; m = monthAdd(m, 1)) {
    const p = play[m] || { bookings: 0, minutes: 0, players: new Set() };
    months.push({ month: m, so_far: m === thisMonth, revenue_cents: money[m] || 0, bookings: p.bookings, hours: Math.round(p.minutes / 6) / 10, players: p.players.size, joined: joined[m] || 0 });
  }
  // a whole month only, and only one the unit held from its start
  const whole = months.filter(x => !x.so_far && (x.month > monthOf(first) || first.slice(8, 10) === '01'));
  const pick = (cmp) => whole.length >= 2 ? whole.slice().sort(cmp)[0] : null;
  const busiest = pick((a, b) => b.revenue_cents - a.revenue_cents || b.bookings - a.bookings), slowest = pick((a, b) => a.revenue_cents - b.revenue_cents || a.bookings - b.bookings);
  const sum = (a, z) => { const p = playOf(rows.filter(b => b.date >= a && b.date <= z), () => 'all').all || { bookings: 0, players: new Set() };
    return { revenue_cents: Object.entries(daily).reduce((s, [d, v]) => s + (d >= a && d <= z ? v : 0), 0), bookings: p.bookings, players: p.players.size }; };
  const ytdFrom = t.slice(0, 4) + '-01-01', lyFrom = yearBack(ytdFrom), lyTo = yearBack(t);
  const growth = { this_year: { from: ytdFrom, to: t, now: sum(ytdFrom, t), year_before: lyTo >= first ? sum(lyFrom, lyTo) : null, before_records: lyTo < first } };
  const w3 = whole.slice(-3);
  if (w3.length === 3) {
    const a = w3[0].month + '-01', z = monthEnd(w3[2].month), ya = yearBack(a), yz = monthEnd(monthOf(yearBack(z)));
    growth.last_three_months = { from: a, to: z, now: sum(a, z), year_before: yz >= first ? sum(ya, yz) : null, before_records: yz < first };
  }
  return { first_record: first, months, busiest, slowest, growth };
}

// the days a special or a deal runs on: its one date, or its weekdays ('' every day) - a deal inside its own first and last day
const runsOn = (sp, d) => (sp.date ? d === sp.date : (!sp.date_from || d >= sp.date_from) && (!sp.date_to || d <= sp.date_to)
  && (!String(sp.days || '').trim() || String(sp.days).split(',').map(x => x.trim()).includes(WD[dow(d)])));
/** Each counter special: its own days since it began, beside the same days before it started. */
function specials(today) {
  const t = today || rv.facilityToday(), first = firstRecord(), tz = rv.tzOf(), out = [];
  // the counter's specials, and the booking deals (services/deals.js - "the last 30 minutes free on Tuesdays"): a booking that took a
  // deal carries its name (bookings.deal_name, deal_cents), as a counter line carries its special's
  const list = all(`SELECT * FROM menu_specials ORDER BY created_at`).map(x => Object.assign(x, { kind: 'special' }))
    .concat(all(`SELECT * FROM booking_deals ORDER BY created_at`).map(x => Object.assign({}, x, { kind: 'deal', deal_kind: x.kind })));
  if (!list.length) return { specials: out };
  // (the money, the bookings and the specials' own sales read ONCE, from the earliest day any special is put against)
  const earliest = list.map(sp => rv.addDays(rv.localDate(sp.created_at, tz) || t, -400)).sort()[0];
  const daily = moneyBy(earliest, t, 'day'), rows = all(`SELECT date, duration_minutes, phone, name, deal_name, deal_cents FROM bookings WHERE ${kept} AND date >= ? AND date <= ?`, earliest, t);
  const sales = all(`SELECT qty, unit_price_cents, note, sent_at FROM tab_items WHERE status != 'voided' AND note != '' AND note IS NOT NULL`).map(i => Object.assign(i, { day: rv.localDate(i.sent_at, tz) }));
  for (const sp of list) {
    const made = rv.localDate(sp.created_at, tz) || t, start = sp.date_from && sp.date_from > made ? sp.date_from : made, on = [];
    for (let d = start; d <= t && on.length < 400; d = rv.addDays(d, 1)) if (runsOn(sp, d)) on.push(d);
    const run = on.slice(-8);
    if (!run.length) { out.push({ kind: sp.kind, name: sp.name, active: !!sp.active, started: start, days: [], note: 'it has not had one of its days yet' }); continue; }
    // the same days before it began: the same weekdays, as many as it has had (a special every day: the days just before it)
    const before = [];
    for (let d = rv.addDays(start, -1); before.length < run.length && d >= rv.addDays(start, -400); d = rv.addDays(d, -1)) if (sp.date ? dow(d) === dow(sp.date) : runsOn(Object.assign({}, sp, { date: '', date_from: '', date_to: '' }), d)) before.push(d);
    const side = (days) => {
      if (!days.length) return null;
      const set = new Set(days), a = days.slice().sort()[0], z = days.slice().sort().slice(-1)[0];
      const play = playOf(rows.filter(b => set.has(b.date)), () => 'in').in || { bookings: 0, players: new Set() };
      let sold = 0, soldCents = 0;
      if (sp.kind === 'deal') { for (const b of rows) if (set.has(b.date) && b.deal_name === sp.name) { sold++; soldCents += Number(b.deal_cents) || 0; } }   // (a deal: the bookings that took it, and what it gave off)
      else for (const i of sales) if (set.has(i.day) && String(i.note).includes(sp.name)) { sold += Number(i.qty) || 0; soldCents += Math.round((Number(i.qty) || 0) * (Number(i.unit_price_cents) || 0)); }
      const n = days.length, cents = days.reduce((s, d) => s + (daily[d] || 0), 0);
      return { days: n, from: a, to: z, bookings: play.bookings, players: play.players.size, revenue_cents: cents,
        a_day: { bookings: Math.round(play.bookings / n * 10) / 10, players: Math.round(play.players.size / n * 10) / 10, revenue_cents: Math.round(cents / n) }, sold, sold_cents: soldCents };
    };
    const now = side(run), was = before.length && first && before.slice().sort()[0] >= first ? side(before) : null;
    out.push({ kind: sp.kind, name: sp.name, active: !!sp.active, started: start, every: sp.date ? 'one day' : (String(sp.days || '').trim() || 'every day'), with_it: now, before_it: was,
      before_records: !was ? (before.length ? 'the unit has no records from before it began' : 'no days before it') : undefined });
  }
  return { specials: out };
}

/** The study, kept: worked out at night, or when first asked on a day with none. kind: 'trends' | 'specials'. */
function get(kind, opts) {
  ensureSchema();
  const o = opts || {}, today = o.today || rv.facilityToday();
  const row = one(`SELECT * FROM facility_study WHERE kind = ?`, kind);
  // (kept for the day it was worked out - the night's study answers at once all day, and says when it was worked out; a busy two
  // years takes seconds to work out, Oct 25 2026)
  const fresh = row.day === today && !!row.computed_at && !o.force;
  if (fresh) { try { return Object.assign(JSON.parse(row.json), { computed_at: row.computed_at, kept: true }); } catch {} }
  const val = kind === 'trends' ? trends(today) : specials(today), at = new Date().toISOString();
  try { D().prepare(`INSERT OR REPLACE INTO facility_study (kind, day, json, computed_at) VALUES (?, ?, ?, ?)`).run(kind, today, JSON.stringify(val), at); } catch {}
  return Object.assign(val, { computed_at: at, kept: false });
}
/** The night's study (services/scheduler.js, 4:30): both kinds worked out again. */
function runNightly() { ensureSchema(); for (const k of ['trends', 'specials']) get(k, { force: true }); }

/** What the owner asked, answered from the box's own records: counted - the cards they ask most lead. */
function noteAsk(what) {
  try { ensureSchema(); D().prepare(`INSERT INTO assistant_asks (what, count, last_at) VALUES (?, 1, datetime('now')) ON CONFLICT(what) DO UPDATE SET count = count + 1, last_at = datetime('now')`).run(String(what).slice(0, 80)); } catch {}
}
function askCounts() { try { ensureSchema(); const o = {}; for (const r of all(`SELECT what, count FROM assistant_asks`)) o[r.what] = Number(r.count) || 0; return o; } catch { return {}; } }

module.exports = { trends, specials, get, runNightly, noteAsk, askCounts, firstRecord, ensureSchema };
