// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/knowledge.js - WHAT THE ASSISTANT READS (Oct 19 2026)
//
// maintainer: "it has files to work from"; "that ... model knows, and has a really good rag to go off of"; Oct 20: "it needs to
// have an extremely good RAG to be able to look at and help walk people through initial setup and changing things from
// then on out". What it reads:
//   - the customer guides the unit already carries (docs/customer-guides-current, a code path every pack writes):
//     EVERYTHING-ASK-YOUR-AI.md was written for an owner's AI to read;
//   - the assistant's own playbooks (services/assistant/playbooks/*.md): how it LEADS a setup - what to ask, in what
//     order, which action does each step, what to check after. Written for the model, checked against the product.
// Both are cut at their headings into passages, each keeping its heading trail.
//
// HOW A QUESTION FINDS ITS PASSAGES (Oct 20 2026):
//   1. Words (BM25, the standard ranking for word search; a heading's words count double). Owners say "the popup", "my
//      projector", "the plug", "make the site darker"; the guide says "Session Monitor", "BroadLink IR", "Shelly",
//      "colour set". OWNER_WORDS adds the guide's words for the owner's (at a lower weight), so the right chapter is found
//      in the owner's own language - the golf-simulator words a facility actually uses.
//   2. The conversation: "ok how do I do that" carries no words of its own. The owner's earlier words in the same
//      conversation ride along at a lower weight, so a follow-up finds the chapter the talk is about.
//   3. Meaning (when the box serves an embedding model - assistant.embedModel, Qwen3-Embedding-0.6B through llama.cpp's
//      server started with --embedding --pooling last, the setup another project runs): each passage becomes a vector once, the
//      question too (with the model's own query instruction, "Instruct: ...\nQuery:..." per its model card), and the
//      passages nearest in meaning join the word search's by reciprocal rank fusion. Without the model the words alone
//      answer - absent is not failed (rule 31). Nothing leaves the box either way.
//   4. A few whole passages, never a step list cut in half: up to k passages within a budget a small model reads well.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DIR = process.env.BA_APP_DIR || path.join(__dirname, '..', '..');
const GUIDES = path.join(APP_DIR, 'docs', 'customer-guides-current');
const PLAYBOOKS = path.join(__dirname, 'playbooks');
// (Oct 22 2026 - maintainer: "at least it can get the person to the right page") where each thing is, read from the screens themselves
// by tools/screen-map.js: every Admin card and every Website editor card, its words, fields and buttons
const SCREENS = path.join(__dirname, 'screens');
const SOURCES = [{ dir: GUIDES, source: 'guide' }, { dir: PLAYBOOKS, source: 'playbook' }];
// the screens are their own index, read only for a question about where something is: in the guide's index their short cards
// crowded out the how-to ("how do I sell memberships on the website" found the Memberships card, not the chapter)
const WHERE_Q = /\b(?:where(?:'?s| is| are| do| can| would| should)?|which (?:screen|tab|card|page|button)|find|get to|go to|open(?:s)? the)\b/i;
const BUDGET = 3600;          // characters of passages beside the question: about 900 tokens (another project, on far bigger
                              // models, gives 12,000; a small model on the box reads the prompt slowly - less is faster)
const FLOOR = 0.35;           // a word match under 35% of the best one is noise, not an answer (the same floor another project uses)
const PIECE = 1400;           // a long section is cut at its paragraphs into pieces about this long
const STOP = new Set('a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our so than that the their them then there these they this to up was we what when where which who why will with you your yours im ive dont doesnt cant want need get got go going make just some like please ok okay hey hi'.split(' '));
// a light stemmer, so "bays" finds "bay", "codes" "code", "parties" "party", "settings" "set" (the first one cut
// only words over four letters: "bays", "pcs" and "tvs" never met their singulars, and "codes" became "cod")
function stem(w) {
  if (w.length <= 3) return w.length === 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;   // pcs, tvs
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) { w = w.slice(0, -3); return /([^aeiou])\1$/.test(w) ? w.slice(0, -1) : w; }
  if (w.length > 4 && w.endsWith('ed')) { w = w.slice(0, -2); return /([^aeiou])\1$/.test(w) ? w.slice(0, -1) : w; }
  return w;
}
const words = s => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[`*_>#|[\]()]/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)).map(stem);

// ── OWNER_WORDS: the owner's words -> the product's words (added to a question at EXPANDED weight) ──
// Each line is what an owner says and what the guide calls it. Kept to things this product has; a new feature's
// everyday names are added with it.
const EXPANDED = 0.6;
const OWNER_WORDS = [
  [/pop-?ups?|time.?s up|times up|countdown|time warning|warning screen|minutes? left|end of (the )?session (screen|warning)|overlay/, 'session monitor popup warning watcher'],
  [/watcher|monitor program|bay (program|app|software)|the program on the (pc|computer)/, 'session monitor bay watcher install'],
  [/\b(sim|simulator|gaming|golf) ?(pc|computer|machine)s?|\bthe pcs?\b|computers? in the bays?|bay computers?/, 'bay pc computer'],
  [/turn(s|ing)? (on|off) (by (itself|themselves)|automatically|on (its|their) own)|(power|turn)s? (on|up|down|off) (automatically|before|after|ahead)|automat(e|ion|ic)/, 'bay power smart power shelly automation plug session'],
  [/smart ?plugs?|outlets?|power strips?|relays?|shelly/, 'shelly plug smart power'],
  [/logo|app icon|favicon/, 'logo branding theme website app icon'],
  [/(add|new|another|rename|remove|delete|more|fewer) (a )?bays?|bay names?|bays? (name|id)/, 'bays devices add bay remove bay name'],
  [/projectors?|screens? (won.?t|will not|doesn.?t) (turn|come) on|remote control|ir blaster|infrared/, 'broadlink ir projector'],
  [/\btvs?\b|televisions?/, 'tv broadlink home assistant'],
  [/wake ?(on|-)? ?lan|\bwol\b|(turn|power|switch|start|boot)s? (on )?(the |my |a |each )?([a-z]+ )?(pc|computer)s? (on )?(remotely|from here|by itself|before)|(pc|computer)s? (won.?t|don.?t|doesn.?t) (turn|power|come) on/, 'wake-on-lan wake pc'],
  [/shut ?(it )?down|shutdown|turn (the )?(pc|computer) off|restart (the )?(pc|computer)/, 'auto-shutdown shutdown restart'],
  [/home ?assistant|\bha\b|z-?wave|zigbee|matter/, 'home assistant'],
  [/web ?site|web ?page|home ?page|landing page|\bsite\b|online presence/, 'website builder'],
  [/(big |main |top )?(picture|photo|image|pic|banner) (at|on) (the )?top|header (image|photo|picture)|cover (photo|image)/, 'hero photo image'],
  [/photos?|pictures?|pics?|images?|gallery/, 'photos image upload'],
  [/colou?rs?|darker|lighter|theme|style|fonts?|look(s)? (better|nicer|different)|branding/, 'theme look colour font'],
  [/coming soon|not open yet|before (we|the) open|under construction|launch page/, 'holding page public'],
  [/hide|unpublish|take (it )?down|not (show|visible)|turn off (the )?(page|section)/, 'public hide switch'],
  [/menu (bar|at the top)|nav(igation)?|top links?|links? at the (top|bottom)|footer/, 'menu links footer'],
  [/announcement|banner (at|across) the top|notice|alert bar|closed (today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/, 'notice bar announcement'],
  [/newsletter|mailing list|email list|sign ?ups? for (emails|updates)/, 'email updates newsletter'],
  [/pdf|menu card|price list|brochure/, 'pdf pages'],
  // (Oct 23 2026 - the 4B walk in maintainer's own typing: "how do i put it on fb" found the PDF pages - "flyer" went there before flyers
  // were built - and never the flyers' Facebook steps; deals, codes and specials had no owner words at all)
  // (not the site's own social links - "put our instagram on the site" is the footer's: test-assistant-rag R2)
  [/^(?![\s\S]*\b(?:on|to|in|from) (?:the |our |my )?(?:web ?site|site|home ?page|page|footer)\b)[\s\S]*(?:\bflyers?\b|posters?|\bfb\b|face ?book|\binsta(?:gram)?\b|\big\b|social media|socials|\b(?:post|share|put) (?:it|this|that|them) (?:on|to)\b|\bstor(?:y|ies)\b)/, 'flyers facebook instagram download post story'],
  [/\bfirst[- ]?time(?:rs?)?\b|\bnew (?:customers?|guests?|golfers?|players?)\b|\bfirst visits?\b|\bwelcome (?:deal|offer|code|discount)\b/, 'first-visit offer code once each person'],
  [/\bdeals?\b|specials?|promo(?:tion)?s?\b|\bbogo\b|buy (?:an?|one|1) hours?|(?:free|last) (?:30|thirty|half) ?(?:min|mins|minutes|hour)|\b(?:slow|dead|quiet) (?:days?|nights?|(?:mon|tues|wednes|thurs|fri|satur|sun)days?)|\b(?:r|are|is) (?:so )?(?:dead|slow)\b|get (?:more )?(?:people|customers|golfers) in|free (?:pitchers?|pitches|beers?|apps?|appetizers?|wings|nachos|drinks?|food)/, 'booking deals something free with a booking which one do i use'],
  [/packages?|bundles?|\b(?:birthday|bday|b-day) part(?:y|ies)|corporate (?:outing|event|party)|party (?:deal|price|package)/, 'package deals'],
  [/(?:discount|promo|coupon) codes?|\bmilit[ae]ry\b|veterans?|\bseniors?\b|\bstudents?\b|first responders?|teachers?|show (?:an? |their |his |her )?(?:id|i\.d\.)|\bid\b at the door/, 'discount codes group rate military seniors students check id'],
  [/happy hour|off.?peak|peak (?:price|pricing|hours?|times?)|cheaper (?:at|on|before|after|during)/, 'price window pricing tiers'],
  [/(?:drink|drinks|beer|food|wing|taco|bar|draft) specials?|\$\s?\d+ off (?:drafts?|beers?|wings|drinks?)|counter specials?/, 'food and drink special counter'],
  [/bold|italics?|bullet|numbered list|formatting|underline/, 'formatting toolbar text'],
  [/buttons? (on|at) (the )?(top|homepage|home page)|book now button|call to action/, 'hero buttons'],
  [/hours|open(ing)? (time|hours)|close (time|at)|what time/, 'hours booking rules'],
  [/price|pricing|rates?|cost|charge|how much|per hour|half hour|peak/, 'pricing price half hour'],
  [/members?(hip)?s?|monthly (plan|pass)|subscriptions?|unlimited/, 'membership tier members'],
  [/members? only|members-only|only members|non-?members|private club/, 'running members-only private club members wall'],
  [/no staff|unstaffed|let themselves in|self.?serve|24.?7|after hours/, 'unstaffed facility archetype door'],
  [/staffed|front desk|counter staff|someone (at|on) the desk|employees? on site/, 'staffed facility archetype counter'],
  [/some (of the )?(hours|time)|part of the day|nights? (and|&) weekends|days but not nights/, 'hybrid staffed some hours'],
  [/\b(doors?|locks?|keypads?|entry)\b|codes? (to|for) (the )?door|let (people|customers) in/, 'door lock access code'],
  [/remote ?lock/, 'door lock account device'],
  [/texts?|sms|text messages?/, 'text messaging twilio'],
  [/e-?mails?|resend|confirmations? (not|aren.?t) (sending|arriving)/, 'email resend'],
  [/payments?|take cards?|credit cards?|stripe|get paid/, 'payments stripe'],
  [/card readers?|tap to pay|terminal|swipe/, 'card reader stripe terminal counter'],
  [/waivers?|liability|sign (a )?release/, 'waivers'],
  [/leagues?/, 'leagues'],
  [/events?|tournaments?|parties|party|birthday|outings?/, 'events page'],
  [/gift ?cards?|vouchers?/, 'gift cards'],
  [/first|start(ing)?( out)?|just (got|plugged|unboxed)|unbox|begin|setup|set up|get (it )?going/, 'start here setup step'],
  [/backups?|restore|spare|broke|broken|dead|won.?t (boot|start)/, 'backup restore spare'],
  [/updates?|upgrade|new version/, 'software updates'],
  [/gspro|protee|trugolf|uneekor|trackman|e6|fsx|simulator software|launch monitor/, 'simulator software bay pc'],
  [/hot ?keys?|click(s|ing)? (for me|in order)|auto ?hot ?key|\bahk\b|macro|record (my )?clicks|watch (me|this) click/, 'hotkey click sequence startup'],
  // (Oct 21 2026, night - maintainer: "trained ... on the website and running the entire facility") the facility day to day: the
  // owner's questions about the counter, staff, money and the unit found the right section 31 times in 40, and other words
  // for the same 12 in 20 (test-assistant-rag R9; BA-CORE-2-AI.md section 20)
  [/close (out|up) (the )?(register|drawer|till|day|night)|cash(ing)? out|end of (the )?(day|night)|count(ing)? (the )?(drawer|till|cash)|z.?report|register at night/, 'end of day count drawer counted'],
  [/walk.?ins?|walked in|walks? in|without a (booking|reservation)|no (booking|reservation)|drop.?ins?|showed up/, 'walk-ins new booking'],
  [/hours (my |the |our )?(staff|employees?|people|workers?|team) (worked|work)|how many hours did|payroll|time ?sheets?/, 'hours export time clock'],
  [/(new|add|hire|hired|hiring) (an? |another |the )?(employee|staff|worker|person|someone)|we hired|new hire|set (them|him|her) up/, 'your people employees'],
  [/clock(ing|ed)? (in|out)|time ?clock|punch(es|ing)? (in|out)?/, 'time clock signing in and out'],
  [/ring (them|it) up|counter menu|bar menu|menu items?|(beers?|burgers?|food|drinks?) (and|&|so) |the menu (for|at|on) the (counter|pad|bar)|menu for the counter/, 'build the menu categories items choices'],
  [/receipt printer|kitchen printer|bar printer|printers?|printing|cash drawer/, 'printers drawer'],
  [/split (a |the )?(tab|check|bill)|separate (checks|tabs|bills)/, 'splitting split checks tab evenly'],
  [/(more|extra|another) (time|half hour|hour)|extend (a |the |their )?(session|booking|time)|keep playing|merge/, 'merging extending'],
  [/(counter|staff) (pad|tablet|ipad|screen)|what (my |the )?staff see|today screen|the pad\b/, 'today screen counter staff surface'],
  [/roll ?back|go back|undo (the|an|that) update|previous version|(update|upgrade) (broke|broken|messed)/, 'rolling back'],
  [/(what|which) version|version (am i|are we|is it|do we)/, 'which version'],
  [/(texts?|text messages?|alerts?|notif\w*) (to|for) me|alert me|notify me|tell me when|text me|(phone|cell) to (buzz|ring)|something (goes wrong|breaks|needs me|is wrong)/, 'texts to you needs you'],
  [/(protect|secure|lock down) (the |my )?(admin|login|account)|two.?factor|2fa|someone (got|getting) into/, 'protecting the admin'],
  [/revenue|what did we (make|take|bring)|how much (money )?(did we|have we) (make|made|take|bring)|income|takings/, 'revenue money'],
  [/accountant|\bcpa\b|bookkeeper|year.?end|end of (the )?year|taxes for the year|tax time/, 'year-end report'],
  [/refund|money back|give (it|them) back|charge ?back/, 'refunds giving money back'],
  [/manager|multi.?site|more than one (location|facility|site)|log in but not see/, 'facility manager sign-in'],
  [/membership (plan|level|type|option)s?|(make|create|add|new|set up) (a |another )?(membership|plan|tier|level)/, 'tiers define the deal'],
  // (Oct 21 2026, night - the customer's day one, as a new owner says it) no address yet: buying one is Way 3
  [/(no|don.?t have an?|haven.?t got an?|without an?|need an?|get an?|buy an?|new) (web ?site|domain|web address|url)|no domain|domain name/, 'way 3 buy a new domain in cloudflare three ways'],
];
function expand(text) {
  const t = String(text || '').toLowerCase();
  const out = [];
  for (const [re, add] of OWNER_WORDS) if (re.test(t)) out.push(add);
  return out.join(' ');
}

let INDEX = null;
function passagesOf(dir, source) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch {}
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    const trail = []; let body = [];
    const flush = () => {
      const text = body.join('\n').trim(); body = [];
      if (!text) return;
      const heading = trail.filter(Boolean).join(' > ') || f.replace(/\.md$/, '');
      // a long section is cut at its paragraphs, every piece keeping its heading; a paragraph longer than a piece is
      // cut at its lines (a step list stays whole up to that)
      const paras = text.split(/\n\s*\n/).flatMap(p => {
        if (p.length <= PIECE) return [p];
        const parts = []; let c = '';
        for (const l of p.split('\n')) { if (c && (c + '\n' + l).length > PIECE) { parts.push(c); c = l; } else c = c ? c + '\n' + l : l; }
        if (c) parts.push(c);
        return parts;
      });
      let cur = '';
      for (const p of paras) { if (cur && (cur + '\n\n' + p).length > PIECE) { out.push({ file: f, source, heading, text: cur }); cur = p; } else cur = cur ? cur + '\n\n' + p : p; }
      if (cur) out.push({ file: f, source, heading, text: cur });
    };
    for (const line of lines) {
      const m = line.match(/^(#{1,4})\s+(.*)$/);
      if (m) { flush(); trail.length = m[1].length - 1; trail[m[1].length - 1] = m[2].replace(/[*_`]/g, '').trim(); continue; }
      body.push(line);
    }
    flush();
  }
  return out;
}
function indexOf(passages) {
  const docs = passages.map((p, i) => {
    const tf = new Map(); const hw = words(p.heading), bw = words(p.text);
    for (const w of bw) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of hw) tf.set(w, (tf.get(w) || 0) + 2);
    return { i, p, tf, len: bw.length + 2 * hw.length, hash: crypto.createHash('sha1').update(p.heading + '\n' + p.text).digest('hex') };
  });
  const df = new Map(); for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const avg = docs.reduce((n, d) => n + d.len, 0) / (docs.length || 1);
  return { docs, df, avg, n: docs.length };
}
function load() {
  if (INDEX) return INDEX;
  INDEX = indexOf(SOURCES.flatMap(s => passagesOf(s.dir, s.source)));
  return INDEX;
}
let SCREEN_INDEX = null;
const loadScreens = () => SCREEN_INDEX || (SCREEN_INDEX = indexOf(passagesOf(SCREENS, 'screens')));
// a question about where something is: the card that is it first, then the guide's best
function withScreen(question, context, picked, k) {
  if (!WHERE_Q.test(String(question || ''))) return picked;
  const S = loadScreens(); if (!S.n) return picked;
  const top = bm25(S, query(question, context))[0];
  if (!top) return picked;
  const card = { heading: top.d.p.heading, source: 'screens', text: top.d.p.text, score: Math.round(top.s * 1000) / 1000 };
  return [card].concat(picked.filter(x => x.heading !== card.heading)).slice(0, k);
}

