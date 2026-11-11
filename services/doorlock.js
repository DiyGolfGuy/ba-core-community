// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/doorlock.js  —  door-access provider DISPATCHER
//
//  The booking system issues one time-limited PIN per booking and revokes it on
//  cancel/move/session-end. Historically this file WAS the RemoteLock client;
//  it is now a thin dispatcher so a facility chooses its provider in Settings:
//
//    cfg.doorAccess.provider = 'remotelock' (default) | 'unifi'
//
//  Interface every provider implements:
//    generateDoorCode(booking) -> { pin, personId }
//    revokeDoorCode(personId)  -> void (best-effort, logs its own errors)
//
//  PROVIDER-PREFIXED REFS (zero-migration design): the booking row's existing
//  remotelock_person_id column stores the provider reference. UniFi refs are
//  stored as 'unifi:<visitorId>'; bare ids are RemoteLock (all history predates
//  UniFi support). revokeDoorCode routes on the PREFIX, not on the currently
//  configured provider - so if a facility ever switches providers, bookings
//  issued under the old one still revoke through the system that created them.
// ═══════════════════════════════════════════════════════════════════════════════

const { getConfig } = require('./config');

// THREE PROVIDERS (feature/door-interface): 'ha' is a Z-Wave lock through the
// owner's own Home Assistant - no cloud, no fee, and the first one that can
// CONFIRM a code landed. Refs: bare = RemoteLock, unifi:/unifiuser: = UniFi,
// ha:<entity>#<slot> = Home Assistant.
// THE PACK CARRIES THESE THREE ONLY (maintainer, Oct 2 2026: "z wave now ... Don't need matter right now. Just
// z wave as its tested"). The wall keypad, the Matter lock and the unit's own Z-Wave stick stay on
// feature/door-interface, unshipped.
function provider() {
  const p = String(getConfig().doorAccess?.provider || 'remotelock').toLowerCase();
  return p === 'unifi' ? 'unifi' : p === 'ha' ? 'ha' : 'remotelock';
}

async function generateDoorCode(booking) {
  if (provider() === 'ha') return require('./hadoor').generateDoorCode(booking);
  if (provider() === 'unifi') {
    const ua = require('./unifiaccess');
    const cfg = getConfig();
    // MEMBER ACCESS (Sep 25 2026, services/memberaccess.js): the member's own PIN, their
    // console user's access on for this booking's window - written from the unit's own
    // record, so it no longer depends on the console reporting what the user holds.
    // WHEN IT CANNOT BE TURNED ON (maintainer's ruling 2): a one-off code for today, NEVER silently -
    // the owner's log, the health line, the owner told, and the member's text says it is a
    // one-time code (doorCodeNote). A console that does not answer at all is not this case:
    // the one-off code needs the console too, so the job fails and retries instead.
    if (booking.member_id && cfg.unifiAccess?.memberAccess?.enabled) {
      let why = '';
      try { return await require('./memberaccess').accessOn(booking); }
      catch (e) { why = String(e && e.message || e); }
      const { pin, visitorId } = await ua.createBookingVisitor(booking);
      let name = '';
      try { name = (require('./db').db.prepare('SELECT name FROM members WHERE id=?').get(booking.member_id) || {}).name || ''; } catch {}
      try { require('./db').adminLog('DOOR_CODE_FALLBACK', `Booking: ${booking.id} | member ${name} | their member access could not be turned on (${why.slice(0, 160)}) - a ONE-OFF code was issued for this session instead (UniFi visitor ${visitorId})`); } catch {}
      // told, and waited for - but never longer than ten seconds: the member's code comes first
      await Promise.race([
        // ONE ALERT PER FAULT, NOT PER BOOKING (Sep 25 2026, the build review): a console-side fault
        // falls back for every member booking until it is fixed - the owner is texted once every six
        // hours about it; each booking is still in the log (DOOR_CODE_FALLBACK) and on Door codes
        require('./owneralert').alert('member-fallback',
          `${name || 'A member'}'s door access could not be turned on for their ${booking.date} ${booking.start_time} session (${why.slice(0, 120)}), so they were sent a one-time code instead - and other member bookings will be too until this is fixed. Settings > Devices > Door Access > Test Connection, and check the member in UniFi Access > Users.`).catch(() => {}),
        new Promise(r => setTimeout(r, 10000))
      ]);
      return { pin, personId: 'unifi:' + visitorId, oneOff: true, why };
    }
    const { pin, visitorId } = await ua.createBookingVisitor(booking);
    return { pin, personId: 'unifi:' + visitorId };
  }
  return require('./remotelock').generateDoorCode(booking);
}

