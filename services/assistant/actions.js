// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/actions.js - THE ASSISTANT'S HANDS (Oct 19 2026)
//
// maintainer: "it's just adjusting what we already allow them to"; "Hey, do you want to schedule Carl for tonight's evening
// shift ... All with the a I without having to go in and really do any settings." The assistant can do exactly what is
// listed here and nothing else. Every action is a request the owner's own screens already make, to the same route, so
// the same checks apply (owner sign-in, the 2FA step-up, the route's own validation). The model never writes code
// (rule 40), and no action can write waiver or legal text: there is none here (rule 15).
//
//   kind 'read'   the engine runs it itself, through the owner's own route, and gives the model a short digest
//   kind 'write'  the engine never runs it: it becomes a PROPOSAL the owner's page applies with the owner's own session
//                 - straight in when it only changes how things look (confirm: false), said back first and applied
//                 only on the owner's yes when it touches money, doors, hours, staffing or the schedule (confirm: true)
//
// A request is { op: 'http', method, path, body } or { op: 'config', set: [[dot.path, value], ...] } (or 'content', the
// website editor's save; 'secret', a masked box the model never sees; 'pair', the live pairing card). The 'config'
// kind is what the Settings screen does: read the config, change those keys, save it whole through
// POST /api/admin/config (masked secrets stay masked; the route keeps them).
'use strict';

const H = require('./helpers');
const { ActionError, check, DATE, TIME, WEEKDAYS, DAY_KEYS, normDate, normTime, normDays, dayWords, timeWords, addDays, staffCode, rosterName, bayIndex, findDevice, findControl, POWER, photoPath, staffedSource, seasonNote } = H;
// employee scheduling switched off, as read from the facility's settings (a settings read that failed is not taken as off)
// a tier's guests a visit: guests_allowed as the model gave it (1 when allowed with no number), else the number the owner gave
const guestsOf = (a) => a.guests_allowed !== undefined ? (a.guests_allowed ? (a.guests_per_visit || 1) : 0) : Math.max(0, Number(a.guests_per_visit) || 0);
// times of day said outright ("9 to 5", "after 6pm", "mornings") - never "4 free hours a month"
const TIMES_SAID = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}(?::\d{2})?\s*(?:to|-|until|till)\s*\d{1,2}(?::\d{2})?\b|\bmornings?\b|\bafternoons?\b|\bevenings?\b|\bnights?\b|\bnoon\b|\bmidnight\b|\b(?:before|after) \d|\bany ?time\b|\bdaytime\b/i;
const GUESTS_SAID = /\bguests?\b|\bbring\b|\bfriends?\b|\bplus[- ]ones?\b/i;
const schedulingOff = (ctx) => { const c = ctx.opsConfig; return !!c && !c.error && !(c.scheduling && c.scheduling.enabled); };

// WHAT THE OWNER SAID NOT TO DO IS NEVER READ AS THE CHANGE (Oct 25 2026, the adversarial review - maintainer: a wrong change put up is much
// worse than the words handed to the model). The actions' own readers go before the model (engine.js BOX FIRST) and again after a
// round that made nothing, and not one of them looked for a "don't": "don't show events on the website" put Events in the public
// top menu at once, "no more buy an hour get an hour on mondays" and "get rid of the bogo" put up a card to MAKE that deal, "don't
// text door codes 15 minutes before anymore" a card to text them 15 minutes before, "we're not closed on mondays" a card closing
// every Monday. Words that say not to - or to stop, end, cancel, take off or get rid of something - are never read as making it:
// the reader answers nothing and the words go to the model whole. The opposite is never guessed either (a deal switched off, a
// page hidden): that is the model's, or the owner's answer to its question.
//   - at the start of the request, after the owner's own lead-in ("ok so", "please", "we", "can you", "we're going to"): a
//     "don't", "never", "no more", "stop", "end the", "get rid of", "cancel", "remove", "take ... off"
//   - anywhere: "anymore", "no longer", "no more" (not "no more than"), or a "not" on the very thing a reader reads ("we're not
//     closed on mondays", "we aren't doing the bogo")
//   - never: "we don't close until 1 on fridays" (that is the hours said: it closes at 1), "never mind", "don't forget",
//     "drop the price to ...", a "never" later in the words ("a code that never expires"). ("we don't open till 11 on sundays" is
//     the model's: the hours' own fill reads "till 11" as a closing time, and its card said "Open every day, 10 AM - 11 PM")
//   - a reader's own words for when something stops are its own (READ_OWN, below): "stop the codes 30 minutes after",
//     "kill GSPro on Bay 1 after each session"
//   (Oct 27 2026, the review of that fix: the guard was a list of words, and ordinary ways to say stop still put up a card MAKING the
//   thing - "pause / disable / deactivate the buy an hour get an hour on mondays", "turn the bogo off", "put it on hold", "the bogo
//   needs to go", "door codes shouldn't be texted 15 minutes before", "put gift cards on the website - actually no", "kill the routine
//   that closes gspro after each session" - while "take $2 off wings on tuesdays 5 to 9" and "drop wings to $10", plainly prices,
//   were read as nothing. So: the guard reads every part of the request, not only its start ("door codes should quit working 15
//   minutes after, stop texting them" asks two things); a "not", "can't", "shouldn't" anywhere is the model's, except a day or a time
//   left out ("never on weekends") and the few that say no such thing ("never expires", "no more than 4"); words after the request
//   that take it back ("- actually no") take it back; "take $2 off" and "drop wings to $10" are a price, never a removal. And the
//   readers whose card is money, a door, a device or the public site read only a request that STARTS with a word they know - make,
//   add, let's do ... or the thing itself ("wings 50 cents off", "teachers 15% off", "buy an hour get an hour"): one that starts with
//   any other word - pause, nix, retire, or one nobody thought to list - is the model's (READ_HEAD, below). A new way to say stop
//   needs no new word here)
const LEAD_WORDS = String.raw`ok(?:ay)?|so|and|also|actually|hey|please|pls|plz|now|oh|well|um+|uh+|wait|yeah|yes|yep|yup|sure|nah|hmm+|but|then|alright|all right|listen|look|cool|great|nice|perfect|awesome|sweet|thanks|thank you|thx|got it|sounds good|no problem|no worries|never ?mind|nvm`;
const NOT_LEAD = String.raw`^(?:(?:${LEAD_WORDS}|no[,.!]+|nope[,.!]+)[,.!]*\s+)*`;
// (the longer lead-ins first: "i said put events on the website" is "put", never "i"; "we're doing buy an hour get an hour on tuesdays now"
// is "doing", "we're dropping the bogo" "dropping")
const NOT_WHO = String.raw`(?:(?:like i said|i said|go ahead and|(?:i|we)'?d like to|(?:i|we) would like to|(?:i|we) (?:want|need) (?:you|u) to|(?:it'?s )?time to|can you|could you|would you|will you|can we|could we|help me|let'?s|lets|please|we'?re|were|we are|i'?m|im|i am|we|i|you|u)\s+)?(?:(?:really|just|actually|definitely|also|now|(?:are |'re |re |am |'m )?(?:going to|gonna)|(?:want|need|have|got) to|wanna|gotta|will|shall|should|must|'ll|ll)\s+)*`;
const NEG = String.raw`(?:don'?t|dont|do not|doesn'?t|doesnt|does not|didn'?t|didnt|did not|won'?t|wont|will not|wouldn'?t|wouldnt|would not|shouldn'?t|shouldnt|should not|can'?t|cant|cannot|can not|couldn'?t|couldnt|could not|mustn'?t|mustnt|must not|aren'?t|arent|are not|isn'?t|isnt|is not|wasn'?t|wasnt|was not|weren'?t|werent|were not|haven'?t|havent|have not|hasn'?t|hasnt|has not|ain'?t|aint|never|not|no longer|no more|any ?more|nobody|no one|noone)`;
const SAID_NOT_ANY = new RegExp(String.raw`\b${NEG}\b`, 'i');
// what says no such thing, taken out before the guard looks: a day or a time left out, a code that never expires, a limit
const SCOPE = String.raw`(?:on|during|at|in|for|after|before|past|till|til|until|between|over|from|including)\s+(?:the\s+)?(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?|weekdays?|weekends?|holidays?|mornings?|afternoons?|evenings?|nights?|noon|midnight|game ?days?|\d)`;
// (Oct 27 2026: "no sundays", "never weekends" leave days out as "not on sundays" does - helpers.daysIn reads the days left)
const NOT_BENIGN = new RegExp([String.raw`\b(?:never|not|no)\s+${SCOPE}\b`, String.raw`\b(?:never|no)\s+(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days|weekdays|weekends)\b`, String.raw`\b(?:never|not|doesn'?t|don'?t|won'?t|no)\s+expir\w*`,
  String.raw`\b(?:no|not|any)\s+(?:more|less|later|earlier|fewer|longer|sooner)\s+than\b`, String.raw`\bany ?more of\b`, String.raw`\bnot (?:only|just)\b`,
  String.raw`\bdon'?t (?:forget|worry)\b`, String.raw`\bno (?:worries|problem)\b`].join('|'), 'gi');
