// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/memberaccess.js  —  A MEMBER'S DOOR ACCESS ON A UNIFI CONSOLE, WRITTEN FROM
//                                THIS UNIT'S OWN RECORD (Sep 25 2026, maintainer's member design)
//
//  maintainer's design: a member's console user is made at signup with their member PIN and no
//  doors; a booking turns doors on for its window; the end or a cancel turns them off
//  (and a console that was offline gets it when it answers again); a lapse DEACTIVATES
//  the user, never deletes it; a PIN change reaches the console; the PIN is checked free
//  on the console before the member sees it; only users this unit created are touched.
//
//  THE UNIT'S RECORD IS THE TRUTH FOR ITS OWN USERS. What a user holds used to be read
//  back from the console (GET /users/:id access_policy_ids) before every write, and a
//  console that does not report it - open question 3 of the Sep 16 audit, unanswered
//  until a real console is asked - made every member write refuse, so every member booking
//  quietly fell back to a random code. Now the unit keeps, per member, what it last put on
//  the console (members.unifi_pin_set / unifi_status / unifi_granted) and writes from
//  that. When the console DOES report a user's access, anything on that user this unit
//  does not manage (an owner's own policy) is kept; when it does not, the unit's record
//  decides.
//
//  ONE RECONCILE. Every change - signup, PIN change, lapse, a booking's window opening or
//  closing, a cancel - marks the member and runs the same reconcile: the user exists, the
//  PIN is set, the status is right, and the doors are exactly what the member should have
//  NOW: the tier's always-on doors plus the doors of every booking whose window (the
//  owner's "before" minutes ahead of the start to their "after" minutes past the end) is
//  open. Back-to-back bookings therefore never drop access between them. A reconcile that
//  fails is kept on the member row and retried by the scheduler's tick with backoff until
//  the console takes it; the Door codes health line says so meanwhile.
//
//  maintainer's rulings (Sep 25 2026): (1) signup with the console offline shows the PIN and keeps
//  retrying; if the console then refuses that PIN a new one is picked, TEXTED to the
//  member and recorded. (2) access that cannot be turned on falls back to a one-off code,
//  never silently (services/doorlock.js). (3) a lapse deactivates. (4) access turns on at
//  the owner's "before" minutes.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { getConfig } = require('./config');
const dbm = require('./db');
const D = () => dbm.db;
const log = (ev, d) => { try { dbm.adminLog(ev, d); } catch {} };

