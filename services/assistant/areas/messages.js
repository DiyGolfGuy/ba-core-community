// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/messages.js - the assistant's messages actions (Oct 20 2026).
// Built with the helpers services/assistant/actions.js hands every area (HELPERS); same rules as the actions there.
//
// maintainer, Oct 20 2026: "send emails ... examples is the webhooks, out side emails. marketing emails". What customers are sent,
// in whose words, by which channel, and what leaves the unit - each action the owner's own screen's save, to its own route:
//   - THE WORDS of each message customers get (Settings > Messaging): texts in cfg.sms.<name>Msg (services/sms.js ownMsg),
//     emails in cfg.emailMsgs.<name> (services/email.js emailTmpl). A box still showing the product's default is saved
//     EMPTY (public/admin.html ownBoxText) and a stored copy of a default counts as empty (services/msgdefaults.js), so
//     "back to the product's own words" is '' here too. The STOP line is locked: sms.js finalize() adds it only to a text
//     that does not already say "reply stop", so words that say it would stand in for it - they are refused;
//   - WHICH MESSAGES GO: the text switches cfg.sms.send* and the email switches cfg.resend.send*; each stops its own message
//     and nothing else (scheduler.js notif). The reminder's timing is one setting for both (cfg.sms.reminderMinsBefore);
//   - the owner's own URGENT ALERTS (cfg.alerts.ownerMobile, services/owneralert.js) and the name TEXTS ARE SIGNED WITH
//     (cfg.sms.shortBrand, sms.js brandFor);
//   - NEWSLETTERS (stop one going out; how many are signed up - a count, never an address), the website INBOX (first name
//     and last initial, never an email or phone), the OUTBOUND WEBHOOK (the address, the events, whether contact details
//     go; its signing secret is a secret and is never read or written here) and who TEXTED STOP (a count, or yes/no for one
//     number - a STOP is never undone here; only the person can, by texting START).
// Nothing here sends a message by itself: no route emails or texts one customer, or every member.
'use strict';

