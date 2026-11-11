// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/hadevices.js  -  THE SMART-HOME DEVICES: WHAT IS THERE, PAIRING, NAMES
//  (Oct 19 2026)
//
//  maintainer: "Hey, I have this z wave plug. I wanna pair it and it's gonna go on this bay
//  ... And then be like, hey, it's paired, turn it on or off or whatever, you know,
//  right from their little app on their phone talking to the a I". The pairing is
//  Home Assistant's own (its radios, its device list), driven over its websocket so
//  the owner never opens Home Assistant: Z-Wave, Zigbee and Matter the same way.
//  Putting a device on a bay is the bay's own haDevices list (the bay editor's save),
//  and switching it is the existing /api/admin/homeassistant/control.
//
//  One pairing at a time. It runs in the background after start(); the owner's page
//  asks status() every second or two and shows what to do next (press the button,
//  type the PIN on the label, wait). A pairing nobody answers stops by itself.
//
//  Built from Home Assistant 2026.9.4's own source, read in the workshop lab:
//   [D1] components/zwave_js/api.py websocket_add_node: "zwave_js/add_node" {entry_id,
//        inclusion_strategy} (0 = default: the best security the device offers; 1,
//        SmartStart, is refused here) is a SUBSCRIPTION; its events are {event:
//        "inclusion started" | "inclusion failed" | "inclusion stopped"}, {event:
//        "node found", node:{node_id}}, {event:"grant security classes",
//        requested_grant:{securityClasses, clientSideAuth}}, {event:"validate dsk and
//        enter pin", dsk}, {event:"node added", node:{node_id, status, ready,
//        low_security, low_security_reason}}, {event:"device registered", device:{name,
//        id, manufacturer, model}}, {event:"interview started" | "interview completed"
//        | "interview failed"}, {event:"interview stage completed", stage}, {event:
//        "interview progress"}; the result is true. THE ORDER, seen on the real thing
//        (Home Assistant 2026.9.4 on zwave-js 15.31.0, the lab walk): inclusion started >
//        inclusion stopped > node found > node added > interview started > device
//        registered > ... > device registered (again, once the device is known) >
//        interview completed. "zwave_js/grant_security_classes" {entry_id, securityClasses,
//        clientSideAuth} (camel case - api.py's SECURITY_CLASSES and CLIENT_SIDE_AUTH; read
//        wrong as snake case until Oct 25 2026); "zwave_js/validate_dsk_and_enter_pin" {entry_id, pin};
//        "zwave_js/stop_inclusion" {entry_id}.
//   [D2] components/zha/websocket_api.py: "zha/devices/permit" {duration 0-254,
//        default 60} is a subscription forwarding the gateway's messages; zha/helpers.py
//        sends {type:"device_joined", device_info:{nwk, ieee, pairing_status}},
//        {type:"raw_device_initialized", device_info:{..., model, manufacturer}} and
//        {type:"device_fully_initialized", device_info: the device's zha_device_info,
//        which carries device_reg_id}; the names are the zha library's own
//        (zha/application/const.py in zha 2.2.2, the version Home Assistant pins).
//   [D3] components/matter/api.py: "matter/commission" {code, network_only} answers
//        once the device is commissioned.
//   [D4] components/config/device_registry.py "config/device_registry/list" ->
//        [{id, name, name_by_user, manufacturer, model, identifiers:[[domain, id]],
//        config_entries, area_id, entry_type, disabled_by}]; "config/device_registry/
//        update" {device_id, name_by_user}; entity_registry.py "config/entity_registry/
//        list" -> [{entity_id, device_id, platform, name, original_name, disabled_by,
//        hidden_by, entity_category}]; websocket "get_states"; core event
//        "device_registry_updated" {action:"create", device_id}.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const { getConfig } = require('./config');
const haws = require('./haws');
const log = (ev, d) => { try { require('./db').adminLog(ev, String(d).slice(0, 300)); } catch {} };

