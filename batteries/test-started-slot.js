// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-started-slot.js - A STARTED SLOT IS NOT FOR SALE (maintainer, Sep 27 2026 - the hotfix pack)
//
// maintainer: "a customer cannot book or pay for a slot once it has started. The server refuses a started
// slot on every customer path: create, payment-intent creation, confirm, free-code and member-hours
// bookings, and an old checkout tab. If a payment still lands after the start, refund it
// automatically, cancel the booking, tell the customer, and log it. Staff pad, admin and walk-in
// bookings may still book a started slot (the customer is standing there), but show a plain warning
// of how many minutes have already passed. Add checks that fail on 2d0e09b for each path."
//
// The Stripe behind it is a stand-in in this process (BA_STRIPE_API_BASE, an sk_test_ key only) that
// creates intents, answers each checkout's charge with the time it landed, refuses a refund when told
// to, and fails a charge read. Rows that are already waiting when the unit boots (rule 22) carry the
// old-checkout-tab and slow-redirect cases; the sweeper runs as its own process against the same rows.
//   A  create: a started slot is refused - paid, a 100% code, a member on free hours - before any
//      intent exists; the same bodies for a later slot still book (the paths are live)
//   B  confirm: a payment that landed after the start is refunded, the booking cancelled, the
//      customer told, the owner's log says so; a charge made BEFORE the start but confirmed late is
//      a booking; a charge that cannot be read is refunded (OPEN); a refund Stripe refuses is logged,
//      the owner texted, the Online checkout line names them
//   C  the sweeper: a lapsed checkout whose payment landed after the start is refunded the same way;
//      one that paid in time is still restored
//   E  (Oct 3 2026, the pack review) a customer back from Klarna's or Affirm's page after the hold, whose slot
//      was sold meanwhile: refunded, cancelled, told - never activated beside the other group; control: the
//      same with the slot still free is confirmed
//   D  the staff pad and walk-ins: a started slot books, with "This session started N minutes ago.";
//      the pad's "Now" is the half hour under way (it was the next five minutes, which the server
//      refused), with the same warning on the form
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };
const root = __dirname;
const SRV = 3163, SPORT = 3199, B = 'http://127.0.0.1:' + SRV, PW = 'started-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent', BA_STRIPE_API_BASE: 'http://127.0.0.1:' + SPORT });
const local = t => ({ date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, time: `${pad(t.getHours())}:${pad(t.getMinutes())}` });
// the half hour under way (a started slot on the grid), and one well in the future
const now0 = new Date();
const started = local(new Date(Math.floor(now0.getTime() / 1800000) * 1800000));
const later = local(new Date((Math.floor(now0.getTime() / 1800000) + 4) * 1800000));
const tenAgo = local(new Date(Math.floor((now0.getTime() - 10 * 60000) / 60000) * 60000));   // a checkout row that started ten minutes ago
const startMs = r => new Date(`${r.date}T${r.time}:00`).getTime();

