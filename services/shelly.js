// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/shelly.js  —  Shelly Smart Plug Control
//
//  Supports Gen 1 and Gen 2/3 Shelly devices.
//  Devices are configured per-bay in config.json → bays[].shellyDevices[]
// ═══════════════════════════════════════════════════════════════════════════════

const axios         = require('axios');
const https         = require('https');
const { getConfig } = require('./config');
const { adminLog }  = require('./db');

// ── HTTPS ON NEW PLUGS (Oct 18 2026, from Shelly's own documentation) ─────────────────────────────────────────
// Shelly Gen2+ firmware 2.0.0 (released 2026-07-13): devices SHIPPED with it have "HTTP to HTTPS redirection enabled
// by default" with "Pre-installed HTTPS certificates issued by Shelly's internal PKI", and `enhanced_security` is
// "Read-only ... (always true)" on them (shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Sys; the 2.0.0
// changelog: "Implement HTTP to HTTPS redirect (when enhanced_security is enabled)"). A plain-HTTP call to such a plug
// is answered with a redirect; followed blindly, a POST can turn into a GET and the TLS check refuses Shelly's private
// certificate - the bay never powers on, and the two-minute probe called the plug "not answering". So a Gen2+ call
// is made with redirects NOT followed: a redirect to https on the SAME host is remembered for that plug and the call
// is repeated there. The certificate is not checked, for these requests only (plugTls below is handed to this file's own
// calls, never to https.globalAgent): no public authority can vouch for Shelly's private one, so to this unit it is no
// different from a self-signed certificate. That is exactly the trust every plug has had over plain HTTP on the
// facility's own network, and no password or token is ever sent. A plug whose login (Shelly's authentication) is switched on answers 401: that is reported in plain words
// and counts as a failure (rule 29), never as a success. Gen1 plugs (no 2.0.0 firmware) are unchanged. test-shelly-https.
const plugTls = new https.Agent({ rejectUnauthorized: false });
const httpsBase = new Map();   // plug address -> the https origin to use for it (learned per process from its redirect)
// THE ANSWER IS ALWAYS ASKED OF THE ADDRESS THE OWNER ENTERED (Oct 19 2026, the pack review). Shelly's docs do not say
// what a plug's redirect names - its address, or a name of its own - so the redirect's HOST is never followed: the
// call is repeated over https at the address configured for the plug (the port, if the redirect names one). Nothing
// is ever sent to a host the owner did not enter.
function httpsOriginFor(ip, loc) {
  try {
    const u = new URL(loc, 'http://' + ip);
    if (u.protocol !== 'https:') return null;
    const host = new URL('http://' + ip).host.replace(/:\d+$/, '');
    return 'https://' + host + (u.port && u.port !== '443' ? ':' + u.port : '');
  } catch { return null; }
}
async function rpc(ip, method, params, { timeout = 5000, post = false } = {}) {
  let followed = false, lastErr = null;   // per call: two calls at once must not read each other's redirect as a loop
  for (let hop = 0; hop < 3; hop++) {
    const base = httpsBase.get(ip) || ('http://' + ip);
    const url = `${base}/rpc/${method}`;
    const opts = { timeout, maxRedirects: 0, validateStatus: () => true, httpsAgent: plugTls };
    let r;
    try {
      r = post ? await axios.post(url, params || {}, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
               : await axios.get(url, Object.assign({ params: params || {} }, opts));
    } catch (e) {
      lastErr = e;
      // a plug that went back to plain HTTP (a factory reset to older firmware, a replacement at the same address)
      if (base.startsWith('https:') && /ECONNREFUSED|EPROTO|ECONNRESET|wrong version number/i.test(String(e.code || '') + ' ' + String(e.message || ''))) { httpsBase.delete(ip); continue; }
      throw e;
    }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const origin = httpsOriginFor(ip, r.headers && r.headers.location);
      if (origin && !followed && origin !== base) { followed = true; httpsBase.set(ip, origin); continue; }
      throw new Error(origin ? 'the plug kept redirecting' : `the plug redirected somewhere that is not https (${String((r.headers && r.headers.location) || '').slice(0, 60)})`);
    }
    if (r.status === 401) throw new Error('the plug asks for a password - its login is switched on in the Shelly app; switch it off for this plug (the unit sends no password), or consult the troubleshooting guide');
    if (r.status === 429) throw new Error('the plug is refusing requests for a while (too many failed logins) - try again in a few minutes');
    if (r.status >= 400) throw new Error(`the plug answered ${r.status}`);
    return r;
  }
  throw lastErr || new Error('the plug kept redirecting');
}

