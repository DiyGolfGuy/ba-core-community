// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/scheduler.js  —  Background Cron (every minute)
//
//  All timing is read live from config.json — change in admin, takes effect
//  on the next minute tick without restarting.
// ═══════════════════════════════════════════════════════════════════════════════

const cron = require('node-cron');
const dbModule = require('./db');
const { getUpcomingBookings, adminLog } = dbModule;
const db = () => dbModule.db;
const { sendReminder, sendDoorCode, sendSessionEndingWarning } = require('./sms');
const { sendReminderEmail, sendDoorCodeEmail, sendSessionEndingEmail } = require('./email');
const { generateDoorCode, revokeDoorCode, moveDoorCodeWindow } = require('./doorlock');
const { controlDevice }                     = require('./shelly');
const automation                            = require('./automation');
const { sendCommand } = require('./broadlink');
const { sendShutdown, sendRestart, probePc, getBayById } = require('./simulator');
const haService                             = require('./homeassistant');
const { getConfig, saveConfig }             = require('./config');
const { stripeClient }                      = require('./stripeclient');

function padDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Track which per-device triggers have fired this session
// Fired-state now lives in services/automation (a durable ledger). The old
// in-memory objects here vanished on every restart and could not survive a
// reboot, which is how automation used to silently repeat or disappear.

function deviceKey(bookingId, ip) { return `${bookingId}::${ip}`; }

// Absolute time helpers so day boundaries (midnight) don't break comparisons.
// dayIndex counts days from epoch using the date STRING parsed as LOCAL midnight,
// so it lines up with local-clock "now" math.
function dayIndex(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return Math.floor(new Date(y, m-1, d, 0, 0, 0, 0).getTime() / 86400000);
}
function toMinsOfDay(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }
function absStartOf(b) { return dayIndex(b.date) * 1440 + toMinsOfDay(b.start_time); }
function absEndOf(b)   { return dayIndex(b.end_date || b.date) * 1440 + toMinsOfDay(b.end_time); }
function nowAbsMins(now) { return dayIndex(padDate(now)) * 1440 + now.getHours()*60 + now.getMinutes(); }

// Find the next active booking in the same bay that STARTS at or after this
// booking's end, within `windowMins`. Day-aware (handles midnight). Pulls
// candidates across the end date and the following day, then compares absolutely.
function findNextBooking(dbMod, booking, windowMins) {
  const endAbs = absEndOf(booking);
  const endDate = booking.end_date || booking.date;
  const nextDay = (() => { const [y,m,d] = endDate.split('-').map(Number); const dt = new Date(y, m-1, d); dt.setDate(dt.getDate()+1); return padDate(dt); })();
  // A whole-facility booking owns every bay, so the booking that keeps its
  // equipment ON can be on ANY bay (in practice the next facility rental).
  const rows = booking.whole_facility
    ? dbMod.db.prepare(
        "SELECT id, date, start_time, end_time, end_date, member_id, phone FROM bookings " +
        "WHERE status='active' AND id!=? AND (date=? OR date=?)"
      ).all(booking.id, endDate, nextDay)
    : dbMod.db.prepare(
        "SELECT id, date, start_time, end_time, end_date, member_id, phone FROM bookings " +
        "WHERE (bay_id=? OR whole_facility=1) AND status='active' AND id!=? AND (date=? OR date=?)"
      ).all(booking.bay_id, booking.id, endDate, nextDay);   // a whole-facility rental uses this bay too (the review: the bay screen counted it, the text did not)
  let best = null;
  for (const r of rows) {
    const sAbs = dayIndex(r.date) * 1440 + toMinsOfDay(r.start_time);
    if (sAbs >= endAbs && sAbs <= endAbs + windowMins) {
      if (!best || sAbs < best._abs) { best = r; best._abs = sAbs; }
    }
  }
  return best;
}

// ── CROSS-BAY DEVICE GUARD ────────────────────────────────────────────────────
// A device (Shelly IP, BroadLink IP, or HA entity_id) may be shared across bays
// (e.g. one AC or one TV serving the whole room). Before turning a shared device
// OFF, make sure NO other bay that uses the same device has an active or
// upcoming session. Returns true if the device is still needed by another bay.
/**
 * IS THIS DEVICE ALREADY SERVING A LIVE SESSION RIGHT NOW? (W37, Sep 8 2026)
 *
 * The OFF guard asks "does anyone else still need this device". The ON path
 * shares that premise and never asked it. pilot facility learned the cost: most TVs
 * learn a single POWER TOGGLE, so the "on" and "off" codes in config are the
 * same physical button captured twice. Ten minutes before the next booking the
 * appliance sent "on" to an already-on television and switched it off, with a
 * customer in the bay.
 *
 * Deliberately DIFFERENT from deviceStillNeeded in two ways:
 *   - only sessions covering NOW count. A booking starting in 20 minutes has
 *     not turned anything on yet, so it must not block this one's power-on.
 *   - the booking's OWN bay is included. Back-to-back sessions on one bay are
 *     the exact case pilot facility hit; excluding the bay would miss it entirely.
 * We exclude only the booking being powered on for.
 */
function deviceLiveNow(cfg, now, deviceMatch, excludeBookingId) {
  const nowFromEpoch = nowAbsMins(now);
  for (const bay of (cfg.bays || [])) {
    // a bay out of service has nothing switched on for its sessions (bookingcore.baysToDrive), so a session still booked on it
    // holds no device (Oct 21 2026, the device audit: it kept the heater of a bay taken out of service on all day)
    if (bay.maintenance) continue;
    const usesShelly = (bay.shellyDevices    || []).some(d => deviceMatch.type === 'shelly'    && d.ip === deviceMatch.key);
    const usesBL     = (bay.broadlinkDevices || []).some(d => deviceMatch.type === 'broadlink' && d.ip === deviceMatch.key);
    const usesHA     = (bay.haDevices        || []).some(d => deviceMatch.type === 'ha'        && d.entity_id === deviceMatch.key);
    if (!usesShelly && !usesBL && !usesHA) continue;
    const rows = dbModule.db.prepare(
      "SELECT id, date, start_time, end_time, end_date FROM bookings WHERE bay_id=? AND status='active'"
    ).all(bay.id);
    for (const r of rows) {
      if (excludeBookingId && r.id === excludeBookingId) continue;
      const sAbs = dayIndex(r.date) * 1440 + toMinsOfDay(r.start_time);
      const eAbs = dayIndex(r.end_date || r.date) * 1440 + toMinsOfDay(r.end_time);
      if (sAbs <= nowFromEpoch && eAbs > nowFromEpoch) return true;
    }
  }
  return false;
}

/**
 * A LEARNED IR CODE IS A TOGGLE UNTIL THE OPERATOR SAYS OTHERWISE (rule 16).
 * 'toggle'   - the captured code flips whatever state the device is in, so a
 *              state-changing send is guarded on known state. THE DEFAULT.
 * 'discrete' - the device has separate, idempotent on and off codes (some AV
 *              receivers and projectors do). Only the operator can say so.
 * A discrete device wrongly guarded is harmless. A toggle device wrongly
 * unguarded turns a customer's TV off mid-session. The default never flips.
 */
function irCodeStyle(device) {
  return String(device && device.codeStyle || '').toLowerCase() === 'discrete' ? 'discrete' : 'toggle';
}

// ONE JOB PER IR DEVICE (Sep 25 2026, the build review): IR jobs were keyed by the BroadLink's
// address, so a TV and a projector on one bridge shared ONE job and only the first was ever switched
// on or off. The first device on a bridge keeps the bare address (rows already on a unit, and every
// bay with one device per bridge, are unchanged); any other gets its own key.
function irJobKey(bay, device) {
  const first = ((bay && bay.broadlinkDevices) || []).find(d => d && d.ip === device.ip && d.onCommand);
  return !first || first === device ? device.ip : device.ip + '#' + require('./devicelog').irKey(device).split(':').pop();
}

function deviceStillNeeded(cfg, now, deviceMatch, excludeBayId) {
  for (const bay of (cfg.bays || [])) {
    if (bay.id === excludeBayId) continue;
    if (bay.maintenance) continue;   // out of service: its sessions switch nothing on, so they need nothing kept on (Oct 21 2026)

    // Does this other bay use the same device?
    const usesShelly = (bay.shellyDevices    || []).some(d => deviceMatch.type === 'shelly'    && d.ip === deviceMatch.key);
    const usesBL     = (bay.broadlinkDevices || []).some(d => deviceMatch.type === 'broadlink' && d.ip === deviceMatch.key);
    const usesHA     = (bay.haDevices        || []).some(d => deviceMatch.type === 'ha'        && d.entity_id === deviceMatch.key);
    if (!usesShelly && !usesBL && !usesHA) continue;

    // This bay shares the device — is it active now or starting within 30 min?
    // Day-aware: compare on an absolute minute timeline so midnight crossings work.
    const nowFromEpoch = nowAbsMins(now);
    const rows = dbModule.db.prepare(
      "SELECT date, start_time, end_time, end_date FROM bookings WHERE bay_id=? AND status='active'"
    ).all(bay.id);
    for (const r of rows) {
      const sAbs = dayIndex(r.date) * 1440 + toMinsOfDay(r.start_time);
      const eAbs = dayIndex(r.end_date || r.date) * 1440 + toMinsOfDay(r.end_time);
      if (sAbs <= nowFromEpoch && eAbs > nowFromEpoch) return true;      // active now
      if (sAbs > nowFromEpoch && sAbs <= nowFromEpoch + 30) return true; // starts within 30 min
    }
  }
  return false;
}

/**
 * HAS A LATER SESSION ALREADY TAKEN THIS DEVICE? (Sep 25 2026, the build review.) Its ON has been
 * decided - sent, or held back because the device was already on - and its session is not over.
 * From that moment the device is that session's: an earlier session's OFF coming due after it
 * would switch the bay off in front of the next customer (a long "turn off after", a long "before").
 * The earlier OFF is written off; the later session owns its own.
 */
function heldByOther(onKind, deviceKey, excludeBookingId, now) {
  try {
    const rows = dbModule.db.prepare(`SELECT b.date, b.start_time, b.end_time, b.end_date FROM automation_jobs j JOIN bookings b ON b.id = j.booking_id
      WHERE j.kind=? AND j.device_key=? AND j.booking_id<>? AND j.status IN ('done','running','skipped') AND b.status='active'`).all(onKind, deviceKey, excludeBookingId || '');
    const n = nowAbsMins(now);
    return rows.some(r => absEndOf(r) > n);
  } catch { return false; }
}

/**
 * WAS THIS TV KEPT ON FOR THIS SESSION? (Sep 25 2026, the build review - a regression the item-5
 * rewrite made.) A session that ends within the keep-on gap of the next one's start has its OFF
 * held back, so the TV is still on when the next session's ON comes due. The command ledger is
 * trusted for two hours only, so after a two-hour session followed thirty minutes later the ON
 * went out as a toggle and switched the TV OFF ten minutes before the next customer - and the
 * next OFF switched it back on for the night. The pairing is asked directly now: a previous
 * session on this TV ended within the gap, and nothing has switched the TV off since (the
 * ledger's last command, whatever its age; on a unit with no ledger yet, that session's own ON).
 */
function keptOnFromPrevious(cfg, booking, device, gapMins, jobKey) {
  try {
    const startAbs = absStartOf(booking);
    const bayIds = (cfg.bays || []).filter(b => (b.broadlinkDevices || []).some(d => d.ip === device.ip)).map(b => b.id);
    if (!bayIds.includes(booking.bay_id)) bayIds.push(booking.bay_id);
    const prevDay = (() => { const [y, m, d] = booking.date.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - 1); return padDate(dt); })();
    const rows = dbModule.db.prepare(`SELECT id, bay_id, whole_facility, date, start_time, end_time, end_date FROM bookings
      WHERE id<>? AND status IN ('active','completed') AND booking_type IS NOT 'maintenance' AND (date=? OR date=? OR end_date=?)`).all(booking.id, booking.date, prevDay, booking.date);
    let prev = null;
    for (const r of rows) {
      if (!(r.whole_facility || booking.whole_facility || bayIds.includes(r.bay_id))) continue;
      const e = absEndOf(r), s = absStartOf(r);
      if (s < startAbs && e <= startAbs && e >= startAbs - gapMins && (!prev || e > prev._e)) { prev = r; prev._e = e; }
    }
    if (!prev) return null;
    const dl = require('./devicelog');
    const last = dl.lastEver(dl.irKey(device));
    if (last) return last.op === 'on' ? { prev, last } : null;
    const on = dbModule.db.prepare(`SELECT status FROM automation_jobs WHERE booking_id=? AND kind='ir_on' AND device_key=?`).get(prev.id, jobKey || device.ip);
    return on && on.status === 'done' ? { prev, last: { source: 'automation', at: '' } } : null;
  } catch { return null; }
}

// Is there a lock to mint a code on? RemoteLock needs its client id, UniFi its
// console host and token; a PASTE placeholder is not configured.
function lockConfigured(cfg) {
  // ONE ANSWER TO "IS THERE A LOCK" (feature/door-interface). This used to be
  // the scheduler's own copy of the question and knew RemoteLock and UniFi;
  // the dispatcher knows every provider, including Home Assistant, so ask it.
  try { return require('./doorlock').lockConfigured(); } catch { return false; }
}

// Every booking that still holds a door credential more than twenty minutes past
// its end, whatever its status and however old - a failed revoke, a cancel that
// could not reach the lock, a unit that was off when the session ended. The job
// has no deadline by design (a code must ALWAYS eventually be revoked), so this
// retries for as long as it takes, and what it cannot do the owner is told about
// (services/unithealth 'doorcodes').
// A booking's end as a Date, tolerating the out-of-range hours a cross-midnight
// extension writes ("25:30" on a 24-hour facility): those roll into the next day.
// They used to make this return an Invalid Date, and an unparseable end meant the
// credential was silently skipped by the sweep for ever.
/** How long after a session a door code stays alive - the OWNER's setting, the
 *  same number codeWindow puts on the console, so the unit never tells the door
 *  one time and enforces another. (maintainer's ruling, Sep 16 2026.) */
function revokeLagMs() {
  // ONE RESOLVER (Sep 17 2026) - doorlock.codeWindowMins is the same number
  // codeWindow puts on the console. This used to work it out again here, and
  // disagreed with codeWindow on a unit whose legacy doorCodeBufferMins was 0
  // or blank.
  return Math.max(0, require('./doorlock').codeWindowMins().lag) * 60000;
}

