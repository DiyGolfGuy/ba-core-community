// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/memberwaiver.js — membership-long waivers (Aug 2026)
//
// THE MODEL (maintainer): non-members sign per visit (online, or at the door where
// someone is at the counter). Members sign ONE waiver that rides the
// membership — captured at online signup, at their first booking, at staffed
// check-in, or recorded by the owner as paper-on-file. Validity is
// SELF-CORRECTING: it stops crediting when the membership lapses or (if the
// facility chooses the annual setting) 365 days after signing, and the next
// booking simply asks again.
//
// IDENTITY IS THE POINT. A waiver binds the person who signed it, so a
// signature must be attributable: we anchor membership-scope rows to the
// member id (never a name match — two John Smiths must never credit each
// other) and record the ESIGN/UETA best-practice audit trail: typed name,
// IP, timestamp, user agent, and the SHA-256 of the exact PDF presented.
//
// This module is records and plumbing, not legal advice. The waiver DOCUMENT
// and its enforceability are the facility's counsel's job — the admin UI says
// so out loud.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbMod = require('./db');
const configService = require('./config');

const UPLOADS_DIR = path.join(__dirname, '..', 'waivers', 'uploads');
const SIGNED_DIR = path.join(__dirname, '..', 'waivers', 'signed');
const ANNUAL_MS = 365 * 24 * 60 * 60 * 1000;

function cfgWaiver() {
  const c = configService.getConfig();
  return {
    mode: (c.waiver && c.waiver.mode) || 'required',
    collection: (c.waiver && c.waiver.collection) || 'online',
    membershipTerm: (c.waiver && c.waiver.membershipTerm) || 'membership',
    // renewal lead: a timed waiver is flagged, reminded and re-asked this many
    // days before it runs out (0 = never) - maintainer, Sep 1 2026
    reminderDays: Math.max(0, parseInt((c.waiver && c.waiver.reminderDays !== undefined) ? c.waiver.reminderDays : 30, 10) || 0),
    // A member's guests (Aug 25, late): 'member' = the member's waiver covers
    // the group (the member is responsible for their guests); 'each' = every
    // guest signs the one-day waiver at check-in. Staff can always collect a
    // guest's own signature either way.
    guests: (c.waiver && c.waiver.guests === 'each') ? 'each' : 'member'
  };
}

// ── document resolution ─────────────────────────────────────────────────────

function activeDoc() {
  try {
    return dbMod.db.prepare(`SELECT * FROM waivers WHERE active = 1 ORDER BY created_at DESC LIMIT 1`).get() || null;
  } catch { return null; }
}

// The document a given tier signs: the tier's pinned doc when set and still
// present, else the facility's active waiver. tier may be an id or a row.
function docForTier(tier) {
  try {
    let row = tier;
    if (typeof tier === 'string') {
      row = tier ? dbMod.db.prepare(`SELECT id, waiver_id FROM membership_tiers WHERE id = ?`).get(tier) : null;
    }
    if (row && row.waiver_id) {
      const w = dbMod.db.prepare(`SELECT * FROM waivers WHERE id = ?`).get(row.waiver_id);
      if (w) return w;
    }
  } catch {}
  return activeDoc();
}

// The TERM a tier's members sign under: the tier's own waiver_term when set,
// else the facility's "Membership waiver lasts" setting (waiver audit, Sep 1
// 2026 - maintainer: a membership type must be able to choose its own waiver style).
//   'membership' = life of the membership   'annual' = 365 days, then re-sign
//   'visit'      = every visit, like a guest (day passes, trial tiers)
const TERMS = ['membership', 'annual', 'visit'];
function termForTier(tier) {
  try {
    let row = tier;
    if (typeof tier === 'string') {
      row = tier ? dbMod.db.prepare(`SELECT id, waiver_term FROM membership_tiers WHERE id = ?`).get(tier) : null;
    }
    if (row && TERMS.includes(String(row.waiver_term || ''))) return String(row.waiver_term);
  } catch {}
  return cfgWaiver().membershipTerm === 'annual' ? 'annual' : 'membership';
}

