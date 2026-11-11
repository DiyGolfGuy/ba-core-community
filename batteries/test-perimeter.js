// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// test-perimeter.js - WHAT THE OUTSIDE CAN REACH, AND WHAT IT IS TOLD BACK
// (maintainer, Sep 21 2026, from the pilot facility handoff's section 1 and the tunnel trace.)
//
// Every check here drives a REAL REQUEST at the real server wearing the shape
// cloudflared actually delivers: a loopback socket carrying cf-connecting-ip
// and cf-ray. A test that calls the function proves nothing about the
// perimeter - the whole class of bug this battery exists for is a guard that
// is never reached, or one that is reached and does not fire.
//
// The unit under test is staged the way a SHIPPED unit is: sealed
// (server.bootstrapAuth present) with setup.completed true. That combination
// is what made the setup guard's && chain fall open.
//
//   1 SETUP      /api/setup/* is over, and never answers the internet
//   2 RETIRED    a route whose name says retired answers 410 and does nothing
//   3 PAYLOAD    an unauthenticated response carries no person and no id
//   4 DOORPIN    the owner's log never holds a door code in the clear
//   5 UPLOAD     a refused upload never destroys the file it did not replace
//   6 PINORACLE  a member PIN cannot be guessed at speed on a side route
//   9 ONEREQUEST one request from the internet never stops the server
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
const BASE = 'http://127.0.0.1:3001';
const ADMIN_PW = 'battery-owner-pass-1';
// EXACTLY what cloudflared puts on a request: it connects from loopback on the
// unit itself and adds Cloudflare's own headers. A LAN visitor never has these.
const TUNNEL_IP = '203.0.113.77';
const CF = { 'cf-connecting-ip': TUNNEL_IP, 'cf-ray': '8f2a1b9c4d3e0000-IAD', 'x-forwarded-proto': 'https' };

async function req(method, p, { headers = {}, body, tunnel = true, raw = false } = {}) {
  const o = { method, headers: { ...(tunnel ? CF : {}), ...headers } };
  if (body !== undefined) { o.body = raw ? body : JSON.stringify(body); if (!raw) o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + p, o);
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t, headers: r.headers };
}
const tun = (m, p, o) => req(m, p, { ...o, tunnel: true });
const lan = (m, p, o) => req(m, p, { ...o, tunnel: false });
const readCfg = () => JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function upload(p, field, bytes, name, type, auth) {
  const fd = new FormData(); fd.append(field, new Blob([bytes], { type }), name);
  const r = await fetch(BASE + p, { method: 'POST', headers: { ...CF, ...auth }, body: fd });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}
const pad = n => String(n).padStart(2, '0');

