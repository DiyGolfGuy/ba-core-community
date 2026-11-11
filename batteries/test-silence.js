// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-silence.js — THE BOOKING ROUTE ALWAYS ANSWERS, AND ALWAYS RECORDS
//                   (W37, Sep 8 2026)
//
// Four things this battery exists to catch, all of them from the pilot facility lessons
// doc and three of them reproduced on this product before the fix
// (docs/internal/w37-repro.js, workshop 15/15 and bench .211 15/15):
//
//  1. SILENCE. A real card booking must reply. 200, 402, 409 or 502 - never no
//     reply. pilot facility hung every card payment twice in one day and the failure was
//     the ABSENCE of a response, not the payment outcome, which is why this
//     works perfectly well on a bench that cannot reach Stripe. Every request
//     here carries a hard client-side timeout: a hang FAILS, it never waits.
//  2. THE FREE BRANCH. A booking that costs nothing still takes a signature,
//     and that signature must reach signed_waivers. Ours did not, for the same
//     reason pilot facility's did not.
//  3. THE LEDGER ON THE PAID PATH. A gift card spent through Stripe must
//     decrement. Ours never did - the common path was the broken one.
//  4. THE SLOT RACE. Six people, one slot, one winner, one row on disk.
//
// Stripe is stood in for by a fake `stripe` module injected with node -r, so
// no product code changes and nothing can reach a payment provider. The stub
// can also be told to throw, which is how the 502 path is proved.
//
// Same-day idempotent: stages its own config.json and bookings.db, cleans its
// fixtures at the start of each run, and kills its server at the end.
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
const PORT = 3081;
const B = 'http://localhost:' + PORT;
const PW = 'silence-battery-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STUB = `
const Module = require('module');
const orig = Module._load;
function FakeStripe(){ return {
  paymentIntents: {
    async create(){
      if (process.env.STRIPE_STUB_THROW === '1') throw new Error('stub: Stripe unreachable');
      const id = 'pi_stub_' + Math.random().toString(36).slice(2,10);
      return { id, client_secret: id + '_secret', status: 'requires_payment_method' };
    },
    async retrieve(id){
      if (process.env.STRIPE_STUB_UNPAID === '1') return { id: id || 'pi_x', status: 'requires_payment_method' };
      return { id: id || 'pi_x', status: 'succeeded', latest_charge: 'py_stub' };
    },
    async cancel(id){ return { id, status: 'canceled' }; }
  }
}; }
Module._load = function(req, parent, isMain){ if (req === 'stripe') return FakeStripe; return orig.apply(this, arguments); };
`;
const stubPath = path.join(root, '.silence-stripe-stub.js');

(async () => {
  fs.writeFileSync(stubPath, STUB);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Silence', setup: { completed: true, eulaAccepted: true },
    booking: { staffedAccess: false, pricePerHalfHour: 25, windowDays: 30, openTime: '06:00', closeTime: '23:00', bufferMins: 0, bookingHoldMins: 10 },
    server: { port: PORT, businessName: 'Silence', adminPassword: PW },
    stripe: { secretKey: 'sk_test_silence', publishableKey: 'pk_test_silence' },
    waiver: { mode: 'required', collection: 'online' },
    sms: { sendConfirmation: false }, resend: { sendConfirmation: false },
    bays: [{ id: 'sil-b1', name: 'Bay One', active: true }]
  }, null, 2));

  const dbM = require('./services/db');
  await dbM.initDb();
  const up = path.join(root, 'waivers', 'uploads');
  fs.mkdirSync(up, { recursive: true });
  fs.writeFileSync(path.join(up, 'sil-doc.pdf'), 'SILENCE BATTERY WAIVER BYTES');
  for (const sql of [
    `DELETE FROM waivers WHERE id='sil-w1'`,
    `DELETE FROM discount_codes WHERE id IN ('sil-free','sil-gift')`,
    `DELETE FROM discount_uses WHERE code_id IN ('sil-free','sil-gift')`,
    `DELETE FROM signed_waivers WHERE customer_phone LIKE '5558%'`,
    `DELETE FROM bookings WHERE phone LIKE '5558%'`
  ]) dbM.db.prepare(sql).run();
  dbM.db.prepare(`INSERT INTO waivers (id,name,version,filename,active) VALUES ('sil-w1','Silence Waiver','2','sil-doc.pdf',1)`).run();
  dbM.db.prepare(`INSERT INTO discount_codes (id,code,description,type,value,max_uses,per_phone_limit,active)
                  VALUES ('sil-free','SILFREE','all of it','percentage',100,20,20,1)`).run();
  dbM.db.prepare(`INSERT INTO discount_codes (id,code,description,type,value,max_uses,per_phone_limit,active)
                  VALUES ('sil-gift','SILGIFT','{"paid":true}','gift',10,NULL,NULL,1)`).run();
  dbM.saveDb && dbM.saveDb();

  // ── the hold is ONE number, proved in process (no waiting) ───────────────
  {
    const core = require('./services/bookingcore');
    const cfgSvc = require('./services/config');
    const d = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    dbM.db.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,created_at)
                    VALUES ('sil-hold','sil-b1','Bay One','Holder','5558000000',?, '09:00','10:00',?,60,5000,'pending_payment', datetime('now','-5 minutes'))`).run(d, d);
    ok('hold: bookingcore exposes ONE hold number', typeof core.holdMins === 'function' && core.holdMins() === 10, core.holdMins && core.holdMins());
    const seen = core.findConflict({ bay_id: 'sil-b1', date: d, start_time: '09:00', end_time: '10:00', end_date: d });
    ok('hold: a 5-minute-old checkout still holds the slot at a 10-minute hold', !!seen && seen.id === 'sil-hold', seen && seen.id);
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    raw.booking.bookingHoldMins = 2;
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(raw, null, 2));
    cfgSvc.getConfig(true);
    await sleep(1100);   // getConfig caches by mtime
    ok('hold: shortening the facility\'s hold to 2 minutes releases it - ONE setting drives the rule',
       core.holdMins() === 2 && core.findConflict({ bay_id: 'sil-b1', date: d, start_time: '09:00', end_time: '10:00', end_date: d }) === null,
       { holdMins: core.holdMins() });
    raw.booking.bookingHoldMins = 10;
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(raw, null, 2));
    await sleep(1100);
    dbM.db.prepare(`DELETE FROM bookings WHERE id='sil-hold'`).run();
    dbM.saveDb && dbM.saveDb();
    const sched = fs.readFileSync(path.join(root, 'services/scheduler.js'), 'utf8');
    ok('hold: the sweeper expires at the SAME number, never a literal 10',
       /holdMins\(\)\} minutes/.test(sched) && !/'-10 minutes'\)"\s*\n?\s*\)\.all\(\)/.test(sched));
    const bk = fs.readFileSync(path.join(root, 'routes/bookings.js'), 'utf8');
    ok('hold: the availability grid no longer carries its own number',
       !/pendingGraceMins:\s*\d+/.test(bk));
  }

  // ── boot the unit with the Stripe stand-in ───────────────────────────────
  const child = spawn('node', ['-r', stubPath, 'server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  let alive = false;
  for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(B + '/api/time')).ok) { alive = true; break; } } catch {} }
  ok('server up with the Stripe stand-in', alive);
  const stop = () => { try { child.kill('SIGTERM'); } catch {} try { fs.unlinkSync(stubPath); } catch {} };
  if (!alive) { console.log(log.slice(-1200)); stop(); console.log(`\nSILENCE: ${pass} passed, ${fail + 1} failed`); process.exit(1); }

  // The owner password skips the anti-abuse booking limiter (W21) - this
  // battery makes more than ten booking attempts on purpose.
  const H = { 'Content-Type': 'application/json', 'x-admin-password': PW };
  const d = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  // EVERY call carries a hard timeout. A hung handler must FAIL this battery,
  // not hang it - the whole point of the check.
  const REPLY_MS = 8000;
  async function call(p, body) {
    const t0 = Date.now();
    try {
      const r = await fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(REPLY_MS) });
      return { s: r.status, d: await r.json().catch(() => ({})), ms: Date.now() - t0 };
    } catch (err) {
      return { s: 0, d: { error: String(err && err.name || err) }, ms: Date.now() - t0, silent: true };
    }
  }
  const get = p => fetch(B + p, { headers: H, signal: AbortSignal.timeout(REPLY_MS) })
    .then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) })).catch(e => ({ s: 0, d: { error: String(e.name) }, silent: true }));
  const base = { date: d, duration_minutes: 60, waiver_id: 'sil-w1', signature_name: 'Sig Signer', sms_consent: false, bay_id: 'sil-b1' };
  const OKCODES = [200, 402, 409, 502];

  try {
    // ── 1. SILENCE ─────────────────────────────────────────────────────────
    const card = await call('/api/bookings/create-payment-intent', { ...base, name: 'Card Carla', phone: '5558000001', email: 'c@example.com', start_time: '12:00' });
    ok('SILENCE: a real card booking ANSWERS (200/402/409/502, never nothing)',
       !card.silent && OKCODES.includes(card.s), { status: card.s, ms: card.ms, err: card.d.error });
    ok('SILENCE: and it answers promptly - the providers are not on the reply path',
       !card.silent && card.ms < 4000, { ms: card.ms });

    const conf = await call('/api/bookings/confirm', { bookingId: card.d.bookingId, paymentIntentId: 'pi_stub_c' });
    ok('SILENCE: confirm ANSWERS too', !conf.silent && OKCODES.includes(conf.s), { status: conf.s, ms: conf.ms });

    // ── 2. THE FREE BRANCH RECORDS ITS WAIVER ──────────────────────────────
    const free = await call('/api/bookings/create-payment-intent', { ...base, name: 'Free Fred', phone: '5558000002', email: 'f@example.com', start_time: '14:00', discount_code: 'SILFREE' });
    ok('FREE BRANCH: a 100%-discount booking is created and costs nothing',
       !free.silent && free.s === 200 && free.d.priceCents === 0, { s: free.s, price: free.d.priceCents });
    const rec = await get('/api/waivers/signed/booking/' + free.d.bookingId);
    ok('FREE BRANCH: its signature IS in signed_waivers (pilot facility lost five months of these)',
       rec.s === 200 && rec.d.signature_name === 'Sig Signer', { s: rec.s });
    ok('FREE BRANCH: the record carries the fingerprint of the exact document served',
       rec.s === 200 && /^[0-9a-f]{64}$/.test(rec.d.doc_sha256 || ''), rec.d && rec.d.doc_sha256);
    const ver = await get('/api/waivers/signed/' + rec.d.id + '/verify');
    ok('EVIDENCE: the packet can say the document still matches what was signed',
       ver.s === 200 && ver.d.matches === true && ver.d.reason === 'match', ver.d);

    // ── 3. THE LEDGER ON THE PAID PATH ─────────────────────────────────────
    const g0 = await get('/api/gifts/admin/list');
    const before = (g0.d.find || (() => null)) && g0.d.find(x => x.code === 'SILGIFT');
    ok('GIFT: the card starts at $10.00', !!before && before.balance_cents === 1000, before && before.balance_cents);
    const gift = await call('/api/bookings/create-payment-intent', { ...base, name: 'Gift Gina', phone: '5558000003', email: 'g@example.com', start_time: '16:00', discount_code: 'SILGIFT' });
    ok('GIFT: $10 comes off a $50 booking and $40 goes to the card',
       !gift.silent && gift.s === 200 && gift.d.priceCents === 4000, { s: gift.s, price: gift.d.priceCents });
    const gconf = await call('/api/bookings/confirm', { bookingId: gift.d.bookingId, paymentIntentId: 'pi_stub_g' });
    ok('GIFT: the payment confirms', gconf.s === 200 && gconf.d.success === true, gconf);
    const g1 = await get('/api/gifts/admin/list');
    const after = g1.d.find && g1.d.find(x => x.code === 'SILGIFT');
    ok('GIFT: the card is DOWN to $0.00 after a Stripe-paid booking (it never moved before W37)',
       !!after && after.balance_cents === 0, after && after.balance_cents);
    const again = await call('/api/bookings/confirm', { bookingId: gift.d.bookingId, paymentIntentId: 'pi_stub_g' });
    const g2 = await get('/api/gifts/admin/list');
    const after2 = g2.d.find && g2.d.find(x => x.code === 'SILGIFT');
    ok('LEDGER IS IDEMPOTENT: confirming twice does not spend the card twice',
       again.s === 200 && !!after2 && after2.balance_cents === 0, after2 && after2.balance_cents);

    // ── 4. SIX PEOPLE, ONE SLOT ────────────────────────────────────────────
    const six = await Promise.all([1, 2, 3, 4, 5, 6].map(n =>
      call('/api/bookings/create-payment-intent', { ...base, name: 'Racer ' + n, phone: '55580001' + n, email: `r${n}@example.com`, start_time: '18:00' })));
    const silent = six.filter(r => r.silent);
    ok('RACE: all six requests answered - nobody was left on a spinner', silent.length === 0, six.map(r => r.s));
    const winners = six.filter(r => r.s === 200);
    const losers = six.filter(r => r.s === 409);
    ok('RACE: exactly one winner', winners.length === 1, six.map(r => r.s));
    ok('RACE: the other five get a clean 409, all of them saying the card was not charged',
       losers.length === 5 && losers.every(r => r.d.notCharged === true), losers.map(r => ({ s: r.s, nc: r.d.notCharged })));
    ok('RACE: a loss to a live checkout says so, and says when to come back',
       losers.every(r => r.d.midCheckout !== true || r.d.retryAfterMins === 10),
       losers.map(r => ({ mid: r.d.midCheckout, retry: r.d.retryAfterMins })));
    const list = await get('/api/admin/bookings?per_page=300');
    const rows = Array.isArray(list.d) ? list.d : (list.d.bookings || []);
    const atSlot = rows.filter(r => r.bay_id === 'sil-b1' && r.date === d && r.start_time === '18:00' && r.status !== 'cancelled' && r.status !== 'expired');
    ok('RACE: ONE row on disk for that slot', atSlot.length === 1, { rows: atSlot.length, names: atSlot.map(x => x.name) });

    // ── 5. A TAKEN SLOT ANSWERS HONESTLY ───────────────────────────────────
    const taken = await call('/api/bookings/create-payment-intent', { ...base, name: 'Late Lou', phone: '5558000099', email: 'l@example.com', start_time: '18:00' });
    ok('TAKEN: a slot already sold answers 409 and never silence', !taken.silent && taken.s === 409, { s: taken.s });
    ok('TAKEN: and tells the customer their card was not charged', taken.d.notCharged === true, taken.d);

    // ── 6. A PAYMENT THAT DID NOT SUCCEED ──────────────────────────────────
    const un = await call('/api/bookings/create-payment-intent', { ...base, name: 'Unpaid Uma', phone: '5558000098', email: 'u@example.com', start_time: '20:00' });
    ok('UNPAID: the booking is created and held', !un.silent && un.s === 200 && !!un.d.clientSecret, { s: un.s });
  } catch (err) {
    ok('the battery ran to completion', false, String(err && err.message));
  }

  stop();
  await sleep(600);

  // ── 7. STRIPE UNREACHABLE: a clean 502, never a hang ─────────────────────
  {
    fs.writeFileSync(stubPath, STUB);
    const c2 = spawn('node', ['-r', stubPath, 'server.js'], { cwd: root, env: { ...process.env, STRIPE_STUB_THROW: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let alive2 = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(B + '/api/time')).ok) { alive2 = true; break; } } catch {} }
    if (alive2) {
      let r;
      try {
        const resp = await fetch(B + '/api/bookings/create-payment-intent', {
          method: 'POST', headers: H, signal: AbortSignal.timeout(REPLY_MS),
          body: JSON.stringify({ ...base, name: 'Outage Otto', phone: '5558000097', email: 'o@example.com', start_time: '21:00' })
        });
        r = { s: resp.status, d: await resp.json().catch(() => ({})) };
      } catch (e) { r = { s: 0, silent: true, d: { error: String(e.name) } }; }
      ok('OUTAGE: Stripe unreachable answers 502 - a clean refusal, never a hang',
         !r.silent && r.s === 502, { s: r.s, err: r.d.error });
    } else {
      ok('OUTAGE: server booted for the unreachable-Stripe case', false);
    }
    try { c2.kill('SIGTERM'); } catch {}
    await sleep(400);
    try { fs.unlinkSync(stubPath); } catch {}
  }

  console.log(`\nSILENCE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
