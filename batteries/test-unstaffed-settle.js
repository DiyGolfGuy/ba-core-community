// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-unstaffed-settle.js - DOOR AND DEPOSIT TIERS OUTSIDE STAFFED HOURS (queue item 9, Oct 2 2026).
//
// The staffing law: door settlement and deposits exist only where a person can collect the rest at
// the counter. test-settlement-matrix proves every tier style on a facility staffed at EVERY hour, so
// the other half - the same tiers booked when nobody is there - had never been run. Here: a HYBRID
// facility whose Staffed Days calendar has one window (10:00-14:00) on the booking day, the same tiers
// booked inside and outside it, through the real routes: the quote the booking page renders
// (validate-pin) and the charge (create-payment-intent). Inside: $0 online / a deposit, the rest at the
// door. Outside: the member's whole price online, no door figure, no deposit - and the page says so
// before the card is asked. The window is half-open: 13:00 is staffed, 14:00 is not.
const { spawn } = require('child_process');
const fs = require('fs');
const B = 'http://localhost:3001';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) { try { fs.unlinkSync(f); } catch {} }
// $60/hr => $30 per 30 min, HYBRID (staffed only when the calendar says so), waivers off
fs.writeFileSync('config.json', JSON.stringify({
  businessName: 'Unstaffed Test', setup: { completed: true, eulaAccepted: true },
  booking: { accessStyle: 'hybrid', staffedAccess: false, pricePerHalfHour: 30, checkinMode: 'full' },
  server: { port: 3001, businessName: 'Unstaffed Test', adminPassword: 'unstaffed-pw-1' },
  waiver: { mode: 'off' },
  membership: { depositCreditMode: 'member_tab' },
  bays: [{ id: 'ub1', name: 'Bay 1', active: true }]
}));

const H = { 'x-admin-password': 'unstaffed-pw-1', 'Content-Type': 'application/json' };
const send = (m, u, b) => fetch(B + u, { method: m, headers: H, body: JSON.stringify(b) }).then(r => r.json().catch(() => ({})).then(j => ({ s: r.status, j })));
const get = (u) => fetch(B + u, { headers: H }).then(r => r.json());
const day = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);   // the day after tomorrow, computed - never a fixed date

