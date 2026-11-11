// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/remotelock.js  —  RemoteLock provider (single door)
//
//  Generates time-limited PIN codes via the RemoteLock REST API.
//  Docs: https://developer.remotelock.com/api/docs
// ═══════════════════════════════════════════════════════════════════════════════

const axios         = require('axios');
const { getConfig } = require('./config');
const { adminLog }  = require('./db');

// TEST SEAM, the same shape unifiaccess.STYLES has: a battery stands a lock API
// up on an unprivileged port and repoints these. Production never touches it.
// Until Sep 16 2026 RemoteLock - the PRIMARY provider, the one proven at a live
// facility - had NO stand-in and NO battery of its own, while the UniFi extra had
// three. Every failure state below was therefore unexercised.
// EVERY CALL TO THE LOCK IS BOUNDED (maintainer, Sep 21 2026, pilot facility's section 4). These
// had no timeout at all, so a hung RemoteLock request outlived the automation
// job's lease - and the next tick, finding the job free again, created a SECOND
// guest for the same booking: two PINs issued, one of them an orphan with a live
// code and nothing pointing at it. Fifteen seconds is what pilot facility settled on after
// the same finding. A bounded call fails honestly and the job retries with
// backoff, which is what rule 29 wants.
const RL_TIMEOUT_MS = 15000;
const ENDPOINTS = {
  base: process.env.BA_REMOTELOCK_BASE || 'https://api.remotelock.com',
  auth: process.env.BA_REMOTELOCK_AUTH || 'https://connect.remotelock.com/oauth/token'
};


/** Format a Date as local time string — RemoteLock interprets times as local */
function fmtLocal(dt) {
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}` +
         `T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

/** Get a fresh OAuth token (valid 2 hours) */
async function getToken() {
  const { clientId, clientSecret } = getConfig().remotelock;
  if (!clientId || clientId.startsWith('PASTE') || clientId === '') {
    throw new Error('RemoteLock not configured');
  }
  const res = await axios.post(ENDPOINTS.auth,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: RL_TIMEOUT_MS }
  );
  return res.data.access_token;
}

/**
 * Create a time-limited access guest and grant them device access.
 * Returns { pin, personId }
 */
