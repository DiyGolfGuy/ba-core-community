// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/assistant/quickcards.js - WHAT AN OWNER CAN ASK, FITTED TO HOW THEIR FACILITY RUNS (Oct 25 2026;
//  branch feature/ai-edition)
//
//  maintainer, Oct 25 2026: "make sure you give em quick cards like once they're set up, it can ask check who's playing right now. How many
//  members do you have? How much did you make this month? ... They won't be asking, you know anything for a p o s system or employee
//  schedules? So just make sure we have quick cards about what facilities can ask the AI later. So they know what they can do, and it
//  pertains to that facility. And how they run"; and: "new facility owners might not know what they can ask. Or what the ai chat can
//  do? ... directing a conversation when they open it up ... who's playing now? How many members do I have? Did anyone sign up this
//  week? You know, year over year, have we grown? Do we have more members? You know, what are our prices for members? ... they need
//  to be guided early on".
//
//  So, once the setup no longer leads the chat:
//   - the cards: questions to tap, in the owner's own voice, only the ones that fit the facility (no staff schedule on a facility
//     nobody works at, no counter menu without a counter, no members' questions without members). Each one is a question the box
//     answers from its own records - engine.js EVERYDAY runs the read before the model says a word (test-assistant A63 holds every
//     card to exactly one read);
//   - "what can you do?": the box's own answer, the same way - what this facility can ask and have done, never a list read from
//     every tool there is (the 4B named the counter menu and the staff schedule to a club with neither);
//   - one line for the model's brief saying how the facility runs, so its own answers fit it too.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

/** How the facility runs, from its settings and its own names (engine.js facilityNames). */
function shapeOf(cfg, names) {
  const b = (cfg && cfg.booking) || {}, n = names || {};
  let style = 'unmanned';
  try { style = require('../staffing').accessStyleOf(b); } catch { style = b.staffedAccess ? 'staffed' : 'unmanned'; }
  const tiers = (n.tiers || []).filter(Boolean), staff = (n.staff || []).filter(Boolean), menu = (n.menu || []).filter(Boolean);
  return {
    style, membersOnly: !!b.membersOnly, whole: !!b.wholeFacility, open24: !!b.open24Hours,
    members: !!b.membersOnly || tiers.length > 0,
    staffed: style !== 'unmanned', hybrid: style === 'hybrid', doors: style !== 'staffed',
    staff: style !== 'unmanned' && staff.length > 0, counter: style !== 'unmanned' && menu.length > 0,
    specials: (n.specials || []).filter(Boolean).length > 0, guests: Number(n.guestTiers) > 0,
    business: String(((cfg || {}).server || {}).businessName || '').trim(),
    // what the owner has asked the box most, by the read that answered it (services/study.js askCounts) - the cards they ask most lead
    counts: Object.assign({}, n.counts || {}),
  };
}

