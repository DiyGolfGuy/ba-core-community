// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/uploads.js — Logo and Hero Image Upload
//
//  POST /api/uploads/logo        — upload logo image
//  POST /api/uploads/hero        — upload hero background image
//  GET  /api/uploads/logo        — check if logo exists
//  DELETE /api/uploads/logo      — remove logo
//  DELETE /api/uploads/hero      — remove hero image
//  POST /api/uploads/generate-icons — generate PWA icons from logo or letter
// ═══════════════════════════════════════════════════════════════════════════════

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const { getConfig } = require('../services/config');
const siteimages   = require('../services/siteimages');

// Run a Python snippet from a temp file - never inline via -c. Inlining
// flattened newlines and broke Python's indentation, so icon generation
// failed with a SyntaxError on every single run since day one.
const { execFileSync } = require('child_process');
const GEN_ICONS = path.join(__dirname, '..', 'scripts', 'gen-icons.py');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
const ICONS_DIR   = path.join(__dirname, '..', 'public', 'icons');

// Ensure dirs exist
[UPLOADS_DIR, ICONS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function isAdmin(req) {
  const auth = require('../services/auth');
  // The server admits unfinished setup only through the private SSH forward.
  return !auth.setupComplete() || auth.verifyAdminRequest(req);
}

// Multer for images
// A REFUSED UPLOAD NEVER DESTROYS THE FILE IT DID NOT REPLACE (maintainer, Sep 21 2026).
// multer used to write STRAIGHT to `logo.png`, so the owner's working logo was
// overwritten before a single byte had been inspected - and when settle() then
// found the bytes were not an image it deleted the file, taking the old logo
// with it. The owner uploaded the wrong thing once and their logo was simply
// gone, with nothing saying why. Uploads now land on a staging name that can
// never collide with the live slot (leading dot, so it is not one of the five
// names /api/uploads/logo looks for), and are MOVED into place only after the
// bytes have been settled.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const type = req.path.includes('hero') ? 'hero' : 'logo';
    // Declared type picks the extension; the bytes are checked after the write (Sep 6 2026).
    const ext  = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[file.mimetype] || '.jpg';
    cb(null, `.staging-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

/** Move a settled upload into its live slot, clearing the other extensions that
 *  slot may hold so one upload leaves exactly one file. Returns the final path. */
function placeAs(type, settledPath) {
  const ext   = path.extname(settledPath).toLowerCase();
  const final = path.join(UPLOADS_DIR, type + ext);
  for (const e of ['.png', '.jpg', '.jpeg', '.webp', '.svg']) {
    if (e === ext) continue;
    const other = path.join(UPLOADS_DIR, type + e);
    if (fs.existsSync(other)) { try { fs.unlinkSync(other); } catch {} }
  }
  fs.renameSync(settledPath, final);
  return final;
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG or WebP images are allowed'));
  }
});

// ── GET LOGO STATUS ───────────────────────────────────────────────────────────
router.get('/logo', (req, res) => {
  const files = ['logo.png','logo.jpg','logo.jpeg','logo.webp','logo.svg'];
  const found = files.find(f => fs.existsSync(path.join(UPLOADS_DIR, f)));
  res.json({ hasLogo: !!found, url: found ? `/uploads/${found}` : null });
});

// ── GET HERO STATUS ───────────────────────────────────────────────────────────
router.get('/hero', (req, res) => {
  const files = ['hero.png','hero.jpg','hero.jpeg','hero.webp'];
  const found = files.find(f => fs.existsSync(path.join(UPLOADS_DIR, f)));
  res.json({ hasHero: !!found, url: found ? `/uploads/${found}` : null });
});

// ── UPLOAD LOGO ───────────────────────────────────────────────────────────────
router.post('/logo', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  upload.single('image')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const settled = siteimages.settle(req.file.path);
    if (!settled) {
      try { require('../services/db').adminLog('UPLOAD_REJECTED', `${String(req.file.originalname).slice(0, 80)} claimed ${req.file.mimetype} - bytes are not a JPG, PNG or WebP`); } catch {}
      return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' });
    }
    const placed = placeAs('logo', settled);
    req.file.path = placed; req.file.filename = path.basename(placed);
    
    // Generate PWA icons from logo. The logo is saved either way; the icon
    // outcome rides back so the screen can say what actually happened.
    const icons = await generateIconsFromLogo(req.file.path);

    res.json({ success: true, url: `/uploads/${req.file.filename}`,
               icons: icons.ok, iconsError: icons.ok ? null : icons.error });
  });
});

// ── THE LOGO FROM A PHOTO ALREADY ADDED (Oct 22 2026) ─────────────
// maintainer on his try box: asked for his logo, he added the picture with the chat's photo button - it went to the website's photos and
// the assistant asked for the logo again, and again. A photo already on the unit (public/uploads/landing, by its own name - never a
// path outside it) is made the logo exactly as an upload is: its bytes checked, placed as the logo, the app icons made from it.
router.post('/logo/from-photo', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const m = String((req.body && req.body.path) || '').match(/^\/uploads\/landing\/([A-Za-z0-9][A-Za-z0-9._-]{0,150})$/);
  if (!m || m[1].includes('..')) return res.status(400).json({ error: 'That is not one of the photos added to this unit.' });
  const LANDING = path.join(UPLOADS_DIR, 'landing'), src = path.join(LANDING, m[1]);
  if (path.dirname(src) !== LANDING || !fs.existsSync(src)) return res.status(404).json({ error: 'That photo is not on this unit any more - add it again.' });
  const staged = path.join(UPLOADS_DIR, `.staging-logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(src).toLowerCase() || '.jpg'}`);
  try { fs.copyFileSync(src, staged); } catch (e) { return res.status(500).json({ error: 'The photo could not be read.' }); }
  const settled = siteimages.settle(staged);
  if (!settled) return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' });
  const placed = placeAs('logo', settled);
  const icons = await generateIconsFromLogo(placed);
  try { require('../services/db').adminLog('LOGO_FROM_PHOTO', m[1].slice(0, 120)); } catch {}
  res.json({ success: true, url: `/uploads/${path.basename(placed)}`, icons: icons.ok, iconsError: icons.ok ? null : icons.error });
});

// ── UPLOAD HERO ───────────────────────────────────────────────────────────────
router.post('/hero', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  upload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const settled = siteimages.settle(req.file.path);
    if (!settled) {
      try { require('../services/db').adminLog('UPLOAD_REJECTED', `${String(req.file.originalname).slice(0, 80)} claimed ${req.file.mimetype} - bytes are not a JPG, PNG or WebP`); } catch {}
      return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' });
    }
    const placed = placeAs('hero', settled);
    req.file.path = placed; req.file.filename = path.basename(placed);
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
  });
});

// ── DELETE LOGO ───────────────────────────────────────────────────────────────
router.delete('/logo', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  ['logo.png','logo.jpg','logo.jpeg','logo.webp','logo.svg'].forEach(f => {
    const fp = path.join(UPLOADS_DIR, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  res.json({ success: true });
});

// ── DELETE HERO ───────────────────────────────────────────────────────────────
router.delete('/hero', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  ['hero.png','hero.jpg','hero.jpeg','hero.webp'].forEach(f => {
    const fp = path.join(UPLOADS_DIR, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  res.json({ success: true });
});

// ── GENERATE ICONS FROM LETTER ────────────────────────────────────────────────
router.post('/generate-icons', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { letter, accentColor, bgColor } = req.body;
  try {
    await generateIconsFromLetter(letter || 'B', accentColor || '#c9a227', bgColor || '#060a06');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
// THE SILENT ICON PATH, CLOSED (maintainer, Sep 1 2026 — standing brief §6).
// This swallowed its error into a console line while the letter path threw,
// so if Python or Pillow ever failed on a unit, the owner uploaded a logo,
// saw "Logo uploaded!", and simply never got app icons - nothing on any
// screen said otherwise. It now verifies the icons actually landed (same
// PNG-magic check services/staffpwa.js uses to self-heal the staff icon) and
// REPORTS. It still does not throw: the logo itself saved fine, and failing
// the upload would throw away good work over a derived artifact.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function iconLooksReal(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(8);
      const n = fs.readSync(fd, head, 0, 8, 0);
      return n === 8 && head.equals(PNG_MAGIC) && fs.fstatSync(fd).size > 8;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

async function generateIconsFromLogo(logoPath) {
  try {
    execFileSync('python3', [GEN_ICONS, 'logo', logoPath, ICONS_DIR], { stdio: 'pipe' });
  } catch (e) {
    const msg = 'Icon generation from logo failed: ' + e.message;
    console.error(msg);
    try { require('../services/db').adminLog('ICONS_FAILED', msg.slice(0, 200)); } catch {}
    return { ok: false, error: 'Your logo was saved, but the app icons could not be generated on this device. Everything else works; the icons can be regenerated any time by uploading the logo again.' };
  }
  // Python exiting 0 is not proof. An 8-byte stub once reached golden this
  // way, so the bytes get checked.
  const missing = [192, 512].filter(sz => !iconLooksReal(path.join(ICONS_DIR, `icon-${sz}.png`)));
  if (missing.length) {
    const msg = 'Icon generation reported success but produced no valid PNG for: ' + missing.join(', ');
    console.error(msg);
    try { require('../services/db').adminLog('ICONS_FAILED', msg.slice(0, 200)); } catch {}
    return { ok: false, error: 'Your logo was saved, but the app icons did not come out as valid images. Everything else works; try uploading the logo again, or a simpler PNG.' };
  }
  return { ok: true };
}

async function generateIconsFromLetter(letter, accentColor, bgColor) {
  const L = String(letter || 'B').toUpperCase().slice(0, 1);
  if (!/^[A-Z0-9]$/.test(L)) throw new Error('Icon letter must be A-Z or 0-9');
  const hex = /^#[0-9A-Fa-f]{6}$/;
  const acc = hex.test(accentColor) ? accentColor : '#c9a227';
  const bg  = hex.test(bgColor)     ? bgColor     : '#060a06';
  execFileSync('python3', [GEN_ICONS, 'letter', L, acc, bg, ICONS_DIR], { stdio: 'pipe' });
}

module.exports = router;
module.exports.generateIconsFromLetter = generateIconsFromLetter;
