// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/revenue.js - WHAT REVENUE IS, IN ONE PLACE (maintainer, Sep 23 2026)
//
// "Revenue is money actually taken, minus refunds. An expired checkout nobody
//  paid for is not revenue, and a cancellation that kept part of the fee IS
//  revenue for the part kept. Both surfaces - the owner's report and the
//  ten-year records - read one definition from one place."
// Owners file tax from these numbers, and the yearly figure is frozen for ever
// at the ten-year purge, so there is exactly one answer and it lives here.
// Before this the owner's report counted every active booking's price whether or
// not money was taken, and the ten-year records also counted checkouts that
// expired unpaid; neither subtracted a refund, and a cancellation that kept half
// the fee dropped out of both.
//
// MONEY IS COUNTED ON THE DAY IT WAS TAKEN, in the facility's own time zone, and
// a refund on the day it went back (cash basis - what reaches the bank). The ways
// money comes in, each as this unit recorded it:
//   sessions     a booking charged online through Stripe: its price plus the tax
//                on it. A booking was charged when it went active or completed on
//                a payment, carries a charge id, or had money refunded.
//   counter      card, cash or check at the counter (tab_payments). Member credit
//                and gift-card spending are stored value, not new money; tips are
//                the staff's and are reported beside revenue, never in it.
//   gift cards   a gift card sold (money taken when it is bought; spending it
//                later is not new money). A comped card is not money.
//   memberships  a membership payment Stripe reported paid (membership_payments,
//                recorded as it happens - the webhook, the nightly reconcile, the join).
// minus every refund recorded with its amount (refunds, via db.markRefunded) - and,
// since Sep 24 2026, every refund wherever it was made: a refund made in Stripe's
// dashboard is picked up (services/refunds.js) for a booking, a gift-card
// purchase or a membership payment, and money given back at the counter is its
// own ledger (tab_refunds). A refund Stripe says failed or was canceled stops
// counting. A counter refund comes off the sale first, then the tip.
// What did NOT come in is counted too, so a yearly record can say so:
// checkouts that expired unpaid, member credit spent, gift cards spent.
// Counter money includes whatever tax the counter charged; the tax figure here
// is the tax collected on sessions, which is the part this unit stores apart.
'use strict';
const dbM = require('./db');

const BASIS = 'money-taken-v1';   // written beside every stored figure (records_yearly.revenue_basis)

function tzOf() {
  try { return require('./config').getConfig().server.timezone || null; } catch { return null; }
}
// 'YYYY-MM-DD HH:MM:SS' (SQLite, UTC) or an ISO string -> the facility's local date.
// (one formatter per zone, made once: a new one for every row made a busy two years' money read take eight seconds - the facility
// study, Oct 25 2026)
const LOCAL_FMT = new Map();
function localDate(ts, tz) {
  if (!ts) return '';
  const s = String(ts);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  try {
    let f = LOCAL_FMT.get(tz || '');
    if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }); LOCAL_FMT.set(tz || '', f); }
    return f.format(d);
  } catch { return d.toISOString().slice(0, 10); }
}
// THE FACILITY'S TODAY (Oct 2026). Every "today" a report, a list or a limit means is the facility's own
// date in its own zone - never the UTC date, which turns over at 7 PM Central (test-facility-day).
function facilityToday(now = new Date()) { return localDate(now.toISOString(), tzOf()); }
function addDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// A UTC window wide enough to hold every row whose LOCAL date is in [from, to]
// (a day either side covers any zone); rows are then filtered by local date.
function utcWindow(from, to) {
  const a = new Date(from + 'T00:00:00Z'); a.setUTCDate(a.getUTCDate() - 1);
  const b = new Date(to + 'T00:00:00Z'); b.setUTCDate(b.getUTCDate() + 2);
  const f = d => d.toISOString().slice(0, 19).replace('T', ' ');
  return [f(a), f(b)];
}
const all = (sql, ...p) => { try { return dbM.db.prepare(sql).all(...p); } catch { return []; } };

