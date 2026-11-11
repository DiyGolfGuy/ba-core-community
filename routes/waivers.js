// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/waivers.js  —  Waiver Management API
// ═══════════════════════════════════════════════════════════════════════════════

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

const { getConfig }    = require('../services/config');
const { UPLOADS_DIR, SIGNED_DIR } = require('../services/waiver');

// ── MULTER SETUP ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

// ── AUTH ──────────────────────────────────────────────────────────────────────
function isAdmin(req) {
  // OWNER-ONLY: waiver documents are the facility's legal contracts (maintainer, Aug 20).
  return require('../services/auth').requestRole(req) === 'owner';
}

// ── DB helper — always fetched at call time so db is initialized ──────────────
function db() { return require('../services/db').db; }
function adminLog(e, d) { return require('../services/db').adminLog(e, d); }

// ── PUBLIC: ACTIVE WAIVER ─────────────────────────────────────────────────────
router.get('/active', (req, res) => {
  try {
    // Facility mode 'off' hides the waiver from customers entirely while
    // leaving the record and all signed archives intact (reversible).
    const wcfg = require('../services/memberwaiver').cfgWaiver();
    const mode = wcfg.mode;
    if (mode === 'off') return res.json({ hasWaiver: false, mode, collection: wcfg.collection });
    // ?tier=<id> resolves that tier's pinned document (falls back to the
    // facility active waiver) — the memberships join page signs the right doc.
    const tierId = String(req.query.tier || '').trim();
    const waiver = tierId
      ? require('../services/memberwaiver').docForTier(tierId)
      : db().prepare(`SELECT * FROM waivers WHERE active = 1 ORDER BY created_at DESC LIMIT 1`).get();
    if (!waiver) return res.json({ hasWaiver: false, mode, collection: wcfg.collection });
    res.json({ hasWaiver: true, mode, collection: wcfg.collection, id: waiver.id, name: waiver.name, version: waiver.version, filename: waiver.filename, createdAt: waiver.created_at });
  } catch (err) {
    res.json({ hasWaiver: false });
  }
});

// ── PUBLIC: DOES THIS BOOKING NEED A SIGNATURE HERE? ─────────────────────────
// The server-authoritative ask/skip decision for the booking page. Knowing a
// valid member PIN is the trust bar (same as validate-pin); the booking
// create route re-runs this decision independently — the client only renders.
router.get('/needed', (req, res) => {
  try {
    const mw = require('../services/memberwaiver');
    const pin = String(req.query.pin || '').trim();
    const member = pin ? require('../services/db').getMemberByPin(pin) : null;
    if (member) res.locals.pinOk = true;   // a right code never spends the guess budget
    const d = mw.waiverDecision({
      member,
      date: String(req.query.date || ''),
      start_time: String(req.query.start_time || '')
    });
    res.json(d);
  } catch (err) {
    // Fail safe: when the decision cannot be computed, the client asks.
    res.json({ show: true, enforce: true, source: 'online', member_waiver: null, doc: null, arrival_note: false });
  }
});

// ── PUBLIC: SERVE PDF ─────────────────────────────────────────────────────────
router.get('/file/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ── ADMIN: LIST ALL WAIVERS ───────────────────────────────────────────────────
router.get('/all', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const waivers = db().prepare(`SELECT * FROM waivers ORDER BY created_at DESC`).all();
  const enriched = waivers.map(w => {
    const fp   = path.join(UPLOADS_DIR, w.filename);
    const size = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
    return { ...w, fileSizeKb: Math.round(size / 1024) };
  });
  res.json(enriched);
});

