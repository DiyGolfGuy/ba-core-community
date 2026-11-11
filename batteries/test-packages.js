// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-packages.js - PACKAGE DEALS AND BOOKING DEALS, THROUGH THE ROUTES, AND THE MONEY OF EACH (Oct 22 2026;
// services/packages.js, services/deals.js)
//
// maintainer: "Yes definitely allow them to make package deals. For sure any and all sorts of package deals" and "Even say book 2
// hours get the last 30 min free Tuesdays". A unit of its own (no Stripe key: a booking is made at once, as a unit with no
// payments does), every step through the owner's, the booking page's and the counter's own routes, every number read back.
//   PK1 a package saved by the owner, its words read back; a half-made one refused with its reason
//   PK2 the booking page's list: the package as a customer reads it, nothing internal (no tax settings)
//   PK3 the quote: a flat package taxed split (the golf part at the bookings' rate, the rest at Beverage) and a per-person one
//       at Food, each line rounded on its own - the numbers the charge uses
//   PK4 booked online: the wrong length, a day it is not offered and a code refused with their reasons; then booked - its
//       price, and the booking's own copy of the package (what it includes, a person's share times the players)
//   PK5 at the counter, on that booking's tab: the included pitcher at $0, two more charged; two beers a person from Beer
//       included across two tabs of the booking; a void gives one back; past what is left, charged
//   PK6 a later change to the package, and taking it off, leave the booking as bought
//   PK7 with no food and drink at the counter, a package that includes something is refused, saying so; bay time only is not
//   PK8 a walk-in party sold a package at the counter: the pad's quote, the booking, check-in with each seat's share split by the
//       package's own tax, and what it includes at $0
//   DL1 a booking deal: "book 2 hours, the last 30 minutes free - Tuesdays": the booking page's price for 2 hours on a Tuesday
//       is $20 less, with the deal named and the price before it; 90 minutes, or a Wednesday, is the plain price
//   DL2 booked online on a Tuesday for 2 hours: charged the deal's price, the deal kept on the booking; a code is worked from
//       the deal's price; the counter's own booking takes the deal too and keeps it
//   DL3 two deals that fit: the bigger one is taken, never both; one switched off is not taken
//   DL4 free things with a booking (maintainer, Oct 22 2026, night: "if its 2 hours and free pitches they just get the pitchers at the
//       front desk no need for a special booking"): "book 2 hours, get 2 pitchers free - Tuesdays": the bay's price unchanged (a
//       money deal beside it still taken), the booking page says what comes with it, 90 minutes or a Wednesday says nothing; a deal
//       with nothing free, or with no food and drink at the counter, refused with its reason
//   DL5 booked online and by a member's code and at the counter: each booking keeps what comes with it; a package booking does not;
//       the staff list and /my-booking say it; at the counter 2 pitchers ring up at $0 on that booking's tab and the third is charged
//   DL6 (Oct 23 2026, the research into how venues run deals) a minutes-free deal with no booking named is refused; the deal's
//     words read at a glance; a code checked at the door says what to bring in the reply, the confirmation email and /my-booking
// Same-day idempotent: its own copy of the tree, removed at the end.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 900) : '')); } };
const root = __dirname;
const PORT = 3176, HOST = 'http://127.0.0.1:' + PORT, PW = 'packages-owner-pw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server = null, work = null;

// a day ahead on the calendar (never "now + n x 24 hours" read as a local date), and the next of a weekday from it
const dayAhead = (n) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + n, 12).toISOString().slice(0, 10); };
const nextDow = (dow) => { for (let n = 2; n < 10; n++) { const d = dayAhead(n); if (new Date(d + 'T12:00:00Z').getUTCDay() === dow) return d; } return null; };