// Every refund, by booking: the recorded ones with their amounts, and - for a
// booking stamped refunded before amounts were recorded (Sep 20-23 2026) - the
// whole charge, dated by the stamp.
function refundsByBooking() {
  const map = new Map();
  for (const r of all(`SELECT id, booking_id, amount_cents, at FROM refunds
      WHERE COALESCE(kind,'booking') = 'booking' AND COALESCE(status,'succeeded') IN ('succeeded','pending')`)) {
    if (!map.has(r.booking_id)) map.set(r.booking_id, []);
    map.get(r.booking_id).push({ id: r.id, cents: r.amount_cents | 0, at: r.at });
  }
  // a booking with ANY refund row - one that failed included - is not a legacy stamp
  const anyRow = new Set(all(`SELECT DISTINCT booking_id FROM refunds WHERE booking_id <> ''`).map(r => r.booking_id));
  for (const b of all(`SELECT id, price_cents, tax_cents, refunded_at FROM bookings WHERE COALESCE(refunded_at,'') <> ''`)) {
    if (!map.has(b.id) && !anyRow.has(b.id)) map.set(b.id, [{ id: 'legacy-' + b.id, cents: (b.price_cents | 0) + (b.tax_cents | 0), at: b.refunded_at, legacy: true }]);
  }
  return map;
}

// A booking's money: was it charged, what was taken, what went back.
function bookingMoney(b, refunds) {
  const rf = (refunds && refunds.get(b.id)) || [];
  const hasIntent = !!String(b.stripe_payment_intent || '').trim();
  const charged = hasIntent && ((b.status === 'active' || b.status === 'completed') || !!String(b.stripe_charge_id || '').trim() || rf.length > 0);
  const gross = charged ? (b.price_cents | 0) + (b.tax_cents | 0) : 0;
  const refunded = rf.reduce((s, r) => s + r.cents, 0);
  return { charged, gross, tax: charged ? (b.tax_cents | 0) : 0, refunded, net: gross - refunded, refunds: rf };
}

const SESSION_COLS = `id, name, bay_name, date, start_time, price_cents, tax_cents, status,
  stripe_payment_intent, stripe_charge_id, created_at, refunded_at, booking_type`;

