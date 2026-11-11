// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-membership-join.js — A PAID SIGNUP THE BROWSER NEVER BROUGHT BACK
//
// Until Sep 20 2026 the member row was created in exactly one place: the browser
// coming back from Stripe's hosted Checkout to /api/memberships/success. The
// webhook did nothing for checkout.session.completed and the nightly reconcile
// walked members that already existed. So a subscriber whose tab closed on the
// confirmation page had paid, was being billed monthly, and the unit had never
// heard of them - and at a members-only club could not book at all.
//
// This drives the product in MOCK billing mode (sk_mock, the hosted page is
// /api/memberships/mock-pay) and NEVER follows the redirect back to /success -
// exactly the customer whose browser did not return. Then it asks the unit to
// look for them. Fail-first is structural: on the pre-Sep-20 tree the reconcile
// route does not exist and the member is never created by anything.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : '')); fail++; }
}
const root = __dirname;
const cfgPath = path.join(root, 'config.json');
const PORT = 3060;
const B = 'http://localhost:' + PORT;
const PW = 'membership-join-battery-pw';
const H = { 'Content-Type': 'application/json', 'x-admin-password': PW };

function writeCfg(over) {
  fs.writeFileSync(cfgPath, JSON.stringify(Object.assign({
    businessName: 'Join Club', setup: { completed: true, eulaAccepted: true },
    booking: { staffedAccess: true, pricePerHalfHour: 20, membersOnly: true, windowDays: 30 },
    server: { port: PORT, businessName: 'Join Club', adminPassword: PW },
    stripe: { secretKey: 'sk_mock_joinbattery', publishableKey: 'pk_mock_joinbattery' },
    waiver: { mode: 'required', collection: 'online', membershipTerm: 'membership' },
    bays: [{ id: 'mj-b1', name: 'Bay 1', active: true }]
  }, over || {})));
}
function seed() {
  const code = `
    const db = require('${root.replace(/\\/g, '/')}/services/db.js');
    (async () => {
      await db.initDb();
      const d = db.db;
      d.prepare("DELETE FROM members").run();
      d.prepare("DELETE FROM membership_tiers").run();
      d.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,price_monthly,price_annual,sell_online,active) VALUES ('mj-tier','Join Tier','flat_rate',10,49,490,1,1)").run();
      d.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,price_monthly,sell_online,active,codes_included) VALUES ('mj-fam','Family Tier','flat_rate',10,89,1,1,3)").run();
      d.prepare("DELETE FROM waivers").run();
      d.prepare("INSERT INTO waivers (id,name,filename,version,description,active) VALUES ('mj-w','Join Club Waiver','mj-waiver.pdf','1','',1)").run();
      await db.flushed();
      process.exit(0);
    })().catch(e => { console.error(e.message); process.exit(1); });
  `;
  execFileSync('node', ['-e', code], { cwd: root, stdio: 'pipe' });
}
async function boot() {
  const child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const r = await fetch(B + '/api/time'); if (r.ok) return { child, log: () => log }; } catch {}
  }
  return { child: null, log: () => log };
}
const post = (u, body, h) => fetch(B + u, { method: 'POST', headers: h || H, body: JSON.stringify(body || {}) })
  .then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
const put = (u, body) => fetch(B + u, { method: 'PUT', headers: H, body: JSON.stringify(body || {}) })
  .then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));
const getj = u => fetch(B + u, { headers: H }).then(r => r.json()).catch(() => ({}));
// the browser that does NOT come back: follow nothing, just read where it would have gone
const noFollow = u => fetch(B + u, { redirect: 'manual', headers: H }).then(r => ({ s: r.status, loc: r.headers.get('location') || '' }));
const members = () => getj('/api/members').then(d => (d.members || d || []));
const logRows = () => getj('/api/admin/log?limit=200').then(d => (d.entries || d.log || d || []));
const signal = () => getj('/api/admin/health?fresh=1').then(d => ((d.signals || []).find(x => x.key === 'membership') || {}));