// Returns { ok: true } | { ok: false, error }. It does NOT throw - the providers
// log their own errors - so a caller that clears the booking's credential pointer
// MUST read .ok first (A-wave 11b: the sweep did not, and erased live codes).
/** Is a NAMED provider reachable - not "the one selected in Settings"? */
function providerConfigured(p) {
  const cfg = getConfig();
  if (p === 'ha') return require('./hadoor').configured();
  if (p === 'unifi') { const u = cfg.unifiAccess || {}; return !!(u.host && u.apiToken && !String(u.apiToken).startsWith('PASTE')); }
  const r = cfg.remotelock || {}; return !!(r.clientId && !String(r.clientId).startsWith('PASTE'));
}
/** Which provider ISSUED this reference. Refs are prefixed; bare ids predate
 *  UniFi support and are RemoteLock's. */
function providerFor(ref) {
  const s = String(ref || '');
  if (s.startsWith('ha:')) return 'ha';
  return (s.startsWith('unifi:') || s.startsWith('unifiuser:')) ? 'unifi' : 'remotelock';
}

// Is there a lock to talk to at all? A facility with none cannot be holding a
// credential anywhere, so a leftover reference on a row is just a leftover - it
// must clear, or the health line would sit red for ever on a unit with no door.
function lockConfigured() {
  return providerConfigured(String(getConfig().doorAccess?.provider || 'remotelock').toLowerCase());
}

/**
 * A CANCEL THAT COULD NOT TAKE THE CODE BACK IS SAID, AND RETRIED (Sep 25 2026, the
 * pilot facility handoff's section 5 - a failure recorded, never silent). The customer's and
 * the owner's cancel paths awaited the revoke and threw its answer away: a refusal
 * was logged by the provider without the booking, nothing queued a retry until the
 * cancelled session's END (rule 28's sweep waits for the end), and the health line
 * stayed green for two hours after that - while the customer who had just cancelled
 * could still open the door. This reads the answer; on a refusal it names the
 * booking and the reason in the owner's log and queues the revoke NOW, which rule
 * 28's sweep takes on the next tick and never gives up on (it reads a pending
 * door_revoke as "take this code back now, whatever the session's end says").
 */
async function revokeOnCancel(booking, who) {
  if (!booking || !booking.remotelock_person_id) return { ok: true, note: 'no code to revoke' };
  let res;
  try { res = await revokeDoorCode(booking.remotelock_person_id, { forBookingId: booking.id }); }
  catch (e) { res = { ok: false, error: e && e.message }; }
  if (res && res.ok === true) {
    // the lock took it back: the row lets go of it, as the staff cancel's does (Oct 3 2026) - the owner's and the
    // customer's cancels kept the reference, so the session's end removed the code again and the Log said
    // DOOR_CODE_REVOKED twice. A member's PIN kept for their next booking keeps its reference (res.kept).
    try { require('./db').db.prepare(`UPDATE bookings SET door_code=NULL, remotelock_person_id=CASE WHEN ?=1 THEN remotelock_person_id ELSE NULL END WHERE id=?`).run(res.kept ? 1 : 0, booking.id); } catch {}
    return res;
  }
  const why = (res && res.error) || 'no answer from the lock';
  try { require('./db').adminLog('DOOR_REVOKE_ERROR', `${booking.id}: cancelled by ${who || 'someone'}, but the lock did not take the code back (${why}) - the code is STILL LIVE and the unit will keep trying`); } catch {}
  // dueNow, not ensureJob: the tick has usually scheduled this revoke for the session's END already
  try { require('./automation').dueNow(booking.id, 'door_revoke'); } catch {}
  return Object.assign({ ok: false }, res, { error: why });
}