module.exports = (H) => {
  const { ActionError, addDays } = H;

  // ── small readers ──────────────────────────────────────────────────────────
  const getPath = (o, d) => String(d).split('.').reduce((x, k) => (x && typeof x === 'object') ? x[k] : undefined, o);
  const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n - 3).replace(/\s+\S*$/, '') + '...' : t; };
  const firstWords = (s, n) => clip(String(s == null ? '' : s).replace(/\s+/g, ' ').trim(), n);
  const tz = () => { try { return require('../../config').getConfig().server.timezone || 'America/Chicago'; } catch { return 'America/Chicago'; } };
  // a stored time (SQLite datetime('now') is UTC, "YYYY-MM-DD HH:MM:SS") in the facility's own time - never the UTC date,
  // which is tomorrow every evening
  function localWhen(v) {
    const s = String(v || '');
    const ms = Date.parse(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
    if (!Number.isFinite(ms)) return s;
    try { return new Date(ms).toLocaleString('en-US', { timeZone: tz(), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  }
  const minsWords = (n) => { if (n < 60) return `${n} minutes`; const h = Math.floor(n / 60), m = n % 60; return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minutes` : ''}`; };

  // ── is a channel set up here (the product's own tests, read from the settings the owner's screen reads - a saved key
  //    comes back masked, which still says it is there) ──
  // texting: services/sms.js sendSMS's twilioReady / birdReady (a unit without either answers undefined - absent, rule 31)
  const textReady = (cfg) => { const tw = (cfg && cfg.twilio) || {}, bd = (cfg && cfg.messagebird) || {};
    return !!((tw.accountSid && tw.authToken && !String(tw.accountSid).startsWith('PASTE')) || (bd.apiKey && !String(bd.apiKey).startsWith('PASTE') && bd.workspaceId && bd.channelId)); };
  // email: routes/admin.js setup-status 'resend' (the key and the From address; email.js sends nothing without both)
  const emailReady = (cfg) => !!(cfg && cfg.resend && cfg.resend.apiKey && String(cfg.resend.fromEmail || '').trim());
  const known = (cfg) => !!(cfg && cfg.sms && cfg.resend);   // the settings were read (a loader that failed hands {})
  const staffedHere = (cfg) => !!(cfg && cfg.booking && cfg.booking.staffedAccess);
  // a switch as its sender reads it: a text goes unless its switch is exactly false (sms.js); an email goes only while its
  // switch is set (email.js `if (!cfg.resend?.sendX) return`) - except the booking-changed email, off only when false
  const isOn = (cfg, p) => p.startsWith('sms.') || p === 'resend.sendMoved' ? getPath(cfg, p) !== false : !!getPath(cfg, p);
  const spaceLabel = (cfg) => (cfg && cfg.booking && cfg.booking.wholeFacility) ? 'Facility' : 'Bay';   // bookingcore.spaceWords

  // ── THE MESSAGES, AS THE SENDERS HAVE THEM ─────────────────────────────────
  // What each fills in: the booking messages' own lists are read from the product's fill code itself (sms.js bookingMap,
  // email.js bookingEmailMap - exported "so a battery can render a template the way the senders do"), so a placeholder
  // the product starts filling is allowed here the same day. What a sender adds for its own message is written beside it,
  // from that sender's own call.
  let _base = null;
  function base() {
    if (_base) return _base;
    const SMS_FALLBACK = ['{business}', '[Business Name]', '{bay}', '[Bay Name]', '[Bay]', '{date}', '[Date]', '{time}', '[Start Time]', '[Start]', '{endtime}', '[End Time]', '[End]', '{duration}', '[Duration]', '{codetiming}', '[Code Timing]'];
    const EMAIL_FALLBACK = ['{business}', '[Business Name]', '{bay}', '[Bay]', '[Bay Name]', '{date}', '[Date]', '{time}', '[Start]', '[Start Time]', '{endtime}', '[End]', '[End Time]', '{duration}', '[Duration]', '{codetiming}', '[Code Timing]'];
    let sms = SMS_FALLBACK, email = EMAIL_FALLBACK;
    // staffedAccess makes codeTimingPhrase answer '' before it reads anything else - the keys are all that is wanted here
    try { sms = require('../../sms').bookingMap({ server: {}, sms: {}, booking: { staffedAccess: true } }, { date: '2000-01-01', start_time: '00:00', end_time: '00:00', duration_minutes: 60 }).flatMap(([k]) => k); } catch {}
    try { email = require('../../email').bookingEmailMap({}).flatMap(([k]) => k); } catch {}
    _base = { sms, email };
    return _base;
  }
  const MINS = ['{mins}', '[Mins]', '[Minutes]'];                                    // sms.js sendReminder, email.js sendReminderEmail
  const CODE = ['{code}', '[Code]', '[Door Code]'];                                  // sms.js sendDoorCode, email.js sendDoorCodeEmail
  const BACKUP = ['{backup}', '[Backup Code]'];                                      // the same two calls
  const NEXT = ['{next}', '[Next Time]', '[Next]'];                                  // sms.js sendSessionEndingWarning
  const NAME = ['{name}', '[Name]'], TIER = ['{tier}', '[Tier]'], BIZ = ['{business}', '[Business Name]'], DATEK = ['{date}', '[Date]'];
  const T = 'text', E = 'email';
  // field: the key under cfg.sms (texts) or cfg.emailMsgs (emails); sw: the switch that sends it (none: always, with email
  // set up); def: services/sms.js defaultBodies' builder for a text in the product's own words; added: what the sender adds
  // that no words can remove
  const MSG = {
    confirmation_text:       { ch: T, field: 'confirmationMsg', name: 'booking confirmation text', sw: 'sms.sendConfirmation', def: 'confirmation' },
    reminder_text:           { ch: T, field: 'reminderMsg', name: 'reminder text', sw: 'sms.sendReminder', def: 'reminder', extra: MINS },
    door_code_text:          { ch: T, field: 'doorCodeMsg', name: 'door code text', sw: 'sms.sendDoorCode', def: 'doorCode', extra: CODE.concat(BACKUP), must: CODE,
      added: 'when the door needs a key pressed after the code, or the code is a member\'s PIN, a short line saying so' },
    cancellation_text:       { ch: T, field: 'cancellationMsg', name: 'cancellation text', sw: 'sms.sendCancellation', def: 'cancellation' },
    ending_warning_text:     { ch: T, field: 'endingWarningMsg', name: '15-minute warning text (nobody booked after them)', sw: 'sms.sendEndingWarning', def: 'endingWarning',
      note: 'near closing, when no more time fits, the product sends its own short "we close soon" text instead' },
    next_group_warning_text: { ch: T, field: 'endingWarningBacktobbackMsg', name: '15-minute warning text (the next group is waiting)', sw: 'sms.sendEndingWarning', def: 'endingWarningNext', extra: NEXT },
    confirmation_email:      { ch: E, field: 'confirmationBody', name: 'booking confirmation email', sw: 'resend.sendConfirmation', booking: true,
      added: 'what was paid and anything due at the door (with any tax), an add-to-calendar link and a calendar file', note: 'the same words go, under a "your booking has been changed" line, when staff move a booking' },
    reminder_email:          { ch: E, field: 'reminderBody', name: 'reminder email', sw: 'resend.sendReminder', booking: true, extra: MINS },
    door_code_email:         { ch: E, field: 'doorCodeBody', name: 'door code email', sw: 'resend.sendDoorCode', booking: true, extra: CODE.concat(BACKUP), must: CODE,
      added: 'the keypad line when the door needs a key pressed after the code, and a backup code when the door uses one' },
    cancellation_email:      { ch: E, field: 'cancellationBody', name: 'cancellation email', sw: 'resend.sendCancellation', booking: true, added: 'a calendar file that takes the booking out of their calendar' },
    member_welcome_email:    { ch: E, field: 'memWelcomeIntro', name: 'member welcome email (its greeting)', fills: NAME.concat(TIER, BIZ),           // email.js sendMembershipWelcome
      added: 'their member PIN, the price and how it renews, and how to cancel' },
    member_payment_failed_email: { ch: E, field: 'memFailedIntro', name: 'membership payment failed email (its opening)', fills: NAME.concat(TIER, BIZ),   // sendMembershipPaymentFailed
      added: 'how long their benefits continue and the link to update their payment' },
    membership_ended_email:  { ch: E, field: 'memEndedBody', name: 'membership ended email', fills: NAME.concat(TIER, BIZ), added: 'the link to rejoin' },   // sendMembershipEnded
    membership_cancelled_email: { ch: E, field: 'memCancelIntro', name: 'membership cancellation confirmed email (its opening)', fills: NAME.concat(BIZ),    // sendCancellationConfirmed - no [Tier]
      added: 'the date their benefits end, that no further charges are made, and the link to rejoin' },
    waiver_renewal_email:    { ch: E, field: 'waiverRenewIntro', name: 'waiver renewal reminder email (its opening)', fills: NAME.concat(DATEK, BIZ),        // sendWaiverRenewalReminder
      added: 'the date it runs out, a line asking them to sign at their next booking or at the counter, and their member portal link' },
  };
  const MSG_NAMES = Object.keys(MSG);
  const MSG_SAY = 'which message: confirmation_text (sent when a booking is made), reminder_text, door_code_text, cancellation_text, ending_warning_text (15 minutes before the end, nobody booked after), next_group_warning_text (15 minutes before the end, the next group waiting); the emails: confirmation_email, reminder_email, door_code_email, cancellation_email, member_welcome_email, member_payment_failed_email, membership_ended_email, membership_cancelled_email, waiver_renewal_email';
  const sectionOf = (m) => m.ch === T ? 'sms' : 'email';                  // msgdefaults' names
  const pathOf = (m) => (m.ch === T ? 'sms.' : 'emailMsgs.') + m.field;   // where the owner's screen saves it
  const allowedFor = (m) => m.fills ? m.fills : (m.ch === T ? base().sms : base().email).concat(m.extra || []);
  const shown = (keys) => [...new Set(keys.filter(k => k.startsWith('[')))];
  const tokensIn = (s) => String(s || '').match(/\[[^\[\]\n]{1,40}\]|\{[A-Za-z][A-Za-z ]{0,30}\}/g) || [];
  const unfilled = (m, words) => [...new Set(tokensIn(words).filter(t => !allowedFor(m).some(k => k.toLowerCase() === t.toLowerCase())))];
  const ownWords = (cfg, m) => { try { return require('../../msgdefaults').own(sectionOf(m), m.field, getPath(cfg, pathOf(m))); } catch { return String(getPath(cfg, pathOf(m)) || ''); } };
  const tokenHint = (t, m, cfg) => {
    const k = t.toLowerCase();
    if (k === '[space]') return `write "${spaceLabel(cfg)}" in its place`;
    if ((k === '[name]' || k === '{name}') && !m.fills) return 'booking messages do not know the customer\'s name';
    return null;
  };
  // ONE TEXT, NOT TWO: what the Messaging page's meter counts (public/admin.html smsSeg) - a text over 160 plain characters
  // bills as more than one, and one curly quote or emoji makes it 70 a part
  const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_ÆæßÉ!"#%&'()*+,\-.\/:;<=>?¡ÄÖÑÜ§¿äöñüà\[\]{}~|\\^]*$/;
  const segments = (t) => { const gsm = GSM.test(t), n = t.length; return { n, gsm, seg: gsm ? Math.ceil(n / (n <= 160 ? 160 : 153)) : Math.ceil(n / (n <= 70 ? 70 : 67)) }; };
  // a model's typography (curly quotes, long dashes) would make every text cost more for nothing: plain marks in a text
  const plainMarks = (s) => String(s).replace(/[‘’‚‛′]/g, '\'').replace(/[“”„‟″]/g, '"').replace(/[‐-―−]/g, '-').replace(/…/g, '...').replace(/[    ]/g, ' ');
  // rule 15: the product never calls anything compliant, legally binding or enforceable, and cites no law
  const LEGAL = /\b(compliant|legally binding|enforceable|meets? the requirements?|statutes?|required by law)\b|§/i;

  // an example booking: tomorrow 6 to 7 PM on the first bay - what the read and the text count render the words with
  const sample = (cfg, ctx) => { const d = addDays((ctx && ctx.today) || new Date().toISOString().slice(0, 10), 1); return { id: 'example', bay_name: (((cfg && cfg.bays) || [])[0] || {}).name || 'Bay 1', date: d, end_date: d, start_time: '18:00', end_time: '19:00', duration_minutes: 60, price_cents: 0 }; };
  const extrasFor = (m, cfg, code) => {
    const x = {};
    if (m.extra === MINS) x['{mins}|[Mins]|[Minutes]'] = String((cfg.sms && cfg.sms.reminderMinsBefore) || 60);
    if (m.must) { x['{code}|[Code]|[Door Code]'] = code; x['{backup}|[Backup Code]'] = ''; }
    if (m.extra === NEXT) x['{next}|[Next Time]|[Next]'] = '7:00 PM';
    return x;
  };
  // a text as a customer gets it - through sms.js's own fill, its own default and its own finalize (the brand, the STOP line)
  function renderText(m, cfg, ctx, words, code) {
    const S = require('../../sms'); const b = sample(cfg, ctx);
    if (words) return S.finalize(S.fill(words, S.bookingMap(cfg, b, extrasFor(m, cfg, code))), S.brandFor(cfg));
    const mins = (cfg.sms && cfg.sms.reminderMinsBefore) || 60;
    const body = m.def === 'reminder' ? S.defaultBodies.reminder(cfg, b, mins) : m.def === 'doorCode' ? S.defaultBodies.doorCode(cfg, b, code)
      : m.def === 'endingWarningNext' ? S.defaultBodies.endingWarningNext(cfg, b, '7:00 PM') : S.defaultBodies[m.def](cfg, b);
    return S.finalize(body, S.brandFor(cfg));
  }
  // an email's editable part as a customer gets it - through email.js's own emailTmpl (the owner's words, or the default:
  // the staffed one on a staffed unit)
  function renderEmail(m, cfg, ctx) {
    const Em = require('../../email');
    if (m.booking) return Em.emailTmpl(m.field, Em.bookingEmailMap(Em.bookingVars(sample(cfg, ctx)), m.must ? { '{code}|[Code]|[Door Code]': '[Code]', '{backup}|[Backup Code]': '' } : m.extra === MINS ? { '{mins}|[Mins]|[Minutes]': String((cfg.sms && cfg.sms.reminderMinsBefore) || 60) } : {}));
    const biz = (cfg.server && cfg.server.businessName) || '';
    const map = [[NAME, 'Alex']].concat(m.fills.includes('[Tier]') ? [[TIER, 'Gold']] : [], m.fills.includes('[Date]') ? [[DATEK, sample(cfg, ctx).date]] : [], [[BIZ, biz]]);
    return Em.emailTmpl(m.field, map);
  }
  const sentNow = (m, cfg) => {
    if (!known(cfg)) return undefined;
    if (m.ch === T && !textReady(cfg)) return 'not sent - texting is not set up';
    if (m.ch === E && !emailReady(cfg)) return 'not sent - email is not set up';
    if (m.must && staffedHere(cfg)) return 'not sent - this facility is staffed, so no door codes go out';
    if (m.sw && !isOn(cfg, m.sw)) return 'off - switched off';
    return m.ch === T ? 'on - to customers who said yes to texts' : m.sw ? 'on' : 'always sent';
  };

  // ── the checks new words pass before they are proposed (build and describe both run them) ──
  function wordsPlan(a, ctx) {
    const m = MSG[a.message];
    const cfg = ctx.msgConfig || {};
    // TEXT WORDING IS FIXED IN BA CORE COMMUNITY: every text goes out in the product's own registered words (the consent,
    // opt-out and campaign wording a carrier approves), and a changed wording saved here would be dropped. Emails are the
    // owner's to word.
    if (m && m.ch === T) throw new ActionError('the words of a text message cannot be changed - texts go out in fixed wording so they match what the carrier registered. The emails\' words can be changed, and each text can be switched on or off');
    if (a.use_default === true) { if (a.words) throw new ActionError('say the new words, or use_default to put the product\'s own words back - not both'); return { m, value: '' }; }
    if (!a.words) throw new ActionError('say the new words (or use_default: true to put the product\'s own words back)');
    const words = m.ch === T ? plainMarks(a.words).trim() : String(a.words).replace(/\r\n/g, '\n').trim();
    if (m.ch === T && words.length > 1000) throw new ActionError('that is too long for a text - keep it to a line or two; the details belong in the email');
    if (m.must && !m.must.some(k => words.toLowerCase().includes(k.toLowerCase()))) throw new ActionError(`the ${m.name} must keep [Code] - that is where the customer's door code goes; without it they get a message with no code in it`);
    if (m.ch === T && /reply stop/i.test(words)) throw new ActionError('leave out the opt-out line: "Reply STOP to opt out. Msg & data rates may apply." is added to every text by itself and cannot be changed');
    if (LEGAL.test(words)) throw new ActionError('a customer message from here never says whether something is compliant, legally binding, enforceable or required by law, and cites no law - that is for the owner\'s own lawyer; say it another way');
    const bad = unfilled(m, words);
    if (bad.length) {
      const hints = bad.map(t => tokenHint(t, m, cfg)).filter(Boolean);
      throw new ActionError(`the ${m.name} cannot fill in ${bad.join(', ')} - customers would see ${bad.length === 1 ? 'it' : 'them'} exactly as written${hints.length ? ' (' + hints.join('; ') + ')' : ''}. It can use: ${shown(allowedFor(m)).join(', ')}`);
    }
    if (staffedHere(cfg) && /\[code timing\]|\{codetiming\}/i.test(words) && !m.must) throw new ActionError('this facility is staffed, so no door code is sent and [Code Timing] would come out blank - leave it out (or change how the facility runs first)');
    // the product's own words, word for word, are saved empty: they keep following the product (the Messaging page's rule)
    let isDefault = false; try { isDefault = require('../../msgdefaults').isKnownDefault(sectionOf(m), m.field, words); } catch {}
    return { m, words, value: isDefault ? '' : words };
  }
  // how long a text in these words is as sent, with an example booking and a six-digit code
  const textCount = (m, ctx, words) => { try { return segments(renderText(m, ctx.msgConfig || {}, ctx, words, '123456')); } catch { return null; } };

  // ── the webhook (services/webhooks.js; the card's events, public/admin.html WH_EVENTS) ──
  const WH = { 'booking.created': 'new bookings', 'booking.changed': 'moved or extended bookings', 'booking.cancelled': 'cancelled bookings',
    'checkin.completed': 'check-ins', 'member.joined': 'new members', 'giftcard.purchased': 'gift card sales' };
  const WH_NAMES = Object.keys(WH);
  // an address's host only: a hook's path is often its key (anyone holding it can post to it)
  const shortUrl = (u) => { try { const x = new URL(String(u)); return `${x.protocol}//${x.host}${(x.pathname && x.pathname !== '/') || x.search ? '/...' : ''}`; } catch { return 'an address that is not a web address'; } };
  function checkUrl(raw) {
    const s = String(raw || '').trim();
    let u; try { u = new URL(s); } catch { throw new ActionError(`"${clip(s, 80)}" is not a web address - it starts with https://`); }
    if (!/^https?:$/.test(u.protocol) || !u.hostname || /\s/.test(s)) throw new ActionError('the address must start with https:// (or http://)');
    return s;
  }
  function hookPlan(a, ctx) {
    const cur = ((ctx.msgConfig || {}).webhooks) || {};
    if (a.off === true) {
      if (a.address || (a.events && a.events.length) || a.all_events || a.contact_details !== undefined) throw new ActionError('to stop sending, say off on its own');
      if (!cur.url) throw new ActionError('no webhook address is set - nothing is being sent');
      return { off: true, set: [['webhooks.url', '']], cur };
    }
    const url = a.address ? checkUrl(a.address) : String(cur.url || '');
    if (!url) throw new ActionError('give the address to send the events to (it starts with https://)');
    const set = [];
    if (a.address && url !== cur.url) set.push(['webhooks.url', url]);
    let events = null;
    if (a.all_events === true) events = Object.fromEntries(WH_NAMES.map(k => [k, true]));
    else if (a.events && a.events.length) events = Object.fromEntries(WH_NAMES.map(k => [k, a.events.includes(k)]));   // the card saves all six, each true or false
    if (events) set.push(['webhooks.events', events]);
    if (a.contact_details !== undefined) set.push(['webhooks.includeContact', a.contact_details]);
    if (!set.length) throw new ActionError('nothing would change - say the address, the events, or whether customers\' contact details go');
    const now = events || cur.events || null;
    return { set, url, sending: WH_NAMES.filter(k => !now || now[k] !== false), contact: a.contact_details !== undefined ? a.contact_details : cur.includeContact !== false, signed: !!cur.secret, cur };
  }

  // ── the inbox: who, never how to reach them ──
  const EMAIL_RE = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,}/gi;
  const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;
  // on the box's own AI the words come as written; with the owner's own AI service an email or a phone in them is blanked
  // (services/assistant/privacy.js)
  const unPersonal = (s) => (require('../privacy').full() ? String(s == null ? '' : s) : String(s == null ? '' : s).replace(EMAIL_RE, '[email]').replace(PHONE_RE, (x) => /^\d{4}-\d{2}-\d{2}$/.test(x) || x.replace(/\D/g, '').length < 7 ? x : '[phone]'));
  const scrubText = (s) => { const t = unPersonal(s); try { return require('../secrets').scrub(t).text; } catch { return t; } };
  function who(name) {
    if (require('../privacy').full()) return require('../privacy').name(name, 'a visitor who gave no name');
    const parts = unPersonal(name).replace(/\[(email|phone)\]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'a visitor who gave no name';
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
  }
  const formTitle = (ctx, id) => { if (!id) return undefined; const b = ((((ctx.website || {}).layout) || {}).blocks || []).find(x => x && x.id === id); return b ? clip(b.title || b.kicker || 'the inquiry form', 50) : undefined; };
  function findInquiry(ctx, words, handled) {
    const rows = ctx.msgInbox || [];
    if (!rows.length) throw new ActionError('the website inbox is empty - nothing has come in through the inquiry form');
    const w = String(words).trim();
    const byId = rows.find(r => r.id === w || r.id === 'inq-' + w);
    let hit = byId ? [byId] : null;
    if (!hit) {
      const n = w.toLowerCase().replace(/[.,]/g, '').replace(/^(the )?(message|inquiry|email) from /, '').trim();
      hit = rows.filter(r => who(r.name).toLowerCase().replace(/\./g, '') === n || String(r.name || '').trim().toLowerCase() === n);
      if (!hit.length) hit = rows.filter(r => who(r.name).toLowerCase().split(' ')[0] === n.split(/\s+/)[0]);
      const want = handled ? 'new' : 'handled';
      if (hit.length > 1 && hit.some(r => r.status === want)) hit = hit.filter(r => r.status === want);
    }
    if (!hit.length) throw new ActionError(`no message in the inbox is from "${clip(w, 60)}" - read the inbox for who wrote`);
    if (hit.length > 1) throw new ActionError(`more than one message is from ${who(hit[0].name)} - say which by its number: ${hit.slice(0, 5).map(r => `${r.id} (${localWhen(r.created_at)})`).join(', ')}`);
    const r = hit[0];
    if (handled && r.status === 'handled') throw new ActionError(`${who(r.name)}'s message from ${localWhen(r.created_at)} is already marked handled`);
    if (!handled && r.status !== 'handled') throw new ActionError(`${who(r.name)}'s message from ${localWhen(r.created_at)} is already new`);
    return r;
  }

  // ── which message switch: the two senders' own keys (config.js DEFAULTS sms / resend; the scheduler asks each) ──
  const SW = {
    confirmation:    { noun: 'booking confirmation', text: 'sms.sendConfirmation', email: 'resend.sendConfirmation' },
    reminder:        { noun: 'reminder before each session', text: 'sms.sendReminder', email: 'resend.sendReminder' },
    door_code:       { noun: 'door code', text: 'sms.sendDoorCode', email: 'resend.sendDoorCode' },
    cancellation:    { noun: 'cancellation notice', text: 'sms.sendCancellation', email: 'resend.sendCancellation' },
    session_ending:  { noun: '15-minute warning before a session ends', text: 'sms.sendEndingWarning', email: 'resend.sendEndingWarning' },
    booking_changed: { noun: 'email telling customers staff moved their booking', email: 'resend.sendMoved' },   // email.js sendBookingMovedEmail - no text
  };
  function switchPlan(a) {
    const s = SW[a.message];
    const chans = a.channel === 'both' ? ['text', 'email'].filter(c => s[c]) : [a.channel];
    if (chans.some(c => !s[c])) throw new ActionError('that one is sent by email only - there is no text for it');
    return { s, chans, set: chans.map(c => [s[c], a.on]) };
  }

  // the owner's own mobile, in the one shape this unit texts (services/phone.js normalize) - anything else is refused,
  // never kept as typed: an alert number that cannot be texted is no alert at all
  const e164 = (raw) => { const s = String(raw || '').trim(); const d = s.replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d.startsWith('1')) return '+' + d; if (s.startsWith('+') && d.length >= 11 && d.length <= 15) return '+' + d; return null; };
  const pretty = (p) => /^\+1\d{10}$/.test(p) ? `+1 (${p.slice(2, 5)}) ${p.slice(5, 8)}-${p.slice(8)}` : p;

  function pickNewsletter(a, ctx) {
    const going = (ctx.msgNewsletters || []).filter(n => n && n.status === 'sending');
    if (!going.length) throw new ActionError('no newsletter is going out right now - every one has finished or been stopped');
    let hit = going;
    if (a.subject) {
      const s = String(a.subject).trim().toLowerCase();
      hit = going.filter(n => String(n.subject || '').toLowerCase().includes(s) || s.includes(String(n.subject || '').toLowerCase()));
      if (!hit.length) throw new ActionError(`no newsletter going out now is about "${clip(a.subject, 60)}" (going out: ${going.map(n => '"' + n.subject + '"').join(', ')})`);
    }
    if (hit.length > 1) throw new ActionError(`more than one newsletter is going out - say which: ${hit.map(n => '"' + n.subject + '"').join(', ')}`);
    return hit[0];
  }

  const actions = [
    // ── what customers get, and how ─────────────────────────────────────────
    // GET /api/admin/config (routes/admin.js:98 - owner or manager; secrets come back masked, services/auth.js sanitizeConfigForClient)
    { name: 'messages_settings_read', area: 'messages', kind: 'read',
      say: 'See the messages customers get and how: each one by text and by email, on or off, in the owner\'s own words or the product\'s; when the reminder goes; whether texting and email are set up; the name texts are signed with; where replies and urgent alerts go. Use it first when the owner asks about their messages',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/admin/config' }),
      digest: (cfg) => {
        const tr = textReady(cfg), er = emailReady(cfg), staffed = staffedHere(cfg);
        const sw = (p) => isOn(cfg, p) ? 'on' : 'off';
        const whose = (...keys) => { const mine = keys.filter(k => ownWords(cfg, MSG[k])).map(k => MSG[k].ch); return mine.length ? 'your own (' + [...new Set(mine)].join(' and ') + ')' : 'the product\'s'; };
        return {
          texting: tr ? 'set up' : 'not set up - no texts go out', email: er ? 'set up' : 'not set up - no emails go out',
          staffed: staffed ? 'yes - no door codes are sent' : undefined,
          messages: [
            { message: 'booking confirmation', text: sw('sms.sendConfirmation'), email: sw('resend.sendConfirmation'), words: whose('confirmation_text', 'confirmation_email') },
            { message: 'reminder', text: sw('sms.sendReminder'), email: sw('resend.sendReminder'), words: whose('reminder_text', 'reminder_email'), goes: minsWords(Number((cfg.sms || {}).reminderMinsBefore) || 60) + ' before' },
            { message: 'door code', text: staffed ? 'not sent (staffed)' : sw('sms.sendDoorCode'), email: staffed ? 'not sent (staffed)' : sw('resend.sendDoorCode'), words: whose('door_code_text', 'door_code_email') },
            { message: 'cancellation', text: sw('sms.sendCancellation'), email: sw('resend.sendCancellation'), words: whose('cancellation_text', 'cancellation_email') },
            { message: '15-minute warning before the end', text: sw('sms.sendEndingWarning'), email: sw('resend.sendEndingWarning'), words: whose('ending_warning_text', 'next_group_warning_text') + ' (the email\'s words are fixed)' },
            { message: 'booking changed by staff', email: sw('resend.sendMoved'), words: 'the confirmation email\'s, under a "changed" line' },
            { message: 'member emails (welcome, payment failed, ended, cancellation confirmed, waiver renewal)', email: 'always sent', words: whose('member_welcome_email', 'member_payment_failed_email', 'membership_ended_email', 'membership_cancelled_email', 'waiver_renewal_email') },
          ],
          texts_go_to: 'customers who said yes to texts when they booked',
          texts_signed_as: String((cfg.sms || {}).shortBrand || '').trim() || `the business name${(cfg.server || {}).businessName ? ' (' + cfg.server.businessName + ')' : ''}`,
          urgent_alerts_texted_to: (cfg.alerts || {}).ownerMobile ? 'your mobile ending ' + String(cfg.alerts.ownerMobile).replace(/\D/g, '').slice(-4) : 'nobody - no mobile is set',
          replies_inquiries_and_alerts_emailed_to: String((cfg.contact || {}).email || '').trim() || 'nobody - no contact email is set (Settings > Business & Content > Contact Information)',
        };
      } },
    // the words as the senders use them: GET /api/admin/config (routes/admin.js:98), rendered through services/sms.js and
    // services/email.js themselves
    { name: 'message_words_read', area: 'messages', kind: 'read',
      say: 'Read the words of one message customers get (a text or an email): the owner\'s own words or the product\'s, an example exactly as a customer gets it, and the placeholders it fills in (like [Bay] and [Start]). Read it before changing the words',
      params: { type: 'object', properties: { message: { type: 'string', enum: MSG_NAMES, description: MSG_SAY } }, required: ['message'] },
      local: async (a, ctx) => {
        const r = await ctx.call('GET', '/api/admin/config');
        if (!r || r.status >= 400) return { error: `the settings answered ${r ? r.status : 'nothing'}`, routeSaid: true };
        const cfg = r.json || {}, m = MSG[a.message];
        const mine = ownWords(cfg, m);
        let example = null, wordsNow = mine || null;
        try {
          if (m.ch === T) example = renderText(m, cfg, ctx, mine, '[Code]');
          else { example = renderEmail(m, cfg, ctx); if (!mine) { const Em = require('../../email'); wordsNow = Em.EMAIL_DEFAULTS[(staffedHere(cfg) && Em.EMAIL_DEFAULTS[m.field + 'Staffed']) ? m.field + 'Staffed' : m.field] || null; } }
        } catch (e) { example = null; }
        const notes = [];
        const bad = wordsNow ? unfilled(m, wordsNow) : [];
        if (bad.length) notes.push(`${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not filled in - customers see ${bad.length === 1 ? 'it' : 'them'} exactly as written; new words fix it${bad.map(t => tokenHint(t, m, cfg)).filter(Boolean).map(h => ' (' + h + ')').join('')}`);
        if (m.must && staffedHere(cfg)) notes.push('this facility is staffed, so no door codes go out while it is');
        if (m.note) notes.push(m.note);
        return {
          message: m.name, sent: sentNow(m, cfg),
          using: mine ? 'the owner\'s own words' : 'the product\'s own words',
          words: wordsNow || undefined,
          example: example || undefined,
          example_is: example ? (m.fills ? 'for a member called Alex' + (m.fills.includes('[Tier]') ? ' on a Gold membership' : '') : `for a booking tomorrow, 6 to 7 PM, on ${sample(cfg, ctx).bay_name}`) + (m.must ? ' - [Code] stands where the real code goes' : '') : undefined,
          fills_in: shown(allowedFor(m)),
          always_added: m.ch === T ? 'your brand when the words do not name you, and "Reply STOP to opt out. Msg & data rates may apply." (locked)' + (m.added ? '; ' + m.added : '') : m.added,
          note: notes.length ? notes.join('; ') : undefined,
        };
      } },
    // the Messaging page's save: POST /api/admin/config (routes/admin.js:100 - owner, behind the 2FA step-up) with
    // sms.<name>Msg or emailMsgs.<name>; '' = the product's own words (public/admin.html saveSmsMessages / saveEmailMessages)
    { name: 'message_words_set', area: 'messages', kind: 'write',
      confirm: (a) => /^door_code_/.test(a.message), confirmSay: ' (a change to the door code message is shown to the owner to approve first)',
      say: 'Change the words of one message customers get (a text or an email), or put the product\'s own words back. Placeholders like [Bay], [Date] and [Start] fill in for each booking (message_words_read lists each message\'s); the door code messages must keep [Code]; the "Reply STOP" line is added to every text by itself, so leave it out',
      params: { type: 'object', properties: {
        message: { type: 'string', enum: MSG_NAMES, description: MSG_SAY },
        words: { type: 'string', maxLength: 5000, description: 'the new words; a text is best kept to a line or two' },
        use_default: { type: 'boolean', description: 'true to put the product\'s own words back' } }, required: ['message'] },
      needs: ['msgConfig'],
      build: (a, ctx) => { const p = wordsPlan(a, ctx); return { op: 'config', set: [[pathOf(p.m), p.value]] }; },
      describe: (a, ctx) => {
        const p = wordsPlan(a, ctx), m = p.m, cfg = ctx.msgConfig || {};
        if (!p.value) return p.words ? `The ${m.name}: those are the product's own words, so it goes back to following them` : `The ${m.name} goes back to the product's own words`;
        let s = `The ${m.name}, in your words: "${clip(p.words, 500)}"`;
        if (m.ch === T) { const c = textCount(m, ctx, p.words); if (c) s += ` - about ${c.n} characters as sent, so ${c.seg === 1 ? 'one text' : c.seg + ' texts billed'} each time${c.gsm ? '' : ' (it has a character outside plain text, which makes texts cost more)'}; the "Reply STOP" line is added by itself`; }
        else if (m.added) s += ` - ${m.added} still ${/ and |, /.test(m.added) ? 'are' : 'is'} added below`;
        const now = sentNow(m, cfg);
        if (now && !/^on|^always/.test(now)) s += ` (${now.replace(/^off - /, '')})`;
        return s;
      } },
    // the Text Message Settings card (saveSmsSettings) and the Resend card's Send boxes (saveSettings): POST
    // /api/admin/config (routes/admin.js:100). sms.sendDoorCode has no box on any card (only the email one does) - it is
    // read by services/sms.js sendDoorCode and set here
    { name: 'message_switch_set', area: 'messages', kind: 'write',
      confirm: (a) => a.on === false, confirmSay: ' (turning a message off is shown to the owner to approve first)',
      say: 'Turn one kind of customer message on or off, by text, by email or both: the booking confirmation, the reminder, the door code, the cancellation notice, the 15-minute warning before a session ends, or the email when staff move a booking',
      params: { type: 'object', properties: {
        message: { type: 'string', enum: Object.keys(SW), description: 'confirmation, reminder, door_code, cancellation, session_ending (the 15-minute warning), booking_changed (the email when staff move a booking - email only)' },
        channel: { type: 'string', enum: ['text', 'email', 'both'] },
        on: { type: 'boolean' } }, required: ['message', 'channel', 'on'] },
      needs: ['msgConfig'],
      build: (a) => ({ op: 'config', set: switchPlan(a).set }),
      describe: (a, ctx) => {
        const { s, chans } = switchPlan(a), cfg = ctx.msgConfig || {}, k = known(cfg);
        const by = chans.length === 2 ? 'by text and by email' : 'by ' + chans[0];
        const ready = { text: textReady(cfg), email: emailReady(cfg) };
        const staffedNote = a.message === 'door_code' && staffedHere(cfg) ? ' (this facility is staffed, so no door codes go out while it is)' : '';
        if (a.on) {
          const notReady = k ? chans.filter(c => !ready[c]) : [];
          return `Send the ${s.noun} ${by}${chans.includes('text') ? ' (texts go to customers who said yes to texts)' : ''}${notReady.length ? ` - ${notReady.map(c => c === 'text' ? 'texting' : 'email').join(' and ')} ${notReady.length === 2 ? 'are' : 'is'} not set up yet, so it starts once ${notReady.length === 2 ? 'they are' : 'it is'}` : ''}` + staffedNote;
        }
        // off: what still reaches the customer after this
        const left = k ? ['text', 'email'].filter(c => s[c] && !chans.includes(c) && isOn(cfg, s[c]) && ready[c]) : [];
        if (a.message === 'door_code') {
          const rest = left.includes('email') ? ' - it still goes by email, and shows on their My Booking page'
            : left.includes('text') ? ' - customers who said yes to texts still get it by text; everyone else sees it only on their My Booking page'
            : ' - no door code message goes out at all: customers see their code only on their My Booking page, from the time it would have been sent';
          return `Customers stop getting their door code ${by}${k ? rest : ''}` + staffedNote;
        }
        if (a.message === 'booking_changed') return 'Stop emailing customers when staff move their booking - they are not told the new day, time or bay unless staff tell them';
        return `Stop sending the ${s.noun} ${by}` + (k && s.text && s.email ? (left.length ? ` - it still goes by ${left[0]}` : a.message === 'session_ending' ? ' - customers get no warning by text or email (the bay screen\'s own warning is separate)' : ` - customers get no ${s.noun} at all`) : '')
          // services/notifycancel.js: a paid booking the unit itself has to cancel and refund is always emailed (by its own sender)
          + (a.message === 'cancellation' && chans.includes('email') ? ' (a booking the unit itself has to cancel and refund is still emailed, so nobody turns up for it)' : '');
      } },
    // the Reminder Timing box (public/admin.html saveSmsSettings: sms.reminderMinsBefore, 15 to 1440) - read by
    // scheduler.js for the reminder text AND the reminder email
    { name: 'reminder_timing_set', area: 'messages', kind: 'write', confirm: false,
      say: 'Set how long before a session the reminder goes out - one timing for the reminder text and the reminder email (15 minutes to 24 hours)',
      params: { type: 'object', properties: { minutes: { type: 'integer', minimum: 15, maximum: 1440, description: 'minutes before the session: 60 is an hour, 120 two hours, 1440 a day' } }, required: ['minutes'] },
      needs: ['msgConfig'],
      build: (a) => ({ op: 'config', set: [['sms.reminderMinsBefore', a.minutes]] }),
      describe: (a, ctx) => {
        const cfg = ctx.msgConfig || {};
        const off = known(cfg) && !isOn(cfg, 'sms.sendReminder') && !isOn(cfg, 'resend.sendReminder');
        return `The reminder goes ${minsWords(a.minutes)} before each session, by text and by email - a booking made later than that gets none, its confirmation having just told it everything${off ? '. Reminders are switched off right now, so none go until they are turned back on' : ''}`;
      } },
    // the Twilio - SMS card's "Short Brand for Texts" (public/admin.html saveSettings: sms.shortBrand, at most 20) - read by
    // services/sms.js brandFor: the product's own texts open with it, and finalize() adds it to a text that lacks it
    { name: 'texts_signed_as_set', area: 'messages', kind: 'write', confirm: false,
      say: 'Set the short name texts are signed with (like FAIRWAY) - a short one keeps most texts to one message each; or go back to the full business name',
      params: { type: 'object', properties: { name: { type: 'string', maxLength: 20, description: 'a short brand, like FAIRWAY' }, use_business_name: { type: 'boolean', description: 'true to sign texts with the full business name again' } } },
      needs: ['msgConfig'],
      build: (a) => {
        if (a.use_business_name === true) { if (a.name) throw new ActionError('say the short name, or use_business_name - not both'); return { op: 'config', set: [['sms.shortBrand', '']] }; }
        const n = plainMarks(a.name || '').trim();
        if (!n) throw new ActionError('say the short name texts are signed with (or use_business_name: true)');
        return { op: 'config', set: [['sms.shortBrand', n]] };
      },
      describe: (a, ctx) => {
        const n = a.use_business_name === true ? '' : plainMarks(a.name || '').trim(), biz = ((ctx.msgConfig || {}).server || {}).businessName || '';
        return n ? `Texts are signed "${n}": the product's own texts open with it, and it is added to the end of a text in your words that does not already carry it${GSM.test(n) ? '' : ' (it has a character outside plain text, which makes every text cost more)'}`
          : `Texts are signed with the full business name${biz ? ', "' + biz + '"' : ''} - a long name can make each text bill as two`;
      } },
    // the Twilio - SMS card's "Your own mobile, for urgent alerts" (public/admin.html saveSettings: alerts.ownerMobile) -
    // texted by services/owneralert.js; the contact email gets the same alert. Its callers: doorlock.js (member-fallback),
    // scheduler.js (door:, pc-down:), startedslot.js and routes/customer.js (refund-failed:), hadoor.js (ha-door-down,
    // door-stranger-), unifiaccess.js (unifi-cert:)
    { name: 'owner_alert_mobile_set', area: 'messages', kind: 'write', confirm: true,
      say: 'Set the owner\'s own mobile number for urgent alerts (door and lock problems, a member\'s door access failing, a refund Stripe refused, a bay PC not coming up) - never shown to customers; or stop the alert texts',
      params: { type: 'object', properties: { phone: { type: 'string', maxLength: 25, description: 'the owner\'s own mobile number' }, none: { type: 'boolean', description: 'true to stop the alert texts' } } },
      needs: ['msgConfig'],
      build: (a) => {
        if (a.none === true) { if (a.phone) throw new ActionError('say the number, or none - not both'); return { op: 'config', set: [['alerts.ownerMobile', '']] }; }
        if (!a.phone) throw new ActionError('say the mobile number for urgent alerts (or none: true to stop them)');
        const p = e164(a.phone);
        if (!p) throw new ActionError(`"${clip(a.phone, 25)}" is not a mobile number this unit can text - ten digits, or + and the country code`);
        return { op: 'config', set: [['alerts.ownerMobile', p]] };
      },
      describe: (a, ctx) => {
        const cfg = ctx.msgConfig || {}, contact = String((cfg.contact || {}).email || '').trim();
        if (a.none === true) return `No more urgent alert texts${known(cfg) ? (contact ? ' - they still go by email to ' + contact : ' - and no contact email is set, so urgent alerts reach no one; they stay on the health line in Admin') : ''}`;
        return `Urgent alerts are texted to ${pretty(e164(a.phone))} - only when something needs you now: a door lock not answering, not taking a booking's code or holding a code this system never issued, the door console's certificate not trusted, a member's door access failing, a refund Stripe refused, a bay PC not coming up after its wake. Never shown to customers${known(cfg) && !textReady(cfg) ? '. Texting is not set up yet, so they go by text once it is' + (contact ? ' (meanwhile by email to ' + contact + ')' : '') : ''}`;
      } },

    // ── newsletters (sending is newsletter_send; reading what went out is newsletters_read) ──
    // GET /api/website/subscribers?per=1 (routes/website.js:596 - owner or manager): its counts only, never a row
    { name: 'email_signups_count', area: 'messages', kind: 'read',
      say: 'Count how many people are signed up for email updates (who get the newsletters) - a number only, never their addresses',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/website/subscribers?per=1' }),
      digest: (j) => { const active = Number(j.active) || 0, all = Number(j.total) || 0; return { signed_up: active, unsubscribed: Math.max(0, all - active) }; } },
    // POST /api/website/newsletters/:id/cancel (routes/website.js:592 - owner; every /api/website write is behind the 2FA
    // step-up, server.js:746); services/newsletter.js cancel: the ones still waiting are not sent; 409 when it has finished
    { name: 'newsletter_cancel', area: 'messages', kind: 'write', confirm: true,
      say: 'Stop a newsletter that is going out right now: the people it has not reached yet will not get it',
      params: { type: 'object', properties: { subject: { type: 'string', maxLength: 150, description: 'words from its subject - needed only when more than one is going out' } } },
      needs: ['msgNewsletters'],
      build: (a, ctx) => { const n = pickNewsletter(a, ctx); return { op: 'http', method: 'POST', path: `/api/website/newsletters/${encodeURIComponent(n.id)}/cancel` }; },
      describe: (a, ctx) => { const n = pickNewsletter(a, ctx); return `Stop the newsletter "${n.subject}": the ${n.pending} of ${n.total} not reached yet will not get it (the emails already sent cannot be taken back), and it cannot be restarted - sending it again goes to everyone signed up`; } },

    // ── the website inbox (the Inquiry form block; Admin > Website > Inbox) ──
    // GET /api/website/inquiries (routes/website.js:609 - owner or manager); the newest 200. Who by first name and last
    // initial, the first words with any email or phone in them blanked - never their address or number
    { name: 'inbox_read', area: 'messages', kind: 'read',
      say: 'Read the website inbox: what visitors sent through the inquiry form (parties, leagues, questions) - who, when, what about and the first words (on the box\'s own AI also their email and phone). The new ones, unless the owner asks for all',
      params: { type: 'object', properties: { include_handled: { type: 'boolean', description: 'true to show the ones already marked handled too' } } },
      needs: ['website'],
      local: async (a, ctx) => {
        const r = await ctx.call('GET', '/api/website/inquiries');
        if (!r || r.status >= 400) return { error: `the inbox answered ${r ? r.status : 'nothing'}`, routeSaid: true };
        const rows = (r.json && r.json.inquiries) || [];
        const pick = a.include_handled ? rows : rows.filter(x => x.status !== 'handled');
        return {
          new_messages: Number(r.json && r.json.newCount) || 0,
          // six at most: what a tool answers is cut at 3000 characters (engine.js trim)
          messages: pick.slice(0, 6).map(x => ({ inquiry_id: x.id, from: who(x.name), when: localWhen(x.created_at), form: formTitle(ctx, x.block),
            about_date: x.want_date ? firstWords(scrubText(x.want_date), 40) : undefined, people: x.people ? firstWords(scrubText(x.people), 20) : undefined,
            says: x.message ? firstWords(scrubText(x.message), 120) : '(no message)', handled: x.status === 'handled' ? true : undefined, emailed_to_you: x.emailed ? true : undefined,
            ...require('../privacy').contact(x) })),
          more_not_shown: pick.length > 6 ? pick.length - 6 : undefined,
          contact_details: pick.length && !require('../privacy').full() ? 'their email and phone are in Admin > Website > Inbox' : undefined,
        };
      } },
    // PUT /api/website/inquiries/:id { status: 'handled' | 'new' } (routes/website.js:613 - owner or manager; behind the 2FA
    // step-up, server.js:746). The route answers ok for a number it does not have, so the number is found in the inbox first
    { name: 'inbox_mark', area: 'messages', kind: 'write', confirm: false,
      say: 'Mark a website inbox message handled (or back to new) - by its number from the inbox, or who it is from',
      params: { type: 'object', properties: { inquiry: { type: 'string', minLength: 1, maxLength: 80, description: 'the inquiry_id from inbox_read, or the name of who wrote' }, handled: { type: 'boolean', description: 'false to put it back to new; leave out to mark it handled' } }, required: ['inquiry'] },
      needs: ['msgInbox'],
      build: (a, ctx) => { const r = findInquiry(ctx, a.inquiry, a.handled !== false); return { op: 'http', method: 'PUT', path: `/api/website/inquiries/${encodeURIComponent(r.id)}`, body: { status: a.handled !== false ? 'handled' : 'new' } }; },
      describe: (a, ctx) => { const r = findInquiry(ctx, a.inquiry, a.handled !== false); return a.handled !== false ? `Mark ${who(r.name)}'s message from ${localWhen(r.created_at)} as handled` : `Put ${who(r.name)}'s message from ${localWhen(r.created_at)} back as new`; } },

    // ── the outbound webhook (Settings > Connections > Outbound Webhooks; services/webhooks.js) ──
    // GET /api/admin/config (routes/admin.js:98) for the card's settings and GET /api/admin/webhooks/last (routes/admin.js:813)
    // for the last delivery - kept in memory, so since the unit last started. The signing secret is never read out
    { name: 'webhook_read', area: 'messages', kind: 'read',
      say: 'See the outbound webhook: the address events are sent to (like a Zapier hook), which events, whether customers\' contact details go with them, whether deliveries are signed, and whether the last delivery worked',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const c = await ctx.call('GET', '/api/admin/config');
        if (!c || c.status >= 400) return { error: `the settings answered ${c ? c.status : 'nothing'}`, routeSaid: true };
        const w = (c.json && c.json.webhooks) || {};
        let last = null; try { const r = await ctx.call('GET', '/api/admin/webhooks/last'); last = (r && r.status < 400 && r.json) || null; } catch {}
        const lastSaid = !last || last.none || !last.at ? 'none since the unit last started' : { when: localWhen(last.at), worked: last.status >= 200 && last.status < 300, answered: last.status ? last.status : 'no answer' };
        if (!w.url) return { address: 'not set - nothing is sent', last_delivery: lastSaid };
        if (!/^https?:\/\//.test(w.url)) return { address: 'set, but not a web address (it must start with https://) - nothing is sent', last_delivery: lastSaid };
        return {
          address: shortUrl(w.url),
          sends: WH_NAMES.filter(k => !w.events || w.events[k] !== false).map(k => WH[k]),
          does_not_send: WH_NAMES.filter(k => w.events && w.events[k] === false).map(k => WH[k]),
          customer_contact_details: w.includeContact !== false ? 'sent - each booking\'s customer name, phone and email, and a new member\'s name and email' : 'left out',
          door_codes: 'never sent',
          signed: w.secret ? 'yes - each delivery carries a signature made with your secret' : 'no - no signing secret is set (the Outbound Webhooks card)',
          last_delivery: lastSaid,
        };
      } },
    // the Outbound Webhooks card's save (public/admin.html whSave): POST /api/admin/config (routes/admin.js:100) with
    // webhooks.url / events (all six, each true or false) / includeContact. The secret stays as saved: the settings come
    // back masked and a masked secret is kept on save (services/auth.js mergeIncomingConfig)
    { name: 'webhook_set', area: 'messages', kind: 'write', confirm: true,
      say: 'Set the outbound webhook: the address to send events to (like a Zapier hook), which events, and whether customers\' names, phone numbers and emails go with them; or stop sending. The signing secret is typed on the Outbound Webhooks card, never here',
      params: { type: 'object', properties: {
        address: { type: 'string', maxLength: 500, description: 'the full address, starting https://' },
        events: { type: 'array', items: { type: 'string', enum: WH_NAMES }, description: 'which to send (the others stop): booking.created (new bookings), booking.changed (moved or extended), booking.cancelled, checkin.completed, member.joined, giftcard.purchased; leave out to keep them as they are' },
        all_events: { type: 'boolean', description: 'true to send every event' },
        contact_details: { type: 'boolean', description: 'whether customers\' names, phone numbers and emails go with each event; leave out to keep it as it is' },
        off: { type: 'boolean', description: 'true to stop sending anything' } } },
      needs: ['msgConfig'],
      build: (a, ctx) => ({ op: 'config', set: hookPlan(a, ctx).set }),
      describe: (a, ctx) => {
        const p = hookPlan(a, ctx);
        if (p.off) return `Stop sending events to ${shortUrl(p.cur.url)}: nothing is sent anywhere until an address is set again`;
        const ev = p.sending.length === WH_NAMES.length ? 'every event (new, moved and cancelled bookings, check-ins, new members, gift card sales)' : p.sending.length ? p.sending.map(k => WH[k]).join(', ') : 'no events at all (every one is off)';
        let s = `Send ${ev} to ${p.url}`;
        s += p.contact ? ' - each booking\'s customer name, phone number and email address go to that address, and a new member\'s name and email (door codes never do)' : ' - without customers\' names, phone numbers or email addresses (door codes never go)';
        if (!p.signed) s += '. No signing secret is set, so the receiver cannot check a delivery came from you - type one on the Outbound Webhooks card';
        if (/^http:/i.test(p.url)) s += '. The address is not https, so what is sent travels unencrypted';
        return s;
      } },

    // ── who texted STOP (services/db.js sms_optouts): never undone here - only the person, by texting START ──
    // GET /api/admin/sms-optouts (routes/admin.js:216 - owner or manager): a count, and yes or no for a number the owner
    // names - the list of numbers never leaves
    { name: 'text_stops_read', area: 'messages', kind: 'read',
      say: 'See how many people texted STOP (they get no texts from this unit until they text START), or whether one phone number did - use it when a customer says they are not getting texts',
      params: { type: 'object', properties: { phone: { type: 'string', maxLength: 25, description: 'a customer\'s phone number, to check that one' } } },
      local: async (a, ctx) => {
        const r = await ctx.call('GET', '/api/admin/sms-optouts');
        if (!r || r.status >= 400) return { error: `that answered ${r ? r.status : 'nothing'}`, routeSaid: true };
        const rows = (r.json && r.json.optouts) || [];
        const out = { texted_stop: Number(r.json && r.json.count) || rows.length, note: 'they get no texts from this unit until they text START themselves - nobody can undo a STOP for them' };
        if (rows.length) out.latest = localWhen(rows[0].opted_out_at);
        if (a.phone) {
          const d = String(a.phone).replace(/\D/g, ''), k = d.length > 10 ? d.slice(-10) : d;   // services/db.js smsKey
          if (k.length < 10) out.that_number = 'give the whole number, with the area code';
          else { const hit = rows.find(x => String(x.phone) === k); out.that_number = hit ? `texted STOP${hit.source === 'carrier' ? ' (their phone company says they opted out)' : ''} - ${localWhen(hit.opted_out_at)}` : 'has not texted STOP'; }
        }
        return out;
      } },
  ];

  // ── what the writes read first, once a turn, through the owner's own routes (names kept apart from other areas') ──
  const loaders = {
    // the settings as the owner's screen reads them (secrets masked): GET /api/admin/config, routes/admin.js:98
    msgConfig: async (ctx) => { try { const r = await ctx.call('GET', '/api/admin/config'); return (r && r.status < 400 && r.json) || {}; } catch { return {}; } },
    // the newsletters: GET /api/website/newsletters, routes/website.js:580
    msgNewsletters: async (ctx) => { try { const r = await ctx.call('GET', '/api/website/newsletters'); return (r && r.json && r.json.newsletters) || []; } catch { return []; } },
    // the inbox, kept to what finding one needs - no email, phone or message: GET /api/website/inquiries, routes/website.js:609
    msgInbox: async (ctx) => { try { const r = await ctx.call('GET', '/api/website/inquiries'); return ((r && r.json && r.json.inquiries) || []).map(x => ({ id: x.id, name: x.name, created_at: x.created_at, status: x.status })); } catch { return []; } },
  };

  return { actions, loaders };
};
