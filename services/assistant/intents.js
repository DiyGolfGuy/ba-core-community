// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/assistant/intents.js - THE OWNER'S PLAIN COMMANDS, READ BY THE BOX ITSELF (Oct 25 2026; branch
//  feature/ai-edition)
//
//  maintainer, Oct 25 2026: "run the commands you have been that dont even need AI just standard things people ask and direct them so just
//  keep making that stronger. Basically in a sense we are building our own AI in a way just with hard code"; then: "we need 95%
//  accuracy before we deploy. On both model and box hard code. The 4b and 8b should be able to pick up the slack. Or ask what did you
//  mean? If it didn't fully understand and it has a cpl options".
//
//  Each intent is one plain way an owner says one change ("turn on Bay 2", "we're out of the wings", "make the base price $25 a half
//  hour") and the action it is, its fields filled from the owner's own words. The box reads the words BEFORE the model (engine.js, BOX
//  FIRST): one intent that understands them is put up at once - the same card the model's call would make, through the same checks,
//  and anything about money, doors, hours or staff is still said back for the owner's yes. Where the words could mean two or three
//  things the box asks which, with each to tap ("Did you mean ...?"). Where none understands them, the model takes them as before.
//  A name (a bay, a menu item) counts only when it is exactly one of the facility's own; otherwise the box asks which, or leaves it.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

const norm = (t) => String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[.!]+\s*$/, '').replace(/\s+/g, ' ').trim();
const plain = (t) => ' ' + norm(t).replace(/['’]s\b/g, '').replace(/[^a-z0-9$%. ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
const money = (v) => Math.round(Number(String(v).replace(/[$,]/g, '')) * 100) / 100;

// one of the facility's own names in a phrase: exactly one match (the longest wins over one inside it - "Bay 1" in "Bay 10"), or null
// (a name's own leading "the" - "The Vault" - matches with or without it: "turn on vault", "turn on the vault")
const core = (x) => plain(x).replace(/^ the /, ' ');
function oneOf(names, phrase) {
  const t = core(phrase), hits = (names || []).filter(Boolean).filter(n => t.includes(core(n)) || (core(n).trim().endsWith('s') ? false : t.includes(core(n + 's'))));
  const best = hits.filter(n => !hits.some(o => o !== n && core(o).includes(core(n))));
  return best.length === 1 ? best[0] : null;
}
const H = require('./helpers');
// a day as said - today, tomorrow, (this|next) a weekday - for the action to read. Today's own weekday said alone ("Sunday" on a
// Sunday) is put up as said, and the engine asks which one with both dates to tap (engine.js sameWeekday - maintainer, Oct 24 2026: "maybe
// ask what Saturday and put a date to chose from"; Oct 25: "verify everything else if it thinks 2 things") - one question, the same
// whoever read the words
const DAYW = '(today|tonight|tomorrow|(?:this |next )?(?:mon|tues|wednes|thurs|fri|satur|sun)day)';
function dayOf(w) {
  const t = String(w || '').toLowerCase().trim(); if (!t) return null;
  return t === 'tonight' ? 'today' : t;
}
// a time as said - "7" at a golf facility is 7 PM unless the morning is said (the brief's own rule); "7:30pm", "noon"
function timeOf(w) {
  const t = String(w || '').toLowerCase().replace(/\bnoon\b/, '12pm').replace(/\bmidnight\b/, '12am'), m = t.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?$/); if (!m) return null;
  let h = Number(m[1]); if (h > 23) return null;
  if (m[3]) { if (/^p/.test(m[3]) && h < 12) h += 12; if (/^a/.test(m[3]) && h === 12) h = 0; } else if (h >= 1 && h <= 11) h += 12;
  return String(h).padStart(2, '0') + ':' + (m[2] || '00');
}
// A BARE 9, 10 OR 11 IS SAID FOR EITHER END OF THE DAY (Oct 25 2026, the review: "book Sam Lee ... saturday at 10 for two hours" was put up
// as 10 PM to midnight, and "add an event: Scramble on saturday at 9" went on the public site as 9 PM): "Tonight" says which ({ time } at
// night); otherwise both come back and the owner is asked, each to tap - never picked. { time } | { both: [morning, evening] } | null
// (THE BARE-HOUR RULE - Oct 27 2026: this was its own rule, "a bare 1 to 8 is the evening", so "book ... saturday at 7 for 2 hours" went up
// as 7 PM at a place that opens at 7 AM, and the hours that would have made it certain were never read. Now the one rule, helpers.clockAtWords,
// with the facility's hours the engine loads first: a day-part word attached ("tonight at 8", "saturday morning at 9"), or - with none
// anywhere - the one half of the day the place is open then; otherwise both, asked)
function clockAt(raw, words, ctx, day) {
  if (!timeOf(raw)) return null;
  const r = H.clockAtWords(words, raw, ctx && ctx.hours, { day }); if (!r) return null;
  return r.time ? { time: r.time } : { both: r.ask, noon: !!r.noon };
}
// the weekday key of a day as said ("saturday", "tomorrow", "today") - for the hours that day keeps
const dayKeyOf = (d, today) => { const iso = today ? H.normDate(d === 'tonight' ? 'today' : d, today) : null; return iso ? H.DAY_KEYS[new Date(iso + 'T12:00:00Z').getUTCDay()] : null; };
// (the owner's own words again with the hour said for one half of the day - "... saturday at 10am for two hours" - for the box's "in the
// morning, or at night?" question: each choice reads back through the same rule as the change it stands for. Until Oct 27 2026 the choices
// were the two calls, labelled by the action's own words on the raw "saturday" - a booking with no bay threw and both choices were labelled
// "booking_make", so either tap gave the morning; an event read "Invalid Date". The review of the Oct 25 fix)
function withHalf(raw, at, half) {
  const esc = String(at).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = String(raw).trim().replace(/[.!]+$/, '').replace(new RegExp(`\\bat\\s+${esc}\\b(?!\\s*(?:am|pm|:))`, 'i'), `at ${String(at).trim()}${half}`);
  return out !== String(raw).trim().replace(/[.!]+$/, '') ? out : null;
}
// (the same for a word in place of the hour - "... saturday at noon", "... at midnight" - for an event at a bare 12: Oct 27 2026)
function withWord(raw, at, word) {
  const esc = String(at).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), was = String(raw).trim().replace(/[.!]+$/, '');
  const out = was.replace(new RegExp(`\\bat\\s+${esc}\\b(?!\\s*(?:am|pm|:))`, 'i'), `at ${word}`);
  return out !== was ? out : null;
}
// AN EVENT'S START, AS SAID (Oct 27 2026 - maintainer: "a bare 10 asks morning or night"; the review: an event at a bare 8 or 9 went on the public
// page as the evening): "am", "pm", "noon", "midnight" or a 24-hour clock are as said; otherwise THE BARE-HOUR RULE (helpers.clockAtWords),
// the event's own name attached - "League Night at 7" is 7 PM, "the Saturday Morning Scramble at 6" 6 AM - or the one half of the day the
// place is open then; otherwise asked, both to tap - noon or midnight for a bare 12. { time } | { both: true } | { noon: true } | null
// (Oct 27 2026, the review of round 2c: its own word list read "late" as the night - "the Late Summer Scramble at 10" went on the Events page
// as 10 PM, unasked - and a bare 1 to 6 as the evening whatever the name said, "the Saturday Morning Scramble at 6" as 6 PM. "Late" is no
// day-part word; the name's own morning counts at every hour)
function eventClock(raw, name, words, ctx, day) {
  const r = H.clockAtWords(words, raw, ctx && ctx.hours, { name, day }); if (!r) return null;
  return r.time ? { time: r.time } : r.noon ? { noon: true } : { both: true };
}
// a period said as words, as the first and last dates (the records' own facility day)
function periodDates(w, today) {
  if (!today) return null; const d = new Date(today + 'T12:00:00Z'), y = d.getUTCFullYear(), mo = d.getUTCMonth(), iso = (x) => x.toISOString().slice(0, 10);
  const day = (yy, mm, dd) => iso(new Date(Date.UTC(yy, mm, dd, 12)));
  if (w === 'this month') return { from: day(y, mo, 1), to: today };
  if (w === 'last month') return { from: day(y, mo - 1, 1), to: day(y, mo, 0) };
  if (w === 'this year') return { from: day(y, 0, 1), to: today };
  if (w === 'last year') return { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) };
  const back = (d.getUTCDay() + 6) % 7, mon = H.addDays(today, -back);   // a week from Monday, as the records count it
  if (w === 'this week') return { from: mon, to: today };
  if (w === 'last week') return { from: H.addDays(mon, -7), to: H.addDays(mon, -1) };
  return null;
}
// a time range and nothing else ("noon to 6", "from 10 in the morning to 10 at night"): a longer tail - "4 to 11 and Robin on Sunday",
// "10 to 6 except lunch" - is more than one change or a condition, and goes to the model whole, never read in part
const T1 = '(?:\\d{1,2}(?::[0-5]\\d)?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|noon|midnight)(?: in the morning| in the evening| at night)?';
const RANGE_ONLY = new RegExp(`^(?:from )?${T1}\\s*(?:to|till|til|until|-)\\s*${T1}$`);
const rangeOnly = (w) => { const t = String(w || '').trim().replace(/[.!]+$/, ''); return RANGE_ONLY.test(t) ? H.rangeIn(t) : null; };
// (a shift or a staffed day to midnight ends at 23:59 - both refuse an end of 00:00 as "past midnight", and a staffed day's own words say
// "midnight is 23:59"; "6 to 12" and "6 to midnight" read to 00:00, which a block takes as the end of the day - Oct 25 2026)
const dayEnd = (r) => (r && r.to === '00:00' ? { from: r.from, to: '23:59' } : r);
// the facility's own messages, by the words an owner uses for them (actions message_switch_set / message_words_set)
const MSG_SWITCH = { confirmation: 'confirmation', reminder: 'reminder', 'door code': 'door_code', cancellation: 'cancellation', 'session ending': 'session_ending', 'booking changed': 'booking_changed' };
const MSG_WORDS = [[/^(?:booking )?confirmation$/, 'confirmation'], [/^reminder$/, 'reminder'], [/^door ?code$/, 'door_code'], [/^cancell?ation$/, 'cancellation'], [/^(?:session )?ending(?: warning)?$/, 'ending_warning'],
  [/^next group(?: warning)?$/, 'next_group_warning'], [/^(?:member )?welcome$/, 'member_welcome'], [/^(?:member )?payment failed$/, 'member_payment_failed'], [/^membership ended$/, 'membership_ended'],
  [/^membership cancell?ed$/, 'membership_cancelled'], [/^waiver renewal$/, 'waiver_renewal']];
