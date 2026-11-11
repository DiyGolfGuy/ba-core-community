// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/backup.js — Automatic local backups with retention
//
//  Writes a dated backup zip to ~/booking-system/backups/ and prunes copies older
//  than the retention window. Same contents as the manual download (DB, config,
//  waivers, uploaded images), built with archiver (no shell).
// ═══════════════════════════════════════════════════════════════════════════════

const fs      = require('fs');
const path    = require('path');
const { ZipArchive } = require('archiver');
const dbModule = require('./db');

const APP_DIR    = path.join(__dirname, '..');
const BACKUP_DIR = path.join(APP_DIR, 'backups');
const RETENTION_DAYS = 14;   // keep this many days of automatic backups

// ── ONE BUILDER, AND EVERY BACKUP SAYS WHAT IT IS (maintainer, Sep 23 2026) ──────────
// Every backup this unit makes comes from createBackup(): the nightly, the copies
// to SD and USB, the owner's download plain or encrypted, the off-site pull. The
// plain download used to build its own file list and left out VERSION and the
// staff icon, so a backup could not say what had written it - and an owner's
// backup has to restore onto whatever the software is years from now, which
// starts with the backup knowing what it is.
// So every archive carries backup.json, written LAST from what went in:
//   writtenBy  the build that wrote it (VERSION: tag, commit, drift) and the Node
//   unit       this unit's id, the business, its timezone, the currency it charges in
//   schema     every table and its columns, exactly as this database has them
//   rows       every table's row count
//   files      every file in the archive with its size and SHA-256
//   excluded   every site photo and video left out, with its size (below)
// A restore reads it and says what it restored from; a backup made before this
// has none and restores exactly as it always did.
const MANIFEST_NAME = 'backup.json';
const MANIFEST_FORMAT = 1;
const BACKUP_FILES = ['bookings.db', 'config.json', 'VERSION', path.join('public', 'staff-icon.png')];
const BACKUP_DIRS  = [path.join('waivers', 'uploads'), path.join('waivers', 'signed'), path.join('public', 'uploads'), path.join('public', 'icons')];
const posix = rel => rel.split(path.sep).join('/');

// WHAT A BACKUP LEAVES OUT, AND SAYS SO (maintainer, Sep 23 2026): "A backup keeps
// everything important - database, config, settings, waivers and documents -
// and leaves out site photos and video, which owners re-upload." They are the
// only thing that can make a backup huge (a single video can be 500 MB), and
// the owner has the originals. The manifest lists every file left out, so a
// restore can tell the owner exactly what to put back.
function leftOut(relPosix) {
  const base = relPosix.split('/').pop();
  if (base.startsWith('.')) return 'working file';                                   // .staging-*, .gitkeep
  if (relPosix.startsWith('public/uploads/landing/')) return 'site photos and video';  // the website's photos and video
  if (/^public\/uploads\/hero\.[a-z0-9]+$/i.test(relPosix)) return 'site photos and video';   // the booking page's hero photo
  return null;
}

