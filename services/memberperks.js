// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/memberperks.js — MEMBERSHIP FOLLOWS THE PERSON (maintainer, Aug 11).
//
// "Say someone comes in with a member friend... the server types the friend's
//  code in... Now when they add time later that person is stated as a member
//  so all his time should include his discount. Plus his drink or food
//  specials if that is included in his membership."
//
// VERIFIED FIRST: seats.member_id already exists, so the system ALREADY
// remembers who is a member for the whole session - the code typed in at the
// counter is not forgotten after check-in. What was missing is USING it
// afterwards: extra time was priced at the standard rate, and food and drink
// perks did not exist at all.
'use strict';

const dbM = require('./db');

function D() { return dbM.db; }

/** Golf + food + drink benefits for one member, or null. */
function perksForMember(memberId) {
  if (!memberId) return null;
  const row = D().prepare(
    `SELECT m.id, m.name, m.status,
            t.name AS tier_name, t.discount_type, t.discount_value,
            t.food_discount_type, t.food_discount_value,
            t.beverage_discount_type, t.beverage_discount_value
       FROM members m JOIN membership_tiers t ON t.id = m.tier_id
      WHERE m.id = ?`
  ).get(memberId);
  if (!row) return null;
  if (row.status && row.status !== 'active') return null;   // lapsed = no perks
  return {
    member_id: row.id, name: row.name, tier_name: row.tier_name,
    golf: { type: row.discount_type || '', value: Number(row.discount_value || 0) },
    food: { type: row.food_discount_type || '', value: Number(row.food_discount_value || 0) },
    beverage: { type: row.beverage_discount_type || '', value: Number(row.beverage_discount_value || 0) }
  };
}

/** The member sitting behind a tab, if any (seats own their tab). */
function perksForTab(tabId) {
  if (!tabId) return null;
  try {
    const seat = D().prepare(`SELECT member_id FROM seats WHERE tab_id = ? LIMIT 1`).get(tabId);
    return seat ? perksForMember(seat.member_id) : null;
  } catch { return null; }
}

/** Golf discount as a percentage (fixed amounts do not apply to golf shares). */
function golfPct(perks) {
  if (!perks || !perks.golf) return 0;
  if (perks.golf.type === 'percentage' || perks.golf.type === 'percent') {
    return Math.max(0, Math.min(100, perks.golf.value));
  }
  return 0;
}

/**
 * What a menu line costs this member. Returns the discounted unit price and
 * a human reason for the receipt, or null when no perk applies.
 *
 * Tax categories map to the two perk buckets: 'beverage' takes the drink
 * benefit, everything else takes the food benefit. A discount can never
 * take a line below zero.
 */
function priceForMember(unitCents, taxCategory, perks) {
  if (!perks || !(unitCents > 0)) return null;
  const bucket = (taxCategory === 'beverage') ? perks.beverage : perks.food;
  if (!bucket || !bucket.type || !(bucket.value > 0)) return null;

  let off = 0, label = '';
  if (bucket.type === 'percent' || bucket.type === 'percentage') {
    off = Math.round(unitCents * Math.min(100, bucket.value) / 100);
    label = `${perks.tier_name} ${bucket.value}% off`;
  } else if (bucket.type === 'fixed') {
    off = Math.round(bucket.value * 100);
    label = `${perks.tier_name} $${Number(bucket.value).toFixed(2)} off`;
  } else return null;

  off = Math.max(0, Math.min(unitCents, off));
  if (!off) return null;
  return { unit_cents: unitCents - off, saved_cents: off, reason: label };
}

module.exports = { perksForMember, perksForTab, golfPct, priceForMember };