async function revokeDoorCode(personId, opts = {}) {
  if (!personId) return { ok: true, note: 'nothing to revoke' };
  const ref = String(personId);
  // ASK ABOUT THE SYSTEM THAT ISSUED IT, NOT THE ONE SELECTED TODAY (Sep 16 2026).
  // This used to call lockConfigured(), which reads the CURRENTLY CONFIGURED
  // provider - while the revoke itself routes on the ref's PREFIX. So the moment
  // an owner switched provider or cleared the UniFi host, every live 'unifi:'
  // credential answered {ok:true}: DOOR_CODE_REVOKED went into the log, the
  // pointer was erased, and the PINs carried on working on a console nobody was
  // talking to any more. Rule 29 in the one place it matters most, and it also
  // blinded rule 28's sweep, which reads the same pointer.
  const issuer = providerFor(ref);
  const prefixed = ref.startsWith('unifi:') || ref.startsWith('unifiuser:') || ref.startsWith('ha:');
  const issuerName = issuer === 'unifi' ? 'UniFi Access' : issuer === 'ha' ? 'Home Assistant' : 'RemoteLock';
  if (!providerConfigured(issuer)) {
    if (prefixed) {
      // THREE STATES (rule 31): this is not "not applicable" - a PREFIXED ref is
      // one we know we created on a console that was configured at the time, so
      // there IS a live credential and we can no longer reach the system holding
      // it. Refusing keeps the pointer, so the sweep keeps trying and the
      // doorcodes health signal keeps saying so until an owner deals with it.
      return { ok: false, unreachable: true, issuer,
        error: `this code was issued through ${issuerName}, which is no longer configured on this unit - it cannot be revoked from here and may still open the door` };
    }
    // A BARE ref is pre-prefix legacy data. On a unit with no RemoteLock
    // configured we genuinely cannot tell a credential we issued from a pointer
    // that arrived in a restored backup or a fixture, and holding every one of
    // them would sit the health line red for ever on a facility that has no door
    // at all - which is the case this branch was written for in A-wave 4. Clear
    // it, but say so once rather than silently: if it WAS real, the owner is the
    // only one who can do anything about it.
    try { require('./db').adminLog('DOOR_CODE_UNVERIFIED', `${ref}: no door provider is configured, so this older code could not be checked or revoked - if this facility used to have a lock, remove the code at the lock itself`); } catch {}
    return { ok: true, note: 'no door lock configured and this code predates provider tagging - cleared, and logged as unverified' };
  }
  if (ref.startsWith('ha:')) return require('./hadoor').revokeDoorCode(ref, { forBookingId: opts.forBookingId });
  if (ref.startsWith('unifiuser:')) {
    // opts.forBookingId: the booking this revoke is FOR. A member boost is shared
    // across that member's live sessions, so unboost must not count the very
    // booking being cancelled as a reason to keep the boost attached.
    return require('./unifiaccess').unboostMember(ref.slice(10), { exceptBookingId: opts.forBookingId });
  }
  if (ref.startsWith('unifi:')) {
    return require('./unifiaccess').revokeVisitor(ref.slice(6));
  }
  return require('./remotelock').revokeDoorCode(ref);
}

/** Can this credential's window be moved at all, from here?
 *  Only UniFi visitors can: a UniFi visitor IS a window, and PUT /visitors/:id
 *  sets it. A member BOOST is bounded by the booking, not by anything on the
 *  console, so there is nothing to move. RemoteLock's access window is set per
 *  guest at issue time and we have no route to change it, and re-issuing would
 *  hand the customer a DIFFERENT PIN mid-session - worse than the problem.
 *  Callers must ask BEFORE queueing work, or a facility on the default provider
 *  collects a failed job on every extension. (Sep 16 2026.) */
function canMoveWindow(ref) {
  return windowMoveState(ref) === 'move';
}

