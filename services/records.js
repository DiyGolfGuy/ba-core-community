// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/records.js — RECORDS & RETENTION (maintainer's doctrine, Aug 25 2026).
//
// The rule: PERSON-level detail ("Brian had a tee time"), waivers included,
// purges automatically at 10 years - and 10 is the FLOOR, never lower.
// FACILITY-level facts live forever and are never deleted: money collected,
// tax collected, time slots and busy times, member counts, year-over-year
// growth - anything an owner can use to analyze the facility later.
//
// How that is honored here:
//  - The purge ANONYMIZES booking rows in place (the row stays; the identity
//    leaves), so busy-time / revenue / tax history survives forever exactly
//    where reporting already looks for it.
//  - Before anything is touched, the year's metrics are SNAPSHOTTED into
//    records_yearly - so even counts that need identity to compute (unique
//    customers, active members) are frozen forever first.
//  - Signed waiver rows and their PDFs are DELETED (a waiver is pure person
//    detail; its facility fact is just "a waiver was signed", kept in the
//    snapshot count).
//  - Whole CALENDAR YEARS purge, never rolling days: year Y becomes eligible
//    on Jan 1 of Y + retention + 1, so every record lives AT LEAST the full
//    retention period and a per-year archive is always all-or-nothing.
//  - Owners who want detail longer download a per-year ARCHIVE (full person
//    detail: bookings CSV, waiver CSV + PDFs, members CSV) any time before
//    the year purges. Vault law applies: it leaves the unit encrypted when
//    the backup passphrase is set.
//  - 90 days before a year purges, the owner gets ONE email naming the year
//    and the archive door. The purge itself runs nightly at 4:45, AFTER the
//    nightly backup window, so the last backup of the night still holds the
//    pre-purge state.
'use strict';

const fs   = require('fs');
const path = require('path');
const dbM  = require('./db');

const FLOOR_YEARS = 10;               // maintainer, Aug 25: 10 is the floor. Never lower.
const WARN_DAYS   = 90;               // one owner email this far ahead of a purge
const PURGED_NAME = 'Purged';         // what an anonymized name becomes

// ── schema ───────────────────────────────────────────────────────────────
function ensureSchema() {
  const D = dbM.db;
  // Forever metrics. One row per calendar year; written at purge time from
  // live data (source='purge') so nothing countable is ever lost, and
  // computable live for years not yet purged.
  D.exec(`CREATE TABLE IF NOT EXISTS records_yearly (
    year INTEGER PRIMARY KEY,
    bookings INTEGER DEFAULT 0,
    hours REAL DEFAULT 0,
    revenue_cents INTEGER DEFAULT 0,
    tax_cents INTEGER DEFAULT 0,
    pos_cents INTEGER DEFAULT 0,
    tips_cents INTEGER DEFAULT 0,
    unique_customers INTEGER DEFAULT 0,
    members_active INTEGER DEFAULT 0,
    new_members INTEGER DEFAULT 0,
    guest_visits INTEGER DEFAULT 0,
    waivers_signed INTEGER DEFAULT 0,
    source TEXT DEFAULT 'purge',
    snapshotted_at TEXT DEFAULT (datetime('now')))`);
  // ONE DEFINITION OF REVENUE (maintainer, Sep 23 2026): services/revenue.js. The parts
  // of it are kept beside the total, and a frozen row names the definition that
  // made it - so a year frozen ten years from now still says what its numbers mean.
  // revenue_cents / tax_cents / pos_cents / tips_cents keep their names and now
  // hold that definition's revenue, tax collected, counter money and tips. No row
  // was ever frozen under the old computation (none has reached its purge year).
  for (const col of ['sessions_cents', 'gift_sales_cents', 'membership_cents', 'refunds_cents', 'expired_unpaid_cents']) {
    try { D.exec(`ALTER TABLE records_yearly ADD COLUMN ${col} INTEGER DEFAULT 0`); } catch {}
  }
  try { D.exec(`ALTER TABLE records_yearly ADD COLUMN revenue_basis TEXT DEFAULT ''`); } catch {}
  // The purge ledger: when a year was warned about and when it was purged.
  D.exec(`CREATE TABLE IF NOT EXISTS records_purges (
    year INTEGER PRIMARY KEY,
    warned_at TEXT DEFAULT '',
    purged_at TEXT DEFAULT '',
    detail TEXT DEFAULT '')`);
}

