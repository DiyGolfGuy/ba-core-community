// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/hourssend.js — the hours export, emailed on a schedule (W29, Sep 3 2026).
//
// ONE FILE: buildExport() is the six-column CSV the manual Export hours
// button serves (routes/staff.js calls it too), so the scheduled attachment
// is byte-identical - header, quoting, footer, filename. No overtime column,
// ever; no period numbers; nothing but recorded hours (CLAUDE.md rule 12).
//
// The period is the one the owner set in Hours & Export (timeclock.periodBounds)
// - never asked twice. Cadence: each closed period becomes due `daysAfter`
// days after its last day at `time`, facility clock. Mode 'auto' sends then;
// mode 'hold' emails the owner a review link then and sends only on Approve.
// One hours_sends row per period is the "never twice" ledger and survives a
// reboot. A closed period is sent at its moment unless that moment came before
// the owner turned this on (then Send now covers it), and it is never lost
// because a newer period has closed since - owedPeriods() below. Every send,
// hold, approval, skip and failure lands in admin_log. Words: "hours export",
// "recipient" - nothing about pay.
'use strict';

const crypto = require('crypto');
const configService = require('./config');
const dbMod = require('./db');
const tc = require('./timeclock');

const HEADER = 'Employee Name,Employee Number,Period Start,Period End,Hours Worked,Break Minutes';
const FOOTER = 'Recorded hours from clock-in/out. Not a payroll calculation. Verify before use.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULTS = { enabled: false, recipients: [], daysAfter: 1, time: '06:00', mode: 'auto', plainCsvOk: false, enabledAt: '' };
const RETRY_MINUTES = 60;

const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
function rosterByCode(code) { try { return require('./staff').roster().find(s => String(s.code) === String(code)) || null; } catch { return null; } }

/** The export for a closed range: the exact bytes the manual button serves, plus what the emails say about them. */
function buildExport(start, end) {
  const rows = dbMod.db.prepare(
    `SELECT staff_code, staff_name, SUM(worked_minutes) AS mins, SUM(break_minutes) AS brk, COUNT(*) AS n
       FROM time_entries WHERE clock_out IS NOT NULL AND date(clock_in) BETWEEN ? AND ?
      GROUP BY staff_code ORDER BY staff_name`).all(start, end);
  const lines = [HEADER];
  const people = [];
  let totalMinutes = 0;
  for (const r of rows) {
    const p = rosterByCode(r.staff_code);
    const name = p ? p.name : (r.staff_name || ''), num = p ? (p.empNumber || '') : '';
    const mins = Number(r.mins) || 0, brk = Number(r.brk) || 0;
    totalMinutes += mins;
    people.push({ name, empNumber: num, hours: (mins / 60).toFixed(2), breakMinutes: brk });
    lines.push([q(name), q(num), q(start), q(end), q((mins / 60).toFixed(2)), q(brk)].join(','));
  }
  lines.push('');
  lines.push(q(FOOTER));
  const csv = lines.join('\n') + '\n';
  return { csv, filename: `hours-${start}_${end}.csv`, people, totalMinutes,
    totalHours: (totalMinutes / 60).toFixed(2), bytes: Buffer.byteLength(csv), sha256: crypto.createHash('sha256').update(csv).digest('hex') };
}

