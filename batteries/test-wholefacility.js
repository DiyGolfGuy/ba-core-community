// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-wholefacility.js — WHOLE-FACILITY RENTAL (Aug 2026, maintainer's edge case)
//
// The archetype: a venue rents the ENTIRE building as one. One booking, no
// bay choice, blocks every bay, and runs the FULL start sequence on every
// bay and the full end sequence on every bay - while admin keeps independent
// per-bay control. The laws under test:
//   1. THE STAMP WINS: a booking born under facility mode carries
//      whole_facility=1 on its row; the row, never the live setting, decides
//      its conflicts and automation forever - across mode flips both ways.
//   2. THE TRUNK DECIDES: conflicts live in bookingcore.findConflict, so
//      customer, staff, move, and availability inherit facility semantics
//      identically and can never drift.
//   3. PRICING LAW: facility bookings ride the 'auto' path, so per-bay
//      premium adders NEVER apply; base per-30 is the building's rate, and
//      under members-only the tier flat rate is the building's rate.
//   4. AUTOMATION FAN-OUT: one stamped booking creates durable power jobs
//      for EVERY bay's devices - proven with real automation_jobs rows.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}
const root = __dirname;
const cfgPath = path.join(root, 'config.json');
const PORT = 3074;
const B = 'http://localhost:' + PORT;
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

function writeCfg(over) {
  const o = over || {};
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'The Whole Place', setup: { completed: true, eulaAccepted: true },
    booking: Object.assign({ staffedAccess: false, pricePerHalfHour: 10, wholeFacility: true, windowDays: 14 }, o.booking || {}),
    server: { port: PORT, businessName: 'The Whole Place' },
    waiver: { mode: 'off' },
    bays: o.bays || [
      { id: 'wf-b1', name: 'North Bay', active: true },
      { id: 'wf-b2', name: 'South Bay', active: true, priceAdjustCents: 500 }
    ]
  }));
}
async function settle() { await new Promise(r => setTimeout(r, 500)); }