/** THREE STATES, NOT TWO (Sep 17 2026, rule 31 at the door).
 *  `canMoveWindow` is a yes/no, and the extend path used its NO to tell the
 *  owner "the code still expires at the original end" - which is true for a
 *  RemoteLock guest and FALSE for a UniFi member boost, where the door access
 *  is bounded by the booking and the revoke job has already been moved onto the
 *  new end. The owner was reading a warning about a code that was working
 *  perfectly, and being sent to the console to fix nothing.
 *    'move'            - a UniFi visitor: the credential IS a window, move it
 *    'follows-booking' - a UniFi member boost: nothing to move, nothing wrong
 *    'cannot'          - RemoteLock: the window was set at issue time and
 *                        re-issuing would hand the customer a different PIN
 *                        mid-session, which is worse than the problem
 *    'none'            - this booking holds no credential at all
 */
function windowMoveState(ref) {
  const r = String(ref || '');
  if (!r) return 'none';
  if (r.startsWith('ha:')) return 'follows-booking';    // a slot has no window: revoke follows the booking's end
  if (r.startsWith('unifi:')) return 'move';
  if (r.startsWith('unifiuser:')) return 'follows-booking';
  return 'cannot';
}

/** Move a live credential's window after a booking's end time changed.
 *  Three states like every other device call (rule 31): {ok:true} moved,
 *  {ok:false,error} the door refused, {skipped:true} nothing to move. */
async function moveDoorCodeWindow(booking) {
  const ref = String(booking && booking.remotelock_person_id || '');
  if (!ref) return { skipped: true, reason: 'this booking has no door code' };
  const issuer = providerFor(ref);
  if (!providerConfigured(issuer)) {
    return { ok: false, unreachable: true, issuer,
      error: `this code was issued through ${issuer === 'unifi' ? 'UniFi Access' : issuer === 'ha' ? 'Home Assistant' : 'RemoteLock'}, which is no longer configured on this unit - its window could not be moved` };
  }
  if (ref.startsWith('ha:')) return { skipped: true, reason: 'a Home Assistant lock code has no window of its own - the revoke follows the booking' };
  if (ref.startsWith('unifiuser:')) {
    // A member boost is bounded by the BOOKING, not by a window on the console -
    // the policies come off when the session's revoke job runs, and that job was
    // already rescheduled onto the new end. Nothing to move. (Rule 31: this is
    // not applicable, not a failure.)
    return { skipped: true, reason: 'a member boost follows the booking, not a window on the console' };
  }
  if (ref.startsWith('unifi:')) {
    return require('./unifiaccess').moveVisitorWindow(ref.slice(6), booking);
  }
  const rl = require('./remotelock');
  if (typeof rl.moveDoorCodeWindow === 'function') return rl.moveDoorCodeWindow(ref, booking);
  // NOT APPLICABLE, NOT FAILED (rule 31). RemoteLock's access window is set per
  // guest at issue time with no route to change it. Returning {ok:false} here
  // made every extension on the DEFAULT provider a job that retried six times
  // and then went red - a real failure signal for a capability that simply does
  // not exist. The owner is told once, by the caller, in the log.
  return { skipped: true, reason: 'a RemoteLock code\'s window cannot be moved from here - it still expires at the original end' };
}

// ── THE PIN LENGTH IS ONE NUMBER (maintainer's rule 2, asked once; Sep 16 2026) ──────
// It was two, and they contradicted each other. Member PINs were hardcoded six
// digits (routes/members.js generatePin); visitor PINs followed
// cfg.unifiAccess.pinLength, whose shipped default was FOUR. A UniFi console
// enforces ONE length for everything on it, so on a console set to 4 - which our
// own default implies - syncMember threw for every member alive, and on a console
// set to 6 every booking visitor was refused instead. The only configuration that
// worked was Variable Length, and we shipped the default that guaranteed failure.
// Proven on the bench: test-unifi-standin B4, and the setup for B8.
//
// It lives HERE, in the dispatcher, not under unifiAccess: both providers issue
// PINs, and a member carries one on facilities that have no UniFi console at all.
// Rule 14 - the old key is never dropped and is still read, so a unit that has
// been running for months keeps the number its owner chose.
const PIN_LENGTHS = [4, 6, 8];   // what a UniFi console's setting offers; there is no 5 or 7
const MEMBER_PIN_DEFAULT = 6;   // what a member PIN has always been
function doorPinLength() {
  const cfg = getConfig();
  const p = String(cfg.doorAccess?.provider || 'remotelock').toLowerCase();
  // ONLY A UNIFI CONSOLE IMPOSES A LENGTH. RemoteLock mints its own codes and a
  // facility with no lock has no constraint at all, so their member PINs stay at
  // six - the length they have always been and the length their members have
  // memorised. Without this guard the fleet-wide effect was the opposite of the
  // fix: every unit carries unifiAccess.pinLength 4 from the old default, the
  // PIN Length control lives inside a panel that is HIDDEN unless the provider
  // is UniFi, and the save path wrote it anyway - so the first Settings save on
  // any RemoteLock or no-lock facility would have written 4 and dropped every
  // newly issued member PIN from six digits to four. (Caught by the design
  // review's critic, Sep 16 2026, before it landed.)
  if (p !== 'unifi') return MEMBER_PIN_DEFAULT;
  const want = Number(cfg.doorAccess?.pinLength ?? cfg.unifiAccess?.pinLength ?? MEMBER_PIN_DEFAULT);
  return PIN_LENGTHS.includes(want) ? want : MEMBER_PIN_DEFAULT;
}