const PROTOCOLS = {
  zwave:  { domain: 'zwave_js', say: 'Z-Wave' },
  zigbee: { domain: 'zha', say: 'Zigbee' },
  matter: { domain: 'matter', say: 'Matter' },
};
const KIND_OF = { zwave_js: 'Z-Wave', zha: 'Zigbee', matter: 'Matter' };
// what a bay or a person can switch; locks are listed but never switched by the assistant (doors open by codes)
const CONTROLS = ['switch', 'light', 'fan', 'climate', 'cover', 'lock', 'media_player', 'input_boolean', 'humidifier', 'valve', 'water_heater', 'siren'];
const WAIT_MS = () => Number(process.env.BA_TEST_PAIR_WAIT_MS) || 180000;        // nobody pressed the button
const PIN_MS = () => Number(process.env.BA_TEST_PAIR_PIN_MS) || 180000;          // nobody typed the PIN
const INTERVIEW_MS = () => Number(process.env.BA_TEST_PAIR_INTERVIEW_MS) || 300000;
// "INCLUSION STOPPED" IS NOT "NOTHING JOINED" (Oct 19 2026, found walking the real Home Assistant and zwave-js in the
// workshop lab): the controller leaves pairing mode the moment it finds a device, so the real order is inclusion
// started > inclusion stopped > node found > node added. Taken as the end, it gave up on a plug that was joining.
// After a stop the pairing waits this long for a device before it says nothing joined.
const STOPPED_GRACE_MS = () => Number(process.env.BA_TEST_PAIR_STOPPED_GRACE_MS) || 5000;

function haCfg() { return getConfig().homeAssistant || {}; }
function connectable() { const c = haCfg(); return !!(c.enabled && c.url && c.token); }
const session = () => haws.open({ url: haCfg().url, token: haCfg().token });

function bayOf(entityId) {
  for (const b of getConfig().bays || []) if ((b.haDevices || []).some(d => d.entity_id === entityId)) return b.name;
  // on the whole facility (services/facilitydevices, Oct 21 2026): the heat and AC, a lounge TV
  if (require('./facilitydevices').has(getConfig(), entityId)) return 'the facility';
  return null;
}
function kindOf(dev, entriesById) {
  for (const [domain] of dev.identifiers || []) if (KIND_OF[domain]) return KIND_OF[domain];
  for (const id of dev.config_entries || []) { const e = entriesById[id]; if (e) return KIND_OF[e.domain] || e.title || e.domain; }
  return 'other';
}

/** [D4] the devices with something to control, each with its controls and the bay each control is on */
async function read(s, onlyDevice) {
  const [devs, ents, states, entries] = await Promise.all([s.call('config/device_registry/list'), s.call('config/entity_registry/list'), s.call('get_states'), s.call('config_entries/get', {})]);
  const stateOf = new Map((states || []).map(x => [x.entity_id, x]));
  const entriesById = Object.fromEntries((entries || []).map(e => [e.entry_id, e]));
  const out = [];
  for (const d of devs || []) {
    if (onlyDevice && d.id !== onlyDevice) continue;
    if (d.entry_type === 'service' || d.disabled_by) continue;
    const controls = (ents || []).filter(e => e.device_id === d.id && !e.disabled_by && !e.hidden_by && !e.entity_category && CONTROLS.includes(e.entity_id.split('.')[0]))
      .map(e => { const st = stateOf.get(e.entity_id) || {}; return { entity_id: e.entity_id, name: (st.attributes && st.attributes.friendly_name) || e.name || e.original_name || e.entity_id, what: e.entity_id.split('.')[0], state: st.state || 'unknown', bay: bayOf(e.entity_id) }; });
    if (!controls.length && !onlyDevice) continue;
    out.push({ id: d.id, name: d.name_by_user || d.name || 'A device with no name', maker: d.manufacturer || null, model: d.model || null, kind: kindOf(d, entriesById), area: d.area_id || null, controls });
  }
  return out;
}
async function list() {
  if (!connectable()) return { connected: false, reason: 'Home Assistant is not connected to this unit', devices: [] };
  let s;
  try { s = await session(); } catch (e) { return { connected: false, reason: e.code === 'auth_invalid' ? 'Home Assistant refused the unit\'s token' : 'Home Assistant is not answering', devices: [] }; }
  try { return { connected: true, devices: await read(s) }; }
  catch (e) { return { connected: false, reason: 'Home Assistant: ' + e.message, devices: [] }; }
  finally { s.close(); }
}