// ── config ───────────────────────────────────────────────────────────────
function retentionYears() {
  try {
    const cfg = require('./config').getConfig();
    const n = parseInt(cfg.records && cfg.records.retentionYears, 10);
    // The floor is enforced HERE, not just at the settings route - a hand
    // edited config.json can never shorten anyone's retention below 10.
    return Number.isFinite(n) ? Math.max(FLOOR_YEARS, n) : FLOOR_YEARS;
  } catch { return FLOOR_YEARS; }
}

function localToday() {
  // Facility-local date; the OS timezone is set by setup (services/timezone).
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), date: d };
}

// Year Y is eligible once the local date reaches Jan 1 of Y + retention + 1.
function lastEligibleYear(today = localToday()) {
  return today.y - retentionYears() - 1;
}

// The next year that WILL purge and the date it happens.
function nextPurge(today = localToday()) {
  const year = lastEligibleYear(today) + 1;
  return { year, on: `${year + retentionYears() + 1}-01-01` };
}

// ── data probes ──────────────────────────────────────────────────────────
const Y0 = y => `${y}-01-01`;
const Y1 = y => `${y}-12-31`;

function yearHasPersonDetail(y) {
  const D = dbM.db;
  const q = (sql, ...p) => (D.prepare(sql).get(...p) || { c: 0 }).c;
  return q(`SELECT COUNT(*) c FROM bookings WHERE date BETWEEN ? AND ? AND name != ?`, Y0(y), Y1(y), PURGED_NAME) > 0
      || q(`SELECT COUNT(*) c FROM signed_waivers WHERE COALESCE(NULLIF(session_date,''), substr(agreed_at,1,10)) BETWEEN ? AND ?`, Y0(y), Y1(y)) > 0;
}

// Earliest year with any data at all (purged or not) - bounds the metrics list.
function firstDataYear() {
  const D = dbM.db;
  const vals = [];
  for (const sql of [
    `SELECT MIN(substr(date,1,4)) y FROM bookings`,
    `SELECT MIN(substr(created_at,1,4)) y FROM members`,
    `SELECT MIN(year) y FROM records_yearly`
  ]) { const r = D.prepare(sql).get(); if (r && r.y) vals.push(parseInt(r.y, 10)); }
  return vals.length ? Math.min(...vals) : null;
}

