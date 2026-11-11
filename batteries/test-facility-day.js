// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-facility-day.js - "TODAY" IS THE FACILITY'S DAY, NEVER UTC'S (Oct 2026, from pilot facility's 09-27 addendum)
//
// PART 1, a unit pinned at 9:00 PM Central on Oct 1 (02:00 UTC Oct 2 - the hour the UTC date has already
// turned), its zone America/Chicago, rows staged on disk before it boots:
//   F1  the admin's Today list shows Oct 1's 8:30 PM booking - not Oct 2's
//   F2  the Revenue tab's "today" card counts the session paid at 8:00 PM ($50), not the next day's $0
//   F3  the Block Off a Bay list (default "from today") still shows tonight's 10 PM block
//   F4  a member's active-booking limit counts their booking later today (the query takes the facility's day)
//   F5  the nightly backup that ran at 3 AM Oct 1 does NOT run again at 9 PM Oct 1 (it did, every evening,
//       logged as "caught up") - and it DOES run at 3:30 AM Oct 2
//
// PART 2, the counter:
// The counter stores its times in UTC (SQLite datetime('now'), ISO for refunds) and End of Day, the
// voids-and-comps review, the counter refunds review, expected cash and the staff pad's "Paid today"
// picked them with date(timestamp) = the day - a UTC day. From 7 PM Central (8 PM in summer) every sale,
// payment, tip, void, refund and drawer opening landed on TOMORROW: End of Day missed the evening, the
// drawer's expected cash missed the evening's cash, and "Paid today" dropped the day's earlier tabs once
// the UTC date turned. With no date given they also took the UTC date as "today".
//
// One facility in America/Chicago, the process itself forced to UTC (so only the facility's own zone
// can put a row on the right day), rows staged at known UTC instants:
//   D1  a 9:00 AM sale and an 8:30 PM sale (01:30 UTC the next day) are both on Oct 1's End of Day
//   D2  the 8:30 PM cash payment, its tip, its void, its refund and its drawer opening are all Oct 1's
//   D3  expected cash for Oct 1 counts the evening's cash and takes off the evening's cash refund
//   D4  "Paid today" for Oct 1 lists the morning and the evening tab, and not Oct 2's
//   D5  Oct 2's End of Day holds only Oct 2's sale
//   D6  the day the clocks go back (Nov 1, 25 hours): 11:30 PM local is Nov 1, 12:30 AM is Nov 2
//   D7  with no date, every report means the facility's today, not the UTC date (the clock pinned at 9 PM)
//
// PART 4, the website (Oct 20 2026): its "upcoming" events and its page cache follow the facility's day -
//   F10 at 11:59 PM Central tonight's event is still upcoming and the homepage's next event
//   F11 seconds after the facility's midnight the homepage turns over by itself (it waited for the UTC date, 7 PM)
'use strict';
process.env.TZ = 'UTC';                       // the OS zone can never stand in for the facility's
const fs = require('fs'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const root = __dirname;
const PORT = 3163, Bu = 'http://127.0.0.1:' + PORT, PW = 'facility-day-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };
const TZ = 'America/Chicago';

async function part1() {
  try { if ((await fetch(Bu + '/api/time')).ok) { ok('F0 port ' + PORT + ' is free', false); return; } } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Day Club', setup: { completed: true, eulaAccepted: true },
    server: { port: PORT, businessName: 'Day Club', adminPassword: PW, timezone: TZ },
    booking: { staffedAccess: true, pricePerHalfHour: 25 }, waiver: { mode: 'off' },
    bays: [{ id: 'fd-b1', name: 'Bay 1', active: true }, { id: 'fd-b2', name: 'Bay 2', active: true }],
    backup: { enabled: true, destination: 'off', hour: 3, lastNightlyDate: '2026-10-01' }
  }, null, 2));
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    db.initDb().then(async () => {
      const B = "INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,duration_minutes,price_cents,tax_cents,status,booking_type,stripe_payment_intent,stripe_charge_id,created_at) VALUES (?,'fd-b1','Bay 1',?,'5550101','a@b.c',?,?,?,60,?,0,'active',?,?,?,?)";
      db.db.prepare(B).run('fd-eve', 'Evening Golfer', '2026-10-01', '20:30', '21:30', 5000, null, 'pi_fd', 'ch_fd', '2026-10-02 01:00:00');
      db.db.prepare(B).run('fd-tmw', 'Tomorrow Golfer', '2026-10-02', '10:00', '11:00', 5000, null, '', '', '2026-10-01 15:00:00');
      db.db.prepare(B).run('fd-blk', 'Private event', '2026-10-01', '22:00', '23:00', 0, 'event', '', '', '2026-10-01 15:00:00');
      // F4: a member whose tier allows ONE upcoming booking, holding one for 10:30 PM tonight on Bay 2
      db.db.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,max_active_bookings) VALUES ('fd-tier','One At A Time','percentage',10,1,1)").run();
      db.db.prepare("INSERT INTO members (id,tier_id,name,phone,email,pin,status) VALUES ('fd-m','fd-tier','Max Member','+15550100777','max@day.example','7788','active')").run();
      db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,duration_minutes,price_cents,tax_cents,status,member_id,created_at) VALUES ('fd-mem','fd-b2','Bay 2','Max Member','+15550100777','max@day.example','2026-10-01','22:30','23:30',60,0,0,'active','fd-m','2026-10-01 15:00:00')").run();
      await db.flushed(); process.exit(0);
    }).catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  ok('F0 stage: tonight\'s booking, tomorrow\'s booking and tonight\'s block written before the unit starts', seed.status === 0, (seed.stderr || '').slice(-300));
  const env = Object.assign({}, process.env, { TZ, BA_FAKE_NOW: '2026-10-02T02:00:00Z', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' });
  const child = spawn(process.execPath, ['-r', './tools/fake-clock.js', 'server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  let up = false; for (let i = 0; i < 50; i++) { await sleep(400); try { if ((await fetch(Bu + '/api/time')).ok) { up = true; break; } } catch {} }
  ok('F0 the unit is up, its clock at 9:00 PM Central on Oct 1', up, log.slice(-300));
  const get = async p => { try { const r = await fetch(Bu + p, { headers: { 'x-admin-password': PW } }); return await r.json(); } catch (e) { return null; } };
  const today = await get('/api/admin/today');
  const ids = (Array.isArray(today) ? today : []).map(r => r.id);
  ok('F1 the admin\'s Today list is Oct 1: tonight\'s 8:30 PM booking, not tomorrow\'s', ids.includes('fd-eve') && !ids.includes('fd-tmw'), ids);
  const sum = await get('/api/admin/revenue/summary');
  ok('F2 the Revenue tab\'s "today" counts the $50 session paid at 8:00 PM', sum && sum.today && sum.today.revenue_cents === 5000, sum && sum.today && { today: sum.today.revenue_cents, month: sum.month && sum.month.revenue_cents });
  const bl = await get('/api/admin/blocks');
  ok('F3 the Block Off a Bay list still shows tonight\'s 10 PM block', !!(bl && (bl.blocks || []).some(b => b.id === 'fd-blk')), bl && (bl.blocks || []).map(b => b.id + ' ' + b.date));
  // F4 DRIVEN, NOT READ (Oct 3 2026, the pack review: this was a regex over routes/bookings.js) - at 9 PM Oct 1 the UTC
  // date is already Oct 2, so a count from UTC's today would miss tonight's 10:30 PM booking and let a second through
  const f4 = await (async () => { try { const r = await fetch(Bu + '/api/bookings/create-payment-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Max Member', phone: '+15550100777', email: 'max@day.example', date: '2026-10-03', start_time: '10:00', duration_minutes: 60, bay_id: 'fd-b1', member_pin: '7788' }) });
    return { s: r.status, d: await r.json().catch(() => ({})) }; } catch (e) { return { s: 0, d: { err: e.message } }; } })();
  ok('F4 at 9 PM a member whose tier allows ONE upcoming booking, holding one for 10:30 PM tonight, is refused a second - the limit counts from the facility\'s today (UTC\'s had already turned)',
     f4.s === 400 && /maximum of 1 upcoming booking/.test(f4.d.error || ''), f4);
  child.kill('SIGTERM'); for (let i = 0; i < 25 && child.exitCode === null; i++) await sleep(200); if (child.exitCode === null) child.kill('SIGKILL');
  const tick = at => { const r = spawnSync(process.execPath, ['-r', './tools/fake-clock.js', '-e', `
    const db = require('./services/db');
    db.initDb().then(async () => { const r = await require('./services/backup').maybeNightlyTick(); await db.flushed(); console.log('NIGHTLY ' + (r === null ? 'skipped' : 'ran')); process.exit(0); })
      .catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 120000, env: Object.assign({}, env, { BA_FAKE_NOW: at }) });
    return ((r.stdout || '').match(/NIGHTLY (\w+)/) || [])[1] || ('error: ' + (r.stderr || '').slice(-200)); };
  const evening = tick('2026-10-02T02:00:00Z'), night = tick('2026-10-02T08:30:00Z');
  ok('F5 the nightly backup done at 3 AM Oct 1 does not run again at 9 PM Oct 1', evening === 'skipped', evening);
  ok('F5 ...and runs at 3:30 AM Oct 2, its own hour', night === 'ran', night);
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
}

async function part2() {
  const dbM = require('./services/db');
  const cs = require('./services/config');
  await dbM.initDb();
  const pos = require('./services/pos');
  pos.ensureSchema();
  const D = dbM.db;
  for (const t of ['tab_items', 'tab_payments', 'tabs', 'drawer_events', 'tab_refunds', 'eod_reports']) { try { D.prepare(`DELETE FROM ${t}`).run(); } catch {} }

  const cfg = cs.getConfig();
  cfg.server = Object.assign({}, cfg.server, { timezone: TZ });
  cfg.pos = { checkinMode: 'full', payments: { cash: true, check: true }, tips: { enabled: true, mode: 'server' },
    tax: { categories: { sim: 7.375, food: 7.375, beverage: 9.875 }, stripeTax: false, codes: [] },
    drawer: { enabled: true }, openingFloatCents: 10000 };
  cs.saveConfig(cfg);

  // a closed tab with one item, one payment, optionally a void, a refund and a drawer opening - all at one UTC instant
  function stage(id, utc, { item = 1000, cash = 1075, tip = 0, voided = false, refund = 0, drawer = false } = {}) {
    D.prepare(`INSERT INTO tabs (id, label, status, opened_at, closed_by, closed_at) VALUES (?,?, 'closed', ?, 'Sam', ?)`).run(id, 'Tab ' + id, utc, utc);
    D.prepare(`INSERT INTO tab_items (id, tab_id, name, qty, unit_price_cents, tax_category, status, sent_at, sent_by) VALUES (?,?,?,1,?, 'food', 'sent', ?, 'Sam')`).run(id + '-i', id, 'Burger', item, utc);
    if (voided) D.prepare(`INSERT INTO tab_items (id, tab_id, name, qty, unit_price_cents, tax_category, status, sent_at, void_reason, void_by, void_at) VALUES (?,?,?,1,500, 'beverage', 'voided', ?, 'rung twice', 'Sam', ?)`).run(id + '-v', id, 'Soda', utc, utc);
    D.prepare(`INSERT INTO tab_payments (id, tab_id, method, amount_cents, tip_cents, tendered_cents, change_cents, employee, created_at) VALUES (?,?, 'cash', ?, ?, ?, 0, 'Sam', ?)`).run(id + '-p', id, cash, tip, cash + tip, utc);
    if (refund) D.prepare(`INSERT INTO tab_refunds (id, tab_id, payment_id, method, amount_cents, tip_cents, reason, employee, status, source, at) VALUES (?,?,?, 'cash', ?, 0, 'drink never came', 'Sam', 'succeeded', 'counter', ?)`)
      .run(id + '-r', id, id + '-p', refund, utc.replace(' ', 'T') + '.000Z');
    if (drawer) D.prepare(`INSERT INTO drawer_events (id, at, employee, reason, txn_id) VALUES (?,?, 'Sam', 'cash sale', ?)`).run(id + '-d', utc, id + '-p');
  }
  stage('am',  '2026-10-01 14:00:00', { item: 1000, cash: 1074 });                                                   // 9:00 AM CDT Oct 1
  stage('pm',  '2026-10-02 01:30:00', { item: 2000, cash: 2148, tip: 300, voided: true, refund: 500, drawer: true }); // 8:30 PM CDT Oct 1
  stage('nxt', '2026-10-02 15:00:00', { item: 4000, cash: 4295 });                                                   // 10:00 AM CDT Oct 2
  stage('dst1', '2026-11-02 05:30:00', { item: 700, cash: 752 });   // 11:30 PM CST Nov 1 (the clocks went back at 2 AM)
  stage('dst2', '2026-11-02 06:30:00', { item: 900, cash: 967 });   // 12:30 AM CST Nov 2

  const e1 = pos.eodSummary('2026-10-01');
  const cashPaid = r => (r.payments.find(p => p.method === 'cash') || {}).a;
  ok('D1 Oct 1 End of Day has the 9 AM and the 8:30 PM sale (food $10 + $20)', (e1.sales_by_category.food | 0) === 3000, e1.sales_by_category);
  ok('D2 the 8:30 PM payment is Oct 1 (cash $10.74 + $21.48)', cashPaid(e1) === 1074 + 2148, e1.payments);
  ok('D2 its tip is Oct 1 ($3.00)', e1.tips.shift_total === 300, e1.tips);
  ok('D2 its void is on Oct 1\'s review', e1.comps_voids.count === 1 && e1.comps_voids.rows[0].id === 'pm-v', e1.comps_voids);
  ok('D2 its cash refund is on Oct 1\'s refunds', (e1.refunds.by_method.cash | 0) === 500 && e1.refunds.rows.length === 1, e1.refunds);
  ok('D2 its drawer opening is Oct 1\'s', e1.drawer_events.length === 1 && e1.drawer_events[0].id === 'pm-d', e1.drawer_events.map(x => x.id));
  ok('D3 Oct 1 expected cash = float + the day\'s cash and tips - the evening\'s cash refund', e1.expected_cash_cents === 10000 + 1074 + 2148 + 300 - 500, e1.expected_cash_cents);

  const paid1 = pos.listClosedTabs('2026-10-01').map(t => t.id).sort();
  ok('D4 "Paid today" for Oct 1 lists the morning and the evening tab, not Oct 2\'s', JSON.stringify(paid1) === '["am","pm"]', paid1);

  const e2 = pos.eodSummary('2026-10-02');
  ok('D5 Oct 2 End of Day holds only Oct 2\'s sale ($40), cash and nothing of Oct 1', (e2.sales_by_category.food | 0) === 4000 && cashPaid(e2) === 4295 && e2.comps_voids.count === 0 && e2.refunds.rows.length === 0 && e2.drawer_events.length === 0, { s: e2.sales_by_category, p: e2.payments });
  ok('D5 Oct 2\'s "Paid today" is only Oct 2\'s tab', JSON.stringify(pos.listClosedTabs('2026-10-02').map(t => t.id)) === '["nxt"]');

  const n1 = pos.eodSummary('2026-11-01'), n2 = pos.eodSummary('2026-11-02');
  ok('D6 the day the clocks go back: 11:30 PM is Nov 1, 12:30 AM is Nov 2', (n1.sales_by_category.food | 0) === 700 && (n2.sales_by_category.food | 0) === 900, { n1: n1.sales_by_category, n2: n2.sales_by_category });

  // the clock pinned at 9:00 PM Central on Oct 1 - 02:00 UTC on Oct 2, the hour the old code got wrong
  // (in daytime the UTC date and the local date agree, and a check of "today" grades nothing)
  const RealDate = Date, PIN = RealDate.parse('2026-10-02T02:00:00Z');
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [PIN])); } static now() { return PIN; } };
  const today = '2026-10-01';
  const refunds = require('./services/refunds');
  D.prepare(`INSERT INTO tabs (id, label, status, opened_at, closed_at) VALUES ('now', 'Tab now', 'closed', '2026-10-02 01:59:00', '2026-10-02 01:59:00')`).run();
  ok('D7 with no date, End of Day, the review lists, expected cash and "Paid today" mean the facility\'s today (' + today + ')',
     pos.eodSummary().date === today && pos.listClosedTabs().some(t => t.id === 'now') && Array.isArray(pos.reviewList()) && Array.isArray(refunds.reviewList()) &&
     pos.closeDay({ counted_cents: 10000, counted_by: 'Sam' }).date === today,
     { eod: pos.eodSummary().date, today });
  global.Date = RealDate;

  // D8 (Oct 3 2026, the pack review): closes the old code filed under the UTC date go back to their own evening, at boot
  D.prepare(`DELETE FROM eod_reports`).run();
  const eod = (id, date, created, counted) => D.prepare(`INSERT INTO eod_reports (id, date, counted_cents, counted_by, created_at) VALUES (?,?,?, 'Sam', ?)`).run(id, date, counted, created);
  eod('old-pm', '2026-10-05', '2026-10-05 03:00:00', 41200);    // closed 10 PM CDT Oct 4 - the old code filed it under Oct 5
  eod('same-day', '2026-10-06', '2026-10-06 15:00:00', 30000);  // closed 10 AM CDT Oct 6 - its own day
  eod('taken', '2026-10-08', '2026-10-08 02:00:00', 25000);      // closed 9 PM CDT Oct 7, filed under Oct 8 ...
  eod('own-7', '2026-10-07', '2026-10-07 23:00:00', 19900);      // ... but Oct 7 already has its own close
  // a BOOT is a fresh load of the module: the rekey runs once per boot (the review - every tab read ran it)
  const boot = () => { delete require.cache[require.resolve('./services/pos')]; const p = require('./services/pos'); p.ensureSchema(); return p; };
  pos.ensureSchema();
  ok('D8a inside one boot, a second schema check does NOT run the rekey again (it ran on every tab read and read every End of Day row ever kept)',
     !!(D.prepare(`SELECT 1 FROM eod_reports WHERE date='2026-10-05' AND id='old-pm'`).get()), D.prepare(`SELECT id, date FROM eod_reports ORDER BY date`).all());
  boot();
  const at = d => D.prepare(`SELECT id, counted_cents FROM eod_reports WHERE date=?`).get(d) || {};
  ok('D8 at boot, an evening close the old code filed under tomorrow moves back to the evening it was made (Oct 4); a same-day close stays; one whose own day already has a close is left - nothing overwritten',
     at('2026-10-04').id === 'old-pm' && !at('2026-10-05').id && at('2026-10-06').id === 'same-day' && at('2026-10-08').id === 'taken' && at('2026-10-07').id === 'own-7',
     D.prepare(`SELECT id, date FROM eod_reports ORDER BY date`).all());
  pos.closeDay({ date: '2026-10-05', counted_cents: 5000, counted_by: 'Jo' });
  ok('D9 ...so the next day\'s close no longer overwrites last night\'s counted cash ($412.00 stays on Oct 4)', at('2026-10-04').counted_cents === 41200 && at('2026-10-05').counted_cents === 5000, { oct4: at('2026-10-04'), oct5: at('2026-10-05') });
  boot();
  ok('D10 a second boot moves nothing (the newer closes were made on their own day)', D.prepare(`SELECT COUNT(*) AS n FROM eod_reports`).get().n === 5 && at('2026-10-05').counted_cents === 5000, D.prepare(`SELECT id, date FROM eod_reports ORDER BY date`).all());
  // D8b/D8c (Oct 19 2026, the pack review): a row a later close OVERWROTE under the old key stays where it is. The old save
  // kept the first close's created_at and expected cash and replaced the count and the summary - Saturday's 10 PM close
  // filed under Sunday, then Sunday's afternoon close on the same key, is SUNDAY's count under Saturday evening's time.
  // (Dates after D11's own - fixed dates of a fixed fact: the rows are the old code's, the clock is not read.)
  const sumJ = (exp, extra) => JSON.stringify(Object.assign({ date: 'x', expected_cash_cents: exp, refunds: { rows: [] } }, extra || {}));
  const eodFull = (id, date, created, expected, counted, summary) => D.prepare(`INSERT INTO eod_reports (id, date, expected_cash_cents, counted_cents, counted_by, created_at, data_json) VALUES (?,?,?,?, 'Sam', ?, ?)`).run(id, date, expected, counted, created, summary);
  eodFull('over-cash', '2026-10-23', '2026-10-23 03:00:00', 20000, 35000, sumJ(35000));    // Thu Oct 22 10 PM, then Fri Oct 23's close on the same key
  eodFull('over-later', '2026-10-25', '2026-10-25 03:30:00', 15000, 15000, sumJ(15000, { refunds: { rows: [{ id: 'r1', created_at: '2026-10-25 19:00:00', amount_cents: 500 }] } }));   // same drawer, but the summary names a refund from Oct 25's afternoon
  eodFull('plain-pm', '2026-10-27', '2026-10-27 02:30:00', 9000, 9000, sumJ(9000, { refunds: { rows: [{ id: 'r2', created_at: '2026-10-26 20:00:00', amount_cents: 100 }] } }));   // a true evening close, never overwritten
  boot(); boot();
  const skipped = D.prepare(`SELECT detail FROM admin_log WHERE event='EOD_REKEY_SKIPPED' ORDER BY id`).all();
  ok('D8b a close a later close overwrote stays under its date (Sunday keeps its count, Saturday is not handed it), and the owner\'s log names it ONCE across two boots',
     at('2026-10-23').id === 'over-cash' && !at('2026-10-22').id && skipped.filter(x => /over-cash/.test(x.detail)).length === 1,
     { rows: D.prepare(`SELECT id, date FROM eod_reports ORDER BY date`).all(), skipped });
  ok('D8c the second mark works alone (same drawer, a summary naming something after the first save); a true evening close still moves back to its own day',
     at('2026-10-25').id === 'over-later' && skipped.filter(x => /over-later/.test(x.detail)).length === 1 && at('2026-10-26').id === 'plain-pm' && !at('2026-10-27').id,
     { rows: D.prepare(`SELECT id, date FROM eod_reports ORDER BY date`).all(), skipped });
  // D8d: a second close of the SAME day rewrites the expected cash with the count (it kept the first close's)
  pos.closeDay({ date: '2026-10-29', counted_cents: 1000, counted_by: 'Jo' });
  D.prepare(`UPDATE eod_reports SET expected_cash_cents = 777 WHERE date = '2026-10-29'`).run();
  const again = pos.closeDay({ date: '2026-10-29', counted_cents: 2000, counted_by: 'Jo' });
  const row20 = D.prepare(`SELECT expected_cash_cents, counted_cents, over_short_cents FROM eod_reports WHERE date='2026-10-29'`).get();
  ok('D8d a second close of the same day saves its own expected cash beside its own count (expected - counted = over/short on the screen)',
     row20.expected_cash_cents === again.expected_cash_cents && row20.counted_cents === 2000 && row20.over_short_cents === 2000 - row20.expected_cash_cents, row20);
  // D11 (the review): a restore does not restart the unit - the restored closes are rekeyed by the restore itself
  eod('restored-pm', '2026-10-12', '2026-10-12 03:00:00', 30100);   // a restored backup's evening close, under the UTC date
  require('./services/schema').migrateAfterRestore();
  ok('D11 a backup restored inside one boot: its evening close filed under tomorrow is moved back too (the rekey runs once per boot, and a restore is not a boot)', at('2026-10-11').id === 'restored-pm' && !at('2026-10-12').id, D.prepare(`SELECT id, date FROM eod_reports ORDER BY date`).all());
}

// ── PART 3: THE OWNER'S PAGE ASKS FOR THE FACILITY'S DAY (Oct 3 2026, the pack review) ──
// The server answers End of Day and the bay blocks by the facility's day, but the page sent the UTC date: from
// 7 PM Central that is tomorrow - End of Day opened empty and "not yet counted", Block Off a Bay listed and saved
// tomorrow. The page's own function, run with the clock at 8:30 PM Central.
function part3() {
  const fs = require('fs');
  const html = fs.readFileSync(require('path').join(__dirname, 'public', 'admin.html'), 'utf8');
  const fn = (html.match(/function facilityYmd\(\) \{[\s\S]*?\n\}/) || [''])[0];
  const RealDate = Date, at = RealDate.parse('2026-10-03T01:30:00Z');   // 8:30 PM Central on Oct 2
  class Evening extends RealDate { constructor(...a) { super(...(a.length ? a : [at])); } static now() { return at; } }
  let got = null, local = null;
  try {
    global.Date = Evening;
    got = new Function('window', 'currentConfig', fn + '; return facilityYmd();')({}, { server: { timezone: 'America/Chicago' } });
  } catch (e) { got = 'threw: ' + e.message; } finally { global.Date = RealDate; }
  ok('F8 the owner page\'s "today" at 8:30 PM Central is that evening\'s date in the facility\'s zone (2026-10-02), never the UTC date (2026-10-03)', got === '2026-10-02', { got, found: !!fn });
  const pages = ['admin.html', 'staff.html', 'me.html'].map(f => [f, fs.readFileSync(require('path').join(__dirname, 'public', f), 'utf8')]);
  const utcToday = pages.filter(([, src]) => /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(src)).map(([f]) => f);
  ok('F9 End of Day and Block Off a Bay (its list and its form) take that date, and no owner, staff or employee page fills "today" with the UTC date', /dEl\.value = facilityYmd\(\)/.test(html) && /blocks\?from=' \+ today/.test(html) && (html.match(/const today = facilityYmd\(\);/g) || []).length === 2 && utcToday.length === 0, { utcToday });
}

// ── PART 4: THE WEBSITE'S DAY (Oct 20 2026, found building the weekly specials on the AI branch) ──
// The website listed "upcoming" events from the machine clock's date, and each page was cached under the UTC date. On a
// unit the machine's zone is the facility's, but the cache key turned at 7 PM Central (the UTC date) and then NOT at the
// facility's midnight - so from midnight until 7 PM the next day the homepage kept yesterday's "next event". Here the
// process runs in UTC (only the facility's own zone may decide) and the clock starts 15 seconds before its midnight:
//   F10 at 11:59 PM Central tonight's event is still upcoming on the website and is the homepage's next event
//   F11 a few seconds after the facility's midnight the homepage turns over by itself: the next event is Oct 3's
async function part4() {
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Day Club', setup: { completed: true, eulaAccepted: true },
    server: { port: PORT, businessName: 'Day Club', adminPassword: PW, timezone: TZ },
    booking: { staffedAccess: true, pricePerHalfHour: 25 }, waiver: { mode: 'off' },
    bays: [{ id: 'fd-b1', name: 'Bay 1', active: true }]
  }, null, 2));
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    db.initDb().then(async () => {
      const E = "INSERT INTO website_events (id, title, event_date, description, flyer, link) VALUES (?, ?, ?, '', '', '')";
      db.db.prepare(E).run('fd-ev-tonight', 'Tonight Scramble', '2026-10-01');
      db.db.prepare(E).run('fd-ev-later', 'Saturday League', '2026-10-03');
      await db.flushed(); process.exit(0);
    }).catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { TZ: 'UTC' }) });
  ok('F10 stage: tonight\'s event and Saturday\'s written before the unit starts', seed.status === 0, (seed.stderr || '').slice(-300));
  const env = Object.assign({}, process.env, { TZ: 'UTC', BA_FAKE_NOW: '2026-10-02T04:59:45Z', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' });
  const child = spawn(process.execPath, ['-r', './tools/fake-clock.js', 'server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  try {
    let up = false; for (let i = 0; i < 50; i++) { await sleep(300); try { if ((await fetch(Bu + '/api/time')).ok) { up = true; break; } } catch {} }
    const site = async () => { try { return await (await fetch(Bu + '/api/website/content')).json(); } catch { return {}; } };
    // the homepage as a visitor gets it: the content it carries inline (window.BA_SITE)
    const home = async () => { try { const h = await (await fetch(Bu + '/landing')).text(); const m = h.match(/window\.BA_SITE=(\{[\s\S]*?\});<\/script>/); return m ? JSON.parse(m[1]) : {}; } catch { return {}; } };
    const c1 = await site(), h1 = await home();
    ok('F10 at 11:59 PM Central (04:59 UTC the next day) tonight\'s event is still upcoming on the website and the homepage\'s next event',
       up && (c1.events || []).some(e => e.id === 'fd-ev-tonight') && h1.nextEvent && h1.nextEvent.id === 'fd-ev-tonight', { up, events: (c1.events || []).map(e => e.id), next: h1.nextEvent && h1.nextEvent.id, log: log.slice(-200) });
    await sleep(22000);   // the clock runs on at real speed: now a few seconds past the facility's midnight
    const h2 = await home();
    ok('F11 a few seconds after the facility\'s midnight the homepage turns over by itself: tonight\'s event is gone and the next is Saturday\'s (it used to wait for 7 PM, the UTC date)',
       h2.nextEvent && h2.nextEvent.id === 'fd-ev-later' && !(h2.events || []).some(e => e.id === 'fd-ev-tonight'), { next: h2.nextEvent && h2.nextEvent.id, events: (h2.events || []).map(e => e.id) });
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    await sleep(800);
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
}

(async () => {
  await part1();
  await part2();
  part3();
  await part4();
  console.log(`\nFACILITY DAY: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
