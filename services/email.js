// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/email.js — Resend Email Notifications
//
//  Mirrors SMS functionality — same messages, same triggers.
//  Can be used as backup to SMS or as primary notification method.
// ═══════════════════════════════════════════════════════════════════════════════

const { getConfig } = require('./config');
const { adminLog }  = require('./db');

// BA_RESEND_API: a battery's stand-in (the BA_STRIPE_API_BASE / BA_REMOTELOCK_BASE pattern) - never set on a unit
const RESEND_API = process.env.BA_RESEND_API || 'https://api.resend.com/emails';

/**
 * Send an email via Resend API
 */
const EMAIL_TIMEOUT_MS = Number(process.env.BA_EMAIL_TIMEOUT_MS) || 15000;
async function sendEmail({ to, subject, text, html, attachments, cc }) {
  const cfg = getConfig();
  const key  = cfg.resend?.apiKey;
  const from = cfg.resend?.fromEmail || '';
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const ccList = (Array.isArray(cc) ? cc : (cc ? [cc] : [])).filter(Boolean);

  // EMAIL_DRYRUN=1 (W29, the SMS_DRYRUN twin): nothing leaves the unit; the
  // message goes to the console and the log line carries the recipients,
  // the subject and each attachment's sha256 so a battery or the bench
  // can prove what WOULD have gone, byte for byte.
  if (process.env.EMAIL_DRYRUN === '1') {
    const att = (attachments || []).map(a => { try { return `${a.filename} sha256 ${require('crypto').createHash('sha256').update(Buffer.from(a.content, 'base64')).digest('hex')}`; } catch { return a.filename; } });
    console.log(`[DRYRUN EMAIL to ${toList.join(', ')}${ccList.length ? ' cc ' + ccList.join(', ') : ''}] ${subject}\n${text || '(html)'}`);
    adminLog('EMAIL_DRYRUN', `To: ${toList.join(', ')}${ccList.length ? ' | Cc: ' + ccList.join(', ') : ''} | Subject: ${subject}${att.length ? ' | Attach: ' + att.join('; ') : ''}`);
    return true;
  }

  if (!key || !key.startsWith('re_')) {
    return undefined;                       // this facility does not send email: absent, not failed
  }
  if (!toList.length || !from) {
    if (!from) { try { adminLog('EMAIL_NOT_CONFIGURED', `no From address set in Settings > Connections - "${String(subject).slice(0, 80)}" was not sent, and no email can be`); } catch {} }
    return undefined;
  }

  try {
    // A PROVIDER THAT DOES NOT ANSWER IS A FAILURE, NOT A WAIT (Sep 25 2026): this call
    // had no time limit, so a hung Resend held its caller - a reminder job's lease, a
    // customer's PIN request - for as long as the socket stayed open, and nothing was
    // ever logged. Fifteen seconds, then EMAIL_ERROR with the reason.
    const res = await fetch(RESEND_API, {
      signal:  AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json'
      },
      // reply_to: replies to automated mail reach a human (the public contact
      // address), never the unmonitored sending address. Compliance requirement.
      body: JSON.stringify({ from, to: toList, subject, ...(ccList.length ? { cc: ccList } : {}), ...(html ? { html } : { text }), ...(attachments?.length ? { attachments } : {}), ...(cfg.contact?.email ? { reply_to: [cfg.contact.email] } : {}) })
    });

    const data = await res.json();
    if (res.ok) {
      adminLog('EMAIL_SENT', `To: ${toList.join(', ')}${ccList.length ? ' | Cc: ' + ccList.join(', ') : ''} | Subject: ${subject}`);
      return true;
    } else {
      adminLog('EMAIL_FAILED', `To: ${toList.join(', ')} | ${data.message}`);
      return false;
    }
  } catch (err) {
    const why = (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) ? `Resend did not answer within ${EMAIL_TIMEOUT_MS / 1000} s` : err.message;
    adminLog('EMAIL_ERROR', `To: ${toList.join(', ')} | ${why}`);
    return false;
  }
}

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m)-1]} ${parseInt(day)}, ${y}`;
}

function fmtDuration(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function bookingVars(booking, extra = {}) {
  const cfg = getConfig();
  return {
    'Business Name': cfg.server.businessName || '',
    'Bay':           booking.bay_name || '',
    // [Space] is "Bay" or "Facility" - the shipped templates use it so a
    // whole-facility club does not label the building "Bay:". An owner who
    // has customised their template keeps [Bay] working exactly as before.
    'Space':         require('./bookingcore').spaceWords(cfg).label,
    'Date':          fmtDate(booking.date),
    'Start':         fmt12(booking.start_time),
    'End':           fmt12(booking.end_time),
    'Start Time':    fmt12(booking.start_time),
    'End Time':      fmt12(booking.end_time),
    'Duration':      fmtDuration(booking.duration_minutes),
    // when the door code arrives: "15 minutes before start" / "within 5 minutes", from the owner's door-code timing
    'Code Timing':   require('./doorlock').codeTimingPhrase(booking, cfg, new Date(), 'email'),
    ...extra
  };
}

// ── EMAIL TEMPLATES ──────────────────────────────────────────────────────────
// Owner-editable bodies (Admin > Settings > Email Messages). Each template is
// the human-voice part; compliance/structural blocks (receipts, member PINs,
// auto-renewal terms) are appended by code and canNOT be edited away.
function fillEmail(template, map) {
  let out = String(template);
  for (const [keys, val] of map) {
    for (const k of keys) {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(esc, 'gi'), String(val));
    }
  }
  return out;
}
function bookingEmailMap(vars, extra = {}) {
  return [
    [['{business}', '[Business Name]'], vars['Business Name']],
    [['{bay}', '[Bay]', '[Bay Name]'], vars['Bay']],
    // "Bay" or "Facility" - the shipped defaults have said "[Space]:" since Sep 19 and this map never filled it, so every
    // default booking email read "[Space]:      Bay 2" (test-message-defaults C1, Oct 20 2026)
    [['{space}', '[Space]'], vars['Space']],
    [['{date}', '[Date]'], vars['Date']],
    [['{time}', '[Start]', '[Start Time]'], vars['Start']],
    [['{endtime}', '[End]', '[End Time]'], vars['End']],
    [['{duration}', '[Duration]'], vars['Duration']],
    [['{codetiming}', '[Code Timing]'], vars['Code Timing']],
    ...Object.entries(extra).map(([k, v]) => [k.split('|'), v])
  ];
}
const EMAIL_DEFAULTS = {
  confirmationBody: `Booking Confirmed - [Business Name]\n--------------------------\n[Space]:      [Bay]\nDate:     [Date]\nTime:     [Start] - [End]\nDuration: [Duration]\n--------------------------\nYour door code arrives [Code Timing].\n\nSee you soon!`,
  reminderBody: `Reminder - Your session starts soon!\n--------------------------\n[Space]:  [Bay]\nTime: [Start] - [End]\n--------------------------\nYour door code arrives [Code Timing].`,
  doorCodeBody: `Your Door Code: [Code]\n--------------------------\n[Space]:     [Bay]\nSession: [Start] - [End]\nValid today only. Enter on the door keypad.`,
  confirmationBodyStaffed: `Booking Confirmed - [Business Name]\n--------------------------\n[Space]:      [Bay]\nDate:     [Date]\nTime:     [Start] - [End]\nDuration: [Duration]\n--------------------------\nJust come on in - our staff will get you set up.\n\nSee you soon!`,
  reminderBodyStaffed: `Reminder - Your session starts soon!\n--------------------------\n[Space]:  [Bay]\nTime: [Start] - [End]\n--------------------------\nCome on in - our staff will get you set up.`,
  cancellationBody: `Booking Cancelled\nYour session at [Bay] on [Date] at [Start] has been cancelled.\nA refund will be issued if applicable.`,
  memWelcomeIntro: `Welcome, [Name]!\n--------------------------\nYour [Tier] membership at [Business Name] is active.`,
  memFailedIntro: `Hi [Name],\n\nWe could not process your [Tier] membership renewal payment. Your card will be retried automatically over the next few days.`,
  memEndedBody: `Hi [Name],\n\nYour [Tier] membership has ended because the renewal payment could not be completed. No further charges will be made.\n\nIf you believe this is a mistake, reply to this email and we will sort it out.`,
  memCancelIntro: `Hi [Name],\n\nYour membership cancellation is confirmed.`,
  waiverRenewIntro: `Hi [Name],\n\nThe liability waiver on file with your membership at [Business Name] runs out on [Date].`
};
function emailTmpl(key, map) {
  const cfg = getConfig();
  // Staffed facilities get door-code-free default copy; a custom template
  // always wins either way.
  const effKey = (cfg.booking?.staffedAccess && EMAIL_DEFAULTS[key + 'Staffed']) ? key + 'Staffed' : key;
  // a stored copy of a default the Messaging page showed is not the owner's text - it
  // follows the current default, the staffed door-code-free one included (msgdefaults)
  const mine = require('./msgdefaults').own('email', key, cfg.emailMsgs && cfg.emailMsgs[key]);
  const t = mine ? mine : EMAIL_DEFAULTS[effKey];
  return fillEmail(t, map);
}

async function sendConfirmationEmail(booking) {
  const cfg = getConfig();
  if (!cfg.resend?.sendConfirmation) return;
  const c = confirmationMessage(booking, cfg);
  return sendEmail({ to: booking.email, subject: `Booking Confirmed — ${c.vars['Bay']} ${c.vars['Date']} ${c.vars['Start']}`, text: c.text, attachments: c.attachments });
}

/** A BOOKING STAFF MOVED IS EMAILED (maintainer, Oct 4 2026: "If staff move a booking sure email them"): the confirmation's own
 *  text for the new date, time and bay - door timing, what is due, the calendar invite (its same id moves the calendar
 *  entry) - under "Booking Changed", with what it was before at the top. The owner's switch is resend.sendMoved (on). */
async function sendBookingMovedEmail(booking, was) {
  const cfg = getConfig();
  if (cfg.resend?.sendMoved === false || !booking.email) return;
  const c = confirmationMessage(booking, cfg);
  const fmtWas = was ? `${was.bay_name || ''} ${bookingVars(Object.assign({}, booking, was))['Date']} ${bookingVars(Object.assign({}, booking, was))['Start']}`.trim() : '';
  const head = `Your booking has been changed by the facility.${fmtWas ? `\nIt was: ${fmtWas}` : ''}\nHere are the new details.\n\n`;
  return sendEmail({ to: booking.email, subject: `Booking Changed — ${c.vars['Bay']} ${c.vars['Date']} ${c.vars['Start']}`, text: head + c.text, attachments: c.attachments });
}

function confirmationMessage(booking, cfg = getConfig()) {
  const vars = bookingVars(booking);

  // Build receipt with optional tax breakdown
  const subtotal = booking.price_cents || 0;
  const hasTax   = cfg.tax?.enabled && cfg.tax?.rate > 0 && subtotal > 0;
  const taxCents = hasTax ? Math.round(subtotal * (cfg.tax.rate / 100)) : 0;
  const total    = subtotal + taxCents;
  const taxLabel = cfg.tax?.label || 'Sales Tax';

  // WHAT THE CUSTOMER'S BOOKING IS CALLED (maintainer, Sep 19 2026). A venue that rents
  // the whole building as one has no bays to its customers - "holds your bay"
  // is the wrong noun there. One helper decides, shared with the confirmation
  // screen and the portal, so the three cannot drift.
  const _sw = require('./bookingcore').spaceWords(cfg);
  let pkgSnap = null; try { pkgSnap = booking.package_json ? JSON.parse(booking.package_json) : null; } catch { pkgSnap = null; }

  let receipt = '';
  if (booking.door_settle) {
    // Reservation-only member booking (door-settled tier): nothing was charged.
    // Say what lands on the tab so nobody is surprised at the counter.
    const due = booking.door_due_cents || 0;
    receipt = `\n\nPAY AT THE FACILITY\n--------------------------\nCharged today: $0.00\nThis reservation holds ${_sw.your}. About $${(due/100).toFixed(2)} of member golf${booking.blend_note ? ` (${booking.blend_note})` : ''} is settled on your tab at check-in - bring a group and ${_sw.split}, your seat at your member rate. Guests settle their share at the counter.`;
  } else if (booking.is_deposit) {
    receipt = `\n\nDEPOSIT ONLY\n--------------------------\nDeposit paid: $${(subtotal/100).toFixed(2)}${booking.member_due_cents > subtotal ? `\nYour member price: $${(booking.member_due_cents/100).toFixed(2)} - about $${((booking.member_due_cents - subtotal)/100).toFixed(2)} settles at the door` : ''}\nThis payment reserves ${_sw.reserves}. Member pricing and each player's share are settled at the door based on your final group size; your deposit is credited to your tab when you arrive.`;
  } else if (pkgSnap && subtotal > 0) {
    // A PACKAGE DEAL (Oct 22 2026): its own copy as bought - its name, what it includes, and its tax the owner's way
    // (a line at a time: the golf as a booking, the rest at a counter code - services/packages.js taxFor), never the bookings' rate
    const t = pkgSnap.tax || { lines: [], tax_cents: 0 };
    const taxC = pkgSnap.charged_tax_cents != null ? (pkgSnap.charged_tax_cents | 0) : (t.tax_cents | 0);
    receipt = `\n\nPACKAGE: ${pkgSnap.name}${pkgSnap.players > 1 ? ` (${pkgSnap.players} players)` : ''}\n--------------------------`
      + (pkgSnap.includes && pkgSnap.includes.length ? `\nIncludes: ${pkgSnap.includes.map(x => `${x.qty} ${x.kind === 'part' ? 'from ' : ''}${x.name}`).join(', ')} - at the counter, on this booking` : '')
      + `\nSubtotal: $${(subtotal/100).toFixed(2)}`
      + (t.lines || []).filter(l => l.tax_cents > 0).map(l => `\nTax - ${l.label} (${l.rate}%): $${(l.tax_cents/100).toFixed(2)}`).join('')
      + `\nTotal:    $${((subtotal + taxC)/100).toFixed(2)}`;
    if (cfg.tax?.taxId) receipt += `\nTax ID:   ${cfg.tax.taxId}`;
  } else if (subtotal > 0) {
    receipt = `\n\nRECEIPT\n--------------------------\nSubtotal: $${(subtotal/100).toFixed(2)}`;
    // a booking deal it was bought with (Oct 22 2026): named, and what it took off
    if (booking.deal_name && booking.deal_cents > 0) receipt += `\n(${booking.deal_name}: $${(booking.deal_cents/100).toFixed(2)} off)`;
    if (hasTax) {
      receipt += `\n${taxLabel} (${cfg.tax.rate}%): $${(taxCents/100).toFixed(2)}`;
    }
    receipt += `\nTotal:    $${(total/100).toFixed(2)}`;
    if (cfg.tax?.taxId) receipt += `\nTax ID:   ${cfg.tax.taxId}`;
  }
  // free things that come with it (a free-things deal - services/deals.js, Oct 22 2026, night): said plainly, picked up at the desk
  try { const inc = require('./deals').itemsLine(booking); if (inc) receipt += `\n\nWITH YOUR BOOKING: ${inc} - just ask at the counter when you arrive.`; } catch {}
  // a code checked at the door: what to bring (Oct 23 2026)
  try { const c = require('./pricing').doorCheckOf(booking); if (c) receipt += `\n\nBRING WITH YOU: ${c.check} - it is checked at the front desk for your ${c.code} rate.`; } catch {}

  // Calendar invite: .ics attachment + a Google Calendar link in the body.
  let icsAttach = [];
  let calLine = '';
  try {
    const { buildIcs, googleLink } = require('./ics');
    icsAttach = [{ filename: 'booking.ics', content: Buffer.from(buildIcs(booking)).toString('base64') }];
    calLine = `\nAdd to your calendar: ${googleLink(booking)}\n`;
  } catch {}
  // editable body + LOCKED receipt (tax math is always appended by code)
  return { vars, text: emailTmpl('confirmationBody', bookingEmailMap(vars)) + receipt + calLine, attachments: icsAttach };
}

