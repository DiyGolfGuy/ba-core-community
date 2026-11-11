// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/hasetup.js  -  THE BOX SETS UP ITS OWN HOME ASSISTANT
//  (Oct 19 2026)
//
//  maintainer: "home assistant right in that box ... in a container ... One unit shippable
//  unit that does everything"; "we can kind of change things up if you need to build
//  home assistant in a different way". On the box, Home Assistant is part of the
//  product, so the owner never opens it to begin: no account to make, no token to
//  copy. When config.homeAssistant.builtIn is true the unit does Home Assistant's
//  first-run itself, makes its own token, and connects the radios' servers:
//
//    1. reach    GET /api/onboarding (no sign-in): the steps done so far [S1]; a
//                404 means onboarding finished before Home Assistant last started [S2]
//    2. account  the owner account: made here with a random password (kept in
//                config.homeAssistant.login, never sent to a browser - auth
//                REMOVE_PATHS) [S3], or signed in to with that login [S5]
//    3. finish   the other onboarding steps with that sign-in's token [S4]
//    4. token    a long-lived token for the unit's own use [S6], saved as
//                homeAssistant.token with enabled and url - what every Home
//                Assistant feature of the product already reads
//    5. place    the facility's name, time zone, country and money, once [S7]
//    6. radios   Z-Wave JS and the Matter server added as integrations [S8]; a
//                server that does not answer is a radio the box does not have
//                (rule 31: absent is not failed)
//    7. local    Home Assistant kept on the box's own address (127.0.0.1): its web
//                settings' first-start trial promoted, or staged again if it was
//                lost [S9] (keepLocal, below)
//
//  Every step reads what is already so first, so a restart anywhere in the middle
//  carries on (rule 22); the password is saved BEFORE Home Assistant is asked to make
//  the account, so a crash between the two can still sign in.
//
//  Built from Home Assistant 2026.9.4's own source, read in the workshop lab:
//   [S1] components/onboarding/views.py OnboardingStatusView: GET /api/onboarding ->
//        [{step, done}] for user, core_config, analytics, integration; no auth.
//   [S2] components/onboarding/__init__.py async_setup: when every step is done the
//        views are never registered, so the address answers 404.
//   [S3] views.py UserOnboardingView: POST /api/onboarding/users {name, username,
//        password, client_id, language} -> {auth_code}; 403 once done.
//   [S4] views.py CoreConfig / Analytics / IntegrationOnboardingView: POST with the
//        owner's bearer token; integration takes {client_id, redirect_uri} on the same
//        host and needs a token signed in with a password (a long-lived token has no
//        credential: 403 "Credentials for user not available").
//   [S5] components/auth/login_flow.py: POST /auth/login_flow {client_id, handler:
//        ["homeassistant", null], redirect_uri} -> {flow_id}; POST /auth/login_flow/
//        <flow_id> {client_id, username, password} -> {type:"create_entry", result:
//        <code>}; components/auth/__init__.py TokenView: POST /auth/token (a form)
//        grant_type=authorization_code, code, client_id -> {access_token, ...};
//        auth/indieauth.py: client_id is an http(s) URL, redirect_uri the same host.
//   [S6] components/auth/__init__.py websocket "auth/long_lived_access_token"
//        {client_name, lifespan (days)} -> the token; homeassistant/auth refuses a
//        second long-lived token with the same client_name for a user.
//   [S7] components/config/core.py websocket "config/core/update" {location_name,
//        time_zone, country, currency, unit_system ("us_customary" | "metric")}.
//   [S8] components/config/config_entries.py: POST /api/config/config_entries/flow
//        {handler} -> a form; POST .../flow/<flow_id> with the form's fields ->
//        {type:"create_entry"} | {type:"form", errors} | {type:"abort", reason};
//        zwave_js/config_flow.py and matter/config_flow.py outside a Supervisor install
//        go straight to step "manual" {url}; websocket "config_entries/get" {domain}
//        -> [{entry_id, domain, title, state}].
//   [S9] components/http/config.py and websocket_api.py (2026.9): the web settings live in
//        Home Assistant's own store as {stable, pending}; the configuration file's http: is
//        moved in once, on a first start, as a PENDING trial with a five-minute revert
//        (AUTO_REVERT_DELAY); websocket "http/config" (admin) -> {stable, pending, revert_at,
//        active_config_type, default}; "http/config/promote" makes the trial stable;
//        "http/config/configure" {config} (HTTP_STORAGE_SCHEMA - no created_at or error
//        keys) stages a new trial and restarts Home Assistant. A trial nobody promotes is
//        marked "not_promoted", never tried again, and Home Assistant restarts on stable.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const { getConfig, saveConfig } = require('./config');
const haws = require('./haws');
const log = (ev, d) => { try { require('./db').adminLog(ev, String(d).slice(0, 300)); } catch {} };

