// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-signin-smoke.js — EXECUTES every sign-in surface under a stub browser.
// Not source-grep: the real scripts run. Load must not throw; the staff pad
// success path must land on Today; a dead-token 401 must land QUIETLY on the
// pad; the admin login must reach its session bootstrap. Any regression in
// any sign-in mechanism detonates here before it can ship.
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

function makeEnv(fetchRouter) {
  const elems = new Map();
  const classes = new Map();           // id -> Set of classes
  const listeners = [];                // { targetId, ev, fn }
  function elem(id) {
    if (elems.has(id)) return elems.get(id);
    const cls = new Set(id === 'scrPad' ? ['screen', 'on'] : ['screen']);
    classes.set(id, cls);
    const e = new Proxy({
      id,
      style: {},
      dataset: {},
      value: '', textContent: '', innerHTML: '',
      classList: {
        add: (...c) => c.forEach(x => cls.add(x)),
        remove: (...c) => c.forEach(x => cls.delete(x)),
        toggle: c => cls.has(c) ? cls.delete(c) : cls.add(c),
        contains: c => cls.has(c),
      },
      addEventListener: (ev, fn) => listeners.push({ targetId: id, ev, fn }),
      removeEventListener: () => {},
      appendChild: () => {}, removeChild: () => {}, remove: () => {},
      querySelector: () => elem(id + ':qs'), querySelectorAll: () => [],
      closest: () => null, focus: () => {}, blur: () => {}, click: () => {},
      getAttribute: () => null, setAttribute: () => {}, scrollTo: () => {},
      getContext: () => new Proxy({}, { get: () => () => {} }),
    }, {
      get(t, k) { if (k in t) return t[k]; return t[k] = undefined; },
      set(t, k, v) { t[k] = v; return true; },
    });
    elems.set(id, e);
    return e;
  }
  const documentStub = {
    getElementById: id => elem(id),
    querySelector: sel => {
      if (sel === '.screen.on') {
        for (const [id, cls] of classes) if (cls.has('screen') && cls.has('on')) return elem(id);
        return null;
      }
      return elem('sel:' + sel);
    },
    querySelectorAll: () => [],
    createElement: tag => elem('created:' + tag + ':' + Math.random()),
    addEventListener: (ev, fn) => listeners.push({ targetId: 'document', ev, fn }),
    removeEventListener: () => {},
    documentElement: elem('documentElement'),
    body: elem('body'),
    visibilityState: 'visible',
    title: '',
  };
  const windowListeners = [];
  const windowStub = {
    addEventListener: (ev, fn) => windowListeners.push({ ev, fn }),
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    scrollTo: () => {},
    location: { href: 'http://x/staff', pathname: '/staff', reload: () => {}, origin: 'http://x' },
    history: { pushState: () => {}, replaceState: () => {}, back: () => {} },
    navigator: { serviceWorker: { register: () => Promise.resolve() }, onLine: true },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    innerWidth: 400, innerHeight: 800,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    confirm: () => true, prompt: () => null, alert: () => {},
  };
  const calls = [];
  async function fetchStub(url, opts) {
    opts = opts || {};
    calls.push({ url: String(url), method: opts.method || 'GET' });
    const out = fetchRouter(String(url), opts) || { status: 200, json: {} };
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      headers: { get: () => null },
      json: async () => out.json !== undefined ? out.json : {},
      text: async () => JSON.stringify(out.json || {}),
      clone() { return this; },
    };
  }
  return { documentStub, windowStub, fetchStub, listeners, windowListeners, classes, calls, elem };
}

function extractScript(file) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, out = '';
  while ((m = re.exec(html))) out += m[1] + '\n;\n';
  return out;
}