// ONE end-of-booking for the whole tree (services/doorlock.bookingEndDate). This was a
// second copy of the same midnight-plus-minutes arithmetic, an hour wrong on both
// days a year the clocks change (Sep 24 2026).
function bookingEndDate(b) { return require('./doorlock').bookingEndDate(b); }
// Is a session on, or does one start within 30 minutes? (the night install waits for quiet - rule 44)
function sessionOnOrNear(now = new Date()) {
  const rows = dbModule.db.prepare(`SELECT date, start_time, end_date, end_time FROM bookings WHERE status IN ('active','pending') AND (date >= ? OR end_date >= ?)`)
    .all(...(() => { const d = new Date(now.getTime() - 86400000); const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [ymd, ymd]; })());
  const soon = now.getTime() + 30 * 60000;
  for (const b of rows) {
    const day = String(b.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/), m = String(b.start_time || '').match(/^(\d{1,2}):(\d{2})/);
    if (!day || !m) continue;
    const start = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(m[1]), Number(m[2]));
    const end = bookingEndDate(b) || new Date(start.getTime() + 60 * 60000);
    if (start.getTime() <= soon && end.getTime() > now.getTime()) return true;
  }
  return false;
}
async function liveDoorCredentials(now = new Date()) {
  try {
    const rows = dbModule.db.prepare(
      `SELECT id, bay_id, bay_name, date, end_date, end_time, status, remotelock_person_id
         FROM bookings WHERE remotelock_person_id IS NOT NULL AND remotelock_person_id <> ''`).all();
    // A cancel or a move that could not reach the lock leaves a revoke job behind:
    // that credential must go NOW, whatever the booking's own end time says.
    let decided = new Set();
    // ...but only a revoke that is DUE (Sep 25 2026, the Monday review): the tick schedules a
    // revoke for the end of every session holding a code, so "pending" alone put every live
    // code on this list, the five slots below filled with codes not due yet, and a cancelled
    // booking's revoke (brought forward to now) waited behind them on a busy night.
    const nowIso = now.toISOString().replace('T', ' ').slice(0, 19);
    try { decided = new Set(dbModule.db.prepare(`SELECT booking_id FROM automation_jobs WHERE kind='door_revoke' AND status IN ('pending','failed') AND due_at <= ?`).all(nowIso).map(r => r.booking_id)); } catch {}
    const out = [];
    for (const b of rows) {
      if (decided.has(b.id)) { out.push(b); continue; }
      const end = bookingEndDate(b);
      // An end we cannot read is NOT a reason to leave a code live: treat it as due,
      // because the credential exists and something must take it back.
      if (!end) { out.push(b); continue; }
      // THE OWNER'S NUMBER, NOT OURS (maintainer's ruling, Sep 16 2026). The owner is
      // asked how long a code should keep working after a session
      // (cfg.booking.doorCodeLagMins, 0-240 on the Door Access card) and we send
      // that to the console - then this line revoked at end+20 regardless. On a
      // facility that asked for 60 the unit told the console one time and
      // enforced another; on one that asked for 0 the code outlived its session
      // by twenty minutes with nothing saying so. One number now, and it is theirs.
      if ((now.getTime() - end.getTime()) > revokeLagMs()) out.push(b);
    }
    return out;
  } catch { return []; }
}
// At most this many locks are driven per tick. The first tick after this shipped on
// a unit that has been running for months could otherwise walk every stale pointer
// in one minute; the rest are taken on the ticks after, oldest first.
const DOOR_SWEEP_PER_TICK = 5;
async function sweepLiveDoorCodes(cfg, now = new Date()) {
  const all = await liveDoorCredentials(now);
  if (!all.length) return { checked: 0, revoked: 0, failed: 0, waiting: 0 };
  // oldest first: the code that has been live longest is the one to take back first,
  // and it is the one an owner would ask about.
  all.sort((x, y) => { const a = bookingEndDate(x), b = bookingEndDate(y); return (a ? a.getTime() : 0) - (b ? b.getTime() : 0); });
  const rows = all.slice(0, DOOR_SWEEP_PER_TICK);
  const out = { checked: rows.length, revoked: 0, failed: 0, waiting: all.length - rows.length };
  for (const b of rows) {
    const end = bookingEndDate(b) || now;
    automation.ensureJob({ booking_id: b.id, kind: 'door_revoke', due_at: new Date(end.getTime() + revokeLagMs()) });
    if (!automation.claim(b.id, 'door_revoke')) continue;
    const ok = await automation.run(b.id, 'door_revoke', '', async () => {
      // THE REVOKE REPORTS (A-wave 11b). It never throws - the providers log their
      // own errors and resolve - so before this read the sweep cleared the pointer
      // and wrote DOOR_CODE_REVOKED whether or not the lock had ever heard of it,
      // which destroyed the only record that a code was still live and turned the
      // health signal green on a door a customer could still open.
      const res = await revokeDoorCode(b.remotelock_person_id, { forBookingId: b.id });
      if (!res || res.ok !== true) throw new Error('the lock did not take the code back: ' + ((res && res.error) || 'no answer'));
      // updated_at is deliberately NOT touched: bumping it on a months-old row puts
      // that booking back inside the scheduler's completed-in-the-last-hour window
      // and inflates every "in the last 30 days" number the owner reads.
      dbModule.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL WHERE id=?`).run(b.id);
      // a member's PIN kept for their next booking is not a revoke - the provider logged DOOR_CODE_KEPT
      // and the owner must not read "revoked" beside it (Sep 26 2026, the bench)
      // the ordinary removal is this sweep too, at the end plus the owner's lag (Oct 3 2026): only a code taken back
      // well after that is called late, so a normal end of session no longer reads like a fault in the Log
      const lateMins = Math.round((Date.now() - end.getTime() - revokeLagMs()) / 60000);
      // a CANCELLED booking's code taken back after a refusal is not "the session is over" - it never happened (the review)
      const cancelledNow = (() => { try { return (dbModule.db.prepare(`SELECT status FROM bookings WHERE id=?`).get(b.id) || {}).status === 'cancelled'; } catch { return false; } })();
      if (!res.kept) adminLog('DOOR_CODE_REVOKED', `Booking: ${b.id} (` + (cancelledNow && lateMins <= 5 ? 'the booking was cancelled' : lateMins > 5 ? `the sweep - this code outlived its session by ${lateMins} min` : 'the session is over') + ')');
    });
    if (ok) out.revoked++; else out.failed++;
  }
  return out;
}

// ── A-WAVE 12: A FAILURE IS NEVER RECORDED AS A SUCCESS (maintainer, Sep 13 2026) ──
// The audit after the door incident found the same shape fifteen times over: the
// product drives a device or a sender, throws the answer away, marks the job done
// and writes SHELLY_ON / BROADLINK_ON / HA_ON / SHUTDOWN_SENT into the owner's log
// - whatever the thing on the other end actually said. None of these modules throw;
// they all RETURN their outcome, and nobody read it. So the owner's log has been an
// account of what the unit tried, not of what happened, and the health panel saw
// nothing because the job was 'done'.
//
// mustHaveWorked throws when the answer says it did not work, which is exactly what
// automation.run() needs to fail the job, back it off, retry it and surface it.
// Shapes, read from the modules rather than assumed (services/shelly.js:28/32,
// services/broadlink.js:45-54, services/homeassistant.js:149/152,
// services/simulator.js:142/60):
//   shelly.controlDevice  -> { success, error }        never throws
//   broadlink.sendCommand -> { success?, error? }      never throws
//   homeassistant         -> { success, error }        never throws
//   simulator.sendShutdown-> true | false              never throws
// A message job succeeds when at least ONE channel the booking actually has
// delivered. A channel that was not applicable (no consent, the owner turned that
// notification off, no address) returns undefined and is not counted either way.
// Before this, both senders could return { success:false } and the job was still
// marked done with sms_reminder_sent=1 / sms_code_sent=1 on the row - so the unit
// recorded a text it never sent, and nothing retried it.
function deliveredAny(what, results) {
  const attempted = results.filter(r => r !== undefined && r !== null);
  if (!attempted.length) return { delivered: false, attempted: 0 };
  const ok = attempted.some(r => r === true || (typeof r === 'object' && r.success === true));
  if (!ok) {
    // name the channel that actually refused, rather than blaming the email for a
    // text that failed
    const why = attempted.map(r => (r && r.error) ? ('the text: ' + r.error) : (r === false ? 'the email did not send' : (r && r.success === false ? 'the text refused' : 'refused'))).join('; ');
    throw new Error(what + ': nothing reached the customer - ' + why.slice(0, 200));
  }
  return { delivered: true, attempted: attempted.length };
}

/** The owner is TOLD when a door code needs them (feature/door-interface): the
 *  log always, and the facility email when one is set. Never throws. */
function alertOwnerDoor(booking, event, text) {
  try { adminLog(event, `Booking: ${booking.id} | ${text}`); } catch {}
  // THROUGH THE ONE ALERT SERVICE (Oct 3 2026, the pack review): this emailed the contact address raw "<p>...</p>" as plain
  // text, never texted the owner's mobile, and went again on every retry of the text job. services/owneralert: the owner's
  // mobile and email, in plain words, once per booking every six hours - a customer may be standing at the door.
  try {
    const who = `${booking.name || 'A customer'} (${booking.date} ${booking.start_time}${booking.bay_name ? ', ' + booking.bay_name : ''})`;
    Promise.race([require('./owneralert').alert('door:' + booking.id, `${who}: ${text}`), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  } catch {}
}

/**
 * A CANCELLED SESSION'S SWITCH-OFFS ARE SETTLED, NEVER LEFT (Sep 25 2026, the build review).
 * A cancel keeps a booking's plug-off, TV-off and PC shutdown on purpose (they make a bay safe),
 * but only the tick claims them and the tick walks active bookings - so they sat pending for ever:
 * Automation red ("queued but never claimed - restart the unit", which changed nothing), hiding
 * the new unplugged-plug line, and a cancel made after the bay was switched on never switched it
 * off. Every tick, each such row is settled now, whatever the cancel path was:
 *   - the device was never switched on for this booking (its ON did not run, or for a PC it was
 *     not woken and the session had not begun) -> skipped, nothing sent. A toggle TV sent "off"
 *     that was never switched on would come ON.
 *   - it was -> sent now, unless another session is using the device (that session owns it) or,
 *     for a toggle TV, the ledger says it is already off.
 */
// THE SWITCH-OFFS NOTHING ELSE WILL CLAIM (Oct 21 2026, the device audit; maintainer: "all automation needs to work weather another one
// didnt work or not"). A booking's device jobs are made a day or two ahead and only its own pass claims them - and that pass
// skips a bay taken out of service or blocked, a device removed or set to stay on, a changed address, Home Assistant switched
// off, and a session finished more than about two and a half hours ago. Each such job sat "overdue - queued but never claimed"
// for ever (the health line red, its advice "restart the unit"), and the heater on a bay taken out of service mid-day was never
// switched off. With { orphans: true } (the end of every tick) this settles them the cancelled-booking way: a job its booking's
// own pass has not taken fifteen minutes past its time is switched off if its device is still set up to be (whatever the bay's
// state - a heater goes off on an out-of-service bay too), and otherwise written off with the reason; a switch-ON for a bay
// that is dark on purpose is written off as not applicable (rule 31), never missed.
async function sweepCancelledCleanup(cfg, now = new Date(), opts = {}) {
  const orphans = !!opts.orphans;
  let rows = [];
  try {
    // a row never tried is settled at once, whatever its due time; one that failed waits for its backoff
    // ...and a bay a session was MOVED off (automation.queueLeftBay, Oct 3 2026): its rows are keyed 'left:<bay>|<key>'
    rows = orphans
      ? dbModule.db.prepare(`SELECT j.booking_id, j.kind, j.device_key, j.attempts, j.due_at FROM automation_jobs j JOIN bookings b ON b.id = j.booking_id
          WHERE b.status IN ('active','completed') AND j.device_key NOT LIKE 'left:%'
            AND ((j.kind IN ('power_off','ir_off','shutdown') AND j.status IN ('pending','failed')) OR (j.kind IN ('power_on','ir_on') AND j.status='pending'))
            AND COALESCE(j.next_attempt_at, j.due_at) <= datetime('now', '-15 minutes')
          ORDER BY CASE j.kind WHEN 'shutdown' THEN 0 ELSE 1 END, j.id LIMIT 20`).all()
      : dbModule.db.prepare(`SELECT j.booking_id, j.kind, j.device_key, j.attempts FROM automation_jobs j JOIN bookings b ON b.id = j.booking_id
          WHERE (b.status IN ('cancelled','expired') OR j.device_key LIKE 'left:%') AND j.kind IN ('power_off','ir_off','shutdown')
            AND ((j.status='pending' AND j.attempts=0) OR (j.status IN ('pending','failed') AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= datetime('now'))))
          ORDER BY CASE j.kind WHEN 'shutdown' THEN 0 ELSE 1 END, j.id LIMIT 20`).all();
  } catch { return 0; }
  const haCfg = cfg.homeAssistant || {};
  const haReady = !!(haCfg.enabled && haCfg.url && haCfg.token && !String(haCfg.token).startsWith('PASTE'));
  const dl = require('./devicelog');
  const jobStatus = (id, kind, key) => { try { const r = dbModule.db.prepare(`SELECT status FROM automation_jobs WHERE booking_id=? AND kind=? AND device_key=?`).get(id, kind, key || ''); return r ? r.status : null; } catch { return null; } };
  let n = 0;
  for (const j of rows) {
    try {
      const booking = dbModule.db.prepare(`SELECT * FROM bookings WHERE id=?`).get(j.booking_id);
      if (!booking) continue;
      // a bay the session left: that bay's device, whatever bay the booking is on now; the job keeps its own key
      const left = /^left:([^|]*)\|(.*)$/.exec(j.device_key || '');
      const key = left ? left[2] : j.device_key;
      const why = left ? 'the session moved to another bay' : orphans ? 'its switch-off was left waiting after the bay or the device changed' : 'the booking was cancelled';
      const bays = left ? (cfg.bays || []).filter(b => b.id === left[1]) : booking.whole_facility ? (cfg.bays || []) : (cfg.bays || []).filter(b => b.id === booking.bay_id);
      const begun = (() => { const s = new Date(`${booking.date}T${booking.start_time}:00`).getTime(); return Number.isFinite(s) && s <= now.getTime(); })();
      const never = why => { automation.skip(j.booking_id, j.kind, j.device_key, why); try { dbModule.db.prepare(`UPDATE automation_jobs SET status='skipped', last_error=? WHERE booking_id=? AND kind=? AND device_key=? AND status='failed'`).run(why, j.booking_id, j.kind, j.device_key || ''); } catch {} n++; };
      const fire = async (fn) => { if (!j.attempts) automation.dueNow(j.booking_id, j.kind, j.device_key); if (automation.claim(j.booking_id, j.kind, j.device_key)) { await automation.run(j.booking_id, j.kind, j.device_key, fn); n++; } };
      // moved back onto the bay it left: that bay is its own again - nothing of it is switched off under the group
      if (left && booking.status === 'active' && (booking.bay_id === left[1] || booking.whole_facility)) { never('the session moved back to this bay'); continue; }
      // a switch-ON left waiting: its bay's own pass decides it while the bay is driven; a bay dark on purpose, or a device
      // taken away, had nothing to switch on (rule 31) - written off with the reason, never missed
      if (orphans && (j.kind === 'power_on' || j.kind === 'ir_on')) {
        const has = (b) => j.kind === 'ir_on' ? (b.broadlinkDevices || []).some(d => d && d.ip && d.onCommand && irJobKey(b, d) === key)
          : /^wol(:|$)/.test(key) ? !!b.pcMac && (key === 'wol' || key === 'wol:' + b.id)
          : /_ha$/.test(key) ? (b.haDevices || []).some(d => d && (d.entity_id + '_ha') === key)
          : (b.shellyDevices || []).some(d => d && d.ip === key);
        if (/_ha$/.test(key) && require('./facilitydevices').has(cfg, key.replace(/_ha$/, ''))) { never('the device is the whole facility\'s now - its own times decide it'); continue; }
        if (require('./bookingcore').baysToDrive(booking).some(has)) continue;
        never((cfg.bays || []).some(has) ? 'its bay is out of service or blocked - nothing was switched on' : 'the device is no longer set up');
        continue;
      }
      if (j.kind === 'shutdown') {
        // Auto-Shutdown switched off is the owner's choice (rule 31): a shutdown made while it was on is written off, never sent
        // (the pack review, Oct 24 2026: this sweep shut the PCs down for a day after the owner turned it off)
        if (!(cfg.shutdown && cfg.shutdown.enabled)) { never(why + ' and Auto-Shutdown is switched off'); continue; }
        const pcBays = bays.filter(b => String((b && b.simulatorPcIp) || '').trim());
        // a left bay's PC was queued only when it had been woken or the session had begun (bookingedit)
        const woke = left || (() => { try { return !!dbModule.db.prepare(`SELECT 1 FROM automation_jobs WHERE booking_id=? AND kind='power_on' AND device_key LIKE 'wol%' AND status='done'`).get(j.booking_id); } catch { return false; } })();
        if (!pcBays.length) { never(why + ' and no bay it had has a PC to shut down'); continue; }
        if (!woke && !begun) { never(why + ' before its PC was woken'); continue; }
        const inUse = pcBays.filter(b => deviceBayBusy(b.id, booking.id, now));
        if (inUse.length === pcBays.length) { never(why + ' and another session is using the bay'); continue; }
        await fire(async () => {
          // each PC on its own: one that refuses never stops the others' shutdowns (Oct 21 2026, the device audit); the job retries
          const sdFailed = [];
          for (const b of pcBays.filter(x => !inUse.includes(x))) { try { mustHaveWorked(`shutdown ${b.name}`, await sendShutdown(b, 0)); } catch (e) { sdFailed.push(`${b.name}: ${e.message}`); } }
          if (sdFailed.length) throw new Error(`shutdown failed on ${sdFailed.length} bay(s): ${sdFailed.join('; ')}`.slice(0, 300));
          adminLog('SHUTDOWN_SENT', `Bay: ${left ? pcBays.map(b => b.name).join(', ') : booking.bay_name} | ${why}`);
          // the booking's own shutdown is still to come on the bay it moved to - only a cancel marks it sent
          if (!left) dbModule.db.prepare(`UPDATE bookings SET shutdown_sent=1 WHERE id=?`).run(booking.id);
        });
        continue;
      }
      if (j.kind === 'ir_off') {
        const bay = bays.find(b => (b.broadlinkDevices || []).some(d => d.ip && irJobKey(b, d) === key));
        const device = bay && (bay.broadlinkDevices || []).find(d => d.ip && irJobKey(bay, d) === key && d.offCommand);
        if (!device) { never(why + ' and this TV is no longer set up'); continue; }
        if (!device.turnOffAfter) { never(why + ' and this TV is set to stay on'); continue; }
        // a ONE-BUTTON (toggle) code is never sent late (rule 16): a switch-off left waiting more than two hours could switch a
        // TV that is off by now back ON - the command ledger is trusted for two hours only
        if (orphans && irCodeStyle(device) === 'toggle' && Date.parse(String(j.due_at || '').replace(' ', 'T') + 'Z') < now.getTime() - 2 * 3600000) { never(why + ' more than two hours ago, and this TV\'s code is a toggle - a late "off" could switch it on'); continue; }
        const onRan = jobStatus(j.booking_id, 'ir_on', j.device_key) === 'done';
        if (!onRan) { never(why + ' before the TV was switched on'); continue; }
        if (dl.toggleAlready(device, 'off')) { never(why + ' and the TV is already off (the command ledger)'); continue; }
        if (deviceLiveNow(cfg, now, { type: 'broadlink', key: device.ip }, booking.id) || heldByOther('ir_on', key, booking.id, now)) { never(why + ' and another session is using this TV'); continue; }
        await fire(async () => {
          ledgered(dl.irKey(device), bay.id, 'off', `IR ${device.name} off`, await sendCommand(device.ip, device.offCommand));
          adminLog('BROADLINK_OFF', `${device.name} | Booking: ${booking.id} | ${why}`);
        });
        continue;
      }
      // THE PC FIRST, ITS POWER AFTER (Oct 3 2026, the inventory's critic): the plug-off and the PC shutdown went in the
      // same tick, plug first (job order), so a PC on a plug set to switch off lost its power mid-shutdown - the bay
      // buttons' Off waits for the PC (services/sequence.js). A switch-off waits while this booking's shutdown is still
      // to go, and for two minutes after it went; it is left as it is (not settled) and the next tick looks again.
      // ...and only while the shutdown can still be on its way (the review, Oct 3 2026): not yet tried, or a tick holding
      // its lease right now, or sent under two minutes ago. A shutdown the PC refused (it backs off for half an hour) or a
      // lease left behind by a restart held every plug and Home Assistant device of the booking with it - for ever.
      const pcGoingDown = (() => {
        try {
          const r = dbModule.db.prepare(`SELECT status, fired_at, attempts, lease_until FROM automation_jobs WHERE booking_id=? AND kind='shutdown' AND device_key=?`).get(j.booking_id, left ? `left:${left[1]}|` : '');
          if (!r) return false;
          const at = v => Date.parse(String(v || '').replace(' ', 'T') + 'Z');
          if (r.status === 'pending') return !r.attempts;
          if (r.status === 'running') return Number.isFinite(at(r.lease_until)) && at(r.lease_until) > now.getTime();
          return r.status === 'done' && Number.isFinite(at(r.fired_at)) && now.getTime() - at(r.fired_at) < 120000;
        } catch { return false; }
      })();
      if (pcGoingDown) continue;
      // power_off: a Shelly plug (keyed by its ip) or a Home Assistant device (entity_id + '_ha')
      const isHa = /_ha$/.test(key);
      const onRan = jobStatus(j.booking_id, 'power_on', j.device_key) === 'done';
      if (isHa) {
        const entity = key.replace(/_ha$/, '');
        const bay = bays.find(b => (b.haDevices || []).some(d => d.entity_id === entity));
        const device = bay && (bay.haDevices || []).find(d => d.entity_id === entity);
        if (!device) { never(why + ' and this Home Assistant device is no longer set up'); continue; }
        // on the whole facility's own list now: the facility's times decide it - one bay's switch-off never turns
        // down the building's heat or the lounge TV (services/facilitydevices)
        if (require('./facilitydevices').has(cfg, entity)) { never(why + ' and the device is the whole facility\'s now - its own times decide it'); continue; }
        // Home Assistant switched off is nothing to retry (rule 31 - the device audit: it retried "not enabled" for ever)
        if (!haReady) { never(why + ' and Home Assistant is switched off'); continue; }
        if (!(device.kind === 'climate' ? device.ecoTemp != null : device.turnOffAfter)) { never(why + ' and this device is set to stay on'); continue; }
        if (!onRan) { never(why + ' before the device was switched on'); continue; }
        if (deviceLiveNow(cfg, now, { type: 'ha', key: entity }, booking.id) || heldByOther('power_on', key, booking.id, now)) { never(why + ' and another session is using this device'); continue; }
        await fire(async () => {
          const res = device.kind === 'climate'
            ? ledgered('ha:' + entity, bay.id, 'off', `Home Assistant ${device.name || entity} setback`, await haService.setClimate(entity, haService.climateTargets(device).eco))
            : ledgered('ha:' + entity, bay.id, 'off', `Home Assistant ${device.name || entity} off`, await haService.setEntity(entity, false));
          haSaid(res, 'HA_OFF', `${device.name || entity} | Booking: ${booking.id} | ${why}`);
        });
        continue;
      }
      const bay = bays.find(b => (b.shellyDevices || []).some(d => d.ip === key));
      const device = bay && (bay.shellyDevices || []).find(d => d.ip === key);
      if (!device) { never(why + ' and this plug is no longer set up'); continue; }
      if (!device.turnOffAfter) { never(why + ' and this plug is set to stay on'); continue; }
      if (!onRan) { never(why + ' before the plug was switched on'); continue; }
      if (deviceLiveNow(cfg, now, { type: 'shelly', key: device.ip }, booking.id) || heldByOther('power_on', device.ip, booking.id, now)) { never(why + ' and another session is using this plug'); continue; }
      await fire(async () => {
        ledgered('shelly:' + device.ip, bay.id, 'off', `Shelly ${device.name} off`, await controlDevice(device.ip, device.gen || 2, false));
        adminLog('SHELLY_OFF', `${device.name} | Booking: ${booking.id} | ${why}`);
      });
    } catch (e) { try { adminLog('AUTOMATION_ERROR', `cancelled-booking switch-off ${j.kind} | Booking: ${j.booking_id}: ${String(e.message).slice(0, 120)}`); } catch {} }
  }
  return n;
}
// another active session on this bay right now, or its PC already woken for one about to start
function deviceBayBusy(bayId, excludeBookingId, now) {
  try {
    const n = nowAbsMins(now);
    const since = padDate(new Date(now.getTime() - 86400000));
    const rows = dbModule.db.prepare(`SELECT b.date, b.start_time, b.end_time, b.end_date,
        (SELECT MAX(status) FROM automation_jobs WHERE booking_id=b.id AND kind='power_on' AND device_key LIKE 'wol%' AND status IN ('done','running')) AS wol
      FROM bookings b WHERE b.status='active' AND b.id<>? AND (b.bay_id=? OR b.whole_facility=1) AND b.date >= ?`).all(excludeBookingId || '', bayId, since);
    return rows.some(r => absEndOf(r) > n && (absStartOf(r) <= n || r.wol === 'done' || r.wol === 'running'));
  } catch { return false; }
}

// THE COMMAND LEDGER (Sep 25 2026, services/devicelog): what the scheduler sent to a bay device,
// and whether it took it, beside what a person sent with the bay buttons - read by both before a
// toggle TV is sent a command it has already had.
function ledgered(device, bayId, op, what, res) {
  let err = null;
  try { mustHaveWorked(what, res); } catch (e) { err = e; }
  if (!(res && typeof res === 'object' && res.skipped)) require('./devicelog').record({ device, bayId, op, source: 'automation', ok: !err, detail: err ? err.message : '' });
  if (err) throw err;
  return res;
}
// what the owner's log says about a Home Assistant step: what was done, or - a thermostat someone switched off, or one
// running itself in auto - why nothing was sent (a step that does not apply is never written up as done, rule 31)
function haSaid(res, event, detail) {
  if (res && typeof res === 'object' && res.skipped) adminLog('HA_NOT_SENT', `${detail} | ${res.reason || 'nothing to send'}`);
  else adminLog(event, detail + (res && res.mode ? ` | ${res.mode} ${res.sent}°` : ''));
}
function mustHaveWorked(what, res) {
  if (res === true) return res;
  if (res === false || res === null || res === undefined) throw new Error(what + ': the device did not answer');
  if (typeof res === 'object') {
    if (res.success === true) return res;
    if (res.skipped) return res;                    // nothing configured for this bay is not a failure
    if (res.success === false || res.error) throw new Error(what + ': ' + (res.error || 'the device refused'));
  }
  return res;
}

// A ONE-TIME REPAIR FOR SKIPS THE OLD CODE MADE TOO EARLY (Sep 25 2026, maintainer's item 5; pilot facility found
// five such cases before anyone noticed). A unit updated to this code may hold a TV ON cancelled
// hours before it was due, or an OFF written off before its next session was cancelled. Every
// such skip for a booking that has not happened yet goes back to pending, to be decided at its
// due moment like every skip now. Past ones are left alone - their moment has gone.
const EARLY_SKIP_REASONS = ['another session needs this device', 'a session is already running on this device and the code is a toggle - sending "on" would switch it off',
  'a new booking took this bay - prior shutdown cancelled'];   // (the build review: any online booking wrote off the bay's switch-offs, whatever its date)
function reopenEarlySkips() {
  try {
    const D = dbModule.db;
    const WHERE = `status='skipped' AND kind IN ('ir_on','ir_off','power_off','shutdown') AND last_error IN (${EARLY_SKIP_REASONS.map(() => '?').join(',')})
      AND due_at > datetime('now') AND booking_id IN (SELECT id FROM bookings WHERE status='active')`;
    const n = (D.prepare(`SELECT COUNT(*) AS n FROM automation_jobs WHERE ${WHERE}`).get(...EARLY_SKIP_REASONS) || {}).n || 0;
    if (!n) return 0;
    D.prepare(`UPDATE automation_jobs SET status='pending', last_error='' WHERE ${WHERE}`).run(...EARLY_SKIP_REASONS);
    adminLog('AUTOMATION_REOPENED', `${n} device job(s) skipped before they were due were put back, to be decided when they are due`);
    return n;
  } catch (e) { console.error('reopen early skips:', e.message); return 0; }
}

const notifSkipSaid = new Set();   // key|booking pairs whose skip is already in the owner's log
async function checkBookings() {
  const now  = new Date();
  const cfg  = getConfig();
  // THE FACILITY'S OWN DEVICES (Oct 21 2026): the heat and AC, a lounge TV - on before the first booking in
  // any bay, kept on while the next one is near, standby when nothing is (services/facilitydevices). Started first and
  // never waited on: a thermostat or a TV that is slow to answer, or down, holds up no bay (maintainer: "if a thermostat or facility
  // tv does not turn on the bay still needs to do all its stuff").
  try { require('./facilitydevices').tick(cfg, now).catch(e => console.error('facility devices:', e.message)); } catch (e) { console.error('facility devices:', e.message); }
  // a bay's routines that run when its sessions start or end, or at a time of day (Oct 21 2026; services/
  // routines.js) - asked for here, run by the bay PC's watcher; never holds up the minute
  try { require('./routines').tick(cfg, now); require('./routines').settleStale(); } catch (e) { console.error('routines:', e.message); }
  try { automation.dropOrphanedJobs(); } catch {}   // Sep 12 2026: a cancelled booking's leftover jobs go with it, every tick
  try { automation.retireUnreachable(); } catch {}  // Sep 24 2026: a job past its deadline whose booking finished is missed, never overdue for ever
  // A-wave 11 (maintainer, Sep 13 2026): A DOOR CODE MUST NEVER OUTLIVE ITS SESSION.
  // The revoke used to be reachable only from the booking loop, which walks
  // active bookings and the hour after one completes - so a revoke that failed
  // while the lock was unreachable could never be retried by anything, and
  // Retry could only say so honestly. This sweep is the thing that outlives the
  // session: it reads the bookings that STILL HOLD a credential whatever their
  // status or age, and drives the same idempotent revoke until it succeeds.
  // a door removal whose code is already off the lock is deleted, not left waiting (Sep 27 2026)
  try { automation.dropSpentDoorRevokes(); } catch (e) { console.error('spent door revokes:', e.message); }
  try { await sweepLiveDoorCodes(cfg, now); } catch (e) { console.error('door-code sweep:', e.message); }
  // the door lock through Home Assistant: is it answering, and if it just came back, put it right
  // (services/hadoor.watch - Sep 26 2026)
  try { if (String((cfg.doorAccess || {}).provider || '').toLowerCase() === 'ha') { const hd = require('./hadoor'); if (hd.configured()) await hd.watch({ now: now.getTime() }); } } catch (e) { console.error('door lock watch:', e.message); }
  try { await sweepCancelledCleanup(cfg, now); } catch (e) { console.error('cancelled switch-offs:', e.message); }
  const sms  = cfg.sms || {};
  // Notification toggles live under cfg.resend (that's what the admin panel
  // writes) but were historically read from cfg.sms - honor BOTH so no
  // owner's checkbox is silently ignored.
  // A MESSAGING SWITCH STOPS ITS OWN MESSAGE AND NOTHING ELSE (Sep 25 2026, the pilot facility
  // handoff's section 7). This used to require BOTH the text and the email switch, so
  // unticking the reminder EMAIL stopped the reminder TEXT too (and the other way round),
  // and unticking the "Door Code" email box stopped door codes being CREATED at all -
  // one untick locked every customer out. The job runs when either channel is on; each
  // sender checks its own switch (sms.js / email.js). A door code does not ask this at
  // all: whether the lock gets a code never depends on how the customer is told
  // (/my-booking shows it either way).
  // #4 (pilot facility rebase): absent keys default ON (never silent-off). When BOTH channels are
  // explicitly off, the skip is logged so a mis-provisioned unit is diagnosable.
  // ONE LINE PER BOOKING, NOT ONE A MINUTE (Sep 25 2026, the Monday review): this is asked
  // on every tick for every booking in the window, so an owner who turned a message off got
  // a row in their log per booking per minute. The skip is still said, once.
  const notif = (key, bookingId) => {
    const on = sms[key] !== false || cfg.resend?.[key] !== false;
    if (!on) {
      const k = key + '|' + (bookingId || '');
      if (!notifSkipSaid.has(k)) {
        if (notifSkipSaid.size > 5000) notifSkipSaid.clear();
        notifSkipSaid.add(k);
        try { require('./db').adminLog('NOTIFY_SKIPPED', key + ' is turned off for both text and email' + (bookingId ? ' | Booking: ' + bookingId : '')); } catch {}
      }
    }
    return on;
  };
  const staffed = !!cfg.booking?.staffedAccess;

  const today     = padDate(now);
  const yesterday = padDate(new Date(now.getTime() - 86400000));
  const tomorrow  = padDate(new Date(now.getTime() + 86400000));
  // Include yesterday so a session that started last night and crossed midnight
  // is still tracked for its device-OFF / shutdown after midnight.
  const bookings = getUpcomingBookings([yesterday, today, tomorrow]);

  for (const booking of bookings) {
    // ONE BAD ROW ENDS ONE BOOKING'S PASS, NEVER THE WHOLE TICK (maintainer, Sep 21 2026,
    // pilot facility's section 3 - the outage that started their audit). A maintenance
    // block carried a time their scheduler could not read, toMinsOfDay(null)
    // threw, this loop had no catch, and the throw ended the ENTIRE tick: every
    // booking after that row, the cancelled-OFF sweep, the lapsed-hold sweep and
    // mark-complete all stopped, on every tick, for days - while every battery
    // stayed green, because they ran on a clean database.
    // Our toMinsOfDay throws on a null exactly the same way (it splits a string
    // that is not there), and absStartOf/absEndOf run it over OTHER bookings on
    // the bay, so one unreadable row anywhere on a bay could take the tick down.
    // The row is named in the owner's log and the next booking runs as if
    // nothing happened.
    try {
      // Maintenance blocks take a bay offline but must NEVER drive automation -
      // no power-on, no door code, no shutdown sequence. Event/tournament blocks
      // still power the bay (someone is using it). (Admin bay-blocking, Aug 15.)
      if (booking.booking_type === 'maintenance') continue;
      const startDt      = new Date(`${booking.date}T${booking.start_time}:00`);
      const endDt        = bookingEndDate(booking) || new Date(`${booking.end_date || booking.date}T${booking.end_time}:00`);
      // A-wave 3 (Sep 11 2026, found by the automation gate on the seeded bench): a
      // booking ENTERED AFTER ITS OWN END - yesterday's walk-in typed in for the
      // records, a seeded history row - was never a live session for this unit.
      // It used to get the jobs that carry no deadline (plug off, TV off) created
      // and fired on the spot, sending "off" to a bay's devices for a session that
      // ended before the row existed, and four "missed" rows for the rest. Nothing
      // is scheduled for it. A booking entered late but still running (the
      // catch-up path) has its end ahead and is untouched by this.
      if (booking.created_at) {
        const createdMs = Date.parse(String(booking.created_at).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(booking.created_at)) ? '' : 'Z'));
        if (Number.isFinite(createdMs) && createdMs > endDt.getTime()) continue;
      }
      const minutesUntil = (startDt - now) / 60000;
      const minutesPast  = (now - endDt)   / 60000;

      // ── REMINDER ─────────────────────────────────────────────────────────
      const reminderMins = sms.reminderMinsBefore || 60;
      // A REMINDER SAYS THE MINUTES THAT ARE LEFT, AND A BOOKING MADE INSIDE ITS OWN REMINDER WINDOW GETS
      // NONE (Oct 2026; maintainer, Sep 26: "on the next-pack list"). An 11:00 booking made at 10:56 was texted
      // "Session starts in 60 min" - the setting, not the time - a minute after its own confirmation. A
      // booking made inside the window has just been told everything (the confirmation); nothing is
      // scheduled for it. A reminder that is merely late (the unit was off) says the minutes actually left.
      const remDue = new Date(startDt.getTime() - reminderMins * 60000);
      // ...AND ONE THAT BECAME A BOOKING ONLY AFTER ITS REMINDER MOMENT (Oct 3 2026, the pack review): a checkout started at
      // 10:58 for 12:00 and paid at 11:01 has created_at before the 11:00 reminder, so it got "Booked!" and then the
      // reminder a minute later. A checkout's moment is when it was paid (confirmed_at), not when it started.
      const utcMs = v => v ? Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z')) : NaN;
      const madeMs = Number.isFinite(utcMs(booking.confirmed_at)) ? utcMs(booking.confirmed_at) : utcMs(booking.created_at);
      // AT the reminder moment is inside the window (Oct 4 2026): made at 2:00:00 for 3:00, it was a second past and got the
      // reminder on top of its confirmation - the pack sweep's one failure, a booking seeded in the first second of a minute
      const bookedInsideWindow = Number.isFinite(madeMs) && madeMs >= remDue.getTime();
      if (!booking.sms_reminder_sent && bookedInsideWindow) {
        automation.skip(booking.id, 'reminder', '', 'booked inside the reminder window - the confirmation was just sent');
      } else if (!booking.sms_reminder_sent && notif('sendReminder', booking.id)) {
        // Due at the configured lead time. Deadline = start, because a
        // "reminder" after the session begins is noise - but it is recorded as
        // skipped, never silently forgotten.
        automation.ensureJob({
          booking_id: booking.id, kind: 'reminder',
          due_at: remDue,
          deadline_at: startDt
        });
        if (automation.claim(booking.id, 'reminder')) {
          await automation.run(booking.id, 'reminder', '', async () => {
            const leftMins = Math.max(1, Math.min(reminderMins, Math.round((startDt.getTime() - Date.now()) / 60000)));
            const rText = await sendReminder(booking, leftMins);
            const rMail = booking.email ? await sendReminderEmail(booking, leftMins) : undefined;
            deliveredAny(`reminder for booking ${booking.id}`, [rText, rMail]);
            dbModule.db.prepare(`UPDATE bookings SET sms_reminder_sent=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
          });
        }
      }

      // ── DOOR CODE (15 min before, or immediately for late bookings) ──────────
      // DOOR CODE - durable job, not a 4-minute window. Due 15 minutes before
      // start; if the Pi was down, the API blipped, or the booking was entered
      // AFTER its own start time, it still fires (catch-up) right up until the
      // session ends. Failures retry with backoff and surface on the health
      // panel instead of dying in a log line.
      // A-wave 4 (Sep 11 2026, maintainer's absent-devices question): a facility with NO
      // lock configured (example facility's shape - no RemoteLock credentials, no UniFi
      // console) used to get a door_code job for every unstaffed booking; the
      // job called the provider, got "not configured", failed after its retries
      // and painted Automation Health red for every booking. A device the
      // facility does not own must never accumulate jobs: no lock, no job.
      if (!staffed && !booking.sms_code_sent && (booking.phone || booking.email) && lockConfigured(cfg)) { // no contact, no code (pilot facility parity); never gated by a messaging switch (above)
        // ── CREATE, CONFIRM, THEN TEXT for a lock that can confirm (feature/door-interface, Sep 21
        // 2026): create at the owner's lead, confirm, and text only when confirm has answered.
        // Every other provider runs main's own block below, unchanged (the classic path).
        const doorlock = require('./doorlock');
        if (!doorlock.confirmFlow(cfg)) {
          // A MEMBER'S ACCESS TURNS ON AT THE OWNER'S "BEFORE" MINUTES (maintainer's ruling 4, Sep 25
          // 2026): their code is their PIN and the door window is the owner's, so the job that
          // turns it on is due when that window opens. Everyone else is texted 15 minutes before,
          // as always (the booking page and the Messaging card both say so).
          const memberDoor = !!booking.member_id && require('./memberaccess').memberAccessOn(cfg);
          const codeLeadMs = memberDoor ? Math.max(0, require('./doorlock').codeWindowMins().lead) * 60000 : 15 * 60000;
          automation.ensureJob({
            booking_id: booking.id, kind: 'door_code',
            due_at: new Date(startDt.getTime() - codeLeadMs),
            deadline_at: endDt
          });
          if (automation.claim(booking.id, 'door_code')) {
            await automation.run(booking.id, 'door_code', '', async () => {
              // A-wave 12b: this job RETRIES now, and generateDoorCode mints a NEW
              // credential every time it runs - so a failed SEND would leave a fresh live
              // code at the lock on every attempt and orphan the last one. Re-read the row
              // and reuse the credential this booking already has.
              const cur = dbModule.db.prepare(`SELECT door_code, remotelock_person_id FROM bookings WHERE id=?`).get(booking.id) || {};
              let pin = cur.door_code, personId = cur.remotelock_person_id;
              if (!pin) {   // a code with no lock reference is still a code - never a second one at the lock (Oct 3 2026)
                const made = await generateDoorCode(booking);
                pin = made.pin; personId = made.personId;
                // the credential is recorded FIRST and always: it exists at the lock now,
                // and the sweep must be able to take it back even if telling the customer
                // fails and this job goes on to retry.
                dbModule.db.prepare(`UPDATE bookings SET door_code=?, remotelock_person_id=?, updated_at=datetime('now') WHERE id=?`)
                  .run(pin, personId, booking.id);
                // ON DISK BEFORE WE GO ON (Sep 16 2026). db writes are SCHEDULED, so a
                // crash or a restart between minting the credential at the lock and the
                // flush leaves a live code with nothing recording it - which is exactly
                // the orphan the nightly check exists to find. This is the same
                // guarantee unifiaccess.syncMember takes for the console user id, and
                // it is the ordinary-operation mechanism that manufactures orphans on a
                // healthy unit; without it the orphan list is something the product
                // creates, not just something an old bug left behind.
                await dbModule.flushed();
              }
              const note = require('./doorlock').doorCodeNote(booking, personId);   // press Enter; member PIN or one-time code
              const dText = await sendDoorCode(booking, pin, note);
              const dMail = booking.email ? await sendDoorCodeEmail(booking, pin, note) : undefined;
              deliveredAny(`door code for booking ${booking.id}`, [dText, dMail]);
              dbModule.db.prepare(`UPDATE bookings SET sms_code_sent=1 WHERE id=?`).run(booking.id);
            });
          }
          // A CODE THE OTHER FLOW MADE (Oct 3 2026, the pack review): an owner who switches create-confirm-text off
          // between a code's creation (their "works BEFORE" lead) and its text time left it stranded - this branch's job
          // is already done (it was the create), so the code that exists was never texted. It goes now, on the same
          // fifteen minutes, from its own text job; the existing code is sent, never a second one made.
          {
            const cur = dbModule.db.prepare(`SELECT door_code, remotelock_person_id, sms_code_sent FROM bookings WHERE id=?`).get(booking.id) || {};
            const dj = dbModule.db.prepare(`SELECT status FROM automation_jobs WHERE booking_id=? AND kind='door_code'`).get(booking.id);
            if (cur.door_code && !cur.sms_code_sent && dj && dj.status === 'done') {
              automation.ensureJob({ booking_id: booking.id, kind: 'door_text', due_at: new Date(startDt.getTime() - codeLeadMs), deadline_at: endDt });
              if (automation.claim(booking.id, 'door_text')) {
                await automation.run(booking.id, 'door_text', '', async () => {
                  const note = require('./doorlock').doorCodeNote(booking, cur.remotelock_person_id);
                  const dText = await sendDoorCode(booking, cur.door_code, note);
                  const dMail = booking.email ? await sendDoorCodeEmail(booking, cur.door_code, note) : undefined;
                  deliveredAny(`door code for booking ${booking.id}`, [dText, dMail]);
                  dbModule.db.prepare(`UPDATE bookings SET sms_code_sent=1 WHERE id=?`).run(booking.id);
                });
              }
            }
          }
        } else {
        const { lead } = doorlock.codeWindowMins();
        // made by the owner's text time when the code carries its own window (RemoteLock, UniFi) - doorlock.createLeadMins
        const createDue = new Date(startDt.getTime() - (booking.member_id && require('./memberaccess').memberAccessOn(cfg) ? lead : doorlock.createLeadMins(cfg)) * 60000);
        // texted at the owner's timing - or when the code exists, if the lead is shorter. A MEMBER
        // whose access is their own PIN is texted when that access turns on, as the Monday pack does
        // (maintainer's ruling 4, Sep 25 2026: their window is the owner's "before" minutes)
        const memberDoor = !!booking.member_id && require('./memberaccess').memberAccessOn(cfg);
        const textDue   = memberDoor ? createDue : new Date(startDt.getTime() - doorlock.effectiveTextLeadMins(cfg) * 60000);
        const rowNow = () => dbModule.db.prepare(`SELECT * FROM bookings WHERE id=?`).get(booking.id) || {};
        const setState = (state) => dbModule.db.prepare(
          `UPDATE bookings SET door_code_state=?, door_code_polls=COALESCE(door_code_polls,0)+1, door_code_polled_at=datetime('now') WHERE id=?`).run(state, booking.id);

        // 1. CREATE + the first CONFIRM. The kind keeps its old name so a unit
        //    upgraded mid-booking carries on: a done 'door_code' job means the row
        //    already holds a code, and the text job below finds it.
        automation.ensureJob({ booking_id: booking.id, kind: 'door_code', due_at: createDue, deadline_at: endDt });
        if (automation.claim(booking.id, 'door_code')) {
          await automation.run(booking.id, 'door_code', '', async () => {
            const cur = rowNow();
            let pin = cur.door_code, personId = cur.remotelock_person_id;
            // a retry must reuse the credential this booking already has - never
            // mint a second one and strand the first with a live code (A-wave 12b).
            // A code with no lock reference is still a code (Oct 3 2026, the pack review): RemoteLock can hand
            // back a working PIN with no guest id, and `!personId` minted a second one on every retry
            if (!pin) {
              const made = await doorlock.generateDoorCode(booking);
              pin = made.pin; personId = made.personId;
              dbModule.db.prepare(`UPDATE bookings SET door_code=?, remotelock_person_id=?, door_code_state='pending', door_code_created_at=datetime('now'), door_code_polls=0, updated_at=datetime('now') WHERE id=?`)
                .run(pin, personId, booking.id);
              await dbModule.flushed();
            }
            // no reference to ask the lock about: the provider gave the PIN as working (maintainer, Sep 16 2026: "a customer
            // standing at a door with no code is worse") - it cannot be checked from here, as RemoteLock never can, so
            // it is texted on the owner's timing like any other unconfirmable code. DOOR_CODE_UNTRACKED already says
            // it cannot be taken back from here.
            const c = personId ? await doorlock.confirmDoorCode(personId, booking)
              : { state: 'unknown', detail: 'the lock gave no reference for this code - it cannot be checked or taken back from here' };
            setState(c.state);
            if (c.state === 'failed') adminLog('DOOR_CODE_UNCONFIRMED', `Booking: ${booking.id} | ${c.detail}`);
          });
        }

        // 2. THE HOLD. While the answer is 'pending', ask again each tick - up to
        //    DOOR_CONFIRM_POLLS times - so a code that lands late is texted the
        //    minute it lands, and one that never lands is texted with the fallback.
        {
          const cur = rowNow();
          const polledAt = cur.door_code_polled_at ? new Date(String(cur.door_code_polled_at).replace(' ', 'T') + 'Z').getTime() : 0;
          if (cur.remotelock_person_id && cur.door_code_state === 'pending'
              && (cur.door_code_polls || 0) < doorlock.DOOR_CONFIRM_POLLS && Date.now() - polledAt >= 50000) {
            const c = await doorlock.confirmDoorCode(cur.remotelock_person_id, booking);
            setState(c.state);
          }
        }

        // 3. TEXT - and never before confirm has answered.
        automation.ensureJob({ booking_id: booking.id, kind: 'door_text', due_at: textDue, deadline_at: endDt });
        {
          const cur = rowNow();
          const st = cur.door_code_state;
          const settled = st === 'held' || st === 'unknown' || st === 'failed'
            || (st === 'pending' && (cur.door_code_polls || 0) >= doorlock.DOOR_CONFIRM_POLLS);
          const ready = !!cur.door_code && settled;   // a code with no lock reference is still the customer's way in (Oct 3 2026)
          if (!ready) {
            // not a failure and not overdue: re-arm a minute out, no attempt spent
            if (Date.now() >= textDue.getTime()) automation.defer(booking.id, 'door_text', '', 1, cur.door_code ? 'waiting for the lock to confirm the code' : 'waiting for the code to be created');
          } else {
            // the minute it settles, it goes: an earlier defer must not hold it a minute more
            if (Date.now() >= textDue.getTime()) automation.nudge(booking.id, 'door_text');
          }
          if (ready && automation.claim(booking.id, 'door_text')) {
            await automation.run(booking.id, 'door_text', '', async () => {
              let fallback = null;
              if (st === 'failed' || st === 'pending') {
                const f = await doorlock.fallbackDoorCode(booking);
                if (f && f.pin) fallback = f.pin;
                if (st === 'failed') {
                  alertOwnerDoor(booking, fallback ? 'DOOR_CODE_FALLBACK' : 'DOOR_CODE_UNCONFIRMED',
                    fallback ? `the lock did not take this booking's code, so the customer was texted the standing backup code as well - check the lock`
                             : `the lock did not take this booking's code and there is no backup code to send - the customer was texted the code anyway; check the lock before they arrive`);
                } else {
                  adminLog('DOOR_CODE_UNCONFIRMED', `Booking: ${booking.id} | not confirmed after ${cur.door_code_polls} checks - texted anyway` + (fallback ? ' with the backup code beside it' : ''));
                }
              }
              // the words beside the code (press Enter; a member's PIN or a one-time code - doorlock.doorCodeNote)
              const opts = { note: doorlock.doorCodeNote(booking, cur.remotelock_person_id), fallback: fallback || undefined };
              const dText = await sendDoorCode(booking, cur.door_code, opts);
              const dMail = booking.email ? await sendDoorCodeEmail(booking, cur.door_code, opts) : undefined;
              deliveredAny(`door code for booking ${booking.id}`, [dText, dMail]);
              if (fallback) dbModule.db.prepare(`UPDATE bookings SET sms_code_sent=1, door_fallback_code=? WHERE id=?`).run(fallback, booking.id);
              else dbModule.db.prepare(`UPDATE bookings SET sms_code_sent=1 WHERE id=?`).run(booking.id);
            });
          }
        }
        }   // end of the confirm-before-text flow
      }

      // ── THE CREDENTIAL'S WINDOW FOLLOWS THE BOOKING ──────────────────────
      // A visitor's ONLY bound on the console is the start/end epoch pair we sent
      // when we created it. Extending a session moved bookings.end_time and (since
      // A-wave 11b) rescheduled the after-end jobs onto the new end - but nothing
      // told the door, so the customer's code died at the ORIGINAL end while our
      // own revoke job correctly waited for the new one and the doorcodes health
      // signal stayed green the whole time. In an unmanned facility at night that
      // is a paying customer locked out of the hour they just bought. (Sep 16 2026.)
      //
      // It is a QUEUED job, not an inline call, for three reasons: extendBooking is
      // synchronous and has twelve callers; a console that is briefly down should
      // retry rather than fail the extension at the counter; and a queued job is
      // visible on Automation Health, which an inline best-effort call never is.
      // Not a CLEANUP kind - moving a window stops meaning anything once the new
      // end has passed, so it carries a deadline and is allowed to expire.
      if (automation.claim(booking.id, 'door_window')) {
        await automation.run(booking.id, 'door_window', '', async () => {
          // read the row fresh: the end time is exactly the thing that just moved
          const cur = dbModule.db.prepare(`SELECT * FROM bookings WHERE id=?`).get(booking.id);
          if (!cur || !cur.remotelock_person_id) return;   // nothing live to move
          const res = await moveDoorCodeWindow(cur);
          if (res && res.skipped) return;                  // rule 31: not applicable
          if (!res || res.ok !== true) throw new Error('the door would not move the code\'s window: ' + ((res && res.error) || 'no answer'));
        });
      }

      // ── CHECK FOR BACK-TO-BACK BOOKING IN SAME BAY ───────────────────────
      //   hasSoonBooking    = next booking within 30 min — keep equipment on, skip shutdown
      // (the 15-minute text decides "next group" with the bay screen's own rule - see the ending warning below)
      // Facility policy, not a constant (maintainer's law): default 30, owner-tunable
      // at cfg.automation.keepOnGapMins. Within this window of a following
      // booking the equipment stays ON and the monitor's screen block covers
      // the gap; beyond it, power off fires as normal.
      const keepOnGapMins    = Number(cfg.automation?.keepOnGapMins ?? 30);
      const nextBooking      = findNextBooking(dbModule, booking, keepOnGapMins);
      const hasSoonBooking   = !!nextBooking;

      // ── PER-BAY DEVICE AUTOMATION ─────────────────────────────────────────
      // WHOLE-FACILITY BOOKINGS (Aug 2026): a booking stamped whole_facility=1
      // owns EVERY active bay - one tee time runs the full start sequence on
      // all of them and the full end sequence on all of them, through exactly
      // the same per-device jobs below (device keys are per-IP, so two bays'
      // devices get their own durable jobs). Per-bay bookings walk exactly one
      // bay - byte-for-byte the old behavior. The stamp on the ROW decides,
      // never the live setting.
      // ONE DEFINITION OF WHICH BAYS TO DRIVE (maintainer, Sep 19 2026). This used to be
      // `filter(b => b.active !== false)` in three places, which could see
      // neither a block nor a bay flagged out of service - so a facility booking
      // woke the PC, plug and TV of the bay the owner was standing inside with a
      // screwdriver. bookingcore.baysToDrive knows about both, and OFF FOR THE
      // WHOLE SESSION: a bay blocked for any part of this booking stays dark for
      // all of it.
      const _autoBays = require('./bookingcore').baysToDrive(booking);
      for (const bay of _autoBays) {

      // ── WAKE-ON-LAN: DURABLE PC WAKE (pilot facility, Aug 2026) ─────────────────────
      // If the bay has a PC MAC, fire a durable magic-packet job pcWakeMinutes
      // before start (default 10). Survives Pi restarts via ensureJob/claim/run,
      // fires ONCE per booking (device_key='wol' lease). A packet to an already-on
      // PC is a no-op, so a caught-up job never disturbs a running session. Blank
      // MAC = no job (pure plug-cycle). Independent of any smart plug on the PC.
      // ── RESTART BEFORE THE NEXT GROUP (maintainer, Oct 2 2026) ─────────────────────
      // "Then 10 min before the 1:30 tee time the PC restarts to put the new people back to the main
      // menu." Bookings run on the half hour: a session that ends at 3:00 with the next at 3:00 keeps
      // the PC on and the next group steps in (no restart); with the next at 3:30 the reserved screen
      // covers the gap and the PC restarts at 3:20, so the new group finds the game's main menu, not the
      // last group's round half played; with the next at 4:00 or later the PC was shut down at 3:00
      // (auto-shutdown, outside the keep-on window) and wakes fresh - a PC that is off is not restarted. It is
      // decided when it fires (below): never while anyone is playing on the bay (a group that booked more
      // time into the gap keeps their game), never for a booking made too late to restart in time.
      // ONLY WHEN THE RESERVED SCREEN REALLY CAME UP (maintainer, Oct 2 2026: "only if the bay watcher is up. Like
      // if someone books 1-3 then a friend books same group from 3-4 so they can play longer same game"):
      // the gap must be longer than the watcher's own 10 minutes (shorter, it never covers the bay), and
      // this bay's watcher must have reported its reserved screen UP through the gap - a PC with no watcher
      // running never showed the reserved screen, and is left exactly as it is.
      // WHATEVER THE GAP, DECIDED WHEN IT FIRES (maintainer, Oct 3 2026: "even if the next T time is the next day and
      // we dont shut it down manualy the bay blocker will be up and 10 min before the next Tee time even the
      // next day the bay will restart fully giving them a clean slate again"; pilot facility's bay-watcher guide, Oct 3:
      // the restart is decided at fire time from whether the PC answers). It used to be made only when the
      // schedule said the PC SHOULD have stayed on - so a PC left on after a long gap (a shutdown skipped for
      // a next booking that was then cancelled) was never restarted, and the next group met the old game.
      if (cfg.shutdown?.restart && bay && String(bay.simulatorPcIp || '').trim()) {
        const candidate = !!pcRestartCandidate(bay.id, booking);
        const rKey = 'restart:' + bay.id;
        if (candidate) {
          automation.ensureJob({ booking_id: booking.id, kind: 'pc_restart', device_key: rKey,
            due_at: new Date(startDt.getTime() - RESTART_LEAD_MINS * 60000),
            deadline_at: new Date(startDt.getTime() - RESTART_LATEST_MINS * 60000) });
        }
        {
          const rj = dbModule.db.prepare(`SELECT status, attempts FROM automation_jobs WHERE booking_id=? AND kind='pc_restart' AND device_key=?`).get(booking.id, rKey);
          const retryUntil = startDt.getTime() - (RESTART_LEAD_MINS - RESTART_RETRY_MINS) * 60000 + RESTART_RETRY_SLACK_MS;
          if (rj && rj.status === 'pending' && rj.attempts > 0 && now.getTime() > retryUntil)
            automation.writeOff(booking.id, 'pc_restart', rKey, 'the PC refused the restart and the reserved screen has lifted - not retried into the session (the PC answered, so the group has a working PC)');
        }
        if (automation.claim(booking.id, 'pc_restart', rKey)) {
          await automation.run(booking.id, 'pc_restart', rKey, async () => {
            const cand = pcRestartCandidate(bay.id, booking);
            const ip = String(bay.simulatorPcIp || '').trim();
            const busy = !cand ? 'the session before now ends 10 minutes or less before this one - the same group may be playing on'
              : sessionOnBayNow(bay.id, booking.id, new Date()) ? 'someone is playing on it right now' : '';
            if (busy) { adminLog('RESTART_SKIPPED', `Bay: ${bay.name || bay.id} | Booking: ${booking.id} | ${busy}`); return; }
            // a PC that is off has no old game on it - the wake brings it up fresh. That is the ordinary case on a
            // unit that shuts its PCs down, so it is not written to the owner's log
            if ((await probePc(ip)) === false) return;
            // the reserved screen must have been UP through the gap, by the watcher's own word: from a minute and
            // a half after the last session ended (its first polls are still the session) to just before the
            // watcher lifts the screen for the next group, ten minutes out. Only the last three hours of reports
            // are kept (services/baypresence), so a gap of a day reads its last three hours.
            const held = require('./baypresence').guardHeld(bay.id, cand.prevEndMs ? cand.prevEndMs + 90000 : 0, startDt.getTime() - RESTART_LEAD_MINS * 60000 - 15000);
            const why = held === null ? 'the PC is on, but its bay watcher has not reported the reserved screen (no watcher running, one built before October 2026, or the PC was only just switched on) - the PC is left as it is'
              : held === false ? 'the reserved screen was taken down on that PC during the gap (staff\'s Ctrl+Shift+F12, or someone using the PC) - the PC is left as it is'
              : '';
            // a bay whose watcher never reports (one built before October 2026) is a standing state, not news at every
            // booking: said once per bay in twelve hours (Oct 19 2026, the pack review - a row per session on day one)
            if (why && held === null) {
              let said = false;
              try { said = !!dbModule.db.prepare(`SELECT 1 FROM admin_log WHERE event='RESTART_SKIPPED' AND detail LIKE ? AND detail LIKE '%has not reported the reserved screen%' AND created_at > datetime('now', '-12 hours') LIMIT 1`).get(`Bay: ${bay.name || bay.id} |%`); } catch (e) {}
              if (!said) adminLog('RESTART_SKIPPED', `Bay: ${bay.name || bay.id} | Booking: ${booking.id} | ${why} (said once in twelve hours for this bay)`);
              return;
            }
            if (why) { adminLog('RESTART_SKIPPED', `Bay: ${bay.name || bay.id} | Booking: ${booking.id} | ${why}`); return; }
            await restartBayPc(bay);
            adminLog('PC_RESTART_BEFORE_GROUP', `Bay: ${bay.name || bay.id} | Booking: ${booking.id} | restarted 10 minutes before the group - the reserved screen had stayed up through the gap`);
          });
        }
      } else if (bay && automation.isPending(booking.id, 'pc_restart', 'restart:' + bay.id)) {
        // switched off (or the bay's PC address cleared) with restarts already queued: they are settled, not left
        // to go overdue and turn Automation red with "restart the unit" (Oct 3 2026, the pack review; rule 31)
        automation.skip(booking.id, 'pc_restart', 'restart:' + bay.id, 'the restart before the next group is switched off in Settings, or the bay has no PC address');
      }

      if (bay && bay.pcMac) {
        // ONE WAKE, AND ONE CHECK, PER BAY (Sep 25 2026, the build review): a whole-facility booking
        // drives every bay, but the job was keyed 'wol' per BOOKING - the first bay claimed it and
        // every other bay's PC was never woken, or checked. The first bay keeps 'wol' (rows already
        // on a unit, and every per-bay booking, are unchanged); the others get their own key.
        const wolKey = (booking.whole_facility && bay !== _autoBays.find(b => b && b.pcMac)) ? 'wol:' + bay.id : 'wol';
        const wBefore = (cfg.booking && cfg.booking.pcWakeMinutesBefore != null)
          ? cfg.booking.pcWakeMinutesBefore : (bay.pcWakeMinutesBefore ?? 10);
        automation.ensureJob({
          booking_id: booking.id, kind: 'power_on', device_key: wolKey,
          due_at: new Date(startDt.getTime() - wBefore * 60000),
          deadline_at: endDt, retime: true
        });
        if (automation.claim(booking.id, 'power_on', wolKey)) {
          await automation.run(booking.id, 'power_on', wolKey, async () => {
            // A-wave 12b: the fifth device leg, missed by the first cut - wakePc returns
            // true/false (services/simulator.js) and its answer was thrown away while
            // PC_WAKE went into the owner's log regardless.
            ledgered('pc:' + bay.pcMac, bay.id, 'on', `wake ${bay.name || bay.id}`, await require('./simulator').wakePc(bay.pcMac));
            adminLog('PC_WAKE', `${bay.name || bay.id} | ${bay.pcMac} | Booking: ${booking.id}`);
          });
        }
        // DID THE PC COME UP? (Sep 25 2026, maintainer's item 6 - pilot facility: "The log says 'WOL sent', which
        // does not mean the PC came up.") A few minutes after the packet, the PC must answer on
        // the network (the port-445 probe the shutdown uses) or its bay watcher must have asked
        // the unit for its status since the wake. If neither, it is woken again, the check fails
        // and retries (the health line shows it) and the owner is told once. A bay with no PC
        // address and no watcher ever seen cannot be checked: not applicable (rule 31).
        const wakeJob = (() => { try { return dbModule.db.prepare(`SELECT status, fired_at FROM automation_jobs WHERE booking_id=? AND kind='power_on' AND device_key=?`).get(booking.id, wolKey); } catch { return null; } })();
        if (wakeJob && wakeJob.status === 'done') {
          const checkMins = Math.max(1, Number(cfg.automation?.pcBootCheckMins ?? 5));
          const wokeAt = Date.parse(String(wakeJob.fired_at || '').replace(' ', 'T') + 'Z') || now.getTime();
          // AFTER A RESTART THE CHECK WAITS FOR THE START (Oct 3 2026, the pack review): the restart before the next group and
          // the wake fire in the same minute, so a reboot that ran Windows updates past five minutes failed the check and texted
          // the owner the PC "did not come up after it was woken" - the wrong cause, while it was still updating
          // a restart actually SENT for this group (its job also finishes when it decides not to restart)
          const restarted = (() => { try { return !!dbModule.db.prepare(`SELECT 1 FROM admin_log WHERE event='PC_RESTART_BEFORE_GROUP' AND detail LIKE ?`).get('% | Booking: ' + booking.id + ' | %'); } catch { return false; } })();
          const checkAt = restarted ? Math.max(wokeAt + checkMins * 60000, startDt.getTime()) : wokeAt + checkMins * 60000;
          automation.ensureJob({ booking_id: booking.id, kind: 'pc_check', device_key: wolKey, due_at: new Date(checkAt), deadline_at: endDt });
          if (automation.claim(booking.id, 'pc_check', wolKey)) {
            await automation.run(booking.id, 'pc_check', wolKey, async () => {
              const ip = bay.simulatorPcIp;
              const probed = ip ? await require('./simulator').probePc(ip) : null;
              const polled = require('./baypresence').seenSince(bay.id, wokeAt);
              if (probed === true || polled) { adminLog('PC_UP', `${bay.name || bay.id} | Booking: ${booking.id} | ${probed ? 'answers on the network' : 'its watcher is asking the unit'}`); return; }
              if (!ip && !require('./baypresence').lastSeen(bay.id)) { adminLog('PC_UP_UNCHECKED', `${bay.name || bay.id} | no PC address set and no bay watcher seen - the wake cannot be checked`); return; }
              await require('./simulator').wakePc(bay.pcMac);   // once more, then say so
              // the owner is told from the SECOND check that fails (the build review): a PC that needs
              // a minute longer to boot passes the retry a minute later, and texts nobody
              const tries = (() => { try { return Number((dbModule.db.prepare(`SELECT attempts FROM automation_jobs WHERE booking_id=? AND kind='pc_check' AND device_key=?`).get(booking.id, wolKey) || {}).attempts) || 0; } catch { return 0; } })();
              if (tries >= 1) await Promise.race([require('./owneralert').alert('pc-down:' + bay.id,
                `${bay.name || bay.id}'s simulator PC did not come up after it was ${restarted ? 'restarted (a restart can run Windows updates) and woken' : 'woken'} for the ${booking.start_time} session - or the unit cannot see it. Check it is plugged in and switched on at the wall, that Wake-on-LAN is on in its BIOS and its network adapter, and that the PC is signed in with its bay watcher running (or file sharing on, the network set to Private).`).catch(() => {}),
                new Promise(r => setTimeout(r, 10000))]);
              throw new Error(`${bay.name || bay.id}'s PC did not answer ${checkMins} minutes after it was woken - woken again`);
            });
          }
        }
      }

      // ── SHELLY: PER-DEVICE TURN ON ────────────────────────────────────────
      if (bay && bay.shellyDevices) {
        for (const device of bay.shellyDevices) {
          const mBefore = device.minutesBefore ?? 10;
          const key     = deviceKey(booking.id, device.ip);

          // POWER ON - durable. The old in-memory flag vanished on every PM2
          // restart, and the window meant a bay booked after its start time
          // never powered on at all. Now: due mBefore minutes ahead, caught up
          // any time before the session ends, retried on failure.
          automation.ensureJob({
            booking_id: booking.id, kind: 'power_on', device_key: device.ip,
            due_at: new Date(startDt.getTime() - mBefore * 60000),
            deadline_at: endDt, retime: true
          });
          if (automation.claim(booking.id, 'power_on', device.ip)) {
            await automation.run(booking.id, 'power_on', device.ip, async () => {
              ledgered('shelly:' + device.ip, bay.id, 'on', `Shelly ${device.name} on`, await controlDevice(device.ip, device.gen || 2, true));
              adminLog('SHELLY_ON', `${device.name} | Booking: ${booking.id}`);
            });
          }

          // THE OFF IS DECIDED WHEN IT IS DUE, NEVER BEFORE (Sep 25 2026, maintainer's item 5 - the pilot facility
          // handoff section 2). "Another session needs this device" used to be decided on ANY
          // tick - hours ahead - and written as a final skip, so a next session cancelled in
          // between left the bay running all night. Now the OFF job always exists and the
          // question is asked at its due moment, against the bookings as they are THEN.
          if (device.turnOffAfter) {
            const mAfter = device.minutesAfter ?? 30;
            // POWER OFF - durable too: a missed OFF leaves a bay running all
            // night. No deadline; it catches up whenever the Pi is back.
            const offDue = new Date(endDt.getTime() + mAfter * 60000);
            automation.ensureJob({ booking_id: booking.id, kind: 'power_off', device_key: device.ip, due_at: offDue, retime: true });
            // THE GUARD READS THE CLOCK WHEN IT DECIDES (Oct 21 2026, the device audit): the tick's own start time let an OFF that
            // came due while a slow tick was running skip every guard below and be claimed - switched off with the next group
            // inside the keep-on gap
            const tOff = new Date();
            const shellyShared = tOff.getTime() >= offDue.getTime() && (deviceStillNeeded(cfg, tOff, { type:'shelly', key: device.ip }, booking.bay_id)
              || heldByOther('power_on', device.ip, booking.id, tOff));
            if (tOff.getTime() >= offDue.getTime() && (hasSoonBooking || shellyShared)) {
              automation.skip(booking.id, 'power_off', device.ip, 'another session needs this device');
            } else if (automation.claim(booking.id, 'power_off', device.ip)) {
              await automation.run(booking.id, 'power_off', device.ip, async () => {
                ledgered('shelly:' + device.ip, bay.id, 'off', `Shelly ${device.name} off`, await controlDevice(device.ip, device.gen || 2, false));
                adminLog('SHELLY_OFF', `${device.name} | Booking: ${booking.id}`);
              });
            }
          }
        }
      }

      // ── BROADLINK: PER-DEVICE IR CONTROL ──────────────────────────────────
      if (bay && bay.broadlinkDevices && bay.broadlinkDevices.length) {
        for (const device of bay.broadlinkDevices) {
          if (!device.ip || !device.onCommand) continue;
          const mBefore = device.minutesBefore ?? 10;
          const key     = deviceKey(booking.id, device.ip + '_bl');
          const irK     = irJobKey(bay, device);
          automation.ensureJob({
            booking_id: booking.id, kind: 'ir_on', device_key: irK,
            due_at: new Date(startDt.getTime() - mBefore * 60000),
            deadline_at: endDt, retime: true
          });
          // (Oct 21 2026) every guard below reads the clock now, not the tick's start - a toggle "on" that came due while a slow
          // tick ran went out unguarded and switched a TV someone had turned on OFF
          const tOn = new Date();
          // W37: the ON path now carries the OFF path's guard. A toggle code fired
          // at a device that is already serving a live session turns it OFF.
          const blLive = deviceLiveNow(cfg, tOn, { type: 'broadlink', key: device.ip }, booking.id);
          // A1 (Sep 11 2026, the pilot facility #7 battery): the catch-up for a MISSED "on"
          // (the unit was down at start-10) is right after a power cut - the TV
          // went dark too. But a toggle code sent minutes INTO a session the
          // customer is already sitting in is a coin toss: if they switched the TV
          // on themselves, our late "on" switches it off. A toggle "on" is sent
          // only up to a few minutes past the start; after that the customer has
          // the remote, and the skip is logged for the owner.
          const lateToggle = irCodeStyle(device) === 'toggle' && (tOn.getTime() - startDt.getTime()) > 3 * 60000;
          // a skip is decided only when the ON is DUE (maintainer's item 5, pilot facility section 2): a session
          // running on this device hours earlier is no reason to cancel a later booking's ON
          const onDue = tOn.getTime() >= startDt.getTime() - mBefore * 60000;
          // what the bay buttons (or the last run) already did to a TOGGLE TV (the command ledger).
          // Asked only while the ON is still waiting (the build review): once it had been sent, every
          // later tick found the unit's own "on" in the ledger and logged it as skipped, once a minute.
          const onOpen = onDue && automation.isPending(booking.id, 'ir_on', irK);
          const irAlreadyOn = onOpen ? require('./devicelog').toggleAlready(device, 'on') : null;
          const keptOn = onOpen && !irAlreadyOn && irCodeStyle(device) === 'toggle' ? keptOnFromPrevious(cfg, booking, device, keepOnGapMins, irK) : null;
          if (onOpen && irAlreadyOn) {
            automation.skip(booking.id, 'ir_on', irK, `already on (${irAlreadyOn.source}, ${String(irAlreadyOn.at).slice(11, 16)} UTC) and the code is a toggle - sending "on" would switch it off`);
            adminLog('BROADLINK_ON_SKIPPED', `${device.name} | Booking: ${booking.id} | already on per the command ledger (${irAlreadyOn.source})`);
          } else if (onOpen && keptOn) {
            automation.skip(booking.id, 'ir_on', irK, 'kept on from the previous session and the code is a toggle - sending "on" would switch it off');
            adminLog('BROADLINK_ON_SKIPPED', `${device.name} | Booking: ${booking.id} | kept on from the previous session (ended ${keptOn.prev.end_time}), toggle code`);
          } else if (onOpen && blLive && irCodeStyle(device) === 'toggle') {
            automation.skip(booking.id, 'ir_on', irK,
              'a session is already running on this device and the code is a toggle - sending "on" would switch it off');
            adminLog('BROADLINK_ON_SKIPPED', `${device.name} | Booking: ${booking.id} | already live, toggle code`);
          } else if (onOpen && lateToggle) {
            // never tried: not applicable; tried and refused: missed, and it stays on the health line (writeOff)
            const wrote = automation.writeOff(booking.id, 'ir_on', irK,
              'the session started more than 3 minutes ago and the code is a toggle - a late "on" could switch the device off in front of the customer');
            if (wrote === 'skipped') adminLog('BROADLINK_ON_SKIPPED', `${device.name} | Booking: ${booking.id} | session under way, toggle code - not sent late`);
          } else if (automation.claim(booking.id, 'ir_on', irK)) {
            await automation.run(booking.id, 'ir_on', irK, async () => {
              ledgered(require('./devicelog').irKey(device), bay.id, 'on', `IR ${device.name} on`, await sendCommand(device.ip, device.onCommand));
              adminLog('BROADLINK_ON', `${device.name} | Booking: ${booking.id}${blLive ? ' | device live, discrete code so safe' : ''}`);
            });
          }

          // the OFF is decided when it is DUE (maintainer's item 5): a next session cancelled since no
          // longer keeps this TV on all night
          if (device.offCommand && device.turnOffAfter) {
            const mAfter = device.minutesAfter ?? 30;
            const offDue = new Date(endDt.getTime() + mAfter * 60000);
            automation.ensureJob({ booking_id: booking.id, kind: 'ir_off', device_key: irK, due_at: offDue, retime: true });
            const tOff = new Date();   // the guard reads the clock when it decides (Oct 21 2026)
            const offOpen = tOff.getTime() >= offDue.getTime() && automation.isPending(booking.id, 'ir_off', irK);
            const blShared = offOpen && (deviceStillNeeded(cfg, tOff, { type:'broadlink', key: device.ip }, booking.bay_id)
              || heldByOther('ir_on', irK, booking.id, tOff));
            const irAlreadyOff = offOpen ? require('./devicelog').toggleAlready(device, 'off') : null;
            if (irAlreadyOff) {
              // someone pressed Bay Off already (the command ledger): a toggle would switch it back ON
              automation.skip(booking.id, 'ir_off', irK, `already off (${irAlreadyOff.source}, ${String(irAlreadyOff.at).slice(11, 16)} UTC) and the code is a toggle`);
              adminLog('BROADLINK_OFF_SKIPPED', `${device.name} | Booking: ${booking.id} | already off per the command ledger (${irAlreadyOff.source})`);
            } else if (offOpen && (hasSoonBooking || blShared)) {
              // Someone else needs this device NOW. THIS booking's switch-off is
              // genuinely unnecessary - the later session owns its own OFF job.
              // Marked skipped (not left pending) so it cannot linger as a
              // false "overdue" on the health panel.
              automation.skip(booking.id, 'ir_off', irK, 'another session needs this device');
            } else {
              if (automation.claim(booking.id, 'ir_off', irK)) {
                await automation.run(booking.id, 'ir_off', irK, async () => {
                  ledgered(require('./devicelog').irKey(device), bay.id, 'off', `IR ${device.name} off`, await sendCommand(device.ip, device.offCommand));
                  adminLog('BROADLINK_OFF', `${device.name} | Booking: ${booking.id}`);
                });
              }
            }
          }
        }
      }

      // ── HOME ASSISTANT: PER-DEVICE CONTROL (power + climate) ──────────────
      // A-wave 12b, the A-wave 4 rule for Home Assistant: an integration the facility
      // switched off (or never finished setting up) must not accumulate jobs. Before
      // reading the device's answer this did not matter - the call threw, the result
      // was discarded and the flag was set anyway. It matters now.
      const haCfg = cfg.homeAssistant || {};
      const haReady = !!(haCfg.enabled && haCfg.url && haCfg.token && !String(haCfg.token).startsWith('PASTE'));
      if (bay && bay.haDevices && bay.haDevices.length && haReady) {
        for (const device of bay.haDevices) {
          if (!device.entity_id) continue;
          // on the facility's own list too: the facility's times decide it, so one bay's session ending
          // never turns off what the whole building is using (services/facilitydevices)
          if (require('./facilitydevices').has(cfg, device.entity_id)) continue;
          const isClimate = device.kind === 'climate';
          const mBefore = isClimate ? (device.leadTimeMins ?? 15) : (device.minutesBefore ?? 10);

          // A-wave 12: Home Assistant was the only device family NOT on the durable
          // job ledger - an in-memory flag that a restart forgets, a result nobody
          // read, and therefore nothing the health panel could ever see. It is a job
          // like every other device now, keyed by entity so it can never collide with
          // a Shelly ip, and its answer is read.
          const haKey = device.entity_id + '_ha';
          // A-wave 12b: NOT window-gated. Every other device family creates its job
          // whenever the booking is walked and lets due_at decide when it fires, which
          // is what gives it catch-up after the Pi was down. Keeping the old in-memory
          // window here meant a tick that missed the minute never created the job -
          // and one that had been created could sit overdue with nothing to claim it.
          {
            automation.ensureJob({
              booking_id: booking.id, kind: 'power_on', device_key: haKey,
              due_at: new Date(startDt.getTime() - mBefore * 60000), deadline_at: endDt, retime: true
            });
            if (automation.claim(booking.id, 'power_on', haKey)) {
              await automation.run(booking.id, 'power_on', haKey, async () => {
                let res;
                if (isClimate) {
                  // no comfort temperature set is nothing to do - and it must not be
                  // written into the owner's log as HA_ON for a call never made
                  if (device.comfortTemp == null) { automation.skip(booking.id, 'power_on', haKey, 'no comfort temperature is set for this thermostat'); return; }
                  // set for the mode the thermostat is in (heat, cool, heat/cool - homeassistant.setClimate, Oct 21 2026)
                  res = ledgered('ha:' + device.entity_id, bay.id, 'on', `Home Assistant ${device.name || device.entity_id} comfort`, await haService.setClimate(device.entity_id, haService.climateTargets(device).comfort));
                } else {
                  res = ledgered('ha:' + device.entity_id, bay.id, 'on', `Home Assistant ${device.name || device.entity_id} on`, await haService.setEntity(device.entity_id, true));
                }
                haSaid(res, 'HA_ON', `${device.name || device.entity_id} | Booking: ${booking.id}`);
              });
            }
          }

          // OFF / setback — skip if next booking within 30 min
          const offEligible = isClimate ? (device.ecoTemp != null) : (device.turnOffAfter);
          if (offEligible) {
            const mAfter = isClimate ? (device.setbackDelayMins ?? 10) : (device.minutesAfter ?? 30);
            // no deadline, like every other OFF: a missed setback leaves a bay's
            // heat or power running all night, so it catches up whenever it can
            const offDue = new Date(endDt.getTime() + mAfter * 60000);
            automation.ensureJob({ booking_id: booking.id, kind: 'power_off', device_key: haKey, due_at: offDue, retime: true });
            // decided when DUE (maintainer's item 5) - it used to leave the job pending, and read overdue,
            // whenever a next booking appeared after it was made; against the clock now (Oct 21 2026)
            const tOff = new Date();
            const haShared = tOff.getTime() >= offDue.getTime() && (deviceStillNeeded(cfg, tOff, { type:'ha', key: device.entity_id }, booking.bay_id)
              || heldByOther('power_on', haKey, booking.id, tOff));
            if (tOff.getTime() >= offDue.getTime() && (hasSoonBooking || haShared)) {
              automation.skip(booking.id, 'power_off', haKey, 'another session needs this device');
            } else if (automation.claim(booking.id, 'power_off', haKey)) {
              await automation.run(booking.id, 'power_off', haKey, async () => {
                const res = isClimate
                  ? ledgered('ha:' + device.entity_id, bay.id, 'off', `Home Assistant ${device.name || device.entity_id} setback`, await haService.setClimate(device.entity_id, haService.climateTargets(device).eco))
                  : ledgered('ha:' + device.entity_id, bay.id, 'off', `Home Assistant ${device.name || device.entity_id} off`, await haService.setEntity(device.entity_id, false));
                haSaid(res, 'HA_OFF', `${device.name || device.entity_id} | Booking: ${booking.id}`);
              });
            }
          }
        }
      }

      } // end per-bay device automation (_autoBays)

      // ── CLOSE-SESSION FLAG ────────────────────────────────────────────────
      // Declared BEFORE any block that uses it (warning + shutdown both do).
      // A "close session" ends exactly at the facility's closing time — it gets
      // a hard shutdown at close and a distinct warning message that never
      // invites the customer to book more time.
      const isCloseSession = !cfg.booking?.open24Hours &&
                             booking.end_time === require('./hours').on(cfg.booking, booking.date).closeTime;   // (that day's close)

      // ── 15 MIN BEFORE END — SESSION ENDING WARNING ──────────────────────
      //   - close session = "closing time, the sim shuts down at close" (never upsells)
      //   - the next tee time starts before a minimum session could fit = "Next group at X, please wrap up"
      //   - the facility's hours leave no room for a minimum session = "we close soon - please wrap up on time"
      //   - otherwise = "nobody booked after you, book more time and keep playing"
      // THE TEXT OFFERS ONLY WHAT THE BOOKING PAGE WOULD SELL (Oct 3 2026): it used "a next booking within 5
      // minutes", so a group whose next tee time was 20 minutes away - or who ended 15 minutes before closing - was
      // told "Nobody booked after you - book more time" and the booking page then refused them. It asks the bay
      // screen's own rule now (bookingcore.moreTimeFits), so the text and the screen always agree.
      if (!booking.session_ending_warned && notif('sendEndingWarning', booking.id)) {   // the text switch no longer stops the email too
        // Due 15 minutes before the end. Deadline = the end itself: telling
        // someone their session is "ending soon" after it ended is noise, and
        // it is recorded as missed rather than silently dropped.
        const warnDue = new Date(endDt.getTime() - 15 * 60000);
        automation.ensureJob({
          booking_id: booking.id, kind: 'ending_warning',
          due_at: warnDue,
          deadline_at: endDt
        });
        // THE NEXT BOOKING IS THE NEXT GROUP, WHOEVER MADE IT (maintainer, Oct 3 2026: "next group starts in 10 minutes is fine.
        // Even if it's the same person because we can't distinguish if it's the same group ... if a friend is there and
        // says, oh, i'm gonna add more time because we all want to keep playing. That's technically another person. But
        // the same group playing"). The Oct 2 skip for the same customer's own next booking is gone: the text and the bay
        // screen say the same thing for every booking right after.
        if (automation.claim(booking.id, 'ending_warning')) {
          await automation.run(booking.id, 'ending_warning', '', async () => {
            // A-wave 12b: the third message job, left out of the first cut - both
            // senders return their outcome and this one was still marking itself done
            // and stamping the row whatever they said.
            const after = findNextBooking(dbModule, booking, 24 * 60);
            const gap = after ? after._abs - absEndOf(booking) : null;
            const nextInTheWay = !!after && gap < (Number(cfg.booking?.minSessionMins) || 30);
            const noMoreTime = !nextInTheWay && !require('./bookingcore').moreTimeFits(cfg, booking.end_time, gap, booking.date);
            const eText = await sendSessionEndingWarning(booking, nextInTheWay, nextInTheWay ? after.start_time : null, isCloseSession, noMoreTime);
            const eMail = booking.email ? await sendSessionEndingEmail(booking, nextInTheWay, isCloseSession, noMoreTime) : undefined;
            deliveredAny(`session-ending warning for booking ${booking.id}`, [eText, eMail]);
            dbModule.db.prepare(`UPDATE bookings SET session_ending_warned=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
          });
        }
      }

      // ── SHUTDOWN AT SESSION END ───────────────────────────────────────────
      // Fires right at session end. Re-checks for next booking RIGHT NOW
      // (fresh query, not stale data from top of loop) so customers can
      // book additional time up to the last second.
      // Sends shutdown with delay 0 (immediate). The PC session monitor
      // handles the X-min-before warning popup separately.
      // Was a ONE-MINUTE window - the tightest in the system. A single delayed
      // tick left a gaming PC running all night. Now durable, with a 30-minute
      // deadline: past that the world has moved on (a new session may be under
      // way), so it is reported as missed rather than shutting down someone
      // else's game. The live guards below still run at fire time.
      let shutdownDue = false;
      // A-wave 12b, the A-wave 4 rule applied to the PC: no PC on any bay this booking
      // would shut down means no shutdown job at all, rather than six failing attempts
      // per booking for ever (the wizard and the seeder both ship an empty IP).
      const pcBays = require('./bookingcore').baysToDrive(booking);
      const anyPc = pcBays.some(b => String((b && b.simulatorPcIp) || '').trim());
      if (cfg.shutdown?.enabled && !booking.shutdown_sent && anyPc) {
        automation.ensureJob({
          booking_id: booking.id, kind: 'shutdown',
          due_at: endDt,
          // #20: 90-min (was 30) so a shutdown DEFERRED behind a live checkout cart
          // cannot hit its deadline and get permanently marked 'missed'.
          deadline_at: new Date(endDt.getTime() + 90 * 60000)
        });
        shutdownDue = automation.claim(booking.id, 'shutdown');
      }

      // #20 pending-hold DEFER must be decided BEFORE automation.run() - run()
      // calls succeed() when its fn returns, which would immediately mark a
      // just-deferred job 'done' and defeat the defer. So: if a customer is
      // mid-checkout on this bay right now, re-arm the shutdown and do NOT enter
      // run() at all. (Only for the normal end-of-session shutdown; a close-time
      // hard shutdown still fires - nothing can be booked past close.)
      if (shutdownDue && !isCloseSession) {
        const nowAbsSd  = nowAbsMins(now);
        const pendingHold = (booking.whole_facility
          ? dbModule.db.prepare(
              `SELECT id, start_time, end_time, date, end_date FROM bookings
                WHERE status = 'pending_payment' AND (date = ? OR end_date = ?)`
            ).all(padDate(now), padDate(now))
          : dbModule.db.prepare(
              `SELECT id, start_time, end_time, date, end_date FROM bookings
                WHERE bay_id = ? AND status = 'pending_payment'
                  AND (date = ? OR end_date = ?)`
            ).all(booking.bay_id, padDate(now), padDate(now)))
         .some(r => absStartOf(r) <= nowAbsSd && nowAbsSd < absEndOf(r));
        if (pendingHold) {
          automation.defer(booking.id, 'shutdown', '', 2, 'customer mid-checkout on this bay');
          adminLog('SHUTDOWN_DEFERRED', `Bay: ${booking.bay_name} | A checkout is in progress; re-checking`);
          shutdownDue = false; // skip run() this tick; the deferred job re-checks in ~2 min
        }
      }

      if (shutdownDue) {
        await automation.run(booking.id, 'shutdown', '', async () => {
        if (isCloseSession) {
          // ── CLOSE-TIME HARD SHUTDOWN ─────────────────────────────────────
          // Fires regardless of gap logic (nothing can be booked past close),
          // UNLESS staff pressed the one-night override for this bay. The
          // override is self-cleaning: it resets the moment it is honored.
          // EVERY BAY OF A WHOLE-FACILITY BOOKING (Oct 21 2026, the device audit): this shut down the one bay the row is stamped
          // with, so in whole-facility mode every other bay's PC stayed on all night after every closing. Each bay keeps its own
          // one-night override; one PC that refuses never stops the others (maintainer: "if a spot light is missed then it still does
          // everything else"), and the job retries for the ones that refused.
          const closeBays = booking.whole_facility
            ? require('./bookingcore').baysToDrive(booking).filter(b => String((b && b.simulatorPcIp) || '').trim())
            : [getBayById(booking.bay_id)].filter(Boolean);
          const closeFailed = []; let closeShut = 0;
          for (const bayObj of closeBays) {
            if (bayObj.closeOverride) {
              const liveCfg = getConfig();
              const liveBay = (liveCfg.bays || []).find(b => b.id === bayObj.id);
              if (liveBay) { liveBay.closeOverride = false; saveConfig(liveCfg); }
              adminLog('SHUTDOWN_CLOSE_SKIPPED', `Bay: ${bayObj.name || booking.bay_name} | One-night override used`);
              continue;
            }
            try { mustHaveWorked(`shutdown ${bayObj.name} at close`, await sendShutdown(bayObj, 0)); closeShut++; }
            catch (e) { closeFailed.push(`${bayObj.name}: ${e.message}`); }
          }
          if (closeFailed.length) {
            adminLog('SHUTDOWN_FAILED', `${closeFailed.length} of ${closeBays.length} bay PC(s) did not shut down at close - ${closeFailed.join('; ')}`.slice(0, 300));
            throw new Error(`shutdown at close failed on ${closeFailed.length} bay(s): ${closeFailed[0]}`);
          }
          if (closeShut || !closeBays.length) adminLog('SHUTDOWN_CLOSE', booking.whole_facility ? `Whole facility (${closeShut} bay PC${closeShut === 1 ? '' : 's'}) | Session ended at close` : `Bay: ${booking.bay_name} | Session ended at close`);
        } else {
          // ── NORMAL END-OF-SESSION SHUTDOWN ───────────────────────────────
          // Re-check the world at the moment of shutdown (day-aware). Three cases
          // must be distinguished (pilot facility "Yolanda" race analysis):
          //   1. An UPCOMING booking within the keep-on gap  -> skip (permanent).
          //   2. A booking ACTIVE on this bay RIGHT NOW       -> skip (permanent).
          //      (#19.3 - the prior code only checked #1, so a session that had
          //      already started on this bay could be shut down under the customer.)
          //   3. A pending_payment booking covering now (a customer mid-checkout)
          //      -> DEFER, do NOT fire, do NOT set shutdown_sent (#20). Firing
          //      would strand a paying customer's bay off; a PERMANENT skip would
          //      leave the bay ON forever behind an abandoned cart. Deferring
          //      re-checks every ~2 min: cart confirms -> a new active booking
          //      cancels this job; cart expires -> next tick fires normally.
          const gap        = Number(cfg.automation?.keepOnGapMins ?? 30);
          const freshNext  = findNextBooking(dbModule, booking, gap);
          const nowAbs     = nowAbsMins(now);

          // active-now: another booking on this bay whose [start,end) spans now.
          // (#19.3 - the prior code only checked an UPCOMING booking, so a session
          // already underway on this bay could be shut down under the customer.)
          const activeNow = (booking.whole_facility
            ? dbModule.db.prepare(
                `SELECT id, start_time, end_time, date, end_date FROM bookings
                  WHERE status = 'active' AND id != ? AND (date = ? OR end_date = ?)`
              ).all(booking.id, padDate(now), padDate(now))
            : dbModule.db.prepare(
                `SELECT id, start_time, end_time, date, end_date FROM bookings
                  WHERE bay_id = ? AND status = 'active' AND id != ?
                    AND (date = ? OR end_date = ?)`
              ).all(booking.bay_id, booking.id, padDate(now), padDate(now)))
           .some(r => absStartOf(r) <= nowAbs && nowAbs < absEndOf(r));

          if (freshNext) {
            adminLog('SHUTDOWN_SKIPPED', `Bay: ${booking.bay_name} | Next within ${gap}min: ${freshNext.start_time}`);
            dbModule.db.prepare(`UPDATE bookings SET shutdown_sent=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
          } else if (activeNow) {
            adminLog('SHUTDOWN_SKIPPED', `Bay: ${booking.bay_name} | A session is active on this bay right now`);
            dbModule.db.prepare(`UPDATE bookings SET shutdown_sent=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
          } else if (!booking.whole_facility && deviceBayBusy(booking.bay_id, booking.id, now)) {
            // the next session's PC has already been woken for it (the build review: a shutdown caught
            // up late, after a restart, shut down the PC the next customer was about to use)
            adminLog('SHUTDOWN_SKIPPED', `Bay: ${booking.bay_name} | The next session's PC has already been woken for it`);
            dbModule.db.prepare(`UPDATE bookings SET shutdown_sent=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
          } else {
            // A whole-facility booking shuts down every bay's PC; per-bay
            // bookings shut down exactly their own - old behavior untouched.
            // only the bays that actually have a PC, so one bay without one cannot make a
            // whole-facility shutdown unachievable for ever
            const sdBays = require('./bookingcore').baysToDrive(booking)
              .filter(b => String((b && b.simulatorPcIp) || '').trim());
            // A-wave 12: this used to swallow every failure, write SHUTDOWN_SENT and
            // stamp shutdown_sent=1 - which consumes the retry for good, because the
            // flag is what stops the job being scheduled again. A PC that did not shut
            // down now fails the job, so it backs off and comes back, and the owner's
            // log says which bay refused.
            const sdFailed = [];
            for (const bayObj of sdBays) {
              try { mustHaveWorked(`shutdown ${bayObj.name}`, await sendShutdown(bayObj, 0)); }
              catch (e) { sdFailed.push(`${bayObj.name}: ${e.message}`); }
            }
            if (sdFailed.length) {
              adminLog('SHUTDOWN_FAILED', `${sdFailed.length} of ${sdBays.length} bay PC(s) did not shut down - ${sdFailed.join('; ')}`.slice(0, 300));
              throw new Error(`shutdown failed on ${sdFailed.length} bay(s): ${sdFailed[0]}`);
            }
            adminLog('SHUTDOWN_SENT', booking.whole_facility ? `Whole facility (${sdBays.length} bays)` : `Bay: ${booking.bay_name}`);
            dbModule.db.prepare(`UPDATE bookings SET shutdown_sent=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
          }
          return;
        }
        dbModule.db.prepare(`UPDATE bookings SET shutdown_sent=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
        });
      }

      // ── REVOKE DOOR ACCESS ────────────────────────────────────────────────
      // The most consequential window in the system: it was five minutes wide,
      // and a miss left a customer's door code LIVE indefinitely - they could
      // walk back in days later. Durable, and deliberately WITHOUT a deadline:
      // a code must always eventually be revoked. Repeated failure surfaces on
      // the health panel, which is exactly what an owner needs to know.
      if (booking.remotelock_person_id) {
        automation.ensureJob({
          booking_id: booking.id, kind: 'door_revoke',
          due_at: new Date(endDt.getTime() + revokeLagMs())
        });
        if (automation.claim(booking.id, 'door_revoke')) {
          await automation.run(booking.id, 'door_revoke', '', async () => {
            const res = await revokeDoorCode(booking.remotelock_person_id, { forBookingId: booking.id });
            if (!res || res.ok !== true) throw new Error('the lock did not take the code back: ' + ((res && res.error) || 'no answer'));
            dbModule.db.prepare(`UPDATE bookings SET remotelock_person_id=NULL, updated_at=datetime('now') WHERE id=?`).run(booking.id);
            adminLog('DOOR_CODE_REVOKED', `Booking: ${booking.id}`);
          });
        }
      }
    } catch (bookingErr) {
      try {
        adminLog('AUTOMATION_ERROR',
          `booking ${booking && booking.id} (${booking && booking.bay_name} ${booking && booking.date} ${booking && booking.start_time}-${booking && booking.end_time}): ${bookingErr && bookingErr.message}`);
      } catch {}
      console.error('automation: booking', booking && booking.id, 'failed its pass:', bookingErr && bookingErr.message);
      continue;
    }
  }

  // ── CLEANUP ABANDONED PENDING PAYMENTS ────────────────────────────────────
  // Stripe-aware sweep: a pending booking may have actually been PAID (slow
  // Amazon/Apple Pay confirmation, webhook missed, tab closed after charge).
  // Before expiring, check Stripe. Paid → reactivate; the scheduler's own
  // late-booking catch-up branches then deliver door codes / power-on on the
  // next tick. Stripe unreachable → leave pending and retry next sweep
  // (never expire a booking we could not verify). No Stripe configured or no
  // payment intent recorded → expire exactly as before.
  try {
    const expired = dbModule.db.prepare(
      // the WHOLE row (Sep 27 2026): the refund notice below reads the customer's email and phone, and this
      // list carried neither - every automatic refund the sweeper made "told" a customer it had no way to reach
      "SELECT * FROM bookings WHERE status='pending_payment' AND created_at < datetime('now', ?)"
      // W37: the SAME hold the picker hides for and the create path refuses
      // over. Three different numbers is how a slot gets sold twice.
    ).all(`-${require('./bookingcore').holdMins()} minutes`);
    if (expired.length) {
      const key = cfg.stripe?.secretKey || '';
      let stripeC = null;
      if (key) {
        try {
          stripeC = module.exports._stripeForTest || stripeClient(key);
        } catch {}
      }
      for (const b of expired) {
        // WHAT THE HOLD CONSUMED GOES BACK, whichever way the row ends (maintainer,
        // Sep 19 2026). Two paths write status='expired' on a pending row and
        // only the plain-expiry one undid the discount codes and the member
        // credit; a booking REFUNDED as undeliverable left the member's credit
        // spent on a session they never had. Idempotent on the 'Restored%' row.
        const releaseHeldValue = (row, why) => {
          try { require('./pricing').releaseBookingCodes(row.id); } catch (e) { console.error('Code release on expiry:', e.message); }
          try {
            const used = dbModule.db.prepare(
              `SELECT member_id, COALESCE(SUM(-delta_cents),0) AS used FROM member_credit
               WHERE booking_id = ? AND reason = 'Applied to booking' GROUP BY member_id`
            ).get(row.id);
            if (used && used.used > 0) {
              const already = dbModule.db.prepare(
                `SELECT COUNT(*) AS c FROM member_credit WHERE booking_id = ? AND reason LIKE 'Restored%'`
              ).get(row.id);
              if (!already?.c) {
                dbModule.db.prepare(
                  `INSERT INTO member_credit (member_id, delta_cents, reason, booking_id) VALUES (?,?,?,?)`
                ).run(used.member_id, used.used, 'Restored - ' + why, row.id);
              }
            }
          } catch (e) { console.error('Credit restore error:', e.message); }
        };
        let verdict = 'expire';
        let piStatus = null, piObj = null;
        if (stripeC && b.stripe_payment_intent) {
          try {
            // the chosen payment method comes back as an object only when asked for [S1]
            const pi = await stripeC.paymentIntents.retrieve(b.stripe_payment_intent, { expand: ['payment_method'] });
            piStatus = pi ? pi.status : null;
            piObj = pi;
            // MONEY IN FLIGHT IS NOT ABANDONMENT (maintainer, Sep 19 2026, the redirect
            // review). This read only two states - succeeded, or walked away -
            // so a PaymentIntent sitting in `processing` went down the cancel
            // branch: we tried to cancel a payment that was actively settling
            // and expired the customer's booking under it. Klarna, Affirm and
            // Cash App all sit in `processing` for a while, and they are
            // exactly the methods this wave just taught the page to come back
            // from. `requires_capture` is an authorised card, which is money
            // too. The card-reader path already drew this line correctly
            // (terminal.js: `processing` returns waiting, and it gives up ONLY
            // on the three no-money states) - this is the same line, in the
            // one place that did not have it.
            const GAVE_UP = ['requires_payment_method', 'requires_confirmation', 'requires_action'];
            if (!pi) verdict = 'defer';
            else if (pi.status === 'succeeded') verdict = 'reactivate';
            // AWAY ON THE PROVIDER'S OWN PAGE (Oct 2 2026, the list item from Sep 19). A customer who chose
            // Klarna, Affirm, Cash App or any other method that is not a card is on that provider's page,
            // and `requires_action` there means they have not finished yet - not that they walked away. So
            // they get AWAY_GRACE_MINS beyond the hold before the payment is cancelled. A CARD (Link pays
            // by card [S2]) in `requires_action` is a 3-D Secure check left undone, and is still closed at
            // the hold, its card hold released (test-payments-sandbox 12d). The method is read from the
            // intent itself [S1]; when it cannot be read, nothing changes - the hold decides as before.
            // ...never past the slot's own start (Oct 3 2026, the pack review): a session that has begun cannot be bought
            // (maintainer, Sep 27), so a customer still on the provider's page then would only finish to be refunded - the payment
            // is cancelled at the start instead, before money moves (a buy-now-pay-later refund can take days)
            else if (pi.status === 'requires_action' && awayOnProvider(pi) && minsSinceCreated(b) < require('./bookingcore').holdMins() + AWAY_GRACE_MINS
                     && Date.now() < new Date(`${b.date}T${b.start_time}:00`).getTime()) {
              verdict = 'defer';
              try {
                const seen = dbModule.db.prepare(`SELECT 1 FROM admin_log WHERE event='CHECKOUT_AWAY_ON_PROVIDER' AND detail LIKE ?`).get(b.id + '%');
                if (!seen) adminLog('CHECKOUT_AWAY_ON_PROVIDER', `${b.id} | ${b.name || ''} | ${b.date} ${b.start_time} on ${b.bay_name || ''} | still paying on ${pi.payment_method.type}'s own page - held up to ${AWAY_GRACE_MINS} more minutes before the payment is cancelled`);
              } catch {}
            }
            else if (GAVE_UP.includes(pi.status)) verdict = 'expire';
            // ALREADY CANCELLED IS AN ANSWER, NOT A MYSTERY (maintainer, Sep 23 2026). A
            // `canceled` intent fell to "anything new" below and was deferred on
            // every tick, silently, for ever - the checkout sat "pending" on the
            // owner's list and nothing could close it. It is the most final of all
            // the no-money states: nothing can charge it again. It happens whenever
            // the intent is cancelled somewhere other than here - the owner in the
            // Stripe dashboard, or the owner's Expire button winning a race.
            else if (pi.status === 'canceled') verdict = 'expire';
            // (Sep 19 2026: a first cut deferred on any redirect-shaped next_action and broke
            // test-payments-sandbox 12d - a 3-D Secure card sits in requires_action with a redirect
            // too. Telling the two apart needed the SELECTED method, which the branch above reads:
            // Oct 2 2026, test-sweeper-restart section K.)
            else verdict = 'defer';        // processing, requires_capture, anything new
          } catch (e) { verdict = 'defer'; }
        }
        if (verdict === 'reactivate') {
          // #21 DELIVERABILITY GATE (pilot facility "Yolanda"): the payment is good, but the
          // sweep must also ask whether the SESSION can still happen. Reactivating
          // blindly charged a customer for a slot that had already ended, or for a
          // bay a prior session had just shut down. Two undeliverable cases:
          //   (a) sessionOver: the whole slot has already elapsed (end <= now).
          //   (b) bayWasDown : the start has passed AND a prior booking on this bay
          //       fired its shutdown within pcShutdownGuardMins of this start (the
          //       bay came up in, or never left, the dead zone).
          // On either, REFUND instead of reactivating; the customer is never
          // charged for a session that did not happen.
          const guardMins = Number(cfg.automation?.pcShutdownGuardMins ?? 10);
          const nowAbs    = nowAbsMins(now);
          const startAbs  = dayIndex(b.date) * 1440 + toMinsOfDay(b.start_time);
          const endAbs    = dayIndex(b.end_date || b.date) * 1440 + toMinsOfDay(b.end_time);
          const sessionOver = endAbs <= nowAbs;
          let bayWasDown = false;
          if (!sessionOver && startAbs <= nowAbs) {
            // did a prior booking on this bay shut down right before this start?
            const priors = dbModule.db.prepare(
              `SELECT end_time, end_date, date FROM bookings
                WHERE bay_id = ? AND id != ? AND shutdown_sent = 1
                  AND status IN ('active','completed','expired')
                  AND (date = ? OR end_date = ?)`
            ).all(b.bay_id, b.id, b.date, b.date);
            for (const p of priors) {
              const pEndAbs = dayIndex(p.end_date || p.date) * 1440 + toMinsOfDay(p.end_time);
              // this booking's start sits inside the prior shutdown's dead zone
              if (startAbs >= pEndAbs && startAbs < pEndAbs + guardMins) { bayWasDown = true; break; }
            }
          }

          // (c) SOMEBODY ELSE IS IN THAT SLOT (maintainer, Sep 19 2026, the redirect
          //     review). This branch only ever runs AFTER the hold lapsed - the
          //     moment the product deliberately gives the slot back to other
          //     customers - and it restored the booking without ever looking to
          //     see whether the slot had been sold in the meantime. Two active
          //     bookings on one bay at one time, and the second customer finds
          //     someone in their bay. The trunk that answers this for every
          //     other surface answers it here too.
          let slotTaken = false;
          if (!sessionOver && !bayWasDown) {
            try {
              const core = require('./bookingcore');
              slotTaken = !core.isBayFree({
                bay_id: b.bay_id, date: b.date, start_time: b.start_time,
                duration_minutes: Number(b.duration_minutes) || 60,
                end_time: b.end_time, end_date: b.end_date,
                excludeId: b.id          // the trunk's name for it - NOT excludeBookingId
              });
            } catch (e) { slotTaken = false; }   // rule 31: unknown is not a refusal
          }
          // (d) THE PAYMENT LANDED AFTER THE START (maintainer, Sep 27 2026): a started slot is not for sale,
          //     so a payment that went through once the session had begun - the customer's browser
          //     never came back to say so - is refunded, the booking cancelled, the customer told.
          //     A session that has ENDED as well keeps the branch below (it already refunds).
          let paidLate = null;
          if (!sessionOver && startAbs <= nowAbs) {
            try { const l = await require('./startedslot').landedAfterStart(stripeC, piObj, b); if (l.after) paidLate = l; } catch (e) {}
          }
          if (paidLate) {
            await require('./startedslot').refundStartedPayment(stripeC, b, { source: 'the pending-payment sweeper', chargeId: paidLate.chargeId, minsAgo: nowAbs - startAbs });
          } else if (sessionOver || bayWasDown || slotTaken) {
            // Refund the good payment and mark expired - never keep money for a
            // dead/elapsed session. Charge first, payment_intent fallback (#18 lineage).
            let refunded = false;
            try {
              if (stripeC) {
                let chargeId = b.stripe_charge_id;
                if (!chargeId && b.stripe_payment_intent) {
                  try { const pi2 = await stripeC.paymentIntents.retrieve(b.stripe_payment_intent); if (pi2 && pi2.latest_charge) chargeId = pi2.latest_charge; } catch {}
                }
                const opts = chargeId ? { charge: chargeId } : { payment_intent: b.stripe_payment_intent };
                opts.metadata = require('./stripemark').marker();   // rule 25: ours (the sixth refund site - the lockstep missed this file)
                const rf = await stripeC.refunds.create(opts, { idempotencyKey: 'rf-lapsed-' + b.id });
                try { dbModule.markRefunded(b.id, null, rf, 'lapsed-checkout'); } catch (e) {}
                refunded = true;
              }
            } catch (e) { /* fall through to manual-refund log */ }
            dbModule.db.prepare(
              "UPDATE bookings SET status='expired', updated_at=datetime('now') WHERE id=? AND status='pending_payment'"
            ).run(b.id);
            releaseHeldValue(b, 'booking refunded - the session could not happen');
            if (refunded) {
              adminLog('BOOKING_LAPSED_REFUNDED', `${b.name} ${b.date} ${b.start_time} on ${b.bay_name} — paid but ${sessionOver ? 'the session had already ended' : bayWasDown ? 'the bay was down at start' : 'the slot had already been sold to someone else while their checkout lapsed'}; refunded automatically`);
              // AND TELL THE PERSON. This is the one cancellation the customer
              // did not ask for, and it was the only one in the product that
              // said nothing - they would have arrived expecting a bay.
              try {
                const why = sessionOver ? 'the session time had already passed'
                          : bayWasDown ? 'that bay was unavailable at your start time'
                          : 'the slot was taken while your checkout was still open';
                await require('./notifycancel').tellCustomerRefunded(b, why);
              } catch (e) {
                adminLog('NOTIFY_FAILED', `Refunded booking ${b.id} - the customer could not be told: ${e.message}`);
              }
            }
            else {
              adminLog('REFUND NEEDED (manual)', `${b.name} ${b.date} ${b.start_time} on ${b.bay_name} — paid but undeliverable (${sessionOver ? 'session over' : 'bay down'}); AUTOMATIC REFUND FAILED, refund by hand`);
            }
          } else {
            // deliverable - restore the session as before
            dbModule.db.prepare(
              "UPDATE bookings SET status='active', confirmed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='pending_payment'"
            ).run(b.id);
            adminLog('BOOKING_REACTIVATED', `Paid but pending-expired: ${b.name} ${b.date} ${b.start_time} — payment verified with Stripe, booking restored`);
            // THE ONE TERMINAL PATH THAT NEVER CALLED THE TRUNK (maintainer, Sep 19
            // 2026, the redirect review). This branch is how a paid booking
            // becomes real when the customer's browser never came back - the
            // ONLY path a Klarna/Affirm/Cash App payment could take before the
            // return handler existed, and still the path for anyone whose
            // connection drops after paying. It flipped the row to active and
            // stopped: the waiver signature was never recorded, a gift card
            // spent on the booking kept its whole balance, and the member's
            // hours were never counted. That is the pilot facility loss, re-opened in
            // the one place nobody looks. recordAll is idempotent on the
            // booking id, so a later /confirm for the same row writes nothing
            // twice.
            try {
              require('./bookingledger').recordAll(b.id, { source: 'sweeper-reactivate' });
            } catch (e) {
              adminLog('LEDGER_FAILED', `Reactivated booking ${b.id} - its records could not be written: ${e.message}`);
            }
            // and the work that /confirm does on activation: cancel a prior
            // session's pending shutdown and drive this one without waiting a
            // full tick.
            try { require('./automation').cancelBayShutdownJobs(b.bay_id, b.id); } catch (e) {}
            // AND TELL THEM. The page they left promised an email; /confirm
            // sends it and this branch never did, so a customer rescued by the
            // sweeper had a real booking and no way to know (maintainer, Sep 19 2026).
            try {
              const row = dbModule.db.prepare(`SELECT * FROM bookings WHERE id=?`).get(b.id);
              if (row) await require('../routes/bookings').sendBookingNotifications(b.id, row, row);
            } catch (e) {
              adminLog('NOTIFY_FAILED', `Reactivated booking ${b.id} - the customer could not be told: ${e.message}`);
            }
          }
        } else if (verdict === 'expire') {
          // A1 (Sep 11 2026, the money map): the intent the customer was holding
          // used to be left OPEN when the checkout expired - a card confirmed a
          // minute after the sweep charged the customer for a slot that had just
          // been given back (and /confirm re-activated the expired row with no
          // slot re-check). Cancel the intent FIRST; if Stripe refuses because it
          // has already succeeded in the meantime, defer - the next sweep
          // reactivates or refunds through the branch above. Only an intent that
          // is now cancelled (or never existed) lets the row expire.
          let intentState = 'none';
          if (stripeC && b.stripe_payment_intent) {
            // Stripe refuses to cancel an intent that is already cancelled, and a
            // refusal here means "defer" - so asking again would have kept the row
            // pending for ever. Read the answer already in hand first.
            if (piStatus === 'canceled') intentState = 'already';
            else {
              try { await stripeC.paymentIntents.cancel(b.stripe_payment_intent); intentState = 'cancelled'; }
              catch (e) { intentState = 'defer'; }
            }
          }
          if (intentState === 'defer') { adminLog('CHECKOUT_EXPIRY_DEFERRED', `${b.name} ${b.date} ${b.start_time} on ${b.bay_name} - the intent could not be cancelled (it may have just succeeded); left pending for the next sweep`); continue; }
          dbModule.db.prepare(
            "UPDATE bookings SET status='expired', updated_at=datetime('now') WHERE id=? AND status='pending_payment'"
          ).run(b.id);
          adminLog('CHECKOUT_EXPIRED', `${b.name} ${b.date} ${b.start_time} on ${b.bay_name} - checkout abandoned past the ${require('./bookingcore').holdMins()}-minute hold; ${intentState === 'cancelled' ? 'payment intent cancelled, card NOT charged' : intentState === 'already' ? 'the payment had already been cancelled, card NOT charged' : 'no payment intent to cancel'}; slot released`);
          // any code or gift-card use stamped on the row goes back (idempotent; the
          // same release every cancel path uses)
          releaseHeldValue(b, 'booking expired unpaid');
        }
        // 'defer': leave pending_payment — retried on the next sweep
      }
    }

    // ── MARK SESSIONS AS COMPLETE ─────────────────────────────────────────
    // A session is complete once end_date + end_time has passed. Using end_date
    // (not the start date) is essential for sessions that cross midnight.
    const nowStr    = padDate(now);
    const nowTime   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const completed = dbModule.db.prepare(
      `SELECT id FROM bookings WHERE status='active'
       AND (COALESCE(end_date, date) < ? OR (COALESCE(end_date, date) = ? AND end_time <= ?))`
    ).all(nowStr, nowStr, nowTime);
    if (completed.length) {
      dbModule.db.prepare(
        `UPDATE bookings SET status='completed', updated_at=datetime('now')
         WHERE status='active'
         AND (COALESCE(end_date, date) < ? OR (COALESCE(end_date, date) = ? AND end_time <= ?))`
      ).run(nowStr, nowStr, nowTime);
    }
  } catch(e) {
    // ignore
  }
  // the switch-offs nothing else will claim (Oct 21 2026): after the bookings' own passes, so each pass decides its own first
  try { await sweepCancelledCleanup(cfg, now, { orphans: true }); } catch (e) { console.error('left-waiting switch-offs:', e.message); }
  // a member change the door console has not taken yet (signup, PIN, lapse, doors) - retried
  // with backoff until it does (services/memberaccess, Sep 25 2026). LAST in the tick (the build
  // review): up to ten members against a console that does not answer is minutes of waiting, and
  // it used to come before the bookings - every bay's plug, TV and wake waited behind a door.
  try { await require('./memberaccess').reconcileDue(); } catch (e) { console.error('member door access:', e.message); }
}

