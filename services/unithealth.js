// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// services/unithealth.js - THE UNIT-HEALTH LINE (rule 23, A-wave 5, Sep 11 2026)
//
// "If the unit can tell it is broken, something must say so out loud." ONE
// function computes every signal the product can tell about itself; ONE
// route serves it; the loop's gate calls that route; the About panel's copy
// line carries the summary; the banner, the nightly email and the text (the
// next waves) all read this and nothing else.
//
// Signals (each: key, label, level green|amber|red, detail, action - what to
// DO, never just that something is wrong):
//   automation  jobs overdue (red) / failed or missed in 48 h (amber)
//   scheduler   the minute tick has not run for 3+ minutes (red)
//   tunnel      a configured cloudflared service that is not active (red)
//   disk        below the free-space floor (red)
//   backups     nightly enabled and the last night is missing, old or failed (red/amber)
//   messages    texts or emails FAILED to send in 24 h - not "not configured" (amber)
//   writer      the database refused a stale write in this process (red)
//   licence     the hardware lock does not authorise this unit (red)
//   update      an update was rolled back in the last 7 days (amber)
//   paylib      a customer's browser could not load Stripe.js in 24 h (red)
//   checkout    a paid checkout needed a person and did not get one (red)
//   membership  someone paid for a membership and has no member record (red)
//   plaincopy   a copy left the unit unencrypted in 7 days, or a copy is paused for want of a passphrase (amber)
//
// THE DEAD-CHECKER RULE (maintainer's ruling): the route serves the result the
// scheduler's tick STORED, with the time it was checked; a result older than
// CHECK_STALE_MS, or none at all, reads RED ("the checker itself has not run
// since ..."). Silence that means healthy and silence that means the checker
// died must never look the same. `?fresh=1` recomputes on demand - the green
// line "everything is fine, last checked <time>" the owner can ask for.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getConfig } = require('./config');

const CHECK_STALE_MS = 5 * 60000;      // the tick is every minute; five misses is a dead checker
const SCHED_STALE_MS = 3 * 60000;
let _stored = null;                    // { checkedAt, ok, signals, summary } from the last refresh
let _lastTick = 0;                     // the scheduler tells us when it ran (services/scheduler.js)

function noteTick() { _lastTick = Date.now(); }

const sig = (key, label, level, detail, action) => ({ key, label, level, ok: level === 'green', detail, action });
const ago = ms => ms < 90000 ? `${Math.round(ms / 1000)} s ago` : ms < 5400000 ? `${Math.round(ms / 60000)} min ago` : `${(ms / 3600000).toFixed(1)} h ago`;

