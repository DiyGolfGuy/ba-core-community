// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/unifiaccess.js  —  UniFi Access provider (multi-door)
//
//  Talks to the UniFi Access application running on the facility's OWN console
//  (UDM Pro / Cloud Key / UNVR / UA hardware) over the LAN. Per booking we
//  create a Visitor with a validity window and a PIN, granted to the doors the
//  owner selected in Settings; cancellation deletes the visitor. Everything is
//  local - no cloud dependency, which suits an unmanned facility.
//
//  TRANSPORT (the version quirk, handled structurally): Ubiquiti's API guide
//  documents  https://<console>:12445/api/v1/developer/...  with an
//  "Authorization: Bearer <token>" header. On some UniFi OS consoles the
//  working transport is instead  https://<console>/proxy/access/api/v1/
//  developer/...  on port 443 with an "X-API-KEY: <token>" header (community-
//  confirmed; Ubiquiti's own docs called "semi-incorrect" in the wild). We do
//  not guess: testConnection() tries the documented style first, then the
//  proxy style, persists whichever answered (cfg.unifiAccess.apiStyle), and
//  every later call uses the remembered style - re-detecting on failure. Both
//  auth headers are sent on every request; extras are ignored.
//
//  TLS (Sep 25 2026, maintainer's item 10 - "without turning off checking altogether"):
//  the console serves a SELF-SIGNED certificate on the LAN, which no public
//  authority can vouch for. Until today we set rejectUnauthorized:false and
//  checked NOTHING, so anything on the LAN answering the console's address was
//  handed the door token and believed about every code. Now the certificate is
//  PINNED: the first time this unit reaches a console address it records that
//  certificate's SHA-256 (UNIFI_CERT_TRUSTED in the owner's log), and from then
//  on a connection presenting any other certificate is closed BEFORE a byte of
//  the request - the token included - is written (UNIFI_CERT_MISMATCH, the call
//  fails, the job retries and the health line says so). A certificate a public
//  authority issues for the very name typed is trusted the way a browser trusts
//  it. The owner accepts a new certificate (a replaced or re-keyed console) from
//  Test Connection, which shows its fingerprint and trusts exactly that one.
//  Node's own chain check is replaced, not skipped, for these requests only: see
//  ConsoleAgent below - it is the one place rejectUnauthorized:false appears, and
//  the comparison runs before the socket is handed to the HTTP client.
//
//  PIN: generated LOCALLY at cfg.unifiAccess.pinLength digits (default 4 to
//  match RemoteLock's generated codes, per maintainer). UniFi consoles enforce a
//  PIN-length setting (fixed 4/6/8 or variable) - if assignment is rejected,
//  the error surfaced tells the owner to match the console's PIN setting.
// ═══════════════════════════════════════════════════════════════════════════════

const axios         = require('axios');
const https         = require('https');
const crypto        = require('crypto');
const { getConfig } = require('./config');
const { adminLog }  = require('./db');

const tls           = require('tls');

// ═══ THE CONSOLE'S CERTIFICATE, PINNED (Sep 25 2026) ══════════════════════════
// cfg.unifiAccess.certPins = { '<host>:<port>': { sha256, pinnedAt, subject, validTo, how } }
// One pin per ADDRESS AND PORT: the documented transport (12445) and the proxy one
// (443) are served by different processes on the console and present different
// certificates. A pin is the exact certificate, so its dates do not matter - a
// self-signed certificate that passes its printed expiry is still the same key the
// owner's console has always used, and refusing it would lock the door out over a
// date nobody can see.
function certPins() { const p = cfgU().certPins; return p && typeof p === 'object' ? p : {}; }
const fp256 = cert => (cert && cert.fingerprint256 ? String(cert.fingerprint256).toUpperCase() : '');
/** The first and last four bytes - enough to compare by eye with the console's own page. */
const shortFp = f => { const x = String(f || '').split(':'); return x.length > 8 ? x.slice(0, 4).join(':') + ' ... ' + x.slice(-4).join(':') : String(f || ''); };
function savePin(origin, cert, how) {
  try {
    const cfgSvc = require('./config');
    const cfg = cfgSvc.getConfig();
    const u = Object.assign({}, cfg.unifiAccess);
    u.certPins = Object.assign({}, u.certPins, { [origin]: {
      sha256: fp256(cert), pinnedAt: new Date().toISOString(),
      subject: String((cert.subject && (cert.subject.CN || cert.subject.O)) || ''), validTo: String(cert.valid_to || ''), how } });
    cfg.unifiAccess = u;
    cfgSvc.writeConfigRaw(cfg);
    return true;
  } catch (e) {
    adminLog('UNIFI_CERT_ERROR', `could not record the console's certificate for ${origin}: ${String(e.message).slice(0, 140)}`);
    return false;
  }
}
// the owner's log gets one line per address and certificate an hour, not one per retry
const mismatchLogged = new Map();
class CertChangedError extends Error {}
// axios hands the error on wrapped (its own error with ours as `cause` and our fields copied)
const isCertChange = e => !!(e && (e.certChanged || (e.cause && e.cause.certChanged)));

/** Decide whether the certificate on this socket is the console's.
 *  mode: 'use' (every call), 'tofu' is implied when there is no pin yet,
 *        { trust: '<sha256>' } - the owner's Test Connection accepting exactly
 *        the certificate they were shown, and nothing else. */
function judgeCert(origin, sock, mode) {
  const cert = sock.getPeerCertificate();
  const got = fp256(cert);
  if (!got) return new Error(`UniFi Access: the console at ${origin} presented no certificate - nothing was sent to it`);
  const pins = certPins();
  const pin = pins[origin];
  if (pin && String(pin.sha256).toUpperCase() === got) {
    // the console presents the trusted certificate again after a refusal: say so, so the
    // health line (which reads the newest of these lines) clears on its own
    if ([...mismatchLogged.keys()].some(k => k.startsWith(origin + '|'))) {
      for (const k of [...mismatchLogged.keys()]) if (k.startsWith(origin + '|')) mismatchLogged.delete(k);
      adminLog('UNIFI_CERT_OK', `${origin}: the console presents the trusted certificate again`);
    }
    return null;
  }
  // a certificate a public authority issued for the very name the owner typed
  // (sock.authorized = the chain verified AND the name matched) is trusted the way
  // any browser trusts it - an owner who installed one never has to press anything
  if (sock.authorized === true) return null;
  const wanted = mode && mode.trust ? String(mode.trust).toUpperCase() : '';
  if (wanted && wanted === got) {
    savePin(origin, cert, 'owner');
    adminLog('UNIFI_CERT_TRUSTED', `${origin}: the owner trusted the console's certificate SHA-256 ${got}` + (pin ? ` in place of ${pin.sha256} (trusted ${pin.pinnedAt})` : '') + ' from Test Connection');
    return null;
  }
  // A NEW PORT ON A CONSOLE WE ALREADY KNOW IS NOT A FIRST CONTACT (Sep 25 2026, the
  // Monday review). When the trusted transport stops answering, api() tries the other one;
  // trusting whatever answers THERE on first sight would hand the token to anything that
  // can refuse one port and answer the other. The owner accepts it from Test Connection.
  const host = String(origin).replace(/:\d+$/, '');
  const sibling = !pin && Object.keys(pins).find(o => o !== origin && o.replace(/:\d+$/, '') === host);
  // ...unless it presents the very certificate already trusted on the other port: that is the
  // same console proving itself, and the transport fallback keeps working on its own
  if (sibling && !wanted && String(pins[sibling].sha256).toUpperCase() === got) {
    savePin(origin, cert, 'same-certificate');
    adminLog('UNIFI_CERT_TRUSTED', `${origin}: the console presents the same certificate it presents on ${sibling} (SHA-256 ${got})`);
    return null;
  }
  if (!pin && !wanted && !sibling) {
    // FIRST CONTACT. Nothing to compare with yet: this is the certificate every
    // later call is held to. A unit that had UniFi running before this pack pins on
    // its first call after the update, so the door keeps working through the update.
    savePin(origin, cert, 'first-contact');
    adminLog('UNIFI_CERT_TRUSTED', `${origin}: first contact - this unit will only talk to the console presenting certificate SHA-256 ${got}` + (cert.subject && cert.subject.CN ? ` (${cert.subject.CN})` : ''));
    return null;
  }
  const key = origin + '|' + got, last = mismatchLogged.get(key) || 0;
  if (Date.now() - last > 3600000) {
    mismatchLogged.set(key, Date.now());
    adminLog('UNIFI_CERT_MISMATCH', `${origin} presented certificate SHA-256 ${got}, but this unit trusts ${pin ? pin.sha256 + ' (since ' + pin.pinnedAt + ')' : (sibling ? 'only ' + sibling + ' on that console' : 'a different one')}. The connection was closed before anything was sent - no door code was created or removed through it. If the console was replaced, reset or updated, press Test Connection in Settings > Devices > Door Access to trust the new certificate.`);
    // AND THE OWNER IS TEXTED (maintainer, Sep 25 2026) - not only the health line: until they look,
    // no member's door access can be turned on or off
    try { require('./owneralert').alert('unifi-cert:' + origin, `The UniFi door console presented a certificate this unit does not trust, so no door code or member access can be changed until you check it. If the console was replaced, reset or updated, open Settings > Devices > Door Access and press Test Connection to accept the new one.`).catch(() => {}); } catch {}
  }
  const ref = pin || (sibling && pins[sibling]) || null;
  const e = new CertChangedError(pin
    ? `UniFi Access: the console at ${origin} presented a DIFFERENT certificate (${shortFp(got)}) from the one this unit trusts (${shortFp(pin.sha256)}, since ${String(pin.pinnedAt).slice(0, 10)}) - nothing was sent to it. If the console was replaced or updated, press Test Connection in Settings > Devices > Door Access to trust the new certificate.`
    : `UniFi Access: the console answered on ${origin}, a port this unit has not trusted (it trusts ${sibling}) - nothing was sent to it. If the console changed how it serves Access, press Test Connection in Settings > Devices > Door Access and accept its certificate.`);
  e.certChanged = { origin, now: got, was: ref ? ref.sha256 : '', since: ref ? ref.pinnedAt : '', newPort: !pin, subject: String((cert.subject && cert.subject.CN) || ''), validTo: String(cert.valid_to || '') };
  return e;
}