async function sendReminderEmail(booking, minsBefore) {
  const cfg = getConfig();
  if (!cfg.resend?.sendReminder) return;
  const vars = bookingVars(booking);

  return sendEmail({
    to:      booking.email,
    subject: `Reminder — Your session starts in ${minsBefore} minutes`,
    text:    emailTmpl('reminderBody', bookingEmailMap(vars, { '{mins}|[Mins]|[Minutes]': String(minsBefore) }))
  });
}

async function sendDoorCodeEmail(booking, code, opts = {}) {
  if (typeof opts === 'string') opts = { note: opts };   // doorlock.doorCodeNote, or { note, fallback }
  opts = opts || {};
  const note = opts.note || '';
  const cfg = getConfig();
  if (!cfg.resend?.sendDoorCode) return;
  const vars = bookingVars(booking);

  return sendEmail({
    to:      booking.email,
    subject: `Your Door Code — ${vars['Bay']} ${vars['Start']}`,
    text:    emailTmpl('doorCodeBody', bookingEmailMap(vars, { '{code}|[Code]|[Door Code]': code, '{backup}|[Backup Code]': opts.fallback || '' }))
             // the standing backup rides BESIDE the real code (feature/door-interface)
             + (opts.fallback && !/\{backup\}|\[Backup Code\]/i.test(String((cfg.resend && cfg.resend.doorCodeBody) || EMAIL_DEFAULTS.doorCodeBody || '')) ? `\n\nIf it does not open, use ${opts.fallback}.` : ``)
             + (note ? '\n\n' + note : '')   // doorlock.doorCodeNote
  });
}