const BACKOFF_MINS = [1, 2, 5, 10, 20, 30];   // then every 30 minutes, for as long as it takes
const maskPin = p => { const s = String(p || ''); return s.length <= 2 ? '**' : '*'.repeat(s.length - 2) + s.slice(-2); };
const uniq = a => Array.from(new Set((a || []).filter(Boolean)));
const same = (a, b) => { const x = uniq(a).sort(), y = uniq(b).sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
const parseList = s => { if (s === null || s === undefined || s === '') return null; try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };

/** The console is this unit's door system and member access is switched on. */
function memberAccessOn(cfg = getConfig()) {
  return String((cfg.doorAccess || {}).provider || '') === 'unifi' && !!(cfg.unifiAccess && cfg.unifiAccess.memberAccess && cfg.unifiAccess.memberAccess.enabled);
}
function consoleReachable() { try { return require('./doorlock').providerConfigured('unifi'); } catch { return false; } }

/** The bookings of this member whose door window is open at `now` - the owner's lead before
 *  the start to their lag after the end (doorlock.codeWindow, the one window every provider
 *  uses). A completed booking inside its lag still counts; a cancelled one never does. */
function openBookings(member, now, opts = {}) {
  const cfg = getConfig();
  if (cfg.booking && cfg.booking.staffedAccess) return [];   // an always-staffed facility issues no door access
  const dl = require('./doorlock');
  let rows = [];
  try { rows = D().prepare(`SELECT * FROM bookings WHERE member_id=? AND status IN ('active','completed')`).all(member.id); } catch {}
  return rows.filter(b => {
    if (opts.exceptBookingId && b.id === opts.exceptBookingId) return false;
    if (opts.includeBookingId && b.id === opts.includeBookingId) return true;
    const w = dl.codeWindow(b);
    const s = w.startDt.getTime(), e = w.endDt.getTime();
    return isFinite(s) && isFinite(e) && s <= now && now < e;
  });
}

/** What this member should hold on the console right now, as policy ids. */
async function desiredPolicies(member, now, opts) {
  if (member.status !== 'active' || !memberAccessOn()) return [];
  const ua = require('./unifiaccess');
  const tier = D().prepare('SELECT * FROM membership_tiers WHERE id=?').get(member.tier_id) || {};
  const ids = await ua.staticPolicyIds(tier);
  const open = openBookings(member, now, opts);
  // the booking a door-code job is turning access on FOR counts even if its row is not on
  // disk yet (the caller holds it) - the job must never grant nothing
  if (opts && opts.includeBooking && !open.some(b => b.id === opts.includeBooking.id)) open.push(opts.includeBooking);
  for (const b of open) ids.push(...await ua.bookingPolicyIds(b, member));
  return uniq(ids);
}

// A transport failure fails the reconcile (it is retried); any other refusal to READ a user's
// access is simply "the console does not tell us" and the unit's record decides.
const TRANSPORT = /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|socket hang up|timeout|did not answer|certificate|not configured|disconnected/i;
const NOT_FOUND = /not found|\b404\b|CODE_NOT_EXISTS|CODE_RESOURCE_NOT_FOUND/i;
/** Is the member's console user really gone? Asked of the user itself. */
async function userGone(ua, uid) {
  try { await ua.readUserPolicies(uid); return false; }
  catch (e) { const m = String(e && e.message); return NOT_FOUND.test(m) && !TRANSPORT.test(m); }
}

function shownAlready(opts) { return opts.shownFlag ? !!opts.shownFlag.shown : opts.shown !== false; }

/** Tell a member their PIN changed because the door console already held the old one. */
async function tellNewPin(m, pin) {
  const cfg = getConfig();
  const biz = (cfg.server && cfg.server.businessName) || 'Your golf facility';
  let body = `${biz}: your member PIN is now ${pin}. The door system was already using your old one, so we picked a new one for you. Use ${pin} to book and at the door keypad (type it, then press Enter).`;
  // a family code has no phone or email of its own: the member who holds the membership is told
  // (the build review - the new PIN went to no one while the owner expected it to be sent)
  if (!m.phone && !m.email && m.parent_member_id) {
    const p = D().prepare('SELECT name, phone, email FROM members WHERE id=?').get(m.parent_member_id);
    if (p && (p.phone || p.email)) {
      body = `${biz}: the member PIN for ${m.name} on your membership is now ${pin}. The door system was already using the old one, so we picked a new one. Use ${pin} to book and at the door keypad (type it, then press Enter).`;
      m = Object.assign({}, m, { phone: p.phone, email: p.email });
    }
  }
  // A member record does not carry SMS consent for an automatic PIN change.
  let mail = 'no email';
  if (m.email) { try { const r = await require('./email').sendEmail({ to: m.email, subject: `${biz} - your new member PIN`, text: body }); mail = r === undefined ? 'email not available' : r === true ? 'sent' : 'FAILED'; } catch { mail = 'FAILED'; } }
  log('MEMBER_PIN_SENT', `${m.name}: new PIN ${maskPin(pin)} | email: ${mail}`);
  // No text is sent for an automatic PIN change, so a member the email did not
  // reach would find out at the door. The owner is told instead, once, and can
  // pass the new PIN on from the member's card.
  if (mail !== 'sent') {
    const why = mail === 'no email' ? 'has no email address on file' : 'could not be emailed (' + mail + ')';
    try {
      await Promise.race([require('./owneralert').alert('member-pin:' + m.id,
        `${m.name}'s member PIN was changed because the door system already used the old one, and ${m.name} ${why}. Open Members, find ${m.name} and give them the new PIN before their next visit.`),
        new Promise(r => setTimeout(r, 10000))]);
    } catch {}
  }
}

async function reconcileOnce(memberId, opts = {}) {
  const cfg = getConfig();
  const on = memberAccessOn(cfg);
  if (!consoleReachable()) return { skipped: 'UniFi Access is not configured on this unit' };
  const ua = require('./unifiaccess');
  let m = D().prepare('SELECT * FROM members WHERE id=?').get(memberId);
  if (!m) return { skipped: 'no such member' };
  if (!on && !m.unifi_user_id) {
    // member access is off and this member was never put on the console: nothing to hold
    D().prepare(`UPDATE members SET unifi_dirty=0, unifi_attempts=0, unifi_next_try='', unifi_error='' WHERE id=?`).run(m.id);
    return { skipped: 'member door access is not on' };
  }
  const now = opts.now || Date.now();
  const active = m.status === 'active';
  const said = [];
  let repicked = false, reports = '', pinError = null;
  let uid = m.unifi_user_id || '';
  try {
    // 1. THE USER. Made the first time the member is active with member access on.
    if (!uid) {
      if (!active) {
        D().prepare(`UPDATE members SET unifi_dirty=0, unifi_attempts=0, unifi_next_try='', unifi_error='' WHERE id=?`).run(m.id);
        return { ok: true, note: 'never on the console' };
      }
      uid = await ua.consoleCreateUser(m);
      D().prepare(`UPDATE members SET unifi_user_id=?, unifi_status='ACTIVE', unifi_pin_set='', unifi_granted='[]' WHERE id=?`).run(uid, m.id);
      await dbm.flushed();   // on disk before anything else is done with it: a crash here must not leave a second user next time
      said.push('user created');
      m = D().prepare('SELECT * FROM members WHERE id=?').get(m.id);
    }
    // 2. THE PIN - only on an active member with member access on. A console that already holds
    //    it answers "taken": pick another (ruling 1), and tell the member if they had seen it.
    if (on && active && m.pin && String(m.unifi_pin_set || '') !== String(m.pin)) {
      const refused = [];
      for (;;) {
        const r = await ua.consoleSetPin(uid, m.pin);
        if (r === 'set') { D().prepare(`UPDATE members SET unifi_pin_set=? WHERE id=?`).run(String(m.pin), m.id); said.push('PIN set'); break; }
        // a PIN the console will not take is retried - but it never stops the status and the doors
        // below (the build review: it used to, so a member's booking doors were never taken off)
        if (r === 'length') {
          log('UNIFI_PIN_LENGTH_MISMATCH', `the console refused ${m.name}'s ${String(m.pin).length}-digit PIN - PIN Length here (Settings > Devices > Door Access) and the console's own PIN setting must both be 6`);
          pinError = new Error(`the console refused ${m.name}'s ${String(m.pin).length}-digit PIN - PIN Length here and the console's PIN setting must match (6)`);
          break;
        }
        refused.push(String(m.pin));
        if (refused.length > 5) { pinError = new Error(`the console refused ${refused.length} PINs for ${m.name} as already in use`); break; }
        const fresh = require('./memberpin').generate(refused);
        const old = m.pin;
        D().prepare(`UPDATE members SET pin=?, updated_at=datetime('now') WHERE id=?`).run(fresh, m.id);
        await dbm.flushed();
        m.pin = fresh; repicked = true;
        const shown = shownAlready(opts);
        log('MEMBER_PIN_REPICKED', `${m.name}: the door console already held ${maskPin(old)} - new member PIN ${maskPin(fresh)}` + (shown ? ', member email attempted' : ' (before the member saw the old one)'));
        if (shown) await tellNewPin(m, fresh);
      }
    }
    // 3. THE STATUS - a lapsed or cancelled member is DEACTIVATED, never deleted (ruling 3).
    const want = active && on ? 'ACTIVE' : 'DEACTIVATED';
    if (String(m.unifi_status || '') !== want) {
      await ua.consoleSetStatus(uid, m, want === 'ACTIVE');
      D().prepare(`UPDATE members SET unifi_status=? WHERE id=?`).run(want, m.id);
      said.push(want === 'ACTIVE' ? 'active' : 'deactivated');
    }
    // 4. THE DOORS - exactly what the member should hold now, from this unit's record.
    const desired = await desiredPolicies(m, now, opts);
    const recorded = parseList(m.unifi_granted);
    let reported = null;
    try { reported = await ua.readUserPolicies(uid); reports = reported === null ? 'no' : 'yes'; }
    catch (e) { if (TRANSPORT.test(String(e.message)) || NOT_FOUND.test(String(e.message))) throw e; reported = null; reports = 'no (' + String(e.message).slice(0, 60) + ')'; }
    const ours = new Set([...ua.managedPolicyIds(), ...(recorded || []), ...desired]);
    const target = reported ? uniq(reported.filter(id => !ours.has(id)).concat(desired)) : desired;
    const need = reported ? !same(reported, target) : !(recorded && same(recorded, desired));
    if (need) {
      // what we are about to GIVE goes on the record first: a crash after the write must not
      // leave access on the console that nothing here knows to take back
      D().prepare(`UPDATE members SET unifi_granted=? WHERE id=?`).run(JSON.stringify(uniq((recorded || []).concat(desired))), m.id);
      await dbm.flushed();
      await ua.consolePutPolicies(uid, target);
      said.push(desired.length ? `doors on (${desired.length} polic${desired.length === 1 ? 'y' : 'ies'})` : 'doors off');
    }
    if (pinError) throw pinError;
    // A BOOKING'S DOORS COME OFF WHEN ITS WINDOW CLOSES, WHOEVER TURNED THEM ON (Sep 25 2026, the
    // build review): only a booking's door revoke took them off, and a booking whose access was
    // turned on by this reconcile (the console came back after the door-code job gave up, or the
    // job fell back to a one-off code) has none - the member's PIN kept the doors until 05:00.
    // The member is simply looked at again the minute the earliest open window closes.
    const ends = openBookings(m, now, opts).map(b => require('./doorlock').codeWindow(b).endDt.getTime()).filter(Number.isFinite);
    const revisit = ends.length && desired.length ? new Date(Math.min(...ends) + 30000).toISOString().slice(0, 19).replace('T', ' ') : '';
    // written only when something changed (the build review: the nightly check wrote and synced the
    // whole database to the card once per member, every night, with nothing to say)
    const cur = D().prepare(`SELECT COALESCE(unifi_granted,'') AS g, COALESCE(unifi_dirty,0) AS d, COALESCE(unifi_attempts,0) AS a, COALESCE(unifi_next_try,'') AS n, COALESCE(unifi_error,'') AS e FROM members WHERE id=?`).get(m.id) || {};
    if (cur.g !== JSON.stringify(desired) || Number(cur.d) !== (revisit ? 1 : 0) || Number(cur.a) !== 0 || cur.n !== revisit || cur.e !== '') {
      D().prepare(`UPDATE members SET unifi_granted=?, unifi_dirty=?, unifi_attempts=0, unifi_next_try=?, unifi_error='' WHERE id=?`).run(JSON.stringify(desired), revisit ? 1 : 0, revisit, m.id);
      await dbm.flushed();
    }
    // the owner's record of what was done is on the card before the answer goes back (a battery on the
    // Pi read the log a moment before the async save landed; a crash there would lose the line too)
    if (said.length) { log('UNIFI_MEMBER_SYNC', `${m.name} -> user ${uid} | ${said.join(', ')} | the console reports a user's access: ${reports || 'not asked'}`); try { await dbm.flushed(); } catch {} }
    return { ok: true, userId: uid, pin: String(m.pin || ''), policies: desired, changed: said.length > 0, repicked, reports };
  } catch (e) {
    // A CONSOLE USER THAT IS GONE IS MADE AGAIN (Sep 25 2026, the build review - the old sync did
    // this and the rewrite lost it): a user deleted in UniFi Access, or a console reset, left the
    // member falling back to one-off codes for every booking with no way to repair it. Only the
    // user's OWN read saying not-found counts - never a timeout, never another object's 404.
    if (uid && !opts._recreated && NOT_FOUND.test(String(e && e.message)) && await userGone(ua, uid)) {
      log('UNIFI_MEMBER_RECREATE', `${m.name}: console user ${uid} is gone` + (active && on ? ', creating a new one' : ' - nothing to hold for an inactive member'));
      D().prepare(`UPDATE members SET unifi_user_id='', unifi_pin_set='', unifi_status='', unifi_granted='[]' WHERE id=?`).run(m.id);
      await dbm.flushed();
      return reconcileOnce(memberId, Object.assign({}, opts, { _recreated: true }));
    }
    const attempts = (Number(m.unifi_attempts) || 0) + 1;
    const wait = BACKOFF_MINS[Math.min(attempts - 1, BACKOFF_MINS.length - 1)];
    try {
      D().prepare(`UPDATE members SET unifi_dirty=1, unifi_attempts=?, unifi_next_try=datetime('now', ?), unifi_error=? WHERE id=?`)
        .run(attempts, `+${wait} minutes`, String(e.message).slice(0, 300), m.id);
      await dbm.flushed();
    } catch {}
    if (attempts === 1 || attempts % 6 === 0) { log('UNIFI_MEMBER_SYNC_ERROR', `${m.name}: ${String(e.message).slice(0, 200)} - the unit will keep trying (attempt ${attempts})`); try { await dbm.flushed(); } catch {} }
    return { ok: false, error: String(e.message), repicked, userId: m.unifi_user_id || '' };
  }
}

// One reconcile per member at a time: a signup's own sync and the tick's retry must never
// interleave their writes to the same console user.
const running = new Map();
function reconcile(memberId, opts = {}) {
  const prev = running.get(memberId) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => reconcileOnce(memberId, opts));
  running.set(memberId, next);
  next.finally(() => { if (running.get(memberId) === next) running.delete(memberId); }).catch(() => {});
  return next;
}