async function generateDoorCode(booking) {
  const cfg = getConfig();
  // Owner-set lead/lag window - shared helper (also day-aware via end_date).
  const { startDt, endDt } = require('./doorlock').codeWindow(booking);

  const token = await getToken();
  const headers = {
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept:         'application/json'
  };

  // Create access guest with auto-generated PIN
  const personRes = await axios.post(`${ENDPOINTS.base}/access_persons`, {
    type: 'access_guest',
    attributes: {
      name:         `Golf - ${booking.name} - ${booking.date} ${booking.start_time}`,
      starts_at:    fmtLocal(startDt),
      ends_at:      fmtLocal(endDt),
      generate_pin: true
    }
  }, { headers, timeout: RL_TIMEOUT_MS });

  // READ WHAT CAME BACK - BUT NEVER REFUSE A REPLY THAT WORKS TODAY.
  // (maintainer, Sep 16 2026: "it works perfectly at a live facility today and has for
  // months, so that facility's real behaviour is the reference - not the
  // documentation, and not what you expected the reply to look like.")
  //
  // My first cut of this hardening got that backwards. It refused any PIN that
  // did not match /^\d{4,10}$/ and refused any reply without an id - two shapes
  // I have never actually seen, on the provider that is the default and is proven
  // in production. The three bugs worth fixing here were all about handling a BAD
  // reply gracefully ('CHECK_APP' invented and handed to a customer; a guest left
  // at the lock when the door grant failed; the word "undefined" recorded as a
  // credential) - none of them was about refusing a good one.
  //
  // So the rule is: issue the code and flag it wherever there is doubt. A customer
  // standing at a door with no code is worse than a code we are unsure about. And
  // every refusal below says in the owner's log exactly what came back and why it
  // could not be used.
  const person = personRes && personRes.data && personRes.data.data;
  const attrs = (person && person.attributes) || {};
  const personId = (person && person.id) ? String(person.id) : '';
  // Whatever the lock called it. NOT coerced to a shape - only trimmed.
  const pin = String(attrs.pin ?? attrs.access_pin ?? attrs.code ?? '').trim();
  const sawKeys = Object.keys(attrs).join(',') || '(no attributes)';

  if (!pin) {
    // The one real 'CHECK_APP' case: the lock gave us no PIN at all. There is
    // nothing to give the customer, so this booking has no code - say what the
    // reply actually contained rather than inventing five letters.
    const r = personId ? await revokeDoorCode(personId) : { ok: true, note: 'no guest to remove' };
    adminLog('DOOR_CODE_ERROR', `Booking: ${booking.id} | RemoteLock returned NO PIN for guest ${personId || '(no id)'} - the reply carried [${sawKeys}]` + (r && r.ok ? ' - guest removed' : ` - AND THE REMOVAL FAILED: ${r && r.error}`));
    throw new Error('RemoteLock did not return a PIN for this booking');
  }
  if (!/^\d{4,10}$/.test(pin)) {
    // An unusual shape is NOT a refusal. The lock issued it, so it is what opens
    // the door; we pass it on and make sure a human can see it was odd.
    adminLog('DOOR_CODE_UNUSUAL', `Booking: ${booking.id} | RemoteLock issued a PIN in an unexpected shape (${pin.length} chars) - it is being used as given; if customers cannot get in, this is the first thing to check`);
  }
  if (!personId) {
    // A working PIN and no id to revoke it by. Before today this recorded the
    // word "undefined" as the credential; refusing instead would take a working
    // code away from a customer to fix OUR bookkeeping. Issue it, record no
    // pointer (so nothing pretends it can revoke it), and say so loudly - the
    // nightly orphan check finds guests exactly like this one.
    adminLog('DOOR_CODE_UNTRACKED', `Booking: ${booking.id} | RemoteLock issued a PIN but returned no guest id - the code WORKS and the customer has it, but this system cannot revoke it. The nightly check will list it; remove it at the lock when the booking is over. Reply carried [${sawKeys}]`);
  }

  // Grant access to the configured lock device. THE GUEST ALREADY EXISTS AND
  // ALREADY HAS A PIN at this point, so a failure here leaves a code at the lock
  // with no door - and, before this, an exception that stranded it with nothing
  // recording its id. Clean up, and say so if the cleanup fails too.
  if (!personId) {
    // nothing to grant against, and nothing to clean up - the code is the
    // customer's and the orphan check owns the tidy-up
    adminLog('DOOR_CODE_CREATED', `Booking: ${booking.id} | code issued (${String(pin).length} digits) | Person: (none returned)`);
    return { pin, personId: '' };
  }
  try {
    await axios.post(`${ENDPOINTS.base}/access_persons/${personId}/accesses`, {
      type: 'access',
      attributes: {
        accessible_id:   cfg.remotelock.deviceId,
        accessible_type: 'lock'
      }
    }, { headers, timeout: RL_TIMEOUT_MS });
  } catch (e) {
    const r = await revokeDoorCode(personId);
    adminLog('DOOR_CODE_ERROR', `Booking: ${booking.id} | the guest was created but the door grant failed (${e.message})` + (r && r.ok ? ' - guest removed' : ` - AND THE REMOVAL FAILED: ${r && r.error}`));
    throw new Error(`RemoteLock created the code but could not grant it the door (${e.message})`);
  }

// A DOOR CODE IS NEVER WRITTEN INTO THE OWNER'S LOG (maintainer, Sep 21 2026).
// admin_log is kept by AGE - at least twelve months (rule 6) - and rides inside
// every backup that leaves the unit, so a PIN in the clear here outlives by
// months the session it was made for. Unlike the bay PC's Windows password
// (masked Sep 16), this is not the owner's own credential: it is a CUSTOMER'S
// physical key to someone else's building. The event, the booking and the
// person id are what the owner actually needs to trace a door problem; the
// code itself they can read on the booking or at the lock. Nothing in the tree
// ever read the PIN back out of the log.
  adminLog('DOOR_CODE_CREATED', `Booking: ${booking.id} | code issued (${String(pin).length} digits) | Person: ${personId}`);
  return { pin, personId };
}