(async () => {
  writeCfg();
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  seed();
  // a waiver document, the way the membersonly battery stages one
  try {
    fs.mkdirSync(path.join(root, 'waivers', 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(root, 'waivers', 'uploads', 'mj-waiver.pdf'), '%PDF-1.4 join club waiver\n%%EOF');
  } catch {}
  let { child, log } = await boot();
  ok('0 server up in MOCK billing mode', !!child, child ? '' : log().slice(-400));
  if (!child) process.exit(1);
  const wdoc = await getj('/api/waivers/active');
  const waiverOn = !!(wdoc && wdoc.hasWaiver && wdoc.id);
  const applicant = (name, email) => Object.assign(
    { tier_id: 'mj-tier', cadence: 'monthly', name, email, phone: '5559990001', arl_consent: true },
    waiverOn ? { waiver_id: wdoc.id, waiver_signature: name } : {});

  // ── 1. pay, and never come back ──────────────────────────────────────────
  console.log('── 1. the customer pays and the browser never returns ──');
  let c = await post('/api/memberships/checkout', applicant('Gone Customer', 'gone@example.invalid'));
  ok('1a checkout starts a session (mock hosted page)', c.s === 200 && /mock-pay\?session_id=/.test(c.d.url || ''), c);
  const sid1 = ((c.d.url || '').match(/session_id=([^&]+)/) || [])[1] || '';
  // mock-pay marks it PAID and answers a redirect to /success - we do not follow it
  let r = await noFollow('/api/memberships/mock-pay?session_id=' + sid1);
  ok('1b the payment goes through and Stripe would send them to /success (302) - which they never reach', r.s === 302 && /\/api\/memberships\/success/.test(r.loc), r);
  let ms = await members();
  ok('1c BEFORE the reconcile: they paid and there is NO member record (the hole)', !ms.some(m => m.name === 'Gone Customer'), ms.map(m => m.name));

  // ── 2. the unit looks for them ───────────────────────────────────────────
  console.log('── 2. the reconcile (the owner\'s Check now = the same run boot and nightly make) ──');
  let rec = await post('/api/admin/memberships/reconcile', {});
  ok('2a Check now runs (owner only) and RECOVERS the join', rec.s === 200 && rec.d.recovered === 1 && rec.d.failed.length === 0 && !rec.d.error, rec.d);
  ms = await members();
  const gone = ms.find(m => m.name === 'Gone Customer');
  ok('2b the member now exists: right tier, active, a 6-digit code, the subscription id on the row',
     !!gone && gone.tier_id === 'mj-tier' && gone.status === 'active' && /^\d{6}$/.test(gone.pin || '') && /^sub_mock_/.test(gone.stripe_subscription_id || ''), gone);
  ok('2c the row says HOW it came to exist, for the owner', !!gone && /recovered/i.test(gone.notes || ''), gone && gone.notes);
  let lg = await logRows();
  ok('2d MEMBERSHIP_JOIN_RECOVERED is in the owner\'s log, saying the browser never came back',
     lg.some(e => e.event === 'MEMBERSHIP_JOIN_RECOVERED' && /never came back/.test(e.detail || '')));
  if (waiverOn) {
    const sw = await getj('/api/members/' + (gone ? gone.id : 'x') + '/waiver-record');
    ok('2e the waiver they signed at checkout was RECOVERED from the session and recorded against the member (rule 15)',
       !!(sw && (sw.on_file || sw.signed || sw.record || sw.id || sw.signature_name)), sw);
  } else console.log('NOT RUN  2e no active waiver doc on this unit - the waiver leg cannot be proven here');
  rec = await post('/api/admin/memberships/reconcile', {});
  ms = await members();
  ok('2f a SECOND run creates nothing twice: one member, recovered 0', rec.d.recovered === 0 && ms.filter(m => m.name === 'Gone Customer').length === 1, { rec: rec.d, n: ms.filter(m => m.name === 'Gone Customer').length });
  let sg = await signal();
  ok('2g the health line reads GREEN with the recovery counted', sg.level === 'green' && /every paid signup has a member/.test(sg.detail || ''), sg);

  // ── 3. the browser that comes back EARLY ─────────────────────────────────
  console.log('── 3. a session still open is "completing", never "failed" ──');
  c = await post('/api/memberships/checkout', applicant('Early Bird', 'early@example.invalid'));
  const sid2 = ((c.d.url || '').match(/session_id=([^&]+)/) || [])[1] || '';
  r = await noFollow('/api/memberships/success?session_id=' + sid2);
  ok('3a /success on an OPEN session sends them to pending=1, not verify=failed', r.s === 302 && /pending=1/.test(r.loc), r);
  r = await noFollow('/api/memberships/success?session_id=cs_mock_doesnotexist');
  ok('3b /success on a session that does not exist is the real failure', r.s === 302 && /verify=failed/.test(r.loc), r);
  rec = await post('/api/admin/memberships/reconcile', {});
  ms = await members();
  ok('3c the reconcile leaves an OPEN (unpaid) session alone - no member, no failure', !ms.some(m => m.name === 'Early Bird') && rec.d.failed.length === 0, rec.d);

  // ── 4. paid on a tier the owner has since DEACTIVATED: still honored ──────
  // The reconcile's failure branch (out.failed -> red signal, named, logged) is
  // real defensive code, but it fires only when the tier ROW is truly absent -
  // and a tier can only be SOFT-deactivated (active=0), never removed, so a paid
  // member is always creatable. Forcing a hard-absent row in mock would need
  // either an out-of-band DB write (ONE WRITER) or a session that survives a
  // restart (they are in-memory). So the red-and-named RENDER is locked
  // statically in test-layout; what is proven behaviourally here is the
  // guarantee that actually reaches a customer: a paid signup on a tier the
  // owner deactivated mid-flight is HONORED, not dropped.
  console.log('── 4. paid on a since-deactivated tier is still honored ──');
  const famDoc = waiverOn ? { waiver_id: wdoc.id, waiver_signature: 'Fam Member' } : {};
  c = await post('/api/memberships/checkout', Object.assign({ tier_id: 'mj-fam', cadence: 'monthly', name: 'Fam Member', email: 'fam@example.invalid', phone: '5559990002', arl_consent: true }, famDoc));
  const sid3 = ((c.d.url || '').match(/session_id=([^&]+)/) || [])[1] || '';
  await noFollow('/api/memberships/mock-pay?session_id=' + sid3);   // paid, browser gone
  const deact = await fetch(B + '/api/members/tiers/mj-fam', { method: 'DELETE', headers: H }).then(r => r.status).catch(() => 0);
  ok('4a the owner deactivates the family tier while the join is in flight (soft-delete, no members yet)', deact === 200, deact);
  rec = await post('/api/admin/memberships/reconcile', {});
  ok('4b the paid signup is still HONORED - recovered, never dropped, no failure', rec.d.recovered === 1 && rec.d.failed.length === 0, rec.d);
  ms = await members();
  const fam = ms.find(m => m.name === 'Fam Member');
  ok('4c the member exists on the deactivated tier, with the additional family codes the tier promised', !!fam && fam.tier_id === 'mj-fam' && ms.filter(m => m.parent_member_id === fam.id).length === 2, { fam: !!fam, kids: fam ? ms.filter(m => m.parent_member_id === fam.id).length : 0 });
  sg = await signal();
  ok('4d the health line stays GREEN - nobody is stranded', sg.level === 'green', sg);

  // ── 5. the owner fixes it by hand, WITH the billing attached ─────────────
  console.log('── 5. a hand-made member carries their billing ──');
  const subLost = 'sub_mock_' + 'byhand01';
  let mk = await post('/api/members', { tier_id: 'mj-tier', name: 'Lost Tier', phone: '5559990002', email: 'lost@example.invalid', stripe_subscription_id: subLost, stripe_customer_id: 'cus_mock_byhand01' });
  ok('5a the owner creates them on a real tier and pastes the subscription id', mk.s === 200 && mk.d.id, mk);
  ms = await members();
  const lost = ms.find(m => m.id === mk.d.id);
  ok('5b the row carries the subscription, active billing, a cadence - not a detached member', !!lost && lost.stripe_subscription_id === subLost && lost.sub_status === 'active' && lost.billing_cadence === 'monthly', lost);
  let dup = await post('/api/members', { tier_id: 'mj-tier', name: 'Twin', phone: '5559990003', stripe_subscription_id: subLost });
  ok('5c the same subscription cannot be linked to a second member (409, naming who has it)', dup.s === 409 && /Lost Tier/.test(dup.d.error || ''), dup);
  let bad = await post('/api/members', { tier_id: 'mj-tier', name: 'Bad Id', phone: '5559990004', stripe_subscription_id: 'not-a-sub' });
  ok('5d a value that is not a subscription id is refused with words', bad.s === 400 && /sub_/.test(bad.d.error || ''), bad);
  const up = await put('/api/members/' + gone.id, { tier_id: 'mj-tier', name: 'Gone Customer', phone: '5559990001', email: 'gone@example.invalid', status: 'active', stripe_customer_id: 'cus_mock_edited' });
  ms = await members();
  ok('5e the link can be edited later (PUT) without touching anything else', up.s === 200 && (ms.find(m => m.id === gone.id) || {}).stripe_customer_id === 'cus_mock_edited', { s: up.s, e: up.d.error });
  // 5f (Oct 20 2026, found by the AI branch's members map): a save with only the new name - the family-code Rename sends just
  // that - answered 500 (no tier), and a partial save would have set a suspended member back to active and blanked their
  // notes and email. A field not sent keeps its value.
  await put('/api/members/' + gone.id, { tier_id: 'mj-tier', name: 'Gone Customer', phone: '5559990001', email: 'gone@example.invalid', status: 'suspended', notes: 'keep me' });
  const ren = await put('/api/members/' + gone.id, { name: 'Gone Renamed' });
  ms = await members(); const g5f = ms.find(m => m.id === gone.id) || {};
  ok('5f a save with only the new name (the family-code Rename) works and keeps every other field: still suspended, its notes, email and tier kept',
     ren.s === 200 && g5f.name === 'Gone Renamed' && g5f.status === 'suspended' && g5f.notes === 'keep me' && g5f.email === 'gone@example.invalid' && g5f.tier_id === 'mj-tier',
     { s: ren.s, e: ren.d && ren.d.error, g5f: { name: g5f.name, status: g5f.status, notes: g5f.notes, email: g5f.email } });
  // 5g (Oct 20 2026): the owner's Cancel now on a family membership ends its other codes too - they kept working, the door
  // included, until Stripe's webhook came
  const famNow = (await members()).find(m => m.name === 'Fam Member');
  const cn = famNow ? await post('/api/members/' + famNow.id + '/cancel', { mode: 'now' }) : { s: 0, d: {} };
  ms = await members();
  const famAfter = ms.find(m => famNow && m.id === famNow.id) || {}, kidsAfter = ms.filter(m => famNow && m.parent_member_id === famNow.id);
  ok('5g the owner cancels a family membership now: the primary AND its family codes are ended (' + kidsAfter.length + ' codes)',
     cn.s === 200 && famAfter.status === 'inactive' && kidsAfter.length === 2 && kidsAfter.every(k => k.status === 'inactive'),
     { s: cn.s, e: cn.d && cn.d.error, primary: famAfter.status, kids: kidsAfter.map(k => k.status) });

  try { child.kill('SIGTERM'); } catch {}
  await new Promise(r => setTimeout(r, 700));

  // ── 6. rule 31: a unit with no Stripe key is SILENT ──────────────────────
  console.log('── 6. rule 31: no key, sell-online tier present - nothing to be wrong ──');
  writeCfg({ stripe: {} });
  ({ child, log } = await boot());
  ok('6a server up with no Stripe key', !!child);
  if (child) {
    await new Promise(r => setTimeout(r, 2500));   // the boot maintenance runs the reconcile
    rec = await post('/api/admin/memberships/reconcile', {});
    ok('6b the reconcile SKIPS - no call, no error', rec.s === 200 && rec.d.skipped === true && !rec.d.error, rec.d);
    sg = await signal();
    ok('6c the health line is GREEN ("no card payments"), never amber "could not check"', sg.level === 'green' && /no card payments/.test(sg.detail || ''), sg);
    try { child.kill('SIGTERM'); } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nMEMBERSHIP JOIN: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
