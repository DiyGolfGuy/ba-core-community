// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/helpers.js - WHAT EVERY ACTION SHARES (Oct 19-20 2026)
// The checks a tool call's arguments pass, the words a small model gets wrong put right (dates, times, days), plain words
// for dates and times, and the finders for a person, a bay, a device and a photo. actions.js and every file under areas/
// are built with these (areas get them handed in), so an area can be loaded and checked on its own.
'use strict';

class ActionError extends Error {}

// ── the words a small model gets wrong, put right before anything is checked ──
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function normDate(v, today) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'today' || s === 'tonight' || s === 'this evening') return today;
  if (s === 'tomorrow' || s === 'tomorrow night') return addDays(today, 1);
  // A WEEKDAY SAID ON THAT SAME WEEKDAY IS A WEEK ON (Oct 24 2026): "block the vault on saturday" said on a Saturday is next Saturday -
  // today is "today". Read that way by the 4B (four of four on a Saturday) and by a real Claude ("Friday 5 to 10" on a Friday, Oct 23),
  // and the mirror of the money reads ("last friday" on a Friday is a week ago). "this saturday" on a Saturday is today.
  const w = WEEKDAYS.indexOf(s.replace(/^(this|next)\s+/, ''));
  if (w >= 0) { const cur = new Date(today + 'T12:00:00Z').getUTCDay(); let n = (w - cur + 7) % 7; if (n === 0 && !s.startsWith('this ')) n = 7; return addDays(today, n); }
  return null;
}
function normTime(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase().replace(/\./g, '');
  if (s === 'noon') return '12:00';
  // (midnight as people type it - "midnite", "midnihgt", "mid night", "24:00" - maintainer's try box, Oct 22 2026)
  if (s === 'midnight' || /^mid ?n[a-z]{1,6}$/.test(s) || s === '24:00' || s === '2400') return '00:00';
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0; const ap = m[3];
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (ap) { if (ap[0] === 'p' && h !== 12) h += 12; if (ap[0] === 'a' && h === 12) h = 0; }
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}
const dayWords = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const timeWords = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(m).padStart(2, '0')} ${ap}`; };

// WHO DECIDES STAFFED HOURS (Oct 19 2026, with main's Staffed Days card): a season in Settings > Schedule outranks the
// Website calendar, so while one is in use a day's change is that season's own per-day change (the Schedule tab's WANT
// STAFFED cell) - never a calendar row that would be silently ignored. Staffed hours switched off means no day is staffed.
function staffedSource(ctx) {
  const st = (ctx && ctx.staffing) || {};
  if (st.scheduleOff) throw new ActionError('staffed hours are switched off in Settings > Schedule (the "Staffed hours" switch) - no day counts as staffed until they are switched back on there');
  if (st.season && !st.schedulingOn) throw new ActionError(`the season "${st.season.name}" in Settings > Schedule decides staffed hours, and Employee scheduling is off, so it cannot be changed from here - switch Employee scheduling on (Settings > Staff > The Counter), or choose "No season" in Settings > Schedule`);
  return st.season ? 'season' : 'calendar';
}
const seasonNote = (ctx) => (ctx && ctx.staffing && ctx.staffing.season) ? ` (a change to the season "${ctx.staffing.season.name}" for that day - the season decides your staffed hours)` : '';

// ── the schema checks (the small subset the actions use) ──
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// days as the owner says them - "weekdays", "mon-fri", "friday and saturday", "thursday to sunday", "every day" - through the
// same reader the weekly specials use (public/site-layout.js specialDays); the money map found "mon-fri" read as Monday
// alone and "friday and saturday" as Friday alone (Oct 20 2026)
function normDays(v) {
  const words = Array.isArray(v) ? v.map(String).join(',') : String(v == null ? '' : v);
  if (!words.trim()) return null;
  const d = require('../../public/site-layout.js').specialDays(words);
  if (!d) return null;
  if (d === 'every') return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  if (d === 'weekdays') return ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (d === 'weekends') return ['sat', 'sun'];
  return d.split(',');
}
const DATE = { type: 'string', description: 'a date as YYYY-MM-DD (today, tomorrow and a weekday name are understood too)', 'x-date': true };
const TIME = { type: 'string', description: 'a time as HH:MM on the 24-hour clock (5pm and 5:30 pm are understood too)', 'x-time': true };
function check(schema, args, ctx) {
  const out = {};
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const props = schema.properties || {};
  for (const [k, p] of Object.entries(props)) {
    let v = a[k];
    if (v === undefined || v === null || v === '') { if ((schema.required || []).includes(k)) throw new ActionError(`"${k}" is needed`); continue; }
    if (p['x-date']) { const d = normDate(v, ctx.today); if (!d) throw new ActionError(`"${k}" must be a date (YYYY-MM-DD), not "${v}"`); v = d; }
    else if (p['x-time']) { const t = normTime(v); if (!t) throw new ActionError(`"${k}" must be a time (HH:MM), not "${v}"`); v = t; }
    else if (p['x-days']) { const d = normDays(v); if (!d) throw new ActionError(`"${k}" must be days of the week (mon to sun, weekdays, weekends or every day), not "${v}"`); v = d; }
    else if (p.type === 'integer') { const n = Number(v); if (!Number.isInteger(n)) throw new ActionError(`"${k}" must be a whole number`); v = n; }
    else if (p.type === 'number') { const n = Number(v); if (!Number.isFinite(n)) throw new ActionError(`"${k}" must be a number`); v = n; }
    else if (p.type === 'boolean') { if (v === 'true' || v === 'yes' || v === 1) v = true; else if (v === 'false' || v === 'no' || v === 0) v = false; if (typeof v !== 'boolean') throw new ActionError(`"${k}" must be true or false`); }
    else if (p.type === 'string') { v = String(v).trim(); if (p.maxLength && v.length > p.maxLength) throw new ActionError(`"${k}" is longer than ${p.maxLength} characters`); if (p.minLength && v.length < p.minLength) throw new ActionError(v.length ? `"${k}" is too short (at least ${p.minLength} characters)` : `"${k}" is empty`); }
    else if (p.type === 'array') {
      if (!Array.isArray(v)) throw new ActionError(`"${k}" must be a list`);
      if (p.items && p.items.type === 'integer') { v = v.map(Number); if (v.some(n => !Number.isInteger(n))) throw new ActionError(`"${k}" must be a list of whole numbers`); }
      if (p.items && p.items.type === 'string') v = v.map((el, i) => { const t = String(el == null ? '' : el).trim(); if (p.items.enum && !p.items.enum.includes(t)) throw new ActionError(`item ${i + 1} of "${k}" must be one of: ${p.items.enum.join(', ')}`); if (p.items.maxLength && t.length > p.items.maxLength) throw new ActionError(`item ${i + 1} of "${k}" is longer than ${p.items.maxLength} characters`); return t; });
      if (p.items && p.items.type === 'object') v = v.map((el, i) => { try { return check(p.items, el, ctx); } catch (e) { throw new ActionError(`item ${i + 1} of "${k}": ${e.message}`); } });
      if (p.minItems && v.length < p.minItems) throw new ActionError(`"${k}" needs at least ${p.minItems}`);
      if (p.maxItems && v.length > p.maxItems) throw new ActionError(`"${k}" takes at most ${p.maxItems}`);
    }
    else if (p.type === 'object') { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ActionError(`"${k}" must be a set of named values`); try { v = check(p, v, ctx); } catch (e) { throw new ActionError(`in "${k}": ${e.message}`); } }
    if (p.enum && !p.enum.includes(v)) throw new ActionError(`"${k}" must be one of: ${p.enum.join(', ')}`);
    if (p.minimum != null && v < p.minimum) throw new ActionError(`"${k}" must be at least ${p.minimum}`);
    if (p.maximum != null && v > p.maximum) throw new ActionError(`"${k}" must be at most ${p.maximum}`);
    out[k] = v;   // anything the schema does not name is dropped, never passed on
  }
  return out;
}

// ── who "Carl" is: the roster the owner keeps ──
function staffCode(ctx, name) {
  const roster = (ctx.roster || []).filter(s => s.active !== false);
  const n = String(name).trim().toLowerCase();
  const exact = roster.filter(s => s.name.toLowerCase() === n);
  if (exact.length === 1) return exact[0];
  const first = roster.filter(s => s.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
  if (first.length === 1) return first[0];
  const names = roster.map(s => s.name).join(', ') || 'no one yet';
  if (first.length > 1) throw new ActionError(`more than one person on the roster is called "${name}" (${first.map(s => s.name).join(', ')}) - say which`);
  throw new ActionError(`no one called "${name}" is on the staff roster (on it: ${names})`);
}
const rosterName = (ctx, code) => { const s = (ctx.roster || []).find(r => String(r.code) === String(code)); return s ? s.name : null; };

// ── which bay: its name as the owner says it ("bay 2", "Bay 2", "the second bay" is not guessed) ──
function bayIndex(ctx, name) {
  const bays = ctx.bays || [];
  const n = String(name).trim().toLowerCase();
  let i = bays.findIndex(b => String(b.name || '').toLowerCase() === n);
  if (i < 0) { const m = bays.map((b, j) => [b, j]).filter(([b]) => String(b.name || '').toLowerCase().includes(n) || n.includes(String(b.name || '').toLowerCase())); if (m.length === 1) i = m[0][1]; }
  if (i < 0) throw new ActionError(`no bay called "${name}" (the bays: ${bays.map(b => b.name).join(', ') || 'none yet'})`);
  return i;
}

// ── which smart-home device: its name, or one of its controls (switch.bay_2_plug) ──
const POWER = ['switch', 'light', 'fan', 'input_boolean', 'media_player', 'humidifier', 'siren', 'valve', 'cover', 'water_heater'];
function findDevice(ctx, words) {
  const devs = ctx.smarthome || [];
  const n = String(words).trim().toLowerCase();
  const byControl = devs.filter(d => d.controls.some(c => c.entity_id.toLowerCase() === n));
  if (byControl.length === 1) return byControl[0];
  const exact = devs.filter(d => d.name.toLowerCase() === n || d.controls.some(c => String(c.name).toLowerCase() === n));
  if (exact.length === 1) return exact[0];
  const some = devs.filter(d => d.name.toLowerCase().includes(n) || n.includes(d.name.toLowerCase()));
  if (some.length === 1) return some[0];
  if (!devs.length) throw new ActionError('the hub has no devices yet - pair one first');
  throw new ActionError(`${exact.length + some.length > 1 ? 'more than one device matches' : 'no device called'} "${words}" (the devices: ${devs.map(d => d.name).join(', ')})`);
}
function findControl(ctx, words, domains) {
  const d = findDevice(ctx, words);
  const n = String(words).trim().toLowerCase();
  const named = d.controls.find(c => c.entity_id.toLowerCase() === n);
  const c = named || d.controls.find(x => domains.includes(x.what) && x.what === 'switch') || d.controls.find(x => domains.includes(x.what));
  if (!c) throw new ActionError(`${d.name} has nothing ${domains.includes('climate') && domains.length === 1 ? 'that sets a temperature' : 'to switch on and off'} (it has: ${d.controls.map(x => x.entity_id).join(', ') || 'no controls'})`);
  if (!domains.includes(c.what)) throw new ActionError(`${c.entity_id} cannot be used that way`);
  return Object.assign({ device: d }, c);
}


// a photo the chat uploaded: the Website editor's own folder, a plain picture file that is really there - nothing else
// is ever put on the site. A full stop or comma after an address in a sentence is not part of it (a model copies the
// sentence's punctuation: "photo 3 /uploads/landing/x.png." pointed the gallery at a file that does not exist).
function photoPath(p) {
  const s = String(p || '').trim().replace(/[.,;:)\]'"]+$/, '');
  if (!/^\/uploads\/landing\/[A-Za-z0-9._-]{1,160}\.(jpe?g|png|webp)$/i.test(s) || s.includes('..')) throw new ActionError(`"${s.slice(0, 80)}" is not a photo added in this chat - use the addresses the chat gave`);
  const appDir = process.env.BA_APP_DIR || require('path').join(__dirname, '..', '..');
  if (!require('fs').existsSync(require('path').join(appDir, 'public', s))) throw new ActionError(`"${s}" is not on this unit - use the addresses the chat gave`);
  return s;
}

// ═══ THE BARE-HOUR RULE (Oct 27 2026) - ONE RULE FOR THE HALF OF THE DAY, everywhere a change carries a clock time ═══
// Rounds 1 to 2c fixed the half of the day one reader at a time (eveningIfClosed, twoWays and TW_NEG in the engine, rangeIn's morning
// word, eventClock's NIGHT_SAID, clockAt, openTill's four hours, the setup prices' "before 11"), each with its own word list, and each
// round's review found new wrong changes in the same class: "not bay 1 tonight 8 to 1" put up for the morning, "we have a party
// tonight so block the vault from 8 to 1" applied 8 AM to 1 PM at a 7 AM place, "morning rate weekdays, 8-10, $12" as 8 PM to 10 PM,
// "open till 3 on sundays" as 3 AM, the Late Summer Scramble at 10 PM on the public page, an event's bare 8 written PM by the model's
// own event_add, "$15 an hour before 11 on weekdays" as the whole day. Now ONE rule, here, read by every one of them:
// A time the owner typed with no am, pm, noon, midnight or 24-hour clock on it - a bare hour ("at 8", "close at 3", "before 11") or a
// bare range ("8 to 1") - has its half of the day read ONLY when it is certain:
//   1. ATTACHED: an un-negated day-part word belongs to THAT time or its day in the same clause, and no other day-part word in the
//      message contradicts it - that half. Belongs: beside it with only small words between ("8 to 1 tonight", "friday night 8 to
//      1", "8 to 1 at night", "breakfast 7 to 10", "11 to 2 for lunch"); the one day its clause names, said with its part of the day
//      ("tonight block bay 2 8 to 1 for the smiths"); a label the owner put before it, when the time's own part says nothing else
//      ("morning rate weekdays, 8-10, $12 a half hour" - a label names what it prices); joined to what is made ("the night shift", "a
//      dinner party", "the breakfast special"); or in an event's own name ("League Night at 7", "Saturday Morning Scramble at 6").
//   2. FACILITY: no day-part word anywhere in the message, the facility is not open 24 hours, and exactly one half fits its hours -
//      that half. Fits: open at its start; a range ending past midnight only where the place closes at midnight or later; a window's
//      lone "before 11" or "after 5" strictly inside the hours; a closing hour that leaves the day four hours open, or past midnight
//      within six hours of the day's own close (both fit often - asked); an opening hour from 5 AM with five hours before the close.
//   3. OTHERWISE ASK, the two to tap (the owner's own hours with am and pm): a day-part word anywhere else in the message (another
//      clause or sentence, about something else), any negation near a day-part word ("not bay 1 tonight", "not at night", "no tonight
//      8 to 1", "dont forget tonight"), both halves fitting, a place open 24 hours with nothing attached, or no half fitting. A
//      reading the model or a reader made is NEVER kept in silence, and never moved in silence, unless 1 or 2 makes it certain.
//   Day-part words: tonight, evening, night, nite, weeknight, dinner, supper (the evening, from 4 PM); morning, breakfast, sunrise,
//   early bird (the morning); brunch; lunch, midday (10 AM to 3 PM); afternoon; daytime. NOT day-part words: "late" ("Late Summer",
//   "a late shift"), "early" (save "early bird").
//   A time with its half said is as said: "8pm", "noon", "midnight", "10 in the morning", "20:00", "07:00"; a range with the half
//   written once runs back or on within twelve hours - "9 to 10pm" is 9 PM, "10 to 2pm" 10 AM, "8 to 1am" 8 PM, "9pm to 2" 2 AM.
// clockOf (a call's own time, found in the owner's words) and clockAtWords (a time the box read itself) both end in clockHalf.
// (an action's own fill that must ask - an event's start, a closing hour - returns the change as it stands with the question on it, under
// this key: the engine asks it, both to tap; anything else that calls the fill gets the change back unmoved, never an exception)
const CLOCK_ASK = Symbol.for('ba.assistant.clockAsk');
const CLOCK_DP = [
  // [part of the day, its words, the window its START falls in, the window its END falls in] - minutes from midnight; an end in the
  // small hours counts on past midnight (1 AM is 1500)
  // (the evening as the owner types it too - Oct 28 2026, round 2e: "block the vault new years eve 8 to 1", "fri evng 8 to 1", "friday eve
  // 8 to 1", "block bay 2 2night from 8 to 1" and "block bay 2 friday pm 8 to 1" read as no day-part word at all, and the facility step
  // moved the model's right 8 PM to 1 AM to the morning at a place open from 7 AM. "eve", "evng", "2night" and a "pm" standing on its own -
  // never the "pm" of "8 pm" - are the evening)
  ['evening', /\b(?:tonight|tonite|tonights|2night|2nite|evenings?|evenin|evngs?|eves?|nights?|nites?|nightly|weeknights?|overnight|dinner(?:time)?|supper(?:time)?)\b|(?<!\d\s*)\bpm\b/g, [960, 1439], [1020, 1680]],
  ['morning', /\b(?:mornings?|breakfast|sunrise|early[ -]?birds?)\b/g, [240, 720], [300, 720]],   // (noon included: "the morning scramble at 12" is noon)
  ['brunch', /\bbrunch\b/g, [540, 900], [600, 960]],
  ['midday', /\b(?:lunch(?:time)?|midday|mid-day)\b/g, [600, 900], [660, 960]],
  ['afternoon', /\bafternoons?\b/g, [720, 1079], [780, 1200]],
  ['daytime', /\b(?:daytime|day time|during the day)\b/g, [300, 1019], [360, 1200]],
  // ("midnight" and "noon" as words of a name - "the Midnight Madness Scramble at 12", "the High Noon Shootout at 12" - never the time itself:
  // "at midnight", "till noon", "noon to 4" are said)
  ['evening', /(?<!\b(?:at|to|till|til|until|untill|from|before|after|by|past|thru|through|and|or|-)\s?)\bmidnight\b(?!\s*(?:-|to|till|until)\b)/g, [960, 1439], [1020, 1680]],
  ['midday', /(?<!\b(?:at|to|till|til|until|untill|from|before|after|by|past|thru|through|and|or|-)\s?)\bnoon\b(?!\s*(?:-|to|till|until)\b)/g, [600, 900], [660, 960]],
];
const CLOCK_NEG = /^(?:not|never|no|nor|neither|dont|don't|doesnt|doesn't|didnt|didn't|cant|can't|cannot|wont|won't|isnt|isn't|arent|aren't|wasnt|wasn't|werent|weren't|shouldnt|shouldn't|couldnt|couldn't|wouldnt|wouldn't|without|except|excluding|besides|instead|nothing|none)$/;
const CLOCK_DAYW = '(?:today|tonight|tonite|2night|2nite|tomorrow|tmrw|tmr|tomorow|(?:mon|tue|tues|wed|weds|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?s?|weekdays?|weekends?|weeknights?)';
const CLOCK_DAY = new RegExp(`\\b${CLOCK_DAYW}\\b`, 'g'), CLOCK_DAY1 = new RegExp(`^${CLOCK_DAYW}$`);
// (the small words that may stand between a day-part word and its time: "tonight from 8 to 1", "8 to 1 at night", "mornings, tues and thurs 9 to 11")
const CLOCK_GLUE = new Set('from between at @ is are runs run running going of on in this that the every each all only just for starting start starts begin begins open opens a an and & to till til until thru through about around'.split(' '));
// (what a day-part word is joined to when it names the thing made: "night shift", "dinner party", "morning rate", "league night")
const CLOCK_THING = /^(?:shifts?|part(?:y|ies)|specials?|rates?|prices?|pricing|deals?|leagues?|events?|scrambles?|clinics?|tournaments?|sessions?|lessons?|class(?:es)?|camps?|clubs?|programs?|golf|menus?|hours?|windows?|happy)$/;
// (a part of the words that says nothing of its own beside its time: days, small words, money, lengths - "8-10", "$12 a half hour")
const CLOCK_FRAG = /^(?:\d{1,2}(?::\d\d)?(?:am|pm|a|p)?|\$?\d+(?:\.\d+)?|\$|%|percent|am|pm|noon|midnight|-|–|—|half|hours?|hr|hrs|minutes?|mins?|per|each|off|is|are|weekly)$/;
// a new clause or sentence: a full stop, "so", "because", "but", "then", "also" ... or a new subject and its verb ("we have", "he closed")
const CLOCK_CUT = /[.!?\n](?=\s|$)|\b(?:so|because|cause|cuz|coz|since|but|then|also|plus|while|whereas|although|though|however|unless|otherwise|anyway|anyways)\b|(?<=\s)(?=(?:we|i|he|she|they|you|there)\s+(?:have|has|had|got|are|is|were|was|will|wanna|want|wants|need|needs|open|opens|close|closes|closed|closing|work|works|worked|working|can|cant|can't|could|should|would|do|dont|don't|did|didnt|didn't|go|going|get|gets|run|runs|play|plays|booked)\b)|(?<=\s)(?=(?:we're|we'll|we've|he's|she's|they're|they'll|i'm|i'll|there's|were gonna)\b)/g;
const CLOCK_SOFT = /[,;()]|:(?!\d)|\s[-–—]+\s/g;
const clockMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const clockHm = (x) => { const y = ((x % 1440) + 1440) % 1440; return String(Math.floor(y / 60)).padStart(2, '0') + ':' + String(y % 60).padStart(2, '0'); };
const clockSay = (x) => { const y = ((x % 1440) + 1440) % 1440; return y === 0 ? 'midnight' : y === 720 ? 'noon' : timeWords(clockHm(y)).replace(':00 ', ' '); };
// the words as the rule reads them: lower case, "a.m." as "am", "sat. night" as "sat night", o'clock gone, "10 in the morning" as 10am
function clockWords(words) {
  return (' ' + String(words == null ? '' : words).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\b([ap])\.\s?m\b\.?/g, '$1m')
    .replace(/\b(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\.(?=\s)/g, '$1').replace(/\bo'?\s?clock\b/g, ' ')
    .replace(/\b(\d{1,2}(?::[0-5]\d)?)\s+in the morning\b/g, '$1am').replace(/\b(\d{1,2}(?::[0-5]\d)?)\s+in the (?:afternoon|evening)\b/g, '$1pm')
    .replace(/\s+/g, ' ') + ' ');
}
// every day-part word in the words, and whether a "not", "no", "never", "can't", "except" stands within three words before it
function clockDps(w) {
  const out = [];
  for (const [cls, re, sw, ew] of CLOCK_DP) for (const x of w.matchAll(re)) {
    const before = w.slice(Math.max(0, x.index - 60), x.index).split(/[^a-z0-9']+/).filter(Boolean).slice(-3);
    out.push({ cls, i: x.index, j: x.index + x[0].length, word: x[0], sw, ew, neg: before.some(t => CLOCK_NEG.test(t)) });
  }
  return out.sort((a, b) => a.i - b.i);
}
const clockStem = (d) => (/^(?:today|tonight|tonite|tonights|2night|2nite|this)$/.test(d) ? 'today' : /^(?:tomorrow|tmrw|tmr|tomorow)$/.test(d) ? 'tomorrow' : /^weeknights?$|^weekdays?$/.test(d) ? 'weekday' : /^weekends?$/.test(d) ? 'weekend' : /^(?:every|each|nightly)$/.test(d) ? 'every' : d.slice(0, 3));
// the clause the time stands in (cut at a full stop, "so", "because", a new subject ...), and within it the time's own part (cut at a
// comma, a colon, a dash) - grown back to the part before it, and on through the parts after it, while its own part says nothing else
function clockRegion(w, ti, tj) {
  let lo = 0, hi = w.length;
  for (const x of w.matchAll(CLOCK_CUT)) { const a = x.index, b = x.index + x[0].length; if (b <= ti) lo = b; else if (a >= tj) { hi = a; break; } }
  const marks = [];
  for (const x of w.slice(lo, hi).matchAll(CLOCK_SOFT)) { const a = lo + x.index; if (a >= ti && a < tj) continue; marks.push([a, a + x[0].length]); }
  const parts = []; let at = lo; for (const [a, b] of marks) { parts.push([at, a]); at = b; } parts.push([at, hi]);
  const frag = (p, skip) => { const t = (skip ? w.slice(p[0], ti) + ' ' + w.slice(tj, p[1]) : w.slice(p[0], p[1])).split(/[^a-z0-9$%&@.:'-]+/).filter(Boolean);
    return t.every(x => CLOCK_GLUE.has(x) || CLOCK_FRAG.test(x) || CLOCK_DAY1.test(x) || CLOCK_DP.some(([, re]) => new RegExp('^(?:' + re.source.replace(/\\b/g, '') + ')$').test(x))); };
  let k = parts.findIndex(p => ti >= p[0] && ti < p[1]); if (k < 0) k = parts.length - 1;
  let a = k, b = k;
  if (frag(parts[k], true)) { while (a > 0 && frag(parts[a - 1])) a--; if (a > 0) a--; while (b < parts.length - 1 && frag(parts[b + 1])) b++; }
  return { lo, hi, rlo: parts[a][0], rhi: parts[b][1] };
}
// ANOTHER THING'S DAY-PART WORD (Oct 28 2026, round 2e - the review of round 2d, HIGH): "carl works the morning shift saturday and robin works
// saturday 5 to 11" stored Robin 5 AM to 11 AM over the model's right 5 PM; "block bay 1 for the night league and bay 2 friday 10 to 2 for the
// kids camp" Bay 2 10 PM to 2 AM; "block bay 2 saturday 10 to 2 and the night league gets bay 3" the same. Rule 1's "joined to the thing made"
// and "beside it" counted the day-part word of ANOTHER thing - another person, another bay, another league - across "and". An "and" (or "&",
// "plus", "while") that starts a new part of the sentence - a person, a bay, "the ..." - stands between two things: a day-part word on the
// other side of it is not this time's. An "and" joining days or times ("friday night and saturday 8 to 1", "tonight and tomorrow 8 to 1")
// is a list, not a new thing
function clockConj(w, a, b) {
  const s = w.slice(Math.min(a, b), Math.max(a, b)), t = s.split(/[^a-z0-9$%&@:'-]+/).filter(Boolean);
  for (let k = 0; k < t.length; k++) {
    if (!/^(?:and|&|plus|while|n)$/.test(t[k])) continue;
    const nx = t[k + 1] || '';
    if (!nx || CLOCK_DAY1.test(nx) || /^\d/.test(nx) || /^(?:and|&|or|to|till|til|until|from|at|then|also)$/.test(nx) || CLOCK_DP.some(([, re]) => new RegExp('^(?:' + re.source.replace(/\\b/g, '') + ')$').test(nx))) continue;
    return true;
  }
  return false;
}
// is this day-part word ATTACHED to the time at [ti, tj)? (rule 1's "belongs")
function clockAttached(w, d, ti, tj, R) {
  if (d.i < R.rlo || d.j > R.rhi) return false;
  const toks = (s) => s.split(/[^a-z0-9$%&@'-]+/).filter(Boolean);
  const glue = (s) => toks(s).every(x => CLOCK_GLUE.has(x) || CLOCK_DAY1.test(x));
  // (another thing's word, across an "and" that starts a new thing: never this time's - clockConj, Oct 28 2026)
  if (clockConj(w, d.j <= ti ? d.j : tj, d.j <= ti ? ti : d.i)) return false;
  // (a) beside the time, with only small words and days between
  if ((d.j <= ti && glue(w.slice(d.j, ti))) || (d.i >= tj && glue(w.slice(tj, d.i)))) return true;
  // (d) joined to the thing made - "night shift", "dinner party", "league night", "morning rate"
  const after = toks(w.slice(d.j, d.j + 24))[0] || '', before = toks(w.slice(Math.max(0, d.i - 24), d.i)).slice(-1)[0] || '';
  if (CLOCK_THING.test(after) || CLOCK_THING.test(before)) return true;
  // (b) the time's day said with its part ("tonight", "friday night", "this evening") - the one day its part of the words names, and
  // never one said plainly beside the time too ("block bay 1 tomorrow 10 to 2 ... tomorrow night" is tomorrow, said plainly)
  const prev = (toks(w.slice(Math.max(0, d.i - 16), d.i)).slice(-1)[0] || '');
  const fused = /^(?:tonight|tonite|tonights|2night|2nite|weeknights?|nightly)$/.test(d.word) ? clockStem(d.word) : (/^(?:nights?|nites?|evenings?|evenin|evngs?|eves?|pm|mornings?|afternoons?)$/.test(d.word) && (CLOCK_DAY1.test(prev) || /^(?:this|every|each)$/.test(prev)) ? clockStem(prev) : null);
  if (!fused) return false;
  const days = [...w.slice(R.rlo, R.rhi).matchAll(CLOCK_DAY)].map(x => ({ i: R.rlo + x.index, j: R.rlo + x.index + x[0].length, s: clockStem(x[0]) }));
  if (days.some(x => x.s !== fused && !(x.i >= d.i - 16 && x.j <= d.i))) return false;
  const plainBeside = days.some(x => x.s === fused && x.j <= d.i - prev.length - 1 && ((x.j <= ti && glue(w.slice(x.j, ti))) || (x.i >= tj && glue(w.slice(tj, x.i)))));
  return !plainBeside;
}
// the facility's hours for the rule's second step: does this reading of the time fit them? (null: no hours to read, or open 24 hours)
function clockFits(kind, r, hours, day) {
  const h = hours || {}; if (!h.openTime || !h.closeTime || h.open24Hours) return null;
  const dh = day && h.dayHours && h.dayHours[day] && h.dayHours[day].open ? h.dayHours[day] : null;
  const o = clockMin(dh ? dh.open : h.openTime), c0 = clockMin(dh ? dh.close : h.closeTime); if (o === null || c0 === null) return null;
  const c = c0 + (c0 <= o || (!dh && h.closeNextDay) ? 1440 : 0), late = c >= 1440;
  const inOpen = (x) => { let y = x; if (y < o) y += 1440; return y >= o && y < c; }, inside = (x) => { let y = x; if (y <= o) y += 1440; return y > o && y < c; };
  if (kind === 'range') return inOpen(r.s) && (r.e <= 1440 || late);
  if (kind === 'at') return inOpen(r.s);
  if (kind === 'loneStart') return inside(r.s);
  if (kind === 'loneEnd') return inside(r.e);
  // (a closing hour: a close the same day that leaves the day four hours open; one past midnight within six hours of the day's own close,
  // and by 6 AM - both fit often, and then it is asked: "open till 3 on sundays" at a place that closes at 11 PM is an early close or a late
  // night. "open till 1 on fridays" there is 1 AM: 1 PM would leave three hours)
  if (kind === 'close') { const R = r.e <= o ? r.e + 1440 : r.e; return R <= 1440 ? R - o >= 240 : R - c <= 360 && R <= 1440 + 360; }
  if (kind === 'open') return r.s >= 300 && r.s <= c - 300;
  return null;
}
// the facility's close that day, in minutes from midnight (null: no hours to read, or open 24 hours) - "till close" (Oct 28 2026)
function clockClose(hours, day) {
  const h = hours || {}; if (!h.openTime || !h.closeTime || h.open24Hours) return null;
  const dh = day && h.dayHours && h.dayHours[day] && h.dayHours[day].open ? h.dayHours[day] : null;
  return clockMin(dh ? dh.close : h.closeTime);
}
// THE RULE ITSELF: which half of the day the time at [ti, tj) in w is - 'am' (the reading that starts or ends in the morning) or 'pm',
// or null: ask. cand: { am: { s, e }, pm: { s, e } } in minutes. opt.name: an event's own name (its day-part words are attached);
// opt.day: the weekday whose own hours fit; opt.why: an object the reason is written to ('attached', 'facility', 'negated' ...)
const NAME_NIGHT = /\b(?:league|leagues|trivia|karaoke|ladies|ladies'|lady's|date|game|poker|bingo|family|college|industry|couples|singles|music|comedy|team|wing|wings|taco|burger|pizza|steak|fight|movie|quiz|members?|seniors?|student|military|retro|theme|disco|glow|cosmic|scramble|tournament)\s+(?:nights?|nites?)$/;
function clockHalf(w, ti, tj, kind, cand, hours, opt) {
  const o = opt || {}, why = (x) => { if (o.why) o.why.is = x; };
  // (a thing's own name - an event's title, a special's, a block's label - is attached when it is the owner's own words: "Monday Night
  // Football special: bud light $2 off 5 to 9" is the evening. A name the model made up is not the owner's, and counts for nothing)
  const nm = o.name ? clockWords(o.name).trim().replace(/^the /, '') : '', ni = nm && nm.length >= 3 ? w.indexOf(nm) : -1;
  let dps = clockDps(w).map(d => (ni >= 0 && d.i >= ni && d.j <= ni + nm.length ? Object.assign(d, { named: true }) : d)), named = [];
  // (ANOTHER THING'S NAME THAT ENDS IN "NIGHT" - Oct 28 2026, round 2g, the critic of round 2f: "happy hour weekdays 2 to 5 at $15 a half hour,
  // tuesday is league night" was asked "2 AM to 5 AM, or 2 PM to 5 PM?" at a place open from 6 - the league's own name, said about another
  // day, counted as the evening said somewhere in the words. "League night", "trivia night", "karaoke night" ... not joined to this time is a
  // name, no part of the day: the facility's hours decide, as with no such word. Joined to the time - "league night 7 to 10", "the league night
  // special 5 to 9" - it is the evening, as before; an evening word that is not a name - "tuesday nights are busy" - is still asked)
  if (dps.length) { const R0 = clockRegion(w, ti, tj); dps = dps.filter(d => !(!d.named && NAME_NIGHT.test(w.slice(Math.max(0, d.i - 24), d.j)) && !clockAttached(w, d, ti, tj, R0))); }
  if (dps.some(d => d.neg)) { why('negated'); return null; }
  const all = dps.concat(named);
  const endOf = (r) => { const v = r.e === undefined || r.e === null ? r.s : r.e; return v < 300 ? v + 1440 : v; };
  const inWin = (d, r) => (kind === 'close' || kind === 'loneEnd' ? (endOf(r) >= d.ew[0] && endOf(r) <= d.ew[1]) : (r.s >= d.sw[0] && r.s <= d.sw[1]));
  if (all.length) {
    const R = clockRegion(w, ti, tj), att = dps.filter(d => d.named || clockAttached(w, d, ti, tj, R));
    if (!att.length) { why('elsewhere'); return null; }
    const ok = ['am', 'pm'].filter(k => cand[k] && all.every(d => inWin(d, cand[k])));
    if (ok.length === 1) { why('attached'); return ok[0]; }
    why(ok.length ? 'both' : 'contradicted'); return null;
  }
  const fit = ['am', 'pm'].filter(k => cand[k] && clockFits(kind, cand[k], hours, o.day));
  if (fit.length === 1 && clockFits(kind, cand[fit[0]], hours, o.day) !== null) { why('facility'); return fit[0]; }
  why(clockFits(kind, cand.am || cand.pm, hours, o.day) === null ? 'no hours' : fit.length ? 'both fit' : 'none fit');
  return null;
}
// a number as typed: "8", "8:30", "8pm", "8 pm", "8p", "noon", "midnight", "20:00", "07:00" -> { v: minutes on the 12-hour face (0-719) or
// the 24-hour clock, said: true when its half is on it }
const CLOCK_NUM = '(?:noon|midnight|\\d{1,2}(?::[0-5]\\d)?(?:\\s*(?:am|pm)\\b|[ap]\\b)?)';
function clockNum(t) {
  const s = String(t || '').trim();
  if (s === 'noon') return { v: 720, said: true }; if (s === 'midnight') return { v: 0, said: true };
  const m = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a|p)?$/.exec(s); if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2] || 0); if (h > 23) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; return { v: ((h % 12) + (m[3][0] === 'p' ? 12 : 0)) * 60 + mm, said: true }; }
  if (h === 0 || h > 12 || (/^0\d$/.test(m[1]) && m[2] !== undefined)) return { v: h * 60 + mm, said: true };   // the 24-hour clock
  return { v: (h % 12) * 60 + mm, said: false };
}
const clockFwd = (s, face) => { let e = face; while (e <= s) e += 720; return e; };     // the first time on that face after s
const clockBack = (e, face) => { let s = face; while (s + 720 < e) s += 720; while (s >= e) s -= 720; return s; };   // the last before e
// WHERE THE OWNER SAID A CALL'S TIME, AND HOW: the call's start (and end) found in the words as a range ("8 to 1", "from 8 until 1",
// "between 9 and 11"), a lone end ("before 11", "till 3") or start ("after 5", "at 8") - its numbers the same on the clock's face
// { kind, i, j, s: {v, said}, e: {v, said} } or null
function clockFind(w, S, E, prefer, markers) {
  const face = (x) => ((x % 720) + 720) % 720;
  // (never a count, a length, money or a date: "2 to 4 players", "2-3 hours", "10%", "the 31st" - each word whole: "weeks" is not "weekdays")
  const NOT_TIME = '(?!\\s*(?:%|(?:percent|hours?|hrs?|h|minutes?|mins?|people|players|guests|kids|dollars|bucks|bays?|weeks?|days?|months?|years?|times|st|nd|rd|th|off|x)\\b))';
  const BEFORE_OK = (i) => !/(?:[$#\/]|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s|\bbay\s|\bno\.?\s|\bnumber\s)$/.test(w.slice(Math.max(0, i - 10), i));
  if (E !== null && E !== undefined) {
    // (never inside a date: "2026-11-05" holds no range "11-05" - Oct 27 2026)
    const re = new RegExp(`(?<![\\d:.$/]|\\d-)(${CLOCK_NUM})\\s*(?:-|–|—|to|till|til|until|untill|thru|through)\\s*(${CLOCK_NUM})(?![\\d:])${NOT_TIME}|\\bbetween\\s+(${CLOCK_NUM})\\s+and\\s+(${CLOCK_NUM})(?![\\d:])${NOT_TIME}`, 'g');
    for (const x of w.matchAll(re)) {
      const a = clockNum(x[1] || x[3]), b = clockNum(x[2] || x[4]); if (!a || !b || !BEFORE_OK(x.index)) continue;
      // (the same numbers on the clock's face - whichever half the call read them in; a half the owner said is put right below. A
      // shift's midnight is 23:59)
      if (face(a.v) === face(S) && (face(b.v) === face(E) || (face(b.v) === 0 && E % 1440 === 1439))) return { kind: 'range', i: x.index, j: x.index + x[0].length, s: a, e: b };
    }
  }
  const single = (v, markers, kind) => {
    const re = new RegExp(`(?:\\b(?:${markers})\\s+|(?<=\\b${CLOCK_DAYW}\\s))(${CLOCK_NUM})(?![\\d:])${NOT_TIME}`, 'g');
    for (const x of w.matchAll(re)) { const n = clockNum(x[1]); if (!n) continue; const at = x.index + x[0].length - x[1].length;
      if (!BEFORE_OK(at)) continue;
      if (n.said ? n.v % 1440 === v % 1440 : face(n.v) === face(v)) return { kind, i: at, j: x.index + x[0].length, n }; }
    return null;
  };
  const START = 'at|@|from|after|past|around|about|by|starting(?:\\s+at)?|starts?(?:\\s+at)?|start(?:ing)?|begins?(?:\\s+at)?|beginning(?:\\s+at)?|opens?(?:\\s+at)?|opening(?:\\s+at)?|kicks? off(?:\\s+at)?|tee off(?:\\s+at)?';
  const END = 'before|until|untill|till|til|to|by|up to|close[sd]?(?:\\s+at)?|closing(?:\\s+at)?|ends?(?:\\s+at)?|ending(?:\\s+at)?|done(?:\\s+by)?';
  if (E !== null && E !== undefined) {
    // ("from 8 till close", "5 to close", "8 til closing": a start whose end is the day's own close - toClose, Oct 28 2026)
    { const re = new RegExp(`(?<![\\d:.$/])(${CLOCK_NUM})\\s*(?:-|–|—|to|till|til|until|untill|thru|through)\\s+(?:the\\s+)?clos(?:e|ing)\\b`, 'g');
      for (const x of w.matchAll(re)) { const n = clockNum(x[1]); if (!n || !BEFORE_OK(x.index)) continue;
        if (n.said ? n.v % 1440 === S % 1440 : face(n.v) === face(S)) return { kind: 'loneStart', i: x.index, j: x.index + x[1].length, s: n, toClose: true }; } }
    if (S % 1440 === 0 && prefer !== 'start') { const f = single(E, END, 'loneEnd'); if (f) return { kind: 'loneEnd', i: f.i, j: f.j, e: f.n }; }
    const f = single(S, START, 'loneStart'); if (f) return { kind: 'loneStart', i: f.i, j: f.j, s: f.n };
    return null;
  }
  const f = single(S, markers || (prefer === 'close' ? END : prefer === 'open' ? START : START + '|for'), 'at');
  return f ? { kind: 'at', i: f.i, j: f.j, s: f.n } : null;
}
// A CALL'S CLOCK READ BY THE RULE: its start (and end) as the owner said them - spec { start: 'HH:MM', end?: 'HH:MM' }, opt { name,
// day, kind: 'close'|'open' for an opening hour }. Returns null (not a time the owner typed - left as it is), { set: { start, end },
// why } (said, or certain by rule 1 or 2 - the call is put right when it read the other half), or { ask: [{ start, end }, { start, end }],
// labels, single, why } - the two to tap, the morning first.
function clockOf(words, spec, hours, opt) {
  const o = opt || {}, w = clockWords(words), S = clockMin(spec && spec.start), E0 = spec && spec.end != null && spec.end !== '' ? clockMin(spec.end) : null;
  if (S === null) return null;
  const E = E0 === null ? null : E0;
  const loc = clockFind(w, S, E, o.kind, o.markers); if (!loc) return null;
  const why = {}, out = (r, how) => ({ set: { start: clockHm(r.s), end: r.e === null || r.e === undefined ? undefined : clockHm(r.e) }, why: how });
  const label = (r) => (loc.kind === 'loneEnd' ? `until ${clockSay(r.e)}` : loc.kind === 'loneStart' && E !== null && (E === 0 || E === 1439) ? `from ${clockSay(r.s)}` : r.e === null || r.e === undefined ? clockSay(r.s) : `${clockSay(r.s)} to ${clockSay(r.e)}`);
  const ask = (am, pm, how) => ({ ask: [{ start: clockHm(am.s), end: am.e === null || am.e === undefined ? undefined : clockHm(am.e) }, { start: clockHm(pm.s), end: pm.e === null || pm.e === undefined ? undefined : clockHm(pm.e) }], labels: [label(am), label(pm)], single: E === null, why: how });
  let cand, kind = loc.kind;
  if (loc.kind === 'range') {
    const a = loc.s, b = loc.e;
    if (a.said && b.said) { let e = b.v; while (e <= a.v) e += 1440; return out({ s: a.v, e }, 'said'); }
    // (the half written once runs on or back within twelve hours - "9am to 10" is 9 to 10 AM, "9 to 10pm" 9 PM; a call that read the other,
    // longer span - 9 AM to 10 PM - is a reading too, and the rule's own steps decide between the two, or both are asked)
    const between = (one, two) => { const half = clockHalf(w, loc.i, loc.j, 'range', { am: one, pm: two }, hours, Object.assign({}, o, { why })); return half ? out(half === 'am' ? one : two, why.is) : ask(one, two, 'said one way, the call the other'); };
    if (a.said) { const e = clockFwd(a.v, b.v % 720), alt = e + 720, callE = E < S ? E + 1440 : E;
      return S === a.v % 1440 && callE === alt && alt - a.v < 1440 ? between({ s: a.v, e }, { s: a.v, e: alt }) : out({ s: a.v, e }, 'said'); }
    if (b.said) { let eb = b.v === 0 ? 1440 : b.v, s = clockBack(eb, a.v % 720); if (s < 0) { s += 1440; eb += 1440; }
      const alt = s - 720;
      return (E % 1440) === (eb % 1440) && S === alt && alt >= 0 ? between({ s: alt, e: eb }, { s, e: eb }) : out({ s, e: eb }, 'said'); }
    const s0 = a.v % 720; cand = { am: { s: s0, e: clockFwd(s0, b.v % 720) }, pm: { s: s0 + 720, e: clockFwd(s0 + 720, b.v % 720) } };
  } else if (loc.kind === 'loneEnd') {
    if (loc.e.said) return out({ s: S, e: loc.e.v }, 'said');
    const f = loc.e.v % 720; cand = { am: { s: S, e: f }, pm: { s: S, e: f + 720 } };
  } else if (loc.kind === 'loneStart') {
    // (the end kept: the end of the day as it was, or the call's own length from the new start)
    // ("TILL CLOSE" ENDS AT THAT DAY'S CLOSE - Oct 28 2026, round 2e: "block bay 2 tonight from 8 till close", read by a model as 8 AM to 11
    // PM, had its start moved to 8 PM and kept its fifteen hours - Mon 8 PM to Tue 11 AM; "carl closes friday 5 to close" offered only "5 PM to
    // 11 AM" as two shifts. The end of a start said "till close" is the facility's own close that day; with no close to read - a place open 24
    // hours - the call's own end, never its length)
    // (a start the place is not open at, or a place open 24 hours, has no close to run to - "tonight from 8 till close" at a place that closes
    // at 5 PM: the end is not the box's to pick, and a caller that can hand the change back (opt.handOff - the engine's guard) is told so;
    // any other caller keeps the reading it had)
    const closeAt = loc.toClose ? clockClose(hours, o.day) : null, opensAt = (s) => clockFits('at', { s }, hours, o.day) === true;
    const len = E === null ? null : (E === 0 || E === 1439) ? null : ((E - S) % 1440 + 1440) % 1440;
    const endFor = (s) => (closeAt !== null && opensAt(s) ? closeAt : E === null ? null : len === null ? E : s + len);
    if (loc.toClose && (closeAt !== null || o.handOff)) {
      const f = loc.s.said ? loc.s.v % 720 : loc.s.v % 720, c2 = { am: { s: f, e: endFor(f) }, pm: { s: f + 720, e: endFor(f + 720) } };
      const half = loc.s.said ? (loc.s.v % 1440 < 720 ? 'am' : 'pm') : clockHalf(w, loc.i, loc.j, 'at', c2, hours, Object.assign({}, o, { why }));
      const noClose = (x) => ({ hand: `the owner said "till close" from ${clockSay(x.s)}, and the place ${closeAt === null ? 'has no closing time (open 24 hours)' : 'is not open then (it closes at ' + clockSay(closeAt) + ')'}: ask the owner what time it ends - never a length or an end the call made up` });
      if (half && closeAt !== null && opensAt(c2[half].s)) return out(c2[half], loc.s.said ? 'said' : why.is);
      if (half && o.handOff) return noClose(c2[half]);
      if (closeAt !== null) {
        // (neither certain: both asked - each to the day's close where the place is open then)
        if (opensAt(c2.am.s) && opensAt(c2.pm.s)) return ask(c2.am, c2.pm, why.is);
        if (o.handOff) return noClose(opensAt(c2.am.s) ? c2.pm : c2.am);
      }
      if (o.handOff) return noClose(c2.pm);
    }
    if (loc.s.said) return out({ s: loc.s.v, e: endFor(loc.s.v) }, 'said');
    const f = loc.s.v % 720; cand = { am: { s: f, e: endFor(f) }, pm: { s: f + 720, e: endFor(f + 720) } };
  } else {
    if (loc.s.said) return out({ s: loc.s.v }, 'said');
    const f = loc.s.v % 720; cand = o.kind === 'close' ? { am: { s: f, e: f }, pm: { s: f + 720, e: f + 720 } } : { am: { s: f }, pm: { s: f + 720 } };
    if (o.kind === 'close' || o.kind === 'open') kind = o.kind;
  }
  const half = clockHalf(w, loc.i, loc.j, kind, cand, hours, Object.assign({}, o, { why }));
  return half ? out(cand[half], why.is) : ask(cand.am, cand.pm, why.is);
}
// A TIME THE BOX READ ITSELF (intents.js - an event's "at 8", a booking's "at 10", a quote's "and at 6?"): the time as typed, raw, at its
// first place in the words (after "at" when it is said so), read by the same rule. { time } | { ask: ['HH:MM' morning, 'HH:MM' evening],
// noon: true when the two are noon and midnight } | null
function clockAtWords(words, raw, hours, opt) {
  const o = opt || {}, w = clockWords(words), r = clockWords(raw).trim(), n = clockNum(r); if (!n) return null;
  if (n.said) return { time: clockHm(n.v) };
  const esc = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), find = (re) => { const x = re.exec(w); return x ? { i: x.index + x[0].length - r.length, j: x.index + x[0].length } : null; };
  const loc = find(new RegExp(`\\bat\\s+${esc}(?![\\d:])`)) || find(new RegExp(`(?<![\\d:$#])${esc}(?![\\d:])`));
  if (!loc) return null;
  const f = n.v % 720, cand = { am: { s: f }, pm: { s: f + 720 } }, why = {};
  const half = clockHalf(w, loc.i, loc.j, o.kind || 'at', cand, hours, Object.assign({}, o, { why }));
  return half ? { time: clockHm(cand[half].s), why: why.is } : { ask: [clockHm(f), clockHm(f + 720)], noon: f === 0, why: why.is };
}
// THE DAY-PART WORD ATTACHED TO A RANGE, AND NOTHING ELSE (rangeIn's own first reading, before the engine reads the whole rule with the
// facility's hours): the parts of the day attached to the time at [ti, tj) in clockWords' words, un-negated - Set of 'morning', 'evening' ...
function clockAttachedParts(w, ti, tj) {
  const R = clockRegion(w, ti, tj);
  return new Set(clockDps(w).filter(d => !d.neg && clockAttached(w, d, ti, tj, R)).map(d => d.cls));
}
// AN AMOUNT OF MONEY THE OWNER SAID (maintainer, Oct 22 2026: "be very very cautious on all things requiring tax and money and make sure it
// asks and verifies"): the number in their own words - $5, 5, 5.00, $4.50 - never one the model worked out or made up
function moneySaid(v, words) {
  const n = Number(v); if (!Number.isFinite(n)) return false;
  const w = String(words || '').replace(/,(?=\d{3}\b)/g, '');
  const forms = [String(n), n.toFixed(2)].concat(Number.isInteger(n) ? [] : [String(n).replace(/^0(?=\.)/, '')]);
  return forms.some(f => new RegExp('(?:^|[^\\d.])' + f.replace(/\./g, '\\.') + '(?:\\.0+)?(?!\\d|\\.\\d)').test(w));
}
// THE MONEY THE OWNER SAID, EACH AMOUNT WITH WHAT IT IS (Oct 27 2026, round 2d - the engine's MONEY CARRIED): "$20 an hour" (hour), "$15 a
// half hour" and "15 per 30 min" (half), "$2 off" and "50 cents off" (off), "15% off" and "half off" (pct), "$5" alone (bare) - each in the
// owner's own words, never one worked out. A time ("5 to 9", "5:30") or a length ("2 hours") is no money
// WHAT AN AMOUNT IS, BESIDE THE PRICE (Oct 28 2026, round 2e - the review of round 2d, HIGH): a saving, a difference, a bundle and a total
// were each read as a bare price - "bud light $1 cheaper on fridays 5 to 9" put up "Bud Light at $1 each" over the model's right "$1 off",
// "bud light 2 for $5" "$5 each", "drop the happy hour price by $5" asked "$5 a half hour, or $5 an hour?" (both wrong prices), "save $5 a
// half hour" put up $5 a half hour. Now each amount says what it is:
//   off   a saving - "$2 off", "$1 cheaper", "$2 less", "$2 discount", "save $2", "50 cents off" (a counter special's dollars off; for a
//         price window, how much lower - never its price)
//   more  a surcharge - "$5 more", "$5 extra", "$5 higher" (never a price)
//   diff  a change BY an amount - "drop the price by $5", "raise the weekend rate $5", "bump happy hour up $2" (never a price)
//   was   the price it was - "from $15 to $20" (never the new price)
//   bundle  several for one amount - "2 for $5", "bucket of 5 bud lights for $15" (count: how many)
//   total   one amount for several hours - "$40 for 2 hours" (hours: how many)
const MONEY_N = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
// SAID WITH "UP" OR "DROP" AND NO CHANGE (Oct 28 2026, round 2f - the review of round 2e: "can you set up happy hour weekdays 2 to 5 $15 a half
// hour", "lets set up a $12 senior rate", "drop-in rate weekdays 2 to 5 $20 an hour", "up to 4 players ... $40 an hour" and "$40 up to 4 players"
// each read the owner's plain price as a change by that much - "up" and "drop" were change verbs wherever they stood - and the model's right
// window was handed back with "how much lower or higher ... never the new price", which makes no sense for a new window). "set up", "set it
// up", "up to" and "drop-in" are no change: they are taken out before the change verbs are looked for
// (Oct 28 2026, round 2g - the reviewer and the critic of round 2f: the same class was left - "put up a $15 happy hour weekdays 2 to 5" (the
// box's own word for a card), "drop ins are $20 an hour", "set us up a happy hour", "set happy hour up", "set-up", "sign up special", "warm up
// special" were each a change by that much, and the model's right new window was handed back with a question that makes no sense. "put up" /
// "set up" said together, "put / set <a few words> up" with no amount or "by" straight after, "set-up", the "-up" nouns and "drop ins" are no
// change; "put the price up $2", "put prices up by $5", "set the price up $2", "bump happy hour up $2" still are)
// ("PUT UP" SAID TOGETHER IS A RAISE WHEN THE AMOUNT FOLLOWS THE THING IT RAISES - Oct 28 2026, round 2h, the reviewer of round 2g: every "put
// up" was made no change, so "put up the weekend price $5 an hour", "can we put up weekend prices $5 an hour", "put up happy hour $2 a half
// hour" read the raise as the new price - the model's right $22.50 was replaced by the owner's own "$5 an hour" on the card ($2.50 a half
// hour stored), and "put up happy hour $2" / "put up the weekend rate $5" were asked "a half hour, or an hour?", both wrong. "put up" with
// only the thing's own words between it and an amount - "the weekend price $5", "weekends $5 an hour", "happy hour $2", "by $5" - is a change
// by that much, as before round 2g; "put up a $15 happy hour", "put up a new / another ...", and "put up happy hour weekdays 2 to 5 $15 a half
// hour" (a time between) are still no change. "set up" said together is unchanged: no change)
const PUT_UP_RAISE = /(?=(?:\s+(?!(?:a|an|another|new|some|one)\b)[a-z'&]+){0,4}\s+(?:by\s+)?(?:\$|\d+(?:\.\d{1,2})?\s*(?:dollars?|bucks?)\b|\d+(?:\.\d{1,2})?\s*$))/.source;
const MONEY_NOCHANGE = (t) => t.replace(/\bset(?:s|ting)?\s+(?:(?:it|that|this|them|one|something|everything)\s+)?up\b/g, 'set_up').replace(/\bup\s+to\b/g, 'up_to')
  .replace(/\bset(?:s|ting)?[-\u2013\u2014\s]?up\b/g, 'set_up').replace(new RegExp(`\\bput(?:s|ting)?[-\\u2013\\u2014\\s]?up\\b(?!${PUT_UP_RAISE})`, 'g'), 'put_up').replace(/\b(put|set)(?:s|ting)?\s+((?:[a-z']+\s+){1,3}?)up\b(?!\s*(?:by\b|\$|\d|a\s+(?:buck|dollar)|an?\s+extra))/g, '$1_ $2 _up')
  .replace(/\b(?:sign|warm|pick|line|meet|tune|start|check|follow|round)[-\u2013\u2014\s]?ups?\b/g, 'x_up')
  .replace(/\bdrop[-\u2013\u2014]\s?ins?\b|\bdrop\s?ins\b|\bdrop\s+in\b(?=\s+(?:rate|rates|golf|play|session|sessions|players?|customers?|guests?|fee|fees|is|pay|pays|costs?)\b)/g, 'drop_in');
// A COUNT THAT IS NO COUNT OF THINGS (Oct 28 2026, round 2f - the review of round 2e, HIGH: "can we run draft beers 5-9 for $3 on fridays" was
// read as the bundle "9 for $3" - the range's dash stood where the count's lead goes, so the range guard never saw it - and the model's right $3
// was handed back with "that is $0.33 each": a model that followed it put the beer up at 33 cents. "wings on tuesdays 4-8 for $6" the same at
// $0.75). A number in a time - the end of a range ("5-9", "5 to 9", "after 9"), an hour said with am / pm / o'clock or "to close" - or in a size
// ("22 oz", "10 piece") is never a count: the amount is the owner's own price, and no hint ever names a price under it
const COUNT_LEAD_TIME = /(?:\b(?:to|till|til|until|untill|thru|through|from|at|after|before|by|past|around|about|between)|\bbetween\s+\S+\s+(?:and|&)|[-\u2013\u2014])\s*$/;
const COUNT_WORDS_NOT = /^(?:am|pm|oclock|o'clock|close|closing|midnight|noon|tonight|tonite|to|till|til|until|thru|through|oz|ounces?|piece|pieces|pc|pcs|inch|inches|hours?|hrs?|minutes?|mins?|percent)$/;
function moneyIn(words) {
  const s = String(words || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/,(?=\d{3}\b)/g, ''), out = [];
  for (const m of s.matchAll(/(\$\s?)?(?<![\d.:])(\d+(?:\.\d{1,2})?)(?![\d:])/g)) {
    const dollar = !!m[1], n = Number(m[2]), after = s.slice(m.index + m[0].length, m.index + m[0].length + 40), before = s.slice(Math.max(0, m.index - 60), m.index);
    // ("set up", "up to", "drop-in" are no change - Oct 28 2026: the change verbs are looked for in the words with them taken out)
    // (read with the amount after it, so "put the price up $2" keeps its "up": Oct 28 2026, round 2g)
    const nb = MONEY_NOCHANGE(before + m[0]), changeBefore = nb.endsWith(m[0]) ? nb.slice(0, nb.length - m[0].length) : MONEY_NOCHANGE(before);
    // (the part of the words the amount stands in, up to it: a change verb said before it in the same part - "raise the weekend rate $5")
    const part = changeBefore.split(/[.;!?\n]|,\s|\b(?:but|and then|also|then)\b/).pop();
    const bucks = /^\s*(?:dollars?|bucks?)\b/.test(after), money = dollar || bucks;
    let kind = null, v = n, extra = {};
    if (/^\s*(?:%|percent\b|pct\b)/.test(after)) kind = 'pct';
    else if (/^\s*(?:cents?|c)\b/.test(after)) { kind = /^\s*(?:cents?|c)\s+(?:off|cheaper|less|discount)\b/.test(after) ? 'off' : 'bare'; v = n / 100; }
    else if (money || /^(?:\s*(?:dollars?|bucks?))?\s+(?:off|cheaper|less|discount)\b/.test(after)) {
      const unit = /^(?:\s*(?:dollars?|bucks?))?\s*(?:a|an|per|\/|every|each)\s*(half[- ]?(?:an? )?(?:hour|hr)|1\/2 ?(?:hour|hr)|30 ?min(?:ute)?s?|thirty min(?:ute)?s?|hour|hr)\b/.exec(after);
      const forHours = /^(?:\s*(?:dollars?|bucks?))?\s+for\s+(?:(\d+(?:\.\d+)?)|(an?|one|two|three|four|five|six|seven|eight))\s*(hours?|hrs?|half[- ]hours?|30 ?min(?:ute)?s?|minutes?|mins?)\b/.exec(after);
      const count = /(?:^|[^\d:$.])(\d{1,3})\s+((?:[a-z']+\s+){0,3})for\s+\$?\s?$/.exec(before);
      // (A LENGTH BEFORE "FOR $X" IS A TOTAL FOR THAT LENGTH - Oct 28 2026, round 2g, the reviewer and the critic of round 2f, HIGH: "2 hours for
      // $40", "2 hrs for $40", "90 minutes for $30", "3 hours for $50" were read as a bare $40 - the count guard took the hours out of the bundle
      // and nothing read them as a length - so the box asked "Is that $40 a half hour, or $40 an hour?", both wrong, and the owner's typed "$20 an
      // hour" put up the base price: the discount gone. As "$40 for 2 hours" reads: a total over that many hours; one hour is "an hour", a half
      // hour "a half hour". A count of things - "2 for $5" - is still a bundle)
      const lenFor = /(?:^|[^\d:$.\w])(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight)\s*-?\s*(hours?|hrs?|half[- ]hours?|minutes?|mins?)(?:\s+(?:session|block|slot|of (?:golf|play|bay time|sim time|simulator time|range time|time)))?\s+for\s+\$?\s?$/.exec(before)
        || /(?:^|[^\d:$.\w])(an?)\s+(half[- ]hours?)\s+for\s+\$?\s?$/.exec(before);
      // (the words before the count's own digits - the lead the count regex takes, a range's dash, is theirs - and the words after it: a time or
      // a size is no count, Oct 28 2026)
      const countIsNot = !!count && (COUNT_LEAD_TIME.test(before.slice(0, count.index + count[0].search(/\d/)))
        || count[2].split(/\s+/).filter(Boolean).some(x => COUNT_WORDS_NOT.test(x)));
      if (/\b(?:save|saves|saving|knock|knocks|knocking|takes?|taking)\s+(?:an?\s+)?(?:extra\s+)?$/.test(before) || /^(?:\s*(?:dollars?|bucks?))?\s*(?:off|cheaper|less|lower|discount(?:ed)?|savings?)\b/.test(after)) kind = money ? 'off' : null;
      // ("$40 up to 4 players" is $40 for up to four - never $40 more: Oct 28 2026)
      else if (/^(?:\s*(?:dollars?|bucks?))?\s*(?:more|extra|higher|up(?!\s+to\b))\b/.test(after)) kind = 'more';
      else if (/\bfrom\s+$/.test(before) && /^\s*(?:to|till|-)\s*\$?\s?\d/.test(after)) kind = 'was';
      else if (/\bby\s+(?:an?\s+(?:extra\s+)?)?$/.test(before) || /\b(?:up|down)\s+$/.test(changeBefore)
        || (/\b(?:rais(?:e|ed|es|ing)|lower(?:s|ed|ing)?|drop(?:s|ped|ping)?|cut(?:s|ting)?|bump(?:s|ed|ing)?|increas(?:e|ed|es|ing)|decreas(?:e|ed|es|ing)|reduc(?:e|ed|es|ing)|hike|up(?:ped)?)\b/.test(part) && !/\b(?:to|at|is|for)\s+$/.test(before))) kind = 'diff';
      else if (forHours) {
        const k = forHours[1] !== undefined ? Number(forHours[1]) : MONEY_N[forHours[2]], u = forHours[3];
        if (/^(?:half|30)/.test(u) || (/^min/.test(u) && k === 30)) kind = k === 1 || k === 30 ? 'half' : 'total', extra = kind === 'total' ? { hours: k / 2 } : {};
        else if (/^min/.test(u)) { kind = 'total'; extra = { hours: k / 60 }; }
        else { kind = k === 1 ? 'hour' : 'total'; extra = kind === 'total' ? { hours: k } : {}; }
      }
      else if (lenFor) {
        const k = /^\d/.test(lenFor[1]) ? Number(lenFor[1]) : MONEY_N[lenFor[1]], u = lenFor[2];
        const hrs = /^half/.test(u) ? k / 2 : /^min/.test(u) ? k / 60 : k;
        if (hrs === 1) kind = 'hour'; else if (hrs === 0.5) kind = 'half'; else if (hrs > 0) { kind = 'total'; extra = { hours: hrs }; }
      }
      // ("$15 per 1/2 hour" is a half hour - Oct 28 2026)
      else if (unit) kind = /^(?:half|30|thirty|1\/2)/.test(unit[1]) ? 'half' : 'hour';
      else if (count && !countIsNot && Number(count[1]) >= 2) { kind = 'bundle'; extra = { count: Number(count[1]) }; }
      else if (money) kind = 'bare';
    }
    const say = { half: ' a half hour', hour: ' an hour', off: ' off', more: ' more', diff: ' (a change by that much)', was: ' (the price it was)' }[kind] || '';
    if (kind) out.push(Object.assign({ n: v, kind, said: kind === 'pct' ? v + '%' : kind === 'bundle' ? `${extra.count} for $${v}` : kind === 'total' ? `$${v} for ${extra.hours} hour${extra.hours === 1 ? '' : 's'}` : '$' + v + say }, extra));
  }
  if (/\bhalf (?:off|price)\b/.test(s)) out.push({ n: 50, kind: 'pct', said: 'half off' });
  return out;
}
// THE OWNER'S HOURS AND DAYS IN THEIR OWN WORDS (Oct 23 2026, the 4B walks in maintainer's typing: "weekdays 2-5", "tuesdays 5 to 9"): a
// range ("2-5", "5 to 9", "3pm-6pm", "11 to 2") on the clock a golf bar keeps - a bare hour up to 10 is the afternoon or evening
// unless "am" or "morning" says otherwise - and the days by name. For the box's own readings of the plainest requests; the card
// the change goes on says the hours in full before the yes.
function rangeIn(words) {
  // (noon, midnight, "10 in the morning", "10 at night" said as people say them - the shifts, the staffed days and the prices by talking,
  // Oct 25 2026: "Sunday noon to 4", "6 to midnight", "from 10 in the morning to 10 at night" read as nothing)
  const s = String(words || '').toLowerCase().replace(/\bnoon\b/g, '12pm').replace(/\bmidnight\b/g, '12am')
    .replace(/\b(\d{1,2}(?::[0-5]\d)?)\s+(?:o'?clock\s+)?in the morning\b/g, '$1am').replace(/\b(\d{1,2}(?::[0-5]\d)?)\s+(?:o'?clock\s+)?(?:at night|in the evening|in the afternoon|tonight)\b/g, '$1pm');
  const m = /\b(?:from |between )?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|\u2013|to|till|til|until)\s*(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d.]|\s*(?:%|percent|hours?|minutes?|mins?|people|players|guests|dollars|bucks|off)\b)/.exec(s);
  if (!m) return null;
  // THE MORNING SAID WITH THE RANGE (Oct 27 2026, the review of round 2: "charge 30 an hour weekdays 9 to 11 for the early birds, regular
  // price every night" was put up as 9 PM to 11 PM): "early birds" is the morning, and a morning word counts only in the range's own part
  // of the words - "lessons in the morning, happy hour 2 to 5" is 2 PM to 5 PM, and an evening word in another part moves nothing either
  // (Oct 27 2026, the review of round 2c: counting it only between the commas read "morning rate weekdays, 8-10, $12 a half hour" and
  // "weekday mornings, 9 to 11, $15" as 8 PM and 9 PM - the owner names the morning first, then the hours. A morning word ATTACHED to
  // the range by THE BARE-HOUR RULE's own reading - a label before a part that says nothing else, beside it, joined to what is priced - is
  // the morning here. This is only the reader's first reading: the engine reads the whole rule, with the facility's hours, before any
  // card goes up - and asks where it is not certain)
  const morning = (() => { const w = clockWords(words), x = new RegExp(`(?<![\\d:.$/]|\\d-)${CLOCK_NUM}\\s*(?:-|\u2013|\u2014|to|till|til|until|untill|thru|through)\\s*${CLOCK_NUM}`).exec(w);
    return !!x && clockAttachedParts(w, x.index, x.index + x[0].length).has('morning'); })();
  const to24 = (h, mer) => { h = Number(h); if (h > 23) return null; if (mer && /^p/.test(mer)) return h < 12 ? h + 12 : h; if (mer && /^a/.test(mer)) return h === 12 ? 0 : h; if (h >= 12 || morning) return h; return h <= 10 ? h + 12 : h; };
  let a = to24(m[1], m[3]), b = to24(m[4], m[6]);
  if (a == null || b == null) return null;
  const hm = (h, mm) => String(h).padStart(2, '0') + ':' + (mm || '00');
  // (to midnight: the end of the day, 00:00 - what every action takes for midnight)
  if (b === 0 && Number(m[4]) === 12 && /^a/.test(m[6] || '') && a > 0) return { from: String(a).padStart(2, '0') + ':' + (m[2] || '00'), to: '00:00' };
  // A BARE "6 TO 12" OR "8 TO 1" (Oct 25 2026, the review: "block off the vault for a party friday from 6 to 12" went up as 6 AM to noon
  // and the party's evening stayed bookable; "put Carl on saturday 5 to 1" as 5 AM to 1 PM): on this clock a bare 6 is the evening, so a
  // bare 12 after it is midnight - "6 to 12" is 6 PM to midnight, as "6 to 11" is 6 PM to 11 PM. A bare 1 to 7 is the evening at any
  // facility (eveningIfClosed's own rule). A bare 8, 9 or 10 before a bare 12 - and a bare 2 to 9 before a bare 1 or 2, whose evening
  // runs past midnight - is said for the morning as often as for the night: no reading at all, so the box asks or the model has the
  // words, never a guess (maintainer: "a wrong change put up is much worse"). "10 to 2" stays 10 AM to 2 PM, as written below.
  const bare = !m[3] && !m[6] && !morning, a0 = Number(m[1]), b0 = Number(m[4]);
  if (bare && b0 === 12 && a0 >= 1 && a0 <= 10) return a0 <= 7 && (!m[5] || m[5] === '00') ? { from: hm(a0 + 12, m[2]), to: '00:00' } : null;
  if (bare && (b0 === 1 || b0 === 2) && a0 >= 2 && a0 <= 9) return null;
  // ("6pm to 12": the evening said, so the bare 12 after it is midnight - it was no reading at all)
  if (/^p/.test(m[3] || '') && !m[6] && b0 === 12 && (!m[5] || m[5] === '00') && a >= 12) return { from: hm(a, m[2]), to: '00:00' };
  if (!m[6] && b === 11 && a >= 12) b = 23;   // "6 to 11": 6 PM to 11 PM
  if (a > b && !m[3] && a - 12 < b) a -= 12;   // "10 to 2": 10 AM to 2 PM
  if (a >= b) return null;
  return { from: hm(a, m[2]), to: hm(b, m[5]) };
}
// THE DAYS SAID, AND THE DAYS LEFT OUT (Oct 27 2026, the review of round 2 - the worst of it, end to end): "happy hour 2 to 5 at $15 a
// half hour, not on weekends" was put up for Saturday and Sunday over the model's right Monday to Friday - the reader took the first days
// named, and the days the owner LEFT OUT were the first. Round 2c read a day left out as the days left; the review of it found the reader
// still guessing in new shapes, so the reading is now one rule (below), written down once, that every caller shares.
// THE DAYS RULE (Oct 27 2026, round 2d of the review - each round before it wrote one more word list, and each review found the next way
// an owner says it: "on weekdays, weekends are regular price" put up EVERY day over the model's right weekdays, "the bogo we did last
// weekend was great, lets do it every day now" a weekend deal, "wed like happy hour 2 to 5" a Wednesday window, "summer sun happy hour"
// a Sunday one, "weekends off" and "nothing on weekends" the weekend itself). ONE reading of every day word in the words, in its place,
// and the days are read ONLY WHEN THEY ARE CERTAIN:
//   1. A GROUP IS ONE CLAUSE'S DAYS - "tues and thurs", "mon wed fri", "monday to thursday", "mon-thu", "tue/thu", "fri, sat and sun".
//      Days joined only by a comma or a space are one list only where the list ends (the end, a stop, a time, "too", "only", "from"):
//      "on tuesdays, thursdays we are slammed" is two groups, tuesdays and thursdays. Two different groups are no reading.
//   2. "EVERY DAY" (daily, every night, all week, any day, 7 days a week) IS A GROUP OF ITS OWN.
//   3. A DAY SAID ABOUT SOMETHING ELSE IS NONE OF THE THING'S DAYS: a start or an end ("every day starting tues", "every day till
//      sunday" - a limit the reading does not hold), a past one ("last weekend"), one that names a thing ("the tuesday happy hour went
//      well", "the friday one"), a day word that is an ordinary word (rule 5). A name's day ("tuesday special:", "weekend warrior",
//      "monday night football", a label) is a group like any other - it gives way only to days said outright that hold it ("taco
//      tuesday: tacos $2 off on tuesdays and thursdays" is both days; "weekend rate: ... fri" is no reading).
//   4. A DAY LEFT OUT, IN ANY FORM, GIVES THE DAYS LEFT: "not (on) X", "never X", "no X", "nothing on X", "except (for) X", "excluding
//      X", "every day but X", "other than X", "minus X", "without X", "skip X", "X off", "X are off", "X is off", "X excluded", "X dont
//      count", "not valid on X". A negative beside a day in any other shape ("no weekend upcharge", "not sunday mornings", "doesnt apply
//      on fridays for members", "no coupons") is no reading; and "no X" after days that never named X ("mondays, no tuesdays") may be a
//      correction - no reading.
//   5. "WED", "SAT" AND "SUN" ALONE ARE DAYS ONLY WHERE THEY CANNOT BE ORDINARY WORDS: beside another day, after on / every / except /
//      till ..., before a time, or ending the clause after a word that is no pronoun or article. "wed like" is "we'd like" (maintainer types no
//      apostrophes); "we sat down", "summer sun", "while the sun is out" name no day.
//   6. ONE TIME IS NEVER EVERY WEEK: "this weekend", "this friday", "next saturday", "tonight", "today", "tomorrow", "this week", Black
//      Friday are a one-off (oneOff) - never a weekly reading; the engine hands a weekly change made of them back (THE DAYS THE OWNER
//      NAMED PLAINLY). An either-or ("tuesdays or thursdays"), "every other", "<day> only", a correction between two days ("tuesdays,
//      actually thursdays") and a move ("from tuesdays to thursdays") are no reading.
// Anything less than certain is null: the model's own call stands, or the box asks - never a guess (maintainer: a wrong change put up is far
// worse than asking). daysSaid gives the whole reading; daysIn the days, or null.
const WEEK7 = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function dayOf(t) {
  if (/^weekdays?$/.test(t)) return { keys: WEEK7.slice(0, 5), full: true, plural: /s$/.test(t) };
  if (/^weekends?$/.test(t)) return { keys: ['sat', 'sun'], full: true, plural: /s$/.test(t) };
  const m = /^(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)(s?)$/.exec(t);
  if (!m) return null;
  return { keys: [m[1].slice(0, 3)], full: /day$/.test(m[1]), plural: /day$/.test(m[1]) && m[2] === 's', ambiguous: /^(?:wed|sat|sun)$/.test(m[1]) };
}
// the words and the marks between them, each with where it is: w a word, p a mark, j a joiner typed with no spaces (- / & +), d a dash
// with spaces round it
function dayTokens(s) {
  const out = [], re = /\s[-–—]+\s|[a-z0-9$%@#][a-z0-9$%@#.:'_]*[a-z0-9$%@#]|[a-z0-9$%@#]|[,;:!?()"[\]]|\.(?![a-z0-9])|[-–—/&+]/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[0].trim();
    out.push({ t, i: m.index, j: m.index + m[0].length, k: /^\s/.test(m[0]) ? 'd' : /^[a-z0-9$%@#]/.test(t) ? 'w' : /^[-–—/&+]$/.test(t) ? 'j' : 'p' });
  }
  return out;
}
const DSET = (s) => new Set(s.trim().split(/\s+/));
// (rule 5: what makes a lone "wed", "sat" or "sun" a day before it, and what makes it an ordinary word)
// ("and", "&", "," make it a day only beside another day - linked, below: "we went out and sat down" names no day)
const D_QUAL = DSET(`on every each this next last except excepting excluding exclude but not no never nothing till til until thru through starting start beginning
  from after before by including only`);
const D_PRON = DSET(`we i you they he she who which the a an my our your their his her summer winter spring fall hot setting rising morning evening midday`);
// (...and after it: "close early sat at 8", "block bay 2 sat night 8 to 1" - a day, unless a pronoun or an article stands before: "we sat at the bar")
const D_NEXT = DSET(`at from between after before till til until night nights nite nites morning mornings afternoon afternoons evening evenings only too`);
const D_JOIN = DSET(`, & + / - and or n plus to thru through till til until`);
const D_RANGE = DSET(`- to thru through till til until`);
const D_TOD = DSET(`night nights nite nites morning mornings afternoon afternoons evening evenings`);
// (rule 1: what ends a list joined only by commas or spaces)
const D_CLOSE = DSET(`too only also all as please pls plz thanks thank thx ty ok okay now again either between from starting at and`);
// (rule 3: the small words after a singular day that keep it a day, not a name's - "friday we close at 1", "tuesday for regulars")
const D_FN = DSET(`on in at for with from to of by and or but so the a an is are was were be been will would should can could do does did we i you they it its if
  when only too also all every each starting till til until untill thru through between after before please pls thanks thx ty this that these those our my
  your their no not never except as then just now again either around about here there ok okay stay stays stayed get gets got has have had go goes went run
  runs ran work works cost costs remain remains keep keeps need needs gonna wanna`);
// (rule 4: the leads of a day left out, the small words that may stand between, and what may end it)
const D_LEAD1 = DSET(`not never no nothing none except excepting excluding exclude excludes minus without skip skipping isnt isn't arent aren't wont won't
  doesnt doesn't dont don't cant can't cannot aint ain't`);
const D_LEAD2 = new Set(['other than', 'apart from', 'aside from', 'save for', 'is not', 'are not', 'will not', 'does not', 'do not', 'can not', 'not including']);
// ("no it is on weekends" is a correction, never a day left out: no "it", "is" or "are" stands between)
const D_FILL = DSET(`on for during the any including of in at over valid available good offered running happening open be will gonna going to apply applies
  count counts work works run runs happen happens done allowed held`);
const D_CLEAN = DSET(`and or but please pls plz thanks thank thx ty either though anymore too ok okay now ever lol`);
const D_TRAIL_OFF = DSET(`off excluded out closed skipped`);
const D_TRAIL_NOT = DSET(`included valid available counted`);
const D_TRAIL_VERB = DSET(`count counts apply applies work works qualify run runs`);
const D_NEG = DSET(`not never no none nothing nor neither without except excepting excluding exclude excludes besides outside unless minus skip skipping cannot
  cant can't dont don't doesnt doesn't didnt didn't wont won't wouldnt wouldn't shouldnt shouldn't couldnt couldn't isnt isn't arent aren't wasnt wasn't
  werent weren't havent haven't hasnt hasn't aint ain't mustnt mustn't`);
const D_BREAKW = DSET(`but so then because cause cuz though although also plus`);
const D_LIMIT = DSET(`starting start starts beginning begins begin effective after before by till til until untill thru through from since`);
const D_CORRECT = DSET(`actually instead mean scratch wait sorry rather nvm`);
const D_HOLIDAY = DSET(`black good fat cyber ash palm easter giving boxing`);
// ("like they do at topgolf on mondays", "like we do on tuesdays": what another place, or another deal, does on that day - never "I'd like you to
// do happy hour on fridays", "we'd like it if we did it on fridays" or "feel like doing happy hour on tuesdays", which ask for it: Oct 28 2026)
const LIKE_ELSE = /(?<!\b(?:i|we|you|u|id|i'd|wed|we'd|youd|you'd|would|wld|feel|feels|felt|feeling|really|might)\s)\blike\s(?!to\s)(?!(?:you|u|ya|yall|y'all|them|us)\s(?:guys\s)?to\s)(?:\S+\s){0,6}(?:do|does|did|doing)\s(?:\S+\s){0,3}<d>/;
// (the thing said for the league itself - "on league nights", "during league", "league night special": Oct 28 2026)
const LEAGUE_THING = /\s(?:on|during|for|at|every|after|before)\s(?:(?:the|our|a)\s)?leagues?(?:\s(?:night|nights|nite|nites|day|days))?\s|\sleague\s(?:night|nights|nite|nites|day|days)\s/;
const D_EVERY = [['every', 'day', 'of', 'the', 'week'], ['every', 'single', 'day'], ['7', 'days', 'a', 'week'], ['seven', 'days', 'a', 'week'], ['every', 'day'], ['each', 'day'],
  ['every', 'night'], ['each', 'night'], ['every', 'nite'], ['all', 'week', 'long'], ['all', 'week'], ['any', 'day'], ['all', 'days'], ['everyday'], ['daily'], ['nightly']];
const HOLIDAYS_ONE = "thanksgiving|halloween|christmas(?: eve| day)?|xmas(?: eve)?|new year'?s?(?: eve| day)?|nye|memorial day|labou?r day|independence day|(?:the )?(?:4th|fourth) of july|july (?:4th|fourth)|valentine'?s?(?: day)?|st\\.? patrick'?s?(?: day)?|mother'?s day|father'?s day|easter|veterans'? day|presidents'? day|super bowl|black friday|cyber monday";
function daysSaid(words) {
  const s = String(words || '').toLowerCase().replace(/[‘’ʼ]/g, "'");
  // (readings: when the days are not certain, the readings the words still allow - each group said, every day less a day left out, each
  // side of an either-or, the day said after "no" that may be a correction - for the engine to hold the model's own call to)
  const out = { groups: [], left: new Set(), unsure: false, oneOff: null, limit: null, aside: false, every: false, ordinary: new Set(), cut: s, readings: [] };
  const T = dayTokens(s), n = T.length, W = (k) => (k >= 0 && k < n ? T[k] : null), tw = (k) => { const x = W(k); return x ? x.t : ''; };
  const used = new Array(n).fill(false), cutAt = [];
  const isBreak = (x) => !x || (x.k === 'p' && x.t !== '/') || x.k === 'd' || (x.k === 'w' && D_BREAKW.has(x.t));
  // "every day" and its kin (rule 2), and "every other ..." (rule 6)
  const every = [];
  for (let k = 0; k < n; k++) {
    if (tw(k) === 'every' && tw(k + 1) === 'other') out.unsure = true;
    for (const ph of D_EVERY) if (ph.every((w, x) => tw(k + x) === w)) { every.push({ from: k, to: k + ph.length - 1 }); for (let x = 0; x < ph.length; x++) used[x + k] = true; k += ph.length - 1; break; }
  }
  // the day words (rule 5 for the lone "wed", "sat" and "sun")
  const day = T.map((x, k) => (x.k === 'w' && !used[k] ? dayOf(x.t) : null));
  const linked = (k, dir) => { const a = W(k + dir); if (a && day[k + dir]) return true; const b = W(k + 2 * dir); return !!(a && b && day[k + 2 * dir] && (D_JOIN.has(a.t) || a.k === 'j' || a.k === 'd')); };
  for (let k = 0; k < n; k++) {
    const d = day[k]; if (!d || !d.ambiguous) continue;
    const p = W(k - 1), x = W(k + 1);
    const ok = linked(k, 1) || linked(k, -1) || (p && D_QUAL.has(p.t)) || (x && x.k === 'w' && /^\d/.test(x.t)) || (!!p && isBreak(x) && !D_PRON.has(p.t) && !(x && x.t === '('))
      || (x && D_NEXT.has(x.t) && !(p && D_PRON.has(p.t)));
    if (!ok) { day[k] = null; out.ordinary.add(T[k].t); }
  }
  // the runs: days joined by "and", "&", "/", "-", "to", "thru", a comma or a space - each day with its "night" or "mornings"
  const runs = [];
  const tod = (k) => { let e = k; while (W(e + 1) && D_TOD.has(tw(e + 1))) e++; return e; };
  for (let k = 0; k < n; k++) {
    if (!day[k] || used[k]) continue;
    const r = { items: [{ k, d: day[k], end: tod(k) }], joins: [] };
    let cur = r.items[0].end;
    for (;;) {
      const a = W(cur + 1), add = (at, jn) => { r.joins.push(jn); r.items.push({ k: at, d: day[at], end: tod(at) }); cur = r.items[r.items.length - 1].end; };
      if (a && day[cur + 1]) { add(cur + 1, ' '); continue; }
      // (a dash with spaces round it joins two single days - "mon - thu" - and is a break anywhere else: "on weekdays - weekend is league")
      const jn = a && (D_JOIN.has(a.t) || a.k === 'j' || a.k === 'd') ? (a.k === 'd' ? '-' : a.t) : null;
      // (a list whose last day came with "and" is closed: a comma after it starts another part when the day after the comma goes on to say
      // something of its own - "mon tue wed and fri, thursday is league" is Monday, Tuesday, Wednesday and Friday, and Thursday is said about
      // something else. It was one list, Monday to Friday, and Thursday went up over the model's right days - Oct 28 2026, round 2f. A list
      // that goes on - "tues and thurs, sat and sun", "tue and thu, sat", "..., sat 2 to 5" - is still one)
      if (jn === ',' && day[cur + 2] && r.joins.some(j => /^(?:and|&|n|plus|or)$/.test(j))) {
        const y = W(tod(cur + 2) + 1);
        if (!(!y || y.k !== 'w' || D_JOIN.has(y.t) || day[tod(cur + 2) + 1] || /^[\d$]/.test(y.t) || D_CLOSE.has(y.t))) break;
      }
      if (jn && day[cur + 2] && !(a.k === 'd' && (r.items[r.items.length - 1].d.keys.length > 1 || day[cur + 2].keys.length > 1))) { add(cur + 2, jn); continue; }
      if (jn === ',' && /^(?:and|&|or|n|plus)$/.test(tw(cur + 2)) && day[cur + 3]) { add(cur + 3, tw(cur + 2)); continue; }
      break;
    }
    r.from = k; r.to = cur;
    for (let x = r.from; x <= r.to; x++) used[x] = true;
    k = r.to;
    // (rule 1: a list joined only by commas or spaces is one list only where it ends)
    if (r.items.length > 1 && r.joins.every(j => j === ' ' || j === ',')) {
      const y = W(r.to + 1), y2 = W(r.to + 2);
      const closed = !y || (y.k === 'p' && y.t !== ',' && y.t !== '(') || y.k === 'd' || (y.k === 'w' && (/^[\d$]/.test(y.t) || D_CLOSE.has(y.t)))
        || (y.t === ',' && (!y2 || /^[\d$]/.test(y2.t) || D_CLOSE.has(y2.t)));
      if (!closed) { for (const it of r.items) runs.push({ items: [it], joins: [], from: it.k, to: it.end }); continue; }
    }
    runs.push(r);
  }
  const keysOf = (r) => {
    const ks = new Set();
    r.items.forEach((it, x) => {
      it.d.keys.forEach(d => ks.add(d));
      if (x > 0 && D_RANGE.has(r.joins[x - 1]) && it.d.keys.length === 1 && r.items[x - 1].d.keys.length === 1) {
        let a = WEEK7.indexOf(r.items[x - 1].d.keys[0]); const b = WEEK7.indexOf(it.d.keys[0]);
        for (let g = 0; g < 7 && a !== b; g++) { a = (a + 1) % 7; ks.add(WEEK7[a]); }
      }
    });
    return WEEK7.filter(d => ks.has(d));
  };
  // the label before ":" at the start ("taco tuesday:", "weekend rate:") - its days are a name's
  const colon = T.findIndex(x => x.t === ':'), label = colon > 0 && colon <= 5 && T.slice(0, colon).every(x => x.k === 'w') && T[colon].i <= 30 ? colon : -1;
  const moves = /\b(?:mov\w*|switch\w*|chang\w*|swap\w*|shift\w*|push\w*|bump\w*|instead)\b/.test(s);
  // (what may follow a day left out: the end, a stop, a small word, a time, or a standing "from now on" / "going forward")
  // (and the reason said straight after it - "skip thursday we do league", "but not thursday we have league", "no thursday since we host league",
  // "not fridays they are packed": the day was set aside as said about something else and its "not" lost - the model's Thursday went up, or its
  // right Monday, Tuesday, Wednesday and Friday was handed back. Oct 28 2026, round 2g)
  const clean = (k) => { const y = W(k); return !y || isBreak(y) || (y.k === 'w' && (D_CLEAN.has(y.t) || /^\d/.test(y.t) || /^(?:we|we're|were|they|they're|since|because|cause|cuz|bc|as|thats|that's|its|it's|there's|theres)$/.test(y.t)))
    || /^\s*(?:from now on|from here on|going forward|moving forward|every week|each week|for good|permanently|starting (?:today|now|tonight)|as of (?:today|now)|until further notice)\b/.test(s.slice(y.i))
    // ("keep fridays out of it", "leave weekends out of that" - Oct 28 2026)
    || /^\s*of (?:it|that|this|them|those)\b/.test(s.slice(y.i)); };
  // the part of the words a day stands in (between breaks), with the day put as "<d>" - for what it is said about (rule 3, below)
  const clauseOf = (from, to) => { let a = from - 1; while (a >= 0 && !isBreak(T[a])) a--; let b = to + 1; while (b < n && !isBreak(T[b])) b++;
    return { a, b, text: ' ' + T.slice(a + 1, from).map(x => x.t).concat(['<d>'], T.slice(to + 1, b).map(x => x.t)).join(' ') + ' ' }; };
  const explicit = [], names = [], noLeads = [], aboutOut = new Set(), aboutElse = new Set();
  for (const r of runs) {
    const one = r.items.length === 1 ? r.items[0] : null, hasTod = r.items.some(it => it.end > it.k), p = W(r.from - 1), p2 = W(r.from - 2), nx = W(r.to + 1);
    const ks = keysOf(r), range = r.joins.some(j => D_RANGE.has(j));
    // (a move - "from tuesdays to thursdays" - or a run of plurals by "to", which may be one: rule 6)
    if (range && (moves || (r.joins.some(j => /^(?:to|till|til|until)$/.test(j)) && r.items.some(it => it.d.plural)))) { out.unsure = true; out.readings.push(ks, ...r.items.map(it => it.d.keys)); continue; }
    // a day left out, the lead before it (rule 4) - looked for first: "aside from the weekend" is the weekend left out, never a start
    let lead = null, at = r.from - 1;
    for (let g = 0; g < 5 && at >= 0; g++, at--) {
      const t1 = tw(at), t2 = tw(at - 1) + ' ' + t1;
      if (D_LEAD2.has(t2)) { lead = { t: t2, k: at - 1 }; break; }
      if (t1 === 'but' && every.some(e => e.to === at - 1)) { lead = { t: 'but', k: at }; break; }
      if (D_LEAD1.has(t1)) { lead = { t: t1, k: at }; break; }
      if (!D_FILL.has(t1)) break;
    }
    // A DAY TAKEN OUT (Oct 28 2026, round 2e - the review of round 2d: "remove fridays from happy hour", "drop sundays from happy hour", "take
    // happy hour off weekends", "pull happy hour off saturdays", "get rid of happy hour on weekends" each put up ONLY the day taken out, over the
    // model's right days left - a removal verb was no lead of a day left out). A removal verb right before the day ("remove fridays", "drop
    // sundays"), "off <day>" after take / pull / knock / get ("take happy hour off weekends" - never "$2 off weekends", a deal on them), and "on
    // <day>" after "get rid of", remove or delete: the day is left out, with "from <the thing>" after it as plain as the end
    let removal = false;
    if (!lead) {
      const clause = clauseOf(r.from, r.to).text, before = clause.slice(0, clause.indexOf(' <d> '));
      if (p && /^(?:remove|removes|removed|removing|drop|drops|dropped|dropping|pull|pulls|pulled|pulling|delete|deletes|deleted|deleting|cut|cuts|cutting|scratch|nix|scrap)$/.test(p.t)) removal = true;
      else if (p && p.t === 'off' && !(p2 && (/^[\d$]/.test(p2.t) || /^(?:dollars?|bucks?|cents?|%|percent|half)$/.test(p2.t))) && /\b(?:take|takes|taking|took|pull|pulls|pulled|pulling|knock|knocks|knocked|get|gets|got)\b/.test(before)) removal = true;
      else if (p && /^(?:on|for)$/.test(p.t) && /\bget rid of\b|\brid of\b|\b(?:remove|removing|delete|deleting|scrap)\b/.test(before)) removal = true;
      if (removal) lead = { t: 'remove', k: r.from - 1 };
    }
    if (lead) {
      // ("not friday night" may leave Friday out or only its night; in "no weekend upcharge" the day names the upcharge, no day of the thing)
      if (hasTod || !(clean(r.to + 1) || (removal && /^(?:from|out|in)$/.test(tw(r.to + 1))))) { out.unsure = true; if (hasTod) out.readings.push(WEEK7.filter(d => !ks.includes(d)), WEEK7.slice()); continue; }
      ks.forEach(d => out.left.add(d)); for (let x = lead.k; x <= r.to; x++) used[x] = true; cutAt.push([T[lead.k].i, T[r.to].j]);
      if (lead.t === 'no') noLeads.push(ks);
      continue;
    }
    // a start or an end (rule 3)
    const pp = p && /^(?:on|the|this|next)$/.test(p.t) ? p2 : p;
    if (!range && ((pp && D_LIMIT.has(pp.t)) || (p && p.t === 'of' && p2 && p2.t === 'as'))) { out.limit = out.limit || s.slice((pp || p).i, T[r.to].j).trim(); out.aside = true; continue; }
    // ("the wednesday before thanksgiving", "the friday after thanksgiving", "the saturday before christmas" are one day - the weekday with the
    // holiday or the date after it; they went up as every Wednesday, every Friday: Oct 28 2026, round 2g)
    if (one && !one.d.plural && nx && /^(?:before|after)$/.test(nx.t) && new RegExp(`^\\s+(?:the\\s+)?(?:${HOLIDAYS_ONE}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\d{1,2}(?:st|nd|rd|th)\\b)`).test(s.slice(nx.j))) {
      out.oneOff = out.oneOff || s.slice((p && /^(?:the|on)$/.test(p.t) ? p : T[r.from]).i, nx.j).trim() + s.slice(nx.j).match(/^\s+\S+(?:\s+(?:day|eve|of july|\d{1,2}(?:st|nd|rd|th)?))?/)[0]; out.aside = true; continue;
    }
    // one time (rule 6)
    if ((p && /^(?:this|next|coming|upcoming)$/.test(p.t)) || (one && one.d.full && !one.d.plural && p && (D_HOLIDAY.has(p.t) || (p.t === 'bowl' && p2 && p2.t === 'super') || (p.t === 'business' && p2 && p2.t === 'small')))) {
      out.oneOff = out.oneOff || s.slice(p.i, T[r.to].j).trim(); out.aside = true; continue;
    }
    // past, or naming a thing (rule 3)
    if (p && /^(?:last|past|yesterday)$/.test(p.t)) { out.aside = true; continue; }
    if (one && !one.d.plural && p && /^(?:the|our|that|those|your|my|their)$/.test(p.t) && nx && nx.k === 'w' && !D_FN.has(nx.t) && !/^\d/.test(nx.t)) { out.aside = true; continue; }
    // ...or the words after it (rule 4)
    {
      let e = r.to + 1; if (/^(?:is|are|r|'s|be|all)$/.test(tw(e))) e++;
      const t1 = tw(e), t2 = tw(e + 1);
      // ("turn / switch / shut the bogo on mondays off" is the thing turned off - never Monday left out: the stop guard must still see it)
      // (Oct 28 2026, round 2e: only a switch is a thing turned off - "take fridays off", "leave fridays out", "keep fridays out of it" are each a
      // day LEFT OUT, and setting them aside put Friday back over the model's right Monday to Thursday)
      const offVerb = /^(?:off|out)$/.test(t1) && T.slice(0, r.from).some(x => /^(?:turn\w*|switch\w*|shut\w*|flip\w*|power\w*)$/.test(x.t));
      if (offVerb) { out.aside = true; continue; }
      const trail = D_TRAIL_OFF.has(t1) ? e : (t1 === 'left' && t2 === 'out') || (/^(?:not|arent|aren't|isnt|isn't)$/.test(t1) && D_TRAIL_NOT.has(t2)) || (/^(?:dont|don't|doesnt|doesn't|wont|won't|cant|can't)$/.test(t1) && D_TRAIL_VERB.has(t2)) ? e + 1
        : (/^(?:do|does)$/.test(t1) && t2 === 'not' && D_TRAIL_VERB.has(tw(e + 2))) ? e + 2 : -1;
      if (trail >= 0) {
        // ("fridays out of happy hour": the thing it is left out of, as plain as the end - Oct 28 2026)
        if (hasTod || !(clean(trail + 1) || (tw(trail) === 'out' && tw(trail + 1) === 'of'))) { out.unsure = true; if (hasTod) out.readings.push(WEEK7.filter(d => !ks.includes(d)), WEEK7.slice()); continue; }
        ks.forEach(d => out.left.add(d)); for (let x = r.from; x <= trail; x++) used[x] = true; cutAt.push([T[r.from].i, T[trail].j]); continue;
      }
    }
    // A DAY SAID ABOUT SOMETHING ELSE (rule 3; Oct 28 2026, round 2e - the review of round 2d: "happy hour 2 to 5 at $15 a half hour, closed on
    // mondays" put up a Monday window over the model's right Tuesday to Sunday; "lets do buy an hour get an hour, saturdays are always full" a
    // Saturday deal; "..., but weekends stay regular price" a weekend happy hour - the exact opposite; "sundays we open at noon" a Sunday window by
    // the box alone). A day the words say how it IS - closed, busy, full, packed, regular or full price, the same, left alone, separate, blacked
    // out - or what else happens on it - a league, a tournament, the hours we open or close, what another place does ("like the bar next door
    // does on thursdays") - is none of the thing's days. It is set aside; and where it falls inside days said outright ("every day ..., closed
    // mondays"), those days are no longer certain - with it or without it, both readings stand
    // (only in a clause after the request's own - "..., closed on mondays", "... but weekends stay regular price": a message that is all
    // about the hours - "close early sat at 8", "sundays we open at noon" - is about that day itself; "like ... do on <day>" anywhere)
    { const { text: cl, a: clA } = clauseOf(r.from, r.to), later = clA >= 0;
      const OUT = '(?:separate|different|blacked out|black ?out|regular|normal|standard|usual|the same|same|full price)';
      // (said to be left as they are, or shut: the thing is not on them - the days left are the reading)
      const MONEYW = /[$%]|\b\d+\s*(?:off|cents?|dollars?|bucks?)\b/, hit = (re) => { const m = re.exec(cl); return !!m && !MONEYW.test(cl.slice(m.index)); };
      const outSaid = [
        new RegExp(`<d> (?:(?:is|are|r|re|were|was|stay|stays|staying|remain|remains|go|goes|always|already|still|just|all|at|on|the|a)\\s)*${OUT}\\b`),
        /\b(?:blackout|black out|blacked out)\s(?:(?:all|day|days|on|the|every)\s)*<d>/,
        /\b(?:regular|full|normal|standard|usual)\s(?:price|prices|pricing|rate|rates)\s(?:(?:on|for|all|the|every)\s)*<d>/,
        /\b(?:keep|keeps|leave|leaves)\s(?:the\s)?<d>\s(?:the same|same|alone|as is|as they are|regular|normal)\b/,
      ].some(hit);
      // (said about what else happens on them - busy, a league, the hours, another place's deal: no reading of the thing's days at all)
      // (closed that day: the thing cannot run then anyway - every day, or every day but that one, are both readings)
      const elseHit = !outSaid && [
        new RegExp(`<d> (?:(?:is|are|r|re|were|was|always|already|usually|still|just|all|on)\\s)*(?:closed|shut)\\b`),
        /\b(?:closed|shut)\s(?:(?:all|day|days|on|the|every)\s)*<d>/,
        /<d>\s(?:we|we're|were|they|they're)\s(?:(?:are|r|re|usually|always|normally)\s)*(?:closed|shut)\b/,
        new RegExp(`<d> (?:(?:is|are|r|re|were|was|get|gets|always|already|usually|pretty|so|too|really|super|way|kinda|still|just|all)\\s)*(?:busy|full|packed|slammed|booked|dead|slow|crazy|nuts)\\b`),
        /\b(?:close|closes|closing|open|opens|opening)\s(?:at\s\S+|late|early|later|earlier)\s(?:(?:on|every)\s)?<d>/,
        /<d>\s(?:we|we're|were|they|they're|i|i'm|im)\s(?:(?:are|r|re|usually|always|normally)\s)*(?:close|closing|open|opening|busy|full|packed|slammed)\b/,
        LIKE_ELSE,
      ].some(hit);
      // A LEAGUE'S DAY (Oct 28 2026, round 2f - the critic of round 2e: "$2 off drafts on league nights, we do league on tuesdays 6 to 9" set the
      // Tuesday aside and the model's right Tuesday was handed back; "happy hour ... mon tue wed and fri, thursday is league" put Thursday up). A
      // day said to be the league's is none of the thing's days - unless the thing itself is said for the league ("on league nights", "during
      // league", "league night special"): then the league's day IS its day
      const leagueRes = [
        /<d>\s(?:we|we're|were|they|they're|i|i'm|im)\s(?:(?:are|r|re|have|do|got|usually|always|normally)\s)*(?:doing|having|have|got|run|running|host|hosting|playing|do|play)\s(?:(?:a|the|our)\s)?(?:league|leagues|tournament|tournaments|trivia)\b/,
        /\b(?:we|they|i)\s(?:(?:do|have|run|host|got|play|usually|always)\s)+(?:(?:a|the|our)\s)?(?:league|leagues|tournament|tournaments|trivia)\s(?:(?:on|every)\s)?<d>/,
        /\b(?:the\s)?(?:league|leagues|tournament)\s(?:takes|has|plays|is on|are on|runs on|gets)\s(?:the\s)?<d>/,
        /<d>\s(?:is|are|r|re|=)\s(?:(?:our|the|a|always|usually|for|just|all)\s)*(?:league|leagues|tournament|tournaments|trivia)\b/];
      const leagueSaid = !outSaid && leagueRes.some(hit);
      // ("except during league", "not on league nights" are no deal for the league)
      const forLeague = leagueSaid && LEAGUE_THING.test((' ' + T.slice(0, clA + 1).concat(T.slice(clauseOf(r.from, r.to).b)).map(x => x.t).join(' ') + ' ')
        .replace(/\b(?:except|excluding|but|not|no|never|outside|besides|without|minus|skip|skipping)\s(?:\S+\s){0,3}?leagues?(?:\s(?:night|nights|nite|nites|day|days))?\b/g, ' '));
      const elseSaid = !outSaid && !forLeague && (elseHit || leagueSaid);
      // ("I'd like you to do happy hour on fridays", "feel like doing happy hour on tuesdays" ask for it - never another place's day: Oct 28 2026)
      const likeSaid = LIKE_ELSE.test(cl);
      if ((later && (outSaid || elseSaid)) || likeSaid) { ks.forEach(d => (outSaid && later ? aboutOut : aboutElse).add(d)); out.aside = true; continue; } }
    // an either-or (rule 6)
    if (r.joins.includes('or')) { out.unsure = true; out.readings.push(ks, ...r.items.map(it => it.d.keys)); continue; }
    // "<day> only", singular: may be this one (rule 6)
    if (one && one.d.full && !one.d.plural && nx && nx.t === 'only') { out.unsure = true; out.readings.push(ks); continue; }
    // a name's day: in a label, or a singular day before a word that is no small word (rule 3)
    const name = (label >= 0 && r.to < label) || (one && one.d.full && !one.d.plural && !(p && /^(?:on|every|each)$/.test(p.t)) && nx && nx.k === 'w' && !D_FN.has(nx.t) && !/^[\d$]/.test(nx.t) && !dayOf(nx.t));
    // (days said as more of the same - "weekends too", "also on thursdays", "plus saturdays" - join the days said before them: rule 1)
    const more = !name && ((nx && (nx.t === 'too' || (nx.t === 'as' && tw(r.to + 2) === 'well'))) || [p, p2].some(x => x && /^(?:also|plus)$/.test(x.t)));
    (name ? names : explicit).push({ r, ks, more });
  }
  for (const e of every) explicit.push({ r: { from: e.from, to: e.to }, ks: WEEK7.slice(), every: true });
  const weeklyRun = explicit.some(g => !g.every && g.r.items && (g.r.items.some(it => it.d.plural) || /^(?:every|each)$/.test(tw(g.r.from - 1))));
  // one time said without a day - tonight, today, tomorrow, this week (rule 6); "starting today" is every week from today, "starting
  // tomorrow" a start
  for (let k = 0; k < n; k++) {
    const t = tw(k), wk = /^(?:this|next)$/.test(t) && /^(?:week|month)$/.test(tw(k + 1));
    if (!/^(?:tonight|tonite|today|tomorrow|tmrw|tmrow|tomorow)$/.test(t) && !wk) continue;
    const p = tw(k - 1);
    if (D_LIMIT.has(p) || (p === 'of' && tw(k - 2) === 'as')) { if (!/^(?:today|tonight|tonite)$/.test(t)) { out.limit = out.limit || p + ' ' + t; out.aside = true; } continue; }
    out.oneOff = out.oneOff || (wk ? t + ' ' + tw(k + 1) : t);
  }
  // A HOLIDAY OR A DATE IS ONE TIME (rule 6; Oct 28 2026, round 2e - the critic of round 2d: "happy hour on thanksgiving 2 to 5 at $15 a half
  // hour" went up as a window every Thursday, "bud light $2 off on halloween 5 to 9" every Saturday, "happy hour on nov 8" every Sunday, "bud
  // light $2 off on the 31st" every Saturday - a model maps the day to its weekday, and the window holds no date). Thanksgiving, Halloween,
  // Christmas, New Year's, Memorial Day and the rest, a month and its day ("nov 8"), "the 31st", "11/8", a date in full - one time, never
  // every week (an ordinal that counts something - "her 40th birthday", "the 2nd hour" - is no date)
  // A RUN'S START OR END, A FRACTION, ALWAYS (Oct 28 2026, round 2f - the review of round 2e: "1/2 off smash burger friday 5 to 9", "$15 per 1/2
  // hour", "24/7", "starting nov 1", "starting the 1st", "until christmas", "through new years", "until dec 31" were each one time, and the model's
  // right weekly or every-day call was handed back with "every week or only that once?" - the wrong question for a run until Christmas). A date
  // after "starting", "until", "through", "from", "as of" ... is where a run starts or ends - a limit, as "every day starting tues" is (rule 3),
  // never one time ("the day after thanksgiving" is still one day); "1/2", "1/3", "1/4", "2/3" and "3/4" are a fraction unless said as a date
  // ("on 1/2", "this 1/2"); a month past 12 or a day past 31 ("24/7") is no date at all
  if (!out.oneOff) {
    const DATE_RES = [/\b(?:thanksgiving|halloween|christmas(?: eve| day)?|xmas(?: eve)?|new year'?s?(?: eve| day)?|nye|memorial day|labou?r day|independence day|(?:the )?(?:4th|fourth) of july|july (?:4th|fourth)|valentine'?s?(?: day)?|st\.? patrick'?s?(?: day)?|st\.? patty'?s?(?: day)?|mother'?s day|father'?s day|easter(?: sunday)?|good friday|cinco de mayo|veterans'? day|presidents'? day|mlk day|super bowl(?: sunday)?|black friday|cyber monday)\b/g,
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\s*(?:%|percent|off|dollars?|bucks?|hours?|minutes?))/g,
      /\b(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b(?!\s*(?:hours?|minutes?|time|times|visits?|bookings?|games?|rounds?|holes?|players?|persons?|guests?|birthday|bday|anniversary|annual|place|floor|bays?|one|person|year|week|month|day|night|session|drink|beer|round|free|half|off|item|items|wing|wings)\b)/g,
      /(?<![\d:$.\/])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\d\/])|\b\d{4}-\d{2}-\d{2}\b/g];
    const found = [];
    DATE_RES.forEach((re, x) => { for (const m of s.matchAll(re)) found.push({ i: m.index, t: m[0].trim(), slash: x === 3 }); });
    for (const f of found.sort((a, b) => a.i - b.i)) {
      const pre = s.slice(0, f.i).replace(/\s+$/, ''), pw = pre.split(/[\s,;:]+/).filter(Boolean);
      if (f.slash && !/-/.test(f.t)) {
        const [mo, dd, yr] = f.t.split('/').map(Number);
        if (!(mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31)) continue;
        if (yr === undefined && /^(?:1\/2|1\/3|1\/4|2\/3|3\/4)$/.test(f.t) && !/^(?:on|this|next)$/.test(pw[pw.length - 1] || '')) continue;
      }
      let p = pw[pw.length - 1] || ''; if (/^(?:on|the|this|next)$/.test(p)) p = pw[pw.length - 2] || '';
      // (the end of a run whose start was said just before it - "from halloween to thanksgiving", "between christmas and new years")
      const runEnd = /^(?:to|and|-|–|—)$/.test(p) && found.some(g => g.edge && g.i < f.i && /^[\s,]*(?:to|and|-|–|—)[\s,]*(?:(?:on|the)\s+)?$/.test(s.slice(g.i + g.t.length, f.i)));
      const runEdge = runEnd || D_LIMIT.has(p) || p === 'between' || /^(?:ending|ends|end|thru|til)$/.test(p) || /\bas of$/.test(pre);
      if (runEdge && !/\b(?:day|night|eve|evening|morning|week|weekend|(?:mon|tues|wednes|thurs|fri|satur|sun)day|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\s+(?:after|before)$/.test(pre)) { f.edge = true; out.limit = out.limit || (p + ' ' + f.t); out.aside = true; continue; }
      out.oneOff = f.t; break;
    }
  }
  // (every week said: a plural day, "every <day>", every day - unless it is "every day this week" - or "weekly", "from now on")
  out.weekly = /\b(?:weekly|every week|each week|from now on|from here on|going forward|moving forward|for good|permanently|until further notice)\b/.test(s);
  // a negative beside a day that rule 4 did not take
  const clauseNeg = (from, to) => {
    let a = from - 1; while (a >= 0 && !isBreak(T[a])) a--;
    let b = to + 1; while (b < n && !isBreak(T[b])) b++;
    for (let x = a + 1; x < b; x++) if ((x < from || x > to) && !used[x] && D_NEG.has(T[x].t)) return true;
    return false;
  };
  for (const g of explicit.concat(names)) if (clauseNeg(g.r.from, g.r.to)) out.unsure = true;
  // a correction between two days said outright (rule 6)
  const xs = explicit.filter(g => !g.every).sort((a, b) => a.r.from - b.r.from);
  for (let x = 1; x < xs.length; x++) for (let y = xs[x - 1].r.to + 1; y < xs[x].r.from; y++) if (D_CORRECT.has(tw(y)) || (tw(y) === 'make' && tw(y + 1) === 'that')) out.unsure = true;
  // "no X" after days that never named X may be a correction (rule 4) - not when those days were said with "only", or X is all the rest
  // of the week ("mon thru fri only, no weekends", "weekdays, no weekends")
  const named = new Set([].concat(...explicit.map(g => g.ks))), only = explicit.some(g => !g.every && tw(g.r.to + 1) === 'only');
  const fix = named.size && !only && noLeads.some(ks => ks.some(d => !named.has(d)) && WEEK7.some(d => !named.has(d) && !ks.includes(d)));
  if (fix) out.unsure = true;
  // ("weekdays ... - weekends too" is one group of both)
  if (explicit.some(g => g.more) && explicit.length > 1) { const u = WEEK7.filter(d => explicit.some(g => g.ks.includes(d))); explicit.splice(0, explicit.length, { r: explicit[0].r, ks: u }); }
  // a name's day gives way to days said outright that hold it (rule 3)
  out.groups = explicit.map(g => g.ks).concat(names.filter(g => !explicit.some(e => g.ks.every(d => e.ks.includes(d)))).map(g => g.ks));
  out.every = every.length > 0;
  out.weekly = out.weekly || weeklyRun || (out.every && !/^(?:this|next) (?:week|month)$/.test(out.oneOff || ''));
  const less = (g) => g.filter(d => !out.left.has(d));
  // (a day said about something else - rule 3, above - leaves no certain reading: the days said outright, or every day, with it left out
  // where it was said to stay as it is or shut; and as they are too where it was only said what else happens on it. Never that day alone -
  // Oct 28 2026)
  const aboutRd = [];
  if (aboutOut.size || aboutElse.size) {
    out.unsure = true;
    const base = out.groups.length ? out.groups.map(less) : [less(WEEK7)];
    for (const g of base) { aboutRd.push(g.filter(d => !aboutOut.has(d) && !aboutElse.has(d))); if (!aboutOut.size || aboutElse.size) aboutRd.push(g.filter(d => !aboutOut.has(d))); }
  }
  out.about = { out: [...aboutOut], else: [...aboutElse] };
  out.readings = out.readings.concat(aboutRd.length ? aboutRd : out.groups.map(less), !aboutRd.length && out.left.size ? [less(WEEK7)] : [], fix ? [WEEK7.filter(d => out.left.has(d))] : [])
    .filter(g => g.length).map(g => WEEK7.filter(d => g.includes(d))).filter((g, i, a) => a.findIndex(x => x.join() === g.join()) === i);
  if (cutAt.length) { let c = s; for (const [a, b] of cutAt.sort((x, y) => y[0] - x[0])) c = c.slice(0, a) + ' '.repeat(b - a) + c.slice(b); out.cut = c; }
  return out;
}
// A RUN'S FIRST OR LAST DAY, AS SAID (Oct 28 2026, round 2g - the reviewer and the critic of round 2f: "starting nov 1", "starting monday",
// "starting next week", "until christmas", "through the end of the year", "for the month of november" went nowhere - a deal the model sent with no
// first_day went live the day it was approved, a window "starting monday" went live at the Yes today, a special "until christmas" never ended,
// and the card said nothing of the date the owner gave). What the words say of where a run starts or ends: { said: the owner's words for each,
// first / last: the day each names ('YYYY-MM-DD'), when it is plain - a month and its day, "the 1st", a holiday, the coming weekday, tomorrow,
// next month, the end of the month or the year, a month said whole; open: true when a start or an end was said that names no plain day
// ("starting next week", "until friday" said on a Friday) }. A time's end ("5 until 9"), a run of days ("monday through friday", "from monday
// to friday") and "starting today" are none of it
const RUN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function runLimit(words, today) {
  const s = ' ' + String(words || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ') + ' ';
  const out = { said: [], first: null, last: null, open: false };
  const T = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? String(today) : null, ty = T ? Number(T.slice(0, 4)) : null;
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const lastOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const nextMd = (m, d) => { if (!T || d < 1 || d > lastOf(ty, m)) return null; const v = iso(ty, m, d); return v >= T ? v : iso(ty + 1, m, d); };
  const tg = (y) => { const d1 = new Date(Date.UTC(y, 10, 1)).getUTCDay(); return iso(y, 11, 1 + ((4 - d1 + 7) % 7) + 21); };
  const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?', MONC = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const HOL = "christmas eve|xmas eve|christmas(?: day)?|xmas|new year'?s eve|nye|new year'?s(?: day)?|new years?|halloween|thanksgiving|valentine'?s(?: day)?|(?:the )?(?:4th|fourth) of july|july (?:4th|fourth)|independence day";
  const WD = '(?:mon|tues|wednes|thurs|fri|satur|sun)day', WDC = '(mon|tues|wednes|thurs|fri|satur|sun)day';
  // (the day a phrase names: [value, plain]; plain false when it names a time that is not one day for certain)
  const dayOfP = (x, end) => {
    let m;
    if ((m = new RegExp('^' + MONC + '\\s+(\\d{1,2})(?:st|nd|rd|th)?$').exec(x))) { const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3)) + 1; return nextMd(mo, Number(m[2])); }
    if ((m = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)$/.exec(x)) && T) { const d = Number(m[1]), mo = Number(T.slice(5, 7)); if (d < 1 || d > 31) return null; let v = d <= lastOf(ty, mo) ? iso(ty, mo, d) : null; if (!v || v < T) { const nm = mo === 12 ? 1 : mo + 1, ny = mo === 12 ? ty + 1 : ty; v = d <= lastOf(ny, nm) ? iso(ny, nm, d) : null; } return v; }
    if (/^(?:christmas eve|xmas eve)$/.test(x)) return nextMd(12, 24);
    if (/^(?:christmas(?: day)?|xmas)$/.test(x)) return nextMd(12, 25);
    if (/^(?:new year'?s eve|nye)$/.test(x)) return nextMd(12, 31);
    if (/^new years?|^new year'?s/.test(x)) return nextMd(1, 1);
    if (x === 'halloween') return nextMd(10, 31);
    if (/^valentine/.test(x)) return nextMd(2, 14);
    if (/july|independence/.test(x)) return nextMd(7, 4);
    if (x === 'thanksgiving' && T) { const v = tg(ty); return v >= T ? v : tg(ty + 1); }
    if (x === 'tomorrow' && T) return addDays(T, 1);
    if (x === 'next month' && T) { const mo = Number(T.slice(5, 7)), nm = mo === 12 ? 1 : mo + 1, ny = mo === 12 ? ty + 1 : ty; return end ? iso(ny, nm, lastOf(ny, nm)) : iso(ny, nm, 1); }
    if (/^(?:the )?end of (?:the )?year$/.test(x) && T) return iso(ty, 12, 31);
    if (/^(?:the )?end of (?:the )?month$/.test(x) && T) { const mo = Number(T.slice(5, 7)); return iso(ty, mo, lastOf(ty, mo)); }
    if ((m = new RegExp('^' + WDC + '$').exec(x)) && T) { const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3)), now = new Date(T + 'T12:00:00Z').getUTCDay(); if (want === now) return null; return addDays(T, (want - now + 7) % 7); }
    return null;
  };
  const DAYP = `(${MON}\\s+\\d{1,2}(?:st|nd|rd|th)?|(?:the )?\\d{1,2}(?:st|nd|rd|th)|${HOL}|tomorrow|next week|next month|(?:the )?end of (?:the )?(?:year|month)|${WD})`;
  const isWd = (x) => new RegExp('^' + WD + '$').test(x);
  const take = (re, edge) => { for (const m of s.matchAll(re)) {
    const phrase = m[0].trim(), x = m[1].trim(), rest = s.slice(m.index + m[0].length);
    // ("monday through friday", "from monday to friday" are days, never a run's edge)
    if (isWd(x) && (edge === 'last' ? !/^(?:until|untill|till|til|ending|ends|up until)\b/.test(phrase) : /^\s*(?:-|to|thru|through|till|til|until|and|&)\s/.test(rest))) continue;
    if (isWd(x) && edge === 'first' && /^from\b/.test(phrase)) continue;
    const v = dayOfP(x.replace(/^(\d{1,2}(?:st|nd|rd|th))$/, 'the $1'), edge === 'last');
    out.said.push(phrase);
    if (v) out[edge] = out[edge] || v; else out.open = true;
  } };
  // (a run's start: "starting nov 1", "beginning monday", "as of the 1st", "from nov 1" - never "from monday to friday", "starting today")
  take(new RegExp(`\\b(?:starting|starts|start|beginning|begins|begin|effective|kicking off|kicks off|as of|from|between)\\s+(?:on\\s+|this\\s+)?${DAYP}(?![\\w-])`, 'g'), 'first');
  // (a run's end: "until christmas", "through the end of the year", "till new years", "ending nov 30", and the end of "from nov 1 to nov 30",
  // "between christmas and new years")
  take(new RegExp(`\\b(?:until|untill|till|til|through|thru|ending|ends|up until|up to)\\s+(?:on\\s+)?${DAYP}(?![\\w-])`, 'g'), 'last');
  take(new RegExp(`\\b(?:from|between|starting|beginning|as of)\\s+(?:on\\s+|this\\s+)?(?:${MON}\\s+\\d{1,2}(?:st|nd|rd|th)?|(?:the )?\\d{1,2}(?:st|nd|rd|th)|${HOL})\\s*(?:-|\\u2013|to|and|&)\\s*${DAYP}(?![\\w-])`, 'g'), 'last');
  // (a month said whole: "for the month of november", "all of december", "during december")
  // ("THROUGH NOVEMBER" IS ITS END, NEVER ITS START - Oct 28 2026, round 2h, the reviewer of round 2g: "through" and "thru" were read as "for the
  // month of", so "... get the last 30 minutes free through november" put Nov 1 on the deal as its first day over the model's right today - the
  // deal never ran for the rest of October. Said with "through" / "thru" the month is where the run ends: its last day only, the first left as
  // the model has it; "throughout november" and "during november" are still the month whole)
  for (const m of s.matchAll(new RegExp(`\\b(?:for the month of|the month of|month of|for all of|all of|all|throughout|during|through|thru|for)\\s+(?:the month of\\s+)?(${RUN_MONTHS.join('|')})\\b(?!\\s*\\d)`, 'g'))) {
    if (!T) { out.open = true; out.said.push(m[0].trim()); continue; }
    const mo = RUN_MONTHS.indexOf(m[1]) + 1, y = iso(ty, mo, lastOf(ty, mo)) >= T ? ty : ty + 1, endOnly = /^(?:through|thru)\s/.test(m[0]);
    out.said.push(m[0].trim()); if (!endOnly) out.first = out.first || (iso(y, mo, 1) < T ? T : iso(y, mo, 1)); out.last = out.last || iso(y, mo, lastOf(y, mo));
  }
  if (out.first && out.last && out.last < out.first) out.open = true;
  out.said = [...new Set(out.said)];
  return out;
}
function daysIn(words, once) {
  const r = daysSaid(words);
  if (r.unsure) return null;
  // once: only when the words name ONE group of days ("wings tuesdays and beers fridays" names two - nothing is read); the same days said
  // twice are one ("weekday window: happy hr weekdays 2-5", "Taco Tuesday on tuesdays")
  if (once && new Set(r.groups.map(g => g.join())).size > 1) return null;
  // (one time is never the weekly days: "this weekend" reads no days - rule 6)
  if (!r.groups.length && r.oneOff) return null;
  let days = r.groups.length ? [...new Set([].concat(...r.groups))] : (r.left.size ? WEEK7.slice() : null);
  if (!days) return null;
  if (r.left.size) days = days.filter(d => !r.left.has(d));
  return days.length ? WEEK7.filter(d => days.includes(d)) : null;
}
module.exports = { rangeIn, daysIn, daysSaid, runLimit, moneySaid, moneyIn, ActionError, check, DATE, TIME, WEEKDAYS, DAY_KEYS, normDate, normTime, normDays, dayWords, timeWords, addDays,
  clockOf, clockAtWords, clockHalf, clockWords, clockFits, clockNum, clockMin, clockHm, clockSay, clockClose, CLOCK_ASK,
  staffCode, rosterName, bayIndex, findDevice, findControl, POWER, photoPath, staffedSource, seasonNote };
