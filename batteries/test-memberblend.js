// Copyright (c) 2025-2026 BA Custom Products LLC.
// test-memberblend.js - blended memberships: free daily hours + rate after,
// door settlement, per-seat own-tier pricing. Every number here comes from the
// design conversation (Aug 2026): $60/hr public, 1 free hr/day, $2.50/30min
// after, 31 hr/month pool.
const { spawn } = require('child_process');
const fs = require('fs');
const PORT = 3097, B = 'http://localhost:' + PORT;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('PASS  ' + n)) : (fail++, console.log('FAIL  ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : ''))); };

// $60/hr => $30 per 30min
fs.writeFileSync('config.json', JSON.stringify({
  businessName: 'Blend Test', setup: { completed: true, eulaAccepted: true },
  booking: { staffedAccess: true, pricePerHalfHour: 30, checkinMode: 'full' },
  server: { port: PORT, businessName: 'Blend Test', adminPassword: 'blend-pw-1' },
  waiver: { mode: 'off' },
  bays: [{ id: 'bb1', name: 'Bay 1', active: true }]
}));
try { fs.unlinkSync('bookings.db'); } catch {}

const H = { 'x-admin-password': 'blend-pw-1', 'Content-Type': 'application/json' };
const post = (u, b, h) => fetch(B + u, { method: 'POST', headers: h || H, body: JSON.stringify(b) }).then(r => r.json().then(j => ({ s: r.status, j })));
const get = (u, h) => fetch(B + u, { headers: h || H }).then(r => r.json());
// all sessions on TOMORROW: always in the future, all on one date so the
// daily free-hour logic is exercised on a single day
const today = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);   // the UTC date: a UTC day is always 24 hours

(async () => {
  const ch = spawn('node', ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
  let up = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 400)); try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {} }
  ok('server boots', up);
  if (!up) { try { ch.kill('SIGINT'); } catch {} process.exit(1); }

  // ── the tier: Example Owner's model ──
  let r = await post('/api/members/tiers', {
    name: 'Blend Club', discount_type: 'daily_blend', discount_value: 0,
    hours_per_day: 1, hours_per_month: 31,
    over_limit_discount_type: 'flat_rate', over_limit_discount_value: 2.5,
    settlement_mode: 'door', guest_allowed: true, guest_max_per_visit: 5, guest_pricing_type: 'share',   // the guide's worked example: guests pay the regular share (guest law, Sep 1 2026)
    guest_pricing_value: 0
  });
  ok('blend tier created with settlement door', r.s === 200 && r.j.success, r.j);
  const tiers = await get('/api/members/tiers');
  const tier = (tiers.tiers || tiers).find(t => t.name === 'Blend Club');
  ok('tier persists settlement_mode=door and flat_rate after 2.50', tier && tier.settlement_mode === 'door' && tier.over_limit_discount_type === 'flat_rate' && Number(tier.over_limit_discount_value) === 2.5, tier && { s: tier.settlement_mode, t: tier.over_limit_discount_type });

  // a plain 20% tier to prove untouched styles + the mixed group
  r = await post('/api/members/tiers', { name: 'Pct Club', discount_type: 'percentage', discount_value: 20 });
  const tiers2 = await get('/api/members/tiers');
  const pctTier = (tiers2.tiers || tiers2).find(t => t.name === 'Pct Club');
  ok('percentage tier untouched by the feature (settlement defaults online)', pctTier && (pctTier.settlement_mode || 'online') === 'online');

  // members
  r = await post('/api/members', { tier_id: tier.id, name: 'Blend Member', phone: '5550000001' });
  const m1pin = r.j.pin || r.j.member?.pin; ok('blend member created', !!m1pin, r.j);
  r = await post('/api/members', { tier_id: tier.id, name: 'Second Blend', phone: '5550000002' });
  const m2pin = r.j.pin || r.j.member?.pin;
  r = await post('/api/members', { tier_id: pctTier.id, name: 'Pct Member', phone: '5550000003' });
  const m3pin = r.j.pin || r.j.member?.pin;

  // PRE-CHECKOUT QUOTE (Aug 25, late): /book renders validate-pin's blend
  // quote, built by the same functions the payment path runs - what the page
  // shows must equal what create-payment-intent does below.
  r = await post('/api/members/validate-pin', { pin: m1pin, guest_count: 2, date: today(), start_time: '10:00', duration_minutes: 180, bay_id: 'bb1' });
  const q = r.j.blend || {};
  ok('validate-pin: blend member is never "over limit" (meter, not wall)', r.j.valid && r.j.over_limit === false && r.j.discount_type === 'daily_blend', { ol: r.j.over_limit, dt: r.j.discount_type });
  ok('validate-pin: door quote = $0 due now, $10 on the tab (1 free hr + 2hr x $5), public $180', q.door_settle === true && q.due_now_cents === 0 && q.door_due_cents === 1000 && q.member_cents === 1000 && q.public_cents === 18000, q);
  ok('validate-pin: quote carries the plain-words note + free/paid minutes', /free hr/.test(q.note || '') && q.free_minutes === 60 && q.paid_minutes === 120, q);
  ok('validate-pin: welcome line states the deal (1 free hour per day, $5.00/hour after)', /1 free hour per day/.test(r.j.message) && /\$5\.00\/hour after/.test(r.j.message), r.j.message);
  r = await post('/api/members/validate-pin', { pin: m1pin, guest_count: 0 });
  ok('validate-pin: verify-first (no session yet) returns blend: null, still valid, never over limit', r.j.valid && r.j.blend === null && r.j.over_limit === false, { b: r.j.blend, ol: r.j.over_limit });
  r = await post('/api/members/validate-pin', { pin: m3pin, guest_count: 0, date: today(), start_time: '19:00', duration_minutes: 60, bay_id: 'bb1' });
  ok('validate-pin: percentage tier response carries no blend field (other styles byte-identical)', r.j.valid && !('blend' in r.j) && r.j.discount_type === 'percentage', Object.keys(r.j).filter(k => /blend|settlement/.test(k)));

  // ── booking: 3 hours, 2 guests, door tier => $0 online, $10 door due ──
  r = await post('/api/bookings/create-payment-intent', {
    bay_id: 'bb1', date: today(), start_time: '10:00', duration_minutes: 180,
    name: 'Blend Member', phone: '5550000001', email: 'b@x.com',
    member_pin: m1pin, guest_count: 2
  });
  ok('door blend booking: $0 online', r.j.priceCents === 0 && (r.j.totalCents === 0 || r.j.totalCents === undefined || r.j.totalCents === 0), { p: r.j.priceCents, t: r.j.totalCents });
  ok('door blend booking: doorSettle flag + $10 door due (1 free hr + 2hr x $5)', r.j.doorSettle === true && r.j.doorDueCents === 1000, { ds: r.j.doorSettle, due: r.j.doorDueCents });
  const bId = r.j.bookingId || r.j.id;
  ok('booking confirmed without Stripe (reservation only)', !!bId, r.j);

  r = await post('/api/members/validate-pin', { pin: m1pin, guest_count: 0, date: today(), start_time: '15:00', duration_minutes: 60, bay_id: 'bb1' });
  ok('validate-pin after the 3h booking: quote shows the free hour spent (1h = $5 on the tab)', r.j.blend && r.j.blend.door_settle === true && r.j.blend.door_due_cents === 500 && r.j.blend.free_minutes === 0, r.j.blend);

  // second booking same day: free hour spent => 1h at $5/hr = $5... wait $2.50/30 x 2 = $5
  r = await post('/api/bookings/create-payment-intent', {
    bay_id: 'bb1', date: today(), start_time: '15:00', duration_minutes: 60,
    name: 'Blend Member', phone: '5550000001', email: 'b@x.com', member_pin: m1pin, guest_count: 0
  });
  ok('same-day second booking: free hour spent, 1h = $5 door due', r.j.doorSettle === true && r.j.doorDueCents === 500, { due: r.j.doorDueCents });

  // second member, fresh day allowance: their own 1h booking is free
  r = await post('/api/bookings/create-payment-intent', {
    bay_id: 'bb1', date: today(), start_time: '17:00', duration_minutes: 60,
    name: 'Second Blend', phone: '5550000002', email: 's@x.com', member_pin: m2pin, guest_count: 0
  });
  ok('second member fresh allowance: 1h fully free ($0 due at door)', r.j.doorSettle === true && r.j.doorDueCents === 0, { due: r.j.doorDueCents });

  // pct tier still prices exactly as before: 1h $60 - 20% = $48 charged online path
  r = await post('/api/bookings/create-payment-intent', {
    bay_id: 'bb1', date: today(), start_time: '19:00', duration_minutes: 60,
    name: 'Pct Member', phone: '5550000003', email: 'p@x.com', member_pin: m3pin, guest_count: 0
  });
  ok('percentage tier byte-identical: $48 online, no door flags', r.j.priceCents === 4800 && !r.j.doorSettle, { p: r.j.priceCents, ds: r.j.doorSettle });

  // ── server down, engine phase in-process (same DB file, now exclusive) ──
  try { const cwd = fs.readlinkSync('/proc/' + ch.pid + '/cwd'); if (cwd.startsWith(__dirname)) ch.kill('SIGINT'); } catch { try { ch.kill('SIGINT'); } catch {} }
  await new Promise(r2 => setTimeout(r2, 2500));
  const dbM = require('./services/db');
  await dbM.initDb();
  const ck = require('./services/checkin');
  const seats = [{ name: 'Blend Member' }, { name: 'Guest A' }, { name: 'Guest B' }];
  const brow = dbM.db.prepare('SELECT status, price_cents, is_deposit, member_id FROM bookings WHERE id=?').get(bId);
  const out = ck.performCheckin({ booking_id: bId, seats, employee: 'Battery' });
  const body = out?.body || out || {};
  const g = Array.isArray(body.seats) ? body.seats.map(x => x.golf_cents) : (body.golf || null);
  ok('performCheckin succeeds', !out.status || out.status === 200, { st: out.status, b: body.error || Object.keys(body) });
  ok('3h/3 heads: member $10 on tab, guests $60/$60', Array.isArray(g) && g[0] === 1000 && g[1] === 6000 && g[2] === 6000, g);
  ok('member_share reported as the blended $10', body.member_share_cents === 1000, body.member_share_cents);
  const collect = body.collect_cents ?? (Array.isArray(g) ? g.reduce((a, c) => a + c, 0) : -1);
  ok('staff collects $130 total (never the member benefit)', collect === 13000, collect);
  const rows = dbM.db.prepare('SELECT COUNT(*) AS c FROM member_usage WHERE booking_id=?').get(bId);
  ok('booker usage recorded exactly once for the booking', rows && rows.c === 1, rows);

  // extension: membership applies to added time (the page's promise)
  const pos = require('./services/pos');
  const t0 = pos.openTab({ name: 'Ext Tab', booking_id: bId });
  const ext = ck.extendBooking({ booking_id: bId, minutes: 60, tab_id: t0.id, employee: 'Battery' });
  const eb = ext?.body || {};
  ok('extension succeeds and blocks the calendar (end_time moved)', ext.status === 200 && !!eb.end_time, eb);
  ok('extension charged member rate + guests share ($5 + $40 = $45)', eb.price_cents === 4500, eb.price_cents);
  const tabNow = pos.getTab(t0.id);
  const items = (tabNow.items || tabNow.lines || []).filter(i => (i.name || '').includes('extension'));
  const hasM = items.some(i => (i.name || '').includes('member') && (i.unit_price_cents | 0) === 500);
  const hasG = items.some(i => (i.name || '').includes('guests') && (i.unit_price_cents | 0) === 4000);
  ok('two movable lines: member $5, guests $40', items.length === 2 && hasM && hasG, items.map(i => [i.name, i.unit_price_cents]));
  // /book renders the quote - the page never computes a blend of its own
  {
    const page = fs.readFileSync('./public/index.html', 'utf8');
    ok('/book has a daily_blend display branch that renders memberResult.blend (no client-side blend math)',
       page.includes("memberResult.discount_type === 'daily_blend'") && page.includes('memberResult.blend') && !/computeBlend|free_minutes\s*\*/.test(page));
    ok('/book door copy: "$0 due now", "on your tab at the facility", guests settle at the counter, the blend note',
       page.includes('$0 due now') && page.includes('on your tab at the facility') && page.includes('Guests settle their share at the counter') && page.includes('escHtml(bl.note)'));
    ok('/book online-settle copy: blended price shown with the note, "charged online when you book"', page.includes('displayPrice = bl.member_cents') && page.includes('charged online when you book'));
    ok('/book success screen reads the SERVER response (doorSettle/doorDueCents/blendNote), not the pre-quote',
       page.includes('window.LAST_BOOKING = data;') && page.includes('lb.doorSettle') && page.includes('lb.doorDueCents') && page.includes('lb.blendNote'));
    ok('/book door quote never shows FREE for a door-settled booking', page.includes("if (window.BLEND_DOOR) {\n        priceEl.innerHTML"));
  }
  for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) { try { fs.unlinkSync(f); } catch {} }
  console.log('\nMEMBERBLEND: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