(async () => {
  const cleanup = () => { try { server && server.kill('SIGKILL'); } catch {} try { work && fs.rmSync(work, { recursive: true, force: true }); } catch {} };
  process.on('exit', cleanup);
  try {
    try { if ((await fetch(HOST + '/api/time')).ok) { console.log('FAIL  port ' + PORT + ' already answers - an orphaned server'); process.exit(1); } } catch {}
    work = fs.mkdtempSync(path.join(root, '..', 'ba-packages-'));
    const unit = path.join(work, 'unit');
    const EXCL = `--exclude=./node_modules --exclude=./backups --exclude=./waivers --exclude='./public/uploads' --exclude=./bookings.db --exclude=./config.json --exclude=./license.json --exclude=./VERSION --exclude='./*.log' --exclude=./.git`;
    execFileSync('bash', ['-c', `mkdir -p ${JSON.stringify(unit)} && cd ${JSON.stringify(root)} && tar ${EXCL} -cf - . | tar -xf - -C ${JSON.stringify(unit)} && cp -al ${JSON.stringify(path.join(root, 'node_modules'))} ${JSON.stringify(path.join(unit, 'node_modules'))}`]);
    fs.writeFileSync(path.join(unit, 'config.json'), JSON.stringify({
      businessName: 'Package Golf', setup: { completed: true, eulaAccepted: true },
      server: { port: PORT, businessName: 'Package Golf', adminPassword: PW, timezone: 'America/Chicago' },
      booking: { pricePerHalfHour: 20, openTime: '09:00', closeTime: '23:59', openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], windowDays: 30 }, waiver: { mode: 'off' },
      tax: { enabled: true, rate: 6, label: 'Sales Tax' },
      bays: [{ id: 'pk-b1', name: 'Bay 1', active: true }, { id: 'pk-b2', name: 'Bay 2', active: true }], updates: { listUrl: '' }
    }, null, 2));
    server = spawn(process.execPath, ['server.js'], { cwd: unit, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1', BA_WATCHDOG_OFF: '1', BA_UPDATE_LIST_URL: 'off', BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
    let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });   // (the emailed sign-in code, dry run)
    let up = false; for (let i = 0; i < 80; i++) { await sleep(300); try { if ((await fetch(HOST + '/api/time')).ok) { up = true; break; } } catch {} }
    if (!up) { ok('the unit booted', false); throw new Error('no unit'); }

    const AH = { 'x-admin-password': PW, 'Content-Type': 'application/json' };
    const api = async (m, p, body, h) => { const r = await fetch(HOST + p, { method: m, headers: h || AH, body: body === undefined ? undefined : JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch {} return { s: r.status, ok: r.ok, d }; };
    const pub = (m, p, body) => api(m, p, body, { 'Content-Type': 'application/json' });
    // the counter's taxes (Food 7%, Beverage 8%) and a small menu
    await api('POST', '/api/pos/tax-codes', { codes: [{ id: 'sim', name: 'Golf', rate: 0 }, { id: 'food', name: 'Prepared food', rate: 7 }, { id: 'beverage', name: 'Beverage', rate: 8 }] });
    const beer = (await api('POST', '/api/pos/menu/category', { name: 'Beer', tax_category: 'beverage', printer_role: 'bar' })).d.id;
    const food = (await api('POST', '/api/pos/menu/category', { name: 'Food', tax_category: 'food', printer_role: 'kitchen', sort: 2 })).d.id;
    const item = async (cat, name, cents) => (await api('POST', '/api/pos/menu/item', { category_id: cat, name, price_cents: cents })).d.id;
    const bud = await item(beer, 'Bud Light', 500), pitcher = await item(beer, 'Pitcher', 1800), coors = await item(beer, 'Coors Light', 500), pizza = await item(food, 'Pizza', 1600);
    const TUE = nextDow(2), WED = nextDow(3);

    // ── PK1 ──
    const p1 = await api('POST', '/api/pricing/packages', { name: 'Two and a Pitcher', words: 'Two hours on any bay and a pitcher of beer', minutes: 120, price_type: 'flat', price_cents: 6000, max_players: 4,
      includes: [{ kind: 'item', id: pitcher, qty: 1 }], tax_mode: 'split', tax_code: 'beverage', golf_cents: 4000 });
    const bad1 = await api('POST', '/api/pricing/packages', { minutes: 120, price_cents: 6000 });
    const bad2 = await api('POST', '/api/pricing/packages', { name: 'Too Much Golf', minutes: 120, price_cents: 6000, tax_mode: 'split', tax_code: 'beverage', golf_cents: 7000 });
    const bad3 = await api('POST', '/api/pricing/packages', { name: 'Odd Length', minutes: 100, price_cents: 6000 });
    const own = ((await api('GET', '/api/pricing/packages')).d || {}).packages || [];
    const o1 = own.find(p => p.name === 'Two and a Pitcher') || {};
    ok('PK1 a package saved by the owner and read back in words ("' + o1.includes_words + '", "' + o1.price_words + '", "' + o1.tax_words + '"); a nameless one, a golf part above the price and an odd length refused with their reasons',
       p1.ok && o1.minutes === 120 && o1.includes_words === '1 Pitcher' && o1.price_words === '$60 for up to 4 players' && /the golf part \(\$40\) taxed as a booking \(6%\), the rest as Beverage \(8%\)/.test(o1.tax_words || '')
       && bad1.s === 400 && /needs a name/.test(bad1.d.error) && bad2.s === 400 && /golf part is more than the price/.test(bad2.d.error) && bad3.s === 400 && /on the half hour/.test(bad3.d.error),
       { p1: p1.d, o1, bad: [bad1.d, bad2.d, bad3.d] });
    const PKG1 = o1.id;
    const p2 = await api('POST', '/api/pricing/packages', { name: 'Birthday Party', words: 'Two hours, a pizza for the table and two drinks each', minutes: 120, price_type: 'per_person', price_cents: 2500, min_players: 6, max_players: 10,
      includes: [{ kind: 'item', id: pizza, qty: 1 }, { kind: 'part', id: beer, qty: 2, per_person: true }], days: ['tue', 'sat'], start_from: '12:00', start_until: '18:00', tax_mode: 'code', tax_code: 'food' });
    const PKG2 = p2.d && p2.d.package && p2.d.package.id;

    // ── PK2 ──
    const list2 = (await pub('GET', '/api/bookings/packages')).d || {};
    const c1 = (list2.packages || []).find(p => p.id === PKG1) || {}, c2 = (list2.packages || []).find(p => p.id === PKG2) || {};
    ok('PK2 the booking page\'s list: each package as a customer reads it - its words, length, price, what it includes, when - and nothing internal',
       c1.name === 'Two and a Pitcher' && c1.length === '2 hours' && c1.price === '$60 for up to 4 players' && c1.includes === '1 Pitcher'
       && c2.price === '$25 a person (6 at the least, 10 at the most)' && c2.includes === '1 Pizza, 2 from Beer a person' && /Tue, Sat, starting 12 PM - 6 PM/.test(c2.when)
       && !('tax_mode' in c1) && !('golf_cents' in c1) && !('tax_code' in c1), { c1, c2 });

    // ── PK3 ──
    const q1 = (await pub('GET', `/api/bookings/package-quote?id=${PKG1}`)).d || {};
    const q2 = (await pub('GET', `/api/bookings/package-quote?id=${PKG2}&players=7`)).d || {};
    const q2few = await pub('GET', `/api/bookings/package-quote?id=${PKG2}&players=4`);
    ok('PK3 the quote, the numbers the charge uses: $60 split - $40 golf at 6% ($2.40) and $20 at Beverage 8% ($1.60), total $64.00; the party for 7 at $25 a person, $175 at Food 7% ($12.25), total $187.25; 4 players refused',
       q1.price_cents === 6000 && q1.tax && q1.tax.tax_cents === 400 && q1.total_cents === 6400 && q1.tax.lines.length === 2 && q1.tax.lines[0].cents === 4000 && q1.tax.lines[0].tax_cents === 240 && q1.tax.lines[1].tax_cents === 160
       && q2.price_cents === 17500 && q2.tax.tax_cents === 1225 && q2.total_cents === 18725 && q2few.s === 400 && /6 players at the least/.test(q2few.d.error),
       { q1, q2, few: q2few.d });

    // ── PK4 ──
    const book = (o) => pub('POST', '/api/bookings/create-payment-intent', Object.assign({ name: 'Pat Party', phone: '402-555-0101', email: '', bay_id: 'pk-b1' }, o));
    const wrongLen = await book({ date: TUE, start_time: '14:00', duration_minutes: 90, package_id: PKG2, players: 7 });
    const wrongDay = await book({ date: WED, start_time: '14:00', duration_minutes: 120, package_id: PKG2, players: 7 });
    const late = await book({ date: TUE, start_time: '19:00', duration_minutes: 120, package_id: PKG2, players: 7 });
    const withCode = await book({ date: TUE, start_time: '14:00', duration_minutes: 120, package_id: PKG2, players: 7, discount_code: 'ANY' });
    const b4 = await book({ date: TUE, start_time: '14:00', duration_minutes: 120, package_id: PKG2, players: 7 });
    const all4 = ((await api('GET', '/api/admin/bookings?per_page=200')).d || {});
    const rows4 = Array.isArray(all4) ? all4 : (all4.bookings || []);
    const row4 = rows4.find(r => r.id === b4.d.bookingId) || {};
    let snap4 = {}; try { snap4 = JSON.parse(row4.package_json || '{}'); } catch {}
    ok('PK4 booked online: 90 minutes, a Wednesday, a 7 PM start and a code refused with their reasons; then the party for 7 on a Tuesday at 2 PM - $175, the booking\'s own copy of the package (a pizza, 14 from Beer: 2 a person times 7)',
       wrongLen.s === 400 && /2 hours of bay time/.test(wrongLen.d.error) && wrongDay.s === 400 && /offered on Tue, Sat/.test(wrongDay.d.error) && late.s === 400 && /starts by 18:00/.test(late.d.error)
       && withCode.s === 400 && /cannot be used with a package/.test(withCode.d.error)
       && b4.ok && !!b4.d.bookingId && b4.d.package && b4.d.package.name === 'Birthday Party' && row4.price_cents === 17500 && row4.package_name === 'Birthday Party' && row4.status === 'active'
       && snap4.players === 7 && (snap4.includes || []).length === 2 && snap4.includes[0].qty === 1 && snap4.includes[1].qty === 14 && snap4.tax && snap4.tax.tax_cents === 1225,
       { wrongLen: wrongLen.d, wrongDay: wrongDay.d, late: late.d, withCode: withCode.d, b4: b4.d, row4: { price: row4.price_cents, pkg: row4.package_name, status: row4.status }, snap4 });
    const BK = b4.d.bookingId;

    // ── PK5 ── the counter, on the booking's own tabs
    const tabA = ((await api('POST', '/api/pos/tabs', { label: 'Pat', booking_id: BK })).d || {}).tab || {};
    const tabB = ((await api('POST', '/api/pos/tabs', { label: 'Sam', booking_id: BK })).d || {}).tab || {};
    const order = (tab, lines) => api('POST', `/api/pos/tabs/${tab.id}/order`, { lines });
    await order(tabA, [{ item_id: pizza, qty: 3 }]);
    await order(tabA, [{ item_id: bud, qty: 9 }]);
    await order(tabA, [{ item_id: bud, qty: 1 }]);
    await order(tabB, [{ item_id: coors, qty: 6 }]);
    const tA = ((await api('GET', `/api/pos/tabs/${tabA.id}`)).d || {}).tab || {}, tB = ((await api('GET', `/api/pos/tabs/${tabB.id}`)).d || {}).tab || {};
    const lines = (t, name) => (t.items || []).filter(i => i.name === name && i.status !== 'voided').map(i => [i.qty, i.unit_price_cents, /Included in Birthday Party/.test(i.note || '')]);
    const pizzaA = lines(tA, 'Pizza'), budA = lines(tA, 'Bud Light'), coorsB = lines(tB, 'Coors Light');
    // a void gives back what it held: the included single Bud Light voided, then one more Coors Light is included, the next charged
    const incBud = (tA.items || []).find(i => i.name === 'Bud Light' && /Included/.test(i.note || '') && i.qty === 1);
    const v = incBud ? await api('POST', `/api/pos/items/${incBud.id}/void`, { reason: 'spilled' }) : { ok: false };
    await order(tabB, [{ item_id: coors, qty: 1 }]);
    await order(tabB, [{ item_id: coors, qty: 1 }]);
    const tB2 = ((await api('GET', `/api/pos/tabs/${tabB.id}`)).d || {}).tab || {};
    const coorsB2 = lines(tB2, 'Coors Light');
    ok('PK5 at the counter on the booking\'s tabs: 1 pizza included and 2 charged ($16 each); of 14 beers a person\'s share, 10 Bud Light (9, then 1) on one tab and 4 of 6 Coors Light on another included, 2 charged; a void gives one back - the next Coors included, the one after charged',
       JSON.stringify(pizzaA) === '[[1,0,true],[2,1600,false]]' && JSON.stringify(budA) === '[[9,0,true],[1,0,true]]' && JSON.stringify(coorsB) === '[[4,0,true],[2,500,false]]'
       && v.ok && JSON.stringify(coorsB2) === '[[4,0,true],[2,500,false],[1,0,true],[1,500,false]]'
       && tA.subtotal_cents === 3200 && tB2.subtotal_cents === 1500,
       { pizzaA, budA, coorsB, voided: v.ok, coorsB2, subA: tA.subtotal_cents, subB: tB2.subtotal_cents });

    // ── PK6 ──
    await api('POST', '/api/pricing/packages', Object.assign({}, o1, { id: PKG2, name: 'Birthday Party', minutes: 120, price_type: 'per_person', price_cents: 3000, min_players: 6, max_players: 10, includes: [{ kind: 'item', id: pizza, qty: 2 }], days: ['tue', 'sat'], start_from: '12:00', start_until: '18:00', tax_mode: 'code', tax_code: 'food' }));
    const gone = await api('DELETE', `/api/pricing/packages/${PKG2}`);
    const rowsAfter = (((await api('GET', '/api/admin/bookings?per_page=200')).d) || {});
    const row6 = (Array.isArray(rowsAfter) ? rowsAfter : (rowsAfter.bookings || [])).find(r => r.id === BK) || {};
    let snap6 = {}; try { snap6 = JSON.parse(row6.package_json || '{}'); } catch {}
    ok('PK6 the package changed ($30 a person, two pizzas) and then taken off: the booking keeps the package as it was bought ($175, a pizza and 14 beers)',
       gone.ok && row6.price_cents === 17500 && row6.package_name === 'Birthday Party' && snap6.price_cents === 17500 && snap6.includes[0].qty === 1 && snap6.includes[1].qty === 14, { gone: gone.d, row6: row6.price_cents, snap6 });

    // ── PK7 ── a facility with no food and drink at the counter (maintainer: "not every place will be staffed with food and drink")
    const cfg7 = (await api('GET', '/api/admin/config')).d; cfg7.pos = Object.assign({}, cfg7.pos, { fnb: false }); await api('POST', '/api/admin/config', cfg7);
    const inc7 = await api('POST', '/api/pricing/packages', { name: 'Pitcher Night', minutes: 120, price_cents: 5000, includes: [{ kind: 'item', id: pitcher, qty: 1 }] });
    const bay7 = await api('POST', '/api/pricing/packages', { name: 'Two Hour Block', minutes: 120, price_cents: 5000 });
    cfg7.pos.fnb = true; await api('POST', '/api/admin/config', cfg7);
    ok('PK7 with no food and drink at the counter: a package that includes a pitcher is refused, saying so ("' + (inc7.d && inc7.d.error || '').slice(0, 80) + '..."); a package of bay time only is saved',
       inc7.s === 400 && /no food and drink at the counter/.test(inc7.d.error || '') && bay7.ok, { inc7: inc7.d, bay7: bay7.d && bay7.d.package && bay7.d.package.name });

    // ── PK8 ── a walk-in party sold a package at the counter (maintainer: "make it possible"): the pad's quote, the booking, check-in with
    // two seats - each share split by the package's own tax (its golf part as golf, the rest as Beverage) - and the included pitcher
    const q8 = (await api('GET', `/api/staff/quote?bay_id=pk-b2&date=${TUE}&start_time=10:00&duration_minutes=120&package_id=${PKG1}&players=2`)).d || {};
    const s8 = await api('POST', '/api/staff/bookings', { bay_id: 'pk-b2', date: TUE, start_time: '10:00', duration_minutes: 120, name: 'Walk Party', phone: '402-555-0166', package_id: PKG1, players: 2 });
    const BK8 = s8.d && s8.d.booking && s8.d.booking.id;
    const c8 = await api('POST', '/api/staff/checkin', { booking_id: BK8, seats: [{ name: 'Walk One' }, { name: 'Walk Two' }] });
    const tabs8 = (((await api('GET', '/api/admin/bookings?per_page=200')).d) || {});
    const row8 = (Array.isArray(tabs8) ? tabs8 : (tabs8.bookings || [])).find(r => r.id === BK8) || {};
    const seatTabs = ((c8.d && (c8.d.seats || c8.d.tabs)) || []).map(x => x.tab_id || (x.tab && x.tab.id) || x.id).filter(Boolean);
    const t8 = []; for (const id of seatTabs) t8.push((((await api('GET', `/api/pos/tabs/${id}`)).d) || {}).tab || {});
    if (t8[0] && t8[0].id) await order(t8[0], [{ item_id: pitcher, qty: 1 }]);
    const t8a = t8[0] && t8[0].id ? ((((await api('GET', `/api/pos/tabs/${t8[0].id}`)).d) || {}).tab || {}) : {};
    const golf8 = t8.map(t => (t.items || []).filter(i => i.kind === 'golf').map(i => [i.unit_price_cents, i.tax_category]).sort((a, b) => b[0] - a[0]));
    ok('PK8 a walk-in party sold "Two and a Pitcher" at the counter: the pad\'s quote $60, the booking carries the package ($60 at the door); checked in with two seats, each $30 share split by the package\'s tax - $20 as golf, $10 as Beverage (8%: $0.80 a tab); the pitcher at $0 on the first tab',
       q8.price_cents === 6000 && s8.ok && row8.package_name === 'Two and a Pitcher' && row8.price_cents === 6000 && c8.ok
       && JSON.stringify(golf8) === JSON.stringify([[[2000, 'sim'], [1000, 'beverage']], [[2000, 'sim'], [1000, 'beverage']]]) && t8.every(t => t.tax_cents === 80)
       && (t8a.items || []).some(i => i.name === 'Pitcher' && i.unit_price_cents === 0 && /Included in Two and a Pitcher/.test(i.note || '')),
       { q8, s8: s8.d, row8: [row8.package_name, row8.price_cents], c8: c8.ok ? Object.keys(c8.d || {}) : c8.d, golf8, tax8: t8.map(t => t.tax_cents), pitcher: (t8a.items || []).filter(i => i.name === 'Pitcher').map(i => [i.unit_price_cents, i.note]) });

    // ── DL1 ──
    const d1 = await api('POST', '/api/pricing/deals', { name: 'Tuesday Last Half Free', kind: 'free_minutes', value: 30, min_minutes: 120, days: ['tue'] });
    const calc = async (date, mins) => (await pub('GET', `/api/pricing/calculate?date=${date}&start_time=15:00&duration_minutes=${mins}&bay_id=pk-b2`)).d || {};
    const tue120 = await calc(TUE, 120), tue90 = await calc(TUE, 90), wed120 = await calc(WED, 120);
    const dealsList = ((await pub('GET', '/api/bookings/packages')).d || {}).deals || [];
    ok('DL1 "book 2 hours, the last 30 minutes free - Tuesdays": 2 hours on a Tuesday is $60 not $80 (the deal named, $80 before it, the tax on $60); 90 minutes, or a Wednesday, the plain price; the booking page lists the deal',
       d1.ok && tue120.priceCents === 6000 && tue120.originalCents === 8000 && tue120.deal && tue120.deal.name === 'Tuesday Last Half Free' && tue120.deal.cents === 2000 && tue120.tax && tue120.tax.tax_cents === 360
       && tue90.priceCents === 6000 && !tue90.deal && wed120.priceCents === 8000 && !wed120.deal
       && dealsList.some(d => d.name === 'Tuesday Last Half Free' && /Book 2 hours or more, the last 30 minutes free - Tues/.test(d.words)),
       { d1: d1.d, tue120, tue90: [tue90.priceCents, tue90.deal], wed120: [wed120.priceCents, wed120.deal], dealsList });

    // ── DL2 ──
    const b2 = await book({ date: TUE, start_time: '16:00', duration_minutes: 120, bay_id: 'pk-b2', name: 'Dee Deal' });
    await api('POST', '/api/pricing/codes', { code: 'TENOFF', type: 'percentage', value: 10 });
    const code2 = await pub('POST', '/api/pricing/validate-code', { code: 'TENOFF', phone: '402-555-0199', date: TUE, start_time: '18:00', duration_minutes: 120 });
    const staff2 = await api('POST', '/api/staff/bookings', { bay_id: 'pk-b1', date: TUE, start_time: '18:30', duration_minutes: 120, name: 'Walk In', phone: '402-555-0177' });
    const rowsD = (((await api('GET', '/api/admin/bookings?per_page=200')).d) || {}), allD = Array.isArray(rowsD) ? rowsD : (rowsD.bookings || []);
    const rowB2 = allD.find(r => r.id === b2.d.bookingId) || {}, rowS2 = allD.find(r => r.name === 'Walk In') || {};
    ok('DL2 booked online on a Tuesday for 2 hours: charged $60 with the deal kept on the booking; a 10% code is worked from $60 ($6 off); the counter\'s own booking takes the deal too ($60) and keeps it',
       b2.ok && b2.d.deal && b2.d.deal.name === 'Tuesday Last Half Free' && rowB2.price_cents === 6000 && rowB2.deal_name === 'Tuesday Last Half Free' && rowB2.deal_cents === 2000
       && code2.d && code2.d.valid && code2.d.discountCents === 600
       && staff2.ok && rowS2.price_cents === 6000 && rowS2.deal_name === 'Tuesday Last Half Free',
       { b2: b2.d, rowB2: [rowB2.price_cents, rowB2.deal_name, rowB2.deal_cents], code2: code2.d, staff2: staff2.d, rowS2: [rowS2.price_cents, rowS2.deal_name] });

    // ── DL3 ──
    const d3 = await api('POST', '/api/pricing/deals', { name: 'Tuesday Quarter Off', kind: 'percent', value: 25, days: ['tue'] });
    const tue120b = await calc(TUE, 120);
    await api('POST', '/api/pricing/deals', Object.assign({}, d3.d.deal, { active: false }));
    const tue120c = await calc(TUE, 120);
    const tue90b = (await calc(TUE, 90));
    await api('POST', '/api/pricing/deals', Object.assign({}, d3.d.deal, { active: true, value: 40 }));
    const tue120d = await calc(TUE, 120);
    ok('DL3 never two deals at once: with 25% off on Tuesdays as well, 2 hours is $60 (one deal of $20, not $40 off); at 40% off the bigger is taken ($48, "Tuesday Quarter Off"); switched off, it is not taken ($60, the last half hour free); 90 minutes gets only what fits it',
       tue120b.priceCents === 6000 && tue120d.priceCents === 4800 && tue120d.deal && tue120d.deal.name === 'Tuesday Quarter Off' && tue120c.priceCents === 6000 && tue120c.deal && tue120c.deal.name === 'Tuesday Last Half Free' && tue90b.priceCents === 6000 && !tue90b.deal,
       { tue120b: [tue120b.priceCents, tue120b.deal], tue120c: [tue120c.priceCents, tue120c.deal && tue120c.deal.name], tue90b: [tue90b.priceCents, tue90b.deal], tue120d: [tue120d.priceCents, tue120d.deal && tue120d.deal.name] });

    // ── DL4 ── free things with a booking
    const free4 = await api('POST', '/api/pricing/deals', { name: 'Tuesday Pitchers', kind: 'free_items', includes: [{ kind: 'item', id: pitcher, qty: 2 }], min_minutes: 120, days: ['tue'] });
    const none4 = await api('POST', '/api/pricing/deals', { name: 'Nothing Free', kind: 'free_items', includes: [], min_minutes: 120 });
    const cfg4 = (await api('GET', '/api/admin/config')).d; cfg4.pos = Object.assign({}, cfg4.pos, { fnb: false }); await api('POST', '/api/admin/config', cfg4);
    const fnb4 = await api('POST', '/api/pricing/deals', { name: 'No Counter Pitchers', kind: 'free_items', includes: [{ kind: 'item', id: pitcher, qty: 1 }] });
    cfg4.pos.fnb = true; await api('POST', '/api/admin/config', cfg4);
    const t4 = await calc(TUE, 120), t4s = await calc(TUE, 90), w4 = await calc(WED, 120);
    const list4 = ((await pub('GET', '/api/bookings/packages')).d || {}).deals || [];
    ok('DL4 "book 2 hours, get 2 pitchers free - Tuesdays": the bay\'s price is as before ($48 with the 40% deal still taken), the booking page says "2 Pitchers free at the front desk"; 90 minutes or a Wednesday says nothing; nothing free, or no counter, refused',
       free4.ok && t4.priceCents === 4800 && t4.deal && t4.deal.name === 'Tuesday Quarter Off' && t4.freeItems && /^2 Pitchers free at the front desk \(Tuesday Pitchers\)$/.test(t4.freeItems.words)
       && !t4s.freeItems && !w4.freeItems && w4.priceCents === 8000
       && list4.some(d => d.name === 'Tuesday Pitchers' && /^Book 2 hours or more, get 2 Pitchers free at the front desk - Tuesdays$/.test(d.words))
       && none4.s === 400 && /say what comes free/.test(none4.d.error || '') && fnb4.s === 400 && /no food and drink at the counter/.test(fnb4.d.error || ''),
       { free4: free4.d, t4: [t4.priceCents, t4.deal && t4.deal.name, t4.freeItems], t4s: t4s.freeItems, w4: [w4.priceCents, w4.freeItems], list4, none4: none4.d, fnb4: fnb4.d });

    // ── DL5 ── each booking keeps what comes with it; the counter rings it up at $0
    const b5 = await book({ date: TUE, start_time: '21:00', duration_minutes: 120, bay_id: 'pk-b1', name: 'Fran Free', phone: '402-555-0155', email: 'fran.free@example.com' });
    const s5 = await api('POST', '/api/staff/bookings', { bay_id: 'pk-b2', date: TUE, start_time: '20:30', duration_minutes: 120, name: 'Counter Cal', phone: '402-555-0156' });
    const p5 = await book({ date: TUE, start_time: '12:00', duration_minutes: 120, bay_id: 'pk-b2', package_id: PKG1, name: 'Pack Pat', phone: '402-555-0157' });
    const rows5 = (((await api('GET', '/api/admin/bookings?per_page=300')).d) || {}), all5 = Array.isArray(rows5) ? rows5 : (rows5.bookings || []);
    const r5 = all5.find(r => r.id === b5.d.bookingId) || {}, rs5 = all5.find(r => r.name === 'Counter Cal') || {}, rp5 = all5.find(r => r.id === (p5.d || {}).bookingId) || {};
    let snap5 = {}; try { snap5 = JSON.parse(r5.deal_items_json || '{}'); } catch {}
    const today5 = ((await api('GET', `/api/staff/today?date=${TUE}`)).d) || {};
    const staffRow = ((today5.bookings || today5.active || [])).find(b => b.id === b5.d.bookingId) || {};
    // (the package's own chip on the pad's list read package_name the list never selected - found here, Oct 22 2026, night)
    const staffPkg = ((today5.bookings || [])).find(b => b.id === (p5.d || {}).bookingId) || {};
    await pub('POST', '/api/customer/request-pin', { email: 'fran.free@example.com' }); await sleep(300);
    const code5 = ((out.match(/verification code: (\d{6})/g) || []).pop() || '').slice(-6);
    const mine5 = ((await pub('POST', '/api/customer/verify-pin', { email: 'fran.free@example.com', pin: code5 })).d) || {};
    const myRow = ((mine5.bookings || [])).find(b => b.id === b5.d.bookingId) || {};
    const tab5 = ((await api('POST', '/api/pos/tabs', { label: 'Fran', booking_id: b5.d.bookingId })).d || {}).tab || {};
    await order(tab5, [{ item_id: pitcher, qty: 3 }]);
    const t5 = ((await api('GET', `/api/pos/tabs/${tab5.id}`)).d || {}).tab || {};
    const pit5 = (t5.items || []).filter(i => i.name === 'Pitcher' && i.status !== 'voided').map(i => [i.qty, i.unit_price_cents, /Included in Tuesday Pitchers/.test(i.note || '')]);
    ok('DL5 booked online, at the counter, and as a package: the first two keep "2 Pitchers" (the package does not); the reply, the staff list (and the package\'s own chip) and /my-booking say it; on the booking\'s tab 2 pitchers at $0, the third $18',
       b5.ok && b5.d.freeItems === '2 Pitchers free at the front desk (Tuesday Pitchers)' && snap5.name === 'Tuesday Pitchers' && (snap5.includes || [])[0] && snap5.includes[0].qty === 2
       && s5.ok && /Tuesday Pitchers/.test(rs5.deal_items_json || '') && p5.ok && !rp5.deal_items_json
       && staffRow.deal_items === '2 Pitchers' && staffPkg.package_name === 'Two and a Pitcher' && myRow.free_items === '2 Pitchers free at the front desk (Tuesday Pitchers)'
       && JSON.stringify(pit5) === '[[2,0,true],[1,1800,false]]' && t5.subtotal_cents === 1800,
       { b5: b5.d && b5.d.freeItems, snap5, rs5: rs5.deal_items_json, rp5: rp5.deal_items_json, staffRow: staffRow.deal_items, staffPkg: staffPkg.package_name, staffKeys: Object.keys(today5), myRow: myRow.free_items, myKeys: Object.keys(mine5), pit5, sub5: t5.subtotal_cents });

    // ── DL6 (Oct 23 2026, from the research into how venues run these) ── a minutes-free deal needs the booking it comes with (with
    // none, "the last 30 minutes free" made a 30-minute booking free); the deal's words read at a glance ("the last hour free",
    // "Weekdays", "start times", "through Nov 30"); a rate checked at the door says what to bring in the reply, the confirmation email
    // and /my-booking - not only on the staff pad
    const nomin6 = await api('POST', '/api/pricing/deals', { name: 'Last Half Any Length', kind: 'free_minutes', value: 30, days: ['wed'] });
    const end6 = (() => { const t = new Date(TUE + 'T12:00:00'); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + 40, 12).toISOString().slice(0, 10); })();
    const wk6 = await api('POST', '/api/pricing/deals', { name: 'Weekday Hour Free', kind: 'free_minutes', value: 60, min_minutes: 180, days: ['mon', 'tue', 'wed', 'thu', 'fri'], start_from: '10:00', start_until: '12:00', date_to: end6 });
    const wk6row = (((await api('GET', '/api/pricing/deals')).d || {}).deals || []).find(d => d.name === 'Weekday Hour Free') || {};
    const endWords6 = new Date(end6 + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    if (wk6row.id) await api('DELETE', `/api/pricing/deals/${wk6row.id}`);
    const vet6 = await api('POST', '/api/pricing/codes', { code: 'VET15', type: 'percentage', value: 15, per_phone_limit: null, door_check: 'a veteran ID' });
    const b6 = await book({ date: WED, start_time: '14:00', duration_minutes: 60, bay_id: 'pk-b1', name: 'Vic Vet', phone: '402-555-0166', email: 'vic.vet@example.com', discount_code: 'VET15' });
    await sleep(800);
    await pub('POST', '/api/customer/request-pin', { email: 'vic.vet@example.com' }); await sleep(300);
    const code6 = ((out.match(/verification code: (\d{6})/g) || []).pop() || '').slice(-6);
    const mine6 = ((await pub('POST', '/api/customer/verify-pin', { email: 'vic.vet@example.com', pin: code6 })).d) || {};
    const my6 = ((mine6.bookings || [])).find(b => b.id === (b6.d || {}).bookingId) || {};
    ok('DL6 a minutes-free deal with no booking named is refused; the words read at a glance ("the last hour free - Weekdays, start times 10 AM - 12 PM (through ' + endWords6 + ')"); a code checked at the door says what to bring in the booking\'s reply, its confirmation email and /my-booking',
       nomin6.s === 400 && /how long the booking must be/.test(nomin6.d.error || '')
       && wk6.ok && wk6row.words_auto === `Book 3 hours or more, the last hour free - Weekdays, start times 10 AM - 12 PM (through ${endWords6})`
       && vet6.ok && b6.ok && b6.d.doorCheck === 'a veteran ID - it is checked at the front desk (VET15)'
       && /BRING WITH YOU: a veteran ID - it is checked at the front desk for your VET15 rate\./.test(out)
       && my6.door_check === 'a veteran ID - it is checked at the front desk (VET15)' && !('discount_code_id' in my6),
       { nomin6: nomin6.d, words: wk6row.words_auto, b6: b6.d && [b6.d.doorCheck, b6.d.error], mailed: /BRING WITH YOU/.test(out), my6: [my6.door_check, Object.keys(my6).length] });
  } catch (e) {
    ok('the battery ran to the end', false, String(e && e.stack || e).slice(0, 500));
  } finally {
    console.log(`\nPACKAGES: ${pass} passed, ${fail} failed`);
    cleanup();
    process.exit(fail ? 1 : 0);
  }
})();
