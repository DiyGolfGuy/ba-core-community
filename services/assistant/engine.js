// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/assistant/engine.js - THE CONVERSATION (Oct 19 2026)
//
//  maintainer: "They just talk to it, because that's what people are doing now"; "the a I just needs to prompt the owner when
//  they're there and they're setting it up". One turn:
//    1. the owner's words come in already scrubbed by their page; anything still key-shaped is removed here and never
//       reaches the model (services/assistant/secrets.js);
//    2. the model gets a short brief - what it is, the facility's own date and time, the rules it keeps, the setup
//       steps still to do (it leads the owner through them, one question at a time) and the guide passages that match
//       the question (services/assistant/knowledge.js) - and the action list as its tools;
//    3. a READ it asks for is run here, through the owner's own route with the owner's own session, and its short
//       digest goes back to the model (up to MAX_ROUNDS rounds);
//    4. a WRITE it asks for is checked against the action list (unknown names, unreadable arguments and arguments that
//       fail the action's own checks go back to the model as errors to fix) and built into the exact request the
//       owner's screen would make. It is never run here: it goes to the owner's page as a proposal, applied with the
//       owner's own session - straight in when it only changes how things look, on the owner's yes when it touches
//       money, doors, hours, staffing or the schedule;
//    5. what happened to each proposal (applied, refused by the route, or not wanted) comes back through applied(); a
//       change the owner made is written in the owner's log (ASSISTANT_APPLIED), a refusal too (ASSISTANT_REFUSED, rule
//       29), and the model is told so it can say what happened.
//  Conversations live in memory only: what is said is not kept on the unit until maintainer rules on keeping it (an open
//  question in docs/internal/FOR-SALE-FROM-FOREMAN.md, section 6). A restart starts a new conversation.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const actions = require('./actions');
const secrets = require('./secrets');
const spelling = require('./spelling');
const knowledge = require('./knowledge');
const screens = require('./screens');
const model = require('./model');
const setupAnswers = require('./setupanswers');
const setupGuide = require('./setupguide');
const quickCards = require('./quickcards');
const answers = require('./answers');
const intents = require('./intents');
// THE SETUP, LED BY THE BOX (setupguide.js - maintainer, Oct 22 2026: "it needs to be more guide like on the start up"): the changes that
// answer a setup step - once one is made, the box asks the next step itself; the day a skipped step was last brought up again
const GUIDE_ACTS = new Set(['setup_skip', 'setup_confirm', 'location_set', 'website_address_set', 'bays_list_set', 'bay_add', 'access_style_set', 'opening_hours_set', 'open_24_hours_set',
  'staffed_set_day', 'staffed_set_weekly', 'base_price_set', 'price_window_add', 'waiver_mode_set', 'waiver_policy_set', 'membership_tier_create', 'checkin_mode_set', 'email_sender_set',
  'texting_number_set', 'logo_upload', 'logo_from_photo', 'waiver_upload', 'backup_passphrase_set', 'site_go_live', 'members_only_set', 'whole_facility_set', 'business_name_set', 'website_steps_set', 'website_headline_set']);
let guideRemindedOn = null;
// the step each change answers - once one is made in the talk, its step is never asked again in it, whatever the checklist still says
// (test-setup-guide, Oct 22 2026: a logo saved whose app icons could not be made from it was asked for again, and again)
const STEP_OF = { location_set: 'citystate', website_address_set: 'domain', bays_list_set: 'confirmbays', access_style_set: 'access', opening_hours_set: 'confirmhours',
  open_24_hours_set: 'confirmhours', staffed_set_weekly: 'staffedhours', staffed_set_day: 'staffedhours', base_price_set: 'confirmprice', waiver_mode_set: 'confirmwaiver', waiver_upload: 'waiverdoc',
  membership_tier_create: 'tier', checkin_mode_set: 'checkin', email_sender_set: 'resend', texting_number_set: 'twilio', logo_upload: 'branding', logo_from_photo: 'branding',
  backup_passphrase_set: 'backuppass', site_go_live: 'golive' };
// AN ACCOUNT, WALKED A STEP AT A TIME (setupguide.js walkSteps): where each walk got to - kept beside the box's own talks, so an owner
// who reloads the page after a while in Stripe's tab picks up at the same step
const walkAt = new Map();
function walkShow(conv, svc, i, lead, offline) {
  const steps = setupGuide.walkSteps(svc); if (!steps.length) return null;
  const at = Math.max(0, Math.min(i, steps.length - 1)), w = setupGuide.walkSay(svc, steps, at, cfgNow());
  conv.walk = { svc, i: at, text: w.text }; walkAt.set(svc, at);
  // (a step that needs the site online, on a box that is not: said first - Twilio's reviewers turn down a campaign whose site they cannot
  // open, and the $15 review fee is not given back; the 4B walk-through, Oct 22 2026)
  if (offline && /must be online|online and your site open/i.test(steps[at].text)) { w.text = 'Hold on - your box is not online yet, so the reviewers could not open your site. Say "get my box online" first; when it is online, say "set up texting" and I will pick up right here.\n\n' + w.text; conv.walk.text = w.text; }
  const text = (lead ? lead + '\n\n' : '') + w.text;
  conv.messages.push({ role: 'assistant', content: text });
  return { conversation: conv.id, reply: text, choices: w.choices, proposals: [] };
}
const cfgNow = () => { try { return require('../config').getConfig(); } catch { return {}; } };
const itemFor = (items, step) => { const it = (items || []).find(i => i && (i.id === step.id || (step.also || []).includes(i.id))); return it ? it.id : step.id; };
// a change the box puts up itself, outside a model round (a step's card - the logo's "Choose your logo"; a skip): pending like the
// model's own, its call in the talk so its result has a place - { p, call }
function boxProposal(conv, ctx, name, args) {
  const a = actions.BY_NAME.get(name); if (!a) return null;
  const id = 'box_' + crypto.randomBytes(4).toString('hex'), aa = args || {};
  const p = { id, action: a.name, args: aa, request: a.build(aa, ctx), describe: a.describe(aa, ctx), confirm: typeof a.confirm === 'function' ? !!a.confirm(aa, ctx) : !!a.confirm, screen: screens.screenOf(a.name, aa, ctx) };
  conv.pending.set(id, p);
  return { p, call: { id, type: 'function', function: { name: a.name, arguments: JSON.stringify(aa) } } };
}
// the box's words for a step, with the step's card beside them when it has one (the card waits for the owner's pick or "Not now")
function guideSay(conv, ctx, step, text, choices) {
  const card = step && step.card ? boxProposal(conv, ctx, step.card, {}) : null;
  conv.messages.push(Object.assign({ role: 'assistant', content: text }, card ? { tool_calls: [card.call] } : {}));
  return { conversation: conv.id, reply: text, choices: card ? [] : choices, proposals: card ? [publicProposal(card.p)] : [] };
}
// the box's next setup question, after `lead` (what was just done): { reply, choices }, the step remembered as asked - or, with
// nothing left, the end of the setup
function guideNext(conv, ctx, lead) {
  const cfg = cfgNow(), nx = setupGuide.next(ctx.setup, conv.guidePassed);
  if (nx) {
    const q = setupGuide.question(nx.step, cfg, lead || null);
    conv.guide = { id: nx.step.id, item: nx.item.id, text: nx.step.ask(cfg), taps: q.taps };
    return guideSay(conv, ctx, nx.step, q.text, q.choices);
  }
  // (what was put off is offered once the rest are done - each by name, to tap)
  const sk = setupGuide.skippedSteps(ctx.setup);
  if (sk.length && !conv.skippedOffered) {
    conv.skippedOffered = true;
    const text = `That is everything except what you skipped: ${sk.map(x => x.step.name).join(', ')}. Want to do one of those now?`;
    conv.guide = { id: '__skipped', item: '', text, taps: {}, offer: sk.map(x => ({ id: x.step.id, item: x.item.id, name: x.step.name })) };
    const reply = (lead ? lead + '\n\n' : '') + text;
    conv.messages.push({ role: 'assistant', content: reply });
    return { conversation: conv.id, reply, choices: sk.slice(0, 5).map(x => x.step.name[0].toUpperCase() + x.step.name.slice(1)).concat(['Not now']), proposals: [] };
  }
  conv.guideOn = false; conv.guide = null;
  // (what to ask from here is this facility's own - quickcards.js, maintainer, Oct 25 2026; this used to offer "a menu, a special, a
  // membership, your staff schedule" to every facility, a club with no counter and nobody working there included)
  const qc = quickCards.cards(shapeFor(ctx), ctx.cardsAsked, CARDS_SHOWN);
  const reply = (lead ? lead + '\n\n' : '') + 'That is everything on the setup list - nice work. Anything you skipped I will bring up again later. From here, ask me anything about running ' + (ctx.businessName || 'your facility') + ' - ' + (qc.length ? 'a few to start are below.' : 'or tell me what you want changed.');
  conv.messages.push({ role: 'assistant', content: reply });
  return { conversation: conv.id, reply, choices: qc.length ? qc.concat([quickCards.MORE]) : ['What else can you do?', 'Is my site ready?'], proposals: [] };
}

const MAX_ROUNDS = 4;
const MAX_MESSAGES = 60;
const MAX_CONVERSATIONS = 20;
const conversations = new Map();
const adminLog = (ev, d) => { try { require('../db').adminLog(ev, String(d).slice(0, 300)); } catch {} };

function create() {
  if (conversations.size >= MAX_CONVERSATIONS) { const oldest = [...conversations.values()].sort((a, b) => a.used - b.used)[0]; conversations.delete(oldest.id); }
  const c = { id: crypto.randomBytes(8).toString('hex'), messages: [], pending: new Map(), used: Date.now(), full: require('./privacy').full() };
  conversations.set(c.id, c);
  return c;
}
// A TOOL'S ANSWER STAYS WHOLE JSON WHEN IT IS CUT (Oct 20 2026, the demo brain's run): a fuller site's website_read
// crossed the 3,000-character cut mid-object, and the model was handed broken JSON. Now long lists keep their first
// items and say how many more, long words are shortened, and only as a last resort the answer becomes { cut, text } -
// still JSON. Plain words (a string) are cut as words.
const RESULT_LIMIT = 3000;
function shrink(v, n) {
  if (typeof v === 'string') return v.length > n ? v.slice(0, n) + '...' : v;
  if (Array.isArray(v)) { const keep = v.slice(0, Math.max(1, Math.floor(n / 50))).map(x => shrink(x, n)); return v.length > keep.length ? keep.concat([`... and ${v.length - keep.length} more`]) : keep; }
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = shrink(x, n); return o; }
  return v;
}
const trim = (o) => {
  if (typeof o === 'string') return o.length > RESULT_LIMIT ? o.slice(0, RESULT_LIMIT) + ' ...(cut)' : o;
  let s = JSON.stringify(o);
  for (const n of [400, 200, 120, 60, 30]) { if (s.length <= RESULT_LIMIT) return s; s = JSON.stringify(shrink(o, n)); }
  return s.length <= RESULT_LIMIT ? s : JSON.stringify({ cut: true, text: s.slice(0, RESULT_LIMIT - 40) });
};

// THE BRIEF IN TWO PARTS (Oct 19 2026): the rules never change from turn to turn, so the model server can keep their
// work (llama.cpp's server reuses the longest unchanged start of a prompt - on a box with no graphics card, reading the
// prompt is the slow part of an answer). What changes - the date and time, what is waiting, the setup steps, the guide
// passages for this question - rides with the owner's newest words only, and is not kept in the conversation.
function rules(ctx) {
  const lines = [
    'You are the assistant built into this facility\'s booking system (BA Core). You help the owner run the facility by talking with them.',
    '',
    'How you work:',
    '- You look things up and change things ONLY with the tools you are given. Never invent a tool, a setting or a fact about this facility.',
    '- When the owner asks for a change, call the tool. The owner is shown the change in plain words and approves anything about money, doors, hours, staffing or the schedule, so you do not ask "are you sure".',
    // (Oct 23 2026, a real Claude: "make a code SPRING20 for 20% off" was answered "Should it have an end date?" - the box leaves off
    // what was not said, and the card says so. The box's own small model already does; the line goes to the owner's own service
    // only, so the small model's prompt does not grow - test-assistant A40d)
    ...(model.settings().provider === 'box' ? [] : ['- Something optional the owner did not mention (an end date, a limit) is left off - never ask about it first.']),
    '- In tool calls, dates are YYYY-MM-DD and times are HH:MM on the 24-hour clock. A bare hour ("5 to 10", "from 6") is the afternoon or evening at a golf facility - 17:00 to 22:00, 18:00 - unless the owner says am or morning.',
    '- When a tool answers with an error, tell the owner simply what went wrong and what they can do.',
    '- Keys and passwords: the chat saves them itself when the owner pastes them. Never repeat one, and never ask for one to be typed into your answer. The backup passphrase is backup_passphrase_set: the chat shows the owner a masked box for it - never ask them to type it to you.',
    '- Never write waiver wording, policy wording or anything legal, and never call anything compliant or enforceable: those are the owner\'s own documents, for their own lawyer.',
    '- The waiver document is the owner\'s own PDF, added on the Waivers tab (Admin > Waivers); the chat cannot take it - say where it goes.',
    '- Hours and the schedule are for scheduling, never payroll: no wages, overtime law or tax.',
    '- What the unit cannot do for the owner (an account with Twilio, Stripe or Resend, a domain and its Cloudflare account, a carrier registration, a lock maker\'s account), walk them through with guide_chapter - from the guide, never from what you remember of other companies: one part at a time, in order, waiting for them to finish each; quote links exactly as the guide gives them; when a screen looks different from the guide, say the provider may have changed it and give the provider\'s own page.',
    '- Smart-home devices: pair a new one with device_pair (the chat shows the owner what to press); then ask what it is and which bay it is for, name it with device_name_set, put it on the bay with bay_device_add, and offer to test it with device_switch. Right after pairing, call the new device by one of its controls (like switch.smart_plug_2): two of the same make start with the same name. You never lock or unlock a door.',
    '- Keep answers short. Ask one question at a time. When the question has a few clear answers, ask it with ask_owner and give them as short answers to tap.',
    '- Photos the owner adds in the chat come to you as their addresses (/uploads/landing/...). You cannot see them; the owner can. Ask which should lead if it is not clear, then use website_hero_photos_set (up to three, the first leads) and website_gallery_add. For the logo use logo_upload.',
    '- The website: read it with website_read before changing a section. A new section (weekly specials, a menu, an FAQ, cards...): when the owner has not said where it goes, ask with ask_owner - right after the top of the page, after another section, or near the end. Looks are website_style_set (a whole look, or one place) and website_colors_set; every website change can be undone.',
    '- "(About the homepage\'s section ...)" at the start of a message means the owner pointed at that part of their site: change that one. "(The owner undid: ...)" means they took that change back: do not make it again unless they ask.',
    '- The bays: a whole bay or every bay on or off is bay_switch or all_bays_switch; one thing in a bay is device_switch or plug_switch. Turning anything off, out of service or a restart is shown to the owner first.',
    '- A result that lists what "failed" is only partly done: say which did not answer and offer to check the bays with bay_read - never just "done".',
    '- Money is never guessed: ask whether a refund is full, half or none, and whether a gift card was sold or given free. A new member\'s PIN and a gift card\'s code show to the owner on their page - you never see them; say so.',
    // what the AI reads of a customer (services/assistant/privacy.js - maintainer, Oct 21 2026, latest)
    require('./privacy').full()
      ? '- You run on the box itself, so nothing you read leaves the building: you see customers\' whole names, and their phone numbers and emails where a read gives them - answer the owner\'s questions with them. Never put a customer\'s details into anything that leaves the unit (a newsletter, a text, a webhook) unless the owner asks for exactly that. Staff by name, never their sign-in code; never a door code, a member PIN or a gift card code.'
      : '- You see customers as a first name and last initial, never their phone or email (you are a hosted AI service on the owner\'s own key, so what you read leaves the building); staff by name, never their sign-in code.',
    '- When none of your tools fits what the owner asks, call more_tools for that part of the facility before saying you cannot.',
    '- The owner often does not know what the box can do. When they ask what you can do, or are unsure what they want, name a few things in plain words (the parts in more_tools) and give two to four of them as answers to tap (ask_owner). When you cannot do exactly what they asked, say so and offer what you CAN do that comes closest, as answers to tap.',
    '- Each owner message starts with what is true right now at the facility; use it, do not repeat it back.',
  ];
  return lines.join('\n');
}
// THE NEXT TWO WEEKS, WRITTEN OUT (Oct 21 2026, night - the 4B on the laptop, the scored set): "any bookings on Saturday?" on a
// Wednesday the 21st was asked for the 23rd (a Friday), "Sunday" the 24th, "next Thursday" the 28th (a Wednesday) - a small
// model's own date sums. The days are read, never worked out
const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function calendar(today) {
  const t = new Date(String(today || '') + 'T12:00:00Z'); if (isNaN(t)) return '';
  const out = []; for (let i = 1; i <= 14; i++) { const d = new Date(t.getTime() + i * 86400000); out.push(`${DAY3[d.getUTCDay()]} ${d.toISOString().slice(0, 10)}`); }
  return `The next two weeks: ${out.join(', ')}. A weekday on its own ("Saturday") is the next one after today - a week on when today is that day; today is "today".`;
}
// WHICH SATURDAY? (maintainer, Oct 24 2026: "maybe ask what Saturday and put a date to chose from for stuff like that"): today's weekday
// named on its own - "block the vault on saturday" said on a Saturday - is today or a week on, and the owner picks. Plain, never
// asked: "this", "next", "last" or "every" before it, the plural ("saturdays"), another weekday beside it, or today, tonight,
// tomorrow or a date in the words. A short form counts only before a time or the end ("sat 4 to 11", "any bookings sat?" - never
// "the customer sat down"); no "sun" for Sunday at all.
const WEEKDAY_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT = ['sunday', 'mon', 'tues?', 'wed', 'thu(?:rs?)?', 'fri', 'sat'];
const SHORT_BEFORE = '(?=\\s*(?:$|[,.!?]|\\d|at\\b|from\\b|morning|afternoon|evening|night|noon|for\\b|to\\b))';
const NAME_CARDS = new Set(['staff_add', 'member_add', 'booking_make']);   // the cards that add a new person by name
// what could not be done, for the owner (A REFUSED CHANGE IS NEVER REPLACED IN SILENCE): a refusal's own words only when they read as
// the owner's - many are written for the model (a tool's name, "ask the owner", "say ...") and those are left out
const OWNER_SAFE = (w) => !!w && w.length <= 200 && !/\b[a-z]+_[a-z_]+\b|\bthe owner\b|^\s*(?:say|ask|use|pick)\b|\(\w+ with \w+\)/i.test(w);
function refusedSay(list) {
  const why = list.map(x => x.why).find(OWNER_SAFE);
  return why ? `That could not be done: ${why.charAt(0).toLowerCase() + why.slice(1)}.`.replace(/\.\.$/, '.') : 'That could not be done as asked.';
}
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function sameWeekday(words, today) {
  const w = String(words || '').toLowerCase(), t = new Date(String(today || '') + 'T12:00:00Z');
  if (!w || isNaN(t)) return null;
  if (/\b(?:today|tonight|tomorrow|tmrw)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/.test(w)) return null;
  const any = w.match(new RegExp(`\\b(?:(?:${WEEKDAY_FULL.join('|')})\\b|(?:${WEEKDAY_SHORT.slice(1).join('|')})\\b${SHORT_BEFORE})`, 'g')) || [];
  if (any.length !== 1) return null;
  const d = t.getUTCDay(), m = w.match(new RegExp(`(?:\\b(this|next|last|every|each)\\s+)?\\b(?:${WEEKDAY_FULL[d]}\\b|${WEEKDAY_SHORT[d]}\\b${SHORT_BEFORE})`));
  if (!m || m[1]) return null;
  const name = WEEKDAY_FULL[d][0].toUpperCase() + WEEKDAY_FULL[d].slice(1), week = actions.addDays(today, 7);
  const lab = (iso) => { const x = new Date(iso + 'T12:00:00Z'); return `${DAY3[x.getUTCDay()]}, ${MON3[x.getUTCMonth()]} ${x.getUTCDate()}`; };
  return { name, question: `Which ${name} - today (${lab(today)}) or next ${name} (${lab(week)})?`, choices: [`Today (${lab(today)})`, `Next ${name} (${lab(week).slice(5)})`], values: [today, week] };
}
// the weekdays named in words (0 = Sunday), each once - a short form only where it cannot be another word ("sat down", "wed like")
function weekdaysIn(words) {
  const re = new RegExp(`\\b(?:(?:${WEEKDAY_FULL.join('|')})\\b|(?:${WEEKDAY_SHORT.slice(1).join('|')})\\b${SHORT_BEFORE})`, 'g');
  const idx = (x) => WEEKDAY_FULL.indexOf(x) >= 0 ? WEEKDAY_FULL.indexOf(x) : WEEKDAY_SHORT.findIndex((s, i) => i > 0 && new RegExp('^(?:' + s + ')$').test(x));
  return [...new Set((String(words || '').toLowerCase().match(re) || []).map(idx))].filter(d => d >= 0);
}
function now(ctx, guide) {
  const lines = [`Right now: it is ${ctx.weekday} ${ctx.today}, ${ctx.time} at ${ctx.businessName || 'the facility'}.`];
  const cal = calendar(ctx.today); if (cal) lines.push(cal);
  if (ctx.shape) lines.push(quickCards.facilityLine(ctx.shape));   // (so the model's own answers fit it - quickcards.js, Oct 25 2026)
  if (ctx.movedOn) lines.push(`(The owner did not answer "${String(ctx.movedOn).slice(0, 140)}" - they asked for something new. Leave that change; do only what they say now.)`);
  // (the owner's answer to the box's "Which hours?" is never the model's to read since Oct 27 2026 - the bare-hour rule; that note is gone)
  if (ctx.movedOnModel) lines.push(`(Your question "${String(ctx.movedOnModel).slice(0, 140)}" was not answered - the owner asked something new. Do what they say now; leave the earlier change unless they bring it back.)`);
  const parts = ((ctx.menu || {}).cats || []);
  if (parts.length) lines.push(`The menu's parts now (the owner's own - an item joins the one it belongs in): ${parts.slice(0, 30).map(c => `${c.name}${c.active === 0 ? ' (off)' : ''} (${(c.items || []).length} item${(c.items || []).length === 1 ? '' : 's'})`).join(', ')}.`);
  if ((ctx.waiting || []).length) {
    lines.push('', 'Waiting for the owner right now (mention these when the owner opens the chat or asks what needs doing):');
    for (const w of ctx.waiting.slice(0, 8)) lines.push('- ' + w);
  }
  const todo = (ctx.setup || []).filter(s => !s.done);
  // the setup list leads when the talk is the setup (an answer, a hello, "what's next", a change just made); a request about
  // something else gets one line, not the list (Oct 21 2026, night: "add an FAQ" was answered with the unfinished setup steps)
  const setupTalk = !(ctx.wordsNamed || []).length || ctx.appliedSomething || /\b(?:next|set ?up|setup|checklist|left to do|what now|where (?:do|should) (?:I|we) start)\b/i.test(ctx.newest || '');
  // (once only what is optional or was put off is left, the setup no longer leads: the owner is asking about the facility now - the
  // quick cards, Oct 25 2026; what was put off is brought up once a day by the box itself, setupguide.js hello)
  const leads = todo.some(s => !s.optional && !s.skipped);
  if (todo.length && !setupTalk) lines.push('', `(Setup has ${todo.length} step${todo.length === 1 ? '' : 's'} left - the owner asked for something else now: do that.)`);
  else if (todo.length && !leads) lines.push('', `(Setup is done apart from what is optional or was put off: ${todo.slice(0, 6).map(s => s.label).join(', ')}. Bring these up only when the owner asks what is left.)`);
  else if (todo.length) {
    // (Oct 21 2026, latest - read as a small model reads it) an order to lead setup on every turn pulled "turn on The Vault"
    // toward setup; it leads when the talk is about setup, and what the owner asks for comes first
    lines.push('', 'Setup is not finished. When the owner opens the chat, asks what is next or answers a setup question, lead them through these one at a time and say what each is for. When they ask for something else, do that first:');
    // (Oct 21 2026, night) "Business name & logo" with the name already given on the first screen: the box's small model asked
    // for the name again - the step is the logo
    const label = (s) => s.id === 'branding' && ctx.businessName ? `Your logo (the business name, ${ctx.businessName}, is set)` : s.label;
    todo.slice(0, 8).forEach((s, i) => lines.push(`${i + 1}. ${label(s)}${s.optional ? ' (optional)' : ''}${s.sub ? ' - ' + s.sub : ''}`));
  }
  if (guide === null) {
    // a request to DO something ("turn on The Vault"): no guide passages - the ones its words matched were about other things,
    // and a small model reads every word it is given (Oct 21 2026, latest)
  } else if (guide && guide.length) {
    lines.push('', 'From the BA guide (use it when it answers the question; say so when it does not):');
    for (const g of guide) lines.push(`[${g.heading}]`, g.text);
  } else {
    // nothing matched: a small model told nothing guesses (another project's prompt says the same to its big ones)
    lines.push('', 'The BA guide has nothing that matches this. If the owner asks how something works or what to do, say you are not sure and offer to look it up with guide_search, rather than guess.');
  }
  // (Oct 21 2026, night - the customer's day one) asked "we don't have a domain, what should I do?", the box's small model
  // answered with the next setup question: the owner's own question comes first, said last, right beside their words
  if (ctx.askedSomething && leads) lines.push('', 'The owner asked a question: answer it first, in a few lines. Only then, if it fits, the next setup step.');
  if (ctx.nudged) lines.push('', ctx.nudged);
  return lines.join('\n');
}
const brief = (ctx, guide) => rules(ctx) + '\n\n' + now(ctx, guide);   // the two together, for a reader of the whole

const lastUserText = (conv) => { for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'user') return conv.messages[i].content; return ''; };
// the box's own question for a change waiting on one answer (A BOX-ASKED CHOICE): said once, its answers to tap
function askAwaiting(conv) {
  const w = conv.awaiting[0]; w.asked = true;
  conv.messages.push({ role: 'assistant', content: w.question });
  return { conversation: conv.id, reply: w.question, choices: w.choices.slice(0, 6), proposals: [] };
}
// a phone or an email in a change's arguments that nobody gave in this talk - not the owner, and not the facility's own records
// the box looked up (a member's phone from the members list is theirs to use) - digits compared, the last ten
const digitsOf = (x) => String(x || '').replace(/\D/g, '').slice(-10);
// the places an owner asks to be taken to, in their words, and the screen each opens (screens.js shapes; the admin cards are
// admin.html ADMIN_CARDS) - the first that the words name, so the narrower ones come first
const PLACES = [
  [/\bbooking page\b/, 'your booking page', { page: '/book' }],
  [/\b(?:employee |staff |work )?schedul(?:e|ing)\b|\bshifts?\b/, 'the employee schedule', { admin: 'settings', card: 'schedule' }],
  [/\btime ?clock\b|\bclock(?:ed)? ?ins?\b|\btimesheets?\b/, 'the time clock', { admin: 'settings', card: 'timeClock' }],
  [/\btax(?:es)?(?: codes?| rates?)?\b/, 'your tax codes (the Point of Sale\'s taxes)', { admin: 'settings', card: 'posTax' }],
  [/\bpackages?\b|\bpackage deals?\b|\b(?:party|birthday|corporate) (?:packages?|deals?)\b/, 'your package deals (Pricing)', { admin: 'pricing', card: 'packages' }],
  [/\bbooking deals?\b|\bgolf deals?\b|\bdeals?\b/, 'your booking deals (Pricing)', { admin: 'pricing', card: 'bookingDeals' }],
  [/\bspecials?\b|\bdrink specials?\b|\bfood specials?\b/, 'your food and drink specials', { admin: 'settings', card: 'specials' }],
  [/\bmenu\b|\bfood\b|\bdrinks?\b|\bpos\b|\bpoint of sale\b|\bkitchen\b|\bbeers?\b/, 'the menu (the Point of Sale\'s menu)', { admin: 'settings', card: 'posMenu' }],
  [/\bprinters?\b/, 'your printers', { admin: 'settings', card: 'printers' }],
  [/\bcounter\b|\bregister\b|\bcash\b|\btill\b/, 'the counter\'s settings', { admin: 'settings', card: 'counter' }],
  [/\bstaff\b|\bemployees?\b|\bsign-?in codes?\b|\broster\b/, 'your staff and their sign-in codes', { admin: 'settings', card: 'staffCodes' }],
  [/\bblock(?:s|ed)?(?: off| times?)?\b/, 'blocking off a bay', { admin: 'dashboard', card: 'blocks' }],
  [/\bbookings?\b|\breservations?\b|\btee times?\b/, 'the bookings', { admin: 'bookings' }],
  [/\bmembership tiers?\b|\btiers?\b|\bmemberships?\b|\bplans?\b/, 'your membership tiers', { admin: 'members', card: 'tiers' }],
  [/\bgift ?cards?\b/, 'your gift cards', { admin: 'members', card: 'giftCards' }],
  [/\bmembers?\b/, 'your members', { admin: 'members', card: 'members' }],
  [/\b(?:discount|promo|coupon) ?codes?\b|\bcoupons?\b/, 'your discount codes', { admin: 'pricing', card: 'discountCodes' }],
  [/\bhappy hours?\b|\bpeak (?:hours|pric\w*)\b|\bprice windows?\b/, 'your price windows', { admin: 'pricing', card: 'priceWindows' }],
  [/\bpric(?:es|ing)\b/, 'your pricing', { admin: 'pricing' }],
  [/\b(?:opening |business )?hours\b|\bbooking rules\b/, 'your hours and booking rules', { admin: 'settings', card: 'hours' }],
  [/\bend of (?:the )?day\b|\bclose out\b/, 'End of Day', { admin: 'revenue', card: 'eod' }],
  [/\brevenue\b|\bsales\b|\bmoney\b|\breports?\b/, 'your revenue', { admin: 'revenue' }],
  [/\bwaivers?\b/, 'your waivers', { admin: 'waivers' }],
  [/\bbays?\b|\bdevices?\b|\bplugs?\b|\bsimulators?\b/, 'your bays and devices', { admin: 'bays' }],
  [/\btexts?\b|\bmessag(?:es|ing)\b|\bemails?\b/, 'your messages (texts and emails)', { admin: 'sms' }],
  [/\bbackups?\b/, 'your backups', { admin: 'settings', card: 'backups' }],
  [/\b(?:software )?updates?\b/, 'software updates', { admin: 'settings', card: 'updates' }],
  [/\b(?:owner'?s )?log\b|\bhistory\b/, 'your owner\'s log', { admin: 'log' }],
  // the Website editor's own cards (admin-website.html) - where each part of the site is changed by hand
  [/\bcolou?rs?\b|\bfonts?\b|\btheme\b|\bbrand(?:ing)?\b|\bthe look\b/, 'your colors and fonts (the Website editor)', { editor: 'cardTheme' }],
  [/\bhero\b|\btop of (?:the |my |our )?(?:site|website|page|home ?page)\b|\bheadline\b/, 'the top of your website (the Website editor)', { editor: 'cardHero' }],
  [/\bpromo(?: banner| band)?\b|\boffer band\b|\bfirst[- ]visit offer\b|\bbanner\b/, 'your promo banner (the Website editor)', { editor: 'cardPromo' }],
  [/\bslides?\b|\bslideshow\b/, 'your offer slides (the Website editor)', { editor: 'cardOffers' }],
  [/\bgallery\b|\bphotos?\b|\bpictures?\b/, 'your photo gallery (the Website editor)', { editor: 'cardGallery' }],
  [/\bevents?\b/, 'your events (the Website editor)', { editor: 'cardEvents' }],
  [/\bpage layout\b|\blayout\b|\bblocks\b/, 'your page layout (the Website editor)', { editor: 'cardLayout' }],
  [/\b(?:my |our |custom )?pages\b/, 'your pages (the Website editor)', { editor: 'cardPages' }],
  [/\bnav(?:igation)?(?: bar)?\b|\btop menu\b|\bmenu bar\b/, 'your top menu (the Website editor)', { editor: 'cardNav' }],
  [/\bcontact (?:details|info(?:rmation)?)\b|\bsocial(?: links| media)?\b/, 'your contact details and social links (the Website editor)', { editor: 'cardVisit' }],
  [/\binbox\b/, 'your website inbox (the Website editor)', { editor: 'cardInbox' }],
  [/\bwhat'?s public\b|\bholding page\b/, 'what is public (the Website editor)', { editor: 'cardPublic' }],
  [/\bseo\b|\bsearch (?:and |& )?sharing\b|\bgoogle listing\b/, 'search and sharing (the Website editor)', { editor: 'cardShare' }],
  [/\bemail (?:sign ?ups?|updates)\b|\bnewsletter sign ?up\b/, 'email sign-ups (the Website editor)', { editor: 'cardSignup' }],
  [/\bstaffed days\b/, 'your staffed days (the Website editor)', { editor: 'cardStaffed' }],
  [/\bhow it works\b/, 'your How It Works steps (the Website editor)', { editor: 'cardSteps' }],
  [/\bwebsite editor\b|\bsite editor\b/, 'the Website editor', { editor: 'cardSite' }],
  [/\bwebsite\b|\bsite\b|\bhome ?page\b/, 'your website', { site: 'home' }],
  [/\bdashboard\b|\btoday\b/, 'today at a glance', { admin: 'dashboard' }],
  [/\bsettings\b/, 'your settings', { admin: 'settings' }],
];
const GO_TO = /^\s*(?:(?:ok(?:ay)?|hey|please|now|can you|could you|would you)[,\s]+)*(?:take me (?:to|back to)|go (?:to|back to)|open(?: up)?|bring up|pull up|navigate to|get me to|jump to)\s+(.+?)\s*[.!?]*\s*$/i;
// what is left once a place is named in the owner's words: nothing but filler (or "so I can do it myself")
// and "where is ...?" / "where do I add ...?" - the same place, found the same way ("where are the trucker hats? take me there" was
// answered by the 4B from nothing: "not part of your current menu")
const WHERE = /^\s*(?:(?:ok(?:ay)?|hey|so)[,\s]+)*where(?:'s|s| is| are| (?:do|can|would|should) (?:i|we) (?:find|see|set|change|add|edit|make|put|go to|look at|look for)?)\s+(.+?)\s*\??\s*(?:(?:can you\s+|please\s+)?(?:take me there|show me|show me where|go there|bring me there|take me)[.!?]*)?\s*$/i;
const askedPlace = (w) => GO_TO.exec(w) || (/^\s*(?:(?:ok(?:ay)?|hey|so)[,\s]+)*where\b/i.test(w) && !/^\s*(?:(?:ok(?:ay)?|hey|so)[,\s]+)*where (?:are|is) (?:we|you|i|they|things|it at|that at)\b/i.test(w) ? WHERE.exec(w) : null);
function placeLeft(words) { const m = askedPlace(String(words || '')); return m ? m[1].toLowerCase().replace(/\s+(?:so|and|to|because)\s+(?:that\s+)?(?:i|we)(?:'ll| will| can| want to| need to)?\b.*$/, '').replace(/[^a-z0-9' -]+/g, ' ') : null; }
const FILLER = /\b(?:the|my|our|a|of|in|on|page|screen|tab|section|sections|card|area|part|category|please|for me|system|list|settings|setup|admin|now|real quick|up|menu|pos)\b/g;
// THE OWNER'S OWN PLACES (maintainer, Oct 22 2026: "lets say they have a bunch of sections like beer, wine, burgers, shirts, hats ... the AI
// needs to know that the new sections exist so it can know where that stuff is take them there then click on it"): read live when
// the owner asks to go somewhere - the menu's parts and what is in them, their own pages, bays and memberships - so a part added
// today is there today. A part opens the menu builder with that part picked, as a click on it would
async function liveIn(words, ctx) {
  const rest = placeLeft(words); if (!rest || !ctx || typeof ctx.call !== 'function') return null;
  const get = async (p) => { try { const r = await ctx.call('GET', p); return r && r.ok !== false ? r.json : null; } catch { return null; } };
  const [menu, content, tiersJ, cfg, specialsJ] = await Promise.all([get('/api/pos/menu?all=1'), get('/api/website/content'), get('/api/members/tiers'), get('/api/admin/config'), get('/api/pos/specials')]);
  const esc = (x) => String(x).toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = (name) => { const n = String(name || '').trim(); if (n.length < 2) return null; const re = new RegExp('\\b' + esc(n) + '(?:s|es)?\\b'); return re.test(rest) ? re : null; };
  const only = (re) => rest.replace(new RegExp(re.source, 'g'), ' ').replace(FILLER, ' ').trim().split(/\s+/).filter(Boolean).length <= 1;
  const cats = (menu && menu.menu) || [];
  // a part, or an item in one - whichever the words name more of ("the trucker hats" is the Trucker Hat, in Hats); a part on a tie
  const left = (re) => rest.replace(new RegExp(re.source, 'g'), ' ').replace(FILLER, ' ').trim().split(/\s+/).filter(Boolean).length;
  let best = null;
  for (const c of cats) { const re = named(c.name); if (re && only(re) && (!best || left(re) < best.n)) best = { n: left(re), name: `the ${c.name} part of your menu`, part: c.name }; }
  for (const c of cats) for (const i of (c.items || [])) { const re = named(i.name); if (re && only(re) && (!best || left(re) < best.n)) best = { n: left(re), name: `the ${c.name} part of your menu, where ${i.name} is`, part: c.name }; }
  if (best) return { name: best.name, screen: { admin: 'settings', card: 'posMenu', part: best.part } };
  for (const sp of ((specialsJ && specialsJ.specials) || [])) { const re = named(sp.name); if (re && only(re)) return { name: `your "${sp.name}" special, on Specials & Deals`, screen: { admin: 'settings', card: 'specials' } }; }
  for (const p of ((content && content.pages) || [])) { const re = named(p.title) || named(String(p.slug || '').replace(/-/g, ' ')); if (re && only(re) && /^[a-z0-9-]+$/.test(String(p.slug || ''))) return { name: `your "${p.title || p.slug}" page`, screen: { page: '/p/' + p.slug } }; }
  for (const b of ((cfg && cfg.bays) || [])) { const re = named(b.name); if (re && only(re)) return { name: `${b.name}, on Bays & Devices`, screen: { admin: 'bays' } }; }
  for (const t of (Array.isArray(tiersJ) ? tiersJ : ((tiersJ && tiersJ.tiers) || []))) { const re = named(t.name); if (re && only(re)) return { name: `the ${t.name} membership, on Membership Tiers`, screen: { admin: 'members', card: 'tiers' } }; }
  return null;
}
function placeIn(words) {
  const m = askedPlace(String(words || '')); if (!m) return null;
  // what is left once the place is named: nothing but filler, or the owner saying they will do it themselves
  let rest = m[1].toLowerCase().replace(/\s+(?:so|and|to|because)\s+(?:that\s+)?(?:i|we)(?:'ll| will| can| want to| need to)?\b.*$/, '').replace(/[^a-z0-9' -]+/g, ' ');
  for (const [re, name, screen] of PLACES) {
    if (!re.test(rest)) continue;
    const left = rest.replace(new RegExp(re.source, 'g'), ' ').replace(/\b(?:the|my|our|a|of|in|on|page|screen|tab|section|card|area|part|please|for me|system|list|settings|setup|admin|now|real quick|up)\b/g, ' ').trim();
    return left.split(/\s+/).filter(Boolean).length <= 1 ? { name, screen } : null;
  }
  return null;
}
// the box's own model answering (a local small model, wherever its server runs) - not the owner's own AI service, and not the scripted
// demo brain (tools/demo-model.js, model "demo"), whose words after a change are written by us and say exactly what was done
// a setting's own words (the tools' answers to pick from, "last_minutes_free"), said in plain words when the model quotes one
let SETTING_WORDS = null;
function settingWords() {
  if (SETTING_WORDS) return SETTING_WORDS;
  SETTING_WORDS = new Set();
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o.enum)) o.enum.forEach(v => { if (typeof v === 'string' && v.includes('_')) SETTING_WORDS.add(v); }); for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v); };
  for (const a of actions.ACTIONS || []) walk(a.params);
  return SETTING_WORDS;
}
// what was just approved, said back as done - the first sentence of each card's own words
const doneLines = (list) => list.map(d => 'Done - ' + String(d).split(/(?<=\.)\s+/)[0].replace(/\.$/, '') + '.').join('\n');
// (a change made with no card is already on the owner's page as "Done: ..." - the page's own note; it is not said twice: maintainer's try box,
// Oct 22 2026, "Done: Location: Example City, ST" then "Done - Location: Example City, ST.")
const saidDone = (ctx) => doneLines((ctx.justApplied || []).filter(d => !(ctx.pageNoted && ctx.pageNoted.has(d))));
// a drink by its name (the menu's own DRINK words and the names an owner types for beers on tap)
const DRINKISH = /\b(?:beers?|wines?|drinks?|cocktails?|seltzers?|shots?|ciders?|bourbons?|whiske?ys?|vodkas?|tequilas?|rums?|gins?|sodas?|pops?|coffees?|teas?|lemonades?|juices?|waters?|beverages?|mocktails?|brews?|light|lager|ipas?|ales?|stouts?|pilsners?|drafts?|pitchers?|margaritas?|mimosas?|coke|pepsi|sprite|bud|coors|miller|corona|modelo|michelob|stella|guinness|heineken)\b/i;
function smallBoxModel() { try { const st = require('./model').settings(); return st.provider === 'box' && st.model !== 'demo'; } catch { return false; } }
// any model but the showcase's demo brain - the box's own or the owner's own service (Oct 23 2026: a real Claude wrote **bold**,
// headings and a tool's name like the 4B did, and the chat shows plain words)
// THE MODEL ALONE, FOR SCORING (maintainer, Oct 25 2026: "we need 95% accuracy before we deploy. On both model and box hard code"): the
// scorer's --model-only boots its unit with BA_ASSISTANT_MODEL_ONLY=1, and the box's own hands - the everyday lookups, the plain
// commands it reads itself and its own words - stand aside so what is scored is the model's. Never set on a unit.
// THE QUESTIONS TO TAP, ONE SCROLLING ROW (maintainer, Oct 25 2026: "You can add more if its suggested prompts and the scroll along the bottom
// just above the chat box"): every card that fits the facility, up to two dozen - a hybrid with a counter, staff and members open to the
// public has twenty-two (all twenty-four with a counter special and a membership that takes guests)
const CARDS_SHOWN = 24;
const boxHands = () => process.env.BA_ASSISTANT_MODEL_ONLY !== '1';
function realModel() { try { const st = require('./model').settings(); return !(st.provider === 'box' && st.model === 'demo'); } catch { return false; } }
// what the owner said for the request in hand: their newest words and, while those are a short answer to a question the box or the
// model asked, the words before it (a whole day's talk is not this request - an earlier block's date is not a discount code's end;
// and the 4B ends nearly every answer with "Would you like to...?", so a new request never reaches back)
const REQUEST_START = /^(?:ok(?:ay)?[, ]+|now[, ]+|and[, ]+|also[, ]+|please[, ]+)*(?:make|add|create|set|put|book|block|give|change|turn|switch|show|remove|delete|cancel|schedule|open|close|list|move|rename|send|what|how|who|when|where|why|can|could|would|is|are|do|does)\b/i;
function heardThisAsk(conv, answering) {
  const m = conv.messages, out = [];
  let i = m.length - 1;
  while (i >= 0 && m[i].role !== 'user') i--;
  for (let n = 0; i >= 0 && n < 5; n++) {
    const said = String(m[i].content || '').trim();
    out.unshift(said);
    // (a tapped answer to the box's own question - "No tax on these - keep 0%" - is an answer however many words it has)
    if (!(answering && n === 0) && (said.split(/\s+/).length > 6 || REQUEST_START.test(said))) break;
    let j = i - 1; while (j >= 0 && m[j].role !== 'assistant') j--;
    // (asked in words, or with answers to tap - ask_owner)
    if (j < 0 || !(/\?/.test(String(m[j].content || '')) || (m[j].tool_calls || []).some(t => t.function && t.function.name === 'ask_owner'))) break;
    i = j - 1; while (i >= 0 && m[i].role !== 'user') i--;
  }
  return out.join('\n');
}
// THE REQUEST IN HAND, READ ONCE FOR EVERY GUARD (Oct 28 2026, round 2e - the review of round 2d, HIGH twice): the guards read only the
// owner's newest words, so a request that came over two turns lost half of itself. "block bay 2 tonight for the smiths party", the model's
// own "What hours?", then "8 to 1": the bare-hour rule saw "8 to 1" alone, found no day-part word and moved the model's right 8 PM to 1 AM to
// 8 AM at a place open from 7 AM. And each guard that hands a call back (the days, one time, money) or asks (the money's "a half hour, or an
// hour?") made the next call be read against "weekdays", "ok every friday then" or "an hour" - no time in them, so the model's morning reading
// went up unasked. Now ONE reading of the request in hand, for the clock, the days, one time and the money alike, whatever order they run in:
// the owner's newest words, and the turns before them while the newest are a short answer - not a new request ("make it ...", "change it
// ..." are answers) - to what was left open there: a question the model or the box asked, a call the box handed back, or a card the owner
// did not approve (a correction typed after a card: "not fridays though" after "happy hour weekdays 2 to 5"). Each turn is joined by a soft
// stop (" ; "), so a bare "8 to 1" stands beside its request's "tonight" as said in one breath. { text: every turn; days: the same less the
// owner's answers to the box's own "Which hours?" - the answer to that question is the hours and never the days (THE DAYS RULE); turns }
const HOURS_Q = /^(?:Which (?:hours|time)\b[^?]*\?|I could not tell which hours you meant\b)|\b(?:in the morning, or\b[^?]*\bat night\?|at noon, or at midnight\?|in the afternoon, or\b[^?]*\bafter midnight\?)\s*$/;
const ANSWER_START = /^(?:ok(?:ay)?[, ]+|no[, ]+|nah[, ]+|actually[, ]+|wait[, ]+|sorry[, ]+|and[, ]+|just[, ]+)*(?:make|change) (?:it|that|this|them|those)\b/i;
// A COMPLETE NEW REQUEST IS ITS OWN (Oct 28 2026, round 2f - the critic of round 2e: the 4B ends nearly every answer with a "?", so "bud light
// $2 off fridays 5 to 9" typed after the model's "What hours?" about "block bay 2 tonight for the smiths" was read with "tonight" and asked
// "5 AM to 9 AM, or 5 PM to 9 PM?" at a place that opens at 10, and after "any events this saturday" was handed back as "fri and this
// saturday - every week, or once?"). Words that are a whole request on their own - one the box reads itself, or its own thing with its own
// price and its own day or time - start the request in hand; nothing before them is joined to them. An answer has no thing of its own ("not
// fridays though", "8 to 1", "$20 an hour", "weekdays") or no price ("the fall scramble", "ages 8-14"), and is still read with its request.
const OWN_THING_SKIP = /^(?:a|an|the|and|or|but|to|till|til|until|thru|through|from|at|on|in|for|of|off|per|each|every|only|just|also|too|though|not|no|yes|ok|okay|make|it|its|that|this|these|those|is|are|be|please|pls|then|now|actually|wait|same|again|one|ones|half|hour|hours|hr|hrs|minute|minutes|min|mins|dollars?|bucks?|cents?|percent|pct|am|pm|noon|midnight|today|tonight|tomorrow|week|weekly|weekday|weekdays|weekend|weekends|weeknights?|nightly|daily|day|days|night|nights|morning|mornings|evening|evenings|afternoon|afternoons|except|but|instead|either|both|all|any|later|earlier|before|after|start|starts|end|ends|close|open|ish|oclock)$/;
// (the words that name the request's own thing - what is left once the small words, the times, the days and the money are taken out)
const ownThings = (said) => (String(said || '').toLowerCase().replace(/[‘’]/g, "'").match(/[a-z][a-z']{2,}/g) || []).filter(w => !OWN_THING_SKIP.test(w) && !/^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)$/.test(w));
// (a thing, its money and its own day or time: a whole priced request - 'day' when it names its own day, true when only its time; else false)
function pricedRequest(said) {
  const t = String(said || '').toLowerCase().replace(/[‘’]/g, "'");
  const money = /\$\s?\d|\b\d+(?:\.\d\d)?\s*(?:%|percent\b|dollars?\b|bucks?\b|off\b)|\bhalf (?:off|price)\b/.test(t);
  const day = /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|weekdays?|weekends?|weeknights?|daily|nightly|every day|today|tonight|tomorrow)\b/.test(t);
  const time = /\b\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)\b|\b\d{1,2}(?::[0-5]\d)?\s*(?:-|to|till|til|until|thru)\s*\d{1,2}\b|\bnoon\b|\bmidnight\b/.test(t);
  return ownThings(t).length && money && (day || time) ? (day ? 'day' : true) : false;
}
function completeRequest(said, ctx) {
  // ('day' when the words name their own day - requestInHand keeps a day said a turn earlier for a complete request with none: Oct 28 2026)
  const priced = pricedRequest(said);
  if (priced) return priced;
  // (one the box reads itself - never a follow-up of a look-up, which reads only against what was just looked up)
  let h = null; try { h = ctx ? intents.match(said, Object.assign({}, ctx, { lastCall: null })) : null; } catch { h = null; }
  return !!(h && (h.calls || h.ask));
}
// A DAY SAID A TURN EARLIER IS KEPT (Oct 28 2026, round 2g - the critic of round 2f, HIGH: "set up a friday special", the 4B's "What would you
// like the special to be?", then "$2 off draft beer 5 to 9" - a thing, its money and its hours, so a complete request, and the request in hand
// stopped at it: the box put up its own card for EVERY DAY, and the Friday $2 off rang up at the counter all week. "i want a thursday night
// special" / "$5 off wings 6-10pm", "add a monday night special" / "draft beer $3 from 6 to 10", "we should do a weekday lunch special" /
// "smash burger $9 from 11 to 2" the same). A complete request that names no day of its own is still read with the turns before it when
// one of them named the day - and that turn is about the same kind of thing (a special, a deal, a price, the bar's food and drink - never a
// block, a booking, an event, a party or a shift: "bud light $2 off 5 to 9" typed after "block bay 2 tonight" / "What hours?", or after "put
// carl on tomorrow", is not tonight's or tomorrow's)
const DAY_WORD = /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|weekdays?|weekends?|weeknights?|daily|nightly|every day|today|tonight|tonite|tomorrow|halloween|thanksgiving|christmas|new years?)\b/i;
const OTHER_KIND = /\b(?:block|blocked|book|booking|reserve|reservation|events?|calendar|shift|shifts|schedule|scheduled|close|closed|closing|staff|tournament|scramble|league night|lesson|clinic|camp|party|outing|birthday|wedding)\b/i;
const SAME_KIND = /\b(?:specials?|happy hours?|deals?|promos?|promotions?|discounts?|price|prices|pricing|rates?|drinks?|beers?|food|menu|wings|burgers?|game day|lunch|brunch)\b/i;
function requestInHand(conv, ctx) {
  const m = conv.messages, turns = [];
  let i = m.length - 1, soft = 0;
  while (i >= 0 && m[i].role !== 'user') i--;
  for (let n = 0; i >= 0 && n < 4; n++) {
    const said = String(m[i].content || '').trim();
    if (OPENED.test(said)) break;   // (the page's own hello is not the owner's words)
    let j = i - 1; const between = [];
    while (j >= 0 && m[j].role !== 'user') { between.unshift(m[j]); j--; }
    const lastSaid = between.filter(x => x.role === 'assistant' && String(x.content || '').trim()).pop();
    const lastAsk = between.filter(x => x.role === 'assistant').pop();
    // (q: what was said to the owner just before these words - an event's fill reads a bare "8" answering "What time does it start?" as its
    // start: Oct 28 2026, round 2f; and a question put with answers to tap (ask_owner) is what was said too - the demo brain's 'Is "Company
    // Party" a private party?' answered "Put it on the Events page": Oct 28 2026, round 2g)
    let lastQ = null;
    for (let b = between.length - 1; b >= 0 && lastQ === null; b--) { const x = between[b]; if (x.role !== 'assistant') continue;
      const ao = (x.tool_calls || []).map(t => { try { return t.function && t.function.name === 'ask_owner' ? String(JSON.parse(t.function.arguments).question || '').trim() : ''; } catch { return ''; } }).filter(Boolean).pop();
      if (ao) lastQ = ao; else if (String(x.content || '').trim()) lastQ = String(x.content || '').trim(); }
    turns.unshift({ said, hoursAnswer: !!lastSaid && HOURS_Q.test(String(lastSaid.content || '').trim()), q: lastQ ? lastQ.slice(-300) : '',
      approved: between.some(x => x.role === 'tool' && /"done"\s*:\s*true/.test(String(x.content || ''))),
      // (a card the owner did not approve stood between the turn before and these words - requestInHand's lent, Oct 28 2026, round 2i)
      left: between.some(x => x.role === 'tool' && /did not apply this|the owner said No - nothing was changed/.test(String(x.content || ''))) });
    // (A CHOICE TAPPED FROM THE QUESTION JUST PUT IS AN ANSWER, NEVER A NEW REQUEST - Oct 28 2026, round 2h, the critic of round 2g: the demo
    // brain's 'Is "Company Party" a private party?' answered with its own tap "Put it on the Events page" starts with "put", so the request in
    // hand ended at the tap and the party's own "saturday at 8" was never read - the brain's 8 AM went up on the public Events page at once, at
    // a place that opens at 10, while "public" typed was asked "8 AM, or 8 PM?". Words that are, whole, one of the answers the question just
    // before them offered to tap (ask_owner's choices) answer that question, whatever word they start with - while that question is still about
    // the request before it: never one asked after a card was said Yes or No to ("Done! Anything else? [Add a happy hour]" - that tap is a new
    // request, and a Friday special's day is not its)
    const cardSettled = between.some(x => x.role === 'tool' && /"done"\s*:\s*true|did not apply this|the owner said No - nothing was changed/.test(String(x.content || '')));
    const tappedChoice = !cardSettled && between.some(x => x.role === 'assistant' && (x.tool_calls || []).some(t => { try { const ao = t.function && t.function.name === 'ask_owner' ? JSON.parse(t.function.arguments) : null;
      return !!ao && Array.isArray(ao.choices) && ao.choices.some(ch => String(ch).trim().toLowerCase() === said.toLowerCase()); } catch { return false; } }));
    // (a new request starts here: the rest is another request's - a complete one too, Oct 28 2026; the newest words a complete request with no
    // day of their own read on for the day a turn before them said - kept below only when one did, Oct 28 2026, round 2g)
    const opens = REQUEST_START.test(said) && !ANSWER_START.test(said) && !tappedChoice, long = said.split(/\s+/).length > 8;
    const complete = !opens && !tappedChoice && (n === 0 || !long) ? completeRequest(said, ctx) : false;
    if (n === 0 && complete === true && !DAY_WORD.test(said)) soft = 1;
    else if (long || opens || complete) break;
    if (j < 0) break;
    // what was left open before these words: a question asked (in words, or to tap), a call the box handed back, a card not approved
    const asked = !!lastAsk && (/\?/.test(String(lastAsk.content || '')) || (lastAsk.tool_calls || []).some(t => t.function && t.function.name === 'ask_owner'))
      || (!!lastSaid && /\?/.test(String(lastSaid.content || '')));
    const handed = between.some(x => x.role === 'tool' && /"error"\s*:/.test(String(x.content || '')));
    // (a card not approved: the words typed over it while it waited - dropPending - or, THE PAGE'S OWN ORDER (Oct 28 2026, round 2f - the
    // review of round 2e): the owner's page posts the waiting card's No first and only then sends the words typed over it, so the box hears
    // "the owner said No" and says "All right, I left it as it was." before the correction arrives - "not fridays though" over "happy hour
    // weekdays 2 to 5" was read alone and put up Mon-Thu, Sat, Sun. A No is a card not approved too: a correction after it is read with the
    // request; a new request after it starts its own - the rules above)
    const cardLeft = between.some(x => x.role === 'tool' && /did not apply this|the owner said No - nothing was changed/.test(String(x.content || '')));
    if (!(asked || handed || cardLeft)) break;
    i = j;
  }
  // (each turn's own closing full stop, or question mark, is not a new clause: the soft stop between turns stands for it - "Block bay 2
  // tonight for the Smiths party." then "8 to 1" is the evening, as without the full stop: K13, Oct 28 2026, round 2f)
  // (the newest words a complete request with no day: the turns before them stay only for a day one of them said about the same kind of thing)
  if (soft > 0 && turns.length > soft) {
    const before = turns.slice(0, turns.length - soft), dayTurn = before.filter(t => DAY_WORD.test(t.said)).pop();
    const d = dayTurn ? dayTurn.said : '', money = /\$\s?\d|\b\d+(?:\.\d\d)?\s*(?:%|percent\b|dollars?\b|bucks?\b)|\bhalf (?:off|price)\b/i.test(d);
    const same = (SAME_KIND.test(d) || DRINKISH.test(d) || money) && (!OTHER_KIND.test(d) || /\b(?:specials?|happy hours?|deals?)\b/i.test(d));
    // (and never past a card the owner approved: that request is done - "bud light $2 off fridays 5 to 9", Yes, then "wings $5 off 6 to 10" is
    // a new special of its own)
    const done = dayTurn && turns.slice(turns.indexOf(dayTurn) + 1).some(t => t.approved);
    // (A DAY TURN THAT WAS A WHOLE PRICED REQUEST OF ITS OWN LENDS ITS DAY ONLY TO THE SAME THING - Oct 28 2026, round 2h, the reviewer of round 2g:
    // the page posts the waiting card's No when the owner types over it, so "bud light $2 off fridays 5 to 9" declined, then "smash burger $9 from
    // 11 to 2" - a different item - or "happy hour 2 to 5 at $15 a half hour" - another kind - went up Friday only. The day said a turn before is
    // kept when that turn left the thing open ("set up a friday special", the model's "What would you like the special to be?"), or when the
    // newest words name the same thing again - "bud light $3 off 5 to 9" over the declined Friday Bud Light; "special" or "deal" alone is no
    // thing of its own)
    const KIND_ONLY = /^(?:specials?|deals?|promos?|promotions?|discounts?)$/;
    const sameThing = () => { const mine = new Set(ownThings(turns[turns.length - 1].said).filter(w => !KIND_ONLY.test(w))); return ownThings(d).some(w => !KIND_ONLY.test(w) && mine.has(w)); };
    // (NARROWED TO A DAY TURN THAT WAS MADE WHOLE - Oct 28 2026, round 2i, the reviewer and the critic of round 2h: a day turn that also named the
    // money - "set up a friday special, $2 off", "add a $2 off friday special", "can we do a $2 off friday special", "i want a friday special for $2
    // off", "we should do a friday drink special, like $2 off", "friday special $2 off beers" - counted its own "set", "add", "can", "want", "drink" or
    // "beers" as a thing of its own, so it was taken for a whole priced request; the model's "What would you like the special to be?" and "bud light $2
    // off 5 to 9" then made a card for EVERY DAY, and a Yes rang the $2 off at the counter all week. A day turn is a whole request of its own only when
    // it was made into a card the owner did not approve - round 2h's own case, "bud light $2 off fridays 5 to 9" declined; one the model answered with
    // a question left its thing open, and lends its day)
    const dayAt = dayTurn ? turns.indexOf(dayTurn) : -1, madeWhole = dayAt >= 0 && !!turns[dayAt + 1] && turns[dayAt + 1].left;
    const lent = dayTurn && madeWhole && pricedRequest(d) && !sameThing();
    if (!same || done || lent) turns.splice(0, turns.length - soft);
  }
  const join = (ts) => ts.map(t => (ts.length > 1 ? t.said.replace(/[\s.!?]+$/, '') : t.said)).filter(Boolean).join(' ; ');
  return { text: join(turns), days: join(turns.filter(t => !t.hoursAnswer)), turns };
}
function madeUpContact(args, conv) {
  const said = conv.messages.filter(m => m.role === 'user' || m.role === 'tool').map(m => String(m.content || '')).join('\n');
  const saidDigits = said.replace(/\D/g, ' ').replace(/\s+/g, ' '), saidFlat = said.replace(/[^\d]/g, '');
  for (const k of Object.keys(args || {})) {
    const v = args[k]; if (typeof v !== 'string' || !v.trim()) continue;
    if (/phone|mobile|cell/i.test(k) && digitsOf(v).length >= 7 && !saidFlat.includes(digitsOf(v)) && !saidDigits.includes(digitsOf(v))) return k;
    if (/e-?mail/i.test(k) && /@/.test(v) && !said.toLowerCase().includes(v.trim().toLowerCase())) return k;
  }
  return null;
}
// THE MODEL'S EVENT MEETS THE BOX'S OWN TEST OF WHOSE IT IS (Oct 27 2026, round 2d; the critic of round 2c): event_add goes on the public
// Events page at once - it has no card - and the box hands a person's, a family's, a team's, a company's or a client's own do to the model
// (intents.js, WHOSE AN EVENT IS). Nothing stopped the model putting it up: "add the acme company outing friday at 8", the model's own
// event_add, went on the public page as "Acme Company Outing". Now the title the model would put up is read by the box's same test
// (intents.privateDo); one read as someone's own is never applied - it is asked, two to tap: "Put <title> on your public Events page, or
// is it a private booking?". Public: it goes up as it was (and is not asked again in the talk). Private: nothing goes up, the model is
// told why and what can be done instead, and the same title tried again in that breath is refused, never asked twice; in a later turn
// - "put it on the events page anyway" - it is asked again, never put up and never refused (the owner may have changed their mind).
// (The title is read, and - since Oct 28 2026 - the owner's own words for the event, below; never the model's description: it is free
// words - "fun for the whole family" is not a family's own night)
// (the owner's answer is read only from the box's own call that their tap finished - a "__public" in the model's own arguments is never it)
// (Oct 28 2026, round 2e - the review of round 2d:
//   - THE OWNER'S WORDS ARE READ AS WELL AS THE TITLE: the box hands a private do to the model because its own test read the owner's words
//     as someone's, and only the title the model chose was read here - "add a bash for sarahs 40th saturday at 3" went up as "Saturday
//     Bash". The request in hand (ctx.heard - over two turns when the model asked something first) is read by the box's own test
//     (intents.ownersDo: the event's own words in the request, never free words about it); a title the box read itself from the owner's
//     words as a public event (BOX FIRST) is the box's verdict already
//   - EVENT_EDIT TOO: a new title for an event already on the page goes on it at once as well ("rename the fall classic to mikes 40th bash")
//   - AFTER PRIVATE, NOTHING OF THAT REQUEST GOES UP IN THAT BREATH, UNDER ANY NAME: only the same title was refused, so the model's retry as
//     "Saturday Skins Game" went on the public page right after the owner said private (ctx.eventPrivate - event_add's own reading refuses
//     it too, before a time question could be asked for it: actions.js eventWhen)
//   - ONE ANSWER PER REQUEST: Public is kept by the title without its marks ("Mike's" and "Mikes", a leading "the" - one event), and the
//     owner's answer to the time is kept with it (eventWhen): the two questions no longer send each other round)
const eventKey = (t) => String(t || '').toLowerCase().replace(/['‘’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
function privateEvent(c, args, ctx, conv) {
  if (!/^event_(?:add|edit)$/.test(c.name) || !args || typeof args.title !== 'string') return;   // (an edit that keeps the title is not read here)
  const answered = /^box_/.test(String(c.id)) && !!ctx.answeredParam && ctx.answeredParam.get(c.id) === '__public';
  const key = eventKey(args.title), said = answered && c.args ? c.args.__public : undefined;
  conv.eventsPublic = conv.eventsPublic || new Set();
  if (said === true) { conv.eventsPublic.add(key); return; }
  if (said === false) { conv.eventsPublic.delete(key); ctx.eventPrivate = args.title; }
  // (the owner chose the public Events page in the request in hand - publicChosen, Oct 28 2026: never asked again)
  if (said === undefined && !ctx.eventPrivate && publicChosen(ctx)) { conv.eventsPublic.add(key); return; }
  if (ctx.eventPrivate) throw new actions.ActionError(`the owner said "${ctx.eventPrivate}" is a private booking, so it never goes on the public Events page - nothing was ${c.name === 'event_edit' ? 'changed' : 'put up'}, under this name or any other. Ask what they want for it instead (a bay blocked off for it with block_add, or a booking in their name with booking_make), or leave it`);
  if (conv.eventsPublic.has(key)) return;
  // (an edit that gives the event a title already on the page - its own, unchanged - puts no new name up)
  if (c.name === 'event_edit' && (Array.isArray(ctx.events) ? ctx.events : []).some(ev => eventKey(ev && ev.title) === key)) return;
  const boxOwn = !!(conv.boxFirst && conv.boxFirst.has(c.id));
  if (!intents.privateDo(args.title) && (boxOwn || !intents.ownersDo([ctx.heard, ctx.newest].filter(Boolean).join('\n')))) return;
  // (what the request filled in - the time from the owner's words - rides with the question, so the tap puts up the same event)
  c.args = Object.assign({}, c.args, args);
  const e = new actions.ActionError(`"${args.title}" may be someone's own occasion - the box asks the owner before it goes on the public Events page`);
  e.ask = { param: '__public', question: `Put ${args.title} on your public Events page, or is it a private booking?`, choices: ['Public - put it on the Events page', 'Private booking - keep it off'], values: [true, false] };
  throw e;
}
// A HALF, SAID EVERY WAY IT IS TYPED (the review of round 2b, Oct 27 2026: only "7 and a half" was read - "7 and half", "7 & a half", "7and a
// half" were put up as a 7% tax, "2 and half hours" / "2 hours and half" as 2 hours, "an hour and half" as 60 minutes free). The number
// and its half become one number ("7.5", "1.5 hours"), "half an hour" is "0.5 hours", "7 1/2" and "7½" are 7.5; whatever half is left
// over was not read exactly, and the readers below then read nothing (the model has the words, with the question beside them).
// { text, halved }
const HALF_AND = '(?:\\s*(?:and|&|\\+)|\\s+n)\\s*(?:a\\s+)?half\\b';
function halfRead(words) {
  const N = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
  let t = String(words || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\u00bd/g, ' and a half').replace(/(\d)\s+1\/2(?![\d\/])/g, '$1 and a half'), halved = false;
  const swap = (re, f) => { t = t.replace(re, (...x) => { halved = true; return f(...x); }); };
  swap(new RegExp('(?<![\\d.])(\\d+)' + HALF_AND, 'g'), (x, n) => String(Number(n) + 0.5));                                      // 7 and half
  swap(new RegExp('(?<![\\d.])(\\d+)(\\s*(?:hours?|hrs?))' + HALF_AND, 'g'), (x, n, u) => String(Number(n) + 0.5) + u);           // 2 hours and half
  swap(new RegExp('\\b(an?|one|two|three|four|five)\\s+(hours?|hrs?)' + HALF_AND, 'g'), (x, n, u) => (N[n] + 0.5) + ' ' + u);       // an hour and half
  swap(new RegExp('\\b(an?|one|two|three|four|five)' + HALF_AND + '(?=\\s*(?:hours?|hrs?)\\b)', 'g'), (x, n) => String(N[n] + 0.5)); // two and half hours
  swap(new RegExp('\\b(?:hour|hr)' + HALF_AND, 'g'), () => '1.5 hours');                                                                 // hour and a half
  swap(/\b(?:an?\s+)?half(?:[- ]an?)?[- ](?:hours?|hrs?)\b/g, () => '0.5 hours');                                                     // half an hour, a half hour
  return { text: t, halved };
}
// the owner's answer to the box's own question, read as what was asked: a phone, an email, an amount of money, a percent
function parseIn(kind, words, question) {
  const w = String(words || '');
  // (a price: "$12 and a half" is 12.5, never 12 - a half not read exactly is not read; Oct 27 2026)
  if (kind === 'money') { const t = halfRead(w).text; if (/\bhalf\b/.test(t)) return null; const m = t.replace(/,(?=\d{3}\b)/g, '').match(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)/); return m ? Number(m[1]) : null; }
  // (a tax rate: "7 and a half percent" and "7 and a half" are 7.5 - they were put up as 7; and a whole number, never the start of one -
  // "100" was read as 10. The review, Oct 27 2026)
  // (and "7 and half", "7 & a half", "7and a half" are 7.5 as well; "0.07" - 7%, or seven hundredths of one? - and two numbers are never
  // read: maintainer, never guess a tax. "0.07" had been put up as 0%, read as "no tax" - the review of round 2b, Oct 27 2026)
  if (kind === 'percent') {
    const t = halfRead(w).text;
    if (/\b(?:no tax|none|zero)\b|(?<![\d.])0(?:\.0+)?(?![\d.])/.test(t) && !/[1-9]/.test(t)) return 0;
    if (/\b(?:half|quarter|third|point)\b/.test(t)) return null;
    const ns = [...new Set((t.match(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g) || []).map(Number))];
    if (ns.length !== 1) return null;
    const v = ns[0];
    if (v > 0 && v < 1 && !/%|\bpercent\b|\bpct\b/.test(t)) return null;
    return v <= 30 ? v : null;
  }
  // (an amount off or a number of minutes - any size: "percent" is a tax rate's, which stops at 30; Oct 23 2026)
  // ("half" is 50 only for a percent off: asked "How many minutes free?", "a half hour" was put up as 50 minutes free - Oct 27 2026; a
  // half hour, an hour or an hour and a half said in words is that many minutes, and "half" to dollars off is not read)
  if (kind === 'number') {
    const q = String(question || '').toLowerCase();
    // (dollars asked, a percent said - "10%" to "How many dollars off?" - is not this number: Oct 27 2026)
    if (/\bdollars?\b|\$/.test(q) && /%|\bpercent\b|\bpct\b/i.test(w)) return null;
    // ("2 hours" to the minutes question is 120 minutes, never 2; "1 and a half hours" is 90 - it was read as 1 minute, the digit first
    // with no "hours" straight after it: the review, Oct 27 2026. "and a half" with no hours after it is not read)
    // (every way a half is typed - "1 and half hours", "1 & a half hours", "an hour and half" - halfRead; a half left over is not read)
    const { text: t, halved } = halfRead(w);
    const m = t.replace(/,(?=\d{3}\b)/g, '').match(/(?<![\d.])(\d{1,5}(?:\.\d{1,2})?)(?!\d|\.\d)(\s*(?:hours?|hrs?)\b)?/i);
    if (m) { if (/\bhalf\b/.test(t)) return null; const inMins = !!m[2] && /\bminutes?\b/.test(q); if (halved && !inMins) return null; return inMins ? Math.round(Number(m[1]) * 60) : Number(m[1]); }
    if (/\bminutes?\b/.test(q)) return /\bhalf\b/.test(t) ? null : /\b(?:an?|one) hour\b/i.test(t) ? 60 : null;
    return /\bpercent\b|%/.test(q) && /\bhalf\b/i.test(w) ? 50 : null;
  }
  // one of the dates the box offered (which Saturday): the day's number or the date, else "today" / "this" the first and "next" or
  // "week" the last
  if (/^oneof:/.test(kind)) {
    const vals = kind.slice(6).split('|'), l = w.toLowerCase();
    const named = vals.filter(v => l.includes(v) || new RegExp('\\b' + Number(v.slice(8)) + '(?:st|nd|rd|th)?\\b').test(l));
    if (named.length === 1) return named[0];
    // another weekday said in its place is the coming one ("sorry, I meant Sunday" to "Which Saturday - today or next Saturday?" was
    // handed to the model - the week runner, Saturday Oct 31 2026); with "next", "last" or "every" (tomorrow, or a week on?) or two days
    // said it is not plain
    const t0 = new Date(vals[0] + 'T12:00:00Z'), days = isNaN(t0) ? [] : weekdaysIn(l).filter(d => d !== t0.getUTCDay());
    if (days.length) return days.length === 1 && !/\b(?:next|last|every|each|week)\b/.test(l) ? actions.addDays(vals[0], (days[0] - t0.getUTCDay() + 7) % 7) : null;
    if (/\b(?:next|week)\b/.test(l)) return vals[vals.length - 1];
    if (/\b(?:today|tonight|this)\b/.test(l)) return vals[0];
    return null;
  }
  // a booking's length in hours: "2", "2 hrs", "two hours", "an hour and a half"
  // (a whole word or number only: the "a" inside "make", "about", "say" and "at" was read as "a" = 1 hour, so "make it 2 hours", "about 3
  // hours" and "at least 3" were each put up as 1 hour - the review, Oct 27 2026. "a" or "an" counts only with "hour" after it; "90
  // minutes" is an hour and a half; and a length not on the half hour - the deal holds half hours - is never rounded into one)
  // (and "2 and half hours", "2 & a half hours", "two and half hours", "2 hours and half" are 2.5 - they were 2: halfRead, Oct 27 2026)
  if (kind === 'hours') { const N = { an: 1, a: 1, one: 1, two: 2, three: 3, four: 4 };
    // ("two and a half", "one and a half" with no "hours" - the question asked for hours - is 2.5 and 1.5: they were read before round 2c,
    // and halfRead joins a spelled-out number to its half only with "hours" after it - the review of round 2c, Oct 27 2026)
    const sp = new RegExp('^\\s*(?:about\\s+|maybe\\s+|like\\s+)?(one|two|three)' + HALF_AND + '\\s*[.!]?\\s*$').exec(w.toLowerCase());
    if (sp) return N[sp[1]] + 0.5;
    const t = halfRead(w).text; if (/\bhalf\b/.test(t)) return null;
    const m = t.match(/(?<![a-z\d.])(?:(\d+(?:\.\d+)?)(?!\d|\.\d)|(an?)(?=\s+(?:hours?|hrs?)\b)|(one|two|three|four)(?![a-z]))(\s*(?:hours?|hrs?|minutes?|mins?)\b)?/);
    if (!m) return null; let h = m[1] !== undefined ? Number(m[1]) : N[m[2] || m[3]];
    if (m[4] && /^\s*min/.test(m[4])) { if (!Number.isInteger(h)) return null; h = h / 60; }
    return h > 0 && h <= 4 && Number.isInteger(h * 2) ? h : null; }
  return contactIn(kind, w);
}
// a copy of a call's arguments with one set at its path ("items.2.price"), or taken out (undefined)
function setPath(args, path, value) {
  const out = JSON.parse(JSON.stringify(args || {})), keys = String(path).split('.');
  let o = out; for (const k of keys.slice(0, -1)) { if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  if (value === undefined) delete o[keys[keys.length - 1]]; else o[keys[keys.length - 1]] = value;
  return out;
}
// a phone or an email in the owner's answer to the box's question for it
function contactIn(kind, words) {
  const w = String(words || '');
  if (/e-?mail/i.test(kind)) { const m = w.match(/[^\s@<>(),;]+@[^\s@<>(),;]+\.[a-z]{2,}/i); return m ? m[0] : null; }
  const m = w.match(/\+?\d[\d\s().-]{6,}\d/); return m && m[0].replace(/\D/g, '').length >= 7 ? m[0].trim() : null;
}
// THE OWNER WALKED AWAY FROM A QUESTION (Oct 24 2026, the chat at every size): words that read as a new request - a question, or a
// request's first word - and share no word with the question or its answers. "what's booked tomorrow?" after "Which tax does it use?"
// walked away (it is three words: the old rule needed four, and the model was never told); "make it beverage" and "the drinks one"
// did not (an answer the box could not read is the model's to read)
const NEW_REQUEST = /\?|^\s*(?:what|whats|what's|who|whos|who's|when|where|how|is|are|can|could|do|does|did|any|show|list|book|block|add|make|set|put|turn|send|text|email|change|move|cancel|remove|delete|close|open|give|take|check|find|run|start|stop|schedule|hire)\b/i;
function walkedAway(words, question, choices) {
  const w = String(words || '').toLowerCase();
  if (!w.trim() || !NEW_REQUEST.test(w)) return false;
  const theirs = new Set(w.match(/[a-z0-9]{3,}/g) || []);
  const asked = (String(question || '') + ' ' + (choices || []).join(' ')).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const common = new Set(['the', 'and', 'for', 'you', 'your', 'our', 'this', 'that', 'what', 'which', 'does', 'use', 'new', 'one', 'with', 'are', 'can', 'how', 'now']);
  return !asked.some(x => !common.has(x) && theirs.has(x));
}
// the model's own question with answers to tap (ask_owner), asked last before the owner's newest words: { question, choices } or null
function lastAskOwner(conv) {
  const m = conv.messages; let i = m.length - 1;
  while (i >= 0 && m[i].role !== 'user') i--;
  for (i--; i >= 0; i--) {
    if (m[i].role === 'user') return null;
    const c = m[i].role === 'assistant' && (m[i].tool_calls || []).find(x => x.function && x.function.name === 'ask_owner');
    if (c) { try { const a = JSON.parse(c.function.arguments); return { question: String(a.question || ''), choices: Array.isArray(a.choices) ? a.choices.map(String) : [] }; } catch { return null; } }
  }
  return null;
}
// which of the answers the owner's words are: the answer itself, or words that hold exactly one of them
function choiceIn(choices, words) {
  const n = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), w = n(words);
  if (!w) return null;
  const exact = choices.filter(c => n(c) === w); if (exact.length === 1) return exact[0];
  const held = choices.filter(c => n(c) && (` ${w} `.includes(` ${n(c)} `) || (w.length >= 4 && n(c).startsWith(w))));
  return held.length === 1 ? held[0] : null;
}
// THE OWNER'S TYPED ANSWER TO "PUT X ON YOUR PUBLIC EVENTS PAGE, OR IS IT A PRIVATE BOOKING?" (Oct 28 2026, round 2f - the critic of round
// 2e: only the start of a choice was read - "public", "private". "its public", "yes public" were asked the same again, "yes put it on the
// events page" was taken as walking away and nothing went up, and "its private", "private party", "keep it off", "no its private" were not
// Private - the model's retry was asked again right after the owner said private). Short words that say one side and not the other: that
// choice; anything else is read as before
// A "NOT" WITH PUBLIC IS PRIVATE, AND PUBLIC IS ONLY PUBLIC SAID PLAINLY (Oct 28 2026, round 2g - the reviewer and the critic of round 2f, HIGH:
// "dont make it public", "i dont want it public", "not for the public", "no not on the public page", "it shouldnt be public", "hide it from
// the public" were each read as Public - the word "public" was there and the short private list did not know them - and the person's own do
// went on the public Events page at once with their name on it). Any no, not, don't, never, hide or shouldn't in an answer that names the
// public side is Private - the side where nothing goes up; Public is the public side said with no negative word at all
// ('public' | 'private' | null)
function publicRead(words, long) {
  let t = ' ' + String(words || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  if (!long && t.trim().split(' ').length > 8) return null;
  const NEG = /\b(?:not|no|nope|nah|nay|dont|don't|do not|never|hide|hidden|hiding|shouldnt|shouldn't|should not|wont|won't|will not|isnt|isn't|is not|aint|ain't|without|nobody|noone)\b/;
  const PRIV = /\b(?:private|keep it off\b.*|keep it private|not public|not an event|off the (?:events? )?(?:page|calendar|site|website)|(?:do not|don'?t|dont|never) (?:put|post|list|add)\b.*|not on the (?:events? )?(?:page|calendar|site|website)\b.*|just a booking|a booking|hide|hidden|hiding)\b/g;
  const priv = PRIV.test(t), neg = NEG.test(t); t = t.replace(PRIV, ' ');
  const pubWords = /\b(?:public|put it (?:up|on)|post it|list it|events? (?:page|calendar)|on the (?:events? )?(?:page|calendar|site|website)|go ahead|it'?s an event|its an event|open to (?:everyone|the public|all))\b/.test(t);
  if (neg && (pubWords || priv)) return 'private';
  if (pubWords && !priv) return 'public';
  if (priv && !pubWords) return 'private';
  return null;
}
function publicSaid(choices, words) {
  const r = publicRead(words);
  if (!r) return null;
  return (choices || []).find(c => (r === 'public' ? /^public\b/i : /^private\b/i).test(String(c))) || null;
}
// THE EVENTS PAGE CHOSEN IN THE REQUEST IN HAND IS THE PUBLIC ANSWER (Oct 28 2026, round 2g - the demo brain's D89 and the round's brief: the
// brain asks 'Is "Company Party" a private party?', the visitor taps "Put it on the Events page", the brain shows the event back and the Yes
// met the box's own "Put Company Party on your public Events page, or is it a private booking?" - the same question twice, and the Yes to it
// read as nothing). An owner's turn in the request in hand that answers a question about whether it is private or public - or about the
// Events page - with the public side said plainly (publicRead: no "not", "dont", "no" with it), or that names the PUBLIC Events page itself
// ("put it on the public events page", "make it public"), is the answer: the box does not ask it again. "put sarahs 40th on the events page"
// as the request itself is no answer - it is asked, as before - and neither is "put it on the events page anyway" said after Private with no
// question about it (asked again: the owner may have changed their mind)
function publicChosen(ctx) {
  const turns = (ctx && ctx.inHand && Array.isArray(ctx.inHand.turns)) ? ctx.inHand.turns : [];
  return turns.some(t => {
    const s = String((t && t.said) || ''), q = String((t && t.q) || '');
    // (the public side named - never a bare "go ahead" or "yes", which answer whatever else the question asked)
    if (publicRead(s, true) !== 'public' || !/\b(?:public|events? (?:page|calendar)|put it up|post it|list it|on the (?:site|website)|open to (?:everyone|the public|all))\b/i.test(s)) return false;
    if (/\?/.test(q) && /\b(?:private|public|events? page|events? calendar|on the events)\b/i.test(q)) return true;
    return /\bpublic\b/i.test(s);
  });
}
// what the box asked last, before the owner's newest words: its words, and a question put with answers to tap (ask_owner)
function lastAsked(conv) {
  const m = conv.messages; let i = m.length - 1;
  while (i >= 0 && m[i].role !== 'user') i--;
  for (i--; i >= 0; i--) {
    if (m[i].role === 'user') return '';
    if (m[i].role !== 'assistant') continue;
    const asks = (m[i].tool_calls || []).filter(c => c.function && c.function.name === 'ask_owner').map(c => { try { return String(JSON.parse(c.function.arguments).question || ''); } catch { return ''; } });
    const t = [String(m[i].content || '')].concat(asks).join(' ').trim();
    if (t) return t;
  }
  return '';
}
// screen: where the change shows (screens.js) - the owner's page moves its view there and watches it land (maintainer, Oct 20 2026)
// args: what the box settled on - the model's own, checked, with a bare evening hour and a named period put right - so what is
// scored is what the box does (Oct 22 2026)
const publicProposal = (p) => ({ id: p.id, action: p.action, describe: p.describe, confirm: p.confirm, request: p.request, screen: p.screen || null, args: p.args });

// ── WHICH TOOLS A SMALL MODEL IS HANDED (Oct 20 2026) ─────────────────────────────────────────────────────────────
// maintainer: "the AI needs to know and have access to everything. and control everything" - well over a hundred actions. A small
// model on the box picks the right one of twenty far more often than the right one of a hundred and fifty, and reads fewer
// words before it answers. So it is handed the core ones (asking, the guide, the checklist, the health line, more_tools)
// and the areas the talk is about: what the owner's newest words name, what was used in the last turns, the setup step
// being worked on, and any area it asked for with more_tools this turn. The owner's own big service is handed the same (Oct 23
// 2026, a real Claude through the box's own client): every tool was 288 of them, about 150,000 of Claude's tokens on each call -
// four to thirteen seconds a step with the list cached, and 56 cents and longer again each time the five-minute cache had lapsed
// on Sonnet. It holds far more than the box, so its tools are never trimmed to fit (fitPrompt), and it asks for any other part
// with more_tools as the small model does.
// (Oct 20 2026) everyday words added after the demo brain's run: "who is on tonight", "how did we do this week", "bigger
// headings", "a solid top bar", "add league night" found no area, and a small model spent a round on more_tools first;
// later that night, a sentence about the place ("we're an indoor golf lounge, open late") - the top of the page is written from it
const AREA_WORDS = {
  // (Oct 21 2026, night - maintainer: "as fast and as accurate as possible") the words below were read against every request in both
  // checked sets (tools/assistant-routing.js): a word an owner uses for many things ("hours", "open", "card", "put it back",
  // "tomorrow", "working", "$5") no longer brings an area by itself - it sits in AREA_HINTS, read only when nothing here
  // matched. "make a $50 gift card" was handed the whole website (8,000 tokens) for the word "card"; "put it back in service"
  // the website's undo; "is there an update?" and "door codes" found no area at all
  website: /\b((?:on|onto|to|from) (?:the |our |my )?(?:web ?)?site\b(?! (?:is )?(?:up|online|working)\b)|home ?page|landing|sections?|hero|headlines?|banners?|(?<!further |short |advance )notices?|announcements?|faq|questions people|specials?|promo(?! codes?)|offers?|testimonials?|(?<!day |daily )reviews?|videos?|(?<!contact |inquiry )forms?|(?<!gift |credit |debit |key |member |membership )cards?(?! readers?| payments?)|coach(?:es)?|lessons?|packages?|words on|undo|put (?:it|that) back(?! (?:in|into|on)\b)|(?:site|website|page) (?:\w+ )?ready|we(?:'re| are) an?|this is an?|our place is|(?:content|text|photo|faq|video|new) blocks?)\b/i,
  // (Oct 21 2026, night) the website's events, photos and own pages are their own parts: "what events do we have coming up?"
  // is handed 1,100 tokens of tools, not the website's 8,000. A photo the owner adds in the chat comes as its address
  events: /\b(leagues?|scrambles?|clinics?|(?<!private )events?|(?:league|trivia|ladies'?|couples'?) nights?)\b/i,
  photos: /\b(photos?|pictures?|pics|gallery|slides?|slideshow|images?)\b|\/uploads\//i,
  // a flyer for a deal, a package, an event or a special, and putting it on Facebook or Instagram (Oct 22 2026, late night)
  // ("put our Instagram on the site" is the site's social links - only a flyer or a poster is this part)
  flyers: /\b(flyers?|posters?)\b/i,
  pages: /\b((?<!facebook |instagram |fb |social |booking |memberships? |gift cards? |events |members? )pages?|how it works|one page|single page)\b/i,
  look: /\b(typefaces?|serifs?|script|cursive|handwriting|italics?|weights?|letter spacing|line spacing|space between lines|readab\w*|(?:easier|hard|harder) to read|headings?|top bar|header bar|book now bar|tabs?|menu button|hamburger|(?:bottom|phone|app) bar|bar at the bottom|text size|colou?rs?|fonts?|styles?|(?:the|a|its|new|whole|our|my) looks?|look (?:of|and feel|more|less)|looks? (?:more|less|like a|modern|dated|old)|theme|modern|bold|minimal|classic|friendly|buttons?|round(?:er|ed)?|square|pill|corners?|shadows?|spacing|airy|compact|wider|narrower|capitals|logo|dark(?:er)?|light(?:er)?|bright(?:er)?|black|white|blue|green|red|orange|purple|gold|navy|teal|pink|yellow|gr[ae]y|charcoal|cream)\b/i,
  site: /\b(public|hide|hidden|homepage|go live|launch the (?:site|website)|(?:top|nav\w*|site|website|main|page) menu|menu (?:bar|links?)|footer|(?:social|menu|footer|our own) links?|links? (?:in|to) the (?:menu|footer)|social|instagram|facebook|tiktok|youtube|google|search|seo|sharing|shared?|analytics|pixel|counting visitors|holding page|coming soon|sign[- ]?up (?:form|list|box)|email sign[- ]?ups?|(?:see|sees|shows?) first|front page|first page|booking page|email updates|contact(?! form)|phone numbers?|email address|map)\b/i,
  bays: /\b(bays?|simulators?|sims?|power|restart|reboot|out of (?:service|order)|in service|maintenance|broken|frozen|won'?t (?:respond|start|turn on)|wake|shut ?(?:down|off|everything)|fire up|turn(?:ing|ed)? (?:on|off)|switch (?:on|off)|switch \w+(?: \w+)? off|turn(?:ing|ed)? (?:the |all |every )?\w+(?: \w+)? (?:on|off)|try (?:it |that |them )?again|automation|failed|retry|closing time|at close|after (?:we|you) close|what'?s (?:going on|on)(?! (?:our|the) (?:menu|website|site|tap|calendar)))\b/i,
  baysetup: /\b((?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:simulator |sim |golf |hitting )?bays|bays? (?:called|named)|name (?:the|our|my|all|each) (?:\w+ )?bays|link (?:the |a |its |this )?(?:pc|computer)|scan|network|plugs? (?:on|in|to|at|for)|(?:add|link|connect|set up|rename|remove|move|find|learn|take|took|pull|swap|test|unplug)\b[^.?!]{0,30}\b(?:pcs?|computers?|plugs?|tvs?|televisions?|projectors?|screens?|remotes?)|(?:pcs?|computers?|plugs?) (?:address|is at|ip|wake|sign-?in|password|user)|(?:device|plug|pc|tv|bay)s? timing|shelly|watchers?|monitor|windows? (?:sign-?in|user|password|login|appears?|opens?|pops? up)|rename|new bay|(?:add|remove|delete) (?:a |the |another )?(?:\w+ )?bay|(?:we have|there are|we'?ve got|we got|we run) (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve) (?:\w+ )?bays|(?:call|name) (?:them|it|the bays?|each bay)|(?:come|comes|go|goes|turn|turns) (?:on|off) (?:with|before|after|when)|premium|remotes?|ir|broadlink|learn|between (?:sessions|groups|bookings)|next (?:player|group|booking|session)|back[- ]to[- ]back|(?:more|extra|less) (?:per|an|a|for) (?:half[- ]hour|hour)|\d{1,3}(?:\.\d{1,3}){3})\b|\$\d+(?:\.\d\d)? (?:more|extra|less)\b/i,
  // (Oct 22 2026) a bay PC's routines - taught by clicking through, run on a hotkey or a session's start or end
  routines: /\b(routines?|teach|watch (?:me|this|what)|hotkeys?|sign(?:s|ed)? (?:it )?(?:back )?in|keep it running|reopen|staff pad|gs ?pro|uneekor|trackman|foresight|full ?swing|e6|tgc|launch monitors?|connector|simulator software|sessions? (?:ends?|starts?|begins?)|(?:end|start) of (?:each|a|the) session|when (?:a|each|the) session|copy\b[^.?!]{0,40}\bto (?:every|all|each|the other)|(?:pause|resume) (?:the |a )?(?:routine|step)|automat(?:e|ing)|programs? (?:opens?|closes?|starts?)|(?:open|close|start|launch) (?:the )?(?:game|program|software|app))\b/i,
  smarthome: /\b(z-?wave|zigbee|(?<!no |doesn'?t |does not )matter\b(?! what| how| when| where| which| who| if)|devices?|pair(?:ing)?|lights?|thermostats?|heat(?:er|ing)?|cooling|cool (?:it|the|down)|a\/c|ac|air condition\w*|hub|home assistant|smart[- ]?(?:home|plugs?|devices?|lights?|locks?|switch\w*|thermostats?)|sensors?|fans?)\b/i,
  staff: /\b(who(?:'?s| is| are) (?:on|in|working|scheduled)|who works|shifts?|schedul\w*|staff|employees?|time[- ]off|days? off|roster|(?<!o['’])clock(?:ed)? (?:in|out)|clocked|time ?clock|punch\w*|patterns?|(?:shift|time-?off|swap) requests?|requests? waiting|workers?|working (?:today|tonight|tomorrow|this|next|on|the|at|saturday|sunday|monday|tuesday|wednesday|thursday|friday)|sign-?in codes?|hours export|hours (?:report|sheet)|time ?sheets?|payroll|send (?:the |last (?:period|week)'?s? |our )?hours|period'?s hours|quit|hired?|hiring|covers? (?:for|a shift|the shift)|swap\w*|put \w+(?: \w+)? on (?:mon|tue|wed|thu|fri|sat|sun|today|tonight|tomorrow)\w*)\b/i,
  staffing: /\b(employee scheduling|scheduling (?:on|off)|turn (?:on|off) (?:the )?(?:employee )?scheduling|staffed|staffing|seasons?|at the (?:counter|front desk)|front desk|counter (?:hours|staff|coverage)|someone (?:here|in|at the counter)|staff here|deposit days?)\b/i,
  members: /\b(members?|memberships?|tiers?|pins?|joined|join (?:as a member|the (?:club|membership|plan)|up)|suspend\w*|usage|renew\w*|membership plans?|(?:on|to) the [\w' ]{1,30} plan|(?:has|have|did) [a-z]+(?: [a-z]+)? (?:used|played)|hours (?:left|remaining|used))\b/i,
  money: /\b(packages?|package deals?|bundles?|deals|deal(?! with)|promotions?|promos?|last (?:\d+|half|thirty) (?:minutes? |min |hour )?free|free (?:half hour|hour|30 minutes)|free (?:\w+ ){0,2}(?:pitchers?|beers?|drinks?|appetizers?|apps|pizzas?|wings|sodas?|fries|nachos|pops?|shots?|buckets?)|(?:pitchers?|beers?|drinks?|appetizers?|pizzas?|wings|sodas?) (?:free|on us|on the house)|buy one,? get one|bogo|buy (?:an?|one|1) hours?|get (?:an?|one|1)(?: more)? hours? free|(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weeknights?|nights?|mornings?|afternoons?|days?) (?:are|r|is|get|been|have been) (?:so |really |pretty )?(?:dead|slow|quiet|empty)|(?:party|birthday|corporate|league) (?:packages?|deals?)|slow (?:days?|nights?|mondays?|tuesdays?|wednesdays?|thursdays?)|bring (?:more )?(?:people|customers|golfers) in|get (?:more )?(?:people|customers|golfers) in|ideas?|how (?:did|are) we (?:do|doing)|what did we (?:make|take|bring in)|prices?|pricing|rates?|cheaper|discounts?|(?:discount|promo|coupon|sale|percent) codes?|codes? for \d+|[a-z]+\d+ code|code [a-z]+\d+|percent off|deposits?|tax(?:es)?|gift ?cards?|refund\w*|stripe|payments?|charge|costs?|happy hour|peak|off-?peak|revenue|card readers?|readers?|terminal|tip (?:prompt|screen|pool)|tips?|taking (?:cash|checks|cards)|(?:accept|take|takes) (?:cash|checks|cards)|checks? at the counter|cash drawer|connected|connections?|sales|end of day|drawer|earn\w*|money|takings|how much did we \w+)\b|\d+ ?% off|\$?\d+(?:\.\d\d)? (?:a|an|per|for (?:a|an|each)) (?:half[- ]hour|hour|30 minutes)\b|\b\d+ ?(?:bucks|dollars)\b|\b(?:bday|b-day|birthday) part(?:y|ies)\b/i,
  messages: /\b(e-?mails?|texts?(?! (?:size|colou?r|font|box|block|section|only on))|texting|texted|sms|newsletters?|messages?|templates?|reminders?|twilio|resend|inbox|inquir\w*|marketing|webhooks?|zapier|alerts?|contact forms?|opt-?outs?|replied stop|stop replies|stop (?:texting|emailing|sending)|subscribers?|signed up|words customers)\b/i,
  setup: /\b((?:someone|somebody|staff|nobody|no ?one|an employee|a person)\b[^.?!]{0,25}\b(?:at the counter|behind the counter|works? there|on site)|door codes? (?:only|the rest|other(?:wise| times| days)?)|(?:all|only|just) door codes|how (?:we|the facility|it) runs?|(?:opening|open|business|our|store|facility|regular) hours|hours (?:are|of operation)|open (?:at|from|until|till|til|late|early|24|every|on|daily|around|\d)|opening|we(?:'re| are) (?:open|closed) (?:on|at|from|\d|every)|closing (?:time|at)|close (?:at|early|\d)|waivers?|setup|(?:left|still|need) to set up|checklist|(?<!ip |mac |email |web )address|location|city|domain|business name|legal(?: name)?|llc|passphrase|ai|model|openai|chatgpt|claude|cancel(?:lation)? window|cancel up to|cancel within|unstaffed|hybrid|self-?serve|rules|sessions? lengths?|shortest|minimum|maximum|at least|buffer|booking window|how far ahead|days (?:ahead|out)|book up to|24 ?hours|around the clock|members[- ]only|only members|(?:those|that|these|they|it)\b[^.?!]{0,20}?(?: are|'re| is|'s| look| looks) (?:right|correct|fine|good)|that'?s correct|whole (?:facility|building)|time ?zone|eastern|central|mountain|pacific|contact(?! form)|early (?:access|entry|bay)|let (?:them|people|customers) in early|(?:turn|switch)\w* [^.?!]{0,20} on early|(?:show|shows|come|comes|arrive|arrives) (?:up )?(?:early|before their time)|before their (?:time|booking|session))\b/i,
  // getting the box online (Oct 21 2026, last): the domain, Cloudflare, the company the domain was bought from, the connection;
  // an address written out (book.yourgolf.com - not an email's)
  online: /\b(domains?|nameservers?|name servers?|dns|dnssec|cloudflare|tunnel|connect\w* (?:my|the|our) box|hook (?:the|my|our) box|(?:my|the|our) box online|get (?:it |us |the box |my box )?online|go(?:ing)? online|online yet|on the internet|from outside|web ?address|url|registrar|godaddy|go ?daddy|namecheap|squarespace|wix|ionos|porkbun|hostinger|network solutions|mx records?|email records?|is (?:my|the|our) (?:site|website) (?:up|live|working|online))\b|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|us|golf|club|biz|info|io|app|ca|uk)\b/i,
  // the counter's food and drink menu (Oct 20 2026, night)
  menu: /\b(specials?|happy hours?|half off|half price|two for one|2 for 1|bogo|deals|deal(?! with)|(?:wing|taco|burger|pizza|trivia|ladies'?) (?:night|tuesday|wednesday|thursday)|menus?|food|drinks?|beers?|wines?|cocktails?|mocktails?|spirits|liquor|ipas?|lagers?|stouts?|ales?|seltzers?|ciders?|taps?|drafts?|burgers?|pizzas?|wings?|nachos|fries|apps|appetizers?|entrees?|desserts?|salads?|sandwich(?:es)?|snacks?|kitchen|86(?:'?d)?|eighty[- ]six(?:ed)?|sold out|(?:we'?re|we are|we'?ve run|ran) out of|servers?|ring (?:it|them) up|bar menu|printers?)\b/i,
  // how the business is doing, in numbers (Oct 20 2026, late)
  numbers: /\b(how (?:did|are|is|was|'s) (?:we|it|business|the business|the month|the week|today) (?:do|doing|going|look\w*)|how'?s business|are we (?:up|down)|up (?:from|on) last|down (?:from|on) last|compared?|versus|vs\.?|busiest|slowest|profit\w*|how many (?:bookings|sessions|people|customers|members)|memberships? (?:sold|joined)|new (?:customers|members)|who(?:'?s| is| are) (?:playing|on the bays?|in (?:bay|the bays?))|playing (?:now|right now)|anyone (?:playing|in)|(?:today|tonight|tomorrow|this week)(?:'s)? look\w*|look(?:ing|s)? like|numbers|stats|statistics|trends?|best ?sell\w*|tax(?:es)?|spreadsheet|excel|export)\b/i,
  bookings: /\b(book|booked|bookings?|reservations?|cancel\w*|block(?:ed)? off|blocked|blocks? (?:off|out)|block (?:the|a|bay|\w+ for)|take the block|walk-?ins?|check(?:ed)? ?in|check-in|mov(?:e|ing) (?:the|a|\w+'?s?) (?:\d|booking|reservation|session|group)|mov(?:e|ing) \w+(?: \w+)? to (?:\d\w*|bay|tomorrow|today|tonight|(?:mon|tue|wed|thu|fri|sat|sun)\w*)|(?:at|from) \d{1,2}(?::\d\d)? ?(?:am|pm)? for (?:an?|\d+|one|two|three|half an) (?:hours?|half)|reschedul\w*|no-?shows?|checkouts?|pending|quote|tee ?times?|who'?s (?:booked|coming)|coming in|how much (?:would|will|is|does|for)|what would [^.?!]{0,40}cost|(?:is|are) [^.?!]{0,30} (?:free|open|available) (?:on|at|this|next|tonight|tomorrow|(?:mon|tue|wed|thu|fri|sat|sun)\w*)|maintenance|close the whole|private event)\b/i,
  // the unit itself (Oct 21 2026, night): its software updates, backups and the record files - no word brought it before
  unit: /\b((?:software|system|box|unit|an?|the|any|new|available) updates?|update (?:available|tonight|now|the (?:box|unit|software|system))|updates? (?:waiting|available)|check(?:ing)? for updates|up to date|(?:keep|kept|keeping|hold|holding) (?:customer|customers'?|people'?s?|their|personal) (?:details|data|info\w*|records)|how long (?:we |do we )?keep|install (?:it|the update|tonight)|upgrade|new version|(?:software|what) version|roll ?back|undo the update|backups?|back (?:it |us |everything |the box )?up|usb|thumb ?drive|flash drive|export|download (?:all )?(?:the |a |my )?(?:records|file|spreadsheet|csv|report|bookings)|spreadsheet|csv|excel|year[- ]end|calendar feed|ical|(?:google|outlook|apple|my) calendar|records)\b/i,
  // door codes (Oct 21 2026, night): no word brought them before
  doors: /\b(doors?|door codes?|locks?|lock codes?|keypads?|entry codes?|access codes?|unlock)\b/i,
};
// WORDS THAT MEAN MANY THINGS (Oct 21 2026, night): read only when neither the words above nor the facility's own names
// (namesIn) named an area - "two hours tomorrow" is a booking, not the opening hours; "$5" is a price only when nothing else
// says what it is for
const AREA_HINTS = {
  // "website" alone says what the owner means, not what to do with it: "make the website darker" is the look's
  website: /\b(web ?sites?|(?<!booking )sites?|buttons?|words)\b/i,
  events: /\b(tournaments?|parties|party|birthdays?)\b/i,
  setup: /\b(hours|open|opening|close|closing|closed|early|set ?up)\b/i,
  baysetup: /\b(pcs?|computers?|plugs?|projectors?|tvs?|televisions?|screens?|minutes (?:before|after)|timing)\b/i,
  staff: /\b(works?|working|requests?)\b/i,
  staffing: /\b(summer|winter|fall|spring)\b/i,
  members: /\b(pause\w*|plans?)\b/i,
  money: /\b(made|dollars?|bucks)\b|\$\d/i,
  bays: /\b(sessions?)\b/i,
  numbers: /\b(this (?:week|month|year|quarter)|last (?:week|month|year|quarter)|tomorrow|tmrw?|tmr|busy|longest|today)\b/i,
  bookings: /\b(mov(?:e|ing)|tournaments?|party|parties|free|available)\b/i,
};
// the setup checklist's steps, by the area that finishes each (admin.js setup-status ids)
// (Oct 21 2026, night) the starting answers' checks: "Your bays" was handed no way to add a bay
const SETUP_AREA = { confirmhours: 'setup', confirmwaiver: 'setup', waiverdoc: 'setup', backuppass: 'setup', confirmbays: ['setup', 'baysetup'], confirmprice: ['setup', 'money'], golive: 'site',
  password: 'setup', branding: 'website', citystate: 'setup', hours: 'setup', domain: 'online', access: 'setup', stripe: 'money', resend: 'messages', twilio: 'messages',
  event: 'events', backuppass: 'setup', staffedcopy: 'website', tier: 'members', mwaiver: 'members', waiverdoc: 'setup', staffedhours: 'staffing', checkin: 'bookings', wfrate: 'money' };
// (Oct 21 2026, latest - maintainer: "use your best knowlage of the smaller ai to see it doing work") Measured with the box's own
// quick model on a real prompt: "turn on The Vault" was handed 51 tools - about 11,400 tokens, three quarters of a 13,700-token
// prompt - because the setup checklist's next step (the website's 34) came with EVERY turn until setup was done. A small
// model picks the right tool of 17 far more often than of 51, and reads a third of the words before it answers. So the next
// setup step's tools come only when the owner's newest words name nothing else (a "yes", a "what's next", a name, a hello),
// and what was used stays at hand for the last two turns, not the whole talk.
const ownersWords = (conv) => { const said = conv.messages.filter(m => m.role === 'user'); return said.length ? String(said[said.length - 1].content || '').replace(/^[\s\S]*The owner says: /, '') : ''; };
const matching = (map, text) => Object.keys(map).filter(area => map[area].test(text));
const OPENED = /^\(The owner just opened the assistant\b/;   // public/assistant.js's hello as the chat opens
// THE FACILITY'S OWN NAMES (Oct 21 2026, night): "put Sarah Kim on Saturday", "move Blair to Weekday Online", "86 the Smash
// Burger", "how many people are on the Deposit Club?" - the name is the clue, beside the words. A staff member's
// first name alone counts when it is written with its capital (an owner types "Mike"; "will" and "may" are words); every
// other name counts whole - a member's only when it is a first and a last name (the members' names read alone, not their list)
function namesIn(text, names) {
  const plain = (x) => ' ' + String(x || '').toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const t = plain(text), has = (n) => { const w = plain(n); return w.trim().length >= 3 && t.includes(w); };
  const out = new Set();
  for (const n of (names && names.staff) || []) {
    const first = String(n || '').trim().split(/\s+/)[0] || '';
    if (has(n) || (first.length >= 3 && new RegExp('\\b' + first.replace(/[^A-Za-z'-]/g, '') + '\\b').test(String(text || '')))) out.add('staff');
  }
  if (((names && names.bays) || []).some(has)) out.add('bays');
  if (((names && names.tiers) || []).some(has)) out.add('members');
  if (((names && names.menu) || []).some(has)) out.add('menu');
  // a member by their whole name (Oct 22 2026, the breadth set: "Frankie Free's new phone number" found no member tools)
  if (((names && names.members) || []).some(n => String(n || '').trim().includes(' ') && has(n))) out.add('members');
  return [...out];
}
// the names, through the owner's own routes (what an action reads later this turn is kept for it - actions.js LOADERS)
async function facilityNames(ctx) {
  if (ctx && ctx.facilityNamesNow) return ctx.facilityNamesNow;   // once a turn (the owner's words are mended with them first)
  const get = async (p) => { try { const r = await ctx.call('GET', p); return r && r.status < 400 ? r.json : null; } catch { return null; } };
  const [roster, config, tiers, menu, members, specials, deals] = await Promise.all([get('/api/staff/roster'), get('/api/admin/config'), get('/api/members/tiers'), get('/api/pos/menu?all=1'), get('/api/members?names=1'), get('/api/pos/specials'), get('/api/pricing/deals')]);
  if (roster && ctx.roster == null) ctx.roster = roster.staff || [];
  if (config && ctx.bays == null) ctx.bays = config.bays || [];
  const tierList = Array.isArray(tiers) ? tiers : ((tiers && tiers.tiers) || []);
  const names = { staff: ((roster && roster.staff) || []).filter(x => x && x.active !== false).map(x => x.name),
    bays: ((config && config.bays) || []).map(b => b && b.name), tiers: tierList.map(x => x && x.name),
    menu: ((menu && menu.menu) || []).flatMap(c => ((c && c.items) || []).map(i => i && i.name)), members: Array.isArray(members) ? members : [],
    menuParts: ((menu && menu.menu) || []).map(c => c && (c.name || c.category)).filter(Boolean),
    // (the counter's specials and the booking deals: what "did our specials work?" studies, and the names it is asked by)
    specials: ((specials && specials.specials) || []).concat((deals && deals.deals) || []).map(x => x && x.name).filter(Boolean),
    guestTiers: tierList.filter(x => x && Number(x.active) !== 0 && Number(x.guest_allowed) === 1).length };
  if (ctx) ctx.facilityNamesNow = names;
  return names;
}
// THE PROMPT FITS THE MODEL (Oct 21 2026, night - the scored set on the laptop): "charge $5 more per half hour for The Vault" was
// handed the money, the bay setup and the bays - 16,435 tokens for a model server holding 16,384, and the owner would have read
// an error. Before asking, the parts handed are trimmed to fit: what the owner's own words named is kept longest, then the
// facility's names, then what was used, then the rest. assistant.contextTokens is the box's own model server's size
const contextTokens = () => { try { return Number(require('../config').getConfig().assistant.contextTokens) || 16384; } catch { return 16384; } };
// tokens as the box's model server counts them (measured on Qwen's tokenizer through llama.cpp, Oct 22 2026): the tools' JSON about
// 3.4 characters a token, a tool's answer about 3.0, the owner's and the model's words about 4.8 (a little room left on each)
const estTokens = (tools) => Math.ceil(JSON.stringify(tools).length / 3.3);
const estMessages = (msgs) => msgs.reduce((n, m) => n + 8 + Math.ceil(String(m.content || '').length / (m.role === 'tool' ? 2.9 : 4.3)) + (m.tool_calls ? Math.ceil(JSON.stringify(m.tool_calls).length / 3.3) : 0), 0);
// A long talk goes first, whole turns from the oldest (the brief and the last two turns always stay) - a long conversation alone
// outgrew the model's room in the demo brain's run; then the parts handed, the least named first
function fitPrompt(messages, handed, ctx, conv) {
  // only the box's own model server has a room this small: the owner's own service (OpenAI, Claude) holds far more
  if (model.settings().provider !== 'box') return { messages, tools: actions.tools(handed) };
  const budget = contextTokens() - 1200 - (ctx.overflowed || 0) * 2000;   // the answer's own room and the chat template's
  let msgs = messages, tools = actions.tools(handed);
  // first what the tools answered in the older turns (the bulk - a whole website read is 3,000 characters): the owner's and the
  // model's own words stay, and with them what "it" and "that one" mean (the flyer "for it" lost its special when whole turns went)
  if (estMessages(msgs) + estTokens(tools) > budget) {
    const users = msgs.map((m, i) => (m.role === 'user' ? i : -1)).filter(i => i > 0), keepFrom = users.length > 2 ? users[users.length - 2] : 0;   // the last two turns are never touched
    msgs = msgs.map((m, i) => (i < keepFrom && m.role === 'tool' && String(m.content || '').length > 80 ? Object.assign({}, m, { content: '(looked up earlier)' }) : m));
  }
  while (estMessages(msgs) + estTokens(tools) > budget) {
    const users = msgs.map((m, i) => (m.role === 'user' ? i : -1)).filter(i => i > 0);
    if (users.length <= 2) break;
    msgs = [msgs[0]].concat(msgs.slice(users[1]));
  }
  if (handed) {
    // what the model asked for with more_tools this turn is kept first of all - it asked because nothing else fitted
    const rank = (a) => (conv.areas || new Set()).has(a) ? 4 : (ctx.wordsNamed || []).includes(a) ? 3 : (ctx.namedAreas || []).includes(a) ? 2 : (conv.used || new Set()).has(a) ? 1 : 0;
    const keep = new Set(handed), msgT = estMessages(msgs);
    while (keep.size && msgT + estTokens(tools) > budget) {
      // among parts named alike, the smallest goes first: the big one is usually what the request is about ("we are an indoor golf
      // lounge with six bays, food and drink" is the website's top, beside the bays, the menu and the hours)
      const drop = [...keep].sort((a, b) => rank(a) - rank(b) || estTokens(actions.tools(new Set([a]))) - estTokens(actions.tools(new Set([b]))))[0];
      keep.delete(drop); tools = actions.tools(keep);
    }
  }
  return { messages: msgs, tools };
}
// the actions whose own readers go before the model (BOX FIRST) - the same ones the box falls back on after a round that made nothing
const BOX_READERS = ['flyer_make', 'deal_set', 'discount_code_create', 'price_window_add', 'counter_special_set', 'opening_hours_set', 'website_menu_set', 'website_social_set', 'door_code_timing_set', 'routine_teach', 'routine_create', 'device_pair'];
const DEAL_WORDS = /\bpackages?\b|\bpackage deals?\b|\bdeals\b|\bdeal\b(?! with)|\bpromotions?\b|\bthe (?:last|first) (?:\d+|half|thirty) (?:min|mins|minutes|hours?)(?: of it)? (?:are |is )?free\b|\b(?:\d+|half an?|thirty) (?:min|mins|minutes|hour) free\b|\bfree (?:half hour|30 minutes|hour)\b|\b\d+ (?:for|hours? for the price of) \d+\b/i;
function areasFor(conv, ctx) {
  const out = new Set(conv.areas || []);
  const newest = ownersWords(conv);
  // the newest words' own areas and the facility's names in them (run() reads those); else the words that mean many things.
  // The page's own hello when the chat opens is not the owner's words: it gets the next setup step's tools (Oct 21 2026,
  // night - its "setup screen" and "public" handed the first hello 64 tools, 15,000 tokens, on the owner's first look)
  const hello = OPENED.test(newest);
  let named = hello ? [] : [...new Set(matching(AREA_WORDS, newest).concat((ctx && ctx.namedAreas) || []))];
  if (!named.length && !hello) named = matching(AREA_HINTS, newest);
  // A DEAL OR A PACKAGE IS THE MONEY'S (Oct 22 2026, the 4B on the laptop: "make a party package: 2 hours, nachos and 2 beers
  // each, $25 a person" made a website section; "book 2 hours on Tuesdays and the last 30 minutes are free" was taken as a
  // booking): words naming one hand the money's tools, the menu's for what a package includes, and the website's or the
  // bookings' only when the owner names those too
  // (a counter special's own words keep the menu's tools: "end the taco tuesday deal" is the counter's special - the scored set)
  if (!hello && DEAL_WORDS.test(newest)) named = ['money'].concat(/\b(?:menu|beers?|drinks?|food|pizzas?|nachos|wings?|tacos?|burgers?|fries|pretzels?|wines?|cocktails?|shots?|apps|appetizers?|pitchers?|sodas?|specials?|happy hours?|counter|includes?|each|a person)\b/i.test(newest) ? ['menu'] : [])
    .concat(/\b(?:web ?site|page|section|homepage)\b/i.test(newest) ? ['website'] : []).concat(/\b(?:book(?:s|ed|ing)?|reserve)\b/i.test(newest) && !/\bfree\b|\boff\b|\bdeals?\b/i.test(newest) ? ['bookings', 'bays'] : []);
  named.forEach(a => out.add(a));
  // what was used in the last two turns stays at hand ("and the other one too")
  let from = 0, users = 0;
  for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'user' && ++users === 2) { from = i; break; }
  conv.used = new Set();
  for (const m of conv.messages.slice(from)) if (m.role === 'assistant') for (const c of m.tool_calls || []) { const a = actions.BY_NAME.get(c.function && c.function.name); if (a && a.area !== 'core') { out.add(a.area); conv.used.add(a.area); } }
  // words that name nothing ("yes", "do it", "the second one") answer the last turn: its parts stay at hand (Oct 21 2026, night -
  // the customer's day one: "yes" to "shall we set up your 4 bays?" lost the bays' tools, and the model asked again). The same
  // parts in the same order also let the model server keep the whole last prompt's work
  if (!named.length && !hello) for (const a of conv.prevAreas || []) out.add(a);
  if (!named.length) { const todo = ((ctx && ctx.setup) || []).find(s => !s.done && !s.optional); if (todo) [].concat(SETUP_AREA[todo.id] || 'setup').forEach(a => out.add(a)); }
  if (!out.size) out.add('setup');
  return out;
}

// WHAT TO TAP NEXT (maintainer, Oct 22 2026: "the end user is not really going to know what he wants or knows so it will be alot of do
// this and that not knowing what the software can do so we need to guide them especily the first setup and the first few times
// on doing new things"). An answer that offers nothing to tap gets the box's own next steps: after a change, what usually
// follows it; during setup, the steps still to do; after "I could not", a way on. A tap is the owner's next words, so each is
// said the way an owner says it (and finds its tools by its own words)
const SETUP_SAY = { citystate: 'Set my city', domain: 'Get my website address', backuppass: 'Set a backup passphrase', hours: 'Set my opening hours',
  confirmhours: 'Check my opening hours', confirmwaiver: 'Decide on waivers', waiverdoc: 'Where do I put my waiver?', confirmbays: 'Set up my bays',
  confirmprice: 'Set my price', branding: 'Add my logo', resend: 'Set up email', stripe: 'Connect Stripe for payments', twilio: 'Set up texting',
  event: 'Add an event', golive: 'Open my site to the public', checkin: 'How does check-in work?', tier: 'Make a membership', mwaiver: 'Waivers for members',
  staffedhours: 'Set our staffed hours', staffedcopy: 'Our staffed days on the website', wfrate: 'Price for the whole facility', access: 'How customers get in' };
const NEXT_SAY = {
  counter_special_set: ['Show our specials on the website', 'Make a flyer for it', 'Email it out'],
  deal_set: ['Make a flyer for it', 'Show me our deals'], package_set: ['Show our packages on the website', 'Make a flyer for it'],
  flyer_make: ['Email it out', 'Make another flyer'], special_flyer: ['Email it out', 'Make another flyer'],
  menu_items_add: ['Add more to the menu', 'Show our menu on the website', 'Make a food or drink special'],
  menu_item_change: ['Change another item', 'Make a food or drink special'],
  bays_list_set: ['Set my price', 'Link the bay computers'], bay_add: ['Set its price', 'Link its computer'],
  base_price_set: ['Add peak prices', 'Make a membership'], price_window_add: ['Show me our prices', 'Make a discount code'],
  opening_hours_set: ['Set up my bays', 'Set my price'], location_set: ['Set my opening hours', 'Add my logo'],
  website_section_add: ['Change the colours', 'Add photos', 'Is my site ready?'], website_headline_set: ['Add photos to the top', 'Change the colours'],
  website_look_set: ['Change the fonts', 'Is my site ready?'], website_colors_set: ['Change the fonts', 'Is my site ready?'],
  logo_upload: ['Change the colours', 'Is my site ready?'], site_go_live: ['Get my website address', 'Make a flyer'],
  membership_tier_create: ['Sell it on the website', 'Add a member'], member_add: ['Add another member', 'Show our members'],
  schedule_add_shift: ['Show this week\'s schedule', 'Copy this week to next week'], staff_add: ['Put them on the schedule', 'Who works here?'],
  event_add: ['Show it on the homepage', 'Email it out'], block_add: ['What is blocked off?', 'Show the bookings'],
  booking_make: ['Book another', 'Show today\'s bookings'], gift_card_issue: ['Show our gift cards', 'Sell gift cards online'],
  discount_code_create: ['Show our codes', 'Email it out'], waiver_mode_set: ['Where do I put my waiver?', 'Set my price'],
  device_pair: ['Name it', 'Put it on a bay'], bay_tv_add: ['Learn its power button', 'Test it'],
};
// OPTIONS WRITTEN AS A LIST, MADE TAPPABLE (Oct 22 2026, the customer's day one: "- **Staffed** ... - **Unstaffed** ... - **Hybrid**
// ... Pick one!" with nothing to tap): two to five list lines that each lead with a bold name, in an answer that asks the owner to
// choose, become its answers to tap - the name alone, as the owner would say it
function choicesInWords(text) {
  const t = String(text || '');
  if (!/\?|\b(?:pick|choose|which|select|tell me|let me know)\b/i.test(t)) return [];
  const opts = [...t.matchAll(/^\s*(?:[-*\u2022]|\d+[.)])\s*\*\*([^*\n]{1,40})\*\*/gm)].map(m => m[1].replace(/[:\s]+$/, '').trim()).filter(Boolean);
  return opts.length >= 2 && opts.length <= 5 && new Set(opts.map(x => x.toLowerCase())).size === opts.length ? opts : [];
}
function nextChoices(ctx) {
  if (ctx.couldNot) return ['Try again', 'What can you do?'];
  // while setup is not finished, its next steps lead (a step already done is never offered); after it, what usually follows
  const todo = (ctx.setup || []).filter(x => !x.done && x.id !== ctx.deferred);
  const setupTalk = !(ctx.wordsNamed || []).length || ctx.appliedSomething;
  if (todo.some(x => !x.optional && !x.skipped) && setupTalk) {
    const first = todo.filter(x => !x.optional).concat(todo.filter(x => x.optional)).map(x => SETUP_SAY[x.id]).filter(Boolean);
    if (first.length) return first.slice(0, 2).concat(['What else can you do?']);
  }
  if (ctx.lastApplied && NEXT_SAY[ctx.lastApplied]) return NEXT_SAY[ctx.lastApplied].slice(0, 3);
  // (and once the setup no longer leads, the questions this facility can ask that it has not asked yet - quickcards.js)
  const qc = quickNow(ctx, CARDS_SHOWN);
  return qc.length ? qc.concat([quickCards.MORE]) : [];
}
// THE QUICK CARDS (quickcards.js - maintainer, Oct 25 2026: "new facility owners might not know what they can ask ... they need to be guided
// early on"): the facility's shape, read once a turn, and its cards - none while a setup step that is not optional or put off is open
// (the setup leads then)
const askCounts = () => { try { return require('../study').askCounts(); } catch { return {}; } };
const shapeFor = (ctx) => ctx.shape || (ctx.shape = quickCards.shapeOf(cfgNow(), Object.assign({}, ctx.facilityNamesNow, { counts: askCounts() })));
const quickNow = (ctx, max) => ((ctx.setup || []).some(x => x && !x.done && !x.optional && !x.skipped) ? [] : quickCards.cards(shapeFor(ctx), ctx.cardsAsked, max));

// THE EVERYDAY QUESTIONS, LOOKED UP FIRST (maintainer, Oct 22 2026: "really hit the everyday things to be fast but as long as it knows
// everything else it looks hard for it"). For the questions an owner asks every day, the box runs the read itself before the
// model's first step and hands it the answer - one round where there were two, and nothing to forget or make up ("who is playing
// right now?" was answered from nothing by the laptop's 4B, twice). Only on the box's own model; anything else is looked for as
// before. [the owner's words, the read, its arguments]
const EVERYDAY = [
  // ("who's playing the most" is a ranking, below - not who is on a bay now: the everyday review, Oct 25 2026)
  [/\b(?:who(?:'?s| is| are) (?:playing(?! (?:the )?most\b)|on the bays?|in (?:a |the )?bays?)|anyone (?:playing|in a bay|on the bays)|playing (?:right )?now)\b/i, 'playing_now_read', () => ({})],
  [/\bwho(?:'?s| is| are) (?:on|working|scheduled|in)\b[^?]*\b(?:today|tonight)\b|\bwho(?:'?s| is) on tonight\b/i, 'schedule_read', (ctx) => ({ start: ctx.today })],
  // (never "show our menu on the website" - that is putting the menu on the site, the box's own tap after a menu change and its own
  // advice in the menu's answer: read as the menu, the owner was told to say it again, for ever - the everyday review, Oct 25 2026)
  [/\bwhat(?:'?s| is) on (?:our |the )?menu\b|\bshow (?:me )?(?:our |the )?(?:food |drinks? )?menu\b(?![^?.]{0,25}\b(?:(?:on|to|in|at) (?:the |our |my )?(?:web ?site|site|home ?page|web ?page|booking page|landing page|page)|online)\b)/i, 'menu_read', () => ({})],
  [/\b(?:what|which) tax(?:es)?(?: rates?)? do we (?:charge|collect)\b|\b(?:our|the) tax rates?\b/i, 'tax_rates_read', () => ({})],
  [/\bis (?:everything|it all|the box|the system|all) (?:working|ok(?:ay)?|running|alright|all right|good|fine)\b|\banything wrong\b/i, 'health_read', () => ({})],
  [/\bwhat(?:'?s| is) left to (?:set ?up|do)\b|\bwhere (?:do|should) (?:i|we) start\b/i, 'setup_status', () => ({})],
  [/\b(?:what|which|any) (?:food |drink )?specials? (?:do we have|are (?:running|on)|running|tonight|today)\b|\bspecials? (?:are )?(?:running|on now)\b/i, 'counter_specials_read', () => ({})],
  [/\bwho(?:'?s| is) (?:clocked in|on the clock)\b|\banyone clocked in\b/i, 'clock_read', () => ({})],
  [/\b(?:what(?:'?s| is) booked|any bookings|who(?:'?s| is) booked|who(?:'?s| is) coming in)\b[^?]*\btoday\b|\btoday'?s bookings\b/i, 'bookings_read', (ctx) => Object.assign({ date: ctx.today }, bayIn(ctx, ctx.newest) ? { bay: bayIn(ctx, ctx.newest) } : {})],
  [/\b(?:what(?:'?s| is) booked|any bookings|who(?:'?s| is) booked|who(?:'?s| is) coming in)\b[^?]*\btomorrow\b|\btomorrow'?s bookings\b/i, 'bookings_read', (ctx) => Object.assign({ date: actions.addDays(ctx.today, 1) }, bayIn(ctx, ctx.newest) ? { bay: bayIn(ctx, ctx.newest) } : {})],
  // (the website's inbox - never "did any messages fail to send": the inbox holds what came in, not what went out - the everyday review,
  // Oct 25 2026)
  // (nor "any messages that didn't go through", "... did not send", "... not delivered" - each answered "No new messages.", which can hide
  // a send that failed: the review, Oct 27 2026)
  [/\bany (?:new )?(?:messages|msgs|inquiries)\b(?![^?.!]{0,30}\b(?:fail\w*|bounc\w*|undeliver\w*|deliver\w*|sent|send|sending|(?:go|goes|gone|went|get|gets|got|come|came) (?:out|through)|did ?n'?o?t|didnt|never|wasn'?t|weren'?t|haven'?t|hasn'?t|not)\b)|\bwhat(?:'?s| is) in (?:the |our |my )?inbox\b/i, 'inbox_read', () => ({})],
  // the texts and emails (the messages set, Oct 25 2026): who is on the email list, what went out, what a message says, who said STOP
  // (the email list only when the words name it - "how many people signed up for league night", "... for memberships" or a bare "how
  // many people signed up this week" were each answered with the email list's count: the everyday review, Oct 25 2026)
  [/\bhow many (?:people |folks |customers )?(?:are |r )?on (?:the |our |my )?(?:email|e-mail|mailing|newsletter) list\b|\bhow many (?:people |folks |customers )?(?:have |are |r )?(?:signed up|subscribed)\b[^?]{0,30}\b(?:emails?|e-mails?|newsletters?|mailing list|email list|email updates)\b|\bhow many (?:email|e-mail|newsletter|mailing list) (?:sign ?ups|subscribers)\b|\b(?:email|mailing) list (?:size|count)\b/i, 'email_signups_count', () => ({})],
  [/\b(?:did|has) (?:the |our )?(?:last |latest )?newsletter (?:go|gone|went) out\b|\bwhat newsletters (?:have we|did we) sen[dt]\b|\b(?:our |the )?newsletters? (?:sent|history)\b/i, 'newsletters_read', () => ({})],
  [/\bwhat does (?:our |the |my )?(.{4,30}?) (text|txt|email|e-mail) say\b/i, 'message_words_read', (ctx) => { const m = String(ctx.newest || '').toLowerCase().match(/\bwhat does (?:our |the |my )?(.{4,30}?) (text|txt|email|e-mail) say\b/); const k = m ? intents.msgKey(m[1], m[2]) : null; return k ? { message: k } : null; }],
  [/\bwho (?:opted out|has opted out|said stop|texted stop|unsubscribed)\b[^?]{0,20}\btexts?\b|\bwho (?:opted out|texted stop|said stop)\b|\btext (?:opt[- ]?outs|stops)\b/i, 'text_stops_read', () => ({})],
  [/\b(?:are|is) (?:the )?(?:staff )?hours (?:ready|waiting) (?:to (?:send|go)|for me)\b|\bhours (?:email|export|send) (?:ready|waiting|status)\b/i, 'hours_send_read', () => ({})],
  [/\bwhat (?:texts|emails|messages)(?: and (?:texts|emails))? do we send(?: out)?\b|\bwhich (?:texts|emails|messages) (?:go out|do we send)\b/i, 'messages_settings_read', () => ({})],
  [/\bis there an update\b|\bare we up to date\b/i, 'updates_read', () => ({})],
  // the box teaches (maintainer, Oct 22 2026: "sometimes even say this is what I can do"): what deals there could be, from deal_ideas
  // (and the owner's plain words for it - "slow mondays any ideas", "tuesdays r dead": the walks on the 4B, Oct 22 2026, late night)
  // (ideas FOR something are deal ideas only when that something is a deal, a slow day or more people - "any ideas for my logo", "for
  // our website", "ideas for a name for the burger" went to the deal ideas: the everyday review, Oct 25 2026)
  [/\b(?:any |some |got |have |give me |need )?ideas\b(?!\s+(?:for|to|on|about|of|with)\b)|\b(?:any |some |got |have |give me |need )?ideas? (?:for|to|on|about) (?:(?:a|an|the|some|our|my|more|new|this|next) )?(?:bring\w*|get\w*|fill\w*|draw\w*|deals?|promos?|promotions?|specials?|packages?|offers?|discounts?|slow|dead|quiet|more|busy|business|customers?|golfers?|people|traffic|first[- ]?time|week ?days?|week ?nights?|week ?ends?|mornings?|afternoons?|evenings?|nights?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|happy hours?|how to (?:get|bring|draw|fill))\b|\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weeknights?|nights?|mornings?|afternoons?) (?:are|r|is|get|been|have been) (?:so |really |pretty )?(?:dead|slow|quiet|empty)\b|\b(?:slow|dead|quiet) (?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weeknights?|nights?|days?)\b|\b(?:what|which|any) (?:kinds? of )?(?:deals?|promotions?|packages?|specials?|offers?) (?:can|could|should) (?:i|we|you) (?:run|do|offer|make|try|have)\b|\b(?:first[- ]?time|new) (?:customers?|guests?|golfers?|visitors?|players?) (?:deal|offer|discount|special|promo)\b|\b(?:any )?ideas? (?:for|to|on) (?:bring|get|fill|deals?|promotions?|slow|more)|\bhow (?:do|can|could) (?:i|we) (?:get|bring|draw) (?:more )?(?:people|customers|golfers|business) in\b|\b(?:slow|dead|quiet) (?:days?|nights?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|weekdays?|afternoons?)\b|\bwhat (?:deals?|promotions?) can you\b/i, 'deal_ideas', () => ({})],
  // what is set up now, in the owner's words ("what deals do i got goin rn" - the 4B listed a senior discount and a birthday package
  // nobody had made: the walk in maintainer's own typing, Oct 23 2026)
  [/\b(?:what|which|any)\b[^?.]{0,20}\b(?:deals?|packages?|promos?|promotions?)\b[^?.]{0,25}\b(?:do (?:i|we|u) (?:have|got|run(?:ning)?)|(?:i|we|u) (?:have|got|running|runnin)|(?:are|r|is) (?:on|running|runnin|going|goin|live|active|set ?up)|goin|going on|running|runnin|right now|rn)\b|\b(?:show|list|tell) (?:me )?(?:my|our|the) (?:current |active )?(?:deals|packages|promos|promotions)\b(?![^?.]{0,20}\b(?:on|to|in) (?:the |our |my )?(?:web ?site|site|home ?page|page|booking page)\b)/i, 'deals_read', () => ({})],
  // (never a door's codes - "which door codes are working" was answered with the discount codes; no read lists the codes live at a
  // door, so those go to the model: the everyday review, Oct 25 2026)
  [/\b(?:what|which|any)\b(?![^?.]{0,15}\b(?:door|doors|lock|locks|access|entry|keypad|gate|pin|wi-?fi)\b)[^?.]{0,15}\b(?:discount |promo |coupon )?codes\b[^?.]{0,20}\b(?:do (?:i|we|u) (?:have|got)|(?:i|we|u) (?:have|got)|(?:are|r) (?:on|out|live|active|running|working))\b|\b(?:show|list) (?:me )?(?:my|our|the) (?:discount |promo )?codes\b/i, 'discount_codes_read', () => ({})],
  // what came in ("how much did we make this wk" - the 4B made up $2,450 and "up 12%": the walk in maintainer's typing, Oct 23 2026)
  // (the period as said - a weekday, last night, a month, a date - or the model: never this month for one the box did not read -
  // spanOf, the everyday review, Oct 25 2026)
  [/\bhow much (?:money )?(?:did|have|do) we (?:make|made|take|taken|bring in|brought in|pull in|do)\b|\bwhat did we (?:make|take|bring in|pull in)\b|\bwhat(?:'?s| is| was) (?:our |the )?(?:revenue|takings|sales)\b/i, 'revenue_read', (ctx) => spanOf(ctx)],
  // the hours as they are ("whats our hours" - the 4B made them up: the walk in maintainer's typing, Oct 23 2026)
  [/\bwhat(?:'?s| are| is| r) (?:our|the|my) (?:opening |business |open )?hours\b|\bwhen (?:are|r|do) (?:we|you) (?:open|close)\b|\bwhat time do (?:we|you) (?:open|close)\b|\bwhat days (?:are|r|do) (?:we|you) open\b/i, 'booking_rules_read', () => ({})],
  [/\bany (?:time[- ]off |shift )?requests?\b/i, 'requests_read', () => ({})],
  // (Oct 23 2026, the 4B: "how much tax did we collect this quarter?" went to the business overview; "what devices do we have?" offered
  // to set the hub up)
  [/\bhow much (?:sales )?tax\b[^?]{0,40}\b(?:collect(?:ed)?|take|took|taken|charge(?:d)?|bring in|brought in)\b|\btax (?:we )?(?:collected|taken)\b/i, 'tax_collected_read', (ctx) => spanOf(ctx)],
  [/\bwhat (?:smart[- ]?home )?devices (?:do (?:we|i|u) have|have we got|(?:are|r) there|(?:are|r) (?:set up|paired|on))\b|\b(?:list|show) (?:me )?(?:our |the |my |all )?(?:smart[- ]?home )?devices\b/i, 'smarthome_read', () => ({})],
  // (the bay's whole answer - its plugs, TV and devices with their timing as well as its routines: routines_read alone said "nothing
  // happens" on a bay whose plugs come on - the 4B, Oct 23 2026)
  [/\bwhat happens (?:on|in|at|with) [^?]{1,40} when (?:a |the |each )?(?:session|game|booking) (?:starts|ends|begins|is over)\b/i, 'bay_read', (ctx) => (bayIn(ctx, ctx.newest) ? { bay: bayIn(ctx, ctx.newest) } : {})],
  // the staffed days as they are ("which days are staffed this week?" - the 4B answered from nothing, once "Monday to Friday, 10 to 6":
  // Oct 23 2026)
  [/\b(?:which|what) days (?:are|r|is) (?:we )?staffed\b|\bwhen (?:are|r) (?:we|u|you) staffed\b|\bare (?:we|u) staffed\b|\bstaffed (?:days|hours)\b[^?]{0,20}\b(?:this|next) week\b/i, 'staffed_read', (ctx) => {
    const t = ctx.newest || ''; if (/\bnext week\b/i.test(t)) return { from: actions.addDays(ctx.today, 7), to: actions.addDays(ctx.today, 13) };
    if (/\bthis week\b/i.test(t)) return { from: ctx.today, to: actions.addDays(ctx.today, 6) };
    if (/\btomorrow\b/i.test(t)) return { from: actions.addDays(ctx.today, 1), to: actions.addDays(ctx.today, 1) };
    if (/\b(?:today|tonight)\b/i.test(t)) return { from: ctx.today, to: ctx.today };
    return {}; }],
  // THE QUICK CARDS' QUESTIONS (quickcards.js - maintainer, Oct 25 2026: "How many members do I have? Did anyone sign up this week? You know,
  // year over year, have we grown? Do we have more members? You know, what are our prices for members?"), and the ways an owner
  // types the same - each answered from the box's own records (test-assistant A63)
  // (the count of members - never what members did: "how many members played this week", "... cancelled", "... brought guests" were
  // each answered with the active-member total; who played and the guests they brought have reads of their own, below - the everyday
  // review, Oct 25 2026)
  [/\bhow many (?:active |paying |current )?members(?! (?:have |did |had |who )?(?:joined|signed|came|come|did|play(?:s|ed|ing)?|cancel(?:l?ed|s|ling)?|quit|left|brought|bring|brings|booked|book|visited|showed|used|renewed|lapsed|stopped|dropped|guests?)\b)\b|\bmember count\b|\bhow many people (?:are )?(?:members|in the club)\b/i, 'members_report_read', () => ({})],
  // (a membership's sign-ups only - the newsletter, the email list, a tournament or a league are not members: membershipOnly; and a
  // "how many signed up" that names the email list is the email list's own count, above)
  [/\b(?:did|has|have) any(?:one|body) (?:sign(?:ed)? up|join(?:ed)?)\b|\bwho (?:signed up|joined)\b|\b(?<!\badd (?:a |some )?)new members?\b|\bhow many (?:new )?(?:members )?(?:joined|signed up)\b(?![^?]{0,30}\b(?:emails?|e-mails?|newsletters?|mailing list|email list|email updates|texts?)\b)|\b(?:more|fewer|less) members than\b|\bmembers? (?:than|vs\.?|versus|compared (?:to|with)) (?:last|a) year\b|\bmember(?:ship)? growth\b|\b(?:have|did|are|r) we (?:grow|grown|growing)\b[^?]{0,30}\bmembers?\b|\bmembers?\b[^?]{0,30}\b(?:grow|grown|growing|year over year)\b/i, 'members_growth_read', (ctx) => {
    membershipOnly(ctx);
    const t = ctx.newest || '', than = thanLast(t); if (than) return { period: than };
    if (/\b(?:a year ago|since last year|year over year|grow(?:n|ing)?)\b/i.test(t)) return { period: 'this_year' };
    return spanOf(ctx, { periodOnly: true }); }],
  [/\bwhat (?:are|r|is) (?:our |the )?(?:prices?|rates?|costs?) for members\b|\bwhat do (?:our )?members pay\b|\b(?:our |the )?member(?:ship)? (?:prices|pricing|rates|costs|plans|tiers|levels|options)\b|\bhow much (?:is|does|do) (?:a |an |our |the )?memberships?(?: cost)?\b|\bwhat memberships do we (?:have|offer|sell)\b/i, 'tiers_read', () => ({})],
  // THE FACILITY, STUDIED (services/study.js - maintainer, Oct 25 2026: "busy months slow months if a special actually worked"): the months,
  // and each special's days against the days before it
  [/\b(?:busiest|slowest|busy|slow|best|worst|quiet(?:est)?)\s+(?:and\s+(?:busiest|slowest|best|worst)\s+)?months?\b|\bmonths?\b[^?]{0,20}\b(?:busiest|slowest)\b|\bmonth[- ]by[- ]month\b|\b(?:revenue|money|sales|business|bookings)\b[^?]{0,20}\bover (?:time|the (?:year|months))\b|\bgrown over (?:the )?(?:year|time|months)\b/i, 'trends_read', () => ({})],
  [/\b(?:did|does|do|is|are|has|have|was|were)\b[^?]{0,40}\b(?:specials?|deals?|promos?|promotions?)\b[^?]{0,30}\b(?:work(?:ed|ing)?|help(?:ed|ing)?|pay(?:ing)? off|paid off|bring|brought|pull(?:ed)?|make|made)\b|\bhow (?:did|is|are|was|were|has|have)\b[^?]{0,30}\bspecials?\b[^?]{0,20}\b(?:do|doing|done|going|gone|work(?:ed|ing)?)\b|\bhow (?:did|have|are) (?:we|it|they) (?:do|done|doing) with (?:the |our |that |this |those |these )?[^?]{0,30}\b(?:specials?|deals?|promos?|promotions?)\b/i, 'specials_effect_read', (ctx) => {
    const t = String(ctx.newest || '').toLowerCase(), sp = ((ctx.facilityNamesNow || {}).specials || []).find(n => n && t.includes(String(n).toLowerCase()));
    return sp ? { special: sp } : {}; }],
  // THE EVERYDAY QUESTIONS THE BOX ALONE MISSED (the scored set with no model, Oct 25 2026 - maintainer: "just standard things people ask ...
  // keep making that stronger"): each looked up by the box and answered in its own words (answers.js)
  [/\bwhat(?:'?s| is) (?:going on|happening) (?:in|on|with) (?:the |our )?bays\b|\bhow are the bays (?:doing|looking)\b|\b(?:the )?bays'? status\b/i, 'bay_read', () => ({})],
  [/\bdid anything (?:fail|not (?:turn|go)) (?:to (?:turn|go) )?(?:on|off)?\b|\banything (?:fail(?:ed)?|go wrong) (?:to turn (?:on|off) )?(?:today|tonight|with the bays)\b|\bautomation (?:problems|failures|status)\b/i, 'automation_read', () => ({})],
  // (the day as said, and the bay - "any bookings last friday" was read as the Friday to come and "what's booked friday in bay 3" as every
  // bay; today's own weekday said alone - "any bookings sunday?" on a Sunday - is handed on, and the conversation asks which one, both
  // dates to tap (sameWeekday, maintainer Oct 24); two weekdays, or a date beside one, go to the model - the everyday review, Oct 25 2026)
  [/\b(?:any bookings|what(?:'?s| is) booked|who(?:'?s| is) booked|who(?:'?s| is) coming in)\b[^?]*\b(?:on )?(?:this |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, 'bookings_read', (ctx) => {
    const t = ownNamesOut(ctx, ctx.newest), days = [...new Set((t.match(new RegExp(`\\b${WEEKDAY_RE}\\b`, 'g')) || []))];
    if (days.length !== 1 || new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2}\\b|\\b\\d{1,2}\\/\\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)\\b`).test(t)) handOn('more than one day');
    // (a week said beside it - "any bookings friday last week" was answered with the Friday to come, "friday next week" with this week's:
    // which week's Friday is the model's to read - the review, Oct 27 2026)
    if (/\bweeks?\b|\bweekend\b|\bweek after\b/.test(t)) handOn('a week said beside the weekday');
    const m = t.match(new RegExp(`\\b(?:(last|this past|past|this|next)\\s+)?${WEEKDAY_RE}\\b`)), bay = bayIn(ctx, ctx.newest);
    let date;
    if (m[1] === 'last' || m[1] === 'this past' || m[1] === 'past') { const back = (new Date(ctx.today + 'T12:00:00Z').getUTCDay() - ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(m[2]) + 7) % 7; date = actions.addDays(ctx.today, -(back || 7)); }
    else if (sameWeekday(t, ctx.today)) handOn("today's own weekday said alone");
    else date = (m[1] ? m[1] + ' ' : '') + m[2];
    return Object.assign({ date }, bay ? { bay } : {}); }],
  [/\bwhat(?:'?s| is| have we got| do we have)(?: got)? blocked(?: off)?\b|\bany(?:thing)? blocked(?: off)?\b|\bblocked(?: off)? (?:times|dates|days)\b/i, 'blocks_read', () => ({})],
  [/\bwho works here\b|\bwho(?:'?s| is) on (?:the |our )?staff\b|\b(?:list|show) (?:me )?(?:the |our )?staff\b|\bstaff list\b|\bwho(?:'?s| is) on the roster\b/i, 'roster_read', () => ({})],
  [/\bwho(?:'?s| is) (?:working|on|scheduled)\b[^?]*\bthis weekend\b|\bwho(?:'?s| is) (?:working|on|scheduled)\b[^?]*\b(?:on )?(?:sat(?:urday)?|sun(?:day)?) and (?:sat(?:urday)?|sun(?:day)?)\b/i, 'schedule_read', (ctx) => { const d = new Date(ctx.today + 'T12:00:00Z').getUTCDay(), sat = actions.addDays(ctx.today, d === 0 ? -1 : 6 - d); return { start: d === 0 ? ctx.today : sat, end: actions.addDays(sat, 1) }; }],
  [/\bhow (?:many hours|much(?: time)?) (?:has|did) (.{2,40}?) (?:used|played|play|use)\b/i, 'member_usage_read', (ctx) => ({ member: ((ctx.newest || '').match(/\bhow (?:many hours|much(?: time)?) (?:has|did) (.{2,40}?) (?:used|played|play|use)\b/i) || [])[1] })],
  [/\b(?:list|show(?: me)?|who are) (?:the |all |all the )?members (?:on|in) (?:the )?(.{2,40}?) (?:plan|tier|membership)\b|\b(?:list|show me) (?:the |all )?(?:our )?members\b(?! (?:on|in))/i, 'members_read', (ctx) => { const m = (ctx.newest || '').match(/\bmembers (?:on|in) (?:the )?(.{2,40}?) (?:plan|tier|membership)\b/i); return m ? { tier: m[1] } : {}; }],
  [/\bend of (?:the )?day\b|\bthe day'?s close(?: ?out)?\b|\bclose ?out (?:for )?today\b/i, 'end_of_day_read', () => ({})],
  [/\bis stripe (?:connected|set ?up|working|hooked up)\b|\b(?:are|is) (?:my |our |the )?(?:card )?(?:payments|email|emails|texting|texts) (?:connected|set ?up|working)\b|\bwhat(?:'?s| is) connected\b|\b(?:our |my )?connections\b/i, 'connections_read', () => ({})],
  [/\bwhat gift cards (?:are out(?: there)?|do we have|have we sold)\b|\bgift cards? (?:out there|outstanding|still out)\b|\bhow much is (?:left |still )?on (?:the |our )?gift cards\b/i, 'gift_cards_read', () => ({})],
  [/\bhow many bookings (?:do we have |are there |have we got |we got )?(today|tonight|tomorrow)\b|\bwhat(?:'?s| is) (today|tonight|tomorrow) look(?:ing)? like\b|\bhow(?:'?s| is) (today|tonight|tomorrow) look(?:ing)?\b/i, 'day_outlook_read', (ctx) => { const w = ((ctx.newest || '').toLowerCase().match(/\b(today|tonight|tomorrow)\b/) || [])[1] || 'today'; return w === 'tonight' ? { date: ctx.today, from_time: '17:00' } : { date: w === 'tomorrow' ? actions.addDays(ctx.today, 1) : ctx.today }; }],
  [/\bwhat(?:'?s| is) on (?:our |the |my )?website\b|\bwhat does (?:our |the |my )?website (?:say|show|look like)\b/i, 'website_read', () => ({})],
  [/\bwhat events (?:do we have|are (?:coming up|on|there))\b|\bupcoming events\b|\bany events (?:coming up|on)\b|\bevents coming up\b/i, 'events_read', () => ({})],
  [/\bwhat photos (?:do we have|are there)\b|\b(?:show|what(?:'?s| is) in) (?:me )?(?:the |our )?(?:gallery|slides|slideshow)\b/i, 'website_slides_read', () => ({})],
  [/\bhow do (?:the )?door codes work\b|\bdoor code (?:timing|settings)\b|\bwhen do (?:the )?door codes (?:start|work|go out|get sent)\b/i, 'doors_read', () => ({})],
  [/\bwhat routines (?:do we have|are there|are set ?up)\b|\b(?:list|show) (?:me )?(?:the |our )?routines\b/i, 'routines_read', () => ({})],
  [/\bis (?:my|our|the) (?:web)?site (?:up|live|online|working)(?: yet)?\b|\bis the box (?:online|connected)\b/i, 'online_read', () => ({})],
  // THE OWNER'S QUESTIONS ABOUT THEIR PEOPLE AND MONEY (maintainer, Oct 25 2026 - services/insights.js): a group's spend, members' guests, the
  // members who play most, the customers coming back and what they spend
  // (each for the period as said - today, a month, the last 30 days, a year - or the model; never this month for one the box did not
  // read: spanOf, the everyday review, Oct 25 2026)
  [/\b(?:how much|what) do(?:es)? (?:each |a |the |our |an )?(?:average )?(?:group|party|groups|parties|people|customers?|players?|guests?)\b[^?]{0,15}\bspend\b|\bspend(?:ing)? (?:on|at) (?:food|drinks?|beers?|the counter|the bar)\b|\baverage (?:food|drink|bar|counter|beer) (?:spend|tab|bill|sales?)\b|\b(?:bar|counter|food|drink) (?:tab|spend) (?:per|a|each) (?:group|party|booking)\b/i, 'counter_spend_read', (ctx) => spanOf(ctx)],
  // ("how many members brought guests" - the guests members bring, from the visits recorded with guests on a membership that allows them)
  [/\bhow many (?:people|guests|friends) do (?:our )?members bring\b|\bmembers?'? guests\b|\bguests? (?:did|do|have) (?:the )?members (?:bring|brought)\b|\bwho brings? (?:the most )?guests\b|\bguests? (?:members|they) (?:bring|brought)\b|\bhow many (?:of (?:our|the) )?members (?:have |did |had )?(?:brought|bring|brings|had|have) (?:any |in )?(?:guests?|friends)\b/i, 'member_guests_read', (ctx) => spanOf(ctx)],
  // ("how many members played" is this read's own "X of Y active members played"; "who plays the most" without the word members is the
  // members only at a club only members can book - anywhere else it could be every customer, and the model is asked: membersMeant)
  [/\b(?:our )?(?:top|best|most active) members\b|\bmembers? (?:who )?play(?:s|ed)? the most\b|\bwho(?: plays?|(?:'?s| is) playing) the most\b|\bhow (?:often|many times) do (?:our )?(?:top |best )?members play\b|\bhow many (?:of (?:our|the) )?(?:active )?members (?:have |did )?play(?:ed)?\b/i, 'top_members_read', (ctx) => { if (!membersMeant(ctx)) handOn('members or every customer'); return spanOf(ctx); }],
  [/\breturning customers\b|\bcustomers? (?:are |r )?coming back\b|\b(?:our )?regulars\b|\brepeat customers\b|\baverage spend\b(?![^?]*\b(?:food|drink|beer|bar|counter)\b)|\b(?:avg|average) (?:ticket|check|booking value|customer spend)\b|\bhow much does (?:a|each|the average) customer spend\b|\b(?:top|best) customers\b/i, 'customers_read', (ctx) => spanOf(ctx)],
  // what a time costs and which bays are free ("how much is an hour saturday at 7?", "any bays free tomorrow at 6?") - today's own
  // weekday said alone is left to the conversation, which asks which one
  [/^(?=.*\b(?:how much|cost|price|free|open|available)\b)(?=.*\b(?:today|tonight|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b)(?=.*\bat (?:\d{1,2}(?::\d\d)?\s*(?:am|pm)?|noon)\b)(?!.*\b(?:book (?:it|them|him|her|me|us)|make (?:a|the) booking|reserve|did we|do we make|we make|revenue|members?\b|are we open|what time)\b)/i, 'booking_quote', (ctx) => {
    const t = String(ctx.newest || '').toLowerCase();
    const date = intents.dayOf((t.match(/\b(today|tonight|tomorrow|(?:this |next )?(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/) || [])[1]), time = intents.timeOf((t.match(/\bat (\d{1,2}(?::\d\d)?\s*(?:am|pm)?|noon)\b/) || [])[1]);
    if (!date || !time || sameWeekday(ctx.newest, ctx.today)) return null;   // (today's own weekday alone: the model asks which)
    const words = { one: 1, an: 1, a: 1, two: 2, three: 3, four: 4 }, h = t.match(/\b(\d+(?:\.5)?|one|two|three|four|an|a) (?:hours?|hrs?)\b/), m = t.match(/\b(\d{2,3}) (?:minutes|mins?)\b/);
    const minutes = /\bhour and a half\b/.test(t) ? 90 : /\bhalf (?:an )?hour\b/.test(t) ? 30 : m ? Number(m[1]) : h ? Math.round((words[h[1]] || Number(h[1])) * 60) : 60;
    return Object.assign({ date, time, minutes }, bayIn(ctx, ctx.newest) ? { bay: bayIn(ctx, ctx.newest) } : {}); }],
  // (a check asked for - "check yourgolf.com", "is yourgolf.com on Cloudflare?" - never the owner telling the box their domain: "our
  // domain rapidgolf.com is all paid up" is the website address, put in - test-assistant A40j)
  [/^(?=.*\b[a-z0-9-]+\.(?:com|net|org|golf|biz|us|co|io|club|info|app|ca)\b)(?=.*(?:\b(?:check|look up|look at)\b|\bis\b[^?]{0,60}\b(?:on cloudflare|registered|set up(?: right)?|ready|working|live|pointed|pointing)\b|\bwhat name ?servers\b|\bwhere is\b[^?]{0,40}\bregistered\b))/i, 'domain_check', (ctx) => ({ domain: (String(ctx.newest || '').toLowerCase().match(/\b((?:[a-z0-9-]+\.)+(?:com|net|org|golf|biz|us|co|io|club|info|app|ca))\b/) || [])[1] })],
  [/\bscan (?:the |our |my )?network\b|\b(?:find|look for) (?:the |our |my )?(?:pcs|computers|sim pcs|smart plugs|shelly plugs|shellys|plugs)\b|\bwhat(?:'?s| is) on (?:the |our |my )?network\b/i, 'network_scan', () => ({})],
  [/\b(?:find|look for) (?:the |our |my )?(?:tv remotes?|broadlinks?|ir (?:blasters?|remotes?))\b|\bany broadlinks?\b/i, 'tv_remote_find', () => ({})],
  // what sold best at the counter ("what sold best this week?" - the counter's card, quickcards.js)
  [/\b(?:what|which)\b[^?]{0,20}\b(?:sold|sells|selling) (?:the )?(?:best|most)\b|\b(?:best|top)[- ]?sell(?:ers?|ing)\b/i, 'insights_read', (ctx) => spanOr(ctx, { period: 'this_week' })],
  // ("are we up" / "down" only beside what it is up against or a period - "are we up to date" is the updates' own words and "are we up and
  // running" the box's health; "how did we do" with, at or for a thing - a special, the counter, drinks - is not the business overview: a
  // special by its name is studied (the special-by-name look-up in run(), and specials_effect_read below); the period as said or the
  // model: spanOf - the everyday review, Oct 25 2026)
  [/\b(?:are|r|were|have|did) we (?:been )?(?:busier|slower|quieter|doing (?:better|worse)|grow(?:n|ing)?|(?:up|down)(?=[^?]{0,30}\b(?:from|on|than|over|against|vs|versus|compared|this|last|so far|year|month|week|quarter|percent)\b|\s*%))\b(?![^?]*\bmembers?\b)|\bhow(?:'?s| is) business\b|\bhow are we doing\b|\bhow did we do\b(?!\s+(?:with|at|for|on)\s+(?!(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|(?:this|last|the) (?:week|month|year|quarter)\b))/i, 'insights_read', (ctx) => {
    const t = ctx.newest || '', than = thanLast(t); if (than) return { period: than };
    // ("are we up from last week?", "this month vs last month": the period running now against the one before - the read's own
    // comparison; another period said beside it is not plain, and the model is asked)
    const vs = /\b(?:from|on|over|against|vs\.?|versus|compared (?:to|with)) last (week|month|quarter|year)\b/i.exec(t);
    if (vs) { const p = 'this_' + vs[1].toLowerCase(), rest = spanOf(Object.assign({}, ctx, { newest: t.replace(vs[0], ' ') }), { compares: true }); return (!rest.period && !rest.from) || rest.period === p ? { period: p } : handOn('a period beside the comparison'); }
    return spanOf(ctx, { compares: true }); }],
];
// "than last month", "month over month": the period running now, put against the one before ("are we busier than last month?" is this
// month so far against the same days last month - never last month itself)
const thanLast = (w) => { const m = /\bthan (?:last|a|the last) (week|month|quarter|year)\b/i.exec(w || '') || /\b(week|month|quarter|year) over (?:week|month|quarter|year)\b/i.exec(w || ''); return m ? 'this_' + m[1].toLowerCase() : null; };
// a period said outright, in the order a longer phrase wins ("last 7 days" before "last week")
const PERIODS = [[/\blast (?:7|seven) days\b/i, 'last_7_days'], [/\blast quarter\b/i, 'last_quarter'], [/\bthis quarter\b/i, 'this_quarter'], [/\blast month\b/i, 'last_month'],
  [/\bthis month\b/i, 'this_month'], [/\blast week\b/i, 'last_week'], [/\bthis week\b/i, 'this_week'], [/\blast year\b/i, 'last_year'], [/\bthis year\b/i, 'this_year'],
  [/\byesterday\b/i, 'yesterday']];
// a bay the owner named, for an everyday read that takes one
// (two bays named - "whats booked friday for bay 1 and bay 2" - is not one bay's read: the first alone was answered, the second dropped -
// handed on, the model reads both: the review, Oct 27 2026)
const bayIn = (ctx, text) => { const t = String(text || '').toLowerCase(); const bs = (ctx.bays || []).filter(x => x && x.name && new RegExp('\\b' + String(x.name).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t)); if (bs.length > 1) handOn('more than one bay'); return bs.length ? bs[0].name : undefined; };
// HANDED ON TO THE MODEL (Oct 25 2026, the everyday review): words an entry above reads only in part are never answered for a period,
// a day or a thing the owner did not name - the look-up is not made and the model looks for itself (the catch in run(): a plain Error,
// never one worded for the owner). (A read that needs a detail hands on by returning null - actions.check refuses the missing detail;
// a read that needs none would take null as its own default, this month or today, which is the answer to a different question.)
const handOn = (why) => { const e = new Error('everyday: ' + why); e.handedOn = true; throw e; };
// the owner's words with the facility's own names taken out, so "Taco Tuesday", a tier called "Weekend Warrior" or a bay is never read
// as a day or a period - and the names taken out that hold a time word ("how much did we make on taco tuesday" asks about the special's
// days, not last Tuesday: a question narrower than these reads answer, so the period reader hands it on - TIME_IN_NAME, below)
const ownNamesOut = (ctx, text, found) => {
  let t = ' ' + String(text || '').toLowerCase() + ' ';
  const N = ctx.facilityNamesNow || {}, all = [].concat(N.specials || [], N.tiers || [], N.menu || [], (ctx.bays || []).map(b => b && b.name));
  // (each as a whole name of two words or more - a drink called "Day" never takes the "day" out of "today", and one called "Week" never
  // the week out of "this week": a one-word name that is a time word cannot be told from the time)
  for (const n of all.filter(x => x && /\S\s+\S/.test(String(x).trim())).map(x => String(x).toLowerCase().trim()).sort((a, b) => b.length - a.length)) {
    const re = new RegExp('(?<![a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'g');
    const before = t; t = t.replace(re, ' '); if (found && t !== before) found.push(n);
  }
  return t;
};
// A PERIOD AS THE OWNER SAID IT, for a read that looks back (Oct 25 2026, the everyday review: "how much did we make saturday", "last
// night", "in september" and "on oct 10" were each answered for this month so far, and "who are our top members today" for the month).
// Read: a period said outright (PERIODS), today or tonight, last night (yesterday), "month to date", a weekday (the latest one - the
// money reads' pastDate: "last friday" on a Friday is a week ago; today's own weekday said alone is not plain, and is handed on: the
// conversation asks which), a month by name (the latest one begun - this month so far when it is this month; "this"/"last" before
// another month is not plain), a year, "the last 30 days", a month and day or 10/10 (the latest one). Nothing said: {} - the read's
// own default. Two periods, or one this does not read (a weekend, a quarter by number, a holiday, "since june", "two weeks ago", the
// 10th, a time of day, tomorrow): handed on, never answered as this month. periodOnly: for a read that takes a period and no dates
// (members_growth_read) - a span no period names is handed on
const WEEKDAY_RE = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIx = (m) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(String(m).slice(0, 3));
const TIME_IN_NAME = new RegExp(`\\b(?:sun|mon|tues|wednes|thurs|fri|satur)days?\\b|\\b(?:today|tonight|yesterday|week ?ends?|weeks?|months?|years?|days?|nights?|mornings?|afternoons?|evenings?|${MONTH_RE.slice(1, -1)})\\b`);
const pad2 = (n) => String(n).padStart(2, '0');
const monthEndOf = (y, m) => `${y}-${pad2(m + 1)}-${pad2(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`;
const UNREAD_TIME = /\b(?:week ?ends?|q[1-4]|quarters?|since|between|until|till|thru|through|ago|before|after|prior|previous|past|recent(?:ly)?|lately|tomorrow|tmrw|days?|weeks?|months?|years?|nights?|mornings?|afternoons?|evenings?|lunch|dinner|happy hours?|seasons?|summer|winter|spring|holidays?|christmas|xmas|thanksgiving|halloween|easter|new years?'?s?|labor day|memorial day|(?:4th|fourth) of july|mon|tues?|wed|thu|thurs?|fri|sat|sun|(?:sun|mon|tues|wednes|thurs|fri|satur)days|week ?(?:days?|nights?)|mtd|ytd|\d{1,2}(?:st|nd|rd|th)|20\d\d)\b|\b(?:this|last|in the) fall\b|\bthe \d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b(?:last|past|this|the) hours?\b/;
function spanOf(ctx, opt) {
  const today = ctx.today, o = opt || {};
  const names = []; let t = ownNamesOut(ctx, ctx.newest, names);
  // (and a name holding any time word the reader would hand on by itself - "Happy Hour", "Lunch Special", "Weekday Special", "Winter
  // League": taken out of the words, the month was answered; the same words with no such name were handed on - the review, Oct 27 2026)
  if (names.some(n => TIME_IN_NAME.test(n) || UNREAD_TIME.test(n))) handOn('a name of the facility\'s with a time in it');
  // (a bay named - "how much did we make on bay 1 last week": every read here is the whole facility's, a narrower question than it answers)
  if (names.some(n => (ctx.bays || []).some(b => b && b.name && String(b.name).toLowerCase().trim() === n))) handOn('a bay named, and this read is the whole facility\'s');
  // (a comparison the read makes by itself - insights_read puts a period against the one before it - is not a second period)
  if (o.compares) t = t.replace(/\b(?:compared (?:to|with)|against|vs\.?|versus|than|over|from|on)\s+(?:the\s+)?(?:same\s+(?:days?|time)\s+)?(?:the\s+)?(?:week|month|quarter|year|day|days)\s+before\b/g, ' ');
  const said = []; const take = (re, f) => { t = t.replace(re, (...m) => { said.push(f(m)); return ' '; }); };
  const cur = new Date(today + 'T12:00:00Z'), y = cur.getUTCFullYear(), mo = cur.getUTCMonth(), dow = cur.getUTCDay();
  const day = (iso) => ({ from: iso, to: iso });
  // (a day that is on the calendar - "feb 30" is not read as Mar 2)
  const real = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === iso; };
  // (a month and day still ahead this year, said with no year - "on oct 27" on Oct 26, "on oct 31" - is not plain: it was read as last
  // year's, and the answer's day words carry no year, so the owner could not see the guess - the review, Oct 27 2026)
  const latestPast = (m, d, yr) => { if (d < 1 || d > 31 || m < 0) return null; const iso = `${yr || y}-${pad2(m + 1)}-${pad2(d)}`; return iso > today || !real(iso) ? null : iso; };
  // a date written out ("2025-10-10" - its year was read alone, as all of 2025: the review, Oct 27 2026)
  take(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/g, (m) => { const d = latestPast(Number(m[2]) - 1, Number(m[3]), Number(m[1])); return d ? day(d) : null; });
  take(/\b(?:the )?(?:last|past) (\d{1,3}|seven|thirty) days\b/g, (m) => { const n = { seven: 7, thirty: 30 }[m[1]] || Number(m[1]); return n === 7 ? { period: 'last_7_days' } : n >= 1 && n <= 400 ? { from: actions.addDays(today, -(n - 1)), to: today } : null; });
  take(/\bmonth to date\b|\bmtd\b/g, () => ({ period: 'this_month' })); take(/\byear to date\b|\bytd\b/g, () => ({ period: 'this_year' })); take(/\bweek to date\b/g, () => ({ period: 'this_week' }));
  for (const [re, p] of PERIODS) take(new RegExp(re.source, 'gi'), () => ({ period: p }));
  take(/\blast night\b/g, () => ({ period: 'yesterday' }));
  take(/\b(?:so far )?(?:today|tonight|this evening)(?: so far)?\b/g, () => ({ period: 'today' }));
  // a month and day ("oct 10", "october 10th, 2025", "10 october"), then 10/10
  take(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, 'g'), (m) => { const d = latestPast(monthIx(m[1]), Number(m[2]), m[3] && Number(m[3])); return d ? day(d) : null; });
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(20\\d\\d))?`, 'g'), (m) => { const d = latestPast(monthIx(m[2]), Number(m[1]), m[3] && Number(m[3])); return d ? day(d) : null; });
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|20\d\d))?\b/g, (m) => { const yr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null; const d = Number(m[1]) <= 12 ? latestPast(Number(m[1]) - 1, Number(m[2]), yr) : null; return d ? day(d) : null; });
  // a weekday, the latest one (and "friday night" is that day, as "last night" is yesterday; a morning or an afternoon is not read)
  take(new RegExp(`\\b(?:(last|this past|past|this|next|on)\\s+)?${WEEKDAY_RE}(?:\\s+(night))?\\b(?!s)`, 'g'), (m) => {
    const w = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(m[2]), back = (dow - w + 7) % 7, how = m[1] || '';
    if (how === 'next') return null;                                  // a day to come: nothing taken yet
    if (how === 'this') return back === 0 ? { period: 'today' } : null; // "this friday" on a Sunday: the one gone or the one coming - not plain
    if (/past|last/.test(how)) return day(actions.addDays(today, -(back || 7)));
    return back === 0 ? { which: true } : day(actions.addDays(today, -back));   // today's own weekday alone: which one
  });
  // a month by name ("in september", "for may" - "may" and "march" only after a word that makes them a month), then a year
  take(new RegExp(`\\b(?:(this|last)\\s+)?(?:(?:in|for|during|of|from|through|thru|all of|the month of)\\s+)?${MONTH_RE}\\b(?:\\s+(20\\d\\d))?`, 'g'), (m) => {
    // (a bare "may" or "march" - no "in", "for" ... before it - is the month when a year follows it, the word when "may I", "may we"
    // follow; anything else is not plain and is handed on - it was taken out of the words and THIS month was answered, the tax with it:
    // "how much tax did we collect march", "what was our revenue march 2025" - the review, Oct 27 2026)
    const word = m[2]; if ((word === 'may' || word.startsWith('mar')) && !/\b(?:in|for|during|of|from|through|thru|this|last)\s+(?:the month of\s+)?(?:may|mar)/.test(m[0]) && !m[3]) {
      const after = String(m[m.length - 1]).slice(m[m.length - 2] + m[0].length);
      return word === 'may' && /^\s+(?:i|we|you|u|they|he|she|it|be|have|need|want)\b/.test(after) ? { notMonth: true } : null; }
    const mi = monthIx(word), yr = m[3] ? Number(m[3]) : (mi <= mo ? y : y - 1);
    if (m[1] && !(m[1] === 'this' && mi === mo && !m[3])) return null;   // "last september", "this june": which one is not plain
    if (yr > y || (yr === y && mi > mo)) return null;
    if (yr === y && mi === mo) return { period: 'this_month' };
    return { from: `${yr}-${pad2(mi + 1)}-01`, to: monthEndOf(yr, mi) };
  });
  take(/\b(?:(?:in|for|during|of|all of)\s+)?(20\d\d)\b/g, (m) => { const yr = Number(m[1]); return yr === y ? { period: 'this_year' } : yr === y - 1 ? { period: 'last_year' } : yr < y && yr >= 2000 ? { from: `${yr}-01-01`, to: `${yr}-12-31` } : null; });
  const named = said.filter(x => !(x && x.notMonth));
  if (named.some(x => !x)) handOn('a period it does not read');
  const seen = [...new Set(named.map(x => JSON.stringify(x)))].map(x => JSON.parse(x));
  if (seen.length > 1) handOn('more than one period');
  if (UNREAD_TIME.test(t)) handOn('a time it does not read');
  // (a number left beside it - "oct 1-10", "oct 1 to 10", "from oct 1 to 10", "oct 1 and 2" were each answered for Oct 1 alone, "the
  // 1-10" for this month - or a period half said: "this month and last", "the last" - is a span or a second period this does not read:
  // the review, Oct 27 2026)
  if (/\d/.test(t) || /\b(?:last|next)\b/.test(t)) handOn('a span or a second period it does not read');
  const s = seen[0];
  if (!s) return {};
  if (s.which) handOn("today's own weekday said alone");
  if (!o.periodOnly || s.period) return s;
  // (a read that takes a period only: the span as the period that names it)
  const first = `${y}-${pad2(mo + 1)}-01`, lastM = mo === 0 ? [y - 1, 11] : [y, mo - 1];
  const as = { today: [today, today], yesterday: [actions.addDays(today, -1), actions.addDays(today, -1)], last_7_days: [actions.addDays(today, -6), today],
    this_month: [first, today], last_month: [`${lastM[0]}-${pad2(lastM[1] + 1)}-01`, monthEndOf(lastM[0], lastM[1])], this_year: [`${y}-01-01`, today], last_year: [`${y - 1}-01-01`, `${y - 1}-12-31`] };
  const p = Object.keys(as).find(k => as[k][0] === s.from && as[k][1] === s.to);
  return p ? { period: p } : handOn('a span this read takes no dates for');
}
// a read that has a "most recent first" default of its own (the counter's best sellers: this week) - said periods as above
const spanOr = (ctx, dflt, opt) => { const s = spanOf(ctx, opt); return Object.keys(s).length ? s : dflt; };
// THE PEOPLE A QUESTION ABOUT "WHO PLAYS THE MOST" MEANS (Oct 25 2026, the everyday review): with the word "members" it is the members;
// without it, a club only members can book means its members - anywhere else it is the members or every customer, and the model is asked
const membersMeant = (ctx) => /\bmembers?\b|\bmembership/.test(String(ctx.newest || '').toLowerCase()) || !!(shapeFor(ctx) || {}).membersOnly;
// WHAT A SIGN-UP WAS FOR (Oct 25 2026, the everyday review: "who signed up for the newsletter", "has anyone signed up for the tournament"
// and "did anybody join the league" were each answered with the members who joined): the members' read answers only for a membership -
// one of the facility's tiers, "a membership", "the club" - or for nothing named; anything else (the email list, an event, a league -
// nothing records those sign-ups as members) is handed on
function membershipOnly(ctx) {
  const t = String(ctx.newest || '').toLowerCase();
  const obj = (t.match(/\b(?:sign(?:ed|ing)?[- ]?up|join(?:ed|ing)?|register(?:ed)?|enroll(?:ed)?)\s+(?:for|to|with|on)\s+(?:the |our |a |an |my )?([a-z0-9][^?.!,]{0,40})/) || [])[1]
    || (t.match(/\bjoin(?:ed|ing)?\s+(?:the |our |a |an |my )([a-z0-9][^?.!,]{0,40})/) || [])[1];
  if (obj) {
    const tiers = ((ctx.facilityNamesNow || {}).tiers || []).filter(Boolean).map(n => String(n).toLowerCase().replace(/^the\s+/, '').trim());
    const ours = /^(?:members?(?:hips?)?|club|tiers?|plans?|levels?)\b/.test(obj) || /^[a-z0-9]+(?: [a-z0-9]+)? (?:members?(?:hips?)?|tiers?|plans?|levels?)\b/.test(obj)
      || tiers.some(n => n && (obj.startsWith(n) || obj.startsWith(n.split(/\s+/)[0] + ' ')));
    if (!ours) handOn('a sign-up for something that is not a membership');
  }
  // ("how many signed up this month" with no word of members could be the members or the email list: the model, as before - maintainer's own
  // "did anyone sign up this week?" is the members' card and read as one)
  if (!obj && !/\bmembers?\b|\bmembership/.test(t) && /\bhow many (?:new )?(?:have )?signed up\b/.test(t)) handOn('members or the email list');
}
// (the hours and the booking rules are read from the request in hand - "noon to 10" answering the model's "what are your hours?"; and
// what the model is told when one was not said)
const HEARD_FOR = new Set(['opening_hours_set', 'booking_rules_set']);
const ASKED_SAY = { flyer_make: 'the owner did not ask for a flyer - do what they asked (a package is package_set, a booking deal is deal_set, a food or drink special is counter_special_set)',
  special_flyer: 'the owner did not ask for a flyer - do what they asked (a package is package_set, a booking deal is deal_set, a food or drink special is counter_special_set)',
  opening_hours_set: 'the owner gave no hours - look them up with booking_rules_read and say them, or ask the owner what their hours are; never put up hours they did not say',
  booking_rules_set: 'the owner said nothing about session lengths, booking ahead or the gap between bookings - do what they asked (a price is base_price_set, a different price at certain times is price_window_add)' };
// the big switches, and the words an owner says when they want one (anything else is not asked for)
const ASKED_FOR = {
  // (Oct 22 2026, late night, the walk on the 4B: "make a birthday party package 2 hours pizza and 2 beers each 25 a person" was put up as
  // a flyer for it - a flyer only when the owner's words ask for one, or for another look at one)
  flyer_make: /\b(?:flyers?|posters?|graphics?|facebook|instagram|insta|fb|social|story|stories|post it|share it|bolder|bold|lighter|simpler|cleaner|the photo|another look|remake|redo|design)\b/i,
  special_flyer: /\b(?:flyers?|posters?|graphics?|facebook|instagram|insta|fb|social|story|stories|post it|share it|bolder|bold|lighter|simpler|cleaner|the photo|another look|remake|redo|design)\b/i,
  // (Oct 22 2026, the 4B on the laptop: "book Pat Lee on the party package" was put up as removing the party package)
  package_remove: /\b(?:remove|delete|drop|stop|end|cancel|take (?:it |that |the [\w ]+ )?(?:off|down)|get rid|no longer|discontinue|scrap|pull)\b/i,
  deal_remove: /\b(?:remove|delete|drop|stop|end|cancel|take (?:it |that |the [\w ]+ )?(?:off|down)|get rid|no longer|discontinue|scrap|pull|switch (?:it |that )?off|turn (?:it |that )?off)\b/i,
  // (Oct 22 2026, maintainer's try box: the chip "Check my opening hours" was put up as "Open every day 10 AM - 10 PM", and "40 an hour, 50 an
  // hour after 5pm and weekends" as booking rules nobody said - a card of values the owner never gave is not put up)
  opening_hours_set: /\d|\b(?:noon|midnight|morning|evening|night|late|early|clos(?:e|ed|es|ing)|open (?:at|from|until|till|til|by)|mon|tues?|wed|thu(?:rs)?|fri|sat|sun|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|weekdays?|weekends?|daily|every day|all week|around the clock)\b/i,
  booking_rules_set: /\b(?:sessions?|shortest|longest|minimum|maximum|min|max|at least|at most|up to|ahead|advance|days? out|weeks? out|buffer|gap|between (?:bookings|sessions)|clean(?:ing|up)?|turnover|bay first|time first|pick (?:their|a|the) bay|choose (?:their|a|the) bay|rules?|how (?:long|far))\b/i,
  scheduling_switch: /\bschedul|time ?clock|shifts?\b/i, staffed_hours_switch: /\bstaff/i, smarthome_setup: /\b(?:hub|smart|home assistant|z-?wave|zigbee|matter|pair|devices?|set (?:it |that |this )?up)\b/i,
  backup_now: /\bback ?up|backups?\b/i, backup_copies_set: /\bback ?up|backups?|usb|stick|sd card|copies\b/i, updates_auto_check_set: /\bupdates?\b/i,
  update_install: /\bupdates?|install\b/i, update_undo: /\bupdates?|undo|roll ?back|go back\b/i, site_go_live: /\blive|public|open (?:the |my |our )?(?:site|website)|launch|publish\b/i,
  ai_service_set: /\b(?:ai|chatgpt|openai|claude|model|service|key)\b/i, automation_retry: /\b(?:retry|try (?:it |that |them )?again|again|redo|re-?run|turn (?:it|them) on now)\b/i, members_only_set: /\bmembers?\b/i, whole_facility_set: /\bwhole|facility|building|venue|every bay|all (?:the )?bays\b/i,
};
// THE BOX'S OWN 24-HOUR READING (setupanswers.js - "40 an hour, 50 after 5pm and weekends", a setup step's hours): already on the
// 24-hour clock, a weekend price "all day" from midnight (the review, Oct 25 2026). (Since Oct 27 2026 this marks where a call came from
// and nothing more: THE BARE-HOUR RULE reads the box's own readings as it reads the model's - it acts only on a time the owner typed bare,
// so "all day" from midnight, which they never typed, is left as it is; "$15 an hour before 11 on weekdays" read as until 11 PM is not)
const ownClockOf = (ctx, toolCalls) => { for (const c of toolCalls || []) (ctx.ownClock = ctx.ownClock || new Set()).add(c.id); };
// THE HALF OF THE DAY OF EVERY CLOCK TIME A CHANGE CARRIES - THE BARE-HOUR RULE (helpers.js clockOf; Oct 27 2026). Until today this
// was three readers of the engine's own (twoWays, eveningIfClosed through eveningSaidNot, and TW_NEG's two-word "not"), each with
// its own word list, and each review of them found the next wrong change in the same class: "block bay 3 not bay 1 tonight 8 to 1"
// applied 8 AM to 1 PM ("not bay 1 tonight" read as "not tonight"), "we have a party tonight so block the vault from 8 to 1" applied for
// the morning at a 7 AM place (the evening word in the next clause no longer counted), and after the owner said "pm" twice the
// model's own morning reading went up unguarded. They are gone: every change that carries a clock time (actions.js CLOCKS) has each of
// its times read by the one rule, against the owner's words for the request in hand, with the facility's hours - said, or certain by
// rule 1 or 2: put right (the half moved when the call read the other); otherwise the owner is asked, both to tap. Never kept, never
// moved, in silence. The model is never told "the owner said the evening" - it never hears of the hours at all unless a reading
// cannot be held (a price window past midnight), and then with the owner's own words.
// WHAT EACH CHANGE CAN HOLD PAST MIDNIGHT (the review, Oct 27 2026: the box offered "5 PM to 1 AM" for a shift, the schedule refuses every
// shift past midnight, and the owner's tap went to the model as a refusal - a question whose second answer the box could not carry out).
// A block and a counter special run on into the next day (a time-clock fix too). A shift that ends at midnight ends at 11:59 PM, the
// schedule's own midnight (routes/staff.js); one past it is two shifts - to 11:59 PM, then from midnight on the next day - both put up,
// and said so before. Staffed hours end at 11:59 PM the same way and never run past midnight. A price window past midnight is two
// windows on different days: the model's, with the owner (a deal's or a plan's window of start times the same). A single time
// (a booking's start) is as it is.
// { set: {start, end} } | { split: [{...}, {date, ...}] } | { cannot: why }   (pair: the change's [start field, end field])
function nightSpan(a, args, span, pair) {
  const [k0, k1] = pair || a.evening, [S, E] = span;
  if (!k1 || E === undefined || E === null) return { set: { [k0]: S } };
  const night = (a.clocks && a.clocks.night) || 'runs', atMidnight = E === '00:00', past = E < S && !atMidnight;
  if (night === 'runs') return { set: { [k0]: S, [k1]: E } };
  if (night === 'shift' || night === 'day') {
    if (atMidnight) return { set: { [k0]: S, [k1]: '23:59' } };
    if (!past) return { set: { [k0]: S, [k1]: E } };
    if (night === 'shift' && a.name === 'schedule_add_shift' && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ''))) return { split: [{ [k0]: S, [k1]: '23:59' }, { date: actions.addDays(args.date, 1), [k0]: '00:00', [k1]: E }] };
    return { cannot: night === 'shift' ? 'a shift past midnight is two shifts, one each side of midnight' : 'staffed hours end by midnight - past it is the next day\'s own hours' };
  }
  if (!past) return { set: { [k0]: S, [k1]: E } };
  return { cannot: a.name === 'deal_set' || a.name === 'package_set' || /^membership_tier/.test(a.name) ? 'a window of start times past midnight is two windows, one until midnight and one from midnight on the next days' : 'a price window past midnight is two windows, one until midnight and one from midnight on the next days' };
}
// AN EVENT'S OWN WORDS AT THE OWNER'S OTHER TIME (Oct 28 2026, round 2f - the critic of round 2e): event_add and event_edit carry their time
// in their words, so a time typed to their own "Which time for X - 8 AM, or 8 PM?" that is neither choice ("7pm", "make it 7pm", "8:30pm", "its 7
// at night") had nothing to be put on and was asked again for ever. The first choice's words, with its time - and its end, for a range - put at
// the owner's: { description | words } or null (not an event's question, or words that do not carry the offered time)
function eventRetimed(w, range) {
  if (!w || !/^event_(?:add|edit)$/.test(String(w.name || '')) || !Array.isArray(w.values) || !w.values[0] || typeof w.values[0] !== 'object' || !Array.isArray(w.spans) || !w.spans[0]) return null;
  const key = Object.keys(w.values[0]).find(k => k === 'description' || k === 'words'); if (!key || typeof w.values[0][key] !== 'string') return null;
  const say = (t) => (t === '00:00' ? 'midnight (12:00 AM)' : t === '12:00' ? 'noon (12:00 PM)' : actions.HELPERS.timeWords(t));
  const [s0, e0] = w.spans[0], single = s0 === e0;
  if (single !== (range[0] === range[1])) return null;
  let text = w.values[0][key]; const a = say(s0), i = text.indexOf(a); if (i < 0) return null;
  text = text.slice(0, i) + say(range[0]) + text.slice(i + a.length);
  if (!single) { const b = say(e0), j = text.indexOf(b, i + say(range[0]).length); if (j < 0) return null; text = text.slice(0, j) + say(range[1]) + text.slice(j + b.length); }
  return { [key]: text };
}
// THE END SAID BESIDE THE HALF (Oct 28 2026, round 2g): "pm, until 11pm", "at night, done by 11", "8pm to 11pm" answering an event's "8 in the
// morning, or 8 at night?" - the start is the choice the half names (ampmIn), and the end goes on the event's words with it, never as its start:
// the one time said as an end that closes the start within twelve hours ('HH:MM'), or null
function endBeside(words, startHm) {
  const s0 = actions.HELPERS.clockMin(startHm); if (s0 === null) return null;
  const t = String(words || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\b([ap])\.\s?m\b\.?/g, '$1m').replace(/\bnoon\b/g, '12pm').replace(/\bmidnight\b/g, '12am');
  const re = /(?:\b(?:until|untill|till|til|to|thru|through|by|finish(?:es|ing)?|ends?|ending|over|wraps? up|wrapping up|done)(?:\s+(?:at|by|around|about))?\s+|-\s*)(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?(?![\d:a-z])/g;
  const found = new Set();
  for (const m of t.matchAll(re)) {
    const hh = Number(m[1]), mm = Number(m[2] || 0); if (hh < 1 || hh > 12) continue;
    const vs = m[3] ? [((hh % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + mm] : [(hh % 12) * 60 + mm, (hh % 12) * 60 + mm + 720];
    for (const v of vs) { const d = (v - s0 + 1440) % 1440; if (d > 0 && d <= 720) found.add(v % 1440); }
  }
  if (found.size !== 1) return null;
  const v = [...found][0]; return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
}
// an event's own words with the end said beside its start: "Starts at 8:00 PM." becomes "8:00 PM - 11:00 PM." (the words, or null)
function eventEnded(text, startHm, endHm) {
  if (typeof text !== 'string' || !endHm) return null;
  const say = (t) => (t === '00:00' ? 'midnight (12:00 AM)' : t === '12:00' ? 'noon (12:00 PM)' : actions.HELPERS.timeWords(t));
  const a = say(startHm), b = say(endHm);
  if (text.includes(`Starts at ${a}`)) return text.replace(`Starts at ${a}`, `${a} - ${b}`);
  const i = text.indexOf(a); if (i < 0 || /^\s*(?:-|–|to|until|till)\s/.test(text.slice(i + a.length))) return null;
  return text.slice(0, i + a.length) + ' - ' + b + text.slice(i + a.length);
}
// a change's own name that says the other half of the day - "Weeknights" on a window the bare-hour rule read as the morning, "Morning
// rate" on one it read as the evening - is put right with it (Oct 27 2026)
function nameHalf(name, startHm) {
  if (typeof name !== 'string' || !startHm) return name;
  const s = actions.HELPERS.clockMin(startHm); if (s === null) return name;
  if (s < 720) return name.replace(/\bWeeknights\b/g, 'Weekday mornings').replace(/\bweeknights\b/g, 'weekday mornings').replace(/\b(E|e)venings\b|\b(N|n)ights\b/g, (m, a, b) => ((a || b) === (a || b).toUpperCase() ? 'Mornings' : 'mornings')).replace(/\b(E|e)vening\b|\b(N|n)ight\b/g, (m, a, b) => ((a || b) === (a || b).toUpperCase() ? 'Morning' : 'morning'));
  if (s >= 960) return name.replace(/\b(M|m)ornings\b/g, (m, c) => (c === 'M' ? 'Evenings' : 'evenings')).replace(/\b(M|m)orning\b/g, (m, c) => (c === 'M' ? 'Evening' : 'evening'));
  return name;
}
const withName = (a, args, set, k0) => { const out = Object.assign({}, set); for (const f of ['name', 'label']) if (typeof args[f] === 'string' && set[k0]) { const n = nameHalf(args[f], set[k0]); if (n !== args[f]) out[f] = n; } return out; };
// the weekday key of a call's own date, for the hours that day keeps (hours.js dayHours)
const dayKeyOf = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(date + 'T12:00:00Z').getUTCDay()] : null);
// THE OWNER'S TYPED ANSWER TO "WHICH HOURS - X, OR Y?" (the review, Oct 27 2026: "1 am", "ending at 1 am" and "the one ending at 1am" put up
// 8 AM to 1 PM, and "till 1pm", "1pm" and "the 1pm one" 8 PM to 1 AM - the reading looked for "am" or "pm" anywhere in the words, and the
// end carries the other half of the day). Each time the words name - with its am or pm, noon, midnight, "1 in the morning" - is matched
// against each choice's START and END: "ending", "till", "to" before it is the end, "from", "starting" before it or the first of a range
// the start, neither either one; a part of the day ("the morning", "tonight") against when each starts; "the first", "the later one"
// against the order they were offered in. The answer is the one choice that agrees with everything said (its index). Words about the
// hours that leave both, or neither ("pm" alone - both have a PM; "8 to 1"): { again: true }, asked again - never picked, never the
// opposite of what was said. Any other words ("block bay 2 at 8pm", "never mind"): null, a new request.
// OTHER HOURS THAN THE TWO OFFERED ARE THE OWNER'S CORRECTION (the review of round 2b, Oct 27 2026: "actually 9 to 2", "9pm to 2am", "from
// 9pm to 2am please", "make it 8pm to midnight" and, to "Put both up?", "no just till midnight" were each asked again, for ever - the
// re-ask invited a start and an end and refused every one that was not offered). A start and an end that read ONE way - "9pm to 2am",
// "8pm to midnight", "9pm to 2" (2 AM: the only end within twelve hours), or to the one choice offered a new end ("no just till
// midnight") - are the hours: { range: [start, end] }, put up for the request in hand (its bay, day and name kept). Hours that read two
// ways ("actually 9 to 2" - 9 AM or 9 PM): { hand: true }. A time that names neither choice ("9pm"), or a range of more than twelve
// hours ("8pm to 1pm"): { again: true }. Also read: "1st", "2nd", "option 2", "A" / "B" for the first and second choice, and "two
// shifts" / "both shifts" for the choice that is two shifts.
// (THE BARE-HOUR RULE, Oct 27 2026 - the review of round 2c: { hand } went to the model with the request in hand, and after "pm" twice
// the model's own morning reading of the request was put up unguarded, applied at a place closed then. The hours are never the model's
// to settle: { hand } and { again } are each asked once more, in plain words - "say them with am or pm" - for as long as the owner's
// words are about the hours; a time with its am or pm to a question about ONE time ("Which time - 8 AM, or 8 PM?" answered "9pm") is
// the owner's correction too: { range: [t, t] })
// THE OWNER'S TYPED ANSWER TO "IS THAT $20 A HALF HOUR, OR $20 AN HOUR?" (Oct 28 2026, round 2e - the critic of round 2d: only a tap or "20
// an hour" was read; "an hour", "hour", "per hr", "half hour" went to the model as a new turn, and a model that wrote $20 a half hour after
// the owner typed "an hour" was put up at $40 an hour): 0 a half hour, 1 an hour, null anything else
function moneyUnit(words) {
  const t = String(words || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(?:(?:it'?s|its|that'?s|thats|is|was|make it|ok|okay|yes|yeah|yep|sure|um|uh|oh|the|its for|for|i meant|i mean|meant|sorry|no)\s+)*(?:\$?\s?\d+(?:\.\d\d)?\s*(?:dollars?|bucks?)?\s*)?(?:an?\s+|per\s+|every\s+|each\s+|by the\s+|for an?\s+|\/\s*)?(half[- ]?(?:an?\s+)?hour|half hr|half|30 ?min(?:ute)?s?|thirty min(?:ute)?s?|hour|hr|hourly)(?:\s+(?:please|pls|plz|thanks|thank you|thx|ty|rate|price))?$/.exec(t);
  if (!m) return null;
  return /^(?:half|30|thirty)/.test(m[1]) ? 0 : 1;
}
const HOURS_ANSWER = new Set(('am pm morning mornings evening evenings night nights tonight late dinner supper breakfast brunch early earlier later '
  + 'afternoon afternoons noon midnight first second last former latter one ones option choice shift shifts the a an it its that this is be at to '
  + 'till til until from start starts starting begin begins beginning end ends ending finish finishes finishing done by thru through hours hour '
  + 'time times which or and both please pls ok okay yes yeah yep yup sure go with do make let lets just i want mean meant think guess um uh so '
  + 'actually sorry no nope wait thanks thank you fine sounds good put them up we our neither none other different').split(' '));
function ampmIn(words, w) {
  const toMin = (x) => { const [a, b] = String(x || '').split(':').map(Number); return a * 60 + (b || 0); };
  const spans = Array.isArray(w && w.spans) && w.spans.length ? w.spans : ((w && w.values) || []).filter(v => v && typeof v === 'object' && !v.__split).map(v => Object.values(v));
  if (!spans.length) return null;
  const ch = spans.map(([a, b]) => ({ s: toMin(a) % 1440, e: toMin(b) % 1440 }));
  let t = ' ' + String(words || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\b([ap])\.\s?m\b\.?/g, '$1m').replace(/\bo'?\s?clock\b/g, ' ') + ' ';
  // (the evening as it is typed - "nite", "evng", "eve", "2night" - Oct 28 2026)
  t = t.replace(/\b(?:tonite|2nite|2night|tonigt)\b/g, 'tonight').replace(/\bnites\b/g, 'nights').replace(/\bnite\b/g, 'night').replace(/\b(?:evngs?|evenin|eves?)\b/g, 'evening');
  t = t.replace(/\bnoon\b/g, '12pm').replace(/\bmidnight\b/g, '12am')
    .replace(/\b(\d{1,2}(?::[0-5]\d)?)\s+in the morning\b/g, '$1am').replace(/\b(\d{1,2}(?::[0-5]\d)?)\s+in the (?:afternoon|evening)\b/g, '$1pm')
    .replace(/\b(\d{1,2})((?::[0-5]\d)?)\s+(?:at night|tonight)\b/g, (x, hh, mm) => hh + mm + (Number(hh) === 12 || Number(hh) <= 4 ? 'am' : 'pm'));
  // (the order said as a number or a letter: "1st", "the 2nd one", "option 2"; "A" or "B" alone - Oct 27 2026)
  t = t.replace(/\b1st\b/g, 'first').replace(/\b2nd\b/g, 'second').replace(/(?:\b(?:option|choice|number)\s*|#\s*)([12])(?![\d:a-z])(?!\s*(?:am|pm)\b)/g, (x, n) => (n === '1' ? ' first' : ' second'));
  const ab = /^\s*(?:(?:option|choice)\s+)?([ab])\s*[.!]?\s*$/.exec(t);
  if (ab && spans.length === 2) return ab[1] === 'a' ? 0 : 1;
  const asked = new Set((String((w && w.question) || '') + ' ' + ((w && w.choices) || []).join(' ')).toLowerCase().match(/[a-z]+/g) || []);
  // (money, a percent, an address, a date - "$20", "127.0.0.1", "2026-10-26" - is never an hour: "$20" was read as 8 PM)
  // (nor a length - "3 hours", "-3 hours" was read as an end at 3 - or a month's day - "oct 1-10": Oct 27 2026)
  if (/[$%@\/]|\d\.\d/.test(t) || /\d\s*(?:hours?|hrs?|h|minutes?|mins?)\b/.test(t) || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d/.test(t)) return null;
  const toks = t.replace(/(\d)(am|pm)\b/g, '$1 $2').split(/[^a-z0-9:]+/).filter(x => x && !/^\d/.test(x));
  // AN ANSWER THAT SAYS ITS PART OF THE DAY (Oct 28 2026, round 2e - the review of round 2d: "friday night", "in the evening", "night - thx",
  // "pm for sure", "definitely night", "evening of course" each went to the model - one word outside this list - and a model that repeated its
  // morning reading had it put up after the owner plainly said the evening). Words that carry a part of the day, or am / pm, are about the
  // hours whatever small words ride with them ("thx", "for sure", "of course", the day's name): read here, never handed on. A new request among
  // them is still its own (ownCommand, where this is read). A day's name counts only when it is the change's own day - "friday night" for a
  // Friday block; "saturday night" for it may move the day, and is no answer to which hours
  const partSaid = /\b(?:mornings?|breakfast|brunch|evenings?|nights?|tonight|dinner|supper|afternoons?|am|pm)\b/.test(t);
  const SOFT = /^(?:thx|thanks|thank|ty|please|pls|plz|sure|for|definitely|def|defo|deff|course|of|obviously|duh|lol|haha|ha|yea|ya|yeah|k|kk|tho|though|in|time|side|totally|absolutely|perfect|great|cool|good|right|correct|exactly|yup|yep|on|one|ones|clearly|surely|ofc|like)$/;
  const wa = (w && w.args) || {}, own = new Set([].concat(/^\d{4}-\d{2}-\d{2}$/.test(String(wa.date || '')) ? [['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(wa.date + 'T12:00:00Z').getUTCDay()]] : [],
    wa.days ? (actions.HELPERS.normDays(wa.days) || []) : []));
  const ownDay = (x) => { const k = /^(?:mon|tue|wed|thu|fri|sat|sun)/.exec(x); return !!k && /^(?:mon|tues?|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?s?$/.test(x) && own.has(k[0]); };
  if (toks.some(x => !HOURS_ANSWER.has(x) && !asked.has(x) && !(partSaid && (SOFT.test(x) || ownDay(x))))) return null;
  const cons = [], times = [];
  // the times named, each with its role
  const re = /(?<![\d:a-z])(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?(?![\d:])(?![a-z])/g;
  let named = 0;
  for (let x; (x = re.exec(t));) {
    const hh = Number(x[1]), mm = Number(x[2] || 0), ap = x[3] || '', before = t.slice(0, x.index), after = t.slice(x.index + x[0].length);
    if (hh > 23 || (ap && (hh < 1 || hh > 12))) return null;   // (no hour: "make it 30" is not about these hours)
    named++;
    const role = /\b(?:end|ends|ending|ended|till|til|until|to|thru|through|finish|finishes|finishing|done|by)\s+(?:at\s+)?$|-\s*$/.test(before) ? 'end'
      : /\b(?:start|starts|starting|from|begin|begins|beginning)\s+(?:at\s+)?$/.test(before) || /^\s*(?:-|to|till|til|until|thru|through)\s*\d/.test(after) ? 'start' : '';
    // (with am or pm - or on the 24-hour clock - one time of day; a bare 1 to 12 is that place on the clock, morning or evening)
    const exact = !!ap || hh === 0 || hh > 12, at = ap ? ((hh % 12) + (ap === 'pm' ? 12 : 0)) * 60 + mm : hh * 60 + mm;
    const same = (v) => (exact ? v === at : v % 720 === at % 720);
    // (AN END TO A QUESTION ABOUT ONE TIME - Oct 28 2026, round 2g, the critic of round 2f, HIGH: "pm, until 11pm", "at night, until 11pm", "pm.
    // done by 11pm" to "The Halloween Scramble at 8 in the morning, or 8 at night?" took the END as the new start - the scramble went on the
    // public Events page at once "Starts at 11:00 PM", and a booking was offered at 10 PM for "pm, till 10pm". A time said as the end is the
    // end: the choice it can close - starting before it, within twelve hours)
    const oneTime = ch.every(x => x.s === x.e);
    const ends = exact ? [at % 1440] : [at % 720, (at % 720) + 720];
    cons.push((i) => (role === 'start' ? same(ch[i].s) : role === 'end' ? (oneTime ? ends.some(v => { const d = (v - ch[i].s + 1440) % 1440; return d > 0 && d <= 720; }) : same(ch[i].e)) : same(ch[i].s) || same(ch[i].e)));
    times.push({ role, at: exact ? [at % 1440] : [at % 720, (at % 720) + 720] });
  }
  if (/\d/.test(t.replace(re, ' '))) return null;   // (a number that is not a time of day)
  if (/\b(?:mornings?|breakfast|brunch|early)\b/.test(t)) cons.push((i) => ch[i].s < 720);
  if (/\b(?:evenings?|nights?|tonight|late|dinner|supper)\b/.test(t)) cons.push((i) => ch[i].s >= 960);
  if (/\bafternoons?\b/.test(t)) cons.push((i) => ch[i].s >= 720 && ch[i].s < 1020);
  if (/\b(?:first|former|earlier)\b|\b1st\b/.test(t)) cons.push((i) => i === 0);
  if (/\b(?:second|last|latter|later)\b|\b2nd\b/.test(t)) cons.push((i) => spans.length > 1 && i === spans.length - 1);
  // (to a question about ONE time - "Which time - 8 AM, or 8 PM?", "The Scramble at 8 in the morning, or 8 at night?" - "pm" or "am" on its own
  // is the one that half: only one of the two has it. A question about two ranges keeps "pm" alone asked again - both have a PM. Oct 28 2026)
  if (ch.every(x => x.s === x.e) && !named) { if (/\bpm\b/.test(t)) cons.push((i) => ch[i].s >= 720); if (/\bam\b/.test(t)) cons.push((i) => ch[i].s < 720); }
  // (and "pm" or "am" said on its own beside an end - "pm, until 11pm", "am, done by 11am": the start's half - Oct 28 2026, round 2g)
  else if (ch.every(x => x.s === x.e) && times.length && times.every(x => x.role === 'end')) { const own = t.replace(/(\d)\s*(am|pm)\b/g, '$1'); if (/\bpm\b/.test(own)) cons.push((i) => ch[i].s >= 720); if (/\bam\b/.test(own)) cons.push((i) => ch[i].s < 720); }
  // ("two shifts", "both shifts": the choice offered as two shifts)
  const twoShifts = ((w && w.choices) || []).map((c, i) => (/\b(?:two|both) shifts\b/i.test(c) ? i : -1)).filter(i => i >= 0);
  if (/\b(?:two|both|2) shifts?\b/.test(t) && twoShifts.length === 1) cons.push((i) => i === twoShifts[0]);
  if (!cons.length) {
    // (one choice offered - the two shifts: a plain yes takes it)
    if (spans.length === 1 && /\b(?:yes|yeah|yep|yup|sure|ok|okay|both|please|fine|sounds good|do it|put them up)\b/.test(t) && !/\b(?:no|nope|not)\b/.test(t)) return 0;
    if (/\b(?:no|nope)\b/.test(t) || !toks.length) return null;
    return { again: true };
  }
  const fit = ch.map((_, i) => i).filter((i) => cons.every((c) => c(i)));
  if (fit.length === 1 && named <= 2) return fit[0];
  // (other hours than those offered: the one reading of a start and an end, or of a new end or start for the one choice offered)
  if (!fit.length && named && named <= 2 && !/\b(?:first|former|earlier|second|last|latter|later)\b|\bshifts?\b/.test(t)) {
    const hm = (x) => String(Math.floor((x % 1440) / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
    const partOk = (st) => (!/\b(?:mornings?|breakfast|brunch|early)\b/.test(t) || st < 720) && (!/\b(?:evenings?|nights?|tonight|late|dinner|supper)\b/.test(t) || st >= 960) && (!/\bafternoons?\b/.test(t) || (st >= 720 && st < 1020));
    // (a question about ONE time - a booking's start, an event's: every choice starts and ends at once - answered with a time whose half
    // is said: that time, Oct 27 2026)
    // (never a time said as the end: "until 11pm" is no new start - Oct 28 2026, round 2g)
    if (named === 1 && ch.every(x => x.s === x.e) && times[0].role !== 'end' && times[0].at.length === 1 && partOk(times[0].at[0])) return { range: [hm(times[0].at[0]), hm(times[0].at[0])] };
    let starts = null, ends = null;
    if (named === 2 && times[0].role !== 'end' && times[1].role === 'end') { starts = times[0].at; ends = times[1].at; }
    else if (named === 1 && spans.length === 1 && times[0].role === 'end') { starts = [ch[0].s]; ends = times[0].at; }
    else if (named === 1 && spans.length === 1 && times[0].role === 'start') { starts = times[0].at; ends = [ch[0].e]; }
    if (starts) {
      const ways = [];
      for (const st of starts) for (const en of ends) { const d = (en - st + 1440) % 1440; if (d > 0 && d <= 720 && partOk(st) && !ways.some(([a, b]) => a === st && b === en)) ways.push([st, en]); }
      if (ways.length === 1) return { range: [hm(ways[0][0]), hm(ways[0][1])] };
      if (ways.length > 1) return { hand: true };
    }
  }
  return { again: true };
}
// a read the box runs itself: the same checks, loads and digest as one the model asks for
async function runRead(a, args, ctx) {
  for (const n of a.needs || []) if (ctx[n] === undefined || ctx[n] === null) { const load = actions.LOADERS[n]; if (load) ctx[n] = await load(ctx); }
  if (a.local) return a.local(args, ctx);
  const q = a.request(args, ctx), res = await ctx.call(q.method, q.path);
  return res.status >= 400 ? { error: `that answered ${res.status}${res.json && res.json.error ? ': ' + res.json.error : ''}` } : (a.digest ? a.digest(res.json || {}, ctx) : res.json);
}

// THE BOX'S TWO MODELS (maintainer, Oct 20 2026: "we could run an 8b and a 4b and have it be smart switching like we have now
// with my foreman"). The quick model answers first. The main one takes the same step over when the quick one fumbles - a
// tool that does not exist, arguments it could not write or that fail the action's own checks, a tool call written into its
// words instead of made, no answer at all - or when it proposes a change the owner is asked to approve (money, doors,
// hours, staffing, the schedule): those always get the main model's answer. The quick model's try is taken back, never
// shown or kept, and the main one answers the rest of the turn. A box with one model, and an owner's own service, answer
// as one (model.hasQuick).
// the owner's words ask something (a question, a how-to, help) rather than ask for something to be done
const asksSomething = (t) => /\?|^\s*(?:\(.*?\)\s*)*(?:how|what|why|where|when|which|who|whose|can|could|do|does|did|is|are|was|were|should|will|would|may|tell me|explain|help|show me how|walk me through|i don'?t (?:know|understand)|not sure)\b|\bhow (?:do|does|can|to|should|much|many|long)\b|\bwhat (?:does|is|are|do|if)\b|\bwhy\b|\bhelp\b/i.test(String(t || ''));
// TWO QUESTIONS IN ONE (the review, Oct 25 2026: "whats booked tomorrow and whos working" was answered with tomorrow's bookings alone -
// the box's own answer said the first part and dropped the second): a first part that is a question or more than a word or two, then
// "and", "also", a comma, a semicolon or a question mark before a question's own first word - or two question marks. "who is playing
// and on which bay" is one question; a false one only costs a model round, as a second command does (intents.second)
const ASK_WORD = "(?:who|whos|who's|what|whats|what's|how|hows|how's|why|when|where|wheres|where's|which|is|are|was|were|did|does|do|can|could|will|would|should|any|anyone|anything|has|have)";
const ASK_IN = new RegExp(`\\b${ASK_WORD}\\b`);
// two requests, or a request and a question, in the owner's words (intents.second, secondAsk): the box's own readings stand aside for
// the model, which has the whole (Oct 27 2026)
const twoParts = (t) => { let two = false; try { two = intents.second(t); } catch { two = false; } return two || secondAsk(t); };
function secondAsk(t) {
  const s = String(t || '').toLowerCase().replace(/[‘’]/g, "'").trim();
  if ((s.match(/\?/g) || []).length >= 2) return true;
  // (and after a full stop, a dash, "&", "n" or "plus" - "whats booked tomorrow. whos working", "whats booked tmrw & whos working",
  // "... n whos working", "... - whos working", "... plus whos working" were each half answered: the review, Oct 27 2026)
  const re = new RegExp(`(?:\\band\\b|\\balso\\b|\\bplus\\b|\\bn\\b|&|[,;?]|\\.(?=\\s)|\\s[-\\u2013\\u2014]+(?=\\s))\\s*(?:and\\s+|also\\s+|then\\s+|so\\s+)?${ASK_WORD}\\b`, 'g');
  for (let m; (m = re.exec(s));) { const before = s.slice(0, m.index).trim(); if (before && (ASK_IN.test(before) || before.split(/\s+/).length >= 3)) return true; }
  return false;
}
// A CHANGE ASKED FOR, NOT A QUESTION (the review, Oct 25 2026: "set the tax rate to 7" was answered with the tax rates, "add Jordan Lee
// to the staff list" with the staff, "any bookings today? cancel them" with the bookings - each change dropped, the model never told):
// a part of the words that leads with a doing-word (after "ok", "please", "can you", "I want to" ...), a value said for a setting with
// no question ("our tax rate is 7%"), an amount or percent off said the same way, or a person's phone or email given. Never the reads
// that only look like one: "show me", "give me", "send me", "take a look", "close out", "end of day", "email list", "text opt-outs"
const CHANGE_LEAD = new RegExp('^(?:(?:ok(?:ay)?|alright|all right|so|hey|now|and|also|then|please|pls|plz|just|great|thanks|cool|actually|can you|could you|would you|will you|can we|could we|i want(?: you)? to|i wanna|i need(?: you)? to|we need to|we want to|i\'?d like(?: you)? to|let\'?s|go ahead and)[,\\s]+)*'
  + '(?:set|change|make|add|create|sign (?:\\w+ )?up|enroll|register|remove|delete|drop|block|unblock|cancel|turn|switch|stop|start|end(?! of\\b)|put|give(?! me\\b)|hire|fire|raise|lower|increase|decrease|bump|update|rename|book|reserve|schedule|reschedule|move|charge|refund'
  + '|send(?! me\\b)|(?:text|e-?mail) (?:the|our|all|every|everyone|everybody|them|him|her|it|members|customers|staff|a|an)|mark|clear|pause|resume|suspend|reset|post|publish|hide|unhide|close(?! ?out\\b)|open(?! up\\b)|take(?! a look\\b| me\\b)|swap|approve|deny|decline|accept|void|comp|86'
  + '|(?:show|list|put) (?:\\S+ ){0,4}on (?:the |our |my )?(?:web ?site|site|home ?page|page|booking page))\\b', 'i');
const ASK_LEAD = new RegExp(`^(?:(?:ok(?:ay)?|so|hey|and)[,\\s]+)*${ASK_WORD}\\b`, 'i');
// (and a change said in the middle of the words - the review, Oct 27 2026: "i'd like the tax rate at 7", "the tax rate needs changing to 7",
// "we want our tax rate at 8%", "we need Jordan Lee on the staff list", "Jordan Lee needs to be added to the staff list", "staff list: add
// Jordan Lee", "new hire Jordan Lee for the staff list" and "our staff list needs Jordan Lee" were each answered with the rates or the
// staff, the change dropped and the model never told: a want or a need with a value or a person put somewhere, a thing that "needs
// changing" or "needs to be added", a new hire - and a part after a colon or a dash)
const CHANGE_MID = [
  /\b(?:need|needs|needed|want|wants|wanted|wanna|'?d like|would like)\b[^?.!;]{0,40}\b(?:at|to|to be|be|is|=)\s*\$?\s?\d/i,
  /\b(?:needs?|has to|have to|got to|gotta)\s+(?:to\s+)?(?:be\s+|get\s+)?(?:chang|updat|add|remov|rais|lower|bump|set|fix|turn|switch|clos|open|block|cancel|book|schedul|mov|renam|put|tak|hir|fir|drop|delet)\w*\b/i,
  /\b(?:need|needs|want|wants|wanna|'?d like|would like)\s+(?:[a-z][a-z'.-]*\s+){1,3}(?:on|onto|in|into|off|added to|removed from|taken off|for)\s+(?:the|our|my)\s+(?:staff|roster|schedule|team|menu|list|website|site|page|calendar|crew)\b/i,
  /\b(?:staff|roster|team|crew|menu|schedule|website|site)(?:\s+(?:list|page))?\s+needs\s+(?!to\b)[a-z]/i,
  /\bnew (?:hire|employee|staff member|team member|bartender|server|cook)\b/i,
];
function changeAsked(t) {
  const s = String(t || '').replace(/[‘’]/g, "'").trim(), parts = s.split(/[?.!;,:]|\s[-\u2013\u2014]+\s|\b(?:and|then|also|but)\b/i).map(x => x.trim()).filter(Boolean);
  if (parts.some(p => CHANGE_LEAD.test(p))) return true;
  // (a phone as phones are written - 555-123-4567, (555) 123 4567, 555-1234 - never a date like 2026-10-31)
  if (/[^\s@<>(),;]+@[^\s@<>(),;]+\.[a-z]{2,}/i.test(s) || /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])|(?<![\d-])\d{3}-\d{4}(?![\d-])/.test(s)) return true;
  if (!/\?/.test(s) && !ASK_LEAD.test(s) && CHANGE_MID.some(re => re.test(s))) return true;
  return !/\?/.test(s) && parts.some(p => !ASK_LEAD.test(p) && (/\b(?:is|are|should be|will be|to be)\s+(?:now\s+)?\$?\s?\d/i.test(p) || /\b\d{1,3}\s*%\s*off\b|\$\s?\d+(?:\.\d\d)?\s*off\b/i.test(p)));
}
// AN ANSWER THAT SAYS LITTLE ELSE (the review, Oct 25 2026: asked "What does Wings cost?", told "turn off bay 3", the box put Wings up at
// $3 and Bay 3 was never turned off): the number, amount, percent, phone, email or day read from the owner's words is their answer only
// when the words say nothing else ("is 12 ok?" is an answer, "whats on at 7?" is not). Anything more is the model's to read, with the
// question beside it. (The words of what is asked - "cost", "tax", "minutes" - are an answer's own words only for a question of that
// kind: asked a Wings price, "set the tax rate to 7" is another change, never the wings at $7 - the review, Oct 27 2026.)
// AN ANSWER IS PLAINLY ONE OF THE QUESTION'S KIND, OR IT IS A NEW REQUEST (the review, Oct 27 2026 - finding 11 as a class: "close at 9",
// "open at 10", "carl at 5", "robin at 4", "fries are 5", "beer is 6", "tacos $3", "staff at 4", "lights at 8", each said straight after
// "What does Wings cost?", were put up as the wings' price - one word was let through beside the number, and "at", "is", "are" were every
// answer's filler). maintainer: a narrow list of what the box understands, never a longer list of what it does not. Besides the number, EVERY
// word must be the question's own or its answers', a word of what it asks for (a price: dollars, bucks, each, per order, a plate), or one
// of the few words people answer with ("it's", "make it", "about", "say", "they're"); a doing-word only to say the answer ("make it 12",
// "charge 12 for them", "set the price to 12"). Anything else - a name, another item, a doing-word ("close", "open", "book"), a bay, a
// time, a day - is a new request, handled as one: the model reads it, the question beside it.
const ANSWER_GLUE = new Set(('it its that thats this they them those these theyre em the a an is are be was will would should can could you '
  + 'make set let lets do go with say about around roughly approx approximately exactly just only like maybe probably '
  + 'ok okay yes yeah yep yup sure please pls thanks thank um uh hmm so oh well actually wait sorry no i think guess we our my your his her their '
  + 'ahead usually normally typically currently now even fine good right work works sound sounds instead oops at to for of and or').split(' '));
const KIND_WORDS = {
  money: 'dollars dollar bucks buck usd cents cent cost costs costing price priced prices pricing charge charging total each apiece ea per piece pieces pc pcs order orders plate plates basket baskets serving servings portion portions bowl bowls dozen item items',
  percent: 'percent pct tax taxes rate rates sales charge charging half',
  number: 'minutes minute mins min hours hour hrs hr half off percent pct dollars dollar bucks free one',
  hours: 'hours hour hrs hr half minutes minute mins min long least more longer minimum one two three four need needs must has have',
  phone: 'phone cell mobile number num home work office call text texting reach him me',
  email: 'email mail address send sends sent from',
  oneof: 'this next week coming one first second last later following upcoming day tonight',
};
// (the doing-words that may only say the answer - "make it 12", "give them 30 minutes", "take 5 off": any other leads a new request;
// "charge" and "price" are a price's and a rate's own words, never a number of minutes - "set the price to 40 an hour" was 40 minutes free)
const LEAD_VERBS = new Set('make set give put do go take keep change use'.split(' '));
// which kind of answer the box's question takes (its parse - or, said without one, its own words)
const answerKind = (w) => { const p = String((w && w.parse) || ''); if (/^oneof:/.test(p)) return 'oneof'; if (/e-?mail/i.test(p)) return 'email'; if (/phone|mobile|cell/i.test(p)) return 'phone'; if (KIND_WORDS[p]) return p;
  const q = String((w && w.question) || '').toLowerCase();
  return /\bcosts?\b|\bprice\b|\$|\bdollars?\b/.test(q) ? 'money' : /\brate\b|\bpercent\b|%/.test(q) ? 'percent' : /\bphone\b/.test(q) ? 'phone' : /\bemail\b/.test(q) ? 'email' : /\bminutes?\b/.test(q) ? 'number' : /\bhours?\b|\bhow long\b/.test(q) ? 'hours' : /^which\b/.test(q) ? 'oneof' : ''; };
// a doing-word that starts a part of the words, and what it is done to: "make it 12" is the answer, "make the base price $25" is not
const ANSWER_LEAD = /^(?:(?:ok(?:ay)?|alright|so|um|uh|and|also|then|please|pls|just|actually|no|wait|sorry|yeah|yes|yep|can you|could you|i want to|i'?d like to|let'?s|lets|go ahead and)[,\s]+)*(set|change|make|add|create|put|use|charge|price|turn|switch|block|book|cancel|remove|delete|drop|give|move|schedule|hire|send|text|email|start|stop|end|open|close|take|raise|lower|bump|update|rename|mark|reserve|refund|sign|enroll|register|clear|pause|resume|post|publish|hide|show|list)\s+(?:(?:the|a|an|our|my|your|their|his|her|all|every|some)\s+)?([a-z0-9$%][^\s,.;!?]*)/;
const IT_WORDS = new Set('it its that them they those these this each one ones em both all'.split(' '));
const TIME_UNIT = /\b(?:hours?|hrs?|minutes?|mins?|half[- ](?:an[- ])?hour)\b/;
function answerOnly(words, w, bayNames) {
  const asked = new Set((String((w && w.question) || '') + ' ' + ((w && w.choices) || []).join(' ')).toLowerCase().match(/[a-z]+/g) || []);
  const askedText = (String((w && w.question) || '') + ' ' + ((w && w.choices) || []).join(' ')).toLowerCase();
  const said = String(words || '').toLowerCase().replace(/[‘’]/g, "'");
  const kind = answerKind(w), own = new Set(String(KIND_WORDS[kind] || '').split(' ').filter(Boolean));
  // (a price a month, a person or off something: the words the question itself counts in - "49/mo", "40 a head", "$5 off each booking")
  if (kind === 'money' && /\bmonth/.test(askedText)) for (const x of ['mo', 'month', 'months', 'monthly', 'billed']) own.add(x);
  if (kind === 'money' && /\bperson\b/.test(askedText)) for (const x of ['person', 'head', 'heads', 'pp', 'guest', 'guests', 'player', 'players', 'people']) own.add(x);
  if (/\boff\b/.test(askedText)) for (const x of ['off', 'booking', 'bookings', 'session', 'sessions']) own.add(x);
  if (kind === 'number' && /\bminutes?\b/.test(askedText)) own.add('last');
  // (the box's "Which Saturday?" answered with another day - "sorry, I meant Sunday", "monday" - is its answer: parseIn reads the day, Oct 31 2026)
  if (/^oneof:/.test(String((w && w.parse) || ''))) for (const x of WEEKDAY_FULL.concat(['mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'meant', 'mean'])) own.add(x);
  // (Oct 27 2026, the review's probe - each said straight after "What does Wings cost?" and each put up as the wings' price:)
  // a bay the question does not name - "charge 15 for bay 3", "price bay 2 at 20", "bay 3 off" - is about that bay
  const bays = [/\bbays?\b/].concat((bayNames || []).filter(Boolean).map(n => new RegExp('\\b' + String(n).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')));
  if (bays.some(re => re.test(said) && !re.test(askedText))) return false;
  // "86 the wings" is the menu's word for taking it off, never $86
  if (/(?:^|[,.;!]\s*)(?:(?:ok(?:ay)?|so|and|also|then|please|just|actually)[,\s]+)*86\b/.test(said.trim())) return false;
  // a doing-word done to something that is not "it", the question's own words or its kind's - "make the base price $25", "set the tax
  // rate to 7", "put carl on at 5" - is another change (each part of the words: "12, and change the headline")
  const saying = new Set();   // (the doing-words that only say the answer: "give them 30 minutes", "take 5 off")
  for (const part of said.split(/[,.;!?]|\b(?:and|then|also|but)\b/).map(x => x.trim()).filter(Boolean)) {
    const m = ANSWER_LEAD.exec(part); if (!m) continue;
    // (only a doing-word that says the answer - "close at 9", "open at 10", "book 2 hours" are each a new request: Oct 27 2026)
    if (!(LEAD_VERBS.has(m[1]) || own.has(m[1]) || asked.has(m[1]))) return false;
    const obj = m[2].replace(/'(?:s|re|ll|ve|d|m|t)$/, '');
    if (!(/[\d$%@]/.test(obj) || IT_WORDS.has(obj) || ANSWER_GLUE.has(obj) || own.has(obj) || asked.has(obj))) return false;   // ("use hello@rapidgolf.com": the address is the answer)
    saying.add(m[1]);
  }
  // a time of day - "at 5pm", "7:30" - is never a price, a rate or a length; nor "at 2" for a length ("at least 2" is one) (Oct 27 2026)
  if (/^(?:money|percent|number|hours)$/.test(kind) && /\d\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|(?<![\d.])\d{1,2}:[0-5]\d(?!\d)/.test(said)) return false;
  if (kind === 'hours' && (/\bat\s+\d/.test(said) || /\$|\bdollars?\b|\bbucks?\b|%|\bpercent\b/.test(said))) return false;
  // a number counted in something else - a percent or "off" for a price, dollars for a rate, an hour for a price that is not by the hour
  if (kind === 'money' && (/%|\bpercent\b|\bpct\b/.test(said) || (TIME_UNIT.test(said) && !TIME_UNIT.test(askedText)))) return false;
  if (kind === 'percent' && /\$|\bdollars?\b|\bbucks?\b/.test(said)) return false;
  // (and for a number of minutes or a percent off: "$20" to "How many percent off?" is dollars, "20%" to "How many minutes free?" is not
  // minutes)
  if (kind === 'number' && /\bpercent\b|%/.test(askedText) && /\$|\bdollars?\b|\bbucks?\b|\bminutes?\b|\bmins?\b|\bhours?\b|\bhrs?\b/.test(said)) return false;
  if (kind === 'number' && /\bminutes?\b/.test(askedText) && /\$|\bdollars?\b|\bbucks?\b|%|\bpercent\b/.test(said)) return false;
  if ((kind === 'money' || kind === 'percent') && /\b(?:off|discount)\b/.test(said) && !/\b(?:off|discount)\b/.test(askedText)) return false;
  // two different numbers - "10 wings for 12", "12 for 6" - which one is the answer is not plain: never guessed (a phone, an email and a
  // date the box offered are read as a whole)
  if (/^(?:money|percent|number|hours)$/.test(kind)) { const ns = new Set((said.replace(/,(?=\d{3}\b)/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number)); if (ns.size > 1) return false; }
  const left = said.replace(/\b(?:what|how) about\b/g, ' ').replace(/[^\s@<>(),;]+@[^\s@<>(),;]+\.[a-z]{2,}/g, ' ').replace(/'(?:s|re|ll|ve|d|m|t)\b/g, '')
    .split(/[^a-z0-9$%.:-]+/).filter(x => x && !/^[$%.:-]+$/.test(x))
    // (a number as numbers are written - 12, $12.50, 20%, 2hrs, 7th, 555-123-4567 - is the answer; letters beside digits are words all the
    // same: "spring20" is a code's name, "b2" a bay's, never a bare 20 or 2 - Oct 27 2026)
    .flatMap(x => { const y = x.replace(/^\$/, '').replace(/[%.:-]+$/, ''); if (!/\d/.test(y)) return [x.replace(/[$%.:-]+/g, '')];
      return /^\d+(?:[.:,-]\d+)*(?:st|nd|rd|th|am|pm|h|hr|hrs|hours?|m|min|mins|minutes?|k)?$/.test(y) ? [] : y.split(/[^a-z]+/); })
    .filter(x => x && !ANSWER_GLUE.has(x) && !own.has(x) && !asked.has(x) && !saying.has(x));
  // (nothing else at all: until Oct 27 2026 one word more was let through - "carl at 5", "fries are 5", "close at 9" were the wings' price)
  return left.length === 0;
}
// WORDS ABOUT AN ACCOUNT'S WALK STEP (setupguide.js walkSteps): the chapter's own Stuck? answer for them, or the step's own words - the
// walk's to answer, from the guide, with the step beside them; anything else is a new request and the walk steps aside (lifted out of
// the walk below, Oct 25 2026, so an everyday look-up mid-walk reads the same test: "is stripe connected now" is the walk's)
function aboutWalk(svc, words) {
  const sa = setupGuide.stuckAnswer(svc, words);
  return { sa, about: !!sa || new RegExp('\\b(?:' + setupGuide.WALK_NAME[svc].toLowerCase() + '|keys?|dns|records?|verif\\w*|account|ein|ssn|social|bank|campaign|brand|profile|number|domain|login|password|code|button|page|screen|tab|menu|stuck|step|it says?|says|shows?|click|copy|paste|where|wizard|form)\\b', 'i').test(words || '') };
}
// A CHANGE CLAIMED WITH NO CHANGE MADE (Oct 21 2026, night - the customer's day one): "You've named your bays: Bay 1, Bay 2,
// Bay 3, The Vault" on a box with one bay and no tool called; "This is now set" over a No. Said that way with nothing
// proposed or applied in the exchange, the answer is not shown: the model is told nothing changed and asked again, once
const CLAIMS_DONE = /\b(?:(?:is|are|'re|'s) now (?:\*\*)?(?:set|on|off|active|required|optional|open|closed|live|public|connected|added|updated|saved|enabled|disabled|named|called|booked|scheduled|blocked|in service|out of service|stopped|started|removed|cancelled|taken down)|now set to|(?:is|are|been) confirmed|[-\u2013\u2014] confirmed|(?:has|have) been (?:set|updated|changed|added|saved|named|renamed|turned (?:on|off)|switched|scheduled|booked|created|made|moved|completed|finished|done)|(?:set|saved|added) as an? |(?:is|are) all (?:set|done)|(?:I|we)(?:'ve| have) (?:set|updated|changed|added|saved|named|renamed|turned|switched|scheduled|booked|created|made|put|moved|confirmed|marked|ticked)|you(?:'ve| have) (?:named|confirmed|chosen|picked|selected|set)|we(?:'re| are) (?:now )?(?:set|all set)\b)\b|^\s*(?:\*\*)?done(?:\*\*)?\s*[-\u2013\u2014:!]|\b(?:I|we) (?:just )?(?:made|created|added|saved|booked|scheduled|set up)\b/i;   // (and "Done - ..." in its own words with nothing done this turn - the 4B, Oct 22 2026)
// RULE 15 IN THE CHAT (Oct 21 2026, night - the customer's day one): told a waiver was "required", the box's small model called the
// document "required for safety and compliance". The software never calls anything compliant, binding or enforceable, never
// cites a law: an answer that does is not shown - the model is told why and asked again, once
// ASKED TO CONFIRM WHAT THE CARD CONFIRMS (Oct 21 2026, night - the customer's day one): "Would you like me to proceed with that?
// (Yes/No)" - the owner said yes, and the box's small model moved on to the next step, the change never made. The card IS the
// owner's yes or no: asked that way, the model is told to put the change up, once
const ASKS_CONFIRM = /(?:would you like (?:me |us )?to (?:proceed|go ahead|set|add|make|apply|do|save|change|update|confirm)|would you like to:|confirm this (?:pricing|price|change|special|setting)|shall (?:I|we) (?:proceed|go ahead|set|add|make|apply|save|change|update)|do you want (?:me|us) to (?:proceed|go ahead|set|add|make|apply|save|change|update)|should (?:I|we) (?:proceed|go ahead)|\(yes\s*\/\s*no\))/i;
// ...and an offer to write a waiver or find one ("we can guide you through creating one or finding a template") - the owner's own
// document, from their own lawyer (rule 15); read only where the answer is about a waiver or a policy
const WRITES_LEGAL = (t) => /\b(?:waivers?|polic(?:y|ies)|terms)\b/i.test(t) && /\b(?:(?:creat|writ|draft|generat)(?:e|es|ing)\b[^.?!]{0,30}\b(?:one|it|a waiver|your waiver|the waiver|a policy|your policy|the wording)|templates?|sample waivers?)\b/i.test(t);
// ASKED HOW THINGS ARE AND ANSWERED FROM MEMORY (Oct 21 2026, night): "who's on tonight?" was answered "Alex is playing until
// 10:30" with nothing looked up; the menu, the tax rates and "is everything working" the same. A question about this facility
// as it is now, answered with no tool called, is sent back once to be looked up
const STATE_Q = /\b(?:what happens|who(?:'?s| is| are) (?:on|in|playing|working|booked|coming|here|scheduled)|who works|what(?:'?s| is| are) (?:on|in|our|booked|left|due)|any (?:bookings?|requests?|messages?|shifts?|members?)|is (?:everything|anything|anyone|the box|my site|our site)|are (?:we|there) |how many|how much (?:did|have|do|does) (?:we|it)|what (?:do|did|does) (?:we|it) |do we have|what (?:tax(?:es)?|prices?|rates?|times?)(?: rates?)? (?:do|are|is)|when (?:is|are) (?:the|our|my) )/i;
// (Oct 22 2026, the breadth set: "what messages do customers get from us?" and "where are our booking events sent?" answered from
// nothing) a question about how this facility is set up, in the owner's "our", "we", "us" or about its customers
const OURS_Q = /\b(?:what|which|where|when|how many|how much|who|is|are|do|does)\b[^?]{0,60}\b(?:our|we|us|my|customers?|members?|staff)\b[^?]*\?/i;
const HOWTO_Q = /^\s*(?:how (?:do|can|should|would) (?:i|we)|what (?:is|are) an?\b|what does|why |explain|tell me about|walk me through)/i;
// "Here's what I'll do" with nothing done: the same as asking - do it, the owner says yes or no on the card
const WILL_DO = /\b(?:I'll|I will|we'll|we will|let me|I'm going to) (?:now |go ahead and |just )?(?:add|set|update|change|create|make|send|put|draft|prepare|write|compose|turn|schedule|book|remove|take|stop|start|apply|save|block|cancel|move|pair|connect|switch)\b/i;
// ASKED TO TYPE A SECRET INTO THE CHAT (Oct 22 2026, the customer's day one: "What is your backup passphrase? ... Just reply with
// your passphrase") - a password, passphrase, key or PIN is never typed to the model: the tools that take one show a masked box
// (a service's key pasted on its own IS the way - the page saves it before anything is sent - so keys are not this)
const ASKS_SECRET = /\b(?:reply|respond|type|tell me|send|give me|enter|share|paste)\b[^.?!]{0,40}\b(?:your |the )?(?:backup )?(?:pass ?phrase|password|passcode|pin)\b|\bwhat(?:'s| is) (?:your|the) (?:backup )?(?:pass ?phrase|password)\b/i;
const LEGAL_CLAIM = /\b(?:complian(?:t|ce)|legally binding|legally required|enforceable|meets the (?:legal )?requirements?|required by law|the law (?:says|requires)|statutes?|liability protection|protects? you (?:legally|from (?:liability|lawsuits)))\b/i;
// A CALL WRITTEN INTO THE WORDS, MADE (Oct 22 2026, the breadth set: the 4B answered "<tool_call> {"name": "website_section_add",
// ...}</tool_call>" as its reply - the owner would have read code). A call written out whole, by a name in the list, is made
// as if it had been called; anything that does not read as one is left for the takeover or the words
function callsInWords(text) {
  const out = [], t = String(text || '');
  const re = /(?:<tool_call>\s*)?(\{\s*"name"\s*:\s*"([a-z_]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\})(?:\s*<\/tool_call>)?/g;
  let m; while ((m = re.exec(t))) { if (!actions.BY_NAME.has(m[2])) continue; let args; try { args = JSON.parse(m[3]); } catch { continue; } out.push({ id: 'words_' + crypto.randomBytes(4).toString('hex'), name: m[2], args, raw: m[3] }); }
  return { calls: out, text: out.length ? t.replace(re, '').replace(/<\/?tool_call>/g, '').trim() : t };
}
const callInWords = (t) => /<tool_call>|"name"\s*:\s*"[a-z_]+"\s*,\s*"arguments"\s*:/.test(String(t || ''));
// the owner's own service did not answer and the box's own AI did: the reply says so first (the key never in it)
const fellBackNote = (f) => `(${f.from} did not answer - ${secrets.scrub(String(f.why || '')).text.slice(0, 160).replace(/[.\s]+$/, '')}. No other model is connected.)\n\n`;

async function run(conv, ctx) {
  conv.used = Date.now();
  // WHAT A FOLLOW-UP IS READ AGAINST (the review, Oct 25 2026: "actually make it 9" put the base price from two turns before at $9 a
  // half hour, after the box had asked where a pretzel goes; "make it $79", answering the model's own question about a membership's
  // price, did the same; "ok turn it on" switched on the bay of a look-up two turns back): only what was looked up or put up in the
  // turn just before the owner's newest words, and never while the model's own question with answers to tap is open - anything else
  // is read fresh by the box, or goes to the model ("and Saturday?", "no wait, Bay 3" and "actually make it 30" right after still are)
  if (ctx.lastCall && (ctx.lastCall.turnsAgo > 0 || lastAskOwner(conv))) ctx.lastCall = null;
  conv.areas = conv.areas || new Set();
  ctx.wantAreas = conv.areas;   // more_tools adds to it for the rest of the turn
  // the facility's own names in the owner's words (areasFor)
  if (ctx.namedAreas === undefined) ctx.namedAreas = namesIn(ownersWords(conv), await facilityNames(ctx));
  shapeFor(ctx);
  { const c = quickCards.cardOf(ownersWords(conv)); if (c) (conv.cardsAsked = conv.cardsAsked || new Set()).add(c.say); ctx.cardsAsked = conv.cardsAsked; }
  // the owner's newest words find the passages; their earlier words in this conversation ride along at a lower weight, so
  // "ok, how do I do that?" still finds the chapter the talk is about (knowledge.js)
  // (the page's own hello when the chat opens is not the owner's words: its "first setup screen" found the first screen's
  // chapter for "we don't have a domain yet" - Oct 21 2026, night)
  const ownerSaid = conv.messages.filter(m => m.role === 'user').map(m => String(m.content || '')).filter(t => !OPENED.test(t));
  // the guide is searched when the owner asks something or asks how; a request to do something gets no passages (null)
  const newestSaid = ownerSaid[ownerSaid.length - 1] || lastUserText(conv);
  const asked = asksSomething(newestSaid) && !OPENED.test(newestSaid);
  ctx.newest = OPENED.test(newestSaid) ? '' : newestSaid;
  ctx.askedQuestion = asksSomething(newestSaid) && !OPENED.test(newestSaid);
  ctx.wordsNamed = OPENED.test(newestSaid) ? [] : matching(AREA_WORDS, newestSaid);
  ctx.askedState = !OPENED.test(newestSaid) && (STATE_Q.test(newestSaid) || OURS_Q.test(newestSaid)) && !HOWTO_Q.test(newestSaid);
  // (the owner's words for the request in hand, for every guard - requestInHand, Oct 28 2026)
  ctx.inHand = requestInHand(conv, ctx);
  // (a short question while the box's setup question waits is about that step: "what does that cost" to the texting question)
  const stepAsked = conv.guide && lastAsked(conv).includes(conv.guide.text) ? setupGuide.BY_ID.get(conv.guide.id) : null;
  const walking = conv.walk && lastAsked(conv).includes(conv.walk.text) ? conv.walk : null;
  const walkTitle = walking ? ((setupGuide.walkSteps(walking.svc)[walking.i] || {}).title || '') : '';
  const searchFor = walking && asked ? `${newestSaid} - ${setupGuide.WALK_NAME[walking.svc]} ${walkTitle}` : stepAsked && asked && String(newestSaid).trim().split(/\s+/).length <= 10 ? `${newestSaid} - ${stepAsked.name}` : newestSaid;
  const guide = asked ? await knowledge.searchBest(searchFor, 3, { context: ownerSaid.slice(-3, -1).join('\n') }) : null;
  ctx.askedSomething = asked;
  let role = model.hasQuick() ? 'quick' : 'main', tookOver = false, fellBack = null, answeredBy = null, proposedAny = false, lookedUp = false;
  // the last thing the AI looked at this turn: an answer with no change moves the owner's view there ("who's booked today?"
  // opens the bookings - maintainer: "they tell the AI it moves them to that page")
  let seen = null;
  const done = (out) => {
    if (seen && !(out.proposals || []).length && !out.screen) { const sc = screens.screenOf(seen.name, seen.args, ctx); if (sc) out.screen = sc; }
    // which parts of the guide the answer stood on, for the owner's page to show beside it (another project shows its own)
    // - only when it DID stand on them: an answer from the facility's own records or a change put up is not the guide's (Oct 24 2026,
    // the chat at every size: "Nobody is on the schedule tonight." came with "From your guide: Software updates ... Specials", the
    // passages its word "tonight" matched)
    if (out.reply !== undefined && guide && guide.length && !lookedUp && !ctx.lookedUpFirst && !ctx.ownAnswer && !(out.proposals || []).length) out.sources = guide.map(g => ({ from: g.source, heading: g.heading.replace(/^EVERYTHING - Ask Your AI > /, '') }));
    if (answeredBy) out.answeredBy = Object.assign(answeredBy, { tookOver });
    if (ctx.lookedUpFirst) out.lookedUp = ctx.lookedUpFirst;
    if (ctx.boxCalled) out.boxCalled = ctx.boxCalled;   // (the change the box read itself - BOX FIRST - for the owner's page and the scoring)   // the everyday read the box ran itself (EVERYDAY), for the owner's page and the scoring
    if (fellBack) { out.answeredBy = Object.assign(out.answeredBy || {}, { fellBack }); if (out.reply !== undefined) out.reply = fellBackNote(fellBack) + out.reply; }
    // nothing to tap and nothing waiting for a yes: the box's own next steps
    // (an answer that asks the owner something is answered, not tapped past: "What is your website address?" beside "Set my opening
    // hours" was two directions at once - the customer's day one, Oct 22 2026)
    // (a question answered during a walk: the walk's step is where the owner goes back to)
    if (ctx.walkAsked && conv.walk && out.reply !== undefined && !out.error && !(out.proposals || []).length) {
      const w = ctx.walkAsked, steps = setupGuide.walkSteps(w.svc), last = w.i >= steps.length - 1;
      const back = `When you are ready, tap "${last ? 'Done' : setupGuide.WALK_NEXT}" (${setupGuide.WALK_NAME[w.svc]} step ${w.i + 1} of ${steps.length}), or ask me something else.`;
      out.reply = String(out.reply).trim() + '\n\n' + back; out.choices = [last ? 'Done' : setupGuide.WALK_NEXT, 'Say the step again', 'Skip for now'];
      conv.walk = Object.assign({}, w, { text: back });
      for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'assistant') { if (!conv.messages[i].tool_calls) conv.messages[i].content = out.reply; break; }
      return out;
    }
    // (the setup guide: an answer that changed nothing and asks nothing, while a setup step is open - the step is asked again, so the
    // owner always knows where they are)
    if (conv.guideOn && conv.guide && out.reply !== undefined && !out.error && !(out.proposals || []).length && !/\?\s*$/.test(String(out.reply).trim())) {
      const step = setupGuide.BY_ID.get(conv.guide.id), item = (ctx.setup || []).find(i => i.id === conv.guide.item);
      if (step && item && !item.done) {
        const q = setupGuide.question(step, cfgNow());
        // (the model's own copy of the question is taken out: "Do you have a website address (a domain) like yourgolf.com?" was said twice)
        const askWords = new Set(q.text.toLowerCase().match(/[a-z]{4,}/g) || []);
        const paras = String(out.reply).trim().split(/\n{2,}/).filter(pp => { const w = pp.toLowerCase().match(/[a-z]{4,}/g) || []; return !(w.length && w.filter(x => askWords.has(x)).length / w.length >= 0.6); });
        // (and its own questions - "Would you like to proceed with setting this up?", "Next, what is your website address?" - give way to
        // the box's: one question at a time)
        for (let i = paras.length - 1; i >= 0 && paras.length > 1; i--) if (/\?/.test(paras[i]) || /^\W*(?:next|first|now|let'?s)\b/i.test(paras[i])) paras.splice(i, 1);
        out.reply = (paras.join('\n\n') ? paras.join('\n\n') + '\n\n' : '') + (ctx.guideStep ? '' : 'Back to setting up: ') + q.text; out.choices = q.choices;
        conv.guide.text = step.ask(cfgNow()); conv.guide.taps = q.taps;
        for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'assistant') { if (!conv.messages[i].tool_calls) conv.messages[i].content = out.reply; break; }
      }
    }
    // THE CHAT OPENING: once the setup no longer leads, the hello ends with the questions this facility can ask, whatever the greeting
    // itself asked ("How can I help you today?" - that is what the cards answer) - maintainer, Oct 25 2026: "directing a conversation when they
    // open it up"
    if (OPENED.test(newestSaid) && !conv.guideOn && out.reply !== undefined && !out.error && !(out.proposals || []).length && !(out.choices && out.choices.length)) {
      const qc = quickNow(ctx, CARDS_SHOWN);
      if (qc.length) {
        // (the opening row ends with "What else can you do?" like every row of cards after it - the sandbox handoff's check, Oct 25 2026)
        out.reply = String(out.reply).trim() + '\n\n' + quickCards.INTRO; out.choices = qc.concat([quickCards.MORE]); out.suggested = true;
        for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'assistant') { if (!conv.messages[i].tool_calls) conv.messages[i].content = out.reply; break; }
      }
    }
    if (out.reply !== undefined && !out.error && !(out.proposals || []).length && !(out.choices && out.choices.length)) { const w = choicesInWords(out.reply); const w2 = w.length ? w : (ctx.listChoices || []); if (w2.length) out.choices = w2; }
    if (out.reply !== undefined && !out.error && !(out.proposals || []).length && !(out.choices && out.choices.length) && !/\?/.test(String(out.reply).slice(-300))) { const c = nextChoices(ctx); if (c.length) { out.choices = c; out.suggested = true; } }
    return out;
  };
  // the everyday question, looked up before the model's first step (EVERYDAY) - only a fresh question (whichever model answers:
  // a round saved is several seconds on the owner's own service too - Oct 23 2026)
  // (never a command the box reads itself - its card is BOX FIRST's, below: "take bay 3 out of service, is everything working" was
  // answered with the health look-up and the bay never taken out - the review, Oct 25 2026)
  // (a command with a question after it - "take bay 3 out of service, is everything working" - is not the box's own: the model has the
  // whole, with the look-up beside it; the box put the bay's card up and the question was dropped - the review, Oct 27 2026)
  const boxReads = realModel() && !!ctx.newest && !secondAsk(ctx.newest) && (() => { let h = null; try { h = intents.match(ctx.newest, ctx); } catch { h = null; } return !!(h && (h.calls || h.ask)); })();
  // THE BOX'S OWN WORDS STEP ASIDE (the review, Oct 25 2026) - the look-up still goes to the model with all of the owner's words, as it
  // did before the box answered for itself: a change asked for ("set the tax rate to 7" was answered with the rates), a second question
  // ("whats booked tomorrow and whos working" lost the second), the setup's own question waiting ("we own rapidgolf.com is it working?"
  // was answered with the domain's look-up and the address never put in), a question about an account's walk step (the walk's to
  // answer, its way back after it), and keys just saved (the keys' own next step leads)
  const ownWords = () => realModel() && boxHands() && !intents.second(newestSaid) && !secondAsk(newestSaid) && !changeAsked(newestSaid) && !stepAsked
    && !(ctx.keysSavedNow || []).length && !(walking && walking.i >= 0 && aboutWalk(walking.svc, ctx.newest).about);
  // the box's own answer said: an account's walk the owner stepped away from is put aside, as the walk does itself ("set up Stripe" picks
  // it up at the same step - BOX FIRST is not held off by it after); the box's own question still waiting is closed when the owner walked
  // away from it, or asked again after the answer when the question was about it ("which tax rates do we charge?" to "Which tax goes
  // on ...?") - it was left open, and "turn off bay 3" two turns on was read as the wings' price (the review, Oct 25 2026)
  const ownSay = (text) => {
    if (walking) conv.walk = null;
    const aw = conv.awaiting && conv.awaiting[0] && conv.awaiting[0].asked ? conv.awaiting[0] : null;
    let reply = text, choices;
    if (aw && lastAsked(conv).includes(String(aw.question || '').trim()) && !walkedAway(newestSaid, aw.question, aw.choices)) { reply = text + '\n\n' + aw.question; if ((aw.choices || []).length) choices = aw.choices.slice(0, 6); }
    else if (aw) conv.awaiting = [];
    conv.messages.push({ role: 'assistant', content: reply }); ctx.ownAnswer = true;
    return done({ conversation: conv.id, reply, choices, proposals: [] });
  };
  if (ctx.fresh && !OPENED.test(newestSaid) && boxHands() && !boxReads) {
    let hits = EVERYDAY.filter(([re]) => re.test(newestSaid));
    // ("did taco tuesday work?" - a special by its own name, with no word "special" in it: the facility's own specials' names)
    if (!hits.length) {
      const t = String(newestSaid || '').toLowerCase(), sp = ((ctx.facilityNamesNow || {}).specials || []).find(n => n && n.length >= 4 && t.includes(String(n).toLowerCase()));
      if (sp && /\b(?:work(?:ed|ing|s)?|help(?:ed|ing)?|pay(?:ing)? off|paid off|bring|brought|pull(?:ed)?|do(?:ing)?|done|going)\b/.test(t) && /\?|\b(?:did|does|is|has|was|how)\b/.test(t)) hits = [[null, 'specials_effect_read', () => ({ special: sp })]];
    }
    const a = hits.length === 1 ? actions.BY_NAME.get(hits[0][1]) : null;
    if (a) {
      try {
        const args = actions.check(a.params, hits[0][2](ctx), ctx); ctx.everydayArgs = args;
        const out = await runRead(a, args, ctx), id = 'box_' + crypto.randomBytes(4).toString('hex');
        conv.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: a.name, arguments: JSON.stringify(args) } }] });
        conv.messages.push({ role: 'tool', tool_call_id: id, content: trim(out) });
        lookedUp = true; ctx.lookedUpFirst = [{ name: a.name, args }]; if (!(out && out.error) && screens.screenOf(a.name, args, ctx)) seen = { name: a.name, args };
        // WHAT THE OWNER ASKS MOST (services/study.js - maintainer, Oct 25 2026: "know what the facility owner asks most frequently so it can
        // answers quicker over time. Always real data never guessed"): each answer from the records counted - the cards asked most lead
        if (!(out && out.error)) { try { require('../study').noteAsk(a.name); } catch {} }
        // THE BOX ANSWERS IT ITSELF (answers.js - maintainer, Oct 25 2026: "run the commands you have been that dont even need AI just standard
        // things people ask ... we are building our own AI in a way just with hard code"): an everyday question the box looked up is
        // answered at once in the box's own words from what the read found - the model is not asked. A read with no words of the box's,
        // or one the owner cannot act on as it came back, goes to the model as before; the demo brain words its own.
        // (a second request in the same words - "who's playing now and turn off Bay 3" - goes to the model with what was looked up:
        // the box's own answer would say the first and drop the second)
        // (and the box's own words step aside where they would say only part of it, or over it - ownWords, above)
        const own = ownWords() ? answers.say(a.name, out) : null;
        if (own) { ctx.lookedUpFirst[0].out = out; return ownSay(own); }
      } catch (e) {
        // (a look-up that could not be made, in words the owner can act on - "the lookup could not be made just now ... try again in a
        // minute" - is said by the box, the look-up it tried on the record; one worded for the model goes to the model as before)
        // (only the look-up's own failure - its inputs were checked first: a check of them is worded for the model, never the owner -
        // "\"message\" is needed." reached an owner, test-assistant A42)
        const why = ctx.everydayArgs && e instanceof actions.ActionError ? answers.say(a.name, { error: String(e.message || '') }) : null;
        if (why && ownWords()) {
          ctx.lookedUpFirst = [{ name: a.name, args: ctx.everydayArgs, out: { error: String(e.message || '') } }];
          return ownSay(why);
        }
        /* the model looks for itself */
      }
    }
  }
  // the owner's answer to the box's own question (A BOX-ASKED CHOICE): one of its answers finishes the waiting change, with no
  // model round; anything else and the waiting changes are dropped - the owner has moved on
  let preset = null;
  // AN ACTION PREPARED OUTSIDE THE CHAT: the owner pasted a BA-CORE-ACTION line their own AI client (Claude Code, Codex)
  // prepared over the private SSH bridge. It is taken as one tool call - checked, built and put up as a card exactly like
  // any other - and nothing changes until the owner approves it.
  if (ctx.pastedAction) preset = { ok: true, text: '', toolCalls: [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: ctx.pastedAction.name, args: ctx.pastedAction.args }] };
  // the owner's answer to the box's own "do you already own it?" (applied, above): the box's own words, no model round
  if (conv.domainAsked && lastAsked(conv) === setupAnswers.DOMAIN_Q(conv.domainAsked)) {
    const d = conv.domainAsked, said = setupAnswers.domainOwned(ctx.newest);
    if (said) {
      conv.domainAsked = null;
      let reply = setupAnswers.DOMAIN_SAID[said](d);
      // (one bought already by someone else is said now, not at the end of the setup)
      if (said !== 'own') { try { const r = await ctx.call('GET', '/api/admin/getonline/domain?d=' + encodeURIComponent(d)); const j = (r && r.json) || {}; if (j.registered === true) reply += `\n\nOne thing to know: ${d} already shows as registered to someone. If you or someone at your business bought it, it is yours; if not, it may not be for sale - tell me a different name any time.`; } catch {} }
      else { try { const r = await ctx.call('GET', '/api/admin/getonline/domain?d=' + encodeURIComponent(d)); const j = (r && r.json) || {}; if (j.registered === false) reply += `\n\nOne thing to know: ${d} does not show as registered yet. If you bought it in the last day or so that is normal; otherwise check the spelling - tell me the right one any time.`; } catch {} }
      if (conv.guideOn) return guideNext(conv, ctx, reply);
      conv.messages.push({ role: 'assistant', content: reply });
      return done({ conversation: conv.id, reply, proposals: [] });
    }
    conv.domainAsked = null;   // (something else said: the owner moved on)
  }
  // THE SETUP GUIDE (setupguide.js). The chat opening while setup goes on: the box's own hello and the first step - no model round
  // (only on a box being set up by talking - the first screen's "Finish with my assistant": a facility running for months without,
  // say, texting is never met with "5 setup steps are left" each time it opens the chat; what it skipped is brought up once a day)
  const gcfg = cfgNow();
  if (OPENED.test(newestSaid) && Array.isArray(ctx.setup) && gcfg.setup && gcfg.setup.byAssistant === true) {
    const h = setupGuide.hello(ctx.setup, gcfg, { first: /first setup screen/.test(newestSaid), business: ctx.businessName, today: ctx.today, remindedOn: guideRemindedOn });
    if (h) {
      if (h.reminder) guideRemindedOn = ctx.today;
      // (an account's walk stopped part-way - Twilio's keys saved but its registration not finished, so no text goes out yet: said too)
      const open = [...walkAt.entries()].filter(([sv, i]) => i > 0 && i < setupGuide.walkSteps(sv).length - 1).map(([sv, i]) => `${setupGuide.WALK_NAME[sv]} (you stopped at step ${i + 1} of ${setupGuide.walkSteps(sv).length} - say "set up ${({ stripe: 'Stripe', resend: 'email', twilio: 'texting' })[sv]}" to pick up there)`);
      if (open.length && !/first setup screen/.test(newestSaid)) { const parts = h.text.split('\n\n'); parts.splice(1, 0, 'Not finished yet: ' + open.join('; ') + '.'); h.text = parts.join('\n\n'); }
      // (and what is waiting for the owner - a staff request, a warning, an update - said after the welcome, by name: the model's hello was
      // told the same; the whole of each is a question away)
      // (never in the very first hello: the health a brand-new box worked out before its first screen cannot date it yet, and read
      // "Nightly backup" to an owner who had owned the box for a minute - the walk-through, Oct 22 2026)
      if ((ctx.waiting || []).length && !/first setup screen/.test(newestSaid)) { const parts = h.text.split('\n\n'); parts.splice(1, 0, `Waiting for you: ${ctx.waiting.slice(0, 4).map(w => String(w).split(' - ')[0].replace(/[.\s]+$/, '')).join('; ')} - ask me about ${ctx.waiting.length === 1 ? 'it' : 'any of them'} any time.`); h.text = parts.join('\n\n'); }
      conv.guideOn = true; conv.guidePassed = conv.guidePassed || new Set();
      conv.guide = { id: h.step.id, item: itemFor(ctx.setup, h.step), text: h.step.ask(cfgNow()), taps: h.taps };
      return guideSay(conv, ctx, h.step, h.text, h.choices);
    }
  }
  // a key pasted for a payment, email or texting account: its other half asked for, or - all there - the next step
  const keysNow = conv.guideOn || conv.walk ? (ctx.keysSavedNow || []).filter(k => k && k.ok) : [];
  // (a key pasted that the settings refused - a restricted key, the wrong box's key: said plainly, the step still asked)
  const keysBad = conv.guideOn || conv.walk ? (ctx.keysSavedNow || []).filter(k => k && !k.ok) : [];
  if (keysBad.length && !keysNow.length && (conv.guide || conv.walk)) {
    const text = `That key was not saved - ${String(keysBad[0].error || 'the settings refused it').replace(/[.\s]+$/, '')}. Copy it again and paste it here, or say "skip" to do this later.`;
    if (conv.guide) conv.guide = Object.assign({}, conv.guide, { text, taps: { [setupGuide.SKIP]: 'skip' } });
    if (conv.walk) conv.walk = Object.assign({}, conv.walk, { text });
    conv.messages.push({ role: 'assistant', content: text });
    return { conversation: conv.id, reply: text, choices: [setupGuide.SKIP], proposals: [] };
  }
  if (keysNow.length) {
    const svc = keysNow.map(k => /stripe/i.test(k.say) ? 'stripe' : /resend/i.test(k.say) ? 'resend' : /twilio/i.test(k.say) ? 'twilio' : null).find(Boolean);
    const need = svc ? setupGuide.stillNeeds(svc, cfgNow()) : null;
    if (need) {
      if (need.ask) conv.awaiting = [{ name: need.ask.name, args: {}, param: need.ask.param, question: need.text, choices: [], parse: need.ask.parse, asked: true }];
      conv.messages.push({ role: 'assistant', content: need.text });
      return { conversation: conv.id, reply: need.text, proposals: [] };
    }
    const it = svc && (ctx.setup || []).find(i => i.id === svc);
    // (in a walk, the steps after the keys go on - a test payment, Twilio's registration - before the setup's next step)
    if (it && it.done && conv.walk && conv.walk.svc === svc) {
      const steps = setupGuide.walkSteps(svc), from = Math.max(conv.walk.i, setupGuide.keysDone(svc, steps)) + 1, said = `Saved - ${setupGuide.BY_ID.get(svc).connected}`;
      if (from < steps.length) return walkShow(conv, svc, from, said + ' Next:');
      conv.walk = null; walkAt.delete(svc);
      if (conv.guideOn) return guideNext(conv, ctx, said);
    }
    if (it && it.done && conv.guideOn) return guideNext(conv, ctx, `Saved - ${setupGuide.BY_ID.get(svc).connected || setupGuide.BY_ID.get(svc).name + ' is connected.'}`);
    // (saved, and still not working - one live key and one test key: the checklist's own words for what is wrong)
    if (it && !it.done && conv.guideOn && conv.guide) {
      const text = `Saved, but it is not working yet: ${String(it.label || '').replace(/[.\s]+$/, '')}.${it.sub ? ' ' + String(it.sub).replace(/[.\s]+$/, '') + '.' : ''} Paste the right one here, or say "skip" to do this later.`;
      conv.guide = Object.assign({}, conv.guide, { text, taps: { [setupGuide.SKIP]: 'skip' } });
      conv.messages.push({ role: 'assistant', content: text });
      return { conversation: conv.id, reply: text, choices: [setupGuide.SKIP], proposals: [] };
    }
  }
  // the owner's answer to the box's own setup question: a skip, a tapped answer, lost, or wanting the steps for an account - the box's
  // own; anything else is read as before (the setup answers, the model), and the step is asked again if nothing came of it
  // THE WALK: on, back, again, stuck, stop - its own words; a question is the model's, from the chapter, the step named beside it
  // (already connected, asked whether to go through it anyway)
  if (walking && walking.i === -1) {
    conv.walk = null;
    if (/^\s*(?:yes|yeah|yep|sure|ok(?:ay)?|yes,? walk me through it|walk me through it)\b/i.test(ctx.newest || '')) return walkShow(conv, walking.svc, 0);
    if (/^\s*(?:no|nope|nah|no thanks?)\b/i.test(ctx.newest || '')) { const text = 'All right.'; conv.messages.push({ role: 'assistant', content: text }); return { conversation: conv.id, reply: text, proposals: [] }; }
  }
  if (walking && walking.i >= 0 && !keysNow.length) {
    const wr = setupGuide.walkRead(ctx.newest), steps = setupGuide.walkSteps(walking.svc);
    if (wr === 'next') {
      if (walking.i + 1 < steps.length) {
        let off = false;
        if (/must be online|online and your site open/i.test(steps[walking.i + 1].text)) { try { const g = await ctx.call('GET', '/api/admin/getonline'); off = !(g && g.json && g.json.connected); } catch {} }
        return walkShow(conv, walking.svc, walking.i + 1, null, off);
      }
      conv.walk = null; walkAt.delete(walking.svc);
      const st = setupGuide.BY_ID.get(walking.svc), it = (ctx.setup || []).find(i => i.id === walking.svc);
      const end = it && !it.done ? `That is every step for ${setupGuide.WALK_NAME[walking.svc]}, but it is not connected yet - paste the key${walking.svc === 'twilio' ? 's' : ''} here when you have ${walking.svc === 'twilio' ? 'them' : 'it'}, or say "skip" for now.` : `That is all of it for ${setupGuide.WALK_NAME[walking.svc]}.`;
      if (conv.guideOn && (!it || it.done)) return guideNext(conv, ctx, end);
      if (conv.guide && st) conv.guide = Object.assign({}, conv.guide, { text: end });
      conv.messages.push({ role: 'assistant', content: end });
      return { conversation: conv.id, reply: end, choices: [setupGuide.SKIP], proposals: [] };
    }
    if (wr === 'back') return walkShow(conv, walking.svc, walking.i - 1);
    if (wr === 'again') return walkShow(conv, walking.svc, walking.i);
    if (wr === 'stuck') {
      const text = `No problem - tell me what you see on your screen, or what it is asking you for, and I will help you through it. (We are on ${setupGuide.WALK_NAME[walking.svc]} step ${walking.i + 1}: ${(steps[walking.i] || {}).title}.)`;
      conv.walk = Object.assign({}, walking, { text });
      conv.messages.push({ role: 'assistant', content: text });
      return { conversation: conv.id, reply: text, choices: [setupGuide.WALK_NEXT, 'Say the step again'], proposals: [] };
    }
    if (wr === 'skip') {
      conv.walk = null;
      if (conv.guideOn && conv.guide && conv.guide.id === walking.svc) { preset = { ok: true, toolCalls: [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: 'setup_skip', args: { item: conv.guide.item || walking.svc } }], text: '' }; (conv.guidePassed = conv.guidePassed || new Set()).add(walking.svc); }
      else { const text = `All right - we stopped at step ${walking.i + 1}. Say "set up ${setupGuide.WALK_NAME[walking.svc]}" any time and I will pick up right there.`; conv.messages.push({ role: 'assistant', content: text }); return { conversation: conv.id, reply: text, proposals: [] }; }
    } else if (!preset) {
      // a question the chapter's own Stuck? answers: that answer, word for word - the 4B named menus Stripe does not have
      const s0 = steps[walking.i] || {}, { sa, about: aboutStep } = aboutWalk(walking.svc, ctx.newest), last = walking.i >= steps.length - 1;
      if (sa && sa.strong) {
        const back = `When you are ready, tap "${last ? 'Done' : setupGuide.WALK_NEXT}" (${setupGuide.WALK_NAME[walking.svc]} step ${walking.i + 1} of ${steps.length}), or ask me something else.`;
        const text = sa.a + '\n\n' + back;
        conv.walk = Object.assign({}, walking, { text: back });
        conv.messages.push({ role: 'assistant', content: text });
        return { conversation: conv.id, reply: text, choices: [last ? 'Done' : setupGuide.WALK_NEXT, 'Say the step again', 'Skip for now'], proposals: [] };
      }
      // anything else about the step: the model, from the guide's chapter, with the step beside it (and the closest answer the chapter
      // has), and the walk goes on after it (done, below)
      // (only words about the step are the walk's - "who's playing tonight?" mid-walk is a new request: the walk steps aside, and "set up
      // Stripe" picks it up again at the same step; test-assistant, Oct 22 2026) - aboutWalk, above
      if (aboutStep) {
        // (the step rides with these words only, for this turn - never kept in the talk: the prompt's start stays the same turn after turn)
        ctx.turnNote = `(Setting up ${setupGuide.WALK_NAME[walking.svc]}, step ${walking.i + 1} of ${steps.length} - ${s0.title}: "${String(s0.text || '').slice(0, 700)}".${sa ? ` The guide's answer to a close question ("${sa.q}"): ${sa.a.slice(0, 500)}` : ''} Answer the owner's words about this step from the guide only, in plain words - never name a menu or a button the guide does not name.)`;
        ctx.walkAsked = walking;
      } else conv.walk = null;
    }
  }
  // "lets do the twilio", "set up stripe" - at any time: the walk, from where it was left or from the start
  if (!preset && !walking && !keysNow.length && !OPENED.test(newestSaid)) {
    const svc = setupGuide.walkAsked(ctx.newest);
    // (its key pasted in the same words - "Here is my Resend key re_... can you set up email?": never "step 1, sign up" - what it still
    // needs, or the steps after the keys)
    const keyFor = (k) => /stripe/i.test(k.say) ? 'stripe' : /resend/i.test(k.say) ? 'resend' : /twilio/i.test(k.say) ? 'twilio' : null;
    if (svc && (ctx.keysSavedNow || []).some(k => k && k.ok && keyFor(k) === svc) && setupGuide.walkSteps(svc).length) {
      const need = setupGuide.stillNeeds(svc, cfgNow()), steps = setupGuide.walkSteps(svc), at = setupGuide.keysDone(svc, steps);
      if (need) {
        if (need.ask) conv.awaiting = [{ name: need.ask.name, args: {}, param: need.ask.param, question: need.text, choices: [], parse: need.ask.parse, asked: true }];
        conv.walk = { svc, i: at, text: need.text }; walkAt.set(svc, at);
        conv.messages.push({ role: 'assistant', content: need.text });
        return { conversation: conv.id, reply: need.text, proposals: [] };
      }
      if (at + 1 < steps.length) return walkShow(conv, svc, at + 1, `Saved - ${setupGuide.BY_ID.get(svc).connected} Next:`);
    }
    if (svc && setupGuide.walkSteps(svc).length) {
      const it = (ctx.setup || []).find(i => i.id === svc);
      if (it && it.done) { const text = `${setupGuide.BY_ID.get(svc).connected} Want to go through the steps anyway?`; conv.walk = { svc, i: -1, text }; conv.messages.push({ role: 'assistant', content: text }); return { conversation: conv.id, reply: text, choices: ['Yes, walk me through it', 'No thanks'], proposals: [] }; }
      if (conv.guideOn && conv.guide && conv.guide.id !== svc && setupGuide.BY_ID.get(svc)) { const st = setupGuide.BY_ID.get(svc); conv.guide = { id: svc, item: (it || {}).id || svc, text: st.ask(cfgNow()), taps: setupGuide.question(st, cfgNow()).taps }; }
      const back = walkAt.has(svc) && walkAt.get(svc) > 0;
      return walkShow(conv, svc, back ? walkAt.get(svc) : 0, back ? `Picking up where we left off with ${setupGuide.WALK_NAME[svc]}.` : `Let's set up ${setupGuide.WALK_NAME[svc]} together, one step at a time. Tap "Done - next step" after each one, or ask me anything on the way.`);
    }
  }
  // (the steps put off, offered by name: one tapped is asked now, "not now" ends the setup talk until the next reminder)
  if (conv.guide && conv.guide.id === '__skipped' && lastAsked(conv).includes(conv.guide.text)) {
    const w = String(ctx.newest || '').toLowerCase().trim(), pick = (conv.guide.offer || []).find(o => w.includes(o.name.toLowerCase()) || (setupGuide.BY_ID.get(o.id).words || /$^/).test(w));
    if (pick) {
      const st = setupGuide.BY_ID.get(pick.id), q = setupGuide.question(st, cfgNow());
      conv.guide = { id: st.id, item: pick.item, text: st.ask(cfgNow()), taps: q.taps };
      return guideSay(conv, ctx, st, q.text, q.choices);
    }
    if (/^\s*(?:not now|no|nope|later|maybe later|no thanks?)\b/i.test(w)) {
      conv.guideOn = false; conv.guide = null;
      // (and what this facility can ask from here - quickcards.js, Oct 25 2026)
      const qc = quickCards.cards(shapeFor(ctx), ctx.cardsAsked, CARDS_SHOWN);
      const reply = 'No problem - I will remind you about those another day. ' + (qc.length ? 'From here, ask me anything about running ' + (ctx.businessName || 'your facility') + ' - a few to start are below.' : 'Tell me anything you want to do, or ask me anything.');
      conv.messages.push({ role: 'assistant', content: reply });
      return { conversation: conv.id, reply, choices: qc.length ? qc.concat([quickCards.MORE]) : ['What else can you do?', 'Is my site ready?'], proposals: [] };
    }
  }
  // (a picture added with the photo button while the logo is asked IS the logo - maintainer's try box, Oct 22 2026: "its asking over and over
  // for the picture"; it went to the website's photos and the logo was asked again each time)
  if (conv.guide && conv.guide.id === 'branding' && /^\(The owner added \d+ photos? for the website\b/.test(ctx.newest || '')) {
    const first = (String(ctx.newest).match(/photo 1 = (\/uploads\/landing\/[A-Za-z0-9][A-Za-z0-9._-]{0,150})/) || [])[1];
    if (first) preset = { ok: true, toolCalls: [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: 'logo_from_photo', args: { photo: first } }], text: '' };
  }
  // (a city said alone - "minneapolis" - the box asks its state, then puts the two up together)
  if (conv.guide && conv.guide.city && lastAsked(conv).includes(conv.guide.text)) {
    const cs = setupAnswers.cityState(`${conv.guide.city}, ${String(ctx.newest || '').trim()}`);
    if (cs) { preset = { ok: true, toolCalls: [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: 'location_set', args: cs }], text: '' }; conv.guide = Object.assign({}, conv.guide, { city: null }); }
  }
  if (!preset && conv.guide && conv.guide.id === 'citystate' && !keysNow.length && lastAsked(conv).includes(conv.guide.text) && !setupAnswers.cityState(ctx.newest)) {
    const city = setupGuide.loneCity(ctx.newest);
    if (city) {
      const text = `Which state is ${city} in? (like "MN")`;
      conv.guide = Object.assign({}, conv.guide, { text, city });
      conv.messages.push({ role: 'assistant', content: text });
      return { conversation: conv.id, reply: text, choices: [setupGuide.SKIP], proposals: [] };
    }
  }
  if (!preset && conv.guide && conv.guide.id !== '__skipped' && !keysNow.length && lastAsked(conv).includes(conv.guide.text)) {
    const step = setupGuide.BY_ID.get(conv.guide.id);
    let rd = step ? setupGuide.read(step, ctx.newest, cfgNow()) : null;
    // ("whats a waiver" while the staffed hours are asked - the 4B called a waiver "strongly recommended": the box's own words for that
    // step, then this step's question again)
    if (!rd && step) { const other = setupGuide.STEPS.find(o => o !== step && o.words && setupGuide.read(o, ctx.newest, cfgNow()) && setupGuide.read(o, ctx.newest, cfgNow()).kind === 'lost' && o.words.test(ctx.newest || '')); if (other) {
      const q = setupGuide.question(step, cfgNow()), text = other.why + '\n\n' + q.text;
      conv.messages.push({ role: 'assistant', content: text });
      return { conversation: conv.id, reply: text, choices: q.choices, proposals: [] };
    } }
    if (rd && (rd.kind === 'skip' || rd.kind === 'tap')) {
      const [name, args] = rd.kind === 'skip' ? ['setup_skip', { item: conv.guide.item || step.id }] : rd.call;
      preset = { ok: true, toolCalls: [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name, args }], text: '' };
      if (rd.kind === 'skip') { conv.guideSkipSay = step.skipSay || null; (conv.guidePassed = conv.guidePassed || new Set()).add(step.id); }
    } else if (rd && rd.kind === 'again') {
      const q = setupGuide.question(step, cfgNow());
      return guideSay(conv, ctx, step, (q.choices.length ? 'Tap one of the answers below, or tell me in your own words.' : 'Tell me in your own words, or say "skip" to do this later.') + '\n\n' + q.text, q.choices);
    } else if (rd && rd.kind === 'lost') {
      const q = setupGuide.lost(step, cfgNow());
      return guideSay(conv, ctx, step, q.text, q.choices);
    } else if (rd && (rd.kind === 'help' || rd.kind === 'have') && setupGuide.walkSteps(step.id).length) {
      // (an account: walked a step at a time from the guide - from the start, or from its keys for one already made)
      const ws = setupGuide.walkSteps(step.id);
      return walkShow(conv, step.id, rd.kind === 'have' ? setupGuide.keysStep(step.id, ws) : 0, rd.kind === 'have' ? 'Great - then it is just the keys.' : `Let's set it up together, one step at a time. Tap "Done - next step" after each one, or ask me anything on the way.`);
    } else if (rd && (rd.kind === 'help' || rd.kind === 'have')) {
      const st = setupGuide.steps(step, cfgNow(), rd.kind);
      conv.guide = Object.assign({}, conv.guide, { text: st.text, taps: st.taps });
      conv.messages.push({ role: 'assistant', content: st.text });
      return { conversation: conv.id, reply: st.text, choices: st.choices, proposals: [] };
    } else {
      ctx.guideStep = step;
      // (a question about an account before its walk - "how much does Stripe cost?" - the chapter's own answer, then the step again)
      const sa1 = setupGuide.walkSteps(step.id).length ? setupGuide.stuckAnswer(step.id, ctx.newest) : null;
      if (sa1 && sa1.strong) { const q = setupGuide.question(step, cfgNow()); return guideSay(conv, ctx, step, sa1.a + '\n\n' + q.text, q.choices); }
      // (an answer the setup answers read plainly, to the box's own question - "4 bays", "noon to 10 weekdays, 9am to midnight weekends",
      // "40 an hour, 50 after 5pm and weekends": put up with no model round, a few seconds sooner on the box's small model)
      // (the box's own hands: with them off for the scorer's model-alone run, the model answers the step - boxHands, Oct 25 2026)
      const sa0 = boxHands() ? setupAnswers.answer(lastAsked(conv), ctx.newest, (ctx.setup || []).map(i => i && i.skipped && !i.done ? Object.assign({}, i, { done: true }) : i), '', undefined) : null;
      if (sa0 && sa0[2] === 'asked' && sa0[0] !== 'say') {
        let calls = sa0[0] === 'multi' ? sa0[1] : [[sa0[0], sa0[1]]];
        if (sa0[0] === 'bays_list_set' && sa0[1].count) { if (!Array.isArray(ctx.bays)) ctx.bays = await actions.LOADERS.bays(ctx); calls = [['bays_list_set', { names: setupAnswers.bayNames(sa0[1].count, ctx.bays) }]]; }
        preset = { ok: true, toolCalls: calls.map(([name, args]) => ({ id: 'box_' + crypto.randomBytes(4).toString('hex'), name, args })), text: '' };
        ownClockOf(ctx, preset.toolCalls);
      }
      // (a short question about the step - "what does that cost" to the texting question was answered about booking deals, the 4B never
      // told which "that"): the step is named beside the owner's words
      if (asksSomething(ctx.newest) && String(ctx.newest).trim().split(/\s+/).length <= 10) {
        ctx.turnNote = `(Asked about this setup step - ${step.name}: "${conv.guide.text}")`;
        ctx.guideAbout = step.name;
      }
    }
  }
  if (!preset && conv.awaiting && conv.awaiting.length && conv.awaiting[0].asked) {
    const w = conv.awaiting[0];
    // a tapped answer (which may stand for a value: "No guests" is 0, "Join online" is true), else one read from the owner's words
    // (a phone, an email, an amount, a percent)
    // (only while the box's question is the last thing said - after an everyday answer or a screen opened since, the question is behind
    // the owner; and a number, a percent, a phone or a day read from their words is their answer only when the words say little else -
    // answerOnly: "turn off bay 3" to "What does Wings cost?" put the wings up at $3 and Bay 3 was never turned off - the review, Oct 25
    // 2026. A tap is always the answer)
    const open = lastAsked(conv).includes(String(w.question || '').trim());
    const tapped = open && (w.choices || []).length ? (choiceIn(w.choices, ctx.newest) || (w.param === '__public' ? publicSaid(w.choices, ctx.newest) : null)) : null;
    // ("which hours?": the one choice the typed words name by its start, its end, the part of the day or the order - ampmIn; words about
    // the hours that do not name one for certain are asked again, below - the review, Oct 27 2026)
    // ("tonight till close", "the evening one till close": the choice its part of the day names, running to that day's close; "till close"
    // with nothing that names a choice is asked again - Oct 28 2026, round 2e. And "an hour", "per hr", "half hour" typed to the money's own
    // "a half hour, or an hour?" are that choice - moneyUnit: they went to the model)
    let pick = null;
    if (tapped === null && open && w.parse === 'ampm') {
      const TILL_CLOSE = /\b(?:till|til|until|untill|to|thru|through)\s+(?:the\s+)?clos(?:e|ing)\b/i;
      if (TILL_CLOSE.test(ctx.newest || '') && Array.isArray(w.spans) && w.spans.length && !w.single) {
        if (ctx.hours === undefined) ctx.hours = await actions.LOADERS.hours(ctx);
        const k = ampmIn(String(ctx.newest).replace(TILL_CLOSE, ' '), w), close = actions.HELPERS.clockClose(ctx.hours, dayKeyOf((w.args || {}).date));
        pick = typeof k === 'number' && close !== null ? { range: [w.spans[k][0], actions.HELPERS.clockHm(close)] } : { again: true };
      } else pick = ampmIn(ctx.newest, w);
    } else if (tapped === null && open && w.parse === 'unit') pick = moneyUnit(ctx.newest);
    // (other hours than those offered, said one way - "9pm to 2am", "no just till midnight": the request in hand's own hours, put up as the
    // change can hold them - nightSpan; a price window past midnight cannot be one, and goes to the model - the review of round 2b, Oct 27 2026)
    // (Oct 27 2026: a price window the owner's correction would run past midnight is said so, and asked again - never the model's)
    let other = null, cannotHold = null;
    if (pick && pick.range) { const a0 = actions.BY_NAME.get(w.name); const ns = a0 && a0.evening ? nightSpan(a0, w.args || {}, pick.range, w.pair) : null; other = ns && ns.set ? ns.set : ns && ns.split ? { __split: ns.split } : null; cannotHold = ns && ns.cannot;
      // (an event has no evening of its own - its time is in its words: "7pm" typed to "Which time for Fall Scramble - 8 AM, or 8 PM?" was asked
      // again for ever. Those words at the owner's time - eventRetimed, Oct 28 2026, round 2f)
      if (!ns) other = eventRetimed(w, pick.range); }
    let read = tapped !== null ? (Array.isArray(w.values) ? w.values[w.choices.indexOf(tapped)] : tapped) : typeof pick === 'number' ? (w.values || [])[pick] : other ? other : open && w.parse && w.parse !== 'ampm' ? parseIn(w.parse, ctx.newest, w.question) : null;
    // (an event's one time, answered with its half and its end - "pm, until 11pm": that choice, the end on its words - Oct 28 2026, round 2g)
    if (typeof pick === 'number' && w.single && /^event_(?:add|edit)$/.test(String(w.name || '')) && read && typeof read === 'object' && Array.isArray(w.spans) && w.spans[pick]) {
      const key = Object.keys(read).find(k => k === 'description' || k === 'words'), end = key ? endBeside(ctx.newest, w.spans[pick][0]) : null, txt = end ? eventEnded(read[key], w.spans[pick][0], end) : null;
      if (txt) read = Object.assign({}, read, { [key]: txt });
    }
    // (and never a command the box reads itself - "turn bay 3 off", "hire Casey Ramos at 15 an hour": the box's own reading of a change,
    // read fresh with nothing before it, is a new request, not this answer - Oct 27 2026)
    const ownCommand = () => { let h = null; try { h = intents.match(ctx.newest, Object.assign({}, ctx, { lastCall: null })); } catch { h = null; } return !!(h && (h.calls || h.ask)); };
    // (the hours' answer has its own narrow reading - ampmIn reads only words about the hours; every other kind is answerOnly's)
    const value = read !== null && read !== undefined && (tapped !== null || ((w.parse === 'ampm' || (w.parse === 'unit' && typeof pick === 'number') || answerOnly(ctx.newest, w, (cfgNow().bays || []).map(b => b && b.name))) && !ownCommand())) ? read : null;
    // WORDS ABOUT THE HOURS THAT PICK NEITHER FOR CERTAIN ("pm" - both have a PM; "8 to 1"; "8pm to 1pm"; "actually 9 to 2" - 9 AM or 9 PM):
    // asked once more, the two still to tap - never one picked, never the opposite of what was said (the review, Oct 27 2026)
    // (THE BARE-HOUR RULE, Oct 27 2026 - the review of round 2c: these went to the model with the request in hand after the first re-ask,
    // and the model's own morning reading was put up unguarded - "burgers $2 off friday night 8 to 11", then "pm" twice, stored a special
    // 8 AM to 11 AM. The hours are never the model's: each such answer is asked once more in plain words, and a correction the change cannot
    // hold - a price window past midnight - says why)
    // (a choice the change cannot hold as one - a price window past midnight: said why, and asked again - Oct 27 2026)
    if (value && typeof value === 'object' && value.__cannot) {
      const why = String(value.__cannot), reply = `${why[0].toUpperCase() + why.slice(1)} - tap the other, or say hours that end by midnight. ${w.question}`;
      conv.messages.push({ role: 'assistant', content: reply }); ctx.ownAnswer = true;
      return done({ conversation: conv.id, reply, choices: w.choices, proposals: [] });
    }
    if ((value === null || value === undefined) && pick && (pick.again || pick.hand || (pick.range && !other)) && !ownCommand()) {
      w.reasked = (Number(w.reasked) || 0) + 1;
      const reply = (pick.range && cannotHold ? `${cannotHold[0].toUpperCase() + cannotHold.slice(1)} - tap one, or say hours that end by midnight. ` : `I could not tell which hours you meant - tap one, or say them with am or pm (like ${w.single ? '8pm' : '8pm to 1am'}). `) + w.question;
      conv.messages.push({ role: 'assistant', content: reply }); ctx.ownAnswer = true;
      return done({ conversation: conv.id, reply, choices: w.choices, proposals: [] });
    }
    if (value !== null && value !== undefined) {
      // (the evening of a shift past midnight is two shifts - nightSpan: one answer, both put up)
      const parts = w.param === '*' && value && Array.isArray(value.__split) ? value.__split : [null];
      const ids = parts.map(() => 'box_' + crypto.randomBytes(4).toString('hex'));
      conv.awaiting.shift(); ctx.answeredBox = true;
      preset = { ok: true, toolCalls: parts.map((part, i) => ({ id: ids[i], name: w.name, args: part ? Object.assign({}, w.args, part) : (w.param === '*' || w.param === '*days') && value && typeof value === 'object' ? Object.assign({}, w.args, value) : setPath(w.args, w.param, value) })), text: '', quickTry: !!w.quickTry };   // ('*': the hours asked, both ends at once - the bare-hour rule; '*days': a special's "Every Friday, or tonight only?", its days or its date - areas/menu.js, Oct 30 2026)
      // (the call the answer finishes keeps where it came from: the box's own 24-hour reading stays as read; anything else is read for
      // the evening like the model's own call, the request in hand - not the answer alone - saying whether the morning was meant)
      // (and the hours the owner picked from the box's own "which hours?" are the hours: never read for the evening, or asked, again -
      // clockSettled: the bare-hour rule and the actions' own fills leave them as picked, Oct 27 2026)
      for (const id of ids) {
        (ctx.answeredIds = ctx.answeredIds || new Set()).add(id); if (w.ownClock || w.parse === 'ampm') (ctx.ownClock = ctx.ownClock || new Set()).add(id);
        if (w.parse === 'ampm') (ctx.clockSettled = ctx.clockSettled || new Set()).add(id);
        if (w.heard) (ctx.answeredHeard = ctx.answeredHeard || new Map()).set(id, w.heard);
        (ctx.answeredParam = ctx.answeredParam || new Map()).set(id, w.param);
      }
      // what the owner answered, and for which change - an answer for the beers is not the food's (the menu's tax check)
      (conv.boxAnswers = conv.boxAnswers || []).push({ name: w.name, param: w.param, args: w.args, value, said: String(ctx.newest || '') });
    } else {
      // THE OWNER MOVED ON (Oct 22 2026, the 4B on the laptop: asked the Food tax's rate, told "book 2 hours on Tuesdays and the last
      // 30 minutes are free", it put the menu change up again and the box asked the rate again) - the model is told plainly
      // (Oct 24 2026: by what the words read as, not their length - "what's booked tomorrow?" is three words, and the old rule left
      // the model untold; the change it was waiting for is not put up again in the same breath - below)
      // (a number read but not taken - "12, put it under Food" - is told as walked away only when it was: the model reads it with the
      // question beside it)
      // (an answer about the hours asked never reaches here - it is asked again, above: the bare-hour rule, Oct 27 2026)
      if (walkedAway(ctx.newest, w.question, w.choices) || ((read === null || read === undefined) && String(ctx.newest || '').trim().split(/\s+/).length > 3)) { ctx.movedOn = w.question; ctx.movedOnFrom = w.name; }
      conv.awaiting = [];
    }
  }
  // the MODEL'S own question with answers to tap, walked away from: the model is told the words may not answer it (it reads them)
  if (!preset && !ctx.movedOn) { const q = lastAskOwner(conv); if (q && q.choices.length && choiceIn(q.choices, ctx.newest) === null && walkedAway(ctx.newest, q.question, q.choices)) ctx.movedOnModel = q.question; }
  // "WHAT CAN YOU DO?" ANSWERED BY THE BOX (quickcards.js - maintainer, Oct 25 2026: "So they know what they can do, and it pertains to that
  // facility. And how they run"): the things this facility can ask and have done, with its cards to tap - the model listed every
  // part of the box, the counter menu and the staff schedule to a club with neither
  // (only on a real model: the demo brain's own menu says what IT understands - a sandbox visitor offered the box's whole list would
  // be told "I did not catch that" - test-demo-model D4)
  // (and with the box's hands off for the scorer's model-alone run, the model's own - boxHands, Oct 25 2026)
  if (!preset && realModel() && boxHands() && quickCards.ASK_CAN_DO.test(ctx.newest || '')) {
    const qc = quickNow(ctx, CARDS_SHOWN), reply = quickCards.canDo(shapeFor(ctx), qc.length > 0);
    conv.messages.push({ role: 'assistant', content: reply }); ctx.ownAnswer = true;   // (the box's own list - never "From your guide" beside it)
    return done({ conversation: conv.id, reply, choices: qc.length ? qc : undefined, proposals: [] });
  }
  // BOX FIRST (intents.js - maintainer, Oct 25 2026: "we are building our own AI in a way just with hard code"; "we need 95% accuracy before
  // we deploy ... Or ask what did you mean? If it didn't fully understand and it has a cpl options"): the owner's plain command read by
  // the box BEFORE the model - one reading is put up at once, the same card the model's call would make through the same checks (the
  // owner still says yes to anything about money, doors, hours or staff); two or three readings, or a bay that is not plain, are asked
  // ("Did you mean ...?", each to tap); none goes to the model. Then the actions' own readers of their plainest words, the same way.
  // (the box's own model or the owner's own service - the demo brain reads its own menu; never over a setup step the box is asking)
  const guideWaiting = conv.guideOn && conv.guide && lastAsked(conv).includes(conv.guide.text);
  // (held off by an account's walk only while its step is the last thing said and the walk still goes on - a walk the owner stepped
  // away from held the box's own reading off for the rest of the talk; "set up Stripe" picks it up again - the review, Oct 25 2026)
  if (!preset && realModel() && boxHands() && ctx.newest && !guideWaiting && !(conv.awaiting && conv.awaiting.length) && !(walking && conv.walk)) {
    // (a "did you mean" the box asked, answered with a tap: that one)
    // THE BOX'S OWN "WHICH TIME?" ANSWERED IN WORDS (Oct 28 2026, round 2e - the review of round 2d: "The Scramble at 8 in the morning, or 8
    // at night?" typed "8pm", "night", "pm", "the second one" or "at night" went to the model, and a model that wrote 8 AM had its event put up
    // at once on the public Events page; only the very words of a choice were read). The typed answer is read by the hours' own reader
    // (ampmIn) against the times the choices stand for: the one it names is taken as if tapped; words about the time that name neither are
    // asked again, in plain words - never handed to the model. Anything else is a new request, as before
    let clockTyped = null, clockEnd = null;
    const isCmd = () => { let h = null; try { h = intents.match(ctx.newest, Object.assign({}, ctx, { lastCall: null })); } catch { h = null; } return !!(h && (h.calls || h.ask)); };
    const atOf = (x) => { const m = /\bat\s+(\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)|noon|midnight)\b/i.exec(String(x || '')); const t = m ? actions.HELPERS.normTime(m[1]) : null; return t; };
    if (conv.clockAsk && lastAsked(conv) === conv.clockAsk.question) {
      const q = conv.clockAsk; conv.clockAsk = null;
      if (!q.choices.some(ch => ch.toLowerCase() === String(ctx.newest).trim().toLowerCase())) {
        const spans = q.choices.map(ch => { const t = atOf(ch); return t ? [t, t] : null; });
        const k = spans.every(Boolean) ? ampmIn(ctx.newest, { spans, choices: q.choices, question: q.question }) : null;
        // (the choice named is the owner's words for the request now, as if tapped: the guards read it, not the request with its bare hour)
        // A NEW TIME IS THE OWNER'S CORRECTION, NEVER A LOOP (Oct 28 2026, round 2f - the critic of round 2e: "7pm", "actually 7pm", "make it
        // 7pm", "8:30pm", "its 7 at night" typed to "The Halloween Scramble at 8 in the morning, or 8 at night?" were answered "I could not tell
        // which you meant - ... say it with am or pm (like 8pm)" - asking for exactly what they typed - and the event or the booking could not be
        // made at all). One time, its half said, that is neither choice: the request as the choices put it, at that time - read by the box again
        // like a tap (its own checks, its card or its own question after)
        const one = k && typeof k === 'object' && k.range && k.range[0] === k.range[1] ? k.range[0] : null;
        if (one) {
          const [hh, mm] = one.split(':').map(Number), said = `${hh % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${hh < 12 ? 'am' : 'pm'}`;
          const fixed = String(q.choices[0]).replace(/\bat\s+(?:\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)|noon|midnight)\b/i, 'at ' + said);
          if (fixed !== q.choices[0] && atOf(fixed) === one) clockTyped = fixed;
        }
        if (clockTyped) ctx.inHand = { text: clockTyped, days: clockTyped, turns: [{ said: clockTyped, hoursAnswer: false }] };
        else if (typeof k === 'number') { clockTyped = q.choices[k]; ctx.inHand = { text: clockTyped, days: clockTyped, turns: [{ said: clockTyped, hoursAnswer: false }] };
          // (the end said beside the half - "pm, until 11pm" - goes on the event's words: Oct 28 2026, round 2g)
          const st = atOf(clockTyped), end = st ? endBeside(ctx.newest, st) : null; if (end) clockEnd = { start: st, end }; }
        else if (k && (k.again || k.hand || k.range) && !isCmd()) {
          const reply = `I could not tell which you meant - tap one, or say it with am or pm (like 8pm). ${q.question}`;
          conv.clockAsk = Object.assign({}, q, { question: reply });   // (the question asked again is still the one its taps answer)
          conv.messages.push({ role: 'assistant', content: reply }); ctx.ownAnswer = true;
          return done({ conversation: conv.id, reply, choices: q.choices, proposals: [] });
        }
      }
    }
    if (conv.intentAsk && lastAsked(conv) === conv.intentAsk.question) {
      let i = conv.intentAsk.labels.findIndex(l => l.toLowerCase() === String(ctx.newest).trim().toLowerCase());
      // (a reading of a time - the quote's "6 AM" or "6 PM": the typed "6pm", "evening", "the second one" read the same way)
      if (i < 0 && conv.intentAsk.calls.length === 2 && conv.intentAsk.calls.every(c => /^\d{2}:\d{2}$/.test(String((c.args || {}).time || '')))) {
        const k = ampmIn(ctx.newest, { spans: conv.intentAsk.calls.map(c => [c.args.time, c.args.time]), choices: conv.intentAsk.labels, question: conv.intentAsk.question });
        if (typeof k === 'number') i = k;
        // (one time with its half said that is neither choice - "7pm" to "6 AM, or 6 PM?" - is the owner's correction: that time, never asked
        // again - Oct 28 2026, round 2f)
        else if (k && k.range && k.range[0] === k.range[1] && /^\d{2}:\d{2}$/.test(k.range[0])) { conv.intentAsk = Object.assign({}, conv.intentAsk, { calls: [Object.assign({}, conv.intentAsk.calls[0], { args: Object.assign({}, conv.intentAsk.calls[0].args, { time: k.range[0] }) })].concat(conv.intentAsk.calls) }); i = 0; }
        else if (k && (k.again || k.hand || k.range) && !isCmd()) {
          const reply = `I could not tell which you meant - tap one, or say it with am or pm (like 8pm). ${conv.intentAsk.question}`;
          conv.messages.push({ role: 'assistant', content: reply }); ctx.ownAnswer = true;
          // (the question asked again is still the one its taps answer)
          conv.intentAsk = Object.assign({}, conv.intentAsk, { question: reply });
          return done({ conversation: conv.id, reply, choices: conv.intentAsk.labels, proposals: [] });
        }
      }
      const c = i >= 0 ? conv.intentAsk.calls[i] : null;
      conv.intentAsk = null;
      if (c) { const id = 'box_' + crypto.randomBytes(4).toString('hex'); preset = { ok: true, toolCalls: [{ id, name: c.name, args: c.args }], text: '' }; (conv.boxFirst = conv.boxFirst || new Set()).add(id); ctx.boxFirstRound = true; ctx.boxCalled = [c]; }
    }
    if (!preset) {
      // (never the first half of a command with a question after it - boxReads, above: the model has the whole)
      // (the facility's hours first: the box's own readings of a time - an event's "at 8", a booking's "at 10", "and at 6?" after a quote -
      // read the bare-hour rule with them, as every change's guard does; until Oct 27 2026 they were loaded only for the model's calls)
      if (ctx.hours === undefined) ctx.hours = await actions.LOADERS.hours(ctx);
      const said = clockTyped || ctx.newest;
      const hit = !clockTyped && secondAsk(ctx.newest) ? null : intents.match(said, ctx);
      if (clockEnd && hit && Array.isArray(hit.calls)) for (const c of hit.calls) if (c && c.name === 'event_add' && c.args) { const txt = eventEnded(c.args.description, clockEnd.start, clockEnd.end); if (txt) c.args = Object.assign({}, c.args, { description: txt }); }
      if (hit && hit.say) { conv.messages.push({ role: 'assistant', content: hit.say }); ctx.ownAnswer = true; return done({ conversation: conv.id, reply: hit.say, proposals: [] }); }
      if (hit && hit.ask && hit.ask.choices) {
        // (a question about the time - "... at 8 in the morning, or 8 at night?", "... at noon, or at midnight?": its typed answer is read next turn)
        if (/\bin the morning, or\b[^?]*\bat night\?$|\bat noon, or at midnight\?$|\bin the afternoon, or\b[^?]*\bafter midnight\?$/.test(hit.ask.question) && hit.ask.choices.length === 2) conv.clockAsk = { question: hit.ask.question, choices: hit.ask.choices };
        conv.messages.push({ role: 'assistant', content: hit.ask.question }); return done({ conversation: conv.id, reply: hit.ask.question, choices: hit.ask.choices, proposals: [] });
      }
      if (hit && hit.ask && hit.ask.calls) {
        const labels = [];
        // (a reading's own label when it has one - "6 AM" / "6 PM" for a quote's time, which has no card words: the bare-hour rule, Oct 27 2026)
        for (const [ci, c] of hit.ask.calls.entries()) { const a = actions.BY_NAME.get(c.name); for (const need of (a && a.needs) || []) if (ctx[need] === undefined || ctx[need] === null) { const load = actions.LOADERS[need]; if (load) ctx[need] = await load(ctx); } let w = ''; try { w = (hit.ask.labels && hit.ask.labels[ci]) || a.describe(c.args, ctx); } catch {} labels.push(String(w || c.name).slice(0, 90)); }
        conv.intentAsk = { question: hit.ask.question, labels, calls: hit.ask.calls };
        conv.messages.push({ role: 'assistant', content: hit.ask.question });
        return done({ conversation: conv.id, reply: hit.ask.question, choices: labels, proposals: [] });
      }
      if (hit && hit.calls) {
        const toolCalls = hit.calls.map(c => ({ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: c.name, args: c.args }));
        preset = { ok: true, toolCalls, text: '' }; conv.boxFirst = conv.boxFirst || new Set(); toolCalls.forEach(c => conv.boxFirst.add(c.id)); ctx.boxFirstRound = true; ctx.boxCalled = hit.calls;
      }
      // (the actions' own readers of their plainest words - a deal, a code, a peak price, a special, the hours, a flyer ... - read first
      // too: until now they were the box's call only after a model round that made nothing)
      // (and never part of two requests: "lets do the last 30 minutes free on tuesdays and turn off Bay 3" put up the deal alone and the
      // second request was never done - the model has the whole, as intents.match leaves it)
      if (!hit && !ctx.askedQuestion && !twoParts(ctx.newest)) {
        const got = [];
        for (const n of BOX_READERS) {
          const a = actions.BY_NAME.get(n); if (!a || !a.read) continue;
          for (const need of a.needs || []) if (ctx[need] === undefined || ctx[need] === null) { const load = actions.LOADERS[need]; if (load) ctx[need] = await load(ctx); }
          let args = null; try { args = a.read(ctx.newest, conv, ctx); } catch { args = null; }
          if (args) got.push({ name: n, args });
        }
        if (got.length === 1) { const id = 'box_' + crypto.randomBytes(4).toString('hex'); preset = { ok: true, toolCalls: [{ id, name: got[0].name, args: got[0].args }], text: '' }; ctx.boxRead = new Set([got[0].name]); ctx.tookAnswer = got[0].name; (conv.boxFirst = conv.boxFirst || new Set()).add(id); ctx.boxFirstRound = true; ctx.boxCalled = got; }
      }
    }
  }
  for (let round = 0; round < MAX_ROUNDS; round++) {
    ctx.listChoices = null;
    const mark = conv.messages.length, before = new Set(conv.pending.keys());
    // (this round's calls the box made itself - its own reading of the owner's words, a tap, a setup answer, an answer to its own question
    // about a call that was not the quick model's: not the quick model's try, so a card of them that needs a yes is put up as on one
    // model, never taken back - the review, Oct 25 2026: on the 4B + 8B pair every such card was thrown away and the 8B asked)
    let boxRound = false;
    // (a round taken back is not what the owner saw: the box's reading of it is not credited - the scorer reads boxCalled)
    const takeOver = () => { conv.messages.length = mark; for (const id of [...conv.pending.keys()]) if (!before.has(id)) conv.pending.delete(id); role = 'main'; tookOver = true; round--; seen = null; if (boxRound) ctx.boxCalled = null; };
    let kept = conv.messages.slice(-MAX_MESSAGES);
    // a long conversation is cut at an owner's words, never inside a tool call and its answer (OpenAI and Claude both
    // refuse a tool result whose call was cut off)
    const firstSaid = kept.findIndex(m => m.role === 'user'); if (firstSaid > 0) kept = kept.slice(firstSaid);
    let last = -1; for (let i = kept.length - 1; i >= 0; i--) if (kept[i].role === 'user') { last = i; break; }
    const handed = areasFor(conv, ctx); if (handed) conv.handed = handed;
    // THE OWNER'S OWN PARTS OF THE MENU, AS THEY ARE NOW (maintainer, Oct 22 2026: "the AI needs to look at all new sections when it can
    // and know that hats was added to the pos menu system"): read whenever the menu's tools are handed, and named in the brief
    if (handed && [...handed].includes('menu') && (ctx.menu === undefined || ctx.menu === null)) { try { ctx.menu = await actions.LOADERS.menu(ctx); } catch {} }
    const messages = [{ role: 'system', content: rules(ctx) }].concat(kept.map((m, i) => i === last ? { role: 'user', content: now(ctx, guide) + '\n\nThe owner says: ' + (ctx.turnNote ? ctx.turnNote + ' ' : '') + m.content } : m));
    // the last round may not call a tool: it answers in words with what it has (a small model asked for "one more look"
    // forever otherwise; another project ends its tool loop the same way)
    const fit = fitPrompt(messages, handed, ctx, conv);
    const r = preset || await model.chat({ messages: fit.messages, tools: fit.tools, role, toolChoice: round >= MAX_ROUNDS - 1 ? 'none' : 'auto' });
    if (preset) { boxRound = !preset.quickTry; preset = null; ctx.setupAnswered = 'choice'; }
    // the model server said the prompt was too big for it: the same step again with less handed (twice at most)
    if (!r.ok && /exceeds the available context|context (?:length|size|window)/i.test(String(r.error || '')) && (ctx.overflowed || 0) < 2) { ctx.overflowed = (ctx.overflowed || 0) + 1; round--; continue; }
    if (!r.ok) { if (role === 'quick') { takeOver(); continue; } return done({ conversation: conv.id, error: r.error, unreachable: !!r.unreachable, proposals: [] }); }
    if (r.fellBack) fellBack = r.fellBack;
    answeredBy = { provider: r.provider, model: r.model };
    // the model's own words read plainly for every check below (its curly apostrophes - "We\u2019ll set", "I\u2019ve updated" - slipped
    // past every "I'll" and "I've" until Oct 22 2026, the customer's day one)
    if (typeof r.text === 'string') r.text = r.text.replace(/[\u2018\u2019\u02bc]/g, "'");
    if (role !== 'quick' && !r.toolCalls.length && callInWords(r.text)) { const w = callsInWords(r.text); if (w.calls.length) { r.toolCalls = w.calls; r.text = w.text; } }   // the quick one's is the main model's to take over
    if (role === 'quick' && !r.toolCalls.length && callInWords(r.text)) { takeOver(); continue; }
    // THE OWNER'S PLAIN ANSWER TO THE BOX'S OWN SETUP QUESTION (Oct 22 2026, the customer's day one - setupanswers.js): asked for
    // the city, told "Omaha, Nebraska", the model answered "City and state set to Omaha, Nebraska" with nothing called. With no
    // change made in the turn, the box puts the change up itself from the owner's own words - before any nudge, so one round. And a
    // short answer to the box's own question that the model put up as another change ("25 per half hour" as the booking rules'
    // card) is put up as what was asked
    const writes = r.toolCalls.filter(c => { const x = actions.BY_NAME.get(c.name); return x && x.kind === 'write'; });
    // (once a turn: a lookup it ran - a domain named - is the model's to explain in the next round)
    ctx.tookAnswer = null;
    // (the box's readings after a model's round below are the box's own hands too: with them off for the scorer's model-alone run, what
    // the model made stands - boxHands; they replaced the model's call and the "model alone" score counted them - the review, Oct 25 2026)
    if (boxHands() && !ctx.setupAnswered && !proposedAny && !ctx.appliedSomething && !ctx.askedQuestion && ctx.newest && (!r.toolCalls.length || writes.length === r.toolCalls.length)) {
      // (how the facility runs, said while setup goes on, is read against what the first screen set - only when said)
      if (setupAnswers.access(ctx.newest) && ctx.current === undefined) { try { const g = await ctx.call('GET', '/api/admin/config'); const b = (g.json && g.json.booking) || {}; ctx.current = { accessStyle: String(b.accessStyle || (b.staffedAccess ? 'staffed' : 'unmanned')).toLowerCase() }; } catch { ctx.current = null; } }
      // (a step the owner put off is not answered by a stray "no" - the walk-through on the 4B: "no" to the waiver question was read as
      // "no website yet")
      let sa = setupAnswers.answer(lastAsked(conv), ctx.newest, (ctx.setup || []).map(i => i && i.skipped && !i.done ? Object.assign({}, i, { done: true }) : i), r.text, ctx.current);
      // ("24/7" on a facility already open 24 hours is the hours confirmed, not a change it would refuse)
      if (sa && sa[0] === 'open_24_hours_set' && ((cfgNow().booking || {}).open24Hours)) sa = ['setup_confirm', { item: 'hours' }].concat(sa.slice(2));
      // (never a different change after one of the model's own was tried this turn: The Vault's price card refused - "already has
      // that" - and the model's words about it after were read as the base price, put up instead; the owner meant The Vault. A
      // lookup still may be: a domain the owner owns is looked up when the model's website_address_set was refused)
      if (sa && ctx.triedWrite && (sa[0] === 'say' || (actions.BY_NAME.get(sa[0]) || {}).kind === 'write')) sa = null;
      // (a card the model put up stands when it is that change, or - for words not asked for by the box - one of the changes that
      // could rightly take the same words)
      if (sa && r.toolCalls.length && sa[0] !== 'multi' && (sa[0] === 'say' || writes.some(c => c.name === sa[0]) || (sa[2] !== 'asked' && writes.some(c => sa[3] && sa[3].test(c.name))))) sa = null;
      // (a longer request the model put up a change for is the model's - unless the box read several prices in it plainly: "40 an
      // hour, 50 an hour after 5pm and weekends" was put up as booking rules nobody said - the walk-through on the 4B, Oct 22 2026)
      if (sa && r.toolCalls.length && sa[0] !== 'multi' && String(ctx.newest).trim().split(/\s+/).length > 8) sa = null;
      // (an answer that changes nothing - "we don't have a domain yet" - is the box's own words, and that step is not offered next)
      if (sa) ctx.setupAnswered = sa[0];
      if (sa && sa[0] === 'say') { r.text = sa[1]; ctx.tookAnswer = 'say'; ctx.deferred = 'domain'; }
      else if (sa && sa[0] === 'multi') { r.toolCalls = sa[1].map(([name, args]) => ({ id: 'box_' + crypto.randomBytes(4).toString('hex'), name, args })); r.text = ''; ctx.tookAnswer = 'multi'; boxRound = true; ownClockOf(ctx, r.toolCalls); }
      else if (sa) {
        if (sa[0] === 'bays_list_set' && sa[1].count) { if (!Array.isArray(ctx.bays)) ctx.bays = await actions.LOADERS.bays(ctx); sa[1] = { names: setupAnswers.bayNames(sa[1].count, ctx.bays) }; }
        r.toolCalls = [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: sa[0], args: sa[1] }]; r.text = ''; ctx.tookAnswer = sa[0]; boxRound = true; ownClockOf(ctx, r.toolCalls);
      }
    }
    // (a price and its peak prices said at once, setup or not - "make it 40 an hour, 50 after 5pm and weekends": the box's plain reading
    // over the model's card of something else)
    // (and never the first of two requests - the box-first stage's own rule, below: Oct 27 2026)
    if (boxHands() && !ctx.setupAnswered && !proposedAny && !ctx.appliedSomething && !ctx.askedQuestion && ctx.newest && !ctx.tookAnswer && !twoParts(ctx.newest) && !r.toolCalls.some(c => c.name === 'price_window_add' || c.name === 'base_price_set')) {
      const m = setupAnswers.prices(ctx.newest);
      if (m) { r.toolCalls = [['base_price_set', m.base]].concat(m.windows.map(x => ['price_window_add', x])).map(([name, args]) => ({ id: 'box_' + crypto.randomBytes(4).toString('hex'), name, args })); r.text = ''; ctx.tookAnswer = 'multi'; ctx.setupAnswered = 'multi'; boxRound = true; ownClockOf(ctx, r.toolCalls); }
    }
    // A DEAL OR A FLYER SAID PLAINLY, AND NOTHING MADE (Oct 22 2026, late night; the walks on the 4B: "lets do buy an hour get an hour on
    // tuesdays" and "now a flyer for the birthday package" were answered in words - what it would make, or "outside the tools available"):
    // an action's own reading of the owner's plainest words (its read) is the box's call, put up as the card the owner approves
    // (and over a different tool the model reached for: "now a flyer for the birthday package" was put up as the package again, its
    // price asked - the walk on the 4B; the model's own call to that same change stands, its words read by the action's fill)
    const SAME = { deal_set: ['deal_set'], flyer_make: ['flyer_make', 'special_flyer'], discount_code_create: ['discount_code_create'], price_window_add: ['price_window_add', 'price_window_change'], counter_special_set: ['counter_special_set'], opening_hours_set: ['opening_hours_set'], website_menu_set: ['website_menu_set'], website_social_set: ['website_social_set'] , door_code_timing_set: ['door_code_timing_set'], routine_teach: ['routine_teach'], routine_create: ['routine_create', 'routine_save'], device_pair: ['device_pair'] };
    // (never part of two requests, as in the box-first stage before the model: "happy hour weekdays 2 to 5 is $15 a half hour and turn off
    // the lights in Bay 3" - the model answered in words, or put up the lights, and the box's reading of the first half was put up over it;
    // the second request was never done - test-assistant-eval E9b, Oct 27 2026)
    if (boxHands() && !ctx.setupAnswered && !proposedAny && !ctx.appliedSomething && !ctx.askedQuestion && ctx.newest && !ctx.tookAnswer && !twoParts(ctx.newest)) {
      // (once a turn each: the ideas looked up, the model's answer about them was read again as the same ask and the ideas looked up
      // again, round after round, until "I could not finish that in a few steps" - the walk on the 4B, Oct 22 2026, late night)
      ctx.boxRead = ctx.boxRead || new Set();
      // (Oct 23 2026, the 4B three times over each: door code timing said plainly, "watch what I do on Bay 1", "close GSPro on Bay 1
      // when each session ends")
      for (const n of ['flyer_make', 'deal_set', 'discount_code_create', 'price_window_add', 'counter_special_set', 'opening_hours_set', 'website_menu_set', 'website_social_set', 'door_code_timing_set', 'routine_teach', 'routine_create', 'device_pair']) {
        // (a lookup the model made first is its own way there - the demo brain reads the homepage's specials before their flyer; only a
        // different CHANGE is replaced)
        if (ctx.boxRead.has(n) || r.toolCalls.some(c => SAME[n].includes(c.name)) || r.toolCalls.some(c => { const x = actions.BY_NAME.get(c.name); return !x || x.kind !== 'write'; })) continue;
        const a = actions.BY_NAME.get(n); if (!a || !a.read) continue;
        for (const need of a.needs || []) if (ctx[need] === undefined || ctx[need] === null) { const load = actions.LOADERS[need]; if (load) ctx[need] = await load(ctx); }
        let args = null; try { args = a.read(ctx.newest, conv, ctx); } catch { args = null; }
        // (a cloud model's own blocks named its own calls - they go with them)
        if (args) { ctx.boxRead.add(n); r.toolCalls = [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: n, args }]; r.text = ''; r.raw = undefined; ctx.tookAnswer = n; boxRound = true; break; }
      }
    }
    if (r.toolCalls.some(c => { const x = actions.BY_NAME.get(c.name); return x && x.kind === 'write'; })) ctx.triedWrite = true;
    // "DONE - testing.com is on Cloudflare ..." AFTER A LOOKUP (Oct 22 2026, maintainer on his try box: the domain he owns looked up, the 4B began
    // its report with the box's own "Done -", that was read as a change claimed and he was told "I have not changed that yet"): the box's
    // word for a made change, copied by the model over what it looked up, is taken off and the rest is read as it stands
    if (!r.toolCalls.length && lookedUp && !ctx.appliedSomething && !proposedAny) r.text = String(r.text || '').replace(/^\s*(?:\*\*)?done(?:\*\*)?\s*[-\u2013\u2014:!]\s*/i, '');
    // told to look it up and still answering from nothing: the owner is told so, never handed made-up facts
    if (!r.toolCalls.length && ctx.nudged && /as it is now/.test(ctx.nudged) && !lookedUp) { r.text = 'I could not look that up just now - ask me again, or open the screen for it.'; ctx.couldNot = true; }
    // told once (whatever for) and still claiming a change, or saying it will make one, with nothing done: the owner reads the
    // truth, never the claim
    if (!r.toolCalls.length && ctx.nudged && !/compliant/.test(ctx.nudged) && !ctx.appliedSomething && !proposedAny && !ctx.askedQuestion && (CLAIMS_DONE.test(r.text || '') || WILL_DO.test(r.text || ''))) (ctx.couldNot = true, r.text = conv.guideOn ? 'Sorry - I did not catch that, so nothing has changed yet.' : 'I have not changed that yet - nothing was changed. Say it as a request (like "make waivers required" or "set the price to $30 an hour") and I will put it in front of you.');
    // rule 15 first of all, and whatever else was said before: never shown, asked again once, then a plain line
    const legal = (t) => LEGAL_CLAIM.test(t || '') || WRITES_LEGAL(t || '');
    if (!r.toolCalls.length && legal(r.text) && !ctx.legalNudged && round < MAX_ROUNDS - 1) {
      ctx.legalNudged = true; ctx.nudged = 'Your last answer called something compliant, legal or enforceable, or offered to write or find a waiver or a policy. This software never says that, never cites a law, and never supplies legal wording or a template: the waiver and the policies are the owner\'s own documents, from their own lawyer. Answer again without it.';
      conv.messages.length = mark; seen = null; continue;
    }
    if (!r.toolCalls.length && ASKS_SECRET.test(r.text || '') && !ctx.secretNudged && round < MAX_ROUNDS - 1) {
      ctx.secretNudged = true; ctx.nudged = 'Your last answer asked the owner to type a password, passphrase, key or PIN to you. Never: the backup passphrase is backup_passphrase_set (the chat shows a masked box), a service\'s key is pasted on its own into the chat box (the page saves it), and a lock or member PIN stays on its own screen. Call the tool, or say where it goes.';
      conv.messages.length = mark; seen = null; continue;
    }
    if (!r.toolCalls.length && ASKS_SECRET.test(r.text || '')) r.text = 'Your backup passphrase goes in a private box, never into this chat - say "set a backup passphrase" and I will show you the box.';
    if (!r.toolCalls.length && legal(r.text)) r.text = 'That is for your own lawyer to say - your waiver and your policies are your own documents. I can put yours on the Waivers tab for customers to sign, or set how waivers are collected.';
    // AN EARLIER ANSWER, WORD FOR WORD (Oct 22 2026, the owner's second day: the box's own "I have not changed that yet" line, from
    // earlier in the talk, came back from the 4B as its answer to a booking): sent back once
    const flat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!r.toolCalls.length && !ctx.repeatNudged && !ctx.tookAnswer && round < MAX_ROUNDS - 1 && flat(r.text).length > 40 && conv.messages.slice(0, mark).some(m => m.role === 'assistant' && flat(m.content) === flat(r.text))) {
      ctx.repeatNudged = true; ctx.nudged = 'Your last answer repeated one of your earlier answers word for word. Answer what the owner just said - call the tool for it, or ask them.';
      conv.messages.length = mark; seen = null; continue;
    }
    if (!r.toolCalls.length && !ctx.nudged && !ctx.tookAnswer && round < MAX_ROUNDS - 1) {
      // (only for an answer to a request: "what's next?" is answered with what was done in earlier turns, truly - Oct 22 2026)
      if (!ctx.appliedSomething && !proposedAny && !ctx.askedQuestion && CLAIMS_DONE.test(r.text || '')) ctx.nudged = 'Your last answer said something was done or confirmed, but no tool was called, so NOTHING has changed. Call the tool now only if the owner asked for exactly that; otherwise tell the owner plainly that it is not done yet, or ask them.';
      // (never in the round after a change was applied - its words are about the change: "Add an FAQ near the end: Do I need my own clubs?
      // ..." was made, then answered "I could not look that up just now" - FROM-SANDBOX item 2, fixed Oct 27 2026)
      else if (ctx.askedState && !lookedUp && !proposedAny && !ctx.appliedSomething) ctx.nudged = 'The owner asked about this facility as it is now. Look it up with your tools before answering - never answer from memory or from the examples in a tool\'s description.';
      // (the ideas looked up first are answered with "which one would you like?" - never nudged as a change asked to be confirmed: "slow
      // mondays any ideas" ended "I have not changed that yet" - the walk on the 4B, Oct 22 2026, late night)
      else if ((ASKS_CONFIRM.test(r.text || '') || WILL_DO.test(r.text || '')) && !(ctx.lookedUpFirst || []).some(x => x.name === 'deal_ideas')) ctx.nudged = 'Do not ask the owner to confirm a change: when one of your tools makes the change you described, call it now - the owner is shown it and says yes or no on the card. Ask a question only when no tool makes it.';
      if (ctx.nudged) { conv.messages.length = mark; seen = null; continue; }
    }
    // AFTER AN APPROVED CHANGE, THE BOX SAYS WHAT WAS DONE (Oct 22 2026, the owner's second day on the 4B: approved cards summed up
    // with what they never did - "staffed hours are now active, deposits will apply" over scheduling switched on, "$1 off every day"
    // over a special the owner had said for today). On the box's own model, words after an approval are the change as approved, and a
    // real question the model asked is kept ("Would you like to...?" is the box's own next steps, below); a call goes on as before
    // (a tool's own name is the box's word, never the owner's: "possible with `deal_set`" - the 4B, Oct 22 2026; and a setting's
    // own word in quotes - "last_minutes_free" - is said in plain words)
    // (the chat shows plain words: the small model's **bold** and ### headings showed as asterisks and hashes - maintainer's first screenshot,
    // Oct 22 2026)
    // (the answers to tap a bold-name list makes are read first - choicesInWords - then the marks go)
    if (r.text && realModel()) { ctx.listChoices = choicesInWords(r.text); r.text = r.text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+(?=\S)/gm, '- '); }
    if (r.text && realModel()) r.text = r.text.replace(/\s*(?:with|using|via|through|by calling|call)?\s*`([a-z]+(?:_[a-z]+)+)`/g, (m, n) => actions.BY_NAME.has(n) ? '' : m).replace(/\s+([.,;:!?])/g, '$1')
      .replace(/([`"*]+)([a-z]+(?:_[a-z]+)+)\1/g, (m, q, n) => (settingWords().has(n) ? n.replace(/_/g, ' ') : m))
      // (and a tool's name bare - "(via newsletter_send)" - and a file's address on this unit: "available ... at: `/uploads/landing/
      // 1792...-flyer.jpg`" is nothing an owner can use; the card above has its buttons - the 4B walk in maintainer's typing, Oct 23 2026)
      .replace(/\s*\((?:with |using |via |through |by calling |call )?([a-z]+(?:_[a-z]+)+)\)/g, (m, n) => actions.BY_NAME.has(n) ? '' : m)
      .replace(/\s+(?:with|using|via|through|by calling|call)\s+([a-z]+(?:_[a-z]+)+)\b/g, (m, n) => actions.BY_NAME.has(n) ? '' : m)
      .replace(/\b([a-z]+(?:_[a-z]+)+)\b/g, (m, n) => actions.BY_NAME.has(n) ? n.replace(/_/g, ' ') : m)
      .replace(/\s*(?:\bat|\bhere)?:?\s*`?\/uploads\/[^\s`)\]]+`?/g, '').replace(/\s+([.,;:!?])/g, '$1');
    // (what was just approved is said by the box only when the model goes straight on to the next change without words of its own -
    // a change the box put up itself, the rest of a menu: its card or its question follows "Done - ..."; kept for this round only)
    if (r.toolCalls.length && (String(r.text || '').trim() || r.toolCalls.some(c => { const x = actions.BY_NAME.get(c.name); return !x || x.kind !== 'write'; }))) ctx.justApplied = null;
    // THE REST OF A MENU ASKED FOR (Oct 22 2026, the 4B's first menu: "Bud Light $5, Coors Light $5, Wings $12, Nachos $10 and Tacos
    // $4" - the beers approved, then the card's words said back and the food never added): after a menu change is approved, the
    // items the owner named with a price that are still not on the menu send the model back, once, to add them
    if (!r.toolCalls.length && ctx.lastApplied === 'menu_items_add' && !ctx.menuRestNudged && round < MAX_ROUNDS - 1 && smallBoxModel()) {
      ctx.menuRestNudged = true;
      let menuNow = null; try { menuNow = await actions.LOADERS.menu(ctx); } catch {}
      const have = new Set(((menuNow || {}).cats || []).flatMap(c => (c.items || []).map(i => String(i.name).toLowerCase().replace(/s$/, ''))));
      const asked = [...heardThisAsk(conv, true).matchAll(/([A-Za-z][A-Za-z' &-]{1,40}?)\s*\$\s*(\d+(?:\.\d{1,2})?)/g)].map(m => [m[1].replace(/^(?:and|add|to|our|the|menu|a|an)\s+/i, '').replace(/^.*:\s*/, '').trim(), m[2]]).filter(([n]) => n);
      const missing = asked.filter(([n]) => !have.has(n.toLowerCase().replace(/s$/, '')));
      if (missing.length) {
        // the box puts them up itself, the drinks or the food first (a model sent back once to do it said the card's words again - the
        // 4B, Oct 22 2026, later): its own questions follow - where, which tax, the rate - and nothing is guessed
        ctx.menu = menuNow;
        const drinks = missing.filter(([n]) => DRINKISH.test(n)), food = missing.filter(([n]) => !DRINKISH.test(n)), group = drinks.length && (!food.length || drinks.length >= food.length) ? drinks : food;
        const kind = group === drinks ? 'Drinks' : 'Food', there = ((menuNow || {}).cats || []).find(c => c.active !== 0 && (kind === 'Drinks' ? DRINKISH.test(c.name) : !DRINKISH.test(c.name)));
        preset = { ok: true, toolCalls: [{ id: 'box_' + crypto.randomBytes(4).toString('hex'), name: 'menu_items_add', args: { part: there ? there.name : kind, items: group.map(([n, p]) => ({ name: n, price: Number(p) })) } }], text: '' };
        conv.messages.length = mark; seen = null; round--; continue;
      }
    }
    // (words saying it will go on - "now I'll add the food items" - are sent back once to do it: a request in several parts goes on
    // after the first is approved, the 4B's first menu of beers and food, Oct 22 2026)
    else if (!r.toolCalls.length && ctx.justApplied && ctx.justApplied.length && smallBoxModel() && !(WILL_DO.test(r.text || '') && !ctx.nudged && round < MAX_ROUNDS - 1)) {
      // (a question in bold - "**What is your website address (domain)?**" - is a question all the same: maintainer's try box, Oct 22 2026)
      // (each line on its own: "Access style set to hybrid: - Staffed on weekdays ... What's next?" ran together into one "question"
      // that said the change backwards - maintainer's try box, Oct 22 2026; one of a list's choices - "- Or keep it as-is?" - is not a question
      // of its own, and "What's next?" is the box's next steps, to tap)
      const asks = String(r.text || '').replace(/\*\*|__/g, '').split(/\n+/).flatMap(l => l.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/))
        .map(q => q.trim().replace(/^\W*(?:next(?: (?:step|question))?|first question|tip|note)\s*:\s*/i, ''))
        .filter(q => /\?$/.test(q) && !/^\s*(?:[-*\u2022]|\d+[.)])\s/.test(q) && !/^\W*(?:would you like|do you want|is there anything|anything else|shall i|want me to|let me know|or\b|for example|e\.g\.|what'?s next|what (?:would you like|do you want) (?:to do )?next)/i.test(q) && !/\banything else\b|\bhelp you with\b/i.test(q) && q.length < 200);
      // (nothing left to say when the page already said "Done: ...": the box's next steps follow, to tap)
      r.text = [saidDone(ctx), asks.join(' ')].filter(Boolean).join('\n\n') || 'That is set - here is what usually comes next.';
      ctx.justApplied = null; ctx.tookAnswer = 'applied';
    }
    // (the box's own "I have not changed that yet" is the owner's, never the model's history: the 4B copied it word for word as its
    // answer to the next requests - the walk in maintainer's typing, Oct 23 2026)
    const said = { role: 'assistant', content: ctx.couldNot && !r.toolCalls.length ? '' : r.text || '' };
    if (r.toolCalls.length) said.tool_calls = r.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.raw === 'string' ? c.raw : JSON.stringify(c.args || {}) } }));
    if (r.raw) said.raw = r.raw;   // Claude's own blocks, its thinking among them, to go back to Claude unchanged (model.js)
    conv.messages.push(said);
    if (!r.toolCalls.length) return done({ conversation: conv.id, reply: r.text || ((ctx.refusedWrites || []).length ? refusedSay(ctx.refusedWrites) : 'I am not sure what to say to that - could you put it another way?'), proposals: [] });
    const proposals = [];
    let fumbled = false, asking = null;
    for (const c of r.toolCalls) {
      const answer = (content) => { if (content && content.error && !content.routeSaid) fumbled = true; delete (content || {}).routeSaid; conv.messages.push({ role: 'tool', tool_call_id: c.id, content: trim(content) }); };
      // A BOX-ASKED CHOICE (Oct 22 2026, the owner's second day: "add to our menu: Bud Light $5 ... Tacos $4" on a box with no
      // menu yet - a new part needs its tax, and the 4B wrote "I'll now add..." twice instead of asking). The action (or the box's
      // own check - a phone nobody gave) names what it is missing and the answers; the box asks the owner itself and finishes the
      // call from their answer (run, above)
      const askedBox = (e, c) => {
        if (!(e && e.ask && ((Array.isArray(e.ask.choices) && e.ask.choices.length) || e.ask.parse))) return false;
        // (where the call came from rides with it: the quick model's own try is still the main model's to take over once answered, and
        // the box's own 24-hour reading stays as read - the review, Oct 25 2026)
        // (and the owner's words for it, as they were when it was asked: an everyday question answered while it waited - "what tax rates do
        // we charge?" to the box's rate question - cut the request in hand short, and "pretzels at $8" was asked for again: the review,
        // Oct 27 2026)
        (conv.awaiting = conv.awaiting || []).push({ name: c.name, args: e.ask.parse ? setPath(c.args || {}, e.ask.param, undefined) : Object.assign({}, c.args || {}), param: e.ask.param, question: e.ask.question, choices: e.ask.choices || [], values: e.ask.values, parse: e.ask.parse, spans: e.ask.spans, pair: e.ask.pair, single: e.ask.single,
          quickTry: role === 'quick' && !boxRound, ownClock: !!(ctx.ownClock && ctx.ownClock.has(c.id)), heard: heardThisAsk(conv, ctx.answeredBox || !!ctx.lastApplied) });
        answer({ asked: true, note: 'the box asks the owner: "' + e.ask.question + '" - their answer finishes this change' });
        return true;
      };
      const a = actions.BY_NAME.get(c.name);
      if (!a) { answer({ error: `there is no tool called "${c.name}" - use only the tools you were given` }); continue; }
      // the change the owner just walked away from is not put up again in the same breath (THE OWNER WALKED AWAY, above)
      if (ctx.movedOnFrom && c.name === ctx.movedOnFrom && !/^box_/.test(String(c.id))) { answer({ error: `${c.name}: the owner walked away from that change - do what they asked now, and bring it up again only if they do` }); continue; }
      // (the staffed hours asked, the opening hours put up: "saturday and sunday 10am to 10pm" closed the facility on weekdays - the
      // walk-through on the 4B, Oct 22 2026)
      if (c.name === 'opening_hours_set' && conv.guide && conv.guide.id === 'staffedhours' && !/\bopen(?:ing)?\b|\bclos(?:e|ed|ing)\b/i.test(ctx.newest || '')) { answer({ error: 'opening_hours_set: the owner was asked which days and hours someone WORKS there (the staffed hours), not the opening hours - staffed_set_weekly with the days they said, or ask which days' }); continue; }
      // (the setup guide: "i dont have one" to the logo question was skipped by the 4B as the website address - a skip is the step being
      // asked, unless the owner's words name another one)
      if (c.name === 'setup_skip' && !/^box_/.test(String(c.id)) && conv.guide && c.args && c.args.item !== conv.guide.item) {
        const other = setupGuide.BY_ID.get(String(c.args.item));
        if (!(other && other.words && other.words.test(ctx.newest || ''))) c.args = Object.assign({}, c.args, { item: conv.guide.item });
      }
      if (c.argsError) { answer({ error: `${c.name}: ${c.argsError}` }); continue; }
      // A BIG SWITCH ONLY WHEN ASKED (Oct 22 2026, the breadth set: scheduling switched on beside "put Saturday back to the normal
      // staffed hours", the hub set up for "call the new plug Lobby Lights", backups changed for "don't install the update tonight")
      // (the box's own call - a setup answer the owner tapped, "Yes, open it" - is the owner's word already: the walk-through on the 4B)
      if (a.kind === 'write' && ASKED_FOR[a.name] && !/^box_/.test(String(c.id)) && !ASKED_FOR[a.name].test(HEARD_FOR.has(a.name) ? heardThisAsk(conv, false) : (ctx.newest || '')) && !ctx.appliedSomething) { answer({ error: `${c.name}: ${ASKED_SAY[a.name] || 'the owner did not ask for this - leave it as it is and do what they asked'}` }); continue; }
      // A WEBSITE ADDRESS COMES WITH GETTING ONLINE (Oct 22 2026, the customer's day one: "I already own rapidgolf.com" was set as the
      // site's address straight away, with the box nowhere near it - links and the checklist then pointed at a site not there yet)
      // (maintainer, Oct 22 2026: a domain the owner gives is put in - asked for it, or told "our domain rapidgolf.com is all paid up")
      if (a.name === 'website_address_set' && ctx.tookAnswer !== 'website_address_set' && !(/\bdomain\b|\bwebsite address\b|\bweb address\b/i.test(lastAsked(conv)) && setupAnswers.domainIn(ctx.newest || '')) && !(setupAnswers.domainIn(ctx.newest || '') && /\b(?:own|owned|bought|paid|registered|our (?:domain|site|website)|my (?:domain|site|website))\b/i.test(ctx.newest || '')) && !/\b(?:set|change|use|make|switch|update|put)\b[^.?!]{0,40}\b(?:website|web|site|domain|url|address)\b|\b(?:already (?:answers|works|points|connected)|is (?:live|connected)|points (?:here|to (?:the|this|my|our) box))\b/i.test(ctx.newest || '')) { answer({ error: 'website_address_set: on this box the website address comes with getting it online - look the domain up first with domain_check, then go through the steps for it (the guide: a domain the owner already has is Way 2); set the address only when the owner asks to' }); continue; }
      let args;
      try {
        // what the action needs read first, once a turn, through the owner's own routes (actions.js LOADERS)
        for (const n of a.needs || []) if (ctx[n] === undefined || ctx[n] === null) { const load = actions.LOADERS[n]; if (load) ctx[n] = await load(ctx); }
        // (a base price put up in the same breath is the one a peak price's card compares with - "Those times cost the base price ($15 a
        // half hour)" stood beside a new $20 - the walk-through on the 4B, Oct 22 2026)
        if (ctx.pendingBase != null && ctx.money_booking && typeof ctx.money_booking === 'object') ctx.money_booking = Object.assign({}, ctx.money_booking, { base: ctx.pendingBase });
        // (the owner's own words first: the 4B put up "24:00" for "9am to midnight on weekends", refused before the owner's words were
        // read - the walk-through, Oct 22 2026)
        { const said0 = setupAnswers.fromWords(a.name, c.args, ctx.newest); if (said0) c.args = said0; }
        args = actions.check(a.params, c.args, ctx);
        // (after a change is approved the request in hand goes on: the owner's last words were its answer, however many - "No tax on
        // these - keep 0%" tapped, then the fries the owner priced in the request itself)
        ctx.heard = heardThisAsk(conv, ctx.answeredBox || !!ctx.lastApplied);
        { const was = ctx.answeredHeard && ctx.answeredHeard.get(c.id); if (was && !ctx.heard.includes(was)) ctx.heard = was + '\n' + ctx.heard; }   // (the request as it was asked - askedBox)   // the owner's words for the request in hand, for an action's own checks (money said)
        ctx.boxAnswers = conv.boxAnswers || [];
        ctx.lastCode = conv.lastCode || null;   // the discount code just made in this talk ("seniors too")
        // what the model left out and the owner plainly said (an action's own fill - the counter's specials)
        // (an action's own fill reads the bare-hour rule too - an event's start, a closing hour; the hours the owner picked from the box's
        // own "Which hours?" are left as picked: clockSettledNow, Oct 27 2026)
        ctx.clockSettledNow = !!(ctx.clockSettled && ctx.clockSettled.has(c.id)); ctx.clockCallId = c.id;
        if (a.fill) args = a.fill(args, ctx);
        // (a fill's own question - the bare-hour rule could not place an event's start or a closing hour: the box asks it, both to tap)
        if (args && args[actions.HELPERS.CLOCK_ASK]) { const q = args[actions.HELPERS.CLOCK_ASK], e = new actions.ActionError(q.why || 'which time the owner means is not plain - the box asks'); e.ask = Object.assign({}, q); delete e.ask.why; throw e; }
        // WHAT THE OWNER NEVER SAID STAYS OUT (Oct 22 2026, the owner's second day: "make a discount code SPRING10 for 10% off" was put
        // up with 100 uses and an end of Dec 31, neither said): an action's optional limits, kept only when the owner's own words in
        // this talk say one (an action's unsaid: { param: (value, words, ctx, args) => said })
        if (a.unsaid) {
          const heard = ctx.heard;
          // (never the one the owner just gave as their answer to the box's own question for it: "7.5" to "What rate do you charge on it?
          // (the percent, like 7.5)" was taken out again - no "%" in it - and the same question asked for ever: the review, Oct 27 2026)
          const answered = ctx.answeredParam && ctx.answeredParam.get(c.id);
          for (const [k, said] of Object.entries(a.unsaid)) if (k !== answered && args[k] !== undefined && args[k] !== null && !said(args[k], heard, ctx, args)) {
            args = Object.assign({}, args); delete args[k]; c.args = Object.assign({}, c.args || {}); delete c.args[k];
          }
        }
        // A PHONE OR AN EMAIL IS NEVER MADE UP (Oct 22 2026, the owner's second day: "book Bay 1 for John Smith tomorrow at 6pm" was
        // put up with the phone "555-1234", which nobody said). One the owner has not said in this talk is asked for by the box
        if (a.kind === 'write') { const miss = madeUpContact(args, conv); if (miss) { const e = new actions.ActionError(`${miss} was not said by the owner - ask for it`); e.ask = { param: miss, question: `What ${miss === 'phone' ? 'phone number' : 'email address'} should I use${args.name ? ' for ' + args.name : ''}? I only use one you give me.`, parse: miss }; throw e; } }
        // a setup answer's values as the owner said them, over the model's (setupanswers.js: "9am to midnight" was put up as 11 PM)
        const said = setupAnswers.fromWords(a.name, args, ctx.newest);
        if (said) { args = actions.check(a.params, said, ctx); c.args = said; }
        // the period the owner named outright is the one read (Oct 22 2026, the scored set: "the tax for last quarter" was asked
        // for this quarter by the box's small model) - a report's or an export's period, from the owner's own words
        const per = a.params && a.params.properties && a.params.properties.period;
        if (per && Array.isArray(per.enum) && ctx.newest) {
          // a period said as the one compared against ("are we up from last week?", "better than last month") is not the period asked
          const asked = String(ctx.newest).replace(/\b(?:from|since|than|against|vs\.?|versus|compared (?:to|with)|over|same as|like)\s+(?:the\s+)?(?:last|this|the past)\s+(?:7 days|seven days|\w+)/gi, ' ');
          const said = PERIODS.find(([re, v]) => re.test(asked) && per.enum.includes(v));
          if (said && args.period !== said[1]) { args = Object.assign({}, args, { period: said[1] }); delete args.from; delete args.to; }
        }
        // THE DAY THE OWNER NAMED OUTRIGHT IS THE ONE PUT UP (Oct 23 2026, the walk in maintainer's typing: "block bay 2 tmrw 3-5" was put up by
        // the 4B for the day after tomorrow): "today", "tonight" or "tomorrow" said once, and the one date the call carries is not that
        // day - it becomes that day (a weekday name or a date the owner said is left to the call)
        // (for a call the owner's answer finished, the words read are the request in hand as it was asked, never the answer: "tonight" to
        // "Which hours?" for a Friday block put it up for today - the review of round 2b, Oct 27 2026; and the hours' own answer is left as
        // it is: that question is asked after this guard has read the request, and its second shift past midnight is the next day's)
        // (Oct 28 2026, round 2f - the critic of round 2e: the model's own call read only the newest words, so "put trivia on the events page
        // tomorrow", the model's "What time does it start?", then "7pm" - a model that dated it a day late had it put on the public Events page at
        // once. The newest words decide when they name a day of their own; otherwise the request in hand, as every other guard reads it)
        { const dps = Object.entries((a.params && a.params.properties) || {}).filter(([k, p]) => p && p['x-date'] && args[k]).map(([k]) => k);
          const answered = ctx.answeredIds && ctx.answeredIds.has(c.id), hoursAnswer = answered && ctx.answeredParam && ctx.answeredParam.get(c.id) === '*';
          // (a month and its day, "the 8th" and a holiday are a day of the newest words' own too - Oct 28 2026, round 2g, the reviewer and the
          // critic of round 2f: "any events tonight", the 4B's "There are no events tonight. Would you like to add one?", then "yes, a costume
          // contest on halloween at 8pm" put the model's right Oct 31 up for TONIGHT at once; "actually make it nov 8 at 7pm" after "put trivia on
          // the events page tomorrow" went up for tomorrow; "6pm to 9pm on the 8th" moved a block card to tomorrow)
          // (A MONTH IS A MONTH'S NAME, AND "THE 8TH" IS A DAY ONLY WHERE A DATE STANDS - Oct 28 2026, round 2h, the reviewer of round 2g: the month
          // pattern took any word that starts like one - "maybe 7", "maybe 20 people", "juniors 12" - and every "1st" or "2nd" was a date - "1st
          // place", "prizes for 1st 2nd and 3rd", "the 1st party", "their 2nd booking" - so an answer with them was read as naming its own day and a
          // model a day late went on the public Events page at once, over the "tomorrow" said a turn before. A month is its name or its short form
          // before the day; an ordinal is a day said "the 8th" / "on the 8th" with nothing after it but a stop, a time or a small word ("of", "at",
          // "from" ...) - never a list of places, never "the 1st party")
          const MD = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b';
          const OD = '(?:on\\s+(?:the\\s+)?|the\\s+)\\d{1,2}(?:st|nd|rd|th)\\b(?!\\s*,?\\s*(?:and\\s+|&\\s*|or\\s+)?\\d{1,2}(?:st|nd|rd|th)\\b)(?=\\s*(?:$|[.,;:!?)]|(?:of|at|from|for|to|till|til|until|thru|through|instead|then|too|please|pls|is|works?|would|will|and|or)\\b|@|\\d{1,2}(?::[0-5]\\d)?\\s*(?:am|pm|a\\.m|p\\.m|-|–|to\\b|till\\b|til\\b|until\\b)))';
          const DAY_NAMED = new RegExp(`\\b(?:today|tonight|tonite|tomorrow|tmrw|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}|mon|tue|wed|thu|fri|sat|sun|${MD}|${OD}|halloween|thanksgiving|christmas|xmas|new years?|valentines?|easter|memorial day|labor day|4th of july|fourth of july|independence day|veterans day|mothers? day|fathers? day|black friday|super bowl|st\\.? patrick)`, 'i');
          const newestOwn = DAY_NAMED.test(String(ctx.newest || '')) ? ctx.newest : String((ctx.inHand && ctx.inHand.text) || ctx.newest || '');
          const w = String((answered ? ((ctx.answeredHeard && ctx.answeredHeard.get(c.id)) || ctx.heard) : newestOwn) || ''), tm = /\btomorrow\b/i.test(w), td = /\b(?:today|tonight)\b/i.test(w);
          if (!hoursAnswer && dps.length === 1 && (tm !== td) && ctx.today && !new RegExp(`\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}|mon|tue|wed|thu|fri|sat|sun|${MD}|${OD}|halloween|thanksgiving|christmas|xmas|new years?)`, 'i').test(w)) {
            const want = tm ? actions.addDays(ctx.today, 1) : ctx.today;
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(args[dps[0]])) && args[dps[0]] !== want) { args = Object.assign({}, args, { [dps[0]]: want }); c.args = Object.assign({}, c.args, { [dps[0]]: want }); }
          } }
        // WHICH SATURDAY? (sameWeekday, above): the call's one date is asked for, both dates to tap - the box's own answered call
        // (box_) is never asked again; a command the box read itself (BOX FIRST, intents.js) is asked the same way
        if (ctx.today && (!/^box_/.test(String(c.id)) || (conv.boxFirst && conv.boxFirst.has(c.id))) && r.toolCalls.filter(x => x.name === c.name).length === 1) {
          const dps = Object.entries((a.params && a.params.properties) || {}).filter(([k, p]) => p && p['x-date'] && args[k]).map(([k]) => k);
          const which = dps.length === 1 ? sameWeekday(ctx.newest, ctx.today) : null;
          if (which) { const e = new actions.ActionError(`which ${which.name} the owner means is not plain - the box asks`); e.ask = { param: dps[0], question: which.question, choices: which.choices, values: which.values, parse: 'oneof:' + which.values.join('|') }; throw e; }
        }
        // A MONTH AND DAY WITH NO YEAR IS THE NEXT ONE, for a change (the walk in maintainer's typing, Oct 23 2026: "make SPRING20 20% off til
        // may 31" was put up for the May 31 already past and refused): a date the call carries before today, said by the owner as that
        // month and day with no year, is a year on
        if (a.kind === 'write' && ctx.today) { const w = String(ctx.newest || '');
          for (const [k, p] of Object.entries((a.params && a.params.properties) || {})) {
            const v = String(args[k] || ''); if (!p || !p['x-date'] || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v >= ctx.today || /\b20\d\d\b/.test(w)) continue;
            const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][Number(v.slice(5, 7)) - 1], day = Number(v.slice(8));
            if (!new RegExp('\\b' + mon + '[a-z]*\\.?\\s+' + day + '(?:st|nd|rd|th)?\\b|\\b' + Number(v.slice(5, 7)) + '/' + day + '\\b', 'i').test(w)) continue;
            const next = (Number(v.slice(0, 4)) + 1) + v.slice(4);
            if (next >= ctx.today) { args = Object.assign({}, args, { [k]: next }); c.args = Object.assign({}, c.args, { [k]: next }); }
          } }
        // THE DAYS THE OWNER NAMED PLAINLY ARE THE DAYS PUT UP (the walk, Oct 23 2026: "happy hr weekdays 2-5" was put up by the 4B for
        // "mon-thu"): their days, read from their own words, over the model's when the two differ
        // (only where the days are when the thing applies - never opening hours, where "closed mondays" names the day it is NOT)
        // (Oct 27 2026, the review of round 2 - the worst of it, end to end: "happy hour 2 to 5 at $15 a half hour, not on weekends" put the
        // model's right Monday to Friday back to Saturday and Sunday here - daysIn read the days LEFT OUT as the days. daysIn now reads them
        // as the days left, or nothing when it cannot place a negative, so nothing is put over the model's call. And a deal, a special
        // and a package carry their days as a list once checked ('x-days'), so this never looked at them: the model's Saturday and Sunday
        // for "book 2 hours, the last 30 minutes free, not on weekends" stood. The days said are put over theirs too, in the same form)
        // (Oct 27 2026, round 2d: the override fires ONLY WHEN THE BOX'S READING IS CERTAIN by THE DAYS RULE (helpers.js) - one clause's days,
        // "every day" a group of its own, a day said about something else none of the thing's, a day left out in any form the days left,
        // "wed" / "sat" / "sun" days only where they cannot be words, one time never every week. The review of round 2c found it putting
        // "every day" over the model's right weekdays for "on weekdays, weekends are regular price", Saturday for "we sat down and decided
        // ... every day", the weekend for "the bogo we did last weekend ... every day now", Wednesday for "wed like happy hour 2 to 5", and
        // the weekend for "weekends off". A new deal or package the model left with no days (every day) gets the days said too; a name the
        // owner said themselves is never renamed)
        // (Oct 28 2026, round 2e: the days, one time and the money below - and the bare-hour rule after them - each read THE REQUEST IN HAND
        // (requestInHand, once a turn): "weekdays", "ok every friday then", "an hour" or "not fridays though" typed after a question, a call handed
        // back or a card is read with the request it answers, never alone; and the days never from the owner's answer to the box's own "Which
        // hours?")
        const DAYS_ACT = /^(?:deal_set|price_window_add|price_window_change|counter_special_set|package_set)$/.test(a.name), ownCall = /^box_/.test(String(c.id));
        const handDays = String((ctx.inHand && ctx.inHand.days) || ctx.newest || ''), handWords = String((ctx.inHand && ctx.inHand.text) || ctx.newest || '');
        { const dp = (a.params && a.params.properties && a.params.properties.days), ds = DAYS_ACT && dp ? actions.HELPERS.daysSaid(handDays) : null;
          let said = ds ? actions.HELPERS.daysIn(handDays, true) : null;
          // (A CORRECTION THAT NAMES ITS DAYS IN FULL - Oct 28 2026, round 2g, the reviewer of round 2f: after a card's No, "only mon thru thu", "mon-thu
          // only", "make it mon-thu", "just monday to thursday", "mon to thu" were read with the request's "weekdays" as two groups - not certain - and
          // a wrong model was handed back. The newest words that are only a day list, said as a correction - no "too", "also", "and", "not", nothing
          // else - are the days)
          const turnsH = (ctx.inHand && ctx.inHand.turns) || [];
          if (!said && ds && turnsH.length > 1) {
            const last = String(turnsH[turnsH.length - 1].said || ''), bare = last.toLowerCase().replace(/[‘’]/g, "'").replace(/\b(?:only|just|make (?:it|that)|change (?:it|that) to|actually|instead|no|nah|ok(?:ay)?|sorry|i meant|i mean|meant|it'?s|should be|the days?|days|please|pls|then|so|wait|on)\b/g, ' ').replace(/[,.!]/g, ' ');
            const fix = actions.HELPERS.daysIn(last, true);
            // (A BARE DAY IS A CORRECTION ONLY WHEN IT IS SAID AS ONE, OR NARROWS THE DAYS ALREADY SAID - Oct 28 2026, round 2h, the reviewer of round 2g:
            // any newest words that were only a day list were made the whole set of days, so after a No on "happy hour weekdays 2 to 5", "saturday" or
            // "weekends" - often "add Saturday" - put Saturday alone up over a model that called Mon-Sat. Said with "only", "just", "make it", "change it
            // to", "actually", "instead", "i meant", "should be": those are the days, as round 2g read them; said bare, only when every day named is one
            // of the days the request already had - "mon to thu" after weekdays. A bare day outside them is handed back, as before round 2g)
            const asFix = /\b(?:only|just|make (?:it|that)|change (?:it|that) to|actually|instead|i meant|i mean|meant|should be)\b/i.test(last);
            const had = asFix ? null : actions.HELPERS.daysIn(turnsH.slice(0, -1).filter(t => !t.hoursAnswer).map(t => t.said).join(' ; '), true);
            const within = asFix || (!!had && !!fix && fix.every(d => had.includes(d)));
            if (fix && fix.length && within && !/\b(?:too|also|as well|plus|and|&|not|no|except|but|skip|off|without|every day|weekends? too)\b/i.test(last.replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\s+(?:and|&)\s+(?=(?:mon|tue|wed|thu|fri|sat|sun))/gi, ' '))
              && bare.split(/\s+/).filter(Boolean).every(x => /^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|weekdays?|weekends?|thru|through|to|till|til|and|&|-|–)$/.test(x) || /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*-(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.test(x))) said = fix;
          }
          const fresh = (a.name === 'deal_set' && !args.deal) || (a.name === 'package_set' && !args.package);
          const oneCall = r.toolCalls.filter(x => x.name === c.name).length === 1, hasDays = typeof args.days === 'string' || Array.isArray(args.days);
          // (a change to one that is there - its days less a day taken out, "remove fridays from happy hour": the days left are ITS days less
          // that one, never every day less it - so there is no certain reading of the box's; the model's call stands only when it keeps none of
          // the days taken out. Oct 28 2026)
          const changeOf = a.name === 'price_window_change' || (a.name === 'deal_set' && !!args.deal) || (a.name === 'package_set' && !!args.package) || (a.name === 'counter_special_set' && !!args.special);
          const leftOnly = !!ds && !ds.groups.length && ds.left.size > 0 && changeOf;
          // (one such change in the answer, and never the box's own - "40 an hour, 50 an hour after 5pm and weekends" is two windows,
          // and the guard put both on the weekends: test-assistant A40n)
          // (Oct 28 2026, round 2e: a new deal or package the model left with no days is no longer given the days read from the words - "lets
          // do buy an hour get an hour, saturdays are always full" was made a Saturday deal, "..., closed on mondays" a Monday one: such a call
          // is held to the readings the words allow, below, like any other)
          if (said && !leftOnly && hasDays && !ownCall && oneCall) {
            const theirs = actions.HELPERS.normDays(args.days);
            if (!theirs || theirs.slice().sort().join() !== said.slice().sort().join()) { args = Object.assign({}, args, { days: Array.isArray(args.days) ? said.slice() : said.join(',') }); c.args = Object.assign({}, c.args, { days: said.join(',') });
              // (and a name the model gave for its own days says the days put up - "Weekend Last Half Free" on a weekday deal: Oct 27 2026)
              // (never a name the owner said: "Weekend Rate" for "weekend rate: $25 a half hour ..." is theirs - Oct 27 2026, round 2d)
              const DN = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }, ds2 = said.slice().sort((x, y) => 'montuewedthufrisatsun'.indexOf(x) - 'montuewedthufrisatsun'.indexOf(y)).join(',');
              const word = said.length === 1 ? DN[said[0]] : ds2 === 'mon,tue,wed,thu,fri' ? 'Weekday' : ds2 === 'sat,sun' ? 'Weekend' : '';
              const flat = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), theirsSaid = typeof args.name === 'string' && flat(handWords).includes(flat(args.name));
              const nm = typeof args.name === 'string' && !theirsSaid ? args.name.replace(/\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|week(?:day|end))s?\b/i, word).replace(/\s{2,}/g, ' ').trim() : '';
              if (nm && nm.length >= 2 && nm !== args.name) { args = Object.assign({}, args, { name: nm }); c.args = Object.assign({}, c.args, { name: nm }); }
            }
          }
          // WHEN THE BOX IS NOT CERTAIN, THE MODEL'S DAYS ARE STILL DAYS THE OWNER SAID (Oct 27 2026, round 2d): with no certain reading the
          // model's call stands - but only on a reading the words allow (helpers.daysSaid readings): one of the groups said ("on weekdays,
          // weekends are regular price" - weekdays, or weekends), every day less a day left out, either side of an either-or, the day said after
          // a "no" that may be a correction. Days nobody said - the two groups joined into every day, weekdays for "every day, no weekend
          // upcharge", Monday to Friday for "not friday night" - are handed back for the model to ask: two readings are asked, never picked by
          // the box, and never made up by the model
          // (Oct 28 2026: a day said about something else - "closed on mondays", "weekends stay regular price" - gives the days left as the
          // reading, never that day; a new deal with no days of the model's is every day, and is held to the same readings)
          else if (ds && !ownCall && !args.date && oneCall && (hasDays || (args.days === undefined && fresh))) {
            const all = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], say = (g) => g === all.slice().sort().join() ? 'every day' : g.split(',').join(', ');
            const theirsL = args.days === undefined ? all : (actions.HELPERS.normDays(args.days) || []), theirs = theirsL.slice().sort().join();
            if (leftOnly) {
              const DNS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
              if (!theirsL.length || theirsL.some(d => ds.left.has(d))) throw new actions.ActionError(`the owner took ${[...ds.left].map(d => DNS[d]).join(' and ')} out ("${handDays.slice(0, 140)}"), and the call's days (${say(theirs)}) still hold it: put up the days it had, less ${ds.left.size > 1 ? 'those' : 'that one'} - or ask which days, never pick`);
            } else if (!ds.oneOff && (ds.groups.length || ds.left.size || ds.unsure)) {
              const ok = ds.readings.map(g => g.slice().sort().join());
              if (!ok.includes(theirs)) throw new actions.ActionError(`which days the owner means is not plain from their words ("${handDays.slice(0, 140)}"), and the call's days (${say(theirs)}) are none they said${ok.length ? ' - they named ' + ok.map(say).join(' or ') : ''}: ask the owner which days, never pick`);
            }
          }
          // ONE TIME IS NEVER EVERY WEEK (Oct 27 2026, round 2d - THE DAYS RULE, 6): "happy hour 2 to 5 at $15 a half hour this weekend" was put
          // up as a price window every Saturday and Sunday from now on, "bud light $2 off 5 to 9 this weekend" as a weekly special. Words that
          // name one time - this weekend, this friday, next saturday, tonight, today, tomorrow, this week - with nothing that says every week,
          // on a change that repeats every week and carries no date of its own (a special's date, a deal's or a package's first and last day),
          // are handed back with the reason: the model asks the owner, or gives the dates (a price window holds no dates at all)
          // (Oct 28 2026, round 2e: a holiday or a date - Thanksgiving, Halloween, New Year's Eve, "nov 8", "the 31st" - is one time too; and only
          // days said for EVERY week stand it down (helpers daysSaid weekly) - a weekly word in a clause about something else did: "this weekend
          // ..., weekdays stay regular" went up every Monday to Friday, "this weekend, no sundays" every Saturday)
          const one = DAYS_ACT && !ownCall ? (ds || actions.HELPERS.daysSaid(handDays)) : null;
          if (one && one.oneOff && !one.weekly && !args.date && !args.first_day && !args.last_day) {
            const what = { price_window_add: 'a price window', price_window_change: 'a price window', counter_special_set: 'a special', deal_set: 'a deal', package_set: 'a package' }[a.name];
            throw new actions.ActionError(`the owner said "${one.oneOff}" - one time - and ${what} as called repeats every week from now on${a.name.startsWith('price_window') ? ' (a price window cannot be kept to one time)' : a.name === 'counter_special_set' ? ' (give it its one date, or ask)' : ' (give it its first and last day, or ask)'}: ask the owner whether they mean every week or only that once - never put it up for every week`);
          }
          // A RUN'S FIRST OR LAST DAY IS CARRIED, OR THE CARD SAYS IT CANNOT BE (Oct 28 2026, round 2g - the reviewer and the critic of round 2f: "book 2
          // hours and get the last 30 minutes free starting nov 1" went live the day it was approved with no first day, "draft beer $2 off 5 to 9 until
          // christmas" never ended, "happy hour weekdays 2 to 5 ... starting monday" went live at the Yes today - and the card said nothing of the day the
          // owner gave; after a No, "starting monday" put the same card back). A deal and a package hold their first and last day: the day the owner
          // named plainly is put on them (helpers.runLimit - a month and its day, "the 1st", a holiday, the coming weekday, the end of the year, a month
          // said whole); one that names no plain day - "starting next week" - with none on the call is handed back to be asked. A price window and a
          // counter special hold no such day: the card says so, in the owner's own words, before the Yes
          if (DAYS_ACT && ctx.today) {
            const lim = actions.HELPERS.runLimit(handWords, ctx.today);
            if (lim.said.length) {
              const said = lim.said.filter(x => !lim.said.some(y => y !== x && y.includes(x)));
              if (a.name === 'deal_set' || a.name === 'package_set') {
                const put = {};
                if (lim.first && args.first_day !== lim.first) put.first_day = lim.first;
                if (lim.last && args.last_day !== lim.last) put.last_day = lim.last;
                if (Object.keys(put).length) { args = Object.assign({}, args, put); c.args = Object.assign({}, c.args, put); }
                if (lim.open && !args.first_day && !args.last_day) throw new actions.ActionError(`the owner said "${said.join('", "')}" - ${a.name === 'deal_set' ? 'a deal' : 'a package'} holds its first and last day (first_day, last_day): give it them as the owner means them, or ask which day - never put it up from today with no end`);
              } else c.runNote = `You said "${said.join('" and "')}" - ${a.name === 'counter_special_set' ? 'a counter special' : 'a price window'} cannot wait for a day or end on one by itself: it starts when you say Yes and runs until you take it off.`;
            }
          }
        }
        // MONEY CARRIED (Oct 27 2026, round 2d - the review of round 2c: "$20 an hour weekdays 2 to 5 for the seniors, they asked for it" was put
        // up at the model's $25 an hour; maintainer: never guess a price): a price the owner said, that the model's call does not carry, is never put
        // up. The owner's own number when they said one plainly (one amount, its kind plain - "$20 an hour", "$2 off", "half off"); asked
        // when one amount could be per half hour or per hour ("$20 weekdays 2 to 5"); handed back when they said several. A price window's
        // and a special's money; the box's own reading and an owner's answer (box_) are the owner's words already
        // (Oct 28 2026, round 2e - the review of round 2d, HIGH: a saving, a difference, a bundle and a total are never the price - "$1 cheaper"
        // put up "$1 each", "2 for $5" "$5 each", "drop the happy hour price by $5" asked "$5 a half hour, or $5 an hour?", both wrong. helpers
        // moneyIn says what each amount is: a saving is a special's dollars off and never a window's price; a surcharge, a change by an amount
        // and the price it was are no price; "2 for $5" is carried as $2.50 each, "$40 for 2 hours" as $10 a half hour - and when the call
        // carries neither it is handed back, never put up and never asked as a price. And the owner's own answer to "a half hour, or an hour?",
        // typed and handed on - "an hour", "per hr", "half hour" - makes the amount that kind: the call must carry exactly that)
        if (/^(?:price_window_add|price_window_change|counter_special_set)$/.test(a.name) && !ownCall) {
          const said = actions.HELPERS.moneyIn(handWords), win = a.name !== 'counter_special_set';
          const turns = (ctx.inHand && ctx.inHand.turns) || [], unit = turns.length > 1 ? moneyUnit(turns[turns.length - 1].said) : null;
          if (unit !== null && win) for (const m of said) if (m.kind === 'bare') m.kind = unit === 1 ? 'hour' : 'half';
          const mine = win ? said.filter(m => /^(?:half|hour|bare|total)$/.test(m.kind)) : said.filter(m => /^(?:off|pct|bare|bundle)$/.test(m.kind));
          const val = win ? (args.price_per_half_hour !== undefined ? args.price_per_half_hour : args.price_per_hour !== undefined ? args.price_per_hour / 2 : undefined)
            : args.dollars_off !== undefined ? ['off', args.dollars_off] : args.percent_off !== undefined ? ['pct', args.percent_off] : args.price !== undefined ? ['bare', args.price] : undefined;
          const same = (x, y) => Math.abs(Number(x) - Number(y)) < 0.005;
          const carried = (m) => win ? (m.kind === 'half' ? same(m.n, val) : m.kind === 'hour' ? same(m.n / 2, val) : m.kind === 'total' ? same(m.n / (2 * m.hours), val) : same(m.n, val) || same(m.n / 2, val))
            : m.kind === 'bundle' ? val[0] === 'bare' && same(val[1], m.n / m.count) : m.kind === val[0] && same(m.n, val[1]);
          // (a window's price that is only the difference the owner said - "drop the happy hour price by $5", "save $5 a half hour", put up AT
          // $5 - or the price it was, is handed back: that is how much lower or higher, never the price - Oct 28 2026)
          if (win && val !== undefined && !mine.some(carried)) {
            const by = said.filter(m => /^(?:off|more|diff|was)$/.test(m.kind));
            if (by.some(m => same(m.n, val) || same(m.n / 2, val))) throw new actions.ActionError(`the owner said ${by.map(m => m.said).join(' and ')} - how much lower or higher, or the price it was, never the new price: work the new price out from the window's own and say it, or ask - never put that amount up as the price`);
          }
          if (mine.length && val !== undefined && !mine.some(carried)) {
            const keys = win ? ['price_per_half_hour', 'price_per_hour'] : ['price', 'dollars_off', 'percent_off'];
            const kinds = [...new Set(mine.map(m => m.kind + ':' + m.n))];
            const drop = (o) => { const x = Object.assign({}, o); for (const k of keys) delete x[k]; return x; };
            const put = (m) => win ? { [m.kind === 'hour' ? 'price_per_hour' : 'price_per_half_hour']: m.n } : { [m.kind === 'off' ? 'dollars_off' : m.kind === 'pct' ? 'percent_off' : 'price']: m.n };
            const each = (m) => m.kind === 'bundle' ? ` (that is $${Math.round(m.n / m.count * 100) / 100} each)` : m.kind === 'total' ? ` (that is $${Math.round(m.n / (2 * m.hours) * 100) / 100} a half hour)` : '';
            if (kinds.length === 1 && /^(?:half|hour|off|pct|bare)$/.test(mine[0].kind) && !(win && mine[0].kind === 'bare')) { const set = put(mine[0]); args = Object.assign(drop(args), set); c.args = Object.assign(drop(c.args || {}), set); }
            else if (kinds.length === 1 && win && mine[0].kind === 'bare') {
              const n = mine[0].n, e = new actions.ActionError(`the owner said $${n} and did not say per half hour or per hour - the box asks`);
              c.args = drop(c.args || {});
              e.ask = { param: '*', question: `Is that $${n} a half hour, or $${n} an hour?`, choices: [`$${n} a half hour`, `$${n} an hour`], values: [{ price_per_half_hour: n }, { price_per_hour: n }], parse: 'unit' };
              throw e;
            } else throw new actions.ActionError(`the owner said ${mine.map(m => m.said + each(m)).join(' and ')} - this call carries none of them: use the owner's own price, or ask which it is - never another`);
          }
        }
        // THE BARE-HOUR RULE (helpers.js clockOf - Oct 27 2026): every clock time this change carries (actions.js CLOCKS) is read against
        // the owner's own words for the request in hand, with the facility's hours (that day's own, for a dated change). Said, or certain by
        // the rule: put right - the half moved when the call read the other one. Not certain: asked, both to tap. Never kept, never moved,
        // in silence. The call's own reading counts for nothing either way - the model's, a box reader's (rangeIn, the setup prices), or a
        // call finished by the owner's answer to another question ("which Saturday?") alike; only the hours the owner picked from the box's
        // own "Which hours?" are left as picked (clockSettled), and a time the owner never typed ("all day", until close) is left as it is.
        // (Until Oct 27 2026: eveningIfClosed and twoWays, the box's own 24-hour readings skipped - ownClockOf - and only six actions read.)
        // What the change can hold past midnight decides how a reading goes up (nightSpan): two shifts are said and put up together; a
        // price window past midnight is the model's to explain to the owner, with the owner's own words.
        if (a.clocks && !(ctx.clockSettled && ctx.clockSettled.has(c.id))) {
          if (ctx.hours === undefined) ctx.hours = await actions.LOADERS.hours(ctx);
          const inHand = ctx.answeredIds && ctx.answeredIds.has(c.id) ? (ctx.heard || ctx.newest) : handWords, H = actions.HELPERS;   // (the request in hand - requestInHand, Oct 28 2026)
          const span = (x) => [x.start, x.end === undefined ? x.start : x.end];
          const splitSay = (night, say) => `${say} runs past midnight, so it goes on the schedule as two shifts: ${H.dayWords(args.date)} ${say.replace(/ to .*$/, '')} to 11:59 PM, and ${H.dayWords(night.split[1].date)} midnight to ${say.replace(/^.* to /, '')}.`;
          for (const pair of a.clocks.pairs) {
            const [k0, k1] = pair; if (!args[k0]) continue;
            const r = H.clockOf(inHand, { start: args[k0], end: k1 ? args[k1] : null }, ctx.hours, { day: dayKeyOf(args.date), markers: a.clocks.markers, name: typeof (args.name || args.label) === 'string' ? (args.name || args.label) : '', handOff: true });
            if (!r) continue;
            // ("till close" with no close to run to - open 24 hours, or not open at that start: the model asks the owner the end - Oct 28 2026)
            if (r.hand) throw new actions.ActionError(r.hand);
            // (the block's own name and the rest the request filled in ride with the question: the answer "pm" is not the request - its
            // label was lost, "Private event friday" put up with no name - the review, Oct 27 2026)
            c.args = Object.assign({}, c.args, args);
            if (r.set) {
              if (r.set.start === args[k0] && (!k1 || r.set.end === args[k1] || (r.set.end === '00:00' && args[k1] === '23:59'))) continue;
              const night = nightSpan(a, args, [r.set.start, k1 ? r.set.end : undefined], pair), say = k1 && r.set.end ? `${H.clockSay(H.clockMin(r.set.start))} to ${H.clockSay(H.clockMin(r.set.end))}` : H.clockSay(H.clockMin(r.set.start));
              if (night.cannot) throw new actions.ActionError(`the owner wrote "${String(inHand).slice(0, 120)}" - that is ${say}, and ${night.cannot}: say so to the owner and ask which hours they want`);
              if (night.set) { const put = withName(a, args, night.set, k0); args = Object.assign({}, args, put); c.args = Object.assign({}, c.args, put); continue; }
              const e = new actions.ActionError('the evening runs past midnight - two shifts; the box asks');
              e.ask = { param: '*', question: `${splitSay(night, say)} Put both up?`, choices: ['Put both shifts up'], values: [{ __split: night.split }], spans: [span(r.set)], parse: 'ampm', pair };
              throw e;
            }
            const [m0, n0] = r.ask, am = nightSpan(a, args, [m0.start, k1 ? m0.end : undefined], pair), pm = nightSpan(a, args, [n0.start, k1 ? n0.end : undefined], pair);
            if (am.cannot && pm.cannot) throw new actions.ActionError(`"${r.labels[0]}" or "${r.labels[1]}" - the owner wrote "${String(inHand).slice(0, 120)}", and ${am.cannot}: say so to the owner and ask which hours they want`);
            const e = new actions.ActionError('which hours the owner means is not plain - the box asks');
            // (a reading the change cannot hold as one - a price window past midnight - is still offered, with why; tapped, the box says so and
            // asks again, never the model's: Oct 27 2026)
            const note = [am, pm].map((x, i) => (x.split ? ' (' + splitSay(x, r.labels[i]) + ')' : x.cannot ? ` (${r.labels[i]} runs past midnight - ${x.cannot})` : '')).join('');
            const val = (x) => (x.set ? withName(a, args, x.set, k0) : x.split ? { __split: x.split } : { __cannot: x.cannot });
            e.ask = { param: '*', question: `${r.single ? 'Which time' : 'Which hours'} - ${r.labels[0]}, or ${r.labels[1]}?${note}`, choices: [r.labels[0] + (am.split ? ' (two shifts)' : ''), r.labels[1] + (pm.split ? ' (two shifts)' : '')],
              values: [val(am), val(pm)], spans: [span(m0), span(n0)], parse: 'ampm', pair, single: !!r.single };
            throw e;
          }
        }
        // (a person's, a company's or a private do never goes on the public Events page at once - asked last, after every other check has
        // read the call, so its tap puts up the event as those checks left it: privateEvent, Oct 27 2026; an event's new title too, and the
        // owner's own words for it - Oct 28 2026)
        privateEvent(c, args, ctx, conv);
      } catch (e) { if (!askedBox(e, c)) answer({ error: `${c.name}: ${e.message}` }); continue; }
      c.final = args;
      if (a.name === 'base_price_set') ctx.pendingBase = args.per_half_hour !== undefined ? args.per_half_hour : (args.per_hour !== undefined ? Math.round(args.per_hour * 50) / 100 : null);
      if (a.kind === 'read') {
        if (a.area !== 'core' || a.name === 'health_read' || a.name === 'setup_status') lookedUp = true;
        try {
          let out;
          if (a.local) out = await a.local(args, ctx);
          else {
            const q = a.request(args, ctx); const res = await ctx.call(q.method, q.path);
            // a route's own refusal is the facility's answer, not the model fumbling
            out = res.status >= 400 ? { error: `that answered ${res.status}${res.json && res.json.error ? ': ' + res.json.error : ''}`, routeSaid: true } : (a.digest ? a.digest(res.json || {}, ctx) : res.json);
          }
          answer(out);
          if (!(out && out.error) && screens.screenOf(a.name, args, ctx)) seen = { name: a.name, args };   // a guide or more_tools moves nothing
          if (ctx.boxFirstRound && conv.boxFirst && conv.boxFirst.has(c.id)) (ctx.boxReadsDone = ctx.boxReadsDone || []).push({ name: a.name, out });
        } catch (e) { answer({ error: `${c.name}: ${e.message}` }); }
        continue;
      }
      // a question with answers to tap (ask_owner): the turn ends on it, and the owner's tap is their next message
      if (a.kind === 'say') { answer({ asked: true, note: 'the owner sees the question with its answers to tap; their answer comes as their next message' }); asking = { question: args.question, choices: args.choices }; continue; }
      try {
        const request = a.build(args, ctx);
        // a new person's name is the owner's to check on the card (maintainer, Oct 24 2026: "just ask the customer if that name is right when they
        // say a name ... the end user still needs to have some accountablility")
        const p = { id: c.id, action: a.name, args, request, describe: a.describe(args, ctx) + (NAME_CARDS.has(a.name) ? ' Check the name is spelled right.' : '') + (c.runNote ? ' ' + c.runNote : ''), confirm: typeof a.confirm === 'function' ? !!a.confirm(args, ctx) : !!a.confirm, screen: screens.screenOf(a.name, args, ctx) };
        conv.pending.set(c.id, p); proposals.push(p);
        if (a.name === 'website_address_set') (conv.domainPending = conv.domainPending || new Map()).set(c.id, String(args.domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
      } catch (e) {
        if (askedBox(e, c)) continue;
        (ctx.refusedWrites = ctx.refusedWrites || []).push({ name: c.name, why: String(e.message || '') });
        answer({ error: `${c.name}: ${e.message}` });
      }
    }
    // A REFUSED CHANGE IS NEVER REPLACED IN SILENCE (Oct 24 2026, the messages set on a real Claude: "send everyone on the email list a
    // note that we're open late friday till 1am" on a unit nobody had signed up to - the newsletter was refused, and the next step put
    // up every Friday's opening hours to 1 AM with no words at all; the owner never heard the note did not go). A turn whose model says
    // nothing, after a change of it was refused, says so first - with the reason when it reads as the owner's words - and that the
    // card is a different change
    // (a change the box read itself (BOX FIRST) that the unit refused - "no bay has anything the unit can switch off": the box says why,
    // with no model round after it)
    if (ctx.boxFirstRound && !proposals.length && (ctx.refusedWrites || []).length) {
      ctx.boxFirstRound = false;
      // (the unit's reason, kept in the owner's terms: the action's name off the front, the bracketed steps written for the model out)
      const why = String((ctx.refusedWrites[0] || {}).why || '').replace(/^[a-z_]+:\s*/, '').replace(/\s*\([^()]*\b[a-z]+_[a-z_]+\b[^()]*\)?/g, '').replace(/\s*-\s*[^-]*\b[a-z]+_[a-z_]+\b.*$/, '').trim();
      const reply = why && !/\b[a-z]+_[a-z_]+\b/.test(why) ? `That could not be done: ${why}`.replace(/\.?$/, '.') : refusedSay(ctx.refusedWrites);
      conv.messages.push({ role: 'assistant', content: reply });
      return done({ conversation: conv.id, reply, proposals: [] });
    }
    // (a look-up the box read itself - "and Saturday?", "what about Bay 3?" - is answered in the box's own words, as the everyday
    // questions are: answers.js, or the model words it when the box has none)
    if (ctx.boxFirstRound && !proposals.length && ctx.boxReadsDone && ctx.boxReadsDone.length === r.toolCalls.length) {
      const words = ctx.boxReadsDone.map(x => answers.say(x.name, x.out));
      if (words.every(Boolean)) { ctx.boxFirstRound = false; const reply = words.join('\n\n'); conv.messages.push({ role: 'assistant', content: reply }); ctx.ownAnswer = true; return done({ conversation: conv.id, reply, proposals: [] }); }
    }
    ctx.boxFirstRound = false;
    if (proposals.length && !String(r.text || '').trim()) { const lost = (ctx.refusedWrites || []).filter(x => !proposals.some(p => p.action === x.name));
      if (lost.length) r.text = refusedSay(lost) + ' The card below is a different change - approve it only if you want it.'; }
    // THE MODEL'S OWN CALL, AS THE BOX PUT IT UP (Oct 22 2026, the owner's second day: SPRING10 went up with no limit, as said, and
    // the 4B told the owner "Uses: 100 total" from its own first draft): the talk keeps what was put up, never what was dropped
    if (said.tool_calls) said.tool_calls.forEach((t, i) => { const f = r.toolCalls[i] && r.toolCalls[i].final; if (f) t.function.arguments = JSON.stringify(f); });
    // (a card the box made itself is not the quick model's try: it stands as on one model - boxRound; the box's own reading that fumbled
    // is still taken over, the main model starting clean)
    if (role === 'quick' && (fumbled || (!boxRound && proposals.some(p => p.confirm)))) { takeOver(); continue; }
    // the question is said once: a model that wrote it in its words as well is not repeated
    const withQuestion = (t) => asking && !(t || '').includes(asking.question) ? [t, asking.question].filter(Boolean).join('\n\n') : (t || '');
    if (proposals.length) proposedAny = true;
    // (a change put up now goes first; the box's own question waits for its answer - applied, below)
    if (!proposals.length && !asking && conv.awaiting && conv.awaiting.length) {
      // (what was just approved is said first - the rest of a menu asked for goes on with the box's own question)
      const q = askAwaiting(conv); if (ctx.justApplied && ctx.justApplied.length) { const d = saidDone(ctx); if (d) q.reply = d + '\n\n' + q.reply; ctx.justApplied = null; }
      return done(q);
    }
    // (a change the box put up itself has no words of the model's: what was just approved is said first)
    if (proposals.length && !String(r.text || '').trim() && ctx.justApplied && ctx.justApplied.length) { r.text = saidDone(ctx); ctx.justApplied = null; }
    if (proposals.length) return done({ conversation: conv.id, reply: withQuestion(r.text), proposals: proposals.map(publicProposal), choices: asking ? asking.choices : undefined });
    if (asking) return done({ conversation: conv.id, reply: withQuestion(r.text), choices: asking.choices, proposals: [] });
    if (r.toolCalls.length) ctx.justApplied = null;
  }
  return done({ conversation: conv.id, reply: 'I could not finish that in a few steps. Try asking it a simpler way, or one thing at a time.', proposals: [] });
}

// WHAT A CHANGE'S RESULT MAY TELL THE MODEL (Oct 20 2026): plain facts under names known here, each short - never a route's
// whole answer. A shift's row carries the staff member's sign-in code, and with the owner's own AI service the result leaves
// the box. The owner's page sends a digest already (assistant.js resultOf); this holds even for a page that does not.
const SAFE_RESULT = new Set(['id', 'shift_id', 'date', 'from', 'to', 'radios', 'did', 'device', 'added', 'section', 'note', 'restored', 'key', 'status', 'name', 'joined', 'kind', 'maker', 'model', 'low_security', 'controls', 'done', 'not_sent', 'failed', 'price_cents', 'refunded', 'refund_type', 'refund_cents', 'applied', 'copied', 'skipped', 'door_console', 'pin_changed',
  // (Oct 20 2026, late) a check-in's money at the door, a flyer's public address (the email puts it at the top), a download's
  // file name and size - each a plain fact the owner's page already sends (assistant-apply.js resultOf, the flyer and download
  // ops), dropped here until now, so the model said "done" without them
  'collect_cents', 'share_cents', 'credit_to_member_cents', 'golfers', 'flyer', 'file', 'bytes',
  // (Oct 20 2026, latest) a test email or text, Stripe's refunds picked up, a card reader paired
  'sent', 'held_back', 'missing', 'why_not', 'checked', 'recorded', 'updated', 'no_stripe', 'reader',
  // (Oct 21 2026, the sandbox's note) a thermostat set now: the mode it was set for and the setpoint sent
  'mode', 'setpoint']);
const SAFE_CONTROL = ['control', 'name', 'what', 'is'];   // a paired device's controls: the model names it by one of them
function safeResult(d) {
  const plain = (v) => typeof v === 'string' ? secrets.scrub(v).text.slice(0, 200) : v;
  if (d == null) return 'ok';
  if (['string', 'number', 'boolean'].includes(typeof d)) return plain(d);
  if (typeof d !== 'object' || Array.isArray(d)) return 'ok';
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (!SAFE_RESULT.has(k)) continue;
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = plain(v);
    else if (Array.isArray(v) && v.every(x => ['string', 'number'].includes(typeof x))) out[k] = v.slice(0, 20).map(plain);
    else if (k === 'controls' && Array.isArray(v)) out[k] = v.slice(0, 20).filter(x => x && typeof x === 'object').map(x => { const o = {}; for (const f of SAFE_CONTROL) if (['string', 'number', 'boolean'].includes(typeof x[f])) o[f] = plain(x[f]); return o; });
  }
  return Object.keys(out).length ? out : 'ok';
}

/** The last thing looked up or put up in the conversation, by the box or the model - { name, args, applied, turnsAgo, afterQuestion }
 *  - or null. What came after it, so a follow-up is read only against what it can mean (the review, Oct 25 2026: "actually make it 9"
 *  was put on the base price from two turns before, after the box had asked where a pretzel goes):
 *    applied        the owner said yes and it was done (its result, which follows the call in the talk, says done)
 *    turnsAgo       how many of the owner's messages came after it, counted when turn() reads it - before the newest words are added,
 *                   so 0 is the turn just before the owner's newest words
 *    afterQuestion  a question was asked after it - the model's own with answers to tap (ask_owner), or words ending in "?" */
const NOT_A_THING = new Set(['more_tools', 'guide_search', 'guide_chapter', 'ask_owner', 'setup_skip', 'setup_status']);
const isAskOwner = (c) => !!(c && c.function && c.function.name === 'ask_owner');
function lastCallOf(conv) {
  const m = conv.messages;
  for (let i = m.length - 1; i >= 0; i--) {
    const x = m[i]; if (x.role !== 'assistant' || !Array.isArray(x.tool_calls) || !x.tool_calls.length) continue;
    for (let j = x.tool_calls.length - 1; j >= 0; j--) {
      const t = x.tool_calls[j], f = t.function || {}; if (!f.name || NOT_A_THING.has(f.name)) continue;
      let args = {}; try { args = JSON.parse(f.arguments || '{}'); } catch {}
      let applied = false, turnsAgo = 0, afterQuestion = x.tool_calls.slice(j + 1).some(isAskOwner);
      for (const y of m.slice(i + 1)) {
        if (y.role === 'user') turnsAgo++;
        else if (y.role === 'tool' && y.tool_call_id === t.id) { try { const r = JSON.parse(String(y.content || '')); if (r && r.done === true) applied = true; } catch {} }
        else if (y.role === 'assistant' && ((y.tool_calls || []).some(isAskOwner) || /\?\s*$/.test(String(y.content || '').trim()))) afterQuestion = true;
      }
      return { name: f.name, args, applied, turnsAgo, afterQuestion };
    }
  }
  return null;
}
/** What the owner did not answer is not done: the model is told, nothing is logged (nothing changed). */
function dropPending(conv, why) {
  for (const [id] of conv.pending) conv.messages.push({ role: 'tool', tool_call_id: id, content: trim({ done: false, why }) });
  conv.pending.clear();
}

/**
 * The owner said something. text has been scrubbed by their page; keysSaved says what the page saved from it.
 * ctx: { call(method, path) -> { status, json }, today, weekday, time, businessName, setup }.
 */
// THE OWNER'S SHORTHAND, READ AS MEANT (maintainer, Oct 23 2026: "Use how I chat and typo as a worst case scenario" - "2 hrs", "30 mins", and
// "free 30 days if they book 2 hrs" for thirty minutes): hours and minutes written short are written out, and days said beside a booking
// of hours are the minutes meant. The card a change is put up on says it in full, so the owner sees what was read before the yes.
function plainShort(t) {
  let s = String(t || '').replace(/\b(\d+(?:\.\d+)?)\s*hrs?\b/gi, (m, n) => `${n} hour${Number(n) === 1 ? '' : 's'}`).replace(/\bhrs\b/gi, 'hours').replace(/\bhr\b/gi, 'hour')
    // (the days and words an owner texts: "tmrw", "tonite", "this wk", "rn", "playin" - the walk, Oct 23 2026: "block bay 2 tmrw" was
    // put up for the day after tomorrow, and "how much did we make this wk" was answered with made-up numbers)
    .replace(/\b(?:tmrw|tmrow|tmr|tmw|tmorrow|tommorow|tomorow|tommorrow|tomoro|2moro|2morrow|2morow)\b/gi, 'tomorrow').replace(/\b(?:tonite|2nite|2night|tonigt)\b/gi, 'tonight')
    .replace(/\b(?:tdy|2day)\b/gi, 'today').replace(/\bwk\b/gi, 'week').replace(/\bwks\b/gi, 'weeks').replace(/\brn\b/gi, 'right now')
    .replace(/\b(\w{2,})in\b(?=\s|$|[.,!?])/gi, (m, w) => /^(?:play|go|do|book|work|com|happen|start|runn|clos|open|look|try|mak|tak|hav|charg|sell|serv)$/i.test(w) ? w + 'ing' : m)
    .replace(/^(\s*)were (?!(?:you|they|we|there|the|those|these|any|all|both|u)\b)/i, "$1we're ").replace(/\bu\b/g, 'you').replace(/\b(?:tht|thta|taht|dat)\b/gi, 'that').replace(/\b(?:wat|wut)\b/gi, 'what').replace(/(?<=\w )r(?= \w)/g, 'are').replace(/\b(?:pls|plz)\b/gi, 'please').replace(/\b(\d+)\s*mins?\b(?!\s*(?:players?|people|persons?|guests?|golfers?|age|spend|order|purchase|charge|of)\b)/gi, (m, n) => `${n} minutes`);
  if (/\bbook(?:s|ing|ed)?\b[^.?!]*\b\d+(?:\.\d+)?\s*hours?\b|\b\d+(?:\.\d+)?\s*hours?\b[^.?!]*\bbook/i.test(s) && !/\b(?:members?(?:hip)?|trial|months?|weeks?|pass(?:es)?)\b/i.test(s))
    s = s.replace(/\bfree (?:15|30|45|60|90) days?\b|\b(?:15|30|45|60|90) days? free\b/gi, (m) => m.replace(/days?/i, 'minutes'));
  return s;
}
async function turn({ conversation, text, keysSaved, ctx }) {
  const conv = (conversation && conversations.get(conversation)) || create();
  // switched from the box's own AI to the owner's own service mid-talk: what was said so far may hold customers' whole names,
  // phones and emails - none of it goes on to that company. The talk starts over (the facility's brief comes with every turn).
  const fullNow = require('./privacy').full();
  if (conv.full && !fullNow) { conv.messages = []; conv.pending.clear(); adminLog('ASSISTANT_TALK_RESTARTED', 'the owner\'s own AI service answers now: the earlier talk, with customers\' details, is not sent on'); }
  conv.full = fullNow;
  ctx.lastCall = lastCallOf(conv);   // (what was just looked up or put up - what "and Saturday?" or "no wait, Bay 3" is read against)
  dropPending(conv, 'the owner did not apply this and said something else');
  const sc = secrets.scrub(text);
  // a pasted BA-CORE-ACTION line (mcp/ba-core-mcp.js prepare_action): one action by name with its values
  const pasted = pastedAction(sc.text);
  if (pasted && pasted.error) { conv.messages.push({ role: 'user', content: '(The owner pasted a prepared action that could not be read.)' }); conv.messages.push({ role: 'assistant', content: pasted.error }); return { conversation: conv.id, reply: pasted.error, proposals: [] }; }
  if (pasted) ctx.pastedAction = pasted;
  // the owner's slips mended and the facility's own names in their own case, before anything reads the words (spelling.js; Oct 23
  // 2026 - typed the way maintainer texts, the 4B fell from 121 to 93 of 126: "turn on the vault", "whats booekd tmrw")
  let names0 = null; try { names0 = ctx && ctx.call ? await facilityNames(ctx) : null; } catch {}
  // (the menu's parts are ordinary words - "Drinks", "Food", "Beer" - and are not put in their case in the owner's own words: "$2 off
  // drinks" stays as typed - test-demo-model D9b; the box reads them for itself in intents.js)
  const mendNames = names0 ? Object.assign({}, names0, { menuParts: [] }) : names0;
  let said = pasted ? `(The owner pasted an action their own AI client prepared: ${pasted.name} with ${JSON.stringify(pasted.args).slice(0, 1500)}. Its values are the owner's own.)`
    : plainShort(spelling.mend(sc.text.slice(0, 4000), mendNames).text);
  const saved = (Array.isArray(keysSaved) ? keysSaved : []).slice(0, 10);
  if (saved.length) said += '\n\n(' + saved.map(k => k && k.ok ? `The owner's ${k.say} was saved; it ends in ${String(k.last4 || '').slice(-4)}.` : `The owner's ${k && k.say} was NOT saved: ${String(k && k.error || 'the settings refused it').slice(0, 200)}`).join(' ') + ')';
  if (sc.found.length) said += '\n\n(A key was in this message. It was removed before it reached you and was NOT saved: ask the owner to paste it again into the chat box so the page can save it.)';
  conv.messages.push({ role: 'user', content: said });
  // TAKE ME THERE (maintainer, Oct 22 2026: "if the owner wants they can say take me to schedule then the schedlue shows and they can ad
  // from there manualy. same with the pos system or the food"): words that only name a place open its screen beside the chat at
  // once - no model, no wait - where the owner works by hand (or opens it full size), or tells the assistant what to do there.
  // ("Show me our membership plans" is a question: the AI answers it, and its look-up moves the screen there too - the scored set)
  const place = !saved.length && !sc.found.length && askedPlace(said) ? ((await liveIn(said, ctx)) || placeIn(said)) : null;
  if (place) {
    const reply = `Here is ${place.name} - work on it right there beside the chat (or open it full size), or tell me what to change and I will put it up for you.`;
    conv.messages.push({ role: 'assistant', content: reply });
    return { conversation: conv.id, reply, proposals: [], screen: place.screen };
  }
  conv.areas = new Set();   // the tools asked for with more_tools last turn are not carried on (what was USED is - areasFor)
  conv.prevAreas = conv.handed ? [...conv.handed] : [];   // the parts the last turn was handed: words that name nothing answer it
  ctx.fresh = true;   // a question the owner just asked (not the answer after a change): the everyday ones are looked up first
  ctx.keysSavedNow = saved;   // (the setup guide: a key for an account moves its step on)
  const out = await run(conv, ctx);
  if (sc.found.length) out.keyRemoved = sc.found.map(f => f.say);
  return out;
}

/** A pasted "BA-CORE-ACTION {...}" line: { name, args }, { error } when it is one but cannot be used, or null. */
function pastedAction(text) {
  const m = /^\s*BA-CORE-ACTION\s+(\{[\s\S]*\})\s*$/.exec(String(text || ''));
  if (!m) return null;
  let j; try { j = JSON.parse(m[1]); } catch { return { error: 'That prepared action could not be read - copy the whole BA-CORE-ACTION line again.' }; }
  const name = j && typeof j.name === 'string' ? j.name : '';
  const args = j && j.args && typeof j.args === 'object' && !Array.isArray(j.args) ? j.args : (j && j.args === undefined ? {} : null);
  const a = actions.BY_NAME.get(name);
  if (!a || !args || name === 'more_tools') return { error: `That prepared action names something this unit cannot do${name ? ' ("' + name.slice(0, 60) + '")' : ''} - ask your AI client to list the actions again.` };
  if (JSON.stringify(args).length > 20000) return { error: 'That prepared action is too large - ask for it in smaller parts.' };
  return { name, args };
}

/** What happened to the proposals: results [{ id, applied, ok, status, error, data }]. */
async function applied({ conversation, results, ctx }) {
  const conv = conversations.get(conversation);
  if (!conv) return { error: 'that conversation is over - start again', proposals: [] };
  let seen = 0, declined = 0;
  // (each card's words, before its result takes it off the waiting list: a change only partly done is said in them - below)
  const describeOf = new Map((Array.isArray(results) ? results : []).filter(r => r && conv.pending.get(r.id)).map(r => [r.id, conv.pending.get(r.id).describe]));
  if (ctx && (Array.isArray(results) ? results : []).some(r => r && r.applied && r.ok)) ctx.appliedSomething = true;
  // the last change made, for what usually follows it (nextChoices)
  const appliedNames = (Array.isArray(results) ? results : []).map(r => r && r.applied && r.ok && conv.pending.get(r.id)).filter(Boolean).map(p => p.action);
  // (the deal, package, special or event just made in this talk - "a flyer for that" is for it: Oct 22 2026, late night)
  for (const r of Array.isArray(results) ? results : []) { const p = r && r.applied && r.ok && conv.pending.get(r.id); if (p && /^(?:deal_set|package_set|counter_special_set|event_add)$/.test(p.action)) { const a = p.args || {}; const nm = a.name || a.title || a.deal || a.package; if (nm) conv.lastThing = String(nm).slice(0, 80); }
    if (p && p.action === 'discount_code_create') { const a = p.args || {}; conv.lastCode = { kind: a.kind, value: a.value, check_at_door: a.check_at_door || '', per_person: a.per_person }; } }
  if (ctx) for (const r of Array.isArray(results) ? results : []) { const p = r && r.applied && r.ok && conv.pending.get(r.id); if (p) { ctx.lastApplied = p.action; const ds = (actions.BY_NAME.get(p.action) || {}).doneSay; (ctx.justApplied = ctx.justApplied || []).push(ds || p.describe); if (!p.confirm) (ctx.pageNoted = ctx.pageNoted || new Set()).add(ds || p.describe); } }
  for (const r of Array.isArray(results) ? results : []) {
    const p = conv.pending.get(r && r.id); if (!p) continue;
    let content; seen++;
    if (!r.applied) { content = { done: false, why: 'the owner said No - nothing was changed' }; declined++; }
    else if (r.ok) {
      // done, but not all of it: what did not answer is named in the owner's log beside the change, never folded into "done"
      // (rule 29 - every bay at once answers ok whatever each bay did)
      const failed = r.data && Array.isArray(r.data.failed) ? r.data.failed.filter(x => typeof x === 'string').slice(0, 10) : [];
      // what was done, in the words the owner approved (Oct 21 2026, night - the customer's day one): told only "done", the box's
      // small model said the owner's wish back ("10 to 11 Sunday to Thursday, 10 to 1 Friday and Saturday") over a change that
      // set 10 to 11 every day. Only on the box's own AI: the words may name a customer, and nothing more of them leaves the box
      content = Object.assign({ done: true }, require('./privacy').full() ? { what: secrets.scrub(String(p.describe || '')).text.slice(0, 400) } : {}, { result: safeResult(r.data) });
      // the failure FIRST: the log keeps 300 characters, and a long description pushed it out (test-demo-model D19b)
      adminLog('ASSISTANT_APPLIED', `${failed.length ? `PARTLY DONE - these did not answer: ${secrets.scrub(failed.join(', ')).text.slice(0, 150)}. ` : ''}${p.describe} - through the assistant, ${p.confirm ? 'approved by the owner' : 'as the owner asked'}`);
    }
    else { content = { done: false, error: `the change was refused: ${String(r.error || ('it answered ' + r.status)).slice(0, 200)}` }; adminLog('ASSISTANT_REFUSED', `${p.describe} - refused: ${String(r.error || r.status).slice(0, 150)}`); }
    conv.messages.push({ role: 'tool', tool_call_id: p.id, content: trim(content) });
    conv.pending.delete(p.id);
  }
  if (conv.pending.size) return { conversation: conv.id, waiting: [...conv.pending.keys()], proposals: [] };
  // THE OWNER SAID NO TO ALL OF IT (Oct 21 2026, night - the customer's day one): nothing changed, and the box says so itself.
  // Asked to answer, the box's small model said "This is now set" over a No the owner had just tapped; a fixed line cannot,
  // and it is a round faster. The owner's next words say what they want instead
  if (seen && declined === seen) {
    conv.awaiting = []; let reply = 'All right, I left it as it was.', choices;
    // (while the box leads the setup, the step is asked again - a No to "Open every day, 5 AM - 11 PM" left the owner with nothing to
    // answer: maintainer's try box, Oct 22 2026)
    if (conv.guideOn && conv.guide && conv.guide.id !== '__skipped') { const step = setupGuide.BY_ID.get(conv.guide.id); if (step) {
      // (the step's own card put off - "Not now" on "Choose your logo" - is the step put off: skipped, reminded later, the next asked)
      if (step.card && (Array.isArray(results) ? results : []).every(r => !r || !r.applied)) {
        const sk = boxProposal(conv, ctx || {}, 'setup_skip', { item: conv.guide.item || step.id });
        if (sk) { conv.messages.push({ role: 'assistant', content: '', tool_calls: [sk.call] }); (conv.guidePassed = conv.guidePassed || new Set()).add(step.id); return { conversation: conv.id, reply: '', proposals: [publicProposal(sk.p)] }; }
      }
      const q = setupGuide.question(step, cfgNow()); reply += ' ' + q.text; choices = q.choices; conv.guide.text = step.ask(cfgNow()); conv.guide.taps = q.taps; } }
    conv.messages.push({ role: 'assistant', content: reply }); return { conversation: conv.id, reply, choices, proposals: [] };
  }
  // THE DOMAIN, PUT IN, THEN ASKED PLAINLY (maintainer, Oct 22 2026: "when it asked domain i gave it the testing.com and it should have just
  // put it in the box there. but it got confused and started asking about cloudflare"): the box asks itself whether it is bought yet -
  // the owner's answer is read in run (setupAnswers.domainOwned); "I already own rapidgolf.com" said so already
  const addrSet = (Array.isArray(results) ? results : []).map(r => r && r.applied && r.ok && conv.domainPending && conv.domainPending.get(r.id)).find(Boolean);
  if (addrSet) {
    conv.domainPending = null;
    const said = setupAnswers.domainOwned(lastUserText(conv));
    if (said === 'own' && /\b(?:own|owned|bought|registered|paid|our (?:domain|site|website) is)\b/i.test(lastUserText(conv))) {
      const reply = setupAnswers.DOMAIN_SAID.own(addrSet);
      if (conv.guideOn && ctx) return guideNext(conv, ctx, reply);
      conv.messages.push({ role: 'assistant', content: reply }); return { conversation: conv.id, reply, proposals: [], choices: nextChoices(ctx || {}) };
    }
    conv.domainAsked = addrSet; const reply = setupAnswers.DOMAIN_Q(addrSet);
    conv.messages.push({ role: 'assistant', content: reply });
    return { conversation: conv.id, reply, choices: setupAnswers.DOMAIN_CHOICES.slice(), proposals: [] };
  }
  // the next change waiting on the owner's answer (A BOX-ASKED CHOICE): asked now, by the box
  if (conv.awaiting && conv.awaiting.length) return askAwaiting(conv);
  // (an account's last piece saved - the From address, the Twilio number - in a walk: the walk's own steps after the keys go on first)
  if (conv.walk && ctx && appliedNames.some(n => n === 'email_sender_set' || n === 'texting_number_set')) {
    const svc = conv.walk.svc, it = (ctx.setup || []).find(i => i.id === svc);
    if (it && it.done) {
      const steps = setupGuide.walkSteps(svc), from = Math.max(conv.walk.i, setupGuide.keysDone(svc, steps)) + 1, said = `Saved - ${setupGuide.BY_ID.get(svc).connected}`;
      if (from < steps.length) { ctx.justApplied = null; return walkShow(conv, svc, from, said + ' Next:'); }
      conv.walk = null; walkAt.delete(svc);
      if (conv.guideOn) { ctx.justApplied = null; return guideNext(conv, ctx, said); }
    }
  }
  // THE SETUP GUIDE: a setup step answered (or skipped) - what was done, then the box's next step, with no model round
  if (conv.guideOn && ctx && appliedNames.some(n => GUIDE_ACTS.has(n))) {
    for (const n of appliedNames) if (STEP_OF[n]) (conv.guidePassed = conv.guidePassed || new Set()).add(STEP_OF[n]);
    // (the logo saved but its app icons not made from it: said once - the step is not asked again)
    const logoNote = appliedNames.some(n => n === 'logo_upload' || n === 'logo_from_photo') && (ctx.setup || []).some(i => i.id === 'branding' && !i.done)
      ? 'Your logo is up on your website. The app icons could not be made from that picture - a square PNG or JPG works best, and you can add another any time.' : '';
    const lead = [conv.guideSkipSay, saidDone(ctx), logoNote].filter(Boolean).join('\n\n'); conv.guideSkipSay = null; ctx.justApplied = null;
    return guideNext(conv, ctx, lead);
  }
  // A CHANGE THE BOX READ ITSELF (BOX FIRST), DONE: the box says so in the words the owner approved - no model round after it
  const res = Array.isArray(results) ? results : [];
  if (ctx && conv.boxFirst && res.length && res.every(r => r && conv.boxFirst.has(r.id))) {
    res.forEach(r => conv.boxFirst.delete(r.id));
    const bad = res.find(r => r.applied && !r.ok);
    // DONE, BUT NOT ALL OF IT (rule 29 - the review, Oct 25 2026): every bay at once answers ok whatever each bay did, and "turn off all
    // the bays" with a plug that did not answer was told as "Done - ..." - the card had promised "If a device on a bay does not answer, I
    // will say which". What did not answer is named, the change said as partly done, with the way to check each bay; a change made
    // with no card is said too (the page's own "Done: ..." note does not name it)
    const failedOf = (r) => (r && r.applied && r.ok && r.data && Array.isArray(r.data.failed) ? r.data.failed.filter(x => typeof x === 'string' && x.trim()).slice(0, 10) : []);
    const part = res.filter(r => failedOf(r).length);
    if (!bad && part.length) {
      const what = (r) => String(describeOf.get(r.id) || 'That change').split(/(?<=\.)\s+/)[0].replace(/\.$/, '').replace(/:\s[\s\S]*$/, '');
      const reply = part.map(r => `Partly done - ${what(r)}, but these did not answer: ${secrets.scrub(failedOf(r).join(', ')).text.slice(0, 300)}.`).join('\n') + ' Ask me "how are the bays doing" to check each one.';
      conv.messages.push({ role: 'assistant', content: reply });
      return { conversation: conv.id, reply, proposals: [], choices: ['How are the bays doing?'] };
    }
    const reply = bad ? `That could not be done: ${String(bad.error || 'it was refused').slice(0, 200)}` : saidDone(ctx);
    if (reply) conv.messages.push({ role: 'assistant', content: reply });
    return { conversation: conv.id, reply: reply || undefined, proposals: [], choices: bad ? undefined : nextChoices(ctx) };
  }
  // the owner's own AI service answers from this change on (the owner just switched to it): the talk so far may hold
  // customers' whole names, phones and emails, so none of it goes on - it starts over, and these words are the box's own
  if (conv.full && !require('./privacy').full()) {
    conv.messages = []; conv.full = false;
    adminLog('ASSISTANT_TALK_RESTARTED', 'the owner\'s own AI service answers now: the earlier talk, with customers\' details, is not sent on');
    return { conversation: conv.id, reply: 'Done - your connected AI model answers from now on. What we said before stays on this unit; ask me again what you need.', proposals: [] };
  }
  return run(conv, ctx);
}

module.exports = { turn, applied, brief, rules, now, conversations, MAX_ROUNDS, safeResult, areasFor, AREA_WORDS, AREA_HINTS, namesIn, placeIn, EVERYDAY,
  // (the turn's own readings, for test-box-flow.js)
  lastCallOf, secondAsk, changeAsked, answerOnly };
