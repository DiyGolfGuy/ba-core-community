// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/yearexport.js - THE YEAR-END REPORT (maintainer, Sep 23 2026)
//
// One zip per year for the owner and whoever does their books, readable without
// this product for as long as anyone keeps it:
//   report.pdf     the whole year on paper (services/pdfwriter - our own writer)
//   workbook.xlsx  the same sections, one tab each, money as real numbers
//   csv/*.csv      the same tabs as plain CSV, which anything opens
//   README.txt     what every file and column is, and what "revenue" means
// Every money figure comes from services/revenue.js - the ONE definition (rule
// 38) that the Revenue tab and the ten-year records read - so the report can
// never disagree with the screen.
// CUSTOMER NAMES ARE LEFT OUT unless the owner asks for them (maintainer's ruling): a
// file that outlives the unit should not carry names the ten-year purge would
// remove. With names the zip leaves the unit encrypted with the backup
// passphrase, and is refused without one (the route does that).
// The words stay neutral (rules 12 and 15): figures and what they are made of,
// never advice about what to file or owe.
'use strict';
const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');
const dbM = require('./db');
const rev = require('./revenue');
const { PdfDoc } = require('./pdfwriter');
const { writeXlsx } = require('./xlsxwriter');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KIND = { session: 'Session paid online', 'counter-card': 'Counter - card', 'counter-cash': 'Counter - cash', 'counter-check': 'Counter - check',
  'gift-card': 'Gift card sold', membership: 'Membership payment', refund: 'Refund' };
