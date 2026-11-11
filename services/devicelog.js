// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/devicelog.js - THE COMMAND LEDGER: EVERY COMMAND SENT TO A BAY DEVICE, BY WHOM
// (Sep 25 2026, maintainer's item 6; the pilot facility handoff section 2)
//
// pilot facility: the manual bay buttons sent IR directly and wrote nothing. Their TVs learn one power
// toggle, so a manual Off pressed 13 seconds after the automatic off switched the set back ON,
// and the automation could not know what the buttons had done. Here every command the unit
// sends to a bay's plug, TV, Home Assistant device or PC - by the scheduler or by a person
// pressing Bay On / Bay Off - is written to device_commands with who sent it and whether the
// device took it. For a TV that learned a TOGGLE code (rule 16: the default), neither path
// sends "off" when the ledger's last command that worked, within two hours, was already
// "off" (and the same for "on"): a toggle would flip it back. Older than that, the ledger is
// not trusted over the remote in someone's hand, and the command is sent. Discrete and
// explicit-state devices (a Shelly relay, a Home Assistant entity) are never guarded -
// sending them twice is harmless.
'use strict';
const TRUST_MINS = 120;
const D = () => require('./db').db;
// ONE LEDGER ENTRY PER DEVICE, NOT PER BRIDGE (Sep 25 2026, the build review): a TV and a
// projector on one BroadLink shared 'ir:<ip>', so the second one's Bay On was skipped as "already
// on" the moment the first was sent. The device is its bridge plus the code it learned.
const codeTag = c => { let h = 0; for (const ch of String(c || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
const irKey = d => (d && typeof d === 'object') ? 'ir:' + d.ip + ':' + codeTag(d.onCommand || d.cmd || '') : 'ir:' + d;
const irStyle = d => (String((d && d.codeStyle) || '').toLowerCase() === 'discrete' ? 'discrete' : 'toggle');   // the scheduler's irCodeStyle, rule 16

function record({ device, bayId, op, source, ok, detail }) {
  try { D().prepare(`INSERT INTO device_commands (device, bay_id, op, source, ok, detail) VALUES (?,?,?,?,?,?)`).run(String(device), String(bayId || ''), String(op), String(source || ''), ok ? 1 : 0, String(detail || '').slice(0, 200)); } catch {}
}
/** The last command a device TOOK, if it was within the trust window. */
function lastOk(device, withinMins = TRUST_MINS) {
  try { return D().prepare(`SELECT op, source, at FROM device_commands WHERE device=? AND ok=1 AND at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`).get(String(device), `-${withinMins} minutes`) || null; } catch { return null; }
}
/** For a TOGGLE IR device: the ledger row that says it is already `op`, or null. */
function toggleAlready(dev, op) {
  if (!dev || !dev.ip || irStyle(dev) !== 'toggle') return null;
  const last = lastOk(irKey(dev));
  return last && last.op === op ? last : null;
}
/** The last command a device took, however long ago - for a caller that already knows the device
 *  has not been left alone since (a session kept it on for the next one). */
function lastEver(device) {
  try { return D().prepare(`SELECT op, source, at FROM device_commands WHERE device=? AND ok=1 ORDER BY id DESC LIMIT 1`).get(String(device)) || null; } catch { return null; }
}
function prune() { try { D().prepare(`DELETE FROM device_commands WHERE at < datetime('now','-180 days')`).run(); } catch {} }
module.exports = { record, lastOk, lastEver, toggleAlready, irKey, irStyle, prune, TRUST_MINS };