(async () => {
  // ── the lock stand-in, so a real door code is really issued ───────────────
  const { startLock } = require('./tools/remotelock-standin');
  const L = await startLock();
  process.env.BA_REMOTELOCK_BASE = L.base;
  process.env.BA_REMOTELOCK_AUTH = L.auth;

  // ── stage a SHIPPED unit: sealed, setup done ──────────────────────────────
  const today = new Date();
  const soon = new Date(Date.now() + 10 * 60000);           // inside the 15-min door lead
  const DDATE = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`;
  const DSTART = `${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  const dEnd = new Date(soon.getTime() + 60 * 60000);
  const DEND = `${pad(dEnd.getHours())}:${pad(dEnd.getMinutes())}`;
  // A session PLAYING RIGHT NOW on the same bay, paid by card, ending before the
  // door booking starts - so /api/session/status hands its id to anyone (the bay
  // PC watcher needs it, rule 36) and section 3 can ask what that id opens.
  const ymdOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hmOf  = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // It started at 23:50 YESTERDAY, so it crosses midnight whatever the hour the
  // battery runs - the owner's bookings list used to mark such a session
  // completed while it was still being played (3g1).
  const pS = new Date(); pS.setDate(pS.getDate() - 1); pS.setHours(23, 50, 0, 0);
  const pE = new Date(Date.now() + 5 * 60000);
  const PLAY = { id: 'perim-playing', name: 'Odalys Venturini', phone: '+15550199', email: 'odalys@example.com',
                 pi: 'pi_perim_playing_now', date: ymdOf(pS), start: hmOf(pS), end: hmOf(pE), endDate: ymdOf(pE) };
  {
    const p = './config.json'; let c = {};
    if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
    c.server = c.server || {};
    delete c.server.adminAuth; delete c.server.adminAuthDefault;
    c.server.adminPassword = ADMIN_PW;
    c.server.businessName = 'Perimeter Facility';
    c.server.bootstrapAuth = 'scrypt$perimeter$sealedunit';   // isSealed() === true, as shipped
    c.setup = Object.assign({}, c.setup, { completed: true });
    c.stripe = {};
    c.waiver = Object.assign({}, c.waiver, { mode: 'off' });
    c.bays = [{ id: 'bay1', name: 'Bay 1', active: true }];
    c.booking = Object.assign({}, c.booking, {
      openDays: ['mon','tue','wed','thu','fri','sat','sun'], open24Hours: true,
      openTime: '00:00', closeTime: '23:59', windowDays: 60, minSessionMins: 30, maxSessionMins: 240
    });
    c.doorAccess = { provider: 'remotelock' };
    c.remotelock = { clientId: 'rl-client', clientSecret: 'rl-secret', deviceId: 'lock-1' };
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  }
  try { fs.unlinkSync('./bookings.db'); } catch {}
  // the logo section uploads a real logo: it is taken away at the end if there was none before (a
  // battery leaves the tree as it found it - test-hardening, run after this one, looks for no logo)
  const logosBefore = new Set((() => { try { return fs.readdirSync('public/uploads').filter(f => /^logo\./.test(f)); } catch { return []; } })());

  // A booking already on the books before the unit boots (rule 22's shape), due
  // a door code inside the lead window - so the boot tick issues one for real.
  await new Promise((resolve) => {
    const seed = spawn(process.execPath, ['-e', `
      const db = require('./services/db');
      db.initDb().then(() => {
        db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status) VALUES ('perim-door','bay1','Bay 1','Marcus Delacroix','+15550177','m@example.com',?,?,?,?,60,0,'active')")
          .run(${JSON.stringify(DDATE)}, ${JSON.stringify(DSTART)}, ${JSON.stringify(DEND)}, ${JSON.stringify(DDATE)});
        const P = ${JSON.stringify(PLAY)};
        db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,stripe_payment_intent) VALUES (?,'bay1','Bay 1',?,?,?,?,?,?,?,55,5500,'active',?)")
          .run(P.id, P.name, P.phone, P.email, P.date, P.start, P.end, P.endDate, P.pi);
        db.save(); setTimeout(() => process.exit(0), 400);
      });`], { stdio: 'ignore' });
    seed.on('exit', resolve);
  });

  const child = spawn('node', ['server.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SMS_DRYRUN: '1', EMAIL_DRYRUN: '1' } });
  let boot = ''; child.stdout.on('data', d => boot += d); child.stderr.on('data', d => boot += d);
  for (let i = 0; i < 80; i++) { try { const r = await fetch(BASE + '/api/time'); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 300)); }
  await new Promise(r => setTimeout(r, 1200));
  const done = async () => { try { child.kill('SIGTERM'); } catch {} try { L.stop && L.stop(); } catch {}
    await new Promise(r => setTimeout(r, 300));
    try { for (const f of fs.readdirSync('public/uploads')) if (/^logo\./.test(f) && !logosBefore.has(f)) fs.unlinkSync(path.join('public/uploads', f)); } catch {}
    console.log(`\nPERIMETER: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0); };

  const login = await lan('POST', '/api/auth/admin/login', { body: { password: ADMIN_PW } });
  const AH = { Cookie: (login.headers.get('set-cookie') || '').split(';')[0], 'x-csrf': login.data && login.data.csrf };
  ok('stage: sealed unit, setup complete, owner signed in', login.status === 200 && !!AH['x-csrf'], login.status);

  // ══ 1 SETUP ═══════════════════════════════════════════════════════════════
  // The guard was `isSealed() && !setupComplete() && ...` - an && chain that
  // stops guarding the moment setup finishes. On a shipped unit that left an
  // anonymous config rewrite (and the owner password) open to the internet.
  {
    const nameBefore = readCfg().server.businessName;
    const takeover = { setup: { eulaAccepted: true }, server: { businessName: 'PERIMETER PWNED', adminPassword: 'attacker-pw-1' } };

    const t = await tun('POST', '/api/setup/complete', { body: takeover });
    ok('1a setup/complete REFUSES a request off the tunnel', t.status === 403, t.status);

    const l = await lan('POST', '/api/setup/complete', { body: takeover });
    ok('1b setup/complete REFUSES on the LAN too once setup is done', l.status === 403, l.status);

    await new Promise(r => setTimeout(r, 900));
    ok('1c the config was not rewritten', readCfg().server.businessName === nameBefore, readCfg().server.businessName);

    const asAttacker = await lan('POST', '/api/auth/admin/login', { body: { password: 'attacker-pw-1' } });
    ok('1d the owner password was not replaced', asAttacker.status !== 200, asAttacker.status);
    const asOwner = await lan('POST', '/api/auth/admin/login', { body: { password: ADMIN_PW } });
    ok('1e the real owner can still sign in', asOwner.status === 200, asOwner.status);

    const log = await lan('GET', '/api/admin/log?limit=200', { headers: AH });
    const txt = JSON.stringify(log.data || '');
    ok('1f the refusal is written to the owner log', /SETUP_REFUSED/.test(txt), txt.slice(0, 200));
    ok('1g ...and it names the caller IP the tunnel reported', txt.includes(TUNNEL_IP), txt.slice(0, 200));

    // The refusal log must not become the flood it was meant to record: one row
    // per caller per hour, and the FIRST one always written (a throttle that
    // suppresses everything looks identical to a gate that never fires).
    const rowsFor = (t) => (String(t).match(/SETUP_REFUSED/g) || []).length;
    const before = rowsFor(txt);
    for (let i = 0; i < 10; i++) await tun('POST', '/api/setup/complete', { body: takeover });
    const log2 = await lan('GET', '/api/admin/log?limit=200', { headers: AH });
    ok('1j ten more refusals from the same caller add no more rows (one per IP per hour)',
       before >= 1 && rowsFor(JSON.stringify(log2.data || '')) === before, { before, after: rowsFor(JSON.stringify(log2.data || '')) });

    // the siblings already refused correctly - they must keep doing so
    const usb = await tun('GET', '/api/setup/check-usb');
    ok('1h setup/check-usb still refused after setup', usb.status === 403, usb.status);
    const rst = await tun('POST', '/api/setup/restore', { body: { backupPath: '/tmp/x.zip' } });
    ok('1i setup/restore still refused after setup', rst.status === 403, rst.status);
  }

  // ══ 2 RETIRED ═════════════════════════════════════════════════════════════
  // The retirement had been applied to the wrong one of two adjacent routes:
  // /cancel/:id answered 410 while /cancel-legacy-disabled/:id ran for real.
  {
    const d = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const mk = await tun('POST', '/api/bookings/create-payment-intent', {
      body: { bay_id: 'bay1', date: d, start_time: '14:00', duration_minutes: 60, name: 'Ines Vargas', phone: '5550188', email: 'i@example.com' } });
    const bid = mk.data && mk.data.bookingId;
    ok('2a (a live booking to aim at)', mk.status === 200 && !!bid, mk.status);

    const c = await tun('POST', '/api/bookings/cancel-legacy-disabled/' + bid);
    ok('2b the legacy cancel answers 410, not 200', c.status === 410, { status: c.status, data: c.data });

    const list = await lan('GET', '/api/admin/bookings?date=' + d, { headers: AH });
    const rows = (list.data && (list.data.bookings || list.data)) || [];
    const mine = (Array.isArray(rows) ? rows : []).find(b => b && b.id === bid);
    ok('2c the booking it aimed at is still active', !!mine && mine.status === 'active', mine && mine.status);

    const sib = await tun('POST', '/api/bookings/cancel/' + bid);
    ok('2d the sibling /cancel/:id is still retired', sib.status === 410, sib.status);

    // no route may CLAIM retirement in its name and then do the work
    const claims = [];
    for (const f of ['routes/bookings.js','routes/admin.js','routes/members.js','routes/staff.js','routes/pos.js',
                     'routes/waivers.js','routes/pricing.js','routes/memberships.js','routes/gifts.js',
                     'routes/customer.js','routes/terminal.js','routes/uploads.js','routes/website.js','routes/me.js','server.js']) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^(?:router|app)\.(get|post|put|delete)\('([^']*(?:legacy|disabled|retired|deprecated)[^']*)'/gm)) {
        claims.push({ file: f, method: m[1].toUpperCase(), route: m[2] });
      }
    }
    let allRetired = true;
    for (const c2 of claims) {
      const prefix = c2.file === 'server.js' ? '' : '/api/' + path.basename(c2.file, '.js');
      const p = (prefix + c2.route).replace(/:[A-Za-z0-9_]+/g, 'probe-id');
      const r = await tun(c2.method, p);
      if (r.status !== 410 && r.status !== 404) { allRetired = false; console.log('      still live: ' + c2.method + ' ' + p + ' -> ' + r.status); }
    }
    ok('2e every route whose NAME claims retirement actually answers 410/404 (' + claims.length + ' checked)', allRetired);
  }

  // ══ 3 PAYLOAD ═════════════════════════════════════════════════════════════
  // availability is anonymous and was handing out every booking id and customer
  // name for a date. The page reads four fields off those rows and no more.
  {
    const d = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const NAME = 'Oluwaseun Adeyemi';
    const mk = await tun('POST', '/api/bookings/create-payment-intent', {
      body: { bay_id: 'bay1', date: d, start_time: '09:00', duration_minutes: 60, name: NAME, phone: '5550133', email: 'o@example.com' } });
    const bid = mk.data && mk.data.bookingId;
    ok('3a (a booking on the grid)', mk.status === 200 && !!bid, mk.status);

    const av = await tun('GET', '/api/bookings/availability?date=' + d);
    const body = JSON.stringify(av.data);
    const rows = (av.data && av.data.byBay && av.data.byBay.bay1) || [];
    ok('3b the customer NAME is not in the anonymous response', !body.includes(NAME), body.slice(0, 220));
    ok('3c the BOOKING ID is not in the anonymous response', !!bid && !body.includes(bid), body.slice(0, 220));
    ok('3d no row carries an id/name/phone/email key at all',
       rows.every(r => !('id' in r) && !('name' in r) && !('phone' in r) && !('email' in r)), rows[0]);
    ok('3e the four fields the page DOES read are still there',
       rows.length === 1 && rows[0].date === d && rows[0].start_time === '09:00' && !!rows[0].end_time && 'end_date' in rows[0], rows[0]);
    ok('3f the grid still marks that slot taken (booking not broken)', av.data && av.data.slotFree && av.data.slotFree['09:00'] === false, av.data && av.data.slotFree && av.data.slotFree['09:00']);

    // the owner's own grid is a different, authenticated route and keeps the name
    const adm = await lan('GET', '/api/admin/bookings?date=' + d, { headers: AH });
    ok('3g the OWNER still sees the name on their own authenticated route', JSON.stringify(adm.data).includes(NAME));
    // Opening that list auto-completes sessions that are over. It judged "over" by
    // the day a session STARTED, so one that began before midnight was ended on
    // the spot while the customer was still playing (found by this battery on the
    // Pi at 00:15 - the workshop had only ever run it in daylight).
    const mine = await lan('GET', '/api/admin/bookings?search=' + encodeURIComponent(PLAY.name), { headers: AH });
    const playRow = ((mine.data && mine.data.bookings) || []).find(b => b.id === PLAY.id);
    ok('3g1 opening the owner\'s bookings list does NOT end a session that started before midnight and is still being played',
       !!playRow && playRow.status === 'active', playRow && { status: playRow.status, date: playRow.date, end_date: playRow.end_date, end_time: playRow.end_time });

    // the rest of the anonymous surface carries no person either
    for (const p of ['/api/bookings/bays', '/api/bookings/pricing', '/api/memberships/public', '/api/waivers/active',
                     '/api/booking-rules', '/api/bookings/availability-by-time?date=' + d + '&start_time=09:00']) {
      const r = await tun('GET', p);
      const t = JSON.stringify(r.data || '');
      ok('3h ' + p + ' carries no customer name', !t.includes(NAME) && !t.includes('Marcus Delacroix'), t.slice(0, 140));
    }

    // ── RULE 37 (maintainer, Sep 23 2026): a public route never returns a person's name,
    //    contact details, door code or payment details, however the caller got
    //    the id. The id of whoever is playing is PUBLIC - the bay PC watcher reads
    //    it (rule 36) - so an id is never a credential. It used to be one:
    //    /confirm answered an active booking's id with the customer's name, which
    //    made "who is in Bay 1 right now" two anonymous calls from the internet.
    const person = t => [PLAY.name, PLAY.phone, PLAY.phone.slice(2), PLAY.email, PLAY.pi].filter(v => t.includes(v));
    const st = await tun('GET', '/api/session/status?bay=bay1');
    ok('3i the session reply still hands the playing booking\'s id to anyone - the bay PC watcher needs it (rule 36)',
       st.status === 200 && st.data && st.data.active === true && st.data.bookingId === PLAY.id, st.data);
    ok('3j ...and carries no person with it', person(JSON.stringify(st.data)).length === 0, person(JSON.stringify(st.data)));
    const c1 = await tun('POST', '/api/bookings/confirm', { body: { bookingId: PLAY.id } });
    ok('3k /confirm with ONLY that id answers the booking\'s bay and times - and no name, phone, email or payment id',
       c1.status === 200 && c1.data && c1.data.booking && c1.data.booking.bay_name === 'Bay 1' && person(c1.text).length === 0 && !('name' in c1.data.booking),
       { status: c1.status, found: person(c1.text), booking: c1.data && c1.data.booking });
    const c2 = await tun('POST', '/api/bookings/confirm', { body: { bookingId: PLAY.id, paymentIntentId: 'pi_somebody_elses' } });
    ok('3l ...nor with a payment id that is not the one this booking holds',
       c2.status === 200 && person(c2.text).length === 0, { status: c2.status, found: person(c2.text) });
    const c3 = await tun('POST', '/api/bookings/confirm', { body: { bookingId: PLAY.id, paymentIntentId: PLAY.pi } });
    ok('3m WITH the payment id this booking holds - the customer back from Klarna, whose address bar carries it - the confirmation names them',
       c3.status === 200 && c3.data && c3.data.booking && c3.data.booking.name === PLAY.name, c3.data);
    const c4 = await tun('POST', '/api/bookings/confirm', { body: { paymentIntentId: PLAY.pi } });
    ok('3n ...and with the payment id alone (a page from before the return fix carries only Stripe\'s parameter)',
       c4.status === 200 && c4.data && c4.data.booking && c4.data.booking.name === PLAY.name, c4.data);
  }

  // ══ 4 DOORPIN ═════════════════════════════════════════════════════════════
  // admin_log is kept at least twelve months and rides inside every backup, so
  // a door code written there in the clear outlives the session it belongs to.
  {
    const log = await lan('GET', '/api/admin/log?limit=400', { headers: AH });
    const txt = JSON.stringify(log.data || '');
    // A LOG WE CANNOT READ GRADES NOTHING. Without this line 4c/4d pass on an
    // Unauthorized body, which is how a check that never ran looks identical to
    // one that passed - the defect class this battery exists for.
    const logOk = log.status === 200 && /"event"|DOOR_CODE|ADMIN_LOGIN|BOOKING/.test(txt);
    ok('4a0 the owner log is readable (else nothing below is graded)', logOk, { status: log.status, body: txt.slice(0, 120) });
    ok('4a the boot tick really issued a door code', logOk && /DOOR_CODE_CREATED/.test(txt), txt.slice(0, 200));
    const issued = L.pins();                       // every PIN the stand-in lock holds
    const pin = issued[issued.length - 1];
    ok('4b (the stand-in lock recorded the PIN it handed out)', !!pin, issued);
    // THE PIN AS A VALUE, NOT A SUBSTRING (maintainer, Sep 23 2026). This searched the
    // whole log for the digits, and the stand-in's first PIN is always 1007 - so
    // a booking id or payment id with 1007 inside it failed the battery (seen
    // once, then nine clean runs). A code written into the log is a value of its
    // own - "PIN: 1007", "code 1007", "pin=1007" - so each entry is split into
    // words, a hyphen kept inside a word so an id stays one word, and no PIN the
    // lock handed out may BE one of them.
    const words = t => String(t || '').split(/[\s|,;:=()\[\]{}"'\/.]+/).filter(Boolean);
    const holdsPin = (t, p) => words(t).includes(String(p));
    ok('4c0 the matcher is graded both ways: it finds a PIN written as a value, and not an id, a time or a phone number that merely contains the digits',
       ['PIN: 1007', 'Code 1007 for Bay 1', 'access_pin=1007', 'door code (1007)'].every(t => holdsPin(t, '1007')) &&
       !['ID: 3f1007ab-9c2e-4d1a-8b7e-0a1b2c3d4e5f', 'a1b2c3d4-1007-4abc-8def-001122334455', 'at 2026-09-23 03:10:07', 'pi_3UI1007xyz', '+15551007123'].some(t => holdsPin(t, '1007')));
    const entries = (log.data && (log.data.entries || log.data)) || [];
    const withPin = Array.isArray(entries) ? entries.filter(e => issued.some(p => holdsPin(e.detail, p) || holdsPin(e.event, p))) : [];
    ok('4c no PIN the lock handed out (' + issued.length + ') appears as a value in any owner log entry (' + (Array.isArray(entries) ? entries.length : 0) + ' read)',
       logOk && issued.length > 0 && Array.isArray(entries) && entries.length > 0 && withPin.length === 0, withPin.slice(0, 3));
    ok('4d no DOOR_CODE line carries a "PIN: <digits>" field', logOk && !/PIN:\s*\d/.test(txt), (txt.match(/PIN:[^"]{0,14}/) || [])[0]);
  }

  // ══ 5 UPLOAD ══════════════════════════════════════════════════════════════
  // multer writes straight to logo.<ext>, so a refused upload overwrote (and
  // then deleted) the logo the owner already had.
  {
    const good = await upload('/api/uploads/logo', 'image', PNG1, 'logo.png', 'image/png', AH);
    ok('5a a real PNG uploads', good.status === 200, good.data);
    const st1 = await tun('GET', '/api/uploads/logo');
    ok('5b the logo is there afterwards', st1.status === 200 && st1.data && (st1.data.exists || st1.data.url || st1.data.filename), st1.data);
    const before = JSON.stringify(st1.data);

    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    // Only meaningful if 5a/5b actually put a logo there: a 401 upload would
    // otherwise make "refused" and "logo intact" both trivially true.
    const haveLogo = good.status === 200 && st1.status === 200 && !!(st1.data && (st1.data.hasLogo || st1.data.url));
    const bad = await upload('/api/uploads/logo', 'image', html, 'logo.png', 'image/png', AH);
    ok('5c a file that only CLAIMS to be a PNG is refused', haveLogo && bad.status >= 400, { haveLogo, status: bad.status, data: bad.data });

    const st2 = await tun('GET', '/api/uploads/logo');
    ok('5d the owner STILL has the logo they had before the refused upload',
       haveLogo && st2.status === 200 && JSON.stringify(st2.data) === before, { haveLogo, before, after: st2.data });
  }

  // ══ 6 PINORACLE ═══════════════════════════════════════════════════════════
  // /api/waivers/needed?pin= answers differently for a real PIN, on a route the
  // member-PIN guess limiter never covered.
  {
    await lan('POST', '/api/members/tiers', { headers: AH, body: { name: 'Perimeter Tier', price_cents: 1000, billing_period: 'monthly' } });
    const tl = await lan('GET', '/api/members/tiers', { headers: AH });
    const tierId = (((tl.data && (tl.data.tiers || tl.data)) || [])[0] || {}).id;
    const REAL_PIN = '7731';
    const mk = await lan('POST', '/api/members', { headers: AH, body: { name: 'Zofia Kaminski', phone: '5550155', email: 'z@example.com', tier_id: tierId, pin: REAL_PIN } });
    ok('6a (a member with a known PIN exists)', mk.status === 200, { s: mk.status, d: mk.data });

    let blocked = 0, answered = 0;
    for (let i = 0; i < 45; i++) {
      const r = await tun('GET', '/api/waivers/needed?pin=90' + pad(i) + '&date=2026-10-01&start_time=10:00');
      if (r.status === 429) { blocked++; break; } else answered++;
    }
    ok('6b guessing a member PIN on /api/waivers/needed is rate limited', blocked > 0, 'answered ' + answered + ' wrong-PIN probes with no 429');
    // The club on one wi-fi must not lock ITSELF out: a RIGHT code is not a guess
    // and must never spend the budget. Asked from a DIFFERENT caller IP, because
    // the wrong-guess run above has deliberately exhausted this one - once an IP
    // is over its budget everything from it is refused, which is the point.
    let rightBlocked = 0, rightOk = 0;
    for (let i = 0; i < 40; i++) {
      const r = await req('GET', '/api/waivers/needed?pin=' + REAL_PIN + '&date=2026-10-01&start_time=10:00',
        { headers: { 'cf-connecting-ip': '198.51.100.9', 'cf-ray': '8f2a1b9c4d3e0001-IAD' }, tunnel: false });
      if (r.status === 429) rightBlocked++; else rightOk++;
    }
    ok('6c 40 uses of the REAL code from one address are never rate limited', mk.status === 200 && rightBlocked === 0 && rightOk === 40,
       { ok: rightOk, blocked: rightBlocked });
  }

  // ══ 7 THE THREE THAT WERE LEFT ════════════════════════════════════════════
  // Each with a CONTROL: the refusal must be the guard firing, not the route
  // being broken or unreachable for some unrelated reason.
  {
    // ── 7a 2FA cannot be replaced with the password alone ──────────────────
    // Not enrolled yet: enrolling is allowed with the password (that is how an
    // owner turns 2FA on in the first place) - this is the control.
    const first = await lan('POST', '/api/auth/2fa/setup', { headers: { 'x-admin-password': ADMIN_PW }, body: { currentPassword: ADMIN_PW } });
    ok('7a0 CONTROL: with no factor enrolled, the password alone may enrol one', first.status === 200 && !!(first.data && first.data.secret), first.status);
    // Finish that enrolment so the unit really is enrolled.
    const totp = (secret, t) => {
      const crypto = require('crypto');
      const b32 = (s2) => { let bits = ''; const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        for (const c of s2.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
        const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
        return Buffer.from(out); };
      const ctr = Buffer.alloc(8); ctr.writeUInt32BE(Math.floor(t / 30), 4);
      const h = crypto.createHmac('sha1', b32(secret)).update(ctr).digest();
      const o = h[h.length - 1] & 0xf;
      return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0');
    };
    const code = totp(first.data.secret, Math.floor(Date.now() / 1000));
    const conf = await lan('POST', '/api/auth/2fa/confirm', { headers: { 'x-admin-password': ADMIN_PW }, body: { code } });
    ok('7a1 (the unit is now really enrolled)', conf.status === 200, { s: conf.status, d: conf.data });

    const replace = await tun('POST', '/api/auth/2fa/setup', { headers: { 'x-admin-password': ADMIN_PW }, body: { currentPassword: ADMIN_PW } });
    ok('7a2 the password ALONE can no longer replace an enrolled second factor', replace.status === 401 && !(replace.data && replace.data.secret), { s: replace.status, keys: Object.keys(replace.data || {}) });

    const withCode = await lan('POST', '/api/auth/2fa/setup', { headers: { 'x-admin-password': ADMIN_PW },
      body: { currentPassword: ADMIN_PW, code: totp(first.data.secret, Math.floor(Date.now() / 1000)) } });
    ok('7a3 CONTROL: the owner WITH a current code can still re-enrol', withCode.status === 200 && !!(withCode.data && withCode.data.secret), withCode.status);

    const log7 = await lan('GET', '/api/admin/log?limit=200', { headers: AH });
    ok('7a4 the refused replacement is in the owner log', /2FA_REPLACE_REFUSED/.test(JSON.stringify(log7.data || '')));
  }
  {
    // ── 7b a webhook signed with an EMPTY secret is refused ────────────────
    const crypto = require('crypto');
    const payload = JSON.stringify({ id: 'evt_perim', type: 'invoice.paid', data: { object: { id: 'in_p', subscription: 'sub_p', customer: 'cus_p' } } });
    const t = Math.floor(Date.now() / 1000);
    const sign = (sec) => 't=' + t + ',v1=' + crypto.createHmac('sha256', sec).update(t + '.' + payload).digest('hex');
    // the unit is staged with stripe.webhookSecret = '' (the state of every unit
    // that never registered one - rule 24 skips reserved and private hosts)
    const forged2 = await fetch(BASE + '/api/stripe/webhook', { method: 'POST',
      headers: { ...CF, 'Content-Type': 'application/json', 'stripe-signature': sign('') }, body: payload });
    ok('7b0 an event signed with the EMPTY secret is refused (anyone can compute that one)', forged2.status === 400, forged2.status);
    const nosig = await fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { ...CF, 'Content-Type': 'application/json' }, body: payload });
    ok('7b1 CONTROL: an unsigned event is refused too', nosig.status === 400, nosig.status);
    // and with a REAL secret configured the same event is accepted - so 7b0 is
    // the empty key being refused, not the handler being broken
    const cfg = readCfg(); cfg.stripe = Object.assign({}, cfg.stripe, { webhookSecret: 'whsec_perimeter_real' });
    fs.writeFileSync('./config.json', JSON.stringify(cfg, null, 2));
    await new Promise(r => setTimeout(r, 1200));
    const t2 = Math.floor(Date.now() / 1000);
    const good = await fetch(BASE + '/api/stripe/webhook', { method: 'POST',
      headers: { ...CF, 'Content-Type': 'application/json',
        'stripe-signature': 't=' + t2 + ',v1=' + crypto.createHmac('sha256', 'whsec_perimeter_real').update(t2 + '.' + payload).digest('hex') },
      body: payload });
    ok('7b2 CONTROL: with a REAL secret the same event is accepted (the handler works)', good.status === 200, good.status);
    cfg.stripe = Object.assign({}, cfg.stripe, { webhookSecret: '' });
    fs.writeFileSync('./config.json', JSON.stringify(cfg, null, 2));
    await new Promise(r => setTimeout(r, 1200));
  }
  {
    // ── 7c record-usage requires admin ─────────────────────────────────────
    const anon = await tun('POST', '/api/members/record-usage', { body: { member_id: 'anon', booking_id: 'anon', date: '2026-10-01', duration_minutes: 60, guest_count: 3 } });
    ok('7c0 record-usage refuses an anonymous write', anon.status === 401 || anon.status === 403, { s: anon.status, d: anon.data });
    const asOwner = await lan('POST', '/api/members/record-usage', { headers: AH, body: { member_id: 'anon', booking_id: 'anon', date: '2026-10-01', duration_minutes: 60, guest_count: 3 } });
    ok('7c1 CONTROL: the owner can still record usage (the route is not simply broken)', asOwner.status === 200, { s: asOwner.status, d: asOwner.data });
  }

  // ══ 8 THE PERIMETER ITSELF ════════════════════════════════════════════════
  // Not one route: the properties that must hold on EVERY response a stranger
  // can get, so a new route inherits them instead of having to remember them.
  {
    const samples = [
      ['an API answer',      'GET',  '/api/bookings/bays'],
      ['a customer page',    'GET',  '/book'],
      ['a 404',              'GET',  '/api/no-such-thing-at-all'],
      ['a refused reach',    'GET',  '/api/setup/check-usb'],
    ];
    let hdrMissing = [], disclosed = [];
    for (const [what, m, p] of samples) {
      const r = await tun(m, p);
      const h = (k) => r.headers.get(k);
      for (const need of ['x-content-type-options', 'referrer-policy', 'content-security-policy']) {
        if (!h(need)) hdrMissing.push(what + ' (' + p + ') has no ' + need);
      }
      // nothing may name the stack or a version to an anonymous caller
      for (const leaky of ['x-powered-by', 'server', 'x-aspnet-version']) {
        const v = h(leaky);
        if (v && !/^cloudflare$/i.test(v)) disclosed.push(what + ' -> ' + leaky + ': ' + v);
      }
      // A STACK TRACE, not the word "express" somewhere in a page. The first
      // cut of this matched any HTML body and failed on /book's own copyright
      // comment - a check that fails on everything is as useless as one that
      // fails on nothing. What must never reach a stranger is a Node stack,
      // an absolute server path, or a version banner.
      const body = String(r.text || '');
      const stackish = [
        /\n\s+at [A-Za-z0-9_.<>\[\]]+ \(\/(home|usr|opt|var)\//,   // "    at fn (/home/..."
        /\n\s+at \/(home|usr|opt|var)\//,                          // "    at /home/..."
        /node:internal\//,                                          // node's own frames
        /\/home\/[a-z]+\/booking-system\//,                         // an absolute server path
        /Express\/[0-9]/i, /Node\.js v[0-9]/i,                      // version banners
      ];
      for (const re of stackish) if (re.test(body)) disclosed.push(what + ' -> the BODY carries ' + re + ': ' + body.slice(Math.max(0, body.search(re) - 20), body.search(re) + 90));
    }
    ok('8a every sampled response carries the security headers', hdrMissing.length === 0, hdrMissing);
    ok('8b nothing names the stack, a version or a server path to an anonymous caller', disclosed.length === 0, disclosed);

    // Every route that ACCEPTS a credential must have a limiter in front of it.
    // Read from server.js, so a new credential route with no limiter fails here
    // rather than waiting for someone to notice.
    const srv = fs.readFileSync('server.js', 'utf8');
    const CREDENTIAL_ROUTES = [
      '/api/auth/admin/login', '/api/auth/admin/login-2fa', '/api/auth/2fa/step-up',
      '/api/customer/request-pin', '/api/customer/verify-pin', '/api/customer/cancel',
      '/api/members/validate-pin', '/api/members/portal', '/api/memberships/portal',
      '/api/waivers/needed', '/api/pricing/validate-code', '/api/staff/login', '/api/me/login',
    ];
    const noLimiter = [];
    for (const cr of CREDENTIAL_ROUTES) {
      // either its own app.use(<path>, <limiter>) line, or a limiter applied
      // inside the route file / a counter the product keeps for it
      const mounted = new RegExp("app\\.use\\('" + cr.replace(/\//g, '\\/') + "'\\s*,\\s*\\w*[Ll]imiter").test(srv);
      const counted = /loginLocked|failedAttempts|staff\.login/.test(srv) && /\/api\/(auth|staff|me)\//.test(cr);
      if (!mounted && !counted) noLimiter.push(cr);
    }
    ok('8c every route that accepts a password, PIN or code is rate limited (' + CREDENTIAL_ROUTES.length + ' checked)',
       noLimiter.length === 0, noLimiter);

    // and prove one of them really refuses, rather than trusting the grep
    let hit429 = false;
    for (let i = 0; i < 30; i++) {
      const r = await req('POST', '/api/customer/request-pin', { headers: { 'cf-connecting-ip': '198.51.100.77', 'cf-ray': 'r' }, tunnel: false, body: { phone: '5550000001' } });
      if (r.status === 429) { hit429 = true; break; }
    }
    ok('8d CONTROL: a credential route really answers 429 when hammered (the greps above are not the only evidence)', hit429);
  }

  // ══ 9 ONE REQUEST NEVER STOPS THE SERVER ══════════════════════════════════
  // Oct 24 2026, GHSA-27r3-jxmh-p828 (body-parser before 1.20.9): a body sent
  // gzip-compressed, one good frame and then more bytes, was answered normally -
  // and the bytes still arriving reached the decoder after it had finished, whose
  // error nothing caught, and the whole process exited. The JSON parser runs
  // before any route, so it needed no sign-in and no real path: anyone who can
  // reach the booking site could take the unit down, again and again. The shape
  // is the fix's own test (the frame, one zero byte, 100 KB more); the 10 KB
  // limit never stops it, because a compressed body's size is only known once
  // decoded. Proven on the running server, through the tunnel's shape.
  {
    const zlib = require('zlib'), http = require('http');
    const alive = async () => { await new Promise(r => setTimeout(r, 600));
      let up = false; try { up = (await fetch(BASE + '/api/time')).ok; } catch {}
      return child.exitCode === null && child.signalCode === null && up; };
    const send = (p, body, enc, type) => new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: 3001, method: 'POST', path: p, agent: false,
        headers: { ...CF, 'Content-Type': type, 'Content-Encoding': enc, 'Content-Length': body.length } },
        res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('error', () => resolve('no answer'));
      r.setTimeout(5000, () => r.destroy());
      r.end(body);
    });
    const json = Buffer.from(JSON.stringify({ code: 'NO-SUCH-CODE-9' }));
    const after = Buffer.concat([Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
    // CONTROL first: a compressed body is really decoded and read (the same answer as the plain one), so the checks
    // below reach the decoder rather than being turned away before it
    const plain = await tun('POST', '/api/pricing/validate-code', { body: { code: 'NO-SUCH-CODE-9' } });
    const gz = await fetch(BASE + '/api/pricing/validate-code', { method: 'POST', headers: { ...CF, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: zlib.gzipSync(json) });
    const gzText = await gz.text();
    ok('9a CONTROL: a gzip body is decoded and read like a plain one', gz.status === plain.status && gzText === plain.text, { plain: [plain.status, plain.text.slice(0, 80)], gzip: [gz.status, gzText.slice(0, 80)] });
    const shapes = [
      ['gzip JSON with 100 KB after the frame', '/api/pricing/validate-code', Buffer.concat([zlib.gzipSync(json), after]), 'gzip', 'application/json'],
      ['the same to a path nobody routes', '/api/no-such-route-9', Buffer.concat([zlib.gzipSync(json), after]), 'gzip', 'application/json'],
      ['a texting webhook form, gzip with 100 KB after the frame', '/api/twilio/incoming', Buffer.concat([zlib.gzipSync(Buffer.from('From=%2B15550100&Body=hi')), after]), 'gzip', 'application/x-www-form-urlencoded'],
      ['deflate JSON with 100 KB after the frame', '/api/pricing/validate-code', Buffer.concat([zlib.deflateSync(json), after]), 'deflate', 'application/json'],
    ];
    let n = 0;
    for (const [what, p, body, enc, type] of shapes) {
      n++;
      const s = await send(p, body, enc, type);
      ok('9' + String.fromCharCode(97 + n) + ' the server is still running after ' + what + ' (answered ' + s + ')', await alive(),
         child.exitCode !== null || child.signalCode ? { exit: child.exitCode, signal: child.signalCode, log: boot.slice(-300) } : 'no answer on /api/time');
      if (child.exitCode !== null || child.signalCode) break;   // nothing after a crash can be read
    }
  }

  await done();
})().catch(e => { console.error(e); process.exit(1); });
