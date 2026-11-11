// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/automation.js — AUTOMATION MUST NEVER SILENTLY FAIL (maintainer, Aug 11).
//
// WHAT WAS WRONG BEFORE:
//   1. FIRED-FLAGS LIVED IN MEMORY (shellyFired = {}). A PM2 restart or a
//      power blip erased them - so a bay could power on twice, and worse,
//      state was unknowable after a reboot.
//   2. FIRING WAS WINDOW-BASED. The reminder fired only inside a TWO-MINUTE
//      window; the door code inside four minutes. If the Pi was rebooting,
//      updating, or the API was briefly down during that window, the job was
//      lost FOREVER - no retry, no catch-up, no alert. A customer arrives to
//      a locked door and nobody knew.
//   3. NOTHING FIRED ONCE THE START TIME PASSED. A booking entered after its
//      own start (walk-in typed in late) got no power-on and no door code at
//      all. This is the Aug 5 production bug.
//
// THE MODEL NOW: a durable job ledger. Every automation a booking needs is a
// row with a DUE TIME. Work is picked up because it is DUE AND NOT DONE - not
// because we happen to be inside a narrow window. Missed work is caught up.
// Failures retry with backoff. Repeated failures are surfaced loudly instead
// of dying in a log line. Nothing is ever "quietly skipped".
'use strict';

const dbM = require('./db');

// Retry policy: quick first retries (transient API blips), then slower.
const BACKOFF_MINS = [0, 1, 2, 5, 10, 20];
const MAX_ATTEMPTS = BACKOFF_MINS.length;

function D() { return dbM.db; }

function ensureSchema() {
  D().exec(`CREATE TABLE IF NOT EXISTS automation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    device_key TEXT NOT NULL DEFAULT '',
    due_at TEXT NOT NULL,
    deadline_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT DEFAULT '',
    next_attempt_at TEXT,
    fired_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (booking_id, kind, device_key)
  )`);
  try { D().exec(`CREATE INDEX IF NOT EXISTS idx_auto_pending ON automation_jobs (status, due_at)`); } catch {}
  // Existing installs: add the lease column without touching their data.
  try {
    const cols = D().prepare(`PRAGMA table_info(automation_jobs)`).all().map(c => c.name);
    if (!cols.includes('lease_until')) D().exec(`ALTER TABLE automation_jobs ADD COLUMN lease_until TEXT`);
  } catch {}
}

/**
 * PRUNE - maintainer: "eventually that 'did I do this' needs to die once it's done."
 * Terminal rows older than the retention window are removed so the ledger
 * cannot grow without bound.
 *
 * WHY 30 DAYS AND NOT 2: the scheduler only ever looks at bookings from
 * yesterday, today and tomorrow. Pruning a 'done' row for a booking still
 * inside that sweep would let the scheduler re-register it as pending - and
 * for power-off, which has no deadline, that would RE-FIRE it. Thirty days
 * is far outside any window the scheduler can reach, so a pruned row can
 * never come back to life.
 */
function pruneOld(days = 30) {
  ensureSchema();
  try {
    D().prepare(
      `DELETE FROM automation_jobs
        WHERE status IN ('done','skipped','missed','failed')
          AND created_at < datetime('now', ?)`
    ).run(`-${days} days`);
  } catch {}
}

const iso = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 19);

/**
 * Register a job a booking needs. Idempotent: the UNIQUE constraint means
 * calling this every tick is safe and cheap. THIS replaces the in-memory
 * flags - the row itself is the memory, and it survives restarts.
 *
 * deadline_at: past this moment the job is pointless (e.g. powering on a bay
 * for a session that already ended). It is marked 'missed' and REPORTED,
 * never silently dropped.
 */
