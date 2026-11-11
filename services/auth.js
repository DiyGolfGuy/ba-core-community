// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/auth.js — owner authentication core (Security Wave, Aug 2026).
//
// WHAT THIS REPLACES: a plaintext admin password stored in config.json,
// compared verbatim in eleven different places, carried in browser JS,
// sessionStorage, and even a query string. All of that dies here.
//
// THE MODEL (per the Aug 11 security addendum, bank-style):
//   at rest      -> scrypt verifier only (Node built-in; zero new deps)
//   browser      -> login once, opaque HttpOnly cookie session + CSRF token
//                   held in JS memory; the password itself is never stored
//   programmatic -> none: there is no password header. Every admin request
//                   carries the session cookie, and a mutating one the CSRF
//                   token (the batteries exchange a header for a real session
//                   in test support only - batteries/support)
//   pre-setup    -> the setup screen answers only on the Pi's own loopback
//                   (the private SSH forward) until the owner password is set
//   remote MFA   -> Cloudflare Access, customer-side, documented later.
//
// Sessions are in-memory by design: a Pi restart logs the owner out, which
// is the correct failure mode for an appliance (nothing persisted to steal).
'use strict';

const crypto = require('crypto');
const configService = require('./config');

// ── scrypt parameters (Pi 5: ~40-70ms per verify — right for a login) ─────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT);
  return { algo: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
           salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyAgainst(record, password) {
  if (!record || !record.salt || !record.hash) return false;
  try {
    const salt = Buffer.from(record.salt, 'hex');
    const expected = Buffer.from(record.hash, 'hex');
    const got = crypto.scryptSync(String(password || ''), salt, expected.length,
      { N: record.N || SCRYPT.N, r: record.r || SCRYPT.r, p: record.p || SCRYPT.p });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch { return false; }
}

function verifyAdminPassword(password) {
  const cfg = configService.getConfig();
  const rec = cfg.server && cfg.server.adminAuth;
  if (!rec) return false;
  return verifyAgainst(rec, password);
}

// ── MANAGER ROLE (maintainer, Aug 20): a secondary operational sign-in for a
// facility manager - franchise/multi-site owners hand day-to-day control
// (bays on/off, bookings) to a manager WITHOUT handing over the keys.
// Managers pass the operational gate (requireAdmin) and are REFUSED by
// requireOwner, which guards secrets, money, hours, members, and staff.
// Enforcement is server-side; the UI hiding is a courtesy on top.
function verifyManagerPassword(password) {
  const cfg = configService.getConfig();
  const rec = cfg.server && cfg.server.managerAuth;
  if (!rec) return false;
  return verifyAgainst(rec, password);
}
function managerEnabled() {
  const cfg = configService.getConfig();
  return !!(cfg.server && cfg.server.managerAuth);
}
function setManagerPassword(pw) {
  const cfg = configService.getConfig();
  cfg.server = cfg.server || {};
  if (!pw) { delete cfg.server.managerAuth; }
  else {
    if (String(pw).length < 8) throw new Error('Manager password must be at least 8 characters');
    if (verifyAdminPassword(pw)) throw new Error('Manager password must differ from the owner password');
    cfg.server.managerAuth = hashPassword(String(pw));
  }
  configService.writeConfigRaw(cfg);
  revokeAllSessions('manager');
}
function requestRole(req) {
  if (sessionFrom(req, 'admin')) return 'owner';
  if (sessionFrom(req, 'manager')) return 'manager';
  return null;
}

// ── boot migration: plaintext -> verifier, default-password detection ─────
const DEFAULT_PASSWORDS = ['admin', 'password', 'changeme'];

function ensurePasswordHashed() {
  const cfg = configService.getConfig();
  cfg.server = cfg.server || {};
  const plain = cfg.server.adminPassword;
  if (plain && !cfg.server.adminAuth) {
    cfg.server.adminAuth = hashPassword(plain);
    cfg.server.adminAuthDefault = DEFAULT_PASSWORDS.includes(String(plain));
    delete cfg.server.adminPassword;
    configService.writeConfigRaw(cfg);
    console.log('Auth: admin password migrated to scrypt verifier; plaintext removed from config.');
    if (cfg.server.adminAuthDefault) {
      console.warn('Auth: the admin password is a WELL-KNOWN DEFAULT - change it in Settings.');
      try { require('./db').adminLog('SECURITY_WARNING', 'Admin password is a well-known default'); } catch {}
    }
  } else if (plain && cfg.server.adminAuth) {
    // #2 (pilot facility rebase): plaintext + verifier both present means a NEW password
    // was placed next to a stale template verifier. The owner's plaintext wins
    // and REPLACES the verifier - the old behavior (verifier wins) locked the
    // owner out of their own fresh unit. Running units never carry plaintext,
    // so this only triggers on an intentional password placement.
    cfg.server.adminAuth = hashPassword(plain);
    cfg.server.adminAuthDefault = DEFAULT_PASSWORDS.includes(String(plain));
    delete cfg.server.adminPassword;
    configService.writeConfigRaw(cfg);
    console.log('Auth: admin password (re)hashed from placed plaintext; stale verifier replaced.');
  }
}

function setAdminPassword(newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const cfg = configService.getConfig();
  cfg.server = cfg.server || {};
  cfg.server.adminAuth = hashPassword(newPassword);
  cfg.server.adminAuthDefault = DEFAULT_PASSWORDS.includes(String(newPassword));
  delete cfg.server.adminPassword;
  configService.writeConfigRaw(cfg);
  revokeAllSessions('admin');
}

function setupComplete() {
  return !!configService.getConfig().setup?.completed;
}

// ── sessions (opaque, in-memory, idle 60m / absolute 12h) ─────────────────
const SESSIONS = new Map();  // sid -> {scope, csrf, created, last, ip}
// A TEST SEAM, not a setting: a battery cannot prove that a keepalive keeps a
// session alive across an idle limit measured in an hour. Defaults are
// unchanged and no shipped unit sets these (Sep 18 2026).
const IDLE_MS = Number(process.env.BA_SESSION_IDLE_MS) || 60 * 60 * 1000;
const ABS_MS  = Number(process.env.BA_SESSION_ABS_MS)  || 12 * 60 * 60 * 1000;
const COOKIE  = 'ba_session';

setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of SESSIONS) {
    if (now - s.last > IDLE_MS || now - s.created > ABS_MS) SESSIONS.delete(sid);
  }
}, 5 * 60 * 1000).unref();

