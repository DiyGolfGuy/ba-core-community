// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-member-cancel.js - A MEMBERSHIP IS CANCELLED ONLY WHEN ITS BILLING REALLY STOPPED (Oct 3 2026; the Sep 13
// stand-in and catch audit's HIGH, found again by the inventory's critic, never fixed until now).
//
// The owner's Cancel Membership and the nightly grace cancel caught Stripe's refusal, printed it to the console and
// marked the member cancelled anyway - Stripe kept charging a member the unit called cancelled, and the nightly
// reconcile (which walks active members) never looked again.
//   M1  the owner cancels, Stripe refuses: the owner is told, in Stripe's words, that nothing changed and the member
//       is still billed; the member stays active; MEMBER_CANCEL_FAILED in the owner's log
//   M2  the owner cancels a subscription Stripe no longer has: that IS stopped - the member is cancelled
//   M3  control: Stripe accepts - the member is cancelled, MEMBER_CANCELED_ADMIN
//   M4  past its grace, Stripe refuses the grace cancel: the member is NOT ended, MEMBERSHIP_CANCEL_FAILED says why (one
//       line per run - the unit runs this at every boot as well as each night),
//       no "membership ended" email; the next night it is tried again and, accepted, the member ends
//   M5  control: past its grace, Stripe accepts - ended, MEMBERSHIP_ENDED_GRACE
// The stand-in Stripe refuses as Stripe does (an error object with a type and a code); every database touch is its own
// process; the owner's cancel goes through the real server.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const SRV = 3172, SPORT = 3197, B = 'http://127.0.0.1:' + SRV, PW = 'mcancel-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent', BA_STRIPE_API_BASE: 'http://127.0.0.1:' + SPORT });

// ── the stand-in Stripe: subscriptions, refusing as Stripe does ──
const subs = {
  sub_refuse: { status: 'active', refuse: true },
  sub_gone: null,                                   // Stripe no longer has it
  sub_ok: { status: 'active' },
  sub_grace_refuse: { status: 'past_due', refuse: true },
  sub_grace_ok: { status: 'past_due' }
};
const calls = [];
const subJson = (id, s) => ({ id, object: 'subscription', status: s.status, cancel_at_period_end: !!s.cape, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400 * 10 }] } });
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const u = req.url.split('?')[0], m = /^\/v1\/subscriptions\/([^/]+)$/.exec(u);
    calls.push(req.method + ' ' + u);
    const missing = id => { res.statusCode = 404; res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'resource_missing', message: `No such subscription: '${id}'` } })); };
    if (m) {
      const id = decodeURIComponent(m[1]), s = subs[id];
      if (!s) return missing(id);
      if (req.method === 'GET') return res.end(JSON.stringify(subJson(id, s)));
      if (s.refuse) { res.statusCode = 400; return res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'subscription_payment_intent_invalid_parameter', message: 'The subscription could not be canceled right now.' } })); }
      if (req.method === 'DELETE') { s.status = 'canceled'; return res.end(JSON.stringify(subJson(id, s))); }
      if (req.method === 'POST') { s.cape = true; return res.end(JSON.stringify(subJson(id, s))); }
    }
    if (req.method === 'GET' && u.startsWith('/v1/checkout/sessions')) return res.end(JSON.stringify({ object: 'list', data: [], has_more: false }));
    if (req.method === 'GET' && (u.startsWith('/v1/refunds') || u.startsWith('/v1/webhook_endpoints'))) return res.end(JSON.stringify({ object: 'list', data: [], has_more: false }));
    res.statusCode = 404; res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'resource_missing', message: 'stand-in: no route ' + req.method + ' ' + u } }));
  });
});

