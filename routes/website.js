// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/website.js — Landing Page CMS API
//
//  PUBLIC
//    GET  /api/website/content        — all page content + next 14 staffed days
//                                       + upcoming events (past auto-excluded)
//  ADMIN (x-admin-password header, same as the rest of admin)
//    PUT    /api/website/content      — {key, value} save one section (whitelist)
//    POST   /api/website/upload       — landing photo upload (jpg/png/webp, 12MB)
//    GET    /api/website/events/all   — all events incl. past
//    POST   /api/website/events       — create event
//    PUT    /api/website/events/:id   — change an event
//    DELETE /api/website/events/:id   — delete event
//    GET    /api/website/staffed      — staffed days in a range
//    PUT    /api/website/staffed      — upsert one date
//    DELETE /api/website/staffed/:date
//    POST   /api/website/staffed/bulk — seed a weekly pattern across a range
//
//  Every write goes through the db wrapper (write-through disk save) and logs
//  an admin_log entry.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { getConfig } = require('../services/config');
const { stripPrototypeKeys } = require('../services/object-keys');
const dbModule = require('../services/db');

const LANDING_UPLOADS = path.join(__dirname, '..', 'public', 'uploads', 'landing');
if (!fs.existsSync(LANDING_UPLOADS)) fs.mkdirSync(LANDING_UPLOADS, { recursive: true });

