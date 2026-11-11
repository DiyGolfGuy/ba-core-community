// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/website.js - THE WEBSITE, BUILT BY TALKING (Oct 20 2026)
//
// maintainer: "make sure the end user it feels like their own website with a wild amount of customization ... build events pages.
// specials, weekly specials that show on the landing page. ask them where they want it shown at the top right after the
// hero landing etc. full control of that kind of stuff"; earlier: "make it feel as base 44 as possible, with tons of
// options" and "maybe even let the ai change some of the code in small allowed places for color or layout". Every action
// here is the Website editor's own save of that part (each kept as a version to put back); the page's sections go through
// public/site-layout.js applyEdit, the one function the editor, the owner's chat page and the battery share; the style
// places are public/site-style.js (settings the signed pages read - never code, rule 40). Words and looks go straight in
// with an Undo; switching the site off, changing the homepage and taking a page, a section or an event out are said back
// first.
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', '..', '..', 'public', 'site-layout.js'));
const S = require(path.join(__dirname, '..', '..', '..', 'public', 'site-style.js'));

module.exports = (H) => {
  const { ActionError, DATE, dayWords, photoPath } = H;
  // the five built-in offer slides (public/landing.html DEFAULTS.offers and admin-website.html's own copy - test-assistant A62
  // holds the three equal): what the homepage shows until the owner saves slides of their own
  const OFFER_DEFAULTS = [
    { label: 'The Bays', title: 'Tour-Level Simulators', text: 'Practice, play, and compete on premium launch monitor technology.', img: '' },
    { label: 'Book Online', title: 'Reserve in Seconds', text: 'Real-time availability. Pick your bay, pick your time, pay online.', img: '' },
    { label: 'Self-Service', title: 'Your Own Door Code', text: 'A unique entry code arrives by email - or by text if you opt in. Walk in and play.', img: '' },
    { label: 'Leagues', title: 'Weekly Play & Events', text: 'Join a league night or bring your crew for a private event.', img: '' },
    { label: 'Open Late', title: 'On Your Schedule', text: 'Morning rounds or midnight sessions - book what works for you.', img: '' }];
  const offersOf = (ctx) => { const o = (ctx.website || {}).offers; return { enabled: !o || o.enabled !== false, slides: (o && Array.isArray(o.slides) ? o.slides : OFFER_DEFAULTS).map(x => Object.assign({}, x)) }; };
  const galleryOf = (ctx) => ((((ctx.website || {}).gallery) || {}).items || []).filter(g => g && typeof g === 'object');
  const T = () => require('../../theme');
  // the fonts an assistant change leaves, and how it is said (website_fonts_set) - from what is saved now
  function fontPlan(a, ctx) {
    const TH = T(), F = TH.FONTS, name = (id) => (F[id] || {}).label || id;
    const saved = Object.assign({}, (((ctx.website || {}).theme || {}).fonts) || {});
    const now = TH.resolveFonts({ fonts: saved });
    const f = { heading: now.heading, body: now.body, accent: now.accent, matchAll: now.matchAll, accentStyle: now.accentStyle };
    const said = [];
    if (a.set) { const v = TH.FONT_SETS[a.set]; Object.assign(f, { heading: v.heading, body: v.body, accent: v.accent, matchAll: !!v.matchAll }); said.push(`the ${v.label.split(' - ')[0]} set - ${v.label.split(' - ')[1]}`); }
    if (a.text) { if (!TH.BODY_OK(a.text)) throw new ActionError(`${name(a.text)} is a script face - it is for headings and the small lines, hard to read in paragraphs`); f.body = a.text; if (a.one_font !== true) said.push(`the words in ${name(a.text)}`); }
    if (a.headings) { f.heading = a.headings; f.matchAll = false; said.push(`headings in ${name(a.headings)}`); }
    if (a.small_lines) { f.accent = a.small_lines; f.matchAll = false; said.push(`the small lines in ${name(a.small_lines)}`); }
    if (a.one_font === true) {
      if (a.headings || a.small_lines) throw new ActionError('one font everywhere takes one font - name it as the text font');
      f.matchAll = true; f.heading = f.body; f.accent = f.body; said.push(`one font everywhere - ${name(f.body)}`);
    } else if (a.one_font === false && !a.headings && !a.small_lines) { f.matchAll = false; said.push('headings, words and small lines free to differ again'); }
    if (a.small_lines_style) { f.accentStyle = a.small_lines_style; said.push(a.small_lines_style === 'plain' ? 'plain small lines' : 'the small lines in wide-spaced capitals'); }
    if (!said.length) throw new ActionError('say a font set, a font for the headings, the words or the small lines, one font everywhere, or plain small lines');
    return { set: { op: 'content', key: 'theme', set: [['fonts', f]] }, words: `The site's fonts: ${said.join(', ')}. Every page of the site and the booking pages follow.` };
  }
  const clip = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '...' : t; };
  const LINK = /^(\/(?!\/)[^\s<>"']*|#[A-Za-z0-9_-]+|https?:\/\/[^\s<>"']+)$/;
  const okLink = (v, what) => { const s = String(v || '').trim(); if (s && !LINK.test(s)) throw new ActionError(`"${clip(s, 60)}" is not a link for ${what} (a page like /book, a section like #visit, or https://...)`); return s; };
  const kindName = (type) => (L.CUSTOM[type] || L.BUILTIN[type] || { label: type }).label;
  const an = (w) => /^[aeiou]/i.test(w) ? 'an ' + w : 'a ' + w;

  // ── the sections: the words a small model uses for a section's parts, put in the fields each kind keeps ──
  const WORDS_KEY = { story: 'p1', text: 'body', rates: 'note', cta: 'text', form: 'intro', signup: 'text', menu: 'note', banner: 'text', ctaEnd: 'text' };
  const TAKES = {
    story: ['title', 'small_line', 'words', 'more_words', 'photo', 'highlight_title', 'highlight_words', 'link_words', 'link', 'background'],
    text: ['title', 'small_line', 'words', 'background', 'align'], rates: ['title', 'small_line', 'words', 'background', 'align'],
    faq: ['title', 'small_line', 'items', 'add_items', 'remove_items', 'faq_open', 'background', 'align'],
    quotes: ['title', 'small_line', 'items', 'add_items', 'remove_items', 'background', 'align'],
    specials: ['title', 'small_line', 'items', 'add_items', 'remove_items', 'show', 'background', 'align'],
    menu: ['title', 'small_line', 'words', 'items', 'add_items', 'remove_items', 'menu_source', 'hide_parts', 'menu_display', 'background', 'align'],
    cards: ['title', 'small_line', 'items', 'add_items', 'remove_items', 'background', 'align', 'cards_source'],
    video: ['title', 'small_line', 'background', 'align'], cta: ['title', 'words', 'button', 'link'], banner: ['title', 'small_line', 'words', 'button', 'link', 'photo'],
    form: ['title', 'small_line', 'words', 'thanks', 'form_asks', 'background', 'align'],
    social: ['title', 'small_line', 'background', 'align'], signup: ['title', 'small_line', 'words', 'button', 'background', 'align'],
    ctaEnd: ['title', 'words', 'button', 'link'],
  };
  const PLAIN = { title: 'title', small_line: 'kicker', more_words: 'p2', highlight_title: 'calloutTitle', highlight_words: 'calloutText', link_words: 'linkText', button: 'button', thanks: 'thanks', form_asks: 'fields', background: 'bg', align: 'align', show: 'show',
    menu_source: 'source', cards_source: 'source', hide_parts: 'hideGroups', menu_display: 'display', faq_open: 'open' };
  // one list item, as the model writes it, in the fields the kind keeps (site-layout.js ITEM_SHAPES checks them)
  const item = (type, x) => {
    const p = (v) => v ? photoPath(v) : '';
    if (type === 'faq') return { q: x.question || x.title || x.name || '', a: x.answer || x.words || '' };
    if (type === 'quotes') return { text: x.words || '', who: x.who || x.name || '' };
    if (type === 'specials') return { days: x.days || 'every', title: x.name || x.title || '', text: x.words || '', price: x.price || '', time: x.time || '', img: p(x.photo), date: x.date || '', also: (x.show_also || []).join(',') };
    if (type === 'menu') return { name: x.name || x.title || '', text: x.words || '', price: x.price || '' };
    if (type === 'cards') return { title: x.title || x.name || '', text: x.words || '', price: x.price || '', img: p(x.photo), linkText: x.link_words || '', link: x.link ? okLink(x.link, 'a card') : '' };
    return x;
  };
  const ITEM = { type: 'object', properties: {
    question: { type: 'string', maxLength: 200 }, answer: { type: 'string', maxLength: 2000 },
    name: { type: 'string', maxLength: 80, description: 'a special\'s or a menu item\'s name' }, title: { type: 'string', maxLength: 80, description: 'a card\'s title' },
    words: { type: 'string', maxLength: 600, description: 'a quote, or a line about the special, the menu item or the card' }, who: { type: 'string', maxLength: 80, description: 'who said a quote' },
    days: { type: 'string', maxLength: 40, description: 'a special\'s days: every day, weekdays, weekends, or days like "tue" or "thu-sun"' },
    time: { type: 'string', maxLength: 40, description: 'when a special runs, like "after 6 PM"' }, price: { type: 'string', maxLength: 30, description: 'as it should read, like "$20"' },
    photo: { type: 'string', maxLength: 200, description: 'a photo the owner added in the chat (/uploads/landing/...)' },
    link: { type: 'string', maxLength: 300 }, link_words: { type: 'string', maxLength: 40 },
    // (Oct 20 2026, night) a special for one day, and where else a special shows on its day
    date: Object.assign({}, DATE, { description: 'a special for ONE day only ("tonight", "Friday", a date): its days are not read then, and it is gone after its day' }),
    show_also: { type: 'array', maxItems: 3, items: { type: 'string', enum: L.ALSO }, description: 'a special: where else it shows on its day - top (it leads the top of the homepage in place of the photo), slides (first in the slides under the top), booking (on the booking page)' } } };
  const SECTION_PARAMS = {
    title: { type: 'string', maxLength: 120, description: 'its headline' },
    small_line: { type: 'string', maxLength: 80, description: 'the small line above the headline' },
    words: { type: 'string', maxLength: 6000, description: 'its main words (a blank line starts a new paragraph)' },
    more_words: { type: 'string', maxLength: 3000, description: 'photo + text only: a second paragraph' },
    photo: { type: 'string', maxLength: 200, description: 'photo + text or a photo band: a photo the owner added in the chat' },
    highlight_title: { type: 'string', maxLength: 80 }, highlight_words: { type: 'string', maxLength: 400 },
    link_words: { type: 'string', maxLength: 60 }, link: { type: 'string', maxLength: 300, description: 'a page like /book, a section like #visit, or https://...' },
    button: { type: 'string', maxLength: 40, description: 'the button\'s words' },
    items: { type: 'array', maxItems: 60, items: ITEM, description: 'the whole list (replaces it): FAQ - question and answer; testimonials - words and who; weekly specials - days, name, words, price, time, photo; menu - name, price, words; cards - title, words, price, photo, link, link_words' },
    add_items: { type: 'array', maxItems: 30, items: ITEM, description: 'items added after the ones there' },
    remove_items: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 80 }, description: 'items taken out: their place (1 is the first) or their first words' },
    show: { type: 'string', enum: ['all', 'today'], description: 'weekly specials: all of them with today\'s marked, or only today\'s' },
    // the one menu (Oct 20 2026, night): a menu section shows the counter's own menu live - the one the servers ring up
    cards_source: { type: 'string', enum: ['packages', 'typed'], description: 'cards: "packages" shows your package deals live, each with a Book button ("show our packages on the website"); "typed" the cards written here' },
    menu_source: { type: 'string', enum: ['counter', 'typed'], description: 'a menu: "counter" shows the counter\'s menu live, its parts as sub-menus (one menu for the servers and the site - the usual choice); "typed" shows items typed here' },
    hide_parts: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 60 }, description: 'a counter menu: parts of the menu kept off the website (a new part shows by itself)' },
    // how a section shows (Oct 20 2026, late; maintainer: "tabs no tabs")
    menu_display: { type: 'string', enum: ['list', 'tabs'], description: 'a counter menu: "tabs" - one part at a time, a tab for each (good for a long menu); "list" - every part one after another' },
    faq_open: { type: 'string', enum: ['none', 'first', 'all'], description: 'an FAQ: which answers start open' },
    form_asks: { type: 'array', items: { type: 'string', enum: L.FORM_FIELDS.map(x => x[0]) }, description: 'inquiry form: what it asks (name always)' },
    thanks: { type: 'string', maxLength: 300, description: 'inquiry form: what a visitor sees after sending' },
    background: { type: 'string', enum: L.LOOKS.bg, description: 'auto (as this kind looks), plain (the page colour), alt (a shaded band), dark (a dark band like the header)' },
    align: { type: 'string', enum: L.LOOKS.align, description: 'auto, left or center' },
  };
  function sectionFields(type, a) {
    const takes = TAKES[type] || [];
    const f = {}, out = { fields: f };
    for (const k of Object.keys(SECTION_PARAMS)) {
      if (a[k] === undefined) continue;
      if (!takes.includes(k)) throw new ActionError(`${an(kindName(type).toLowerCase())} section has no ${k.replace(/_/g, ' ')} (it takes: ${takes.map(x => x.replace(/_/g, ' ')).join(', ') || 'nothing to type'})`);
      if (k === 'words') f[WORDS_KEY[type]] = a.words;
      else if (k === 'link') f[type === 'story' ? 'linkUrl' : 'link'] = okLink(a.link, 'the section');
      else if (k === 'photo') f.img = a.photo ? photoPath(a.photo) : '';
      else if (k === 'items') f.items = a.items.map(x => item(type, x));
      else if (k === 'add_items') out.addItems = a.add_items.map(x => item(type, x));
      else if (k === 'remove_items') out.dropItems = a.remove_items;
      else f[PLAIN[k]] = a[k];
    }
    return out;
  }
  // A PAGE OF THE OWNER'S OWN (Oct 20 2026, late; maintainer: "pages not pages"): it holds the same sections and takes the same
  // changes - `page` names it by its title; left out, the homepage
  const PAGE_P = { type: 'string', maxLength: 120, description: 'when the section is on one of the owner\'s own pages: that page\'s title (leave out for the homepage)' };
  const pageOf = (ctx, ref) => { const pages = (ctx.website || {}).pages || []; try { return pages[L.pageIndex(pages, ref)]; } catch (e) { throw new ActionError(e.message); } };
  const hasPage = (ctx, ref) => { try { L.pageIndex((ctx.website || {}).pages || [], ref); return true; } catch { return false; } };
  const onWhat = (page, ctx) => L.isHome(page) ? 'the homepage' : `the "${pageOf(ctx, page).title}" page`;
  const blocksOf = (ctx, page) => L.isHome(page) ? L.defaultLayout(ctx.website || {}) : L.pageLayout(pageOf(ctx, page));
  const findSection = (ctx, ref, page) => { try { return L.findBlock(blocksOf(ctx, page), ref); } catch (e) { throw new ActionError(e.message); } };
  const slugOf = (t) => String(t || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  // a special by its name, in whichever specials section holds it (a hidden one too)
  function specialAt(ctx, ref) {
    const n = String(ref || '').trim().toLowerCase(), hits = [];
    // the homepage's specials sections, then those on the owner's pages (Oct 20 2026, late) - the page comes back with it
    const lists = [{ page: undefined, blocks: blocksOf(ctx) }].concat(((ctx.website || {}).pages || []).filter(p => p && L.isSectionsPage(p)).map(p => ({ page: p.title, blocks: L.pageLayout(p) })));
    for (const ls of lists) for (const b of ls.blocks) if (b.type === 'specials') for (const it of (b.items || [])) {
      const t = String(it.title || '').toLowerCase();
      if (t === n || (n && t.startsWith(n))) hits.push({ block: b, item: it, exact: t === n, page: ls.page });
    }
    const exact = hits.filter(h => h.exact), pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
    if (!pick) throw new ActionError(hits.length ? `more than one special starts "${ref}": ${hits.map(h => '"' + h.item.title + '"').join(', ')} - say which` : `there is no special called "${ref}" on the homepage - add it first (website_section_add or website_section_edit, kind specials)`);
    return pick;
  }
  // the flyer's layouts, and the small line over its name: Tonight or Today on its day, its weekday ahead, its days when weekly
  const FLY = require('../../../public/flyer.js');
  const kickerOf = (it, ctx) => {
    if (it.date) {
      if (it.date === ctx.today) return /\b(pm|night|tonight|late|close)\b/i.test([it.time, it.text, it.title].join(' ')) ? 'Tonight' : 'Today';
      return new Date(it.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    return L.daysWords(it.days);
  };
  const FRIENDLY = { p1: 'words', body: 'words', text: 'words', intro: 'words', note: 'words', p2: 'more words', img: 'photo', kicker: 'small line', calloutTitle: 'highlight title', calloutText: 'highlight words', linkText: 'link words', linkUrl: 'link', fields: 'form asks', bg: 'background' };
  const friendly = (m) => String(m).replace(/"([A-Za-z0-9]+)"/g, (x, k) => FRIENDLY[k] ? `"${FRIENDLY[k]}"` : x);
  // checked now on the site as it is; applied by the owner's page on the site as it is THEN (op 'layout')
  const layoutOp = (ctx, edit) => { try { L.applyEdit(ctx.website || {}, edit); } catch (e) { throw new ActionError(friendly(e.message)); } return { op: 'layout', edit }; };
  const where = (a, ctx) => a.before ? `above "${L.label(findSection(ctx, a.before, a.page))}"` : a.after ? `below "${L.label(findSection(ctx, a.after, a.page))}"` : a.at === 'top' ? (L.isHome(a.page) ? 'at the top, right after the top of the page' : 'at the top of the page') : a.at === 'bottom' ? 'at the very bottom' : (L.isHome(a.page) ? 'near the end, above "Find us"' : 'at the end');
  const said = (a) => Object.keys(SECTION_PARAMS).filter(k => a[k] !== undefined).map(k => ({
    items: `the list (${a.items && a.items.length})`, add_items: `${a.add_items && a.add_items.length} more`, remove_items: `${a.remove_items && a.remove_items.length} taken out`, small_line: 'the small line',
    more_words: 'the second paragraph', link_words: 'the link words', form_asks: 'what the form asks',
    background: `a ${a.background === 'alt' ? 'shaded' : a.background} background`, align: `words ${a.align === 'center' ? 'centred' : 'on the left'}`, show: a.show === 'today' ? 'only today\'s special showing' : 'every special showing' }[k] || `the ${k.replace(/_/g, ' ')}`));

  // a short look at one section for the model: enough to know what is there and to change it
  function sectionDigest(b, c, full) {
    const o = { section: b.id, kind: L.BUILTIN[b.type] ? 'built in' : b.type, name: L.label(b), shows: L.isOn(b, c) };
    if (L.CUSTOM[b.type]) {
      if (b.kicker) o.small_line = b.kicker;
      const w = b.p1 || b.body || b.text || b.intro || b.note; if (w) o.words = full ? w : clip(w, 50);
      if (Array.isArray(b.items)) o.items = full ? b.items : b.items.slice(0, 4).map(x => clip(x.q || x.text || x.title || x.name || '', 40)).concat(b.items.length > 4 ? [`and ${b.items.length - 4} more`] : []);
      if (b.img) o.photo = b.img;
      if (b.bg && b.bg !== 'auto') o.background = b.bg; if (b.align && b.align !== 'auto') o.align = b.align;
      if (b.type === 'specials') o.show = b.show === 'today' ? 'only today\'s' : 'all, today\'s marked';
      if (full) for (const k of ['p2', 'calloutTitle', 'calloutText', 'linkText', 'linkUrl', 'button', 'link', 'thanks', 'fields']) if (b[k]) o[FRIENDLY[k] || k] = b[k];
    } else if (b.type === 'ctaEnd') { o.title = b.title || 'Ready to play?'; if (full) { o.words = b.text || ''; o.button = b.button || ''; o.link = b.link || ''; } }
    else o.edited_with = { offers: 'the Offer Slides card', steps: 'website_steps_set', staffed: 'the Staffed Days card', gallery: 'website_gallery_add', event: 'event_add and event_edit', memberships: 'the Memberships card', promo: 'website_promo_set', visit: 'website_contact_set' }[b.type];
    return o;
  }

  // ── colours by name: a small model says "dark green", not #1c3a26 ──
  // one list for every colour the assistant names (services/assistant/colours.js - a routine's button uses it too)
  const { NAMED } = require('../colours');
  const colour = (v, role) => {
    const s = String(v || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map(x => x + x).join('');
    if (NAMED[s]) return NAMED[s];
    throw new ActionError(`"${v}" is not a colour I know for the ${role} - say it as #RRGGBB, or a plain name like navy, gold, dark green or charcoal`);
  };
  const ROLE = { background: 'bg', shaded_background: 'bg2', cards: 'card', lines: 'line', text: 'text', soft_text: 'muted', headings: 'heading', accent: 'accent', links: 'accent2', buttons: 'btn', button_text: 'btnText', header: 'headerBg', header_text: 'headerText' };
  const palette = (a, ctx) => {
    const th = (ctx.website || {}).theme || {}, P = T().PRESETS;
    const base = Object.assign({}, P[a.start_from] || P[th.preset] || P[T().DEFAULT_PRESET], !a.start_from && th.custom && th.colors ? Object.fromEntries(Object.entries(th.colors).filter(([, v]) => T().isHex(v))) : {});
    const given = Object.keys(ROLE).filter(k => a[k] !== undefined);
    for (const k of given) base[ROLE[k]] = colour(a[k], k.replace(/_/g, ' '));
    // TEXT THE OWNER DID NOT NAME READS ON WHAT IT SITS ON (the walk in maintainer's typing, Oct 23 2026: "make the site darker" was put up by the
    // 4B with white button text on orange buttons, 2.84:1, and only a warning): each text colour the owner's own words never named that
    // fails 4.5:1 is black or white, whichever reads - said on the card
    const words = String(ctx.newest || '').toLowerCase(), fixed = [];
    // (the owner named it when their words carry the colour as given - "orange buttons with white text": test-assistant A37 - or the part)
    for (const [fg, key, on, re, say] of [['btnText', 'button_text', ['btn'], /button text/, 'button text'], ['headerText', 'header_text', ['headerBg'], /header text/, 'header text'], ['text', 'text', ['bg', 'card'], /\b(?:body |main )?text\b/, 'text'], ['heading', 'headings', ['bg', 'card'], /headings?|titles?/, 'headings']]) {
      const worst = (c) => Math.min(...on.map(b => T().contrastRatio(c, base[b])));
      if (re.test(words) || (a[key] !== undefined && words.includes(String(a[key]).trim().toLowerCase())) || !(worst(base[fg]) < 4.5)) continue;
      const pick = worst('#000000') >= worst('#ffffff') ? '#000000' : '#ffffff';
      if (worst(pick) >= 4.5) { base[fg] = pick; fixed.push(`${say} ${pick === '#000000' ? 'black' : 'white'}`); }
    }
    return { base, given, fixed, preset: a.start_from || (P[th.preset] ? th.preset : T().DEFAULT_PRESET) };
  };

  // ── search, menu, pages ──
  const PAGE_KEY = { 'whole site': null, site: null, homepage: 'landing', 'booking page': 'booking', booking: 'booking', events: 'events', memberships: 'memberships', 'gift cards': 'giftCards', 'how it works': 'howItWorks', 'holding page': 'holding' };
  const NAV_KEY = { events: 'events', memberships: 'memberships', 'gift cards': 'gift-cards', 'how it works': 'how-it-works', leagues: 'leagues' };
  const pagesOf = (ctx) => (Array.isArray((ctx.website || {}).pages) ? ctx.website.pages : []).filter(p => p && p.slug);
  function findPage(ctx, ref) {
    const n = String(ref || '').trim().toLowerCase().replace(/^\/?p\//, '').replace(/^\//, '');
    const pages = pagesOf(ctx);
    const hit = pages.filter(p => p.slug.toLowerCase() === n || String(p.title || '').toLowerCase() === n);
    if (hit.length === 1) return hit[0];
    const some = pages.filter(p => n.length >= 3 && (String(p.title || '').toLowerCase().includes(n) || p.slug.toLowerCase().includes(n)));
    if (some.length === 1) return some[0];
    throw new ActionError(`${some.length > 1 ? 'more than one page matches' : 'no page called'} "${ref}" (the pages: ${pages.map(p => `${p.title} (/p/${p.slug})`).join(', ') || 'none yet'})`);
  }
  // the parts of the site a version is kept for, in the owner's words (routes/website.js CONTENT_KEYS)
  const PART = { 'top of the page': 'hero', sections: 'layout', 'colours and fonts': 'theme', 'offer slides': 'offers', 'how it works strip': 'steps', 'staffed days words': 'staffed',
    gallery: 'gallery', 'offer band': 'promo', 'contact details': 'visit', 'site settings': 'settings', memberships: 'memberships', pages: 'pages', menu: 'nav', social: 'social' };

  // an event by the owner's words: its title (and date when two share one)
  const findEvent = (ctx, ref) => {
    const evs = ctx.events || []; const n = String(ref || '').trim().toLowerCase();
    const hit = evs.filter(e => e.id === ref || String(e.title).toLowerCase() === n || e.event_date === n);
    if (hit.length === 1) return hit[0];
    const some = evs.filter(e => n.length >= 3 && String(e.title).toLowerCase().includes(n));
    if (some.length === 1) return some[0];
    throw new ActionError(`${hit.length + some.length > 1 ? 'more than one event matches' : 'no event called'} "${ref}" (the events: ${evs.slice(0, 8).map(e => `${e.title} on ${e.event_date}`).join(', ') || 'none'}) - say which by its title and date`);
  };

  // a name that is no special on the homepage but is one deal, package, event or counter special: flyer_make's
  function specialOrOther(ctx, ref) {
    try { specialAt(ctx, ref); return false; } catch (e) { /* not on the homepage */ }
    try { return flyerHits(ref, require('../../flyers').sources(ctx.today)).length === 1; } catch { return false; }
  }
  // what a flyer is for, found by the owner's way of naming it ("that tuesday deal", "the birthday one" - the 4B passed "that tuesday
  // deal", Oct 22 2026): its name whole, then its start, then in it, then every word of it, then the one with the most of them
  function flyerHits(about, all, strict) {
    const n = String(about || '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:for\s+)?(?:the|our|my|a|an|that|this|those|these|it)\s+/, '').replace(/\s+(?:deal|deals|package|special|event|night|one|flyer)$/, '');
    if (!n) return [];
    const by = (test) => all.filter(x => test(String(x.name).toLowerCase()));
    const STOP = /^(?:the|our|my|a|an|that|this|those|these|it|for|of|on|with|and|deal|deals|package|special|event|one|flyer|new|party)$/;
    const words = n.split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.test(w)).map(w => w.replace(/s$/, ''));
    let hit = by(x => x === n); if (!hit.length) hit = by(x => x.startsWith(n)); if (!hit.length) hit = by(x => x.includes(n));
    if (!hit.length && words.length) hit = all.filter(x => words.every(w => x.name.toLowerCase().includes(w)));
    // (loosely, by the words of its NAME only, and at least half of them - its line shares "hours", "get" and "free" with every deal:
    // "Buy 1 Hour, Get 1 Hour Free" matched the pitcher deal by its line; a title is only ever matched strictly)
    if (!hit.length && words.length && !strict) { const score = all.map(x => words.filter(w => x.name.toLowerCase().includes(w)).length); const top = Math.max(0, ...score); const best = all.filter((x, i) => top > 0 && top >= Math.ceil(words.length / 2) && score[i] === top); if (best.length === 1) hit = best; }
    return hit;
  }
  // A FLYER SAID PLAINLY (Oct 22 2026, late night; the walks on the 4B: "now a flyer for the birthday package" was answered "that is
  // outside the tools available"): "a flyer for X" where X is a deal, package, event or special by its name - or "for that" / "for it",
  // the one just made in this talk - is the box's own call; anything else is the model's
  function flyerRead(words, conv, ctx) {
    const m = /\bflyers?\s+(?:for|about|of|on)\s+(.{2,60}?)\s*[.!?]*$/i.exec(String(words || '').trim());
    if (!m || /\?/.test(words) || String(words).split(/\s+/).length > 16) return null;
    if (/^(?:ok(?:ay)?,?\s+|so,?\s+)?(?:how|what|why|where|who|which|do|does|did|is|are|was|were)\b/i.test(String(words).trim())) return null;
    let about = m[1].trim();
    if (/^(?:that|it|this|that one|this one|that deal|this deal|that package|the one|the new one)$/i.test(about)) about = (conv && conv.lastThing) || '';
    if (!about) return null;
    let all = []; try { all = require('../../flyers').sources(ctx && ctx.today); } catch {}
    return flyerHits(about, all).length === 1 ? { about } : null;
  }
  // a flyer made from the model's own words (not a deal, package, event or special found by its name) that names a price or a deal
  const flyerOwnWords = (a, ctx) => {
    if (!a.title) return false;
    try { if (flyerHits(a.title, require('../../flyers').sources(ctx.today), true).length === 1) return false; } catch {}
    try { const all = require('../../flyers').sources(ctx.today), t = String(a.about || a.title).toLowerCase();
      if (a.about && all.some(x => String(x.name).toLowerCase().includes(t.replace(/^(?:the|our|my|that|this)\s+/, '').replace(/\s+(?:deal|package|special|event|one)$/, '')))) return false; } catch {}
    return /\$|\d+\s*%|\bfree\b|\boff\b|\bdeal\b|\bpackage\b|\bhours?\b|\bper person\b|\ba person\b/i.test([a.title, a.words, a.price].join(' '));
  };
  // a network as the owner says it, and a handle as its full address ("insta" "bearcatgolf" -> https://instagram.com/bearcatgolf)
  const socialKey = (n) => { const t = String(n || '').toLowerCase().replace(/\s+/g, ''); return /^(?:insta|instagram|ig)$/.test(t) ? 'instagram' : /^(?:fb|facebook)$/.test(t) ? 'facebook' : t === 'tiktok' ? 'tiktok' : /^(?:youtube|yt)$/.test(t) ? 'youtube' : t === 'twitter' ? 'x' : null; };
  // A LINK IS PUT UP ONLY FROM THE WORDS OF PUTTING IT UP (Oct 27 2026, the review of round 2: "unlink our insta @bearcatgolf", "unpublish
  // our insta @bearcatgolf", "our insta @bearcatgolf should come off the site", "our insta @bearcatgolf got hacked", "we lost access to our
  // insta @bearcatgolf" each set that link live at once - the social links are a look change, applied with no yes - and "share words:
  // how do i put it on fb" set the Facebook link to "how"). A list of the words that take a link down would miss the next one, so this
  // reads only the words "here is our link" is made of: add / put / set / use / update / change, our / the / new, the network, link /
  // page / account / handle, is / its / should be, on the site / footer - and the address or handle itself. One other word is the
  // model's. A complaint about the link is read only before the right one is given ("the facebook link is broken, it should be
  // facebook.com/golfbarn"); a label is the owner's title only when it is made of these same words
  // (Oct 27 2026, the review of round 2: "use @bearcatgolf for instagram" and "we changed our insta to @bearcatgolf" are the plain ways to
  // give a link too - "for", "changed", "updated", "switched", "moved")
  const SOCIAL_WORDS = new Set(`ok okay so and also hey please pls plz now yeah yes yep cool great thanks thx hi i we we're were you u can could would will
    add put set use update change make list show link links here here's heres is are its it's it our my the a an new insta instagram ig fb facebook face book tiktok
    tik tok youtube you tube yt twitter x page account handle name username user profile channel to as at on in under site website web footer homepage home too
    should be called actually instead right one go - : = words only social for changed updated switched moved`.trim().split(/\s+/));
  const SOCIAL_FIX = /(?:^|\s)(?:it )?(?:should be|should go to|is now|is actually|change it to|make it|the new one is|new one is|the right one is|use|instead it'?s)\s*$/;
  const SOCIAL_GRIPE = new Set('broken wrong outdated old dead down not working isn\'t doesn\'t work bad incorrect goes points pointing link is the our facebook fb insta instagram ig tiktok youtube twitter x page account'.split(' '));
  function socialPlain(s, m) {
    const low = String(s).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s*(?:\u2014|\u2013|-{2,})\s*/g, ' - ').replace(/\s*(?:\.{2,}|\u2026)\s*/g, '. ');
    const at = low.indexOf(m[0].toLowerCase()); if (at < 0) return false;
    const before = low.slice(0, at), after = low.slice(at + m[0].length);
    const words = (t) => t.replace(/[,;:=!.?()"]+/g, ' ').split(/\s+/).filter(Boolean);
    // (the label first: the owner's title only in these same words)
    const lab = /^[a-z0-9 ']{1,30}:\s+(?=\S)/.exec(before);
    const head = lab ? before.slice(lab[0].length) : before;
    if (lab && !words(lab[0].replace(/:\s*$/, '')).every(w => SOCIAL_WORDS.has(w))) return false;
    // (the part the address is in, and anything before it: a complaint only when the address is given as the right one)
    const parts = head.split(/[,;!.?]\s+|\s-\s/);
    const own = parts.pop(), fix = SOCIAL_FIX.test(own);
    if (!words(own).every(w => SOCIAL_WORDS.has(w))) return false;
    if (parts.some(p => !words(p).every(w => SOCIAL_WORDS.has(w) || (fix && SOCIAL_GRIPE.has(w))))) return false;
    return words(after).every(w => SOCIAL_WORDS.has(w));
  }
  const socialUrl = (k, v) => { const t = String(v || '').trim(); if (!t || /^https?:\/\//i.test(t)) return t.replace(/^http:/i, 'https:'); const h = t.replace(/^@/, '').replace(/^(?:www\.)?(?:instagram|facebook|fb|tiktok|youtube|x|twitter)\.com\//i, '').replace(/^@/, '');
    if (!/^[A-Za-z0-9._-]{2,60}$/.test(h)) return t;
    return k === 'instagram' ? `https://instagram.com/${h}` : k === 'facebook' ? `https://facebook.com/${h}` : k === 'tiktok' ? `https://www.tiktok.com/@${h}` : k === 'youtube' ? `https://youtube.com/@${h}` : `https://x.com/${h}`; };
  const actions = [
    // ── look ──
    { name: 'website_read', kind: 'read', say: 'Look at the website as it is now: what visitors see first, the homepage\'s sections in order (each with its id, kind, name and whether it shows), the top of the page, the look (colours, fonts, style), the pages, the menu, social links, search words and upcoming events. Read it before changing a section',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const r = await ctx.call('GET', '/api/website/content'); const j = r.json || {}; const c = j.content || {}; const st = c.settings || {};
        const pub = L.publicMap(st); const h = c.hero || {}; const th = c.theme || {};
        const btns = Array.isArray(h.buttons) && h.buttons.length ? h.buttons : [{ label: h.ctaText || 'Book a Bay', link: h.ctaLink || '/book', show: true }];
        return {
          homepage: st.siteEnabled === false ? 'the website is switched OFF - the booking page is what visitors see' : st.homepage === 'landing' ? 'this website is the homepage' : 'the booking page is the homepage; this website is at /landing',
          top_of_page: { tag: h.tag || '(standard)', headline: h.headline || '(standard)', line: clip(h.sub || '', 80) || '(standard)', buttons: btns.slice(0, 2).map(b => ({ words: b.label, goes_to: b.link, shows: b.show !== false })), photos: (h.images || []).filter(Boolean).length, video: !!h.video, logo: h.showLogo !== false },
          sections: L.defaultLayout(c).map(b => sectionDigest(b, c, false)),
          look: { colours: th.custom ? 'custom colours' : (th.preset || T().DEFAULT_PRESET), fonts: T().resolveFonts(th), style: S.clean(th.design || {}) },
          pages: (c.pages || []).filter(p => p && p.slug).map(p => ({ page: p.title, address: '/p/' + p.slug, live: !!p.published && pub.pages[String(p.slug).toLowerCase()] !== false, in_menu: !!p.showInNav, in_footer: p.showInFooter !== false,
            sections: L.isSectionsPage(p) ? L.pageLayout(p).map(b => ({ section: b.id, kind: b.type, name: L.label(b), shows: b.on !== false })) : undefined })),
          menu: ((j.nav && j.nav.items) || []).map(x => ({ item: x.label, goes_to: x.href, top: !!x.top, footer: !!x.foot })),
          hidden_parts: Object.keys(pub).filter(k => k !== 'pages' && pub[k] === false),
          social: Object.keys(c.social || {}).filter(k => k !== 'more' && typeof c.social[k] === 'string' && c.social[k]),
          search: { site_title: st.siteTitle || '(automatic)', description: st.metaDescription ? clip(st.metaDescription, 60) : 'not set', share_photo: st.shareImage ? 'set' : 'not set' },
          upcoming_events: (j.events || []).slice(0, 6).map(e => ({ event: e.title, date: e.event_date })),
        };
      } },
    // A LOOK OVER THE SITE BEFORE IT GOES LIVE (the builders' "site check"; maintainer's contrast rule - warn, never block)
    { name: 'website_check', kind: 'read', say: 'Check the website over before it goes live, or when the owner asks "is my site ready?": what is missing (photos, logo, search words, social links), starter words still in a section, colours that are hard to read, buttons hidden because they point at a part that is not public, and whether it is the homepage yet. Then offer to fix each, one at a time',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const r = await ctx.call('GET', '/api/website/content'); const j = r.json || {}; const c = j.content || {}; const st = c.settings || {};
        let logo = null; try { const lg = await ctx.call('GET', '/api/uploads/logo'); logo = !!(lg.json && lg.json.hasLogo); } catch {}
        const fix = [], fine = [];
        const th = c.theme || {}, P = T().PRESETS;
        const colors = Object.assign({}, P[th.preset] || P[T().DEFAULT_PRESET], th.custom && th.colors ? Object.fromEntries(Object.entries(th.colors).filter(([, v]) => T().isHex(v))) : {});
        const hard = T().auditColors(colors).issues;
        if (hard.length) fix.push('hard to read: ' + hard.slice(0, 4).map(i => `${i.pair.toLowerCase()} (${i.ratio}:1, easy reading is 4.5:1)`).join('; ')); else fine.push('every colour pair reads well');
        const h = c.hero || {};
        if (!(h.images || []).filter(Boolean).length && !h.video) fix.push('the top of the page has no photo yet - the owner can add one in the chat'); else fine.push('the top of the page has a photo');
        if (logo === false) fix.push('no logo yet (logo_upload)'); else if (logo) fine.push('the logo is up');
        if (!String(h.headline || '').trim()) fix.push('the headline is still the standard one - offer one that names the city and says golf simulator');
        // starter words a section was made with and never changed (site-layout.js CUSTOM make())
        const starters = new Set(['A headline', 'Your words here.', 'A card', 'A line about it.', 'A kind word.', 'A player']);
        for (const b of L.defaultLayout(c)) {
          if (!L.CUSTOM[b.type] || b.on === false) continue;
          const words = [b.title, b.p1, b.body].concat((b.items || []).map(x => x.title || x.text || x.who)).filter(Boolean);
          if (words.some(w => starters.has(String(w).trim()))) fix.push(`"${L.label(b)}" still has starter words`);
          if (b.type === 'story' && !b.img) fix.push(`"${L.label(b)}" has no photo`);
        }
        const gal = ((c.gallery || {}).items || []);
        const noCap = gal.filter(x => x && x.img && !String(x.caption || '').trim()).length;
        if (noCap) fix.push(`${noCap} gallery photo${noCap === 1 ? ' has' : 's have'} no caption (what a screen reader says)`);
        // buttons that point at nothing show nothing (rule 20): say which, so the owner is not surprised
        const pub = L.publicMap(st);
        const btns = Array.isArray(h.buttons) && h.buttons.length ? h.buttons : [{ label: h.ctaText || 'Book a Bay', link: h.ctaLink || '/book', show: true }];
        for (const b of btns) if (b && b.show !== false && b.link && !L.linkAlive(c, pub, b.link)) fix.push(`the top button "${b.label}" points at ${b.link}, which is hidden or not there - so the button does not show`);
        if (!st.metaDescription) fix.push('no search description (website_search_set) - what Google shows under the name'); else fine.push('the search description is set');
        if (!st.shareImage && !(h.images || []).filter(Boolean).length) fix.push('no picture for when the site is shared');
        const soc = Object.keys(c.social || {}).filter(k => k !== 'more' && c.social[k]);
        if (!soc.length) fix.push('no social links (website_social_set)'); else fine.push('social links: ' + soc.join(', '));
        const hidden = Object.keys(pub).filter(k => k !== 'pages' && pub[k] === false);
        if (hidden.length) fine.push('hidden on purpose: ' + hidden.join(', '));
        if (st.siteEnabled === false) fix.push('the website is switched off');
        else if (st.homepage !== 'landing') fix.push('the booking page is still the homepage - make this site the homepage when it is ready (website_homepage_set)');
        else fine.push('this site is the homepage');
        return { to_fix: fix, looks_good: fine };
      } },
    { name: 'website_section_read', kind: 'read', say: 'Look at everything in one homepage section (all its words and its whole list) before changing part of it',
      params: { type: 'object', properties: { section: { type: 'string', minLength: 1, maxLength: 120, description: 'its id, its name or its title' }, page: PAGE_P }, required: ['section'] },
      needs: ['website'],
      // a section the homepage does not hold is looked for on the owner's pages, and the page is said FIRST with it (Oct 20 2026,
      // late: a whole-site read is cut short on a full site, so "where is the menu?" is answered by this one read)
      local: async (a, ctx) => {
        if (!L.isHome(a.page)) return Object.assign({ page: pageOf(ctx, a.page).title }, sectionDigest(findSection(ctx, a.section, a.page), ctx.website || {}, true));
        try { return sectionDigest(findSection(ctx, a.section), ctx.website || {}, true); }
        catch (e) {
          if (!/^no section called/.test(String(e.message))) throw e;
          for (const p of ((ctx.website || {}).pages || [])) {
            if (!p) continue; let b = null; try { b = L.findBlock(L.pageLayout(p), a.section); } catch {}
            if (b) return Object.assign({ page: p.title }, sectionDigest(b, ctx.website || {}, true));
          }
          throw e;
        }
      } },

    // ── the homepage's sections ──
    { name: 'website_section_add', kind: 'write', confirm: false,
      say: 'Add a section to the homepage, with its words. Kinds: story (a photo beside words), text (words only), faq (questions and answers), rates (your prices, live), quotes (what players say), video, cta (a band with one button), form (an inquiry form - parties, leagues, lessons), social (your social links), signup (email updates), specials (weekly specials by day), menu (food and drink), cards (coaches, lessons, packages, the simulators), banner (a full-width photo with a headline and a button). When the owner has not said where, ask: right after the top of the page, before or after another section, or near the end (a food or drink special with a price is counter_special_set - it shows in the weekly specials by itself; the email sign-up box everywhere is email_updates_set)',
      params: { type: 'object', properties: Object.assign({ kind: { type: 'string', enum: Object.keys(L.CUSTOM) },
        at: { type: 'string', enum: ['top', 'bottom'], description: 'top = right after the top of the page' }, before: { type: 'string', maxLength: 120, description: 'a section to put it above' }, after: { type: 'string', maxLength: 120, description: 'a section to put it below' }, page: PAGE_P },
        Object.fromEntries(Object.entries(SECTION_PARAMS).filter(([k]) => !['add_items', 'remove_items'].includes(k)))), required: ['kind'] },
      needs: ['website'],
      build: (a, ctx) => {
        // GIFT CARDS HAVE THEIR OWN PAGE (the walk in maintainer's typing, Oct 23 2026: "put the gift cards on the site" was put up by the 4B as
        // three typed cards - "Gift Card $20/$50/$100", each a "Book a session" button to the booking page, where nobody can buy one)
        if (a.kind === 'cards' && a.cards_source !== 'packages' && /\bgift ?cards?\b/i.test([a.title, a.words, ...(a.items || []).map(x => x && x.name)].join(' ')))
          throw new ActionError('gift cards have their own page where customers buy them (/gift-cards) - show it in the menu with website_menu_set (item "gift cards", top_menu true); typed cards would send customers to the booking page');
        const fields = sectionFields(a.kind, a).fields;
        if (a.kind === 'menu' && a.menu_source === 'counter' && !a.items) fields.items = [];   // the counter's menu: no starter items under it
        if (a.kind === 'cards' && a.cards_source === 'packages' && !a.items) fields.items = [];   // the packages, live: no starter cards under them
        return layoutOp(ctx, { do: 'add', type: a.kind, fields, at: a.at, before: a.before, after: a.after, page: a.page });
      },
      describe: (a, ctx) => `Add ${an(kindName(a.kind).toLowerCase())} section${a.title ? ` "${a.title}"` : ''} to ${onWhat(a.page, ctx)}, ${where(a, ctx)}${Array.isArray(a.items) && L.ITEM_SHAPES[a.kind] ? `, with ${a.items.length} ${L.ITEM_SHAPES[a.kind].word}${a.items.length === 1 ? '' : 's'}` : ''}` },
    { name: 'website_section_edit', kind: 'write', confirm: false, say: 'Change a homepage section: its words, its list (replace it, add to it, take items out), its photo, its background or alignment. Read the section first when changing part of a list',
      params: { type: 'object', properties: Object.assign({ section: { type: 'string', minLength: 1, maxLength: 120, description: 'its id, its name or its title' }, page: PAGE_P }, SECTION_PARAMS), required: ['section'] },
      needs: ['website'],
      build: (a, ctx) => {
        const b = findSection(ctx, a.section, a.page);
        if (L.BUILTIN[b.type] && b.type !== 'ctaEnd') throw new ActionError(`${L.label(b)} is changed with ${sectionDigest(b, ctx.website || {}).edited_with}, not here`);
        const f = sectionFields(b.type, a);
        if (!Object.keys(f.fields).length && !f.addItems && !f.dropItems) throw new ActionError(`say what to change in ${L.label(b)}`);
        return layoutOp(ctx, { do: 'edit', block: b.id, fields: f.fields, addItems: f.addItems, dropItems: f.dropItems, page: a.page });
      },
      describe: (a, ctx) => `Change "${L.label(findSection(ctx, a.section, a.page))}"${L.isHome(a.page) ? '' : ' on ' + onWhat(a.page, ctx)}: ${said(a).join(', ')}` },
    // WHERE A SPECIAL SHOWS (Oct 20 2026, night; maintainer: "allow them to put it anywhere ... and guide them to the best answer as
    // well. and do you wana try it here or here"): beside its section, on its day - the top of the homepage, the slides under
    // it, the booking page. "Try it in the slides instead" replaces the places; "also on the booking page" adds one
    { name: 'special_place', kind: 'write', confirm: false, needs: ['website'],
      say: 'Put a special somewhere else on its day, beside its specials section: the top of the homepage (in place of the photo - the first thing people see, the usual choice for one night), the slides under the top, the booking page. Recommend one and say why, then offer the others',
      params: { type: 'object', properties: {
        special: { type: 'string', minLength: 1, maxLength: 80, description: 'the special by its name' },
        show_also: { type: 'array', maxItems: 3, items: { type: 'string', enum: L.ALSO }, description: 'where else it shows on its day: top, slides, booking - empty for its section only' },
        add: { type: 'boolean', description: 'true: add these places to the ones it has ("also on the booking page"); otherwise they replace them ("try it in the slides instead")' } }, required: ['special', 'show_also'] },
      build: (a, ctx) => {
        const found = specialAt(ctx, a.special);
        const have = String(found.item.also || '').split(',').filter(Boolean);
        const also = L.ALSO.filter(x => (a.add ? have.concat(a.show_also) : a.show_also).includes(x)).join(',');
        return layoutOp(ctx, { do: 'edit', block: found.block.id, setItem: { ref: found.item.title, fields: { also } }, page: found.page });
      },
      describe: (a, ctx) => {
        const found = specialAt(ctx, a.special), have = String(found.item.also || '').split(',').filter(Boolean);
        const places = L.ALSO.filter(x => (a.add ? have.concat(a.show_also) : a.show_also).includes(x));
        const say = { top: 'at the top of the homepage, in place of its photo', slides: 'first in the slides under the top', booking: 'on the booking page' };
        return places.length ? `Show "${found.item.title}" on ${found.item.date ? 'its day' : 'the days it runs'} ${places.map(x => say[x]).join(', and ')} - and in its specials section` : `Show "${found.item.title}" in its specials section only`;
      } },
    // A SPECIAL'S FLYER (Oct 20 2026, late; maintainer: "a cool AI but not AI slop special of the day card to have in the slide show of
    // hero ... some sort of flyer they can either send out in an email if people signed up for it"): one of four designed
    // layouts filled with the site's own fonts, colours, name, logo and photo (public/flyer.js), drawn by the owner's page -
    // where the fonts are - and saved like any photo; first in the slides on the special's day, and newsletter_send carries it
    // at the top of the email
    // (with flyer_make in its own part, "flyers": "make a flyer for it" handed the website's whole part as well, and the talk naming the
    // special was trimmed to fit the small model's room - the browser battery's V9, Oct 22 2026, late night)
    { name: 'special_flyer', area: 'flyers', kind: 'write', confirm: false, needs: ['website'],
      say: 'Make (or remake) a special\'s flyer - a designed card in the site\'s own fonts, colours, name and logo, with a photo - and put it first in the slides on its day. Layouts: ' + Object.entries(FLY.LAYOUTS).map(([k, v]) => `${k} (${v.toLowerCase()})`).join(', ') + '. Then offer to email it out (newsletter_send with it as the picture)',
      params: { type: 'object', properties: {
        special: { type: 'string', minLength: 1, maxLength: 80, description: 'the special by its name' },
        layout: { type: 'string', enum: Object.keys(FLY.LAYOUTS), description: 'poster unless the owner asks for another: "bolder" or "make the deal big" is bold, "use the photo" is photo, "lighter" or "simpler" is clean' },
        photo: { type: 'string', maxLength: 200, description: 'a photo the owner added in the chat; left out: the special\'s own photo, else the first at the top of the homepage' },
        in_slides: { type: 'boolean', description: 'put it first in the slides on its day (yes unless the owner says not)' } }, required: ['special'] },
      build: (a, ctx) => {
        // (a deal, a package, an event or a counter special by that name is flyer_make's - the 4B reached for this tool for "a flyer for
        // that" after a booking deal, and the owner was told to put it on the homepage first: the walk, Oct 22 2026, late night)
        const other = specialOrOther(ctx, a.special); if (other) return actions.find(x => x.name === 'flyer_make').build({ about: a.special, layout: a.layout, photo: a.photo, in_slides: a.in_slides }, ctx);
        const found = specialAt(ctx, a.special), it = found.item, site = ctx.website || {}, th = T().resolveSaved(site.theme), c = th.colors, F = T().FONTS;
        const photo = a.photo ? photoPath(a.photo) : (it.img || ((site.hero || {}).images || []).filter(Boolean)[0] || '');
        const draw = { layout: a.layout || 'poster', kicker: kickerOf(it, ctx), title: it.title, line: it.text || '', price: it.price || '', business: ctx.businessName || '',
          colors: { dark: c.headerBg, onDark: c.headerText, accent: c.accent, btn: c.btn, onBtn: c.btnText, light: c.bg, ink: c.heading, text: c.text },
          fonts: { heading: (F[th.fonts.heading] || F.playfair || {}).stack || 'Georgia,serif', body: (F[th.fonts.body] || {}).stack || 'system-ui,sans-serif' }, fontHref: T().fontHref(th.fonts) };
        const also = String(it.also || '').split(',').filter(Boolean);
        if (a.in_slides !== false && !also.includes('slides')) also.push('slides');
        const fields = { flyer: '__FLYER__', also: L.ALSO.filter(x => also.includes(x)).join(',') };
        // checked now, with a stand-in for the address the flyer gets once the owner's page has drawn and saved it
        layoutOp(ctx, { do: 'edit', block: found.block.id, setItem: { ref: it.title, fields: Object.assign({}, fields, { flyer: '/uploads/landing/flyer-check.jpg' }) }, page: found.page });
        return { op: 'flyer', draw, photo, logo: true, then: { op: 'layout', edit: { do: 'edit', block: found.block.id, setItem: { ref: it.title, fields }, page: found.page } } };
      },
      describe: (a, ctx) => { if (specialOrOther(ctx, a.special)) return actions.find(x => x.name === 'flyer_make').describe({ about: a.special, layout: a.layout, photo: a.photo, in_slides: a.in_slides }, ctx);
        const f = specialAt(ctx, a.special), lay = a.layout || 'poster'; return `A flyer for "${f.item.title}" - ${FLY.LAYOUTS[lay].toLowerCase()} - in your own fonts, colours and name${a.in_slides !== false ? `, first in the slides on ${f.item.date ? 'its day' : 'the days it runs'}` : ''}`; } },
    // A FLYER FOR ANYTHING THE FACILITY RUNS (Oct 22 2026, night; maintainer: "make a flyer and put it on the home page and email it out ...
    // export it and put in on FB? ... good nice flyers"): a booking deal, a package deal, an event or a counter special found by its
    // name (services/flyers.js), its words from the thing itself - never the model's - drawn in the same layouts, first in the offer
    // slides until its last day; the chat card downloads it for Facebook and Instagram. A homepage special keeps special_flyer
    // (a flyer in the model's own words for something with a price or a deal is a card to approve, saying when nothing by that name is
    // set up: the 4B made one for "Buy 1 Hour, Get 1 Hour Free" and one for a party package whose tax was still being asked - neither
    // set up, so the counter would not have given what the flyer said; the walk on the 4B, Oct 22 2026, night)
    // (its own part, "flyers": in the website's part it pushed the page tools out of a small model's room on a long talk - the browser
    // battery's site-shape walk, Oct 22 2026, late night)
    { name: 'flyer_make', area: 'flyers', kind: 'write', needs: ['website'], confirm: (a, ctx) => flyerOwnWords(a, ctx),
      say: 'Make a flyer for a booking deal, package, event or special by its name ("a flyer for the Tuesday deal"), or from the owner\'s own words - first in the homepage slides, with Facebook and Instagram downloads; then offer newsletter_send with it as the picture',
      params: { type: 'object', properties: {
        about: { type: 'string', maxLength: 80, description: 'the deal, package, event or special by its name' },
        title: { type: 'string', maxLength: 80, description: 'only for something not set up' }, words: { type: 'string', maxLength: 200 },
        price: { type: 'string', maxLength: 40 },
        layout: { type: 'string', enum: Object.keys(FLY.LAYOUTS), description: 'poster; "bolder" is bold, "use the photo" is photo, "simpler" is clean' },
        photo: { type: 'string', maxLength: 200, description: 'a photo the owner added in the chat' },
        in_slides: { type: 'boolean' } } },
      build: (a, ctx) => {
        const F = require('../../flyers'), all = F.sources(ctx.today);
        let s = null;
        if (a.about) {
          // a homepage special by that name is special_flyer's - the same card, kept on the special itself
          try { const hs = specialAt(ctx, a.about); if (hs && !a.title) { const sf = actions.find(x => x.name === 'special_flyer'); return sf.build({ special: hs.item.title, layout: a.layout, photo: a.photo, in_slides: a.in_slides }, ctx); } } catch (e) { /* not a homepage special */ }
          const hit = flyerHits(a.about, all);
          if (hit.length > 1) throw new ActionError(`more than one thing is called that: ${hit.map(x => `"${x.name}" (${x.kind})`).join(', ')} - say which`);
          s = hit[0] || null;
        }
        // (a title that is a deal's, package's, event's or special's own name is for that one - the 4B passed the package's name as the title)
        if (!s && a.title) { const h = flyerHits(a.title, all, true); if (h.length === 1) s = h[0]; }
        if (!s && !a.title) throw new ActionError(all.length ? `there is nothing called "${a.about || ''}" - a flyer can be made for ${all.map(x => `"${x.name}"`).slice(0, 8).join(', ')}, or from the owner's own words (title, words, price)` : 'there is no deal, package, event or special yet - make one first, or give the flyer its own words (title, words, price)');
        if (!s) s = { kind: 'own', id: String(a.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), name: a.title, kicker: '', title: a.title, line: a.words || '', price: a.price || '', until: '' };
        const B = F.base(ctx.website || {});
        const photo = a.photo ? photoPath(a.photo) : (s.photo || B.photos[0] || '');
        const draw = { layout: a.layout || 'poster', kicker: s.kicker, title: s.title, line: s.line, price: s.price, business: ctx.businessName || B.business, colors: B.colors, fonts: B.fonts, fontHref: B.fontHref, site: B.site };
        if (a.in_slides === false) return { op: 'flyer', draw, photo, logo: true };
        const slides = F.slidesWith(offersOf(ctx), s, '__FLYER__');
        return { op: 'flyer', draw, photo, logo: true, then: { op: 'content', key: 'offers', set: [['enabled', true], ['slides', slides]], focus: 'offers' } };
      },
      read: flyerRead,
      describe: (a, ctx) => {
        const r = actions.find(x => x.name === 'flyer_make').build(a, ctx);
        if (r.op === 'flyer' && r.then && r.then.op === 'layout') { const f = specialAt(ctx, a.about); return `A flyer for "${f.item.title}" - ${FLY.LAYOUTS[a.layout || 'poster'].toLowerCase()} - in your own fonts, colours and name${a.in_slides !== false ? `, first in the slides on ${f.item.date ? 'its day' : 'the days it runs'}` : ''}`; }
        const d = r.draw, sl = r.then ? (r.then.set[1][1][0] || {}) : null;
        const only = flyerOwnWords(a, ctx) ? ` Nothing called "${d.title}" is set up as a deal or a package yet - this flyer is only words: customers will not get it when they book or at the counter until it is. Set it up first, then make its flyer.` : '';
        return `A flyer for "${d.title}"${d.price ? ` (${d.price})` : ''} - ${FLY.LAYOUTS[d.layout].toLowerCase()} - in your own fonts, colours and name${sl ? `, first in your homepage's slides${sl.until ? ` until ${dayWords(sl.until)}` : ''}` : ''}.${only || ' Then download it for Facebook or Instagram, or email it out.'}`;
      } },
    { name: 'website_section_move', kind: 'write', confirm: false, say: 'Move a homepage section: to the top (right after the top of the page), to the bottom, up or down one, or above or below another section',
      params: { type: 'object', properties: { section: { type: 'string', minLength: 1, maxLength: 120 }, to: { type: 'string', enum: ['top', 'bottom', 'up', 'down'] }, before: { type: 'string', maxLength: 120 }, after: { type: 'string', maxLength: 120 }, page: PAGE_P }, required: ['section'] },
      needs: ['website'],
      build: (a, ctx) => layoutOp(ctx, { do: 'move', block: findSection(ctx, a.section, a.page).id, to: a.to, before: a.before, after: a.after, page: a.page }),
      describe: (a, ctx) => `Move "${L.label(findSection(ctx, a.section, a.page))}"${L.isHome(a.page) ? '' : ' on ' + onWhat(a.page, ctx)} ${a.before || a.after ? where(a, ctx) : { top: 'to the top, right after the top of the page', bottom: 'to the bottom', up: 'up one', down: 'down one' }[a.to]}` },
    { name: 'website_section_show', kind: 'write', confirm: false, say: 'Show or hide a homepage section (it keeps its words and its place)',
      params: { type: 'object', properties: { section: { type: 'string', minLength: 1, maxLength: 120 }, show: { type: 'boolean' }, page: PAGE_P }, required: ['section', 'show'] },
      needs: ['website'],
      build: (a, ctx) => layoutOp(ctx, { do: 'show', block: findSection(ctx, a.section, a.page).id, on: a.show, page: a.page }),
      describe: (a, ctx) => `${a.show ? 'Show' : 'Hide'} "${L.label(findSection(ctx, a.section, a.page))}" on ${onWhat(a.page, ctx)}${a.show ? '' : ' (its words stay, to show again any time)'}` },
    { name: 'website_section_remove', kind: 'write', confirm: true, say: 'Take a section off the homepage, words and all (a built-in part can only be hidden)',
      params: { type: 'object', properties: { section: { type: 'string', minLength: 1, maxLength: 120 }, page: PAGE_P }, required: ['section'] },
      needs: ['website'],
      build: (a, ctx) => layoutOp(ctx, { do: 'remove', block: findSection(ctx, a.section, a.page).id, page: a.page }),
      describe: (a, ctx) => `Take "${L.label(findSection(ctx, a.section, a.page))}" off ${onWhat(a.page, ctx)}, words and all (Undo, or Previous versions on the Page Layout card, puts it back)` },

    // ── ONE PAGE OR SEVERAL (Oct 20 2026, late; maintainer: "pages not pages ... so people can really make it feel like there own
    //    site right from the AI"): a section moves to a page of its own (made, and put in the top menu, in the same save),
    //    onto another of the owner's pages, or back onto the homepage; the whole site goes one-page. Each touches each part
    //    of the website once, so the one Undo on its line takes all of it back ──
    { name: 'website_section_to_page', area: 'pages', kind: 'write', confirm: false, needs: ['website'],
      say: 'Move a section to a page of its own ("give the menu its own page" - the page is made with the title given and put in the top menu), onto another of the owner\'s pages, or back onto the homepage. A page of its own suits a part with a lot to say (a long menu, leagues, parties); one page suits a small site',
      params: { type: 'object', properties: {
        section: { type: 'string', minLength: 1, maxLength: 120, description: 'its id, its name or its title' }, page: PAGE_P,
        to_page: { type: 'string', minLength: 1, maxLength: 60, description: 'where it goes: one of the owner\'s pages by its title, a NEW page\'s title (it is made), or "homepage"' },
        in_menu: { type: 'boolean', description: 'a new page: in the top menu (yes unless the owner says not)' } }, required: ['section', 'to_page'] },
      build: (a, ctx) => {
        const b = findSection(ctx, a.section, a.page);
        const edit = { do: 'moveTo', block: b.id, page: a.page, to: L.isHome(a.to_page) ? 'homepage' : a.to_page, publish: true };
        if (!L.isHome(a.to_page) && !hasPage(ctx, a.to_page)) {
          if (!slugOf(a.to_page)) throw new ActionError('a new page needs a title with some letters or numbers');
          edit.create = { slug: slugOf(a.to_page), title: String(a.to_page).trim(), inMenu: a.in_menu !== false };
        }
        return layoutOp(ctx, edit);
      },
      describe: (a, ctx) => {
        const b = findSection(ctx, a.section, a.page), to = L.isHome(a.to_page) ? 'the homepage' : hasPage(ctx, a.to_page) ? `the "${pageOf(ctx, a.to_page).title}" page` : `a new page of its own, "${String(a.to_page).trim()}" (/p/${slugOf(a.to_page)}${a.in_menu !== false ? ', in the top menu' : ''})`;
        return `Move "${L.label(b)}" from ${onWhat(a.page, ctx)} to ${to}`;
      } },
    { name: 'website_one_page', area: 'pages', kind: 'write', confirm: true, needs: ['website'],
      say: 'Put the whole site on one page: the sections of every page of the owner\'s own come onto the homepage, each page\'s menu link jumps down the homepage to them, and the pages are kept as drafts (nothing is deleted; "give X its own page" puts one back). Suits a small site',
      params: { type: 'object', properties: {} },
      build: (a, ctx) => layoutOp(ctx, { do: 'onePage' }),
      describe: (a, ctx) => {
        const pages = ((ctx.website || {}).pages || []).filter(p => p && p.published && L.isSectionsPage(p));
        return `Put the whole site on the homepage: ${pages.map(p => '"' + p.title + '"').join(', ')} come${pages.length === 1 ? 's' : ''} onto it, each menu link jumping down to its part (the pages kept as drafts)`;
      } },

    // ── style and colour ──
    { name: 'website_style_set', area: 'look', kind: 'write', confirm: false,
      say: 'Change how the site is shaped: a whole look at once (' + Object.entries(S.LOOKS).map(([k, l]) => `${k}: ${(l.label.split(' - ')[1] || l.label)}`).join('; ') + '), and/or any one place: ' + Object.entries(S.STYLE).map(([k]) => `${k} (${S.choices(k).join('/')})`).join(', ') + '. The first choice of each is the site as built',
      params: { type: 'object', properties: Object.assign({ look: { type: 'string', enum: Object.keys(S.LOOKS) } }, Object.fromEntries(Object.keys(S.STYLE).map(k => [k, { type: 'string', enum: S.choices(k), description: S.STYLE[k].label }]))) },
      needs: ['website'],
      build: (a, ctx) => {
        const cur = ((ctx.website || {}).theme || {}).design || {};
        const places = Object.keys(S.STYLE).filter(k => a[k] !== undefined);
        if (!a.look && !places.length) throw new ActionError('say a look or what to change');
        const d = a.look ? S.withLook(a.look) : Object.assign({}, cur);
        for (const k of places) d[k] = a[k];
        return { op: 'content', key: 'theme', set: [['design', S.clean(d)]], focus: a.heroAlign || a.heroHeight || a.heroShade || a.topBar ? 'hero' : undefined };
      },
      describe: (a) => 'The site\'s style: ' + [a.look && `the ${a.look} look`].concat(Object.keys(S.STYLE).filter(k => a[k] !== undefined).map(k => `${S.STYLE[k].label.toLowerCase()}: ${S.words(k, a[k]).toLowerCase()}`)).filter(Boolean).join(', ') },
    { name: 'website_colors_set', area: 'look', kind: 'write', confirm: false,
      say: 'Set the website\'s own colours (never a bay routine\'s button on the staff pad - that is routine_when_set), any of them, starting from a designed set when the owner names one: background, shaded_background, cards, lines, text, soft_text, headings, accent, links, buttons, button_text, header, header_text - each as #RRGGBB or a plain name (navy, gold, dark green, charcoal, cream...). The booking pages follow. A hard-to-read pair is said back, never blocked',
      params: { type: 'object', properties: Object.assign({ start_from: { type: 'string', enum: Object.keys(require('../../theme').PRESETS), description: 'a designed colour set to start from' } }, Object.fromEntries(Object.keys(ROLE).map(k => [k, { type: 'string', maxLength: 20 }]))) },
      needs: ['website'],
      build: (a, ctx) => {
        const p = palette(a, ctx);
        if (!p.given.length && !a.start_from) throw new ActionError('say which colours');
        return { op: 'content', key: 'theme', set: [['custom', true], ['preset', p.preset], ['colors', p.base]] };
      },
      describe: (a, ctx) => {
        const p = palette(a, ctx); const issues = T().auditColors(p.base).issues;
        return `The site's colours: ${[a.start_from && `starting from the ${a.start_from.replace(/-/g, ' ')} set`].concat(p.given.map(k => `${k.replace(/_/g, ' ')} ${p.base[ROLE[k]]}`)).filter(Boolean).join(', ')}` + (p.fixed.length ? ` (${p.fixed.join(', ')} - so it reads easily)` : '') + (issues.length ? `. Heads up - hard to read: ${issues.slice(0, 3).map(i => `${i.pair.toLowerCase()} (${i.ratio}:1; easy reading is 4.5:1)`).join('; ')}` : '');
      } },

    // THE FONTS (Oct 20 2026, maintainer: "being able to change fonts. Customize fonts ... make fonts all the same are huge, people
    // like that. Consistency and the readability, and that looks nice and fancy"): the Colors & Fonts card's Fonts part, by
    // talking - a whole set in one word, any of the three faces from the library, one font everywhere, plain small lines.
    // Saved in website_content.theme.fonts through the card's own save; services/theme.resolveFonts reads it on every page.
    { name: 'website_fonts_set', area: 'look', kind: 'write', confirm: false,
      say: 'Change the site\'s fonts: a whole set in one word (' + Object.entries(require('../../theme').FONT_SETS).map(([k, v]) => `${k}: ${v.label.split(' - ')[1]}`).join('; ') + '), or any one face - the headings, the words (text and buttons), the small lines above headings - from the font library; one font everywhere; plain small lines. Script faces are for headings and the small lines only. Heading weight, italics, letter spacing, line spacing, text weight and button capitals are website_style_set; the colour of any words is website_colors_set',
      params: { type: 'object', properties: {
        set: { type: 'string', enum: Object.keys(require('../../theme').FONT_SETS), description: 'a whole font set' },
        headings: { type: 'string', enum: Object.keys(require('../../theme').FONTS), description: 'the font for headings' },
        text: { type: 'string', enum: Object.keys(require('../../theme').FONTS).filter(require('../../theme').BODY_OK), description: 'the font for everything a visitor reads, and the buttons - never a script face' },
        small_lines: { type: 'string', enum: Object.keys(require('../../theme').FONTS), description: 'the font for the small line above a heading and the name in the top bar' },
        one_font: { type: 'boolean', description: 'true: ONE font everywhere - the text font (or the one named in text); false: headings, text and small lines may differ' },
        small_lines_style: { type: 'string', enum: ['spaced', 'plain'], description: 'spaced: wide-spaced CAPITALS (as built); plain: ordinary small text' } } },
      needs: ['website'],
      build: (a, ctx) => fontPlan(a, ctx).set,
      describe: (a, ctx) => fontPlan(a, ctx).words },

    // ── the top of the page ──
    { name: 'website_hero_set', kind: 'write', confirm: false, say: 'Change the top of the homepage beyond its words: its two buttons (words, where each goes, the second shown or not), the logo in the top bar, and the small "scroll" hint',
      params: { type: 'object', properties: {
        button1_words: { type: 'string', maxLength: 40 }, button1_link: { type: 'string', maxLength: 300, description: '/book, /memberships, /p/a-page, #a-section or https://...' },
        button2_words: { type: 'string', maxLength: 40 }, button2_link: { type: 'string', maxLength: 300 }, button2_show: { type: 'boolean' },
        logo: { type: 'boolean', description: 'show the logo in the top bar' }, scroll_hint: { type: 'boolean' }, scroll_hint_words: { type: 'string', maxLength: 24 } } },
      needs: ['website'],
      build: (a, ctx) => {
        const h = (ctx.website || {}).hero || {};
        const cur = Array.isArray(h.buttons) && h.buttons.length ? h.buttons.map(b => Object.assign({}, b)) : [{ label: h.ctaText || 'Book a Bay', link: h.ctaLink || '/book', show: true }];
        while (cur.length < 2) cur.push({ label: '', link: '', show: false });
        const set = [];
        if (a.button1_words !== undefined) cur[0].label = a.button1_words;
        if (a.button1_link !== undefined) cur[0].link = okLink(a.button1_link, 'the first button');
        if (a.button2_words !== undefined) { cur[1].label = a.button2_words; if (a.button2_show === undefined && a.button2_words) cur[1].show = true; }
        if (a.button2_link !== undefined) cur[1].link = okLink(a.button2_link, 'the second button');
        if (a.button2_show !== undefined) cur[1].show = a.button2_show;
        if (cur[1].show && (!cur[1].label || !cur[1].link)) throw new ActionError('the second button needs its words and where it goes');
        if (['button1_words', 'button1_link', 'button2_words', 'button2_link', 'button2_show'].some(k => a[k] !== undefined)) set.push(['buttons', cur.slice(0, 2)], ['ctaText', cur[0].label], ['ctaLink', cur[0].link]);
        if (a.logo !== undefined) set.push(['showLogo', a.logo]);
        if (a.scroll_hint !== undefined) set.push(['scrollHint', a.scroll_hint]);
        if (a.scroll_hint_words !== undefined) set.push(['scrollHintText', a.scroll_hint_words]);
        if (!set.length) throw new ActionError('say what to change at the top of the page');
        return { op: 'content', key: 'hero', set };
      },
      describe: (a) => 'The top of the homepage: ' + [a.button1_words !== undefined && `first button "${a.button1_words}"`, a.button1_link && `going to ${a.button1_link}`, a.button2_words !== undefined && `second button "${a.button2_words}"`, a.button2_link && `going to ${a.button2_link}`, a.button2_show !== undefined && (a.button2_show ? 'the second button shown' : 'the second button hidden'), a.logo !== undefined && (a.logo ? 'the logo shown' : 'no logo'), a.scroll_hint !== undefined && (a.scroll_hint ? 'the scroll hint shown' : 'no scroll hint'), a.scroll_hint_words && `the hint says "${a.scroll_hint_words}"`].filter(Boolean).join(', ') + '. A button pointing at a part of the site that is not public yet hides itself.' },

    // ── social, search and sharing ──
    // A HANDLE SAID IS ITS FULL ADDRESS (the walk in maintainer's typing, Oct 23 2026: "add our insta its bearcatgolf" was answered with a
    // question about where on the page - social links have their place, the footer and the Social section): the box's own reading,
    // and a bare handle from the model made the network's address
    { name: 'website_social_set', area: 'site', kind: 'write', confirm: false,
      read: (words) => { const s = String(words || '').trim();
        if (/\?/.test(s) || s.split(/\s+/).length > 14) return null;
        const net = /\b(insta(?:gram)?|ig|fb|face ?book|tik ?tok|you ?tube|yt|twitter)\b/i.exec(s); if (!net) return null;
        // (an address first - "facebook.com/bearcatgolf", "https://..." - then a bare handle: "its bearcatgolf", "@bearcatgolf")
        const u = /(https?:\/\/[^\s<>"']+)/i.exec(s) || /\b((?:www\.)?(?:instagram|facebook|fb|tiktok|youtube|x|twitter)\.com\/@?[A-Za-z0-9._-]+)/i.exec(s);
        // ("its bearcatgolf" before "@bearcatgolf" before "insta: bearcatgolf" - a colon may be the owner's own lead-in)
        const b = u ? null : (/\b(?:its|it's|it is|is)\s+@?([A-Za-z0-9._]{2,30})\b/i.exec(s) || /(?:^|\s)@([A-Za-z0-9._]{2,30})\b/.exec(s) || /[:=]\s*@?([A-Za-z0-9._]{2,30})\b/.exec(s));
        // A REPORT IS NOT AN ADDRESS (Oct 25 2026, the adversarial review: "the facebook link is broken" was put up - a look change, so
        // applied at once - as https://facebook.com/broken, over the owner's real link; "our insta is private", "ig is down", "tiktok is
        // dead" the same): a bare word with no @ is a handle only when it is not a word of English or a state ("bearcatgolf",
        // "fairwaygolf" are handles; "broken", "down", "fine", "not" are not), and never beside a complaint ("broken, its golfbarn now"
        // - which link is the owner's is theirs to say). An @handle or a full address is always read
        if (b && !/@/.test(b[0])) {
          const w = b[1].toLowerCase();
          if (/^(?:not|bad|old|new|off|out|up|ok|okay|on|in|at|to|so|no|yes|all|the|a|an|our|my|its|it|too|now|set|gone|down|dead|done|fine|good|live|lost|here|there|still|also|just|very|real|really|wrong|broken|busted|missing|private|public|hacked|locked|banned|outdated|working|showing|pointing|linking|going|messed|blank|empty|weird|slow|right|correct|incorrect|invalid|expired|deleted|removed|closed|disabled|suspended)$/.test(w)
            || (/^[a-z]{4,}$/.test(w) && require('../spelling').english().has(w))
            || /\b(?:broken|wrong|down|dead|gone|missing|hacked|outdated|busted|incorrect|not working|doesn'?t work|isn'?t working|should be|supposed to be)\b/i.test(s)) return null;
        }
        // AN OLD OR CLOSED LINK IS NOT THE ONE TO PUT UP (the review, Oct 27 2026: "our old insta is bearcatgolf" and "we closed our
        // facebook, it is fairwaygolf" were applied at once as the live link; "our facebook is facebook.com/oldgolf which is wrong" put up
        // the address the owner called wrong): a link said to be old, closed or gone - or one called wrong after it is said - is the
        // model's; one said to be the right one ("it should be ...", "the new one is ...") is still read
        if (b || u) {
          const at = (u || b).index, before = s.slice(0, at).toLowerCase(), after = s.slice(at + (u || b)[0].length).toLowerCase();
          if (/\b(?:old|former|previous|used to|was|closed|deleted|shut down|got rid of|no longer|any ?more)\b/.test(before) && !/\b(?:should be|supposed to be|new|now|change|update|instead)\b/.test(before)) return null;
          if (/\b(?:wrong|incorrect|broken|old|outdated|dead|bad|not (?:right|working|ours)|doesn'?t work|isn'?t (?:right|working|ours)|not it)\b/.test(after)) return null;
        }
        const v = u ? u[1] : b ? b[1] : null; if (!v || (!u && /\.(?:com|net|org)$/i.test(v))) return null;
        if (!socialPlain(s, u || b)) return null;
        // TWO NETWORKS IN ONE REQUEST ARE BOTH SET, OR THE MODEL'S (Oct 27 2026, the review of round 2c: "use @bearcatgolf for instagram and
        // tiktok" and "we changed our insta and tiktok to @bearcatgolf" set Instagram alone, applied at once - the link has no yes - and
        // TikTok was dropped): one handle said for networks named together on one side of it ("instagram and tiktok", "insta & tiktok") is
        // each network's; an address names its own network, and two handles, or a handle between the networks ("our insta is @x and
        // tiktok too"), are the model's - never one set and the other dropped
        const nets = [...s.matchAll(/\b(insta(?:gram)?|ig|fb|face ?book|tik ?tok|you ?tube|yt|twitter)\b/gi)], keys = [...new Set(nets.map(x => socialKey(x[1])))];
        if (keys.length > 1) {
          const at = (u || b).index, handles = (s.match(/(?:^|\s)@[A-Za-z0-9._]{2,30}\b/g) || []).length + (s.match(/https?:\/\/|\b(?:www\.)?(?:instagram|facebook|fb|tiktok|youtube|x|twitter)\.com\//gi) || []).length;
          const side = nets.every(x => x.index < at) || nets.every(x => x.index > at);
          const joined = nets.slice(1).every((x, i) => /^(?:\s*(?:,|&|\/|\+|and|plus|n)\s*)+$/i.test(s.slice(nets[i].index + nets[i][0].length, x.index)));
          if (u || handles > 1 || !side || !joined || keys.some(k => !k)) return null;
          return Object.fromEntries(keys.map(k => [k, v]));
        }
        const k = socialKey(net[1]); return k ? { [k]: v } : null; },
      fill: (a) => { a = Object.assign({}, a); for (const k of ['facebook', 'instagram', 'tiktok', 'youtube', 'x']) if (a[k]) a[k] = socialUrl(k, a[k]); return a; },
      say: 'Set the facility\'s social links (they show in the footer and in a Social section): facebook, instagram, tiktok, youtube, x - each a full https:// address, or empty to take it off - and up to six other links with a name',
      params: { type: 'object', properties: Object.assign(Object.fromEntries(['facebook', 'instagram', 'tiktok', 'youtube', 'x'].map(k => [k, { type: 'string', maxLength: 300 }])),
        { other_links: { type: 'array', maxItems: 6, items: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 30 }, address: { type: 'string', minLength: 9, maxLength: 300 } }, required: ['name', 'address'] }, description: 'replaces the other links' } }) },
      build: (a) => {
        const set = [];
        for (const k of ['facebook', 'instagram', 'tiktok', 'youtube', 'x']) if (a[k] !== undefined) { if (a[k] && !/^https:\/\/[^\s<>"']+$/.test(a[k])) throw new ActionError(`the ${k} link must be a full address starting with https://`); set.push([k, a[k]]); }
        if (a.other_links) { for (const l of a.other_links) if (!/^https:\/\/[^\s<>"']+$/.test(l.address)) throw new ActionError(`"${l.name}" needs a full https:// address`); set.push(['more', a.other_links.map(l => ({ label: l.name, url: l.address }))]); }
        if (!set.length) throw new ActionError('say which links');
        return { op: 'content', key: 'social', set };
      },
      describe: (a) => 'Social links: ' + ['facebook', 'instagram', 'tiktok', 'youtube', 'x'].filter(k => a[k] !== undefined).map(k => a[k] ? `${k === 'x' ? 'X' : k[0].toUpperCase() + k.slice(1)} ${a[k]}` : `no ${k === 'x' ? 'X' : k}`).concat(a.other_links ? [`${a.other_links.length} other link${a.other_links.length === 1 ? '' : 's'}`] : []).join(', ') },
    { name: 'website_search_set', area: 'site', kind: 'write', confirm: false, say: 'Set what Google and shared links show: the title, the description (one or two sentences - the city and "golf simulator" said naturally) and the picture when a link is shared - for the whole site, or for one page (homepage, booking page, events, memberships, gift cards, how it works, holding page, or one of the owner\'s own pages by its title)',
      params: { type: 'object', properties: { page: { type: 'string', maxLength: 80, description: 'leave out for the whole site' }, title: { type: 'string', maxLength: 70 }, description: { type: 'string', maxLength: 300 }, share_photo: { type: 'string', maxLength: 200, description: 'a photo the owner added in the chat' } } },
      needs: ['website'],
      build: (a, ctx) => {
        if (a.title === undefined && a.description === undefined && a.share_photo === undefined) throw new ActionError('say the title, the description or the share picture');
        const img = a.share_photo === undefined ? undefined : (a.share_photo ? photoPath(a.share_photo) : '');
        const pg = String(a.page || '').trim().toLowerCase();
        if (!pg || PAGE_KEY[pg] === null) return { op: 'content', key: 'settings', set: [['siteTitle', a.title], ['metaDescription', a.description], ['shareImage', img]].filter(([, v]) => v !== undefined) };
        if (PAGE_KEY[pg]) { const k = PAGE_KEY[pg]; return { op: 'content', key: 'settings', set: [[`pageMeta.${k}.title`, a.title], [`pageMeta.${k}.description`, a.description], [`pageMeta.${k}.image`, img]].filter(([, v]) => v !== undefined) }; }
        const p = findPage(ctx, a.page);
        return { op: 'content', key: 'pages', match: ['slug', p.slug], set: [['metaTitle', a.title], ['metaDescription', a.description], ['shareImage', img]].filter(([, v]) => v !== undefined) };
      },
      describe: (a) => `What search and shared links show for ${a.page ? 'the ' + a.page + ' page' : 'the whole site'}: ` + [a.title !== undefined && `title "${a.title}"`, a.description !== undefined && `description "${clip(a.description, 80)}"`, a.share_photo !== undefined && (a.share_photo ? 'the shared picture set' : 'the standard shared picture')].filter(Boolean).join(', ') },

    // ── the menu ──
    // ("put the gift cards on the site", "add events to the menu" - the built-in page shown in the top menu: the box's own reading)
    { name: 'website_menu_set', area: 'site', kind: 'write', confirm: false,
      read: (words) => { const s = String(words || '').toLowerCase();
        if (/\?/.test(s) || s.split(/\s+/).length > 14) return null;
        const m = /\b(?:put|add|show|link|stick)\b[^.?!]{0,15}?\b(gift ?cards?|events|memberships|leagues|how it works)\b[^.?!]{0,25}\b(?:on|to|in(?:to)?) (?:the |our |my )?(?:web ?site|site|menu|home ?page|top menu|top)\b/.exec(s);
        if (!m) return null; const item = /gift/.test(m[1]) ? 'gift cards' : m[1];
        // (two pages named - "put events and leagues on the website", "... and leagues too" - are two changes: this reading put up the
        // first and dropped the second, applied at once - the model has them whole; the review, Oct 27 2026)
        if (new Set((s.match(/\b(?:gift ?cards?|events|memberships|leagues|how it works)\b/g) || []).map(x => x.replace(/^gift.*/, 'gift'))).size > 1) return null;
        return { item, top_menu: true }; }, say: 'Change the site\'s menu: show a built-in page (events, memberships, gift cards, how it works, leagues) or one of the owner\'s pages in the top menu and/or the footer, rename one, add a link of the owner\'s own (its words and an address), or take one of the owner\'s own links out',
      params: { type: 'object', properties: { item: { type: 'string', minLength: 1, maxLength: 60, description: 'the built-in page, the owner\'s page title, or the words of a link' },
        address: { type: 'string', maxLength: 300, description: 'for a new link of the owner\'s own: /a-page or https://...' }, top_menu: { type: 'boolean' }, footer: { type: 'boolean' },
        rename_to: { type: 'string', maxLength: 40 }, remove: { type: 'boolean', description: 'take one of the owner\'s own links out' } }, required: ['item'] },
      needs: ['website'],
      build: (a, ctx) => {
        const n = a.item.trim().toLowerCase();
        if (NAV_KEY[n]) {
          if (a.remove) throw new ActionError(`the ${a.item} page is built in - it can be left out of the top menu and the footer, not taken out`);
          const set = {}; if (a.top_menu !== undefined) set.top = a.top_menu; if (a.footer !== undefined) set.foot = a.footer; if (a.rename_to !== undefined) set.label = a.rename_to;
          if (!Object.keys(set).length) throw new ActionError('say top menu, footer or the new name');
          return { op: 'nav', key: NAV_KEY[n], set };
        }
        const pg = pagesOf(ctx).find(p => String(p.title || '').toLowerCase() === n || p.slug.toLowerCase() === n);
        if (pg) {
          if (a.remove) throw new ActionError(`"${pg.title}" is one of your pages - leave it out of the menu and the footer, or take the page itself off with website_page_remove`);
          const set = [['showInNav', a.top_menu], ['showInFooter', a.footer], ['title', a.rename_to]].filter(([, v]) => v !== undefined);
          if (!set.length) throw new ActionError('say top menu, footer or the new name');
          return { op: 'content', key: 'pages', match: ['slug', pg.slug], set };
        }
        const items = ((ctx.website || {}).nav || {}).items || [];
        const mine = items.find(x => x && String(x.key || '').startsWith('link:') && String(x.label || '').toLowerCase() === n);
        if (a.remove) { if (!mine) throw new ActionError(`no link of your own called "${a.item}" is in the menu`); return { op: 'nav', key: mine.key, remove: true }; }
        if (mine) { const set = {}; if (a.top_menu !== undefined) set.top = a.top_menu; if (a.footer !== undefined) set.foot = a.footer; if (a.rename_to) set.label = a.rename_to; if (a.address) set.href = okLink(a.address, 'the link'); return { op: 'nav', key: mine.key, set }; }
        if (!a.address) throw new ActionError(`"${a.item}" is not in the menu yet - give its address to add it`);
        if (!/^(\/(?!\/)[^\s<>"']*|https?:\/\/[^\s<>"']+)$/.test(a.address.trim())) throw new ActionError(`"${a.address}" is not an address (/a-page or https://...)`);
        return { op: 'nav', key: 'link:' + L.uid(), set: { label: a.item.trim().slice(0, 40), href: a.address.trim(), top: a.top_menu !== false, foot: a.footer !== false } };
      },
      describe: (a) => a.remove ? `Take "${a.item}" out of the menu` : `The menu: "${a.rename_to || a.item}"${a.address ? ` going to ${a.address}` : ''}` + [a.top_menu !== undefined && (a.top_menu ? ', in the top menu' : ', not in the top menu'), a.footer !== undefined && (a.footer ? ', in the footer' : ', not in the footer')].filter(Boolean).join('') + '. A link to a part of the site that is not public yet hides itself.' },

    // ── the owner's own pages ──
    { name: 'website_page_edit', area: 'pages', kind: 'write', confirm: false, say: 'Change one of the owner\'s own pages (made with website_page_create): its title, its words, published or a draft, in the top menu or the footer',
      params: { type: 'object', properties: { page: { type: 'string', minLength: 1, maxLength: 80, description: 'its title or address' }, title: { type: 'string', minLength: 2, maxLength: 60 }, words: { type: 'string', minLength: 1, maxLength: 20000 },
        publish: { type: 'boolean' }, top_menu: { type: 'boolean' }, footer: { type: 'boolean' } }, required: ['page'] },
      needs: ['website'],
      build: (a, ctx) => {
        const p = findPage(ctx, a.page);
        const set = [['title', a.title], ['body', a.words], ['published', a.publish], ['showInNav', a.top_menu], ['showInFooter', a.footer]].filter(([, v]) => v !== undefined);
        if (!set.length) throw new ActionError(`say what to change on "${p.title}"`);
        return { op: 'content', key: 'pages', match: ['slug', p.slug], set };
      },
      describe: (a, ctx) => { const p = findPage(ctx, a.page); return `The page "${p.title}" (/p/${p.slug}): ` + [a.title && `title "${a.title}"`, a.words && 'new words', a.publish !== undefined && (a.publish ? 'published' : 'back to a draft'), a.top_menu !== undefined && (a.top_menu ? 'in the top menu' : 'not in the top menu'), a.footer !== undefined && (a.footer ? 'in the footer' : 'not in the footer')].filter(Boolean).join(', '); } },
    { name: 'website_page_remove', area: 'pages', kind: 'write', confirm: true, say: 'Take one of the owner\'s own pages off the site, words and all',
      params: { type: 'object', properties: { page: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['page'] },
      needs: ['website'],
      build: (a, ctx) => ({ op: 'content', key: 'pages', match: ['slug', findPage(ctx, a.page).slug], remove: true }),
      describe: (a, ctx) => { const p = findPage(ctx, a.page), n = L.pageLayout(p).length; return `Take the page "${p.title}" (/p/${p.slug}) off the site, ${n ? `its ${n} section${n === 1 ? '' : 's'} with it (a section can move to the homepage first instead - website_section_to_page)` : 'words and all'} - links to it hide themselves (Undo, or Previous versions on the Pages card, puts it back)`; } },

    // ── the site as a whole ──
    { name: 'website_homepage_set', area: 'site', kind: 'write', confirm: true, say: 'Decide what visitors see at the facility\'s address: this website as the homepage (the booking page moves to /book - every QR code and link keeps working), or the booking page as the homepage; or switch the website off altogether',
      params: { type: 'object', properties: { homepage: { type: 'string', enum: ['website', 'booking'] }, website_on: { type: 'boolean' } } },
      build: (a) => {
        const set = [];
        if (a.homepage) set.push(['homepage', a.homepage === 'website' ? 'landing' : 'booking']);
        if (a.website_on !== undefined) set.push(['siteEnabled', a.website_on]);
        if (!set.length) throw new ActionError('say which homepage, or whether the website is on');
        if (a.homepage === 'website' && a.website_on === false) throw new ActionError('the website cannot be the homepage while it is switched off');
        return { op: 'content', key: 'settings', set };
      },
      describe: (a) => [a.website_on === false && 'Switch the website off: visitors get the booking page, and the website\'s pages go to booking', a.website_on === true && 'Switch the website on', a.homepage === 'website' && 'Make this website your homepage - the booking page moves to /book, and every QR code and link keeps working', a.homepage === 'booking' && 'Make the booking page your homepage again - this website stays at /landing'].filter(Boolean).join('; ') },
    { name: 'website_holding_set', area: 'site', kind: 'write', confirm: false, say: 'Set the words of the holding page - what a visitor sees on a part of the site that is not public yet - the coming-soon page a visitor sees on a part that is not public yet ("coming soon", "opening November 15"); never a new page',
      params: { type: 'object', properties: { headline: { type: 'string', maxLength: 120 }, words: { type: 'string', maxLength: 1000 } } },
      build: (a) => { const set = [['holding.headline', a.headline], ['holding.text', a.words]].filter(([, v]) => v !== undefined); if (!set.length) throw new ActionError('say the headline or the words'); return { op: 'content', key: 'settings', set }; },
      describe: (a) => 'The holding page: ' + [a.headline !== undefined && `"${a.headline}"`, a.words !== undefined && `"${clip(a.words, 80)}"`].filter(Boolean).join(' - ') },
    { name: 'email_updates_set', area: 'site', kind: 'write', confirm: (a) => a.on === false, confirmSay: ' (switching it off is shown to the owner to approve first)', say: 'Switch email updates on or off (the sign-up box on the site and the /updates page - people who sign up get the newsletters), and set its words: title, a line, the button; and whether the holding page offers it too - the sign-up for our emails, everywhere it shows, is this - not a new section',
      params: { type: 'object', properties: { on: { type: 'boolean' }, title: { type: 'string', maxLength: 80 }, words: { type: 'string', maxLength: 300 }, button: { type: 'string', maxLength: 30 }, on_holding_page: { type: 'boolean' } } },
      build: (a) => { const set = [['signup.enabled', a.on], ['signup.title', a.title], ['signup.text', a.words], ['signup.button', a.button], ['signup.onHolding', a.on_holding_page]].filter(([, v]) => v !== undefined); if (!set.length) throw new ActionError('say on or off, or the words'); return { op: 'content', key: 'settings', set }; },
      describe: (a) => 'Email updates: ' + [a.on !== undefined && (a.on ? 'on - the sign-up box shows, and /updates is public' : 'off - the sign-up box hides'), a.title && `title "${a.title}"`, a.words && `"${clip(a.words, 60)}"`, a.button && `button "${a.button}"`, a.on_holding_page !== undefined && (a.on_holding_page ? 'offered on the holding page' : 'not on the holding page')].filter(Boolean).join(', ') },

    // visitor counting (the Site-wide card): the ids are not secrets - they ride in every visitor's page
    { name: 'website_analytics_set', area: 'site', kind: 'write', confirm: false, say: 'Count the site\'s visitors with Google Analytics (an id like G-XXXXXXXXXX) and/or the Meta pixel (8 to 20 digits) - or stop (an empty id). The site tells visitors it counts visits; it never reads bookings or payments',
      params: { type: 'object', properties: { google_analytics: { type: 'string', maxLength: 20 }, meta_pixel: { type: 'string', maxLength: 20 } } },
      build: (a) => {
        if (a.google_analytics === undefined && a.meta_pixel === undefined) throw new ActionError('say the Google Analytics id or the Meta pixel id');
        if (a.google_analytics && !/^G-[A-Z0-9]{4,16}$/i.test(a.google_analytics)) throw new ActionError('a Google Analytics id looks like G-XXXXXXXXXX');
        if (a.meta_pixel && !/^\d{8,20}$/.test(a.meta_pixel)) throw new ActionError('a Meta pixel id is 8 to 20 digits');
        return { op: 'content', key: 'settings', set: [['analytics.ga4', a.google_analytics !== undefined ? a.google_analytics.toUpperCase() : undefined], ['analytics.metaPixel', a.meta_pixel]].filter(([, v]) => v !== undefined) };
      },
      describe: (a) => 'Visitor counting: ' + [a.google_analytics !== undefined && (a.google_analytics ? `Google Analytics ${a.google_analytics.toUpperCase()}` : 'no Google Analytics'), a.meta_pixel !== undefined && (a.meta_pixel ? `the Meta pixel ${a.meta_pixel}` : 'no Meta pixel')].filter(Boolean).join(', ') + '. The site says it counts visits; it never reads bookings or payments.' },
    // the words of two built-in sections (their own cards: Memberships, Staffed Days)
    { name: 'website_words_set', kind: 'write', confirm: false, say: 'Change the words of a built-in homepage section: the memberships section (its small line, title and a line under it) or the staffed days section (its title, the line about staffed days, and the line about self-service hours)',
      params: { type: 'object', properties: { part: { type: 'string', enum: ['memberships', 'staffed days'] }, small_line: { type: 'string', maxLength: 80 }, title: { type: 'string', maxLength: 120 },
        words: { type: 'string', maxLength: 1000, description: 'memberships: the line under the title; staffed days: the line about staffed days' }, self_service_words: { type: 'string', maxLength: 1000, description: 'staffed days only: the line about self-service hours' } }, required: ['part'] },
      build: (a) => {
        const set = a.part === 'memberships'
          ? [['kicker', a.small_line], ['title', a.title], ['intro', a.words]]
          : [['title', a.title], ['p1', a.words], ['selfText', a.self_service_words]];
        if (a.part === 'memberships' && a.self_service_words !== undefined) throw new ActionError('the self-service line belongs to the staffed days section');
        if (a.part === 'staffed days' && a.small_line !== undefined) throw new ActionError('the staffed days section has no small line');
        const out = set.filter(([, v]) => v !== undefined);
        if (!out.length) throw new ActionError('say which words to change');
        return { op: 'content', key: a.part === 'memberships' ? 'memberships' : 'staffed', set: out };
      },
      describe: (a) => `The ${a.part} section's words: ` + [a.small_line !== undefined && `small line "${a.small_line}"`, a.title !== undefined && `title "${a.title}"`, a.words !== undefined && `"${clip(a.words, 70)}"`, a.self_service_words !== undefined && `self-service: "${clip(a.self_service_words, 60)}"`].filter(Boolean).join(', ') },

    // ── versions: every save of a part keeps what it replaced (the editor's Previous versions) ──
    { name: 'website_history_read', kind: 'read', say: 'See the earlier versions kept of one part of the website (each save keeps the one it replaced; the newest thirty)',
      params: { type: 'object', properties: { part: { type: 'string', enum: Object.keys(PART) } }, required: ['part'] },
      request: (a) => ({ method: 'GET', path: '/api/website/history?key=' + PART[a.part] }),
      digest: (j) => ({ versions: (j.versions || []).slice(0, 10).map(v => ({ saved: v.savedAt, was: v.summary, note: v.note || undefined })) }) },
    { name: 'website_undo', kind: 'write', confirm: false, say: 'Undo the last change to one part of the website (the version saved before it comes back; undo again to redo)',
      params: { type: 'object', properties: { part: { type: 'string', enum: Object.keys(PART) } }, required: ['part'] },
      build: (a) => ({ op: 'undo', key: PART[a.part] }),
      describe: (a) => `Undo the last change to ${a.part === 'sections' ? 'the homepage\'s sections' : 'the ' + a.part}` },

    // ── events (their own page, /events, and the homepage's next-event section) ──
    { name: 'events_read', area: 'events', kind: 'read', say: 'Look at the website\'s events: the upcoming ones with their dates, and how many are past',
      params: { type: 'object', properties: {} },
      request: () => ({ method: 'GET', path: '/api/website/events/all' }),
      digest: (j, ctx) => { const evs = j.events || []; const up = evs.filter(e => e.event_date >= ctx.today).sort((x, y) => x.event_date < y.event_date ? -1 : 1); return { upcoming: up.map(e => ({ event: e.title, date: e.event_date, when: dayWords(e.event_date), words: clip(e.description, 60) || undefined, flyer: e.flyer ? 'yes' : undefined, link: e.link || undefined })), past: evs.length - up.length }; } },
    // (EVENT_EDIT MEETS EVENT_ADD'S TWO RULES - Oct 28 2026, round 2e; the critic of round 2d: an edit goes on the public Events page at once,
    // like a new event, and "change the fall classic to start at 8" with the model's "Starts at 8:00 PM" went up at a place open from 7 AM,
    // "the fall classic now starts at 9" as 9 AM at a place that opens at 10, "rename the fall classic to mikes 40th bash" at once. A new
    // time in its words is read by the bare-hour rule as event_add's is (actions.js eventWhen, the facility's hours for the event's day);
    // a new title by the same test of whose it is (engine.js privateEvent); and the card says the new words, not only that there are some)
    { name: 'event_edit', area: 'events', kind: 'write', confirm: false, say: 'Change an event on the website: its title, date, words, flyer photo or link (read the events first) - never add a second event for it (event_add is for a new one). The Events page is PUBLIC: a new title that makes it one person\'s, a family\'s, a company\'s or a client\'s own occasion is a private booking, never an event - ask the owner when you cannot tell. A new start time goes in its words as the owner said it (with am or pm)',
      params: { type: 'object', properties: { event: { type: 'string', minLength: 1, maxLength: 120, description: 'its title (and date if two share a title)' }, title: { type: 'string', minLength: 2, maxLength: 120 }, date: DATE,
        words: { type: 'string', maxLength: 2000 }, flyer: { type: 'string', maxLength: 200, description: 'a photo the owner added in the chat' }, link: { type: 'string', maxLength: 300 } }, required: ['event'] },
      needs: ['events', 'hours'],
      fill: (a, ctx) => { let e = null; try { e = findEvent(ctx, a.event); } catch { e = null; }
        return require('../actions').BY_NAME.get('event_add').when(a, ctx, { key: 'words', title: a.title || (e && e.title) || a.event, date: a.date || (e && e.event_date) }); },
      build: (a, ctx) => {
        const e = findEvent(ctx, a.event);
        const set = {}; if (a.title !== undefined) set.title = a.title; if (a.date !== undefined) set.event_date = a.date; if (a.words !== undefined) set.description = a.words;
        if (a.flyer !== undefined) set.flyer = a.flyer ? photoPath(a.flyer) : ''; if (a.link !== undefined) set.link = okLink(a.link, 'the event');
        if (!Object.keys(set).length) throw new ActionError(`say what to change on "${e.title}"`);
        return { op: 'merge', get: '/api/website/events/all', list: 'events', find: ['id', e.id], fields: ['title', 'event_date', 'description', 'flyer', 'link'], set, put: '/api/website/events/' + encodeURIComponent(e.id) };
      },
      describe: (a, ctx) => { const e = findEvent(ctx, a.event); return `The event "${e.title}" on ${dayWords(e.event_date)}: ` + [a.title && `now "${a.title}"`, a.date && `moved to ${dayWords(a.date)}`, a.words !== undefined && (a.words ? `new words "${clip(a.words, 80)}"` : 'no words'), a.flyer !== undefined && (a.flyer ? 'a new flyer' : 'no flyer'), a.link !== undefined && (a.link ? `the link ${a.link}` : 'no link')].filter(Boolean).join(', '); } },
    { name: 'event_remove', area: 'events', kind: 'write', confirm: true, say: 'Take an event off the website',
      params: { type: 'object', properties: { event: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['event'] },
      needs: ['events'],
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: '/api/website/events/' + encodeURIComponent(findEvent(ctx, a.event).id) }),
      describe: (a, ctx) => { const e = findEvent(ctx, a.event); return `Take "${e.title}" on ${dayWords(e.event_date)} off the website`; } },
    // ── THE OFFER SLIDES AND THE GALLERY, ONE AT A TIME (Oct 21 2026 - the gap audit's item 9; the Website editor's Offer Slides
    //    and Gallery cards). The slides are content.offers {enabled, slides:[{label, title, text, img, enabled}]} - the five
    //    built-in slides until the owner saves their own (landing.html and admin-website.html carry the same five; the page
    //    shows the first five shown ones); the gallery is content.gallery {items:[{img, caption}]}. A change is the whole list
    //    saved back, straight in (how things look), with Undo ──
    { name: 'website_slides_read', area: 'photos', kind: 'read', needs: ['website'],
      say: 'Look at the offer slides under the top of the homepage (each one\'s number, small label, title, words, whether it has a photo and whether it is shown) and the gallery\'s photos (each one\'s number and caption)',
      params: { type: 'object', properties: {} },
      local: (a, ctx) => {
        const o = offersOf(ctx);
        return { slides_section: o.enabled === false ? 'hidden' : 'shown', slides: o.slides.map((x, i) => ({ number: i + 1, label: x.label || '', title: x.title || '', words: x.text || '', photo: x.img ? 'yes' : 'no', shown: x.enabled !== false })),
          page_shows: 'the first five slides that are shown', built_in: !(ctx.website || {}).offers || undefined,
          gallery: galleryOf(ctx).map((g, i) => ({ number: i + 1, caption: g.caption || '(no caption)' })) };
      } },
    { name: 'website_slide_set', area: 'photos', kind: 'write', confirm: false, needs: ['website'],
      say: 'Add an offer slide or change one (by its number - website_slides_read): its small label, title, words, a photo the owner added in the chat, whether it is shown, or where it sits (move_to). The page shows the first five shown slides',
      params: { type: 'object', properties: {
        slide: { type: 'integer', minimum: 1, maximum: 20, description: 'the slide\'s number; leave out to add a new one' },
        label: { type: 'string', maxLength: 40 }, title: { type: 'string', maxLength: 80 }, words: { type: 'string', maxLength: 300 },
        photo: { type: 'string', maxLength: 200, description: 'a photo\'s address as the chat gave it' }, no_photo: { type: 'boolean', description: 'true takes the slide\'s photo off' },
        shown: { type: 'boolean' }, move_to: { type: 'integer', minimum: 1, maximum: 20, description: 'the place it moves to (1 = first)' } } },
      build: (a, ctx) => {
        const o = offersOf(ctx), list = o.slides.map(x => Object.assign({}, x));
        let i;
        if (a.slide == null) {
          if (!(a.title || a.label || a.words)) throw new ActionError('a new slide needs a title, a label or its words');
          list.push({ label: a.label || '', title: a.title || '', text: a.words || '', img: a.photo ? photoPath(a.photo) : '' }); i = list.length - 1;
        } else {
          i = a.slide - 1; if (!list[i]) throw new ActionError(`there is no slide ${a.slide} (there are ${list.length})`);
          const x = list[i];
          if (a.label !== undefined) x.label = a.label; if (a.title !== undefined) x.title = a.title; if (a.words !== undefined) x.text = a.words;
          if (a.photo !== undefined && a.no_photo) throw new ActionError('a new photo, or no photo - not both');
          if (a.photo !== undefined) x.img = photoPath(a.photo); else if (a.no_photo) x.img = '';
          if (!(String(x.title || '').trim() || String(x.label || '').trim() || String(x.text || '').trim())) throw new ActionError('a slide with no title, label or words is not shown - take it off instead');
        }
        if (a.shown !== undefined) list[i].enabled = a.shown;
        if (a.move_to != null) { const [it] = list.splice(i, 1); list.splice(Math.min(a.move_to - 1, list.length), 0, it); }
        return { op: 'content', key: 'offers', set: [['enabled', true], ['slides', list]], focus: 'offers' };
      },
      describe: (a, ctx) => {
        const o = offersOf(ctx), x = a.slide != null ? o.slides[a.slide - 1] || {} : {};
        const name = a.slide != null ? `slide ${a.slide} ("${x.title || x.label || 'untitled'}")` : 'a new offer slide';
        const what = [a.title !== undefined && `titled "${a.title}"`, a.label !== undefined && `labelled "${a.label}"`, a.words !== undefined && 'its words changed', a.photo !== undefined && 'with the new photo', a.no_photo && 'with no photo',
          a.shown !== undefined && (a.shown ? 'shown' : 'hidden'), a.move_to != null && `moved to place ${a.move_to}`].filter(Boolean);
        const shownCount = o.slides.filter(s => s.enabled !== false).length + (a.slide == null ? 1 : 0);
        return `${a.slide != null ? 'Change' : 'Add'} ${name}${what.length ? ': ' + what.join(', ') : ''}.${shownCount > 5 && a.shown !== false ? ' The homepage shows the first five shown slides.' : ''}`;
      } },
    { name: 'website_slide_remove', area: 'photos', kind: 'write', confirm: false, needs: ['website'],
      say: 'Take an offer slide off for good, by its number (to keep it but not show it, website_slide_set with shown false)',
      params: { type: 'object', properties: { slide: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['slide'] },
      build: (a, ctx) => {
        const list = offersOf(ctx).slides.slice();
        if (!list[a.slide - 1]) throw new ActionError(`there is no slide ${a.slide} (there are ${list.length})`);
        list.splice(a.slide - 1, 1);
        return { op: 'content', key: 'offers', set: [['slides', list]], focus: 'offers' };
      },
      describe: (a, ctx) => { const x = offersOf(ctx).slides[a.slide - 1] || {}; return `Take slide ${a.slide} ("${x.title || x.label || 'untitled'}") off the homepage's offer slides.`; } },
    { name: 'website_gallery_photo_set', area: 'photos', kind: 'write', confirm: false, needs: ['website'],
      say: 'Change one of the gallery\'s photos, by its number (website_slides_read): its caption (what a screen reader says), where it sits (move_to), or take it off (remove)',
      params: { type: 'object', properties: {
        photo: { type: 'integer', minimum: 1, maximum: 200, description: 'the photo\'s number in the gallery' },
        caption: { type: 'string', maxLength: 120 }, move_to: { type: 'integer', minimum: 1, maximum: 200 }, remove: { type: 'boolean' } }, required: ['photo'] },
      build: (a, ctx) => {
        const items = galleryOf(ctx).map(g => Object.assign({}, g)), i = a.photo - 1;
        if (!items[i]) throw new ActionError(`there is no photo ${a.photo} in the gallery (there are ${items.length})`);
        if (a.remove) { if (a.caption !== undefined || a.move_to != null) throw new ActionError('take it off, or change it - not both'); items.splice(i, 1); }
        else {
          if (a.caption === undefined && a.move_to == null) throw new ActionError('say the caption, where it moves to, or take it off');
          if (a.caption !== undefined) items[i].caption = a.caption;   // (an empty caption never arrives: check() drops ''; a caption is replaced, not emptied)
          if (a.move_to != null) { const [it] = items.splice(i, 1); items.splice(Math.min(a.move_to - 1, items.length), 0, it); }
        }
        return { op: 'content', key: 'gallery', set: [['items', items]], focus: 'gallery' };
      },
      describe: (a, ctx) => {
        const g = galleryOf(ctx)[a.photo - 1] || {}, name = `photo ${a.photo}${g.caption ? ' ("' + g.caption + '")' : ''}`;
        if (a.remove) return `Take ${name} out of the gallery.`;
        return `Gallery ${name}: ` + [a.caption !== undefined && `captioned "${a.caption}"`, a.move_to != null && `moved to place ${a.move_to}`].filter(Boolean).join(', ') + '.';
      } },
  ];
  return { actions, loaders: { events: async (ctx) => { try { const r = await ctx.call('GET', '/api/website/events/all'); return (r.json && r.json.events) || []; } catch { return []; } } } };
};
