// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-revenue.js — ONE DEFINITION OF REVENUE (maintainer, Sep 23 2026)
//
// "Revenue is money actually taken, minus refunds. An expired checkout nobody
//  paid for is not revenue, and a cancellation that kept part of the fee IS
//  revenue for the part kept. Both surfaces - the owner's report and the
//  ten-year records - read one definition from one place."
// The owner files tax from these numbers and the yearly figure is frozen for
// ever at the purge. Before this the report counted every active booking's price
// whether or not money was taken, the records counted checkouts that expired
// unpaid, neither subtracted a refund, a cancellation that kept half the fee
// dropped out of both, and member credit at the counter was counted as card money.
//
// One facility, every kind of money, staged on disk BEFORE the unit boots, in a
// past year (2025) and a real time zone (America/Chicago):
//   R1  the report and the ten-year records give the SAME revenue for the year
//   R2  an expired checkout nobody paid is not revenue - and is named as such
//   R3  a cancellation that kept half the fee counts the half kept
//   R4  a full refund nets to zero
//   R5  a refund in a later month lands in THAT month (money on the day it moved)
//   R6  member credit and gift-card spending at the counter are not new money;
//       tips are reported beside revenue, not in it
//   R7  a gift card sold is money; a comped one is not
//   R8  a membership payment is money
//   R9  a payment at 11:30 pm local on Mar 31 is March, not April (the facility's zone)
//   R10 the CSV's REVENUE line, the monthly chart and the daily chart all agree
//   R11 a refund and a membership payment are written once however often they are reported
//   R12 a frozen year names the definition that made it
//   R13 by bay and by weekday add up to the sessions' money - a cancellation's kept part on its bay and its
//       day - while their counts stay the sessions that were played (Oct 2026, pilot facility's 09-27 addendum)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 360) : '')); } };
const root = __dirname;
const PORT = 3134;
const B = 'http://127.0.0.1:' + PORT;
const PW = 'revenue-battery-pw';
const H = { 'x-admin-password': PW };
const TZ = 'America/Chicago';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// local wall time in Chicago -> the UTC string SQLite stores (CST is UTC-6, CDT UTC-5)
function utc(localYmdHm) {
  const [d, t] = localYmdHm.split(' ');
  for (const off of [5, 6]) {
    const guess = new Date(`${d}T${t}:00Z`); guess.setUTCHours(guess.getUTCHours() + off);
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(guess).replace(',', '');
    if (back.replace(/^(\d{4}-\d\d-\d\d) 24:/, '$1 00:') === `${d} ${t}`) return guess.toISOString().slice(0, 19).replace('T', ' ');
  }
  throw new Error('no UTC for ' + localYmdHm);
}

// ── the facility's money in 2025 ──
// sessions: [id, status, price, tax, intent, charge, taken (local), session date]
const SESSIONS = [
  ['rv-paid',     'completed', 5000, 350, 'pi_a', 'ch_a', '2025-03-02 09:00', '2025-03-09'],   // paid online: +5350
  ['rv-expired',  'expired',   4000, 280, 'pi_b', '',     '2025-03-02 10:00', '2025-03-10'],   // abandoned, never charged: NOT revenue
  ['rv-halfkept', 'cancelled', 6000, 420, 'pi_c', 'ch_c', '2025-03-03 11:00', '2025-03-20'],   // charged 6420, refunded 3000 on Mar 5: +3420 kept
  ['rv-fullref',  'expired',   4000, 280, 'pi_d', 'ch_d', '2025-03-04 12:00', '2025-03-04'],   // paid after the hold lapsed, refunded in full Mar 6: nets 0
  ['rv-latref',   'cancelled', 2000, 140, 'pi_e', 'ch_e', '2025-03-10 13:00', '2025-04-05'],   // taken in March, refunded in APRIL
  ['rv-door',     'completed', 3000, 0,   '',     '',     '2025-03-11 14:00', '2025-03-11'],   // no online payment: its money is at the counter
];
const REFUNDS = [
  ['re_c', 'rv-halfkept', 3000, '2025-03-05 09:30'],
  ['re_d', 'rv-fullref',  4280, '2025-03-06 09:30'],
  ['re_e', 'rv-latref',   2140, '2025-04-02 09:30'],
];
// counter: [id, method, amount, tip, local time]
const COUNTER = [
  ['tp-card',   'card',   2000, 300, '2025-03-11 15:00'],
  ['tp-cash',   'cash',   1500, 0,   '2025-03-12 16:00'],
  ['tp-check',  'check',  1000, 0,   '2025-03-13 17:00'],
  ['tp-credit', 'credit',  800, 0,   '2025-03-14 18:00'],   // member credit: stored value
  ['tp-gift',   'gift',    500, 0,   '2025-03-15 19:00'],   // a gift card spent: stored value
  ['tp-late',   'cash',    700, 0,   '2025-03-31 23:30'],   // 11:30 pm Mar 31 local = Apr 1 04:30 UTC: MARCH
];
const GIFTS = [['gc-sold', 50.00, true, '2025-03-16 10:00'], ['gc-comp', 25.00, false, '2025-03-16 11:00']];
const DUES = [['in_1', 5900, 0, '2025-03-17 08:00']];

