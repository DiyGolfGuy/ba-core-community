// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// services/backupvault.js - THE VAULT (maintainer, Aug 25/26 2026).
//
// A backup zip IS the facility: bookings.db, config.json (with every
// integration secret in plain text - correct on the unit, dangerous anywhere
// else), waivers, signed records, images. So every copy that LEAVES the
// unit is encrypted with a passphrase the owner sets, and restore asks for
// it - the same model Synology, UniFi, and Home Assistant use.
//
//   Format (.baenc): "BAENC1" | salt(16) | iv(12) | ciphertext | tag(16)
//   Key: scrypt(passphrase, salt, N=2^15, r=8, p=1) -> 32 bytes, AES-256-GCM.
//   The header carries the salt, so a fresh unit needs only the passphrase.
//   The unit caches the derived key + salt in config.backup.vault to encrypt
//   nightly without asking (that cache travels inside the ciphertext of its
//   own backup - it never leaves the unit in the clear).
//
// Destinations already exist in services/backup.js (nightly copy to the SD
// card and/or a USB stick, hash-verified, pruned). This file adds the
// encryption layer those copies and the off-site pull ride on, plus "My
// computer" - a pull, not a push: the owner installs a ready-made scheduled
// task (generated here with their address and token filled in) and their
// computer fetches the encrypted copy every night. 3-2-1: three copies, two
// media, one off-site, all encrypted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const MAGIC = Buffer.from('BAENC1');
const SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function cfgSvc() { return require('./config'); }
function deriveKey(passphrase, salt) { return crypto.scryptSync(String(passphrase), salt, 32, SCRYPT); }

// ── passphrase lifecycle ─────────────────────────────────────────────────────
function vaultState() {
  const v = cfgSvc().getConfig().backup && cfgSvc().getConfig().backup.vault;
  return { set: !!(v && v.key && v.salt), set_at: v && v.set_at || null };
}
function setPassphrase(passphrase) {
  const p = String(passphrase || '');
  if (p.length < 10) throw new Error('Use at least 10 characters - a short phrase you will remember beats a password you will lose.');
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(p, salt);
  const cfg = cfgSvc().getConfig();
  cfg.backup = Object.assign({}, cfg.backup, { vault: { salt: salt.toString('hex'), key: key.toString('hex'), set_at: new Date().toISOString() } });
  cfgSvc().saveConfig(cfg);
  return vaultState();
}
function clearPassphrase() {
  // saveConfig deep-merges (a deleted key would survive); persist exactly
  const cfg = cfgSvc().getConfig();
  if (cfg.backup) delete cfg.backup.vault;
  if (typeof cfgSvc().writeConfigRaw === 'function') cfgSvc().writeConfigRaw(cfg); else cfgSvc().saveConfig(cfg);
  return vaultState();
}
function cachedKey() {
  const v = cfgSvc().getConfig().backup && cfgSvc().getConfig().backup.vault;
  if (!v || !v.key || !v.salt) return null;
  return { key: Buffer.from(v.key, 'hex'), salt: Buffer.from(v.salt, 'hex') };
}

// ── encrypt / decrypt ────────────────────────────────────────────────────────
function isEncrypted(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try { const b = Buffer.alloc(MAGIC.length); const n = fs.readSync(fd, b, 0, b.length, 0); return n === b.length && b.equals(MAGIC); }
    finally { fs.closeSync(fd); }
  } catch { return false; }
}

// IN PIECES, NEVER WHOLE (maintainer, Sep 23 2026). Both directions used to read the
// whole backup into memory - and refused anything over 512 MB - so a facility
// with ten years of waivers and a few photos would lose its encrypted copies
// exactly when it had the most to lose. They now read and write 4 MB at a time
// through a file handle: memory stays flat whatever the size. THE FORMAT IS
// UNCHANGED - "BAENC1" | salt | iv | one AES-256-GCM stream | tag - so a backup
// encrypted here opens on a unit running the old code, and the other way round
// (test-backup-vault proves both directions).
const CHUNK = 4 * 1024 * 1024;