/** [D4] a device's name, as the owner says it (Home Assistant's own "name given by the user") */
async function rename(deviceId, name) {
  if (!connectable()) return { ok: false, error: 'Home Assistant is not connected to this unit' };
  const n = String(name || '').trim().slice(0, 60);
  if (!n) return { ok: false, error: 'the new name is empty' };
  let s;
  try { s = await session(); } catch (e) { return { ok: false, error: 'Home Assistant is not answering' }; }
  try {
    await s.call('config/device_registry/update', { device_id: String(deviceId), name_by_user: n });
    log('DEVICE_RENAMED', `a smart-home device is now called "${n}"`);
    const [d] = await read(s, String(deviceId));
    return { ok: true, device: d || { id: deviceId, name: n } };
  } catch (e) { return { ok: false, error: e.code === 'not_found' ? 'there is no such device' : 'Home Assistant: ' + e.message }; }
  finally { s.close(); }
}

// ── pairing ─────────────────────────────────────────────────────────────────
let _p = null;
const SAY = {
  starting: 'Getting the hub ready...',
  waiting: { zwave: 'Pairing is on. Put the device near the hub and press its pairing button - most plugs: three quick presses (its manual says).', zigbee: 'Pairing is on. Put the device near the hub and reset it into pairing mode - most: hold its button until the light blinks (its manual says).', matter: 'Adding the device with the code from its app...' },
  found: 'A device answered - joining it now...',
  needs_pin: 'This device is secure: type the 5-digit PIN printed on its label (or its box), the first five digits under the QR code.',
  adding: 'Joining it now...',
  interviewing: 'It joined. Learning what it can do - this can take a minute...',
};
// (Oct 25 2026) a secure (S2) device whose security could not be set up - a PIN that did not match, one not typed in time, a
// pairing stopped at the PIN - is ON the hub's network but never used: zwave-js 15 marks it failedS2Bootstrapping and never
// interviews it (lib/node/Node.js: "has failed S2 bootstrapping and cannot be interviewed"), so it has no controls. Pairing again
// cannot reach it while it is on the network; its own factory reset takes it off (zwave-js removes a device that reports a reset:
// lib/node/CCHandlers/DeviceResetLocallyCC.js, "The node was reset locally, removing it"). Found by the lab's S2 pair walk -
// until today a wrong PIN was told "fine for a plug or a light".
const RESET_AGAIN = 'Reset the device to its factory settings (its manual says how) - that takes it off the hub - then pair it again and type the PIN from its label.';
// zwave-js's SecurityBootstrapFailure (lib/controller/Inclusion.js): 6 S2IncorrectPIN; 8 S0Downgrade and 9 Unknown are the two a
// device is still used after (it joined, with less security than it offers)
const S2_PIN_WRONG = 6, STILL_USED = [8, 9];
function view() {
  if (!_p) return { pairing: false };
  const now = Date.now();
  const say = _p.say || (typeof SAY[_p.state] === 'object' ? SAY[_p.state][_p.protocol] : SAY[_p.state]) || '';
  return { pairing: !['done', 'failed', 'stopped'].includes(_p.state), id: _p.id, protocol: _p.protocol, kind: PROTOCOLS[_p.protocol].say, state: _p.state, say,
    secondsLeft: _p.until ? Math.max(0, Math.round((_p.until - now) / 1000)) : null,
    dsk: _p.state === 'needs_pin' ? _p.dsk : undefined, lowSecurity: _p.lowSecurity || undefined,
    device: _p.device || undefined, controls: _p.controls || undefined };
}
function status() { return view(); }