// ── forever metrics ──────────────────────────────────────────────────────
// Computed from live tables. Called on not-yet-purged years (live view) and
// as the frozen snapshot at purge time. Anonymized rows still count for
// money / tax / hours; identity-dependent counts are why purge snapshots first.
function computeYearMetrics(y) {
  const D = dbM.db;
  const g = (sql, ...p) => D.prepare(sql).get(...p) || {};
  // THE MONEY: one definition, read from one place (services/revenue.js) - the
  // same answer the owner's revenue report gives for the same calendar year.
  // Before Sep 23 2026 this counted every booking not pending or cancelled - so a
  // checkout that EXPIRED UNPAID was revenue here - and never subtracted a refund.
  const rev = require('./revenue');
  const money = rev.money(Y0(y), Y1(y));
  // THE ACTIVITY: sessions that took place (by the session's own date). An
  // expired checkout never happened, so it is not a booking either.
  const act = g(`SELECT COUNT(*) n, COALESCE(SUM(duration_minutes),0) mins
                 FROM bookings WHERE date BETWEEN ? AND ?
                   AND COALESCE(booking_type,'customer') = 'customer'
                   AND status IN ('active','completed')`, Y0(y), Y1(y));
  const uniq = g(`SELECT COUNT(DISTINCT COALESCE(NULLIF(phone,''), email)) c
                  FROM bookings WHERE date BETWEEN ? AND ?
                    AND COALESCE(booking_type,'customer') = 'customer' AND name != ?
                    AND status IN ('active','completed')
                    AND (phone != '' OR COALESCE(email,'') != '')`, Y0(y), Y1(y), PURGED_NAME);
  const mact = g(`SELECT COUNT(DISTINCT member_id) c FROM member_usage
                  WHERE date BETWEEN ? AND ? AND member_id != ''`, Y0(y), Y1(y));
  const mnew = g(`SELECT COUNT(*) c FROM members WHERE substr(created_at,1,4) = ?`, String(y));
  const gv   = g(`SELECT COALESCE(SUM(guest_count),0) c FROM member_guests WHERE date BETWEEN ? AND ?`, Y0(y), Y1(y));
  const wv   = g(`SELECT COUNT(*) c FROM signed_waivers
                  WHERE COALESCE(NULLIF(session_date,''), substr(agreed_at,1,10)) BETWEEN ? AND ?`, Y0(y), Y1(y));
  return {
    year: y,
    bookings: act.n || 0,
    hours: Math.round(((act.mins || 0) / 60) * 10) / 10,
    revenue_cents: money.revenue_cents,
    tax_cents: money.tax_cents,
    pos_cents: money.counter.cents,
    tips_cents: money.counter.tips_cents,
    sessions_cents: money.sessions.gross_cents,
    gift_sales_cents: money.gifts.cents,
    membership_cents: money.memberships.cents,
    refunds_cents: money.refunds.cents,
    expired_unpaid_cents: money.not_revenue.expired_unpaid.cents,
    revenue_basis: money.basis,
    unique_customers: uniq.c || 0,
    members_active: mact.c || 0,
    new_members: mnew.c || 0,
    guest_visits: gv.c || 0,
    waivers_signed: wv.c || 0
  };
}

// Frozen at purge time, before any identity goes: the numbers and the parts of
// the money, with the definition that made them.
function snapshotYear(y) {
  ensureSchema();
  const m = computeYearMetrics(y);
  dbM.db.prepare(`INSERT OR REPLACE INTO records_yearly
    (year, bookings, hours, revenue_cents, tax_cents, pos_cents, tips_cents,
     unique_customers, members_active, new_members, guest_visits, waivers_signed,
     sessions_cents, gift_sales_cents, membership_cents, refunds_cents, expired_unpaid_cents, revenue_basis,
     source, snapshotted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?, 'purge', datetime('now'))`)
    .run(m.year, m.bookings, m.hours, m.revenue_cents, m.tax_cents, m.pos_cents,
         m.tips_cents, m.unique_customers, m.members_active, m.new_members,
         m.guest_visits, m.waivers_signed,
         m.sessions_cents, m.gift_sales_cents, m.membership_cents, m.refunds_cents, m.expired_unpaid_cents, m.revenue_basis);
  return m;
}

// Every year, oldest first: the frozen snapshot where one exists (purged
// years), computed live otherwise. This is the Reports feed.
function yearlyMetrics() {
  ensureSchema();
  const first = firstDataYear();
  if (first === null) return [];
  const nowY = localToday().y;
  const snaps = {};
  for (const r of dbM.db.prepare(`SELECT * FROM records_yearly`).all()) snaps[r.year] = r;
  const out = [];
  for (let y = first; y <= nowY; y++) {
    if (snaps[y]) out.push(Object.assign({ frozen: true }, snaps[y]));
    else {
      const m = computeYearMetrics(y);
      // skip truly empty live years at the edges
      if (m.bookings || m.new_members || m.pos_cents || m.revenue_cents || m.waivers_signed || (y >= nowY - 1)) out.push(Object.assign({ frozen: false }, m));
    }
  }
  return out;
}