// ── ADMIN: UPLOAD ─────────────────────────────────────────────────────────────
router.post('/upload', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  upload.single('waiver')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { name, version, description, setActive } = req.body;
    if (!name || !version) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Name and version are required' });
    }

    try {
      const id = uuidv4();
      if (setActive === 'true') {
        db().prepare(`UPDATE waivers SET active = 0`).run();
      }
      db().prepare(
        `INSERT INTO waivers (id, name, filename, version, description, active) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, name.trim(), req.file.filename, version.trim(), description?.trim() || '', setActive === 'true' ? 1 : 0);

      adminLog('WAIVER_UPLOADED', `${name} v${version} | ${req.file.filename}`);
      res.json({ success: true, id, filename: req.file.filename });
    } catch (dbErr) {
      res.status(500).json({ error: 'Database error: ' + dbErr.message });
    }
  });
});

// ── ADMIN: SET ACTIVE ─────────────────────────────────────────────────────────
router.post('/set-active/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const waiver = db().prepare(`SELECT * FROM waivers WHERE id = ?`).get(req.params.id);
  if (!waiver) return res.status(404).json({ error: 'Waiver not found' });
  db().prepare(`UPDATE waivers SET active = 0`).run();
  db().prepare(`UPDATE waivers SET active = 1 WHERE id = ?`).run(req.params.id);
  adminLog('WAIVER_ACTIVATED', `${waiver.name} v${waiver.version}`);
  res.json({ success: true });
});

// ── ADMIN: DELETE ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const waiver = db().prepare(`SELECT * FROM waivers WHERE id = ?`).get(req.params.id);
  if (!waiver) return res.status(404).json({ error: 'Waiver not found' });
  if (waiver.active) return res.status(400).json({ error: 'Cannot delete the active waiver. Set another as active first.' });

  const count = db().prepare(`SELECT COUNT(*) as c FROM signed_waivers WHERE waiver_id = ?`).get(req.params.id);
  if (count?.c > 0) return res.status(400).json({ error: `${count.c} customer(s) signed this waiver — cannot delete.` });

  const fp = path.join(UPLOADS_DIR, waiver.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db().prepare(`DELETE FROM waivers WHERE id = ?`).run(req.params.id);
  adminLog('WAIVER_DELETED', `${waiver.name} v${waiver.version}`);
  res.json({ success: true });
});

// ── ADMIN: LIST SIGNED ────────────────────────────────────────────────────────
router.get('/signed', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { search, date } = req.query;
  let records = db().prepare(`SELECT * FROM signed_waivers ORDER BY agreed_at DESC LIMIT 500`).all();
  if (search) {
    const s = search.toLowerCase();
    records = records.filter(r => r.customer_name.toLowerCase().includes(s) || r.customer_phone.includes(s));
  }
  if (date) records = records.filter(r => r.session_date === date);
  res.json(records);
});

// ── ADMIN: DOWNLOAD SIGNED ────────────────────────────────────────────────────
router.get('/signed/:id/download', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const record = db().prepare(`SELECT * FROM signed_waivers WHERE id = ?`).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  const filePath = path.join(SIGNED_DIR, record.signed_pdf_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not on disk' });
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Disposition', `attachment; filename="${record.signed_pdf_path}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ── ADMIN: THE EVIDENCE PACKET (W37) ─────────────────────────────────────────
// One download per signature: the readable record, every stored row exactly as
// it sits in the database, the document reference - and the line that is the
// whole reason the fingerprint is stored, saying whether the file on this unit
// is still the one that was signed.
//
// Rule 15: this reports what was recorded. It does not say the document is
// valid, sufficient or enforceable, and nothing here cites law.
router.get('/signed/:id/packet', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const row = db().prepare(`SELECT * FROM signed_waivers WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  const mw = require('../services/memberwaiver');
  const v = mw.verifySigned(row);
  const line = mw.verifyLine(v);
  const cfg = require('../services/config').getConfig();
  const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let record = '';
  try {
    const fp = path.join(SIGNED_DIR, row.signed_pdf_path || '');
    if (row.signed_pdf_path && fs.existsSync(fp)) record = fs.readFileSync(fp, 'utf8');
  } catch {}
  const rows = Object.keys(row).map(k =>
    `<tr><th>${esc(k)}</th><td>${esc(row[k] === null ? '' : row[k])}</td></tr>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence packet - ${esc(row.customer_name)} - ${esc(row.agreed_at)}</title>
<style>
 body{font-family:Georgia,serif;font-size:13px;color:#1a1a1a;background:#fff;max-width:820px;margin:0 auto;padding:32px 18px;line-height:1.6}
 h1{font-size:20px;margin:0 0 4px} h2{font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding-bottom:6px;margin:28px 0 12px}
 table{border-collapse:collapse;width:100%;font-size:12px} th{text-align:left;width:210px;color:#555;font-weight:normal;vertical-align:top;padding:5px 10px 5px 0;border-bottom:1px solid #eee}
 td{padding:5px 0;border-bottom:1px solid #eee;word-break:break-all;font-family:'DejaVu Sans Mono',monospace}
 .verdict{border:2px solid #1a1a1a;padding:14px 16px;margin:18px 0}
 .ok{border-color:#2a7a2a;color:#1d5c1d} .bad{border-color:#a11;color:#a11}
 .hash{font-family:'DejaVu Sans Mono',monospace;font-size:11px;word-break:break-all}
 .note{color:#666;font-size:11.5px;margin-top:26px;border-top:1px solid #ddd;padding-top:14px}
 iframe{width:100%;height:520px;border:1px solid #ddd;margin-top:8px}
 @media print{body{padding:12px}iframe{height:auto}}
</style></head><body>
<h1>Evidence packet</h1>
<div>${esc(cfg.server && cfg.server.businessName || '')} &middot; signature record ${esc(row.id)}</div>

<h2>Does the document still match what was signed?</h2>
<div class="verdict ${v.matches ? 'ok' : (v.reason === 'no_hash_stored' ? '' : 'bad')}">
  <strong>${esc(line)}</strong>
  <div class="hash" style="margin-top:8px">Fingerprint recorded at signing: ${esc(v.stored || '(none)')}</div>
  <div class="hash">Fingerprint of the file on this unit now: ${esc(v.current || '(not available)')}</div>
  <div style="margin-top:6px">Document: ${esc(row.waiver_name)} version ${esc(row.waiver_version)}${v.filename ? ' &middot; ' + esc(v.filename) : ''}</div>
</div>

<h2>Every stored field, exactly as recorded</h2>
<table>${rows}</table>

<h2>The record as it was generated at signing</h2>
${record ? '<iframe srcdoc="' + esc(record).replace(/"/g, '&quot;') + '"></iframe>'
         : '<div>The generated record file is not on this unit.</div>'}

<div class="note">
This packet reproduces what this unit recorded: the document version and the
fingerprint of the exact bytes served, the signer and the capacity they signed
in, the server's own timestamp, and the network details captured at the time.
It is a record, not an assessment - this software does not evaluate whether any
document is valid or sufficient, and it gives no legal advice. Produced
${esc(new Date().toISOString())}.
</div>
</body></html>`;
  adminLog('WAIVER_PACKET', `Record: ${row.id} | ${row.customer_name} | document ${v.matches ? 'MATCHES' : v.reason.toUpperCase()}`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="evidence-${row.id.slice(0, 8)}.html"`);
  res.end(html);
});

// The same comparison as JSON - the admin list uses it to flag a record whose
// document has changed, and the batteries assert on it.
router.get('/signed/:id/verify', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const row = db().prepare(`SELECT * FROM signed_waivers WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  const mw = require('../services/memberwaiver');
  const v = mw.verifySigned(row);
  res.json({ ...v, line: mw.verifyLine(v) });
});

// ── ADMIN: SIGNED BY BOOKING ──────────────────────────────────────────────────
router.get('/signed/booking/:bookingId', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  // W37: ask through the shared helper, never with a private copy of the query.
  // A membership-scope signature keeps its booking in captured_booking_id, and
  // this route's own inline `WHERE booking_id = ?` stopped finding a member's
  // signature the moment that split landed - found on the bench, in the three
  // members-only styles, which is exactly what the bench is for.
  const record = require('../services/db').getSignedWaiverByBooking(req.params.bookingId);
  if (!record) return res.status(404).json({ error: 'No signed waiver for this booking' });
  res.json(record);
});

// ── ADMIN: QUARTERLY WAIVER DOWNLOAD ─────────────────────────────────────────
// Every signed agreement of a quarter, with names and signatures, leaving the
// unit - so it follows the backups' rule (maintainer, Sep 23 2026): encrypted with the
// backup passphrase, REFUSED when there is none, and a plain copy only through
// the 2FA step-up (?plain=1), which the health line then reports until the
// owner acknowledges it.
router.get('/signed/quarter/:year/:q/download', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const vault = require('../services/backupvault');
  if (!vault.vaultState().set) return res.status(409).json({ error: vault.NEEDS_PASSPHRASE, needsPassphrase: true });
  if (req.query.plain === '1') return require('../services/auth').requireSensitive(req, res, () => sendQuarter(req, res, false));
  return sendQuarter(req, res, true);
});
async function sendQuarter(req, res, encrypt) {
  const { year, q } = req.params;
  const yr = parseInt(year);
  const qn = parseInt(q);
  if (!yr || qn < 1 || qn > 4) return res.status(400).json({ error: 'Invalid quarter' });

  // Quarter date ranges
  const ranges = { 1:[`${yr}-01-01`,`${yr}-03-31`], 2:[`${yr}-04-01`,`${yr}-06-30`], 3:[`${yr}-07-01`,`${yr}-09-30`], 4:[`${yr}-10-01`,`${yr}-12-31`] };
  const [start, end] = ranges[qn];

  const records = db().prepare(
    `SELECT * FROM signed_waivers WHERE session_date >= ? AND session_date <= ? ORDER BY session_date ASC, agreed_at ASC`
  ).all(start, end);

  if (!records.length) return res.status(404).json({ error: `No signed waivers found for Q${qn} ${yr}` });

  const vault = require('../services/backupvault');
  const work = require('../services/backup').workDir('waivers');      // on the card, never /tmp
  const drop = () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch {} };
  const zipPath = path.join(work, `waivers-Q${qn}-${yr}.zip`);
  try {
    await new Promise((resolve, reject) => {
      const { ZipArchive } = require('archiver');
      const archive  = new ZipArchive({ zlib: { level: 9 } });
      const out = fs.createWriteStream(zipPath);
      out.on('close', resolve); archive.on('error', reject);
      archive.pipe(out);

      // Add signed HTML files
      for (const r of records) {
        const fp = path.join(SIGNED_DIR, r.signed_pdf_path);
        if (fs.existsSync(fp)) archive.file(fp, { name: `signed/${r.signed_pdf_path}` });
      }

      // Add referenced waiver PDFs
      const waiverIds = [...new Set(records.map(r => r.waiver_id))];
      for (const wid of waiverIds) {
        const w = db().prepare(`SELECT * FROM waivers WHERE id=?`).get(wid);
        if (w) {
          const wp = path.join(UPLOADS_DIR, w.filename);
          if (fs.existsSync(wp)) archive.file(wp, { name: `waiver-pdfs/${w.filename}` });
        }
      }

      // Add CSV summary
      const csv = ['Customer Name,Phone,Bay,Session Date,Session Time,Waiver,Version,Signed At,IP Address',
        ...records.map(r => `"${r.customer_name}","${r.customer_phone}","${r.bay_name}","${r.session_date}","${r.session_time}","${r.waiver_name}","${r.waiver_version}","${r.agreed_at}","${r.ip_address}"`)
      ].join('\n');
      archive.append(csv, { name: `summary-Q${qn}-${yr}.csv` });
      archive.finalize().catch(reject);
    });
    const file = encrypt ? vault.encryptFile(zipPath, zipPath.replace(/\.zip$/, '.baenc')) : zipPath;
    adminLog('WAIVER_QUARTER_DOWNLOADED', `Q${qn} ${yr} — ${records.length} records (${encrypt ? 'encrypted' : 'UNENCRYPTED'})`);
    if (!encrypt) vault.notePlainCopy(`the signed waivers of Q${qn} ${yr} downloaded unencrypted (${records.length} records)`);
    res.setHeader('Content-Type', encrypt ? 'application/octet-stream' : 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    res.setHeader('Cache-Control', 'no-store');
    const rs = fs.createReadStream(file);
    rs.on('close', drop);
    rs.on('error', () => { drop(); if (!res.headersSent) res.status(500).json({ error: 'Download failed' }); else res.destroy(); });
    rs.pipe(res);
  } catch (e) {
    drop();
    if (!res.headersSent) res.status(500).json({ error: 'Could not build the archive' });
  }
}

// ── ADMIN: DELETE QUARTER (only if > 1 year old) ──────────────────────────────
router.delete('/signed/quarter/:year/:q', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { year, q } = req.params;
  const yr = parseInt(year);
  const qn = parseInt(q);
  const ranges = { 1:[`${yr}-01-01`,`${yr}-03-31`], 2:[`${yr}-04-01`,`${yr}-06-30`], 3:[`${yr}-07-01`,`${yr}-09-30`], 4:[`${yr}-10-01`,`${yr}-12-31`] };
  const [start, end] = ranges[qn];

  // RETENTION: the ONE retention floor lives in services/records.js - 10
  // years, BA's ruling as the product's owner, the owner may set longer. It
  // is not a legal number and this refusal states no limitation period (rule
  // 15; maintainer, Sep 24 2026: "BA's ruling, not statutes of limitation"). This door
  // used to allow 7 and disagreed with the automatic purge (waiver audit, Sep 1
  // 2026). Storage is cheap; a deleted waiver cannot be brought back.
  const years = require('../services/records').retentionYears();
  const quarterEnd  = new Date(end);
  const retentionEdge = new Date();
  retentionEdge.setFullYear(retentionEdge.getFullYear() - years);
  if (quarterEnd > retentionEdge) {
    return res.status(403).json({ error: `Q${qn} ${yr} has not yet passed your ${years}-year records retention floor (Settings > Protection > Records). 10 years at the least is BA's ruling as the product's owner, not the law, and you can set it longer. A signed waiver is the record of what was agreed, and a deleted one cannot be brought back.` });
  }

  const records = db().prepare(
    `SELECT * FROM signed_waivers WHERE session_date >= ? AND session_date <= ?`
  ).all(start, end);

  // Delete files from disk
  let deleted = 0;
  for (const r of records) {
    const fp = path.join(SIGNED_DIR, r.signed_pdf_path);
    try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); deleted++; } } catch(e) {}
  }

  // Delete DB records
  db().prepare(`DELETE FROM signed_waivers WHERE session_date >= ? AND session_date <= ?`).run(start, end);
  adminLog('WAIVER_QUARTER_DELETED', `Q${qn} ${yr} — ${records.length} records, ${deleted} files`);
  res.json({ success: true, deleted: records.length, message: `Q${qn} ${yr} deleted — ${records.length} records removed` });
});

// ── ADMIN: GET QUARTER SUMMARY ────────────────────────────────────────────────
router.get('/signed/quarters', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  // Get all signed waivers grouped by quarter
  const records = db().prepare(`SELECT session_date, agreed_at FROM signed_waivers ORDER BY session_date ASC`).all();
  const quarters = {};

  for (const r of records) {
    const d = new Date(r.session_date + 'T12:00:00');
    const yr = d.getFullYear();
    const qn = Math.ceil((d.getMonth() + 1) / 3);
    const key = `${yr}-Q${qn}`;
    if (!quarters[key]) {
      const ends = { 1:`${yr}-03-31`, 2:`${yr}-06-30`, 3:`${yr}-09-30`, 4:`${yr}-12-31` };
      const starts = { 1:`${yr}-01-01`, 2:`${yr}-04-01`, 3:`${yr}-07-01`, 4:`${yr}-10-01` };
      const quarterEnd = new Date(ends[qn]);
      const retentionEdge = new Date(); retentionEdge.setFullYear(retentionEdge.getFullYear() - require('../services/records').retentionYears());
      quarters[key] = { year: yr, quarter: qn, label: `Q${qn} ${yr}`, start: starts[qn], end: ends[qn], count: 0, canDelete: quarterEnd < retentionEdge };
    }
    quarters[key].count++;
  }

  res.json(Object.values(quarters).sort((a,b) => b.year - a.year || b.quarter - a.quarter));
});

module.exports = router;
