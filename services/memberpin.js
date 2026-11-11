// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/memberpin.js - ONE MEMBER PIN GENERATOR (Sep 25 2026, the UniFi member work, point 8)
//
// There were two: the admin's (routes/members.js) followed the unit's PIN Length and used
// crypto; the online join's (services/membership-join.js) was always six digits and used
// Math.random. On a UniFi facility whose PIN Length was not 6 the two disagreed, and the
// console accepts one length only. Every member PIN is made here now: the length the door
// dispatcher says (doorlock.doorPinLength - six anywhere but a UniFi unit set otherwise),
// crypto, no trivial patterns, and never one another member already holds. `avoid` adds PINs
// the door console refused, so a re-pick never offers the same one again.
'use strict';
const crypto = require('crypto');

const TRIVIAL = ['1234', '4321', '123456', '654321', '12345678', '87654321'];

function generate(avoid) {
  const len = require('./doorlock').doorPinLength();
  const lo = Math.pow(10, len - 1), span = lo * 9;
  const skip = new Set((avoid || []).map(String));
  const D = require('./db').db;
  for (let attempt = 0; attempt < 200; attempt++) {
    const pin = String(lo + crypto.randomInt(0, span));
    if (/^(\d)\1+$/.test(pin) || TRIVIAL.includes(pin) || skip.has(pin)) continue;
    if (!D.prepare(`SELECT id FROM members WHERE pin=?`).get(pin)) return pin;
  }
  throw new Error('Could not generate a unique member PIN after 200 attempts');
}

module.exports = { generate };
