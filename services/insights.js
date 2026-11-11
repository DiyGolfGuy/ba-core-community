// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/insights.js - WHAT THE UNIT TRACKS, AS ANSWERS (Oct 20 2026, late)
//
// maintainer: "checking who is playing. Profit that month memberships sold, how many books are we up from last week or month. How
// many bookings tmr. Longest booking tmr. all that good stuff ... think of everything we track and the AI can do something
// with it and turn it into usable information for the owner ... tell them how much tax they collected and export the tax in
// the chat as an excel". One place the assistant reads (routes/admin.js /insights/period, /insights/day, /insights/now, /tax/
// export.xlsx). Every money figure is services/revenue.js - rule 38, one definition of revenue, money actually taken minus
// refunds; the unit knows no costs, so "profit" is the owner's to work out from it. A person is a first name and a last
// initial, cut the way the assistant cuts a customer's name (areas/operations.js shortName: a word holding an @ or a run of
// digits - an email or a phone typed into the name box - never comes through). Nothing here is written.
'use strict';
const dbM = require('./db');
const rv = require('./revenue');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// a customer as the assistant reads them (these routes answer the assistant): the whole name on the box's own AI, the first
// name and last initial with the owner's own AI service (services/assistant/privacy.js - maintainer, Oct 21 2026, latest)
function who(full) { return require('./assistant/privacy').name(full); }
const spanDays = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1;
const change = (now, was) => (was ? Math.round(((now - was) / was) * 1000) / 10 : null);
const all = (sql, ...p) => { try { return dbM.db.prepare(sql).all(...p); } catch { return []; } };
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
// where a booking is: its bay - or, for a booking of the whole facility, the whole facility (it is stored under the business's name;
// "Example Club Golf: Sam P." read like a bay - the facility walk, Oct 25 2026)
const placeOf = (b) => (Number(b.whole_facility) ? 'the whole facility' : (b.bay_name || ''));

// the customers' sessions in a range of facility dates (blocks and staff holds are not bookings - the revenue report's own
// filter), with each kept one's length
function sessions(from, to) {
  return all(`SELECT id, name, date, start_time, end_time, duration_minutes, bay_id, bay_name, member_id, status, whole_facility FROM bookings
    WHERE COALESCE(booking_type,'customer') = 'customer' AND date >= ? AND date <= ? ORDER BY date, start_time`, from, to);
}
const kept = (list) => list.filter(b => b.status === 'active' || b.status === 'completed');
const longestOf = (list) => {
  const b = list.slice().sort((x, y) => (Number(y.duration_minutes) || 0) - (Number(x.duration_minutes) || 0) || String(x.date + x.start_time).localeCompare(y.date + y.start_time))[0];
  return b ? { who: who(b.name), date: b.date, start: b.start_time, end: b.end_time, minutes: Number(b.duration_minutes) || 0, bay: placeOf(b) } : null;
};