/** Something about this member changed: mark it and try now, in the background. */
function touch(memberId) {
  try { D().prepare(`UPDATE members SET unifi_dirty=1, unifi_next_try='' WHERE id=?`).run(memberId); } catch {}
  if (!consoleReachable()) return;
  setImmediate(() => { reconcile(memberId, { shown: true }).catch(() => {}); });
}
/** A family's primary changed status - every code on that membership follows. */
function touchFamily(parentId) {
  let ids = [];
  try { ids = D().prepare(`SELECT id FROM members WHERE parent_member_id=?`).all(parentId).map(r => r.id); } catch {}
  for (const id of ids) touch(id);
}

/** SIGNUP AND PIN CHANGES: the PIN is checked on the console BEFORE the member sees it
 *  (maintainer's design). Waits up to `timeoutMs` for the console; a PIN it refuses in that time is
 *  re-picked before anyone saw it. A console that does not answer in time does not hold the
 *  signup up (ruling 1): the answer carries the PIN as it stands and the reconcile goes on -
 *  a refusal after that is re-picked and texted. */
async function syncNow(memberId, timeoutMs = 10000) {
  try { D().prepare(`UPDATE members SET unifi_dirty=1, unifi_next_try='' WHERE id=?`).run(memberId); } catch {}
  if (!memberAccessOn() || !consoleReachable()) return { skipped: true, pin: (D().prepare('SELECT pin FROM members WHERE id=?').get(memberId) || {}).pin };
  const flag = { shown: false };
  let timer;
  const r = await Promise.race([
    reconcile(memberId, { shownFlag: flag }),
    new Promise(res => { timer = setTimeout(() => res({ pending: true }), timeoutMs); })
  ]);
  clearTimeout(timer);
  // slow or refusing, the console did not confirm this PIN before it is shown: it is checked
  // when the console is back, and a refusal then is texted (ruling 1)
  const pending = !!(r && (r.pending || r.ok === false));
  if (pending) flag.shown = true;
  // a console that ANSWERED and refused is not "not answering" (the build review): the owner is told
  // what it said - a PIN length the console will not take is fixed on the two settings, not the network
  const refused = r && r.ok === false && r.error && !TRANSPORT.test(String(r.error)) ? String(r.error).slice(0, 160) : '';
  const row = D().prepare('SELECT pin FROM members WHERE id=?').get(memberId) || {};
  return Object.assign({}, r, { pin: row.pin, pending, refused });
}