const MARCH = 5350 + 6420 + 4280 + 2140          // sessions taken in March (the expired one never was)
  + 2000 + 1500 + 1000 + 700                        // counter card/cash/check
  + 5000                                            // gift card sold
  + 5900                                            // membership payment
  - 3000 - 4280;                                    // refunds in March
const APRIL = -2140;
const YEAR = MARCH + APRIL;

(async () => {
  try { const r = await fetch(B + '/api/time'); if (r.ok) { console.log('FAIL  port ' + PORT + ' already answers - an orphaned server is running.'); process.exit(1); } } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Revenue Club', setup: { completed: true, eulaAccepted: true },
    server: { port: PORT, businessName: 'Revenue Club', adminPassword: PW, timezone: TZ },
    booking: { staffedAccess: true, pricePerHalfHour: 25 }, waiver: { mode: 'off' },
    bays: [{ id: 'rv-b1', name: 'Bay 1', active: true }]
  }, null, 2));

  // staged on disk before the unit boots, by a process that then exits (rule 22's shape)
  const stage = { SESSIONS: SESSIONS.map(r => r.concat([utc(r[6])])), REFUNDS: REFUNDS.map(r => r.concat([utc(r[3])])),
    COUNTER: COUNTER.map(r => r.concat([utc(r[4])])), GIFTS: GIFTS.map(r => r.concat([utc(r[3])])), DUES: DUES.map(r => r.concat([utc(r[3])])) };
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    (async () => {
      await db.initDb();
      require('./services/pos').ensureSchema();
      const S = ${JSON.stringify(stage)};
      for (const r of S.SESSIONS) db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent,stripe_charge_id,created_at) VALUES (?,'rv-b1','Bay 1',?,'+15550000','',?,'10:00','11:00',?,60,?,?,?,?,?,?)")
        .run(r[0], 'Customer ' + r[0], r[7], r[7], r[2], r[3], r[1], r[4], r[5], r[8]);
      for (const r of S.REFUNDS) {   // through the product's own stamp, as a refund site calls it - twice (R11)
        db.markRefunded(r[1], new Date(r[4].replace(' ', 'T') + 'Z').toISOString(), { id: r[0], amount: r[2] }, 'battery');
        db.markRefunded(r[1], new Date(r[4].replace(' ', 'T') + 'Z').toISOString(), { id: r[0], amount: r[2] }, 'battery');
      }
      db.db.prepare("INSERT INTO tabs (id, label, status, opened_by) VALUES ('rv-tab','Counter','closed','Staff')").run();
      for (const r of S.COUNTER) db.db.prepare("INSERT INTO tab_payments (id,tab_id,method,amount_cents,tip_cents,employee,created_at) VALUES (?,'rv-tab',?,?,?,'Staff',?)").run(r[0], r[1], r[2], r[3], r[5]);
      for (const r of S.GIFTS) db.db.prepare("INSERT INTO discount_codes (id,code,description,type,value,max_uses,uses_count,active,created_at) VALUES (?,?,?,'gift',?,NULL,0,1,?)").run(r[0], 'GC' + r[0].toUpperCase().replace(/[^A-Z0-9]/g, ''), JSON.stringify({ gift: true, paid: r[2] }), r[1], r[4]);
      for (const r of S.DUES) {   // as the webhook and the reconcile both report it (R11), and an unpaid invoice that must not count
        const inv = { id: r[0], status: 'paid', amount_paid: r[1], tax: r[2], status_transitions: { paid_at: Math.floor(new Date(r[4].replace(' ', 'T') + 'Z').getTime() / 1000) } };
        db.recordMembershipPayment(inv, 'm-1', 'webhook'); db.recordMembershipPayment(inv, 'm-1', 'reconcile');
      }
      db.recordMembershipPayment({ id: 'in_open', status: 'open', amount_paid: 0, total: 5900, created: 1741000000 }, 'm-1', 'reconcile');
      await db.flushed();
      process.exit(0);
    })().catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  ok('stage: a year of every kind of money written to disk before the unit starts', seed.status === 0, (seed.stderr || '').slice(-400));

  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' }) });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  let up = false; for (let i = 0; i < 50; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
  ok('stage: the unit is up', up, log.slice(-300));
  const get = async p => { try { const r = await fetch(B + p, { headers: H }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; } catch (e) { return { s: 0, t: String(e) }; } };

  const mar = (await get('/api/admin/revenue/summary?start=2025-03-01&end=2025-03-31')).j || {};
  const apr = (await get('/api/admin/revenue/summary?start=2025-04-01&end=2025-04-30')).j || {};
  const yr  = (await get('/api/admin/revenue/summary?start=2025-01-01&end=2025-12-31')).j || {};
  const M = mar.range || {}, A = apr.range || {}, Y = yr.range || {};
  const rec = (await get('/api/admin/records/status')).j || {};
  const y25 = (rec.yearly || []).find(r => r.year === 2025) || {};

  ok('R1 THE SAME NUMBER: the owner\'s report and the ten-year records give the same 2025 revenue, to the cent', Y.revenue_cents === YEAR && y25.revenue_cents === YEAR, { report: Y.revenue_cents, records: y25.revenue_cents, want: YEAR });
  ok('R1b ...and both say which definition made it', Y.basis === 'money-taken-v1' && y25.revenue_basis === 'money-taken-v1', { report: Y.basis, records: y25.revenue_basis });
  ok('R2 an expired checkout nobody paid is NOT revenue - and is named, with its value, as money that did not come in',
     M.not_revenue && M.not_revenue.expired_unpaid.count === 1 && M.not_revenue.expired_unpaid.cents === 4280 && y25.expired_unpaid_cents === 4280, M.not_revenue);
  ok('R3 a cancellation that kept half the fee counts the half kept (charged 6420, 3000 back)', M.revenue_cents === MARCH && M.refunds_cents === 3000 + 4280, { revenue: M.revenue_cents, want: MARCH, refunds: M.refunds_cents });
  ok('R4 a full refund nets to zero (taken 4280, 4280 back) - it is in the sessions AND the refunds', M.sessions_cents === 5350 + 6420 + 4280 + 2140 && M.refunds_cents >= 4280, { sessions: M.sessions_cents });
  ok('R5 a refund made in April lands in APRIL - the month the money went back - and the year nets both', A.revenue_cents === APRIL && A.refunds_cents === 2140 && Y.revenue_cents === MARCH + APRIL, { april: A.revenue_cents, year: Y.revenue_cents });
  ok('R6 at the counter: card, cash and check are money; member credit and gift-card spending are not (named as stored value); tips are reported apart',
     M.counter_cents === 2000 + 1500 + 1000 + 700 && M.inperson_card_cents === 2000 && M.not_revenue.member_credit_cents === 800 && M.not_revenue.gift_card_spend_cents === 500 && M.tips_cents === 300,
     { counter: M.counter_cents, card: M.inperson_card_cents, nr: M.not_revenue, tips: M.tips_cents });
  ok('R7 a gift card sold is money; a comped one is not', M.gift_sales_cents === 5000, M.gift_sales_cents);
  ok('R8 a membership payment is money (an unpaid invoice is not)', M.membership_cents === 5900 && y25.membership_cents === 5900, { report: M.membership_cents, records: y25.membership_cents });
  ok('R9 a payment at 11:30 pm on Mar 31 (Chicago) is MARCH - the facility\'s day, not UTC\'s', M.inperson_cash_cents === 1500 + 700 && A.inperson_cash_cents === 0, { march: M.inperson_cash_cents, april: A.inperson_cash_cents });
  ok('R9b the report still counts SESSIONS by the day they were played (activity is not money): 2 took place in March - the paid one and the one paid at the door; the cancelled and expired ones did not',
     M.count === 2, { count: M.count });

  const csv = await get('/api/admin/revenue/csv?from=2025-03-01&to=2025-03-31');
  const revLine = (csv.t || '').split('\r\n').find(l => l.startsWith('REVENUE (money taken minus refunds),')) || '';
  const lineCents = Math.round(Number(revLine.split(',')[1]) * 100);
  const lines = (csv.t || '').split('\r\n');
  ok('R10 the CSV\'s REVENUE line equals the report, and every payment and refund is a line of its own (no expired checkout among them)',
     lineCents === MARCH && lines.some(l => l.includes(',rv-halfkept,') && l.includes('Refund')) && !lines.some(l => l.includes(',rv-expired,')), { line: revLine });
  const monthly = (await get('/api/admin/revenue/monthly?year=2025')).j || [];
  const daily = (await get('/api/admin/revenue/daily?year=2025&month=03')).j || [];
  const marMonth = (monthly.find(m => m.month === '2025-03') || {}).revenue_cents;
  const dailySum = daily.reduce((t, d) => t + (d.revenue_cents || 0), 0);
  ok('R10b the monthly chart\'s March and the daily chart\'s March both equal the report', marMonth === MARCH && dailySum === MARCH, { monthly: marMonth, daily: dailySum });

  const counts = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const db=new SQL.Database(require('fs').readFileSync('bookings.db'));const q=s=>db.exec(s)[0].values[0][0];console.log(JSON.stringify({refunds:q("SELECT COUNT(*) FROM refunds"),dues:q("SELECT COUNT(*) FROM membership_payments")}));process.exit(0)})`], { cwd: root, encoding: 'utf8' });
  let cnt = {}; try { cnt = JSON.parse(counts.stdout.trim().split('\n').pop()); } catch {}
  ok('R11 each refund and each membership payment is written ONCE however many times it is reported (keyed by Stripe\'s id); an open invoice is not written', cnt.refunds === 3 && cnt.dues === 1, cnt);

  try { child.kill('SIGTERM'); } catch {}
  await new Promise(r => { child.on('exit', r); setTimeout(r, 3000); });

  // ── R13: the tables add up (the kept half of rv-halfkept, a Thursday, on Bay 1) ──
  {
    const bays = yr.byBay || [], dow = yr.byDow || [];
    const baySum = bays.reduce((s, b) => s + (b.revenue_cents | 0), 0);
    const SESSION_NET = 5350 + (6420 - 3000) + (4280 - 4280) + (2140 - 2140);   // every session's money taken minus refunded
    ok('R13 by bay adds up to the sessions\' money for the year, the cancellation\'s kept $34.20 included', baySum === SESSION_NET, { baySum, want: SESSION_NET, bays });
    ok('R13 ...and the kept part is on its weekday (Thursday Mar 20) beside the Sunday session', (dow[4] || {}).revenue_cents === 3420 && (dow[0] || {}).revenue_cents === 5350, dow);
    const b1 = bays.find(b => b.bay_name === 'Bay 1') || {};
    ok('R13 ...while the count stays the sessions that were played (2), not the cancelled ones', b1.count === 2, b1);
  }

  // ── R12: a frozen year names its definition ──
  const froze = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    db.initDb().then(async () => {
      const rec = require('./services/records');
      const m = rec.snapshotYear(2025);
      const row = db.db.prepare('SELECT revenue_cents, revenue_basis, refunds_cents FROM records_yearly WHERE year = 2025').get();
      await db.flushed();
      console.log(JSON.stringify({ m: m.revenue_cents, row }));
      process.exit(0);
    }).catch(e => { console.error(e.message); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let fz = {}; try { fz = JSON.parse(froze.stdout.trim().split('\n').pop()); } catch {}
  ok('R12 a year frozen at the purge keeps the same revenue and names the definition that made it (revenue_basis)', fz.row && fz.row.revenue_cents === YEAR && fz.row.revenue_basis === 'money-taken-v1' && fz.row.refunds_cents === 3000 + 4280 + 2140, fz);

  for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  console.log(`\nREVENUE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\nREVENUE: ${pass} passed, ${fail + 1} failed`); process.exit(1); });