/** The bookings in a range: how many, the hours, the cancelled, the members', the longest, the busiest day and hour, by bay. */
function bookingStats(from, to) {
  const list = sessions(from, to), k = kept(list);
  const mins = k.reduce((s, b) => s + (Number(b.duration_minutes) || 0), 0);
  const tally = (key) => { const o = {}; for (const b of k) { const v = key(b); o[v] = (o[v] || 0) + 1; } return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const day = tally(b => WEEKDAYS[new Date(b.date + 'T12:00:00Z').getUTCDay()])[0], hour = tally(b => String(b.start_time).slice(0, 2))[0];
  return {
    count: k.length, hours: Math.round(mins / 6) / 10, cancelled: list.filter(b => b.status === 'cancelled').length, by_members: k.filter(b => b.member_id).length,
    average_minutes: k.length ? Math.round(mins / k.length) : 0, longest: longestOf(k),
    busiest_weekday: day ? { day: day[0], bookings: day[1] } : null, busiest_start: hour ? { hour: hour[0] + ':00', bookings: hour[1] } : null,
    by_bay: Object.fromEntries(tally(b => placeOf(b) || 'any bay'))
  };
}

// the counter's tax, by tax category, at the rates set today (the counter keeps its sales, not the rate charged - the
// year-end report says the same, services/yearexport.js)
function counterTax(from, to) {
  const pos = require('./pos'), tz = rv.tzOf(), [u0, u1] = rv.utcWindow(from, to);
  const rates = ((pos.posCfg(require('./config').getConfig()).tax || {}).categories) || {};
  const cat = {};
  for (const i of all(`SELECT * FROM tab_items WHERE sent_at >= ? AND sent_at < ?`, u0, u1)) {
    const d = rv.localDate(i.sent_at, tz); if (d < from || d > to) continue;
    const c = pos.lineCents(i), k = i.tax_category || 'food';
    cat[k] = cat[k] || { sales_cents: 0, tax_cents: 0, lines: 0, rate: Number(rates[k] || 0) };
    cat[k].sales_cents += c; cat[k].lines++; cat[k].tax_cents += Math.round(c * Number(rates[k] || 0) / 100);
  }
  return Object.entries(cat).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => Object.assign({ category: k }, v));
}

// new members and membership payments, by the facility's dates (each read by its date part a day either side, then by its
// local date - a join time and a payment time are not kept in the same format)
function memberships(from, to) {
  const tz = rv.tzOf(), lo = rv.addDays(from, -1), hi = rv.addDays(to, 1), inRange = (ts) => { const d = rv.localDate(ts, tz); return d >= from && d <= to; };
  const joined = all(`SELECT created_at FROM members WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`, lo, hi).filter(m => inRange(m.created_at)).length;
  const pays = all(`SELECT amount_cents, paid_at FROM membership_payments WHERE substr(paid_at, 1, 10) >= ? AND substr(paid_at, 1, 10) <= ?`, lo, hi).filter(p => inRange(p.paid_at));
  const active = (all(`SELECT COUNT(*) AS n FROM members WHERE status = 'active'`)[0] || {}).n || 0;
  return { joined, payments: pays.length, payments_cents: pays.reduce((s, p) => s + (Number(p.amount_cents) || 0), 0), active_now: active };
}

// the counter's best sellers in a range: each item by its name, how many and the money (a void or a comp is no sale -
// pos.lineCents gives it 0, as End of Day and the year-end report count it). The bay time rung up on a tab (kind 'golf': each
// seat's "Golf - share" paid at the door, extra time) is no counter item (the review, Oct 25 2026 - one line per head, it topped
// "What sold best this week?" at every facility that takes the bay money at the door); the kitchen tickets and the group's item
// count leave it out the same way (pos.sendOrder, checkin.groupView). counterTax above keeps it: the tax on it is still due.
function topSellers(from, to, n = 8) {
  const pos = require('./pos'), tz = rv.tzOf(), [u0, u1] = rv.utcWindow(from, to), o = {};
  for (const i of all(`SELECT * FROM tab_items WHERE sent_at >= ? AND sent_at < ?`, u0, u1)) {
    if (i.kind === 'golf') continue;
    const d = rv.localDate(i.sent_at, tz); if (d < from || d > to) continue;
    const c = pos.lineCents(i); if (c <= 0) continue;
    const k = String(i.name || '').trim() || 'an item';
    o[k] = o[k] || { item: k, sold: 0, sales_cents: 0 }; o[k].sold += Number(i.qty) || 1; o[k].sales_cents += c;
  }
  return Object.values(o).sort((a, b) => b.sales_cents - a.sales_cents || b.sold - a.sold).slice(0, n);
}

// the customers who played in a range, new and coming back - one person by their phone (its last ten digits), else their
// email; a row whose person was purged (rule 6) has neither and is not counted
function customers(from, to) {
  const key = (b) => String(b.phone || '').replace(/\D/g, '').slice(-10) || String(b.email || '').trim().toLowerCase();
  const q = `SELECT phone, email FROM bookings WHERE COALESCE(booking_type,'customer') = 'customer' AND status IN ('active','completed')`;
  const ids = new Set(all(q + ' AND date >= ? AND date <= ?', from, to).map(key).filter(Boolean));
  let back = 0;
  if (ids.size) { const before = new Set(all(q + ' AND date < ?', from).map(key)); for (const k of ids) if (before.has(k)) back++; }
  return { played: ids.size, new: ids.size - back, coming_back: back };
}