// SHA-256 of the uploaded PDF as it exists at signing time — proves which
// version of the document the signer actually saw. '' when unreadable.
function docSha256(waiverDoc) {
  try {
    if (!waiverDoc || !waiverDoc.filename) return '';
    const fp = path.join(UPLOADS_DIR, path.basename(waiverDoc.filename));
    if (!fs.existsSync(fp)) return '';
    return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
  } catch { return ''; }
}

/**
 * DOES THE DOCUMENT ON THIS UNIT STILL MATCH WHAT WAS SIGNED? (W37)
 *
 * Storing the fingerprint is only worth something if something compares it.
 * We wrote doc_sha256 on every signature from Aug 2026 and never read it back;
 * this is the read. Takes a signed_waivers row, returns the comparison in
 * plain terms so the evidence packet can state it and a battery can assert it.
 *
 * reason: 'match' | 'changed' | 'file_missing' | 'no_hash_stored' | 'no_document'
 * Nothing here judges whether the document is any good - that is the
 * operator's and their counsel's business (rule 15). It reports bytes.
 */
function verifySigned(row) {
  const out = { stored: (row && row.doc_sha256) || '', current: '', matches: false, reason: 'no_hash_stored', filename: '' };
  if (!row) { out.reason = 'no_document'; return out; }
  if (!out.stored) return out;
  let doc = null;
  try { doc = dbMod.db.prepare(`SELECT * FROM waivers WHERE id = ?`).get(row.waiver_id); } catch {}
  if (!doc) { out.reason = 'no_document'; return out; }
  out.filename = doc.filename || '';
  const fp = path.join(UPLOADS_DIR, path.basename(doc.filename || ''));
  if (!doc.filename || !fs.existsSync(fp)) { out.reason = 'file_missing'; return out; }
  out.current = docSha256(doc);
  out.matches = !!out.current && out.current === out.stored;
  out.reason = out.matches ? 'match' : 'changed';
  return out;
}

/** One line an owner can read, for the packet and the admin list. */
function verifyLine(v) {
  switch (v.reason) {
    case 'match':          return 'The document on this unit is byte-for-byte the one that was signed.';
    case 'changed':        return 'WARNING: the document file on this unit is NOT the one that was signed. It has been replaced or altered since.';
    case 'file_missing':   return 'WARNING: the document file is no longer on this unit, so it cannot be compared to the fingerprint taken at signing.';
    case 'no_document':    return 'WARNING: the document record for this signature is no longer on this unit.';
    case 'no_hash_stored': return 'This signature predates fingerprinting, so there is nothing to compare.';
    default:               return '';
  }
}

// ── validity engine ─────────────────────────────────────────────────────────

function parseDbTime(s) {
  if (!s) return NaN;
  const t = String(s).trim();
  // Handles both 'YYYY-MM-DD HH:MM:SS' (datetime('now'), UTC) and ISO strings.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return Date.parse(t.replace(' ', 'T') + 'Z');
  return Date.parse(t);
}

