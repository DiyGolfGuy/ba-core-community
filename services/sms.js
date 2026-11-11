// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/sms.js  —  SMS with provider abstraction
//
//  Supports Twilio and MessageBird (Bird). One active at a time with
//  automatic fallback to the other if the primary fails.
//  Switch providers in Admin → Settings → SMS Provider.
// ═══════════════════════════════════════════════════════════════════════════════

const { getConfig } = require('./config');
const { adminLog }  = require('./db');

// ── TWILIO ─────────────────────────────────────────────────────────────────────
async function sendViaTwilio(to, body) {
  const cfg = getConfig();
  const { accountSid, authToken, phoneNumber } = cfg.twilio || {};
  if (!accountSid || !authToken || !phoneNumber || String(accountSid).startsWith('PASTE')) {
    return { success: false, error: 'Twilio not configured' };
  }
  try {
    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);
    const msg = await client.messages.create({ body, from: phoneNumber, to });
    return { success: true, sid: msg.sid, provider: 'twilio' };
  } catch (err) {
    return { success: false, error: err.message, code: err && (err.code || err.status), provider: 'twilio' };
  }
}

// ── MESSAGEBIRD (BIRD) ─────────────────────────────────────────────────────────
async function sendViaBird(to, body) {
  const cfg = getConfig();
  const { apiKey, workspaceId, channelId } = cfg.messagebird || {};
  if (!apiKey || apiKey === '' || apiKey.startsWith('PASTE')) {
    return { success: false, error: 'Bird not configured' };
  }
  if (!workspaceId || !channelId) {
    return { success: false, error: 'Bird workspace/channel IDs not set' };
  }
  try {
    const res = await fetch(`https://api.bird.com/workspaces/${workspaceId}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `AccessKey ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        receiver: { contacts: [{ identifierValue: to }] },
        body: { type: 'text', text: { text: body } }
      })
    });
    if (res.ok) {
      return { success: true, provider: 'messagebird' };
    }
    const data = await res.json();
    return { success: false, error: data.message || 'Bird API error', provider: 'messagebird' };
  } catch (err) {
    return { success: false, error: err.message, provider: 'messagebird' };
  }
}

function providerStatus(cfg) {
  const twilio = cfg.twilio || {};
  const bird = cfg.messagebird || {};
  return {
    twilioReady: !!(twilio.accountSid && twilio.authToken && twilio.phoneNumber && !String(twilio.accountSid).startsWith('PASTE')),
    birdReady: !!(bird.apiKey && !String(bird.apiKey).startsWith('PASTE') && bird.workspaceId && bird.channelId)
  };
}

function bookingSmsAvailable(cfg) {
  const { twilioReady, birdReady } = providerStatus(cfg);
  return !cfg.booking?.membersOnly && (twilioReady || birdReady);
}

function optedIn(booking) { return booking.sms_consent === true || booking.sms_consent === 1; }

