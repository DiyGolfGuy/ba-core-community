// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-unifi-access.js — UniFi Access provider + dispatcher, proven against a
// live self-signed HTTPS mock console (same TLS posture as the real thing):
//   1  transport auto-detection: documented (:12445 Bearer) found and persisted
//   2  per-booking visitor: window = session +/- buffer, doors granted, PIN set
//   3  provider-prefixed refs: 'unifi:' revokes via UniFi; bare ids never do
//   4  transport fallback: proxy style detected when :12445 refuses
//   5  the secrets-mask fix: no door/HA/resend token reaches the client
//   6  W32: revoke sends is_force=true (removed, not Cancelled); the nightly
//      sweep removes only expired visitors WE created - a visitor not created
//      by us is never touched, a live one is kept, an id our db lacks is kept
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

// HERMETIC FIXTURE (Aug 20, found by the first on-Pi suite run): the mock's
// TLS key/cert are generated fresh here. The old code read /tmp files that
// only existed as leftovers in the dev container - a fresh machine crashed.
function ensureMockTls() {
  const { execFileSync } = require('child_process');
  if (fs.existsSync('/tmp/unifi-mock.key') && fs.existsSync('/tmp/unifi-mock.crt')) return;
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', '/tmp/unifi-mock.key',
    '-out', '/tmp/unifi-mock.crt', '-days', '2', '-nodes', '-subj', '/CN=localhost'],
    { timeout: 60000, stdio: 'ignore' });
}
// THE CONSOLE IS NO LONGER HAND-MADE HERE (Sep 16 2026). This battery used to
// carry its own stand-in, and test-unifi-restart.js carried a second one; between
// them they could emit exactly TWO non-success states, so every assertion below
// was being graded by a console that agreed with whatever we sent it. Both now
// use tools/unifi-console-standin.js, which answers the reference's real envelope
// and can refuse. See the header of that file for what it can do and for the
// three shapes it deliberately leaves as switches rather than picking a side.
const { startConsole } = require('./tools/unifi-console-standin');
async function mockConsole(port) { return startConsole({ port, faults: { pinLength: 6 } }); }