function ensureJob({ booking_id, kind, device_key = '', due_at, deadline_at = null, retime = false }) {
  ensureSchema();
  // A-wave 3 (Sep 11 2026, found by the automation gate on the bench): a job
  // whose deadline had ALREADY passed when it was first scheduled was never
  // missed work - the booking was entered after its window (yesterday's
  // walk-in typed in for the records, a seeded history row). Creating it only
  // to mark it 'missed' painted four red rows per past booking on Automation
  // Health and taught owners to ignore the panel. No row, nothing to report.
  // A job scheduled in time and then not claimed (the unit was down) still
  // goes 'missed' through claim() - that is the real signal, and it stays.
  if (deadline_at && Date.parse(iso(deadline_at) + 'Z') < Date.now()) return false;
  // Sep 12 2026 (the busy aged year found it): a cancel that lands while a tick is walking
  // the same booking cancels the rows that exist and the tick then inserts its own a moment
  // later - two pending jobs for a cancelled booking, never claimed, the health line red
  // forever. The booking's status is read again HERE, at the insert, never from the tick's
  // earlier read.
  // (a COMPLETED booking still owns its after-end legs - plug off, TV off, the door revoke, the shutdown - so
  //  only a booking that will not or did not happen refuses: cancelled, expired, or gone)
  //  a row that does not exist is not judged - on a unit every job comes from a row and rows are never deleted)
  try { const b = D().prepare(`SELECT status FROM bookings WHERE id=?`).get(booking_id); if (b && ORPHAN_STATUSES.includes(b.status) && !CLEANUP_KINDS.includes(kind)) return false; } catch {}
  try {
    D().prepare(
      `INSERT OR IGNORE INTO automation_jobs (booking_id, kind, device_key, due_at, deadline_at, next_attempt_at)
       VALUES (?,?,?,?,?,?)`
    ).run(booking_id, kind, device_key, iso(due_at), deadline_at ? iso(deadline_at) : null, iso(due_at));
    // A WAITING DEVICE JOB FOLLOWS THE OWNER'S TIMING (Oct 21 2026, the device audit). Jobs are made a day or two ahead, and
    // INSERT OR IGNORE kept the time they were made with: "turn the projector on 20 minutes early" changed nothing for today's
    // and tomorrow's sessions while the screen and the assistant said it had. A job still waiting and never tried takes the
    // time worked out now (the device legs pass retime; a door revoke or anything brought forward by dueNow never does).
    if (retime) D().prepare(`UPDATE automation_jobs SET due_at=?, next_attempt_at=?, deadline_at=?
        WHERE booking_id=? AND kind=? AND device_key=? AND status='pending' AND attempts=0 AND due_at<>?`)
      .run(iso(due_at), iso(due_at), deadline_at ? iso(deadline_at) : null, booking_id, kind, device_key, iso(due_at));
  } catch (e) { /* table race - next tick retries */ }
}

// The safety net for the same race, and for any path that ends a booking
// without cancelling its jobs: every tick, a pending job whose booking is no
// longer active is dropped - the booking is gone, so is the work.
const ORPHAN_STATUSES = ['cancelled', 'expired'];   // a session that will not or did not happen; 'completed' keeps its after-end legs
// A-wave 10: the first cut of the orphan rule refused and dropped EVERY kind for a
// cancelled booking - including the legs that make the bay safe again. A cancel that
// lands after the plug and the TV went ON must still turn them OFF, and a door code
// already issued must still be revoked. These four are never refused and never dropped.
// (Oct 21 2026) a facility device's change - the heat to its idle temperature, the lounge TV on for the
// evening - belongs to no booking and is retried for as long as it still applies, like the switch-offs; the next change
// writes it off (services/facilitydevices)
const CLEANUP_KINDS = ['power_off', 'ir_off', 'shutdown', 'door_revoke', 'facility_on', 'facility_off'];
/**
 * WORK THAT MUST HAPPEN NOW, WHATEVER IT WAS SCHEDULED FOR (Sep 25 2026, found by
 * test-unifi-path). ensureJob is INSERT OR IGNORE - so a cancel that could not take a
 * door code back and asked for its revoke "now" changed nothing whenever the tick had
 * already scheduled that revoke for the session's end, which it does for every booking
 * holding a code (from 15 minutes before the start). The customer who cancelled kept a
 * working code until the session they cancelled would have ended, and the health line
 * stayed green because nothing had been tried and refused. This brings the existing row
 * forward (and back to pending if an earlier credential's revoke already finished); a
 * row in flight is left to its lease.
 */
function dueNow(booking_id, kind, device_key = '') {
  ensureJob({ booking_id, kind, device_key, due_at: new Date() });
  try {
    const t = iso(new Date());
    D().prepare(`UPDATE automation_jobs SET due_at=MIN(due_at, ?), next_attempt_at=?,
        status=CASE WHEN status IN ('done','skipped','missed') THEN 'pending' ELSE status END
      WHERE booking_id=? AND kind=? AND device_key=? AND status <> 'running'`).run(t, t, booking_id, kind, device_key || '');
  } catch (e) { try { dbM.adminLog('AUTOMATION_ERROR', `could not bring ${kind} for ${booking_id} forward: ${String(e.message).slice(0, 120)}`); } catch {} }
}

function dropOrphanedJobs() {
  ensureSchema();
  try {
    // 'pending' ONLY: a 'running' row is a lease a tick is holding while it awaits a
    // real device - deleting it erases the outcome of work that is happening (A-wave 5
    // put that lease on disk for exactly this reason). And a cleanup kind is never an
    // orphan: it is the work that makes the bay safe.
    const rows = D().prepare(`SELECT j.id, j.booking_id, j.kind, b.status FROM automation_jobs j JOIN bookings b ON b.id = j.booking_id WHERE j.status='pending' AND b.status IN ('cancelled','expired') AND j.kind NOT IN ('power_off','ir_off','shutdown','door_revoke')`).all();
    for (const r of rows) D().prepare(`DELETE FROM automation_jobs WHERE id=?`).run(r.id);
    if (rows.length) { try { require('./db').adminLog('AUTOMATION_ORPHANS_DROPPED', rows.map(r => `${r.kind} for ${r.booking_id} (${r.status || 'no booking'})`).join('; ').slice(0, 300)); } catch {} }
    return rows.length;
  } catch { return 0; }
}