// EVERY WAY A FACILITY RUNS (maintainer, Oct 25 2026: "really hit and walk all the different facilities. Staffed not staffed, food no food,
// hybrid, 24/7 members only. Hybrid members and non members ... tailor there AI to them for the right questions to ask"): each card
// is the words the owner taps (said as an owner says them), the read that answers it, the facilities it fits, and where it goes in
// the row for that facility (lower first) - a members' club leads with its members (maintainer's six), a place with a counter with its
// staff and its menu; the row scrolls, so each facility gets all of its own
const CARDS = [
  { say: 'Who\'s playing right now?', read: 'playing_now_read', at: () => 10 },
  { say: 'How many members do we have?', read: 'members_report_read', when: (s) => s.members, at: (s) => (s.membersOnly ? 20 : 60) },
  { say: 'Did anyone sign up this week?', read: 'members_growth_read', when: (s) => s.members, at: (s) => (s.membersOnly ? 21 : 61) },
  { say: 'More members than last year?', read: 'members_growth_read', when: (s) => s.members, at: (s) => (s.membersOnly ? 22 : 62) },
  { say: 'What are our prices for members?', read: 'tiers_read', when: (s) => s.members, at: (s) => (s.membersOnly ? 23 : 63) },
  { say: 'How much did we make this month?', read: 'revenue_read', at: () => 30 },
  { say: 'What\'s booked today?', read: 'bookings_read', at: (s) => (s.membersOnly ? 31 : 20) },
  { say: 'Which days are staffed this week?', read: 'staffed_read', when: (s) => s.hybrid, at: (s) => (s.membersOnly ? 32 : 25) },
  { say: 'Who\'s working today?', read: 'schedule_read', when: (s) => s.staff, at: () => 40 },
  { say: 'What\'s on the menu?', read: 'menu_read', when: (s) => s.counter, at: () => 45 },
  { say: 'What specials are running?', read: 'counter_specials_read', when: (s) => s.counter, at: () => 46 },
  { say: 'Did our specials work?', read: 'specials_effect_read', when: (s) => s.specials, at: () => 47 },
  { say: 'Busiest and slowest months?', read: 'trends_read', at: () => 69 },
  { say: 'Are we busier than last month?', read: 'insights_read', at: () => 70 },
  { say: 'What sold best this week?', read: 'insights_read', when: (s) => s.counter, at: () => 71 },
  { say: 'Who\'s clocked in?', read: 'clock_read', when: (s) => s.staff, at: () => 72 },
  { say: 'Any time-off requests?', read: 'requests_read', when: (s) => s.staff, at: () => 73 },
  { say: 'Any deals running?', read: 'deals_read', when: (s) => !s.membersOnly, at: () => 75 },
  // (after maintainer's own six for a members' club - who is playing, the members, the sign-ups, against last year, their prices, the month's
  // money: his words, Oct 25 2026 - and after today's bookings and the staffed days)
  { say: 'Who are our top members?', read: 'top_members_read', when: (s) => s.members, at: (s) => (s.membersOnly ? 33 : 64) },
  { say: 'How many guests do members bring?', read: 'member_guests_read', when: (s) => s.members && s.guests, at: (s) => (s.membersOnly ? 34 : 65) },
  { say: 'What does a group spend at the counter?', read: 'counter_spend_read', when: (s) => s.counter, at: () => 48 },
  { say: 'Are customers coming back?', read: 'customers_read', when: (s) => !s.membersOnly, at: () => 66 },
  { say: 'Is everything working?', read: 'health_read', at: () => 80 },
  { say: 'Any new messages?', read: 'inbox_read', at: () => 90 },
];
const MORE = 'What else can you do?';
const INTRO = 'A few things you can ask me - tap one, or ask in your own words:';
const plainOf = (t) => String(t || '').toLowerCase().replace(/[\u2018\u2019]/g, '\'').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The cards for a facility, in its own order, leaving out the ones already asked (their words, as said): [words]. */
// (maintainer, Oct 25 2026: "The AI over time should know what the facility owner asks most frequently": a question asked three times or
// more leads the row, the most asked first)
const OFTEN = 3;
function cards(shape, asked, max) {
  const done = new Set([...(asked || [])].map(plainOf)), s = shape || {}, n = (c) => { const k = Number((s.counts || {})[c.read]) || 0; return k >= OFTEN ? k : 0; };
  return CARDS.map((c, i) => [c, i]).filter(([c]) => (!c.when || c.when(s)) && !done.has(plainOf(c.say)))
    .sort((x, y) => n(y[0]) - n(x[0]) || x[0].at(s) - y[0].at(s) || x[1] - y[1]).slice(0, max || 6).map(([c]) => c.say);
}

// (the box's own words for what a card's read found live in answers.js - every everyday read, not only the cards')
/** The box's own words for a card's read, or null. */
function fast(read, out) { return require('./answers').say(read, out); }
function cardOf(words) { const w = plainOf(words); return CARDS.find(c => plainOf(c.say) === w) || null; }

