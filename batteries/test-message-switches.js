// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-message-switches.js - A MESSAGING SWITCH STOPS ITS OWN MESSAGE (Sep 25 2026)
//
// From the pilot facility handoff (20-24 Sep, section 7): unticking the "Door Code" EMAIL box
// stopped door codes being created and texted at all - one untick locked every
// customer out - and the reminder text and reminder email switches each turned the
// other off. Both faults were here: the scheduler's notif() required the text AND the
// email switch, and gated the whole door-code block with it. And the session-ending
// warning was gated by the TEXT switch alone, so turning the text off stopped the
// email too.
//
// A real scheduler tick in a fresh process, the real senders under SMS_DRYRUN /
// EMAIL_DRYRUN (which write exactly what would have gone into the owner's log), and a
// door provider that answers as RemoteLock does. What was sent is read off the disk.
'use strict';
process.env.TZ = 'America/Chicago';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 500) : '')); } };
const root = __dirname;
const STUB = path.join(root, '.msgswitch-stub.js');
fs.writeFileSync(STUB, `
const Module = require('module'); const orig = Module._load;
Module._load = function (req, parent) {
  const fromServices = parent && /[\\\\/]services[\\\\/]/.test(parent.filename || '');
  if (fromServices && req === './doorlock') { const real = orig.apply(this, arguments); return Object.assign({}, real, { generateDoorCode: async b => ({ pin: '2468', personId: 'p-' + b.id }) }); }
  return orig.apply(this, arguments);
};`);
const run = js => spawnSync(process.execPath, ['-r', STUB, '-e', js], { cwd: root, encoding: 'utf8', timeout: 120000,
  env: Object.assign({}, process.env, { TZ: 'America/Chicago', SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
const pad = n => String(n).padStart(2, '0');
const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
const hm = t => `${pad(t.getHours())}:${pad(t.getMinutes())}`;
const at = m => new Date(Date.now() + m * 60000);

function facility(sms, resend, ticks = 1) {
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Switch Golf', setup: { completed: true, eulaAccepted: true },
    server: { port: 3143, businessName: 'Switch Golf', adminPassword: 'switch-pw', timezone: 'America/Chicago' },
    booking: { staffedAccess: false, pricePerHalfHour: 25, openTime: '00:00', closeTime: '23:59', open24Hours: true, windowDays: 30 },
    sms: Object.assign({ sendReminder: true, reminderMinsBefore: 60, sendDoorCode: true, sendEndingWarning: true }, sms),
    resend: Object.assign({ apiKey: 're_switch_battery', fromEmail: 'desk@switch.example', sendReminder: true, sendDoorCode: true, sendEndingWarning: true }, resend),
    doorAccess: { provider: 'remotelock' }, remotelock: { clientId: 'rl-switch-battery', clientSecret: 'x', deviceId: 'lock-1' },
    bays: [{ id: 'sw-b1', name: 'Bay One', active: true }, { id: 'sw-b2', name: 'Bay Two', active: true }]
  }, null, 2));
  // two bookings: one starting in 10 minutes (its reminder and door code are due),
  // one ending in 10 minutes (its ending warning is due)
  const B = [{ id: 'sw-soon', bay: 'sw-b1', s: at(10), e: at(70), phone: '+15550100401', email: 'soon@switch.example' },
             { id: 'sw-ending', bay: 'sw-b2', s: at(-50), e: at(10), phone: '+15550100402', email: 'ending@switch.example' }];
  const rows = B.map(b => `db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,status,sms_consent,created_at,updated_at) VALUES ('${b.id}','${b.bay}','Bay','Pat Switch','${b.phone}','${b.email}','${ymd(b.s)}','${hm(b.s)}','${hm(b.e)}','${ymd(b.e)}',60,5000,'active',1,datetime('now','-1 day'),datetime('now','-1 day'))").run();`).join('');
  const seed = run(`const db=require('./services/db');db.initDb().then(async()=>{${rows}await db.flushed();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
  const tick = run(`const db=require('./services/db');db.initDb().then(async()=>{for(let i=0;i<${ticks};i++)await require('./services/scheduler').checkBookings();db.flushSync();process.exit(0)}).catch(e=>{console.error(e.stack);process.exit(1)})`);
  const read = run(`require('sql.js')().then(SQL=>{const d=new SQL.Database(require('fs').readFileSync('bookings.db'));const q=s=>{const r=d.exec(s);return r.length?r[0].values:[]};
    console.log(JSON.stringify({log:q("SELECT event,detail FROM admin_log WHERE event IN ('SMS_DRYRUN','EMAIL_DRYRUN','NOTIFY_SKIPPED')"),
      codes:q("SELECT id,COALESCE(door_code,''),sms_code_sent FROM bookings"),jobs:q("SELECT booking_id,kind,status FROM automation_jobs")}));process.exit(0)})`);
  let out = {}; try { out = JSON.parse(String(read.stdout).trim().split('\n').pop()); } catch { out = { error: (read.stderr || '') + (tick.stderr || '') + (seed.stderr || '') }; }
  const texts = (out.log || []).filter(([e]) => e === 'SMS_DRYRUN').map(([, d]) => d);
  const mails = (out.log || []).filter(([e]) => e === 'EMAIL_DRYRUN').map(([, d]) => d);
  const code = id => ((out.codes || []).find(r => r[0] === id) || [])[1] || '';
  const job = (id, kind) => ((out.jobs || []).find(r => r[0] === id && r[1] === kind) || [])[2] || null;
  return {
    ran: seed.status === 0 && tick.status === 0, err: (tick.stderr || seed.stderr || '').slice(-300),
    codeMade: code('sw-soon') === '2468',
    codeText: texts.some(t => /\+15550100401/.test(t) && /Door code 2468/.test(t)),
    codeMail: mails.some(m => /soon@switch/.test(m) && /Your Door Code/.test(m)),
    remText: texts.some(t => /\+15550100401/.test(t) && /Session starts in/.test(t)),
    remMail: mails.some(m => /soon@switch/.test(m) && /Reminder/.test(m)),
    endText: texts.some(t => /\+15550100402/.test(t) && /Session ends in/.test(t)),
    endMail: mails.some(m => /ending@switch/.test(m) && /session ends in/.test(m)),
    codeJob: job('sw-soon', 'door_code'), texts, mails,
    skips: (out.log || []).filter(([e]) => e === 'NOTIFY_SKIPPED').map(([, d]) => d)
  };
}

try {
  let r = facility({}, { sendDoorCode: false });
  ok('1a the "Door Code" EMAIL box unticked: the code is still made at the lock and still TEXTED - only the email stops', r.ran && r.codeMade && r.codeText && !r.codeMail, r);
  r = facility({ sendDoorCode: false }, {});
  ok('1b the "Door Code" TEXT box unticked: the code is still made and still EMAILED - only the text stops', r.ran && r.codeMade && r.codeMail && !r.codeText, r);
  r = facility({ sendDoorCode: false }, { sendDoorCode: false });
  ok('1c both unticked: the code is still made (the customer sees it on /my-booking), nothing is sent, and the job is done - never failed for a channel the owner turned off', r.ran && r.codeMade && !r.codeText && !r.codeMail && r.codeJob === 'done', r);
  r = facility({ sendReminder: false }, {});
  ok('7a the reminder TEXT switch off: the reminder EMAIL still goes', r.ran && r.remMail && !r.remText, r);
  r = facility({}, { sendReminder: false });
  ok('7b the reminder EMAIL switch off: the reminder TEXT still goes', r.ran && r.remText && !r.remMail, r);
  r = facility({ sendEndingWarning: false }, {});
  ok('7c the session-ending TEXT switch off: the session-ending EMAIL still goes (the same trap, found beside the reminders)', r.ran && r.endMail && !r.endText, r);
  r = facility({ sendEndingWarning: false, sendReminder: false }, { sendEndingWarning: false, sendReminder: false }, 3);
  const perBooking = r.skips.reduce((m, d) => { const k = d.replace(/\s+/g, ' '); m[k] = (m[k] || 0) + 1; return m; }, {});
  ok('7e both switches of a message off, three ticks in one run: the skip is in the owner\'s log ONCE per booking and message - not a line per booking every minute', r.ran && r.skips.length > 0 && Object.values(perBooking).every(n => n === 1) && r.skips.length <= 4 && !r.endText && !r.endMail && !r.remText && !r.remMail, { skips: r.skips, n: r.skips.length });
  r = facility({}, {});
  ok('7d everything on: every message goes on both channels', r.ran && r.codeMade && r.codeText && r.codeMail && r.remText && r.remMail && r.endText && r.endMail, r);
} finally {
  for (const f of ['config.json', 'bookings.db', STUB]) { try { fs.unlinkSync(path.isAbsolute(f) ? f : path.join(root, f)); } catch {} }
}
console.log(`\nMESSAGE SWITCHES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
