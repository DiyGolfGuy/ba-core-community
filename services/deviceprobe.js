// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/deviceprobe.js - A PLUG THAT DROPS OFF SHOWS BEFORE A SESSION NEEDS IT
// (Sep 25 2026, maintainer's item 6; pilot facility: "the IR emitter fell off the ceiling and nothing noticed")
//
// A smart plug was only ever spoken to when a booking needed it, so one unplugged at 3 PM was
// found at the next session's power-on - by a customer in a dark bay. Every two minutes the
// scheduler asks each Shelly plug the unit is set up with for its status (read-only - it is
// never switched by this). One that does not answer twice in a row is written to the owner's
// log once (DEVICE_UNREACHABLE) and the Automation health line names it until it answers
// again (DEVICE_BACK). A facility with no plugs is not probed (rule 31).
// An IR emitter that has fallen off its TV cannot be seen from here - infrared is one-way and
// the bridge still answers - and nothing here claims otherwise; its failures show when a
// command to the bridge itself fails.
'use strict';
const axios = require('axios');
const { getConfig } = require('./config');
const EVERY_MS = 2 * 60000;
let lastRun = 0;

function plugs(cfg) {
  const seen = new Map();
  // a bay the owner switched off or took out of service is not asked about (the build review: its
  // unplugged plug held Automation amber until the plug was deleted)
  for (const bay of (cfg.bays || [])) { if (!bay || bay.active === false || bay.maintenance) continue; for (const d of (bay.shellyDevices || [])) if (d && d.ip && !seen.has(d.ip)) seen.set(d.ip, { ip: d.ip, gen: d.gen || 2, name: d.name || d.ip, bay: bay.name || bay.id }); }
  return [...seen.values()];
}
async function answers(p) {
  for (let i = 0; i < 2; i++) {
    try {
      // Gen2+: the plug's own transport (services/shelly.rpc - plain HTTP, or HTTPS once a plug redirects there, Shelly
      // firmware 2.0.0, Oct 18 2026).
      if (p.gen === 1) { const r = await axios.get(`http://${p.ip}/status`, { timeout: 3000, validateStatus: () => true }); if (r.status < 500) return { ok: true }; }
      else { await require('./shelly').rpc(p.ip, 'Shelly.GetStatus', {}, { timeout: 3000 }); return { ok: true }; }
    } catch (e) {
      // A PLUG THAT ASKS FOR A PASSWORD IS ON THE NETWORK AND STILL CANNOT POWER THE BAY (Oct 19 2026, the pack review):
      // the unit sends no password, so every power-on it is asked for fails - the owner hears it now, not at the first
      // session. Refusing for a while (429) or another 4xx is a plug that answers.
      if (/asks for a password/.test(String(e.message))) return { ok: false, locked: true, error: 'asks for a password - its login is switched on in the Shelly app' };
      if (/refusing requests|answered 4\d\d/.test(String(e.message))) return { ok: true };
      if (i === 1) return { ok: false, error: String(e.message).slice(0, 80) };
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { ok: false, error: 'answered with a server error' };
}
function lastEvent(ip) {
  try { const r = require('./db').db.prepare(`SELECT event FROM admin_log WHERE event IN ('DEVICE_UNREACHABLE','DEVICE_BACK') AND detail LIKE ? ORDER BY id DESC LIMIT 1`).get('%| ' + ip + ' |%'); return r ? r.event : ''; } catch { return ''; }
}
/** Probe every plug (at most every two minutes unless forced). Returns what it found. */
async function probe(opts = {}) {
  if (!opts.force && Date.now() - lastRun < EVERY_MS) return { skipped: true };
  lastRun = Date.now();
  const list = plugs(getConfig());
  const out = [];
  for (const p of list) {
    const a = await answers(p);
    const was = lastEvent(p.ip);
    if (!a.ok && was !== 'DEVICE_UNREACHABLE') require('./db').adminLog('DEVICE_UNREACHABLE', `${p.name} (${p.bay}) | ${p.ip} | ${a.locked ? 'cannot be switched: it ' : 'not answering: '}${a.error}`);
    if (a.ok && was === 'DEVICE_UNREACHABLE') require('./db').adminLog('DEVICE_BACK', `${p.name} (${p.bay}) | ${p.ip} | answering again`);
    out.push(Object.assign({ ip: p.ip, name: p.name }, a));
  }
  return { probed: out.length, down: out.filter(x => !x.ok).length, out };
}
/** The plugs whose newest word in the owner's log is "not answering" - and that are still set up. */
function unreachable() {
  const ips = new Set(plugs(getConfig()).map(p => p.ip));
  const out = [];
  try {
    const rows = require('./db').db.prepare(`SELECT event, detail, created_at FROM admin_log WHERE event IN ('DEVICE_UNREACHABLE','DEVICE_BACK') ORDER BY id DESC LIMIT 400`).all();
    const seen = new Set();
    for (const r of rows) {
      const m = /\| (\S+) \|/.exec(String(r.detail || '')); const ip = m && m[1];
      if (!ip || seen.has(ip)) continue; seen.add(ip);
      if (r.event === 'DEVICE_UNREACHABLE' && ips.has(ip)) out.push({ ip, detail: r.detail, since: r.created_at });
    }
  } catch {}
  return out;
}
module.exports = { probe, unreachable, plugs };
