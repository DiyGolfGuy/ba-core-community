// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/spelling.js - THE OWNER'S SLIPS MENDED (Oct 23 2026)
//
// maintainer, Oct 23 2026: "Use how I chat and typo as a worst case scenario". The laptop's 4B scored the owner's requests typed the way he
// texts - all lower case, his shorthand, one slip of the fingers in a longer word - and fell from 121 to 93 of 126: "turn on the
// vault" was answered "there is no vault" (the bay is The Vault), and "whats booekd tmrw", "who is worikng this weekend" and "how
// many mebmers" reached the model, and the box's own readings, as words nobody knows. So before anything reads them:
//   - the facility's own names go back to their own case ("the vault" -> "The Vault", "mike ross" -> "Mike Ross");
//   - a slipped word is mended when exactly one word the box knows is one slip away: two letters next to each other swapped
//     ("booekd" -> "booked", "frdiay" -> "friday") or one letter left out ("insted" -> "instead").
// The words the box knows are its own: the owner's guide, the playbooks, the screens, every action's own description, the
// owner's shorthand, the days and months, and the facility's names. Nothing is touched that is a real English word (words-en.txt,
// from SCOWL by way of Ubuntu's wamerican - "waist" was once made "waits"; its notice is in words-en.COPYRIGHT.txt), a word the box
// knows, has a capital or a digit in it (a name the owner capitalised, a code, a time), is shorter than four letters, starts with
// a different letter, would be a plural or a singular of what was typed, or is one slip from more than one word with nothing to
// choose between them.
'use strict';
const fs = require('fs');
const path = require('path');

// what an owner texts that is no slip (engine.plainShort reads them after this)
const SHORTHAND = ['tmrw', 'tmrow', 'tonite', 'tdy', 'wk', 'wks', 'hrs', 'mins', 'pls', 'plz', 'thx', 'goin', 'doin', 'playin', 'workin', 'bookin',
  'tht', 'wat', 'whats', 'whos', 'thats', 'theres', 'dont', 'cant', 'wont', 'didnt', 'doesnt', 'isnt', 'arent', 'lets', 'gonna', 'wanna', 'gotta',
  'yeah', 'yep', 'nope', 'okay', 'sesh', 'nite',
  // (the days and months: "sunday" is in the guide once - "add an open shift snuday" was left as it was)
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays',
  'saturdays', 'sundays', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
let ENGLISH = null;
/** The real English words (four letters or more): never mended. */
function english() {
  if (ENGLISH) return ENGLISH;
  try { ENGLISH = new Set(fs.readFileSync(path.join(__dirname, 'words-en.txt'), 'utf8').split('\n').filter(Boolean)); } catch { ENGLISH = new Set(); }
  return ENGLISH;
}
let KNOWN = null;
function count(text, into) { for (const w of String(text || '').toLowerCase().match(/[a-z]+/g) || []) into.set(w, (into.get(w) || 0) + 1); }
/** The words the box knows, with how often each is used (built once, from the tree). */
function known() {
  if (KNOWN) return KNOWN;
  const m = new Map(), read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  count(read(path.join(__dirname, '..', '..', 'docs', 'customer-guides-current', 'EVERYTHING-ASK-YOUR-AI.md')), m);
  for (const dir of ['playbooks', 'screens']) { try { for (const f of fs.readdirSync(path.join(__dirname, dir))) if (/\.md$/.test(f)) count(read(path.join(__dirname, dir, f)), m); } catch {} }
  try { for (const [n, a] of require('./actions').BY_NAME) { count(n.replace(/_/g, ' '), m); count(a.say, m); count(JSON.stringify(a.params || {}), m); } } catch {}
  for (const w of SHORTHAND) m.set(w, (m.get(w) || 0) + 2);
  KNOWN = m;
  return m;
}
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** One lower-case word: itself, or the one known word a slip away. */
function mendWord(w, K, theirs) {
  // (a word the box's own text uses once is no proof it is a word: the guide quotes slips as examples - "booekd", "frdiay" - and
  // they were taken for words; a real one is in the English list)
  if ((K.get(w) || 0) >= 2 || theirs.has(w) || english().has(w)) return w;
  const ok = (c) => c !== w && c[0] === w[0] && (K.get(c) || 0) >= 2 && c !== w + 's' && c + 's' !== w && c !== w + 'es';
  const swaps = new Set();
  for (let i = 1; i < w.length - 1; i++) { const c = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2); if (ok(c)) swaps.add(c); }
  if (swaps.size) return swaps.size === 1 ? [...swaps][0] : w;
  if (w.length < 5) return w;
  const drops = new Set();
  for (let i = 1; i <= w.length; i++) for (const ch of LETTERS) { const c = w.slice(0, i) + ch + w.slice(i); if (ok(c)) drops.add(c); }
  return drops.size === 1 ? [...drops][0] : w;
}

/**
 * The owner's words with the facility's own names in their own case and the slips mended.
 * names: { bays, staff, tiers, menu, members } - lists of names (engine.facilityNames).
 * Returns { text, mended: [[from, to], ...] }.
 */
function mend(text, names) {
  let s = String(text || '');
  const mended = [];
  const all = [].concat(...Object.values(names || {}).map(v => (Array.isArray(v) ? v : []))).filter(n => typeof n === 'string' && n.trim().length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const n of all) {
    s = s.replace(new RegExp('(^|[^A-Za-z0-9])(' + esc(n.trim()) + ')(?![A-Za-z0-9])', 'gi'), (m, pre, got) => { if (got !== n.trim()) mended.push([got, n.trim()]); return pre + n.trim(); });
  }
  const K = known(), theirs = new Set(all.flatMap(n => n.toLowerCase().match(/[a-z]+/g) || []));
  s = s.replace(/(^|[^A-Za-z0-9'])([a-z]{4,})(?![A-Za-z0-9])/g, (m, pre, w) => { const c = mendWord(w, K, theirs); if (c !== w) mended.push([w, c]); return pre + c; });
  return { text: s, mended };
}

module.exports = { mend, mendWord, known, english, SHORTHAND };