// ── the purge ────────────────────────────────────────────────────────────
// Anonymize person detail dated inside year y. The row-shape of every table
// is preserved; identity fields are blanked. Order matters: snapshot FIRST.
function purgeYear(y, { by = 'scheduler' } = {}) {
  ensureSchema();
  const D = dbM.db;
  snapshotYear(y);
  const counts = {};
  // sql.js note: SELECT changes() is unreliable across the wrapper's per-run
  // save/export cycle - candidates are counted with a plain SELECT first.
  const runC = (label, countSql, countP, sql, p) => {
    counts[label] = (D.prepare(countSql).get(...countP) || { c: 0 }).c;
    D.prepare(sql).run(...p);
  };

  // 1. signed waivers: rows AND their PDFs go. Pure person detail.
  const wrows = D.prepare(`SELECT id, signed_pdf_path FROM signed_waivers
    WHERE COALESCE(NULLIF(session_date,''), substr(agreed_at,1,10)) BETWEEN ? AND ?`).all(Y0(y), Y1(y));
  let pdfs = 0;
  let SIGNED_DIR = null;
  try { SIGNED_DIR = require('./waiver').SIGNED_DIR; } catch {}
  for (const w of wrows) {
    if (w.signed_pdf_path && SIGNED_DIR) {
      try { fs.unlinkSync(path.join(SIGNED_DIR, w.signed_pdf_path)); pdfs++; } catch {}
    }
  }
  D.prepare(`DELETE FROM signed_waivers
    WHERE COALESCE(NULLIF(session_date,''), substr(agreed_at,1,10)) BETWEEN ? AND ?`).run(Y0(y), Y1(y));
  counts.waiver_rows = wrows.length; counts.waiver_pdfs = pdfs;

  // 2. bookings: the row stays (busy times, money, tax, bay - forever);
  //    everything that says WHO leaves. A Stripe id points at the person, so it
  //    goes - but THAT the session was paid online stays ('purged' in its place):
  //    revenue is money taken (services/revenue.js), and the year's money must
  //    still add up from its own rows after the purge (Sep 23 2026).
  runC('bookings',
    `SELECT COUNT(*) c FROM bookings WHERE date BETWEEN ? AND ? AND name != ?`, [Y0(y), Y1(y), PURGED_NAME],
    `UPDATE bookings SET
      name = ?, phone = '', email = '', door_code = '',
      signature_name = '', waiver_id = '', waiver_agreed_at = '',
      waiver_guardian_for = '', waiver_user_agent = '', waiver_ip = '',
      stripe_payment_intent = CASE WHEN COALESCE(stripe_payment_intent,'') <> '' THEN 'purged' ELSE '' END,
      stripe_charge_id = CASE WHEN COALESCE(stripe_charge_id,'') <> '' THEN 'purged' ELSE '' END,
      remotelock_person_id = '',
      member_id = ''
    WHERE date BETWEEN ? AND ? AND name != ?`, [PURGED_NAME, Y0(y), Y1(y), PURGED_NAME]);

  // 3. per-seat identity (names ride the booking's date)
  runC('seats',
    `SELECT COUNT(*) c FROM seats WHERE name != ? AND booking_id IN (SELECT id FROM bookings WHERE date BETWEEN ? AND ?)`, [PURGED_NAME, Y0(y), Y1(y)],
    `UPDATE seats SET name = ?, member_id = '', waiver_signed_id = ''
    WHERE name != ? AND booking_id IN (SELECT id FROM bookings WHERE date BETWEEN ? AND ?)`, [PURGED_NAME, PURGED_NAME, Y0(y), Y1(y)]);

  // 4. usage / guest logs lose their member link (counts were snapshotted)
  runC('member_usage',
    `SELECT COUNT(*) c FROM member_usage WHERE date BETWEEN ? AND ? AND member_id != ''`, [Y0(y), Y1(y)],
    `UPDATE member_usage SET member_id = '' WHERE date BETWEEN ? AND ? AND member_id != ''`, [Y0(y), Y1(y)]);
  runC('member_guests',
    `SELECT COUNT(*) c FROM member_guests WHERE date BETWEEN ? AND ? AND member_id != ''`, [Y0(y), Y1(y)],
    `UPDATE member_guests SET member_id = '' WHERE date BETWEEN ? AND ? AND member_id != ''`, [Y0(y), Y1(y)]);

  // 5. discount uses lose the phone
  runC('discount_uses',
    `SELECT COUNT(*) c FROM discount_uses WHERE substr(used_at,1,4) = ? AND phone != ''`, [String(y)],
    `UPDATE discount_uses SET phone = '' WHERE substr(used_at,1,4) = ? AND phone != ''`, [String(y)]);

  // 6. POS surfaces: tab labels can be walk-in customer names; person chips
  //    name seat guests; employee stamps are person detail too at 10+ years.
  //    Amounts, items, taxes, drawer math - all stay untouched forever.
  runC('tabs',
    `SELECT COUNT(*) c FROM tabs WHERE substr(opened_at,1,4) = ? AND label != ?`, [String(y), PURGED_NAME],
    `UPDATE tabs SET label = ?, member_id = '', opened_by = '', closed_by = ''
    WHERE substr(opened_at,1,4) = ? AND label != ?`, [PURGED_NAME, String(y), PURGED_NAME]);
  runC('tab_items',
    `SELECT COUNT(*) c FROM tab_items WHERE substr(sent_at,1,4) = ? AND (person != '' OR sent_by != '' OR COALESCE(void_by,'') != '' OR COALESCE(reviewed_by,'') != '')`, [String(y)],
    `UPDATE tab_items SET person = '', sent_by = '', void_by = '', reviewed_by = ''
    WHERE substr(sent_at,1,4) = ?`, [String(y)]);
  runC('tab_payments',
    `SELECT COUNT(*) c FROM tab_payments WHERE substr(created_at,1,4) = ? AND (COALESCE(employee,'') != '' OR stripe_pi != '' OR memo != '')`, [String(y)],
    `UPDATE tab_payments SET employee = '', stripe_pi = '', memo = ''
    WHERE substr(created_at,1,4) = ?`, [String(y)]);
  runC('drawer_events',
    `SELECT COUNT(*) c FROM drawer_events WHERE substr(at,1,4) = ? AND employee != ''`, [String(y)],
    `UPDATE drawer_events SET employee = '' WHERE substr(at,1,4) = ?`, [String(y)]);
  runC('settlements',
    `SELECT COUNT(*) c FROM settlements WHERE substr(settled_at,1,4) = ? AND settled_by != ''`, [String(y)],
    `UPDATE settlements SET settled_by = '' WHERE substr(settled_at,1,4) = ?`, [String(y)]);

  // 6b. employees (Sep 2026): hours worked, shifts and requests are facility
  //     history and stay; the person leaves. staff_code is a sign-in code,
  //     not an identity that outlives the roster - it is blanked too.
  runC('time_entries',
    `SELECT COUNT(*) c FROM time_entries WHERE substr(clock_in,1,4) = ? AND (staff_name != ? OR staff_code != '')`, [String(y), PURGED_NAME],
    `UPDATE time_entries SET staff_name = ?, staff_code = '', reviewed_by = '', edited_by = '', note = '', flag_reason = ''
    WHERE substr(clock_in,1,4) = ?`, [PURGED_NAME, String(y)]);
  runC('shifts',
    `SELECT COUNT(*) c FROM shifts WHERE substr(date,1,4) = ? AND COALESCE(staff_code,'') != ''`, [String(y)],
    `UPDATE shifts SET staff_code = '', note = '' WHERE substr(date,1,4) = ?`, [String(y)]);
  // W29: a sent hours export keeps its stored file (names inside) only until
  // the period's year purges; the row - when, to whom, how many hours - stays.
  runC('hours_sends',
    `SELECT COUNT(*) c FROM hours_sends WHERE substr(period_start,1,4) = ? AND csv != ''`, [String(y)],
    `UPDATE hours_sends SET csv = '', token = '' WHERE substr(period_start,1,4) = ?`, [String(y)]);
  runC('timeoff_requests',
    `SELECT COUNT(*) c FROM timeoff_requests WHERE substr(start_date,1,4) = ? AND staff_name != ?`, [String(y), PURGED_NAME],
    `UPDATE timeoff_requests SET staff_name = ?, staff_code = '', note = '', decided_by = '' WHERE substr(start_date,1,4) = ?`, [PURGED_NAME, String(y)]);
  runC('shift_requests',
    `SELECT COUNT(*) c FROM shift_requests WHERE substr(created_at,1,4) = ? AND staff_name != ?`, [String(y), PURGED_NAME],
    `UPDATE shift_requests SET staff_name = ?, staff_code = '', note = '', decided_by = '' WHERE substr(created_at,1,4) = ?`, [PURGED_NAME, String(y)]);

  // 7. the admin log: operational trail, detail strings can carry names.
  //    Deleted outright - it holds no facility metric.
  runC('admin_log',
    `SELECT COUNT(*) c FROM admin_log WHERE substr(created_at,1,4) = ?`, [String(y)],
    `DELETE FROM admin_log WHERE substr(created_at,1,4) = ?`, [String(y)]);

  // 8. members: only rows that are BOTH not active AND silent since the
  //    purged year. tier_id / created_at / status stay, so member-count and
  //    growth history survive; the person leaves. PIN becomes an unusable
  //    unique placeholder (column is UNIQUE).
  const cutoff = Y1(y);
  const mrows = D.prepare(`SELECT id FROM members
    WHERE status != 'active' AND name != ?
      AND substr(created_at,1,10) <= ?
      AND COALESCE(NULLIF(substr(updated_at,1,10),''), substr(created_at,1,10)) <= ?
      AND id NOT IN (SELECT DISTINCT member_id FROM member_usage   WHERE date > ? AND member_id != '')
      AND id NOT IN (SELECT DISTINCT member_id FROM bookings       WHERE date > ? AND COALESCE(member_id,'') != '')
      AND id NOT IN (SELECT DISTINCT member_id FROM signed_waivers WHERE member_id != '' AND COALESCE(NULLIF(session_date,''), substr(agreed_at,1,10)) > ?)`)
    .all(PURGED_NAME, cutoff, cutoff, cutoff, cutoff, cutoff);
  for (const m of mrows) {
    const ph = 'PURGED-' + require('crypto').randomBytes(6).toString('hex');
    D.prepare(`UPDATE members SET name = ?, phone = '', email = '', pin = ?, notes = '',
      stripe_customer_id = '', stripe_subscription_id = '', unifi_user_id = '',
      unifi_pin_set = '', unifi_error = ''
      WHERE id = ?`).run(PURGED_NAME, ph, m.id);   // (the build review: the PIN the console held, and an error that names the person)
  }
  counts.members = mrows.length;

  D.prepare(`INSERT INTO records_purges (year, warned_at, purged_at, detail)
             VALUES (?, '', datetime('now'), ?)
             ON CONFLICT(year) DO UPDATE SET purged_at = datetime('now'), detail = excluded.detail`)
    .run(y, JSON.stringify(counts));
  try { dbM.adminLog('RECORDS_PURGED', `year ${y} anonymized (${by}): ` + JSON.stringify(counts)); } catch {}
  try { dbM.save(); } catch {}
  return counts;
}