/** The question's words with their weights: its own at 1, the guide's words for them and the owner's earlier words lower. */
function query(question, context) {
  const q = new Map();
  const add = (ws, w) => { for (const x of ws) q.set(x, Math.max(q.get(x) || 0, w)); };
  add(words(question), 1);
  add(words(expand(question)), EXPANDED);
  if (context) { add(words(context), 0.4); add(words(expand(context)), 0.3); }
  return q;
}

function bm25(I, q) {
  const k1 = 1.2, b = 0.75, out = [];
  for (const d of I.docs) {
    let s = 0;
    for (const [w, wt] of q) { const f = d.tf.get(w); if (!f) continue; const idf = Math.log(1 + (I.n - I.df.get(w) + 0.5) / (I.df.get(w) + 0.5)); s += wt * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / I.avg)); }
    if (s > 0) out.push({ d, s });
  }
  return out.sort((x, y) => y.s - x.s);
}

// a few whole passages within the budget; two pieces of the same section are told apart, an exact repeat is not taken.
// A playbook says how to lead and the guide holds the steps, so the guide always has a place when it matched at all.
function pick(ranked, k) {
  const out = []; let used = 0; const seen = new Set();
  const bestGuide = ranked.find(r => r.d.p.source === 'guide');
  for (const r of ranked) {
    if (out.length >= k) break;
    if (seen.has(r.d.hash)) continue;
    if (bestGuide && out.length === k - 1 && !out.some(o => o.source === 'guide') && r.d.p.source !== 'guide') continue;
    const t = r.d.p.text;
    if (used && used + t.length > BUDGET) continue;
    const text = t.length > BUDGET ? t.slice(0, BUDGET).replace(/\n[^\n]*$/, '') + '\n...' : t;
    out.push({ heading: r.d.p.heading, source: r.d.p.source, text, score: Math.round(r.s * 1000) / 1000 });
    used += text.length; seen.add(r.d.hash);
  }
  return out;
}