// ── MAIN sendSMS — with fallback ───────────────────────────────────────────────
async function sendSMS(to, body) {
  // STOP means stop (Sep 6 2026): a number that texted STOP is never texted
  // again by this unit - any provider, any template, any dry run - until it
  // texts START. Checked before everything else so the bench proves it too.
  try {
    // A-wave 12b: undefined, not false. A person who texted STOP is not a failed
    // send - it is a channel that does not apply to them. Returning false made every
    // reminder and door-code job for that customer fail for ever once the scheduler
    // started reading the answer (and on a unit with no email there is no other
    // channel to succeed on).
    if (require('./db').isSmsOptedOut(to)) { adminLog('SMS_SUPPRESSED', `To: ${to} | texted STOP - not sent`); return undefined; }
  } catch { return false; } // An unavailable consent record must never permit a send.
  const cfg = getConfig();
  body = finalize(body, brandFor(cfg));
  if (process.env.SMS_DRYRUN === '1') {
    // THE DRY RUN REFUSES WHAT A PROVIDER REFUSES (Oct 3 2026, rule 29's stand-in clause): it answered "sent" for an empty
    // or unusable number, where Twilio answers 21211 ("The 'To' number is not a valid phone number") - so on the bench a
    // door code "reached" a customer with no number, and no battery could see a door text fail.
    // ...and records it as the real sender does (the review): SMS_FAILED, the event the health line's Texts and emails
    // signal reads - logged as SMS_DRYRUN it was invisible there, and read as "texted" by a check looking for the number
    if (!/^\+\d{11,15}$/.test(require('./phone').normalize(to))) {
      adminLog('SMS_FAILED', `To: ${to || '(none)'} — dry run: not a number a provider can text (Twilio 21211)`);
      return false;
    }
    console.log(`[DRYRUN SMS to ${to}]\n${body}`);
    adminLog('SMS_DRYRUN', `To: ${to} | ${String(body).slice(0, 60).replace(/\s+/g, ' ')}`);
    return { success: true, dryrun: true };
  }
  // A-wave 12: a facility that does not TEXT is not a facility whose texts are
  // failing. With no provider configured both senders answered "not configured",
  // this logged SMS_FAILED for every reminder and door code, and the caller could
  // not tell that from a real refusal. Undefined means "this unit does not do that"
  // - the same distinction the door lock got (doorlock.lockConfigured).
  const { twilioReady, birdReady } = providerStatus(cfg);
  if (!twilioReady && !birdReady) return undefined;
  const primary  = cfg.smsProvider?.primary || 'twilio';
  const fallback = primary === 'twilio' ? 'messagebird' : 'twilio';

  const send = async (provider) => {
    return provider === 'twilio' ? sendViaTwilio(to, body) : sendViaBird(to, body);
  };

  // Try primary
  const result = await send(primary);
  if (result.success) {
    adminLog('SMS_SENT', `To: ${to} | Provider: ${result.provider}`);
    return true;
  }

  // A-wave 12, and it crosses rule W36 (STOP MEANS STOP): Twilio answers 21610 when
  // the recipient has opted out AT THE CARRIER - something this unit's own table may
  // never have seen, because the STOP may have been sent before the unit existed or
  // to a number the facility re-used. Falling through to the second provider texts a
  // person who has said stop. It is recorded here so this unit never tries again
  // either, by any provider or any template.
  if (recordCarrierOptOut(to, result)) return false;

  // Try fallback
  const fallbackResult = await send(fallback);
  if (fallbackResult.success) {
    adminLog('SMS_SENT', `To: ${to} | Provider: ${fallbackResult.provider} (fallback)`);
    return true;
  }

  if (recordCarrierOptOut(to, fallbackResult)) return false;
  adminLog('SMS_FAILED', `To: ${to} — Primary: ${result.error} | Fallback: ${fallbackResult.error}`);
  return false;
}

function recordCarrierOptOut(to, result) {
  if (String(result.code) !== '21610' && !/\b21610\b|opted out|unsubscrib/i.test(String(result.error || ''))) return false;
  try { require('./db').smsOptOut(to, 'STOP', 'carrier'); } catch {}
  adminLog('SMS_SUPPRESSED', `To: ${to} | carrier opt-out`);
  return true;
}

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
}

// Standard opt-out footer required for A2P 10DLC compliance
const OPT_OUT = '\n\nReply STOP to opt out. Msg & data rates may apply.';
// All outbound SMS goes through this footer and the global STOP check.
function brandFor(cfg) {
  return String(cfg.server?.businessName || '').replace(/\s+/g, ' ').trim() || 'Our Facility';
}
function finalize(body, businessName) {
  let out = String(body).trimEnd();
  if (out.endsWith(OPT_OUT)) out = out.slice(0, -OPT_OUT.length);
  if (businessName && !out.toLowerCase().includes(String(businessName).toLowerCase())) out += `\n\n- ${businessName}`;
  return out + OPT_OUT;
}

/* ── DEFAULT MESSAGE BODIES ────────────────────────────────────────────────
   Kept as builders so their SIZE can be asserted. A text over 160 GSM-7
   characters bills as two, and one non-GSM character (an em dash, a curly
   quote) silently switches the whole message to UCS-2 where a segment is 70.
   The STOP footer added by finalize() is Twilio compliance and never removed. */
