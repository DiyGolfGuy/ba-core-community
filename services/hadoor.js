// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/hadoor.js  —  A Z-WAVE LOCK THROUGH THE OWNER'S OWN HOME ASSISTANT
//  (feature/door-interface, Sep 21 2026 - research report of the same day)
//
//  No cloud, no monthly fee, no cloud-to-cloud sync. The unit already holds an
//  HA long-lived token for plugs and thermostats; this speaks to HA's zwave_js
//  integration through the same client (homeassistant.haFetch) and the same
//  websocket the HA docs describe. Never MQTT - it carries PINs in the clear.
//
//  A booking's code lives in one User Code slot on the lock (slotFrom..slotTo);
//  the ref stored on the booking row is  ha:<entity_id>#<slot>  so revoke,
//  confirm and the keypad event all route on the prefix like every provider.
//
//  CONFIRM is what RemoteLock never gave us: the slot read back from the lock
//  through HA - ask the device (invoke_cc_api User Code get), then read what HA
//  now holds for the slot (get_lock_usercode -> in_use). HA hands back NOTHING
//  about a set_lock_usercode beyond "taken" - the Supervision result stays inside
//  HA [R3][R4] - so the read-back is the only proof there is. The code digits
//  are a bonus - some locks mask them [A1] - and are never required.
//
//  FALLBACK is a standing backup code in a reserved slot, rotated daily, texted
//  beside the real one when the real one never confirmed. The customer gets in;
//  the owner is told.
//
//  SOURCES - every shape this file sends or reads was read in the document or
//  the source named (Sep 21 2026); the branch report quotes them. Nothing here
//  is from memory, and what could not be found is marked ASSUMED below.
//   [R1]  HA REST API, developers.home-assistant.io docs/api/rest.md:
//         POST /api/services/<domain>/<service>, "?return_response" ->
//         {changed_states:[...], service_response:{...}}; GET /api/states/<id> ->
//         {entity_id, state, attributes, last_changed, last_updated};
//         "Authorization: Bearer TOKEN".
//   [R2]  HA core homeassistant/components/api/__init__.py, APIDomainServicesView
//         .post: return_response on a service whose supports_response is NONE ->
//         400 "Service does not support responses. Remove return_response from
//         request."; a SupportsResponse.ONLY service called without it -> 400
//         "Service call requires responses but caller did not ask for responses.
//         Add ?return_response to query parameters."; with no return_response the
//         reply is the changed_states list; a ServiceValidationError -> 400 with
//         its text, a HomeAssistantError -> 500 with its text, an unknown
//         service -> 400.
//   [R3]  HA core homeassistant/components/zwave_js/services.py: get_lock_usercode
//         registered with supports_response=SupportsResponse.ONLY and schema
//         {code_slot: optional int}; set_lock_usercode {code_slot: int, usercode:
//         str} and clear_lock_usercode {code_slot: int} registered with NO
//         supports_response; invoke_cc_api {command_class, method_name,
//         parameters: list, endpoint optional} with NO supports_response - its
//         handler returns None.
//   [R4]  HA core homeassistant/components/zwave_js/lock.py:
//         async_get_lock_usercode(code_slot) -> {"<code_slot>": {"usercode":
//         slot["usercode"], "in_use": slot["in_use"]}}, or HomeAssistantError
//         (get_lock_usercode_not_found) for a slot the node lacks;
//         async_set_lock_usercode -> set_usercode(node, code_slot, usercode) and
//         returns nothing; async_clear_lock_usercode -> clear_usercode.
//   [R5]  HA core homeassistant/helpers/service.py entity_service_call: an entity
//         service's response is keyed by entity_id (response_data[entity.entity_id]).
//   [R6]  zwave-js-server-python zwave_js_server/util/lock.py: get_usercode reads
//         the User Code CC values "userCode" and "userIdStatus" from the driver's
//         value cache; in_use is None when the status value is None, else
//         status == CodeSlotStatus.ENABLED; get_usercode_from_node is
//         invoke_cc_api(USER_CODE, "get", code_slot) THEN get_usercode - "Should
//         be used when Z-Wave JS's ValueDB hasn't been populated for this code
//         slot"; set_usercode = async_set_value(userCode) -> SetValueResult;
//         clear_usercode = async_set_value(userIdStatus, AVAILABLE).
//   [R7]  Z-Wave JS docs/api/CCs/UserCode.md: get(userId) -> {userCode,
//         userIdStatus}; UserIDStatus Available=0, Enabled=1, Disabled=2,
//         Messaging=3, PassageMode=4, StatusNotAvailable=0xfe; set -> a
//         SupervisionResult that HA's service does not pass on ([R3], [R4]).
//   [R8]  HA core zwave_js/__init__.py async_on_notification + const.py: the
//         event "zwave_js_notification" carries domain, node_id, home_id,
//         home_id_hex, endpoint, device_id, command_class, command_class_name
//         "Notification", label, type, event, event_label, parameters.
//   [R9]  Z-Wave JS packages/core/src/registries/Notifications.ts: notification
//         type 0x06 "Access Control", event 0x05 "Keypad lock operation", 0x06
//         "Keypad unlock operation"; the HA zwave_js integration page shows such
//         an event's parameters as {"userId": 1}.
//   [R10] HA WebSocket API, docs/api/websocket.md: auth_required -> {type:"auth",
//         access_token} -> auth_ok | auth_invalid (then disconnect); {id, type:
//         "subscribe_events", event_type} -> {id, type:"result", success}; then
//         {id, type:"event", event:{event_type, data, origin, time_fired,
//         context}}; ping/pong; every command carries an increasing id.
//   [R11] HA core zwave_js/entity.py: available = the Z-Wave JS client connected
//         AND node.ready AND the primary value present - else "unavailable".
//   [R12] THE CREDENTIAL ACTIONS (Home Assistant 2026.6.0, Jun 3 2026 - the release
//         post "Z-Wave smart lock credential management"; core commit 9757f8b "Add
//         support for Z-Wave credential management (#168360)", May 20 2026; refined
//         in 2026.8 by bbf038b "Support Z-Wave locks that require coupled users and
//         credentials"). HA core zwave_js/services.py registers, on lock entities:
//         set_user (SupportsResponse.ONLY; user_id / user_name / user_type /
//         credential_rule / active / credential_type / credential_slot /
//         credential_data, all optional), set_credential (ONLY; user_id,
//         credential_type, credential_data required, credential_slot optional),
//         get_users (ONLY), get_credential_capabilities (ONLY), delete_user
//         (user_id), delete_credential, delete_all_users, delete_all_credentials
//         (no response). zwave_js/lock_helpers.py gives the returns: set_user ->
//         SetUserReturn {user_id, credential_slot (None unless a credential was
//         written)}; set_credential -> {credential_slot, user_id}; get_users ->
//         {max_users, users:[{user_id, user_name, active, user_type,
//         credential_rule, credentials:[{type, slot}]}]};
//         get_credential_capabilities -> {supports_user_management, max_users,
//         supported_user_types, max_user_name_length, supported_credential_rules,
//         supported_credential_types:{pin_code:{num_slots, min_length, max_length,
//         supports_learn}}}. Errors (strings.json): a lock without access control
//         -> HomeAssistantError "Access control is not supported on this device"
//         (500); a duplicate PIN -> "This credential is already registered on the
//         device." (500); an occupied slot -> "Cannot add user: the target slot is
//         already in use." (500); no free slot -> ServiceValidationError "No
//         available user slots on this device" (400); a PIN of the wrong length or
//         with non-digits -> 400. They ride on zwave-js's AccessControl API, which
//         handles User Credential CC AND User Code CC (zwave-js-server API_SCHEMA
//         48: "including User Credential CC and User Code CC fallback behavior
//         handled by zwave-js"; lock_helpers: "On User Code CC the credential
//         shares its user's slot") - so a User Code lock like the Yale YRL216-ZW2
//         is served by the same actions, with user_id == the code slot.
//         get_lock_usercode itself is newer than the first cut assumed: core
//         commit 6476610, Feb 12 2026 -> 2026.3.0.
//         WHAT THIS BUYS: the set is graded by the driver's own result - a code the
//         lock rejects is an HA error at set time, never a silent 200 - and the
//         answer carries the slot that was used.
//         WHAT IT DOES NOT: get_users lists users and credential slots, never the
//         digits, so confirm on this path is "the lock lists a PIN credential for
//         this user" - the driver's cached view after a supervised set.
//   [R13] HA core homeassistant/auth/permissions/events.py SUBSCRIBE_ALLOWLIST (read Sep 29 2026): the
//         events a user who is not an administrator may subscribe to - state_changed, the registries,
//         themes, panels and a few more; zwave_js_notification is NOT among them. websocket_api/commands.py
//         handle_subscribe_events: an event outside the list, asked by a user who is not is_admin, raises
//         Unauthorized.
//   [R14] websocket_api/connection.py async_handle_exception: Unauthorized -> code "unauthorized",
//         message "Unauthorized" (const.ERR_UNAUTHORIZED); messages.error_message -> {id, type:"result",
//         success:false, error:{code, message}}.
//   [R15] auth/__init__.py websocket_current_user, {type:"auth/current_user"} -> result {id, name,
//         is_owner, is_admin, credentials, mfa_modules}.
//   [R16] zwave_js/services.py registers invoke_cc_api, set_lock_usercode and clear_lock_usercode with
//         hass.services.async_register, not the admin-only registration: a token that is not an
//         administrator's still sets and clears codes - only the keypad reports are refused ([R13]).
//  THE PATH IS CHOSEN ONCE, FROM WHAT HOME ASSISTANT ANSWERS (homeAssistant.lock.mode):
//   'credentials' - get_credential_capabilities answered (HA 2026.6+, a lock zwave-js
//                   serves through AccessControl); 'usercode' - HA answered 400
//                   "Service not found." (older than 2026.6): the User Code path above;
//                   'none' - HA answered 500 "Access control is not supported on this
//                   device": the lock cannot manage codes from HA, and the card says so.
//   An owner may pin the mode on the card; '' means decide on first use.
//  ASSUMED - no document found; marked where it bites:
//   [A1]  some locks report the code masked ("**********") on read-back - a
//         community report; in_use is the proof either way, the digits never are.
//   [A2]  a set or clear on a slot the node does not have raises NotFoundError
//         inside HA's handler and reaches the caller as a 500 - inferred from
//         [R4]/[R6], not seen on hardware.
//   [A3]  a service call naming an entity that is unavailable, or not a zwave_js
//         lock, answers 400 - the wording is not verified.
//   [A4]  a User Code get asked through invoke_cc_api reaches the device before
//         the following get_lock_usercode reads the cache - the read is retried
//         each minute either way, so a slow report costs a poll, never the truth.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const { getConfig, saveConfig } = require('./config');

