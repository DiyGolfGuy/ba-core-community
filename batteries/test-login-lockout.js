// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-login-lockout.js — THE LOGIN SCREEN CANNOT LOCK YOU OUT BY ITSELF
//                         (W39, Sep 9 2026)
//
// maintainer opened /admin on the bench from his phone and was locked out for an hour
// before typing a single character. Three things lined up:
//   1. W36 put the STOP-count loader on DOMContentLoaded - it ran on the LOGIN
//      screen, before any sign-in, and got a 401.
//   2. apiFetch read any 401 as "session expired", toasted, and reloaded the
//      page 0.8 s later - which ran the loader again. The login form reloaded
//      under his fingers every second.
//   3. routes/admin.js counted every one of those credential-less 401s as a
//      failed attempt, and at ten (about ten seconds) locked his IP for an hour.
// A headless browser reproduced it exactly: 12 s on the unfixed login screen,
// no password typed, 7 reloads, "Session expired" 12 times, IP locked 60 min.
// The automated proofs never saw it because a script signs in within 50 ms.
//
// This battery holds all three fixes:
//   - a request that presents NO credential is never counted as a guess
//   - the page never calls an admin endpoint before sign-in, and a 401 with no
//     session is "not signed in", never "expired"
//   - brute force is STILL stopped: wrong credentials lock exactly as before,
//     on both counters (routes/admin.js: 10 -> 1 h; /api/auth login: 5 -> 15 min)
//
// Same-day idempotent: stages its own config.json, restores it, kills its server.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('PASS  ' + n); pass++; } else { console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 260) : '')); fail++; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = __dirname;
const PORT = 3121;   // a port no other battery uses (the suite's batteries own 3001 in turn)
const B = 'http://127.0.0.1:' + PORT;   // one address, one limiter bucket - 'localhost' can flip between ::1 and 127.0.0.1
const PW = 'lockout-battery-pw';
const cfgPath = path.join(root, 'config.json');