/** The HTTPS agent for the console. The TLS handshake completes, the certificate is
 *  judged, and only a socket that passed is handed to the HTTP client - so the request,
 *  and the token in its headers, is never written to a console we do not trust.
 *  rejectUnauthorized:false here turns off Node's CHAIN check only, for these requests
 *  only, because a self-signed certificate has no chain to check; judgeCert is the check. */
const CONNECT_MS = Number(process.env.BA_UNIFI_CONNECT_MS) || 8000;   // the same 8 s the request has
class ConsoleAgent extends https.Agent {
  constructor(mode) { super({ keepAlive: false }); this.mode = mode || 'use'; }
  createConnection(options, cb) {
    const origin = `${options.host}:${options.port}`;
    let settled = false, timer = null;
    const finish = (err, s) => { if (!settled) { settled = true; clearTimeout(timer); cb(err, s); } };
    const sock = tls.connect(Object.assign({}, options, { rejectUnauthorized: false }));
    // THE CONNECT AND THE HANDSHAKE ARE BOUNDED HERE (Sep 25 2026, the Monday review).
    // axios's 8 s timer starts only once the HTTP client HAS a socket, and this agent hands
    // it over after the handshake - so a console that accepts the connection and never
    // finishes TLS (a wedged Access process) left the call, the job and a cancel waiting
    // for ever. The word "timeout" is what api() reads as a transport failure.
    timer = setTimeout(() => {
      const e = new Error(`UniFi Access at ${origin} did not answer within ${CONNECT_MS / 1000} s (connect timeout)`);
      e.code = 'ETIMEDOUT';
      sock.destroy();
      finish(e);
    }, CONNECT_MS);
    sock.once('error', err => finish(err));
    sock.once('secureConnect', () => {
      const bad = judgeCert(origin, sock, this.mode);
      if (bad) { sock.destroy(); return finish(bad); }
      finish(null, sock);
    });
    // returning nothing tells the HTTP agent to wait for the callback
  }
}
const agent = new ConsoleAgent('use');

/** The two known transport styles. */
const STYLES = {
  // The documented transport answers on 12445 unless the owner told us otherwise.
  documented: host => `https://${hostOnly(host)}:${hostPort(host) || '12445'}/api/v1/developer`,
  // The proxy transport rides the console's normal web port (443 unless typed).
  proxy:      host => `https://${hostOnly(host)}${hostPort(host) ? ':' + hostPort(host) : ''}/proxy/access/api/v1/developer`
};

// The owner types an address. They may include a port - our own guide's
// troubleshooting paragraph talks about port 12445, so of course they do - and
// until Sep 16 2026 we silently threw it away, which also meant a console on a
// non-default port could not be configured at all. Keep a port when one is
// given; strip the scheme and any path.
function cleanHost(raw) {
  return String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}
/** The host with no port, for the styles that pin their own. */
function hostOnly(raw) { return cleanHost(raw).replace(/:.*$/, ''); }
/** The port the owner typed, or '' when they typed none. */
function hostPort(raw) { const m = /:(\d+)$/.exec(cleanHost(raw)); return m ? m[1] : ''; }

function cfgU() { return getConfig().unifiAccess || {}; }

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-API-KEY':   token,
    Accept:        'application/json',
    'Content-Type': 'application/json'
  };
}

async function call(style, method, path, body, mode) {
  const u = cfgU();
  const host = cleanHost(u.host);
  const token = String(u.apiToken || '');
  if (!host || !token || token.startsWith('PASTE')) throw new Error('UniFi Access not configured');
  const res = await axios({
    method,
    url: STYLES[style](host) + path,
    data: body,
    headers: headers(token),
    httpsAgent: mode && mode !== 'use' ? new ConsoleAgent(mode) : agent,
    timeout: 8000,
    validateStatus: () => true
  });
  if (res.status === 401 || res.status === 403) throw new Error(`UniFi Access auth failed (${res.status}) - check the API token and its permissions`);
  if (res.status >= 400) throw new Error(`UniFi Access ${method} ${path} -> ${res.status}: ${JSON.stringify(res.data).slice(0, 180)}`);
  const data = res.data;
  // A 200 IS NOT AN ANSWER (Sep 16 2026, the console audit). A UniFi OS console
  // that is not running Access - or is running it behind a login - answers the
  // developer path with HTTP 200 and its own SPA. We used to take that: the body
  // had no `code`, the `data` read undefined, listDoors mapped it to [], and
  // Test Connection reported "Connected - 0 doors found" AND persisted that
  // transport as the remembered style. The owner then ticked nothing and every
  // booking afterwards failed with "no doors selected in Settings".
  // Reference s2.3/s2.8: every answer carries {code, msg}. Demand it.
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.code === undefined) {
    const shape = typeof data === 'string' ? `${data.length} bytes of ${/^\s*</.test(data) ? 'HTML' : 'text'}` : JSON.stringify(data).slice(0, 120);
    throw new Error(`UniFi Access ${method} ${path} answered 200 but not in the console's own format (${shape}) - this address is reachable but it is not the Access API`);
  }
  if (String(data.code).toUpperCase() !== 'SUCCESS') {
    throw new Error(`UniFi Access ${path}: ${data.code} ${data.msg || ''}`.trim());
  }
  return data;
}

/** Call using the remembered style; if none remembered or it fails to CONNECT,
 *  try both and persist the winner. HTTP-level errors (4xx) do NOT trigger
 *  style fallback - the transport answered, the request itself was bad. */
