// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/newsletter.js - THE NEWSLETTER (Oct 19 2026)
//
//  maintainer: "if people sign up for a newsletter, they get a newsletter. But they still get to go away from it." The sign-up
//  and the way out are already built (services/subscribers.js, W45): every subscriber's own unsubscribe link,
//  /updates/unsubscribe?t=<their token>, works without signing in, for ever. This sends what the owner writes - from the
//  Website editor or, on the owner's yes, from the assistant - to everyone still signed up:
//    - one email each, through the unit's own sender (services/email.js), each carrying that person's own unsubscribe
//      link on the website's own address (set first: a link that only works inside the facility is no way out);
//    - a DURABLE send (rule 22): every recipient is a row - pending, sent, failed, skipped, unknown - so a restart in the
//      middle carries on where it stopped and never sends anyone the same newsletter twice. A row that was being sent
//      when the unit stopped is marked 'unknown' and NOT sent again: one missed email beats a double;
//    - paced, so the sender's own rate limit is never met; someone who unsubscribes while a send runs is skipped;
//    - a refusal is recorded as a refusal with the reason (rule 29); a unit that does not send email at all is told so
//      before anything is queued (rule 31). Only the subscriber's id is kept per row - their address stays in one
//      place, which the ten-year purge already covers (rule 6).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const dbm = require('./db');
const { getConfig } = require('./config');

