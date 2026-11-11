// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-terminal-reconcile.js — A READER PAYMENT IS VERIFIABLE WITHOUT A WEBHOOK
//                              (maintainer, Sep 12 2026)
//
// The webhook was the only thing that turned a reader charge into money. Now,
// while our record still says pending, the scheduler's tick, the boot and the
// pad's own poll ask Stripe for the intent and apply the same idempotent
// finalize or fail the webhook would - so a tab can never be left unpaid or
// paid twice because a webhook did not land. Proven against a stand-in Stripe
// that records every call, with every database touch in its own process
// (rule 22): the rows exist before the code runs, the reconcile runs in a
// FRESH process, the table is read on disk between them.
'use strict';
const fs = require('fs'); const path = require('path'); const http = require('http'); const { spawn } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 360) : '')); } };
const root = __dirname; const PORT = 12447; const BASE = 'http://127.0.0.1:' + PORT; const KEY = 'sk_test_reconcile_battery_fake_key_00';
const cfgPath = path.join(root, 'config.json'), dbPath = path.join(root, 'bookings.db');
// ── the stand-in Stripe ──
const pis = {}; let seq = 0; const calls = [];
const readerState = { id: 'tmr_standin', object: 'terminal.reader', label: 'Counter', device_type: 'bbpos_wisepos_e', status: 'online', metadata: {}, action: null };
let refuseCancel = false; let hangMs = 0;
// Oct 19 2026: Stripe's Locations. A reader is created INTO one - "location (string, required)"
// (docs.stripe.com/api/terminal/readers/create) - and a US Location needs line1, city, state,
// postal_code and country (docs.stripe.com/terminal/fleet/locations-and-zones, Required Address
// Properties). The old stand-in took a reader with no location at all, which is how the Card
// Readers card shipped refusing every reader while this battery stayed green.
const locs = {};
const missingParam = param => ({ error: { type: 'invalid_request_error', code: 'parameter_missing', param, message: `Missing required param: ${param}.` } });
const server = http.createServer((req, res) => { let body = ''; req.on('data', d => body += d); req.on('end', () => {
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const params = Object.fromEntries(new URLSearchParams(body));
  if (p === '/__set') { const j = JSON.parse(body); if (!pis[j.id]) return send(404, { error: 'unknown ' + j.id }); Object.assign(pis[j.id], j.set); return send(200, pis[j.id]); }
  // A-wave 10: a real reader is DOING something, and Stripe can refuse a cancel.
  // The old stand-in had neither, which is why a blind cancel_action and a swallowed
  // refusal both read as success here while they lost money at a counter.
  if (p === '/__reader') { Object.assign(readerState, JSON.parse(body)); return send(200, readerState); }
  if (p === '/__refuse') { refuseCancel = !!JSON.parse(body).on; return send(200, { refuseCancel }); }
  if (p === '/__hang') { hangMs = JSON.parse(body).ms | 0; return send(200, { hangMs }); }   // rule 22: a restart mid-flight needs a flight to be in
  if (p === '/__calls') return send(200, calls);
  if (p === '/__reset') { calls.length = 0; return send(200, {}); }
  calls.push({ method: req.method, path: p, params });
  if (!/^Bearer sk_test_/.test(req.headers.authorization || '')) return send(401, { error: { message: 'no key' } });
  if (req.method === 'POST' && p === '/v1/terminal/readers') {
    if (!params.location) return send(400, missingParam('location'));
    if (!locs[params.location]) return send(400, { error: { type: 'invalid_request_error', code: 'resource_missing', param: 'location', message: `No such location: '${params.location}'` } });
    return send(200, { id: 'tmr_standin', object: 'terminal.reader', label: params.label, device_type: 'bbpos_wisepos_e', status: 'online', location: params.location, metadata: {} });
  }
  if (req.method === 'POST' && p === '/v1/terminal/locations') {
    const need = ['display_name', 'address[line1]', 'address[city]', 'address[state]', 'address[postal_code]', 'address[country]'].find(k => !params[k]);
    if (need) return send(400, missingParam(need));
    const id = 'tml_standin_' + (++seq);
    locs[id] = { id, object: 'terminal.location', display_name: params.display_name,
      address: { line1: params['address[line1]'], city: params['address[city]'], state: params['address[state]'], postal_code: params['address[postal_code]'], country: params['address[country]'] },
      metadata: Object.fromEntries(Object.entries(params).filter(([k]) => /^metadata\[/.test(k)).map(([k, v]) => [k.slice(9, -1), v])) };
    return send(200, locs[id]);
  }
  if (req.method === 'POST' && p === '/v1/payment_intents') { const id = 'pi_standin_' + (++seq); pis[id] = { id, object: 'payment_intent', status: 'requires_payment_method', amount: Number(params.amount), amount_received: 0, metadata: {} }; return send(200, pis[id]); }
  let m;
  if ((m = p.match(/^\/v1\/terminal\/locations\/([^/]+)$/))) {
    if (!locs[m[1]]) return send(404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such location: '${m[1]}'` } });
    if (req.method === 'DELETE') { delete locs[m[1]]; return send(200, { id: m[1], object: 'terminal.location', deleted: true }); }
    return send(200, locs[m[1]]);
  }
  if ((m = p.match(/^\/v1\/terminal\/readers\/([^/]+)\/(process_payment_intent|cancel_action)$/))) { if (m[2] === 'cancel_action') readerState.action = null; return send(200, { id: m[1], action: { type: m[2] } }); }
  if ((m = p.match(/^\/v1\/terminal\/readers\/([^/]+)$/)) && req.method === 'GET') return send(200, readerState);
  if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)\/cancel$/))) { if (!pis[m[1]]) return send(404, { error: { message: 'no such' } }); if (refuseCancel) return send(400, { error: { message: 'You cannot cancel this PaymentIntent because it has a status of processing.' } }); pis[m[1]].status = 'canceled'; return send(200, pis[m[1]]); }
  if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)$/)) && req.method === 'GET') { if (!pis[m[1]]) return send(404, { error: { code: 'resource_missing', message: 'No such payment_intent' } }); if (hangMs) { const id = m[1]; return setTimeout(() => { try { send(200, pis[id]); } catch {} }, hangMs); } return send(200, pis[m[1]]); }
  send(404, { error: { message: 'unknown ' + p } });
}); });
const setPi = (id, set) => fetch(BASE + '/__set', { method: 'POST', body: JSON.stringify({ id, set }) }).then(r => r.json());
const callsOf = () => fetch(BASE + '/__calls').then(r => r.json());
const ENV = Object.assign({}, process.env, { BA_STRIPE_API_BASE: BASE, SMS_DRYRUN: '1', EMAIL_DRYRUN: '1' });
// every database touch in its own process, async (the stand-in lives here)
const oneShot = js => new Promise(resolve => { const c = spawn(process.execPath, ['-e', js], { cwd: root, env: ENV }); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d); const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, 60000); c.on('close', code => { clearTimeout(t); resolve({ code, out }); }); });
const line = (r, tag) => { const l = (r.out || '').split('\n').find(x => x.startsWith(tag + ' ')); try { return l ? JSON.parse(l.slice(tag.length + 1)) : null; } catch { return null; } };
const onDisk = async () => line(await oneShot(`require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const q=s=>{try{const r=d.exec(s);return r.length?r[0].values:[]}catch(e){return e.message}};console.log('DISK '+JSON.stringify({intents:q("SELECT payment_intent,status,COALESCE(error,''),tab_id FROM terminal_intents ORDER BY created_at"),tabs:q("SELECT id,status FROM tabs ORDER BY opened_at"),payments:q("SELECT tab_id,amount_cents,method FROM tab_payments"),log:q("SELECT event,detail FROM admin_log WHERE event LIKE 'TERMINAL_%' ORDER BY id")}));process.exit(0)})`), 'DISK');
const tabDue = async id => line(await oneShot(`const db=require('./services/db');db.initDb().then(()=>{const pos=require('./services/pos');console.log('DUE '+JSON.stringify({due:pos.getTab(${JSON.stringify(id)}).due_cents}));process.exit(0)})`), 'DUE');
// a tab with a beer on it, and a reader collect against it, with the row aged as asked (existing state)
const seedCollect = (label, ageMinutes) => oneShot(`const db=require('./services/db');db.initDb().then(async()=>{const pos=require('./services/pos');pos.ensureSchema();const term=require('./services/terminal');term.ensureSchema();
  if (!term.readers().length) await term.registerReader({ registration_code: 'simulated-wisepos-e', label: 'Counter' });
  const cat=pos.upsertCategory({ name: 'Bar', printer_role: 'bar', tax_category: 'beverage' }); const item=pos.upsertItem({ category_id: cat, name: 'Beer', price_cents: 600 });
  const tab=pos.openTab({ label: ${JSON.stringify(label)}, employee: 'Dana' }); pos.sendOrder(tab.id, [{ item_id: item }], 'Dana'); const due=pos.getTab(tab.id).due_cents;
  const started=await term.collect({ tab_id: tab.id, amount_cents: due, employee: 'Dana' });
  db.db.prepare("UPDATE terminal_intents SET created_at=datetime('now', ?) WHERE payment_intent=?").run('-${ageMinutes} minutes', started.payment_intent);
  db.flushSync(); console.log('SEED '+JSON.stringify({ tab: tab.id, due, pi: started.payment_intent, status: started.status })); process.exit(0)}).catch(e=>{console.log('SEED '+JSON.stringify({err:e.message}));process.exit(1)})`).then(r => line(r, 'SEED'));
const reconcile = () => oneShot(`const db=require('./services/db');db.initDb().then(async()=>{const r=await require('./services/terminal').reconcileWaiting();db.flushSync();console.log('REC '+JSON.stringify(r));process.exit(0)}).catch(e=>{console.log('REC '+JSON.stringify({err:e.message}));process.exit(1)})`).then(r => line(r, 'REC'));
const poll = pi => oneShot(`const db=require('./services/db');db.initDb().then(async()=>{const s=await require('./services/terminal').intentStateLive(${JSON.stringify(pi)});db.flushSync();console.log('POLL '+JSON.stringify(s));process.exit(0)}).catch(e=>{console.log('POLL '+JSON.stringify({err:e.message}));process.exit(1)})`).then(r => line(r, 'POLL'));

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const saved = { cfg: fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath) : null, db: fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null };
  try { fs.unlinkSync(dbPath); } catch {}
  fs.writeFileSync(cfgPath, JSON.stringify({ businessName: 'Reader Reconcile', setup: { completed: true, eulaAccepted: true }, server: { port: 3001, businessName: 'Reader Reconcile', adminPassword: 'rr-pw', staff: [{ name: 'Dana', code: '4321', active: true }] }, booking: { staffedAccess: true }, bays: [{ id: 'b1', name: 'Bay 1', active: true }], stripe: { secretKey: KEY, publishableKey: 'pk_test_x' }, pos: { payments: { cash: true } } }, null, 2));
  try {
    // ── A READER IS REGISTERED TO A LOCATION (Oct 19 2026) ─────────────────────
    // The Card Readers card sends the pairing code and a label and nothing else; Stripe
    // refuses a reader with no location. The unit now makes its own facility Location
    // from the address in Settings, once, marked ours (rule 25), and reuses it.
    const addReader = (extra) => oneShot(`const db=require('./services/db');db.initDb().then(async()=>{const term=require('./services/terminal');term.ensureSchema();
      try { const r=await term.registerReader(Object.assign({ registration_code: 'simulated-wisepos-e', label: 'Counter' }, ${JSON.stringify(extra || {})})); db.flushSync(); console.log('ADD '+JSON.stringify({ ok: r.id })); }
      catch (e) { console.log('ADD '+JSON.stringify({ err: e.message })); } process.exit(0)})`).then(r => line(r, 'ADD'));
    const cfgNow = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const setAddress = (address, seo) => { const c = cfgNow(); c.contact = Object.assign({}, c.contact, { address }); c.seo = Object.assign({}, c.seo, seo); fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2)); };
    const card = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8'), rroute = fs.readFileSync(path.join(root, 'routes', 'terminal.js'), 'utf8');
    ok('L0 the Card Readers card sends ONLY the pairing code and the label, and the route hands that straight to registerReader - so the location has to come from the unit',
       /apiFetch\('\/api\/terminal\/readers', 'POST', \{ registration_code, label \}\)/.test(card) && /term\.registerReader\(req\.body \|\| \{\}\)/.test(rroute));
    await fetch(BASE + '/__reset', { method: 'POST' });
    const l1 = await addReader(); const c1 = await callsOf(); const dl1 = await onDisk();
    ok('L1 with no facility address, the reader is refused in plain words that say where the address goes - and nothing is created at Stripe (no Location, no reader) and nothing stored here',
       l1 && /address/.test(l1.err || '') && /Business & Content/.test(l1.err || '') && /Local Search & SEO/.test(l1.err || '') && !c1.some(c => c.method === 'POST') && !(cfgNow().terminal || {}).locationId && !((cfgNow().terminal || {}).readers || []).length && !dl1.log.some(l => l[0] === 'TERMINAL_READER_ADDED'),
       { l1, calls: c1.map(c => c.method + ' ' + c.path) });
    setAddress('100 Fairway Dr, Suite 5, Minneapolis, MN 55401', { city: 'Minneapolis', state: 'MN', zip: '55401' });
    await fetch(BASE + '/__reset', { method: 'POST' });
    const l2 = await addReader(); const c2 = await callsOf(); const dl2 = await onDisk();
    const made = c2.find(c => c.method === 'POST' && c.path === '/v1/terminal/locations') || { params: {} }; const reg2 = c2.find(c => c.method === 'POST' && c.path === '/v1/terminal/readers') || { params: {} };
    const loc2 = (cfgNow().terminal || {}).locationId;
    ok('L2 with the address filled in (the field\'s own "street, city, state" form), the unit makes its facility Location FIRST - the business name, line1 the street before the city (suite kept), city, state, ZIP, US, marked ba-booking (rule 25) - then registers the reader INTO it',
       l2 && l2.ok === 'tmr_standin' && made.params.display_name === 'Reader Reconcile' && made.params['address[line1]'] === '100 Fairway Dr, Suite 5' && made.params['address[city]'] === 'Minneapolis' && made.params['address[state]'] === 'MN' && made.params['address[postal_code]'] === '55401' && made.params['address[country]'] === 'US' && made.params['metadata[ba_owner]'] === 'ba-booking' && reg2.params.location && reg2.params.location === loc2 && locs[loc2] && c2.findIndex(c => c.path === '/v1/terminal/locations') < c2.findIndex(c => c.path === '/v1/terminal/readers'),
       { l2, made: made.params, reader: reg2.params, loc2 });
    ok('L2b and it is remembered and written down: terminal.locationId on disk, TERMINAL_LOCATION_MADE and TERMINAL_READER_ADDED in the owner\'s log',
       !!loc2 && dl2.log.some(l => l[0] === 'TERMINAL_LOCATION_MADE' && l[1].includes(loc2)) && dl2.log.some(l => l[0] === 'TERMINAL_READER_ADDED'), { loc2, log: dl2.log.map(l => l[0]) });
    await fetch(BASE + '/__reset', { method: 'POST' });
    const l3 = await addReader({ label: 'Bar' }); const c3l = await callsOf();
    ok('L3 a second reader REUSES the facility Location: the unit asks Stripe for it, makes no new one, and the reader goes into the same Location',
       l3 && l3.ok && c3l.some(c => c.method === 'GET' && c.path === '/v1/terminal/locations/' + loc2) && !c3l.some(c => c.method === 'POST' && c.path === '/v1/terminal/locations') && (c3l.find(c => c.path === '/v1/terminal/readers') || { params: {} }).params.location === loc2 && Object.keys(locs).length === 1,
       { l3, calls: c3l.map(c => c.method + ' ' + c.path) });
    await fetch(BASE + '/v1/terminal/locations/' + loc2, { method: 'DELETE', headers: { Authorization: 'Bearer ' + KEY } });
    await fetch(BASE + '/__reset', { method: 'POST' });
    const l4 = await addReader(); const c4l = await callsOf(); const loc4 = (cfgNow().terminal || {}).locationId;
    ok('L4 a Location deleted at Stripe (the owner tidied their dashboard) is made again and the new one remembered - a reader is never refused for a Location that is gone',
       l4 && l4.ok && loc4 && loc4 !== loc2 && locs[loc4] && c4l.some(c => c.method === 'POST' && c.path === '/v1/terminal/locations') && (c4l.find(c => c.path === '/v1/terminal/readers') || { params: {} }).params.location === loc4,
       { l4, loc2, loc4, calls: c4l.map(c => c.method + ' ' + c.path) });
    const given = await fetch(BASE + '/v1/terminal/locations', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ display_name: 'Owner made', 'address[line1]': '1 Battery Way', 'address[city]': 'Minneapolis', 'address[state]': 'MN', 'address[postal_code]': '55401', 'address[country]': 'US' }).toString() }).then(r => r.json());
    await fetch(BASE + '/__reset', { method: 'POST' });
    const l5 = await addReader({ location: given.id }); const c5l = await callsOf();
    ok('L5 a Location the caller names (the money gate\'s battery does) is used exactly as given - nothing looked up, nothing made',
       l5 && l5.ok && (c5l.find(c => c.path === '/v1/terminal/readers') || { params: {} }).params.location === given.id && !c5l.some(c => c.path.startsWith('/v1/terminal/locations')),
       { l5, calls: c5l.map(c => c.method + ' ' + c.path) });

    // 1. the tap that went through, but the webhook never came
    const s1 = await seedCollect('RR paid', 2);
    ok('1 a tab with a balance, a reader collect against it: pending, the tab still unpaid, the intent at the stand-in still waiting (a row two minutes old, as a unit that missed the webhook would hold it)', s1 && s1.status === 'pending' && s1.due === 600 && pis[s1.pi] && pis[s1.pi].status === 'requires_payment_method' && (await tabDue(s1.tab)).due === 600, s1);
    await setPi(s1.pi, { status: 'succeeded', amount_received: 600, amount_details: { tip: { amount: 0 } } });
    const r1 = await reconcile(); const d1 = await onDisk();
    ok('2 a FRESH process runs the reconcile: it asks Stripe for the waiting intent, sees it succeeded, and finalizes exactly as the webhook would - our record succeeded on disk, the tab paid (due 0), one card payment recorded, TERMINAL_PAYMENT_SUCCEEDED and TERMINAL_RECONCILED in the owner\'s log', r1 && r1.checked === 1 && r1.paid === 1 && d1.intents.some(i => i[0] === s1.pi && i[1] === 'succeeded') && (await tabDue(s1.tab)).due === 0 && d1.payments.filter(p => p[0] === s1.tab).length === 1 && d1.log.some(l => l[0] === 'TERMINAL_RECONCILED' && l[1].includes(s1.pi)) && d1.log.some(l => l[0] === 'TERMINAL_PAYMENT_SUCCEEDED' && l[1].includes(s1.pi)), { r1, intents: d1.intents, payments: d1.payments, log: d1.log.map(l => l[0]) });
    const r1b = await reconcile();
    const wh = line(await oneShot(`const db=require('./services/db');db.initDb().then(()=>{const f=require('./services/terminal').finalizePaidIntent({ id: ${JSON.stringify(s1.pi)}, amount_received: 600 });db.flushSync();console.log('WH '+JSON.stringify(f));process.exit(0)})`), 'WH');
    const d1b = await onDisk();
    ok('3 NEVER PAID TWICE: a second reconcile finds nothing waiting, and the webhook arriving late is a replay the finalize ignores - still one payment on the tab', r1b && r1b.checked === 0 && wh && wh.ignored === 'already finalized' && d1b.payments.filter(p => p[0] === s1.tab).length === 1, { r1b, wh, payments: d1b.payments });
    // 2. cancelled at Stripe while we waited
    const s2 = await seedCollect('RR canceled', 2);
    await setPi(s2.pi, { status: 'canceled' });
    const r2 = await reconcile(); const d2 = await onDisk();
    ok('4 an intent cancelled at Stripe (the customer walked, the reader gave up) is FAILED here by the reconcile with the reason, the tab still due - never silently pending forever', r2 && r2.failed === 1 && d2.intents.some(i => i[0] === s2.pi && i[1] === 'failed' && /canceled at Stripe/.test(i[2])) && (await tabDue(s2.tab)).due === 600 && d2.log.some(l => l[0] === 'TERMINAL_PAYMENT_FAILED' && l[1].includes(s2.pi)), { r2, intents: d2.intents.filter(i => i[0] === s2.pi) });
    // 3. nobody ever tapped
    const s3 = await seedCollect('RR forgotten', 40);
    await fetch(BASE + '/__reset', { method: 'POST' });
    await fetch(BASE + '/__reader', { method: 'POST', body: JSON.stringify({ action: { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: s3.pi } } }) });
    const r3 = await reconcile(); const c3 = await callsOf(); const d3 = await onDisk();
    ok('5 a collect that sat forty minutes with no card presented is given up: the reconcile cancels the reader action and the intent at Stripe and fails our record with the reason', r3 && r3.gaveUp === 1 && c3.some(c => /cancel_action$/.test(c.path)) && c3.some(c => c.path === '/v1/payment_intents/' + s3.pi + '/cancel') && d3.intents.some(i => i[0] === s3.pi && i[1] === 'failed' && /no card presented/.test(i[2])) && pis[s3.pi].status === 'canceled', { r3, calls: c3.map(c => c.method + ' ' + c.path), intents: d3.intents.filter(i => i[0] === s3.pi) });
    // 4. the pad's own poll asks Stripe once the tap has waited longer than a tap takes
    const s4 = await seedCollect('RR polled', 2);
    await setPi(s4.pi, { status: 'succeeded', amount_received: 600 });
    await fetch(BASE + '/__reset', { method: 'POST' });
    const p4 = await poll(s4.pi); const c4 = await callsOf(); const d4 = await onDisk();
    ok('6 the pad\'s poll (the state route) on a two-minute-old pending intent asks Stripe itself, applies the payment, and answers SUCCEEDED - the counter never stares at "pending" for money that already landed', p4 && p4.status === 'succeeded' && c4.some(c => c.method === 'GET' && c.path === '/v1/payment_intents/' + s4.pi) && (await tabDue(s4.tab)).due === 0 && d4.payments.filter(p => p[0] === s4.tab).length === 1, { p4, calls: c4.map(c => c.path) });
    // 5. a tap still inside its own seconds is left alone
    const s5 = await seedCollect('RR young', 0);
    await fetch(BASE + '/__reset', { method: 'POST' });
    const r5 = await reconcile(); const p5 = await poll(s5.pi); const c5 = await callsOf();
    ok('7 an intent seconds old is nobody\'s to reconcile yet: the tick skips it and the poll answers pending WITHOUT asking Stripe (the reader is still the first word)', r5 && r5.checked === 0 && p5 && p5.status === 'pending' && !c5.some(c => c.method === 'GET' && c.path === '/v1/payment_intents/' + s5.pi), { r5, p5, calls: c5.map(c => c.path) });
    // 6. mock mode is untouched
    { const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); c.stripe.secretKey = 'sk_mock_terminal'; fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2)); }
    const r6 = await reconcile();
    ok('8 in mock mode (no key, the offline batteries) the reconcile is a no-op', r6 && r6.skipped === 'mock', r6);
    // ── A-WAVE 10: WHAT THE FIRST CUT OF THIS PATH GOT WRONG ─────────────────
    // Every one of these passed the battery above while losing money at a counter.
    { const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); c.stripe.secretKey = KEY; fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2)); }
    // 10. the reader cancel is SCOPED: a give-up must never kill the tap of whoever
    // is standing at the counter right now (cancel_action names no action - it cancels
    // whatever that reader is doing).
    const s10 = await seedCollect('RR other tap', 40);
    await fetch(BASE + '/__reset', { method: 'POST' });
    await fetch(BASE + '/__reader', { method: 'POST', body: JSON.stringify({ action: { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: 'pi_SOMEONE_ELSE' } } }) });
    const r10 = await reconcile(); const c10 = await callsOf(); const d10 = await onDisk();
    const rdr10 = await fetch(BASE + '/v1/terminal/readers/tmr_standin', { headers: { Authorization: 'Bearer ' + KEY } }).then(r => r.json());
    ok('10 the give-up does NOT cancel the reader action when the reader is mid-tap for a DIFFERENT payment - the other customer\'s tap survives, and our own intent is still cancelled and our record still failed',
       r10 && r10.gaveUp === 1 && !c10.some(c => /cancel_action$/.test(c.path)) && rdr10.action && rdr10.action.status === 'in_progress' && pis[s10.pi].status === 'canceled' && d10.intents.some(i => i[0] === s10.pi && i[1] === 'failed'),
       { r10, calls: c10.map(c => c.path), readerAction: rdr10.action && rdr10.action.process_payment_intent });
    // 11. a cancel Stripe REFUSES is never written up as a cancel
    const s11 = await seedCollect('RR refused', 40);
    await fetch(BASE + '/__refuse', { method: 'POST', body: JSON.stringify({ on: true }) });
    await fetch(BASE + '/__reset', { method: 'POST' });
    const r11 = await reconcile(); const d11 = await onDisk();
    await fetch(BASE + '/__refuse', { method: 'POST', body: JSON.stringify({ on: false }) });
    ok('11 when Stripe REFUSES the cancel the payment is NOT written off: our record stays pending (so the next tick tries again), the owner\'s log says the give-up was deferred, and no TERMINAL_PAYMENT_FAILED is written - a tab settled in cash on a false "declined" is a tab paid twice',
       r11 && r11.gaveUp === 0 && d11.intents.some(i => i[0] === s11.pi && i[1] === 'pending') && d11.log.some(l => l[0] === 'TERMINAL_GIVEUP_DEFERRED' && l[1].includes(s11.pi)) && !d11.log.some(l => l[0] === 'TERMINAL_PAYMENT_FAILED' && l[1].includes(s11.pi)),
       { r11, intents: d11.intents.filter(i => i[0] === s11.pi), log: d11.log.filter(l => l[1].includes(s11.pi)).map(l => l[0]) });
    // 12. money in flight is never written off as "nobody tapped"
    const s12 = await seedCollect('RR processing', 40);
    await setPi(s12.pi, { status: 'processing' });
    await fetch(BASE + '/__reset', { method: 'POST' });
    const r12 = await reconcile(); const d12 = await onDisk(); const c12 = await callsOf();
    ok('12 a PROCESSING intent (a card WAS presented, the charge is going through) is never given up: no cancel is attempted on it, our record stays pending, and the next pass can still finalize it',
       r12 && !c12.some(c => c.path === '/v1/payment_intents/' + s12.pi + '/cancel') && d12.intents.some(i => i[0] === s12.pi && i[1] === 'pending') && pis[s12.pi].status === 'processing',
       { r12, calls: c12.map(c => c.path), intents: d12.intents.filter(i => i[0] === s12.pi) });
    await setPi(s12.pi, { status: 'succeeded', amount_received: 600 });
    const r12b = await reconcile();
    ok('12b and when it settles, the same row is finalized - the tab is paid, not left due', r12b && r12b.paid === 1 && (await tabDue(s12.tab)).due === 0, r12b);
    // 13. a DECLINED tap ends. It used to return above the give-up and sit pending for ever.
    const s13 = await seedCollect('RR declined', 40);
    await setPi(s13.pi, { status: 'requires_payment_method', last_payment_error: { message: 'Your card was declined.' } });
    await fetch(BASE + '/__reset', { method: 'POST' });
    const r13 = await reconcile(); const d13 = await onDisk();
    ok('13 a tap the reader declined, forty minutes old, is GIVEN UP - not left "waiting for the customer to tap" all night with the intent open at Stripe',
       r13 && r13.gaveUp === 1 && d13.intents.some(i => i[0] === s13.pi && i[1] === 'failed') && pis[s13.pi].status === 'canceled', { r13, intents: d13.intents.filter(i => i[0] === s13.pi) });
    const s13b = await seedCollect('RR declined young', 2);
    await setPi(s13b.pi, { status: 'requires_payment_method', last_payment_error: { message: 'Your card was declined.' } });
    const r13b = await reconcile(); const d13b = await onDisk();
    ok('13b a decline inside the half hour is REPORTED, not ended - the customer can tap again, and the reason is on our record for the pad to show',
       r13b && r13b.waiting === 1 && d13b.intents.some(i => i[0] === s13b.pi && i[1] === 'pending' && /declined/i.test(i[2])), { r13b, intents: d13b.intents.filter(i => i[0] === s13b.pi) });
    // 14. an intent this account cannot see can never resolve
    const s14 = await seedCollect('RR unknown', 5);
    delete pis[s14.pi];
    const r14 = await reconcile(); const d14 = await onDisk();
    ok('14 an intent Stripe does not know (the facility re-keyed its Stripe account) is FAILED once with a reason a person can act on - not retried in silence every minute for a week and then dropped with the tab still due',
       r14 && r14.failed === 1 && r14.errors === 0 && d14.intents.some(i => i[0] === s14.pi && i[1] === 'failed' && /re-keyed|does not know/i.test(i[2])), { r14, intents: d14.intents.filter(i => i[0] === s14.pi) });
    // 15. the pad may ask, but may never end a payment
    const s15 = await seedCollect('RR pad', 40);
    await fetch(BASE + '/__reset', { method: 'POST' });
    const p15 = await poll(s15.pi); const c15 = await callsOf(); const d15 = await onDisk();
    ok('15 the pad\'s own poll NEVER gives up a payment: a forty-minute-old row polled from the counter screen asks Stripe but sends no cancel and stays pending - a staff screen left open used to be able to kill a live tap',
       p15 && p15.status === 'pending' && c15.some(c => c.method === 'GET' && c.path === '/v1/payment_intents/' + s15.pi) && !c15.some(c => /cancel/.test(c.path)) && d15.intents.some(i => i[0] === s15.pi && i[1] === 'pending'),
       { p15, calls: c15.map(c => c.method + ' ' + c.path) });
    // 16. a charge that could not be applied is said out loud
    const s16 = await seedCollect('RR closed tab', 3);
    const cash16 = line(await oneShot(`const db=require('./services/db');db.initDb().then(()=>{const pos=require('./services/pos');const r=pos.recordPayment(${JSON.stringify(s16.tab)},{method:'cash',amount_cents:600,tendered_cents:600,employee:'Dana'});db.flushSync();console.log('CASH '+JSON.stringify({closed:r.closed,status:pos.getTab(${JSON.stringify(s16.tab)}).status}));process.exit(0)}).catch(e=>{console.log('CASH '+JSON.stringify({err:e.message}));process.exit(0)})`), 'CASH');
    ok('16a staff settle that tab in cash first - it is closed before the card lands', cash16 && cash16.closed === true && cash16.status === 'closed', cash16);
    await setPi(s16.pi, { status: 'succeeded', amount_received: 600 });
    const r16 = await reconcile(); const d16 = await onDisk();
    ok('16 a card that lands on a tab staff already settled in cash is NAMED: TERMINAL_PAYMENT_UNAPPLIED in the owner\'s log with the amount and the tab, and the reconcile counts it - it used to write "payment succeeded" for money that reached no report',
       r16 && r16.unapplied >= 1 && d16.log.some(l => l[0] === 'TERMINAL_PAYMENT_UNAPPLIED' && l[1].includes(s16.pi) && l[1].includes(String(s16.tab))), { r16, log: d16.log.map(l => l[0]) });
    // 17. and the unit says it out loud (rule 23)
    const h17 = line(await oneShot(`const db=require('./services/db');db.initDb().then(()=>{console.log('H '+JSON.stringify(require('./services/terminal').terminalHealth()));process.exit(0)})`), 'H');
    ok('17 rule 23: the unit-health line has a CARD READER signal and it reads red on an unapplied payment - A-wave 8 added this whole money failure mode with nothing watching it',
       h17 && h17.configured === true && h17.unapplied >= 1 && h17.level === 'red', h17);

    // ── A-WAVE 11: RULE 22'S FULL SHAPE (maintainer, Sep 13 2026: "same as the others,
    // no exception"). Existing rows and separate processes were already here; what
    // was missing is a restart MID-FLIGHT, a second restart in a row, a deploy
    // landing while work is queued, and a clock that moved.
    // 18. killed while it is waiting on Stripe
    // every other row is settled first, so the hang below can only be OUR intent -
    // otherwise the kill lands on an earlier pending row and check 18 proves nothing
    await oneShot(`const db=require('./services/db');db.initDb().then(()=>{db.db.prepare("UPDATE terminal_intents SET status='canceled', settled_at=datetime('now') WHERE status='pending'").run();db.flushSync();process.exit(0)})`);
    const s18 = await seedCollect('RR killed', 3);
    const pendingNow = (await onDisk()).intents.filter(i => i[1] === 'pending').map(i => i[0]);
    ok('18a the only payment still waiting is this one, so the kill below is genuinely mid-flight on it', pendingNow.length === 1 && pendingNow[0] === s18.pi, pendingNow);
    await setPi(s18.pi, { status: 'succeeded', amount_received: 600 });
    await fetch(BASE + '/__hang', { method: 'POST', body: JSON.stringify({ ms: 20000 }) });
    const killed = spawn(process.execPath, ['-e', `const db=require('./services/db');db.initDb().then(async()=>{await require('./services/terminal').reconcileWaiting();db.flushSync();process.exit(0)})`], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise(r => setTimeout(r, 2500));
    killed.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 500));
    await fetch(BASE + '/__hang', { method: 'POST', body: JSON.stringify({ ms: 0 }) });
    const d18 = await onDisk();
    ok('18 RULE 22 - killed MID-FLIGHT, with the request to Stripe still open: nothing is half-applied. Our record is still pending, no payment is on the tab, and the owner\'s log carries no success for it',
       d18.intents.some(i => i[0] === s18.pi && i[1] === 'pending') && d18.payments.filter(p => p[0] === s18.tab).length === 0 && !d18.log.some(l => l[0] === 'TERMINAL_PAYMENT_SUCCEEDED' && l[1].includes(s18.pi)),
       { intents: d18.intents.filter(i => i[0] === s18.pi), payments: d18.payments.filter(p => p[0] === s18.tab) });
    // 19. the fresh process after the restart finishes it, exactly once
    const r19 = await reconcile(); const d19 = await onDisk();
    ok('19 RULE 22 - the process that comes up after the kill finishes the job: the tab is paid, once, and the record says succeeded',
       r19 && r19.paid === 1 && (await tabDue(s18.tab)).due === 0 && d19.payments.filter(p => p[0] === s18.tab).length === 1 && d19.intents.some(i => i[0] === s18.pi && i[1] === 'succeeded'), { r19, payments: d19.payments.filter(p => p[0] === s18.tab) });
    // 20. a second restart in a row fires nothing
    const r20a = await reconcile(); const r20b = await reconcile(); const d20 = await onDisk();
    ok('20 RULE 22 - two restarts in a row: the settled row is never looked at again and the tab is still paid exactly ONCE (nothing fires twice)',
       r20a && r20b && d20.payments.filter(p => p[0] === s18.tab).length === 1 && d20.intents.some(i => i[0] === s18.pi && i[1] === 'succeeded') && d20.log.filter(l => l[0] === 'TERMINAL_PAYMENT_SUCCEEDED' && l[1].includes(s18.pi)).length === 1,
       { r20a, r20b, payments: d20.payments.filter(p => p[0] === s18.tab).length });
    // 21. a deploy lands while a collect is queued
    const s21 = await seedCollect('RR deploy', 3);
    await setPi(s21.pi, { status: 'succeeded', amount_received: 600 });
    const ver = await oneShot(`require('./services/version').write({tag:'deploy-mid-flight',commit:'abc1234',drift:99,date:'2026-09-13',source:'tree'});console.log('V ok');process.exit(0)`);
    const r21 = await reconcile(); const d21 = await onDisk();
    ok('21 RULE 22 - a deploy lands (VERSION restamped, the unit comes back) while a reader payment sits queued: the row survives the deploy and the next tick finalizes it',
       /V ok/.test(ver.out || '') && r21 && r21.paid === 1 && (await tabDue(s21.tab)).due === 0 && d21.intents.some(i => i[0] === s21.pi && i[1] === 'succeeded'), { r21 });
    // 22. the clock moved
    const s22 = await seedCollect('RR clockback', 0);
    await oneShot(`const db=require('./services/db');db.initDb().then(()=>{db.db.prepare("UPDATE terminal_intents SET created_at=datetime('now','+45 minutes') WHERE payment_intent=?").run(${JSON.stringify(s22.pi)});db.flushSync();process.exit(0)})`);
    await fetch(BASE + '/__reset', { method: 'POST' });
    const r22 = await reconcile(); const c22 = await callsOf(); const d22 = await onDisk();
    ok('22 RULE 22 - the unit\'s clock was wrong and got corrected BACKWARDS, so a row is stamped in the future: the sweep\'s own window excludes it, nothing is asked of Stripe for it and no cancel is sent - it simply waits until its time is real',
       !c22.some(c => c.path.includes(s22.pi)) && d22.intents.some(i => i[0] === s22.pi && i[1] === 'pending'), { calls: c22.map(c => c.path), intents: d22.intents.filter(i => i[0] === s22.pi) });
    // and the arithmetic itself, driven directly: a negative age is not half an hour old
    const age22 = line(await oneShot(`const db=require('./services/db');db.initDb().then(async()=>{const t=require('./services/terminal');const row=db.db.prepare("SELECT * FROM terminal_intents WHERE payment_intent=?").get(${JSON.stringify(s22.pi)});const r=await t.reconcileIntent(row);db.flushSync();console.log('AGE '+JSON.stringify(r));process.exit(0)})`), 'AGE');
    ok('22b ...and asked about that row directly, the reconcile still refuses to give it up - the give-up branch reads an age, and a future stamp makes that age negative',
       age22 && age22.did !== 'gave-up' && pis[s22.pi].status !== 'canceled', { age22, status: pis[s22.pi] && pis[s22.pi].status });
    const s23 = await seedCollect('RR clockfwd', 0);
    await oneShot(`const db=require('./services/db');db.initDb().then(()=>{db.db.prepare("UPDATE terminal_intents SET created_at=datetime('now','-95 minutes') WHERE payment_intent=?").run(${JSON.stringify(s23.pi)});db.flushSync();process.exit(0)})`);
    const r23 = await reconcile(); const d23 = await onDisk();
    ok('23 RULE 22 - and when the clock jumps FORWARD past the give-up window, the waiting tap is ended properly: cancelled at Stripe and failed here with the reason',
       d23.intents.some(i => i[0] === s23.pi && i[1] === 'failed' && /no card presented/.test(i[2])) && pis[s23.pi].status === 'canceled', { intents: d23.intents.filter(i => i[0] === s23.pi) });

    // 7. the wiring
    const sched = fs.readFileSync(path.join(root, 'services', 'scheduler.js'), 'utf8'), route = fs.readFileSync(path.join(root, 'routes', 'terminal.js'), 'utf8'), term = fs.readFileSync(path.join(root, 'services', 'terminal.js'), 'utf8');
    ok('9 the scheduler\'s minute tick and the boot call the reconcile; the state route answers the live check; the stand-in base is honoured only with an sk_test_ key', /require\('\.\/terminal'\)\.reconcileWaiting\(\)/.test(sched) && (sched.match(/reconcileWaiting\(\)/g) || []).length >= 2 && /intentStateLive\(req\.params\.pi\)/.test(route) && /BA_STRIPE_API_BASE && \/\^sk_test_\/\.test\(stripeKey\(\)\)/.test(term) && /GIVE_UP_AFTER_MS = 30 \* 60 \* 1000/.test(term) && /allowGiveUp/.test(term) && /readerActionIsOurs/.test(term));
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e).slice(0, 400)); }
  finally { server.close(); if (saved.cfg) fs.writeFileSync(cfgPath, saved.cfg); else { try { fs.unlinkSync(cfgPath); } catch {} } if (saved.db) fs.writeFileSync(dbPath, saved.db); else { try { fs.unlinkSync(dbPath); } catch {} } }
  console.log(`\nTERMINAL RECONCILE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