const USER_CODE_CC = 99;               // Command Class 0x63 User Code [R7]

function log(ev, detail) { try { require('./db').adminLog(ev, detail); } catch {} }
function D() { return require('./db').db; }
function ha() { return require('./homeassistant'); }

function lockCfg() {
  const c = getConfig().homeAssistant || {};
  const l = c.lock || {};
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };
  return {
    entityId:   String(l.entityId || '').trim(),
    slotFrom:   n(l.slotFrom, 10),
    slotTo:     n(l.slotTo, 29),
    backupSlot: n(l.backupSlot, 30),
    backupCode: String(l.backupCode || ''),
    backupSetOn: String(l.backupSetOn || ''),
    mode:       ['credentials', 'usercode', 'none'].includes(String(l.mode || '')) ? String(l.mode) : '',
    // a member opens the door with their own member PIN, put in a slot for their booking's window
    // and taken out after - UniFi's member design, on a Z-Wave lock (Sep 26 2026)
    memberPins: l.memberPins === true,
    // what the customer presses after the digits - in words, in the text (the Yale: the check mark)
    finishKey:  String(l.finishKey || '').trim() || 'the check mark',
    caps:       (l.caps && typeof l.caps === 'object') ? l.caps : null,   // what get_credential_capabilities last said
  };
}
const NOT_FOUND_RE = /Service not found/i;                       // [R2] an unknown service -> 400
const NO_ACCESS_CONTROL_RE = /Access control is not supported/i; // [R12] the lock has neither CC
const DUPLICATE_RE = /already registered/i;                      // [R12] credential_rejected_duplicate
const OCCUPIED_RE  = /already in use/i;                          // [R12] user_rejected_add_occupied
const EMPTY_SLOT_RE = /slot is empty/i;                          // [R12] user_rejected_modify_empty

/** Ask HA which path this lock takes, and remember it. [R12]
 *  A USER CODE LOCK IS READ BACK FROM THE LOCK ITSELF (Sep 26 2026, the bench with the Yale): when
 *  get_lock_usercode answers for the unit's first slot, the User Code path is used - it is the one
 *  path with a read that asks the lock (invoke_cc_api User Code get) and FAILS when the lock does not
 *  answer (a 500 after ~7 s with the battery out, where the cached read still showed the old PIN).
 *  The credential actions list users from the driver's cache and have no such read. */
async function detectMode(entityId, { save = true } = {}) {
  try {
    const l0 = lockCfg();
    const r0 = await callService('get_lock_usercode', { entity_id: entityId, code_slot: l0.slotFrom });
    const sr0 = r0 && r0.service_response;
    const by0 = sr0 && typeof sr0 === 'object' ? (sr0[entityId] && typeof sr0[entityId] === 'object' ? sr0[entityId] : sr0) : null;
    if (by0 && by0[String(l0.slotFrom)] && typeof by0[String(l0.slotFrom)] === 'object' && 'in_use' in by0[String(l0.slotFrom)]) {
      const out = { mode: 'usercode', why: 'a User Code lock - each code is written with set_lock_usercode and read back from the lock itself before it is texted' };
      if (save) saveConfig({ homeAssistant: { lock: { mode: 'usercode', caps: null } } });
      return out;
    }
  } catch (e) { /* no User Code read here (an older HA, or a User Credential lock): the credential probe decides */ }
  try {
    const reply = await callService('get_credential_capabilities', { entity_id: entityId });
    const sr = reply && reply.service_response;
    const caps = sr && typeof sr === 'object' ? (sr[entityId] && typeof sr[entityId] === 'object' ? sr[entityId] : sr) : null;
    const pin = caps && caps.supported_credential_types && caps.supported_credential_types.pin_code;
    if (!caps || !('supports_user_management' in caps)) return { mode: null, error: 'Home Assistant answered get_credential_capabilities, but not in the documented shape' };
    if (!pin) {
      const out = { mode: 'none', why: 'the lock reports no PIN-code credential type (' + Object.keys(caps.supported_credential_types || {}).join(', ') + ') - it cannot hold booking codes', caps };
      if (save) saveConfig({ homeAssistant: { lock: { mode: 'none', caps: slimCaps(caps) } } });
      return out;
    }
    const out = { mode: 'credentials', why: `Home Assistant's credential actions (2026.6 or newer) - up to ${caps.max_users} users, PINs of ${pin.min_length}-${pin.max_length} digits`, caps };
    if (save) saveConfig({ homeAssistant: { lock: { mode: 'credentials', caps: slimCaps(caps) } } });
    return out;
  } catch (e) {
    const status = httpStatusOf(e);
    if (status === 400 && NOT_FOUND_RE.test(e.message)) {
      const out = { mode: 'usercode', why: 'this Home Assistant is older than 2026.6 (no credential actions) - the User Code path is used' };
      if (save) saveConfig({ homeAssistant: { lock: { mode: 'usercode', caps: null } } });
      return out;
    }
    if (status === 500 && NO_ACCESS_CONTROL_RE.test(e.message)) {
      const out = { mode: 'none', why: 'Home Assistant says this lock cannot manage codes (no access control support reported by Z-Wave JS)' };
      if (save) saveConfig({ homeAssistant: { lock: { mode: 'none', caps: null } } });
      return out;
    }
    return { mode: null, error: String(e.message).slice(0, 160) };
  }
}
function slimCaps(caps) {
  const pin = (caps.supported_credential_types || {}).pin_code || {};
  return { maxUsers: Number(caps.max_users) || 0, pinMin: Number(pin.min_length) || 4, pinMax: Number(pin.max_length) || 10, nameMax: Number(caps.max_user_name_length) || 0 };
}
let _modeMemo = null;
/** 'credentials' | 'usercode' | 'none' - the pinned mode, else the last detected, else ask once. */
async function pathFor(entityId) {
  const l = lockCfg();
  if (l.mode) return l.mode;
  if (_modeMemo && _modeMemo.entityId === entityId) return _modeMemo.mode;
  const d = await detectMode(entityId);
  if (d.mode) { _modeMemo = { entityId, mode: d.mode }; log('HA_DOOR_PATH', `${entityId}: ${d.why}`); return d.mode; }
  return 'usercode';   // undecided (HA did not answer): the path every HA has; decided again next time
}
function pinLengthFor() {
  const l = lockCfg();
  let len = require('./doorlock').doorPinLength();
  if (l.caps) len = Math.max(l.caps.pinMin || 4, Math.min(l.caps.pinMax || 10, len));
  return len;
}