async function api(method, path, body, mode) {
  const u = cfgU();
  const known = (u.apiStyle === 'documented' || u.apiStyle === 'proxy') ? u.apiStyle : null;
  if (known) {
    try { return await call(known, method, path, body, mode); }
    catch (e) {
      // only re-detect on transport-level failures (refused/timeout/reset)
      if (!/ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|socket hang up|timeout/i.test(e.message)) throw e;
    }
  }
  let lastErr = null;
  for (const style of ['documented', 'proxy']) {
    if (style === known) continue;
    try {
      const out = await call(style, method, path, body, mode);
      persistStyle(style);
      return out;
    } catch (e) { if (!isCertChange(lastErr)) lastErr = e; }
  }
  // known style failed at transport AND the other style failed too
  // a console that answered with the WRONG certificate is the finding, whatever the
  // other transport said - an unreachable second port must not hide it
  if (known) { try { return await call(known, method, path, body, mode); } catch (e) { if (!isCertChange(lastErr)) lastErr = e; } }
  throw lastErr || new Error('UniFi Access unreachable');
}

function persistStyle(style) {
  try {
    const cfgSvc = require('./config');
    const cfg = cfgSvc.getConfig();
    cfg.unifiAccess = Object.assign({}, cfg.unifiAccess, { apiStyle: style });
    cfgSvc.writeConfigRaw(cfg);
  } catch { /* non-fatal - style just gets re-detected next call */ }
}

/** The PIN lengths a UniFi console will accept. Its setting is Fixed 4, 6 or 8,
 *  or Variable - there is no 5 and no 7, and the old clamp (4..8) could mint
 *  both. A PIN no console can hold is a booking with no door code. */
const PIN_LENGTHS = [4, 6, 8];
/** ONE number, owned by the dispatcher - see services/doorlock.js doorPinLength. */
function pinLength() { return require('./doorlock').doorPinLength(); }
/** A locally generated numeric PIN of the configured length.
 *  `avoid` holds PINs the console is known to hold already (see createBookingVisitor). */
function generatePin(avoid) {
  const len = pinLength();
  const taken = new Set((avoid || []).map(String));
  for (let tries = 0; tries < 40; tries++) {
    let pin = '';
    while (pin.length < len) pin += crypto.randomInt(0, 10);
    if (!taken.has(pin)) return pin;
  }
  return null;   // the caller decides what a space this full means
}

/** List doors on the console - powers Test Connection + the door pickers. */
async function listDoors(mode) {
  const out = await api('GET', '/doors', undefined, mode);
  const rows = Array.isArray(out?.data) ? out.data : [];
  return rows.map(d => ({ id: d.id, name: d.name || d.full_name || d.id }));
}

/** List door GROUPS - a facility can grant a whole group in one tick. */
async function listDoorGroups(mode) {
  try {
    const out = await api('GET', '/door_groups', undefined, mode);
    const rows = Array.isArray(out?.data) ? out.data : [];
    return rows.map(g => ({ id: g.id, name: g.name || g.full_name || g.id }));
  } catch (e) {
    // THE CATCH WAS WRITTEN FOR ONE CASE and was swallowing four (Sep 16 2026).
    // It exists because an older console has no door-group endpoint at all, and
    // doors still work there - that is a genuine "not applicable" (rule 31). But
    // it was also eating 401, 403 (a token without view:space), a timeout and a
    // console that is down, and every one of those read to the owner as "this
    // console has no door groups". Test Connection then said SUCCESS and offered
    // an empty list. Only not-found is not-applicable; everything else is real.
    if (/not found|404|CODE_RESOURCE_NOT_FOUND|CODE_NOT_EXISTS/i.test(String(e.message))) return [];
    throw e;
  }
}

/** Both, for every picker in the admin (facility / bay / member tier). */
async function listAccessTargets(mode) {
  return { doors: await listDoors(mode), groups: await listDoorGroups(mode) };
}

/**
 * Selection entries are prefixed strings: 'door:<id>' or 'group:<id>'
 * (a bare id from an early config is treated as a door). One parser for
 * every surface that stores selections.
 */
function parseTargets(list) {
  return (Array.isArray(list) ? list : []).filter(Boolean).map(x => {
    const s2 = String(x);
    if (s2.startsWith('group:')) return { id: s2.slice(6), type: 'door_group' };
    if (s2.startsWith('door:'))  return { id: s2.slice(5), type: 'door' };
    return { id: s2, type: 'door' };
  });
}

/**
 * THE DOOR RESOLUTION for a booking - the union of three layers, deduped:
 *   1. facility defaults (unifiAccess.doorIds)     - e.g. the outside door
 *   2. the booked bay's own doors (bay.unifiDoors) - a private-room bay
 *   3. the member's tier doors (tier.unifi_doors)  - member-only spaces,
 *      applied when the booking was made by a member (booking.member_id)
 * A facility can use any layer alone or all three; we never assume which.
 */
function resolveDoorsForBooking(booking) {
  const cfg = getConfig();
  const out = [];
  const seen = new Set();
  const add = t => { const k = t.type + ':' + t.id; if (!seen.has(k)) { seen.add(k); out.push(t); } };

  for (const t of parseTargets(cfgU().doorIds)) add(t);

  const bay = (cfg.bays || []).find(b => b.id === booking.bay_id);
  if (bay) for (const t of parseTargets(bay.unifiDoors)) add(t);

  if (booking.member_id) {
    try {
      const D = require('./db').db;
      const row = D.prepare(
        `SELECT t.unifi_doors FROM members m JOIN membership_tiers t ON t.id = m.tier_id WHERE m.id = ?`
      ).get(booking.member_id);
      if (row && row.unifi_doors) {
        let arr = [];
        try { arr = JSON.parse(row.unifi_doors); } catch {}
        for (const t of parseTargets(arr)) add(t);
      }
    } catch { /* member lookup is best-effort - facility+bay doors still granted */ }
  }
  return out;
}

/**
 * Create the per-booking visitor: validity window = session +/- the same
 * doorCodeBufferMins RemoteLock uses, granted to the configured doors,
 * with a locally generated PIN. Returns { pin, visitorId }.
 */