// Everything that goes in, in order - and everything left out, with its size.
// Top-level files are COPIED to a staging folder first and archived from the
// copy, so the bytes hashed are the bytes archived (the database can be flushed
// again a moment later) without ever holding a file in memory.
function backupEntries(stageDir) {
  const out = [], excluded = [];
  for (const rel of BACKUP_FILES) {
    const full = path.join(APP_DIR, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    if (stageDir) {
      const staged = path.join(stageDir, posix(rel).replace(/\//g, '__'));
      fs.copyFileSync(full, staged);
      out.push({ rel: posix(rel), full: staged });
    } else out.push({ rel: posix(rel), full });
  }
  const walk = (dirRel) => {
    const full = path.join(APP_DIR, dirRel);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return;
    for (const ent of fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = path.join(dirRel, ent.name);
      if (ent.isDirectory()) { walk(r); continue; }
      if (!ent.isFile()) continue;
      const why = leftOut(posix(r));
      if (why === 'site photos and video') excluded.push({ path: posix(r), bytes: fs.statSync(path.join(APP_DIR, r)).size });
      if (why) continue;
      out.push({ rel: posix(r), full: path.join(APP_DIR, r) });
    }
  };
  for (const d of BACKUP_DIRS) walk(d);
  return { entries: out, excluded };
}

// WHAT A BACKUP HOLDS, BEFORE THE OWNER DOWNLOADS IT (maintainer, Sep 23 2026): each
// part with its size, the total, and what is left out - from the same list the
// builder uses, so the screen can never disagree with the file.
function contents() {
  const { entries, excluded } = backupEntries(null);
  const part = rel => rel === 'bookings.db' ? 'database'
    : (rel === 'config.json' || rel === 'VERSION') ? 'settings'
    : rel.startsWith('waivers/signed/') ? 'signed'
    : rel.startsWith('waivers/uploads/') ? 'waiverDocs'
    : rel.startsWith('public/uploads/docs/') ? 'documents'
    : 'branding';                                           // logo, app icons, the staff app's icon
  const LABEL = { database: 'Bookings, members, money and history (the database)', settings: 'Settings', signed: 'Signed waivers',
                  waiverDocs: 'Waiver documents', documents: 'Documents (your PDF pages)', branding: 'Logo and app icons' };
  const parts = {};
  for (const k of Object.keys(LABEL)) parts[k] = { label: LABEL[k], files: 0, bytes: 0 };
  for (const e of entries) { const k = part(e.rel); parts[k].files++; parts[k].bytes += fs.statSync(e.full).size; }
  const total = Object.values(parts).reduce((t, p) => t + p.bytes, 0);
  const leftBytes = excluded.reduce((t, x) => t + x.bytes, 0);
  return { parts: Object.values(parts), total_bytes: total,
           left_out: { label: 'Site photos and video', note: 'Not in the backup - you have the originals; re-upload them in Website after a restore.', files: excluded.length, bytes: leftBytes } };
}

function buildManifest(entries, excluded) {
  const cfg = configService.getConfig();
  const v = require('./version').current(APP_DIR);
  const tables = Object.create(null), rows = Object.create(null);
  try {
    const D = dbModule.db;
    const columns = D.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid');
    for (const t of D.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()) {
      // A restored database controls its table names. Bind metadata arguments
      // and quote the identifier where SQLite does not accept a placeholder.
      const identifier = '"' + t.name.replace(/"/g, '""') + '"';
      tables[t.name] = columns.all(t.name).map(c => c.name);
      rows[t.name] = (D.prepare(`SELECT COUNT(*) AS n FROM ${identifier}`).get() || {}).n || 0;
    }
  } catch (e) { tables.__error = String(e && e.message || e); }
  return {
    format: 'ba-booking-backup',
    formatVersion: MANIFEST_FORMAT,
    createdAt: new Date().toISOString(),
    writtenBy: { tag: v.tag, commit: v.commit, drift: v.drift, versionDate: v.date, node: process.version },
    unit: {
      id: (cfg.unit && cfg.unit.id) || null,
      business: (cfg.server && cfg.server.businessName) || cfg.businessName || '',
      timezone: (cfg.server && cfg.server.timezone) || null,
      currency: 'usd'                               // every charge this product makes is in USD (routes/bookings, gifts, memberships)
    },
    schema: { tables },
    rows,
    files: entries.map(e => ({ path: e.rel, bytes: fs.statSync(e.full).size, sha256: sha256File(e.full) })),
    excluded: { what: 'site photos and video - the owner re-uploads them', files: excluded || [] }
  };
}

// Create one backup zip now. Returns a Promise that resolves to the file path.
function createBackup() {
  return new Promise((resolve, reject) => {
    try { dbModule.save(); } catch {}
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    // EACH BACKUP ITS OWN FILE (Oct 3 2026): named by the second, two backups started in the same second - the nightly and
    // a scheduled off-site pull, an owner's download and a pull - wrote ONE file at once, and the off-site copy came out
    // with a corrupt backup.json (bad CRC, seen in test-backup-vault). The name is reserved with an exclusive create;
    // a second in the same second is -2, a third -3. Everything that reads these names reads the prefix and the file time.
    let outPath, fd;
    try {
      for (let n = 1; ; n++) {
        outPath = path.join(BACKUP_DIR, `auto-backup-${stamp}${n > 1 ? '-' + n : ''}.zip`);
        try { fd = fs.openSync(outPath, 'wx'); break; } catch (e) { if (e.code !== 'EEXIST' || n >= 100) throw e; }
      }
    } catch (e) { return reject(e); }
    try { require('./db').flushSync(); } catch {}   // the file must hold every statement before it is archived (W22)
    let stage = null, entries, manifest;
    const cleanup = () => { if (stage) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} } };
    try {
      stage = fs.mkdtempSync(path.join(workRoot(), 'stage-'));
      const got = backupEntries(stage);
      entries = got.entries; manifest = buildManifest(entries, got.excluded);
    } catch (e) { cleanup(); try { fs.closeSync(fd); fs.unlinkSync(outPath); } catch {} return reject(e); }

    const output  = fs.createWriteStream(outPath, { fd });
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => { cleanup(); resolve(outPath); });
    archive.on('error', e => { cleanup(); reject(e); });
    archive.pipe(output);
    for (const e of entries) archive.file(e.full, { name: e.rel });
    archive.append(JSON.stringify(manifest, null, 2) + '\n', { name: MANIFEST_NAME });
    archive.finalize().catch(e => { cleanup(); reject(e); });
  });
}

// WHERE A BACKUP IS BUILT, OPENED AND RESTORED: ON THE CARD, NEVER IN /tmp
// (maintainer, Sep 23 2026). /tmp on these units is memory (tmpfs - half the RAM), and
// a restore used to write the upload, the decrypted copy and the unpacked files
// there: three copies of the biggest file the unit ever handles, in RAM. The
// work folder lives beside the backups, on the SD card.
// A folder a power cut left behind is cleared the next time the folder is used.
function workRoot() {
  const d = path.join(BACKUP_DIR, '.work');
  fs.mkdirSync(d, { recursive: true });
  try {
    const stale = Date.now() - 24 * 3600000;
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      try { if (fs.statSync(full).mtimeMs < stale) fs.rmSync(full, { recursive: true, force: true }); } catch {}
    }
  } catch {}
  return d;
}
function workDir(prefix) { return fs.mkdtempSync(path.join(workRoot(), (prefix || 'w') + '-')); }
// Free space where backup work happens.
function freeBytes() {
  if (process.env.BA_TEST_FREE_BYTES) return Number(process.env.BA_TEST_FREE_BYTES);
  try { const st = fs.statfsSync(workRoot()); return st.bavail * st.bsize; } catch { return null; }
}
function diskSpace() {
  const free = freeBytes();
  const need = 300 * 1024 * 1024;
  const low = free !== null && free < need;
  return { free, need, low, message: low ?
    `Low on space: ${Math.round(free / 1048576)} MB free. Remove old backups you no longer need or unused website uploads.` : null };
}
// Room to restore a backup of `bytes`: the file, its decrypted copy, what it
// unpacks to (a database compresses about four to one), and a margin.
function restoreRoom(bytes) {
  const need = Math.ceil((bytes || 0) * 6) + 200 * 1024 * 1024;
  const free = freeBytes();
  return { ok: free === null || free >= need, free, need,
           message: `There is not enough free space on this unit to restore a backup this size (${Math.round((bytes || 0) / 1048576)} MB needs about ${Math.round(need / 1048576)} MB free, ${free === null ? 'unknown' : Math.round(free / 1048576) + ' MB'} is free). Free some space (Settings > Protection shows what is using it) and try again.` };
}