// ── config ─────────────────────────────────────────────────────────────────
function sendCfg(cfg) {
  const c = cfg || configService.getConfig();
  const s = Object.assign({}, DEFAULTS, (c.scheduling && c.scheduling.hoursSend) || {});
  s.recipients = Array.isArray(s.recipients) ? s.recipients : [];
  return s;
}
function ownerEmail(cfg) { const c = cfg || configService.getConfig(); return String((c.contact && c.contact.email) || '').trim(); }
function businessName(cfg) { const c = cfg || configService.getConfig(); return (c.server && c.server.businessName) || 'Your facility'; }
function emailReady(cfg) {
  if (process.env.EMAIL_DRYRUN === '1') return true;
  const c = cfg || configService.getConfig();
  return !!(c.resend && String(c.resend.apiKey || '').startsWith('re_') && c.resend.fromEmail);
}
/** Validate + save. Returns { error } or { cfg }. Turning on demands a recipient and the plain-CSV tick. */
function saveSendCfg(patch) {
  const cfg = configService.getConfig();
  const cur = sendCfg(cfg);
  const next = Object.assign({}, cur);
  const p = patch || {};
  if (p.recipients !== undefined) {
    const list = (Array.isArray(p.recipients) ? p.recipients : String(p.recipients).split(/[,;\s]+/))
      .map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
    if (list.length > 5) return { error: 'Up to five addresses' };
    const bad = list.find(x => !EMAIL_RE.test(x));
    if (bad) return { error: `Not an email address: ${bad}` };
    next.recipients = [...new Set(list)];
  }
  if (p.daysAfter !== undefined) { const n = parseInt(p.daysAfter, 10); if (!(n >= 1 && n <= 14)) return { error: 'daysAfter must be 1-14' }; next.daysAfter = n; }
  if (p.time !== undefined) { if (!TIME_RE.test(String(p.time))) return { error: 'time must be HH:MM' }; next.time = String(p.time); }
  if (p.mode !== undefined) { if (!['auto', 'hold'].includes(p.mode)) return { error: 'mode must be auto or hold' }; next.mode = p.mode; }
  if (p.plainCsvOk !== undefined) next.plainCsvOk = !!p.plainCsvOk;
  if (p.enabled !== undefined) {
    const on = !!p.enabled;
    if (on && !next.plainCsvOk) return { error: 'Tick the plain-CSV box first' };
    if (on && !next.recipients.length) return { error: 'Name at least one recipient first' };
    if (on && !cur.enabled) next.enabledAt = tc.localStamp();
    next.enabled = on;
  }
  if (next.enabled && !next.plainCsvOk) next.enabled = false;
  cfg.scheduling = Object.assign({}, cfg.scheduling, { hoursSend: next });
  configService.saveConfig(cfg);
  dbMod.adminLog('HOURS_SEND_CONFIG_SAVED', `${next.enabled ? 'on' : 'off'}, ${next.mode}, ${next.daysAfter} day${next.daysAfter === 1 ? '' : 's'} ${next.time}, to ${next.recipients.join(' ') || '(nobody)'}`);
  return { cfg: next };
}

// ── time ───────────────────────────────────────────────────────────────────
function dueStamp(sc, periodEnd) { return `${tc.addDays(periodEnd, sc.daysAfter)} ${sc.time}:00`; }
function fmtDay(ymd) { const [y, m, d] = ymd.split('-').map(Number); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${d}`; }
function fmtRange(start, end) {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return sameYear ? `${fmtDay(start)} to ${fmtDay(end)}, ${end.slice(0, 4)}` : `${fmtDay(start)}, ${start.slice(0, 4)} to ${fmtDay(end)}, ${end.slice(0, 4)}`;
}
function periodLabel(p) { return { weekly: 'Weekly', biweekly: 'Every two weeks', semimonthly: 'Twice a month', monthly: 'Monthly' }[p] || 'Weekly'; }
function baseUrl(cfg) {
  const d = String((cfg.seo && cfg.seo.domain) || '').trim().replace(/\/+$/, '');
  if (d) return d.startsWith('http') ? d : `https://${d}`;
  try {
    const nets = require('os').networkInterfaces();
    for (const k of Object.keys(nets)) for (const n of nets[k]) if (n.family === 'IPv4' && !n.internal) return `http://${n.address}:${(cfg.server && cfg.server.port) || 3001}`;
  } catch {}
  return `http://localhost:${(cfg.server && cfg.server.port) || 3001}`;
}