/** HA reachable in Settings AND a lock entity chosen - the provider's "configured". */
function configured() {
  const c = getConfig().homeAssistant || {};
  return !!(c.enabled && c.url && c.token && !String(c.token).startsWith('PASTE') && lockCfg().entityId);
}

// refs: ha:<entity>#<slot> on the User Code path; ha:<entity>#u<user_id>c<slot> on
// the credential path (the user and the credential slot HA handed back) [R12]
function refFor(entityId, slot) { return `ha:${entityId}#${slot}`; }
function refForUser(entityId, userId, credSlot) { return `ha:${entityId}#u${userId}c${credSlot}`; }
function parseRef(ref) {
  let m = /^ha:(.+)#u(\d+)c(\d+)$/.exec(String(ref || ''));
  if (m) return { entityId: m[1], slot: Number(m[2]), userId: Number(m[2]), credSlot: Number(m[3]), path: 'credentials' };
  m = /^ha:(.+)#(\d+)$/.exec(String(ref || ''));
  return m ? { entityId: m[1], slot: Number(m[2]), path: 'usercode' } : null;
}

// ── slots ─────────────────────────────────────────────────────────────────────
function usedSlots(entityId) {
  const out = new Set();
  try {
    const rows = D().prepare(`SELECT remotelock_person_id FROM bookings WHERE remotelock_person_id LIKE ?`).all('ha:' + entityId + '#%');
    for (const r of rows) { const p = parseRef(r.remotelock_person_id); if (p) out.add(p.slot); }
  } catch {}
  return out;
}
function freeSlot(entityId) {
  const l = lockCfg(), used = usedSlots(entityId);
  for (let s = l.slotFrom; s <= l.slotTo; s++) if (s !== l.backupSlot && !used.has(s)) return s;
  return null;
}
function mintPin(avoid) {
  const len = pinLengthFor();
  // never a member's PIN, and never a code this unit already holds on the lock (a lock may refuse a
  // duplicate, and a member's PIN must open only for that member)
  const taken = new Set();
  try { for (const r of D().prepare(`SELECT pin FROM members WHERE COALESCE(pin,'') <> ''`).all()) taken.add(String(r.pin)); } catch {}
  try { for (const r of D().prepare(`SELECT door_code FROM bookings WHERE remotelock_person_id LIKE 'ha:%' AND COALESCE(door_code,'') <> ''`).all()) taken.add(String(r.door_code)); } catch {}
  for (let i = 0; i < 40; i++) {
    let p = ''; while (p.length < len) p += String(require('node:crypto').randomInt(10));
    if (p !== avoid && !taken.has(p) && !/^(\d)\1+$/.test(p)) return p;   // never all one digit
  }
  return null;
}

// ── members: their own PIN in a slot for the booking's window (Sep 26 2026, UniFi's design) ──
/** The member's PIN when this booking should use it: member PINs on for this lock, an active member,
 *  a PIN the lock can hold. Else null - the booking gets a code of its own. */
function memberPinFor(booking) {
  const l = lockCfg();
  if (!l.memberPins || !booking || !booking.member_id) return null;
  try {
    const m = D().prepare(`SELECT pin, status FROM members WHERE id=?`).get(booking.member_id);
    const pin = m && String(m.pin || '');
    if (!m || m.status !== 'active' || !/^\d+$/.test(pin)) return null;
    const min = (l.caps && l.caps.pinMin) || 4, max = (l.caps && l.caps.pinMax) || 10;
    return pin.length >= min && pin.length <= max ? pin : null;
  } catch { return null; }
}
/** Another booking of the same member that still holds its slot on the lock, whose window has not
 *  closed - back-to-back bookings share ONE slot, so the PIN stays in with no gap. */
function memberHeldRef(booking, entityId, exceptId) {
  try {
    const rows = D().prepare(`SELECT id, date, start_time, end_time, end_date, remotelock_person_id AS ref FROM bookings
      WHERE member_id=? AND id<>? AND status IN ('active','completed') AND remotelock_person_id LIKE ?`).all(booking.member_id, exceptId || booking.id, 'ha:' + entityId + '#%');
    const now = Date.now(), dl = require('./doorlock');
    for (const r of rows) { const p = parseRef(r.ref); const w = dl.codeWindow(r); if (p && p.path === 'usercode' && w.endDt.getTime() > now) return r.ref; }
  } catch {}
  return null;
}

// ── the calls ─────────────────────────────────────────────────────────────────
// [R2]: a service registered without supports_response is 400'd for asking, and
// get_lock_usercode (SupportsResponse.ONLY) is 400'd for NOT asking - so the
// flag is decided per service here, never by the caller.
const RESPONDS = { get_lock_usercode: true, set_lock_usercode: false, clear_lock_usercode: false, invoke_cc_api: false,
  // [R12] the credential actions
  get_credential_capabilities: true, get_users: true, set_user: true, set_credential: true, delete_user: false, delete_credential: false };
async function callService(service, body) {
  const q = RESPONDS[service] ? '?return_response' : '';
  return ha().haFetch('/api/services/zwave_js/' + service + q, 'POST', body);
}
/** The HTTP status haFetch folded into its error, or 0 for no answer at all. */
function httpStatusOf(err) { const m = /^HA (\d{3})/.exec(String(err && err.message)); return m ? Number(m[1]) : 0; }

// what HA said to the last set() per ref: a 4xx is a refusal of THIS request and
// is known the moment it happens. In memory only - after a restart the slot
// read-back decides, which costs the hold its five polls but never the truth.
const lastSet = new Map();
const REASK_TIMES = 3, REASK_MS = Math.max(0, Number(process.env.BA_HA_REASK_MS || 1500));

/** set_lock_usercode {entity_id, code_slot, usercode} [R3]. HA answers the
 *  changed_states list and nothing about the lock [R2][R4]: what is learned
 *  here is only whether HA TOOK the request. Throws on anything but 2xx. */
async function setCode(entityId, slot, code) {
  await callService('set_lock_usercode', { entity_id: entityId, code_slot: slot, usercode: code });
}
async function clearCode(entityId, slot) {
  await callService('clear_lock_usercode', { entity_id: entityId, code_slot: slot });
}
/** { usercode, inUse } for a slot, composed the way [R6] get_usercode_from_node
 *  is: ask the device (invoke_cc_api User Code get - no response by design
 *  [R3]), then read the slot HA now caches (get_lock_usercode, keyed by
 *  entity_id then slot [R4][R5]). inUse is true / false / null (unknown). */
