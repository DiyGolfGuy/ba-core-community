// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/deals.js - PACKAGE DEALS AND BOOKING DEALS BY TALKING, AND WHAT THE OWNER COULD RUN (BA Core 2 AI,
// Oct 22 2026)
//
// maintainer: "any and all sorts of package deals"; "book 2 hours get the last 30 min free Tuesdays ... the Ai needs to do and and
// sometimes even say this is what I can do so it needs to teach the owner some things along the way". The same routes as the
// Pricing tab's Booking Deals and Package Deals cards (routes/pricing.js), the same services (services/packages.js,
// services/deals.js). Money is asked, never guessed (maintainer: "be very very cautious on all things requiring tax and money"): a
// package's price and its tax, and a deal's amount, are the owner's words or the box's question - and every card shows what the
// money comes to before the yes. deal_ideas is the box teaching: every kind of deal it can run, with this facility's own items.
'use strict';

module.exports = (H) => {
  const { ActionError, check, DATE, TIME, normDays, timeWords, dayWords } = H;
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const money = (c) => '$' + ((c | 0) % 100 ? ((c | 0) / 100).toFixed(2) : String((c | 0) / 100));
  const andList = (l) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);
  const lenWords = (m) => m % 60 ? (m < 60 ? `${m} minutes` : `${m / 60} hours`) : `${m / 60} hour${m === 60 ? '' : 's'}`;
  const DAYS_SAY = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  const daysSay = (d) => (d && d.length ? d.map(x => DAYS_SAY[x] || x).join(', ') : 'every day');
  // (the owner's context answers { status, json } - no ok: read as every other area reads it, by its status - until Oct 22 2026, later,
  // every package read here came back empty on a real box, and "book Pat Lee on the party package" found no party package)
  const read = async (ctx, p) => { const r = await ctx.call('GET', p); if (!r || r.status >= 400) throw new ActionError(`that answered ${r.status}${r.json && r.json.error ? ': ' + r.json.error : ''}`); return r.json || {}; };
  const cats = (ctx) => ((ctx.menu || {}).cats || []);
  const codes = (ctx) => (((ctx.menu || {}).taxes) || []).filter(t => t.id !== 'sim');
  const bookingsRate = (ctx) => { const T = ctx.taxSettings || {}; return T.bookings && T.bookings.on ? Number(T.bookings.rate) || 0 : 0; };
  const per30 = (ctx) => Math.round((Number((((ctx.opsConfig || {}).booking) || {}).pricePerHalfHour) || 0) * 100);
  function pick(list, ref, what, nameOf) {
    const n = norm(ref).replace(/^(?:any|any of the|the|a|an)\s+/, '').replace(/s$/, '');
    if (!n) throw new ActionError(`say which ${what}`);
    const name = (x) => norm(nameOf(x)), single = (x) => name(x).replace(/s$/, '');
    for (const test of [(x) => name(x) === n || single(x) === n, (x) => name(x).startsWith(n), (x) => name(x).includes(n)]) {
      const hit = list.filter(test);
      if (hit.length === 1) return hit[0];
      if (hit.length > 1) throw new ActionError(`more than one ${what} matches "${ref}": ${andList(hit.map(x => `"${nameOf(x)}"`))} - say which`);
    }
    return null;
  }
  const pkgsOf = (ctx) => ((ctx.packages || {}).packages || []);
  const dealsOf = (ctx) => ((ctx.deals || {}).deals || []);
  const findPkg = (ctx, ref) => { const p = pick(pkgsOf(ctx), ref, 'package', (x) => x.name); if (!p) throw new ActionError(`there is no package called "${ref}"${pkgsOf(ctx).length ? ' - the packages are ' + andList(pkgsOf(ctx).map(x => `"${x.name}"`)) : ' yet'}`); return p; };
  const findDeal = (ctx, ref) => { const d = pick(dealsOf(ctx), ref, 'deal', (x) => x.name); if (!d) throw new ActionError(`there is no booking deal called "${ref}"${dealsOf(ctx).length ? ' - the deals are ' + andList(dealsOf(ctx).map(x => `"${x.name}"`)) : ' yet'}`); return d; };

  // a package's included things from the owner's words: an item by name, or any of a part of the menu ("2 beers" - the Beer part)
  function includeOf(ctx, x) {
    const what = String(x.what || '').trim(); if (!what) throw new ActionError('say what the package includes');
    const items = cats(ctx).flatMap(c => (c.items || []).map(i => Object.assign({ part: c.name }, i)));
    const anyOf = /^any\b/i.test(what);
    const part = pick(cats(ctx), what, 'part of the menu', (c) => c.name);
    const item = anyOf ? null : pick(items, what, 'menu item', (i) => i.name);
    if (item && !(part && norm(part.name) === norm(what.replace(/^(?:any|the)\s+/i, '')))) return { kind: 'item', id: item.id, qty: Math.max(1, Math.round(x.qty || 1)), per_person: !!x.per_person, name: item.name };
    if (part) return { kind: 'part', id: part.id, qty: Math.max(1, Math.round(x.qty || 1)), per_person: !!x.per_person, name: 'from ' + part.name };
    throw new ActionError(`"${what}" is not on the menu - ${cats(ctx).length ? 'the parts are ' + andList(cats(ctx).map(c => c.name)) : 'the menu is empty: add it first (menu_items_add)'}`);
  }
  // its tax, as the owner said it: 'booking', a counter code's name ('Beverage'), or 'split:<code>'
  function taxOf(ctx, t) {
    const s = norm(t);
    if (!s || /^(?:a )?booking|^golf|^the booking/.test(s)) return { tax_mode: 'bookings', tax_code: '' };
    const split = /^split/.test(s), rest = s.replace(/^split[: ]*/, '').replace(/\s*\(\d+(?:\.\d+)?%\)$/, '').replace(/\s+tax$/, '');
    const c = codes(ctx).find(x => norm(x.id) === rest || norm(x.name) === rest) || pick(codes(ctx), rest || 'x', 'tax code', (x) => x.name);
    if (!c) throw new ActionError(`"${t}" is not one of the counter's tax codes: ${andList(codes(ctx).map(x => `${x.name} (${x.rate}%)`))}`);
    return { tax_mode: split ? 'split' : 'code', tax_code: c.id };
  }
  // the money of a package for its least and its most players, its tax line by line - the same lines the checkout charges
  function packageMoney(ctx, b) {
    const code = codes(ctx).find(c => c.id === b.tax_code), brate = bookingsRate(ctx);
    const one = (n) => { const heads = b.price_type === 'per_person' ? Math.max(n, b.min_players || 1) : 1, total = b.price_cents * heads;
      const lines = b.tax_mode === 'code' && code ? [[total, Number(code.rate) || 0]] : b.tax_mode === 'split' && code ? [[Math.min(total, b.golf_cents * heads), brate], [total - Math.min(total, b.golf_cents * heads), Number(code.rate) || 0]] : [[total, brate]];
      const tax = lines.reduce((a, [c, r]) => a + Math.round(c * r / 100), 0);
      return `${b.price_type === 'per_person' ? n + ' players' : 'With tax'}: ${money(total)} + ${money(tax)} tax = ${money(total + tax)}`; };
    const ns = b.price_type === 'per_person' ? [...new Set([b.min_players || 1, b.max_players || b.min_players || 1])] : [1];
    return ns.map(one).join('; ');
  }
  const taxSay = (ctx, b) => { const code = codes(ctx).find(c => c.id === b.tax_code);
    return b.tax_mode === 'code' && code ? `taxed as ${code.name} (${code.rate}%)` : b.tax_mode === 'split' && code ? `the golf part (${money(b.golf_cents)}${b.price_type === 'per_person' ? ' a person' : ''}) taxed as a booking (${bookingsRate(ctx)}%), the rest as ${code.name} (${code.rate}%)` : `taxed as a booking (${bookingsRate(ctx)}%)`; };
  // times of day and dates said outright - a start window or a season the owner never said is the model's invention
  const TIMES_SAID = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b(?:after|before|from|until|till|between) \d|\bmornings?\b|\bafternoons?\b|\bevenings?\b|\bnights?\b|\bnoon\b|\bopening\b|\bclos(?:e|ing)\b|\blunch\b|\bhappy hour\b/i;
  const DATES_SAID = /\b(?:until|through|thru|till|starting|ending|ends?|season|this (?:month|week|fall|winter|summer|spring)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|holidays?|christmas|summer|winter|spring|fall)\b/i;
  const DEAL_KINDS = { last_minutes_free: 'free_minutes', percent_off: 'percent', dollars_off: 'off', free_things: 'free_items' };
  // FREE THINGS WITH A BOOKING (Oct 22 2026, night; maintainer: "if its 2 hours and free pitches they just get the pitchers at the front desk
  // no need for a special booking"): what comes free, read from the owner's own words when the model left it out - "2 free
  // pitchers", "a free appetizer", "get 2 pitchers free", "a pitcher on us"
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  function freeThingsSaid(w) {
    const t = String(w || '').toLowerCase(), out = [];
    const re = /\b(\d+|a|an|one|two|three|four|five|six)?\s*free\s+([a-z][a-z' -]{1,40}?)(?=\s+(?:with|when|for|on|at|if|every|each|per|and|after|before|to|tuesdays?|mondays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weekends?)\b|[.,!?;]|$)|\b(\d+|a|an|one|two|three|four|five|six)\s+([a-z][a-z' -]{1,40}?)\s+(?:free|on us|on the house)\b/g;
    let m; while ((m = re.exec(t))) {
      const qty = NUM[m[1] || m[3]] || Number(m[1] || m[3]) || 1, what = String(m[2] || m[4] || '').trim().replace(/^(?:of|the)\s+/, '');
      // never the time itself ("the last 30 minutes free", "an hour free")
      // (a skipped one is tried again from its next word: "2 hours and a pitcher on us" is "a pitcher")
      if (!what || /^(?:minutes?|mins?|hours?|hrs?|half|time|golf|bay|bays|session|booking|of charge|code|play|round|game|parking|wi-?fi|cancell?ation|(?:sun|mon|tues|wednes|thurs|fri|satur)days?|weekdays?|weekends?|today|tonight|every|all|any|for|with|on|at|the|this|next)\b/.test(what) || /\b(?:minutes?|hours?)$/.test(what)) { re.lastIndex = m.index + 1; continue; }
      // ("the free pitcher one" names an idea, not a thing given: no number and "the" before it)
      if (!(m[1] || m[3]) && /\b(?:the|that|this|your)\s*$/.test(t.slice(0, m.index))) continue;
      out.push({ what: what.replace(/\s+(?:at|from)\s+the\s+(?:front )?(?:desk|counter|bar)$/, '').replace(/\s+(?:one|ones|deal|special)$/, ''), qty });
    }
    return out;
  }

  // A DEAL SAID PLAINLY (Oct 22 2026, late night; the walks on the 4B: "lets do buy an hour get an hour on tuesdays" was answered in
  // words - what it would make, and nothing made): the plainest shapes are the box's own call, put up as the card the owner approves
  // (its amounts and the booking it needs are read from the same words by deal_set's fill); anything less plain is the model's
  const FOOD_SAID = /\b(?:tacos?|wings?|nachos|fries|burgers?|pizzas?|beers?|drafts?|pitchers?|drinks?|wells?|rails?|shots?|wines?|cocktails?|seltzers?|apps?|appetizers?|food|sliders?|pretzels?|hot ?dogs?|brats?|sodas?|pops?)\b/i;
  const BOOKING_SAID = /\b(?:book(?:s|ing|ed)?|bays?|hours?|sessions?|golf|play(?:ing)?|tee ?times?|sim(?:ulator)?s?|rounds?|minutes?)\b/i;
  const DAY_NAME = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  // a free thing as the owner said it, on the menu: as said, else without "an order of", "a plate of" ("a free order of wings")
  function freeOf(ctx, x) {
    try { return includeOf(ctx, x); } catch (e) {
      const bare = String(x.what || '').replace(/^(?:an? )?(?:orders?|plates?|baskets?|sides?|servings?|rounds?|bowls?) of /i, '');
      if (bare !== x.what) return includeOf(ctx, Object.assign({}, x, { what: bare }));
      throw e;
    }
  }
  function dealRead(words, conv, ctx) {
    const s = String(words || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
    if (/\?/.test(s) || s.split(/\s+/).length > 30 || /\b(?:package|code|members?|membership|happy hour|special price|flyer)\b/.test(s)) return null;
    // (a price said is a package or a price - "2 hours and a free pitcher for $60" - never a deal the box reads itself)
    if (/\$\s?\d|\b\d+(?:\.\d+)?\s*(?:dollars|bucks)\b|\bfor \d+(?:\.\d+)?\b(?!\s*(?:hours?|hrs?|minutes?|mins?|people|players|guests))|\b\d+\s*(?:%|percent)/.test(s)) return null;
    // (a question without its question mark - "do they gotta pick the wings thing when they book" - is the model's to answer)
    if (/^(?:ok(?:ay)?,?\s+|so,?\s+|and\s+|also,?\s+)?(?:how|what|why|when|where|who|which|do|does|did|is|are|was|were|will|would|should|could|can|if)\b(?!\s+(?:you|u)\s+(?:make|do|set|give|add|run))/.test(s)) return null;
    if (!/\b(?:let'?s|do|make|set (?:it )?up|give|run|add|offer|start|create|want|they get|people get|customers get|gets?|if they book|when (?:they|people|someone) books?|book(?:s|ing)? (?:\d|an?|one|two|three|four)\b)/.test(s)) return null;
    // THE DAYS AS SAID, EVERY ONE (Oct 27 2026, the review of round 2: "lets do buy an hour get an hour on tues", "... on weds", "... tues
    // and thurs", "... on mon wed fri" were each put up for EVERY day, and "... monday to thursday" for Mondays only - this read took the
    // first whole day name and nothing else): abbreviations, lists and runs, and a day left out as the days left (helpers.daysIn); two
    // groups of days, or days it cannot place, are the model's
    const ds = H.daysSaid(s); if (ds.unsure || new Set(ds.groups.map(g => g.join())).size > 1) return null;
    const days = H.daysIn(s, true) || [];
    if ((ds.groups.length || ds.left.size) && !days.length) return null;
    const when = days.length === 1 ? DAY_NAME[days[0]] + ' ' : days.length === 5 && !days.includes('sat') ? 'Weekday ' : days.length === 2 && days.includes('sat') && days.includes('sun') ? 'Weekend ' : '';
    const base = days.length ? { days: days.join(',') } : {};
    if (/\bbuy (?:an?|one|1) hours?,? get (?:an?|one|1)(?: more)? hours?\b|\bbogo\b/.test(s)) return Object.assign({ name: when + 'Buy an Hour, Get an Hour', kind: 'last_minutes_free' }, base);
    // (named by what was said - "Tuesday Last Half Free" for the last 30 minutes, as the action's own example has it; "Last Minutes Free"
    // only when no length was said)
    if (/\b(?:the )?(?:last|final) (?:\d+|thirty|half(?: an)? hour)\b[^.?!]*\bfree\b|\bfree (?:\d+|thirty) ?(?:minutes?|mins?)\b|\b(?:last|final) hour\b[^.?!]*\bfree\b/.test(s)) {
      // (a number said in hours is hours - "the last 1 hour free" was named "Last 1 Minutes Free" over its 60 free minutes, and "the
      // last 2 hours free" "Last 2 Minutes Free": Oct 25 2026, the adversarial review; a bare number is minutes as before - "the last 30
      // free" - only where it can be minutes, on the quarter hour; "the last 2 free" is named by no length)
      const lm = s.match(/\b(?:last|final) (\d+|thirty|half(?: an)? hour|hour)(?:\s*(hours?|hrs?|minutes?|mins?)\b)?/) || s.match(/\bfree (\d+|thirty) ?(minutes?|mins?)\b/), w = lm ? lm[1] : '', unit = lm ? (lm[2] || '') : '';
      const mins = /^thirty$|^half/.test(w) ? 30 : w === 'hour' ? 60 : !Number(w) ? 0 : /^h/.test(unit) ? Number(w) * 60 : /^m/.test(unit) || Number(w) % 15 === 0 ? Number(w) : 0;
      return Object.assign({ name: when + (mins === 30 ? 'Last Half Free' : mins === 60 ? 'Last Hour Free' : mins && mins % 60 === 0 ? `Last ${mins / 60} Hours Free` : mins ? `Last ${mins} Minutes Free` : 'Last Minutes Free'), kind: 'last_minutes_free' }, base);
    }
    const free = freeThingsSaid(s);
    // (only what is on the menu - a free thing the menu does not have is the model's to ask about)
    const got = free.length === 1 ? (() => { try { return freeOf(ctx || {}, free[0]); } catch { return null; } })() : null;
    if (got && /\b(?:book(?:s|ing)?|hours?|sessions?)\b/.test(s)) return Object.assign({ name: (when + 'Free ' + require('../../deals').plural(String(got.name || free[0].what).replace(/^from /, ''), free[0].qty)).replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60), kind: 'free_things', free }, base);
    return null;
  }

  // a free-things deal: what comes free off the menu, when; never a price. Refused where nobody is at a counter with food and drink
  function freeBuild(a, ctx, was) {
    if ((((ctx.opsConfig || {}).pos) || {}).fnb === false) throw new ActionError('this facility has no food and drink at the counter (Settings > Staff > The Counter) - say so to the owner: free things need a counter; the deal could be minutes free or money off instead');
    const inc = a.free && a.free.length ? a.free.map(x => freeOf(ctx, x)) : (was && was.kind === 'free_items' ? (was.includes_list || []) : []);
    if (!inc.length) { const e = new ActionError('ask the owner what comes free with the booking'); e.ask = { param: 'free', question: 'What comes free with the booking? (something on your menu - "2 pitchers", "an appetizer")' }; throw e; }
    const days = a.days !== undefined ? (normDays(a.days) || []) : (was ? String(was.days || '').split(',').filter(Boolean) : []);
    const body = { id: was ? was.id : undefined, name: a.name || (was && was.name), kind: 'free_items', value: 0, includes: inc.map(x => ({ kind: x.kind, id: x.id, qty: x.qty })),
      min_minutes: a.book_at_least_hours !== undefined ? Math.round(a.book_at_least_hours * 2) * 30 : (was ? was.min_minutes : 0),
      days: days.length === 7 ? [] : days, start_from: a.start_from !== undefined ? a.start_from : (was ? was.start_from : ''), start_until: a.start_until !== undefined ? a.start_until : (was ? was.start_until : ''),
      date_from: a.first_day !== undefined ? a.first_day : (was ? was.date_from : ''), date_to: a.last_day !== undefined ? a.last_day : (was ? was.date_to : ''),
      words: a.words !== undefined ? a.words : (was ? was.words : ''), show_online: a.show_on_booking_page !== undefined ? a.show_on_booking_page : (was ? !!was.show_online : true), active: a.on !== undefined ? a.on : (was ? !!was.active : true) };
    if (!was) body.name = shortName(body, ctx);
    if (!body.name) throw new ActionError('say the deal\'s name');
    return { op: 'http', method: 'POST', path: '/api/pricing/deals', body };
  }
  // A NEW DEAL'S NAME IS SHORT: it is the flyer's title and the booking page's line, and the 4B named them as sentences ("Free Nachos
  // with 2-Hour Thursday Booking" - the walk, Oct 22 2026). A name over 30 characters the owner did not say is the box's own: the
  // day and the deal, "Thursday Free Nachos", "Weekday 20% Off"; the owner's own name, however long, is kept.
  function shortName(b, ctx) {
    const n = String(b.name || '').trim();
    if (!n || n.length <= 30 || String(ctx.newest || '').toLowerCase().includes(n.toLowerCase())) return n;
    const d = b.days || [], when = d.length === 1 ? DAY_NAME[d[0]] + ' ' : d.length === 5 && !d.includes('sat') && !d.includes('sun') ? 'Weekday ' : d.length === 2 && d.includes('sat') && d.includes('sun') ? 'Weekend ' : '';
    let what = '';
    if (b.kind === 'free_items') { const x = (b.includes || [])[0] || {}, items = cats(ctx).flatMap(c => c.items || []), it = x.kind === 'item' ? items.find(i => i.id === x.id) : null;
      const thing = it ? require('../../deals').plural(it.name, x.qty) : ''; what = thing ? 'Free ' + (thing.length > 18 ? thing.split(/\s+/).pop() : thing) : 'Free With Booking'; }
    else if (b.kind === 'free_minutes') what = b.value === 60 && b.min_minutes === 120 ? 'Buy an Hour, Get an Hour' : b.value === 60 ? 'Last Hour Free' : `Last ${b.value} Free`;
    else if (b.kind === 'percent') what = `${b.value}% Off`;
    else if (b.kind === 'off') what = `${money(b.value)} Off`;
    return what ? (when + what).slice(0, 60) : n;
  }
  // said back: what comes free, when, what it is worth at the menu's price, and how it reaches the customer - nothing to pick
  function freeSay(b, ctx) {
    const items = cats(ctx).flatMap(c => (c.items || []).map(i => Object.assign({ part: c.name, cat: c.id }, i)));
    const named = b.includes.map(x => { if (x.kind === 'part') { const c = cats(ctx).find(y => y.id === x.id) || {}; return { say: `${x.qty} from ${c.name || 'the menu'}`, cents: null }; }
      const i = items.find(y => y.id === x.id) || {}; return { say: require('../../deals').howMany(i.name || 'item', x.qty), cents: (i.price_cents | 0) * x.qty }; });
    const worth = named.every(n => n.cents != null) ? named.reduce((t, n) => t + n.cents, 0) : null;
    const lw = require('../../deals').words({ kind: 'free_items', min_minutes: b.min_minutes, days: (b.days || []).join(','), start_from: b.start_from, start_until: b.start_until, date_from: b.date_from, date_to: b.date_to, includes: '[]' }).replace(/get something free/, `get ${andList(named.map(n => n.say))} free`);
    const style = String((((ctx.opsConfig || {}).booking) || {}).accessStyle || '').toLowerCase();
    const served = /unmanned/.test(style) ? ' This facility is set up as unstaffed - free things need someone at the counter, so offer it only on days someone is there.' : /hybrid/.test(style) ? ' Someone needs to be at the counter to hand them over - keep it to your staffed hours (the start window).' : '';
    return `${b.id ? 'Change the booking deal' : 'New booking deal'} "${b.name}": ${lw}.${worth != null ? ` That is ${money(worth)} at your menu prices.` : ''} Nothing for the customer to pick or type: every booking that fits comes with ${named.length > 1 ? 'them' : 'it'} (a member's too), the booking page and the confirmation say so, and at the front desk ${named.length > 1 ? 'they ring' : 'it rings'} up at $0 on that booking's tab. The bay's price stays the same.${served}${b.active ? '' : ' (Off for now.)'}`;
  }

  const loaders = {
    packages: async (ctx) => { try { return await read(ctx, '/api/pricing/packages'); } catch (e) { return { packages: [], error: String(e.message || e).slice(0, 120) }; } },
    deals: async (ctx) => { try { return await read(ctx, '/api/pricing/deals'); } catch (e) { return { deals: [], error: String(e.message || e).slice(0, 120) }; } },
  };

  const actions = [
    { name: 'deals_read', area: 'money', kind: 'read', needs: ['packages', 'deals'],
      say: 'The package deals and booking deals there are now: each one\'s price or deal, what a package includes, when, its tax, whether it is on and on the booking page',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => ({
        booking_deals: dealsOf(ctx).map(d => ({ deal: d.name, what: d.words || d.words_auto, on: !!d.active, on_booking_page: !!d.show_online })),
        packages: pkgsOf(ctx).map(p => ({ package: p.name, price: p.price_words, bay_time: p.length, includes: p.includes_words || 'bay time only', when: p.when, tax: p.tax_words, on: !!p.active, sold_online: !!p.sell_online })) }) },

    // THE BOX TEACHES (maintainer: "sometimes even say this is what I can do"): every kind of deal it can run, each with an example made
    // from this facility's own menu and price, and what is set already - for "what can I do?", "ideas for slow Tuesdays"
    { name: 'deal_ideas', area: 'money', kind: 'read', needs: ['menu', 'packages', 'deals', 'opsConfig'],
      // (asked for ideas, the box looks them up before the model's first step - engine.js EVERYDAY)
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const items = cats(ctx).flatMap(c => (c.items || []).map(i => Object.assign({ part: c.name }, i)));
        const drink = items.find(i => /beer|draft|tap|drink|bar|wine|seltzer|cocktail/i.test(i.part + ' ' + i.name)), food = items.find(i => i !== drink && !/beer|drink|wine/i.test(i.part));
        const rate = per30(ctx), two = rate * 4;
        return {
          // (what golf-simulator facilities commonly run, checked Oct 22 2026, night - DECISIONS: weekday and time-of-day prices,
          // "book X get Y", a free pitcher with a booking, party packages, ID-checked rates, holiday gift cards, leagues) - each
          // with HOW THE CUSTOMER GETS IT, so the owner knows what happens online and at the desk (maintainer: "how the discount or a
          // special is done if people chose it in booking or at the facility")
          // (kept short: a result over the engine's 3000 characters is cut, and the small model then sees only the first few)
          ideas: [
            { kind: 'Booking deal - time or money off', example: `2 hours on Tuesdays, the last 30 minutes free${rate ? ` (${money(two)} becomes ${money(two - rate)})` : ''}; buy an hour get an hour; 20% off weekdays before 4`, how: 'automatic - they book as usual' },
            { kind: 'Booking deal - something free with it', example: `book 2 hours, get ${drink ? '2 ' + drink.name : '2 pitchers'} free`, how: 'automatic - staff hand it over at the front desk, $0 on their tab' },
            { kind: 'Happy hour or peak price', example: 'weekdays 2 to 5 cheaper; Friday and Saturday nights higher', how: 'automatic - the price for those times' },
            { kind: 'Package - bay time and more at one price', example: `2 hours${drink ? ' and a ' + drink.name : ''} for one price; a birthday party at a price a person`, how: 'they pick it when they book, or staff sell it' },
            { kind: 'Food and drink special', example: drink ? `${drink.name} $1 off Fridays 4 to 7` : 'Taco Tuesday, $3 tacos 5 to 9', how: 'at the counter - staff ring it up' },
            { kind: 'Rate checked at the door (military, seniors, students)', example: 'MILITARY20 for 20% off, check a military ID', how: 'they type the code and bring their ID' },
            { kind: 'Discount code or first-visit offer', example: 'SPRING20 for 20% off until May 31; WELCOME10, $10 off a first visit, shown on the website', how: 'they type the code - once each (by their phone number)' },
            { kind: 'Membership', example: 'Gold: $99 a month, 4 free hours', how: 'they join, then book with their PIN' },
            { kind: 'Gift cards', example: 'for the holidays, with a flyer and an email', how: 'they buy one online' },
            { kind: 'League night or contest', example: 'Thursday league, closest to the pin', how: 'on the Events page' },
            { kind: 'A flyer for any of these', example: 'homepage slides, Facebook, Instagram, email', how: 'they see it' },
          ],
          not_built_yet: 'prepaid hour packs (a gift card of that value instead), a bonus on gift cards, loyalty points',
          // (no tool names in it: the 4B read them out to the owner - "→ Use: with free things and a Bud Light" - the walk, Oct 22 2026)
          note: 'Say a few of these back in plain words with their examples and how the customer gets each, ask which one the owner wants, and set it up - one at a time, the money said back first. Something free with a booking needs nothing from the customer: staff hand it over at the front desk. A flyer for it is offered after.' };
      } },

    { name: 'deal_set', area: 'money', kind: 'write', confirm: true, needs: ['deals', 'opsConfig', 'menu'],
      say: 'Make a booking deal - no code, the price is lower when a booking fits: "book 2 hours on Tuesdays, the last 30 minutes free", "20% off any booking of 3 hours or more", "$10 off weeknights after 8" - or change one (deal: its name now). Its amount only as the owner said it',
      params: { type: 'object', properties: {
        name: { type: 'string', minLength: 2, maxLength: 60, description: 'its name, like "Tuesday Last Half Free"' },
        deal: { type: 'string', maxLength: 60, description: 'to change a deal that is there already: its name now' },
        kind: { type: 'string', enum: ['last_minutes_free', 'percent_off', 'dollars_off', 'free_things'], description: 'free_things: something off the menu free with it' },
        amount: { type: 'number', minimum: 0, maximum: 1000, description: 'the minutes free (30, 60), the percent, or the dollars off' },
        free: { type: 'array', maxItems: 6, items: { type: 'object', properties: { what: { type: 'string' }, qty: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['what'] } },
        book_at_least_hours: { type: 'number', minimum: 0, maximum: 4, description: 'the booking must be at least this many hours (0 or left out: any length)' },
        days: { type: 'string', description: 'its days: "tuesday", "weekdays", "fri, sat" (left out: every day)', 'x-days': true },
        start_from: Object.assign({}, TIME, { description: 'the earliest start it covers (HH:MM)' }), start_until: Object.assign({}, TIME, { description: 'the latest start it covers (HH:MM)' }),
        first_day: Object.assign({}, DATE, { description: 'its first day, when it is seasonal' }), last_day: Object.assign({}, DATE, { description: 'its last day' }),
        words: { type: 'string', maxLength: 200, description: 'its line for customers, if the owner gave one' },
        on: { type: 'boolean' }, show_on_booking_page: { type: 'boolean' } } },
      // what the model left out and the owner plainly said: "book 2 hours" is the booking it needs (the 4B left it out, Oct 22 2026)
      // (and a kind given as the deal's name - "deal": "last_minutes_free", the 4B, Oct 22 2026, later - is the kind when no deal is
      // called that; a kind left out is read from the owner's own words: "the last 30 minutes free", "20% off", "$10 off")
      fill: (a, ctx) => {
        if (a.deal && !dealsOf(ctx).some(d => String(d.name).trim().toLowerCase() === String(a.deal).trim().toLowerCase())) {
          const k = String(a.deal).toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
          const kk = Object.keys(DEAL_KINDS).find(x => x === k || DEAL_KINDS[x] === k);
          if (kk) { a = Object.assign({}, a, { kind: a.kind || kk }); delete a.deal; }
        }
        // free things said: read from the owner's own words ("get 2 free pitchers") - over the model's when they name something on the
        // menu (the 4B passed "bud light" for "2 free bud light pitchers": 2 beers at $10 put up in place of 2 pitchers at $36)
        { const said = freeThingsSaid(ctx.newest);
          const onMenu = said.length && said.every(x => { try { freeOf(ctx, x); return true; } catch { return false; } });
          // (and over the model's kind: "give them a free order of nachos" was put up as minutes free, the minutes asked - the 4B walk)
          const timeFree = /\b(?:last|final|free)\s+(?:\d+|thirty|half)\b[^.?!]*\b(?:minutes?|mins?|hours?)\b|\b(?:minutes?|mins?|an? hour|half(?: an)? hour)\s+free\b|\bbuy (?:an?|one|1) hours?\b/i.test(String(ctx.newest || ''));
          const kindOk = !a.kind || a.kind === 'free_things' || (onMenu && !timeFree);
          if (said.length && kindOk && !(a.deal && !a.kind) && (!(a.free && a.free.length) || onMenu)) { a = Object.assign({}, a, { kind: 'free_things', free: said }); delete a.amount; } }
        // "buy an hour, get an hour" is 2 hours with the last hour free, whatever length the model put (it put 1 - which cannot have an
        // hour free, and the deal was refused: the walk on the 4B, Oct 22 2026, night)
        if (/\bbuy (?:an?|one|1) hours?,? get (?:an?|one|1)(?: more)? hours?\b|\bbogo\b/i.test(String(ctx.newest || '')) && (!a.kind || DEAL_KINDS[a.kind] === 'free_minutes' || a.kind === 'free_minutes'))
          a = Object.assign({}, a, { kind: 'last_minutes_free', amount: a.amount === undefined ? 60 : a.amount, book_at_least_hours: !(a.book_at_least_hours > (a.amount === undefined ? 60 : a.amount) / 60) ? Math.max(2, ((a.amount === undefined ? 60 : a.amount) / 60) + 1) : a.book_at_least_hours });
        if (!a.kind && !a.deal) { const w = String(ctx.newest || '');
          // ("buy an hour, get an hour" is 2 hours with the last 60 free; "free 30 minutes when you book 2 hours" is the last 30 free)
          if (/\bbuy (?:an?|one|1) hours?,? get (?:an?|one|1)(?: more)? hours?\b|\bbogo\b/i.test(w)) a = Object.assign({}, a, { kind: 'last_minutes_free', amount: a.amount === undefined ? 60 : a.amount, book_at_least_hours: a.book_at_least_hours === undefined ? 2 : a.book_at_least_hours });
          const kk = a.kind ? a.kind : /\b(?:last|final)\s+(?:\d+|thirty|half(?: an)? hour)\b[^.?!]*\bfree\b|\bfree\s+(?:\d+|thirty)\s*(?:minutes?|mins?)\b|\b(?:\d+|thirty)\s*(?:minutes?|mins?) free\b|\b(?:an?|one|1) hour free\b/i.test(w) ? 'last_minutes_free' : /\d+(?:\.\d+)?\s*(?:%|percent)\s*off\b/i.test(w) ? 'percent_off' : /\$\s*\d+(?:\.\d+)?\s*off\b|\b\d+\s*dollars?\s*off\b/i.test(w) ? 'dollars_off' : null;
          if (kk) a = Object.assign({}, a, { kind: kk }); }
        // the minutes free as the owner said them, when the model left them out ("the last 30 minutes free", "an hour free")
        if (a.amount === undefined && (a.kind === 'last_minutes_free' || DEAL_KINDS[a.kind] === 'free_minutes')) { const w = String(ctx.newest || '');
          const mm = /\b(?:last|final|free)\s+(\d+)\s*(?:minutes?|mins?)\b|\b(\d+)\s*(?:minutes?|mins?)\s+(?:free|on us)\b/i.exec(w);
          // ("the last 2 hours free" is 120 minutes, as the deal's name now says - it was asked as "How many minutes free?": Oct 25 2026)
          const hh = mm ? null : /\b(?:last|final)\s+(\d)\s*(?:hours?|hrs?)\b/i.exec(w);
          const n = mm ? Number(mm[1] || mm[2]) : hh ? Number(hh[1]) * 60 : /\b(?:last|final)?\s*half(?: an)? hour\b[^.?!]*\bfree\b|\bfree half(?: an)? hour\b/i.test(w) ? 30 : /\b(?:an?|one|1) hour free\b|\b(?:last|final) hour\b[^.?!]*\bfree\b/i.test(w) ? 60 : 0;
          if (n > 0 && n % 30 === 0) a = Object.assign({}, a, { amount: n }); }
        if (a.book_at_least_hours !== undefined) return a;
        const N = { an: 1, a: 1, one: 1, two: 2, three: 3, four: 4 }, w = String(ctx.newest || '');
        const m = /\bbook(?:s|ing)?\s+(?:at least\s+)?(\d+(?:\.\d+)?|an?|one|two|three|four)\s+hours?\b/i.exec(w) || /\b(\d+(?:\.\d+)?|two|three|four)\s+hours?\s+or\s+(?:more|longer)\b/i.exec(w) || /\b(?:with|for) (?:a |an )?(\d+(?:\.\d+)?|two|three|four)[- ]hours?(?: booking| session)?\b/i.exec(w) || /\b(\d+(?:\.\d+)?|two|three|four)[- ]hour (?:booking|session)s?\b/i.exec(w);
        const h = m ? (N[m[1].toLowerCase()] || Number(m[1])) : 0; return h > 0 ? Object.assign({}, a, { book_at_least_hours: h }) : a; },
      // (money asked, never guessed: an amount not in the owner's words is the box's question; hours and days it never said, left off)
      // ("the last hour free" is 60, as the fill reads it and the deal's name says - it was asked as "How many minutes free?": Oct 27 2026)
      unsaid: { start_from: (v, w) => TIMES_SAID.test(w), start_until: (v, w) => TIMES_SAID.test(w), first_day: (v, w) => DATES_SAID.test(w), last_day: (v, w) => DATES_SAID.test(w), amount: (v, w) => new RegExp('(?:^|[^\\d.])' + String(Number(v)).replace('.', '\\.') + '(?![\\d])').test(w) || (Number(v) === 30 && /\bhalf (?:an )?hour\b|\blast half\b/i.test(w)) || (Number(v) === 60 && /\b(?:an|one|1) hour free\b|\b(?:last|final) hour\b[^.?!]*\bfree\b|\bbuy (?:an?|one|1) hours?,? get (?:an?|one|1)(?: more)? hours?\b|\bbogo\b/i.test(w)) || (Number(v) === 50 && /\bhalf off\b/i.test(w))
        || (Number(v) > 0 && Number(v) % 60 === 0 && new RegExp('\\b(?:last|final)\\s+' + (Number(v) / 60) + '\\s*(?:hours?|hrs?)\\b', 'i').test(w)) },
      build: (a, ctx) => {
        const was = a.deal ? findDeal(ctx, a.deal) : null;
        const kind = a.kind ? DEAL_KINDS[a.kind] : (was && was.kind);
        // A FOOD OR DRINK PRICE IS NOT A BOOKING DEAL (the walk in maintainer's typing, Oct 23 2026: "tacos 2 bucks on tuesdays" was put up as
        // $2 off every Tuesday booking): money off said about food or drink, with nothing said about the booking, goes back to the model
        if (!was && (kind === 'percent' || kind === 'off')) { const w = String(ctx.heard || ctx.newest || '');
          const named = cats(ctx).flatMap(c => c.items || []).some(i => { const n = String(i.name || '').toLowerCase().replace(/s$/, ''); return n.length > 2 && w.toLowerCase().includes(n); });
          if ((named || FOOD_SAID.test(w)) && !BOOKING_SAID.test(w)) throw new ActionError('the owner is talking about food or drink, not bay time - that is a food and drink special at the counter (counter_special_set), never a booking deal; if the item is not on the menu yet, ask whether to add it and what it costs normally'); }
        if (!kind) throw new ActionError('say the deal: the last minutes free, a percent off, dollars off, or something free with the booking');
        if (kind === 'free_items') return freeBuild(a, ctx, was);
        if (a.amount === undefined && !was) {
          const e = new ActionError('ask the owner how much the deal is'); e.ask = { param: 'amount', question: kind === 'free_minutes' ? 'How many minutes free? (30, 60 ...)' : kind === 'percent' ? 'How many percent off?' : 'How many dollars off?', parse: kind === 'off' ? 'money' : 'number' }; throw e;
        }
        const value = a.amount === undefined ? was.value : kind === 'off' ? Math.round(a.amount * 100) : Math.round(a.amount);
        const days = a.days !== undefined ? (normDays(a.days) || []) : (was ? String(was.days || '').split(',').filter(Boolean) : []);
        const body = { id: was ? was.id : undefined, name: a.name || (was && was.name), kind, value, min_minutes: a.book_at_least_hours !== undefined ? Math.round(a.book_at_least_hours * 2) * 30 : (was ? was.min_minutes : 0),
          days: days.length === 7 ? [] : days, start_from: a.start_from !== undefined ? a.start_from : (was ? was.start_from : ''), start_until: a.start_until !== undefined ? a.start_until : (was ? was.start_until : ''),
          date_from: a.first_day !== undefined ? a.first_day : (was ? was.date_from : ''), date_to: a.last_day !== undefined ? a.last_day : (was ? was.date_to : ''),
          words: a.words !== undefined ? a.words : (was ? was.words : ''), show_online: a.show_on_booking_page !== undefined ? a.show_on_booking_page : (was ? !!was.show_online : true), active: a.on !== undefined ? a.on : (was ? !!was.active : true) };
        if (!was) body.name = shortName(body, ctx);
        if (!body.name) throw new ActionError('say the deal\'s name');
        // (the last minutes free with no booking said would make a booking that short free - the research, Oct 23 2026; asked)
        if (kind === 'free_minutes' && !body.min_minutes) { const e = new ActionError('ask the owner how long the booking must be'); e.ask = { param: 'book_at_least_hours', question: `How long must the booking be to get the last ${lenWords(value)} free? (like 2 hours)`, parse: 'hours' }; throw e; }
        if (kind === 'free_minutes' && (value % 30 || !value)) throw new ActionError('the minutes free are on the half hour (30, 60 ...)');
        if (kind === 'free_minutes' && body.min_minutes && value >= body.min_minutes) throw new ActionError('the minutes free must be fewer than the booking it needs');
        return { op: 'http', method: 'POST', path: '/api/pricing/deals', body };
      },
      // (a deal of that name there already is never made again - a second "Tuesday Buy an Hour, Get an Hour" beside the first; changing it
      // or keeping both is the model's to ask - Oct 27 2026, as the counter's specials)
      read: (words, conv, ctx) => { const r = dealRead(words, conv, ctx); return r && dealsOf(ctx || {}).some(d => String(d.name || '').trim().toLowerCase() === String(r.name).toLowerCase()) ? null : r; },
      describe: (a, ctx) => {
        const b = actions.find(x => x.name === 'deal_set').build(a, ctx).body;
        if (b.kind === 'free_items') return freeSay(b, ctx);
        const lw = require('../../deals').words(Object.assign({}, b, { days: (b.days || []).join(',') }));
        const mins = b.min_minutes || 60, full = per30(ctx) * (mins / 30), off = b.kind === 'percent' ? Math.round(full * b.value / 100) : b.kind === 'off' ? Math.min(full, b.value) : per30(ctx) * Math.round(b.value / 30);
        return `${b.id ? 'Change the booking deal' : 'New booking deal'} "${b.name}": ${lw}.${per30(ctx) ? ` At your standard rate, ${lenWords(mins)}${(b.days || []).length ? ' on ' + daysSay(b.days) : ''}: ${money(full)} becomes ${money(Math.max(0, full - off))}.` : ''} Taken off on its own - no code - on the booking page, at checkout and at the counter; never with another deal (a discount code the customer types comes off after it).${b.active ? '' : ' (Off for now.)'}`;
      } },
    { name: 'deal_remove', area: 'money', kind: 'write', confirm: true, needs: ['deals'],
      say: 'Take a booking deal off for good (bookings already made keep the price they were charged)',
      params: { type: 'object', properties: { deal: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['deal'] },
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: '/api/pricing/deals/' + encodeURIComponent(findDeal(ctx, a.deal).id) }),
      describe: (a, ctx) => { const d = findDeal(ctx, a.deal); return `Take the booking deal "${d.name}" off (${d.words || d.words_auto}): bookings are priced as usual from now on; ones already made keep their price.`; } },

    { name: 'package_set', area: 'money', kind: 'write', confirm: true, needs: ['packages', 'menu', 'taxSettings', 'opsConfig'],
      say: 'Make a package deal - bay time and what comes with it at one price: "2 hours and a pitcher for $60", "birthday party: 2 hours, a pizza and 2 drinks each, $25 a person, 6 to 10 people", "corporate: 3 hours, $40 a person" - or change one (package: its name now). Its price and its tax only as the owner said them - otherwise call without them and the box asks',
      params: { type: 'object', properties: {
        name: { type: 'string', minLength: 2, maxLength: 60 }, package: { type: 'string', maxLength: 60, description: 'to change a package that is there already: its name now' },
        words: { type: 'string', maxLength: 300, description: 'what customers read about it' },
        hours: { type: 'number', minimum: 0.5, maximum: 4, description: 'its bay time in hours (0.5 to 4)' },
        price: { type: 'number', minimum: 0, maximum: 10000, description: 'the price in dollars - or a person\'s, when per_person' },
        per_person: { type: 'boolean', description: 'true when the price is a person\'s' },
        min_players: { type: 'integer', minimum: 1, maximum: 100 }, max_players: { type: 'integer', minimum: 0, maximum: 100 },
        includes: { type: 'array', maxItems: 12, items: { type: 'object', properties: { what: { type: 'string', description: 'a menu item by name, or a part of the menu ("beer" for any beer)' }, qty: { type: 'integer', minimum: 1, maximum: 100 }, per_person: { type: 'boolean' } }, required: ['what'] } },
        days: { type: 'string', description: 'its days (left out: every day)', 'x-days': true },
        start_from: Object.assign({}, TIME, { description: 'the earliest start (HH:MM)' }), start_until: Object.assign({}, TIME, { description: 'the latest start (HH:MM)' }),
        first_day: Object.assign({}, DATE, { description: 'its first day, when seasonal' }), last_day: Object.assign({}, DATE, { description: 'its last day' }),
        tax: { type: 'string', maxLength: 40, description: '"booking" (the bookings\' rate), a counter tax code\'s name (like "Beverage"), or "split:<code name>" (the golf part as a booking, the rest at that code) - only as the owner said it' },
        golf_part: { type: 'number', minimum: 0, maximum: 10000, description: 'split: the golf part of the price in dollars (a person\'s, when per_person)' },
        sell_online: { type: 'boolean' }, on: { type: 'boolean' } } },
      // money asked, never guessed: a price or a tax the owner did not say is the box's question; hours and days never said, left off
      unsaid: { start_from: (v, w) => TIMES_SAID.test(w), start_until: (v, w) => TIMES_SAID.test(w), first_day: (v, w) => DATES_SAID.test(w), last_day: (v, w) => DATES_SAID.test(w), price: (v, w) => H.moneySaid(v, w), golf_part: (v, w) => H.moneySaid(v, w), tax: (v, w, ctx) => /\btax(?:ed|es)?\b|\bas a booking\b|\bsplit\b/i.test(w) || codes(ctx).some(c => w.toLowerCase().includes(String(c.name).toLowerCase())) },
      build: (a, ctx) => {
        // a customer booked ON a package is a booking, not a change to the package (Oct 22 2026, the 4B on the laptop: "book Pat Lee
        // on the party package" was put up as the package again, its price asked)
        if (/\b[Bb]ook\s+(?:[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?|him|her|them|someone|a customer|a walk-?in)\s+(?:on|for|in(?:to)?)\b/.test(String(ctx.newest || '')) && pkgsOf(ctx).length)
          throw new ActionError('the owner asked to book a customer on a package, not to change the package - use booking_make with package (its name) and players');
        const was = a.package ? findPkg(ctx, a.package) : null;
        if (a.price === undefined && !was) { const e = new ActionError('ask the owner the package\'s price'); e.ask = { param: 'price', question: `What does the ${a.name || 'package'} cost${a.per_person ? ' a person' : ''}?`, parse: 'money' }; throw e; }
        if (a.tax === undefined && !was) {
          const e = new ActionError('ask the owner how the package is taxed');
          const ch = [`All of it as a booking (${bookingsRate(ctx)}%)`].concat(codes(ctx).map(c => `All of it as ${c.name} (${c.rate}%)`)).concat(codes(ctx).slice(0, 2).map(c => `Split: the golf as a booking, the rest as ${c.name}`));
          e.ask = { param: 'tax', question: `How is the ${a.name || 'package'} taxed? It is yours to say.`, choices: ch, values: ['booking'].concat(codes(ctx).map(c => c.name)).concat(codes(ctx).slice(0, 2).map(c => 'split:' + c.name)) };
          throw e;
        }
        const tx = a.tax !== undefined ? taxOf(ctx, a.tax) : { tax_mode: was.tax_mode, tax_code: was.tax_code };
        if (tx.tax_mode === 'split' && a.golf_part === undefined && !(was && was.golf_cents)) { const e = new ActionError('ask the owner the golf part of the price'); e.ask = { param: 'golf_part', question: `What part of the ${a.price !== undefined ? '$' + a.price : 'price'}${a.per_person ? ' a person' : ''} is the golf (taxed as a booking)?`, parse: 'money' }; throw e; }
        if (a.includes && a.includes.length && (((ctx.opsConfig || {}).pos) || {}).fnb === false) throw new ActionError('this facility has no food and drink at the counter (Settings > Staff > The Counter) - say so to the owner: a package here is bay time only, unless they switch food and drink on first');
        const inc = a.includes !== undefined ? a.includes.map(x => includeOf(ctx, x)) : (was ? was.includes_list : []);
        const days = a.days !== undefined ? (normDays(a.days) || []) : (was ? String(was.days || '').split(',').filter(Boolean) : []);
        const body = { id: was ? was.id : undefined, name: a.name || (was && was.name), words: a.words !== undefined ? a.words : (was ? was.words : ''),
          minutes: a.hours !== undefined ? Math.round(a.hours * 2) * 30 : (was ? was.minutes : 120),
          price_type: a.per_person !== undefined ? (a.per_person ? 'per_person' : 'flat') : (was ? was.price_type : 'flat'),
          price_cents: a.price !== undefined ? Math.round(a.price * 100) : was.price_cents,
          min_players: a.min_players !== undefined ? a.min_players : (was ? was.min_players : 1), max_players: a.max_players !== undefined ? a.max_players : (was ? was.max_players : 0),
          includes: inc.map(x => ({ kind: x.kind, id: x.id, qty: x.qty, per_person: !!x.per_person })), days: days.length === 7 ? [] : days,
          start_from: a.start_from !== undefined ? a.start_from : (was ? was.start_from : ''), start_until: a.start_until !== undefined ? a.start_until : (was ? was.start_until : ''),
          date_from: a.first_day !== undefined ? a.first_day : (was ? was.date_from : ''), date_to: a.last_day !== undefined ? a.last_day : (was ? was.date_to : ''),
          tax_mode: tx.tax_mode, tax_code: tx.tax_code, golf_cents: tx.tax_mode === 'split' ? Math.round((a.golf_part !== undefined ? a.golf_part * 100 : was.golf_cents)) : 0,
          sell_online: a.sell_online !== undefined ? a.sell_online : (was ? !!was.sell_online : true), active: a.on !== undefined ? a.on : (was ? !!was.active : true) };
        if (!body.name) throw new ActionError('say the package\'s name');
        if (!(body.minutes >= 30 && body.minutes <= 240)) throw new ActionError('its bay time is half an hour to 4 hours');
        if (body.tax_mode === 'split' && body.golf_cents > body.price_cents) throw new ActionError('the golf part is more than the price');
        if (body.max_players && body.max_players < body.min_players) throw new ActionError('the most players is less than the least');
        return { op: 'http', method: 'POST', path: '/api/pricing/packages', body };
      },
      describe: (a, ctx) => {
        const b = actions.find(x => x.name === 'package_set').build(a, ctx).body;
        const inc = (a.includes !== undefined ? a.includes.map(x => includeOf(ctx, x)) : []).map(x => `${x.qty} ${x.name}${x.per_person ? ' a person' : ''}`);
        const incSay = a.includes !== undefined ? (inc.length ? 'includes ' + andList(inc) : 'bay time only') : (b.id ? 'what it includes as before' : 'bay time only');
        const price = b.price_type === 'per_person' ? `${money(b.price_cents)} a person (${b.min_players}${b.max_players ? ' to ' + b.max_players : ' or more'} players)` : `${money(b.price_cents)}${b.max_players ? ` for up to ${b.max_players} players` : ''}`;
        const when = [daysSay(b.days), b.start_from || b.start_until ? `starting ${b.start_from ? timeWords(b.start_from) : 'any time'} - ${b.start_until ? timeWords(b.start_until) : 'any time'}` : '', b.date_from || b.date_to ? `${b.date_from ? dayWords(b.date_from) : 'now'} to ${b.date_to ? dayWords(b.date_to) : 'on'}` : ''].filter(Boolean).join(', ');
        const style = String((((ctx.opsConfig || {}).booking) || {}).accessStyle || '').toLowerCase();
        const served = b.includes.length && /unmanned|hybrid/.test(style) ? ` What it includes is served at the counter - offer it on days someone is there${style === 'unmanned' ? ' (this facility is set up as unstaffed)' : ''}.` : '';
        return `${b.id ? 'Change the package' : 'New package'} "${b.name}": ${lenWords(b.minutes)} of bay time, ${price}, ${incSay}; ${when}; ${taxSay(ctx, b)}. ${packageMoney(ctx, b)}. ${b.sell_online ? 'Sold on your booking page, paid in full when booked' : 'Not sold online'}${b.includes.length ? '; at the counter what it includes rings up at $0 on that booking' : ''}.${served}${b.active ? '' : ' (Off for now.)'}`;
      } },
    // the packages on the website, live (Oct 22 2026): a Cards section whose source is the package deals, each card with its Book button
    // - the one plain tool for it (the 4B could not find its way through the website's section tool to it)
    { name: 'packages_on_website', area: 'website', kind: 'write', confirm: false, needs: ['website', 'packages'],
      say: 'Show the package deals on the website, live - each package on sale as a card with its price, what it includes and when, and a Book button that opens the booking page with it picked ("show our packages on the website")',
      params: { type: 'object', properties: { at: { type: 'string', enum: ['top', 'bottom'], description: 'top = right after the top of the page; bottom (the usual) = near the end' }, title: { type: 'string', maxLength: 80, description: 'its heading (left out: "Package deals")' } } },
      build: (a, ctx) => {
        if (!pkgsOf(ctx).some(p => p.active && p.sell_online)) throw new ActionError('there is no package on sale online yet - make one first, then it shows');
        const L = require('../../../public/site-layout.js'), edit = { do: 'add', type: 'cards', fields: { kicker: 'Book a package', title: a.title || 'Package deals', source: 'packages', items: [] }, at: a.at || 'bottom' };
        try { L.applyEdit(ctx.website || {}, edit); } catch (e) { throw new ActionError(String(e.message || e)); }
        return { op: 'layout', edit };
      },
      describe: (a, ctx) => `Show your package deals on the website, live${a.at === 'top' ? ' right after the top of the page' : ' near the end of the homepage'}: ${andList(pkgsOf(ctx).filter(p => p.active && p.sell_online).map(p => p.name))} - each a card with its Book button.` },
    { name: 'package_remove', area: 'money', kind: 'write', confirm: true, needs: ['packages'],
      say: 'Take a package deal off for good (bookings already made keep it, as they bought it)',
      params: { type: 'object', properties: { package: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['package'] },
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: '/api/pricing/packages/' + encodeURIComponent(findPkg(ctx, a.package).id) }),
      describe: (a, ctx) => { const p = findPkg(ctx, a.package); return `Take the package "${p.name}" off (${p.price_words}): it is no longer sold; bookings already made keep it, as they bought it.`; } },
  ];
  return { actions, loaders };
};
