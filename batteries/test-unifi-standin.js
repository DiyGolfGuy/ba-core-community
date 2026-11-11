// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-unifi-standin.js — WHAT THE CONSOLE CAN DO TO US (Sep 16 2026)
//
// Rule 27's stand-in reader and rule 29's battery clause, applied to the one
// integration the bench cannot own. The audit of Sep 16 found that both
// hand-made UniFi stand-ins could emit exactly TWO non-success states between
// them, so every UniFi assertion in an 81-battery green suite was a tautology:
// the console agreed with whatever we sent it.
//
// This battery drives the PRODUCT'S OWN SERVICE at a console that can fail the
// way Ubiquiti's reference says a real one fails. Section A proves the stand-in
// itself can produce each state - a fault table nothing exercises is the same
// problem one step back. Sections B onward are the product under each.
//
// Every assertion here is written to what the product SHOULD do. Recording which
// ones fail before the fix is the point (the negative-proof doctrine); the
// fail-first is in the ledger.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 320) : '')); } };

const root = __dirname;
const cfgPath = path.join(root, 'config.json');
const PORT = 12445;

function writeCfg(extra) {
  fs.writeFileSync(cfgPath, JSON.stringify(Object.assign({
    businessName: 'Standin', setup: { completed: true },
    booking: { staffedAccess: false, doorCodeLeadMins: 30, doorCodeLagMins: 10 },
    doorAccess: { provider: 'unifi' },
    unifiAccess: { host: '127.0.0.1', apiToken: 'tok-123', doorIds: ['door:door-front'],
                   pinLength: 4, apiStyle: 'documented', memberAccess: { enabled: true } },
    bays: [{ id: 'bay1', name: 'B1', active: true }],
    server: { port: 3091 }
  }, extra || {})));
}

