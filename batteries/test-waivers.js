// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-waivers.js — MEMBERSHIP-LONG WAIVERS + COLLECTION MODES (Aug 2026)
//
// The model under test (maintainer's rulings):
//   - Non-members sign per visit: online, or at the door where staffed
//     ('door' always; 'auto' follows the staffed_days calendar per booking).
//   - Members sign ONE waiver riding the membership: captured at online
//     signup, first booking, staffed check-in, or owner paper attestation.
//   - Validity is SELF-CORRECTING: membership-term or annual (365d); a lapse
//     moves the anchor so rejoining means signing again; an expired waiver
//     simply re-asks at the next booking.
//   - Identity is the point: member-id anchored (name-match crediting is
//     DEAD), with the ESIGN/UETA audit trail (typed name, IP, user agent,
//     SHA-256 of the exact PDF) on every row.
//
// Structure: A) source locks  B) in-process service truth (battery owns the
// db BEFORE any server spawns - sql.js two-process lesson)  C) one live
// server on 3071, config hot-swapped between sections, HTTP truth only.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}
const root = __dirname;
const cfgPath = path.join(root, 'config.json');
const PORT = 3071;
const B = 'http://localhost:' + PORT;
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const dbts = msAgo => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');

function baseCfg(extraWaiver, extraTop) {
  return Object.assign({
    businessName: 'Waiver Test', setup: { completed: true },
    booking: { staffedAccess: false, pricePerHalfHour: 15 },
    server: { port: PORT, businessName: 'Waiver Test' },
    waiver: Object.assign({ mode: 'required', collection: 'online', membershipTerm: 'membership' }, extraWaiver || {}),
    bays: [{ id: 'bay1', name: 'B1', active: true }]
  }, extraTop || {});
}
function writeCfg(extraWaiver, extraTop) { fs.writeFileSync(cfgPath, JSON.stringify(baseCfg(extraWaiver, extraTop))); }
async function settle() { await new Promise(r => setTimeout(r, 500)); }