// what the gift cards still hold - money taken that customers can still spend (an accountant may treat it as owed back)
function giftCardsOwed() {
  try { const g = require('./gifts'); return all(`SELECT id, value FROM discount_codes WHERE type = 'gift' AND active = 1`).reduce((s, r) => s + (g.giftBalanceCents(r.id, r.value) || 0), 0); } catch { return null; }
}

/** A period against another (the caller's - "the same days last month" - or else the one just before it, of the same
 *  length): bookings, money (services/revenue.js), memberships, tax. */
function summary(from, to, cFrom, cTo) {
  const n = spanDays(from, to), pFrom = cFrom || rv.addDays(from, -n), pTo = cTo || rv.addDays(from, -1);
  const R = rv.report(from, to), P = rv.report(pFrom, pTo);
  const B = bookingStats(from, to), PB = bookingStats(pFrom, pTo);
  const A = (() => { try { return rv.activity(from, to); } catch { return {}; } })(), PA = (() => { try { return rv.activity(pFrom, pTo); } catch { return {}; } })();
  const ct = counterTax(from, to), ctTotal = ct.reduce((s, c) => s + c.tax_cents, 0);
  return {
    period: { from, to, days: n }, previous: { from: pFrom, to: pTo },
    bookings: Object.assign({}, B, { previous_count: PB.count, previous_hours: PB.hours, change_pct: change(B.count, PB.count),
      full_pct: A.occupancy == null ? null : A.occupancy, previous_full_pct: PA.occupancy == null ? null : PA.occupancy }),
    customers: Object.assign(customers(from, to), { previous_played: customers(pFrom, pTo).played }),
    counter_best_sellers: topSellers(from, to),
    money: { basis: 'money actually taken, minus refunds (cash basis) - the unit knows no costs, so profit is yours to work out from it',
      revenue_cents: R.revenue_cents, previous_revenue_cents: P.revenue_cents, change_pct: change(R.revenue_cents, P.revenue_cents),
      sessions_cents: R.sessions_cents, counter_cents: R.counter_cents, gift_cards_sold_cents: R.gift_sales_cents, memberships_cents: R.membership_cents,
      refunds_cents: R.refunds_cents, tips_cents: R.tips_cents, card_fees_estimate_cents: R.revenue_cents - R.take_home_cents, take_home_estimate_cents: R.take_home_cents,
      gift_cards_still_to_spend_cents: giftCardsOwed() },
    memberships: Object.assign(memberships(from, to), { previous_joined: memberships(pFrom, pTo).joined }),
    tax: { online_cents: R.tax_cents, counter_cents: ctTotal, counter_by_category: ct, total_cents: R.tax_cents + ctTotal,
      by_stripe_tax: (() => { try { return !!require('./stripetax').enabled(); } catch { return false; } })(),
      note: 'online: the tax on sessions and memberships paid online, less the tax share of refunds; counter: worked out from the counter\'s sales at the rates set today' }
  };
}

// the facility's bays and when it closes (Settings > Hours & Booking Rules: closeTime, closeNextDay, open24Hours), in
// minutes from the day's start
function baysAndClose(date) {
  const cfg = require('./config').getConfig(), b = require('./hours').on(cfg.booking, date);   // (that day's own hours, if it has them)
  const bays = (cfg.bays || []).filter(x => x && x.active !== false).map(x => ({ id: String(x.id), name: x.name || String(x.id) }));
  let close = b.open24Hours ? 1440 : toMin(b.closeTime || '00:00');
  if (!b.open24Hours && (b.closeNextDay || close === 0)) close += 1440;
  return { bays, close };
}
const hh = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** One day: how many, the hours, the longest, the first and the last, each bay's - and the list (first name, last initial).
 *  With a time ("tonight" from 17:00): only what runs from then, each hour's bays booked and the bays free all that time. */