// ── static: the page and the middleware say what they must ──────────────────
const admin = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const mw = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
ok('page: nothing calls an admin endpoint on DOMContentLoaded', !/DOMContentLoaded',\s*loadSmsOptouts/.test(admin));
ok('page: the STOP-count loader refuses to run before sign-in', /if \(typeof CSRF !== 'string' \|\| !CSRF\) return;/.test(admin));
ok('page: it is called from the post-login init instead', /^\s*loadSmsOptouts\(\);/m.test(admin));
ok('page: a 401 with no session is NOT "expired" - no toast, no reload', /if \(typeof CSRF === 'string' && CSRF\) \{ toast\('Session expired/.test(admin));
ok('middleware: a request with no credential does not spend the lockout budget', /const presentedCredential = !!password \|\| !!\(req\.headers\.cookie/.test(mw) && /if \(!presentedCredential\) return res\.status\(401\)/.test(mw));
// ── W40 (Sep 9 2026): EVERY page that talks to the server before sign-in ──
// A 401 with no session is "not signed in", never "expired": no toast, no
// reload, no lock-screen shout. Each page's own fetch wrapper is locked here.
const pub = f => fs.readFileSync(path.join(root, 'public', f), 'utf8');
{ const staffP = pub('staff.html');
  ok('staff pad: a 401 addressed to a PREVIOUS session is ignored (a straggling poll cannot lock the new one)', /if \(r\.status === 401 && sent !== TOKEN\) throw new Error\('stale session'\);/.test(staffP));
  ok('staff pad: only a 401 on a LIVE session can lock the screen - with no token it is simply "not signed in"', /if \(r\.status === 401 && TOKEN\) \{/.test(staffP) && !/Session expired/.test(staffP));
  ok('staff pad: nothing calls a staff endpoint at load - the keypad waits for a code', /DOMContentLoaded', function\(\)\{\n\s*var pb = document\.getElementById\('padbuild'\)/.test(staffP) && !/DOMContentLoaded[\s\S]{0,200}api\('GET'/.test(staffP));
  ok('staff pad: a wrong code is one line on the pad, never a reload', !/location\.reload/.test(staffP)); }
{ const meP = pub('me.html');
  ok('/me: a 401 clears the stale token and shows the keypad QUIETLY - no toast, no reload, no "expired"', /if \(r\.status === 401\) \{ TOKEN=null; try\{localStorage\.removeItem\('me_token'\);\}catch\(e\)\{\} show\('scrPad'\); return; \}/.test(meP) && !/Session expired|location\.reload/.test(meP));
  ok('/me: with no saved token the keypad shows and nothing is asked of the server', /if \(TOKEN\) load\(\); else show\('scrPad'\);/.test(meP)); }
{ const webP = pub('admin-website.html');
  ok('website editor: one session probe at load; a miss simply leaves the sign-in form (no toast, no reload, no "expired")', /const s=await fetch\('\/api\/auth\/admin\/session',\{credentials:'same-origin'\}\);\n\s*if\(s\.ok\)/.test(webP) && !/Session expired|location\.reload\(\)/.test(webP)); }
{ const setP = pub('setup.html');
  ok('setup wizard: the first screen never reloads itself and never says "expired"', !/location\.reload|Session expired/.test(setP)); }
{ const bkP = pub('my-booking.html'), mmP = pub('my-membership.html');
  ok('/my-booking and /my-membership: the server\'s own message is shown in place - no reload, no "expired" of their own', !/location\.reload|Session expired/.test(bkP) && !/location\.reload|Session expired/.test(mmP)); }
{ const adm = pub('admin.html');
  ok('admin: the only self-reloads left are the ones a person asked for (restore, rollback, sign-out) - none on a 401 without a session', (adm.match(/location\.reload\(\)/g) || []).length <= 4 && /if \(typeof CSRF === 'string' && CSRF\) \{ toast\('Session expired/.test(adm)); }

(async () => {
  const bak = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath) : null;
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Lockout', setup: { completed: true, eulaAccepted: true },
    booking: { staffedAccess: false, pricePerHalfHour: 25 },
    server: { port: PORT, businessName: 'Lockout', adminPassword: PW },
    waiver: { mode: 'off' }, bays: [{ id: 'lk-b1', name: 'Bay One', active: true }]
  }, null, 2));
  let child = null, log = '';
  // every response this IP has received from the CURRENT server process - the
  // health probe in boot() is one of them, and the limiter counts it too
  let served = 0;
  const waitExit = () => new Promise(r => { const t = setTimeout(r, 2500); child.once('exit', () => { clearTimeout(t); r(); }); });
  const boot = async () => {
    served = 0;
    child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      let r = null; try { r = await fetch(B + '/api/time'); } catch {}
      if (r) { served++; if (r.ok) return true; }
    }
    return false;
  };
  const halt = async () => { try { child.kill('SIGTERM'); } catch {} await waitExit(); };
  const alive = await boot();
  ok('server up', alive);
  // wait for the child to actually EXIT before returning, so nothing of this
  // battery is still bound when the next one starts. (The test-tree failures
  // seen while writing this were NOT that - they came from running a battery by
  // hand while a full suite was running on the same machine: every battery owns
  // port 3001, so the by-hand run talked to the suite's server. Never do that.)
  const done = async () => { try { child.kill('SIGTERM'); } catch {} await waitExit(); try { if (bak) fs.writeFileSync(cfgPath, bak); else fs.unlinkSync(cfgPath); } catch {} };
  if (!alive) { console.log(log.slice(-800)); await done(); console.log(`\nLOGIN LOCKOUT: ${pass} passed, ${fail + 1} failed`); process.exit(1); }
  const T = 8000;
  const get = (p, headers) => fetch(B + p, { headers: headers || {}, signal: AbortSignal.timeout(T) }).then(async r => { served++; return { s: r.status, d: await r.json().catch(() => ({})), h: r.headers }; });
  const login = pw => fetch(B + '/api/auth/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }), signal: AbortSignal.timeout(T) }).then(async r => { served++; return { s: r.status, d: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') || '' }; });

  try {
    // ── F. PURE VOLUME IS STILL BOUNDED - generalLimiter, the product's real max ─
    // W39 stopped the admin locks counting credential-less requests. That must
    // not mean an IP can hammer /api/ forever with no credential: generalLimiter
    // on /api/ still throttles VOLUME, and it is the only thing left that does,
    // now that test-tree's attacker presents a credential. This reads the real
    // max and message out of server.js so the test can never quietly assert a
    // lower number than the product ships with. Runs FIRST, on a fresh process,
    // so hit 1..max are 401 and hit max+1 is the 429 - an exact boundary.
    const srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const glBlock = (srv.match(/const generalLimiter = rateLimit\(\{[\s\S]*?\n\}\);/) || [''])[0];
    const GL_MAX = parseInt((glBlock.match(/\bmax:\s*(\d+)/) || [])[1], 10);
    const GL_MSG = (glBlock.match(/message:\s*\{\s*error:\s*'([^']+)'/) || [])[1] || '';
    ok('F0 generalLimiter is read from the product, and it is a real ceiling, not a test-sized one', Number.isFinite(GL_MAX) && GL_MAX >= 100 && !!GL_MSG, { max: GL_MAX, message: GL_MSG });
    // boot() already spent requests from this IP (its health probe); the
    // limiter counted those too. The boundary is on the IP's TOTAL, so it is
    // stated on the total - the first version of this assertion forgot the
    // probe and blamed the product for being off by one.
    const spentBefore = served;
    ok('F0b before the hammer, this IP has spent exactly the boot health probe on the server', spentBefore === 1, { spentBefore });
    let firstBlockTotal = -1, lastBefore = null, blockMsg = '';
    for (let i = 1; i <= GL_MAX + 5; i++) {
      const r = await get('/api/admin/sms-optouts');
      if (r.s === 429) { firstBlockTotal = served; blockMsg = r.d.error || ''; break; }
      lastBefore = r.s;
    }
    ok(`F1 bare, credential-less hammering IS throttled: request ${GL_MAX + 1} from one IP is the first 429 (the product's real max, probe included)`, firstBlockTotal === GL_MAX + 1, { firstBlockTotal, expected: GL_MAX + 1 });
    ok(`F2 ...and every request up to the real max (${GL_MAX}) was a plain 401 - never a lockout`, lastBefore === 401 && firstBlockTotal - 1 === GL_MAX, { lastBefore, servedBeforeBlock: firstBlockTotal - 1 });
    ok('F3 the 429 is the VOLUME message, not a guess-lock message', blockMsg === GL_MSG && !/failed attempts|admin attempts/i.test(blockMsg), { got: blockMsg, want: GL_MSG });
    const stillBlocked = await login(PW);
    ok('F4 while the volume window holds, even the right password from that IP is throttled (it is on /api/ too)', stillBlocked.s === 429, { s: stillBlocked.s });
    // "once the window is cleared": the window store is process memory, exactly
    // as a pm2 restart or the 15-minute expiry clears it. Restart, then prove
    // nothing lingered - the right password signs in at once.
    await halt();
    ok('F5 the window is cleared (in-memory store, as expiry would clear it)', await boot());
    const afterWindow = await login(PW);
    ok('F6 and the right password signs in immediately once the window is cleared - a volume block leaves no lock behind', afterWindow.s === 200 && afterWindow.d.ok === true, { s: afterWindow.s, e: afterWindow.d.error });

    // ── A. the login screen's own traffic: credential-less, never counted ──
    const codes = [];
    for (let i = 0; i < 25; i++) codes.push((await get('/api/admin/sms-optouts')).s);
    ok('A1 twenty-five bare page-load hits (no cookie, no header) are ALL 401 - never 429',
       codes.every(c => c === 401), codes);
    ok('A2 ...more than twice the 10-attempt threshold, and still no lockout', codes.length === 25 && !codes.includes(429));

    // ── B. and the owner can still sign in afterwards - nothing was burned ─
    const l = await login(PW);
    ok('B1 the correct password signs in after all that', l.s === 200 && l.d.ok === true, { s: l.s, e: l.d.error });
    const cookie = (l.cookie.split(';')[0]) || '';
    const first = await get('/api/admin/config', { cookie });
    ok('B2 and the very first authenticated admin call is 200, not "Too many failed attempts"', first.s === 200, { s: first.s, e: first.d.error });

    // ── C. brute force is STILL stopped on the login route (5 -> 15 min) ──
    let lockedAt = -1;
    for (let i = 1; i <= 6; i++) { const r = await login('wrong-' + i); if (r.s === 429) { lockedAt = i; break; } }
    ok('C1 five wrong PASSWORDS lock the login route (the 6th attempt is refused 429)', lockedAt === 6, { lockedAt });
    const right = await login(PW);
    ok('C2 and the right password is refused too while the lock holds - a guess cannot be undone by guessing right', right.s === 429 && /Try again in \d+ minute/.test(right.d.error || ''), { s: right.s, e: right.d.error });

    // ── D. brute force is STILL stopped on the header path (10 -> 1 hour) ──
    let hdrLockedAt = -1, hdrMsg = '';
    for (let i = 1; i <= 11; i++) {
      const r = await get('/api/admin/config', { 'x-admin-password': 'wrong-' + i });
      if (r.s === 429) { hdrLockedAt = i; hdrMsg = r.d.error || ''; break; }
    }
    ok('D1 ten WRONG password headers lock the header path for an hour', hdrLockedAt === 10 && /Locked out for 1 hour|Too many failed attempts/.test(hdrMsg), { hdrLockedAt, hdrMsg });
    const after = await get('/api/admin/config', { 'x-admin-password': PW });
    ok('D2 and the right header is refused while that lock holds', after.s === 429, { s: after.s });
    ok('D3 a credential-less request during the lock still just says Unauthorized-or-locked, never a 500',
       [401, 429].includes((await get('/api/admin/sms-optouts')).s));
  } catch (e) {
    ok('the battery ran to completion', false, String(e && e.message));
  }

  await done();
  await sleep(300);
  // the lockout is in the owner's log - read after the server has exited
  try {
    const dbM = require('./services/db'); await dbM.initDb();
    const n = dbM.db.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event='ADMIN_LOCKOUT'`).get().c;
    const f = dbM.db.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event='ADMIN_LOGIN_FAILED'`).get().c;
    ok('E1 the owner can SEE it: ADMIN_LOCKOUT and ADMIN_LOGIN_FAILED are in admin_log', n >= 1 && f >= 5, { lockouts: n, failedLogins: f });
    ok('E2 EXACTLY one ADMIN_LOCKOUT - the wrong-header lock (D1). The 500-hit volume block wrote NONE: it is a throttle, not a guess lock', n === 1, { lockouts: n });
    dbM.db.prepare(`DELETE FROM admin_log WHERE event IN ('ADMIN_LOCKOUT','ADMIN_LOGIN_FAILED','ADMIN_LOGIN')`).run();
    dbM.saveDb && dbM.saveDb();
  } catch (e) { ok('E1 admin_log readable after exit', false, String(e.message)); }

  console.log(`\nLOGIN LOCKOUT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