const NOT_TILL = /\b(?:don'?t|dont|do not|does not|doesn'?t|doesnt|won'?t|wont|not)\s+close\w*\s+(?:till|til|until|untill)\b/gi;
// an amount off is a price ("take $2 off wings", "take 15% off for teachers"), never a thing taken off
const AMOUNT_OFF = String.raw`(?:\$\s?\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:%|percent|pct|cents?|c|dollars?|bucks?)|half|an? (?:dollar|buck|quarter|few (?:dollars|bucks)))\s+off\b`;
const OFF_WORD = String.raw`(?:stop\w*|quit\w*|cease\w*|halt\w*|paus\w*|disabl\w*|deactivat\w*|suspend\w*|discontinu\w*|cancel\w*|revok\w*|void\w*|retir\w*|ax(?:e|es|ed|ing)\b|nix\w*|scrap\w*|ditch\w*|kill\w*|remov\w*|delet\w*|eliminat\w*|undo\w*|revers\w*|hid(?:e|es|ing|den)\b|shutdown\b|get(?:ting)? rid of|got rid of|do(?:ing)? away with|phas\w* out|end(?:s|ed|ing)?\s+(?:the|our|my|that|this|those|these|all|every|it|them)\b|drop(?:s|ped|ping)?\b(?!\s+(?:the\s+|our\s+)?(?:price|rate|cost)s?\b|[^.,;!?]{0,40}?\bto\s+\$?\s?\d)|los(?:e|ing)\s+(?:the|our|that|this|those|these)\b|tak(?:e|es|ing|en)\s+(?!${AMOUNT_OFF}|off\s+(?:\$|\d|half))(?:\S+\s+){0,4}?(?:off|down|away|out)\b|pull\w*\s+(?:\S+\s+){0,4}?(?:off|out|down|from)\b|(?:leav|keep|kept)\w*\s+(?:\S+\s+){0,4}?(?:off|out)\b|get(?:s|ting)?\s+(?:\S+\s+){0,4}?(?:out of|off (?:the|our|my))\b|(?:turn|switch|shut|flip|power)\w*\s+(?:\S+\s+){0,10}?(?:off|down|out)\b(?<!${AMOUNT_OFF})|hold(?:s|ing)? off\b)`;
const HEAD_OFF = new RegExp(String.raw`^(?:no\s+(?=[a-z0-9$])|${OFF_WORD})`, 'i'), OFF_ANY = new RegExp(String.raw`\b${OFF_WORD}`, 'i');
// said of the thing after it: "the bogo needs to go", "the special is over", "we're done with it", "put it on hold", "we used to"
const OFF_SAID = new RegExp([
  String.raw`\b(?:needs?|has|have|had|got|gotta|must|should|ought)\s+(?:to\s+)?(?:go|stop|end|quit|die|be\s+(?:gone|removed|deleted|cancel+ed|stopped|ended|off|taken\s+(?:off|down)|turned\s+off|switched\s+off|shut\s+(?:off|down)|paused|disabled|hidden|pulled|scrapped|dropped|killed|retired))\b`,
  // (never a session, a game or a customer's: "close gspro when the session is over", "when they're done")
  String.raw`(?<!\b(?:they|we|i|you|customers?|players?|people|guests?|someone|everyone|sessions?|games?|bookings?|rounds?)\s?)(?:\bis|\bare|\bwas|\bwere|'s|'re)\s+(?:over|done|finished|ended|gone|off|cancel+ed|discontinued|paused|disabled|dead|history)\b`,
  String.raw`\bdone\s+(?:with|doing|running|offering|having)\b`, String.raw`\bon\s+(?:hold|pause|ice)\b`, String.raw`\bused\s+to\b`, String.raw`\balready\b`,
  String.raw`\b(?:flopped|tanked|bombed|bad idea|didn'?t work|did not work)\b`].join('|'), 'i');
// words after the request that take it back
const TAKEN_BACK = /^(?:actually,?\s+(?:no|not|don'?t|nevermind|never mind|scratch that|forget it|wait)\b|no+\b|nope\b|nah\b|wait\b|scratch that|never ?mind|nvm\b|forget (?:it|that|about it)|hold on|hang on|on second thought|just kidding|jk\b|not yet|cancel that|or not|maybe not|not now)/i;
// thinking aloud is not a request ("maybe buy an hour get an hour on mondays", "thinking about doing ...", "what if we did ...")
const HEDGE = /^(?:maybe|perhaps|probably|possibly|(?:(?:i'?m|im|i am|we'?re|were|we are)\s+)?thinking|what if|how about|what about|wondering|i wonder|i was wondering|considering|debating|i guess|might|we might|we could|i could|should we|would it|do you think)\b/i;
// what was, not what to make ("we used to do ...", "we tried ...", "we had ...")
const PAST_HEAD = /^(?:used to|tried|had|ran|did|offered|stopped|ended|cancel+ed|got rid|removed|were doing|was doing|have been|had been|been)\b/i;
// a request in parts: "lets do the bogo, never on weekends", "put events on the website - actually no", "... and turn off Bay 3"
// (Oct 27 2026, the review of round 2: "send the door code 20 minutes before? no" - a "?" ends a part too)
const CLAUSE = /\s*(?:[,;:!.?]+(?=\s|$)|\s[-\u2013\u2014]+(?=\s)|\s(?:and|but|then|plus|so)(?=\s))\s*/i;
// a part that only leads in: "ok", "no,", "never mind", and what the owner says before asking ("i don't know how, put events on the
// website", "we never had a bogo, lets do buy an hour get an hour on tuesdays")
const KNOW = /^(?:(?:i|we) (?:don'?t|dont|do not) know(?: how)?(?: to(?: do (?:it|this|that))?)?|(?:i'?m|im|i am) not sure(?: how)?(?: to(?: do (?:it|this|that))?)?|(?:we|i) (?:have )?(?:never|haven'?t|havent|have not) (?:had|done|run|tried|offered)(?: (?:one|it|that|this|any|an?(?: \w+){1,2}))?(?: before)?|never had one(?: before)?)$/i;
const LEAD_RE = new RegExp(NOT_LEAD, 'i'), HEAD_RE = new RegExp(NOT_LEAD + NOT_WHO, 'i');
// (Oct 27 2026, the review of round 2: "put events on the website\u2014actually no", "...--actually no", "...actually no" put Events in the
// top menu at once - a phone makes "--" an em dash with no spaces, and "..." is typed with none. A run of dashes or dots is a break
// between parts, spaced or not; a dash between two numbers stays a range: "2\u20135", "2--5")
const breaks = (s) => s.replace(/\s*(?:\u2014|\u2013|-{2,})\s*/g, (m, at, all) => (/\d/.test(all[at - 1] || '') && /\d/.test(all[at + m.length] || '') ? '-' : ' - '))
  .replace(/\s*(?:\.{2,}|\u2026)\s*/g, '. ');
const plainWords = (w) => breaks(String(w || '').toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'")).replace(/\s+/g, ' ').trim();
const leadOff = (c) => (c + ' ').replace(LEAD_RE, '').trim();
const headOf = (c) => (c + ' ').replace(HEAD_RE, '').trim();
const filler = (c) => { const t = c.replace(/[,.!;:]+$/, '').trim(); return !leadOff(t) || /^(?:no+|nope|nah|no wait|wait no|no no)$/.test(t) || KNOW.test(t); };
function partsOf(s) { const cl = s.split(CLAUSE).map(x => x.trim()).filter(Boolean); while (cl.length && filler(cl[0])) cl.shift(); return cl; }
// a label the owner puts first is not the request ("website: put gift cards in the top menu", "sat early: close early sat at 8")
const LABEL = /^[a-z0-9 ']{1,30}:\s+(?=\S+\s+\S)/;
function saidNot(words, own) {
  let s = plainWords(words);
  if (own) s = s.replace(own, ' ');
  // (a day left out in any form THE DAYS RULE reads - "weekends off", "friday is off", "nothing on weekends" - says no stop: Oct 27 2026,
  // round 2d; the reading then carries the days left, or is the model's)
  s = H.daysSaid(s).cut;
  s = s.replace(NOT_TILL, ' ').replace(NOT_BENIGN, ' ').replace(/\s+/g, ' ').trim();
  // (what a label says of not doing it still counts: "not yet: put events on the website" - and of stopping it: "retired: teachers 15%
  // off with id", Oct 27 2026)
  const label = (LABEL.exec(s) || [''])[0]; if (label && (SAID_NOT_ANY.test(label) || OFF_ANY.test(label) || OFF_SAID.test(label))) return true;
  const cl = partsOf(s.slice(label.length)); if (!cl.length) return false;
  if (HEDGE.test(leadOff(cl[0])) || cl.slice(1).some(c => TAKEN_BACK.test(c))) return true;
  // TWO REQUESTS ARE NEVER READ AS ONE (Oct 27 2026; test-assistant-eval E9b): "happy hour weekdays 2 to 5 is $15 a half hour and change
  // the headline to Swing Into Fall", "send door codes 20 minutes before, then text everyone" - the box's reading before the model held
  // back (engine.js asks intents.second), but the same readers after a model round put up the first part and the second was never
  // done. The readers themselves now hand both to the model, wherever they are asked (the lead-in parts left out first: "ok, put events
  // on the website" is one request)
  if (cl.length > 1) { let two = false; try { two = require('./intents').second(cl.join(', ')); } catch { two = false; } if (two) return true; }
  if (cl.some(c => { const h = headOf(c); return HEAD_OFF.test(h) || PAST_HEAD.test(h); })) return true;
  const rest = cl.map(leadOff).join(' , ');
  return SAID_NOT_ANY.test(rest) || OFF_SAID.test(rest);
}
// the readers' own words for when a thing stops (each action's own reader reads them): stripped before the guard looks
// ("stop codes stopping 15 minutes after" is not the codes' own stop, nor "kill the routine that closes gspro" - nor "quit closing
// gspro": a stop said of the routine, or of doing it, is the model's - the review, Oct 27 2026)
const READ_OWN = {
  door_code_timing_set: /\b(?:stop|stops|end|ends|quit|quits|expire|expires|turn off)\b(?![^.?!]{0,20}?\b(?:stopp|end|quitt|expir)ing\b)(?=[^.?!]{0,20}?\b(?:\d{1,3}|an?|half an?)\s*(?:hours?|hrs?|min(?:ute)?s?)\s*(?:after|later)\b)/gi,
  // (a doing after it is not a program - "quit closing gspro"; a name that ends in -ing is: "kill Swing Catalyst on bay 1 after each
  // session", Oct 27 2026)
  routine_create: /\b(?:close|quit|exit|kill|shut down)\b(?!\s+(?:(?:clos|quitt|exit|kill|shutt|stopp|end|runn|open|start|launch|load|play|do|mak|hav|us|keep|leav|turn|switch|paus)ing\b|routines?\b|(?:the|that|this|our|my|a|an)\s+(?:\S+\s+){0,3}?routines?\b))(?=[^.?!]*\b(?:session|game|booking)s?\b)/gi,
};
// WHAT A READER KNOWS A REQUEST TO START WITH (Oct 27 2026, above): the first part's first word, after the owner's lead-in ("ok so",
// "can you", "we want to"). Anything else is the model's - an unknown word at the start is the one place a reader cannot be sure
const CREATE = String.raw`(?:let'?s|lets|do(?:ing)?|mak(?:e|ing)|set(?:ting)?|setup|giv(?:e|ing)|run(?:ning)?|add(?:ing)?|offer(?:ing)?|start(?:ing)?|creat(?:e|ing)|hav(?:e|ing)|want|need|put(?:ting)?|throw(?:ing)?|introduc(?:e|ing)|launch(?:ing)?|bring(?:ing)?|try|new|another)\b`;
const DAY_WORD = String.raw`(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?|weekdays?|weekends?|every|each|on|tonight|today|all)\b`;
const GROUP_WORD = String.raw`(?:milit[ae]ry|soldiers?|vets?|veterans?|seniors?|elderly|students?|college|teachers?|educators?|first responders?|responders?|police|cops?|fire ?fighters?|firemen|nurses?)\b`;
const headRe = (alts) => new RegExp('^(?:' + alts.join('|') + ')', 'i');
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a part or an item of the facility's own menu, said first ("wings 50 cents off tuesdays 5 to 9", "tacos 2 bucks on tuesdays")
const menuHead = (h, ctx) => (((ctx && ctx.menu) || {}).cats || []).some(c => [c.name].concat((c.items || []).map(i => i.name)).some(n => {
  const k = String(n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/s$/, '');
  return k.length > 1 && new RegExp('^' + reEsc(k) + '(?:s|es)?\\b').test(h); }));
const SPECIAL_HEAD = headRe([CREATE, DAY_WORD, String.raw`(?:specials?|happy|game|half|drop|take|knock|the|an?|our|drinks?|food|beers?|everything|apps?|appetizers?)\b`, String.raw`[\d$]`]);
const READ_HEAD = {
  deal_set: headRe([CREATE, DAY_WORD, String.raw`(?:book\w*|buy|bogo|free\w*|the|last|final|first|an?|if|when|gets?|they|customers?|people|anyone|someone|everyone|deals?|promo\w*|our|this)\b`, String.raw`[\d$]`]),
  discount_code_create: headRe([CREATE, GROUP_WORD, String.raw`(?:codes?|discounts?|rates?|an?|the|our|same|for|everyone|half|take|knock)\b`, String.raw`[\d$]`]),
  price_window_add: headRe([CREATE, DAY_WORD, String.raw`(?:charg\w*|prices?|pricing|rates?|cut|lower|drop|raise|bump|change|happy|from|nights?|mornings?|evenings?|afternoons?|late|early|the|an?|our|peak|off ?peak)\b`, String.raw`[\d$]`]),
  counter_special_set: (h, ctx) => SPECIAL_HEAD.test(h) || menuHead(h, ctx),
  website_menu_set: /^(?:put\w*|add\w*|show\w*|link\w*|stick\w*|list\w*|display\w*|include\w*|feature\w*)\b/i,
  device_pair: /^(?:pair\w*|start\w*|connect\w*|add\w*|set\w*|hook\w*|link\w*|put\w*|let'?s|lets|new|another|i have|we have|we got|i got)\b/i,
  routine_create: /^(?:close\w*|quit\w*|exit\w*|kill\w*|shut\w*|make|have|set|add|create|let'?s|lets|when\w*|after|at|on|in|for|every|each|bay\w*|the|once)\b/i,
  door_code_timing_set: headRe([CREATE, String.raw`(?:door|lock|codes?|pins?|the|text\w*|send\w*|sent|email\w*|start\w*|begin\w*|work\w*|turn on|go live|let|they|customers?|an?|our|each|every|from|keep|change|move|push|bump|stop|stops|end|ends|quit|expire\w*|turn off)\b`, String.raw`\d`]),
};
function headKnown(words, gate, ctx) {
  const cl = partsOf(plainWords(words).replace(LABEL, '')); if (!cl.length) return false;
  const h = headOf(cl[0]);
  return typeof gate === 'function' ? gate(h, ctx) : gate.test(h);
}
// A DAY LEFT OUT IS NEVER THE DAY READ (Oct 27 2026, the review of round 2 - the worst of it): "book 2 hours and get the last 30 minutes
// free, not on weekends" was put up as a WEEKEND deal, "wings 50 cents off 5 to 9, not on fridays" as every Friday, "lets do buy an hour
// get an hour except mondays" as Mondays - the readers take the first days named, and the day the owner excluded was the first. A day
// left out ("not on weekends", "never on mondays", "except mondays", "excluding weekends", "other than fridays") is read only when the
// reading names other days and none of the ones left out ("the last 30 minutes free on tuesdays, never on weekends" is Tuesdays, as
// said); anything else - no other day named, a day left out read as the day, a reading with no days at all - is the model's
const DAYS_ANY = String.raw`(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?|weekdays?|weekends?)`;
// (Oct 27 2026, round 2d: the days left out are THE DAYS RULE's own reading - helpers.daysSaid - never a second list of their own here:
// this one missed "weekends off", "nothing on weekends", "friday is off" and "weekends dont count", which the readers then took as the days)
function daysLeftOut(s) { const r = H.daysSaid(s); return r.left.size ? r.left : null; }
// the days a reading says: a deal's, a price's or a special's days, the hours' days open and days with their own hours
function daysRead(r) {
  const d = [];
  const add = (v) => { const n = v == null ? null : H.normDays(Array.isArray(v) ? v.join(',') : String(v)); if (n) d.push(...n); };
  if (r.days !== undefined) add(r.days); if (r.open_days !== undefined) add(r.open_days);
  for (const o of Array.isArray(r.other_hours) ? r.other_hours : []) add(o.days);
  return d;
}

// WHAT A READER THAT MAKES SOMETHING KNOWS THE WORDS OF (Oct 27 2026, the review of round 2): the stop guard looked for a stop at the head
// of each part, and a stop said anywhere else still put up a card MAKING the thing - "the teacher code 15% off with id is retired",
// "teachers 15% off with id ends today", "the buy an hour get an hour on mondays is going away", "put an end to ...", "set ... to off",
// "give up on ...", "make the teacher code 15% off inactive", "the wings 50 cents off tuesdays 5 to 9 special ends now", "close gspro on
// bay 1 when each session ends was a mistake", "text the door code 20 minutes before is too early". Another list of stop words would
// miss the next one (maintainer: a narrow list of what the box understands, never a longer list of what it does not). So each reader that makes
// money, a door, a device, a routine or the site's menu reads only words it knows: the words a plain request to MAKE that thing is made
// of - the lead-in, the doing word, the thing itself, its amount, its days (and, for a price or a special, its hours), the facility's
// own names (its menu, its bays) and what the reading itself took as a name (a program, a free thing). One word it does not know -
// retired, ends, inactive, mistake, away, too, after 6 on a deal that has no hours - and the whole request is the model's. A reader
// with no hours of its own hands on hours said ("buy an hour get an hour on tuesdays after 6" was put up for all day)
const VOCAB = (s) => new Set(s.trim().split(/\s+/));
const PLAIN_COMMON = VOCAB(`ok okay so and also hey please pls plz now oh well yeah yes yep yup sure alright cool great nice perfect awesome sweet thanks thank thx
  um uh hmm then just really actually i we you u i'd we'd i'll we'll we're were i'm im let's lets let us me can could would will should shall want wanna need gonna
  going like love go ahead a an the our my your this that it its it's them they their to of for on in at by with into onto or & + plus - / is are be do doing make
  making set setting setup get gets give giving run running add adding offer offering start starting create creating have having put putting throw introduce
  launch bring try new another one two three four five six seven eight nine ten fifteen twenty thirty forty fifty sixty ninety half quarter`);
const DAY_WORDS = VOCAB(`every each day days daily weekly`);
const TIME_WORDS = VOCAB(`am pm a.m p.m noon midnight o'clock morning mornings afternoon afternoons evening evenings night nights tonight late early from till til until
  untill to through thru between close open opening closing all long`);
const PLAIN_VOCAB = {
  deal_set: { days: true, words: VOCAB(`deal deals promo promos promotion special bogo buy buys get gets getting free freebie freebies last final first hour hours hr hrs
    minute minutes min mins book books booking booked bookings reserve reserves if when they them people customers customer someone anyone everyone players player
    more least or extra and`) },
  // (Oct 27 2026, the review of round 2: "teachers 15% off if they show id" and "... w/ id" are the plain ways to say it - "if", "w/";
  // any other condition after "if" is words this reader does not know, and a number it does not carry is the model's)
  discount_code_create: { words: VOCAB(`code codes discount discounts rate rates off percent pct % id ids i.d card cards badge badges show shows showing shown with w w/ if check
    checked checks checking verify door they them their get gets give for all any every same too also as well that who take knock of people folks everyone valid
    proof bring brings present presents flash military militery soldier soldiers vet vets veteran veterans senior seniors elderly student students college teacher
    teachers educator educators first responder responders police cop cops firefighter firefighters fire fighter fighters firemen nurse nurses dollars bucks`) },
  price_window_add: { days: true, times: true, words: VOCAB(`price prices pricing rate rates charge charging charged cost costs window happy hour hours hr hrs half
    per peak off-peak offpeak dollars bucks drop lower cut raise bump change move goes bird birds`) },
  counter_special_set: { days: true, times: true, words: VOCAB(`special specials happy hour game day deal drinks drink food beer beers everything apps appetizers off
    each cents cent c bucks buck dollars dollar price half only drop take knock cut lower`) },
  door_code_timing_set: { words: VOCAB(`door doors lock locks code codes pin pins keypad start starts started work works working begin begins good active live valid
    turn text texts texted texting send sends sent email emails emailed minute minutes min mins hour hours hr hrs before after early earlier ahead later session
    sessions booking bookings customer customers change move push bump until till from`) },
  routine_create: { words: VOCAB(`close closes quit quits exit exits kill kills shut down out of when whenever each every any session sessions game games booking
    bookings after once routine that`) },
  device_pair: { words: VOCAB(`pair pairing connect hook link up z-wave zwave zigbee matter device devices plug plugs switch switches light lights bulb bulbs lamp lamps
    thermostat sensor sensors lock locks outlet outlets fan fans dimmer strip socket button buttons remote keypad siren motion contact door window leak water
    temperature smart code hub got`) },
  website_menu_set: { words: VOCAB(`show showing link stick list display include feature gift gifts card cards giftcard giftcards events memberships membership leagues
    league how works web website site menu home homepage page top main nav navigation bar back up link links too`) },
};
// what the reader itself took as a name, and the facility's own names: never a word to know
const NAME_WORDS = {
  routine_create: (r, ctx) => [((r.steps || [])[0] || {}).program].concat((ctx.bays || []).map(b => b.name)),
  deal_set: (r) => (r.free || []).map(f => f.what),
  device_pair: (r) => [r.code],
};
const tokensOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$%&+/'.:-]+/g, ' ').split(/\s+/).map(t => t.replace(/^[.:'-]+|[.:'-]+$/g, '')).filter(Boolean);
const menuWords = (ctx) => (((ctx && ctx.menu) || {}).cats || []).flatMap(c => [c.name].concat((c.items || []).map(i => i.name)));
const nameSet = (names) => { const o = new Set(); for (const n of names) for (const t of tokensOf(n)) { o.add(t); o.add(t.replace(/(?:es|s)$/, '')); o.add(t + 's'); o.add(t + 'es'); } return o; };
// the reader's own phrases, taken out before the words are looked at: a code that never expires, "set up", a session's end, a stop of
// the code's own (READ_OWN), a day left out that the reading already keeps
const OWN_PHRASES = [/\b(?:that |which )?(?:never|doesn'?t|does not|won'?t|will not|don'?t) expires?\b|\bno (?:expiration|expiry|end date)\b/g, /\bset(?:ting)? (?:it |them )?up\b/g,
  /\bput(?:ting)? (?:it |them )?up\b/g, /\bhook(?:ing)? (?:it |them )?up\b/g];
const SESSION_END = /\bwhen(?:ever)?\s+(?:each|every|a|the|any)?\s*(?:session|game|booking)s?\s+(?:ends|is over|are over|finishes|is done|are done|starts|begins)\b|\b(?:at the )?(?:end|start) of (?:each|every|a|the) (?:session|game|booking)s?\b|\bafter (?:each|every|a|the) (?:session|game|booking)s?\b/g;
// THE OWNER'S OWN SMALL WORDS AFTER A REQUEST (Oct 27 2026, the review of round 2: the allowlist above lost 190 of 454 plain requests the
// box read before to the words owners put at the end - "lets do buy an hour get an hour on tuesdays from now on", "teachers 15% off with
// id going forward", "put events on the website asap", "happy hour weekdays 2 to 5 is $15 a half hour, every week", "ty", "k", "real
// quick", "if you can", "when you get a chance", "again", "too"). Said at the end of a part they ask nothing more, and of a standing change
// "from now on", "going forward", "every week" and "starting today" are what it is (a deal, a code, a price, a special, the door codes, a
// routine, the site's menu - never a pairing). A timing or a condition the reading does not hold - "starting monday", "after halloween",
// "til dec 31", "first 50 people" - is still the model's
const POLITE_END = /(?:\s+(?:please|pls|plz|thanks|thank you|thx|ty|tysm|k|kk|ok|okay|for me|for us|if you can|if you could|if possible|when you can|when you (?:get|have) (?:a )?(?:chance|sec|second|minute)|real quick|asap|right away|right now|rn|now|again|too|as well|also))+\s*$/;
const POLITE_PART = /^(?:(?:please|pls|plz|thanks|thank you|thx|ty|tysm|k|kk|ok|okay|cool|great|perfect|awesome|asap|right away|real quick|if you can|when you can|when you (?:get|have) (?:a )?(?:chance|sec|second|minute))\s*)+$/;
const STANDING = /\b(?:from now on|from here on(?: out)?|going forward|moving forward|every week|each week|starting (?:today|now|tonight)|as of (?:today|now)|for good|permanently|until further notice)\b/g;
const STANDING_READERS = new Set(['deal_set', 'discount_code_create', 'price_window_add', 'counter_special_set', 'door_code_timing_set', 'routine_create', 'website_menu_set']);
// A STOP SAID IN WORDS A READER KNOWS (Oct 27 2026, the review of round 2: "teachers 15% off with id - off" put up the code, "happy hour
// weekdays 2 to 5 at $15 a half hour is closing" a new window - "off" and "closing" are words those readers know): a later part that is
// only a stop, or the thing said to be closing, over or off, is never read as making it
const STOP_PART = /^(?:off|closed|closing|done|over|ended|gone|stopped|cancel+ed|inactive|expired|finished|no more|not anymore|end it|kill it|stop it|scrap it|nix it|turn it off|shut it off)$/;
const STOP_SAID = /\b(?:is|are|was|were|'s|'re|be|been|being)\s+(?:closing|closed|ending|ended|done|over|off|finished|gone|cancel+ed|inactive|expired|expiring)\b(?!\s*(?:-?\s*peak|at|till|til|until|by|on|early|late|from|\d))/;
// (a label's own title words, in the label only: "update: ...", "note: ...", "shorthand: ..." say what kind of message it is - any other
// label is words the reader must know)
const GATE_TITLE = new Set(['update', 'note', 'fyi', 'quick', 'new', 'change', 'changes', 'reminder', 'request', 'todo', 'task', 'idea', 'shorthand']);
// A NUMBER THE READING DOES NOT CARRY IS THE MODEL'S (Oct 27 2026, the review of round 2: "first 50 people: teachers 15% off with id" was a
// code with no limit): every number said - in figures or in words - must be one the reading holds (its amount, its hours, a bay's or a
// code's own number) or, for a deal, the booking's length and the minutes free its fill reads
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90 };
const NUM_WORD_RE = new RegExp(String.raw`\b(?:${Object.keys(NUM_WORDS).join('|')})\b`, 'g');
function numbersCarried(r, s, name) {
  const o = new Set(), add = (n) => { if (Number.isFinite(n)) o.add(Number(n)); };
  const walk = (v) => {
    if (typeof v === 'number') { add(v); add(Math.round(v * 100)); }
    else if (typeof v === 'string') {
      for (const m of v.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) { const h = Number(m[1]); add(h); add(h % 12 || 12); if (h === 0) add(24); if (m[2] !== '00') add(Number(m[2])); }
      for (const m of v.replace(/\b\d{1,2}:\d{2}\b/g, ' ').matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0]));
    } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(r);
  // (a time said in hours that the reading holds in minutes is carried: "text the door code 1 hour before" is 60 minutes - the review of
  // round 2c, Oct 27 2026: it was handed to the model, and "2 hours" and "1.5 hours" with it)
  for (const m of s.matchAll(/\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?)\b/g)) { const h = Number(m[1]); if (o.has(Math.round(h * 60))) add(h); }
  if (name === 'deal_set') for (const re of [/\b(?:book\w*|with|for|at least|of|an?)\s+(?:at least\s+)?(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?)\b/g, /\b(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?)\s+(?:or (?:more|longer)|bookings?|sessions?)\b/g,
    /\b(?:last|final|free|buy|get)\s+(\d+)\s*(?:more\s+)?(?:minutes?|mins?|hours?|hrs?)?\b/g, /\b(\d+)\s*(?:minutes?|mins?|hours?|hrs?)\s+(?:free|on us)\b/g]) for (const m of s.matchAll(re)) add(Number(m[1]));
  return o;
}
function plainMaking(name, words, r, ctx) {
  const v = PLAIN_VOCAB[name]; if (!v) return true;
  let s = plainWords(words);
  if (/\?/.test(s)) return false;
  // (a reader with no hours of its own: hours said are the model's)
  if (!v.times && TIMES_SAID.test(s)) return false;
  // (one week or one day is not every week: "this saturday 6 to midnight $30 a half hour", "bogo this weekend" - a deal, a price or a
  // code has no date the reader reads; a special's own fill reads tonight, tomorrow and "this friday" as that date, never "this weekend")
  if (new RegExp(String.raw`\b(?:this|next|coming)\s+(?:week(?:end)?s?|${name === 'counter_special_set' ? 'month' : DAYS_ANY})\b`).test(s)) return false;
  // (Oct 27 2026, round 2d - THE DAYS RULE, helpers.daysSaid: a reading with days reads only days that are certain. A day said in a way
  // the rule cannot place, one time ("tonight" - a special's own fill holds tonight, today, tomorrow and this or next weekday as its date),
  // a start or an end ("every day starting tues", "till sunday"), a past day or one naming a thing ("the bogo we did last weekend", "the
  // tuesday happy hour went well") are the model's: the card would drop them)
  const ds = H.daysSaid(s);
  // ("every day" is a group of its own now, so the special's reader sees days in "Nacho night: Loaded Nachos are $6 every day" - with no
  // hours and no "special" that is as much the menu's own price as a special, the reader's own rule: the model's, as before - test-assistant
  // A40l)
  if (name === 'counter_special_set' && ds.every && !r.from_time && !r.to_time && !/\b(?:specials?|happy hour)\b/.test(s)) return false;
  if (v.days && (ds.unsure || ds.limit || (ds.oneOff && !(name === 'counter_special_set' && /^(?:tonight|tonite|today|tomorrow|(?:this|next) (?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)$/.test(ds.oneOff))) || (ds.aside && !ds.oneOff))) return false;
  if (STANDING_READERS.has(name)) s = s.replace(STANDING, ' ');
  // ("all day" on a reading with no hours is what it is: "buy an hour get an hour on tuesdays all day")
  if (!v.times) s = s.replace(/\ball day(?: long)?\b/g, ' ');
  for (const re of OWN_PHRASES) s = s.replace(re, ' ');
  if (READ_OWN[name]) s = s.replace(READ_OWN[name], ' ');
  if (name === 'routine_create') s = s.replace(SESSION_END, ' ');
  // (the days left out, in every form the rule reads - "not on weekends", "weekends off", "friday is off" - are the reading's own words)
  s = H.daysSaid(s).cut.replace(/\s+/g, ' ').trim();
  if (STOP_SAID.test(s)) return false;
  // (a label is words like any other - "after halloween:", "members only:", "til dec 31:", "tomorrow:" are a condition the reading never
  // holds; the reader's own words or a title word make a label the owner's title: "website:", "deal:", "update:" - Oct 27 2026, the critic
  // of round 2: the label was taken off before this look, so what it said was never looked at)
  // ("words only:" says what kind of message it is, as the hours' labels - never "members only:" or "saturday only:", which say who or when)
  const lab = LABEL.exec(s), title = new Set(lab ? tokensOf(lab[0]).filter(t => GATE_TITLE.has(t)).concat(/\bwords only\b/.test(lab[0]) ? ['words', 'only'] : []) : []);
  const cl = partsOf(s).map(c => c.replace(POLITE_END, '').trim()).filter(c => c && !POLITE_PART.test(c)); if (!cl.length) return false;
  if (cl.slice(1).some(c => STOP_PART.test(leadOff(c).replace(/[.!]+$/, '')))) return false;
  const rest = [headOf(cl[0])].concat(cl.slice(1).map(leadOff)).join(' ');
  const names = nameSet((/^(?:deal_set|counter_special_set)$/.test(name) ? menuWords(ctx) : []).concat(NAME_WORDS[name] ? NAME_WORDS[name](r, ctx) : []).filter(Boolean));
  // ("tue/thu" as typed is two days, as "mon-thu" is a run: Oct 27 2026, round 2d)
  const dayRun = (t) => DAY_TOKEN.test(t) || (t.split('-').length === 2 && t.split('-').every(x => DAY_TOKEN.test(x))) || (t.split('/').length > 1 && t.split('/').every(x => DAY_TOKEN.test(x)));
  // ("wed", "sat" or "sun" the rule read as an ordinary word is that word: "wed" is "we'd", any other is a word the reader does not know)
  const known = (t) => ds.ordinary.has(t) ? t === 'wed' : PLAIN_COMMON.has(t) || v.words.has(t) || names.has(t) || title.has(t) || /^\$?\d+(?:\.\d+)?(?:%|c)?$/.test(t)
    || (v.days && (DAY_WORDS.has(t) || dayRun(t)))
    || (v.times && (TIME_WORDS.has(t) || /^\d{1,2}(?::\d{2})?(?:am|pm|a|p)?(?:-\d{1,2}(?::\d{2})?(?:am|pm|a|p)?)?$/.test(t)))
    || (name === 'discount_code_create' && /^[a-z]{2,15}\d{1,3}$/.test(t)) || (name === 'device_pair' && /^(?:mt:)?[\d-]{6,}$/.test(t));
  const toks = tokensOf(rest);
  if (!toks.every(known)) return false;
  // (Oct 27 2026, the review of round 2: "lets do buy an hour get an hour on tues" was put up for every day and "... monday to thursday"
  // for Mondays - the look took any day word, read or not. Every day said must be one of the reading's own days)
  // ("weekdays except fridays" is Monday to Thursday: a day said and then left out is the reading's too)
  // (and a special's one date said as a weekday - "this friday" - is its own day: the special's fill makes it that date, Oct 27 2026)
  if (v.days) { const mine = new Set(daysRead(r).concat([...(daysLeftOut(plainWords(words)) || [])], ds.oneOff && name === 'counter_special_set' ? H.normDays(ds.oneOff.replace(/^(?:this|next)\s+/, '')) || [] : []));
    if (toks.some(t => !ds.ordinary.has(t) && dayRun(t) && !(H.normDays(t) || ['?']).every(d => mine.has(d)))) return false; }
  // (every number said, in figures or in words, is one the reading carries)
  const nums = numbersCarried(r, s.replace(NUM_WORD_RE, (w) => String(NUM_WORDS[w])), name);
  for (const t of toks) {
    const ns = NUM_WORDS[t] !== undefined ? [NUM_WORDS[t]] : (name === 'discount_code_create' && /^[a-z]{2,15}\d{1,3}$/.test(t)) || name === 'device_pair' ? [] : (t.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (ns.some(n => !nums.has(n))) return false;
  }
  return true;
}
// ONE NIGHT IS NOT EVERY WEEK (Oct 25 2026, the adversarial review): "we are open til 1am this friday for the tournament" was put up
// before the model saw it as every Friday open to 1 AM, and "we are closed thursday for thanksgiving" as every Thursday closed - the
// hours are kept by the weekday (services/hours.js booking.dayHours), so a card from those words changes every week from now on.
// Words naming one occasion - this/next Friday, tonight, tomorrow, a date, a holiday, "for the tournament" - are never the box's own
// hours reading: the model has them whole (a closed day is a block of the whole facility; a one-off late night has no setting of
// its own, and the weekly change is only ever the owner's stated choice)
// (Oct 27 2026, the review of that fix: a weekday said with a reason or a future the list did not hold was still put up as every
// week - "we're closed friday due to the weather", "closed monday, staff training", "we will be closed friday", "close early saturday
// at 6, we have a wedding", "open til 1am friday, big fight night". The box now reads hours only when EVERY word is one a plain weekly
// change is made of - the days, the hours, open, close, late, early, now, every, from now on - and takes a day out only when it is
// said as a day of the week ("closed mondays", "closed every monday", "closed monday now"): "we're closed friday" is as often this
// Friday. Anything else is the model's, whole - a reason nobody listed included)
const ONE_OCCASION = new RegExp([
  String.raw`\b(?:this|next|coming|that)\s+(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?|week(?:end)?)\b`,
  String.raw`\b(?:tonight|tonite|today|tomorrow|tmrw|tmrow|tomorow)\b`,
  String.raw`\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b`, String.raw`\b\d{1,2}\/\d{1,2}\b`, String.raw`\b\d{4}-\d{2}-\d{2}\b`,
  String.raw`\bthe\s+\d{1,2}(?:st|nd|rd|th)\b`, String.raw`\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b`,
  String.raw`\bfor\s+(?:the|a|an|our|my|that|this)\b`,
  String.raw`\b(?:thanksgiving|christmas|xmas|halloween|new year'?s?|easter|memorial day|labor day|labour day|july 4th|4th of july|fourth of july|independence day|super bowl|holidays?|tournament|party|private event|event|one time|one-time|one off|one-off|just once|only once)\b`,
].join('|'), 'i');
const HOURS_PLAIN = new Set(("ok okay so and also actually hey please pls plz now oh well yeah yes alright then just we we're were are our hours is " +
  "closed close closes closing open opens opening stay stays staying late later early earlier on every each at till til until untill to from by " +
  "through thru am pm a.m a.m. p.m p.m. noon midnight o'clock & - weekly nights night evenings evening the").split(' '));
const DAY_TOKEN = /^(?:(?:mon|tues?|wed(?:nes)?|weds|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?|weekdays?|weekends?)$/;
// (said for good, never one day: "starting today we close at 10 on sundays" is every Sunday from today)
const WEEKLY = /\b(?:starting (?:today|now)|as of (?:today|now)|from (?:today|now) on|from now|going forward|from here on(?: out)?|for good|permanently|every week|each week)\b/g;
// A LABEL THAT SAYS WHY IS A ONE-OFF (Oct 27 2026, the review of round 2: "big fight night: open til 1am friday", "wedding: close early
// sat at 6", "weather: closed monday now", "inventory: closing at 6 saturday" were each put up as every week - the label was set aside
// before the every-word look, and a reason said after the hours ("open til 1am friday, big fight night") was already the model's). A
// label is only the owner's title when it is made of the hours' own words, glued or not ("sat early:", "late fri:", "latefri:", "hours:"),
// or says what kind of message it is ("update:", "note:", "words only:"); any other label is a reason, and the words are the model's
const LABEL_TITLE = new Set(['hours', 'hour', 'update', 'note', 'fyi', 'schedule', 'change', 'changes', 'new', 'words', 'only', 'quick']);
const GLUED = /^(?:late|early|open|close|closed|stay|mon|tues?|wed|thu|thurs|fri|sat|sun|weekday|weekend)+s?$/;
function plainHours(s) {
  const t = s.replace(WEEKLY, ' weekly ').replace(/\b(?:don'?t|dont|do not|does not|doesn'?t|doesnt|won'?t|wont)\s+(?=close\w*\s+(?:till|til|until|untill)\b)/g, '').replace(/\s+/g, ' ').trim();
  // (one night said anywhere, a label first included - "this friday: open til 1"; the label itself is not the hours - "hours: closed
  // mondays now")
  if (ONE_OCCASION.test(t)) return null;
  const lab = (LABEL.exec(t) || [''])[0];
  if (lab && !lab.replace(/:\s*$/, '').trim().split(/\s+/).every(w => HOURS_PLAIN.has(w) || DAY_TOKEN.test(w) || LABEL_TITLE.has(w) || GLUED.test(w))) return null;
  return t.replace(LABEL, '').replace(/[,.!;:]+(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean).every(w => HOURS_PLAIN.has(w) || DAY_TOKEN.test(w) || /^\d{1,2}(?::\d{2})?(?:am|pm|a|p)?$/.test(w)) ? t : null;
}
// THE HOUR SAID, READ FROM THE OWNER'S OWN WORDS AND THE FACILITY'S OWN HOURS (the walk, Oct 23 2026: "open late fri till 1" was put up
// by the 4B as midnight): "till 1", "close at 8", "open at 10" - a bare closing hour from 6 to 11 is the evening; a bare opening hour from
// 6 to 11 the morning; "12 noon" is noon and "12 midnight" midnight, as said.
// (Oct 27 2026, the review of round 2: the first cut read "close early ... at 1" as 1 PM and "open until 5" as 5 AM by the words alone,
// whatever the facility's hours - "close early sundays at 1" at a place that closes at 2 AM was put up as 1 PM, over the model's right
// 1 AM; "we're open until 5 on sundays" at a place that closes at 11 PM as 5 AM the next day; "close at 12 noon" and "close early at 12"
// as midnight. Now each bare hour that could be either - 1 to 5, and 12 - is held against the day's own hours: a closing at most 6 AM
// the next day and after it opens; "early" earlier than it closes now, "late" (late, stay open, don't close until) later. One reading
// left is the hour; a bare 12 with nothing said either way is midnight, as before; two readings or none - "close at 4 on sundays",
// "close early at 1" at a place open till 2 AM, "open until 5" - are not the box's to pick (closeUnsure), and the model's own hour
// stands. "Open until" no longer counts as late. Two different closing hours said ("10 to 11, and till 1am Friday and Saturday" put up
// 11 PM for every day and left Friday's 1 AM out) are the model's too)
// (Oct 27 2026, the review of that fix: taking "open until" out of "late" lost "open till 1 on fridays" at a place that closes at 11 PM -
// no reading, and the fill no longer put the model's 1 PM right. "Open till" is held against the day's own hours too: a place that closes
// late (9 PM or after) is open till that hour PAST MIDNIGHT when it lies within four hours of the close ("open till 1", "open til 2"); a
// place that closes earlier is open till that hour in the afternoon or evening when it lies inside its hours; anything else - "open till
// 4" at an 11 PM place - is the model's to ask, as before. And two hours said for two days, the second bare ("close at 9 on sundays and
// 10 on saturdays", "open at 8 on saturdays and 9 on sundays") put the first on every day named: every bare hour is counted now, and one
// the reading does not place is the model's)
function hoursSaid(w, h, named) {
  const hm = (x, m) => String(x).padStart(2, '0') + ':' + (m || '00');
  const CM = /\b(?:till|til|until|untill|to|close[sd]?|closing)\b[^.?!\d]{0,20}?\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?|noon|midnight)?(?!\s*(?:%|hours?|minutes?|mins?|people|players|guests|bucks|dollars)\b)/g;
  const said = [...String(w || '').matchAll(CM)].filter(m => Number(m[1]) <= 24);
  const om = /\bopen(?:s|ing)?\b[^.?!\d]{0,20}?\b(?:at|from)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?/.exec(w);
  const late = /\b(?:late|later|stay(?:s|ing)? open|(?:don'?t|dont|do not|does not|doesn'?t|doesnt|won'?t|wont|not) close\w* (?:till|til|until|untill))\b/.test(w), early = /\b(?:early|earlier)\b/.test(w);
  const mins = (t) => { const [a, b] = String(t || '').split(':').map(Number); return Number.isFinite(a) ? a * 60 + (b || 0) : null; };
  const hh = h || {}, refs = ((named && named.length) ? named : [null]).map(d => (d && hh.dayHours && hh.dayHours[d]) || (hh.openTime && hh.closeTime ? { open: hh.openTime, close: hh.closeTime } : null));
  // (a place open 24 hours has no closing hour of its own to fit a reading against - the rule asks: Oct 27 2026)
  const ruleHours = (ref) => (ref ? { openTime: ref.open, closeTime: ref.close, open24Hours: !!hh.open24Hours } : null);
  // the hours a bare x could mean at this facility, on the day's own hours
  // (Oct 27 2026, THE BARE-HOUR RULE - the review of round 2c: the four-hour "open till" guess put "open until 3 on sundays" up as 3 AM at a
  // place that closes at 11:30 PM, "open until 5 on sundays" as 5 AM at one that closes at 2 AM, and "open till 1 on fridays" as 1 PM over the
  // model's 1 AM at one that closes at 8 PM - each the box's own card, ahead of the model. A bare hour now has its two readings, in the small
  // hours or the morning and twelve hours on; the owner's own comparison first - "late", "stay open", "don't close until" leaves only a
  // reading later than the day closes now, "early" only an earlier one (neither is a day-part word: each compares with the day's own close);
  // and the rest is the one rule (helpers.clockHalf): a day-part word attached ("open till 1 friday night"); with none anywhere, the one
  // reading the day's own hours fit - a same-day close that leaves the day four hours open, one past midnight within six hours of the day's
  // own close; an opening from 5 AM with five hours before the close. Otherwise unsure, and the fill asks the owner (closeAsk,
  // openAsk), both to tap - never the model's hour kept, never moved, in silence)
  const W = H.clockWords(w), locIn = (re) => { const x = new RegExp(re.source, 'g').exec(W); return x ? { i: x.index + x[0].search(/\d/), j: x.index + x[0].length } : null; };
  const pick = (x, mm, ref, kind, loc) => {
    let ok = x === 12 ? [0, 12] : [x, x + 12];
    if (kind === 'close' && ref && mins(ref.open) !== null && mins(ref.close) !== null) {
      const O = mins(ref.open), C0 = mins(ref.close), C = C0 <= O ? C0 + 1440 : C0, pos = (c) => { const t = c * 60 + Number(mm || 0); return t > O ? t : t + 1440; };
      ok = ok.filter(c => pos(c) > O && pos(c) <= 1440 + 360);
      if (early) ok = ok.filter(c => pos(c) < C);
      if (late) ok = ok.filter(c => pos(c) > C);
    } else if (kind === 'close') {
      if (early) ok = ok.filter(c => c >= 12);
      if (late) ok = ok.filter(c => c < 12);
    }
    if (ok.length <= 1) return ok.length ? ok[0] : null;
    if (!loc) return null;
    const v = (c) => c * 60 + Number(mm || 0), cand = { am: { s: v(ok[0]), e: v(ok[0]) }, pm: { s: v(ok[1]), e: v(ok[1]) } };
    const half = H.clockHalf(W, loc.i, loc.j, kind, cand, ruleHours(ref), {});
    return half ? (half === 'am' ? ok[0] : ok[1]) : null;
  };
  let closeAt = null, closeUnsure = false, closeAsk = null;
  const kinds = new Set(said.map(m => [Number(m[1]), m[2] || '', String(m[3] || '').replace(/\./g, '')].join('|')));
  // every hour said: one that is neither the closing read nor the opening read ("... and 10 on saturdays") is not placed - neither hour
  // is the box's, and the model's own stand
  { const placed = new Set(said.map(m => m.index + m[0].search(/\d/)).concat(om ? [om.index + om[0].search(/\d/)] : []));
    for (const m of String(w || '').matchAll(/(?<![\d:$.])\b(\d{1,2})(?::[0-5]\d)?(?!\d|\s*(?:%|hours?|hrs?|minutes?|mins?|people|players|guests|bucks|dollars|bays?|weeks?|days?|months?|st|nd|rd|th)\b)/g))
      if (Number(m[1]) <= 24 && !placed.has(m.index)) return { closeAt: null, openAt: null, closeUnsure: true }; }
  if (kinds.size > 1) closeUnsure = true;
  else if (said.length) {
    const x = Number(said[0][1]), mm = said[0][2], mer = String(said[0][3] || '').replace(/\./g, '').toLowerCase();
    let at = null;
    if (mer === 'noon' || mer === 'midnight') at = x === 12 ? (mer === 'noon' ? 12 : 0) : null;
    else if (mer) at = /^p/.test(mer) ? (x % 12) + 12 : x % 12;
    else if (x === 0 || x === 24) at = 0;
    else if (x > 12) at = x;
    else { const loc = locIn(CM), each = refs.map(r => pick(x, mm, r, 'close', loc)); at = each.every(v => v !== null && v === each[0]) ? each[0] : null;
      // (one bare hour the rule could not place for the days named: its two readings, for the fill to ask)
      if (at === null) { const two = (x === 12 ? [0, 12] : [x, x + 12]).filter(c => refs.every(r => !r || (() => { const O = mins(r.open), t = c * 60 + Number(mm || 0); return (t > O ? t : t + 1440) <= 1440 + 360; })()));
        if (two.length === 2) closeAsk = two.map(c => hm(c, mm)); } }
    if (at === null) closeUnsure = true; else closeAt = hm(at, mm);
  }
  let openAsk = null;
  const openAt = om ? (() => { let x = Number(om[1]); if (x > 23) return null; if (om[3]) { x = /^p/.test(om[3]) ? (x % 12) + 12 : x % 12; return hm(x, om[2]); }
    if (x === 0 || x > 12) return hm(x, om[2]);
    const loc = locIn(/\bopen(?:s|ing)?\b[^.?!\d]{0,20}?\b(?:at|from)\s+(\d{1,2})(?::([0-5]\d))?/), each = refs.map(r => pick(x, om[2], r, 'open', loc));
    if (each.every(v => v !== null && v === each[0])) return hm(each[0], om[2]);
    openAsk = (x === 12 ? [0, 12] : [x, x + 12]).map(c => hm(c, om[2])); return null; })() : null;
  return { closeAt, openAt, closeUnsure, closeAsk, openAsk };
}

// THE OWNER'S PLAINEST HOURS, READ BY THE BOX (Oct 23 2026, the walks in maintainer's typing): "were closed mondays now" (answered "We're now
// closed on Mondays" with nothing changed, then put up by the 4B as Friday's late hours moved to Saturday), "open late fri till 1",
// "close early sat at 8". The days open now less the ones closed, or the days named given their own hours (the hour itself from the
// owner's words, in fill). Read over the model's own call too - these shapes are plain, and the model's reading of them was not.
function hoursRead(words, ctx) {
  const s = plainWords(words), h = (ctx && ctx.hours) || {};
  if (/\?/.test(s) || s.split(/\s+/).length > 20 || !Array.isArray(h.openDays) || !h.openTime || !h.closeTime || h.open24Hours) return null;
  // (Oct 24 2026, the messages set on a real Claude) words about TELLING people are not an hours change: "send everyone on the email list
  // a note that we're open late friday till 1am" was put up by this reading as every Friday open to 1 AM, before the model saw it
  if (/\b(?:send|sent|email|e-mail|text|txt|note|newsletter|tell|let (?:everyone|people|them|customers|members|folks) know|announce|post|flyer|message|msg)\b/.test(s)) return null;
  // (Oct 25 2026: "we're not closed on mondays" put up a card closing every Monday; "open til 1am this friday for the tournament" every
  // Friday - SAID NOT and ONE NIGHT, above. Here as well as in the guard every reader goes through, because the action's fill reads
  // these same words over the model's own call; Oct 27 2026: every word a plain weekly one - plainHours)
  const t = saidNot(s) ? null : plainHours(s); if (!t) return null;
  const m = /\bclosed (?:on |every |each )?((?:mon|tues|wednes|thurs|fri|satur|sun)days?(?:\s*(?:,|and|&)\s*(?:mon|tues|wednes|thurs|fri|satur|sun)days?)*)\b/.exec(t);
  if (m && !/\d/.test(t)) {
    // (a day of the week said as such - "mondays", "every monday", "monday now", "from now on"; "closed friday" alone is the model's)
    if (!/days\b/.test(m[1]) && !/\bclosed (?:every|each) /.test(m[0]) && !/\b(?:now|weekly)\b/.test(t)) return null;
    const shut = H.normDays(m[1]) || []; if (!shut.length) return null;
    const open = h.openDays.filter(d => !shut.includes(d)); if (!open.length || open.length === h.openDays.length) return null;
    return { open_time: h.openTime, close_time: h.closeTime, open_days: open };
  }
  // ONE DAY OPEN LATER OR CLOSING EARLIER, SAID PLAINLY ("open late fri till 1", "close early sat at 8" - the 4B asked "Yes / No?"
  // and made nothing, the walk, Oct 23 2026): those days get their own hours, the hour from the owner's words (fill reads it)
  if (!/\d/.test(t) || !/\b(?:open late|close early|close[sd]? at|closing at|stay open|open (?:till|til|until|to|at|from)|(?:till|til|until) \d)/.test(t)) return null;
  const named = H.normDays(((t.match(/\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?\b/g) || [])).join(',')) || [];
  if (!named.length || named.some(d => !h.openDays.includes(d))) return null;
  // ONE WEEKDAY SAID AS A STATEMENT IS ONE DAY (Oct 27 2026, the review of round 2: "we're staying open till 2 saturday", "we are closing
  // at 6 on saturday", "we're open til 1am friday" were each put up as every week - as "we're closed friday" is as often this Friday):
  // a single weekday with nothing that says every week (a plural day, every, each, now, from now on) is read only as the plain command
  // maintainer types - "open late fri till 1", "close early sat at 8", "stay open till 2" - never with a "we" or a "closing" at its head; and a
  // day named only in a label ("only friday: open til 1am") is not the request's
  { const body = t.replace(LABEL, '').replace(LEAD_RE, '').trim();
    const weekly = /\b(?:every|each|weekly|now)\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)days\b|\bweek(?:day|end)s\b/.test(t);
    if (!(body.match(/\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?\b/g) || []).length) return null;
    if (!weekly && !/^(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\s+)?(?:open|close|stay)\b/.test(body)) return null; }
  // (an hour the box would have to pick - "close at 4 on sundays", 4 PM or 4 AM - is the model's to ask, Oct 27 2026; read against the
  // facility's own hours for the days named)
  // (Oct 27 2026, THE BARE-HOUR RULE: one bare closing or opening hour the rule cannot place - "open till 3 on sundays" at a place where an
  // early close and a late night both fit - is read too, and the fill asks the owner which, both to tap; it went to the model)
  const hs = hoursSaid(s, h, named); if ((hs.closeUnsure && !hs.closeAsk) || (!hs.closeAt && !hs.openAt && !hs.closeAsk && !hs.openAsk)) return null;
  // (hours the days have already are no change: "close at 11 on sundays" at a place that closes at 11 was a card changing nothing)
  if (!hs.closeAsk && !hs.openAsk && named.every(d => { const c = (h.dayHours || {})[d] || { open: h.openTime, close: h.closeTime }; return (hs.closeAt || c.close) === c.close && (hs.openAt || c.open) === c.open; })) return null;
  const own = Object.assign({}, h.dayHours || {}); for (const d of named) own[d] = own[d] || { open: h.openTime, close: h.closeTime };
  return { open_time: h.openTime, close_time: h.closeTime, other_hours: Object.entries(own).filter(([, v]) => v).map(([d, v]) => ({ days: [d], open_time: v.open, close_time: v.close })) };
}
// AN EVENT'S TIME, FROM THE OWNER'S WORDS - event_add's fill, and event_edit's for new words (Oct 28 2026, round 2e - the review of round
// 2d; the bare-hour rule's reading of an event, Oct 27 2026, moved here whole so both read it). The public Events page takes these at once
// (no card), so:
//   - THE TIME IS READ ONLY FROM A TIME SHAPE: "at 1", "starts at 6:30", "shotgun at 8", "from 1 to 5", "between 7 and 10", a time with its
//     half said ("9am", "1-5pm", "7 to 10pm"), a range with its part of the day beside it ("7 to 10 tonight", "saturday night 7-10") or
//     right after its day or date ("saturday 1 to 5", "nov 7 1-5"). Never from ages, team sizes, grades, handicaps, places or a date typed
//     with a dash: "the junior clinic for ages 8-14 on nov 7 at 1" went up "8:00 AM - 2:00 PM.", "the couples scramble nov 7 at 6, teams of
//     2-4" as "2:00 PM - 4:00 PM.", "the fall classic 11-7 at 9" as "11:00 AM - 7:00 PM." - the first number pair was read ahead of the
//     "at" the owner gave. A bare number past 12 in a range is an age, never a time ("kids from 8 to 14")
//   - A TIME OR A RANGE THE MODEL ALREADY WROTE IS PUT RIGHT WHOLE: both ends of its range, the words between them kept - "1:00 PM - 5:00
//     PM." stays as it is when right ("1:00 PM - 5:00 PM - 5:00 PM." was what went up, even for a right model and after the owner's own
//     tap: "9:00 PM - 3:00 AM - 3:00 PM."); a start moved by twelve hours moves the model's end with it; a time of the model's on another
//     hour is the model's
//   - EACH ANSWER IS KEPT FOR THE REQUEST, whatever new call its tap makes: the owner's pick from "Which time ...?" (clockSettledNow) and
//     their answer to "Put <title> on your public Events page, or is it a private booking?" (engine.js privateEvent - the time this fill
//     put rode with that question). The two questions were sending each other round: Public tapped, the time asked again, the time tapped,
//     Public asked again - and Private was never taken
//   - AFTER "Private booking - keep it off" nothing of that request goes up in that breath, under any name: refused here, before a time
//     question could be asked for the model's retry (ctx.eventPrivate, set by engine.js privateEvent)
// THE OWNER'S TURNS FOR THE REQUEST IN HAND, AS AN EVENT'S TIME READS THEM (Oct 28 2026, round 2f): each turn as said, except a bare hour or
// range typed to a question about the time ("What time does it start?" - "8", "8 to 11", "8 til 11", "it starts at 8", "around 8ish"), which
// is the start: "at 8", "from 8 to 11". A bare number to any other question ("How many teams?" - "8") is left as said, and is no time
const TIME_Q = /\b(?:what time|which time|what hours|which hours|what times|when (?:does|do|is|will|should|would|are|did|can)|how late|start(?:ing)? time|time (?:does|do|is|should|will|would|are)|start(?:s|ing)? at)\b/i;
const BARE_TIME = /^(?:(?:ok(?:ay)?|um+|uh|so|oh|well|it|its|it's|it'll|they|we|start|starts|starting|start time is|begins?|kicks? off|tees? off|at|@|around|about|from|maybe|like|say|lets say|let's say|probably|prob|i think|i guess|um,)[,\s]+)*(\d{1,2}(?::[0-5]\d)?)(?:\s*(?:-|–|—|to|until|till|til|thru|through)\s*(\d{1,2}(?::[0-5]\d)?))?(?:\s*(?:ish|o'?\s?clock|oclock))?\s*[.!]*$/i;
// A BARE HOUR TO A QUESTION ABOUT THE END IS THE END (Oct 28 2026, round 2g - the reviewer and the critic of round 2f: "What time does it end?",
// "When does it end?", "How late does it run?", "what time will it wrap up?" answered "11" was rewritten "at 11" - a start - so after "put the
// fall scramble on the events page saturday at 8" the model's "Until 11:00 PM." went up "Until 11:00 AM." at once, and a model that wrote no
// time got "Starts at 11:00 AM."). A question about the end and not the start: the bare hour is said "until 11"
const END_Q = /\b(?:end|ends|ending|finish|finishes|finishing|wrap(?:s|ping)? up|be over|is it over|be done|how late|until when|till when|til when|run (?:until|till|til|to)|go (?:until|till|til|to)|last (?:until|till|til))\b/i;
const START_Q = /\b(?:start|starts|starting|begin|begins|beginning|kick(?:s)? off|tee(?:s)? off|shotgun)\b/i;
// (the start's answer typed the ordinary ways round a bare hour - "8 at night", "8 tonight", "8 sharp", "8 please", "8 till close", "8 til late",
// "8, shotgun start", "8 i think", "lets do 8", "8 on saturday", "8 saturday": the hour, with what it says of the half kept - Oct 28 2026, round 2g)
const BARE_AFTER = /^(\d{1,2}(?::[0-5]\d)?)\s*(?:,\s*)?(?:(at night|tonight|tonite|in the evening|in the morning|in the afternoon)|sharp|on the dot|please|pls|plz|thanks|thx|i think|i guess|probably|(?:till|til|until|to) (?:close|closing|late)|shotgun(?: start)?|start|tee ?time|(?:on |this |next )?(?:mon|tues|wed(?:nes)?|thurs?|fri|sat(?:ur)?|sun)(?:day)?)(?:\s*[,.]?\s*(?:please|pls|thanks|thx|i think|sharp))?\s*[.!]*$/i;
const BARE_BEFORE = /^(?:ok(?:ay)?[,\s]+|so[,\s]+|well[,\s]+|um+[,\s]+)*(?:lets do|let's do|lets go with|let's go with|go with|do|make it|we'll do|well do|we will do|how about|hows|how's)\s+(\d{1,2}(?::[0-5]\d)?)(?:\s*(?:ish|o'?\s?clock|oclock))?\s*[.!]*$/i;
// (A RANGE TYPED AS A CORRECTION TO A QUESTION THAT NAMES THE TIME IS THE NEW TIME - Oct 28 2026, round 2h, the critic of round 2g: at the demo
// brain's show-back 'Put "Trivia Night" on your Events page for Fri, Oct 30 at 8 PM?', "make it 7 to 10", "actually 7 to 10", "no, 7 to 10",
// "change it to 7-10", "7 to 10 instead" were read as nothing - a bare range with no day, "at" or "from" before it - so the first turn's stale
// "at 8" was written "Starts at 8:00 PM." and went on the public Events page at once, the owner's correction lost. A whole answer that is a
// bare range, with only a correction's words round it, said to a question that names a time or asks one, is "from 7 to 10" - to a question
// that only names a time, the correction must be said as one ("make it", "actually", "no", "instead" ...): a bare "2 to 4" there may be a count)
const TIME_SHOWN = /\b\d{1,2}(?::[0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.)(?![a-z])|\bnoon\b|\bmidnight\b/i;
const RANGE_FIX = /^((?:(?:no|nah|nope|actually|wait|sorry|ok(?:ay)?|so|um+|uh|well|oh|hmm+)[,\s]+)*(?:(?:make it|make that|change it to|change that to|switch it to|move it to|can we do|could we do|can we make it|can it be|lets do|let's do|lets make it|let's make it|how about|hows|how's|it'?s|its|it should be|should be|i meant|i mean)\s+)?)(?:from\s+)?(\d{1,2}(?::[0-5]\d)?)\s*(?:-|–|—|to|until|till|til|thru|through)\s*(\d{1,2}(?::[0-5]\d)?)(\s*,?\s*(?:instead|then|please|pls|thanks|thx))?\s*[.!?]*$/i;
// (AN END TYPED TO A QUESTION ABOUT THE END IS THE END, HOWEVER IT IS SAID - Oct 28 2026, round 2h, the reviewer of round 2g: only a bare "11"
// was made the end, so "ends at 11", "it ends at 11", "done at 11", "til about 11" to the model's "What time does it end?" were read "at 11" - a
// START - and the model's right "Until 11:00 PM." went on the public Events page "Until 11:00 AM." at once; "11pm", "finishes at 11pm" or
// "midnight" to a model call with no time went up "Starts at 11:00 PM." / "Starts at midnight". To a question about the end and not the start, a
// short answer with one time in it and nothing about a start is "until" that time, its half kept when said)
// (A LENGTH IS NEVER AN END HOUR - Oct 28 2026, round 2i, the reviewer and the critic of round 2h, HIGH: the rule above took any one number in the
// answer, so "about 3 hours", "it runs 2 hours", "it lasts 2 hours", "like 4 hours", "3 hours later" to the model's "What time does it end?" were
// read "until 3" - the model's right "8:00 PM - 11:00 PM." went on the public Events page "8:00 PM - 3:00 PM." at once, an end before its start. A
// number with hours or minutes after it - "3 hours", "2 and a half hours", "90 minutes" - is a length: never the end hour, and not read here (the
// model's own end stands); a length said beside the end - "about 3 hours, ends at 11" - leaves the end as said)
const END_LEN = '(?:\\s*(?:(?:and\\s+)?(?:a\\s+)?half\\s+)?(?:hours?|hrs?|hr|h|minutes?|mins?|min)\\b)';
const END_ONE = new RegExp(`(?<![\\d:$.])(\\d{1,2})(?::([0-5]\\d))?\\s*(am|pm|a\\.m\\.?|p\\.m\\.?)?(?![\\d:a-z])(?!${END_LEN})|\\b(noon|midnight)\\b`, 'gi');
const END_LENGTH = new RegExp(`\\b\\d{1,3}(?:\\.\\d+)?${END_LEN}`, 'gi');
const END_LEN_WORD = /\b(?:hours?|hrs?|hr|minutes?|mins?)\b/i;
const END_SAID = /\b(?:end|ends|ending|done|til|till|until|untill|by|finish(?:es|ed)?|wraps?\s+up|over\s+(?:at|by)|close|closes|closing)\b/i;
// (A BARE RANGE TYPED AT A SHOW-BACK THAT NAMES THE TIME IS THE NEW TIME - Oct 28 2026, round 2i, the reviewer of round 2h: at 'Put "Trivia Night"
// on your Events page for Fri, Oct 30 at 8 PM?', "7 to 10", "7-10" and "7 to 10 please" - no correction word - were read as nothing, the first turn's
// stale "Starts at 8:00 PM." went up at once, or the demo brain's own "7:00 AM to 10:00 AM" - the old start's half - at a place open from 10. A whole
// answer that is a bare range, to a question that shows a time, is the new time - the bare-hour rule (helpers.js clockOf) decides its half; to a
// question that asks a count or an age it is never a time)
const COUNT_Q = /\bhow (?:many|much|old)\b|\bwhat (?:ages?|size)\b/i;
function eventTurns(ctx) {
  const ts = ctx && ctx.inHand && Array.isArray(ctx.inHand.turns) && ctx.inHand.turns.length ? ctx.inHand.turns : [{ said: String((ctx && ctx.newest) || ''), q: '' }];
  return ts.map(t => { const s = String((t && t.said) || ''), q = String((t && t.q) || ''), asked = TIME_Q.test(q) || END_Q.test(q);
    // (the length rule below - first, before any reading of a bare time or range in the answer)
    if (END_Q.test(q) && !START_Q.test(q) && END_LEN_WORD.test(s) && !END_SAID.test(s)) return s;
    const m = asked ? BARE_TIME.exec(s.trim()) : null, hour = (x) => Number(String(x).split(':')[0]) >= 1 && Number(String(x).split(':')[0]) <= 12;
    if (m && hour(m[1])) return m[2] ? `from ${m[1]} to ${m[2]}` : END_Q.test(q) && !START_Q.test(q) ? `until ${m[1]}` : `at ${m[1]}`;
    if (asked || TIME_SHOWN.test(q)) { const f = RANGE_FIX.exec(s.trim()); if (f && hour(f[2]) && hour(f[3]) && (asked || f[1].trim() || /instead|then/i.test(f[4] || '') || !COUNT_Q.test(q))) return `from ${f[2]} to ${f[3]}`; }
    // (A LENGTH IN ANY FORM IS A LENGTH - Oct 28 2026, the review of round 2i, HIGH: round 2i skipped only the number with "hours" right after it,
    // so a length said as a range, a choice or a decimal - "2-3 hours", "2 to 3 hours", "2 or 3 hours", "1.5 hours", "2 hours, maybe 3" - had its
    // first number read as the end hour and the model's right "8:00 PM - 11:00 PM." went up "8:00 PM - 2:00 PM." at once. To the end question, an
    // answer that names hours or minutes is a length - read neither as an end nor as a range - unless an end word is said too ("about 3 hours, ends
    // at 11" is still the end))
    if (END_Q.test(q) && !START_Q.test(q)) {
      const tt = s.trim(), ms = [...tt.matchAll(END_ONE)];
      if (ms.length === 1 && tt.split(/\s+/).length <= 8 && !/\b(?:start|starts|starting|begin|begins|doors?|kick|kicks|tee|tees|shotgun)\b/i.test(tt) && !/\d/.test(tt.replace(ms[0][0], ' ').replace(END_LENGTH, ' '))) {
        const e = ms[0];
        if (e[4]) return `until ${e[4].toLowerCase()}`;
        if (hour(e[1])) return `until ${e[1]}${e[2] ? ':' + e[2] : ''}${e[3] ? e[3][0].toLowerCase() + 'm' : /\b(?:at night|tonight|tonite|in the evening)\b/i.test(tt) ? 'pm' : /\bin the morning\b/i.test(tt) ? 'am' : ''}`;
      }
    }
    // (the start's question only - "What time does it start?", "When is it?" - never one about the end)
    if (!asked || (END_Q.test(q) && !START_Q.test(q))) return s;
    const a = BARE_AFTER.exec(s.trim()) || BARE_BEFORE.exec(s.trim());
    if (!a || !hour(a[1])) return s;
    const half = a[2] ? (/morning/i.test(a[2]) ? 'am' : 'pm') : '';
    // (the day said with it stays: "8 on saturday" is "at 8 on saturday")
    const day = /(?:mon|tues|wed(?:nes)?|thurs?|fri|sat(?:ur)?|sun)(?:day)?\s*[.!]*$/i.exec(s.trim());
    return `at ${a[1]}${half}` + (day ? ' ' + day[0].replace(/[.!]+$/, '') : '') + (/(?:till|til|until|to) (?:close|closing|late)/i.test(s) ? ' till close' : '');
  });
}
// o: { key: the call's own words ('description' for event_add, 'words' for event_edit), title: the event's name, date: its date }
function eventWhen(a, ctx, o) {
  const key = o.key, edit = key === 'words';
  if (ctx.eventPrivate && (!edit || a.title !== undefined)) throw new ActionError(`the owner just said "${ctx.eventPrivate}" is a private booking - nothing of it goes on the public Events page, under any name: ask what they want for it instead (a bay blocked off with block_add, or a booking in their name with booking_make), or leave it`);
  if (ctx.clockSettledNow) return a;   // (the owner picked it from the box's own question)
  if (ctx.answeredParam && ctx.answeredParam.get(ctx.clockCallId) === '__public') return a;   // (the owner's Public tap: what was read rode with it)
  if (edit && a.words === undefined) return a;   // (an edit that keeps the event's words changes no time)
  // THE REQUEST IN HAND, TURN BY TURN (Oct 28 2026, round 2f - the critic of round 2e, HIGH: only the newest words were read for the model's own
  // call, so "put the fall scramble on the events page saturday", the model's "What time does it start?", then "8" - and "... saturday at 8", the
  // model's "Would you like a description?", then "no thats it" - put the model's 8 AM on the public Events page at once, even at a place that
  // opens at 10. Now the request in hand (engine.js requestInHand - every guard's), the newest turn's time first; and a bare "8", "8 to 11" or
  // "it starts at 8" typed to a question about the time is the start, as said "at 8" / "from 8 to 11". An answer the owner's tap finished reads
  // the request as it was asked (ctx.heard), as before)
  const answeredNow = !!(ctx.heard && ctx.answeredIds && ctx.answeredIds.has(ctx.clockCallId));
  // (a comma between the day and its time is no stop: "trivia friday, 7 to 10", "the halloween scramble saturday, 1-5" - Oct 28 2026)
  const unComma = (s) => String(s || '').replace(/\b((?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|tues|thu|thur|thurs|fri|sat|sun|weekends?|weekdays?|weeknights?|today|tonight|tonite|tomorrow|\d{1,2}(?:st|nd|rd|th)),\s*(?=(?:from\s+|at\s+|around\s+|about\s+)?\d)/gi, '$1 ');
  const turnsSaid = (answeredNow ? [String(ctx.heard || '')] : eventTurns(ctx)).map(unComma);
  const w = turnsSaid.join(' ; ');
  const SAID = '(?:\\d{1,2}(?::[0-5]\\d)?\\s*(?:am|pm)\\b|\\d{1,2}(?::[0-5]\\d)?[ap]\\b|noon|midnight)', NUM = `(${SAID}|\\d{1,2}(?::[0-5]\\d)?)`, TO = '\\s*(?:-|–|—|to|until|till|til|thru|through)\\s*';
  // (and never a count of balls, rounds, weeks or games: "saturday 4 ball scramble", "thursday 6 week league" - Oct 28 2026)
  const NOT = '(?![\\d:/])(?!\\s*(?:%|(?:hours?|hrs?|h|minutes?|mins?|people|players?|persons?|man|somes|teams?|guests?|golfers?|kids|juniors|bays?|holes?|dollars|bucks|years?|yrs?|olds?|yo|grades?|graders|places?|handicaps?|hcp|spots?|slots?|seats?|tables?|st|nd|rd|th|x|of|balls?|rounds?|weeks?|months?|games?|flights?|sessions?|lessons?|innings?|weeknights?)\\b))';
  const LB = '(?<![\\d:.$/#a-z]|\\d-|\\b(?:ages?|aged|grades?|teams? of|handicaps?|hcp|top|kids|children|juniors|boys|girls|students|levels?|players|golfers|groups? of)\\s)';
  // (a weekday said every week - "mondays", "weekends", "weeknights" - a holiday and "the 31st" are its day too: "league night thursdays 7-10",
  // "the winter league mondays 6-9", "kids camp weekends 9-12", "the scramble halloween 1-5", "a scramble on the 31st 1-5" were no reading at
  // all, and a wrong model's morning went up at once - Oct 28 2026, round 2f)
  const DAYS = '(?:today|tonight|tonite|tomorrow|(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)days?|mon|tue|tues|thu|thur|thurs|fri|sat|sun|weekdays?|weekends?|weeknights?|halloween|thanksgiving|christmas(?: eve)?|new years?(?: eve)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}/\\d{1,2}|the \\d{1,2}(?:st|nd|rd|th))';
  const RANGES = [`\\b(?<!\\b(?:ages?|aged|kids|children|juniors|boys|girls|students|grades?|levels?|players|golfers)\\s)(?:from|between)\\s+${NUM}(?:${TO}|\\s+and\\s+)${NUM}${NOT}`,
    `${LB}(${SAID})${TO}${NUM}${NOT}`, `${LB}${NUM}${TO}(${SAID})${NOT}`,
    `${LB}${NUM}${TO}${NUM}(?=\\s+(?:at night|in the (?:morning|afternoon|evening)|tonight|tonite|that (?:night|evening)))`,
    `\\b(?:tonight|tonite|nights?|nites?|evenings?|mornings?|afternoons?)\\s+(?:from\\s+)?${NUM}${TO}${NUM}${NOT}`, `\\b${DAYS}\\s+${NUM}${TO}${NUM}${NOT}`,
    // (a range after "at" - "saturday at 1 to 5" lost its end; and a range just before its day - "the scramble 1 to 5 on saturday", "trivia
    // 7-10 friday": Oct 28 2026, round 2f)
    `\\b(?:at|@|starts?(?:\\s+at)?|starting(?:\\s+at)?|runs?|running|goes|going)\\s+${NUM}${TO}${NUM}${NOT}`,
    `${LB}${NUM}${TO}${NUM}${NOT}(?=\\s+(?:on\\s+|this\\s+|next\\s+|every\\s+)*${DAYS}\\b)`];
  const MARK = 'at|@|starts?(?:\\s+at)?|starting(?:\\s+at)?|begins?(?:\\s+at)?|kicks? off(?:\\s+at)?|tees? off(?:\\s+at)?|shotgun(?:\\s+start)?(?:\\s+at)?|around|about|from|approx(?:imately)?' + (edit ? '|to' : '');
  const bare = (t) => /^\d{1,2}$/.test(String(t).trim()) && (Number(t) > 12 || Number(t) === 0);   // (a bare 13 or 0 is an age or a count)
  const first = (res, W) => res.map((src, k) => { for (const m of W.matchAll(new RegExp(src, 'g'))) { const g = m.slice(1).filter(x => x !== undefined); if (g.every(x => !bare(x))) return { i: m.index, g, k }; } return null; }).filter(Boolean).sort((x, y) => x.i - y.i)[0] || null;
  // (a time said with its half and no word before it - "nov 8 9am" - is its start too; never one said as an end: "done by 5pm", "till 11pm")
  // (a bare start right after its day - "trivia thursday 7", "thursday 7 oclock"; "around 7", "about 7", "from 7" - and an edit's "move the fall
  // classic to 9": each was no reading, and a wrong model's 7 AM or 9 AM went up at a place open from 10 - Oct 28 2026, round 2f)
  // (A BARE NUMBER RIGHT AFTER THE DAY IS ITS TIME ONLY WHEN NOTHING AFTER IT MAKES IT A COUNT OR A PRICE - Oct 28 2026, round 2g, the reviewer and
  // the critic of round 2f: "add trivia friday 2 for 1 drinks" went up "Starts at 2:00 PM.", "karaoke friday 2 dollar drafts" 2 PM, "league
  // night thursday 5 dollar pitchers" 5 PM, "the scramble saturday 2 per team" 2 PM, "a scramble saturday 1 mulligan each" 1 PM - an invented
  // start on the public Events page at once - and "ladies night thursday 1 free drink" was asked 1 AM or 1 PM. A bare number after the day is a
  // time when it ends the words or a part of them, or "sharp", "oclock", "ish", "start", "shotgun", "till close", the half of the day, or a
  // small word that goes on ("on", "at", "with", "and", "every", "for 2 hours", "for the members" - never "for 1", "for $5") follows it; a time
  // said with its half is a time wherever it stands)
  // (NARROWED TO WHAT MAKES IT A COUNT OR A PRICE - Oct 28 2026, round 2h, the reviewer and the critic of round 2g: the rule above was built as a
  // short list of the words that may follow the time, so every ordinary word after it took the time away - "add trivia friday 7 $5 entry", "7 free
  // entry", "7 bring a team", "7 everyone welcome", "7 doors at 6:30", "karaoke friday 9 no cover", "league night tuesday 6 sign up at the front"
  // read no time, and a model's wrong 7 AM went on the public Events page at once - and with the demo brain, which drops a time it cannot read,
  // each went up with no time at all. The number after the day is its time unless what follows it makes it a count or a price, as round 2g's own
  // cases are: "for 1" / "for $5" (never "for 2 hours"), "dollar(s)", "bucks", "per", "each" / "apiece" within two words, "x", or a free, extra
  // or bonus thing counted - "1 free drink", "3 free rounds" (the thing agreeing with the number: "7 free entry" is 7 o'clock))
  const DAY_AT = `(?!\\s*(?:for\\s*(?:\\$|a\\s+\\d|(?:\\d+|one|two)\\b(?!\\s*(?:hours?|hrs?|minutes?|mins?)\\b))|(?:dollars?|bucks?|cents?|per|each|apiece|ea|x)\\b|(?:[a-z']+\\s+){1,2}(?:each|per|apiece|a piece)\\b|(?:free|extra|bonus)\\s+[a-z']+s\\b)|(?<=(?:^|[^\\d:])1)\\s+(?:free|extra|bonus)\\s+[a-z])`;
  // (and "at", "around", "about" said after an end's own word - "ends at 11", "done at 11", "til about 11", "finishes around 11" - is the end, never
  // the start: it was the start, so the model's right "Until 11:00 PM." went up "Until 11:00 AM." - Oct 28 2026, round 2h, the reviewer of round
  // 2g; the same words a time said with its half already stood aside for)
  const END_BEFORE = '(?<!\\b(?:until|untill|till|til|by|before|to|thru|through|ends?|ending|ended|done|finish(?:es|ed|ing)?|wraps?\\s+up|wrapping\\s+up|over|close[sd]?|closing|after|past)\\s+)';
  const ATS = [`${END_BEFORE}\\b(?:${MARK.replace(/\|to$/, '')})\\s+${NUM}${NOT}(?!${TO}\\d)`, `(?<![\\d:.$/#a-z])(?<!\\b(?:until|untill|till|til|by|before|to|thru|through|ends?|ending|done|close[sd]?|closing|after|past)(?:\\s+at)?\\s*)(${SAID})${NOT}`,
    `\\b${DAYS}\\s+(?:(${SAID})${NOT}|(\\d{1,2}(?::[0-5]\\d)?)${NOT}${DAY_AT})(?!${TO}\\d)`].concat(edit ? [`\\b(?:move|moved|moving|push|pushed|bump|bumped|change|changed|switch|switched|shift|shifted|reschedule|rescheduled|make|made)\\b[^.;!?]{0,40}?\\bto\\s+${NUM}${NOT}(?!${TO}\\d)`] : []);
  // (A BARE RANGE BESIDE THE DAY OF A KIDS', A JUNIORS' OR A YOUTH EVENT MAY BE THE AGES - Oct 28 2026, round 2g: "add a kids camp 6-10 saturday"
  // went up "6:00 PM - 10:00 PM.", "add a junior clinic 8-12 saturday" with the model's "For ages 8-12." as "8:00 PM - midnight (12:00 AM). For
  // ages 8-12." - two readings, so the box reads neither: the model's own words stand. A range that starts at an age a child can be (4 and up),
  // or one the model's own words call the ages, is not read; "kids camp weekends 1-5" is still 1 PM to 5 PM; and said with its half, after "from",
  // "at" or a part of the day - "kids camp saturday 9am-noon", "from 9 to 12" - it is the time, as before)
  const YOUTH = /\b(?:kids?|kid's|children|child|junior|juniors|jr|youth|teens?|teenagers?|boys|girls|students|ages?|aged|grades?|u\d{1,2})\b/i;
  const agesSaid = /\b(?:ages?|aged|grades?)\b/i.test(typeof a[key] === 'string' ? a[key] : '');
  // (NARROWED TO THE RANGE BETWEEN THE NAME AND ITS DAY - Oct 28 2026, round 2h, the reviewer and the critic of round 2g: a range AFTER the day was
  // set aside too, and at a golf facility that is nearly always the time - "add a junior clinic saturday 10-12", "junior league tuesday 4-6", "kids
  // night friday 6-9", "teen night friday 7-10", "kids halloween party saturday 4-6", "youth clinic saturday 9-11" went on the public Events page
  // at once with a wrong model's morning, or with no time at all on the demo brain. A youth event's range is read as the ages only where round
  // 2g's own cases put it - between the event's name and its day, "a kids camp 6-10 saturday" - or where the model's own words call it the ages;
  // after the day it is the time, as before round 2g; and the owner's own words that call those same numbers the ages - "add a junior clinic
  // saturday 8-12, for ages 8-12" - are the ages too. One shape after the day keeps round 2g's reading: a range that ends at a bare 12 - "the kids
  // camp saturday 9-12" - reads three ways (the ages, the morning, the night: a bare 8, 9 or 10 before a bare 12 is said for the morning as often
  // as for the night - rangeIn's own rule), so with no time of the model's own on the event the box writes none; with one - "Starts at 10:00
  // PM." for "a junior clinic saturday 10-12" - the range is read, put right or asked)
  const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const agesOwn = (x) => x.g.length === 2 && new RegExp(`\\b(?:ages?|aged|grades?)\\s+(?:of\\s+|from\\s+)?${esc(x.g[0])}\\s*(?:-|–|—|to|thru|through)\\s*${esc(x.g[1])}(?![\\d:])`, 'i').test(w);
  const modelTimed = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\bmidnight\b|\bnoon\b/i.test(typeof a[key] === 'string' ? a[key] : '');
  // (A RIGHT MODEL'S MORNING IS NEVER MOVED TO THE NIGHT - Oct 28 2026, round 2i, the reviewer and the critic of round 2h: with a time of the model's
  // on the event the range was read, and the rule's evening - which "fits" a range that ends at midnight even at a place that closes at 11 - put a
  // right "9:00 AM - 12:00 PM." for "add a kids camp saturday 9-12" on the public Events page as "9:00 PM - midnight (12:00 AM).", past closing;
  // "junior clinic saturday 8-12" over the model's 8 AM the same, and a right 10 AM "youth clinic saturday 10-12" was asked. Where the model's own
  // time is the morning, the range is read only when its evening runs within the facility's hours - open at its start and still open at midnight;
  // else the model's words stand, as with no time of the model's)
  const modelMorning = (() => { const m = /\b(\d{1,2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)/i.exec(typeof a[key] === 'string' ? a[key] : ''); return !!m && /^a/i.test(m[2]) && Number(m[1]) !== 12; })();
  const nightFits = (x) => { const h = (ctx && ctx.hours) || null, d = normDate(o.date, ctx.today), wd = d ? DAY_KEYS[new Date(d + 'T12:00:00Z').getUTCDay()] : null;
    const n = H.clockNum(String(x.g[0])); if (!h || !n || n.said) return false;
    return H.clockFits('at', { s: n.v % 720 + 720 }, h, wd) === true && H.clockFits('loneEnd', { e: 1439 }, h, wd) === true; };
  const toTwelve = (x) => x.k === 5 && String(x.g[1]) === '12' && Number(String(x.g[0]).split(':')[0]) >= 4 && (!modelTimed || (modelMorning && !nightFits(x)));
  const pick = (Wk) => { const x = first(RANGES, Wk); if (x && YOUTH.test(Wk) && ((x.k === 7 && Number(String(x.g[0]).split(':')[0]) >= 4) || ((x.k === 5 || x.k === 7) && (agesSaid || agesOwn(x))) || toTwelve(x))) return first(RANGES.map((src, k) => (k === 5 || k === 7 ? '(?!)' : src)), Wk); return x; };
  let r = null, at = null;
  for (let k = turnsSaid.length - 1; k >= 0 && !r && !at; k--) { const Wk = H.clockWords(turnsSaid[k]); r = pick(Wk); at = r ? null : first(ATS, Wk); }
  // (the end typed to the model's own question about the end - "until 11", eventTurns - closes the start said before it: "saturday at 8", "What
  // time does it end?", "11" is 8 to 11, read by the one rule - Oct 28 2026, round 2g)
  // (and with its half said, or noon or midnight - "ends at 11pm", "midnight": Oct 28 2026, round 2h)
  let endTyped = false;
  if (at && !r) { const e = turnsSaid.map(x => /^until (\d{1,2}(?::[0-5]\d)?(?:am|pm)?|noon|midnight)$/.exec(x)).filter(Boolean).pop(); if (e) { r = { i: at.i, g: [at.g[0], e[1]] }; at = null; endTyped = true; } }
  if (!r && !at) return a;
  const face = (t) => { const n = H.clockNum(t); return n ? H.clockHm(n.said ? n.v : n.v % 720) : null; };
  const spec = r ? { start: face(r.g[0]), end: face(r.g[1]) } : { start: face(at.g[0]) };
  if (!spec.start || (r && !spec.end)) return a;
  const n0 = H.clockNum(r ? r.g[0] : at.g[0]), n1 = r ? H.clockNum(r.g[1]) : null;
  const day = (() => { const d = normDate(o.date, ctx.today); return d ? DAY_KEYS[new Date(d + 'T12:00:00Z').getUTCDay()] : null; })();
  // (said with its half - "9am", "1pm to 5pm": as said; the half said once, or none, by the one rule)
  // (an end said with its half - "11pm", "midnight" - typed to the end's question closes the start said before it: the start's half is the one
  // that ends within twelve hours, as the box's own "pm, until 11pm" reads - Oct 28 2026, round 2h: "saturday at 8", "What time does it end?",
  // "11pm" went up "8:00 PM - 11:00 AM.", the end moved with the start)
  const closes = endTyped && n0 && !n0.said && n1 && n1.said ? [n0.v % 720, n0.v % 720 + 720].filter(s => { const d = (n1.v - s + 1440) % 1440; return d > 0 && d <= 720; }) : [];
  let read = n0 && n0.said && (!r || (n1 && n1.said)) ? { set: { start: H.clockHm(n0.v), end: r ? H.clockHm(n1.v) : undefined } }
    : closes.length === 1 ? { set: { start: H.clockHm(closes[0]), end: H.clockHm(n1.v % 1440) } }
    : H.clockOf(w, spec, (ctx && ctx.hours) || null, { name: o.title, day, markers: MARK });
  if (!read) return a;
  // (THE HALF A SHOW-BACK SAID IS THE OWNER'S WHEN THEY WENT ON FROM IT - Oct 28 2026, round 2i, the critic of round 2h: at a place open 6 AM to
  // 11:30 PM the demo brain showed the party back 'Put "Retirement Party" on your Events page for Fri, Oct 30 at 6 PM?', the owner tapped Yes, and
  // the box asked "6 AM, or 6 PM?" all the same - an edit shown back "saying ... 7:00 PM" the same. Where the one rule would ask (both halves fit),
  // and the owner's newest words - no time of their own - answered a question that showed one of the two readings with its half, that reading is
  // the one they agreed to: never asked again. Never the box's own "Which time ...?" (both shown), never where the rule is certain, never a
  // reading that runs past the facility's hours - open at its start and, with an end, still open just before it ("10 PM to midnight" shown back at a
  // place that closes at 11 is still asked) - and never a morning: a show-back's morning for a bare 8 to 11 is the demo brain's own default, not
  // the owner's (round 2h's "Company Party ... at 8 AM?" - a party at 8 is never taken for the morning by a Yes; it is asked, F76))
  if (read.ask && !answeredNow) {
    const ts = ctx.inHand && Array.isArray(ctx.inHand.turns) ? ctx.inHand.turns : [], last = ts[ts.length - 1], q = String((last && last.q) || '');
    if (last && !last.hoursAnswer && !/\d|\bnoon\b|\bmidnight\b/i.test(String(last.said || '')) && TIME_SHOWN.test(q)) {
      const shown = [...q.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])|\bnoon\b|\bmidnight\b/gi)].map(m => (m[1] ? (Number(m[1]) % 12 + (/^p/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2] || 0) : /noon/i.test(m[0]) ? 720 : 0));
      const h = (ctx && ctx.hours) || null, within = (c) => !!h && H.clockFits('at', { s: H.clockMin(c.start) }, h, day) === true
        && (!c.end || H.clockFits('loneEnd', { e: (H.clockMin(c.end) + 1439) % 1440 }, h, day) === true);
      const hit = read.ask.filter(c => H.clockMin(c.start) === shown[0]);
      if (hit.length === 1 && H.clockMin(hit[0].start) >= 720 && within(hit[0]) && !read.ask.every(c => shown.includes(H.clockMin(c.start)))) read = { set: hit[0] };
    }
  }
  const say = (t) => (t === '00:00' ? 'midnight (12:00 AM)' : t === '12:00' ? 'noon (12:00 PM)' : timeWords(t));
  const when = (x) => (x.end ? `${say(x.start)} - ${say(x.end)}.` : `Starts at ${say(x.start)}.`);
  // (the model's own time in its words: its first time - with the one after it when the two are a range - on the owner's start's face is
  // put right whole; a first time on another hour is the model's, and its words are left as they are)
  const desc = typeof a[key] === 'string' ? a[key] : '';
  const T = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)|\bmidnight\b(?:\s*\(12:00 AM\))?|\bnoon\b(?:\s*\(12:00 PM\))?/gi;
  const toks = [...desc.matchAll(T)].map(m => ({ i: m.index, j: m.index + m[0].length, v: m[1] ? (Number(m[1]) % 12 + (/^p/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2] || 0) : /noon/i.test(m[0]) ? 720 : 0 }));
  const t0 = toks[0], t1 = t0 && toks[1] && /^\s*(?:-|–|—|to|until|till|til|thru|through|and)\s*$/i.test(desc.slice(t0.j, toks[1].i)) ? toks[1] : null;
  // (the model's words that open with the END of the owner's range - "Until 11:00 PM.", "Ends at 11:00 PM." - have that end put right, never
  // taken for the start: Oct 28 2026, round 2g)
  const endFirst = !!(r && t0 && !t1 && spec.end && t0.v % 720 === H.clockMin(spec.end) % 720 && t0.v % 720 !== H.clockMin(spec.start) % 720);
  if (t0 && t0.v % 720 !== H.clockMin(spec.start) % 720 && !endFirst) return a;
  // (A TIME IN THE MODEL'S WORDS WITH NO HALF ON IT IS STILL ITS TIME - Oct 28 2026, round 2i, the critic of round 2h, HIGH: the demo brain says a
  // party's bare "at 8" as the owner said it - "Company Party starts at 8." - and the box, finding no time with its half there, put its own in
  // front: "Starts at 8:00 PM. Company Party starts at 8." went on the public Events page at once, and after "actually 9" at the show-back
  // "Starts at 8:00 PM. Company Party starts at 9." - two different times. The box's own time goes in front only when the words hold no time at
  // all: a bare start in them ("at 8", "from 8 to 11", "starts at 9") on the owner's start's face has the half put on it where it stands; one
  // on another hour is the model's, and its words are left as they are - never asked about the start they no longer hold)
  // ("Doors open at 7, shotgun at 8." - the one on the owner's start's face is the start; a bare time only on other hours leaves the words as they are)
  const BARE_IN = new RegExp(`\\b(?:at|@|from|starts?(?:\\s+at)?|starting(?:\\s+at)?|begins?(?:\\s+at)?|runs?\\s+from)\\s+(\\d{1,2})(?::([0-5]\\d))?(?:\\s*(?:-|–|—|to|until|till|til|thru|through)\\s*(\\d{1,2})(?::([0-5]\\d))?)?${NOT}`, 'gid');
  const bts = t0 ? [] : [...desc.matchAll(BARE_IN)].filter(b => Number(b[1]) >= 1 && Number(b[1]) <= 12 && (!b[3] || (Number(b[3]) >= 1 && Number(b[3]) <= 12)));
  const bh = bts.find(b => (Number(b[1]) % 12) * 60 + Number(b[2] || 0) === H.clockMin(spec.start) % 720) || null;
  if (bts.length && !bh) return a;
  const splice = (s, list) => list.slice().sort((x, y) => y.i - x.i).reduce((acc, x) => acc.slice(0, x.i) + x.to + acc.slice(x.j), s);
  const put = (x) => {
    const S = H.clockMin(x.start), E = x.end ? H.clockMin(x.end) : null;
    let out;
    if (endFirst) out = E === null || t0.v % 1440 === E % 1440 ? desc : splice(desc, [{ i: t0.i, j: t0.j, to: say(x.end) }]);
    else if (!t0 && bh) {
      const sAt = { i: bh.indices[1][0], j: (bh.indices[2] || bh.indices[1])[1] };
      if (bh[3]) { let e = (Number(bh[3]) % 12) * 60 + Number(bh[4] || 0); while (e <= S) e += 720;
        out = splice(desc, [Object.assign(sAt, { to: say(x.start) }), { i: bh.indices[3][0], j: (bh.indices[4] || bh.indices[3])[1], to: say(E !== null ? x.end : H.clockHm(e)) }]); }
      else out = splice(desc, [Object.assign(sAt, { to: E !== null ? `${say(x.start)} - ${say(x.end)}` : say(x.start) })]);
    }
    else if (!t0) out = (when(x) + (desc ? ' ' + desc : ''));
    else if (E !== null && t1) out = t0.v === S && t1.v % 1440 === E % 1440 ? desc : splice(desc, [{ i: t0.i, j: t0.j, to: say(x.start) }, { i: t1.i, j: t1.j, to: say(x.end) }]);
    else if (E !== null) out = splice(desc, [{ i: t0.i, j: t0.j, to: `${say(x.start)} - ${say(x.end)}` }]);
    else if (t1) out = t0.v === S ? desc : splice(desc, [{ i: t0.i, j: t0.j, to: say(x.start) }, { i: t1.i, j: t1.j, to: say(H.clockHm(t1.v + (S - t0.v))) }]);
    else out = t0.v === S ? desc : splice(desc, [{ i: t0.i, j: t0.j, to: say(x.start) }]);
    return out === desc ? a : Object.assign({}, a, { [key]: out.slice(0, 2000) });
  };
  if (read.set) return put(read.set);
  const [m0, k0] = read.ask, nm = o.title || 'the event';
  return Object.assign({}, a, { [H.CLOCK_ASK]: { why: `which time ${nm} starts is not plain - the box asks`, param: '*', question: `${read.single ? 'Which time' : 'Which hours'} for ${nm} - ${read.labels[0]}, or ${read.labels[1]}?`, choices: read.labels,
    values: [{ [key]: put(m0)[key] }, { [key]: put(k0)[key] }], spans: [[m0.start, m0.end || m0.start], [k0.start, k0.end || k0.start]], parse: 'ampm', single: !!read.single } });
}
const ACTIONS = [
  // ── reads ───────────────────────────────────────────────────────────────
  { name: 'schedule_read', kind: 'read', say: 'Look at the staff schedule: who works when, open shifts, requests waiting for you, and hours nobody covers',
    params: { type: 'object', properties: { start: DATE, end: DATE }, required: ['start'] },
    needs: ['roster'],
    request: (a) => ({ method: 'GET', path: `/api/staff/schedule?start=${a.start}&end=${a.end && a.end >= a.start ? a.end : a.start}` }),
    digest: (j, ctx) => ({
      shifts: (j.shifts || []).map(s => ({ shift_id: s.id, date: s.date, from: s.start_time, to: s.end_time, who: s.staff_code ? (rosterName(ctx, s.staff_code) || 'someone no longer on the roster') : 'OPEN - nobody yet', label: s.label || undefined })),
      requests_waiting: (j.pendingReq || []).length + (j.pendingTimeoff || []).length,
      hours_nobody_covers: j.uncoveredCount || 0 }) },
  { name: 'staffed_read', kind: 'read', say: 'Look at which days have someone at the counter (staffed days)',
    params: { type: 'object', properties: { from: DATE, to: DATE } },
    request: (a, ctx) => ({ method: 'GET', path: `/api/website/staffed?from=${a.from || ctx.today}&to=${a.to || addDays(a.from || ctx.today, 30)}` }),
    // (each day with its weekday and its hours in words, read rather than worked out - the facility walk, Oct 25 2026: "2026-10-31,
    // 10:00 to 22:00" left a small model to work out the Saturday and the 10 PM itself)
    digest: (j) => { const days = (j.staffed || []).map(d => ({ day: dayWords(d.date), hours: d.start_time && d.end_time ? `${timeWords(d.start_time)} - ${timeWords(d.end_time)}` : 'all day', note: d.note || undefined }));
      return { staffed_days: days.length ? days : 'no staffed days in that time - door codes only' }; } },
  { name: 'roster_read', kind: 'read', say: 'Look at who is on the staff roster',
    params: { type: 'object', properties: {} },
    request: () => ({ method: 'GET', path: '/api/staff/roster' }),
    digest: (j) => ({ staff: (j.staff || []).filter(s => s.active !== false).map(s => s.name) }) },
  { name: 'setup_status', kind: 'read', say: 'See which setup steps are done and which are still to do',
    params: { type: 'object', properties: {} },
    request: () => ({ method: 'GET', path: '/api/admin/setup-status' }),
    digest: (j) => j },
  // SET UP BY TALKING (Oct 20 2026, late; maintainer: "we want it to basicly replace the wizard"): the first screen took
  // the step-by-step setup's defaults for the hours, the bays, the price and waivers, and the checklist carries each until the
  // owner says it is right - or changes it through the assistant (those changes tick it too)
  // (maintainer, Oct 22 2026: "they can skip twilio or something but it reminds them later") a step put off stays on the checklist, and the
  // box reminds the owner when they next open the chat (setupguide.js)
  { name: 'setup_skip', kind: 'write', confirm: false, say: 'Put a setup step off for now when the owner says to skip it ("skip texting", "do the logo later") - it stays on the setup checklist and the box reminds the owner later',
    params: { type: 'object', properties: { item: { type: 'string', enum: ['citystate', 'domain', 'confirmbays', 'access', 'confirmhours', 'hours', 'staffedhours', 'confirmprice', 'wfrate', 'confirmwaiver', 'waiverdoc', 'mwaiver', 'tier', 'checkin', 'stripe', 'resend', 'twilio', 'branding', 'backuppass', 'staffedcopy', 'golive', 'event'] } }, required: ['item'] },
    build: (a, ctx) => ({ op: 'config', set: [['setupSkipped.' + a.item, (ctx && ctx.today) || new Date().toISOString().slice(0, 10)]] }),
    describe: (a) => `Skipped for now: ${((require('./setupguide').BY_ID.get(a.item) || {}).name) || a.item} - I will remind you later` },
  { name: 'setup_confirm', kind: 'write', confirm: false, say: 'Tick one of the setup checklist\'s starting answers when the owner says it is right: hours, bays, price (a change made through the assistant ticks it by itself). Waivers are waiver_mode_set - the owner chooses',
    params: { type: 'object', properties: { item: { type: 'string', enum: ['hours', 'bays', 'price'] } }, required: ['item'] },
    build: (a) => ({ op: 'config', set: [['setupAck.' + a.item, true]] }),
    describe: (a) => `Your ${({ hours: 'opening hours', bays: 'bays', price: 'price' })[a.item]} - marked right on your setup checklist` },
  // the waiver choice is the owner's (rule 15: the software records, it never advises) - asked, never suggested
  { name: 'waiver_mode_set', kind: 'write', confirm: true, say: 'Set whether customers sign the facility\'s waiver: required (must be signed to play), optional (offered, never blocks a booking) or off - the owner\'s answer to the waiver question, even one word ("required", "optional", "none"), is this call. The owner decides - never suggest which; their own lawyer writes or reviews their waiver document',
    params: { type: 'object', properties: { mode: { type: 'string', enum: ['required', 'optional', 'off'] } }, required: ['mode'] },
    build: (a) => ({ op: 'config', set: [['waiver.mode', a.mode], ['setupAck.waiver', true]] }),
    describe: (a) => ({ required: 'Waivers required - each customer signs before they play. Upload your waiver document on the Waivers tab; have a lawyer licensed in your state write or review it', optional: 'Waivers offered - shown to customers, never blocking a booking. Upload your waiver document on the Waivers tab', off: 'Waivers off - nobody is asked to sign one' })[a.mode] },
  // THE WAIVER POLICY'S OTHER CHOICES (Oct 20 2026, latest - the wizard handed to the assistant): how waivers are collected,
  // how long a membership waiver lasts, and a member's guests - the values the Waiver Policy card (Admin > Waivers) and the
  // wizard's Hours step save. Choices only (A1): the owner's, never suggested; their own lawyer reviews their document
  { name: 'waiver_policy_set', kind: 'write', confirm: true, say: 'Set how the facility\'s waivers work - each the owner\'s choice, never suggested: how they are collected (online during booking, at the door by staff, or automatic - at the door when someone is there, online otherwise), how long a membership waiver lasts (the life of the membership, or a year then re-sign), and a member\'s guests (covered by the member\'s waiver, or each guest signs the one-day waiver at check-in)',
    params: { type: 'object', properties: { collection: { type: 'string', enum: ['online', 'door', 'auto'] }, membership_term: { type: 'string', enum: ['membership', 'annual'] }, guests: { type: 'string', enum: ['member', 'each'] } } },
    build: (a) => {
      const set = [];
      if (a.collection) set.push(['waiver.collection', a.collection]);
      if (a.membership_term) set.push(['waiver.membershipTerm', a.membership_term]);
      if (a.guests) set.push(['waiver.guests', a.guests]);
      if (!set.length) throw new ActionError('say which: how waivers are collected, how long a membership waiver lasts, or a member\'s guests');
      return { op: 'config', set };
    },
    describe: (a) => {
      const W = { online: 'signed online during booking', door: 'collected at the door by staff', auto: 'at the door when someone is there, online otherwise', membership: 'a membership waiver lasts the life of the membership', annual: 'a membership waiver lasts a year, then is signed again', member: 'a member\'s guests are covered by the member\'s waiver', each: 'each guest signs the one-day waiver at check-in' };
      return 'Waivers: ' + [a.collection && W[a.collection], a.membership_term && W[a.membership_term], a.guests && W[a.guests]].filter(Boolean).join('; ') + '. Your own lawyer reviews your waiver document';
    } },
  // GOING LIVE: the parts the first screen held behind the holding page, opened at once (one change, one Undo); a part the
  // owner keeps off afterwards is public_part_set
  { name: 'site_go_live', kind: 'write', confirm: true, say: 'Open the site to the public: every part held behind the holding page at once - booking, memberships, the member portal, events, gift cards. Offer website_check first if the owner has not looked',
    params: { type: 'object', properties: {} },
    build: () => ({ op: 'content', key: 'settings', set: [['public.booking', true], ['public.memberships', true], ['public.portal', true], ['public.events', true], ['public.giftCards', true]] }),
    describe: () => 'Open your site to the public: booking, memberships, the member portal, events and gift cards - visitors stop seeing "not yet public"' },
  { name: 'health_read', kind: 'read', say: 'See anything on the unit that needs your attention (the health line)',
    params: { type: 'object', properties: {} },
    request: () => ({ method: 'GET', path: '/api/admin/health' }),
    digest: (j) => ({ needs_attention: (j.signals || []).filter(s => s.level && s.level !== 'green').map(s => ({ what: s.label || s.key, level: s.level, do: s.action || undefined })) }) },
  { name: 'guide_chapter', kind: 'read', say: 'Open a chapter of the BA guide to walk the owner through something the unit cannot do for them (a Twilio account and its texting registration, a Stripe account, a Resend email domain, a lock maker\'s account, the bay computers) - one part at a time, in order',
    params: { type: 'object', properties: { topic: { type: 'string', minLength: 2, maxLength: 80, description: 'what it is about, like "text messaging" or "payments"' }, part: { type: 'integer', minimum: 1, maximum: 40, description: 'which part to read; leave out for the first' } }, required: ['topic'] },
    local: (a) => {
      const k = require('./knowledge'); const c = k.chapter(a.topic);
      if (!c) return { error: `no chapter about "${a.topic}" - the chapters are: ${k.chapters().map(x => x.title).join('; ')}` };
      const n = Math.min(Math.max(1, a.part || 1), Math.max(1, c.parts.length));
      const p = c.parts[n - 1] || { heading: c.title, text: c.intro };
      return { chapter: c.title, parts: c.parts.map((x, i) => `${i + 1}. ${x.heading}`), part: n, of: c.parts.length, heading: p.heading, text: p.text.length > 2400 ? p.text.slice(0, 2400).replace(/\s+\S*$/, '') + ' ...' : p.text, next: n < c.parts.length ? n + 1 : null };
    } },
  { name: 'guide_search', kind: 'read', say: 'Look something up in the BA guide',
    params: { type: 'object', properties: { question: { type: 'string', minLength: 2, maxLength: 300 } }, required: ['question'] },
    local: async (a) => ({ passages: (await require('./knowledge').searchBest(a.question, 3)).map(p => ({ from: p.heading, text: p.text })) }) },

  // ── writes: proposals the owner's page applies ────────────────────────────
  { name: 'schedule_add_shift', kind: 'write', confirm: true, say: 'Put someone on the schedule for a shift, or add an open shift',
    params: { type: 'object', properties: { date: DATE, start_time: TIME, end_time: TIME,
      staff: { type: 'string', maxLength: 60, description: 'the staff member\'s name as on the roster; leave out for an open shift' },
      label: { type: 'string', maxLength: 40, description: 'a short name for the shift, like "Evening"' } }, required: ['date', 'start_time', 'end_time'] },
    needs: ['roster', 'opsConfig'],
    build: (a, ctx) => {
      if (a.end_time <= a.start_time) throw new ActionError('the shift must end after it starts (a shift past midnight is two shifts)');
      const who = a.staff ? staffCode(ctx, a.staff) : null;
      const shift = { op: 'http', method: 'POST', path: '/api/staff/schedule/shift', body: { date: a.date, start_time: a.start_time, end_time: a.end_time, staff_code: who ? who.code : null, label: a.label || '' } };
      // SCHEDULING OFF: ONE CARD TURNS IT ON AND ADDS THE SHIFT (Oct 22 2026, the owner's second day: "put Carl on Friday 4 to 10"
      // was put up, approved, and refused by the route - scheduling was off - and the shift was never made after it went on)
      return schedulingOff(ctx) ? { op: 'steps', steps: [{ op: 'config', set: [['scheduling.enabled', true]] }, shift] } : shift;
    },
    describe: (a, ctx) => { const who = a.staff ? staffCode(ctx, a.staff).name : null; return `${schedulingOff(ctx) ? 'Employee scheduling is off, so this turns it on (schedules, the time clock and the hours export) and puts ' + (who || 'an open shift') + ' on' : who ? 'Put ' + who + ' on' : 'Add an open shift to'} the schedule: ${dayWords(a.date)}, ${timeWords(a.start_time)} - ${timeWords(a.end_time)}${a.label ? ' (' + a.label + ')' : ''}`; } },
  { name: 'schedule_remove_shift', kind: 'write', confirm: true, say: 'Take a shift off the schedule (read the schedule first for its number)',
    params: { type: 'object', properties: { shift_id: { type: 'integer', minimum: 1 } }, required: ['shift_id'] },
    build: (a) => ({ op: 'http', method: 'DELETE', path: `/api/staff/schedule/shift/${a.shift_id}` }),
    describe: (a) => `Take shift #${a.shift_id} off the schedule` },
  { name: 'schedule_copy_week', kind: 'write', confirm: true, say: 'Copy one week of shifts onto another week',
    params: { type: 'object', properties: { from: { ...DATE, description: 'any day in the week to copy (YYYY-MM-DD)' }, to: { ...DATE, description: 'any day in the week to fill (YYYY-MM-DD)' } }, required: ['from', 'to'] },
    build: (a) => ({ op: 'http', method: 'POST', path: '/api/staff/schedule/copy-week', body: { from: a.from, to: a.to } }),
    describe: (a) => `Copy the shifts of the week of ${dayWords(a.from)} onto the week of ${dayWords(a.to)} (shifts already there are not doubled)` },
  { name: 'staffed_set_day', kind: 'write', confirm: true, needs: ['staffing'], say: 'Mark a day as staffed (someone at the counter) and its hours - on a staffed day customers may pay a deposit and settle at the door',
    params: { type: 'object', properties: { date: DATE, start_time: TIME, end_time: TIME, note: { type: 'string', maxLength: 200 } }, required: ['date', 'start_time', 'end_time'] },
    build: (a, ctx) => {
      if (a.end_time <= a.start_time) throw new ActionError('the staffed hours must end after they start');
      if (staffedSource(ctx) === 'season') return { op: 'http', method: 'POST', path: '/api/staff/coverage/exception', body: { date: a.date, staffed: 1, start_time: a.start_time, end_time: a.end_time, note: a.note || '' } };
      return { op: 'http', method: 'PUT', path: '/api/website/staffed', body: { date: a.date, start_time: a.start_time, end_time: a.end_time, note: a.note || '' } };
    },
    describe: (a, ctx) => `Staffed on ${dayWords(a.date)}, ${timeWords(a.start_time)} - ${timeWords(a.end_time)}: customers may pay a deposit and settle the rest at the door` + seasonNote(ctx) },
  { name: 'staffed_remove_day', kind: 'write', confirm: true, needs: ['staffing'], say: 'Make a day unstaffed - nobody at the counter, so customers pay in full online',
    params: { type: 'object', properties: { date: DATE }, required: ['date'] },
    build: (a, ctx) => staffedSource(ctx) === 'season'
      ? { op: 'http', method: 'POST', path: '/api/staff/coverage/exception', body: { date: a.date, staffed: 0 } }
      : { op: 'http', method: 'DELETE', path: `/api/website/staffed/${a.date}` },
    describe: (a, ctx) => `Not staffed on ${dayWords(a.date)}: customers pay in full online that day` + seasonNote(ctx) },
  { name: 'staffed_set_weekly', kind: 'write', confirm: true, needs: ['staffing'], say: 'Mark the same weekdays as staffed for a stretch of weeks (for example Thursday to Saturday through March)',
    params: { type: 'object', properties: { weekdays: { type: 'array', items: { type: 'integer' }, description: 'days of the week, 0 = Sunday to 6 = Saturday' }, start_time: TIME, end_time: TIME, from: DATE, to: DATE }, required: ['weekdays', 'start_time', 'end_time', 'from', 'to'] },
    build: (a, ctx) => {
      if (!a.weekdays.length || a.weekdays.some(w => w < 0 || w > 6)) throw new ActionError('weekdays are 0 (Sunday) to 6 (Saturday)');
      if (a.end_time <= a.start_time) throw new ActionError('the staffed hours must end after they start');
      if (staffedSource(ctx) === 'season') throw new ActionError(`the season "${ctx.staffing.season.name}" in Settings > Schedule decides staffed hours, so weekdays marked on the Website calendar would be ignored - change the season's hours (Settings > Schedule > Edit hours), or I can change single days in the season`);
      return { op: 'http', method: 'POST', path: '/api/website/staffed/bulk', body: { weekdays: a.weekdays, start_time: a.start_time, end_time: a.end_time, from: a.from, to: a.to } };
    },
    // (the year said when the stretch ends in another one - "to Thu, Oct 21" read as yesterday on a setup walk, Oct 22 2026)
    describe: (a) => `Staffed every ${a.weekdays.map(w => WEEKDAYS[w][0].toUpperCase() + WEEKDAYS[w].slice(1, 3)).join(', ')}, ${timeWords(a.start_time)} - ${timeWords(a.end_time)}, from ${dayWords(a.from)} to ${dayWords(a.to)}${String(a.to).slice(0, 4) !== String(a.from).slice(0, 4) ? ', ' + String(a.to).slice(0, 4) : ''}` },
  { name: 'business_name_set', kind: 'write', confirm: false, say: 'Change the business name shown on the website and in messages',
    params: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['name'] },
    build: (a) => ({ op: 'config', set: [['server.businessName', a.name]] }),
    describe: (a) => `Business name: "${a.name}"` },
  { name: 'announcement_set', kind: 'write', confirm: false, say: 'The notice across the top of every page of the website ("we\'re closed Thanksgiving" - the announcement banner): show it with its words and link, or take it down',
    params: { type: 'object', properties: { enabled: { type: 'boolean' }, message: { type: 'string', maxLength: 200 }, link: { type: 'string', maxLength: 300 } }, required: ['enabled'] },
    build: (a) => ({ op: 'config', set: [['announcement.enabled', a.enabled]].concat(a.message !== undefined ? [['announcement.message', a.message]] : [], a.link !== undefined ? [['announcement.link', a.link]] : []) }),
    describe: (a) => a.enabled ? `Show the announcement banner${a.message ? ': "' + a.message + '"' : ''}` : 'Hide the announcement banner' },
  { name: 'requests_read', kind: 'read', say: 'See the requests from staff waiting for you: time off, and shifts they want to pick up or drop',
    params: { type: 'object', properties: {} },
    request: (a, ctx) => ({ method: 'GET', path: `/api/staff/schedule?start=${ctx.today}&end=${addDays(ctx.today, 60)}` }),
    digest: (j) => ({ waiting: (j.pendingTimeoff || []).map(t => ({ kind: 'time_off', request_id: t.id, who: t.staff_name, from: t.start_date, to: t.end_date, note: t.note || undefined }))
      .concat((j.pendingReq || []).map(r => ({ kind: 'shift', request_id: r.id, who: r.staff_name, wants: r.kind === 'claim' ? 'to pick up' : 'to drop', shift: `${r.date} ${r.start_time}-${r.end_time}` }))) }) },
  { name: 'request_decide', kind: 'write', confirm: true, say: 'Approve or turn down a staff request (read the requests first for its number)',
    params: { type: 'object', properties: { kind: { type: 'string', enum: ['time_off', 'shift'] }, request_id: { type: 'integer', minimum: 1 }, approve: { type: 'boolean' } }, required: ['kind', 'request_id', 'approve'] },
    build: (a) => ({ op: 'http', method: 'POST', path: a.kind === 'time_off' ? `/api/staff/timeoff/${a.request_id}/decide` : `/api/staff/shift-request/${a.request_id}/decide`, body: { approve: a.approve } }),
    describe: (a) => `${a.approve ? 'Approve' : 'Turn down'} ${a.kind === 'time_off' ? 'time-off' : 'shift'} request #${a.request_id}` },
  // (Oct 21 2026, night - the customer's day one) "10 to 11, and till 1am Friday and Saturday" was set as 10 to 11 every day
  // without a word: the product keeps ONE opening and closing time for every open day, and the model must say so first
  // (Oct 22 2026, maintainer's try box: "noon to 10pm weekdays and 9am to midnight on weekends" was put up as weekdays only, and the weekends
  // closed - a day may now have its own hours: booking.dayHours, read by services/hours.js)
  // (a close written 11:59 PM is midnight - the end of the day the box keeps as 00:00: "no bookings past midnight" was put up as 11:59 PM
  // by the 4B, which refuses a session ending at midnight - maintainer's try box, Oct 22 2026)
  { name: 'opening_hours_set', kind: 'write', confirm: true, needs: ['hours'],
    // A DAY CLOSED, SAID PLAINLY (the walk in maintainer's typing, Oct 23 2026: "were closed mondays now" was answered "We're now closed on
    // Mondays" with nothing changed): the days open now less the one named, the hours as they are - the box's own card
    read: (words, conv, ctx) => hoursRead(words, ctx),
    fill: (a, ctx) => { const mid = (t) => (t === '23:59' ? '00:00' : t);
      // (the closing or opening hour the owner picked from the box's own question below: the change as it was asked, whole - Oct 27 2026)
      if (ctx && ctx.clockSettledNow) return a;
      const a0 = a;
      { const plain = hoursRead(ctx && (ctx.newest), ctx); if (plain) a = plain; }   // the owner's plainest words over the model's call
      a = Object.assign({}, a, { close_time: mid(a.close_time) }, a.other_hours ? { other_hours: a.other_hours.map(o => Object.assign({}, o, { close_time: mid(o.close_time) })) } : {});
      // ONE DAY'S HOURS SAID ARE THAT DAY'S OWN (the walk in maintainer's typing, Oct 23 2026: "close early sat at 8" was put up by the 4B as open
      // ONLY on Saturdays, 9 to 8 - every other day would have closed): fewer days than are open now, with a time and no "only" or
      // "closed", keeps every open day and the usual hours, and gives the days named their own - each time as it is now unless said
      const h = (ctx && ctx.hours) || {}, w = String((ctx && (ctx.heard || ctx.newest)) || '').toLowerCase(), cur = Array.isArray(h.openDays) ? h.openDays : null;
      const md = a.open_days ? (H.normDays(a.open_days) || []) : null;
      if (md && md.length && cur && h.openTime && h.closeTime && !h.open24Hours && md.length < cur.length && md.every(d => cur.includes(d)) && /\d/.test(w) && !/\b(?:only|closed|not open|we(?:'re| are) open)\b/.test(w)) {
        const said = (t) => { const [hh, mm] = String(t || '').split(':').map(Number); if (!Number.isFinite(hh)) return false; const h12 = hh % 12 || 12;
          return new RegExp('\\b' + h12 + (mm ? ':' + String(mm).padStart(2, '0') : '(?::00)?') + '\\s*(?:' + (hh >= 12 ? 'pm|p\\.m\\.|p' : 'am|a\\.m\\.|a') + ')?\\b').test(w) || w.includes(String(t)); };
        const own = Object.assign({}, h.dayHours || {}), openSaid = said(a.open_time), closeSaid = said(a.close_time);
        for (const d of md) { const was = own[d] || { open: h.openTime, close: h.closeTime }; own[d] = { open: openSaid ? a.open_time : was.open, close: closeSaid ? a.close_time : was.close }; }
        a = Object.assign({}, a, { open_time: h.openTime, close_time: h.closeTime, other_hours: Object.entries(own).filter(([, v]) => v).map(([d, v]) => ({ days: [d], open_time: v.open, close_time: mid(v.close) })) });
        delete a.open_days;
      }
      // A CLOSING OR OPENING HOUR THE OWNER SAID IS THE ONE PUT UP (the walk, Oct 23 2026: "open late fri till 1" was put up by the 4B as
      // midnight): read from their own words (hoursSaid, above) over the model's, for the days they named (or, with no day named, the
      // usual hours) - and an hour the words leave open ("close at 4": 4 PM or 4 AM) is left as the model read it (Oct 27 2026)
      // (Oct 27 2026: against the facility's own hours for the days named - "close early sundays at 1" at a place open till 2 AM keeps the
      // model's 1 AM; "we're open until 5 on sundays" keeps its 5 PM)
      // (Oct 27 2026, THE BARE-HOUR RULE: an hour the rule cannot place - "open till 3 on sundays" at a place where an early close and a
      // late night both fit, "close at 9" at a place open 24 hours - is no longer left as the model read it: the box asks, both to tap)
      { const named = H.normDays(((w.match(/\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?\b/g) || [])).join(',')) || [];
        const hs = hoursSaid(w, h, named);
        const put = (b, closeAt, openAt) => {
          if (!closeAt && !openAt) return b;
          if (named.length && Array.isArray(b.other_hours)) return Object.assign({}, b, { other_hours: b.other_hours.map(o => { const ds = H.normDays(o.days) || []; return ds.length && ds.every(d => named.includes(d)) ? Object.assign({}, o, closeAt ? { close_time: closeAt } : {}, openAt ? { open_time: openAt } : {}) : o; }) });
          if (!named.length) return Object.assign({}, b, closeAt ? { close_time: closeAt } : {}, openAt ? { open_time: openAt } : {});
          return b;
        };
        const ts = hs.closeAsk || hs.openAsk, isClose = !!hs.closeAsk;
        if (ts) {
          const two = ts.map(t => (isClose ? put(a, t, hs.openAt) : put(a, hs.closeAt, t)));
          if (JSON.stringify(two[0]) !== JSON.stringify(two[1])) {
            const ref = named.length && h.dayHours && h.dayHours[named[0]] && h.dayHours[named[0]].open ? h.dayHours[named[0]] : { open: h.openTime, close: h.closeTime };
            const DN = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };
            const labels = ts.map(t => H.clockSay(H.clockMin(t)) + (isClose && ref.open && H.clockMin(t) <= H.clockMin(ref.open) ? ' (after midnight)' : ''));
            const whole = (b) => Object.assign(Object.fromEntries(Object.keys(a0).concat(Object.keys(a)).map(k => [k, undefined])), b);
            return Object.assign({}, a, { [H.CLOCK_ASK]: { why: `which ${isClose ? 'closing' : 'opening'} hour the owner means is not plain - the box asks`, param: '*', question: `${isClose ? 'Close at' : 'Open at'} which time${named.length ? ' on ' + named.map(d => DN[d]).join(' and ') : ''} - ${labels[0]}, or ${labels[1]}?`, choices: labels,
              values: two.map(whole), spans: ts.map(t => (isClose ? [ref.open || t, t] : [t, ref.close || t])), parse: 'ampm' } });
          }
        }
        a = put(a, hs.closeAt, hs.openAt); }
      return a; }, say: 'Set the opening hours customers can book, and which days you are open: the usual opening and closing time, and - when some days differ ("9am to midnight on weekends", "close at 8 on Sundays") - those days in other_hours with their own times. Every open day not in other_hours uses the usual times',
    params: { type: 'object', properties: { open_time: TIME, close_time: TIME,
      open_days: { type: 'array', items: { type: 'string' }, description: 'the days open: mon tue wed thu fri sat sun (or weekdays, weekends, every day); leave out to keep the days as they are', 'x-days': true },
      other_hours: { type: 'array', maxItems: 7, description: 'days with hours of their own, each with its days and times (leave out to keep any such days as they are; an empty list puts every day on the usual hours)',
        items: { type: 'object', properties: { days: { type: 'array', items: { type: 'string' }, description: 'the days: sat, sun, weekends, fri ...', 'x-days': true }, open_time: TIME, close_time: TIME }, required: ['days', 'open_time', 'close_time'] } } },
      required: ['open_time', 'close_time'] },
    build: (a, ctx) => {
      if (a.open_time === a.close_time) throw new ActionError('opening and closing at the same time - for open all day and night, say so and use the Hours screen');
      // set hours mean "not open around the clock": while open24Hours is on, opening and closing times are not read at all
      const set = [['booking.openTime', a.open_time], ['booking.closeTime', a.close_time], ['booking.closeNextDay', a.close_time < a.open_time], ['booking.open24Hours', false]];
      let days = a.open_days;
      if (a.other_hours) {
        const own = {};
        for (const o of a.other_hours) {
          if (o.open_time === o.close_time) throw new ActionError('a day opening and closing at the same time - say its hours');
          // (the usual hours said again for a day are not hours of its own)
          for (const d of o.days) own[d] = o.open_time === a.open_time && o.close_time === a.close_time ? null : { open: o.open_time, close: o.close_time };
        }
        // every day is written: one not named goes back to the usual hours (null clears it - a save merges)
        for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) set.push(['booking.dayHours.' + d, own[d] || null]);
        // a day given hours of its own is open
        const named = Object.keys(own).filter(d => own[d]), was = days || ((ctx && ctx.hours && ctx.hours.openDays) || []);
        if (named.some(d => !was.includes(d))) days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(d => was.includes(d) || named.includes(d));
      }
      if (days) set.push(['booking.openDays', days]);
      set.push(['setupAck.hours', true]);   // set up by talking: a change through the assistant is the owner's answer (setup-status)
      return { op: 'config', set };
    },
    describe: (a, ctx) => {
      const D = (d) => d[0].toUpperCase() + d.slice(1), span = (o, c) => `${timeWords(o)} - ${timeWords(c)}${c <= o ? (c === '00:00' ? ' (midnight)' : ' the next day') : ''}`;
      const own = (a.other_hours || []).filter(o => !(o.open_time === a.open_time && o.close_time === a.close_time));
      const ownDays = new Set(own.flatMap(o => o.days));
      let days = a.open_days || (ctx && ctx.hours && ctx.hours.openDays) || null;
      if (days && ownDays.size) days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(d => days.includes(d) || ownDays.has(d));
      const usual = days ? days.filter(d => !ownDays.has(d)) : null;
      const usualWords = usual ? (usual.length === 7 ? 'every day' : usual.map(D).join(', ')) : '(same days as now)';
      const keptDays = !a.other_hours && ctx && ctx.hours && ctx.hours.dayHours ? Object.keys(ctx.hours.dayHours).filter(d => ctx.hours.dayHours[d] && (!days || days.includes(d))) : [];
      const kept = keptDays.length ? keptDays.map(d => `${D(d)} keeps ${span(ctx.hours.dayHours[d].open, ctx.hours.dayHours[d].close)}`).join('; ') : '';
      return `Open ${usualWords}, ${span(a.open_time, a.close_time)}` + own.map(o => `; ${o.days.map(D).join(', ')} ${span(o.open_time, o.close_time)}`).join('') +
        `: customers can book only inside these hours${kept ? ` (${kept})` : ''}`;
    } },
  { name: 'website_headline_set', kind: 'write', confirm: false, say: 'Change the big headline at the top of the website, the line under it, or the small tag above it',
    params: { type: 'object', properties: { headline: { type: 'string', minLength: 1, maxLength: 120 }, sub: { type: 'string', maxLength: 300, description: 'the line under the headline' }, tag: { type: 'string', maxLength: 80, description: 'the small line above the headline' } } },
    build: (a) => {
      const set = [['headline', a.headline], ['sub', a.sub], ['tag', a.tag]].filter(([, v]) => v !== undefined);
      if (!set.length) throw new ActionError('say what the headline, the line under it, or the tag should be');
      return { op: 'content', key: 'hero', set };
    },
    describe: (a) => [a.headline !== undefined && `Website headline: "${a.headline}"`, a.sub !== undefined && `the line under it: "${a.sub}"`, a.tag !== undefined && `the tag above it: "${a.tag}"`].filter(Boolean).join('; ') + ' (the Hero card\'s Previous versions keeps the old words)' },
  { name: 'network_scan', kind: 'read', say: 'Look for the PCs and the Shelly smart plugs on the facility\'s network (a NEW plug is put on the Wi-Fi with the Shelly app first - tell the owner so if none is found): each PC\'s address and its own name, each plug\'s address, model and name, and which bay a plug is on already (so the owner can say which bay each is for)',
    params: { type: 'object', properties: {} },
    local: async () => {
      const r = await require('../netscan').scan();
      const bays = (require('../config').getConfig().bays || []);
      const plugBay = (ip) => { const b = bays.find(x => (x.shellyDevices || []).some(d => d.ip === ip)); return b ? b.name : 'not on a bay'; };
      return { network: r.network, pcs: r.found.map(f => ({ name: f.name || '(no name given)', address: f.ip, wake_id: f.mac || undefined })),
        plugs: (r.plugs || []).map(p => ({ plug: p.name || p.id || p.model, address: p.ip, model: p.model, generation: p.gen, bay: plugBay(p.ip),
          login: p.login ? 'its login is ON - the unit cannot switch it until the owner turns that off in the Shelly app' : undefined })), note: r.note };
    } },
  // THE ADDRESS GOES IN WITH THE WINDOWS SIGN-IN (Oct 20 2026, the setup map): the bay shuts its PC down through the PC's
  // address with the PC's ADMIN user and password, typed on the bay's page. An address saved with no password made every
  // session end try a shutdown Windows refuses - retried, and the health line red (simulator.sendShutdown skips only a bay
  // with NO address). So with no password saved on the bay only the wake ID goes in, and the owner is told what to type.
  { name: 'bay_pc_link', kind: 'write', confirm: true, say: 'Link a bay to its PC from the network scan: its wake ID (so the bay can wake it before each session) and, when the PC\'s Windows ADMIN sign-in is already saved on the bay, its address (so the bay can shut it down after)',
    params: { type: 'object', properties: { bay: { type: 'string', minLength: 1, maxLength: 60, description: 'the bay\'s name' },
      address: { type: 'string', minLength: 7, maxLength: 15, description: 'the PC\'s IPv4 address from the scan' },
      wake_id: { type: 'string', maxLength: 17, description: 'the PC\'s MAC address from the scan, if it gave one' },
      pc_name: { type: 'string', maxLength: 40, description: 'the PC\'s own name from the scan, for saying it back' } }, required: ['bay', 'address'] },
    needs: ['bays'],
    build: (a, ctx) => {
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(a.address) || a.address.split('.').some(n => Number(n) > 255)) throw new ActionError(`"${a.address}" is not a network address`);
      if (a.wake_id && !/^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(a.wake_id)) throw new ActionError(`"${a.wake_id}" is not a wake ID (a MAC address like 3c:7c:3f:12:34:56)`);
      const bays = ctx.bays || [];
      const i = bayIndex(ctx, a.bay);
      const signIn = !!bays[i].simulatorWinPass;   // the settings route masks a saved one, but it is there
      const set = signIn ? [[`bays.${i}.simulatorPcIp`, a.address]] : [];
      if (a.wake_id) set.push([`bays.${i}.pcMac`, a.wake_id.toLowerCase().replace(/-/g, ':')]);
      if (!set.length) throw new ActionError(`the scan gave no wake ID for this PC, and ${bays[i].name} has no Windows sign-in saved for shutdowns: save the PC's address and its ADMIN user with bay_pc_signin_set - the owner types the password in the chat's own private box`);
      return { op: 'config', set, expect: [[`bays.${i}.id`, bays[i].id]], bayName: bays[i].name };
    },
    describe: (a, ctx) => {
      const b = (ctx.bays || []).find(x => String(x.name || '').toLowerCase() === a.bay.trim().toLowerCase()) || { name: a.bay };
      const pc = `${a.pc_name ? a.pc_name + ' at ' : ''}${a.address}${a.wake_id ? ' (wake ID ' + a.wake_id.toLowerCase() + ')' : ''}`;
      return b.simulatorWinPass ? `Link ${b.name} to ${pc}: the bay wakes this PC before each session and shuts it down after`
        : `Wake ${pc} before each session on ${b.name}. To shut it down after, the bay needs the PC's address with its Windows ADMIN user and password - type those on the bay's page in Admin > Bays & Devices`;
    } },
  // ── a Shelly plug on a bay (Oct 19 2026; maintainer: "put in their I ps of their devices"): the bay editor's own plug list -
  //    on before each session, off after; the PC's own plug is left on so Windows can shut down first ──
  { name: 'bay_plug_add', kind: 'write', confirm: true, say: 'Put a Shelly smart plug (found by the network scan) on a bay, so it follows the bay\'s bookings: on before each session, off after - or, for the plug the bay\'s PC runs from, left on',
    params: { type: 'object', properties: {
      bay: { type: 'string', minLength: 1, maxLength: 60 },
      address: { type: 'string', minLength: 7, maxLength: 21, description: 'the plug\'s address from the scan' },
      name: { type: 'string', maxLength: 40, description: 'what it powers, like "Projector"' },
      generation: { type: 'integer', minimum: 1, maximum: 9, description: 'the plug\'s generation from the scan' },
      for_pc: { type: 'boolean', description: 'true when the bay\'s PC runs from this plug: it is left on after sessions' },
      minutes_before: { type: 'integer', minimum: 1, maximum: 60 }, minutes_after: { type: 'integer', minimum: 5, maximum: 120 } }, required: ['bay', 'address'] },
    needs: ['bays'],
    build: (a, ctx) => {
      const host = a.address.split(':')[0];
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.split('.').some(n => Number(n) > 255)) throw new ActionError(`"${a.address}" is not a network address`);
      const i = bayIndex(ctx, a.bay), bay = ctx.bays[i];
      const cur = Array.isArray(bay.shellyDevices) ? bay.shellyDevices : [];
      if (cur.some(d => d.ip === a.address)) throw new ActionError(`that plug is already on ${bay.name}`);
      const other = (ctx.bays || []).find((b, j) => j !== i && (b.shellyDevices || []).some(d => d.ip === a.address));
      if (other) throw new ActionError(`that plug is on ${other.name} already - take it off there first`);
      const dev = { ip: a.address, name: a.name || (a.for_pc ? 'PC plug' : 'Plug'), gen: a.generation || 2, minutesBefore: a.minutes_before || 10, turnOffAfter: !a.for_pc, minutesAfter: a.minutes_after || 30 };
      return { op: 'config', set: [[`bays.${i}.shellyDevices`, cur.concat([dev])]], expect: [[`bays.${i}.id`, bay.id]].concat(Array.isArray(bay.shellyDevices) ? [[`bays.${i}.shellyDevices.length`, cur.length]] : []) };
    },
    describe: (a, ctx) => { const bay = ctx.bays[bayIndex(ctx, a.bay)]; return `Put the plug at ${a.address}${a.name ? ' (' + a.name + ')' : ''} on ${bay.name}: on ${a.minutes_before || 10} minutes before each session${a.for_pc ? ', left on after (the PC runs from it)' : `, off ${a.minutes_after || 30} minutes after it ends`}`; } },
  { name: 'plug_switch', kind: 'write', confirm: (a) => a.on === false, confirmSay: ' (turning a plug off is shown to the owner to approve first)',
    say: 'Turn a Shelly plug on or off now, to test it - by its address from the scan or its name on a bay',
    params: { type: 'object', properties: { plug: { type: 'string', minLength: 1, maxLength: 60, description: 'the plug\'s address, or its name on a bay' }, on: { type: 'boolean' } }, required: ['plug', 'on'] },
    needs: ['bays'],
    build: (a, ctx) => {
      const n = a.plug.trim().toLowerCase();
      const all = (ctx.bays || []).flatMap(b => (b.shellyDevices || []).map(d => Object.assign({ bay: b.name }, d)));
      const d = all.find(x => x.ip === a.plug.trim()) || (all.filter(x => String(x.name || '').toLowerCase() === n).length === 1 ? all.find(x => String(x.name || '').toLowerCase() === n) : null);
      const ip = d ? d.ip : a.plug.trim();
      if (!/^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/.test(ip)) throw new ActionError(`no plug called "${a.plug}" is on a bay - give its address from the scan`);
      return { op: 'http', method: 'POST', path: '/api/admin/shelly/device', body: { ip, gen: d ? d.gen || 2 : 2, action: a.on ? 'on' : 'off' } };
    },
    describe: (a, ctx) => { const all = (ctx.bays || []).flatMap(b => (b.shellyDevices || []).map(d => Object.assign({ bay: b.name }, d))); const d = all.find(x => x.ip === a.plug.trim() || String(x.name || '').toLowerCase() === a.plug.trim().toLowerCase()); return `Turn the plug ${d ? (d.name || d.ip) + ' (on ' + d.bay + ')' : 'at ' + a.plug.trim()} ${a.on ? 'on' : 'off'} now${!a.on && d ? ' - if a session is playing there, it goes off for them too' : ''}`; } },
  // ── the setup checklist's own items (Oct 19 2026): the assistant can finish each one it leads the owner through ──
  { name: 'location_set', kind: 'write', confirm: false, say: 'Set the facility\'s city and state (they are used for the Google listing text), and if the owner gives them its map pin (latitude and longitude, as Google Maps shows when the place is long-pressed)',
    params: { type: 'object', properties: { city: { type: 'string', minLength: 2, maxLength: 60 }, state: { type: 'string', minLength: 2, maxLength: 30 }, zip: { type: 'string', maxLength: 10 },
      latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } }, required: ['city', 'state'] },
    build: (a) => {
      if ((a.latitude === undefined) !== (a.longitude === undefined)) throw new ActionError('a map pin needs both the latitude and the longitude');
      return { op: 'config', set: [['seo.city', a.city], ['seo.state', a.state.length === 2 ? a.state.toUpperCase() : a.state]].concat(a.zip ? [['seo.zip', a.zip]] : [])
        .concat(a.latitude !== undefined ? [['seo.latitude', String(a.latitude)], ['seo.longitude', String(a.longitude)]] : []) };
    },
    describe: (a) => `Location: ${a.city}, ${a.state.length === 2 ? a.state.toUpperCase() : a.state}${a.zip ? ' ' + a.zip : ''}${a.latitude !== undefined ? ` - the map pin at ${a.latitude}, ${a.longitude}` : ''}` },
  { name: 'website_address_set', kind: 'write', confirm: false, say: 'Set the website\'s own address (its domain, used for links and search)',
    params: { type: 'object', properties: { domain: { type: 'string', minLength: 4, maxLength: 120, description: 'like fairwaygolf.com' } }, required: ['domain'] },
    build: (a) => {
      const host = a.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) throw new ActionError(`"${a.domain}" is not a website address (like fairwaygolf.com)`);
      return { op: 'config', set: [['seo.domain', 'https://' + host]] };
    },
    describe: (a) => `Website address: https://${a.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')}` },
  { name: 'access_style_set', kind: 'write', confirm: true, say: 'Set how the facility runs: staffed (someone always at the counter), unstaffed (door codes, nobody at the counter) or hybrid (staffed some hours, door codes otherwise)',
    params: { type: 'object', properties: { style: { type: 'string', enum: ['staffed', 'unstaffed', 'hybrid'] } }, required: ['style'] },
    build: (a) => { const style = a.style === 'unstaffed' ? 'unmanned' : a.style; return { op: 'config', set: [['booking.accessStyle', style], ['booking.staffedAccess', style === 'staffed'], ['booking.accessModeChosen', true]] }; },
    describe: (a) => a.style === 'staffed' ? 'Staffed: someone is always at the counter - no door codes are sent, and customers may pay a deposit and settle at the door'
      : a.style === 'unstaffed' ? 'Unstaffed: nobody at the counter - customers pay in full online and get a door code for their booking'
      : 'Hybrid: staffed on the staffed days (deposits and the counter), door codes and paying in full online the rest of the time' },
  { name: 'email_sender_set', kind: 'write', confirm: false, say: 'Set the address the facility\'s emails come from (the Resend key is pasted into the chat on its own)',
    params: { type: 'object', properties: { from_email: { type: 'string', minLength: 5, maxLength: 120 } }, required: ['from_email'] },
    build: (a) => { if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(a.from_email)) throw new ActionError(`"${a.from_email}" is not an email address`); return { op: 'config', set: [['resend.fromEmail', a.from_email.trim()]] }; },
    describe: (a) => `Emails come from ${a.from_email.trim()}` },
  { name: 'texting_number_set', kind: 'write', confirm: false, say: 'Set the phone number the facility\'s texts come from (the Twilio keys are pasted into the chat on their own)',
    params: { type: 'object', properties: { phone: { type: 'string', minLength: 10, maxLength: 20 } }, required: ['phone'] },
    build: (a) => {
      const d = a.phone.replace(/[^0-9+]/g, '');
      const e164 = /^\+[1-9]\d{9,14}$/.test(d) ? d : /^1?\d{10}$/.test(d) ? '+1' + d.slice(-10) : null;
      if (!e164) throw new ActionError(`"${a.phone}" is not a phone number`);
      return { op: 'config', set: [['twilio.phoneNumber', e164]] };
    },
    describe: (a) => { const d = a.phone.replace(/[^0-9+]/g, ''); return `Texts come from ${/^\+/.test(d) ? d : '+1' + d.slice(-10)}`; } },
  // (needs the facility's hours: its start time is read by the bare-hour rule in fill - Oct 27 2026)
  // (the model is told the Events page is public and whose occasions never go on it - Oct 27 2026, round 2d: its say gave no rule, and a
  // model that did what the owner typed put "Acme Company Outing" up at once; the engine asks before one goes up too - privateEvent)
  { name: 'event_add', kind: 'write', confirm: false, needs: ['hours'], say: 'Add an event to the website (its own Events page, and the homepage\'s next-event section): a title, the date, a few words, and a flyer photo or a link if the owner has one - a NEW event only: one already on the website (its time, day or words) is changed with event_edit. The Events page is PUBLIC: only what anyone may come to. One person\'s, a family\'s, a team\'s, a company\'s or a client\'s own occasion (a birthday, a retirement, a company outing, "a bash for Mike", "Sarah\'s 40th", "the Smiths\' night") is a private booking - block_add or booking_make - never an event; when you cannot tell which, ask the owner',
    params: { type: 'object', properties: { title: { type: 'string', minLength: 2, maxLength: 120 }, date: DATE, description: { type: 'string', maxLength: 2000 },
      flyer: { type: 'string', maxLength: 200, description: 'a photo the owner added in the chat (/uploads/landing/...)' }, link: { type: 'string', maxLength: 300, description: 'more details: /a-page or https://...' } }, required: ['title', 'date'] },
    // the time the owner said, on the event's words when the model's words left it out - an event has no time of its own (Oct 22
    // 2026, the owner's second day: "Friday Night Scramble on Friday at 7pm" went up as "A fun scramble event for members and guests")
    // AN EVENT'S START BY THE BARE-HOUR RULE (Oct 27 2026 - the critic of round 2c, HIGH: this fill wrote a bare 1 to 9 as PM, at once, on
    // the public Events page - "add the fall classic on november 8 at 9" went up "Starts at 9:00 PM", "add the breakfast scramble on nov 8
    // at 7" as 7 PM - and every event the box hands the model came out the same, a person's or a company's do among them; event_add has no
    // card). The time the owner typed for it - "at 8", "starts at 6:30", "from 7 to 9" - is read by the one rule (helpers.clockOf), the
    // event's own name attached ("League Night at 7", "the Saturday Morning Scramble at 6"): said or certain, it is the event's time, over
    // a time the model wrote in its words for the other half; not certain, the box asks - both to tap - and nothing goes on the page until
    // the owner says. A time the owner never typed, or one the model wrote that is not theirs, is left to the model's words.
    // (Oct 28 2026, round 2e: the reading lives in eventWhen, below - event_edit's new words are read by the same one)
    fill: (a, ctx) => eventWhen(a, ctx, { key: 'description', title: a.title, date: a.date }),
    when: (a, ctx, o) => eventWhen(a, ctx, o),
    build: (a) => {
      if (a.link && !/^(\/(?!\/)[^\s<>"']*|https?:\/\/[^\s<>"']+)$/.test(a.link)) throw new ActionError(`"${a.link}" is not a link (/a-page or https://...)`);
      return { op: 'http', method: 'POST', path: '/api/website/events', body: { title: a.title, event_date: a.date, description: a.description || '', flyer: a.flyer ? photoPath(a.flyer) : '', link: a.link || '' } };
    },
    describe: (a) => `Event on ${dayWords(a.date)}: "${a.title}"${a.description ? ' - ' + String(a.description).slice(0, 80) + (String(a.description).length > 80 ? '...' : '') : ''}${a.flyer ? ', with its flyer' : ''}${a.link ? ', more details at ' + a.link : ''}` },
  // ── memberships, built by asking (maintainer: "using the a I to build memberships and how they work ... you gotta answer this
  //    question, this question"): the questions are the tier's own fields, asked once each, in the order the Members
  //    screen asks them, and the tier is made by the same save. Free time first (rule 3) is the product's own pricing.
  { name: 'tiers_read', kind: 'read', say: 'Look at the membership tiers there are now',
    params: { type: 'object', properties: {} },
    request: () => ({ method: 'GET', path: '/api/members/tiers' }),
    // read the way the product prices a tier (free hours, the discount after them, a flat rate, a retired tier) - the money
    // area's own words; this read used to call a Free Hours tier "$4 off"
    digest: (j) => { const w = require('./areas/money')(H).words; return { tiers: (Array.isArray(j) ? j : (j.tiers || [])).map(t => w && w.tierWords ? w.tierWords(t) : { name: t.name, monthly: t.price_monthly }) }; } },
  { name: 'membership_tier_create', kind: 'write', confirm: true,
    say: 'Make a new membership tier. Before calling this, ask the owner one question at a time: its name; the monthly price; how many free hours a month it includes (0 for none); the discount on time beyond those hours; which days and hours members may book (or any time); whether members may bring guests, and how many; whether it is sold online',
    params: { type: 'object', properties: {
      name: { type: 'string', minLength: 2, maxLength: 60 },
      price_monthly: { type: 'number', minimum: 0, maximum: 10000, description: 'dollars a month' },
      hours_per_month: { type: 'number', minimum: 0, maximum: 744, description: 'free hours a month included; 0 for none' },
      discount_percent: { type: 'number', minimum: 0, maximum: 100, description: 'percent off booked time beyond the free hours; 0 for none' },
      days: { type: 'array', items: { type: 'string' }, description: 'days members may book: mon tue wed thu fri sat sun, weekdays, weekends; leave out for every day', 'x-days': true },
      earliest_time: TIME, latest_time: TIME,
      guests_allowed: { type: 'boolean' }, guests_per_visit: { type: 'integer', minimum: 0, maximum: 20 },
      sell_online: { type: 'boolean', description: 'can people join online' },
      price_annual: { type: 'number', minimum: 0, maximum: 100000, description: 'dollars a year, when it is also sold by the year; 0 for not' },
      roster_cap: { type: 'integer', minimum: 0, maximum: 100000, description: 'the most members it may have; 0 for no cap' },
      description: { type: 'string', maxLength: 300 } }, required: ['name', 'price_monthly'] },
    // (Oct 22 2026, the owner's second day: "make a membership called Gold for $99 a month with 4 free hours a month" was put up
    // with 8 AM - 10 PM, 2 guests a visit and joining online, none of them said, and a description promising guest access.) A term
    // said in the owner's own words that the model left out is taken from them; one never said is left off (engine.js, WHAT THE
    // OWNER NEVER SAID STAYS OUT); the two that are the facility's own call - guests, and joining online - are asked, with
    // answers to tap (A BOX-ASKED CHOICE); days and hours left unsaid are any time the facility is open, as the card says
    fill: (a, ctx) => {
      const w = String(ctx.newest || ''), out = Object.assign({}, a);
      if (out.guests_allowed === undefined && out.guests_per_visit === undefined) {
        const g = /\b(one|two|three|four|five|\d)\s+guests?\b/i.exec(w);
        if (/\bno guests?\b|\bwithout guests\b|\bguests? (?:are )?not allowed\b/i.test(w)) out.guests_per_visit = 0;
        else if (g) out.guests_per_visit = ({ one: 1, two: 2, three: 3, four: 4, five: 5 })[g[1].toLowerCase()] || Number(g[1]);
      }
      if (out.sell_online === undefined) {
        if (/\b(?:not|never|don'?t|no)\b[^.]{0,20}\bonline\b|\bonly (?:at|in) (?:the )?(?:counter|person|front desk)\b|\bin person only\b/i.test(w)) out.sell_online = false;
        else if (/\bonline\b/i.test(w)) out.sell_online = true;
      }
      return out;
    },
    unsaid: {
      days: (v, w) => /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\bweekdays?\b|\bweekends?\b|\bany ?day\b|\bevery ?day\b|\bdaily\b/i.test(w),
      earliest_time: (v, w) => TIMES_SAID.test(w), latest_time: (v, w) => TIMES_SAID.test(w),
      guests_allowed: (v, w) => GUESTS_SAID.test(w), guests_per_visit: (v, w) => GUESTS_SAID.test(w),
      sell_online: (v, w) => /\bonline\b|\bjoin\b|\bsign(?:s|ing)? ?up\b|\bsell\b|\bsold\b|\bwebsite\b|\bcounter\b|\bin person\b/i.test(w),
      discount_percent: (v, w) => !Number(v) || /%|\bpercent\b|\boff\b|\bdiscount/i.test(w),
      price_annual: (v, w) => !Number(v) || /\byear(?:ly)?\b|\bannual(?:ly)?\b/i.test(w),
      roster_cap: (v, w) => !Number(v) || /\bcap(?:ped)?\b|\blimit\b|\bat most\b|\bmax(?:imum)?\b|\bonly \d+\b|\bfirst \d+\b|\bspots?\b/i.test(w),
      description: (v, w) => /\bdescri(?:be|ption)\b|\btag ?line\b|"/i.test(w),
      // (money is asked, never guessed - maintainer, Oct 22 2026)
      price_monthly: (v, w) => H.moneySaid(v, w),
    },
    build: (a) => {
      if (a.price_monthly === undefined) {
        const e = new ActionError(`ask the owner what ${a.name} costs a month, then call this again with price_monthly`);
        e.ask = { param: 'price_monthly', question: `What does ${a.name} cost a month?`, parse: 'money' };
        throw e;
      }
      if (a.guests_allowed === undefined && a.guests_per_visit === undefined) {
        const e = new ActionError(`ask the owner whether ${a.name} members may bring guests, then call this again with guests_per_visit`);
        e.ask = { param: 'guests_per_visit', question: `Can ${a.name} members bring guests?`, choices: ['No guests', '1 guest a visit', '2 guests a visit'], values: [0, 1, 2] };
        throw e;
      }
      if (a.sell_online === undefined) {
        const e = new ActionError(`ask the owner whether people can join ${a.name} online, then call this again with sell_online`);
        e.ask = { param: 'sell_online', question: `Can people join ${a.name} online, or only at the counter?`, choices: ['Join online', 'Only at the counter'], values: [true, false] };
        throw e;
      }
      if ((a.earliest_time && !a.latest_time) || (!a.earliest_time && a.latest_time)) throw new ActionError('give both the earliest and the latest time members may book, or neither');
      if (a.earliest_time && a.latest_time <= a.earliest_time) throw new ActionError('the latest time must be after the earliest');
      const allDays = !a.days || a.days.length === 7;
      // FREE TIME FIRST (rule 3), the way the product prices it (services/pricing.js isMeterTier/meterFor): free hours are
      // the Free Hours style - its value is the hours, and the discount beyond them is the After Hours rate. A 'percentage'
      // tier with hours_per_month is "X% off while under N hours", no free time at all (the inventory, Oct 20 2026).
      const hrs = a.hours_per_month || 0, pct = a.discount_percent || 0;
      const pricing = hrs > 0
        ? { discount_type: 'free_hours', discount_value: hrs, hours_per_month: 0, over_limit_discount_type: pct ? 'percentage' : '', over_limit_discount_value: pct }
        : { discount_type: 'percentage', discount_value: pct, hours_per_month: 0, over_limit_discount_type: '', over_limit_discount_value: 0 };
      return { op: 'http', method: 'POST', path: '/api/members/tiers', body: Object.assign({
        name: a.name, description: a.description || '', price_monthly: a.price_monthly, price_annual: a.price_annual || 0, roster_cap: a.roster_cap || 0,
        hours_per_week: 0, hours_per_day: 0 }, pricing, {
        allowed_days: allDays ? '' : a.days.join(','), earliest_time: a.earliest_time || '', latest_time: a.latest_time || '', allowed_bays: '',
        guest_allowed: guestsOf(a) > 0, guest_max_per_visit: guestsOf(a),
        sell_online: !!a.sell_online, settlement_mode: 'online', codes_included: 1, active: 1 }) };
    },
    describe: (a) => {
      const parts = [`New membership "${a.name}": $${Number(a.price_monthly).toFixed(2).replace(/\.00$/, '')} a month`];
      parts.push(a.hours_per_month ? `${a.hours_per_month} free hour${a.hours_per_month === 1 ? '' : 's'} a month` : 'no free hours');
      if (a.discount_percent) parts.push(`${a.discount_percent}% off time beyond ${a.hours_per_month ? 'those' : 'that'}`);
      parts.push(!a.days || a.days.length === 7 ? 'any day' : a.days.map(d => d[0].toUpperCase() + d.slice(1)).join(', '));
      if (a.earliest_time) parts.push(`${timeWords(a.earliest_time)} - ${timeWords(a.latest_time)}`);
      parts.push(guestsOf(a) ? `${guestsOf(a)} guest${guestsOf(a) === 1 ? '' : 's'} a visit` : 'no guests');
      parts.push(a.sell_online ? 'people can join online' : 'not sold online');
      if (a.price_annual) parts.push(`$${Number(a.price_annual).toFixed(2).replace(/\.00$/, '')} a year too`);
      if (a.roster_cap) parts.push(`at most ${a.roster_cap} members`);
      return parts.join(', ');
    } },
  // (Oct 21 2026, night - the customer's day one) "$30 an hour" became "$60 per half hour" in the box's small model's own
  // sums: the owner's hourly price is taken as said, and the box divides
  { name: 'base_price_set', kind: 'write', confirm: true, say: 'Set the facility\'s base price - one price for every bay (memberships and peak prices apply on top; one bay\'s extra or discount is bay_price_adjust_set) - per half hour, or per hour as the owner said it',
    params: { type: 'object', properties: { per_half_hour: { type: 'number', minimum: 0, maximum: 1000, description: 'dollars per half hour' },
      per_hour: { type: 'number', minimum: 0, maximum: 2000, description: 'dollars per hour - instead of per half hour, when the owner said it per hour' } } },
    build: (a) => {
      const half = a.per_half_hour !== undefined ? a.per_half_hour : (a.per_hour !== undefined ? Math.round(a.per_hour * 50) / 100 : undefined);
      if (half === undefined) throw new ActionError('say the price - per half hour, or per hour');
      return { op: 'config', set: [['booking.pricePerHalfHour', half], ['setupAck.price', true]] };
    },
    describe: (a) => { const half = a.per_half_hour !== undefined ? a.per_half_hour : Math.round(a.per_hour * 50) / 100; const m = (n) => '$' + Number(n).toFixed(2).replace(/\.00$/, '');
      // (a facility booked whole is priced whole - the club's walk, Oct 25 2026: "A bay costs $30" on a club that rents the building)
      let whole = false; try { whole = !!(require('../config').getConfig().booking || {}).wholeFacility; } catch {}
      return `${whole ? 'The whole facility' : 'A bay'} costs ${m(half)} per half hour (${m(half * 2)} an hour; memberships and peak prices apply on top)`; } },
  // ── the newsletter (maintainer: "if people sign up for a newsletter, they get a newsletter. But they still get to go away from it") ──
  { name: 'newsletters_read', kind: 'read', say: 'See the newsletters sent so far (each one\'s subject, how far it got) and whether one can be sent from this unit - how many are signed up is email_signups_count',
    params: { type: 'object', properties: {} },
    request: () => ({ method: 'GET', path: '/api/website/newsletters' }),
    digest: (j) => ({ can_send: j.cannotSend ? 'no - ' + j.cannotSend : 'yes', sent: (j.newsletters || []).slice(0, 5).map(n => ({ subject: n.subject, status: n.status, sent: n.sent, of: n.total })) }) },
  { name: 'newsletter_send', kind: 'write', confirm: true, say: 'Send a newsletter to everyone signed up for email updates (write it with the owner first; each email carries the person\'s own unsubscribe link). When nobody is signed up yet, say so plainly - never put up some other change in its place',
    params: { type: 'object', properties: { picture: { type: 'string', maxLength: 200, description: 'a picture at the top of the email: a special\'s flyer (special_flyer) or a photo on this unit (/uploads/landing/...)' }, subject: { type: 'string', minLength: 2, maxLength: 150 }, body: { type: 'string', minLength: 10, maxLength: 20000, description: 'the newsletter\'s message only, plain text; a blank line starts a new paragraph. Each email already starts "Hi <their name>," (when they gave one) and ends "- <the business name>" with their unsubscribe link (services/newsletter.js), so write no greeting and no sign-off' } }, required: ['subject', 'body'] },
    needs: ['subscribers'],
    build: (a, ctx) => {
      if (!ctx.subscribers) throw new ActionError('nobody is signed up for email updates yet - there is no one to send it to');
      return { op: 'http', method: 'POST', path: '/api/website/newsletters', body: Object.assign({ subject: a.subject, body: a.body, by: 'assistant' }, a.picture ? { image: photoPath(a.picture) } : {}) };
    },
    describe: (a, ctx) => `Send "${a.subject}"${a.picture ? ' with its picture at the top' : ''} to the ${ctx.subscribers} ${ctx.subscribers === 1 ? 'person' : 'people'} signed up for email updates - each email carries their own unsubscribe link` },
  // ── a secret the owner types, which the model never sees (Oct 19 2026). The proposal carries NO value: the owner's page
  //    shows a masked box and sends what is typed straight to the owner's own route; the model hears only "set" or why
  //    not. For anything secret without a shape of its own to catch - here the backup passphrase (rule 7: asked once,
  //    skippable, the checklist keeps asking). ──
  { name: 'backup_passphrase_set', kind: 'write', confirm: true, doneSay: 'Your backup passphrase is set - copies that leave the box are locked with it', say: 'Ask the owner for the backup passphrase (copies that leave the unit are encrypted with it) - the chat shows a masked box for it; you never see it',
    params: { type: 'object', properties: {} },
    build: () => ({ op: 'secret', method: 'POST', path: '/api/admin/backup/vault/passphrase', field: 'passphrase', label: 'Your backup passphrase', minLength: 10, confirmTwice: true,
      hint: 'At least 10 characters - a short phrase you will remember beats a password you will lose. Copies of your backups that leave this unit are encrypted with it, and a backup restored onto a new unit asks for it, so keep it somewhere safe.' }),
    describe: () => 'Set your backup passphrase (type it in the box below - it goes straight to the unit, never into this chat)' },
  // ── the website, built by talking (maintainer: "the AI can fully and truly build a real website, make it feel as base 44 as
  //    possible, with tons of options"). Each is the Website editor's own save of that section; the editor keeps every
  //    earlier version to put back (rule 20). Words and looks go straight in; hiding or showing a part of the site is
  //    said back first (hiding booking turns customers away). ──
  { name: 'website_promo_set', kind: 'write', confirm: false, say: 'Show, hide or change the first-visit offer band on the website (a short label, a title, a line of text, a code to use)',
    params: { type: 'object', properties: { enabled: { type: 'boolean' }, label: { type: 'string', maxLength: 30 }, title: { type: 'string', maxLength: 80 }, text: { type: 'string', maxLength: 240 }, code: { type: 'string', maxLength: 30, description: 'a discount code the facility already has, to show' } }, required: ['enabled'] },
    build: (a) => ({ op: 'content', key: 'promo', set: [['enabled', a.enabled], ['label', a.label], ['title', a.title], ['text', a.text], ['code', a.code]].filter(([, v]) => v !== undefined) }),
    describe: (a) => a.enabled ? `Show the offer band${a.title ? ': "' + a.title + '"' : ''}${a.code ? ' (code ' + a.code + ')' : ''}` : 'Hide the offer band' },
  { name: 'website_contact_set', kind: 'write', confirm: false, say: 'Set the email and phone shown on the website\'s Find us section, and whether its map and opening hours show',
    params: { type: 'object', properties: { email: { type: 'string', maxLength: 120 }, phone: { type: 'string', maxLength: 30 }, show_map: { type: 'boolean' }, show_hours: { type: 'boolean' } } },
    build: (a) => {
      if (a.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(a.email)) throw new ActionError(`"${a.email}" is not an email address`);
      const set = [['email', a.email], ['phone', a.phone], ['showMap', a.show_map], ['showHours', a.show_hours]].filter(([, v]) => v !== undefined);
      if (!set.length) throw new ActionError('say the email, the phone, or whether the map or the hours show');
      return { op: 'content', key: 'visit', set };
    },
    describe: (a) => 'On the website: ' + [a.email && 'email ' + a.email, a.phone && 'phone ' + a.phone, a.show_map !== undefined && (a.show_map ? 'the map shown' : 'no map'), a.show_hours !== undefined && (a.show_hours ? 'the opening hours shown' : 'no opening hours')].filter(Boolean).join(', ') },
  // FOUR, AND THE HOMEPAGE'S STRIP (Oct 20 2026, the setup map): the homepage draws four steps and the Steps card holds
  // four (landing.html, admin-website.html) - a fifth and sixth were never shown and the card's next save dropped them.
  // The separate /how-it-works page is Settings > Business & Content > How It Works Page, not this.
  { name: 'website_steps_set', kind: 'write', confirm: false, say: 'Write the homepage\'s "how it works" strip: its title and up to four short steps, each a title and a line (the separate How It Works page is edited in Settings > Business & Content)',
    params: { type: 'object', properties: { title: { type: 'string', maxLength: 60 }, steps: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 40 }, text: { type: 'string', maxLength: 200 } }, required: ['title'] } } }, required: ['steps'] },
    build: (a) => ({ op: 'content', key: 'steps', set: [['enabled', true], ['items', a.steps.map(x => ({ title: x.title, text: x.text || '' }))]].concat(a.title ? [['title', a.title]] : []) }),
    describe: (a) => `The "how it works" steps${a.title ? ' ("' + a.title + '")' : ''}: ${a.steps.map((x, i) => `${i + 1}. ${x.title}`).join(', ')}` },
  { name: 'website_page_create', kind: 'write', confirm: false, say: 'Make a new page on the website (like "Leagues" or "Birthday parties") with its words; it shows in the footer once published - a NEW page with its own words. Moving a homepage section onto a page is website_section_to_page; the coming-soon (holding) page\'s words are website_holding_set',
    params: { type: 'object', properties: { title: { type: 'string', minLength: 2, maxLength: 60 }, words: { type: 'string', minLength: 1, maxLength: 20000, description: 'the page\'s text; a blank line starts a new paragraph' }, publish: { type: 'boolean', description: 'live now, or a draft for the owner to look at first' } }, required: ['title', 'words'] },
    needs: ['website'],
    build: (a, ctx) => {
      const slug = a.title.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      if (!slug) throw new ActionError('the title needs some letters or numbers');
      // (Oct 22 2026, the breadth set: "give the FAQ its own page" made an empty new page) a page named for a homepage section and
      // with no words of its own is that section moved
      if (!String(a.words || '').trim() || String(a.words || '').trim().length < 40) {
        try { const L = require('../../public/site-layout.js'), t = a.title.trim().toLowerCase();
          const sec = L.defaultLayout(ctx.website || {}).find(b => b && [b.title, b.name, b.type].some(x => String(x || '').trim().toLowerCase() === t || (t.length > 2 && String(x || '').toLowerCase() === t.replace(/s$/, ''))));
          if (sec) throw new ActionError(`"${a.title}" is a section on the homepage - give it its own page with website_section_to_page (section: "${sec.title || sec.name || sec.type}"), which moves it there, words and all`);
        } catch (e) { if (e instanceof ActionError) throw e; } }
      return { op: 'content', key: 'pages', append: { slug, title: a.title, body: a.words, published: !!a.publish, showInNav: false, showInFooter: true, metaTitle: '', metaDescription: '', shareImage: '', kind: 'text', pdf: '', openLabel: '', downloadLabel: '' }, unique: 'slug' };
    },
    describe: (a) => `${a.publish ? 'Publish' : 'Make a draft of'} a new page, "${a.title}", at /p/${a.title.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}` },
  { name: 'website_look_set', kind: 'write', confirm: false, say: 'Change the website\'s look: one of the designed colour sets, and the fonts for headings and text (the booking pages follow the same look)',
    params: { type: 'object', properties: {
      colours: { type: 'string', enum: Object.keys(require('../theme').PRESETS), description: 'a designed colour set: ' + Object.keys(require('../theme').PRESETS).join(', ') },
      heading_font: { type: 'string', enum: Object.keys(require('../theme').FONTS) }, text_font: { type: 'string', enum: Object.keys(require('../theme').FONTS).filter(require('../theme').BODY_OK), description: 'never a script face' } } },
    build: (a) => {
      const set = [];
      if (a.colours) set.push(['custom', false], ['preset', a.colours]);
      if (a.heading_font) set.push(['fonts.heading', a.heading_font], ['fonts.matchAll', false]);
      if (a.text_font) set.push(['fonts.body', a.text_font], ['fonts.matchAll', false]);
      if (!set.length) throw new ActionError('say the colours, the heading font or the text font');
      return { op: 'content', key: 'theme', set };
    },
    describe: (a) => { const F = require('../theme').FONTS; const words = n => n.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); return 'The website\'s look: ' + [a.colours && `the ${words(a.colours)} colours`, a.heading_font && `headings in ${(F[a.heading_font] || {}).label || a.heading_font}`, a.text_font && `text in ${(F[a.text_font] || {}).label || a.text_font}`].filter(Boolean).join(', '); } },
  { name: 'public_part_set', kind: 'write', confirm: true, say: 'Show or hide a part of the public website: booking, memberships, the member portal, events, gift cards, leagues, or the email sign-up page',
    params: { type: 'object', properties: { part: { type: 'string', enum: ['booking', 'memberships', 'portal', 'events', 'giftCards', 'leagues', 'updates'] }, show: { type: 'boolean' } }, required: ['part', 'show'] },
    // the email sign-up page is on exactly while the Email Updates card is (sitenav.publicMap reads settings.signup.enabled
    // for it); writing settings.public.updates did nothing at all (Oct 20 2026, the setup map)
    build: (a) => ({ op: 'content', key: 'settings', set: [[a.part === 'updates' ? 'signup.enabled' : `public.${a.part}`, a.show]] }),
    describe: (a) => { const names = { booking: 'booking (the booking page and My Booking)', memberships: 'memberships (the tiers page and joining online)', portal: 'the member portal', events: 'the events page', giftCards: 'gift cards', leagues: 'the leagues page', updates: 'the email sign-up page' }; return `${a.show ? 'Show' : 'Hide'} ${names[a.part]} on the public website${!a.show ? ' - visitors get the holding page instead, and every link to it hides' : ''}`; } },
  // ── the smart-home hub (Oct 19 2026). maintainer: "Hey, I have this z wave plug. I wanna pair it and it's gonna go
  //    on this bay ... hey, it's paired, turn it on or off or whatever". Pairing is the hub's own (Home Assistant, driven by
  //    services/hadevices.js); a bay's devices are the bay editor's own list; switching is the devices card's own test.
  //    Locks are never switched here: doors open with codes. ──
  { name: 'smarthome_read', kind: 'read', say: 'Look at the smart-home hub and its devices: each device\'s name, kind (Z-Wave, Zigbee, Matter), what it controls, whether each is on, and which bay it is on',
    params: { type: 'object', properties: {} },
    request: () => ({ method: 'GET', path: '/api/admin/smarthome' }),
    digest: (j) => ({ hub: j.hub && j.hub.connected ? { connected: true, radios: j.hub.radios } : { connected: false, why: (j.hub && j.hub.reason) || j.reason || 'not connected' },
      devices: (j.devices || []).map(d => ({ device: d.name, kind: d.kind, maker: d.maker || undefined, model: d.model || undefined, controls: d.controls.map(c => ({ control: c.entity_id, name: c.name, is: c.state, bay: c.bay || 'not on a bay' })) })),
      // the whole facility's devices (Oct 21 2026): what each follows, its times, and what it is doing now and why
      facility: (j.facility || []).length ? j.facility.map(f => ({ device: f.name, control: f.entity_id, kind: f.kind, follows: f.follows === 'hours' ? 'the opening hours' : 'the bookings in any bay',
        on_before_mins: f.minutes_before, keeps_on_if_next_booking_within_mins: f.keep_on_gap, standby_after_mins: f.minutes_after, goes_to_standby: f.turns_off, now: f.now, why: f.why || undefined })) : undefined,
      pairing_now: j.pairing && j.pairing.pairing ? j.pairing.say : undefined }) },
  { name: 'smarthome_setup', kind: 'write', confirm: false, say: 'Set up the smart-home hub built into this unit (its Home Assistant and the Z-Wave and Matter radios) - only when the hub says it is not set up - ONLY when the owner asks to set up the hub, or a pairing they asked for needs it; never on your own while answering something else',
    params: { type: 'object', properties: {} },
    build: () => ({ op: 'http', method: 'POST', path: '/api/admin/smarthome/setup' }),
    describe: () => 'Set up the smart-home hub built into this unit' },
  { name: 'device_pair', kind: 'write', confirm: false, say: 'Pair a new smart-home device with the hub: a Z-Wave or Zigbee plug, switch, light, thermostat or sensor, or a Matter device ALREADY SET UP in its own app (or Apple Home or Google Home) with the code that app shows to share it - a new Matter device goes into its own app first, tell the owner so. The chat shows the owner what to press, asks for the PIN on a secure device\'s label itself, and tells you what joined',
    params: { type: 'object', properties: { kind: { type: 'string', enum: ['zwave', 'zigbee', 'matter'], description: 'zwave, zigbee or matter - it says on the device or its box' }, code: { type: 'string', maxLength: 60, description: 'a Matter device\'s sharing code: the 11 digits (or MT:...) its app shows when the owner shares it from the app it was set up in' } }, required: ['kind'] },
    build: (a) => {
      if (a.kind === 'matter' && !a.code) throw new ActionError('a Matter device is set up in its own app first (or Apple Home or Google Home), then shared from there - tell the owner so, and ask for the code that app shows');
      return { op: 'pair', protocol: a.kind, code: a.kind === 'matter' ? a.code : undefined };
    },
    // "pair a new Z-Wave plug" (Oct 23 2026, the 4B: it asked what the plug was instead of starting the pairing) - the kind said
    // plainly; a Matter device only with its pairing code in the words (else it is asked for)
    read: (words) => {
      const s = String(words || ''), m = s.match(/\bpair\w*\b[^.?!]{0,30}?\b(z-?wave|zigbee|matter)\b/i); if (!m) return null;
      const kind = m[1].toLowerCase().replace('-', ''), code = (s.match(/\b(\d{4}-?\d{3}-?\d{4}|\d{11})\b/) || [])[1];
      return kind === 'matter' ? (code ? { kind, code } : null) : { kind };
    },
    describe: (a) => `Pair a ${{ zwave: 'Z-Wave', zigbee: 'Zigbee', matter: 'Matter' }[a.kind]} device with the hub` },
  { name: 'device_name_set', kind: 'write', confirm: false, say: 'Give a smart-home device a name the owner will know, like "Bay 2 Projector" (read the devices first)',
    params: { type: 'object', properties: { device: { type: 'string', minLength: 1, maxLength: 80, description: 'the device\'s name now, or one of its controls' }, name: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['device', 'name'] },
    needs: ['smarthome'],
    build: (a, ctx) => { const d = findDevice(ctx, a.device); return { op: 'http', method: 'POST', path: `/api/admin/smarthome/devices/${encodeURIComponent(d.id)}/name`, body: { name: a.name } }; },
    describe: (a, ctx) => `Call ${findDevice(ctx, a.device).name} "${a.name}"` },
  { name: 'bay_device_add', kind: 'write', confirm: true, say: 'Put a smart-home device on ONE bay so it follows that bay\'s bookings: power (on a few minutes before each session, off after) or climate (a comfort temperature during sessions, idle after). A thermostat, the heat and AC, or a TV or light for the whole room goes on the facility instead (facility_device_set) - one bay\'s session ending must never turn those off',
    params: { type: 'object', properties: {
      bay: { type: 'string', minLength: 1, maxLength: 60 },
      device: { type: 'string', minLength: 1, maxLength: 80, description: 'the device\'s name, or one of its controls (like switch.bay_2_plug)' },
      use: { type: 'string', enum: ['power', 'climate'], description: 'power: on before a session, off after; climate: a thermostat' },
      minutes_before: { type: 'integer', minimum: 1, maximum: 60, description: 'power: how many minutes before a session it turns on (10 when not said)' },
      turn_off_after: { type: 'boolean', description: 'power: off after the session (yes, unless it must stay on - like the plug a PC runs from)' },
      minutes_after: { type: 'integer', minimum: 5, maximum: 120, description: 'power: minutes after the session it turns off (30 when not said)' },
      comfort_temp: { type: 'number', minimum: 40, maximum: 95, description: 'climate: during sessions (70 when not said)' },
      eco_temp: { type: 'number', minimum: 40, maximum: 95, description: 'climate: idle while heating (60 when not said)' },
      cool_eco_temp: { type: 'number', minimum: 40, maximum: 95, description: 'climate: idle while the AC is on (the heating setback mirrored above comfort when not said - 80)' } }, required: ['bay', 'device'] },
    needs: ['bays', 'smarthome', 'facility'],
    build: (a, ctx) => {
      const i = bayIndex(ctx, a.bay), bay = ctx.bays[i];
      { const onFac = findDevice(ctx, a.device).controls.find(c => (ctx.facility || []).some(f => f.entity_id === c.entity_id)); if (onFac) throw new ActionError(`${findDevice(ctx, a.device).name} is on the whole facility - take it off the facility first (facility_device_remove) if it should follow ${bay.name} alone`); }
      const climate = a.use === 'climate' || (a.use !== 'power' && findDevice(ctx, a.device).controls.some(c => c.what === 'climate') && !findDevice(ctx, a.device).controls.some(c => POWER.includes(c.what)));
      const c = findControl(ctx, a.device, climate ? ['climate'] : POWER);
      const cur = Array.isArray(bay.haDevices) ? bay.haDevices : [];
      if (cur.some(d => d.entity_id === c.entity_id)) throw new ActionError(`${c.name} is already on ${bay.name}`);
      const dev = climate
        ? Object.assign({ name: c.device.name, entity_id: c.entity_id, kind: 'climate', comfortTemp: a.comfort_temp != null ? a.comfort_temp : 70, ecoTemp: a.eco_temp != null ? a.eco_temp : 60, leadTimeMins: 15, setbackDelayMins: 10 }, a.cool_eco_temp != null ? { coolEcoTemp: a.cool_eco_temp } : {})
        : { name: c.device.name, entity_id: c.entity_id, kind: 'power', minutesBefore: a.minutes_before || 10, turnOffAfter: a.turn_off_after !== false, minutesAfter: a.minutes_after || 30 };
      // what the proposal was built against must still be so when it is applied: the same bay, the same list
      const expect = [[`bays.${i}.id`, bay.id]].concat(Array.isArray(bay.haDevices) ? [[`bays.${i}.haDevices.length`, cur.length]] : []);
      return { op: 'config', set: [[`bays.${i}.haDevices`, cur.concat([dev])]], expect };
    },
    describe: (a, ctx) => {
      const i = bayIndex(ctx, a.bay), bay = ctx.bays[i];
      const d = findDevice(ctx, a.device);
      const climate = a.use === 'climate' || (a.use !== 'power' && d.controls.some(c => c.what === 'climate') && !d.controls.some(c => POWER.includes(c.what)));
      if (climate) { const T = require('../homeassistant').climateTargets({ comfortTemp: a.comfort_temp != null ? a.comfort_temp : 70, ecoTemp: a.eco_temp != null ? a.eco_temp : 60, coolEcoTemp: a.cool_eco_temp }); return `Put ${d.name} on ${bay.name} as its climate: ${T.comfort.heat} degrees during sessions; idle ${T.eco.heat} while heating, ${T.eco.cool} with the AC on`; }
      return `Put ${d.name} on ${bay.name}: on ${a.minutes_before || 10} minutes before each session${a.turn_off_after === false ? ', left on after' : `, off ${a.minutes_after || 30} minutes after it ends`}`;
    } },
  { name: 'bay_device_remove', kind: 'write', confirm: true, say: 'Take a smart-home device off a bay, so it no longer follows the bay\'s bookings (the device stays paired)',
    params: { type: 'object', properties: { bay: { type: 'string', minLength: 1, maxLength: 60 }, device: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['bay', 'device'] },
    needs: ['bays', 'smarthome'],
    build: (a, ctx) => {
      const i = bayIndex(ctx, a.bay), bay = ctx.bays[i];
      const cur = Array.isArray(bay.haDevices) ? bay.haDevices : [];
      const n = String(a.device).trim().toLowerCase();
      let ids;
      try { const d = findDevice(ctx, a.device); ids = d.controls.map(c => c.entity_id); } catch (e) { ids = [n]; }
      const keep = cur.filter(d => !ids.includes(d.entity_id) && String(d.name || '').toLowerCase() !== n);
      if (keep.length === cur.length) throw new ActionError(`"${a.device}" is not on ${bay.name} (on it: ${cur.map(d => d.name || d.entity_id).join(', ') || 'no smart-home devices'})`);
      return { op: 'config', set: [[`bays.${i}.haDevices`, keep]], expect: [[`bays.${i}.id`, bay.id], [`bays.${i}.haDevices.length`, cur.length]] };
    },
    describe: (a, ctx) => `Take ${a.device} off ${ctx.bays[bayIndex(ctx, a.bay)].name}: it stays paired, and no longer follows that bay's bookings` },
  // THE WHOLE FACILITY'S DEVICES (Oct 21 2026; maintainer: "heat and Ac would be a facility one ... if there's no bookings for 3 hours,
  // then I'll turn it back down to the Standby mode ... the TV's, if there's no bookings within an hour, just turn the TV [off]
  // and turn it back [on] 10 minutes before the next booking"). services/facilitydevices runs them; this sets them. One action
  // adds a device or changes one already there, so the owner can say any part of it at any time
  { name: 'facility_device_set', kind: 'write', confirm: true, say: 'Put a smart-home device on the whole facility, or change one already there - the heat and AC (thermostats belong here), a lounge TV, the sign, the lobby lights. It comes on before the first booking in any bay, stays on while the next booking anywhere starts within the gap, and goes to standby (off, or a thermostat to its idle temperature) when nothing is booked inside it - one bay\'s booking ending never turns it off. Or it follows the opening hours. When setting one up, ask the owner: how early it comes on, and how long a gap between bookings keeps it on (if they have no number: a thermostat three hours, a TV one hour); a thermostat\'s temperatures',
    params: { type: 'object', properties: {
      device: { type: 'string', minLength: 1, maxLength: 80, description: 'the device\'s name, or one of its controls (like climate.lobby)' },
      use: { type: 'string', enum: ['power', 'climate'], description: 'power: on and off (a TV, lights, a plug); climate: a thermostat. Left out, a thermostat is climate and anything else power' },
      follows: { type: 'string', enum: ['bookings', 'hours'], description: 'bookings: around the bookings in any bay (the usual); hours: the opening hours, and any booking outside them' },
      minutes_before: { type: 'integer', minimum: 0, maximum: 240, description: 'how early it comes on before the first booking (or opening) - 10 for power, 15 for a thermostat when not said' },
      keep_on_gap: { type: 'integer', minimum: 0, maximum: 720, description: 'minutes: it stays on while the next booking starts within this long after one ends; 0 = standby as soon as each run of bookings ends. A thermostat 180, power 60 when not said' },
      minutes_after: { type: 'integer', minimum: 0, maximum: 240, description: 'minutes after the last booking ends that it goes to standby (10 when not said)' },
      stays_on: { type: 'boolean', description: 'power only: true = never switched off once on' },
      comfort_temp: { type: 'number', minimum: 40, maximum: 95, description: 'thermostat: while bookings are on (70 when not said)' },
      idle_heat_temp: { type: 'number', minimum: 40, maximum: 95, description: 'thermostat: standby while heating, below comfort (60 when not said)' },
      idle_cool_temp: { type: 'number', minimum: 40, maximum: 95, description: 'thermostat: standby with the AC on, above comfort (the heating standby mirrored above comfort when not said - 80)' } }, required: ['device'] },
    needs: ['bays', 'smarthome', 'facility'],
    // the owner's own numbers when the model left them out (Oct 23 2026, the 4B: "on 30 minutes before the first booking" came without
    // its 30): how early, how long after, and the gap it stays on through ("if there's no bookings for 3 hours")
    fill: (a, ctx) => {
      const w = String((ctx && ctx.newest) || '').toLowerCase(), out = Object.assign({}, a);
      const mins = (n, u) => (/^h/.test(u) ? (/^half/.test(n) ? 30 : /^an?$/.test(n) ? 60 : Number(n) * 60) : Number(n));
      const AMT = '(\\d{1,3}|an?|half an?)\\s*(hours?|hrs?|min(?:ute)?s?)';
      let m;
      if (out.minutes_before === undefined && (m = w.match(new RegExp('\\b' + AMT + '\\s*(?:before|early|ahead)')))) out.minutes_before = mins(m[1], m[2]);
      if (out.minutes_after === undefined && (m = w.match(new RegExp('\\b' + AMT + '\\s*after')))) out.minutes_after = mins(m[1], m[2]);
      if (out.keep_on_gap === undefined && (m = w.match(new RegExp('\\bno (?:bookings?|one booked|sessions?) (?:for|in) ' + AMT)))) out.keep_on_gap = mins(m[1], m[2]);
      return out;
    },
    build: (a, ctx) => {
      const d = findDevice(ctx, a.device), n = String(a.device).trim().toLowerCase();
      if (n.startsWith('lock.') || d.controls.every(c => c.what === 'lock')) throw new ActionError('a lock is never put on automation by talking - doors open with the booking\'s code');
      if (ctx.facility === null) throw new ActionError('the settings could not be read - try again');
      const cur = Array.isArray(ctx.facility) ? ctx.facility : [];
      const existing = cur.find(f => d.controls.some(c => c.entity_id === f.entity_id));
      const climate = a.use ? a.use === 'climate' : existing ? existing.kind === 'climate' : (d.controls.some(c => c.what === 'climate') && !d.controls.some(c => POWER.includes(c.what) && c.what !== 'fan'));
      const c = existing && !a.use ? (d.controls.find(x => x.entity_id === existing.entity_id) || findControl(ctx, a.device, climate ? ['climate'] : POWER)) : findControl(ctx, a.device, climate ? ['climate'] : POWER);
      const onBay = (ctx.bays || []).find(b => (b.haDevices || []).some(x => x.entity_id === c.entity_id));
      if (onBay) throw new ActionError(`${d.name} is on ${onBay.name} - take it off the bay first (bay_device_remove), so one bay's session never turns it off`);
      const base = existing ? Object.assign({}, existing) : { name: d.name, entity_id: c.entity_id };
      const dev = Object.assign(base, { entity_id: c.entity_id, kind: climate ? 'climate' : 'power' });
      if (a.follows) dev.follows = a.follows; else if (!dev.follows) dev.follows = 'bookings';
      if (a.keep_on_gap != null) dev.keepOnGapMins = a.keep_on_gap; else if (dev.keepOnGapMins == null) dev.keepOnGapMins = climate ? 180 : 60;
      if (climate) {
        if (a.minutes_before != null) dev.leadTimeMins = a.minutes_before; else if (dev.leadTimeMins == null) dev.leadTimeMins = 15;
        if (a.minutes_after != null) dev.setbackDelayMins = a.minutes_after; else if (dev.setbackDelayMins == null) dev.setbackDelayMins = 10;
        if (a.comfort_temp != null) dev.comfortTemp = a.comfort_temp; else if (dev.comfortTemp == null) dev.comfortTemp = 70;
        if (a.idle_heat_temp != null) dev.ecoTemp = a.idle_heat_temp; else if (dev.ecoTemp == null) dev.ecoTemp = 60;
        if (a.idle_cool_temp != null) dev.coolEcoTemp = a.idle_cool_temp;
        const T = require('../homeassistant').climateTargets(dev);
        if (!(T.eco.heat < T.comfort.heat)) throw new ActionError(`the standby while heating (${T.eco.heat}) must be below the comfort temperature (${T.comfort.heat})`);
        if (!(T.eco.cool > T.comfort.heat)) throw new ActionError(`the standby with the AC on (${T.eco.cool}) must be above the comfort temperature (${T.comfort.heat})`);
      } else {
        if (a.minutes_before != null) dev.minutesBefore = a.minutes_before; else if (dev.minutesBefore == null) dev.minutesBefore = 10;
        if (a.minutes_after != null) dev.minutesAfter = a.minutes_after; else if (dev.minutesAfter == null) dev.minutesAfter = 10;
        if (a.stays_on != null) dev.turnOffAfter = !a.stays_on; else if (dev.turnOffAfter == null) dev.turnOffAfter = true;
      }
      const next = existing ? cur.map(f => f === existing ? dev : f) : cur.concat([dev]);
      return { op: 'config', set: [['homeAssistant.facilityDevices', next]], expect: Array.isArray(ctx.facility) ? [['homeAssistant.facilityDevices.length', cur.length]] : [] };
    },
    describe: (a, ctx) => {
      const d = findDevice(ctx, a.device), cur = ctx.facility || [];
      const existing = cur.find(f => d.controls.some(c => c.entity_id === f.entity_id));
      const climate = a.use ? a.use === 'climate' : existing ? existing.kind === 'climate' : (d.controls.some(c => c.what === 'climate') && !d.controls.some(c => POWER.includes(c.what) && c.what !== 'fan'));
      const v = (k, x, dflt) => a[k] != null ? a[k] : existing && existing[x] != null ? existing[x] : dflt;
      const gap = v('keep_on_gap', 'keepOnGapMins', climate ? 180 : 60), mins = m => m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`;
      const follows = (a.follows || (existing && existing.follows)) === 'hours' ? 'from before opening until after closing, and for any booking outside the hours' : `from ${v('minutes_before', climate ? 'leadTimeMins' : 'minutesBefore', climate ? 15 : 10)} minutes before the first booking in any bay, kept there while the next booking anywhere is within ${mins(gap)}`;
      const head = existing ? `${d.name}, on the whole facility` : `Put ${d.name} on the whole facility`;
      if (climate) {
        const T = require('../homeassistant').climateTargets({ comfortTemp: v('comfort_temp', 'comfortTemp', 70), ecoTemp: v('idle_heat_temp', 'ecoTemp', 60), coolEcoTemp: v('idle_cool_temp', 'coolEcoTemp', null) });
        return `${head}: ${T.comfort.heat} degrees ${follows}; then standby ${v('minutes_after', 'setbackDelayMins', 10)} minutes after the last booking ends - ${T.eco.heat} while heating, ${T.eco.cool} with the AC on. One bay's session ending never turns it down`;
      }
      const stays = a.stays_on != null ? a.stays_on : existing ? existing.turnOffAfter === false : false;
      return `${head}: on ${follows}${stays ? ', and left on' : `; off ${v('minutes_after', 'minutesAfter', 10)} minutes after the last booking ends`}. One bay's session ending never turns it off`;
    } },
  { name: 'facility_device_remove', kind: 'write', confirm: true, say: 'Take a device off the whole facility, so it no longer follows the bookings or the hours (it stays paired, and is left as it is now)',
    params: { type: 'object', properties: { device: { type: 'string', minLength: 1, maxLength: 80, description: 'the device\'s name, or one of its controls' } }, required: ['device'] },
    needs: ['smarthome', 'facility'],
    build: (a, ctx) => {
      if (ctx.facility === null) throw new ActionError('the settings could not be read - try again');
      const cur = Array.isArray(ctx.facility) ? ctx.facility : [], n = String(a.device).trim().toLowerCase();
      let ids; try { ids = findDevice(ctx, a.device).controls.map(c => c.entity_id); } catch (e) { ids = [n]; }
      const keep = cur.filter(f => !ids.includes(f.entity_id) && String(f.name || '').toLowerCase() !== n);
      if (keep.length === cur.length) throw new ActionError(`"${a.device}" is not on the facility (on it: ${cur.map(f => f.name || f.entity_id).join(', ') || 'nothing yet'})`);
      return { op: 'config', set: [['homeAssistant.facilityDevices', keep]], expect: [['homeAssistant.facilityDevices.length', cur.length]] };
    },
    describe: (a) => `Take ${a.device} off the whole facility: it stays paired and is left as it is now, and no longer follows the bookings` },
  // A THERMOSTAT SET NOW ("set the lobby to 68", "it's cold in here, bump the heat to 72") - one temperature, for the mode the
  // thermostat is in; its schedule (a bay's or the facility's) sets it again at its next change (Oct 21 2026, the device audit)
  { name: 'thermostat_set', kind: 'write', confirm: false, say: 'Set a thermostat to a temperature now ("set the lobby to 68"). It is set for the mode it is in (heating, cooling, or heat/cool around that number); a thermostat someone switched off is left alone. Its schedule sets it again at its next change',
    params: { type: 'object', properties: { device: { type: 'string', minLength: 1, maxLength: 80, description: 'the thermostat\'s name, or its control (climate.lobby)' }, temperature: { type: 'number', minimum: 40, maximum: 95 } }, required: ['device', 'temperature'] },
    needs: ['smarthome'],
    build: (a, ctx) => { const c = findControl(ctx, a.device, ['climate']); return { op: 'http', method: 'POST', path: '/api/admin/homeassistant/climate', body: { entity_id: c.entity_id, temperature: a.temperature } }; },
    describe: (a, ctx) => { const c = findControl(ctx, a.device, ['climate']); return `Set ${c.device.name} to ${a.temperature} degrees now${c.bay ? ' (it is on ' + c.bay + '; its schedule sets it again at its next change)' : ''}`; } },
  { name: 'device_switch', kind: 'write', confirm: (a) => a.on === false, confirmSay: ' (turning something off is shown to the owner to approve first)',
    say: 'Turn a smart-home device on or off now - a plug, a light, a switch - to test it after pairing, or because the owner asked (never a lock: doors open with codes)',
    params: { type: 'object', properties: { device: { type: 'string', minLength: 1, maxLength: 80, description: 'the device\'s name, or one of its controls' }, on: { type: 'boolean' } }, required: ['device', 'on'] },
    needs: ['smarthome'],
    build: (a, ctx) => {
      const n = String(a.device).trim().toLowerCase();
      if (n.startsWith('lock.') || findDevice(ctx, a.device).controls.every(c => c.what === 'lock')) throw new ActionError('the assistant never locks or unlocks a door - doors open with the booking\'s code');
      const c = findControl(ctx, a.device, POWER.concat(['climate']));
      return { op: 'http', method: 'POST', path: '/api/admin/homeassistant/control', body: { entity_id: c.entity_id, on: a.on } };
    },
    describe: (a, ctx) => { const c = findControl(ctx, a.device, POWER.concat(['climate'])); return `Turn ${c.device.name} ${a.on ? 'on' : 'off'} now${c.bay ? ' (it is on ' + c.bay + (a.on ? '' : ' - if a session is playing there, it goes off for them too') + ')' : ''}`; } },
  { name: 'cancellation_window_set', kind: 'write', confirm: true, say: 'Set how many hours before a booking a customer can still cancel it',
    params: { type: 'object', properties: { hours: { type: 'integer', minimum: 0, maximum: 168 } }, required: ['hours'] },
    build: (a) => ({ op: 'config', set: [['cancellationPolicy.windowHours', a.hours]] }),
    describe: (a) => `Customers can cancel up to ${a.hours} hour${a.hours === 1 ? '' : 's'} before their booking` },

  // ── which AI answers (maintainer, Oct 20 2026: "we're not shipping them a five thousand dollar computer ... they can add a token
  // or API key to talk to their big models if they want") - chosen by talking; the key itself is pasted into the chat,
  // where the page saves it (secrets.js), and never passes through a tool ──
  { name: 'ai_service_read', kind: 'read', say: 'See which AI model answers this chat (the OpenAI or Claude connection the owner saved in Hosted AI settings), whether it is answering, where the owner\'s requests go, and the model names that service offers. The connection itself is changed only in Admin > Owner Chat > Hosted AI settings',
    params: { type: 'object', properties: {} },
    local: async () => {
      const s = await require('./model').status();
      return { answering_with: s.name, model: s.model || undefined, answering: !!s.reachable, problem: s.error || s.connect || undefined,
        model_not_offered: s.modelListed === false || undefined, where_requests_go: s.where, models_offered: (s.models || []).slice(0, 25),
        change_it_in: 'Admin > Owner Chat > Hosted AI settings (the key is never typed into this chat)' };
    } },
  { name: 'ai_service_set', kind: 'write', confirm: true, say: 'Choose which AI answers this chat: the box\'s own (private, nothing leaves the box), or the owner\'s own service with their own key - OpenAI (ChatGPT), Anthropic (Claude), or another service at its own address. The owner pastes the key into the chat; never put a key in a tool',
    params: { type: 'object', properties: {
      service: { type: 'string', enum: ['box', 'openai', 'anthropic', 'other'] },
      model: { type: 'string', maxLength: 100, description: 'the model name exactly as the service lists it (not for the box)' },
      address: { type: 'string', maxLength: 300, description: 'only for another service: its address, like https://example.com/v1' } }, required: ['service'] },
    build: (a) => {
      if (a.service === 'box') return { op: 'config', set: [['assistant.provider', 'box']] };
      const m = String(a.model || '');
      if (!m) throw new ActionError('which model? ask the owner - once their key is saved, ai_service_read lists what the service offers');
      if (!/^[A-Za-z0-9._:\/@-]+$/.test(m)) throw new ActionError('a model name is letters, numbers, dots, dashes, colons and slashes');
      const set = [['assistant.provider', a.service], ['assistant.cloudModel', m]];
      if (a.service === 'other') {
        let u; try { u = new URL(String(a.address || '')); } catch { throw new ActionError('another service needs its address, like https://example.com/v1'); }
        if (!/^https?:$/.test(u.protocol)) throw new ActionError('the address starts with https://');
        set.push(['assistant.cloudEndpoint', u.href.replace(/\/+$/, '')]);
      }
      return { op: 'config', set };
    },
    describe: (a) => {
      const n = require('./model').NAMES[a.service];
      return a.service === 'box' ? 'Answer with the box\'s own AI - everything stays on this box'
        : `Answer with ${n}${a.model ? ' (' + a.model + ')' : ''}: your requests, and what the assistant looks up to answer them, go to ${n}, and what it costs is billed to your key. When it does not answer, the box's own AI does`;
    } },

  // ── THE SETUP CHAT'S OWN PIECES (Oct 20 2026; maintainer approved the mock: "the light chat UI and walk through and the this is
  //    how it looks as they build it") ──
  // quick answers: the owner taps one instead of typing. Ending the turn with a question and its likely answers is how
  // the assistant leads ("how does your facility run?" - staffed, self-serve, a mix)
  { name: 'ask_owner', kind: 'say', say: 'Ask the owner one question, with two to six short answers to tap (they can still type their own). Use it when leading setup or when a choice has a few clear options',
    params: { type: 'object', properties: { question: { type: 'string', minLength: 3, maxLength: 300 }, choices: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 60 } } }, required: ['question', 'choices'] } },
  // photos the owner added in the chat (the page uploads them through the Website editor's own route and names their
  // addresses); the model cannot see them, so it asks which leads when it is not clear
  { name: 'website_hero_photos_set', kind: 'write', confirm: false, say: 'Put photos the owner added in the chat at the top of the website (the hero): up to three, in order - the first leads, and is also the picture shown when the site is shared and behind the bay screens between sessions - only for the TOP of the homepage (the big photo); photos for the gallery are website_gallery_add',
    params: { type: 'object', properties: { photos: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', maxLength: 200 }, description: 'the photos\' addresses as the chat gave them, like /uploads/landing/123-bays.jpg' } }, required: ['photos'] },
    build: (a) => ({ op: 'content', key: 'hero', set: [['images', a.photos.map(photoPath)]] }),
    describe: (a) => `The photo${a.photos.length === 1 ? '' : 's'} at the top of your website: ${a.photos.length} photo${a.photos.length === 1 ? '' : 's'}, the first one leading. Rebuild the bay watchers to show it behind their screens.` },
  { name: 'website_gallery_add', kind: 'write', confirm: false, say: 'Add photos the owner added in the chat to the website\'s gallery, each with a short caption (the caption is what a screen reader says) - the gallery section; the photos at the top of the homepage are website_hero_photos_set',
    params: { type: 'object', properties: { photos: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'object', properties: { photo: { type: 'string', maxLength: 200 }, caption: { type: 'string', maxLength: 120 } }, required: ['photo'] } } }, required: ['photos'] },
    build: (a) => ({ op: 'content', key: 'gallery', push: [['items', a.photos.map(x => ({ img: photoPath(x.photo), caption: x.caption || '' }))]] }),
    describe: (a) => `Add ${a.photos.length} photo${a.photos.length === 1 ? '' : 's'} to your website's gallery` },
  { name: 'logo_upload', kind: 'write', confirm: false, say: 'Ask the owner for their logo: the chat shows a button to pick the file (JPG, PNG or WebP), and it becomes the logo on the website and the app icons',
    params: { type: 'object', properties: {} },
    build: () => ({ op: 'upload', route: '/api/uploads/logo', field: 'image', accept: 'image/png,image/jpeg,image/webp', label: 'Choose your logo' }),
    describe: () => 'Your logo: pick the picture (JPG, PNG or WebP, up to 10 MB). It goes on your website and becomes your app icon. (If your bay screens already show a logo, rebuild their watchers after.)' },
  // (Oct 22 2026, maintainer: "try it insted of skipping things go through it") the owner's own waiver PDF, picked in the chat, made the waiver
  // customers sign - the owner's document from their own lawyer; the box never writes or judges its words (rule 15)
  { name: 'waiver_upload', kind: 'write', confirm: false, say: 'Ask the owner for their waiver PDF: the chat shows a button to pick it, and it becomes the waiver customers sign (their own document - never write, find or judge one)',
    params: { type: 'object', properties: {} },
    build: (a, ctx) => ({ op: 'upload', route: '/api/waivers/upload', field: 'waiver', accept: 'application/pdf', label: 'Choose your waiver PDF', fields: { name: 'Liability waiver', version: (ctx && ctx.today) || new Date().toISOString().slice(0, 10), setActive: 'true' } }),
    describe: () => 'Your waiver: pick the PDF of your own waiver (up to 20 MB). It becomes the one customers sign when they book - you can add a newer version any time on the Waivers tab.' },
  // (Oct 22 2026, maintainer's try box: the logo added with the chat's photo button was never made the logo)
  { name: 'logo_from_photo', kind: 'write', confirm: false, say: 'Make a photo the owner just added in the chat (its /uploads/landing/... address) the logo - on the website and the app icons. For a logo not added yet, logo_upload',
    params: { type: 'object', properties: { photo: { type: 'string', minLength: 18, maxLength: 200, description: 'the photo\'s address, /uploads/landing/...' } }, required: ['photo'] },
    build: (a) => { if (!/^\/uploads\/landing\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(a.photo)) throw new ActionError('that is not the address of a photo added in the chat (/uploads/landing/...)'); return { op: 'http', method: 'POST', path: '/api/uploads/logo/from-photo', body: { path: a.photo } }; },
    describe: (a) => `Your logo: the picture you just added (${String(a.photo).split('/').pop().replace(/^\d+-/, '')}) - on your website and as the icon people save to their phone` },
  { name: 'bay_watcher_download', kind: 'write', confirm: false, say: 'Build a bay\'s watcher (the Session Monitor) for the owner to download and install on that bay\'s PC - one zip per bay, never another bay\'s',
    params: { type: 'object', properties: { bay: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['bay'] },
    needs: ['bays'],
    build: (a, ctx) => { const b = (ctx.bays || [])[bayIndex(ctx, a.bay)]; return { op: 'download', path: `/api/admin/bays/${encodeURIComponent(b.id)}/monitor-package`, label: `Download ${b.name}'s watcher` }; },
    describe: (a, ctx) => { const b = (ctx.bays || [])[bayIndex(ctx, a.bay)] || { name: a.bay }; return `The bay watcher for ${b.name}: a zip for that bay's PC. Copy it over, take out any older auto-start, run install-monitor.bat as administrator, then restart the PC.`; } },
  { name: 'bay_pc_signin_set', kind: 'write', confirm: false, say: 'Save a bay PC\'s Windows ADMIN sign-in, so the bay can shut the PC down after sessions: the user name (Admin unless they say otherwise) and, optionally, the PC\'s address; the owner types the password in a private box the assistant never sees',
    params: { type: 'object', properties: { bay: { type: 'string', minLength: 1, maxLength: 60 }, user: { type: 'string', maxLength: 60, description: 'the ADMIN account\'s Windows user name' },
      address: { type: 'string', maxLength: 15, description: 'the PC\'s IPv4 address, when it is known (from the network scan)' } }, required: ['bay'] },
    needs: ['bays'],
    build: (a, ctx) => {
      const bays = ctx.bays || []; const i = bayIndex(ctx, a.bay);
      if (a.address && (!/^(\d{1,3}\.){3}\d{1,3}$/.test(a.address) || a.address.split('.').some(n => Number(n) > 255))) throw new ActionError(`"${a.address}" is not a network address`);
      const set = [[`bays.${i}.simulatorWinUser`, a.user || bays[i].simulatorWinUser || 'Admin']];
      if (a.address) set.push([`bays.${i}.simulatorPcIp`, a.address]);
      return { op: 'secret', configPath: `bays.${i}.simulatorWinPass`, set, expect: [[`bays.${i}.id`, bays[i].id]], label: 'The PC\'s Windows ADMIN password', hint: 'It must not be blank - Windows refuses to shut down a PC from an account with no password.', minLength: 1 };
    },
    describe: (a, ctx) => { const b = (ctx.bays || [])[bayIndex(ctx, a.bay)] || { name: a.bay }; return `The Windows sign-in ${b.name} uses to shut its PC down: user ${a.user || b.simulatorWinUser || 'Admin'}${a.address ? ', at ' + a.address : ''}. Type the password below - it goes straight to your settings, never into the chat.`; } },
];
// ── WHAT THE ASSISTANT READS BEFORE IT BUILDS A CHANGE: each action names what it needs, read once a turn through the
//    owner's own routes (the engine runs them; a build itself never waits on the network) ──
const LOADERS = {
  roster: async (ctx) => { try { const r = await ctx.call('GET', '/api/staff/roster'); return (r.json && r.json.staff) || []; } catch { return []; } },
  subscribers: async (ctx) => { try { const r = await ctx.call('GET', '/api/website/subscribers?per=1'); return Number(r.json && r.json.active) || 0; } catch { return 0; } },
  bays: async (ctx) => { try { const r = await ctx.call('GET', '/api/admin/config'); return (r.json && r.json.bays) || []; } catch { return []; } },
  // who decides staffed hours right now: a season in Settings > Schedule outranks the Website calendar (main, Oct 19 2026)
  staffing: async (ctx) => { try { const r = await ctx.call('GET', `/api/website/staffed?from=${ctx.today}&to=${ctx.today}`); const j = r.json || {}; return { season: j.season || null, scheduleOff: !!j.scheduleOff, schedulingOn: !!j.schedulingOn }; } catch { return {}; } },
  smarthome: async (ctx) => { try { const r = await ctx.call('GET', '/api/admin/smarthome'); return (r.json && r.json.devices) || []; } catch { return []; } },
  // the whole facility's devices as saved (homeAssistant.facilityDevices - Oct 21 2026): false when none was ever saved (a
  // proposal then expects nothing of the list), null when the settings could not be read
  facility: async (ctx) => { try { const r = await ctx.call('GET', '/api/admin/config'); const h = (r.json && r.json.homeAssistant) || {}; return Array.isArray(h.facilityDevices) ? h.facilityDevices : false; } catch { return null; } },
  // the facility's opening hours, for a bare hour read as the evening (helpers.eveningIfClosed)
  hours: async (ctx) => { try { const r = await ctx.call('GET', '/api/admin/config'); const b = (r.json && r.json.booking) || {}; return { openTime: b.openTime, closeTime: b.closeTime, closeNextDay: !!b.closeNextDay, open24Hours: !!b.open24Hours, openDays: Array.isArray(b.openDays) ? b.openDays : null, dayHours: require('../hours').dayHours(b) }; } catch { return {}; } },
  // the website as the editor holds it (drafts included: the owner is signed in)
  website: async (ctx) => { try { const r = await ctx.call('GET', '/api/website/content'); return (r.json && r.json.content) || {}; } catch { return {}; } },
};

// ── THE AREAS (Oct 20 2026; maintainer: "the AI needs to know and have access to everything. and control everything"). Every action
//    belongs to one area; a small model on the box is handed the areas the talk is about (engine.js), and each area beyond
//    the first ones lives in its own file under areas/, built with the same helpers ──
const AREA_OF = {
  setup_status: 'core', health_read: 'core', guide_chapter: 'core', guide_search: 'core', ask_owner: 'core',
  schedule_read: 'staff', staffed_read: 'staffing', roster_read: 'staff', schedule_add_shift: 'staff', schedule_remove_shift: 'staff', schedule_copy_week: 'staff',
  staffed_set_day: 'staffing', staffed_remove_day: 'staffing', staffed_set_weekly: 'staffing', requests_read: 'staff', request_decide: 'staff',
  business_name_set: 'setup', opening_hours_set: 'setup', location_set: 'setup', website_address_set: 'setup', access_style_set: 'setup',
  setup_confirm: 'setup', waiver_mode_set: 'setup', waiver_policy_set: 'setup', site_go_live: 'site',
  cancellation_window_set: 'setup', backup_passphrase_set: 'setup', ai_service_read: 'setup', ai_service_set: 'setup',
  announcement_set: 'website', website_headline_set: 'website', event_add: 'events', website_promo_set: 'website', website_contact_set: 'site',
  website_steps_set: 'website', website_page_create: 'pages', website_look_set: 'look', public_part_set: 'site', website_hero_photos_set: 'photos',
  website_gallery_add: 'photos', logo_upload: 'look',
  network_scan: 'baysetup', bay_pc_link: 'baysetup', bay_plug_add: 'baysetup', plug_switch: 'bays', bay_watcher_download: 'baysetup', bay_pc_signin_set: 'baysetup',
  smarthome_read: 'smarthome', smarthome_setup: 'smarthome', device_pair: 'smarthome', device_name_set: 'smarthome', bay_device_add: 'smarthome',
  bay_device_remove: 'smarthome', device_switch: 'smarthome', facility_device_set: 'smarthome', facility_device_remove: 'smarthome', thermostat_set: 'smarthome',
  tiers_read: 'members', membership_tier_create: 'members', base_price_set: 'money',
  newsletters_read: 'messages', newsletter_send: 'messages', email_sender_set: 'messages', texting_number_set: 'messages',
};
for (const a of ACTIONS) a.area = a.area || AREA_OF[a.name] || 'core';
// THE CLOCK TIMES EACH CHANGE CARRIES (Oct 27 2026, THE BARE-HOUR RULE - helpers.js clockOf): every write with a time of day in it, its
// [start field, end field] pairs (or [the one time]), read by the engine against the owner's own words, with the facility's hours, before
// the change is built - so the card shows the hours meant, or the owner is asked which; and what the change can hold past midnight
// (engine.js nightSpan): 'runs' on into the next day, 'shift' (two shifts), 'day' (ends at 11:59 PM), 'cannot' (two windows - the model
// explains). markers: the words before a lone time ("move it to 9"). An event's start (in its words) and a closing or opening hour are
// read by their own fills, by the same rule.
// (Until Oct 27 2026 only six actions were read - EVENING: a staffed day, a booking, a deal's or a plan's window and a season took the
// model's half of the day as given - "we are staffed tonight 6 to 11" went up 6 AM to 11 AM, "20% off bookings that start between 9 and
// 11 at night" 9 AM to 11 AM: the critic of round 2c)
const CLOCKS = {
  block_add: { pairs: [['start_time', 'end_time']], night: 'runs' }, counter_special_set: { pairs: [['from_time', 'to_time']], night: 'runs' },
  schedule_add_shift: { pairs: [['start_time', 'end_time']], night: 'shift' }, schedule_change_shift: { pairs: [['start_time', 'end_time']], night: 'shift' },
  staffed_set_day: { pairs: [['start_time', 'end_time']], night: 'day' }, staffed_set_weekly: { pairs: [['start_time', 'end_time']], night: 'day' },
  season_hours_set: { pairs: [['start_time', 'end_time']], night: 'day' }, season_create: { pairs: [['start_time', 'end_time'], ['other_start_time', 'other_end_time']], night: 'day' },
  price_window_add: { pairs: [['start_time', 'end_time']], night: 'cannot' }, price_window_change: { pairs: [['start_time', 'end_time']], night: 'cannot' },
  deal_set: { pairs: [['start_from', 'start_until']], night: 'cannot' }, package_set: { pairs: [['start_from', 'start_until']], night: 'cannot' },
  membership_tier_create: { pairs: [['earliest_time', 'latest_time']], night: 'cannot' }, membership_tier_change: { pairs: [['earliest_time', 'latest_time']], night: 'cannot' },
  booking_make: { pairs: [['time']] }, booking_move: { pairs: [['to_time']], markers: 'to|at|@|for' },
  clock_entry_fix: { pairs: [['clock_in'], ['clock_out']] },
};
// what an area file is handed: the checks, the words and the finders every action shares
const HELPERS = H;
const AREA_FILES = ['website', 'bays', 'messages', 'money', 'operations', 'menu', 'insights', 'connections', 'upkeep', 'online', 'deals'];
for (const f of AREA_FILES) {
  const mod = require('./areas/' + f)(HELPERS);
  for (const a of mod.actions || []) { if (!a.area) a.area = f; ACTIONS.push(a); }
  Object.assign(LOADERS, mod.loaders || {});
}
// NOT IN BA CORE COMMUNITY: there is no updater here (a newer release is installed by running its install.sh on the Pi),
// and the AI model and its key are set only in Admin > Owner Chat > Hosted AI settings - never by a tool or in the chat.
const NOT_IN_COMMUNITY = new Set(['updates_read', 'updates_check', 'update_install', 'update_tonight_cancel', 'update_undo',
  'updates_auto_check_set', 'update_file_install', 'ai_service_set',
  'texts_signed_as_set']);   // texts are signed with the business name here; there is no short brand to set
for (let i = ACTIONS.length - 1; i >= 0; i--) if (NOT_IN_COMMUNITY.has(ACTIONS[i].name)) ACTIONS.splice(i, 1);
// the areas in one fixed order, core first: a model server keeps the work of the unchanged start of a prompt, so a turn that
// adds an area changes only what follows it
const AREA_ORDER = ['core', 'setup', 'website', 'events', 'photos', 'flyers', 'pages', 'look', 'site', 'online', 'bays', 'baysetup', 'routines', 'smarthome', 'staff', 'staffing', 'members', 'money', 'messages', 'bookings', 'menu', 'numbers', 'unit', 'doors'];
const AREA_SAY = {
  setup: 'opening hours, open 24 hours, how the facility runs, the booking rules (shortest and longest session, how far ahead, the gap between bookings, bay or time first), members only, the whole building as one space, its name, legal name, location, contact details and time zone, early bay access, the backup passphrase, which AI answers this chat',
  website: 'the website\'s content: the homepage\'s sections and their words, weekly specials, a food menu section, the top of the page, a notice across the top, undo',
  // (Oct 21 2026, night) the website's tools in four parts: a small model on the box reads about 5,200 tokens of them for the
  // homepage, not 8,000, and an event, a page or a photo brings only its own
  events: 'events on the website: leagues, scrambles, clinics, tournaments - add one, change it, take it off, what is coming up',
  photos: 'photos on the website: the photos at the top of the page, the gallery, the slides under the top',
  flyers: 'flyers for a deal, package, event or special',
  pages: 'the owner\'s own pages on the website: make one, rename it or put it in the menu, take it off, move a section onto one, the whole site on one page, the how-it-works page',
  look: 'the website\'s look: colours, fonts, the style (buttons, corners, spacing, the top of the page), the logo',
  online: 'getting the box online: its address (the domain), whether that domain is on Cloudflare yet, its email records and DNSSEC, connecting the box to the owner\'s own Cloudflare ("connect my box"), whether the site answers from outside',
  site: 'the website\'s settings: what is public, the homepage, the menu, social links, search and sharing, contact details, email sign-up, visitor counting, the holding page',
  bays: 'running the bays now: a whole bay or every bay on or off, one plug, out of service, restart or wake a bay\'s PC, a frozen bay, what the automation could not do',
  baysetup: 'setting the bays up: a bay\'s PC (its address, wake ID, Windows sign-in), smart plugs (added, renamed, moved), when each device comes on and goes off, how long bays stay on between sessions, the bay watchers, TVs (their BroadLink remotes found, put on a bay, their codes learned from their own remote, taken off), a bay\'s name and price, adding a bay or naming them all',
  // (Oct 22 2026) the routines are their own part: half the bay setup's tokens, and a TV or a plug talk does not need them
  routines: 'routines on a bay\'s PC: taught by clicking through once ("watch me"), run on a hotkey or when a session starts or ends, the PC starts, a program opens or closes or a window appears; a routine\'s steps, copied to other bays, taken off',
  smarthome: 'smart-home devices: pair one, name it, put it on a bay or on the whole facility (the heat and AC, a lounge TV), switch it',
  staff: 'staff and the schedule: shifts (add, change, give to someone, open), copying weeks and saved patterns, time off and shift requests, the time clock (who is on, hours, fixes), staff who can sign in',
  staffing: 'staffed hours: which days and hours someone is at the counter, the seasons that decide them, switching staffed hours off',
  members: 'memberships and members',
  money: 'prices and rates for days and times, prices under the time slots, discount codes, deposits, gift cards, revenue and End of Day, whether Stripe, email and texting are connected, card readers and the tip prompt, refunds made in Stripe',
  messages: 'emails, texts, newsletters, the words of the messages customers get, which are sent, the owner\'s own alerts, the inbox, webhooks (Zapier and the like), STOP replies',
  bookings: 'bookings: who is booked, a price for a time, make one at the counter, move one, cancel one (with the refund the owner names), a stuck checkout, block off a bay or the whole building, check-in',
  numbers: 'how the business is doing, in numbers: a period against the same days before it (bookings, hours, how full the bays were, customers new and coming back, money taken, memberships sold, best sellers), one day\'s bookings (how many, the longest, tomorrow), who is playing now, the tax collected and the tax as a spreadsheet, the tax rates',
  unit: 'the unit itself: software updates (check, install now or tonight, undo, an update file BA emailed), files of the records to download (revenue, bookings, staff hours, the year-end report, the email sign-up list)',
  doors: 'door codes: which lock they go to, how long before and after a session a code works, when it is texted, whether the lock is checked first',
  menu: 'the food and drink menu - the counter\'s, which the servers ring up and the website shows live: its parts (Food, Beer, Wine, Burgers...), items and prices, a line about an item, sold out (86), a new part\'s tax and where its tickets print',
};
const areasNow = () => AREA_ORDER.filter(x => x !== 'core' && ACTIONS.some(a => a.area === x)).concat([...new Set(ACTIONS.map(a => a.area))].filter(x => !AREA_ORDER.includes(x)));
// a small model asks for the tools of another part of the facility when the ones it was handed do not fit (the engine adds
// them for the rest of the turn); what each area holds is said in the enum's own words
ACTIONS.push({ name: 'more_tools', kind: 'read', area: 'core',
  say: 'Get the tools for another part of the facility when none of yours fits what the owner asked. The parts: ' + areasNow().map(x => `${x} (${AREA_SAY[x] || x})`).join('; '),
  params: { type: 'object', properties: { areas: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: areasNow() } } }, required: ['areas'] },
  local: (a, ctx) => {
    const want = (a.areas || []).filter(x => areasNow().includes(x));
    if (!want.length) return { error: 'the parts are: ' + areasNow().join(', ') };
    if (ctx.wantAreas) want.forEach(x => ctx.wantAreas.add(x));
    return { now_available: ACTIONS.filter(x => want.includes(x.area)).map(x => ({ tool: x.name, does: x.say.length > 90 ? x.say.slice(0, 90).replace(/\s+\S*$/, '') + '...' : x.say })) };
  } });
for (const a of ACTIONS) if (CLOCKS[a.name]) { a.clocks = CLOCKS[a.name]; a.evening = CLOCKS[a.name].pairs[0]; }
// every action's own reader answers nothing for words that say not to (SAID NOT, above) - one guard for them all, so a reader added
// tomorrow has it too; a reader's own words for when something stops are its own (READ_OWN); and a reader with a READ_HEAD reads
// only a request that starts with a word it knows (Oct 27 2026)
// (Oct 27 2026, the review of round 2) and a reading is put up only when a day the owner left out is not one of its days (A DAY LEFT
// OUT), and - for a reader that makes money, a door, a device, a routine or the site's menu - when every word is one it knows (WHAT A
// READER THAT MAKES SOMETHING KNOWS THE WORDS OF)
for (const a of ACTIONS) if (typeof a.read === 'function' && !a.read.saidNotGuard) {
  const own = a.read, mine = READ_OWN[a.name], gate = READ_HEAD[a.name], name = a.name;
  a.read = function (words, conv, ctx) {
    if (saidNot(words, mine) || (gate && !headKnown(words, gate, ctx))) return null;
    const r = own.call(this, words, conv, ctx); if (!r) return r;
    const out = daysLeftOut(plainWords(words));
    if (out) { const d = daysRead(r); if (!d.length || d.some(x => out.has(x))) return null; }
    return plainMaking(name, words, r, ctx || {}) ? r : null;
  };
  a.read.saidNotGuard = true;
  if (gate) a.read.headGate = true;
  if (PLAIN_VOCAB[name]) a.read.plainWords = true;
}
const BY_NAME = new Map(ACTIONS.map(a => [a.name, a]));
const AREAS = areasNow();

/** The tools as an OpenAI-style chat-with-tools request names them (llama.cpp's server, Ollama, OpenAI) - all of them, or
 *  only those of the areas named (the order never changes, so the model server can keep the work of an unchanged start). */
function tools(areas) {
  const clean = (s) => { if (!s || typeof s !== 'object') return s; const o = Array.isArray(s) ? [] : {}; for (const [k, v] of Object.entries(s)) if (!k.startsWith('x-')) o[k] = clean(v); return o; };
  const want = areas ? new Set(['core'].concat([...areas])) : null;
  const rank = (a) => { const i = AREA_ORDER.indexOf(a.area); return i < 0 ? AREA_ORDER.length : i; };
  return ACTIONS.filter(a => !want || want.has(a.area)).map((a, i) => [a, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([a]) => ({ type: 'function', function: { name: a.name, description: a.say + (a.kind === 'write' && a.confirm ? (a.confirmSay || ' (the owner is shown this and approves it)') : ''), parameters: clean(a.params) } }));
}

/** What the owner's page shows for "what can you do?" - plain words, no internals. */
function publicCatalog() {
  return { can: ACTIONS.map(a => ({ name: a.name, say: a.say, changes: a.kind === 'write', asksFirst: a.kind === 'write' && (typeof a.confirm === 'function' ? 'sometimes' : !!a.confirm) })) };
}

module.exports = { ACTIONS, BY_NAME, AREAS, AREA_ORDER, AREA_SAY, LOADERS, HELPERS, tools, publicCatalog, check, ActionError, normDate, normTime, staffCode, bayIndex, findDevice, findControl, dayWords, timeWords, addDays };