function day(date, fromTime) {
  let k = kept(sessions(date, date)), evening = null;
  if (fromTime) {
    const span = (b) => { const s = toMin(b.start_time); let e = toMin(b.end_time); if (e <= s) e += 1440; return [s, e]; };
    const f = toMin(fromTime), { bays, close } = baysAndClose(date), end = close > f ? close : f + 60;
    k = k.filter(b => span(b)[1] > f);
    // the bays booked between two minutes: a whole-facility booking takes every bay; one with no bay of its own takes one
    const busy = (a, z) => { const ids = new Set(); for (const b of k) { const [s, e] = span(b); if (s < z && e > a) { if (Number(b.whole_facility)) bays.forEach(x => ids.add(x.id)); else ids.add(b.bay_id && b.bay_id !== 'any' ? String(b.bay_id) : 'any:' + b.id); } } return ids; };
    const hours = []; for (let h = Math.floor(f / 60) * 60; h < end; h += 60) hours.push({ at: hh(h), booked: busy(Math.max(h, f), h + 60).size });
    const top = hours.slice().sort((x, y) => y.booked - x.booked)[0], all = busy(f, end);
    evening = { from: hh(f), until: hh(end), bays: bays.length, busiest_hour: top && top.booked ? top : null, by_hour: hours,
      free_all_the_time: bays.filter(x => !all.has(x.id)).map(x => x.name) };
  }
  const ends = k.map(b => (b.end_time && toMin(b.end_time) <= toMin(b.start_time) ? toMin(b.end_time) + 1440 : toMin(b.end_time)));
  const mins = k.reduce((s, b) => s + (Number(b.duration_minutes) || 0), 0), last = ends.length ? Math.max(...ends) : null;
  const byBay = {}; for (const b of k) byBay[placeOf(b) || 'any bay'] = (byBay[placeOf(b) || 'any bay'] || 0) + 1;
  return { date, count: k.length, hours: Math.round(mins / 6) / 10, longest: longestOf(k), first_start: k.length ? k[0].start_time : null,
    last_end: last == null ? null : `${String(Math.floor(last / 60) % 24).padStart(2, '0')}:${String(last % 60).padStart(2, '0')}${last >= 1440 ? ' (next day)' : ''}`,
    by_bay: byBay, evening, list: k.slice(0, 40).map(b => ({ who: who(b.name), bay: placeOf(b), start: b.start_time, minutes: Number(b.duration_minutes) || 0, member: !!b.member_id })) };
}

/** Who is playing right now, in which bay and until when - and who is next in each bay today. */
function now(at = new Date()) {
  const tz = rv.tzOf(), today = rv.localDate(at.toISOString(), tz);
  let hm = '00:00'; try { hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at); } catch {}
  const t = toMin(hm), k = kept(sessions(rv.addDays(today, -1), today));
  const span = (b) => { const s = toMin(b.start_time) + (b.date < today ? -1440 : 0); let e = toMin(b.end_time) + (b.date < today ? -1440 : 0); if (e <= s) e += 1440; return [s, e]; };
  const playing = k.filter(b => { const [s, e] = span(b); return s <= t && t < e; }).map(b => ({ bay: placeOf(b), who: who(b.name), until: b.end_time, member: !!b.member_id }));
  const next = {}; for (const b of k.filter(x => x.date === today && toMin(x.start_time) > t)) { const bay = placeOf(b) || 'any bay'; if (!next[bay]) next[bay] = { who: who(b.name), at: b.start_time }; }
  return { time: hm, date: today, playing, next_up: next };
}