/**
 * A JOB NOTHING WILL EVER CLAIM IS MISSED, NOT OVERDUE (Sep 24 2026, the aged year).
 * claim() is the only thing that writes a job off, and only the tick calls it - for
 * bookings that are active or completed in the last hour. A job still pending past
 * its deadline when its booking has finished is never claimed again: it read
 * "overdue - queued but never claimed" for the rest of the year, the health line red
 * and its advice (restart the unit) no help. It is recorded as missed here, on every
 * tick - exactly what claim() does with a job past its deadline - and the owner's
 * log names it. A door revoke has no deadline and is never written off (rule 28's
 * sweep owns it); a job with no deadline is owed work and keeps reading overdue.
 */
function retireUnreachable() {
  ensureSchema();
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const rows = D().prepare(`SELECT j.id, j.booking_id, j.kind, j.device_key FROM automation_jobs j JOIN bookings b ON b.id = j.booking_id
      WHERE j.status='pending' AND j.kind <> 'door_revoke' AND j.deadline_at IS NOT NULL AND j.deadline_at < ? AND b.status = 'completed'`).all(now);
    for (const r of rows) D().prepare(`UPDATE automation_jobs SET status='missed', last_error='deadline passed - its booking had already finished' WHERE id=?`).run(r.id);
    if (rows.length) { try { require('./db').adminLog('AUTOMATION_MISSED', rows.map(r => `${r.kind}${r.device_key ? ' ' + r.device_key : ''} | Booking: ${r.booking_id} (finished before it could run)`).join('; ').slice(0, 300)); } catch {} }
    return rows.length;
  } catch { return 0; }
}

/**
 * A DOOR REMOVAL WITH NOTHING LEFT TO REMOVE IS DELETED, NOT LEFT WAITING (maintainer, Sep 27 2026 - the
 * hotfix that replaced the unsent 2d0e09b pack). A door_revoke survives a cancel on purpose (A-wave
 * 11c): a revoke the lock REFUSED keeps the booking's code pointer, and the job is how it is taken back.
 * But the staff pad's cancel and move clear the pointer when the lock TAKES the code back, and then
 * nothing ever claims the job - the sweep visits only bookings still holding a code, the booking loop
 * skips cancelled ones, retireUnreachable leaves door revokes alone. It sat "overdue - queued but never
 * claimed" for ever, the health line red with advice (restart the unit) that could not help. And a
 * MOVED booking kept its old job with the old time (ensureJob never moves a waiting job), so once the
 * new session's code was issued the stale job - already due - took the NEW code back off the lock.
 * A door_revoke whose booking holds no code has nothing to take back: it is deleted (never marked
 * done - a later code on the same booking must get a fresh job with its own time). Called for the one
 * booking at the cancel and the move, on every tick before the door sweep, and once at boot with a
 * line in the owner's log (scheduler.startScheduler). A job mid-run is left to finish.
 */
function dropSpentDoorRevokes(booking_id = null) {
  ensureSchema();
  try {
    const rows = D().prepare(`SELECT j.id, j.booking_id FROM automation_jobs j LEFT JOIN bookings b ON b.id = j.booking_id
      WHERE j.kind='door_revoke' AND j.status IN ('pending','failed') AND (b.id IS NULL OR COALESCE(b.remotelock_person_id,'') = '')`
      + (booking_id ? ' AND j.booking_id = ?' : '')).all(...(booking_id ? [booking_id] : []));
    for (const r of rows) D().prepare(`DELETE FROM automation_jobs WHERE id=? AND status<>'running'`).run(r.id);
    return rows.map(r => r.booking_id);
  } catch { return []; }
}

/**
 * A-wave 10: THE OTHER HALF OF THE CANCEL RACE. ensureJob reads the booking's status
 * at the INSERT, but a tick walks a three-day window of bookings while awaiting real
 * device and SMS calls, so a cancel can land seconds AFTER the row was read and the
 * row it wants to fire has existed for hours. claim() reads nothing but the job table,
 * so the door code was still generated and texted to a customer who had just cancelled,
 * and the revoke that would have taken it back was never created. The firing path now
 * reads the booking too - and only the cleanup kinds survive a cancel.
 */
function bookingBlocksJob(booking_id, kind) {
  if (CLEANUP_KINDS.includes(kind)) return false;
  try { const b = D().prepare(`SELECT status FROM bookings WHERE id=?`).get(booking_id); return !!(b && ORPHAN_STATUSES.includes(b.status)); } catch { return false; }
}

/**
 * Should this job run RIGHT NOW? True when it is due (or overdue - that is
 * the catch-up), not already done, and past its retry backoff.
 */
const LEASE_MINS = 5;

