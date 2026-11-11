// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-gift-paid.js - A PAID GIFT CARD IS ISSUED, ONCE, WHENEVER THE MONEY LANDS (Oct 3 2026; the inventory's critic,
// first written down in the Sep 13 stand-in and catch audit as a MEDIUM and never fixed).
//
// The card was issued only by the gift page's confirm, and only for a payment already 'succeeded'. A gift paid by
// Klarna, Cash App or a bank payment answers 'processing' when the buyer comes back, so the confirm said 400 and the
// page said "you will be refunded" - and nothing ever issued the card, or refunded anyone, once the money landed.
//   G1  a gift checkout is started: the unit keeps its payment id (gift_checkouts), nothing is issued yet
//   G2  the buyer comes back while the payment is still processing: the page is told it is pending - no card, no 400
//   G3  the money lands while nobody is on the page; the unit restarts: the boot's check asks Stripe about that
//       payment and issues the card - in the owner's list, the recipient emailed, GIFTCARD_PAID in the log
//   G4  a second restart and the buyer reloading the page: still ONE card (the page is told it was issued)
//   G5  a checkout nobody paid in a week is closed and never asked about again
//   G6  a gift checkout whose payment was cancelled is closed, no card
//   G7  (the review, Oct 3 2026) a checkout made under the OTHER mode's key (practice in Sandbox, then live) is never asked
//       about with this key; one Stripe no longer has ("similar object exists in live mode") is closed and does NOT
//       turn Taking payments red with STRIPE WRONG MODE; one still waiting for a way to pay a day later is closed
//   G9  (the critic, Oct 3 2026) the gift card's email goes out as HTML (it was the markup itself in a plain-text email),
//       its answer is read: a refusal names the card; a unit with no email says so when nobody saw the code on screen
//   G8  a PAID gift payment this unit did not make (no marker - rule 25) is never issued by the check; one Stripe fails to
//       answer is said once in the owner's log and asked again (GIFTCARD_CHECK_FAILED)
// Rule 22's shape: rows on disk before the server starts, the server restarted twice, state read through the
// unit's own routes; the stand-in Stripe answers as Stripe does (an unknown id is a 404, not a success).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const SRV = 3171, SPORT = 3198, B = 'http://127.0.0.1:' + SRV, PW = 'gift-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENV = Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent', BA_STRIPE_API_BASE: 'http://127.0.0.1:' + SPORT });

// ── the stand-in Stripe: payment intents only, held by id, answering as Stripe does ──
const intents = {};
const gets = {};
const otherMode = new Set(['pi_othermode']);   // Stripe's answer for an id that lives under the other mode's key
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const u = req.url;
    if (req.method === 'POST' && /^\/v1\/payment_intents\/?(\?|$)/.test(u)) {
      const p = new URLSearchParams(b), metadata = {};
      for (const [k, v] of p) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) metadata[m[1]] = v; }
      const id = 'pi_g' + (Object.keys(intents).length + 1);
      intents[id] = { id, object: 'payment_intent', amount: Number(p.get('amount')), currency: 'usd', status: 'requires_payment_method', client_secret: id + '_secret_x', metadata };
      return res.end(JSON.stringify(intents[id]));
    }
    if (req.method === 'GET' && /^\/v1\/payment_intents\/pi_/.test(u)) {
      const id = decodeURIComponent(u.split('/')[3].split('?')[0]);
      gets[id] = (gets[id] || 0) + 1;
      if (id === 'pi_flaky') { res.statusCode = 500; return res.end(JSON.stringify({ error: { type: 'api_error', message: 'stand-in: Stripe had a problem' } })); }
      if (!intents[id]) { res.statusCode = 404; return res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'resource_missing', message: "No such payment_intent: '" + id + "'" + (otherMode.has(id) ? '; a similar object exists in live mode, but a test mode key was used to make this request.' : '') } })); }
      return res.end(JSON.stringify(intents[id]));
    }
    if (req.method === 'GET' && u.startsWith('/v1/refunds')) return res.end(JSON.stringify({ object: 'list', data: [], has_more: false }));
    if (req.method === 'GET' && u.startsWith('/v1/webhook_endpoints')) return res.end(JSON.stringify({ object: 'list', data: [], has_more: false }));
    res.statusCode = 404; res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'stand-in: no route ' + req.method + ' ' + u } }));
  });
});

