// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/sequence.js — Manual bay ON/OFF as the TRUE tee-time procedure
//
//  maintainer (Aug 13): "all bays on or off or bay on or off should be exactly what
//  happens at the beginning of a Tee time for that bay and also at the end
//  for bay off. dont hard shut down the PC if its on a shelly plug."
//
//  The dashboard buttons used to be RAW Shelly toggles - OFF cut the plug
//  under a running Windows PC. Now:
//
//  START (mirror of the scheduler's session-start set, run immediately):
//    1. Every Shelly device ON
//    2. Every BroadLink onCommand
//    3. Home Assistant entities ON / comfort temperature
//
//  STOP (graceful - the end-of-session procedure, compressed for a human
//  pressing the button NOW):
//    1. If the bay has a simulator PC: send the Windows shutdown, then WAIT
//       until port 445 stops answering (capped at
//       cfg.automation.manualOffGraceSecs, default 90 - facility policy,
//       not a constant)
//    2. Every Shelly device OFF
//    3. Every BroadLink offCommand
//    4. Home Assistant entities OFF / eco temperature
//
//  The per-device "Turn Off After (minutes)" delay is deliberately IGNORED
//  here - that delay keeps bays warm between sessions; a person pressing
//  OFF means now, just safely.
//
//  dryRun returns the planned steps without touching hardware - that is how
//  the battery proves the ORDER without a Shelly on the bench.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { getConfig }     = require('./config');
const { controlDevice } = require('./shelly');
const { sendCommand }   = require('./broadlink');
const haService         = require('./homeassistant');
const simulator         = require('./simulator');
const { adminLog }      = require('./db');

function bayById(id) { return (getConfig().bays || []).find(b => b.id === id); }
// on the whole facility's own list too (services/facilitydevices): the facility's times decide it
function onFacility(entityId) { try { return require('./facilitydevices').has(getConfig(), entityId); } catch { return false; } }

function planStart(bay) {
  const steps = [];
  // WAKE-ON-LAN first (pilot facility, Aug 2026): if the bay has a PC MAC, wake it before
  // anything else so it boots while plugs/IR/climate come up. A magic packet to
  // an already-on PC is a no-op, and a blank MAC means pure plug-cycle behaviour
  // (nothing changes). Depends on the PC plug being left on (turnOffAfter=false).
  if (bay.pcMac) steps.push({ kind: 'wol', target: bay.pcMac, mac: bay.pcMac });
  for (const d of (bay.shellyDevices || []))
    steps.push({ kind: 'shelly_on', target: d.name || d.ip, ip: d.ip, gen: d.gen || 2 });
  for (const d of (bay.broadlinkDevices || []))
    if (d.ip && d.onCommand) steps.push({ kind: 'broadlink_on', target: d.name || d.ip, ip: d.ip, cmd: d.onCommand, onCmd: d.onCommand, codeStyle: d.codeStyle });
  for (const d of (bay.haDevices || [])) {
    if (d.entity_id == null) continue;
    if (onFacility(d.entity_id)) continue;   // the whole facility's (the heat and AC, a lounge TV): its own times decide it, never one bay's button
    // a thermostat is set for the mode it is in - heat, cool or heat/cool (homeassistant.setClimate, Oct 21 2026)
    if (d.comfortTemp != null) steps.push({ kind: 'ha_temp', target: d.entity_id, temp: d.comfortTemp, set: haService.climateTargets(d).comfort });
    else steps.push({ kind: 'ha_on', target: d.entity_id });
  }
  return steps;
}