function startScheduler() {
  console.log('Scheduler started - checking every minute');
  // members the old code put on a UniFi console carry no record of what was set: adopt them
  // once, so the first reconcile does not re-send a PIN the console already holds (rule 14)
  try { require('./memberaccess').adoptLegacy(); } catch {}
  reopenEarlySkips();
  try { require('./devicelog').prune(); } catch {}
  // ARM THE CHECKOUT SIGNAL ONCE, AT THE FIRST BOOT ON THIS CODE (maintainer, Sep 20
  // 2026). Its history half counts three failures that only this code writes,
  // and a unit must not arrive red for a fortnight of its own past. The first
  // boot lays down the line; every boot after finds it already there.
  try {
    const D = require('./db').db;
    const armed = D.prepare(`SELECT 1 AS x FROM admin_log WHERE event='CHECKOUT_SIGNAL_ARMED' LIMIT 1`).get();
    if (!armed) require('./db').adminLog('CHECKOUT_SIGNAL_ARMED',
      'The online-checkout health signal starts counting from here - nothing before this line is counted against this unit');
  } catch (e) {}
  // THE REPAIR, AT BOOT, BEFORE THE FIRST TICK (maintainer, Sep 27 2026): a unit that ran the older code may
  // already carry door removal jobs a staff cancel or move left waiting - each one holding the health
  // line red. They are deleted here and the owner's log says so; the tick deletes any later one quietly.
  try {
    const spent = require('./automation').dropSpentDoorRevokes();
    if (spent.length) require('./db').adminLog('DOOR_JOBS_REPAIRED', `${spent.length} door removal task(s) left waiting by an earlier cancel or move were removed - their codes were already off the lock | Booking: ${spent.join(', ')}`.slice(0, 480));
  } catch (e) {}
  require('./unithealth').noteTick();
  checkBookings().catch(err => console.error('Scheduler startup check error:', err.message)).then(() => { try { require('./unithealth').refresh(); } catch {} });
  // a Home Assistant lock reports the keypad being used - subscribe once, reconnect on its own
  // ONLY WHILE HOME ASSISTANT IS THE DOOR (Oct 3 2026, the pack review): a lock entity left saved after the owner switched
  // to RemoteLock or UniFi kept these running - a fresh backup code written into the old lock every night, and with its box
  // unplugged a DOOR_BACKUP_CODE_ERROR in the owner's log every night. The tick's watch() starts the events when HA is chosen.
  const haIsTheDoor = () => String((getConfig().doorAccess || {}).provider || '').toLowerCase() === 'ha';
  try { if (haIsTheDoor()) require('./hadoor').startEvents(); } catch (e) {}
  // (Oct 19 2026): the box's own Home Assistant is set up by the unit - its first run, its token, its radios.
  // Nothing at all on a unit without it built in (rule 31); a hub still starting is tried again quietly.
  try { require('./hasetup').startBoot(); } catch (e) {}
  // after a restart (or a power cut that took the unit down with Home Assistant), the lock is put back
  // to this unit's record once the world has settled
  try { setTimeout(() => { try { const hd = require('./hadoor'); if (String((getConfig().doorAccess || {}).provider || '').toLowerCase() === 'ha' && hd.configured()) hd.reconcile('after a restart').catch(() => {}); } catch {} }, 60000).unref(); } catch (e) {}
  // (the wall keypad and the unit's own Z-Wave stick live on feature/door-interface, not here - rule 40)
  // THE BACKUP CODE EXISTS BEFORE IT IS NEEDED: set at boot and rotated in the
  // quiet hour, never minted at the moment a lock is refusing everything.
  try { const hd = require('./hadoor'); if (haIsTheDoor() && hd.configured()) hd.ensureBackup(false).catch(() => {}); } catch (e) {}
  cron.schedule('* * * * *', () => {
    // rule 23 (A-wave 5): the health line is refreshed by the tick that would have to be dead for it to lie
    require('./unithealth').noteTick();
    checkBookings().catch(err => console.error('Scheduler error:', err.message))
      // every two minutes, is each smart plug still on the network? (services/deviceprobe - the
      // server's own loop only, so a one-shot tick never waits on a plug)
      .then(() => require('./deviceprobe').probe().catch(e => console.error('device probe:', e.message)))
      .then(() => { try { require('./unithealth').refresh(); } catch {} });
    // W29: the scheduled hours export. Its own ledger row per period, so a
    // missed moment (unit off) fires on the next tick and never twice.
    require('./hourssend').tick().catch(err => console.error('Hours send error:', err.message));
    // the newsletter (Oct 19 2026): the next paced group of a send in progress - silent when there is none
    require('./newsletter').tick().catch(err => console.error('Newsletter error:', err.message));
    // Sep 12 2026 (maintainer): a reader payment is verifiable without a webhook - every minute, the intents
    // still waiting are asked of Stripe and finalized or failed exactly as the webhook would
    require('./terminal').reconcileWaiting().catch(err => console.error('Terminal reconcile error:', err.message));
  });
  require('./hourssend').tick().catch(err => console.error('Hours send startup:', err.message));
  // a newsletter row being sent when the unit stopped is never sent again; then the send carries on
  try { require('./newsletter').recover(); } catch (e) { console.error('Newsletter recover:', e.message); }
  require('./newsletter').tick().catch(err => console.error('Newsletter startup:', err.message));
  if (process.env.BA_TEST_NEWSLETTER_TICK_MS) setInterval(() => { require('./newsletter').tick().catch(() => {}); }, Number(process.env.BA_TEST_NEWSLETTER_TICK_MS));
  require('./terminal').reconcileWaiting().catch(err => console.error('Terminal reconcile startup:', err.message));
  // Nightly automatic backup at the configured hour (default 3 AM local):
  // local zip on the primary drive + copies to any chosen SD/USB destination,
  // each verified and independent (Backup Wave, Aug 2026).
  cron.schedule('0 * * * *', () => {
    require('./backup').maybeNightlyTick().catch(err => console.error('Auto-backup error:', err.message));
  });
  // Retire completed automation records so the "did I already do this?"
  // ledger cannot grow forever (maintainer, Aug 11). Far outside the scheduler's
  // 3-day sweep, so a pruned row can never be re-created and re-fired.
  cron.schedule('30 4 * * *', () => {
    try { require('./automation').pruneOld(30); } catch (e) { console.error('Automation prune:', e.message); }
    // rotate the lock's standing backup code daily, at a quiet hour
    try { const hd = require('./hadoor'); if (haIsTheDoor() && hd.configured()) hd.ensureBackup(true).then(() => String((getConfig().doorAccess || {}).provider || '').toLowerCase() === 'ha' ? hd.reconcile('nightly') : null).catch(() => {}); } catch (e) {}
  });
  // Membership billing maintenance at 4:15 AM: reconcile subscriptions from
  // Stripe, enforce per-tier grace on past-due members, send annual renewal
  // reminders. Also registers the Stripe webhook at boot when possible.
  const lifecycle = require('./membership-lifecycle');
  lifecycle.ensureWebhookRegistered().catch(() => {});
  lifecycle.runMaintenance().catch(err => console.error('Membership maintenance startup:', err.message));
  cron.schedule('15 4 * * *', () => {
    lifecycle.runMaintenance().catch(err => console.error('Membership maintenance error:', err.message));
  });
  // REFUNDS MADE IN STRIPE'S DASHBOARD (maintainer, Sep 24 2026): asked of Stripe at boot and
  // at 4:20 every night - never depending on the webhook - so a refund an owner made
  // there comes off revenue before the records' nightly (4:45) can freeze a year.
  require('./refunds').checkStripe().catch(err => console.error('Refund check startup:', err.message));
  // GIFT CARDS PAID AFTER THE BUYER LEFT THE PAGE (Oct 3 2026): Klarna, Cash App, a bank payment, a browser that never
  // came back - asked of Stripe at boot and every ten minutes, never depending on the webhook (services/gifts.js)
  const giftCheck = () => require('./gifts').reconcilePaidIntents().then(n => { if (n) adminLog('GIFTCARD_RECONCILE', `${n} paid gift card(s) issued that the page had not finished`); }).catch(err => console.error('Gift reconcile:', err.message));
  giftCheck();
  cron.schedule('*/10 * * * *', giftCheck);
  cron.schedule('20 4 * * *', () => {
    require('./refunds').checkStripe().catch(err => console.error('Refund check error:', err.message));
  });
  // THE FACILITY, STUDIED IN ITS QUIET HOURS (Oct 25 2026; maintainer: "the Ai will.learn and study the facility in down
  // times"): at 4:30 the month-by-month trends and each special's effect are worked out from the records and kept, so the owner's
  // question is answered at once (services/study.js). Read-only; what it keeps is worked out again whenever it is asked and old.
  cron.schedule('30 4 * * *', () => { try { require('./study').runNightly(); } catch (err) { console.error('Facility study:', err.message); } });
  // Records & retention at 4:45 - AFTER the nightly backup window, so the
  // night's backup still holds the pre-purge state. Warns the owner 90 days
  // before a year purges; anonymizes person detail past the retention floor
  // (10 years, maintainer's doctrine Aug 25 2026). Facility numbers are never touched.
  cron.schedule('45 4 * * *', () => {
    require('./records').runNightly().catch(err => console.error('Records retention error:', err.message));
  });
  // UniFi visitor sweep at 5:00 (W32) - after the backup window and records:
  // removes expired visitors the appliance itself created and the per-booking
  // revoke never reached. Only the UniFi provider; only our own visitors.
  cron.schedule('0 5 * * *', () => {
    // the command ledger's 180 days, each night as well as at boot (the build review: a unit that
    // runs for months without a restart never pruned it) - first, before anything returns early
    try { require('./devicelog').prune(); } catch {}
    // RemoteLock, the PRIMARY provider: look for codes at the lock that this unit
    // has no record of. The undefined-credential bug (fixed Sep 16 2026) could
    // leave working PINs there that nothing could name, so nothing could revoke
    // them. This REPORTS - it is the customer's own lock account and rule 25 says
    // we touch only what we can prove is ours; the owner clears what it names.
    try {
      if (String((getConfig().doorAccess || {}).provider || 'remotelock').toLowerCase() === 'remotelock') {
        require('./remotelock').findOrphanedCodes()
          .then(o => { if (o && o.error) console.error('RemoteLock orphan check:', o.error); })
          .catch(err => console.error('RemoteLock orphan check:', err.message));
      }
    } catch (e) { console.error('RemoteLock orphan check:', e.message); }
    try {
      if ((getConfig().doorAccess || {}).provider !== 'unifi') return;
      const ua = require('./unifiaccess');
      // Rule 25 at the door (maintainer, Sep 16 2026): what this unit created BEFORE the
      // marker existed is adopted by its own references, once, before the sweep
      // ever runs - so the sweep can be strict about what it is allowed to
      // remove without abandoning the visitors we made last week. Stamped in
      // config; a deferred adoption (console unreachable) simply retries
      // tomorrow and the sweep does nothing in the meantime, which is the safe
      // way round. Same shape as stripemark.adoptReferenced.
      ua.adoptOurVisitors()
        .then(a => { if (a && a.did === 'deferred') { console.error('UniFi visitor adoption deferred:', a.error); return null; } return ua.sweepExpiredVisitors(); })
        // then every member this unit has on the console, from its own record: takes back any
        // access a crash or an outage left behind (Sep 25 2026)
        .then(() => require('./memberaccess').reconcileAll())
        .then(r => { if (r && (r.ok || (r.failed || []).length)) require('./db').adminLog('UNIFI_MEMBERS_NIGHTLY', `${r.ok} member(s) checked against the console, ${(r.failed || []).length} not taken yet (retried by the minute)`); })
        .catch(err => console.error('UniFi visitor sweep error:', err.message));
    } catch (e) { console.error('UniFi visitor sweep:', e.message); }
  });
}