function claim(booking_id, kind, device_key = '') {
  ensureSchema();
  const row = D().prepare(
    `SELECT * FROM automation_jobs WHERE booking_id=? AND kind=? AND device_key=?`
  ).get(booking_id, kind, device_key);
  if (!row) return false;
  if (row.status === 'done' || row.status === 'missed' || row.status === 'skipped') return false;
  if (row.status === 'failed' && !CLEANUP_KINDS.includes(kind)) return false;   // 'failed' is terminal for everything but the work that makes a bay safe
  // A-wave 11b: a DOOR code is the one thing that is never written off. Every other
  // kind retires at MAX_ATTEMPTS and shows on the health panel; a revoke that has
  // failed six times is a customer who can still open the building, so it keeps its
  // place in the queue (the backoff below still spaces the attempts out) until the
  // lock takes it back. maintainer, Sep 13 2026: "retried by something until it succeeds or
  // an owner is told" - and it is BOTH, not either.
  if (row.attempts >= MAX_ATTEMPTS && !CLEANUP_KINDS.includes(kind)) return false;   // already 'failed', surfaced
  // The booking is read HERE, at the moment of firing - not from the tick's snapshot
  // minutes ago. A cancel that landed in between must not send a door code, a text or
  // power to a bay nobody booked. The row goes with it so nothing reads overdue.
  if (bookingBlocksJob(booking_id, kind)) {
    try { D().prepare(`DELETE FROM automation_jobs WHERE id=?`).run(row.id); } catch {}
    try { dbM.adminLog('AUTOMATION_CANCELLED_MIDFLIGHT', `${kind}${device_key ? ' ' + device_key : ''} | Booking: ${booking_id} was cancelled while the tick was running - the job was dropped, not fired`); } catch {}
    return false;
  }

  const now = Date.now();

  // ── NO DOUBLE FIRE ──────────────────────────────────────────────────────
  // The caller awaits the real effect (an HTTP call to RemoteLock, an SMS).
  // That await yields the event loop, so the NEXT scheduler tick can arrive
  // while this job is still in flight. If claiming were only a read, that
  // tick would see 'pending' and fire a SECOND door code / text. So the row
  // is reserved synchronously - before any await can happen - and a live
  // reservation blocks every other claimer.
  if (row.status === 'running') {
    const leaseOk = row.lease_until && Date.parse(row.lease_until + 'Z') > now;
    if (leaseOk) return false;            // genuinely in flight elsewhere
    // Lease expired: the process died mid-run. Reclaim it rather than
    // leaving the job stuck forever.
    try { dbM.adminLog('AUTOMATION_LEASE_EXPIRED', `${kind}${device_key ? ' ' + device_key : ''} | Booking: ${booking_id}`); } catch {}
  }

  if (Date.parse(row.due_at + 'Z') > now) return false;        // not due yet
  if (row.next_attempt_at && Date.parse(row.next_attempt_at + 'Z') > now) return false;  // backing off

  // Past usefulness: report it, never pretend it succeeded.
  if (row.deadline_at && Date.parse(row.deadline_at + 'Z') < now) {
    D().prepare(`UPDATE automation_jobs SET status='missed', last_error='deadline passed before it could run' WHERE id=?`).run(row.id);
    try { dbM.adminLog('AUTOMATION_MISSED', `${kind}${device_key ? ' ' + device_key : ''} | Booking: ${booking_id}`); } catch {}
    return false;
  }

  // Reserve it. Synchronous read-modify-write with no await between, so
  // within this single-process app the reservation is atomic.
  D().prepare(
    `UPDATE automation_jobs SET status='running', lease_until=datetime('now', ?) WHERE id=?`
  ).run(`+${LEASE_MINS} minutes`, row.id);
  return true;
}

function succeed(booking_id, kind, device_key = '') {
  ensureSchema();
  D().prepare(
    `UPDATE automation_jobs SET status='done', fired_at=datetime('now'), last_error='', lease_until=NULL
      WHERE booking_id=? AND kind=? AND device_key=?`
  ).run(booking_id, kind, device_key);
}

/** Record a failure and schedule the next attempt. Loud when it gives up. */
function fail(booking_id, kind, device_key, error) {
  ensureSchema();
  const row = D().prepare(
    `SELECT * FROM automation_jobs WHERE booking_id=? AND kind=? AND device_key=?`
  ).get(booking_id, kind, device_key || '');
  if (!row) return;
  const attempts = row.attempts + 1;
  const msg = String(error || 'unknown error').slice(0, 300);

  if (attempts >= MAX_ATTEMPTS) {
    // A door revoke past its attempts is still FAILED - the owner's panel and the
    // health line must say so - but it keeps a next attempt, ten minutes out, for
    // ever. Everything else stops here; a live door code does not get to stop.
    // (Without the stamp the row would be claimable on every single tick and the
    // unit would hammer an unreachable lock sixty times an hour.)
    // A-wave 12b: the same for every CLEANUP kind, now that a device refusal
    // actually fails the job. A plug or a television left on all night, or a PC left
    // running, is the same class of harm as a live door code: it never gets to stop.
    const keepTrying = CLEANUP_KINDS.includes(kind);
    D().prepare(`UPDATE automation_jobs SET status='failed', attempts=?, last_error=?, lease_until=NULL${keepTrying ? ", next_attempt_at=datetime('now','+10 minutes')" : ''} WHERE id=?`)
      .run(attempts, msg, row.id);
    // A hard failure is an operational event, not a debug line. It shows on
    // the owner's automation health panel and in the log.
    try { dbM.adminLog('AUTOMATION_FAILED', `${kind}${device_key ? ' ' + device_key : ''} | Booking: ${row.booking_id} | ${msg}`); } catch {}
    return;
  }
  const wait = BACKOFF_MINS[Math.min(attempts, BACKOFF_MINS.length - 1)];
  // Back to 'pending' so the retry can claim it again; lease released.
  D().prepare(
    `UPDATE automation_jobs SET status='pending', attempts=?, last_error=?, next_attempt_at=datetime('now', ?), lease_until=NULL WHERE id=?`
  ).run(attempts, msg, `+${wait} minutes`, row.id);
  try { dbM.adminLog('AUTOMATION_RETRY', `${kind} | Booking: ${row.booking_id} | attempt ${attempts}/${MAX_ATTEMPTS} | ${msg}`); } catch {}
}