/** The scheduler's tick: every member whose change the console has not taken yet. One pass at a
 *  time: a tick that starts while the last pass still waits on a silent console joins it. */
let dueRun = null;
function reconcileDue(limit = 10) {
  if (dueRun) return dueRun;
  dueRun = reconcileDueOnce(limit).finally(() => { dueRun = null; });
  return dueRun;
}
async function reconcileDueOnce(limit) {
  if (!consoleReachable()) return { skipped: true };
  let rows = [];
  try { rows = D().prepare(`SELECT id FROM members WHERE unifi_dirty=1 AND (unifi_next_try='' OR unifi_next_try IS NULL OR unifi_next_try <= datetime('now')) ORDER BY unifi_next_try LIMIT ?`).all(limit); } catch { return { error: 'no member columns' }; }
  const out = { tried: rows.length, ok: 0, failed: 0 };
  for (const r of rows) { const x = await reconcile(r.id, { shown: true }); if (x && x.ok) out.ok++; else if (x && x.ok === false) out.failed++; }
  return out;
}

/** Nightly and "Sync All Members Now": every member this unit has on the console, and every
 *  active member when member access is on - the check that takes back any access a crash left
 *  behind (our record holds what was given before it was given). */
async function reconcileAll() {
  if (!consoleReachable()) return { ok: 0, failed: [], skipped: 'UniFi Access is not configured' };
  const on = memberAccessOn();
  const rows = D().prepare(`SELECT id, name FROM members WHERE (unifi_user_id IS NOT NULL AND unifi_user_id <> '')${on ? " OR status='active'" : ''}`).all();
  const out = { ok: 0, failed: [] };
  for (const r of rows) {
    const x = await reconcile(r.id, { shown: true });
    if (x && x.ok) out.ok++; else if (x && x.ok === false) out.failed.push({ member: r.name, error: String(x.error).slice(0, 120) });
  }
  return out;
}

