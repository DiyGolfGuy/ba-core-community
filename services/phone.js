// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/phone.js - ONE PHONE SHAPE (Sep 25 2026, the pilot facility handoff section 6)
//
// Online bookings stored +1 and ten digits; the counter's walk-ins and the owner's member
// records stored whatever was typed - "202-555-0147", "(202) 555-0147" - so the customer's
// own lookup by phone, the member PIN text and the door-code text all missed the people
// staff had typed in. Every place a phone is stored for a person calls this now. Ten digits
// (or eleven starting 1) become +1 and ten digits; a number already in +international form
// keeps it; anything else is kept as typed - it is not a number this unit can text, and
// guessing at it would be worse than leaving it for a person to read.
'use strict';

function normalize(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (s.startsWith('+') && d.length >= 11 && d.length <= 15) return '+' + d;
  return s;
}

/** The digits a person would search by, for matching however it was typed. */
function digits(raw) { const d = String(raw || '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d; }

module.exports = { normalize, digits };
