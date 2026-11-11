// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/setupanswers.js - THE OWNER'S PLAIN ANSWER TO THE BOX'S OWN SETUP QUESTION, TAKEN AS SAID (BA Core 2 AI,
// Oct 22 2026)
//
// The customer's day one on the laptop's 4B: asked "what's your city and state?", the owner said "Omaha, Nebraska" and the model
// answered "City and state set to Omaha, Nebraska" with no tool called - the city was never set, on two runs in five. maintainer: "we
// need to guide them especily the first setup". A setup question has a short, known answer, so when the box's own last question
// asked for a setup step that is not done, the owner's words answer it plainly, and the model made no change of it, the box
// puts that change in front of the owner itself - from the owner's own words, through the same action and the same card a
// model's call gets. Anything not plainly one answer (two prices, hours by day, a question back) is left to the model.
'use strict';
const { normTime, normDays } = require('./helpers');

const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };
const NAMES = new Map(Object.entries(STATES).map(([c, n]) => [n.toLowerCase(), n]));
// two letters that are everyday words too ("we're in", "or"): a state only when written in capitals or after a comma
const WORDLIKE = new Set(['in', 'or', 'me', 'ok', 'hi', 'oh', 'la', 'pa', 'ma', 'de', 'co', 'id', 'al', 'ga', 'mo', 'wa']);
const cap = (w) => w.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const wordsIn = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const plain = (t) => String(t || '').trim().replace(/[‘’ʼ]/g, "'");