async function createBookingVisitor(booking) {
  const resources = resolveDoorsForBooking(booking);
  if (!resources.length) throw new Error('UniFi Access: no doors selected in Settings (facility, bay, or member tier)');

  // Owner-set lead/lag window - shared helper, same math as RemoteLock.
  const { startDt, endDt } = require('./doorlock').codeWindow(booking);

  // BOTH KEYS, as the policy body has sent since Aug 19 (see ensurePolicy). The
  // reference's own examples disagree with its field table about singular vs
  // plural, we cannot settle it from the bench, and the cost of guessing wrong
  // is a visitor with a PIN and NO DOORS - a customer at a door with a code that
  // opens nothing, and a create call that returned 200. Sending both costs a few
  // bytes; extras are ignored. (Sep 16 2026 - this is the same fix the policy
  // body already had, applied to the visitor body it was never applied to.)
  const created = await api('POST', '/visitors', {
    first_name:  'Golf',
    last_name:   `${booking.name} ${booking.date} ${booking.start_time}`.slice(0, 60),
    remarks:     ourRemark(booking.id),
    start_time:  Math.floor(startDt.getTime() / 1000),
    end_time:    Math.floor(endDt.getTime() / 1000),
    visit_reason: 'Others',
    resource: resources, resources
  });
  const visitorId = created?.data?.id || created?.data?.identity_id;
  if (!visitorId) throw new Error('UniFi Access: visitor created but no id returned');

  // READ WHAT THE CONSOLE SAYS IT GRANTED. The create reply echoes the visitor,
  // so the one question that matters - did this code get any doors - is answered
  // right here and we used to throw the answer away. An echo we do not recognise
  // is "cannot tell" (rule 31), not a failure; an echo that is explicitly EMPTY
  // when we asked for doors is a failure, and it is better found now than by a
  // customer standing outside.
  const echoed = created?.data?.resources ?? created?.data?.resource;
  if (Array.isArray(echoed) && echoed.length === 0) {
    const r = await revokeVisitor(visitorId);
    adminLog('DOOR_CODE_ERROR', `Booking: ${booking.id} | the console created visitor ${visitorId} with NO doors (asked for ${resources.length})` + (r && r.ok ? ' - removed' : ` - AND THE REMOVAL FAILED: ${r && r.error}`));
    throw new Error('UniFi Access created the visitor with no doors granted - the door ids in Settings may no longer exist on the console. Re-run Test Connection and re-tick the doors.');
  }

  // THE PIN. A console refuses a PIN it already holds; with a 4-digit space and
  // a busy facility that is not rare, and until Sep 16 2026 the refusal reached
  // the owner as a raw CODE_ string and the booking got no door code at all.
  // Re-roll and try again - but only for a COLLISION. A length refusal means the
  // console's setting and ours disagree, and re-rolling the same length forever
  // would just hide it.
  const tried = [];
  let pin = booking.forcePin ? String(booking.forcePin) : generatePin();
  if (!pin) throw new Error('UniFi Access: could not mint a PIN that the console does not already hold - raise PIN Length in Settings');
  for (let attempt = 0; ; attempt++) {
    try {
      await api('PUT', `/visitors/${visitorId}/pin_codes`, { pin_code: pin });
      break;
    } catch (e) {
      const dup = /ALREADY_EXIST|already exists|duplicate/i.test(e.message);
      if (dup && !booking.forcePin && attempt < 5) {
        tried.push(pin);
        const next = generatePin(tried);
        if (next) { pin = next; continue; }
      }
      // Do not strand a doorless visitor - and READ the cleanup's answer. A
      // rollback that fails leaves a visitor on the console that our database
      // has no record of; the nightly sweep will not take it until its window is
      // an hour past, so the owner is told now. (The bare `catch {}` here was
      // rule 3c's exact shape on a door path.)
      const r = await revokeVisitor(visitorId);
      if (!r || r.ok !== true) adminLog('DOOR_CODE_ERROR', `Booking: ${booking.id} | PIN assign failed AND the rollback failed - visitor ${visitorId} may still exist on the console: ${r && r.error}`);
      if (dup) throw new Error(`UniFi Access refused ${attempt + 1} PIN(s) as already in use on the console. Raise PIN Length in Settings - a 4-digit code runs out quickly on a busy console.`);
      if (/LENGTH_INVALID|4\d\d|invalid|length/i.test(e.message)) {
        // We cannot READ the console's PIN setting from here (that needs a real
        // console to settle - audit U7), so the first booking is where the
        // mismatch shows. Record it somewhere an OWNER will find it, rather than
        // only telling whoever happened to trip it: this is a configuration fault
        // that will refuse every booking until someone changes one number.
        adminLog('UNIFI_PIN_LENGTH_MISMATCH', `the console refused a ${String(pin).length}-digit PIN - Settings > Devices > Door Access Provider > PIN Length must match Access > Settings > General > PIN on the console`);
        throw new Error(`UniFi Access rejected the PIN (${e.message}). The console enforces a PIN length - set "PIN Length" here to match Access > Settings > General > PIN on the console.`);
      }
      throw e;
    }
  }

  adminLog('DOOR_CODE_CREATED', `Booking: ${booking.id} | code issued (${String(pin).length} digits) | UniFi visitor: ${visitorId} | targets: ${resources.map(r => r.type + ':' + r.id).join(',')}`);
  return { pin, visitorId };
}

/** Move a live credential's window - the customer extended, or staff moved the
 *  booking. A visitor's ONLY bound is its start/end epoch pair, so without this
 *  an extended session's code dies at the ORIGINAL end and the customer is shut
 *  out of time they have paid for, while our own revoke job (correctly) waits
 *  for the new end and the health line stays green. (Sep 16 2026.) */
async function moveVisitorWindow(visitorId, booking) {
  if (!visitorId) return { ok: true, note: 'nothing to move' };
  const { startDt, endDt } = require('./doorlock').codeWindow(booking);
  // UNSETTLED, AND THEREFORE SENT IN FULL (maintainer's ruling, Sep 16 2026): no source
  // I have says whether PUT /visitors/:id MERGES the fields you send or REPLACES
  // the visitor with them. Sending only the two epochs is correct under merge and
  // CATASTROPHIC under replace - it would blank the visitor's name, our ownership
  // marker and, worst, its `resources`: the doors would come off a visitor whose
  // session is running, which is precisely when this call is made.
  // So we send the WHOLE visitor, rebuilt from our own record rather than read
  // back from the console (a read we would also have to trust). Under merge every
  // field simply arrives at the value it already had; under replace the visitor is
  // reconstructed exactly. Correct either way, and it stops being a guess.
  // A DOOR LIST WE COULD NOT RESOLVE IS NEVER A DOOR LIST WE MAY WRITE
  // (Sep 17 2026 - the same rule readUserPolicies already states for policies).
  // The doors are re-resolved HERE, from the configuration as it is NOW, and an
  // owner who unticked a door, moved a bay or changed a member's tier since the
  // code was issued resolves to FEWER - or none. Restating an empty list on a
  // visitor whose session is running is the exact catastrophe the note below
  // describes, and it would happen under BOTH readings of PUT: under replace the
  // doors are gone, and under merge an explicit empty array still overwrites.
  // So when we cannot resolve any door, we restate nothing about doors: putMerged
  // has already read what the console holds, and that is what gets written back.
  // The customer keeps the access they had and gains the extra time; the owner is
  // told their door settings no longer resolve to anything.
  const resources = resolveDoorsForBooking(booking);
  const known = {
    // what we can restate from our own record, in case the read came back narrow
    first_name:  'Golf',
    last_name:   `${booking.name} ${booking.date} ${booking.start_time}`.slice(0, 60),
    remarks:     ourRemark(booking.id),
    visit_reason: 'Others',
  };
  if (resources.length) { known.resource = resources; known.resources = resources; }
  else adminLog('DOOR_CODE_DOORS_UNRESOLVED', `Booking: ${booking.id} | UniFi visitor ${visitorId}: the door settings no longer resolve to any door for this booking, so the window was moved WITHOUT touching the doors the console already holds - the customer keeps the access they had. Check the ticked doors in Settings, the bay's doors and the member's tier.`);
  try {
    await putMerged(`/visitors/${visitorId}`, {
      start_time: Math.floor(startDt.getTime() / 1000),
      end_time:   Math.floor(endDt.getTime() / 1000)
    }, known);
    adminLog('DOOR_CODE_WINDOW_MOVED', `Booking: ${booking.id} | UniFi visitor: ${visitorId} | now ends ${endDt.toISOString()}`);
    return { ok: true };
  } catch (err) {
    adminLog('DOOR_CODE_WINDOW_ERROR', `Booking: ${booking.id} | UniFi visitor ${visitorId}: ${err.message.slice(0, 160)}`);
    return { ok: false, error: String(err.message).slice(0, 200) };
  }
}

/** Delete the visitor - revokes the PIN and all door grants. is_force=true
 *  REMOVES the visitor (API Reference v4.2.16 s4.6: without it the console
 *  only sets the visitor to Cancelled and the row stays in its list forever). */