(async () => {
  // ── A) SOURCE LOCKS ────────────────────────────────────────────────────────
  console.log('\u2500\u2500 A: source locks \u2500\u2500');
  {
    const dbs = fs.readFileSync('services/db.js', 'utf8');
    ok('A1 boot ALTERs: scope/member_id/user_agent/doc_sha256/guardian on signed_waivers',
      ['scope TEXT', 'member_id TEXT', 'user_agent TEXT', 'doc_sha256 TEXT', 'guardian_for TEXT']
        .every(c => dbs.includes(`ALTER TABLE signed_waivers ADD COLUMN ${c}`)));
    ok('A2 boot ALTERs: tier waiver doc + member activation anchor + booking identity columns',
      dbs.includes('ALTER TABLE membership_tiers ADD COLUMN waiver_id') &&
      dbs.includes('ALTER TABLE members ADD COLUMN last_activated_at') &&
      dbs.includes('ALTER TABLE bookings ADD COLUMN waiver_guardian_for') &&
      dbs.includes('ALTER TABLE bookings ADD COLUMN waiver_user_agent'));
    ok('A3 anchor backfill is idempotent (blank-only UPDATE)',
      /UPDATE members SET last_activated_at = created_at WHERE last_activated_at IS NULL OR last_activated_at = ''/.test(dbs));

    const ck = fs.readFileSync('services/checkin.js', 'utf8');
    ok('A4 name-match crediting is DEAD in check-in (no LOWER(customer_name) lookup)',
      !ck.includes('LOWER(customer_name)'));
    ok('A5 markWaiverPaper routes through the unified insert (method+employee recorded)',
      /function markWaiverPaper[\s\S]{0,1500}insertWaiverRow\(b, seat\.name/.test(ck) &&
      !/markWaiverPaper[\s\S]{0,1500}toISOString/.test(ck));

    const wr = fs.readFileSync('routes/waivers.js', 'utf8');
    ok('A6 retention gate is THE records floor (10y, owner may set longer) with legal copy, quarters agree',
      wr.split("require('../services/records').retentionYears()").length === 3 &&
      !/getFullYear\(\) - 7\)/.test(wr) &&
      wr.includes('records retention floor'));
    ok('A7 /needed decision endpoint exists and fails safe to asking',
      wr.includes("router.get('/needed'") && wr.includes('show: true, enforce: true'));

    const ad = fs.readFileSync('public/admin.html', 'utf8');
    // Rule 15 (maintainer, Sep 24 2026): the notice keeps the recorder statement and the
    // lawyer line, and its three points are QUESTIONS for the operator's lawyer
    // with no answer from us - no "enforceable", no "courts view", no "most states
    // will not enforce", no grading. "(recommended)" stays on the 1-year term (maintainer's
    // opinion of his own default); the courts sentence behind it went. Until this
    // date A8 REQUIRED the old claims. Each surface is read as its own slice, so a
    // word elsewhere in the file cannot pass or fail it.
    const between = (s, from, to) => { const i = s.indexOf(from); if (i < 0) return ''; const j = s.indexOf(to, i); return j < 0 ? '' : s.slice(i, j); };
    const LEGAL_CLAIMS = ['enforce', 'courts', 'most states', 'some states', 'varies by state', 'strongest', 'statute',
      'gross negligence', 'indemnif', 'legal evidence', 'only works if', 'turn 18', 'legally binding', 'compliant'];
    const claimsIn = (s) => LEGAL_CLAIMS.filter(w => s.toLowerCase().includes(w));
    const QUESTIONS = ['Does my waiver cover anyone who did not sign it', 'Can a parent or guardian sign for a minor where I operate?',
      'Is there anything my waiver cannot cover, however it is worded?'];
    const notice = between(ad, '<b>Legal notice', '</div>');
    const termHint = between(ad, 'Members sign one waiver that rides their membership', '</div>');
    ok('A8 the Waivers tab\'s legal notice is the recorder statement, the lawyer line and three questions with no answers; the term hint cites no court (rule 15)',
      notice.length > 0 && termHint.length > 0 &&
      notice.includes('This software records signatures and preserves evidence') &&
      notice.includes('Have a lawyer licensed in your state write or review your waiver document') &&
      notice.includes('Three questions to ask them') &&
      QUESTIONS.every(q => notice.includes(q)) &&
      claimsIn(notice).length === 0 && claimsIn(termHint).length === 0 &&
      ad.includes('1 year, then re-sign (recommended)'),
      { notice: notice.length, termHint: termHint.length, claims: claimsIn(notice).concat(claimsIn(termHint)), missing: QUESTIONS.filter(q => !notice.includes(q)) });
    const sw = fs.readFileSync('public/setup.html', 'utf8');
    const wizNote = between(sw, '<b>Legal note.</b>', '</div>');
    const refusal = between(wr, 'has not yet passed your ${years}-year records retention floor', '` });');
    ok('A8b the wizard\'s legal note and the early-delete refusal name the 10-year floor as BA\'s ruling, not the law, and state no law (rule 15)',
      wizNote.length > 0 && refusal.length > 0 &&
      wizNote.includes('This software records signatures with a full evidence trail') &&
      wizNote.includes("BA's ruling as the product's owner, not the law") &&
      wizNote.includes('have a lawyer licensed in your state write or review your waiver document') &&
      QUESTIONS.every(q => wizNote.includes(q)) &&
      refusal.includes("BA's ruling as the product's owner, not the law") &&
      refusal.includes('a deleted one cannot be brought back') &&
      claimsIn(wizNote).length === 0 && claimsIn(refusal).length === 0,
      { wizNote: wizNote.length, refusal: refusal.length, claims: claimsIn(wizNote).concat(claimsIn(refusal)), missing: QUESTIONS.filter(q => !wizNote.includes(q)) });
    ok('A9 admin has collection + membership-term selects wired (load and save)',
      ad.includes('cfg_waiver_collection') && ad.includes('cfg_waiver_membershipTerm') &&
      ad.split('cfg_waiver_collection').length >= 4 && ad.split('cfg_waiver_membershipTerm').length >= 4);
    // Rule 15 (Sep 8 2026): the software supplies no legal content and never
    // assumes an age of majority - the old copy's limitation periods ("six in some
    // states") and "until they turn 18" went on Sep 23 2026; the floor is named as
    // BA's ruling, and the download says it comes down encrypted.
    ok('A10 admin archive copy names the records retention period as BA\'s ruling, says the download is encrypted, and carries no legal claims (rule 15)',
      ad.includes('Deletion unlocks only after your <b>records retention period</b>') && ad.includes("BA's ruling as the product's owner") &&
      ad.includes('it comes down encrypted with your backup passphrase') &&
      !ad.includes('until they turn 18') && !ad.includes('six in some states') && !ad.includes('after <b>7 years</b>'));
    // ...and nowhere a customer or an owner reads (Oct 3 2026, the inventory's critic): the waiver forms said "a
    // participant under 18" on the booking page, the membership join and the owner's own signing, and two admin hints
    // said "auto-renewal notice laws require it" and "a required legal notice"
    { const pub = ['index.html', 'memberships.html', 'admin.html'].map(f => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8')).join('\n');
      ok('A10b no screen assumes 18 or states a legal requirement - "a participant who is a minor", no "notice laws", no "required legal notice" (rule 15)',
        !/under 18/.test(pub) && !/notice laws require/i.test(pub) && !/required legal notice/i.test(pub) && /participant who is a minor/.test(pub)); }
    ok('A11 members table gained the Waiver column (header + cell + colspan 12)',
      ad.includes('<th>Waiver</th>') && ad.includes('memberWaiverCell(m)') &&
      ad.split('colspan="12"').length === 3 && !ad.includes('colspan="11"'));
    ok('A12 Facility Access hybrid choice round-trips (accessStyle persisted)',
      ad.includes("cfg.booking.accessStyle") && ad.includes("cfg.booking?.accessStyle === 'hybrid'"));

    const ix = fs.readFileSync('public/index.html', 'utf8');
    ok('A13 booking page guardian controls exist with label[for] pairs (a11y)',
      ix.includes('id="waiverGuardianCheck"') && ix.includes('for="waiverGuardianCheck"') &&
      ix.includes('id="waiverGuardianName"') && ix.includes('for="waiverGuardianName"'));
    ok('A14 booking page consults the server decision before opening the modal',
      ix.includes('/api/waivers/needed?') && ix.includes('membership_on_file'));

    const ms = fs.readFileSync('public/memberships.html', 'utf8');
    ok('A15 join flow signs the tier document with guardian capture',
      ms.includes('/api/waivers/active?tier=') && ms.includes('jWaiverSig') && ms.includes('jWaiverGuardName'));

    const mb = fs.readFileSync('routes/members.js', 'utf8');
    ok('A16 owner attest + record routes are admin-gated',
      /waiver-attest', requireAdmin/.test(mb) && /waiver-record', requireAdmin/.test(mb));
  }

  // ── B) IN-PROCESS SERVICE TRUTH (before any server owns the db) ───────────
  console.log('\u2500\u2500 B: validity engine + identity trail \u2500\u2500');
  writeCfg();
  const dbM = require('./services/db');
  await dbM.initDb();
  require('./services/pos').ensureSchema();
  const checksSvc = require('./services/checks');
  checksSvc.ensureSchema(); checksSvc.ensureShareColumn && checksSvc.ensureShareColumn();
  const D = dbM.db;
  const mw = require('./services/memberwaiver');
  const ckSvc = require('./services/checkin');

  // slate from prior same-day runs of THIS battery
  D.prepare(`DELETE FROM signed_waivers WHERE customer_phone LIKE '557%' OR customer_name LIKE 'WVR %'`).run();
  for (const b of D.prepare(`SELECT id FROM bookings WHERE id LIKE 'wvr-%' OR phone LIKE '557%'`).all()) {
    for (const t of D.prepare(`SELECT id FROM tabs WHERE booking_id=?`).all(b.id)) {
      D.prepare(`DELETE FROM item_allocations WHERE item_id IN (SELECT id FROM tab_items WHERE tab_id=?)`).run(t.id);
      D.prepare(`DELETE FROM tab_checks WHERE tab_id=?`).run(t.id);
      D.prepare(`DELETE FROM tab_items WHERE tab_id=?`).run(t.id);
      D.prepare(`DELETE FROM tab_payments WHERE tab_id=?`).run(t.id);
    }
    D.prepare(`DELETE FROM tabs WHERE booking_id=?`).run(b.id);
    D.prepare(`DELETE FROM settlements WHERE booking_id=?`).run(b.id);
    D.prepare(`DELETE FROM member_credit WHERE booking_id=?`).run(b.id);
  }
  D.prepare(`DELETE FROM seats WHERE booking_id LIKE 'wvr-%'`).run();
  D.prepare(`DELETE FROM bookings WHERE id LIKE 'wvr-%' OR phone LIKE '557%'`).run();
  D.prepare(`DELETE FROM members WHERE phone LIKE '557%'`).run();
  D.prepare(`DELETE FROM membership_tiers WHERE id LIKE 'wvr-%'`).run();
  D.prepare(`DELETE FROM waivers WHERE id LIKE 'wvr-%'`).run();
  D.prepare(`DELETE FROM staffed_days WHERE note = 'wvr-battery'`).run();

  // waiver documents (real bytes on disk so the SHA-256 is provable)
  const upDir = path.join(root, 'waivers', 'uploads');
  fs.mkdirSync(upDir, { recursive: true });
  fs.writeFileSync(path.join(upDir, 'wvr-main.pdf'), '%PDF-1.4 battery facility waiver v1\n%%EOF');
  fs.writeFileSync(path.join(upDir, 'wvr-tier.pdf'), '%PDF-1.4 battery TIER waiver v1\n%%EOF');
  const mainSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(upDir, 'wvr-main.pdf'))).digest('hex');
  const tierSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(upDir, 'wvr-tier.pdf'))).digest('hex');
  D.prepare(`UPDATE waivers SET active=0`).run();
  D.prepare(`INSERT INTO waivers (id,name,filename,version,active) VALUES ('wvr-w1','Facility Waiver','wvr-main.pdf','1',1)`).run();
  D.prepare(`INSERT INTO waivers (id,name,filename,version,active) VALUES ('wvr-w2','Elite Tier Waiver','wvr-tier.pdf','1',0)`).run();

  // tiers + members
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active) VALUES ('wvr-t1','Standard','percentage',10,1)`).run();
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,waiver_id,sell_online,price_monthly,codes_included)
             VALUES ('wvr-t2','Elite','percentage',20,1,'wvr-w2',1,49,1)`).run();
  const mkMember = (id, name, pin, tier, activatedAgoMs) =>
    D.prepare(`INSERT INTO members (id,tier_id,name,phone,email,pin,status,last_activated_at)
               VALUES (?,?,?,?,?,?,'active',?)`)
      .run(id, tier, name, '557' + pin.slice(0, 4), 'wvr@example.com', pin, dbts(activatedAgoMs));
  mkMember('wvr-m1', 'WVR Alice', '911111', 'wvr-t1', 3600 * 1000);
  mkMember('wvr-m2', 'WVR Alice', '922222', 'wvr-t1', 3600 * 1000); // SAME NAME, different person
  mkMember('wvr-m3', 'WVR Aged', '933333', 'wvr-t1', 500 * 86400000);
  mkMember('wvr-m4', 'WVR Lapse', '944444', 'wvr-t1', 3 * 86400000); // activated BEFORE the signature below

  ok('B1 tier document resolution: pinned tier doc wins, others fall back to active',
    mw.docForTier('wvr-t2').id === 'wvr-w2' && mw.docForTier('wvr-t1').id === 'wvr-w1');
  ok('B2 docSha256 fingerprints the exact PDF bytes', mw.docSha256(mw.docForTier('wvr-t2')) === tierSha);
  ok('B3 no membership waiver yet: status honest', mw.memberWaiverStatus('wvr-m1').on_file === false);

  // recordMembershipWaiver: row + printable archive with the full trail
  const rec = mw.recordMembershipWaiver(
    D.prepare(`SELECT * FROM members WHERE id='wvr-m1'`).get(),
    mw.docForTier('wvr-t1'),
    { method: 'digital', signatureName: 'WVR Alice', ipAddress: '10.0.0.9',
      userAgent: 'BatteryBrowser/1.0', email: 'wvr@example.com',
      guardianFor: 'WVR Kid', context: 'battery' });
  const recRow = D.prepare(`SELECT * FROM signed_waivers WHERE id=?`).get(rec.id);
  ok('B4 membership row: scope+member_id+identity trail (ua, email, doc hash, guardian)',
    recRow && recRow.scope === 'membership' && recRow.member_id === 'wvr-m1' &&
    recRow.user_agent === 'BatteryBrowser/1.0' && recRow.customer_email === 'wvr@example.com' &&
    recRow.doc_sha256 === mainSha && recRow.guardian_for === 'WVR Kid' &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(recRow.agreed_at));
  const recFile = path.join(root, 'waivers', 'signed', recRow.signed_pdf_path || '');
  const recHtml = recRow.signed_pdf_path && fs.existsSync(recFile) ? fs.readFileSync(recFile, 'utf8') : '';
  ok('B5 printable archive exists and carries member id, tier, guardian, ua, and the fingerprint',
    recHtml.includes('wvr-m1') && recHtml.includes('Standard') && recHtml.includes('WVR Kid') &&
    recHtml.includes('BatteryBrowser/1.0') && recHtml.includes(mainSha));
  ok('B6 status flips to on-file for the signer only', mw.memberWaiverStatus('wvr-m1').on_file === true);
  ok('B7 SAME NAME never credits: the other Alice is not on file (name-match is dead)',
    mw.memberWaiverStatus('wvr-m2').on_file === false);

  // annual expiry + lapse mechanics (engine-level; HTTP re-proof in Part C)
  D.prepare(`INSERT INTO signed_waivers (id,booking_id,waiver_id,waiver_name,waiver_version,customer_name,customer_phone,agreed_at,scope,member_id)
             VALUES ('wvr-aged-sig','','wvr-w1','Facility Waiver','1','WVR Aged','5579333',?,'membership','wvr-m3')`)
    .run(dbts(400 * 86400000));
  ok('B8 membership term: a 400-day-old signature still rides', mw.memberWaiverStatus('wvr-m3').on_file === true);
  writeCfg({ membershipTerm: 'annual' });
  const aged = mw.memberWaiverStatus('wvr-m3');
  ok('B9 annual term: the same signature is expired with the honest reason',
    aged.on_file === false && aged.expired === true && aged.reason === 'annual_expired');
  writeCfg();
  D.prepare(`INSERT INTO signed_waivers (id,booking_id,waiver_id,waiver_name,waiver_version,customer_name,customer_phone,agreed_at,scope,member_id)
             VALUES ('wvr-lapse-sig','','wvr-w1','Facility Waiver','1','WVR Lapse','5579444',?,'membership','wvr-m4')`)
    .run(dbts(2 * 86400000));
  ok('B10 pre-lapse the signature credits', mw.memberWaiverStatus('wvr-m4').on_file === true);
  D.prepare(`UPDATE members SET status='inactive' WHERE id='wvr-m4'`).run();
  ok('B11 inactive membership: credit stops immediately', mw.memberWaiverStatus('wvr-m4').on_file === false);
  D.prepare(`UPDATE members SET status='active', last_activated_at=? WHERE id='wvr-m4'`).run(dbts(0));
  const lapsed = mw.memberWaiverStatus('wvr-m4');
  ok('B12 rejoin moves the anchor: old signature is lapsed, they sign again',
    lapsed.on_file === false && lapsed.reason === 'lapsed');

  // ── D) per-tier waiver TERM (waiver audit, Sep 1 2026) ────────────────────
  // maintainer: "if a membership type is created they can choose the waiver style like
  // year long etc." The facility setting is the default; a tier overrides it.
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,waiver_id,waiver_term,sell_online,price_monthly,codes_included)
             VALUES ('wvr-t3','Annual Tier','percentage',0,1,'','annual',1,29,1)`).run();
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,waiver_id,waiver_term,sell_online,price_monthly,codes_included)
             VALUES ('wvr-t4','Day Pass','percentage',0,1,'','visit',1,9,1)`).run();
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,waiver_id,waiver_term,sell_online,price_monthly,codes_included)
             VALUES ('wvr-t5','Life Tier','percentage',0,1,'','membership',1,99,1)`).run();
  mkMember('wvr-m5', 'WVR Annual', '955555', 'wvr-t3', 500 * 86400000);
  mkMember('wvr-m6', 'WVR DayPass', '966666', 'wvr-t4', 500 * 86400000);
  mkMember('wvr-m7', 'WVR Life', '977777', 'wvr-t5', 500 * 86400000);
  for (const [sid, mid, nm] of [['wvr-sig-m5', 'wvr-m5', 'WVR Annual'], ['wvr-sig-m6', 'wvr-m6', 'WVR DayPass'], ['wvr-sig-m7', 'wvr-m7', 'WVR Life']]) {
    D.prepare(`INSERT INTO signed_waivers (id,booking_id,waiver_id,waiver_name,waiver_version,customer_name,customer_phone,agreed_at,scope,member_id)
               VALUES (?,'','wvr-w1','Facility Waiver','1',?,'5579000',?,'membership',?)`).run(sid, nm, dbts(400 * 86400000), mid);
  }
  ok('D1 facility term is "membership" here, so the default tier still rides a 400-day signature', mw.memberWaiverStatus('wvr-m3').on_file === true && mw.termForTier('wvr-t1') === 'membership');
  const dAnnual = mw.memberWaiverStatus('wvr-m5');
  ok('D2 a tier set to ANNUAL expires a 400-day signature under a "membership" facility', dAnnual.on_file === false && dAnnual.reason === 'annual_expired' && dAnnual.term === 'annual', dAnnual);
  const dVisit = mw.memberWaiverStatus('wvr-m6');
  ok('D3 a tier set to EVERY VISIT never carries a membership waiver (reason per_visit)', dVisit.on_file === false && dVisit.expired === false && dVisit.reason === 'per_visit' && dVisit.term === 'visit', dVisit);
  const dLife = mw.memberWaiverStatus('wvr-m7');
  ok('D4 a tier set to LIFE OF MEMBERSHIP rides the old signature', dLife.on_file === true && dLife.term === 'membership', dLife);
  writeCfg({ membershipTerm: 'annual' });
  ok('D5 with the facility on ANNUAL, the LIFE tier still overrides to on-file', mw.memberWaiverStatus('wvr-m7').on_file === true);
  ok('D6 with the facility on ANNUAL, the default tier expires (facility default applies where no override)', mw.memberWaiverStatus('wvr-m3').reason === 'annual_expired');
  D.prepare(`INSERT INTO signed_waivers (id,booking_id,waiver_id,waiver_name,waiver_version,customer_name,customer_phone,agreed_at,scope,member_id)
             VALUES ('wvr-sig-m5-fresh','','wvr-w1','Facility Waiver','1','WVR Annual','5579000',?,'membership','wvr-m5')`).run(dbts(10 * 86400000));
  const dFresh = mw.memberWaiverStatus('wvr-m5');
  ok('D7 a fresh signature on an ANNUAL tier is on file and says when it runs out', dFresh.on_file === true && /^\d{4}-\d{2}-\d{2}$/.test(dFresh.expires_at || ''), dFresh);
  writeCfg();
  const dDecision = mw.waiverDecision({ member: D.prepare(`SELECT * FROM members WHERE id='wvr-m6'`).get(), date: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (1), 12)), start_time: '18:00' });
  ok('D8 the booking decision asks an EVERY-VISIT tier member online like a guest', dDecision.show === true && dDecision.enforce === true && dDecision.source === 'online', dDecision);
  // the door records the TIER document for a member of a pinned tier (G3)
  mkMember('wvr-m8', 'WVR Elite', '988888', 'wvr-t2', 3600 * 1000);
  const nowD = new Date(); const stD = new Date(nowD.getTime() + 120 * 60000), enD = new Date(nowD.getTime() + 180 * 60000);
  const hhD = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,member_id)
             VALUES ('wvr-b3','bay1','B1','WVR Elite','5579888',?,?,?,?,60,3000,'active','wvr-m8')`).run(ymd(stD), hhD(stD), hhD(enD), ymd(enD));
  D.prepare(`INSERT INTO seats (id,booking_id,name,member_id) VALUES ('wvr-seat-elite','wvr-b3','WVR Elite','wvr-m8')`).run();
  ckSvc.markWaiverPaper('wvr-seat-elite', 'Dana');
  const eliteRow = D.prepare(`SELECT sw.* FROM signed_waivers sw JOIN seats s ON s.waiver_signed_id=sw.id WHERE s.id='wvr-seat-elite'`).get();
  ok('D9 a paper attest at the door for a member of a pinned tier records the TIER document, not the facility one',
    eliteRow && eliteRow.waiver_id === 'wvr-w2' && eliteRow.doc_sha256 === tierSha && eliteRow.scope === 'membership', eliteRow && { doc: eliteRow.waiver_id });
  const dCtxOn = ckSvc.checkinContext('wvr-b3');
  ok('D10 check-in context carries waiver_enforce (required) alongside active_waiver', dCtxOn.active_waiver === true && dCtxOn.waiver_enforce === true, { a: dCtxOn.active_waiver, e: dCtxOn.waiver_enforce });
  writeCfg({ mode: 'off' });
  const dCtxOff = ckSvc.checkinContext('wvr-b3');
  ok('D11 mode OFF with a document present: the counter needs nothing (active_waiver false)', dCtxOff.active_waiver === false && dCtxOff.waiver_enforce === false, { a: dCtxOff.active_waiver, e: dCtxOff.waiver_enforce });
  writeCfg({ mode: 'optional' });
  const dCtxOpt = ckSvc.checkinContext('wvr-b3');
  ok('D12 mode OFFERED: chips may show but check-in never blocks (active true, enforce false)', dCtxOpt.active_waiver === true && dCtxOpt.waiver_enforce === false);
  writeCfg();
  // W16: the SERVER refuses a required-mode check-in with an unsigned seat
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('wvr-b4','bay1','B1','WVR Unsigned','5579444',?,?,?,?,60,3000,'active')`).run(ymd(stD), hhD(stD), hhD(enD), ymd(enD));
  const dReq = ckSvc.performCheckin({ booking_id: 'wvr-b4', seats: [{ name: 'WVR Unsigned' }], employee: 'Dana' });
  ok('D24 REQUIRED: the server itself refuses a check-in with an unsigned seat (not only the pad)', dReq.status === 400 && /waiver/.test(String(dReq.body && dReq.body.error)), dReq);
  ok('D24b nothing was written by the refused check-in', !D.prepare(`SELECT id FROM settlements WHERE booking_id='wvr-b4'`).get() && !D.prepare(`SELECT id FROM seats WHERE booking_id='wvr-b4'`).get());
  const dReqPaper = ckSvc.performCheckin({ booking_id: 'wvr-b4', seats: [{ name: 'WVR Unsigned', waiver: { method: 'paper' } }], employee: 'Dana' });
  const paperSeats = (dReqPaper.body && dReqPaper.body.seats) || dReqPaper.seats || [];
  ok('D24c REQUIRED: the same check-in with a paper attest goes through', (!dReqPaper.status || dReqPaper.status === 200) && paperSeats[0] && paperSeats[0].waiver === 'paper', { status: dReqPaper.status, err: dReqPaper.body && dReqPaper.body.error });
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('wvr-b5','bay1','B1','WVR Offered','5579445',?,?,?,?,60,3000,'active')`).run(ymd(stD), hhD(stD), hhD(enD), ymd(enD));
  // ── E) renewal reminders (maintainer, Sep 1 2026): "any waiver that lasts any length
  // of time needs to be asked to do another one when the period is coming up"
  writeCfg({ membershipTerm: 'annual', reminderDays: 30 });
  D.prepare(`INSERT INTO membership_tiers (id,name,discount_type,discount_value,active,waiver_id,waiver_term,sell_online,price_monthly,codes_included)
             VALUES ('wvr-t6','Renew Tier','percentage',0,1,'','annual',1,29,1)`).run();
  mkMember('wvr-m9', 'WVR Soon', '999999', 'wvr-t6', 500 * 86400000);
  mkMember('wvr-m10', 'WVR Fresh', '999998', 'wvr-t6', 500 * 86400000);
  mkMember('wvr-m11', 'WVR NoMail', '999997', 'wvr-t6', 500 * 86400000);
  D.prepare(`UPDATE members SET email='soon@example.com' WHERE id='wvr-m9'`).run();
  D.prepare(`UPDATE members SET email='' WHERE id='wvr-m11'`).run();
  for (const [sid, mid, nm, ago] of [['wvr-sig-m9', 'wvr-m9', 'WVR Soon', 345], ['wvr-sig-m10', 'wvr-m10', 'WVR Fresh', 100], ['wvr-sig-m11', 'wvr-m11', 'WVR NoMail', 350]]) {
    D.prepare(`INSERT INTO signed_waivers (id,booking_id,waiver_id,waiver_name,waiver_version,customer_name,customer_phone,agreed_at,scope,member_id)
               VALUES (?,'','wvr-w1','Facility Waiver','1',?,'5579000',?,'membership',?)`).run(sid, nm, dbts(ago * 86400000), mid);
  }
  const eSoon = mw.memberWaiverStatus('wvr-m9'), eFresh = mw.memberWaiverStatus('wvr-m10');
  ok('E1 a signature 345 days old is still on file, with 20 days left and renew_due', eSoon.on_file === true && eSoon.days_left === 20 && eSoon.renew_due === true, eSoon);
  ok('E2 a signature 100 days old is on file and NOT due', eFresh.on_file === true && eFresh.renew_due === false && eFresh.days_left === 265, eFresh);
  const eDue = mw.renewalsDue();
  ok('E3 renewalsDue lists exactly the members inside the window (Soon + NoMail)', eDue.map(x => x.id).sort().join() === 'wvr-m11,wvr-m9', eDue.map(x => x.id));
  const eDecOnline = mw.waiverDecision({ member: D.prepare(`SELECT * FROM members WHERE id='wvr-m9'`).get(), date: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (1), 12)), start_time: '18:00' });
  ok('E4 booking online inside the window: ASKED for a fresh one, never blocked (renewal_due, show, no enforce)', eDecOnline.show === true && eDecOnline.enforce === false && eDecOnline.source === 'renewal_due' && eDecOnline.member_waiver.expires_at === eSoon.expires_at, eDecOnline);
  writeCfg({ membershipTerm: 'annual', reminderDays: 30, collection: 'door' });
  const eDecDoor = mw.waiverDecision({ member: D.prepare(`SELECT * FROM members WHERE id='wvr-m9'`).get(), date: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + (1), 12)), start_time: '18:00' });
  ok('E5 booking under door collection: told they will re-sign at arrival (renewal_door, nothing online)', eDecDoor.show === false && eDecDoor.source === 'renewal_door', eDecDoor);
  writeCfg({ membershipTerm: 'annual', reminderDays: 30 });
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,member_id)
             VALUES ('wvr-b6','bay1','B1','WVR Soon','5579999',?,?,?,?,60,3000,'active','wvr-m9')`).run(ymd(stD), hhD(stD), hhD(enD), ymd(enD));
  const eCtx = ckSvc.checkinContext('wvr-b6');
  ok('E6 check-in context says renew_soon with the run-out date', eCtx.booking.member_waiver === 'renew_soon' && eCtx.booking.member_waiver_until === eSoon.expires_at, { mw: eCtx.booking.member_waiver, until: eCtx.booking.member_waiver_until });
  const eCk = ckSvc.performCheckin({ booking_id: 'wvr-b6', seats: [{ name: 'WVR Soon', waiver: { method: 'digital', typed_name: 'WVR Soon' } }], employee: 'Dana' });
  const eSeats = (eCk.body && eCk.body.seats) || eCk.seats || [];
  const eAfter = mw.memberWaiverStatus('wvr-m9');
  ok('E7 a fresh signature at the counter is RECORDED even though the old one is still on file, and the clock restarts', (!eCk.status || eCk.status === 200) && eSeats[0] && eSeats[0].waiver === 'signed' && eAfter.on_file === true && eAfter.renew_due === false && eAfter.days_left === 365, { status: eCk.status, seat: eSeats[0] && eSeats[0].waiver, after: eAfter });
  // the nightly pass: one email per member per expiry, none without an email, none twice
  const lifecycle = require('./services/membership-lifecycle');
  const logBefore = D.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event='WAIVER_RENEWAL_REMINDER'`).get().c;
  const pass1 = await lifecycle.runWaiverRenewalPass();
  const m11 = D.prepare(`SELECT waiver_reminder_sent FROM members WHERE id='wvr-m11'`).get();
  const logAfter1 = D.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event='WAIVER_RENEWAL_REMINDER'`).get().c;
  ok('E8 nightly pass: NoMail is due but has no address - listed, not marked; Soon just re-signed so nobody is emailed', pass1.due === 1 && pass1.sent === 0 && pass1.skipped === 1 && m11.waiver_reminder_sent === '' && logAfter1 === logBefore, pass1);
  D.prepare(`UPDATE members SET email='nomail@example.com' WHERE id='wvr-m11'`).run();
  const pass2 = await lifecycle.runWaiverRenewalPass();
  const m11b = D.prepare(`SELECT waiver_reminder_sent FROM members WHERE id='wvr-m11'`).get();
  const st11 = mw.memberWaiverStatus('wvr-m11');
  ok('E9 with an address the reminder goes out once and the member is marked for THIS expiry', pass2.sent === 1 && m11b.waiver_reminder_sent === st11.expires_at && D.prepare(`SELECT COUNT(*) c FROM admin_log WHERE event='WAIVER_RENEWAL_REMINDER'`).get().c === logBefore + 1, { pass2, marker: m11b.waiver_reminder_sent, exp: st11.expires_at });
  const pass3 = await lifecycle.runWaiverRenewalPass();
  ok('E10 the second night sends nothing (once-guard)', pass3.sent === 0 && pass3.skipped === 1, pass3);
  writeCfg({ membershipTerm: 'annual', reminderDays: 0 });
  ok('E11 lead 0 = reminders off: nothing due, nothing asked', mw.renewalsDue().length === 0 && mw.memberWaiverStatus('wvr-m11').renew_due === false);
  writeCfg({ membershipTerm: 'membership', reminderDays: 30 });
  ok('E12 a life-of-membership tier never comes due (no expiry to remind against)', mw.memberWaiverStatus('wvr-m3').renew_due === false && mw.memberWaiverStatus('wvr-m3').expires_at === null);
  writeCfg();
  {
    const ad3 = fs.readFileSync('public/admin.html', 'utf8'), em3 = fs.readFileSync('services/email.js', 'utf8');
    const st3 = fs.readFileSync('public/staff.html', 'utf8'), ix3 = fs.readFileSync('public/index.html', 'utf8');
    const pm3 = fs.readFileSync('public/my-membership.html', 'utf8'), lc3 = fs.readFileSync('services/membership-lifecycle.js', 'utf8');
    ok('E13 owner control: reminder lead on the Waivers tab, wired load + save', ad3.includes('id="cfg_waiver_reminderDays"') && ad3.includes("set('cfg_waiver_reminderDays'") && ad3.includes("reminderDays: Math.max(0, Math.min(180"));
    ok('E14 email: editable intro registered on both sides + sender exported', em3.includes('waiverRenewIntro:') && em3.includes('sendWaiverRenewalReminder') && ad3.includes('id="em_waiverRenewIntro"') && ad3.includes('waiverRenewIntro: `'));
    ok('E15 nightly: the pass runs inside runMaintenance (4:15 + boot)', /runWaiverRenewalPass\(\)/.test(lc3) && lc3.includes('try { await runWaiverRenewalPass(); }'));
    ok('E16 surfaces: roster badge, dashboard card, staff chip, booking-page ask, portal line', ad3.includes('m.waiver_renew_due') && ad3.includes('id="waiverRenewCard"') && st3.includes("s.waiver === 'renew_soon'") && ix3.includes("nd.source === 'renewal_due'") && pm3.includes('id="portalWaiver"'));
  }

  writeCfg({ mode: 'optional' });
  const dOpt = ckSvc.performCheckin({ booking_id: 'wvr-b5', seats: [{ name: 'WVR Offered' }], employee: 'Dana' });
  const optSeats = (dOpt.body && dOpt.body.seats) || dOpt.seats || [];
  ok('D25 OFFERED: an unsigned seat checks in, honestly marked needed', (!dOpt.status || dOpt.status === 200) && optSeats[0] && optSeats[0].waiver === 'needed', { status: dOpt.status, err: dOpt.body && dOpt.body.error, w: optSeats[0] && optSeats[0].waiver });
  writeCfg();
  {
    const dbs2 = fs.readFileSync('services/db.js', 'utf8'), cfgs = fs.readFileSync('services/config.js', 'utf8');
    const ad2 = fs.readFileSync('public/admin.html', 'utf8'), ix2 = fs.readFileSync('public/index.html', 'utf8');
    const st2 = fs.readFileSync('public/staff.html', 'utf8'), rs2 = fs.readFileSync('routes/staff.js', 'utf8');
    const ra2 = fs.readFileSync('routes/admin.js', 'utf8'), su2 = fs.readFileSync('public/setup.html', 'utf8');
    const rm2 = fs.readFileSync('routes/members.js', 'utf8');
    ok('D13 schema: membership_tiers.waiver_term boot ALTER', dbs2.includes("ALTER TABLE membership_tiers ADD COLUMN waiver_term TEXT DEFAULT ''"));
    ok('D14 config defaults name collection + membershipTerm (no consumer reads an undefined key)', /collection: 'online'/.test(cfgs) && /membershipTerm: 'membership'/.test(cfgs));
    ok('D15 tier editor: Membership Waiver Lasts select wired (load + save) with the four choices',
      ad2.includes('id="tierWaiverTerm"') && ad2.includes('option value="visit"') && ad2.includes("waiver_term: document.getElementById('tierWaiverTerm').value") && ad2.includes("ts.value = term || ''"));
    ok('D16 tier route validates waiver_term and writes it', rm2.includes('waiver_term=?') && rm2.includes('TERMS.includes(term)'));
    ok('D17 the waiver POLICY selects live on the Waivers tab, as the guide says',
      ad2.indexOf('id="cfg_waiver_mode"') > ad2.indexOf('id="tab-waivers"') && ad2.indexOf('id="cfg_waiver_mode"') < ad2.indexOf('id="waiverName"'));
    ok('D18 booking page reads enforce and offers a way past an OFFERED waiver', ix2.includes('waiverOptional = !!nd.show && !nd.enforce') && ix2.includes('id="btnWaiverSkip"') && ix2.includes('function skipWaiver()'));
    ok('D19 staff pad gates check-in on waiver_enforce, not on document existence', st2.includes('ckCtx.active_waiver && ckCtx.waiver_enforce !== false'));
    ok('D20 today badge honours mode OFF', rs2.includes("cfgWaiver().mode === 'off') waiverSigned = true"));
    ok('D21 checklist: required-with-no-document is a visible item for every non-members-only facility', ra2.includes("id: 'waiverdoc'") && ra2.includes("(cfg.waiver?.mode || 'required') !== 'off'"));
    ok('D22 wizard asks the guests question once and writes waiver.guests', su2.includes('id="wizWaiverGuests"') && su2.includes("guests: document.getElementById('wizWaiverGuests').value === 'each' ? 'each' : 'member'"));
    ok('D23 roster cell shows the annual expiry date and the every-visit tier honestly', ad2.includes("m.waiver_term === 'visit'") && ad2.includes("' - until ' + m.waiver_expires_at"));
  }

  // check-in truth: coverage, per-seat member scope, paper fix
  const now = new Date();
  const st = new Date(now.getTime() + 120 * 60000), en = new Date(now.getTime() + 180 * 60000);
  const hh = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,member_id)
             VALUES ('wvr-b1','bay1','B1','WVR Alice','5579111',?,?,?,?,60,3000,'active','wvr-m1')`)
    .run(ymd(st), hh(st), hh(en), ymd(en));
  const ctx = ckSvc.checkinContext('wvr-b1');
  ok('B13 checkin context: member booking reads on-file + waiver_signed derived',
    ctx && ctx.booking.member_waiver === 'on_file' && ctx.booking.waiver_signed === true);
  const perf = ckSvc.performCheckin({ booking_id: 'wvr-b1',
    seats: [{ name: 'WVR Alice' }, { name: 'WVR Guest' }], employee: 'Dana' });
  const seatW = (perf.body && perf.body.seats ? perf.body.seats : perf.seats || []).map(x => x.waiver);
  ok('B14 group coverage: booker on-file, guest covered by member (no per-seat ask forced)',
    seatW[0] === 'on_file' && seatW[1] === 'covered_member',
    { status: perf.status, err: perf.body && perf.body.error, seats: seatW });
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status)
             VALUES ('wvr-b2','bay1','B1','WVR Walkin','5579555',?,?,?,?,60,3000,'active')`)
    .run(ymd(st), hh(st), hh(en), ymd(en));
  const seatId = 'wvr-seat-1';
  D.prepare(`INSERT INTO seats (id,booking_id,name) VALUES (?,?,?)`).run(seatId, 'wvr-b2', 'WVR Paper Person');
  ckSvc.markWaiverPaper(seatId, 'Dana');
  const paperRow = D.prepare(`SELECT sw.* FROM signed_waivers sw JOIN seats s ON s.waiver_signed_id=sw.id WHERE s.id=?`).get(seatId);
  ok('B15 paper attest fixed: method=paper, employee stamped, datetime format consistent',
    paperRow && paperRow.method === 'paper' && paperRow.employee === 'Dana' &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(paperRow.agreed_at) && paperRow.doc_sha256 === mainSha);

  // booking-scope record identity trail (service call = the free/paid paths' engine)
  const wsvc = require('./services/waiver');
  const bRow = D.prepare(`SELECT * FROM bookings WHERE id='wvr-b2'`).get();
  const bres = wsvc.recordSignedWaiver(bRow, mw.activeDoc(), {
    signatureName: 'WVR Walkin', ipAddress: '10.0.0.7', userAgent: 'BatteryBrowser/2.0',
    email: 'walk@example.com', guardianFor: '', memberId: null });
  const bRec = D.prepare(`SELECT * FROM signed_waivers WHERE id=?`).get(bres.id);
  ok('B16 booking-scope record carries ua + email + fingerprint, scope stays booking',
    bRec && bRec.scope === 'booking' && bRec.user_agent === 'BatteryBrowser/2.0' &&
    bRec.customer_email === 'walk@example.com' && bRec.doc_sha256 === mainSha);
  ok('B16a a booking-scope record keeps its booking_id AND records where it was captured',
    bRec && bRec.booking_id === 'wvr-b2' && bRec.captured_booking_id === 'wvr-b2');

  // B17a-c (maintainer, Sep 19 2026, the redirect review). THE FIELD THAT MAKES IT
  // EVIDENCE. The customer agrees at booking-create; the record is written
  // later - seconds later at /confirm, MINUTES later when the checkout sweeper
  // rescues a paid booking whose browser never came back (the only path a
  // Klarna/Affirm/Cash App payment could take). Stamping the writer's clock is
  // a WRONG record under rule 15, not a late one. And the evidence packet
  // renders the stored fields AND the generated file in one document, so the
  // two must print the SAME instant or the packet contradicts itself.
  const agreedIso = new Date(Date.now() - 14 * 60 * 1000).toISOString();
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,waiver_id,signature_name,waiver_agreed_at)
             VALUES ('wvr-b40','bay1','B1','WVR Late','5579556',?,?,?,?,60,5000,'active',?,'WVR Late',?)`)
    .run(ymd(st), hh(st), hh(en), ymd(en), mw.activeDoc().id, agreedIso);
  const lateRow = D.prepare(`SELECT * FROM bookings WHERE id='wvr-b40'`).get();
  const lres = wsvc.recordSignedWaiver(lateRow, mw.activeDoc(), {
    signatureName: 'WVR Late', ipAddress: '10.0.0.8', memberId: null });
  const lRec = D.prepare(`SELECT * FROM signed_waivers WHERE id=?`).get(lres.id);
  const wantDb = agreedIso.slice(0, 19).replace('T', ' ');
  ok('B17a agreed_at is WHEN THEY AGREED, not when the row was written (rule 15), in the column\'s own datetime shape',
    lRec && lRec.agreed_at === wantDb &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(lRec.agreed_at),
    { got: lRec && lRec.agreed_at, want: wantDb });
  const lateFile = path.join(root, 'waivers', 'signed', lRec.signed_pdf_path || '');
  const lateHtml = fs.existsSync(lateFile) ? fs.readFileSync(lateFile, 'utf8') : '';
  const shown = (lateHtml.match(/Agreed at: <strong>([^<]+)<\/strong>/) || [])[1] || '';
  // toLocaleString('en-US') renders "Saturday, September 19, 2026 at 04:50:13 AM
  // UTC", which Date.parse cannot read at all (NaN) - drop the weekday and the
  // " at " or this assertion silently grades nothing.
  const shownMs = Date.parse(shown.replace(/^[A-Za-z]+, /, '').replace(' at ', ' '));
  ok('B17b the generated document prints the SAME instant as the row (the evidence packet shows both)',
    Number.isFinite(shownMs) && Math.abs(shownMs - Date.parse(agreedIso)) < 1000,
    { documentSays: shown, rowSays: lRec && lRec.agreed_at, parsed: Number.isFinite(shownMs) });
  // An old row with no stamp still records - it falls back to now, as it always did.
  D.prepare(`INSERT INTO bookings (id,bay_id,bay_name,name,phone,date,start_time,end_time,end_date,duration_minutes,price_cents,status,waiver_id,signature_name)
             VALUES ('wvr-b41','bay1','B1','WVR Old','5579557',?,?,?,?,60,5000,'active',?,'WVR Old')`)
    .run(ymd(st), hh(st), hh(en), ymd(en), mw.activeDoc().id);
  const oldRow = D.prepare(`SELECT * FROM bookings WHERE id='wvr-b41'`).get();
  const ores = wsvc.recordSignedWaiver(oldRow, mw.activeDoc(), { signatureName: 'WVR Old', memberId: null });
  const oRec = D.prepare(`SELECT * FROM signed_waivers WHERE id=?`).get(ores.id);
  ok('B17c a pre-Sep-19 booking with no stamp still records, falling back to now in the same shape',
    oRec && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(oRec.agreed_at) &&
    Math.abs(Date.parse(oRec.agreed_at.replace(' ', 'T') + 'Z') - Date.now()) < 120000,
    { got: oRec && oRec.agreed_at });

  // W37 + Part 3: a MEMBERSHIP-scope signature taken at a booking must not
  // carry a booking id (a waiver that rides a membership is not an attendance
  // record) - but it must still be findable BY that booking, or the pad badges
  // "Waiver needed" at a member who just signed and the admin lookup 404s.
  // Both of those regressed on the bench when the split first landed, because
  // two routes carried their own copy of `WHERE booking_id = ?`. This asserts
  // the SHARED helper, which is the only thing anything may ask.
  const mRow = D.prepare(`SELECT * FROM members WHERE id='wvr-m1'`).get()
            || D.prepare(`SELECT * FROM members LIMIT 1`).get();
  const mbRow = D.prepare(`SELECT * FROM bookings WHERE id='wvr-b2'`).get();
  const mres = wsvc.recordSignedWaiver(Object.assign({}, mbRow, { id: 'wvr-b37' }), mw.activeDoc(), {
    signatureName: 'WVR Member', ipAddress: '10.0.0.8', userAgent: 'BatteryBrowser/2.0',
    email: 'member@example.com', guardianFor: '', memberId: mRow ? mRow.id : 'wvr-m1' });
  const mRec = D.prepare(`SELECT * FROM signed_waivers WHERE id=?`).get(mres.id);
  ok('B16b a membership-scope signature carries NO booking id, and its provenance moves to captured_booking_id',
    mRec && mRec.scope === 'membership' && mRec.booking_id === '' && mRec.captured_booking_id === 'wvr-b37', mRec && { b: mRec.booking_id, c: mRec.captured_booking_id, s: mRec.scope });
  const foundByBooking = dbM.getSignedWaiverByBooking('wvr-b37');
  ok('B16c and the SHARED lookup still finds it by that booking (the pad badge and the admin route both ask this)',
    !!foundByBooking && foundByBooking.id === mRec.id, foundByBooking && foundByBooking.id);
  ok('B16d no route keeps a private copy of that query - they would miss every member signature',
    !/FROM signed_waivers WHERE booking_id/.test(fs.readFileSync('routes/waivers.js', 'utf8')) &&
    !/FROM signed_waivers WHERE booking_id/.test(fs.readFileSync('routes/staff.js', 'utf8')));

  // hybrid coverage calendar for Part C
  const tomorrow = new Date(now.getTime() + 86400000), dayAfter = new Date(now.getTime() + 2 * 86400000);
  D.prepare(`INSERT INTO staffed_days (date,start_time,end_time,note) VALUES (?,?,?,?)`)
    .run(ymd(tomorrow), '', '', 'wvr-battery');
  const C = { tomorrow: ymd(tomorrow), dayAfter: ymd(dayAfter) };
  dbM.saveDb && dbM.saveDb();

  // ── C) LIVE SERVER: one spawn, config hot-swapped per section ─────────────
  console.log('\u2500\u2500 C: live collection modes + signup \u2500\u2500');
  writeCfg();
  const child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', d => bootLog += d);
  child.stderr.on('data', d => bootLog += d);
  let up = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const r = await fetch(B + '/api/time'); if (r.ok) { up = true; break; } } catch {}
  }
  ok('C0 server up on the battery port', up);

  if (up) {
    const post = (u, body, hdr) => fetch(B + u, { method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, hdr || {}), body: JSON.stringify(body) }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
    const getj = u => fetch(B + u).then(r => r.json());
    const bk = (over) => Object.assign({ name: 'WVR Web', phone: '5579777', email: 'w@example.com',
      date: C.dayAfter, start_time: '10:00', duration_minutes: 60, bay_id: 'bay1', sms_consent: false }, over || {});

    // ONLINE collection
    let r = await post('/api/bookings/create-payment-intent', bk({ start_time: '10:00' }));
    ok('C1 online: non-member without a signature is blocked', r.s === 400 && /waiver/i.test(r.d.error || ''), r);
    r = await post('/api/bookings/create-payment-intent',
      bk({ start_time: '11:00', waiver_id: 'wvr-w1', signature_name: 'WVR Web', waiver_guardian_for: 'WVR Web Jr' }),
      { 'User-Agent': 'BatteryBrowser/3.0' });
    ok('C2 online: signed booking (with guardian) succeeds on the free path', r.s === 200 && r.d.bookingId, r);
    let nd = await getj('/api/waivers/needed?date=' + C.dayAfter + '&start_time=12:00&pin=911111');
    ok('C3 needed: member with waiver on file is never asked', nd.show === false && nd.source === 'membership_on_file', nd);
    r = await post('/api/bookings/create-payment-intent', bk({ start_time: '12:00', member_pin: '911111', name: 'WVR Alice', phone: '5579111' }));
    ok('C4 member on file books with NO waiver fields (server-enforced skip)', r.s === 200 && r.d.bookingId, r);
    nd = await getj('/api/waivers/needed?date=' + C.dayAfter + '&start_time=13:00&pin=922222');
    ok('C5 the same-named other member is still asked (identity, not names)', nd.show === true, nd);
    let vp = await post('/api/members/validate-pin', { pin: '911111' });
    ok('C6 validate-pin carries the waiver block (on file)', vp.d.waiver && vp.d.waiver.on_file === true, vp.d.waiver);
    ok('C7 /active carries collection for the booking page', (await getj('/api/waivers/active')).collection === 'online');

    // DOOR collection
    writeCfg({ collection: 'door' }); await settle();
    r = await post('/api/bookings/create-payment-intent', bk({ start_time: '14:00' }));
    ok('C8 door: nobody signs online - unsigned booking succeeds', r.s === 200 && r.d.bookingId, r);
    ok('C9 /active reports door so the page shows the arrival note', (await getj('/api/waivers/active')).collection === 'door');

    // AUTO collection (hybrid): covered tomorrow, uncovered the day after
    writeCfg({ collection: 'auto' }); await settle();
    r = await post('/api/bookings/create-payment-intent', bk({ date: C.tomorrow, start_time: '10:00' }));
    ok('C10 auto: staffed-day arrival signs at the door - unsigned succeeds', r.s === 200 && r.d.bookingId, r);
    r = await post('/api/bookings/create-payment-intent', bk({ start_time: '15:00' }));
    ok('C11 auto: unstaffed arrival must sign online - unsigned blocked', r.s === 400 && /waiver/i.test(r.d.error || ''), r);

    // ANNUAL self-correction over HTTP: aged member is asked, signs, is covered
    writeCfg({ membershipTerm: 'annual' }); await settle();
    nd = await getj('/api/waivers/needed?date=' + C.dayAfter + '&start_time=16:00&pin=933333');
    ok('C12 annual: aged signature re-asks at booking time', nd.show === true, nd);
    vp = await post('/api/members/validate-pin', { pin: '933333' });
    ok('C13 validate-pin explains the annual expiry', vp.d.waiver && vp.d.waiver.expired === true && vp.d.waiver.reason === 'annual_expired', vp.d.waiver);
    r = await post('/api/bookings/create-payment-intent',
      bk({ start_time: '16:00', member_pin: '933333', name: 'WVR Aged', phone: '5579333', waiver_id: 'wvr-w1', signature_name: 'WVR Aged' }));
    ok('C14 the expired member signs during booking - accepted', r.s === 200 && r.d.bookingId, r);
    nd = await getj('/api/waivers/needed?date=' + C.dayAfter + '&start_time=17:00&pin=933333');
    ok('C15 SELF-CORRECTING: that signature renewed the membership waiver', nd.show === false && nd.source === 'membership_on_file', nd);

    // LAPSED member is asked again (anchor proof over HTTP)
    nd = await getj('/api/waivers/needed?date=' + C.dayAfter + '&start_time=17:30&pin=944444');
    ok('C16 lapse-and-rejoin re-asks over HTTP too', nd.show === true, nd);

    // MOCK SIGNUP: tier doc signed once, rides the new membership
    writeCfg({ membershipTerm: 'membership' }, { stripe: { secretKey: 'sk_mock_battery', publishableKey: 'pk_mock' } });
    await settle();
    ok('C17 /active?tier resolves the tier-pinned document', (await getj('/api/waivers/active?tier=wvr-t2')).id === 'wvr-w2');
    r = await post('/api/memberships/checkout', { tier_id: 'wvr-t2', cadence: 'monthly', name: 'WVR Join', email: 'join@example.com', phone: '5579888', arl_consent: true });
    ok('C18 signup without the waiver signature is blocked', r.s === 400 && /waiver/i.test(r.d.error || ''), r);
    r = await post('/api/memberships/checkout', { tier_id: 'wvr-t2', cadence: 'monthly', name: 'WVR Join', email: 'join@example.com', phone: '5579888', arl_consent: true,
      waiver_id: 'wvr-w2', waiver_signature: 'WVR Join', waiver_guardian_for: '' }, { 'User-Agent': 'BatteryBrowser/4.0' });
    ok('C19 signed signup starts mock checkout', r.s === 200 && r.d.url && r.d.url.includes('mock-pay'), r);
    let pin = '';
    if (r.d.url) {
      const pay = await fetch(r.d.url, { redirect: 'manual' });
      const loc1 = pay.headers.get('location') || '';
      const done = await fetch(B + loc1, { redirect: 'manual' });
      const loc2 = done.headers.get('location') || '';
      pin = (loc2.match(/pin=(\d+)/) || [])[1] || '';
    }
    ok('C20 mock-pay lands joined with a PIN', /^\d{4,8}$/.test(pin), pin);
    if (pin) {
      nd = await getj('/api/waivers/needed?date=' + C.dayAfter + '&start_time=18:00&pin=' + pin);
      ok('C21 the signup signature rides the new membership - never asked at booking', nd.show === false && nd.source === 'membership_on_file', nd);
      vp = await post('/api/members/validate-pin', { pin });
      ok('C22 validate-pin agrees for the new member', vp.d.waiver && vp.d.waiver.on_file === true, vp.d.waiver);
    } else { ok('C21 (skipped - no pin)', false); ok('C22 (skipped - no pin)', false); }

    // mode off: nothing asked anywhere (regression of the reversible switch)
    writeCfg({ mode: 'off' }); await settle();
    r = await post('/api/bookings/create-payment-intent', bk({ start_time: '19:00' }));
    ok('C23 mode off: unsigned booking sails through, records intact', r.s === 200 && r.d.bookingId, r);
  } else {
    for (const n of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'C22', 'C23']) ok(n + ' (server never came up)', false);
  }

  // exact-PID kill after cwd verification (standing law 5)
  try {
    const cwd = fs.readlinkSync('/proc/' + child.pid + '/cwd');
    if (cwd.startsWith(root)) child.kill('SIGKILL');
  } catch { child.kill('SIGKILL'); }
  const errLines = bootLog.split('\n').filter(l => /TypeError|ReferenceError|SyntaxError|Unhandled|Cannot find module/.test(l));
  ok('C24 zero runtime error signatures across every phase', errLines.length === 0, errLines.slice(0, 3));

  await new Promise(r => setTimeout(r, 300));
  for (const f of ['config.json', 'bookings.db', 'BOOTSTRAP-PASSWORD.txt', 'license.json', 'nohup.out']) {
    try { fs.unlinkSync(path.join(root, f)); } catch {}
  }
  console.log('\nWAIVERS: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