const all = (sql, ...p) => { try { return dbM.db.prepare(sql).all(...p); } catch { return []; } };
const one = (sql, ...p) => { try { return dbM.db.prepare(sql).get(...p) || {}; } catch { return {}; } };
const dollars = c => Math.round(c || 0) / 100;
const usd = c => (c < 0 ? '-$' : '$') + (Math.abs(Math.round(c || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = n => String(n).padStart(2, '0');

function todayLocal(tz) { return rev.localDate(new Date().toISOString(), tz); }

// The figures, as sections. Each: { key, title, intro, columns: [{ h, type, w, align }], rows }.
// Money columns hold CENTS here; the writers format them.
function gather(y, { names = false } = {}) {
  const cfg = require('./config').getConfig();
  const tz = (cfg.server && cfg.server.timezone) || null;
  const today = todayLocal(tz);
  const from = `${y}-01-01`, yearEnd = `${y}-12-31`;
  const partial = today < yearEnd;
  const to = partial ? today : yearEnd;
  const R = rev.report(from, to);
  const M = rev.money(from, to);
  const A = rev.activity(from, to);
  const met = require('./records').computeYearMetrics(y);
  const frozen = one(`SELECT * FROM records_yearly WHERE year = ?`, y);
  const S = [];

  // 1. SUMMARY
  const sum = [];
  const add = (item, value, t, note, bold) => sum.push({ cells: [item, { v: value, t }, note || ''], bold: !!bold });
  add('Revenue - money taken, minus refunds', R.revenue_cents, 'money', 'online sessions, the counter, gift cards sold and membership payments, minus refunds', true);
  add('   Sessions paid online', M.sessions.gross_cents, 'money', `${M.sessions.count} payment(s), tax included`);
  add('   Counter - card', M.counter.by_method.card, 'money', 'tax the counter charged is inside the counter money');
  add('   Counter - cash', M.counter.by_method.cash, 'money');
  add('   Counter - check', M.counter.by_method.check, 'money');
  add('   Gift cards sold', M.gifts.cents, 'money', `${M.gifts.count} card(s); counted when sold, not when spent`);
  add('   Membership payments', M.memberships.cents, 'money', `${M.memberships.count} payment(s)`);
  add('   Refunds', -M.refunds.cents, 'money', `${M.refunds.count} refund(s), on the day each went back`);
  add('Tax collected on online sessions and memberships', R.tax_cents, 'money', 'less the tax share of refunds');
  add('Revenue before that tax', R.subtotal_cents, 'money');
  add('Tips (the staff\'s - not revenue)', M.counter.tips_cents, 'money');
  add('Estimated card processing fees', R.total_stripe_fees_cents, 'money', `an estimate at the rates set in Settings: online ${R.fee_percent}% + ${R.fee_fixed_cents}c, counter card ${R.inperson_fee_percent}% + ${R.inperson_fee_fixed_cents}c`);
  add('Take-home after estimated fees', R.take_home_cents, 'money', '', true);
  add('Not revenue: checkouts that expired unpaid', M.not_revenue.expired_unpaid.cents, 'money', `${M.not_revenue.expired_unpaid.count} checkout(s) - never taken`);
  add('Not revenue: member credit spent', M.not_revenue.member_credit_cents, 'money', 'stored value already paid for');
  add('Not revenue: gift cards spent', M.not_revenue.gift_card_spend_cents, 'money', 'stored value already paid for');
  add('Sessions played', met.bookings, 'int', 'by the session\'s own date');
  add('Hours booked', met.hours, 'num');
  add('Occupancy', A.occupancy, 'pct', `${A.booked_hours} of ${Math.round(A.capacity_hours)} open bay-hours`);
  add('Different customers', met.unique_customers, 'int', 'by phone or email');
  add('Members who visited', met.members_active, 'int');
  add('Members who joined', met.new_members, 'int');
  add('Guest visits with members', met.guest_visits, 'int');
  add('Waivers signed', met.waivers_signed, 'int');
  S.push({ key: '01-summary', title: 'Summary', intro: partial ? `The year so far - through ${to}. The year is not over, so every figure is partial.` : `The whole of ${y}.`,
    columns: [{ h: 'Item', type: 'text', w: 3.2 }, { h: 'Value', type: 'mixed', w: 1.2, align: 'right' }, { h: 'Note', type: 'text', w: 4 }], rows: sum });

  // 2. MONTH BY MONTH
  const months = [];
  const tot = { rev: 0, ses: 0, ctr: 0, gift: 0, mem: 0, ref: 0, tax: 0, tips: 0, n: 0, mins: 0 };
  for (let m = 1; m <= 12; m++) {
    const a = `${y}-${pad(m)}-01`, b = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
    if (a > to) break;
    const r = rev.report(a, b < to ? b : to);
    const row = [MONTHS[m - 1], r.revenue_cents, r.sessions_cents, r.counter_cents, r.gift_sales_cents, r.membership_cents, -r.refunds_cents, r.tax_cents, r.tips_cents, r.count, Math.round(r.mins / 6) / 10];
    months.push(row);
    tot.rev += r.revenue_cents; tot.ses += r.sessions_cents; tot.ctr += r.counter_cents; tot.gift += r.gift_sales_cents; tot.mem += r.membership_cents;
    tot.ref += r.refunds_cents; tot.tax += r.tax_cents; tot.tips += r.tips_cents; tot.n += r.count; tot.mins += r.mins;
  }
  months.push({ cells: ['Year', tot.rev, tot.ses, tot.ctr, tot.gift, tot.mem, -tot.ref, tot.tax, tot.tips, tot.n, Math.round(tot.mins / 6) / 10], bold: true });
  S.push({ key: '02-months', title: 'Month by month', intro: 'Money on the day it was taken (refunds on the day they went back); sessions and hours by the day they were played.',
    columns: [{ h: 'Month', type: 'text', w: 1.3 }, { h: 'Revenue', type: 'money', w: 1.1, align: 'right' }, { h: 'Sessions online', type: 'money', w: 1.1, align: 'right' },
      { h: 'Counter', type: 'money', w: 1, align: 'right' }, { h: 'Gift cards', type: 'money', w: 1, align: 'right' }, { h: 'Member payments', type: 'money', w: 1.1, align: 'right' },
      { h: 'Refunds', type: 'money', w: 1, align: 'right' }, { h: 'Tax', type: 'money', w: 0.9, align: 'right' }, { h: 'Tips', type: 'money', w: 0.9, align: 'right' },
      { h: 'Played', type: 'int', w: 0.8, align: 'right' }, { h: 'Hours', type: 'num', w: 0.7, align: 'right' }], rows: months });

  // 3. QUARTERLY TAX
  const qrows = [];
  for (let q = 1; q <= 4; q++) {
    const a = `${y}-${pad(q * 3 - 2)}-01`, b = `${y}-${pad(q * 3)}-${pad(lastDay(y, q * 3))}`;
    if (a > to) break;
    const e = b < to ? b : to;
    const r = rev.report(a, e);
    qrows.push([`Q${q}`, a, e, r.revenue_cents, r.subtotal_cents, r.tax_cents, r.counter_cents]);
  }
  S.push({ key: '03-quarterly-tax', title: 'Quarterly tax', intro: 'Tax collected on online sessions and memberships, by calendar quarter. Tax charged at the counter is inside the counter money - its split by category is in the Counter section.',
    columns: [{ h: 'Quarter', type: 'text', w: 0.8 }, { h: 'From', type: 'text', w: 1.1 }, { h: 'To', type: 'text', w: 1.1 }, { h: 'Revenue', type: 'money', w: 1.2, align: 'right' },
      { h: 'Revenue before tax', type: 'money', w: 1.5, align: 'right' }, { h: 'Tax collected', type: 'money', w: 1.3, align: 'right' }, { h: 'Counter (tax inside)', type: 'money', w: 1.5, align: 'right' }], rows: qrows });

  // 4. EVERY PAYMENT AND REFUND
  const itemCols = [{ h: 'Date', type: 'text', w: 1 }, { h: 'What', type: 'text', w: 1.5 }].concat(names ? [{ h: 'Customer', type: 'text', w: 1.4 }] : [])
    .concat([{ h: 'Detail', type: 'text', w: 1.9 }, { h: 'Amount', type: 'money', w: 0.9, align: 'right' }, { h: 'Tax included', type: 'money', w: 0.9, align: 'right' },
      { h: 'Booking', type: 'text', w: 1.2 }, { h: 'Reference', type: 'text', w: 1.5 }]);
  const itemRow = it => [it.day, KIND[it.kind] || it.kind].concat(names ? [it.who || ''] : []).concat([it.what, it.cents, it.tax_cents, it.booking || '', it.ref || '']);
  S.push({ key: '04-payments', title: 'Every payment and refund', intro: 'One line for each payment taken and each refund given, in date order. Reference is the payment processor\'s own id where there is one, so any line can be found there.',
    columns: itemCols, rows: M.items.map(itemRow), big: true });

  // 5. REFUNDS
  const refundItems = M.items.filter(i => i.kind === 'refund');
  S.push({ key: '05-refunds', title: 'Refunds', intro: `${refundItems.length} refund(s), ${usd(M.refunds.cents)} in all, each on the day it went back.`,
    columns: [{ h: 'Date', type: 'text', w: 1 }].concat(names ? [{ h: 'Customer', type: 'text', w: 1.4 }] : []).concat([{ h: 'Session', type: 'text', w: 2 },
      { h: 'Amount', type: 'money', w: 1, align: 'right' }, { h: 'Tax share', type: 'money', w: 1, align: 'right' }, { h: 'Booking', type: 'text', w: 1.3 }, { h: 'Refund reference', type: 'text', w: 1.6 }]),
    rows: refundItems.map(it => [it.day].concat(names ? [it.who || ''] : []).concat([it.what, it.cents, it.tax_cents, it.booking || '', it.ref || ''])) });

  // 6. BY BAY, BY WEEKDAY
  S.push({ key: '06-by-bay', title: 'By bay', intro: 'Sessions played, and the money taken on each bay (net of refunds) - including any cancellation fee kept on a booking for that bay, so a bay can show money with fewer sessions.',
    columns: [{ h: 'Bay', type: 'text', w: 2 }, { h: 'Sessions', type: 'int', w: 1, align: 'right' }, { h: 'Hours', type: 'num', w: 1, align: 'right' }, { h: 'Money taken', type: 'money', w: 1.3, align: 'right' }],
    rows: A.by_bay.map(b => [b.bay_name || '(no bay)', b.count, Math.round(b.duration_minutes / 6) / 10, b.revenue_cents]) });
  S.push({ key: '07-by-weekday', title: 'By weekday', intro: 'Sessions played, and the money taken, by the day of the week of the session - including any cancellation fee kept for a session on that day.',
    columns: [{ h: 'Weekday', type: 'text', w: 2 }, { h: 'Sessions', type: 'int', w: 1, align: 'right' }, { h: 'Money taken', type: 'money', w: 1.3, align: 'right' }],
    rows: [1, 2, 3, 4, 5, 6, 0].map(i => [DAYS[i], A.by_dow[i].count, A.by_dow[i].revenue_cents]) });

  // 7. MEMBERSHIPS
  const u0 = `${y - 1}-12-30 00:00:00`, u1 = `${y + 1}-01-02 00:00:00`;
  const inYear = ts => { const d = rev.localDate(ts, tz); return d >= from && d <= to; };
  const tiers = all(`SELECT id, name FROM membership_tiers ORDER BY name`);
  const tierRows = tiers.map(t => {
    const joined = all(`SELECT created_at FROM members WHERE tier_id = ? AND created_at >= ? AND created_at < ?`, t.id, u0, u1).filter(r => inYear(r.created_at)).length;
    const activeNow = (one(`SELECT COUNT(*) c FROM members WHERE tier_id = ? AND status = 'active'`, t.id).c) || 0;
    const pays = all(`SELECT p.amount_cents, p.paid_at FROM membership_payments p JOIN members m ON m.id = p.member_id WHERE m.tier_id = ? AND p.paid_at >= ? AND p.paid_at < ?`, t.id, u0, u1).filter(p => inYear(p.paid_at));
    return [t.name, joined, activeNow, pays.length, pays.reduce((s, p) => s + (p.amount_cents | 0), 0)];
  });
  S.push({ key: '08-membership-tiers', title: 'Memberships by tier', intro: 'Members who joined in the year, members active today, and the membership payments recorded in the year, by tier.',
    columns: [{ h: 'Tier', type: 'text', w: 2 }, { h: 'Joined in the year', type: 'int', w: 1.2, align: 'right' }, { h: 'Active today', type: 'int', w: 1, align: 'right' },
      { h: 'Payments', type: 'int', w: 0.9, align: 'right' }, { h: 'Payment money', type: 'money', w: 1.2, align: 'right' }], rows: tierRows });
  const mpm = {};
  for (const it of M.items.filter(i => i.kind === 'membership')) { const k = it.day.slice(0, 7); mpm[k] = mpm[k] || { n: 0, c: 0 }; mpm[k].n++; mpm[k].c += it.cents; }
  S.push({ key: '09-membership-payments', title: 'Membership payments by month', intro: 'Membership payments the card processor reported paid, by the month they were paid.',
    columns: [{ h: 'Month', type: 'text', w: 2 }, { h: 'Payments', type: 'int', w: 1, align: 'right' }, { h: 'Money', type: 'money', w: 1.3, align: 'right' }],
    rows: MONTHS.map((n, i) => { const k = `${y}-${pad(i + 1)}`; return [n, (mpm[k] || {}).n || 0, (mpm[k] || {}).c || 0]; }).filter((r, i) => `${y}-${pad(i + 1)}-01` <= to) });

  // 8. GIFT CARDS - sold, given, spent, and what is still out there at the year's end
  const cards = all(`SELECT id, value, description, created_at FROM discount_codes WHERE type = 'gift' AND created_at < ?`, u1)
    .filter(g => rev.localDate(g.created_at, tz) <= to)
    .map(g => { let d = {}; try { d = JSON.parse(g.description || '{}'); } catch {} return { id: g.id, cents: Math.round(Number(g.value || 0) * 100), paid: d.paid !== false, day: rev.localDate(g.created_at, tz) }; });
  const usesBy = {};
  for (const u of all(`SELECT u.code_id, u.discount_cents, u.used_at FROM discount_uses u JOIN discount_codes c ON c.id = u.code_id WHERE c.type = 'gift' AND u.used_at < ?`, u1)) {
    if (rev.localDate(u.used_at, tz) > to) continue;
    usesBy[u.code_id] = (usesBy[u.code_id] || 0) + (u.discount_cents | 0);
  }
  const bal = c => Math.max(0, c.cents - (usesBy[c.id] || 0));
  const soldY = cards.filter(c => c.paid && c.day >= from), compY = cards.filter(c => !c.paid && c.day >= from);
  const giftRows = [
    ['Gift cards sold in the year', { v: soldY.length, t: 'int' }, { v: soldY.reduce((s, c) => s + c.cents, 0), t: 'money' }, 'money taken - in revenue'],
    ['Gift cards given free in the year', { v: compY.length, t: 'int' }, { v: compY.reduce((s, c) => s + c.cents, 0), t: 'money' }, 'face value - never money taken'],
    ['Gift card value spent in the year', '', { v: M.not_revenue.gift_card_spend_cents, t: 'money' }, 'stored value - not revenue again'],
    ['Balance still on sold cards at ' + to, { v: cards.filter(c => c.paid && bal(c) > 0).length, t: 'int' }, { v: cards.filter(c => c.paid).reduce((s, c) => s + bal(c), 0), t: 'money' }, 'value customers have paid for and not yet spent'],
    ['Balance still on free cards at ' + to, { v: cards.filter(c => !c.paid && bal(c) > 0).length, t: 'int' }, { v: cards.filter(c => !c.paid).reduce((s, c) => s + bal(c), 0), t: 'money' }, 'face value, never paid for']
  ];
  S.push({ key: '10-gift-cards', title: 'Gift cards', intro: 'Gift cards count as revenue when they are sold; spending one later is not new money. The balance still on cards is what customers could still spend.',
    columns: [{ h: 'Item', type: 'text', w: 2.6 }, { h: 'Cards', type: 'mixed', w: 0.7, align: 'right' }, { h: 'Money', type: 'mixed', w: 1.1, align: 'right' }, { h: 'Note', type: 'text', w: 2.6 }], rows: giftRows });

  // 9. THE COUNTER
  const byMethod = { card: { n: 0, c: 0, tip: 0 }, cash: { n: 0, c: 0, tip: 0 }, check: { n: 0, c: 0, tip: 0 }, credit: { n: 0, c: 0, tip: 0 }, gift: { n: 0, c: 0, tip: 0 } };
  for (const p of all(`SELECT method, amount_cents, tip_cents, created_at FROM tab_payments WHERE created_at >= ? AND created_at < ?`, u0, u1)) {
    if (!inYear(p.created_at) || !byMethod[p.method]) continue;
    byMethod[p.method].n++; byMethod[p.method].c += p.amount_cents | 0; byMethod[p.method].tip += p.tip_cents | 0;
  }
  const LABEL = { card: 'Card', cash: 'Cash', check: 'Check', credit: 'Member credit (stored value - not revenue)', gift: 'Gift card (stored value - not revenue)' };
  const payRows = Object.keys(byMethod).map(k => [LABEL[k], byMethod[k].n, byMethod[k].c, byMethod[k].tip]);
  // money given back at the counter (Sep 24 2026) - on the pad, or refunded in Stripe off a reader payment
  const back = M.refunds.counter_by_method || { card: 0, cash: 0, check: 0 };
  for (const k of ['card', 'cash', 'check']) if (back[k]) payRows.push([LABEL[k] + ' given back', '', -back[k], '']);
  if (M.refunds.counter_tips_cents) payRows.push(['Tips given back with them', '', '', -M.refunds.counter_tips_cents]);
  const giveBack = (back.card || 0) + (back.cash || 0) + (back.check || 0);
  payRows.push({ cells: ['Card, cash and check, less money given back (revenue)', byMethod.card.n + byMethod.cash.n + byMethod.check.n, byMethod.card.c + byMethod.cash.c + byMethod.check.c - giveBack, byMethod.card.tip + byMethod.cash.tip + byMethod.check.tip - (M.refunds.counter_tips_cents || 0)], bold: true });
  S.push({ key: '11-counter-payments', title: 'Counter - payments', intro: 'What was taken at the counter, by how it was paid, and what was given back - refunds are counted on the day the money went back, off the sale first and then the tip. Tips are the staff\'s and are shown beside the money, never in it.',
    columns: [{ h: 'Paid by', type: 'text', w: 3 }, { h: 'Payments', type: 'int', w: 1, align: 'right' }, { h: 'Money', type: 'money', w: 1.2, align: 'right' }, { h: 'Tips', type: 'money', w: 1, align: 'right' }], rows: payRows });
  const pos = require('./pos');
  const rates = (pos.posCfg(cfg).tax || {}).categories || {};
  const cat = {};
  for (const i of all(`SELECT * FROM tab_items WHERE sent_at >= ? AND sent_at < ?`, u0, u1)) {
    if (!inYear(i.sent_at)) continue;
    const c = pos.lineCents(i); const k = i.tax_category || 'food';
    cat[k] = cat[k] || { c: 0, tax: 0, n: 0 }; cat[k].c += c; cat[k].n++; cat[k].tax += Math.round(c * Number(rates[k] || 0) / 100);
  }
  const catRows = Object.keys(cat).sort().map(k => [k, cat[k].n, cat[k].c, Number(rates[k] || 0), cat[k].tax]);
  S.push({ key: '12-counter-sales', title: 'Counter - sales by tax category', intro: 'Everything rung up at the counter, less voids and comps, by tax category - with the tax worked out at the rates set on the day this report was made, the same way End of Day works it out. In a year when a rate changed, that category\'s tax here is slightly off; the counter money itself is exact.',
    columns: [{ h: 'Tax category', type: 'text', w: 2 }, { h: 'Lines', type: 'int', w: 0.8, align: 'right' }, { h: 'Sales', type: 'money', w: 1.2, align: 'right' },
      { h: 'Rate today %', type: 'num', w: 1, align: 'right' }, { h: 'Tax at that rate', type: 'money', w: 1.2, align: 'right' }], rows: catRows });

  // 10. DISCOUNTS GIVEN
  const disc = {};
  for (const u of all(`SELECT c.code, c.type, u.discount_cents, u.used_at FROM discount_uses u JOIN discount_codes c ON c.id = u.code_id WHERE c.type <> 'gift' AND u.used_at >= ? AND u.used_at < ?`, u0, u1)) {
    if (!inYear(u.used_at)) continue;
    const k = u.code; disc[k] = disc[k] || { type: u.type, n: 0, c: 0 };
    disc[k].c += u.discount_cents | 0; if ((u.discount_cents | 0) > 0) disc[k].n++; else disc[k].n--;
  }
  S.push({ key: '13-discounts', title: 'Discounts given', intro: 'Discount codes used, and what they took off (a use released by a cancellation is taken back). Member rates are a member\'s price, not a discount, and gift cards are stored value - neither is here.',
    columns: [{ h: 'Code', type: 'text', w: 2 }, { h: 'Kind', type: 'text', w: 1.2 }, { h: 'Uses', type: 'int', w: 0.8, align: 'right' }, { h: 'Taken off', type: 'money', w: 1.2, align: 'right' }],
    rows: Object.keys(disc).sort().map(k => [k, disc[k].type, disc[k].n, disc[k].c]) });

  // 11. NOTES
  const v = require('./version').current(path.join(__dirname, '..'));
  const notes = [
    ['Business', (cfg.server && cfg.server.businessName) || cfg.businessName || ''],
    ['Year', partial ? `${y} (partial - through ${to})` : String(y)],
    ['Time zone', tz || 'not set - dates are as the unit\'s clock gives them'],
    ['Revenue means', 'money actually taken, minus refunds: online sessions (price and tax), the counter\'s card, cash and check, gift cards sold, and membership payments - each counted on the day it was taken, a refund on the day it went back. Checkouts nobody paid for, member credit and gift card spending are not revenue; tips are the staff\'s.'],
    ['Definition version', R.basis],
    ['Customer names', names ? 'included - this file was made encrypted with the backup passphrase' : 'left out (the owner\'s choice when making it)'],
    ['Made', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
    ['Made by', `BA Booking System ${v.tag || ''}${v.drift != null ? ' (drift ' + v.drift + ')' : ''}`]
  ];
  if (frozen && frozen.year) notes.push(['Frozen record', `This year's customer details were removed at the ten-year purge on ${String(frozen.snapshotted_at || '').slice(0, 10)}. The figures here are worked out from the rows kept; the frozen record says revenue ${usd(frozen.revenue_cents)} (${frozen.revenue_basis || 'the definition before Sep 23 2026'}).`]);
  S.push({ key: '14-notes', title: 'Notes', intro: '', columns: [{ h: 'Item', type: 'text', w: 1.4 }, { h: 'Detail', type: 'text', w: 6 }], rows: notes });

  return { year: y, from, to, partial, names, tz, business: (cfg.server && cfg.server.businessName) || cfg.businessName || 'Facility', sections: S, summary: R };
}

// ── the files ────────────────────────────────────────────────────────────
function display(v, type) {
  if (v && typeof v === 'object' && 'v' in v) return display(v.v, v.t);
  if (v === '' || v == null) return '';
  if (type === 'money') return usd(v);
  if (type === 'int') return Number(v).toLocaleString('en-US');
  if (type === 'pct') return v + '%';
  if (type === 'num') return String(v);
  return String(v);
}
const csvCell = (v, type) => {
  if (v && typeof v === 'object' && 'v' in v) return csvCell(v.v, v.t);
  let s = v == null ? '' : (type === 'money' ? (Math.round(v) / 100).toFixed(2) : String(v));
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(sec) {
  const L = [sec.columns.map(c => csvCell(c.h, 'text')).join(',')];
  for (const r of sec.rows) { const cells = Array.isArray(r) ? r : r.cells; L.push(sec.columns.map((c, i) => csvCell(cells[i], c.type)).join(',')); }
  return L.join('\r\n') + '\r\n';
}
function toPdf(d) {
  const doc = new PdfDoc({ title: `${d.business} - ${d.year} year-end report`, author: d.business, footer: `${d.business} - ${d.year} year-end report${d.partial ? ' (partial, through ' + d.to + ')' : ''}` });
  doc.heading(`${d.business} - ${d.year} year-end report`, 1);
  doc.para(d.partial ? `The year so far, through ${d.to}. Every figure is partial until the year ends.` : `January 1 to December 31, ${d.year}.`, { size: 10.5 });
  doc.para('Revenue is money actually taken, minus refunds, each counted on the day it was taken in the facility\'s own time zone. The workbook and the CSV files beside this report carry the same figures; README.txt says what every column means.', { gray: 0.35 });
  for (const sec of d.sections) {
    doc.heading(sec.title, 2);
    if (sec.intro) doc.para(sec.intro, { gray: 0.35, size: 9 });
    const rows = sec.rows.map(r => { const cells = Array.isArray(r) ? r : r.cells; const out = sec.columns.map((c, i) => display(cells[i], c.type)); return Array.isArray(r) ? out : { cells: out, bold: r.bold }; });
    doc.table(sec.columns.map(c => ({ h: c.h, w: c.w, align: c.align })), rows, { size: sec.big ? 7.5 : 8.5 });
  }
  return doc.toBuffer();
}
function toSheets(d) {
  return d.sections.map(sec => ({
    name: sec.title,
    columns: sec.columns.map(c => ({ h: c.h, type: c.type === 'mixed' ? 'text' : c.type })),
    rows: sec.rows.map(r => {
      const cells = Array.isArray(r) ? r : r.cells;
      const out = sec.columns.map((c, i) => {
        const x = cells[i];
        if (x && typeof x === 'object' && 'v' in x) return { v: x.t === 'money' ? dollars(x.v) : x.v, t: x.t };
        return c.type === 'money' ? (x === '' || x == null ? '' : dollars(x)) : x;
      });
      return Array.isArray(r) ? out : { cells: out, bold: r.bold };
    })
  }));
}
function readme(d, files) {
  const L = [];
  L.push(`${d.business} - ${d.year} year-end report`);
  L.push('='.repeat(60));
  L.push(d.partial ? `The year so far, through ${d.to}. Every figure is partial until the year ends.` : `January 1 to December 31, ${d.year}.`);
  L.push('');
  L.push('WHAT IS IN THIS FOLDER');
  L.push('  report.pdf      every section below on paper');
  L.push('  workbook.xlsx   the same sections, one tab each (Excel, Numbers, LibreOffice); money is a real number');
  L.push('  csv/            the same tabs as plain CSV files - money as dollars and cents, e.g. 12.50');
  L.push('  README.txt      this file');
  L.push('');
  L.push('WHAT "REVENUE" MEANS HERE');
  L.push('  Money actually taken, minus refunds. The ways money comes in:');
  L.push('   - a session paid online: its price plus the tax on it');
  L.push('   - the counter: card, cash and check (tax the counter charged is inside it)');
  L.push('   - a gift card sold (spending it later is not new money)');
  L.push('   - a membership payment the card processor reported paid');
  L.push('  minus every refund. Each is counted on the day it was taken (a refund on the day it went back),');
  L.push(`  in the facility's time zone (${d.tz || 'not set'}).`);
  L.push('  NOT revenue: checkouts nobody paid for, member credit spent, gift card value spent, and tips (the staff\'s).');
  L.push('  Card processing fees are ESTIMATES from the rates set in Settings - the processor\'s own statements are exact.');
  L.push('  Refunds include every one made anywhere: on the counter pad, by this unit, and in the card processor\'s own');
  L.push('  dashboard (picked up automatically); a refund the processor reports failed does not count.');
  L.push('');
  L.push('COUNTER TAX BY CATEGORY - READ THIS');
  L.push('  The counter\'s tax split by category (Counter - sales by tax category) is worked out at the tax rates set on');
  L.push('  the day this report was made, not the rate on the day of each sale - the counter keeps its sales, not the rate');
  L.push('  it charged. In a year when a rate changed, that category\'s tax figure here is slightly off. The counter money');
  L.push('  itself (Counter - payments) is exact, and the tax the counter actually charged is inside it.');
  L.push(`  The definition's version is ${d.summary.basis}.`);
  L.push('');
  L.push('THE SECTIONS AND THEIR COLUMNS');
  for (const sec of d.sections) {
    const f = files[sec.key];
    L.push(`  ${sec.title}  (csv/${f})`);
    if (sec.intro) L.push('    ' + sec.intro);
    L.push('    Columns: ' + sec.columns.map(c => c.h + (c.type === 'money' ? ' (dollars)' : c.type === 'pct' ? ' (percent)' : '')).join(', '));
  }
  L.push('');
  L.push(d.names ? 'CUSTOMER NAMES: included. This file was made encrypted with the unit\'s backup passphrase; keep it somewhere only you can reach.'
                 : 'CUSTOMER NAMES: left out. Every line keeps its booking id and payment reference, so any of them can be looked up on the unit or with the card processor.');
  L.push('');
  L.push('Made ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC by the BA Booking System.');
  return L.join('\r\n') + '\r\n';
}

/** Build the year's folder in workDir and zip it. Resolves to { zipPath, data }. */
async function build(y, { names = false, workDir } = {}) {
  const d = gather(y, { names });
  const top = `${String(d.business).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'facility'}-${y}-year-end`;
  const dir = path.join(workDir, top);
  fs.mkdirSync(path.join(dir, 'csv'), { recursive: true });
  const files = {};
  for (const sec of d.sections) { files[sec.key] = sec.key + '.csv'; fs.writeFileSync(path.join(dir, 'csv', files[sec.key]), toCsv(sec)); }
  fs.writeFileSync(path.join(dir, 'report.pdf'), toPdf(d));
  await writeXlsx(toSheets(d), path.join(dir, 'workbook.xlsx'), { title: `${d.business} - ${y} year-end report` });
  fs.writeFileSync(path.join(dir, 'README.txt'), readme(d, files));
  const zipPath = path.join(workDir, top + '.zip');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath); const z = new ZipArchive({ zlib: { level: 9 } });
    out.on('close', resolve); z.on('error', reject); z.pipe(out);
    z.directory(dir + '/', top); z.finalize().catch(reject);
  });
  return { zipPath, name: top, data: d };
}

module.exports = { gather, build, toCsv, toPdf, readme };