async function revokeVisitor(visitorId) {
  if (!visitorId) return { ok: true, note: 'nothing to revoke' };
  try {
    await api('DELETE', `/visitors/${visitorId}?is_force=true`, undefined);
    adminLog('DOOR_CODE_REVOKED', `UniFi visitor: ${visitorId}`);
    return { ok: true };
  } catch (err) {
    // the same "already gone" answers the sweep and the reconcile accept (Oct 3 2026, the inventory): a console that
    // answers CODE_NOT_EXISTS without a 404 left the code "still live" on the Door codes line for ever
    if (/not found|404|CODE_NOT_EXISTS|CODE_RESOURCE_NOT_FOUND/i.test(String(err.message))) { adminLog('DOOR_CODE_REVOKED', `UniFi visitor: ${visitorId} (already gone)`); return { ok: true, note: 'already gone' }; }
    console.error('UniFi Access revoke error:', err.message);
    adminLog('DOOR_CODE_REVOKE_ERROR', `UniFi visitor ${visitorId}: ${err.message}`);
    return { ok: false, error: String(err.message).slice(0, 200) };
  }
}

// ═══ NIGHTLY SWEEP (W32, Sep 4 2026) ═════════════════════════════════════════
// The per-booking door_revoke job removes each visitor 20 minutes after its
// session. This sweep is the safety net behind it: a visitor the job never
// reached (console unreachable that night, unit off, a pre-W32 Cancelled row
// from before is_force) is removed once its window is well past. THREE guards
// decide "ours" - every one must hold, so nothing else on the console is ever
// touched: the appliance's own signature (first_name 'Golf' + remarks
// 'Booking <id>'), a booking with that id in OUR database, and end_time older
// than the grace. Runs from the scheduler at 5:00, after the backup window.
// ── RULE 25 AT THE DOOR (maintainer's ruling, Sep 16 2026) ───────────────────────────
// "The product owns only what it creates." It has been true of Stripe since
// A-wave 7 and was never applied to the console, which is the one place a
// CUSTOMER'S OWN system is involved: a facility's UniFi console holds visitors
// for their staff, their contractors, their deliveries, and two BA units could
// share one console. So every visitor we create now carries this unit's own id
// the way every Stripe object carries ba_unit, and the sweep removes only what
// it can prove is ours.
//
// The console has no metadata field, so the marker rides in `remarks` - the one
// free-text field on a visitor - alongside the booking id it already carried:
//     BA:<unitId> Booking <bookingId>
// Rule 14 in spirit: the OLD form ("Booking <id>", written by every unit before
// today) is still recognised, and is adopted onto the new form once at boot.
const OUR_FIRST_NAME = 'Golf';
const OUR_REMARK = /^(?:BA:(\S+)\s+)?Booking (\S+)/;

function unitId() { try { return require('./stripemark').unitId(); } catch { return ''; } }
/** The remarks string we write on a visitor we create. */
function ourRemark(bookingId) { const u = unitId(); return (u ? `BA:${u} ` : '') + `Booking ${bookingId}`; }

/** The booking id IF this visitor is ours, else null.
 *  A visitor stamped for a DIFFERENT unit is never ours - that is the case rule
 *  25 exists for, two BA units sharing one customer's console.
 *  An UNMARKED visitor is not refused: it is one WE made before the marker
 *  existed, and its ownership is proved a second way - the sweep will not remove
 *  it unless that booking id exists in OUR OWN database, and booking ids are
 *  uuids. Refusing them instead would abandon every visitor made before today
 *  on any console the nightly adoption has not reached yet. */
function ourBookingId(v) {
  if (!v || String(v.first_name || '') !== OUR_FIRST_NAME) return null;
  const m = OUR_REMARK.exec(String(v.remarks || ''));
  if (!m) return null;
  const stamped = m[1] || '';
  const mine = unitId();
  if (stamped && mine && stamped !== mine) return null;   // another unit's visitor - never ours
  return m[2];
}

/** Every visitor on the console, paged (Reference s4.4: page_num / page_size). */
async function listAllVisitors(pageSize = 100) {
  const all = [];
  for (let page = 1; page <= 200; page++) {
    const out = await api('GET', `/visitors?page_num=${page}&page_size=${pageSize}`);
    const d = out && out.data;
    const rows = Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : (Array.isArray(d?.visitors) ? d.visitors : []));
    all.push(...rows);
    if (!rows.length) break;
    // A SHORT PAGE IS NOT THE END (Sep 16 2026). We used to stop the moment a
    // page came back smaller than we asked for - but a console is free to cap
    // page_size below our request, in which case EVERY page is short and the
    // sweep read only the first one. Reference s3.5 answers this properly:
    // `pagination` is a SIBLING of `data` and carries the real total.
    const pg = out && out.pagination;
    if (pg && Number(pg.total) >= 0) { if (all.length >= Number(pg.total)) break; }
    else if (rows.length < pageSize) break;   // no pagination block: the old rule is all we have
  }
  return all;
}

async function sweepExpiredVisitors({ now = Date.now(), graceMins = 60 } = {}) {
  const cfg = getConfig();
  if ((cfg.doorAccess || {}).provider !== 'unifi') return { skipped: 'provider' };
  const u = cfg.unifiAccess || {};
  if (!u.host || !u.apiToken || String(u.apiToken).startsWith('PASTE')) return { skipped: 'unconfigured' };
  const D = require('./db').db;
  const cutoff = Math.floor((now - graceMins * 60000) / 1000);
  const out = { scanned: 0, ours: 0, removed: [], kept: 0, errors: 0, unmatched: 0, byRecord: 0, bySignature: 0 };

  // ── OUR OWN RECORD IS THE AUTHORITY (Sep 16 2026) ──────────────────────────
  // The three guards this replaces all read fields off the CONSOLE's reply:
  // first_name 'Golf', a remarks match, and end_time. Ubiquiti's reference shows
  // remarks/start_time/end_time only in REQUEST bodies - its four visitor response
  // samples carry none of them. Proven on the bench (test-unifi-standin B10): with
  // the documented response field set, the sweep scanned thirty visitors,
  // recognised none, removed nothing, and logged a line indistinguishable from a
  // healthy night. The safety net behind rule 28 was inert and said it was fine.
  //
  // We do not need the console to remember which visitors are ours: WE recorded
  // the id when we created it. bookings.remotelock_person_id holds 'unifi:<id>'.
  const mine = new Map();   // visitorId -> { bookingId, due } for every credential we recorded
  try {
    for (const b of D.prepare(
      `SELECT id, date, end_date, end_time, remotelock_person_id
         FROM bookings WHERE remotelock_person_id LIKE 'unifi:%'`).all()) {
      const end = require('./doorlock').bookingEndDate(b);
      const due = !!end && Math.floor(end.getTime() / 1000) < cutoff;
      mine.set(String(b.remotelock_person_id).slice(6), { bookingId: b.id, due });
    }
  } catch (e) {
    adminLog('UNIFI_VISITOR_SWEEP_ERROR', `could not read our own credential records: ${e.message.slice(0, 140)}`);
    return Object.assign(out, { error: e.message });
  }

  const bookingExists = id => { try { return !!D.prepare('SELECT 1 FROM bookings WHERE id = ?').get(id); } catch { return false; } };
  try {
    const visitors = await listAllVisitors();
    out.scanned = visitors.length;
    for (const v of visitors) {
      if (!v || !v.id) { out.unmatched++; continue; }
      const id = String(v.id);
      let why = '', due = false;
      if (mine.has(id)) { why = 'record'; due = mine.get(id).due; }
      else {
        // SECOND GUARD, kept for what the record cannot cover: rows created
        // before we stored the id, and rows whose identity the 10-year purge
        // stripped (services/records.js clears remotelock_person_id). It only
        // ever ADDS to what the record found - it is never the sole gate now.
        const bid = ourBookingId(v);
        if (bid) {
          // Recognising it and being willing to REMOVE it are different questions.
          // A visitor carrying our signature whose booking row has gone (deleted,
          // or its identity stripped by the 10-year purge) is still ours and still
          // worth counting - but we will not delete anything we cannot tie back to
          // a booking we can still see.
          const end = Number(v.end_time || 0);
          why = 'signature';
          due = !!(end && end < cutoff && bookingExists(bid));
        }
      }
      if (!why) { out.unmatched++; continue; }   // not ours at all - never touched
      // OURS means recognisably ours; KEPT means ours but its window has not passed
      // the grace yet. Collapsing those two into one number lost the distinction
      // between "there was nothing to take" and "I did not recognise anything",
      // which is exactly the difference B10 was about. (The existing battery
      // asserted this and was right to.)
      out.ours++;
      if (!due) { out.kept++; continue; }
      try {
        await api('DELETE', `/visitors/${id}?is_force=true`, undefined);
        out.removed.push(id);
        if (why === 'record') out.byRecord++; else out.bySignature++;
      } catch (err) {
        if (/not found|404|CODE_NOT_EXISTS|CODE_RESOURCE_NOT_FOUND/i.test(String(err.message))) { out.removed.push(id); continue; }
        out.errors++;
        adminLog('UNIFI_VISITOR_SWEEP_ERROR', `visitor ${id}: ${err.message.slice(0, 120)}`);
      }
    }
    // SAY WHICH IT WAS (rule 29): "nothing to do" and "I could not tell whether
    // there was anything to do" are different nights, and the old line could not
    // tell them apart. `expected` is what OUR record says should have been there.
    const expected = Array.from(mine.values()).filter(m => m.due).length;
    const missed = expected - out.byRecord;
    adminLog('UNIFI_VISITOR_SWEEP',
      `scanned ${out.scanned} | ours ${out.ours} | removed ${out.removed.length} | kept ${out.kept}`
      + ` | errors ${out.errors} | not ours ${out.unmatched} | matched by record ${out.byRecord}, by signature ${out.bySignature}`
      + (expected ? ` | our record expected ${expected}` + (missed > 0 ? `, ${missed} of them were NOT on the console` : '') : '')
      + (out.removed.length ? ' | ' + out.removed.slice(0, 20).join(',') : ''));
  } catch (err) {
    adminLog('UNIFI_VISITOR_SWEEP_ERROR', err.message.slice(0, 160));
    out.error = err.message;
  }
  return out;
}

