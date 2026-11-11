// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-guests.js — THE GUEST LAW (Sep 1 2026)
//
// maintainer's prospect: a members-only place, a tier allows one guest, a member
// comes with four people - the two guests beyond the allowance pay. One
// rule (services/guests.js) for the booking page, the booking route and
// the counter, so the number the member sees is the number the pad collects.
//
// Structure: A) source locks  B) in-process law + counter truth (battery owns
// the db before any server spawns)  C) one live server on 3072, HTTP truth.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}
const root = __dirname;
// THE CLOCK IS PINNED TO THE 10TH OF THIS MONTH, 10 AM (Oct 29 2026, the week runner: from Oct 29 the battery's "three days ahead" fell in November,
// whose guest pass the booking rightly used, while C7 read October's through the member portal - the product right, the battery's own date
// wrong, a month-end date bomb). The battery and its server both run on that moment (tools/fake-clock.js), so a booking a few days ahead stays
// in the month the checks read, on every day of every month
const PIN = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 10, 10, 0, 0); })();   // a fixed date, computed: the 10th of this month
process.env.BA_FAKE_NOW = `${PIN.getFullYear()}-${String(PIN.getMonth() + 1).padStart(2, '0')}-10T10:00:00`;
require(path.join(root, 'tools', 'fake-clock.js'));
const cfgPath = path.join(root, 'config.json');
const PORT = 3072;
const B = 'http://localhost:' + PORT;
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

function baseCfg(over) {
  return Object.assign({
    businessName: 'Guest Test', setup: { completed: true },
    booking: { staffedAccess: true, pricePerHalfHour: 10, membersOnly: true, accessStyle: 'staffed', open24Hours: true, openTime: '06:00', closeTime: '23:30' },
    server: { port: PORT, businessName: 'Guest Test' },
    waiver: { mode: 'off' },
    bays: [{ id: 'bay1', name: 'B1', active: true }, { id: 'bay2', name: 'B2', active: true }]
  }, over || {});
}
function writeCfg(over) { fs.writeFileSync(cfgPath, JSON.stringify(baseCfg(over))); }

