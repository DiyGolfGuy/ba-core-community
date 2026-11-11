// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/owneralert.js  —  TELLING THE OWNER, NOT ONLY THE HEALTH LINE
//
//  maintainer, Sep 25 2026: the UniFi console presenting a certificate this unit does not trust
//  TEXTS the owner, and a member whose door access could not be turned on is never
//  silent - "log it, show it on health, tell the owner". The health line waits for
//  someone to open the About panel; these are the failures where a customer may be
//  standing at a door, so they go to the owner's phone.
//
//  Where it goes: the owner's own mobile (cfg.alerts.ownerMobile - asked on Settings > Connections > Twilio - SMS
//  card, never shown to customers; the facility's contact phone is a PUBLIC number and
//  may be a landline or the front desk) and the owner's email (cfg.contact.email - the
//  address the hours export and the records already treat as the owner's). A unit with
//  neither sends nothing and says so in the owner's log (rule 31: absent is not failed).
//  One alert per key every six hours, so a console that stays wrong is not a text a
//  minute. Never throws: an alert that could not be sent is logged, and the health line
//  still carries the fault.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const { getConfig } = require('./config');

const EVERY_HOURS = 6;

function lastSent(key) {
  try {
    const row = require('./db').db.prepare(
      `SELECT created_at FROM admin_log WHERE event='OWNER_ALERT' AND detail LIKE ? ORDER BY id DESC LIMIT 1`).get(key + ' |%');
    return row ? Date.parse(String(row.created_at).replace(' ', 'T') + 'Z') : 0;
  } catch { return 0; }
}

/** Tell the owner. `key` groups repeats of the same fault; `text` is what they read. */
async function alert(key, text, opts = {}) {
  const everyMs = (opts.everyHours || EVERY_HOURS) * 3600000;
  const last = lastSent(key);
  if (last && Date.now() - last < everyMs) return { skipped: 'sent within the last ' + (opts.everyHours || EVERY_HOURS) + ' h' };
  const cfg = getConfig();
  const biz = (cfg.server && cfg.server.businessName) || 'Your booking system';
  // as the owner typed it on the Twilio - SMS card - "(202) 555-0147" is sent as +12025550147 (the build review)
  const mobile = require('./phone').normalize(String((cfg.alerts && cfg.alerts.ownerMobile) || '').trim());
  const email = String((cfg.contact && cfg.contact.email) || '').trim();
  let textOut = 'no owner mobile set', mailOut = 'no owner email set';
  if (mobile) {
    try {
      const r = await require('./sms').sendSMS(mobile, `${biz}: ${text}`);
      textOut = r === undefined ? 'texting not available' : (r === false || (r && r.success === false)) ? 'FAILED' : 'sent';
    } catch (e) { textOut = 'FAILED (' + String(e.message).slice(0, 60) + ')'; }
  }
  if (email) {
    try {
      const r = await require('./email').sendEmail({ to: email, subject: `${biz} - needs your attention`, text: text + '\n\nThis is an automatic alert from your booking system. The About button at the top of Admin shows the unit\'s health.' });
      mailOut = r === undefined ? 'email not available' : r === true ? 'sent' : 'FAILED';
    } catch (e) { mailOut = 'FAILED (' + String(e.message).slice(0, 60) + ')'; }
  }
  try { require('./db').adminLog('OWNER_ALERT', `${key} | text: ${textOut} | email: ${mailOut} | ${String(text).slice(0, 200)}`); } catch {}
  return { text: textOut, email: mailOut };
}

module.exports = { alert, EVERY_HOURS };