async function controlDevice(ip, gen, on) {
  const action = on ? 'on' : 'off';
  try {
    if (gen === 1) {
      await axios.get(`http://${ip}/relay/0?turn=${action}`, { timeout: 5000 });
    } else {
      await rpc(ip, 'Switch.Set', { id: 0, on }, { post: true });
    }
    console.log(`⚡ Shelly [${ip}] → ${action.toUpperCase()}`);
    adminLog('SHELLY_' + action.toUpperCase(), `IP: ${ip}`);
    return { success: true, ip, action };
  } catch (err) {
    console.error(`⚡ Shelly [${ip}] FAILED:`, err.message);
    adminLog('SHELLY_ERROR', `IP: ${ip} — ${err.message}`);
    return { success: false, ip, action, error: err.message };
  }
}

/** Turn all plugs in a specific bay on or off */
async function controlBay(bayId, on) {
  const cfg = getConfig();
  const bay = cfg.bays.find(b => b.id === bayId);
  if (!bay) return [{ success: false, error: `Bay ${bayId} not found` }];
  // A bay with no smart plugs is normal - a facility may automate some bays,
  // or none. Reading .map() off undefined here used to throw a 500 at staff
  // pressing the power button, which looked like the system was broken.
  const devices = Array.isArray(bay.shellyDevices) ? bay.shellyDevices : [];
  if (!devices.length) {
    return [{ success: true, skipped: true, message: 'No smart plugs are configured for this bay.' }];
  }
  return Promise.all(devices.map(d => controlDevice(d.ip, d.gen || 1, on)));
}

/**
 * RESTART A BAY - power cycle it. Off, wait, on.
 *
 * This is the recovery action when a bay is misbehaving: a frozen simulator
 * PC, a projector that will not wake, software that hung mid-session. It is
 * what staff would otherwise do by crawling behind the unit and pulling the
 * plug, and it is the single most-used fix in a simulator facility.
 *
 * The gap matters: cutting power and restoring it instantly can leave a PC
 * power supply in a confused state and fail to boot. Default 8 seconds.
 */
async function restartBay(bayId, gapMs = 8000) {
  const cfg = getConfig();
  const bay = (cfg.bays || []).find(b => b.id === bayId);
  if (!bay) return { success: false, error: `Bay ${bayId} not found` };
  const devices = Array.isArray(bay.shellyDevices) ? bay.shellyDevices : [];
  if (!devices.length) {
    return { success: true, skipped: true, message: 'No smart plugs are configured for this bay.' };
  }
  const off = await Promise.all(devices.map(d => controlDevice(d.ip, d.gen || 1, false)));
  await new Promise(r => setTimeout(r, Math.max(2000, Math.min(30000, gapMs))));
  const on = await Promise.all(devices.map(d => controlDevice(d.ip, d.gen || 1, true)));
  const ok = off.every(r => r && r.success !== false) && on.every(r => r && r.success !== false);
  return { success: ok, bay: bay.name, gap_ms: gapMs, off, on };
}