// Encrypt a plain zip with the cached key (nightly) or an explicit passphrase.
function encryptFile(zipPath, outPath, opts = {}) {
  let key, salt;
  if (opts.passphrase) { salt = crypto.randomBytes(SALT_LEN); key = deriveKey(opts.passphrase, salt); }
  else { const c = cachedKey(); if (!c) throw new Error('No backup passphrase is set'); key = c.key; salt = c.salt; }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const tmp = outPath + '.tmp';
  const fin = fs.openSync(zipPath, 'r'), fout = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fout, Buffer.concat([MAGIC, salt, iv]));
    const buf = Buffer.alloc(CHUNK);
    let n;
    while ((n = fs.readSync(fin, buf, 0, CHUNK, null)) > 0) fs.writeSync(fout, cipher.update(buf.subarray(0, n)));
    const last = cipher.final(); if (last.length) fs.writeSync(fout, last);
    fs.writeSync(fout, cipher.getAuthTag());
    fs.fsyncSync(fout);
  } catch (e) { try { fs.closeSync(fout); } catch {} try { fs.unlinkSync(tmp); } catch {} fs.closeSync(fin); throw e; }
  fs.closeSync(fin); fs.closeSync(fout);
  fs.renameSync(tmp, outPath);
  return outPath;
}

