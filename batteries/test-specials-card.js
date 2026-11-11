// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-specials-card.js - THE SPECIALS & DEALS CARD, IN A REAL BROWSER, AND THE SPECIAL EVERYWHERE IT GOES (Oct 22
// 2026; admin.html #specialsCard)
//
// maintainer: "anything they can ask for build in like a specials screen for specials so that has somewhere to live ... make sure it
// all works together specials, pricing tax colors etc it all needs to work." Batteries drive the API; buttons need a browser
// (testing doctrine). The owner's clicks on the card, read back through the API each time, then the special where it lands:
// the counter's menu, a real order rung up at the counter with its tax, and the website.
//   SC1 a weekly special made on the card: "Taco Tuesday", Tacos at $3, Tuesdays 5 to 9 PM, its words - the card shows the
//       money before it is saved (Tacos $4.00 -> $3.00, tax from the special price); saved through the routes, listed
//   SC2 a one-day deal on a whole part: $1 off every Beer, today only - the counter's menu shows Bud Light and Coors Light at
//       $4 and nothing else; an order rung at the counter charges $4 for the Bud Light with the special on its line, the Wings
//       at $12, and the tax worked from those prices (8% and 7%); the website's weekly specials carry both specials
//   SC3 changed from the card (Taco Tuesday to $2.50), turned off (the beer back to $5) and on, and deleted after the card asks
//   SC4 nothing half-made is saved: "Items I pick" with no item ticked says so and saves nothing
//   SC5 the assistant's view of it (?frame=1&view=settings&card=specials) opens the card on Food & Payments
//   SC6 the card with its form open fits a phone (390) and a tablet (768): nothing past the edge
//   SC7 every control in the card has a name a screen reader says (rule 30); no page error
// Browser-only: tools/sweep-plan.js BROWSER_LOCAL, run on the workshop. Same-day idempotent: its own copy of the tree,
// removed at the end.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 700) : '')); } };
const root = __dirname;
const PORT = 3174, CDP = 9374, HOST = 'http://127.0.0.1:' + PORT;
const PW = 'specials-card-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let CHROME = null, udd = null, server = null, work = null;
function chromeUp() {
  const LCH = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
    .map(c => { try { return execFileSync('command', ['-v', c], { shell: '/bin/bash' }).toString().trim(); } catch { return ''; } }).find(Boolean);
  if (!LCH) return false;
  udd = fs.mkdtempSync(path.join(os.homedir(), 'ba-specials-card-chrome-'));   // (the home folder: snap Chromium writes a /tmp profile into its own private /tmp, where this cleanup never reached - 421 left, 20 GB, Oct 23 2026)
  CHROME = spawn(LCH, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=${udd}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  return true;
}
async function connect() {
  for (let i = 0; i < 30; i++) { try { await fetch(`http://127.0.0.1:${CDP}/json/version`); break; } catch { await sleep(500); } }
  const page = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = {}; const exceptions = [], dialogs = [];
  const send = (method, params = {}) => new Promise((r, rej) => { const i = ++id; const t = setTimeout(() => { delete pending[i]; rej(new Error('CDP timeout ' + method)); }, 30000); pending[i] = m => { clearTimeout(t); r(m); }; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 200));
    // a confirm() the card asks: said yes to, and kept (what it asked is part of the proof)
    if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.message); send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); } };
  const ev = expr => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }).then(m => (m.result && m.result.result) ? m.result.result.value : undefined);
  await send('Runtime.enable'); await send('Page.enable');
  return { ev, send, exceptions, dialogs };
}
const until = async (b, expr, ms) => { const end = Date.now() + (ms || 20000); let v; while (Date.now() < end) { v = await b.ev(expr); if (v) return v; await sleep(250); } return v; };
const width = async (b, w, h) => b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h || 900, deviceScaleFactor: 1, mobile: w < 700 });

