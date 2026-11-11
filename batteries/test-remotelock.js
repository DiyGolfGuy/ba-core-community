// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-remotelock.js — THE PRIMARY DOOR PROVIDER, AGAINST A LOCK THAT CAN REFUSE
//                      (maintainer, Sep 16 2026)
//
// RemoteLock is the DEFAULT provider, the one proven at a live facility, and the
// one most units will ever use; UniFi is the extra for places already running
// Ubiquiti. It had three batteries and a twelve-state console stand-in. This had
// none of either - not one assertion had ever driven services/remotelock.js.
// maintainer: "if the extra got more scrutiny than the default, say so and even it up."
//
// Reading it against a lock that can refuse turned up worse hygiene than UniFi
// had before its own audit, and each section below is one of those.
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); } };

const root = __dirname;
const cfgPath = path.join(root, 'config.json');
const PORT = 14567;

(async () => {
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  const { startLock } = require('./tools/remotelock-standin');
  const L = await startLock({ port: PORT });
  process.env.BA_REMOTELOCK_BASE = L.base;
  process.env.BA_REMOTELOCK_AUTH = L.auth;

  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'RL', setup: { completed: true },
    booking: { staffedAccess: false, doorCodeLeadMins: 30, doorCodeLagMins: 10 },
    doorAccess: { provider: 'remotelock' },
    remotelock: { clientId: 'rl-client', clientSecret: 'rl-secret', deviceId: 'lock-1' },
    bays: [{ id: 'bay1', name: 'B1', active: true }], server: { port: 3094 }
  }));
  const db = require('./services/db');
  await db.initDb();
  const rl = require('./services/remotelock');
  const doorlock = require('./services/doorlock');
  const reset = (f) => L.set(Object.assign({}, require('./tools/remotelock-standin').DEFAULT_FAULTS, f || {}));
  const bk = id => ({ id, name: 'Cust', date: '2026-09-20', start_time: '10:00', end_time: '11:00', end_date: '2026-09-20', bay_id: 'bay1' });
  const caught = async fn => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
  const logRows = () => { try { return db.db.prepare("SELECT event, detail FROM admin_log ORDER BY id DESC LIMIT 6").all(); } catch { return []; } };

  console.log('── A. the happy path, which nothing had ever exercised ──');
  reset();
  {
    const r = await caught(() => rl.generateDoorCode(bk('rl-1')));
    ok('A1 a booking gets a PIN and a person id from the lock', r.ok && /^\d{4}$/.test(String(r.v.pin)) && /^rlp-/.test(String(r.v.personId)), r.ok ? r.v : r.e);
    ok('A2 the guest is granted the configured device, not a guessed one',
       L.state.accesses.length === 1 && L.state.accesses[0].body.attributes.accessible_id === 'lock-1', L.state.accesses[0]);
    ok('A3 the window sent is the owner\'s lead/lag around the booking',
       /2026-09-20T09:30:00/.test(JSON.stringify(L.state.requests)) && /2026-09-20T11:10:00/.test(JSON.stringify(L.state.requests)));
    const rev = await caught(() => doorlock.revokeDoorCode(r.v.personId));
    ok('A4 the dispatcher revokes a bare (RemoteLock) ref through RemoteLock', rev.ok && rev.v.ok === true && L.state.deleted.length === 1, rev.ok ? rev.v : rev.e);
  }

  console.log('\n── B. the lock refusing, which nothing had ever exercised ──');
  reset({ authFails: true });
  {
    const r = await caught(() => rl.generateDoorCode(bk('rl-b1')));
    ok('B1 bad OAuth credentials fail the booking loudly - never a silent success', !r.ok, r);
  }
  reset({ rejectToken: true });
  {
    const r = await caught(() => rl.generateDoorCode(bk('rl-b2')));
    ok('B2 a token the lock rejects fails the booking', !r.ok, r);
  }
  reset({ rateLimit: 1 });
  {
    const r = await caught(() => rl.generateDoorCode(bk('rl-b3')));
    ok('B3 a 429 fails the booking rather than producing a codeless success', !r.ok, r);
  }
  reset({ htmlBody: true });
  {
    const r = await caught(() => rl.generateDoorCode(bk('rl-b4')));
    ok('B4 a 200 that is not the lock\'s JSON is not accepted as a code', !r.ok, r);
  }

  console.log('\n── C. the three real defects reading it turned up ──');
  // C0 - THE OTHER DIRECTION, and the one that matters more (maintainer, Sep 16 2026).
  // This provider works at a live facility today. A reply shape I have never seen
  // must never be REFUSED - the customer would be at a door with no code, to fix
  // a problem of ours. Only an absent PIN is a refusal; anything the lock actually
  // issued is passed on, flagged if it looks odd.
  for (const [label, val] of [['a 6-digit PIN', '123456'], ['a PIN with a leading zero', '0412'],
                              ['a 3-digit PIN', '412'], ['a 12-digit PIN', '123456789012'],
                              ['a PIN with a separator', '12-34'], ['a PIN returned padded', ' 4821 ']]) {
    reset({ pinValue: val });
    const r = await caught(() => rl.generateDoorCode(bk('rl-c0-' + label.replace(/\W/g, ''))));
    ok(`C0 ${label} is ISSUED, never refused - the lock made it, so it is what opens the door`,
       r.ok && String(r.v.pin).length > 0, r.ok ? { pin: r.v.pin } : { refused: r.e });
  }
  {
    const odd = logRows().filter(x => x.event === 'DOOR_CODE_UNUSUAL').length;
    ok('C0b ...and an unusual shape is named in the owner\'s log rather than passed silently', odd >= 1, { flagged: odd });
  }
  // C0c - a working PIN with no guest id: issue it and say we cannot revoke it,
  // rather than taking a working code off a customer to fix our own bookkeeping
  reset({ noId: true });
  {
    const r = await caught(() => rl.generateDoorCode(bk('rl-c0c')));
    ok('C0c a PIN with no guest id is still given to the customer', r.ok && /^\d+$/.test(String(r.v.pin)), r.ok ? r.v : r.e);
    ok('C0c2 ...with NO credential pointer recorded, so nothing claims it can revoke it', r.ok && r.v.personId === '', r.ok ? r.v : r.e);
    ok('C0c3 ...and the owner is told it cannot be revoked from here',
       logRows().some(x => x.event === 'DOOR_CODE_UNTRACKED'), logRows().map(x => x.event));
  }
  // C1 - 'CHECK_APP' as a customer's door code
  reset({ pinMode: 'none' });
  {
    const before = L.state.deleted.length;
    const r = await caught(() => rl.generateDoorCode(bk('rl-c1')));
    ok('C1 a reply with NO pin never becomes the door code \'CHECK_APP\' handed to a customer',
       !r.ok && !/CHECK_APP/.test(String(r.e)) && /did not return a PIN/.test(String(r.e)), r.ok ? r.v : r.e);
    ok('C1b ...and the guest it had already created is removed, not stranded at the lock',
       L.state.deleted.length === before + 1, { before, after: L.state.deleted.length });
  }
  // C2 - the door grant failing after the guest exists
  reset({ grantFails: true });
  {
    const before = L.state.deleted.length;
    const r = await caught(() => rl.generateDoorCode(bk('rl-c2')));
    ok('C2 a guest created but not granted the door fails the booking', !r.ok && /door/.test(String(r.e)), r.ok ? r.v : r.e);
    ok('C2b ...and is cleaned up - a PIN at the lock that opens nothing is not left behind',
       L.state.deleted.length === before + 1, { before, after: L.state.deleted.length });
  }
  // C3 - a reply shape taken on faith
  // (C3 used to assert that a missing id FAILS the booking. It no longer does, and
  //  should not: see C0c. The refusal it was written for is C1 - no PIN at all.)
  reset({ badShape: true });
  {
    const r = await caught(() => rl.generateDoorCode(bk('rl-c4')));
    ok('C4 a reply in an unknown shape fails rather than recording undefined as the credential', !r.ok, r);
  }

  console.log('\n── D. revoke: the A-wave 11b contract, for this provider too ──');
  reset();
  {
    const made = await caught(() => rl.generateDoorCode(bk('rl-d1')));
    L.set({ deleteStatus: 500 });
    const r = await caught(() => rl.revokeDoorCode(made.v.personId));
    ok('D1 a lock that refuses the revoke REPORTS it - the caller must not clear the pointer',
       r.ok && r.v && r.v.ok === false && !!r.v.error, r.ok ? r.v : r.e);
    L.set({ deleteStatus: 404 });
    const r2 = await caught(() => rl.revokeDoorCode(made.v.personId));
    ok('D2 a person the lock no longer knows counts as revoked', r2.ok && r2.v.ok === true && /already gone/.test(String(r2.v.note)), r2.ok ? r2.v : r2.e);
    const r3 = await caught(() => rl.revokeDoorCode(''));
    ok('D3 nothing to revoke is not a failure (rule 31)', r3.ok && r3.v.ok === true, r3.ok ? r3.v : r3.e);
  }

  console.log('\n── E. the pin field, whichever name the lock uses ──');
  for (const mode of ['pin', 'access_pin', 'code']) {
    reset({ pinMode: mode });
    const r = await caught(() => rl.generateDoorCode(bk('rl-e-' + mode)));
    ok(`E1[${mode}] a PIN arriving as '${mode}' is read`, r.ok && /^\d{4}$/.test(String(r.v.pin)), r.ok ? r.v.pin : r.e);
  }

  console.log('\n── F. rule 31: a facility with no RemoteLock configured ──');
  {
    const cfg = JSON.parse(fs.readFileSync(cfgPath));
    cfg.remotelock = { clientId: '', clientSecret: '' };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/doorlock')];
    const dl = require('./services/doorlock');
    ok('F1 no credentials means no lock - not a broken one', dl.lockConfigured() === false);
    const r = await caught(() => dl.revokeDoorCode('rlp-999'));
    ok('F2 a legacy pointer on a unit with no lock clears, and says it could not be checked',
       r.ok && r.v.ok === true && /unverified|no door lock/.test(String(r.v.note || '')), r.ok ? r.v : r.e);
    ok('F3 the owner\'s log records that it could not be verified, rather than claiming a revoke',
       logRows().some(x => x.event === 'DOOR_CODE_UNVERIFIED'), logRows().map(x => x.event));
  }

  console.log('\n── G. finding codes the lock holds that we have no record of ──');
  // The undefined-credential bug left working PINs at the lock that this unit
  // could not name, so nothing could revoke them and no facility could find out.
  // maintainer asked whether a unit can go and look. It can: GET /access_persons is
  // DOCUMENTED with paging and a status filter (developer.remotelock.com/api/docs,
  // read 2026-09-16), and the filter defaults to current+upcoming, so a sweep
  // must ask for expired and deactivated explicitly or it will see none of them.
  {
    const cfg = JSON.parse(fs.readFileSync(cfgPath));
    cfg.remotelock = { clientId: 'rl-client', clientSecret: 'rl-secret', deviceId: 'lock-1' };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/remotelock')];
    const rl2 = require('./services/remotelock');
    reset();
    L.seed([
      { id: 'orphan-1', name: 'Golf - Amy - 2026-09-01 10:00', ends_at: '2026-09-01T11:10:00', status: 'expired' },
      { id: 'orphan-2', name: 'Golf - Bob - 2026-09-02 10:00', ends_at: '2026-09-02T11:10:00', status: 'deactivated' },
      { id: 'theirs-1', name: 'Cleaning contractor', ends_at: '2026-09-01T11:10:00', status: 'expired' },
      { id: 'known-1',  name: 'Golf - Cid - 2026-09-03 10:00', ends_at: '2026-09-03T11:10:00', status: 'expired' },
    ]);
    db.db.prepare("INSERT OR REPLACE INTO bookings (id, bay_id, bay_name, name, phone, date, start_time, end_time, duration_minutes, price_cents, status, remotelock_person_id) VALUES ('bk-known','bay1','B1','Cid','5','2026-09-03','10:00','11:00',60,0,'completed','known-1')").run();
    db.save();
    const deletedBefore = L.state.deleted.length;
    const out = await caught(() => rl2.findOrphanedCodes({ now: Date.parse('2026-09-16T00:00:00Z') }));
    const ids = out.ok ? out.v.orphans.map(o => o.id).sort() : [];
    ok('G1 the sweep finds codes at the lock that we made and have no record of',
       out.ok && ids.join(',') === 'orphan-1,orphan-2', out.ok ? out.v : out.e);
    ok('G2 a guest the FACILITY made is never listed - their lock account is not ours to police (rule 25)',
       !ids.includes('theirs-1'), ids);
    // WE SAY WHAT WE CAN PROVE (Sep 17 2026). UniFi stamps BA:<unit> Booking
    // <id> on every visitor; RemoteLock carries only the name we set, so this
    // check finds guests that LOOK like ours - the facility's own "Golf - " guest
    // is indistinguishable. Telling the owner they "were created by this system"
    // and to delete them is an instruction we have not earned. The marker that
    // would make it provable changes what the PRIMARY provider sends to a live
    // lock, so it waits for a console.
    ok('G2b the owner is told these LOOK like ours, never that we know they are - and is asked to check before deleting',
       (() => { const d = String((logRows().find(x => x.event === 'DOOR_CODE_ORPHANS') || {}).detail || '');
         // the health signal's orphan branch is read from the source: at this
         // point in the battery a LIVE code outranks it, and that ordering is
         // itself asserted in section H
         const uh = fs.readFileSync('./services/unithealth.js', 'utf8');
         const branch = (uh.match(/else if \(orphans\)[^\n]*/) || [''])[0];
         return /look like ours/i.test(d)
                && /look like ours/i.test(branch)
                && !/created by this system/i.test(branch)
                && /Leave anything you created yourself alone/.test(branch);
       })(), { log: (logRows().find(x => x.event === 'DOOR_CODE_ORPHANS') || {}).detail,
               branch: (fs.readFileSync('./services/unithealth.js', 'utf8').match(/else if \(orphans\)[^\n]*/) || [''])[0].slice(0, 220) });
    ok('G3 a code we DO have a record of is not an orphan - the normal revoke owns it', !ids.includes('known-1'), ids);
    ok('G4 it REPORTS and never deletes: nothing was removed from the lock',
       L.state.deleted.length === deletedBefore && out.ok && out.v.orphans.length === 2, { before: deletedBefore, after: L.state.deleted.length });
    ok('G5 the owner is told, by name, in their own log',
       logRows().some(x => x.event === 'DOOR_CODE_ORPHANS' && /orphan-1/.test(x.detail)), logRows().map(x => x.event));
    // paging: the documented max is 50 per page
    const many = []; for (let i = 0; i < 60; i++) many.push({ id: 'p-' + i, name: 'Golf - P' + i + ' - 2026-09-01 10:00', ends_at: '2026-09-01T11:10:00', status: 'expired' });
    L.seed(many);
    const out2 = await caught(() => rl2.findOrphanedCodes({ now: Date.parse('2026-09-16T00:00:00Z') }));
    ok('G6 more than one page of guests is read to the end, off meta.total_pages',
       out2.ok && out2.v.orphans.length === 62, out2.ok ? out2.v.orphans.length : out2.e);
    // and a lock that will not answer says so rather than reporting "none"
    L.set({ rejectToken: true });
    const out3 = await caught(() => rl2.findOrphanedCodes({}));
    ok('G7 a lock we cannot reach reports an ERROR, never a clean "no orphans"',
       out3.ok && !!out3.v.error && out3.v.orphans.length === 0, out3.ok ? out3.v : out3.e);
  }

  console.log('\n── H. the orphan line must be able to go GREEN again ──');
  // The first cut of this only logged when it FOUND something, and the health
  // line reads the newest row - so one orphan on one night left the panel red
  // until admin_log pruned it, twelve months later. The owner would delete the
  // guests exactly as told, nothing would change, and they would learn to ignore
  // the door-codes signal. That is the A-wave 3 lesson on the door.
  {
    const rl3 = require('./services/remotelock');
    const uh = require('./services/unithealth');
    const sig = async (name) => {
      const h = await uh.compute();
      return (h.signals || []).find(x => x.key === name) || null;
    };
    reset();
    for (const id of Object.keys(L.state.persons)) delete L.state.persons[id];   // start from a lock with nothing on it
    // and from a unit with no credential outstanding - a code still live on a
    // finished session is rule 28's alarm and now correctly OUTRANKS the orphan
    // line, so it would mask what this section is testing
    db.db.prepare("UPDATE bookings SET remotelock_person_id=NULL").run(); db.save();
    L.seed([{ id: 'h-orphan-1', name: 'Golf - Zoe - 2026-09-01 10:00', ends_at: '2026-09-01T11:10:00', status: 'expired' }]);
    await rl3.findOrphanedCodes({ now: Date.parse('2026-09-16T00:00:00Z') });
    const red = await sig('doorcodes');
    ok('H1 an orphan at the lock turns the door-codes line RED', red && red.level === 'red' && /no record of/.test(red.detail || ''), red);
    // the owner does what the action tells them: deletes it at the lock
    delete L.state.persons['h-orphan-1'];
    await rl3.findOrphanedCodes({ now: Date.parse('2026-09-16T00:00:00Z') });
    const after = await sig('doorcodes');
    ok('H2 ...and the night after they clear it at the lock, the line goes GREEN on its own',
       after && after.level === 'green', after);
    ok('H3 a clean run records itself, so the newest word is always the latest check',
       logRows().some(x => x.event === 'DOOR_CODE_ORPHANS' && /^0 code/.test(x.detail || '')), logRows().slice(0, 3));
  }
  console.log('\n── I. the orphan check reads the WHOLE account ──');
  {
    const rl4 = require('./services/remotelock');
    reset();
    for (const id of Object.keys(L.state.persons)) delete L.state.persons[id];
    const many = []; for (let i = 0; i < 130; i++) many.push({ id: 'pg-' + i, name: 'Golf - P' + i + ' - 2026-09-01 10:00', ends_at: '2026-09-01T11:10:00', status: 'expired' });
    L.seed(many);
    const out = await caught(() => rl4.findOrphanedCodes({ now: Date.parse('2026-09-16T00:00:00Z') }));
    ok('I1 130 guests across three pages are all read - a short page is not the end',
       out.ok && out.v.orphans.length === 130, out.ok ? out.v.orphans.length : out.e);
  }

  console.log('\n── J. ONE NUMBER FOR THE OWNER\'S LAG ──');
  // The owner sets ONE number - "code works AFTER session (min)" - and three
  // files used to work it out independently: doorlock.codeWindow (what the lock
  // is told), scheduler.revokeLagMs (when the sweep takes it back) and the
  // doorcodes health signal (when the owner is told it is late). Two disagreed:
  // codeWindow read the legacy value as `Number(b.doorCodeBufferMins || 15)`,
  // so a unit whose legacy buffer is 0 or blank got 15 from the window and 0
  // from the sweep - the unit telling the door one time and enforcing another,
  // on a real shipped unit, because rule 14 keeps the legacy key readable
  // forever. All three now call doorlock.codeWindowMins.
  {
    const setCfg = (booking) => {
      const cfg = JSON.parse(fs.readFileSync(cfgPath));
      cfg.booking = Object.assign({ staffedAccess: false }, booking);
      fs.writeFileSync(cfgPath, JSON.stringify(cfg));
      delete require.cache[require.resolve('./services/config')];
      delete require.cache[require.resolve('./services/doorlock')];
      return require('./services/doorlock');
    };
    const b = bk('lagcheck');
    const windowLag = (dl) => {                 // what the LOCK is told, in minutes
      const w = dl.codeWindow(b);
      return Math.round((w.endDt.getTime() - dl.bookingEndDate(b).getTime()) / 60000);
    };
    // THE CASE THAT DIVERGED: an old unit carrying the legacy key set to 0
    let dl = setCfg({ doorCodeBufferMins: 0 });
    ok('J1 a legacy buffer of 0 is the owner\'s 0 everywhere - the window and the sweep agree',
       windowLag(dl) === 0 && dl.codeWindowMins().lag === 0, { window: windowLag(dl), resolver: dl.codeWindowMins().lag });
    // and blank, which Number('' || 15) also turned into 15 on one side only
    dl = setCfg({ doorCodeBufferMins: '' });
    // the default removal is thirty minutes after the session (maintainer, Oct 3 2026: "you delete it thirty minutes after the booking")
    ok('J2 nothing set anywhere falls back to the same number on BOTH sides - thirty after the session, never one number here and another there',
       windowLag(dl) === 30 && dl.codeWindowMins().lag === 30, { window: windowLag(dl), resolver: dl.codeWindowMins().lag });
    // the owner's own number wins over the legacy one
    dl = setCfg({ doorCodeBufferMins: 45, doorCodeLagMins: 5, doorCodeLeadMins: 20 });
    ok('J3 the owner\'s doorCodeLagMins wins over the legacy buffer, on both sides',
       windowLag(dl) === 5 && dl.codeWindowMins().lag === 5 && dl.codeWindowMins().lead === 20, dl.codeWindowMins());
    // a deliberate 0 from the owner is a number, not a blank
    dl = setCfg({ doorCodeBufferMins: 45, doorCodeLagMins: 0 });
    ok('J4 an owner who deliberately asks for 0 gets 0, not the legacy 45',
       windowLag(dl) === 0 && dl.codeWindowMins().lag === 0, dl.codeWindowMins());
    // and a negative or nonsense value never makes the window run backwards
    dl = setCfg({ doorCodeLagMins: -30, doorCodeLeadMins: 'abc' });
    ok('J5 a negative lag never shortens the session, and a non-number falls back',
       dl.codeWindowMins().lag === 0 && dl.codeWindowMins().lead === 15, dl.codeWindowMins());
    // NOBODY MAY KEEP A SECOND COPY. The behaviour above only proves the one
    // function; this proves nothing else resolves the number behind its back.
    const others = ['services/scheduler.js', 'services/unithealth.js']
      .filter(f => /doorCodeLagMins|doorCodeBufferMins/.test(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')));
    ok('J6 the scheduler and the health signal call the one resolver - neither works the number out again',
       others.length === 0, others);
    // AND THE PRODUCT, NOT ONLY THE HELPER. The divergence is only real if the
    // SWEEP acts on it: on a unit with the legacy buffer at 0, the lock was told
    // end+15 while the sweep's list said "take it back now", so the unit would
    // pull a code from under a customer the lock had been told was still inside
    // their window. This drives the exported sweep list, not the maths.
    {
      setCfg({ doorCodeBufferMins: 0 });
      delete require.cache[require.resolve('./services/scheduler')];
      const sch = require('./services/scheduler');
      const dl2 = require('./services/doorlock');
      const ended = new Date(Date.now() - 5 * 60000);
      const two = n => String(n).padStart(2, '0');
      const day = `${ended.getFullYear()}-${two(ended.getMonth() + 1)}-${two(ended.getDate())}`;
      const hm = `${two(ended.getHours())}:${two(ended.getMinutes())}`;
      db.db.prepare(`INSERT OR REPLACE INTO bookings (id, bay_id, bay_name, name, phone, date, end_date, start_time, end_time, duration_minutes, price_cents, status, remotelock_person_id) VALUES ('bk-lag','bay1','B1','Lag','5','${day}','${day}','00:00','${hm}',60,0,'confirmed','rl-lag')`).run();
      db.save();
      const listed = (await sch.liveDoorCredentials(new Date())).some(x => x.id === 'bk-lag');
      const stillGood = dl2.codeWindow({ id: 'bk-lag', date: day, end_date: day, start_time: '00:00', end_time: hm }).endDt.getTime() > Date.now();
      ok('J7 the sweep never wants back a code the lock was told is still good - the list and the window read the same number',
         !(listed && stillGood), { onTheSweepList: listed, lockSaysStillValid: stillGood });
      db.db.prepare("DELETE FROM bookings WHERE id='bk-lag'").run(); db.save();
    }
  }

  console.log('\n── K. the nightly orphan read never hammers the customer\'s lock account ──');
  // The ceiling was 200 pages PER STATUS - up to 800 requests a night at a
  // facility with years of expired guests, against the SAME account the unit
  // issues real door codes through. Getting ourselves rate-limited there is how
  // a nightly tidy-up turns into a customer at a door with no code. The read is
  // now budgeted, the statuses are read in danger order, and a read that did not
  // finish is never written down as a clean check.
  {
    const cfg = JSON.parse(fs.readFileSync(cfgPath));
    cfg.remotelock = { clientId: 'rl-client', clientSecret: 'rl-secret', deviceId: 'lock-1' };
    cfg.doorAccess = { provider: 'remotelock' };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    for (const m of ['./services/config', './services/remotelock']) delete require.cache[require.resolve(m)];
    const rl3 = require('./services/remotelock');
    reset();
    // more guests than a night's budget can read: 2,500 at 50 a page is 50 pages
    // for the FIRST status alone, and the budget is 40
    const many = []; for (let i = 0; i < 2500; i++) many.push({ id: 'big-' + i, name: 'Golf - B' + i + ' - 2026-09-01 10:00', ends_at: '2026-09-01T11:10:00', status: 'expired' });
    L.seed(many);
    const before = L.state.requests.length;
    const out = await caught(() => rl3.findOrphanedCodes({ now: Date.parse('2026-09-16T00:00:00Z') }));
    const asked = L.state.requests.filter(r => /access_persons/.test(r.url)).length - L.state.requests.slice(0, before).filter(r => /access_persons/.test(r.url)).length;
    ok('K1 one night asks the lock for a bounded number of pages, not up to 800',
       out.ok && asked <= rl3.PERSON_PAGE_BUDGET && asked > 0, { asked, budget: rl3.PERSON_PAGE_BUDGET, err: out.ok ? null : out.e });
    ok('K2 the budget ran out and the run SAYS SO rather than claiming a clean check',
       out.ok && !!out.v.truncated && out.v.pagesRead === rl3.PERSON_PAGE_BUDGET, out.ok ? { truncated: out.v.truncated, pagesRead: out.v.pagesRead } : out.e);
    ok('K3 the owner\'s log never records a partial read as "0 code(s) unaccounted for"',
       (() => { const d = String((logRows().find(x => x.event === 'DOOR_CODE_ORPHANS') || {}).detail || '');
                return /nightly page budget/.test(d) && !/^0 code\(s\) unaccounted for/.test(d); })(),
       (logRows().find(x => x.event === 'DOOR_CODE_ORPHANS') || {}).detail);
    // and the statuses are read in danger order, so a cut can only cost DEAD guests
    const report = {};
    await caught(() => rl3.listAccessPersons({ report, pageBudget: 3 }));
    ok('K4 the live statuses are read FIRST - a budget that runs out can only ever miss guests that cannot open a door',
       (report.statusesRead || [])[0] === 'current' && (report.statusesRead || [])[1] === 'upcoming', report);
    // a small account still reads to the end
    L.state.persons = {}; L.seed([{ id: 'small-1', name: 'Golf - S - 2026-09-01 10:00', ends_at: '2026-09-01T11:10:00', status: 'expired' }]);
    const r2 = {}; await caught(() => rl3.listAccessPersons({ report: r2 }));
    ok('K5 a normal facility is unaffected - the whole account is still read, and nothing says it was cut short',
       r2.truncated === null && r2.pages <= 8, r2);
  }

  await L.stop();
  console.log(`\nREMOTELOCK: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
