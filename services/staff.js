// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/staff.js — Staff identity core (Wave A of the staff-surface build).
//
// Model: cfg.server.staff = [{ name, code, active }]. The CODE is the identity
// (4-6 digits, unique across the roster). Signing in on the /staff pad trades a
// code for a short-lived token; every staff request carries `x-staff-token`.
// Identity is SERVER-SIDE: the session name overrides any client-supplied
// employee field, so stamps can't be spoofed from the pad.
//
// Sessions are in-memory (single-process Pi) with two clocks:
//   - idle TTL   = cfg.pos.autoLockMins (default 2) — the auto-lock law
//   - absolute   = 12h hygiene cap
// Locking (manual or idle) just invalidates the token; the pad is the resting
// state. Failed logins rate-limit per IP (5 misses -> 60s) and log to admin_log.
//
// LAN law: staff sign-in works only on the facility network. Tunnel traffic is
// detected exactly like the /setup gate — Cloudflare headers present = off-site.
'use strict';

const crypto = require('crypto');
const configService = require('./config');

const sessions = new Map();          // token -> { name, code, scope, created, last }
// SCOPES (Sep 2026, the employee system):
//   full   - the on-site pad. Idle auto-lock + 12h cap. Operates the facility.
//   remote - the /me employee app, minted only by routes/me.js. No idle lock
//            (a phone checks a schedule now and then), hard 30-day cap, and it
//            is refused by requireStaffOrAdmin everywhere - so every existing
//            endpoint (POS, bays, clock, today, check-in) stays LAN-safe for
//            free. Only requireAnyStaff (view-or-request handlers) accepts it.
const REMOTE_MS   = 30 * 24 * 60 * 60 * 1000;
const failures = new Map();          // ip -> { count, until }

const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const LOCKOUT_MS  = 60 * 1000;
const MAX_FAILS   = 5;

function cfg() { return configService.getConfig(); }

function autoLockMins() {
  const v = Number(cfg().pos?.autoLockMins);
  return Number.isFinite(v) && v >= 1 ? v : 2;
}

function roster() {
  const list = cfg().server?.staff;
  return Array.isArray(list) ? list : [];
}