// ── RESTARTING A BAY PC BEFORE THE NEXT GROUP (maintainer, Oct 2 2026) ───────────────
// The same net-rpc channel as the shutdown and the bay buttons' Restart (simulator.sendRestart:
// `net rpc shutdown -r -f`). A PC that does not answer on the network is off or unreachable: there
// is no game on it to clear, so that is not a failure (rule 31) - it is said, and nothing is retried.
// A PC that answers and refuses the restart is a failure (rule 29): the job backs off and retries.
const RESTART_LEAD_MINS = 10;    // the reserved screen lifts this many minutes before the next session (the watcher's UNLOCK_MINS)
const RESTART_LATEST_MINS = 5;   // a booking made later than this before its start gets no restart - the group may be there
// A REFUSED RESTART IS NOT RETRIED INTO THE SESSION (Oct 3 2026, the pack review; pilot facility's guide: "the PC answered, so the
// group still has a working PC"): the reserved screen lifts at the ten minutes and a group arriving early may already be
// setting up. A refusal gets ONE retry; after that it is recorded as missed (the owner sees it on the health line) and
// never sent. The deadline stays at five so a tick that runs a little late still makes the first try.
// THE RETRY IS REAL (the review, Oct 3 2026): the window was the first minute, to the second - the refusal's one-minute
// backoff lands on the very tick that wrote it off, so no retry was ever sent and any blip read "missed" for two days.
// The backoff's minute ends a few seconds past the next tick, so the tick after that takes it: the window runs to
// eight minutes before the start, and thirty seconds past it for a tick that runs late.
const RESTART_RETRY_MINS = 2;
const RESTART_RETRY_SLACK_MS = 30000;
async function restartBayPc(bayObj) {
  const ip = String((bayObj && bayObj.simulatorPcIp) || '').trim();
  if (!ip) return;
  mustHaveWorked(`restart ${bayObj.name}`, await sendRestart(bayObj, 0));
}
/** May this bay's PC be restarted before this session? The last session on the bay (or a whole-facility one)
 *  ending at or before this start, the same day or the day before: back to back, or a gap the watcher never
 *  covers (10 minutes or less) - no, the same group may be playing on. Any longer gap, or no session found -
 *  yes, a candidate: whether the PC is really on, behind the reserved screen, is read when the job fires (maintainer,
 *  Oct 3 2026). Answers false, or { prevEndMs } (null when no session was found) for the watcher check. */
