// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/printing.js — CloudPRNT job queue + ticket/receipt builders.
// Printers are registered in cfg.printers[] = { id, name, role, token }.
// role: 'kitchen' | 'bar' | 'counter'. The per-printer token in the polling
// URL is the printer's authentication.
const { getConfig } = require('./config');
const dbModule = require('./db');

function printersByRole(role) {
  return (getConfig().printers || []).filter(p => p.role === role);
}
function printerByToken(token) {
  return (getConfig().printers || []).find(p => p.token === token) || null;
}

function enqueue(printerId, body, opts = {}) {
  try {
    dbModule.db.prepare(`INSERT INTO print_jobs (printer_id, body, drawer) VALUES (?,?,?)`)
      .run(printerId, body, opts.drawer ? 1 : 0);
    // sql.js: the wrapper exports (closes + reopens) on every run(), so
    // last_insert_rowid() reads 0 here - it silently did until Sep 1 2026.
    const r = dbModule.db.prepare('SELECT MAX(id) AS id FROM print_jobs').get();
    return r && r.id != null ? Number(r.id) : null;
  } catch (e) { console.error('print enqueue:', e.message); return null; }
}

/** Queue a job to every printer holding a role. Returns job ids. */
function enqueueToRole(role, body, opts = {}) {
  const ids = [];
  for (const p of printersByRole(role)) {
    const id = enqueue(p.id, body, opts);
    if (id != null) ids.push(id);
  }
  return ids;
}

const line = (w = 42, ch = '-') => ch.repeat(w);
const money = (c) => '$' + ((c || 0) / 100).toFixed(2);

/** Payment-finalized receipt — fires for ANY finalized payment (maintainer, Aug 8). */
function buildBookingReceipt(b, opts = {}) {
  const cfg = getConfig();
  const rows = [];
  rows.push(centered(cfg.server?.businessName || 'Receipt'));
  rows.push(centered(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })));
  rows.push(line());
  rows.push(`BAY BOOKING`);
  rows.push(`${b.bay_name}  ${b.date}  ${b.start_time}-${b.end_time}`);
  rows.push(`${b.name}`);
  rows.push(line());
  if (b.is_deposit) {
    rows.push(pad('Deposit paid', money(b.price_cents)));
    rows.push('Balance settled at the door by');
    rows.push('final group size.');
  } else {
    rows.push(pad('Total paid', money(b.price_cents)));
  }
  if (opts.creditApplied) rows.push(pad('Member credit used', '-' + money(opts.creditApplied)));
  rows.push(line());
  rows.push(centered('Thank you!'));
  rows.push('');
  return rows.join('\n') + '\n';
}

function centered(s, w = 42) {
  s = String(s); if (s.length >= w) return s;
  const l = Math.floor((w - s.length) / 2); return ' '.repeat(l) + s;
}
function pad(k, v, w = 42) {
  const space = Math.max(1, w - k.length - String(v).length);
  return k + ' '.repeat(space) + v;
}

function enqueueBookingReceipt(booking, opts) {
  try {
    if (!printersByRole('counter').length) return;
    enqueueToRole('counter', buildBookingReceipt(booking, opts));
  } catch (e) { console.error('receipt enqueue:', e.message); }
}


/**
 * THE GUEST CHECK - what a person asks for at the table so they can see what
 * they owe before handing over a card. Itemised, taxed, with the amount due
 * at the bottom. Marked NOT A RECEIPT until it is actually paid, so a guest
 * check and a paid receipt can never be confused.
 */
function buildTabReceipt(tab, opts = {}) {
  const cfg = getConfig();
  const t = require('./pos').computeTotals(tab);
  const rows = [];
  rows.push(centered(cfg.server?.businessName || 'Check'));
  rows.push(centered(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })));
  rows.push(line());
  rows.push(opts.paid ? 'RECEIPT' : 'GUEST CHECK');
  rows.push(String(tab.label || '').slice(0, 42));
  if (tab.bay_name) rows.push(String(tab.bay_name).slice(0, 42));
  if (opts.employee) rows.push(`Served by ${String(opts.employee).slice(0, 24)}`);
  rows.push(line());

  for (const i of (tab.items || [])) {
    if (i.status === 'voided') continue;
    const amt = require('./pos').lineCents(i);
    const qty = (i.qty && i.qty !== 1) ? `${i.qty}x ` : '';
    rows.push(pad(`${qty}${String(i.name).slice(0, 28)}`, i.comp ? 'COMP' : money(amt)));
    // choices and notes print underneath so the guest recognises their order
    try {
      const ch = JSON.parse(i.choices_json || '[]');
      for (const c of ch) rows.push('   ' + String(c.name || '').slice(0, 36));
    } catch {}
    if (i.note) rows.push('   "' + String(i.note).slice(0, 34) + '"');
  }

  rows.push(line());
  rows.push(pad('Subtotal', money(t.subtotal_cents)));
  for (const [cat, cents] of Object.entries(t.tax_by_category || {})) {
    if (cents) rows.push(pad(`Tax - ${cat}`, money(cents)));
  }
  rows.push(pad('TOTAL', money(t.total_cents)));
  if (t.paid_cents) rows.push(pad('Paid', '-' + money(t.paid_cents)));
  if (t.tip_cents) rows.push(pad('Tip', money(t.tip_cents)));
  rows.push(pad(t.due_cents > 0 ? 'DUE' : 'PAID IN FULL',
                t.due_cents > 0 ? money(t.due_cents) : ''));
  rows.push(line());
  rows.push(centered(opts.paid ? 'Thank you!' : 'Not a receipt - please pay your server'));
  rows.push('');
  return rows.join('\n') + '\n';
}

/** Print one person's check at the counter printer. */
function enqueueTabReceipt(tab, opts = {}) {
  if (!printersByRole('counter').length) {
    return { printed: false, reason: 'No counter printer is set up.' };
  }
  const ids = enqueueToRole('counter', buildTabReceipt(tab, opts));
  return { printed: true, jobs: ids.length };
}

module.exports = { printersByRole, printerByToken, enqueue, enqueueToRole, enqueueBookingReceipt, buildBookingReceipt, buildTabReceipt, enqueueTabReceipt };