async function readSlot(entityId, slot, { fresh = true } = {}) {
  if (fresh) {
    // A FRESH READ OR NONE (Sep 26 2026, proven on the Yale with its battery out): the ask must reach
    // the lock. It used to be "best effort" and the cached slot answered anyway - and the cache still
    // held the old PIN with the lock dead. A get the lock does not answer is a 500 after ~7 s; that is
    // "could not read", never the cached code.
    try {
      await callService('invoke_cc_api', { entity_id: entityId, command_class: USER_CODE_CC, method_name: 'get', parameters: [slot] });
    } catch (e) {
      const err = new Error('the lock did not answer a fresh read of slot ' + slot + ' (' + String(e.message).replace(/\s+/g, ' ').slice(0, 80) + ')');
      err.freshFailed = true;
      throw err;
    }
  }
  const reply = await callService('get_lock_usercode', { entity_id: entityId, code_slot: slot });
  const sr = reply && reply.service_response;
  const byEntity = sr && typeof sr === 'object' ? (sr[entityId] && typeof sr[entityId] === 'object' ? sr[entityId] : sr) : null;
  const o = byEntity && byEntity[String(slot)];
  if (!o || typeof o !== 'object' || !('in_use' in o)) throw new Error('Home Assistant answered, but not with slot ' + slot + ' (' + JSON.stringify(sr).slice(0, 120) + ')');
  return { usercode: o.usercode, inUse: o.in_use === true ? true : o.in_use === false ? false : null };
}
async function lockEntityState(entityId) {
  const e = await ha().haFetch('/api/states/' + encodeURIComponent(entityId));
  return e && e.state;
}

// ── the provider interface ────────────────────────────────────────────────────
/** create(booking) -> { pin, personId }  (throws on refusal, like the others) */
async function generateDoorCode(booking) {
  if (!configured()) throw new Error('Home Assistant lock is not configured');
  const l = lockCfg();
  const path = await pathFor(l.entityId);
  if (path === 'none') { log('DOOR_CODE_ERROR', `Booking: ${booking.id} | ${l.entityId} cannot manage codes from Home Assistant - choose another lock or provider`); throw new Error('this lock cannot manage codes from Home Assistant'); }
  if (path === 'credentials') return generateViaCredentials(booking, l);
  const memberPin = memberPinFor(booking);
  if (memberPin) {
    const held = memberHeldRef(booking, l.entityId);
    if (held) {
      log('DOOR_CODE_CREATED', `Booking: ${booking.id} | member PIN - slot ${parseRef(held).slot} on ${l.entityId} already holds it for their booking before this one, and keeps it through both`);
      return { pin: memberPin, personId: held };
    }
  }
  const slot = freeSlot(l.entityId);
  if (slot === null) {
    log('DOOR_CODE_ERROR', `Booking: ${booking.id} | every code slot ${l.slotFrom}-${l.slotTo} on ${l.entityId} is in use - widen the slot range in Settings > Devices, or clear stale codes`);
    throw new Error(`no free code slot on the lock (${l.slotFrom}-${l.slotTo} all in use)`);
  }
  const pin = memberPin || mintPin(l.backupCode);
  if (!pin) throw new Error('could not mint a door code');
  const ref = refFor(l.entityId, slot);
  try {
    await setCode(l.entityId, slot, pin);
    lastSet.set(ref, { refused: null, at: Date.now() });
  } catch (e) {
    const status = httpStatusOf(e);
    if (status >= 400 && status < 500) {
      // HA refused THIS request (its schema, a lock that is unavailable [A3]):
      // sending it again cannot help, so the ref is handed back with the refusal
      // remembered - confirm answers 'failed' at once and the fallback flow runs.
      lastSet.set(ref, { refused: String(e.message).slice(0, 160), at: Date.now() });
      log('DOOR_CODE_ERROR', `Booking: ${booking.id} | slot ${slot} on ${l.entityId}: Home Assistant refused the code - ${String(e.message).slice(0, 160)}`);
      return { pin, personId: ref };
    }
    throw e;   // no answer, a timeout, a 5xx: the job retries with backoff
  }
  log('DOOR_CODE_CREATED', `Booking: ${booking.id} | ${memberPin ? 'member PIN' : 'code issued'} (${pin.length} digits) | slot ${slot} on ${l.entityId}`);
  return { pin, personId: ref };
}

/** The credential path [R12]: set_user with a pin_code credential. HA answers
 *  {user_id, credential_slot} - the slot that was used - or refuses at set time.
 *  A duplicate PIN is re-minted; an occupied slot moves on; no slot at all, a
 *  wrong length or a lock that refuses is a refusal (the ref comes back marked). */
async function generateViaCredentials(booking, l) {
  const used = usedSlots(l.entityId);
  let slot = null;
  for (let s = l.slotFrom; s <= l.slotTo; s++) if (s !== l.backupSlot && !used.has(s)) { slot = s; break; }
  if (slot === null) {
    log('DOOR_CODE_ERROR', `Booking: ${booking.id} | every code slot ${l.slotFrom}-${l.slotTo} on ${l.entityId} is in use - widen the slot range in Settings > Devices, or clear stale codes`);
    throw new Error(`no free code slot on the lock (${l.slotFrom}-${l.slotTo} all in use)`);
  }
  let pin = mintPin(l.backupCode);
  if (!pin) throw new Error('could not mint a door code');
  const nameMax = (l.caps && l.caps.nameMax) || 0;
  let userName = `Golf ${booking.id}`; if (nameMax && userName.length > nameMax) userName = userName.slice(0, nameMax);
  let lastMsg = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = refForUser(l.entityId, slot, slot);
    try {
      const reply = await callService('set_user', { entity_id: l.entityId, user_id: slot, user_name: userName, user_type: 'general', credential_type: 'pin_code', credential_data: pin });
      const sr = reply && reply.service_response;
      const r = sr && typeof sr === 'object' ? (sr[l.entityId] && typeof sr[l.entityId] === 'object' ? sr[l.entityId] : sr) : null;
      const userId = r && Number(r.user_id), credSlot = r && r.credential_slot !== null && r.credential_slot !== undefined ? Number(r.credential_slot) : null;
      if (!Number.isFinite(userId)) throw new Error('Home Assistant answered set_user, but not with a user_id (' + JSON.stringify(sr).slice(0, 120) + ')');
      const finalRef = refForUser(l.entityId, userId, credSlot === null ? userId : credSlot);
      lastSet.set(finalRef, { refused: null, at: Date.now() });
      log('DOOR_CODE_CREATED', `Booking: ${booking.id} | code issued (${pin.length} digits) | user ${userId}, credential slot ${credSlot === null ? userId : credSlot} on ${l.entityId} (credential path)`);
      return { pin, personId: finalRef };
    } catch (e) {
      const status = httpStatusOf(e), msg = String(e.message); lastMsg = msg;
      if (status === 500 && DUPLICATE_RE.test(msg)) { const next = mintPin(l.backupCode); if (next && next !== pin) { pin = next; continue; } }
      if (status === 500 && OCCUPIED_RE.test(msg)) { used.add(slot); let n = null; for (let s = l.slotFrom; s <= l.slotTo; s++) if (s !== l.backupSlot && !used.has(s)) { n = s; break; } if (n !== null) { slot = n; continue; } }
      if (status === 400 && NOT_FOUND_RE.test(msg)) {
        // HA turned out older than the remembered mode: fall back to the User Code path for good
        saveConfig({ homeAssistant: { lock: { mode: 'usercode' } } }); _modeMemo = null;
        log('HA_DOOR_PATH', `${l.entityId}: Home Assistant has no credential actions after all - the User Code path is used from now on`);
        return generateDoorCode(booking);
      }
      if (status >= 400 && status < 500) {
        lastSet.set(ref, { refused: msg.slice(0, 160), at: Date.now() });
        log('DOOR_CODE_ERROR', `Booking: ${booking.id} | user ${slot} on ${l.entityId}: Home Assistant refused the code - ${msg.slice(0, 160)}`);
        return { pin, personId: ref };
      }
      if (status === 500 && (DUPLICATE_RE.test(msg) || OCCUPIED_RE.test(msg))) {
        lastSet.set(ref, { refused: msg.slice(0, 160), at: Date.now() });
        log('DOOR_CODE_ERROR', `Booking: ${booking.id} | ${l.entityId}: the lock refused every code tried - ${msg.slice(0, 160)}`);
        return { pin, personId: ref };
      }
      throw e;   // no answer, a timeout, another 5xx: the job retries with backoff
    }
  }
  // four codes refused in a row: the lock is not taking codes from us tonight. The ref
  // comes back marked so confirm fails at once and the fallback flow runs (the customer
  // gets the standing code beside it, the owner is told) rather than a job that retries
  // the same refusal until the session has passed.
  const ref = refForUser(l.entityId, slot, slot);
  lastSet.set(ref, { refused: 'the lock refused every code tried: ' + lastMsg.slice(0, 120), at: Date.now() });
  log('DOOR_CODE_ERROR', `Booking: ${booking.id} | ${l.entityId}: the lock refused every code tried - ${lastMsg.slice(0, 160)}`);
  return { pin, personId: ref };
}