/** Revoke access when a booking is cancelled */
// A-wave 11b (Sep 13 2026): it REPORTS. This swallowed its own errors and resolved
// either way, so every caller that then cleared the booking's credential pointer
// erased the only record of a code that is still live at the lock - and said in the
// owner's log that it had been revoked. Still never throws; the caller reads .ok.
async function revokeDoorCode(personId) {
  if (!personId) return { ok: true, note: 'nothing to revoke' };
  try {
    const token = await getToken();
    await axios.delete(`${ENDPOINTS.base}/access_persons/${personId}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: RL_TIMEOUT_MS
    });
    adminLog('DOOR_CODE_REVOKED', `Person: ${personId}`);
    return { ok: true };
  } catch (err) {
    // A person the lock no longer knows is already gone: that IS revoked.
    const code = err && err.response && err.response.status;
    if (code === 404) { adminLog('DOOR_CODE_REVOKED', `Person: ${personId} (already gone at the lock)`); return { ok: true, note: 'already gone' }; }
    console.error('RemoteLock revoke error:', err.message);
    adminLog('DOOR_CODE_REVOKE_ERROR', err.message);
    return { ok: false, error: String(err.message).slice(0, 200) };
  }
}

// ═══ ORPHANED CODES AT THE LOCK (maintainer, Sep 16 2026) ═══════════════════════════
// The undefined-credential bug (fixed above) could leave a guest at the lock with
// a working PIN that this unit had no id for - so nothing could ever revoke it,
// and no facility had any way to find out. Any RemoteLock facility may have one
// or more sitting there right now.
//
// DOCUMENTED (developer.remotelock.com/api/docs, read 2026-09-16), which is why
// this can be built at all: GET /access_persons pages with `page` / `per_page`
// (default 25, max 50) and returns `meta` carrying page, per_page, total_count
// and total_pages; `attributes[status]` filters by current / upcoming /
// deactivated / expired and DEFAULTS TO current and upcoming only, so a sweep
// looking for stale guests must ask for the other two explicitly; each person
// carries id, type, name, status and, for guests, starts_at and ends_at.
//
// It REPORTS, it does not delete. Everything it finds was made by this product,
// but the only thing tying a row to us is the name we wrote, and that is a
// customer's own lock account: rule 25 says we touch only what we can prove is
// ours, so the owner is shown the list and clears it themselves.
/** WHAT WE CAN AND CANNOT PROVE ABOUT A GUEST AT A REMOTELOCK (Sep 17 2026).
 *  UniFi stamps every visitor `BA:<unit id> Booking <id>` in its remarks, so
 *  ownership there is provable and unit-scoped (rule 25). RemoteLock has only
 *  the NAME we set, `Golf - <customer> - <date> <time>`, and nothing in it
 *  names this unit or the booking. So a guest matching this pattern is one that
 *  LOOKS like ours - a facility's own guest called "Golf - Tuesday league" is
 *  indistinguishable, and so is a second BA unit's guest on the same account.
 *  That is fine for a report and NOT fine for an instruction: the owner was
 *  being told these "were created by this system" and to go and delete them.
 *  Bringing the two providers level means putting a unit marker in the name at
 *  creation, which changes what the PRIMARY provider - proven at a live facility
 *  for months - sends to the lock. That needs a console to try it against
 *  (OPEN-AND-PARKED, section 1), so until then the words match what we know. */
const OUR_GUEST_NAME = /^Golf - /;

/** Every access person the lock holds, paged properly off `meta.total_pages`. */
/** Pages this read will ask the customer's lock account for in one night.
 *  40 x 50 = 2,000 people. The ceiling used to be 200 pages PER STATUS - up to
 *  800 requests every night at a facility with years of expired guests, which is
 *  how a unit gets itself rate-limited on the very account it issues real door
 *  codes through. The statuses are read in danger order, so a budget that runs
 *  out can only ever cost us DEAD guests: 'current' and 'upcoming' are the ones
 *  that can still open a door and they are read first. (Sep 17 2026.) */
const PERSON_PAGE_BUDGET = 40;

/** @param report - optional object this fills in with how the read went:
 *  { pages, truncated, statusesRead }. A read that did not finish must never be
 *  reported as a clean one (rule 29 applied to a read). */
async function listAccessPersons({ statuses = ['current', 'upcoming', 'expired', 'deactivated'], pageBudget = PERSON_PAGE_BUDGET, report = null } = {}) {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const all = [];
  let pages = 0, truncated = null;
  const statusesRead = [];
  for (const status of statuses) {
    if (pages >= pageBudget) { truncated = truncated || status; break; }
    statusesRead.push(status);
    for (let page = 1; page <= 200; page++) {
      if (pages >= pageBudget) { truncated = truncated || status; break; }
      pages++;
      const res = await axios.get(`${ENDPOINTS.base}/access_persons`, {
        headers, params: { page, per_page: 50, 'attributes[status]': status }, timeout: RL_TIMEOUT_MS
      });
      const body = res && res.data;
      const rows = Array.isArray(body && body.data) ? body.data : [];
      all.push(...rows);
      // A SHORT PAGE IS NOT THE END - the same bug this wave fixed on the UniFi
      // side. A lock that caps per_page below our 50 would otherwise end the read
      // on page one, and this check would under-report the very thing it exists
      // to find. meta.total_pages is documented; trust it when it is there.
      const meta = (body && body.meta) || {};
      const total = Number(meta.total_pages || 0);
      if (total) { if (page >= total) break; }
      else if (!rows.length) break;
    }
  }
  if (report) { report.pages = pages; report.truncated = truncated; report.statusesRead = statusesRead; }
  // the same person can come back under more than one status filter
  const seen = new Set();
  return all.filter(p => p && p.id && !seen.has(p.id) && seen.add(p.id));
}

/** Guests at the lock that WE made and this unit has no record of.
 *  Returns { checked, ours, orphans:[{id,name,ends_at}], error? } - never throws. */
async function findOrphanedCodes({ now = Date.now(), graceMins = 60 } = {}) {
  const out = { checked: 0, ours: 0, orphans: [] };
  const cfg = getConfig();
  if (String(cfg.doorAccess?.provider || 'remotelock').toLowerCase() !== 'remotelock') return Object.assign(out, { skipped: 'provider' });
  const rl = cfg.remotelock || {};
  if (!rl.clientId || String(rl.clientId).startsWith('PASTE')) return Object.assign(out, { skipped: 'unconfigured' });
  let known = new Set();
  try {
    known = new Set(require('./db').db.prepare(
      `SELECT remotelock_person_id AS id FROM bookings
        WHERE remotelock_person_id IS NOT NULL AND remotelock_person_id <> ''`).all().map(r => String(r.id)));
  } catch (e) { return Object.assign(out, { error: 'could not read this unit\'s own credential records: ' + e.message }); }
  const read = {};
  try {
    const people = await listAccessPersons({ report: read });
    out.checked = people.length;
    out.pagesRead = read.pages;
    if (read.truncated) out.truncated = read.truncated;
    const cutoff = now - graceMins * 60000;
    for (const p of people) {
      const a = (p && p.attributes) || p || {};
      const name = String(a.name || '');
      if (!OUR_GUEST_NAME.test(name)) continue;       // nothing like ours - never listed, never touched
      out.ours++;
      if (known.has(String(p.id))) continue;          // we know about it; the normal revoke owns it
      const ends = Date.parse(a.ends_at || '');
      if (isFinite(ends) && ends > cutoff) continue;  // still inside its window - not an orphan yet
      out.orphans.push({ id: p.id, name, ends_at: a.ends_at || '', status: a.status || '' });
    }
  } catch (err) { return Object.assign(out, { error: String(err.message).slice(0, 200) }); }
  // WRITE THE RESULT OF EVERY COMPLETED RUN, INCLUDING A CLEAN ONE (Sep 16 2026).
  // The first cut only logged when it FOUND something, and the health line reads
  // the newest row - so one orphan on one night left the panel red for ever: the
  // owner deleted the guests exactly as the action told them to, the next night's
  // check found nothing, wrote nothing, and the line still said "N code(s)". It
  // would have cleared when admin_log pruned the row, twelve months later. Worse,
  // that branch sits ahead of the live-code branch, so a stuck red HID rule 28's
  // "a customer can still open the door" alarm. That is the A-wave 3 lesson - red
  // rows an owner cannot clear teach them to ignore the panel - re-created on the door.
  // A READ THAT DID NOT FINISH IS NOT A CLEAN CHECK (Sep 17 2026, rule 29 for a
  // read). If the night's page budget ran out, we looked at the live guests and
  // stopped somewhere in the dead ones - so "0 unaccounted for" would be a claim
  // we did not earn. Say what was actually read. The live statuses are read
  // first, so the part that can still open a door is always covered.
  const where = out.truncated ? ` - the read stopped inside '${out.truncated}' at this unit's nightly page budget (${read.pages} pages, statuses ${(read.statusesRead || []).join('/')}), so older guests at the lock were not looked at tonight` : '';
  adminLog('DOOR_CODE_ORPHANS', out.orphans.length
    ? `${out.orphans.length} code(s) at the lock that LOOK like ours and that this system has no record of: ` + out.orphans.map(o => o.id).slice(0, 20).join(',') + where
    : (out.truncated
        ? `no unaccounted code among the ${out.checked} guests read tonight${where}`
        : `0 code(s) unaccounted for at the lock (checked ${out.checked}, ours ${out.ours})`));
  return out;
}

module.exports = { generateDoorCode, revokeDoorCode, listAccessPersons, findOrphanedCodes, ENDPOINTS, PERSON_PAGE_BUDGET };