// ── the ledger ─────────────────────────────────────────────────────────────
const D = () => dbMod.db;
function rowFor(start, end) { return D().prepare(`SELECT * FROM hours_sends WHERE period_start = ? AND period_end = ? ORDER BY id DESC LIMIT 1`).get(start, end) || null; }
function rowById(id) { return D().prepare(`SELECT * FROM hours_sends WHERE id = ?`).get(id) || null; }
function rowByToken(token) { return token ? (D().prepare(`SELECT * FROM hours_sends WHERE token = ? AND status = 'held'`).get(String(token)) || null) : null; }
function lastSent() { return D().prepare(`SELECT * FROM hours_sends WHERE status = 'sent' ORDER BY sent_at DESC, id DESC LIMIT 1`).get() || null; }
function pendingRow() { return D().prepare(`SELECT * FROM hours_sends WHERE status = 'held' ORDER BY id DESC LIMIT 1`).get() || null; }
function pub(r) {
  if (!r) return null;
  return { id: r.id, start: r.period_start, end: r.period_end, status: r.status, how: r.how, recipients: r.recipients, cc: r.cc,
    people: r.people, totalHours: ((r.total_minutes || 0) / 60).toFixed(2), bytes: r.bytes, sha256: r.sha256, error: r.error,
    created_at: r.created_at, sent_at: r.sent_at, approved_at: r.approved_at };
}
function insertRow(o) {
  // created_at is written as a facility-local stamp like every other column
  // here (the table default would be UTC - seen on the bench as a 5-hour lie)
  D().prepare(`INSERT INTO hours_sends (period_start, period_end, status, how, recipients, cc, people, total_minutes, bytes, sha256, csv, token, error, sent_at, approved_at, last_attempt_at, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(o.start, o.end, o.status, o.how || '', o.recipients || '', o.cc || '', o.people || 0, o.total_minutes || 0, o.bytes || 0, o.sha256 || '', o.csv || '', o.token || '', o.error || '', o.sent_at || null, o.approved_at || null, o.last_attempt_at || null, tc.localStamp());
  return (D().prepare(`SELECT MAX(id) AS id FROM hours_sends`).get() || {}).id;
}

// ── the emails ─────────────────────────────────────────────────────────────
/**
 * Send one period to the recipients, owner copied. `csv` given = resend of
 * stored bytes; otherwise the export is built now. Updates/creates the row.
 */
async function send({ start, end, how, rowId, stored }) {
  const cfg = configService.getConfig();
  const sc = sendCfg(cfg);
  const to = stored ? String(stored.recipients || '').split(' ').filter(Boolean) : sc.recipients;
  const cc = ownerEmail(cfg);
  const ex = stored ? { csv: stored.csv, filename: `hours-${start}_${end}.csv`, people: null, totalMinutes: stored.total_minutes, totalHours: ((stored.total_minutes || 0) / 60).toFixed(2), bytes: stored.bytes, sha256: stored.sha256, peopleCount: stored.people }
                    : buildExport(start, end);
  const peopleCount = ex.people ? ex.people.length : ex.peopleCount;
  const now = tc.localStamp();
  const fail = async (why) => {
    if (rowId) D().prepare(`UPDATE hours_sends SET status = CASE WHEN status = 'held' THEN 'held' ELSE 'failed' END, error = ?, last_attempt_at = ? WHERE id = ?`).run(why, now, rowId);
    else rowId = insertRow({ start, end, status: 'failed', how, recipients: to.join(' '), cc, people: peopleCount, total_minutes: ex.totalMinutes, bytes: ex.bytes, sha256: ex.sha256, csv: ex.csv, error: why, last_attempt_at: now });
    dbMod.adminLog('HOURS_SEND_FAILED', `${start} to ${end} - ${why}; will retry`);
    return { ok: false, error: why, id: rowId };
  };
  if (!to.length) return fail('no recipient named');
  if (!emailReady(cfg)) return fail('email not configured');
  const biz = businessName(cfg);
  const text = `${biz}\nHours export for ${fmtRange(start, end)}\n${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}, ${ex.totalHours} hours\n\n${FOOTER}\n`;
  const sent = await require('./email').sendEmail({ to, cc: cc ? [cc] : undefined,
    subject: `Hours export - ${biz} - ${fmtRange(start, end)}`, text,
    attachments: [{ filename: ex.filename, content: Buffer.from(ex.csv).toString('base64') }] });
  if (!sent) return fail('email service refused the message');
  if (rowId) D().prepare(`UPDATE hours_sends SET status = 'sent', how = ?, recipients = ?, cc = ?, people = ?, total_minutes = ?, bytes = ?, sha256 = ?, csv = ?, error = '', sent_at = ?, last_attempt_at = ?, token = '' WHERE id = ?`)
    .run(how, to.join(' '), cc, peopleCount, ex.totalMinutes, ex.bytes, ex.sha256, ex.csv, now, now, rowId);
  else rowId = insertRow({ start, end, status: 'sent', how, recipients: to.join(' '), cc, people: peopleCount, total_minutes: ex.totalMinutes, bytes: ex.bytes, sha256: ex.sha256, csv: ex.csv, sent_at: now, last_attempt_at: now });
  dbMod.adminLog('HOURS_SENT', `${start} to ${end}, ${peopleCount} people, ${ex.bytes} bytes sha ${ex.sha256.slice(0, 12)}, to ${to.join(' ')}${cc ? ' cc ' + cc : ''}, ${how}`);
  return { ok: true, id: rowId, sha256: ex.sha256, bytes: ex.bytes };
}

/** Hold mode: store the export, email the owner the summary and the review link. */
async function hold(start, end) {
  const cfg = configService.getConfig();
  const owner = ownerEmail(cfg);
  const ex = buildExport(start, end);
  const now = tc.localStamp();
  let row = rowFor(start, end);
  if (row && row.status === 'held') return { ok: true, id: row.id, already: true };
  const token = crypto.randomBytes(16).toString('hex');
  const flagged = (D().prepare(`SELECT COUNT(*) AS c FROM time_entries WHERE flagged = 1 AND reviewed = 0`).get() || {}).c || 0;
  const id = row && row.status === 'failed'
    ? (D().prepare(`UPDATE hours_sends SET status = 'held', token = ?, people = ?, total_minutes = ?, bytes = ?, sha256 = ?, csv = ?, error = '', last_attempt_at = ? WHERE id = ?`).run(token, ex.people.length, ex.totalMinutes, ex.bytes, ex.sha256, ex.csv, now, row.id), row.id)
    : insertRow({ start, end, status: 'held', how: 'held', people: ex.people.length, total_minutes: ex.totalMinutes, bytes: ex.bytes, sha256: ex.sha256, csv: ex.csv, token, last_attempt_at: now });
  const why = !owner ? 'no facility email under Business & Content' : (!emailReady(cfg) ? 'email not configured' : '');
  if (why) {
    D().prepare(`UPDATE hours_sends SET status = 'failed', error = ? WHERE id = ?`).run(why, id);
    dbMod.adminLog('HOURS_SEND_FAILED', `${start} to ${end} - ${why}; will retry`);
    return { ok: false, id, error: why };
  }
  const biz = businessName(cfg), sc = sendCfg(cfg);
  const link = `${baseUrl(cfg)}/admin?hours-review=${token}`;
  const lines = ex.people.map(p => `${p.name}${p.empNumber ? ' (' + p.empNumber + ')' : ''}: ${p.hours} hours, ${p.breakMinutes} break minutes`);
  const text = `${biz}\nThe hours period ${fmtRange(start, end)} has closed. The export is held for your sign-off.\n${ex.people.length} ${ex.people.length === 1 ? 'person' : 'people'}, ${ex.totalHours} hours\n\n${lines.join('\n') || '(no closed entries in this period)'}\n\n`
    + (flagged ? `Entries still flagged for your review: ${flagged}. Fix them first if you want them right in the file.\n\n` : '')
    + `Review and approve: ${link}\nSign in as the owner; the card shows Approve and send, Download to check first, and Skip this period. Nothing goes to ${sc.recipients.join(', ')} until you approve. The link stops working when the next period closes.\n\n${FOOTER}\n`;
  const sent = await require('./email').sendEmail({ to: owner, subject: `Hours export ready for your sign-off - ${biz} - ${fmtRange(start, end)}`, text });
  if (!sent) {
    D().prepare(`UPDATE hours_sends SET status = 'failed', error = ? WHERE id = ?`).run('email service refused the review message', id);
    dbMod.adminLog('HOURS_SEND_FAILED', `${start} to ${end} - review email refused; will retry`);
    return { ok: false, id, error: 'email service refused the review message' };
  }
  dbMod.adminLog('HOURS_SEND_HELD', `${start} to ${end}, ${ex.people.length} people, review link to ${owner}`);
  return { ok: true, id };
}

// ── the actions ────────────────────────────────────────────────────────────
async function approve(idOrToken, actor) {
  const row = /^\d+$/.test(String(idOrToken)) ? rowById(Number(idOrToken)) : rowByToken(idOrToken);
  if (!row) return { error: 'Nothing is waiting for sign-off', status: 404 };
  if (row.status !== 'held') return { error: `That period is already ${row.status}`, status: 409 };
  D().prepare(`UPDATE hours_sends SET approved_at = ? WHERE id = ?`).run(tc.localStamp(), row.id);
  dbMod.adminLog('HOURS_SEND_APPROVED', `${row.period_start} to ${row.period_end} by ${actor || 'owner'}`);
  // rebuilt at approval so an entry fixed since the link went is in the file
  return send({ start: row.period_start, end: row.period_end, how: 'approved', rowId: row.id });
}
function skip(id, actor) {
  const row = rowById(Number(id));
  if (!row) return { error: 'Nothing is waiting for sign-off', status: 404 };
  if (row.status !== 'held') return { error: `That period is already ${row.status}`, status: 409 };
  D().prepare(`UPDATE hours_sends SET status = 'skipped', token = '', csv = '' WHERE id = ?`).run(row.id);
  dbMod.adminLog('HOURS_SEND_SKIPPED', `${row.period_start} to ${row.period_end} by ${actor || 'owner'}`);
  return { ok: true, id: row.id };
}
/** Send the most recently closed period this minute - the owner pressing it IS the sign-off. */
async function sendNow() {
  const cfg = configService.getConfig();
  const b = tc.periodBounds(cfg, tc.localToday());
  const row = rowFor(b.lastStart, b.lastEnd);
  if (row && row.status === 'held') {
    D().prepare(`UPDATE hours_sends SET approved_at = ? WHERE id = ?`).run(tc.localStamp(), row.id);
    dbMod.adminLog('HOURS_SEND_APPROVED', `${row.period_start} to ${row.period_end} by owner (Send now)`);
  }
  const r = await send({ start: b.lastStart, end: b.lastEnd, how: 'now', rowId: row && row.status !== 'sent' && row.status !== 'skipped' ? row.id : undefined });
  return Object.assign({ start: b.lastStart, end: b.lastEnd }, r);
}
/** The exact bytes that went last time, to the same addresses. */
async function resendLast() {
  const last = lastSent();
  if (!last) return { error: 'Nothing has been sent yet', status: 404 };
  if (!last.csv) return { error: 'The last file is no longer stored', status: 409 };
  const r = await send({ start: last.period_start, end: last.period_end, how: `resend of #${last.id}`, stored: last });
  return Object.assign({ start: last.period_start, end: last.period_end, of: last.id }, r);
}

// ── WHICH CLOSED PERIODS ARE STILL OWED A SEND - one rule for the tick and the card ──
// maintainer's ruling (Sep 22-23 2026): a period that closes while the unit is off, or
// whose moment comes after the NEXT period has closed (days-after longer than
// the period), must still be sent. The tick used to look at the newest closed
// period only, so a weekly period sent 8-14 days after its end sent nothing,
// ever, and a unit off across a close lost the week it missed. Walking back from
// the newest closed period: a period is owed while its moment is at or after the
// switch-on and no row has settled it (sent, held, skipped). An older one is
// owed only when it was tried and failed, when the ledger holds a period behind
// it (the schedule was running - the unit was off, or days-after spans a close),
// or when its moment falls after the next period closed. A changed period
// setting has no ledger behind its older periods, so it never reaches back.
const LOOKBACK = 8;   // periods walked back - two months of weekly ones
function owedPeriods(cfg, sc, today) {
  if (!sc.enabled) return [];
  const b = tc.periodBounds(cfg, today);
  const list = [];
  let start = b.lastStart, end = b.lastEnd;
  for (let i = 0; i < LOOKBACK; i++) {
    list.push({ start, end, due: dueStamp(sc, end), row: rowFor(start, end) });
    start = tc.currentPeriodStart(cfg, tc.addDays(start, -1));
    end = tc.periodEnd(cfg, start);
  }
  const settled = list.findIndex(p => p.row && p.row.status !== 'failed');
  const running = settled !== -1;
  const owed = [];
  for (const [i, p] of (running ? list.slice(0, settled) : list).entries()) {
    if (sc.enabledAt && p.due < sc.enabledAt) break;   // its moment came before the switch-on: left alone, and everything older too
    if (i > 0 && !p.row && !running && !(p.due.slice(0, 10) > list[i - 1].end)) break;
    owed.push(p);
  }
  return owed.reverse();   // oldest first
}

/** The scheduler's minute tick (and the boot catch-up): every owed period whose moment has come, oldest first. nowStamp is for batteries. */
async function tick(nowStamp) {
  const cfg = configService.getConfig();
  if (!(cfg.scheduling && cfg.scheduling.enabled)) return { skipped: 'scheduling off' };
  const sc = sendCfg(cfg);
  if (!sc.enabled || !sc.plainCsvOk || !sc.recipients.length) return { skipped: 'off' };
  const now = nowStamp || tc.localStamp();
  const due = owedPeriods(cfg, sc, tc.localToday()).filter(p => p.due <= now);
  if (!due.length) return { skipped: 'not due' };
  const done = [];
  for (const p of due) {
    if (p.row && p.row.last_attempt_at && tc.minutesBetweenStamps(p.row.last_attempt_at, now) < RETRY_MINUTES) { done.push({ start: p.start, end: p.end, skipped: 'retry later' }); continue; }
    done.push(Object.assign({ start: p.start, end: p.end }, sc.mode === 'hold' ? await hold(p.start, p.end) : await send({ start: p.start, end: p.end, how: 'scheduled', rowId: p.row ? p.row.id : undefined })));
  }
  return done.length === 1 ? done[0] : { periods: done };
}

/** Everything the card shows. */
function status() {
  const cfg = configService.getConfig();
  const sc = sendCfg(cfg);
  const today = tc.localToday();
  const b = tc.periodBounds(cfg, today);
  const lastRow = rowFor(b.lastStart, b.lastEnd);
  let next = null;
  if (sc.enabled) {
    const owed = owedPeriods(cfg, sc, today)[0];   // the oldest period still owed: exactly what the tick sends next
    next = owed ? { at: owed.due, start: owed.start, end: owed.end, overdue: owed.due <= tc.localStamp() }
                : { at: dueStamp(sc, b.thisEnd), start: b.thisStart, end: b.thisEnd, overdue: false };
  }
  const flagged = (D().prepare(`SELECT COUNT(*) AS c FROM time_entries WHERE flagged = 1 AND reviewed = 0`).get() || {}).c || 0;
  return { config: { enabled: sc.enabled, recipients: sc.recipients, daysAfter: sc.daysAfter, time: sc.time, mode: sc.mode, plainCsvOk: sc.plainCsvOk, enabledAt: sc.enabledAt },
    ownerEmail: ownerEmail(cfg), emailReady: emailReady(cfg),
    period: { kind: b.period, label: periodLabel(b.period), thisStart: b.thisStart, thisEnd: b.thisEnd, lastStart: b.lastStart, lastEnd: b.lastEnd },
    next, last: pub(lastSent()), pending: pub(pendingRow()), lastClosed: pub(lastRow), flaggedOpen: flagged };
}

module.exports = { HEADER, FOOTER, buildExport, sendCfg, saveSendCfg, dueStamp, fmtRange, tick, send, hold, approve, skip, sendNow, resendLast, status, rowByToken, pub };