// What an extracted backup says about itself, or null for one made before
// backups carried a manifest (they restore exactly as before).
function readManifest(extractedDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(extractedDir, MANIFEST_NAME), 'utf8'));
    return (m && m.format === 'ba-booking-backup') ? m : null;
  } catch { return null; }
}
// What the owner has to put back by hand after restoring this backup: the site
// photos and video it left out. Nothing for a backup made before the rule
// (it carried them) or one made with none on the unit.
function leftOutOf(m) {
  const files = (m && m.excluded && Array.isArray(m.excluded.files)) ? m.excluded.files : [];
  if (!files.length) return null;
  return { files: files.length, bytes: files.reduce((t, f) => t + (f.bytes || 0), 0),
           message: `This backup left out ${files.length} site photo${files.length === 1 ? '' : 's'} and video${files.length === 1 ? '' : 's'} (${Math.max(1, Math.round(files.reduce((t, f) => t + (f.bytes || 0), 0) / 1048576))} MB) - backups never carry them. ${whereBack(files)}` };
}
// Where each one goes back (Oct 19 2026, the guide audit): the booking page's hero photo is uploaded on Settings > Business
// & Content > Branding & Theme, not in Website - "Re-upload them in Website" sent an owner looking for it in the wrong place.
function whereBack(files) {
  const names = list => list.slice(0, 8).map(f => f.path.split('/').pop()).join(', ') + (list.length > 8 ? ', and ' + (list.length - 8) + ' more' : '');
  const hero = files.filter(f => /^public\/uploads\/hero\.[a-z0-9]+$/i.test(f.path)), site = files.filter(f => !hero.includes(f));
  return [site.length ? `Re-upload them in Website: ${names(site)}.` : '',
          hero.length ? `The booking page's hero photo (${names(hero)}) goes back in Settings > Business & Content > Branding & Theme.` : ''].filter(Boolean).join(' ');
}
// One line for the owner's log and the restore screen.
function describeManifest(m) {
  if (!m) return 'a backup from before backups described themselves (no backup.json)';
  const w = m.writtenBy || {};
  return `made ${String(m.createdAt || '').slice(0, 16).replace('T', ' ')} UTC by ${w.tag || 'unknown'}${w.drift != null ? ' (drift ' + w.drift + ')' : ''}${m.unit && m.unit.business ? ' for ' + m.unit.business : ''}`;
}