// ═══ MEMBER ACCESS NETWORK (maintainer, Aug 19) ══════════════════════════════════════
// Members become REAL console users: their member PIN is their door PIN.
//  - ALWAYS-ON: tier.unifi_static_doors -> a managed per-tier policy on the
//    user (24/7). Front door, member lounge - works any time.
//  - BOOKING BOOST: at code time the scheduler ATTACHES managed policies for
//    the booking's doors (facility booking set + the bay's own doors) to the
//    member's user, and DETACHES them at session end. Policies UNION on the
//    console (Ubiquiti-documented), so access widens for the tee time and
//    narrows after - same PIN throughout. No visitor, no PIN collision.
// Managed objects are namespaced "BA " and their console ids cached in
// cfg.unifiAccess.managed so we update rather than duplicate.

function managedCache() { return cfgU().managed || { schedule: '', policies: {} }; }
/** Merge a FIELD into the managed cache, re-reading it first.
 *  THE BUG THIS REPLACES (Sep 16 2026, confirmed on the bench): ensurePolicy
 *  captured `m = managedCache()` and only THEN awaited ensureAlwaysSchedule(),
 *  which took its own copy, wrote the new schedule id into it and saved. Control
 *  came back to ensurePolicy holding the copy from BEFORE - schedule still '' -
 *  and its own `saveManaged(m)` wrote that empty value straight back over the id
 *  just stored. The schedule was therefore never retained: every single policy
 *  write re-entered ensureAlwaysSchedule and POSTed another schedule called
 *  'BA Always'. On a console that requires schedule names to be unique, the
 *  SECOND policy fails and the Member Access Network is dead from then on -
 *  reproduced exactly, test-unifi-standin B2. Never hold this object across an
 *  await; merge the one field you own. */
function mergeManaged(patch) {
  try {
    const cfgSvc = require('./config');
    const cfg = cfgSvc.getConfig();
    const cur = (cfg.unifiAccess && cfg.unifiAccess.managed) || { schedule: '', policies: {} };
    const next = Object.assign({}, cur, patch, { policies: Object.assign({}, cur.policies || {}, patch.policies || {}) });
    cfg.unifiAccess = Object.assign({}, cfg.unifiAccess, { managed: next });
    cfgSvc.writeConfigRaw(cfg);
    return next;
  } catch (e) {
    // Losing this write is not cosmetic: the ids are how we UPDATE rather than
    // duplicate, so a silent failure piles managed objects up on the owner's
    // console forever. It was a bare catch until Sep 16 2026.
    adminLog('UNIFI_MANAGED_CACHE_ERROR', `could not record the console's managed ids: ${e.message.slice(0, 140)}`);
    return null;
  }
}