function isAdmin(req) {
  const A = require('../services/auth');
  if (A.verifyAdminRequest(req)) return true;
  // The SSH-forwarded wizard saves the selected theme before setup finishes.
  return !A.setupComplete();
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// One key per page section. Writes to anything else are rejected.
const CONTENT_KEYS = ['theme','hero','offers','sections','steps','staffed','gallery','promo','visit','settings','memberships', 'membershipsIntro', 'pages', 'nav', 'social', 'layout'];
const siteimages = require('../services/siteimages');
const sitenav = require('../services/sitenav');
let healedOnce = false;
// Every write bumps this; the templated-page cache stamps on it (updated_at is whole seconds).
let _writeVersion = 0;
function bumpWrite() { _writeVersion++; }
const MAX_VALUE_BYTES = 200 * 1024;

// the facility's day (Oct 20 2026) - the same day the page cache turns over on (server.js contentStamp)
function todayStr() {
  try { return require('../services/revenue').facilityToday(); } catch {}
  const n = new Date(), p = x => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

// ── PUBLIC: everything the landing/events pages need in one call ─────────────
// ── ADMIN CONSOLE LOOK (Aug 13 2026): one theme, one picker, one place ──────
// The console's own dark look is chosen HERE, on the same Colors card as the
// brand, and stored in its own clean key (cfg.adminTheme). It never touches
// the brand store and the brand never touches it - nothing shares a key.
const CONSOLE_LOOKS = ['dark-gold', 'dark-green', 'dark-blue', 'dark-red', 'dark-purple', 'light', 'match-brand'];

router.get('/console-look', requireAdmin, (req, res) => {
  const name = getConfig().adminTheme?.name;
  res.json({ name: CONSOLE_LOOKS.includes(name) ? name : 'dark-gold' });
});

router.post('/console-look', requireAdmin, (req, res) => {
  const name = (req.body || {}).name;
  if (!CONSOLE_LOOKS.includes(name)) return res.status(400).json({ error: 'Unknown console look' });
  require('../services/config').saveConfig({ adminTheme: { name } });
  try { dbModule.adminLog('CONSOLE_LOOK', name); } catch {}
  res.json({ ok: true, name });
});

// Contrast audit: returns any hard-to-read color pairs. WARN-ONLY - the
// owner's brand is theirs; we just make sure they know before customers do.
router.post('/theme/audit', requireAdmin, (req, res) => {
  try {
    const theme = require('../services/theme');
    const incoming = (req.body && req.body.colors) || null;
    if (incoming && typeof incoming === 'object') {
      const base = theme.resolve().colors;
      const merged = Object.assign({}, base);
      for (const k of theme.ROLES) if (theme.isHex(incoming[k])) merged[k] = incoming[k];
      return res.json(theme.auditColors(merged));
    }
    res.json(theme.audit());
  } catch (e) { res.json({ ok: true, issues: [] }); }
});

function buildPublic(isAdmin) {
  const content = Object.create(null);
  for (const row of dbModule.db.prepare(`SELECT key, value FROM website_content`).all()) {
    if (!CONTENT_KEYS.includes(row.key)) continue;
    try {
      const value = JSON.parse(row.value);
      stripPrototypeKeys(value);
      content[row.key] = value;
    } catch { /* skip corrupt */ }
  }
  // DRAFT CONFIDENTIALITY (Aug 19, live-proven leak): unpublished pages must be
  // invisible to the public EVERYWHERE - the page route already 404s, but this
  // API was handing draft bodies to anyone. Non-admins get published pages
  // only; the signed-in editor keeps the full list.
  if (content.pages && !isAdmin) {
    content.pages = (Array.isArray(content.pages) ? content.pages : []).filter(p => p && p.published);
  }
  const today = todayStr();
  // ONE SOURCE for staffed hours (Sep 2026): the website and the booking page
  // both read services/staffing.js, so a season or the master switch is
  // honoured here too instead of the raw calendar table.
  const staffed = (require('../services/staffing').upcomingStaffedWindows(14) || []).slice(0, 14);
  const events = dbModule.db.prepare(
    `SELECT id, title, event_date, description, flyer, link FROM website_events
     WHERE event_date >= ? ORDER BY event_date ASC`
  ).all(today);
  const bk = getConfig().booking || {};
  const hours = {
    open24: bk.open24Hours === true,
    days:   Array.isArray(bk.openDays) ? bk.openDays : [],
    open:   bk.openTime || '',
    close:  bk.closeTime || '',
    closeNextDay: !!bk.closeNextDay,
    dayHours: require('../services/hours').dayHours(bk)   // the days with hours of their own
  };
  // Photos sized for phones (Sep 5 2026): the index the pages build srcset
  // from. Photos uploaded before the renditions existed heal in the
  // background once per boot.
  if (!healedOnce) { healedOnce = true; try { siteimages.ensureAll(); } catch {} }
  const images = siteimages.index();
  // Navigation: one model for the landing page, every secondary page and the sitemap.
  const nav = sitenav.resolve(content);
  // Wave B/D (Sep 5 2026): the Rates block reads the booking rates live from
  // Pricing (public information - the booking page shows them anyway); the
  // announcement is the ONE notice (Settings > Notice) shown on the booking
  // page and on every website page.
  let rates = [];
  try { rates = dbModule.db.prepare(`SELECT name, days, start_time, end_time, price_per_half_hour FROM pricing_tiers WHERE active = 1 ORDER BY sort_order ASC, name ASC`).all(); } catch {}
  const ann = getConfig().announcement || {};
  const annLink = /^(https?:\/\/[^\s<>"']+|\/[^\s<>"']*)$/.test(String(ann.link || '').trim()) ? String(ann.link).trim() : '';
  const announcement = { enabled: ann.enabled === true && !!(ann.message || '').trim(), message: (ann.message || '').trim(), link: annLink };
  // The Google review link is asked once (Settings > Local Search & SEO) and
  // rides along with the social links so the footer can show it.
  try { const rv = (getConfig().seo || {}).reviewUrl; if (rv && /^https:\/\//.test(rv)) content.social = Object.assign({}, content.social || {}, { google: rv }); } catch {}
  // W44 addendum: the older Settings > SEO description, so the editor can show it and move it into its own field
  const meta = { legacyDescription: String((getConfig().seo || {}).metaDescription || '').trim() };
  // THE ONE MENU (Oct 20 2026, night; maintainer: "add a new beer for $5 called ale ipa. and it will ad the new beer to
  // the beer menu ... different sub menus like food drink wine beer burgers, pizza"): the counter's own menu, for a menu
  // section that shows it live - each active category with its active items, sold-out ones left off (public: the prices are
  // what a server charges, the same the menu board says). Only names, words and prices: nothing of the counter's routing.
  let menu = [];
  try {
    const money = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
    const cats = dbModule.db.prepare(`SELECT id, name FROM menu_categories WHERE active = 1 ORDER BY sort, name`).all();
    const items = dbModule.db.prepare(`SELECT * FROM menu_items WHERE active = 1 AND eighty_sixed = 0 ORDER BY sort, name`).all();
    menu = cats.map(c => ({ name: c.name, items: items.filter(i => i.category_id === c.id).map(i => ({ name: i.name, price: money(i.price_cents | 0), text: String(i.description || '') })) }))
      .filter(c => c.items.length);
  } catch {}
  // THE COUNTER'S SPECIALS (Oct 22 2026): the same rule the counter charges by, for the weekly specials section -
  // one special, everywhere. Only its name, words, deal, days and time (public: the servers say the same)
  let specials = [];
  try { specials = require('../services/specials').forWebsite(); } catch {}
  // THE PACKAGE DEALS ON SALE (Oct 22 2026): what a customer reads of each (services/packages.js forCustomer) - a
  // Cards section with source "packages" shows them live, each booked on the booking page
  let packages = [];
  try { packages = require('../services/packages').forOnline(require('../services/revenue').facilityToday()); } catch {}
  // the facility's own day (Oct 20 2026): the weekly specials mark - or show only - today's
  return { content, staffed, events, nextEvent: events[0] || null, hours, images, nav, rates, announcement, meta, today, menu, specials, packages };
}
router.get('/content', (req, res) => {
  res.json(buildPublic(require('../services/auth').verifyAdminRequest(req)));
});
// TODAY'S SPECIALS FOR THE BOOKING PAGE (Oct 20 2026, night; maintainer: "on the front page or somewhere people see
// when booking ... allow the owner to put where the specials are shown"): the specials the owner put on the booking page,
// on their day (the facility's own) - their name and words only
router.get('/today', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    const layout = dbModule.db.prepare(`SELECT value FROM website_content WHERE key = 'layout'`).get();
    const content = layout ? { layout: JSON.parse(layout.value) } : {};
    const today = todayStr();
    const specials = require('../public/site-layout.js').todaysSpecials(content, today).filter(x => x.also.indexOf('booking') >= 0)
      .map(x => ({ title: x.title, text: x.text, price: x.price, time: x.time }));
    res.json({ today, specials });
  } catch { res.json({ specials: [] }); }
});

// ── ADMIN: save one content section ──────────────────────────────────────────
router.put('/content', requireAdmin, (req, res) => {
  const { key, value } = req.body || {};
  if (!CONTENT_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown content key' });
  let str;
  try { str = JSON.stringify(value); } catch { return res.status(400).json({ error: 'Value must be JSON-serializable' }); }
  if (!str || Buffer.byteLength(str, 'utf8') > MAX_VALUE_BYTES) {
    return res.status(400).json({ error: 'Value missing or too large (200KB max)' });
  }
  saveContent(key, str, req.body && req.body._restoredFrom ? `restore of version ${req.body._restoredFrom}` : '');
  dbModule.adminLog('WEBSITE_CONTENT_SAVED', `Section: ${key}`);
  bumpWrite();
  res.json({ ok: true, key });
});

// B-wave 1 (Sep 11 2026): the ONE save. The value being replaced goes to
// website_content_history first (only when it differs), the newest thirty per
// key are kept, then the new value lands. Used by the save route and by a
// restore, so a restore's own replaced value is kept as well.
const HISTORY_KEEP = 30;
function saveContent(key, str, note) {
  const cur = dbModule.db.prepare(`SELECT value FROM website_content WHERE key = ?`).get(key);
  if (cur && typeof cur.value === 'string' && cur.value !== str) {
    dbModule.db.prepare(`INSERT INTO website_content_history (key, value, saved_by) VALUES (?, ?, ?)`).run(key, cur.value, note || '');
    dbModule.db.prepare(`DELETE FROM website_content_history WHERE key = ? AND id NOT IN (SELECT id FROM website_content_history WHERE key = ? ORDER BY id DESC LIMIT ?)`).run(key, key, HISTORY_KEEP);
  }
  dbModule.db.prepare(`INSERT OR REPLACE INTO website_content (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(key, str);
}
// a few readable words from a stored value, for the list ("Play Anytime...", "3 pages", ...)
function summarize(key, str) {
  let v; try { v = JSON.parse(str); } catch { return ''; }
  const first = (o, keys) => { for (const k of keys) if (o && typeof o[k] === 'string' && o[k].trim()) return o[k].trim(); return ''; };
  if (Array.isArray(v)) return `${v.length} ${key === 'pages' ? 'page' : 'item'}${v.length === 1 ? '' : 's'}${v.length ? ': ' + v.slice(0, 3).map(x => first(x, ['title', 'label', 'name', 'headline']) || '').filter(Boolean).join(', ') : ''}`;
  if (v && typeof v === 'object') {
    const t = first(v, ['headline', 'title', 'siteTitle', 'intro', 'text', 'tag', 'label', 'p1', 'name']);
    if (t) return t.slice(0, 70);
    if (Array.isArray(v.items)) return `${v.items.length} item${v.items.length === 1 ? '' : 's'}`;
    if (Array.isArray(v.blocks)) return `${v.blocks.length} block${v.blocks.length === 1 ? '' : 's'}`;
    return Object.keys(v).slice(0, 5).join(', ');
  }
  return String(v).slice(0, 70);
}
router.get('/history', requireAdmin, (req, res) => {
  const key = String(req.query.key || '');
  if (!CONTENT_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown content key' });
  const rows = dbModule.db.prepare(`SELECT id, key, saved_at, saved_by, length(value) AS bytes, value FROM website_content_history WHERE key = ? ORDER BY id DESC LIMIT ?`).all(key, HISTORY_KEEP);
  res.json({ key, versions: rows.map(r => ({ id: r.id, savedAt: r.saved_at, note: r.saved_by || '', bytes: r.bytes, summary: summarize(key, r.value) })) });
});
router.get('/history/:id', requireAdmin, (req, res) => {
  const row = dbModule.db.prepare(`SELECT id, key, value, saved_at FROM website_content_history WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'No such version' });
  let value = null; try { value = JSON.parse(row.value); } catch {}
  res.json({ id: row.id, key: row.key, savedAt: row.saved_at, value });
});
router.post('/history/restore', requireAdmin, (req, res) => {
  const row = dbModule.db.prepare(`SELECT id, key, value FROM website_content_history WHERE id = ?`).get(Number(req.body && req.body.id));
  if (!row) return res.status(404).json({ error: 'No such version' });
  if (!CONTENT_KEYS.includes(row.key)) return res.status(400).json({ error: 'Unknown content key' });
  saveContent(row.key, row.value, `restore of version ${row.id}`);
  dbModule.adminLog('WEBSITE_CONTENT_RESTORED', `Section: ${row.key} | version ${row.id}`);
  bumpWrite();
  res.json({ ok: true, key: row.key, restored: row.id });
});

// ── ADMIN: landing photo upload ──────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LANDING_UPLOADS),
  filename: (req, file, cb) => {
    // The extension comes from the declared type, never the file name (Sep 6 2026);
    // the bytes are checked after the write and win over both.
    const ext  = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[file.mimetype] || '.jpg';
    const base = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'photo';
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, or WebP images are allowed'), ok);
  }
});

router.post('/upload', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    // The bytes decide (Sep 6 2026): anything that is not really a JPG/PNG/WebP
    // is removed before anything can serve it, whatever the browser called it.
    const settled = siteimages.settle(req.file.path);
    if (!settled) {
      dbModule.adminLog('UPLOAD_REJECTED', `${String(req.file.originalname).slice(0, 80)} claimed ${req.file.mimetype} - bytes are not a JPG, PNG or WebP`);
      return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' });
    }
    req.file.path = settled; req.file.filename = path.basename(settled);
    // Phone-first renditions beside the original (480/960/1600, JPEG + WebP).
    // A failure never loses the upload - the page falls back to the original.
    const r = siteimages.generate(req.file.path);
    dbModule.adminLog('WEBSITE_PHOTO_UPLOADED', req.file.filename + (r.ok ? ` (${r.width}x${r.height}, sizes ${r.sizes.join('/')})` : ' (renditions failed: ' + r.error + ')'));
    res.json({ ok: true, path: `/uploads/landing/${req.file.filename}`, width: r.ok ? r.width : null, height: r.ok ? r.height : null, sizes: r.ok ? r.sizes : [], optimized: !!r.ok });
  });
});