// Delete automatic backups older than the retention window.
function pruneOld() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!f.startsWith('auto-backup-') || !/\.(zip|baenc)$/.test(f)) continue;   // the encrypted sibling prunes with its zip
      const full = path.join(BACKUP_DIR, f);
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch {}
    }
  } catch {}
}

// Run a nightly backup + prune. Safe to call from the scheduler.
async function runNightly() {
  try {
    const p = await createBackup();
    pruneOld();
    try { dbModule.adminLog('AUTO_BACKUP', path.basename(p)); } catch {}
    return p;
  } catch (e) {
    try { dbModule.adminLog('AUTO_BACKUP_FAILED', e.message); } catch {}
    return null;
  }
}

// List available automatic backups (newest first).
function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('auto-backup-') && f.endsWith('.zip'))
      .map(f => {
        const full = path.join(BACKUP_DIR, f);
        const st = fs.statSync(full);
        return { name: f, size: st.size, date: st.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch { return []; }
}


// ═══ v2 (Backup Wave, Aug 2026) ═══════════════════════════════════════════════

const crypto = require('crypto');
const configService = require('./config');

// ── RESTORE (fixes the flat-readdir bug: directories in the archive now
//    restore recursively through an ALLOWLIST — waivers + images + icons). ──
const RESTORE_FILES = [
  ['config.json', 'config.json'],
  ['bookings.db', 'bookings.db'],
  ['public/staff-icon.png', 'public/staff-icon.png']
];
const RESTORE_DIRS = [
  ['waivers/uploads',  'waivers/uploads'],
  ['waivers/signed',   'waivers/signed'],
  ['public/uploads',   'public/uploads'],
  ['public/icons',     'public/icons']
];

function copyDirInto(srcDir, destDir) {
  let n = 0;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) n += copyDirInto(s, d);
    else if (entry.isFile()) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

// Copies known content out of an extracted backup into the app dir.
// Handles BOTH shapes: directory-structured archives (the generator's output)
// and legacy flat archives (loose pdfs / logo* / hero* / icon-* at the root).
function restoreFromExtracted(tmpDir, appDir) {
  const restored = [];
  const flat = (src, dest, label) => {
    const sp = path.join(tmpDir, src);
    if (fs.existsSync(sp) && fs.statSync(sp).isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(sp, dest);
      if (label && !restored.includes(label)) restored.push(label);
      return true;
    }
    return false;
  };
  for (const [src, dest] of RESTORE_FILES) {
    const label = src === 'config.json' ? 'config'
                : src === 'bookings.db' ? 'database' : 'staff app icon';
    flat(src, path.join(appDir, dest), label);
  }

  for (const [rel, destRel] of RESTORE_DIRS) {
    const sp = path.join(tmpDir, rel);
    if (fs.existsSync(sp) && fs.statSync(sp).isDirectory()) {
      const n = copyDirInto(sp, path.join(appDir, destRel));
      if (n) {
        const label = rel.startsWith('waivers') ? (rel.endsWith('signed') ? 'signed waivers' : 'waivers') : 'images';
        if (!restored.includes(label)) restored.push(label);
      }
    }
  }
  // Legacy flat archives
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.endsWith('.pdf') && !f.startsWith('signed_')) flat(f, path.join(appDir, 'waivers', 'uploads', f), 'waivers');
    else if (f.startsWith('signed_') && f.endsWith('.pdf')) flat(f, path.join(appDir, 'waivers', 'signed', f), 'signed waivers');
    else if (f.startsWith('logo') || f.startsWith('hero')) flat(f, path.join(appDir, 'public', 'uploads', f), 'images');
    else if (f.startsWith('icon-') && f.endsWith('.png')) flat(f, path.join(appDir, 'public', 'icons', f), null);
  }
  return restored;
}