(async () => {
  const ch = spawn('node', ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
  let up = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 400)); try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {} }
  ok('server boots', up);
  if (!up) { try { ch.kill('SIGINT'); } catch {} process.exit(1); }
  process.on('exit', () => { try { ch.kill('SIGINT'); } catch {} });
  process.on('uncaughtException', (e) => { console.log('FAIL  battery crashed: ' + e.message); try { ch.kill('SIGINT'); } catch {} process.exit(1); });

  // ── the facility: one staffed window, set the way the owner sets it ──
  let r = await send('PUT', '/api/website/staffed', { date: day(), start_time: '10:00', end_time: '14:00', note: 'battery window' });
  const listed = await get(`/api/website/staffed?from=${day()}&to=${day()}`);
  const rows = (listed && listed.staffed) || [];
  ok('the Staffed Days calendar holds one window on the booking day, 10:00-14:00, set through the owner\'s route',
     r.s === 200 && rows.some(x => x.date === day() && x.start_time === '10:00' && x.end_time === '14:00'), { s: r.s, rows });

  const mkTier = async (t) => { await send('POST', '/api/members/tiers', t); const tiers = await get('/api/members/tiers'); return (tiers.tiers || tiers).find(x => x.name === t.name); };
  const mkMember = async (tier, name, phone) => { const x = await send('POST', '/api/members', { tier_id: tier.id, name, phone }); return x.j.pin || (x.j.member && x.j.member.pin); };
  const quote = (pin, start) => send('POST', '/api/members/validate-pin', { pin, date: day(), start_time: start, duration_minutes: 60, bay_id: 'ub1', guest_count: 0 });
  const book = (pin, start, name, phone) => send('POST', '/api/bookings/create-payment-intent', {
    bay_id: 'ub1', date: day(), start_time: start, duration_minutes: 60, name, phone, email: 'u@x.com', member_pin: pin, guest_count: 0 });

  const pctDoor = await mkTier({ name: 'Pct Door', discount_type: 'percentage', discount_value: 20, settlement_mode: 'door' });
  const fixedDoor = await mkTier({ name: 'Fixed Door', discount_type: 'fixed', discount_value: 10, settlement_mode: 'door' });
  const pctDep = await mkTier({ name: 'Pct Deposit', discount_type: 'percentage', discount_value: 20, settlement_mode: 'deposit', deposit_per30: 5 });
  const mDoor = await mkMember(pctDoor, 'Door Member', '5552000001');
  const mFixed = await mkMember(fixedDoor, 'Fixed Member', '5552000002');
  const mDep = await mkMember(pctDep, 'Deposit Member', '5552000003');
  ok('three non-blend tiers that settle at the door or by deposit, a member on each', [pctDoor, fixedDoor, pctDep, mDoor, mFixed, mDep].every(Boolean),
     { tiers: [pctDoor, fixedDoor, pctDep].map(t => t && t.settlement_mode), pins: [mDoor, mFixed, mDep].map(Boolean) });

  // one member, one tier, one hour of the day: what the page shows and what the card is charged
  async function cell(label, pin, start, name, phone, want) {
    const q = (await quote(pin, start)).j.settle || {};
    const c = (await book(pin, start, name, phone)).j || {};
    const id = c.bookingId || c.id;
    if (want.staffed) {
      if (want.deposit) {
        ok(`${label} at ${start} (staffed): the page quotes the deposit now and the rest at the door`,
           q.staffed === true && q.deposit === true && q.due_now_cents === want.now && q.door_due_cents === want.door && !q.door_settle, q);
        ok(`${label} at ${start} (staffed): the card is charged the deposit and the booking carries it`,
           !!id && c.priceCents === want.now && c.memberDeposit === true && !c.doorSettle, { p: c.priceCents, md: c.memberDeposit, ds: c.doorSettle, id });
      } else {
        ok(`${label} at ${start} (staffed): the page quotes $0 now and the member's price at the door`,
           q.staffed === true && q.door_settle === true && q.due_now_cents === 0 && q.door_due_cents === want.door, q);
        ok(`${label} at ${start} (staffed): $0 on the card, settled at the door`,
           !!id && c.priceCents === 0 && c.doorSettle === true && c.doorDueCents === want.door, { p: c.priceCents, ds: c.doorSettle, due: c.doorDueCents, id });
      }
    } else {
      ok(`${label} at ${start} (NOBODY THERE): the page quotes the member's whole price now - no door figure, no deposit`,
         q.staffed === false && !q.door_settle && !q.deposit && q.due_now_cents === want.now && !q.door_due_cents && !q.deposit_cents, q);
      ok(`${label} at ${start} (NOBODY THERE): the card is charged that whole price online - nothing left for a counter nobody is at`,
         !!id && c.priceCents === want.now && !c.doorSettle && !c.memberDeposit && !c.doorDueCents, { p: c.priceCents, ds: c.doorSettle, md: c.memberDeposit, due: c.doorDueCents, id });
    }
  }

  console.log('\n── at the door: 20% off $60 = $48 ──');
  await cell('percentage tier, settles at the door', mDoor, '10:00', 'Door Member', '5552000001', { staffed: true, door: 4800 });
  await cell('percentage tier, settles at the door', mDoor, '15:00', 'Door Member', '5552000001', { staffed: false, now: 4800 });
  console.log('\n── at the door: $10 off $60 = $50 ──');
  await cell('fixed-discount tier, settles at the door', mFixed, '11:00', 'Fixed Member', '5552000002', { staffed: true, door: 5000 });
  await cell('fixed-discount tier, settles at the door', mFixed, '16:00', 'Fixed Member', '5552000002', { staffed: false, now: 5000 });
  console.log('\n── by deposit: $5 a half hour of $48 ──');
  await cell('percentage tier with a deposit', mDep, '12:00', 'Deposit Member', '5552000003', { staffed: true, deposit: true, now: 1000, door: 3800 });
  await cell('percentage tier with a deposit', mDep, '17:00', 'Deposit Member', '5552000003', { staffed: false, now: 4800 });
  console.log('\n── the window\'s edge (half-open: the last staffed start is before 14:00) ──');
  await cell('percentage tier, settles at the door', mDoor, '13:00', 'Door Member', '5552000001', { staffed: true, door: 4800 });
  await cell('percentage tier, settles at the door', mDoor, '14:00', 'Door Member', '5552000001', { staffed: false, now: 4800 });

  // the owner's list shows what is due at the door only where someone will be there to take it (rule 4)
  const list = await get(`/api/admin/bookings?date=${day()}`);
  const bks = (Array.isArray(list) ? list : (list.bookings || list.rows || [])).filter(b => b.bay_id === 'ub1' && b.status !== 'cancelled');
  const at = t => bks.find(b => b.start_time === t) || {};
  // member_due_cents is the door-settled booking's golf, stamped for the counter; a deposit booking holds
  // its deposit and the counter prices the rest from the tier (test-settlement-matrix); a booking paid in
  // full online carries nothing
  const due = t => Number(at(t).member_due_cents) || 0, paid = t => Number(at(t).price_cents) || 0;
  ok('the owner\'s list: the staffed bookings carry what the counter collects, the unstaffed ones were paid in full online and carry nothing',
     bks.length === 8 && due('10:00') === 4800 && paid('10:00') === 0 && due('11:00') === 5000 && paid('11:00') === 0 && paid('12:00') === 1000 && due('13:00') === 4800
       && ['14:00', '15:00', '16:00', '17:00'].every(t => due(t) === 0) && paid('14:00') === 4800 && paid('15:00') === 4800 && paid('16:00') === 5000 && paid('17:00') === 4800,
     bks.map(b => ({ t: b.start_time, due: b.member_due_cents, price: b.price_cents })));

  try { ch.kill('SIGINT'); } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(f); } catch {} }
  console.log(`\nUNSTAFFED SETTLE: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})();