/** THE definition, for a local-date range [from, to] (YYYY-MM-DD, inclusive). */
function money(from, to) {
  const tz = tzOf();
  const [u0, u1] = utcWindow(from, to);
  const inRange = d => d >= from && d <= to;
  const refunds = refundsByBooking();

  // sessions charged online, on the day they were taken
  const sessions = { count: 0, gross_cents: 0, tax_cents: 0, items: [] };
  const expired = { count: 0, cents: 0 };
  for (const b of all(`SELECT ${SESSION_COLS} FROM bookings
      WHERE COALESCE(booking_type,'customer') = 'customer' AND created_at >= ? AND created_at < ?`, u0, u1)) {
    const day = localDate(b.created_at, tz);
    if (!inRange(day)) continue;
    const m = bookingMoney(b, refunds);
    if (m.charged) {
      sessions.count++; sessions.gross_cents += m.gross; sessions.tax_cents += m.tax;
      sessions.items.push({ day, kind: 'session', ref: b.stripe_payment_intent || b.id, booking: b.id, who: b.name, what: `${b.bay_name || ''} ${b.date} ${b.start_time}`.trim(), cents: m.gross, tax_cents: m.tax });
    } else if (b.status === 'expired' && (b.price_cents | 0) > 0) {
      expired.count++; expired.cents += (b.price_cents | 0) + (b.tax_cents | 0);
    }
  }

  // refunds, on the day they went back (the tax share is proportional to the charge)
  const refundOut = { count: 0, cents: 0, tax_cents: 0, items: [] };
  const byId = new Map(all(`SELECT id, name, bay_name, date, start_time, price_cents, tax_cents FROM bookings
      WHERE id IN (SELECT booking_id FROM refunds WHERE booking_id <> '') OR COALESCE(refunded_at,'') <> ''`).map(b => [b.id, b]));
  for (const [bid, list] of refunds) {
    const b = byId.get(bid) || {};
    const gross = (b.price_cents | 0) + (b.tax_cents | 0);
    for (const r of list) {
      const day = localDate(r.at, tz);
      if (!inRange(day)) continue;
      const taxShare = gross > 0 ? Math.round(r.cents * (b.tax_cents | 0) / gross) : 0;
      refundOut.count++; refundOut.cents += r.cents; refundOut.tax_cents += taxShare;
      refundOut.items.push({ day, kind: 'refund', ref: r.id, booking: bid, who: b.name || '', what: `${b.bay_name || ''} ${b.date || ''} ${b.start_time || ''}`.trim(), cents: -r.cents, tax_cents: -taxShare });
    }
  }

  // gift-card purchases and membership payments refunded in Stripe (services/refunds.js)
  for (const r of all(`SELECT r.id, r.kind, r.ref, r.amount_cents, r.at, m.amount_cents mp_amount, m.tax_cents mp_tax, mb.name mname
      FROM refunds r LEFT JOIN membership_payments m ON r.kind = 'membership' AND m.invoice_id = r.ref
      LEFT JOIN members mb ON mb.id = m.member_id
      WHERE r.kind IN ('gift','membership') AND COALESCE(r.status,'succeeded') IN ('succeeded','pending') AND r.at >= ? AND r.at < ?`, u0.replace(' ', 'T'), u1.replace(' ', 'T'))) {
    const day = localDate(r.at, tz);
    if (!inRange(day)) continue;
    const taxShare = r.kind === 'membership' && (r.mp_amount | 0) > 0 ? Math.round((r.amount_cents | 0) * (r.mp_tax | 0) / (r.mp_amount | 0)) : 0;
    refundOut.count++; refundOut.cents += r.amount_cents | 0; refundOut.tax_cents += taxShare;
    refundOut.items.push({ day, kind: 'refund', ref: r.id, booking: '', who: r.kind === 'membership' ? (r.mname || '') : '', what: r.kind === 'gift' ? 'gift card purchase refunded' : 'membership payment refunded', cents: -(r.amount_cents | 0), tax_cents: -taxShare });
  }

  // the counter: card, cash, check are money; credit and gift are stored value
  const counter = { count: 0, cents: 0, tips_cents: 0, by_method: { card: 0, cash: 0, check: 0 }, card_count: 0, items: [] };
  const stored = { member_credit_cents: 0, gift_card_spend_cents: 0 };
  for (const p of all(`SELECT id, method, amount_cents, tip_cents, created_at FROM tab_payments WHERE created_at >= ? AND created_at < ?`, u0, u1)) {
    const day = localDate(p.created_at, tz);
    if (!inRange(day)) continue;
    if (p.method === 'card' || p.method === 'cash' || p.method === 'check') {
      counter.count++; counter.cents += p.amount_cents | 0; counter.tips_cents += p.tip_cents | 0;
      counter.by_method[p.method] += p.amount_cents | 0;
      if (p.method === 'card') counter.card_count++;
      counter.items.push({ day, kind: 'counter-' + p.method, ref: p.id, who: '', what: 'counter ' + p.method, cents: p.amount_cents | 0, tax_cents: 0 });
    } else if (p.method === 'credit') stored.member_credit_cents += p.amount_cents | 0;
    else if (p.method === 'gift') stored.gift_card_spend_cents += p.amount_cents | 0;
  }
  // money given back at the counter - pressed on the pad, or refunded in Stripe off
  // a reader payment - comes off on the day it went back; the sale part off
  // revenue, the tip part off the staff's tips (services/refunds.js)
  const counterBack = { cents: 0, tips_cents: 0, by_method: { card: 0, cash: 0, check: 0 } };
  for (const r of all(`SELECT r.id, r.method, r.amount_cents, r.tip_cents, r.reason, r.at, t.label FROM tab_refunds r LEFT JOIN tabs t ON t.id = r.tab_id
      WHERE r.method IN ('card','cash','check') AND r.status IN ('succeeded','pending') AND r.at >= ? AND r.at < ?`, u0.replace(' ', 'T'), u1.replace(' ', 'T'))) {
    const day = localDate(r.at, tz);
    if (!inRange(day)) continue;
    counterBack.cents += r.amount_cents | 0; counterBack.tips_cents += r.tip_cents | 0; counterBack.by_method[r.method] += r.amount_cents | 0;
    counter.tips_cents -= r.tip_cents | 0;
    refundOut.count++; refundOut.cents += r.amount_cents | 0;
    refundOut.items.push({ day, kind: 'refund', ref: r.id, booking: '', who: '', what: `counter ${r.method} refund${r.reason ? ': ' + String(r.reason).slice(0, 60) : ''}`, cents: -(r.amount_cents | 0), tax_cents: 0 });
  }

  // gift cards spent against bookings online are stored value too
  for (const u of all(`SELECT u.discount_cents, u.used_at FROM discount_uses u JOIN discount_codes c ON c.id = u.code_id
      WHERE c.type = 'gift' AND u.used_at >= ? AND u.used_at < ?`, u0, u1)) {
    if (inRange(localDate(u.used_at, tz))) stored.gift_card_spend_cents += u.discount_cents | 0;
  }

  // gift cards sold (a comped card is not money)
  const gifts = { count: 0, cents: 0, items: [] };
  for (const g of all(`SELECT id, value, description, created_at FROM discount_codes WHERE type = 'gift' AND created_at >= ? AND created_at < ?`, u0, u1)) {
    const day = localDate(g.created_at, tz);
    if (!inRange(day)) continue;
    let d = {}; try { d = JSON.parse(g.description || '{}'); } catch {}
    if (d.paid === false) continue;
    const cents = Math.round(Number(g.value || 0) * 100);
    gifts.count++; gifts.cents += cents;
    gifts.items.push({ day, kind: 'gift-card', ref: g.id, who: d.fromName || '', what: 'gift card sold', cents, tax_cents: 0 });
  }

  // membership payments Stripe reported paid
  const memberships = { count: 0, cents: 0, tax_cents: 0, items: [] };
  for (const p of all(`SELECT p.invoice_id, p.amount_cents, p.tax_cents, p.paid_at, m.name FROM membership_payments p
      LEFT JOIN members m ON m.id = p.member_id WHERE p.paid_at >= ? AND p.paid_at < ?`, u0, u1)) {
    const day = localDate(p.paid_at, tz);
    if (!inRange(day)) continue;
    memberships.count++; memberships.cents += p.amount_cents | 0; memberships.tax_cents += p.tax_cents | 0;
    memberships.items.push({ day, kind: 'membership', ref: p.invoice_id, who: p.name || '', what: 'membership payment', cents: p.amount_cents | 0, tax_cents: p.tax_cents | 0 });
  }

  const revenue = sessions.gross_cents + counter.cents + gifts.cents + memberships.cents - refundOut.cents;
  const tax = sessions.tax_cents + memberships.tax_cents - refundOut.tax_cents;
  return {
    basis: BASIS, timezone: tz, from, to,
    revenue_cents: revenue,
    tax_cents: tax,
    sessions: { count: sessions.count, gross_cents: sessions.gross_cents, tax_cents: sessions.tax_cents },
    counter: { count: counter.count, cents: counter.cents, tips_cents: counter.tips_cents, by_method: counter.by_method, card_count: counter.card_count },
    gifts: { count: gifts.count, cents: gifts.cents },
    memberships: { count: memberships.count, cents: memberships.cents },
    refunds: { count: refundOut.count, cents: refundOut.cents, counter_cents: counterBack.cents, counter_by_method: counterBack.by_method, counter_tips_cents: counterBack.tips_cents },
    not_revenue: { expired_unpaid: expired, member_credit_cents: stored.member_credit_cents, gift_card_spend_cents: stored.gift_card_spend_cents },
    items: sessions.items.concat(counter.items, gifts.items, memberships.items, refundOut.items)
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  };
}

