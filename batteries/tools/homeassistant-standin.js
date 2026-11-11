// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  tools/homeassistant-standin.js  —  a Home Assistant that can REFUSE
//
//  maintainer ruled on Sep 16 2026 that all five zero-coverage services get batteries.
//  Home Assistant is first of the five because of what it can do: services/
//  homeassistant.js setEntity() maps the `lock` DOMAIN to unlock/lock, and
//  discoverEntities() groups lock: entities for an owner to pick - so a long-lived
//  HA token is a DOOR-OPENING credential, and until today not one assertion had
//  ever driven this file.
//
//  Shapes follow developers.home-assistant.io/docs/api/rest: Bearer auth,
//  GET /api/ -> {"message":"API running."}, GET /api/states -> an array of
//  {entity_id, state, attributes:{friendly_name}}, POST /api/services/<domain>/
//  <service> -> an array of changed states, 401 on a bad token.
//
//  No test seam is needed in the product: haAuth() reads cfg.homeAssistant.url at
//  call time, so a battery points the config at this and the real code runs.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const http = require('http');

const DEFAULT_FAULTS = {
  token:       'ha-test-token',
  rejectToken: false,   // 401 on every call
  slowMs:      0,       // the product's own timeout is TIMEOUT_MS
  htmlBody:    false,   // 200 with HTML - a reverse proxy login page
  down:        false,   // 502 on every call
  serviceFails: false,  // the service call itself 400s
  statesShape: 'normal',// 'normal' | 'empty' | 'notarray'
  // ── the Z-Wave lock (feature/door-interface) ────────────────────────────
  // Every answer below is in the shape HA's own source gives (the [R]/[A] tags
  // are the sources listed at the top of services/hadoor.js). HA hands back
  // NOTHING about a set beyond "taken" [R3][R4] - there is no Supervision
  // result to fake - so a refusing lock is modelled the way it reaches a
  // caller: a 400, a 500, or a 200 after which the slot never reads in use.
  setRefused:  false,     // set_lock_usercode -> 400 (a ServiceValidationError / schema refusal [R2])
  setError:    false,     // set_lock_usercode -> 500 (a HomeAssistantError from the integration [R2])
  setDropped:  false,     // set_lock_usercode -> 200, and the lock never stores it (the SetValueResult HA discards [R4])
  landsAfterReads: 0,     // the device answers the User Code get only after this many asks; the cached slot reads empty until then [R6]
  maskCodes:   false,     // usercode reads back '**********' [A1]; in_use is still true
  nullCodes:   false,     // usercode reads back null [R6]; in_use is still true
  lockDead:    false,     // the lock entity reads 'unavailable' [R11] and every lock service answers 400 [A3]
  slotCap:     30,        // slots the lock has; beyond it get_lock_usercode is a 500 (get_lock_usercode_not_found [R4]) and set/clear a 500 [A2]
  wsDown:      false,     // the websocket refuses to upgrade
  nonAdmin:    false,     // the token is a NON-administrator's: auth/current_user says so and, as Home Assistant does,
                          // subscribe_events for anything outside its allowlist answers unauthorized (Oct 2026 - this
                          // stand-in used to accept every subscription, kinder than the real thing: rule 29)
  // ── the lock with its battery out (Sep 26 2026, measured on the Yale YRL216 through HA 2026.9.3):
  //    the entity keeps its last state (NOT 'unavailable'), a User Code get / set / clear the lock
  //    cannot answer is a 500 "Server got itself in trouble" after ~7 s, and the cached read still
  //    shows the old code ──
  batteryOut:  false,
  batteryOutMs: 0,        // how long the 500 takes (7000 on the real lock; 0 keeps batteries quick)
  noUserCode:  false,     // a lock with no User Code CC (a User Credential lock): get_lock_usercode is a 500
  // ── ONE DEVICE DOWN, THE REST UP (Oct 21 2026; maintainer: "if a device happens to be down or doing an update the other automations
  //    can not fail"): a service call for an entity listed here answers as Home Assistant does when the device does not
  //    answer (500, text) - its state still reads; one listed under hang never answers at all, its state read included ──
  failEntities: [],
  hangEntities: [],
  // ── the credential actions (HA 2026.6+) [R12] ──────────────────────────
  haOld:       false,     // an older Home Assistant: the six credential services answer 400 "Service not found."
  noAccessControl: false, // zwave-js reports no access control for this lock: 500 "Access control is not supported on this device"
  usersLandAfterReads: 0, // get_users omits a user just written for this many reads (the driver's cache catching up)
  pinMin: 4, pinMax: 10,  // what get_credential_capabilities reports for pin_code
  rejectSets: 0,          // set_user answers 500 "already registered" (a duplicate / manufacturer rule) this many times before taking a code
  // ── the Matter lock actions (HA 2026.4+) [M1]-[M3] ───────────────────────
  matterNoUsr: false,     // get_lock_info: supports_user_management false; the mutating actions 400 (UsrFeatureNotSupportedError)
  matterNoPin: false,     // get_lock_info: users yes, but only rfid among the credential types
  matterStatus: '',       // set_lock_credential: the lock's DlStatus ('duplicate' | 'occupied' | 'failure') -> 500 "lock returned status `x`"
  matterStatusCount: 1,   //   ...for this many calls
  matterLandsAfterReads: 0,// get_lock_credential_status reads credential_exists false this many times after a set
  matterNoSlots: false,   // set_lock_credential: 400 "No available credential slots on the lock"
  matterPinMin: 4, matterPinMax: 8,
  matterDead: false,      // the Matter lock entity reads 'unavailable'
};

