// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-customer-money.js - WHAT A CUSTOMER OR MEMBER HITS ON THE MONEY SIDE OF A BOOKING
//                          (Sep 25 2026, maintainer's Monday pack item 2, from the pilot facility handoff 3 and 6)
//   A  a discount code held by a checkout still in progress counts against its limit (two
//      people paying at once got a one-use code twice), a gift card's balance too; and a code
//      that does not apply STOPS the booking with its reason - it used to be dropped without a
//      word and the full price charged
//   B  an email with capitals finds and cancels its own booking
//   C  the cancel window is the owner's (48 here), not a fixed 24 - on the page and the route
//   D  a start time that cannot be read is never "more than the window away" (NaN) - no refund
//   E  a refund Stripe refuses is said: the customer told the truth, the owner's log, the owner
//      texted, and the Online checkout health line names who is owed
//   F  a phone typed by staff or the owner is stored in one shape and found by its digits
//   A5-A6 (Oct 20 2026): "unlimited per person" stays unlimited; a code's last day works all that day
// The Stripe behind the cancel is a stand-in living in this process (BA_STRIPE_API_BASE, an
// sk_test_ key only); it refuses a refund the way Stripe does (402 with a message).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };
const root = __dirname;
const SRV = 3158, SPORT = 3194, B = 'http://127.0.0.1:' + SRV, PW = 'money-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const at = h => { const t = new Date(Date.now() + h * 3600000); return { date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, time: `${pad(t.getHours())}:00` }; };

// ── the stand-in Stripe ──
let refundMode = 'ok';
const refunds = [];
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/v1/refunds?')) { const ch = new URL('http://x' + req.url).searchParams.get('charge'); return res.end(JSON.stringify({ object: 'list', data: ch === 'ch_already' ? [{ id: 're_dashboard', object: 'refund', amount: 5000, status: 'succeeded', charge: 'ch_already', payment_intent: 'pi_already', created: Math.floor(Date.now() / 1000), metadata: {} }] : [] })); }
    if (req.method === 'GET' && req.url.startsWith('/v1/payment_intents/pi_noread')) { res.statusCode = 500; return res.end(JSON.stringify({ error: { type: 'api_error', message: 'An unknown error occurred' } })); }
    if (req.method === 'GET' && /^\/v1\/payment_intents\/pi_/.test(req.url)) { const id = req.url.split('/')[3].split('?')[0]; return res.end(JSON.stringify({ id, object: 'payment_intent', status: 'succeeded', latest_charge: 'ch_' + id.slice(3) })); }
    if (req.method === 'POST' && req.url.startsWith('/v1/refunds')) {
      refunds.push(b);
      if (refundMode === 'already') { res.statusCode = 400; return res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'charge_already_refunded', message: 'Charge ch_already has already been refunded.' } })); }
      if (refundMode === 'fail') { res.statusCode = 402; return res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'charge_disputed', message: 'Charge ch_x has been charged back; create a dispute response instead.' } })); }
      return res.end(JSON.stringify({ id: 're_' + refunds.length, object: 'refund', status: 'succeeded', amount: 5000, charge: 'ch_x' }));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'stand-in: no route ' + req.method + ' ' + req.url } }));
  });
});

let server = null, out = '';
const read = sql => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { return []; } };
const call = async (method, p, body, headers) => { try { const r = await fetch(B + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); return { s: r.status, d: await r.json().catch(() => ({})) }; } catch (e) { return { s: 0, d: { err: String(e) } }; } };
const owner = { 'x-admin-password': PW };

