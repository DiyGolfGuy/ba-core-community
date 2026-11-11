// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-settlement-matrix.js - SETTLEMENT FOR EVERY TIER STYLE (Aug 25, late).
//
// maintainer's rule: always give the facility owner the option. Any tier style may
// now settle online, by deposit, or at the door; a member code on a seat
// prices that seat by its tier at the counter (not just percentage tiers).
// This battery drives the REAL routes on a staffed facility: the quote the
// page renders (validate-pin), the charge (create-payment-intent), and the
// counter (performCheckin) must agree for every cell of the matrix - and the
// pre-existing cells (Example Owner's flat-rate deposit model, blend, percentage
// online) must be byte-identical to before.
const { spawn } = require('child_process');
const fs = require('fs');
const B = 'http://localhost:3001';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) { try { fs.unlinkSync(f); } catch {} }
// $60/hr => $30 per 30min, staffed at every hour, waivers off (same shape as test-memberblend)
fs.writeFileSync('config.json', JSON.stringify({
  businessName: 'Matrix Test', setup: { completed: true, eulaAccepted: true },
  booking: { staffedAccess: true, pricePerHalfHour: 30, checkinMode: 'full' },
  server: { port: 3001, businessName: 'Matrix Test', adminPassword: 'matrix-pw-1' },
  waiver: { mode: 'off' },
  membership: { depositCreditMode: 'member_tab' },
  bays: [{ id: 'mb1', name: 'Bay 1', active: true }]
}));

const H = { 'x-admin-password': 'matrix-pw-1', 'Content-Type': 'application/json' };
const post = (u, b, h) => fetch(B + u, { method: 'POST', headers: h || H, body: JSON.stringify(b) }).then(r => r.json().then(j => ({ s: r.status, j })));
const put = (u, b) => fetch(B + u, { method: 'PUT', headers: H, body: JSON.stringify(b) }).then(r => r.json().then(j => ({ s: r.status, j })));
const get = (u) => fetch(B + u, { headers: H }).then(r => r.json());
const day = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);   // day after tomorrow: fresh meters
let slot = 9;   // each booking takes its own hour on Bay 1 so the calendar never clashes
const nextStart = () => String(slot++).padStart(2, '0') + ':00';

