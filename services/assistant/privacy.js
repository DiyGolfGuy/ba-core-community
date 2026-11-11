// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/privacy.js - WHAT THE AI MAY READ OF A CUSTOMER (Oct 21 2026, latest; branch
// feature/ai-edition)
//
// maintainer: "the chat is local its local comptuer so i feel like the admin should be able to ask the chat anything and everything.
// like who is playing and what not. so lets get this as locked in as possible."
//   - The box's own AI, on the box itself (a local address): nothing it reads leaves the building, so the owner asks about
//     any customer and gets their whole name, phone number and email - "who is playing", "what's Sam's number".
//   - The owner's own ChatGPT, Claude or other service: what the AI reads goes to that company, so a customer stays a first
//     name and a last initial, never a phone number or an email (the rule every area kept until now).
// Never to any AI, either way: door codes, member PINs, gift card codes, staff sign-in codes, keys and passwords - those are
// security, not privacy, and each area keeps them out as before.
'use strict';

/** True when the box's own AI answers, on the box itself: the owner may read everything about a customer. */
function full() {
  try {
    const m = require('./model'), s = m.settings();
    return s.provider === 'box' && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(String(s.endpoint || ''));
  } catch { return false; }
}

/** A customer's name as the AI may read it: whole on the box's own AI; else the first name and the last initial, with any
 *  word that holds an @ or a run of digits (an email or a phone typed into the name box) left out. */
function name(raw, fallback) {
  const n = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (full()) return n ? n.slice(0, 60) : (fallback || 'a customer');
  const words = n.split(' ').filter(w => w && !/@/.test(w) && !/\d{3,}/.test(w))
    .map(w => w.replace(/[^A-Za-zÀ-ɏ'-]/g, '')).filter(w => /[A-Za-zÀ-ɏ]/.test(w));
  if (!words.length) return fallback || 'a customer';
  return words.length > 1 ? `${words[0].slice(0, 24)} ${words[words.length - 1][0].toUpperCase()}.` : words[0].slice(0, 24);
}

/** A customer's phone and email for the AI - only on the box's own AI, and only what is there. */
function contact(row) {
  if (!full() || !row) return {};
  const o = {};
  if (row.phone) o.phone = String(row.phone).slice(0, 30);
  if (row.email) o.email = String(row.email).slice(0, 120);
  return o;
}

module.exports = { full, name, contact };