// The single source of truth for "does this member have a waiver on file".
// Returns { on_file, expired, reason, signed_id, signed_at, version, doc_id }.
// reason when not on_file: 'none' | 'lapsed' | 'inactive' | 'annual_expired' | 'per_visit'.
// term is the tier's effective term; expires_at (YYYY-MM-DD) rides annual credit.
function memberWaiverStatus(memberId) {
  const out = { on_file: false, expired: false, reason: 'none', signed_id: null, signed_at: null, version: null, doc_id: null, term: null, expires_at: null, days_left: null, renew_due: false };
  if (!memberId) return out;
  let member = null;
  try { member = dbMod.db.prepare(`SELECT id, status, last_activated_at, created_at, tier_id FROM members WHERE id = ?`).get(memberId); } catch {}
  if (!member) return out;
  out.term = termForTier(member.tier_id || '');
  // A per-visit tier never carries a membership waiver: its members sign
  // every visit exactly like guests (online or at the door per collection).
  if (out.term === 'visit') { out.reason = 'per_visit'; return out; }
  let row = null;
  try {
    row = dbMod.db.prepare(
      `SELECT id, agreed_at, waiver_version, waiver_id FROM signed_waivers
        WHERE member_id = ? AND scope = 'membership' ORDER BY agreed_at DESC LIMIT 1`
    ).get(memberId);
  } catch {}
  if (!row) return out;
  out.signed_id = row.id; out.signed_at = row.agreed_at;
  out.version = row.waiver_version; out.doc_id = row.waiver_id;
  if (member.status !== 'active') { out.expired = true; out.reason = 'inactive'; return out; }
  const signedMs = parseDbTime(row.agreed_at);
  const anchorMs = parseDbTime(member.last_activated_at || member.created_at);
  if (Number.isFinite(anchorMs) && Number.isFinite(signedMs) && signedMs < anchorMs) {
    out.expired = true; out.reason = 'lapsed'; return out; // lapse-and-rejoin: sign again
  }
  if (out.term === 'annual') {
    if (!Number.isFinite(signedMs) || (Date.now() - signedMs) > ANNUAL_MS) {
      out.expired = true; out.reason = 'annual_expired'; return out;
    }
    out.expires_at = new Date(signedMs + ANNUAL_MS).toISOString().slice(0, 10);
    out.days_left = Math.max(0, Math.ceil((signedMs + ANNUAL_MS - Date.now()) / 86400000));
    const lead = cfgWaiver().reminderDays;
    out.renew_due = lead > 0 && out.days_left <= lead;   // still valid, but ask for a fresh one
  }
  out.on_file = true; out.reason = 'on_file';
  return out;
}

// ── the ask/skip decision ───────────────────────────────────────────────────

// One decision for every surface (public booking page, booking create route,
// the /needed endpoint). Server-authoritative; the client only renders it.
//   member: resolved member row or null
//   date, start_time: the booking arrival (for hybrid staffing)
// Returns { show, enforce, source, member_waiver, doc, arrival_note }.
//   source: 'off' | 'membership_on_file' | 'door' | 'online' | 'no_doc'
function waiverDecision({ member, date, start_time }) {
  const w = cfgWaiver();
  const doc = member ? docForTier(member.tier_id) : activeDoc();
  const base = { show: false, enforce: false, source: 'off', member_waiver: null, doc: doc ? publicDoc(doc) : null, arrival_note: false };
  if (w.mode === 'off') return base;
  if (!doc) { base.source = 'no_doc'; return base; }
  const doorHere = w.collection === 'door' ||
    (w.collection === 'auto' && require('./staffing').isStaffedAt(date, start_time));
  if (member) {
    const mw = memberWaiverStatus(member.id);
    base.member_waiver = { on_file: mw.on_file, expired: mw.expired, reason: mw.reason, version: mw.version, term: mw.term, expires_at: mw.expires_at, days_left: mw.days_left, renew_due: mw.renew_due };
    if (mw.on_file) {
      // RENEWAL (maintainer, Sep 1 2026): a timed waiver inside its lead window is
      // still valid, so nothing blocks - but the member is asked for a fresh
      // one now (online) or told they will re-sign at arrival (door).
      if (mw.renew_due) {
        if (doorHere) { base.source = 'renewal_door'; base.arrival_note = true; return base; }
        base.source = 'renewal_due'; base.show = true; base.enforce = false; return base;
      }
      base.source = 'membership_on_file'; return base;
    }
  }
  if (doorHere) { base.source = 'door'; base.arrival_note = true; return base; }
  base.source = 'online';
  base.show = true;
  base.enforce = (w.mode === 'required'); // 'optional' shows but never blocks
  return base;
}

function publicDoc(w) {
  return { id: w.id, name: w.name, version: w.version, filename: w.filename };
}

