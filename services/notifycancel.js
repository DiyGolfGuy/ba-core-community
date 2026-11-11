// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// services/notifycancel.js - THE CANCELLATION THE CUSTOMER DID NOT ASK FOR
// (maintainer, Sep 19 2026, the redirect review).
//
// Every other way a booking ends tells the person: a staff cancel, a customer
// cancel, an edit. The one ending nobody initiated - the checkout sweeper
// refunding a paid booking it cannot deliver - was silent. The money went back
// correctly and the customer was told nothing, so they turned up expecting a
// bay. This is the one place that says so.
//
// Rule 31: a facility with no email and no texting is not a failure here - it
// simply has nothing to send with, and returns skipped.
'use strict';

async function tellCustomerRefunded(booking, reason) {
  const out = { emailed: undefined, texted: undefined };
  const money = c => '$' + ((Number(c) || 0) / 100).toFixed(2);
  const when = `${booking.date} at ${booking.start_time}`;
  const body =
    `Your booking for ${when} could not go ahead, and you have been refunded in full`
    + ` (${money(booking.price_cents)}).\n\n`
    + `What happened: ${reason}.\n\n`
    + `Nothing is owed and there is nothing you need to do - the refund is on its way back to`
    + ` the card you paid with. You are welcome to book another time whenever suits you.`;

  try {
    const email = require('./email');
    if (booking.email && email && typeof email.sendRawEmail === 'function') {
      out.emailed = !!(await email.sendRawEmail(
        booking.email, 'Your booking could not go ahead - you have been refunded', body));
    }
  } catch (e) { out.emailed = false; }

  // The product's OWN cancellation sender, so the owner's wording, their on/off
  // switch and the customer's consent all still govern it (rule W36: sendSMS
  // refuses an opted-out number before any provider is touched).
  try {
    const sms = require('./sms');
    if (booking.phone && sms && typeof sms.sendCancellation === 'function') {
      out.texted = !!(await sms.sendCancellation(booking));
    }
  } catch (e) { out.texted = false; }

  return out;
}

module.exports = { tellCustomerRefunded };