/** confirm(ref) -> { state: 'held'|'pending'|'failed', detail }
 *  'unknown' is never this provider's answer: it CAN ask. Unreachable is
 *  'pending' - the code may well be on the lock; the poll asks again. */
async function confirmDoorCode(ref, booking) {
  const p = parseRef(ref);
  if (!p) return { state: 'failed', detail: 'not a Home Assistant lock reference' };
  if (!configured()) return { state: 'pending', detail: 'Home Assistant lock is not configured on this unit' };
  const last = lastSet.get(ref);
  if (last && last.refused) return { state: 'failed', detail: 'the lock refused the code: ' + last.refused };
  try {
    const st = await lockEntityState(p.entityId);
    if (st === 'unavailable') return { state: 'failed', detail: 'the lock is unavailable in Home Assistant (node not ready, or Z-Wave JS disconnected)' };
  } catch (e) {
    return { state: 'pending', detail: 'Home Assistant did not answer: ' + String(e.message).slice(0, 120) };
  }
  if (p.path === 'credentials') return confirmViaCredentials(p, booking);
  // RIGHT AFTER THE SET, ASK AGAIN FOR A FEW SECONDS (Sep 26 2026, on the Yale): the code lands in
  // about 3.5 s, but the first check straight after the set missed it and the next came a tick later,
  // so the text waited a minute. While the set is under 20 s old and the lock answers, it is asked up
  // to three more times, 1.5 s apart. A lock that does not answer is not asked again now (each try
  // costs ~7 s); the hold asks next tick as before.
  const set0 = lastSet.get(ref);
  const justSent = !!(set0 && set0.at && !set0.heldLogged && Date.now() - set0.at < 20000);
  let slot;
  for (let i = 0; ; i++) {
    let why = '';
    try { slot = await readSlot(p.entityId, p.slot); }
    catch (e) {
      if (set0 && !set0.firstMiss) set0.firstMiss = 'the read failed: ' + String(e.message).slice(0, 80);
      if (e.freshFailed || !justSent || i >= REASK_TIMES) return { state: 'pending', detail: 'could not read the slot: ' + String(e.message).slice(0, 120) };
      why = 'x';
    }
    if (!why && slot.inUse === true) break;
    if (!why && set0 && !set0.firstMiss) set0.firstMiss = 'slot ' + p.slot + ' read ' + (slot.inUse === false ? 'empty' : 'unknown') + ' ' + Math.round((Date.now() - set0.at) / 100) / 10 + ' s after the set';
    if (!justSent || i >= REASK_TIMES) break;
    await new Promise(r => setTimeout(r, REASK_MS));
  }
  if (slot.inUse === true) {
    // in_use is the proof [R6]. The digits are a bonus: read back and equal, the
    // lock holds exactly this code; masked or null [A1], the status still stands;
    // read back and DIFFERENT, something else sits in our slot - not held, and not
    // called failed either (an undocumented read-back format must not strand a
    // customer): the hold keeps asking, and the fallback rides with the text.
    const digits = slot.usercode === null || slot.usercode === undefined ? '' : String(slot.usercode);
    const expect = booking && /^\d+$/.test(String(booking.door_code || '')) ? String(booking.door_code) : null;
    if (/^\d+$/.test(digits) && expect && digits !== expect) {
      return { state: 'pending', detail: 'slot ' + p.slot + ' is in use but reads a different code than this booking\'s' };
    }
    const bonus = /^\d+$/.test(digits) ? ' (code read back)' : ' (code masked on read - in_use is the proof)';
    // HOW LONG IT TOOK TO LAND (maintainer's item 9): from the set request to the fresh read that shows it
    const set = lastSet.get(ref);
    if (set && set.at && !set.heldLogged) { set.heldLogged = true; log('DOOR_CODE_HELD', `Booking: ${booking && booking.id} | slot ${p.slot} on ${p.entityId} holds the code - read back from the lock ${Math.round((Date.now() - set.at) / 100) / 10} s after it was sent` + (set.firstMiss ? ` (the first check did not see it: ${set.firstMiss})` : '')); }
    return { state: 'held', detail: 'slot ' + p.slot + ' is in use on the lock' + bonus };
  }
  if (slot.inUse === false) return { state: 'pending', detail: 'slot ' + p.slot + ' reads empty' };
  return { state: 'pending', detail: 'slot ' + p.slot + ' status is not known to Home Assistant yet' };
}

/** The credential path's confirm [R12]: get_users lists the user with a pin_code
 *  credential. No digits come back on this path - the listing is the proof. */
async function confirmViaCredentials(p) {
  let users;
  try {
    const reply = await callService('get_users', { entity_id: p.entityId });
    const sr = reply && reply.service_response;
    const r = sr && typeof sr === 'object' ? (sr[p.entityId] && typeof sr[p.entityId] === 'object' ? sr[p.entityId] : sr) : null;
    users = r && Array.isArray(r.users) ? r.users : null;
    if (!users) throw new Error('not the documented shape (' + JSON.stringify(sr).slice(0, 120) + ')');
  } catch (e) {
    const status = httpStatusOf(e);
    if (status === 500 && NO_ACCESS_CONTROL_RE.test(e.message)) return { state: 'failed', detail: 'Home Assistant says this lock cannot manage codes' };
    return { state: 'pending', detail: 'could not list the lock\'s users: ' + String(e.message).slice(0, 120) };
  }
  const u = users.find(x => Number(x.user_id) === p.userId);
  if (!u) return { state: 'pending', detail: 'user ' + p.userId + ' is not listed by Home Assistant yet' };
  const cred = (u.credentials || []).find(c => c.type === 'pin_code' && Number(c.slot) === p.credSlot) || (u.credentials || []).find(c => c.type === 'pin_code');
  if (cred) return { state: 'held', detail: 'user ' + p.userId + ' holds a PIN credential in slot ' + cred.slot + (u.active === false ? ' (user inactive)' : '') + ' (listed by Home Assistant - the digits are never read back on this path)' };
  return { state: 'pending', detail: 'user ' + p.userId + ' is listed without a PIN credential yet' };
}

/** revoke(ref) -> { ok } | { ok:false, error }  - never throws (rule 29 shape) */
async function revokeDoorCode(ref, opts = {}) {
  const p = parseRef(ref);
  if (!p) return { ok: true, note: 'nothing to revoke' };
  // A MEMBER'S SLOT SHARED WITH THEIR NEXT BOOKING STAYS (Sep 26 2026): back to back, the second
  // booking holds the same slot; taking it out at the first one's end would lock them out mid-session
  if (opts.forBookingId && p.path === 'usercode') {
    try {
      const me = D().prepare(`SELECT id, member_id FROM bookings WHERE id=?`).get(opts.forBookingId);
      const other = me && me.member_id ? memberHeldRef(me, p.entityId, me.id) : null;
      if (other === ref) { log('DOOR_CODE_KEPT', `Booking: ${me.id} | slot ${p.slot} on ${p.entityId} stays - the member's next booking uses the same PIN`); return { ok: true, kept: true, note: 'kept for the member\'s next booking' }; }
    } catch {}
  }
  if (p.path === 'credentials') {
    try {
      await callService('delete_user', { entity_id: p.entityId, user_id: p.userId });
      lastSet.delete(ref);
      log('DOOR_CODE_REVOKED', `user ${p.userId} on ${p.entityId} deleted (credential path)`);
      return { ok: true };
    } catch (err) {
      if (httpStatusOf(err) === 500 && EMPTY_SLOT_RE.test(err.message)) { lastSet.delete(ref); log('DOOR_CODE_REVOKED', `user ${p.userId} on ${p.entityId} (already gone)`); return { ok: true, note: 'already gone' }; }
      log('DOOR_CODE_REVOKE_ERROR', `user ${p.userId} on ${p.entityId}: ${err.message}`);
      return { ok: false, error: String(err.message).slice(0, 200) };
    }
  }
  try {
    await clearCode(p.entityId, p.slot);
    lastSet.delete(ref);
    log('DOOR_CODE_REVOKED', `slot ${p.slot} on ${p.entityId} cleared`);
    return { ok: true };
  } catch (err) {
    if (/404|not found/i.test(String(err.message))) { lastSet.delete(ref); log('DOOR_CODE_REVOKED', `slot ${p.slot} on ${p.entityId} (already gone)`); return { ok: true, note: 'already gone' }; }
    log('DOOR_CODE_REVOKE_ERROR', `slot ${p.slot} on ${p.entityId}: ${err.message}`);
    return { ok: false, error: String(err.message).slice(0, 200) };
  }
}