(async () => {
  try {
    try { if ((await fetch(B + '/api/time')).ok) { console.log('FAIL  port ' + SRV + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    await new Promise(r => stripe.listen(SPORT, '127.0.0.1', r));
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Money Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: SRV, businessName: 'Money Golf', adminPassword: PW, timezone: 'America/Chicago' },
      booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, windowDays: 30 },
      cancellationPolicy: { windowHours: 48 },
      stripe: { secretKey: 'sk_test_money_battery_standin', publishableKey: 'pk_test_money_battery_standin' },
      resend: { apiKey: 're_money_battery', fromEmail: 'desk@money.example', sendConfirmation: false, sendCancellation: false },
      contact: { email: 'owner@money.example' }, alerts: { ownerMobile: '+15550100901' },
      bays: [{ id: 'cm-b1', name: 'Bay One', active: true }], waiver: { mode: 'off' }
    }, null, 2));
    const b72 = at(72), b30 = at(30), b73 = at(73);
    const seed = spawnSync(process.execPath, ['-e', `const db=require('./services/db');db.initDb().then(async()=>{const q=(s,...a)=>db.db.prepare(s).run(...a);
      q("INSERT INTO discount_codes (id,code,type,value,max_uses,uses_count,per_phone_limit,active) VALUES ('dc-one','ONEUSE','fixed',10,1,0,NULL,1)");
      q("INSERT INTO discount_codes (id,code,type,value,max_uses,uses_count,per_phone_limit,active) VALUES ('dc-gift','GIFT50','gift',50,NULL,0,NULL,1)");
      const ins=(id,email,date,time,status,pi,extra)=>q("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,stripe_payment_intent,discount_code_id,discount_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,60,5000,?,?,?,?,datetime('now'),datetime('now'))",id,'cm-b1','Bay One',extra.name||'Pat Capital','+15550333',email,date,time,extra.end||time,date,status,pi,extra.code||null,extra.cents||0);
      ins('cm-hold1','','${b73.date}','${b73.time}','pending_payment','pi_hold1',{name:'Someone Paying',code:'dc-one',cents:1000});
      ins('cm-hold2','','${b73.date}','${b73.time}','pending_payment','pi_hold2',{name:'Someone Else',code:'dc-gift',cents:5000});
      ins('cm-far','Pat.Capital@Example.com','${b72.date}','${b72.time}','active','pi_far',{name:'Pat Owed'});
      ins('cm-already','Pat.Capital@Example.com','${b72.date}','${b72.time}','active','pi_already',{name:'Pat Already'});
      ins('cm-noread','Pat.Capital@Example.com','${b72.date}','${b72.time}','active','pi_noread',{name:'Pat Unread'});
      ins('cm-near','Pat.Capital@Example.com','${b30.date}','${b30.time}','active','pi_near',{});
      ins('cm-nan','Pat.Capital@Example.com','2099-06-01','9:00','active','pi_nan',{end:'10:00'});
      ins('cm-ok','Pat.Capital@Example.com','${b72.date}','${b72.time}','active','pi_ok',{name:'Pat Capital'});
      ins('cm-kept','kept@money.example','${b72.date}','${b72.time}','active','pi_kept',{name:'Pat Kept'});
      q("UPDATE bookings SET stripe_charge_id='ch_kept' WHERE id='cm-kept'");   // paid, its charge read
      // door codes (Oct 4 2026): cm-far's is on the lock but not yet texted (72 h out); cm-ok's was texted
      q("UPDATE bookings SET door_code='482911', sms_code_sent=0 WHERE id='cm-far'");
      q("UPDATE bookings SET door_code='730055', sms_code_sent=1 WHERE id='cm-ok'");
      await db.flushed();process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 });
    ok('stage: a one-use code and a $50 gift card each held by a checkout still paying; four paid bookings under Pat.Capital@Example.com', seed.status === 0, (seed.stderr || '').slice(-300));
    server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { TZ: 'America/Chicago', BA_DISABLE_SCHEDULER: '1', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_STRIPE_API_BASE: 'http://127.0.0.1:' + SPORT, BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
    server.stdout.on('data', d => out += d); server.stderr.on('data', d => out += d);
    let up = false; for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
    ok('the unit boots', up);

    console.log('── A. discount codes ──');
    const fut = at(100);
    let r = await call('POST', '/api/pricing/validate-code', { code: 'ONEUSE', phone: '+15550444', date: fut.date, start_time: fut.time, duration_minutes: 60 });
    ok('A1 a one-use code another customer\'s checkout is holding is refused, saying so - not a second use', r.d.valid === false && /checkout that has not finished/.test(r.d.message || ''), r.d);
    r = await call('POST', '/api/pricing/validate-code', { code: 'GIFT50', phone: '+15550444', date: fut.date, start_time: fut.time, duration_minutes: 60 });
    ok('A2 a gift card whose whole balance a checkout in progress is holding cannot be spent twice', r.d.valid === false && /checkout that has not finished/.test(r.d.message || ''), r.d);
    // (Oct 20 2026, found by the AI branch's money map) the Pricing card's "unlimited per person" was saved as ONE per person,
    // and a code's last day ended the evening before - a bare date was read as UTC midnight, 7 PM the day before in Central
    const own = { 'x-admin-password': PW };
    const todayCt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    r = await call('POST', '/api/pricing/codes', { code: 'MEMBERS10', type: 'percentage', value: 10, per_phone_limit: null }, own);
    const codesNow = await call('GET', '/api/pricing/codes', undefined, own);
    const mem10 = (Array.isArray(codesNow.d) ? codesNow.d : (codesNow.d && codesNow.d.codes) || []).find(c => c.code === 'MEMBERS10') || {};
    ok('A5 a code made unlimited per person stays unlimited (it was saved as one per person)', r.s === 200 && mem10.per_phone_limit === null, mem10);
    r = await call('POST', '/api/pricing/codes', { code: 'LASTDAY', type: 'fixed', value: 5, expires_at: todayCt }, own);
    const last = await call('POST', '/api/pricing/validate-code', { code: 'LASTDAY', phone: '+15550445', date: fut.date, start_time: fut.time, duration_minutes: 60 });
    ok('A6 a code whose last day is today (' + todayCt + ') still works all of today - it died the evening before', r.s === 200 && last.d && last.d.valid === true, last.d);
    const body = code => ({ bay_id: 'cm-b1', date: fut.date, start_time: fut.time, duration_minutes: 60, name: 'Code Customer', phone: '5550444', email: 'code@money.example', discount_code: code, sms_consent: false });
    r = await call('POST', '/api/bookings/create-payment-intent', body('ONEUSE'));
    ok('A3 booking with that code STOPS with its reason - never charged the full price in silence', r.s === 400 && r.d.codeInvalid === true && /checkout that has not finished/.test(r.d.error || ''), r);
    r = await call('POST', '/api/bookings/create-payment-intent', body('NOSUCHCODE'));
    ok('A4 ...and a code that does not exist stops it too, saying so', r.s === 400 && r.d.codeInvalid === true && /Invalid discount code/.test(r.d.error || ''), r);

    console.log('\n── B/C/D. /my-booking ──');
    r = await call('GET', '/api/customer/policy');
    ok('C1 the page is told the owner\'s cancellation window (48), not a fixed 24', r.d.cancelWindowHours === 48, r.d);
    const page = fs.readFileSync(path.join(root, 'public', 'my-booking.html'), 'utf8');
    ok('C2 ...and the page writes that number wherever it states the window', (page.match(/class="cancelWindow"/g) || []).length === 2 && /'Within ' \+ CANCEL_WINDOW \+ ' hrs/.test(page) && !/Within 24hrs/.test(page));
    r = await call('POST', '/api/customer/request-pin', { email: 'pat.capital@example.com' });
    await sleep(300);
    const code = ((out.match(/verification code: (\d{6})/g) || []).pop() || '').slice(-6);
    const v = await call('POST', '/api/customer/verify-pin', { email: 'pat.capital@example.com', pin: code });
    const ids = (v.d.bookings || []).map(b => b.id);
    ok('B1 an email booked with capitals (Pat.Capital@Example.com) is found by the same address in lower case', r.s === 200 && !!code && v.s === 200 && ['cm-far', 'cm-near', 'cm-ok'].every(id => ids.includes(id)), { req: r.d, v: v.s, ids });
    const bk = id => (v.d.bookings || []).find(b => b.id === id) || {};
    ok('B2 /my-booking shows a door code only from its text moment - a code on the lock but not yet texted is not handed out (codes go on the lock an hour early and a Home Assistant code works from then); a texted one shows',
       bk('cm-far').door_code === null && bk('cm-ok').door_code === '730055' && !('sms_code_sent' in bk('cm-ok')), { far: bk('cm-far').door_code, ok: bk('cm-ok').door_code });
    ok('C3 a booking 72 hours away can be cancelled; one 30 hours away cannot (48-hour window) - though it is outside 24', bk('cm-far').cancellable === true && bk('cm-near').cancellable === false && v.d.cancelWindowHours === 48, { far: bk('cm-far').cancellable, near: bk('cm-near').cancellable });
    const cancel = id => call('POST', '/api/customer/cancel', { email: 'pat.capital@example.com', pin: code, bookingId: id });
    r = await cancel('cm-near');
    ok('C4 cancelling the one 30 hours away is refused, naming the owner\'s 48 hours', r.s === 403 && /48 hours/.test(r.d.error || ''), r);
    const refundsBefore = refunds.length;
    r = await cancel('cm-nan');
    ok('D1 a booking whose start time cannot be read is NOT cancelled and refunded (NaN is not "more than 48 hours away")', r.s === 403 && refunds.length === refundsBefore, { r, refunds: refunds.length - refundsBefore });

    console.log('\n── E. a refund Stripe refuses ──');
    refundMode = 'fail';
    r = await cancel('cm-far');
    ok('E1 the customer is told the truth: cancelled, the refund did not go through, the facility has been told', r.s === 200 && r.d.refunded === false && r.d.refundFailed === true && /did not go through/.test(r.d.message || ''), r.d);
    refundMode = 'ok';
    r = await cancel('cm-ok');
    ok('E2 a refund Stripe accepts still says so', r.s === 200 && r.d.refunded === true && /refund has been issued/.test(r.d.message || ''), r.d);
    // the owner refunded in Stripe's dashboard first, then the customer cancelled here (the build review)
    refundMode = 'already';
    r = await cancel('cm-already');
    ok('E5 a payment the owner already refunded in Stripe: the customer is told it HAS been refunded - not that the facility "will refund you"', r.s === 200 && r.d.refunded === true && r.d.refundFailed === false && /already been refunded/.test(r.d.message || ''), r.d);
    refundMode = 'ok';
    // Stripe did not answer when the payment was looked up, so its charge was never read onto the row
    r = await cancel('cm-noread');
    ok('E6 Stripe fails when the payment is looked up: the customer is told the refund did not go through', r.s === 200 && r.d.refundFailed === true, r.d);
    const h = await call('GET', '/api/admin/health?fresh=1', undefined, owner);
    const co = (h.d.signals || []).find(s => s.key === 'checkout') || {};
    ok('E3 the Online checkout health line is RED and names who is owed - the refused refund AND the one whose charge was never read - and not the two paid back', co.level === 'red' && /Pat Owed/.test(co.detail || '') && /Pat Unread/.test(co.detail || '') && !/Pat Already|Pat Capital/.test(co.detail || ''), co);
    // E7 (Oct 3 2026, the pack review): the owner cancels a paid booking and CHOOSES "No refund" (inside their policy) -
    // the money was kept on purpose and counts as revenue (rule 38); the line must not tell them to refund it
    r = await call('POST', '/api/admin/booking/cancel/cm-kept', { refund_type: 'none', reason: 'late cancel, policy' }, owner);
    const h7 = await call('GET', '/api/admin/health?fresh=1', undefined, owner);
    const co7 = (h7.d.signals || []).find(s => s.key === 'checkout') || {};
    ok('E7 a cancel where the owner chose "No refund" (money kept by policy) is NOT named as owed on the Online checkout line - the refused refunds still are', r.s === 200 && !/Pat Kept/.test(co7.detail || '') && /Pat Owed/.test(co7.detail || ''), { cancel: r.d, co: co7 });
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    if (server) { server.kill('SIGINT'); await new Promise(r => { server.on('exit', r); setTimeout(r, 5000); }); server = null; }
  }
  try {
    const log = read("SELECT event, detail FROM admin_log WHERE event IN ('CUSTOMER_REFUND_FAILED','OWNER_ALERT')");
    const kept = read("SELECT detail FROM admin_log WHERE event='ADMIN_CANCEL' AND detail LIKE '%cm-kept%'").map(x => x[0]);
    ok('E7b ...and the owner\'s log records the decision, not a failure: "Refund: No refund" with no FAILED beside it', kept.length === 1 && /Refund: No refund/.test(kept[0]) && !/FAILED/.test(kept[0]), kept);
    ok('E4b ...and nobody was told to refund money already returned: no failure logged, no alert, for the payment refunded in Stripe', !log.some(([e, d]) => /cm-already/.test(d)), log.filter(([e, d]) => /cm-already/.test(d)));
    ok('E4 ...the owner\'s log names the refund Stripe refused, and the owner was texted and emailed', log.some(([e, d]) => e === 'CUSTOMER_REFUND_FAILED' && /cm-far/.test(d) && /charged back/.test(d)) && log.some(([e, d]) => e === 'OWNER_ALERT' && /refund-failed:cm-far/.test(d) && /text: sent/.test(d) && /email: sent/.test(d)), log);

    console.log('\n── F. phones typed by people ──');
    const f = spawnSync(process.execPath, ['-e', `const db=require('./services/db');db.initDb().then(async()=>{const c=require('./services/checkin');const t=new Date(Date.now()+5*86400000);const p=n=>String(n).padStart(2,'0');
      const r=c.staffCreateBooking({bay_id:'cm-b1',date:t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate()),start_time:'14:00',duration_minutes:60,name:'Walk In',phone:'(555) 070-1234',email:'',sms_consent:false,employee:'battery'});
      await db.flushed();console.log('WALKIN '+JSON.stringify(r));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 });
    const walk = read("SELECT phone FROM bookings WHERE name='Walk In'");
    ok('F1 a walk-in typed as (555) 070-1234 is stored as +15550701234 - the shape every lookup and text uses', walk.length === 1 && walk[0][0] === '+15550701234', { walk, out: (f.stdout || '').slice(-200) + (f.stderr || '').slice(-200) });
    server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: Object.assign({}, process.env, { TZ: 'America/Chicago', BA_DISABLE_SCHEDULER: '1', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
    for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(B + '/api/time')).ok) break; } catch {} }
    const tier = await call('POST', '/api/members/tiers', { name: 'Phone Tier', discount_type: 'percentage', discount_value: 0 }, owner);
    const tierId = tier.d.id || (read("SELECT id FROM membership_tiers LIMIT 1")[0] || [])[0];
    const mem = await call('POST', '/api/members', { name: 'Typed Member', phone: '555-070-5678', tier_id: tierId }, owner);
    const s1 = await call('GET', '/api/admin/bookings?search=' + encodeURIComponent('555-070-1234'), undefined, owner);
    const s2 = await call('GET', '/api/admin/bookings?search=5550701234', undefined, owner);
    const s3 = await call('GET', '/api/admin/bookings?search=5559990000', undefined, owner);
    const found = s => JSON.stringify(s.d).includes('Walk In');
    const m1 = await call('GET', '/api/members?search=' + encodeURIComponent('555-070-5678'), undefined, owner);
    const m2 = await call('GET', '/api/members?search=' + encodeURIComponent('(555) 070-5678'), undefined, owner);
    const mFound = r => JSON.stringify(r.d).includes('Typed Member');
    ok('F2 the owner finds that walk-in by the number however it is typed - with dashes, or digits alone - and a different number does not find it', s1.s === 200 && found(s1) && found(s2) && !found(s3), { s1: JSON.stringify(s1.d).slice(0, 120), s2: JSON.stringify(s2.d).slice(0, 120), s3: found(s3) });
    ok('F2b ...and the owner finds that MEMBER by the number as they typed it (the build review: stored as +1 and ten digits, "555-070-5678" found no one)', m1.s === 200 && mFound(m1) && mFound(m2), { m1: JSON.stringify(m1.d).slice(0, 160), m2: mFound(m2) });
    if (server) { server.kill('SIGINT'); await new Promise(r => { server.on('exit', r); setTimeout(r, 5000); }); server = null; }
    const mp = read("SELECT phone FROM members WHERE name='Typed Member'");
    ok('F3 a member the owner typed as 555-070-5678 is stored as +15550705678', mem.s === 200 && mp.length === 1 && mp[0][0] === '+15550705678', { mem: mem.d, mp });
  } catch (e) { ok('the battery ran to completion (F)', false, String(e && e.stack || e)); }
  finally {
    if (server) { server.kill('SIGINT'); await new Promise(r => { server.on('exit', r); setTimeout(r, 5000); }); }
    stripe.close();
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  console.log(`\nCUSTOMER MONEY: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