/** Turn ALL plugs in ALL bays on or off */
async function controlAll(on) {
  const cfg = getConfig();
  const results = [];
  for (const bay of (cfg.bays || [])) {
    for (const d of (Array.isArray(bay.shellyDevices) ? bay.shellyDevices : [])) {
      results.push(await controlDevice(d.ip, d.gen || 1, on));
    }
  }
  if (!results.length) results.push({ success: true, skipped: true, message: 'No smart plugs are configured.' });
  return results;
}

async function getStatus(ip, gen) {
  try {
    const res = gen === 1 ? await axios.get(`http://${ip}/relay/0`, { timeout: 4000 }) : await rpc(ip, 'Switch.GetStatus', { id: 0 }, { timeout: 4000 });
    // gen2+ Switch.GetStatus includes apower (live watts) on metering plugs.
    const watts = (gen !== 1 && typeof res.data.apower === 'number') ? Math.round(res.data.apower) : null;
    return { success: true, ip, on: gen === 1 ? res.data.ison : res.data.output, watts };
  } catch (err) {
    return { success: false, ip, on: false, error: err.message };
  }
}

/** Get status of all devices across all bays */
async function getAllStatus() {
  const cfg = getConfig();
  const results = [];
  for (const bay of cfg.bays) {
    for (const d of bay.shellyDevices) {
      const status = await getStatus(d.ip, d.gen || 1);
      results.push({ ...d, bayId: bay.id, bayName: bay.name, ...status });
    }
  }
  return results;
}

// ── WHAT A PLUG SAYS IT IS (Oct 19 2026: the network scan finds the facility's plugs) ─────────────────
// Built from Shelly's own documentation:
//   [SH1] Gen1, shelly-api-docs.shelly.cloud/gen1/ ("/shelly"): GET /shelly -> {type, mac, auth, fw, longid,
//         discoverable}; "It does not require HTTP authentication, even if authentication is enabled globally."
//   [SH2] Gen2+, shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Shelly: GET /shelly -> {id, mac, model, gen,
//         fw_id, ver, app, auth_en, auth_domain}, "equivalent to invoking Shelly.GetDeviceInfo" - which has no name.
//   [SH3] Gen2+, .../ComponentsAndServices/Sys: Sys.GetConfig -> {device: {name, mac, fw_id, ...}}; name is the one the
//         owner gave the plug in the Shelly app (null when none).
// Asked the way every call in this file is: plain HTTP first, a redirect to https on the SAME address taken (the 2.0.0
// firmware), never a redirect's host. Anything that is not a Shelly answers null; nothing is ever changed.
async function info(ip, { timeout = 1500 } = {}) {
  for (let hop = 0; hop < 2; hop++) {
    const base = httpsBase.get(ip) || ('http://' + ip);
    let r;
    try { r = await axios.get(base + '/shelly', { timeout, maxRedirects: 0, validateStatus: () => true, httpsAgent: plugTls }); } catch { return null; }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const origin = httpsOriginFor(ip, r.headers && r.headers.location);
      if (origin && origin !== base) { httpsBase.set(ip, origin); continue; }
      return null;
    }
    const j = r.status === 200 && r.data && typeof r.data === 'object' ? r.data : null;
    if (!j || !j.mac) return null;
    const gen = Number(j.gen) >= 2 ? Number(j.gen) : (j.type ? 1 : null);
    if (!gen) return null;
    const mac = String(j.mac).toLowerCase().replace(/[^0-9a-f]/g, '').replace(/(..)(?!$)/g, '$1:');
    const out = { ip, gen, model: j.model || j.type || null, app: j.app || null, id: j.id || null, mac, login: !!(j.auth_en || j.auth), name: null };
    if (gen >= 2 && !out.login) { try { const c = await rpc(ip, 'Sys.GetConfig', {}, { timeout }); out.name = (c.data && c.data.device && c.data.device.name) || null; } catch {} }
    return out;
  }
  return null;
}

module.exports = { controlDevice, controlBay, restartBay, controlAll, getStatus, getAllStatus, rpc, info };
