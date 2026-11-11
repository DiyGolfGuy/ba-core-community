// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-staff-2.js — Wave B exit battery: staff bookings + per-seat check-in.
// In-process like test-pos. The automation proof runs the REAL scheduler tick
// against a mock Shelly listener: a staff-created booking starting minutes out
// must fire power-on via the late-booking branch, while the staffed law keeps
// door codes silent.
'use strict';

const http = require('http');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const uid = () => require('crypto').randomUUID();

(async () => {
  const dbM = require('./services/db');
  await dbM.initDb();
  const cs = require('./services/config');
  const pos = require('./services/pos');
  pos.ensureSchema();

  // ── mock Shelly listener ─────────────────────────────────────────────────
  const shellyHits = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      shellyHits.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ison: true, result: { was_on: false } }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const mockIp = '127.0.0.1:' + mock.address().port;

  // ── stage config ─────────────────────────────────────────────────────────
  const cfg = cs.getConfig();
  cfg.server.staff = [{ name: 'TestStaff', code: '1234', active: true }];
  cfg.booking = Object.assign(cfg.booking || {}, {
    staffedAccess: true, openDays: ['mon','tue','wed','thu','fri','sat','sun'],
    openTime: '05:00', closeTime: '23:30', closeNextDay: false, open24Hours: false,
    windowDays: 7, minSessionMins: 30, maxSessionMins: 240, bufferMins: 0,
    pricePerHalfHour: 30
  });
  cfg.bays = [{ id: 'bay1', name: 'Bay 1', active: true, priceAdjustCents: 1000,
                shellyDevices: [{ ip: mockIp, gen: 2, minutesBefore: 10 }] }];
  cfg.pos = Object.assign({}, cfg.pos, { tax: { categories: { sim: 0, food: 0, beverage: 0 }, stripeTax: false, codes: [] } });
  cfg.membership = Object.assign({}, cfg.membership, { depositCreditMode: 'member_tab' });
  cfg.sms = Object.assign({}, cfg.sms, { sendConfirmation: true });
  cs.saveConfig(cfg);

  // ── deterministic reruns: remove EVERYTHING this battery ever created ────
  const D = dbM.db;
  const oldIds = D.prepare(`SELECT id FROM bookings WHERE phone LIKE '555%'`).all().map(r => r.id);
  for (const bid of oldIds) {
    const tabIds = D.prepare(`SELECT id FROM tabs WHERE booking_id = ?`).all(bid).map(r => r.id);
    for (const tid of tabIds) {
      D.prepare(`DELETE FROM tab_items WHERE tab_id = ?`).run(tid);
      D.prepare(`DELETE FROM tab_payments WHERE tab_id = ?`).run(tid);
    }
    D.prepare(`DELETE FROM tabs WHERE booking_id = ?`).run(bid);
    D.prepare(`DELETE FROM settlements WHERE booking_id = ?`).run(bid);
    D.prepare(`DELETE FROM seats WHERE booking_id = ?`).run(bid);
    D.prepare(`DELETE FROM signed_waivers WHERE booking_id = ?`).run(bid);
  }
  D.prepare(`DELETE FROM bookings WHERE phone LIKE '555%'`).run();
  D.prepare(`DELETE FROM member_credit WHERE member_id IN ('mA','mM','mR')`).run();
  D.prepare(`DELETE FROM member_guests WHERE member_id IN ('mA','mM','mR')`).run();

  function seedTier(t) {
    D.prepare(`INSERT OR REPLACE INTO membership_tiers
      (id, name, active, discount_type, discount_value, share_discount_pct, deposit_mode,
       guest_allowed, guest_max_per_visit, guest_passes_per_month, allowed_days, earliest_time, latest_time, allowed_bays)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(t.id, t.name, 1, t.discount_type || 'percentage', t.discount_value || 0,
           t.share_discount_pct || 0, t.deposit_mode || 0,
           t.guest_allowed || 0, t.guest_max || 0, t.passes || 0,
           t.allowed_days || '', t.earliest || '', t.latest || '', t.allowed_bays || '');
  }
  function seedMember(m) {
    D.prepare(`INSERT OR REPLACE INTO members (id, name, phone, email, tier_id, pin, status)
      VALUES (?,?,?,?,?,?, 'active')`)
      .run(m.id, m.name, m.phone || '5550000000', m.email || null, m.tier_id, m.pin);
  }
  seedTier({ id: 'tGold', name: 'Gold', discount_type: 'percentage', discount_value: 30, guest_allowed: 1, guest_max: 2, passes: 1 });
  seedTier({ id: 'tDep',  name: 'Birdie', deposit_mode: 1, share_discount_pct: 50 });
  seedTier({ id: 'tWk',   name: 'Weekday', discount_type: 'percentage', discount_value: 20, allowed_days: 'monday' });
  seedMember({ id: 'mA', name: 'A. Reyes', tier_id: 'tGold', pin: '2468' });
  seedMember({ id: 'mM', name: 'Marcus Vale', tier_id: 'tDep', pin: '1111' });
  seedMember({ id: 'mR', name: 'R. Weekday', tier_id: 'tWk', pin: '1357' });
  D.prepare(`INSERT INTO member_credit (member_id, delta_cents, reason) VALUES ('mA', 700, 'seed')`).run();
  D.prepare(`INSERT OR REPLACE INTO waivers (id, name, filename, version, active) VALUES ('w1','Liability','w.pdf','v3',1)`).run();

  // ── webhook spy ──────────────────────────────────────────────────────────
  const wh = require('./services/webhooks');
  const events = [];
  wh.dispatch = (ev, payload) => { events.push({ ev, payload }); };

  const ck = require('./services/checkin');

  // ── T1: staff booking — bay-aware price, conflicts, window skipped ───────
  // DATE IS COMPUTED, never hardcoded: this battery once carried a literal
  // FD (11 days out at writing) that became TODAY on Aug 20 and the
  // real scheduler tick in T2 rightfully completed the past-end-time booking
  // before T3 checked in. Eleven days out, forever.
  const FDp = x => String(x).padStart(2, '0');
  const FDymd = d => d.getFullYear() + '-' + FDp(d.getMonth() + 1) + '-' + FDp(d.getDate());
  const FDd = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (11), 12);
  const FD = FDymd(FDd);
  const FD12 = FDymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (12), 12));
  const FD13 = FDymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (13), 12));
  // T7's tier restriction is DAY-OF-WEEK math: it needs a real Sunday, at
  // least two weeks out so it never collides with the bookings above.
  const FDsun = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (14), 12);
  while (FDsun.getDay() !== 0) FDsun.setDate(FDsun.getDate() + 1);
  const FDSUN = FDymd(FDsun);
  let r = ck.staffCreateBooking({ bay_id: 'bay1', date: FD, start_time: '10:00',
    duration_minutes: 60, name: 'Walk In', phone: '5551112222', email: '', sms_consent: false, employee: 'TestStaff' });
  ok('T1 staff booking created 11 days out (windowDays=7 skipped)', r.status === 200 && r.body.booking.payment === 'pay_here');
  ok('T1 price is bay-aware: 2x($30+$10) = $80', r.body.booking.price_cents === 8000, r.body.booking.price_cents);
  const B1 = r.body.booking.id;
  ok('T1 booking.created webhook fired', events.some(e => e.ev === 'booking.created' && e.payload.id === B1));
  r = ck.staffCreateBooking({ bay_id: 'bay1', date: FD, start_time: '10:30',
    duration_minutes: 60, name: 'Clash', phone: '5551113333', sms_consent: false, employee: 'TestStaff' });
  ok('T1 overlapping staff booking rejected 409', r.status === 409);
  r = ck.staffCreateBooking({ bay_id: 'bay1', date: FD, start_time: '11:00',
    duration_minutes: 90, name: 'Second Group', phone: '5551114444', sms_consent: false, employee: 'TestStaff' });
  ok('T1 adjacent booking accepted (half-open intervals)', r.status === 200);
  const B2 = r.body.booking.id;
  r = ck.staffCreateBooking({ bay_id: 'bay1', date: FD, start_time: '04:00',
    duration_minutes: 60, name: 'TooEarly', phone: '5551115555', sms_consent: false, employee: 'TestStaff' });
  ok('T1 before opening time rejected', r.status === 400);

  // ── T2: AUTOMATION PROOF — real scheduler tick, mock Shelly, staffed law ─
  // Hours policy isn't what T2 tests, and the sandbox clock can sit outside
  // open hours — flip open24Hours for the proof, restore after the tick.
  const cfg2 = cs.getConfig(); cfg2.booking.open24Hours = true; cs.saveConfig(cfg2);
  // Bookings live on the 30-minute grid, so "3 minutes from now" is not a
  // legal start. Floor to the CURRENT slot: a session that began minutes ago
  // is the real late-entry case (the Aug 5 bug) and drives the same catch-up
  // automation branch this block exists to prove.
  const now = new Date();
  const pad2 = x => String(x).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const startStr = `${pad2(now.getHours())}:${now.getMinutes() < 30 ? '00' : '30'}`;
  // Cross-midnight staff bookings are supported now (the trunk computes
  // end_date), so this runs correctly at any hour, including 23:59.
  const nearDur = 60;
  r = ck.staffCreateBooking({ bay_id: 'bay1', date: todayStr, start_time: startStr,
    duration_minutes: nearDur, name: 'Near Now', phone: '5551116666', sms_consent: false, employee: 'TestStaff' });
  const nearOk = r.status === 200;
  ok('T2 late-entry staff booking created (session already under way)', nearOk, r.body);
  const B3 = nearOk ? r.body.booking.id : null;
  const hitsBefore = shellyHits.length;
  const sched = require('./services/scheduler');
  await sched.checkBookings();
  ok('T2 scheduler late-booking branch fired the Shelly (smart stuff ON)', shellyHits.length > hitsBefore, shellyHits.slice(-2));
  const b3row = B3 ? D.prepare(`SELECT sms_code_sent, door_code FROM bookings WHERE id=?`).get(B3) : {};
  ok('T2 staffed law: NO door code generated or sent', nearOk && !b3row.door_code && b3row.sms_code_sent === 0, b3row);
  const cfg3 = cs.getConfig(); cfg3.booking.open24Hours = false; cs.saveConfig(cfg3);

  // ── T3: pay_here check-in — the full seat matrix ─────────────────────────
  events.length = 0;
  r = ck.performCheckin({ booking_id: B1, employee: 'TestStaff', ip: '10.0.0.1', seats: [
    { name: 'Walk In', waiver: { method: 'digital', typed_name: 'John Q Public' } },
    { name: 'Guest 2', member_pin: '2468', apply_credit_cents: 500, waiver: { method: 'digital', typed_name: 'Guest Two' } },   // member with nothing on file signs at the door (W16: the server now insists)
    { name: 'Guest 3', use_pass_from_seat: 1, waiver: { method: 'paper' } }
  ]});
  ok('T3 pay_here check-in 200', r.status === 200, r.body);
  const t3 = r.body;
  // shares fairSplit(8000,3)=[2667,2667,2666]; seat2 member 30% -> round(2667*.7)=1867; seat3 pass -> 0
  ok('T3 golf math: 2667 / 1867 / 0', t3.seats[0].golf_cents === 2667 && t3.seats[1].golf_cents === 1867 && t3.seats[2].golf_cents === 0,
     t3.seats.map(s => s.golf_cents));
  ok('T3 collect = 4534', t3.collect_cents === 4534, t3.collect_cents);
  ok('T3 credit applied 500 on the member seat', t3.seats[1].credit_applied_cents === 500);
  const bal = D.prepare(`SELECT COALESCE(SUM(delta_cents),0) b FROM member_credit WHERE member_id='mA'`).get().b;
  ok('T3 ledger: 700 seed - 500 applied = 200', bal === 200, bal);
  const due1 = pos.computeTotals(pos.getTab(t3.seats[1].tab_id)).due_cents;
  ok('T3 member tab due = 1867-500 = 1367', due1 === 1367, due1);
  const swRows = D.prepare(`SELECT customer_name, signature_name, method, employee FROM signed_waivers ORDER BY agreed_at`).all();
  ok('T3 digital waiver row: typed legal name + employee stamp',
     swRows.some(w => w.method === 'digital' && w.signature_name === 'John Q Public' && w.employee === 'TestStaff'));
  ok('T3 paper attestation row stamped', swRows.some(w => w.method === 'paper' && w.customer_name === 'Guest 3' && w.employee === 'TestStaff'));
  ok('T3 pass burned: member_guests row + 0 left',
     D.prepare(`SELECT COUNT(*) c FROM member_guests WHERE member_id='mA' AND booking_id=?`).get(B1).c === 1);
  ok('T3 seats persisted with tabs', D.prepare(`SELECT COUNT(*) c FROM seats WHERE booking_id=?`).get(B1).c === 3);
  ok('T3 checkin.completed webhook: golfers=3, collect=4534',
     events.some(e => e.ev === 'checkin.completed' && e.payload.golfers === 3 && e.payload.collect_cents === 4534));
  r = ck.performCheckin({ booking_id: B1, employee: 'TestStaff', seats: [{ name: 'X' }] });
  ok('T3 double check-in 409', r.status === 409);
  const gv = ck.groupView(B1);
  ok('T3 groupView: 3 seats, dues reflect golf minus credit, not settled yet',
     gv && gv.checked_in && gv.seats.length === 3 &&
     gv.seats[0].due_cents === 2667 && gv.seats[1].due_cents === 1367 && gv.seats[2].due_cents === 0 &&
     gv.all_settled === false,
     gv && gv.seats.map(s => s.due_cents));

  // ── T4: member_deposit — proven math, bay-aware, seat-2 own tier ─────────
  const B4 = uid();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time,
      duration_minutes, price_cents, status, is_deposit, member_id)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active', 1, 'mM')`)
    .run(B4, 'bay1', 'Bay 1', 'Marcus Vale', '5552221111', FD12, '10:00', '12:00', 120, 5000);
  r = ck.performCheckin({ booking_id: B4, employee: 'TestStaff', seats: [
    { name: 'Marcus Vale', waiver: { method: 'paper' } }, { name: 'Guest 2', member_pin: '2468', waiver: { method: 'paper' } }, { name: 'Guest 3', waiver: { method: 'paper' } }
  ]});
  ok('T4 member_deposit 200', r.status === 200, r.body);
  // standard 4x(3000+1000)=16000; share=5333; memberShare=2667; surplus=5000-2667=2333
  ok('T4 standard bay-aware 16000', r.body.standard_total_cents === 16000, r.body.standard_total_cents);
  ok('T4 surplus to member credit 2333', r.body.credit_to_member_cents === 2333, r.body.credit_to_member_cents);
  ok('T4 seat2 own tier 30%: round(5333*.7)=3733; collect 3733+5333=9066',
     r.body.seats[1].golf_cents === 3733 && r.body.collect_cents === 9066,
     { s1: r.body.seats[1].golf_cents, c: r.body.collect_cents });
  ok('T4 booker seat golf 0 (covered by deposit)', r.body.seats[0].golf_cents === 0);
  const balM = D.prepare(`SELECT COALESCE(SUM(delta_cents),0) b FROM member_credit WHERE member_id='mM'`).get().b;
  ok('T4 ledger surplus row +2333', balM === 2333, balM);

  // ── T5: booking_deposit — group credit, default + custom splits ──────────
  const B5 = uid();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time,
      duration_minutes, price_cents, status, is_deposit)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active', 1)`)
    .run(B5, 'bay1', 'Bay 1', 'D. Foster', '5553331111', FD13, '10:00', '11:00', 60, 6000);
  r = ck.performCheckin({ booking_id: B5, employee: 'TestStaff', seats: [
    { name: 'D. Foster', waiver: { method: 'paper' } }, { name: 'Friend 1', waiver: { method: 'paper' } }, { name: 'Friend 2', waiver: { method: 'paper' } }
  ]});
  ok('T5 booking_deposit 200, remaining 8000-6000=2000', r.status === 200 && r.body.collect_cents === 2000, r.body.collect_cents);
  ok('T5 default friends-even: booker 0, friends 1000/1000',
     r.body.seats[0].golf_cents === 0 && r.body.seats[1].golf_cents === 1000 && r.body.seats[2].golf_cents === 1000,
     r.body.seats.map(s => s.golf_cents));
  const B6 = uid();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time,
      duration_minutes, price_cents, status, is_deposit)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active', 1)`)
    .run(B6, 'bay1', 'Bay 1', 'E. Custom', '5553332222', FD13, '12:00', '13:00', 60, 6000);
  r = ck.performCheckin({ booking_id: B6, employee: 'TestStaff', seats: [
    { name: 'E. Custom', golf_cents: 500, waiver: { method: 'paper' } }, { name: 'F1', golf_cents: 900, waiver: { method: 'paper' } }, { name: 'F2', golf_cents: 500, waiver: { method: 'paper' } }
  ]});
  ok('T5 custom split with wrong sum rejected 400', r.status === 400, r.body);
  r = ck.performCheckin({ booking_id: B6, employee: 'TestStaff', seats: [
    { name: 'E. Custom', golf_cents: 500, waiver: { method: 'paper' } }, { name: 'F1', golf_cents: 1000, waiver: { method: 'paper' } }, { name: 'F2', golf_cents: 500, waiver: { method: 'paper' } }
  ]});
  ok('T5 custom split summing to remaining accepted', r.status === 200 && r.body.seats[1].golf_cents === 1000);

  // ── T6: prepaid — arrival only ───────────────────────────────────────────
  const B7 = uid();
  D.prepare(`INSERT INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time,
      duration_minutes, price_cents, status, stripe_payment_intent)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'active', 'pi_test')`)
    .run(B7, 'bay1', 'Bay 1', 'Beth K', '5554441111', FDSUN, '10:00', '11:00', 60, 8000);
  r = ck.performCheckin({ booking_id: B7, employee: 'TestStaff', seats: [{ name: 'Beth K', waiver: { method: 'paper' } }, { name: 'Guest 2', waiver: { method: 'paper' } }] });
  ok('T6 prepaid: collect 0, all golf 0, seats + tabs created',
     r.status === 200 && r.body.case === 'prepaid' && r.body.collect_cents === 0 &&
     r.body.seats.every(s => s.golf_cents === 0), r.body);

  // ── T7: honest restriction message ───────────────────────────────────────
  const bRow = D.prepare(`SELECT * FROM bookings WHERE id=?`).get(B7); // FDSUN is computed to land on a Sunday
  const info = ck.seatMemberInfo('1357', bRow);
  ok('T7 weekday tier off-day: valid, restricted, pct 0, honest message',
     info.valid && !!info.restricted && info.discount_pct === 0 && /still|regular price/i.test(info.restricted_message || ''), info);
  const infoA = ck.seatMemberInfo('2468', bRow);
  // passes_left is PER MONTH: the T3 burn happened in FD's month, so when the
  // computed Sunday lands in the next month the count honestly resets to the
  // tier's 1/month. Assert the rule, not the old calendar coincidence.
  const expPasses = FDSUN.slice(0, 7) === FD.slice(0, 7) ? 0 : 1;
  ok('T7 unrestricted member reports credit + month-correct passes',
     infoA.valid && infoA.credit_cents === 200 && infoA.passes_left === expPasses,
     { got: infoA.passes_left, expected: expPasses });

  mock.close();
  console.log('\u2500\u2500 MOBILE FINDINGS: waiver truth + seat rename (maintainer, Aug 14) \u2500\u2500');
{
  const ck2 = require('./services/checkin');
  // build a checked-in group with NO active waiver in the system
  dbM.db.prepare(`UPDATE waivers SET active=0`).run();
  const st = new Date(Date.now() + 3 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const ds = st.getFullYear() + '-' + pad(st.getMonth() + 1) + '-' + pad(st.getDate());
  const en = new Date(st.getTime() + 3600000);
  dbM.db.prepare(`DELETE FROM bookings WHERE id='wv-1'`).run();
  dbM.db.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('wv-1','bay1','Bay 1','Wava','5577001122',?,?,?,?,60,6000,'active')`)
   .run(ds, pad(st.getHours()) + ':' + pad(st.getMinutes()), pad(en.getHours()) + ':' + pad(en.getMinutes()), ds);
  ck2.performCheckin({ booking_id: 'wv-1', heads: 2, seats: [{ name: 'Wava' }, { name: 'Guest 2' }], employee: 'Tess' });
  let gv = ck2.groupView('wv-1');
  ok('waiver truth: NO active waiver in the system means nothing reads needed',
     gv.seats.every(x => x.waiver === 'none' || x.waiver === 'signed'), gv.seats.map(x => x.waiver));
  // activate a waiver - now unsigned seats read needed
  dbM.db.prepare(`DELETE FROM waivers WHERE id='wv-doc'`).run();
  dbM.db.prepare(`INSERT INTO waivers (id,name,filename,version,active) VALUES ('wv-doc','Liability','w.pdf','2',1)`).run();
  gv = ck2.groupView('wv-1');
  const needer = gv.seats.find(x => x.waiver === 'needed');
  ok('waiver truth: with an active waiver, unsigned seats read needed', !!needer, gv.seats.map(x => x.waiver));
  const mk = ck2.markWaiverPaper(needer.id, 'Tess');
  const sig = dbM.db.prepare(`SELECT * FROM signed_waivers WHERE booking_id='wv-1' AND customer_name=?`).get(needer.name);
  // The Aug 2026 waiver batch FIXED this record's shape: paper attestations
  // now carry method='paper' + the collector in the employee column (the old
  // inline insert left method at its 'digital' default and stuffed the
  // collector into signature_name). The assert follows the corrected truth.
  ok('paper waiver: method=paper with the collector stamped as employee, active version',
     mk.ok === true && sig && sig.method === 'paper' && sig.employee === 'Tess' &&
     sig.signature_name == null && sig.waiver_version === '2',
     sig && { method: sig.method, employee: sig.employee, sig: sig.signature_name });
  gv = ck2.groupView('wv-1');
  ok('paper waiver: that seat now reads signed', gv.seats.find(x => x.id === needer.id).waiver === 'signed');
  const rn = ck2.renameSeat(needer.id, 'Carlos');
  const seatRow = dbM.db.prepare(`SELECT * FROM seats WHERE id=?`).get(needer.id);
  const tabRow = dbM.db.prepare(`SELECT label FROM tabs WHERE id=?`).get(seatRow.tab_id);
  ok('rename: the seat AND its tab label both carry the new name',
     rn.name === 'Carlos' && seatRow.name === 'Carlos' && tabRow.label === 'Carlos', { seat: seatRow.name, tab: tabRow.label });
  const src = require('fs').readFileSync('./public/staff.html', 'utf8');
  ok('mobile: Send lives in the always-visible rail head, state-synced, scroll unlocked',
     src.includes('odSendTop') && src.includes('st.disabled = sb.disabled') && src.includes('oraillines{flex:1;min-height:0;overflow-y:auto}'));
  ok('mobile: seat rows carry rename pencil and tappable paper-waiver chip',
     src.includes('data-srename') && src.includes('data-wpaper') && src.includes('waiver-paper'));
  const rt = require('fs').readFileSync('./routes/staff.js', 'utf8');
  ok('today badge gates on an active waiver existing AND the facility mode not being off', rt.includes("if (!dbMod.getActiveWaiver() || require('../services/memberwaiver').cfgWaiver().mode === 'off') waiverSigned = true"));
  dbM.db.prepare(`UPDATE waivers SET active=0 WHERE id='wv-doc'`).run();
}

console.log(`\nWAVE B SEGMENT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
