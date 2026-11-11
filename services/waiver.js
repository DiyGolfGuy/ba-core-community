// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/waiver.js  —  Waiver Management & Signed Agreement Generation
//
//  Waivers stored in:  /waivers/uploads/   (the PDFs you upload)
//  Signed records in:  /waivers/signed/    (generated per booking)
//
//  Signed agreement is an HTML-generated PDF containing:
//    - Business name, booking details, waiver version
//    - Customer name, phone, IP address, timestamp
//    - Full text of the waiver they agreed to (if available)
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const dbModule = require('./db');
const { getWaiverById, adminLog } = dbModule;
const db = () => dbModule.db;
const { getConfig } = require('./config');

const UPLOADS_DIR = path.join(__dirname, '..', 'waivers', 'uploads');
const SIGNED_DIR  = path.join(__dirname, '..', 'waivers', 'signed');

// Ensure dirs exist
[UPLOADS_DIR, SIGNED_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// THE ONE READING OF "WHEN THEY AGREED" (maintainer, Sep 19 2026, the redirect review).
// The agreement instant rides the booking row as an ISO string; every OTHER
// writer of signed_waivers.agreed_at (recordMembershipWaiver, the check-in
// paper attestation) uses SQLite's datetime('now'), and that column has held
// its 'YYYY-MM-DD HH:MM:SS' UTC shape since the baseline. Both shapes must
// read back as the same instant here, because an ISO string does NOT sort
// against the other within a day - ' ' < 'T', so an 01:00 online record sorts
// ahead of a 23:00 door record in every ORDER BY agreed_at in the tree.
function agreedMoment(raw) {
  const t = String(raw == null ? '' : raw).trim();
  const ms = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)
    ? Date.parse(t.replace(' ', 'T') + 'Z')   // datetime('now') is UTC, and
    : Date.parse(t);                          // bare Date.parse reads it LOCAL
  return new Date(Number.isFinite(ms) ? ms : Date.now());
}