// ── the nightly tick ─────────────────────────────────────────────────────
// 1) WARN: one email per year, WARN_DAYS before it purges.
// 2) PURGE: every eligible year that still holds person detail.
async function runNightly(today = localToday()) {
  ensureSchema();
  const D = dbM.db;
  const out = { warned: [], purged: [] };
  // the owner's log, pruned by age each night (at least twelve months kept - maintainer, Sep 12 2026)
  try { out.adminLogPruned = dbM.pruneAdminLog ? dbM.pruneAdminLog() : 0; } catch {}

  // warn pass - the year that purges next Jan 1, once we're inside the window
  const nx = nextPurge(today);
  const purgeDate = new Date(nx.on + 'T00:00:00');
  const daysOut = Math.ceil((purgeDate - today.date) / 86400000);
  if (daysOut <= WARN_DAYS && daysOut > 0 && yearHasPersonDetail(nx.year)) {
    const row = D.prepare(`SELECT warned_at FROM records_purges WHERE year = ?`).get(nx.year);
    if (!row || !row.warned_at) {
      // SENT FIRST, THEN MARKED (Oct 3 2026; the Sep 13 audit's MEDIUM): the year was marked warned before the email was
      // tried and the email's answer thrown away, so an owner whose email failed that night was never warned before
      // names were removed for good (rule 29). A refused email is logged and tried again the next night; a unit with no
      // owner address or no email set up has the log line as its notice.
      let sent;
      const cfg = require('./config').getConfig();
      const to = cfg.contact && cfg.contact.email;
      try {
        sent = to ? await require('./email').sendEmail({ to,
          subject: `${(cfg.server && cfg.server.businessName) || 'Your booking system'}: ${nx.year} records purge on ${nx.on}`,
          text: `On ${nx.on}, customer names, phone numbers, emails and signed waivers from ${nx.year} will be removed automatically under your records retention setting (${retentionYears()} years).\n\nYour business numbers from ${nx.year} - revenue, tax collected, busy times, member counts - are kept forever and are not affected.\n\nIf you want to keep the full ${nx.year} detail, open Admin > Settings > Protection > Records and download the ${nx.year} archive before that date. Nothing else is needed.` }) : undefined;
      } catch (e) { sent = false; }
      if (sent === false) {
        try { dbM.adminLog('RECORDS_PURGE_NOTICE_FAILED', `year ${nx.year} purges ${nx.on} - the email to the owner did not go; tried again tomorrow night`); } catch {}
      } else {
        D.prepare(`INSERT INTO records_purges (year, warned_at) VALUES (?, datetime('now'))
                   ON CONFLICT(year) DO UPDATE SET warned_at = datetime('now')`).run(nx.year);
        try { dbM.adminLog('RECORDS_PURGE_NOTICE', `year ${nx.year} purges ${nx.on}${sent ? ' - emailed to the owner' : ''}`); } catch {}
        out.warned.push(nx.year);
      }
    }
  }

  // purge pass - every year at or past its date that still holds detail
  for (let y = lastEligibleYear(today); y >= (firstDataYear() || y + 1); y--) {
    const done = D.prepare(`SELECT purged_at FROM records_purges WHERE year = ?`).get(y);
    if (done && done.purged_at) continue;
    if (!yearHasPersonDetail(y)) continue;
    out.purged.push({ year: y, counts: purgeYear(y) });
  }
  return out;
}