(async () => {
  const root = __dirname;
  const cfgPath = path.join(root, 'config.json');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Unifi', setup: { completed: true }, booking: { staffedAccess: false, doorCodeLeadMins: 30, doorCodeLagMins: 10 },
    // pinLength 6, not 4 (Sep 16 2026). This fixture used to say 4 while its member
    // carried the 6-digit PIN every member carries - and a UniFi console enforces ONE
    // length for both populations, so the facility it described could not exist. The
    // stand-in's old hardcoded `pin.length !== 4` agreed with it and nobody found out.
    // That is audit finding U29, reproduced by this battery's own fixture.
    doorAccess: { provider: 'unifi', pinLength: 6 },
    unifiAccess: { host: '127.0.0.1', apiToken: 'tok-123', doorIds: ['door:door-front', 'door:door-bay'], pinLength: 6, apiStyle: '', memberAccess: { enabled: true, memberPinForBookings: true } },
    bays: [{ id: 'bay1', name: 'B1', active: true }, { id: 'bay2', name: 'Private Suite', active: true, unifiDoors: ['door:door-suite', 'door:door-front'] }], server: { port: 3033 }
  }));
  const db = require('./services/db');
  await db.initDb();

  // ── 1+2: documented transport, visitor lifecycle ───────────────────────────
  const m1 = await mockConsole(12445);
  const unifi = require('./services/unifiaccess');
  const doorlock = require('./services/doorlock');

  const t = await unifi.testConnection();
  ok('test connection lists the console doors', t.ok && t.doors.length === 2 && t.doors[0].name === 'Front Door');
  ok('test connection carries the door groups as their own array (the admin renderer takes { doors, groups })', Array.isArray(t.groups));
  const savedStyle = JSON.parse(fs.readFileSync(cfgPath)).unifiAccess.apiStyle;
  ok('documented transport detected and persisted', savedStyle === 'documented', savedStyle);
  ok('both auth headers sent (Bearer + X-API-KEY)', m1.state.requests.every(r => r.auth === 'Bearer tok-123' && r.xkey === 'tok-123'));

  const booking = { id: 'bk-u1', name: 'Yolanda', date: '2026-08-20', start_time: '15:00', end_time: '16:00', end_date: '2026-08-20' };
  const issued = await doorlock.generateDoorCode(booking);
  ok('dispatcher routes issuance to UniFi (unifi: prefix)', issued.personId.startsWith('unifi:vis-'), issued.personId);
  // read the facility's ONE configured length rather than hardcoding a number -
  // the battery was asserting the old 4-digit default, which is the very setting
  // that made member sync impossible on the same facility (U29).
  {
    const want = require('./services/doorlock').doorPinLength();
    ok(`PIN is ${want} digits - the facility's one configured door-PIN length`, new RegExp(`^\\d{${want}}$`).test(issued.pin), { pin: issued.pin, want });
  }
  const vreq = m1.state.requests.find(r => r.method === 'POST' && /\/visitors$/.test(r.url));
  const startEpoch = Math.floor(new Date('2026-08-20T15:00:00').getTime() / 1000) - 30 * 60;
  const endEpoch = Math.floor(new Date('2026-08-20T16:00:00').getTime() / 1000) + 10 * 60;
  ok('owner-set lead/lag drives the window (30 before / 10 after)', vreq.body.start_time === startEpoch && vreq.body.end_time === endEpoch, { got: [vreq.body.start_time, vreq.body.end_time], want: [startEpoch, endEpoch] });
  // shared helper: both providers use ONE window calc
  const rlSrc = fs.readFileSync(path.join(root, 'services/remotelock.js'), 'utf8');
  ok('RemoteLock uses the same shared codeWindow helper', rlSrc.includes("require('./doorlock').codeWindow(booking)"));
  {
    const w = doorlock.codeWindow({ date: '2026-08-20', start_time: '15:00', end_time: '16:00' });
    ok('codeWindow honors lead/lag from config', w.lead === 30 && w.lag === 10, { lead: w.lead, lag: w.lag });
  }
  ok('facility doors granted with types', JSON.stringify(vreq.body.resources) === JSON.stringify([{ id: 'door-front', type: 'door' }, { id: 'door-bay', type: 'door' }]), vreq.body.resources);

  // three-layer resolution: facility + private-room bay + member tier
  {
    const D = db.db;
    D.prepare("INSERT INTO membership_tiers (id, name, discount_type, discount_value, unifi_doors) VALUES ('tier-vip','VIP','percentage',0,?)").run(JSON.stringify(['group:grp-lounge', 'door:door-front']));
    D.prepare("INSERT INTO members (id, name, phone, pin, tier_id, status) VALUES ('mem-1','Vip Member','5550001111','123456','tier-vip','active')").run();
    db.save();
    const resolved = unifi.resolveDoorsForBooking({ id: 'bk-u2', bay_id: 'bay2', member_id: 'mem-1', name: 'Vip', date: '2026-08-21', start_time: '10:00', end_time: '11:00' });
    const key = resolved.map(r => r.type + ':' + r.id).sort().join('|');
    ok('union of facility + bay + tier doors, deduped',
       key === ['door:door-bay','door:door-front','door:door-suite','door_group:grp-lounge'].sort().join('|'), key);
    ok('door groups carry type door_group', resolved.some(r => r.type === 'door_group' && r.id === 'grp-lounge'));
    const plain = unifi.resolveDoorsForBooking({ id: 'bk-u3', bay_id: 'bay1', name: 'Walkin', date: '2026-08-21', start_time: '12:00', end_time: '13:00' });
    ok('non-member on a normal bay gets facility doors only', plain.length === 2 && plain.every(r => r.type === 'door'));
  }

  // ── 3: prefix routing on revoke ────────────────────────────────────────────
  await doorlock.revokeDoorCode(issued.personId);
  ok('unifi: ref revokes via the console (visitor deleted)', m1.state.deletes === 1);
  ok('W32: the revoke carries is_force=true - the visitor is REMOVED, not left Cancelled (Reference v4.2.16 s4.6)', m1.state.deleted.length === 1 && m1.state.deleted[0].force === true && m1.state.deleted[0].id === issued.personId.slice(6), m1.state.deleted);
  await doorlock.revokeDoorCode('bare-remotelock-id-999');
  ok('bare (RemoteLock) ref never touches the UniFi console', m1.state.deletes === 1);

  // pin-length rejection surfaces the console guidance
  // The console this battery talks to enforces 6. To prove the MISMATCH path we
  // must make the facility disagree with it - this line used to set 6 against a
  // console the old stand-in hardcoded to 4, which is the same test upside down.
  const cfg6 = JSON.parse(fs.readFileSync(cfgPath));
  cfg6.doorAccess.pinLength = 4; cfg6.unifiAccess.pinLength = 4;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg6));
  let msg = '';
  try { await unifi.createBookingVisitor(booking); } catch (e) { msg = e.message; }
  ok('console PIN-length rejection tells the owner what to fix', /PIN Length|PIN length/i.test(msg), msg.slice(0, 80));
  ok('rejected visitor is cleaned up (no doorless orphan)', m1.state.deletes === 2, m1.state.deletes);
  { const back = JSON.parse(fs.readFileSync(cfgPath)); back.doorAccess.pinLength = 6; back.unifiAccess.pinLength = 6; fs.writeFileSync(cfgPath, JSON.stringify(back)); }
  const cfg4 = JSON.parse(fs.readFileSync(cfgPath)); cfg4.unifiAccess.pinLength = 4; fs.writeFileSync(cfgPath, JSON.stringify(cfg4));

  // ── MEMBER ACCESS NETWORK: sync, static doors, booking boost, unboost ──────
  console.log('\u2500\u2500 member access network \u2500\u2500');
  {
    const D = db.db;
    D.prepare("UPDATE membership_tiers SET unifi_static_doors=? WHERE id='tier-vip'").run(JSON.stringify(['door:door-front']));
    const vip = D.prepare("SELECT m.*, 'tier-vip' AS t_id FROM members m WHERE m.id='mem-1'").get();
    const tier = D.prepare("SELECT * FROM membership_tiers WHERE id='tier-vip'").get();
    const sync = await unifi.syncMember(vip, tier);
    ok('member becomes a console user with a static tier policy', !!sync.userId && sync.policyIds.length === 1, sync);
    const uState = m1.state.users[sync.userId];
    ok("the member's own PIN is the door PIN", uState.pin === String(vip.pin), uState.pin);
    // Created ONCE, and this is now the assertion that would have caught U19: the
  // cache object was being written back stale after every policy write, so the
  // schedule id never stuck and every policy re-created 'BA Always'.
  ok('static policy carries the always schedule (created once)', m1.state.counters.schedulesCreated === 1, m1.state.counters.schedulesCreated);

    const member = db.db.prepare("SELECT * FROM members WHERE id='mem-1'").get();
    ok('console user id persisted on the member row', !!member.unifi_user_id);

    // booking boost through the DISPATCHER (the real issuance path)
    const boostBooking = { id: 'bk-boost', bay_id: 'bay2', member_id: 'mem-1', name: 'Vip', date: '2026-08-22', start_time: '09:00', end_time: '10:00', end_date: '2026-08-22' };
    const issued2 = await doorlock.generateDoorCode(boostBooking);
    ok('member booking issues a BOOST, not a visitor', issued2.personId.startsWith('unifiuser:'), issued2.personId);
    ok('boost keeps the member PIN (no new code)', issued2.pin === String(vip.pin));
    const after = m1.state.users[member.unifi_user_id].policies;
    ok('boost attached booking + bay + tier-booking policies on top of static', after.length === 4, after);

    await doorlock.revokeDoorCode(issued2.personId);
    const post = m1.state.users[member.unifi_user_id].policies;
    ok('unboost detaches exactly the boost set - static access remains', post.length === 1, post);

    // Sep 25 2026: the console follows the member's RECORD (services/memberaccess) - every real
    // path ends the membership first and then asks the console to follow, as here
    D.prepare("UPDATE members SET status='inactive' WHERE id='mem-1'").run();
    await unifi.deactivateMemberUser(member.unifi_user_id);
    ok('deactivated member goes DEACTIVATED on the console', m1.state.users[member.unifi_user_id].status === 'DEACTIVATED');

    // member WITHOUT console user + memberPinForBookings: visitor carries their pin
    // a 6-digit PIN, because the facility's one door-PIN length is 6 - '7778' was
    // a 4-digit member PIN in a facility that cannot hold one (U29 again)
    D.prepare("INSERT INTO members (id, name, phone, pin, tier_id, status) VALUES ('mem-2','Pin Member','5550002222','777800','tier-vip','active')").run();
    db.save();
    const pinBooking = { id: 'bk-pin', bay_id: 'bay1', member_id: 'mem-2', name: 'PinM', date: '2026-08-22', start_time: '11:00', end_time: '12:00', end_date: '2026-08-22' };
    const issued3 = await doorlock.generateDoorCode(pinBooking);
    // Sep 25 2026 (maintainer's member design): a member with no console user yet is PUT on the console
    // at their first booking and opens the door with their own PIN - no visitor needed
    ok('no-console-user member is put on the console at their booking and keeps THEIR pin', issued3.personId.startsWith('unifiuser:') && issued3.pin === '777800' && Object.values(m1.state.users).some(u => u.pin === '777800'), issued3);
    // (the 6-digit-pin-vs-4-digit-console case was hit accidentally in an earlier
    // run and proved the fallback: console rejects -> random visitor code, booking never fails)
  }

  // ── 6: W32 nightly sweep - only OUR expired visitors, never anything else ──
  {
    const D = db.db;
    for (const id of ['bk-old', 'bk-live']) D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
      VALUES (?,'bay1','B1','Sweep Test','5550001','2026-08-20','15:00','16:00','2026-08-20',60,0,'active')`).run(id);
    const nowS = Math.floor(Date.now() / 1000);
    m1.state.seeded = [
      { id: 'vis-ours-expired',  first_name: 'Golf', last_name: 'Old 2026-08-20 15:00', remarks: 'Booking bk-old',  end_time: nowS - 7200 },
      { id: 'vis-ours-live',     first_name: 'Golf', last_name: 'Live',                 remarks: 'Booking bk-live', end_time: nowS + 7200 },
      { id: 'vis-ours-unknown',  first_name: 'Golf', last_name: 'Nobody',               remarks: 'Booking bk-nope', end_time: nowS - 7200 },
      { id: 'vis-foreign-1',     first_name: 'Jane', last_name: 'Doe',                  remarks: 'Interview',       end_time: nowS - 7200 },
      { id: 'vis-foreign-golf',  first_name: 'Golf', last_name: 'Pro shop rep',         remarks: 'Business',        end_time: nowS - 7200 }
    ];
    for (let i = 0; i < 120; i++) m1.state.seeded.push({ id: 'vis-other-' + i, first_name: 'Guest' + i, last_name: 'X', remarks: 'Cooperation', end_time: nowS - 90000 });
    // the visitors this battery created above are still listed by the mock:
    // Golf + 'Booking bk-u1', window long past, but bk-u1 is not in this
    // db's bookings table - the third guard keeps every one of them.
    const created = Object.keys(m1.state.visitors).length;
    const before = m1.state.deleted.length;
    const sw = await unifi.sweepExpiredVisitors();
    const gone = m1.state.deleted.slice(before);
    ok(`sweep pages through the whole list (${125 + created} visitors over two pages)`, sw.scanned === 125 + created && m1.state.requests.filter(r => r.method === 'GET' && /\/visitors\?page_num=2/.test(r.url)).length === 1, sw);
    ok('sweep removes OUR expired visitor, with is_force=true', gone.length === 1 && gone[0].id === 'vis-ours-expired' && gone[0].force === true, gone);
    ok('sweep keeps our visitor whose window is still open', !gone.some(g => g.id === 'vis-ours-live'));
    ok('sweep keeps a Golf/Booking visitor whose booking id our database does not have (third guard)', !gone.some(g => g.id === 'vis-ours-unknown'));
    ok('a visitor not created by us is NEVER touched - 122 foreign visitors, expired, some even named Golf', !gone.some(g => /foreign|other/.test(g.id)) && sw.ours === 3 + created && sw.kept === 2 + created, sw);
    const logRow = D.prepare(`SELECT detail FROM admin_log WHERE event = 'UNIFI_VISITOR_SWEEP' ORDER BY rowid DESC LIMIT 1`).get();
    ok('the sweep writes one admin_log line with the counts and the ids removed', !!logRow && logRow.detail.startsWith(`scanned ${125 + created} | ours ${3 + created} | removed 1 | kept ${2 + created} | errors 0 | not ours 122 | matched by record `) && logRow.detail.endsWith('| vis-ours-expired'), logRow);
    const again = await unifi.sweepExpiredVisitors();
    ok('a second sweep removes nothing more (the removed row is gone from the console; everything else is still kept)', again.removed.length === 0 && again.scanned === 124 + created && m1.state.deleted.length === before + 1, again);
    m1.state.seeded = [];
    const cfgX = JSON.parse(fs.readFileSync(cfgPath)); cfgX.doorAccess.provider = 'remotelock'; fs.writeFileSync(cfgPath, JSON.stringify(cfgX));
    const skipped = await unifi.sweepExpiredVisitors();
    ok('sweep is a no-op unless the provider is UniFi', skipped.skipped === 'provider');
    cfgX.doorAccess.provider = 'unifi'; fs.writeFileSync(cfgPath, JSON.stringify(cfgX));
    const sch = fs.readFileSync(path.join(root, 'services/scheduler.js'), 'utf8');
    ok('scheduler adopts our own visitors then sweeps at 5:00, gated on the provider (rule 25 at the door)', /cron\.schedule\('0 5 \* \* \*'[\s\S]{0,1400}provider !== 'unifi'[\s\S]{0,900}adoptOurVisitors\(\)[\s\S]{0,400}sweepExpiredVisitors\(\)/.test(sch));
    ok('scheduler door_revoke and cancellation both go through revokeVisitor (one force-delete path)', /revokeDoorCode\(booking\.remotelock_person_id,/.test(sch) && fs.readFileSync(path.join(root, 'services/unifiaccess.js'), 'utf8').includes("`/visitors/${visitorId}?is_force=true`"));
    void again;
  }
  await new Promise(r => m1.srv.close(r));

  // ── 4: fallback to the proxy transport when :12445 refuses ────────────────
  const m2 = await mockConsole(13445);
  const origProxy = unifi.STYLES.proxy;
  unifi.STYLES.proxy = host => `https://${host}:13445/api/v1/developer`;   // test seam
  const cfgR = JSON.parse(fs.readFileSync(cfgPath)); cfgR.unifiAccess.apiStyle = ''; fs.writeFileSync(cfgPath, JSON.stringify(cfgR));
  const doors2 = await unifi.listDoors();
  ok('proxy transport detected when :12445 refuses', doors2.length === 2 && JSON.parse(fs.readFileSync(cfgPath)).unifiAccess.apiStyle === 'proxy');
  unifi.STYLES.proxy = origProxy;
  await new Promise(r => m2.srv.close(r));

  // ── 5: the secrets-mask fix ────────────────────────────────────────────────
  const auth = require('./services/auth');
  const out = auth.sanitizeConfigForClient({
    remotelock: { clientSecret: 'RSECRET' }, homeAssistant: { token: 'HTOKEN' },
    unifiAccess: { apiToken: 'UTOKEN' }, resend: { apiKey: 'REKEY' }, messagebird: { apiKey: 'MBKEY' }
  });
  ok('remotelock.clientSecret masked', out.remotelock.clientSecret !== 'RSECRET');
  ok('homeAssistant.token masked', out.homeAssistant.token !== 'HTOKEN');
  ok('unifiAccess.apiToken masked', out.unifiAccess.apiToken !== 'UTOKEN');
  ok('resend.apiKey masked', out.resend.apiKey !== 'REKEY');
  ok('messagebird.apiKey masked', out.messagebird.apiKey !== 'MBKEY');

  // lifecycle hooks: every member change pushes to the console without waiting
  {
    const mr = fs.readFileSync(path.join(root, 'routes/members.js'), 'utf8');
    const ms = fs.readFileSync(path.join(root, 'routes/memberships.js'), 'utf8');
    ok('policy create sends the OFFICIAL singular resource key (PDF 5.2)', fs.readFileSync(path.join(root, 'services/unifiaccess.js'), 'utf8').includes('resource: resources'));
    // Sep 25 2026: create, new PIN and an edited PIN check the PIN on the console before
    // answering (memberaccess.syncNow); every other change marks the member (the hook)
    ok('member lifecycle hooks wired (pin/create/edit/deactivate/cancel/extend + tier re-sync)', (mr.match(/unifiMemberHook\(/g) || []).length + (mr.match(/memberaccess'\)\.syncNow\(/g) || []).length >= 7);
    // Sep 20 2026: the paid-signup member-creating body moved to
    // services/membership-join.js (one path for the success redirect AND the
    // orphan reconcile). The two console pushes - primary + family codes - live
    // there now, so this reads that file, not routes/memberships.js.
    const mj = fs.readFileSync(path.join(root, 'services/membership-join.js'), 'utf8');
    ok('paid-signup path puts new members - the primary AND each additional code - on the console before the PIN is shown', /syncNow\(id\)/.test(mj) && /syncNow\(cid/.test(mj));
    ok('cancelled members are deactivated IMMEDIATELY, not at next sync', /status='inactive'[^\n]*\n\s*unifiMemberHook\(m\.id\)/.test(mr) && /function unifiMemberHook\(memberId\) \{[\s\S]{0,300}memberaccess'\)\.touch\(memberId\)/.test(mr));
    const ah = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    // (Sep 25 2026, the build review: the box used to say the dropdown only controls one-time codes,
    // while member PINs are made at its length - it now says both must be 6)
    ok('Settings states the 6-digit member-PIN console requirement - the PIN Length here AND the console\'s own setting', ah.includes('<b>PIN Length above to 6 digits</b>') && ah.includes("the console's own PIN setting to 6 digits") && !ah.includes('only controls one-time codes for non-member bookings'));
  }
  console.log('\nUNIFI ACCESS: ' + pass + ' passed, ' + fail + ' failed');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