function set(state, extra) { if (!_p) return; _p.state = state; _p.say = null; Object.assign(_p, extra || {}); }
async function cleanup(p) {
  clearTimeout(p.timer); clearTimeout(p.graceTimer);
  for (const stop of p.stops.splice(0)) { try { await stop(); } catch {} }
  try { p.s && p.s.close(); } catch {}
}
/** the end of a pairing: what joined, with its controls, or why nothing did */
async function finish(p, state, say) {
  if (p.finished) return; p.finished = true;
  clearTimeout(p.timer);
  if (state === 'done') {
    // Home Assistant makes the device's controls a moment after the interview: ask for them for a few seconds
    const devId = (p.device && p.device.id) || p.created[p.created.length - 1];
    let d = null;
    for (let i = 0; i < 10 && devId; i++) {
      try { [d] = await read(p.s, devId); } catch {}
      if (d && d.controls.length) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (d) { p.device = { id: d.id, name: d.name, maker: d.maker, model: d.model, kind: d.kind }; p.controls = d.controls; }
    log('DEVICE_PAIRED', `${PROTOCOLS[p.protocol].say}: ${p.device ? p.device.name : 'a device'} joined the hub${p.controls && p.controls.length ? ' (' + p.controls.map(c => c.entity_id).join(', ') + ')' : ''}${say ? ' - ' + say : ''}`);
  } else if (state === 'failed') log('DEVICE_PAIR_FAILED', `${PROTOCOLS[p.protocol].say}: ${say}`);
  if (_p === p) {
    set(state);
    p.say = say || (state === 'done' ? `Paired: ${p.device ? p.device.name : 'the device'}.` : null);
    // a device that joined with less security than it offers, and is still used: said so, never hidden
    if (state === 'done' && p.lowSecurity) p.say += ' It joined with less security than it offers - fine for a plug or a light; for a lock, reset it (its manual says how) and pair it again.';
  }
  await cleanup(p);
}

/** Start pairing. protocol 'zwave' | 'zigbee' | 'matter'; code is a Matter pairing code. Answers at once; status() follows it. */
async function start({ protocol, code } = {}) {
  const proto = PROTOCOLS[protocol];
  if (!proto) return { ok: false, error: 'pair a Z-Wave, Zigbee or Matter device' };
  if (_p && view().pairing) return { ok: false, error: `a ${PROTOCOLS[_p.protocol].say} pairing is already on - finish or stop it first`, status: view() };
  if (!connectable()) return { ok: false, error: 'Home Assistant is not connected to this unit' };
  let mcode = null;
  if (protocol === 'matter') {
    mcode = String(code || '').trim().replace(/[\s-]/g, '');
    if (!/^(MT:[0-9A-Z.]{10,}|\d{11}|\d{21})$/i.test(mcode)) return { ok: false, error: 'a Matter device is set up in its own app first (or Apple Home or Google Home), then shared from there: type the pairing code that app shows' };
  }
  let s;
  try { s = await session(); } catch (e) { return { ok: false, error: e.code === 'auth_invalid' ? 'Home Assistant refused the unit\'s token' : 'Home Assistant is not answering' }; }
  let entry;
  try { entry = ((await s.call('config_entries/get', { domain: proto.domain })) || []).find(e => e.state === 'loaded'); }
  catch (e) { s.close(); return { ok: false, error: 'Home Assistant: ' + e.message }; }
  if (!entry) { s.close(); return { ok: false, error: `${proto.say} is not ready on the hub${protocol === 'matter' ? ' (the Matter server is not running)' : ' (no ' + proto.say + ' radio is plugged in, or it is still starting)'}` }; }

  const p = _p = { id: Date.now().toString(36), protocol, state: 'starting', s, entry, stops: [], created: [], startedAt: Date.now(), until: Date.now() + WAIT_MS(), timer: null, finished: false };
  s.onClose(() => { if (!p.finished && _p === p) { p.finished = true; clearTimeout(p.timer); set('failed'); p.say = 'The connection to the hub dropped - try again.'; } });
  const window = (ms, state, say) => { clearTimeout(p.timer); p.until = Date.now() + ms; p.timer = setTimeout(() => onTimeout(p, state, say), ms); };
  try {
    // every protocol: the new device's id the moment Home Assistant makes it [D4]
    const dev = await s.subscribe('subscribe_events', { event_type: 'device_registry_updated' }, ev => { const d = ev && ev.data; if (d && d.action === 'create' && d.device_id) p.created.push(d.device_id); });
    p.stops.push(dev.stop);
    if (protocol === 'zwave') {
      const sub = await s.subscribe('zwave_js/add_node', { entry_id: entry.entry_id, inclusion_strategy: 0 }, ev => onZwave(p, ev, window));
      // the controller is told to stop including unless a device already joined (finish() has set the final state by now)
      p.stops.unshift(async () => { if (!p.joined) { try { await s.call('zwave_js/stop_inclusion', { entry_id: entry.entry_id }, 8000); } catch {} } await sub.stop(); });
      if (p.state === 'starting') set('waiting');
      // the device may already have answered while the hub was still saying yes: only a pairing still waiting gets the wait window
      if (p.state === 'waiting') window(WAIT_MS(), 'stopped', 'No device joined. Check that it is in pairing mode (its manual says how) and close to the hub, then try again.');
    } else if (protocol === 'zigbee') {
      const sub = await s.subscribe('zha/devices/permit', { duration: Math.min(254, Math.round(WAIT_MS() / 1000)) }, ev => onZigbee(p, ev, window));
      // joining is closed again whatever happened: the network is never left open for anything else to join
      p.stops.unshift(async () => { await sub.stop(); try { const z = await s.subscribe('zha/devices/permit', { duration: 0 }, () => {}); await z.stop(); } catch {} });
      if (p.state === 'starting') set('waiting');
      if (p.state === 'waiting') window(WAIT_MS(), 'stopped', 'No device joined. Reset it into pairing mode (its manual says how), keep it close to the hub, then try again.');
    } else {
      set('waiting');
      window(WAIT_MS(), 'failed', 'The device did not finish joining. Check the code, that it is powered and close to the hub, then try again.');
      s.call('matter/commission', { code: mcode, network_only: true }, WAIT_MS())
        .then(() => finish(p, 'done'))
        .catch(e => finish(p, 'failed', `It did not join (${e.message}). A Matter device is set up in its own app first (or Apple Home or Google Home), then shared from there - use the code that app shows, with the device switched on near the box, then try again.`));
    }
  } catch (e) {
    await finish(p, 'failed', 'The hub would not start pairing: ' + e.message);
    return { ok: false, error: 'the hub would not start pairing: ' + e.message, status: view() };
  }
  log('DEVICE_PAIR', `${proto.say} pairing started`);
  return { ok: true, status: view() };
}

async function onTimeout(p, state, say) { if (_p === p && !p.finished) await finish(p, state, say); }

/** [D1] Z-Wave's inclusion, event by event */
function onZwave(p, ev, window) {
  if (p.finished || !ev) return;
  const s = p.s, entryId = p.entry.entry_id;
  switch (ev.event) {
    case 'inclusion started': if (p.state === 'starting') set('waiting'); break;
    case 'node found': clearTimeout(p.graceTimer); set('found'); window(INTERVIEW_MS(), 'failed', 'The device started to join but did not finish. Reset it (its manual says how) and try again.'); break;
    case 'grant security classes': {
      // what the device asks for is what it gets - Home Assistant's own screen offers the same as its default
      const g = ev.requested_grant || {};
      p.s2 = true;
      // (Oct 25 2026) Home Assistant's field names here are camel case (its SECURITY_CLASSES / CLIENT_SIDE_AUTH constants); the
      // snake case sent until today was refused, so no S2 device could ever join - found by the lab's S2 pair walk
      s.call('zwave_js/grant_security_classes', { entry_id: entryId, securityClasses: g.securityClasses || [], clientSideAuth: !!g.clientSideAuth })
        .catch(e => finish(p, 'failed', 'The hub could not agree the device\'s security: ' + e.message));
      break;
    }
    case 'validate dsk and enter pin': set('needs_pin', { dsk: ev.dsk || '' }); window(PIN_MS(), 'failed', 'The PIN was not typed in time, so the hub could not set up the device\'s security and will not use it. ' + RESET_AGAIN); break;
    case 'node added': {
      const n = ev.node || {}, why = n.low_security_reason;
      set('adding', { joined: true, nodeId: n.node_id, lowSecurity: !!n.low_security });
      if (p.s2 && n.low_security && !STILL_USED.includes(why)) {
        finish(p, 'failed', (why === S2_PIN_WRONG ? 'The PIN did not match' : 'The device\'s security could not be set up') + ', so the hub will not use it. ' + RESET_AGAIN);
        break;
      }
      window(INTERVIEW_MS(), 'done', 'It joined; it is still finishing its setup, so a control may take a minute to answer.'); break;
    }
    case 'device registered': p.device = Object.assign({}, p.device, { id: ev.device && ev.device.id, name: ev.device && ev.device.name, maker: ev.device && ev.device.manufacturer, model: ev.device && ev.device.model }); break;
    case 'interview started': case 'interview stage completed': if (p.state !== 'interviewing') set('interviewing'); break;
    case 'interview completed': finish(p, 'done'); break;
    case 'interview failed': finish(p, 'done', 'It joined, but did not answer every question - it may still work; if a control does not, pair it again closer to the hub.'); break;
    case 'inclusion failed': finish(p, 'failed', 'The device did not finish joining. Reset it (its manual says how) and try again.'); break;
    case 'inclusion stopped':
      // the controller also stops when it has FOUND a device - give it a moment to say so
      if (['starting', 'waiting'].includes(p.state)) { clearTimeout(p.graceTimer); p.graceTimer = setTimeout(() => { if (!p.finished && ['starting', 'waiting'].includes(p.state)) finish(p, 'stopped', 'Pairing stopped before a device joined.'); }, STOPPED_GRACE_MS()); }
      break;
  }
}

/** [D2] Zigbee's join, message by message (the debug log lines that ride the same subscription are ignored) */
function onZigbee(p, msg, window) {
  if (p.finished || !msg) return;
  const info = msg.device_info || {};
  if (msg.type === 'device_joined') { set('found', { joined: true, ieee: info.ieee }); window(INTERVIEW_MS(), 'failed', 'The device started to join but did not finish. Reset it and try again, close to the hub.'); }
  else if (msg.type === 'raw_device_initialized') { set('interviewing'); p.device = Object.assign({}, p.device, { maker: info.manufacturer, model: info.model }); }
  // only the device that JOINED in this window: a device already on the network re-announcing itself is not it
  else if (msg.type === 'device_fully_initialized' && p.ieee && info.ieee === p.ieee) {
    p.device = Object.assign({}, p.device, { id: info.device_reg_id, name: info.user_given_name || info.name, maker: info.manufacturer, model: info.model });
    finish(p, 'done');
  }
}

/** [D1] the PIN on a secure Z-Wave device's label */
async function pin(value) {
  const v = String(value || '').trim();
  if (!_p || _p.state !== 'needs_pin') return { ok: false, error: 'no device is waiting for a PIN', status: view() };
  if (!/^\d{5}$/.test(v)) return { ok: false, error: 'the PIN is the five digits on the device\'s label', status: view() };
  const p = _p;
  try {
    await p.s.call('zwave_js/validate_dsk_and_enter_pin', { entry_id: p.entry.entry_id, pin: v });
    if (_p !== p || p.finished) return { ok: true, status: view() };
    set('adding');
    // the PIN is in: the window that was waiting for it now waits for the device (it said "not typed in time" until Oct 25 2026)
    clearTimeout(p.timer); p.until = Date.now() + INTERVIEW_MS();
    p.timer = setTimeout(() => onTimeout(p, 'failed', 'The hub took the PIN, but the device did not finish joining. ' + RESET_AGAIN), INTERVIEW_MS());
    return { ok: true, status: view() };
  }
  catch (e) { return { ok: false, error: 'the hub did not take the PIN: ' + e.message, status: view() }; }
}

/** stop pairing now */
async function stop() {
  const p = _p;
  if (!p || p.finished) return { ok: true, status: view() };
  // stopped once a secure device was asked for its security, before it was added: it is on the network and will not be used
  await finish(p, 'stopped', p.s2 && !p.joined ? 'Pairing stopped before the device\'s security was set up, so the hub will not use it. ' + RESET_AGAIN : 'Pairing stopped.');
  return { ok: true, status: view() };
}

module.exports = { list, rename, start, status, pin, stop, PROTOCOLS, CONTROLS, _reset: () => { if (_p) cleanup(_p); _p = null; } };