// ── VERIFICATION ──
// In pieces (Sep 23 2026) - a file is never read whole to be hashed.
function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try { const buf = Buffer.alloc(4 * 1024 * 1024); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function looksLikeZip(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0);
    const st = fs.fstatSync(fd);
    const tailLen = Math.min(st.size, 66000);
    const tail = Buffer.alloc(tailLen); fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
    fs.closeSync(fd);
    return head.readUInt32LE(0) === 0x04034b50 && tail.includes(Buffer.from([0x50,0x4b,0x05,0x06])) && st.size > 200;
  } catch { return false; }
}

// ── REMOVABLE-DESTINATION DETECTION ──
// Scans mounted removable storage (Pi OS mounts under /media/<user>/<label>;
// manual mounts under /mnt). Classifies sd vs usb from the block device.
let SCAN_ROOTS = process.env.BA_BACKUP_SCAN_ROOTS
  ? process.env.BA_BACKUP_SCAN_ROOTS.split(':')
  : ['/media', '/mnt'];
function _setScanRootsForTest(roots) { SCAN_ROOTS = roots; }

function deviceForMount(mountPath) {
  try {
    const rows = fs.readFileSync('/proc/mounts', 'utf8').split('\n');
    let best = null;
    for (const row of rows) {
      const [dev, mp] = row.split(' ');
      if (mp && mountPath.startsWith(mp) && (!best || mp.length > best.mp.length)) best = { dev, mp };
    }
    return best ? best.dev : null;
  } catch { return null; }
}
function classifyDevice(dev, mountPath) {
  const base = (dev || '').replace('/dev/', '');
  if (/^mmcblk/.test(base)) return 'sd';
  if (/^sd[a-z]/.test(base) || /^nvme/.test(base) === false && /usb/i.test(mountPath)) return 'usb';
  // test-hook friendliness: path hints when /proc/mounts gives no answer
  if (/sd[-_ ]?card|mmc/i.test(mountPath)) return 'sd';
  if (/usb/i.test(mountPath)) return 'usb';
  return 'usb';
}

