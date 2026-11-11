// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/assistant/setupguide.js - THE FIRST SETUP, LED BY THE BOX (Oct 22 2026)
//
//  maintainer, on his try box: "talk to the 4b like an un educated person. it needs to be more guide like on the start up and help them
//  out if they say something it does not know it can guide them towards the next steps to fully get the stripe, resend, twilio,
//  website, hours all set. they can skip twilio or something but it reminds them later but ... they ... are asked about all the
//  setup what the wizard used to do now the ai can guide them through it."
//
//  So the box asks every setup step itself, in plain words and in one order, never leaving the next step to the small model:
//  each step is a setup-checklist item (routes/admin.js /setup-status) with the box's own question, what it is for (said when
//  the owner is lost), its answers to tap, and - for the outside accounts - the steps to make one (from the guide's own chapters:
//  Setting Up Payments, Setting Up Email, Setting Up Text Messaging). Any step may be skipped: it is kept on the checklist and
//  the box reminds the owner when they next open the chat (setup_skip, config setupSkipped). What the owner answers is read by
//  the setup answers (setupanswers.js) or by the model as before; the box asks the next step once the change is made.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

const SKIP = 'Skip for now';
const membersOnly = (cfg) => !!(((cfg || {}).booking || {}).membersOnly), whole = (cfg) => !!(((cfg || {}).booking || {}).wholeFacility);
const domainOf = (cfg) => String(((cfg || {}).seo || {}).domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

// each step: the checklist id, a short name (said in reminders), the question, what it is for, the answers to tap (and the change
// a tapped answer makes at once, without the model), and the steps for an outside account ("help") or for one already made ("have")
const STEPS = [
  { id: 'citystate', name: 'your city', words: /\bcity\b|\bstate\b/i, ask: () => 'What city and state are you in? (like "Omaha, NE")',
    why: 'Your city goes into how Google and other search sites show your business to people nearby. Just the city and state is enough.' },
  { id: 'domain', name: 'your website address', words: /\bdomain\b|\bwebsite\b|\bweb ?site\b|\.com\b/i, ask: () => 'Do you have a website address - a domain like yourgolf.com? Type it here, or tap "I don\'t have one yet".',
    why: 'A website address (a "domain") is the name people type to find your site, like yourgolf.com. If you do not have one, that is fine - you can buy one later when you put the box online, and everything works without it until then.',
    choices: ["I don't have one yet"], taps: { "I don't have one yet": 'skip' }, no: 'skip',
    skipWords: /\b(?:don'?t|do not) have (?:one|it|a (?:domain|website|web ?site))\b|\bno (?:domain|website|web ?site)\b|^\s*(?:none|not yet|no)\b/i,
    skipSay: 'No problem - the box runs without one, and nothing is lost by waiting. When you want your site on the internet, say "get my box online" and I will walk you through buying one and connecting it.' },
  { id: 'confirmbays', name: 'your bays', words: /\bbays?\b|\bsimulators?\b/i, ask: (cfg) => 'How many golf simulator bays do you have, and what do you call them? (like "3 bays", or "Bay 1, Bay 2 and The Vault")'
      + (whole(cfg) ? ' One booking takes them all - each still gets its own name, so its own equipment can be set up.' : ''),
    why: 'Each bay gets its own schedule, so customers can book it. If you just say how many, they are named Bay 1, Bay 2 and so on - you can rename them any time.' },
  { id: 'access', name: 'how customers get in', words: /\bdoor codes?\b|\bstaffed\b|\bmix\b|\bhybrid\b/i, ask: () => 'How do customers get in? Is someone always working there, is it door codes with nobody there, or a mix of both?',
    why: 'This decides how people pay and get in. With someone working, customers can pay at the counter. With nobody there, they pay online when they book and get a door code. A mix does each at its own times.',
    choices: ['Someone is always there', 'Door codes, nobody there', 'A mix of both'],
    taps: { 'Someone is always there': ['access_style_set', { style: 'staffed' }], 'Door codes, nobody there': ['access_style_set', { style: 'unstaffed' }], 'A mix of both': ['access_style_set', { style: 'hybrid' }] } },
  { id: 'confirmhours', also: ['hours'], name: 'your opening hours', ask: () => 'What are your opening hours? (like "10am to 11pm every day", "noon to 10 weekdays, 9am to midnight weekends", or "open 24/7")',
    why: 'Customers can only book inside your opening hours. Different hours on different days are fine - just say them.' },
  { id: 'staffedhours', name: 'your staffed hours', ask: () => 'Which days and hours is someone working there? (like "weekends 10am to 10pm", or "Thursday to Saturday 4 to 11")',
    why: 'During the hours someone is working, customers can pay at the counter. The rest of the time they pay online when they book and get a door code.' },
  // (asked the way the facility runs - maintainer, Oct 25 2026, the members-only club that hands over the whole building: "if a facility picks a
  // certain way ... the a I will ask them those questions"; a members' sentence never ends in "?" - setupanswers.js reads the price from
  // the question's own "?" sentence, and a question about members is not the price's)
  { id: 'confirmprice', also: ['wfrate'], name: 'your price', ask: (cfg) => (whole(cfg) ? 'What do you charge to book the whole facility? (like "$80 an hour", or "$80 an hour, $100 after 5pm and weekends")'
      : 'What do you charge for a bay? (like "$40 an hour", or "$40 an hour, $50 after 5pm and weekends")')
      + (membersOnly(cfg) ? ' Members pay this for each booking, less what their membership takes off (or nothing, if it includes the time) - you set that with the membership.' : ''),
    why: 'This is what customers pay to book a bay. Busy-time prices, memberships and deals can all be added later - just tell me.' },
  { id: 'confirmwaiver', name: 'waivers', words: /\bwaivers?\b/i, ask: (cfg) => `Do ${membersOnly(cfg) ? 'members' : 'customers'} need to sign a waiver before they play?`,
    why: 'A waiver is your own document that customers sign online when they book. You upload it and the box keeps every signature. What it says is up to you and your own lawyer.',
    choices: ['Yes, everyone signs', 'Make it optional', 'No waivers'], yes: 'Yes, everyone signs', no: 'No waivers',
    taps: { 'Yes, everyone signs': ['waiver_mode_set', { mode: 'required' }], 'Make it optional': ['waiver_mode_set', { mode: 'optional' }], 'No waivers': ['waiver_mode_set', { mode: 'off' }] } },
  { id: 'waiverdoc', also: ['mwaiver'], name: 'your waiver document', card: 'waiver_upload', words: /\bwaivers?\b|\bpdf\b/i,
    skipWords: /\b(?:don'?t|do not) have (?:one|it|a pdf|the pdf|a waiver|the waiver)\b|\bno (?:pdf|waiver document)\b/i, ask: () => 'Do you have your waiver as a PDF? Tap "Choose your waiver PDF" just below and pick it - nobody is asked to sign until it is there. Not ready yet? Tap "Not now".',
    why: 'Customers sign the waiver you upload. Until a PDF is on the Waivers screen, nobody is asked to sign anything. Your own lawyer writes or reviews it - the box only shows it and keeps the signatures.',
    choices: ['Take me to waivers'] },
  { id: 'tier', name: 'your first membership', ask: () => 'Your club is members-only, so nobody can join until there is a membership. What do you want to call it, and what does it cost a month?',
    why: 'Members-only means only members can book. A membership has a name and a monthly price - free hours or a lower price per hour can come with it.' },
  { id: 'checkin', name: 'check-in', ask: () => 'With nobody working there, most places turn check-in off - customers just come in with their door code. Turn check-in off?',
    why: 'Check-in is a staff member marking a customer as arrived. With nobody there to do it, most places switch it off.',
    choices: ['Yes, turn it off', 'Leave it on'], yes: 'Yes, turn it off', no: 'Leave it on', taps: { 'Yes, turn it off': ['checkin_mode_set', { mode: 'off' }], 'Leave it on': ['checkin_mode_set', { mode: 'full' }] } },
  { id: 'stripe', name: 'card payments (Stripe)', connected: 'Card payments (Stripe) are connected.', words: /\bstripe\b|\bpayments?\b|\bcards?\b|\bget(?:ting)? paid\b/i, ask: (cfg) => `Next, getting paid. ${membersOnly(cfg) ? 'Members pay for their membership by card' : 'Customers pay by card when they book'}, through a company called Stripe. Do you have a Stripe account yet?`,
    why: 'Stripe is the company that takes the card payments and puts the money in your bank account. Without it, people can book but nobody pays online.',
    choices: ['Yes, I have one', 'No, help me make one'], yes: 'have', no: 'help',
    help: () => 'Here is how - it takes 30 to 60 minutes, mostly Stripe checking your business:\n1. Go to stripe.com and sign up with your business email.\n2. Follow the "Activate your account" steps: your business name and EIN, your address, the bank account for your money, and the owner\'s details.\n3. Then in Stripe, open Developers, then API keys. You will see two keys: the Publishable key (starts with pk_live_) and the Secret key (starts with sk_live_ - click to show it).\n4. Copy each one and paste it here in the chat, one at a time. I save it straight onto the box - it never goes anywhere else.\n\nTake your time - paste the first key whenever you have it.',
    have: () => 'Great. In Stripe, open Developers, then API keys. Copy the Publishable key (starts with pk_live_) and the Secret key (starts with sk_live_ - click to show it), and paste each one here, one at a time. I save it straight onto the box.' },
  { id: 'resend', name: 'email (Resend)', connected: 'Email (Resend) is connected.', words: /\bemails?\b|\bresend\b/i, ask: (cfg) => domainOf(cfg) ? 'Next, email. The box emails customers their confirmations and door codes through a free service called Resend. Do you have a Resend account yet?'
      : 'Next, email. The box emails customers their confirmations and door codes through a free service called Resend - it needs your own website address, which you do not have yet. Set it up when your box goes online?',
    why: 'Resend is the free service that sends the box\'s emails - confirmations, reminders and door codes. It sends from your own website address so the emails do not land in spam.',
    choices: (cfg) => domainOf(cfg) ? ['Yes, I have one', 'No, help me set it up'] : ['OK, remind me later'],
    // (with no website address yet the question is "set it up when your box goes online?": a yes or a no both put it off - the walk-through)
    yes: (cfg) => domainOf(cfg) ? 'have' : 'skip', no: (cfg) => domainOf(cfg) ? 'help' : 'skip',
    taps: (cfg) => domainOf(cfg) ? {} : { 'OK, remind me later': 'skip' },
    help: (cfg) => `Here is how - about 20 minutes, most of it waiting:\n1. Go to resend.com and sign up with your business email (the free plan is plenty).\n2. In Resend, open Domains, then Add Domain, and type ${domainOf(cfg) || 'your website address'}.\n3. Resend shows a few records. Add each one where your domain's settings live (if it is on Cloudflare, that is Cloudflare's DNS page) - copy and paste them exactly.\n4. Back in Resend, press Verify. It can take a few minutes to a few hours.\n5. Then open API Keys, then Create API Key, give it Sending access, and paste the key here (it starts with re_). I save it straight onto the box.\n\nPaste the key whenever you have it.`,
    have: () => 'Great. In Resend, open API Keys, then Create API Key (give it Sending access), and paste the key here - it starts with re_. I save it straight onto the box.' },
  { id: 'twilio', name: 'text messages (Twilio)', connected: 'Text messages (Twilio) are connected.', words: /\btexts?\b|\btexting\b|\btwilio\b|\bsms\b/i, ask: () => 'Next, text messages - this one is optional. The box can text customers their confirmations and door codes through a company called Twilio. It costs about $1 a month plus about a penny a text, and the phone companies take a few days to approve it. Want to set it up?',
    why: 'Texts are handy because people read them quickly, but they are optional - customers still get everything by email. You can set texting up any time.',
    choices: ['Yes, help me set it up', 'I have Twilio already'], yes: 'help', no: 'skip',
    help: () => 'Here is how - about an hour, then a few days of waiting for approval (everything works by email meanwhile):\n1. Go to twilio.com and sign up with your business email. When it asks what you want to build, pick SMS.\n2. Click Upgrade and add a card - a trial account can only text your own phone.\n3. Buy a phone number: Phone Numbers, then Buy a Number - pick a local one with SMS.\n4. On the Twilio home page, copy the Account SID (starts with AC) and paste it here, then the Auth Token (click to show it) and paste that too. Then tell me the number you bought.\n5. Twilio then asks you to register your business for texting (it may say "A2P 10DLC"). It takes a few days - I can walk you through it when you get there.',
    have: () => 'Great. On the Twilio home page, copy the Account SID (starts with AC) and paste it here, then the Auth Token (click to show it). Then tell me your Twilio phone number.' },
  // (its card asked with it - maintainer's try box, Oct 22 2026: told to "tap the paperclip", he added a website photo with the picture button
  // and the logo was never set; the card's own "Not now" puts the step off)
  { id: 'branding', name: 'your logo', card: 'logo_upload', words: /\blogo\b|\bicons?\b/i, skipWords: /\b(?:don'?t|do not) have (?:one|it|a logo|any)\b|\bno logo\b/i, ask: () => 'Do you have a logo? Tap "Choose your logo" just below and pick the picture of it - it goes on your website and becomes the icon people save to their phone. No logo yet? Tap "Not now".',
    why: 'Your logo shows at the top of your website and on the icon people save to their phone. A photo or a picture file of it works.' },
  { id: 'backuppass', name: 'a backup passphrase', words: /\bbackups?\b|\bpass ?phrase\b/i, ask: () => 'Last safety step: a backup passphrase. It locks the copies of your data that leave this box (like a USB stick). Pick something you will remember - you type it in a private box, never in the chat.',
    why: 'Your bookings, customers and money records live on this box. A passphrase locks any copy that leaves it, so nobody who finds a USB stick can read it. Without one, copies just stay on the box.',
    choices: ['Set a backup passphrase'], yes: 'Set a backup passphrase', no: 'skip', taps: { 'Set a backup passphrase': ['backup_passphrase_set', {}] } },
  { id: 'staffedcopy', name: 'your website words', ask: () => 'Your website\'s words say customers let themselves in. Since someone works there, want me to change them to say staff are there to help?',
    why: 'The words on your website started out written for a place with nobody working. With staff there, you may want them to say so.',
    choices: ['Yes, change them', 'Leave them'], no: 'skip', taps: { 'Leave them': 'skip' } },
  { id: 'golive', name: 'opening your site', words: /\bgo live\b|\bopen (?:it|the site|my site)\b|\bpublic\b/i, ask: () => 'That is the basics done! Your website still shows "not yet public" to visitors. Ready to open it so customers can see it and book?',
    why: 'Until you open it, visitors see a "not yet public" page. Opening it lets customers see your site and book. You can close it again any time.',
    choices: ['Yes, open it', 'Not yet'], yes: 'Yes, open it', no: 'skip', taps: { 'Yes, open it': ['site_go_live', {}], 'Not yet': 'skip' } },
];
const BY_ID = new Map(); for (const s of STEPS) { BY_ID.set(s.id, s); for (const a of s.also || []) BY_ID.set(a, s); }

/** The checklist items still open, as guide steps in the guide's order: [{ step, item }] (an item no step names is left out). */
function openSteps(items) {
  const open = (items || []).filter(i => i && !i.done);
  const out = [];
  for (const s of STEPS) { const it = open.find(i => i.id === s.id || (s.also || []).includes(i.id)); if (it) out.push({ step: s, item: it }); }
  return out;
}
/** The next step to ask: the first open one not skipped (`passed`: ids passed over in this talk). */
function next(items, passed) {
  const p = passed || new Set();
  return openSteps(items).find(x => !x.item.skipped && !p.has(x.step.id)) || null;
}
const isFn = (v) => typeof v === 'function';
/** The box's question for a step: { text, choices, taps } (a step that may be skipped offers it). */
function question(step, cfg, lead) {
  const choices = (isFn(step.choices) ? step.choices(cfg) : step.choices || []).slice();
  if (!choices.some(c => /remind me later|not yet|skip/i.test(c))) choices.push(SKIP);
  const taps = Object.assign({}, isFn(step.taps) ? step.taps(cfg) : step.taps || {}, { [SKIP]: 'skip' });
  return { text: (lead ? lead + '\n\n' : '') + step.ask(cfg), choices, taps };
}

// what the owner's words are, to the box's question: a skip, lost, wanting the steps, already having the account - or an answer
const SKIP_W = /^\s*(?:skip(?: (?:it|this|that|for now|this one|that one))?|(?:maybe |do it )?later|not now|not yet|next|pass|no thanks?|nah|i'?ll do (?:it|that) later|come back to (?:it|that)(?: later)?|ok,? remind me later|remind me later|move on|i don'?t want (?:it|that|texting|texts))\s*[.!]*\s*$/i;
const LOST_W = /^\s*(?:huh|what|wut|wat|eh|um+|uh+|idk|i don'?t know|dunno|no idea|not sure|i'?m not sure|i don'?t understand|i don'?t get it|confused|i'?m confused|what\?*|what does that mean|what do you mean|what is (?:that|this|it)|what'?s (?:that|this)|why|why do i need (?:that|this|it)|do i need (?:that|this|it)|help|explain|explain (?:that|it)|\?+)\s*[?.!]*\s*$/i;
// (the walk's own buttons - "No, help me make one", "No, help me set it up" - and the ways an owner says the same: the button said
// "set it up" and the pattern "set up it", so the walk never started - the 4B walk-through, Oct 22 2026)
const HELP_W = /^\s*(?:(?:no|nope|nah|not yet|yes|yeah|ok(?:ay)?)[,.]?\s*)?(?:please\s+)?(?:help me(?: (?:make|set|get|create|do|start|open|with)(?: up)?(?: (?:one|it|that|an account|this))?(?: up)?)?|(?:i )?(?:need|want) help(?: (?:setting|making|getting) (?:it|one|that) up)?|(?:i )?(?:don'?t|do not|dont) have (?:one|it|an account|that)(?: yet)?(?:,? help(?: me)?)?|how do i (?:make|get|set up|create|do|start) (?:one|it|that|an account)|walk me through (?:it|that|this)|show me how|let'?s (?:make|do|set up|start) (?:one|it|that)|set (?:it|one) up(?: for me)?|make one)\s*[.!]*\s*$/i;
const HAVE_W = /^\s*(?:yes,? i have (?:one|it|an account)|i have (?:one|it|an account|twilio|stripe|resend)(?: already)?|i have twilio already|i do|already have (?:one|it)|i already have (?:one|it))\s*[.!]*\s*$/i;
// a bare yes or no means what the step's question asked: "do you have an account?" (yes: have it, no: the steps) or "want to set it up?"
// (yes: the steps, no: skip)
const YES_W = /^\s*(?:(?:ok(?:ay)?|yes|yeah|sure|alright|all right)[, ]+)?(?:yes|yep|yeah|yup|sure|ok(?:ay)?|y|ya|definitely|of course|let'?s do (?:it|that|this)|lets go|go ahead|do it|sounds good|why not)(?: please)?\s*[.!]*\s*$/i, NO_W = /^\s*(?:no|nope|n|not really|no i don'?t|nah)\s*[.!]*\s*$/i;
function read(step, words, cfg) {
  const w = String(words || '').trim();
  const q = question(step, cfg);
  const tap = Object.keys(q.taps).find(k => k.toLowerCase() === w.toLowerCase().replace(/[.!]+$/, ''));
  if (tap) return q.taps[tap] === 'skip' ? { kind: 'skip' } : { kind: 'tap', call: q.taps[tap] };
  // (and a short answer that plainly puts it off - "i dont have it yet", "ok ill do that later", "not right now" - the walk-through)
  const LATER = /\b(?:later|not (?:yet|right now|now|today)|(?:idk|i don'?t know|dunno|not sure|no idea) yet|(?:don'?t|do not) have (?:it|one|that|a \w+) yet|haven'?t (?:got|made|done) (?:it|one|that)(?: yet)?|another time|some ?other time|tomorrow)\b/i;
  // (a yes-or-no question's own No comes before a skip: "nah" to "Do customers need to sign a waiver?" was put off as a skip and the
  // waiver PDF asked for next - test-setup-guide G3, Oct 22 2026)
  { const n1 = isFn(step.no) ? step.no(cfg) : step.no; if (n1 && n1 !== 'skip' && NO_W.test(w) && q.taps[n1] !== undefined) return q.taps[n1] === 'skip' ? { kind: 'skip' } : { kind: 'tap', call: q.taps[n1] }; }
  // (for an account, "no I don't have one yet" is the walk, never a skip - the 4B walk-through, Oct 22 2026)
  if (step.help && HELP_W.test(w) && !SKIP_W.test(w)) { const y0 = isFn(step.yes) ? step.yes(cfg) : step.yes, n0 = isFn(step.no) ? step.no(cfg) : step.no; if (!(y0 === 'skip' && n0 === 'skip')) return { kind: 'help' }; }
  if (SKIP_W.test(w) || (step.skipWords && step.skipWords.test(w) && w.split(/\s+/).length <= 12) || (LATER.test(w) && w.split(/\s+/).length <= 9 && !/\?/.test(w))) return { kind: 'skip' };
  if (LOST_W.test(w)) return { kind: 'lost' };
  // ("done", "ok done", "all done", "thanks" to a question the box asked are not an answer - the 4B filled one in with a made-up list of
  // what was set up, "Logo: Uploaded" among it: the box asks again itself)
  if (/^\s*(?:done|ok(?:ay)? done|all done|i'?m done|finished|thanks?|thank you|cool|great|got it|k|kk|sounds good)\s*[.!]*\s*$/i.test(w)) return { kind: 'again' };
  // "what is a waiver", "whats a domain", "what does stripe do" - about the step itself: the box's own words, never the model's (a waiver
  // was "a legal agreement" in the 4B's - rule 15 keeps legal words out of the box's mouth)
  if (step.words && /^\s*(?:what(?:'?s| is| are| does| do)?|wh?at)\b[^.?!]{0,30}[?.!]*\s*$/i.test(w) && step.words.test(w) && w.split(/\s+/).length <= 7 && !/\b(?:cost|price|how much|long|much)\b/i.test(w)) return { kind: 'lost' };
  const yes = isFn(step.yes) ? step.yes(cfg) : step.yes, no = isFn(step.no) ? step.no(cfg) : step.no;
  if (yes === 'skip' && YES_W.test(w)) return { kind: 'skip' };
  if (step.help && HELP_W.test(w) && !(yes === 'skip' && no === 'skip')) return { kind: 'help' };
  if (step.have && HAVE_W.test(w) && !(yes === 'skip' && no === 'skip')) return { kind: 'have' };
  // (a yes or a no that stands for one of the step's own answers - "ok lets do it" to the passphrase is "Set a backup passphrase")
  const asTap = (k) => q.taps[k] !== undefined ? (q.taps[k] === 'skip' ? { kind: 'skip' } : { kind: 'tap', call: q.taps[k] }) : { kind: k };
  if (yes && YES_W.test(w)) return asTap(yes);
  if (no && NO_W.test(w)) return asTap(no);
  return null;
}
function lost(step, cfg) { const q = question(step, cfg); return Object.assign(q, { text: step.why + '\n\n' + step.ask(cfg) }); }
function steps(step, cfg, kind) { const f = step[kind]; const q = question(step, cfg); return { text: f(cfg), choices: [SKIP], taps: { [SKIP]: 'skip' }, step: q }; }

/** The hello as the chat opens while setup is going: a first welcome, a welcome back with what is left, or a reminder of what was skipped. */
function hello(items, cfg, { first, business, today, remindedOn } = {}) {
  const open = openSteps(items), waiting = open.filter(x => !x.item.skipped), skipped = open.filter(x => x.item.skipped);
  if (waiting.length) {
    const s = waiting[0].step;
    const lead = first ? `Welcome${business ? ' to ' + business : ''}! I will walk you through setting things up, one question at a time - about 15 minutes. You can say "skip" to anything and come back to it later, and your site stays private until you say it is ready.`
      : `Welcome back! ${waiting.length === 1 ? 'One setup step is left' : `${waiting.length} setup steps are left`}: ${waiting.slice(0, 4).map(x => x.step.name).join(', ')}${waiting.length > 4 ? ' and more' : ''}.${skipped.length ? ` (You skipped ${skipped.slice(0, 4).map(x => x.step.name).join(', ')}${skipped.length > 4 ? ' and more' : ''} - I will come back to ${skipped.length === 1 ? 'it' : 'those'}.)` : ''}`;
    return Object.assign(question(s, cfg, lead), { step: s });
  }
  if (skipped.length && remindedOn !== today) {
    const s = skipped[0].step;
    const lead = `Welcome back! A reminder: you skipped ${skipped.slice(0, 3).map(x => x.step.name).join(', ')} during setup.`;
    return Object.assign(question(s, cfg, lead), { step: s, reminder: true });
  }
  return null;
}

/** What a service still needs once a key is pasted: { text, ask?: a box question the next words answer } - or null when it is all there. */
function stillNeeds(id, cfg) {
  const c = cfg || {}, st = c.stripe || {}, rs = c.resend || {}, tw = c.twilio || {}, d = domainOf(c);
  if (id === 'stripe') {
    if (st.secretKey && !st.publishableKey) return { text: 'Got your Secret key. Now paste the Publishable key - it starts with pk_live_ and is on the same page in Stripe.' };
    if (st.publishableKey && !st.secretKey) return { text: 'Got your Publishable key. Now paste the Secret key - it starts with sk_live_ (click "Reveal" in Stripe to see it).' };
  }
  if (id === 'resend' && rs.apiKey && !String(rs.fromEmail || '').trim())
    return { text: `Got your Resend key. What address should your emails come from? Use your own website address${d ? `, like bookings@${d}` : ''}.`, ask: { name: 'email_sender_set', param: 'from_email', parse: 'email' } };
  if (id === 'twilio') {
    if (tw.accountSid && !tw.authToken) return { text: 'Got your Account SID. Now paste the Auth Token - on the Twilio home page, click to show it.' };
    if (tw.accountSid && tw.authToken && !tw.phoneNumber) return { text: 'Got it. What is your Twilio phone number - the one you bought?', ask: { name: 'texting_number_set', param: 'phone', parse: 'phone' } };
  }
  return null;
}

/** The steps put off, to offer once the rest are done: [{ step, item }]. */
function skippedSteps(items) { return openSteps(items).filter(x => x.item.skipped); }
// a city said alone, to the city question ("minneapolis"): the box asks the state
const LONE_CITY = /^\s*(?:(?:we'?re |we are |it'?s |its )?(?:in |at )?)?([a-z][a-z .'-]{1,38}[a-z])\s*[.!]*\s*$/i;
// (never words that ask for something - "Go live" to the city question was asked its state: test-setup-talk T5, Oct 22 2026 - nor
// words about another step)
const NOT_A_CITY = /\b(?:skip|later|yes|yeah|yep|no|nope|ok|okay|sure|idk|what|how|why|huh|help|not|don'?t|bays?|open|close|hours?|go|live|public|launch|publish|book|make|set|add|show|take|turn|change|thanks?|hello|hi|hey|price|waivers?|stripe|email|texts?|logo|backup|done|next|stop|cancel|undo)\b/i;
function loneCity(words) { const m = String(words || '').match(LONE_CITY); if (!m || m[1].split(/\s+/).length > 4 || NOT_A_CITY.test(m[1]) || STEPS.some(s => s.words && s.id !== 'citystate' && s.words.test(m[1]))) return null; return m[1].replace(/\b[a-z]/g, c => c.toUpperCase()); }

// ── AN ACCOUNT, WALKED A STEP AT A TIME (maintainer, Oct 22 2026: "try it insted of skipping things go through it. like if someone says lets do
// rhe twilio or resend or stripe and see if it walks them through it. if they dont have any of that yet most of them wont so they will
// need more guidence ... the documents will need to be really good for the 4b or 8b") ──────────────────────────────────────────────
// The steps are the guide's own (knowledge.chapters: a chapter's "**STEP n - title**" lines, in the parts the first setup needs), so
// the box walks exactly what the documents say and the model answers questions from the same chapter. One step at a time: "Done -
// next step", "I'm stuck", back, skip.
const WALKS = {
  stripe: { chapter: /^Setting Up Payments$/i, parts: /^Part [1-3]\b/i, keys: /api keys|enter the keys|paste/i },
  resend: { chapter: /^Setting Up Email$/i, parts: /^Part [1-4]\b/i, keys: /api key|generate the key|enter it|paste/i },
  twilio: { chapter: /^Setting Up Text Messaging$/i, parts: /^Part [1-3]\b/i, keys: /credentials|account sid|auth token/i,
    // (the words to paste, kept once in the chapter's "What to Type" part, carried into the steps that use them - a step said in the chat
    // is all the owner sees)
    include: [[/^Describe your texts/i, ['Campaign description', 'How do end-users consent']], [/^Add your sample messages/i, ['Sample messages']], [/^Connect your number/i, ['Opt-out message', 'Opt-in message', 'Help message']]] },
};
// a "**Label**" paragraph of the chapter and the pasted words under it (its italic lines)
function blocksOf(ch, labels) {
  const paras = ch.parts.flatMap(p => p.text.split(/\n{2,}/));
  const out = [];
  for (const lab of labels) {
    const i = paras.findIndex(p => p.trim().startsWith('**' + lab));
    if (i < 0) continue;
    const got = [paras[i]];
    for (let j = i + 1; j < paras.length && /^\*[^*]/.test(paras[j].trim()); j++) got.push(paras[j]);
    out.push(got.join('\n\n'));
  }
  return out;
}
const plainText = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^\*([^*\n][^\n]*?)\*[ \t]*$/gm, '$1').replace(/:\s\*([^*\n]+)\*/g, ': $1').replace(/^>\s*/gm, '').replace(/^\s*[-*]\s+\[ \]\s*/gm, '- ').replace(/`([^`]+)`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
/** The steps of an account's walk, from the guide: [{ title, text }] - or [] when the chapter is not there. */
function walkSteps(svc) {
  const w = WALKS[svc]; if (!w) return [];
  let chs = []; try { chs = require('./knowledge').chapters(); } catch {}
  const ch = chs.find(c => w.chapter.test(c.title)); if (!ch) return [];
  const out = [];
  for (const part of ch.parts.filter(p => w.parts.test(p.heading))) {
    const bits = part.text.split(/^\*\*STEP\s+([0-9a-z]+)\s*[-\u2013\u2014]\s*(.+?)\*\*\s*$/mi);
    // bits: [before, n1, title1, body1, n2, title2, body2, ...]
    if (bits.length < 4) { if (part.text.trim()) out.push({ title: part.heading.replace(/^Part \d+\s*[-\u2013\u2014]\s*/i, ''), text: plainText(part.text) }); continue; }
    // (a part's note in italics - "*Checked against Stripe's own help pages ...*" - is the reader's, not a step's)
    const pre = /^\*[^*][\s\S]*\*$/.test(bits[0].trim()) ? '' : plainText(bits[0]);
    for (let i = 1; i + 2 <= bits.length; i += 3) out.push({ title: bits[i + 1].trim(), text: plainText(((i === 1 && pre) ? pre + '\n\n' : '') + (bits[i + 2] || '')) });
  }
  for (const [re, labels] of w.include || []) { const st = out.find(x => re.test(x.title)); if (st) { const b = blocksOf(ch, labels); if (b.length) st.text += '\n\n' + plainText(b.join('\n\n')); } }
  return out;
}
/** Where an owner who already has the account starts: the step about the keys. */
function keysStep(svc, steps) { const w = WALKS[svc]; const i = (steps || walkSteps(svc)).findIndex(s => w.keys.test(s.title + ' ' + s.text.slice(0, 200))); return i < 0 ? 0 : i; }
/** The last step about the keys - once they are saved, the walk goes on after it (never the "paste the keys" step again). */
function keysDone(svc, steps) { const w = WALKS[svc], st = steps || walkSteps(svc); let last = -1; st.forEach((s, i) => { if (w.keys.test(s.title + ' ' + s.text.slice(0, 200))) last = i; }); return last < 0 ? 0 : last; }
const WALK_NAME = { stripe: 'Stripe', resend: 'Resend', twilio: 'Twilio' };
const WALK_NEXT = 'Done - next step', WALK_STUCK = "I'm stuck";
/** One step said: "Stripe - step 2 of 6: Activate the account" and the guide's words for it, with the walk's answers to tap. */
// the chapter's [brackets] filled from what the box knows - the business's name, its legal name, its address, its website - so the
// owner pastes words that are already theirs (a bracket the box cannot fill stays for them to fill)
function fillIn(text, cfg) {
  const c = cfg || {}, sv = c.server || {}, ct = c.contact || {}, host = domainOf(c);
  let t = String(text || '');
  const biz = sv.businessName || c.businessName;
  if (biz) t = t.replace(/\[Business Name\]/g, biz);
  if (sv.legalEntity || biz) t = t.replace(/\[Legal Entity Name\]/g, sv.legalEntity || biz);
  if (ct.address) t = t.replace(/\[street address\]/g, ct.address);
  if (ct.phone || ct.email) t = t.replace(/\[your phone or email\]/g, ct.phone || ct.email);
  if (host) t = t.replace(/\[(https:\/\/)?yourdomain\.com([^\]]*)\]/g, 'https://' + host + '$2').replace(/https:\/\/yourdomain\.com/g, 'https://' + host).replace(/\byourdomain\.com\b/g, host);
  return t;
}
function walkSay(svc, steps, i, cfg) {
  const s = steps[i], last = i >= steps.length - 1;
  return { text: fillIn(`${WALK_NAME[svc]} - step ${i + 1} of ${steps.length}: ${s.title}\n\n${s.text}`, cfg), choices: [last ? 'Done' : WALK_NEXT, WALK_STUCK, 'Skip for now'] };
}
// the owner's words during a walk: on, back, again, stuck, stop - or a question (null: the model answers from the chapter)
function walkRead(words) {
  const w = String(words || '').trim();
  if (/^\s*(?:done(?: - next step)?|next(?: step)?|ok(?:ay)?|got it|did it|did that|i did (?:it|that)|finished|all set|all done|that'?s done|yes|yep|yeah|go on|continue|keep going|what'?s next|ready|done,? what'?s next)\s*[.!]*\s*$/i.test(w)
    // ("OK, I'm done with that part", "finished that step", "i did that one")
    || /^\s*(?:(?:ok(?:ay)?|alright|all right|so|yes|yep)[,.]?\s+)?(?:i'?m |im |i am |we'?re |we are )?(?:done|finished|all done|through|ready)(?: with (?:that|it|this|step \d+)(?: one| part| step)?)?(?:,? (?:what'?s next|next))?\s*[.!]*\s*$/i.test(w)
    || /^\s*(?:i |we )?(?:did|finished|completed) (?:that|it|this)(?: one| part| step)?\s*[.!]*\s*$/i.test(w)) return 'next';
  if (/^\s*(?:back|go back|previous(?: step)?|last step|the step before|step back)\s*[.!]*\s*$/i.test(w)) return 'back';
  if (/^\s*(?:again|repeat(?: that)?|say (?:it|that|the step) again|what was (?:that|the step)|what step (?:am i on|was i on|are we on)|where was i|where were we)\s*[?.!]*\s*$/i.test(w)) return 'again';
  if (/^\s*(?:i'?m stuck|stuck|im stuck|help|i need help|i'?m lost|lost|it'?s not working|not working|i can'?t find it|cant find it)\s*[.!]*\s*$/i.test(w)) return 'stuck';
  if (SKIP_W.test(w) || /^\s*(?:stop|quit|i'?ll finish (?:it|this) later|later)\s*[.!]*\s*$/i.test(w)) return 'skip';
  return null;
}
// "lets do the twilio", "set up stripe", "help me with email", "walk me through texting" - which account, or null
function walkAsked(words) {
  // the words of a message being written are not a request to set anything up (Oct 23 2026, the breadth set on the 4B and on Claude:
  // "change the reminder text to say: ... at [Start]" started the texting walk - "[Start]" read as "start" beside "text"): a
  // placeholder in brackets, words in quotes and the message after "say:" are left out
  const w = String(words || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/"[^"]*"/g, ' ')
    .replace(/\b(?:say|says|read|reads|saying)\s*:.*$/s, ' ');
  if (!/\b(?:let'?s do|lets do|do the|do my|set ?up|setup|start|connect|help me (?:with|set)|walk me through|go through|get .{0,12}(?:going|done|set up)|i want (?:to )?(?:set|do)|how do i (?:set|get|do))\b/.test(w)) return null;
  if (/\bstripe\b|\b(?:card )?payments?\b|\btake cards?\b|\bget(?:ting)? paid\b/.test(w)) return 'stripe';
  if (/\bresend\b|\bemails?\b/.test(w)) return 'resend';
  if (/\btwilio\b|\btext(?:s|ing| messages?)?\b|\bsms\b/.test(w)) return 'twilio';
  return null;
}

// THE CHAPTER'S OWN ANSWERS (the walk-through on the 4B, Oct 22 2026: asked "i dont have an ein", the 4B named a menu Stripe does not
// have): each account's chapter ends with "## Stuck? Common questions - ..." - "**the question**" and the checked answer under it. A
// question that plainly is one of them gets that answer, word for word; one that is close is answered by the model with them beside it
const STOP = new Set(('the a an i im my me we our you your it its is are am was be do does did dont doesnt cant not no yes to of in on at for with ' +
  'and or but if so this that there what how where when why which who can could would should will just get got have has had up out about any ' +
  'need want see find from into than then them they he she his her one ok okay please help yet still say says show shows anything something thing ' +
  'really like just also even here').split(' '));
const stem = (w) => w.replace(/'s$/, '').replace(/(?:ing|ed|es|s)$/, (m) => (w.length > 4 ? '' : m));
// (the same thing said other ways - "when do I get my money" is "when do I get paid")
const SAME = { free: 'cost', money: 'paid', payout: 'paid', payouts: 'paid', paid: 'paid', pay: 'paid', fee: 'cost', fees: 'cost', price: 'cost', charge: 'cost', charges: 'cost', costs: 'cost',
  site: 'website', web: 'website', websites: 'website', keys: 'key', emails: 'email', texts: 'text', texting: 'text', sms: 'text', number: 'number', phone: 'number' };
const contentWords = (t) => [...new Set(String(t || '').toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(x => x.length >= 2 && !STOP.has(x)).map(x => SAME[x] || SAME[stem(x)] || stem(x)))];
function stuckList(svc) {
  const w = WALKS[svc]; if (!w) return [];
  let chs = []; try { chs = require('./knowledge').chapters(); } catch {}
  const ch = chs.find(c => w.chapter.test(c.title)); if (!ch) return [];
  const part = ch.parts.find(p => /^Stuck\?/i.test(p.heading)); if (!part) return [];
  const out = []; let cur = null;
  for (const line of part.text.split('\n')) {
    const q = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (q) { cur = { q: q[1].trim(), a: [] }; out.push(cur); continue; }
    if (cur && line.trim()) cur.a.push(line.trim());
  }
  return out.map(x => ({ q: x.q, a: plainText(x.a.join(' ')), words: contentWords(x.q.replace(/\//g, ' ')) }));
}
/** The chapter's answer for the owner's words: { q, a, strong } - or null. Strong: most of the question's own words said. */
function stuckAnswer(svc, words) {
  const said = new Set(contentWords(words)); if (!said.size) return null;
  let best = null;
  for (const it of stuckList(svc)) {
    // (a "/" in a question is two ways to ask it: each side scored on its own)
    // (and the account's own name is no help inside its own walk: "does Resend cost anything" asked while setting up Resend)
    const own = new Set(contentWords(({ stripe: 'stripe', resend: 'resend email', twilio: 'twilio text' })[svc] || ''));
    const sides = it.q.split(/\s*\/\s*/).map(x => contentWords(x).filter(w => !own.has(w))).filter(x => x.length);
    for (const qw of sides.length ? sides : [it.words]) {
      const shared = qw.filter(x => said.has(x)).length, score = shared / qw.length;
      // (more words in common outranks a shorter question met by one word: "my texts say trial" is the trial question, not the cost one)
      const rank = score + shared * 0.5;
      if (shared && (!best || rank > best.rank)) best = { q: it.q, a: it.a, score, shared, rank };
    }
  }
  if (!best) return null;
  return { q: best.q, a: best.a, strong: (best.shared >= 2 && best.score >= 0.6) || (best.score === 1 && best.shared >= 1 && said.size <= 4) || (best.score >= 0.5 && said.size <= 2 && best.shared === said.size) };
}

module.exports = { STEPS, BY_ID, SKIP, skippedSteps, loneCity, stuckAnswer, stuckList, walkSteps, keysStep, keysDone, walkSay, walkRead, walkAsked, WALK_NAME, WALK_NEXT, WALK_STUCK, openSteps, next, question, read, lost, steps, hello, stillNeeds };