(async () => {
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  writeCfg();
  const db = require('./services/db');
  await db.initDb();
  const { startConsole } = require('./tools/unifi-console-standin');
  const unifi = require('./services/unifiaccess');

  const c = await startConsole({ port: PORT, token: 'tok-123' });
  const reset = (f) => { c.set(Object.assign({}, require('./tools/unifi-console-standin').DEFAULT_FAULTS, { token: 'tok-123' }, f || {})); };
  const bk = (id, pin) => ({ id, name: 'Cust ' + id, date: '2026-09-20', start_time: '10:00',
                             end_time: '11:00', end_date: '2026-09-20', bay_id: 'bay1', forcePin: pin });
  const caught = async (fn) => { try { const v = await fn(); return { ok: true, v }; } catch (e) { return { ok: false, e: e.message }; } };

  console.log('\n── A. the stand-in can produce what the real console can ──');
  // A1 the happy path still works, or nothing below means anything
  reset();
  {
    const d = await caught(() => unifi.listDoors());
    ok('A1 the stand-in serves doors on the documented transport', d.ok && d.v.length === 2, d);
  }
  // A2 401 - the state neither old stand-in could reach
  reset({ token: 'a-different-token' });
  {
    const r = await caught(() => unifi.listDoors());
    ok('A2 a wrong token is refused 401 and the product says so in the owner\'s words',
       !r.ok && /auth failed \(401\)/.test(r.e), r);
  }
  // A3 403 by scope
  reset({ scopes: ['edit:visitor'] });
  {
    const r = await caught(() => unifi.listDoors());
    ok('A3 a token without view:space is refused 403', !r.ok && /403/.test(r.e), r);
  }
  // A4 the documented error envelope on HTTP 200
  reset({ failNext: { code: 'CODE_CREDS_PIN_CODE_CREDS_ALREADY_EXIST', times: 1 } });
  {
    const r = await caught(() => unifi.listDoors());
    ok('A4 a 200 carrying a non-SUCCESS code is read as a failure, not as success',
       !r.ok && /ALREADY_EXIST/.test(r.e), r);
  }
  // A5 a 200 that is not the console at all
  reset({ htmlBody: true });
  {
    const r = await caught(() => unifi.listDoors());
    ok('A5 an HTTP 200 login page is NOT accepted as an empty door list', !r.ok, r);
  }
  // A6 429
  reset({ rateLimitAfter: 0 });
  c.set({ rateLimitAfter: 1 });
  { await caught(() => unifi.listDoors());
    const r = await caught(() => unifi.listDoors());
    ok('A6 the stand-in can answer 429', !r.ok && /429/.test(r.e), r); }
  // A7 slower than our 8 s timeout
  reset({ slowMs: 9000 });
  {
    const t0 = Date.now();
    const r = await caught(() => unifi.listDoors());
    ok('A7 the stand-in can outlast the 8 s client timeout', !r.ok && Date.now() - t0 >= 7500, { ms: Date.now() - t0, r });
  }
  // A8 the page-size cap and the pagination sibling
  reset({ pageSizeCap: 10 });
  {
    c.seed(Array.from({ length: 25 }, (_, i) => ({ id: 'seed-' + i, first_name: 'Golf', remarks: 'Booking old-' + i, end_time: 1 })));
    const all = await caught(() => unifi.listAllVisitors(100));
    ok('A8 a console that caps page_size does not truncate our read of the visitor list',
       all.ok && all.v.length === 25, { got: all.ok ? all.v.length : all.e });
  }
  // A9 the documented-response field set (the sweep's premise)
  reset({ visitorListFields: 'documented-response' });
  {
    const rows = await caught(() => unifi.listAllVisitors(100));
    const anyOurs = rows.ok && rows.v.some(v => unifi.ourBookingId(v));
    ok('A9 the stand-in can withhold remarks/end_time the way the reference\'s response samples do',
       rows.ok && !anyOurs, { rows: rows.ok ? rows.v.length : rows.e, anyOurs });
  }

  console.log('\n── B. the product under each state ──');
  reset();
  // B1 U17 - a login page must never read as "connected, zero doors"
  c.set({ htmlBody: true });
  {
    const t = await caught(() => unifi.testConnection());
    ok('B1 Test Connection does NOT report success against a console that served HTML', !t.ok, t);
  }
  // B2 U19 - the schedule is created exactly once
  reset();
  {
    const r1 = await caught(() => unifi.ensurePolicy('k1', 'One', ['door:door-front']));
    const r2 = await caught(() => unifi.ensurePolicy('k2', 'Two', ['door:door-bay']));
    ok('B2 two managed policies need ONE schedule, created once',
       r1.ok && r2.ok && c.state.counters.schedulesCreated === 1,
       { schedules: c.state.counters.schedulesCreated, r1: r1.ok || r1.e, r2: r2.ok || r2.e });
  }
  // B3 U2 - the PIN collision, in its two real shapes.
  // (My first cut of this asserted that a FORCED pin gets re-rolled. It does not,
  // and it must not: a forced pin is the MEMBER'S OWN pin, and silently handing
  // them a different one is worse than refusing. The invariants below are the
  // ones that actually matter.)
  reset();
  {
    const a = await caught(() => unifi.createBookingVisitor(bk('dup-a', '1234')));
    const b = await caught(() => unifi.createBookingVisitor(bk('dup-b', '1234')));
    ok('B3a a FORCED pin already on the console is refused in the owner\'s words, never silently swapped',
       a.ok && !b.ok && /already in use/i.test(String(b.e)), { a: a.ok || a.e, b: b.ok || b.e });
    const avoided = unifi.generatePin(['1111', '2222']);
    ok('B3b a GENERATED pin never lands on one the console already holds',
       avoided !== '1111' && avoided !== '2222' && /^\d+$/.test(String(avoided)), { avoided });
  }
  // B4 U7 - we cannot read the console's PIN setting from here (that needs a real
  // console). What we CAN promise is that a mismatch never reaches a customer as a
  // mystery: the message names the one number to change, and it is recorded where
  // an owner will find it rather than only shown to whoever tripped it.
  reset({ pinLength: 6 });
  {
    const before = db.db.prepare("SELECT COUNT(*) c FROM admin_log WHERE event='UNIFI_PIN_LENGTH_MISMATCH'").get().c;
    const r = await caught(() => unifi.createBookingVisitor(bk('len-a')));
    const after = db.db.prepare("SELECT COUNT(*) c FROM admin_log WHERE event='UNIFI_PIN_LENGTH_MISMATCH'").get().c;
    ok('B4 a console whose PIN length disagrees with ours says which setting to change, and records it for the owner',
       !r.ok && /PIN Length/.test(String(r.e)) && after === before + 1, { e: r.ok ? 'no error' : r.e, logged: after - before });
  }
  // B5 U5 - the visitor's door grant must land whichever key the console reads
  reset({ visitorGrantKey: 'resource' });
  {
    const r = await caught(() => unifi.createBookingVisitor(bk('grant-a')));
    const v = r.ok && c.state.visitors[String(r.v.visitorId)];
    ok('B5 a console that reads the SINGULAR resource key still gets the doors',
       !!(v && v.resources && v.resources.length), { r: r.ok || r.e, got: v && v.resources });
  }
  // B6 U18 - a visitor created with no doors must be caught at creation
  reset({ visitorGrantKey: 'resource' });
  {
    // the console grants nothing because it read a key we did not send
    const before = Object.keys(c.state.visitors).length;
    const r = await caught(() => unifi.createBookingVisitor(bk('nodoor-a')));
    const v = r.ok && c.state.visitors[String(r.v.visitorId)];
    const granted = v && (v.resources || []).length;
    ok('B6 a visitor the console granted NO doors is a failure, never a code we hand out',
       !r.ok || granted > 0, { created: Object.keys(c.state.visitors).length - before, granted, r: r.ok ? 'returned a pin' : r.e });
  }
  // B7 U13 - a slow console must not mint three visitors for one booking
  reset({ slowMs: 9000 });
  {
    const before = c.state.counters.visitorsCreated;
    await caught(() => unifi.createBookingVisitor(bk('slow-a')));
    const made = c.state.counters.visitorsCreated - before;
    ok('B7 a console slower than the timeout produces AT MOST one visitor for one booking', made <= 1, { made });
  }
  // B8 U22 - a 429 during a member sync must not create a second console user
  reset();
  {
    const D = db.db;
    D.prepare("INSERT OR REPLACE INTO membership_tiers (id, name, discount_type, discount_value, unifi_static_doors) VALUES ('t1','T','percentage',0,?)").run(JSON.stringify(['door:door-front']));
    D.prepare("INSERT OR REPLACE INTO members (id, name, phone, pin, tier_id, status, unifi_user_id) VALUES ('m1','Mem','5550000000','123456','t1','active','')").run();
    db.save();
    const first = await caught(() => unifi.syncMember({ id: 'm1', name: 'Mem', pin: '123456', status: 'active' }, { id: 't1', name: 'T', unifi_static_doors: JSON.stringify(['door:door-front']) }));
    const uid = first.ok && first.v.userId;
    const before = c.state.counters.usersCreated;
    c.set({ failNext: { code: 'CODE_SYSTEM_ERROR', times: 1 } });
    await caught(() => unifi.syncMember({ id: 'm1', name: 'Mem', pin: '123456', status: 'active', unifi_user_id: uid }, { id: 't1', name: 'T', unifi_static_doors: JSON.stringify(['door:door-front']) }));
    ok('B8 a transient console error during a member sync never creates a SECOND console user',
       c.state.counters.usersCreated === before, { before, after: c.state.counters.usersCreated });
  }
  // B9 U14/U21 - an unreadable policy list must never be written back as empty
  reset();
  {
    const uid = Object.keys(c.state.users)[0];
    if (uid) {
      c.state.users[uid].policies = ['pol-keep-1', 'pol-keep-2'];
      const c2 = await startConsole({ port: 12446, token: 'tok-123', expandPolicies: false });
      await c2.stop();  // shape check only - the real assertion is below on this console
      const r = await caught(() => unifi.boostMemberForBooking(
        { id: 'boost-a', bay_id: 'bay1' }, { name: 'Mem', pin: '123456', tier_id: 't1', unifi_user_id: uid }));
      const after = c.state.users[uid].policies;
      ok('B9 a boost never drops a policy the member already had',
         after.includes('pol-keep-1') && after.includes('pol-keep-2'), { r: r.ok || r.e, after });
    } else ok('B9 (skipped - no console user to boost)', true);
  }
  // B10 U23 - the sweep must work whatever the list route returns
  reset({ visitorListFields: 'documented-response' });
  {
    const D = db.db;
    D.prepare("INSERT OR REPLACE INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status, remotelock_person_id) VALUES ('sw-1','bay1','B1','Old','555','2026-09-01','10:00','11:00',60,0,'completed','unifi:vis-sweep-1')").run();
    db.save();
    c.seed([{ id: 'vis-sweep-1', first_name: 'Golf', last_name: 'Old', remarks: 'Booking sw-1', end_time: 1 }]);
    const out = await caught(() => unifi.sweepExpiredVisitors({ now: Date.now(), graceMins: 1 }));
    const removed = out.ok && (out.v.removed || []).includes('vis-sweep-1');
    ok('B10 the nightly sweep removes OUR expired visitor even when the list omits remarks and end_time',
       removed, out.ok ? out.v : out.e);
  }
  // B11 U26 - a live credential with the provider turned off is never "revoked"
  reset();
  {
    const cfg = JSON.parse(fs.readFileSync(cfgPath));
    cfg.doorAccess = { provider: '' }; cfg.unifiAccess = {};
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    delete require.cache[require.resolve('./services/config')];
    const doorlock = require('./services/doorlock');
    const r = await caught(() => doorlock.revokeDoorCode('unifi:vis-9'));
    ok('B11 a live door credential is NOT reported revoked just because the provider was switched off',
       r.ok && r.v && r.v.ok !== true, r.ok ? r.v : r.e);
    writeCfg();
    delete require.cache[require.resolve('./services/config')];
  }

  console.log('\n── C. the PIN length reaches the whole fleet, not just UniFi units ──');
  // The fix for U29 nearly became a fleet-wide regression: the PIN Length control
  // lives inside a panel hidden on every non-UniFi unit, the save path wrote it
  // anyway, and every unit in the fleet carries unifiAccess.pinLength 4 from the
  // old default - so the first Settings save on a RemoteLock or no-lock facility
  // would have dropped every newly issued MEMBER PIN from six digits to four.
  // These four shapes are the whole fleet.
  {
    const cfgSvc = require('./services/config');
    const base = JSON.parse(fs.readFileSync(cfgPath));
    const shapes = [
      ['a RemoteLock facility carrying the old pinLength 4', { doorAccess: { provider: 'remotelock' }, unifiAccess: { pinLength: 4 } }, 6],
      ['a facility with no door lock at all',                { },                                                                      6],
      ['a UniFi facility whose owner chose 4',               { doorAccess: { provider: 'unifi', pinLength: 4 }, unifiAccess: { pinLength: 4 } }, 4],
      ['a UniFi facility whose owner chose 6',               { doorAccess: { provider: 'unifi', pinLength: 6 }, unifiAccess: { pinLength: 6 } }, 6],
    ];
    for (const [label, extra, want] of shapes) {
      fs.writeFileSync(cfgPath, JSON.stringify(Object.assign({}, base, { doorAccess: undefined, unifiAccess: undefined }, extra)));
      delete require.cache[require.resolve('./services/config')];
      delete require.cache[require.resolve('./services/doorlock')];
      const got = require('./services/doorlock').doorPinLength();
      ok(`C1 ${label} issues ${want}-digit member PINs`, got === want, { got, want });
    }
    fs.writeFileSync(cfgPath, JSON.stringify(base));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/doorlock')];
  }
  // C2: the tolerant end parse. A 24-hour club's booking ends at "25:30", and the
  // naive form is Invalid Date - which read as "this session is over" and let a
  // roster sync strip a live member's boost while they were still inside.
  {
    const dl = require('./services/doorlock');
    const late = dl.bookingEndDate({ date: '2026-09-20', end_time: '25:30' });
    const normal = dl.bookingEndDate({ date: '2026-09-20', end_time: '11:00' });
    ok('C2 a 24-hour club\'s booking ending at 25:30 parses to 01:30 the next day',
       !!late && late.getDate() === 21 && late.getHours() === 1 && late.getMinutes() === 30
       && !!normal && normal.getHours() === 11, { late: late && late.toString(), normal: normal && normal.toString() });
  }

  console.log('\n── D. rule 25 at the door, and the owner\'s lag number ──');
  reset();
  {
    const D = db.db;
    // D1: another BA unit's visitor, on a console the two facilities share. Its
    // remarks name a booking id that exists in OUR database - the only thing that
    // keeps us off it is the unit stamp. This is the case rule 25 exists for.
    D.prepare("INSERT OR REPLACE INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status) VALUES ('shared-1','bay1','B1','X','5','2026-09-01','10:00','11:00',60,0,'completed')").run();
    db.save();
    c.seed([{ id: 'vis-theirs', first_name: 'Golf', last_name: 'Someone', remarks: 'BA:some-other-unit Booking shared-1', end_time: 1 },
            { id: 'vis-unstamped', first_name: 'Golf', last_name: 'Ours', remarks: 'Booking shared-1', end_time: 1 }]);
    const sw = await caught(() => unifi.sweepExpiredVisitors({ now: Date.now(), graceMins: 1 }));
    const removed = sw.ok ? sw.v.removed : [];
    ok('D1 a visitor stamped for ANOTHER unit is never removed, even when its booking id is one of ours',
       !removed.includes('vis-theirs'), { removed });
    ok('D1b an UNMARKED visitor of ours is still swept - the marker cannot orphan what we made before it existed',
       removed.includes('vis-unstamped'), { removed });
    // D2: what we write on a visitor we create carries this unit's id
    const mark = unifi.ourRemark('bk-xyz');
    ok('D2 every visitor we create is stamped with this unit\'s own id (rule 25 at the door)',
       /^BA:\S+ Booking bk-xyz$/.test(mark), mark);
  }
  // D3: the revoke follows the OWNER's lag, the same number we put on the console
  {
    const dl = require('./services/doorlock');
    const base = JSON.parse(fs.readFileSync(cfgPath));
    for (const lag of [0, 45]) {
      const cfg = JSON.parse(JSON.stringify(base));
      cfg.booking = Object.assign({}, cfg.booking, { doorCodeLagMins: lag });
      fs.writeFileSync(cfgPath, JSON.stringify(cfg));
      delete require.cache[require.resolve('./services/config')];
      delete require.cache[require.resolve('./services/doorlock')];
      const w = require('./services/doorlock').codeWindow({ date: '2026-09-20', start_time: '10:00', end_time: '11:00' });
      const endMs = new Date('2026-09-20T11:00:00').getTime();
      ok(`D3 with the owner's lag at ${lag} min the console is told end+${lag}`,
         w.endDt.getTime() === endMs + lag * 60000 && w.lag === lag, { lag: w.lag, end: w.endDt.toISOString() });
    }
    fs.writeFileSync(cfgPath, JSON.stringify(base));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/doorlock')];
    const sch = fs.readFileSync('./services/scheduler.js', 'utf8');
    ok('D3b the revoke uses that SAME number - no hardcoded end+20 left in the scheduler',
       !/20 \* 60000/.test(sch) && (sch.match(/revokeLagMs\(\)/g) || []).length >= 3, {
         hardcoded: (sch.match(/20 \* 60000/g) || []).length, uses: (sch.match(/revokeLagMs\(\)/g) || []).length });
  }

  console.log('\n── E. unsettled endpoints: correct under BOTH readings ──');
  // maintainer's rule (Sep 16 2026): where no document answers, the code must be correct
  // under either reading - never "pick one and build on it". No source says
  // whether PUT MERGES the fields sent or REPLACES the record with them. Under
  // replace, a partial update blanks a visitor's `resources` - the doors come off
  // a code whose session is RUNNING, which is exactly when a window move happens.
  // So the same path is driven against a console that merges and a console that
  // replaces, and the doors must survive both.
  for (const mode of ['merge', 'replace']) {
    reset({ putMode: mode });
    const made = await caught(() => unifi.createBookingVisitor(bk('rmw-' + mode)));
    if (!made.ok) { ok(`E1[${mode}] setup`, false, made.e); continue; }
    const vid = String(made.v.visitorId);
    const before = (c.state.visitors[vid].resources || []).length;
    const moved = await caught(() => unifi.moveVisitorWindow(vid, Object.assign(bk('rmw-' + mode), { end_time: '12:30' })));
    const after = c.state.visitors[vid] || {};
    ok(`E1[${mode}] a console that ${mode}s still has the visitor's DOORS after a window move`,
       moved.ok && (after.resources || []).length === before && before > 0,
       { before, after: (after.resources || []).length, moved: moved.ok || moved.e });
    ok(`E1b[${mode}] ...and the window actually moved`,
       Number(after.end_time) === Math.floor(new Date('2026-09-20T12:40:00').getTime() / 1000),
       { end_time: after.end_time });
    ok(`E1c[${mode}] ...and our ownership marker survived`, /^BA:/.test(String(after.remarks || '')), { remarks: after.remarks });
    // AND THE CASE THE GUARD WAS MISSING FOR (Sep 17 2026): the doors are
    // re-resolved from the configuration AS IT IS NOW, so an owner who unticked
    // a door, moved the bay or changed the member's tier since the code was
    // issued resolves to NONE - and the old code restated that empty list onto
    // a visitor whose session is running. Under replace the doors are gone;
    // under merge an explicit [] overwrites just the same. The customer is mid
    // session with a PIN that opens nothing.
    {
      const saved = JSON.parse(fs.readFileSync(cfgPath));
      const stripped = JSON.parse(JSON.stringify(saved));
      stripped.unifiAccess = Object.assign({}, stripped.unifiAccess, { doorIds: [] });
      stripped.bays = (stripped.bays || []).map(b => Object.assign({}, b, { unifiDoors: [] }));
      fs.writeFileSync(cfgPath, JSON.stringify(stripped));
      delete require.cache[require.resolve('./services/config')];
      const doorsBefore = (c.state.visitors[vid].resources || []).length;
      const m2 = await caught(() => unifi.moveVisitorWindow(vid, Object.assign(bk('rmw-' + mode), { end_time: '13:30' })));
      const v2 = c.state.visitors[vid] || {};
      ok(`E1d[${mode}] the doors settings resolving to NOTHING never strips a running visitor's doors`,
         m2.ok && (v2.resources || []).length === doorsBefore && doorsBefore > 0,
         { before: doorsBefore, after: (v2.resources || []).length, moved: m2.ok || m2.e });
      ok(`E1e[${mode}] ...the extra time is still granted, and the owner is told their door settings resolve to nothing`,
         Number(v2.end_time) === Math.floor(new Date('2026-09-20T13:40:00').getTime() / 1000)
         && db.db.prepare("SELECT COUNT(*) n FROM admin_log WHERE event='DOOR_CODE_DOORS_UNRESOLVED'").get().n > 0,
         { end_time: v2.end_time });
      fs.writeFileSync(cfgPath, JSON.stringify(saved));
      delete require.cache[require.resolve('./services/config')];
    }
  }
  reset();
  {
    const src = fs.readFileSync('./services/unifiaccess.js', 'utf8');
    ok('E2 every partial update goes through the one read-merge-write helper - nothing PUTs a fragment directly',
       /async function putMerged/.test(src)
       && !/api\('PUT',\s*`\/visitors\/\$\{[^}]+\}`/.test(src)
       && !/api\('PUT',\s*`\/users\/\$\{[^}]+\}`\s*,/.test(src));
    ok('E3 a read we could not make is never permission to write a fragment',
       /could not read \$\{path\} before updating it/.test(src));
    ok('E4 the console-side adoption is gone; ownership of pre-marker credentials comes from OUR OWN record',
       /from OUR OWN RECORD, and only/.test(src) && !/adoptOurVisitors[\s\S]{0,1400}api\('PUT'/.test(src));
  }

  console.log('\n── F. a cancelled member booking must not strand the boost ──');
  reset({ pinLength: 'variable' });   // this facility's member PINs and visitor PINs differ in length
  {
    const D = db.db;
    const dl = require('./services/doorlock');
    // The member, their console user, and ONE upcoming booking holding the boost.
    // Sep 25 2026: the console follows the member's RECORD, so the member and tier are real rows
    D.prepare("INSERT OR REPLACE INTO membership_tiers (id, name, active, unifi_static_doors) VALUES ('tF','TF',1,?)").run(JSON.stringify(['door:door-front']));
    D.prepare("INSERT OR REPLACE INTO members (id, tier_id, name, phone, pin, status) VALUES ('mF','tF','Strand Member','5550009','424242','active')").run();
    const sync = await caught(() => unifi.syncMember(D.prepare("SELECT * FROM members WHERE id='mF'").get()));
    ok('F0 the member syncs to the console (setup for F1)', sync.ok && !!sync.v.userId, sync.ok ? sync.v : sync.e);
    const uid = sync.ok && sync.v.userId;
    const ref = 'unifiuser:' + uid + ':pol-1';
    D.prepare("INSERT OR REPLACE INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status, remotelock_person_id) VALUES ('bkF','bay1','B1','Strand','5','2099-01-01','10:00','11:00',60,0,'active',?)").run(ref);
    db.save();
    // Staff cancel: the revoke runs while this row is STILL 'active' - that is the
    // real ordering in services/bookingedit.js, and it is what made unboost see
    // "another live session of this member" and report ok:true on a boost it had
    // not detached. The caller then cleared the pointer and nothing could ever
    // take the doors back off.
    const r = await caught(() => dl.revokeDoorCode(ref, { forBookingId: 'bkF' }));
    ok('F1 cancelling a member booking does NOT count that same booking as a reason to keep the boost',
       r.ok && r.v && r.v.ok === true && !/another live session/.test(String(r.v.note || '')), r.ok ? r.v : r.e);
    const left = uid ? c.state.users[uid].policies : null;
    ok('F2 the boost policies are actually OFF the console user afterwards - not merely reported revoked',
       Array.isArray(left) && !left.includes('pol-1'), { left });
    // and the guard still holds when a member genuinely has a second session OPEN NOW (Sep 25
    // 2026: "live" is a booking whose door window is open, not any future booking)
    { const pad = n => String(n).padStart(2, '0'), t0 = new Date(Date.now() - 10 * 60000), t1 = new Date(Date.now() + 50 * 60000);
      const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, hm = t => `${pad(t.getHours())}:${pad(t.getMinutes())}`;
      D.prepare("INSERT OR REPLACE INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, end_date, duration_minutes, price_cents, status, member_id, remotelock_person_id) VALUES ('bkF2','bay1','B1','Strand','5',?,?,?,?,60,0,'active','mF',?)").run(ymd(t0), hm(t0), hm(t1), ymd(t1), ref);
      // the tier's always-on doors are taken away first, so what the member holds is ONLY the open
      // booking's doors (the build review: the tier policy alone used to satisfy this check)
      D.prepare("UPDATE membership_tiers SET unifi_static_doors='[]' WHERE id='tF'").run();
      db.save();
      await caught(() => require('./services/memberaccess').reconcile('mF', { shown: true }));
      const before = uid ? c.state.users[uid].policies.slice() : [];
      await caught(() => dl.revokeDoorCode(ref, { forBookingId: 'bkF' }));
      const kept = uid ? c.state.users[uid].policies : [];
      ok('F3 a member who really does have another session OPEN now still keeps THAT session\'s doors when a different booking is revoked (no always-on doors in play)',
         before.length > 0 && before.every(p => kept.includes(p)), { before, kept });
    }
  }

  console.log('\n── G. the UniFi work must not degrade REMOTELOCK (the primary provider) ──');
  // RemoteLock is the default and the one proven in production; UniFi is the
  // extra for facilities that already run Ubiquiti. The window-move fix was
  // written for UniFi and quietly taxed RemoteLock: moveDoorCodeWindow answered
  // {ok:false} for a bare (RemoteLock) ref, so extendBooking queued a job that
  // could never succeed - six retries, AUTOMATION_FAILED and an amber health
  // line on a routine counter action, at every facility using the DEFAULT
  // provider. Nothing in the UniFi work may cost RemoteLock anything.
  {
    const base = JSON.parse(fs.readFileSync(cfgPath));
    const rl = JSON.parse(JSON.stringify(base));
    rl.doorAccess = { provider: 'remotelock' };
    rl.remotelock = { clientId: 'rl-id', clientSecret: 'rl-secret' };
    fs.writeFileSync(cfgPath, JSON.stringify(rl));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/doorlock')];
    const dl = require('./services/doorlock');
    ok('G1 a RemoteLock credential reports honestly that its window cannot be moved from here',
       dl.canMoveWindow('rl-person-1') === false && dl.canMoveWindow('unifi:vis-1') === true);
    const r = await caught(() => dl.moveDoorCodeWindow({ id: 'g1', remotelock_person_id: 'rl-person-1', date: '2026-09-20', start_time: '10:00', end_time: '12:00' }));
    ok('G2 that is NOT APPLICABLE, never a failure - a job that can only fail must never be queued against the default provider',
       r.ok && r.v && r.v.skipped === true && r.v.ok !== false, r.ok ? r.v : r.e);
    ok('G3 a member boost follows its booking, so there is no window to move there either',
       (await dl.moveDoorCodeWindow({ id: 'g2', remotelock_person_id: 'unifiuser:u1:p1' })).skipped === true);
    // and the caller asks BEFORE queueing
    const ck = fs.readFileSync('./services/checkin.js', 'utf8');
    ok('G4 extendBooking asks what CAN be done before it queues anything',
       /windowMoveState\(b\.remotelock_person_id\)/.test(ck) && ck.indexOf('windowMoveState') < ck.indexOf("kind: 'door_window'"));
    // THREE STATES, AND THE OWNER IS TOLD THE TRUE ONE (Sep 17 2026). The
    // extend path used ONE no for two different cases: a RemoteLock guest,
    // whose code really does still expire at the old end, and a UniFi member
    // BOOST, whose access follows the booking and needs nothing done. The owner
    // was reading a warning about a code that was working, and being sent to
    // the console to fix nothing.
    ok('G7 the three states are told apart: a visitor moves, a member boost follows the booking, a RemoteLock guest cannot',
       dl.windowMoveState('unifi:vis-1') === 'move' && dl.windowMoveState('unifiuser:u1:p1') === 'follows-booking'
       && dl.windowMoveState('rl-person-1') === 'cannot' && dl.windowMoveState('') === 'none',
       ['unifi:vis-1', 'unifiuser:u1:p1', 'rl-person-1', ''].map(r => dl.windowMoveState(r)));
    ok('G5 a second extension clears the finished job first - ensureJob is INSERT OR IGNORE and would have swallowed it',
       /DELETE FROM automation_jobs WHERE booking_id=\? AND kind='door_window'/.test(ck));
    // a RemoteLock facility must also never be handed a UniFi-shaped PIN rule
    ok('G6 RemoteLock and no-lock facilities keep six-digit member PINs whatever a UniFi console setting says',
       dl.doorPinLength() === 6, dl.doorPinLength());
    fs.writeFileSync(cfgPath, JSON.stringify(base));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/doorlock')];
  }

  console.log('\n── G(b). what the OWNER READS when a boosted member extends ──');
  // Not the helper - the line in the owner's own log, through the real
  // extendBooking. A member on a boost who adds an hour at the counter used to
  // put DOOR_WINDOW_MANUAL in the log: "the code still expires at the original
  // end". It does not. Their access is bounded by the booking and the revoke
  // job had already been moved onto the new end.
  {
    writeCfg();
    for (const m of ['./services/config', './services/doorlock', './services/checkin']) delete require.cache[require.resolve(m)];
    const ckMod = require('./services/checkin');
    const logRows = () => db.db.prepare('SELECT event, detail FROM admin_log ORDER BY id DESC LIMIT 12').all();
    // each on its own slot - the first extension takes the hour after it, and a
    // second booking behind it is refused by the product, correctly
    const mk = (id, ref, from, to) => { db.db.prepare(`INSERT OR REPLACE INTO bookings (id, bay_id, bay_name, name, phone, date, end_date, start_time, end_time, duration_minutes, price_cents, status, remotelock_person_id) VALUES (?, 'bay1','B1','Ext','5','2026-09-20','2026-09-20',?,?,60,0,'active',?)`).run(id, from, to, ref); db.save(); };
    mk('ext-boost', 'unifiuser:u1:p1', '10:00', '11:00');
    ckMod.extendBooking({ booking_id: 'ext-boost', minutes: 60 });
    const afterBoost = logRows();
    ok('G8 a boosted member who extends is told the truth - their access follows the booking, nothing to change at the door',
       afterBoost.some(r => r.event === 'DOOR_WINDOW_FOLLOWS_BOOKING' && /nothing to change at the door/.test(r.detail))
       && !afterBoost.some(r => r.event === 'DOOR_WINDOW_MANUAL'), afterBoost.map(r => r.event));
    mk('ext-rl', 'rl-person-9', '15:00', '16:00');
    const rlRes = ckMod.extendBooking({ booking_id: 'ext-rl', minutes: 60 });
    const afterRl = logRows();
    ok('G9a the RemoteLock extension itself went through - the log line below is about a real extension',
       rlRes && rlRes.status === 200, rlRes && rlRes.status);
    ok('G9 a RemoteLock guest still gets the honest warning - that code really does expire at the original end',
       afterRl.some(r => r.event === 'DOOR_WINDOW_MANUAL' && /expires at the original end/.test(r.detail)), afterRl.map(r => r.event));
    db.db.prepare("DELETE FROM bookings WHERE id IN ('ext-boost','ext-rl')").run(); db.save();
  }

  console.log('\n── H. every path that revokes says WHICH booking it is revoking for ──');
  // The rule-27 review found the forBookingId fix applied at four call sites and
  // MISSED the two a person actually presses - the owner's Cancel button
  // (routes/admin.js) and the customer's own cancel (routes/customer.js). Both
  // run while the row is still status='active', so unboostMember counted the very
  // booking being cancelled as "another live session of this member" and left the
  // door boost attached. My battery could not see it because F1/F2 call the
  // HELPER directly - they assert my model, not the product. This asserts the
  // product's call sites, which is what would have caught it.
  {
    const files = ['routes/admin.js', 'routes/customer.js', 'routes/bookings.js',
                   'services/bookingedit.js', 'services/scheduler.js'];
    const bad = [];
    for (const f of files) {
      const src = fs.readFileSync('./' + f, 'utf8');
      src.split('\n').forEach((ln, i) => {
        if (!/revokeDoorCode\(/.test(ln)) return;
        if (/function revokeDoorCode|doorlock\.js/.test(ln)) return;
        if (/remotelock'\)\.revokeDoorCode/.test(ln)) return;     // the provider's own, no booking in scope
        if (!/forBookingId/.test(ln)) bad.push(`${f}:${i + 1}`);
      });
    }
    ok('H1 no revoke anywhere omits the booking it is for - a member boost must never count its own cancel as a live session',
       bad.length === 0, bad);
  }
  {
    const sim = fs.readFileSync('./services/simulator.js', 'utf8');
    ok('H2 a bay PC that did not answer is never written down as SHUTDOWN_SENT - nothing was sent',
       /SHUTDOWN_SKIPPED/.test(sim) && !/adminLog\('SHUTDOWN_SENT'[^)]*already off/.test(sim));
    const sch = fs.readFileSync('./services/scheduler.js', 'utf8');
    ok('H3 the door credential is on disk before the job moves on - the flush that stops the product manufacturing orphans',
       /remotelock_person_id=\?[\s\S]{0,900}?await dbModule\.flushed\(\)/.test(sch));
  }

  await c.stop();
  console.log(`\nUNIFI STANDIN: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