/** THE END OF A BOOKING, TOLERANTLY (Sep 16 2026).
 *  A 24-hour club's booking legitimately ends at "25:30" - half past one, the
 *  next morning - and `new Date("2026-09-20T25:30:00")` is Invalid Date. Six
 *  places in the tree parsed it naively, and two of them decide whether a
 *  MEMBER'S door access is still needed: an invalid date read as "not running",
 *  so a roster sync stripped a live member's boost while they were inside. This
 *  is the scheduler's own bookingEndDate, moved somewhere every door path can
 *  reach it. Returns null when there is nothing parseable - callers decide what
 *  that means, and none of them may treat it as "expired".
 *
 *  THE WALL CLOCK, NEVER MIDNIGHT PLUS MINUTES (Sep 24 2026, found by the aged year
 *  in the first deep sweep). This used to take local midnight and add the end time
 *  as minutes - but the day the clocks change is 23 or 25 hours long, so every end
 *  after the change came out an HOUR wrong: on the spring night the ending warning,
 *  the PC shutdown, the plugs and TV off and the door window all ran an hour after
 *  the session, and the warning, due after its booking had completed, sat unclaimed
 *  and held the health line red for the rest of the year; on the autumn day
 *  (Nov 1 2026) every bay would have been shut down an hour before the customer's
 *  session ended. The local-time constructor does the arithmetic on the wall clock -
 *  "25:30" is still half past one the next morning - and applies the facility's
 *  own daylight-saving rule to the result. ONE implementation: the scheduler's
 *  bookingEndDate calls this one. */
function bookingEndDate(b) {
  const day = String((b && (b.end_date || b.date)) || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const m = String((b && b.end_time) || '').match(/^(\d{1,2}):(\d{2})/);
  if (!day || !m) return null;
  const t = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(m[1]), Number(m[2]), 0, 0);
  return isFinite(t) ? t : null;
}

/**
 * THE OWNER'S LEAD AND LAG, RESOLVED IN ONE PLACE (Sep 17 2026). Three files
 * worked this out independently - here, `scheduler.revokeLagMs` and the
 * `doorcodes` health signal - and two of them disagreed. This one read the
 * legacy value as `Number(b.doorCodeBufferMins || 15)`, so a unit whose legacy
 * buffer is 0 or blank got 15 HERE and 0 in the scheduler: the code written to
 * the lock said one time and the sweep that takes it back enforced another,
 * which is the exact thing the scheduler's own comment says it exists to
 * prevent. `doorCodeBufferMins` is not a default any more but rule 14 means an
 * old unit still carries whatever it was set to, so the disagreement is a
 * shipped unit's, not a hypothetical. One function; everyone calls it.
 *
 * A value counts as SET only if it is a real number and not '', null or
 * undefined - a deliberate 0 is a number the owner chose, not a blank.
 */