// ── ADMIN: size every photo for phones (the ones uploaded before renditions existed) ──
router.post('/optimize-photos', requireAdmin, (req, res) => {
  const pending = siteimages.missing().length;
  const queued = siteimages.ensureAll();
  res.json({ ok: true, pending, queued, indexed: Object.keys(siteimages.index()).length });
});
router.get('/optimize-photos', requireAdmin, (req, res) => {
  res.json({ pending: siteimages.missing().length, indexed: Object.keys(siteimages.index()).length });
});

// ── ADMIN: what a flyer can be made for (Oct 22 2026, night - services/flyers.js): the site's own colours, fonts,
// name and top photos, and every deal, package, event and counter special that is on - the Offer Slides card's flyer maker ──
router.get('/flyer-sources', requireAdmin, (req, res) => {
  try { const F = require('../services/flyers'); res.json({ base: F.base(), sources: F.sources(), layouts: require('../public/flyer.js').LAYOUTS }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// ── ADMIN: events ─────────────────────────────────────────────────────────────
router.get('/events/all', requireAdmin, (req, res) => {
  const rows = dbModule.db.prepare(
    `SELECT id, title, event_date, description, flyer, link FROM website_events ORDER BY event_date DESC`
  ).all();
  res.json({ events: rows });
});

router.post('/events', requireAdmin, (req, res) => {
  const { title, event_date, description, flyer, link } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date || '')) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  if (title.length > 120)                    return res.status(400).json({ error: 'Title too long (120 max)' });
  if ((description || '').length > 2000)     return res.status(400).json({ error: 'Description too long (2000 max)' });
  if ((flyer || '').length > 300 || (link || '').length > 300) return res.status(400).json({ error: 'Path/link too long' });
  const id = 'evt-' + crypto.randomBytes(6).toString('hex');
  dbModule.db.prepare(
    `INSERT INTO website_events (id, title, event_date, description, flyer, link) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, title.trim(), event_date, description || '', flyer || '', link || '');
  dbModule.adminLog('WEBSITE_EVENT_CREATED', `${event_date} | ${title.trim()}`);
  bumpWrite();
  res.json({ ok: true, id });
});

// (Oct 20 2026): an event can be changed, not only deleted and made again - the same checks as a new one,
// every field given (the card and the assistant send the whole event)
router.put('/events/:id', requireAdmin, (req, res) => {
  const row = dbModule.db.prepare(`SELECT id FROM website_events WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No such event' });
  const { title, event_date, description, flyer, link } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date || '')) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  if (title.length > 120)                    return res.status(400).json({ error: 'Title too long (120 max)' });
  if ((description || '').length > 2000)     return res.status(400).json({ error: 'Description too long (2000 max)' });
  if ((flyer || '').length > 300 || (link || '').length > 300) return res.status(400).json({ error: 'Path/link too long' });
  dbModule.db.prepare(`UPDATE website_events SET title = ?, event_date = ?, description = ?, flyer = ?, link = ? WHERE id = ?`)
    .run(title.trim(), event_date, description || '', flyer || '', link || '', row.id);
  dbModule.adminLog('WEBSITE_EVENT_CHANGED', `${event_date} | ${title.trim()}`);
  bumpWrite();
  res.json({ ok: true, id: row.id });
});

router.delete('/events/:id', requireAdmin, (req, res) => {
  dbModule.db.prepare(`DELETE FROM website_events WHERE id = ?`).run(req.params.id);
  dbModule.adminLog('WEBSITE_EVENT_DELETED', req.params.id);
  bumpWrite();
  res.json({ ok: true });
});

// ── ADMIN: staffed days ───────────────────────────────────────────────────────
router.get('/staffed', requireAdmin, (req, res) => {
  const from = req.query.from || todayStr();
  const to   = req.query.to   || '9999-12-31';
  const rows = dbModule.db.prepare(
    `SELECT date, start_time, end_time, note FROM staffed_days WHERE date >= ? AND date <= ? ORDER BY date ASC`
  ).all(from, to);
  // WHO DECIDES, SAID ON THE CARD (Oct 19 2026, the guide audit): a season in Settings > Schedule outranks this calendar
  // (services/staffing.effectiveWindow), and the card went on showing marked days that no longer counted - with the
  // Schedule tab hidden too once Employee scheduling is off. The card now says which source rules.
  let season = null, scheduleOff = false, schedulingOn = false;
  try { const sv = require('../services/staffing').activeSeason(); if (sv) season = { name: sv.name || 'a season' }; } catch {}
  try { const c = getConfig(); scheduleOff = !!(c.coverage && c.coverage.scheduleOff === true); schedulingOn = !!(c.scheduling && c.scheduling.enabled); } catch {}
  res.json({ staffed: rows, season, scheduleOff, schedulingOn });
});

router.put('/staffed', requireAdmin, (req, res) => {
  const { date, start_time, end_time, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  dbModule.db.prepare(
    `INSERT OR REPLACE INTO staffed_days (date, start_time, end_time, note) VALUES (?, ?, ?, ?)`
  ).run(date, start_time || '', end_time || '', (note || '').slice(0, 200));
  dbModule.adminLog('WEBSITE_STAFFED_SET', `${date} ${start_time || ''}-${end_time || ''}`);
  bumpWrite();
  res.json({ ok: true, date });
});

router.delete('/staffed/:date', requireAdmin, (req, res) => {
  dbModule.db.prepare(`DELETE FROM staffed_days WHERE date = ?`).run(req.params.date);
  dbModule.adminLog('WEBSITE_STAFFED_REMOVED', req.params.date);
  bumpWrite();
  res.json({ ok: true });
});

// Seed a weekly pattern ("staff every Thu/Fri/Sat through March"), then knock
// out individual holidays with DELETE. Max range one year.
router.post('/staffed/bulk', requireAdmin, (req, res) => {
  const { weekdays, start_time, end_time, from, to } = req.body || {};
  if (!Array.isArray(weekdays) || weekdays.length === 0 || weekdays.some(w => !Number.isInteger(w) || w < 0 || w > 6)) {
    return res.status(400).json({ error: 'weekdays must be an array of 0-6 (Sun-Sat)' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
  }
  const start = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
  if (isNaN(start) || isNaN(end) || end < start) return res.status(400).json({ error: 'Invalid range' });
  if ((end - start) / 86400000 > 366)            return res.status(400).json({ error: 'Range too large (1 year max)' });

  const stmt = dbModule.db.prepare(
    `INSERT OR REPLACE INTO staffed_days (date, start_time, end_time, note) VALUES (?, ?, ?, ?)`
  );
  let count = 0;
  const p = x => String(x).padStart(2, '0');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (!weekdays.includes(d.getDay())) continue;
    stmt.run(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, start_time || '', end_time || '', '');
    count++;
  }
  dbModule.adminLog('WEBSITE_STAFFED_BULK', `${count} days seeded (${from} to ${to})`);
  bumpWrite();
  res.json({ ok: true, count });
});

// ── ADMIN: hero video upload with on-device compression ──────────────────────
// The owner uploads any video (phone clips are huge); the device compresses it
// with ffmpeg into a small, muted, web-streamable background loop and extracts
// a poster frame. Compression takes MINUTES on this hardware — it runs as a
// background job the editor polls. One job at a time to protect the CPU.
const { spawn, execFile } = require('child_process');

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LANDING_UPLOADS),
  // Extension from the declared type, never the file name (Sep 6 2026); the
  // container bytes are checked after the write.
  filename: (req, file, cb) => cb(null, `raw-${Date.now()}${({ 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-m4v': '.m4v' })[file.mimetype] || '.mp4'}`)
});
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'].includes(file.mimetype);
    cb(ok ? null : new Error('Only MP4, MOV, or WebM videos are allowed'), ok);
  }
});