// "what can you do?", "what else can you do", "what can i ask you", "how can you help" - the whole message, nothing more asked
const ASK_CAN_DO = /^\s*(?:(?:so|ok(?:ay)?|and|hey|hi)[,\s]+)?(?:what (?:else )?(?:can|could) (?:you|u) (?:do|help (?:me |us )?with)(?: for (?:me|us))?|what (?:else )?(?:can|should) (?:i|we) ask(?: you)?|what (?:kind of |sort of )?(?:things|stuff|questions) (?:can|could) (?:i|we) ask(?: you)?|how (?:can|could) (?:you|u) help(?: me| us)?|what do (?:you|u) do)\s*[?.!]*\s*$/i;

/** The box's own answer to "what can you do?": the lines that fit this facility, every one of them something the chat can do. */
function canDo(shape, tap) {
  const s = shape || {}, place = s.whole ? 'the facility' : 'a bay';
  const lines = [
    `Who is playing right now, and what is booked today, tomorrow or any day`,
    s.members && 'Your members: how many there are, who signed up, how you compare with last year, and one member\'s details and play',
    s.members && 'Add a member, move one to another membership, pause one or end one',
    s.members && 'Your memberships: what each costs and includes, a price change, or a new one',
    'Money: what came in today, this week, this month or this year, and the tax collected',
    'How busy you are against last month or last year; your busiest and slowest months, and how you have grown',
    !s.membersOnly && 'Your customers: how many come back, what they spend a visit, who comes most',
    s.members && 'Your top members: who plays most and how often' + (s.guests ? ', and the guests members bring' : ''),
    s.counter && 'What a group spends at the counter - food and drink - and what sells most',
    s.specials && 'Whether a special brought more in: its days against the same days before it',
    `Bookings: make one, move one, cancel one, or block off ${place}`,
    s.hybrid && 'Your staffed hours: which days and hours someone is there, and changing them',
    s.staffed && 'Your staff: the schedule, who is working, who is clocked in, time-off requests',
    s.counter ? 'The counter: the menu, prices, specials, what sold best, and gift cards' : s.staffed && 'The counter: gift cards, and a food and drink menu whenever you want one',
    !s.membersOnly && 'Deals and discount codes',
    'The bays: turn them on or off, or restart a computer',
    s.doors && 'The door: how long before and after a booking a code works',
    'Your hours, prices and booking rules',
    'Your website: its words, photos, colours and pages',
    'Messages people sent from your website',
    'Whether everything is working - backups, updates and the bays',
  ].filter(Boolean);
  return `Here is what you can ask me${s.business ? ' about ' + s.business : ''} - in your own words, any time:\n` + lines.map(l => '- ' + l).join('\n') + (tap ? '\n\nTap one below to try it.' : '');
}

/** One line for the model's brief: how the facility runs, so its own answers fit it. */
function facilityLine(shape) {
  const s = shape || {};
  const parts = [s.membersOnly ? 'members only (only members can book)' : s.members ? 'open to the public, with memberships' : 'open to the public',
    s.style === 'staffed' ? 'someone always works there' : s.style === 'hybrid' ? 'staffed some hours, door codes the rest' : 'nobody works there - people let themselves in with door codes',
    s.staffed ? (s.counter ? 'a counter with food and drink' : 'no food or drink menu') : null,
    s.whole ? 'one booking takes the whole facility' : 'customers book a bay', s.open24 ? 'open 24 hours' : null].filter(Boolean);
  const not = !s.staffed ? ' It has no staff and no counter: never offer a staff schedule, the counter menu or counter payments unless the owner asks.'
    : !s.counter ? ' It has no food or drink menu yet: never offer the counter menu unless the owner asks.' : '';
  return `How ${s.business || 'the facility'} runs: ${parts.join('; ')}.${not}`;
}

module.exports = { CARDS, MORE, INTRO, ASK_CAN_DO, OFTEN, shapeOf, cards, cardOf, canDo, facilityLine, fast };