// ── THE HUB (Oct 19 2026): a Home Assistant that is set up and paired by the unit itself ──────────
//    startHA({ hub: {...} }) adds what services/hasetup.js and services/hadevices.js speak: the first run (onboarding),
//    the sign-in flow and tokens, adding an integration, the device and entity registries, and pairing over Z-Wave,
//    Zigbee and Matter. Every shape is the one Home Assistant 2026.9.4's own source gives (the [S] and [D] tags are the
//    sources listed in services/hasetup.js and services/hadevices.js), and each was put next to the real thing in the
//    workshop lab (tools/ha-lab-walk.js). It refuses as Home Assistant does: a step already done is a 403, a wrong
//    password a form with errors, a radio whose server does not answer "cannot_connect", a duplicate token name an
//    error (rule 29: a stand-in kinder than the real thing is a battery agreeing with its author).
//      hub: { servers: { zwave_js: true, matter: false }   whose radio server answers
//             plan: { zwave: 'plug' | 'plug_late' | 'thermostat' | 'secure' | 'nothing' | 'fail' | 'interview_fail', zigbee: 'bulb' | 'nothing', matter: 'ok' | 'fail' }
//                                                           ('plug_late': the same plug, its interview completed BEFORE the second
//                                                           "device registered" - the real Home Assistant plays both orders)
//             pin: '12345'                                  the PIN on the secure device's label
//             failOnce: { token: 1 }                        /auth/token answers 500 this many times
//             firstFlowMs: { zwave_js: 11500 }              the first time an integration is added, Home Assistant installs its
//                                                           library before it answers (measured in the lab: longer than 10 s)
//             onboarded: false, entries: [], devices: [] }  a Home Assistant that is already set up
//             http: { ... } | null                          its web settings [S9]: by default a first start's trial of the box's own
//                                                           address (127.0.0.1), not yet promoted - as the real 2026.9 starts; a
//                                                           lost trial is { active: 'stable', lost: true }; null is an older Home
//                                                           Assistant without the commands (unknown_command)
function makeHub(state, opts, frame) {
  const crypto = require('crypto');
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  const H = Object.assign({
    done: [], viewsGone: false, users: [], codes: new Map(), tokens: new Map(), flows: new Map(), entries: [], devices: [], entities: [],
    servers: { zwave_js: true, matter: false, zha: false }, plan: { zwave: 'plug', zigbee: 'bulb', matter: 'ok' }, pin: '12345', failOnce: {},
    core: [], calls: [], nextNode: 3, inclusion: null, permit: null, firstFlowMs: {}, installed: new Set(),
  }, opts || {});
  // the web settings [S9], as Home Assistant 2026.9 holds them: stable has no server_host (every address); the configuration
  // file's http: became a pending trial on the first start, with a five-minute revert
  if (H.http !== null) {
    const base = { server_port: 8123, cors_allowed_origins: ['https://cast.home-assistant.io'], login_attempts_threshold: -1, ip_ban_enabled: true, ssl_profile: 'modern', use_x_frame_options: true, created_at: new Date().toISOString(), error: null, error_message: null };
    const o = H.http || {};
    H.http = { stable: Object.assign({}, base), pending: Object.assign({}, base, { server_host: ['127.0.0.1'] }, o.lost ? { error: 'not_promoted' } : {}),
      active: o.active || 'pending', revertAt: o.lost ? null : new Date(Date.now() + 300000).toISOString(), promoted: 0, configured: [] };
  }
  const STEPS = ['user', 'core_config', 'analytics', 'integration'];
  const tokenOk = (t) => !!(t && H.tokens.has(t));
  const host = (u) => { try { const x = new URL(u); return x.protocol + '//' + x.host; } catch { return null; } };
  const code = (username, credential) => { const c = rnd(16); H.codes.set(c, { username, credential }); return c; };
  // a core event to every subscribe_events subscriber that asked for it (the stand-in's own subscriptions list)
  const pushEvent = (eventType, data) => { for (const c of state.wsClients) for (const sub of c.subs) if (!sub.event_type || sub.event_type === eventType) { try { c.socket.write(frame({ id: sub.id, type: 'event', event: { event_type: eventType, data, origin: 'LOCAL', time_fired: new Date().toISOString(), context: { id: rnd(13), parent_id: null, user_id: null } } })); } catch {} } };
  // a new device and its controls, as the registries and the state machine hold them [D4]
  function makeDevice({ domain, entryId, ident, name, maker, model, entityDomain }) {
    const id = rnd(16);
    const dev = { id, name, name_by_user: null, manufacturer: maker, model, identifiers: [[domain, ident]], config_entries: [entryId], area_id: null, entry_type: null, disabled_by: null, via_device_id: null, primary_config_entry: entryId };
    H.devices.push(dev);
    pushEvent('device_registry_updated', { action: 'create', device_id: id });
    // a second device of the same make gets the same name, and its control the next free id (switch.smart_plug_2), as Home Assistant does
    const base = `${entityDomain}.${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    let entity_id = base; for (let n = 2; state.entities.some(e => e.entity_id === entity_id); n++) entity_id = base + '_' + n;
    H.entities.push({ entity_id, device_id: id, platform: domain, name: null, original_name: null, has_entity_name: true, disabled_by: null, hidden_by: null, entity_category: null, id: rnd(16) });
    state.entities.push({ entity_id, state: 'off', attributes: { friendly_name: name } });
    // a diagnostic beside it, as a real device has (never offered as a control)
    H.entities.push({ entity_id: 'sensor.' + entity_id.split('.')[1] + '_node_status', device_id: id, platform: domain, name: null, original_name: 'Node status', has_entity_name: true, disabled_by: null, hidden_by: null, entity_category: 'diagnostic', id: rnd(16) });
    return { dev, entity_id };
  }
  const entry = (domain) => H.entries.find(e => e.domain === domain && e.state === 'loaded');

  async function http(req, parsed, raw, send) {
    const url = req.url.split('?')[0];
    const bearer = (/^Bearer\s+(.*)$/.exec(req.headers.authorization || '') || [])[1];
    let m;
    // [S1][S2] the first run's status, no sign-in
    if (req.method === 'GET' && url === '/api/onboarding') {
      if (H.viewsGone) return send(404, '404: Not Found', 'text/plain'), true;
      return send(200, STEPS.map(step => ({ step, done: H.done.includes(step) }))), true;
    }
    // [S3]
    if (req.method === 'POST' && url === '/api/onboarding/users') {
      if (H.viewsGone) return send(404, '404: Not Found', 'text/plain'), true;
      const b = parsed || {};
      if (!['name', 'username', 'password', 'client_id', 'language'].every(k => typeof b[k] === 'string')) return send(400, { message: 'Message format incorrect: required key not provided' }), true;
      if (H.done.includes('user')) return send(403, { message: 'User step already done' }), true;
      H.users.push({ username: b.username.toLowerCase(), password: b.password, name: b.name, owner: true });
      H.done.push('user');
      return send(200, { auth_code: code(b.username.toLowerCase(), true) }), true;
    }
    // [S5] the token for a code (a form, not JSON)
    if (req.method === 'POST' && url === '/auth/token') {
      if (H.failOnce.token > 0) { H.failOnce.token--; return send(500, '500 Internal Server Error\n\nServer got itself in trouble', 'text/plain'), true; }
      const f = new URLSearchParams(typeof raw === 'string' ? raw : '');
      if (f.get('grant_type') !== 'authorization_code') return send(400, { error: 'unsupported_grant_type' }), true;
      const c = H.codes.get(f.get('code') || '');
      if (!c || !host(f.get('client_id'))) return send(400, { error: 'invalid_request', error_description: 'Invalid code' }), true;
      H.codes.delete(f.get('code'));
      const access = 'acc.' + rnd(24);
      H.tokens.set(access, { username: c.username, credential: c.credential, kind: 'access' });
      return send(200, { access_token: access, token_type: 'Bearer', refresh_token: rnd(32), expires_in: 1800, ha_auth_provider: 'homeassistant' }), true;
    }
    // [S5] the sign-in flow
    if (req.method === 'POST' && url === '/auth/login_flow') {
      const b = parsed || {};
      if (!host(b.client_id)) return send(400, { message: 'Invalid client id' }), true;
      const flow_id = rnd(16); H.flows.set(flow_id, { kind: 'login', redirect_uri: b.redirect_uri, client_id: b.client_id });
      return send(200, { type: 'form', flow_id, handler: ['homeassistant', null], step_id: 'init', data_schema: [{ type: 'string', name: 'username', required: true }, { type: 'string', name: 'password', required: true }], errors: {}, description_placeholders: null, last_step: null, preview: null }), true;
    }
    if (req.method === 'POST' && (m = /^\/auth\/login_flow\/([0-9a-f]+)$/.exec(url))) {
      const fl = H.flows.get(m[1]); const b = parsed || {};
      if (!fl || fl.kind !== 'login') return send(404, { message: 'Invalid flow specified' }), true;
      const u = H.users.find(x => x.username === String(b.username || '').toLowerCase() && x.password === b.password);
      if (!u) return send(200, { type: 'form', flow_id: m[1], handler: ['homeassistant', null], step_id: 'init', data_schema: [], errors: { base: 'invalid_auth' } }), true;
      if (host(fl.redirect_uri) !== host(b.client_id)) return send(400, { message: 'Invalid redirect URI' }), true;
      H.flows.delete(m[1]);
      return send(200, { version: 1, type: 'create_entry', flow_id: m[1], handler: ['homeassistant', null], result: code(u.username, true), description: null, description_placeholders: null, context: {}, title: '', minor_version: 1 }), true;
    }
    // from here on, the hub's own routes need its token
    const isHub = /^\/api\/onboarding\/(core_config|analytics|integration)$/.test(url) || url.startsWith('/api/config/config_entries/flow');
    if (!isHub) return false;
    const tok = H.tokens.get(bearer || '');
    if (!tok) return send(401, '401: Unauthorized', 'text/plain'), true;
    // [S4]
    if (req.method === 'POST' && (m = /^\/api\/onboarding\/(core_config|analytics|integration)$/.exec(url))) {
      if (H.viewsGone) return send(404, '404: Not Found', 'text/plain'), true;
      const step = m[1];
      if (H.done.includes(step)) return send(403, { message: { core_config: 'Core config step already done', analytics: 'Analytics config step already done', integration: 'Integration step already done' }[step] }), true;
      if (step === 'integration') {
        if (!tok.credential) return send(403, { message: 'Credentials for user not available' }), true;
        H.done.push(step);
        const b = parsed || {};
        if (!host(b.client_id) || host(b.client_id) !== host(b.redirect_uri)) return send(400, { message: 'invalid client id or redirect uri' }), true;
        return send(200, { auth_code: code(tok.username, true) }), true;
      }
      H.done.push(step);
      return send(200, {}), true;
    }
    // [S8] adding an integration
    if (req.method === 'POST' && url === '/api/config/config_entries/flow') {
      const b = parsed || {};
      if (!['zwave_js', 'matter', 'zha'].includes(b.handler)) return send(404, { message: 'Invalid handler specified' }), true;
      if (!H.installed.has(b.handler)) { H.installed.add(b.handler); if (H.firstFlowMs[b.handler]) await new Promise(r => setTimeout(r, H.firstFlowMs[b.handler])); }
      if (b.handler === 'matter' && H.entries.some(e => e.domain === 'matter')) return send(200, { type: 'abort', flow_id: rnd(16), handler: 'matter', reason: 'single_instance_allowed', description_placeholders: null }), true;
      const flow_id = rnd(16); H.flows.set(flow_id, { kind: 'entry', handler: b.handler });
      return send(200, { type: 'form', flow_id, handler: b.handler, step_id: 'manual', data_schema: [{ type: 'string', name: 'url', required: true, default: b.handler === 'matter' ? 'ws://localhost:5580/ws' : 'ws://localhost:3000' }], errors: null, description_placeholders: {}, last_step: null, preview: null }), true;
    }
    if ((m = /^\/api\/config\/config_entries\/flow\/([0-9a-f]+)$/.exec(url))) {
      const fl = H.flows.get(m[1]);
      if (req.method === 'DELETE') { H.flows.delete(m[1]); return send(200, { message: 'Flow aborted' }), true; }
      if (!fl || fl.kind !== 'entry') return send(404, { message: 'Invalid flow specified' }), true;
      const b = parsed || {};
      if (!/^wss?:\/\//.test(String(b.url || ''))) return send(400, { message: 'User input malformed' }), true;
      if (!H.servers[fl.handler]) return send(200, { type: 'form', flow_id: m[1], handler: fl.handler, step_id: 'manual', data_schema: [], errors: { base: 'cannot_connect' }, description_placeholders: {} }), true;
      H.flows.delete(m[1]);
      if (H.entries.some(e => e.domain === fl.handler)) return send(200, { type: 'abort', flow_id: m[1], handler: fl.handler, reason: 'already_configured', description_placeholders: null }), true;
      const e = { entry_id: rnd(13), domain: fl.handler, title: fl.handler === 'matter' ? 'Matter' : 'Z-Wave JS', source: 'user', state: 'loaded', supports_options: true, disabled_by: null, reason: null, url: b.url };
      H.entries.push(e);
      return send(200, { type: 'create_entry', flow_id: m[1], handler: fl.handler, title: e.title, version: 1, minor_version: 1, result: e, description: null, description_placeholders: null, context: { source: 'user' } }), true;
    }
    return send(404, { message: 'Not found' }), true;
  }

  // the websocket's hub commands; answers true when it took the message
  function onWs(client, msg, sendJ) {
    const ok = (result) => sendJ({ id: msg.id, type: 'result', success: true, result: result === undefined ? null : result });
    const err = (code, message) => sendJ({ id: msg.id, type: 'result', success: false, error: { code, message } });
    const ev = (event) => sendJ({ id: msg.id, type: 'event', event });
    const t = msg.type;
    H.calls.push(msg);
    // THE FIELDS - each pairing and naming command's fields checked as Home Assistant 2026.9.4's own schemas check them (components/zwave_js/api.py,
    // its websocket_command decorators; the names are its constants: SECURITY_CLASSES = "securityClasses", CLIENT_SIDE_AUTH =
    // "clientSideAuth" - camel case, unlike the rest). A field it does not know, or one it needs and was not given, is refused with
    // invalid_format as the real one refuses it (Oct 25 2026: the lab's S2 pair walk, "not a valid option, did you mean
    // 'securityClasses'? at 'security_classes'" - this stand-in had taken any field, so the suite agreed with the product's mistake)
    const ZW_SCHEMA = {
      'zwave_js/add_node': { need: ['entry_id'], may: ['inclusion_strategy', 'force_security', 'planned_provisioning_entry', 'qr_provisioning_information', 'qr_code_string', 'dsk'] },
      'zwave_js/grant_security_classes': { need: ['entry_id', 'securityClasses'], may: ['clientSideAuth'] },
      'zwave_js/validate_dsk_and_enter_pin': { need: ['entry_id', 'pin'], may: [] },
      'zwave_js/stop_inclusion': { need: ['entry_id'], may: [] },
      // and the other pairing and naming commands the unit sends, the same way: zha/websocket_api.py SERVICE_PERMIT_PARAMS,
      // matter/api.py, config/device_registry.py
      'zha/devices/permit': { need: [], may: ['ieee', 'duration', 'source_ieee', 'install_code', 'qr_code'] },
      'matter/commission': { need: ['code'], may: ['network_only'] },
      'config/device_registry/update': { need: ['device_id'], may: ['area_id', 'disabled_by', 'labels', 'name_by_user'] },
    };
    if (ZW_SCHEMA[t]) {
      const sc = ZW_SCHEMA[t], keys = Object.keys(msg).filter(k => k !== 'id' && k !== 'type');
      const extra = keys.filter(k => !sc.need.includes(k) && !sc.may.includes(k)), missing = sc.need.filter(k => !(k in msg));
      if (extra.length || missing.length) return err('invalid_format', extra.map(k => `not a valid option at '${k}'`).concat(missing.map(k => `required key not provided at '${k}'`)).join('\n')), true;
      if (t === 'zwave_js/grant_security_classes' && (!Array.isArray(msg.securityClasses) || !msg.securityClasses.length)) return err('invalid_format', "length of value must be at least 1 at 'securityClasses'"), true;
    }
    if (t === 'auth/long_lived_access_token') {
      const who = H.tokens.get(client.token);
      if (!who) return err('unauthorized', 'Unauthorized'), true;
      const name = String(msg.client_name || '');
      if (H.tokens.has('llat-name:' + who.username + ':' + name)) return err('unknown_error', `${name} already exists`), true;
      const tok = 'eyJ' + rnd(60);
      H.tokens.set(tok, { username: who.username, credential: false, kind: 'llat', name });
      H.tokens.set('llat-name:' + who.username + ':' + name, { marker: true });
      return ok(tok), true;
    }
    if (t === 'config/core/update') { H.core.push(Object.assign({}, msg)); return ok(), true; }
    // the web settings [S9] - admin only; an older Home Assistant has none of the three
    if (/^http\/config(?:\/promote|\/configure)?$/.test(t)) {
      if (!H.http) return err('unknown_command', 'Unknown command.'), true;
      const W = H.http;
      if (t === 'http/config') return ok({ stable: W.stable, pending: W.pending, revert_at: W.revertAt, active_config_type: W.active, default: Object.assign({}, W.stable, { server_host: undefined }) }), true;
      if (t === 'http/config/promote') {
        if (!W.pending) return err('not_allowed', 'No pending HTTP config to promote'), true;
        if (W.pending.error) return err('not_allowed', `Cannot promote pending HTTP config with error: ${W.pending.error}`), true;
        W.stable = Object.assign({}, W.pending, { created_at: new Date().toISOString() }); W.pending = null; W.revertAt = null; W.active = 'stable'; W.promoted++;
        return ok(), true;
      }
      const c = msg.config;
      if (c && (Object.keys(c).some(k => !['server_host', 'server_port', 'ssl_certificate', 'ssl_peer_certificate', 'ssl_key', 'cors_allowed_origins', 'use_x_forwarded_for', 'trusted_proxies', 'login_attempts_threshold', 'ip_ban_enabled', 'ssl_profile', 'use_x_frame_options'].includes(k)))) return err('invalid_format', 'extra keys not allowed'), true;
      W.configured.push(c);
      // stored as the new trial, and Home Assistant restarts into it
      W.pending = c ? Object.assign({}, c, { created_at: new Date().toISOString(), error: null, error_message: null }) : null; W.active = c ? 'pending' : 'stable'; W.revertAt = c ? new Date(Date.now() + 300000).toISOString() : null;
      return ok({ restart: true }), true;
    }
    if (t === 'config_entries/get') return ok(H.entries.filter(e => !msg.domain || e.domain === msg.domain).map(e => ({ entry_id: e.entry_id, domain: e.domain, title: e.title, source: e.source, state: e.state, supports_options: true, disabled_by: null, reason: null }))), true;
    if (t === 'config/device_registry/list') return ok(H.devices.map(d => Object.assign({}, d))), true;
    if (t === 'config/entity_registry/list') return ok(H.entities.map(e => Object.assign({}, e))), true;
    if (t === 'get_states') return ok(state.entities.map(e => Object.assign({}, e, { attributes: Object.assign({}, e.attributes) }))), true;
    if (t === 'config/device_registry/update') {
      const d = H.devices.find(x => x.id === msg.device_id);
      if (!d) return err('not_found', 'Device not found'), true;
      if ('name_by_user' in msg) {
        d.name_by_user = msg.name_by_user;
        // an entity named after its device takes the device's new name
        for (const e of H.entities.filter(x => x.device_id === d.id && x.has_entity_name && !x.name && !x.original_name)) { const s = state.entities.find(x => x.entity_id === e.entity_id); if (s) s.attributes.friendly_name = d.name_by_user || d.name; }
      }
      pushEvent('device_registry_updated', { action: 'update', device_id: d.id, changes: { name_by_user: null } });
      return ok(Object.assign({}, d)), true;
    }
    if (t === 'unsubscribe_events') {
      // [W1] any subscription: the hub's own (add_node, permit) or a subscribe_events
      if (client.hubSubs.has(msg.subscription)) { const kind = client.hubSubs.get(msg.subscription); client.hubSubs.delete(msg.subscription); if (kind === 'permit' && H.permit) clearTimeout(H.permit.timer); return ok(), true; }
      const i = client.subs.findIndex(s => s.id === msg.subscription);
      if (i < 0) return err('not_found', 'Subscription not found.'), true;
      client.subs.splice(i, 1);
      return ok(), true;
    }
    // [D1] Z-Wave
    if (t === 'zwave_js/add_node') {
      const e = H.entries.find(x => x.entry_id === msg.entry_id);
      if (!e) return err('not_found', 'Config entry not found'), true;
      if (H.inclusion) { ok(true); return true; }
      client.hubSubs.set(msg.id, 'add_node');
      const inc = H.inclusion = { client, id: msg.id, entryId: e.entry_id, plan: H.plan.zwave, nodeId: H.nextNode++, step: null };
      H.addNodeEvents = [];   // what this pairing sent, in order (a battery reads which order it played)
      ev({ event: 'inclusion started' });
      ok(true);
      // (every event the hub plays is noted, delivered or not: a subscriber that has already gone misses it, as on the real one)
      const send = (o) => { H.addNodeEvents.push(o.event); if (client.hubSubs.get(inc.id) === 'add_node') client.sendJ({ id: inc.id, type: 'event', event: o }); };
      inc.send = send;
      const later = (ms, fn) => setTimeout(() => { if (H.inclusion === inc) fn(); }, ms);
      // THE REAL ORDER (the lab walk, Home Assistant 2026.9.4 on zwave-js 15.31.0): the device is registered twice - as
      // "Node <n>" when it is added, again with its maker and model once the interview knows them - with interview
      // progress between, and the completion last
      // (Oct 27 2026: the real one plays the last two either way round - the week's lab rounds saw the completion before the
      // second registration at 15:04 and after it at 19:11 - so plan 'plug_late' plays the completion first)
      const join = (lowSecurity, reason) => {
        send({ event: 'node added', node: { node_id: inc.nodeId, status: 4, ready: false, low_security: lowSecurity, low_security_reason: reason } });   // 4 = alive, as the real one reads
        later(20, () => {
          send({ event: 'interview started' });
          send({ event: 'interview progress', stage: 'ProtocolInfo', progress: 10 });
          // (Oct 21 2026) plan 'thermostat': a Z-Wave thermostat - one climate control in cool mode, its range and setpoints as
          // Home Assistant shows them (the facility's heat and AC)
          const thermo = inc.plan === 'thermostat';
          const { dev, entity_id } = makeDevice(thermo ? { domain: 'zwave_js', entryId: inc.entryId, ident: '3245146787-' + inc.nodeId, name: 'Thermostat', maker: 'Honeywell', model: 'TH6320ZW', entityDomain: 'climate' }
            : { domain: 'zwave_js', entryId: inc.entryId, ident: '3245146787-' + inc.nodeId, name: 'Smart Plug', maker: 'Zooz', model: 'ZEN04', entityDomain: 'switch' });
          if (thermo) { const st = state.entities.find(x => x.entity_id === entity_id); st.state = 'cool'; Object.assign(st.attributes, { hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], min_temp: 45, max_temp: 95, current_temperature: 76, temperature: 75, target_temp_low: null, target_temp_high: null }); }
          inc.entity = entity_id;
          send({ event: 'device registered', device: { name: 'Node ' + inc.nodeId, id: dev.id, manufacturer: null, model: null } });
          send({ event: 'interview stage completed', stage: 'ProtocolInfo' });
          send({ event: 'interview progress', stage: 'NodeInfo', progress: 60 });
          send({ event: 'interview stage completed', stage: 'CommandClasses' });
          later(30, () => {
            const reg2 = () => send({ event: 'device registered', device: { name: dev.name, id: dev.id, manufacturer: dev.manufacturer, model: dev.model } });
            if (inc.plan === 'plug_late') { send({ event: 'interview completed' }); H.inclusion = null; setTimeout(reg2, 20); return; }
            reg2();
            send({ event: inc.plan === 'interview_fail' ? 'interview failed' : 'interview completed' }); H.inclusion = null;
          });
        });
      };
      inc.join = join;
      if (inc.plan === 'nothing') return true;
      later(30, () => {
        // the controller leaves pairing mode as it finds the device: "inclusion stopped" comes FIRST (the lab walk)
        send({ event: 'inclusion stopped' });
        send({ event: 'node found', node: { node_id: inc.nodeId } });
        if (inc.plan === 'fail') return later(20, () => { send({ event: 'inclusion failed' }); H.inclusion = null; });
        // 'secure_silent' (Oct 25 2026): the same, but after the right PIN the device never answers again
        if (inc.plan === 'secure' || inc.plan === 'secure_silent') return later(20, () => { inc.step = 'grant'; send({ event: 'grant security classes', requested_grant: { securityClasses: [1, 0], clientSideAuth: false } }); });
        later(20, () => join(false, null));
      });
      return true;
    }
    if (t === 'zwave_js/grant_security_classes') {
      const inc = H.inclusion;
      ok();
      if (inc && inc.step === 'grant') { inc.granted = msg.securityClasses; inc.step = 'pin'; setTimeout(() => inc.send({ event: 'validate dsk and enter pin', dsk: '-41523-18530-43620-12034-58210-01234-56789' }), 20); }
      return true;
    }
    if (t === 'zwave_js/validate_dsk_and_enter_pin') {
      const inc = H.inclusion;
      ok();
      // a wrong PIN, as zwave-js 15 does it (Oct 25 2026, the lab's S2 pair walk): the device is ON the network, added with low
      // security and reason 6 (SecurityBootstrapFailure.S2IncorrectPIN - an integer, as Home Assistant forwards it), and is never
      // interviewed (lib/node/Node.js: "has failed S2 bootstrapping and cannot be interviewed") - no device, no control. Until today
      // this stand-in joined it and interviewed it as a working plug, kinder than the real thing.
      if (inc && inc.step === 'pin') { inc.step = null; const right = msg.pin === H.pin;
        setTimeout(() => { if (right && inc.plan === 'secure_silent') return; if (right) return inc.join(false, null); inc.send({ event: 'node added', node: { node_id: inc.nodeId, status: 4, ready: false, low_security: true, low_security_reason: 6 } }); H.inclusion = null; }, 20); }
      return true;
    }
    if (t === 'zwave_js/stop_inclusion') {
      const inc = H.inclusion;
      ok(!!inc);
      if (inc) { H.inclusion = null; if (inc.client.hubSubs.get(inc.id) === 'add_node') inc.client.sendJ({ id: inc.id, type: 'event', event: { event: 'inclusion stopped' } }); }
      return true;
    }
    // [D2] Zigbee
    if (t === 'zha/devices/permit') {
      const e = entry('zha');
      if (!e) return err('unknown_error', 'ZHA is not set up'), true;
      client.hubSubs.set(msg.id, 'permit');
      ok();
      const duration = msg.duration == null ? 60 : msg.duration;
      if (!duration || H.plan.zigbee !== 'bulb') return true;
      const send = (o) => { if (client.hubSubs.get(msg.id) === 'permit') client.sendJ({ id: msg.id, type: 'event', event: o }); };
      const ieee = '00:17:88:01:0b:' + rnd(3).match(/../g).join(':');
      H.permit = { timer: setTimeout(() => {
        send({ type: 'log_output', log_entry: { message: 'Device 0x1a2b joined', level: 20, name: 'zigpy' } });
        send({ type: 'device_joined', device_info: { nwk: 6699, ieee, pairing_status: 'PAIRED' } });
        send({ type: 'raw_device_initialized', device_info: { nwk: '0x1a2b', ieee, pairing_status: 'INTERVIEW_COMPLETE', model: 'LCA001', manufacturer: 'Signify Netherlands B.V.', signature: { node_descriptor: {}, endpoints: {} } } });
        const { dev } = makeDevice({ domain: 'zha', entryId: e.entry_id, ident: ieee, name: 'Signify Netherlands B.V. LCA001', maker: 'Signify Netherlands B.V.', model: 'LCA001', entityDomain: 'light' });
        send({ type: 'device_fully_initialized', device_info: { ieee, nwk: '0x1a2b', manufacturer: dev.manufacturer, model: dev.model, name: dev.name, quirk_applied: false, entities: [], user_given_name: null, device_reg_id: dev.id, area_id: null, pairing_status: 'INITIALIZED' } });
      }, 40) };
      return true;
    }
    // [D3] Matter
    if (t === 'matter/commission') {
      const e = entry('matter');
      if (!e) return err('not_loaded', 'Matter is not loaded'), true;
      setTimeout(() => {
        if (H.plan.matter === 'fail') return err('1', 'Commission with code failed for node 2.');
        makeDevice({ domain: 'matter', entryId: e.entry_id, ident: 'deviceid_' + rnd(8), name: 'Smart Plug Mini', maker: 'Eve Systems', model: 'Eve Energy', entityDomain: 'switch' });
        ok();
      }, 60);
      return true;
    }
    return false;
  }
  return { H, http, onWs, tokenOk, restart: () => { if (STEPS.every(s => H.done.includes(s))) H.viewsGone = true; } };
}

function startHA(opts = {}) {
  const port = opts.port || 18123;
  const faults = Object.assign({}, DEFAULT_FAULTS, opts.faults || {});
  const state = {
    requests: [],
    entities: opts.entities || [
      { entity_id: 'switch.bay1_power', state: 'off', attributes: { friendly_name: 'Bay 1 Power' } },
      { entity_id: 'light.bay1',        state: 'off', attributes: { friendly_name: 'Bay 1 Light' } },
      { entity_id: 'lock.front_door',   state: 'locked', attributes: { friendly_name: 'Front Door' } },
      { entity_id: 'lock.aqara_u300',   state: 'locked', attributes: { friendly_name: 'Aqara U300', changed_by: null } },
      { entity_id: 'climate.bay1',      state: 'heat', attributes: { friendly_name: 'Bay 1 Climate', temperature: 20 } },
      // a Z-Wave thermostat as Home Assistant shows one: its modes, its range, one setpoint in heat or cool and two in heat_cool
      { entity_id: 'climate.room',      state: 'heat', attributes: { friendly_name: 'Room Thermostat', hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], min_temp: 45, max_temp: 95, current_temperature: 66, temperature: 66, target_temp_low: null, target_temp_high: null } },
      { entity_id: 'cover.bay1_blind',  state: 'closed', attributes: { friendly_name: 'Bay 1 Blind' } },
      { entity_id: 'sensor.outside',    state: '12', attributes: { friendly_name: 'Outside' } },
    ],
    calls: [],   // every service call: { domain, service, entity_id }
    lock: { entityId: 'lock.front_door', slots: {} },   // slot -> { code, readsLeft }
    matter: { entityId: 'lock.aqara_u300', credentials: {}, users: {}, nextUser: 1 },   // index -> { code, user }
    wsClients: [],
  };

  let hub = null;   // the hub, made once the websocket framing below exists
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      let parsed = null; try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
      state.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: parsed });
      if (faults.slowMs) await new Promise(r => setTimeout(r, faults.slowMs));
      const send = (s, o, t) => { res.writeHead(s, { 'Content-Type': t || 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
      if (faults.htmlBody) return send(200, '<!doctype html><html><body>Sign in</body></html>', 'text/html');
      if (faults.down) return send(502, { message: 'bad gateway' });
      if (hub && await hub.http(req, parsed, body, send)) return;
      const bearer = /^Bearer\s+(.*)$/.exec(req.headers.authorization || '');
      if (faults.rejectToken || !bearer || (bearer[1] !== faults.token && !(hub && hub.tokenOk(bearer[1])))) return send(401, { message: 'Unauthorized' });

      if (req.method === 'GET' && /^\/api\/?$/.test(req.url)) return send(200, { message: 'API running.' });
      if (req.method === 'GET' && /^\/api\/states$/.test(req.url)) {
        if (faults.statesShape === 'empty') return send(200, []);
        if (faults.statesShape === 'notarray') return send(200, { message: 'not a list' });
        return send(200, state.entities);
      }
      let m;
      if (req.method === 'GET' && (m = /^\/api\/states\/(.+)$/.exec(req.url))) {
        if ((faults.hangEntities || []).includes(decodeURIComponent(m[1]))) return;   // never answered - the caller's own timeout ends it
        const e = state.entities.find(x => x.entity_id === decodeURIComponent(m[1]));
        if (e && e.entity_id === state.lock.entityId && faults.lockDead) return send(200, Object.assign({}, e, { state: 'unavailable' }));
        if (e && e.entity_id === state.matter.entityId && faults.matterDead) return send(200, Object.assign({}, e, { state: 'unavailable' }));
        return e ? send(200, e) : send(404, { message: 'Entity not found.' });
      }
      // ── the Matter lock actions (HA 2026.4) [M1]-[M3], graded the way HA's api view does ──
      if (req.method === 'POST' && (m = /^\/api\/services\/matter\/([^/?]+)(\?return_response)?$/.exec(req.url))) {
        const service = m[1], wantResp = !!m[2];
        const b = parsed || {};
        state.calls.push({ domain: 'matter', service, entity_id: b.entity_id, data: b, returnResponse: wantResp });
        const SUPPORTS = { get_lock_info: 'only', get_lock_users: 'only', set_lock_credential: 'only', get_lock_credential_status: 'only', set_lock_user: 'none', clear_lock_user: 'none', clear_lock_credential: 'none' };
        if (!(service in SUPPORTS) || faults.haOld) return send(400, { message: 'Service not found.' });
        if (wantResp && SUPPORTS[service] === 'none') return send(400, { message: 'Service does not support responses. Remove return_response from request.' });
        if (!wantResp && SUPPORTS[service] === 'only') return send(400, { message: 'Service call requires responses but caller did not ask for responses. Add ?return_response to query parameters.' });
        const taken = () => send(200, []);
        const answer = (resp) => send(200, { changed_states: [], service_response: resp });
        // an entity that is not this Matter lock: HA's entity-service call filters to its own integration's entities [MA2] - the answer carries nothing for it
        if (b.entity_id !== state.matter.entityId) return SUPPORTS[service] === 'only' ? answer({}) : taken();
        if (faults.matterDead) return send(400, { message: 'Referenced entities ' + b.entity_id + ' are missing or not currently available' });
        const M = state.matter;
        const usr = !faults.matterNoUsr;
        const types = faults.matterNoPin ? ['rfid'] : ['pin', 'rfid'];
        if (service === 'get_lock_info') return answer({ [b.entity_id]: { supports_user_management: usr, supported_credential_types: usr ? types : [], max_users: usr ? 50 : null, max_pin_users: usr && !faults.matterNoPin ? 50 : null, max_rfid_users: usr ? 50 : null, max_credentials_per_user: usr ? 5 : null, min_pin_length: usr ? faults.matterPinMin : null, max_pin_length: usr ? faults.matterPinMax : null, min_rfid_length: usr ? 8 : null, max_rfid_length: usr ? 20 : null } });
        if (!usr) return send(400, { message: "This lock doesn't support user management (USR feature)" });
        if (service === 'get_lock_users') return answer({ [b.entity_id]: { max_users: 50, users: Object.keys(M.users).map(Number).map(u => ({ user_index: u, user_name: M.users[u].name || null, user_unique_id: null, user_status: 'occupied_enabled', user_type: 'unrestricted', credential_rule: 'single', credentials: Object.keys(M.credentials).filter(k => M.credentials[k].user === u).map(k => ({ type: 'pin', index: Number(k) })), creator_fabric_index: 1, last_modified_fabric_index: 1, next_user_index: null })) } });
        if (service === 'set_lock_credential') {
          if (b.credential_type !== 'pin') return send(400, { message: 'The lock does not support credential type `' + b.credential_type + '`.' });
          const data = String(b.credential_data || '');
          if (!/^\d+$/.test(data)) return send(400, { message: 'Invalid credential data: PIN must contain only digits.' });
          if (data.length < faults.matterPinMin || data.length > faults.matterPinMax) return send(400, { message: `Invalid credential data: PIN must be between ${faults.matterPinMin} and ${faults.matterPinMax} digits.` });
          if (faults.matterNoSlots) return send(400, { message: 'No available credential slots on the lock' });
          let idx = b.credential_index !== undefined ? Number(b.credential_index) : null;
          if (idx === null) { for (let k = 1; k <= 50; k++) if (!M.credentials[k]) { idx = k; break; } if (idx === null) return send(400, { message: 'No available credential slots on the lock' }); }
          if (faults.matterStatus && faults.matterStatusCount > 0) { faults.matterStatusCount--; return send(500, { message: 'Failed to set credential: lock returned status `' + faults.matterStatus + '`.' }); }
          if (Object.keys(M.credentials).some(k => Number(k) !== idx && M.credentials[k].code === data)) return send(500, { message: 'Failed to set credential: lock returned status `duplicate`.' });
          const existing = M.credentials[idx];   // an explicit index that exists is a MODIFY [M3]
          const user = existing ? existing.user : (b.user_index !== undefined ? Number(b.user_index) : M.nextUser++);
          if (!M.users[user]) M.users[user] = { name: null };
          M.credentials[idx] = { code: data, user, readsLeft: Number(faults.matterLandsAfterReads) || 0 };
          return answer({ [b.entity_id]: { credential_index: idx, user_index: user, next_credential_index: null } });
        }
        if (service === 'get_lock_credential_status') {
          const idx = Number(b.credential_index), cr = M.credentials[idx];
          if (cr && cr.readsLeft > 0) { cr.readsLeft--; return answer({ [b.entity_id]: { credential_exists: false, user_index: null, creator_fabric_index: null, last_modified_fabric_index: null, next_credential_index: null } }); }
          return answer({ [b.entity_id]: { credential_exists: !!cr, user_index: cr ? cr.user : null, creator_fabric_index: cr ? 1 : null, last_modified_fabric_index: cr ? 1 : null, next_credential_index: null } });
        }
        if (service === 'clear_lock_credential') { delete M.credentials[Number(b.credential_index)]; return taken(); }
        if (service === 'clear_lock_user') { const u = Number(b.user_index); if (u === 0xFFFE) { M.credentials = {}; M.users = {}; return taken(); } for (const k of Object.keys(M.credentials)) if (M.credentials[k].user === u) delete M.credentials[k]; delete M.users[u]; return taken(); }
        if (service === 'set_lock_user') { const u = b.user_index !== undefined ? Number(b.user_index) : M.nextUser++; M.users[u] = { name: b.user_name || null }; return taken(); }
      }
      // ── zwave_js lock services, graded and answered the way HA's own source does ──
      if (req.method === 'POST' && (m = /^\/api\/services\/zwave_js\/([^/?]+)(\?return_response)?$/.exec(req.url))) {
        const service = m[1], wantResp = !!m[2];
        const b = parsed || {};
        state.calls.push({ domain: 'zwave_js', service, entity_id: b.entity_id, data: b, returnResponse: wantResp });
        // [R2] APIDomainServicesView.post: an unknown service is a 400; return_response on a
        // NONE service is a 400; a SupportsResponse.ONLY service without it is a 400. [R3] says
        // which is which for the four lock services.
        const SUPPORTS = { get_lock_usercode: 'only', set_lock_usercode: 'none', clear_lock_usercode: 'none', invoke_cc_api: 'none',
          get_credential_capabilities: 'only', get_users: 'only', set_user: 'only', set_credential: 'only', delete_user: 'none', delete_credential: 'none', delete_all_users: 'none', delete_all_credentials: 'none' };
        const CRED = new Set(['get_credential_capabilities', 'get_users', 'set_user', 'set_credential', 'delete_user', 'delete_credential', 'delete_all_users', 'delete_all_credentials']);
        if (!(service in SUPPORTS) || (faults.haOld && CRED.has(service))) return send(400, { message: 'Service not found.' });
        if (wantResp && SUPPORTS[service] === 'none') return send(400, { message: 'Service does not support responses. Remove return_response from request.' });
        if (!wantResp && SUPPORTS[service] === 'only') return send(400, { message: 'Service call requires responses but caller did not ask for responses. Add ?return_response to query parameters.' });
        // [R2] with no return_response the reply is the changed_states list; with it, the two-key object
        const taken = () => send(200, []);
        const answer = (resp) => send(200, { changed_states: [], service_response: resp });
        // [A3] an entity that is not this lock, or a lock that is unavailable
        if (b.entity_id !== state.lock.entityId || faults.lockDead) return send(400, { message: 'Referenced entities ' + b.entity_id + ' are missing or not currently available' });
        const slot = Number(b.code_slot);
        const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= faults.slotCap;
        if (faults.batteryOut && (service === 'set_lock_usercode' || service === 'clear_lock_usercode' || service === 'invoke_cc_api')) {
          if (faults.batteryOutMs) await new Promise(r => setTimeout(r, faults.batteryOutMs));
          return send(500, '500 Internal Server Error\n\nServer got itself in trouble', 'text/plain');
        }
        if (faults.noUserCode && service === 'get_lock_usercode') return send(500, { message: 'get_lock_usercode_not_found' });
        if (service === 'set_lock_usercode') {
          if (b.code_slot === undefined || !Number.isInteger(slot)) return send(400, { message: "expected int for dictionary value @ data['code_slot']" });   // vol.Invalid -> 400 [R2][R3]
          if (b.usercode === undefined || b.usercode === null) return send(400, { message: "required key not provided @ data['usercode']" });
          if (faults.setRefused) return send(400, { message: 'set_lock_usercode: refused' });
          if (faults.setError) return send(500, { message: 'Error during service call to zwave_js.set_lock_usercode' });
          if (!inRange(slot)) return send(500, { message: 'userCode for code slot ' + slot + ' not found' });   // [A2]
          if (!faults.setDropped) state.lock.slots[slot] = { code: String(b.usercode), reportsLeft: Number(faults.landsAfterReads) || 0 };
          return taken();
        }
        if (service === 'clear_lock_usercode') {
          if (!Number.isInteger(slot)) return send(400, { message: "expected int for dictionary value @ data['code_slot']" });
          if (!inRange(slot)) return send(500, { message: 'userIdStatus for code slot ' + slot + ' not found' });   // [A2]
          delete state.lock.slots[slot];
          return taken();
        }
        if (service === 'invoke_cc_api') {
          // [R3] the handler returns None whatever the CC answered; a User Code get asks the
          // device, and the cache fills when the device reports [R6]
          if (b.command_class === undefined || b.method_name === undefined || !Array.isArray(b.parameters)) return send(400, { message: 'required key not provided (command_class, method_name, parameters)' });
          if (Number(b.command_class) !== 99) return send(400, { message: 'only User Code CC (99) is modelled by this stand-in' });
          if (b.method_name === 'get') return taken();   // the ask itself; what the device reports shows up in the next read below
          return send(400, { message: 'unmodelled method ' + b.method_name });
        }
        // ── the credential actions [R12]: zwave-js's AccessControl over this User Code lock,
        //    where user_id IS the code slot and the credential shares it ──
        if (CRED.has(service)) {
          if (faults.noAccessControl) return send(500, { message: 'Access control is not supported on this device' });
          const usersOf = () => Object.keys(state.lock.slots).map(Number).sort((a, b) => a - b).filter(k => !(state.lock.slots[k].usersLeft > 0)).map(k => ({ user_id: k, user_name: state.lock.slots[k].name || null, active: true, user_type: 'general', credential_rule: 'single', credentials: [{ type: 'pin_code', slot: k }] }));
          if (service === 'get_credential_capabilities') return answer({ [b.entity_id]: { supports_user_management: true, max_users: faults.slotCap, supported_user_types: ['general', 'disposable'], max_user_name_length: 10, supported_credential_rules: ['single'],
            supported_credential_types: { pin_code: { num_slots: faults.slotCap, min_length: faults.pinMin, max_length: faults.pinMax, supports_learn: false } } } });
          if (service === 'get_users') { const list = usersOf(); for (const k of Object.keys(state.lock.slots)) { const sl = state.lock.slots[k]; if (sl.usersLeft > 0) sl.usersLeft--; } return answer({ [b.entity_id]: { max_users: faults.slotCap, users: list } }); }
          if (service === 'set_user') {
            const data = b.credential_data, type = b.credential_type;
            if ((type === undefined) !== (data === undefined)) return send(400, { message: 'credential_type and credential_data must be given together' });   // vol.Inclusive
            if (type !== undefined && type !== 'pin_code' && type !== 'password') return send(400, { message: "value must be one of ['password', 'pin_code'] for dictionary value @ data['credential_type']" });
            let uid = b.user_id !== undefined ? Number(b.user_id) : null;
            if (uid !== null && !(Number.isInteger(uid) && uid >= 1 && uid <= 65535)) return send(400, { message: "value must be at least 1 for dictionary value @ data['user_id']" });
            if (data !== undefined) {
              if (type === 'pin_code' && !/^\d+$/.test(String(data))) return send(400, { message: 'PIN code must contain only digits.' });
              if (String(data).length < faults.pinMin || String(data).length > faults.pinMax) return send(400, { message: `Credential of type ${type} must be between ${faults.pinMin} and ${faults.pinMax} characters long.` });
            } else if (uid === null || !state.lock.slots[uid]) return send(400, { message: 'This device requires a credential when adding a user.' });   // User Code CC: no user without its code
            if (uid === null) { for (let k = 1; k <= faults.slotCap; k++) if (!state.lock.slots[k]) { uid = k; break; } if (uid === null) return send(400, { message: 'No available user slots on this device' }); }
            else if (!(uid >= 1 && uid <= faults.slotCap)) return send(400, { message: 'No available user slots on this device' });
            if (data !== undefined) {
              if (faults.rejectSets > 0) { faults.rejectSets--; return send(500, { message: 'This credential is already registered on the device.' }); }
              if (Object.keys(state.lock.slots).some(k => Number(k) !== uid && state.lock.slots[k].code === String(data))) return send(500, { message: 'This credential is already registered on the device.' });
              if (state.lock.slots[uid] && b.user_id !== undefined && !state.lock.slots[uid].modifiable) return send(500, { message: 'Cannot add user: the target slot is already in use.' });
              if (faults.setDropped) return answer({ [b.entity_id]: { user_id: uid, credential_slot: uid } });
              state.lock.slots[uid] = { code: String(data), name: b.user_name || null, reportsLeft: 0, usersLeft: Number(faults.usersLandAfterReads) || 0 };
              return answer({ [b.entity_id]: { user_id: uid, credential_slot: uid } });
            }
            state.lock.slots[uid].name = b.user_name || state.lock.slots[uid].name;
            return answer({ [b.entity_id]: { user_id: uid, credential_slot: null } });
          }
          if (service === 'set_credential') {
            const uid = Number(b.user_id); if (!state.lock.slots[uid]) return send(500, { message: 'Cannot modify credential: the slot is empty.' });
            if (!/^\d+$/.test(String(b.credential_data || ''))) return send(400, { message: 'PIN code must contain only digits.' });
            state.lock.slots[uid].code = String(b.credential_data);
            return answer({ [b.entity_id]: { credential_slot: uid, user_id: uid } });
          }
          if (service === 'delete_user' || service === 'delete_credential') {
            const uid = Number(b.user_id); if (!Number.isInteger(uid)) return send(400, { message: "expected int for dictionary value @ data['user_id']" });
            if (!state.lock.slots[uid]) return send(500, { message: service === 'delete_user' ? 'Cannot modify user: the slot is empty.' : 'Cannot modify credential: the slot is empty.' });
            delete state.lock.slots[uid]; return taken();
          }
          if (service === 'delete_all_users') { state.lock.slots = {}; return taken(); }
          if (service === 'delete_all_credentials') { const uid = Number(b.user_id); delete state.lock.slots[uid]; return taken(); }
        }
        if (service === 'get_lock_usercode') {
          // [R4] {"<code_slot>": {usercode, in_use}}, keyed by entity_id [R5]; one slot when
          // code_slot is given, every slot otherwise; a slot the node lacks is a 500
          // landsAfterReads: the slot reads EMPTY for that many reads, then the device's
          // report has landed in the cache and it reads in use [R6][A4]
          const view = (k) => {
            const sl = state.lock.slots[k];
            if (sl && sl.reportsLeft > 0) { sl.reportsLeft--; return { usercode: null, in_use: false }; }
            const landed = !!sl;
            return { usercode: landed ? (faults.maskCodes ? '**********' : faults.nullCodes ? null : sl.code) : null, in_use: landed };
          };
          if (b.code_slot !== undefined) {
            if (!Number.isInteger(slot)) return send(400, { message: "expected int for dictionary value @ data['code_slot']" });
            if (!inRange(slot)) return send(500, { message: 'Code slot ' + slot + ' not found on lock ' + b.entity_id });
            return answer({ [b.entity_id]: { [String(slot)]: view(slot) } });
          }
          const all = {}; for (let k = 1; k <= faults.slotCap; k++) all[String(k)] = view(k);
          return answer({ [b.entity_id]: all });
        }
      }
      if (req.method === 'POST' && (m = /^\/api\/services\/([^/]+)\/([^/]+)$/.exec(req.url))) {
        if (faults.serviceFails) return send(400, { message: 'service call failed' });
        const [, domain, service] = m;
        const id = parsed && (parsed.entity_id || (parsed.target && parsed.target.entity_id));
        if ((faults.hangEntities || []).includes(id)) { state.calls.push({ domain, service, entity_id: id, data: parsed, hung: true }); return; }
        if ((faults.failEntities || []).includes(id)) { state.calls.push({ domain, service, entity_id: id, data: parsed, refused: true }); return send(500, '500 Internal Server Error\n\nServer got itself in trouble', 'text/plain'); }
        state.calls.push({ domain, service, entity_id: id, data: parsed });
        const e = state.entities.find(x => x.entity_id === id);
        if (e) {
          if (service === 'turn_on') e.state = 'on';
          else if (service === 'turn_off') e.state = 'off';
          else if (service === 'unlock') e.state = 'unlocked';
          else if (service === 'lock') e.state = 'locked';
          else if (service === 'open_cover') e.state = 'open';
          else if (service === 'close_cover') e.state = 'closed';
          else if (service === 'set_temperature' && parsed) {
            // HOME ASSISTANT'S OWN CHECKS FIRST (Oct 21 2026; climate.async_service_temperature_set): a low above the high,
            // or a number outside the entity's range, is a ServiceValidationError - 400 over the REST API
            const at = e.attributes || (e.attributes = {}), lo = parsed.target_temp_low, hi = parsed.target_temp_high, t = parsed.temperature;
            if (lo != null && hi != null && lo > hi) return send(400, { message: 'Target temperature low can not be higher than Target temperature high.' });
            for (const v of [t, lo, hi]) if (v != null && at.min_temp != null && at.max_temp != null && (v < at.min_temp || v > at.max_temp)) return send(400, { message: `Provided temperature ${v} is not valid. Accepted range is ${at.min_temp} to ${at.max_temp}.` });
            // ...THEN THE INTEGRATION (Z-Wave JS's async_set_temperature; ZHA reads it the same way): one setpoint in heat,
            // cool or auto takes `temperature` and ignores a range; heat_cool takes the range and ignores `temperature`;
            // off takes nothing - all answered 200, so a number sent to the wrong setpoint changes nothing without a word
            if (e.state === 'heat_cool') { if (lo != null) at.target_temp_low = lo; if (hi != null) at.target_temp_high = hi; }
            else if (e.state !== 'off' && t != null) at.temperature = t;
          }
        }
        return send(200, e ? [e] : []);
      }
      return send(404, { message: 'Not found' });
    });
  });

  // ── /api/websocket: auth_required -> auth -> auth_ok, subscribe_events, ping,
  //    and fireKeypadUnlock() delivers a zwave_js_notification to subscribers.
  //    Hand-rolled RFC 6455 (text frames only) so the product's own global
  //    WebSocket is what gets exercised and no test dependency is added.
  const crypto = require('crypto');
  const frame = (obj) => {
    const payload = Buffer.from(JSON.stringify(obj));
    let head;
    if (payload.length < 126) head = Buffer.from([0x81, payload.length]);
    else if (payload.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(payload.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
    return Buffer.concat([head, payload]);
  };
  if (opts.hub) hub = makeHub(state, opts.hub === true ? {} : opts.hub, frame);
  srv.on('upgrade', (req, socket) => {
    if (!/^\/api\/websocket/.test(req.url) || faults.wsDown) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const client = { socket, authed: false, subs: [], hubSubs: new Map(), token: null };
    state.wsClients.push(client);
    const sendJ = o => { try { socket.write(frame(o)); } catch {} };
    client.sendJ = sendJ;
    sendJ({ type: 'auth_required', ha_version: '2026.9.0' });
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f, masked = !!(buf[1] & 0x80); let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const maskKey = masked ? buf.slice(off, off + 4) : null; if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.slice(off, off + len));
        if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
        buf = buf.slice(off + len);
        if (op === 8) { try { socket.end(); } catch {} return; }
        if (op === 9) { try { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); } catch {} continue; }
        if (op !== 1) continue;
        let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
        state.requests.push({ ws: true, msg });
        if (msg.type === 'auth') {
          if (faults.rejectToken || (msg.access_token !== faults.token && !(hub && hub.tokenOk(msg.access_token)))) { sendJ({ type: 'auth_invalid', message: 'Invalid access token' }); try { socket.end(); } catch {} }
          else { client.authed = true; client.token = msg.access_token; sendJ({ type: 'auth_ok', ha_version: '2026.9.0' }); }
        } else if (!client.authed) { sendJ({ id: msg.id, type: 'result', success: false, error: { code: 'unauthorized' } }); }
        // Home Assistant's SUBSCRIBE_ALLOWLIST (homeassistant/auth/permissions/events.py, read Sep 29 2026): the only
        // events a non-administrator may subscribe to; anything else is Unauthorized (websocket_api/commands.py), sent
        // as {success:false, error:{code:'unauthorized', message:'Unauthorized'}} (websocket_api/connection.py)
        else if (msg.type === 'subscribe_events' && faults.nonAdmin && !['area_registry_updated', 'component_loaded', 'core_config_updated', 'device_registry_updated', 'entity_registry_updated', 'repairs_issue_registry_updated', 'lovelace_updated', 'panels_updated', 'recorder_5min_statistics_generated', 'recorder_hourly_statistics_generated', 'service_registered', 'service_removed', 'shopping_list_updated', 'state_changed', 'themes_updated', 'label_registry_updated', 'labs_updated', 'category_registry_updated', 'floor_registry_updated'].includes(msg.event_type || '*')) {
          sendJ({ id: msg.id, type: 'result', success: false, error: { code: 'unauthorized', message: 'Unauthorized' } });
        }
        else if (msg.type === 'subscribe_events') { client.subs.push({ id: msg.id, event_type: msg.event_type || null }); sendJ({ id: msg.id, type: 'result', success: true, result: null }); }
        // auth/current_user (auth/__init__.py websocket_current_user): who this token belongs to
        else if (msg.type === 'auth/current_user') sendJ({ id: msg.id, type: 'result', success: true, result: { id: 'u-standin', name: faults.nonAdmin ? 'Front Desk' : 'Owner', is_owner: !faults.nonAdmin, is_admin: !faults.nonAdmin, credentials: [], mfa_modules: [] } });
        else if (msg.type === 'ping') sendJ({ id: msg.id, type: 'pong' });
        else if (hub && hub.onWs(client, msg, sendJ)) { /* the hub took it */ }
        else sendJ({ id: msg.id, type: 'result', success: true, result: null });
      }
    });
    socket.on('close', () => { const i = state.wsClients.indexOf(client); if (i >= 0) state.wsClients.splice(i, 1); });
    socket.on('error', () => {});
  });
  /** the Matter lock unlocked: HA writes only the operation SOURCE to changed_by [M4] and the entity's state_changed rides the websocket */
  const fireMatterUnlock = (source) => {
    const e = state.entities.find(x => x.entity_id === state.matter.entityId);
    const old_state = Object.assign({}, e, { attributes: Object.assign({}, e.attributes) });
    e.state = 'unlocked'; e.attributes.changed_by = source;
    let n = 0;
    for (const c of state.wsClients) for (const sub of c.subs) {
      if (sub.event_type && sub.event_type !== 'state_changed') continue;
      try { c.socket.write(frame({ id: sub.id, type: 'event', event: { event_type: 'state_changed', data: { entity_id: e.entity_id, old_state, new_state: Object.assign({}, e, { attributes: Object.assign({}, e.attributes) }) }, time_fired: new Date().toISOString(), origin: 'LOCAL' } })); n++; } catch {}
    }
    setTimeout(() => { e.state = 'locked'; }, 50);
    return n;
  };
  const fireKeypadUnlock = (userId, opts = {}) => {
    // [R8] every key async_on_notification puts on a Notification CC event; [R9] the numbers
    const data = Object.assign({ domain: 'zwave_js', node_id: 5, home_id: 3735928559, home_id_hex: 'deadbeef', endpoint: 0, device_id: 'dev-lock',
      command_class: 113, command_class_name: 'Notification', label: 'Access Control', type: 6, event: 6, event_label: 'Keypad unlock operation',
      parameters: { userId } }, opts);
    let n = 0;
    for (const c of state.wsClients) for (const sub of c.subs) {
      if (sub.event_type && sub.event_type !== 'zwave_js_notification') continue;
      try { c.socket.write(frame({ id: sub.id, type: 'event', event: { event_type: 'zwave_js_notification', data, time_fired: new Date().toISOString(), origin: 'LOCAL' } })); n++; } catch {}
    }
    return n;
  };
  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({
      srv, state, faults, port,
      url: `http://127.0.0.1:${port}`,
      set: o => Object.assign(faults, o || {}),
      stateOf: id => (state.entities.find(x => x.entity_id === id) || {}).state,
      lock: state.lock,                       // slots the stand-in lock holds
      fireKeypadUnlock,                       // deliver a keypad event to every subscriber
      fireMatterUnlock,                       // the Matter lock unlocked by a source (Keypad / Manual / ...)
      matter: state.matter,                   // the Matter lock's credentials and users
      wsClients: () => state.wsClients.length,
      hub: hub ? hub.H : null,                 // the hub's state: onboarding, users, tokens, entries, devices, the calls it was sent
      restart: () => hub && hub.restart(),     // Home Assistant restarted: a finished first run's addresses are gone (404)
      stop: () => new Promise(r => { for (const c of state.wsClients) { try { c.socket.destroy(); } catch {} } try { srv.closeAllConnections(); } catch {} srv.close(r); }),
    }));
  });
}
module.exports = { startHA, DEFAULT_FAULTS };