const DEFAULTS = { url: 'http://127.0.0.1:8123', zwave: 'ws://127.0.0.1:3000', matter: 'ws://127.0.0.1:5580/ws' };
const RADIOS = [
  { domain: 'zwave_js', key: 'zwave', say: 'Z-Wave' },
  { domain: 'matter', key: 'matter', say: 'Matter' },
];
const TIMEOUT_MS = 10000;
// ADDING A RADIO WAITS (Oct 19 2026, found in the workshop lab - the stand-in answered at once): the first time an
// integration is added, Home Assistant installs its library before it answers the flow at all (zwave-js-server-python,
// python-matter-server), which took longer than TIMEOUT_MS, and the radio was skipped as if Home Assistant had refused
const FLOW_TIMEOUT_MS = () => Number(process.env.BA_TEST_HA_FLOW_TIMEOUT_MS) || 180000;

const ha = () => getConfig().homeAssistant || {};
const builtIn = () => !!ha().builtIn;
const baseUrl = () => String(ha().url || DEFAULTS.url).replace(/\/+$/, '');
const clientId = () => `http://127.0.0.1:${Number((getConfig().server || {}).port) || 3001}/`;
function saveHA(patch) { saveConfig({ homeAssistant: patch }); }

/** fetch with a timeout; never throws: { status, json, text } with status 0 when nothing answered */
async function req(method, path, { json, form, token, timeoutMs } = {}) {
  const headers = {};
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  if (token) headers.Authorization = 'Bearer ' + token;
  try {
    const r = await fetch(baseUrl() + path, { method, headers, body, signal: AbortSignal.timeout(timeoutMs || TIMEOUT_MS) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, json: j, text };
  } catch (e) { return { status: 0, json: null, text: String(e && e.message || e) }; }
}

/** [S1][S2] where Home Assistant's first run stands */
async function onboarding() {
  const r = await req('GET', '/api/onboarding');
  if (r.status === 0) return { reachable: false, error: 'Home Assistant is not answering at ' + baseUrl() };
  if (r.status === 404) return { reachable: true, onboarded: true, done: ['user', 'core_config', 'analytics', 'integration'] };
  if (r.status !== 200 || !Array.isArray(r.json)) return { reachable: true, error: `Home Assistant answered ${r.status} for its setup status` };
  const done = r.json.filter(s => s && s.done).map(s => s.step);
  return { reachable: true, onboarded: r.json.every(s => s && s.done), done };
}

/** [S5] an access token from a password: the login flow, then the code for a token */
async function signIn(login) {
  const cid = clientId();
  const a = await req('POST', '/auth/login_flow', { json: { client_id: cid, handler: ['homeassistant', null], redirect_uri: cid } });
  if (a.status !== 200 || !a.json || !a.json.flow_id) return { error: `Home Assistant would not start a sign-in (${a.status})` };
  const b = await req('POST', `/auth/login_flow/${a.json.flow_id}`, { json: { client_id: cid, username: login.username, password: login.password } });
  if (b.status !== 200 || !b.json || b.json.type !== 'create_entry' || !b.json.result) return { error: 'Home Assistant did not accept the sign-in this unit made for it' + (b.json && b.json.errors ? ' (' + Object.values(b.json.errors).join(', ') + ')' : '') };
  return exchange(b.json.result);
}
async function exchange(code) {
  const t = await req('POST', '/auth/token', { form: { grant_type: 'authorization_code', code, client_id: clientId() } });
  if (t.status !== 200 || !t.json || !t.json.access_token) return { error: `Home Assistant would not hand over a token (${t.status})` };
  return { access: t.json.access_token };
}

/** does the saved long-lived token still open the websocket? */
async function tokenWorks() {
  const c = ha();
  if (!c.token) return false;
  try { const s = await haws.open({ url: baseUrl(), token: c.token }); s.close(); return true; } catch { return false; }
}

/** [S8] the integrations there are, by domain: { zwave_js: 'loaded', ... } */
async function integrations(session) {
  const out = {};
  const entries = await session.call('config_entries/get', {});
  for (const e of Array.isArray(entries) ? entries : []) if (!out[e.domain] || e.state === 'loaded') out[e.domain] = e.state;
  return out;
}

/** [S8] add one radio's server as an integration; answers 'added' | 'there' | 'absent' (its server does not answer) | an error */
async function addRadio(token, radio, url) {
  const a = await req('POST', '/api/config/config_entries/flow', { token, json: { handler: radio.domain, show_advanced_options: false }, timeoutMs: FLOW_TIMEOUT_MS() });
  if (a.status === 0) return { error: `Home Assistant did not answer while adding ${radio.say} - it may still be installing it; the unit tries again` };
  if (a.status !== 200 || !a.json) return { error: `Home Assistant would not start adding ${radio.say} (${a.status})` };
  if (a.json.type === 'abort') return a.json.reason === 'already_configured' || a.json.reason === 'single_instance_allowed' ? { state: 'there' } : { error: `${radio.say}: ${a.json.reason}` };
  if (a.json.type !== 'form' || a.json.step_id !== 'manual') return { error: `${radio.say}: Home Assistant asked for "${a.json.step_id || a.json.type}", not the server's address` };
  const b = await req('POST', `/api/config/config_entries/flow/${a.json.flow_id}`, { token, json: { url }, timeoutMs: FLOW_TIMEOUT_MS() });
  if (b.status === 200 && b.json && b.json.type === 'create_entry') return { state: 'added' };
  if (b.status === 200 && b.json && b.json.type === 'abort' && b.json.reason === 'already_configured') return { state: 'there' };
  const why = b.json && b.json.errors && (b.json.errors.base || Object.values(b.json.errors)[0]);
  // the form's own way of saying nothing answered at that address: a radio this box does not have (rule 31)
  if (why === 'cannot_connect') { try { await req('DELETE', `/api/config/config_entries/flow/${a.json.flow_id}`, { token }); } catch {} return { state: 'absent' }; }
  return { error: `${radio.say}: ${why || ('answered ' + b.status)}` };
}

let _running = null;
/** Set up the built-in Home Assistant, or carry on where it stopped. Answers { ok, did: [...], radios, error }.
 *  Asked by the owner (opts.from 'owner'), a failure is written in the owner's log (rule 29); the boot writes its first. */
function setup(opts = {}) {
  if (_running) return _running;
  _running = run(opts).then(r => { if (opts.from === 'owner' && !r.ok && !r.notBuiltIn) log('HA_SETUP_ERROR', r.error); return r; }).finally(() => { _running = null; });
  return _running;
}
async function run({ radios: radioUrls } = {}) {
  const did = [];
  if (!builtIn()) return { ok: false, notBuiltIn: true, error: 'this unit does not have Home Assistant built in' };
  const ob = await onboarding();
  if (!ob.reachable) return { ok: false, waiting: true, error: ob.error };
  if (ob.error) return { ok: false, error: ob.error };

  // nothing left but the radios: no new sign-in (each one leaves a session in Home Assistant's list)
  if (ob.onboarded && await tokenWorks()) return finishRadios(did, ha().token, radioUrls);

  // 2. the account, and a token signed in with its password
  let access = null, made = false;
  if (!ob.done.includes('user')) {
    const login = { username: 'owner', password: crypto.randomBytes(18).toString('base64url') };
    saveHA({ url: baseUrl(), login });                                    // kept before Home Assistant is asked
    const c = getConfig();
    const r = await req('POST', '/api/onboarding/users', { json: { client_id: clientId(), name: (c.server && c.server.businessName) || 'Owner', username: login.username, password: login.password, language: 'en' } });
    if (r.status === 200 && r.json && r.json.auth_code) {
      const t = await exchange(r.json.auth_code); if (t.error) return { ok: false, did, error: t.error };
      access = t.access; made = true; did.push('account');
      log('HA_SETUP', 'the built-in Home Assistant\'s owner account was made (sign-in kept on the unit)');
    } else if (r.status !== 403) return { ok: false, did, error: `Home Assistant would not make its owner account (${r.status}${r.json && r.json.message ? ': ' + r.json.message : ''})` };
  }
  if (!access) {
    const login = ha().login;
    if (!login || !login.username || !login.password) {
      if (await tokenWorks()) return finishRadios(did, ha().token, radioUrls);   // the owner pasted a token of their own
      return { ok: false, did, error: 'Home Assistant already has an owner this unit did not make. Sign in to Home Assistant, make a long-lived access token (your profile, then Security) and paste it into the chat.' };
    }
    const t = await signIn(login); if (t.error) return { ok: false, did, error: t.error };
    access = t.access;
  }

  // 3. the rest of the first run [S4]
  for (const step of ['core_config', 'analytics', 'integration']) {
    if (ob.done.includes(step)) continue;
    const r = await req('POST', `/api/onboarding/${step}`, { token: access, json: step === 'integration' ? { client_id: clientId(), redirect_uri: clientId() } : {} });
    if (r.status !== 200 && r.status !== 403) return { ok: false, did, error: `Home Assistant's "${step}" setup step answered ${r.status}` };
    if (r.status === 200) did.push(step);
  }

  // 4. the unit's own long-lived token [S6] and 5. the place, once [S7]
  if (!(await tokenWorks())) {
    let s;
    try { s = await haws.open({ url: baseUrl(), token: access }); } catch (e) { return { ok: false, did, error: 'Home Assistant\'s websocket: ' + e.message }; }
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const token = await s.call('auth/long_lived_access_token', { client_name: 'BA Core ' + stamp, lifespan: 3650 });
      if (typeof token !== 'string' || token.length < 20) return { ok: false, did, error: 'Home Assistant did not hand over a long-lived token' };
      saveHA({ enabled: true, url: baseUrl(), token });
      did.push('token');
      log('HA_SETUP', 'the unit made its own long-lived token for the built-in Home Assistant');
      if (made) {
        const c = getConfig();
        try {
          await s.call('config/core/update', { location_name: (c.server && c.server.businessName) || 'Facility', time_zone: (c.server && c.server.timezone) || 'America/Chicago', country: 'US', currency: 'USD', unit_system: 'us_customary' });
          did.push('place');
        } catch (e) { log('HA_SETUP', 'the facility\'s place was not set in Home Assistant: ' + e.message); }
      }
    } catch (e) { return { ok: false, did, error: 'Home Assistant: ' + e.message }; }
    finally { s.close(); }
  }
  return finishRadios(did, access, radioUrls);
}
// HOME ASSISTANT STAYS ON THE BOX'S OWN ADDRESS (Oct 24 2026, found in the workshop lab - the walk was cut off by Home Assistant
// restarting itself): Home Assistant 2026.9 moves the configuration file's http: (server_host 127.0.0.1) into its own store as a
// trial an admin must promote within five minutes [S9]. Nobody promoted it - the unit is the box's only admin - so Home Assistant
// restarted on its stable settings, which listen on EVERY address of the box (the facility's network included), and never tried
// the trial again. The unit, already talking to Home Assistant through the trial, promotes it; a trial that is not the box's own
// address is left alone; one already lost is staged again with 127.0.0.1 (Home Assistant restarts to try it - the next pass
// promotes it). An older Home Assistant without the command reads its file every start: nothing to do.
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const isLocal = (c) => !!c && Array.isArray(c.server_host) && c.server_host.length > 0 && c.server_host.every(h => LOCAL_HOSTS.has(String(h)));
async function keepLocal(s) {
  let c;
  try { c = await s.call('http/config', {}); } catch (e) { return /unknown/i.test(String(e.code || e.message)) ? { skipped: true } : { error: e.message }; }
  if (!c || typeof c !== 'object') return { skipped: true };
  if (c.active_config_type === 'pending' && c.pending && !c.pending.error) {
    if (!isLocal(c.pending)) return { open: true };
    try { await s.call('http/config/promote', {}); } catch (e) { return { error: e.message }; }
    return { promoted: true };
  }
  if (isLocal(c.active_config_type === 'pending' ? c.pending : c.stable)) return { local: true };
  const base = Object.assign({}, c.stable || c.default || {}); for (const k of ['created_at', 'error', 'error_message']) delete base[k];
  try { await s.call('http/config/configure', { config: Object.assign(base, { server_host: ['127.0.0.1'] }) }); } catch (e) { return { error: e.message }; }
  return { staged: true };
}
async function finishRadios(did, token, radioUrls) {
  const urls = Object.assign({}, DEFAULTS, ha().servers || {}, radioUrls || {});
  const radios = {};
  let present = {}, local = {};
  try { const s = await haws.open({ url: baseUrl(), token: ha().token || token }); try { local = await keepLocal(s); present = await integrations(s); } finally { s.close(); } }
  catch (e) { return { ok: false, did, error: 'Home Assistant\'s websocket: ' + e.message }; }
  if (local.promoted) { did.push('local'); log('HA_SETUP', 'the built-in Home Assistant is kept on the box\'s own address (its web settings confirmed)'); }
  if (local.staged) { did.push('local'); log('HA_SETUP', 'the built-in Home Assistant was listening on every address - its web settings are back to the box\'s own address, and it restarts to take them'); }
  if (local.open) log('HA_SETUP', 'the built-in Home Assistant is trying web settings that are not the box\'s own address - left as they are');
  const errors = [];
  for (const r of RADIOS) {
    if (present[r.domain]) { radios[r.key] = present[r.domain] === 'loaded' ? 'ready' : present[r.domain]; continue; }
    const a = await addRadio(token, r, urls[r.key]);
    if (a.error) { radios[r.key] = 'error'; errors.push(a.error); continue; }
    radios[r.key] = a.state === 'absent' ? 'absent' : 'ready';
    if (a.state === 'added') { did.push(r.key); log('HA_SETUP', `${r.say} was added to the built-in Home Assistant`); }
  }
  if (did.length) saveHA({ builtInSetupAt: new Date().toISOString() });
  // a radio Home Assistant would not add is not set up: the boot keeps trying, and the owner who asked hears why
  return errors.length ? { ok: false, did, radios, error: errors.join('; ') } : { ok: true, did, radios };
}

