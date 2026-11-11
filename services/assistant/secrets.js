// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/secrets.js - KEYS SAID IN THE CHAT (Oct 19 2026)
//
// maintainer: "they could put their keys right in there. And it would ... put the stripe key where it belongs. And then you know
// delete it." A key is caught by its SHAPE before the message reaches the model. The owner's page catches it first
// (public/assistant.js reads these same patterns from /api/admin/assistant/status) and saves it through the owner's own
// settings route - POST /api/admin/config, with the same validation and the same step-up as the Settings screen. The
// model hears only what was saved and the last four characters. This file catches it again on the server, so a key that
// gets past the page is still never sent to a model, written to a log or kept in a conversation.
//
// The shapes are each provider's own documented key formats. Twilio's auth token has no shape of its own (32 hex
// characters): it is taken only beside the account SID it belongs with. A key whose kind the product does not keep
// (a Stripe restricted key) is still caught and routed to its nearest field, where the settings route refuses it in
// plain words - the owner hears why, and the key never reaches the model.
'use strict';

const KINDS = [
  { kind: 'stripe-secret',      source: '\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\\b', path: 'stripe.secretKey',      say: 'Stripe secret key' },
  { kind: 'stripe-publishable', source: '\\bpk_(?:live|test)_[A-Za-z0-9]{16,}\\b',          path: 'stripe.publishableKey', say: 'Stripe publishable key' },
  { kind: 'stripe-webhook',     source: '\\bwhsec_[A-Za-z0-9]{16,}\\b',                     path: 'stripe.webhookSecret',  say: 'Stripe webhook signing secret' },
  { kind: 'resend',             source: '\\bre_[A-Za-z0-9_]{16,}\\b',                       path: 'resend.apiKey',         say: 'Resend key' },
  { kind: 'twilio-sid',         source: '\\bAC[0-9a-fA-F]{32}\\b',                          path: 'twilio.accountSid',     say: 'Twilio account SID' },
  { kind: 'home-assistant',     source: '\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}', path: 'homeAssistant.token', say: 'Home Assistant token' },
  { kind: 'ai-key',             source: '\\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}',          path: '',                      say: 'AI service key' },   // caught and scrubbed, never saved from the chat: Hosted AI settings is its only door
];
// Twilio's auth token: 32 hex, only in a message that also carries the account SID
const TWILIO_TOKEN = { kind: 'twilio-token', source: '\\b[0-9a-fA-F]{32}\\b', path: 'twilio.authToken', say: 'Twilio auth token' };

const last4 = v => String(v).slice(-4);

/** Every key in a text: [{ kind, path, say, value, start, end, last4 }], in order, never overlapping. */
function find(text) {
  const s = String(text || '');
  const out = [];
  const taken = (a, b) => out.some(f => a < f.end && b > f.start);
  for (const k of KINDS) {
    const re = new RegExp(k.source, 'g'); let m;
    while ((m = re.exec(s))) { const a = m.index, b = a + m[0].length; if (!taken(a, b)) out.push({ kind: k.kind, path: k.path, say: k.say, value: m[0], start: a, end: b, last4: last4(m[0]) }); }
  }
  // (or pasted alone - the walk asks for the Auth Token on its own after the SID: a message that is nothing but 32 hex went to the
  // model as words until Oct 22 2026, the 4B walk-through)
  if (out.some(f => f.kind === 'twilio-sid') || /^\s*[0-9a-fA-F]{32}\s*$/.test(s)) {
    const re = new RegExp(TWILIO_TOKEN.source, 'g'); let m;
    while ((m = re.exec(s))) { const a = m.index, b = a + m[0].length; if (!taken(a, b)) out.push({ kind: TWILIO_TOKEN.kind, path: TWILIO_TOKEN.path, say: TWILIO_TOKEN.say, value: m[0], start: a, end: b, last4: last4(m[0]) }); }
  }
  return out.sort((x, y) => x.start - y.start);
}

/** The text with every key replaced by what it was: "[Stripe secret key - ends in 4f2a]". { text, found }. */
function scrub(text) {
  const s = String(text || ''); const found = find(s);
  let out = '', at = 0;
  for (const f of found) { out += s.slice(at, f.start) + `[${f.say} - ends in ${f.last4}]`; at = f.end; }
  out += s.slice(at);
  return { text: out, found };
}

/** Anything still key-shaped after the page's own scrub - the server's last line (true when a key got this far). */
function hasKey(text) { return find(text).length > 0; }

/** The patterns, for the owner's page (no values, nothing secret). */
function patternsForClient() {
  return { kinds: KINDS.map(k => ({ kind: k.kind, source: k.source, path: k.path, say: k.say })), twilioToken: { kind: TWILIO_TOKEN.kind, source: TWILIO_TOKEN.source, path: TWILIO_TOKEN.path, say: TWILIO_TOKEN.say } };
}

module.exports = { find, scrub, hasKey, patternsForClient, KINDS };