/** Short date for SMS only - every character is billable. */
function fmtDateShort(d) {
  try {
    const dt = new Date(String(d) + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
             .replace(',', '');
  } catch { return fmtDate(d); }
}

const defaultBodies = {
  confirmation(cfg, booking) {
    const door = require('./doorlock');
    const arrival = cfg.booking?.staffedAccess ? ' Staff will set you up.'
      : door.codeTimingForPage(cfg) ? ` Code texted ${door.codeTimingPhrase(booking, cfg)}.` : '';
    return `${brandFor(cfg)}: Booked! ${booking.bay_name || 'Your Bay'}, ` +
      `${fmtDateShort(booking.date)} ${fmt12(booking.start_time)}.${arrival} Details emailed.`;
  },
  reminder(cfg, booking, mins) {
    const door = require('./doorlock');
    const arrival = door.codeTimingForPage(cfg) ? `Door code comes ${door.codeTimingPhrase(booking, cfg)}.` : 'See you soon!';
    return `${brandFor(cfg)}: Session starts in ${mins} min. ` +
      `${booking.bay_name || 'Your Bay'} at ${fmt12(booking.start_time)}. ${arrival}`;
  },
  // `kind` (a UniFi door, Sep 25 2026): the keypad needs Enter, and a member is told what their code
  // is - folded into the one message, never tacked on (the build review: the note appended after the
  // default made every UniFi door text two segments and said the keypad twice). `opts.fallback`: the
  // standing backup, texted BESIDE the real code, never instead of it (feature/door-interface).
  doorCode(cfg, booking, code, kind, opts = {}) {
    if (kind && typeof kind === 'object') { opts = kind; kind = ''; }   // (cfg, booking, code, { fallback })
    const where = `${booking.bay_name || 'Your Bay'} ${fmt12(booking.start_time)}`;
    const fb = opts && opts.fallback ? ` If it does not open, use ${opts.fallback}.` : ``;
    const key = (opts && opts.key) || 'Enter';
    if (kind === 'member') return `${brandFor(cfg)}: Door code ${code} (your member PIN). ${where}. Type it, then press ${key}.` + fb;
    if (kind === 'oneoff') return `${brandFor(cfg)}: ONE-TIME door code ${code}, today only - your member PIN will not open the door for this booking. ${where}. Type it, then press ${key}.` + fb;
    if (kind === 'visitor') return `${brandFor(cfg)}: Door code ${code}. ${where}, today only. Type it, then press ${key}.` + fb;
    return `${brandFor(cfg)}: Door code ${code}. ` +
      `${where}, today only. ` +
      `Enter on the keypad.` + fb;
  },
  cancellation(cfg, booking) {
    return `${brandFor(cfg)}: Your ${fmtDateShort(booking.date)} ` +
      `${fmt12(booking.start_time)} booking is cancelled. Refund if applicable.`;
  },
  endingWarning(cfg, booking) {
    return `${brandFor(cfg)}: Session ends in 15 min. There is no booking after yours.`;
  },
  endingWarningNext(cfg, booking, nextTime) {
    return `${brandFor(cfg)}: Session ends in 15 min. Next group at ${nextTime}. ` +
      `Please wrap up on time. Thanks!`;
  },
  // ONE SEGMENT (the review, Oct 3 2026): "The bay can't be booked right after you, so please wrap up on time" was two
  // segments at every facility, every night. Sent only when closing leaves no room for more time (bookingcore.moreTimeFits).
  endingWarningNoMore(cfg, booking) {
    return `${brandFor(cfg)}: Session ends in 15 min. We close soon - please wrap up on time. ` +
      `Thanks for playing!`;
  },
  endingWarningClose(cfg, booking) {
    return `${brandFor(cfg)}: Session ends in 15 min - closing time. Sim shuts ` +
      `down at close. Thanks for playing!`;
  }
};

async function sendConfirmation(booking) {
  const cfg = getConfig();
  if (!optedIn(booking) || cfg.sms?.sendConfirmation === false) return;
  return sendSMS(booking.phone, defaultBodies.confirmation(cfg, booking));
}

async function sendReminder(booking, reminderMins = 60) {
  const cfg = getConfig();
  if (!optedIn(booking) || cfg.sms?.sendReminder === false) return;
  return sendSMS(booking.phone, defaultBodies.reminder(cfg, booking, reminderMins));
}

// The door provider supplies only the keypad type and any confirmed backup code.
function doorCodeKind(note) {
  const n = String(note || '');
  if (!n) return '';
  if (/^Your door code is your member PIN/.test(n)) return 'member';
  if (/ONE-TIME/.test(n)) return 'oneoff';
  return 'visitor';
}
// the key the note names after the digits ("press Enter", "press the check mark") - in words
function doorCodeKey(note) { const m = /type the code and then press (.+?)\.\s*$/.exec(String(note || '')); return m ? m[1] : 'Enter'; }
async function sendDoorCode(booking, code, opts = {}) {
  if (typeof opts === 'string') opts = { note: opts };
  opts = opts || {};
  const note = opts.note || '';
  const cfg = getConfig();
  if (!optedIn(booking) || cfg.sms?.sendDoorCode === false) return;
  return sendSMS(booking.phone,
    defaultBodies.doorCode(cfg, booking, code, doorCodeKind(note), { ...opts, key: doorCodeKey(note) }));
}

async function sendCancellation(booking) {
  const cfg = getConfig();
  if (!optedIn(booking) || cfg.sms?.sendCancellation === false) return;
  return sendSMS(booking.phone, defaultBodies.cancellation(cfg, booking));
}

async function sendSessionEndingWarning(booking, hasNextBooking, nextStartTime = null, isCloseSession = false, noMoreTime = false) {
  const cfg = getConfig();
  if (!optedIn(booking) || cfg.sms?.sendEndingWarning === false) return;
  const body = isCloseSession ? defaultBodies.endingWarningClose(cfg, booking)
    : hasNextBooking && nextStartTime ? defaultBodies.endingWarningNext(cfg, booking, fmt12(nextStartTime))
    : noMoreTime ? defaultBodies.endingWarningNoMore(cfg, booking)
    : defaultBodies.endingWarning(cfg, booking);
  return sendSMS(booking.phone, body);
}

function verificationBody(cfg, pin) {
  return `${brandFor(cfg)}: Your verification code is ${pin}. Valid for 10 minutes. Do not share this code.`;
}

function sendVerificationCode(to, pin) {
  return sendSMS(to, verificationBody(getConfig(), pin));
}

function templateExamples(cfg) {
  const booking = {
    bay_name: 'Bay 1',
    date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    start_time: '10:00',
    duration_minutes: 60
  };
  return [
    ['Booking confirmation', defaultBodies.confirmation(cfg, booking)],
    ['Booking reminder', defaultBodies.reminder(cfg, booking, cfg.sms?.reminderMinsBefore || 60)],
    ['Door code', defaultBodies.doorCode(cfg, booking, '123456')],
    ['Session ending', defaultBodies.endingWarning(cfg, booking)],
    ['Session ending with a next group', defaultBodies.endingWarningNext(cfg, booking, '11:00 AM')],
    ['Session ending near closing', defaultBodies.endingWarningNoMore(cfg, booking)],
    ['Closing time', defaultBodies.endingWarningClose(cfg, booking)],
    ['Booking cancellation', defaultBodies.cancellation(cfg, booking)],
    ['Requested verification code', verificationBody(cfg, '123456')]
  ].map(([label, body]) => ({ label, body: finalize(body, brandFor(cfg)) }));
}

module.exports = {
  bookingSmsAvailable, brandFor, defaultBodies, finalize, templateExamples, sendSMS, sendVerificationCode,
  sendConfirmation, sendReminder, sendDoorCode, sendCancellation, sendSessionEndingWarning
};
