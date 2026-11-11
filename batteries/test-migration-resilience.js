// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-migration-resilience.js — the CRITICALs the pilot facility rebase surfaced.
// These are the bugs that only appear when the golden product meets a REAL
// pre-existing facility (legacy DB, provisioned config) instead of a fresh
// demo. Each would silently break a customer unit. (maintainer/pilot facility, Aug 15 2026.)
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

(async () => {
  // ── #1: legacy DB (no member columns) must not crash index creation ────────
  console.log('\u2500\u2500 #1 legacy-DB boot: indexes after column migrations \u2500\u2500');
  {
    const src = fs.readFileSync(path.join(__dirname, 'services/db.js'), 'utf8');
    const alterPos = src.indexOf('ADD COLUMN member_id TEXT');
    const idxPos = src.indexOf('idx_bookings_member ON bookings');
    ok('#1: the member_id index is created AFTER the member_id column migration',
       alterPos > 0 && idxPos > alterPos);
    ok('#1: member-dependent indexes appear exactly once (moved, not duplicated)',
       (src.match(/idx_bookings_member ON bookings/g) || []).length === 1 &&
       (src.match(/idx_member_usage_member_date/g) || []).length === 1);
    // adjacent find: updated_at is written by the scheduler; must be migrated
    ok('#1b (adjacent): bookings.updated_at has a column migration for legacy DBs',
       src.includes('ADD COLUMN updated_at TEXT'));
  }

  // ── #2: a placed plaintext password must beat a stale template verifier ────
  console.log('\u2500\u2500 #2 admin-auth: owner password wins over a stale verifier \u2500\u2500');
  {
    const auth = require('./services/auth');
    const cfgSvc = require('./services/config');
    const tmp = path.join(__dirname, 'config.json');
    fs.writeFileSync(tmp, JSON.stringify({
      businessName: 'Prov', setup: { completed: true },
      server: { port: 3099, adminAuth: { algo: 'scrypt', salt: 'STALE', hash: 'STALEHASH' }, adminPassword: 'OwnerRealPass123' },
      booking: { staffedAccess: false }, bays: []
    }));
    if (auth.__resetForTests) auth.__resetForTests();
    auth.ensurePasswordHashed();
    const after = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    ok('#2: the owner\'s placed password verifies after boot', auth.verifyAdminPassword('OwnerRealPass123'));
    ok('#2: the stale template verifier was replaced', after.server.adminAuth && after.server.adminAuth.hash !== 'STALEHASH');
    ok('#2: the plaintext was scrubbed from disk', !after.server.adminPassword);
    try { fs.unlinkSync(tmp); } catch {}
  }

  // ── #3/#4: safe defaults - self-service door codes, notifications never silent ─
  console.log('\u2500\u2500 #3/#4 config defaults: door codes on, sends never silently off \u2500\u2500');
  {
    // read DEFAULTS directly by loading a fresh config with no file
    const tmp = path.join(__dirname, 'config.json');
    try { fs.unlinkSync(tmp); } catch {}
    delete require.cache[require.resolve('./services/config')];
    const cfgSvc = require('./services/config');
    const cfg = cfgSvc.getConfig();
    ok('#3: staffedAccess defaults FALSE (self-service door codes on, not staff-email-only)',
       cfg.booking.staffedAccess === false);
    ok('#4: every SMS notification toggle defaults ON (absent never means silent-off)',
       cfg.sms.sendConfirmation !== false && cfg.sms.sendReminder !== false &&
       cfg.sms.sendDoorCode !== false && cfg.sms.sendCancellation !== false && cfg.sms.sendEndingWarning !== false);
    ok('#4: every email notification toggle defaults ON',
       cfg.resend.sendConfirmation !== false && cfg.resend.sendDoorCode !== false &&
       cfg.resend.sendCancellation !== false);
    const sched = fs.readFileSync(path.join(__dirname, 'services/scheduler.js'), 'utf8');
    ok('#4: a toggle that IS explicitly off logs the skip (diagnosable, not silent)',
       sched.includes('NOTIFY_SKIPPED'));
    try { fs.unlinkSync(tmp); } catch {}
  }

  // ── #6/#7: owner bypasses the staff LAN gate; message names the local address ─
  console.log('\u2500\u2500 #6/#7 staff LAN gate: owner bypass, honest message \u2500\u2500');
  {
    const src = fs.readFileSync(path.join(__dirname, 'routes/staff.js'), 'utf8');
    ok('#6: an admin-authenticated request bypasses the staff LAN gate',
       src.includes('verifyAdminRequest(req)) return next();'));
    ok('#7: the gate message tells staff to use the LOCAL address (not just "facility network")',
       /LOCAL address/i.test(src) && /\.local:/i.test(src));
    ok('#6: the message stays hostname-generic (no single unit hardcoded)',
       !src.includes('bookingpi.local') && !src.includes('babooking.local'));
  }

  console.log('\nMIGRATION RESILIENCE: ' + pass + ' passed, ' + fail + ' failed');
  try { fs.unlinkSync(path.join(__dirname, 'config.json')); } catch {}
  try { fs.unlinkSync(path.join(__dirname, 'bookings.db')); } catch {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