let videoJob = null; // { id, status: 'processing'|'done'|'error', path, poster, error, started }

router.post('/upload-video', requireAdmin, (req, res) => {
  execFile('ffmpeg', ['-version'], (ffErr) => {
    if (ffErr) return res.status(500).json({ error: 'Video upload needs FFmpeg. On the Pi, run sudo apt install ffmpeg, then retry.' });
    if (videoJob && videoJob.status === 'processing') {
      return res.status(409).json({ error: 'A video is already being processed. Please wait for it to finish.' });
    }
    videoUpload.single('video')(req, res, err => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
      if (!req.file) return res.status(400).json({ error: 'No file received' });
      // A real MP4/MOV carries 'ftyp' at byte 4; WebM opens 1A 45 DF A3 (Sep 6 2026).
      let head = Buffer.alloc(12);
      try { const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd); } catch { head = Buffer.alloc(12); }
      const isVideo = head.subarray(4, 8).toString('latin1') === 'ftyp' || head.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]));
      if (!isVideo) {
        try { fs.unlinkSync(req.file.path); } catch { /* gone */ }
        dbModule.adminLog('UPLOAD_REJECTED', `${String(req.file.originalname).slice(0, 80)} claimed ${req.file.mimetype} - bytes are not a video`);
        return res.status(400).json({ error: 'That file is not an MP4, MOV or WebM video.' });
      }

      const id      = 'vid-' + crypto.randomBytes(5).toString('hex');
      const rawPath = req.file.path;
      const outName = `hero-${Date.now()}.mp4`;
      const outPath = path.join(LANDING_UPLOADS, outName);
      const posterName = outName.replace(/\.mp4$/, '-poster.jpg');
      const posterPath = path.join(LANDING_UPLOADS, posterName);

      videoJob = { id, status: 'processing', started: Date.now() };
      dbModule.adminLog('WEBSITE_VIDEO_UPLOADED', `${req.file.originalname} (${Math.round(req.file.size / 1048576)}MB) — compressing`);

      // 720p-class, no audio (background videos play muted), streamable, 90s cap.
      const ff = spawn('ffmpeg', [
        '-y', '-i', rawPath,
        '-t', '90',
        '-vf', "scale='min(1280,iw)':-2",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-an', '-movflags', '+faststart',
        outPath
      ]);
      ff.on('error', () => {
        videoJob = { id, status: 'error', error: 'Compression failed to start' };
        fs.unlink(rawPath, () => {});
      });
      ff.on('close', code => {
        if (code !== 0) {
          videoJob = { id, status: 'error', error: 'Compression failed — the file may be corrupt or an unsupported format' };
          fs.unlink(rawPath, () => {}); fs.unlink(outPath, () => {});
          dbModule.adminLog('WEBSITE_VIDEO_FAILED', `exit ${code}`);
          return;
        }
        // Poster frame from 1s in (falls back silently if it fails).
        execFile('ffmpeg', ['-y', '-ss', '1', '-i', outPath, '-vframes', '1', '-q:v', '4', posterPath], () => {
          const size = (() => { try { return fs.statSync(outPath).size; } catch { return 0; } })();
          videoJob = {
            id, status: 'done',
            path: `/uploads/landing/${outName}`,
            poster: fs.existsSync(posterPath) ? `/uploads/landing/${posterName}` : '',
            sizeMB: Math.round(size / 104857.6) / 10
          };
          fs.unlink(rawPath, () => {});
          dbModule.adminLog('WEBSITE_VIDEO_READY', `${outName} (${videoJob.sizeMB}MB)`);
        });
      });
      res.json({ ok: true, id, status: 'processing' });
    });
  });
});