/** The standing backup code, set today. { pin, kind:'backup' } | { ok:false, error } */
async function ensureBackup(force = false) {
  if (!configured()) return { ok: false, error: 'Home Assistant lock is not configured' };
  const l = lockCfg();
  const today = new Date().toISOString().slice(0, 10);
  if (!force && l.backupCode && l.backupSetOn === today) return { pin: l.backupCode, kind: 'backup', fresh: false };
  const pin = mintPin('');
  // if the rotation fails, the code already on the lock (set on an earlier day)
  // is still a working code - a day-old backup beats no backup
  const keepOld = (why) => l.backupCode
    ? { pin: l.backupCode, kind: 'backup', fresh: false, stale: true, note: why }
    : { ok: false, error: why };
  try {
    const path = await pathFor(l.entityId);
    if (path === 'none') return keepOld('this lock cannot manage codes from Home Assistant');
    if (path === 'credentials') {
      const body = { entity_id: l.entityId, user_id: l.backupSlot, user_name: 'Golf backup', user_type: 'general', credential_type: 'pin_code', credential_data: pin };
      try { await callService('set_user', body); }
      catch (e) {
        // the backup slot already holds an older code: take it back, then set the new one
        if (httpStatusOf(e) === 500 && OCCUPIED_RE.test(e.message)) { await callService('delete_user', { entity_id: l.entityId, user_id: l.backupSlot }); await callService('set_user', body); }
        else throw e;
      }
    } else {
      await setCode(l.entityId, l.backupSlot, pin);
    }
    saveConfig({ homeAssistant: { lock: { backupCode: pin, backupSetOn: today } } });
    log('DOOR_BACKUP_CODE_SET', `backup slot ${l.backupSlot} on ${l.entityId} holds a fresh standing code (${pin.length} digits)`);
    return { pin, kind: 'backup', fresh: true };
  } catch (e) {
    log('DOOR_BACKUP_CODE_ERROR', 'could not set a new backup code: ' + String(e.message).slice(0, 120) + (l.backupCode ? ' - keeping the one set ' + l.backupSetOn : ''));
    return keepOld('could not set the backup code: ' + String(e.message).slice(0, 160));
  }
}
async function fallbackDoorCode(booking) {
  const r = await ensureBackup(false);
  if (r && r.pin) return { pin: r.pin, kind: 'backup', note: 'the standing backup code' };
  return { ok: false, error: (r && r.error) || 'no backup code available' };
}