// Every active member whose timed waiver runs out within `withinDays`
// (default: the facility's reminder lead). Drives the roster count, the
// dashboard line and the nightly reminder pass - one list, one rule.
function renewalsDue(withinDays) {
  const lead = (withinDays === undefined) ? cfgWaiver().reminderDays : Math.max(0, parseInt(withinDays, 10) || 0);
  if (!lead) return [];
  let rows = [];
  try { rows = dbMod.db.prepare(`SELECT id, name, email, phone, tier_id, waiver_reminder_sent FROM members WHERE status = 'active' ORDER BY name`).all(); } catch { return []; }
  const out = [];
  for (const m of rows) {
    const st = memberWaiverStatus(m.id);
    if (st.on_file && st.term === 'annual' && st.days_left !== null && st.days_left <= lead) {
      out.push({ id: m.id, name: m.name, email: m.email || '', phone: m.phone || '', tier_id: m.tier_id, expires_at: st.expires_at, days_left: st.days_left, reminder_sent: m.waiver_reminder_sent || '' });
    }
  }
  return out;
}

// ── recording ───────────────────────────────────────────────────────────────

// Records a MEMBERSHIP-scope signature and generates the printable archive
// record. sig: { signatureName, ipAddress, userAgent, guardianFor, method
// ('digital'|'paper'), employee, email, context } — context is a short line
// describing where it was captured (online signup / booking / check-in /
// owner attestation).
function recordMembershipWaiver(member, waiverDoc, sig) {
  if (!member || !waiverDoc) return null;
  const id = require('uuid').v4();
  const hash = docSha256(waiverDoc);
  const method = sig.method === 'paper' ? 'paper' : 'digital';
  const signatureName = method === 'digital'
    ? String(sig.signatureName || member.name).slice(0, 80)
    : 'Paper on file - verified by ' + String(sig.employee || 'owner').slice(0, 40);
  const filename = generateMembershipRecord(member, waiverDoc, {
    ...sig, method, signatureName, docSha256: hash
  });
  dbMod.db.prepare(`INSERT INTO signed_waivers
      (id, booking_id, waiver_id, waiver_name, waiver_version, customer_name, customer_phone,
       agreed_at, ip_address, signature_name, signed_pdf_path, bay_name, session_date, session_time,
       method, employee, scope, member_id, customer_email, user_agent, doc_sha256, guardian_for)
    VALUES (?,?,?,?,?,?,?,datetime('now'),?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, '', waiverDoc.id, waiverDoc.name, String(waiverDoc.version || '1'),
      member.name, member.phone || '',
      sig.ipAddress || '', signatureName, filename || null, '', '', '',
      method, String(sig.employee || '').slice(0, 40) || null,
      'membership', member.id, String(sig.email || member.email || '').slice(0, 100),
      String(sig.userAgent || '').slice(0, 300), hash,
      String(sig.guardianFor || '').slice(0, 80));
  try { dbMod.adminLog('MEMBERSHIP_WAIVER_SIGNED', `${member.name} | ${waiverDoc.name} v${waiverDoc.version} | ${method}${sig.context ? ' | ' + sig.context : ''}`); } catch {}
  try { dbMod.flushed().catch(() => {}); } catch {}   // written now, never freezing the unit (see bookingledger)
  return { id, filename };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Printable archive record for a MEMBERSHIP waiver — same HTML print-to-PDF
// pattern as the booking records (no native PDF deps on the Pi), carrying
// every identifying detail we can honestly capture.
function generateMembershipRecord(member, waiver, sig) {
  try {
    const cfg = configService.getConfig();
    const bizName = (cfg.server && cfg.server.businessName) || 'Facility';
    const contact = cfg.contact || {};
    const term = cfgWaiver().membershipTerm === 'annual'
      ? 'Valid for one year from signing while the membership remains active'
      : 'Valid for the life of this continuous membership';
    let tierName = '';
    try { const t = dbMod.db.prepare(`SELECT name FROM membership_tiers WHERE id = ?`).get(member.tier_id); tierName = t ? t.name : ''; } catch {}
    const displayTs = new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
    });
    const row = (l, v) => v ? `<div class="row"><span class="label">${esc(l)}</span><span class="value">${esc(v)}</span></div>` : '';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Membership Waiver — ${esc(member.name)}</title>
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
  .row .label { color: #555; flex-shrink: 0; width: 200px; }
  .row .value { font-weight: bold; text-align: right; word-break: break-all; }
  .waiver-ref { background: #f5f5f5; border: 1px solid #ddd; padding: 14px 18px; margin-bottom: 20px; font-size: 12px; line-height: 1.6; }
  .signature-block { border: 2px solid #1a1a1a; padding: 20px; margin-top: 28px; }
  .sig-title { font-size: 11px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
  .sig-name { font-size: 22px; font-family: cursive; border-bottom: 1px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 12px; }
  .sig-details { font-size: 11px; color: #555; line-height: 1.8; word-break: break-all; }
  .legal-notice { margin-top: 28px; font-size: 11px; color: #777; line-height: 1.7; border-top: 1px solid #ddd; padding-top: 16px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="biz-name">${esc(bizName)}</div>
    <div class="biz-contact">${[contact.address, contact.phone, contact.email].filter(Boolean).map(esc).join(' &middot; ')}</div>
  </div>
  <div class="doc-title">Membership Liability Waiver — Signed Agreement</div>
  <div class="doc-subtitle">This document confirms acceptance of the liability waiver for the term of the membership below</div>
  <div class="section">
    <div class="section-title">Member Information</div>
    ${row('Full Name', member.name)}
    ${row('Phone Number', member.phone)}
    ${row('Email', sig.email || member.email)}
    ${row('Member ID', member.id)}
    ${row('Membership Tier', tierName)}
    ${row('Waiver Term', term)}
    ${sig.guardianFor ? row('Signed as parent/legal guardian for', sig.guardianFor) : ''}
  </div>
  <div class="section">
    <div class="section-title">Waiver Agreed To</div>
    <div class="waiver-ref">
      <strong>${esc(waiver.name)}</strong> — Version ${esc(waiver.version)}<br>
      File: ${esc(waiver.filename)}<br>
      Waiver ID: <span style="font-family:monospace;font-size:11px">${esc(waiver.id)}</span><br>
      ${sig.docSha256 ? `Document SHA-256 at signing: <span style="font-family:monospace;font-size:10px">${esc(sig.docSha256)}</span><br>` : ''}
    </div>
  </div>
  <div class="signature-block">
    <div class="sig-title">${sig.method === 'paper' ? 'Paper Waiver Attestation' : 'Electronic Signature'}</div>
    <div class="sig-name">${esc(sig.signatureName)}</div>
    <div class="sig-details">
      Agreed at: <strong>${esc(displayTs)}</strong><br>
      ${sig.method === 'paper'
        ? `Method: Physical waiver sheet on file at the facility, verified by <strong>${esc(sig.employee || 'owner')}</strong><br>`
        : `Method: Electronic acceptance — typed legal name with affirmative checkbox<br>`}
      ${sig.ipAddress ? `IP Address: <strong>${esc(sig.ipAddress)}</strong><br>` : ''}
      ${sig.userAgent ? `Browser (user agent): <strong>${esc(String(sig.userAgent).slice(0, 200))}</strong><br>` : ''}
      ${sig.context ? `Captured during: <strong>${esc(sig.context)}</strong><br>` : ''}
    </div>
  </div>
  <div class="legal-notice">
    This record was generated automatically by the ${esc(bizName)} booking system at signing time and is
    retained as evidence of agreement. The waiver PDF is stored separately and can be matched to this
    record by Waiver ID${sig.docSha256 ? ' and by the SHA-256 fingerprint above' : ''}.
    Record ID: <span style="font-family:monospace">${require('uuid').v4()}</span>
  </div>
</body>
</html>`;
    const safeName = String(member.name || 'member').replace(/[^a-zA-Z0-9]/g, '-');
    const filename = `membership_${safeName}_${member.id.slice(0, 8)}_${Date.now()}.html`;
    if (!fs.existsSync(SIGNED_DIR)) fs.mkdirSync(SIGNED_DIR, { recursive: true });
    fs.writeFileSync(path.join(SIGNED_DIR, filename), html, 'utf8');
    return filename;
  } catch (e) {
    console.error('membership waiver record:', e.message);
    return null;
  }
}

module.exports = {
  cfgWaiver, activeDoc, docForTier, docSha256, termForTier, TERMS, verifySigned, verifyLine,
  memberWaiverStatus, waiverDecision, recordMembershipWaiver, renewalsDue
};
