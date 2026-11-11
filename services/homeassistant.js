// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/homeassistant.js  —  Home Assistant Integration
//
//  One integration that controls anything Home Assistant supports.
//  The facility runs Home Assistant on their own network; this talks to its
//  local REST API with a long-lived access token.
//
//  Config (config.json → homeAssistant):
//    enabled : bool
//    url     : "http://homeassistant.local:8123"  (no trailing slash)
//    token   : long-lived access token
//
//  Per-bay HA devices live in config.json → bays[].haDevices[]:
//    { entity_id: "switch.bay1_power", name: "Bay 1 Power", kind: "power"|"climate",
//      minutesBefore, minutesAfter, turnOffAfter,           // power
//      comfortTemp, ecoTemp, coolEcoTemp, leadTimeMins, setbackDelayMins } // climate (setClimate)
//
//  API surface used (all bearer-token auth):
//    GET  /api/                              — connection test
//    GET  /api/states                        — list entities (discovery)
//    GET  /api/states/{entity_id}            — read one entity (verify)
//    POST /api/services/{domain}/{service}   — universal control
// ═══════════════════════════════════════════════════════════════════════════════

const { getConfig } = require('./config');
const { adminLog }  = require('./db');

const TIMEOUT_MS = 8000;

/** Build base URL + headers from config. Throws if not configured. */
function haAuth() {
  const cfg = getConfig().homeAssistant || {};
  const url = (cfg.url || '').replace(/\/+$/, '');   // strip trailing slash
  const token = cfg.token || '';
  if (!cfg.enabled) throw new Error('Home Assistant not enabled');
  if (!url)   throw new Error('Home Assistant URL not set');
  if (!token || token.startsWith('PASTE')) throw new Error('Home Assistant token not set');
  return {
    url,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  };
}