// ── the per-year archive ─────────────────────────────────────────────────
// Full person detail for one year, for owners who want it longer than the
// retention window. CSVs + the signed PDFs. Streams a zip; the ROUTE decides
// plain vs vault-encrypted (a download is a copy that leaves the unit).
function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, cols) {
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

function buildYearArchive(y, outPath) {
  ensureSchema();
  const D = dbM.db;
  const { ZipArchive } = require('archiver');
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const zip = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve(outPath));
    zip.on('error', reject);
    zip.pipe(output);

    const bookings = D.prepare(`SELECT id, date, start_time, end_time, duration_minutes, bay_name,
        name, phone, email, price_cents, tax_cents, status, booking_type, member_id, signature_name, created_at
      FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, start_time`).all(Y0(y), Y1(y));
    zip.append(toCsv(bookings, ['id','date','start_time','end_time','duration_minutes','bay_name','name','phone','email','price_cents','tax_cents','status','booking_type','member_id','signature_name','created_at']),
      { name: `bookings-${y}.csv` });

    const waivers = D.prepare(`SELECT id, booking_id, member_id, waiver_name, waiver_version, customer_name,
        customer_phone, customer_email, agreed_at, method, scope, employee, signature_name, guardian_for,
        session_date, session_time, bay_name, signed_pdf_path
      FROM signed_waivers WHERE COALESCE(NULLIF(session_date,''), substr(agreed_at,1,10)) BETWEEN ? AND ?
      ORDER BY agreed_at`).all(Y0(y), Y1(y));
    zip.append(toCsv(waivers, ['id','booking_id','member_id','waiver_name','waiver_version','customer_name','customer_phone','customer_email','agreed_at','method','scope','employee','signature_name','guardian_for','session_date','session_time','bay_name','signed_pdf_path']),
      { name: `signed-waivers-${y}.csv` });

    let SIGNED_DIR = null; try { SIGNED_DIR = require('./waiver').SIGNED_DIR; } catch {}
    if (SIGNED_DIR) for (const w of waivers) {
      if (!w.signed_pdf_path) continue;
      const fp = path.join(SIGNED_DIR, w.signed_pdf_path);
      if (fs.existsSync(fp)) zip.file(fp, { name: `waiver-pdfs/${w.signed_pdf_path}` });
    }

    const members = D.prepare(`SELECT DISTINCT m.id, m.name, m.phone, m.email, m.tier_id, m.status, m.created_at
      FROM members m WHERE substr(m.created_at,1,4) = ?
         OR m.id IN (SELECT member_id FROM member_usage WHERE date BETWEEN ? AND ? AND member_id != '')
      ORDER BY m.created_at`).all(String(y), Y0(y), Y1(y));
    zip.append(toCsv(members, ['id','name','phone','email','tier_id','status','created_at']),
      { name: `members-${y}.csv` });

    zip.append(
`Records archive - year ${y}
Created ${new Date().toISOString()}

This zip holds the full customer detail for ${y}: every booking with names
and contact info, every signed waiver (CSV + the signed PDFs), and the
members created or active that year.

Under your retention setting (${retentionYears()} years) this detail is
removed from the system automatically after Jan 1, ${y + retentionYears() + 1}.
Your business numbers for ${y} (revenue, tax, busy times, member counts)
stay in the system forever either way.

Keep this file somewhere safe - it is personal customer data.
`, { name: 'README.txt' });

    zip.finalize();
  });
}