(async () => {
  const ch = spawn('node', ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
  let up = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 400)); try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {} }
  ok('server boots', up);
  if (!up) { try { ch.kill('SIGINT'); } catch {} process.exit(1); }
  // never leave an orphan on port 3001 (a stale server serves stale state and its own rate-limit counters)
  process.on('exit', () => { try { ch.kill('SIGINT'); } catch {} });
  process.on('uncaughtException', (e) => { console.log('FAIL  battery crashed: ' + e.message); try { ch.kill('SIGINT'); } catch {} process.exit(1); });

  const mkTier = async (t) => { const r = await post('/api/members/tiers', t); const tiers = await get('/api/members/tiers'); return (tiers.tiers || tiers).find(x => x.name === t.name); };
  const mkMember = async (tier, name, phone) => { const r = await post('/api/members', { tier_id: tier.id, name, phone }); return r.j.pin || r.j.member?.pin; };
  const quote = (pin, start, mins) => post('/api/members/validate-pin', { pin, date: day(), start_time: start, duration_minutes: mins, bay_id: 'mb1', guest_count: 0 });
  const book = (pin, start, mins, name, phone, guests) => post('/api/bookings/create-payment-intent', {
    bay_id: 'mb1', date: day(), start_time: start, duration_minutes: mins, name, phone, email: 'm@x.com', member_pin: pin, guest_count: guests || 0 });
  // HTTP phase first (the spawned server owns the DB); the counter phase runs
  // in-process after the server exits - same pattern as test-memberblend.
  const later = [];
  let ck = null, dbM = null;
  const checkin = (bookingId, seats) => ck.performCheckin({ booking_id: bookingId, seats, employee: 'Battery' });
  const golf = (bookingId) => dbM.db.prepare(`SELECT collect_cents, member_share_cents FROM settlements WHERE booking_id=?`).get(bookingId);

  // ── 1. tier save: 3-way settlement + deposit_per30 persist; legacy checkbox still means deposit ──
  console.log('\u2500\u2500 tier editor contract \u2500\u2500');
  const pctDoor = await mkTier({ name: 'Pct Door', discount_type: 'percentage', discount_value: 20, settlement_mode: 'door' });
  ok('percentage tier saved with settlement door (was blend-only)', pctDoor && pctDoor.settlement_mode === 'door' && !pctDoor.deposit_mode, pctDoor && { s: pctDoor.settlement_mode, d: pctDoor.deposit_mode });
  const pctDep = await mkTier({ name: 'Pct Deposit', discount_type: 'percentage', discount_value: 20, settlement_mode: 'deposit', deposit_per30: 5 });
  ok('percentage tier saved with settlement deposit + $5/half-hour deposit; deposit_mode synced to 1', pctDep && pctDep.settlement_mode === 'deposit' && pctDep.deposit_mode === 1 && Number(pctDep.deposit_per30) === 5, pctDep && { s: pctDep.settlement_mode, d: pctDep.deposit_mode, p: pctDep.deposit_per30 });
  const legacy = await mkTier({ name: 'Legacy Flat Deposit', discount_type: 'flat_rate', discount_value: 12.5, deposit_mode: true, share_discount_pct: 50 });
  ok('legacy checkbox (deposit_mode:true, no settlement_mode) still saves as a deposit tier', legacy && legacy.deposit_mode === 1 && legacy.settlement_mode === 'deposit', legacy && { s: legacy.settlement_mode, d: legacy.deposit_mode });
  const flatOnline = await mkTier({ name: 'Flat Online', discount_type: 'flat_rate', discount_value: 10 });
  const fixedDoor = await mkTier({ name: 'Fixed Door', discount_type: 'fixed', discount_value: 10, settlement_mode: 'door' });
  const freeDoor = await mkTier({ name: 'Free Hours Door', discount_type: 'free_hours', discount_value: 1, settlement_mode: 'door', over_limit_discount_type: 'flat_rate', over_limit_discount_value: 5 });
  const pctOnline = await mkTier({ name: 'Pct Online', discount_type: 'percentage', discount_value: 20 });
  ok('untouched styles default to online with no deposit', flatOnline.settlement_mode === 'online' && !flatOnline.deposit_mode && pctOnline.settlement_mode === 'online');
  let r = await put('/api/members/tiers/' + pctOnline.id, Object.assign({}, pctOnline, { settlement_mode: 'door' }));
  const pctOnline2 = (await get('/api/members/tiers')); const po2 = (pctOnline2.tiers || pctOnline2).find(t => t.id === pctOnline.id);
  ok('update route persists a settlement change', r.s === 200 && po2.settlement_mode === 'door', { s: r.s, sm: po2 && po2.settlement_mode });
  await put('/api/members/tiers/' + pctOnline.id, Object.assign({}, pctOnline, { settlement_mode: 'online' }));

  const mPctDoor = await mkMember(pctDoor, 'Pct Door Member', '5551000001');
  const mPctDep = await mkMember(pctDep, 'Pct Deposit Member', '5551000002');
  const mLegacy = await mkMember(legacy, 'Legacy Member', '5551000003');
  const mFlat = await mkMember(flatOnline, 'Flat Online Member', '5551000004');
  const mFixed = await mkMember(fixedDoor, 'Fixed Door Member', '5551000005');
  const mFree = await mkMember(freeDoor, 'Free Hours Member', '5551000006');
  const mPctOn = await mkMember(pctOnline, 'Pct Online Member', '5551000007');
  ok('seven members created across the matrix', [mPctDoor, mPctDep, mLegacy, mFlat, mFixed, mFree, mPctOn].every(Boolean));

  // ── 2. percentage + DOOR: quote $0, charge $0, counter prices seat 0 by the tier ──
  console.log('\n\u2500\u2500 percentage tier, settles at the door \u2500\u2500');
  let st = nextStart();
  r = await quote(mPctDoor, st, 60);
  const q1 = r.j.settle || {};
  ok('quote: door_settle, $0 due now, member price $48 of $60 (20% off), note carried', q1.door_settle === true && q1.due_now_cents === 0 && q1.door_due_cents === 4800 && q1.member_cents === 4800 && q1.public_cents === 6000 && /20%/.test(q1.note), q1);
  r = await book(mPctDoor, st, 60, 'Pct Door Member', '5551000001', 1);
  ok('charge: $0 online, doorSettle true, doorDueCents $48, reservation confirmed', r.j.priceCents === 0 && r.j.doorSettle === true && r.j.doorDueCents === 4800 && !!(r.j.bookingId || r.j.id), { p: r.j.priceCents, ds: r.j.doorSettle, due: r.j.doorDueCents });
  const b1 = r.j.bookingId || r.j.id;
  const seatsOf = (o) => ((o.body || o).seats || []).map(s => (s.golf_cents != null ? s.golf_cents : s.golf));
  later.push(() => {
    const out = checkin(b1, [{ name: 'Pct Door Member' }, { name: 'Guest' }]);
    const s1 = seatsOf(out);
    ok('counter: 2 heads on $60 -> member seat $24 (share $30 - 20%) WITHOUT retyping a code, guest $30, collect $54', (!out.status || out.status === 200) && s1[0] === 2400 && s1[1] === 3000 && golf(b1).collect_cents === 5400, { st: out.status, seats: s1, c: golf(b1) && golf(b1).collect_cents, err: out.body && out.body.error });
  });

  // ── 3. percentage + DEPOSIT: quote deposit, Stripe charge is the deposit, counter credits it ──
  console.log('\n\u2500\u2500 percentage tier, deposit then the door \u2500\u2500');
  st = nextStart();
  r = await quote(mPctDep, st, 60);
  const q2 = r.j.settle || {};
  ok('quote: deposit $10 (2 x $5) today, member price $48, $38 at the door', q2.deposit === true && q2.deposit_cents === 1000 && q2.due_now_cents === 1000 && q2.member_cents === 4800 && q2.door_due_cents === 3800, q2);
  r = await book(mPctDep, st, 60, 'Pct Deposit Member', '5551000002', 0);
  ok('charge: online amount is the $10 deposit, memberDeposit flag, memberDueCents $48', r.j.priceCents === 1000 && r.j.memberDeposit === true && r.j.memberDueCents === 4800, { p: r.j.priceCents, md: r.j.memberDeposit, due: r.j.memberDueCents });
  const b2 = r.j.bookingId || r.j.id;
  later.push(() => {
    const row2 = dbM.db.prepare(`SELECT is_deposit, price_cents FROM bookings WHERE id=?`).get(b2);
    ok('booking row is a $10 deposit row (is_deposit=1) so the counter runs the member_deposit case', row2 && row2.is_deposit === 1 && row2.price_cents === 1000, row2);
  });
  later.push(() => {
    const out = checkin(b2, [{ name: 'Pct Deposit Member' }]);
    const s2 = seatsOf(out);
    ok('counter: alone on $60 -> member owes $48 - $10 deposit = $38 (the tier percentage applied at the door, deposit credited)', (!out.status || out.status === 200) && golf(b2).collect_cents === 3800, { st: out.status, seats: s2, c: golf(b2) && golf(b2).collect_cents, err: out.body && out.body.error });
  });

  // ── 4. LEGACY flat-rate deposit tier (Example Owner's locked model): byte-identical ──
  console.log('\n\u2500\u2500 flat-rate deposit tier (locked model) \u2500\u2500');
  st = nextStart();
  r = await quote(mLegacy, st, 60);
  const q3 = r.j.settle || {};
  ok('quote: deposit = the flat Value ($12.50/30 -> $25 for 1h), nothing else changes', q3.deposit === true && q3.deposit_cents === 2500 && q3.due_now_cents === 2500, q3);
  r = await book(mLegacy, st, 60, 'Legacy Member', '5551000003', 1);
  ok('charge: $25 deposit online exactly as before', r.j.priceCents === 2500, { p: r.j.priceCents });
  const b3 = r.j.bookingId || r.j.id;
  later.push(() => {
    const out = checkin(b3, [{ name: 'Legacy Member' }, { name: 'Guest' }]);
    const s3 = seatsOf(out);
    ok('counter: 2 heads -> member share $30 - 50% = $15, minus $25 deposit = $0 owed ($10 credit), guest $30 - identical to the Segment B numbers', (!out.status || out.status === 200) && s3[0] === 0 && s3[1] === 3000 && golf(b3).member_share_cents === 1500, { st: out.status, seats: s3, ms: golf(b3) && golf(b3).member_share_cents, err: out.body && out.body.error });
  });

  // ── 5. fixed + DOOR, free_hours + DOOR, flat_rate ONLINE seat code ──
  console.log('\n\u2500\u2500 fixed / free-hours / flat-rate at the counter \u2500\u2500');
  st = nextStart();
  r = await book(mFixed, st, 60, 'Fixed Door Member', '5551000005', 1);
  ok('fixed $10 off, door: $0 online, doorDueCents $50', r.j.priceCents === 0 && r.j.doorSettle === true && r.j.doorDueCents === 5000, { p: r.j.priceCents, due: r.j.doorDueCents });
  const b4 = r.j.bookingId || r.j.id;
  later.push(() => {
    const out = checkin(b4, [{ name: 'Fixed Door Member' }, { name: 'Guest' }]);
    const s4 = seatsOf(out);
    ok('counter: member seat $30 share - $10 = $20, guest $30', (!out.status || out.status === 200) && s4[0] === 2000 && s4[1] === 3000, { st: out.status, seats: s4, err: out.body && out.body.error });
  });
  st = nextStart();
  r = await quote(mFree, st, 120);
  ok('free-hours quote on /book: blend-shaped ($0 due now, $10 on the tab, 60 free + 60 paid minutes)', r.j.blend && r.j.blend.door_settle === true && r.j.blend.door_due_cents === 1000 && r.j.blend.free_minutes === 60 && r.j.blend.paid_minutes === 60 && r.j.over_limit === false, r.j.blend);
  r = await book(mFree, st, 120, 'Free Hours Member', '5551000006', 0);
  ok('free-hours (1 free hr, $5/30 after), door: THE METER - first hour free, second hour at $5/30 = $10; $0 online, $10 at the door, note says so', r.j.priceCents === 0 && r.j.doorSettle === true && r.j.doorDueCents === 1000 && /free hr/.test(r.j.blendNote || ''), { p: r.j.priceCents, due: r.j.doorDueCents, n: r.j.blendNote });
  const b5 = r.j.bookingId || r.j.id;
  later.push(() => {
    const out = checkin(b5, [{ name: 'Free Hours Member' }]);
    const s5 = seatsOf(out);
    ok('counter: alone 2h on $120 -> first hour free, second hour at $5/30 = $10 (the meter at the seat, same as online)', (!out.status || out.status === 200) && s5[0] === 1000, { st: out.status, seats: s5, err: out.body && out.body.error });
  });
  slot++;   // the 2-hour free-hours booking above took two slots
  st = nextStart();
  r = await book(null, st, 60, 'Walk Up', '5551000099', 1);
  const b6 = r.j.bookingId || r.j.id;
  ok('non-member booking pays full price online ($60) - untouched', r.j.priceCents === 6000, { s: r.s, j: r.j });
  // a flat-rate ONLINE member types their code on seat 2 of someone else's prepaid group: seat priced at their rate
  const stW = nextStart();
  // door-settled host so the group is pay_here and seat pricing is observable
  r = await book(mPctDoor, stW, 60, 'Pct Door Member', '5551000001', 1);
  const b7 = r.j.bookingId || r.j.id;
  later.push(() => {
    const out = checkin(b7, [{ name: 'Pct Door Member' }, { name: 'Flat Online Member', member_pin: mFlat }]);
    const s7 = seatsOf(out);
    ok('counter: flat-rate ($10/30) code on seat 2 -> $20 for their hour (own time at their rate, never more than the $30 share); host seat $24', (!out.status || out.status === 200) && s7[0] === 2400 && s7[1] === 2000, { st: out.status, seats: s7, err: out.body && out.body.error });
  });

  // ── 6. percentage ONLINE: byte-identical to before ──
  st = nextStart();
  r = await quote(mPctOn, st, 60);
  ok('percentage online quote: settlement online, due now = member price $48, no door/deposit flags', r.j.settle && r.j.settle.settlement === 'online' && r.j.settle.due_now_cents === 4800 && !r.j.settle.door_settle && !r.j.settle.deposit, r.j.settle);
  r = await book(mPctOn, st, 60, 'Pct Online Member', '5551000007', 0);
  ok('percentage online charge: $48 online, no door flags', r.j.priceCents === 4800 && !r.j.doorSettle && !r.j.memberDeposit, { p: r.j.priceCents });

  // ── 6b. what the customer and the counter SEE (Aug 25, late) ──
  console.log('\n── what the member and the counter see ──');
  {
    // staff list (admin credentials satisfy requireStaffOrAdmin): door reservation carries the due, deposit carries the paid amount
    const today = await fetch(B + '/api/staff/today?date=' + day(), { headers: H }).then(r => r.json());
    const rows = Array.isArray(today) ? today : (today.bookings || today.rows || []);
    const door = rows.find(x => x.id === b1);
    const dep = rows.find(x => x.id === b2);
    ok('staff list: door reservation row carries door_due_cents ($48) and member_id', door && door.door_due_cents === 4800 && !!door.member_id, door ? { d: door.door_due_cents, m: door.member_id, p: door.payment } : { keys: Object.keys(today).slice(0, 6), n: rows.length });
    ok('staff list: deposit row carries deposit_cents ($10)', dep && dep.deposit_cents === 1000 && dep.payment === 'deposit', dep && { d: dep.deposit_cents, p: dep.payment });
    const staffPage = fs.readFileSync('./public/staff.html', 'utf8');
    ok('staff card chip says "Member - $X at door" / "Deposit $Y paid" instead of a bare Pay here / Deposit', staffPage.includes("' at door'") && staffPage.includes("' paid'"));
    ok('check-in stepper explains a member reservation (nothing paid online, seat priced by membership, about $X if alone)', staffPage.includes('Member reservation - pay at the door') && staffPage.includes('priced by their membership automatically'));
    const emailSrc = fs.readFileSync('./services/email.js', 'utf8');
    ok('confirmation email has a PAY AT THE FACILITY block for door reservations and states the member price on deposit receipts', emailSrc.includes('PAY AT THE FACILITY') && emailSrc.includes('Charged today: $0.00') && emailSrc.includes('Your member price:'));
    const bk = fs.readFileSync('./routes/bookings.js', 'utf8');
    // W37: the free branch and the dev-mode branch used to build this object
    // twice, which is exactly how two terminal paths drift apart. They now share
    // ONE object in notifyAfterReply, so there is exactly one to check - and the
    // two branches cannot disagree about what the customer is told they owe.
    ok('the free-path confirmation email carries door_settle / door_due_cents / blend_note, from ONE shared object both branches use',
       (bk.match(/door_settle: !!doorSettle, door_due_cents:/g) || []).length === 1 &&
       bk.includes('const notifyAfterReply = (id) => {') &&
       (bk.match(/notifyAfterReply\(id\);/g) || []).length === 2);
    const myb = fs.readFileSync('./public/my-booking.html', 'utf8');
    ok('/my-booking says "Nothing paid - about $X settles at the door" for door reservations and "Deposit Paid ... balance settles at the door" for deposits, never "Amount Paid $0.00" for either',
       myb.includes('settles at the door</span>') && myb.includes('Deposit Paid') && fs.readFileSync('./routes/customer.js', 'utf8').includes('is_deposit, member_id, member_due_cents, stripe_payment_intent'));
  }

  // ── 6c. the tier editor asks the settlement question ONCE, for every style ──
  {
    const adm = fs.readFileSync('./public/admin.html', 'utf8');
    ok('tier editor: one "Member golf settles" select (online / deposit / door) visible for every style; the flat-rate-only checkbox is gone',
       (adm.match(/<select id="tierSettlement"/g) || []).length === 1 && adm.includes('<option value="deposit">Deposit online, balance at the door</option>') && !adm.includes('tierDepositMode'));
    ok('tier editor: deposit per half-hour field for non-flat tiers, Value stays the deposit for flat-rate (echo box)', adm.includes('id="tierDepositPer30"') && adm.includes('id="tierDepositEchoWrap"') && adm.includes("const flatDep = st === 'deposit' && dt === 'flat_rate'"));
    ok('tier editor: "in plain words" speaks for every style and the settlement choice', adm.includes("else if (dt === 'percentage') parts.push('Members get '") && adm.includes("Booking online charges nothing - it reserves the bay"));
    ok('tier editor: facility context line mirrors the staffing law (always staffed vs staffed-days calendar)', adm.includes('always staffed</b>: deposits and door settlement apply to every booking') && adm.includes('Staffed Days calendar'));
    ok('tier editor: save sends settlement_mode + deposit_per30 + deposit_mode in sync; open reads the 3-way value', adm.includes("settlement_mode: tierSettleValue(),") && adm.includes("deposit_mode: tierSettleValue() === 'deposit',") && adm.includes("deposit_per30: parseFloat(document.getElementById('tierDepositPer30').value) || 0,") && adm.includes("(tier?.settlement_mode === 'door' || tier?.settlement_mode === 'deposit') ? tier.settlement_mode : (tier?.deposit_mode ? 'deposit' : 'online')"));
    ok('waiver card: "A member\'s guests" policy (covered by the member / each guest signs) saved to cfg.waiver.guests', adm.includes('id="cfg_waiver_guests"') && adm.includes("guests: get('cfg_waiver_guests') === 'each' ? 'each' : 'member'") && fs.readFileSync('./services/config.js', 'utf8').includes("guests: 'member'"));
    const ckSrc2 = fs.readFileSync('./services/checkin.js', 'utf8');
    ok('counter honours the guest policy: covered_member only when the facility says the member covers guests; stepper defaults guest seats to Needed under "each"',
       ckSrc2.includes("cfgWaiver().guests !== 'each'") && ckSrc2.includes('waiver_guests:') && fs.readFileSync('./public/staff.html', 'utf8').includes("ckCtx.waiver_guests === 'each'"));
  }

  // ── 7. page + editor wiring ──
  console.log('\n\u2500\u2500 wiring \u2500\u2500');
  const page = fs.readFileSync('./public/index.html', 'utf8');
  // Sep 19 2026: the deposit box's noun follows the booking unit now - a club
  // that rents the whole building does not "hold your bay". The law is the
  // same (both boxes render from memberResult.settle); the noun comes from
  // swYour(), which is the one helper the emails and the portal share.
  ok('/book renders memberResult.settle: door box ("$0 due now", "settled on your tab") and deposit box (holds your bay OR the facility, "deposit is credited")',
     page.includes('memberResult.settle') && page.includes('settled on your tab at the facility') &&
     page.includes("today holds ' + swYour() + '") && page.includes('deposit is credited to your tab') &&
     /function swYour\(\)\s*\{ return WHOLE_FACILITY \? 'the facility' : 'your bay'; \}/.test(page));
  ok('/book keeps the flat-rate deposit box (per-headcount table) and the blend branch untouched', page.includes("!(memberResult.discount_type === 'flat_rate' && st.settlement === 'deposit')") && page.includes("memberResult.discount_type === 'daily_blend'"));
  const pricing = fs.readFileSync('./services/pricing.js', 'utf8');
  // ONE TRUNK, and since Sep 19 2026 it is sessionQuote: door and deposit
  // settlement moved INSIDE it, so the page and the charge read one call
  // instead of each running tierSettlement/tierDepositPer30 for themselves.
  // The law is unchanged and now harder to break - this lock names where it
  // actually lives rather than the old call sites.
  ok('one trunk: settlement lives in pricing.sessionQuote, read by validate-pin AND create-payment-intent',
     /tierSettlement, memberSessionPrice, tierDepositPer30, settlementQuote/.test(pricing) &&
     /sessionQuote, memberEligibility, slotRateFor/.test(pricing) &&
     /function sessionQuote\(/.test(pricing) &&
     pricing.includes('const settlement = tierSettlement(member);') &&
     pricing.includes('tierDepositPer30(member)') &&
     fs.readFileSync('./routes/members.js', 'utf8').includes('settlementQuote(member') &&
     fs.readFileSync('./routes/members.js', 'utf8').includes('pr.sessionQuote(member') &&
     fs.readFileSync('./routes/bookings.js', 'utf8').includes(".sessionQuote(\n    member, date, start_time, dur,"));
  const ckSrc = fs.readFileSync('./services/checkin.js', 'utf8');
  ok('counter: one seatCents() trunk prices every style; the three old percentage-only sites are gone', ckSrc.includes('function seatCents(') && !ckSrc.includes("Math.round(shares[i] * (1 - m.discount_pct / 100))") && !ckSrc.includes("Math.round(share * (1 - m.discount_pct / 100))"));

  // ── counter phase: server down, engine in-process on the same DB ──
  console.log('\n── the counter (engine phase) ──');
  try { const cwd = fs.readlinkSync('/proc/' + ch.pid + '/cwd'); if (cwd.startsWith(__dirname)) ch.kill('SIGINT'); } catch { try { ch.kill('SIGINT'); } catch {} }
  await new Promise(r2 => setTimeout(r2, 2500));
  dbM = require('./services/db');
  await dbM.initDb();
  ck = require('./services/checkin');
  // the stepper's dry run must equal what the commit writes, for every case
  const pv = (bid, seats) => ck.previewCheckin({ booking_id: bid, seats });
  const previews = [[b1, [{ name: 'Pct Door Member' }, { name: 'Guest' }]], [b2, [{ name: 'Pct Deposit Member' }]], [b3, [{ name: 'Legacy Member' }, { name: 'Guest' }]], [b4, [{ name: 'Fixed Door Member' }, { name: 'Guest' }]], [b7, [{ name: 'Pct Door Member' }, { name: 'Flat Online Member', member_pin: mFlat }]]]
    .map(([bid, seats]) => { const o = pv(bid, seats); return { bid, seats, golf: o.body && o.body.golf_cents, collect: o.body && o.body.collect_cents, st: o.status }; });
  ok('previewCheckin returns per-seat amounts for every case without writing a settlement', previews.every(x => x.st === 200 && Array.isArray(x.golf)) && dbM.db.prepare('SELECT COUNT(*) AS c FROM settlements').get().c === 0, previews.map(x => [x.st, x.golf]));
  for (const fn of later) { try { fn(); } catch (e) { ok('counter phase threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e)), false); } }
  const committed = previews.map(x => ({ bid: x.bid, seats: dbM.db.prepare('SELECT golf_cents FROM seats WHERE booking_id=? ORDER BY rowid').all(x.bid).map(r => r.golf_cents), collect: (golf(x.bid) || {}).collect_cents }));
  ok('preview == commit: seat amounts and collect match for every matrix case', previews.every((x, i) => JSON.stringify(x.golf) === JSON.stringify(committed[i].seats) && x.collect === committed[i].collect), { previews: previews.map(x => [x.golf, x.collect]), committed: committed.map(c => [c.seats, c.collect]) });
  const stepper = fs.readFileSync('./public/staff.html', 'utf8');
  ok('stepper paints the server quote (/api/staff/checkin/preview) - no client-side money math left', stepper.includes("'/api/staff/checkin/preview'") && !/Math\.round\(share \* \(1 - \(ckCtx\.booking\.share_discount_pct/.test(stepper) && fs.readFileSync('./routes/staff.js', 'utf8').includes("router.post('/checkin/preview'"));

  for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) { try { fs.unlinkSync(f); } catch {} }
  console.log('\nSETTLEMENT MATRIX: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