router.get('/video-status/:id', requireAdmin, (req, res) => {
  if (!videoJob || videoJob.id !== req.params.id) return res.status(404).json({ error: 'Unknown job (the device may have restarted). Try the upload again.' });
  res.json(videoJob);
});

// ── PUBLIC: the Inquiry form block (wave D) ──────────────────────────────────
// Parties, leagues, lessons. Stored on the unit FIRST (never lost), then emailed
// to the facility address when email is configured. Ten a minute per address,
// a hidden trap field bots fill in (accepted and dropped), sizes capped.
const rateLimit = require('express-rate-limit');
const inquiryLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many messages from this address - please wait a minute.' } });
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
router.post('/inquiry', inquiryLimiter, async (req, res) => {
  const b = req.body || {};
  if (clip(b.website, 200)) return res.json({ ok: true });          // the trap field: bots fill it, people never see it
  const row = { name: clip(b.name, 120), email: clip(b.email, 160), phone: clip(b.phone, 40), want_date: clip(b.date, 60), people: clip(b.people, 40), message: clip(b.message, 2000), block: clip(b.block, 60) };
  if (!row.name) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!row.email && !row.phone) return res.status(400).json({ error: 'Please give us an email or a phone number so we can reply.' });
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return res.status(400).json({ error: 'That email address does not look right.' });
  const id = 'inq-' + crypto.randomBytes(6).toString('hex');
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  dbModule.db.prepare(`INSERT INTO website_inquiries (id, name, email, phone, want_date, people, message, block, ip, status, emailed) VALUES (?,?,?,?,?,?,?,?,?,'new',0)`)
    .run(id, row.name, row.email, row.phone, row.want_date, row.people, row.message, row.block, ip);
  dbModule.adminLog('WEBSITE_INQUIRY', `${row.name} | ${row.email || row.phone} | ${row.message.slice(0, 80)}`);
  let emailed = false;
  try {
    const cfg = getConfig();
    const to = (cfg.contact && cfg.contact.email) || '';
    if (to) {
      const lines = [`From: ${row.name}`, row.email ? `Email: ${row.email}` : '', row.phone ? `Phone: ${row.phone}` : '', row.want_date ? `Date: ${row.want_date}` : '', row.people ? `People: ${row.people}` : '', '', row.message || '(no message)', '', `Sent from your website - it is also in Admin > Website > Inbox.`].filter(l => l !== '');
      const r = await require('../services/email').sendEmail({ to, subject: `Website inquiry from ${row.name}`, text: lines.join('\n') });
      emailed = !!(r && (r.ok || r.success || r.id || r === true));
    }
  } catch (e) { emailed = false; }
  if (emailed) { try { dbModule.db.prepare(`UPDATE website_inquiries SET emailed = 1 WHERE id = ?`).run(id); } catch {} }
  res.json({ ok: true, id });
});
// ── PDF PAGES (W45, Sep 10 2026) ─────────────────────────────────────────────
// A custom page may BE a document: the owner uploads a PDF (a menu, a flyer, a
// price sheet) and /p/<slug> renders it inline with the vendored pdf.js. The
// bytes decide (`%PDF-`), whatever the browser called the file; 25 MB cap;
// stored under public/uploads/docs (a unit file - backed up, never in a pack).
const DOCS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'docs');
const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { fs.mkdirSync(DOCS_DIR, { recursive: true }); } catch {} cb(null, DOCS_DIR); },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname, path.extname(file.originalname)).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 50) || 'document'}.pdf`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname); cb(ok ? null : new Error('Only PDF documents are allowed'), ok); }
});
router.post('/upload-pdf', requireAdmin, (req, res) => {
  pdfUpload.single('pdf')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That PDF is over 25 MB - export a smaller one.' : (err.message || 'Upload failed') });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    let head = Buffer.alloc(5);
    try { const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd); } catch {}
    if (head.toString('latin1') !== '%PDF-') {
      try { fs.unlinkSync(req.file.path); } catch {}
      dbModule.adminLog('UPLOAD_REJECTED', `${String(req.file.originalname).slice(0, 80)} claimed a PDF - the bytes are not one`);
      return res.status(400).json({ error: 'That file is not a PDF.' });
    }
    dbModule.adminLog('WEBSITE_PDF_UPLOADED', `${req.file.filename} (${req.file.size} bytes)`);
    res.json({ ok: true, path: `/uploads/docs/${req.file.filename}`, size: req.file.size });
  });
});
// ── EMAIL UPDATES (W45, Sep 10 2026) ─────────────────────────────────────────
// The signup lands on the unit (services/subscribers). Its own limiter, and it
// is never an admin credential - the login counters (W39) count only requests
// that present one, so a flood here can never lock the owner out. The trap
// field is honoured like the inquiry's. A confirmation goes through the unit's
// configured sender when there is one, with the unsubscribe link.
const subscribeLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-ups from this address - please wait a minute.' } });
const subscribers = require('../services/subscribers');
router.post('/subscribe', subscribeLimiter, async (req, res) => {
  const b = req.body || {};
  if (clip(b.website, 200)) return res.json({ ok: true });          // the trap field
  const sg = sitenav.signup(buildPublic(false).content.settings);
  if (!sg.enabled) return res.status(404).json({ error: 'Not yet public' });
  const consentText = clip(b.consent, 300) || 'I would like email updates from ' + (getConfig().server?.businessName || 'this facility') + '.';
  const r = subscribers.add({ email: b.email, name: clip(b.name, 120), source: clip(b.source, 40) || 'site', ip: (req.ip || '').replace(/^::ffff:/, ''), consentText });
  if (r.error) return res.status(400).json({ error: r.error });
  dbModule.adminLog('WEBSITE_SUBSCRIBE', `${r.row.email}${r.row.name ? ' (' + r.row.name + ')' : ''} | ${r.row.source}${r.created ? '' : r.reactivated ? ' | back on the list' : ' | already on the list'}`);
  let confirmed = false;
  if (r.created || r.reactivated) {
    try {
      const cfg = getConfig();
      const biz = cfg.server?.businessName || 'Us';
      const base = (cfg.seo?.domain || '').trim().replace(/\/+$/, '') || (req.protocol + '://' + req.get('host'));
      const text = `${r.row.name ? 'Hi ' + r.row.name + ',' : 'Hello,'}\n\nYou are on the email updates list for ${biz}. We will write when there is news - opening dates, events, offers.\n\nIf this was not you, or you change your mind, one click takes you off the list:\n${base}/updates/unsubscribe?t=${r.row.unsub_token}\n\n${biz}`;
      const sent = await require('../services/email').sendEmail({ to: r.row.email, subject: `You are on the list - ${biz}`, text });
      confirmed = !!(sent && (sent.ok || sent.success || sent.id || sent === true));
      if (confirmed) subscribers.markConfirmed(r.row.id);
    } catch { confirmed = false; }
  }
  res.json({ ok: true, id: r.row.id, alreadyOn: !r.created && !r.reactivated, confirmationSent: confirmed });
});
// ── THE NEWSLETTER (Oct 19 2026 - services/newsletter.js) ───────────────
// Sending to everyone signed up is the owner's alone. Queued here, sent by the scheduler's tick in paced groups that a
// restart carries on from; every email carries that person's own unsubscribe link.
router.get('/newsletters', requireAdmin, (req, res) => {
  const nl = require('../services/newsletter');
  res.json({ newsletters: nl.list(), cannotSend: nl.cannotSend(getConfig()) });
});
router.post('/newsletters', require('../services/auth').requireOwner, (req, res) => {
  const nl = require('../services/newsletter');
  try {
    const r = nl.create({ subject: req.body && req.body.subject, body: req.body && req.body.body, image: req.body && req.body.image, by: req.body && req.body.by === 'assistant' ? 'through the assistant' : 'owner' });
    res.json(Object.assign({ ok: true }, r));
    setImmediate(() => nl.tick().catch(() => {}));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/newsletters/:id/cancel', require('../services/auth').requireOwner, (req, res) => {
  const r = require('../services/newsletter').cancel(req.params.id);
  res.status(r.error ? 409 : 200).json(r);
});
router.get('/subscribers', requireAdmin, (req, res) => {
  res.json(subscribers.list({ q: req.query.q, page: req.query.page, per: req.query.per }));
});
router.delete('/subscribers/:id', requireAdmin, (req, res) => {
  const gone = subscribers.remove(req.params.id);
  if (gone) dbModule.adminLog('WEBSITE_SUBSCRIBER_DELETED', req.params.id);
  res.status(gone ? 200 : 404).json({ ok: gone });
});
router.get('/subscribers.csv', requireAdmin, (req, res) => {
  dbModule.adminLog('WEBSITE_SUBSCRIBERS_EXPORT', 'csv');
  res.set('Content-Disposition', 'attachment; filename="email-updates-' + new Date().toISOString().slice(0, 10) + '.csv"').type('text/csv').send(subscribers.csv());
});
// ── ADMIN: the inbox ─────────────────────────────────────────────────────────
router.get('/inquiries', requireAdmin, (req, res) => {
  const rows = dbModule.db.prepare(`SELECT id, created_at, name, email, phone, want_date, people, message, block, status, emailed FROM website_inquiries ORDER BY created_at DESC LIMIT 200`).all();
  res.json({ inquiries: rows, newCount: rows.filter(r => r.status === 'new').length });
});
router.put('/inquiries/:id', requireAdmin, (req, res) => {
  const status = (req.body || {}).status === 'handled' ? 'handled' : 'new';
  dbModule.db.prepare(`UPDATE website_inquiries SET status = ? WHERE id = ?`).run(status, req.params.id);
  dbModule.adminLog('WEBSITE_INQUIRY_' + status.toUpperCase(), req.params.id);
  res.json({ ok: true, status });
});

module.exports = router;
module.exports.buildPublic = buildPublic;
module.exports.writeVersion = () => _writeVersion;
module.exports.saveContent = saveContent;
module.exports.bumpWrite = bumpWrite;