// ── THE OWNER'S OWN QUESTIONS ABOUT THEIR PEOPLE AND THEIR MONEY (Oct 25 2026; maintainer: "how many people bring if its that
//    style facility if member pay to bring people, how.much each group spends on food, beer etc. If that facility has that ...
//    returning customers, Aug spend, how many times top.members play") - every figure from the records: a group is a booking that
//    has started; its money is what it paid online (services/revenue.js, the one definition), the bay time rung up on its tabs at
//    the door and what its tabs rang up at the counter (comps and voids left out), tax included, less what the counter gave back;
//    a customer is a phone number (or an email)
const custKey = (b) => String(b.phone || '').replace(/\D/g, '').slice(-10) || String(b.email || '').trim().toLowerCase();
// A SESSION COUNTS ONCE IT HAS STARTED (the review, Oct 25 2026): "this month" ends today, and a group booked for this evening was
// counted at noon as a group that spent nothing at the counter, pulling every average down - and a member booked for tonight as a
// visit already played. The facility's own date and time, never the UTC date (it turns over at 7 PM Central).
function startedBy(at) {
  const tz = rv.tzOf(), today = rv.localDate(at.toISOString(), tz);
  let hm = at.toISOString().slice(11, 16);
  try { hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at); } catch {}
  return (date, start) => date < today || (date === today && String(start || '') <= hm);
}
const keptRows = (from, to, at) => {
  const started = startedBy(at);
  return rv.sessionNet(all(`SELECT ${rv.SESSION_COLS}, phone, email, member_id FROM bookings WHERE COALESCE(booking_type,'customer') = 'customer' AND status IN ('active','completed') AND date >= ? AND date <= ?`, from, to)
    .filter(b => started(b.date, b.start_time)));
};
// the owner's own part of the menu a counter line was rung up from (Food, Beer, Cocktails - menu_categories, the parts the owner
// built), and for a line with no menu item (a custom line, or an item since removed) its tax code's own name (Point of Sale - Tax
// Codes). Until Oct 25 2026 a regex on the tax code's id filed it: beer sold under the "food" code - the code every new menu part
// starts on - counted as food, and a code named "alc" or "spirits" as neither.
function partOf() {
  const pos = require('./pos'), byItem = new Map(all(`SELECT i.id, c.name FROM menu_items i JOIN menu_categories c ON c.id = i.category_id`).map(r => [r.id, r.name]));
  const codes = {}; try { for (const c of pos.getTaxCodes()) codes[c.id] = c.name; } catch {}
  return (i) => String((i.item_id && byItem.get(i.item_id)) || codes[i.tax_category] || i.tax_category || 'Other').trim() || 'Other';
}
// each booking's tabs, added up the way the tab itself adds up (pos.lineCents - a priced choice like "+$2 bacon" on top, a void or
// a comp nothing - and pos.computeTotals for the tax, at the rates set today), in two parts (the review, Oct 25 2026):
//   door     the bay time rung up on the tab (kind 'golf': each seat's "Golf - share" paid at the door, a package's share, extra
//            time, less "Member credit applied") - the group's bay money, never counter spend
//   counter  everything else: what the counter sold, by the owner's own menu parts (before tax) and by item
// and the money the counter gave back on those tabs (tab_refunds - rule 39: money given back comes off wherever it went back),
// which comes off the group's total. Until Oct 25 2026 every line counted as counter spend at its bare unit price: a walk-in that
// only paid its tee time "bought at the counter", "Golf - share" topped what sold most, a $2 add-on went missing, and the counter
// was put beside the online money without its tax.
function tabsByBooking(ids) {
  const pos = require('./pos'), want = new Set(ids), out = new Map(), byTab = new Map(), part = partOf();
  const rates = ((pos.posCfg(require('./config').getConfig()).tax || {}).categories) || {};
  for (const i of all(`SELECT i.*, t.booking_id FROM tabs t JOIN tab_items i ON i.tab_id = t.id WHERE COALESCE(t.booking_id, '') != ''`)) {
    if (!want.has(i.booking_id)) continue;
    const t = byTab.get(i.tab_id) || { booking_id: i.booking_id, golf: [], counter: [] };
    (i.kind === 'golf' ? t.golf : t.counter).push(i); byTab.set(i.tab_id, t);
  }
  const of = (id) => { if (!out.has(id)) out.set(id, { door: 0, counter: 0, lines: 0, back: 0, parts: {}, items: {} }); return out.get(id); };
  for (const t of byTab.values()) {
    const o = of(t.booking_id);
    o.door += pos.computeTotals({ items: t.golf, payments: [] }, rates).total_cents;
    o.counter += pos.computeTotals({ items: t.counter, payments: [] }, rates).total_cents;
    for (const i of t.counter) {
      const c = pos.lineCents(i); if (!c) continue;
      o.lines += c; const p = part(i); o.parts[p] = (o.parts[p] || 0) + c;
      if (c > 0) { const k = String(i.name || '').trim() || 'an item'; o.items[k] = (o.items[k] || 0) + (Number(i.qty) || 1); }
    }
  }
  // given back at the counter: card, cash or check, as services/revenue.js counts it (the sale part - a tip is the staff's)
  for (const r of all(`SELECT r.amount_cents, t.booking_id FROM tab_refunds r JOIN tabs t ON t.id = r.tab_id WHERE COALESCE(t.booking_id, '') != ''
      AND r.method IN ('card','cash','check') AND r.status IN ('succeeded','pending')`)) {
    if (want.has(r.booking_id)) of(r.booking_id).back += Number(r.amount_cents) || 0;
  }
  return out;
}
const avg = (sum, n) => (n ? Math.round(sum / n) : 0);
const NO_TAB = { door: 0, counter: 0, lines: 0, back: 0, parts: {}, items: {} };
/** What a group (a booking) spends: online, for bay time at the door and at the counter, per group; per group that bought at the
 *  counter, by the owner's menu parts; and what sold most. `at`: the moment a session must have started by (now). */
