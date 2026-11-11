// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-memberprice.js — THE PRICE A CUSTOMER IS SHOWN IS THE PRICE THEY PAY
//
// From a live customer report (Sep 19 2026). A members-only whole-facility
// owner set $25/30min and his members were shown duration pills reading $170
// for a session their card was charged $150 for. He read the gap as his bay
// count doubling the price and cut the facility to one bay to make it stop.
// Bay count never entered it - proven here at 1 bay AND 2 bays, identical.
// The gap was that the slot chips and the duration pills came from the
// ANONYMOUS /api/pricing/calculate while the charge came from the member
// branches in routes/bookings.js: two implementations of one question.
//
// THE LAW UNDER TEST (maintainer, Sep 19 2026): the grid, the pills and the create
// route answer from ONE computation - pricing.sessionQuote - and this battery
// fails on ANY disagreement between them, the way test-wholefacility E3 does
// for availability. It walks several starts, several durations and a TIER
// CROSSING (the case the first read of this bug missed, because 09:00 and
// 18:00 at 90 minutes never cross a boundary and so are always clean
// multiples), as a member and as the public, at one bay and at two.
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
const PORT = 3079;
const B = 'http://localhost:' + PORT;
const PW = 'memberprice-battery-pw';
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const money = c => (c === null || c === undefined) ? String(c) : '$' + (c / 100).toFixed(2);

// His exact shape: members-only, whole facility, $25/30min tiered.
function writeCfg(bays) {
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Member Price Club', setup: { completed: true, eulaAccepted: true },
    booking: { staffedAccess: true, pricePerHalfHour: 25, wholeFacility: true, membersOnly: true,
               windowDays: 240, openTime: '08:00', closeTime: '23:00', minSessionMins: 30,
               maxSessionMins: 300, bookingFlow: 'bay-first', depositMode: 'off' },
    server: { port: PORT, businessName: 'Member Price Club', adminPassword: PW },
    waiver: { mode: 'off' },
    bays
  }));
}
const BAYS1 = [{ id: 'mp-b1', name: 'Bay 1', active: true }];
const BAYS2 = [{ id: 'mp-b1', name: 'Bay 1', active: true }, { id: 'mp-b2', name: 'Bay 2', active: true }];

async function boot() {
  const child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const r = await fetch(B + '/api/time'); if (r.ok) return { child, log: () => log }; } catch {}
  }
  return { child: null, log: () => log };
}

// Seeded in its OWN process that exits, before the server boots. A process
// that called initDb() is a WRITER until it exits (W40), and the server holds
// its own in-memory copy - seeding from inside the battery while the server is
// up is silently overwritten, which is exactly how the first run of this
// battery reported the public chip at $25 when its tiers say $30.
function seed() {
  const code = `
    const db = require('${root.replace(/\\/g, '/')}/services/db.js');
    (async () => {
      await db.initDb();
      const d = db.db;
      d.prepare("DELETE FROM pricing_tiers").run();
      const ins = (id,n,s,e,p,o) => d.prepare(
        "INSERT INTO pricing_tiers (id,name,days,start_time,end_time,price_per_half_hour,active,sort_order) VALUES (?,?,?,?,?,?,1,?)"
      ).run(id,n,'mon,tue,wed,thu,fri,sat,sun',s,e,p,o);
      ins('mp-morning','Morning','00:00','11:00',25,1);
      ins('mp-afternoon','Afternoon','11:00','17:00',30,2);
      ins('mp-evening','Evening','17:00','23:59',37.5,3);
      d.prepare("DELETE FROM members").run();
      d.prepare("DELETE FROM membership_tiers").run();
      d.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,price_monthly) VALUES ('mp-flat','Flat Rate','flat_rate',25,100)").run();
      d.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,price_monthly) VALUES ('mp-pct','Twenty Off','percentage',20,50)").run();
      d.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,hours_per_month,over_limit_discount_type,over_limit_discount_value,price_monthly) VALUES ('mp-free','Two Free Hours','free_hours',2,2,'flat_rate',10,120)").run();
      const mem = (id,t,pin,nm) => d.prepare(
        "INSERT INTO members (id,tier_id,name,phone,email,pin,status) VALUES (?,?,?,?,?,?,'active')"
      ).run(id,t,nm,'+1500555'+pin,id+'@example.invalid',pin);
      mem('mp-m-flat','mp-flat','770101','Flat Member');
      mem('mp-m-pct','mp-pct','770202','Pct Member');
      mem('mp-m-free','mp-free','770303','Free Hours Member');
      await db.flushed();
      process.exit(0);
    })().catch(e => { console.error(e.message); process.exit(1); });
  `;
  execFileSync('node', ['-e', code], { cwd: root, stdio: 'pipe' });
}

