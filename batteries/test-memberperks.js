// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-memberperks.js — MEMBERSHIP FOLLOWS THE PERSON.
// A friend's code typed in at the counter must keep working all night: their
// share of extra time carries their golf rate, and their food and drinks
// carry whatever perks the membership includes.
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

(async () => {
  { const p = './config.json'; let c = {}; if (fs.existsSync(p)) { try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
    c.server = Object.assign({}, c.server, { businessName: 'Perk Test', adminPassword: 'battery-owner-pass-1' });
    c.setup = Object.assign({}, c.setup, { completed: true });
    c.booking = Object.assign({}, c.booking, { staffedAccess: true, pricePerHalfHour: 40, open24Hours: true });
    c.bays = [{ id: 'bay1', name: 'Bay 1', active: true }];
    c.pos = Object.assign({}, c.pos, { tax: { categories: { food: 7.375, beverage: 7.375, sim: 0 } } });
    fs.writeFileSync(p, JSON.stringify(c, null, 2)); }

  const dbM = require('./services/db'); await dbM.initDb();
  const pos = require('./services/pos'); pos.ensureSchema();
  const C = require('./services/checks'); C.ensureSchema(); C.ensureShareColumn();
  const MP = require('./services/memberperks');
  const D = dbM.db;
  const wipe = () => { ['seats','tab_items','tabs','members','membership_tiers','bookings']
    .forEach(t => { try { D.prepare(`DELETE FROM ${t} WHERE 1=1`).run(); } catch {} }); };
  wipe();

  // A tier with golf AND food/drink perks: 10% off food, $1 off every drink.
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,
              food_discount_type,food_discount_value,beverage_discount_type,beverage_discount_value)
             VALUES ('t-gold','Gold','percentage',30,'percent',10,'fixed',1)`).run();
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value)
             VALUES ('t-basic','Basic','percentage',10)`).run();
  D.prepare(`INSERT INTO members (id,tier_id,name,phone,pin,status) VALUES ('m-friend','t-gold','Friend','+15550001111','2468','active')`).run();
  D.prepare(`INSERT INTO members (id,tier_id,name,phone,pin,status) VALUES ('m-lapsed','t-gold','Lapsed','+15550003333','9999','cancelled')`).run();

  console.log('── the perks resolve ──');
  const p = MP.perksForMember('m-friend');
  ok('a member resolves to their tier perks', !!p && p.tier_name === 'Gold', p && p.tier_name);
  ok('golf discount reads through', MP.golfPct(p) === 30, MP.golfPct(p));
  ok('food perk reads through', p.food.type === 'percent' && p.food.value === 10, p.food);
  ok('drink perk reads through', p.beverage.type === 'fixed' && p.beverage.value === 1, p.beverage);
  ok('a LAPSED membership gets nothing', MP.perksForMember('m-lapsed') === null);
  ok('a non-member gets nothing', MP.perksForMember(null) === null);

  console.log('── the pricing maths ──');
  ok('10% off a $14.50 burger', MP.priceForMember(1450, 'food', p).unit_cents === 1305, MP.priceForMember(1450,'food',p));
  ok('$1 off a $6.50 beer', MP.priceForMember(650, 'beverage', p).unit_cents === 550);
  ok('the reason is human-readable', /Gold/.test(MP.priceForMember(650, 'beverage', p).reason), MP.priceForMember(650,'beverage',p).reason);
  ok('a discount never takes a line below zero', MP.priceForMember(50, 'beverage', p).unit_cents === 0);
  const basic = MP.perksForMember(null);
  ok('a golf-only tier gives no food perk', MP.priceForMember(1450, 'food', { food:{type:'',value:0}, beverage:{type:'',value:0}, tier_name:'Basic' }) === null);

  console.log('── the friend orders: perks apply every round, not just the first ──');
  const cat = pos.upsertCategory({ name: 'Kitchen', printer_role: 'kitchen', tax_category: 'food' });
  const bar = pos.upsertCategory({ name: 'Bar', printer_role: 'bar', tax_category: 'beverage' });
  const burger = pos.upsertItem({ category_id: cat, name: 'Burger', price_cents: 1450 });
  const beer = pos.upsertItem({ category_id: bar, name: 'Beer', price_cents: 650 });

  const friendTab = pos.openTab({ label: 'Friend', employee: 'Dana' });
  const payerTab  = pos.openTab({ label: 'Payer', employee: 'Dana' });
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('bk-perk','bay1','Bay 1','Payer','+15550002222',date('now','+1 day'),'10:00','11:00',date('now','+1 day'),60,8000,'active')`).run();
  D.prepare(`INSERT INTO seats (id,booking_id,name,member_id,tab_id) VALUES ('s-1','bk-perk','Payer',NULL,?)`).run(payerTab.id);
  D.prepare(`INSERT INTO seats (id,booking_id,name,member_id,tab_id) VALUES ('s-2','bk-perk','Friend','m-friend',?)`).run(friendTab.id);

  pos.sendOrder(friendTab.id, [{ item_id: burger }, { item_id: beer }], 'Dana');
  let fi = pos.getTab(friendTab.id).items;
  ok('the member pays the discounted food price', fi.find(i => i.name === 'Burger').unit_price_cents === 1305,
     fi.find(i => i.name === 'Burger').unit_price_cents);
  ok('the member pays the discounted drink price', fi.find(i => i.name === 'Beer').unit_price_cents === 550);
  ok('the receipt says WHY it is cheaper', /Gold/.test(fi.find(i => i.name === 'Beer').note), fi.find(i => i.name === 'Beer').note);

  pos.sendOrder(payerTab.id, [{ item_id: burger }, { item_id: beer }], 'Dana');
  const pi = pos.getTab(payerTab.id).items;
  ok('the non-member friend pays full price for food', pi.find(i => i.name === 'Burger').unit_price_cents === 1450);
  ok('...and full price for drinks', pi.find(i => i.name === 'Beer').unit_price_cents === 650);

  pos.sendOrder(friendTab.id, [{ item_id: beer }], 'Dana');
  const second = pos.getTab(friendTab.id).items.filter(i => i.name === 'Beer');
  ok('THE SECOND ROUND IS STILL DISCOUNTED (membership is not forgotten)',
     second.length === 2 && second.every(i => i.unit_price_cents === 550), second.map(i => i.unit_price_cents));

  console.log('── adding time later: the member keeps their golf rate ──');
  const ck = require('./services/checkin');
  const e = ck.extendBooking({ booking_id: 'bk-perk', minutes: 30, tab_id: payerTab.id,
                               employee: 'Dana', pay_tabs: [payerTab.id, friendTab.id] });
  ok('the extension goes through', e.status === 200, e.body);
  ok('it reports that a member discount was applied', e.body.charged && e.body.charged.member_discounts === true, e.body.charged);
  const payerGolf = pos.getTab(payerTab.id).items.filter(i => /extension/i.test(i.name));
  const friendGolf = pos.getTab(friendTab.id).items.filter(i => /extension/i.test(i.name));
  ok('both people get a share of the extra time', payerGolf.length === 1 && friendGolf.length === 1);
  ok('THE MEMBER PAYS 30% LESS FOR THEIR SHARE OF THE ADDED TIME',
     friendGolf[0].unit_price_cents === Math.round(payerGolf[0].unit_price_cents * 0.7),
     { payer: payerGolf[0].unit_price_cents, member: friendGolf[0].unit_price_cents });
  ok('the line says it carried a member rate', /member 30% off/i.test(friendGolf[0].name), friendGolf[0].name);

  console.log('── the printed check shows it ──');
  const slip = require('./services/printing').buildTabReceipt(pos.getTab(friendTab.id), { employee: 'Dana' });
  ok('the guest check names the membership benefit', /Gold/.test(slip), slip.split('\n').filter(l => /Gold/.test(l))[0]);

  wipe();
  console.log(`\nMEMBER PERKS: ${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})().catch(e => { console.error(e); process.exit(1); });
