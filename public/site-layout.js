// Copyright (c) 2025-2026 BA Custom Products LLC.
// site-layout.js - THE PAGE AS A LIST OF BLOCKS (Sep 5 2026, website builder wave B).
// One module for the landing page, the editor and the batteries (UMD like markup.js).
//
// website_content.layout = { blocks: [ { id, type, on?, ...fields } ] } in display
// order. Built-in blocks are placed here but keep their ON/OFF where it always
// lived (offers.enabled, steps.enabled, staffed.enabled, settings.galleryEnabled,
// settings.eventsEnabled, memberships.enabled, promo.enabled) - one truth, asked
// once. Custom blocks carry their own `on`. A unit with no layout saved renders
// exactly the page it rendered before this wave: defaultLayout() derives it,
// turning the old four "sections" into story blocks (rule 14: the sections key
// is still read, never dropped).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BASiteLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX_BLOCKS = 24;
  var BUILTIN = {
    offers:      { label: 'Offer slideshow',      desc: 'Five big slides that auto-advance (edited on the Offer Slides card).', flag: ['offers', 'enabled', true] },
    steps:       { label: 'How It Works strip',   desc: 'The numbered strip (edited on the How It Works card).', flag: ['steps', 'enabled', true] },
    staffed:     { label: 'Staffed days',         desc: 'The next two weeks of staffed hours (Staffed Days card).', flag: ['staffed', 'enabled', true] },
    gallery:     { label: 'Photo gallery',        desc: 'Swipe through your photos (Gallery card).', flag: ['settings', 'galleryEnabled', true] },
    event:       { label: 'Next event',           desc: 'Your next event, from the Events card. Hides itself when there is none.', flag: ['settings', 'eventsEnabled', true] },
    memberships: { label: 'Memberships',          desc: 'Live tier cards (Memberships card). Hides itself when no tier sells online.', flag: ['memberships', 'enabled', true] },
    promo:       { label: 'Promo band',           desc: 'A bold band with a discount code (Promo card).', flag: ['promo', 'enabled', false] },
    visit:       { label: 'Find us',              desc: 'Address, hours and map (Contact card).', flag: null },
    ctaEnd:      { label: 'Ready to play?',       desc: 'The closing band: its title, line and button are yours to edit (W44).', flag: null, fields: ['title', 'text', 'button', 'link'] }
  };
  var CUSTOM = {
    story:  { label: 'Photo + text',   desc: 'A photo beside a headline and paragraphs, with an optional highlight box and link.', make: function () { return { kicker: '', title: 'A headline', p1: 'Your words here.', p2: '', img: '', calloutTitle: '', calloutText: '', linkText: '', linkUrl: '' }; } },
    text:   { label: 'Text only',      desc: 'A headline and formatted text, nothing else.', make: function () { return { kicker: '', title: 'A headline', body: 'Your words here.' }; } },
    faq:    { label: 'FAQ',            desc: 'Questions and answers, tap to open.', make: function () { return { kicker: 'Good to know', title: 'Questions people ask', open: 'none', items: [{ q: 'Do I need my own clubs?', a: 'No - every bay has a set. Bring yours if you like.' }] }; } },
    rates:  { label: 'Rates',          desc: 'Your booking rates, live from Admin > Pricing, with a note under the table.', make: function () { return { kicker: 'Rates', title: 'What it costs', note: 'Per bay, up to six players.' }; } },
    quotes: { label: 'Testimonials',   desc: 'Short quotes with a name.', make: function () { return { kicker: 'Players', title: 'What players say', items: [{ text: 'A kind word.', who: 'A player' }] }; } },
    video:  { label: 'Video',          desc: 'A short clip, compressed on the device like the hero video, muted loop.', make: function () { return { kicker: '', title: 'A look inside', video: '', poster: '' }; } },
    cta:    { label: 'Call-to-action', desc: 'A bold band with one button.', make: function () { return { title: 'Ready when you are', text: '', button: 'Book a Bay', link: '/book' }; } },
    form:   { label: 'Inquiry form',   desc: 'Parties, leagues, lessons - lands in your inbox and is emailed to you. Rate-limited, spam-trapped.', make: function () { return { kicker: 'Get in touch', title: 'Ask about a party or a league', intro: '', fields: ['name', 'email', 'phone', 'date', 'people', 'message'], thanks: 'Thanks - we will get back to you shortly.' }; } },
    social: { label: 'Social row',     desc: 'Your profiles as big buttons (links from the Contact card).', make: function () { return { kicker: 'Follow along', title: 'Find us online' }; } },
    signup: { label: 'Email updates signup', desc: 'An email box that lands on YOUR unit (Email Updates card). Draws nothing while Email Updates is off.', make: function () { return { kicker: 'Stay in the loop', title: '', text: '', button: '' }; } },
    // (Oct 20 2026; maintainer: "specials, weekly specials that show on the landing page ... full control of that kind
    // of stuff"), and what facility sites carry that the page could not: a menu, and cards for coaches, packages, the sims
    specials: { label: 'Weekly specials', desc: 'Your specials by day of the week - today\'s is marked, or only today\'s shows. Hides itself on a day with none to show.', make: function () { return { kicker: 'This week', title: 'Weekly specials', show: 'all', items: [{ days: 'tue', title: 'Two for Tuesday', text: 'Book an hour, get the next half hour free.', price: '', time: '', img: '' }] }; } },
    // source 'counter' (Oct 20 2026, night): the counter's own menu, live - its categories are the sub-menus, its prices the
    // servers' prices, sold-out items left off; hideGroups keeps a category off the website (a new one shows by itself).
    // 'typed' (and a section saved before): the items typed here
    menu:     { label: 'Food & drink menu', desc: 'What you serve, with prices - your counter\'s menu shown live (one menu for the site and the servers), or items typed here.', make: function () { return { kicker: 'Food & drink', title: 'On the menu', note: '', source: 'typed', hideGroups: [], display: 'list', items: [{ name: 'Wings', text: 'Ten pieces, any sauce', price: '$12' }] }; } },
    banner:   { label: 'Photo band', desc: 'A full-width photo with a headline, a line and one button over it - a league night, a party, the bays.', make: function () { return { kicker: '', title: 'A headline', text: '', button: 'Book a Bay', link: '/book', img: '' }; } },
    cards:    { label: 'Cards', desc: 'A row of cards, each with a photo, a few words, a price and a link - coaches, lessons, packages, the simulators.', make: function () { return { kicker: '', title: 'A headline', items: [{ title: 'A card', text: 'A line about it.', price: '', img: '', linkText: '', link: '' }], source: 'typed' }; } }
  };
  // the items a list section holds: each field's longest, which one must be there, and how many items at most
  var ITEM_SHAPES = {
    faq:      { max: 30, need: 'q', fields: { q: 200, a: 2000 }, word: 'question' },
    quotes:   { max: 20, need: 'text', fields: { text: 500, who: 80 }, word: 'quote' },
    // date (Oct 20 2026, night): one day only ("tonight") - its days are not read then; also: where else it shows on its day -
    // top (the top of the homepage, in place of its photo and words), slides (the slides under the top), booking (the
    // booking page) - maintainer: "allow the owner to put where the specials are shown"
    // flyer (Oct 20 2026, late): the special's designed card (public/flyer.js) - in the slides and at the top of its email
    specials: { max: 14, need: 'title', fields: { days: 40, title: 80, text: 300, price: 30, time: 40, img: 'photo', date: 10, also: 40, flyer: 'photo' }, word: 'special' },
    menu:     { max: 60, need: 'name', fields: { name: 80, text: 300, price: 30 }, word: 'menu item' },
    cards:    { max: 12, need: 'title', fields: { title: 80, text: 600, price: 30, img: 'photo', linkText: 40, link: 'link' }, word: 'card' }
  };
  // a special's days, as the owner says them: every day, weekdays, weekends, or days of the week ("tue", "Tuesday, Thursday")
  var DAY3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];   // the order days are kept and said in
  var DAY_TOKEN = /^(sun(day)?|mon(day)?|tue(s(day)?)?|wed(s|nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?)s?$/;
  var FILLER = ['every', 'each', 'on', 'the', 'all', 'day', 'days', 'night', 'nights', 'week', 'long', 'daily', 'everyday'];
  function specialDays(v) {
    var w = String(v == null ? '' : v).toLowerCase().replace(/\s*(\bto\b|\bthrough\b|\bthru\b|\btill\b|\buntil\b|–|—)\s*/g, '-').replace(/\s*-\s*/g, '-')
      .replace(/&|\band\b|\bor\b/g, ',').split(/[\s,\/]+/).filter(Boolean);
    var set = {};
    for (var i = 0; i < w.length; i++) {
      var x = w[i];
      var rg = x.split('-');
      if (rg.length === 2 && DAY_TOKEN.test(rg[0]) && DAY_TOKEN.test(rg[1])) {   // a run of days: mon-fri, thursday to sunday
        var a = WEEK.indexOf(rg[0].slice(0, 3)), b = WEEK.indexOf(rg[1].slice(0, 3));
        for (var k = a; ; k = (k + 1) % 7) { set[WEEK[k]] = 1; if (k === b) break; }
        continue;
      }
      if (x === 'weekdays' || x === 'weekday') { WEEK.slice(0, 5).forEach(function (d) { set[d] = 1; }); continue; }
      if (x === 'weekends' || x === 'weekend') { set.sat = set.sun = 1; continue; }
      if (DAY_TOKEN.test(x)) { set[x.slice(0, 3)] = 1; continue; }
      if (FILLER.indexOf(x) >= 0) continue;
      return null;
    }
    var list = WEEK.filter(function (d) { return set[d]; });
    if (!list.length || list.length === 7) return 'every';   // "every day", "daily", "all week" - or nothing said
    if (list.join(',') === 'mon,tue,wed,thu,fri') return 'weekdays';
    if (list.join(',') === 'sat,sun') return 'weekends';
    return list.join(',');
  }
  // where else a special shows on its day, beside its section
  var ALSO = ['top', 'slides', 'booking'];
  /** Is this special on today (its date, or its days of the week)? today: the facility's own YYYY-MM-DD */
  function specialOn(x, today) {
    if (!x || !x.title) return false;
    if (x.date) return x.date === today;
    var dow = new Date(String(today) + 'T12:00:00Z').getUTCDay();
    return dayMatch(x.days, dow);
  }
  /** Today's specials across the homepage's specials sections (a hidden one included - its specials can still lead the top
   *  or a slide), each with where else it shows: [{ title, text, price, time, img, date, also: ['top', ...] }] */
  function todaysSpecials(content, today) {
    var out = [];
    // the homepage's specials sections and those on the owner's published pages (Oct 20 2026, late: a specials section given a
    // page of its own still puts a special at the top of the homepage, in the slides or on the booking page)
    var lists = [defaultLayout(content || {})];
    ((content && content.pages) || []).forEach(function (p) { if (p && p.published) lists.push(pageLayout(p)); });
    lists.forEach(function (list) {
      list.forEach(function (b) {
        if (b.type !== 'specials') return;
        (b.items || []).forEach(function (x) { if (specialOn(x, today)) out.push({ title: x.title, text: x.text || '', price: x.price || '', time: x.time || '', img: x.img || '', flyer: x.flyer || '', date: x.date || '', also: String(x.also || '').split(',').filter(Boolean) }); });
      });
    });
    return out;
  }
  /** Is a special on this day (0 = Sunday)? */
  function dayMatch(days, dow) {
    var d = specialDays(days); if (!d) return false;
    if (d === 'every') return true;
    if (d === 'weekdays') return dow >= 1 && dow <= 5;
    if (d === 'weekends') return dow === 0 || dow === 6;
    return d.split(',').indexOf(DAY3[dow]) >= 0;   // dow 0 = Sunday, as Date.getDay() counts
  }
  var DAY_WORDS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
  function daysWords(days) {
    var d = specialDays(days); if (!d || d === 'every') return 'Every day';
    if (d === 'weekdays') return 'Weekdays'; if (d === 'weekends') return 'Weekends';
    var list = d.split(','); if (list.length === 1) return DAY_WORDS[list[0]] + 's';
    var at = list.map(function (x) { return WEEK.indexOf(x); });
    if (list.length >= 3 && at.every(function (n, i) { return i === 0 || n === at[i - 1] + 1; })) return DAY_WORDS[list[0]] + ' to ' + DAY_WORDS[list[list.length - 1]];
    return list.map(function (x) { return DAY_WORDS[x].slice(0, 3); }).join(', ');
  }
  var FORM_FIELDS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['date', 'Date you have in mind'], ['people', 'How many people'], ['message', 'Tell us more']];
  var DEFAULT_ORDER = ['offers', 'STORIES', 'steps', 'staffed', 'gallery', 'event', 'memberships', 'promo', 'visit', 'ctaEnd'];

  function uid() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /** The layout to render: the saved one (normalised) or the page as it always was. */
  function defaultLayout(content) {
    content = content || {};
    var saved = content.layout && Array.isArray(content.layout.blocks) ? content.layout.blocks : null;
    var out = [], seen = {};
    if (saved) {
      saved.forEach(function (b) {
        if (!b || typeof b.type !== 'string') return;
        if (BUILTIN[b.type]) { if (seen[b.type]) return; seen[b.type] = 1; var nb = { id: b.id || b.type, type: b.type, on: b.type === 'ctaEnd' || b.type === 'visit' ? b.on !== false : undefined }; (BUILTIN[b.type].fields || []).forEach(function (k) { if (typeof b[k] === 'string') nb[k] = b[k]; }); out.push(nb); }
        else if (CUSTOM[b.type]) { var c = {}; for (var k in b) c[k] = b[k]; c.id = c.id || uid(); c.on = c.on !== false; out.push(c); }
      });
      // a built-in that was never placed appends where it always sat
      Object.keys(BUILTIN).forEach(function (t) { if (!seen[t]) out.push({ id: t, type: t, on: true }); });
    } else {
      var items = (content.sections && Array.isArray(content.sections.items)) ? content.sections.items : [];
      DEFAULT_ORDER.forEach(function (t) {
        if (t === 'STORIES') {
          items.forEach(function (it, i) { if (!it || (!it.title && !it.p1 && !it.img && !it.enabled)) return; var s = CUSTOM.story.make(); for (var k in s) if (it[k] !== undefined) s[k] = it[k]; s.id = 'story' + (i + 1); s.type = 'story'; s.on = !!it.enabled; out.push(s); });
        } else out.push({ id: t, type: t, on: true });
      });
    }
    return out.slice(0, MAX_BLOCKS);
  }

  /** Is this block shown? Built-ins read the flag that always held it. */
  // ── WHAT'S PUBLIC (W44) - the client's copy of services/sitenav's map: which
  // of our own addresses is public. One list here, one on the server; the
  // battery holds them in lockstep. Absent = public, leagues absent = not.
  var SURFACE_PATHS = { '/book': 'booking', '/my-booking': 'booking', '/memberships': 'memberships', '/my-membership': 'portal', '/events': 'events', '/gift-cards': 'giftCards', '/leagues': 'leagues', '/updates': 'updates' };
  function publicMap(settings) {
    var p = (settings && settings.public && typeof settings.public === 'object') ? settings.public : {};
    var out = { pages: {} };
    ['booking', 'memberships', 'portal', 'events', 'giftCards', 'leagues'].forEach(function (k) { out[k] = typeof p[k] === 'boolean' ? p[k] : k !== 'leagues'; });
    out.updates = !!(settings && settings.signup && settings.signup.enabled === true);   // W45: on only while the Email Updates card is on
    if (p.pages && typeof p.pages === 'object') Object.keys(p.pages).forEach(function (slug) { out.pages[String(slug).toLowerCase()] = p.pages[slug] !== false; });
    return out;
  }
  function hrefPublic(map, href) {
    var h = String(href || '').split('#')[0].split('?')[0].toLowerCase();
    if (!h || h.charAt(0) !== '/') return true;
    var m = h.match(/^\/p\/([a-z0-9-]+)/); if (m) return map.pages[m[1]] !== false;
    var base = h.replace(/\/+$/, '') || '/';
    var key = null; Object.keys(SURFACE_PATHS).forEach(function (pth) { if (base === pth || base.indexOf(pth + '/') === 0) key = SURFACE_PATHS[pth]; });
    return key ? map[key] !== false : true;
  }
  var SURFACE_OF_BLOCK = { memberships: 'memberships', event: 'events' };
  // the landing page's section ids -> the block that draws them (custom blocks: blk-<id>)
  var SECTION_IDS = { offers: 'offers', steps: 'steps', staffed: 'staffed', gallery: 'gallery', eventsTeaser: 'event', membershipsSec: 'memberships', promo: 'promo', visit: 'visit', finalCta: 'ctaEnd' };
  /** Is the homepage section with this id placed and on? (a block that hides itself for lack of content still counts as on here - the page checks the drawn element) */
  function sectionOn(content, id) {
    var blocks = defaultLayout(content || {});
    var type = SECTION_IDS[id];
    var b = type ? blocks.filter(function (x) { return x.type === type; })[0] : blocks.filter(function (x) { return 'blk-' + x.id === id; })[0];
    return !!b && isOn(b, content || {});
  }
  /** Same rule as services/sitenav.linkAlive: external ok; /p/<slug> needs a published, public page; a section anchor needs its block on; a gated surface is dead. */
  function linkAlive(content, map, href) {
    var h = String(href || '').trim();
    if (!h) return false;
    if (/^https?:\/\//.test(h)) return true;
    if (h.charAt(0) !== '/' && h.charAt(0) !== '#') return false;
    var parts = h.split('#'), pathPart = parts[0], frag = parts.length > 1 ? parts[1] : undefined;
    if (pathPart && !hrefPublic(map, pathPart)) return false;
    var pm = pathPart.match(/^\/p\/([a-z0-9-]+)\/?$/i);
    if (pm) {
      var pages = (content && content.pages) || [];
      var found = false; pages.forEach(function (x) { if (x && x.published && String(x.slug || '').toLowerCase() === pm[1].toLowerCase()) found = true; });
      if (!found) return false;
    }
    if (frag !== undefined) {
      if (!frag) return false;
      if ((pathPart === '' || pathPart === '/' || pathPart === '/landing') && (SECTION_IDS[frag] || /^blk-/.test(frag))) return sectionOn(content, frag);
    }
    return true;
  }
  function isOn(block, content) {
    content = content || {};
    var b = BUILTIN[block.type];
    if (!b) return block.on !== false;
    if (SURFACE_OF_BLOCK[block.type] && !publicMap(content.settings)[SURFACE_OF_BLOCK[block.type]]) return false;   // not yet public: the section hides itself
    if (!b.flag) return block.on !== false;
    var o = content[b.flag[0]];
    var v = o && o[b.flag[1]];
    return typeof v === 'boolean' ? v : b.flag[2];
  }
  /** Turn a block on/off - for a built-in this writes the flag into content and returns the key touched (the caller saves it). */
  function setOn(block, content, on) {
    var b = BUILTIN[block.type];
    if (!b || !b.flag) { block.on = !!on; return null; }
    content[b.flag[0]] = content[b.flag[0]] || {};
    content[b.flag[0]][b.flag[1]] = !!on;
    return b.flag[0];
  }
  function label(block) { if (BUILTIN[block.type]) return BUILTIN[block.type].label; if (CUSTOM[block.type]) return block.title || CUSTOM[block.type].label; return block.type; }
  function newBlock(type) { var m = CUSTOM[type]; if (!m) return null; var b = m.make(); b.id = uid(); b.type = type; b.on = true; return b; }
  /** What gets stored: built-ins as position only (+on for the flagless two), customs whole. */
  function toStored(blocks) {
    return { blocks: blocks.slice(0, MAX_BLOCKS).map(function (b) { if (BUILTIN[b.type]) { var o = { id: b.id || b.type, type: b.type }; if (!BUILTIN[b.type].flag) o.on = b.on !== false; (BUILTIN[b.type].fields || []).forEach(function (k) { if (typeof b[k] === 'string') o[k] = b[k]; }); return o; } return b; }) };
  }
  // ── ONE CHANGE TO THE PAGE, BY WORDS (Oct 20 2026) ─────────────
  // The assistant edits the page the way the Page Layout card does - add a section, change its words, move it, show or
  // hide it, take it out - and this is the one function that does it: the assistant checks a change with it before the
  // owner sees it, the owner's page applies it with it (on the content as it is THEN), and the battery proves it. A
  // built-in part keeps its on/off where it always lived (setOn), so a change here and a change on the card are the same.
  var TEXT_MAX = { kicker: 80, title: 120, p1: 3000, p2: 3000, body: 6000, calloutTitle: 80, calloutText: 400, linkText: 60, text: 600, button: 40, intro: 1000, thanks: 300, note: 600 };
  var LINK_FIELDS = { linkUrl: 1, link: 1 };
  var MEDIA_FIELDS = { img: 'photo', poster: 'photo', video: 'video' };
  // how a section sits on the page: its background and its alignment ('auto' = as the section type always drew)
  var LOOKS = { bg: ['auto', 'plain', 'alt', 'dark'], align: ['auto', 'left', 'center'] };
  var LOOK_FIELDS = { story: ['bg'], cta: [], banner: [] };
  function lookFields(type) { return LOOK_FIELDS[type] || ['bg', 'align']; }
  function okLink(v) { return /^(\/(?!\/)[^\s<>"']*|#[A-Za-z0-9_-]+|https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:\+?[0-9 ()-]{3,30})$/.test(v); }
  function okMedia(v, kind) {
    if (v.indexOf('..') >= 0 || !/^\/uploads\/[A-Za-z0-9._\/-]{1,200}$/.test(v)) return false;
    return kind === 'video' ? /\.(mp4|webm|mov)$/i.test(v) : /\.(jpe?g|png|webp)$/i.test(v);
  }
  /** A list section's items, checked field by field (ITEM_SHAPES). */
  function cleanItems(type, v) {
    var shape = ITEM_SHAPES[type];
    if (!shape) throw new Error('a ' + ((CUSTOM[type] || BUILTIN[type] || {}).label || type) + ' section has no list');
    if (!Array.isArray(v)) throw new Error('the ' + shape.word + 's are a list');
    if (v.length > shape.max) throw new Error('at most ' + shape.max + ' ' + shape.word + 's');
    return v.map(function (it, i) {
      it = it || {}; var o = {};
      Object.keys(shape.fields).forEach(function (f) {
        var lim = shape.fields[f], x = String(it[f] == null ? '' : it[f]).trim();
        if (lim === 'photo') { if (x && !okMedia(x, 'photo')) throw new Error(shape.word + ' ' + (i + 1) + ': "' + x.slice(0, 60) + '" is not a photo on this unit (an /uploads/ address)'); }
        else if (lim === 'link') { if (x && !okLink(x)) throw new Error(shape.word + ' ' + (i + 1) + ': "' + x.slice(0, 60) + '" is not a link (a page like /book, a section like #visit, or https://...)'); }
        else if (x.length > lim) throw new Error(shape.word + ' ' + (i + 1) + ': its ' + f + ' is longer than ' + lim + ' characters');
        if (f === 'days') { var d = specialDays(x); if (!d) throw new Error(shape.word + ' ' + (i + 1) + ': "' + x + '" is not days of the week (every day, weekdays, weekends, or days like tue,thu)'); x = d; }
        if (f === 'date' && x && !/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(shape.word + ' ' + (i + 1) + ': its date "' + x + '" is not a date (YYYY-MM-DD)');
        if (f === 'also' && x) { var al = x.split(',').map(function (y) { return y.trim(); }).filter(Boolean); al.forEach(function (y) { if (ALSO.indexOf(y) < 0) throw new Error(shape.word + ' ' + (i + 1) + ': "' + y + '" is not a place it shows (' + ALSO.join(', ') + ')'); }); x = ALSO.filter(function (y) { return al.indexOf(y) >= 0; }).join(','); }
        o[f] = x;
      });
      if (!o[shape.need]) throw new Error(shape.word + ' ' + (i + 1) + ' is empty');
      return o;
    });
  }
  /** The fields a section of this type takes, checked: what is not its own is refused with the words to fix it. */
  function cleanFields(type, fields, isBuiltin) {
    var out = {}, allowed = {};
    if (isBuiltin) (BUILTIN[type].fields || []).forEach(function (k) { allowed[k] = 1; });
    else { Object.keys(CUSTOM[type].make()).forEach(function (k) { allowed[k] = 1; }); lookFields(type).forEach(function (k) { allowed[k] = 1; }); }
    Object.keys(fields || {}).forEach(function (k) {
      var v = fields[k];
      if (v === undefined || v === null) return;
      if (!allowed[k]) throw new Error('a ' + (isBuiltin ? BUILTIN[type].label : CUSTOM[type].label) + ' section has no "' + k + '" (it has: ' + Object.keys(allowed).join(', ') + ')');
      if (LOOKS[k]) { if (LOOKS[k].indexOf(v) < 0) throw new Error('"' + k + '" is one of: ' + LOOKS[k].join(', ')); out[k] = v; return; }
      if (k === 'items') { out.items = cleanItems(type, v); return; }
      if (k === 'show') { if (['all', 'today'].indexOf(v) < 0) throw new Error('"show" is all or today'); out.show = v; return; }
      // (Oct 22 2026) cards may show the package deals, live (Pricing > Package Deals): "packages"
      if (k === 'source') {
        if (type === 'cards') { if (['typed', 'packages'].indexOf(v) < 0) throw new Error('cards show "packages" (your package deals, live) or "typed" (cards typed here)'); out.source = v; return; }
        if (['typed', 'counter'].indexOf(v) < 0) throw new Error('a menu shows "counter" (the counter\'s menu, live) or "typed" (items typed here)'); out.source = v; return;
      }
      // (Oct 20 2026, late; maintainer: "tabs no tabs") the counter's menu as tabs, one part at a time, or one long list; an FAQ with
      // every answer closed, the first open, or all open
      if (k === 'display') { if (['list', 'tabs'].indexOf(v) < 0) throw new Error('a menu shows as "list" (every part, one after another) or "tabs" (one part at a time)'); out.display = v; return; }
      if (k === 'open') { if (['none', 'first', 'all'].indexOf(v) < 0) throw new Error('an FAQ opens "none", "first" or "all" of its answers'); out.open = v; return; }
      if (k === 'hideGroups') { if (!Array.isArray(v)) throw new Error('"hideGroups" is a list of the counter\'s categories to keep off the website'); out.hideGroups = v.map(function (x) { return String(x).trim().slice(0, 60); }).filter(Boolean).slice(0, 40); return; }
      if (k === 'fields') {
        var keys = FORM_FIELDS.map(function (f) { return f[0]; });
        if (!Array.isArray(v) || !v.length || v.some(function (x) { return keys.indexOf(x) < 0; })) throw new Error('a form asks for some of: ' + keys.join(', '));
        out.fields = keys.filter(function (x) { return x === 'name' || v.indexOf(x) >= 0; });
        return;
      }
      v = String(v).trim();
      if (MEDIA_FIELDS[k]) { if (v && !okMedia(v, MEDIA_FIELDS[k])) throw new Error('"' + v.slice(0, 60) + '" is not a ' + MEDIA_FIELDS[k] + ' on this unit (an /uploads/ address)'); out[k] = v; return; }
      if (LINK_FIELDS[k]) { if (v && !okLink(v)) throw new Error('"' + v.slice(0, 60) + '" is not a link (a page like /book, a section like #visit, or https://...)'); out[k] = v; return; }
      if (TEXT_MAX[k] && v.length > TEXT_MAX[k]) throw new Error('"' + k + '" is longer than ' + TEXT_MAX[k] + ' characters');
      out[k] = v;
    });
    return out;
  }
  /** Which section the words mean: its id, its kind, its name or its title - one, or the words to say which. */
  // ── PAGES MADE OF SECTIONS (Oct 20 2026, late; maintainer: "tabs no tabs pages not pages etc all the fun website building stuff so
  // people can really make it feel like there own site right from the AI") ─────────────────────────────────────────────
  // A page of the owner's own (content.pages[]) holds the same sections as the homepage - the homepage's own kinds, drawn by
  // the homepage's own renderer (landing.html, told which page it is), so a section looks the same wherever it sits. The
  // built-in parts stay on the homepage. A text page becomes a sections page when a section is added: its words become its
  // first section, never lost. A PDF page stays a PDF page.
  var PAGE_MAX_BLOCKS = 16;
  var HOME_WORDS = /^(?:home|home ?page|the home ?page|landing|main page|front page|the front page)$/i;
  function isHome(ref) { return ref == null || !String(ref).trim() || HOME_WORDS.test(String(ref).trim()); }
  /** Which page the words mean: its address, its title, or part of its title - one, or the words to say which. */
  function pageIndex(pages, ref) {
    var r = String(ref == null ? '' : ref).trim().toLowerCase().replace(/^\/?p\//, '').replace(/^\//, '').replace(/\s+page$/, '');
    if (!r) throw new Error('say which page');
    var by = function (f) { var out = []; pages.forEach(function (pg, i) { if (pg && f(pg)) out.push(i); }); return out; };
    var tries = [by(function (pg) { return String(pg.slug || '').toLowerCase() === r; }), by(function (pg) { return String(pg.title || '').trim().toLowerCase() === r; }),
      by(function (pg) { var t = String(pg.title || '').trim().toLowerCase(); return r.length >= 3 && t.length >= 3 && (t.indexOf(r) >= 0 || r.indexOf(t) >= 0); })];
    for (var i = 0; i < tries.length; i++) {
      if (tries[i].length === 1) return tries[i][0];
      if (tries[i].length > 1) throw new Error('more than one page matches "' + ref + '": ' + tries[i].map(function (j) { return pages[j].title + ' (/p/' + pages[j].slug + ')'; }).join(', ') + ' - say which by its address');
    }
    throw new Error('no page called "' + ref + '" (the pages: ' + (pages.filter(Boolean).map(function (pg) { return pg.title + ' (/p/' + pg.slug + ')'; }).join(', ') || 'none yet') + ')');
  }
  /** A page's sections, as the homepage keeps its own (the homepage's kinds only). [] for a text or PDF page. */
  function pageLayout(page) {
    var out = [];
    if (!page || page.kind === 'pdf') return out;
    (Array.isArray(page.blocks) ? page.blocks : []).forEach(function (b) { if (!b || !CUSTOM[b.type]) return; var c = {}; for (var k in b) c[k] = b[k]; c.id = c.id || uid(); c.on = c.on !== false; out.push(c); });
    return out.slice(0, PAGE_MAX_BLOCKS);
  }
  function isSectionsPage(page) { return pageLayout(page).length > 0; }
  // a text page's words as its first sections: whole paragraphs, as many sections as they need (none is ever cut)
  function wordsToSections(body) {
    var paras = String(body || '').split(/\n\s*\n/), out = [], cur = '';
    paras.forEach(function (pp) {
      while (pp.length > TEXT_MAX.body) { if (cur) { out.push(cur); cur = ''; } out.push(pp.slice(0, TEXT_MAX.body)); pp = pp.slice(TEXT_MAX.body); }
      if (cur && cur.length + 2 + pp.length > TEXT_MAX.body) { out.push(cur); cur = ''; }
      cur = cur ? cur + '\n\n' + pp : pp;
    });
    if (cur.trim()) out.push(cur);
    return out.map(function (t) { var b = newBlock('text'); b.title = ''; b.body = t; return b; });
  }
  // where a section goes when the owner did not say: before Find us and the closing band on the homepage, last on a page
  function placeIn(list, blk, edit, home) {
    var j;
    if (edit.before || edit.after) { var ref = findBlock(list, edit.before || edit.after); j = list.indexOf(ref) + (edit.after ? 1 : 0); }
    else if (edit.at === 'top' || edit.to === 'top') j = 0;
    else if (edit.at === 'bottom' || edit.to === 'bottom' || !home) j = list.length;
    else { var v = list.filter(function (x) { return x.type === 'visit'; })[0] || list.filter(function (x) { return x.type === 'ctaEnd'; })[0]; j = v ? list.indexOf(v) : list.length; }
    list.splice(j, 0, blk);
  }
  /** A section moved to another page, or back to the homepage: { do: 'moveTo', block, page: where it is now, to, at, before, after }. */
  function moveTo(content, edit) {
    var pages = Array.isArray(content.pages) ? content.pages : [];
    var fromHome = isHome(edit.page), toHome = isHome(edit.to), save = {}, note = '';
    var home = defaultLayout(content);
    var sp = fromHome ? null : pages[pageIndex(pages, edit.page)];
    var tp = null, made = false;
    if (!toHome) {
      // a page of its own that is not there yet (edit.create: { slug, title, inMenu }) is made in this same save
      var ti = -1; try { ti = pageIndex(pages, edit.to); } catch (e) { if (!edit.create) throw e; }
      if (ti >= 0) tp = pages[ti];
      else {
        var cr = edit.create || {}, slug = String(cr.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60), title = String(cr.title || '').trim().slice(0, 120);
        if (!slug || !title) throw new Error('a new page needs its title');
        var base = slug, n = 2; while (pages.some(function (x) { return x && String(x.slug || '').toLowerCase() === slug; })) slug = base + '-' + (n++);
        tp = { slug: slug, title: title, body: '', published: true, showInNav: cr.inMenu !== false, showInFooter: false, metaTitle: '', metaDescription: '', shareImage: '', kind: 'text', pdf: '', openLabel: '', downloadLabel: '', blocks: [] };
        pages.push(tp); made = true;
      }
    }
    if (fromHome === toHome && sp === tp) throw new Error('it is on that page already');
    // a page a section is moved to is public: a draft (a page the one-page change kept) is published again, in the menu
    if (tp && edit.publish && !tp.published) { tp.published = true; if (tp.showInNav === undefined) tp.showInNav = true; }
    if (tp && tp.kind === 'pdf') throw new Error('"' + tp.title + '" shows a PDF - make a new page for sections');
    var src = fromHome ? home : pageLayout(sp);
    var b = findBlock(src, edit.block);
    if (BUILTIN[b.type]) throw new Error(BUILTIN[b.type].label + ' is part of the homepage - it stays there (it can be hidden)');
    var dst = toHome ? home : pageLayout(tp);
    if (tp && !dst.length && String(tp.body || '').trim()) { dst = wordsToSections(tp.body); tp.body = ''; note = 'the words "' + tp.title + '" had are its first section now'; }
    if (dst.length >= (toHome ? MAX_BLOCKS : PAGE_MAX_BLOCKS)) throw new Error((toHome ? 'the homepage' : '"' + tp.title + '"') + ' holds ' + (toHome ? MAX_BLOCKS : PAGE_MAX_BLOCKS) + ' sections at most - take one out first');
    src.splice(src.indexOf(b), 1);
    placeIn(dst, b, { before: edit.before, after: edit.after, at: edit.at }, toHome);
    if (fromHome || toHome) save.layout = toStored(home);
    if (sp) sp.blocks = src.map(function (x) { return x; });
    if (tp) tp.blocks = dst.map(function (x) { return x; });
    if (sp || tp) save.pages = pages;
    if (sp && !src.length) note = (note ? note + '; ' : '') + '"' + sp.title + '" has nothing on it now';
    if (made) note = (note ? note + '; ' : '') + 'the page "' + tp.title + '" is made at /p/' + tp.slug + (tp.showInNav ? ', in the top menu' : '');
    return { save: save, block: { id: b.id, type: b.type, label: label(b) }, note: note, page: tp ? tp.slug : null, from: sp ? sp.slug : null };
  }
  /** The whole site on one page (Oct 20 2026, late): the sections of every published page come onto the homepage (before Find
   *  us, in the pages' order), each page's menu link becomes a link that jumps down the homepage to its first section, and
   *  the pages are kept as drafts - nothing is deleted, and "give X its own page" puts any of them back. */
  function onePage(content) {
    var pages = Array.isArray(content.pages) ? content.pages : [], home = defaultLayout(content), moved = [], first = null;
    var nav = content.nav && typeof content.nav === 'object' ? content.nav : {}, items = Array.isArray(nav.items) ? nav.items.slice() : [];
    var base = (content.settings && content.settings.homepage === 'landing') ? '/' : '/landing';
    pages.forEach(function (pg) {
      if (!pg || !pg.published) return;
      var list = pageLayout(pg); if (!list.length) return;
      if (home.length + list.length > MAX_BLOCKS) throw new Error('the homepage holds ' + MAX_BLOCKS + ' sections at most - "' + pg.title + '" does not fit; take some sections out first');
      list.forEach(function (b) { placeIn(home, b, {}, true); });
      if (!first) first = list[0];
      var key = 'link:' + pg.slug, at = -1;
      items = items.filter(function (x) { return !x || x.key !== key; });
      items.forEach(function (x, i) { if (x && x.key === 'page:' + pg.slug) at = i; });
      var entry = { key: key, label: String(pg.title || pg.slug).slice(0, 40), href: base + '#blk-' + list[0].id, top: pg.showInNav !== false, foot: !!pg.showInFooter };
      if (at >= 0) items.splice(at, 1, entry); else items.push(entry);
      pg.blocks = []; pg.published = false;
      moved.push(pg.title || pg.slug);
    });
    if (!moved.length) throw new Error('no page has sections to bring onto the homepage - the site is one page already');
    nav.items = items;
    return { save: { layout: toStored(home), pages: pages, nav: nav }, block: { id: first.id, type: first.type, label: label(first) },
      note: 'on the homepage now: ' + moved.join(', ') + ' - each page kept as a draft, its menu link jumping down the homepage' };
  }
  function findBlock(blocks, ref) {
    var r = String(ref == null ? '' : ref).trim(), n = r.toLowerCase().replace(/^blk-/, '');
    if (!n) throw new Error('say which section');
    var hit = function (list) { return list.length === 1 ? list[0] : null; };
    var byId = blocks.filter(function (b) { return String(b.id).toLowerCase() === n; });
    if (byId.length) return byId[0];
    var sec = SECTION_IDS[r] || Object.keys(SECTION_IDS).filter(function (k) { return k.toLowerCase() === n; }).map(function (k) { return SECTION_IDS[k]; })[0];
    var tries = [
      blocks.filter(function (b) { return BUILTIN[b.type] && (b.type.toLowerCase() === n || BUILTIN[b.type].label.toLowerCase() === n || (sec && b.type === sec)); }),
      blocks.filter(function (b) { return CUSTOM[b.type] && String(b.title || '').trim().toLowerCase() === n; }),
      blocks.filter(function (b) { return CUSTOM[b.type] && (b.type === n || CUSTOM[b.type].label.toLowerCase() === n); }),
      blocks.filter(function (b) { var t = String(label(b)).toLowerCase(); return n.length >= 3 && (t.indexOf(n) >= 0 || (t.length >= 4 && n.indexOf(t) >= 0)); })
    ];
    for (var i = 0; i < tries.length; i++) {
      if (tries[i].length === 1) return tries[i][0];
      if (tries[i].length > 1) throw new Error('more than one section matches "' + r + '": ' + tries[i].map(function (b) { return label(b) + ' (' + b.id + ')'; }).join(', ') + ' - say which by its id');
    }
    throw new Error('no section called "' + r + '" (the sections: ' + blocks.map(function (b) { return label(b) + ' (' + b.id + ')'; }).join(', ') + ')');
  }
  function visible(b, content) { return BUILTIN[b.type] ? isOn(b, content) : b.on !== false; }
  /**
   * edit: { do: 'add', type, fields, at: 'top'|'bottom', before, after }
   *       { do: 'edit', block, fields, addItems }     { do: 'move', block, to: 'top'|'bottom'|'up'|'down', before, after }
   *       { do: 'show', block, on }                     { do: 'remove', block }
   * Returns { save: { <content key>: value, ... }, block: { id, type, label }, note } - every key to save, the layout
   * among them - or throws an Error whose words are for the owner. content is not changed.
   */
  function applyEdit(content, edit) {
    content = JSON.parse(JSON.stringify(content || {}));
    edit = edit || {};
    if (edit.do === 'moveTo') return moveTo(content, edit);
    if (edit.do === 'onePage') return onePage(content);
    // a page of the owner's own (Oct 20 2026, late): its own sections, the same edits
    var onPage = !isHome(edit.page), pages = null, pg = null, note = '';
    if (onPage) {
      pages = Array.isArray(content.pages) ? content.pages : [];
      pg = pages[pageIndex(pages, edit.page)];
      if (pg.kind === 'pdf') throw new Error('"' + pg.title + '" shows a PDF - make a new page for sections');
    }
    var blocks = onPage ? pageLayout(pg) : defaultLayout(content), save = {}, b, i;
    if (onPage && !blocks.length && edit.do === 'add' && String(pg.body || '').trim()) { blocks = wordsToSections(pg.body); pg.body = ''; note = 'its words are its first section now'; }
    var max = onPage ? PAGE_MAX_BLOCKS : MAX_BLOCKS;
    var place = function (blk, at) { placeIn(blocks, blk, { before: edit.before, after: edit.after, at: at }, !onPage); };
    if (edit.do === 'add') {
      if (!CUSTOM[edit.type]) throw new Error('a new section is one of: ' + Object.keys(CUSTOM).join(', '));
      if (blocks.length >= max) throw new Error((onPage ? '"' + pg.title + '"' : 'the page') + ' holds ' + max + ' sections at most - take one out first');
      b = newBlock(edit.type);
      var f = cleanFields(edit.type, edit.fields, false);
      for (var k in f) b[k] = f[k];
      place(b, edit.at);
    } else {
      b = findBlock(blocks, edit.block);
      i = blocks.indexOf(b);
      var builtin = !!BUILTIN[b.type];
      if (edit.do === 'edit') {
        if (builtin && !BUILTIN[b.type].fields) throw new Error(BUILTIN[b.type].label + ' is not edited here - ' + BUILTIN[b.type].desc);
        var g = cleanFields(b.type, edit.fields, builtin);
        if (edit.addItems && ITEM_SHAPES[b.type]) g.items = cleanItems(b.type, (Array.isArray(b.items) ? b.items : []).concat(edit.addItems));
        // one item's fields changed in its place (Oct 20 2026, night): { setItem: { ref: its first words, fields } }
        if (edit.setItem && ITEM_SHAPES[b.type]) {
          var list = (g.items || b.items || []).map(function (x) { var c = {}; for (var k3 in x) c[k3] = x[k3]; return c; }), need2 = ITEM_SHAPES[b.type].need, want = String(edit.setItem.ref || '').trim().toLowerCase();
          var hit = list.filter(function (x) { return String(x[need2] || '').toLowerCase() === want; });
          if (!hit.length) hit = list.filter(function (x) { return want && String(x[need2] || '').toLowerCase().indexOf(want) === 0; });
          if (hit.length !== 1) throw new Error(hit.length ? 'more than one ' + ITEM_SHAPES[b.type].word + ' starts "' + edit.setItem.ref + '" - say which' : 'no ' + ITEM_SHAPES[b.type].word + ' "' + edit.setItem.ref + '" in ' + label(b));
          var sf = edit.setItem.fields || {}; for (var k4 in sf) hit[0][k4] = sf[k4];
          g.items = cleanItems(b.type, list);
        }
        if (edit.dropItems && ITEM_SHAPES[b.type]) {
          // items taken out by their place (1 = the first) or their first words
          var have = (g.items || b.items || []).slice(), need = ITEM_SHAPES[b.type].need;
          edit.dropItems.forEach(function (ref) {
            var n = Number(ref), at = (Number.isInteger(n) && n >= 1 && n <= have.length) ? n - 1 : -1;
            if (at < 0) { var t = String(ref).trim().toLowerCase(); have.forEach(function (x, i) { if (at < 0 && x && String(x[need] || '').toLowerCase().indexOf(t) === 0) at = i; }); }
            if (at < 0) throw new Error('no ' + ITEM_SHAPES[b.type].word + ' "' + ref + '" in ' + label(b));
            have.splice(at, 1);
          });
          g.items = have;
        }
        if (!Object.keys(g).length) throw new Error('say what to change in ' + label(b));
        for (var k2 in g) b[k2] = g[k2];
      } else if (edit.do === 'move') {
        if (edit.before || edit.after) { if (findBlock(blocks, edit.before || edit.after) === b) throw new Error('a section cannot move next to itself'); }
        else if (['top', 'bottom', 'up', 'down'].indexOf(edit.to) < 0) throw new Error('say where: top, bottom, up, down, or before or after another section');
        blocks.splice(i, 1);
        if (!edit.before && !edit.after && (edit.to === 'up' || edit.to === 'down')) {
          // one step past the next section a visitor actually sees (a hidden one in between would make the move look like nothing)
          var j2;
          if (edit.to === 'up') { j2 = i - 1; while (j2 > 0 && !visible(blocks[j2], content)) j2--; j2 = Math.max(0, j2); }
          else { j2 = i; while (j2 < blocks.length && !visible(blocks[j2], content)) j2++; j2 = Math.min(blocks.length, j2 + 1); }
          blocks.splice(j2, 0, b);
        } else place(b, edit.to);
      } else if (edit.do === 'show') {
        var key = setOn(b, content, edit.on !== false);
        if (key) save[key] = content[key];
        if (onPage) { pg.blocks = blocks; save.pages = pages; return { save: save, block: { id: b.id, type: b.type, label: label(b) }, note: note, page: pg.slug }; }
        if (edit.on !== false && SURFACE_OF_BLOCK[b.type] && !publicMap(content.settings)[SURFACE_OF_BLOCK[b.type]])
          note = 'it shows once the ' + SURFACE_OF_BLOCK[b.type] + ' page is public (the What\'s Public card)';
        if (!key) save.layout = toStored(blocks);
      } else if (edit.do === 'remove') {
        if (builtin) throw new Error(BUILTIN[b.type].label + ' is built in - it can be hidden, not taken out');
        blocks.splice(i, 1);
      } else throw new Error('a change is add, edit, move, moveTo, show or remove');
    }
    if (onPage) { pg.blocks = blocks; save.pages = pages; return { save: save, block: { id: b.id, type: b.type, label: label(b) }, note: note, page: pg.slug }; }
    if (edit.do !== 'show') save.layout = toStored(blocks);
    return { save: save, block: { id: b.id, type: b.type, label: label(b) }, note: note };
  }

  return { PAGE_MAX_BLOCKS: PAGE_MAX_BLOCKS, pageLayout: pageLayout, isSectionsPage: isSectionsPage, pageIndex: pageIndex, isHome: isHome, wordsToBlocks: wordsToSections,
    MAX_BLOCKS: MAX_BLOCKS, BUILTIN: BUILTIN, CUSTOM: CUSTOM, FORM_FIELDS: FORM_FIELDS, LOOKS: LOOKS, defaultLayout: defaultLayout, isOn: isOn, setOn: setOn, label: label, newBlock: newBlock, toStored: toStored, uid: uid, publicMap: publicMap, hrefPublic: hrefPublic, SURFACE_PATHS: SURFACE_PATHS, SECTION_IDS: SECTION_IDS, sectionOn: sectionOn, linkAlive: linkAlive, findBlock: findBlock, cleanFields: cleanFields, cleanItems: cleanItems, applyEdit: applyEdit, lookFields: lookFields, ITEM_SHAPES: ITEM_SHAPES, specialDays: specialDays, dayMatch: dayMatch, daysWords: daysWords, ALSO: ALSO, specialOn: specialOn, todaysSpecials: todaysSpecials };
});