/** Low-level fetch with timeout. Returns parsed JSON or throws. */
async function haFetch(path, method = 'GET', body = null) {
  const { url, headers } = haAuth();
  const opts = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${url}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HA ${res.status}: ${text.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

/** Map an entity_id prefix to its HA service domain for on/off control. */
function domainFor(entityId) {
  return (entityId || '').split('.')[0] || '';
}

/**
 * Test the connection. Returns { ok, message, entityCount } or { ok:false, error }.
 * Proves the Pi can reach HA AND the token is valid by reading live state.
 */
async function testConnection() {
  try {
    // /api/ returns { message: "API running." } when the token is valid.
    // A 200 IS NOT AN ANSWER (Sep 16 2026, the coverage wave). haFetch returns
    // TEXT when the content-type is not JSON, so a reverse proxy's login page -
    // the ordinary shape when someone puts HA behind one and the booking unit is
    // not signed in - came back as a string, did not throw, and this reported
    // "Connected to Home Assistant" with 0 entities. The owner then wonders why
    // nothing works. Same defect the UniFi audit found at its own Test
    // Connection; demand the shape Home Assistant actually returns.
    const hello = await haFetch('/api/');
    if (!hello || typeof hello !== 'object' || !/API running/i.test(String(hello.message || ''))) {
      const shape = typeof hello === 'string' ? `${hello.length} bytes of ${/^\s*</.test(hello) ? 'HTML' : 'text'}` : JSON.stringify(hello).slice(0, 80);
      return { ok: false, error: `that address answered, but it is not Home Assistant's API (${shape}) - check the URL, and that this unit can reach it without signing in through a proxy` };
    }
    const states = await haFetch('/api/states');
    if (!Array.isArray(states)) return { ok: false, error: 'Home Assistant answered but did not return its entity list - check the token has permission' };
    return {
      ok: true,
      message: 'Connected to Home Assistant',
      entityCount: states.length
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Discover entities, grouped by domain, friendly names included.
 * Returns { groups: { switch:[...], light:[...], climate:[...], cover:[...], lock:[...], other:[...] }, total }
 * Each item: { entity_id, name, state }
 */
async function discoverEntities() {
  const states = await haFetch('/api/states');
  const groups = { switch: [], light: [], climate: [], cover: [], lock: [], other: [] };
  for (const e of states) {
    const domain = domainFor(e.entity_id);
    const item = {
      entity_id: e.entity_id,
      name: e.attributes?.friendly_name || e.entity_id,
      state: e.state
    };
    if (groups[domain]) groups[domain].push(item);
    else groups.other.push(item);
  }
  // Sort each group by friendly name
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.name.localeCompare(b.name));
  return { groups, total: states.length };
}

/** Read a single entity's current state (for verification). */
async function getEntityState(entityId) {
  try {
    const e = await haFetch(`/api/states/${encodeURIComponent(entityId)}`);
    return { ok: true, state: e.state, attributes: e.attributes };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Call an arbitrary HA service. data must include entity_id (or target). */
async function callService(domain, service, data = {}) {
  return haFetch(`/api/services/${domain}/${service}`, 'POST', data);
}

/**
 * Turn an entity on or off. Domain-aware:
 *   switch/light/fan/etc → {domain}.turn_on / turn_off
 *   cover                → open_cover / close_cover
 *   lock                 → unlock / lock
 * Falls back to the generic homeassistant.turn_on/off which works on most domains.
 */
async function setEntity(entityId, on) {
  const domain = domainFor(entityId);
  let svcDomain = domain;
  let service;

  if (domain === 'cover') {
    service = on ? 'open_cover' : 'close_cover';
  } else if (domain === 'lock') {
    service = on ? 'unlock' : 'lock';
  } else if (['switch', 'light', 'fan', 'input_boolean', 'humidifier'].includes(domain)) {
    service = on ? 'turn_on' : 'turn_off';
  } else {
    // Generic fallback — works for most actuator domains
    svcDomain = 'homeassistant';
    service = on ? 'turn_on' : 'turn_off';
  }

  try {
    await callService(svcDomain, service, { entity_id: entityId });
    adminLog('HA_' + (on ? 'ON' : 'OFF'), `Entity: ${entityId}`);
    return { success: true };
  } catch (err) {
    adminLog('HA_ERROR', `Entity: ${entityId} — ${err.message}`);
    return { success: false, error: err.message };
  }
}

/** Set a climate entity to a target temperature (°F or °C per the HA install). */
async function setTemperature(entityId, temp) {
  try {
    await callService('climate', 'set_temperature', { entity_id: entityId, temperature: temp });
    adminLog('HA_CLIMATE', `Entity: ${entityId} → ${temp}°`);
    return { success: true };
  } catch (err) {
    adminLog('HA_CLIMATE_ERROR', `Entity: ${entityId} — ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * A THERMOSTAT IS SET FOR THE SEASON IT IS IN (Oct 21 2026; maintainer, on the AI box: "heat and Ac would be a facility one").
 * One number used to be sent whatever the thermostat was doing. A thermostat cooling for the summer was set back to the
 * HEATING setback after every session - 60 degrees, the air conditioning running flat out in an empty room. One in
 * heat/cool mode was sent a single number its integration ignores without a word (Z-Wave JS and ZHA read only the low
 * and high setpoints in that mode), so the job read done and nothing changed. The mode is read first now:
 *   heat                        the heating number
 *   cool                        the cooling number
 *   heat_cool, or a mode        the low and high setpoints: heating low, cooling high
 *   showing only the two
 *   auto with one setpoint      comfort (one number either way); a setback is not guessed - said, never failed
 *   off, fan only, dry          nothing: someone set it that way, and the unit never turns heat or cooling on over
 *                               them (rule 31 - not applicable, never a failure)
 *   unavailable, unknown        a failure: the thermostat did not answer (rule 29)
 *
 * A device's numbers (a bay's Home Assistant devices, and the facility's on the AI edition):
 *   comfortTemp   during sessions
 *   ecoTemp       the setback the owner gave. Below comfort it is the heating setback; above comfort (an owner who only
 *                 cools) it is the cooling one
 *   coolEcoTemp   the cooling setback
 * A setback not given mirrors the other around comfort: a 70 comfort with a 60 heating setback cools no lower than 80
 * when idle.
 */
const RANGE_HALF = 2;   // heat/cool mode during sessions: from comfort minus this to comfort plus this
function climateTargets(d) {
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const C = num(d && d.comfortTemp), E = num(d && d.ecoTemp), CE = num(d && d.coolEcoTemp);
  const comfort = C == null ? null : { heat: C, cool: C, range: [C - RANGE_HALF, C + RANGE_HALF] };
  let eco = null;
  if (E != null) {
    const mid = C == null ? E : C;
    const heat = E <= mid ? E : mid - (E - mid);
    const cool = CE != null ? CE : (E >= mid ? E : mid + (mid - E));
    eco = { heat, cool, range: [heat, cool] };
  }
  return { comfort, eco };
}

/** Set a climate entity to one of climateTargets()'s phases ({ heat, cool, range }), by the mode it is in now. Returns
 *  { success, mode, sent } / { success:false, error } / { skipped:true, reason }. */
async function setClimate(entityId, t) {
  if (!t) return { skipped: true, reason: 'no temperature is set for this thermostat' };
  let st;
  try { st = await haFetch(`/api/states/${encodeURIComponent(entityId)}`); }
  catch (err) { adminLog('HA_CLIMATE_ERROR', `Entity: ${entityId} — ${err.message}`); return { success: false, error: err.message }; }
  const mode = String((st && typeof st === 'object' && st.state) || '').toLowerCase();
  const at = (st && typeof st === 'object' && st.attributes) || {};
  if (!mode || mode === 'unavailable' || mode === 'unknown') {
    const error = `the thermostat reads ${mode || 'nothing'} in Home Assistant`;
    adminLog('HA_CLIMATE_ERROR', `Entity: ${entityId} — ${error}`);
    return { success: false, error };
  }
  if (['off', 'fan_only', 'dry'].includes(mode)) return { skipped: true, reason: `the thermostat is set to ${mode.replace('_', ' ')} - the unit never switches it to heating or cooling` };
  const ranged = mode === 'heat_cool' || (at.temperature == null && at.target_temp_low != null && at.target_temp_high != null);
  let data;
  if (ranged) data = { entity_id: entityId, target_temp_low: t.range[0], target_temp_high: t.range[1] };
  else if (mode === 'cool') data = { entity_id: entityId, temperature: t.cool };
  else if (mode === 'heat') data = { entity_id: entityId, temperature: t.heat };
  else if (t.heat === t.cool) data = { entity_id: entityId, temperature: t.heat };
  else return { skipped: true, reason: `the thermostat runs itself in ${mode} with one setpoint - set it to heat, cool or heat/cool and the unit sets it back between sessions` };
  const sent = ranged ? `${data.target_temp_low}-${data.target_temp_high}` : String(data.temperature);
  try {
    await callService('climate', 'set_temperature', data);
    adminLog('HA_CLIMATE', `Entity: ${entityId} (${mode}) → ${sent}°`);
    return { success: true, mode, sent };
  } catch (err) {
    adminLog('HA_CLIMATE_ERROR', `Entity: ${entityId} (${mode}) — ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Per-bay helpers used by the scheduler. A bay may have haDevices[] of kind
 * 'power' (on/off) or 'climate' (comfort/eco temperatures).
 */

/** Run any custom service calls bound to a booking event ('start' | 'end'). */
async function runCustomActions(event) {
  const cfg = getConfig().homeAssistant || {};
  const actions = (cfg.customActions || []).filter(a => a.event === event && a.enabled !== false);
  for (const a of actions) {
    try {
      await callService(a.domain, a.service, a.data || {});
      adminLog('HA_CUSTOM_ACTION', `${event}: ${a.domain}.${a.service}`);
    } catch (err) {
      adminLog('HA_CUSTOM_ACTION_ERROR', `${a.domain}.${a.service} — ${err.message}`);
    }
  }
}

module.exports = {
  haFetch,          // the door provider (services/hadoor.js) speaks to HA through the same client
  testConnection,
  discoverEntities,
  getEntityState,
  callService,
  setEntity,
  setTemperature,
  climateTargets,
  setClimate,
  runCustomActions,
  domainFor
};