function createSession(scope, req) {
  const sid = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  SESSIONS.set(sid, { scope, csrf, created: Date.now(), last: Date.now(), ip: getClientIp(req) });
  return { sid, csrf };
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionFrom(req, scope) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  const s = SESSIONS.get(sid);
  if (!s || s.scope !== scope) return null;
  const now = Date.now();
  if (now - s.last > IDLE_MS || now - s.created > ABS_MS) { SESSIONS.delete(sid); return null; }
  s.last = now;
  return { sid, ...s };
}

function destroySession(req) {
  const sid = parseCookies(req)[COOKIE];
  if (sid) SESSIONS.delete(sid);
}

function revokeAllSessions(scope) {
  for (const [sid, s] of SESSIONS) if (!scope || s.scope === scope) SESSIONS.delete(sid);
}

function setSessionCookie(req, res, sid) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ABS_MS / 1000}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function isSecureRequest(req) {
  return !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']
    || (req.headers['x-forwarded-proto'] || '').includes('https') || req.secure);
}

// ── client IP (tunnel traffic all arrives via loopback; cf header is truth)
function getClientIp(req) {
  // The Cloudflare header is the truth ONLY on the tunnel's own hop -
  // cloudflared runs on this unit and connects from loopback. Anyone else
  // (a phone on the LAN, the open internet if a port were ever exposed) can
  // type that header, and before Sep 2 2026 it re-keyed the rate limits and
  // the login lockout to whatever they wrote (bench load test finding W21).
  const remote = (req.socket && req.socket.remoteAddress) || req.ip || 'unknown';
  const loopback = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(String(remote));
  const cf = req.headers['cf-connecting-ip'];
  if (cf && loopback) return String(cf).split(',')[0].trim();
  return remote;
}