function groups(from, to, at = new Date()) {
  const rows = keptRows(from, to, at), tabs = tabsByBooking(rows.map(r => r.id)), T = (r) => tabs.get(r.id) || NO_TAB;
  const buyers = rows.filter(r => T(r).lines > 0), sum = (list, f) => list.reduce((n, r) => n + f(r), 0);
  const online = sum(rows, r => r.net_cents || 0), door = sum(rows, r => T(r).door), counter = sum(rows, r => T(r).counter), back = sum(rows, r => T(r).back);
  const parts = {}, items = {};
  for (const r of buyers) { for (const [k, v] of Object.entries(T(r).parts)) parts[k] = (parts[k] || 0) + v; for (const [k, v] of Object.entries(T(r).items)) items[k] = (items[k] || 0) + v; }
  return { from, to, groups: rows.length, bought_at_counter: buyers.length,
    per_group: { online_cents: avg(online, rows.length), door_cents: avg(door, rows.length), counter_cents: avg(counter, rows.length), given_back_cents: avg(back, rows.length),
      total_cents: avg(online + door + counter - back, rows.length) },
    per_group_that_bought: { counter_cents: avg(sum(buyers, r => T(r).counter), buyers.length),
      by_part: Object.entries(parts).map(([part, c]) => ({ part, cents: avg(c, buyers.length) })).sort((a, b) => b.cents - a.cents || a.part.localeCompare(b.part)) },
    online_total_cents: online, door_total_cents: door, counter_total_cents: counter, given_back_total_cents: back,
    top_items: Object.entries(items).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, qty]) => ({ name, qty })) };
}
// THE MEMBERS' VISITS (the review, Oct 25 2026): one visit is one booking - extra time at the counter writes a member_usage row of
// its own (`<booking>:ext:<time>`, checkin.extendBooking) whose minutes are that visit's, never a second visit - and only a booking
// kept and started: a cancelled one is no visit (a member's own cancel left its row behind until Oct 25 2026), nor is one booked
// for later today. A row whose booking is not on this unit is counted as it was recorded.
const baseId = (id) => String(id || '').replace(/:ext:.*$/, '');
function memberRows(from, to, at) {
  const started = startedBy(at);
  return all(`SELECT u.member_id, u.booking_id, u.duration_minutes, u.guest_count, u.date, m.name, t.name AS tier,
      b.status AS b_status, b.date AS b_date, b.start_time AS b_start
    FROM member_usage u LEFT JOIN members m ON m.id = u.member_id LEFT JOIN membership_tiers t ON t.id = m.tier_id
    LEFT JOIN bookings b ON b.id = CASE WHEN instr(u.booking_id, ':ext:') > 0 THEN substr(u.booking_id, 1, instr(u.booking_id, ':ext:') - 1) ELSE u.booking_id END
    WHERE u.date >= ? AND u.date <= ?`, from, to)
    .filter(r => (r.b_status ? (r.b_status === 'active' || r.b_status === 'completed') && started(r.b_date, r.b_start) : started(r.date, '')))
    .map(r => Object.assign(r, { visit: r.member_id + '|' + baseId(r.booking_id) }));
}
/** The guests members bring (each member visit's guest count): how many, on how many visits, and who brings the most. */
function guests(from, to, at = new Date()) {
  const rows = memberRows(from, to, at), by = {}, perVisit = new Map(); let total = 0;
  for (const r of rows) {
    const g = Number(r.guest_count) || 0; total += g; perVisit.set(r.visit, (perVisit.get(r.visit) || 0) + g);
    if (!r.member_id) continue;   // a purged row (rule 6) is still a visit, never a person
    const o = by[r.member_id] || (by[r.member_id] = { name: r.name, tier: r.tier, guests: 0, visits: new Set() }); o.guests += g; o.visits.add(r.visit);
  }
  const allowed = (all(`SELECT COUNT(*) AS c FROM membership_tiers WHERE active = 1 AND guest_allowed = 1`)[0] || {}).c || 0;
  return { from, to, member_visits: perVisit.size, visits_with_guests: [...perVisit.values()].filter(g => g > 0).length, guests: total, tiers_allowing_guests: allowed,
    top: Object.values(by).filter(x => x.guests).sort((a, b) => b.guests - a.guests).slice(0, 5).map(x => ({ who: who(x.name), tier: x.tier, guests: x.guests, visits: x.visits.size })) };
}
/** The members who play most: visits, hours and guests each; how many members played, how many of them are active today, and how
 *  many active members did not play at all. */