/** Is this job still waiting to be decided? (A skip only changes a pending row, so a caller that
 *  logs its skip asks this first - or the log gets a line a minute for a job long done.) */
function isPending(booking_id, kind, device_key = '') {
  try { const r = D().prepare(`SELECT status FROM automation_jobs WHERE booking_id=? AND kind=? AND device_key=?`).get(booking_id, kind, device_key || ''); return !!(r && r.status === 'pending'); } catch { return false; }
}

/** Deliberately not applicable (e.g. a reminder for a session already under way). */
function skip(booking_id, kind, device_key, reason) {
  ensureSchema();
  D().prepare(
    `UPDATE automation_jobs SET status='skipped', last_error=? WHERE booking_id=? AND kind=? AND device_key=? AND status='pending'`
  ).run(String(reason || '').slice(0, 200), booking_id, kind, device_key || '');
}

/** A job that can no longer be sent (Oct 3 2026, rule 41). Never tried: skipped - not applicable.
 *  Tried and refused: MISSED, with the device's own refusal kept, so it stays on the health line -
 *  a toggle TV whose "on" was refused, then written off as "skipped" three minutes into the session,
 *  left the customer playing with the TV off and the owner's line green. Returns what it wrote. */
function writeOff(booking_id, kind, device_key, reason) {
  ensureSchema();
  const row = D().prepare(`SELECT id, attempts, last_error FROM automation_jobs WHERE booking_id=? AND kind=? AND device_key=? AND status='pending'`).get(booking_id, kind, device_key || '');
  if (!row) return null;
  // tried = a failed attempt on this row, or one the owner's Retry put back (Oct 3 2026, the pack review): Retry resets
  // attempts to 0, so a missed TV-on retried past its no-late-toggle point was written off as 'skipped' - the red line
  // went green with nothing sent and the device's words gone. Retry now keeps them behind RETRIED.
  const retried = String(row.last_error || '').startsWith(RETRIED);
  if (!(row.attempts > 0) && !retried) { skip(booking_id, kind, device_key, reason); return 'skipped'; }
  // the DEVICE'S words, once: a job written off, retried and written off again carried the reason twice and the
  // Retry prefix, and the words that say what went wrong fell past the 300 characters kept
  let last = String(row.last_error || '');
  if (retried) last = last.slice(RETRIED.length);
  const nw = last.lastIndexOf(NEVER_WORKED); if (nw >= 0) last = last.slice(nw + NEVER_WORKED.length);
  const msg = (`${reason}${NEVER_WORKED.replace(/: $/, retried ? ' (Retry was pressed): ' : ': ')}${last || 'the device did not answer'}`).slice(0, 300);
  D().prepare(`UPDATE automation_jobs SET status='missed', last_error=?, lease_until=NULL WHERE id=?`).run(msg, row.id);
  try { dbM.adminLog('AUTOMATION_FAILED', `${kind}${device_key ? ' ' + device_key : ''} | Booking: ${booking_id} | ${msg}`); } catch {}
  return 'missed';
}

/** Wrap an effect so success/failure bookkeeping can never be forgotten. */
async function run(booking_id, kind, device_key, fn) {
  // THE LEASE IS ON DISK BEFORE THE DEVICE IS DRIVEN (A-wave 5b, Sep 11 2026,
  // the bench found it): the claim above scheduled an asynchronous save; a
  // kill inside that window left the row 'pending' with no lease on disk, so
  // the next boot would drive the device a second time. Wait for the write.
  // And after the outcome, the same: 'done' or 'failed' lands before the next
  // job, so a crash right after a device call is a reclaim, not a repeat.
  try { await dbM.flushed(); } catch {}
  try {
    await fn();
    succeed(booking_id, kind, device_key);
    try { await dbM.flushed(); } catch {}
    return true;
  } catch (e) {
    fail(booking_id, kind, device_key, e && e.message);
    try { await dbM.flushed(); } catch {}
    return false;
  }
}