/**
 * The passages that best answer a question, by its words: [{ heading, source, text, score }].
 * context: the owner's earlier words in this conversation (a follow-up's subject).
 */
function search(question, k = 3, { context = '' } = {}) {
  const I = load(); if (!I.n) return [];
  return withScreen(question, context, pick(floor(bm25(I, query(question, context))), k), k);
}
const floor = (ranked) => ranked.length ? ranked.filter(r => r.s >= ranked[0].s * FLOOR) : ranked;

// ── MEANING: the box's embedding model, when it serves one ──
const QUERY_INSTRUCT = 'Given an owner\'s question about setting up or running their golf simulator facility and its booking system, retrieve the guide passages that answer it';
const vectors = new Map();     // passage hash -> unit vector (llama.cpp's /v1/embeddings normalizes them)
let indexing = null, embedFailed = null;
function embedSettings() {
  let a = {}; try { a = require('../config').getConfig().assistant || {}; } catch {}
  return { endpoint: String(a.endpoint || 'http://127.0.0.1:8080/v1').replace(/\/+$/, ''), model: String(a.embedModel || '') };
}
async function embed(texts, e) {
  const r = await fetch(e.endpoint + '/embeddings', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model: e.model, input: texts, encoding_format: 'float' }) });
  if (!r.ok) throw new Error('the embedding model answered ' + r.status);
  const j = await r.json();
  const data = (j && Array.isArray(j.data) ? j.data : []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  if (data.length !== texts.length) throw new Error('the embedding model answered for ' + data.length + ' of ' + texts.length);
  return data.map(x => x.embedding);
}
/** Turn every passage into a vector once (in the background); a passage already done is not asked again. */
function indexMeaning() {
  const e = embedSettings();
  if (!e.model) return null;
  if (indexing) return indexing;
  const I = load();
  indexing = (async () => {
    const todo = I.docs.filter(d => !vectors.has(d.hash));
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const v = await embed(batch.map(d => d.p.heading + '\n' + d.p.text), e);
      batch.forEach((d, j) => vectors.set(d.hash, v[j]));
    }
    embedFailed = null;
  })().catch(err => { embedFailed = String(err && err.message || err).slice(0, 120); }).finally(() => { indexing = null; });
  return indexing;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]; return s; };