function detectCommunityDestinations() {
  const mediaRoot = '/media/ba-core';
  let mounts;
  try { mounts = fs.readFileSync('/proc/self/mounts', 'utf8').split('\n'); }
  catch { return []; }

  const out = [];
  const seen = new Set();
  for (const row of mounts) {
    const [device, encodedPath] = row.split(' ');
    if (!encodedPath) continue;
    const mount = encodedPath.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    if (path.dirname(mount) !== mediaRoot || seen.has(mount)) continue;
    seen.add(mount);

    try {
      // Probe the actual mount so an empty mountpoint on the Pi's boot drive
      // can never count as a second backup destination.
      const probe = fs.mkdtempSync(path.join(mount, '.ba-write-probe-'));
      fs.rmdirSync(probe);
      let free = null;
      try { const stat = fs.statfsSync(mount); free = stat.bavail * stat.bsize; } catch {}
      out.push({ kind: classifyDevice(device, mount), mount, label: path.basename(mount), free });
    } catch { /* unwritable mount */ }
  }
  return out;
}

function detectDestinations() {
  if (process.env.BA_CORE_COMMUNITY === '1') return detectCommunityDestinations();
  const out = [];
  for (const root of SCAN_ROOTS) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const a of fs.readdirSync(root, { withFileTypes: true })) {
        if (!a.isDirectory()) continue;
        const level1 = path.join(root, a.name);
        const candidates = [];
        // /media/<user>/<label> nests one deeper; /mnt/<label> does not
        let hasSub = false;
        try {
          for (const b of fs.readdirSync(level1, { withFileTypes: true })) {
            if (b.isDirectory()) { hasSub = true; candidates.push(path.join(level1, b.name)); }
          }
        } catch {}
        if (!hasSub) candidates.push(level1);
        for (const mount of candidates) {
          try {
            // real write-probe: some filesystems lie to accessSync
            const probe = path.join(mount, '.ba-write-probe');
            fs.writeFileSync(probe, 'x'); fs.unlinkSync(probe);
            const dev = deviceForMount(mount);
            const kind = classifyDevice(dev, mount);
            let free = null;
            try { const sv = fs.statfsSync(mount); free = sv.bavail * sv.bsize; } catch {}
            out.push({ kind, mount, label: path.basename(mount), free });
          } catch { /* unwritable — skip */ }
        }
      }
    } catch {}
  }
  return out;
}