/** A booking that is cancelled or moved must not keep firing old jobs. */
// A-wave 11c: a blanket cancel does NOT take the door revoke with it. bookingedit
// queues a revoke when the lock refused one, eleven lines before calling this - and
// this deleted it, so the credential stayed live with nothing scheduled to take it
// back. A 'running' row is a live lease and is left alone here for the same reason
// dropOrphanedJobs leaves it: something is in the middle of doing that work.
function cancelJobs(booking_id, kinds = null, opts = {}) {
  ensureSchema();
  // A CANCEL KEEPS THE SWITCH-OFFS (Sep 25 2026, the build review): the staff pad's cancel deleted
  // the plug-off, TV-off and shutdown with everything else, so a session cancelled while it was
  // playing left the bay running all night. They stay, and the scheduler settles them - sent if
  // the bay was switched on for this booking, written off if it never was (sweepCancelledCleanup).
  if (opts.keepCleanup) {
    // ...and the record that the bay WAS switched on for it stays too (Oct 3 2026, the review): this deleted the done
    // power_on / ir_on rows, and the settle reads exactly those - so every plug, TV and Home Assistant device of a session
    // the staff pad cancelled mid-play was written off "cancelled before it was switched on" and left on all night
    // (the battery cancelled with a bare status UPDATE and never met this)
    D().prepare(`DELETE FROM automation_jobs WHERE booking_id=? AND status<>'running' AND kind NOT IN ('power_off','ir_off','shutdown','door_revoke') AND NOT (status='done' AND kind IN ('power_on','ir_on'))`).run(booking_id);
    D().prepare(`DELETE FROM automation_jobs WHERE booking_id=? AND kind='door_revoke' AND status IN ('done','skipped','missed')`).run(booking_id);
    return;
  }
  if (kinds && kinds.length) {
    const keep = kinds.filter(k => k !== 'door_revoke');
    if (!keep.length) return;
    const marks = keep.map(() => '?').join(',');
    D().prepare(`DELETE FROM automation_jobs WHERE booking_id=? AND kind IN (${marks}) AND status<>'running' AND device_key NOT LIKE 'left:%'`).run(booking_id, ...keep);
  } else {
    // the door revoke survives a blanket cancel (A-wave 11c) - but a FINISHED one
    // must not, or it would sit there as a 'done' row blocking every later revoke
    // for that booking (ensureJob is INSERT OR IGNORE).
    // a bay this session LEFT keeps its switch-offs through a second move (queueLeftBay)
    D().prepare(`DELETE FROM automation_jobs WHERE booking_id=? AND status<>'running' AND device_key NOT LIKE 'left:%' AND (kind<>'door_revoke' OR status IN ('done','skipped','missed'))`).run(booking_id);
  }
}

/**
 * A SESSION MOVED OFF A BAY IT HAD SWITCHED ON (Oct 3 2026, the review). The old bay's switch-offs are settled exactly as
 * a cancel's are (scheduler.sweepCancelledCleanup): the PC first and its power after, only the devices this session
 * switched on, never one another session is using now, the toggle ledger asked before a TV is sent anything, and a
 * refusal retried and on the health line. (The first cut ran the bay buttons' Off, which knew none of that - a shared
 * device switched off under other groups, and a toggle TV this session never switched on sent "off", i.e. on.)
 * Keyed 'left:<bay id>|<device key>' so the new bay's own jobs never meet them; the 'done' on-row beside each is the
 * record the settle reads. items: [{ on, off, key }]; pc: queue the PC's shutdown.
 */
function queueLeftBay(booking_id, bayId, items, pc) {
  ensureSchema();
  const pre = `left:${bayId}|`, now = iso(Date.now());
  const done = D().prepare(`INSERT OR IGNORE INTO automation_jobs (booking_id, kind, device_key, due_at, status, fired_at) VALUES (?,?,?,?,'done',?)`);
  const due = D().prepare(`INSERT OR IGNORE INTO automation_jobs (booking_id, kind, device_key, due_at, next_attempt_at) VALUES (?,?,?,?,?)`);
  for (const it of items || []) { done.run(booking_id, it.on, pre + it.key, now, now); due.run(booking_id, it.off, pre + it.key, now, now); }
  if (pc) due.run(booking_id, 'shutdown', pre, now, now);
}

/**
 * HEALTH - so a failure is never silent. Surfaced in admin and pollable.
 */
