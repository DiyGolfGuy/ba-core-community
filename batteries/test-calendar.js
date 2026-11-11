// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-calendar.js - THE BOOKINGS IN THE OWNER'S OWN CALENDAR AND FILES (Oct 19 2026; services/calendarfeed.js, the
// /api/calendar/<key>.ics link in server.js, the owner's /api/admin/calendar and /api/admin/bookings/export, and the
// booking events services/webhooks.js now sends from every cancel, move and extension)
//
// example facility's manager asked for the bookings on a Google calendar; maintainer: "be able to export it. So they can have it in their
// own documents. Whatever they want to do with their data is theirs ... minimize as much other outside services that are
// paid for as we can." Bookings are written into the unit's database BEFORE it starts (the existing state a real unit
// has), then everything goes through the real routes, as an owner, a calendar service, the staff pad and a customer do.
//   F1  off until the owner turns it on: the link answers 404 (as for any wrong key, an accented one included); turned on, the link is on the
//       facility's own public address; its key never rides in the settings the browser reads
//   F2  the calendar itself, read as Google reads it: confirmed and played bookings and the blocks, never a cancelled
//       booking or an unpaid checkout; times in UTC that match the facility's wall clock (worked out here on its own,
//       from the time zone's rules), a session past midnight ending the next day; RFC 5545's shape - CRLF, no line over
//       75 octets, folds that never split a character and unfold to the exact name, ; , and \ escaped, a UID and DTSTAMP
//       on every event; what is due at the door in My Booking's words; no door code; no phone or email unless asked
//   F3  the owner's choices: names off - no name anywhere; phone and email on - in the notes
//   F4  a new link: the old one stops at once (404), the new one works; switched off: 404; each in the owner's log
//   E1  the downloads: CSV (a formula typed as a name stays text, a phone number stays a phone number), a spreadsheet
//       (.xlsx, its sheet read back), a calendar file - any dates, older than the link shows included; the owner's alone;
//       a bad range is refused in plain words; each download in the owner's log
//   W1  the webhook events: a customer's own cancel, a staff cancel from the pad, a move and an extension each go out
//       (booking.cancelled with who, booking.changed with what changed and where it was) - never with a door code
//   F5  and the calendar follows: the cancelled ones gone, the moved one at its new time, the extended one to its new end
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 700) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = __dirname;
const PORT = 3001, B = 'http://127.0.0.1:' + PORT;
const OWNER = 'cal-owner-pw';
const TZ = 'America/Chicago';
// LOCAL dates, computed from now (a battery never writes a calendar date as "the future")
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dplus = n => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (n), 12));
// THE INDEPENDENT ANSWER: the UTC instant whose wall clock in the facility's zone reads <date> <time> - found from the
// zone's own rules (Intl), never from the product's arithmetic
function wallToUtc(date, time) {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
    const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    guess += Date.UTC(y, mo - 1, d, h, mi) - seen;
  }
  return new Date(guess).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, '');
