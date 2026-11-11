// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-seo-polish.js — the Aug 18 polish batch, proven:
//  A  /book canonical + og:url are absolute per-page URLs (never "/")
//  B  geo meta server-filled from config; blank stays blank (no ", ." garbage)
//  C  "/" serves the TEMPLATED booking page - raw {{TOKEN}}s can never leak
//  D  seed copy matches the channel policy (email default, SMS opt-in)
//  E  book-page header is wrap-safe on narrow phones
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

(async () => {
  const root = __dirname;

  // ── source-level guarantees ────────────────────────────────────────────────
  const idx = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  ok('A: canonical token targets THIS page', idx.includes('href="{{SITE_URL}}/book"'));
  ok('A: og:url token present and per-page', idx.includes('content="{{SITE_URL}}/book"'));
  ok('A: client enhancer points canonical at /book, not the homepage', idx.includes("+ '/book')"));
  ok('B: geo tokens server-filled', idx.includes('{{GEO_REGION}}') && idx.includes('{{GEO_POSITION}}') && idx.includes('{{GEO_ICBM}}'));
  ok('E: header wraps instead of clipping', /header\{[^}]*min-height:64px[^}]*flex-wrap:wrap/.test(idx));
  ok('E: facility name scales down before clipping', idx.includes('font-size:clamp(16px,4.5vw,20px)'));

  const srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  ok('B: filler computes GEO_* only when parts exist', srv.includes("fill.GEO_REGION") && srv.includes("(_lat && _lng)"));
  ok('B: page cache stamp covers latitude/longitude', srv.includes("(cfg.seo?.latitude || '')"));
  ok('C: homepage fallthrough serves TEMPLATED index', srv.includes("return serveTemplated('index.html')(req, res);"));
  ok('C: static middleware never auto-serves index', srv.includes("{ index: false }"));
  ok('C: direct /index.html hits redirect to /', srv.includes("app.get('/index.html'"));

  const landing = fs.readFileSync(path.join(root, 'public/landing.html'), 'utf8');
  const aweb = fs.readFileSync(path.join(root, 'public/admin-website.html'), 'utf8');
  ok('D: landing seed says email default / text opt-in', landing.includes('by text if you opt in') && !landing.includes('is texted before your session'));
  ok('D: website-editor seeds match (both slides and steps)', (aweb.match(/by text if you opt in/g) || []).length === 2 && !aweb.includes('is texted before'));

  // ── live serve: boot the real server and read what a crawler reads ─────────
  console.log('\u2500\u2500 live templated serve \u2500\u2500');
  const cfgPath = path.join(root, 'config.json');
  const dbPath = path.join(root, 'bookings.db');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(dbPath); } catch {}
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Polish Test', setup: { completed: true }, booking: { staffedAccess: false },
    server: { port: 3027, businessName: 'Polish Test' },
    seo: { city: 'Example City', state: 'ST', latitude: '40.000', longitude: '-90.000' },
    bays: [{ id: 'bay1', name: 'B1', active: true }]
  }));
  const child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let up = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const r = await fetch('http://localhost:3027/api/time'); if (r.ok) { up = true; break; } } catch {}
  }
  ok('server came up for the live check', up);
  if (up) {
    const home = await (await fetch('http://localhost:3027/')).text();
    const book = await (await fetch('http://localhost:3027/book')).text();
    ok('C: "/" carries ZERO unfilled tokens', !home.includes('{{'), (home.match(/\{\{[A-Z_]+\}\}/g) || []).slice(0, 3));
    ok('C: "/book" carries ZERO unfilled tokens', !book.includes('{{'));
    ok('A: live canonical is absolute and page-specific',
       /rel="canonical"[^>]*href="http[^"]*\/book"/.test(book));
    ok('B: live geo.placename filled from config', book.includes('content="Example City, ST"'));
    ok('B: live geo.position filled', book.includes('40.000;-90.000'));
    ok('title carries the facility name server-side', book.includes('Book a Session — Polish Test'));
    const redir = await fetch('http://localhost:3027/index.html', { redirect: 'manual' });
    ok('C: /index.html redirects (301) instead of leaking the raw file', redir.status === 301);
    // blank-config path: geo attrs empty, never garbage
    fs.writeFileSync(cfgPath, JSON.stringify({
      businessName: 'Blank Co', setup: { completed: true }, booking: { staffedAccess: false },
      server: { port: 3027, businessName: 'Blank Co' }, bays: [{ id: 'bay1', name: 'B1', active: true }]
    }));
    await new Promise(r => setTimeout(r, 300));
    const blank = await (await fetch('http://localhost:3027/book')).text();
    ok('B: blank config renders empty geo attrs, no ", ." garbage',
       !blank.includes('", ."') && !blank.includes('>, .<') && blank.includes('id="metaGeoPlace" content=""'));
    ok('A: blank config still gets an absolute request-host canonical',
       /rel="canonical"[^>]*href="http:\/\/localhost:3027\/book"/.test(blank));
  }
  child.kill('SIGKILL');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'BOOTSTRAP-PASSWORD.txt')); } catch {}
  try { fs.unlinkSync(path.join(root, 'license.json')); } catch {}

  console.log('\nSEO POLISH: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