// ── PER-DESTINATION COPY + VERIFY + RETENTION + STATUS ──
const MEDIA_SUBDIR = 'BA-Backups';
function backupFileName(cfg) {
  const biz = ((cfg.server && cfg.server.businessName) || 'facility').replace(/[^a-zA-Z0-9]/g, '-');
  const st = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `BA-FULLDB-${biz}-${st}.zip`;
}
function writeStatus(destKey, status) {
  try {
    const cfg = configService.getConfig();
    cfg.backup = cfg.backup || {};
    cfg.backup.status = cfg.backup.status || {};
    cfg.backup.status[destKey] = status;
    configService.saveConfig(cfg);
  } catch {}
}
function pruneMedia(dir) {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    let newestKept = null;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('BA-FULLDB-') && /\.(zip|baenc)$/.test(f));
    for (const f of files) {
      const full = path.join(dir, f);
      const m = fs.statSync(full).mtimeMs;
      if (!newestKept || m > newestKept.m) newestKept = { f, m };
    }
    for (const f of files) {
      const full = path.join(dir, f);
      if (newestKept && f === newestKept.f) continue;         // never prune the newest
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch {}
    }
  } catch {}
}
function copyBackupTo(dest, srcZipIn) {
  const key = dest.kind;
  // A copy on a stick or a card someone can pull out LEAVES the unit: made
  // encrypted, or not at all (maintainer, Sep 23 2026). Paused is not failed - the
  // unit did what it was told; the health line says why it is paused.
  if (!require('./backupvault').vaultState().set) {
    const st = { ok: false, paused: true, at: new Date().toISOString(), error: 'Paused - no backup passphrase is set, and a copy that leaves this unit is only ever made encrypted', mount: dest.mount };
    writeStatus(key, st);
    try { dbModule.adminLog('BACKUP_DESTINATION_PAUSED', `${key}: no backup passphrase - nothing copied`); } catch {}
    return st;
  }
  try {
    const dir = path.join(dest.mount, MEDIA_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    const cfg = configService.getConfig();
    // THE VAULT: a copy that leaves the unit is encrypted when a passphrase is set
    const vault = require('./backupvault');
    const srcZip = vault.offsiteCopyOf(srcZipIn);
    const encrypted = srcZip !== srcZipIn;
    const out = path.join(dir, backupFileName(cfg).replace(/\.zip$/, encrypted ? '.baenc' : '.zip'));
    fs.copyFileSync(srcZip, out);
    const okZip = encrypted ? vault.isEncrypted(out) : looksLikeZip(out);
    const okSha = sha256File(out) === sha256File(srcZip);
    if (!okZip || !okSha) {
      try { fs.unlinkSync(out); } catch {}
      throw new Error('verification failed');
    }
    pruneMedia(dir);
    const st = { ok: true, at: new Date().toISOString(), file: path.basename(out),
                 bytes: fs.statSync(out).size, verified: true, encrypted, mount: dest.mount };
    writeStatus(key, st);
    try { dbModule.adminLog('BACKUP_DESTINATION_SUCCESS', `${key}: ${st.file}`); } catch {}
    return st;
  } catch (e) {
    const st = { ok: false, at: new Date().toISOString(), error: e.message, mount: dest.mount };
    writeStatus(key, st);
    try { dbModule.adminLog('BACKUP_DESTINATION_FAILED', `${key}: ${e.message}`); } catch {}
    return st;
  }
}

// Chosen destinations for tonight, from config: 'sd' | 'usb' | 'both' | 'off'
function chosenKinds() {
  const cfg = configService.getConfig();
  const b = cfg.backup || {};
  if (b.enabled === false) return [];
  const d = b.destination || 'off';
  if (d === 'both') return ['sd', 'usb'];
  if (d === 'sd' || d === 'usb') return [d];
  return [];
}

// Full nightly: local zip (as always) + copies to each chosen removable
// destination, each independent — one offline target never blocks another.
async function runNightlyV2() {
  const localPath = await runNightly();          // existing behavior preserved
  const kinds = chosenKinds();
  if (!kinds.length || !localPath) return { localPath, copies: [] };
  const detected = detectDestinations();
  const copies = [];
  for (const kind of kinds) {
    const dest = detected.find(d => d.kind === kind);
    if (!dest) {
      const st = { ok: false, at: new Date().toISOString(), error: kind.toUpperCase() + ' storage not detected' };
      writeStatus(kind, st);
      try { dbModule.adminLog('BACKUP_DESTINATION_FAILED', kind + ': not detected'); } catch {}
      copies.push({ kind, ...st });
      continue;
    }
    copies.push({ kind, ...copyBackupTo(dest, localPath) });
  }
  return { localPath, copies };
}

/**
 * Hourly tick. Runs the nightly backup once per day at the configured hour -
 * OR AS SOON AFTER AS POSSIBLE.
 *
 * The old version demanded an exact hour match and kept "did I run today" in
 * memory. Two ways a facility silently lost a night: the Pi was off,
 * rebooting or mid-update at that exact hour, or it restarted afterwards and
 * forgot. A facility whose Pi reboots at 3am with backups set to 3am could go
 * weeks with no backup and no warning. Same lesson as the automation ledger:
 * catch up, and remember on disk.
 */
function localYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
async function maybeNightlyTick(now = new Date()) {
  const cfg = configService.getConfig();
  const hour = Number((cfg.backup && cfg.backup.hour) ?? 3);
  // the day in the SAME clock as the hour below (Oct 2026): the UTC date turned at 7 PM Central, so
  // "done today" went false every evening and the nightly ran then - logged as caught up - every day
  const today = localYmd(now);
  const b = cfg.backup || {};
  if (b.lastNightlyDate === today) return null;                            // already done today
  if (now.getHours() < hour) return null;                                  // not yet due
  // A-wave 4 (Sep 11 2026, rule 22): the day used to be marked DONE before the
  // backup was written - a process killed mid-zip left "done today" on disk
  // and no zip, and the next tick did nothing until tomorrow. Now a run marks
  // itself STARTED (a lease of 55 minutes, so the hourly tick never runs two
  // at once) and marks the day done only when the backup exists; a run that
  // died leaves its stale start behind and the next tick past the lease runs
  // it again. The per-destination result is kept (rule 23 reads it).
  const startedMs = b.lastNightlyStartedAt ? Date.parse(b.lastNightlyStartedAt) : 0;
  if (startedMs && now.getTime() - startedMs < 55 * 60000 && b.lastNightlyStartedFor === today) return null;   // a run is (or was, minutes ago) under way
  try {
    const c = configService.getConfig();
    c.backup = Object.assign({}, c.backup, { lastNightlyStartedAt: now.toISOString(), lastNightlyStartedFor: today });
    configService.saveConfig(c);
  } catch {}
  const late = now.getHours() > hour;
  if (late) {
    try { dbModule.adminLog('BACKUP_CAUGHT_UP', `scheduled ${hour}:00, ran ${now.getHours()}:00`); } catch {}
  }
  const result = await runNightlyV2();
  const ok = !!(result && result.localPath) && (result.copies || []).every(c => c.ok !== false || c.paused);
  try {
    const c = configService.getConfig();
    c.backup = Object.assign({}, c.backup, {
      lastNightly: { date: today, at: new Date().toISOString(), ok, local: result && result.localPath ? path.basename(result.localPath) : null, copies: (result && result.copies) || [] }
    });
    if (result && result.localPath) c.backup.lastNightlyDate = today;   // done only when the backup exists
    // the lease is for a run that DIED; a finished run releases it (set to null - saveConfig merges, a deleted key would survive on disk)
    c.backup.lastNightlyStartedAt = null; c.backup.lastNightlyStartedFor = null;
    configService.saveConfig(c);
  } catch {}
  if (!(result && result.localPath)) { try { dbModule.adminLog('BACKUP_NIGHT_MISSED', `the nightly backup for ${today} did not produce a file - it will be retried on the next hourly tick`); } catch {} }
  return result;
}

// ── STATUS REPORT for the admin card ──
function statusReport() {
  const cfg = configService.getConfig();
  const b = cfg.backup || {};
  const detected = detectDestinations();
  const local = listBackups()[0] || null;
  const lastManual = b.lastManualDownload || null;
  const days = lastManual ? Math.floor((Date.now() - Date.parse(lastManual)) / 86400000) : null;
  const active = (b.enabled !== false) && (b.destination === 'sd' || b.destination === 'usb' || b.destination === 'both');
  const anyVerified = ['sd','usb'].some(k => b.status && b.status[k] && b.status[k].ok);
  const level = anyVerified && active ? 1 : 0;   // 0 = attention, 1 = basic local-media
  return {
    settings: { enabled: b.enabled !== false, destination: b.destination || 'off', hour: Number(b.hour ?? 3) },
    detected: detected.map(d => ({ kind: d.kind, label: d.label, free: d.free })),
    status: b.status || {},
    localLatest: local,
    lastManualDownload: lastManual,
    offsiteReminderDue: days !== null ? days > 30 : true,
    protectionLevel: level
  };
}

module.exports = { createBackup, pruneOld, runNightly, listBackups, BACKUP_DIR, RETENTION_DAYS, readManifest, describeManifest, MANIFEST_NAME, contents, workDir, restoreRoom, freeBytes, diskSpace, leftOutOf,
  restoreFromExtracted, sha256File, looksLikeZip, detectDestinations, copyBackupTo,
  runNightlyV2, maybeNightlyTick, statusReport, _setScanRootsForTest, MEDIA_SUBDIR };