function health({ hours = 48 } = {}) {
  ensureSchema();
  const since = `-${hours} hours`;
  const q = (sql, ...a) => { try { return D().prepare(sql).all(...a); } catch { return []; } };
  const failed = q(
    `SELECT j.*, b.name, b.date, b.start_time, b.bay_name
       FROM automation_jobs j LEFT JOIN bookings b ON b.id = j.booking_id
      WHERE j.status IN ('failed','missed')
        AND j.created_at >= datetime('now', ?)
      ORDER BY j.id DESC LIMIT 50`, since);
  const retrying = q(
    `SELECT j.*, b.name, b.date, b.start_time, b.bay_name
       FROM automation_jobs j LEFT JOIN bookings b ON b.id = j.booking_id
      WHERE j.status='pending' AND j.attempts > 0
      ORDER BY j.id DESC LIMIT 50`);
  const counts = {};
  for (const r of q(`SELECT status, COUNT(*) c FROM automation_jobs WHERE created_at >= datetime('now', ?) GROUP BY status`, since)) {
    counts[r.status] = r.c;
  }
  const pendingOverdue = q(
    `SELECT COUNT(*) c FROM automation_jobs
      WHERE status='pending' AND due_at <= datetime('now','-5 minutes')
        AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))`)[0];
  return {
    window_hours: hours,
    counts,
    failed: failed.map(shape),
    retrying: retrying.map(shape),
    overdue: (pendingOverdue && pendingOverdue.c) || 0,
    healthy: failed.length === 0 && ((pendingOverdue && pendingOverdue.c) || 0) === 0
  };
}
function shape(r) {
  // a switch-off for a bay the session LEFT is that bay's, named by its device - never the bay the booking is on now with
  // a raw 'left:' key (the review: the owner checked the wrong bay's plug)
  const left = /^left:([^|]*)\|(.*)$/.exec(r.device_key || '');
  const leftBay = left ? (((require('./config').getConfig().bays) || []).find(b => b.id === left[1]) || {}) : null;
  // a facility device's change: named by the device, on "the facility", never a raw 'fac:' key
  const fac = r.booking_id === 'facility' ? /^fac:(.*)#\d+$/.exec(r.device_key || '') : null;
  if (fac) {
    const d = ((((require('./config').getConfig().homeAssistant) || {}).facilityDevices) || []).find(x => x && x.entity_id === fac[1]) || {};
    // the raw key stays the job's address (Retry posts it back - the device audit: the name went back and matched nothing,
    // while the owner was told "requeued"); the device's own name is what a person reads
    return { booking_id: r.booking_id, kind: r.kind, device: r.device_key, name: d.name || fac[1], due_at: r.due_at, status: r.status, attempts: r.attempts,
      error: r.last_error || '', fired_at: r.fired_at || null, who: null, when: null, bay: 'the facility' };
  }
  return {
    booking_id: r.booking_id, kind: r.kind, device: left ? (left[2] || null) : (r.device_key || null),
    due_at: r.due_at, status: r.status, attempts: r.attempts,
    error: r.last_error || '', fired_at: r.fired_at || null,
    who: r.name || null, when: r.date && r.start_time ? `${r.date} ${r.start_time}` : null,
    bay: left ? ((leftBay.name || left[1]) + ' (the session moved from it)') : (r.bay_name || null)
  };
}

/** Operator action: put a failed job back in the queue. */
// what a job the owner put back with Retry carries in last_error: the words it failed with stay readable, and writeOff
// counts it as tried (it never runs into a 'skipped' that hides the failure)
const RETRIED = 'Retry pressed - it had failed: ';
const NEVER_WORKED = ' - it never worked: ';
function retryNow(booking_id, kind, device_key = '') {
  ensureSchema();
  // A tick only walks bookings that are active, or completed in the last 150 minutes
  // (services/db.getUpcomingBookings). Putting a job back to 'pending' for anything
  // else queues work nothing will ever claim: it reads overdue for ever, the health
  // line and every gate go red on that unit, and the owner was told "it will run
  // within a minute". Say what is true instead.
  let claimable = true, why = '';
  try {
    const b = D().prepare(`SELECT status, updated_at FROM bookings WHERE id=?`).get(booking_id);
    if (b) {
      if (ORPHAN_STATUSES.includes(b.status) && !CLEANUP_KINDS.includes(kind)) { claimable = false; why = 'that booking was ' + b.status; }
      else if (b.status === 'completed') {
        const mins = (Date.now() - Date.parse(String(b.updated_at || '').replace(' ', 'T') + 'Z')) / 60000;
        if (!(mins < 150)) { claimable = false; why = 'that session finished more than two and a half hours ago, so the unit no longer drives it'; }
      }
    }
  } catch {}
  if (!claimable) {
    try { dbM.adminLog('AUTOMATION_RETRY_REFUSED', `${kind} | Booking: ${booking_id}: ${why}`); } catch {}
    return { changes: 0, queued: false, reason: why + ' - the unit will not run this job again. Do it by hand (a door code is revoked at the lock, a bay is switched at the panel).' };
  }
  const res = D().prepare(
    `UPDATE automation_jobs
        SET status='pending', attempts=0, next_attempt_at=datetime('now'), lease_until=NULL,
            last_error=substr('${RETRIED}' || COALESCE(NULLIF(last_error,''), 'no reason was recorded'), 1, 300)
      WHERE booking_id=? AND kind=? AND device_key=? AND status IN ('failed','missed')`
  ).run(booking_id, kind, device_key);
  try { dbM.adminLog('AUTOMATION_RETRY_MANUAL', `${kind} | Booking: ${booking_id}`); } catch {}
  return { changes: (res && res.changes) || 0, queued: true };
}

/**
 * DEFER a job to run later WITHOUT burning its retry budget or marking it done.
 * Used when a shutdown is due but a customer is mid-checkout (booking is
 * pending_payment covering this bay right now): we must not fire the shutdown
 * (would strand a paying customer's bay off) and must not permanently skip it
 * (an abandoned cart would leave the bay ON forever). Instead re-arm the job to
 * status='pending', attempts=0 (no budget burned), next_attempt_at = now +
 * waitMins, so it re-evaluates every waitMins indefinitely while the cart is
 * live. When the cart confirms, a new active booking cancels this job; when the
 * cart expires, the next tick sees no pending hold and fires normally.
 * (Built for golden per the pilot facility "Yolanda" race analysis, Aug 16.)
 */
