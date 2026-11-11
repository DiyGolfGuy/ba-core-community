// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/facilitydevices.js - THE FACILITY'S OWN DEVICES (Oct 21 2026)
//
// maintainer: "heat and Ac would be a facility one"; "thermostats are just in that facility ... if there's no bookings for 3 hours,
// then I'll turn it back down to the Standby mode. And then the same with, like the TV's, if there's no bookings within an
// hour, just turn the TV [off] and turn it back [on] 10 minutes before the next booking ... it stays on as long as there's a
// booking within X time ... So someone's ... one [bay's] booking doesn't turn the heat off or turn the football game off ...
// when their booking is over".
//
// A bay's device follows that bay's bookings. A facility device follows the BUILDING:
//   - it comes on `before` minutes ahead of the first booking in any bay (whole-facility bookings, events and tournaments
//     count; a maintenance block does not);
//   - it stays on while the next booking anywhere starts within `gap` minutes of the last one ending;
//   - when nothing is booked inside that gap it goes to standby `after` minutes past the end - a plug, a light or a TV off,
//     a thermostat to its idle temperature for the mode it is in (homeassistant.setClimate);
//   - or, set to follow the opening hours, it is on from `before` ahead of opening until `after` past closing, and for any
//     booking outside them.
// Config: homeAssistant.facilityDevices[] - { entity_id, name, kind: 'power'|'climate', follows: 'bookings'|'hours',
//   keepOnGapMins, minutesBefore, turnOffAfter, minutesAfter (power), comfortTemp, ecoTemp, coolEcoTemp, leadTimeMins,
//   setbackDelayMins (climate) }.
//
// LEVEL, NOT EDGE. Every tick works out from the bookings what each device should be doing NOW and compares that with what
// the unit last decided (facility_device_state, on disk). Only a change is sent, so a booking added, moved or cancelled, a
// restart, a unit that was off, or a clock that moved all come out right on the next tick - and a person who switches the
// device by hand in the middle of a run is not fought until the run ends. Each change is one job on the automation ledger
// (booking 'facility', kind facility_on / facility_off, device 'fac:<entity>#<n>'): a refusal retries with backoff and
// never stops while it still applies, it shows on the health line like any device (rules 23, 28, 29), and a change made
// stale by the next one is written off as superseded. No Home Assistant set up is nothing to do (rule 31).
'use strict';

const dbM = require('./db');
const automation = require('./automation');
const { getConfig } = require('./config');

// what is not said: a power device on 10 minutes ahead, kept on across an hour; a thermostat 15 ahead, across three hours
// (maintainer's own examples); either to standby 10 minutes after the end
const DEFAULTS = { power: { before: 10, after: 10, gap: 60 }, climate: { before: 15, after: 10, gap: 180 } };
const DAY = 86400000;

function list(cfg) { return (((cfg || getConfig()).homeAssistant || {}).facilityDevices || []).filter(d => d && d.entity_id); }
function has(cfg, entityId) { return list(cfg).some(d => d.entity_id === entityId); }