/** What the owner and the assistant are told: is the hub set up, and which radios it has */
async function status() {
  const c = ha();
  const out = { builtIn: builtIn(), url: c.url || (builtIn() ? DEFAULTS.url : ''), connected: false, radios: {} };
  // switched off is never contacted (rule 31) - test-secret-surface walks this route on a unit whose Home Assistant is
  // saved but switched off, and the first cut opened its websocket anyway
  if (!c.enabled) { out.reason = builtIn() ? 'not set up yet' : 'Home Assistant is switched off on this unit'; return out; }
  if (!c.url || !c.token) { out.reason = builtIn() ? 'not set up yet' : 'Home Assistant is not connected'; return out; }
  try {
    const s = await haws.open({ url: c.url, token: c.token });
    try {
      out.connected = true; out.version = s.haVersion;
      const present = await integrations(s);
      for (const [domain, key] of [['zwave_js', 'zwave'], ['zha', 'zigbee'], ['matter', 'matter'], ['thread', 'thread']]) if (present[domain]) out.radios[key] = present[domain] === 'loaded' ? 'ready' : present[domain];
    } finally { s.close(); }
  } catch (e) { out.reason = e.code === 'auth_invalid' ? 'Home Assistant refused the unit\'s token' : 'Home Assistant is not answering'; }
  return out;
}