async function sendCancellationEmail(booking) {
  const cfg = getConfig();
  if (!cfg.resend?.sendCancellation) return;
  const vars = bookingVars(booking);

  // Attach a METHOD:CANCEL invite so the session clears itself out of the
  // customer's calendar instead of lingering as a ghost appointment.
  let icsAttach;
  try {
    const { buildIcs } = require('./ics');
    icsAttach = [{ filename: 'booking.ics',
                   content: Buffer.from(buildIcs(booking, 'CANCEL')).toString('base64') }];
  } catch { icsAttach = undefined; }

  return sendEmail({
    to:      booking.email,
    subject: `Booking Cancelled — ${vars['Bay']} ${vars['Date']}`,
    text:    emailTmpl('cancellationBody', bookingEmailMap(vars)),
    attachments: icsAttach
  });
}

async function sendSessionEndingEmail(booking, hasNextBooking, isCloseSession = false, noMoreTime = false) {
  const cfg = getConfig();
  if (!cfg.resend?.sendEndingWarning) return;
  const vars = bookingVars(booking);

  const body = isCloseSession
    ? `Your session ends in 15 minutes.\n--------------------------\n${vars['Space']}: ${vars['Bay']}\nSession ends at: ${vars['End']}\n\nYour session ends when we close for the night. Please wrap up your round and plan to exit by then. The simulator shuts down automatically at close.\n\nThank you for playing at ${vars['Business Name']}!`
    : hasNextBooking
    ? `Your session ends in 15 minutes.\n--------------------------\n${vars['Space']}: ${vars['Bay']}\nSession ends at: ${vars['End']}\n\nThe next group is scheduled to begin soon. Please plan to exit the bay promptly at your session end time.\n\nThank you for playing at ${vars['Business Name']}!`
    : noMoreTime
    ? `Your session ends in 15 minutes.\n--------------------------\n${vars['Space']}: ${vars['Bay']}\nSession ends at: ${vars['End']}\n\nWe close soon after your session, so there is no time to book after it - please plan to wrap up by your end time.\n\nThank you for playing at ${vars['Business Name']}!`
    : `Your session ends in 15 minutes.\n--------------------------\n${vars['Space']}: ${vars['Bay']}\nSession ends at: ${vars['End']}\n\nNo one is booked after you - feel free to book more time and keep playing!\n\nThank you for playing at ${vars['Business Name']}!`;

  return sendEmail({
    to:      booking.email,
    subject: `Your session ends in 15 minutes — ${vars['Bay']}`,
    text:    body
  });
}