// ── the stand-in Stripe ──
const created = [], refunds = [];
const chargeAt = {};          // charge id -> seconds (when the charge landed)
const refuseRefund = new Set();
const refundedOnce = new Set();
// E: checkouts still on Klarna's page - the intent says requires_action with the chosen method (expanded, as the
// sweeper asks) until the customer finishes there; then succeeded, as Stripe answers
const onKlarna = new Set(['pi_away', 'pi_awayok']);
// B9: a payment Stripe is slow to answer about - two confirms for it are both in flight at once
const slow = new Set(['pi_twice']);
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const u = req.url;
    if (req.method === 'POST' && /^\/v1\/payment_intents\/?(\?|$)/.test(u)) {
      const id = 'pi_new' + (created.length + 1); created.push({ id, body: b });
      return res.end(JSON.stringify({ id, object: 'payment_intent', client_secret: id + '_secret_x', status: 'requires_payment_method', amount: 5000, currency: 'usd' }));
    }
    if (req.method === 'POST' && /^\/v1\/payment_intents\/pi_[^/]+\/cancel/.test(u)) { const id = u.split('/')[3]; return res.end(JSON.stringify({ id, object: 'payment_intent', status: 'canceled' })); }
    if (req.method === 'GET' && /^\/v1\/payment_intents\/pi_/.test(u) && onKlarna.has(u.split('/')[3].split('?')[0])) {
      const id = u.split('/')[3].split('?')[0], expanded = /expand/.test(decodeURIComponent(u)) && /payment_method/.test(decodeURIComponent(u));
      return res.end(JSON.stringify({ id, object: 'payment_intent', status: 'requires_action', amount: 5000, payment_method: expanded ? { id: 'pm_k_' + id, object: 'payment_method', type: 'klarna' } : 'pm_k_' + id, next_action: { type: 'redirect_to_url' } }));
    }
    if (req.method === 'GET' && /^\/v1\/payment_intents\/pi_/.test(u) && slow.has(u.split('/')[3].split('?')[0])) { const id = u.split('/')[3].split('?')[0]; return setTimeout(() => res.end(JSON.stringify({ id, object: 'payment_intent', status: 'succeeded', amount: 5000, latest_charge: 'ch_' + id.slice(3) })), 400); }
    if (req.method === 'GET' && /^\/v1\/payment_intents\/pi_/.test(u)) { const id = u.split('/')[3].split('?')[0]; return res.end(JSON.stringify({ id, object: 'payment_intent', status: 'succeeded', amount: 5000, latest_charge: 'ch_' + id.slice(3) })); }
    if (req.method === 'GET' && /^\/v1\/charges\/ch_/.test(u)) {
      const id = u.split('/')[3].split('?')[0];
      if (!(id in chargeAt)) { res.statusCode = 500; return res.end(JSON.stringify({ error: { type: 'api_error', message: 'An unknown error occurred' } })); }
      return res.end(JSON.stringify({ id, object: 'charge', created: chargeAt[id], amount: 5000, paid: true, status: 'succeeded' }));
    }
    if (req.method === 'POST' && u.startsWith('/v1/refunds')) {
      const p = new URLSearchParams(b); refunds.push({ charge: p.get('charge'), pi: p.get('payment_intent'), owner: p.get('metadata[ba_owner]') });
      // as Stripe answers a second full refund of the same charge (Oct 3 2026 - the stand-in refunded anything twice)
      const chKey = p.get('charge') || ('ch_' + String(p.get('payment_intent') || '').slice(3));
      if (refundedOnce.has(chKey)) { res.statusCode = 400; return res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Charge ' + chKey + ' has already been refunded.' } })); }
      // a REFUSED refund is not a refund (the review, Oct 3 2026): remembered before the refusal, a second try was told
      // "already refunded" - kinder than Stripe, which refuses a disputed charge again
      // the charge, however the refund names it (by charge or by its payment intent)
      if (refuseRefund.has(chKey)) { res.statusCode = 402; return res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'charge_disputed', message: 'Charge ' + p.get('charge') + ' has been charged back; create a dispute response instead.' } })); }
      refundedOnce.add(chKey);
      return res.end(JSON.stringify({ id: 're_' + refunds.length, object: 'refund', status: 'succeeded', amount: 5000, charge: p.get('charge') }));
    }
    if (req.method === 'GET' && u.startsWith('/v1/refunds')) return res.end(JSON.stringify({ object: 'list', data: [], has_more: false }));
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'stand-in: no route ' + req.method + ' ' + u } }));
  });
});

let server = null, out = '';
const run = js => spawnSync(process.execPath, ['-e', js], { cwd: root, env: ENV, encoding: 'utf8', timeout: 120000 });
const read = sql => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return []; } };
const call = async (method, p, body, headers) => { try { const r = await fetch(B + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d: d || {} }; } catch (e) { return { s: 0, d: { err: e.message } }; } };
const owner = { 'x-admin-password': PW };
async function boot() {
  out = '';
  server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, ENV, { BA_DISABLE_SCHEDULER: '1' }) });
  server.stdout.on('data', d => out += d); server.stderr.on('data', d => out += d);
  for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(B + '/api/time')).ok) return true; } catch {} }
  return false;
}
async function halt() { if (!server) return; const p = server; server = null; p.kill('SIGTERM'); for (let i = 0; i < 40 && p.exitCode === null; i++) await sleep(100); }
const log = () => read("SELECT event, detail FROM admin_log ORDER BY id");
const row = id => { spawnSync('sleep', ['0.6']); const r = read(`SELECT status, COALESCE(stripe_charge_id,''), COALESCE(refunded_at,''), COALESCE(confirmed_at,'') FROM bookings WHERE id='${id}'`)[0]; return r ? { status: r[0], charge: r[1], refundedAt: r[2], confirmedAt: r[3] } : null; };

