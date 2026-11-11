// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-unifi-cert.js - THE CONSOLE'S CERTIFICATE IS PINNED, NOT IGNORED
//                      (Sep 25 2026, maintainer's item 10 of the Monday pack)
//
// maintainer: "UniFi consoles often use a self-signed certificate. Confirm we handle that
// without turning off checking altogether." We did turn it off: every request to the
// console went through an agent with rejectUnauthorized:false and nothing else, so
// anything on the facility's network answering the console's address was handed the
// door token in the first request and believed about every door code after it.
// Now the first certificate this unit sees at an address is recorded, and every later
// connection presenting a different one is closed before a byte is written.
//   R  the owner's route: first contact names the certificate; a changed one answers
//      certChanged with both fingerprints and trusts ONLY the one the owner accepts;
//      the page shows the owner the fingerprints and asks before trusting
//   D  a certificate a public authority issued for the typed NAME is trusted with no
//      pin; the same certificate reached by an address it does not name is not
//   A  first contact pins it, once, and the owner's log says so
//   B  an impostor on the same address with a different certificate: the door code
//      call fails, the impostor receives NOTHING (no request, so no token), the
//      owner's log says so once an hour, a removal is not reported as done
//   C  Test Connection: a changed certificate is refused and described; a fingerprint
//      the owner was not shown is refused; the one they accept is trusted
//   E  a pinned certificate past its printed expiry is still that console
//   F  the one place chain checking is off is the pinning agent itself
//   G  a console that accepts the connection and never finishes TLS: the call fails in
//      seconds - the agent used to leave it, the door job and a cancel waiting for ever
//   H  a NEW port on an address trusted on another port is not trusted on sight
//   I  the health line says so while the console's certificate is refused, and clears
//      when the trusted one is back
'use strict';
process.env.BA_UNIFI_CONNECT_MS = process.env.BA_UNIFI_CONNECT_MS || '2000';   // G: seconds, not minutes
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const PORT = 12471, CA_PORT = 12472, EXP_PORT = 12473, HANG_PORT = 12475, NEW_PORT = 12476, SRV = 3155, B = 'http://127.0.0.1:' + SRV, PW = 'cert-owner-pw';
const TOKEN = 'tok-cert-battery';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { startConsole, ensureTls, otherTls } = require('./tools/unifi-console-standin');
const fpOf = pem => new crypto.X509Certificate(pem).fingerprint256.toUpperCase();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-unifi-cert-'));
const ENV = Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' });

function writeConfig(unifi) {
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Cert Golf', setup: { completed: true, eulaAccepted: true },
    server: { port: SRV, businessName: 'Cert Golf', adminPassword: PW, timezone: 'America/Chicago' },
    booking: { staffedAccess: false, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true },
    doorAccess: { provider: 'unifi' },
    unifiAccess: Object.assign({ apiToken: TOKEN, apiStyle: 'documented', doorIds: ['door:door-front'], pinLength: 4 }, unifi),
    bays: [{ id: 'uc-b1', name: 'Bay One', active: true }], waiver: { mode: 'off' }
  }, null, 2));
}
// a certificate authority and a certificate it issued for the NAME localhost (and nothing else)
function caIssued() {
  const o = { cwd: tmp, stdio: 'ignore', timeout: 60000 };
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Battery Test CA'], o);
  execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=localhost'], o);
  fs.writeFileSync(path.join(tmp, 'san.ext'), 'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  execFileSync('openssl', ['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'san.ext'], o);
}
// a self-signed certificate whose printed dates ended in 2020
function expired() {
  const d = path.join(tmp, 'exp'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'index.txt'), ''); fs.writeFileSync(path.join(d, 'serial'), '01\n');
  fs.writeFileSync(path.join(d, 'ca.cnf'), '[ ca ]\ndefault_ca = d\n[ d ]\ndir = .\ndatabase = ./index.txt\nserial = ./serial\nnew_certs_dir = .\ndefault_md = sha256\npolicy = p\ncopy_extensions = none\nunique_subject = no\n[ p ]\ncommonName = supplied\n');
  const o = { cwd: d, stdio: 'ignore', timeout: 60000 };
  execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'r.csr', '-subj', '/CN=expired-console'], o);
  execFileSync('openssl', ['ca', '-batch', '-config', 'ca.cnf', '-selfsign', '-keyfile', 'k.pem', '-in', 'r.csr', '-out', 'c.pem', '-startdate', '20200101000000Z', '-enddate', '20200102000000Z', '-notext'], o);
  return { key: fs.readFileSync(path.join(d, 'k.pem')), cert: fs.readFileSync(path.join(d, 'c.pem')) };
}

