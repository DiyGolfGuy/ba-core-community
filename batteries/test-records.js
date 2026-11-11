// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-records.js - RECORDS & RETENTION (maintainer's doctrine, Aug 25 2026).
//
// The doctrine on trial: person detail ("Brian had a tee time"), waivers
// included, purges at 10 years - 10 the FLOOR, whole years at a time, and the
// year's numbers are frozen forever FIRST. Facility facts (money, tax, busy
// times, member counts, growth) survive the purge in place. Owners can pull a
// per-year archive of the full detail beforehand, under vault law: it leaves
// the unit encrypted when the passphrase is set. One warning email per year,
// 90 days out. Second run of anything changes nothing.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) { try { fs.unlinkSync(f); } catch {} }
fs.writeFileSync('config.json', JSON.stringify({
  businessName: 'Records Test', setup: { completed: true, eulaAccepted: true },
  server: { port: 3001, businessName: 'Records Test', adminPassword: 'records-pw-1' },
  booking: { staffedAccess: true, pricePerHalfHour: 30 }, waiver: { mode: 'off' },
  contact: { email: 'owner@example.test' },
  records: { retentionYears: 7 },   // BELOW the floor on purpose - the engine must refuse it
  bays: [{ id: 'rb1', name: 'Bay 1', active: true }]
}));