/** The opposite of defer: a pending job whose wait is over is made due now,
 *  attempts untouched. The door text is deferred a minute at a time while the
 *  lock has not confirmed; the minute it confirms, the customer is texted in
 *  THAT tick - not the next one (feature/door-interface). */
function nudge(booking_id, kind, device_key = '') {
  ensureSchema();
  // never a job that has already FAILED (Oct 3 2026, the pack review): the door text is nudged on every tick once its
  // time has come, and this cancelled the backoff - six tries spent in about five minutes, so a ten-minute texting
  // outage at text time left the customer with no code. A deferral resets attempts to 0; only a real failure counts.
  return D().prepare(
    `UPDATE automation_jobs SET next_attempt_at=datetime('now','-1 second'), last_error=NULL
      WHERE booking_id=? AND kind=? AND device_key=? AND status='pending' AND attempts = 0`
  ).run(booking_id, kind, device_key || '');
}
function defer(booking_id, kind, device_key = '', waitMins = 2, reason = '') {
  ensureSchema();
  const res = D().prepare(
    `UPDATE automation_jobs
        SET status='pending', attempts=0, lease_until=NULL,
            next_attempt_at=datetime('now', ?), last_error=?
      WHERE booking_id=? AND kind=? AND device_key=? AND status IN ('pending','running')`
  ).run(`+${Math.max(1, waitMins)} minutes`, String(reason || 'deferred').slice(0, 200), booking_id, kind, device_key || '');
  return res;
}

/**
 * Cancel any still-PENDING (or deferred) shutdown/power_off/ir_off jobs that
 * belong to OTHER bookings on the same bay. Called when a NEW booking becomes
 * active: if it won the race against a prior session's end-of-session shutdown,
 * that prior shutdown must not fire into the now-occupied bay. Only touches jobs
 * that have NOT already fired (status pending) - a shutdown already sent is left
 * as history. Scoped to one bay; never cancels the new booking's own jobs.
 *
 * ONLY WHAT IS DUE, ONLY FOR A SESSION THAT IS HERE (Sep 25 2026, the build review): this used
 * to skip every pending OFF and shutdown on the bay whatever its date - a customer booking the
 * bay for NEXT WEEK wrote off tonight's and tomorrow's switch-offs, final, and the bay ran all
 * night with the health line green. A switch-off is decided when it is due, against the bookings
 * as they are then (the scheduler's keep-on, held-by-a-later-session and live-session checks);
 * this now touches only a switch-off already due, and only when the new session is under way or
 * starts within the keep-on gap - the race it was written for.
 */
function cancelBayShutdownJobs(bayId, exceptBookingId, gapMins) {
  ensureSchema();
  if (!bayId) return { changes: 0 };
  let near = false;
  try {
    const nb = D().prepare(`SELECT date, start_time, end_time, end_date FROM bookings WHERE id=?`).get(exceptBookingId || '');
    if (nb) {
      const gap = Number.isFinite(Number(gapMins)) ? Number(gapMins) : Number((require('./config').getConfig().automation || {}).keepOnGapMins ?? 30);
      const s = new Date(`${nb.date}T${nb.start_time}:00`).getTime();
      const e = new Date(`${nb.end_date || nb.date}T${nb.end_time}:00`).getTime();
      const n = Date.now();
      near = Number.isFinite(s) && s <= n + gap * 60000 && (!Number.isFinite(e) || e > n);
    }
  } catch {}
  if (!near) return { changes: 0 };
  const rows = D().prepare(
    `SELECT j.id FROM automation_jobs j
        JOIN bookings b ON b.id = j.booking_id
       WHERE ((b.bay_id = ? AND j.device_key NOT LIKE 'left:%') OR j.device_key LIKE ?)
         AND j.booking_id != ?
         AND j.kind IN ('shutdown','power_off','ir_off')
         AND j.status = 'pending'
         AND j.due_at <= datetime('now')`
  ).all(bayId, 'left:' + bayId + '|%', exceptBookingId || '');   // a moved session's switch-offs belong to the bay it LEFT
  if (!rows.length) return { changes: 0 };
  const ids = rows.map(r => r.id);
  const marks = ids.map(() => '?').join(',');
  D().prepare(
    `UPDATE automation_jobs SET status='skipped', last_error='a new booking took this bay - prior shutdown cancelled' WHERE id IN (${marks})`
  ).run(...ids);
  const changes = ids.length;
  try { dbM.adminLog('SHUTDOWN_CANCELLED_NEW_BOOKING', `Bay ${bayId}: ${changes} pending shutdown/off job(s) cancelled by a new booking`); } catch {}
  return { changes };
}

module.exports = {
  dropOrphanedJobs, retireUnreachable, dropSpentDoorRevokes,
  ensureSchema, ensureJob, dueNow, claim, succeed, fail, skip, writeOff, isPending, run, pruneOld,
  cancelJobs, queueLeftBay, defer, nudge, cancelBayShutdownJobs, health, retryNow, MAX_ATTEMPTS, BACKOFF_MINS
};