// A NEW SIGN-IN CODE CARRIES THE PERSON'S RECORD WITH IT (Oct 25 2026). The code is the durable identity of every shift, clock
// entry, request and saved week pattern (services/db.js), so a roster save that gave someone a new code left all of it under the
// old one: the schedule showed their shifts as nobody's, their open clock-in could not be closed and their requests were gone
// from their phone. Who kept their place is read from what the owner did - the admin page says which row each code came from
// (`was`); a caller that does not (a page left open from before, the assistant) is matched by name, then by employee number,
// only where exactly one person fits. A row whose name AND employee number both changed is a different person, never a move:
// moving someone's hours onto a new hire is worse than leaving them under the old code.
const key = (v) => String(v || '').trim().toLowerCase();
// ONE PERSON OR TWO (Oct 25 2026, the review of the change above): two employee numbers, both filled in, decide - different
// numbers are different people even under one name (a departed Mike and the new Mike); with either one blank the name decides.
function samePerson(a, b) {
  const ea = key(a && a.empNumber), eb = key(b && b.empNumber);
  if (ea && eb) return ea === eb;
  return !!key(a && a.name) && key(a && a.name) === key(b && b.name);
}
// opts.pageRows: the admin page says which row each code came from (Oct 25 2026). A row it ADDED carries no `was`, and a row
// that kept its code is that row whatever its name now is - so on the page's save nothing is ever matched by name: a departed
// Mike removed and a new Mike added in one save, or Bob renamed Robert while a new Bob is hired, used to put the old person's
// hours on the new hire. Any row carrying a `was` means the same (the assistant on BA Core 2 AI sends one on every row).
function codeMoves(before, after, was, opts) {
  const old = (before || []).filter(s => s && /^\d{4,6}$/.test(String(s.code || '')));
  const same = (o, n) => (key(o.name) && key(o.name) === key(n.name)) || (key(o.empNumber) && key(o.empNumber) === key(n.empNumber));
  const said = !!(opts && opts.pageRows) || (Array.isArray(was) && was.some(Boolean));
  const moves = [], from = new Set(), to = new Set();
  const take = (o, n) => { if (String(o.code) === String(n.code)) { from.add(String(o.code)); to.add(String(n.code)); return; } moves.push({ from: String(o.code), to: String(n.code), name: n.name }); from.add(String(o.code)); to.add(String(n.code)); };
  // 1. a code that stayed with the same person is no move, and is taken out of the matching first; on the page's save, a row
  //    that kept its code (a rename) is pinned to it, so its history can never be matched onto someone else
  after.forEach((n, i) => { const o = old.find(x => String(x.code) === String(n.code)); if (o && (said ? (was && was[i]) === String(n.code) : same(o, n))) take(o, n); });
  // 2. the row the page says it was
  after.forEach((n, i) => { const w = was && was[i]; if (!w || to.has(String(n.code)) || from.has(w)) return; const o = old.find(x => String(x.code) === w); if (o && same(o, n)) take(o, n); });
  if (said) return moves;
  // 3. a caller that does not say (a page left open from before): the same name, then the same employee number - one each side
  //    or nothing. Two different employee numbers are never joined by a name. Repeated until a round takes nothing, so a row
  //    waiting on a code someone else is leaving is matched once it is free (Alice taking Bob's old code while Bob takes a new
  //    one moved only Bob's when Alice came first in the list and the facility has no employee numbers).
  const clashEmp = (o, n) => key(o.empNumber) && key(n.empNumber) && key(o.empNumber) !== key(n.empNumber);
  for (let took = true; took;) {
    took = false;
    for (const [k, byName] of [[s => key(s.name), true], [s => key(s.empNumber), false]]) for (const o of old) {
      if (from.has(String(o.code)) || !k(o)) continue;
      const ns = after.filter(n => !to.has(String(n.code)) && k(n) === k(o) && !(byName && clashEmp(o, n))), os = old.filter(x => !from.has(String(x.code)) && k(x) === k(o));
      if (ns.length === 1 && os.length === 1 && !old.some(x => String(x.code) === String(ns[0].code) && !from.has(String(x.code)))) { take(o, ns[0]); took = true; }
    }
  }
  return moves;
}
const CODE_TABLES = ['time_entries', 'shifts', 'timeoff_requests', 'shift_requests'];
// rows filed under a code: the four tables and the saved week patterns' entries
function historyCount(d, code) {
  let n = CODE_TABLES.reduce((s, t) => s + Number((d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE staff_code = ?`).get(code) || {}).n || 0), 0);
  for (const r of d.prepare(`SELECT payload FROM shift_templates`).all()) {
    let p; try { p = JSON.parse(r.payload); } catch { continue; }
    if (Array.isArray(p)) n += p.filter(x => x && String(x.staff_code) === String(code)).length;
  }
  return n;
}
// Refuse a code move onto another worker's history before anything is written.
// A code leaving its current holder in the same save can be reused.
function codeClashes(moves) {
  if (!moves || !moves.length) return [];
  const d = require('./db').db;
  const leaving = new Set(moves.map(m => m.from));
  return moves.filter(m => !leaving.has(m.to) && historyCount(d, m.to) > 0).map(m => ({ name: m.name, code: m.to }));
}
function moveCodes(moves) {
  const out = [];
  if (!moves || !moves.length) return out;
  const d = require('./db').db;
  const counts = moves.map(m => CODE_TABLES.reduce((n, t) => n + Number((d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE staff_code = ?`).get(m.from) || {}).n || 0), 0));
  // through a placeholder, so two people trading codes never land under one
  for (const m of moves) for (const t of CODE_TABLES) d.prepare(`UPDATE ${t} SET staff_code = ? WHERE staff_code = ?`).run('~' + m.to, m.from);
  for (const m of moves) for (const t of CODE_TABLES) d.prepare(`UPDATE ${t} SET staff_code = ? WHERE staff_code = ?`).run(m.to, '~' + m.to);
  // a saved week pattern holds the code inside its JSON
  const map = new Map(moves.map(m => [m.from, m.to]));
  for (const r of d.prepare(`SELECT id, payload FROM shift_templates`).all()) {
    let p; try { p = JSON.parse(r.payload); } catch { continue; }
    if (!Array.isArray(p)) continue;
    let changed = false;
    for (const x of p) if (x && map.has(String(x.staff_code))) { x.staff_code = map.get(String(x.staff_code)); changed = true; }
    if (changed) d.prepare(`UPDATE shift_templates SET payload = ? WHERE id = ?`).run(JSON.stringify(p), r.id);
  }
  moves.forEach((m, i) => { out.push({ name: m.name, rows: counts[i] }); log('staff_code_changed', `${m.name}: a new sign-in code; ${counts[i]} shift, clock and request row${counts[i] === 1 ? '' : 's'} moved with it`); });
  return out;
}

