// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/routines.js - ROUTINES TAUGHT ON A BAY PC (Oct 21 2026)
//
// maintainer: "they do the clicks, and they click through and say, click here here. Here, watch this so the box will be watching
// on their computer. Knowing where they're clicking and then building out a hot key" (BA-CORE-2-AI.md section 16; the
// mock is mock-bay-routines.html). The owner clicks through a program once on a bay PC; its watcher records the clicks;
// the box keeps them as a ROUTINE the watcher runs again. maintainer, the same day: "I want it to start on windows startup, or ...
// when this program opens ... with unicorn, sometimes the device gets signed out and they need to put their password in
// and have it resign in ... if it sees the unicorn in, they could sign in ... I don't want to hinder them being able to
// build anything ... build a bay watcher that if the ... gs pro connector if the players close it, then it ... closes and
// reopens stuff". So a routine starts on any of: a hotkey, the staff pad, a session starting, Windows starting, a program
// opening, a program closing (keep it running), or a window appearing (the sign-in screen) - and its steps can close a
// program and type a password the PC keeps.
//
// A routine is DATA, never code. Three walls keep it that way:
//   1. every step is one of six kinds with bounded fields (STEP_KINDS, checkSteps) - nothing in a routine is run as code;
//   2. a routine opens only a program the owner taught ON THAT PC: the watcher keeps that list itself and refuses any
//      other, so even a box someone broke into cannot make a bay PC start something new;
//   3. the watcher reaches routines only with its own bay key, minted when its package is built (only a hash kept here,
//      the last three per bay, so a second download does not strand the watcher already installed). The public session
//      reply carries nothing of it (rules 36 and 37), and a recording the watcher sends is a DRAFT the owner saves.
// What a run did is recorded, never assumed (rule 29): a run the PC never picks up, or never reports back on, is written
// down as not done with the reason.
//
// FULL CONTROL OF THE BAYS (maintainer, Oct 21 2026, night, the mock approved: "make sure all that is ... editable with color choice
// using the AI ... go through the bay routines and DBL check they are what we want and can build what we want and have
// full control of the bays when the owner sets things up"). Added the same night: a colour for each routine's button
// (the staff pad, the card), a routine paused without removing it, "when a session ends" (the bay reset for the next
// player, before the next session's own routine), how many minutes before a session its routine runs, a routine copied to
// other bays, a routine made from words alone when it clicks nothing and opens nothing (close a program, keys, waits,
// typing, a kept password), and each PC's taught programs as it reports them - so a copied routine says which bay's PC
// still has to be shown a program, and a teaching that only shows the PC a program.
'use strict';
const crypto = require('crypto');
const dbM = require('./db');

const D = () => dbM.db;
const log = (ev, detail) => { try { dbM.adminLog(ev, String(detail).slice(0, 400)); } catch {} };