/** What an owner's Test button proves: HA answers, the entity is a lock, the slot range reads. */
async function testLock(opts = {}) {
  const l = Object.assign(lockCfg(), opts || {});
  if (!l.entityId) return { ok: false, error: 'choose the lock entity first' };
  try {
    const st = await lockEntityState(l.entityId);
    if (st === undefined) return { ok: false, error: 'that entity is not in Home Assistant' };
    if (!/^lock\./.test(l.entityId)) return { ok: false, error: 'that entity is not a lock (' + l.entityId + ')' };
    const d = await detectMode(l.entityId, { save: !opts.entityId || opts.entityId === lockCfg().entityId });
    const mode = d.mode || lockCfg().mode || 'usercode';
    const used = usedSlots(l.entityId).size;
    const out = { ok: true, state: st, slotFrom: l.slotFrom, slotTo: l.slotTo, backupSlot: l.backupSlot, inUse: used,
      mode, modeWhy: d.why || d.error || '', caps: d.caps ? slimCaps(d.caps) : (lockCfg().caps || null),
      canManageCodes: mode !== 'none',
      backupSet: !!l.backupCode, backupSetOn: l.backupSetOn || null };
    // the token: an administrator's, or the keypad reports never come (maintainer, Sep 29 - built in, not only written)
    const who = await askWho();
    out.tokenAdmin = who.error ? null : who.admin;
    if (who.admin === false) out.warning = NOT_ADMIN;
    if (mode === 'usercode') {
      const probe = await readSlot(l.entityId, l.slotFrom);
      out.probe = { slot: l.slotFrom, inUse: probe.inUse, readsCode: /^\d+$/.test(String(probe.usercode ?? '')) };
    } else if (mode === 'credentials') {
      const reply = await callService('get_users', { entity_id: l.entityId });
      const sr = reply && reply.service_response; const r = sr && (sr[l.entityId] || sr);
      out.users = r && Array.isArray(r.users) ? r.users.length : null;
      out.probe = { slot: l.slotFrom, inUse: !!(r && Array.isArray(r.users) && r.users.some(u => Number(u.user_id) === l.slotFrom)), readsCode: false };
    } else {
      out.ok = false; out.error = 'this lock cannot manage codes from Home Assistant: ' + (d.why || 'no access control support');
    }
    return out;
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

// ── HOME ASSISTANT GONE, AND BACK (Sep 26 2026, maintainer's items 5 and 6) ──────────────
// Failures happen (rule 41): the unit records them and reconciles when the device returns. Every tick
// asks Home Assistant for the lock; the first miss is logged, five minutes of misses text the owner
// (once), and the first answer after an outage retries the door jobs that were waiting and puts the
// lock back to what this unit's record says - every slot in the unit's range read FRESH from the lock,
// a missing code set, a code nobody needs cleared, each step in the owner's log.
const ALERT_AFTER_MINS = 5;
let _reach = { failSince: 0, fails: 0, alerted: false, lastOkAt: 0, lastWhy: '' };
const PROBE_MINS = 10; let _probeAt = 0;
function reachState() { return Object.assign({}, _reach); }
async function watch({ now = Date.now() } = {}) {
  if (!configured()) return { skipped: true };
  const l = lockCfg();
  let ok = false, why = '';
  try {
    const st = await lockEntityState(l.entityId);
    if (st === undefined) why = 'the lock is not listed by Home Assistant';
    else if (st === 'unavailable') why = 'Home Assistant reads the lock as unavailable (Z-Wave JS cannot reach it)';
    else ok = true;
  } catch (e) { why = 'Home Assistant did not answer (' + String(e.message).replace(/\s+/g, ' ').slice(0, 90) + ')'; }
  // THE LOCK ITSELF, NOT ONLY HOME ASSISTANT (Sep 26 2026, the Yale with its batteries out): HA kept
  // showing the lock "locked" with the lock dead, so HA answering proved nothing about the lock. Every
  // PROBE_MINS while all is well - every tick while it is not - the lock is asked for one slot fresh
  // (maintainer: "keeping the lock awake and connected is important" - one Z-Wave read, not a battery cost
  // worth a missed code). Only on the User Code path: that is where a fresh read exists.
  if (ok && (_reach.failSince || now - _probeAt >= PROBE_MINS * 60000)) {
    let path = ''; try { path = await pathFor(l.entityId); } catch {}
    if (path === 'usercode') {
      _probeAt = now;
      try { await readSlot(l.entityId, l.backupSlot || l.slotFrom); }
      catch (e) { if (e.freshFailed) { ok = false; why = 'the lock itself did not answer Home Assistant (a fresh read of slot ' + (l.backupSlot || l.slotFrom) + ' failed) - its batteries, or it is out of Z-Wave range'; } }
    }
  }
  if (!ok) {
    if (!_reach.failSince) { _reach.failSince = now; log('HA_DOOR_UNREACHABLE', why + ' - door codes cannot be set or taken off until it answers'); }
    _reach.fails++; _reach.lastWhy = why;
    const mins = Math.round((now - _reach.failSince) / 60000);   // ticks land a few ms either side of the minute: the fifth tick is five minutes
    if (mins >= ALERT_AFTER_MINS && !_reach.alerted) {
      _reach.alerted = true;
      try { await Promise.race([require('./owneralert').alert('ha-door-down', `The door lock has not answered for ${mins} minutes - ${why}. Door codes cannot be set or taken off until it does; the unit will put the lock right when it answers. Check the Home Assistant box and the lock.`), new Promise(r => setTimeout(r, 10000))]); } catch {}
    }
    return { ok: false, why, mins };
  }
  const wasDown = !!_reach.failSince, downMins = wasDown ? Math.round((now - _reach.failSince) / 60000) : 0;
  _reach = { failSince: 0, fails: 0, alerted: false, lastOkAt: now, lastWhy: '' };
  // THE KEYPAD LISTENER FOLLOWS THE LOCK (Sep 26 2026, found on the bench): it was started once at
  // boot, so a lock set up after the unit started - the ordinary case, set up in Settings - was never
  // listened to and no arrival was ever recorded. Every tick that reaches the lock starts it if it
  // is not running (startEvents does nothing while a connection is open).
  startEvents();
  if (wasDown) {
    log('HA_DOOR_BACK', `Home Assistant and the lock answer again after ${downMins} min - checking the lock against this unit's record`);
    retryDoorJobs();
    await reconcile('back after ' + downMins + ' min');
  }
  return { ok: true };
}
/** the door jobs that failed or were backing off while the lock could not be reached run now */
function retryDoorJobs() {
  try {
    const rows = D().prepare(`SELECT j.id, j.booking_id, j.kind FROM automation_jobs j JOIN bookings b ON b.id=j.booking_id
      WHERE j.kind IN ('door_code','door_text','door_revoke') AND j.status IN ('pending','failed') AND j.attempts > 0`).all();
    const dl = require('./doorlock'), now = Date.now();
    let n = 0;
    for (const r of rows) {
      if (r.kind !== 'door_revoke') { const b = D().prepare(`SELECT * FROM bookings WHERE id=?`).get(r.booking_id); if (!b || dl.codeWindow(b).endDt.getTime() <= now) continue; }
      D().prepare(`UPDATE automation_jobs SET status='pending', attempts=0, next_attempt_at=datetime('now'), lease_until=NULL WHERE id=?`).run(r.id); n++;
    }
    if (n) log('HA_DOOR_JOBS_RETRIED', `${n} door job(s) that were waiting on the lock run now`);
    return n;
  } catch { return 0; }
}
let _reconciling = null;
/** Put the lock back to what this unit's record says. One at a time. */
function reconcile(reason = 'check') {
  if (_reconciling) return _reconciling;
  _reconciling = reconcileOnce(reason).finally(() => { _reconciling = null; });
  return _reconciling;
}
async function reconcileOnce(reason) {
  if (!configured()) return { skipped: true };
  const l = lockCfg();
  const path = await pathFor(l.entityId);
  if (path !== 'usercode') return { skipped: 'the lock is not on the User Code path - there is no fresh read to compare against' };
  // what SHOULD be on the lock: every booking of this unit holding a slot whose door window has not
  // closed (a member's back-to-back bookings share one slot), and the standing backup code
  const want = new Map(), now = Date.now(), dl = require('./doorlock');
  const rows = D().prepare(`SELECT id, status, door_code, remotelock_person_id AS ref, date, start_time, end_time, end_date FROM bookings WHERE remotelock_person_id LIKE ?`).all('ha:' + l.entityId + '#%');
  for (const r of rows) {
    const p = parseRef(r.ref); if (!p || p.path !== 'usercode') continue;
    const live = (r.status === 'active' || r.status === 'completed') && dl.codeWindow(r).endDt.getTime() > now;
    if (live && /^\d+$/.test(String(r.door_code || ''))) want.set(p.slot, { code: String(r.door_code), who: 'Booking: ' + r.id });
  }
  if (l.backupCode) want.set(l.backupSlot, { code: l.backupCode, who: 'the standing backup code' });
  // ONLY THE UNIT'S OWN SLOTS (maintainer's item 7): the range the owner gave it and the backup slot - never a
  // slot below or above, where the owner's own codes live
  const slots = []; for (let s = l.slotFrom; s <= l.slotTo; s++) slots.push(s); if (!slots.includes(l.backupSlot)) slots.push(l.backupSlot);
  const out = { reason, checked: 0, set: [], cleared: [], strangers: [], unreadable: [], matched: 0 };
  for (const s of slots) {
    let r;
    try { r = await readSlot(l.entityId, s); } catch (e) { out.unreadable.push(s); continue; }
    out.checked++;
    const w = want.get(s);
    const digits = r.usercode === null || r.usercode === undefined ? '' : String(r.usercode);
    if (w) {
      if (r.inUse === true && (digits === w.code || !/^\d+$/.test(digits))) { out.matched++; continue; }   // masked digits [A1]: in use is all a read can say
      try {
        await setCode(l.entityId, s, w.code);
        lastSet.set(refFor(l.entityId, s), { refused: null, at: Date.now() });
        out.set.push(s);
        log('DOOR_RECONCILE_SET', `slot ${s} on ${l.entityId} ${r.inUse === true ? 'held a different code' : 'was empty'} - set ${w.who}`);
      } catch (e) { out.unreadable.push(s); log('DOOR_RECONCILE_ERROR', `slot ${s} on ${l.entityId}: could not set ${w.who} - ${String(e.message).slice(0, 120)}`); }
    } else if (r.inUse === true) {
      // A STRANGER (maintainer's ruling, Sep 26 2026: "clear them, but never silently"): a code this unit never
      // issued - no booking of it ever held these digits (a masked read cannot be told apart, so it
      // counts as one). The range is reserved; the owner is told which slot and where their own codes go.
      let stranger = !/^\d+$/.test(digits);
      if (!stranger) { try { stranger = !D().prepare(`SELECT 1 AS x FROM bookings WHERE door_code=? LIMIT 1`).get(digits); } catch { stranger = true; } }
      try {
        await clearCode(l.entityId, s); out.cleared.push(s);
        if (stranger) { out.strangers.push(s); log('DOOR_STRANGER_CLEARED', `slot ${s} on ${l.entityId} held a code this booking system never issued - cleared. Slots ${l.slotFrom}-${l.slotTo} and ${l.backupSlot} are reserved for booking codes; keep your own codes outside them`); }
        else log('DOOR_RECONCILE_CLEARED', `slot ${s} on ${l.entityId} held a code no booking of this unit needs any more - cleared`);
      }
      catch (e) { out.unreadable.push(s); log('DOOR_RECONCILE_ERROR', `slot ${s} on ${l.entityId}: could not clear - ${String(e.message).slice(0, 120)}`); }
    } else out.matched++;
  }
  if (out.strangers.length) {
    const list = out.strangers.join(', '), plural = out.strangers.length > 1;
    try { await Promise.race([require('./owneralert').alert('door-stranger-' + list, `The door lock had ${plural ? 'codes' : 'a code'} in slot${plural ? 's' : ''} ${list} that this booking system never issued. ${plural ? 'They were' : 'It was'} removed, because slots ${l.slotFrom}-${l.slotTo} and ${l.backupSlot} are reserved for booking codes. If ${plural ? 'one was' : 'it was'} your own code, put it back in a slot outside that range.`), new Promise(r2 => setTimeout(r2, 10000))]); } catch {}
  }
  log('DOOR_RECONCILE', `${reason}: ${out.checked} slot(s) read from the lock - ${out.set.length} set${out.set.length ? ' (' + out.set.join(', ') + ')' : ''}, ${out.cleared.length} cleared${out.cleared.length ? ' (' + out.cleared.join(', ') + ')' : ''}${out.strangers.length ? ` - ${out.strangers.length} of them never issued by this unit (${out.strangers.join(', ')}), the owner texted` : ''}, ${out.matched} already right` + (out.unreadable.length ? `, ${out.unreadable.length} could not be read (${out.unreadable.join(', ')})` : ''));
  return out;
}

// ── the keypad event: a customer actually arrived ─────────────────────────────
// HA websocket [R10] -> subscribe_events zwave_js_notification [R8] ->
// command_class 113 (Notification), type 6 (Access Control), event 5 / 6
// (Keypad lock / unlock operation), parameters.userId = the slot [R9].
let _ws = null, _stop = false, _backoff = 5000, _seen = 0;
// WHOSE TOKEN, AND DID HOME ASSISTANT LET THIS UNIT LISTEN (Oct 2026; maintainer, Sep 29: "people should just use the
// admin token ... we need that explained clearly and built in"). Home Assistant gives the keypad reports -
// who opened the door, when - only to an administrator's token [R13]; any other token still sets and clears
// codes [R16], so the only sign was arrivals that never came. The unit asks whose token it is [R15] and reads
// Home Assistant's answer to the subscription [R14], and a refusal is said in the Log, in Test the lock and on
// the Door codes line, with the fix in words. test-hadoor H18.
let _who = null, _listen = null, _refusedSaid = false;
const NOT_ADMIN = 'The Home Assistant token belongs to a user who is not an administrator, so the lock\'s keypad reports never reach this unit and it cannot tell who opened the door or when. Codes are still set and cleared. Make the token while signed in to Home Assistant as an administrator (your profile > Security > Long-lived access tokens), then paste it in Settings > Devices > Home Assistant.';
function eventsState() {
  return { connected: !!(_ws && _ws.readyState === 1), seen: _seen,
    listening: !!(_listen && _listen.ok), refused: _listen && !_listen.ok ? (_listen.code || 'refused') : null,
    admin: _who ? _who.admin : null, problem: _listen && !_listen.ok ? (_listen.code === 'unauthorized' || (_who && _who.admin === false) ? NOT_ADMIN : 'Home Assistant refused this unit the lock\'s keypad reports (' + (_listen.message || _listen.code || 'no reason given') + ').') : null };
}
/** Whose token is this? One short websocket of its own: auth, auth/current_user [R15], close. */
function askWho(timeoutMs = 6000) {
  return new Promise(resolve => {
    if (!configured() || typeof WebSocket !== 'function') return resolve({ error: 'Home Assistant is not set up' });
    const c = getConfig().homeAssistant || {};
    let ws, done = false;
    const finish = r => { if (done) return; done = true; clearTimeout(t); try { ws && ws.close(); } catch {} resolve(r); };
    const t = setTimeout(() => finish({ error: 'Home Assistant did not answer' }), timeoutMs);
    try { ws = new WebSocket(String(c.url || '').replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket'); } catch (e) { return finish({ error: String(e.message) }); }
    ws.onmessage = m => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: c.token }));
      else if (msg.type === 'auth_invalid') finish({ error: 'Home Assistant refused the token' });
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'auth/current_user' }));
      else if (msg.type === 'result' && msg.id === 1) finish(msg.success && msg.result ? { admin: !!msg.result.is_admin, owner: !!msg.result.is_owner, name: String(msg.result.name || '') } : { error: (msg.error && msg.error.message) || 'no answer' });
    };
    ws.onerror = () => finish({ error: 'could not open the Home Assistant websocket' });
  });
}
function onNotification(ev) {
  const d = (ev && ev.data) || {};
  if (Number(d.command_class) !== 113 || Number(d.type) !== 6) return;
  if (![5, 6].includes(Number(d.event))) return;                   // keypad lock / unlock
  const slot = d.parameters && Number(d.parameters.userId);
  if (!slot) return;
  const l = lockCfg();
  _seen++;
  try {
    // THE BOOKING THAT HOLDS THIS SLOT (Sep 26 2026): either ref shape, and when a member's back-to-back
    // bookings share one slot, the one whose window is open now
    const unlock = Number(d.event) === 6;
    const dl = require('./doorlock'), nowMs = Date.now();
    const cands = D().prepare(`SELECT id, name, bay_name, date, start_time, end_time, end_date, remotelock_person_id AS ref, door_used_at FROM bookings WHERE remotelock_person_id LIKE ? AND status IN ('active','completed')`).all('ha:' + l.entityId + '#%')
      .filter(r => { const p = parseRef(r.ref); return p && p.slot === slot; });
    const row = cands.find(r => { const w = dl.codeWindow(r); return w.startDt.getTime() <= nowMs && nowMs < w.endDt.getTime(); }) || cands[0];
    if (row) {
      if (unlock && !row.door_used_at) D().prepare(`UPDATE bookings SET door_used_at=datetime('now') WHERE id=?`).run(row.id);
      // who, when and which session in one line (Oct 2026): the time is the log line's own
      log(unlock ? 'DOOR_ARRIVAL' : 'DOOR_CODE_USED', `Booking: ${row.id} | ${row.name || ''} | ${row.date} ${row.start_time} on ${row.bay_name || ''} | ${unlock ? 'arrived - the keypad opened the door' : 'keypad lock'} with slot ${slot}`);
    } else if (slot === l.backupSlot) {
      log('DOOR_BACKUP_CODE_USED', `the standing backup code opened the door (slot ${slot})`);
    } else {
      log('DOOR_CODE_USED', `slot ${slot} used at the keypad - no booking holds it`);
    }
  } catch (e) {
    // never silent (rule 29): a keypad report the unit could not record is itself recorded
    try { log('HA_DOOR_EVENTS_ERROR', `the keypad reported slot ${slot} but the unit could not record it: ${String(e && e.message).slice(0, 120)}`); } catch {}
  }
}
function startEvents() {
  if (_ws || _stop) return;
  if (!configured() || typeof WebSocket !== 'function') return;
  const c = getConfig().homeAssistant || {};
  const url = String(c.url || '').replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket';
  let ws;
  try { ws = new WebSocket(url); } catch (e) { return; }
  _ws = ws; let id = 0, idWho = 0, idSub = 0;
  const send = o => { try { ws.send(JSON.stringify(o)); } catch {} };
  ws.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.type === 'auth_required') send({ type: 'auth', access_token: c.token });
    else if (msg.type === 'auth_ok') {
      _backoff = 5000;
      send({ id: idWho = ++id, type: 'auth/current_user' });
      send({ id: idSub = ++id, type: 'subscribe_events', event_type: 'zwave_js_notification' });
    }
    else if (msg.type === 'result' && msg.id === idWho) { _who = msg.success && msg.result ? { admin: !!msg.result.is_admin, owner: !!msg.result.is_owner, name: String(msg.result.name || '') } : null; }
    else if (msg.type === 'result' && msg.id === idSub) {
      _listen = msg.success ? { ok: true } : { ok: false, code: msg.error && msg.error.code, message: msg.error && msg.error.message };
      // never silent (rule 29), and once per connection, not once a reconnect
      if (!_listen.ok && !_refusedSaid) { _refusedSaid = true; log('HA_DOOR_EVENTS_ERROR', eventsState().problem); }
    }
    else if (msg.type === 'auth_invalid') { log('HA_DOOR_EVENTS_ERROR', 'Home Assistant refused the token for door events'); try { ws.close(); } catch {} }
    else if (msg.type === 'event' && msg.event && msg.event.event_type === 'zwave_js_notification') onNotification(msg.event);
  };
  ws.onclose = () => { _ws = null; _listen = null; _who = null; _refusedSaid = false; if (!_stop) setTimeout(startEvents, _backoff = Math.min(_backoff * 2, 300000)); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function stopEvents() { _stop = true; try { _ws && _ws.close(); } catch {} _ws = null; }

module.exports = { configured, generateDoorCode, confirmDoorCode, revokeDoorCode, fallbackDoorCode, ensureBackup, testLock,
  startEvents, stopEvents, eventsState, askWho, NOT_ADMIN, refFor, refForUser, parseRef, freeSlot, usedSlots, lockCfg, USER_CODE_CC, RESPONDS,
  detectMode, pathFor, pinLengthFor, watch, reachState, reconcile, retryDoorJobs, memberPinFor, ALERT_AFTER_MINS,
  _resetReach: () => { _reach = { failSince: 0, fails: 0, alerted: false, lastOkAt: 0, lastWhy: '' }; _probeAt = 0; }, PROBE_MINS,
  _onNotification: onNotification, _resetEvents: () => { _stop = false; }, _lastSet: lastSet, _resetMode: () => { _modeMemo = null; } };