// Membership welcome — restates the auto-renewal terms and how to cancel
// (required by state auto-renewal laws), and delivers the member PIN.
async function sendMembershipWelcome({ to, name, tierName, pin, cadence, price }) {
  const cfg = getConfig();
  const per = cadence === 'annual' ? 'year' : 'month';
  const amt = '$' + (Math.round(price * 100) / 100).toFixed(2);
  const portal = `${(cfg.seo?.domain || '').replace(/\/$/, '')}/my-membership`;
  const intro = emailTmpl('memWelcomeIntro', [[['{name}','[Name]'], name], [['{tier}','[Tier]'], tierName], [['{business}','[Business Name]'], cfg.server.businessName]]);
  // LOCKED below: PIN delivery + auto-renewal terms + cancellation path are
  // required disclosures (state auto-renewal laws) and always appended.
  return sendEmail({ to: to, subject: `Welcome to ${tierName} - ${cfg.server.businessName}`, text: intro + `\n\n` +
    `YOUR MEMBER PIN: ${pin}\n` +
    `Enter it at checkout whenever you book to apply your member benefits.\n\n` +
    `Billing: ${amt} per ${per}, renewing automatically each ${per} until you cancel.\n` +
    `Cancel any time in your member portal: ${portal}\n` +
    `Cancellation takes effect at the end of your current paid period - you keep\n` +
    `your benefits until then, and no further charges are made. Payments already\n` +
    `made are not refunded for partial periods.\n\n` +
    `Book a bay: ${(cfg.seo?.domain || '').replace(/\/$/, '')}/book\n\n` +
    `See you out there!` });
}