(async () => {
  // ── A) SOURCE LOCKS ────────────────────────────────────────────────────────
  console.log('── A: source locks ──');
  {
    const bk = fs.readFileSync('routes/bookings.js', 'utf8'), ck = fs.readFileSync('services/checkin.js', 'utf8');
    const ix = fs.readFileSync('public/index.html', 'utf8'), ad = fs.readFileSync('public/admin.html', 'utf8');
    const st = fs.readFileSync('public/staff.html', 'utf8'), dbs = fs.readFileSync('services/db.js', 'utf8');
    ok('A1 booking route prices guests through services/guests.js and refuses over the cap',
      bk.includes("guestsSvc.guestQuote({ tier: member") && bk.includes('guest_limit: true') && !bk.includes('guestOverflowCount'));
    // W37: this recording moved out of two per-branch closures in the booking
    // route into services/bookingledger, which every terminal path calls and
    // which reads member_guest_covered off the persisted row. The law is
    // unchanged - only COVERED guests burn passes, overflow guests paid - but
    // now the free branch, the dev-mode branch and /confirm cannot disagree
    // about it, and a retry cannot burn a pass twice.
    const led = fs.readFileSync('services/bookingledger.js', 'utf8');
    ok('A2 booking records only COVERED guests as passes (overflow guests paid, never burned)',
      led.includes('const covered = (b.member_guest_covered != null) ? (b.member_guest_covered | 0) : (b.member_guest_count | 0);') &&
      led.includes('if (covered > 0 && !already(\'member_guests\', b.id))') &&
      bk.includes('member_guest_covered') &&
      bk.includes("require('../services/bookingledger').recordAll"));
    ok('A3 counter applies the same law (pay_here + member deposit) and writes ONE pass row per booking',
      ck.split('{ const gl = applyGuestLaw(b, resolved, golf, shares, standard);').length === 3 && ck.includes('DELETE FROM member_guests WHERE booking_id = ? AND member_id = ?'));
    ok('A4 schema: guest_pricing_set + member_guest_covered', dbs.includes('guest_pricing_set INTEGER DEFAULT 0') && dbs.includes('member_guest_covered INTEGER DEFAULT 0'));
    ok('A5 booking page: the cap mirror stands down at a members-only club, the note comes from the server',
      ix.includes('!MEMBERS_ONLY && (displayPrice - guestFee) > base') && ix.includes('/api/members/guest-quote?'));
    ok('A6 booking page: no per-visit cap means a real list, not four', ix.includes('d.guest_max_per_visit > 0 ? d.guest_max_per_visit : 12'));
    ok('A7 tier editor offers "regular share" and reads the policy back in plain words',
      ad.includes('<option value="share">') && ad.includes('tierGuestSentence('));
    ok('A8 pad shows each guest seat what it is (pass / after passes / over the limit)', st.includes('.guest') && st.includes('guestnote'));
  }

  // ── B) IN-PROCESS TRUTH ────────────────────────────────────────────────────
  console.log('── B: the law + the counter ──');
  writeCfg();
  for (const f of ['bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  const dbM = require('./services/db');
  await dbM.initDb();
  require('./services/pos').ensureSchema();
  { const cs = require('./services/checks'); cs.ensureSchema(); cs.ensureShareColumn && cs.ensureShareColumn(); }
  const D = dbM.db;
  const guests = require('./services/guests');
  const ckSvc = require('./services/checkin');

  const mkTier = (id, name, over) => {
    const t = Object.assign({ discount_type: 'percentage', discount_value: 0, settlement_mode: 'door', deposit_mode: 0,
      guest_allowed: 1, guest_max_per_visit: 3, guest_passes_per_month: 1, guest_pricing_type: 'free', guest_pricing_value: 0,
      guest_overflow_price: 20, guest_pricing_basis: 'booking', guest_pricing_set: 1, guest_included_per_visit: 0, guest_collect: 'auto' }, over || {});
    D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,settlement_mode,deposit_mode,guest_allowed,guest_max_per_visit,guest_passes_per_month,guest_pricing_type,guest_pricing_value,guest_overflow_price,guest_pricing_basis,guest_pricing_set,guest_included_per_visit,guest_collect,sell_online,price_monthly,codes_included)
               VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,1,50,1)`)
      .run(id, name, t.discount_type, t.discount_value, t.settlement_mode, t.deposit_mode, t.guest_allowed, t.guest_max_per_visit, t.guest_passes_per_month, t.guest_pricing_type, t.guest_pricing_value, t.guest_overflow_price, t.guest_pricing_basis, t.guest_pricing_set, t.guest_included_per_visit, t.guest_collect);
    return Object.assign({ id, name }, t);
  };
  const mkMember = (id, name, pin, tier) =>
    D.prepare(`INSERT INTO members (id,tier_id,name,phone,email,pin,status,last_activated_at) VALUES (?,?,?,?,?,?,'active',datetime('now'))`)
      .run(id, tier, name, '558' + pin.slice(0, 4), 'g@example.com', pin);

  // the prospect's tier: 1 guest covered (free), $20 each after, cap 3, door-settled
  const tProspect = mkTier('gl-t1', 'One Guest Club');
  mkMember('gl-m1', 'GL Member', '711111', 'gl-t1');
  const now = new Date();
  const st = new Date(now.getTime() + 120 * 60000), en = new Date(now.getTime() + 180 * 60000);
  const hh = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const today = ymd(st);

  const q3 = guests.guestQuote({ tier: tProspect, memberId: 'gl-m1', guests: 3, date: today, durationMinutes: 60, standardCents: 8000, context: 'booking' });
  ok('B1 the prospect: 3 guests -> 1 covered by the pass, 2 pay $20 = $40', q3.covered === 1 && q3.overflow === 2 && q3.over_max === 0 && q3.total_cents === 4000 && q3.error === null, q3);
  ok('B1b the note says it in words', /1 guest covered by your pass - 2 guests beyond your passes at \$20\.00 each/.test(q3.note), q3.note);
  const q4 = guests.guestQuote({ tier: tProspect, memberId: 'gl-m1', guests: 4, date: today, durationMinutes: 60, standardCents: 8000 });
  ok('B2 over the 3-guest cap: the quote says so (the booking page refuses, the counter prices the 4th at the regular share)', /allows 3 guests per visit/.test(q4.error || '') && q4.over_max === 1 && q4.seats[3].kind === 'over_max' && q4.seats[3].cents === null, q4);
  const q0 = guests.guestQuote({ tier: Object.assign({}, tProspect, { guest_allowed: 0 }), memberId: 'gl-m1', guests: 1, date: today, durationMinutes: 60, standardCents: 8000 });
  ok('B3 a tier with no guest policy: friends are heads at the regular share, never refused', q0.error === null && q0.type === 'share' && q0.seats[0].cents === null && /regular share at the counter/.test(q0.note), q0);
  const qHour = guests.guestQuote({ tier: Object.assign({}, tProspect, { guest_pricing_basis: 'hour' }), memberId: 'gl-m1', guests: 3, date: today, durationMinutes: 90, standardCents: 8000 });
  ok('B4 per-hour basis scales the after-passes price (1.5h x $20 = $30 each, 2 guests = $60)', qHour.total_cents === 6000, qHour.total_cents);
  const qFlat = guests.guestQuote({ tier: Object.assign({}, tProspect, { guest_pricing_type: 'flat', guest_pricing_value: 12.5, guest_passes_per_month: 2 }), memberId: 'gl-m1', guests: 3, date: today, durationMinutes: 60, standardCents: 8000 });
  ok('B5 flat covered price: 2 passes at $12.50 + 1 after at $20 = $45', qFlat.covered === 2 && qFlat.total_cents === 4500, qFlat);
  ok('B6 legacy door tier that said "free" with no monthly limit means REGULAR SHARE (the guide\'s worked example is untouched)',
    guests.effectiveGuestType({ guest_pricing_type: 'free', guest_passes_per_month: 0, settlement_mode: 'door', guest_pricing_set: 0 }) === 'share' &&
    guests.effectiveGuestType({ guest_pricing_type: 'free', guest_passes_per_month: 0, settlement_mode: 'door', guest_pricing_set: 1 }) === 'free' &&
    guests.effectiveGuestType({ guest_pricing_type: 'free', guest_passes_per_month: 0, settlement_mode: 'online', guest_pricing_set: 0 }) === 'free');
  const qShare = guests.guestQuote({ tier: Object.assign({}, tProspect, { guest_pricing_type: 'share', guest_overflow_price: 0 }), memberId: 'gl-m1', guests: 3, date: today, durationMinutes: 60, standardCents: 8000, context: 'counter' });
  ok('B7 "regular share" with 1 pass: the pass guest is free, the others pay their split (cents null = the counter splits)', qShare.covered === 1 && qShare.seats[0].cents === 0 && qShare.seats[1].cents === null && qShare.total_cents === 0, qShare);
  ok('B8 passes are per CALENDAR month (bounded both ends)', (() => {
    D.prepare(`INSERT INTO member_guests (id,member_id,booking_id,date,guest_count) VALUES ('gl-mg-next','gl-m1','x', ?, 1)`).run(ymd(new Date(st.getFullYear(), st.getMonth() + 1, 15)));
    const left = guests.guestPassesLeft('gl-m1', tProspect, today);
    D.prepare(`DELETE FROM member_guests WHERE id='gl-mg-next'`).run();
    return left === 1;
  })());
  // maintainer, Sep 1 2026: included guests PER VISIT, $x per hour beyond, and WHERE it is collected
  const tInc = Object.assign({}, tProspect, { guest_included_per_visit: 1, guest_passes_per_month: 0, guest_pricing_basis: 'hour', guest_max_per_visit: 6 });
  const qInc = guests.guestQuote({ tier: tInc, memberId: 'gl-m1', guests: 3, date: today, durationMinutes: 90, standardCents: 8000, context: 'booking' });
  ok('D1 "allow one guest, $20 an hour each beyond": 3 guests for 90 min -> 1 included, 2 x $30 = $60, no pass touched', qInc.covered === 1 && qInc.seats[0].kind === 'included' && qInc.overflow === 2 && qInc.total_cents === 6000 && qInc.passes_used === 0, qInc);
  ok('D1b the words', /1 guest included with your membership - 2 guests beyond the included at \$30\.00 each \(per hour\)/.test(qInc.note), qInc.note);
  const qBoth = guests.guestQuote({ tier: Object.assign({}, tInc, { guest_passes_per_month: 1 }), memberId: 'gl-m1', guests: 3, date: today, durationMinutes: 60, standardCents: 8000 });
  ok('D2 included 1 + 1 pass a month: 3 guests -> 1 included, 1 by pass, 1 pays; only the pass guest burns a pass', qBoth.covered === 2 && qBoth.passes_used === 1 && qBoth.overflow === 1 && qBoth.seats.map(x => x.kind).join() === 'included,covered,overflow', qBoth);
  ok('D3 six allowed when the facility says six', guests.guestQuote({ tier: tInc, memberId: 'gl-m1', guests: 6, date: today, durationMinutes: 60, standardCents: 8000 }).error === null && guests.guestQuote({ tier: tInc, memberId: 'gl-m1', guests: 7, date: today, durationMinutes: 60, standardCents: 8000 }).over_max === 1);
  ok('D4 where the fees land is the owner\'s call: auto follows the golf, online is always online, door is the counter only where someone is there',
    guests.collectMode({ guest_collect: 'auto' }, { staffedHere: true, doorSettle: true }) === 'counter' && guests.collectMode({ guest_collect: 'auto' }, { staffedHere: false, doorSettle: false }) === 'online' &&
    guests.collectMode({ guest_collect: 'online' }, { staffedHere: true, doorSettle: true }) === 'online' &&
    guests.collectMode({ guest_collect: 'door' }, { staffedHere: true, doorSettle: false }) === 'counter' && guests.collectMode({ guest_collect: 'door' }, { staffedHere: false, doorSettle: false }) === 'online');
  ok('D5 the plain-words sentence carries the allowance and the collection choice', /1 included every visit \(free\); after that each guest pays \$20\.00 per hour each\. Guest fees follow the member's golf/.test(guests.policySentence(tInc)), guests.policySentence(tInc));
  ok('B9 the plain-words sentence for the tier editor', /Guests: up to 3 per visit\. 1 more per month from passes \(free\); after that each guest pays \$20\.00 each\./.test(guests.policySentence(tProspect)), guests.policySentence(tProspect));

  // the COUNTER: member books (door tier), shows up with 3 guests
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,member_id,member_due_cents)
             VALUES ('gl-b1','bay1','B1','GL Member','5587111',?,?,?,?,60,0,'active','gl-m1',2000)`).run(today, hh(st), hh(en), ymd(en));
  const pv = ckSvc.previewCheckin({ booking_id: 'gl-b1', seats: [{ name: 'GL Member' }, { name: 'Friend A' }, { name: 'Friend B' }, { name: 'Friend C' }] });
  const pvs = pv.body.seats;
  ok('B10 counter preview: friend A covered by the pass ($0), friends B and C $20 each - the law, not a split', pv.status === 200 && pvs[1].golf_cents === 0 && pvs[2].golf_cents === 2000 && pvs[3].golf_cents === 2000, pvs.map(s => s.golf_cents));
  ok('B10b each guest seat says what it is', /covered by a pass/.test(pvs[1].guest) && /\$20\.00 beyond the passes/.test(pvs[2].guest) && pv.body.guest_note && /1 guest covered/.test(pv.body.guest_note), pvs.map(s => s.guest));
  ok('B10c the member seat is priced by their own tier exactly as before (standard split, 0% tier)', pvs[0].golf_cents === Math.round(pv.body.standard_total_cents / 4), { m: pvs[0].golf_cents, std: pv.body.standard_total_cents });
  const pv5 = ckSvc.previewCheckin({ booking_id: 'gl-b1', seats: [{ name: 'GL Member' }, { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
  ok('B11 a 4th guest is over the cap: priced at the regular share, labelled', pv5.body.seats[4].golf_cents === Math.round(pv5.body.standard_total_cents / 5) && /over the 3-guest limit/.test(pv5.body.seats[4].guest), pv5.body.seats[4]);
  ok('B12 nothing was written by previews (no pass rows)', !D.prepare(`SELECT id FROM member_guests WHERE member_id='gl-m1'`).get());
  const ci = ckSvc.performCheckin({ booking_id: 'gl-b1', employee: 'Dana', seats: [{ name: 'GL Member' }, { name: 'Friend A' }, { name: 'Friend B' }, { name: 'Friend C' }] });
  const rows = D.prepare(`SELECT guest_count FROM member_guests WHERE member_id='gl-m1' AND booking_id='gl-b1'`).all();
  ok('B13 check-in commits the same numbers and burns exactly ONE pass, one row', ci.status === 200 && ci.body.seats[1].golf_cents === 0 && ci.body.seats[2].golf_cents === 2000 && rows.length === 1 && rows[0].guest_count === 1, { rows, seats: ci.body.seats.map(s => s.golf_cents) });
  ok('B13b the seat rows carry the note', /beyond the passes/.test(ci.body.seats[2].guest || ''));
  // second visit this month: no pass left -> all three pay
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,member_id,member_due_cents)
             VALUES ('gl-b2','bay2','B2','GL Member','5587111',?,?,?,?,60,0,'active','gl-m1',2000)`).run(today, hh(st), hh(en), ymd(en));
  const pv2 = ckSvc.previewCheckin({ booking_id: 'gl-b2', seats: [{ name: 'GL Member' }, { name: 'A' }, { name: 'B' }, { name: 'C' }] });
  ok('B14 the pass is spent this month: next visit all three guests pay $20', pv2.body.seats.slice(1).every(s => s.golf_cents === 2000), pv2.body.seats.map(s => s.golf_cents));
  // a booking that recorded its covered guest online is not double-burned at the counter
  D.prepare(`DELETE FROM member_guests WHERE member_id='gl-m1'`).run();
  D.prepare(`INSERT INTO member_guests (id,member_id,booking_id,date,guest_count) VALUES ('gl-mg-b2','gl-m1','gl-b2',?,1)`).run(today);
  const pv2b = ckSvc.previewCheckin({ booking_id: 'gl-b2', seats: [{ name: 'GL Member' }, { name: 'A' }, { name: 'B' }, { name: 'C' }] });
  ok('B15 a booking\'s own online pass row does not eat its own pass at the counter', pv2b.body.seats[1].golf_cents === 0, pv2b.body.seats.map(s => s.golf_cents));
  const ci2 = ckSvc.performCheckin({ booking_id: 'gl-b2', employee: 'Dana', seats: [{ name: 'GL Member' }, { name: 'A' }, { name: 'B' }, { name: 'C' }] });
  const rows2 = D.prepare(`SELECT guest_count FROM member_guests WHERE member_id='gl-m1' AND booking_id='gl-b2'`).all();
  ok('B16 ...and the commit leaves ONE row for that booking (replaced, not added)', ci2.status === 200 && rows2.length === 1 && rows2[0].guest_count === 1, rows2);
  // a tier with no guest policy keeps the plain split (regression lock for the settlement matrix)
  mkTier('gl-t2', 'Plain Door', { guest_allowed: 0, guest_passes_per_month: 0, guest_overflow_price: 0 });
  mkMember('gl-m2', 'GL Plain', '722222', 'gl-t2');
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,member_id,member_due_cents)
             VALUES ('gl-b3','bay1','B1','GL Plain','5587222',?,?,?,?,60,0,'active','gl-m2',2000)`).run(ymd(new Date(st.getTime() + 86400000)), hh(st), hh(en), ymd(new Date(en.getTime() + 86400000)));
  const pv3 = ckSvc.previewCheckin({ booking_id: 'gl-b3', seats: [{ name: 'GL Plain' }, { name: 'A' }, { name: 'B' }] });
  ok('B17 no guest policy on the tier: the counter splits by heads exactly as before (penny-fair, no notes)', pv3.body.seats.reduce((a, s) => a + s.golf_cents, 0) === pv3.body.standard_total_cents && pv3.body.seats.every(s => Math.abs(s.golf_cents - pv3.body.standard_total_cents / 3) < 1 && !s.guest) && !pv3.body.guest_note, pv3.body.seats.map(s => s.golf_cents));
  // a booking that collected the guest fees ONLINE: the counter shows the seats paid
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,member_id,member_guest_count,guest_fee_online_cents)
             VALUES ('gl-b4','bay2','B2','GL Member','5587111',?,?,?,?,60,6000,'active','gl-m1',3,4000)`).run(ymd(new Date(st.getTime() + 2 * 86400000)), hh(st), hh(en), ymd(new Date(en.getTime() + 2 * 86400000)));
  const pv4 = ckSvc.previewCheckin({ booking_id: 'gl-b4', seats: [{ name: 'GL Member' }, { name: 'A' }, { name: 'B' }, { name: 'C' }] });
  ok('D6 guests paid online at booking: the counter prices them $0 and says so', pv4.body.seats.slice(1).every(x => x.golf_cents === 0 && /paid online/.test(x.guest)), pv4.body.seats.map(x => [x.golf_cents, x.guest]));
  dbM.saveDb && dbM.saveDb();

  // ── C) HTTP TRUTH ──────────────────────────────────────────────────────────
  console.log('── C: the booking route ──');
  // an ONLINE-settled twin of the prospect's tier for the charge path
  mkTier('gl-t3', 'One Guest Online', { settlement_mode: 'online' });
  mkMember('gl-m3', 'GL Online', '733333', 'gl-t3');
  mkMember('gl-m4', 'GL Door Fresh', '744444', 'gl-t1');   // a door-tier member with this month's pass still unused
  mkTier('gl-t5', 'Honor Club', { settlement_mode: 'door', guest_included_per_visit: 1, guest_passes_per_month: 0, guest_pricing_basis: 'hour', guest_max_per_visit: 6, guest_collect: 'online' });
  mkMember('gl-m5', 'GL Honor', '755555', 'gl-t5');
  dbM.saveDb && dbM.saveDb();
  const child = spawn('node', ['-r', './tools/fake-clock.js', 'server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });   // (the same pinned moment - BA_FAKE_NOW is inherited)
  let bootLog = '';
  child.stdout.on('data', d => bootLog += d);
  child.stderr.on('data', d => bootLog += d);
  let up = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {}
  }
  ok('C0 server up on the battery port', up);
  if (up) {
    const post = (u, body) => fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
    const getj = u => fetch(B + u).then(r => r.json());
    const day = ymd(new Date(now.getTime() + 3 * 86400000));
    const bk = (over) => Object.assign({ name: 'GL Online', phone: '5587333', email: 'g@example.com', date: day, start_time: '10:00', duration_minutes: 60, bay_id: 'bay1', member_pin: '733333', sms_consent: false }, over || {});
    let r = await post('/api/bookings/create-payment-intent', bk({ guest_count: 3 }));
    ok('C1 online tier, 3 guests: member price + $40 for the two beyond the pass', r.s === 200 && r.d.guestFeeCents === 4000 && r.d.priceCents === 2000 + 4000, { s: r.s, fee: r.d.guestFeeCents, price: r.d.priceCents, err: r.d.error });
    ok('C1b the response says it in words', /1 guest covered by your pass - 2 guests beyond your passes at \$20\.00 each/.test(r.d.guestNote || ''), r.d.guestNote);
    r = await post('/api/bookings/create-payment-intent', bk({ guest_count: 4, start_time: '12:00' }));
    ok('C2 four guests on a 3-guest tier is refused with the reason', r.s === 400 && /allows 3 guests per visit/.test(r.d.error || '') && r.d.guest_limit === true, r);
    const q = await getj('/api/members/guest-quote?pin=733333&guests=3&date=' + day + '&duration=60&start_time=14:00');
    ok('C3 the booking page\'s quote endpoint: same law, same numbers, and it knows the club is members-only', q.covered === 0 && q.overflow === 3 && q.total_cents === 6000 && q.members_only === true, q);
    const q2 = await getj('/api/members/guest-quote?pin=744444&guests=3&date=' + day + '&duration=60&start_time=14:00');
    ok('C4 a door tier quotes for the counter: 1 covered, 2 at $20, nothing online', q2.at_counter === true && q2.covered === 1 && q2.overflow === 2 && q2.total_cents === 4000, q2);
    const dr = await post('/api/bookings/create-payment-intent', bk({ member_pin: '744444', name: 'GL Door Fresh', phone: '5587444', guest_count: 3, start_time: '16:00', bay_id: 'bay2' }));
    ok('C5 door tier: nothing charged online for guests, the note tells them what the counter will collect', dr.s === 200 && (dr.d.guestFeeCents | 0) === 0 && /1 guest covered by your pass - 2 guests beyond your passes at \$20\.00 each/.test(dr.d.guestNote || ''), { s: dr.s, fee: dr.d.guestFeeCents, note: dr.d.guestNote, err: dr.d.error });
    const hr = await post('/api/bookings/create-payment-intent', bk({ member_pin: '755555', name: 'GL Honor', phone: '5587555', guest_count: 3, start_time: '18:00', bay_id: 'bay2', duration_minutes: 90 }));
    ok('C9 honor-system tier ("always online"): a door tier still charges 2 x $30 with the booking, 1 included', hr.s === 200 && hr.d.guestFeeCents === 6000 && hr.d.guestCollect === 'online' && /1 guest included/.test(hr.d.guestNote || ''), { s: hr.s, fee: hr.d.guestFeeCents, collect: hr.d.guestCollect, note: hr.d.guestNote, err: hr.d.error });
    const night = await post('/api/bookings/create-payment-intent', bk({ member_pin: '755555', name: 'GL Honor', phone: '5587555', guest_count: 0, start_time: '03:00', bay_id: 'bay1', duration_minutes: 60 }));
    ok('C10 open 24 hours: a 3 AM booking is accepted (the opening-time check used to run before the flag - bench, Sep 2 2026)', night.s === 200 && !!night.d.bookingId, { s: night.s, err: night.d.error });
    // a PUBLIC facility: the walk-in cap protects the member's golf, the guest policy still charges
    writeCfg({ booking: { staffedAccess: true, pricePerHalfHour: 10, membersOnly: false, accessStyle: 'staffed', open24Hours: true, openTime: '06:00', closeTime: '23:30' } });
    await new Promise(r => setTimeout(r, 400));
    const pub = await post('/api/bookings/create-payment-intent', bk({ member_pin: '755555', name: 'GL Honor', phone: '5587555', guest_count: 3, start_time: '20:00', bay_id: 'bay2', duration_minutes: 60 }));
    ok('C11 public facility, door tier that collects guest fees online: golf $0 online (settled at the door), the two extra guests\' $40 on the card - the walk-in cap never swallows it', pub.s === 200 && pub.d.guestFeeCents === 4000 && pub.d.priceCents === 4000 && pub.d.doorSettle === true && pub.d.guestCollect === 'online', { s: pub.s, price: pub.d.priceCents, fee: pub.d.guestFeeCents, door: pub.d.doorSettle, err: pub.d.error });
    writeCfg();
    await new Promise(r => setTimeout(r, 400));
    const vp = await post('/api/members/validate-pin', { pin: '733333', date: day, duration_minutes: 60, guest_count: 0 });
    ok('C6 validate-pin reports the pass balance by calendar month and the effective guest pricing', vp.d.guest_passes_remaining === 0 && vp.d.guest_pricing_type_effective === 'free', { left: vp.d.guest_passes_remaining, eff: vp.d.guest_pricing_type_effective });
    // the server owns the db now (two-process lesson): read the pass ledger through the member portal
    const portal = await post('/api/members/portal', { name: 'GL Online', pin: '733333' });
    const used = portal.d && portal.d.usage ? portal.d.usage.guest_passes_used : undefined;
    ok('C7 only the covered guest burned a pass online (overflow guests were paid for, not burned)', used === 1, { used, usage: portal.d && portal.d.usage });
  } else {
    for (const n of ['C1', 'C1b', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C9', 'C10', 'C11']) ok(n + ' (server never came up)', false);
  }
  try { const cwd = fs.readlinkSync('/proc/' + child.pid + '/cwd'); if (cwd.startsWith(root)) child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
  const errLines = bootLog.split('\n').filter(l => /TypeError|ReferenceError|SyntaxError|Unhandled|Cannot find module/.test(l));
  ok('C8 zero runtime error signatures across every phase', errLines.length === 0, errLines.slice(0, 3));

  await new Promise(r => setTimeout(r, 300));
  for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) {
    try { fs.unlinkSync(path.join(root, f)); } catch {}
  }
  console.log('\nGUESTS: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
