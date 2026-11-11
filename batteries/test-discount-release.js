// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-discount-release.js — a cancelled or never-completed booking must free
// its discount code AND restore any gift-card balance, so the code works again.
// Plus the member deposit UI wiring. (maintainer, Aug 15 2026.)
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

(async () => {
  const root = __dirname;
  const cfgPath = path.join(root, 'config.json');
  const dbPath = path.join(root, 'bookings.db');
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Release', setup: { completed: true },
    booking: { staffedAccess: false },
    bays: [{ id: 'bay1', name: 'B1', active: true }],
    server: { port: 3094 }
  }));
  const db = require('./services/db');
  await db.initDb();
  const D = db.db;
  const pricing = require('./services/pricing');

  console.log('\u2500\u2500 release on cancel: regular code + gift card \u2500\u2500');
  D.prepare("INSERT INTO discount_codes (id,code,description,type,value,max_uses,per_phone_limit,active) VALUES ('c1','SAVE10','10 off','fixed',1000,1,1,1)").run();
  D.prepare("INSERT INTO discount_codes (id,code,description,type,value,active) VALUES ('g1','GIFT50','gift','gift',5000,1)").run();
  D.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES ('bk1','bay1','B1','C','5551234567','2026-08-20','14:00','15:00','2026-08-20',60,7000,'active')").run();
  pricing.recordDiscountUse('c1', 'bk1', '5551234567', 1000);
  pricing.recordDiscountUse('g1', 'bk1', '5551234567', 5000);
  db.save();

  const codeActiveUses = () => D.prepare("SELECT COUNT(*) c FROM discount_uses WHERE code_id='c1' AND phone='5551234567' AND discount_cents>=0").get().c;
  const giftNet = () => D.prepare("SELECT COALESCE(SUM(discount_cents),0) s FROM discount_uses WHERE code_id='g1'").get().s;

  ok('before cancel: the regular code counts as used', codeActiveUses() === 1);
  ok('before cancel: the gift balance is consumed ($50)', giftNet() === 5000);

  const freed = pricing.releaseBookingCodes('bk1');
  db.save();
  ok('releaseBookingCodes reports both codes freed', freed === 2, { freed });
  ok('after cancel: the regular code is FREE again (works for next booking)', codeActiveUses() === 0);
  ok('after cancel: the gift-card balance is fully restored ($0 net consumed)', giftNet() === 0);

  // idempotency - a second release must not double-refund the gift
  pricing.releaseBookingCodes('bk1');
  db.save();
  ok('idempotent: a second release does not double-refund the gift', giftNet() === 0);

  console.log('\u2500\u2500 every cancellation path calls the release helper \u2500\u2500');
  {
    // routes/bookings.js dropped OFF this list on Sep 21 2026 and that is the
    // point: its only cancellation was `/cancel-legacy-disabled/:id`, the
    // unauthenticated route whose name had claimed retirement for months while
    // it refunded and revoked for anyone holding a booking id. It is a 410 now
    // and the file holds no cancel path at all, so a release call there would
    // be dead code. The assertion below is two-sided for exactly this reason:
    // a file that should have the call must have it, and bookings.js must NOT
    // grow one back without someone re-reading why it went.
    const files = {
      'routes/admin.js': 2, 'routes/customer.js': 1, 'services/bookingedit.js': 1
    };
    for (const [f, n] of Object.entries(files)) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      const c = (src.match(/releaseBookingCodes\(/g) || []).length;
      ok(f + ' wires the release on cancel', c >= n, { found: c, expected: n });
    }
    {
      const bsrc = fs.readFileSync(path.join(root, 'routes/bookings.js'), 'utf8');
      ok('routes/bookings.js has no cancellation path left to release from (both cancel routes are 410)',
         !/status='cancelled'/.test(bsrc) && !/releaseBookingCodes\(/.test(bsrc));
    }
    ok('releaseBookingCodes is exported from pricing', fs.readFileSync(path.join(root, 'services/pricing.js'), 'utf8').includes('releaseBookingCodes,'));
  }

  console.log('\u2500\u2500 member deposit UI is intuitive \u2500\u2500');
  {
    const adm = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    ok('deposit section explains the deposit is the Flat Rate per 30 min', adm.includes('Deposit collected online') && adm.includes('tierDepositEcho'));
    ok('the share discount is labelled as % off the door share', adm.includes("door share (%)"));
    ok('a worked example is shown so the math is clear', adm.includes('$20 deposit'));
    ok('the deposit fields reveal only when the checkbox is on', adm.includes('function tierDepositFieldsVis'));
    ok('the flat-rate value drives the deposit echo (one source of truth)', adm.includes('function tierDepositEcho'));
  }

  console.log('\u2500\u2500 bookings show WHY a price is reduced \u2500\u2500');
  {
    // seed a discounted booking and run the list query shape
    D.prepare("INSERT INTO discount_codes (id,code,description,type,value,active) VALUES ('cx','SUMMER20','s','percentage',20,1)").run();
    D.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES ('bx','bay1','B1','Tim','5551110000','2026-08-15','08:00','10:00','2026-08-15',120,12800,'completed')").run();
    pricing.recordDiscountUse('cx', 'bx', '5551110000', 3200);
    db.save();
    const row = D.prepare(`SELECT b.*, dc.code AS discount_code, dc.type AS discount_type,
        (SELECT COALESCE(SUM(discount_cents),0) FROM discount_uses u WHERE u.booking_id=b.id) AS discount_cents
      FROM bookings b
      LEFT JOIN discount_uses du ON du.id=(SELECT u2.id FROM discount_uses u2 WHERE u2.booking_id=b.id AND u2.discount_cents>0 ORDER BY u2.used_at LIMIT 1)
      LEFT JOIN discount_codes dc ON dc.id=du.code_id WHERE b.id='bx'`).get();
    ok('the bookings query returns the code that reduced the price', row.discount_code === 'SUMMER20', { code: row.discount_code });
    ok('the bookings query returns the amount saved', row.discount_cents === 3200, { saved: row.discount_cents });
    const adm = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    ok('the bookings list renders a discount reason note', adm.includes('function discountNote') && adm.includes('gift card'));
  }

  console.log('\u2500\u2500 pricing tiers are editable inline \u2500\u2500');
  {
    const adm = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    ok('tier rows have +/- price nudge buttons', adm.includes('function bumpTierPrice') && adm.includes("bumpTierPrice('"));
    ok('the nudge saves via the existing PUT /tiers/:id endpoint', adm.includes("'/api/pricing/tiers/' + encodeURIComponent(id), 'PUT'"));
    const pr = fs.readFileSync(path.join(root, 'routes/pricing.js'), 'utf8');
    ok('PUT /tiers/:id exists to persist the new price', pr.includes("router.put('/tiers/:id'"));
  }

  console.log('\u2500\u2500 deposit Value field relabels for clarity \u2500\u2500');
  {
    const adm = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    ok('the Value field relabels to Deposit when deposit mode is on', adm.includes('Deposit &mdash; $ per 30 min') && adm.includes('tierValueLabel'));
  }

  console.log('\nDISCOUNT RELEASE: ' + pass + ' passed, ' + fail + ' failed');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(dbPath); } catch {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