async function sendMembershipPaymentFailed({ to, name, tierName, graceDays }) {
  const cfg = getConfig();
  const portal = `${(cfg.seo?.domain || '').replace(/\/$/, '')}/my-membership`;
  return sendEmail({ to, subject: `Payment issue with your ${tierName} membership - ${cfg.server.businessName}`,
    text: emailTmpl('memFailedIntro', [[['{name}','[Name]'], name], [['{tier}','[Tier]'], tierName], [['{business}','[Business Name]'], cfg.server.businessName]]) + `\n\n` +
    `Your membership benefits continue for now${graceDays ? ` (up to ${graceDays} days)` : ''} while the payment is retried. ` +
    `To update your payment method or manage your membership, visit: ${portal}\n\n` +
    `If you have questions, just reply to this email.` });
}
async function sendMembershipEnded({ to, name, tierName }) {
  const cfg = getConfig();
  return sendEmail({ to: to, subject: `Your ${tierName} membership has ended - ${cfg.server.businessName}`,
    text: emailTmpl('memEndedBody', [[['{name}','[Name]'], name], [['{tier}','[Tier]'], tierName], [['{business}','[Business Name]'], cfg.server.businessName]]) +
    `\n\nYou are welcome back any time - rejoin at ${(cfg.seo?.domain || '').replace(/\/$/, '')}/memberships` });
}
// Annual renewal reminder - required notice before a yearly auto-renewal charge.
async function sendRenewalReminder({ to, name, tierName, renewDate, price }) {
  const cfg = getConfig();
  const portal = `${(cfg.seo?.domain || '').replace(/\/$/, '')}/my-membership`;
  const amt = '$' + (Math.round(price * 100) / 100).toFixed(2);
  return sendEmail({ to: to, subject: `Your ${tierName} membership renews on ${renewDate} - ${cfg.server.businessName}`, text: `Hi ${name},\n\nA reminder that your ${tierName} membership at ${cfg.server.businessName} ` +
    `renews automatically on ${renewDate} for ${amt} for another year.\n\n` +
    `No action is needed to continue. If you do not wish to renew, cancel any time before ` +
    `${renewDate} in your member portal: ${portal}\n` +
    `Cancellation stops future charges; your benefits continue through ${renewDate}.` });
}