(async () => {
  try {
    try { if ((await fetch(B + '/api/time')).ok) { console.log('FAIL  port ' + SRV + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    await new Promise(r => stripe.listen(SPORT, '127.0.0.1', r));
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Started Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: SRV, businessName: 'Started Golf', adminPassword: PW, timezone: 'America/Chicago' },
      booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, windowDays: 30, bookingHoldMins: 10 },
      stripe: { secretKey: 'sk_test_started_battery_standin', publishableKey: 'pk_test_started_battery_standin' },
      resend: { apiKey: 're_started_battery', fromEmail: 'desk@started.example', sendConfirmation: false, sendCancellation: true },
      sms: { sendCancellation: true },
      contact: { email: 'owner@started.example' }, alerts: { ownerMobile: '+15550100902' },
      bays: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'].map((id, i) => ({ id: 'ss-' + id, name: 'Bay ' + (i + 1), active: true })), waiver: { mode: 'off' }
    }, null, 2));
    // rows already waiting when the unit boots (rule 22): checkouts whose session began ten minutes ago
    const endT = local(new Date(startMs(tenAgo) + 60 * 60000));
    // a session that ENDED half an hour ago, paid before it began, whose browser never came back
    const overS = local(new Date(Math.floor((now0.getTime() - 90 * 60000) / 60000) * 60000)), overE = local(new Date(startMs(overS) + 60 * 60000));
    const pend = (id, bay, pi, createdAgoMin) => `q("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,stripe_payment_intent,sms_consent,created_at,updated_at) VALUES ('${id}','${bay}','${bay}','Rae ${id}','+1555010090${bay.slice(-1)}','${id}@started.example','${tenAgo.date}','${tenAgo.time}','${endT.time}','${endT.date}',60,5000,'pending_payment','${pi}',1,datetime('now','-${createdAgoMin} minutes'),datetime('now','-${createdAgoMin} minutes'))");`;
    // E: a slot two hours out, a checkout made twenty minutes ago (the hold is ten) - away on a payment provider's page
    const fut = local(new Date((Math.floor(now0.getTime() / 1800000) + 4) * 1800000 + 3600000)), futE = local(new Date(startMs(fut) + 60 * 60000));
    const away = (id, bay, pi, status, createdAgoMin) => `q("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,stripe_payment_intent,sms_consent,created_at,updated_at) VALUES ('${id}','${bay}','${bay}','Rae ${id}','+1555010${String(id.length).padStart(2, '0')}9${bay.slice(-1)}','${id}@started.example','${fut.date}','${fut.time}','${futE.time}','${futE.date}',60,5000,'${status}','${pi}',1,datetime('now','-${createdAgoMin} minutes'),datetime('now','-${createdAgoMin} minutes'))");`;
    const seed = run(`const db=require('./services/db');db.initDb().then(async()=>{const q=(s,...a)=>db.db.prepare(s).run(...a);
      q("INSERT INTO discount_codes (id,code,type,value,max_uses,uses_count,per_phone_limit,active) VALUES ('dc-free','FREE100','percentage',100,NULL,0,NULL,1)");
      q("INSERT INTO membership_tiers (id,name,discount_type,discount_value,hours_per_day,active) VALUES ('t-free','Free Hours','free_hours',0,4,1)");
      q("INSERT INTO members (id,tier_id,name,phone,email,pin,status) VALUES ('m-free','t-free','Mo Member','+15550100911','mo@started.example','4711','active')");
      ${pend('ss-late', 'ss-s1', 'pi_late', 2)}
      ${pend('ss-intime', 'ss-s2', 'pi_intime', 2)}
      ${pend('ss-noread', 'ss-s3', 'pi_noread', 2)}
      ${pend('ss-rfail', 'ss-s4', 'pi_rfail', 2)}
      ${pend('ss-sweep', 'ss-s5', 'pi_sweep', 30)}
      ${pend('ss-sweepok', 'ss-s6', 'pi_sweepok', 30)}
      ${away('ss-away', 'ss-s9', 'pi_away', 'pending_payment', 20)}
      ${away('ss-sold', 'ss-s9', '', 'active', 5)}
      ${away('ss-awayok', 'ss-s10', 'pi_awayok', 'pending_payment', 20)}
      ${away('ss-swept', 'ss-s11', 'pi_swept', 'pending_payment', 20)}
      ${away('ss-sold2', 'ss-s11', '', 'active', 5)}
      ${away('ss-twice', 'ss-s8', 'pi_twice', 'pending_payment', 2)}
      q("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,stripe_payment_intent,sms_consent,created_at,updated_at) VALUES ('ss-over','ss-s7','ss-s7','Rae ss-over','+15550100907','ss-over@started.example','${overS.date}','${overS.time}','${overE.time}','${overE.date}',60,5000,'pending_payment','pi_over',1,datetime('now','-100 minutes'),datetime('now','-100 minutes'))");
      await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
    ok('stage: a 100% code, a member on free hours, and six checkouts whose sessions began ten minutes ago and one whose session has ended - seeded by a process that then exited', seed.status === 0, (seed.stderr || '').slice(-400));
    const st = Math.floor(startMs(tenAgo) / 1000);
    chargeAt.ch_late = st + 240;          // paid four minutes after the start
    chargeAt.ch_intime = st - 300;        // paid five minutes BEFORE the start; the confirm came late
    /* ch_noread: no entry - the charge read fails */
    chargeAt.ch_rfail = st + 60; refuseRefund.add('ch_rfail');
    chargeAt.ch_sweep = st + 120;
    chargeAt.ch_sweepok = st - 120;
    chargeAt.ch_over = Math.floor(startMs(overS) / 1000) - 300;
    chargeAt.ch_swept = Math.floor(Date.now() / 1000) - 60;
    chargeAt.ch_away = Math.floor(Date.now() / 1000) - 60; chargeAt.ch_awayok = Math.floor(Date.now() / 1000) - 60;   // paid a minute ago, well before the start
    ok('the unit boots', await boot(), out.slice(-300));

    // ── A. create ──
    console.log('── A. create: a started slot is refused on every customer path ──');
    const body = (bay, slot, extra) => Object.assign({ bay_id: bay, date: slot.date, start_time: slot.time, duration_minutes: 60, name: 'Web Customer', phone: '5550931', email: 'web@started.example', sms_consent: false }, extra || {});
    const intents0 = created.length;
    let r = await call('POST', '/api/bookings/create-payment-intent', body('ss-s7', started));
    ok(`A1 paid: the half hour under way (${started.time}) is refused, saying why, and no intent is made`, r.s === 400 && r.d.started === true && /already started/.test(r.d.error || '') && created.length === intents0, { r, intents: created.length - intents0 });
    r = await call('POST', '/api/bookings/create-payment-intent', body('ss-s7', started, { discount_code: 'FREE100' }));
    ok('A2 a 100% code (free) for the started slot: refused', r.s === 400 && r.d.started === true, r);
    r = await call('POST', '/api/bookings/create-payment-intent', body('ss-s8', started, { member_pin: '4711', name: 'Mo Member', phone: '5550911' }));
    ok('A3 a member on free hours for the started slot: refused', r.s === 400 && r.d.started === true, r);
    // THE DISK LAGS THE SERVER (Oct 8 2026: failed once in a loaded suite, passed alone). The server flushes its database
    // after it answers, so a read straight off the disk can come before the refusals are written. Wait until the three
    // refusals ARE on disk - that proves the flush that carried them has landed - and only then count the bookings, so
    // "nothing was written" is read from a disk that has caught up, never from one that has not yet heard.
    let refusals = 0;
    for (let i = 0; i < 40; i++) { refusals = log().filter(([e, d]) => e === 'BOOKING_REFUSED' && /already started/.test(d)).length; if (refusals >= 3) break; await sleep(250); }
    ok('A4 ...nothing was written for any of them, and the owner\'s log records each refusal', refusals >= 3 && read(`SELECT COUNT(*) FROM bookings WHERE date='${started.date}' AND start_time='${started.time}'`)[0][0] === 0, { refusals });
    r = await call('POST', '/api/bookings/create-payment-intent', body('ss-s7', later));
    ok(`A5 control: the same paid body for ${later.time} still books (an intent is made) - the path is live`, r.s === 200 && !!r.d.clientSecret || (r.s === 200 && created.length === intents0 + 1), { s: r.s, d: r.d, intents: created.length - intents0 });
    r = await call('POST', '/api/bookings/create-payment-intent', body('ss-s8', later, { member_pin: '4711', name: 'Mo Member', phone: '5550911' }));
    ok('A6 control: the member\'s free booking for the later slot still books', r.s === 200 && !!r.d.bookingId, r);

    // ── B. confirm ──
    console.log('\n── B. confirm: a payment that landed after the start ──');
    const refunds0 = refunds.length;
    r = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-late', paymentIntentId: 'pi_late' });
    ok('B1 the old checkout tab paid four minutes after the start: NOT confirmed - 409, started, refunded, and the customer is told so', r.s === 409 && r.d.started === true && r.d.refunded === true && /refunded in full/.test(r.d.error || ''), r);
    ok('B2 ...the refund went to Stripe for that charge, marked as ours', refunds.filter(x => x.charge === 'ch_late').length === 1 && refunds.find(x => x.charge === 'ch_late').owner === 'ba-booking', refunds.slice(refunds0));
    let w = row('ss-late');
    ok('B3 ...the booking is cancelled and its refund recorded (revenue nets it)', w && w.status === 'cancelled' && !!w.refundedAt && w.charge === 'ch_late', w);
    await sleep(800);
    let L = log();
    ok('B4 ...the owner\'s log says what happened (STARTED_SLOT_REFUNDED, from confirm)', L.some(([e, d]) => e === 'STARTED_SLOT_REFUNDED' && /ss-late/.test(d) && /\(confirm\)/.test(d) && /after the session had started/.test(d)), L.slice(-4));
    ok('B5 ...and the customer is told, by email and text', L.some(([e, d]) => e === 'EMAIL_DRYRUN' && /ss-late@started\.example/.test(d) && /could not go ahead/.test(d)) && L.some(([e, d]) => e === 'SMS_DRYRUN' && /\+15550100901/.test(d)), L.filter(([e]) => /DRYRUN/.test(e)).slice(-3));
    r = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-intime', paymentIntentId: 'pi_intime' });
    ok('B6 control: a charge made BEFORE the start whose confirm arrived late is confirmed like any other', r.s === 200 && r.d.success === true && row('ss-intime').status === 'active', r);
    // a customer back from Klarna lands on a FRESH page that has not read the facility's rules: the answer says how they get
    // in (the review, Oct 3 2026 - the page said "about 15 minutes" and, at this staffed facility, promised a door code)
    ok('B6e ...and the answer carries how the customer gets in - this facility is staffed, so no door-code timing is promised', r.d.booking && r.d.booking.staffed === true && r.d.booking.codeTiming === '', r.d.booking);
    ok('B6b ...and the moment it became a booking is written on it (confirmed_at - the reminder reads it, so a checkout paid after its reminder moment is not reminded a minute after its confirmation)', /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(row('ss-intime').confirmedAt), row('ss-intime'));
    // B6c (Oct 3 2026; pilot facility's handoff section 2): a double tap - two confirms for one booking, both waiting on Stripe at once
    // (as the signed-in owner: the route's limit of ten an hour is not what is under test here, and this battery's other
    // calls already spend most of it - a verified owner request skips it; the confirm itself runs the same either way)
    const [t1, t2] = await Promise.all([call('POST', '/api/bookings/confirm', { bookingId: 'ss-twice', paymentIntentId: 'pi_twice' }, owner), call('POST', '/api/bookings/confirm', { bookingId: 'ss-twice', paymentIntentId: 'pi_twice' }, owner)]);
    await sleep(1200);
    { const L9 = log();
      ok('B6c two confirms in flight for one booking: both answer success, and it is activated ONCE - one BOOKING_CONFIRMED, one confirmation text (both used to text, email, print and send the webhook)',
         t1.s === 200 && t2.s === 200 && t1.d.success === true && t2.d.success === true && row('ss-twice').status === 'active'
         && L9.filter(([e, d]) => e === 'BOOKING_CONFIRMED' && /ss-twice/.test(d)).length === 1 && L9.filter(([e, d]) => e === 'SMS_DRYRUN' && /\+15550100898/.test(d)).length === 1,
         { t1: t1.s, t2: t2.s, confirmed: L9.filter(([e, d]) => e === 'BOOKING_CONFIRMED' && /ss-twice/.test(d)).length, texts: L9.filter(([e, d]) => e === 'SMS_DRYRUN' && /\+15550100898/.test(d)).map(([e, d]) => d.slice(0, 60)) }); }
    r = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-noread', paymentIntentId: 'pi_noread' });
    ok('B7 a charge whose time cannot be read, for a started slot: refunded, not kept (OPEN in DECISIONS)', r.s === 409 && r.d.refunded === true && row('ss-noread').status === 'cancelled', r);
    r = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-rfail', paymentIntentId: 'pi_rfail' });
    await sleep(800);
    L = log();
    ok('B8 a refund Stripe refuses: the customer is told it did not go through, the booking cancelled, REFUND NEEDED (manual) logged, the owner texted', r.s === 409 && r.d.refunded === false && /did not go through/.test(r.d.error || '') && row('ss-rfail').status === 'cancelled'
       && L.some(([e, d]) => e === 'REFUND NEEDED (manual)' && /paid after the session had started/.test(d)) && L.some(([e, d]) => e === 'OWNER_ALERT' && /refund-failed:ss-rfail/.test(d)), { r, tail: L.slice(-4) });
    const h = await call('GET', '/api/admin/health?fresh=1', null, owner);
    const co = ((h.d && h.d.signals) || []).find(s => s.key === 'checkout') || {};
    { const r2 = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-rfail', paymentIntentId: 'pi_rfail' });
      ok('B8b the customer reloads the page after the refund was refused: still never told "refunded" - the refusal stands (the stand-in told a second try "already refunded", which the product reads as done)',
         r2.d && r2.d.refunded !== true && !/has been refunded/i.test(r2.d.error || r2.d.message || ''), r2); }
    ok('B9 ...and the Online checkout health line names them until someone refunds', co.level === 'red' && /Rae ss-rfail/.test(co.detail || ''), co);

    // ── E. the slot was sold while the payment was finishing (Oct 3 2026, the pack review) ──
    console.log('\n── E. back from the payment provider\'s page after the hold, the slot sold meanwhile ──');
    const fromE = { 'CF-Connecting-IP': '203.0.113.71' };   // their own phone: B's confirms and A's creates are another caller's
    ok('E0 both were kept waiting by the boot sweep - still on Klarna\'s page, inside the 30 minutes past the hold', row('ss-away').status === 'pending_payment' && row('ss-awayok').status === 'pending_payment', { away: row('ss-away'), ok: row('ss-awayok') });
    onKlarna.clear();   // both finish on Klarna's page; Stripe now says succeeded
    r = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-away', paymentIntentId: 'pi_away' }, fromE);
    ok('E1 the slot was sold to someone else while this payment finished on the provider\'s page: NOT confirmed - 409, taken, refunded, and the customer is told so', r.s === 409 && r.d.taken === true && r.d.refunded === true && /booked by someone else/.test(r.d.error || ''), r);
    w = row('ss-away');
    ok('E2 ...the refund went to Stripe for that charge, marked as ours; the booking is cancelled with its refund recorded; the other group\'s booking is untouched', refunds.filter(x => x.charge === 'ch_away').length === 1 && refunds.find(x => x.charge === 'ch_away').owner === 'ba-booking' && w && w.status === 'cancelled' && !!w.refundedAt && row('ss-sold').status === 'active', { w, sold: row('ss-sold') });
    await sleep(800);
    L = log();
    ok('E3 ...the owner\'s log says what happened (SLOT_TAKEN_REFUNDED, from confirm)', L.some(([e, d]) => e === 'SLOT_TAKEN_REFUNDED' && /ss-away/.test(d) && /\(confirm\)/.test(d)), L.slice(-6));
    r = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-awayok', paymentIntentId: 'pi_awayok' }, fromE);
    ok('E4 control: the same customer away past the hold, the slot still free - confirmed like any other', r.s === 200 && r.d.success === true && row('ss-awayok').status === 'active', r);

    // E5 (Oct 3 2026): a paid checkout the boot sweep already refunded (its slot was sold) - the customer's late confirm
    // is told the truth: refunded. It said "Your card was not charged" (Stripe refused the second refund)
    r = await call('POST', '/api/bookings/confirm', { bookingId: 'ss-swept', paymentIntentId: 'pi_swept' }, fromE);
    ok('E5 a late confirm on a checkout the sweeper already refunded says the charge HAS been refunded - never "your card was not charged" - and nothing is refunded twice', r.s === 409 && r.d.refunded === true && /has been refunded/.test(r.d.error || '') && !/not charged/.test(r.d.error || '') && refunds.filter(x => x.charge === 'ch_swept' || x.pi === 'pi_swept').length <= 2, { r: r.d, refunds: refunds.filter(x => x.charge === 'ch_swept' || x.pi === 'pi_swept') });

    // ── C. the sweeper ──
    console.log('\n── C. the pending-payment sweeper ──');
    await halt();
    const tick = run(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/scheduler').checkBookings();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
    L = log();
    w = row('ss-sweep');
    ok('C1 a lapsed checkout whose payment landed after the start: the sweeper refunds it and cancels the booking', tick.status === 0 && w && w.status === 'cancelled' && !!w.refundedAt && refunds.some(x => x.charge === 'ch_sweep'), { w, err: (tick.stderr || '').slice(-300) });
    ok('C2 ...logged as STARTED_SLOT_REFUNDED from the sweeper, and the customer told', L.some(([e, d]) => e === 'STARTED_SLOT_REFUNDED' && /ss-sweep/.test(d) && /sweeper/.test(d)) && L.some(([e, d]) => e === 'EMAIL_DRYRUN' && /ss-sweep@started\.example/.test(d) && /could not go ahead/.test(d)), L.filter(([e, d]) => /DRYRUN|NOTIFY/.test(e)).map(([e, d]) => e + ' ' + d.slice(0, 90)));
    ok('C3 control: a lapsed checkout that paid BEFORE the start is still restored', row('ss-sweepok').status === 'active', row('ss-sweepok'));
    ok('C4 a lapsed checkout whose session had ENDED is refunded (as before) - and now the customer is actually told: the sweeper\'s list never carried their email or phone', row('ss-over').status === 'expired' && L.some(([e, d]) => e === 'BOOKING_LAPSED_REFUNDED' && /ss-over/.test(d)) && L.some(([e, d]) => e === 'EMAIL_DRYRUN' && /ss-over@started\.example/.test(d) && /could not go ahead/.test(d)) && L.some(([e, d]) => e === 'SMS_DRYRUN' && /\+15550100907/.test(d)),
       { row: row('ss-over'), msgs: L.filter(([e, d]) => /ss-over|15550100907/.test(d)).map(([e, d]) => e + ' ' + d.slice(0, 80)) });

    // ── D. the staff pad and walk-ins ──
    console.log('\n── D. the staff pad and walk-ins may book a started slot, with a warning ──');
    ok('D0 the unit boots again', await boot(), out.slice(-300));
    const sb = await call('POST', '/api/staff/bookings', { bay_id: 'ss-s7', date: started.date, start_time: started.time, duration_minutes: 60, name: 'Walk In', phone: '5550941', email: '', sms_consent: false }, owner);
    const mins = Math.floor((Date.now() - startMs(started)) / 60000);
    ok(`D1 a walk-in for the half hour under way (${started.time}) books, and the reply says plainly how far in it is`, sb.s === 200 && sb.d.success === true && typeof sb.d.startedMinsAgo === 'number' && Math.abs(sb.d.startedMinsAgo - mins) <= 1
       && (sb.d.startedMinsAgo < 1 ? sb.d.warning === 'This session is starting right now.' : new RegExp('^This session started ' + sb.d.startedMinsAgo + ' minutes? ago\\.$').test(sb.d.warning)), sb.d);
    const sb2 = await call('POST', '/api/staff/bookings', { bay_id: 'ss-s3', date: later.date, start_time: later.time, duration_minutes: 60, name: 'Phone Request', phone: '5550942', email: '', sms_consent: false }, owner);
    ok('D2 a staff booking for a later time carries no warning', sb2.s === 200 && !sb2.d.warning && sb2.d.startedMinsAgo === null, sb2.d);
    const pad = fs.readFileSync(path.join(root, 'public', 'staff.html'), 'utf8');
    ok('D3 the pad\'s "Now" is the half hour under way (the server takes only :00 and :30 - the next five minutes was refused)', /var nowSlot = Math\.floor\(nowM \/ 30\) \* 30;/.test(pad) && !/Math\.ceil\(\(nowM \+ 2\) \/ 5\) \* 5/.test(pad));
    ok('D4 ...the form warns before booking ("This session started N minutes ago - it still ends at its usual time") and the toast repeats the server\'s warning', /'Slot is free\. This session started ' \+ ago \+ ' minute'/.test(pad) && /it still ends at its usual time/.test(pad) && /toast\(\(r\.data\.warning \? r\.data\.warning \+ ' ' : ''\)/.test(pad));
  } catch (e) {
    fail++; console.log('FAIL  the battery crashed: ' + (e && e.stack || e));
  } finally {
    await halt();
    stripe.close();
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  console.log(`\nSTARTED SLOT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