const events = (ics) => unfold(ics).split('BEGIN:VEVENT').slice(1).map(e => {
  const o = {}; for (const line of e.split('\r\n')) { const m = line.match(/^([A-Z-]+)(;[^:]*)?:(.*)$/); if (m && !(m[1] in o)) o[m[1]] = m[3]; } return o;
});
const unesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
// one file out of a zip, read the way the format is laid out (a local header, then the deflated bytes)
// one entry out of a zip, read the way test-year-export reads its workbook (the system unzip): archiver streams every
// entry with a data descriptor, so the local header carries no sizes and a hand reader of local headers sees nothing
function zipEntry(buf, name) {
  const f = path.join(require('os').tmpdir(), 'ba-calendar-export-' + process.pid + '.zip');
  try { fs.writeFileSync(f, buf); return require('child_process').execFileSync('unzip', ['-p', f, name], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }
  catch { return null; } finally { try { fs.unlinkSync(f); } catch {} }
}

(async () => {
  // ── the webhook receiver: what an owner's automation service would be handed ──
  const hooks = [];
  const recv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { hooks.push(JSON.parse(b)); } catch {} res.end('{}'); }); });
  await new Promise(r => recv.listen(0, '127.0.0.1', r));
  try { if ((await fetch(B + '/api/time')).ok) { ok('port ' + PORT + ' is free (an orphaned server is running - kill it by pid and rerun)', false); process.exit(1); } } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    setup: { completed: true, eulaAccepted: true }, unit: { id: 'cal-unit-1' },
    server: { port: PORT, businessName: 'Calendar Club', adminPassword: OWNER, timezone: TZ, staff: [{ name: 'Dana', code: '4321', active: true }] },
    booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '06:00', closeTime: '02:00', closeNextDay: true }, cancellationPolicy: { windowHours: 24 }, waiver: { mode: 'off' },
    contact: { address: '1 Fairway Rd, Omaha, NE' }, seo: { domain: 'https://calendarclub.com', city: 'Omaha', state: 'NE', zip: '68102' },
    webhooks: { url: 'http://127.0.0.1:' + recv.address().port + '/hook', secret: 'whsec_test_calendar', includeContact: true },
    bays: [{ id: 'cb1', name: 'Bay 1', active: true }, { id: 'cb2', name: 'Bay 2', active: true }]
  }, null, 2));
  const LONG = 'Zoë "Ziggy" Ramírez-Okonkwo and the Tuesday Night Long-Drive Society 🏌️ ' + 'x'.repeat(40);
  const rows = [
    // id, bay, name, phone, email, date, start, end, end_date, price, tax, status, intent, deposit, member, member_due, guests, type, door
    ['c-paid', 'cb1', "Ann O'Neil, Jr.; \"VIP\" \\ crew", '+15550301001', 'ann@cal.example', dplus(1), '18:00', '19:00', null, 4000, 300, 'active', 'pi_paid', 0, null, null, 0, null, '8421'],
    ['c-deposit', 'cb1', 'Dee Posit', '+15550301002', 'dee@cal.example', dplus(2), '10:00', '11:00', null, 1000, 0, 'active', 'pi_dep', 1, null, null, 0, null, null],
    ['c-member', 'cb2', 'Mem Ber', '+15550301003', 'mem@cal.example', dplus(3), '12:00', '13:00', null, 0, 0, 'active', null, 0, 'm1', 2500, 2, null, null],
    ['c-late', 'cb2', 'Night Owl', '+15550301004', 'owl@cal.example', dplus(4), '23:00', '01:00', dplus(5), 5000, 0, 'active', 'pi_late', 0, null, null, 0, null, null],
    ['c-far', 'cb1', 'Far Away', '+15550301005', 'far@cal.example', dplus(60), '09:00', '10:00', null, 2500, 0, 'active', 'pi_far', 0, null, null, 0, null, null],
    ['c-cancelled', 'cb1', 'Gone Girl', '+15550301006', 'gone@cal.example', dplus(1), '08:00', '09:00', null, 2500, 0, 'cancelled', null, 0, null, null, 0, null, null],
    ['c-pending', 'cb2', 'Never Paid', '+15550301007', 'never@cal.example', dplus(1), '08:00', '09:00', null, 2500, 0, 'pending_payment', null, 0, null, null, 0, null, null],
    ['c-old', 'cb1', 'Old Timer', '+15550301008', 'old@cal.example', dplus(-40), '15:00', '16:00', null, 2500, 0, 'completed', 'pi_old', 0, null, null, 0, null, null],
    ['c-block', 'cb2', 'Projector lamp', '', '', dplus(2), '06:00', '08:00', null, 0, 0, 'active', null, 0, null, null, 0, 'maintenance', null],
    ['c-formula', 'cb1', '=HYPERLINK("http://evil.example","click")', '+15550301009', 'f@cal.example', dplus(5), '07:00', '08:00', null, 2500, 0, 'active', null, 0, null, null, 0, null, null],
    ['c-long', 'cb2', LONG, '+15550301010', 'long@cal.example', dplus(5), '14:00', '15:00', null, 2500, 0, 'active', 'pi_long', 0, null, null, 0, null, null],
    ['c-cust', 'cb1', 'Self Cancel', '+15550301011', 'self@cal.example', dplus(3), '15:00', '16:00', null, 0, 0, 'active', null, 0, null, null, 0, null, null],
    ['c-staff', 'cb2', 'Pad Cancel', '+15550301012', 'pad@cal.example', dplus(3), '16:00', '17:00', null, 0, 0, 'active', null, 0, null, null, 0, null, null],
    ['c-move', 'cb1', 'Mover Shaker', '+15550301013', 'move@cal.example', dplus(6), '10:00', '11:00', null, 0, 0, 'active', null, 0, null, null, 0, null, null],
    ['c-ext', 'cb2', 'More Time', '+15550301014', 'ext@cal.example', dplus(6), '14:00', '15:00', null, 0, 0, 'active', null, 0, null, null, 0, null, null],
  ];
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    db.initDb().then(async () => {
      const rows = ${JSON.stringify(rows)};
      const names = { cb1: 'Bay 1', cb2: 'Bay 2' };
      const st = db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent,is_deposit,member_id,member_due_cents,member_guest_count,booking_type,door_code,sms_consent) VALUES (?,?,?,?,?,?,?,?,?,?,60,?,?,?,?,?,?,?,?,?,?,0)");
      for (const r of rows) st.run(r[0], r[1], names[r[1]], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16], r[17], r[18]);
      await db.flushed(); process.exit(0);
    }).catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  ok('stage: bookings, a block, a cancelled one and an unpaid checkout written before the unit starts', seed.status === 0, (seed.stderr || '').slice(-400));

  const env = Object.assign({}, process.env, { TZ, SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent', BA_WATCHDOG_OFF: '1', BA_UPDATE_LIST_URL: 'off', BA_DISABLE_SCHEDULER: '1' });
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  const stop = async () => { if (child.exitCode !== null) return; child.kill('SIGTERM'); for (let i = 0; i < 25 && child.exitCode === null; i++) await sleep(200); if (child.exitCode === null) child.kill('SIGKILL'); };
  try {
    let up = false; for (let i = 0; i < 60; i++) { await sleep(300); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
    ok('stage: the unit is up', up, out.slice(-400));
    const OH = { 'Content-Type': 'application/json', 'x-admin-password': OWNER };
    const owner = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: OH, body: b === undefined ? undefined : JSON.stringify(b) }); let d = {}; try { d = await r.json(); } catch {} return { s: r.status, d }; };
    const feed = async (link) => { const u = new URL(link, B); const r = await fetch(B + u.pathname); return { s: r.status, type: r.headers.get('content-type') || '', text: await r.text() }; };
    const ownerLog = async (ev) => (((await owner('GET', '/api/admin/log?per_page=300')).d.entries) || []).filter(e => e.event === ev);

    // ── F1 ──
    const off = await owner('GET', '/api/admin/calendar');
    const guess = await feed('/api/calendar/' + 'A'.repeat(43) + '.ics');
    const on = await owner('POST', '/api/admin/calendar', { enabled: true });
    const link = on.d.link || '';
    const key = (link.match(/\/api\/calendar\/([A-Za-z0-9_-]+)\.ics$/) || [])[1] || '';
    const seenCfg = JSON.stringify((await owner('GET', '/api/admin/config')).d);
    const anon = await fetch(B + '/api/admin/calendar');
    ok('F1 off until the owner turns it on (404 for any key); on, the link is on the facility\'s own public address with a long random key, the key is never in the settings the browser reads, and the card is the owner\'s alone',
       off.d.enabled === false && guess.s === 404 && on.s === 200 && on.d.enabled === true && link.startsWith('https://calendarclub.com/api/calendar/') && key.length >= 40
       && !seenCfg.includes(key) && [401, 403].includes(anon.status) && (await ownerLog('CALENDAR_LINK_ON')).length === 1, { off: off.d, guess: guess.s, on: on.d, anon: anon.status });
    // the pack review, Oct 24 2026: a wrong key of the right length with one accented letter (more bytes than characters)
    // threw inside the comparison and answered 500 while the feed was on - which told a stranger the feed is switched on
    const accented = await feed('/api/calendar/' + 'é' + key.slice(1) + '.ics');
    ok('F1b a wrong key of the right length with an accented letter is a plain 404, the same as any wrong key', accented.s === 404, accented.s);

    // ── F2 ──
    const f = await feed(link);
    const ev = events(f.text);
    const by = Object.fromEntries(ev.map(e => [String(e.UID || '').split('@')[0], e]));
    const lines = f.text.split('\r\n');
    const longest = Math.max(...lines.map(l => Buffer.byteLength(l, 'utf8')));
    const brokenFold = lines.some(l => l.includes('�'));
    const ids = Object.keys(by).sort();
    const want = ['c-block', 'c-cust', 'c-deposit', 'c-ext', 'c-far', 'c-formula', 'c-late', 'c-long', 'c-member', 'c-move', 'c-paid', 'c-staff'].sort();
    const paid = by['c-paid'] || {}, late = by['c-late'] || {}, far = by['c-far'] || {};
    ok('F2 the calendar as Google reads it: text/calendar; the confirmed bookings and the block - never the cancelled one, the unpaid checkout or one older than the window (' + ids.length + ' events)',
       f.s === 200 && /text\/calendar/.test(f.type) && /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/.test(f.text) && f.text.endsWith('END:VCALENDAR\r\n') && JSON.stringify(ids) === JSON.stringify(want)
       && /X-WR-CALNAME:Calendar Club bookings/.test(f.text) && /REFRESH-INTERVAL;VALUE=DURATION:PT1H/.test(f.text), { s: f.s, type: f.type, ids });
    ok('F2b times in UTC that match the facility\'s wall clock as its own time zone\'s rules give it - tomorrow evening, two months out, and a session past midnight that ends the next day',
       paid.DTSTART === wallToUtc(dplus(1), '18:00') && paid.DTEND === wallToUtc(dplus(1), '19:00') && far.DTSTART === wallToUtc(dplus(60), '09:00')
       && late.DTSTART === wallToUtc(dplus(4), '23:00') && late.DTEND === wallToUtc(dplus(5), '01:00'),
       { paid: [paid.DTSTART, wallToUtc(dplus(1), '18:00')], far: [far.DTSTART, wallToUtc(dplus(60), '09:00')], late: [late.DTEND, wallToUtc(dplus(5), '01:00')] });
    ok('F2c RFC 5545\'s shape: CRLF lines, none over 75 octets, folds that never split a character and unfold to the exact long name (an accent and an emoji); ; , and \\ escaped; a UID and a DTSTAMP on every event',
       longest <= 75 && !brokenFold && unesc((by['c-long'] || {}).SUMMARY) === 'Bay 2 - ' + LONG && /SUMMARY:Bay 1 - Ann O'Neil\\, Jr\.\\; "VIP" \\\\ crew/.test(unfold(f.text))
       && ev.every(e => e.UID && /^\d{8}T\d{6}Z$/.test(e.DTSTAMP || '')) && paid.UID === 'c-paid@cal-unit-1' && !/\n(?!\r)/.test(f.text.replace(/\r\n/g, '')), { longest, brokenFold, long: (by['c-long'] || {}).SUMMARY });
    const desc = (id) => unesc((by[id] || {}).DESCRIPTION);
    ok('F2d what is due at the door in My Booking\'s words (paid online, a deposit, a member settling at the door); the block named as a block; no door code anywhere; no phone or email unless asked',
       /Paid online \$43\.00/.test(desc('c-paid')) && /Deposit paid \$10\.00 - the balance settles at the door/.test(desc('c-deposit')) && /about \$25\.00 settles at the door/.test(desc('c-member')) && /Member \+ 2 guests/.test(desc('c-member'))
       && (by['c-block'] || {}).SUMMARY === 'Bay 2 - Maintenance: Projector lamp' && !f.text.includes('8421') && !f.text.includes('+15550301001') && !f.text.includes('ann@cal.example'),
       { paid: desc('c-paid'), dep: desc('c-deposit'), mem: desc('c-member'), block: (by['c-block'] || {}).SUMMARY });

    // F2e: the address is the one the owner typed. The first cut read seo.address - a setting no screen has ever set
    // (the battery staged it, so it agreed with its author) - and every event, and every emailed invite, carried only
    // the city and state. The real field is Settings > Business & Content > Contact Information > Street Address.
    const invite = spawnSync(process.execPath, ['-e', `console.log(require('./services/ics').buildIcs({ id: 'inv-1', date: '${dplus(3)}', start_time: '18:00', end_time: '19:00', bay_name: 'Bay 1', name: 'Ann' }));process.exit(0)`], { cwd: root, encoding: 'utf8', timeout: 30000 });
    const invLoc = unesc((events(invite.stdout || '')[0] || {}).LOCATION);
    ok('F2e the facility\'s street address (Contact Information, as typed) with its ZIP is the LOCATION of every event in the feed and of the invite a booking email carries - not just the city and state',
       ev.length > 0 && ev.every(e => unesc(e.LOCATION) === '1 Fairway Rd, Omaha, NE, 68102') && invLoc === '1 Fairway Rd, Omaha, NE, 68102', { feed: unesc(paid.LOCATION), invite: invLoc });

    // ── F3 ──
    await owner('POST', '/api/admin/calendar', { names: false });
    const f3a = await feed(link);
    await owner('POST', '/api/admin/calendar', { names: true, contact: true });
    const f3b = await feed(link);
    const e3b = Object.fromEntries(events(f3b.text).map(e => [String(e.UID || '').split('@')[0], e]));
    ok('F3 the owner\'s choices: names off - "Bay 1 - Booked" and no name anywhere; phone and email on - in the notes (and still no door code)',
       /SUMMARY:Bay 1 - Booked/.test(f3a.text) && !f3a.text.includes('Neil') && !f3a.text.includes('Ramírez') && /Phone: \+15550301001/.test(unesc((e3b['c-paid'] || {}).DESCRIPTION)) && /Email: ann@cal\.example/.test(unesc((e3b['c-paid'] || {}).DESCRIPTION)) && !f3b.text.includes('8421'));
    await owner('POST', '/api/admin/calendar', { contact: false });

    // ── F4 ──
    const nl = await owner('POST', '/api/admin/calendar', { newLink: true });
    const oldRead = await feed(link), newRead = await feed(nl.d.link || '');
    await owner('POST', '/api/admin/calendar', { enabled: false });
    const offRead = await feed(nl.d.link || '');
    const reOn = await owner('POST', '/api/admin/calendar', { enabled: true });
    ok('F4 a new link: the old one stops at once (404) and the new one works; switched off: 404; on again: the same new link; each in the owner\'s log',
       nl.d.link && nl.d.link !== link && oldRead.s === 404 && newRead.s === 200 && offRead.s === 404 && reOn.d.link === nl.d.link
       && (await ownerLog('CALENDAR_LINK_NEW')).length === 1 && (await ownerLog('CALENDAR_LINK_OFF')).length === 1, { old: oldRead.s, now: newRead.s, off: offRead.s });
    const LINK = reOn.d.link;

    // ── E1 ──
    const dl = async (q) => { const r = await fetch(B + '/api/admin/bookings/export?' + new URLSearchParams(q), { headers: { 'x-admin-password': OWNER } }); const buf = Buffer.from(await r.arrayBuffer()); return { s: r.status, type: r.headers.get('content-type') || '', name: ((r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/) || [])[1] || '', buf }; };
    const csv = await dl({ from: dplus(-60), to: dplus(70), format: 'csv', names: '1', contact: '1' });
    const csvT = csv.buf.toString('utf8');
    const csvNo = await dl({ from: dplus(-60), to: dplus(70), format: 'csv', names: '0', contact: '0' });
    const xl = await dl({ from: dplus(-60), to: dplus(70), format: 'xlsx' });
    const sheet = xl.s === 200 ? zipEntry(xl.buf, 'xl/worksheets/sheet1.xml') || '' : '';
    const icsX = await dl({ from: dplus(-60), to: dplus(70), format: 'ics' });
    const bad = await dl({ from: dplus(5), to: dplus(1), format: 'csv' });
    const fmt = await dl({ from: dplus(1), to: dplus(5), format: 'pdf' });
    const anonDl = await fetch(B + '/api/admin/bookings/export?from=' + dplus(1) + '&to=' + dplus(2) + '&format=csv');
    ok('E1 CSV of any dates (one older than the link shows included): a formula typed as a name stays text, a phone number stays a phone number, phone and email only when asked, no names when not',
       csv.s === 200 && /text\/csv/.test(csv.type) && /^calendar-club-bookings-.+\.csv$/.test(csv.name) && /^Booking,Date,Start,End,Ends on,Bay,Kind,Status,Customer,Phone,Email/.test(csvT)
       && /\nc-old,/.test(csvT) && csvT.includes(`"'=HYPERLINK(""http://evil.example"",""click"")"`) && csvT.includes(',+15550301001,') && !csvT.includes('8421') && !/c-cancelled|c-pending/.test(csvT)
       && csvNo.s === 200 && !csvNo.buf.toString().includes('Customer') && !csvNo.buf.toString().includes("O'Neil") && !csvNo.buf.toString().includes('+15550301001'), { csv: csvT.slice(0, 400) });
    ok('E1b the spreadsheet (.xlsx, our own writer) opens to a Bookings sheet with the rows and money as numbers; the calendar file holds the same bookings',
       xl.s === 200 && /spreadsheetml/.test(xl.type) && xl.buf.slice(0, 2).toString() === 'PK' && /Old Timer/.test(sheet) && /<v>40<\/v>/.test(sheet) && !sheet.includes('8421')
       && icsX.s === 200 && events(icsX.buf.toString()).some(e => /^c-old@/.test(e.UID)), { xl: xl.s, sheet: sheet.slice(0, 200) });
    ok('E1c a range that ends before it starts, or a format there is not, is refused in plain words; the downloads are the owner\'s alone; each one is in the owner\'s log',
       bad.s === 400 && /before the first/.test(bad.buf.toString()) && fmt.s === 400 && [401, 403].includes(anonDl.status) && (await ownerLog('BOOKINGS_EXPORTED')).length === 4,
       { bad: bad.buf.toString(), fmt: fmt.buf.toString(), anon: anonDl.status });

    // ── W1: the booking events, through the real routes ──
    const j = async (m, p, b, h) => { const r = await fetch(B + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, h || {}), body: b === undefined ? undefined : JSON.stringify(b) }); let d = {}; try { d = await r.json(); } catch {} return { s: r.status, d }; };
    const st = await j('POST', '/api/staff/login', { code: '4321' });
    const SH = { 'x-staff-token': st.d.token };
    await j('POST', '/api/customer/request-pin', { email: 'self@cal.example' });
    await sleep(500);
    const pin = ((out.match(/verification code: (\d{6})/g) || []).pop() || '').slice(-6);
    const cc = await j('POST', '/api/customer/cancel', { email: 'self@cal.example', pin, bookingId: 'c-cust' });
    const sc = await j('POST', '/api/staff/booking/c-staff/cancel', { refund_type: 'none', reason: 'the group called' }, SH);
    const mv = await j('POST', '/api/staff/booking/c-move/move', { date: dplus(7), start_time: '12:00', duration_minutes: 60, bay_id: 'cb2' }, SH);
    const ex = await j('POST', '/api/staff/bookings/c-ext/extend', { minutes: 30 }, SH);
    await sleep(1500);
    const hook = (event, id) => hooks.find(h => h.event === event && h.data && h.data.id === id);
    const hc = hook('booking.cancelled', 'c-cust'), hs = hook('booking.cancelled', 'c-staff'), hm = hook('booking.changed', 'c-move'), he = hook('booking.changed', 'c-ext');
    ok('W1 the booking events, each from the real route: a customer\'s own cancel (by customer), a staff cancel from the pad (by the staff member), a move (where it was and where it is now) and an extension (the new end) - and no door code in any of them',
       cc.s === 200 && sc.s === 200 && mv.s === 200 && ex.s === 200 && !!hc && hc.data.by === 'customer' && hc.data.end_time === '16:00'
       && !!hs && /^staff/.test(hs.data.by) && !!hm && hm.data.change === 'moved' && hm.data.date === dplus(7) && hm.data.start_time === '12:00' && hm.data.bay === 'Bay 2' && hm.data.was && hm.data.was.date === dplus(6) && hm.data.was.bay === 'Bay 1'
       && !!he && he.data.change === 'extended' && he.data.end_time === '15:30' && he.data.extended_minutes === 30 && he.data.was.end_time === '15:00'
       && !JSON.stringify(hooks).includes('8421') && hooks.every(h => h.facility === 'Calendar Club'),
       { cc: cc.s, sc: sc.s, mv: mv.s, ex: ex.s, ccErr: cc.d.error, events: hooks.map(h => h.event + ':' + (h.data && h.data.id)) });

    // ── F5 ──
    const f5 = Object.fromEntries(events((await feed(LINK)).text).map(e => [String(e.UID || '').split('@')[0], e]));
    ok('F5 and the calendar follows: both cancelled bookings gone, the moved one at its new day, time and bay, the extended one to its new end',
       !f5['c-cust'] && !f5['c-staff'] && f5['c-move'] && f5['c-move'].DTSTART === wallToUtc(dplus(7), '12:00') && /^Bay 2 - /.test(unesc(f5['c-move'].SUMMARY)) && f5['c-ext'] && f5['c-ext'].DTEND === wallToUtc(dplus(6), '15:30'),
       { move: f5['c-move'] && [f5['c-move'].DTSTART, f5['c-move'].SUMMARY], ext: f5['c-ext'] && f5['c-ext'].DTEND });
  } catch (e) {
    ok('the battery ran to the end', false, String(e && e.stack || e));
  } finally {
    await stop();
    try { recv.close(); } catch {}
    if (fail) console.log(out.split('\n').filter(l => /calendar|webhook|Error|error/i.test(l)).slice(-25).join('\n'));
    console.log(`\nCALENDAR: ${pass} passed, ${fail} failed`);
    for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
    process.exit(fail ? 1 : 0);
  }
})();