/**
 * search(), with meaning when the box serves an embedding model and every passage has its vector: the word ranking and
 * the meaning ranking fused (reciprocal rank fusion, k = 60). Until then - or without the model - the words alone.
 */
async function searchBest(question, k = 3, { context = '' } = {}) {
  const I = load(); if (!I.n) return [];
  const words_ = floor(bm25(I, query(question, context)));
  const e = embedSettings();
  if (!e.model) return withScreen(question, context, pick(words_, k), k);
  if (I.docs.some(d => !vectors.has(d.hash))) { indexMeaning(); return withScreen(question, context, pick(words_, k), k); }
  let qv;
  try { [qv] = await embed([`Instruct: ${QUERY_INSTRUCT}\nQuery:${[context, question].filter(Boolean).join('\n')}`], e); }
  catch (err) { embedFailed = String(err && err.message || err).slice(0, 120); return withScreen(question, context, pick(words_, k), k); }
  const meaning = I.docs.map(d => ({ d, s: dot(qv, vectors.get(d.hash)) })).sort((x, y) => y.s - x.s);
  const fused = new Map();
  const fuse = (list) => list.slice(0, 30).forEach((r, rank) => { const f = fused.get(r.d.i) || { d: r.d, s: 0 }; f.s += 1 / (60 + rank + 1); fused.set(r.d.i, f); });
  fuse(words_); fuse(meaning);
  return withScreen(question, context, pick([...fused.values()].sort((x, y) => y.s - x.s), k), k);
}