(async () => {
  // ── A) SOURCE LOCKS ────────────────────────────────────────────────────────
  console.log('\u2500\u2500 A: source locks \u2500\u2500');
  {
    const core = fs.readFileSync('services/bookingcore.js', 'utf8');
    ok('A1 THE TRUNK carries facility semantics with the stamp-wins law stated',
      core.includes('WHOLE-FACILITY SEMANTICS') && core.includes('the stamp on the row wins over the live setting') &&
      core.includes("candidateFacility || r.whole_facility === 1 || r.bay_id === bay_id"));
    const sch = fs.readFileSync('services/scheduler.js', 'utf8');
    ok('A2 scheduler walks EVERY active bay for stamped bookings (one loop, old behavior byte-for-byte otherwise)',
      sch.includes('_autoBays') && sch.includes('booking.whole_facility') &&
      sch.includes('end per-bay device automation'));
    ok('A3 shutdown fans out to every bay PC for facility bookings; guards go any-bay',
      sch.includes('shuts down every bay') && sch.includes('Whole facility (') &&
      /pendingHold = \(booking\.whole_facility/.test(sch));
    ok('A4 door codes require a contact (pilot facility parity, finding #7)',
      sch.includes("(booking.phone || booking.email) && lockConfigured(cfg)) { // no contact, no code"));   // A-wave 4: and no lock, no code
    const bk = fs.readFileSync('routes/bookings.js', 'utf8');
    ok('A5 create route: facility mode forces auto, stamps the row, honest 409 copy',
      bk.includes('if (wholeFacility) bay_id = \'auto\'') &&
      // Match the COLUMN and its bound value, not the closing paren of the
      // column list: rule 14 means columns keep being appended, and a lock
      // anchored on `whole_facility)` breaks on the next additive column
      // rather than on a real regression (it did, in W37).
      /INSERT INTO bookings \([^)]*\bwhole_facility\b/.test(bk) && bk.includes('wholeFacility ? 1 : 0') &&
      bk.includes('The facility is already booked at that time') &&
      // W37: and the copy now distinguishes a CONFIRMED booking from a live
      // checkout, and says the card was not charged either way.
      bk.includes('notCharged: true') && bk.includes('Someone is checking out for that time right now'));
    const ck = fs.readFileSync('services/checkin.js', 'utf8');
    ok('A6 staff bookings stamp too - a staff booking owns the building under facility mode',
      ck.includes('_wf') && ck.includes('whole_facility'));
    const dbSrc = fs.readFileSync('services/db.js', 'utf8');
    ok('A7 additive migration only', dbSrc.includes('ADD COLUMN whole_facility INTEGER DEFAULT 0'));
    const ix = fs.readFileSync('public/index.html', 'utf8');
    ok('A8 booking page: bay choice hides, facility notice shows, time-first flow forced',
      ix.includes('id="facilityNotice"') && ix.includes("BOOKING_FLOW = 'time-first'; // the only flow") &&
      ix.includes('the entire facility is yours for this time'));
    const ad = fs.readFileSync('public/admin.html', 'utf8');
    ok('A9 admin Booking Unit wired both ways with the full plain-English explanation',
      ad.split('cfg_booking_wholeFacility').length >= 5 && ad.includes('$60/hour for the building = enter 30') &&
      ad.includes('function wholeFacilityVis'));
    const wz = fs.readFileSync('public/setup.html', 'utf8');
    ok('A10 wizard asks What Does One Booking Reserve with the full explanation + payload key',
      wz.includes('wizBookingUnit') && wz.includes('One booking, all the automation') &&
      wz.includes("wholeFacility: document.getElementById('wizBookingUnit').value === 'facility'"));
  }

  // ── A12) THE MONITOR'S EYES: session status is stamp-aware ────────────────
  {
    const sv = fs.readFileSync('server.js', 'utf8');
    ok('A12 /api/session/status: a facility booking is visible to EVERY bay\'s monitor',
      sv.includes('(bay_id = ? OR whole_facility = 1)') && sv.includes("reserved screens lift on"));
  }

  // ── A11) STRUCTURAL LOCK: the pre-booking surface belongs to NO flow ──────
  // The bug (Aug 20, maintainer's live test): members-only + facility mode showed no
  // member sign-in, because the member wall/PIN/deposit/facility-notice lived
  // inside stepBay and the time-first flow hides stepBay wholesale. This walks
  // real div depth: those elements must sit OUTSIDE stepBay forever; the bay
  // cards must sit INSIDE it.
  {
    const ix = fs.readFileSync('public/index.html', 'utf8');
    const stepBayPos = ix.indexOf('<div id="stepBay"');
    const inside = (probe) => {
      const pos = ix.indexOf(probe);
      if (pos < stepBayPos) return false;
      let depth = 0;
      for (const m of ix.slice(stepBayPos, pos).matchAll(/<div\b|<\/div>/g)) depth += m[0] === '<div' ? 1 : -1;
      return depth > 0;
    };
    const mustBeOut = ['id="membersOnlyNotice"', 'id="memberPin"', 'id="memberStatus"', 'id="depositInfo"', 'id="facilityNotice"'];
    ok('A11 member surface + facility notice OUTSIDE the flow-hidden container; bay cards inside',
      mustBeOut.every(e => !inside(e)) && inside('id="bayChoiceBlock"'),
      mustBeOut.filter(e => inside(e)));
  }

  // ── B) FIXTURES + AUTOMATION FAN-OUT (in-process, before the server) ──────
  console.log('\u2500\u2500 B: two-bay automation fan-out with real job rows \u2500\u2500');
  writeCfg({ bays: [
    { id: 'wf-b1', name: 'North Bay', active: true,
      shellyDevices: [{ ip: '10.255.0.11', name: 'North PC plug', gen: 2, minutesBefore: 10, turnOffAfter: true, minutesAfter: 30 }] },
    { id: 'wf-b2', name: 'South Bay', active: true, priceAdjustCents: 500,
      shellyDevices: [{ ip: '10.255.0.12', name: 'South PC plug', gen: 2, minutesBefore: 10, turnOffAfter: true, minutesAfter: 30 }] }
  ]});
  const dbM = require('./services/db');
  await dbM.initDb();
  require('./services/pos').ensureSchema();
  const checksSvc = require('./services/checks');
  checksSvc.ensureSchema(); checksSvc.ensureShareColumn && checksSvc.ensureShareColumn();
  const D = dbM.db;
  for (const b of D.prepare(`SELECT id FROM bookings WHERE phone LIKE '557%'`).all()) {
    D.prepare(`DELETE FROM automation_jobs WHERE booking_id=?`).run(b.id);
    D.prepare(`DELETE FROM seats WHERE booking_id=?`).run(b.id);
  }
  D.prepare(`DELETE FROM bookings WHERE phone LIKE '557%'`).run();

  // A facility booking starting INSIDE the power-on lead window right now:
  // one tick must mint power_on jobs for BOTH bays' plugs.
  const now = new Date();
  const soon = new Date(now.getTime() + 5 * 60000);
  const stStr = pad2(soon.getHours()) + ':' + pad2(soon.getMinutes());
  const endD = new Date(soon.getTime() + 60 * 60000);
  const enStr = pad2(endD.getHours()) + ':' + pad2(endD.getMinutes());
  const wfId = 'wf-auto-' + Date.now();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date, duration_minutes, price_cents, status, sms_consent, is_deposit, whole_facility)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',0,0,1)`)
    .run(wfId, 'wf-b1', 'The Whole Place', 'WF Party', '5570001', 'wf@example.com',
         ymd(soon), stStr, enStr, ymd(endD), 60, 2000);
  dbM.saveDb && dbM.saveDb();
  const scheduler = require('./services/scheduler');
  try { await scheduler.checkBookings(); } catch (e) { console.log('tick error:', e.message); }
  const jobs = D.prepare(`SELECT kind, device_key FROM automation_jobs WHERE booking_id=?`).all(wfId);
  const keys = jobs.filter(j => j.kind === 'power_on').map(j => j.device_key).sort();
  ok('B1 ONE facility booking minted power_on jobs for BOTH bays\' plugs',
    keys.includes('10.255.0.11') && keys.includes('10.255.0.12'), jobs);
  ok('B2 and power_off jobs queued for both bays too (full end sequence)',
    jobs.filter(j => j.kind === 'power_off').map(j => j.device_key).sort().join(',') === '10.255.0.11,10.255.0.12', jobs);

  // staff booking under facility mode: stamped, owns the building
  const ckSvc = require('./services/checkin');
  const st2 = new Date(now.getTime() + 2 * 86400000);
  const r1 = ckSvc.staffCreateBooking({ bay_id: 'wf-b1', date: ymd(st2), start_time: '10:00',
    duration_minutes: 60, name: 'WF Staff', phone: '5570002', email: '', sms_consent: false, employee: 'Owner' });
  const staffRow = r1.status === 200 ? D.prepare(`SELECT whole_facility, bay_name FROM bookings WHERE id=?`).get(r1.body.booking.id) : null;
  ok('B3 staff booking stamped whole_facility with the facility name on the row',
    !!staffRow && staffRow.whole_facility === 1 && staffRow.bay_name === 'The Whole Place', staffRow);
  const clash = require('./services/bookingcore').findConflict({ bay_id: 'wf-b2', date: ymd(st2), start_time: '10:30', duration_minutes: 30, wholeFacility: false });
  ok('B4 THE TRUNK: that staff booking blocks the OTHER bay too', !!clash, clash);
  dbM.saveDb && dbM.saveDb();

  // ── C) LIVE SERVER: the trunk over HTTP, both flip directions ─────────────
  console.log('\u2500\u2500 C: facility conflicts over HTTP, mode flips both ways \u2500\u2500');
  writeCfg({ bays: [
    { id: 'wf-b1', name: 'North Bay', active: true },
    { id: 'wf-b2', name: 'South Bay', active: true, priceAdjustCents: 500 }
  ]});
  const child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', d => bootLog += d);
  child.stderr.on('data', d => bootLog += d);
  let up = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {}
  }
  ok('C0 server up', up);
  const dA = ymd(new Date(now.getTime() + 4 * 86400000));
  let facilityId = null, capId = null;
  if (up) {
    const post = (u, body) => fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
    const getj = u => fetch(B + u).then(r => r.json());
    const bk = over => Object.assign({ name: 'WF Web', phone: '5573333', email: 'w@example.com',
      date: dA, start_time: '10:00', duration_minutes: 60, sms_consent: false, bay_id: 'wf-b1' }, over || {});

    const rules = await getj('/api/booking-rules');
    ok('C1 booking-rules serves wholeFacility (and smsAvailable false with no provider)',
      rules.wholeFacility === true && rules.smsAvailable === false, rules);
    let r = await post('/api/bookings/create-payment-intent', bk({ bay_id: undefined }));
    ok('C2 a booking with NO bay choice books the building', r.s === 200 && r.d.bookingId, r);
    facilityId = r.d.bookingId;
    r = await post('/api/bookings/create-payment-intent', bk({ bay_id: 'wf-b2', start_time: '10:30', phone: '5574444' }));
    ok('C3 an overlapping attempt is refused with facility copy - even naming the other bay',
      r.s === 409 && /facility is already booked/i.test(r.d.error || ''), r);
    r = await post('/api/bookings/create-payment-intent', bk({ start_time: '13:00', phone: '5575555' }));
    ok('C4 a different time books fine', r.s === 200 && r.d.bookingId, r);
    capId = r.d.bookingId;

    // FLIP OFF: the stamped rows keep their meaning
    writeCfg({ booking: { wholeFacility: false }, bays: [
      { id: 'wf-b1', name: 'North Bay', active: true },
      { id: 'wf-b2', name: 'South Bay', active: true, priceAdjustCents: 500 }
    ]}); await settle();
    r = await post('/api/bookings/create-payment-intent', bk({ bay_id: 'wf-b2', start_time: '10:00', phone: '5576666' }));
    ok('C5 FLIPPED TO PER-BAY: the old facility booking STILL blocks the other bay (the stamp wins)',
      r.s === 409, r);
    r = await post('/api/bookings/create-payment-intent', bk({ bay_id: 'wf-b2', start_time: '16:00', phone: '5577777' }));
    ok('C6 per-bay mode: an untouched slot on bay 2 books normally', r.s === 200 && r.d.bookingId, r);

    // FLIP BACK ON: the per-bay row blocks the whole facility at its time
    writeCfg(); await settle();
    r = await post('/api/bookings/create-payment-intent', bk({ bay_id: undefined, start_time: '16:00', phone: '5578888' }));
    ok('C7 FLIPPED BACK: a facility candidate over the per-bay row is refused (any bay blocks the building)',
      r.s === 409, r);

    try {
      const cwd = fs.readlinkSync('/proc/' + child.pid + '/cwd');
      if (cwd.startsWith(root)) child.kill('SIGINT');
    } catch { child.kill('SIGINT'); }
    await new Promise(r => setTimeout(r, 2500));

    // PRICING LAW: the facility booking priced at base per-30 - the South Bay
    // +500c/half-hour premium adder NEVER touched it ('auto' pricing law).
    let priced = null;
    try {
      const outp = execFileSync('node', ['-e', `
        const dbM = require('${root.replace(/\\/g, '/')}/services/db');
        dbM.initDb().then(() => {
          const g = id => dbM.db.prepare('SELECT price_cents, whole_facility, bay_name FROM bookings WHERE id=?').get(id);
          console.log(JSON.stringify({ f: g('${facilityId}'), c: g('${capId}') }));
          process.exit(0);
        });`], { encoding: 'utf8', timeout: 30000 });
      priced = JSON.parse(outp.split('\n').find(l => l.trim().startsWith('{')));
    } catch (e) { priced = { err: e.message }; }
    ok('C8 PRICING LAW: facility bookings price at the base building rate (2000c), never a bay premium',
      priced && priced.f && priced.f.price_cents === 2000 && priced.c && priced.c.price_cents === 2000, priced);
    ok('C9 the rows are stamped and named for the whole building',
      priced && priced.f && priced.f.whole_facility === 1 && priced.f.bay_name === 'The Whole Place', priced);
  } else {
    for (const n of ['C1','C2','C3','C4','C5','C6','C7','C8','C9']) ok(n + ' (server never came up)', false);
    try { child.kill('SIGKILL'); } catch {}
  }

  // ── D) COMPOSITION: members-only x whole-facility, live over HTTP ─────────
  // maintainer's rule: every decision must work with every other decision. The
  // franchise archetype IS this combination - $100/month member, flat rate
  // rents the whole building, no bay choice, member wall enforced.
  console.log('\u2500\u2500 D: members-only + whole-facility together \u2500\u2500');
  {
    const D2 = dbM.db;
    await dbM.reload();   // W40: the server wrote the file since we loaded it - a stale copy cannot write
    D2.prepare(`DELETE FROM members WHERE id='wf-m1'`).run();
    D2.prepare(`DELETE FROM membership_tiers WHERE id='wf-tier'`).run();
    // The franchise archetype exactly: $100/month, flat rate $15/30 = $30/hour
    // rents the ENTIRE building. Fixture mirrors the proven members-only shape.
    D2.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,guest_allowed,guest_max_per_visit,guest_passes_per_month,guest_pricing_type,guest_pricing_value,sell_online,price_monthly,roster_cap,codes_included)
               VALUES ('wf-tier','Facility Club','flat_rate',15,1,1,0,0,'free',0,1,10000,75,1)`).run();
    D2.prepare(`INSERT INTO members (id,tier_id,name,phone,email,pin,status,last_activated_at)
               VALUES ('wf-m1','wf-tier','Franchise Member','5579999','fm@example.com','919111','active',datetime('now'))`).run();
    dbM.saveDb && dbM.saveDb();
    fs.writeFileSync(cfgPath, JSON.stringify({
      businessName: 'The Whole Place', setup: { completed: true, eulaAccepted: true },
      booking: { staffedAccess: false, pricePerHalfHour: 10, wholeFacility: true, membersOnly: true, windowDays: 14 },
      server: { port: PORT, businessName: 'The Whole Place' },
      waiver: { mode: 'off' },
      bays: [ { id: 'wf-b1', name: 'North Bay', active: true }, { id: 'wf-b2', name: 'South Bay', active: true, priceAdjustCents: 500 } ]
    }));
    const child2 = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let boot2 = ''; child2.stdout.on('data', d => boot2 += d); child2.stderr.on('data', d => boot2 += d);
    let up2 = false;
    for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 500));
      try { const r = await fetch(B + '/api/time'); if (r.ok) { up2 = true; break; } } catch {} }
    if (up2) {
      const post = (u, body) => fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
      const rules = await fetch(B + '/api/booking-rules').then(r => r.json());
      ok('D1 both flags served together', rules.membersOnly === true && rules.wholeFacility === true, rules);
      const dD = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (6), 12));
      let r = await post('/api/bookings/create-payment-intent', { name: 'No Member', phone: '5581111', email: 'x@example.com',
        date: dD, start_time: '10:00', duration_minutes: 60, sms_consent: false });
      ok('D2 the member wall holds under facility mode - no code, no booking',
        r.s === 400 && r.d.members_only === true, r);
      r = await post('/api/bookings/create-payment-intent', { name: 'Franchise Member', phone: '5579999', email: 'fm@example.com',
        date: dD, start_time: '10:00', duration_minutes: 60, sms_consent: false, member_pin: '919111' });
      ok('D3 a member books the building with no bay choice', r.s === 200 && r.d.bookingId, r);
      const wfD3 = r.d.bookingId || null;
      r = await post('/api/bookings/create-payment-intent', { name: 'Franchise Member', phone: '5579999', email: 'fm@example.com',
        date: dD, start_time: '10:30', duration_minutes: 30, sms_consent: false, member_pin: '919111', bay_id: 'wf-b2' });
      ok('D4 even a member cannot double-book the building', r.s === 409, r);
      try { const cwd = fs.readlinkSync('/proc/' + child2.pid + '/cwd'); if (cwd.startsWith(root)) child2.kill('SIGINT'); } catch { child2.kill('SIGINT'); }
      await new Promise(r2 => setTimeout(r2, 2500));
      let row = null;
      try {
        const outp = execFileSync('node', ['-e', `
          const dbM = require('${root.replace(/\\/g, '/')}/services/db');
          dbM.initDb().then(() => { console.log(JSON.stringify(dbM.db.prepare('SELECT price_cents, whole_facility, member_id FROM bookings WHERE id=?').get('${wfD3}'))); process.exit(0); });`],
          { encoding: 'utf8', timeout: 30000 });
        row = JSON.parse(outp.split('\n').find(l => l.trim().startsWith('{')));
      } catch (e) { row = { err: e.message }; }
      ok('D5 THE COMPOSED RATE: member flat rate IS the building rate (3000c for the hour, never the adder)',
        row && row.price_cents === 3000 && row.whole_facility === 1 && row.member_id === 'wf-m1', row);
      bootLog += boot2;
    } else {
      for (const n of ['D1','D2','D3','D4','D5']) ok(n + ' (composed server never came up)', false);
      try { child2.kill('SIGKILL'); } catch {}
    }
  }

  const errLines = bootLog.split('\n').filter(l => /TypeError|ReferenceError|SyntaxError|Unhandled|Cannot find module/.test(l));
  ok('C10 zero runtime error signatures', errLines.length === 0, errLines.slice(0, 3));

  await new Promise(r => setTimeout(r, 300));
  for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) {
    try { fs.unlinkSync(path.join(root, f)); } catch {}
  }
  // ── E) THE GRID TELLS THE TRUTH ────────────────────────────────────────────
  // maintainer, Sep 19 2026: "a customer must never reach checkout on a slot the server
  // will refuse." The page used to fold the raw booking list itself
  // (`active.every(bay => bay is busy)`), a SECOND implementation of what
  // findConflict answers at create - and it drifted: with one bay blocked it
  // offered 10:00, the customer picked a duration, reached checkout and met a
  // 409 there. This is the third surface this week to compute its own answer
  // (the three prices, the Stripe badge, this), so the shape of the fix is the
  // shape of the rule: the SERVER answers, the page renders.
  // This walks the REAL grid and the REAL create route over the same windows
  // and fails if they ever disagree - which is what catches the next drift,
  // whichever surface causes it.
  console.log('\u2500\u2500 E: the grid and the create route agree, slot by slot \u2500\u2500');
  {
    writeCfg(); await settle();
    { const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); c.server.adminPassword = 'battery-owner-pass-1'; fs.writeFileSync(cfgPath, JSON.stringify(c)); }
    const child3 = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let boot3 = ''; child3.stdout.on('data', d => boot3 += d); child3.stderr.on('data', d => boot3 += d);
    let up = false;
    for (let i = 0; i < 60; i++) { try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {} await new Promise(r => setTimeout(r, 300)); }
    if (!up) { for (const n of ['E1','E2','E3','E4']) ok(n + ' (server never came up)', false, boot3.slice(-200)); }
    else {
      const H = { 'Content-Type': 'application/json', 'x-admin-password': 'battery-owner-pass-1' };
      const dE = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (5), 12));
      const mkBlock = body => fetch(B + '/api/admin/blocks', { method: 'POST', headers: H, body: JSON.stringify(Object.assign({ date: dE, end_date: dE }, body)) }).then(r => r.json());
      // one bay out for the morning, the BUILDING closed in the afternoon
      const r1 = await mkBlock({ bay_id: 'wf-b1', type: 'maintenance', start_time: '09:00', end_time: '10:30', label: 'Projector swap' });
      const r2 = await mkBlock({ bay_id: 'facility', type: 'event', start_time: '16:00', end_time: '18:00', label: 'Hoffman wedding' });
      ok('E1 the owner can take ONE bay out, and separately CLOSE THE BUILDING for a window', !!r1.ok && !!r2.ok, { r1, r2 });
      const grid = await fetch(B + '/api/bookings/availability?date=' + dE).then(r => r.json());
      ok('E2 the server answers availability per slot - the page is given the answer, not the raw rows',
         grid && grid.slotFree && typeof grid.slotFree['09:00'] === 'boolean', Object.keys(grid || {}));
      // walk every slot the facility is open and compare the grid to what create would do
      const disagreements = [];
      for (const t of ['09:00', '09:30', '10:00', '11:00', '13:00', '15:30', '16:00', '17:00', '17:30', '18:00', '19:00']) {
        const offered = grid.slotFree[t] === true;
        // the owner's own header: the booking limiter skips a verified owner by
        // design (server.js bookingLimiter `skip`), which is what lets a walk of
        // the whole day happen at all - ten attempts an hour is the customer rule
        const res = await fetch(B + '/api/bookings/create-payment-intent', {
          method: 'POST', headers: H,
          body: JSON.stringify({ name: 'Grid Walk', phone: '55590' + t.replace(':', ''), email: 'g@example.com',
            date: dE, start_time: t, duration_minutes: 30, sms_consent: false })
        });
        const body = await res.json().catch(() => ({}));
        const allowed = res.status === 200 && !!body.bookingId;
        if (offered !== allowed) disagreements.push({ t, offered, allowed, error: body.error });
        // put the slot back so the walk does not fill the day behind itself
        if (allowed) { try { await fetch(B + '/api/bookings/cancel/' + body.bookingId, { method: 'POST', headers: H, body: '{}' }); } catch {} }
      }
      ok('E3 THE GRID TELLS THE TRUTH: every slot the grid offers, create accepts - and every slot it hides, create refuses',
         disagreements.length === 0, disagreements);
      // and the two rulings, read off the same grid
      ok('E4 one bay out leaves the morning ON SALE; the building being closed takes the afternoon OFF sale',
         grid.slotFree['09:00'] === true && grid.slotFree['16:00'] === false && grid.slotFree['17:30'] === false
         && grid.slotFree['19:00'] === true,
         { '09:00': grid.slotFree['09:00'], '16:00': grid.slotFree['16:00'], '17:30': grid.slotFree['17:30'], '19:00': grid.slotFree['19:00'] });
      // the customer is told WHY, and the owner gets a line for it
      const refused = await fetch(B + '/api/bookings/create-payment-intent', {
        method: 'POST', headers: H,
        body: JSON.stringify({ name: 'Late', phone: '5559999', email: 'l@example.com', date: dE, start_time: '16:30', duration_minutes: 30, sms_consent: false })
      }).then(r => r.json()).catch(() => ({}));
      ok('E5 a refusal names its real cause and the owner\'s own label, not "pick a different time"',
         /closed/i.test(refused.error || '') && /Hoffman wedding/.test(refused.error || ''), refused.error);
    }
    try { child3.kill('SIGINT'); } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }

  // ── F) "ALL DAY" MEANS EVERY DAY IT NAMES (Oct 20 2026) ───────────────────────
  // A facility that closes after midnight stored an all-day block whose window ended before it started - it blocked
  // nothing - and an all-day block over several days blocked only its first day (its end date was thrown away).
  console.log('\u2500\u2500 F: an all-day block covers every day it names, a close after midnight included \u2500\u2500');
  {
    writeCfg({ booking: { openTime: '10:00', closeTime: '02:00', closeNextDay: true } }); await settle();
    { const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); c.server.adminPassword = 'battery-owner-pass-1'; fs.writeFileSync(cfgPath, JSON.stringify(c)); }
    const child4 = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let boot4 = ''; child4.stdout.on('data', d => boot4 += d); child4.stderr.on('data', d => boot4 += d);
    let up = false;
    for (let i = 0; i < 60; i++) { try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {} await new Promise(r => setTimeout(r, 300)); }
    if (!up) { for (const n of ['F1', 'F2', 'F3']) ok(n + ' (server never came up)', false, boot4.slice(-200)); }
    else {
      const H = { 'Content-Type': 'application/json', 'x-admin-password': 'battery-owner-pass-1' };
      const day = n => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (n), 12));
      const mk = body => fetch(B + '/api/admin/blocks', { method: 'POST', headers: H, body: JSON.stringify(body) }).then(r => r.json());
      const free = async (d, t) => ((await fetch(B + '/api/bookings/availability?date=' + d).then(r => r.json())).slotFree || {})[t];
      const before = await free(day(7), '23:00');
      const late = await mk({ bay_id: 'facility', type: 'event', label: 'Late party', date: day(7), end_date: day(7), all_day: true });
      const after = { '10:00': await free(day(7), '10:00'), '23:00': await free(day(7), '23:00') };
      ok('F1 an all-day block at a facility that closes after midnight takes the whole day off sale, the late evening too (it blocked nothing)',
         !!late.ok && before === true && after['10:00'] === false && after['23:00'] === false, { late, before, after });
      const long = await mk({ bay_id: 'facility', type: 'maintenance', label: 'Renovation', date: day(9), end_date: day(11), all_day: true });
      const days = { first: await free(day(9), '12:00'), third: await free(day(11), '12:00'), dayAfter: await free(day(12), '12:00') };
      ok('F2 an all-day block over three days takes all three off sale and leaves the day after on sale (it blocked only the first)',
         !!long.ok && days.first === false && days.third === false && days.dayAfter === true, { long, days });
      // and any block over three days or more, all day or not: the trunk read only rows starting or ending on the day asked,
      // so the middle days stayed on sale - and could be booked (the refusal must name the block, never just any error)
      const timed = await mk({ bay_id: 'facility', type: 'tournament', label: 'Three-day open', date: day(2), end_date: day(4), start_time: '09:00', end_time: '20:00' });
      const mid = await free(day(3), '12:00');
      const tryBook = await fetch(B + '/api/bookings/create-payment-intent', { method: 'POST', headers: H,
        body: JSON.stringify({ name: 'Mid Block', phone: '5558003', email: 'mid@example.com', date: day(3), start_time: '12:00', duration_minutes: 30, sms_consent: false }) })
        .then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
      ok('F3 a block over three days holds its middle day: off sale on the grid, and a booking there is refused naming the block',
         !!timed.ok && mid === false && tryBook.s !== 200 && /Three-day open/.test((tryBook.d && tryBook.d.error) || ''), { timed, mid, tryBook });
    }
    try { child4.kill('SIGINT'); } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\nWHOLE FACILITY: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
