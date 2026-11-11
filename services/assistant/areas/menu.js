// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/menu.js - THE ONE MENU, BY TALKING (Oct 20 2026, night)
// Built with the helpers services/assistant/actions.js hands every area (HELPERS); same rules as the actions there.
//
// maintainer: "add a new beer for $5 called ale ipa. and it will ad the new beer to the beer menu. then they owner can make
// different sub menuys like food drink wine beer burgers, pizza etc. and then add things to it all with AI and see it get
// built out and how it looks for the server". The menu is the counter's own (services/pos.js menu_categories and
// menu_items): what a server rings up on the staff pad, and what the website's menu section shows live (public/
// site-layout.js menu source 'counter') - typed once (rule 2). Its categories are the sub-menus. Every action here is a
// request Admin's Point of Sale menu builder makes, to the same route (routes/pos.js:29-62), so the route's own checks
// apply. A price is what a customer pays, so adding, changing or taking off an item is said back first; sold out (86) is
// the staff's own everyday switch and goes straight in. A new category's tax is the owner's to say - never guessed; where
// its tickets print is read from its name (drinks at the bar, the rest in the kitchen) and said on the card.
'use strict';
const crypto = require('crypto');

module.exports = (H) => {
  const { ActionError } = H;
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const money = (c) => '$' + ((c | 0) % 100 ? ((c | 0) / 100).toFixed(2) : String((c | 0) / 100));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const andList = (l) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);
  // a name as a menu shows it: "ale ipa" -> "Ale IPA", words already capitalised kept as typed
  const SMALL = new Set(['a', 'an', 'and', 'of', 'the', 'with', 'or', 'on', 'in']);
  const titled = (s) => { const t = String(s || '').trim().replace(/\s+/g, ' '); if (t !== t.toLowerCase()) return t; return t.split(' ').map((w, i) => (/^(ipa|bbq|blt|pb|nyc)$/.test(w) ? w.toUpperCase() : (i && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' '); };
  function centsOf(p, what) {
    const n = Number(String(p == null ? '' : p).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 10000) throw new ActionError(`${what} needs a price, like 5 or 5.50`);
    return Math.round(n * 100);
  }
  // one of a list by the owner's words: the exact name, else the one that starts with them, else the one that holds them;
  // two that match is a question, never a guess
  function pick(list, ref, what, nameOf) {
    const n = norm(ref).replace(/s$/, '');
    if (!n) throw new ActionError(`say which ${what}`);
    const name = (x) => norm(nameOf(x)), single = (x) => name(x).replace(/s$/, '');
    for (const test of [(x) => name(x) === norm(ref) || single(x) === n, (x) => name(x).startsWith(n), (x) => name(x).includes(n)]) {
      const hit = list.filter(test);
      if (hit.length === 1) return hit[0];
      if (hit.length > 1) throw new ActionError(`more than one ${what} matches "${ref}": ${andList(hit.map(x => `"${nameOf(x)}"`))} - say which`);
    }
    return null;
  }
  const DRINK = /\b(beers?|wines?|drinks?|cocktails?|spirits|liquor|bar|taps?|draft|drafts|seltzers?|shots?|ciders?|bourbons?|whiske?ys?|vodkas?|tequilas?|rums?|gins?|sodas?|pops?|coffees?|teas?|beverages?|mocktails?|brews?)\b/i;
  const cats = (ctx) => ((ctx.menu || {}).cats || []);
  const taxes = (ctx) => ((ctx.menu || {}).taxes || []).filter(t => t.id !== 'sim');   // the golf line's own code is never a menu category's
  // Stripe Tax works the counter's tax out from the venue's address: a code's own rate is then only the fallback
  const stripeTaxOn = (ctx) => !!(ctx.taxSettings && ctx.taxSettings.stripeTax);
  const moneySaid = H.moneySaid;
  const taxSay = (t) => `${t.name} (${Number(t.rate) || 0}%)`;
  function findTax(ctx, ref) {
    const list = taxes(ctx);
    // (as the box itself words a tax - "Prepared food (0%)" - or with "tax" after it: the 4B gave back the box's own words, Oct 22 2026)
    ref = String(ref || '').replace(/\s*\(\s*[\d.]+\s*%\s*\)\s*$/, '').replace(/\s+tax$/i, '').trim() || ref;
    const t = list.find(x => norm(x.id) === norm(ref)) || list.find(x => norm(x.name) === norm(ref)) || pick(list, ref, 'tax', (x) => x.name);
    if (!t) throw new ActionError(`"${ref}" is not one of this facility's taxes: ${andList(list.map(taxSay))}`);
    return t;
  }
  // the item by its name, in a category when the owner names one (two of the same name in two categories is a question)
  // A NAME THAT LOOKS LIKE ONE ON THE MENU, SAID ON THE CARD (the walk in maintainer's typing, Oct 23 2026: "add bud lite 5 bucks to the
  // beer" put a second beer beside Bud Light): the same letters once "lite" is "light", spaces, marks and a plural are set aside -
  // the owner taps No if it is the same thing
  const soundKey = (n) => norm(n).replace(/\blite\b/g, 'light').replace(/\bnite\b/g, 'night').replace(/\b(\w+?)s\b/g, '$1').replace(/[^a-z0-9]/g, '');
  function twinNote(ctx, items) {
    const all = cats(ctx).flatMap(c => (c.items || []).map(i => Object.assign({ part: c.name }, i)));
    const notes = (items || []).map(x => { const k = soundKey(x.name), t = all.find(i => soundKey(i.name) === k && norm(i.name) !== norm(x.name)); return t ? `${t.name} (${money(t.price_cents)}, under ${t.part})` : null; }).filter(Boolean);
    return notes.length ? ` You already have ${andList(notes)} - if that is the same thing, tap No and nothing is added.` : '';
  }
  function findItem(ctx, ref, catRef) {
    const inCat = catRef ? pick(cats(ctx), catRef, 'part of the menu', (c) => c.name) : null;
    if (catRef && !inCat) throw new ActionError(`there is no "${catRef}" on the menu`);
    const all = (inCat ? [inCat] : cats(ctx)).flatMap(c => (c.items || []).map(i => Object.assign({}, i, { cat: c })));
    const it = pick(all, ref, 'item', (i) => i.name);
    if (!it) throw new ActionError(`"${ref}" is not on the menu${inCat ? ` under ${inCat.name}` : ''}`);
    return it;
  }
  // an item's choice group as it will be saved: the group of that name changed in place (its choices kept by name, a new
  // price laid over), or a new one; or what is taken off
  function choicePlan(ctx, a) {
    const it = findItem(ctx, a.item, a.part), groups = it.choiceGroups || [];
    const g = groups.find(x => norm(x.name) === norm(a.group)) || null;
    if (a.remove_group) { if (!g) throw new ActionError(`${it.name} has no "${a.group}" choices`); return { it, g, removeGroup: g.id }; }
    if (a.remove) {
      if (!g) throw new ActionError(`${it.name} has no "${a.group}" choices`);
      const ch = (g.choices || []).find(x => norm(x.name) === norm(a.remove));
      if (!ch) throw new ActionError(`"${a.remove}" is not one of ${it.name}'s ${g.name}: ${andList((g.choices || []).map(x => x.name))}`);
      return { it, g, removeChoice: ch.id };
    }
    if (!Array.isArray(a.choices) || !a.choices.length) throw new ActionError(`say the choices for ${it.name}'s ${titled(a.group)}, like "bacon $2, cheese $1"`);
    const have = (g && g.choices) || [];
    const merged = have.map(x => ({ id: x.id, name: x.name, delta_cents: x.delta_cents | 0, is_default: !!x.is_default, sort: x.sort | 0 }));
    a.choices.forEach((x) => {
      const name = titled(x.name).slice(0, 60), cents = x.adds !== undefined ? centsOf(x.adds, `"${name}"`) : 0;
      const old = merged.find(m => norm(m.name) === norm(name));
      if (old) old.delta_cents = cents; else merged.push({ name, delta_cents: cents, is_default: false, sort: merged.length + 1 });
    });
    if (merged.length > 20) throw new ActionError('a group holds 20 choices at most');
    return { it, g, group: { id: g ? g.id : undefined, name: g ? g.name : titled(a.group).slice(0, 60), required: a.must_pick !== undefined ? !!a.must_pick : !!(g && g.required), sort: g ? g.sort | 0 : groups.length + 1, choices: merged } };
  }
  // a whole item's save, as the menu builder sends it: what it is now, with the changes laid over
  const itemBody = (it, set) => Object.assign({ id: it.id, category_id: it.category_id, name: it.name, price_cents: it.price_cents | 0,
    printer_role: it.printer_role || null, tax_category: it.tax_category || null, active: it.active !== 0, sort: it.sort | 0 }, set || {});
  const catBody = (c, set) => Object.assign({ id: c.id, name: c.name, sort: c.sort | 0, printer_role: c.printer_role || 'kitchen', tax_category: c.tax_category || 'food', active: c.active !== 0 }, set || {});
  const nextSort = (list) => (list || []).reduce((m, x) => Math.max(m, x.sort | 0), 0) + 1;
  // does the website show the counter's menu? (the card says so - or offers to)
  const liveOnSite = (ctx) => { try { const L = require('../../../public/site-layout.js'); return L.defaultLayout(ctx.website || {}).some(b => b.type === 'menu' && b.source === 'counter' && b.on !== false); } catch { return false; } };
  const siteNote = (ctx) => (liveOnSite(ctx) ? ' Your website\'s menu shows it at once.' : ' (Your website does not show the menu yet - say "show our menu on the website" and it will, live.)');

  const loaders = {
    // the counter's whole menu (what is switched off too, to find it) and the facility's tax codes
    menu: async (ctx) => {
      try {
        const [m, t] = await Promise.all([ctx.call('GET', '/api/pos/menu?all=1'), ctx.call('GET', '/api/pos/tax-codes')]);
        return { cats: (m.json && m.json.menu) || [], taxes: (t.json && t.json.codes) || [] };
      } catch { return { cats: [], taxes: [] }; }
    },
  };

  const ITEMS = { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: {
    name: { type: 'string', minLength: 1, maxLength: 80, description: 'the item as the menu shows it' },
    price: { type: 'number', minimum: 0, maximum: 10000, description: 'dollars, like 5 or 5.5' },
    words: { type: 'string', maxLength: 300, description: 'a line about it, if the owner gave one' } }, required: ['name', 'price'] },
    description: 'one or more items, each with its price' };

  const actions = [
    // (the website too: without it liveOnSite never saw the real layout, and the box said "It is not on your website yet" with the menu
    // live on the site - its advice then made a second menu section: the review, Oct 27 2026)
    { name: 'menu_read', kind: 'read', needs: ['menu', 'website'], say: 'Look at the food and drink menu - the counter\'s, which the servers ring up and the website shows: its parts (Food, Beer, Wine...), each item with its price, what is sold out, and the facility\'s taxes for a new part',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => ({
        menu: cats(ctx).map(c => Object.assign({ part: c.name, items: (c.items || []).map(i => Object.assign({ item: i.name, price: money(i.price_cents) }, i.description ? { words: i.description } : {}, i.eighty_sixed ? { sold_out: true } : {}, i.active === 0 ? { switched_off: true } : {})) },
          c.active === 0 ? { switched_off: true } : {}, { prints_at: c.printer_role === 'bar' ? 'the bar' : 'the kitchen' })),
        taxes_for_a_new_part: taxes(ctx).map(taxSay),
        on_the_website: liveOnSite(ctx) ? 'yes - the website\'s menu section shows it live' : 'no - offer to show it (website_section_add kind menu, menu_source counter)',
      }) },
    { name: 'menu_items_add', kind: 'write', confirm: true, needs: ['menu', 'website', 'taxSettings'],
      say: 'Add items to the menu - one or many, into one part of it (Beer, Food, Wine, Burgers, Pizza...); a part that is not there yet is made. The servers ring them up and the website\'s menu shows them. A NEW part needs its tax: give it only when the owner said it - otherwise call without it and the box asks the owner which of the facility\'s taxes it uses (never guess). Items of different kinds (drinks and food) go in their own parts, one call each',
      params: { type: 'object', properties: {
        part: { type: 'string', minLength: 1, maxLength: 60, description: 'the part of the menu: Beer, Food, Wine, Burgers...' },
        items: ITEMS,
        tax: { type: 'string', maxLength: 40, description: 'a NEW part only: which of the facility\'s taxes it uses, as the owner said' },
        prints_at: { type: 'string', enum: ['kitchen', 'bar'], description: 'a NEW part only: where its tickets print, when the owner said' },
        tax_rate: { type: 'number', minimum: 0, maximum: 30, description: 'a NEW part only: the percent its tax charges, when the owner said it' } }, required: ['part', 'items'] },
      // a tax the owner never named is the box's question, never the model's guess (Oct 22 2026, the owner's second day: the 4B gave
      // "standard", then the box's own words for a tax back, until it ran out of rounds) - engine.js, WHAT THE OWNER NEVER SAID
      // (the tax said is THAT tax, by its name - "Beverage tax" said for the beers is not the food's: the 4B's guess for Food passed on
      // it, Oct 22 2026)
      // (and not by the part's own name: "add Wings to Food" names the part, not the Prepared food tax)
      unsaid: { tax: (v, w, ctx, a) => { let t = null; try { t = findTax(ctx, v); } catch { return false; }
          const part = String((a && a.part) || '').trim().toLowerCase(), ofPart = (b) => b.name === 'menu_items_add' && b.param === 'tax' && String((b.args || {}).part || '').trim().toLowerCase() === part;
          // (the owner's own answer to the box's question for THIS part is said, whatever its words)
          if ((ctx.boxAnswers || []).some(b => { try { return ofPart(b) && findTax(ctx, b.value).id === t.id; } catch { return false; } })) return true;
          let lw = String(w || '').toLowerCase();
          // (an answer the owner gave the box for ANOTHER part's tax is that part's: "Beverage tax" for the beers is not the food's)
          for (const b of ctx.boxAnswers || []) if (b.name === 'menu_items_add' && b.param === 'tax' && String((b.args || {}).part || '').trim().toLowerCase() !== part && String(b.said || '').trim()) lw = lw.split(String(b.said).trim().toLowerCase()).join(' ');
          // (and a word that is only the part's own name is not its tax: "add Wings to Food" names the part, not the food tax -
          // "Prepared food tax" names the tax)
          const nm = String(t.name || '').toLowerCase(), bare = nm.replace(/\s+tax$/, ''), id = String(t.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
          const same = (x) => x === part || x === part.replace(/s$/, '');
          return (!!nm && !same(nm) && lw.includes(nm)) || (bare.length > 2 && !same(bare) && lw.includes(bare)) || (!!id && !same(id) && new RegExp('\\b' + id + '\\b').test(lw)); },
        tax_rate: (v, w) => new RegExp('(?:^|[^\\d.])' + String(Number(v)).replace('.', '\\.') + '\\s*(?:%|percent)', 'i').test(w) || (Number(v) === 0 && /\bno tax\b/i.test(w)) },
      // MONEY AND TAX ARE ASKED AND SHOWN, NEVER GUESSED (maintainer, Oct 22 2026: "be very very cautious on all things requiring tax and
      // money and make sure it asks and verifies ... the first setup can make sure it askes for the tax rate or what tax rate is
      // this"; "if someone puts beer and they have a beer secion already it can join that obviously"). One question at a time,
      // asked by the box with the answers to tap: an item's price nobody said; where the items go when the model would start a
      // part the owner never named beside the parts there are; a new part's tax (each with its rate now); and that tax's rate
      // when it is still 0% (unless Stripe Tax works it out). A part that is there is joined, and its tax is on the card.
      build: (a, ctx) => {
        const heard = String(ctx.heard || ctx.newest || '');
        a.items.forEach((x, i) => {
          if (moneySaid(x.price, heard)) return;
          const e = new ActionError(`the owner did not say what ${titled(x.name)} costs - ask them`);
          e.ask = { param: `items.${i}.price`, question: `What does ${titled(x.name)} cost?`, parse: 'money' };
          throw e;
        });
        const items = a.items.map(x => ({ name: titled(x.name).slice(0, 80), price_cents: centsOf(x.price, `"${x.name}"`), description: String(x.words || '').trim().slice(0, 300) }));
        const cat = pick(cats(ctx), a.part, 'part of the menu', (c) => c.name);
        // (only when a part of the same kind is there - a new Drinks beside Beer is asked, a new Food beside Beer is not; the 4B's
        // first menu - beers and then food - was asked whether the wings went under Beer, Oct 22 2026)
        const kindOf = (name, list) => DRINK.test(name || '') || (list && list.length && list.every(n => DRINK.test(n || ''))) ? 'drink' : 'food';
        const newKind = kindOf(a.part, a.items.map(x => x.name)), sameKind = cats(ctx).filter(c => c.active !== 0 && kindOf(c.name, (c.items || []).map(i => i.name)) === newKind);
        if (!cat && sameKind.length && !heard.toLowerCase().includes(norm(a.part))) {
          const e = new ActionError(`the owner did not say where these go - ask them`);
          const there = sameKind.map(c => c.name).slice(0, 5);
          e.ask = { param: 'part', question: `Where on the menu do ${andList(a.items.map(x => titled(x.name)))} go?`, choices: there.concat([`A new part: ${titled(a.part)}`]), values: there.concat([titled(a.part)]) };
          throw e;
        }
        if (cat) {
          for (const it of items) { const twin = (cat.items || []).find(i => norm(i.name) === norm(it.name)); if (twin) throw new ActionError(`"${twin.name}" is already under ${cat.name} at ${money(twin.price_cents)} - to change it, use menu_item_change`); }
          let sort = nextSort(cat.items);
          const steps = (cat.active === 0 ? [{ op: 'http', method: 'POST', path: '/api/pos/menu/category', body: catBody(cat, { active: true }) }] : [])
            .concat(items.map(it => ({ op: 'http', method: 'POST', path: '/api/pos/menu/item', body: Object.assign({ category_id: cat.id, sort: sort++ }, it) })));
          return steps.length === 1 ? steps[0] : { op: 'steps', steps };
        }
        if (!a.tax) {
          const e = new ActionError(`"${titled(a.part)}" is a new part of the menu - ask the owner which tax it uses (${andList(taxes(ctx).map(taxSay)) || 'the taxes are set in Settings > Food & Payments > Point of Sale - Tax Codes'}), then call this again with tax`);
          // the box asks the owner itself, the facility's taxes as the answers to tap (engine.js, A BOX-ASKED CHOICE)
          if (taxes(ctx).length) e.ask = { param: 'tax', question: `Which tax goes on ${titled(a.part)}, the new part of your menu (${andList(a.items.map(x => titled(x.name)))})? Your taxes now: ${andList(taxes(ctx).map(t => `${t.name} ${Number(t.rate) || 0}%`))}.`, choices: taxes(ctx).map(t => t.name) };
          throw e;
        }
        const tax = findTax(ctx, a.tax);
        if (!stripeTaxOn(ctx) && !(Number(tax.rate) > 0) && a.tax_rate === undefined) {
          const e = new ActionError(`${tax.name} is 0% now - ask the owner the rate`);
          e.ask = { param: 'tax_rate', question: `${tax.name} is 0% right now, so nothing on ${titled(a.part)} would be taxed. What rate do you charge on it? (the percent, like 7.5)`, choices: ['No tax on these - keep 0%'], values: [0], parse: 'percent' };
          throw e;
        }
        const id = crypto.randomUUID();
        const printer = a.prints_at || (DRINK.test(a.part) ? 'bar' : 'kitchen');
        let sort = 1;
        // the rate the owner gave goes on the tax code first - every code sent, as the Tax Codes card saves them (the golf line's too)
        const all = ((ctx.menu || {}).taxes || []);
        const rate = a.tax_rate !== undefined && Number(a.tax_rate) !== Number(tax.rate) ? [{ op: 'http', method: 'POST', path: '/api/pos/tax-codes', body: { codes: all.map(t => (t.id === tax.id ? Object.assign({}, t, { rate: Number(a.tax_rate) }) : t)) } }] : [];
        return { op: 'steps', steps: rate.concat([{ op: 'http', method: 'POST', path: '/api/pos/menu/category', body: { id, name: titled(a.part).slice(0, 60), sort: nextSort(cats(ctx)), printer_role: printer, tax_category: tax.id } }])
          .concat(items.map(it => ({ op: 'http', method: 'POST', path: '/api/pos/menu/item', body: Object.assign({ category_id: id, sort: sort++ }, it) }))) };
      },
      describe: (a, ctx) => {
        const cat = pick(cats(ctx), a.part, 'part of the menu', (c) => c.name);
        const list = andList(a.items.map(x => `${titled(x.name)} (${money(Math.round(Number(x.price) * 100))})`));
        if (cat) {
          // its tax on the card, and plainly when it charges nothing
          const ct = taxes(ctx).find(t => t.id === cat.tax_category);
          const tx = ct ? (stripeTaxOn(ctx) ? ` (taxed as ${ct.name} - Stripe Tax works it out)` : Number(ct.rate) > 0 ? ` (taxed as ${taxSay(ct)})` : ` (${cat.name} is taxed as ${ct.name} at 0% - nothing on it is taxed; say "set the ${ct.name} tax to 7%" to change it)`) : '';
          return `Add ${list} to ${cat.name} on your menu${tx}. Servers can ring ${a.items.length === 1 ? 'it' : 'them'} up at once.` + twinNote(ctx, a.items) + siteNote(ctx);
        }
        const tax = findTax(ctx, a.tax), printer = a.prints_at || (DRINK.test(a.part) ? 'bar' : 'kitchen');
        const changes = a.tax_rate !== undefined && Number(a.tax_rate) !== Number(tax.rate);
        const taxed = stripeTaxOn(ctx) ? `taxed as ${tax.name} (Stripe Tax works it out)` : changes ? `taxed as ${tax.name} at ${Number(a.tax_rate)}% - ${tax.name} goes from ${Number(tax.rate) || 0}% to ${Number(a.tax_rate)}% for everything taxed as ${tax.name}` : Number(tax.rate) > 0 ? `taxed as ${taxSay(tax)}` : `taxed as ${tax.name} at 0% - no tax on these, as you said`;
        return `Make a new part of your menu, ${titled(a.part)} - ${taxed}, its tickets printing at the ${printer} - with ${list}.` + siteNote(ctx);
      } },
    { name: 'menu_item_change', kind: 'write', confirm: true, needs: ['menu', 'website'],
      say: 'Change an item on the menu: its price, its name, its line of words, or move it to another part - not for sold out or back on (that is menu_item_sold_out)',
      params: { type: 'object', properties: {
        item: { type: 'string', minLength: 1, maxLength: 80, description: 'the item as the owner names it' },
        part: { type: 'string', maxLength: 60, description: 'the part it is in, when two parts have one of that name' },
        price: { type: 'number', minimum: 0, maximum: 10000 }, name: { type: 'string', minLength: 1, maxLength: 80 }, words: { type: 'string', maxLength: 300 },
        move_to: { type: 'string', maxLength: 60, description: 'another part of the menu it moves to' },
        // (Oct 20 2026, late - the gap audit) kept but off the menu (a seasonal beer); its own tax; where its tickets print
        on_menu: { type: 'boolean', description: 'false takes it off the menu but keeps it (a seasonal item) - off every pad and the website until it is back on; sold out tonight is menu_item_sold_out' },
        tax: { type: 'string', maxLength: 60, description: 'its own tax, one of the facility\'s taxes by name - or "the part\'s" to use its part\'s again' },
        prints_at: { type: 'string', enum: ['bar', 'kitchen', 'the part\'s'], description: 'where its tickets print, when not where its part\'s do' } }, required: ['item'] },
      build: (a, ctx) => {
        const it = findItem(ctx, a.item, a.part), set = {};
        if (a.on_menu !== undefined) set.active = !!a.on_menu;
        if (a.tax !== undefined) set.tax_category = /^the part'?s?$|^its part'?s?$/i.test(String(a.tax).trim()) ? null : findTax(ctx, a.tax).id;
        if (a.prints_at !== undefined) set.printer_role = a.prints_at === 'bar' || a.prints_at === 'kitchen' ? a.prints_at : null;
        if (a.price !== undefined) set.price_cents = centsOf(a.price, `"${it.name}"`);
        if (a.name) set.name = titled(a.name).slice(0, 80);
        if (a.words !== undefined) set.description = String(a.words).trim().slice(0, 300);
        if (a.move_to) { const to = pick(cats(ctx), a.move_to, 'part of the menu', (c) => c.name); if (!to) throw new ActionError(`there is no "${a.move_to}" on the menu - add the item there with menu_items_add instead`); set.category_id = to.id; set.sort = nextSort(to.items); }
        if (!Object.keys(set).length) throw new ActionError('say what to change: its price, its name, its words, the part it moves to, whether it is on the menu, its tax or where it prints');
        return { op: 'http', method: 'POST', path: '/api/pos/menu/item', body: itemBody(it, set) };
      },
      describe: (a, ctx) => {
        const it = findItem(ctx, a.item, a.part), what = [];
        if (a.price !== undefined) what.push(`its price from ${money(it.price_cents)} to ${money(Math.round(Number(a.price) * 100))}`);
        if (a.name) what.push(`its name to "${titled(a.name)}"`);
        if (a.words !== undefined) what.push(a.words ? `its words to "${String(a.words).trim()}"` : 'its words taken off');
        if (a.move_to) what.push(`it moved to ${(pick(cats(ctx), a.move_to, 'part of the menu', (c) => c.name) || {}).name || a.move_to}`);
        if (a.on_menu === false) what.push('it off the menu for now (kept - off every pad and the website until it is back on)');
        if (a.on_menu === true) what.push('it back on the menu');
        if (a.tax !== undefined) what.push(/^the part'?s?$|^its part'?s?$/i.test(String(a.tax).trim()) ? `its tax back to its part's (${it.cat.name})` : `its own tax: ${taxSay(findTax(ctx, a.tax))}`);
        if (a.prints_at !== undefined) what.push(a.prints_at === 'bar' || a.prints_at === 'kitchen' ? `its tickets printing at the ${a.prints_at}` : `its tickets printing where its part's do`);
        return `Change ${it.name} (${it.cat.name}): ${andList(what)}.` + (a.price !== undefined ? ' Servers charge the new price from now on; a round already sent keeps its price.' : '');
      } },
    // CHOICES (Oct 20 2026, late - the gap audit: "bacon +$2"): a group of choices on an item - its name, whether one must be
    // picked, each choice with what it adds to the price (routes/pos.js:34, the same save as the menu builder's; a choice or a
    // group taken off is :48 / :53). A group of the same name is changed in place, its choices kept by name
    { name: 'menu_item_choices', kind: 'write', confirm: true, needs: ['menu'],
      say: 'Add or change an item\'s choices - a group like "Add-ons" or "Temperature", each choice with what it adds to the price (0 for none), and whether the server must pick one. Or take one choice, or a whole group, off',
      params: { type: 'object', properties: {
        item: { type: 'string', minLength: 1, maxLength: 80, description: 'the item as the owner names it' }, part: { type: 'string', maxLength: 60 },
        group: { type: 'string', minLength: 1, maxLength: 60, description: 'the group\'s name, like "Add-ons" or "Temperature"' },
        choices: { type: 'array', maxItems: 20, items: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 60 }, adds: { type: 'number', minimum: 0, maximum: 1000, description: 'what it adds to the price, in dollars' } }, required: ['name'] }, description: 'choices added to the group (one already there by that name gets the new price)' },
        must_pick: { type: 'boolean', description: 'the server must pick one before it can be sent (a burger\'s temperature)' },
        remove: { type: 'string', maxLength: 60, description: 'one choice taken off the group, by its name' },
        remove_group: { type: 'boolean', description: 'the whole group taken off the item' } }, required: ['item', 'group'] },
      build: (a, ctx) => {
        const c = choicePlan(ctx, a);
        if (c.removeGroup) return { op: 'http', method: 'DELETE', path: `/api/pos/menu/choice-group/${encodeURIComponent(c.removeGroup)}` };
        if (c.removeChoice) return { op: 'http', method: 'DELETE', path: `/api/pos/menu/choice/${encodeURIComponent(c.removeChoice)}` };
        return { op: 'http', method: 'POST', path: '/api/pos/menu/item', body: itemBody(c.it, { choiceGroups: [c.group] }) };
      },
      describe: (a, ctx) => {
        const c = choicePlan(ctx, a);
        if (c.removeGroup) return `Take the "${c.g.name}" choices off ${c.it.name}`;
        if (c.removeChoice) return `Take "${a.remove}" off ${c.it.name}'s ${c.g.name}`;
        return `${c.it.name}'s ${c.group.name}${c.group.required ? ' (the server must pick one)' : ''}: ${andList(c.group.choices.map(x => `${x.name}${x.delta_cents ? ' +' + money(x.delta_cents) : ''}`))}. Servers see them on the pad at once.`;
      } },
    { name: 'menu_item_remove', kind: 'write', confirm: true, needs: ['menu', 'website'],
      say: 'Take an item off the menu for good (past receipts keep it). For "we are out of it tonight", use menu_item_sold_out instead',
      params: { type: 'object', properties: { item: { type: 'string', minLength: 1, maxLength: 80 }, part: { type: 'string', maxLength: 60 } }, required: ['item'] },
      build: (a, ctx) => { const it = findItem(ctx, a.item, a.part); return { op: 'http', method: 'DELETE', path: '/api/pos/menu/item/' + encodeURIComponent(it.id) }; },
      describe: (a, ctx) => { const it = findItem(ctx, a.item, a.part); return `Take ${it.name} (${money(it.price_cents)}, ${it.cat.name}) off the menu for good. Past receipts keep it; servers can no longer ring it up.`; } },
    { name: 'menu_item_sold_out', kind: 'write', confirm: false, needs: ['menu', 'website'],
      say: 'Mark an item sold out for now (86 it) - greyed on every server\'s pad and off the website\'s menu - or back on again ("the wings are back", "the burgers are back on", "we have it again")',
      params: { type: 'object', properties: { item: { type: 'string', minLength: 1, maxLength: 80 }, part: { type: 'string', maxLength: 60 }, sold_out: { type: 'boolean' } }, required: ['item', 'sold_out'] },
      build: (a, ctx) => { const it = findItem(ctx, a.item, a.part); return { op: 'http', method: 'POST', path: '/api/pos/menu/item/' + encodeURIComponent(it.id) + '/86', body: { on: !!a.sold_out } }; },
      describe: (a, ctx) => { const it = findItem(ctx, a.item, a.part); return a.sold_out ? `Mark ${it.name} sold out - greyed on every pad and off your website's menu until you say it is back.` : `${it.name} is back on every pad and on your website's menu.`; } },
    { name: 'menu_part_change', kind: 'write', confirm: (a) => !!a.tax, needs: ['menu', 'website'],
      say: 'Change one part of the menu (Beer, Food...): rename it, put it before or after another part, where its tickets print, its tax (said back first), or switch it off (off the pads and the website) and on again',
      params: { type: 'object', properties: {
        part: { type: 'string', minLength: 1, maxLength: 60 }, rename: { type: 'string', minLength: 1, maxLength: 60 },
        before: { type: 'string', maxLength: 60, description: 'another part it goes before' }, after: { type: 'string', maxLength: 60, description: 'another part it goes after' },
        prints_at: { type: 'string', enum: ['kitchen', 'bar'] }, tax: { type: 'string', maxLength: 40 }, on: { type: 'boolean', description: 'false switches the part off' } }, required: ['part'] },
      build: (a, ctx) => {
        const c = pick(cats(ctx), a.part, 'part of the menu', (x) => x.name);
        if (!c) throw new ActionError(`there is no "${a.part}" on the menu`);
        const set = {};
        if (a.rename) set.name = titled(a.rename).slice(0, 60);
        if (a.prints_at) set.printer_role = a.prints_at;
        if (a.tax) set.tax_category = findTax(ctx, a.tax).id;
        if (a.on !== undefined) set.active = !!a.on;
        const steps = [];
        if (a.before || a.after) {
          // the parts in their order, this one taken out and put back where the owner said - each one's place saved
          const ref = pick(cats(ctx), a.before || a.after, 'part of the menu', (x) => x.name);
          if (!ref || ref.id === c.id) throw new ActionError(`there is no other part called "${a.before || a.after}"`);
          const order = cats(ctx).slice().sort((x, y) => (x.sort | 0) - (y.sort | 0) || String(x.name).localeCompare(y.name)).filter(x => x.id !== c.id);
          order.splice(order.indexOf(ref) + (a.after ? 1 : 0), 0, c);
          order.forEach((x, i) => { if (x.id === c.id) set.sort = i + 1; else if ((x.sort | 0) !== i + 1) steps.push({ op: 'http', method: 'POST', path: '/api/pos/menu/category', body: catBody(x, { sort: i + 1 }) }); });
        }
        if (!Object.keys(set).length) throw new ActionError('say what to change: a new name, before or after another part, where it prints, its tax, or on or off');
        steps.unshift({ op: 'http', method: 'POST', path: '/api/pos/menu/category', body: catBody(c, set) });
        return steps.length === 1 ? steps[0] : { op: 'steps', steps };
      },
      describe: (a, ctx) => {
        const c = pick(cats(ctx), a.part, 'part of the menu', (x) => x.name) || { name: a.part }, what = [];
        if (a.rename) what.push(`renamed "${titled(a.rename)}"`);
        if (a.before) what.push(`put before ${a.before}`); if (a.after) what.push(`put after ${a.after}`);
        if (a.prints_at) what.push(`its tickets printing at the ${a.prints_at}`);
        if (a.tax) what.push(`taxed as ${taxSay(findTax(ctx, a.tax))} from now on`);
        if (a.on !== undefined) what.push(a.on ? 'switched on again' : 'switched off - off every pad and the website');
        return `${c.name} on your menu: ${andList(what)}.`;
      } },
  ];

  // ── SPECIALS THAT REALLY CHANGE THE PRICE (Oct 22 2026; maintainer: "if they say tuesday special and an ammount off the beer needs to be
  //    that ammount off ... thoes were just examples"): the counter's own rule (services/specials.js, routes/pos.js /specials) -
  //    while it is on the pad rings the item up at the special's price, and the website's weekly specials show it, live.
  //    A price is what a customer pays: said back first ──
  loaders.menuSpecials = async (ctx) => { try { const r = await ctx.call('GET', '/api/pos/specials'); return (r.json && r.json.specials) || []; } catch { return []; } };
  const specialsOf = (ctx) => ctx.menuSpecials || [];
  const findSpecial = (ctx, ref) => { const sp = pick(specialsOf(ctx), ref, 'special', (x) => x.name); if (!sp) throw new ActionError(`there is no special called "${ref}"${specialsOf(ctx).length ? ' - the specials are ' + andList(specialsOf(ctx).map(x => `"${x.name}"`)) : ' yet'}`); return sp; };
  const siteShowsSpecials = (ctx) => { try { return require('../../../public/site-layout.js').defaultLayout(ctx.website || {}).some(b => b.type === 'specials' && b.on !== false && b.counter !== false); } catch { return false; } };
  const DAYS_SAY = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const whenSay = (body) => {
    const d = body.days || [], t = body.start_time && body.end_time ? `${H.timeWords(body.start_time)} - ${H.timeWords(body.end_time)}${body.end_time < body.start_time ? ' (past midnight)' : ''}` : body.start_time ? `from ${H.timeWords(body.start_time)}` : body.end_time ? `until ${H.timeWords(body.end_time)}` : 'all day';
    const days = body.date ? 'on ' + H.dayWords(body.date) + ' only' : !d.length || d.length === 7 ? 'every day' : d.join() === 'mon,tue,wed,thu,fri' ? 'weekdays' : d.join() === 'sat,sun' ? 'weekends' : 'every ' + andList(d.map(x => DAYS_SAY[x] || x));
    return `${days}, ${t}`;
  };
  // WHAT THE OWNER SAID, WHEN THE MODEL LEFT IT OUT (Oct 22 2026, the scored set on the laptop: "Thursday special: Chicken Tenders
  // for $8 all night" came without the item or its day, "$1 off every Draft Beer on Fridays" without the $1). Only what the
  // model left out, and only what the owner's newest words say plainly: a menu item or part by its whole name, weekday names,
  // "$1 off", "half off", "20% off", "for $8"
  function fromWords(a, ctx, was) {
    // (the owner's answer to the box's "Which hours?" is the hours and nothing else: the words read here are the request in hand as it was
    // asked. "tonight" to "Which hours - 9 AM to 11 AM, or 9 PM to 11 PM?" for "wings $2 off friday 9 to 11 at night" made the weekly Friday
    // special "on Wed, Oct 28 only" - Oct 27 2026, the review of round 2c; THE DAYS RULE, helpers.js)
    const hoursAsked = ctx.answeredParam ? [...ctx.answeredParam].filter(([, p]) => p === '*').map(([id]) => (ctx.answeredHeard && ctx.answeredHeard.get(id)) || '').filter(Boolean) : [];
    // (Oct 28 2026, round 2e: a call the model made after the owner's answer is read against THE REQUEST IN HAND (engine.js requestInHand)
    // less the owner's answers to the box's own "Which hours?" - "nachos $2 off friday 9 to 11 at night", then "tonight till close" handed to the
    // model, made the weekly Friday special "on Wed, Oct 28 only": the answer alone was read)
    const t = String((hoursAsked.length ? hoursAsked.join('\n') : (ctx.inHand && ctx.inHand.days) || ctx.newest) || ''), lt = t.toLowerCase(), out = Object.assign({}, a);
    const whole = (name) => { const n = norm(name); return n.length > 2 && new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b').test(lt); };
    if (!was && !(out.items || []).length && !(out.parts || []).length && !out.covers) {
      const items = cats(ctx).flatMap(c => c.items || []).filter(i => whole(i.name)).map(i => i.name);
      const parts = cats(ctx).filter(c => whole(c.name) && !items.length).map(c => c.name);
      if (items.length) out.items = items; else if (parts.length) out.parts = parts;
      else if (/\b(?:every|all|any) (?:drinks?|beverages?)\b/.test(lt)) out.covers = 'drinks';
      else if (/\b(?:all|any) (?:the )?food\b/.test(lt)) out.covers = 'food';
    }
    // ONE DAY, AS SAID (Oct 22 2026, the owner's second day: "Bud Light is $1 off all day today" was saved for every day - the beer
    // at $4 for good - and before that as every Thursday): "today", "tonight", "tomorrow", "this Friday" or a date, with nothing
    // that repeats ("every", "Tuesdays", "weekdays", "daily"), is that one date, whatever days the model gave
    // (Oct 27 2026, the review of round 2: "draft beer $2 off 5 to 9, not on friday" was put up for "Fri, Oct 30 only" - the "on friday"
    // of a day LEFT OUT read as the one day - and "... not on fridays" for every Friday. A day left out is never the day: the special is
    // every day but that one (helpers.daysIn reads the days left); and "from now on", "going forward", "starting today" say every week)
    const said = H.daysSaid(lt);
    // (the owner's tap on the box's own "Every Friday, or tonight only?" - below - or on its "Which Friday - today or next Friday?" (engine.js
    // sameWeekday) is the days or the date, left as tapped and never asked again: Oct 30 2026)
    const daysTapped = !!(ctx.answeredParam && ctx.clockCallId && /^(?:\*days|date)$/.test(String(ctx.answeredParam.get(ctx.clockCallId) || '')));
    if (!was && !daysTapped && !said.left.size && !said.unsure && !/\b(?:every|each|daily|nightly|weekly)\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)days\b|\bweekdays\b|\bweekends\b|\b(?:from now on|going forward|moving forward|starting (?:today|now|tonight)|as of (?:today|now)|for good|permanently|until further notice)\b/.test(lt)) {
      const one = (lt.match(/\b(?:today|tonight|tomorrow(?: night)?)\b|\b(?:this|next|on) (?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b\d{4}-\d{2}-\d{2}\b/) || [])[0];
      const d = one ? H.normDate(one.replace(/^on /, '').replace(/ night$/, ''), ctx.today) : null;
      // (one day said, and a weekday that is another day said plainly as well - "friday ... tonight": every Friday, or only tonight? Asked,
      // never picked - Oct 28 2026)
      const wd = d ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(d + 'T12:00:00Z').getUTCDay()] : null;
      if (d && said.groups.length && !said.groups.some(g => g.includes(wd))) throw new ActionError(`the owner named ${said.groups.map(g => g.join(', ')).join(' and ')} and "${one}" - every week on that day, or only that once? Ask, never pick`);
      // TODAY'S OWN WEEKDAY WITH "TONIGHT" IS TWO READINGS, AND THE BOX ASKS (Oct 30 2026 - maintainer's Oct 24 ruling: a weekday said on that same
      // day is two readings and is asked; for a weekly kind the two are "every Friday" or "tonight only"). The line above asked only when the
      // weekday was ANOTHER day: "wings $2 off friday 9 to 11 at night", then "tonight till close", said on a Friday became a special for
      // today only in silence (the model's right weekly Friday call too), while the same words on any other day were asked - the weekly
      // reading was lost on the one day it is most likely meant. Both are offered to tap; "tonight only", "just tonight", "this friday" said
      // plainly are still the one date, "fridays" / "every friday" still weekly (never reach here), and the answer finishes the call ('*days':
      // its days or its date, the other taken off - the engine merges it, and this rule leaves what was tapped as tapped)
      if (d && d === ctx.today && /^(?:today|tonight)$/.test(one) && said.groups.some(g => g.includes(wd)) && !/\b(?:today|tonight)\s+only\b|\b(?:only|just)\s+(?:for\s+)?(?:today|tonight)\b/.test(lt)) {
        if (said.groups.length !== 1) throw new ActionError(`the owner named ${said.groups.map(g => g.join(', ')).join(' and ')} and "${one}" - every week, on which days, or only ${one}? Ask, never pick`);
        const g = said.groups[0], every = 'Every ' + andList(g.map(x => DAYS_SAY[x] || x)), once = (one === 'tonight' ? 'Tonight' : 'Today') + ' only (' + H.dayWords(d) + ')';
        const e = new ActionError(`the owner named ${g.join(', ')} and "${one}" on that same weekday - every week, or only ${one}? the box asks`);
        e.ask = { param: '*days', question: `${every}, or ${one} only (${H.dayWords(d)})?`, choices: [every, once], values: [{ days: g.join(','), date: null }, { date: d, days: null }] };
        throw e;
      }
      if (d) { out.date = d; delete out.days; }
    }
    if (!out.date && (!out.days || !out.days.length || out.days.length === 7)) {
      // (days said in a way the box cannot place - "doesn't apply on fridays", "monday, no tuesday" - with none from the model: asked,
      // never every day)
      // (Oct 28 2026: a day said only about something else - "we close at 10 on fridays" - leaves every day a reading the words allow; the engine
      // holds the call to those readings)
      if (said.unsure && !was && !said.readings.some(g => g.length === 7)) throw new ActionError('the owner named days in a way that is not plain (a day left out, or a correction) - ask which days the special is on');
      // (only days that are certain fill in: one group of them - "weekend warrior special: ... on fridays" and "fridays, saturdays stay
      // full price" were made every Friday, Saturday and Sunday, two groups joined. With none from the model, two groups are asked -
      // Oct 27 2026, round 2d, THE DAYS RULE)
      if (!was && !(out.days || []).length && new Set(said.groups.map(g => g.join())).size > 1) throw new ActionError('the owner named two different sets of days - ask which days the special is on, never every day');
      const d = H.daysIn(lt, true); if (d && d.length && d.length < 7) out.days = d;
    }
    if (out.price === undefined && out.dollars_off === undefined && out.percent_off === undefined && !was) {
      let m;
      if ((m = lt.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*off\b/))) out.dollars_off = Number(m[1]);
      else if (/\bhalf (?:off|price)\b/.test(lt)) out.percent_off = 50;
      else if ((m = lt.match(/\b(\d{1,3})\s*(?:%|percent)\s*off\b/))) out.percent_off = Number(m[1]);
      else if ((m = lt.match(/\$\s*(\d+(?:\.\d{1,2})?)/))) out.price = Number(m[1]);
    }
    return out;
  }
  actions.push(
    { name: 'counter_specials_read', area: 'menu', kind: 'read', needs: ['menuSpecials'],
      say: 'The counter\'s specials: each one\'s deal, what it covers, its days and time, and which are on right now (the pad charges them while they are on)',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => ({ specials: specialsOf(ctx).map(sp => ({ special: sp.name, deal: sp.deal, on: sp.covers, when: [sp.date || (sp.days || 'every day'), sp.time || 'all day'].join(', '), on_now: sp.on_now || undefined, on_website: sp.show_on_site ? undefined : 'no' })) }) },
    // A FOOD OR DRINK SPECIAL SAID PLAINLY (the 4B walk in maintainer's own typing, Oct 23 2026: "wings 50 cents off tuesdays 5 to 9" was
    // answered in words twice - "We'll set up ..." - and nothing made): items on the menu by name, an amount off or a price, its
    // days and hours - the box's own call, put up as the card the owner approves; anything less plain is the model's
    { name: 'counter_special_set', area: 'menu', kind: 'write', confirm: true, needs: ['menu', 'menuSpecials', 'website'],
      read: (words, conv, ctx) => {
        const s = String(words || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
        if (/\?/.test(s) || s.split(/\s+/).length > 25 || /^(?:ok(?:ay)?,?\s+|so,?\s+|and\s+|also,?\s+)?(?:how|what|why|when|where|who|which|do|does|did|is|are|was|were|will|would|should|could|can)\b/.test(s) || /\b(?:half[- ]hour|an hour|per hour|package|code|book(?:s|ing)?|flyer|members?)\b/.test(s)) return null;
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const items = cats(ctx).flatMap(c => c.items || []).filter(i => { const n = norm(i.name).replace(/s$/, ''); return n.length > 2 && new RegExp('\\b' + esc(n) + '(?:s|es)?\\b').test(s); });
        if (!items.length || items.length > 4) return null;
        // A SPECIAL THAT IS THERE ALREADY IS NEVER MADE AGAIN (Oct 27 2026, the review of round 2: with "Tuesday Wings" on the counter, Tue
        // 5-9 PM 50c off, "drop the tuesday wings special to $10" was put up as a NEW special - "Wings at $10 each, every Tuesday, all
        // day", its 5-9 window gone, a second special beside the first; "take $2 off the wings special" the same, every day): words that
        // point at a special ("the wings special", "our tuesday special"), a special's own name, or an item a special already covers by
        // name or by its part of the menu are a change to that special or a new one beside it, and which is the model's to ask
        { const sps = Array.isArray(ctx.menuSpecials) ? ctx.menuSpecials : [], csv = (x) => String(x || '').split(',').map(y => y.trim()).filter(Boolean);
          const partOf = (i) => (cats(ctx).find(c => (c.items || []).some(x => x.id === i.id)) || {}).id;
          if (/\b(?:the|our|that|this|existing|current|same)\s+(?:[\w$.'-]+\s+){0,4}?specials?\b/.test(s)) return null;
          if (sps.some(sp => { const n = norm(sp.name); return n.length > 2 && s.includes(n); })) return null;
          if (sps.some(sp => items.some(i => csv(sp.item_ids).includes(String(i.id)) || csv(sp.category_ids).includes(String(partOf(i)))))) return null; }
        const c = /\b(\d{1,2})\s*(?:c|cents?)\s*off\b/.exec(s), d = /\$\s?(\d+(?:\.\d\d)?)\s*off\b|\b(\d+(?:\.\d\d)?)\s*(?:dollars?|bucks)\s*off\b/.exec(s), pc = /\b(\d{1,3})\s*(?:%|percent)\s*off\b/.exec(s);
        const each = /\$\s?(\d+(?:\.\d\d)?)\b(?!\s*off)|\b(\d+(?:\.\d\d)?)\s*(?:bucks|dollars)\b(?!\s*off)/.exec(s);
        const deal = c ? { dollars_off: Number(c[1]) / 100 } : d ? { dollars_off: Number(d[1] || d[2]) } : pc ? { percent_off: Number(pc[1]) } : /\bhalf (?:off|price)\b/.test(s) ? { percent_off: 50 } : each ? { price: Number(each[1] || each[2]) } : null;
        if (!deal) return null;
        const days = H.daysIn(s, true), r = H.rangeIn(s);
        if (!days && H.daysIn(s)) return null;   // two groups of days - two specials, the model's
        // (days said in a way the reading cannot place - "doesn't apply on fridays", "monday, no tuesday" - are the model's, never every day:
        // Oct 27 2026)
        if (!days && H.daysSaid(s).unsure) return null;
        // (a special says when it runs - "make the Ale IPA $6" is the menu's own price, never a special: test-assistant-view V6 and
        // test-demo-model D23 caught the first cut putting one up in place of the price change)
        if (!days && !r && !/\b(?:special|happy hour|tonight|today only|this week(?:end)?|game day|all day)\b/.test(s)) return null;
        const DN = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
        const when = days && days.length === 1 ? DN[days[0]] + ' ' : days && days.length === 5 && !days.includes('sat') ? 'Weekday ' : '';
        const name = (when ? when + titled(items[0].name).replace(/(?<![sS])$/, items.length === 1 && !/s$/i.test(items[0].name) ? 's' : '') : titled(items[0].name) + ' Special').slice(0, 60);
        return Object.assign({ name, items: items.map(i => i.name) }, deal, days ? { days: days.join(',') } : {}, r ? { from_time: r.from, to_time: r.to } : {});
      },
      // what the model left out, from the owner's own words (the engine runs it once the arguments are checked)
      // (a special not there yet, named as the one to change as well - the 4B's way, Oct 22 2026, the owner's second day: "there is no
      // special called "Taco Tuesday" yet", three rounds - is a new special)
      fill: (a, ctx) => {
        let was = null;
        if (a.special) { try { was = findSpecial(ctx, a.special); } catch { if (norm(a.special) === norm(a.name) || !specialsOf(ctx).length) { a = Object.assign({}, a); delete a.special; } } }
        return fromWords(a, ctx, was);
      },
      say: 'Make a food or drink special that REALLY changes the price at the counter while it is on - "Taco Tuesday, $5 tacos", "$2 off beers Friday and Saturday 9 to close", "half off wings during happy hour 3 to 6 weekdays" - and the website\'s weekly specials show it. Or change one (special: its name now). The deal is ONE of: price (each), dollars_off, percent_off. What it covers: items by name, parts of the menu (Beer, Food...), or covers: drinks / food / everything',
      params: { type: 'object', properties: {
        name: { type: 'string', minLength: 2, maxLength: 60, description: 'the special\'s name, like "Taco Tuesday" or "Happy hour"' },
        special: { type: 'string', maxLength: 60, description: 'to change a special that is there already: its name now' },
        items: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 }, description: 'menu items it covers, by name' },
        parts: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 60 }, description: 'whole parts of the menu it covers, like "Beer" or "Food"' },
        covers: { type: 'string', enum: ['drinks', 'food', 'everything'], description: 'instead of items or parts: every drink, every food, or the whole menu' },
        price: { type: 'number', minimum: 0, maximum: 1000, description: 'the special price of each, in dollars' },
        dollars_off: { type: 'number', minimum: 0, maximum: 1000, description: 'dollars off each' },
        percent_off: { type: 'number', minimum: 1, maximum: 100, description: 'percent off each (50 for half off)' },
        days: { type: 'string', description: 'its days: "tuesday", "fri, sat", "weekdays", "every day" (left out: every day)', 'x-days': true },
        date: Object.assign({}, H.DATE, { description: 'ONE day only instead of every week (a date, "tonight" is today)' }),
        from_time: Object.assign({}, H.TIME, { description: 'when it starts (HH:MM; left out: from opening)' }),
        to_time: Object.assign({}, H.TIME, { description: 'when it ends (HH:MM; before from_time runs past midnight; left out: until closing)' }),
        words: { type: 'string', maxLength: 200, description: 'its line on the website, if the owner gave one' },
        show_on_website: { type: 'boolean', description: 'false to keep it off the website (the counter still charges it)' } }, required: ['name'] },
      build: (a, ctx) => {
        const was = a.special ? findSpecial(ctx, a.special) : null;
        const deals = [a.price !== undefined && 'price', a.dollars_off !== undefined && 'off', a.percent_off !== undefined && 'percent'].filter(Boolean);
        if (deals.length > 1) throw new ActionError('a special has ONE deal: a price, dollars off or percent off - say which');
        let kind = deals[0], value;
        if (kind === 'price') value = Math.round(a.price * 100); else if (kind === 'off') value = Math.round(a.dollars_off * 100); else if (kind === 'percent') value = Math.round(a.percent_off);
        else if (was) { kind = was.kind; value = was.value; }
        else throw new ActionError('say the deal: a price each ("$5 tacos"), dollars off ("$2 off") or percent off ("half off")');
        const items = (a.items || []).map(r => findItem(ctx, r)), parts = (a.parts || []).map(r => { const c = pick(cats(ctx), r, 'part of the menu', (x) => x.name); if (!c) throw new ActionError(`there is no "${r}" on the menu - the parts are ${andList(cats(ctx).map(x => x.name))}`); return c; });
        const tax = a.covers === 'drinks' ? 'beverage' : a.covers === 'food' ? 'food' : '';
        const keep = was && !items.length && !parts.length && !a.covers;
        if (!items.length && !parts.length && !a.covers && !was) throw new ActionError('say what the special is on: items by name, a part of the menu (like Beer), or every drink / every food / the whole menu');
        const body = { id: was ? was.id : undefined, name: titled(a.name).slice(0, 60),
          item_ids: keep ? (was.item_ids ? String(was.item_ids).split(',') : []) : items.map(i => i.id), category_ids: keep ? (was.category_ids ? String(was.category_ids).split(',') : []) : parts.map(c => c.id),
          tax_category: keep ? (was.tax_category || '') : tax, kind, value,
          days: a.days || (a.date ? [] : (was && !a.date ? String(was.days || '').split(',').filter(Boolean) : [])), date: a.date || (was && !a.days ? was.date || '' : ''),
          start_time: a.from_time !== undefined ? a.from_time : (was ? was.start_time || '' : ''), end_time: a.to_time !== undefined ? a.to_time : (was ? was.end_time || '' : ''),
          words: a.words !== undefined ? a.words : (was ? was.words || '' : ''), show_on_site: a.show_on_website === false ? false : (was ? !!was.show_on_site : true) };
        if (body.days && body.days.length === 7) body.days = [];
        // what it covers, in words, for the card (kept beside the request, never sent)
        ctx.specialCovers = keep ? was.covers : [items.map(i => i.name).join(', '), parts.map(c => 'every ' + c.name).join(', '), a.covers === 'drinks' ? 'every drink' : a.covers === 'food' ? 'all food' : a.covers === 'everything' ? 'the whole menu' : ''].filter(Boolean).join(', ');
        return { op: 'http', method: 'POST', path: '/api/pos/specials', body };
      },
      describe: (a, ctx) => {
        let b; try { b = actions.find(x => x.name === 'counter_special_set').build(a, ctx).body; } catch { return `A special: ${a.name}`; }
        const was = a.special ? specialsOf(ctx).find(x => x.name === a.special) : null;
        const deal = b.kind === 'price' ? `${money(b.value)} each` : b.kind === 'off' ? `${money(b.value)} off each` : `${b.value}% off each`;
        const cov = ctx.specialCovers;
        return `${was ? 'Change the special "' + was.name + '": ' : ''}${b.name} - ${cov || 'the whole menu'} at ${deal}, ${whenSay(b)}. The servers' pads ring it up at that price while it is on (a member gets the better of this and their own perk)${b.show_on_site ? (siteShowsSpecials(ctx) ? ', and your website\'s weekly specials show it' : ' - your website has no weekly specials section yet to show it') : ', kept off the website'}.`;
      } },
    { name: 'counter_special_remove', area: 'menu', kind: 'write', confirm: true, needs: ['menuSpecials'],
      say: 'Take a counter special off for good - the pad goes back to the menu\'s prices for it, and the website stops showing it',
      params: { type: 'object', properties: { special: { type: 'string', minLength: 1, maxLength: 60, description: 'the special\'s name' } }, required: ['special'] },
      build: (a, ctx) => ({ op: 'http', method: 'DELETE', path: '/api/pos/specials/' + encodeURIComponent(findSpecial(ctx, a.special).id) }),
      describe: (a, ctx) => { const sp = findSpecial(ctx, a.special); return `Take the special "${sp.name}" off (${sp.deal} - ${sp.covers}): the pad charges the menu's prices again, and the website stops showing it`; } },
  );
  return { actions, loaders };
};