function pcRestartCandidate(bayId, booking) {
  const startAbs = absStartOf(booking);
  const prevDay = (() => { const [y, m, d] = booking.date.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - 1); return padDate(dt); })();
  let prev = null;
  for (const r of dbModule.db.prepare(
    `SELECT id, date, start_time, end_time, end_date FROM bookings
      WHERE (bay_id = ? OR whole_facility = 1) AND id != ? AND status IN ('active','completed') AND (date = ? OR date = ?)`
  ).all(bayId, booking.id, booking.date, prevDay)) {
    const e = absEndOf(r);
    if (e <= startAbs && (!prev || e > prev._end)) { prev = r; prev._end = e; }
  }
  if (!prev) return { prevEndMs: null };
  const gap = startAbs - prev._end;
  if (gap <= RESTART_LEAD_MINS) return false;
  const [y, m, d] = String(prev.end_date || prev.date).split('-').map(Number), [hh, mm] = String(prev.end_time).split(':').map(Number);
  return { prevEndMs: new Date(y, m - 1, d, hh, mm).getTime() };
}
/** Is anyone playing on this bay at this moment (a session other than this one, or a whole-facility one)? */
function sessionOnBayNow(bayId, exceptId, now) {
  const nowAbs = nowAbsMins(now);
  return dbModule.db.prepare(
    `SELECT id, date, start_time, end_time, end_date FROM bookings
      WHERE (bay_id = ? OR whole_facility = 1) AND id != ? AND status = 'active' AND (date = ? OR end_date = ?)`
  ).all(bayId, exceptId, padDate(now), padDate(now)).some(r => absStartOf(r) <= nowAbs && nowAbs < absEndOf(r));
}