// ── IS THE HUB ANSWERING (rule 23, Oct 19 2026): the bays' plugs, lights and thermostats follow bookings through it, so
//    a hub that stops answering is said on the health line (services/unithealth.js 'hub'). A light probe - the websocket
//    opened with the unit's token and closed - every minute on a unit with the hub built in, and nowhere else (rule 31).
let _reach = { failSince: 0, lastOkAt: 0, why: '' }, _lastSetupError = '', _bootAt = Date.now(), _probe = null;
async function probe() {
  if (!builtIn() || !ha().token) return { skipped: true };
  try { const s = await haws.open({ url: baseUrl(), token: ha().token }); s.close(); _reach = { failSince: 0, lastOkAt: Date.now(), why: '' }; }
  catch (e) { _reach = { failSince: _reach.failSince || Date.now(), lastOkAt: _reach.lastOkAt, why: e.code === 'auth_invalid' ? 'it refused the unit\'s token' : 'it did not answer' }; }
  return Object.assign({}, _reach);
}
function reachState() { return Object.assign({ builtIn: builtIn(), setUp: !!ha().token, setupError: _lastSetupError, upSince: _bootAt }, _reach); }

// At boot on the box: Home Assistant's container may start after the product - try for a while, quietly (rule 31: a
// hub that is still starting is not a failure); a refusal is written in the owner's log by run() itself.
let _boot = null;
function startBoot() {
  if (!builtIn() || _boot) return;
  _bootAt = Date.now();
  if (!_probe) { _probe = setInterval(() => { probe().catch(() => {}); }, Number(process.env.BA_TEST_HUB_PROBE_MS) || 60000); _probe.unref && _probe.unref(); }
  let tries = 0;
  const tick = async () => {
    _boot = null;
    const r = await setup().catch(e => ({ ok: false, error: e.message }));
    tries++;
    _lastSetupError = r.ok || r.waiting ? '' : String(r.error || '');
    if (r.ok || r.notBuiltIn) return;
    if (!r.waiting && tries === 1) log('HA_SETUP_ERROR', r.error);
    _boot = setTimeout(tick, Number(process.env.BA_TEST_HA_SETUP_RETRY_MS) || (tries < 10 ? 60000 : 15 * 60000)); _boot.unref && _boot.unref();
  };
  _boot = setTimeout(tick, Number(process.env.BA_TEST_HA_SETUP_DELAY_MS) || 5000); _boot.unref && _boot.unref();
}
function stopBoot() { if (_boot) clearTimeout(_boot); _boot = null; if (_probe) clearInterval(_probe); _probe = null; }

module.exports = { setup, status, onboarding, startBoot, stopBoot, probe, reachState, DEFAULTS, clientId };