function stats() {
  const I = load();
  return { passages: I.n, playbookPassages: I.docs.filter(d => d.p.source === 'playbook').length, words: I.df.size, chapters: chapters().length,
    meaning: embedSettings().model ? { vectors: I.docs.filter(d => vectors.has(d.hash)).length, of: I.n, error: embedFailed } : null };
}

// ── WALKING THE OWNER THROUGH A CHAPTER (Oct 19 2026) ───────────────────────────────────────────────────────────────
// maintainer: "anything that they can't do it. Just walks em through really well, with the current documentation". What the
// unit cannot do for the owner - a Twilio account and its carrier registration, a Stripe account, a Resend domain, a lock
// maker's account - the guide already walks through, chapter by chapter ("# CHAPTER: ..."), written and kept current by
// BA and carried in every update. A search hands the model a few passages; a walk-through needs the chapter IN ORDER, so
// the model can say "part 2 of 5" and go on when the owner is done. Each part is one "##" section of the chapter.
let CHAPTERS = null;
function chapters() {
  if (CHAPTERS) return CHAPTERS;
  const out = [];
  let files = []; try { files = fs.readdirSync(GUIDES).filter(f => f.endsWith('.md')).sort(); } catch {}
  for (const f of files) {
    let cur = null, part = null;
    for (const line of fs.readFileSync(path.join(GUIDES, f), 'utf8').split('\n')) {
      const ch = line.match(/^# CHAPTER:\s*(.+)$/);
      if (ch) { cur = { title: ch[1].trim(), intro: [], parts: [] }; out.push(cur); part = null; continue; }
      if (!cur) continue;
      if (/^# /.test(line)) continue;   // the chapter's own title line under the marker
      const h = line.match(/^##\s+(.+)$/);
      if (h) { part = { heading: h[1].replace(/[*_`]/g, '').trim(), lines: [] }; cur.parts.push(part); continue; }
      (part ? part.lines : cur.intro).push(line);
    }
  }
  for (const c of out) { c.intro = c.intro.join('\n').trim(); for (const p of c.parts) { p.text = p.lines.join('\n').trim(); delete p.lines; } }
  CHAPTERS = out;
  return out;
}
/**
 * The chapter that best matches a topic ("texting", "stripe", "my door", "shelly", "pictures"), or null.
 * The topic's own words: 3 for a chapter title's word, 1 for a part's heading. A part heading's "(Guide: ...)" note is
 * not read - Start Here's steps name every other guide ("STEP 6 - Bay power (Guides: shelly-setup-guide, ...)"), which
 * made "shelly" and "stripe" open Start Here. When the topic's own words name no chapter title at all, the guide's words
 * for them count too (OWNER_WORDS: 1.5 for a title, 0.5 for a heading) - "shelly" finds Smart Power, "pictures" the
 * website. A tie keeps the chapter that comes first in the guide ("my door" stays with the first door chapter, "texting"
 * with text messaging before text formatting, "email" with email before email updates).
 */
function chapter(topic) {
  const own = [...new Set(words(topic))];
  if (!own.length) return null;
  const list = chapters().map(c => ({ c, tw: new Set(words(c.title)), hw: new Set(c.parts.flatMap(p => words(p.heading.replace(/\((guides?|see)[^)]*\)/ig, '')))) }));
  const titled = list.some(x => own.some(w => x.tw.has(w)));
  const extra = titled ? [] : [...new Set(words(expand(topic)))].filter(w => !own.includes(w));
  let best = null, bestScore = 0;
  for (const x of list) {
    let sc = 0;
    for (const w of own) { if (x.tw.has(w)) sc += 3; else if (x.hw.has(w)) sc += 1; }
    for (const w of extra) { if (x.tw.has(w)) sc += 1.5; else if (x.hw.has(w)) sc += 0.5; }
    if (sc > bestScore) { best = x.c; bestScore = sc; }
  }
  return best;
}

module.exports = { search, searchBest, indexMeaning, stats, chapters, chapter, expand, words, _reset: () => { INDEX = null; SCREEN_INDEX = null; CHAPTERS = null; vectors.clear(); indexing = null; embedFailed = null; } };
