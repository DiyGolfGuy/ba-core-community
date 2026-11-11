// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-specials.js - SPECIALS THAT REALLY CHANGE THE PRICE (Oct 22 2026; services/specials.js, branch
// feature/ai-edition)
//
// maintainer: "it needs to reflect in the price in the drinks for that night. like if they say tuesday special and an ammount off the
// beer needs to be that ammount off." A special the owner sets is the counter's own rule: while it is on, a server rings the
// item up at its price. The clock is moved through a week in the facility's own zone (tools/fake-clock.js, in this process):
//   S1  when a special is on: its days, one date, its time (start in, end out), all day, past midnight still its own day
//   S2  the deal: a price never above the menu's, an amount off never below nothing, a percent rounded to the cent
//   S3  the facility's clock is its own zone's, not UTC (9:30 PM Tuesday in Omaha is 02:30 Wednesday UTC)
//   S4  Taco Tuesday ($3 tacos, Tuesday 5 to 9): rung up at 6 PM Tuesday the tacos are $3 with "Taco Tuesday" on the line,
//       the beer at the menu's price, and the tab's total and tax are worked from $3; the pad's menu shows the tacos at $3
//   S5  at 10:30 PM the same Tuesday, and on Wednesday at 6 PM, the tacos are the menu's $4 again
//   S6  "half off every drink, Friday 9 PM to 1 AM": at 12:30 AM Saturday it is still Friday's - the beer half price; at
//       1:30 AM Saturday, and at 12:30 AM Sunday (Saturday night), full price
//   S7  a member gets the better of their own perk and the special, never both: $1 off the beer (their perk) against half off
//       (the special) - half off; $1 off against 10% off - $1 off
//   S8  one date only: wing night on Thursday Oct 29 - the wings $8 that day, $12 the Thursday after
//   S9  a part of the menu: $2 off every Beer while on; the food untouched
//   S10 the website's weekly specials carry the counter's specials (the same rule): name, deal, days and time; a special kept
//       off the website is not there; one taken off is gone from the counter and the website both
// Same-day idempotent: its own database tables wiped at the start.
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 600) : '')); } };

// the clock: a Tuesday at 6 PM in Omaha (Oct 27 2026 is a Tuesday; Central Daylight Time, UTC-5, until Nov 1)
process.env.BA_FAKE_NOW = '2026-10-27T23:00:00Z';
require('./tools/fake-clock.js');
const at = (iso) => global.__baFakeClock.set(iso);

