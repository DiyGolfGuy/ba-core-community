// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-sw-cors.js — THE SERVICE WORKER IN FRONT OF STRIPE AND FONTS
//
// Found on a live unit (maintainer, Sep 20 2026): public/sw.js intercepted EVERY GET,
// including cross-origin, and re-issued it with fetch() from inside the worker.
// A worker's fetch runs under connect-src, which is 'self' + api.stripe.com - so
// the SW's own fetch of js.stripe.com/v3/ and fonts.googleapis.com was REFUSED,
// Stripe.js never arrived, every checkout on a controlled page died, and every
// webfont fell back. script-src allowing js.stripe.com is irrelevant once the SW
// is in the path. The moneypages scenario missed it because it ran against the
// bench (http on a LAN) where a service worker CANNOT register - a SW needs a
// secure context. So this battery runs against LOCALHOST, which IS one, with the
// worker actually installed and CONTROLLING the page - the returning customer's
// normal state - and fails on any request CSP refuses or any console error.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); } };
const root = __dirname;
const cfgPath = path.join(root, 'config.json');
const PORT = 3062, CDP = 9341;
const HOST = 'http://localhost:' + PORT;   // localhost = secure context = a SW registers
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CSP_WORDS = /Content Security Policy|Refused to connect|Failed to convert value to 'Response'|violates the following/i;

function writeCfg() {
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'SW Club', setup: { completed: true, eulaAccepted: true },
    booking: { staffedAccess: false, pricePerHalfHour: 20, membersOnly: false, windowDays: 30, openTime: '08:00', closeTime: '23:00' },
    server: { port: PORT, businessName: 'SW Club', adminPassword: 'sw-cors-pw' },
    stripe: { secretKey: 'sk_mock_swcors', publishableKey: 'pk_mock_swcors' },  // the static js.stripe.com tag loads regardless
    waiver: { mode: 'off' },
    bays: [{ id: 'sw-b1', name: 'Bay 1', active: true }]
  }));
}
function seed() {
  execFileSync('node', ['-e', `
    const db = require('${root.replace(/\\/g, '/')}/services/db.js');
    (async()=>{ await db.initDb(); await db.flushed(); process.exit(0); })().catch(e=>{console.error(e.message);process.exit(1);});
  `], { cwd: root, stdio: 'pipe' });
}
async function boot() {
  const child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(HOST + '/api/time')).ok) return { child, log: () => log }; } catch {} }
  return { child: null, log: () => log };
}

// minimal CDP, the browser-proof pattern
let CHROME = null, udd = null;
function chromeUp() {
  const LCH = ['google-chrome','google-chrome-stable','chromium','chromium-browser']
    .map(c => { try { return execFileSync('command', ['-v', c], { shell: '/bin/bash' }).toString().trim(); } catch { return ''; } })
    .find(Boolean);
  if (!LCH) return false;
  udd = fs.mkdtempSync(path.join(os.homedir(), 'ba-sw-cors-'));   // FRESH profile: no stale SW between runs
  CHROME = spawn(LCH, ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${CDP}`,`--user-data-dir=${udd}`,'--window-size=1200,900','about:blank'], { stdio: 'ignore' });
  return true;
}
async function connect() {
  for (let i = 0; i < 30; i++) { try { await fetch(`http://127.0.0.1:${CDP}/json/version`); break; } catch { await sleep(500); } }
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = {}; const consoleErrors = [], exceptions = [], responses = [], logErrors = [], loadFails = [], reqUrls = {};
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
    if (m.method === 'Network.requestWillBeSent') reqUrls[m.params.requestId] = m.params.request && m.params.request.url;
    if (m.method === 'Network.responseReceived') { reqUrls[m.params.requestId] = m.params.response.url; responses.push({ url: m.params.response.url, status: m.params.response.status }); }
    // The service worker is a SEPARATE target: its CSP refusal and its failed
    // fetch of js.stripe.com are logged against IT, not the page. Auto-attach so
    // those land here too (Sep 20 2026 - without this the battery could not see
    // the very refusal it exists to catch).
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      for (const dom of ['Log.enable', 'Network.enable', 'Runtime.enable'])
        ws.send(JSON.stringify({ id: ++id, method: dom, sessionId: sid }));
    }
    // A CSP refusal is NOT a page console.error - the browser logs it itself
    // (Log.entryAdded) and the request dies as Network.loadingFailed
    // (net::ERR_FAILED / blockedReason 'csp'). The v3/:1 net::ERR_FAILED and the
    // "violates the following Content Security Policy directive" the customer saw
    // arrive on these two channels, never on Runtime.consoleAPICalled.
    if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error') logErrors.push(String(m.params.entry.text || '').slice(0, 220));
    if (m.method === 'Network.loadingFailed') loadFails.push({ url: reqUrls[m.params.requestId] || m.params.requestId, reason: m.params.blockedReason || '', err: m.params.errorText || '' });
  };
  const send = (method, params = {}) => new Promise((r, rej) => { const i = ++id; const t = setTimeout(() => { delete pending[i]; rej(new Error('CDP timeout ' + method)); }, 30000); pending[i] = m => { clearTimeout(t); r(m); }; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = expr => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }).then(m => (m.result && m.result.exceptionDetails) ? { __throw: true } : (m.result.result || {}).value);
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const nav = async (p, wait = 3500) => { await send('Page.navigate', { url: HOST + p }); await sleep(wait); };
  const clear = () => { consoleErrors.length = 0; exceptions.length = 0; responses.length = 0; logErrors.length = 0; loadFails.length = 0; };
  return { ev, nav, clear, consoleErrors, exceptions, responses, logErrors, loadFails, ws };
}