function viaTunnel(req) {
  return !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
}

function log(event, detail) {
  try { require('./db').adminLog(event, detail); } catch { /* never break auth on logging */ }
}

function clientIp(req) {
  // Shared helper so every lockout in the product identifies clients the
  // same way. The staff surface is LAN-only, so this resolves to the socket
  // address as before.
  try { return require('./auth').getClientIp(req); }
  catch { return String(req.socket?.remoteAddress || req.ip || 'unknown'); }
}

// ── login / logout ─────────────────────────────────────────────────────────

function login(code, req, opts) {
  const remote = !!(opts && opts.remote);
  const ip = clientIp(req);
  const f = failures.get(ip);
  const now = Date.now();
  if (f && f.until > now) return { ok: false, locked: true };

  const c = String(code || '').trim();
  // W40 (Sep 9 2026): no code at all - a bare POST, a Go with nothing typed -
  // presents no credential and is never a guess: not counted, not logged.
  if (!c) return { ok: false };
  const hit = roster().find(s => s && s.active !== false && String(s.code) === c && c.length >= 4 && c.length <= 6);
  if (!hit) {
    const recent = (f && now - (f.last || 0) < 10 * 60 * 1000) ? f.count : 0;
    const n = recent + 1;
    failures.set(ip, { count: n, last: now, until: n >= MAX_FAILS ? now + LOCKOUT_MS : 0 });
    log('staff_login_failed', `ip=${ip}`);
    return { ok: false };
  }
  failures.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  // the employee number rides with the session so validate can tell the person, not only the code (Oct 25 2026)
  sessions.set(token, { name: String(hit.name || 'Staff').slice(0, 40), code: String(hit.code || ''), emp: String(hit.empNumber || ''),
    scope: remote ? 'remote' : 'full', created: now, last: now });
  log(remote ? 'staff_login_remote' : 'staff_login', hit.name);
  return { ok: true, token, name: hit.name, code: String(hit.code || ''), scope: remote ? 'remote' : 'full', autoLockMins: autoLockMins() };
}

function logout(token) {
  const s = sessions.get(token);
  if (s) { sessions.delete(token); log('staff_lock', s.name); }
  return true;
}

// A ROSTER SAVE SIGNS OUT EVERY CODE THAT CHANGED HANDS (Oct 25 2026). The shifts, hours and requests now move with a new code
// (codeMoves), so a pad or phone still signed in on a code that moved, or that someone else now holds, would act on the other
// person's record - clock out their open entry, show their time off, drop their shift. validate tells two people apart by name
// and employee number; this covers the rest (two people of one name trading codes): every code a move left or reached, every
// code gone from the roster, and every code now on a row that did not hold it (the page's `was`, else a different person).
// Both people sign in again with their own codes, as the guide says.
function handsChanged(before, after, was, moves, opts) {
  const said = !!(opts && opts.pageRows) || (Array.isArray(was) && was.some(Boolean));
  const out = new Set();
  for (const m of moves || []) { out.add(String(m.from)); out.add(String(m.to)); }
  for (const o of before || []) {
    if (!o || !/^\d{4,6}$/.test(String(o.code || ''))) continue;
    const i = (after || []).findIndex(n => n && String(n.code) === String(o.code));
    if (i < 0 || (said ? (was && was[i]) !== String(o.code) : !samePerson(o, after[i]))) out.add(String(o.code));
  }
  return [...out];
}
function endSessions(codes) {
  const set = new Set((codes || []).map(String));
  let n = 0;
  for (const [t, s] of sessions) if (set.has(String(s.code))) { sessions.delete(t); n++; log('staff_lock', `${s.name}: signed out - their sign-in code changed hands`); }
  return n;
}