/** A member booking's door code (the scheduler's door_code job, at the owner's "before"
 *  minutes): the member's own PIN, their access on for this booking's window. Throws when it
 *  cannot - services/doorlock.js then falls back to a one-off code, never silently. */
async function accessOn(booking) {
  const member = D().prepare('SELECT * FROM members WHERE id=?').get(booking.member_id);
  if (!member) throw new Error('the booking\'s member record is gone');
  if (member.status !== 'active') throw new Error(`${member.name}'s membership is not active`);
  const r = await reconcile(member.id, { includeBookingId: booking.id, includeBooking: booking, shown: true });
  if (!r || !r.ok) throw new Error((r && (r.error || r.skipped)) || 'member access could not be turned on');
  if (!r.pin) throw new Error(`${member.name} has no member PIN`);
  const mine = await require('./unifiaccess').bookingPolicyIds(booking, member);
  if (!mine.length) throw new Error('no booking doors are selected in Settings (facility, bay or tier)');
  log('DOOR_CODE_CREATED', `Booking: ${booking.id} | member ${member.name} BOOST | policies +${mine.length} | ${r.repicked ? 'NEW member PIN (the console held the old one - member email attempted)' : 'PIN unchanged (member PIN)'}`);
  return { pin: r.pin, personId: 'unifiuser:' + r.userId + ':' + mine.join('+') };
}

