// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/siteimages.js - website photos sized for phones (maintainer, Sep 5 2026:
// "when they upload pictures they need to be scaled in a way that's gonna pop
// up right away on a phone").
//
// Every photo under public/uploads/landing gets renditions beside it -
// <base>.w480.jpg/.webp, .w960.*, .w1600.* - made by scripts/gen-renditions.py
// (Pillow, already on every unit for the app icons; no native Node module).
// The public content API publishes an index { '/uploads/landing/x.jpg':
// {w,h,sizes:[480,960,1600]} } and the pages build <picture> + srcset from it,
// so a phone downloads the 480 or 960 file, never the 1600 one. Photos
// uploaded before this wave are picked up by ensureAll() (background, one at
// a time) so an existing site heals itself. The original file is never
// touched; content keeps storing the original path (additive rule 14).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'public', 'uploads', 'landing');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'gen-renditions.py');
const ORIGINAL = /\.(jpe?g|png|webp)$/i;
const RENDITION = /\.w(\d+)\.(jpg|webp)$/i;
const WIDTHS = [480, 960, 1600];

let cache = { stamp: null, index: {} };

function dirStamp() {
  try { const st = fs.statSync(DIR); return st.mtimeMs + ':' + fs.readdirSync(DIR).length; } catch { return 'none'; }
}

/** { '/uploads/landing/<file>': { w, h, sizes:[...] } } for every original that has renditions. Cached by directory stamp. */
function index() {
  const stamp = dirStamp();
  if (cache.stamp === stamp) return cache.index;
  const out = {};
  let names = []; try { names = fs.readdirSync(DIR); } catch { names = []; }
  const set = new Set(names);
  for (const n of names) {
    if (!ORIGINAL.test(n) || RENDITION.test(n) || /^raw-|^hero-.*-poster\.jpg$/.test(n)) continue;
    const base = n.replace(/\.[A-Za-z0-9]+$/, '');
    const sizes = WIDTHS.filter(w => set.has(`${base}.w${w}.jpg`) && set.has(`${base}.w${w}.webp`));
    if (!sizes.length) continue;
    let w = 0, h = 0;
    try { const meta = JSON.parse(fs.readFileSync(path.join(DIR, base + '.meta.json'), 'utf8')); w = meta.width | 0; h = meta.height | 0; } catch {}
    out['/uploads/landing/' + n] = { w, h, sizes };
  }
  cache = { stamp, index: out };
  return out;
}

/** Make the renditions for one original (synchronous, ~1 s on a Pi). Returns { ok, width, height, sizes } or { ok:false, error }. */
function generate(absPath) {
  try {
    const raw = execFileSync('python3', [SCRIPT, absPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).toString('utf8').trim();
    const j = JSON.parse(raw.split('\n').pop());
    const base = absPath.replace(/\.[A-Za-z0-9]+$/, '');
    fs.writeFileSync(base + '.meta.json', JSON.stringify({ width: j.width, height: j.height, sizes: j.sizes }));
    cache.stamp = null;
    return { ok: true, width: j.width, height: j.height, sizes: j.sizes };
  } catch (e) {
    return { ok: false, error: String(e.stderr ? e.stderr.toString() : e.message).trim().slice(0, 200) };
  }
}

/** Originals with no renditions yet. */
function missing() {
  let names = []; try { names = fs.readdirSync(DIR); } catch { return []; }
  const set = new Set(names);
  return names.filter(n => ORIGINAL.test(n) && !RENDITION.test(n) && !/^raw-|^hero-.*-poster\.jpg$/.test(n))
    .filter(n => { const b = n.replace(/\.[A-Za-z0-9]+$/, ''); return !WIDTHS.some(w => set.has(`${b}.w${w}.jpg`)); });
}

let running = false;
/** Heal in the background: one photo at a time so the Pi stays responsive. Returns how many were queued. */
function ensureAll(onDone) {
  const todo = missing();
  if (!todo.length || running) { if (onDone) onDone({ queued: 0 }); return 0; }
  running = true;
  let i = 0, made = 0, failed = 0;
  const step = () => {
    if (i >= todo.length) { running = false; try { require('./db').adminLog('WEBSITE_PHOTOS_OPTIMIZED', `${made} photo(s) sized for phones${failed ? `, ${failed} failed` : ''}`); } catch {} if (onDone) onDone({ queued: todo.length, made, failed }); return; }
    const r = generate(path.join(DIR, todo[i++]));
    if (r.ok) made++; else failed++;
    setTimeout(step, 150);
  };
  setImmediate(step);
  return todo.length;
}

/** srcset strings for a stored path, or null when no renditions exist. */
function srcsetFor(rel) {
  const info = index()[rel]; if (!info) return null;
  const base = rel.replace(/\.[A-Za-z0-9]+$/, '');
  return { jpg: info.sizes.map(w => `${base}.w${w}.jpg ${w}w`).join(', '), webp: info.sizes.map(w => `${base}.w${w}.webp ${w}w`).join(', '), fallback: `${base}.w${Math.min(960, info.sizes[info.sizes.length - 1])}.jpg`, w: info.w, h: info.h, sizes: info.sizes };
}

// Magic bytes (Sep 6 2026): the browser's declared type and the file name's
// extension are both the uploader's claim. The first bytes are the truth.
function sniff(file) {
  let b;
  try { const fd = fs.openSync(file, 'r'); b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); } catch { return null; }
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))) return 'gif';
  return null;
}
/** Keep only a real JPG/PNG/WebP: removes anything else and renames the file to what the bytes say. Returns the (possibly new) path or null. */
function settle(filePath) {
  const kind = sniff(filePath);
  if (!kind || kind === 'gif') { try { fs.unlinkSync(filePath); } catch { /* gone */ } return null; }
  const want = '.' + kind;
  if (path.extname(filePath).toLowerCase() === want) return filePath;
  const np = filePath.replace(/\.[a-z0-9]+$/i, '') + want;
  fs.renameSync(filePath, np);
  return np;
}
module.exports = { DIR, WIDTHS, index, generate, missing, ensureAll, srcsetFor, sniff, settle, isRendition: n => RENDITION.test(n) };