// ── A CUSTOMER AWAY ON A PAYMENT PROVIDER'S PAGE (Oct 2 2026) ─────────────────
// [S1] Stripe API, The PaymentIntent object: `payment_method` - "ID of the payment method used in this
//      PaymentIntent", expandable into the object; `status` `requires_action` - "requires additional action
//      from the customer" (https://docs.stripe.com/api/payment_intents/object, read Oct 2 2026).
// [S2] The same page, payment method types: `card` - "Card payments are supported through many networks,
//      card brands, and select Link funding sources"; `link` - "allows customers to pay with their saved
//      payment details". Every other type (klarna, affirm, afterpay_clearpay, cashapp, amazon_pay, paypal,
//      ...) is completed on the provider's side.
const AWAY_GRACE_MINS = 30;
function awayOnProvider(pi) {
  const pm = pi && pi.payment_method;
  const type = pm && typeof pm === 'object' ? String(pm.type || '') : '';
  return !!type && type !== 'card' && type !== 'link';
}
function minsSinceCreated(b) {
  const t = Date.parse(String(b && b.created_at || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : Infinity;
}

module.exports = { sessionOnOrNear,
  sweepLiveDoorCodes, liveDoorCredentials, sweepCancelledCleanup, checkBookings, reopenEarlySkips,  startScheduler, _findNextBooking: findNextBooking, irJobKey };