let server = null;
const start = async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: ENV, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) return true; } catch {} }
  return false;
};
const stop = async () => { if (!server) return; const s = server; server = null; s.kill('SIGINT'); await new Promise(r => { s.on('exit', r); setTimeout(r, 6000); }); };
const call = async (method, p, body) => { try { const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', 'x-admin-password': PW }, body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d: d || {} }; } catch (e) { return { s: 0, d: { err: e.message } }; } };
// async, never spawnSync: the stand-in Stripe lives in THIS process (the project notes, Oct 2 2026)
const runChild = js => new Promise(res => { const ch = spawn(process.execPath, ['-e', js], { cwd: root, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; ch.stdout.on('data', d => o += d); ch.stderr.on('data', d => e += d); ch.on('exit', code => res({ status: code, out: o, err: e })); });
const readDisk = sql => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return []; } };
const member = id => { const r = readDisk(`SELECT status, sub_status FROM members WHERE id='${id}'`)[0]; return r ? { status: r[0], sub: r[1] } : null; };
const logged = (ev, like) => readDisk(`SELECT detail FROM admin_log WHERE event='${ev}' AND detail LIKE '%${like}%'`).map(x => x[0]);
const nightly = () => runChild(`const db=require('./services/db');db.initDb().then(async()=>{await require('./services/membership-lifecycle').runMaintenance();await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);

(async () => {
  try {
    try { if ((await fetch(B + '/api/time')).ok) { console.log('FAIL  port ' + SRV + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    await new Promise(r => stripe.listen(SPORT, '127.0.0.1', r));
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Cancel Club', setup: { completed: true, eulaAccepted: true },
      server: { port: SRV, businessName: 'Cancel Club', adminPassword: PW, timezone: 'America/Chicago' },
      booking: { staffedAccess: true, pricePerHalfHour: 25 },
      stripe: { secretKey: 'sk_test_mcancel_battery_standin', publishableKey: 'pk_test_mcancel_battery_standin' },
      resend: { apiKey: 're_mcancel_battery', fromEmail: 'desk@cancel.example' },
      bays: [{ id: 'mc-b1', name: 'Bay 1', active: true }], waiver: { mode: 'off' }
    }, null, 2));
    const longAgo = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    const row = (id, sub, st) => `q("INSERT INTO members (id,tier_id,name,phone,email,pin,status,stripe_subscription_id,sub_status,past_due_since) VALUES ('${id}','mc-tier','Member ${id}','+1555010${id.length}${id.length}00','${id}@cancel.example','${String(1000 + id.length * 7).slice(0, 4)}','active','${sub}','${st}','${st === 'past_due' ? longAgo : ''}')");`;
    const seed = await runChild(`const db=require('./services/db');db.initDb().then(async()=>{const q=s=>db.db.prepare(s).run();
      q("INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,grace_days) VALUES ('mc-tier','Club','percentage',10,1,14)");
      ${row('mc-refuse', 'sub_refuse', 'active')}
      ${row('mc-gone', 'sub_gone', 'active')}
      ${row('mc-ok', 'sub_ok', 'active')}
      await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
    ok('stage: three billing members on disk before the unit starts', seed.status === 0, (seed.err || '').slice(-300));

    ok('stage: the unit starts', await start());
    let r = await call('POST', '/api/members/mc-refuse/cancel', { mode: 'now' });
    await stop();
    ok('M1 the owner cancels and Stripe refuses: told in Stripe\'s words that nothing changed and the member is still billed; the member stays active; MEMBER_CANCEL_FAILED',
       r.s === 502 && /still billed/.test(r.d.error || '') && /could not be canceled right now/.test(r.d.error || '') && member('mc-refuse').status === 'active' && logged('MEMBER_CANCEL_FAILED', 'mc-refuse').length === 1 && logged('MEMBER_CANCELED_ADMIN', 'mc-refuse').length === 0,
       { r, m: member('mc-refuse') });

    ok('stage: the unit starts again', await start());
    const r2 = await call('POST', '/api/members/mc-gone/cancel', { mode: 'now' });
    const r3 = await call('POST', '/api/members/mc-ok/cancel', { mode: 'now' });
    await stop();
    ok('M2 a subscription Stripe no longer has IS stopped: the member is cancelled', r2.s === 200 && member('mc-gone').status === 'inactive', { r2, m: member('mc-gone') });
    ok('M3 control: Stripe accepts - the member is cancelled and MEMBER_CANCELED_ADMIN is logged', r3.s === 200 && member('mc-ok').status === 'inactive' && logged('MEMBER_CANCELED_ADMIN', 'mc-ok').length === 1, { r3, m: member('mc-ok') });

    // M4, M5: the nightly, each run its own process. The two members past their grace go on disk HERE, after the M1-M3
    // servers (Oct 24 2026): a server's start runs the same maintenance at boot, and on the Pi a stop() could land after Stripe
    // accepted that boot run's grace cancel and before the unit saved it - the nightly then found the member already canceled
    // in Stripe and ended it as "reconcile" (M5 failed 1 run in 3 on the bench; the product's side is in OPEN-AND-PARKED)
    const seed2 = await runChild(`const db=require('./services/db');db.initDb().then(async()=>{const q=s=>db.db.prepare(s).run();
      ${row('mc-grace-refuse', 'sub_grace_refuse', 'past_due')}
      ${row('mc-grace-ok', 'sub_grace_ok', 'past_due')}
      await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
    ok('stage: two more billing members on disk before the nightly runs, twenty days past due on a 14-day grace', seed2.status === 0, (seed2.err || '').slice(-300));
    const n1 = await nightly();
    ok('M4 past its grace, Stripe refuses the grace cancel: the member is NOT ended, MEMBERSHIP_CANCEL_FAILED says why, and no "membership ended" email went out',
       n1.status === 0 && member('mc-grace-refuse').status === 'active' && logged('MEMBERSHIP_CANCEL_FAILED', 'mc-grace-refuse').length >= 1 && logged('MEMBERSHIP_ENDED_GRACE', 'mc-grace-refuse').length === 0
       && !readDisk("SELECT detail FROM admin_log WHERE event='EMAIL_DRYRUN'").some(x => /mc-grace-refuse@/.test(x[0])),
       { m: member('mc-grace-refuse'), err: n1.err.slice(-300) });
    ok('M5 control: past its grace, Stripe accepts - ended, MEMBERSHIP_ENDED_GRACE', member('mc-grace-ok').status === 'inactive' && logged('MEMBERSHIP_ENDED_GRACE', 'mc-grace-ok').length === 1, member('mc-grace-ok'));
    subs.sub_grace_refuse.refuse = false;
    const n2 = await nightly();
    ok('M4b the next night Stripe accepts: the member ends then, once', n2.status === 0 && member('mc-grace-refuse').status === 'inactive' && logged('MEMBERSHIP_ENDED_GRACE', 'mc-grace-refuse').length === 1, member('mc-grace-refuse'));
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    await stop();
    try { stripe.close(); } catch {}
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  console.log(`\nMEMBER CANCEL: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