// "Omaha, Nebraska" / "omaha ne" / "we're in Council Bluffs, Iowa 51501" -> { city, state[, zip] }
function cityState(words) {
  let s = plain(words).replace(/[.!]+$/, '').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ');
  s = s.replace(/^(?:(?:we(?:'re| are)|i'?m|it'?s|our (?:place|facility|business|shop|location) is|the (?:place|facility|business) is)\s+)?(?:(?:located|based)\s+)?(?:in|at|out of)\s+/i, '');
  let zip;
  const z = s.match(/,?\s(\d{5})(?:-\d{4})?$/); if (z) { zip = z[1]; s = s.slice(0, z.index).trim(); }
  if (/[?\d@/]/.test(s) || wordsIn(s) > 7) return null;
  const w = s.split(' ');
  for (let n = Math.min(3, w.length - 1); n >= 1; n--) {
    const tail = w.slice(-n).join(' '), city = w.slice(0, -n).join(' ').replace(/,$/, '').trim();
    const comma = /,$/.test(w[w.length - n - 1] || '');
    let state = NAMES.get(tail.toLowerCase());
    if (!state && n === 1 && /^[A-Za-z]{2}$/.test(tail) && STATES[tail.toUpperCase()] && (comma || tail === tail.toUpperCase() || !WORDLIKE.has(tail.toLowerCase()))) state = tail.toUpperCase();
    if (!state || !city || !/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(city) || wordsIn(city) > 4) continue;
    return Object.assign({ city: city === city.toLowerCase() ? cap(city) : city, state }, zip ? { zip } : {});
  }
  return null;
}

// "required" / "make them optional" / "no waivers" -> the waiver mode; nothing when it says two things or "not yet"
function waiverMode(words) {
  const s = plain(words).toLowerCase();
  if (wordsIn(s) > 14 || /\b(?:yet|later|not sure|don'?t know)\b/.test(s)) return null;
  const t = s.replace(/\b(?:not|n't) (?:be )?(?:required|mandatory)\b|\bdon'?t require\b|\bno need to sign\b/g, ' optional ');
  const said = [];
  if (/\b(?:required|require|mandatory|must sign|everyone (?:has to |must )?signs?|have to sign|needs? to sign)\b/.test(t)) said.push('required');
  if (/\b(?:optional|offer(?:ed)?|up to them|if they want)\b/.test(t)) said.push('optional');
  if (/\bno waivers?\b|^\s*none\b|\b(?:turn(?:ed)? )?(?:them |it |waivers )?off\b|\bdon'?t (?:need|want|use|do) (?:a |any )?waivers?\b|\bwithout (?:a |any )?waivers?\b|\bskip (?:the )?waivers?\b/.test(t)) said.push('off');
  return said.length === 1 ? said[0] : null;
}

// "$40 an hour" / "20 per half hour" / "40" (the question said per hour) -> base_price_set's arguments
function price(words, asked) {
  const s = plain(words).toLowerCase();
  if (wordsIn(s) > 16 || /\b(?:weekends?|peak|members?|kids?|before|after|until|except|more|less|extra|off|cheaper|premium|plus|discount)\b/.test(s)) return null;
  const amounts = [...s.matchAll(/\$\s?(\d{1,4}(?:\.\d{1,2})?)|(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars|bucks)\b/g)];
  let amount = amounts.length === 1 ? Number(amounts[0][1] || amounts[0][2]) : null;
  if (amount === null && !amounts.length) { const bare = s.match(/^\s*(?:it'?s\s+|about\s+)?(\d{1,4}(?:\.\d{1,2})?)\s*(?:an? |per |\/ ?)?(?:hour|hr|half[- ]hour)?\s*\.?\s*$/); if (bare) amount = Number(bare[1]); }
  if (amount === null || !(amount > 0) || amount > 1000) return null;
  // nothing else in the words but the price: "The Vault is $30 per half hour" is one bay's, never every bay's
  const left = s.replace(amounts.length ? amounts[0][0] : String(amount), ' ').replace(/\b(?:half[- ]hour|half an hour|30 ?min(?:ute)?s?|hour|hr|hourly|dollars|bucks)\b/g, ' ')
    .replace(/\b(?:our|the|price|prices|pricing|is|it'?s|its|we|charge|rate|base|bays?|each|every|per|a|an|for|all|about|around|usually|just|ok|okay|make|it|set|to|yeah|yes|um|that'?s|be|will|would|like|session|sessions|regular|standard|normal|single|one)\b/g, ' ')
    .replace(/[\s,.!\/-]+/g, '');
  if (left) return null;
  const half = /\b(?:half[- ]hour|half an hour|30 ?min(?:ute)?s?)\b/, hour = /\b(?:hour|hr|hourly)\b/;
  const unit = half.test(s) ? 'half' : hour.test(s) ? 'hour' : half.test(asked || '') ? 'half' : hour.test(asked || '') ? 'hour' : null;
  return unit === 'half' ? { per_half_hour: amount } : unit === 'hour' ? { per_hour: amount } : null;
}

// (several changes from one answer: ['multi', [[action, args], ...]] - the base price's card, then each peak price's)
const withPeaks = (w) => { const m = prices(w); return m ? ['multi', [['base_price_set', m.base]].concat(m.windows.map(x => ['price_window_add', x]))] : null; };
// A PRICE AND ITS PEAK PRICES, SAID AT ONCE (Oct 22 2026, the walk-through on the 4B: "40 an hour, 50 an hour after 5pm and weekends"
// was put up as booking rules nobody said) -> { base: base_price_set's arguments, windows: [price_window_add's arguments] }, or null
// when any part does not read plainly (the model then asks)
function prices(words) {
  const s = plain(words).toLowerCase().replace(/[–—]/g, '-');
  if (wordsIn(s) > 40 || /\?|\b(?:members?|kids?|juniors?|seniors?|students?|military|league|per (?:person|player)|deposit|food|drinks?|beer)\b/.test(s)) return null;
  const AMT = /(?:\$\s?(\d{1,4}(?:\.\d{1,2})?)|\b(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars|bucks)?(?=\s*(?:an? |per |\/ ?)(?:hour|hr|half[- ]hour)\b|\s*(?:dollars|bucks)\b))(?:\s*(?:dollars|bucks))?(?:\s*(?:an? |per |\/ ?)(half[- ]hour|half an hour|hour|hr))?/g;
  const found = [...s.matchAll(AMT)].map(m => ({ at: m.index, end: m.index + m[0].length, amount: Number(m[1] || m[2]), unit: m[3] ? (/half/.test(m[3]) ? 'half' : 'hour') : null }));
  // (a later price said bare - "20 per half hour, 25 on weekends": a number after a comma or "and", before what it is for)
  // ("50 bucks an hour, 60 fri and sat after 5" - the short day names too: the 4B walk-through, Oct 22 2026)
  for (const m of s.matchAll(/(?:,|\band)\s*(\d{1,4}(?:\.\d{1,2})?)(?=\s+(?:on|for|after|before|from|weekends?|weekdays?|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b)/g)) {
    const at = m.index + m[0].indexOf(m[1]);
    if (!found.some(f => at >= f.at && at < f.end)) found.push({ at, end: at + m[1].length, amount: Number(m[1]), unit: null });
  }
  found.sort((a, b) => a.at - b.at);
  if (found.length < 2 || found.length > 4 || found.some(f => !(f.amount > 0) || f.amount > 1000)) return null;
  const unit = (found.find(f => f.unit) || {}).unit; if (!unit) return null;
  const cond = (i, after) => after ? s.slice(found[i].end, i + 1 < found.length ? found[i + 1].at : s.length) : s.slice(i ? found[i - 1].end : 0, found[i].at);
  const COND = /\b(?:after|before|from|weekends?|weekdays?|evenings?|nights?|mon|tues?|wed|thu|fri|sat|sun|(?:mon|tues|wednes|thurs|fri|satur|sun)days?)\b/;
  const after = !COND.test(cond(0, false).replace(/^[\s\S]*\b(?:is|charge|it'?s|price)\b/, ''));
  // (a bare hour here is only the box's first reading - "after 5" as 5 PM: the engine reads THE BARE-HOUR RULE over every price window it
  // puts up, with the facility's hours, and asks where it is not certain. Until Oct 27 2026 these calls skipped it (ownClockOf), and
  // "$15 an hour before 11 on weekdays" went up as Mon-Fri 12:00 AM - 11:00 PM: the whole weekday at the discount - the critic of round 2c)
  const hm = (t) => normTime(/\d\s*(?:am|pm|a|p)$/.test(t) || /noon|midnight/.test(t) ? t : (Number(t.split(':')[0]) >= 1 && Number(t.split(':')[0]) <= 11 ? t + 'pm' : t));
  const read = found.map((f, i) => {
    const c = cond(i, after).replace(/\b(?:and|an hour|per hour|a half hour|on|the|at|is|it'?s|for|then|but|,)\b/g, ' ');
    const out = { amount: f.amount, parts: [] };
    if (!COND.test(c)) return out;
    if (/\b(?:evenings?|nights?)\b/.test(c) && !/\b(?:after|from)\s+\d/.test(c)) { out.bad = true; return out; }
    const aft = c.match(/\b(?:after|from)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?|noon)/), bef = c.match(/\bbefore\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?|noon)/);
    const dayW = c.replace(/\b(?:after|from|before)\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?|noon)/g, ' ');
    const days = /\b(?:weekends?|weekdays?|mon|tue|wed|thu|fri|sat|sun)/.test(dayW) ? normDays(dayW.replace(/\b(?:all day|every|on|and)\b/g, ' ')) : null;
    if (/\b(?:weekends?|weekdays?|mon|tue|wed|thu|fri|sat|sun)/.test(dayW) && !days) { out.bad = true; return out; }
    // "after 5pm and weekends": two times the price holds - weekday evenings, and the weekends all day; "after 5 on weekends": one
    const and = aft && days && /(?:\d\s*(?:am|pm|a|p)?|noon)\s*(?:and|&|,|\+|plus|or)\s*(?:all day )?(?:on |all )?(?:weekends?|(?:sat|sun|fri)\w*)/.test(cond(i, after));
    const t = aft ? hm(aft[1]) : null, b = bef ? hm(bef[1]) : null;
    if ((aft && !t) || (bef && !b)) { out.bad = true; return out; }
    if (and) { out.parts.push({ days: ALL_DAYS.filter(d => !days.includes(d)), from: t, to: '00:00' }, { days, from: '00:00', to: '00:00' }); }
    else if (t || b || days) out.parts.push({ days: days || ALL_DAYS.slice(), from: t || '00:00', to: b || '00:00', before: !t && bef ? bef[1].trim() : null });
    return out;
  });
  if (read.some(r => r.bad)) return null;
  // the base: the price said with no condition, or the one for the weekdays / before a time when every other price has its own
  let bi = read.findIndex(r => !r.parts.length);
  if (bi < 0) bi = read.findIndex(r => r.parts.length === 1 && (r.parts[0].to !== '00:00' && r.parts[0].from === '00:00' || r.parts[0].days.join() === 'mon,tue,wed,thu,fri' && r.parts[0].from === '00:00'));
  if (bi < 0 || read.filter((r, i) => i !== bi && !r.parts.length).length) return null;
  const per = (n) => unit === 'half' ? { price_per_half_hour: n } : { price_per_hour: n };
  const DN = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  // (a window from the start of the day to a time the owner said - "before 11" - is named with their own words: "Weekdays before 11". It was
  // "Weeknights" for the whole weekday until Oct 27 2026, and the hour's half is the engine's to read)
  const daysName = (p) => { const d = p.days.join(); return d === 'sat,sun' ? 'Weekends' : d === 'mon,tue,wed,thu,fri' ? 'Weekdays' : d === ALL_DAYS.join() ? 'Every day' : p.days.map(x => DN[x]).join(' '); };
  const nameOf = (p) => { if (p.before && p.from === '00:00') return `${daysName(p)} before ${p.before}`.slice(0, 40); const d = p.days.join(); const when = d === 'sat,sun' ? 'Weekends' : d === 'mon,tue,wed,thu,fri' ? 'Weeknights' : d === ALL_DAYS.join() ? (p.from !== '00:00' ? 'Evenings' : 'Peak') : p.days.map(x => DN[x]).join(' '); return (when === 'Weekends' && p.from !== '00:00' ? 'Weekend evenings' : !/^(?:Weekends|Weeknights|Evenings|Peak)$/.test(when) && p.from !== '00:00' ? when + ' evenings' : when).slice(0, 40); };
  const windows = [];
  for (const [i, r] of read.entries()) {
    if (i === bi) continue;
    for (const p of r.parts) {
      if (p.from !== '00:00' && p.to !== '00:00' && !(p.to > p.from)) return null;
      // (a time after the base's own "before 5" is the base's: "35 before 5, 45 after" - one window after 5 is enough)
      windows.push(Object.assign({ name: nameOf(p), days: p.days, start_time: p.from, end_time: p.to }, per(r.amount)));
    }
  }
  // (the base's own condition - "weekdays", "before 5" - is the time no window covers, so it needs no window of its own)
  return windows.length && windows.length <= 4 ? { base: unit === 'half' ? { per_half_hour: read[bi].amount } : { per_hour: read[bi].amount }, windows } : null;
}

// "10am to 11pm every day" / "we're open 10 to 11" / "9am-midnight weekdays" / "we open at 8am and close at 10pm" / "noon to
// midnight, every day but Monday" -> opening_hours_set's arguments
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
// the words between two times and the times themselves as people type them: "5am tell midnihgt" (maintainer's try box, Oct 22 2026), "noon
// untill 10", "10 thru 11"
const typedHours = (t) => t.replace(/\b(?:tell|til+|untill?|unitl|untl|unti|till?l|thru|through|too)\b/g, 'to').replace(/\bmid ?n[a-z]{1,6}\b/g, 'midnight').replace(/\bnoo+n\b/g, 'noon').replace(/\b12 ?midnight\b/g, 'midnight');
// OPEN ALL THE TIME (maintainer, Oct 25 2026 - a members' club open "24/7"): "24/7", "24 hours", "around the clock", "we never close" - and only
// that: days, times or an exception beside it ("24 hours on weekends") are hours of their own, never the whole week
function always(words) {
  const s = plain(words).toLowerCase();
  return wordsIn(s) <= 12 && /\b24\s*(?:\/|-|x|\s)\s*7\b|\b24 ?(?:hours|hrs?|h)\b(?: a day)?|\baround the clock\b|\bnever clos(?:e|ed|es)\b|\balways open\b|\ball day,? every day\b|\bday and night\b/.test(s)
    && !/\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\bweek ?(?:ends?|days?)\b|\b(?:except|but|closed|only)\b|\d\s*(?:am|pm|a|p)\b|\bnoon\b|\bmidnight\b/.test(s);
}
function hours(words) {
  const s = typedHours(plain(words).toLowerCase().replace(/\./g, '').replace(/[–—]/g, '-'));
  if (wordsIn(s) > 34 || /\bby appointment\b/.test(s)) return null;
  const T = '(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a|p)?|noon|midnight)';
  const ranges = [...s.matchAll(new RegExp(`${T}\\s*(?:to|-|until|till|til|through|thru)\\s*${T}`, 'g'))];
  // SOME DAYS ON HOURS OF THEIR OWN (Oct 22 2026, maintainer's try box: "noon to 10pm weekdays and 9am to midnight on weekends"; the
  // customer's day one, Oct 21: "10 to 11, and till 1am Friday and Saturday") - each set of hours with the days said beside it
  if (ranges.length > 1 || (ranges.length === 1 && new RegExp(`\\b(?:till|until|til|to|open (?:till|until|to))\\s+${T}`).test(s.replace(ranges[0][0], ' ')))) return byDay(s, ranges, T);
  if (wordsIn(s) > 18) return null;
  let range = ranges.length === 1 ? ranges[0] : null;
  if (!range && !ranges.length) range = s.match(new RegExp(`\\bopen(?:s|ing)?\\s+(?:at\\s+|from\\s+)?${T}\\b[^\\d]{0,24}?\\bclos(?:e|es|ing)\\s+(?:at\\s+)?${T}`));
  if (!range) return null;
  const pr = pair(range[1].trim(), range[2].trim());
  if (!pr) return null;
  const [open, close] = pr;
  const rest = s.replace(range[0], ' ');
  const out = { open_time: open, close_time: close };
  // the days: every day, every day but some ("closed Mondays"), or the days named
  const but = rest.match(/\b(?:every ?day|daily|7 days(?: a week)?|seven days(?: a week)?|all week)\b[\s,]*(?:but|except(?: for)?|other than|apart from|besides)\s+(?:on\s+)?(.+)$/) || rest.match(/\bclosed (?:on |all day )?(.+)$/);
  if (but) { const ex = normDays(but[1]); if (!ex || !ex.length || ex.length >= 7) return null; out.open_days = ALL_DAYS.filter(d => !ex.includes(d)); }
  else if (/\b(?:closed|except|but|apart from|other than|not on)\b/.test(rest)) return null;
  else if (/\b(?:every ?day|daily|7 days|seven days|all week|week ?round|everyday)\b/.test(rest)) out.open_days = ALL_DAYS.slice();
  else if (/\b(?:mon|tue|wed|thu|fri|sat|sun|week ?days?|week ?ends?)/.test(rest)) { const d = normDays(rest); if (!d) return null; out.open_days = d; }
  return out;
}
// an opening and a closing as said -> [HH:MM, HH:MM], or null: an hour said bare - opening from 7 to 11 is the morning, 12 is noon,
// 1 to 4 the afternoon (5 or 6 could be either - the model asks); a bare closing hour is the evening when that is after the opening
// ("10 to 11" is 10 AM to 11 PM)
function pair(o, c) {
  const ap = (x) => /(?:am|pm|a|p)$/.test(x) || /noon|midnight/.test(x);
  let open = normTime(o), close = normTime(c);
  if (!open || !close) return null;
  if (!ap(o)) { const h = Number(open.slice(0, 2)); if (h >= 5 && h <= 6) return null; if (h >= 1 && h <= 4) open = String(h + 12).padStart(2, '0') + open.slice(2); }
  if (!ap(c)) { const h = Number(close.slice(0, 2)); if (h >= 1 && h <= 11 && String(h + 12).padStart(2, '0') + close.slice(2) > open) close = String(h + 12).padStart(2, '0') + close.slice(2); else if (h === 12) close = '00:00'; }
  return open === close ? null : [open, close];
}
const DAY_WORDS = /\b(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:days?)?|week ?days?|week ?ends?|every ?day|daily|(?:the )?rest of the week|other days)\b/;
// several sets of hours, each with its days -> opening_hours_set's arguments with other_hours, or null when it does not read plainly
function byDay(s, ranges, T) {
  // the sets: each range, and a closing said alone for some days ("till 1am Friday and Saturday" opens at the usual time)
  const sets = ranges.map(m => ({ at: m.index, end: m.index + m[0].length, o: m[1].trim(), c: m[2].trim() }));
  for (const m of s.matchAll(new RegExp(`\\b(?:till|until|til|to|open (?:till|until|to))\\s+${T}`, 'g'))) if (!sets.some(x => m.index >= x.at && m.index < x.end)) sets.push({ at: m.index, end: m.index + m[0].length, o: null, c: m[1].trim() });
  sets.sort((a, b) => a.at - b.at);
  if (sets.length < 2 || sets.length > 4 || /\b(?:closed|except|but|apart from|other than|not on|by appointment)\b/.test(s) && !/\bclosed (?:on )?(?:mon|tues?|wed|thu|fri|sat|sun)\w*\b/.test(s)) return null;
  // the days of each: said after its hours ("noon to 10 weekdays") or before them ("weekdays noon to 10") - whichever the first set shows
  const gap = (i, after) => after ? s.slice(sets[i].end, i + 1 < sets.length ? sets[i + 1].at : s.length) : s.slice(i ? sets[i - 1].end : 0, sets[i].at);
  const after = !DAY_WORDS.test(gap(0, false)) || DAY_WORDS.test(gap(0, true)) && DAY_WORDS.test(gap(sets.length - 1, true));
  const closedM = s.match(/\bclosed (?:on )?((?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)\w*(?:\s*(?:,|and|&)\s*(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)\w*)*)/);
  const closed = closedM ? (normDays(closedM[1]) || []) : [];
  const read = sets.map((x, i) => {
    let w = gap(i, after).replace(/\bclosed (?:on )?(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)\w*(?:\s*(?:,|and|&)\s*(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)\w*)*/g, ' ');
    const rest = /\b(?:every ?day|daily|(?:the )?rest of the week|other days|otherwise|all week)\b/.test(w) && !/\b(?:mon|tue|wed|thu|fri|sat|sun|week ?days?|week ?ends?)/.test(w.replace(/\bevery ?day\b/, ''));
    const days = rest ? null : DAY_WORDS.test(w) ? normDays(w.replace(/\b(?:and|on|from|open|we'?re|we are|hours?|are|is|the|at|till|until|to)\b/g, ' ')) : null;
    return { o: x.o, c: x.c, days, rest };
  });
  if (read.some(r => r.days === undefined) || read.some(r => !r.days && !r.rest && read.filter(q => !q.days).length > 1)) return null;
  // the usual hours: the set said without days (or "the rest of the week"), else the set with the most days
  let ui = read.findIndex(r => !r.days);
  if (ui < 0) ui = read.reduce((b, r, i) => (r.days.length > read[b].days.length ? i : b), 0);
  const u = read[ui];
  if (!u.o) return null;
  const up = pair(u.o, u.c); if (!up) return null;
  const other = [];
  for (const [i, r] of read.entries()) {
    if (i === ui) continue;
    if (!r.days || !r.days.length) return null;
    const pr = r.o ? pair(r.o, r.c) : (() => { const c = pair(u.o, r.c); return c && [up[0], c[1]]; })();
    if (!pr) return null;
    other.push({ days: r.days, open_time: pr[0], close_time: pr[1] });
  }
  const named = new Set(other.flatMap(o => o.days));
  if (closed.some(d => named.has(d))) return null;
  // the days open: those named, and the usual hours' own (every other day when it was said without days)
  const usual = u.days || ALL_DAYS.filter(d => !named.has(d) && !closed.includes(d));
  return { open_time: up[0], close_time: up[1], open_days: ALL_DAYS.filter(d => (usual.includes(d) || named.has(d)) && !closed.includes(d)), other_hours: other };
}

// the days and hours someone works, every week for the year ahead - "weekends 10am to 10pm", "Thursday to Saturday 4 to 11" ->
// staffed_set_weekly's arguments (days said, one stretch of hours that ends the same day), or null
function staffedWeekly(words) {
  const h = hours(words);
  if (!h || !h.open_days || h.other_hours || !(h.close_time > h.open_time)) return null;
  const IDX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }, t = new Date(), end = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 364, 12);
  return { weekdays: h.open_days.map(d => IDX[d]).sort(), start_time: h.open_time, end_time: h.close_time, from: 'today', to: end.toISOString().slice(0, 10) };
}

// "we have 4 bays: Bay 1, Bay 2, Bay 3 and The Vault" / "4 - Augusta and Pebble" / "three" / "4 bays" -> { names } or { count }
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const N_WORD = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
function bays(words) {
  const s = plain(words).replace(/[.!]+$/, '');
  if (wordsIn(s) > 30 || /\?/.test(s)) return null;
  const cm = s.match(new RegExp(`\\b${N_WORD}\\s+(?:simulator |sim |golf |hitting )?bays?\\b`, 'i')) || s.match(new RegExp(`^\\s*(?:we have\\s+)?${N_WORD}\\s*(?:[-–:]|$)`, 'i'));
  const count = cm ? (NUM[cm[1].toLowerCase()] || Number(cm[1])) : null;
  let names = null;
  const after = s.match(/(?::|\b(?:called|named)\b)\s*(.+)$/i) || (count ? s.match(/^\s*(?:we have\s+)?\w+\s*(?:(?:simulator |sim |golf )?bays?\s*)?[-–]\s*(.+)$/i) : null);
  if (after) names = after[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map(x => x.trim().replace(/^(?:and|the bays? (?:are|is))\s+/i, '')).filter(Boolean);
  if (names && (names.length < 1 || names.length > 24 || names.some(n => n.length > 40 || wordsIn(n) > 4))) return null;
  if (names && count && names.length !== count) return null;
  if (names) return { names };
  return count && count >= 1 && count <= 24 ? { count } : null;
}
// (the walk-through on the 4B as a plain-spoken owner, Oct 22 2026: "we got 3 of them" to "how many bays do you have?") a number said
// loosely to the bays question - "3", "we got 3 of them", "just the one", "there's four" - and nothing else that could be a name
function bareCount(words) {
  // (the filler and the thing counted taken out first: "uhh we have like 5 simulators")
  const s = plain(words).toLowerCase().replace(/[.!]+$/, '').replace(/\b(?:uh+|um+|well|like|about|around|maybe|probably|roughly)\b/g, ' ').replace(/\b(?:golf |hitting )?(?:simulators?|sims?|bays?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (wordsIn(s) > 8 || /[?:,$]|\b(?:called|named|and|price|hours?|am|pm)\b/.test(s)) return null;
  const m = s.match(new RegExp(`^(?:we(?:'ve| have)?\\s+(?:got\\s+|have\\s+)?|there(?:'s| is| are|s)\\s+|got\\s+|just\\s+|only\\s+)?(?:the\\s+)?${N_WORD}(?:\\s+(?:of (?:them|em)|total|in all|right now))?$`)) || (/^(?:just )?(?:the )?one$/.test(s) ? [s, 'one'] : null);
  const n = m ? (NUM[m[1]] || Number(m[1])) : null;
  return n && n >= 1 && n <= 24 ? { count: n } : null;
}
// the bays' names alone, to "what do you call them?" - "Bay 1 and Bay 2", "Augusta, Pebble and St Andrews" (two or more, or one with
// "bay" in it; never a yes, a no or a skip)
function bareNames(words) {
  const s = plain(words).replace(/[.!]+$/, '').trim();
  if (wordsIn(s) > 24 || /[?:$]|\b(?:yes|no|skip|later|not|don'?t|hours?|price|per|open|close)\b/i.test(s)) return null;
  const names = s.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map(x => x.trim()).filter(Boolean);
  if (!names.length || names.length > 24 || names.some(n => n.length > 40 || wordsIn(n) > 4)) return null;
  return names.length >= 2 || /\bbay\b/i.test(names[0]) ? { names } : null;
}
// a count alone keeps the names the bays have, and names the new ones "Bay N" (never a name already taken)
function bayNames(count, current) {
  const names = (current || []).slice(0, count).map(b => b.name);
  const taken = new Set(names.map(n => String(n).toLowerCase()));
  for (let k = 1; names.length < count; k++) if (!taken.has('bay ' + k)) { names.push('Bay ' + k); taken.add('bay ' + k); }
  return names;
}

// how the facility runs, in the owner's own words: "we're staffed some days and use door codes the rest" is hybrid, "nobody works
// there, it's all door codes" unstaffed, "someone is always at the counter" staffed
function access(words) {
  const s = plain(words).toLowerCase();
  if (wordsIn(s) > 20) return null;
  const said = new Set();
  const people = /\b(?:staffed|staff (?:is|are)|someone(?:'s| is)?|somebody(?:'s| is)?|an employee|a person|people|we(?:'re| are)) (?:\w+ )?(?:there|at|behind|working|on|in)\b|\bstaffed\b|\battendant\b/;
  const codes = /\bdoor codes?\b|\bcodes? (?:to get|for the door)\b|\bself[- ]?serve\b|\bunmanned\b|\bunstaffed\b|\bnobody\b|\bno ?one\b|\bno staff\b|\bkeypad\b/;
  // (door codes said as used, not "no door codes": staffed AND codes is a mix - "mostly staffed but door codes late at night")
  const codesUsed = /(?<!\bno |\bwithout |\bnever use |\bdon'?t use )\bdoor codes?\b/.test(s) && !/\bno door codes?\b/.test(s);
  if ((/\bhybrid\b|\b(?:mix|both|some (?:days|hours|nights|times)|part of the (?:day|week)|weekends? only|evenings? only)\b/.test(s) && (people.test(s) || codes.test(s) || /\bhybrid\b/.test(s))) || (people.test(s) && codesUsed)) said.add('hybrid');
  else if (/\bunstaffed\b|\bunmanned\b|\bself[- ]?serve\b|\b(?:nobody|no ?one|no staff)\b[^.]{0,30}\b(?:there|works?|working|at the|on site)\b|\b(?:all|only|just) (?:door )?codes?\b|\bdoor codes? only\b|\blet (?:themselves|their ?selves|them ?selves) in\b|\bget (?:themselves|their ?selves) in\b|\bno (?:employees|workers|one works)\b|\b(?:nobody|no ?one) (?:is )?(?:ever )?there\b/.test(s)) said.add('unstaffed');
  else if (/^\s*(?:we(?:'re| are)\s+|it'?s\s+)?(?:fully |always )?staffed\b|\b(?:someone|somebody|staff|an employee|a person)(?:'s| is| are)? (?:always |all the time )?(?:at|behind|working) the (?:counter|desk|front)\b|\balways (?:staffed|someone there)\b|\b(?:at|behind) the counter (?:all the time|always)\b/.test(s)) said.add('staffed');
  return said.size === 1 ? [...said][0] : null;
}

// a yes only to a question that asks whether something is right ("10 AM to 11 PM every day - right?"), never to "how many bays?"
const CONFIRM_Q = /\b(?:right|correct|is that|are those|does that|look(?:s)? (?:good|right)|sound(?:s)? (?:good|right)|keep (?:it|them|that))\b/i;
const YES = /^\s*(?:yes|yep|yeah|yup|correct|right|that'?s (?:right|correct|it)|(?:it )?looks (?:good|right|fine)|perfect|sounds good|all good|ok(?:ay)?|those are (?:right|correct|good)|that'?s fine)\b[\s.!,]*(?:that'?s (?:right|correct)|thanks?(?: you)?)?[\s.!]*$/i;
// "we don't have one" / "no website yet" / "I'll buy a domain later" to the website address question
const NO_DOMAIN = /^\s*(?:no|nope|nah|none|not yet|skip)\b|\bskip (?:it|that|this|the (?:domain|website|web ?site|site))\b|\b(?:for now|maybe later|not ready|without one)\b|\b(?:don'?t|do not|doesn'?t) have (?:one|it|a (?:domain|website|web ?site|site|web address))\b|\bno (?:domain|website|web ?site|site|web address)\b|\b(?:later|not yet|haven'?t (?:got|bought|picked))\b/i;
// a domain named in the owner's words ("I already own rapidgolf.com", "it's www.rapidgolf.com") - looked up before anything is set:
// on this box the website address comes with getting it online (playbook 01)
const domainIn = (w) => { if (wordsIn(w) > 14 || /@/.test(w)) return null; const d = String(w).toLowerCase().match(/\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|golf|club|us|co|biz|info|io|app|fun|place|games|sports|bar|pub|lounge|[a-z]{2,6}))\b/); return d && !/\.(?:jpg|png|pdf|txt)$/.test(d[1]) ? d[1] : null; };
const NO_DOMAIN_SAID = 'No problem - the box runs without one, and nothing is lost by waiting. When you want your site on the internet, say "get my box online": you make a free Cloudflare account and buy a new domain there (about 15-20 minutes), and I go through it with you one step at a time.';

// each step: what a question about it says (`asked`), what such a question is NOT about (`not`: a staffed day's hours are not
// the opening hours), the answer to that question (`take`), the answer that needs no question - words about that step alone
// (`alone`: "three bays", "$40 an hour", "nobody works there, it's all door codes") - and the changes that could rightly take
// the same words (`family`: "25 per half hour" may be a peak price's or a membership's; it is never the booking rules')
const STEPS = [
  { ids: ['citystate'], family: /location|address|contact|business_name/,  asked: /\bcity\b|\bwhere (?:are you|is (?:the|your) (?:facility|place|business))\b|\blocated\b|\blocation\b/i,
    take: (w) => { const cs = cityState(w); return cs && ['location_set', cs]; }, alone: (w) => { const cs = cityState(w); return cs && ['location_set', cs]; } },
  { ids: ['domain'], family: /domain|address|connect|online/,  asked: /\bdomain\b|\bwebsite address\b|\bweb address\b|\burl\b/i,
    // (maintainer, Oct 22 2026: "when it asked domain i gave it the testing.com and it should have just put it in the box there. but it got
    // confused and started asking about cloudflare" - the address is put in, and the box asks itself whether it is bought yet: engine
    // applied, DOMAIN_Q)
    take: (w) => { const d = domainIn(w); return d ? ['website_address_set', { domain: d }] : wordsIn(w) <= 14 && NO_DOMAIN.test(w) ? ['say', NO_DOMAIN_SAID] : null; },
    alone: (w) => { const d = domainIn(w); if (d) return /\b(?:own|have|bought|got|registered|paid|our (?:domain|site|website) is)\b/i.test(w) ? ['website_address_set', { domain: d }] : null;
      return wordsIn(w) <= 14 && /\b(?:domain|website|web ?site|web address)\b/i.test(w) && NO_DOMAIN.test(w) ? ['say', NO_DOMAIN_SAID] : null; } },
  { ids: ['access'], family: /access|staff|schedul|door/,  asked: /\bstaffed\b|\bunstaffed\b|\bhybrid\b|\bdoor codes?\b|\bhow (?:the facility|your facility|it|you) runs?\b|\bcounter\b/i, not: /\bwhich days\b|\bwhat days\b|\bstaffed (?:days|hours)\b/i,
    take: (w) => { const m = access(w); return m && ['access_style_set', { style: m }]; }, alone: (w) => { const m = access(w); return m && ['access_style_set', { style: m }]; },
    // answered on the first screen, then said otherwise while setup goes on ("staffed", on a box the first screen set to door codes)
    differs: (got, cur) => !!(cur && cur.accessStyle) && got[1].style !== (cur.accessStyle === 'unmanned' ? 'unstaffed' : cur.accessStyle) },
  // (the staffed hours' question - "Which days and hours is someone working there?" - is not the opening hours': "saturday and sunday 10am
  // to 10pm" to it closed the facility on weekdays - the walk-through on the 4B, Oct 22 2026)
  { ids: ['staffedhours'], family: /staff/, asked: /\bsomeone (?:is )?working\b|\bstaffed (?:days|hours)\b|\bwho(?:'?s| is) working\b/i,
    take: (w) => { const st = staffedWeekly(w); return st ? ['staffed_set_weekly', st] : null; } },
  { ids: ['hours', 'confirmhours'], family: /hours|staff|schedul|block|event|special|window|routine|open_24/,  asked: /\bhours\b|\bopen\b|\bclose\b/i, not: /\bstaff(?:ed|ing)?\b|\bworking\b|\bsomeone\b|\bspecials?\b|\bhappy hour\b|\bpeak\b|\bwindows?\b|\bshifts?\b|\bevents?\b|\bmembers?\b|\btiers?\b|\bdiscounts?\b|\bblock/i,
    take: (w, q, id) => { if (always(w)) return ['open_24_hours_set', { on: true }]; const h = hours(w); return h ? ['opening_hours_set', h] : id === 'confirmhours' && CONFIRM_Q.test(q) && YES.test(w) ? ['setup_confirm', { item: 'hours' }] : null; },
    alone: (w) => { if (always(w) && /\bopen\b/i.test(w)) return ['open_24_hours_set', { on: true }]; const h = hours(w); return h && (/\d\s*(?:am|pm|a\.m|p\.m)\b|\bnoon\b|\bmidnight\b/i.test(w) || h.open_days || /\bopen\b/i.test(w)) ? ['opening_hours_set', h] : null; } },
  { ids: ['confirmwaiver'], family: /waiver/,  asked: /\bwaivers?\b|\bsign\b/i,
    take: (w) => { const m = waiverMode(w); return m && ['waiver_mode_set', { mode: m }]; }, alone: (w) => { const m = /\bwaivers?\b/i.test(w) && waiverMode(w); return m && ['waiver_mode_set', { mode: m }]; } },
  { ids: ['confirmbays'], family: /bay/,  asked: /\bbays?\b/i,
    take: (w, q) => { const b = bays(w) || bareCount(w) || bareNames(w); return b ? ['bays_list_set', b] : CONFIRM_Q.test(q) && YES.test(w) ? ['setup_confirm', { item: 'bays' }] : null; },
    alone: (w) => { const b = bays(w); return b && (b.names || /\bbays?\b/i.test(w)) ? ['bays_list_set', b] : null; } },
  { ids: ['confirmprice', 'wfrate'], family: /price|member|tier|discount|deposit|special|gift|window|whole_facility|rate/,  asked: /\bprice\b|\bcharge\b|\bcost\b|\brate\b|\bper (?:half )?hour\b/i, not: /\bmembers?(?:hip)?\b|\btiers?\b|\bspecials?\b|\bpeak\b|\bwindows?\b|\bdiscounts?\b|\bgift\b|\bdeposit\b|\bevents?\b|\bleagues?\b|\bper (?:person|player)\b|\bfood\b|\bdrinks?\b|\bmenu\b/i,
    take: (w, q, id) => { const p = price(w, q); if (p) return ['base_price_set', p]; const m = withPeaks(w); return m || (id === 'confirmprice' && CONFIRM_Q.test(q) && YES.test(w) ? ['setup_confirm', { item: 'price' }] : null); },
    alone: (w) => { const p = price(w, ''); return p && /\$|\b(?:dollars|bucks)\b|\bper\b|\ban hour\b/i.test(w) ? ['base_price_set', p] : withPeaks(w); } },
];

// the question the box asked last: the sentences that ask (ending in "?"), or its last sentence
function questionOf(text) {
  const parts = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  const asks = parts.filter(p => /\?/.test(p));
  return (asks.length ? asks : parts.slice(-1)).join(' ');
}

// [action name, its arguments, how it was known, its family] - or ['say', words, how, family] - when the owner's words plainly answer a setup step not
// yet done: the box's own last question asked about it ('asked'), or the model's answer just now talked about it ('said'), or the
// words are about that step alone ('alone'). Null otherwise (the model's answer stands); two steps answered at once is not guessed
function answer(askedText, ownerWords, setup, modelSaid, current) {
  const q = questionOf(askedText), w = plain(ownerWords), m = String(modelSaid || '');
  if (!w || /\?/.test(w) || wordsIn(w) > 30) return null;
  const open = new Set((setup || []).filter(s => s && !s.done).map(s => s.id));
  const found = [];
  const about = (st, t) => !!t && st.asked.test(t) && !(st.not && st.not.test(t));
  const setupGoing = (setup || []).some(s => s && !s.done && !s.optional);
  for (const st of STEPS) {
    let id = st.ids.find(i => open.has(i));
    const again = !id && !!st.differs && setupGoing && !!current;
    if (!id && !again) continue;
    id = id || st.ids[0];
    // (the model's own misreading never vetoes the owner's words - "staffed hours are set" over "staffed"; the box's question does)
    let got = null, how = null;
    if (about(st, q)) { got = st.take(w, q, id); how = 'asked'; }
    else if (about(st, m)) { got = st.take(w, q, id); how = 'said'; }
    if (!got && st.alone && !(st.not && st.not.test(q))) { got = st.alone(w, q, id); how = 'alone'; }
    if (got && (!again || st.differs(got, current))) found.push(got.concat(how, st.family));
  }
  return found.length === 1 ? found[0] : null;
}

// THE OWNER'S WORDS OVER THE MODEL'S (the same day: "open 9am to midnight every day" reached the card as 9 AM - 11 PM): when the
// model called a setup action and the owner's own newest words plainly say its values, the card carries the owner's
const SAID = {
  opening_hours_set: (w) => hours(w),
  location_set: (w) => cityState(w),
  waiver_mode_set: (w) => { const m = waiverMode(w); return m && { mode: m }; },
  access_style_set: (w) => { const m = access(w); return m && { style: m }; },
  base_price_set: (w) => { const p = price(w, ''); return p && /\$|\b(?:dollars|bucks)\b|\bper\b|\ban hour\b|\bhourly\b/i.test(w) ? p : null; },
  bays_list_set: (w) => { const b = bays(w); return b && b.names ? { names: b.names } : null; },
};
// the keys the owner's words decide for each (the rest of the model's arguments stay)
const OWNS = { location_set: ['city', 'state', 'zip'], base_price_set: ['per_half_hour', 'per_hour'] };
function fromWords(name, modelArgs, words) {
  const f = SAID[name]; if (!f || !words || /\?/.test(words)) return null;
  const said = f(plain(words)); if (!said) return null;
  const out = Object.assign({}, modelArgs || {});
  for (const k of OWNS[name] || Object.keys(said)) delete out[k];
  return Object.assign(out, said);
}

// THE DOMAIN: BOUGHT YET, OR STILL TO BUY (maintainer, Oct 22 2026: "it got hung up on the cloudflare thing with if we bought it or not or need
// to buy it ... that needs to be looked at and asked") - the box's own question after the address is put in, and the owner's answer
const DOMAIN_Q = (d) => `Do you already own ${d}, or do you still need to buy it?`;
const DOMAIN_CHOICES = ['I already own it', 'I still need to buy it', 'Not sure'];
// "I already own it" / "yes we bought it on godaddy" -> 'own'; "I still need to buy it" / "no" -> 'buy'; "not sure" -> 'unsure'
function domainOwned(words) {
  const w = plain(words).toLowerCase();
  if (!w || wordsIn(w) > 20) return null;
  if (/\b(?:not sure|unsure|don'?t know|do not know|no idea|maybe|i think so|not certain|no clue)\b/.test(w)) return 'unsure';
  if (/\b(?:need to buy|still need|have to buy|will buy|gonna buy|going to buy|want to buy|buy it|purchase it|don'?t (?:own|have)|do not (?:own|have)|haven'?t (?:bought|got|purchased)|not yet|no\b|nope|nah)/.test(w)) return 'buy';
  if (/\b(?:already|own|owned|mine|ours|bought|have it|got it|registered|purchased|yes|yep|yeah|yup|i do|we do|it is|it's)\b/.test(w)) return 'own';
  return null;
}
const DOMAIN_SAID = {
  own: (d) => `Good - ${d} is your website address. Putting it on the internet comes later, whenever you are ready: say "get my box online" and I will walk you through it one step at a time (about 15-20 minutes). For now, let's keep setting up the box.`,
  buy: (d) => `No problem - ${d} is saved as your website address. You buy it when you put the box online: say "get my box online" when you are ready and I will walk you through buying it and connecting it, one step at a time. For now, let's keep setting up the box.`,
  unsure: (d) => `That's fine - ${d} is saved as your website address for now. When you put the box online I will look it up with you and we will sort out whether it needs buying. For now, let's keep setting up the box.`,
};

module.exports = { answer, fromWords, cityState, waiverMode, price, prices, hours, bays, bayNames, access, questionOf, domainIn, DOMAIN_Q, DOMAIN_CHOICES, domainOwned, DOMAIN_SAID };