let server = null;
(async () => {
  try {
    try { if ((await fetch(B + '/api/time')).ok) { console.log('FAIL  port ' + SRV + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    const real = ensureTls(), impostor = otherTls('impostor');
    const REAL = fpOf(real.cert), FAKE = fpOf(impostor.cert);
    ok('stage: two different self-signed certificates for one console address', REAL && FAKE && REAL !== FAKE);

    // ── R. the owner's route and the page ──
    console.log('── R. the owner\'s Test Connection, through the route ──');
    writeConfig({ host: '127.0.0.1:' + PORT });
    let c = await startConsole({ port: PORT, faults: { token: TOKEN } });
    server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: ENV });
    let up = false; for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
    ok('the unit boots', up);
    const test = async body => { try { return await (await fetch(B + '/api/admin/unifi/test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': PW }, body: JSON.stringify(body || {}) })).json(); } catch (e) { return { err: String(e) }; } };
    let r = await test({});
    ok('R1 first contact: Test Connection answers ok and names the certificate this unit now holds to (SHA-256, the date)', r.ok === true && r.cert && String(r.cert.sha256).toUpperCase() === REAL && !!r.cert.pinnedAt, r);
    await c.stop();
    c = await startConsole({ port: PORT, tls: impostor, faults: { token: TOKEN } });
    r = await test({});
    ok('R2 a DIFFERENT certificate at that address: the route answers not-ok with certChanged naming the new and the trusted fingerprint - and the console behind it got nothing', r.ok === false && r.certChanged && String(r.certChanged.now).toUpperCase() === FAKE && String(r.certChanged.was).toUpperCase() === REAL && c.state.requests.length === 0, { r, requests: c.state.requests.length });
    r = await test({ trustCert: REAL });
    ok('R3 trusting a fingerprint that is NOT the one presented trusts nothing - still refused, still nothing sent', r.ok === false && c.state.requests.length === 0, { r, requests: c.state.requests.length });
    r = await test({ trustCert: FAKE });
    ok('R4 trusting exactly the fingerprint the owner was shown: connected, and the answer names the new certificate', r.ok === true && r.cert && String(r.cert.sha256).toUpperCase() === FAKE && c.state.requests.length > 0, r);
    await c.stop();
    server.kill('SIGINT'); await new Promise(res => { server.on('exit', res); setTimeout(res, 4000); }); server = null;
    const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
    const fn = (html.match(/async function unifiTest\(trustCert\)\{[\s\S]*?\n\}/) || [''])[0];
    ok('R5 the page: a changed certificate shows the owner BOTH fingerprints and asks before trusting; only on yes does it re-test with that one fingerprint', /j\.certChanged/.test(fn) && /confirm\(/.test(fn) && /c\.now/.test(fn) && /c\.was/.test(fn) && /unifiTest\(c\.now\)/.test(fn) && /body\.trustCert = trustCert/.test(fn), fn.slice(0, 200));
    ok('R6 ...and a successful test tells the owner which certificate the unit holds to', /j\.cert \? .*j\.cert\.sha256/.test(fn));

    // ── D. a certificate a public authority vouches for ──
    console.log('\n── D. a certificate issued by an authority the unit trusts ──');
    caIssued();
    const leaf = { key: fs.readFileSync(path.join(tmp, 'leaf.key')), cert: fs.readFileSync(path.join(tmp, 'leaf.pem')) };
    const bogus = { sha256: Array(32).fill('AB').join(':'), pinnedAt: '2026-01-01T00:00:00.000Z' };
    const child = (host) => new Promise(res => {
      writeConfig({ host, certPins: { ['localhost:' + CA_PORT]: bogus, ['127.0.0.1:' + CA_PORT]: bogus } });
      const js = `const db=require('./services/db');db.initDb().then(async()=>{const {startConsole}=require('./tools/unifi-console-standin');const fs=require('fs');
        const c=await startConsole({port:${CA_PORT},tls:{key:fs.readFileSync(${JSON.stringify(path.join(tmp, 'leaf.key'))}),cert:fs.readFileSync(${JSON.stringify(path.join(tmp, 'leaf.pem'))})},faults:{token:${JSON.stringify(TOKEN)}}});
        let out;try{out={ok:true,doors:(await require('./services/unifiaccess').listDoors()).length}}catch(e){out={ok:false,err:e.message}}
        out.requests=c.state.requests.length;await c.stop();console.log('RESULT '+JSON.stringify(out));process.exit(0)}).catch(e=>{console.log('RESULT '+JSON.stringify({ok:false,err:String(e)}));process.exit(0)})`;
      const ch = spawn(process.execPath, ['-e', js], { cwd: root, env: Object.assign({}, ENV, { NODE_EXTRA_CA_CERTS: path.join(tmp, 'ca.pem') }), stdio: ['ignore', 'pipe', 'pipe'] });
      let o = ''; ch.stdout.on('data', d => o += d); ch.stderr.on('data', d => o += d);
      ch.on('exit', () => { const m = /RESULT (.*)/.exec(o); res(m ? JSON.parse(m[1]) : { ok: false, err: o.slice(-300) }); });
    });
    let d = await child('localhost:' + CA_PORT);
    ok('D1 an owner who installed a certificate their authority issued for the console\'s NAME is trusted with no pin to match - the way a browser trusts it', d.ok === true && d.doors > 0, d);
    d = await child('127.0.0.1:' + CA_PORT);
    ok('D2 the same certificate reached at an address it does not name is NOT trusted on the authority\'s word - refused against the pin, nothing sent', d.ok === false && /DIFFERENT certificate/.test(d.err || '') && d.requests === 0, d);
    void leaf;

    // ── A/B/C/E in this process ──
    writeConfig({ host: '127.0.0.1:' + PORT });
    const db = require('./services/db'); await db.initDb();
    const ua = require('./services/unifiaccess');
    const cfgSvc = require('./services/config');
    const logOf = ev => db.db.prepare('SELECT detail FROM admin_log WHERE event=? ORDER BY id').all(ev).map(x => x.detail);
    const pins = () => ((cfgSvc.getConfig().unifiAccess || {}).certPins) || {};
    const origin = '127.0.0.1:' + PORT;

    console.log('\n── A. first contact ──');
    c = await startConsole({ port: PORT, faults: { token: TOKEN } });
    let doors = null; try { doors = await ua.listDoors(); } catch (e) { doors = e.message; }
    ok('A1 the first call to a console reaches it, and its certificate\'s SHA-256 is recorded for that address and port', Array.isArray(doors) && doors.length > 0 && pins()[origin] && String(pins()[origin].sha256).toUpperCase() === REAL, { doors, pins: pins() });
    ok('A2 ...and the owner\'s log says so in one line, naming the fingerprint', logOf('UNIFI_CERT_TRUSTED').length === 1 && logOf('UNIFI_CERT_TRUSTED')[0].includes(REAL), logOf('UNIFI_CERT_TRUSTED'));
    // tomorrow, always (Oct 2026): a calendar date here was written as the future and would go off once it passed
    const TMRW = (() => { const t = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (1), 12); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); })();
    const booking = { id: 'uc-bk-1', name: 'Casey Cert', date: TMRW, start_time: '18:00', end_time: '19:00', end_date: TMRW, bay_id: 'uc-b1' };
    let made = null; try { made = await ua.createBookingVisitor(booking); } catch (e) { made = e.message; }
    ok('A3 the same console again: a door code is created as before, and no second "trusted" line is written', made && made.visitorId && logOf('UNIFI_CERT_TRUSTED').length === 1, made);
    await c.stop();

    console.log('\n── B. an impostor at the console\'s address ──');
    c = await startConsole({ port: PORT, tls: impostor, faults: { token: TOKEN } });
    let err = ''; try { await ua.createBookingVisitor(Object.assign({}, booking, { id: 'uc-bk-2' })); } catch (e) { err = e.message; }
    ok('B1 creating a door code fails, saying the console presented a different certificate and nothing was sent', /DIFFERENT certificate/.test(err) && /nothing was sent/.test(err), err);
    ok('B2 the impostor received NOTHING - not one request, so never the token', c.state.requests.length === 0 && Object.keys(c.state.visitors).length === 0, { requests: c.state.requests.map(q => q.method + ' ' + q.url + ' ' + (q.auth ? 'WITH TOKEN' : '')) });
    ok('B3 the owner\'s log says it once, with both fingerprints and what to press', logOf('UNIFI_CERT_MISMATCH').length === 1 && logOf('UNIFI_CERT_MISMATCH')[0].includes(FAKE) && logOf('UNIFI_CERT_MISMATCH')[0].includes(REAL) && /Test Connection/.test(logOf('UNIFI_CERT_MISMATCH')[0]), logOf('UNIFI_CERT_MISMATCH'));
    const rv = await ua.revokeVisitor(made && made.visitorId);
    ok('B4 removing a code through it is reported as NOT done (ok:false) - never "already gone" - and the impostor still received nothing', rv && rv.ok === false && !rv.note && c.state.requests.length === 0, rv);
    ok('B5 ...and the retries inside the hour do not write the line again', logOf('UNIFI_CERT_MISMATCH').length === 1, logOf('UNIFI_CERT_MISMATCH').length);
    ok('B6 the trusted certificate is unchanged', String((pins()[origin] || {}).sha256).toUpperCase() === REAL);
    const doorLine = () => { try { return (require('./services/unithealth').compute().signals || []).find(x => x.key === 'doorcodes') || {}; } catch (e) { return { err: e.message }; } };
    let dl = doorLine();
    ok('I1 the health line is RED while the console\'s certificate is refused, saying no code can be made or removed through it', dl.level === 'red' && /certificate this unit does not trust/.test(dl.detail || ''), dl);
    await c.stop();
    c = await startConsole({ port: PORT, faults: { token: TOKEN } });
    let back = null; try { back = await ua.listDoors(); } catch (e) { back = e.message; }
    dl = doorLine();
    ok('I2 the trusted console answers again: the owner\'s log says so and the line clears on its own', Array.isArray(back) && logOf('UNIFI_CERT_OK').length === 1 && !/certificate/.test(dl.detail || ''), { back, ok: logOf('UNIFI_CERT_OK'), dl });
    await c.stop();
    c = await startConsole({ port: PORT, tls: impostor, faults: { token: TOKEN } });

    console.log('\n── C. the owner\'s Test Connection ──');
    let tc = null; try { tc = await ua.testConnection(); } catch (e) { tc = { err: e.message, certChanged: e.certChanged || (e.cause && e.cause.certChanged) }; }
    ok('C1 Test Connection is refused too, and the refusal carries the new fingerprint, the trusted one and since when', tc && tc.err && tc.certChanged && String(tc.certChanged.now).toUpperCase() === FAKE && String(tc.certChanged.was).toUpperCase() === REAL && !!tc.certChanged.since, tc);
    try { tc = await ua.testConnection({ trustCert: REAL }); } catch (e) { tc = { err: e.message }; }
    ok('C2 a fingerprint that is not the one presented trusts nothing', tc && tc.err && c.state.requests.length === 0, tc);
    try { tc = await ua.testConnection({ trustCert: FAKE }); } catch (e) { tc = { err: e.message }; }
    ok('C3 the fingerprint the owner accepts is trusted: connected, the pin replaced, the log names the old and the new', tc && tc.ok === true && String((pins()[origin] || {}).sha256).toUpperCase() === FAKE && logOf('UNIFI_CERT_TRUSTED').some(l => l.includes(FAKE) && l.includes(REAL) && /owner/.test(l)), { tc, log: logOf('UNIFI_CERT_TRUSTED') });
    await c.stop();

    console.log('\n── E. a pinned certificate past its printed expiry ──');
    const exp = expired();
    const cur = cfgSvc.getConfig(); cur.unifiAccess.host = 'localhost:' + EXP_PORT; cfgSvc.writeConfigRaw(cur);   // another address: H's rule is about ports of ONE address
    c = await startConsole({ port: EXP_PORT, tls: exp, faults: { token: TOKEN } });
    let e1 = null, e2 = null;
    try { e1 = await ua.listDoors(); } catch (e) { e1 = e.message; }
    try { e2 = await ua.listDoors(); } catch (e) { e2 = e.message; }
    ok('E1 a console whose self-signed certificate says it ended in 2020 is still the same console: pinned on first contact and used after, the date is not what identifies it', Array.isArray(e1) && Array.isArray(e2) && String((pins()['localhost:' + EXP_PORT] || {}).sha256).toUpperCase() === fpOf(exp.cert), { e1, e2 });
    await c.stop();

    console.log('\n── G. a console that accepts the connection and never answers ──');
    const net = require('net'); const held = [];
    const hang = net.createServer(sk => { held.push(sk); sk.on('error', () => {}); });   // takes the connection, says nothing
    await new Promise(r => hang.listen(HANG_PORT, '127.0.0.1', r));
    let cg = cfgSvc.getConfig(); cg.unifiAccess.host = '127.0.0.1:' + HANG_PORT; cfgSvc.writeConfigRaw(cg);
    const t0 = Date.now();
    const gOut = await Promise.race([ua.listDoors().then(() => 'answered', e => 'rejected: ' + e.message), sleep(20000).then(() => 'STILL WAITING after 20 s')]);
    ok(`G1 the call fails in ${Math.round((Date.now() - t0) / 1000)} s saying the console did not answer - it is never left waiting`, /^rejected/.test(gOut) && /did not answer within/.test(gOut) && Date.now() - t0 < 15000, gOut);
    for (const sk of held) { try { sk.destroy(); } catch {} }
    await new Promise(r => hang.close(r));

    console.log('\n── H. a new port on an address already trusted ──');
    // the address is trusted on PORT with the certificate C3 accepted (FAKE); the new port presents REAL
    c = await startConsole({ port: NEW_PORT, faults: { token: TOKEN } });
    cg = cfgSvc.getConfig(); cg.unifiAccess.host = '127.0.0.1:' + NEW_PORT; cfgSvc.writeConfigRaw(cg);
    let hErr = '', hChg = null; try { await ua.listDoors(); } catch (e) { hErr = e.message; hChg = e.certChanged || (e.cause && e.cause.certChanged); }
    ok('H1 the console answering on a port this unit never trusted, at an address it trusts on another port, is refused on sight - nothing sent', /has not trusted/.test(hErr) && c.state.requests.length === 0 && !pins()['127.0.0.1:' + NEW_PORT], { hErr, requests: c.state.requests.length });
    ok('H2 ...and the refusal carries what Test Connection shows the owner', hChg && hChg.newPort === true && String(hChg.now).toUpperCase() === REAL, hChg);
    try { tc = await ua.testConnection({ trustCert: REAL }); } catch (e) { tc = { err: e.message }; }
    ok('H3 the owner accepts exactly that certificate from Test Connection, and it is trusted', tc && tc.ok === true && String((pins()['127.0.0.1:' + NEW_PORT] || {}).sha256).toUpperCase() === REAL, tc);
    await c.stop();
    // ...but a new port presenting the SAME certificate as a trusted port is the same console
    c = await startConsole({ port: NEW_PORT + 1, tls: impostor, faults: { token: TOKEN } });
    cg = cfgSvc.getConfig(); cg.unifiAccess.host = '127.0.0.1:' + (NEW_PORT + 1); cfgSvc.writeConfigRaw(cg);
    let same = null; try { same = await ua.listDoors(); } catch (e) { same = e.message; }
    ok('H4 a new port presenting the very certificate already trusted on another port of that address is the same console - used without asking, and recorded', Array.isArray(same) && String((pins()['127.0.0.1:' + (NEW_PORT + 1)] || {}).sha256).toUpperCase() === FAKE, same);
    await c.stop();

    console.log('\n── F. the code ──');
    const src = fs.readFileSync(path.join(root, 'services', 'unifiaccess.js'), 'utf8');
    const offs = src.split('\n').filter(l => /rejectUnauthorized\s*:\s*false/.test(l) && !/^\s*\/\//.test(l.trim()) && !/^\s*\/\/|^\s*\*/.test(l));
    const agentCls = (src.match(/class ConsoleAgent extends https\.Agent \{[\s\S]*?\n\}/) || [''])[0];
    ok('F1 chain checking is off in exactly one line of code, inside the pinning agent, which judges the certificate before handing the socket over', offs.length === 1 && agentCls.includes(offs[0].trim()) && /judgeCert\(/.test(agentCls) && /sock\.destroy\(\)/.test(agentCls), offs);
    ok('F2 ...and no plain agent with checking off remains', !/new https\.Agent\(\{\s*rejectUnauthorized:\s*false/.test(src));
  } catch (e) { ok('the battery ran to completion', false, String(e && e.stack || e)); }
  finally {
    if (server) { server.kill('SIGINT'); await new Promise(res => { server.on('exit', res); setTimeout(res, 4000); }); }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  }
  console.log(`\nUNIFI CERTIFICATE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