async function sendCancellationConfirmed({ to, name, ends }) {
  const cfg = getConfig();
  return sendEmail({ to: to, subject: `Membership cancellation confirmed - ${cfg.server.businessName}`, text: emailTmpl('memCancelIntro', [[['{name}','[Name]'], name], [['{business}','[Business Name]'], cfg.server.businessName]]) + ` Your benefits continue through ` +
    `${ends || 'the end of your current paid period'}, and no further charges will be made.\n\n` +
    `Changed your mind? You are welcome back any time at ${(cfg.seo?.domain || '').replace(/\/$/, '')}/memberships\n\n` +
    `Thanks for being a member.` });
}


/** Generic send for one-off transactional emails, PLAIN TEXT (services/notifycancel). The name says raw; what it takes is
 *  text - a gift card's HTML went through here and arrived as its own markup (the review, Oct 3 2026). */
async function sendRawEmail(to, subject, text) {
  return sendEmail({ to, subject, text });
}
/** An HTML email (the gift card). Answers as sendEmail does: true sent, false failed (logged), undefined no email here. */
async function sendHtmlEmail(to, subject, html) {
  return sendEmail({ to, subject, html });
}

// Waiver renewal reminder (maintainer, Sep 1 2026): a timed membership waiver is
// about to run out - ask for a fresh one before it does. Editable intro,
// locked facts appended.
async function sendWaiverRenewalReminder({ to, name, expiresAt, daysLeft }) {
  const cfg = getConfig();
  const portal = `${(cfg.seo?.domain || '').replace(/\/$/, '')}/my-membership`;
  return sendEmail({ to, subject: `Your liability waiver runs out on ${expiresAt} - ${cfg.server.businessName}`,
    text: emailTmpl('waiverRenewIntro', [[['{name}','[Name]'], name], [['{date}','[Date]'], expiresAt], [['{business}','[Business Name]'], cfg.server.businessName]]) + `\n\n` +
    `Please sign the new one at your next booking or at the counter - it takes a minute. ` +
    `Your current waiver stays on file until ${expiresAt}${daysLeft !== undefined && daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? '' : 's'} from now)` : ''}.\n\n` +
    (cfg.seo?.domain ? `Your member portal: ${portal}\n\n` : '') +
    `If you have questions, just reply to this email.` });
}

module.exports = {
  EMAIL_DEFAULTS,
  emailTmpl, bookingVars, bookingEmailMap,   // so a battery can render a template the way the senders do
  sendWaiverRenewalReminder,
  sendRawEmail, sendHtmlEmail, sendBookingMovedEmail,
  sendMembershipWelcome,
  sendCancellationConfirmed,
  sendMembershipPaymentFailed, sendMembershipEnded, sendRenewalReminder,
  sendEmail,
  sendConfirmationEmail,
  sendReminderEmail,
  sendDoorCodeEmail,
  sendCancellationEmail,
  sendSessionEndingEmail
};
