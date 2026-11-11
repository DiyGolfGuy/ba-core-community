// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/webhooks.js — outbound event dispatch per settled spec (Aug 2026).
// cfg.webhooks = { url, secret, events: {name:bool}, includeContact: bool }
// Booking events (Oct 19 2026 - an owner's calendar built from them kept every booking a customer cancelled
// themselves, and every moved or extended one at its old time): booking.created when a booking is made (online, by
// staff, a member); booking.cancelled whoever cancels it (the owner in Admin, staff on the pad, the customer from My
// Booking - "by" says which); booking.changed when it is moved (another day, time or bay) or given more time.
// HMAC-SHA256 signature header; fire-and-forget; 2 retries; never throws,
// never blocks the caller.
const crypto = require('crypto');
const { getConfig } = require('./config');

// TWO SETS, because they answer to different people (Sep 16 2026, the coverage
// wave - this service had no behavioural battery and nobody had asked).
// CONTACT is the owner's choice: a booking webhook that cannot say who booked is
// not much of a webhook, so it goes unless they switch it off (includeContact).
// CREDENTIALS are nobody's choice. A door code has no business at a third-party
// URL an owner typed into a box, and it is stripped whatever the switch says.
// No dispatch site passes a whole booking row today - every one names its fields -
// so nothing leaks now; this is the second line for the day someone does.
const CONTACT_KEYS = new Set(['name', 'phone', 'email', 'to_email', 'customer', 'signature_name']);
const CREDENTIAL_KEYS = new Set(['door_code', 'pin', 'access_pin', 'code', 'remotelock_person_id']);
const PII_KEYS = CONTACT_KEYS;   // kept: the old name is what stripPii's callers know

function stripKeys(obj, keys) {
  if (Array.isArray(obj)) return obj.map(x => stripKeys(x, keys));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (keys.has(k)) continue;
      out[k] = stripKeys(v, keys);
    }
    return out;
  }
  return obj;
}
/** Contact details out - the owner's switch decides whether this is called. */
function stripPii(obj) { return stripKeys(obj, CONTACT_KEYS); }
/** Door credentials out - ALWAYS, no switch. */
function stripCredentials(obj) { return stripKeys(obj, CREDENTIAL_KEYS); }

function dispatch(event, data) {
  try {
    const w = getConfig().webhooks;
    if (!w?.url || !/^https?:\/\//.test(w.url)) return;
    if (w.events && w.events[event] === false) return;
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      facility: getConfig().server?.businessName || '',
      // credentials always; contact only if the owner asked for it to go
      data: stripCredentials(w.includeContact === true ? data : stripPii(data))
    };
    const body = JSON.stringify(payload);
    const sig = w.secret ? crypto.createHmac('sha256', w.secret).update(body).digest('hex') : '';
    attempt(w.url, body, sig, 0);
  } catch (e) { console.error('webhook dispatch:', e.message); }
}

function attempt(url, body, sig, tryNo) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig },
    body, signal: ctl.signal
  }).then(r => {
    clearTimeout(t);
    if (!r.ok && tryNo < 2) setTimeout(() => attempt(url, body, sig, tryNo + 1), (tryNo + 1) * 30000);
    recordLast(r.status);
  }).catch(() => {
    clearTimeout(t);
    if (tryNo < 2) setTimeout(() => attempt(url, body, sig, tryNo + 1), (tryNo + 1) * 30000);
    recordLast(0);
  });
}

let _last = null;
function recordLast(status) { _last = { status, at: new Date().toISOString() }; }
function lastDelivery() { return _last; }

/** The fields every booking event carries, from a booking row (Oct 19 2026): the names booking.created already uses,
 *  plus end_date for a session past midnight. Contact details ride only when the owner leaves them on (dispatch). */
function bookingFields(b) {
  return { id: b.id, bay: b.bay_name, date: b.date, start_time: b.start_time, end_time: b.end_time, end_date: b.end_date || null,
    duration_minutes: b.duration_minutes, price_cents: b.price_cents, name: b.name, phone: b.phone, email: b.email || '' };
}

module.exports = { dispatch, lastDelivery, stripPii, stripCredentials, bookingFields };