(async () => {
  writeCfg();
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  seed();
  if (!chromeUp()) { console.log('NOT RUN  sw-cors: no headless chromium on this machine (apt-get install chromium-browser)'); console.log('\nSW CORS: 0 passed, 0 failed  (NOT RUN)'); process.exit(0); }
  const { child, log } = await boot();
  ok('0 server up on localhost (a secure context - a service worker can register here)', !!child, child ? '' : log().slice(-300));
  if (!child) { try { CHROME.kill(); } catch {} process.exit(1); }
  let b;
  try { b = await connect(); }
  catch (e) { console.log('NOT RUN  sw-cors: could not reach the debug port - ' + e.message); try { child.kill(); CHROME.kill(); } catch {} console.log('\nSW CORS: 0 passed, 0 failed  (NOT RUN)'); process.exit(0); }

  // ── 1. baseline: the FIRST load (SW not yet controlling) proves the network
  //    can reach Stripe and Google at all - so a later failure is OURS, not the
  //    machine's. This first load also registers the worker.
  await b.nav('/book', 4000);
  const stripeFirst = await b.ev("typeof window.Stripe === 'function'");
  if (stripeFirst !== true) {
    console.log('NOT RUN  sw-cors: js.stripe.com did not load even on an UNCONTROLLED first load - this machine cannot reach Stripe, not our bug');
    try { child.kill(); CHROME.kill(); fs.rmSync(udd, { recursive: true, force: true }); } catch {}
    console.log('\nSW CORS: 0 passed, 0 failed  (NOT RUN)'); process.exit(0);
  }
  ok('1 uncontrolled first load reaches js.stripe.com (the network is fine - a later miss is the SW)', stripeFirst === true);

  // ── 2. wait for the worker to TAKE CONTROL - the returning customer's state ──
  let controlled = false;
  for (let i = 0; i < 30; i++) {
    controlled = await b.ev("!!(navigator.serviceWorker && navigator.serviceWorker.controller)");
    if (controlled) break;
    await sleep(500);
  }
  ok('2 the service worker installs and CONTROLS the page (not a skip - this is what a returning customer has)', controlled === true, { controlled });

  // ── 3. a CONTROLLED reload of /book: Stripe.js still arrives, nothing refused ─
  b.clear();
  await b.nav('/book', 4500);
  const ctlNow = await b.ev("!!(navigator.serviceWorker && navigator.serviceWorker.controller)");
  const stripeCtl = await b.ev("typeof window.Stripe === 'function'");
  const xorigin = u => !u.startsWith(HOST) && /^https?:/.test(u);
  const cspLog = b.consoleErrors.concat(b.exceptions).concat(b.logErrors).filter(e => CSP_WORDS.test(e));
  const xFails = b.loadFails.filter(f => xorigin(String(f.url || '')));
  ok('3a the reload is under the worker (controller set)', ctlNow === true, { ctlNow });
  ok('3b /book under the worker LOADS js.stripe.com - the payment library arrives (the whole bug)', stripeCtl === true, { stripeCtl });
  ok('3c NO cross-origin request FAILS to load under the worker (no net::ERR_FAILED on js.stripe.com or fonts)', xFails.length === 0, xFails.slice(0, 4));
  ok('3d nothing logs a CSP violation or "Failed to convert to Response" (browser log + exceptions)', cspLog.length === 0, cspLog.slice(0, 3));
  ok('3d2 no page console error either', b.consoleErrors.length === 0, b.consoleErrors.slice(0, 3));
  const fontOk = b.responses.some(r => /fonts\.googleapis\.com/.test(r.url) && r.status === 200);
  ok('3e the webfont stylesheet actually loaded through the worker (fonts.googleapis.com 200) - Example Owner\'s custom-page fonts', fontOk, b.responses.filter(r => /googleapis|gstatic/.test(r.url)).slice(0, 3));

  // ── 4. gift-cards, same Stripe.js path, still under the worker ──────────────
  b.clear();
  await b.nav('/gift-cards', 4000);
  ok('4a /gift-cards under the worker loads js.stripe.com too (its Elements form can mount)', (await b.ev("typeof window.Stripe === 'function'")) === true);
  ok('4b and no CSP refusal there either', b.consoleErrors.concat(b.exceptions).filter(e => CSP_WORDS.test(e)).length === 0, b.consoleErrors.slice(0, 3));

  // ── 5. the source rule that makes it safe ──────────────────────────────────
  const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  ok('5 sw.js leaves every other origin to the browser (the staff-sw pattern)',
     /if \(url\.origin !== self\.location\.origin\) return;/.test(sw));

  try { child.kill('SIGTERM'); } catch {}
  try { b.ws.close(); CHROME.kill('SIGTERM'); } catch {}
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
  await sleep(500);
  console.log(`\nSW CORS: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL  the battery ran to completion  -> ' + e.message); try { CHROME && CHROME.kill(); } catch {} console.log(`\nSW CORS: ${pass} passed, ${fail + 1} failed`); process.exit(1); });