// ── login abuse controls (per-IP) ─────
const FAILS = new Map();   // ip -> {count, until}
const FAIL_LIMIT = 5, FAIL_LOCK_MS = 15 * 60 * 1000;

function loginLocked(ip) {
  const f = FAILS.get(ip);
  if (f && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000);
  return 0;
}
function loginFailed(ip) {
  const f = FAILS.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= FAIL_LIMIT) { f.until = Date.now() + FAIL_LOCK_MS; f.count = 0; }
  FAILS.set(ip, f);
}
function loginSucceeded(ip) { FAILS.delete(ip); }

// ── the one authorization answer every route asks ─────────────────────────
// A valid admin or manager cookie session; mutating verbs also need the CSRF header.
function verifyAdminRequest(req) {
  const s = sessionFrom(req, 'admin') || sessionFrom(req, 'manager');
  if (s) {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!mutating || req.headers['x-csrf'] === s.csrf) return true;
    return false;
  }
  return false;
}

// Owner-only rooms: secrets, money, hours, members, staff, backups. A
// manager session is refused here no matter what the UI shows.
function requireOwner(req, res, next) {
  const s = sessionFrom(req, 'admin');
  if (s) {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!mutating || req.headers['x-csrf'] === s.csrf) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (sessionFrom(req, 'manager')) return res.status(403).json({ error: 'Owner only - your manager sign-in cannot change this.' });
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (verifyAdminRequest(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── Twilio inbound signature (HMAC-SHA1 of url + sorted params, base64) ───
function twilioSignatureValid(req) {
  const cfg = configService.getConfig();
  const token = cfg.twilio && cfg.twilio.authToken;
  const sig = req.headers['x-twilio-signature'];
  if (!token || typeof sig !== 'string' || !sig) return false;
  const proto = isSecureRequest(req) ? 'https' : (req.protocol || 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const url = `${proto}://${host}${req.originalUrl}`;
  try {
    return require('twilio').validateRequest(token, sig, url, req.body || {});
  } catch { return false; }
}

// ── TWO-FACTOR (TOTP, RFC 6238) — pure Node crypto, no dependencies ───────
// Owner-optional, two independent switches (maintainer, Aug 11):
//   enabledLogin     -> code required at sign-in
//   enabledSensitive -> fresh code required (15-min window) for the dangerous
//                       rooms: settings writes, website building, webhooks,
//                       secret keys, texting/email config.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secretB32, step) {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24 | h[o+1] << 16 | h[o+2] << 8 | h[o+3]) % 1000000;
  return String(code).padStart(6, '0');
}
function verifyTotp(secretB32, code, now = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(now / 30000);
  for (const s of [step - 1, step, step + 1]) {           // clock-drift tolerance
    const a = Buffer.from(totpCode(secretB32, s)), b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}
function twofaState() {
  const cfg = configService.getConfig();
  const t = (cfg.server && cfg.server.twofa) || {};
  return { enrolled: !!t.secret, enabledLogin: !!t.enabledLogin, enabledSensitive: !!t.enabledSensitive };
}
function verifyAnySecond(code) {
  // Accepts a live TOTP or an unused recovery code (consumed on use).
  const cfg = configService.getConfig();
  const t = cfg.server && cfg.server.twofa;
  if (!t || !t.secret) return false;
  if (verifyTotp(t.secret, code)) return true;
  const clean = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const list = t.recovery || [];
  for (let i = 0; i < list.length; i++) {
    if (!list[i].used && verifyAgainst(list[i], clean)) {
      list[i].used = true;
      configService.writeConfigRaw(cfg);
      try { require('./db').adminLog('2FA_RECOVERY_CODE_USED', `code #${i + 1}`); } catch {}
      return true;
    }
  }
  return false;
}
function beginTwofaEnroll() {
  const cfg = configService.getConfig();
  cfg.server = cfg.server || {};
  const secret = base32Encode(crypto.randomBytes(20));
  cfg.server.twofaPending = { secret, at: Date.now() };
  configService.writeConfigRaw(cfg);
  const label = encodeURIComponent(((cfg.server.businessName || 'BA') + ' Admin'));
  return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=BA%20Booking&period=30&digits=6` };
}
function confirmTwofaEnroll(code) {
  const cfg = configService.getConfig();
  const p = cfg.server && cfg.server.twofaPending;
  if (!p || Date.now() - p.at > 15 * 60 * 1000) return { ok: false, error: 'Setup expired - start again' };
  if (!verifyTotp(p.secret, code)) return { ok: false, error: 'That code did not match - check the clock on your phone and try again' };
  const codes = [];
  const recovery = [];
  for (let i = 0; i < 8; i++) {
    const raw = base32Encode(crypto.randomBytes(5)).slice(0, 8);
    codes.push(raw.slice(0, 4) + '-' + raw.slice(4));
    recovery.push(Object.assign(hashPassword(raw), { used: false }));
  }
  cfg.server.twofa = { secret: p.secret, recovery, enrolledAt: new Date().toISOString(),
                       enabledLogin: false, enabledSensitive: false };
  delete cfg.server.twofaPending;
  configService.writeConfigRaw(cfg);
  try { require('./db').adminLog('2FA_ENROLLED', ''); } catch {}
  return { ok: true, recoveryCodes: codes };
}
function setTwofaToggles({ enabledLogin, enabledSensitive }) {
  const cfg = configService.getConfig();
  if (!cfg.server || !cfg.server.twofa) return { ok: false, error: '2FA is not set up' };
  if (enabledLogin !== undefined) cfg.server.twofa.enabledLogin = !!enabledLogin;
  if (enabledSensitive !== undefined) cfg.server.twofa.enabledSensitive = !!enabledSensitive;
  configService.writeConfigRaw(cfg);
  return { ok: true, state: twofaState() };
}
function disableTwofa() {
  const cfg = configService.getConfig();
  if (cfg.server) { delete cfg.server.twofa; delete cfg.server.twofaPending; }
  configService.writeConfigRaw(cfg);
  try { require('./db').adminLog('2FA_DISABLED', ''); } catch {}
}

// ── STEP-UP: a fresh second factor unlocks the sensitive rooms for 15 min ──
const STEP_UP_MS = 15 * 60 * 1000;
function grantStepUp(req) {
  const s = sessionFrom(req, 'admin');
  if (!s) return false;
  SESSIONS.get(s.sid).stepUpUntil = Date.now() + STEP_UP_MS;
  return true;
}
function _expireStepUpForTest(req) {
  const s = sessionFrom(req, 'admin');
  if (s) SESSIONS.get(s.sid).stepUpUntil = 0;
}
function requireSensitive(req, res, next) {
  const t = twofaState();
  if (!t.enabledSensitive) return next();                 // owner has not locked these rooms
  const s = sessionFrom(req, 'admin');
  if (s) {
    const live = SESSIONS.get(s.sid);
    if (live && live.stepUpUntil && live.stepUpUntil > Date.now()) return next();
    return res.status(403).json({ error: 'This area is locked - enter your authenticator code.', stepUpRequired: true });
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── config sanitation: secrets never reach a browser ──────────────────────
// Paths listed here are (a) deleted or masked on GET, (b) preserved on save
// when the incoming value is the sentinel or blank (blank = keep, never clear).
const SECRET_SENTINEL = '__SECRET_UNCHANGED__';
const REMOVE_PATHS = ['server.adminPassword', 'server.adminAuth', 'server.bootstrapAuth', 'server.twofa', 'server.twofaPending',
  // The roster lives ONLY behind /api/staff/roster: the generic config
  // endpoint can neither read the codes nor replace the list (maintainer, Aug 14 -
  // a stale settings save was wiping employees).
  'server.staff',
  'backup.pullToken',   // pull-token is owner-eyes-only via its dedicated route
  'calendarFeed.token', // the private calendar link's key (Oct 19 2026) - the Calendar card reads it through its own owner route
  'homeAssistant.lock.backupCode',   // the standing door code on the lock's backup slot - a credential, set from the card, never read back
  'homeAssistant.login',             // the built-in Home Assistant's own sign-in, made by the unit; read only through /smarthome/login
  // Sep 25 2026 (the pilot facility handoff, section 5 - every secret the admin screen loads):
  // the manager password's salt and hash (the owner's were removed; this one never
  // was), the backup vault's DERIVED KEY and salt - the thing that decrypts every
  // copy that leaves the unit; the Backups card reads its own status route - and the
  // factory default password, a plaintext password nothing reads (rule 14 keeps the
  // key; it simply never leaves the unit). GET /config is also a MANAGER's read.
  'server.managerAuth',
  'backup.vault',
  'setup.defaultPassword',
];
// SECURITY (Aug 18, live-proven leak): several entries here named keys that do
// not exist in the config ('doorlock.*', lowercase 'homeassistant', 'email.*'),
// so remotelock.clientSecret, homeAssistant.token, resend.apiKey and
// messagebird.apiKey were reaching the admin browser UNMASKED via /api/admin/
// config. Paths below now match the real config shape (case-sensitive), and
// mergeIncomingConfig already round-trips masked values safely.
const BAY_SECRETS = ['simulatorWinPass'];
const MASK_PATHS = [
  'stripe.secretKey', 'stripe.webhookSecret',
  'twilio.authToken',
  'resend.apiKey',
  'messagebird.apiKey',
  'webhooks.secret',
  'remotelock.clientSecret',
  'homeAssistant.token',
  'unifiAccess.apiToken',
  'assistant.apiKey'
];

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, obj);
}
function setPath(obj, dotted, val) {
  const keys = dotted.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}
function deletePath(obj, dotted) {
  const keys = dotted.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    o = o && o[keys[i]];
    if (!o || typeof o !== 'object') return;
  }
  if (o) delete o[keys[keys.length - 1]];
}

function sanitizeConfigForClient(cfg) {
  const clone = JSON.parse(JSON.stringify(cfg));
  // THE BROWSER CANNOT ANSWER "IS STRIPE SET UP" - it is not allowed to see the
  // answer. The header badge used to derive it from clone.stripe.secretKey, which
  // is masked three lines below, so it read NO STRIPE on every configured unit
  // while the server-side checklist said connected. Compute the verdict HERE,
  // from the real config, and send the verdict rather than the secret.
  // (Sep 17 2026, a live customer on a drift-61 unit.)
  try {
    clone.stripe = Object.assign({}, clone.stripe, { status: require('./stripestatus').stripeStatus(cfg) });
  } catch { /* never block the config response over a badge */ }
  for (const p of REMOVE_PATHS) deletePath(clone, p);
  for (const p of MASK_PATHS) {
    const v = getPath(clone, p);
    if (v) {
      const last4 = String(v).slice(-4);
      setPath(clone, p, SECRET_SENTINEL + ':' + last4);
    }
  }
  // A bay PC's Windows password lives in the bays array, which a dotted path cannot
  // reach, so it went to the browser in clear. Masked without its last four - it is
  // a password, not a key someone matches against a dashboard.
  for (const b of (Array.isArray(clone.bays) ? clone.bays : [])) {
    for (const k of BAY_SECRETS) if (b && b[k]) b[k] = SECRET_SENTINEL;
  }
  return clone;
}

// A SECRET TYPED ONTO ITS MASK IS NEVER SILENTLY DROPPED (Sep 25 2026, pilot facility's
// masked-field bug). The merge below keeps the saved secret for anything that
// starts with the sentinel - so a key typed after the mask (the cursor landed at the
// end of it) was discarded while the screen said "Settings saved". The page clears a
// masked field when it is clicked now; this is the server's half: a value that STARTS
// with the sentinel but is not exactly the mask it was sent is refused, naming the
// field, instead of being quietly thrown away.
function maskedFieldEdits(incoming, live) {
  const out = [];
  for (const p of MASK_PATHS) {
    const inc = getPath(incoming, p);
    if (typeof inc !== 'string' || !inc.startsWith(SECRET_SENTINEL)) continue;
    const cur = getPath(live, p);
    if (inc !== SECRET_SENTINEL + ':' + String(cur || '').slice(-4)) out.push(p);
  }
  for (const b of (Array.isArray(incoming && incoming.bays) ? incoming.bays : [])) {
    for (const k of BAY_SECRETS) {
      const inc = b && b[k];
      if (typeof inc === 'string' && inc.startsWith(SECRET_SENTINEL) && inc !== SECRET_SENTINEL) out.push(`bays[${b.id || '?'}].${k}`);
    }
  }
  return out;
}

// Merge an incoming (browser-edited) config against the live one so masked
// or blanked secrets are PRESERVED and protected paths can never be set
// through the generic config endpoint.
function mergeIncomingConfig(incoming, live) {
  for (const p of REMOVE_PATHS) deletePath(incoming, p);
  for (const p of MASK_PATHS) {
    const inc = getPath(incoming, p);
    const cur = getPath(live, p);
    if (inc === undefined || inc === null || inc === ''
        || String(inc).startsWith(SECRET_SENTINEL)) {
      if (cur !== undefined) setPath(incoming, p, cur); else deletePath(incoming, p);
    }
  }
  // the bays array is replaced whole on save, so a masked or empty bay secret takes
  // the saved one back from the same bay (by id) - leaving it empty keeps it
  if (Array.isArray(incoming.bays)) {
    const liveBays = Array.isArray(live && live.bays) ? live.bays : [];
    for (const b of incoming.bays) {
      if (!b || typeof b !== 'object') continue;
      const was = liveBays.find(x => x && b.id && x.id === b.id) || {};
      for (const k of BAY_SECRETS) {
        const inc = b[k];
        if (inc === undefined || inc === null || inc === '' || String(inc).startsWith(SECRET_SENTINEL)) {
          if (was[k] !== undefined) b[k] = was[k]; else delete b[k];
        }
      }
    }
  }
  // Owner authentication state comes from live settings, never from a browser.
  if (live.server) {
    incoming.server = incoming.server || {};
    if (live.server.adminAuth) incoming.server.adminAuth = live.server.adminAuth;
    if (live.server.twofa) incoming.server.twofa = live.server.twofa; else delete (incoming.server || {}).twofa;
    if (live.server.twofaPending) incoming.server.twofaPending = live.server.twofaPending;
    if (live.server.adminAuthDefault !== undefined) incoming.server.adminAuthDefault = live.server.adminAuthDefault;
  }
  return incoming;
}

module.exports = {
  maskedFieldEdits, SECRET_SENTINEL,
  verifyManagerPassword, managerEnabled, setManagerPassword, requestRole, requireOwner,
  hashPassword, verifyAdminPassword, ensurePasswordHashed, setAdminPassword,
  setupComplete,
  createSession, sessionFrom, destroySession, revokeAllSessions,
  setSessionCookie, clearSessionCookie,
  verifyAdminRequest, requireAdmin, getClientIp, isSecureRequest,
  loginLocked, loginFailed, loginSucceeded,
  twilioSignatureValid,
  sanitizeConfigForClient, mergeIncomingConfig, SECRET_SENTINEL,
  twofaState, verifyTotp, verifyAnySecond, beginTwofaEnroll, confirmTwofaEnroll,
  setTwofaToggles, disableTwofa, grantStepUp, requireSensitive, _expireStepUpForTest,
  totpCode, base32Encode
};
