// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/msgdefaults.js - A SAVED COPY OF A DEFAULT IS NOT THE OWNER'S TEXT (Sep 25 2026)
//
// The pilot facility handoff (20-24 Sep, section 7): the Messaging page shows the product's
// default in every empty box, and Save stored whatever the box showed - so one press of
// Save made the default "the owner's text" word for word, and from then on it never
// followed the product. Here that is worse than stale words: the server sends a STAFFED
// facility door-code-free default emails, but the page's defaults are the door-code
// versions, so a staffed owner who pressed Save told every customer a door code was
// coming. The page now saves a box still showing its default as empty; this is the
// other half, for the copies ALREADY stored on units: a stored text that matches,
// exactly, a default the page has ever shown counts as empty, so it follows the
// product's current default with no owner action.
//
// EVERY DEFAULT THE PAGE HAS EVER SHOWN, per template. It only ever grows: when a
// default's wording changes in public/admin.html, the OLD text is added here, never
// replaced. test-message-defaults fails if the page's current default is missing.
// Built from the git history of public/admin.html (EMAIL_DEFAULTS, every
// commit since the baseline) on Sep 25 2026.
'use strict';
const KNOWN = {
  "email.confirmationBody": [
    "Booking Confirmed - [Business Name]\n--------------------------\nBay:      [Bay]\nDate:     [Date]\nTime:     [Start] - [End]\nDuration: [Duration]\n--------------------------\nYou will receive a reminder and your door code 15 minutes before start time.\n\nSee you soon!",
    "Booking Confirmed - [Business Name]\n--------------------------\nBay:      [Bay]\nDate:     [Date]\nTime:     [Start] - [End]\nDuration: [Duration]\n--------------------------\nYou will receive a reminder and your door code [Code Timing].\n\nSee you soon!",
    "Booking Confirmed - [Business Name]\n--------------------------\n[Space]:      [Bay]\nDate:     [Date]\nTime:     [Start] - [End]\nDuration: [Duration]\n--------------------------\nYou will receive a reminder and your door code [Code Timing].\n\nSee you soon!",
    // Oct 3 2026 (the pack review): no reminder promised - a booking made inside its reminder window, or paid after it,
    // gets none (the confirmation has just told it everything)
    "Booking Confirmed - [Business Name]\n--------------------------\nBay:      [Bay]\nDate:     [Date]\nTime:     [Start] - [End]\nDuration: [Duration]\n--------------------------\nYour door code arrives [Code Timing].\n\nSee you soon!",
    "Booking Confirmed - [Business Name]\n--------------------------\n[Space]:      [Bay]\nDate:     [Date]\nTime:     [Start] - [End]\nDuration: [Duration]\n--------------------------\nYour door code arrives [Code Timing].\n\nSee you soon!"
  ],
  "email.reminderBody": [
    "Reminder - Your session starts soon!\n--------------------------\nBay:  [Bay]\nTime: [Start] - [End]\n--------------------------\nYour door code arrives 15 minutes before start.",
    "Reminder - Your session starts soon!\n--------------------------\nBay:  [Bay]\nTime: [Start] - [End]\n--------------------------\nYour door code arrives [Code Timing]."
  ],
  "email.doorCodeBody": [
    "Your Door Code: [Code]\n--------------------------\nBay:     [Bay]\nSession: [Start] - [End]\nValid today only. Enter on the door keypad."
  ],
  "email.cancellationBody": [
    "Booking Cancelled\nYour session at [Bay] on [Date] at [Start] has been cancelled.\nA refund will be issued if applicable."
  ],
  "email.memWelcomeIntro": [
    "Welcome, [Name]!\n--------------------------\nYour [Tier] membership at [Business Name] is active."
  ],
  "email.memFailedIntro": [
    "Hi [Name],\n\nWe could not process your [Tier] membership renewal payment. Your card will be retried automatically over the next few days."
  ],
  "email.memEndedBody": [
    "Hi [Name],\n\nYour [Tier] membership has ended because the renewal payment could not be completed. No further charges will be made.\n\nIf you believe this is a mistake, reply to this email and we will sort it out."
  ],
  "email.memCancelIntro": [
    "Hi [Name],\n\nYour membership cancellation is confirmed."
  ],
  "email.waiverRenewIntro": [
    "Hi [Name],\n\nThe liability waiver on file with your membership at [Business Name] runs out on [Date]."
  ]
};
const norm = t => String(t == null ? '' : t).replace(/\r\n/g, '\n').trim();
const SETS = Object.fromEntries(Object.entries(KNOWN).map(([k, v]) => [k, new Set(v.map(norm))]));
/** true when text is exactly one of the defaults the page has shown for section.key */
function isKnownDefault(section, key, text) { const s = SETS[section + '.' + key]; return !!(s && text && s.has(norm(text))); }
/** the owner's own text, or '' when what is stored is only a copy of a default */
function own(section, key, text) { return text && !isKnownDefault(section, key, text) ? text : ''; }
module.exports = { KNOWN, isKnownDefault, own };
