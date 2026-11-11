// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/subscribers.js - EMAIL UPDATES (W45, Sep 10 2026; Example Owner's program).
//
// A visitor leaves an email (and a name if they like) on the homepage block,
// the holding page or /updates. It lands HERE, on the unit - never a third
// party - with where it came from and when they agreed. A confirmation goes
// out through the unit's own configured sender (Resend) when there is one,
// carrying an unsubscribe link that works without signing in. The owner
// reads the list in the Website editor (search, paged at ten, delete) and
// downloads it as CSV. Rule 14: the table is additive. Rule 6: a person's
// email is a person - the retention purge treats it like the rest.
'use strict';
const crypto = require('crypto');
const dbm = require('./db');

function ensureSchema() {
  try {
    dbm.db.exec(`CREATE TABLE IF NOT EXISTS website_subscribers (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL,
      name            TEXT DEFAULT '',
      source          TEXT DEFAULT '',
      consent_at      TEXT DEFAULT (datetime('now')),
      consent_text    TEXT DEFAULT '',
      ip              TEXT DEFAULT '',
      confirmed_email INTEGER DEFAULT 0,
      unsub_token     TEXT DEFAULT '',
      unsubscribed_at TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now'))
    )`);
    try { dbm.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON website_subscribers (email)`); } catch {}
  } catch {}
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normEmail(v) { return String(v || '').trim().toLowerCase().slice(0, 160); }

/** Add or re-activate. Returns { row, created, reactivated }. */
function add({ email, name, source, ip, consentText }) {
  ensureSchema();
  const e = normEmail(email);
  if (!EMAIL_RE.test(e)) return { error: 'That email address does not look right.' };
  const existing = dbm.db.prepare(`SELECT * FROM website_subscribers WHERE email = ?`).get(e);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (existing) {
    if (existing.unsubscribed_at) {
      dbm.db.prepare(`UPDATE website_subscribers SET unsubscribed_at = '', consent_at = ?, consent_text = ?, source = ?, name = CASE WHEN ? <> '' THEN ? ELSE name END WHERE id = ?`)
        .run(now, String(consentText || '').slice(0, 300), String(source || '').slice(0, 40), String(name || '').trim().slice(0, 120), String(name || '').trim().slice(0, 120), existing.id);
      return { row: dbm.db.prepare(`SELECT * FROM website_subscribers WHERE id = ?`).get(existing.id), created: false, reactivated: true };
    }
    return { row: existing, created: false, reactivated: false };
  }
  const id = 'sub-' + crypto.randomBytes(6).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  dbm.db.prepare(`INSERT INTO website_subscribers (id, email, name, source, consent_at, consent_text, ip, unsub_token) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, e, String(name || '').trim().slice(0, 120), String(source || '').slice(0, 40), now, String(consentText || '').slice(0, 300), String(ip || '').slice(0, 60), token);
  return { row: dbm.db.prepare(`SELECT * FROM website_subscribers WHERE id = ?`).get(id), created: true, reactivated: false };
}
function unsubscribe(token) {
  ensureSchema();
  const t = String(token || '').trim();
  if (!/^[a-f0-9]{32}$/.test(t)) return null;
  const row = dbm.db.prepare(`SELECT * FROM website_subscribers WHERE unsub_token = ?`).get(t);
  if (!row) return null;
  if (!row.unsubscribed_at) dbm.db.prepare(`UPDATE website_subscribers SET unsubscribed_at = datetime('now') WHERE id = ?`).run(row.id);
  return row;
}
function markConfirmed(id) { try { dbm.db.prepare(`UPDATE website_subscribers SET confirmed_email = 1 WHERE id = ?`).run(id); } catch {} }
/** The owner's list: search by email or name, paged at ten (W27), the newest first, the unsubscribed shown as such. */
function list({ q, page, per } = {}) {
  ensureSchema();
  const like = '%' + String(q || '').trim().toLowerCase().replace(/[%_]/g, '') + '%';
  const size = Math.max(1, Math.min(100, Number(per) || 10));
  const total = dbm.db.prepare(`SELECT COUNT(*) AS n FROM website_subscribers WHERE lower(email) LIKE ? OR lower(name) LIKE ?`).get(like, like).n;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.max(1, Math.min(pages, Number(page) || 1));
  const rows = dbm.db.prepare(`SELECT id, email, name, source, consent_at, confirmed_email, unsubscribed_at, created_at FROM website_subscribers WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(like, like, size, (p - 1) * size);
  const active = dbm.db.prepare(`SELECT COUNT(*) AS n FROM website_subscribers WHERE unsubscribed_at = '' OR unsubscribed_at IS NULL`).get().n;
  return { rows, total, active, page: p, pages, per: size };
}
function remove(id) { ensureSchema(); const row = dbm.db.prepare(`SELECT id FROM website_subscribers WHERE id = ?`).get(String(id || '')); if (!row) return false; dbm.db.prepare(`DELETE FROM website_subscribers WHERE id = ?`).run(row.id); return true; }
/** CSV of the whole list - the unsubscribed included, marked, so the owner's own mailing tool can honour them. */
function csv() {
  ensureSchema();
  const rows = dbm.db.prepare(`SELECT email, name, source, consent_at, confirmed_email, unsubscribed_at FROM website_subscribers ORDER BY created_at ASC`).all();
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return ['email,name,source,consented_at,confirmation_email_sent,unsubscribed_at']
    .concat(rows.map(r => [r.email, r.name, r.source, r.consent_at, r.confirmed_email ? 'yes' : 'no', r.unsubscribed_at || ''].map(cell).join(','))).join('\n') + '\n';
}
module.exports = { ensureSchema, add, unsubscribe, markConfirmed, list, remove, csv, EMAIL_RE };