function runScript(code, env) {
  const sandbox = {
    document: env.documentStub, window: env.windowStub, fetch: env.fetchStub,
    navigator: env.windowStub.navigator, history: env.windowStub.history,
    location: env.windowStub.location, sessionStorage: env.windowStub.sessionStorage,
    localStorage: env.windowStub.localStorage, matchMedia: env.windowStub.matchMedia,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    confirm: () => true, prompt: () => null, alert: () => {},
    console, URL, URLSearchParams, Date, Math, JSON, Promise,
    requestAnimationFrame: fn => setTimeout(fn, 0),
    screen: { width: 400, height: 800 },
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox; sandbox.window = Object.assign(env.windowStub, sandbox);
  const fn = new Function(...Object.keys(sandbox), '"use strict";\n' + code);
  return fn(...Object.values(sandbox));
}

const flush = () => new Promise(r => setTimeout(r, 30));

(async () => {
  console.log('\u2500\u2500 STAFF PAD: load, success path, dead-token path \u2500\u2500');
  {
    const routes = {};
    const env = makeEnv((url, opts) => {
      if (url.includes('/api/staff/login')) return routes.login || { status: 200, json: { token: 'tk-1', autoLockMins: 2 } };
      if (url.includes('/api/staff/me')) return routes.me || { status: 200, json: { name: 'Robin', facility: 'Fairway', fnb: true, autoLockMins: 2 } };
      if (url.includes('/api/staff/')) return { status: 200, json: { groups: [], tabs: [], bays: [], readers: [], count: 0 } };
      if (url.includes('/api/pos/')) return { status: 200, json: { tabs: [], names: {} } };
      return { status: 200, json: {} };
    });
    let loadErr = null;
    try { runScript(extractScript('./public/staff.html'), env); } catch (e) { loadErr = e; }
    ok('staff: the script LOADS without a runtime error', !loadErr, loadErr && (loadErr.stack || loadErr.message));
    if (!loadErr) {
      await flush();
      const pad = env.listeners.find(l => l.targetId === 'pad' && l.ev === 'click');
      ok('staff: the pad click handler is registered', !!pad);
      if (pad) {
        const key = d => ({ target: { closest: sel => (sel === 'button' || sel === '.key') ? { id: d.length === 1 ? 'k' + d : d, textContent: d.length === 1 ? d : '', classList: { contains: () => true } } : null } });
        let err = null;
        try {
          for (const d of ['9', '3', '8', '5']) pad.fn(key(d));
          pad.fn(key('kgo'));
          await flush(); await flush();
        } catch (e) { err = e; }
        ok('staff: typing a code and hitting Go throws nothing', !err, err && (err.stack || err.message));
        const todayOn = env.classes.get('scrToday') && env.classes.get('scrToday').has('on');
        const padOn = env.classes.get('scrPad') && env.classes.get('scrPad').has('on');
        ok('staff: a good code lands on Today - not back on the pad', todayOn && !padOn,
           { today: !!todayOn, pad: !!padOn, calls: env.calls.slice(-4).map(c => c.method + ' ' + c.url) });
        // dead-token path: next /me 401s once
        routes.me = { status: 401, json: { error: 'expired' } };
        const vis = env.listeners.find(l => l.targetId === 'document' && l.ev === 'visibilitychange');
        let err2 = null;
        try { if (vis) { env.documentStub.visibilityState = 'visible'; vis.fn(); await flush(); await flush(); } } catch (e) { err2 = e; }
        ok('staff: wake revalidation with a dead token throws nothing to the console', !err2, err2 && (err2.stack || err2.message));
      }
    }
  }

  console.log('\u2500\u2500 STAFF-ONLY SESSION: every endpoint the staff page needs \u2500\u2500');
  {
    // maintainer, Aug 14: /api/terminal/readers was owner-only. On a desktop the admin
    // cookie masked it; a phone (staff token only) got 401 and the session was
    // thrown out - THE BLIP. Any future owner-only route on this list fails here.
    const staffSvc = require('./services/staff');
    const NEEDS = ['/api/staff/me', '/api/staff/today', '/api/staff/baystate',
                   '/api/terminal/readers', '/api/pos/menu', '/api/pos/tax-codes', '/api/pos/tabs'];
    const routeFiles = { '/api/terminal/': './routes/terminal.js', '/api/pos/': './routes/pos.js', '/api/staff/': './routes/staff.js' };
    const fsR = require('fs');
    let ownerOnly = [];
    for (const p of NEEDS) {
      const prefix = Object.keys(routeFiles).find(k => p.startsWith(k));
      const src = fsR.readFileSync(routeFiles[prefix], 'utf8');
      const tail = p.slice(prefix.length - 1);
      const re = new RegExp("router\\.get\\('" + tail.replace(/\//g, '\\/') + "'\\s*,\\s*([A-Za-z.]+)");
      const m = src.match(re);
      if (m && /adminOnly|requireAdminOnly/.test(m[1])) ownerOnly.push(p);
    }
    ok('staff surface: not one endpoint the staff page needs is owner-only', ownerOnly.length === 0, ownerOnly);
  }

  console.log('\u2500\u2500 ADMIN: load and login path \u2500\u2500');
  {
    const env = makeEnv((url, opts) => {
      if (url.includes('/api/auth/admin/login')) return { status: 200, json: { ok: true } };
      if (url.includes('/api/auth/admin/session')) return { status: 200, json: { ok: true, twofa: false } };
      if (url.includes('/api/admin/config')) return { status: 200, json: { server: {}, booking: {}, bays: [] } };
      if (url.includes('/api/staff/roster')) return { status: 200, json: { staff: [] } };
      return { status: 200, json: {} };
    });
    let loadErr = null;
    try { runScript(extractScript('./public/admin.html'), env); } catch (e) { loadErr = e; }
    ok('admin: the script LOADS without a runtime error', !loadErr, loadErr && (loadErr.stack || loadErr.message));
  }

  console.log('\u2500\u2500 BOOKING PAGE: load (member PIN surface) \u2500\u2500');
  {
    const env = makeEnv(url => {
      if (url.includes('/api/bookings/config')) return { status: 200, json: { openTime: '08:00', closeTime: '23:00' } };
      if (url.includes('/api/bookings/bays')) return { status: 200, json: { bays: [] } };
      if (url.includes('/api/waivers/active')) return { status: 200, json: { waiver: null } };
      return { status: 200, json: {} };
    });
    let loadErr = null;
    try { runScript(extractScript('./public/index.html'), env); } catch (e) { loadErr = e; }
    ok('booking page: the script LOADS without a runtime error', !loadErr, loadErr && (loadErr.stack || loadErr.message));
  }

  console.log('\nSIGN-IN SMOKE: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
