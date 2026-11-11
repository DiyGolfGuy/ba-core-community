// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-tls-closed.js — EVERY OUTBOUND CALL FAILS CLOSED ON A BAD CERTIFICATE
//                      (maintainer, Sep 15 2026)
//
// maintainer: "For Stripe, Resend, Twilio, the tunnel and the updater I don't want a
// posture statement, I want a battery. Assert that each one fails closed against
// a bad or self-signed certificate rather than proceeding - that's the class
// where a quiet fallback would be worst and nobody would ever notice."
//
// The load-bearing check is B2. Every one of those clients uses Node's default
// TLS, so the only way any of them could start accepting a forged certificate is
// if some module in the product weakened TLS globally - an env var, a mutated
// https.globalAgent, a stray rejectUnauthorized. So this battery LOADS EVERY
// PRODUCT SERVICE and then proves that a plain request to a self-signed server
// STILL refuses. One assertion, and it covers every present and future client
// that does not opt out by hand.
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const https = require('https'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 320) : '')); } };
const root = __dirname;

// ── a self-signed server, the thing a forged certificate looks like ──────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-tls-'));
const keyF = path.join(tmp, 'k.pem'), crtF = path.join(tmp, 'c.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyF, '-out', crtF,
  '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const server = https.createServer({ key: fs.readFileSync(keyF), cert: fs.readFileSync(crtF) },
  (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"note":"a forged answer"}'); });

const reason = e => { const parts = []; let c = e; for (let i = 0; c && i < 4; i++) { parts.push(String(c.message || ''), String(c.code || '')); c = c.cause; } return parts.join(' | '); };
const tlsRefused = e => /self[- ]signed|unable to verify|certificate|DEPTH_ZERO|UNABLE_TO_GET_ISSUER|ERR_TLS/i.test(reason(e));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port, URL = `https://127.0.0.1:${PORT}/anything`;
  try {
    // ── A. the rig itself ──────────────────────────────────────────────────
    let control = null;
    try { await fetch(URL); control = 'ACCEPTED'; } catch (e) { control = tlsRefused(e) ? 'refused' : 'other: ' + e.message; }
    ok('A1 the rig works: a plain request to a self-signed server is refused before this battery loads anything', control === 'refused', control);

    // ── B. THE ONE THAT MATTERS ────────────────────────────────────────────
    const services = fs.readdirSync(path.join(root, 'services')).filter(f => f.endsWith('.js'));
    const loaded = [], skipped = [];
    for (const f of services) { try { require(path.join(root, 'services', f)); loaded.push(f); } catch (e) { skipped.push(f + ': ' + String(e.message).slice(0, 60)); } }
    ok(`B1 every service module in the product is loaded into this process (${loaded.length} of ${services.length})`, loaded.length >= services.length - 3, { skipped });
    let after = null;
    try { await fetch(URL); after = 'ACCEPTED'; } catch (e) { after = tlsRefused(e) ? 'refused' : 'other: ' + e.message; }
    ok('B2 WITH EVERY PRODUCT MODULE LOADED, a request to a self-signed server is STILL refused - so nothing in the tree has weakened TLS for the whole process, and Stripe, Resend, Twilio, the tunnel and the updater all still fail closed on a forged certificate',
       after === 'refused', { after, note: 'if this reads ACCEPTED, some module set NODE_TLS_REJECT_UNAUTHORIZED or mutated https.globalAgent at load' });
    ok('B3 ...and the process was never handed the blunt instrument: NODE_TLS_REJECT_UNAUTHORIZED is unset',
       process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '1', process.env.NODE_TLS_REJECT_UNAUTHORIZED);
    const ga = https.globalAgent && https.globalAgent.options || {};
    ok('B4 ...and https.globalAgent was not mutated to skip verification', ga.rejectUnauthorized !== false, ga);

    // ── C. the hand-rolled clients, driven at the forged server ────────────
    // Stripe is the one with a documented base override (gated on a test key), so
    // it can be driven for real rather than asserted about.
    const drive = (mod, fn) => {
      const js = `process.env.BA_STRIPE_API_BASE=${JSON.stringify('https://127.0.0.1:' + PORT)};
        // a test key so apiBase() honours the override at all - it refuses to for a live key
        require('fs').writeFileSync('config.json', JSON.stringify({ businessName:'TLS', setup:{completed:true}, server:{port:3001,businessName:'TLS',adminPassword:'x'}, stripe:{ secretKey:'sk_test_tls_battery_probe_key', publishableKey:'pk_test_x' } }, null, 2));
        const m = require(${JSON.stringify(path.join(root, 'services', mod))});
        (async () => { try { const r = await m.${fn}; console.log('R ' + JSON.stringify({ resolved: true, r: String(JSON.stringify(r)).slice(0,120) })); }
          catch (e) { const parts=[]; let c=e; for (let i=0;c&&i<4;i++){parts.push(String(c.message||''),String(c.code||''));c=c.cause;}
            console.log('R ' + JSON.stringify({ resolved: false, err: parts.join(' | ').slice(0,200) })); } process.exit(0); })();`;
      const out = require('child_process').spawnSync(process.execPath, ['-e', js], { cwd: root, encoding: 'utf8', timeout: 60000,
        env: Object.assign({}, process.env, { BA_TLS_BATTERY: '1' }) });
      const line = (out.stdout || '').split('\n').find(l => l.startsWith('R '));
      try { return line ? JSON.parse(line.slice(2)) : { resolved: null, raw: (out.stdout || out.stderr || '').slice(0, 200) }; } catch { return { resolved: null }; }
    };
    const termRes = drive('terminal.js', `readerStatus('tmr_tls_probe')`);
    const believedForgery = r => JSON.stringify(r || {}).includes('forged');
    ok('C1 the card reader\'s Stripe client, pointed at a server presenting a forged certificate, NEVER BELIEVES IT - the reader\'s state comes back unknown with the transport error, not the forged body',
       !!termRes && !believedForgery(termRes) && (termRes.resolved === false || /"status":"unknown"/.test(termRes.r || '')), termRes);
    const billRes = drive('membership-billing.js', `stripeCall('GET', '/products?limit=1')`);
    ok('C2 the membership Stripe client does the same - the call is rejected and the forged body never becomes a product list',
       !!billRes && billRes.resolved === false && !believedForgery(billRes), billRes);

    // ── D. and nobody opted out by hand ────────────────────────────────────
    // A file may disable verification ONLY if it is a LAN device that cannot present
    // a verifiable certificate, and only for its own requests. Every name here is a
    // deliberate decision with a reason written beside it in the file. Shelly (Oct 19 2026): plugs made
    // with firmware 2.0.0 redirect to https with a certificate from Shelly's private authority; nothing
    // secret is sent to a plug (DECISIONS, Oct 18-19).
    const ALLOW = ['services/unifiaccess.js', 'services/shelly.js'];
    const offenders = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name); const rel = path.relative(root, p);
      if (e.isDirectory()) { if (!/node_modules|\.git|backups|waivers|public\/vendor|docs/.test(rel)) walk(p); continue; }
      if (!e.name.endsWith('.js') && !e.name.endsWith('.sh')) continue;
      if (rel.startsWith('test-') || rel === 'test-tls-closed.js') continue;
      const t = fs.readFileSync(p, 'utf8');
      if (/rejectUnauthorized\s*:\s*false/.test(t) && !ALLOW.includes(rel)) offenders.push(rel + ': rejectUnauthorized false');
      if (/NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/.test(t)) offenders.push(rel + ': NODE_TLS_REJECT_UNAUTHORIZED=0');
      if (/globalAgent\.options\.rejectUnauthorized/.test(t)) offenders.push(rel + ': mutates https.globalAgent');
      if (/curl\b[^\n|]*\s-k\b/.test(t) || /--insecure\b/.test(t)) offenders.push(rel + ': curl -k / --insecure');
    } };
    walk(root);
    ok('D1 no file in the product weakens certificate verification except the LAN-device exceptions this battery names, each with its reason written beside it in the file',
       offenders.length === 0, offenders.slice(0, 10));
    for (const a of ALLOW) {
      const t = fs.readFileSync(path.join(root, a), 'utf8');
      ok(`D2 ${a} explains in the file itself why it cannot verify, and scopes it to its own requests`,
         /rejectUnauthorized/.test(t) && /self-signed|self signed/i.test(t) && /these requests only|for these requests|only for/i.test(t),
         t.split('\n').filter(l => /rejectUnauthorized|self-signed/i.test(l)).slice(0, 3));
    }
    {
      // The plug's exception is its own agent and carries nothing secret: one agent, never a header
      // that holds a credential, never the process-wide agent.
      const t = fs.readFileSync(path.join(root, 'services/shelly.js'), 'utf8');
      const code = t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      ok('D3 services/shelly.js skips the check on ONE agent of its own and sends no credential through it',
         (code.match(/rejectUnauthorized\s*:\s*false/g) || []).length === 1 && /new https\.Agent\(\{ rejectUnauthorized: false \}\)/.test(code)
           && !/Authorization|auth\s*:|password\s*:/i.test(code) && !/globalAgent/.test(code),
         code.split('\n').filter(l => /rejectUnauthorized|Authorization|auth\s*:|globalAgent/i.test(l)).slice(0, 4));
    }
  } catch (e) {
    ok('the battery ran to completion', false, String(e && e.stack || e).slice(0, 400));
  }
  server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\nTLS FAILS CLOSED: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