function topMembers(from, to, at = new Date()) {
  const rows = memberRows(from, to, at), by = {}, visits = new Set();
  for (const r of rows) {
    visits.add(r.visit); if (!r.member_id) continue;
    const o = by[r.member_id] || (by[r.member_id] = { name: r.name, tier: r.tier, visits: new Set(), minutes: 0, guests: 0 });
    o.visits.add(r.visit); o.minutes += Number(r.duration_minutes) || 0; o.guests += Number(r.guest_count) || 0;
  }
  // every member who played was put over TODAY's active count - "3 of 1 active members played" for a year in which two have since
  // ended (the review, Oct 25 2026): the active members who played are counted apart from those no longer active
  const active = all(`SELECT id FROM members WHERE status = 'active'`).map(m => m.id), played = new Set(Object.keys(by));
  const activePlayed = active.filter(id => played.has(id)).length;
  return { from, to, members_who_played: played.size, active_members: active.length, active_who_played: activePlayed, active_who_did_not_play: active.length - activePlayed,
    no_longer_active_who_played: played.size - activePlayed, member_visits: visits.size,
    top: Object.values(by).sort((a, b) => b.visits.size - a.visits.size || b.minutes - a.minutes).slice(0, 10).map(x => ({ who: who(x.name), tier: x.tier, visits: x.visits.size, hours: Math.round(x.minutes / 6) / 10, guests: x.guests })) };
}
/** The customers: how many, new or coming back, how often, what they spend a visit, and who comes most. */
function customersDetail(from, to, at = new Date()) {
  const rows = keptRows(from, to, at), tabs = tabsByBooking(rows.map(r => r.id)), by = {};
  for (const r of rows) {
    const k = custKey(r); if (!k) continue; const t = tabs.get(r.id) || NO_TAB;
    const o = by[k] || (by[k] = { name: r.name, visits: 0, cents: 0, member: !!r.member_id }); o.visits++; o.cents += (r.net_cents || 0) + t.door + t.counter - t.back;
  }
  const keys = Object.keys(by), before = keys.length ? new Set(all(`SELECT phone, email FROM bookings WHERE COALESCE(booking_type,'customer') = 'customer' AND status IN ('active','completed') AND date < ?`, from).map(custKey)) : new Set();
  const visits = Object.values(by).reduce((n, x) => n + x.visits, 0), cents = Object.values(by).reduce((n, x) => n + x.cents, 0);
  return { from, to, customers: keys.length, new: keys.filter(k => !before.has(k)).length, coming_back: keys.filter(k => before.has(k)).length,
    came_more_than_once: Object.values(by).filter(x => x.visits > 1).length, visits, visits_each: keys.length ? Math.round(visits / keys.length * 10) / 10 : 0,
    spend_a_visit_cents: avg(cents, visits), spend_a_customer_cents: avg(cents, keys.length),
    top: Object.values(by).sort((a, b) => b.visits - a.visits || b.cents - a.cents).slice(0, 5).map(x => ({ who: who(x.name), visits: x.visits, cents: x.cents, member: x.member })) };
}