function codeWindowMins() {
  const b = (getConfig() || {}).booking || {};
  const set = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
  const legacy = set(b.doorCodeBufferMins) ? Number(b.doorCodeBufferMins) : null;
  // the code is removed thirty minutes after the session by default (maintainer, Oct 3 2026); the owner sets either number
  return {
    lead: Math.max(0, set(b.doorCodeLeadMins) ? Number(b.doorCodeLeadMins) : (legacy ?? 15)),
    lag:  Math.max(0, set(b.doorCodeLagMins)  ? Number(b.doorCodeLagMins)  : (legacy ?? 30)),
  };
}

/**
 * The validity window for a booking's door code - ONE source of truth used by
 * every provider. Owner-settable lead/lag (maintainer, Aug 18): "how long before and
 * after a code should work", set manually in Settings. Falls back to the
 * legacy single doorCodeBufferMins, then 15.
 */
function codeWindow(booking) {
  const { lead, lag } = codeWindowMins();
  const startDt = new Date(`${booking.date}T${booking.start_time}:00`);
  const endDt   = bookingEndDate(booking) || new Date(`${booking.end_date || booking.date}T${booking.end_time}:00`);
  startDt.setMinutes(startDt.getMinutes() - Math.max(0, lead));
  endDt.setMinutes(endDt.getMinutes() + Math.max(0, lag));
  return { startDt, endDt, lead, lag };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  THE DOOR INTERFACE (feature/door-interface, Sep 21 2026)
//    create(booking)          -> { pin, personId }           generateDoorCode, unchanged
//    confirm(ref, booking)    -> { state, detail }           NEW
//    revoke(ref)              -> { ok } | { ok:false }       revokeDoorCode, unchanged
//    fallback(booking)        -> { pin, kind } | { skipped } NEW
//    capabilities(provider)                                  NEW
//  state: 'held'    the provider proved the lock holds the code
//         'pending' asked, not settled yet - the poll asks again
//         'unknown' this provider cannot ask (RemoteLock until its sync fields
//                   are verified; UniFi today) - behaves EXACTLY as before:
//                   the code is texted at the usual time, nothing is held back
//         'failed'  the lock refused, or is dead - send the fallback, tell the owner
//  Create and text used to be one act in one job. They are two now, with
//  confirm between them, and a code is never texted until confirm has answered.
// ═══════════════════════════════════════════════════════════════════════════════
const DOOR_TEXT_LEAD_MINS = 15;   // the default: the customer is texted this long before start (as always)
/** The owner's text timing, minutes before start; the old fixed 15 is the default. */
function textLeadMins(cfg = getConfig()) {
  const v = Number(cfg.doorAccess?.textLeadMins);
  return Number.isFinite(v) && v >= 0 ? v : DOOR_TEXT_LEAD_MINS;
}
const DOOR_CONFIRM_POLLS  = 5;    // the late-booking hold: confirm each minute, up to this many, then text

async function confirmDoorCode(ref, booking) {
  const r = String(ref || '');
  if (!r) return { state: 'failed', detail: 'no code reference' };
  const issuer = providerFor(r);
  if (!providerConfigured(issuer)) return { state: 'pending', detail: `${issuer} is not configured on this unit` };
  if (issuer === 'ha') return require('./hadoor').confirmDoorCode(r, booking);
  if (issuer === 'unifi') {
    const ua = require('./unifiaccess');
    if (typeof ua.confirmVisitor === 'function') return ua.confirmVisitor(r, booking);
    return { state: 'unknown', detail: 'UniFi Access does not report reader sync from here - the code is texted as before' };
  }
  const rl = require('./remotelock');
  if (typeof rl.confirmDoorCode === 'function') return rl.confirmDoorCode(r, booking);
  return { state: 'unknown', detail: 'RemoteLock sync is not read from here yet - the code is texted as before' };
}

/** A code the customer can use if the real one never landed. Only a provider
 *  that owns a backup mechanism answers with a pin; the rest are not applicable. */
async function fallbackDoorCode(booking) {
  const p = provider();
  if (p === 'ha') return require('./hadoor').fallbackDoorCode(booking);
  return { skipped: true, reason: `${p === 'unifi' ? 'UniFi Access' : 'RemoteLock'} has no standing backup code from here` };
}

/** Does THIS facility run the confirm-before-text flow? A provider that can
 *  confirm does; a RemoteLock or UniFi owner only if they turned it on. */
function confirmFlow(cfg = getConfig()) {
  const p = String(cfg.doorAccess?.provider || 'remotelock').toLowerCase();
  if (capabilities(p === 'unifi' ? 'unifi' : p === 'ha' ? 'ha' : 'remotelock').confirms) return true;
  return cfg.doorAccess?.confirmBeforeText === true;
}

function capabilities(p = provider()) {
  if (p === 'ha')    return { confirms: true,  movesWindow: false, reportsUse: true,  fallback: true,  name: 'Home Assistant' };
  if (p === 'unifi') return { confirms: false, movesWindow: true,  reportsUse: false, fallback: false, name: 'UniFi Access' };
  return                    { confirms: false, movesWindow: false, reportsUse: false, fallback: false, name: 'RemoteLock' };
}

/** A booking made INSIDE its own code lead is a late booking: its code is
 *  created now and texted within DOOR_CONFIRM_POLLS minutes. The confirmation
 *  the customer sees says so, instead of "15 minutes before". */
// BA'S RULING (Oct 3 2026, night): "You can create the door code an hour early. No matter what access it is, whether it's
// remote lock or the home assistant one. You just text it to them fifteen minutes prior and then you delete it thirty
// minutes after the booking. Unify, that's a whole separate thing."
// So: the customer is texted at the owner's text time (15 by default) on every provider under the create-confirm-text
// flow; the old fixed fifteen when the owner has switched that flow off. The code always exists by then (createLeadMins).
function windowedProvider(cfg = getConfig()) { return String(cfg.doorAccess?.provider || 'remotelock').toLowerCase() !== 'ha'; }
function effectiveTextLeadMins(cfg = getConfig()) {
  if (!confirmFlow(cfg)) return DOOR_TEXT_LEAD_MINS;
  // UniFi is its own thing (maintainer): it texts as the field has it - at the lead or the text time, whichever is later, so a
  // visitor whose window opens at the lead is never texted before it works (the review, Oct 4 2026)
  if (String(cfg.doorAccess?.provider || 'remotelock').toLowerCase() === 'unifi') return Math.min(codeWindowMins().lead, textLeadMins(cfg));
  return textLeadMins(cfg);
}
/** When the create-confirm-text flow makes the code, in minutes before the start. RemoteLock and Home Assistant: an hour
 *  before (maintainer's ruling above; RemoteLock's cloud also needs the time - pilot facility's Sep 18 lockout, codes made at 8:15:01 for
 *  8:30 and two of four never synced). A RemoteLock code still opens the door only from its "works BEFORE" lead (its own
 *  window); a Home Assistant lock's code works from when it is set. UniFi is its own thing (its console is on the
 *  premises and takes a code at once): made at the lead or the text time, whichever is earlier in the day. A longer
 *  owner lead or text time than the hour moves the creation earlier still. */
const CODE_AHEAD_MINS = 60;
const REMOTELOCK_SYNC_AHEAD_MINS = CODE_AHEAD_MINS;   // the name the drift lock and older notes use
function createLeadMins(cfg = getConfig()) {
  const lead = codeWindowMins().lead;
  const p = String(cfg.doorAccess?.provider || 'remotelock').toLowerCase();
  return Math.max(lead, textLeadMins(cfg), p === 'unifi' ? 0 : CODE_AHEAD_MINS);
}

// A booking made at or inside its own text time: the code is created now and
// texted the minute the lock confirms it (within DOOR_CONFIRM_POLLS minutes).
// One made between the create lead and the text time gets its code created
// early but still texted at the text time - that is not "soon".
function codeArrivesSoon(booking, cfg = getConfig(), now = new Date()) {
  try {
    if (cfg.booking?.staffedAccess) return false;
    if (!lockConfigured()) return false;
    const start = new Date(`${booking.date}T${booking.start_time}:00`);
    if (!isFinite(start)) return false;
    return now.getTime() >= start.getTime() - effectiveTextLeadMins(cfg) * 60000;
  } catch { return false; }
}

// The words every customer surface uses for WHEN the code arrives - the
// [Code Timing] placeholder in the owner's templates and the built-in bodies.
// 'sms' keeps it short (every character bills); 'email' spells it out.
function codeTimingPhrase(booking, cfg = getConfig(), now = new Date(), style = 'sms') {
  if (cfg.booking?.staffedAccess) return '';
  const n = effectiveTextLeadMins(cfg);
  if (codeArrivesSoon(booking, cfg, now)) return style === 'email' ? `within ${DOOR_CONFIRM_POLLS} minutes` : `within ${DOOR_CONFIRM_POLLS} min`;
  if (n <= 0) return style === 'email' ? 'when your session starts' : 'at your start time';   // never "0 min before"
  return style === 'email' ? `${n} minutes before start` : `${n} min before`;
}

/** WHAT THE BOOKING PAGE SAYS ABOUT THE DOOR CODE (Oct 3 2026): it said "about 15 minutes before your session"
 *  whatever the owner set, while the texts and emails said the owner's minutes. '' when this facility sends no
 *  code - staffed, or no lock configured (a facility may have none, rule 31) - so the page promises nothing. */
function codeTimingForPage(cfg = getConfig()) {
  if (cfg.booking?.staffedAccess || !lockConfigured()) return '';
  const n = effectiveTextLeadMins(cfg);
  return n <= 0 ? 'when your session starts' : `about ${n} minutes before your session`;
}

/** WHAT THE DOOR-CODE TEXT AND EMAIL SAY BESIDE THE CODE (Sep 25 2026, maintainer). On a UniFi reader
 *  the code is typed and then Enter is pressed - in words, not assumed. A member's code is
 *  their own PIN; a member who got a one-off code is told plainly it is for today only
 *  (ruling 2: never silently). Nothing for RemoteLock: its keypads differ by model. */
function doorCodeNote(booking, ref) {
  const r = String(ref || '');
  // A Z-WAVE LOCK THROUGH HOME ASSISTANT (Sep 26 2026): the key after the digits is the owner's
  // setting, in words (the Yale: "the check mark"); a member's code is their own PIN when the owner
  // has member PINs on for this lock
  if (r.startsWith('ha:')) {
    const hl = require('./hadoor').lockCfg();
    const lines = [];
    // the code as the row holds it NOW: the scheduler hands over the booking it read at the start of the
    // tick, before the code existed (Sep 26 2026, the bench: a member's text lost "your member PIN")
    let code = String((booking && booking.door_code) || '');
    if (!code && booking && booking.id) { try { const row = require('./db').db.prepare('SELECT door_code FROM bookings WHERE id=?').get(booking.id); code = String((row && row.door_code) || ''); } catch {} }
    if (booking && booking.member_id && hl.memberPins && code && (() => { try { const m = require('./db').db.prepare('SELECT pin FROM members WHERE id=?').get(booking.member_id); return m && String(m.pin) === code; } catch { return false; } })()) lines.push('Your door code is your member PIN.');
    lines.push(`At the door keypad, type the code and then press ${hl.finishKey}.`);
    return lines.join(' ');
  }
  if (!(r.startsWith('unifi:') || r.startsWith('unifiuser:'))) return '';
  const lines = [];
  if (r.startsWith('unifiuser:')) lines.push('Your door code is your member PIN.');
  else if (booking && booking.member_id && (getConfig().unifiAccess?.memberAccess?.enabled)) lines.push('This is a ONE-TIME code for today\'s session only - your member PIN will not open the door for this booking.');
  lines.push('At the door keypad, type the code and then press Enter.');
  return lines.join(' ');
}

module.exports = { doorCodeNote, lockConfigured, providerConfigured, providerFor, generateDoorCode, revokeDoorCode, revokeOnCancel, moveDoorCodeWindow, provider, codeWindow, codeWindowMins, bookingEndDate, canMoveWindow, windowMoveState, doorPinLength, PIN_LENGTHS, createDoorCode: generateDoorCode, confirmDoorCode, confirmFlow, textLeadMins, effectiveTextLeadMins, createLeadMins, codeTimingPhrase, codeTimingForPage, fallbackDoorCode, capabilities, codeArrivesSoon, DOOR_TEXT_LEAD_MINS, DOOR_CONFIRM_POLLS };