function msgKey(name, how) {
  const n = norm(name).replace(/^(?:the|our)\s+/, ''), e = /^e/.test(how), hit = MSG_WORDS.find(([re]) => re.test(n)); if (!hit) return null;
  const key = hit[1] + (e ? '_email' : '_text');
  try { const p = require('./actions').BY_NAME.get('message_words_set').params.properties.message.enum; return p.includes(key) ? key : null; } catch { return null; }
}
// (a possessive's s stays small - "Father's Day Scramble", never "Father'S" on the public Events page, as every title with 's read until
// Oct 27 2026; a name's own letter after the mark - O'Brien, D'Angelo - is still a capital)
// (and every other contraction's ending too - "Don't Miss Scramble", "The We're Back Bash", "I'm In", "Y'all": "Don'T" and "We'Re" were
// what the page showed, Oct 27 2026. Only an ending a contraction has - s, t, re, ve, ll, d, m, all - is kept small; "O'Brien" is not one)
const title = (w) => String(w || '').trim().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/([A-Za-z]['’])(S|T|Re|Ve|Ll|D|M|All)\b/g, (x, a, b) => a + b.toLowerCase());
const staffNames = (ctx) => ((ctx.facilityNamesNow || {}).staff || []).filter(Boolean);
const tierNames = (ctx) => ((ctx.facilityNamesNow || {}).tiers || []).filter(Boolean);
const bayNames = (ctx) => (ctx.bays || []).filter(b => b && b.name && b.active !== false).map(b => b.name);
// the name and nothing else that changes what is meant: "Bay 2", "the Vault please", "bay 2, we're done for the night" - never "Bay 2
// at 10pm", "Bay 2 and the TV", "Bay 2 tomorrow" (those are the model's: a time, a second thing, a condition)
const FILLER = /\b(?:the|please|now|right now|for me|for us|for the (?:night|day)|we ?'?re done(?: with it)?|we are done(?: with it)?|for good|our|my)\b/g;
function only(name, phrase) { const left = core(phrase).replace(core(name), ' ').replace(FILLER, ' ').replace(/[,.]/g, ' ').trim(); return !left; }
// what may follow "take Bay 3 out of service" and change nothing it means (Oct 25 2026): a reason ("the projector is broken") or a polite
// word - never a day, a time, a length or a condition. Those make it a few hours' block or a later change, which is the model's (the action
// itself says "for a few hours or days, a block on the bookings side fits better" - areas/bays.js)
const WHEN = new RegExp(`\\b(?:${DAYW.slice(1, -1)}|until|till|til|through|thru|for|from|between|after|before|next|this|week|weekend|month|hours?|minutes?|mins?|days?|morning|afternoon|evening|night|noon|midnight|am|pm|at|on|but|unless|if|when|while|whilst|during|once|as soon as|as long as|meanwhile|and|then|also|again|back|later|soon|starting)\\b|\\d`);
// (a reason READS AS A FAULT - Oct 27 2026, the review of the Oct 25 fix: "take bay 1 out of service during the tournament" and "... once the
// session ends" were put up as out of service from now on with no end, because the check was a list of what may NOT follow and these were
// not on it. Now what follows must say what is wrong with the bay - broken, down, not working, cracked, leaking ... - and nothing about when;
// anything else is the model's)
// (and the ordinary ways a fault is said that the first list did not hold - Oct 27 2026, the review of the allowlist below: "keeps
// crashing", "died", "is jammed", "is having issues", "has a tear", "is under maintenance", "is getting repaired", "went black" ... each
// went to the model; none says when)
const FAULT = /\b(?:broken|broke|down|dead|died|dying|out of (?:order|commission)|out|not working|isn'?t working|is not working|doesn'?t work|does not work|(?:won'?t|can'?t|cannot|will not) (?:work|start|turn on|boot|load|connect|open|power on|power up|calibrate|track|read|register|pick up)|cracked|smashed|torn|ripped|damaged|busted|leak(?:s|ing|y)?|faulty|glitch(?:y|ing|es)?|acting up|frozen|freezing|freezes|stuck|jam(?:med|s|ming)?|crash(?:es|ed|ing)?|error|errors|problem|problems|issue|issues|trouble|for (?:repairs?|maintenance|servicing|a repair)|repairs?|fixing|(?:being|getting) (?:fixed|repaired|replaced|serviced)|needs? (?:fixing|a repair|repairs?|a new \w+|replacing|replacement|servicing|to be (?:fixed|repaired|replaced|serviced))|maintenance|malfunction(?:s|ing|ed)?|unresponsive|not responding|missing|stolen|flickering|blurry|blank|went (?:dark|black|blank)|no (?:power|signal|picture|sound|image|display|internet|wifi)|shot|lagg(?:y|ing)|overheat(?:s|ed|ing)?|smoking|sparking|short(?:ed| circuited)|loose|bent|shattered|chipped|dented|warped|scratched|worn(?: out)?|tears?|holes?|cracks?|rips?|dents?|fell(?: (?:down|off|apart))?|fallen|came (?:off|down|loose|apart|unplugged)|flood(?:ed|ing)?|unplugged|burnt|burned|fried|tripped|offline|off ?line|not (?:turning|coming|powering) on|not (?:tracking|reading|registering|picking up|calibrat(?:ed|ing)|connecting|loading|booting|charging))\b/;
// (EVERY WORD OF THE REASON IS ONE THE BOX KNOWS - Oct 27 2026, the review of the fix above: "whenever the projector is down", "any time
// the pc is frozen", "every time the pc is frozen" and "in case the screen is cracked" each held a fault and no word of WHEN's, so they were
// put up as out of service from now on with no end - a list of what may not follow always misses one. Now what follows is read word by
// word: each must be a fault's own (FAULT), a part of a bay that can have one (GEAR), or one of the small words that join them ("the
// projector is broken", "because the pc won't turn on", "there's a problem with the screen", "the projector's bulb is out"). Any other word
// - a condition, a time, a name, a typo - and the model has the whole)
// (and the parts and the simulators' own names the first list did not hold - Oct 27 2026, the review of the allowlist: "the golfzon is
// down", "full swing is down", "the projector lens is cracked", "the display is broken", "the keypad is broken", "the projector mount is
// broken", "the screen is ripped down the middle", "the curtain is torn", "the ball return is broken" went to the model. A part's place
// on it - the middle, the side, the top - is not a "when" either)
const GEAR = 'projectors?|projecters?|screens?|pcs?|computers?|simulators?|sims?|software|launch|monitors?|cameras?|sensors?|mats?|hitting|putting|turf|nets?|netting|enclosure|impact|tvs?|television|ac|a/c|air|conditioning|conditioner|heater|heat|heating|hvac|lights?|lamps?|bulbs?|lens|lenses|displays?|keypads?|controllers?|curtains?|mounts?|brackets?|stand|tripod|tray|feeder|return|tiles?|panels?|padding|pads?|frame|vents?|bumpers?|baffles?|overhead|wires?|wiring|batter(?:y|ies)|power|outlets?|plugs?|keyboard|mouse|tablet|ipad|remote|speakers?|sound|audio|wifi|internet|network|cables?|cords?|hdmi|fan|carpet|floor|green|tee|auto|ceiling|roof|door|lock|wall|window|glass|chair|table|toilet|pipes?|balls?|clubs?|shank|rack|bay|unit|system|machine|thing|everything|middle|side|corner|top|bottom|edge|center|centre|left|right|front|trackman|foresight|gcquad|gc3|skytrak|uneekor|flightscope|mevo|gspro|e6|connect|golfzon|full|swing|fullswing|trugolf|aboutgolf|tgc|bushnell|garmin|rapsodo|protee|eye|xo|eyexo';
// (and who did it - "someone broke the screen", "a kid cracked it", "a guy broke the screen", "we have a broken projector"; and a few plain
// words about it - "the new projector", "it's having issues", "i think the pc is frozen", "under maintenance")
const GLUE = 'the|a|an|its|it|our|my|whole|entire|there|theres|with|is|are|was|were|has|have|had|having|been|got|gone|went|getting|keeps|kept|totally|completely|just|still|all|really|so|very|pretty|badly|basically|probably|apparently|definitely|some|sort|kind|of|in|by|up|under|onto|because|cause|cuz|coz|bc|since|as|seems|looks|like|think|new|old|bad|big|huge|small|little|large|brand|someone|somebody|guy|guys|person|customers?|guests?|kids?|players?|golfers?|members?|we|they|he|she|i';
const REASON_WORD = new RegExp(`^(?:${GEAR}|${GLUE})$`);
// (a question after it with no comma - "take bay 3 out of service is the projector broken" - asks, it does not say why: the model's, as it
// is with a comma (engine.js secondAsk). Oct 27 2026, the review: every word of it is one the box knows, so the card went up)
const ASKS_FIRST = /^(?:is|are|was|were|has|have|had|does|do|did|can|could|will|would|should|shall)\s+(?:the|it|its|there|everything|anything|that|this|someone|anyone|somebody|anybody|he|she|they|we|you|i|my|our|your|bay|all|any)\b/;
// ("bay 3's projector is broken, take the bay out of service" has said its fault already: what comes between may hold only those words.
// A question after it - "take bay 3 out of service, is everything working" - is the model's with the rest, as the turn's flow hands it on
// (engine.js secondAsk, test-box-flow F8b - changed Oct 27 2026): until then this reader took the first half and the question was dropped)
function onlyAReason(tail, faultSaid) {
  // (the owner's shorthand for the same polite words - "pls", "thx", "ty", "rn" - and "indefinitely", which is what out of service is:
  // Oct 27 2026)
  const t = String(tail || '').replace(/\b(?:please|pls|plz|right now|rn|now|for good|indefinitely|thanks|thank you|thank u|thx|ty|tysm|asap|sorry|unfortunately|sadly)\b/g, ' ').replace(/[,.;:!\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (ASKS_FIRST.test(t)) return false;
  if (!faultSaid && !FAULT.test(t)) return false;
  // (the fault's own words are not a "when" - "the pc won't turn on" says on, "the screen is down" says down)
  const rest = t.replace(new RegExp(FAULT.source, 'g'), ' ');
  if (WHEN.test(rest)) return false;
  return rest.replace(/'s\b/g, ' ').replace(/([a-z])'(?=\s|$)/g, '$1').split(/\s+/).filter(Boolean).every(x => REASON_WORD.test(x));
}
// A POLITE TAIL IS NOT PART OF A NAME OR A HEADLINE (Oct 25 2026, the review: "rename bay 1 to Bay One please" named the bay "Bay One
// please" on the public booking page, with no yes): please and thanks go, and a whole quoted name loses its quotes. A condition at the end
// ("for now", "until Friday", "tomorrow") can mean the owner wants it for a while, and a stray quote mark means the words are not plain -
// both are the model's (null), never stripped and put up. The owner's own case is kept (the menu's parts keep it too)
const CONDITION_TAIL = new RegExp(`(?:^|[\\s,])(?:for now|for (?:the |this )?(?:weekend|week|day|night|season|month|holidays?|winter|summer|fall|spring)|for (?:a|one|two|three|a few) (?:days?|weeks?|months?|hours?)|for a while|temporarily|(?:until|till|til|through|thru|starting|from|on) (?:${DAYW.slice(1, -1)}|the weekend|next week|further notice|then)|today|tonight|tomorrow|(?:this|next) (?:mon|tues|wednes|thurs|fri|satur|sun)day|this week(?:end)?|next week(?:end)?)$`, 'i');
function ownWords(w) {
  let s = String(w || '').trim().replace(/[.!]+$/, '').trim();
  for (let i = 0; i < 2; i++) s = s.replace(/[,\s]+(?:please|pls|plz|thanks|thank you|thx|ty)$/i, '').replace(/^(?:please)\s+/i, '').trim();
  const q = s.match(/^["“'‘](.+)["”'’]$/); if (q) s = q[1].trim();
  if (!s || /["“”]/.test(s) || CONDITION_TAIL.test(s)) return null;
  return s.replace(/[,;:]+$/, '').trim() || null;
}
const menuNames = (ctx) => ((ctx.facilityNamesNow || {}).menu || []).filter(Boolean);
// (a count or a role is never a new person's name - Oct 25 2026: "hire two bartenders" and "hire another bartender" put up "Two
// Bartenders" and "Another Bartender" to be added to the staff with a sign-in code. A role's word that is also a surname - Cook, Host - is
// read only as a plural)
const NOT_A_PERSON = /\b(?:a|an|the|new|more|another|some|any|few|couple|extra|one|two|three|four|five|six|seven|eight|nine|ten|part|full|timers?|help|helpers?|bartenders?|servers?|waiters?|waitress(?:es)?|cashiers?|managers?|employees?|workers?|staff|people|persons?|someone|somebody|hostess(?:es)?|cooks|hosts|chefs|cleaners?|instructors?|coaches|pros|teenagers?|students?|guys?|kids?|seasonal|temps?)\b/i;

// what is sold as bay time, a package or an event - never a menu item (the menu rules below)
// ("party platter", "club rental" and "hall pass" are sold at the counter, so those words stay)
const NOT_MENU = /\b(?:lessons?|clinics?|camps?|class(?:es)?|fittings?|leagues?|tournaments?|events?|coaching|instruction)\b/;
// a booking's length as said ("an hour", "2 hours", "90 minutes")
const LENGTH = 'an hour|one hour|an hour and a half|(?:\\d|one|two|three|four)(?:\\.5)? hours?|\\d{2,3} minutes';
// what reads as a public event's name, and what never does (the event rule below - Oct 25 2026)
const EVENT_CUE = /\b(?:event|night|league|tournament|tourney|scramble|classic|open|championship|cup|invitational|shoot ?out|showdown|challenge|contest|competition|clinic|trivia|karaoke|bingo|social|mixer|tasting|fundraiser|charity|outing|demo day|festival|fest|bash|celebration|watch party|viewing party|launch|grand opening|open house|skins|long drive|closest to the pin|putting|ladies day|kids day|family day|junior day|members? day|meet ?up|pro ?-?am|series|qualifier|finals?|playoffs?|live music|comedy)\b/;
// (a website part said with its words - "add a banner: League nights start Thursday" - is that part, never an event: the demo's own try
// went up as the event "A Banner: League Nights Start")
const NOT_PUBLIC = /\b(?:private|party (?:for|of)|group (?:for|of)|players?|people|persons?|guests?|golfers?|schedule|roster|shift|work|working|lesson|lessons|reservation|booked|closed|close|off|walk ?ins?|no ?show|appointment|meeting|banner|notice|announcement|slide|page|faq|section|flyer|poster|photo|gallery|menu)\b|:|\b(?:to|for|with|of|at|and|in|on|from|by)$/;
// (A PARTY SOMEONE HOLDS IS NOT A PUBLIC EVENT - Oct 27 2026, the review of the Oct 25 fix: "add Mike's birthday bash saturday at 8", "add
// the Deloitte company outing friday", "add the Johnson family night friday at 6" and "add Bob's retirement mixer friday at 5" went on the
// public Events page at once, because bash, outing, night and mixer read as an event's name. A person's own occasion - a birthday, a
// wedding, a retirement, a bachelor party, a reunion - a company's or a team's outing, a family's night, or anyone's name with 's is the
// model's: it may be a booking, a block or a package, and the model can ask. The facility's own "Family Fun Night" or "Family Day" still reads)
// (A HOLIDAY'S NAME AND A BUSINESS LEAGUE ARE PUBLIC - Oct 27 2026, the review of that fix: any name with 's, and "memorial" and "business"
// anywhere, took the facility's own "Father's Day Scramble", "Mother's Day Brunch Tournament", "Valentine's Couples Scramble", "St.
// Patrick's Day Bash", "Memorial Day Scramble" and "Business League Night" off the Events page too. A possessive is a person's occasion
// unless it is a holiday's or a group's the facility plays for (PUBLIC_OWN - a short list of what the box knows; any other name with 's,
// or with s' - "the Smiths' night" - is still the model's); "memorial" is private but for Memorial Day)
// (A COMPANY'S OWN DO IS THE MODEL'S, WHATEVER WORDS COME BETWEEN - Oct 27 2026, the review of that fix: a company, a business, an office
// or a firm was private only when its very next word was outing, party, night or event, so "add the company golf outing friday", "add the
// Deloitte corporate golf outing friday", "the company summer outing", "the company year end bash" and "the law firm golf outing" went on
// the public Events page at once, the client's name in the title - each was the model's the day before. Now any of those words anywhere
// is the model's; only a plainly public league - "Corporate League Night", "Business League" - still reads)
const COMPANY = /\b(?:compan(?:y|ies)|corporate|corporation|corp|business(?:es)?|offices?|firms?|clients?|employers?|department|dept|inc|llc|ltd)\b/;
const PUBLIC_LEAGUE = /\b(?:corporate|business) leagues?\b/g;
// (A NAME WITH ITS S AND NO APOSTROPHE IS STILL A PERSON'S, AND ONE PERSON'S 'S IS NEVER A GROUP'S - Oct 27 2026, the same review: maintainer types
// without apostrophes - "add mikes bash saturday at 8", "add sarahs tournament saturday", "add the johnsons night saturday at 6" - and each
// went on the public page at once as "Mikes Bash"; and the list of public possessives let a singular one through - "add my kid's bash",
// "add my mother's bash", "add our captain's bash", "add the champion's bash". Now:
//  - PUBLIC_OWN is what the box knows is never one person's: a holiday (a father's, a mother's, a president's or a veteran's only with its
//    Day; St. Patrick's only as the saint's; Valentine's, New Year's, April Fools'), a group the facility plays for said as a group (ladies,
//    men's, women's, kids, juniors, seniors, couples, parents - plural, never "kid's" or "lady's"; members never reach here - the event rule
//    hands any "member" to the model first), golf's own names (Captain's Choice, Champions, Masters), a contraction ("let's", "it's"), and the
//    plural words that are never a person's name: the game's (skins, doubles, a Texas scramble, birdies, putts, darts ...), the people who
//    play it (beginners, girls, guys, pros ...), the season's (Christmas, the holidays, the eighties, Vegas night) and the food and drink
//    (wings, tacos, beers ...)
//  - anything else with 's or s' is a person's, and so is a word ending in s before the occasion's own word ("mikes bash", "the johnsons
//    night", "sarahs tournament") or a "my", "his", "her" or "their" - the model has those, and can ask)
//
// WHOSE AN EVENT IS - ONE RULE, WHEREVER THE NAME SITS (Oct 27 2026, round 2d; the review of round 2c). The public Events page holds only
// what is plainly public. An event's name is read for whose it is, and it is someone's own - a person's, a family's, a team's, a company's
// or a client's - when a private do's own word is in it (PRIVATE_WORDS, COMPANY), or when a name stands where the one who holds it stands:
//   - a possessive, or a my / his / her / their, anywhere;
//   - BEFORE the occasion - a word ending in s that the box does not know as public, with the occasion after it, or another of the
//     event's own words after it (a game's word, "mikes skins game", "bobs skins"; an ordinal, "sarahs 40th");
//   - AFTER "for" (or "in honor of", "in memory of", "celebrating") - ANY word there the box does not know as public: "a bash for mike",
//     "a scramble for bob", "the scramble for toms 50th", "a night for the hendersons", "skins for the smiths". A name has no s to give it
//     away there, so only what the box knows passes ("for kids", "for the ladies", "for charity", "for the food bank", "for all ages");
//   - AFTER "at" - a word ending in s, or someone's place: "the bash at mikes place", "a night at the smiths".
// What the box knows as public is ONE list, PUBLIC_NAMES below, each line saying what it is. Round 2d gave back, narrowly: a team's watch
// party, by the pro leagues' own team names (TEAMS - "the hendersons watch party" and "mikes watch party" are still someone's), golf's own
// Presidents Cup (one president's "president's cup" stays the model's), the contractions maintainer types without the mark ("lets golf night",
// "whats up wednesday", "thats a wrap", "heres to summer"), a parent-and-child pair ("fathers and sons", "dads and grads", "mother
// daughter"), a cause ("charity", "a cause", "a cure", "the food bank", "toys for tots", "cancer research"), a time of year ("halloween",
// "the 4th of july", "summer"), and a word ending in -ous (an adjective, never a name: "the fabulous fall bash"). Anything else is the
// model's, and the model's own event_add of it is asked before it goes up (engine.js privateEvent - the same test, intents.privateDo).
// A company named only by its own name ("the deloitte scramble") or a person by their whole name with no s ("the mike smith bash") cannot
// be told from a public event's name, and is still the box's reading - recorded, not closed.
// (the pro leagues' team names that end in s - the NFL's, MLB's, the NBA's, the NHL's, with their short forms: a name typed lower case
// with its s cannot be told from a family's, so only a team on this list is a team; any other - a college's, a family's - is the model's)
// (Oct 28 2026, round 2e - the review of round 2d: "the browns watch party" and "the kings watch party" are as likely the Brown or the King
// family's - those two are a team only with their city, "the cleveland browns watch party", "the la kings watch party": SURNAME_TEAMS)
// (and the two-word names - "golden knights", "maple leafs", "trail blazers", "red wings", "blue jays", "white sox": Oct 28 2026, round 2f - the
// model's "Golden Knights Watch Party", "Maple Leafs Watch Party", "Trail Blazers Watch Party" were asked as someone's own)
const TEAM_FIRST = '(?:(?:golden|maple|trail|red|white|blue) )?';
const TEAMS = ['sox', '49ers', 'niners', 'bears', 'bengals', 'bills', 'broncos', 'buccaneers', 'bucs', 'cardinals', 'chargers', 'chiefs', 'colts', 'commanders', 'cowboys', 'dolphins', 'eagles',
  'falcons', 'giants', 'jaguars', 'jags', 'jets', 'lions', 'packers', 'panthers', 'patriots', 'pats', 'raiders', 'rams', 'ravens', 'saints', 'seahawks', 'steelers', 'texans', 'titans', 'vikings',
  'angels', 'astros', 'athletics', 'braves', 'brewers', 'cards', 'cubs', 'diamondbacks', 'dbacks', 'dodgers', 'guardians', 'jays', 'mariners', 'marlins', 'mets', 'nationals', 'nats', 'orioles',
  'padres', 'phillies', 'pirates', 'rangers', 'rays', 'reds', 'rockies', 'royals', 'tigers', 'twins', 'yankees',
  '76ers', 'sixers', 'blazers', 'bucks', 'bulls', 'cavaliers', 'cavs', 'celtics', 'clippers', 'grizzlies', 'hawks', 'hornets', 'knicks', 'lakers', 'mavericks', 'mavs', 'nets', 'nuggets',
  'pacers', 'pelicans', 'pistons', 'raptors', 'rockets', 'spurs', 'suns', 'timberwolves', 'wolves', 'warriors', 'wizards',
  'blackhawks', 'blues', 'bruins', 'canadiens', 'canucks', 'capitals', 'caps', 'devils', 'ducks', 'flames', 'flyers', 'hurricanes', 'canes', 'islanders', 'jackets', 'knights', 'leafs', 'oilers',
  'penguins', 'pens', 'predators', 'preds', 'sabres', 'senators', 'sens', 'sharks', 'stars', 'wings'].join('|');
const SURNAME_TEAMS = 'browns|kings';
// (a city before the team - "the kansas city chiefs", "the dallas cowboys": a pro team's own city, state or region, from ONE list - Oct 28
// 2026, round 2e, the review of round 2d: this was any one to three words that did not end in s, so a person's, a family's or a company's
// own name before a team - "jake and sarah chiefs watch party", "mike smith chiefs watch party", "the johnson chiefs watch party", "the
// deloitte chiefs watch party" - went on the public Events page at once; on round 2c each was the model's)
const CITIES = ['arizona', 'atlanta', 'baltimore', 'boston', 'brooklyn', 'buffalo', 'calgary', 'carolina', 'charlotte', 'chicago', 'chi', 'cincinnati', 'cincy', 'cleveland', 'colorado',
  'columbus', 'dallas', 'denver', 'detroit', 'edmonton', 'florida', 'golden state', 'green bay', 'gb', 'houston', 'indiana', 'indianapolis', 'indy', 'jacksonville', 'jax', 'kansas city', 'kc',
  'la', 'l\\.a\\.', 'las vegas', 'vegas', 'los angeles', 'memphis', 'miami', 'milwaukee', 'minnesota', 'minneapolis', 'montreal', 'nashville', 'new england', 'new jersey', 'nj', 'new orleans', 'new york', 'ny',
  'nyc', 'oakland', 'oklahoma city', 'okc', 'orlando', 'ottawa', 'philadelphia', 'philly', 'phoenix', 'pittsburgh', 'pitt', 'portland', 'sacramento', 'san antonio', 'san diego', 'san francisco',
  'sf', 'san jose', 'seattle', 'st\\.? louis', 'saint louis', 'stl', 'tampa', 'tampa bay', 'tb', 'tennessee', 'texas', 'toronto', 'utah', 'vancouver', 'washington', 'dc', 'winnipeg', 'anaheim',
  'arlington', 'cleveland', 'seattle'].join('|');
const CITY = `(?:(?:${CITIES}) )?`;
const TEAM = `(?:${CITY}${TEAM_FIRST}(?:${TEAMS})|(?:${CITIES}) (?:${SURNAME_TEAMS}))`;
// (what stands before a team's watch party and names nobody: "a", "an", "our", the day it is on - "monday night", "sunday", "thursday night
// football" - "the big game", "game day", "playoff": Oct 28 2026, round 2f - the critic of round 2e: "add a chiefs watch party sunday at 1", "add
// our chiefs watch party sunday at 3" and the model's own "Monday Night Chiefs Watch Party", "Big Game Chiefs Watch Party" were asked as someone's
// own. A name before any of these is still read: "mikes sunday chiefs watch party" is Mike's)
const TEAM_LEAD = `(?:^|(?:the|a|an|our) |(?:(?:the|a|an|our) )?(?:(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day(?: night)?(?: football)?|big game|game day|playoffs?|super bowl) ))`;
// (a cause's own name before research, awareness or relief - a disease, a disaster, a need: ONE list, Oct 28 2026, round 2e - the review
// of round 2d: any two words were taken there, so "jakes leukemia research bash", "mikes cancer research fundraiser", "sarahs autism
// awareness night" and "the hendersons hurricane relief scramble" went on the public page at once with the person's name in the title.
// A name before the cause, or after "for" with it - "a bash for jims cancer research" - is still read as the person's)
const CAUSES = ['cancer', '(?:breast|childhood|pediatric|prostate|lung|colon|skin|ovarian|pancreatic|brain) cancer', 'leukemia', 'lymphoma', 'autism', "alzheimer'?s", 'dementia', 'diabetes',
  'heart(?: disease)?', 'stroke', 'als', 'ms', "parkinson'?s", 'cystic fibrosis', 'mental health', 'suicide(?: prevention)?', 'addiction', 'ptsd', 'veterans?', 'military', 'hunger', 'homeless(?:ness)?',
  'poverty', 'hurricane', 'disaster', 'flood', 'tornado', 'wildfire', 'fire', 'earthquake', 'storm', 'famine', 'drought', 'medical', 'hiv', 'aids', 'kidney', 'epilepsy', 'down syndrome',
  'sickle cell', 'lupus', 'arthritis', 'brain injury', 'concussion', 'refugee', 'hospice', "crohn'?s", 'covid'].join('|');
const PUBLIC_NAMES = [
  // a parent-and-child pair is the event's own name (round 2d)
  "(?:fathers?|dads?|daddys?|mothers?|moms?|mums?|parents?|grand(?:pa|ma|parent|father|mother)s?)(?:\\s*(?:-|&|/|\\+)\\s*|\\s+(?:and|n|vs\\.?)\\s+|\\s+)(?:sons?|daughters?|kids?|child(?:ren)?|grads?|juniors?|boys?|girls?|grand(?:kid|son|daughter|child)s?|grandchildren)",
  // (a mom's and a dad's day as the holiday's own - "the moms day scramble": Oct 28 2026, round 2e)
  "(?:father|mother|president|veteran|mom|mum|dad)(?:'s|s'|s)? day", "valentine(?:'s|s'|s)", "new year(?:'s|s'|s)", "(?:st\\.? |saint )(?:patrick|paddy|patty)(?:'s|s'|s)?", "(?:patrick|paddy|patty)(?:'s|s'|s)? day",
  "april fool(?:'s|s'|s)", "christmas", "xmas", "mardi gras", "holidays", "(?:twen|thir|for|fif|six|seven|eigh|nine)ties",
  // a time of year (round 2d: "a bash for halloween", "a scramble for the 4th of july")
  "halloween|thanksgiving|easter|(?:the )?(?:4th|fourth)(?: of july)?|july (?:4th|fourth)|(?:labor|memorial|independence|opening) day|(?:the )?super bowl|(?:spring|summer|fall|autumn|winter)(?: season)?|the season",
  "(?:ladies|kids|children|juniors|seniors|couples|parents|grandparents|champions|masters|sweethearts)'?", "(?:men|women|children)(?:'s|s)", "(?:wo)?men|youth", "captain(?:'s|s'|s) choice",
  // golf's own Presidents Cup, as it is spelled (round 2d)
  "presidents'? cup",
  // a contraction, with the mark or typed without it (round 2d: "lets golf night", "whats up wednesday")
  "(?:let|it|that|here|there|what)'s", "(?:let|that|here|there|what)s",
  // a team's watch party (round 2d: "the chiefs watch party", "the kansas city chiefs watch party", "the bears game watch party", "the
  // packers vs bears watch party", and the model's own "Chiefs Watch Party"): a team on TEAMS, first in the name or after "the", before the
  // watch party - "the hendersons watch party", "mikes watch party" and "mikes chiefs watch party" are still someone's
  // (the team's city from ONE list, CITIES - round 2e, Oct 28 2026)
  `${TEAM_LEAD}${TEAM}(?: (?:vs\\.?|v|and|&) (?:the )?${TEAM})?(?= (?:games? )?(?:watch|viewing) part(?:y|ies)(?![a-z]))`,
  // a cause the event is for (round 2d: "a scramble for charity", "a fundraiser for the food bank"; its own name before research, awareness
  // or relief only from CAUSES - round 2e, Oct 28 2026)
  `charit(?:y|ies)|(?:a )?(?:good )?cause|an? cure|the cure|(?:the )?(?:local )?food (?:bank|pantry|drive)s?|toys for tots|(?:the |our )?troops|(?:(?:${CAUSES}) )?(?:research|awareness|relief)`,
  "texas|(?:las )?vegas|skins|doubles|singles|pairs|teams|twosomes|foursomes|greensomes|holes|majors|olympics|nationals|regionals|sectionals|qualifiers|birdies|eagles|bogeys|pars|aces|putts|pins|tees|drives|chips|greens|games|darts|cards|sports|balls|mulligans",
  // (and the players' own names a league or a cup goes by, never one person's: "Members Cup", "Weekend Warriors League", "Founders Cup",
  // "Hackers Open", "Night Owls League", "Locals Night" - round 2e, Oct 28 2026: each was asked on the model's path as someone's own)
  "beginners|girls|guys|boys|gents|lads|adults|teens|students|teachers|nurses|heroes|veterans|rookies|pros|amateurs|lefties|families|members|locals|regulars|hackers|duffers|warriors|owls|founders|legends",
  "wings|tacos|beers|brews|drinks|cocktails|margaritas|burgers|pints|nachos|apps|snacks|sliders|wines|shots|suds"];
const PUBLIC_OWN = new RegExp(`(?<![a-z'])(?:${PUBLIC_NAMES.join('|')})(?![a-z'])`, 'g');
// (an outing is a group's own day out - "the Deloitte outing", "the Acme golf outing": whose is not said, so it is the model's, which can
// ask; the facility's own public days are its tournaments, scrambles, leagues and nights - Oct 27 2026)
const PRIVATE_WORDS = /\b(?:birthdays?|bday|b-day|wedding|anniversary|retirement|retiring|bachelor(?:ette)?|stag|hen|bridal|shower|gender reveal|reunion|graduation|grad party|engagement|rehearsal|christening|baptism|communion|bar mitzvah|bat mitzvah|quincea[nñ]era|sweet (?:16|sixteen)|memorial(?! day)|funeral|farewell|going away|send ?off|outings?|team (?:building|outing|party|night|event|day)|customer appreciation|employees?|coworkers?|colleagues?|holiday party|christmas party|xmas party)\b|\b(?!(?:a|an|the|our|fun|friendly|big|annual|monthly|weekly|summer|fall|autumn|winter|spring|holiday|halloween)\b)[a-z]+ family\b/;
// (the players' own "their guests" - "the member guest for members and their guests" - is no holder: Oct 28 2026, round 2e)
// (and "their friends", "their families", "their kids" - "a scramble for members and their friends": Oct 28 2026, round 2f)
const OWNER_WORD = /\b(?:my|his|her)\b|\btheir\b(?!\s+(?:own\s+)?(?:guests?|friends|famil(?:y|ies)|kids|children|partners?|spouses?|dates?|plus ones?)\b)/;
const NOT_A_NAME_S = /^(?:is|as|was|has|does|this|us|plus|yes|versus|vs|its|thus|always|perhaps|sometimes)$/;
const OCCASION = new RegExp(`${EVENT_CUE.source}|\\b(?:part(?:y|ies)|dinner|lunch|brunch|breakfast|banquet|gathering|reception|get ?-?together)\\b`);
const cueWord = (x) => EVENT_CUE.test(x) || EVENT_CUE.test(x.replace(/s$/, ''));
// (WHOSE AN EVENT IS, above - Oct 27 2026, round 2d. The public words are marked § rather than taken out, so a name before one of them -
// "mikes skins game" - still has the event's own word after it. A word that may be someone's name with its s: two letters or more,
// never -ss or -ous, never a little word, never the occasion itself. The little words after "for" that name nobody: articles, all and
// every, ages and levels, a count. A place someone has)
const nameS = (x) => /^[a-z]{2,}s$/.test(x) && !/(?:ss|ous)$/.test(x) && !NOT_A_NAME_S.test(x) && !cueWord(x);
const ORDINAL = /^\d+(?:st|nd|rd|th)$/;
// (and a school grade or a handicap range, the players' own count and place, prizes - "the junior league for grades 3-5", "for 4 person
// teams", "prizes for the top 3", "for the top 16 players", "for club members", "a scramble for prizes": Oct 28 2026, round 2e - the owner's
// own words are read now as well as the model's title, and these are the ordinary words after "for" in a public event)
const FOR_LITTLE = /^(?:the|a|an|our|all|every|everyone|everybody|anyone|of|and|n|or|for|to|ages?|levels?|skill|grades?|graders|handicaps?|hcp|only|over|under|up|plus|new|young|local|area|one|two|three|four|top|best|players?|golfers?|person|man|club|prizes?|cash|fun|it|this|that|them|us|you|their|guests?|\d+(?:st|nd|rd|th)?|§)$/;
const SOMEONES_PLACE = /^(?:place|house|home|pad|cabin|condo|apartment|apt)$/;
// (what comes after "with" in the facility's own public events - "trivia with prizes", "league night with drink specials", "a night with
// live music", "a clinic with our pro", "breakfast with santa": any other word there is someone's - "a night with the hendersons", "skins
// with mike" - Oct 28 2026, round 2e)
const WITH_PUBLIC = /^(?:prizes?|cash|payouts?|pool|purse|trophies|trophy|awards?|music|live|bands?|djs?|drinks?|specials?|deals?|food|apps|appetizers|pizza|beer|bbq|buffet|raffles?|giveaways?|swag|costumes?|glow|lights|lasers|pros?|shop|staff|coach(?:es)?|instructors?|santa|bunny|twist|friends|family|your|you|us|everyone|anybody|mom|moms|dad|dads|mulligans|handicaps|flights|partners?|scoring|net|gross|best|ball|carts?|dinner|lunch|breakfast|brunch|snacks|after|included|provided|served|person|man|player)$/;
// WHAT A PUBLIC EVENT IS FOR OR COMES WITH (Oct 28 2026, round 2f - the review of round 2e: every word after "with" or "hosted by" that was not on
// the short WITH_PUBLIC list was read as a person, and every word after "for" not on FOR_LITTLE - so "a scramble with a long drive contest",
// "with closest to the pin", "with hot dogs", "a clinic with the pga pro", "a clinic with coach mike", "trivia with our bartender", "a demo day with
// titleist", "a scramble hosted by the rotary club", "league night with free beer", "a league for high handicappers", "a fundraiser for st jude",
// "a scramble for the high school golf team", "a watch party for the big game" were each handed to the model and asked as a private do). The
// ordinary words of a public event's prizes, food, drink, games and players - never a person's name - and the gear makers a demo day is with
const HOLD_COMMON = /^(?:free|hot|cold|half|price|priced|cheap|big|bigger|high|higher|low|lower|long|longest|closest|straightest|short|silent|live|great|good|best|top|new|first|last|annual|grand|mini|special|local|amazing|awesome|fun|cash|door|tee|pin|flag|hole|green|greens|fairway|drive|driving|putt|chip|chipping|contest|contests|competition|competitions|challenge|start|shotgun|minimum|drink|draft|drafts|beer|beers|wine|wines|cocktails?|wings|dogs|burgers?|tacos?|pizza|nachos|bbq|food|trucks?|cookout|potluck|auction|raffle|games?|bartenders?|servers?|winners?|winner|champions?|handicappers?|beginners?|golfers?|players?|friends|families|everyone|video|swing|analysis|lessons?|tips|drills|demo|fitting|fittings|launch|monitor|simulator|sims?|music|band|karaoke|trivia|prizes?|giveaways?|swag|gifts?|cards?|certificates?|discounts?|specials?|deals?|off|appetizers?|snacks|trophies|trophy|medals?|awards?|price|pricing|night|day|weekend|season|week|month|year|game|members?|guests?|kids|juniors|seniors|adults|ladies|men|women|youth)$/;
const HOLD_BRANDS = /^(?:titleist|callaway|taylormade|ping|cobra|mizuno|srixon|bridgestone|pxg|odyssey|footjoy|honma|trackman|foresight|gcquad|uneekor|garmin|bushnell|golfzon|skytrak)$/;
// (a cause or a group the event is held for or with - a school, a club, a church, a charity: "the high school golf team", "the wounded warrior
// project", "the rotary club" - and "st jude": never a person's own)
const HOLD_GROUP = /^(?:school|schools|project|foundation|fund|hospital|church|club|society|association|charity|charities|shelter|scouts|troop|rotary|kiwanis|legion|vfw|academy|college|university|ymca|ministry|hospice|pta|booster|boosters|league|alliance|council|chamber|united|habitat)$/;
const HOLD_TITLE = /^(?:coach|pro|pros|instructor|instructors|chef|dj|captain|santa|pga|lpga|staff|teaching)$/;
// does the holder phrase - the words after "for" or "with" / "hosted by" - name someone? (the words up to the next holder word)
function holderNames(p, kind) {
  const end = p.findIndex((y, i) => i > 0 && /^(?:for|with|hosted|featuring|at|on)$/.test(y)), x = end >= 0 ? p.slice(0, end) : p.slice();
  if (!x.length) return false;
  // (the facility's own, all of them, a thing - "with a long drive contest", "with our bartender", "for all ages", "with $2 off drafts")
  if (/^(?:our|your|all|every|everyone|everybody|anyone|\d.*)$/.test(x[0]) || (kind === 'with' && /^(?:an?|some|plenty|lots|tons)$/.test(x[0]))) return false;
  if (/^(?:st|saint)$/.test(x[0])) return false;
  if (kind === 'with' && (HOLD_TITLE.test(x[0]) || (x[0] === 'the' && HOLD_TITLE.test(x[1] || '')))) return false;
  const known = (y) => y === '§' || FOR_LITTLE.test(y) || cueWord(y) || HOLD_COMMON.test(y) || HOLD_GROUP.test(y) || (kind === 'with' && (WITH_PUBLIC.test(y) || HOLD_BRANDS.test(y)));
  // (a school's, a club's, a cause's own name - "the wounded warrior project", "the high school golf team", "the rotary club": from its "the" on,
  // whatever its words; a name before it is still read - "mike and the rotary club" is Mike's)
  const g = x.findIndex(y => HOLD_GROUP.test(y)), th = g > 0 ? x.lastIndexOf('the', g - 1) : -1;
  if (th >= 0 && x.slice(0, th).every(known)) return false;
  // ("the" and a name with its s, the family: "the hendersons", "the smiths")
  if (x[0] === 'the' && x[1] && !known(x[1]) && nameS(x[1])) return true;
  return x.some(y => !known(y));
}
function personsOwn(name) {
  const s = String(name || '').replace(/[‘’]/g, "'").replace(PUBLIC_OWN, ' § ');
  if (/\b[a-z]+(?:'s|s')(?![a-z])/.test(s) || OWNER_WORD.test(s)) return true;
  const w = s.replace(/[^a-z0-9'§ ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  // before the occasion, or before another of the event's own words (a game's, an ordinal)
  if (w.some((x, i) => nameS(x) && (OCCASION.test(w.slice(i + 1).join(' ')) || w.slice(i + 1).some(y => y === '§' || ORDINAL.test(y))))) return true;
  // after "for", "in honor of", "in memory of", "celebrating": a word the box does not know as public (holderNames - Oct 28 2026, round 2f)
  const f = w.findIndex((x, i) => x === 'for' || (/^(?:honou?r|memory)$/.test(x) && w[i + 1] === 'of') || /^(?:honou?ring|celebrating|remembering)$/.test(x));
  if (f >= 0 && (w[f] === 'for' ? holderNames(w.slice(f + 1), 'for') : w.slice(f + 1).some(y => !FOR_LITTLE.test(y) && !cueWord(y)))) return true;
  // THE HOLDER'S OTHER PLACES (Oct 28 2026, round 2e - the review of round 2d: the box put "a night with the hendersons", "skins with the
  // hendersons", "a bash hosted by mike", "a bash in mikes honor" and "a scramble in toms memory" on the public page at once):
  //   - after "with" or "hosted by": a word the box does not know as public there (holderNames, round 2f: WITH_PUBLIC, the public names, the
  //     little words, an event's own word, a public event's ordinary words, a gear maker, a school's or a club's name, a coach or a pro) - "a
  //     night with the hendersons", "a scramble with bob and friends", "a bash hosted by mike"
  //   - "in <name> honor" / "in <name> memory", typed without the mark - "in mikes honor", "in toms memory"
  const h = w.findIndex((x, i) => x === 'with' || (x === 'hosted' && w[i + 1] === 'by'));
  if (h >= 0 && holderNames(w.slice(h + (w[h] === 'with' ? 1 : 2)), 'with')) return true;
  if (w.some((x, i) => x === 'in' && w[i + 2] && /^(?:honou?r|memory)$/.test(w[i + 2]) && !FOR_LITTLE.test(w[i + 1]) && !/^(?:loving|fond)$/.test(w[i + 1]))) return true;
  // after "at": a word ending in s, or someone's place
  const a = w.indexOf('at');
  if (a >= 0) { const nx = w[a + 1] === 'the' ? w[a + 2] : w[a + 1]; if ((nx && nameS(nx)) || w.slice(a + 1, a + 5).some(y => SOMEONES_PLACE.test(y))) return true; }
  return false;
}
const PRIVATE_DO = { test: (s) => { const t = String(s || ''); return PRIVATE_WORDS.test(t) || COMPANY.test(t.replace(PUBLIC_LEAGUE, ' ')) || personsOwn(t); } };
// (the same test for a title the model wrote - engine.js privateEvent: read as the owner's words are, and a title that says "private" is
// not public either - Oct 27 2026, round 2d)
const privateDo = (title) => { const t = norm(title); return PRIVATE_DO.test(t) || /\bprivate\b/.test(t); };
// THE OWNER'S OWN WORDS FOR THE EVENT, READ BY THE SAME TEST (Oct 28 2026, round 2e - the review of round 2d: the box hands a private do to
// the model because its own test read the owner's words as someone's, and the guard then read only the title the model chose, so a model
// that wrote a plain title put the do on the public page at once - "add a bash for sarahs 40th saturday at 3" went up as "Saturday Bash",
// "add mikes retirement party friday at 5" as "Friday Celebration"). Each line of the request in hand that asks to add, put up or rename
// an event is read here: the request's own words set aside (add, put, "on the events page", "as an event"), its day, date and time set
// aside, and anything after a comma, a dash, a full stop or "and <another request>" left out - the event's own words that are left are
// read by the box's test, PRIVATE_DO, as the box reads a name it was given. A rename reads its new name. A line that asks nothing of an
// event says nothing (an answer, "8pm", "public"), and words after the event's own - "fun for the whole family" - are never read: what is
// read is the event's name as the owner gave it, never free words about it.
const EV_MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const EV_DAY = '(?:today|tonight|tonite|tomorrow|tmrw|tmr|(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)day|mon|tue|tues|thu|thur|thurs|fri|weekend)';
const EV_NUM = '(?:\\d{1,2}(?::[0-5]\\d)?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|noon|midnight)';
const EV_WHEN = new RegExp([
  `\\b(?:on |for |this |next |every |this coming )?(?:the )?${EV_MONTH} \\d{1,2}(?:st|nd|rd|th)?(?:\\s*(?:-|to|thru|through|and|&)\\s*\\d{1,2}(?:st|nd|rd|th)?)?(?:,? 20\\d\\d)?\\b`,
  `\\b(?:on |for )?\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`, `\\b(?:on |for )?the \\d{1,2}(?:st|nd|rd|th)\\b`,
  `\\b(?:on |for |this |next |every |this coming )?${EV_DAY}s?(?: (?:night|morning|afternoon|evening))?\\b`,
  `(?:\\b(?:at|@|from|starting(?: at)?|starts?(?: at)?|kicks? off(?: at)?|tees? off(?: at)?|shotgun(?: start)?(?: at)?|between)\\s+)?(?<![\\d:/a-z])${EV_NUM}(?:\\s*(?:-|–|to|until|till|til|and)\\s*${EV_NUM})?(?![\\d:/a-z]|\\s*(?:st|nd|rd|th)\\b)`,
].join('|'), 'g');
const EV_PAGE = /\b(?:to|on|onto|in|into|up on)\s+(?:the |our |my )?(?:public )?(?:events?(?: page| calendar| list| section| tab)?|calendar|website|web ?site|site|homepage|home page)\b|\bas (?:an? )?(?:public )?event\b/g;
const EV_LEAD = /^(?:(?:ok(?:ay)?|so|hey|please|pls|plz|also|and|then|now|can you|could you|would you|will you|lets|let's|i want to|i'd like to|id like to|we want to|go ahead and)[,\s]+)+/;
function ownersDo(words) {
  return String(words || '').split(/\n+/).some((line) => {
    const t = norm(line).replace(/[“”"]/g, ' ').replace(EV_LEAD, '');
    let part = null;
    const re = /^(?:rename|retitle)\s+(.+?)\s+(?:to|as|into)\s+(.+)$/.exec(t) || /^(?:change|switch|turn)\s+(?:the name of\s+)?(.+?)\s+(?:to|into)\s+(?:be\s+)?(?:called\s+)?(.+)$/.exec(t) || /^(?:make|call)\s+(.+)$/.exec(t);
    if (/^(?:add|put|post|list|schedule|set up|create|throw|host)\b/.test(t)) part = t.replace(/^(?:add|put|post|list|schedule|set up|create|throw|host)\s+(?:up\s+)?(?:an? (?:new )?event:?\s+(?:called |named |for )?)?/, '');
    else if (re) part = re[2] || re[1];
    if (!part) return false;
    part = part.replace(EV_PAGE, ' ').replace(EV_WHEN, ' ').split(/[,;!?:]|\.(?:\s|$)|\s[-–—]+\s|\b(?:and|then|also|plus)\s+(?:also\s+)?(?:block|book|put|add|send|email|text|post|make|turn|set|close|open|schedule|tell|let|have|switch|run)\b/)[0];
    part = part.replace(/\s+/g, ' ').trim();
    return part.length >= 2 && (PRIVATE_DO.test(part) || /\bprivate\b/.test(part));
  });
}
// (one of the facility's own people - staff or members, by the whole name or the first - bays, plans or menu items, in a phrase)
function namesOurs(ctx, phrase) {
  const p = core(phrase), words = p.trim().split(' ');
  const people = staffNames(ctx).concat(((ctx.facilityNamesNow || {}).members || []).filter(Boolean));
  if (people.some(n => p.includes(core(n)) || words.includes(core(n).trim().split(' ')[0]))) return true;
  return bayNames(ctx).concat(tierNames(ctx), menuNames(ctx)).some(n => core(n).trim() && p.includes(core(n)));
}
// [pattern on the owner's words (normalised), (match, ctx) => one of: { call: [action, args] } | { ask: { question, choices } } |
//  { say: words } | null (not this one after all)]
// (the bay not plain - "turn off the bay" with three of them: the box asks which, each choice the owner's own words again)
// (every bay the facility has, Oct 25 2026: the question named only the first four, so at a six-bay facility it read as if those were
// all of them and Bay 5 and Bay 6 could not be tapped - the chat's row of choices takes 26, so up to 26 are offered, and any past that
// are said to be there)
const BAY_ASK = (say) => (ctx) => {
  const b = bayNames(ctx), shown = b.slice(0, 26), more = b.length - shown.length;
  return b.length > 1 ? { ask: { question: `Which one - ${shown.join(', ')}${more ? ` (and ${more} more - say which)` : ''}?`, choices: shown.map(say) } } : null;
};
const bayCall = (action, extra, say) => (m, ctx) => {
  const phrase = m[m.length - 1] || '', b = oneOf(bayNames(ctx), phrase);
  if (b) return only(b, phrase) ? { call: [action, Object.assign({ bay: b }, extra)] } : null;
  return /^(?:the )?(?:bay|sim|simulator)$/.test(norm(phrase)) ? BAY_ASK(say)(ctx) : null;
};
// WHOSE MEMBERSHIP (Oct 25 2026, the review: "cancel chris membership now" was read as a member called "chri" - the optional apostrophe
// took a name's own last s - and the box told the owner there is no such member): the name with and without a last s (maintainer types the
// possessive without its apostrophe: "brians membership"), each against the facility's own members - the whole name, a first name alone
// or "First L.", as the members' own finder reads them (areas/money.js findMember). The one that is a member is that one; both are
// asked; neither is the model's. The names come back as the owner typed them
function memberSaid(ctx, raw) {
  const w = (String(raw).match(/^\s*cancel\s+(.+?)\s+membership\b/i) || [])[1]; if (!w) return null;
  const typed = w.trim().replace(/[’‘]/g, "'"), apos = /'s$/i.test(typed), forms = apos ? [typed.slice(0, -2)] : /s$/i.test(typed) ? [typed, typed.slice(0, -1)] : [typed];
  const members = (ctx.facilityNamesNow || {}).members;
  if (!Array.isArray(members)) return apos || forms.length === 1 ? [forms[0]] : null;
  const n = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const is = (f) => { const t = n(f); if (!t) return false; return members.some(mm => { const p = n(mm).split(' '); if (p.join(' ') === t) return true; if (!t.includes(' ') && p[0] === t) return true; const fl = t.match(/^(\S+)\s+([a-z])\.?$/); return !!fl && p.length > 1 && p[0] === fl[1] && p[p.length - 1][0] === fl[2]; }); };
  const hit = forms.filter(is);
  return hit.length ? hit : null;
}
const itemCall = (phrase, ctx, make) => { const it = oneOf(menuNames(ctx), phrase); return it && only(it, phrase) ? make(it) : null; };
const INTENTS = [
  // ── the bays ──
  [/^(?:please )?(?:turn|switch|power|shut) (?:off|down) (?:all(?: of)? (?:the )?bays|all of them|every bay|everything|the whole place|all the sims)$|^(?:turn|switch|shut) (?:everything|all (?:the )?bays|every bay) (?:off|down)$/, () => ({ call: ['all_bays_switch', { on: false }] })],
  [/^(?:please )?(?:turn|switch|power) (?:on|up) (?:all(?: of)? (?:the )?bays|all of them|every bay|everything|all the sims)$|^(?:turn|switch|power) (?:everything|all (?:the )?bays|every bay) (?:on|up)$/, () => ({ call: ['all_bays_switch', { on: true }] })],
  [/^(?:please )?(?:turn|switch|power) on (?:the )?(.{2,40})$|^(?:please )?(?:turn|switch|power) (?:the )?(.{2,40}?) on$|^(?:please )?(?:start up|fire up|power up) (?:the )?(.{2,40})$/, (m, ctx) => bayCall('bay_switch', { on: true }, (n) => `Turn on ${n}`)([m[1] || m[2] || m[3]], ctx)],
  [/^(?:please )?(?:turn|switch|power) off (?:the )?(.{2,40}?)(?:,? we'?re done(?: with it)?(?: for the (?:night|day))?)?$|^(?:please )?(?:turn|switch|power) (?:the )?(.{2,40}?) off$|^(?:please )?shut (?:the )?(.{2,40}?) (?:down|off)(?:,? we'?re done(?: with it)?(?: for the (?:night|day))?)?$/, (m, ctx) => bayCall('bay_switch', { on: false }, (n) => `Turn off ${n}`)([m[1] || m[2] || m[3]], ctx)],
  [/^(?:please )?(?:restart|reboot) (?:the )?(?:pc|computer) (?:in|on|for|of) (?:the )?(.{2,40})$|^(?:please )?(?:restart|reboot) (?:the )?(.{2,40}?)(?:'s)? (?:pc|computer)$/, (m, ctx) => bayCall('bay_pc_restart', {}, (n) => `Restart the PC in ${n}`)([m[1] || m[2]], ctx)],
  [/^(?:please )?(?:wake(?: up)?|boot(?: up)?|start) (?:the )?(?:pc|computer) (?:in|on|for|of) (?:the )?(.{2,40})$|^(?:please )?wake (?:up )?(?:the )?(.{2,40}?)(?:'s)? (?:pc|computer)$/, (m, ctx) => bayCall('bay_pc_wake', {}, (n) => `Wake the PC in ${n}`)([m[1] || m[2]], ctx)],
  // (what follows "out of service" is read too, Oct 25 2026: "take bay 1 out of service tomorrow", "... until tuesday", "... from 2 to 4 for
  // cleaning" each took the bay out NOW with no end date - a reason may follow, never a day, a time, a length or a condition)
  [/^(?:please )?take (?:the )?(.{2,40}?) out of service\b(.*)$|^(.{2,40}?)(?:'s)? (?:is|projector is|screen is|pc is) (?:broken|down|out)\b(.*?)take (?:the|it|that) bay out of service$/, (m, ctx) => (onlyAReason(m[2] != null ? m[2] : m[4], m[2] == null) ? bayCall('bay_service_set', { in_service: false }, (n) => `Take ${n} out of service`)([m[1] || m[3]], ctx) : null)],
  [/^(?:please )?put (?:the )?(.{2,40}?) back in service$|^(.{2,40}?) is (?:fixed|working again|back up)(?:,? put it back in service)?$/, (m, ctx) => bayCall('bay_service_set', { in_service: true }, (n) => `Put ${n} back in service`)([m[1] || m[2]], ctx)],
  [/^(?:please )?rename (?:the )?(.{2,40}?) to ["']?(.{2,40}?)["']?$/, (m, ctx, raw) => { const b = oneOf(bayNames(ctx), m[1]); if (!b || !only(b, m[1])) return null; const nm = ownWords((String(raw).match(/\bto\s+(.+)$/i) || [])[1]); return nm && nm.length >= 2 && nm.length <= 40 ? { call: ['bay_details_set', { bay: b, name: nm }] } : null; }],
  // ── the menu ──
  [/^(?:we'?re|we are|we'?ve run|we ran) out of (?:the |our )?(.{2,40})$|^(?:the )?(.{2,40}?) (?:is|are) sold out$|^86 (?:the )?(.{2,40})$/, (m, ctx) => itemCall(m[1] || m[2] || m[3], ctx, (it) => ({ call: ['menu_item_sold_out', { item: it, sold_out: true }] }))],
  [/^(?:the )?(.{2,40}?) (?:is|are) back(?: on| in stock| on the menu)?$|^(?:we have|we'?ve got) (?:the )?(.{2,40}?) (?:back|again)$/, (m, ctx) => itemCall(m[1] || m[2], ctx, (it) => ({ call: ['menu_item_sold_out', { item: it, sold_out: false }] }))],
  [/^(?:make|set|change) (?:the )?(.{2,40}?) (?:price )?(?:to )?\$\s?(\d{1,4}(?:\.\d\d)?)$/, (m, ctx) => (/base price|half hour|an hour/.test(m[1]) ? null : itemCall(m[1], ctx, (it) => ({ call: ['menu_item_change', { item: it, price: money(m[2]) }] })))],
  // (OFF THE MENU HAS TWO MEANINGS, Oct 25 2026: "take the wings off the menu" put up the item deleted for good - its price, choices and
  // tax gone - though the menu's own action keeps an item off the menu for now, a seasonal one. "Delete" or "for good" is plain; a bare
  // take or remove asks which, both to tap)
  [/^(?:delete|remove|take) (?:the )?(.{2,40}?) (?:off|from) the menu(?: for good| permanently| completely)?$|^(?:delete|remove) (?:the )?(.{2,40}?) (?:for good|permanently)$/, (m, ctx) => itemCall(m[1] || m[2], ctx, (it) => (/^delete\b|\b(?:for good|permanently|completely)$/.test(m[0])
    ? { call: ['menu_item_remove', { item: it }] }
    : { ask: { question: `Take ${it} off the menu for good, or only for now (kept, to put back later)?`, calls: [{ name: 'menu_item_remove', args: { item: it } }, { name: 'menu_item_change', args: { item: it, on_menu: false } }] } }))],
  // ── money ──
  [/^(?:make|set|change) (?:the |our )?(?:base )?price (?:of a bay )?(?:to )?\$\s?(\d{1,4}(?:\.\d\d)?) (?:a|per|an) (half hour|half-hour|30 minutes|hour)$/, (m) => ({ call: ['base_price_set', /half|30/.test(m[2]) ? { per_half_hour: money(m[1]) } : { per_hour: money(m[1]) }] })],
  [/^(?:start )?(?:take|taking|charge|charging) (?:a )?\$\s?(\d{1,4}(?:\.\d\d)?) deposit (?:per|a) half hour$/, (m) => ({ call: ['deposit_set', { on: true, per_half_hour: money(m[1]) }] })],
  [/^(?:stop taking deposits|no more deposits|turn (?:the )?deposits? off)$/, () => ({ call: ['deposit_set', { on: false }] })],
  [/^tips? should go (?:in|into) (?:one|a) (?:pool|tip pool)(?: for the house)?$|^pool (?:the |all )?tips$/, () => ({ call: ['tip_prompt_set', { mode: 'pooled' }] })],
  // a discount code said plainly - its name, and a percent, dollars or minutes off; a limit or an end is the model's (never filled in)
  [/^(?:make|create|add|set up) (?:me )?(?:a |an )?(?:new )?(?:discount |promo |coupon )?code (?:called |named )?([a-z0-9_-]{2,30}) (?:for|that gives|giving|with) (?:(\d{1,3}) ?% off|\$\s?(\d{1,4}(?:\.\d\d)?) off|(\d{1,3}) (?:minutes|mins) free)$/, (m, ctx, raw) => {
    const code = (String(raw).match(/\bcode (?:called |named )?([A-Za-z0-9_-]{2,30})\b/i) || [])[1]; if (!code) return null;
    const v = m[2] ? ['percentage', Number(m[2])] : m[3] ? ['fixed', money(m[3])] : ['free_minutes', Number(m[4])];
    return { call: ['discount_code_create', { code: code.toUpperCase(), kind: v[0], value: v[1] }] }; }],
  [/^(?:stop asking for tips|turn (?:the )?tips? off|no tips)$/, () => ({ call: ['tip_prompt_set', { mode: 'off' }] })],
  [/^set (?:the )?(food|beverage|drink|drinks|bar|booking|bookings) tax (?:to )?(\d{1,2}(?:\.\d{1,3})?)\s?%$/, (m) => ({ call: ['tax_rate_set', { which: /drink|bar/.test(m[1]) ? 'beverage' : m[1].replace(/s$/, ''), rate: Number(m[2]) }] })],
  // ── bookings ──
  [/^customers can cancel (?:up to )?(\d{1,3}) hours? before$|^(?:make|set) (?:the )?cancell?ation window (?:to )?(\d{1,3}) hours?$/, (m) => ({ call: ['cancellation_window_set', { hours: Number(m[1] || m[2]) }] })],
  // ── messages ──
  [/^send (?:me )?a test email$|^test (?:the )?email$/, () => ({ call: ['email_test_send', {}] })],
  [/^send (?:the )?reminders? (\d{1,3}) (hours?|minutes?|mins?) before(?: each booking| a booking| the booking)?$/, (m) => ({ call: ['reminder_timing_set', { minutes: Number(m[1]) * (/^h/.test(m[2]) ? 60 : 1) }] })],
  [/^stop texting (?:the )?reminders?(?: - email only)?$|^(?:send )?reminders? by email only$/, () => ({ call: ['message_switch_set', { message: 'reminder', channel: 'text', on: false }] })],
  // ── the website ──
  [/^(?:take|turn) (?:the )?(?:notice|announcement|banner)(?: at the top)?(?: of the site)? (?:down|off)$|^remove (?:the )?(?:notice|announcement|banner)(?: at the top)?(?: of the site)?$/, () => ({ call: ['announcement_set', { enabled: false }] })],
  [/^put (?:a )?(?:notice|announcement|banner) (?:across|at|along) the top(?: of the site)?: (.{3,200})$/, (m, ctx, raw) => ({ call: ['announcement_set', { enabled: true, message: String(raw).replace(/^[^:]*:\s*/, '').trim() }] })],
  // (the headline is the owner's own words, a polite tail and "say" taken off; a condition or an instruction - "something about tonight",
  // "Welcome Golfers for now" - is the model's: ownWords, Oct 25 2026)
  [/^change the headline (?:on the website |on the site )?to ["']?(.{2,80}?)["']?$/, (m, ctx, raw) => { const h = ownWords(String(raw).replace(/^.*?\bto\s+/i, '').replace(/^(?:say|read)\b:?\s*/i, '')); return h && h.length >= 2 && !/^(?:something|anything|whatever|a (?:better|new|different|catchier) one\b|be (?:more|less|shorter|longer|catchier|better|friendlier|funnier|bolder)\b|mention |include |make it )/i.test(h) ? { call: ['website_headline_set', { headline: h }] } : null; }],
  [/^(?:use|switch to|make it) (original|clean|sporty|elegant|strong|sleek|warm|clubhouse|signature) fonts?(?: on the (?:web)?site)?$/, (m) => ({ call: ['website_fonts_set', { set: m[1] }] })],
  [/^(hide|show) the (gift cards?|events?|memberships?|leagues?|member portal) page(?: for now)?$/, (m) => ({ call: ['public_part_set', { part: { 'gift card': 'giftCards', 'gift cards': 'giftCards', event: 'events', events: 'events', membership: 'memberships', memberships: 'memberships', league: 'leagues', leagues: 'leagues', 'member portal': 'portal' }[m[2]], show: m[1] === 'show' }] })],
  [/^put (?:our )?phone(?: number)? ([0-9()+ .-]{7,20}) on the (?:web)?site$/, (m) => ({ call: ['website_contact_set', { phone: m[1].trim() }] })],
  // ── the unit ──
  [/^back ?up to the usb(?: stick| drive)?(?: now)?$|^back ?up now to the usb(?: stick| drive)?$/, () => ({ call: ['backup_now', { copy_to: 'usb' }] })],
  [/^back ?up(?: everything)? now$|^make a backup(?: now)?$/, () => ({ call: ['backup_now', {}] })],
  [/^install the update (tonight|now)$|^update (tonight|now)$/, (m) => ({ call: ['update_install', { when: m[1] || m[2] }] })],
  [/^stop connecting the box(?:,? i'?ll do it later)?$/, () => ({ call: ['box_connect_stop', {}] })],
  // ── staff ──
  [/^(?:hire ([a-z][a-z'-]+ [a-z][a-z'-]+)|add ([a-z][a-z'-]+ [a-z][a-z'-]+) to (?:the |our )?staff)(?:,? employee (?:number|no|#) ?(\d{1,8}))?$/, (m, ctx, raw) => { const nm = (String(raw).match(/(?:add|hire)\s+([A-Za-z][A-Za-z'-]+\s+[A-Za-z][A-Za-z'-]+)/i) || [])[1]; if (!nm || NOT_A_PERSON.test(nm)) return null; return { call: ['staff_add', Object.assign({ name: nm.replace(/\b[a-z]/g, c => c.toUpperCase()) }, m[3] ? { employee_number: m[3] } : {})] }; }],
  // ── blocks, shifts, staffed days ──
  [new RegExp(`^(?:block off|block|close) (?:the )?(.{2,30}?) for (?:a |an |the )?(tournament|event|maintenance|league night|league|party|private event)(?: on)? ${DAYW}(?:,? (?:from )?(.+?)| (all day))?$|^(?:close|block off) (?:the )?(.{2,30}?) for (maintenance|a tournament|an event) (all day) ${DAYW}$`), (m, ctx, raw) => {
    // ("... tomorrow all day": the times' own alternative takes " all day" first, and it read as no times at all - the model had the plainest
    // block there is until Oct 27 2026)
    const bayW = m[1] || m[6], kindW = m[2] || m[7], dayW = m[3] || m[9], allDay = !!(m[5] || m[8]) || /^all day$/.test(String(m[4] || '').trim());
    const date = dayOf(dayW); if (!date) return null;
    const bay = /^(?:whole facility|whole place|facility|everything|all (?:the )?bays)$/.test(norm(bayW)) ? 'whole facility' : oneOf(bayNames(ctx), bayW); if (!bay || (bay !== 'whole facility' && !only(bay, bayW))) return null;
    const kind = /tournament/.test(kindW) ? 'tournament' : /maintenance/.test(kindW) ? 'maintenance' : 'event';
    if (allDay) return { call: ['block_add', { bay, kind, date, all_day: true }] };
    const r = rangeOnly(m[4] || ''); return r ? { call: ['block_add', { bay, kind, date, start_time: r.from, end_time: r.to }] } : null; }],
  [new RegExp(`^(?:put|schedule) (.{2,40}?) (?:(?:on|for) )?${DAYW},? (?:from )?(.{3,40})$`), (m, ctx, raw) => {
    const date = dayOf(m[2]), r = dayEnd(rangeOnly(m[3])); if (!date || !r) return null;
    const shift = (staff) => ({ name: 'schedule_add_shift', args: { date, start_time: r.from, end_time: r.to, staff } });
    const who = oneOf(staffNames(ctx), m[1]); if (who) return only(who, m[1]) ? { call: ['schedule_add_shift', shift(who).args] } : null;
    // (a first name alone - "put carl on friday 4 to 10", the owner's own words on his second day - is that person when only one on the
    // roster has it, as the roster's own finder reads it (helpers.staffCode); two people with it are asked, both to tap - Oct 25 2026)
    const first = core(m[1]).trim(); if (!/^[a-z][a-z'-]+$/.test(first)) return null;
    const same = staffNames(ctx).filter(n => core(n).trim().split(' ')[0] === first);
    if (same.length === 1) return { call: ['schedule_add_shift', shift(same[0]).args] };
    // (each choice is the owner's own words with the whole name - they read back as that shift; the two calls were labelled by the
    // shift's own words on the raw "friday", "Invalid Date" - Oct 27 2026)
    const esc = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), choices = same.slice(0, 6).map(n => String(raw).trim().replace(/[.!]+$/, '').replace(new RegExp(`^((?:put|schedule)\\s+)${esc}\\b`, 'i'), `$1${n}`));
    return same.length > 1 && choices.every((c, i) => c.includes(same[i])) ? { ask: { question: `Which ${title(first)} - ${same.slice(0, 6).join(' or ')}?`, choices } } : null; }],
  [new RegExp(`^add an? open shift (?:on )?${DAYW},? (?:from )?(.{3,40})$`), (m, ctx, raw) => { const date = dayOf(m[1]), r = dayEnd(rangeOnly(m[2])); return date && r ? { call: ['schedule_add_shift', { date, start_time: r.from, end_time: r.to }] } : null; }],
  [/^copy (?:this|the) week'?s? (?:schedule|shifts) (?:to|onto|into|over to) next week$/, (m, ctx) => (ctx.today ? { call: ['schedule_copy_week', { from: ctx.today, to: require('./helpers').addDays(ctx.today, 7) }] } : null)],
  [new RegExp(`^(?:we'?ll|we will) have someone (?:in|here|there|working|on) (?:on )?${DAYW},? (?:from )?(.{3,60})$`), (m, ctx, raw) => { const date = dayOf(m[1]), r = dayEnd(rangeOnly(m[2])); return date && r ? { call: ['staffed_set_day', { date, start_time: r.from, end_time: r.to }] } : null; }],
  // ── members ──
  [/^(?:sign up|add) ([a-z][a-z'-]+ [a-z][a-z'-]+),? (\+?[\d() .-]{7,20}),? (?:on|to) (?:the )?(.{2,30}?) (?:plan|tier|membership|one|level)$/, (m, ctx, raw) => {
    const tier = oneOf(tierNames(ctx), m[3]); if (!tier || !only(tier, m[3])) return null;
    const nm = (String(raw).match(/(?:sign up|add)\s+([A-Za-z][A-Za-z'-]+\s+[A-Za-z][A-Za-z'-]+)/i) || [])[1];
    return nm ? { call: ['member_add', { name: title(nm), phone: m[2].trim(), tier }] } : null; }],
  [/^cancel (.{2,40}?)(?:'s)? membership (now|right away|today|when (?:their|the|her|his) paid (?:month|time|period) (?:runs out|ends)|at the end of (?:their|the|her|his) paid (?:month|time|period))$/, (m, ctx, raw) => {
    const when = /now|right away|today/.test(m[2]) ? 'now' : 'end_of_paid_period', who = memberSaid(ctx, raw); if (!who) return null;
    // (two members the words could be: each choice is the owner's words with that one's name, read back as that cancel - the two calls were
    // both labelled "membership_cancel", and either tap cancelled the first: Oct 27 2026)
    return who.length === 1 ? { call: ['membership_cancel', { member: who[0], when }] } : { ask: { question: `Whose membership - ${who.join(' or ')}?`, choices: who.map(w => `cancel ${w}'s membership ${m[2]}`) } }; }],
  [/^cancel (.{2,40}?)(?:'s)? membership$/, (m, ctx, raw) => { const who = memberSaid(ctx, raw); if (!who) return null;
    if (who.length > 1) return { ask: { question: `Whose membership - ${who.join(' or ')}?`, choices: who.map(w => `Cancel ${w}'s membership`) } };
    return { ask: { question: `Cancel ${who[0]}'s membership now, or when their paid time runs out?`, choices: [`Cancel ${who[0]}'s membership now`, `Cancel ${who[0]}'s membership when their paid month runs out`] } }; }],
  [/^(?:make|create|add) a (?:new )?membership (?:called|named) (.{2,40}?),? (?:(?:for|at) )?\$\s?(\d{1,5}(?:\.\d\d)?) (?:a|per) month(?:,? with (\d{1,3}) (?:free )?hours?(?: a month)?(?: included| free)?)?$/, (m, ctx, raw) => {
    // ("a membership called Bronze for $29 a month" - the name is Bronze: test-assistant A40l)
    const nm = (String(raw).match(/(?:called|named)\s+(.+?),?\s+(?:(?:for|at)\s+)?\$/i) || [])[1]; if (!nm) return null;
    return { call: ['membership_tier_create', Object.assign({ name: nm.trim(), price_monthly: money(m[2]) }, m[3] ? { hours_per_month: Number(m[3]) } : {})] }; }],
  // ── gift cards ──
  // (WHO PAID IS SAID, OR ASKED - Oct 25 2026: "make a $50 gift card as a gift" was put up as a free one, never counted as money taken,
  // though a card a customer buys as a present is the usual sale; "sell a $50 gift card as a gift" too. "As a gift" does not say who paid
  // and is asked; "sell" says it was sold; "sell ... for free" says both and is asked)
  [/^(make|issue|create|sell) a \$\s?(\d{1,4}(?:\.\d\d)?) gift card(?:\s*[-,]?\s*(?:the customer |they |someone |he |she )?(?:already )?(paid(?: for it)?|bought it|for free|as a (?:gift|present|prize|comp)|free))?$/, (m) => {
    const sell = m[1] === 'sell', tail = m[3] || '', asked = { ask: { question: `Was the $${m[2]} gift card sold, or given free?`, choices: [`Make a $${m[2]} gift card - the customer paid for it`, `Make a $${m[2]} gift card for free`] } };
    if (/paid|bought/.test(tail)) return { call: ['gift_card_issue', { amount: money(m[2]), sold: true }] };
    if (/free|prize|comp/.test(tail)) return sell ? asked : { call: ['gift_card_issue', { amount: money(m[2]), sold: false }] };
    return sell ? { call: ['gift_card_issue', { amount: money(m[2]), sold: true }] } : asked; }],
  // ── files ──
  [/^(?:give me|send me|export|get me|download) the tax (?:for )?(this month|last month|this quarter|last quarter|this year|last year)(?: as a spreadsheet)?(?: for (?:my|the) accountant)?$/, (m) => ({ call: ['tax_export', { period: m[1].replace(' ', '_') }] })],
  // ── the website and events ──
  // (THE SITE ASKED FROM OUTSIDE NOW - Oct 28 2026: the box's own answer to "is my site up yet?" (answers.js online_read) tells the owner "ask me to
  // check it from outside", and the owner's guide says so - but the box alone read nothing for it. site_check_now asks the address the way a
  // visitor would; it changes nothing on the site)
  [/^(?:please |can you |could you )?(?:check|test) (?:my |our |the )?(?:web ?site|site|address|it) (?:again )?from (?:the )?outside(?: again| now| please)?$/, () => ({ call: ['site_check_now', {}] })],
  // A PUBLIC EVENT, AND ONLY THAT (Oct 25 2026, the review: "add carl on saturday", "add sam lee tomorrow at 7", "add Robin to the schedule
  // saturday" and "add a private party for the smiths saturday at 6" each went up on the public Events page straight away - event_add takes
  // no yes): the words are an event only when the owner says "event" or the name reads as one (a league night, a scramble, a clinic ...).
  // One of the facility's own people, bays, plans or menu items, a private booking ("party for", "group of", "players"), the schedule, or a
  // name that runs on ("Robin To") is never one - the model has the words. (Its hour: eventClock, below)
  // (AN EVENT AT A BARE 7 TO 12 IS ASKED - Oct 27 2026, the review of the Oct 27 fix and maintainer's own rule, "a bare 10 asks morning or night":
  // event_add goes on the public page with no yes, and "add the Father's Day Scramble sunday at 8" went up as 8 PM, "the Memorial Day
  // Scramble monday at 9" as 9 PM. A bare 1 to 6 is still the afternoon or evening. A bare 7 to 11 is asked, both to tap, unless the
  // event's own words say which half - its name says night or evening ("League Night at 7" is 7 PM), or morning, breakfast or brunch
  // ("the Brunch Tournament at 10" is 10 AM), or the day is "tonight". A bare 12 is asked noon or midnight, each to tap; a midnight start
  // keeps the day said and says "midnight" on the page)
  [new RegExp(`^add (?:an event:? )?(.{3,40}?) (?:on )?${DAYW}(?: at (\\d{1,2}(?::\\d\\d)?\\s*(?:am|pm)?|noon|midnight))?$`), (m, ctx, raw) => {
    if (/\b(?:shift|block|special|deal|code|members?|membership|staff|bays?|book|booking|reservation|tee time|session|hours?|minutes|time|price|discount|guests?|note|gift card)\b/.test(m[1])) return null;
    // (a time in the name is the event's hours, never its title: "add the scramble 1 to 5 on saturday" went up at once as "The Scramble 1 To 5"
    // with no time, "add trivia 7-10 friday" as "Trivia 7-10" - the model has the words, and the event's own fill reads the hours: Oct 28 2026,
    // round 2f)
    // (never ages, grades or a team's size: "a clinic for ages 8 to 12", "the junior league for grades 3-5")
    if (/(?<!\b(?:ages?|aged|grades?|kids|children|juniors|boys|girls|students|levels?|teams? of|groups? of|handicaps?)\s)\b\d{1,2}(?::\d\d)?\s*(?:am|pm)?\s*(?:-|–|to|till|til|until|thru)\s*\d{1,2}(?::\d\d)?\b(?!\s*(?:-|person|man|player|ball|hole|some|years?|yrs?))|\b\d{1,2}(?::\d\d)?\s*(?:am|pm)\b/.test(m[1])) return null;
    const said = /^add an event\b/.test(m[0]) || /\bevents?\b/.test(m[1]);
    if (NOT_PUBLIC.test(m[1]) || PRIVATE_DO.test(m[1]) || namesOurs(ctx, m[1]) || (!said && !EVENT_CUE.test(m[1]))) return null;
    const date = dayOf(m[2]); if (!date) return null;
    // (the title as typed, its leading "a" or "an" off - "add a tournament" is the Tournament)
    // (up to the LAST day said, as the words were read - "add taco tuesday scramble tuesday at 6" went up titled "Taco": the title stopped at
    // the first weekday in it. Oct 27 2026)
    const nm = String((String(raw).match(new RegExp(`^add\\s+(?:an event:?\\s+)?(.+?)\\s+(?:on\\s+)?${DAYW.replace(/ /g, '\\s+')}(?:\\s+at\\s+(?:\\d{1,2}(?::\\d\\d)?\\s*(?:am|pm)?|noon|midnight))?\\s*[.!]*$`, 'i')) || [])[1] || m[1]).replace(/^(?:a|an)\s+/i, '').replace(/^(?:called|named)\s+/i, '').replace(/[,;:]+$/, '').trim();
    if (nm.length < 2) return null;
    // (a midnight start says so in words, with the clock beside it for the event's own fill - actions.js reads "12:00 AM" as a time given)
    const ev = (at) => ({ name: 'event_add', args: Object.assign({ title: title(nm), date }, at ? { description: at === '00:00' ? 'Starts at midnight (12:00 AM)' : `Starts at ${H.timeWords(at)}` } : {}) });
    if (!m[3]) return { call: ['event_add', ev().args] };
    const c = eventClock(m[3], m[1], raw, ctx, dayKeyOf(date, ctx.today)); if (!c) return null;
    if (c.time) return { call: ['event_add', ev(c.time).args] };
    const choices = c.noon ? ['noon', 'midnight'].map(x => withWord(raw, m[3], x)) : ['am', 'pm'].map(x => withHalf(raw, m[3], x)); if (choices.some(x => !x)) return null;
    // (a bare 12:30 - after noon or after midnight: "12:30 in the morning, or 12:30 at night" said the same half twice - Oct 27 2026)
    return { ask: { question: c.noon ? `${title(nm)} at noon, or at midnight?` : /^12:/.test(String(m[3]).trim()) ? `${title(nm)} at ${m[3]} in the afternoon, or ${m[3]} after midnight?` : `${title(nm)} at ${m[3]} in the morning, or ${m[3]} at night?`, choices: !c.noon && /^12:/.test(String(m[3]).trim()) ? choices.slice().reverse() : choices } }; }],
  [/^put the whole site on one page$|^make (?:it|the site|the website) (?:all )?one page$/, () => ({ call: ['website_one_page', {}] })],
  // ── the bays' setup ──
  [/^set (?:the )?(.{2,30}?) (?:thermostat|heat|heating|ac|a\/c|temp(?:erature)?) to (\d{2})(?: degrees)?$/, (m) => ({ call: ['thermostat_set', { device: `${m[1]} thermostat`.replace(/\s+thermostat thermostat$/, ' thermostat'), temperature: Number(m[2]) }] })],
  [/^charge \$\s?(\d{1,4}(?:\.\d\d)?) (more|less|extra) (?:per|a) half hour (?:for|in|on) (?:the )?(.{2,30})$/, (m, ctx) => { const b = oneOf(bayNames(ctx), m[3]); return b && only(b, m[3]) ? { call: ['bay_price_adjust_set', { bay: b, dollars_per_half_hour: (m[2] === 'less' ? -1 : 1) * money(m[1]) }] } : null; }],
  [/^keep the bays on (?:if|when) the next (?:group|session|booking) starts within (\d{1,3}) minutes$/, (m) => ({ call: ['bay_timing_set', { keep_on_between_sessions_minutes: Number(m[1]) }] })],
  [/^leave the (?:pc|computer) in (?:the )?(.{2,30}?) on (?:tonight )?(?:after (?:we )?close|past closing|after closing)$/, (m, ctx) => { const b = oneOf(bayNames(ctx), m[1]); return b && only(b, m[1]) ? { call: ['bay_close_override_set', { bay: b, skip_closing_shutdown: true }] } : null; }],
  // ── a customer booked in by the owner ("book Sam Lee, 555-201-4433, tomorrow at 7pm for an hour") - texts only with their yes,
  // never assumed (booking_make); the length asked when it was not said
  // (the length before or after the bay - "... at 7pm in Bay 1 for an hour" - and the box's own "how long" choices read back as the booking
  // they stand for: they were the owner's raw words with the length after the bay and a full stop in the middle, and the box could not read
  // a single one of them - Oct 25 2026. A bare 9, 10 or 11 is asked, morning or night, both to tap: clockAt)
  [new RegExp(`^book ([a-z][a-z'-]+(?: [a-z][a-z'-]+)?),? (\\+?[\\d() .-]{7,20}),? ${DAYW} at (\\d{1,2}(?::\\d\\d)?\\s*(?:am|pm)?|noon)(?: for (${LENGTH}))?(?: (?:in|on) (?:the )?(.{2,30}?))?(?: for (${LENGTH}))?$`), (m, ctx, raw) => {
    const nm = (String(raw).match(/^book\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)/i) || [])[1]; if (!nm) return null;
    if (m[5] && m[7]) return null;   // (two lengths said: not plain)
    const date = dayOf(m[3]), at = clockAt(m[4], raw, ctx, dayKeyOf(dayOf(m[3]), ctx.today)); if (!at || !date) return null;
    let bay; if (m[6]) { bay = oneOf(bayNames(ctx), m[6]); if (!bay || !only(bay, m[6])) return null; }
    const L = m[5] || m[7] || '', words = { one: 1, an: 1, two: 2, three: 3, four: 4 };
    const minutes = !L ? null : /and a half/.test(L) ? 90 : /minutes/.test(L) ? Number(L.match(/\d+/)[0]) : Math.round((words[L.split(' ')[0]] || Number(L.split(' ')[0])) * 60);
    const said = String(raw).trim().replace(/[.!]+$/, '').trim();
    if (!minutes) return { ask: { question: `How long is ${title(nm)}'s session?`, choices: [`${said} for an hour`, `${said} for 2 hours`, `${said} for 3 hours`] } };
    const make = (time) => ({ name: 'booking_make', args: Object.assign({ name: title(nm), phone: m[2].trim(), date, time }, bay ? { bay } : {}, { minutes }) });
    if (at.time) return { call: ['booking_make', make(at.time).args] };
    // (a bare 12: noon or midnight, each to tap - Oct 27 2026)
    const choices = at.noon ? ['noon', 'midnight'].map(x => withWord(said, m[4], x)) : ['am', 'pm'].map(x => withHalf(said, m[4], x)); if (choices.some(x => !x)) return null;
    return { ask: { question: at.noon ? `${title(nm)} at noon, or at midnight?` : /^12:/.test(String(m[4]).trim()) ? `${title(nm)} at ${m[4]} in the afternoon, or ${m[4]} after midnight?` : `${title(nm)} at ${m[4]} in the morning, or ${m[4]} at night?`, choices: !at.noon && /^12:/.test(String(m[4]).trim()) ? choices.slice().reverse() : choices } }; }],
  // ── the counter's menu: a new item in a part that is there already (a new part asks where it goes and its tax - maintainer, Oct 22 2026)
  [/^add (?:a |an )?(?:new )?(.{2,30}?) (?:for|at) \$\s?(\d{1,4}(?:\.\d\d)?) (?:called|named) (.{2,40})$|^add (?:a |an )?(?:new )?(.{2,30}?) (?:called|named) (.{2,40}?),? (?:for|at) \$\s?(\d{1,4}(?:\.\d\d)?)$/, (m, ctx, raw) => {
    const kindW = m[1] || m[4], price = money(m[2] || m[6]); if (NOT_MENU.test(kindW)) return null;
    const parts = ((ctx.facilityNamesNow || {}).menuParts || []), part = parts.find(p => { const a = norm(p).replace(/s$/, ''), b = norm(kindW).replace(/s$/, ''); return a === b || a === b + 's' || a.replace(/s$/, '') === b; });
    const nm = (String(raw).match(/(?:called|named)\s+(.+?)(?:,?\s+(?:for|at)\s+\$.*)?$/i) || [])[1]; if (!nm) return null;
    // (no part of that name - "a new beer" where the menu has Food and Drinks: which part, the owner's own to tap, or a new part of its
    // own, whose tax is then asked - never guessed, maintainer Oct 22 2026; the sandbox handoff's check, Oct 25)
    if (!part) { if (!parts.length || /\b(?:part|section|category|menu)\b/.test(kindW)) return null; const kind = kindW.replace(/^(?:new )/, '').trim();
      return { ask: { question: `Which part of the menu does ${nm.trim()} go in?`, choices: parts.slice(0, 5).map(p => `add ${nm.trim()} for $${m[2] || m[6]} to ${p}`).concat([`add a new ${kind} part with ${nm.trim()} at $${m[2] || m[6]}`]) } }; }
    return { call: ['menu_items_add', { part, items: [{ name: nm.trim(), price }] }] }; }],
  // (a new part of the menu with its first item - "add a new beer part with Ale IPA at $5": the menu's own action asks which tax it takes,
  // with the counter's taxes to tap, never guessed - test-assistant A40l)
  [/^add a (?:new )?(.{2,30}?) (?:part|section|category) with (?:a |an )?(.{2,40}?) (?:at|for) \$\s?(\d{1,4}(?:\.\d\d)?)$/, (m, ctx, raw) => {
    const r = String(raw).match(/^add\s+a\s+(?:new\s+)?(.+?)\s+(?:part|section|category)\s+with\s+(?:a\s+|an\s+)?(.+?)\s+(?:at|for)\s+\$/i); if (!r) return null;
    return { call: ['menu_items_add', { part: title(r[1].trim()), items: [{ name: title(r[2].trim()), price: money(m[3]) }] }] }; }],
  // ("add a pretzel for $8": which part of the menu is asked, the owner's own parts to tap - never guessed, maintainer Oct 22 2026; "add a
  // pretzel for $8 to Food" is put up)
  [/^add (?:a |an |some )?(?:new )?(.{2,30}?) (?:for|at) \$\s?(\d{1,4}(?:\.\d\d)?)(?: (?:to|in|under) (?:the )?(.{2,30}?)(?: part| section| menu)?)?$/, (m, ctx, raw) => {
    // (a new PART of the menu - "add a cider part with Angry Orchard at $6" - asks its tax: menu_items_add's own read, never this)
    // (a lesson, a clinic, a league or a fitting is sold as bay time, a package or an event, never a menu item - "add a lesson for $50"
    // asked only which part of the menu it went in: NOT_MENU, Oct 25 2026)
    if (/\b(?:slide|page|faq|event|shift|code|special|deal|discount|members?|membership|booking|hours?|minutes?|time|price|gift ?card|block|staff|bays?|tier|plan|session|package|fee|deposit|tip|part|section|category|menu)\b/.test(m[1]) || NOT_MENU.test(m[1])) return null;
    const parts = ((ctx.facilityNamesNow || {}).menuParts || []); if (!parts.length) return null;
    const nm = (String(raw).match(/^add\s+(?:a\s+|an\s+|some\s+)?(?:new\s+)?(.+?)\s+(?:for|at)\s+\$/i) || [])[1]; if (!nm) return null;
    const item = title(nm.trim()), price = money(m[2]);
    if (m[3]) { const part = parts.find(p => norm(p) === norm(m[3]) || norm(p).replace(/s$/, '') === norm(m[3]).replace(/s$/, '')); return part ? { call: ['menu_items_add', { part, items: [{ name: item, price }] }] } : null; }
    return { ask: { question: `Which part of the menu does the ${item} go in?`, choices: parts.slice(0, 6).map(p => `add ${nm.trim()} for $${m[2]} to ${p}`) } }; }],
  // ── the website's words ──
  [/^add (?:an? )?(?:faq|question)(?: to the (?:site|website|faq))?:\s*(.{5,200}?\?)\s*(.{2,400})$/, (m, ctx, raw) => {
    const r = String(raw).match(/:\s*(.+?\?)\s*(.+)$/); if (!r) return null;
    return { call: ['website_section_add', { kind: 'faq', items: [{ question: r[1].trim(), answer: r[2].trim().replace(/^[-–—:]\s*/, '') }] }] }; }],
  [/^add (?:a |an )?(.{2,40}?) page:\s*(.{3,600})$/, (m, ctx, raw) => {
    const r = String(raw).match(/^add\s+(?:a\s+|an\s+)?(.+?)\s+page:\s*(.+)$/i); if (!r) return null;
    return { call: ['website_page_create', { title: title(r[1].trim()), words: r[2].trim().replace(/^./, c => c.toUpperCase()) }] }; }],
  [/^add (?:a |an )?(?:new )?slide(?: under the top| at the top| to the (?:top|slides|slideshow))?:\s*(.{3,300})$/, (m, ctx, raw) => {
    const r = String(raw).match(/:\s*(.+)$/); if (!r) return null; const w = r[1].trim(), cut = w.split(/\s+[-–—]\s+/);
    return { call: ['website_slide_set', cut.length > 1 ? { title: cut[0].slice(0, 80), words: cut.slice(1).join(' - ').slice(0, 300) } : { title: w.slice(0, 80) }] }; }],
  // ── the hours, every day ("we're open 9am to 11pm every day") - a bare "9 to 11" is the morning to the night ──
  [/^(?:we'?re |we are |were |now |we'?ll be )?open (?:from )?(\d{1,2}(?::\d\d)?\s*(?:am|pm)?|noon) (?:to|till|til|until|-) (\d{1,2}(?::\d\d)?\s*(?:am|pm)?|midnight) (?:every day|everyday|daily|7 days a week|seven days a week|all week)$/, (m) => {
    const said = /am|pm|noon|midnight/.test(m[1] + m[2]);
    let r = said ? H.rangeIn(`${m[1]} to ${m[2]}`) : null;
    if (!said) { const a = Number(m[1].split(':')[0]), b = Number(m[2].split(':')[0]); if (a < 5 || a > 11 || b < 1 || b > 11) return null; r = { from: H.normTime(m[1] + 'am'), to: H.normTime(m[2] + 'pm') }; }
    return r ? { call: ['opening_hours_set', { open_time: r.from, close_time: r.to, open_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }] } : null; }],
  // ── a file of the records ("send me last month's revenue as a spreadsheet") ──
  [/^(?:send|give|get|email) me (?:the |our )?(this month|last month|this year|last year|this week|last week)'?s? (revenue|bookings|hours)(?: as a (spreadsheet|csv|excel file))?$|^(?:send|give|get|email) me (?:the |our )?(revenue|bookings|hours) (?:for )?(this month|last month|this year|last year|this week|last week)(?: as a (spreadsheet|csv|excel file))?$/, (m, ctx) => {
    const per = m[1] || m[5], what = m[2] || m[4], fmt = m[3] || m[6], r = periodDates(per, ctx.today); if (!r) return null;
    return { call: ['export_file', Object.assign({ what, from: r.from, to: r.to }, fmt ? { format: /csv/.test(fmt) ? 'csv' : 'xlsx' } : {})] }; }],
  // ── a bay's routines: a button's colour, a routine copied to the other bays ──
  [/^make (?:the )?(.{2,40}?) button (?:on|in) (?:the )?(.{2,30}?) (red|green|blue|orange|yellow|purple|grey|gray|white|black|pink|teal|gold)$/, (m, ctx, raw) => {
    const b = oneOf(bayNames(ctx), m[2]); if (!b || !only(b, m[2])) return null;
    const r = (String(raw).match(/^make\s+(?:the\s+)?(.+?)\s+button/i) || [])[1]; return r ? { call: ['routine_when_set', { bay: b, routine: r.trim(), colour: m[3] }] } : null; }],
  [/^copy (?:the )?(.{2,40}?) routine (?:on|from|in) (?:the )?(.{2,30}?) to (?:every|all the|all|each) (?:other )?bays?$/, (m, ctx, raw) => {
    const b = oneOf(bayNames(ctx), m[2]); if (!b || !only(b, m[2])) return null;
    const r = (String(raw).match(/^copy\s+(?:the\s+)?(.+?)\s+routine/i) || [])[1]; return r ? { call: ['routine_copy', { bay: b, routine: r.trim(), to: ['all'] }] } : null; }],
  // ── the bays there are, named ("we have five bays now: Bay 1, The Vault, Bay 3, Bay 4 and Bay 5") - the count said must match ──
  [/^(?:we (?:have|got)|we'?ve got|there are) (\w+) bays(?: now)?:\s*(.{3,400})$/, (m, ctx, raw) => {
    const r = String(raw).match(/:\s*(.+)$/); if (!r) return null;
    const names = r[1].split(/\s*,\s*|\s+and\s+|\s*&\s*/i).map(x => x.trim().replace(/\.$/, '')).filter(Boolean);
    const n = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[m[1]] || Number(m[1]);
    return names.length >= 1 && names.length === n ? { call: ['bays_list_set', { names }] } : null; }],
  // ── the box on the owner's domain ("connect my box to fairwaygolfdemo.com"; a part of it keeps their own site) ──
  [/^connect (?:my |the )?box to ((?:[a-z0-9-]+\.)+[a-z]{2,})$/, (m) => ({ call: ['box_connect', { addresses: [m[1]] }] })],
  [/^put the (?:booking )?(?:site|page|website) (?:on|at) ((?:[a-z0-9-]+\.){2,}[a-z]{2,})(?:\s*[-,]\s*(?:we (?:want to )?keep|keep) (?:our|the) (?:own |current |old |main )?(?:site|website)(?: as it is)?)?$/, (m) => ({ call: ['box_connect', { addresses: [m[1]], replace_existing: false }] })],
  // ── a flyer or poster ──
  [/^(?:can you |could you |please )?make (?:a |us a |me a )?(poster|flyer)(?: for| about) (?:our |the )?(.{3,60})$/, (m) => ({ call: ['flyer_make', Object.assign({ about: m[2] }, m[1] === 'poster' ? { layout: 'poster' } : {})] })],
  // ── the texts and emails the facility sends (the messages set: the box alone answered 2 of 26) ──
  // (one timing for the reminder text and the reminder email - areas/messages.js reminder_timing_set - so "change the reminder text to go out
  // a day before" is that timing, never the text's words: Oct 25 2026)
  [/^(?:send |set |change |make |move )?(?:the |our )?reminders?(?: (?:texts?|txts?|emails?|e-mails?))?(?: to(?: go out| be sent| send)?| to go out)? (?:(\d{1,3}) (hours?|hrs?|minutes?|mins?)|(an hour|a day|the day|the night)) before(?: each booking| a booking| the booking| their booking| the session)?$/, (m) => {
    const minutes = m[3] ? (/hour/.test(m[3]) ? 60 : 1440) : Number(m[1]) * (/^h/.test(m[2]) ? 60 : 1);
    return minutes >= 5 && minutes <= 4320 ? { call: ['reminder_timing_set', { minutes }] } : null; }],
  [/^turn (on|off|of) (?:the |our )?(confirmation|reminder|door ?code|cancellation|session ending|booking changed?)s? (texts?|txts?|emails?|e-mails?|text messages?)$|^(?:stop|don'?t) (?:sending|send) (?:the |our )?(confirmation|reminder|door ?code|cancellation|session ending|booking changed?)s? (texts?|txts?|emails?|e-mails?)$/, (m) => {
    const kind = MSG_SWITCH[(m[2] || m[4]).replace(/\s+/g, ' ').replace('doorcode', 'door code').replace(/changed?$/, 'changed')], ch = /^e/.test(m[3] || m[5]) ? 'email' : 'text';
    return kind ? { call: ['message_switch_set', { message: kind, channel: ch, on: m[1] === 'on' }] } : null; }],
  [/^send (?:the |our )?(confirmation|reminder|door ?code|cancellation|session ending|booking changed?)s? by (text and email|email and text|text|email)(?: both)?$/, (m) => {
    const kind = MSG_SWITCH[m[1].replace('doorcode', 'door code').replace(/changed?$/, 'changed')]; return kind ? { call: ['message_switch_set', { message: kind, channel: /and/.test(m[2]) ? 'both' : m[2], on: true }] } : null; }],
  // (THE WORDS ONLY WHEN THEY ARE SAID AS WORDS - Oct 25 2026, the review: "change the reminder text to 2 hours before" made every customer's
  // reminder read "2 hours before", and "... email to come from info@fairway.com" became the email's words, both put up straight away):
  // "to say ..." / "to read ...", "to: ...", or words in quotes. A timing ("to go out 2 hours before") is the reminder's timing (below);
  // anything else - a sender, "include the address", "be shorter" - is the model's)
  [/^(?:change|chnage|cahnge|set|make) (?:the |our )?(.{4,30}?) (text|txt|email|e-mail)(?: message)? to\b:?\s*(.{2,300})$/, (m, ctx, raw) => {
    const key = msgKey(m[1], m[2]); if (!key) return null;
    const tail = (String(raw).match(/\s+to\b(:?)\s*(.+)$/i) || []), q = /^["“'‘](.+)["”'’]$/;
    let words = null;
    if (/^(?:say|read)\b/i.test(tail[2] || '')) words = tail[2].replace(/^(?:say|read)\b\s*:?\s*/i, '');
    else if (tail[1] === ':') words = tail[2];
    else if (q.test(String(tail[2] || '').trim())) words = String(tail[2]).trim();
    words = words && words.trim(); if (words && q.test(words)) words = words.match(q)[1].trim();
    return words && words.length >= 2 ? { call: ['message_words_set', { message: key, words }] } : null; }],
  [/^(?:put|set|change|turn) (?:the |our )?(.{4,30}?) (text|txt|email|e-mail) back to (?:the |its )?(?:default|original|standard)(?: words)?$/, (m) => { const key = msgKey(m[1], m[2]); return key ? { call: ['message_words_set', { message: key, use_default: true }] } : null; }],
  [/^sign (?:our |the )?texts (?:with|as) (?:our |the )?business(?:'?s)? name$/, () => ({ call: ['texts_signed_as_set', { use_business_name: true }] })],
  [/^text me at (\+?[\d() .-]{7,20})(?: if (?:something|anything) (?:breaks|goes wrong|fails)| for (?:the )?alerts)?$/, (m) => ({ call: ['owner_alert_mobile_set', { phone: m[1].trim() }] })],
  [/^(?:stop|don'?t) (?:texting|text) me (?:the )?alerts$|^(?:stop|no more) (?:alert )?texts to me$/, () => ({ call: ['owner_alert_mobile_set', { none: true }] })],
  [/^send (?:me )?a test (?:text|txt|sms)$|^test (?:the )?(?:texts|texting)$/, () => ({ call: ['text_test_send', {}] })],
  [/^(?:skip|don'?t send) (?:this week'?s |this period'?s |the )?(?:staff )?hours(?: email| export)?$/, () => ({ call: ['hours_send_decide', { decision: 'skip' }] })],
  [/^(?:approve|send|ok) (?:this week'?s |this period'?s |the )?(?:staff )?hours(?: email| export)?$/, () => ({ call: ['hours_send_decide', { decision: 'approve' }] })],
  [/^(?:put|add) (?:an? )?(?:email |newsletter )?sign ?up (?:box|form)(?: for (?:emails|the newsletter))? on (?:the |our )?(?:web)?site$/, () => ({ call: ['email_updates_set', { on: true }] })],
  [/^(?:take|remove) (?:the )?(?:email |newsletter )?sign ?up (?:box|form) (?:off|from) (?:the |our )?(?:web)?site$/, () => ({ call: ['email_updates_set', { on: false }] })],
  [/^(?:stop|cancel) the newsletter(?: that'?s| thats| that is)?(?: going out| waiting| about to go)?$/, () => ({ call: ['newsletter_cancel', {}] })],
  // ── what the box never does, said by the box ──
  [/^(?:please )?(?:unlock|open) (?:the )?(?:front |back |main )?door(?: for (?:me|them|us))?$/, () => ({ say: 'The assistant never locks or unlocks a door. Door codes are made for each booking and work only for that booking\'s time - say "how do the door codes work" to see the timing, or open the door from your lock\'s own app.' })],
];

/** The box's own reading of the owner's words: { calls: [{ name, args }] } | { ask: { question, choices } } | { say } | null. */
// TWO REQUESTS IN ONE ("change the headline to Welcome Golfers and turn off the lights in Bay 3"): a command's own words would take the
// second as part of the first - a headline, a page, a slide, a flyer, a shift whose times run on - so the box reads none of it and the
// model has the whole (Oct 25 2026, the near-miss walk). An "and" before a doing-word is the sign; a false one only costs a model round.
const SECOND = /(?:\band\b|\bthen\b|\balso\b|[,;])\s+(?:then\s+|also\s+|please\s+|can you\s+|could you\s+)*(?:turn|switch|set|change|make|add|put|send|text|email|e-mail|book|block|cancel|hide|show|remove|delete|close|copy|start|stop|update|rename|mark|give|charge|leave|keep|move|post|print|schedule|sign up|hire|refund|unlock|lock)\b/;
// ── WHAT THE OWNER SAYS NEXT, READ AGAINST WHAT WAS JUST DONE (Oct 25 2026, the follow-ups set: the box alone answered 1 of 15) ──
// ctx.lastCall is the last thing looked up or put up in this conversation (engine.js lastCallOf). A different day, time or bay for the
// same look-up ("and Saturday?", "and at 9?", "what about Bay 3?"); the same change on another bay ("and Bay 3 too"); "turn it on"
// for the bay just named; a correction of the change just put up ("no wait, Bay 3", "sorry, I meant Sunday", "actually make it 30",
// "make it 25% instead"). Anything else - or two values that could change - goes to the model.
// (a blocks look-up starts FROM a day - its one date is "from" (areas/operations.js blocks_read): "and Saturday?" set a "date" it does not
// take, the check dropped it, and the same list came back from today - Oct 25 2026)
const DATE_KEYS = { bookings_read: ['date'], day_outlook_read: ['date'], booking_quote: ['date'], schedule_read: ['start'], staffed_read: ['from', 'to'], blocks_read: ['from'],
  block_add: ['date'], schedule_add_shift: ['date'], staffed_set_day: ['date'], event_add: ['date'], booking_make: ['date'] };
// (blocks_read and day_outlook_read take no bay, so they are not here - Oct 25 2026)
const IT_IS_BAY = new Set(['bookings_read', 'bay_read', 'booking_quote', 'bay_switch']);
const kindOf = (n) => { try { const a = require('./actions').BY_NAME.get(n); return a ? a.kind : null; } catch { return null; } };
const takesBay = (n) => { try { const a = require('./actions').BY_NAME.get(n); return !!(a && a.params && a.params.properties && a.params.properties.bay); } catch { return false; } };
const isoOf = (v, ctx) => H.normDate(v, ctx.today);
function withDay(last, word, ctx) {
  const keys = DATE_KEYS[last.name]; if (!keys) return null;
  let date;
  if (/^the day after tomorrow$/.test(word)) date = H.addDays(ctx.today, 2);
  else if (/^the day after$/.test(word)) { const was = isoOf(last.args[keys[0]] || 'today', ctx); if (!was) return null; date = H.addDays(was, 1); }
  else date = dayOf(word);
  if (!date) return null;
  const args = Object.assign({}, last.args); for (const k of keys) args[k] = date;
  if (last.name === 'schedule_read') delete args.end;
  return { call: [last.name, args] };
}
// A CHANGE ALREADY MADE IS NEVER MADE A SECOND TIME (Oct 25 2026, the review: "add Trivia Night on Saturday" went up at once, then "sorry, I
// meant Sunday" put up a SECOND event and Saturday's stayed; a $50 gift card approved, then "actually make it 100", a second card): when
// what was just done was applied (ctx.lastCall.applied, engine.js lastCallOf), a corrected value is put up again only for one setting set
// again (a price, a rate, a timing - an action named *_set). A change that made something, or a correction to another bay or day (the
// first one stays where it is), is the model's: it sees that the first was done and can change that one
// (A SETTING IS SET AGAIN ONLY WHEN IT CHANGES THE SAME ONE - Oct 27 2026, the review of the Oct 25 fix: a name ending in _set is not enough.
// deal_set, package_set and counter_special_set make a NEW deal, package or special when they are not told which one to change - their
// own "deal", "package", "special", each described "to change a ... that is there already" - and a slide, a photo or a how-it-works step
// is a new one without its number. So "actually make it 15" after a $10-off deal was made put up a second deal. The action's own params
// say which key that is, so a new action of that shape is covered without a list here)
const WHICH_KEYS = new Map();
function whichKey(n) {
  if (WHICH_KEYS.has(n)) return WHICH_KEYS.get(n);
  let k = null;
  try { const p = require('./actions').BY_NAME.get(n).params.properties || {}; k = Object.keys(p).find(x => /^to change an? .{1,40} that is there already/i.test(String(p[x].description || ''))) || ['slide', 'photo', 'step'].find(x => p[x]) || null; } catch { k = null; }
  WHICH_KEYS.set(n, k); return k;
}
const setsAgain = (last) => /_set$/.test(String(last.name || '')) && !(whichKey(last.name) && (last.args || {})[whichKey(last.name)] == null);
const doneAlready = (last) => last.applied === true && kindOf(last.name) !== 'read';
// THE SAME CHANGE ON ANOTHER BAY makes sense for these and no others (Oct 25 2026): a bay on or off, its PC, a block, out of service, its
// price - never a bay's own details (its name, its PC's address) or a booking's (another bay's 6 o'clock is another customer)
const BAY_COPY = new Set(['bay_switch', 'bay_pc_wake', 'bay_pc_restart', 'bay_power_cycle', 'block_add', 'bay_service_set', 'bay_price_adjust_set', 'bay_close_override_set']);
// A CORRECTED NUMBER KEEPS WHAT IT COUNTS (Oct 25 2026, the review: after a 20%-off code "make it $10" stayed 10% off; after "$5 less per
// half hour for The Vault" "actually make it 3" became $3 MORE, a premium; after "reminders 2 hours before" "actually make it 24" became 24
// MINUTES, put in straight away): a unit the owner says ($, dollars, %, percent, minutes, hours) must be the one the number is counted in -
// a discount code's kind follows it - and a bare amount keeps the old one's sign. A bare number for a length of time the owner may have
// said in hours is asked, both to tap; beside a time of day ("make it 8" after a booking at 7 may be 8 o'clock) it is the model's
function unitOf(key, args) {
  if (key === 'value' && args.kind) return { percentage: '%', fixed: '$', free_minutes: 'min' }[args.kind] || null;
  if (/minutes|mins/.test(key)) return 'min';
  if (/hours/.test(key)) return 'h';
  if (/price|amount|dollars|per_half_hour|per_hour|fee|cost|deposit/.test(key)) return '$';
  if (/rate|percent/.test(key)) return '%';
  return '';   // (a count, a temperature: a number and nothing else)
}
function numberFix(last, w) {
  const n = w.match(/^(\$)?\s?(\d{1,5}(?:\.\d{1,2})?)\s*(%|percent|dollars?|bucks|minutes?|mins?|hours?|hrs?)?$/); if (!n) return null;
  const args = Object.assign({}, last.args || {}), nums = Object.keys(args).filter(k => typeof args[k] === 'number'); if (nums.length !== 1) return null;
  const key = nums[0], v = Number(n[2]), u = unitOf(key, args), x = n[3] || '';
  // (a number that says WHICH one - a slide, a photo, a step, a row's id - is not a value: "make it 3" after slide 2 is another slide)
  if (/^(?:slide|photo|step|move_to|generation)$|_id$/.test(key)) return null;
  if (u === null || (n[1] && x && !/dollar|buck/.test(x))) return null;
  const said = n[1] || /dollar|buck/.test(x) ? '$' : /%|percent/.test(x) ? '%' : /^m/.test(x) ? 'min' : /^h/.test(x) ? 'h' : '';
  if (key === 'value' && args.kind) {
    if (said) args.kind = { '%': 'percentage', $: 'fixed', min: 'free_minutes', h: 'free_minutes' }[said];
    args.value = said === 'h' ? v * 60 : args.kind === 'fixed' ? money(v) : v;
    return { call: [last.name, args] };
  }
  if (u === 'min') {
    if (said === 'min') args[key] = v; else if (said === 'h') args[key] = v * 60; else if (said) return null;
    else {
      const old = Number(last.args[key]);
      if (args.time || args.start_time) return null;
      if (!Number.isFinite(old) || old % 60 === 0) {
        let p = null; try { p = require('./actions').BY_NAME.get(last.name).params.properties[key]; } catch {}
        const fits = (y) => Number.isInteger(y) && (!p || ((p.minimum == null || y >= p.minimum) && (p.maximum == null || y <= p.maximum)));
        const both = [v * 60, v].filter(fits);
        return both.length === 2 ? { ask: { question: `${v} hours or ${v} minutes?`, calls: both.map(y => ({ name: last.name, args: Object.assign({}, args, { [key]: y }) })) } } : null;
      }
      args[key] = v;
    }
    return { call: [last.name, args] };
  }
  if (said && said !== u) return null;
  args[key] = (u === '$' && Number(last.args[key]) < 0 ? -1 : 1) * money(v);
  return { call: [last.name, args] };
}
// what an owner says before the one thing they ask and changes nothing ("ok, turn it on", "great, turn it off")
const ACK = '(?:(?:ok(?:ay)?|alright|all right|great|thanks|thank you|cool|perfect|awesome|nice|got it|yes|yeah|yep|sure)[,.!]*\\s+)*';
const FOLLOW = [
  [new RegExp(`^(?:and|what about|how about|and for|ok what about)\\s+(the day after(?: tomorrow)?|${DAYW.slice(1, -1)})$`), (m, ctx, last) => (kindOf(last.name) === 'read' ? withDay(last, m[1], ctx) : null)],
  // (a bare hour read against the time just asked about - "two hours tomorrow at 6pm" then "and at 9?" is 9 PM, "at 10am" then "and at
  // 11?" is 11 AM. Oct 27 2026, the review of the Oct 25 fix: "the same side of noon" read "at 11am" then "and at 2?" as 2 AM, and "at 10am"
  // then "and at 1?" as 1 AM. Now: a later hour the same morning is the morning; a bare 1 to 8 is otherwise the evening (the brief's own
  // rule, as before Oct 25); a 9, 10 or 11 is the evening after an evening quote (5 PM on); and where the morning and the night are both as
  // likely - "and at 9?" after 11 AM or after 2 PM - the model has the words, never a guess. A look-up only, but a wrong quote is wrong)
  // (TO THE MINUTE, NOT THE HOUR - Oct 27 2026, the review of the Oct 27 fix: the hours alone were compared, so "and at 10:30?" after a quote
  // at 10 AM was the same hour and read as 10:30 PM, and "and at 10?" after 10:30 AM as 10 PM - a quote for the wrong half of the day. Now
  // the time said is compared with the time quoted in minutes: later the same morning is the morning; the very same time again can only
  // mean the other half; earlier the same morning is the evening for a bare 1 to 8 (the brief's rule) and the model's for a 9, 10 or 11 -
  // "and at 10?" after 10:30 AM may be half an hour earlier or the night, so it is never guessed)
  // (THE BARE-HOUR RULE - Oct 27 2026, the review of round 2c - the two rules above are replaced: "and at 6?" after a quote at 6:30 AM - half
  // an hour earlier, at a place open from 6 - was quoted for 6 PM ("an earlier bare 1 to 6 is the evening"), and "and at 7?" after 11 AM went
  // to the model. The quote just given is no day-part word: the one rule, helpers.clockAtWords, reads the hour with the facility's hours
  // for that day - the one half of the day the place is open then is the quote; both halves open, or neither, are asked, each to tap ("6 AM"
  // or "6 PM", quoted as tapped). At a place open 10 to 11, "and at 11?" after 10 AM is still 11 AM and "and at 9?" after 6 PM 9 PM)
  [/^(?:and|what about|how about)\s+(?:at\s+)?(\d{1,2}(?::\d\d)?\s*(?:am|pm)?|noon)$/, (m, ctx, last) => {
    if (last.name !== 'booking_quote' || !timeOf(m[1])) return null;
    const r = H.clockAtWords(m[0], m[1], ctx.hours, { day: dayKeyOf(last.args.date, ctx.today) }); if (!r) return null;
    if (r.time) return { call: ['booking_quote', Object.assign({}, last.args, { time: r.time })] };
    const labels = r.ask.map(t => H.clockSay(H.clockMin(t)).replace(/^./, c => c.toUpperCase()));
    return { ask: { question: `${labels[0]}, or ${labels[1]}?`, calls: r.ask.map(t => ({ name: 'booking_quote', args: Object.assign({}, last.args, { time: t }) })), labels } }; }],
  // ("and Bay 3 too", "also Bay 3": after a look-up, that look-up for the bay; after a change, the same change on that bay (BAY_COPY), and
  // when the first was never done - the owner moved on while its card waited, or said no - both are put up, "too" meaning both. "What
  // about Bay 3?", "how about Bay 3?" and "and Bay 3?" after a change are a question as often as an order (how is that bay doing?) and
  // go to the model: Oct 25 2026, the review)
  // (and "and Bay 3" with no question mark is the same words - maintainer types without one: after a change only "too", "as well" or "also" says
  // the same change again; a bare "and the vault" after "turn on Bay 1" switched The Vault on with no card - Oct 27 2026)
  // (and "also" ASKED is a question still - Oct 27 2026, the review of that fix: dropping the question guard let "also the vault?" and "also
  // bay 3?" after a change copy it, The Vault switched on at once with no card. After a change the words copy it only when they say "too" or
  // "as well", or say "also" without asking; "also the vault?", "and the vault?" and "what about the vault" are the model's)
  [/^(and|what about|how about|also)\s+(?:the\s+)?(.{2,30}?)(\s+too|\s+as well)?$/, (m, ctx, last, words, asked) => {
    const bay = oneOf(bayNames(ctx), m[2]); if (!bay || !only(bay, m[2].replace(/\b(?:too|as well)\b/g, ' ')) || !takesBay(last.name)) return null;
    if (kindOf(last.name) === 'read') return { call: [last.name, Object.assign({}, last.args, { bay })] };
    if (!last.args.bay || last.args.bay === bay || !BAY_COPY.has(last.name) || /about/.test(m[1]) || !(m[3] || (m[1] === 'also' && !asked))) return null;
    const again = { name: last.name, args: Object.assign({}, last.args, { bay }) };
    return { calls: last.applied === false ? [{ name: last.name, args: Object.assign({}, last.args) }, again] : [again] }; }],
  // ("it" is the bay only when what was just done was about the bay itself - after a plug or a TV was put on a bay, "turn it on" is
  // that device, and goes to the model: test-smarthome A1) ("ok, turn it on" with its comma - Oct 25 2026)
  [new RegExp(`^${ACK}(?:please\\s+)?(?:turn|switch) it (on|off)(?:,?\\s+please)?$|^${ACK}(?:turn|switch) (on|off) it$`), (m, ctx, last) => (IT_IS_BAY.has(last.name) && last.args && last.args.bay ? { call: ['bay_switch', { bay: last.args.bay, on: (m[1] || m[2]) === 'on' }] } : null)],
  [/^(?:(?:no,? wait|wait|no|nope|sorry|actually|oops|my bad|scratch that)\b[,.!]*\s*)?(?:(?:i meant|i mean|make it|change it to|make that|it'?s|use)\s+)(.{1,40}?)(?:\s+instead)?$|^(?:no,? wait|wait|no|nope|sorry|actually|oops|my bad)\b[,.!]*\s+(.{1,40}?)(?:\s+instead)?$/, (m, ctx, last) => {
    const w = (m[1] || m[2] || '').trim(), args = Object.assign({}, last.args || {}), done = doneAlready(last);
    // a bay (once the first is done, another bay is a second change - the model's)
    const bay = oneOf(bayNames(ctx), w); if (bay && only(bay, w)) { if (done || !takesBay(last.name) || !args.bay) return null; args.bay = bay; return { call: [last.name, args] }; }
    // a day (the same)
    if (new RegExp(`^${DAYW}$`).test(w)) return !done && DATE_KEYS[last.name] ? withDay(last, w, ctx) : null;
    // a number: the one number the change carries ("make it 30", "25% instead", "$30") - set again only on a setting
    return done && !setsAgain(last) ? null : numberFix(last, w); }],
];
// what goes before a command and changes nothing ("ok turn on The Vault", "great, now block off Bay 1 ...")
const LEAD = /^(?:(?:ok(?:ay)?|alright|all right|great|thanks|thank you|cool|perfect|awesome|nice|got it|now|and now)[,.!]?\s+)+/;
// ("by text and email" names two channels, not a second request)
// ("X is fixed, put it back in service" is one request said twice, not two)
const twoAsks = (t) => SECOND.test(t.replace(/\b(?:texts?|txts?|sms) and e-?mails?\b|\be-?mails? and (?:texts?|txts?|sms)\b/g, 'both ways').replace(/,?\s*(?:so\s+|please\s+)?(?:put it back in service|take it out of service)$/, ' (the same)'));
// (what comes before the one request and asks nothing - "ok, turn on Bay 3", "no wait, make it 30": the comma after it is not a second
// request. Until Oct 25 2026 it was read as one, and every correction typed with a comma went to the model)
const LEADS = /^(?:(?:ok(?:ay)?|alright|all right|great|thanks|thank you|cool|perfect|awesome|nice|got it|now|and now|yes|yeah|yep|sure|no,? wait|wait|no|nope|sorry|actually|oops|my bad|scratch that)\b[,.!]*\s*)+/;
function match(words, ctx) {
  let t = norm(words); if (!t || t.length > 220 || twoAsks(t.replace(LEADS, ''))) return null;
  // (a follow-up may be asked - "and Saturday?" - a command never is)
  // (what was just done counts only for the owner's very next words, and never once a question was asked after it - the words may be its
  // answer (ctx.lastCall.turnsAgo / afterQuestion, engine.js lastCallOf - Oct 25 2026). A follow-up may put up two changes, or ask)
  // (turnsAgo is counted before the newest words are added, so 0 is the turn just before them - engine.js lastCallOf, and run() keeps
  // ctx.lastCall only at 0. Until Oct 27 2026 this took 1 as fresh too, one message late; the engine hid it)
  const lc = ctx && ctx.lastCall, fresh = !!(lc && lc.name) && !(typeof lc.turnsAgo === 'number' && lc.turnsAgo > 0) && lc.afterQuestion !== true;
  const last = fresh ? lc : null, asked = /\?\s*$/.test(t), tf = t.replace(/\s*\?+$/, '');
  if (last) for (const [re, fn] of FOLLOW) { const m = tf.match(re); if (!m) continue; let r = null; try { r = fn(m, ctx || {}, last, words, asked); } catch { r = null; } if (r) return r.ask ? r : { calls: r.calls || [{ name: r.call[0], args: r.call[1] }] }; }
  if (/\?$/.test(t)) return null;
  t = t.replace(LEAD, '');
  const found = [];
  for (const [re, fn] of INTENTS) { const m = t.match(re); if (!m) continue; let r = null; try { r = fn(m, ctx || {}, String(words).replace(/^\s*(?:(?:ok(?:ay)?|alright|all right|great|thanks|thank you|cool|perfect|awesome|nice|got it|now|and now)[,.!]?\s+)+/i, '')); } catch { r = null; } if (r) found.push(r); }
  if (!found.length) return null;
  // (two rules that read the same change are one reading, never a "did you mean" between twins - "send the reminder 2 hours before
  // each booking" matched two, and the box asked which of two identical cards)
  const seen = new Set(), calls = found.filter(r => r.call).filter(r => { const k = JSON.stringify(r.call); if (seen.has(k)) return false; seen.add(k); return true; });
  if (calls.length === 1 && found.every(r => r.call)) return { calls: [{ name: calls[0].call[0], args: calls[0].call[1] }] };
  if (found.length === 1) { const r = found[0]; return r.call ? { calls: [{ name: r.call[0], args: r.call[1] }] } : r; }
  // (two readings of the same words: the box asks which - never picks one itself)
  if (calls.length > 1) return { ask: { question: 'Did you mean one of these?', calls: calls.slice(0, 3).map(r => ({ name: r.call[0], args: r.call[1] })) } };
  return found[0];
}

module.exports = { match, INTENTS, oneOf, dayOf, timeOf, msgKey, privateDo, ownersDo, second: (w) => twoAsks(norm(w)) };