function timing(d) {
  const k = d.kind === 'climate' ? 'climate' : 'power';
  const n = (v, dflt) => { const x = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(x) || x < 0 ? dflt : x; };
  return {
    before: n(k === 'climate' ? d.leadTimeMins : d.minutesBefore, DEFAULTS[k].before),
    after: n(k === 'climate' ? d.setbackDelayMins : d.minutesAfter, DEFAULTS[k].after),
    gap: n(d.keepOnGapMins, DEFAULTS[k].gap),
    // nothing to put on standby: a power device the owner keeps on, a thermostat with no idle temperature
    turnsOff: k === 'climate' ? (d.ecoTemp !== null && d.ecoTemp !== undefined && d.ecoTemp !== '') : d.turnOffAfter !== false,
  };
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (now, k) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, 12);   // a calendar day, never n x 24 hours
const hmWords = ms => { const t = new Date(ms); const h = t.getHours(); return `${h % 12 || 12}:${pad(t.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; };

/** Every booking that can matter now - two days back to two days ahead - as [start, end] in ms, earliest first. */
function sessions(now) {
  const from = ymd(dayOf(now, -2)), to = ymd(dayOf(now, 2));
  let rows = [];
  try {
    rows = dbM.db.prepare(`SELECT id, bay_name, date, start_time, end_time, end_date FROM bookings
      WHERE status IN ('active','completed') AND COALESCE(booking_type, 'customer') <> 'maintenance'
        AND ((date >= ? AND date <= ?) OR (end_date >= ? AND end_date <= ?))`).all(from, to, from, to);
  } catch { return []; }
  const endOf = require('./doorlock').bookingEndDate;
  return rows.map(b => {
    const s = new Date(`${b.date}T${b.start_time}:00`).getTime();
    const e = ((() => { try { return endOf(b); } catch { return null; } })() || new Date(`${b.end_date || b.date}T${b.end_time}:00`)).getTime();
    return { id: b.id, bay: b.bay_name || '', s, e };
  }).filter(x => Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s).sort((a, b) => a.s - b.s);
}

/** Runs of bookings: the next one joins the run when it starts within the gap of the run's end. Each run is on from
 *  `before` ahead of its first start until `after` past its last end. */
function runs(all, t) {
  const out = [];
  for (const x of all) {
    const last = out[out.length - 1];
    if (last && x.s - last.e <= t.gap * 60000) { if (x.e > last.e) last.e = x.e; }
    else out.push({ s: x.s, e: x.e, first: x });
  }
  return out.map(r => ({ from: r.s - t.before * 60000, to: r.e + t.after * 60000, why: `the booking at ${hmWords(r.first.s)}${r.first.bay ? ' (' + r.first.bay + ')' : ''}` }));
}

// a day the whole building is closed by a maintenance block over its whole opening (the owner's own closure)
function closedAllDay(sMs, eMs) {
  try {
    const endOf = require('./doorlock').bookingEndDate;
    const rows = dbM.db.prepare(`SELECT date, start_time, end_time, end_date FROM bookings WHERE status='active' AND booking_type='maintenance' AND whole_facility=1
      AND COALESCE(end_date, date) >= ?`).all(ymd(new Date(sMs)));
    return rows.some(b => { const s = new Date(`${b.date}T${b.start_time}:00`).getTime(), e = (endOf(b) || new Date(`${b.end_date || b.date}T${b.end_time}:00`)).getTime(); return s <= sMs && e >= eMs; });
  } catch { return false; }
}

/** The opening hours as on-windows, two days either side of now (a facility open all day and night: always). */
function hours(cfg, now, t) {
  const bk = cfg.booking || {};
  if (bk.open24Hours) return [{ from: -Infinity, to: Infinity, why: 'the facility is open 24 hours' }];
  const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const days = Array.isArray(bk.openDays) && bk.openDays.length ? bk.openDays : KEYS;
  const out = [];
  for (let k = -2; k <= 2; k++) {
    const d = dayOf(now, k);
    if (!days.includes(KEYS[d.getDay()])) continue;
    // (that day's own hours, if it has them - services/hours.js)
    const h = require('./hours').on(bk, ymd(d)), open = String(h.openTime).slice(0, 5), close = String(h.closeTime).slice(0, 5);
    const s = new Date(`${ymd(d)}T${open}:00`).getTime();
    let e = new Date(`${ymd(d)}T${close}:00`).getTime();
    if (h.closeNextDay || !(e > s)) e = new Date(`${ymd(dayOf(d, 1))}T${close}:00`).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || closedAllDay(s, e)) continue;
    out.push({ from: s - t.before * 60000, to: e + t.after * 60000, why: `opening at ${hmWords(s)}` });
  }
  return out;
}

/** What a facility device should be doing at `now`: { want: 'on', until, why } inside a run (or the hours), { want: 'off',
 *  why } outside one, { want: null } outside one when it never goes to standby. */
function decide(d, cfg, now, all) {
  const t = timing(d);
  let wins = runs(all || sessions(now), t);
  if (d.follows === 'hours') wins = wins.concat(hours(cfg, now, t));
  const n = now.getTime();
  const cur = wins.filter(w => w.from <= n && n < w.to).sort((a, b) => a.from - b.from);
  if (cur.length) return { want: 'on', until: Math.max(...cur.map(w => w.to)), why: cur[0].why };
  if (!t.turnsOff) return { want: null };
  return { want: 'off', why: d.follows === 'hours' ? 'closed, and nothing booked' : `nothing booked within ${t.gap >= 60 && t.gap % 60 === 0 ? (t.gap / 60) + ' hour' + (t.gap === 60 ? '' : 's') : t.gap + ' minutes'}` };
}

function ensureSchema() {
  dbM.db.exec(`CREATE TABLE IF NOT EXISTS facility_device_state (
    entity_id TEXT PRIMARY KEY, gen INTEGER NOT NULL DEFAULT 0, want TEXT NOT NULL DEFAULT '', why TEXT DEFAULT '', changed_at TEXT)`);
}

const KEY = (d, gen) => `fac:${d.entity_id}#${gen}`;
function schedule(d, want, gen, until) {
  automation.ensureJob({ booking_id: 'facility', kind: want === 'on' ? 'facility_on' : 'facility_off', device_key: KEY(d, gen), due_at: new Date(),
    deadline_at: want === 'on' && Number.isFinite(until) ? new Date(until) : null });
}
// an earlier change still waiting (or still being retried) when the next one comes is written off: only the newest applies
function supersede(entity, gen) {
  const prefix = `fac:${entity}#`;
  try {
    const rows = dbM.db.prepare(`SELECT id, device_key FROM automation_jobs WHERE booking_id='facility' AND substr(device_key, 1, ?) = ? AND status IN ('pending','failed')`).all(prefix.length, prefix);
    for (const r of rows) if (Number(String(r.device_key).slice(prefix.length)) < gen)
      dbM.db.prepare(`UPDATE automation_jobs SET status='skipped', last_error=?, next_attempt_at=NULL, lease_until=NULL WHERE id=?`).run('superseded - the facility changed again before this went through', r.id);
  } catch {}
}
function worked(what, res) {
  if (res === true || (res && typeof res === 'object' && (res.success === true || res.skipped))) return res;
  throw new Error(what + ': ' + ((res && res.error) || 'the device did not answer'));
}

async function fire(d, gen, why) {
  const key = KEY(d, gen);
  const row = dbM.db.prepare(`SELECT kind FROM automation_jobs WHERE booking_id='facility' AND device_key=?`).get(key);
  if (!row || !automation.claim('facility', row.kind, key)) return 0;
  const on = row.kind === 'facility_on', climate = d.kind === 'climate', ha = require('./homeassistant');
  const label = d.name || d.entity_id;
  const what = `${label} (the facility) ${on ? (climate ? 'comfort' : 'on') : (climate ? 'idle' : 'off')}`;
  await automation.run('facility', row.kind, key, async () => {
    const res = climate ? await ha.setClimate(d.entity_id, ha.climateTargets(d)[on ? 'comfort' : 'eco']) : await ha.setEntity(d.entity_id, on);
    let err = null;
    try { worked(what, res); } catch (e) { err = e; }
    if (!(res && res.skipped)) require('./devicelog').record({ device: 'ha:' + d.entity_id, bayId: 'facility', op: on ? 'on' : 'off', source: 'automation', ok: !err, detail: err ? err.message : '' });
    if (err) throw err;
    if (res && res.skipped) dbM.adminLog('HA_NOT_SENT', `${what} | ${res.reason || 'nothing to send'}`);
    else dbM.adminLog(on ? 'FACILITY_ON' : 'FACILITY_OFF', `${what}${res && res.mode ? ' (' + res.mode + ' ' + res.sent + '°)' : ''} | ${why || ''}`);
  });
  return 1;
}

// EACH DEVICE ON ITS OWN (maintainer, Oct 21 2026: "if a thermostat or facility tv does not turn on the bay still needs to do all its
// stuff. or if a spot light is missed then it still does everything else"). The scheduler starts this pass without waiting
// for it, so no facility device holds up a bay; inside it every device is decided and sent side by side, so one that hangs
// or refuses holds up no other; and a device whose change is still being sent is not started again by the next tick.
const inFlight = new Set();
let lastPass = Promise.resolve(0);

async function one(d, cfg, now, all) {
  if (inFlight.has(d.entity_id)) return 0;
  inFlight.add(d.entity_id);
  try {
    const { want, until, why } = decide(d, cfg, now, all);
    const row = dbM.db.prepare(`SELECT gen, want, why FROM facility_device_state WHERE entity_id=?`).get(d.entity_id);
    let gen = row ? row.gen : 0, reason = row ? row.why : '';
    if (!row) {
      // first sight: switched on when a run is under way now; otherwise left as it is until a run ends
      gen = want === 'on' ? 1 : 0; reason = why || '';
      dbM.db.prepare(`INSERT INTO facility_device_state (entity_id, gen, want, why, changed_at) VALUES (?,?,?,?,datetime('now'))`).run(d.entity_id, gen, want || '', reason);
      if (want === 'on') schedule(d, 'on', gen, until);
    } else if (want && want !== row.want) {
      gen = row.gen + 1; reason = why || '';
      dbM.db.prepare(`UPDATE facility_device_state SET gen=?, want=?, why=?, changed_at=datetime('now') WHERE entity_id=?`).run(gen, want, reason, d.entity_id);
      supersede(d.entity_id, gen);
      schedule(d, want, gen, until);
    } else if (want === 'on' && gen > 0) {
      // A RUN THAT GREW KEEPS ITS "ON" GOING (Oct 21 2026, the device audit): the on's deadline was the run's end when it was
      // made, so a booking added later did not move it - an on still being retried was written off as missed at the old end
      // and never sent again while the facility stayed on (a thermostat down at 5:45 sat at its setback all evening)
      dbM.db.prepare(`UPDATE automation_jobs SET deadline_at=?,
          next_attempt_at=CASE WHEN status='missed' THEN datetime('now') ELSE next_attempt_at END,
          status=CASE WHEN status='missed' THEN 'pending' ELSE status END
        WHERE booking_id='facility' AND kind='facility_on' AND device_key=? AND status IN ('pending','failed','missed')`)
        .run(Number.isFinite(until) ? new Date(until).toISOString().replace('T', ' ').slice(0, 19) : null, KEY(d, gen));
    }
    return gen > 0 ? await fire(d, gen, reason) : 0;
  } catch (e) { try { dbM.adminLog('AUTOMATION_ERROR', `facility device ${d.name || d.entity_id}: ${String(e.message).slice(0, 160)}`); } catch {} return 0; }
  finally { inFlight.delete(d.entity_id); }
}

// NOTHING LEFT WAITING (Oct 21 2026, the device audit): a change still waiting for a device taken off the list, or for any
// device once Home Assistant is switched off, is written off with the reason - left pending, nothing would ever claim it and
// the health line would read "overdue" for ever. (keep: the entities still listed; null lets every one go)
function letGo(keep, reason) {
  try {
    const rows = dbM.db.prepare(`SELECT id, device_key FROM automation_jobs WHERE booking_id='facility' AND status IN ('pending','failed')`).all();
    for (const r of rows) {
      const m = /^fac:(.*)#\d+$/.exec(r.device_key || '');
      if (!m || (keep && keep.includes(m[1]))) continue;
      dbM.db.prepare(`UPDATE automation_jobs SET status='skipped', last_error=?, next_attempt_at=NULL, lease_until=NULL WHERE id=? AND status IN ('pending','failed')`).run(reason, r.id);
    }
  } catch {}
}

/** One pass: every facility device brought to what the bookings (or the hours) say now. The scheduler's tick starts it and
 *  does not wait; idle() is the pass still running, for a caller (a battery, a one-shot tick) that must see it finish. */
function tick(cfg, now = new Date()) {
  cfg = cfg || getConfig();
  const devs = list(cfg);
  const ha = cfg.homeAssistant || {};
  if (!(ha.enabled && ha.url && ha.token && !String(ha.token).startsWith('PASTE'))) { letGo(null, 'Home Assistant is switched off'); return Promise.resolve(0); }   // nothing set up: nothing to do (rule 31)
  letGo(devs.map(d => d.entity_id), 'it is no longer on the facility list');
  if (!devs.length) return Promise.resolve(0);
  try { ensureSchema(); } catch (e) { return Promise.resolve(0); }
  const all = sessions(now);
  const pass = Promise.allSettled(devs.map(d => one(d, cfg, now, all)))
    .then(r => r.reduce((a, x) => a + (x.status === 'fulfilled' ? (x.value || 0) : 0), 0));
  lastPass = Promise.all([lastPass, pass]).then(([, n]) => n, () => 0);
  return pass;
}
const idle = () => lastPass;

/** What each facility device is doing and why - the admin card and the assistant read it. */
function status(cfg, now = new Date()) {
  cfg = cfg || getConfig();
  try { ensureSchema(); } catch {}
  const all = sessions(now);
  return list(cfg).map(d => {
    const t = timing(d), dec = decide(d, cfg, now, all);
    let row = null; try { row = dbM.db.prepare(`SELECT gen, want, why, changed_at FROM facility_device_state WHERE entity_id=?`).get(d.entity_id); } catch {}
    return { entity_id: d.entity_id, name: d.name || d.entity_id, kind: d.kind === 'climate' ? 'climate' : 'power', follows: d.follows === 'hours' ? 'hours' : 'bookings',
      minutes_before: t.before, keep_on_gap: t.gap, minutes_after: t.after, turns_off: t.turnsOff,
      now: dec.want === 'on' ? 'on' : dec.want === 'off' ? 'standby' : 'left as it is', why: dec.why || '', last_change: row ? row.changed_at : null };
  });
}

module.exports = { tick, idle, status, decide, list, has, timing, DEFAULTS };
