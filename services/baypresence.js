// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/baypresence.js - WHEN EACH BAY'S PC LAST SPOKE TO THE UNIT (Sep 25 2026, maintainer's item 6)
//
// A bay PC with the session watcher installed asks the unit for its bay's status every
// half minute (GET /api/session/status?bay=...). A poll is the plainest proof the PC is up
// and on the network, so Wake-on-LAN's check reads it beside the port-445 probe - a PC whose
// file sharing is off still counts as up once its watcher has asked. In memory only: the
// poll comes every thirty seconds and writing it to the card each time would wear the card
// for a fact that is only ever wanted for the next few minutes.
'use strict';
const seen = new Map();   // bay id -> ms of the last poll
// IS THE RESERVED SCREEN UP? (Oct 2 2026, maintainer: "only if the bay watcher is up") A watcher built from this
// date says with each poll whether its reserved screen is showing (guard=1/0). The last three hours of those
// answers, per bay, so the restart before the next group can ask whether the screen stayed up through the
// gap - never taken down by staff's kill code, or by someone using the PC. An older watcher sends nothing.
const guards = new Map();   // bay id -> [{ t, up }]
const GUARD_KEEP_MS = 3 * 3600000;
// only a bay this unit has (the build review: the route is public, so any string grew the map)
// atMs: a battery's past poll; a unit always records now
function note(bayId, guard, atMs) {
  if (!bayId) return;
  try { if (!(require('./config').getConfig().bays || []).some(b => b && String(b.id) === String(bayId))) return; } catch { return; }
  const id = String(bayId), t = Number(atMs) || Date.now();
  seen.set(id, Math.max(seen.get(id) || 0, t));
  if (guard === '1' || guard === '0' || guard === true || guard === false) {
    const list = guards.get(id) || [];
    list.push({ t, up: guard === '1' || guard === true });
    const floor = Date.now() - GUARD_KEEP_MS;
    while (list.length && list[0].t < floor) list.shift();
    guards.set(id, list);
  }
}
function lastSeen(bayId) { return seen.get(String(bayId)) || 0; }
function seenSince(bayId, sinceMs) { const t = lastSeen(bayId); return t > 0 && t >= sinceMs; }
/** Did the reserved screen stay up on this bay's PC from fromMs to toMs? true: every report in that time said
 *  up; false: one said it was down; null: no report at all (no watcher, or one from before Oct 2 2026). */
function guardHeld(bayId, fromMs, toMs) {
  const list = (guards.get(String(bayId)) || []).filter(r => r.t >= fromMs && r.t <= toMs);
  if (!list.length) return null;
  return list.every(r => r.up);
}
module.exports = { note, lastSeen, seenSince, guardHeld };