// Decrypt with a passphrase (restore path - the unit may be brand new).
// Decrypt to MEMORY - nothing touches the disk (core-certs list, the worst-day
// "what is in this file before I restore it" read; maintainer, Sep 11 2026). For the
// small files that read is for; a backup goes through decryptFile.
function decryptBuffer(encPath, passphrase) {
  const buf = fs.readFileSync(encPath);
  if (buf.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1) throw new Error('Not an encrypted backup');
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted backup');
  let o = MAGIC.length;
  const salt = buf.subarray(o, o + SALT_LEN); o += SALT_LEN;
  const iv = buf.subarray(o, o + IV_LEN); o += IV_LEN;
  const tag = buf.subarray(buf.length - TAG_LEN);
  const body = buf.subarray(o, buf.length - TAG_LEN);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(body), decipher.final()]); }
  catch { throw new Error('Wrong passphrase, or the file was damaged in transit'); }
}
// Decrypt a backup to a file, in pieces. The tag is read from the END first; the
// plain output goes to a .tmp that becomes the real file ONLY once the tag has
// verified - a wrong passphrase or a damaged file leaves nothing behind.
function decryptFile(encPath, passphrase, outZipPath) {
  const fin = fs.openSync(encPath, 'r');
  const tmp = outZipPath + '.tmp';
  let fout = null;
  try {
    const size = fs.fstatSync(fin).size;
    const head = MAGIC.length + SALT_LEN + IV_LEN;
    if (size < head + TAG_LEN + 1) throw new Error('Not an encrypted backup');
    const hdr = Buffer.alloc(head); fs.readSync(fin, hdr, 0, head, 0);
    if (!hdr.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted backup');
    const salt = hdr.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
    const iv = hdr.subarray(MAGIC.length + SALT_LEN, head);
    const tag = Buffer.alloc(TAG_LEN); fs.readSync(fin, tag, 0, TAG_LEN, size - TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    fout = fs.openSync(tmp, 'w');
    const buf = Buffer.alloc(CHUNK);
    let pos = head; const end = size - TAG_LEN;
    while (pos < end) {
      const n = fs.readSync(fin, buf, 0, Math.min(CHUNK, end - pos), pos);
      if (n <= 0) break;
      pos += n;
      fs.writeSync(fout, decipher.update(buf.subarray(0, n)));
    }
    let last;
    try { last = decipher.final(); }
    catch { throw new Error('Wrong passphrase, or the file was damaged in transit'); }
    if (last.length) fs.writeSync(fout, last);
    fs.fsyncSync(fout);
    fs.closeSync(fout); fout = null;
  } catch (e) {
    if (fout !== null) { try { fs.closeSync(fout); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
    fs.closeSync(fin);
    throw e;
  }
  fs.closeSync(fin);
  fs.renameSync(tmp, outZipPath);
  return outZipPath;
}

// The file the outside world gets: encrypted when a passphrase is set,
// the plain zip otherwise (the admin says so, loudly).
function offsiteCopyOf(zipPath) {
  if (!cachedKey()) return zipPath;
  const enc = zipPath.replace(/\.zip$/i, '') + '.baenc';
  if (!fs.existsSync(enc) || fs.statSync(enc).mtimeMs < fs.statSync(zipPath).mtimeMs) encryptFile(zipPath, enc);
  return enc;
}

// ── "My computer": a ready-made nightly pull ────────────────────────────────
function pullScript(kind, baseUrl, token) {
  let base;
  try { base = new URL(baseUrl); } catch {}
  const host = base?.hostname || '';
  if (!base || !['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash ||
      (!/^[a-z0-9.-]+$/i.test(host) && !/^\[[0-9a-f:.]+\]$/i.test(host))) {
    throw new Error('Set the booking site address to an HTTP or HTTPS origin before downloading a backup script.');
  }
  const url = new URL('/api/backup/pull', base);
  url.searchParams.set('token', String(token));
  if (kind === 'mac') {
    // A shell single-quoted argument stays data even when it contains metacharacters.
    const quotedUrl = "'" + url.href.replace(/'/g, "'\"'\"'") + "'";
    return `#!/bin/bash
# BA Booking - nightly off-site backup pull (Mac / Linux). Save as ba-backup.sh,
# make it executable (chmod +x ba-backup.sh), then run once by hand to test.
# Install nightly:  (crontab -l; echo "15 4 * * * $HOME/ba-backup.sh") | crontab -
DEST="$HOME/BA-Backups"; mkdir -p "$DEST"
STAMP=$(date +%Y-%m-%d)
OUT="$DEST/offsite-backup-$STAMP.baenc"
curl -fsSL --proto '=http,https' --proto-redir '=http,https' ${quotedUrl} -o "$OUT" || { echo "pull failed"; exit 1; }
# ISO-date filenames sort oldest first. Keep spaces in each path intact.
shopt -s nullglob
backups=("$DEST"/offsite-backup-????-??-??.baenc)
for ((n = 0; n < \${#backups[@]} - 30; n++)); do
  rm -f -- "\${backups[n]}"
done
echo "saved $OUT"
`;
  }
  const quotedUrl = "'" + url.href.replace(/'/g, "''") + "'";
  return `# BA Booking - nightly off-site backup pull (Windows). Save as ba-backup.ps1 in
# your Documents folder, run it once by hand to test, then install nightly with:
#   schtasks /Create /SC DAILY /ST 04:15 /TN "BA Booking Backup" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \\"$env:USERPROFILE\\Documents\\ba-backup.ps1\\""
$dest = Join-Path $env:USERPROFILE 'BA-Backups'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd'
$out = Join-Path $dest "offsite-backup-$stamp.baenc"
Invoke-WebRequest -Uri ${quotedUrl} -OutFile $out -UseBasicParsing
# keep the newest 30
Get-ChildItem -LiteralPath $dest -File -Filter 'offsite-backup-????-??-??.baenc' | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Force
Write-Host "saved $out"
`;
}

// ── test restore: prove the newest backup is usable, without touching anything ─
async function testRestore(zipPathOverride) {
  const backup = require('./backup');
  const list = backup.listBackups();   // newest first: { name, size, date }
  const src = zipPathOverride || (list[0] && path.join(backup.BACKUP_DIR, list[0].name)) || null;
  if (!src) return { ok: false, error: 'No backup on this unit yet' };
  const room = backup.restoreRoom(fs.statSync(src).size);
  if (!room.ok) return { ok: false, error: room.message };
  const tmp = backup.workDir('testrestore');           // on the card, never /tmp (RAM) - Sep 23 2026
  try {
    execFileSync('unzip', ['-o', src, '-d', tmp], { timeout: 10 * 60000, stdio: 'ignore' });
    const out = { ok: true, file: path.basename(src), size: fs.statSync(src).size, counts: {} };
    const cfgPath = path.join(tmp, 'config.json');
    out.config_ok = false;
    try { const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); out.config_ok = !!c && typeof c === 'object'; out.business = c.server && c.server.businessName || null; } catch {}
    const dbPath = path.join(tmp, 'bookings.db');
    if (fs.existsSync(dbPath)) {
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();
      const db = new SQL.Database(fs.readFileSync(dbPath));
      const count = (t) => { try { const r = db.exec(`SELECT COUNT(*) FROM ${t}`); return r[0] ? r[0].values[0][0] : 0; } catch { return null; } };
      out.counts = { bookings: count('bookings'), members: count('members'), tiers: count('membership_tiers'), signed_waivers: count('signed_waivers'), tabs: count('tabs'), menu_items: count('menu_items') };
      db.close();
    } else out.ok = false;
    const dirCount = (d) => { try { return fs.readdirSync(path.join(tmp, d)).length; } catch { return 0; } };
    out.files = { waiver_documents: dirCount('waivers/uploads'), signed_records: dirCount('waivers/signed'), images: dirCount('public/uploads') };
    // What the backup says it is, and whether every file in it is the file it
    // wrote down (a backup from before backup.json has nothing to check against).
    const m = backup.readManifest(tmp);
    out.made_by = backup.describeManifest(m);
    out.left_out = backup.leftOutOf(m);
    if (m && Array.isArray(m.files)) {
      const bad = [];
      for (const f of m.files) {
        const p = path.join(tmp, f.path);
        if (!fs.existsSync(p) || backup.sha256File(p) !== f.sha256) bad.push(f.path);
      }
      out.checked = { files: m.files.length, damaged: bad.slice(0, 20), damaged_count: bad.length };
      if (bad.length) { out.ok = false; out.error = `${bad.length} file${bad.length === 1 ? '' : 's'} in this backup do not match what it recorded when it was made - it is damaged.`; }
    }
    return out;
  } catch (e) { return { ok: false, error: e.message }; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

// ── WHAT MAY LEAVE THE UNIT WITHOUT A PASSPHRASE (maintainer, Sep 23 2026) ─────────
// "Refuse USB and off-site without one, same for the quarterly waiver archive,
// amber signal when anything leaves unencrypted, on-unit copy stays plain."
// A copy on the unit's own card sits beside the live database, which is plain
// anyway - encrypting it would put the passphrase on the same card. Everything
// that LEAVES is either encrypted, refused, or recorded here so the health line
// goes amber (services/unithealth 'plaincopy') until the owner acknowledges it.
const NEEDS_PASSPHRASE = 'Set a backup passphrase first (Settings > Protection > Backups, step 1). A copy that leaves this unit carries your customers\' details and your payment, texting and door keys, so it is only ever made encrypted.';
function notePlainCopy(what) {
  try { require('./db').adminLog('BACKUP_LEFT_PLAIN', String(what || 'a copy').slice(0, 300)); } catch {}
}
// What a plain copy holds, said before it goes (the download, the year archive).
const PLAIN_HOLDS = 'This file is NOT encrypted. It holds your customers\' names, phone numbers and emails, every booking and signed waiver, and your Stripe, texting, email and door keys. Anyone who gets hold of it can read all of that.';

// Status for the admin card.
function status() {
  const b = cfgSvc().getConfig().backup || {};
  return { vault: vaultState(), pull_enabled: !!b.pullToken, pull_paused: !!b.pullToken && !vaultState().set, last_pull: b.lastPull || null, seen_ips: (b.pullSeenIps || []).length,
           needs_passphrase: NEEDS_PASSPHRASE, plain_holds: PLAIN_HOLDS };
}

module.exports = { vaultState, setPassphrase, clearPassphrase, isEncrypted, encryptFile, decryptFile, decryptBuffer, offsiteCopyOf,
                   pullScript, testRestore, status, notePlainCopy, NEEDS_PASSPHRASE, PLAIN_HOLDS };