const BATCH = Number(process.env.BA_TEST_NEWSLETTER_BATCH) || 40;   // a tick sends at most this many
const PACE_MS = process.env.BA_TEST_NEWSLETTER_PACE_MS != null ? Number(process.env.BA_TEST_NEWSLETTER_PACE_MS) : 1000;
const GROUP = 10;   // saved to the card once before a group leaves and once after
const adminLog = (ev, d) => { try { dbm.adminLog(ev, String(d).slice(0, 300)); } catch {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ensureSchema() {
  try {
    require('./subscribers');   // its table first
    dbm.db.exec(`CREATE TABLE IF NOT EXISTS newsletters (
      id TEXT PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT DEFAULT 'sending',
      total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0, unknown INTEGER DEFAULT 0,
      created_by TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), finished_at TEXT DEFAULT '')`);
    dbm.db.exec(`CREATE TABLE IF NOT EXISTS newsletter_deliveries (
      newsletter_id TEXT NOT NULL, subscriber_id TEXT NOT NULL, status TEXT DEFAULT 'pending', error TEXT DEFAULT '', sent_at TEXT DEFAULT '',
      PRIMARY KEY (newsletter_id, subscriber_id))`);
  } catch {}
  // a picture at the top of the email - a special's flyer (Oct 20 2026, late): added, never renamed (rule 14)
  try { dbm.db.exec(`ALTER TABLE newsletters ADD COLUMN image TEXT DEFAULT ''`); } catch {}
}
// only a picture this unit serves itself, under the website's photos
const okImage = (v) => /^\/uploads\/landing\/[A-Za-z0-9._-]{1,120}\.(?:jpe?g|png|webp)$/.test(String(v || '')) ? String(v) : '';

function publicBase(cfg) {
  const d = String((cfg.seo && cfg.seo.domain) || '').trim().replace(/\/+$/, '');
  if (!d) return null;
  return d.startsWith('http') ? d : 'https://' + d;
}
/** Can this unit send a newsletter at all? null when it can, else the plain reason (and nothing is queued). */
function cannotSend(cfg) {
  if (!publicBase(cfg)) return 'Set your website\'s address first (Settings, or tell the assistant) - every newsletter carries an unsubscribe link that has to work from anywhere.';
  if (process.env.EMAIL_DRYRUN === '1') return null;
  const r = cfg.resend || {};
  if (!String(r.apiKey || '').startsWith('re_') || !String(r.fromEmail || '').trim()) return 'Email is not set up on this unit yet (Settings > Connections: the Resend key and the From address) - nothing was sent.';
  return null;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function render(n, sub, cfg) {
  const biz = (cfg.server && cfg.server.businessName) || 'Us';
  const link = `${publicBase(cfg)}/updates/unsubscribe?t=${encodeURIComponent(sub.unsub_token)}`;
  const hi = sub.name ? `Hi ${sub.name},\n\n` : '';
  const text = `${hi}${n.body}${okImage(n.image) ? `\n\nSee the picture: ${publicBase(cfg)}${n.image}` : ''}\n\n- ${biz}\n\nYou are getting this because you signed up for email updates from ${biz}. Stop these emails: ${link}`;
  const paras = String(n.body).split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('\n');
  const pic = okImage(n.image) ? `<p style="margin:0 0 18px"><img src="${esc(publicBase(cfg) + n.image)}" alt="${esc(n.subject)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:10px"></p>` : '';
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1d2421;max-width:600px">${sub.name ? `<p>Hi ${esc(sub.name)},</p>` : ''}${pic}${paras}<p>- ${esc(biz)}</p><hr style="border:none;border-top:1px solid #ddd"><p style="font-size:13px;color:#5d6a64">You are getting this because you signed up for email updates from ${esc(biz)}. <a href="${esc(link)}">Stop these emails</a>.</p></div>`;
  return { subject: n.subject, text, html };
}

/** Queue a newsletter to everyone still signed up. { id, total } or throws with the plain reason. */
function create({ subject, body, by, image }) {
  ensureSchema();
  const s = String(subject || '').trim(), b = String(body || '').trim();
  if (!s || s.length > 150) throw new Error('Give the newsletter a subject (150 characters at most).');
  if (!b || b.length > 20000) throw new Error('Write the newsletter (20,000 characters at most).');
  const why = cannotSend(getConfig()); if (why) throw new Error(why);
  const subs = dbm.db.prepare(`SELECT id FROM website_subscribers WHERE unsubscribed_at = '' OR unsubscribed_at IS NULL`).all();
  if (!subs.length) throw new Error('Nobody is signed up for email updates yet - there is no one to send it to.');
  const id = 'nl-' + crypto.randomBytes(6).toString('hex');
  dbm.db.prepare(`INSERT INTO newsletters (id, subject, body, total, created_by, image) VALUES (?, ?, ?, ?, ?, ?)`).run(id, s, b, subs.length, String(by || 'owner').slice(0, 40), okImage(image));
  const ins = dbm.db.prepare(`INSERT OR IGNORE INTO newsletter_deliveries (newsletter_id, subscriber_id) VALUES (?, ?)`);
  for (const x of subs) ins.run(id, x.id);
  adminLog('NEWSLETTER_QUEUED', `"${s}" to ${subs.length} subscriber${subs.length === 1 ? '' : 's'}${by && by !== 'owner' ? ' - ' + by : ''}`);
  return { id, total: subs.length };
}

function counts(id) {
  const c = {}; for (const r of dbm.db.prepare(`SELECT status, COUNT(*) AS n FROM newsletter_deliveries WHERE newsletter_id = ? GROUP BY status`).all(id)) c[r.status] = r.n;
  return c;
}
function settle(id) {
  const c = counts(id);
  dbm.db.prepare(`UPDATE newsletters SET sent = ?, failed = ?, skipped = ?, unknown = ? WHERE id = ?`).run(c.sent || 0, c.failed || 0, c.skipped || 0, c.unknown || 0, id);
  if (!(c.pending || 0) && !(c.sending || 0)) {
    const n = dbm.db.prepare(`SELECT * FROM newsletters WHERE id = ?`).get(id);
    if (n && n.status === 'sending') {
      dbm.db.prepare(`UPDATE newsletters SET status = 'sent', finished_at = datetime('now') WHERE id = ?`).run(id);
      adminLog((c.failed || 0) || (c.unknown || 0) ? 'NEWSLETTER_SENT_WITH_FAILURES' : 'NEWSLETTER_SENT', `"${n.subject}": sent ${c.sent || 0}${c.skipped ? ', skipped ' + c.skipped + ' (unsubscribed meanwhile)' : ''}${c.failed ? ', FAILED ' + c.failed : ''}${c.unknown ? ', not known ' + c.unknown + ' (the unit stopped mid-send; not sent again)' : ''}`);
    }
  }
}

/** At boot: a row that was being sent when the unit stopped is never sent again. */
function recover() {
  ensureSchema();
  const stuck = dbm.db.prepare(`SELECT newsletter_id, COUNT(*) AS n FROM newsletter_deliveries WHERE status = 'sending' GROUP BY newsletter_id`).all();
  for (const s of stuck) {
    dbm.db.prepare(`UPDATE newsletter_deliveries SET status = 'unknown', error = 'the unit stopped while this one was being sent - not sent again, so nobody gets it twice' WHERE newsletter_id = ? AND status = 'sending'`).run(s.newsletter_id);
    settle(s.newsletter_id);
  }
}

let _busy = false;
/** Send the next batch. Called every minute by the scheduler (and at boot). */
async function tick() {
  if (_busy) return { busy: true };
  _busy = true;
  try {
    ensureSchema();
    const cfg = getConfig();
    const rows = dbm.db.prepare(`SELECT d.newsletter_id, d.subscriber_id FROM newsletter_deliveries d JOIN newsletters n ON n.id = d.newsletter_id
      WHERE d.status = 'pending' AND n.status = 'sending' ORDER BY n.created_at, d.subscriber_id LIMIT ?`).all(BATCH);
    if (!rows.length) return { sent: 0 };
    const why = cannotSend(cfg);
    if (why) { adminLog('NEWSLETTER_HELD', `${why} The newsletter waits and goes out once it is set.`.slice(0, 300)); return { held: why }; }
    // IN GROUPS OF TEN: the group is marked 'sending' and written to the card once before any of it leaves, and written
    // again once it has gone - two saves per ten emails, not one per email (the whole database file is written on every
    // save, rule 44's SD-card wear). A unit that stops mid-group leaves at most ten 'unknown', none sent twice. Each save
    // is db.flushed() - the fsync in the thread pool - never the synchronous flush, which holds every request behind the
    // card for seconds (test-no-freeze B1 found the first cut using it).
    let sent = 0;
    const touched = new Set();
    const flush = async () => { try { await dbm.flushed(); } catch {} };
    for (let g = 0; g < rows.length; g += GROUP) {
      const group = [];
      for (const r of rows.slice(g, g + GROUP)) {
        touched.add(r.newsletter_id);
        const n = dbm.db.prepare(`SELECT * FROM newsletters WHERE id = ?`).get(r.newsletter_id);
        if (!n || n.status !== 'sending') continue;
        const sub = dbm.db.prepare(`SELECT * FROM website_subscribers WHERE id = ?`).get(r.subscriber_id);
        if (!sub || (sub.unsubscribed_at && sub.unsubscribed_at !== '')) { dbm.db.prepare(`UPDATE newsletter_deliveries SET status = 'skipped' WHERE newsletter_id = ? AND subscriber_id = ?`).run(r.newsletter_id, r.subscriber_id); continue; }
        dbm.db.prepare(`UPDATE newsletter_deliveries SET status = 'sending' WHERE newsletter_id = ? AND subscriber_id = ?`).run(r.newsletter_id, r.subscriber_id);
        group.push({ r, n, sub });
      }
      if (!group.length) continue;
      await flush();
      for (const { r, n, sub } of group) {
        let ok = null, err = '';
        try { const m = render(n, sub, cfg); ok = await require('./email').sendEmail({ to: sub.email, subject: m.subject, text: m.text, html: m.html }); }
        catch (e) { ok = false; err = String(e && e.message || e).slice(0, 200); }
        if (ok === true || (ok && (ok.ok || ok.id || ok.success))) { dbm.db.prepare(`UPDATE newsletter_deliveries SET status = 'sent', sent_at = datetime('now') WHERE newsletter_id = ? AND subscriber_id = ?`).run(r.newsletter_id, r.subscriber_id); sent++; }
        else dbm.db.prepare(`UPDATE newsletter_deliveries SET status = 'failed', error = ? WHERE newsletter_id = ? AND subscriber_id = ?`).run(err || (ok === undefined ? 'email is not set up' : 'the sender refused it (see EMAIL_ERROR in the log)'), r.newsletter_id, r.subscriber_id);
        if (PACE_MS) await sleep(PACE_MS);
      }
      await flush();
    }
    for (const id of touched) settle(id);
    return { sent };
  } finally { _busy = false; }
}

function cancel(id) {
  ensureSchema();
  const n = dbm.db.prepare(`SELECT * FROM newsletters WHERE id = ?`).get(String(id || ''));
  if (!n) return { error: 'No such newsletter' };
  if (n.status !== 'sending') return { error: 'That newsletter has finished' };
  dbm.db.prepare(`UPDATE newsletter_deliveries SET status = 'cancelled' WHERE newsletter_id = ? AND status = 'pending'`).run(n.id);
  dbm.db.prepare(`UPDATE newsletters SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?`).run(n.id);
  settle(n.id);
  adminLog('NEWSLETTER_CANCELLED', `"${n.subject}" - stopped; ${counts(n.id).sent || 0} had been sent`);
  return { ok: true };
}

function list() {
  ensureSchema();
  return dbm.db.prepare(`SELECT id, subject, status, total, sent, failed, skipped, unknown, created_by, created_at, finished_at FROM newsletters ORDER BY created_at DESC LIMIT 50`).all()
    .map(n => Object.assign(n, { pending: (counts(n.id).pending || 0) }));
}

module.exports = { create, tick, recover, cancel, list, cannotSend, render, ensureSchema };