// ...written in the shape the column has always held, so one format sorts.
function dbStamp(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

/**
 * Generate a signed agreement HTML file (saved as .html, downloadable as PDF via browser print)
 * We use HTML instead of a PDF library to avoid native dependencies on the Pi.
 * The admin can open and print/save-as-PDF from the browser.
 */
function generateSignedRecord(booking, waiver, signatureData) {
  const cfg       = getConfig();
  const bizName   = cfg.server.businessName;
  const contact   = cfg.contact || {};
  // The moment the customer AGREED, which recordSignedWaiver passes in - not
  // the moment this file happens to be written. They are the same inside
  // /confirm and minutes apart when the checkout sweeper rescues a paid
  // booking; printing the writer's clock here put a time in the document that
  // contradicted the row it is filed under, in the same evidence packet.
  const displayTs = agreedMoment(signatureData.agreedAt).toLocaleString('en-US', {
    weekday:'long', year:'numeric', month:'long', day:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit', timeZoneName:'short'
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Signed Waiver — ${booking.name} — ${booking.date}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Georgia, serif; font-size: 13px; color: #1a1a1a; padding: 48px; max-width: 760px; margin: 0 auto; }
    .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 20px; margin-bottom: 28px; }
    .biz-name { font-size: 22px; font-weight: bold; margin-bottom: 4px; }
    .biz-contact { font-size: 12px; color: #555; }
    .doc-title { font-size: 18px; font-weight: bold; text-align: center; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: 2px; }
    .doc-subtitle { text-align: center; font-size: 12px; color: #555; margin-bottom: 28px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 11px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 12px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
    .row .label { color: #555; flex-shrink: 0; width: 180px; }
    .row .value { font-weight: bold; text-align: right; }
    .waiver-ref { background: #f5f5f5; border: 1px solid #ddd; padding: 14px 18px; margin-bottom: 20px; font-size: 12px; line-height: 1.6; }
    .signature-block { border: 2px solid #1a1a1a; padding: 20px; margin-top: 28px; }
    .sig-title { font-size: 11px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
    .sig-name { font-size: 22px; font-family: cursive; border-bottom: 1px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 12px; color: #1a1a1a; }
    .sig-details { font-size: 11px; color: #555; line-height: 1.8; }
    .legal-notice { margin-top: 28px; font-size: 11px; color: #777; line-height: 1.7; border-top: 1px solid #ddd; padding-top: 16px; }
    .verified-stamp { display: inline-block; border: 2px solid #2a7a2a; color: #2a7a2a; padding: 6px 14px; font-size: 11px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; margin-top: 12px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>

  <div class="header">
    <div class="biz-name">${bizName}</div>
    <div class="biz-contact">${[contact.address, contact.phone, contact.email].filter(Boolean).join(' · ')}</div>
  </div>

  <div class="doc-title">Liability Waiver — Signed Agreement</div>
  <div class="doc-subtitle">This document confirms electronic acceptance of the liability waiver</div>

  <div class="section">
    <div class="section-title">Customer Information</div>
    <div class="row"><span class="label">Full Name</span><span class="value">${booking.name}</span></div>
    <div class="row"><span class="label">Phone Number</span><span class="value">${booking.phone}</span></div>
    ${(signatureData.email || booking.email) ? `<div class="row"><span class="label">Email</span><span class="value">${escHtml(signatureData.email || booking.email)}</span></div>` : ''}
    <div class="row"><span class="label">IP Address</span><span class="value">${escHtml(signatureData.ipAddress) || 'Not recorded'}</span></div>
    ${signatureData.userAgent ? `<div class="row"><span class="label">Browser (user agent)</span><span class="value" style="font-size:10px">${escHtml(String(signatureData.userAgent).slice(0, 200))}</span></div>` : ''}
    ${signatureData.guardianFor ? `<div class="row"><span class="label">Signed as parent/guardian for</span><span class="value">${escHtml(signatureData.guardianFor)}</span></div>` : ''}
    ${signatureData.docSha256 ? `<div class="row"><span class="label">Document SHA-256 at signing</span><span class="value" style="font-size:10px;font-family:monospace">${escHtml(signatureData.docSha256)}</span></div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Booking Details</div>
    <div class="row"><span class="label">Bay</span><span class="value">${booking.bay_name || '—'}</span></div>
    <div class="row"><span class="label">Date</span><span class="value">${booking.date}</span></div>
    <div class="row"><span class="label">Time</span><span class="value">${fmt12(booking.start_time)} – ${fmt12(booking.end_time)}</span></div>
    <div class="row"><span class="label">Duration</span><span class="value">${booking.duration_minutes} minutes</span></div>
    <div class="row"><span class="label">Booking ID</span><span class="value" style="font-size:11px;font-family:monospace">${booking.id}</span></div>
  </div>

  <div class="section">
    <div class="section-title">Waiver Agreed To</div>
    <div class="waiver-ref">
      <strong>${waiver.name}</strong> — Version ${waiver.version}<br>
      File: ${waiver.filename}<br>
      Waiver uploaded: ${new Date(waiver.created_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}<br>
      Waiver ID: <span style="font-family:monospace;font-size:11px">${waiver.id}</span>
    </div>
    <p style="font-size:12px;color:#555;line-height:1.6">
      The customer acknowledged reading and agreeing to the full terms of the above waiver
      before completing their booking and payment. The waiver PDF is stored separately and
      can be referenced by Waiver ID above.
    </p>
  </div>

  <div class="signature-block">
    <div class="sig-title">Electronic Signature</div>
    <div class="sig-name">${signatureData.signatureName || booking.name}</div>
    <div class="sig-details">
      Agreed by: <strong>${signatureData.signatureName || booking.name}</strong><br>
      Agreed at: <strong>${displayTs}</strong><br>
      ${signatureData.typedName ? `Typed confirmation name: <strong>${signatureData.typedName}</strong><br>` : ''}
      IP Address: <strong>${signatureData.ipAddress || 'Not recorded'}</strong><br>
      Method: Electronic checkbox acceptance during online booking
    </div>
    <div class="verified-stamp">✓ Electronically Signed</div>
  </div>

  <div class="legal-notice">
    This document was automatically generated by the ${bizName} booking system at the time of booking.
    The customer completed the booking process which required explicit acknowledgment of the liability waiver.
    This record is stored digitally and can be produced as evidence of agreement.
    Booking system record ID: <span style="font-family:monospace">${uuidv4()}</span>
  </div>

</body>
</html>`;

  // Save as HTML file (can be opened in browser and printed to PDF)
  const safeName  = booking.name.replace(/[^a-zA-Z0-9]/g, '-');
  const filename  = `${booking.date}_${safeName}_${booking.id.slice(0,8)}.html`;
  const filePath  = path.join(SIGNED_DIR, filename);
  fs.writeFileSync(filePath, html, 'utf8');

  return { filename, filePath };
}

/**
 * Record a signed waiver after booking confirmation
 */
function recordSignedWaiver(booking, waiver, signatureData) {
  const id = uuidv4();

  // Identity audit trail (ESIGN/UETA best practice): user agent + SHA-256 of
  // the exact PDF presented ride every record. When the signer is a member,
  // the row carries their id and MEMBERSHIP scope so the signature rides the
  // membership per the facility's term setting — self-correcting renewals
  // happen right here when an expired member signs at booking time.
  let docHash = '';
  try { docHash = require('./memberwaiver').docSha256(waiver); } catch {}
  const scope = signatureData.memberId ? 'membership' : 'booking';
  // ONE reading of the agreement instant for BOTH the row and the document,
  // so the evidence packet can never show two different times for one
  // signature (it renders the stored fields and the generated file together).
  const agreed = agreedMoment(booking.waiver_agreed_at);
  const { filename, filePath } = generateSignedRecord(booking, waiver,
    { ...signatureData, docSha256: docHash, agreedAt: agreed.toISOString() });

  // W37 (Part 3, the person-and-term rule): an annual/membership record must
  // NOT carry a booking id - a signature that rides a membership is not an
  // attendance record. The booking it was captured at is real provenance
  // though, so it moves to captured_booking_id and nothing is lost.
  const bookingIdForRow = scope === 'membership' ? '' : booking.id;

  // agreed_at below is THE SERVER'S CLOCK AT THE MOMENT THEY AGREED (rule 15),
  // not the moment this row happens to be written. Normally those are seconds
  // apart inside /confirm; when the checkout sweeper rescues a paid booking it
  // is minutes, and the difference is the difference between a late record and
  // a wrong one. Rows created before Sep 19 2026 carry no stamp and fall back
  // to now, exactly as they always did - and it is written in the column's own
  // datetime('now') shape, which is what every reader and every ORDER BY
  // agreed_at in the tree expects.
  // Comments stay OUT of the .run(...) list below: test-sql-bindings counts
  // top-level commas there, and a comma inside a comment reads as one more
  // argument than the statement actually binds.
  db().prepare(`
    INSERT INTO signed_waivers
      (id, booking_id, waiver_id, waiver_name, waiver_version, customer_name, customer_phone,
       agreed_at, ip_address, signature_name, signed_pdf_path, bay_name, session_date, session_time,
       scope, member_id, customer_email, user_agent, doc_sha256, guardian_for, captured_booking_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, bookingIdForRow, waiver.id, waiver.name, waiver.version,
    booking.name, booking.phone,
    dbStamp(agreed),
    signatureData.ipAddress || '',
    signatureData.signatureName || booking.name,
    filename,
    booking.bay_name || '',
    booking.date,
    booking.start_time,
    scope, signatureData.memberId || '',
    String(signatureData.email || booking.email || '').slice(0, 100),
    String(signatureData.userAgent || '').slice(0, 300),
    docHash,
    String(signatureData.guardianFor || '').slice(0, 80),
    booking.id
  );

  adminLog('WAIVER_SIGNED', `Booking: ${booking.id} | Waiver: ${waiver.name} v${waiver.version} | Customer: ${booking.name}`);
  console.log(`📋 Waiver signed: ${booking.name} → ${waiver.name} v${waiver.version}`);
  return { id, filename };
}

module.exports = {
  UPLOADS_DIR,
  SIGNED_DIR,
  generateSignedRecord,
  recordSignedWaiver
};