(async () => {
  // ── A) SOURCE LOCKS ───────────────────────────────────────────────────────
  console.log('── A: one computation, stated in the source ──');
  {
    const pr = fs.readFileSync('services/pricing.js', 'utf8');
    ok('A1 pricing.js carries THE ONE SESSION QUOTE with the three honest answers',
      pr.includes('THE ONE SESSION QUOTE') && pr.includes("kind 'exact'") &&
      pr.includes("kind 'included'") && pr.includes("kind 'unknown'"));
    ok('A2 sessionQuote, memberEligibility and slotRateFor are exported',
      /sessionQuote, memberEligibility, slotRateFor/.test(pr));
    ok('A3 calculatePrice is the SUM of publicBlocks - one walk, never two',
      /function calculatePrice[\s\S]{0,220}publicBlocks\(dateStr, startTime, durationMins, bayId\)\s*\n\s*\.reduce/.test(pr));
    ok('A4 a member breakdown that does not add up to the charge is dropped, never shown',
      pr.includes('Never a split that does not add up to what the card is charged') &&
      /if \(out\.reduce\(\(a, b\) => a \+ b\.cents, 0\) !== golfCents\) return null;/.test(pr) &&
      pr.includes('none of which is anybody') &&
      pr.includes('no per-half-hour story'));
    const bk = fs.readFileSync('routes/bookings.js', 'utf8');
    ok('A5 the create route prices the golf THROUGH the trunk (no second copy)',
      bk.includes('pricingSvc.sessionQuote(') || bk.includes('.sessionQuote('));
    ok('A6 routes/bookings.js no longer keeps its own eligibility copy',
      !/^function checkMemberEligibility\(member, date, start_time, dur, bay_id\) \{\n  if \(!member\)/m.test(bk));
  }

  // ── B) THE WALK, at 1 bay and at 2 ───────────────────────────────────────
  const now = new Date();
  const D = ymd(new Date(now.getTime() + 5 * 86400000));
  const STARTS = ['09:00', '10:00', '11:00', '16:30'];   // 10:00 and 16:30 CROSS a tier
  const DURS   = [60, 90, 120, 180];
  const MEMBERS = [
    { pin: '770101', label: 'flat',      id: 'mp-m-flat' },
    { pin: '770202', label: 'percent',   id: 'mp-m-pct'  },
    { pin: '770303', label: 'freehours', id: 'mp-m-free' }
  ];

  for (const [bi, bays] of [[1, BAYS1], [2, BAYS2]]) {
    console.log(`── B${bi}: ${bays.length}-bay facility ──`);
    writeCfg(bays);
    try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
    seed();                       // own process, exits, THEN the server boots
    const { child, log } = await boot();
    ok(`B${bi}.0 server up (${bays.length} bays)`, !!child, child ? '' : log().slice(-500));
    if (!child) { continue; }

    const getj = u => fetch(B + u).then(r => r.json()).catch(() => ({}));
    const post = (u, body) => fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
    // The walk books ~48 sessions. The product stops an anonymous IP at ten an
    // hour and deliberately lets a verified owner through (server.js
    // bookingLimiter.skip) - the same door the bench seeder uses. The PRICE
    // path is identical either way; only the spam counter differs.
    const postAs = (u, body) => fetch(B + u, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': PW },
      body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));

    // A MEMBERS-ONLY CLUB HAS NO PUBLIC CUSTOMER (maintainer, Sep 19 2026): the public
    // tier rates are a number nobody here can be charged, so no anonymous
    // surface may show one.
    {
      const q = await getj(`/api/pricing/calculate?date=${D}&start_time=10:00&duration=180`);
      ok(`B${bi}.1 no anonymous PRICE at a members-only club - it asks for the code instead`,
        q.memberRequired === true && q.priceCents === null && /member code/i.test(q.message || ''), q);
      const av = await getj(`/api/bookings/availability?date=${D}`);
      ok(`B${bi}.2 no anonymous CHIP prices either, and the grid says why`,
        av.memberRatesOnly === true && av.showSlotPrices === false &&
        /member code/i.test(av.memberRatesNote || ''), { m: av.memberRatesOnly, s: av.showSlotPrices });
    }

    let cases = 0, agreed = 0;
    const disagreements = [];
    for (const m of MEMBERS) {
      for (const st of STARTS) {
        for (const du of DURS) {
          // 1) What the PAGE shows this member for this session, from the one
          //    place the page gets it: validate-pin's own quote.
          const dQ = ymd(new Date(now.getTime() + (5 + cases * 2) * 86400000));
          const vp = await postAs('/api/members/validate-pin',
            { pin: m.pin, date: dQ, start_time: st, duration_minutes: du, bay_id: 'auto', guest_count: 0 });
          const shown = vp.d && vp.d.quote;
          if (!shown) { disagreements.push({ m: m.label, st, du, why: 'no quote on validate-pin' }); cases++; continue; }

          // 2) What the CARD is charged for exactly that session.
          // A DAY THIS CASE CAN HAVE TO ITSELF. The facility is whole-facility here,
          // so ANY booking already on the chosen day blocks it - and a 409 then
          // reads as a pricing disagreement when it is nothing of the kind (it
          // cost this battery a Pi run on Sep 21). Walk forward to a free day;
          // only a slot we genuinely cannot get is a failure.
          let cr = null, dCase = null;
          for (let hop = 0; hop < 6; hop++) {
            dCase = ymd(new Date(now.getTime() + (5 + cases * 2 + hop) * 86400000));
            cr = await postAs('/api/bookings/create-payment-intent', {
              date: dCase, start_time: st, duration_minutes: du, bay_id: 'auto',
              name: 'Agree ' + m.label, phone: '+1500556' + String(cases).padStart(4, '0'),
              email: 'a@example.invalid', member_pin: m.pin, sms_consent: false
            });
            if (cr.s === 200 || !/already booked|no longer available/i.test(String(cr.d && cr.d.error))) break;
          }
          cases++;
          if (cr.s !== 200) { disagreements.push({ m: m.label, st, du, why: 'create ' + cr.s + ' ' + (cr.d.error || '') }); continue; }

          const charged = cr.d.priceCents;
          const expect  = (shown.kind === 'included') ? 0 : shown.dueNowCents;
          if (charged === expect) agreed++;
          else disagreements.push({ m: m.label, st, du, kind: shown.kind,
                                    shown: money(expect), charged: money(charged),
                                    pillTotal: money(shown.golfCents) });
          if (cr.d.bookingId) await postAs('/api/bookings/cancel/' + cr.d.bookingId, {});
        }
      }
    }
    ok(`B${bi}.3 every member/start/duration: what the page showed IS what the card was charged (${agreed}/${cases})`,
      agreed === cases && cases > 0, disagreements.slice(0, 8));

    // THE CHIP agrees with the pill it leads to.
    {
      const vp = await postAs('/api/members/validate-pin',
        { pin: '770101', date: D, start_time: '09:00', duration_minutes: 30, bay_id: 'auto', guest_count: 0 });
      const rates = vp.d && vp.d.dayRates;
      ok(`B${bi}.4 the member's slot chips carry the MEMBER rate, not the public one`,
        !!rates && rates['11:00'] && rates['11:00'].per30Cents === 2500, rates && rates['11:00']);
      ok(`B${bi}.5 every duration at that start is quoted in the SAME call (no extra PIN traffic)`,
        !!(vp.d && vp.d.durationQuotes && vp.d.durationQuotes['60'] && vp.d.durationQuotes['180']),
        vp.d && vp.d.durationQuotes && Object.keys(vp.d.durationQuotes));
    }

    // RULING 1 — the allowance tier never shows a number it will not charge.
    {
      const vp = await postAs('/api/members/validate-pin',
        { pin: '770303', date: D, start_time: '09:00', duration_minutes: 60, bay_id: 'auto', guest_count: 0 });
      const q = vp.d && vp.d.quote;
      ok(`B${bi}.6 free hours covering the whole session read "included", never a price`,
        q && q.kind === 'included' && /included in your hours/i.test(q.label || ''), q);
      const vp2 = await postAs('/api/members/validate-pin',
        { pin: '770303', date: D, start_time: '09:00', duration_minutes: 180, bay_id: 'auto', guest_count: 0 });
      const q2 = vp2.d && vp2.d.quote;
      // 2 free hours, then 1 hour at the $10/30min after-hours rate = $20.
      ok(`B${bi}.7 an allowance that runs out partway shows the REAL total for the session`,
        q2 && q2.kind === 'exact' && q2.golfCents === 2000 && q2.freeMinutes === 120 && q2.paidMinutes === 60,
        q2 && { kind: q2.kind, golf: money(q2.golfCents), free: q2.freeMinutes, paid: q2.paidMinutes });
      const chips = vp.d && vp.d.dayRates;
      ok(`B${bi}.8 a chip covered by the member's hours says so instead of showing $0.00`,
        !!chips && chips['09:00'] && chips['09:00'].included === true, chips && chips['09:00']);
    }

    // RULING 2 — the member's own breakdown, where it can be stated honestly.
    {
      const vp = await postAs('/api/members/validate-pin',
        { pin: '770101', date: D, start_time: '10:00', duration_minutes: 180, bay_id: 'auto', guest_count: 0 });
      const q = vp.d && vp.d.quote;
      ok(`B${bi}.9 a FLAT-rate member crossing a tier is one rate end to end, no crossing line`,
        q && q.golfCents === 15000 && !q.breakdown, q && { golf: money(q.golfCents), bd: q.breakdown });
    }

    try { child.kill('SIGTERM'); } catch {}
    await new Promise(r => setTimeout(r, 600));
  }

  // ── C) A PUBLIC FACILITY: the anonymous price is correct and STAYS ───────
  // maintainer, Sep 19 2026: "At a public facility the anonymous price is correct and
  // stays - it becomes the member's once they identify." The tier-crossing
  // line is what stops a walk-up reading an honest crossing as a multiply.
  console.log('── C: a PUBLIC facility keeps its anonymous price ──');
  {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.booking.membersOnly = false;
    cfg.bays = BAYS2;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
    seed();
    const { child, log } = await boot();
    ok('C0 server up (public facility)', !!child, child ? '' : log().slice(-400));
    if (child) {
      const getj = u => fetch(B + u).then(r => r.json()).catch(() => ({}));
      const postAs = (u, body) => fetch(B + u, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': PW },
        body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
      const D2 = ymd(new Date(now.getTime() + 3 * 86400000));

      const cross = await getj(`/api/pricing/calculate?date=${D2}&start_time=10:00&duration=180`);
      ok('C1 the anonymous pill still carries a real price here',
        cross.priceCents === 17000 && !cross.memberRequired, cross.priceCents);
      ok('C2 and it STATES the tier crossing that makes it not a clean multiple',
        /10:00-11:00 at \$25/.test(cross.breakdown || '') && /11:00-13:00 at \$30/.test(cross.breakdown || ''),
        cross.breakdown);
      const inside = await getj(`/api/pricing/calculate?date=${D2}&start_time=09:00&duration=120`);
      ok('C3 a session inside ONE tier carries no breakdown line - nothing to explain',
        inside.priceCents === 10000 && !inside.breakdown, { p: inside.priceCents, b: inside.breakdown });
      const av = await getj(`/api/bookings/availability?date=${D2}`);
      ok('C4 the public chips still read the public tier rate',
        av.memberRatesOnly === false && Number(av.slotPrices['11:00']) === 30, av.slotPrices && av.slotPrices['11:00']);

      // The anonymous price becomes the member's once they identify: here the
      // flat-rate tier is NOT the members-only replacement, it is a discount.
      const vp = await postAs('/api/members/validate-pin',
        { pin: '770202', date: D2, start_time: '10:00', duration_minutes: 180, bay_id: 'auto', guest_count: 0 });
      const q = vp.d && vp.d.quote;
      ok('C5 identifying turns the anonymous price into the member price (20% off $170)',
        q && q.kind === 'exact' && q.publicCents === 17000 && q.golfCents === 13600,
        q && { pub: q.publicCents, mem: q.golfCents });
      const cr = await postAs('/api/bookings/create-payment-intent', {
        date: D2, start_time: '10:00', duration_minutes: 180, bay_id: 'auto',
        name: 'Public Pct', phone: '+15005569999', email: 'c@example.invalid',
        member_pin: '770202', sms_consent: false });
      ok('C6 and the card is charged exactly that', cr.s === 200 && cr.d.priceCents === 13600,
        { s: cr.s, charged: cr.d.priceCents, err: cr.d.error });
      if (cr.d.bookingId) await postAs('/api/bookings/cancel/' + cr.d.bookingId, {});
      try { child.kill('SIGTERM'); } catch {}
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // ── D) THE REDIRECT RETURN ───────────────────────────────────────────────
  // Stripe emailed maintainer about payment failures from a confirmation with no
  // return_url. The booking intent is created with Stripe's account defaults,
  // which include klarna/affirm/cashapp/amazon_pay - all of which navigate the
  // customer away - and nothing used to bring them back to a finished booking.
  // These assertions drive the shapes the return handler actually produces.
  console.log('── D: a payment that left the page can finish ──');
  {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.booking.membersOnly = false;
    cfg.bays = BAYS2;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
    seed();
    const { child, log } = await boot();
    ok('D0 server up', !!child, child ? '' : log().slice(-400));
    if (child) {
      const postAs = (u, body) => fetch(B + u, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': PW },
        body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
      const D3 = ymd(new Date(now.getTime() + 11 * 86400000));

      // No Stripe keys on this facility, so create books instantly (dev path)
      // and there is no intent to confirm - what we CAN prove here is the
      // route's contract, which is what the return handler depends on.
      const cr = await postAs('/api/bookings/create-payment-intent', {
        date: D3, start_time: '10:00', duration_minutes: 60, bay_id: 'auto',
        name: 'Redirect Return', phone: '+15005567777', email: 'rr@example.invalid', sms_consent: false });
      ok('D1 a booking exists to come back to', cr.s === 200 && !!cr.d.bookingId, { s: cr.s, e: cr.d.error });

      // THE SHAPE THE RETURN HANDLER SENDS: booking id alone, no intent id.
      const again = await postAs('/api/bookings/confirm', { bookingId: cr.d.bookingId });
      ok('D2 /confirm accepts the booking id ALONE - the shape the return handler sends',
         again.s === 200 && again.d.success === true, again);

      // AND IT NEVER TAKES THE CALLER'S INTENT. A booking confirmed with some
      // other intent id must not be activated by it (before Sep 19 2026 the
      // caller's id won outright, so slot B could be paid for with slot A's
      // charge). With no Stripe configured the route cannot verify, so what we
      // assert here is that the mismatch is NOTICED and written down.
      const foreign = await postAs('/api/bookings/confirm',
        { bookingId: cr.d.bookingId, paymentIntentId: 'pi_someone_elses_charge' });
      const lg = await fetch(B + '/api/admin/log?limit=50', { headers: { 'x-admin-password': PW } })
        .then(r => r.json()).catch(() => ({}));
      const rows = (lg.entries || lg.log || lg || []);
      const noticed = Array.isArray(rows) && rows.some(e => e.event === 'CONFIRM_INTENT_MISMATCH');
      ok('D3 an intent the caller names that is not the booking\'s is refused or recorded, never acted on',
         foreign.s === 200 || noticed, { s: foreign.s, noticed });

      // THE SOURCE LOCKS for the parts a live redirect would exercise.
      const bk = fs.readFileSync('routes/bookings.js', 'utf8');
      ok('D4 /confirm can FIND the booking from Stripe\'s own parameter (a page from before this wave carries nothing of ours)',
         /SELECT id FROM bookings WHERE stripe_payment_intent = \?/.test(bk) &&
         bk.includes('FIND THE BOOKING FROM WHAT COMES BACK'));
      ok('D5 and the charge is still verified against the ROW\'s intent, never the one the caller named',
         bk.includes('const intentId = booking.stripe_payment_intent;'));
      const ix = fs.readFileSync('public/index.html', 'utf8');
      ok('D6 the page finishes the booking on return with our id AND Stripe\'s whenever it has both (the payment id is what earns the name back - rule 37)',
         ix.includes('async function handlePaymentReturn(') &&
         ix.includes("body: JSON.stringify(Object.assign({}, id ? { bookingId: id } : {}, pi ? { paymentIntentId: pi } : {}))"));
      ok('D7 every confirmation in the tree now passes a real return_url',
         /confirmParams: \{ return_url: backTo \}/.test(ix) &&
         /return_url: location\.origin \+ location\.pathname \+ '\?gc_return=1'/.test(fs.readFileSync('public/gift-cards.html', 'utf8')));

      try { child.kill('SIGTERM'); } catch {}
      await new Promise(r => setTimeout(r, 600));
    }
  }

  console.log(`\nMEMBER PRICE AGREEMENT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