/** A member booking's window closed or it was cancelled: take its doors off - and only its
 *  doors. Another booking of theirs whose window is still open keeps them (back to back). */
async function accessOff(ref, opts = {}) {
  const [uid, plist] = String(ref || '').split(':');
  if (!uid) return { ok: true, note: 'no member user in the reference' };
  const m = D().prepare('SELECT id FROM members WHERE unifi_user_id=?').get(uid);
  if (!m) return null;   // not a member row of ours: the caller detaches the policies named in the reference
  const r = await reconcile(m.id, { exceptBookingId: opts.forBookingId || opts.exceptBookingId, shown: true });
  if (r && r.ok) {
    log('DOOR_CODE_REVOKED', `member boost detached: user ${uid} -${(plist || '').split('+').filter(Boolean).length}` + (r.policies && r.policies.length ? ` (still holding ${r.policies.length} for another open booking or the tier's always-on doors)` : ''));
    return { ok: true };
  }
  return { ok: false, error: (r && (r.error || r.skipped)) || 'no answer' };
}

/** Rule 14: members put on the console by the old code carry no record of what was set. Their
 *  PIN was set by every old sync, so it is adopted as set (re-setting it could be refused by
 *  the console as "taken" - by the member's own user); the doors are decided by the next
 *  reconcile. Once, at boot. */
function adoptLegacy() {
  try {
    const WHERE = `unifi_user_id IS NOT NULL AND unifi_user_id <> '' AND (unifi_pin_set IS NULL OR unifi_pin_set = '') AND (unifi_status IS NULL OR unifi_status = '')`;
    const c = (D().prepare(`SELECT COUNT(*) AS n FROM members WHERE ${WHERE}`).get() || {}).n || 0;
    if (c) D().prepare(`UPDATE members SET unifi_pin_set=pin, unifi_dirty=1 WHERE ${WHERE}`).run();
    if (c) log('UNIFI_MEMBERS_ADOPTED', `${c} member(s) put on the console before this unit kept its own record of them - their PIN is taken as set; their doors are checked on the next pass`);
  } catch {}
}

/** Every member reconcile started so far has finished (a one-shot process waits on this). */
async function settle() { await new Promise(r => setImmediate(r)); await Promise.all([...running.values()].map(p => p.catch(() => {}))); }

module.exports = { settle, reconcile, touch, touchFamily, syncNow, reconcileDue, reconcileAll, accessOn, accessOff, adoptLegacy, openBookings, desiredPolicies, memberAccessOn, maskPin };
