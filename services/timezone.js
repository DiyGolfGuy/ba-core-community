// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/timezone.js — Timezone detection and setting
//
//  The whole app trusts the OS/process clock (new Date() in local time). This
//  service keeps that clock correct:
//    - detectFromIP()  : ask a geo service what timezone this Pi's public IP is in
//    - isValidZone()   : whitelist check against real IANA zones (injection guard)
//    - applyTimezone() : set the OS timezone (timedatectl) AND the running process
//                        (process.env.TZ live-updates, so no restart needed)
//
//  Security: the zone is ALWAYS validated against Intl.supportedValuesOf before it
//  is passed to timedatectl, and it is passed via execFile args (never a shell
//  string), so command injection is not possible.
// ═══════════════════════════════════════════════════════════════════════════════

const { execFile } = require('child_process');

// Canonical list of valid IANA timezones for this runtime. Used as a strict
// allowlist — nothing outside this set is ever passed to the OS.
let VALID_ZONES = [];
try { VALID_ZONES = Intl.supportedValuesOf('timeZone'); } catch { VALID_ZONES = []; }
// UTC IS MISSING FROM THAT LIST and it is what a fresh Pi is set to (Sep 16 2026,
// the coverage wave - this service had no battery and nobody had ever asked).
// Intl.supportedValuesOf returns IANA region names and treats UTC as an alias, so
// currentOSZone() on an un-configured unit returned 'UTC' and isValidZone('UTC')
// said no: the unit could not validate the zone it was actually running in, and
// the wizard's timezone step had to refuse its own starting value.
if (!VALID_ZONES.includes('UTC')) VALID_ZONES = ['UTC'].concat(VALID_ZONES);

function isValidZone(zone) {
  return typeof zone === 'string' && VALID_ZONES.includes(zone);
}

function listZones() {
  return VALID_ZONES.slice();
}

// Ask a free IP-geolocation service for this machine's timezone.
// Tries providers in order; returns { ok, timezone, city, region } or { ok:false }.
async function detectFromIP() {
  const providers = [
    // HTTPS FIRST (Sep 16 2026). This asked a PLAIN-HTTP service first and only
    // fell back to the HTTPS one. Nothing secret is sent - it is "where is this
    // IP" - but the ANSWER sets the facility's clock, and the clock decides every
    // booking window and every door-code window, so anyone on the path could move
    // them. The verifiable provider is asked first; the plain one stays as a
    // fallback, because a checkable guess still beats no clock at all.
    { url: 'https://ipapi.co/json/', pick: d => d.timezone ? { tz: d.timezone, city: d.city, region: d.region } : null },
    { url: 'http://ip-api.com/json/?fields=status,timezone,city,regionName', pick: d => d.status === 'success' ? { tz: d.timezone, city: d.city, region: d.regionName } : null }
  ];
  for (const p of providers) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(p.url, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      const parsed = p.pick(data);
      if (parsed && isValidZone(parsed.tz)) {
        return { ok: true, timezone: parsed.tz, city: parsed.city || '', region: parsed.region || '' };
      }
    } catch (e) { /* try next provider */ }
  }
  return { ok: false, error: 'Could not detect timezone from network location.' };
}

// Get the timezone the OS currently reports.
function currentOSZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
}

// Apply a timezone: validate, set OS via timedatectl (best-effort), and live-update
// the running Node process so new Date() reflects it immediately.
// Returns { ok, timezone, osSet, message }.
function applyTimezone(zone) {
  return new Promise((resolve) => {
    if (!isValidZone(zone)) {
      return resolve({ ok: false, error: 'Invalid timezone.' });
    }
    // Live-update the running process first — this always works and is what the
    // app's clock actually reads.
    process.env.TZ = zone;

    if (process.env.BA_CORE_COMMUNITY === '1') {
      return resolve({
        ok: true, timezone: zone, osSet: false,
        message: `BA Core uses ${zone} for bookings and automation. To set the Pi's system time zone as well, run sudo timedatectl set-timezone ${zone} over SSH.`
      });
    }

    // Set the OS timezone so it persists across reboots and matches the process.
    // Uses execFile with an args array (no shell), and -n so it fails fast rather
    // than hanging on a password prompt if sudo isn't passwordless.
    execFile('sudo', ['-n', 'timedatectl', 'set-timezone', zone], { timeout: 5000 }, (err) => {
      if (err) {
        // OS set failed (likely sudo), but the process clock is already correct.
        // The app runs correctly now; OS persistence needs the standalone script
        // or a sudoers rule. Report honestly rather than pretending it fully set.
        return resolve({
          ok: true, timezone: zone, osSet: false,
          message: 'Timezone applied to the app. The clock zone of the Pi itself was not changed (BA Core does not use sudo). To match it, run sudo timedatectl set-timezone with the same zone on the Pi.'
        });
      }
      resolve({ ok: true, timezone: zone, osSet: true, message: 'Timezone set.' });
    });
  });
}

// The zone the operating system itself is set to (/etc/localtime), '' when it cannot be read.
function systemZone() {
  try { const l = require('fs').readlinkSync('/etc/localtime'); const m = /zoneinfo\/(.+)$/.exec(l); return m ? m[1] : ''; } catch { return ''; }
}

/**
 * THE FACILITY'S ZONE AT EVERY START AND AFTER EVERY RESTORE (Oct 3 2026; pilot facility's handoff section 3, "Clocks"). The zone
 * was applied only when Settings or the wizard saved it - so a unit restored from a backup at the wizard's first screen
 * (a spare, a replacement board) never ran the wizard's zone step, and a unit whose OS zone was never set ran every
 * booking, door window and power-on in the OS zone after a restart. The app's clock is the process's: it is set from
 * the configured zone here on every boot and restore. The operator manages the host OS time zone separately.
 * Returns { changed, was, zone, os }.
 */
function ensureConfiguredZone(reason, log) {
  let cfg = {};
  try { cfg = require('./config').getConfig(); } catch {}
  const zone = String((cfg.server && cfg.server.timezone) || '').trim();
  if (!isValidZone(zone)) return { changed: false };
  const was = currentOSZone();
  const changed = was !== zone;
  const os = 'unchanged';
  if (changed) {
    process.env.TZ = zone;
    if (log) {
      try { log('CLOCK_ZONE_APPLIED', `${reason}: the facility's zone is ${zone}`); } catch {}
    }
  }
  return { changed, was, zone, os };
}

module.exports = { isValidZone, listZones, detectFromIP, currentOSZone, applyTimezone, ensureConfiguredZone, systemZone };