// ── the steps a watcher knows how to do ──
const KEY_NAMES = ['enter', 'tab', 'esc', 'space', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'];
const KEYS_RE = new RegExp(`^(?:(?:ctrl|alt|shift|win)\\+){0,3}(?:${KEY_NAMES.join('|')}|[a-z0-9])$`);
const LOOK_MAX = 16000;           // a small picture of what was clicked, base64 (about 12 KB)
const STEPS_MAX = 60;
const PROGRAM_RE = /^[^\0<>"|?*\r\n]{3,260}$/;
const STEP_KINDS = ['open', 'wait_window', 'click', 'type', 'key', 'wait', 'close', 'type_secret'];
// a password a routine types is never recorded, never in the chat and never on this unit: the owner types it once into a
// box on the bay PC, which keeps it under Windows' own protection (DPAPI) by this name, and the routine types it from there
const SECRET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// ── a routine's colour: its button on the staff pad and its mark on the card. Any #RRGGBB the owner picks; the card offers
//    these (the assistant's own colour names, services/assistant/colours.js), and none at all is the pad's plain button ──
const PALETTE = [['blue', '#1f5fbf'], ['green', '#2e7d32'], ['red', '#c0392b'], ['orange', '#e67e22'], ['purple', '#6a3d9a'],
  ['teal', '#1c7e67'], ['pink', '#d94f8a'], ['gold', '#c9a227'], ['navy', '#152238'], ['charcoal', '#232323']].map(([name, hex]) => ({ name, hex }));
function checkColor(c) {
  const v = str(c).toLowerCase();
  if (!v) return { ok: true, color: '' };
  if (!/^#[0-9a-f]{6}$/.test(v)) return { ok: false, error: 'a routine\'s colour is #RRGGBB, like #2e7d32' };
  return { ok: true, color: v };
}
// the words on a coloured button: white or near-black, whichever reads better on it (WCAG's relative luminance)
function textOn(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return '';
  const lin = (x) => { const c = parseInt(x, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / (0.0125 + 0.05)) ? '#ffffff' : '#111111';
}

/** Every step checked and put in its own shape; anything that is not one of the six kinds, or is out of bounds, refuses
 *  the whole routine with the step's number and what is wrong - nothing is guessed or dropped quietly. */
function checkSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return { ok: false, error: 'a routine needs at least one step' };
  if (steps.length > STEPS_MAX) return { ok: false, error: `a routine has at most ${STEPS_MAX} steps (this one has ${steps.length})` };
  const out = [];
  for (const [i, s] of steps.entries()) {
    const n = i + 1, bad = (why) => ({ ok: false, error: `step ${n}: ${why}` });
    if (!s || typeof s !== 'object' || Array.isArray(s)) return bad('is not a step');
    const kind = str(s.do);
    if (!STEP_KINDS.includes(kind)) return bad(`"${String(s.do).slice(0, 20)}" is not something a routine does (${STEP_KINDS.join(', ')})`);
    if (kind === 'open') {
      const program = str(s.program);
      if (!PROGRAM_RE.test(program)) return bad('needs the program it opens');
      const args = str(s.args);
      if (args.length > 200) return bad('its program\'s arguments are too long');
      out.push(Object.assign({ do: 'open', program }, args ? { args } : {}));
    } else if (kind === 'wait_window') {
      const title = str(s.title), seconds = num(s.seconds === undefined ? 30 : s.seconds);
      if (!title || title.length > 120) return bad('needs the window it waits for');
      if (!(seconds >= 1 && seconds <= 300)) return bad('waits 1 to 300 seconds');
      out.push({ do: 'wait_window', title, seconds: Math.round(seconds) });
    } else if (kind === 'click') {
      const window = str(s.window), x = num(s.x), y = num(s.y), button = str(s.button || 'left');
      if (!window || window.length > 120) return bad('needs the window it clicks in');
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return bad('its place in the window is out of range');
      if (!['left', 'right'].includes(button)) return bad('clicks with the left or the right button');
      const step = { do: 'click', window, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, button };
      if (s.double === true) step.double = true;
      const label = str(s.label); if (label) step.label = label.slice(0, 60);
      // BY ITS WORDS OR BY ITS SPOT (maintainer, Oct 21 2026: "do you want me to click here at these specific coordinates? Or do you
      // want me to click practice range? When it comes up"): by words, the watcher waits for those words to show in the
      // window (Windows' own text reader, on the PC) and clicks them wherever they are; by spot, the place in the window
      const by = str(s.by || (label ? 'words' : 'spot'));
      if (!['words', 'spot'].includes(by)) return bad('clicks by its words or by its spot');
      if (by === 'words' && !label) return bad('to click by its words it needs the words it clicks');
      step.by = by;
      if (by === 'words') { const w = num(s.wait === undefined ? 30 : s.wait); if (!(w >= 0 && w <= 120)) return bad('waits 0 to 120 seconds for its words'); step.wait = Math.round(w); }
      if (s.look !== undefined && s.look !== null && s.look !== '') {
        if (typeof s.look !== 'string' || s.look.length > LOOK_MAX || !/^[A-Za-z0-9+/=]+$/.test(s.look)) return bad('its picture is not a small picture');
        step.look = s.look;
      }
      out.push(step);
    } else if (kind === 'type') {
      if (typeof s.text !== 'string' || !s.text.length || s.text.length > 200 || /[\r\n\0]/.test(s.text)) return bad('types 1 to 200 characters on one line');
      out.push({ do: 'type', text: s.text });
    } else if (kind === 'key') {
      const keys = str(s.keys).toLowerCase().replace(/\s+/g, '');
      if (!KEYS_RE.test(keys)) return bad(`"${String(s.keys).slice(0, 30)}" is not a key a routine presses`);
      out.push({ do: 'key', keys });
    } else if (kind === 'wait') {
      const seconds = num(s.seconds);
      if (!(seconds >= 0.2 && seconds <= 60)) return bad('waits 0.2 to 60 seconds');
      out.push({ do: 'wait', seconds: Math.round(seconds * 10) / 10 });
    } else if (kind === 'close') {
      // a taught program closed - politely, then firmly after its seconds (the watcher closes only a program it was taught)
      const program = str(s.program), seconds = num(s.seconds === undefined ? 10 : s.seconds);
      if (!PROGRAM_RE.test(program)) return bad('needs the program it closes');
      if (!(seconds >= 1 && seconds <= 120)) return bad('gives the program 1 to 120 seconds to close');
      out.push({ do: 'close', program, seconds: Math.round(seconds) });
    } else {
      const name = str(s.name);
      if (!SECRET_NAME_RE.test(name)) return bad('needs the name the password is kept under on the bay PC');
      if ('value' in s || 'text' in s || 'password' in s) return bad('a password is never in a routine - it is typed into the bay PC once and kept there');
      out.push({ do: 'type_secret', name });
    }
  }
  return { ok: true, steps: out };
}

// ── in words, for the owner (the routines card and the assistant say each step the same way) ──
const programName = (p) => String(p).split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd)$/i, '') || p;
const keyWords = (k) => k.split('+').map(x => (x.length === 1 ? x.toUpperCase() : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Windows', esc: 'Esc', pageup: 'Page Up', pagedown: 'Page Down' }[x] || x.replace(/^f(\d+)$/, 'F$1').replace(/^./, c => c.toUpperCase()))).join(' + ');
function stepWords(s) {
  if (s.do === 'open') return `Open ${programName(s.program)}`;
  if (s.do === 'wait_window') return `Wait for the ${s.title} window (up to ${s.seconds} seconds)`;
  if (s.do === 'click') {
    const verb = s.double ? 'Double-click' : s.button === 'right' ? 'Right-click' : 'Click';
    if (s.by === 'words') return `${verb} "${s.label}" when it shows${s.wait ? ` (up to ${s.wait} seconds)` : ''}`;
    return `${verb} ${s.label ? `where "${s.label}" was` : 'the spot'} in ${s.window} (${Math.round(s.x * 100)}% across, ${Math.round(s.y * 100)}% down)`;
  }
  if (s.do === 'type') return `Type "${s.text}"`;
  if (s.do === 'close') return `Close ${programName(s.program)}`;
  if (s.do === 'type_secret') return `Type the password kept on the PC as "${s.name}"`;
  if (s.do === 'key') return `Press ${keyWords(s.keys)}`;
  return `Wait ${s.seconds} second${s.seconds === 1 ? '' : 's'}`;
}

// ── when one runs ──
// The unit starts it for: the staff pad or the owner (pad) and a session starting (session_start). The bay PC's watcher
// starts it for: its hotkey, Windows starting (startup: when the watcher starts at sign-in), a program opening
// (program_starts), a program closing (program_stops - keep it running), and a window appearing (window_appears, a title
// or part of one - the sign-in screen). A trigger on the PC fires once each time it happens, at most once a minute and
// five times an hour, so a program that keeps closing is not reopened for ever: the sixth is written down and it stops.
// Ctrl+Shift+F12 is the staff's reserved-screen key and Ctrl+Shift+F11 ends teaching (the watcher's own); never a routine's.
const RESERVED_HOTKEYS = ['ctrl+shift+f12', 'ctrl+shift+f11', 'ctrl+shift+f10', 'ctrl+shift+f9'];   // the watcher's own keys
function checkHotkey(h) {
  const k = str(h).toLowerCase().replace(/\s+/g, '');
  if (!k) return { ok: true, hotkey: '' };
  const parts = k.split('+'), key = parts[parts.length - 1], mods = parts.slice(0, -1);
  if (mods.length < 2 || new Set(mods).size !== mods.length || mods.some(m => !['ctrl', 'alt', 'shift'].includes(m))) return { ok: false, error: 'a hotkey is two of Ctrl, Alt and Shift with one more key, like Ctrl + Alt + 1' };
  if (!/^(?:[a-z0-9]|f(?:[1-9]|1[0-2]))$/.test(key)) return { ok: false, error: 'a hotkey ends with a letter, a number or F1 to F12' };
  const norm = ['ctrl', 'alt', 'shift'].filter(m => mods.includes(m)).concat(key).join('+');
  if (RESERVED_HOTKEYS.includes(norm)) return { ok: false, error: `${keyWords(norm)} is the watcher's own key` };
  return { ok: true, hotkey: norm };
}
const EXE_RE = /^[A-Za-z0-9 ._()+-]{1,80}\.exe$/i;
/** A routine's triggers, each checked; anything else is refused by name. */
function checkTriggers(t) {
  const x = t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  const known = ['pad', 'session_start', 'session_lead', 'session_end', 'at_times', 'hotkey', 'startup', 'program_starts', 'program_stops', 'window_appears'];
  const unknown = Object.keys(x).filter(k => !known.includes(k));
  if (unknown.length) return { ok: false, error: `"${unknown[0]}" is not something that starts a routine` };
  const out = { pad: x.pad !== false };
  if (x.session_start === true) out.session_start = true;
  // how many minutes before each session its routine runs (left out: five - the PC woken by then)
  if (x.session_lead !== undefined && x.session_lead !== null && x.session_lead !== '') {
    const m = num(x.session_lead);
    if (!(Number.isInteger(m) && m >= 0 && m <= 30)) return { ok: false, error: 'a routine runs 0 to 30 minutes before each session' };
    if (out.session_start) out.session_lead = m;
  }
  // when each session ends - the bay set back for the next player (run before the next session's own routine)
  if (x.session_end === true) out.session_end = true;
  // EVERY DAY AT a time of day (Oct 21 2026, night: "restart GSPro every day at 3 AM", the programs up at opening) - up to
  // six, each "9:00", "21:30" or "9 PM", kept as 24-hour HH:MM
  if (x.at_times !== undefined && x.at_times !== null && x.at_times !== '') {
    const list = (Array.isArray(x.at_times) ? x.at_times : String(x.at_times).split(',')).map(v => String(v).trim()).filter(Boolean);
    const out24 = [];
    for (const v of list) {
      const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?$/i.exec(v) || /^(\d{1,2}):(\d{2})$/.exec(v);
      if (!m) return { ok: false, error: `"${v}" is not a time of day - say it like 9:00, 21:30 or 9 PM` };
      let h = Number(m[1]); const mi = Number(m[2] || 0), ap = m[3] ? m[3].toLowerCase() : '';
      if (ap) { if (h < 1 || h > 12) return { ok: false, error: `"${v}" is not a time of day` }; h = (h % 12) + (ap === 'p' ? 12 : 0); }
      if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return { ok: false, error: `"${v}" is not a time of day` };
      const t = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
      if (!out24.includes(t)) out24.push(t);
    }
    if (out24.length > 6) return { ok: false, error: 'a routine runs at up to six times a day' };
    if (out24.length) out.at_times = out24.sort();
  }
  if (x.startup === true) out.startup = true;
  if (x.hotkey) { const h = checkHotkey(x.hotkey); if (!h.ok) return h; out.hotkey = h.hotkey; }
  for (const k of ['program_starts', 'program_stops']) if (x[k]) {
    // the program's own file name, from a whole path or the name alone ("GSPro", "C:\GSPro\GSPro.exe" -> "GSPro.exe")
    const last = str(x[k]).split(/[\\/]/).pop();
    const name = /\.exe$/i.test(last) ? last : last + '.exe';
    if (!EXE_RE.test(name)) return { ok: false, error: `${k === 'program_starts' ? 'when a program opens' : 'when a program closes'} needs the program's name, like GSPro.exe` };
    out[k] = name;
  }
  if (x.window_appears) { const w = str(x.window_appears); if (w.length < 3 || w.length > 80) return { ok: false, error: 'a window to watch for is named by 3 to 80 letters of its title' }; out.window_appears = w; }
  return { ok: true, triggers: out };
}
const h12 = (hm) => { const [h, m] = String(hm).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
function triggerWords(t) {
  t = t || {};
  const lead = t.session_lead === undefined ? SESSION_LEAD_MINS : t.session_lead;
  return [t.session_start ? (t.session_lead === undefined ? 'when a session starts' : lead === 0 ? 'right as each session starts' : `${lead} minute${lead === 1 ? '' : 's'} before each session`) : null,
    t.session_end ? 'when a session ends' : null,
    Array.isArray(t.at_times) && t.at_times.length ? `every day at ${t.at_times.map(h12).join(' and ')}` : null, t.startup ? 'when Windows starts' : null, t.program_starts ? `when ${programName(t.program_starts)} opens` : null,
    t.program_stops ? `when ${programName(t.program_stops)} closes (keeps it running)` : null, t.window_appears ? `when a "${t.window_appears}" window appears` : null,
    t.hotkey ? keyWords(t.hotkey) : null, t.pad ? 'the staff pad' : null].filter(Boolean);
}

// ── the tables (rule 14: added, never changed) ──
let schemaDone = false;
function ensureSchema() {
  if (schemaDone && D()) return;
  D().exec(`CREATE TABLE IF NOT EXISTS bay_routines (
    id TEXT PRIMARY KEY, bay_id TEXT NOT NULL, name TEXT NOT NULL, steps TEXT NOT NULL, triggers TEXT NOT NULL DEFAULT '{"pad":true}',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    last_run_at TEXT, last_ok INTEGER, last_detail TEXT DEFAULT '')`);
  D().exec(`CREATE TABLE IF NOT EXISTS routine_runs (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL, bay_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', booking_id TEXT,
    requested_at TEXT DEFAULT (datetime('now')), expires_at TEXT, claimed_at TEXT, finished_at TEXT,
    ok INTEGER, failed_step INTEGER, detail TEXT DEFAULT '')`);
  D().exec(`CREATE TABLE IF NOT EXISTS routine_teach (
    bay_id TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, started_at TEXT DEFAULT (datetime('now')),
    steps TEXT, received_at TEXT)`);
  D().exec(`CREATE TABLE IF NOT EXISTS watcher_keys (
    bay_id TEXT NOT NULL, key_hash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);
  // (Oct 21 2026, night) a colour and a pause switch on each routine; a teaching that only shows the PC a program; what each
  // PC says it was taught; a session's start and its end each asked once (the source is part of what makes it once)
  try { D().exec(`ALTER TABLE bay_routines ADD COLUMN color TEXT DEFAULT ''`); } catch {}
  try { D().exec(`ALTER TABLE bay_routines ADD COLUMN enabled INTEGER DEFAULT 1`); } catch {}
  try { D().exec(`ALTER TABLE routine_teach ADD COLUMN program TEXT DEFAULT ''`); } catch {}
  // when each bay's watcher last asked, and the programs it says it was shown (NULL: a watcher too old to say)
  D().exec(`CREATE TABLE IF NOT EXISTS routine_pc (bay_id TEXT PRIMARY KEY, taught TEXT, seen_at TEXT)`);
  // a time of day's run, once a day: its day and time ("2026-10-21 03:00") - kept apart from booking_id, which is a booking's
  try { D().exec(`ALTER TABLE routine_runs ADD COLUMN slot TEXT`); } catch {}
  try { D().exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_run_slot ON routine_runs (routine_id, slot) WHERE slot IS NOT NULL`); } catch {}
  try { D().exec(`DROP INDEX IF EXISTS idx_routine_run_booking`); } catch {}
  try { D().exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_run_moment ON routine_runs (routine_id, booking_id, source) WHERE booking_id IS NOT NULL`); } catch {}
  schemaDone = true;
}
const newId = (p) => p + crypto.randomBytes(6).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const rowOut = (r) => r && { id: r.id, bay_id: r.bay_id, name: r.name, steps: parse(r.steps || '[]', []), triggers: parse(r.triggers || '{}', {}),
  color: r.color || '', enabled: r.enabled === null || r.enabled === undefined ? true : !!r.enabled,
  created_at: r.created_at, updated_at: r.updated_at, last_run_at: r.last_run_at || null, last_ok: r.last_ok === null || r.last_ok === undefined ? null : !!r.last_ok, last_detail: r.last_detail || '' };

// ── the bay key: minted when the watcher's package is built, only its hash kept, the newest three accepted ──
function mintKey(bayId) {
  ensureSchema();
  const key = crypto.randomBytes(24).toString('base64url');
  D().prepare(`INSERT INTO watcher_keys (bay_id, key_hash) VALUES (?, ?)`).run(String(bayId), sha(key));
  const keep = D().prepare(`SELECT rowid FROM watcher_keys WHERE bay_id=? ORDER BY rowid DESC LIMIT 3`).all(String(bayId)).map(r => r.rowid);
  if (keep.length) D().prepare(`DELETE FROM watcher_keys WHERE bay_id=? AND rowid NOT IN (${keep.map(() => '?').join(',')})`).run(String(bayId), ...keep);
  return key;
}
function keyOk(bayId, key) {
  if (!bayId || typeof key !== 'string' || key.length < 16 || key.length > 200) return false;
  ensureSchema();
  const h = Buffer.from(sha(key), 'hex');
  return D().prepare(`SELECT key_hash FROM watcher_keys WHERE bay_id=?`).all(String(bayId)).some(r => { const k = Buffer.from(String(r.key_hash), 'hex'); return k.length === h.length && crypto.timingSafeEqual(k, h); });
}

// ── the routines ──
function list(bayId) { ensureSchema(); return D().prepare(`SELECT * FROM bay_routines ${bayId ? 'WHERE bay_id=?' : ''} ORDER BY bay_id, created_at`).all(...(bayId ? [String(bayId)] : [])).map(rowOut); }
function get(id) { ensureSchema(); return rowOut(D().prepare(`SELECT * FROM bay_routines WHERE id=?`).get(String(id))); }
/** A routine saved: new, or changed in place (its id kept). Its name is unique on its bay, its hotkey on its bay. A colour
 *  or the pause switch left out keeps what it had (a new one: no colour, running). */
function save({ id, bay_id, name, steps, triggers, color, enabled }) {
  ensureSchema();
  const n = str(name).slice(0, 40);
  if (!bay_id) throw new Error('a routine belongs to a bay');
  if (!n) throw new Error('a routine needs a name');
  const c = checkSteps(steps); if (!c.ok) throw new Error(c.error);
  const tg = checkTriggers(triggers); if (!tg.ok) throw new Error(tg.error);
  const t = tg.triggers;
  const cur = id ? get(id) : null;
  const col = checkColor(color === undefined ? (cur ? cur.color : '') : color); if (!col.ok) throw new Error(col.error);
  const on = enabled === undefined ? (cur ? cur.enabled : true) : enabled !== false;
  const others = list(bay_id).filter(r => r.id !== id);
  if (others.some(r => r.name.toLowerCase() === n.toLowerCase())) throw new Error(`this bay already has a routine called "${n}"`);
  if (t.hotkey && others.some(r => r.triggers.hotkey === t.hotkey)) throw new Error(`${keyWords(t.hotkey)} already runs "${others.find(r => r.triggers.hotkey === t.hotkey).name}" on this bay`);
  const rid = id || newId('rt_');
  if (cur) D().prepare(`UPDATE bay_routines SET name=?, steps=?, triggers=?, color=?, enabled=?, updated_at=datetime('now') WHERE id=?`).run(n, JSON.stringify(c.steps), JSON.stringify(t), col.color, on ? 1 : 0, id);
  else D().prepare(`INSERT INTO bay_routines (id, bay_id, name, steps, triggers, color, enabled) VALUES (?,?,?,?,?,?,?)`).run(rid, String(bay_id), n, JSON.stringify(c.steps), JSON.stringify(t), col.color, on ? 1 : 0);
  const when = triggerWords(t);
  log('ROUTINE_SAVED', `${n} on ${bay_id}: ${c.steps.length} step${c.steps.length === 1 ? '' : 's'}${when.length ? ' - ' + when.join(', ') : ''}${on ? '' : ' (paused)'}`);
  return get(rid);
}
// a click or a program to open is shown on the PC, never typed in: only the PC's own recording carries one
const TAUGHT_ONLY = ['click', 'open'];
/** A routine made from words alone (maintainer: "can build what we want"): no clicks and no program opened - those are taught on the
 *  PC - so it closes a taught program, presses keys, waits, waits for a window, types, or types a kept password. */
function create({ bay_id, name, steps, triggers, color }) {
  if (Array.isArray(steps) && steps.some(st => st && TAUGHT_ONLY.includes(str(st.do)))) throw new Error('a click or a program to open is shown on the bay PC once (teach it there) - never typed in');
  return save({ bay_id, name, steps, triggers: triggers || { pad: true }, color });
}
/** A routine copied onto other bays: the same steps (each click where it was in its window, by its words or its spot), when
 *  it runs and its colour. A bay that already has one by that name keeps it unless `replace`; a hotkey another routine on
 *  that bay already uses is refused for that bay alone. Each bay says how it went, and which programs its PC has still to
 *  be shown (as far as that PC has said - pcOf). */
function copyTo(id, bayIds, opts = {}) {
  ensureSchema();
  const r = get(id); if (!r) throw new Error('no such routine');
  const out = [];
  for (const bayId of [...new Set((bayIds || []).map(String))]) {
    if (bayId === r.bay_id) continue;
    try {
      const same = list(bayId).find(x => x.name.toLowerCase() === r.name.toLowerCase());
      if (same && !opts.replace) { out.push({ bay_id: bayId, ok: false, error: `it already has a routine called "${r.name}" - say to replace it` }); continue; }
      const saved = save({ id: same ? same.id : undefined, bay_id: bayId, name: r.name, steps: r.steps, triggers: r.triggers, color: r.color, enabled: r.enabled });
      out.push({ bay_id: bayId, ok: true, id: saved.id, replaced: !!same, needs: needsOf(saved, pcOf(bayId)) });
    } catch (e) { out.push({ bay_id: bayId, ok: false, error: e.message }); }
  }
  log('ROUTINE_COPIED', `${r.name} from ${r.bay_id} to ${out.filter(x => x.ok).map(x => x.bay_id).join(', ') || 'no bay'}`);
  return out;
}

// ── what each PC says it was taught (its own list - the unit can never add to it; the watcher reports it on its poll) ──
const BASE_RE = /^[A-Za-z0-9 ._()+-]{1,80}\.exe$/i;
function notePc(bayId, taught) {
  ensureSchema();
  if (!Array.isArray(taught)) {
    // a watcher that does not say what it was shown (built before Oct 21 2026, night): only that it asked, and when
    D().prepare(`INSERT INTO routine_pc (bay_id, taught, seen_at) VALUES (?, NULL, datetime('now')) ON CONFLICT(bay_id) DO UPDATE SET seen_at=excluded.seen_at`).run(String(bayId));
    return;
  }
  // each name as the PC said it (GSPro.exe), once whatever its case; compared without case (needsOf)
  const seen = new Set(), names = [];
  for (const n of taught.map(p => String(p).split(/[\\/]/).pop()).filter(n => BASE_RE.test(n))) { if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); names.push(n); } }
  names.splice(60);
  D().prepare(`INSERT INTO routine_pc (bay_id, taught, seen_at) VALUES (?, ?, datetime('now')) ON CONFLICT(bay_id) DO UPDATE SET taught=excluded.taught, seen_at=excluded.seen_at`).run(String(bayId), JSON.stringify(names));
}
/** When a bay's watcher last asked, and the programs it said it was shown (taught null: it does not say); null when no
 *  watcher has ever asked for this bay's routines. */
function pcOf(bayId) {
  ensureSchema();
  const r = D().prepare(`SELECT * FROM routine_pc WHERE bay_id=?`).get(String(bayId));
  return r ? { taught: r.taught === null || r.taught === undefined ? null : parse(r.taught, []), seen_at: r.seen_at } : null;
}
/** The programs a routine opens or closes that its bay's PC has not said it was taught - [] when it has, or has never said. */
function needsOf(routine, pc) {
  if (!routine || !pc || !Array.isArray(pc.taught)) return [];
  const want = [...new Set((routine.steps || []).filter(st => st.do === 'open' || st.do === 'close').map(st => String(st.program).split(/[\\/]/).pop()))];
  const have = new Set(pc.taught.map(n => String(n).toLowerCase()));
  return want.filter(n => !have.has(n.toLowerCase()));
}
function remove(id) {
  ensureSchema();
  const r = get(id); if (!r) return false;
  D().prepare(`DELETE FROM bay_routines WHERE id=?`).run(String(id));
  D().prepare(`UPDATE routine_runs SET finished_at=datetime('now'), ok=0, detail='the routine was removed' WHERE routine_id=? AND finished_at IS NULL`).run(String(id));
  log('ROUTINE_REMOVED', `${r.name} on ${r.bay_id}`);
  return true;
}

// ── teaching: one at a time per bay; what the watcher sends back is a draft until the owner saves it ──
const TEACH_MINS = 30;
function teachStart(bayId, name, opts = {}) {
  ensureSchema();
  // SHOWING THE PC A PROGRAM (a routine copied from another bay opens one this PC was never shown): the bar on the PC says
  // what to do, the program opened while it is up joins the PC's own list, and the steps that come back are not kept
  const program = opts.program ? programName(str(opts.program)).slice(0, 60) : '';
  const n = program ? `Close ${program} if it is open, open it once, then Ctrl+Shift+F11`.slice(0, 80) : (str(name).slice(0, 40) || 'New routine');
  const id = newId('tc_');
  D().prepare(`INSERT OR REPLACE INTO routine_teach (bay_id, id, name, started_at, steps, received_at, program) VALUES (?,?,?,datetime('now'),NULL,NULL,?)`).run(String(bayId), id, n, program);
  log('ROUTINE_TEACH', program ? `showing ${bayId}'s PC ${program}` : `teaching "${n}" on ${bayId}`);
  return { id, bay_id: String(bayId), name: n, program: program || undefined };
}
/** The teaching for a bay: waiting for the watcher (asked within the last 30 minutes, nothing back yet), back (a draft),
 *  or none. A teaching nobody finished is forgotten after 30 minutes. */
function teachState(bayId) {
  ensureSchema();
  const r = D().prepare(`SELECT *, (started_at < datetime('now', ?)) AS stale FROM routine_teach WHERE bay_id=?`).get(`-${TEACH_MINS} minutes`, String(bayId));
  if (!r) return null;
  if (r.steps) { let steps = []; try { steps = JSON.parse(r.steps); } catch {} return { id: r.id, name: r.name, state: 'draft', steps, received_at: r.received_at }; }
  if (r.stale) return null;
  return Object.assign({ id: r.id, name: r.name, state: 'waiting', started_at: r.started_at }, r.program ? { program: r.program } : {});
}
function teachReceive(bayId, teachId, steps, cancelled) {
  ensureSchema();
  const r = D().prepare(`SELECT * FROM routine_teach WHERE bay_id=? AND id=?`).get(String(bayId), String(teachId || ''));
  if (!r) return { ok: false, error: 'no teaching is waiting on this bay - start one from the routines card or the assistant' };
  if (r.steps) return { ok: false, error: 'this teaching was already received' };
  // stopped on the PC (Ctrl+Shift+F10, or nothing done): the unit stops waiting for it - it is never asked again
  if (cancelled === true) { D().prepare(`DELETE FROM routine_teach WHERE bay_id=? AND id=?`).run(String(bayId), r.id); log('ROUTINE_TEACH_STOPPED', `"${r.name}" on ${bayId}: stopped on the bay PC, nothing kept`); return { ok: true, stopped: true }; }
  const c = checkSteps(steps); if (!c.ok) return { ok: false, error: c.error };
  if (r.program) {
    // only showing the PC a program: what it opened is on its own list now; the steps are not kept
    const opened = c.steps.filter(st => st.do === 'open').map(st => programName(st.program));
    D().prepare(`DELETE FROM routine_teach WHERE bay_id=? AND id=?`).run(String(bayId), r.id);
    log('ROUTINE_PROGRAM_SHOWN', `${bayId}'s PC: ${opened.length ? opened.join(', ') + ' opened while the bar was up' : `nothing was opened - ${r.program} is not on its list yet`}`);
    return { ok: true, program: true, opened, say: opened.length ? `Taught on this PC: ${opened.join(', ')}` : `Nothing was opened - close ${r.program}, then show it again` };
  }
  D().prepare(`UPDATE routine_teach SET steps=?, received_at=datetime('now') WHERE bay_id=? AND id=?`).run(JSON.stringify(c.steps), String(bayId), String(teachId));
  log('ROUTINE_TAUGHT', `"${r.name}" on ${bayId}: ${c.steps.length} step${c.steps.length === 1 ? '' : 's'} back from the bay PC`);
  return { ok: true, steps: c.steps };
}
function teachCancel(bayId) { ensureSchema(); D().prepare(`DELETE FROM routine_teach WHERE bay_id=?`).run(String(bayId)); }
/** The draft saved as a routine (or onto one, by id, to teach it again); the teaching is done. */
function teachSave(bayId, opts = {}) {
  const t = teachState(bayId);
  if (!t || t.state !== 'draft') throw new Error('no taught steps are waiting on this bay');
  const saved = save({ id: opts.id, bay_id: bayId, name: opts.name || t.name, steps: t.steps, triggers: opts.triggers, color: opts.color });
  teachCancel(bayId);
  return saved;
}

// ── runs: asked for (the staff pad, the owner, a session starting), picked up by the watcher, reported back ──
const CLAIM_MINS = 10;           // picked up and never reported: not done
function requestRun(routineId, source, opts = {}) {
  ensureSchema();
  const r = get(routineId); if (!r) throw new Error('no such routine');
  // one waiting at a time: asking again while one waits is the same run
  const waiting = D().prepare(`SELECT id FROM routine_runs WHERE routine_id=? AND finished_at IS NULL`).get(r.id);
  if (waiting) return { id: waiting.id, already: true };
  const id = newId('run_');
  try {
    D().prepare(`INSERT INTO routine_runs (id, routine_id, bay_id, source, booking_id, expires_at, slot) VALUES (?,?,?,?,?,?,?)`)
      .run(id, r.id, r.bay_id, String(source || '').slice(0, 40), opts.booking_id || null, opts.expires_at || null, opts.slot || null);
  } catch (e) {
    if ((opts.booking_id || opts.slot) && /UNIQUE/i.test(e.message)) return { id: null, already: true };   // this session's (or this day's) run was asked for already
    throw e;
  }
  return { id, already: false };
}
function finish(runId, ok, detail, failedStep) {
  const run = D().prepare(`SELECT * FROM routine_runs WHERE id=?`).get(String(runId));
  if (!run || run.finished_at) return false;
  D().prepare(`UPDATE routine_runs SET finished_at=datetime('now'), ok=?, failed_step=?, detail=? WHERE id=?`).run(ok ? 1 : 0, failedStep || null, String(detail || '').slice(0, 300), run.id);
  D().prepare(`UPDATE bay_routines SET last_run_at=datetime('now'), last_ok=?, last_detail=? WHERE id=?`).run(ok ? 1 : 0, String(detail || '').slice(0, 300), run.routine_id);
  const r = get(run.routine_id);
  log(ok ? 'ROUTINE_RAN' : 'ROUTINE_FAILED', `${r ? r.name : run.routine_id} on ${run.bay_id} (${run.source})${detail ? ': ' + detail : ''}`);
  return true;
}
/** Runs nobody will finish, written down as not done (rule 29): asked and never picked up before they expire, or picked
 *  up and never reported within ten minutes. Called by every watcher poll and by the scheduler's tick. */
function settleStale() {
  ensureSchema();
  const now = "datetime('now')";
  for (const r of D().prepare(`SELECT id FROM routine_runs WHERE finished_at IS NULL AND claimed_at IS NULL AND expires_at IS NOT NULL AND expires_at < ${now}`).all())
    finish(r.id, false, 'the bay PC did not pick it up in time - is it on, with its watcher running?');
  for (const r of D().prepare(`SELECT id FROM routine_runs WHERE finished_at IS NULL AND claimed_at IS NOT NULL AND claimed_at < datetime('now', ?)`).all(`-${CLAIM_MINS} minutes`))
    finish(r.id, false, 'the bay PC started it and never said how it went');
}

/** What a bay's watcher is told when it asks with its key: the teaching waiting for it, its routines (with their
 *  hotkeys), and the oldest run waiting - claimed by this answer, so a second watcher or a second poll never runs it twice. */
function watcherPoll(bayId, taught) {
  ensureSchema();
  settleStale();
  try { notePc(bayId, taught); } catch {}
  const t = teachState(bayId);
  const pcSide = (t) => { const o = {}; for (const k of ['hotkey', 'startup', 'program_starts', 'program_stops', 'window_appears']) if (t[k]) o[k] = t[k]; return o; };
  // a paused routine is not sent, so none of the PC's own triggers starts it; one the unit asks for still comes with its steps
  const routines = list(bayId).filter(r => r.enabled || D().prepare(`SELECT 1 FROM routine_runs WHERE routine_id=? AND finished_at IS NULL`).get(r.id))
    .map(r => ({ id: r.id, name: r.name, steps: r.steps, triggers: r.enabled ? pcSide(r.triggers) : {} }));
  const w = D().prepare(`SELECT * FROM routine_runs WHERE bay_id=? AND finished_at IS NULL AND claimed_at IS NULL ORDER BY requested_at, rowid LIMIT 1`).get(String(bayId));
  let run = null;
  if (w) { D().prepare(`UPDATE routine_runs SET claimed_at=datetime('now') WHERE id=? AND claimed_at IS NULL`).run(w.id); run = { id: w.id, routine_id: w.routine_id }; }
  return { teach: t && t.state === 'waiting' ? Object.assign({ id: t.id, name: t.name }, t.program ? { program: t.program } : {}) : null, routines, run };
}
const PC_SOURCES = { hotkey: 'its hotkey', startup: 'Windows starting', program_starts: 'a program opening', program_stops: 'a program closing', window_appears: 'a window appearing', limit: 'the PC' };
function runResult(bayId, runId, res = {}) {
  ensureSchema();
  // started by the PC itself: no run was asked for here, so it is written down now, already finished
  if (!runId && res.routine_id) {
    const r = get(res.routine_id);
    if (!r || r.bay_id !== String(bayId)) return { ok: false, error: 'no such routine on this bay' };
    const id = newId('run_');
    D().prepare(`INSERT INTO routine_runs (id, routine_id, bay_id, source, claimed_at) VALUES (?,?,?,?,datetime('now'))`).run(id, r.id, r.bay_id, PC_SOURCES[res.source] ? res.source : 'pc');
    runId = id;
  }
  const run = D().prepare(`SELECT * FROM routine_runs WHERE id=? AND bay_id=?`).get(String(runId || ''), String(bayId));
  if (!run) return { ok: false, error: 'no such run on this bay' };
  if (run.finished_at) return { ok: true, already: true };
  const ok = res.ok === true;
  const step = Number.isInteger(res.failed_step) && res.failed_step > 0 ? res.failed_step : null;
  finish(run.id, ok, ok ? (res.detail ? String(res.detail) : 'all steps done') : `${step ? `step ${step}: ` : ''}${String(res.detail || 'it stopped').slice(0, 260)}`, step);
  return { ok: true };
}
// WHEN A SESSION STARTS, AND WHEN IT ENDS: each asked once per session and bay (the unique index on routine, booking and
// source keeps it once across ticks and restarts). A start is asked from its lead before the start (five minutes unless the
// owner said; the PC woken by then) until the session ends; an end from the end until fifteen minutes after it. Back to
// back on one bay, the session ending is asked BEFORE the next session's start, so the bay is set back for the next player
// first and their own routine runs after it (the watcher takes the oldest asked first). A run its PC never picks up is
// written down as not done once its time is over (settleStale). Called by the scheduler's tick.
const SESSION_LEAD_MINS = 5;
const END_WINDOW_MINS = 15;
const utc = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
function sessionTriggers(cfg, now = new Date()) {
  ensureSchema();
  // a run whose time is over is written down first, so it never holds back the next session's own run (one waits at a time)
  settleStale();
  const all = list().filter(r => r.enabled && r.triggers);
  const starts = all.filter(r => r.triggers.session_start), ends = all.filter(r => r.triggers.session_end);
  if (!starts.length && !ends.length) return 0;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = ymd(now), yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12)), tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12));
  const rows = D().prepare(`SELECT * FROM bookings WHERE status='active' AND date IN (?, ?, ?)`).all(yesterday, today, tomorrow);
  const baysOf = (b) => { try { return require('./bookingcore').baysToDrive(b).map(x => x.id); } catch { return [b.bay_id]; } };
  const span = (b) => ({ start: new Date(`${b.date}T${b.start_time}:00`), end: new Date(`${b.end_date || b.date}T${b.end_time}:00`) });
  const sessions = rows.map(b => Object.assign(span(b), { b, bays: baysOf(b) })).filter(x => !isNaN(x.start) && !isNaN(x.end));
  const t = now.getTime();
  let asked = 0;
  // the ends first: a bay set back for the next player before that player's own routine is asked for
  for (const x of sessions) {
    if (!(x.end.getTime() <= t && t < x.end.getTime() + END_WINDOW_MINS * 60000)) continue;
    for (const r of ends) {
      if (!x.bays.includes(r.bay_id)) continue;
      try { const got = requestRun(r.id, 'session end', { booking_id: x.b.id, expires_at: utc(new Date(x.end.getTime() + END_WINDOW_MINS * 60000)) }); if (!got.already) asked++; } catch {}
    }
  }
  for (const x of sessions) {
    for (const r of starts) {
      if (!x.bays.includes(r.bay_id)) continue;
      const lead = r.triggers.session_lead === undefined ? SESSION_LEAD_MINS : r.triggers.session_lead;
      if (!(x.start.getTime() - lead * 60000 <= t && t < x.end.getTime())) continue;
      // back to back: a session on this bay still running, whose end has a routine of its own, goes first
      const before = sessions.find(y => y !== x && y.bays.includes(r.bay_id) && y.end.getTime() > t && y.start.getTime() < x.start.getTime() && y.end.getTime() <= x.start.getTime());
      if (before && ends.some(e => e.bay_id === r.bay_id)) continue;
      try { const got = requestRun(r.id, 'session start', { booking_id: x.b.id, expires_at: utc(x.end) }); if (!got.already) asked++; } catch {}
    }
  }
  return asked;
}
const sessionStarts = sessionTriggers;   // the name the scheduler first called it by
// EVERY DAY AT: asked once a day for each time (the slot keeps it once across ticks and restarts), from that time until half
// an hour after it - a unit that was down at 3:00 and back by 3:20 still runs it; one back at 4:00 does not
const AT_WINDOW_MINS = 30;
function timeTriggers(now = new Date()) {
  ensureSchema();
  const want = list().filter(r => r.enabled && r.triggers && Array.isArray(r.triggers.at_times) && r.triggers.at_times.length);
  let asked = 0;
  for (const r of want) for (const hm of r.triggers.at_times) {
    const [h, m] = hm.split(':').map(Number);
    // today's and yesterday's time (a 23:50 run still asked at 00:10)
    for (const back of [0, 1]) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m, 0, 0);
      if (!(at.getTime() <= now.getTime() && now.getTime() < at.getTime() + AT_WINDOW_MINS * 60000)) continue;
      const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
      try { const got = requestRun(r.id, 'time of day', { slot: `${day} ${hm}`, expires_at: utc(new Date(at.getTime() + AT_WINDOW_MINS * 60000)) }); if (!got.already) asked++; } catch {}
    }
  }
  return asked;
}
/** The scheduler's one call each minute: the sessions' starts and ends, then the times of day. */
function tick(cfg, now = new Date()) { return sessionTriggers(cfg, now) + timeTriggers(now); }

function runsOf(routineId, limit = 5) { ensureSchema(); return D().prepare(`SELECT * FROM routine_runs WHERE routine_id=? ORDER BY requested_at DESC, rowid DESC LIMIT ?`).all(String(routineId), limit); }

module.exports = { checkSteps, stepWords, checkHotkey, checkTriggers, triggerWords, keyWords, programName, ensureSchema, mintKey, keyOk, list, get, save, remove,
  create, copyTo, notePc, pcOf, needsOf, checkColor, textOn, PALETTE, TAUGHT_ONLY,
  teachStart, teachState, teachReceive, teachCancel, teachSave, requestRun, runResult, watcherPoll, settleStale, runsOf, sessionStarts, sessionTriggers, timeTriggers, tick, SESSION_LEAD_MINS, END_WINDOW_MINS, AT_WINDOW_MINS,
  STEP_KINDS, STEPS_MAX, LOOK_MAX, RESERVED_HOTKEYS, TEACH_MINS, CLAIM_MINS };