// ── status for the admin card ────────────────────────────────────────────
function status() {
  ensureSchema();
  const D = dbM.db;
  const today = localToday();
  const nx = nextPurge(today);
  const purges = D.prepare(`SELECT * FROM records_purges ORDER BY year`).all();
  const eligible = [];
  for (let y = lastEligibleYear(today); y >= (firstDataYear() || y + 1); y--)
    if (yearHasPersonDetail(y)) eligible.push(y);
  // archivable = years that still hold person detail (not yet purged)
  const archivable = [];
  const first = firstDataYear();
  if (first !== null) for (let y = first; y <= today.y; y++) if (yearHasPersonDetail(y)) archivable.push(y);
  const logStats = (dbM.adminLogStats && dbM.adminLogStats()) || null;
  return {
    admin_log_months: dbM.adminLogMonths ? dbM.adminLogMonths() : 12,
    admin_log_floor_months: dbM.ADMIN_LOG_FLOOR_MONTHS || 12,
    admin_log: logStats,
    retention_years: retentionYears(),
    floor_years: FLOOR_YEARS,
    next_purge: Object.assign(nx, { has_detail: yearHasPersonDetail(nx.year) }),
    eligible_now: eligible,
    archivable,
    // every year the year-end report can be made for (any data at all, frozen included)
    report_years: (() => { const f = firstDataYear(); const out = []; if (f !== null) for (let y = f; y <= today.y; y++) out.push(y); return out; })(),
    purges,
    yearly: yearlyMetrics()
  };
}

module.exports = { ensureSchema, retentionYears, FLOOR_YEARS, WARN_DAYS, PURGED_NAME,
  lastEligibleYear, nextPurge, yearHasPersonDetail, computeYearMetrics, snapshotYear, firstDataYear,
  yearlyMetrics, purgeYear, runNightly, buildYearArchive, status };