/** Revenue per day or per month across [from, to], by the same definition. */
function series(from, to, unit) {
  const m = money(from, to);
  const key = d => unit === 'month' ? d.slice(0, 7) : d;
  const out = new Map();
  for (const it of m.items) {
    const k = key(it.day);
    const cur = out.get(k) || { revenue_cents: 0, count: 0 };
    cur.revenue_cents += it.cents; if (it.cents > 0) cur.count++;
    out.set(k, cur);
  }
  return out;
}

/** Per-session money for analytics grouped by the SESSION (by bay, by weekday):
 *  the same definition, one booking at a time - taken minus refunded. */
function sessionNet(rows) {
  const refunds = refundsByBooking();
  return rows.map(b => Object.assign({}, b, { net_cents: bookingMoney(b, refunds).net }));
}

// ── THE PERIOD REPORT: the definition plus what the owner reads beside it ─────
// (moved here from routes/admin.js on Sep 23 2026 so the Revenue tab and the
// yearly export give the same figures from one place - nothing in it changed.)
function report(startStr, endStr) {
  const cfg = require('./config').getConfig();
  const feePct = Number(cfg.stripe && cfg.stripe.feePercent != null ? cfg.stripe.feePercent : 2.9);
  const feeFixed = Math.round(Number(cfg.stripe && cfg.stripe.feeFixedCents != null ? cfg.stripe.feeFixedCents : 30));
  const ipFeePct = Number(cfg.stripe && cfg.stripe.inPersonFeePercent != null ? cfg.stripe.inPersonFeePercent : 2.7);
  const ipFeeFixed = Math.round(Number(cfg.stripe && cfg.stripe.inPersonFeeFixedCents != null ? cfg.stripe.inPersonFeeFixedCents : 5));
  const m = money(startStr, endStr);
  const act = dbM.db.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(duration_minutes),0) AS mins FROM bookings
      WHERE status IN ('active','completed') AND COALESCE(booking_type,'customer') = 'customer' AND date >= ? AND date <= ?`)
    .get(startStr, endStr) || {};
  // what the sessions in the range were worth in money actually taken (for the average)
  const sessRows = dbM.db.prepare(`SELECT ${SESSION_COLS} FROM bookings
      WHERE status IN ('active','completed') AND COALESCE(booking_type,'customer') = 'customer' AND date >= ? AND date <= ?`).all(startStr, endStr);
  const sessionValue = sessionNet(sessRows).reduce((s, b) => s + b.net_cents, 0);
  // Processor fees are ESTIMATES from the configured rates: every online charge
  // (sessions, gift cards, memberships) at the online rate, counter card at the
  // Terminal rate; cash and check carry none.
  const onlineCount = m.sessions.count + m.gifts.count + m.memberships.count;
  const onlineGross = m.sessions.gross_cents + m.gifts.cents + m.memberships.cents;
  const stripeFee = Math.round(onlineGross * (feePct / 100)) + feeFixed * onlineCount;
  const ipCardFee = Math.round(m.counter.by_method.card * (ipFeePct / 100)) + ipFeeFixed * m.counter.card_count;
  const revenue = m.revenue_cents, tax = m.tax_cents;
  return {
    basis: m.basis,
    revenue_cents: revenue,                       // money taken minus refunds (tax included)
    subtotal_cents: revenue - tax,                // that, before the tax collected on it
    tax_cents: tax,
    gross_cents: revenue,
    sessions_cents: m.sessions.gross_cents,
    counter_cents: m.counter.cents,
    gift_sales_cents: m.gifts.cents,
    membership_cents: m.memberships.cents,
    refunds_cents: m.refunds.cents,
    tips_cents: m.counter.tips_cents,
    not_revenue: m.not_revenue,
    session_value_cents: sessionValue,
    stripe_fee_cents: stripeFee,
    take_home_cents: revenue - stripeFee - ipCardFee,
    count: act.cnt || 0,
    paid_count: m.sessions.count,
    mins: act.mins || 0,
    fee_percent: feePct,
    fee_fixed_cents: feeFixed,
    // in-person (counter) figures - card, cash, check only; credit and gift are stored value
    inperson_card_cents: m.counter.by_method.card,
    inperson_cash_cents: m.counter.by_method.cash,
    inperson_check_cents: m.counter.by_method.check,
    inperson_gross_cents: m.counter.cents,
    inperson_fee_cents: ipCardFee,
    inperson_take_home_cents: m.counter.cents - ipCardFee,
    inperson_fee_percent: ipFeePct,
    inperson_fee_fixed_cents: ipFeeFixed,
    combined_take_home_cents: revenue - stripeFee - ipCardFee,
    total_stripe_fees_cents: stripeFee + ipCardFee
  };
}

// The sessions that took place in [start, end] (by the session's own date):
// booked hours against open capacity, and each session's money by bay and by
// weekday - worth the money actually taken for it (the same definition, per booking).
function activity(start, end) {
  const cfg = require('./config').getConfig();
  const bays = (cfg.bays || []).filter(b => b.active !== false).length || 1;
  // (a booking of the whole facility takes every bay: its minutes fill every bay's hours - the facility walk, Oct 25 2026: a
  // four-bay building booked whole all day read 25% full)
  const act = dbM.db.prepare(`SELECT COALESCE(SUM(duration_minutes),0) AS mins, COALESCE(SUM(CASE WHEN whole_facility = 1 THEN duration_minutes ELSE 0 END),0) AS whole FROM bookings
      WHERE status IN ('active','completed') AND COALESCE(booking_type,'customer') = 'customer' AND date >= ? AND date <= ?`).get(start, end) || {};
  // each day's open hours (a day may have its own - services/hours.js), added up over the period
  const openHours = (h) => {
    if (h.open24Hours || !h.openTime || !h.closeTime) return 24;
    const [oh, om] = h.openTime.split(':').map(Number);
    const [ch, cm] = h.closeTime.split(':').map(Number);
    // (a close at or before the opening - midnight, 1 AM - is the next morning's: until Oct 22 2026 the hours were held to at least one
    // BEFORE the day was added, so a facility closing at midnight counted one open hour a day - test-day-hours H8)
    let n = ((ch * 60 + cm) - (oh * 60 + om)) / 60;
    if (n <= 0) n += 24; // overnight close
    return Math.max(1, n);
  };
  const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
  let openSum = 0;
  for (let i = 0; i < days; i++) { const [y, m, d] = String(start).split('-').map(Number); openSum += openHours(require('./hours').on(cfg.booking, new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10))); }
  const bookedHours = Math.round((act.mins || 0) / 60 * 10) / 10;
  const bayHours = ((act.mins || 0) + (act.whole || 0) * (bays - 1)) / 60;
  const occupancy = Math.min(100, Math.round(bayHours / (bays * openSum) * 100));
  const sessRows = sessionNet(dbM.db.prepare(`SELECT ${SESSION_COLS}, duration_minutes FROM bookings
    WHERE status IN ('active','completed') AND COALESCE(booking_type,'customer') = 'customer' AND date >= ? AND date <= ?`).all(start, end));
  const bayMap = new Map();
  for (const r of sessRows) {
    const k = r.bay_name || '';
    const cur = bayMap.get(k) || { bay_name: k, count: 0, revenue_cents: 0, duration_minutes: 0 };
    cur.count++; cur.revenue_cents += r.net_cents; cur.duration_minutes += (r.duration_minutes || 0);
    bayMap.set(k, cur);
  }
  // KEPT MONEY BELONGS TO ITS BAY AND ITS DAY (Oct 2026, from pilot facility's 09-27 addendum). A cancellation that
  // kept part of the fee is revenue (rule 38) and the totals carry it, but these tables read only the
  // sessions that were played, so by bay and by weekday no longer added up to the sessions' money. The kept
  // part now lands on its bay and its weekday; counts, hours and occupancy stay the sessions that were
  // played - a cancelled hour occupied nothing. test-revenue R13.
  const kept = sessionNet(dbM.db.prepare(`SELECT ${SESSION_COLS}, duration_minutes FROM bookings
    WHERE status = 'cancelled' AND COALESCE(booking_type,'customer') = 'customer' AND date >= ? AND date <= ?`).all(start, end)).filter(r => r.net_cents > 0);
  for (const r of kept) {
    const k = r.bay_name || '';
    const cur = bayMap.get(k) || { bay_name: k, count: 0, revenue_cents: 0, duration_minutes: 0 };
    cur.revenue_cents += r.net_cents;
    bayMap.set(k, cur);
  }
  const byBay = [...bayMap.values()].sort((a, b) => b.revenue_cents - a.revenue_cents);
  const byDow = [0,1,2,3,4,5,6].map(() => ({ count: 0, revenue_cents: 0 }));
  for (const r of sessRows) {
    const d = new Date(r.date + 'T12:00:00');   // noon avoids TZ edge flips
    const idx = d.getDay();
    if (byDow[idx]) { byDow[idx].count++; byDow[idx].revenue_cents += r.net_cents; }
  }
  for (const r of kept) { const idx = new Date(r.date + 'T12:00:00').getDay(); if (byDow[idx]) byDow[idx].revenue_cents += r.net_cents; }
  return { booked_hours: bookedHours, occupancy, capacity_hours: bays * openSum, bays, by_bay: byBay, by_dow: byDow, sessions: sessRows.length };
}

module.exports = { money, series, sessionNet, bookingMoney, localDate, tzOf, utcWindow, facilityToday, addDays, report, activity, BASIS, SESSION_COLS };