(async () => {
  console.log('\u2500\u2500 1. the engine, no server \u2500\u2500');
  const dbM = require('./services/db');
  await dbM.initDb();
  require('./services/pos').ensureSchema();
  require('./services/checks');
  const rec = require('./services/records');
  rec.ensureSchema();
  const D = dbM.db;

  // the floor
  ok('the FLOOR: config says 7 years, the engine answers 10 - a hand-edited config can never shorten retention', rec.retentionYears() === 10);
  ok('eligibility math: at retention 10 in 2026, the last purgeable year is 2015', rec.lastEligibleYear({ y: 2026, m: 8, d: 31, date: new Date('2026-08-31T12:00:00') }) === 2015);
  const nx = rec.nextPurge({ y: 2026, m: 8, d: 31, date: new Date('2026-08-31T12:00:00') });
  ok('whole years, never rolling days: 2016 purges on Jan 1, 2027 - every record lives AT LEAST the full 10', nx.year === 2016 && nx.on === '2027-01-01', nx);   // fixed date: computed from the "now" passed in above

  // ── seed 2014: a year full of person detail across every surface ──
  const SIGNED_DIR = require('./services/waiver').SIGNED_DIR;
  fs.mkdirSync(SIGNED_DIR, { recursive: true });
  const pdfName = 'w-2014-brian.pdf';
  fs.writeFileSync(path.join(SIGNED_DIR, pdfName), '%PDF-1.4 test');
  const B = (id, date, name, phone, email, price, tax, status, extra) => D.prepare(
    `INSERT INTO bookings (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date, duration_minutes, price_cents, tax_cents, status, booking_type, member_id, door_code, stripe_payment_intent, signature_name, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    // created when it was booked - a 2014 booking's money was taken in 2014 (revenue is dated when money is taken)
    .run(id, 'rb1', 'Bay 1', name, phone, email, date, '10:00', '11:00', date, 60, price, tax, status, (extra && extra.type) || 'customer', (extra && extra.member) || '', 'DC1234', 'pi_test_123', name, date + ' 09:00:00');
  B('bk14a', '2014-06-01', 'Brian Oldman', '5551110001', 'brian@x.test', 6000, 420, 'completed');
  B('bk14b', '2014-06-02', 'Carla Oldman', '5551110002', 'carla@x.test', 9000, 630, 'completed', { member: 'mOld' });
  B('bk14c', '2014-06-03', 'Ghost Nobody', '5551110003', '', 3000, 210, 'cancelled');           // out of the money numbers
  B('bk14d', '2014-06-04', 'Maintenance',  '',           '', 0,    0,   'active', { type: 'maintenance' }); // block, not a customer
  B('bk26a', '2026-06-01', 'Recent Rita',  '5552220001', 'rita@x.test', 6000, 420, 'completed');
  D.prepare(`INSERT INTO members (id, tier_id, name, phone, email, pin, status, created_at, updated_at, notes, stripe_customer_id)
             VALUES ('mOld','t1','Oscar Oldmember','5553330001','oscar@x.test','1111','cancelled','2014-01-05','2014-11-01','likes bay 1','cus_old')`).run();
  D.prepare(`INSERT INTO members (id, tier_id, name, phone, email, pin, status, created_at, updated_at, notes, stripe_customer_id)
             VALUES ('mNew','t1','Recent Rita','5552220001','rita@x.test','2222','active','2026-01-05','2026-06-01','','cus_new')`).run();
  D.prepare(`INSERT INTO member_usage (id, member_id, booking_id, date, duration_minutes, guest_count) VALUES ('u1','mOld','bk14b','2014-06-02',60,2)`).run();
  D.prepare(`INSERT INTO member_guests (id, member_id, booking_id, date, guest_count) VALUES ('g1','mOld','bk14b','2014-06-02',2)`).run();
  D.prepare(`INSERT INTO signed_waivers (id, booking_id, waiver_id, waiver_name, waiver_version, customer_name, customer_phone, agreed_at, signature_name, signed_pdf_path, session_date, method, employee)
             VALUES ('sw1','bk14a','w1','Liability','1','Brian Oldman','5551110001','2014-06-01 09:55:00','Brian Oldman',?, '2014-06-01','digital','Sam Staff')`).run(pdfName);
  D.prepare(`INSERT INTO signed_waivers (id, booking_id, waiver_id, waiver_name, waiver_version, customer_name, customer_phone, agreed_at, signature_name, signed_pdf_path, session_date, method)
             VALUES ('sw2','bk26a','w1','Liability','1','Recent Rita','5552220001','2026-06-01 09:55:00','Recent Rita','', '2026-06-01','digital')`).run();
  D.prepare(`INSERT INTO seats (id, booking_id, name, member_id, golf_cents) VALUES ('s1','bk14b','Carla Oldman','mOld',4500)`).run();
  D.prepare(`INSERT INTO discount_uses (id, code_id, booking_id, phone, discount_cents, used_at) VALUES ('du1','c1','bk14a','5551110001',500,'2014-06-01 10:00:00')`).run();
  D.prepare(`INSERT INTO tabs (id, booking_id, label, member_id, status, opened_by, opened_at, closed_by, closed_at) VALUES ('t14','bk14b','Walk-in Carla','mOld','closed','Sam Staff','2014-06-02 10:05:00','Sam Staff','2014-06-02 11:40:00')`).run();
  D.prepare(`INSERT INTO tab_items (id, tab_id, name, qty, unit_price_cents, person, sent_at, sent_by) VALUES ('ti14','t14','Burger',1,1200,'Carla','2014-06-02 10:30:00','Sam Staff')`).run();
  D.prepare(`INSERT INTO tab_payments (id, tab_id, method, amount_cents, tip_cents, employee, memo, created_at) VALUES ('tp14','t14','cash',1200,200,'Sam Staff','no onions','2014-06-02 11:39:00')`).run();
  D.prepare(`INSERT INTO drawer_events (id, at, employee, reason) VALUES ('de14','2014-06-02 11:39:30','Sam Staff','sale')`).run();
  // employees (Sep 2026): a 2014 clock entry, shift and two requests
  for (const t of ['time_entries', 'shifts', 'timeoff_requests', 'shift_requests']) { try { D.prepare(`DELETE FROM ${t} WHERE id >= 900000`).run(); } catch {} }
  D.prepare(`INSERT INTO time_entries (id, staff_code, staff_name, clock_in, clock_out, worked_minutes, break_minutes, note, reviewed_by) VALUES (900001,'4242','Sam Staff','2014-06-02 09:00:00','2014-06-02 17:00:00',450,30,'left early','Owner')`).run();
  D.prepare(`INSERT INTO shifts (id, date, start_time, end_time, staff_code, label, note) VALUES (900001,'2014-06-02','09:00','17:00','4242','Open','covering for Pat')`).run();
  D.prepare(`INSERT INTO timeoff_requests (id, staff_code, staff_name, start_date, end_date, note, status, decided_by) VALUES (900001,'4242','Sam Staff','2014-07-01','2014-07-03','wedding','approved','Owner')`).run();
  D.prepare(`INSERT INTO shift_requests (id, shift_id, staff_code, staff_name, kind, note, status, decided_by, created_at) VALUES (900001,900001,'4242','Sam Staff','drop','sick','approved','Owner','2014-06-01 10:00:00')`).run();
  // W29: a 2014 hours export that was emailed - the stored file has names in it
  try { D.prepare(`DELETE FROM hours_sends WHERE id >= 900000`).run(); } catch {}
  D.prepare(`INSERT INTO hours_sends (id, period_start, period_end, status, how, recipients, cc, people, total_minutes, bytes, sha256, csv, token, sent_at) VALUES (900001,'2014-06-02','2014-06-08','sent','scheduled','books@example.com','owner@example.com',1,450,120,'abc','Employee Name,...\n"Sam Staff","E1",...','tok','2014-06-09 06:00:00')`).run();
  D.prepare(`INSERT INTO settlements (booking_id, actual_golfers, standard_total_cents, settled_by, settled_at) VALUES ('bk14b',3,9000,'Sam Staff','2014-06-02 11:41:00')`).run();
  D.prepare(`INSERT INTO admin_log (event, detail, created_at) VALUES ('BOOKING_CREATED','Brian Oldman booked Bay 1','2014-06-01 09:50:00')`).run();

  // ── the numbers BEFORE anything is touched ──
  const pre = rec.computeYearMetrics(2014);
  // Revenue by the one definition (Sep 23 2026): money taken minus refunds, tax included -
  // $64.20 + $96.30 for the two sessions paid online, + $12 at the counter = $172.50.
  // The cancelled checkout was never charged, the maintenance block is not a customer.
  ok('2014 pre-purge numbers: 2 bookings (cancelled + maintenance out), 2h, $172.50 revenue ($160.50 sessions + $12 counter), $10.50 tax, 2 customers, 1 active member, 1 new member, 2 guest visits, 1 waiver',
    pre.bookings === 2 && pre.hours === 2 && pre.revenue_cents === 17250 && pre.sessions_cents === 16050 && pre.tax_cents === 1050 && pre.revenue_basis === 'money-taken-v1' &&
    pre.unique_customers === 2 && pre.members_active === 1 && pre.new_members === 1 && pre.guest_visits === 2 && pre.waivers_signed === 1, pre);
  ok('2014 POS numbers ride along: $12 sales, $2 tips', pre.pos_cents === 1200 && pre.tips_cents === 200, pre);

  // ── the purge ──
  const counts = rec.purgeYear(2014, { by: 'battery' });
  const b14 = D.prepare(`SELECT * FROM bookings WHERE id='bk14a'`).get();
  ok('a purged booking keeps the facility facts: date, times, bay, price, tax, status - forever', b14.date === '2014-06-01' && b14.price_cents === 6000 && b14.tax_cents === 420 && b14.duration_minutes === 60 && b14.status === 'completed', b14);
  ok('...and loses the person: name, phone, email, door code, signature, stripe refs, member link', b14.name === 'Purged' && b14.phone === '' && b14.email === '' && b14.door_code === '' && b14.signature_name === '' && !/^pi_/.test(b14.stripe_payment_intent || '') && (b14.member_id === '' || b14.member_id === null), b14);
  // Sep 23 2026: the Stripe id goes, the FACT that it was paid online stays - revenue is money taken
  ok('...but keeps THAT it was paid online (the Stripe id becomes "purged"), so the year still adds up from its own rows', b14.stripe_payment_intent === 'purged', b14.stripe_payment_intent);
  ok('waivers included (maintainer): the 2014 signed row is GONE and its PDF is off the disk', !D.prepare(`SELECT id FROM signed_waivers WHERE id='sw1'`).get() && !fs.existsSync(path.join(SIGNED_DIR, pdfName)) && counts.waiver_rows === 1 && counts.waiver_pdfs === 1, counts);
  const s1 = D.prepare(`SELECT * FROM seats WHERE id='s1'`).get();
  ok('seat names purge with their booking; the seat MONEY stays', s1.name === 'Purged' && s1.member_id === '' && s1.golf_cents === 4500, s1);
  ok('discount use keeps the cents, loses the phone', (D.prepare(`SELECT phone, discount_cents FROM discount_uses WHERE id='du1'`).get() || {}).phone === '' && (D.prepare(`SELECT discount_cents FROM discount_uses WHERE id='du1'`).get() || {}).discount_cents === 500);
  const t14 = D.prepare(`SELECT * FROM tabs WHERE id='t14'`).get();
  const tp14 = D.prepare(`SELECT * FROM tab_payments WHERE id='tp14'`).get();
  ok('POS at 10+ years: walk-in label, person chips and employee stamps purge; every cent of sales, tips and items stays',
    t14.label === 'Purged' && t14.opened_by === '' && tp14.employee === '' && tp14.memo === '' && tp14.amount_cents === 1200 && tp14.tip_cents === 200 &&
    (D.prepare(`SELECT person, sent_by, unit_price_cents FROM tab_items WHERE id='ti14'`).get() || {}).person === '' &&
    (D.prepare(`SELECT settled_by, standard_total_cents FROM settlements WHERE booking_id='bk14b'`).get() || {}).settled_by === '', { t14, tp14 });
  {
    const te = D.prepare(`SELECT * FROM time_entries WHERE id=900001`).get();
    const sh = D.prepare(`SELECT * FROM shifts WHERE id=900001`).get();
    const to = D.prepare(`SELECT * FROM timeoff_requests WHERE id=900001`).get();
    const sr = D.prepare(`SELECT * FROM shift_requests WHERE id=900001`).get();
    ok('employees: the 2014 clock entry keeps its HOURS and loses the person (name, code, note, reviewer)',
       te && te.worked_minutes === 450 && te.break_minutes === 30 && te.staff_name === 'Purged' && te.staff_code === '' && te.note === '' && te.reviewed_by === '', te);
    ok('employees: the 2014 shift keeps its date and times, loses who and the note', sh && sh.date === '2014-06-02' && sh.start_time === '09:00' && sh.staff_code === '' && sh.note === '', sh);
    ok('employees: 2014 time-off and shift requests keep their status, lose the person', to && to.status === 'approved' && to.staff_name === 'Purged' && to.staff_code === '' && to.note === '' && sr && sr.status === 'approved' && sr.staff_name === 'Purged' && sr.staff_code === '', { to, sr });
    const hs = D.prepare(`SELECT * FROM hours_sends WHERE id=900001`).get();
    ok('W29: the 2014 hours send keeps when, to whom, how many hours; the stored file (names inside) and the token are gone', hs && hs.status === 'sent' && hs.people === 1 && hs.total_minutes === 450 && hs.recipients === 'books@example.com' && hs.csv === '' && hs.token === '', hs);
  }
  ok('the 2014 admin-log trail is gone; today\'s RECORDS_PURGED entry is not', !D.prepare(`SELECT id FROM admin_log WHERE substr(created_at,1,4)='2014'`).get() && !!D.prepare(`SELECT id FROM admin_log WHERE event='RECORDS_PURGED'`).get());
  const mOld = D.prepare(`SELECT * FROM members WHERE id='mOld'`).get();
  ok('a member silent since the purged year and not active: person gone, PIN unusable, tier/status/created kept for the growth numbers', mOld.name === 'Purged' && mOld.phone === '' && /^PURGED-/.test(mOld.pin) && mOld.stripe_customer_id === '' && mOld.tier_id === 't1' && mOld.status === 'cancelled' && mOld.created_at === '2014-01-05', mOld);
  const rita = D.prepare(`SELECT * FROM members WHERE id='mNew'`).get();
  const b26 = D.prepare(`SELECT name, phone FROM bookings WHERE id='bk26a'`).get();
  ok('nothing recent is touched: Rita\'s membership, her booking, her waiver all intact', rita.name === 'Recent Rita' && rita.pin === '2222' && b26.name === 'Recent Rita' && !!D.prepare(`SELECT id FROM signed_waivers WHERE id='sw2'`).get());

  // ── forever numbers ──
  const frozen = D.prepare(`SELECT * FROM records_yearly WHERE year=2014`).get();
  ok('the year was FROZEN FIRST: the snapshot equals the pre-purge numbers, identity-dependent counts included', !!frozen && frozen.bookings === pre.bookings && frozen.revenue_cents === pre.revenue_cents && frozen.tax_cents === pre.tax_cents && frozen.unique_customers === 2 && frozen.members_active === 1 && frozen.guest_visits === 2 && frozen.waivers_signed === 1, frozen);
  const yl = rec.yearlyMetrics();
  const y14 = yl.find(r => r.year === 2014), y26 = yl.find(r => r.year === 2026);
  ok('Reports feed: 2014 serves the frozen snapshot, 2026 computes live', y14 && y14.frozen === true && y14.unique_customers === 2 && y26 && y26.frozen === false && y26.bookings === 1, { y14, y26 });
  ok('after the purge the anonymized rows STILL sum: live recompute of 2014 money matches the snapshot (busy times and revenue survive in place)', (() => { const m = rec.computeYearMetrics(2014); return m.revenue_cents === pre.revenue_cents && m.tax_cents === pre.tax_cents && m.hours === pre.hours; })());

  // ── second run changes nothing ──
  const again = rec.purgeYear(2014, { by: 'battery' });
  ok('purge is idempotent: a second pass finds no person detail to touch', again.bookings === 0 && again.waiver_rows === 0 && again.members === 0 && again.seats === 0, again);

  // ── the nightly: warn once, purge what is due, skip what is done ──
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date, duration_minutes, price_cents, tax_cents, status, booking_type)
             VALUES ('bk16a','rb1','Bay 1','Wanda Warnme','5554440001','wanda@x.test','2016-03-01','10:00','11:00','2016-03-01',60,6000,420,'completed','customer')`).run();
  const nov = { y: 2026, m: 11, d: 15, date: new Date('2026-11-15T05:00:00') };   // fixed date: the nightly's own "now", passed in
  // SENT FIRST, THEN MARKED (Oct 3 2026): an email that does not go leaves the year unwarned, said in the log, and the
  // next night tries again - it used to be marked warned before the email was even tried
  const emailMod = require('./services/email'), realSend = emailMod.sendEmail;
  emailMod.sendEmail = async () => false;   // the provider refuses, as the real sender answers a refusal
  let night = await rec.runNightly(nov);
  emailMod.sendEmail = realSend;
  ok('the purge notice email that did NOT go: the year is not marked warned, RECORDS_PURGE_NOTICE_FAILED says so, and the next night tries again', night.warned.length === 0 && !D.prepare(`SELECT warned_at FROM records_purges WHERE year=2016 AND warned_at IS NOT NULL`).get() && !!D.prepare(`SELECT id FROM admin_log WHERE event='RECORDS_PURGE_NOTICE_FAILED' AND detail LIKE 'year 2016%'`).get(), night);
  night = await rec.runNightly(nov);
  ok('inside 90 days of Jan 1: the owner is warned about 2016, once, and the notice is logged', night.warned.length === 1 && night.warned[0] === 2016 && !!D.prepare(`SELECT id FROM admin_log WHERE event='RECORDS_PURGE_NOTICE'`).get(), night);
  ok('nothing purged early: 2016 has 46 days left and 2015-and-older hold no detail', night.purged.length === 0, night);
  night = await rec.runNightly(nov);
  ok('the second nightly warns nobody again', night.warned.length === 0, night);
  const aug = { y: 2026, m: 8, d: 31, date: new Date('2026-08-31T05:00:00') };
  night = await rec.runNightly(aug);
  ok('outside the window nothing happens at all', night.warned.length === 0 && night.purged.length === 0, night);

  // seed 2015 person detail for the over-HTTP purge-now proof
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date, duration_minutes, price_cents, tax_cents, status, booking_type)
             VALUES ('bk15a','rb1','Bay 1','Pete Purgeme','5555550001','pete@x.test','2015-05-01','10:00','11:00','2015-05-01',60,6000,420,'completed','customer')`).run();
  const st0 = rec.status();
  ok('status: retention 10 (floored), 2016 next with detail, 2015 eligible NOW, archivable lists the detail years', st0.retention_years === 10 && st0.next_purge.year === 2016 && st0.next_purge.has_detail === true && st0.eligible_now.includes(2015) && st0.archivable.includes(2015) && st0.archivable.includes(2016) && st0.archivable.includes(2026) && !st0.archivable.includes(2014), st0);
  dbM.save();

  // ── 2. over HTTP ──
  console.log('\n\u2500\u2500 2. the card\'s routes + vault law on the archive \u2500\u2500');
  const BASE = 'http://localhost:3001';
  const H = { 'x-admin-password': 'records-pw-1', 'Content-Type': 'application/json' };
  const ch = spawn('node', ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
  let errLines = []; ch.stderr.on('data', d => { for (const l of String(d).split('\n')) if (/TypeError|ReferenceError|SyntaxError/.test(l)) errLines.push(l); });
  process.on('exit', () => { try { ch.kill('SIGINT'); } catch {} });
  let up = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 400)); try { if ((await fetch(BASE + '/api/time')).ok) { up = true; break; } } catch {} }
  ok('server boots with the records engine wired', up);
  if (!up) { try { ch.kill('SIGINT'); } catch {} process.exit(1); }
  const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: H, body: JSON.stringify(b) });

  let r = await fetch(BASE + '/api/admin/records/status');
  ok('status without the admin login is refused', r.status === 401, r.status);
  r = await fetch(BASE + '/api/admin/records/status', { headers: H }); let j = await r.json();
  ok('status over HTTP: floor 10, frozen 2014 in the yearly feed, 2015 eligible', r.status === 200 && j.retention_years === 10 && j.floor_years === 10 && j.yearly.some(y => y.year === 2014 && y.frozen) && j.eligible_now.includes(2015), { st: r.status });
  r = await post('/api/admin/records/settings', { retentionYears: 7 }); j = await r.json();
  ok('settings refuse anything under the floor, in plain words', r.status === 400 && /never.*below 10/i.test(j.error || ''), j);
  r = await post('/api/admin/records/settings', { retentionYears: 12 }); j = await r.json();
  ok('raising retention to 12 is the owner\'s right', r.status === 200 && j.retention_years === 12, j);
  r = await fetch(BASE + '/api/admin/records/status', { headers: H }); j = await r.json();
  ok('at 12 years, 2015 is no longer eligible - longer retention takes effect immediately', j.retention_years === 12 && !j.eligible_now.includes(2015), j.eligible_now);
  r = await post('/api/admin/records/settings', { retentionYears: 10 });
  ok('back to 10', r.status === 200);

  // archive, no vault: REFUSED (maintainer, Sep 24 2026 - "a year's records with names and
  // money is the thing most worth encrypting - same rule as USB and off-site")
  r = await fetch(BASE + '/api/admin/records/archive/2015', { headers: H });
  { const jj = await r.json().catch(() => ({}));
    ok('year archive with no passphrase set: REFUSED in words (409), never a plain file of names', r.status === 409 && jj.needsPassphrase === true && /passphrase/.test(jj.error || ''), { st: r.status, jj }); }
  r = await fetch(BASE + '/api/admin/records/archive/2015?plain=1', { headers: H });
  ok('...not even asking for the unencrypted copy', r.status === 409, r.status);
  r = await fetch(BASE + '/api/admin/records/archive/1999', { headers: H });
  ok('a nonsense year is refused', r.status === 400);
  r = await fetch(BASE + '/api/admin/records/archive/2015');
  ok('the archive is refused without the owner login (it is a book of names)', r.status === 401);

  // vault law: with the passphrase set, the archive leaves encrypted
  r = await post('/api/admin/backup/vault/passphrase', { passphrase: 'records vault phrase 2026' });
  ok('vault passphrase set for the encrypted leg', r.status === 200);
  r = await fetch(BASE + '/api/admin/records/archive/2015', { headers: H });
  const encBuf = Buffer.from(await r.arrayBuffer());
  ok('with the vault set the archive leaves ENCRYPTED (.baenc, BAENC1 header) - a download is a copy that leaves the unit', r.status === 200 && encBuf.subarray(0, 6).toString() === 'BAENC1' && /\.baenc"$/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.writeFileSync(path.join(tmp, 'a.baenc'), encBuf);
  const vault = require('./services/backupvault');
  ok('...and the owner\'s passphrase opens it back into the same detail', (() => { try { const z = vault.decryptFile(path.join(tmp, 'a.baenc'), 'records vault phrase 2026', path.join(tmp, 'a.zip')); return fs.readFileSync(z).includes('bookings-2015.csv'); } catch { return false; } })());
  r = await fetch(BASE + '/api/admin/records/archive/2015?plain=1', { headers: H });
  const plainBuf = Buffer.from(await r.arrayBuffer());
  ok('?plain=1 (the 2FA step-up path; lock off here) is a plain zip again', r.status === 200 && plainBuf.readUInt32LE(0) === 0x04034b50 && /records-2015\.zip"$/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'));
  ok('the zip carries the year\'s person detail: bookings, waivers, members CSVs + the README', ['bookings-2015.csv', 'signed-waivers-2015.csv', 'members-2015.csv', 'README.txt'].every(n => plainBuf.includes(n)));

  // purge-now: the owner's own button does exactly what the night does
  r = await post('/api/admin/records/purge-now', {}); j = await r.json();
  ok('purge-now anonymizes 2015 and reports the counts', r.status === 200 && j.ok === true && j.purged.some(p => p.year === 2015 && p.counts.bookings === 1), j);
  r = await fetch(BASE + '/api/admin/records/status', { headers: H }); j = await r.json();
  ok('after it: 2015 frozen in the yearly feed, out of eligible and archivable, in the purge ledger', j.yearly.some(y => y.year === 2015 && y.frozen) && !j.eligible_now.includes(2015) && !j.archivable.includes(2015) && j.purges.some(p => p.year === 2015 && p.purged_at), { purges: j.purges });

  // ── THE OWNER'S LOG IS KEPT BY AGE, NEVER BY ROW COUNT (maintainer, Sep 12 2026) ──
  // The route: the months can be raised, never set below twelve; the status carries the months and the log's size.
  r = await post('/api/admin/records/settings', { adminLogMonths: 6 }); j = await r.json();
  ok('LOG1 the owner cannot keep the log for fewer than twelve months (400, the floor named)', r.status === 400 && /12 months/.test(j.error || ''), j);
  r = await post('/api/admin/records/settings', { adminLogMonths: 24 }); j = await r.json();
  ok('LOG2 the owner CAN keep it longer (24 months saved, echoed)', r.status === 200 && j.ok === true && j.admin_log_months === 24, j);
  r = await fetch(BASE + '/api/admin/records/status', { headers: H }); j = await r.json();
  ok('LOG3 the records status carries the months, the floor and the log\'s size (rows, oldest, about how many bytes)', j.admin_log_months === 24 && j.admin_log_floor_months === 12 && j.admin_log && j.admin_log.rows > 0 && !!j.admin_log.oldest && j.admin_log.approxBytes > 0, { m: j.admin_log_months, f: j.admin_log_floor_months, log: j.admin_log });
  r = await post('/api/admin/records/settings', { adminLogMonths: 12 });
  ok('zero runtime error signatures', errLines.length === 0, errLines.slice(0, 3));
  try { ch.kill('SIGINT'); } catch {}
  await new Promise(r2 => setTimeout(r2, 500));
  // Against EXISTING rows in a fresh process (rule 22): a row from thirteen months ago is pruned, one from eleven
  // is kept, a hand-edited config of 3 months still prunes at twelve (the floor is enforced in the code), a config
  // of 24 keeps the thirteen-month row, and the nightly records job runs the prune.
  const { spawnSync } = require('child_process');
  const oneShot = (js) => spawnSync(process.execPath, ['-e', js], { cwd: __dirname, encoding: 'utf8', timeout: 120000 });
  const onDisk = () => JSON.parse(oneShot(`require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec("SELECT event FROM admin_log WHERE event LIKE 'LOGAGE_%' ORDER BY event");console.log('ROWS '+JSON.stringify(r.length?r[0].values.map(v=>v[0]):[]));process.exit(0)})`).stdout.split('\n').find(l => l.startsWith('ROWS ')).slice(5));
  const seedRows = () => oneShot(`const db=require('./services/db');db.initDb().then(()=>{db.db.prepare("DELETE FROM admin_log WHERE event LIKE 'LOGAGE_%'").run();db.db.prepare("INSERT INTO admin_log (event,detail,created_at) VALUES ('LOGAGE_13','thirteen months ago',datetime('now','-13 months'))").run();db.db.prepare("INSERT INTO admin_log (event,detail,created_at) VALUES ('LOGAGE_11','eleven months ago',datetime('now','-11 months'))").run();db.db.prepare("INSERT INTO admin_log (event,detail,created_at) VALUES ('LOGAGE_25','twenty-five months ago',datetime('now','-25 months'))").run();db.flushSync();process.exit(0)})`);
  const setMonths = (m) => { const c = JSON.parse(fs.readFileSync('config.json', 'utf8')); c.records = Object.assign({}, c.records, { adminLogMonths: m }); fs.writeFileSync('config.json', JSON.stringify(c, null, 2)); };
  // A-wave 10: this helper used to CALL pruneAdminLog() itself, so LOG4-LOG7 passed
  // whether or not initDb pruned at all - delete the boot call and the suite stayed
  // green. It now does what a unit does at start-up and nothing else: load, claim the
  // writer, flush. The count it prints is the owner's-log line the prune writes.
  const prune = () => oneShot(`const db=require('./services/db');db.initDb().then(()=>{db.claimWriter();db.flushSync();console.log('PRUNED '+db.db.prepare("SELECT COUNT(*) AS c FROM admin_log WHERE event='ADMIN_LOG_PRUNED'").get().c);process.exit(0)})`);
  const nightly = () => oneShot(`const db=require('./services/db');db.initDb().then(async()=>{const o=await require('./services/records').runNightly();db.flushSync();console.log('NIGHT '+JSON.stringify(o));process.exit(0)})`);
  seedRows(); setMonths(12); let pr = prune(); let rows = onDisk();
  ok('LOG4 a fresh process that only BOOTS (initDb, claim the writer, flush - no prune call of its own): the thirteen- and twenty-five-month rows are gone from the file, the eleven-month row kept, and ADMIN_LOG_PRUNED is in the owner\'s own log', rows.join() === 'LOGAGE_11' && /PRUNED [1-9]/.test(pr.stdout), { out: pr.stdout.trim().slice(-60), rows });
  seedRows(); setMonths(3); pr = prune(); rows = onDisk();
  ok('LOG5 a hand-edited config of 3 months still prunes at TWELVE - the floor lives in the code, not the settings screen', rows.join() === 'LOGAGE_11', { out: pr.stdout.trim().slice(-60), rows });
  seedRows(); setMonths(24); pr = prune(); rows = onDisk();
  ok('LOG6 with 24 months the thirteen-month row is KEPT and only the twenty-five-month row goes', rows.join() === 'LOGAGE_11,LOGAGE_13', { out: pr.stdout.trim().slice(-60), rows });
  seedRows(); setMonths(12); const nt = nightly(); rows = onDisk();
  ok('LOG7 the nightly records job runs the prune itself (adminLogPruned reported) - the boot prune and the night prune are the same call, so a unit that never reboots still prunes each night', /"adminLogPruned":\d+/.test(nt.stdout) && rows.join() === 'LOGAGE_11', { out: (nt.stdout || '').trim().slice(-160), rows });
  const src = fs.readFileSync(path.join(__dirname, 'services', 'db.js'), 'utf8');
  ok('LOG8 the old rule is gone: nothing in db.js keeps the last N rows of admin_log any more', !/ORDER BY id DESC LIMIT 5000/.test(src) && /function pruneAdminLog/.test(src) && /ADMIN_LOG_FLOOR_MONTHS = 12/.test(src));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) { try { fs.unlinkSync(f); } catch {} }
  console.log('\nRECORDS: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