/** The tax for a range, as the sheets of a workbook (services/xlsxwriter.js: money in dollars). */
function taxSheets(from, to) {
  const S = summary(from, to), d = (c) => Math.round(c) / 100;
  const months = [], after = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = after(m)) {
    const first = m + '-01', last = rv.addDays(after(m) + '-01', -1), a = first < from ? from : first, e = last > to ? to : last;
    const R = rv.report(a, e), ct = counterTax(a, e).reduce((s, c) => s + c.tax_cents, 0);
    months.push([m, a, e, d(R.revenue_cents), d(R.tax_cents), d(ct), d(R.tax_cents + ct)]);
  }
  return [
    { name: 'Tax collected', columns: [{ h: 'What', type: 'text', width: 52 }, { h: 'Amount', type: 'money', width: 14 }],
      rows: [['From', from], ['To', to], { cells: ['Tax on sessions and memberships paid online', d(S.tax.online_cents)] }, { cells: ['Tax at the counter (worked out at the rates set today)', d(S.tax.counter_cents)] },
        { cells: ['Tax collected', d(S.tax.total_cents)], bold: true }, ['Revenue (money taken, minus refunds, tax included)', d(S.money.revenue_cents)], ['Revenue before the online tax', d(S.money.revenue_cents - S.tax.online_cents)],
        ['Note', 'Online tax: the tax on sessions and memberships paid online, less the tax share of refunds. Counter tax: the counter keeps its sales, not the rate it charged, so it is worked out at the rates set today - a period when a rate changed is slightly off for that category. Your accountant files it.']] },
    { name: 'By month', columns: [{ h: 'Month', type: 'text', width: 9 }, { h: 'From', type: 'text', width: 12 }, { h: 'To', type: 'text', width: 12 }, { h: 'Revenue', type: 'money', width: 13 }, { h: 'Online tax', type: 'money', width: 13 }, { h: 'Counter tax', type: 'money', width: 13 }, { h: 'Tax collected', type: 'money', width: 14 }],
      rows: months },
    { name: 'Counter by category', columns: [{ h: 'Tax category', type: 'text', width: 18 }, { h: 'Lines', type: 'int', width: 8 }, { h: 'Sales', type: 'money', width: 13 }, { h: 'Rate today %', type: 'num', width: 13 }, { h: 'Tax at that rate', type: 'money', width: 16 }],
      rows: S.tax.counter_by_category.map(c => [c.category, c.lines, d(c.sales_cents), c.rate, d(c.tax_cents)]) }
  ];
}

module.exports = { summary, day, now, taxSheets, bookingStats, counterTax, memberships, topSellers, customers, who, groups, guests, topMembers, customersDetail };