function planStop(bay) {
  const steps = [];
  if (bay.simulatorPcIp) {
    steps.push({ kind: 'pc_shutdown', target: bay.simulatorPcIp });
    steps.push({ kind: 'wait_pc_down', target: bay.simulatorPcIp });
  }
  // Item 4 (pilot facility reliability batch, Aug 17): honor each device's "Auto Turn
  // Off" flag. Only a device the owner EXPLICITLY set to "No - leave on"
  // (turnOffAfter === false) is spared - typically the PC's own plug, whose
  // power-down is governed by the Shelly's wattage rule after Windows exits,
  // or an always-on fridge/router sharing the bay circuit. Cutting it here
  // would hard-kill a PC mid-shutdown: the exact thing the setting exists to
  // prevent. A device with the flag ABSENT (legacy config) is still cut -
  // that matches both the old manual-OFF behavior and how the bay editor
  // displays an unset flag ("Yes - auto off"). (The "Turn Off After MINUTES"
  // delay is still deliberately ignored - pressing OFF means now, just safely.)
  for (const d of (bay.shellyDevices || []))
    if (d.turnOffAfter !== false) steps.push({ kind: 'shelly_off', target: d.name || d.ip, ip: d.ip, gen: d.gen || 2 });
  // ...and the same for a TV remote and a smart-home device (Oct 20 2026, found by the AI branch's bay map): only the Shelly
  // plugs were spared, so a PC whose plug is a Home Assistant switch set "leave on" lost its power on a manual Off - and
  // Wake-on-LAN could not wake it for the next session. The scheduler spares all three; so does this now.
  for (const d of (bay.broadlinkDevices || []))
    if (d.ip && d.offCommand && d.turnOffAfter !== false) steps.push({ kind: 'broadlink_off', target: d.name || d.ip, ip: d.ip, cmd: d.offCommand, onCmd: d.onCommand, codeStyle: d.codeStyle });
  for (const d of (bay.haDevices || [])) {
    if (d.entity_id == null) continue;
    if (onFacility(d.entity_id)) continue;   // "Bay 3 Off" never turns down the building's heat or the lounge TV (Oct 21 2026, the device audit)
    if (d.ecoTemp != null) steps.push({ kind: 'ha_eco', target: d.entity_id, temp: d.ecoTemp, set: haService.climateTargets(d).eco });
    else if (d.turnOffAfter !== false) steps.push({ kind: 'ha_off', target: d.entity_id });
  }
  return steps;
}

async function waitPcDown(ip, graceSecs) {
  const until = Date.now() + graceSecs * 1000;
  while (Date.now() < until) {
    const up = await simulator.probePc(ip, 2000);
    if (up === false || up === null) return true;   // gone (or unprobeable)
    await new Promise(r => setTimeout(r, 4000));
  }
  return false;                                     // grace expired, proceed anyway
}

async function runStep(step, bay) {
  switch (step.kind) {
    case 'wol':           return simulator.wakePc(step.mac);
    case 'shelly_on':     return controlDevice(step.ip, step.gen, true);
    case 'shelly_off':    return controlDevice(step.ip, step.gen, false);
    case 'broadlink_on':
    case 'broadlink_off': return sendCommand(step.ip, step.cmd);
    case 'ha_on':         return haService.setEntity(step.target, true);
    case 'ha_off':        return haService.setEntity(step.target, false);
    case 'ha_temp':
    case 'ha_eco':        return haService.setClimate(step.target, step.set);
    case 'pc_shutdown':   return simulator.sendShutdown(bay, 0);
    case 'wait_pc_down': {
      const grace = Number(getConfig().automation?.manualOffGraceSecs ?? 90);
      step.pc_confirmed_down = await waitPcDown(step.target, grace);
      return true;
    }
  }
}

// A PERSON CAN ALWAYS OVERRIDE THE LEDGER (Sep 25 2026, the build review): a toggle TV the ledger
// says is already on or off is not sent again - but IR is one-way, so the ledger can be wrong (the
// TV's own remote, a code the TV missed), and the button used to be the fix. The answer now names
// what was not sent, and the SAME button pressed again within two minutes sends it anyway (not
// within three seconds - a double tap on a phone is not a decision).
const heldBack = new Map();   // bayId|mode -> when a press held a toggle device back
const localHm = at => { const t = new Date(String(at || '').replace(' ', 'T') + 'Z'); return isNaN(t) ? String(at || '').slice(11, 16) : String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };

async function runBay(bayId, mode, opts = {}) {
  const bay = bayById(bayId);
  if (!bay) return { ok: false, error: `Bay ${bayId} not found`, steps: [] };
  const steps = mode === 'start' ? planStart(bay) : planStop(bay);
  if (opts.dryRun) return { ok: true, bay: bay.name, mode, dryRun: true, steps };
  // THE BUTTONS WRITE TO THE COMMAND LEDGER AND READ IT (Sep 25 2026, maintainer's item 6 - pilot facility: a
  // manual Off 13 seconds after the automatic off turned a toggle TV back ON). services/devicelog.
  const ledger = require('./devicelog');
  const source = 'manual - ' + (opts.source || 'bay button');
  const ledgerOf = st => ({ wol: ['pc:' + st.mac, 'on'], shelly_on: ['shelly:' + st.ip, 'on'], shelly_off: ['shelly:' + st.ip, 'off'],
    broadlink_on: [st.ip && ledger.irKey({ ip: st.ip, onCommand: st.onCmd }), 'on'], broadlink_off: [st.ip && ledger.irKey({ ip: st.ip, onCommand: st.onCmd }), 'off'],
    ha_on: ['ha:' + st.target, 'on'], ha_off: ['ha:' + st.target, 'off'], ha_temp: ['ha:' + st.target, 'on'], ha_eco: ['ha:' + st.target, 'off'],
    pc_shutdown: ['pc:' + st.target, 'off'] })[st.kind] || null;
  const hk = bayId + '|' + mode, prevHeld = heldBack.get(hk), since = prevHeld ? Date.now() - prevHeld : null;
  const force = !!opts.force || (since !== null && since >= 3000 && since <= 120000);
  let held = false;
  for (const s of steps) {
    const lg = ledgerOf(s);
    try {
      // a TV on a toggle code that the ledger says is already in this state: not sent again
      if ((s.kind === 'broadlink_on' || s.kind === 'broadlink_off')) {
        const already = force ? null : ledger.toggleAlready({ ip: s.ip, onCommand: s.onCmd, codeStyle: s.codeStyle }, s.kind === 'broadlink_on' ? 'on' : 'off');
        if (already) {
          held = true; s.ok = true;
          s.skipped = `not sent - the unit sent "${already.op}" at ${localHm(already.at)} (${already.source}) and its code is a toggle, so sending it again would switch it back. If it is not ${already.op}, press ${mode === 'start' ? 'On' : 'Off'} again within two minutes to send it anyway.`;
          continue;
        }
        if (force && prevHeld) s.forced = true;
      }
      const res = await runStep(s, bay);
      const bad = res === false || res === null || res === undefined
        || (typeof res === 'object' && !res.skipped && (res.success === false || res.error));
      if (bad) throw new Error((res && res.error) || 'the device did not answer');
      s.ok = true; if (res && res.skipped) s.skipped = res.reason || true;
      if (lg && lg[0] && !s.skipped) ledger.record({ device: lg[0], bayId: bay.id, op: lg[1], source, ok: true, detail: s.forced ? 'sent anyway - the button was pressed again' : '' });
    }
    catch (e) { s.ok = false; s.error = e.message; if (lg && lg[0]) ledger.record({ device: lg[0], bayId: bay.id, op: lg[1], source, ok: false, detail: e.message }); }
  }
  if (held) heldBack.set(hk, Date.now()); else heldBack.delete(hk);
  if (heldBack.size > 200) heldBack.clear();
  // the owner's log names what did not happen, not only how many steps there were
  const failed = steps.filter(x => x.ok === false), skipped = steps.filter(x => x.skipped), forced = steps.filter(x => x.forced);
  try { adminLog('BAY_SEQUENCE', `${bay.name} | ${mode.toUpperCase()} | ${source} | ${steps.length} steps` + (failed.length ? ` | FAILED: ${failed.map(x => x.target + ' (' + String(x.error).slice(0, 60) + ')').join('; ')}` : '') + (skipped.length ? ` | not sent: ${skipped.map(x => x.target + ' - ' + String(x.skipped).replace(/^not sent - /, '').slice(0, 90)).join('; ')}` : '') + (forced.length ? ` | sent anyway (the button was pressed again): ${forced.map(x => x.target).join(', ')}` : '')); } catch {}
  return { ok: steps.every(x => x.ok !== false), bay: bay.name, mode, steps };
}

const startBay = (bayId, opts) => runBay(bayId, 'start', opts);
const stopBay  = (bayId, opts) => runBay(bayId, 'stop',  opts);

async function allBays(mode, opts = {}) {
  const cfg = getConfig();
  const out = [];
  for (const b of (cfg.bays || []).filter(b => b.active !== false)) {
    // an out-of-service bay stays dark on All On (Oct 20 2026): it is broken or being repaired - All Off still reaches it
    if (mode === 'start' && b.maintenance) { out.push({ ok: true, bay: b.name, mode, steps: [], skipped: 'out of service - left off' }); continue; }
    out.push(await runBay(b.id, mode, opts));
  }
  return { ok: true, mode, bays: out };
}

module.exports = { startBay, stopBay, allBays, planStart, planStop };
