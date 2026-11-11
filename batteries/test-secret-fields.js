// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-secret-fields.js - A SAVED SECRET, CLICKED AND RETYPED, IS REALLY REPLACED
//                         (Sep 25 2026, the pilot facility handoff's masked-field bug)
//
// The server sends every saved secret as a mask. The page used to put that mask in
// the field: clicking it left the caret after the mask, a new key was typed ONTO it,
// the server read "unchanged" and kept the old key - and the screen said "Settings
// saved". test-secret-surface proves the server's half (a typed-onto mask is refused);
// this drives the REAL page in a real browser the way an owner does - a mouse click on
// the field, real keystrokes, the page's own Save button - and reads what reached the
// disk. Browser-only (the Pi's chromium renders nothing): tools/sweep-plan.js
// BROWSER_LOCAL, run on the workshop.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 320) : '')); } };
const root = __dirname;
const PORT = 3147, CDP = 9347, HOST = 'http://127.0.0.1:' + PORT;
const PW = 'secret-fields-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const onDisk = () => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

let CHROME = null, udd = null, server = null;
function chromeUp() {
  const LCH = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
    .map(c => { try { return execFileSync('command', ['-v', c], { shell: '/bin/bash' }).toString().trim(); } catch { return ''; } }).find(Boolean);
  if (!LCH) return false;
  udd = fs.mkdtempSync(path.join(os.homedir(), 'ba-secret-fields-chrome-'));   // (the home folder: snap Chromium writes a /tmp profile into its own private /tmp, where this cleanup never reached - 421 left, 20 GB, Oct 23 2026)
  CHROME = spawn(LCH, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=${udd}`, '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
  return true;
}
async function connect() {
  for (let i = 0; i < 30; i++) { try { await fetch(`http://127.0.0.1:${CDP}/json/version`); break; } catch { await sleep(500); } }
  const page = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = {}; const exceptions = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 200)); };
  const send = (method, params = {}) => new Promise((r, rej) => { const i = ++id; const t = setTimeout(() => { delete pending[i]; rej(new Error('CDP timeout ' + method)); }, 30000); pending[i] = m => { clearTimeout(t); r(m); }; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = expr => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }).then(m => (m.result && m.result.result) ? m.result.result.value : undefined);
  await send('Runtime.enable'); await send('Page.enable');
  // a real click - the caret goes where the mouse puts it, which is how the old bug happened
  const click = async sel => {
    const r = await ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const b=el.getBoundingClientRect();return {x:b.left+b.width*0.8,y:b.top+b.height/2};})()`);
    if (!r) return false;
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  };
  const type = text => send('Input.insertText', { text });
  return { ev, send, click, type, exceptions, ws };
}

(async () => {
  try {
    try { if ((await fetch(HOST + '/api/time')).ok) { console.log('FAIL  port ' + PORT + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      businessName: 'Secret Fields Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: PORT, businessName: 'Secret Fields Golf', adminPassword: PW, timezone: 'America/Chicago' },
      booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '09:00', closeTime: '21:00' }, waiver: { mode: 'off' },
      resend: { apiKey: 're_SavedResendKeyAAAA', fromEmail: 'desk@fields.example' },
      bays: [{ id: 'sf-b1', name: 'Bay One', active: true, simulatorPcIp: '10.98.0.3', simulatorWinUser: 'golf', simulatorWinPass: 'SavedWinPassBBBB' }]
    }, null, 2));
    server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' }) });
    let up = false; for (let i = 0; i < 60; i++) { await sleep(300); try { if ((await fetch(HOST + '/api/time')).ok) { up = true; break; } } catch {} }
    if (!up || !chromeUp()) { console.log(`NOT RUN  ${up ? 'no headless browser on this machine' : 'the unit did not boot'}`); console.log('\nSECRET FIELDS: 0 passed, 0 failed  (NOT RUN)'); return; }
    const b = await connect();
    const signIn = async () => {
      await b.send('Page.navigate', { url: HOST + '/admin' }); await sleep(2500);
      await b.ev(`(async()=>{const i=document.getElementById('pwInput');if(!i)return;i.value=${JSON.stringify(PW)};await login();})()`); await sleep(2500);
    };
    const settingsTab = async () => { await b.ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(x=>/'settings'/.test(x.getAttribute('onclick')||''));if(t)t.click();const g=document.querySelector('[data-sg="all"]');if(g)g.click();})()`); await sleep(1200); };

    await signIn(); await settingsTab();
    const before = await b.ev(`(()=>{const el=document.getElementById('cfg_resend_apiKey');return el?{type:el.type,masked:String(el.value).startsWith('__SECRET_UNCHANGED__'),ph:el.placeholder}:null})()`);
    ok('F1 the saved Resend key shows as saved - a password field, holding the mask, its placeholder saying so', !!before && before.type === 'password' && before.masked && /Saved/.test(before.ph), before);
    await b.click('#cfg_resend_apiKey');
    const clicked = await b.ev(`(()=>{const el=document.getElementById('cfg_resend_apiKey');return {value:el.value,active:document.activeElement===el,ph:el.placeholder}})()`);
    ok('F2 a mouse click on it clears it - the new key is typed into an empty field, never onto the mask', clicked && clicked.active && clicked.value === '' && /type the whole new value/.test(clicked.ph), clicked);
    await b.type('re_TypedInTheBrowser99');
    await b.ev(`saveSettings()`); await sleep(2000);
    ok('F3 Save Settings: the key the owner typed is the key on disk', onDisk().resend.apiKey === 're_TypedInTheBrowser99', { onDisk: onDisk().resend.apiKey });

    await signIn(); await settingsTab();
    await b.click('#cfg_resend_apiKey');
    await b.ev(`document.body.click()`); await sleep(300);
    await b.ev(`saveSettings()`); await sleep(2000);
    ok('F4 clicked and left EMPTY, then saved: the saved key is kept, never wiped', onDisk().resend.apiKey === 're_TypedInTheBrowser99', { onDisk: onDisk().resend.apiKey });

    await b.ev(`(()=>{const t=[...document.querySelectorAll('.tab')].find(x=>/'bays'/.test(x.getAttribute('onclick')||''));if(t)t.click();})()`); await sleep(1500);
    const bay = await b.ev(`(()=>{const el=document.querySelector('.bay-win-pass');return el?{type:el.type,masked:String(el.value).startsWith('__SECRET_UNCHANGED__'),ph:el.placeholder}:null})()`);
    ok('F5 the bay PC\'s Windows password is a password field holding the mask, not the password', !!bay && bay.type === 'password' && bay.masked && /Saved/.test(bay.ph), bay);
    await b.click('.bay-win-pass'); await b.type('NewBayPassCCCC');
    await b.ev(`saveBays()`); await sleep(2000);
    ok('F6 clicked, retyped and saved with Save All Bays: the new password is on disk', onDisk().bays[0].simulatorWinPass === 'NewBayPassCCCC', { onDisk: onDisk().bays[0].simulatorWinPass });
    ok('F7 no page error on the way', b.exceptions.length === 0, b.exceptions);
    b.ws.close();
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    if (CHROME) { try { CHROME.kill('SIGKILL'); } catch {} }
    if (server) { server.kill('SIGINT'); await new Promise(r => { server.on('exit', r); setTimeout(r, 4000); }); }
    try { if (udd) fs.rmSync(udd, { recursive: true, force: true }); } catch {}
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  if (pass + fail) console.log(`\nSECRET FIELDS: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