/** Our 24/7 schedule (policies need one). Created once, id cached. */
async function ensureAlwaysSchedule() {
  const cached = managedCache().schedule;
  if (cached) return cached;
  const week = {};
  for (const d of ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
    week[d] = [{ start_time: '00:00:00', end_time: '23:59:59' }];
  let id = '';
  try {
    const out = await api('POST', '/access_policies/schedules', { name: 'BA Always', week_schedule: week });
    id = out?.data?.id;
  } catch (e) {
    // We may be looking at one WE already made - either on a console whose cache
    // entry we lost, or on a console carrying the duplicates the old cache bug
    // created before this fix landed. A name clash is recoverable; anything else
    // is a real failure and stops.
    if (!/ALREADY|EXIST|duplicate|CODE_PARAMS_INVALID/i.test(String(e.message))) throw e;
    const found = await findScheduleByName('BA Always');
    if (!found) throw new Error(`UniFi Access refused the 'BA Always' schedule and it is not readable on the console either (${e.message})`);
    id = found;
    adminLog('UNIFI_SCHEDULE_ADOPTED', `re-using the console's existing 'BA Always' schedule ${id}`);
  }
  if (!id) throw new Error('UniFi Access: schedule create returned no id');
  mergeManaged({ schedule: id });
  return id;
}

/** ADOPT WHAT WE MADE BEFORE THE MARKER EXISTED - from OUR OWN RECORD, and only
 *  from our own record.
 *
 *  THIS USED TO PUT A MARKER ONTO THE CONSOLE and it does not any more (maintainer's
 *  ruling, Sep 16 2026). The write was `PUT /visitors/<id> {remarks}` - a single
 *  field - and no source I have says whether that endpoint MERGES or REPLACES.
 *  Under replace it would have blanked the window and the `resources` of every
 *  live visitor on the console at 05:00 every morning: every door code in the
 *  building stops working, issued by the safety net that exists to prevent
 *  exactly that. A path that cannot be made safe under both readings does not
 *  ship, so this one does not.
 *
 *  Nothing is lost by dropping it. The sweep's PRIMARY authority is already this
 *  database - bookings.remotelock_person_id holds 'unifi:<id>' for every visitor
 *  we ever created - and the console-side marker is only its secondary guard. New
 *  visitors carry the marker because createBookingVisitor sends a whole body, so
 *  the merge-vs-replace question never arises there.
 *
 *  What remains is a one-time note in the owner's log recording how many
 *  pre-marker credentials this unit is carrying, so the count is visible rather
 *  than implied. Stamped like stripemark's adoptedAt so it happens once.
 *  When a real console answers question 9 and PUT turns out to MERGE, stamping
 *  the console itself becomes a two-line change - see the UNSETTLED list. */
async function adoptOurVisitors(opts = {}) {
  const cfg = getConfig();
  if ((cfg.doorAccess || {}).provider !== 'unifi') return { did: 'skip', why: 'provider' };
  const u = cfg.unifiAccess || {};
  if (u.visitorsAdoptedAt && !opts.force) return { did: 'skip', why: 'adopted ' + u.visitorsAdoptedAt };
  const mine = unitId();
  if (!mine) return { did: 'skip', why: 'this unit has no id yet' };
  try {
    const rows = require('./db').db.prepare(
      `SELECT id FROM bookings WHERE remotelock_person_id LIKE 'unifi:%'`).all();
    const full = getConfig();
    full.unifiAccess = Object.assign({}, full.unifiAccess, { visitorsAdoptedAt: new Date().toISOString() });
    require('./config').saveConfig(full);
    adminLog('UNIFI_VISITORS_ADOPTED', `${rows.length} door credential(s) made before this unit started stamping its own name on them - the nightly sweep knows them from this unit's own records, not from the console`);
    return { did: 'adopted', fromRecord: rows.length };
  } catch (e) { return { did: 'deferred', error: e.message }; }
}

/** Find a managed schedule the console already holds, by the name WE give ours.
 *  Needed twice over: to recover a lost cache entry, and to adopt the duplicate
 *  'BA Always' rows the pre-Sep-16 cache bug will have left on any console that
 *  has been running the Member Access Network. Returns the id or ''. */
async function findScheduleByName(name) {
  try {
    const out = await api('GET', '/access_policies/schedules');
    const rows = Array.isArray(out?.data) ? out.data : (Array.isArray(out?.data?.items) ? out.data.items : []);
    const hit = rows.find(r => String(r.name || '') === name);
    return hit ? hit.id : '';
  } catch { return ''; }
}

/** Create-or-update a managed policy holding a door/group set. */
async function ensurePolicy(key, name, targets) {
  const scheduleId = await ensureAlwaysSchedule();
  const resources = parseTargets(targets);
  if (!resources.length) return null;
  // OFFICIAL PDF (5.2 Create Access Policy, verified Aug 19): the door array
  // key is 'resource' (SINGULAR) in Ubiquiti's own example - their field
  // table even labels sub-rows resources[]. We send BOTH keys so either
  // console reading works; the singular is the documented one. Without this,
  // policies would have been created EMPTY (member PINs opening nothing).
  const body = { name: 'BA ' + name, resource: resources, resources, schedule_id: scheduleId };
  // Re-read AFTER the await above - the cache may have gained the schedule id.
  const known = managedCache().policies || {};
  if (known[key]) {
    try { await api('PUT', `/access_policies/${known[key]}`, body); return known[key]; }
    catch (e) {
      // Only NOT-FOUND means the id is stale. Reading every failure as "stale"
      // made a timeout or a 429 create a duplicate policy on the console.
      if (!/not found|404|CODE_NOT_EXISTS|CODE_RESOURCE_NOT_FOUND/i.test(String(e.message))) throw e;
    }
  }
  const out = await api('POST', '/access_policies', body);
  const id = out?.data?.id;
  if (!id) throw new Error('UniFi Access: policy create returned no id');
  mergeManaged({ policies: { [key]: id } });
  return id;
}

// ── WRITE A WHOLE RECORD, NEVER A FRAGMENT (maintainer's ruling, Sep 16 2026) ───────
// No source I have says whether PUT MERGES the fields you send or REPLACES the
// record with them, and the cost of guessing wrong is doors coming off a live
// visitor. Rather than pick a reading, every partial update now goes through
// these: READ what the console currently holds, merge the change into it, write
// the WHOLE record back. That is correct under either reading, it preserves
// fields we do not even know about (an NFC card a member added on the console
// themselves), and nobody has to find out which the console does.
// `known` is what WE can reconstruct from our own record - it fills the gaps if
// the GET comes back narrower than the schema suggests, which is its own
// unsettled question. Order matters: console first, our reconstruction second,
// the actual change last.
async function putMerged(path, changes, known = {}) {
  let current = {};
  try {
    const got = await api('GET', path);
    if (got && got.data && typeof got.data === 'object' && !Array.isArray(got.data)) current = got.data;
  } catch (e) {
    // A read we could not make is not permission to write a fragment.
    throw new Error(`UniFi Access could not read ${path} before updating it, so it was left alone rather than part-written (${e.message})`);
  }
  const body = Object.assign({}, current, known, changes);
  delete body.id;            // the id is in the path, not the body
  await api('PUT', path, body);
  return body;
}

/** Read the console user's current policy set.
 *  THREE STATES, not two (rule 31 applied to a read): an array means the console
 *  told us; NULL means it did not - the field was absent, which the reference
 *  suggests can happen without expand[]. Until Sep 16 2026 every caller wrote
 *  `(cur?.data?.access_policy_ids || [])`, so an absent field became an EMPTY
 *  LIST and the very next line PUT that empty list back - wiping the member's
 *  real access. A read we did not get is never a set we may write. */
async function readUserPolicies(userId) {
  const cur = await api('GET', `/users/${userId}?expand[]=access_policy`);
  const ids = cur?.data?.access_policy_ids;
  return Array.isArray(ids) ? ids.filter(Boolean) : null;
}
/** Every policy id this appliance manages on the console right now. */
function managedPolicyIds() { return Object.values(managedCache().policies || {}).filter(Boolean); }

/** The member's console user, brought to what this unit's record says it should be
 *  (services/memberaccess.js - Sep 25 2026: written from the unit's own record, never from
 *  the console's report of the user's access). Throws when the console has not taken it. */
async function syncMember(member) {
  const r = await require('./memberaccess').reconcile(member.id, { shown: true });
  if (!r || !r.ok) throw new Error('UniFi Access: ' + ((r && (r.error || r.skipped)) || 'the member could not be synced'));
  return { userId: r.userId, policyIds: r.policies || [] };
}

/** The boost policies a member's still-running session is holding right now.
 *  A roster sync must not take these away mid-session. */
function liveBoostPolicyIds(member) {
  try {
    const uid = member && member.unifi_user_id;
    if (!uid) return [];
    const rows = require('./db').db.prepare(
      `SELECT remotelock_person_id, date, end_date, end_time FROM bookings
        WHERE remotelock_person_id LIKE ? AND status='active'`).all('unifiuser:' + uid + ':%');
    const out = [];
    for (const r of rows) {
      // TOLERANT PARSE (Sep 16 2026): a 24-hour club ends at "25:30" and the naive
      // form is Invalid Date - which read as "this session is over" and let a
      // roster sync strip the live boost this function exists to protect.
      const e = require('./doorlock').bookingEndDate(r);
      if (!e || e.getTime() <= Date.now()) continue;
      const plist = String(r.remotelock_person_id).split(':')[2] || '';
      out.push(...plist.split('+').filter(Boolean));
    }
    return out;
  } catch { return []; }
}

/** Sync every member (Settings button, and nightly). Returns a summary. */
async function syncAllMembers() { return require('./memberaccess').reconcileAll(); }

/** Member left / deactivated: the console user is DEACTIVATED, never deleted (maintainer's ruling,
 *  Sep 25 2026), through the one reconcile - which keeps retrying until the console takes it. */
async function deactivateMemberUser(unifiUserId, member) {
  if (!unifiUserId) return { ok: true, note: 'no console user' };
  const row = member && member.id ? member : require('./db').db.prepare('SELECT * FROM members WHERE unifi_user_id=?').get(unifiUserId);
  if (!row) return { ok: true, note: 'no member record for this console user' };
  const r = await require('./memberaccess').reconcile(row.id, { shown: true });
  return r && r.ok ? { ok: true } : { ok: false, error: String((r && (r.error || r.skipped)) || 'no answer').slice(0, 200) };
}

/** Booking boost: the member's access on for this booking's window (services/memberaccess). */
async function boostMemberForBooking(booking) { return require('./memberaccess').accessOn(booking); }

/** Session over or cancelled: the member's doors become what the unit's record says they
 *  should be now (services/memberaccess.accessOff). A reference whose user is no member row of
 *  ours (data from before the member record) falls back to detaching the policies it names. */
async function unboostMember(ref, opts = {}) {
  const r = await require('./memberaccess').accessOff(ref, opts);
  return r === null ? legacyUnboost(ref, opts) : r;
}
async function legacyUnboost(ref, opts = {}) {
  try {
    const [userId, plist] = String(ref).split(':');
    const detach = new Set((plist || '').split('+').filter(Boolean));
    // nothing was ever attached under this reference: there is nothing live to take
    // away, so the pointer may be cleared - but say which case it was.
    if (!userId || !detach.size) return { ok: true, note: 'no boost policies in the reference' };
    // A-wave 11b: these policy ids are the FACILITY's, not this booking's. If the same
    // member has another session still running under the same boost, detaching them
    // shuts a door on a customer who is inside. That other booking's own revoke takes
    // them back when it ends; this reference is simply superseded.
    try {
      const dbM = require('./db');
      // EXCLUDE THE BOOKING WE ARE ACTING FOR (Sep 16 2026 - a door-open bug the
      // rule-27 critic proved). Staff cancel or move runs this revoke BEFORE it
      // writes status='cancelled', so the booking being cancelled was still
      // 'active' here and matched its own query: unboost saw "another live
      // session of this member", returned ok:true, and the caller - correctly
      // reading ok:true - cleared the credential pointer. The boost stayed
      // attached to the member's console user with nothing left pointing at it,
      // so nothing would ever take it off. A cancelled member kept the widened
      // door access indefinitely.
      const others = dbM.db.prepare(
        `SELECT id, date, end_date, end_time FROM bookings
          WHERE remotelock_person_id LIKE ? AND status='active' AND id <> ?`)
        .all('unifiuser:' + userId + ':%', String(opts.exceptBookingId || ''));
      const stillRunning = others.some(o => { const e = require('./doorlock').bookingEndDate(o); return !!e && e.getTime() > Date.now(); });
      if (stillRunning) { adminLog('DOOR_CODE_REVOKE_HELD', `member boost for user ${userId} kept: another session of theirs is still running`); return { ok: true, note: 'another live session of this member holds the same boost' }; }
    } catch {}
    const held = await readUserPolicies(userId);
    if (held === null) return { ok: false, error: 'the console did not report this member\'s access, so the boost was left in place rather than guessed at' };
    const remaining = held.filter(id => !detach.has(id));
    await api('PUT', `/users/${userId}/access_policies`, { access_policy_ids: remaining });
    adminLog('DOOR_CODE_REVOKED', `member boost detached: user ${userId} -${detach.size}`);
    return { ok: true };
  } catch (err) {
    adminLog('DOOR_CODE_REVOKE_ERROR', `member boost ${ref}: ${err.message.slice(0, 120)}`);
    return { ok: false, error: String(err.message).slice(0, 200) };
  }
}

// ═══ THE CONSOLE PRIMITIVES services/memberaccess.js DRIVES (Sep 25 2026) ═══════
// A member's console user is written from THIS UNIT'S RECORD of what it granted, never
// from the console's answer about what the user holds (open question 3 of the Sep 16
// audit: whether GET /users/:id reports access_policy_ids at all). These four calls are
// all memberaccess needs; each throws on a refusal so the caller records and retries.
function nameParts(member) {
  const parts = String((member && member.name) || 'Member').trim().split(/\s+/);
  return { first_name: parts[0] || 'Member', last_name: parts.slice(1).join(' ') || '.' };
}
async function consoleCreateUser(member) {
  const out = await api('POST', '/users', Object.assign(nameParts(member), { employee_number: 'BA-' + member.id }));
  const id = out?.data?.id;
  if (!id) throw new Error('UniFi Access: user create returned no id');
  return id;
}
/** Set a user's PIN. Answers 'taken' for a PIN the console already holds, 'length' for one its
 *  PIN setting refuses; throws on anything else. */
async function consoleSetPin(userId, pin) {
  try { await api('PUT', `/users/${userId}/pin_codes`, { pin_code: String(pin) }); return 'set'; }
  catch (e) {
    const m = String(e.message);
    if (/ALREADY_EXIST|already exists|duplicate/i.test(m)) return 'taken';
    if (/LENGTH_INVALID|length/i.test(m)) return 'length';
    throw e;
  }
}
async function consoleSetStatus(userId, member, active) {
  await putMerged(`/users/${userId}`, { status: active ? 'ACTIVE' : 'DEACTIVATED' }, Object.assign(nameParts(member), { employee_number: 'BA-' + member.id }));
}
async function consolePutPolicies(userId, ids) {
  await api('PUT', `/users/${userId}/access_policies`, { access_policy_ids: Array.from(new Set(ids)) });
}
/** The tier's always-on doors, as policy ids (created on the console the first time). */
async function staticPolicyIds(tier) {
  const targets = (() => { try { return JSON.parse((tier && tier.unifi_static_doors) || '[]'); } catch { return []; } })();
  if (!targets.length) return [];
  const pid = await ensurePolicy('tier-' + tier.id, 'Tier ' + (tier.name || tier.id), targets);
  return pid ? [pid] : [];
}
/** The doors one member booking opens, as policy ids: the facility's booking doors, the bay's
 *  own doors and the tier's booking-time doors - the same three layers a visitor gets. */
async function bookingPolicyIds(booking, member) {
  const cfg = getConfig();
  const out = [];
  const facilityTargets = (cfgU().doorIds || []);
  if (facilityTargets.length) { const pid = await ensurePolicy('booking-doors', 'Booking Doors', facilityTargets); if (pid) out.push(pid); }
  const bay = (cfg.bays || []).find(b => b.id === booking.bay_id);
  if (bay && (bay.unifiDoors || []).length) { const pid = await ensurePolicy('bay-' + bay.id, 'Bay ' + (bay.name || bay.id), bay.unifiDoors); if (pid) out.push(pid); }
  try {
    const row = require('./db').db.prepare(`SELECT t.id, t.name, t.unifi_doors FROM membership_tiers t WHERE t.id = ?`).get(member.tier_id);
    const arr = row && row.unifi_doors ? JSON.parse(row.unifi_doors || '[]') : [];
    if (arr.length) { const pid = await ensurePolicy('tierbook-' + row.id, 'Tier Booking ' + (row.name || row.id), arr); if (pid) out.push(pid); }
  } catch {}
  return out;
}

/** Settings "Test Connection": detect transport, list doors, report style. */
/** The owner's Test Connection. `trustCert` is the fingerprint the owner was SHOWN
 *  and accepted - only a certificate with exactly that fingerprint is trusted in place
 *  of the old one; a first contact is trusted as on any call. The answer names the
 *  certificate the unit now holds to, so the owner can compare it with the console. */
async function testConnection(opts = {}) {
  const mode = opts.trustCert ? { trust: String(opts.trustCert) } : 'use';
  const { doors, groups } = await listAccessTargets(mode);
  const style = cfgU().apiStyle || 'detected';
  // the address the answer actually came from, by the same builder every call uses
  let origin = '';
  try { const u = new URL(STYLES[style === 'proxy' ? 'proxy' : 'documented'](cleanHost(cfgU().host))); origin = `${u.hostname}:${u.port || 443}`; } catch {}
  const pin = certPins()[origin];
  const cert = pin ? Object.assign({ origin }, pin) : null;
  return { ok: true, style, doors, groups, cert };
}

// STYLES exported as a TEST SEAM: the battery stands up mock consoles on
// unprivileged ports and repoints these URL builders. Production never touches it.
module.exports = { certPins, CertChangedError, isCertChange, createBookingVisitor, revokeVisitor, sweepExpiredVisitors, listAllVisitors, ourBookingId, listDoors, listDoorGroups, listAccessTargets, parseTargets, resolveDoorsForBooking, testConnection, generatePin, STYLES,
  syncMember, syncAllMembers, deactivateMemberUser, boostMemberForBooking, unboostMember, ensurePolicy, ensureAlwaysSchedule,
  moveVisitorWindow, readUserPolicies, findScheduleByName, pinLength, PIN_LENGTHS,
  adoptOurVisitors, ourRemark, unitId,
  consoleCreateUser, consoleSetPin, consoleSetStatus, consolePutPolicies, staticPolicyIds, bookingPolicyIds, managedPolicyIds, nameParts };