(async () => {
  const cleanup = () => {
    try { CHROME && CHROME.kill('SIGKILL'); } catch {}
    try { server && server.kill('SIGKILL'); } catch {}
    try { udd && fs.rmSync(udd, { recursive: true, force: true }); } catch {}
    try { work && fs.rmSync(work, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  try {
    try { if ((await fetch(HOST + '/api/time')).ok) { console.log('FAIL  port ' + PORT + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    work = fs.mkdtempSync(path.join(root, '..', 'ba-specials-card-'));
    const unit = path.join(work, 'unit');
    const EXCL = `--exclude=./node_modules --exclude=./backups --exclude=./waivers --exclude='./public/uploads' --exclude=./bookings.db --exclude=./config.json --exclude=./license.json --exclude=./VERSION --exclude='./*.log' --exclude=./.git`;
    execFileSync('bash', ['-c', `mkdir -p ${JSON.stringify(unit)} && cd ${JSON.stringify(root)} && tar ${EXCL} -cf - . | tar -xf - -C ${JSON.stringify(unit)} && cp -al ${JSON.stringify(path.join(root, 'node_modules'))} ${JSON.stringify(path.join(unit, 'node_modules'))}`]);
    fs.writeFileSync(path.join(unit, 'config.json'), JSON.stringify({
      businessName: 'Specials Card Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: PORT, businessName: 'Specials Card Golf', adminPassword: PW, timezone: 'America/Chicago' },
      booking: { pricePerHalfHour: 25, openTime: '09:00', closeTime: '23:59', openDays: [0, 1, 2, 3, 4, 5, 6] }, waiver: { mode: 'off' },
      bays: [{ id: 'sc-b1', name: 'Bay 1', active: true }], updates: { listUrl: '' }
    }, null, 2));
    server = spawn(process.execPath, ['server.js'], { cwd: unit, stdio: 'ignore', env: Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1', BA_WATCHDOG_OFF: '1', BA_UPDATE_LIST_URL: 'off', BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
    let up = false; for (let i = 0; i < 80; i++) { await sleep(300); try { if ((await fetch(HOST + '/api/time')).ok) { up = true; break; } } catch {} }
    if (!up || !chromeUp()) { console.log(`NOT RUN  ${up ? 'no headless browser on this machine' : 'the unit did not boot'}`); console.log('\nSPECIALS CARD: 0 passed, 0 failed  (NOT RUN)'); cleanup(); process.exit(up ? 0 : 1); }

    // the facility's menu and taxes, through the owner's own routes: Beer (drinks, 8%) and Food (7%)
    const AH = { 'x-admin-password': PW, 'Content-Type': 'application/json' };
    const api = async (m, p, body) => { const r = await fetch(HOST + p, { method: m, headers: AH, body: body === undefined ? undefined : JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, ok: r.ok, d }; };
    await api('POST', '/api/pos/tax-codes', { codes: [{ id: 'sim', name: 'Golf', rate: 0 }, { id: 'food', name: 'Prepared food', rate: 7 }, { id: 'beverage', name: 'Beverage', rate: 8 }] });
    const beer = (await api('POST', '/api/pos/menu/category', { name: 'Beer', tax_category: 'beverage', printer_role: 'bar' })).d.id;
    const food = (await api('POST', '/api/pos/menu/category', { name: 'Food', tax_category: 'food', printer_role: 'kitchen', sort: 2 })).d.id;
    const item = async (cat, name, cents, sort) => (await api('POST', '/api/pos/menu/item', { category_id: cat, name, price_cents: cents, sort })).d.id;
    const bud = await item(beer, 'Bud Light', 500, 1), coors = await item(beer, 'Coors Light', 500, 2), tacos = await item(food, 'Tacos', 400, 1), wings = await item(food, 'Wings', 1200, 2);
    const specials = async () => ((await api('GET', '/api/pos/specials')).d || {});
    const menuItem = async (name) => ((((await api('GET', '/api/pos/menu')).d || {}).menu || []).flatMap(c => c.items || []).find(i => i.name === name)) || {};
    const today = (await specials()).now.date;

    const b = await connect();
    await b.send('Page.navigate', { url: HOST + '/admin' });
    await until(b, `document.readyState === 'complete' && typeof login === 'function' && !!document.getElementById('pwInput')`);
    await b.ev(`(async () => { document.getElementById('pwInput').value = ${JSON.stringify(PW)}; await login(); return true; })()`);
    await until(b, `getComputedStyle(document.getElementById('app')).display !== 'none'`);
    // Settings, then Food & Payments, as the owner opens them
    await b.ev(`(() => { const t = [...document.querySelectorAll('nav .tab')].find(x => (x.getAttribute('onclick') || '').indexOf("switchTab('settings'") >= 0); t.click(); return true; })()`);
    await b.ev(`(() => { const t = document.querySelector('#settingsSubnav .subtab[data-sg="pos"]'); t.click(); return true; })()`);
    const empty = await until(b, `!!document.getElementById('specialsCard') && document.getElementById('specialsCard').offsetParent !== null && /No specials yet/.test(document.getElementById('spList').textContent) && (MB.menu || []).length === 2`);
    const click = (sel) => b.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const clickText = (text, within) => b.ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify((within || '#specialsCard') + ' button')})].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!e) return false; e.click(); return true; })()`);
    const setVal = (sel, v) => b.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const tick = (sel, on) => b.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.checked = ${on === false ? 'false' : 'true'}; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const rowOf = (name) => `[...document.querySelectorAll('#spList .spRow')].find(r => r.textContent.indexOf(${JSON.stringify(name)}) >= 0)`;

    // ── SC1 - a weekly special, made on the card; the money shown before it is saved ──
    await clickText('+ Add a special');
    await until(b, `!!document.getElementById('spName')`);
    await setVal('#spName', 'Taco Tuesday');
    await setVal('#spCovers', 'items'); await tick(`#spForm .spItem[value="${tacos}"]`);
    await setVal('#spKind', 'price'); await setVal('#spValue', '3');
    await setVal('#spWhenKind', 'week'); await tick('#spForm .spDay[value="tue"]');
    await setVal('#spFrom', '17:00'); await setVal('#spTo', '21:00'); await setVal('#spWords', '$3 tacos all night');
    const preview1 = await b.ev(`document.getElementById('spPreview').textContent`);
    await click('#spSaveBtn');
    const tt = await (async () => { for (let i = 0; i < 40; i++) { const x = ((await specials()).specials || []).find(s => s.name === 'Taco Tuesday'); if (x) return x; await sleep(250); } return null; })();
    const listed1 = await until(b, `!!${rowOf('Taco Tuesday')} && /Tue/.test(${rowOf('Taco Tuesday')}.textContent) && document.getElementById('spForm').style.display === 'none'`);
    ok('SC1 a weekly special made on the card: Taco Tuesday, Tacos at $3, Tuesdays 5-9 PM, its words, on the website - the money shown before it is saved ("' + preview1 + '"), saved through the routes and listed',
       !!empty && /Tacos \$4\.00 → \$3\.00/.test(preview1 || '') && /Tax is worked out from the special price/.test(preview1 || '')
       && !!tt && tt.days === 'tue' && tt.start_time === '17:00' && tt.end_time === '21:00' && tt.kind === 'price' && tt.value === 300 && tt.item_ids === tacos && Number(tt.show_on_site) === 1 && Number(tt.active) === 1 && tt.words === '$3 tacos all night' && !!listed1,
       { empty, preview1, tt });

    // ── SC2 - $1 off every Beer, today only: the menu, a real order at the counter with its tax, the website ──
    await clickText('+ Add a special');
    await until(b, `!!document.getElementById('spName') && document.getElementById('spName').value === ''`);
    await setVal('#spName', 'Beer Today');
    await setVal('#spCovers', 'parts'); await tick(`#spForm .spPart[value="${beer}"]`);
    await setVal('#spKind', 'off'); await setVal('#spValue', '1');
    await setVal('#spWhenKind', 'date'); await setVal('#spDate', today);
    const preview2 = await b.ev(`document.getElementById('spPreview').textContent`);
    await click('#spSaveBtn');
    const bt = await (async () => { for (let i = 0; i < 40; i++) { const x = ((await specials()).specials || []).find(s => s.name === 'Beer Today'); if (x) return x; await sleep(250); } return null; })();
    const budM = await menuItem('Bud Light'), coorsM = await menuItem('Coors Light'), wingsM = await menuItem('Wings');
    const tab = (await api('POST', '/api/pos/tabs', { label: 'Card check' })).d.tab;
    await api('POST', `/api/pos/tabs/${tab.id}/order`, { lines: [{ item_id: bud }, { item_id: wings }] });
    const rung = (await api('GET', `/api/pos/tabs/${tab.id}`)).d.tab || {};
    const lineOf = (name) => (rung.items || []).filter(i => i.name === name).pop() || {};
    const site = (await api('GET', '/api/website/content')).d || {};
    const onSite = (site.specials || []).map(s => s.title), siteTT = (site.specials || []).find(s => s.title === 'Taco Tuesday') || {}, siteBT = (site.specials || []).find(s => s.title === 'Beer Today') || {};
    ok('SC2 $1 off every Beer, today only, made on the card: Bud Light and Coors Light at $4 on the counter\'s menu and the Wings untouched; rung up at the counter, the Bud Light is $4 with the special on its line, the Wings $12, and the tax worked from those prices ($0.32 at 8% + $0.84 at 7%); the website\'s weekly specials carry both specials',
       /Bud Light \$5\.00 → \$4\.00/.test(preview2 || '') && /Coors Light \$5\.00 → \$4\.00/.test(preview2 || '') && !/Tacos/.test(preview2 || '')
       && !!bt && bt.date === today && !bt.days && bt.kind === 'off' && bt.value === 100 && bt.category_ids === beer && !bt.start_time && !bt.end_time
       && budM.special_price_cents === 400 && coorsM.special_price_cents === 400 && wingsM.special_price_cents === undefined
       && lineOf('Bud Light').unit_price_cents === 400 && /Beer Today/.test(lineOf('Bud Light').note || '') && lineOf('Wings').unit_price_cents === 1200
       && rung.subtotal_cents === 1600 && rung.tax_cents === 116 && onSite.includes('Taco Tuesday') && onSite.includes('Beer Today')
       && siteTT.text === '$3 tacos all night' && siteTT.price === '$3' && siteTT.days === 'tue' && siteBT.price === '$1 off' && siteBT.date === today && /every Beer/.test(siteBT.text || ''),
       { preview2, bt, bud: budM.special_price_cents, coors: coorsM.special_price_cents, wings: wingsM.special_price_cents, lines: (rung.items || []).map(i => [i.name, i.unit_price_cents, i.note]), sub: rung.subtotal_cents, tax: rung.tax_cents, site: site.specials });

    // ── SC3 - changed, turned off and on, deleted after the card asks ──
    await b.ev(`(() => { const r = ${rowOf('Taco Tuesday')}; [...r.querySelectorAll('button')].find(x => x.textContent.trim() === 'Edit').click(); return true; })()`);
    const prefilled = await until(b, `document.getElementById('spName') && document.getElementById('spName').value === 'Taco Tuesday' && document.querySelector('#spForm .spItem[value="${tacos}"]').checked && document.querySelector('#spForm .spDay[value="tue"]').checked && document.getElementById('spFrom').value === '17:00' && document.getElementById('spValue').value === '3.00'`);
    await setVal('#spValue', '2.50'); await click('#spSaveBtn');
    const tt2 = await (async () => { for (let i = 0; i < 40; i++) { const x = ((await specials()).specials || []).find(s => s.name === 'Taco Tuesday'); if (x && x.value === 250) return x; await sleep(250); } return null; })();
    const count2 = ((await specials()).specials || []).length;
    await until(b, `!!${rowOf('Beer Today')}`);
    await b.ev(`(() => { const r = ${rowOf('Beer Today')}; [...r.querySelectorAll('button')].find(x => x.textContent.trim() === 'Turn off').click(); return true; })()`);
    const offRow = await until(b, `!!${rowOf('Beer Today')} && /Off/.test(${rowOf('Beer Today')}.textContent) && [...${rowOf('Beer Today')}.querySelectorAll('button')].some(x => x.textContent.trim() === 'Turn on')`);
    const budOff = (await menuItem('Bud Light')).special_price_cents;
    await b.ev(`(() => { const r = ${rowOf('Beer Today')}; [...r.querySelectorAll('button')].find(x => x.textContent.trim() === 'Turn on').click(); return true; })()`);
    await until(b, `!!${rowOf('Beer Today')} && !/Off/.test(${rowOf('Beer Today')}.querySelector('div').textContent)`);
    const budOn = (await menuItem('Bud Light')).special_price_cents;
    await b.ev(`(() => { const r = ${rowOf('Beer Today')}; [...r.querySelectorAll('button')].find(x => x.textContent.trim() === 'Delete').click(); return true; })()`);
    const gone = await (async () => { for (let i = 0; i < 40; i++) { if (!((await specials()).specials || []).some(s => s.name === 'Beer Today')) return true; await sleep(250); } return false; })();
    const budGone = (await menuItem('Bud Light')).special_price_cents;
    ok('SC3 changed from the card (Taco Tuesday to $2.50, the form filled with what it was), turned off (Bud Light back to $5, the row says Off) and on ($4 again), and deleted after the card asks ("' + (b.dialogs[0] || '') + '") - Bud Light back to $5',
       !!prefilled && !!tt2 && tt2.days === 'tue' && tt2.item_ids === tacos && count2 === 2 && !!offRow && budOff === undefined && budOn === 400
       && /Delete the special "Beer Today"/.test(b.dialogs[0] || '') && gone && budGone === undefined,
       { prefilled, tt2: tt2 && tt2.value, count2, offRow, budOff, budOn, dialogs: b.dialogs, gone, budGone });

    // ── SC4 - nothing half-made is saved ──
    const before4 = ((await specials()).specials || []).length;
    await clickText('+ Add a special');
    await until(b, `!!document.getElementById('spName') && document.getElementById('spName').value === ''`);
    await setVal('#spName', 'Half Made'); await setVal('#spCovers', 'items'); await setVal('#spValue', '2');
    const said4 = await b.ev(`document.getElementById('spPreview').textContent`);
    await click('#spSaveBtn'); await sleep(800);
    const after4 = ((await specials()).specials || []).length;
    ok('SC4 "Items I pick" with no item ticked says so ("' + said4 + '") and saves nothing', /Tick the items it covers/.test(said4 || '') && after4 === before4, { said4, before4, after4 });

    // ── SC6 - the card, form open, on a phone and a tablet ──
    const fits = {};
    for (const w of [390, 768]) {
      await width(b, w); await sleep(400);
      fits[w] = await b.ev(`(() => { const c = document.getElementById('specialsCard'), r = c.getBoundingClientRect(); const over = [...c.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && e.offsetParent !== null).map(e => e.id || e.tagName).slice(0, 5);
        return { page: document.documentElement.scrollWidth <= window.innerWidth + 1, card: r.right <= window.innerWidth + 1, over }; })()`);
    }
    await width(b, 1400, 1000);
    ok('SC6 the card with its form open fits a phone (390) and a tablet (768): nothing past the edge', [390, 768].every(w => fits[w] && fits[w].page && fits[w].card && !fits[w].over.length), fits);

    // ── SC7 - every control has a name a screen reader says (rule 30) ──
    // (the controls counted too: with no card there is nothing to name, and that must not read as every control named)
    const named7 = await b.ev(`(() => { const all = [...document.querySelectorAll('#specialsCard button, #specialsCard input, #specialsCard select')].filter(e => e.offsetParent !== null || e.type === 'checkbox');
      return { n: all.length, unnamed: all.filter(e => { const own = (e.getAttribute('aria-label') || e.textContent || e.value && e.tagName === 'BUTTON' && e.value || '').trim(); const lab = e.closest('label'); return !own && !(lab && lab.textContent.trim()); }).map(e => e.id || e.className || e.tagName) }; })()`) || { n: 0, unnamed: [] };
    await click('#spForm button.btn-ghost');

    // ── SC5 - the assistant's view of it ──
    await b.send('Page.navigate', { url: HOST + '/admin?frame=1&view=settings&card=specials' });
    const framed = await until(b, `!!document.getElementById('specialsCard') && document.getElementById('specialsCard').offsetParent !== null && document.body.classList.contains('inFrame') && /Taco Tuesday/.test(document.getElementById('spList').textContent)`, 20000);
    ok('SC5 the assistant\'s view (?frame=1&view=settings&card=specials) opens the card on Food & Payments, with its specials', !!framed, { framed });
    ok('SC7 every control in the card (' + named7.n + ', its form open) has a name a screen reader says, and no page error', named7.n >= 20 && !named7.unnamed.length && !b.exceptions.length, { named7, errors: b.exceptions });
  } catch (e) {
    ok('the battery ran to the end', false, String(e && e.stack || e).slice(0, 400));
  } finally {
    console.log(`\nSPECIALS CARD: ${pass} passed, ${fail} failed`);
    cleanup();
    process.exit(fail ? 1 : 0);
  }
})();