let server = null;
const start = async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: ENV, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) return true; } catch {} }
  return false;
};
const stop = async () => { if (!server) return; const s = server; server = null; s.kill('SIGINT'); await new Promise(r => { s.on('exit', r); setTimeout(r, 6000); }); };
const call = async (method, p, body, headers) => { try { const r = await fetch(B + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body ? JSON.stringify(body) : undefined }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, d: d || {} }; } catch (e) { return { s: 0, d: { err: e.message } }; } };
const owner = { 'x-admin-password': PW };
const cards = async () => { const r = await call('GET', '/api/gifts/admin/list', null, owner); return Array.isArray(r.d) ? r.d : (r.d.cards || r.d.giftCards || []); };
const logOf = async ev => { const r = await call('GET', '/api/admin/log?per_page=200', null, owner); return ((r.d && r.d.entries) || []).filter(e => e.event === ev); };
const readDisk = sql => { const r = spawnSync(process.execPath, ['-e', `require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const r=d.exec(${JSON.stringify(sql)});console.log(JSON.stringify(r.length?r[0].values:[]));process.exit(0)})`], { cwd: root, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return []; } };

(async () => {
  try {
    try { if ((await fetch(B + '/api/time')).ok) { console.log('FAIL  port ' + SRV + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    await new Promise(r => stripe.listen(SPORT, '127.0.0.1', r));
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Gift Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: SRV, businessName: 'Gift Golf', adminPassword: PW, timezone: 'America/Chicago' },
      booking: { staffedAccess: true, pricePerHalfHour: 25 },
      stripe: { secretKey: 'sk_test_gift_battery_standin', publishableKey: 'pk_test_gift_battery_standin' },
      resend: { apiKey: 're_gift_battery', fromEmail: 'desk@gift.example' },
      bays: [{ id: 'g-b1', name: 'Bay 1', active: true }], waiver: { mode: 'off' }
    }, null, 2));
    // already on disk before the unit starts (rule 22): two gift checkouts from before - one abandoned eight days ago,
    // one whose payment Stripe has since cancelled
    intents.pi_cancelled = { id: 'pi_cancelled', object: 'payment_intent', amount: 2500, status: 'canceled', metadata: { kind: 'gift_card', to_email: 'gone@gift.example' } };
    // G7: abandoned two days ago, still waiting for a way to pay
    // G8: a paid gift payment with no marker of this unit (another system on the same Stripe account - rule 25)
    intents.pi_foreign = { id: 'pi_foreign', object: 'payment_intent', amount: 3000, status: 'succeeded', created: Math.floor(Date.now() / 1000) - 3600, metadata: { kind: 'gift_card', to_email: 'other@gift.example' } };
    intents.pi_abandoned = { id: 'pi_abandoned', object: 'payment_intent', amount: 4000, status: 'requires_payment_method', created: Math.floor(Date.now() / 1000) - 2 * 86400, metadata: { kind: 'gift_card', to_email: 'left@gift.example' } };
    const seed = spawnSync(process.execPath, ['-e', `const db=require('./services/db');db.initDb().then(async()=>{
      db.db.prepare("INSERT INTO gift_checkouts (pi_id,created_at,status) VALUES ('pi_old',datetime('now','-8 days'),'open')").run();
      db.db.prepare("INSERT INTO gift_checkouts (pi_id,created_at,status) VALUES ('pi_cancelled',datetime('now','-1 day'),'open')").run();
      db.db.prepare("INSERT INTO gift_checkouts (pi_id,created_at,status,mode) VALUES ('pi_livemode',datetime('now','-1 day'),'open','live')").run();
      db.db.prepare("INSERT INTO gift_checkouts (pi_id,created_at,status,mode) VALUES ('pi_othermode',datetime('now','-1 day'),'open','test')").run();
      db.db.prepare("INSERT INTO gift_checkouts (pi_id,created_at,status,mode) VALUES ('pi_abandoned',datetime('now','-2 days'),'open','test')").run();
      db.db.prepare("INSERT INTO gift_checkouts (pi_id,created_at,status,mode) VALUES ('pi_foreign',datetime('now','-1 hour'),'open','test')").run();
      db.db.prepare("INSERT INTO gift_checkouts (pi_id,created_at,status,mode) VALUES ('pi_flaky',datetime('now','-1 hour'),'open','test')").run();
      await db.flushed();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`], { cwd: root, env: ENV, encoding: 'utf8', timeout: 60000 });
    ok('stage: seven old gift checkouts on disk before the unit starts', seed.status === 0, (seed.stderr || '').slice(-300));

    ok('stage: the unit starts', await start());
    await sleep(1500);
    { const h = await call('GET', '/api/admin/health?fresh=1', null, owner);
      const st = ((h.d && h.d.signals) || []).find(x => x.key === 'stripe') || {};
      ok('G7a the boot\'s check: a payment Stripe has only under the other mode is closed quietly - Taking payments stays green, no STRIPE WRONG MODE (it held the line red for a week after an owner went live)',
         st.level === 'green' && !/WRONG MODE|similar object/i.test(JSON.stringify(st)) && gets.pi_othermode === 1, { st, asked: gets.pi_othermode || 0 }); }
    await sleep(1500);
    // G1
    const co = await call('POST', '/api/gifts/checkout', { amount_cents: 5000, to_email: 'riley@gift.example', from_name: 'Sam', message: 'Happy birthday' });
    const pid = co.d.clientSecret ? co.d.clientSecret.replace(/_secret.*$/, '') : '';
    ok('G1 a gift checkout is started and the unit keeps its payment id - nothing is issued yet', co.s === 200 && !!intents[pid] && intents[pid].metadata.kind === 'gift_card' && (await cards()).length === 0, { co: co.d, pid });
    // G2: the buyer is back from Klarna's page; the payment is still processing
    intents[pid].status = 'processing';
    const c1 = await call('POST', '/api/gifts/confirm', { payment_intent_id: pid });
    ok('G2 back while the payment is still processing: the page is told it is pending - not a 400, not "you will be refunded" - and no card yet', c1.s === 200 && c1.d.pending === true && c1.d.to_email === 'riley@gift.example' && (await cards()).length === 0, c1);
    // ...and the page says so: both its return path and its in-page path show "Payment processing" for a pending answer,
    // never the old "If you were charged you will be refunded automatically" - the page's own pendingDone run on a tiny DOM
    { const html = fs.readFileSync(path.join(root, 'public', 'gift-cards.html'), 'utf8');
      const fn = html.slice(html.indexOf('function pendingDone('), html.indexOf('function finish('));
      const els = { form: { style: {} }, codeOut: { style: {} }, done: { style: {} }, toEmail: { value: '' } }, h1 = { textContent: '' }, para = { textContent: '' };
      const doc = { getElementById: id => els[id] || null, querySelector: q => q === '#done h1' ? h1 : q === '#done p' ? para : null };
      let shown = ''; try { new Function('document', fn + '; pendingDone("riley@gift.example");')(doc); shown = para.textContent; } catch (e) { shown = 'THREW: ' + e.message; }
      ok('G2b the page shows it: "Payment processing", the card to be emailed to riley@gift.example when it goes through - on the return path and the in-page path, never "you will be refunded"',
         /else if \(r && r\.pending\) pendingDone/.test(html) && /else if \(r\.pending\) pendingDone/.test(html) && h1.textContent === 'Payment processing' && /emailed to riley@gift\.example as soon as it goes through/.test(shown) && !/you will be refunded automatically/.test(html), shown); }
    await stop();

    // G3: the money lands while nobody is on the page and the unit is down; it starts again
    intents[pid].status = 'succeeded';
    ok('stage: the unit starts again', await start());
    let list = [];
    for (let i = 0; i < 20 && !list.length; i++) { await sleep(500); list = await cards(); }
    const paid = await logOf('GIFTCARD_PAID');
    const mails = await logOf('EMAIL_DRYRUN');
    ok('G3 the boot\'s check asks Stripe about that payment and issues the card - in the owner\'s list, GIFTCARD_PAID in the log, the recipient emailed',
       list.length === 1 && paid.some(e => e.detail.includes(pid) && /reconcile/.test(e.detail)) && mails.some(e => /riley@gift\.example/.test(e.detail)), { list, paid: paid.map(e => e.detail), mails: mails.map(e => e.detail.slice(0, 80)) });
    await stop();

    // G4: a second restart, and the buyer reloading the page
    ok('stage: a second restart', await start());
    await sleep(2500);
    const c2 = await call('POST', '/api/gifts/confirm', { payment_intent_id: pid });
    list = await cards();
    ok('G4 a second restart and the buyer reloading the page: still ONE card, and the page is told it was issued', list.length === 1 && c2.s === 200 && c2.d.success === true && c2.d.already === true, { n: list.length, c2: c2.d });
    await stop();

    // G5, G6: read on disk once the unit has stopped (it flushes on exit)
    const rows = Object.fromEntries(readDisk("SELECT pi_id, status FROM gift_checkouts"));
    ok('G5 a checkout nobody paid in a week is closed and Stripe is never asked about it', rows.pi_old === 'closed' && !gets.pi_old, { rows, asked: gets.pi_old || 0 });
    ok('G6 a gift checkout whose payment was cancelled is closed, and no card was made for it', rows.pi_cancelled === 'closed' && list.length === 1, rows);
    ok('G3b ...and the paid one is marked issued, so the ten-minute check stops asking', rows[pid] === 'issued', rows);
    ok('G7b a checkout made under the live key is never asked about with the test key, and is left open for that key (closed by the week rule); the other-mode one is closed after one answer',
       rows.pi_livemode === 'open' && !gets.pi_livemode && rows.pi_othermode === 'closed' && gets.pi_othermode === 1, { rows, livemode: gets.pi_livemode || 0, othermode: gets.pi_othermode || 0 });
    { const failedLog = readDisk("SELECT detail FROM admin_log WHERE event='GIFTCARD_CHECK_FAILED' ORDER BY id").map(r => r[0]);
      ok('G8 a PAID gift payment this unit did not make (no marker, rule 25) is never issued - no card, its row left for its own system - and one Stripe failed to answer is said in the owner\'s log, once per check, and stays open to be asked again',
         list.length === 1 && !list.some(c => /other@gift/.test(JSON.stringify(c))) && rows.pi_foreign === 'open' && rows.pi_flaky === 'open' && failedLog.length >= 1 && failedLog.every(d => /^1 gift checkout\(s\) could not be checked/.test(d)), { rows, failedLog, n: list.length }); }
    // G9, in this process once the unit has stopped: a stand-in Resend that records what it is sent and can refuse
    { const MAILP = 3197, sent = []; let refuse = false;
      const mail = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { sent.push(JSON.parse(b)); } catch {} res.setHeader('Content-Type', 'application/json');
        if (refuse) { res.statusCode = 422; return res.end(JSON.stringify({ message: 'stand-in: the recipient address was refused' })); } res.end(JSON.stringify({ id: 'em_' + sent.length })); }); });
      await new Promise(r => mail.listen(MAILP, '127.0.0.1', r));
      process.env.BA_RESEND_API = 'http://127.0.0.1:' + MAILP + '/emails'; delete process.env.EMAIL_DRYRUN;
      const cfgP = path.join(root, 'config.json'), c0 = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
      try {
        const dbx = require('./services/db'); await dbx.initDb();
        const g = require('./services/gifts'), card = { code: 'GIFT-TEST-9876', amountCents: 2500 };
        const r1 = await g.sendGiftEmail(card, { to_email: 'html@gift.example', from_name: 'Sam', message: 'Enjoy' });
        refuse = true; const r2 = await g.sendGiftEmail(card, { to_email: 'refused@gift.example', from_name: 'Sam' }); refuse = false;
        fs.writeFileSync(cfgP, JSON.stringify(Object.assign({}, c0, { resend: {} }), null, 2)); require('./services/config').reloadConfig && require('./services/config').reloadConfig();
        const before = sent.length;
        const r3 = await g.sendGiftEmail(card, { to_email: 'nobody@gift.example' }, { shown: false });
        const r4 = await g.sendGiftEmail(card, { to_email: 'nobody@gift.example' }, { shown: true });
        const logs = dbx.db.prepare(`SELECT event, detail FROM admin_log WHERE event LIKE 'GIFTCARD_%MAIL%' ORDER BY id`).all();
        ok('G9 the gift card\'s email goes out as HTML with the code in it (it was its own markup in a plain-text email); a refusal is read and names the card; a unit with no email says so - only when nobody saw the code on screen',
           r1 === true && sent[0] && typeof sent[0].html === 'string' && !('text' in sent[0]) && sent[0].html.includes('GIFT-TEST-9876')
           && r2 === false && logs.some(l => l.event === 'GIFTCARD_EMAIL_FAILED' && /ending 9876/.test(l.detail))
           && r3 === undefined && r4 === undefined && sent.length === before && logs.filter(l => l.event === 'GIFTCARD_NOT_EMAILED').length === 1,
           { r1, r2, r3, r4, first: sent[0] && Object.keys(sent[0]), logs }); }
      catch (e) { ok('G9 ran', false, String(e && e.stack || e)); }
      finally { fs.writeFileSync(cfgP, JSON.stringify(c0, null, 2)); mail.close(); }
    }
    ok('G7c a checkout still waiting for a way to pay two days later is closed (the buyer left) - no card, asked once', rows.pi_abandoned === 'closed' && gets.pi_abandoned === 1 && list.length === 1, { rows, asked: gets.pi_abandoned || 0 });
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    await stop();
    try { stripe.close(); } catch {}
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  console.log(`\nGIFT PAID: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