// ── validation ─────────────────────────────────────────────────────────────

function validate(token, nowMs) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  // (Oct 20 2026) someone taken off the roster or switched off is signed out at their next tap - a session used to outlive
  // them, thirty days on their phone
  // (Oct 25 2026) and the code must still be THIS person's. A code is handed on - two people trade, or a removed person's code
  // goes to a new hire - and a session that checked only the code went on acting as whoever holds it now: Alice's phone showed
  // Bob's shifts, hours and time off under her name and filed her requests under his code.
  const holder = roster().find(e => e && e.active !== false && String(e.code) === s.code);
  if (!holder || !samePerson({ name: String(holder.name || 'Staff').slice(0, 40), empNumber: holder.empNumber }, { name: s.name, empNumber: s.emp })) { sessions.delete(token); return null; }
  const now = nowMs || Date.now();
  if (s.scope === 'remote') {
    if (now - s.created > REMOTE_MS) { sessions.delete(token); return null; }
    s.last = now;
    return { name: s.name, code: s.code || '', scope: 'remote' };
  }
  if (now - s.created > ABSOLUTE_MS) { sessions.delete(token); return null; }
  if (now - s.last > autoLockMins() * 60 * 1000) { sessions.delete(token); return null; }
  s.last = now;
  // Returns the CODE too. The pilot facility port broke every clock action by
  // returning { name } only - the code is the durable identity on the clock.
  return { name: s.name, code: s.code || '', scope: s.scope || 'full' };
}

// ── middleware ─────────────────────────────────────────────────────────────
// Staff token OR the owner's admin password. Sets req.staffName when a staff
// session (or an admin-supplied x-employee) identifies the person acting.

function requireStaffOrAdmin(req, res, next) {
  const st = validate(req.headers['x-staff-token']);
  // FULL scope only. A remote (/me) token is a real session but it may not
  // operate the facility - this one line keeps every pre-existing endpoint
  // LAN-safe without touching any of them.
  if (st && st.scope === 'full') { req.staffName = st.name; req.staffCode = st.code; req.staffAuth = 'staff'; return next(); }
  if (require('./auth').verifyAdminRequest(req)) {
    req.staffName = String(req.headers['x-employee'] || req.body?.employee || '').slice(0, 40);
    req.staffCode = '';
    req.staffAuth = 'admin';
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// full OR remote OR admin. Only routes/me.js may use this, and everything
// behind it is view-or-request: nothing here operates the facility.
function requireAnyStaff(req, res, next) {
  const st = validate(req.headers['x-staff-token']);
  if (st) { req.staffName = st.name; req.staffCode = st.code; req.staffScope = st.scope; req.staffAuth = 'staff'; return next(); }
  if (require('./auth').verifyAdminRequest(req)) {
    req.staffName = String(req.headers['x-employee'] || '').slice(0, 40); req.staffCode = ''; req.staffScope = 'admin'; req.staffAuth = 'admin';
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireAdminOnly(req, res, next) {
  // OWNER-ONLY (maintainer, Aug 20): the roster holds staff sign-in codes - keys the
  // manager role never touches. requireOwner refuses manager sessions.
  return require('./auth').requireOwner(req, res, next);
}

// test hook: force-expire a session's idle clock
function _testAge(token, ms) {
  const s = sessions.get(token);
  if (s) s.last -= ms;
}

// THE SURFACE GATE (maintainer, Aug 2026): /staff exists wherever the owner has
// declared employees - fully staffed facilities AND hybrids alike. The roster
// IS the declaration; the personal code IS the security (LAN-only, per-person,
// lockout, idle auto-lock, every action stamped). No clock-window logic: staff
// can set up before open and count the drawer after close.
function surfaceEnabled() {
  const c = cfg();
  if (c.booking && c.booking.staffedAccess) return true;
  return roster().some(e => e && e.active !== false && /^\d{4,6}$/.test(String(e.code || '')));
}

module.exports = {
  login, logout, validate, viaTunnel,
  requireStaffOrAdmin, requireAnyStaff, requireAdminOnly,
  surfaceEnabled,
  autoLockMins, roster, codeMoves, moveCodes, codeClashes, handsChanged, endSessions, samePerson, _testAge
};