(async () => {
  { const p = './config.json'; let c = {}; if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
    c.server = Object.assign({}, c.server, { businessName: 'Specials Test', adminPassword: 'battery-owner-pass-1', timezone: 'America/Chicago' });
    c.setup = Object.assign({}, c.setup, { completed: true });
    c.pos = Object.assign({}, c.pos, { tax: { categories: { food: 7, beverage: 10, sim: 0 } } });
    fs.writeFileSync(p, JSON.stringify(c, null, 2)); }
  const dbM = require('./services/db'); await dbM.initDb();
  const pos = require('./services/pos'); pos.ensureSchema();
  const S = require('./services/specials'); S.ensureSchema();
  const D = dbM.db;
  for (const t of ['menu_specials', 'seats', 'tab_items', 'tabs', 'members', 'membership_tiers', 'bookings', 'menu_items', 'menu_categories']) { try { D.prepare(`DELETE FROM ${t}`).run(); } catch {} }

  // ── S1-S3: when, how much, and whose clock ──
  const c = (date, dow, hm) => ({ date, dow, hm });
  const taco = { active: 1, days: 'tue', date: '', start_time: '17:00', end_time: '21:00' };
  const late = { active: 1, days: 'fri', date: '', start_time: '21:00', end_time: '01:00' };
  ok('S1 a Tuesday 5 to 9 special: on at 5:00 and 8:59 PM Tuesday, off at 4:59, at 9:00 sharp and on a Wednesday',
     S.onAt(taco, c('2026-10-27', 'tue', '17:00')) && S.onAt(taco, c('2026-10-27', 'tue', '20:59')) && !S.onAt(taco, c('2026-10-27', 'tue', '16:59'))
     && !S.onAt(taco, c('2026-10-27', 'tue', '21:00')) && !S.onAt(taco, c('2026-10-28', 'wed', '18:00')));
  ok('S1 past midnight: Friday 9 PM to 1 AM is on Friday at 11 PM and Saturday at 12:30 AM, off Saturday at 1 AM, Saturday at 11 PM and Sunday at 12:30 AM',
     S.onAt(late, c('2026-10-30', 'fri', '23:00')) && S.onAt(late, c('2026-10-31', 'sat', '00:30')) && !S.onAt(late, c('2026-10-31', 'sat', '01:00'))
     && !S.onAt(late, c('2026-10-31', 'sat', '23:00')) && !S.onAt(late, c('2026-11-01', 'sun', '00:30')));
  ok('S1 all day, every day, one date, and switched off',
     S.onAt({ active: 1, days: '', date: '' }, c('2026-10-28', 'wed', '03:00')) && S.onAt({ active: 1, days: '', date: '2026-10-29' }, c('2026-10-29', 'thu', '12:00'))
     && !S.onAt({ active: 1, days: '', date: '2026-10-29' }, c('2026-11-05', 'thu', '12:00')) && !S.onAt({ active: 0, days: '', date: '' }, c('2026-10-28', 'wed', '12:00')));
  ok('S2 the deal: a $3 price on a $4 item is $3 and on a $2 item stays $2; $2 off a $1.50 item is nothing, never less; 15% off $6.99 is $5.94',
     S.priceUnder({ kind: 'price', value: 300 }, 400) === 300 && S.priceUnder({ kind: 'price', value: 300 }, 200) === 200
     && S.priceUnder({ kind: 'off', value: 200 }, 150) === 0 && S.priceUnder({ kind: 'percent', value: 15 }, 699) === 594);
  const clk = S.clock(new Date('2026-10-28T02:30:00Z'));
  ok('S3 the facility\'s own clock: 02:30 UTC Wednesday is 9:30 PM Tuesday in Omaha (' + JSON.stringify(clk) + ')', clk.date === '2026-10-27' && clk.dow === 'tue' && clk.hm === '21:30', clk);

  // ── a menu ──
  const food = pos.upsertCategory({ name: 'Food', printer_role: 'kitchen', tax_category: 'food' });
  const beerCat = pos.upsertCategory({ name: 'Beer', printer_role: 'bar', tax_category: 'beverage' });
  const wineCat = pos.upsertCategory({ name: 'Wine', printer_role: 'bar', tax_category: 'beverage' });
  const tacos = pos.upsertItem({ category_id: food, name: 'Tacos', price_cents: 400 });
  const wings = pos.upsertItem({ category_id: food, name: 'Wings', price_cents: 1200 });
  const beer = pos.upsertItem({ category_id: beerCat, name: 'Draft Beer', price_cents: 600 });
  const wine = pos.upsertItem({ category_id: wineCat, name: 'House Wine', price_cents: 900 });
  const lineOf = (tab, name) => pos.getTab(tab.id).items.filter(i => i.name === name).pop() || {};
  const ring = (ids, label) => { const t = pos.openTab({ label: label || 'Guest', employee: 'Dana' }); pos.sendOrder(t.id, ids.map(id => ({ item_id: id })), 'Dana'); return t; };
  const menuItem = (name) => pos.getMenu(false).flatMap(cc => cc.items).find(i => i.name === name) || {};

  // ── S4-S5: Taco Tuesday ──
  const tt = S.upsert({ name: 'Taco Tuesday', item_ids: [tacos], kind: 'price', value: 300, days: ['tue'], start_time: '17:00', end_time: '21:00', words: '$3 tacos all night' });
  at('2026-10-27T23:00:00Z');   // Tuesday 6 PM
  const t4 = ring([tacos, beer]);
  const tl = lineOf(t4, 'Tacos'), bl = lineOf(t4, 'Draft Beer');
  const tot4 = pos.computeTotals(pos.getTab(t4.id));
  ok('S4 Taco Tuesday at 6 PM Tuesday: the tacos ring up at $3 with "Taco Tuesday" on the line, the beer at its $6',
     tl.unit_price_cents === 300 && /Taco Tuesday/.test(tl.note || '') && bl.unit_price_cents === 600 && !/Taco/.test(bl.note || ''), { tl, bl });
  ok('S4 the tab is worked from the special price: $9 of goods ($3 + $6), tax on each at its own rate ($0.21 + $0.60)',
     tot4 && tot4.subtotal_cents === 900 && tot4.tax_cents === 81, tot4);
  ok('S4 the servers\' pad shows the tacos at $3 under "Taco Tuesday" - the menu\'s own price kept beside it - and nothing on the beer',
     menuItem('Tacos').special_price_cents === 300 && menuItem('Tacos').special_name === 'Taco Tuesday' && menuItem('Tacos').price_cents === 400 && menuItem('Draft Beer').special_price_cents === undefined,
     { tacos: menuItem('Tacos'), beer: menuItem('Draft Beer').special_price_cents });
  at('2026-10-28T03:30:00Z');   // Tuesday 10:30 PM
  const t5 = ring([tacos]);
  at('2026-10-28T23:00:00Z');   // Wednesday 6 PM
  const t5b = ring([tacos]);
  ok('S5 the tacos are the menu\'s $4 again at 10:30 PM Tuesday and at 6 PM Wednesday - and the pad shows no special',
     lineOf(t5, 'Tacos').unit_price_cents === 400 && lineOf(t5b, 'Tacos').unit_price_cents === 400 && menuItem('Tacos').special_price_cents === undefined,
     [lineOf(t5, 'Tacos').unit_price_cents, lineOf(t5b, 'Tacos').unit_price_cents]);

  // ── S6: past midnight ──
  const ln = S.upsert({ name: 'Late night', tax_category: 'beverage', kind: 'percent', value: 50, days: ['fri'], start_time: '21:00', end_time: '01:00' });
  at('2026-10-31T05:30:00Z');   // Saturday 12:30 AM - still Friday's
  const t6a = ring([beer, wine, wings]);
  at('2026-10-31T06:30:00Z');   // Saturday 1:30 AM
  const t6b = ring([beer]);
  at('2026-11-01T05:30:00Z');   // Sunday 12:30 AM (Saturday night) - CDT until 2 AM
  const t6c = ring([beer]);
  ok('S6 half off every drink Friday 9 PM to 1 AM: at 12:30 AM Saturday the beer is $3 and the wine $4.50 (every drink), the wings their $12; at 1:30 AM Saturday and 12:30 AM Sunday the beer is $6',
     lineOf(t6a, 'Draft Beer').unit_price_cents === 300 && lineOf(t6a, 'House Wine').unit_price_cents === 450 && lineOf(t6a, 'Wings').unit_price_cents === 1200
     && lineOf(t6b, 'Draft Beer').unit_price_cents === 600 && lineOf(t6c, 'Draft Beer').unit_price_cents === 600,
     [lineOf(t6a, 'Draft Beer').unit_price_cents, lineOf(t6a, 'House Wine').unit_price_cents, lineOf(t6a, 'Wings').unit_price_cents, lineOf(t6b, 'Draft Beer').unit_price_cents, lineOf(t6c, 'Draft Beer').unit_price_cents]);

  // ── S7: a member - the better of the two, never both ──
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,food_discount_type,food_discount_value,beverage_discount_type,beverage_discount_value)
             VALUES ('t-gold','Gold','percentage',0,'percent',0,'fixed',1)`).run();
  D.prepare(`INSERT INTO members (id,tier_id,name,phone,pin,status) VALUES ('m-gold','t-gold','Gold Guest','+15550001111','2468','active')`).run();
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('bk-sp','bay1','Bay 1','Gold Guest','+15550001111',date('now'),'20:00','21:00',date('now'),60,4000,'active')`).run();
  const memberTab = () => { const t = pos.openTab({ label: 'Gold Guest', employee: 'Dana' }); D.prepare(`INSERT INTO seats (id,booking_id,name,member_id,tab_id) VALUES (?,?,?,?,?)`).run('s-' + t.id, 'bk-sp', 'Gold Guest', 'm-gold', t.id); return t; };
  at('2026-10-31T04:00:00Z');   // Friday 11 PM: half off every drink is on
  const t7a = memberTab(); pos.sendOrder(t7a.id, [{ item_id: beer }], 'Dana');
  const happy = S.upsert({ name: 'Happy ten', tax_category: 'beverage', kind: 'percent', value: 10, days: ['sat'], start_time: '15:00', end_time: '18:00' });
  at('2026-10-31T21:00:00Z');   // Saturday 4 PM: only 10% off is on
  const t7b = memberTab(); pos.sendOrder(t7b.id, [{ item_id: beer }], 'Dana');
  const l7a = lineOf(t7a, 'Draft Beer'), l7b = lineOf(t7b, 'Draft Beer');
  ok('S7 a member gets the better of their $1-off perk and the special, never both: half off on Friday night ($3, "Late night"), $1 off against 10% off on Saturday ($5, their Gold perk)',
     l7a.unit_price_cents === 300 && /Late night/.test(l7a.note || '') && !/Gold/.test(l7a.note || '') && l7b.unit_price_cents === 500 && /Gold/.test(l7b.note || '') && !/Happy ten/.test(l7b.note || ''), { l7a, l7b });
  S.remove(happy.id);

  // ── S8: one date only ──
  S.upsert({ name: 'Wing night', item_ids: [wings], kind: 'price', value: 800, date: '2026-10-29' });
  at('2026-10-29T23:00:00Z');   // Thursday Oct 29, 6 PM
  const t8a = ring([wings]);
  at('2026-11-05T23:00:00Z');   // the Thursday after
  const t8b = ring([wings]);
  ok('S8 wing night on Thursday Oct 29 only: the wings $8 that day, $12 the Thursday after', lineOf(t8a, 'Wings').unit_price_cents === 800 && lineOf(t8b, 'Wings').unit_price_cents === 1200,
     [lineOf(t8a, 'Wings').unit_price_cents, lineOf(t8b, 'Wings').unit_price_cents]);

  // ── S9: a part of the menu ──
  S.upsert({ name: 'Beer o\'clock', category_ids: [beerCat], kind: 'off', value: 200, days: ['mon', 'tue', 'wed', 'thu', 'fri'], start_time: '15:00', end_time: '18:00' });
  at('2026-11-02T22:00:00Z');   // Monday 4 PM (CST now, UTC-6)
  const t9 = ring([beer, wine, tacos]);
  ok('S9 $2 off every Beer weekdays 3 to 6: at 4 PM Monday the draft is $4, the wine (not a Beer) $9 and the tacos $4',
     lineOf(t9, 'Draft Beer').unit_price_cents === 400 && lineOf(t9, 'House Wine').unit_price_cents === 900 && lineOf(t9, 'Tacos').unit_price_cents === 400,
     [lineOf(t9, 'Draft Beer').unit_price_cents, lineOf(t9, 'House Wine').unit_price_cents, lineOf(t9, 'Tacos').unit_price_cents]);

  // ── S10: the website shows the same specials ──
  S.upsert({ name: 'Secret menu', item_ids: [wings], kind: 'off', value: 100, show_on_site: false });
  const site = S.forWebsite();
  const ttSite = site.find(x => x.title === 'Taco Tuesday') || {};
  ok('S10 the website\'s weekly specials carry the counter\'s: Taco Tuesday with its words, $3, Tuesdays, 5 PM - 9 PM; one kept off the website is not there; a date gone by is not shown',
     ttSite.price === '$3' && ttSite.text === '$3 tacos all night' && ttSite.days === 'tue' && ttSite.time === '5 PM - 9 PM' && !site.some(x => x.title === 'Secret menu') && !site.some(x => x.title === 'Wing night'),
     site);
  S.remove(tt.id);
  at('2026-11-03T23:00:00Z');   // Tuesday 5 PM CST - Taco Tuesday's hours, but it is gone
  const t10 = ring([tacos]);
  ok('S10 Taco Tuesday taken off: gone from the website, and on the next Tuesday at 5 PM the tacos are $4',
     !S.forWebsite().some(x => x.title === 'Taco Tuesday') && lineOf(t10, 'Tacos').unit_price_cents === 400, lineOf(t10, 'Tacos').unit_price_cents);
  S.remove(ln.id);

  console.log(`\nSPECIALS: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL  crashed: ' + (e && e.stack || e)); console.log(`\nSPECIALS: ${pass} passed, ${fail + 1} failed`); process.exit(1); });