const DEVICE_KINDS = ['power_on', 'power_off', 'ir_on', 'ir_off', 'pc_check', 'shutdown', 'pc_restart', 'facility_on', 'facility_off'];   // the facility's own devices too (Oct 21 2026)
function compute() {
  const cfg = getConfig();
  const out = [];
  // automation
  try {
    const h = require('./automation').health({ hours: 48 });
    // WHAT IS WRONG NOW COMES BEFORE WHAT WENT WRONG (Sep 25 2026, the build review): a dropped
    // plug and a device being retried are live; a failed job is up to two days old. The plug line
    // was last in the chain, so any failed reminder or old test job hid it - it is now said
    // whichever line fires.
    const u = require('./deviceprobe').unreachable();
    // a plug that answers but asks for a password is named apart: it is on the Wi-Fi, so "check it is plugged in" is the
    // wrong thing to tell the owner (Oct 19 2026)
    const locked = u.filter(x => /cannot be switched: it asks for a password/.test(String(x.detail || '')));
    const gone = u.filter(x => !locked.includes(x));
    const plugs = [gone.length ? `${gone.length} smart plug(s) not answering on the network - ${String(gone[0].detail || '').split(' | ')[0]} since ${String(gone[0].since || '').slice(11, 16)} UTC` : '',
                   locked.length ? `${locked.length} smart plug(s) asking for a password, so the unit cannot switch them - ${String(locked[0].detail || '').split(' | ')[0]}` : ''].filter(Boolean).join('; ');
    const also = plugs ? '; also ' + plugs : '';
    const plugAction = (gone.length ? 'Check the plug is plugged in and on the facility\'s Wi-Fi (its own app shows it). ' : '') +
      (locked.length ? 'In the Shelly app, open the plug and switch its login (authentication) off - the unit sends no password. ' : '') +
      'The unit asks every two minutes and this clears on its own when it answers.';
    const r = (h.retrying || []).filter(j => DEVICE_KINDS.includes(j.kind));
    if (h.overdue > 0) out.push(sig('automation', 'Automation', 'red', `${h.overdue} job(s) overdue - queued but never claimed${also}`, 'Open Settings > Protection > Automation Health. If the count keeps growing, the scheduler is not running: restart the unit (unplug it for ten seconds), then check again.'));
    // A DEVICE THAT DID NOT ANSWER SHOWS NOW, NOT 38 MINUTES LATER (Sep 25 2026, maintainer's item 6 -
    // pilot facility's IR emitter fell off the ceiling and nothing noticed). A plug, a TV, a Home
    // Assistant device or a PC that failed its job and is being retried is named here straight
    // away; the "failed" line below only came once every retry had run out.
    else if (r.length) {
      const f = r[0];
      out.push(sig('automation', 'Automation', 'amber', `${r.length} device job(s) did not work and are being retried - ${f.kind === 'pc_check' ? 'a simulator PC did not come up after its wake' : f.kind === 'pc_restart' ? 'a simulator PC did not take its restart before the next group' : (f.name || f.device || f.kind)}${f.bay ? ' (' + f.bay + ')' : ''}: ${String(f.error || '').slice(0, 100)}${also}`,
        'Check the device is powered and on the network - the unit keeps trying. Settings > Protection > Automation Health names each one.'));
    }
    else if (plugs) out.push(sig('automation', 'Automation', 'amber', plugs + (h.failed.length ? `; also ${h.failed.length} job(s) failed or missed in the last two days` : ''), plugAction));
    else if (h.failed.length) out.push(sig('automation', 'Automation', 'amber', `${h.failed.length} job(s) failed or missed in the last two days (${[...new Set(h.failed.map(f => f.kind))].join(', ')})`, 'Open Settings > Protection > Automation Health, read each line and press Retry where it makes sense; a missed reminder is only a missed message.'));
    else out.push(sig('automation', 'Automation', 'green', 'every job claimed and run', ''));
  } catch (e) { out.push(sig('automation', 'Automation', 'red', 'could not read the job table: ' + e.message, 'Restart the unit; if this stays red, consult the troubleshooting guide.')); }
  // the scheduler itself
  if (!_lastTick) out.push(sig('scheduler', 'Scheduler', 'amber', 'has not ticked yet since this start', 'Wait two minutes; if this stays, restart the unit.'));
  else if (Date.now() - _lastTick > SCHED_STALE_MS) out.push(sig('scheduler', 'Scheduler', 'red', `last ran ${ago(Date.now() - _lastTick)} - reminders, door codes and bay power are not being driven`, 'Restart the unit (unplug it for ten seconds). If it happens again, consult the troubleshooting guide with the About panel\'s copy line.'));
  else out.push(sig('scheduler', 'Scheduler', 'green', `running (last tick ${ago(Date.now() - _lastTick)})`, ''));
  // the tunnel
  try {
    const home = require('os').homedir();
    const configured = fs.existsSync('/etc/cloudflared') || fs.existsSync(path.join(home, '.cloudflared')) || fs.existsSync(require('./getonline').CONFIG);   // or the connection made by "Connect my box" (services/getonline.js)
    if (!configured) out.push(sig('tunnel', 'Website tunnel', 'green', 'no tunnel configured on this unit (LAN only)', ''));
    else {
      let active = 'unknown';
      try { active = execFileSync(process.env.BA_TEST_SYSTEMCTL || 'systemctl', ['is-active', 'cloudflared'], { encoding: 'utf8', timeout: 5000 }).trim(); } catch (e) { active = String((e.stdout || '') + '').trim() || 'inactive'; }
      if (active === 'active') out.push(sig('tunnel', 'Website tunnel', 'green', 'cloudflared is running', ''));
      else out.push(sig('tunnel', 'Website tunnel', 'red', `cloudflared is ${active} - your website is unreachable from the internet (booking on the building's own network still works)`, 'At the unit: sudo systemctl restart cloudflared (the unit password). If it will not stay up, consult the troubleshooting guide - the tunnel credentials may need re-issuing.'));
    }
  } catch (e) { out.push(sig('tunnel', 'Website tunnel', 'amber', 'could not check: ' + e.message, 'consult the troubleshooting guide.')); }
  // disk
  try {
    const d = require('./backup').diskSpace();
    if (d.low) out.push(sig('disk', 'Disk space', 'red', d.message || 'below the free-space floor', 'Settings > Protection > Backups: remove old local backups, or plug in a USB drive for backups; large photos on the Website editor cards can be re-uploaded smaller. Keep space available for backups and incoming bookings.'));
    else if (d.free !== null) out.push(sig('disk', 'Disk space', 'green', `${Math.round(d.free / 1048576)} MB free`, ''));
    else out.push(sig('disk', 'Disk space', 'amber', 'could not determine free space', ''));
  } catch (e) { out.push(sig('disk', 'Disk space', 'amber', 'could not check: ' + e.message, '')); }
  // backups
  try {
    const b = cfg.backup || {};
    const enabled = b.enabled !== false;
    const ln = b.lastNightly || null;
    const n = new Date(), today = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');   // the backup's own day (services/backup.js localYmd)
    const daysOld = ln && ln.date ? Math.round((Date.parse(today) - Date.parse(ln.date)) / 86400000) : null;
    if (!enabled) out.push(sig('backups', 'Nightly backup', 'amber', 'nightly backups are switched OFF', 'Settings > Protection > Backups: switch the nightly backup on and choose where the copy goes.'));
    else if (!ln && !b.lastNightlyDate) {
      // NOT YET IS NOT A FAILURE (Sep 17 2026, rule 31, found by the first run
      // of the new sweep). A unit that has not been through a night CANNOT have
      // a nightly backup, so this was amber on the owner's dashboard on day one
      // of every single facility we ship - and rule 31's battery clause is
      // explicit that a freshly-wizarded unit shows every signal green. It is
      // only worth a warning once the unit HAS been through a night and still
      // has nothing. The unit is dated from the moment it was taken through the
      // wizard. The old acceptance timestamp is a fallback for restored backups;
      // 26 hours covers any configured backup hour with a margin. A unit we
      // cannot date keeps the old warning rather than a silence we did not earn.
      const setAt = Date.parse(cfg.setup?.completedAt || cfg.setup?.eula?.acceptedAt || '');
      const hadANight = isFinite(setAt) ? (Date.now() - setAt) > 26 * 3600000 : true;
      if (hadANight) out.push(sig('backups', 'Nightly backup', 'amber', 'no nightly backup has run yet', 'Settings > Protection > Backups: check the nightly hour and where the copy goes, then press Back up now. If tonight\'s does not run either, consult the troubleshooting guide.'));
      else out.push(sig('backups', 'Nightly backup', 'green', 'the first nightly backup runs tonight at the configured hour', ''));
    }
    else if (ln && ln.ok === false) out.push(sig('backups', 'Nightly backup', 'red', `last night's backup FAILED: ${(ln.copies || []).filter(c => c.ok === false && !c.paused).map(c => c.kind + ': ' + (c.error || 'failed')).join('; ') || 'no file written'}`, 'Settings > Protection > Backups: plug the backup drive back in (or check the card), then press Back up now to be sure.'));
    else if (daysOld != null && daysOld >= 2) out.push(sig('backups', 'Nightly backup', 'red', `the last nightly backup is ${daysOld} days old (${ln ? ln.date : b.lastNightlyDate})`, 'The unit may have been off overnight. Settings > Protection > Backups > Back up now; if tonight\'s does not run either, consult the troubleshooting guide.'));
    else out.push(sig('backups', 'Nightly backup', 'green', `last night ${ln ? ln.date : b.lastNightlyDate}${ln && ln.copies && ln.copies.some(c => c.ok === true) ? ', copied to ' + ln.copies.filter(c => c.ok === true).map(c => c.kind).join(' + ') : ''}`, ''));
  } catch (e) { out.push(sig('backups', 'Nightly backup', 'amber', 'could not check: ' + e.message, '')); }
  // COPIES THAT LEFT UNENCRYPTED, OR COULD NOT LEAVE (maintainer, Sep 23 2026: "amber
  // signal when anything leaves unencrypted"). Two things, both amber:
  //  - a plain copy actually left in the last 7 days (the download, the year
  //    archive, the waiver archive taken plain) - the owner acknowledges it once
  //    they have dealt with the file, which draws a line (nothing is deleted);
  //  - a USB or SD copy, or the off-site link, the owner turned on is PAUSED
  //    because no passphrase is set (a unit updated from before the rule) - a
  //    live condition that clears the moment a passphrase is set.
  // RULE 31: a fresh unit has done neither and is green.
  try {
    const vaultSet = require('./backupvault').vaultState().set;
    const b = cfg.backup || {};
    const dest = b.enabled === false ? 'off' : (b.destination || 'off');
    const paused = vaultSet ? [] : [].concat(dest === 'sd' || dest === 'both' ? ['the SD card copy'] : [], dest === 'usb' || dest === 'both' ? ['the USB copy'] : [], b.pullToken ? ['the off-site link'] : []);
    const D = require('./db').db;
    let line = 0;
    try { const a = D.prepare(`SELECT MAX(id) AS id FROM admin_log WHERE event='BACKUP_LEFT_PLAIN_ACK'`).get(); line = (a && a.id) || 0; } catch (e) {}
    const since = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const left = D.prepare(`SELECT detail, created_at FROM admin_log WHERE event='BACKUP_LEFT_PLAIN' AND created_at > ? AND id > ? ORDER BY id DESC LIMIT 10`).all(since, line);
    if (paused.length) out.push(sig('plaincopy', 'Copies leaving the unit', 'amber',
      `${paused.join(' and ')} ${paused.length === 1 ? 'is' : 'are'} switched on but PAUSED - no backup passphrase is set, and nothing leaves this unit unencrypted`,
      'Settings > Protection > Backups, step 1: set a backup passphrase and the copies start again tonight. Write it down where you keep your recovery codes.'));
    else if (left.length) out.push(Object.assign(sig('plaincopy', 'Copies leaving the unit', 'amber',
      `${left.length} unencrypted cop${left.length === 1 ? 'y' : 'ies'} left this unit in the last 7 days: ${left.map(l => `${l.detail} (${l.created_at} UTC)`).join('; ').slice(0, 400)}`,
      'Anyone holding those files can read your customers\' details and your keys. Keep them somewhere only you can reach, or delete them once you have an encrypted copy (set a passphrase in Settings > Protection > Backups and download again). Then press Acknowledge on the About panel.'), { ack: '/api/admin/health/ack/plaincopy' }));
    else out.push(sig('plaincopy', 'Copies leaving the unit', 'green', vaultSet ? 'every copy that leaves this unit is encrypted' : 'nothing has left this unit unencrypted', ''));
  } catch (e) { out.push(sig('plaincopy', 'Copies leaving the unit', 'amber', 'could not check: ' + (e && e.message), '')); }
  // messages (a provider that is not configured is "no texting", not a failure)
  try {
    const D = require('./db').db;
    const rows = D.prepare(`SELECT event, detail FROM admin_log WHERE event IN ('SMS_FAILED','EMAIL_FAILED','EMAIL_ERROR','GIFTCARD_NOT_EMAILED') AND created_at >= datetime('now','-24 hours') ORDER BY id DESC LIMIT 200`).all()
      // "not configured" is no texting, not a failure - but only when EVERY provider named says so
      // (a carrier rejection with a "fallback not configured" tail is a real failure)
      .filter(r => !String(r.detail || '').split('|').every(part => /not configured/i.test(part)));
    // AN EMAIL KEY WITH NO FROM ADDRESS SENDS NOTHING (Oct 3 2026; the Sep 13 audit's MEDIUM, half fixed): every
    // email was dropped with a log line and nothing red, while the checklist said email was connected. Read from the
    // configuration itself - not only the log - so it is red from the moment it is saved, not after the first email.
    const cfgNow = require('./config').getConfig();
    const rkey = String((cfgNow.resend && cfgNow.resend.apiKey) || '');
    const noFrom = rkey.startsWith('re_') && !String((cfgNow.resend && cfgNow.resend.fromEmail) || '').trim();
    if (noFrom) out.push(sig('messages', 'Texts and emails', 'red', 'an email key is saved but there is no From address - no email can be sent: no confirmations, receipts, door codes by email or reminders', 'Settings > Connections, the Resend - Email Notifications card: add the From Email (an address on the domain you verified in Resend), then Save.'));
    else if (rows.length) out.push(sig('messages', 'Texts and emails', 'amber', `${rows.length} message(s) failed to send in the last 24 h (${rows[0].event}: ${(rows[0].detail || '').slice(0, 90)})`, 'Settings > Connections: check the Twilio / email credentials and the account balance; the unit retries reminders and door codes on its own, confirmations are not re-sent.'));
    else out.push(sig('messages', 'Texts and emails', 'green', 'nothing failed to send in the last 24 h', ''));
  } catch (e) { out.push(sig('messages', 'Texts and emails', 'amber', 'could not read the log: ' + e.message, '')); }
  // door credentials that outlived their session (rule 23; A-wave 11, maintainer's ruling:
  // "a revoke that fails must be retried by something until it succeeds or an owner
  // is told, because the failure mode is a customer keeping a working door code")
  try {
    const live = require('./db').db.prepare(
      `SELECT id, date, end_date, end_time, status, remotelock_person_id FROM bookings WHERE remotelock_person_id IS NOT NULL AND remotelock_person_id <> ''`).all();
    // A CANCELLED BOOKING'S CODE THE LOCK REFUSED TO TAKE BACK IS RED NOW (Sep 25
    // 2026). The two-hour grace below is for a session that simply ended; a cancel is
    // different - the customer who cancelled may be standing at the door. Read from
    // the job ledger (a revoke tried and refused), so a code already taken back never
    // reads red.
    let refusedIds = new Set();
    try { refusedIds = new Set(require('./db').db.prepare(`SELECT booking_id FROM automation_jobs WHERE kind='door_revoke' AND (status='failed' OR (status='pending' AND attempts > 0))`).all().map(r => r.booking_id)); } catch {}
    const refused = live.filter(b => ['cancelled', 'expired'].includes(b.status) && refusedIds.has(b.id));
    // A CODE THAT HAS NOT BEEN ISSUED IS RED WHILE IT MATTERS (Sep 25 2026, maintainer's item
    // 10). The door-code job is due 15 minutes before the session and retries for about
    // 38 minutes before the Automation line even goes amber - so a console or lock that
    // did not answer left this line green while the customer stood outside. Any session
    // not yet over whose door-code job has failed at least once is counted here, and the
    // words say which half failed: the lock (no code exists) or the message (the code
    // exists and did not reach the customer).
    let unissued = [];
    try {
      unissued = require('./db').db.prepare(
        `SELECT b.id, b.date, b.end_date, b.end_time, b.door_code, j.last_error, j.status AS jstatus FROM automation_jobs j JOIN bookings b ON b.id = j.booking_id
          WHERE j.kind IN ('door_code','door_text') AND b.status = 'active'
            AND (j.status IN ('failed','missed') OR (j.status='pending' AND j.attempts > 0))
          ORDER BY j.kind`).all()
        .filter(b => { const e = require('./doorlock').bookingEndDate(b); return !e || e.getTime() > Date.now(); })
        // the TEXT job too (Oct 3 2026, the pack review): on the create-confirm-text flow (every provider's default) the
        // code is made by door_code and sent by door_text, so a text that never reached the customer left this line green;
        // one row per booking, the create's failure first (no code at all is the worse half)
        .filter((b, i, all) => all.findIndex(x => x.id === b.id) === i);
    } catch {}
    // THE CONSOLE'S CERTIFICATE IS BEING REFUSED (Sep 25 2026, the Monday review's critic).
    // Pinning closes the connection to a console presenting a certificate this unit does not
    // trust, so NO code can be made or taken back through it - and without this the first red
    // came from a door-code job failing 15 minutes before a session. Read from the owner's log:
    // the newest refusal newer than the newest trust or recovery line.
    // MEMBERS (Sep 25 2026, services/memberaccess): a change the door console has not taken,
    // and a member booking that had to fall back to a one-off code (maintainer's ruling 2).
    let memberWaiting = [], memberOneOff = [];
    try {
      const D3 = require('./db').db;
      memberWaiting = D3.prepare(`SELECT id, name, status, unifi_status, unifi_granted, unifi_error FROM members WHERE unifi_dirty=1 AND unifi_attempts > 0`).all();
      // only a MEMBER's one-off code (its line names the member) - a Home Assistant lock that refused a code writes the same
      // event for the backup code it texted, and read here it told a facility with no UniFi and no members to check UniFi (Oct 3 2026)
      memberOneOff = D3.prepare(`SELECT detail FROM admin_log WHERE event='DOOR_CODE_FALLBACK' AND detail LIKE 'Booking: % | member %' AND created_at >= datetime('now','-24 hours') ORDER BY id DESC`).all();
    } catch {}
    // a lapsed or cancelled member the console still has active, or still holding doors
    const lapsedStillOn = memberWaiting.filter(m => m.status !== 'active' && (m.unifi_status === 'ACTIVE' || (m.unifi_granted && m.unifi_granted !== '[]')));
    let certRefused = null;
    try {
      if ((getConfig().doorAccess || {}).provider === 'unifi') {
        const D2 = require('./db').db;
        const last = ev => D2.prepare(`SELECT id, detail FROM admin_log WHERE event=? AND created_at >= datetime('now','-7 days') ORDER BY id DESC LIMIT 1`).get(ev);
        const bad = last('UNIFI_CERT_MISMATCH');
        const good = Math.max((last('UNIFI_CERT_TRUSTED') || {}).id || 0, (last('UNIFI_CERT_OK') || {}).id || 0);
        if (bad && bad.id > good) certRefused = bad;
      }
    } catch {}
    // THE THRESHOLD FOLLOWS THE OWNER'S LAG (Sep 16 2026). This was a hardcoded
    // two hours, decided when the revoke was a hardcoded end+20. maintainer has since
    // ruled the owner's doorCodeLagMins governs the revoke - and it goes up to
    // 240 minutes - so on a facility that asked for three hours this line went
    // RED every single day on codes that were working exactly as configured,
    // with an action telling the owner their lock was unreachable. Give the
    // revoke an hour's grace past the owner's own number, with two hours as the
    // floor so a facility that asked for 0 is not alarmed by a few minutes.
    // ONE RESOLVER (Sep 17 2026): the same doorlock.codeWindowMins the window
    // and the sweep read, so this line can never grade against a number the
    // door was never told.
    const lagMs = Math.max(0, require('./doorlock').codeWindowMins().lag) * 60000;
    const lateAfter = Math.max(2 * 3600000, lagMs + 3600000);
    const late = live.filter(b => { const e = require('./doorlock').bookingEndDate(b); return !!e && Date.now() - e.getTime() > lateAfter; });
    // ONE SIGNAL OWNS THESE WORDS (maintainer's ruling, Sep 16 2026). The UniFi wave's
    // designs wanted four separate schemes writing this same line; the second
    // case below is the only genuinely new state, so it lives here rather than
    // becoming a signal of its own. It is a DIFFERENT problem from a revoke that
    // keeps failing: the unit is not retrying, because there is no longer
    // anything to retry against, and only the owner can close it.
    const stranded = live.filter(b => {
      const ref = String(b.remotelock_person_id || '');
      if (ref.startsWith('ha:')) return !require('./doorlock').providerConfigured('ha');
      if (!ref.startsWith('unifi:') && !ref.startsWith('unifiuser:')) return false;
      return !require('./doorlock').providerConfigured('unifi');
    });
    // Codes the LOCK holds that this unit has no record of - the nightly
    // RemoteLock check writes DOOR_CODE_ORPHANS when it finds any. Only the owner
    // can clear these, so the line has to survive until they do.
    // The NEWEST completed check is the only one that counts. findOrphanedCodes
    // writes a row on every run now, clean ones included, so this goes green the
    // night after an owner clears them - it used to latch red until admin_log
    // pruned the row twelve months later.
    let orphans = 0;
    try {
      const row = require('./db').db.prepare(
        `SELECT detail FROM admin_log WHERE event='DOOR_CODE_ORPHANS' ORDER BY id DESC LIMIT 1`).get();
      if (row) { const m = /^(\d+) code/.exec(String(row.detail || '')); orphans = m ? Number(m[1]) : 0; }
    } catch {}
    // ORDER MATTERS: a code that is still live on a session that ENDED is rule 28's
    // alarm and a customer can walk in on it right now. Orphans are codes nobody
    // is tracking, which is worse bookkeeping but not a door standing open this
    // minute. The urgent one is never hidden behind the untidy one.
    // THE DOOR LOCK THROUGH HOME ASSISTANT HAS NOT ANSWERED (Sep 26 2026): red from the second
    // missed minute - no code can be set or taken off while it lasts (the owner is texted at five)
    const haEvents = (() => { try { if (String((cfg.doorAccess || {}).provider || '').toLowerCase() !== 'ha') return null; return require('./hadoor').eventsState(); } catch (e) { return null; } })();
    const haDown = (() => { try { if (String((cfg.doorAccess || {}).provider || '').toLowerCase() !== 'ha') return null; const r = require('./hadoor').reachState(); return r.failSince && Date.now() - r.failSince >= 60000 ? r : null; } catch { return null; } })();
    if (haDown) out.push(sig('doorcodes', 'Door codes', 'red', `the door lock has not answered for ${Math.max(1, Math.round((Date.now() - haDown.failSince) / 60000))} minute(s) - ${haDown.lastWhy}. No door code can be set or taken off until it does`, 'Check the Home Assistant box is on and on the network, and the lock has batteries. When it answers again the unit puts the lock back to its record by itself (the Log tab shows each step).'));
    else if (stranded.length) out.push(sig('doorcodes', 'Door codes', 'red', `${stranded.length} door code(s) were issued through UniFi Access, which is no longer set up on this unit - they cannot be revoked from here and may still open the door`, 'Either put the console back in Settings > Devices > Door Access Provider so the unit can take these codes back, or remove them at the console yourself (Access > Visitors) and then cancel those bookings here. Until one of those happens the people who booked them can still get in.'));
    else if (refused.length) out.push(sig('doorcodes', 'Door codes', 'red', `${refused.length} door code(s) for CANCELLED bookings are still live - the lock refused to take them back`, 'The unit keeps trying every minute at first and never gives up. Until it succeeds, whoever cancelled can still open the door: check the lock\'s internet and Settings > Devices (the door\'s card), and remove the code at the lock itself if this stays red.'));
    else if (certRefused) out.push(sig('doorcodes', 'Door codes', 'red', 'The UniFi console presented a certificate this unit does not trust, so no door code can be made or removed through it (' + String(certRefused.detail || '').slice(0, 90) + ')',
      'If the console was replaced, reset or updated: Settings > Devices > Door Access > Test Connection shows the new certificate and asks before trusting it. If nothing changed, something else may be answering at the console\'s address - check it before you accept.'));
    else if (unissued.length) {
      const noCode = unissued.filter(b => !b.door_code).length;
      const gaveUp = unissued.filter(b => b.jstatus === 'failed' || b.jstatus === 'missed').length;
      out.push(sig('doorcodes', 'Door codes', 'red', `${unissued.length} upcoming session(s) do not have a working door code yet - ` + (noCode ? `the lock did not answer${noCode < unissued.length ? `, and ${unissued.length - noCode} code(s) were made but not delivered` : ''}` : 'the code was made but the text or email did not reach the customer') + ` (${String(unissued[0].last_error || '').slice(0, 90)})`,
        (gaveUp ? `The unit has STOPPED retrying ${gaveUp === unissued.length ? 'them' : gaveUp + ' of them'}: once the door system answers (Settings > Devices > Door Access > Test Connection), press Retry on each in Settings > Protection > Automation Health.` : 'The unit keeps trying on its own. Check that the door system is powered and on the network (Settings > Devices > Door Access > Test Connection).')
        + ' If a customer arrives before this clears, let them in or give them a code from the lock\'s own app.'));
    }
    else if (late.length) out.push(sig('doorcodes', 'Door codes', 'red', `${late.length} door code(s) are still live more than ${Math.round(lateAfter / 3600000)} hour(s) after the session ended`, 'The unit keeps trying to revoke them - every minute at first, then every ten minutes, and it never gives up. If this stays red the lock is unreachable: check the lock\'s internet and Settings > Devices (the door\'s card), and remove the code at the lock itself in the meantime - until it is revoked that customer can still open the door.'));
    // WE SAY WHAT WE CAN PROVE (Sep 17 2026). A RemoteLock guest carries no unit
    // marker and no booking id - only the name we set, "Golf - ..." - so this
    // check finds guests that LOOK like ours. Telling the owner they "were
    // created by this system" and to delete them is an instruction we have not
    // earned: their own "Golf - Tuesday league" guest matches the same pattern.
    // Ask them to check the name against a session they recognise first. Putting
    // a real marker in the name at creation is the fix that makes this provable,
    // and it changes what the primary provider sends to a live lock, so it waits
    // for a console (OPEN-AND-PARKED section 1).
    else if (lapsedStillOn.length) out.push(sig('doorcodes', 'Door codes', 'red', `${lapsedStillOn.length} member(s) whose membership ended are still active on the door console - it has not taken the change (${String(lapsedStillOn[0].unifi_error || '').slice(0, 90)})`,
      'The unit keeps trying on its own. Check the console is on the network (Settings > Devices > Door Access > Test Connection). Until it takes the change, deactivate the member yourself in UniFi Access > Users.'));
    else if (orphans) out.push(sig('doorcodes', 'Door codes', 'red', `${orphans} code(s) at the lock that look like ours and that this system has no record of`, 'Open your lock\'s own app and look at the guests whose name begins "Golf - " with a date in the past. Any that match a session you recognise were made by this system, its record of them was lost, and it cannot take them back - delete those, and whoever booked them can no longer get in. Leave anything you created yourself alone. This clears on its own the night after.'));
    else if (memberWaiting.length) out.push(sig('doorcodes', 'Door codes', 'amber', `${memberWaiting.length} member(s)' door access is waiting for the console (${String(memberWaiting[0].unifi_error || '').slice(0, 90)})`,
      'The unit keeps trying on its own - every few minutes, then every half hour. Check the console is powered and on the network (Settings > Devices > Door Access > Test Connection).'));
    else if (memberOneOff.length) out.push(sig('doorcodes', 'Door codes', 'amber', `${memberOneOff.length} member booking(s) in the last day got a one-time code because their member access could not be turned on (${String(memberOneOff[0].detail || '').replace(/^Booking: \S+ \| /, '').slice(0, 110)})`,
      'The member was told it is a one-time code. Press Test Connection in Settings > Devices > Door Access, and check the member in UniFi Access > Users. This clears a day after the last one.'));
    // the keypad reports refused (Oct 2026): every code is still set and cleared, so it is amber, after every red
    else if (haEvents && haEvents.refused) out.push(sig('doorcodes', 'Door codes', 'amber', 'the lock\'s keypad reports do not reach this unit - it cannot tell who opened the door or when', haEvents.problem || ''));
    else if (live.length) out.push(sig('doorcodes', 'Door codes', 'green', `${live.length} code(s) live for sessions running now or just finished`, ''));
    else out.push(sig('doorcodes', 'Door codes', 'green', 'no door code outstanding', ''));
  } catch (e) { if (!(e && e.handled)) out.push(sig('doorcodes', 'Door codes', 'amber', 'could not check the door codes: ' + (e && e.message), '')); }
  // the card reader's payments (rule 23; A-wave 10 - the wave that built the
  // reconcile added a money failure mode and no signal read it)
  try {
    const t = require('./terminal').terminalHealth();
    if (!t.configured) out.push(sig('reader', 'Card reader', 'green', t.detail || 'no card reader on this unit', ''));
    else if (t.unapplied) out.push(sig('reader', 'Card reader', 'red', `${t.unapplied} card payment(s) in the last week were taken and NOT credited to their tab`, 'Settings > Protection > the owner\'s log, search TERMINAL_PAYMENT_UNAPPLIED: each line names the amount and the tab. Refund it in Stripe or credit the tab by hand.'));
    else if (t.stuck) out.push(sig('reader', 'Card reader', 'red', `${t.stuck} reader payment(s) have sat unfinished for over 45 minutes${t.abandoned ? ` (${t.abandoned} of them for more than a week - the unit has stopped checking those with Stripe)` : ''}`, 'The unit cannot reach Stripe or the reader is offline: check the reader\'s screen and the internet. Nothing is charged twice - the unit keeps checking each payment until Stripe answers.'));
    else if (t.errors) out.push(sig('reader', 'Card reader', 'amber', `${t.errors} error(s) asking Stripe about a reader payment in the last two hours`, 'Usually the internet. If it keeps up, check Settings > Connections and the reader.'));
    else out.push(sig('reader', 'Card reader', 'green', 'every reader payment settled or still within its tap window', ''));
  } catch (e) { out.push(sig('reader', 'Card reader', 'amber', 'could not check the reader\'s payments: ' + e.message, '')); }
  // A-wave 12: the dry-run flags are a BENCH tool. On a unit with real credentials
  // they mean nothing ever leaves the building, silently - no text, no email, no
  // confirmation, no door code - and every send is recorded as a success. If both
  // are true at once the unit can tell, so it says so.
  try {
    const c = getConfig();
    const tw = c.twilio || {};
    const magicSender = /^\+1500555\d{4}$/.test(String(tw.phoneNumber || ''));   // Twilio's documented test senders
    const realSms = /^AC[a-f0-9]{32}$/i.test(String(tw.accountSid || '')) && String(tw.authToken || '') !== 'bench-dryrun' && !magicSender;
    const realMail = String((c.resend || {}).apiKey || '').startsWith('re_');
    const dry = [];
    if (process.env.SMS_DRYRUN === '1' && realSms) dry.push('texts');
    if (process.env.EMAIL_DRYRUN === '1' && realMail) dry.push('emails');
    if (dry.length) out.push(sig('dryrun', 'Messages held back', 'red', `this unit has real ${dry.join(' and ')} credentials but is in DRY RUN - nothing is actually being sent`, 'This is a workshop setting that should never be on a facility\'s unit. consult the troubleshooting guide: it is one line in the unit\'s own start-up file and needs a restart.'));
    else out.push(sig('dryrun', 'Messages held back', 'green', 'nothing is being held back', ''));
  } catch (e) { out.push(sig('dryrun', 'Messages held back', 'amber', 'could not check: ' + (e && e.message), '')); }
  // TAKING MONEY (maintainer, Sep 17 2026, a live customer). There was no Stripe signal
  // on this line at all - a unit whose key Stripe was refusing looked healthy
  // while every checkout failed. It reads the ONE truth, so it can never
  // disagree with the badge or the Getting Started checklist.
  try {
    const st = require('./stripestatus').stripeStatus(getConfig());
    if (st.ready) out.push(sig('stripe', 'Taking payments', 'green', st.label, ''));
    // RULE 31: ABSENT IS NOT FAILED. A facility with no Stripe keys is not
    // broken - plenty take cash at the counter, and a members-only club may bill
    // elsewhere. My first cut made this AMBER, which put every such unit on a
    // permanent warning and would have failed the loop's own health gate on a
    // freshly-wizarded unit. Same shape as the card reader signal above, which
    // reads green for "no card reader on this unit". Whether an owner MEANT to
    // set Stripe up is the Getting Started checklist's question, not this line's:
    // this one answers "is this unit broken".
    else if (st.level === 'none') out.push(sig('stripe', 'Taking payments', 'green', 'no card payments on this unit', ''));
    // Half-set-up or actively refused IS broken: money is expected and cannot be taken.
    else out.push(sig('stripe', 'Taking payments', 'red', st.label, st.detail));
  } catch (e) { out.push(sig('stripe', 'Taking payments', 'amber', 'could not check the Stripe setup: ' + (e && e.message), '')); }
  // THE PAYMENT LIBRARY REACHED THE CUSTOMER'S BROWSER (maintainer, Sep 19 2026, a
  // live customer who could not book at all). Stripe Elements needs
  // js.stripe.com fetched by the CUSTOMER's browser - the unit being healthy
  // says nothing about that. A content blocker, a filtered DNS or a dead
  // network leaves the booking page with no Stripe at all, and the page used
  // to run straight into `Stripe(...)` and throw "Can't find variable: Stripe"
  // in a red box at Confirm & Pay. The page now reports the failure here, so
  // the owner learns their booking page is not taking money from somebody.
  // RULE 31: a unit that takes no card payments cannot have this problem.
  try {
    const stp = require('./stripestatus').stripeStatus(getConfig());
    if (stp.level === 'none') out.push(sig('paylib', 'Payment library', 'green', 'no card payments on this unit', ''));
    else {
      const since = new Date(Date.now() - 24 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
      // A drill the owner has acknowledged draws a line under everything before
      // it, so a proof run does not hold this red for a day (nothing deleted).
      // The line is the acknowledgement's ROW, not its second (Sep 23 2026): a
      // report in the same second as the acknowledgement used to be recorded and
      // never counted. The reporter's hourly dedupe in routes/bookings.js reads
      // the same line.
      let line = 0;
      try {
        const cl = require('./db').db.prepare(
          `SELECT MAX(id) AS id FROM admin_log WHERE event='PAYMENT_LIB_DRILL_CLEARED'`).get();
        line = (cl && cl.id) || 0;
      } catch (e) {}
      const row = require('./db').db.prepare(
        `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM admin_log
          WHERE event='PAYMENT_LIB_UNREACHABLE' AND created_at > ? AND id > ?`).get(since, line);
      const n = (row && row.n) || 0;
      if (n > 0) out.push(sig('paylib', 'Payment library', 'red',
        `${n} customer(s) in the last 24 h opened your booking page and their browser could not load Stripe's payment library (last ${row.last} UTC) - they could not pay`,
        'Those customers were told plainly and nothing was charged. It is almost always a content or ad blocker on their phone, or a network that filters js.stripe.com; ask one of them to try another browser or turn the blocker off. If it is EVERY customer, your unit is fine but something on your internet is blocking js.stripe.com - check with whoever runs it. This clears itself 24 h after the last report.'));
      else out.push(sig('paylib', 'Payment library', 'green', 'every booking page that asked for it loaded the payment library', ''));
    }
  } catch (e) { out.push(sig('paylib', 'Payment library', 'amber', 'could not check: ' + (e && e.message), '')); }
  // SOMEBODY IS STILL OWED MONEY (maintainer, Sep 20 2026 - rewritten).
  // The first cut counted LOG EVENTS over fourteen days, and one of the four it
  // counted - REFUND NEEDED (manual) - has been written by shipped code for
  // months. So every unit went red the moment it applied the pack, for something
  // that had already happened and may already have been handled, with no way for
  // the owner to clear it. A red an owner cannot clear and did not cause is how
  // you teach someone to stop reading the health line.
  // So it reads the LIVE condition instead, the way the door signal does: a
  // booking that ended without a session, whose card was actually charged, and
  // whose money has not gone back. That is true exactly while someone is out of
  // pocket and false the moment they are made whole - and it can NAME them, so
  // the action is "refund these two people", not "go and read your log".
  try {
    const stp2 = require('./stripestatus').stripeStatus(getConfig());
    if (stp2.level === 'none') out.push(sig('checkout', 'Online checkout', 'green', 'no card payments on this unit', ''));
    else {
      const D = require('./db').db;
      // An owner who refunded by hand in Stripe draws a line under what is
      // outstanding; nothing is deleted, the acknowledgement is its own log row.
      let ackAt = '';
      try {
        const a = D.prepare(`SELECT MAX(created_at) AS at FROM admin_log WHERE event='CHECKOUT_OWED_ACK'`).get();
        ackAt = (a && a.at) || '';
      } catch (e) {}
      const owed = D.prepare(
        `SELECT id, name, date, start_time, price_cents, updated_at FROM bookings
          WHERE status IN ('expired','cancelled')
            AND (COALESCE(stripe_charge_id,'') <> ''
                 -- a customer's online cancel whose refund Stripe refused, even when the
                 -- charge could not be read first (Sep 25 2026)
                 OR bookings.id IN (SELECT substr(detail, 10, instr(detail, ' |') - 10) FROM admin_log WHERE event='CUSTOMER_REFUND_FAILED' AND detail LIKE 'Booking: % |%'))
            AND COALESCE(refunded_at,'') = ''
            AND price_cents > 0
            -- a cancel where the owner or staff CHOSE "No refund" kept the money on purpose (the facility's policy -
            -- rule 38 counts it as revenue): never "owed" (Oct 3 2026, the pack review - the line went red and told
            -- the owner to refund money their policy kept). Both cancel paths write the choice to the owner's log.
            AND bookings.id NOT IN (SELECT substr(detail, 5, instr(detail, ' |') - 5) FROM admin_log WHERE event='ADMIN_CANCEL' AND detail LIKE 'ID: % | Refund: No refund%')
            AND bookings.id NOT IN (SELECT substr(detail, 1, instr(detail, ' |') - 1) FROM admin_log WHERE event='BOOKING_CANCELLED' AND detail LIKE '% | No refund%')
            AND (? = '' OR updated_at > ?)
          ORDER BY updated_at DESC LIMIT 25`).all(ackAt, ackAt);

      // The three failures that have no live state of their own stay history -
      // but only from this unit's FIRST BOOT on the code that writes them, so a
      // unit cannot arrive red for a fortnight of its own past.
      let since = ackAt;
      try {
        const b = D.prepare(`SELECT MIN(created_at) AS at FROM admin_log WHERE event='CHECKOUT_SIGNAL_ARMED'`).get();
        if (b && b.at && b.at > since) since = b.at;
      } catch (e) {}
      let failures = 0;
      if (since) {
        try {
          const f = D.prepare(
            `SELECT COUNT(*) AS n FROM admin_log
              WHERE event IN ('ADMIN_EXPIRE_DEFERRED','LEDGER_FAILED','NOTIFY_FAILED')
                AND created_at > ?`).get(since);
          failures = (f && f.n) || 0;
        } catch (e) {}
      }

      if (owed.length) {
        const money = c => '$' + ((c || 0) / 100).toFixed(2);
        const who = owed.slice(0, 4).map(b => `${b.name || 'a customer'} (${b.date} ${b.start_time}, ${money(b.price_cents)})`).join('; ');
        const more = owed.length > 4 ? ` and ${owed.length - 4} more` : '';
        out.push(Object.assign(sig('checkout', 'Online checkout', 'red',
          `${owed.length} customer(s) paid for a session that did not happen and have not been refunded: ${who}${more}`,
          'Refund them in Stripe (Payments > find the charge > Refund), or cancel-with-refund from the booking if it is still on the list. The unit tried and could not, so it needs a person. Once the money is back this clears itself; if you have already refunded them by hand, press Acknowledge on the About panel to draw a line under it.'),
          { ack: '/api/bookings/checkout-owed-ack' }));
      } else if (failures > 0) {
        out.push(sig('checkout', 'Online checkout', 'amber',
          `${failures} checkout(s) could not be settled cleanly since this unit was updated - nobody is out of pocket, but something was left half-done`,
          'Open the Log tab and read the lines marked ADMIN_EXPIRE_DEFERRED, LEDGER_FAILED or NOTIFY_FAILED. Check the booking is in the state you expect before selling that slot again.'));
      } else {
        out.push(sig('checkout', 'Online checkout', 'green', 'nobody is waiting on a refund', ''));
      }
    }
  } catch (e) { out.push(sig('checkout', 'Online checkout', 'amber', 'could not check: ' + (e && e.message), '')); }
  // A PAID MEMBERSHIP WITH NOBODY BEHIND IT (maintainer, Sep 20 2026). Reads the last
  // orphan reconcile (boot, nightly, or the owner's Check now) - never Stripe
  // directly from a per-minute check. Rule 31: a unit that sells no memberships
  // online has nothing to be wrong here.
  try {
    const stp3 = require('./stripestatus').stripeStatus(getConfig());
    const sells = require('./db').db.prepare(`SELECT COUNT(*) AS n FROM membership_tiers WHERE sell_online=1 AND active=1`).get();
    if (stp3.level === 'none') out.push(sig('membership', 'Online memberships', 'green', 'no card payments on this unit', ''));
    else if (!sells || !sells.n) out.push(sig('membership', 'Online memberships', 'green', 'no memberships sold online on this unit', ''));
    else {
      const last = require('./membership-lifecycle').lastOrphanReconcile();
      // No reconcile yet this boot is NOT a problem (rule 31): the boot check
      // runs async and a health read must not go amber in the gap. It goes red
      // only when a check actually finds someone paid with no member.
      if (!last) out.push(sig('membership', 'Online memberships', 'green', 'no signup check needed yet since this start', ''));
      else if (last.skipped) out.push(sig('membership', 'Online memberships', 'green', 'no card payments on this unit', ''));
      else if (last.error) out.push(sig('membership', 'Online memberships', 'amber', 'could not check with Stripe: ' + last.error, 'Check the unit\'s internet and Settings > Connections (the Stripe keys). This is "could not ask", not "somebody is missing".'));
      else if (last.failed.length) out.push(sig('membership', 'Online memberships', 'red',
        `${last.failed.length} person(s) PAID for a membership and have no member record: ` + last.failed.map(f => `${f.name || f.email || f.sessionId} (${f.error})`).join('; ').slice(0, 300),
        'They are being billed and cannot book. Open Admin > Members > Add, create them on the right tier, and paste the subscription id (sub_...) from Stripe > Subscriptions into the billing link so renewals track. Then press Check now to confirm this clears.'));
      else if (last.pending) out.push(sig('membership', 'Online memberships', 'amber', `${last.pending} signup(s) still settling in Stripe - the unit will finish them on the next pass`, ''));
      else out.push(sig('membership', 'Online memberships', 'green', `every paid signup has a member (last checked ${ago(Date.now() - Date.parse(last.at))}${last.recovered ? ', ' + last.recovered + ' recovered' : ''})`, ''));
    }
  } catch (e) { out.push(sig('membership', 'Online memberships', 'amber', 'could not check: ' + (e && e.message), '')); }
  // the database writer
  try {
    const st = require('./db').staleRefusals ? require('./db').staleRefusals() : { count: 0 };
    if (st.count > 0) out.push(sig('writer', 'Database', 'red', `${st.count} write(s) refused because another process changed bookings.db on disk (last ${st.last ? ago(Date.now() - st.last) : '?'})`, 'Something else is writing the database - a script left running, or a second copy of the product. Restart the unit; if it comes back, consult the troubleshooting guide.'));
    else {
      const dbm = require('./db');
      // Oct 19 2026: saves that keep failing (a full card, an I/O error) mean bookings acknowledged since then exist only in
      // memory - red after two minutes (rule 23; a single failed save retries on the next tick and says nothing)
      const sh = dbm.saveHealth ? dbm.saveHealth() : { failingSince: 0 };
      const redAfter = Number(process.env.BA_TEST_SAVE_RED_MS) || 2 * 60000;
      // Oct 18-19 2026: the database engine failed in memory (or its stack was wearing down) and the unit restarted
      // itself - amber for a week, never red (it is working again), so the owner knows to check the minutes before it
      const ef = dbm.engineFailure ? dbm.engineFailure() : null;
      const at = ef && Date.parse(ef.at);
      if (sh.failingSince && Date.now() - sh.failingSince > redAfter) out.push(sig('writer', 'Database', 'red', `the unit has not been able to save to its card for ${ago(Date.now() - sh.failingSince)} (${String(sh.lastError || '').slice(0, 80)}) - bookings and sales since then exist only in memory`, 'Unplug the unit and plug it back in. If this comes back, the card may be full or failing - consult the troubleshooting guide.'));
      else if (at && Date.now() - at < 7 * 86400000) out.push(ef.kind === 'stack'
        ? sig('writer', 'Database', 'amber', `the database engine was wearing down; the unit saved and restarted itself ${ago(Date.now() - at)} before it could fail - nothing was lost`, 'Nothing to do - it is working. If this happens again, consult the troubleshooting guide.')
        : sig('writer', 'Database', 'amber', `the database stopped working in memory ${ago(Date.now() - at)} and the unit restarted itself (${String(ef.why || '').slice(0, 80)})`, 'It is working again. Check the bookings and sales made just before that time; if this happens again, consult the troubleshooting guide.'));
      else out.push(sig('writer', 'Database', 'green', 'one writer, no refusals', ''));
    }
  } catch (e) { out.push(sig('writer', 'Database', 'amber', 'could not check: ' + e.message, '')); }
  try { out.push(runtimeSignal()); } catch (e) { out.push(sig('runtime', 'Software engine', 'amber', 'could not check: ' + e.message, '')); }
  // BAY ROUTINES (Oct 21 2026, night - rule 23): a routine that stopped - a player may be at a screen it was
  // meant to get past - said here as well as on its card and the staff pad. Listed only on a unit with routines (rule 31);
  // amber while a routine's last run in the last day stopped, green again once it works.
  try {
    const RT = require('./routines'), all = RT.list().filter(r => r.enabled);
    if (all.length) {
      const bays = (cfg.bays || []), bayName = (id) => ((bays.find(b => b && b.id === id) || {}).name || id);
      const day = Date.now() - 86400000, when = (t) => Date.parse(String(t || '').replace(' ', 'T') + 'Z');
      const stopped = all.filter(r => r.last_ok === false && when(r.last_run_at) > day);
      if (stopped.length) out.push(sig('routines', 'Bay routines', 'amber', stopped.slice(0, 3).map(r => `"${r.name}" on ${bayName(r.bay_id)} stopped ${ago(Date.now() - when(r.last_run_at))}: ${r.last_detail}`).join('; ') + (stopped.length > 3 ? `; and ${stopped.length - 3} more` : ''),
        'Bays & Devices > Bay Routines says which step and why; run it again from there or the staff pad once it is put right (teach it again if the program changed).'));
      else out.push(sig('routines', 'Bay routines', 'green', `${all.length} routine${all.length === 1 ? '' : 's'}, none stopped in the last day`, ''));
    }
  } catch (e) { out.push(sig('routines', 'Bay routines', 'amber', 'could not check: ' + e.message, '')); }
  const worst = out.some(s => s.level === 'red') ? 'red' : out.some(s => s.level === 'amber') ? 'amber' : 'green';
  const checkedAt = new Date().toISOString();
  const summary = worst === 'green' ? `Everything is fine - last checked ${checkedAt}` : `${out.filter(s => s.level !== 'green').map(s => `${s.label}: ${s.detail}`).join(' | ')} - checked ${checkedAt}`;
  return { checkedAt, ok: worst === 'green', level: worst, signals: out, summary };
}

// the scheduler calls this every tick; the route serves what it stored
function refresh() { try { _stored = compute(); } catch (e) { _stored = { checkedAt: new Date().toISOString(), ok: false, level: 'red', signals: [sig('checker', 'Health check', 'red', 'the check itself threw: ' + e.message, 'consult the troubleshooting guide.')], summary: 'The health check itself failed - checked ' + new Date().toISOString() }; } return _stored; }

// what the route, the About line, the banner, the email and the text read
function current({ fresh = false } = {}) {
  if (fresh) return Object.assign({}, refresh(), { fresh: true });
  if (!_stored) return { checkedAt: null, ok: false, level: 'red', stale: true, signals: [sig('checker', 'Health check', 'red', 'the checker has not run yet since this start', 'Wait two minutes; if this stays, the scheduler is not running - restart the unit.')], summary: 'The health check has not run yet - the checker may be dead' };
  const age = Date.now() - Date.parse(_stored.checkedAt);
  if (age > CHECK_STALE_MS) {
    return Object.assign({}, _stored, { ok: false, level: 'red', stale: true, signals: [sig('checker', 'Health check', 'red', `the checker itself has not run since ${_stored.checkedAt} (${ago(age)})`, 'The scheduler that runs it has stopped: restart the unit (unplug it for ten seconds). Silence here is never "fine".')].concat(_stored.signals), summary: `The checker itself has not run since ${_stored.checkedAt} - not fine` });
  }
  return _stored;
}

// one line for the About panel's copy button and the support call
// ── THE RUNTIME (CLAUDE.md rules 17, 35 and 43; Oct 8 2026) ─────────────────────
// Two things on a unit age with the CALENDAR, not with use: the Node the software runs on
// (security fixes end on a published date) and the cloudflared package that carries the
// public website (Cloudflare supports a version for about a year after newer ones come
// out). Both move forward in BA's yearly runtime pack. This says so before either runs out,
// in words an owner can act on - and says it when a newer Node that came in an update could
// not run on this unit, so the software is on the unit's own Node instead.
// End-of-life dates from the Node.js release schedule (nodejs.org, github.com/nodejs/release).
// End of life by Node line. From 27 every line is LTS, one a year, 36 months from first release (nodejs.org,
// "Evolving the Node.js release schedule", read Oct 18 2026: 26 Apr 2029, 27 Apr 2030, 28 Apr 2031 - "not final").
const NODE_EOL = { 22: '2027-04-30', 24: '2028-04-30', 26: '2029-04-30', 27: '2030-04-30', 28: '2031-04-30', 29: '2032-04-30', 30: '2033-04-30' };
const RUNTIME_WARN_DAYS = 120;
const TUNNEL_WARN_MONTHS = 11;
let _tunnel = null, _tunnelAt = 0, _tunnelBusy = false;
// rule 31: no tunnel service on this unit is not a fault - nothing is said about it. Asked in the BACKGROUND
// (the health tick never waits on a child process); the line reads the last answer, refreshed every six hours.
function tunnelInfo() {
  if (!_tunnelBusy && Date.now() - _tunnelAt > 6 * 3600000) {
    _tunnelBusy = true; _tunnelAt = Date.now();
    const { execFile } = require('child_process');
    execFile('systemctl', ['list-unit-files', 'cloudflared.service'], { encoding: 'utf8', timeout: 10000 }, (e1, units) => {
      if (e1 || !/cloudflared\.service/.test(units || '')) { _tunnel = false; _tunnelBusy = false; return; }
      execFile('cloudflared', ['--version'], { encoding: 'utf8', timeout: 10000 }, (e2, v) => {
        const ver = (/(\d{4}\.\d+\.\d+)/.exec(v || '') || [])[1] || null;
        const built = (/built (\d{4}-\d{2}-\d{2})/.exec(v || '') || [])[1] || (ver ? ver.split('.').slice(0, 2).join('-').replace(/-(\d)$/, '-0$1') + '-01' : null);
        _tunnel = !e2 && ver ? { version: ver, built } : false; _tunnelBusy = false;
      });
    });
  }
  return _tunnel || false;
}
function runtimeSignal(now = Date.now()) {
  const major = Number(String(process.version).replace(/^v/, '').split('.')[0]);
  const eolDay = NODE_EOL[major] || null;
  const eol = eolDay ? Date.parse(eolDay + 'T00:00:00Z') : null;
  const notes = [];
  if (eol && eol - now < RUNTIME_WARN_DAYS * 86400000) notes.push(`the software's engine, Node ${process.version}, ${eol <= now ? 'stopped' : 'stops'} getting security fixes on ${eolDay}`);
  const tun = tunnelInfo();
  if (tun && tun.built) {
    const age = now - Date.parse(tun.built + 'T00:00:00Z');
    if (age > TUNNEL_WARN_MONTHS * 30.4 * 86400000) notes.push(`the tunnel software that carries the public website (cloudflared ${tun.version}) is from ${tun.built.slice(0, 7)}; Cloudflare supports a version for about a year after newer ones come out`);
  }
  const what = `Node ${process.version}${tun ? ', tunnel ' + tun.version : ''}`;
  if (!notes.length) return sig('runtime', 'Software engine', 'green', what, '');
  return sig('runtime', 'Software engine', 'amber', notes.join('; '),
    'Review the release and operating guides before changing the app or its runtime. Update Cloudflare Tunnel separately using its vendor instructions.');
}

function line() { const c = current(); return `Health: ${c.ok ? 'OK' : c.level.toUpperCase()} - ${c.summary}`; }

module.exports = { compute, refresh, current, line, noteTick, runtimeSignal, NODE_EOL, CHECK_STALE_MS, SCHED_STALE_MS, _reset: () => { _stored = null; _lastTick = 0; } };
