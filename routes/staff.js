// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/staff.js — the staff surface API (Wave A).
//
// LAN law: every route here refuses tunnel traffic (Cloudflare headers) with
// the same detection the /setup gate uses. Staff work happens on the facility
// network only; the owner's admin remains reachable from anywhere.
//
// Auth: POST /login trades a roster code for a token (services/staff). All
// other routes accept a live staff token OR the admin password (owner can see
// everything staff can). Identity is server-side — stamps come from the session.
//
// Note: routes/admin.js keeps its own owner-dashboard /today; this staff feed
// is the superset (POS-tab aware, done-means-paid) and is the one the /staff
// surface uses. The admin one is untouched to avoid churn.
'use strict';

const express = require('express');
const router = express.Router();
const staff = require('../services/staff');
const configService = require('../services/config');
const dbMod = require('../services/db');
const pos = require('../services/pos');

router.use((req, res, next) => {
  // #6 (pilot facility rebase): the OWNER manages staff from the admin console, which must
  // work from anywhere. Admin-authenticated requests skip the LAN gate - only
  // the staff-CODE paths stay LAN-only. Without this, the admin dashboard's
  // background roster load gets 403'd and leaks a red error banner, AND the
  // owner cannot manage staff from their public domain at all.
  if (require('../services/auth').verifyAdminRequest(req)) return next();
  // staff.allowRemote (config, DEFAULT OFF): TEMPORARY owner switch that lets
  // staff CODE routes work over the public domain too. Ships OFF - a delivered
  // unit keeps staff sign-in LAN-only. Turn off before shipping.
  const allowRemote = !!configService.getConfig().staffRemoteAccess;
  if (staff.viaTunnel(req) && !allowRemote) {
    return res.status(403).json({ error: 'Staff sign-in must use the facility\'s LOCAL address on the facility Wi-Fi (for example http://your-pi-hostname.local:PORT/staff) - not the public website. Being on the Wi-Fi is not enough on its own: the public web address routes through the internet and is blocked for staff for security.' });
  }
  next();
});

// ── sign in / lock ─────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  if (!staff.surfaceEnabled()) {
    return res.status(403).json({ error: 'No staff sign-in codes are set up for this facility.' });
  }
  const out = staff.login(req.body?.code, req);
  if (out.locked) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  if (!out.ok)    return res.status(401).json({ error: 'Code not recognized' });
  res.json({ token: out.token, name: out.name, autoLockMins: out.autoLockMins });
});

router.post('/logout', (req, res) => {
  staff.logout(req.headers['x-staff-token']);
  res.json({ ok: true });
});

router.get('/me', staff.requireStaffOrAdmin, (req, res) => {
  const cfg = configService.getConfig();
  const pc = require('../services/pos').posCfg(cfg);
  res.json({
    name: req.staffName || '',
    auth: req.staffAuth,
    facility: cfg.server?.businessName || '',
    staffedAccess: !!cfg.booking?.staffedAccess,
    fnb: cfg.pos?.fnb !== false,
    autoLockMins: staff.autoLockMins(),
    payments: pc.payments,
    // Does this facility actually have a drawer wired? The counter used to
    // promise "drawer opens" on every cash sale whether one existed or not,
    // which reads as broken at a facility taking cash with no drawer - and
    // taking cash with no drawer is explicitly supported (maintainer, Sep 1 2026).
    drawer: !!pc.drawer.enabled,
    scheduling: !!(cfg.scheduling && cfg.scheduling.enabled),
    tips_enabled: !!pc.tips.enabled
  });
});

router.get('/group/:bookingId', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const g = checkinSvc.groupView(req.params.bookingId);
    if (!g) return res.status(404).json({ error: 'Booking not found' });
    res.json(g);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ── owner roster CRUD (admin password only) ────────────────────────────────

router.get('/roster', staff.requireAdminOnly, (req, res) => {
  res.json({ staff: staff.roster().map(s => ({ name: s.name, code: s.code, active: s.active !== false, empNumber: String(s.empNumber || '') })) });
});

router.post('/roster', staff.requireAdminOnly, (req, res) => {
  const list = req.body?.staff;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Provide staff: []' });
  const clean = [], was = [];
  const seen = new Set(); const seenEmp = new Set();
  for (const s of list) {
    const name = String(s?.name || '').trim().slice(0, 40);
    const code = String(s?.code || '').trim();
    const empNumber = String(s?.empNumber || '').trim().slice(0, 20);
    if (!name) return res.status(400).json({ error: 'Every staff entry needs a name' });
    if (!/^[0-9]{4,6}$/.test(code)) return res.status(400).json({ error: `Code for ${name} must be 4-6 digits` });
    if (seen.has(code)) return res.status(400).json({ error: 'Codes must be unique' });
    if (empNumber && seenEmp.has(empNumber)) return res.status(400).json({ error: `Employee number ${empNumber} is used twice` });
    seen.add(code); if (empNumber) seenEmp.add(empNumber);
    clean.push({ name, code, active: s.active !== false, empNumber });
    was.push(/^[0-9]{4,6}$/.test(String(s?.was || '')) ? String(s.was) : '');   // the code this row had when the page loaded
  }
  const before = staff.roster().map(s => Object.assign({}, s));
  // the admin page says which row each code came from, and that a row without one is new (Oct 25 2026; services/staff.js codeMoves)
  const opts = { pageRows: req.body?.pageRows === true };
  // who keeps their record is worked out BEFORE anything is saved, so a new code that already holds someone's shifts and hours
  // is refused with nothing written and the owner picks another (Oct 25 2026; services/staff.js codeClashes)
  let moves = [];
  try { moves = staff.codeMoves(before, clean, was, opts); } catch (e) { console.error('[staff] reading a changed code:', e.message); }
  let clash = [];
  try { clash = staff.codeClashes(moves); } catch (e) { console.error('[staff] checking a changed code:', e.message); }
  if (clash.length) {
    return res.status(409).json({ error: clash.map(c => `Code ${c.code} already holds shifts and hours from before, and giving it to ${c.name} would mix ${c.name}'s record with them for good. Give ${c.name} a different code.`).join(' ') + ' Nothing was saved.', clash });
  }
  const cfg = configService.getConfig();
  cfg.server = cfg.server || {};
  cfg.server.staff = clean;
  configService.saveConfig(cfg);
  try { dbMod.adminLog('staff_roster_saved', `${clean.length} entries`); } catch {}
  // someone given a new code keeps their shifts, clock entries, requests and patterns (services/staff.js codeMoves)
  let moved = [];
  try { moved = staff.moveCodes(moves); } catch (e) { console.error('[staff] moving a changed code:', e.message); }
  // and every pad or phone still signed in on a code that changed hands signs in again (Oct 25 2026; services/staff.js handsChanged)
  try { staff.endSessions(staff.handsChanged(before, clean, was, moves, opts)); } catch (e) { console.error('[staff] signing out a changed code:', e.message); }
  res.json({ ok: true, count: clean.length, moved });
});

// ── the Today feed ─────────────────────────────────────────────────────────
// One call answers mock 1's list: every booking today with its payment chip,
// waiver state, check-in state, and the done-means-paid derivation — a group
// is done only when the session is over AND every linked tab sits closed at $0.

function localToday(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}

function localNowMins(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const [h, m] = p.split(':').map(Number);
    return h * 60 + m;
  } catch { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
}

function toMins(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; }

function tabsFor(bookingId) {
  try { return dbMod.db.prepare(`SELECT id, status FROM tabs WHERE booking_id = ?`).all(bookingId); }
  catch { return []; }
}

router.get('/today', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const cfg = configService.getConfig();
    const tz = cfg.server?.timezone;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : localToday(tz);
    const nowM = localNowMins(tz);
    const isToday = date === localToday(tz);
    const grace = Number.isFinite(Number(cfg.pos?.noShowGraceMins)) ? Number(cfg.pos.noShowGraceMins) : 15;

    const rows = dbMod.db.prepare(
      `SELECT id, bay_id, bay_name, name, date, start_time, end_time, end_date,
              duration_minutes, price_cents, status, stripe_payment_intent,
              is_deposit, member_id, member_due_cents, package_name, deal_name, deal_items_json, discount_code_id,
              waiver_id, signature_name, door_used_at
         FROM bookings
        WHERE date = ? AND status = 'active'
        ORDER BY start_time ASC`
    ).all(date);

    const out = rows.map(b => {
      const settle = dbMod.db.prepare(
        `SELECT settled_by, settled_at, actual_golfers FROM settlements WHERE booking_id = ?`
      ).get(b.id);

      const linked = tabsFor(b.id);
      let openTabs = 0, openDueCents = 0;
      for (const t of linked) {
        if (t.status === 'open') {
          openTabs++;
          try { openDueCents += Math.max(0, pos.computeTotals(pos.getTab(t.id)).due_cents || 0); } catch {}
        }
      }

      const startM = toMins(b.start_time), endM = toMins(b.end_time);
      const ended = isToday ? nowM >= endM : true;
      const started = isToday ? nowM >= startM : true;
      const checkedIn = !!settle;

      let state = 'upcoming';
      if (checkedIn && !ended) state = 'in_progress';
      else if (!checkedIn && isToday && started && !ended && nowM > startM + grace) state = 'no_show';
      else if (!checkedIn && started && !ended) state = 'due';
      else if (!checkedIn && !started && isToday && startM - nowM <= 30) state = 'due';
      else if (ended) {
        if (openTabs > 0) state = 'ended_open_tab';
        else if (checkedIn || linked.length > 0) state = 'done';
        else state = 'no_show';
      }

      const payment = b.is_deposit ? 'deposit' : (b.stripe_payment_intent ? 'prepaid' : 'pay_here');
      // Door-settled member reservation (any tier style, Aug 25 late): nothing
      // paid online, the stamp says so. Staff see who and roughly how much.
      const doorDue = (payment === 'pay_here' && b.member_id && b.member_due_cents != null) ? (b.member_due_cents | 0) : null;
      let waiverSigned = !!b.signature_name;
      if (!waiverSigned) {
        // W37: a membership-scope signature keeps its booking in
        // captured_booking_id, so a private `WHERE booking_id = ?` stops seeing
        // a member's signature. Ask the shared helper.
        try { waiverSigned = !!dbMod.getSignedWaiverByBooking(b.id); } catch {}
      }
      // Membership coverage: a member booking with a valid membership waiver
      // is covered — identity-anchored, never a name match.
      if (!waiverSigned && b.member_id) {
        try { waiverSigned = !!require('../services/memberwaiver').memberWaiverStatus(b.member_id).on_file; } catch {}
      }
      // No active waiver in the system = nothing is "needed" (maintainer, Aug 14);
      // facility waiver mode OFF = nothing is needed either (waiver audit, Sep 1 2026)
      if (!waiverSigned) { try { if (!dbMod.getActiveWaiver() || require('../services/memberwaiver').cfgWaiver().mode === 'off') waiverSigned = true; } catch {} }

      return {
        id: b.id, bay_id: b.bay_id, bay_name: b.bay_name, name: b.name,
        date: b.date, start_time: b.start_time, end_time: b.end_time,
        duration_minutes: b.duration_minutes, price_cents: b.price_cents,
        package_name: b.package_name || '', deal_name: b.deal_name || '',
        // free things a deal gave it ("2 Pitchers" - handed over at the desk, $0 on its tabs; Oct 22 2026, night)
        // a code staff check at the door ("a military ID") - Oct 22 2026, night
        door_check: (() => { if (!b.discount_code_id) return ''; try { const c = dbMod.db.prepare(`SELECT code, door_check FROM discount_codes WHERE id=?`).get(b.discount_code_id); return c && c.door_check ? `${c.door_check} (code ${c.code})` : ''; } catch { return ''; } })(),
        deal_items: require('../services/deals').itemsShort(b),
        member_id: b.member_id || null, door_due_cents: doorDue, deposit_cents: b.is_deposit ? (b.price_cents | 0) : 0,
        payment, member: !!b.member_id, waiver_signed: waiverSigned,
        checked_in: checkedIn,
        checked_in_by: settle ? settle.settled_by : null,
        checked_in_at: settle ? settle.settled_at : null,
        arrived_at: b.door_used_at || null,   // the keypad opened the door with this booking's code (UTC, Oct 2026)
        heads: settle ? settle.actual_golfers : null,
        open_tabs: openTabs, open_due_cents: openDueCents,
        state
      };
    });

    const checkinMode = require('../services/pos').posCfg(require('../services/config').getConfig()).checkinMode;
    // W37: the pad's booking list needs to know whether this facility asks for
    // waivers at all before it badges anyone "Waiver needed". Same rule the
    // seat chips already use (services/checkin.checkinContext): mode 'off'
    // means nobody is asked, even though the document and the archive stay.
    let activeWaiver = false;
    try {
      activeWaiver = require('../services/memberwaiver').cfgWaiver().mode !== 'off'
                     && !!dbMod.getActiveWaiver();
    } catch {}
    res.json({ date, now_mins: nowM, grace_mins: grace, checkin_mode: checkinMode, active_waiver: activeWaiver, bookings: out });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── RESTART A BAY (staff): the frozen-simulator fix, without calling the owner
router.post('/bays/:bayId/restart', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const out = await require('../services/shelly').restartBay(req.params.bayId);
    try { dbMod.adminLog('BAY_RESTART', `${req.params.bayId} by ${req.staffName || 'staff'}`); } catch {}
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Could not restart that bay' }); }
});

// ── SPLITTING WITHIN A GROUP (each seat already has its own tab) ───────────
router.post('/seat/:id/name', staff.requireStaffOrAdmin, (req, res) => {
  try { res.json(require('../services/checkin').renameSeat(req.params.id, (req.body || {}).name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/seat/:id/waiver-paper', staff.requireStaffOrAdmin, (req, res) => {
  try { res.json(require('../services/checkin').markWaiverPaper(req.params.id, req.staffName || (req.body || {}).employee || 'staff')); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/group/:id/split', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const v = require('../services/checks').groupSplitView(req.params.id);
    if (!v) return res.status(404).json({ error: 'Group not found' });
    res.json(v);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/items/:itemId/move', staff.requireStaffOrAdmin, (req, res) => {
  try { res.json(require('../services/checks').moveItemToTab(req.params.itemId, (req.body || {}).tab_id, req.staffName)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/items/:itemId/share', staff.requireStaffOrAdmin, (req, res) => {
  try { res.json(require('../services/checks').shareItemAcrossTabs(req.params.itemId, (req.body || {}).tab_ids, req.staffName)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── MODIFY / CANCEL a booking (staff surface) ─────────────────────────────
// Both delegate to services/bookingedit so the door revoke, refund, member
// release, customer notice, and audit stamp can never drift from the owner
// console's behavior.
router.get('/booking/:id/edit-context', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const b = dbMod.db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    const edit = require('../services/bookingedit');
    const cfg = require('../services/config').getConfig();
    res.json({
      booking: { id: b.id, name: b.name, bay_id: b.bay_id, bay_name: b.bay_name, date: b.date,
                 start_time: b.start_time, end_time: b.end_time, duration_minutes: b.duration_minutes,
                 status: b.status, price_cents: b.price_cents, member: !!b.member_id,
                 prepaid: !!b.stripe_payment_intent, is_deposit: !!b.is_deposit },
      window: edit.windowState(b),
      bays: (cfg.bays || []).filter(x => x.active).map(x => ({ id: x.id, name: x.name }))
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/booking/:id/move', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const { date, start_time, duration_minutes, bay_id, reason } = req.body || {};
    const out = await require('../services/bookingedit').moveBooking(req.params.id, {
      date, start_time, duration_minutes, bay_id, reason, actor: req.staffName || 'staff'
    });
    if (out.error) return res.status(out.code || 400).json(out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Could not move the booking' }); }
});

router.post('/booking/:id/cancel', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const { refund_type, reason, override_policy } = req.body || {};
    const out = await require('../services/bookingedit').cancelBooking(req.params.id, {
      refund_type: ['full', 'half', 'none'].includes(refund_type) ? refund_type : 'full',
      reason, override_policy: override_policy === true, actor: req.staffName || 'staff'
    });
    if (out.error) return res.status(out.code || 400).json(out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Could not cancel the booking' }); }
});

// ── bay operations (staff-visible ops console) ─────────────────────────────
// Same services the owner console uses; staff identity stamps the log.

router.get('/baystate', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const cfg = configService.getConfig();
    const { getStatus } = require('../services/shelly');
    const { probePc } = require('../services/simulator');
    const out = [];
    for (const bay of (cfg.bays || []).filter(b => b.active)) {
      const plugDev = (bay.shellyDevices || []).find(d => d.ip);
      const entry = { id: bay.id, name: bay.name, mode: 'manual', plug: null, pc: null };
      if (plugDev) {
        entry.mode = 'smart';
        const st = await getStatus(plugDev.ip, plugDev.gen || 1);
        entry.plug = st.success ? { on: !!st.on, watts: st.watts ?? null } : { on: null, watts: null, unreachable: true };
      }
      if (bay.simulatorPcIp) {
        entry.mode = 'smart';
        entry.pc = { online: await probePc(bay.simulatorPcIp) };
      }
      // the bay's routines a staff member may run (Oct 21 2026, night): each with its colour, and how its
      // last run went - a routine the owner keeps off the pad, or paused, is not offered
      try {
        const RT = require('../services/routines');
        const mine = RT.list(bay.id).filter(r => r.enabled && r.triggers && r.triggers.pad !== false);
        if (mine.length) entry.routines = mine.map(r => ({ id: r.id, name: r.name, color: r.color || '', text: RT.textOn(r.color),
          last: r.last_run_at ? { ok: r.last_ok, detail: r.last_detail } : null }));
      } catch {}
      out.push(entry);
    }
    res.json({ bays: out });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bays/:bayId/:action', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const { bayId, action } = req.params;
    if (!['on', 'off'].includes(action)) return res.status(400).json({ error: 'Use on or off' });

    // EARLY ACCESS (maintainer, Aug 11): powering on a bay that has no session running
    // or starting shortly is a courtesy - "the bay is empty, get them in".
    // The facility decides whether staff may do it. Turning on a bay that DOES
    // have a session now or soon is normal operation (and the recovery path
    // when automation failed), so it is never blocked. Owners are never gated.
    let early = false;
    if (action === 'on' && req.staffAuth !== 'admin') {
      const cfg = require('../services/config').getConfig();
      const live = dbMod.db.prepare(
        `SELECT COUNT(*) c FROM bookings
          WHERE bay_id = ? AND status = 'active'
            AND datetime(date || ' ' || start_time) <= datetime('now', 'localtime', '+30 minutes')
            AND datetime(COALESCE(end_date, date) || ' ' || end_time) >= datetime('now', 'localtime')`
      ).get(bayId);
      early = !(live && live.c > 0);
      if (early && cfg.allowEarlyBayOn === false) {
        return res.status(403).json({
          error: 'This facility does not offer early bay access. The session can start at its booked time.',
          early_access_blocked: true
        });
      }
    }

    // Items 2+3 (pilot facility reliability batch, Aug 17): staff buttons run the TRUE
    // tee-time procedure, not a raw plug toggle. ON was skipping the IR/TV and
    // HA steps (bay "on" but screens dark); OFF was hard-cutting the plug under
    // a running Windows PC. The sequence engine does exactly what a booking
    // does: ON = full session-start set; OFF = graceful PC shutdown, wait for
    // it to go down, then power off only the devices flagged auto-off.
    const seq = require('../services/sequence');
    const results = action === 'on' ? await seq.startBay(bayId, { source: 'staff pad' }) : await seq.stopBay(bayId, { source: 'staff pad' });
    try {
      dbMod.adminLog(early ? 'EARLY_BAY_ON' : 'staff_bay_' + action,
        `${bayId} by ${req.staffName || 'staff'}${early ? ' (early access - no session booked yet)' : ''}`);
    } catch {}
    res.json({ results, early_access: early });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── RUN A BAY ROUTINE (Oct 21 2026, night - the approved mock's "Button on the staff pad"): the bay PC's
// watcher picks it up on its next look (about ten seconds). Staff run only what the owner put on the pad, and not paused;
// the owner signed in here may run any.
router.post('/routines/:id/run', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const RT = require('../services/routines');
    const r = RT.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'No such routine' });
    if (req.staffAuth !== 'admin' && (!r.enabled || (r.triggers || {}).pad === false)) return res.status(403).json({ error: 'That routine is not on the staff pad' });
    const who = String(req.staffName || 'staff').slice(0, 24);
    const got = RT.requestRun(r.id, 'staff pad (' + who + ')', { expires_at: new Date(Date.now() + 15 * 60000).toISOString().replace('T', ' ').slice(0, 19) });
    try { dbMod.adminLog('ROUTINE_ASKED', `${r.name} on ${r.bay_id} by ${who} (staff pad)`); } catch {}
    res.json({ ok: true, already: got.already });
  } catch (e) { res.status(500).json({ error: 'Could not ask the bay PC' }); }
});

router.post('/allbays/:action', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const { action } = req.params;
    if (!['on', 'off'].includes(action)) return res.status(400).json({ error: 'Use on or off' });
    // Item 5 (pilot facility reliability batch, Aug 17): All ON / All OFF are the same
    // booking-grade procedure per bay - never a raw cut of every plug at once.
    const seq = require('../services/sequence');
    const results = await seq.allBays(action === 'on' ? 'start' : 'stop', { source: 'staff pad, all bays' });
    try { dbMod.adminLog('staff_allbays_' + action, `by ${req.staffName || 'staff'}`); } catch {}
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/pc/restart', staff.requireStaffOrAdmin, async (req, res) => {
  try {
    const bayId = req.body?.bayId || req.body?.bay_id;
    const { getBayById, sendRestart } = require('../services/simulator');
    const bay = getBayById(bayId);
    if (!bay) return res.status(404).json({ error: 'Bay not found' });
    if (!bay.simulatorPcIp) return res.status(400).json({ error: 'No PC configured for this bay' });
    const ok = await sendRestart(bay);
    try { dbMod.adminLog('staff_pc_restart', `${bayId} by ${req.staffName || 'staff'}`); } catch {}
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Wave B: per-seat check-in + staff bookings ─────────────────────────────

const checkinSvc = require('../services/checkin');

// checkinMode gate (maintainer ruled Aug 11): 'off' means check-in does not exist at
// all - the booking is simply valid. 'arrival' allows marking arrival but no
// settlement math. 'full' is the complete stepper.
function checkinMode() {
  try { return require('../services/pos').posCfg(require('../services/config').getConfig()).checkinMode || 'full'; }
  catch { return 'full'; }
}
function checkinGate(req, res, next) {
  const m = checkinMode();
  if (m === 'off') return res.status(404).json({ error: 'Check-in is turned off for this facility.' });
  req.checkinMode = m;
  return next();
}

router.get('/checkin/context/:bookingId', staff.requireStaffOrAdmin, checkinGate, (req, res) => {
  try {
    const ctx = checkinSvc.checkinContext(req.params.bookingId);
    if (!ctx) return res.status(404).json({ error: 'Booking not found' });
    res.json(ctx);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/seat-member', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const { pin, booking_id } = req.body || {};
    const b = dbMod.db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(booking_id);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    res.json(checkinSvc.seatMemberInfo(pin, b));
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/checkin', staff.requireStaffOrAdmin, checkinGate, (req, res) => {
  try {
    const out = checkinSvc.performCheckin({
      booking_id: req.body?.booking_id,
      seats: req.body?.seats,
      split_mode: req.body?.split_mode,
      employee: req.staffName || 'Staff',
      ip: req.socket?.remoteAddress || null
    });
    res.status(out.status).json(out.body);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// THE SERVER'S NUMBERS, LIVE (Aug 25, late): the stepper asks for a dry run
// of the exact seats it will submit and paints those amounts. No client math,
// so every tier style (flat, fixed, free hours, blend, share %) previews
// exactly what performCheckin will commit.
router.post('/checkin/preview', staff.requireStaffOrAdmin, checkinGate, (req, res) => {
  try {
    const out = checkinSvc.previewCheckin({ booking_id: req.body?.booking_id, seats: req.body?.seats, split_mode: req.body?.split_mode });
    res.status(out.status).json(out.body);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// live price + availability peek for the staff booking form
// the packages the counter can sell (every one that is on - online or not), as a customer reads them (Oct 22 2026)
router.get('/packages', staff.requireStaffOrAdmin, (req, res) => {
  try { res.json({ packages: require('../services/packages').list().filter(p => p.active).map(p => require('../services/packages').forCustomer(p)) }); }
  catch (e) { res.json({ packages: [] }); }
});
router.get('/quote', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const { bay_id, date, start_time } = req.query;
    const dur = parseInt(req.query.duration_minutes);
    if (!bay_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}$/.test(String(start_time || '')) || !dur)
      return res.status(400).json({ error: 'bay_id, date, start_time, duration_minutes required' });
    // (a booking deal that fits is taken at the counter too - services/deals.js; a package chosen: its own price for its players)
    const dp = require('../services/pricing').dealPrice(date, start_time, dur, bay_id);
    const P = require('../services/packages'), pkgQ = req.query.package_id ? P.get(req.query.package_id) : null;
    const plQ = pkgQ ? P.playersFor(pkgQ, req.query.players) : null;
    const price = pkgQ && plQ && !plQ.error ? P.priceFor(pkgQ, plQ.players) : dp.cents;
    const toM = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const s = toM(start_time), e = s + dur;
    const buffer = configService.getConfig().booking?.bufferMins | 0;
    const clash = dbMod.db.prepare(
      `SELECT name, start_time, end_time FROM bookings WHERE date=? AND bay_id=? AND status='active'`
    ).all(date, bay_id).find(r => s < (toM(r.end_time) + buffer) && (toM(r.start_time) - buffer) < e) || null;
    res.json({ price_cents: price, conflict: clash, package_error: pkgQ ? ((plQ && plQ.error) || (P.availableAt(pkgQ, date, start_time).ok ? null : P.availableAt(pkgQ, date, start_time).why)) : undefined, deal: pkgQ ? null : dp.deal ? { name: dp.deal.name, cents: dp.deal.cents, words: dp.deal.words } : null, original_cents: dp.deal ? dp.publicCents : undefined });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/bookings', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const out = checkinSvc.staffCreateBooking({
      bay_id: req.body?.bay_id,
      date: req.body?.date,
      start_time: req.body?.start_time,
      duration_minutes: req.body?.duration_minutes,
      name: req.body?.name,
      phone: req.body?.phone,
      email: req.body?.email,
      sms_consent: !!req.body?.sms_consent,
      employee: req.staffName || 'Staff',
      package_id: req.body?.package_id || null, players: req.body?.players
    });
    // The customer path answers { bookingId }; this one answered
    // { booking: { id } } and nothing else (bench finding F4). Callers keep
    // the booking object; bookingId rides alongside so both creation paths
    // can be read the same way.
    if (out.status === 200 && out.body && out.body.booking && !out.body.bookingId) {
      out.body.bookingId = out.body.booking.id;
    }
    res.status(out.status).json(out.body);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/bookings/:id/extend', staff.requireStaffOrAdmin, (req, res) => {
  try {
    const out = checkinSvc.extendBooking({
      booking_id: req.params.id,
      minutes: req.body?.minutes,
      tab_id: req.body?.tab_id || null,
      // who pays for the extra time: 'even' splits it across the group's
      // checks, or name the specific check(s) that cover it
      pay_split: req.body?.pay_split || null,
      pay_checks: req.body?.pay_checks || null,
      // which PEOPLE cover the extra time (per-seat tabs)
      pay_tabs: req.body?.pay_tabs || null,
      employee: req.staffName || 'Staff'
    });
    res.status(out.status).json(out.body);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});


// ═══════════════════════════════════════════════════════════════════════════
//  EMPLOYEES: SCHEDULING & TIME CLOCK (Sep 2026)
// ═══════════════════════════════════════════════════════════════════════════
// An hours-and-schedule tool. Not payroll, not benefits, not compliance
// (CLAUDE.md rule 12): user-visible words are "hours" and "hours period", the
// export is neutral CSV for the facility's own payroll provider, and break
// thresholds are the facility's configured policy shown as arithmetic.
// Everything is gated on cfg.scheduling.enabled - the owner's choice, on by
// default for staffed and hybrid facilities out of the wizard.
const tc = require('../services/timeclock');
const staffingSvc = require('../services/staffing');
const hoursSend = require('../services/hourssend');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^\d{2}:\d{2}$/;
const nowLocal = () => tc.localStamp();
// sql.js: the wrapper's save() exports (closes + reopens) the connection on
// every run(), so last_insert_rowid() is 0 afterwards. Single process,
// sequential writes: MAX(id) is the row we just wrote.
const lastId = table => Number((dbMod.db.prepare(`SELECT MAX(id) AS id FROM ${table}`).get() || {}).id) || null;

function schedulingEnabled() { const c = configService.getConfig(); return !!(c.scheduling && c.scheduling.enabled); }
function requireScheduling(req, res, next) {
  if (!schedulingEnabled()) return res.status(404).json({ error: 'Employee scheduling is turned off for this facility (Settings > Staff > The Counter).' });
  next();
}
// Staff-facing clock actions need a real PERSON: a staff token with a code.
// An admin cookie has no code, so it cannot clock anyone in.
function requireClockPerson(req, res, next) {
  if (req.staffAuth !== 'staff' || !req.staffCode) return res.status(403).json({ error: 'Sign in with your staff code to use the clock.' });
  next();
}
function rosterByCode(code) { return staff.roster().find(s => String(s.code) === String(code)) || null; }
function activeRoster() {
  return staff.roster().filter(s => s && s.active !== false).map(s => ({ name: s.name, code: String(s.code), empNumber: String(s.empNumber || '') }));
}
function schedCfg() { const c = configService.getConfig(); return Object.assign({ hoursPeriod: 'weekly', anchorDate: '', semiMonthlyDays: [1, 16], breaks: {} }, c.scheduling || {}); }
function saveSched(mut) { const c = configService.getConfig(); c.scheduling = Object.assign({}, c.scheduling); mut(c); configService.saveConfig(c); return c; }

// ── HOURS & EXPORT (owner) ─────────────────────────────────────────────────
router.get('/hours/config', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const s = schedCfg();
  res.json({ period: s.hoursPeriod, anchorDate: s.anchorDate || '', semiMonthlyDays: s.semiMonthlyDays || [1, 16], breaks: s.breaks || {}, staffedLabel: s.staffedLabel || 'Staffed hours' });
});
router.post('/hours/config', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { period, anchorDate, semiMonthlyDays, breaks, staffedLabel } = req.body || {};
  if (period !== undefined && !tc.PERIODS.includes(period)) return res.status(400).json({ error: 'period must be weekly, biweekly, semimonthly or monthly' });
  if (anchorDate !== undefined && anchorDate !== '' && !DATE_RE.test(anchorDate)) return res.status(400).json({ error: 'anchorDate must be YYYY-MM-DD' });
  let smd;
  if (semiMonthlyDays !== undefined) {
    smd = Array.isArray(semiMonthlyDays) ? semiMonthlyDays.map(n => parseInt(n, 10)) : null;
    if (!smd || smd.length !== 2 || smd.some(n => !(n >= 1 && n <= 28)) || smd[0] === smd[1]) return res.status(400).json({ error: 'semiMonthlyDays must be two different days 1-28' });
    smd.sort((a, b) => a - b);
  }
  saveSched(c => {
    if (period !== undefined) c.scheduling.hoursPeriod = period;
    if (anchorDate !== undefined) c.scheduling.anchorDate = anchorDate;
    if (smd) c.scheduling.semiMonthlyDays = smd;
    if (breaks && typeof breaks === 'object') c.scheduling.breaks = {
      restEveryHours: Math.max(0, Number(breaks.restEveryHours) || 0),
      mealAfterHours: Math.max(0, Number(breaks.mealAfterHours) || 0),
      mealPaid: !!breaks.mealPaid };
    if (staffedLabel !== undefined) c.scheduling.staffedLabel = String(staffedLabel || '').trim().slice(0, 40) || 'Staffed hours';
  });
  dbMod.adminLog('HOURS_CONFIG_SAVED', `${schedCfg().hoursPeriod}`);
  res.json({ ok: true });
});
router.get('/hours/period-bounds', staff.requireAdminOnly, requireScheduling, (req, res) => {
  res.json(tc.periodBounds(configService.getConfig(), tc.localToday()));
});
// CSV. Neutral columns, a footer that travels with the file. No money.
// W29: built by services/hourssend.buildExport - the ONE builder the
// scheduled email uses too, so the attachment is these bytes exactly.
router.get('/hours/export', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { start, end } = req.query;
  if (!DATE_RE.test(String(start || '')) || !DATE_RE.test(String(end || '')) || end < start) return res.status(400).json({ error: 'start and end must be YYYY-MM-DD, end on or after start' });
  const ex = hoursSend.buildExport(start, end);
  dbMod.adminLog('HOURS_EXPORTED', `${start} to ${end}, ${ex.people.length} people`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${ex.filename}"`);
  res.send(ex.csv);
});

// ── SEND THE HOURS EXPORT (owner) - W29, Sep 3 2026 ────────────────────────
// The card under Hours & Export. Owner only (manager refused by requireOwner).
router.get('/hours/send', staff.requireAdminOnly, requireScheduling, (req, res) => {
  try { res.json(hoursSend.status()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/hours/send/config', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const r = hoursSend.saveSendCfg(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(Object.assign({ ok: true }, hoursSend.status()));
});
router.post('/hours/send/now', staff.requireAdminOnly, requireScheduling, async (req, res) => {
  try { const r = await hoursSend.sendNow(); res.status(r.ok ? 200 : 409).json(Object.assign(r, hoursSend.status())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/hours/send/resend', staff.requireAdminOnly, requireScheduling, async (req, res) => {
  try { const r = await hoursSend.resendLast(); res.status(r.error ? (r.status || 409) : (r.ok ? 200 : 409)).json(Object.assign(r, hoursSend.status())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/hours/send/approve', staff.requireAdminOnly, requireScheduling, async (req, res) => {
  try { const r = await hoursSend.approve(req.body?.id ?? req.body?.token, 'owner'); res.status(r.error ? (r.status || 409) : (r.ok ? 200 : 409)).json(Object.assign(r, hoursSend.status())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/hours/send/skip', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const r = hoursSend.skip(req.body?.id, 'owner');
  res.status(r.error ? (r.status || 409) : 200).json(Object.assign(r, hoursSend.status()));
});
// The review link: /admin?hours-review=TOKEN - the token only says WHICH held
// period to show; the owner cookie is what authorises (no new public page).
router.get('/hours/send/review', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const row = hoursSend.rowByToken(String(req.query.token || ''));
  if (!row) return res.status(404).json({ error: 'That review link has been used or has expired' });
  res.json(Object.assign({ ok: true, row: hoursSend.pub(row) }, hoursSend.status()));
});

// ── THE CLOCK (staff, on the pad) ──────────────────────────────────────────
function clockStatusFor(code) {
  const cfg = configService.getConfig();
  const today = tc.localToday();
  const open = tc.openEntryFor(code);
  const b = tc.periodBounds(cfg, today);
  const todayMinutes = tc.minutesForRange(code, today, today) + (open ? tc.minutesBetweenMs(open.clock_in_ms || Date.now(), Date.now()) : 0);
  const periodMinutes = tc.minutesForRange(code, b.thisStart, b.thisEnd) + (open ? tc.minutesBetweenMs(open.clock_in_ms || Date.now(), Date.now()) : 0);
  const br = (cfg.scheduling && cfg.scheduling.breaks) || {};
  const openHours = open ? tc.minutesBetweenMs(open.clock_in_ms || Date.now(), Date.now()) / 60 : 0;
  // arithmetic on the facility's own policy - never a statement of law
  const policy = [];
  if (open && br.mealAfterHours > 0 && openHours >= br.mealAfterHours) policy.push(`${openHours.toFixed(1)} hrs - meal break due per facility policy`);
  else if (open && br.restEveryHours > 0 && openHours >= br.restEveryHours) policy.push(`${openHours.toFixed(1)} hrs - rest break due per facility policy`);
  return { open: open ? { id: open.id, clock_in: open.clock_in, clock_in_ms: open.clock_in_ms, break_minutes: open.break_minutes || 0, fromEarlierDay: String(open.clock_in).slice(0, 10) < today } : null,
    todayMinutes, periodMinutes, periodStart: b.thisStart, periodEnd: b.thisEnd, period: b.period, policy };
}
router.get('/clock/status', staff.requireStaffOrAdmin, requireScheduling, requireClockPerson, (req, res) => {
  try { res.json(clockStatusFor(req.staffCode)); } catch (e) { res.status(500).json({ error: 'Clock unavailable' }); }
});
router.post('/clock/in', staff.requireStaffOrAdmin, requireScheduling, requireClockPerson, (req, res) => {
  if (tc.openEntryFor(req.staffCode)) return res.status(409).json({ error: 'You are already clocked in.' });
  const now = Date.now();
  dbMod.db.prepare(`INSERT INTO time_entries (staff_code, staff_name, clock_in, clock_in_ms, source) VALUES (?,?,?,?,'self')`)
    .run(req.staffCode, req.staffName, tc.localStamp(now), now);
  dbMod.adminLog('CLOCK_IN', req.staffName);
  res.json(Object.assign({ ok: true }, clockStatusFor(req.staffCode)));
});
router.post('/clock/out', staff.requireStaffOrAdmin, requireScheduling, requireClockPerson, (req, res) => {
  const open = tc.openEntryFor(req.staffCode);
  if (!open) return res.status(409).json({ error: 'You are not clocked in.' });
  const now = Date.now();
  const worked = Math.max(0, tc.minutesBetweenMs(open.clock_in_ms || now, now) - (open.break_minutes || 0));
  dbMod.db.prepare(`UPDATE time_entries SET clock_out = ?, clock_out_ms = ?, worked_minutes = ? WHERE id = ?`).run(tc.localStamp(now), now, worked, open.id);
  dbMod.adminLog('CLOCK_OUT', `${req.staffName} ${worked} min`);
  res.json(Object.assign({ ok: true, worked_minutes: worked }, clockStatusFor(req.staffCode)));
});
// Break minutes on the open entry (facility policy is the facility's; this just records).
router.post('/clock/break', staff.requireStaffOrAdmin, requireScheduling, requireClockPerson, (req, res) => {
  const open = tc.openEntryFor(req.staffCode);
  if (!open) return res.status(409).json({ error: 'You are not clocked in.' });
  const m = parseInt(req.body?.minutes, 10);
  if (!(m >= 1 && m <= 240)) return res.status(400).json({ error: 'Break minutes must be 1-240' });
  dbMod.db.prepare(`UPDATE time_entries SET break_minutes = COALESCE(break_minutes,0) + ? WHERE id = ?`).run(m, open.id);
  res.json(Object.assign({ ok: true }, clockStatusFor(req.staffCode)));
});
// "I forgot to clock out": the employee supplies the time they actually left,
// applied to the clock-in's own date. Always flagged for the owner to review.
router.post('/clock/adjust', staff.requireStaffOrAdmin, requireScheduling, requireClockPerson, (req, res) => {
  const open = tc.openEntryFor(req.staffCode);
  if (!open) return res.status(409).json({ error: 'Nothing to fix - you are not clocked in.' });
  const t = String(req.body?.time || '').trim();
  if (!TIME_RE.test(t)) return res.status(400).json({ error: 'Give the time you left as HH:MM' });
  const outStamp = String(open.clock_in).slice(0, 10) + ' ' + t + ':00';
  if (outStamp > nowLocal()) return res.status(400).json({ error: 'That time is in the future.' });
  if (outStamp <= open.clock_in) return res.status(400).json({ error: 'That is before you clocked in.' });
  const worked = Math.max(0, tc.minutesBetweenStamps(open.clock_in, outStamp) - (open.break_minutes || 0));
  dbMod.db.prepare(`UPDATE time_entries SET clock_out = ?, clock_out_ms = NULL, worked_minutes = ?, flagged = 1, reviewed = 0,
    flag_reason = ?, source = 'self' WHERE id = ?`).run(outStamp, worked, 'Forgot to clock out - time entered by employee', open.id);
  dbMod.adminLog('CLOCK_ADJUSTED', `${req.staffName} out ${t} (flagged)`);
  res.json(Object.assign({ ok: true, worked_minutes: worked, flagged: true }, clockStatusFor(req.staffCode)));
});
// Admin side of the clock
router.get('/clock/entries', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { start, end } = req.query;
  if (!DATE_RE.test(String(start || '')) || !DATE_RE.test(String(end || ''))) return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
  const rows = dbMod.db.prepare(`SELECT * FROM time_entries WHERE date(clock_in) BETWEEN ? AND ? ORDER BY clock_in DESC`).all(start, end);
  const flaggedOpen = (dbMod.db.prepare(`SELECT COUNT(*) AS c FROM time_entries WHERE flagged = 1 AND reviewed = 0`).get() || {}).c || 0;
  res.json({ entries: rows.map(r => Object.assign({}, r, { display_name: (rosterByCode(r.staff_code) || {}).name || r.staff_name })), flaggedOpen });
});
router.post('/clock/entry/:id', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const row = dbMod.db.prepare(`SELECT * FROM time_entries WHERE id = ?`).get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  const ci = req.body?.clock_in !== undefined ? String(req.body.clock_in) : row.clock_in;
  const co = req.body?.clock_out !== undefined ? (req.body.clock_out ? String(req.body.clock_out) : null) : row.clock_out;
  const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;
  if (!STAMP.test(ci) || (co && !STAMP.test(co))) return res.status(400).json({ error: 'Times must be YYYY-MM-DD HH:MM' });
  if (co && co <= ci) return res.status(400).json({ error: 'Clock-out must be after clock-in' });
  const brk = req.body?.break_minutes !== undefined ? Math.max(0, parseInt(req.body.break_minutes, 10) || 0) : (row.break_minutes || 0);
  const worked = co ? Math.max(0, tc.minutesBetweenStamps(ci, co) - brk) : null;
  dbMod.db.prepare(`UPDATE time_entries SET clock_in = ?, clock_out = ?, clock_in_ms = NULL, clock_out_ms = NULL, worked_minutes = ?, break_minutes = ?,
    note = ?, edited_by = ?, edited_at = ?, reviewed = 1, reviewed_by = ?, source = 'admin' WHERE id = ?`)
    .run(ci.length === 16 ? ci + ':00' : ci, co ? (co.length === 16 ? co + ':00' : co) : null, worked, brk,
      String(req.body?.note ?? row.note ?? '').slice(0, 200), 'Owner', nowLocal(), 'Owner', row.id);
  dbMod.adminLog('CLOCK_ENTRY_EDITED', `#${row.id} ${row.staff_name}`);
  res.json({ ok: true, worked_minutes: worked });
});
router.post('/clock/entry/:id/review', staff.requireAdminOnly, requireScheduling, (req, res) => {
  dbMod.db.prepare(`UPDATE time_entries SET reviewed = 1, reviewed_by = 'Owner' WHERE id = ?`).run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});
router.post('/clock/entry/:id/out-now', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const row = dbMod.db.prepare(`SELECT * FROM time_entries WHERE id = ? AND clock_out IS NULL`).get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'No open entry with that id' });
  const now = Date.now();
  const worked = Math.max(0, (row.clock_in_ms ? tc.minutesBetweenMs(row.clock_in_ms, now) : tc.minutesBetweenStamps(row.clock_in, tc.localStamp(now))) - (row.break_minutes || 0));
  dbMod.db.prepare(`UPDATE time_entries SET clock_out = ?, clock_out_ms = ?, worked_minutes = ?, edited_by = 'Owner', edited_at = ?, source = 'admin' WHERE id = ?`)
    .run(tc.localStamp(now), now, worked, nowLocal(), row.id);
  dbMod.adminLog('CLOCK_OUT_BY_OWNER', `${row.staff_name} ${worked} min`);
  res.json({ ok: true, worked_minutes: worked });
});
router.delete('/clock/entry/:id', staff.requireAdminOnly, requireScheduling, (req, res) => {
  dbMod.db.prepare(`DELETE FROM time_entries WHERE id = ?`).run(parseInt(req.params.id, 10));
  dbMod.adminLog('CLOCK_ENTRY_DELETED', `#${req.params.id}`);
  res.json({ ok: true });
});

// ── COVERAGE GAPS (W2, maintainer's walk-through) ──────────────────────────────────
// The block is the unit an owner thinks in: "Open has nobody". For a date,
// every season block inside that day's staffed window is graded full /
// partial / none against the ASSIGNED shifts (open shifts do not cover
// anything), with the uncovered ranges spelled out; staffed minutes outside
// any block with nobody at all are reported as 'no one'. This is an OWNER
// warning only - the staffing law still counts the hours as staffed.
const tm = t => { if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return (h === 23 && m === 59) ? 1440 : h * 60 + m; };
const mt = m => m >= 1440 ? '23:59' : `${p2n(Math.floor(m / 60))}:${p2n(m % 60)}`;
const p2n = n => String(n).padStart(2, '0');
function subtractRanges(range, cuts) {
  // range [s,e] minus a list of [s,e] -> remaining [s,e] pieces
  let pieces = [range.slice()];
  for (const [cs, ce] of cuts) {
    const next = [];
    for (const [s, e] of pieces) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    pieces = next;
  }
  return pieces.filter(([s, e]) => e - s >= 15);
}
function blockAppliesOn(b, date) {
  // a block with no days set applies every day (older seasons)
  if (!Array.isArray(b.days) || !b.days.length) return true;
  return b.days.map(Number).includes(staffingSvc.dowMon0(date));
}
function coverageGaps(date) {
  const win = staffingSvc.effectiveWindow(date);
  if (!win) return { blocks: [], uncovered: 0, outside: [] };
  // Clamp "want staffed" to the facility's OPENING hours for gap purposes:
  // an all-day season at a place that opens at 10 must not read "no one
  // midnight-10am". (24-hour and after-midnight closes keep the full day.)
  const bk = require('../services/hours').on(configService.getConfig().booking, date);   // (that day's own hours, if it has them)
  const openM = (!bk.open24Hours && TIME_RE.test(String(bk.openTime || ''))) ? tm(bk.openTime) : 0;
  const closeM = (!bk.open24Hours && !bk.closeNextDay && TIME_RE.test(String(bk.closeTime || '')) && bk.closeTime !== '00:00') ? tm(bk.closeTime) : 1440;
  const ws = Math.max(win.whole ? 0 : tm(win.start), openM), we = Math.min(win.whole ? 1440 : tm(win.end), closeM);
  if (we - ws < 15) return { blocks: [], uncovered: 0, outside: [] };
  const season = staffingSvc.activeSeason();
  const assigned = dbMod.db.prepare(`SELECT start_time, end_time, staff_code FROM shifts WHERE date = ? AND staff_code IS NOT NULL AND staff_code != ''`).all(date)
    .map(s => ({ s: tm(s.start_time), e: tm(s.end_time), who: (rosterByCode(s.staff_code) || {}).name || s.staff_code }));
  const cuts = assigned.map(a => [a.s, a.e]);
  const blocks = [];
  for (const b of ((season && season.blocks) || []).filter(b => blockAppliesOn(b, date))) {
    const bs = Math.max(tm(b.start), ws), be = Math.min(tm(b.end), we);
    if (be - bs < 15) continue;                       // block falls outside today's window
    const left = subtractRanges([bs, be], cuts);
    const missing = left.reduce((a, [s, e]) => a + (e - s), 0);
    const who = [...new Set(assigned.filter(a => a.s < be && a.e > bs).map(a => a.who))];
    blocks.push({ name: b.name, start: mt(bs), end: mt(be), status: missing === 0 ? 'full' : (missing >= be - bs ? 'none' : 'partial'),
      who, uncovered: left.map(([s, e]) => [mt(s), mt(e)]) });
  }
  // staffed minutes that no block claims and nobody is on
  const blockCuts = ((season && season.blocks) || []).filter(b => blockAppliesOn(b, date)).map(b => [Math.max(tm(b.start), ws), Math.min(tm(b.end), we)]).filter(([s, e]) => e > s);
  const outside = subtractRanges([ws, we], blockCuts.concat(cuts)).map(([s, e]) => [mt(s), mt(e)]);
  return { blocks, uncovered: blocks.filter(b => b.status !== 'full').length + (outside.length ? 1 : 0), outside };
}

// ── THE SCHEDULE (owner) ───────────────────────────────────────────────────
function shiftRow(id) { return dbMod.db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(Number(id)) || null; }
function denyPendingOnShift(shiftId, by) {
  dbMod.db.prepare(`UPDATE shift_requests SET status = 'denied', decided_by = ?, decided_at = ? WHERE shift_id = ? AND status = 'pending'`).run(by, nowLocal(), Number(shiftId));
}
router.get('/schedule', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { start, end } = req.query;
  if (!DATE_RE.test(String(start || '')) || !DATE_RE.test(String(end || '')) || end < start || tc.daysBetween(start, end) > 62) return res.status(400).json({ error: 'start/end must be YYYY-MM-DD, at most 62 days' });
  const shifts = dbMod.db.prepare(`SELECT * FROM shifts WHERE date BETWEEN ? AND ? ORDER BY date, start_time, id`).all(start, end);
  const timeoff = dbMod.db.prepare(`SELECT * FROM timeoff_requests WHERE status IN ('approved','pending') AND NOT (end_date < ? OR start_date > ?) ORDER BY start_date`).all(start, end);
  const pendingReq = dbMod.db.prepare(`SELECT r.*, s.date, s.start_time, s.end_time, s.label, s.staff_code AS shift_staff_code FROM shift_requests r JOIN shifts s ON s.id = r.shift_id WHERE r.status = 'pending' ORDER BY r.created_at`).all();
  const pendingTimeoff = dbMod.db.prepare(`SELECT * FROM timeoff_requests WHERE status = 'pending' ORDER BY created_at`).all();
  const coverage = {}, gaps = {}; let uncoveredCount = 0;
  for (let d = start; d <= end; d = tc.addDays(d, 1)) { coverage[d] = staffingSvc.effectiveWindow(d); gaps[d] = coverageGaps(d); uncoveredCount += gaps[d].uncovered; }
  const covExceptions = dbMod.db.prepare(`SELECT * FROM coverage_exceptions WHERE date BETWEEN ? AND ? ORDER BY date`).all(start, end);
  const cfg = configService.getConfig();
  res.json({ shifts, timeoff, pendingReq, pendingTimeoff, coverage, gaps, uncoveredCount, covExceptions,
    scheduleOff: !!(cfg.coverage && cfg.coverage.scheduleOff), season: staffingSvc.activeSeason(), roster: activeRoster(),
    staffedLabel: schedCfg().staffedLabel || 'Staffed hours' });
});
function validShift(b, partial) {
  if (!partial || b.date !== undefined) { if (!DATE_RE.test(String(b.date || ''))) return 'date must be YYYY-MM-DD'; }
  if (!partial || b.start_time !== undefined) { if (!TIME_RE.test(String(b.start_time || ''))) return 'start_time must be HH:MM'; }
  if (!partial || b.end_time !== undefined) { if (!TIME_RE.test(String(b.end_time || ''))) return 'end_time must be HH:MM'; }
  if (b.staff_code !== undefined && b.staff_code !== null && b.staff_code !== '') { if (!rosterByCode(b.staff_code)) return 'That staff code is not on the roster'; }
  return null;
}
router.post('/schedule/shift', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const b = req.body || {};
  const err = validShift(b, false); if (err) return res.status(400).json({ error: err });
  if (b.end_time <= b.start_time) return res.status(400).json({ error: 'end_time must be after start_time' });
  const code = b.staff_code ? String(b.staff_code) : null;
  dbMod.db.prepare(`INSERT INTO shifts (date, start_time, end_time, staff_code, label, note) VALUES (?,?,?,?,?,?)`)
    .run(b.date, b.start_time, b.end_time, code, String(b.label || '').slice(0, 40), String(b.note || '').slice(0, 200));
  const id = lastId('shifts');
  dbMod.adminLog('SHIFT_ADDED', `${b.date} ${b.start_time}-${b.end_time} ${code ? (rosterByCode(code) || {}).name : 'OPEN'}`);
  res.json({ ok: true, shift: shiftRow(id) });
});
router.post('/schedule/shift/:id', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const row = shiftRow(req.params.id); if (!row) return res.status(404).json({ error: 'Shift not found' });
  const b = req.body || {};
  const err = validShift(b, true); if (err) return res.status(400).json({ error: err });
  const nx = { date: b.date ?? row.date, start_time: b.start_time ?? row.start_time, end_time: b.end_time ?? row.end_time,
    staff_code: b.staff_code === undefined ? row.staff_code : (b.staff_code ? String(b.staff_code) : null),
    label: b.label === undefined ? row.label : String(b.label || '').slice(0, 40), note: b.note === undefined ? row.note : String(b.note || '').slice(0, 200) };
  if (nx.end_time <= nx.start_time) return res.status(400).json({ error: 'end_time must be after start_time' });
  dbMod.db.prepare(`UPDATE shifts SET date=?, start_time=?, end_time=?, staff_code=?, label=?, note=? WHERE id=?`).run(nx.date, nx.start_time, nx.end_time, nx.staff_code, nx.label, nx.note, row.id);
  dbMod.adminLog('SHIFT_EDITED', `#${row.id}`);
  res.json({ ok: true, shift: shiftRow(row.id) });
});
router.delete('/schedule/shift/:id', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const row = shiftRow(req.params.id); if (!row) return res.status(404).json({ error: 'Shift not found' });
  denyPendingOnShift(row.id, 'Admin (shift removed)');
  dbMod.db.prepare(`DELETE FROM shifts WHERE id = ?`).run(row.id);
  dbMod.adminLog('SHIFT_DELETED', `#${row.id} ${row.date}`);
  res.json({ ok: true });
});
router.post('/schedule/copy-week', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { from, to } = req.body || {};
  if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD (Mondays)' });
  const f = tc.mondayOf(from), t = tc.mondayOf(to); const shift = tc.daysBetween(f, t);
  const rows = dbMod.db.prepare(`SELECT * FROM shifts WHERE date BETWEEN ? AND ?`).all(f, tc.addDays(f, 6));
  // W26 (Sep 2 2026): copying is idempotent like applying a pattern - a shift
  // already on the target day at those times for that person is not laid
  // down twice (a second tap used to double every shift).
  let n = 0, skipped = 0;
  for (const r of rows) {
    const date = tc.addDays(r.date, shift);
    const dup = dbMod.db.prepare(`SELECT id FROM shifts WHERE date = ? AND start_time = ? AND end_time = ? AND COALESCE(staff_code,'') = COALESCE(?,'') AND COALESCE(label,'') = COALESCE(?,'')`).get(date, r.start_time, r.end_time, r.staff_code, r.label);
    if (dup) { skipped++; continue; }
    dbMod.db.prepare(`INSERT INTO shifts (date, start_time, end_time, staff_code, label, note) VALUES (?,?,?,?,?,?)`)
      .run(date, r.start_time, r.end_time, r.staff_code, r.label, r.note); n++;
  }
  dbMod.adminLog('WEEK_COPIED', `${f} -> ${t} (${n} shifts${skipped ? `, ${skipped} already there` : ''})`);
  res.json({ ok: true, copied: n, skipped, weekStart: t });
});
// Staffing patterns: capture a week (dow = offset from that Monday), apply later.
router.get('/schedule/templates', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const rows = dbMod.db.prepare(`SELECT * FROM shift_templates ORDER BY name`).all();
  res.json({ templates: rows.map(r => { let p = []; try { p = JSON.parse(r.payload); } catch {} return { id: r.id, name: r.name, shifts: p }; }) });
});
router.post('/schedule/templates', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { name, weekStart } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name the pattern' });
  if (!DATE_RE.test(String(weekStart || ''))) return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD' });
  const m = tc.mondayOf(weekStart);
  const rows = dbMod.db.prepare(`SELECT * FROM shifts WHERE date BETWEEN ? AND ?`).all(m, tc.addDays(m, 6));
  const payload = rows.map(r => ({ dow: tc.daysBetween(m, r.date), start: r.start_time, end: r.end_time, staff_code: r.staff_code, label: r.label }));
  dbMod.db.prepare(`INSERT INTO shift_templates (name, payload) VALUES (?,?)`).run(String(name).trim().slice(0, 40), JSON.stringify(payload));
  const id = lastId('shift_templates');
  res.json({ ok: true, id, shifts: payload.length });
});
router.post('/schedule/templates/:id/apply', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const row = dbMod.db.prepare(`SELECT * FROM shift_templates WHERE id = ?`).get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Pattern not found' });
  const ws = req.body?.weekStart; if (!DATE_RE.test(String(ws || ''))) return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD' });
  const m = tc.mondayOf(ws); let p = []; try { p = JSON.parse(row.payload); } catch {}
  // W25 (Sep 2 2026): applying is idempotent - a shift already on that day at
  // those times for that person is not laid down twice (a double tap, or a
  // pattern applied to the very week it was saved from, used to duplicate).
  let n = 0, skipped = 0;
  for (const s of p) {
    // people leave, or are switched off on the roster (Oct 20 2026 - an inactive person's shifts came back under their name);
    // either way their shifts come back open
    const who = s.staff_code ? rosterByCode(s.staff_code) : null;
    const code = who && who.active !== false ? String(s.staff_code) : null;
    const date = tc.addDays(m, Number(s.dow) || 0);
    const dup = dbMod.db.prepare(`SELECT id FROM shifts WHERE date = ? AND start_time = ? AND end_time = ? AND COALESCE(staff_code,'') = COALESCE(?,'') AND COALESCE(label,'') = ?`).get(date, s.start, s.end, code, s.label || '');
    if (dup) { skipped++; continue; }
    dbMod.db.prepare(`INSERT INTO shifts (date, start_time, end_time, staff_code, label) VALUES (?,?,?,?,?)`).run(date, s.start, s.end, code, s.label || ''); n++;
  }
  dbMod.adminLog('PATTERN_APPLIED', `${row.name} -> ${m} (${n} shifts${skipped ? `, ${skipped} already there` : ''})`);
  res.json({ ok: true, applied: n, skipped, weekStart: m });
});
router.delete('/schedule/templates/:id', staff.requireAdminOnly, requireScheduling, (req, res) => {
  dbMod.db.prepare(`DELETE FROM shift_templates WHERE id = ?`).run(parseInt(req.params.id, 10)); res.json({ ok: true });
});
// Decisions. Every employee action is a request; only the owner changes the schedule.
router.post('/timeoff/:id/decide', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const row = dbMod.db.prepare(`SELECT * FROM timeoff_requests WHERE id = ?`).get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Already decided' });
  const approve = !!req.body?.approve;
  dbMod.db.prepare(`UPDATE timeoff_requests SET status = ?, decided_by = 'Owner', decided_at = ? WHERE id = ?`).run(approve ? 'approved' : 'denied', nowLocal(), row.id);
  dbMod.adminLog(approve ? 'TIMEOFF_APPROVED' : 'TIMEOFF_DENIED', `${row.staff_name} ${row.start_date}..${row.end_date}`);
  res.json({ ok: true, status: approve ? 'approved' : 'denied' });
});
router.post('/shift-request/:id/decide', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const r = dbMod.db.prepare(`SELECT * FROM shift_requests WHERE id = ?`).get(parseInt(req.params.id, 10));
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'Already decided' });
  const sh = shiftRow(r.shift_id);
  const approve = !!req.body?.approve;
  if (approve) {
    if (!sh) return res.status(409).json({ error: 'That shift no longer exists' });
    if (r.kind === 'claim') {
      if (sh.staff_code) return res.status(409).json({ error: 'That shift is no longer open' });
      dbMod.db.prepare(`UPDATE shifts SET staff_code = ? WHERE id = ?`).run(r.staff_code, sh.id);
      // rivals lose, automatically, with a reason on the record
      dbMod.db.prepare(`UPDATE shift_requests SET status = 'denied', decided_by = 'Admin (given to someone else)', decided_at = ? WHERE shift_id = ? AND kind = 'claim' AND status = 'pending' AND id != ?`).run(nowLocal(), sh.id, r.id);
    } else if (r.kind === 'drop') {
      if (String(sh.staff_code || '') !== String(r.staff_code)) return res.status(409).json({ error: 'That shift no longer belongs to this person' });
      dbMod.db.prepare(`UPDATE shifts SET staff_code = NULL WHERE id = ?`).run(sh.id);   // reopened, visible hole
    }
  }
  dbMod.db.prepare(`UPDATE shift_requests SET status = ?, decided_by = 'Owner', decided_at = ? WHERE id = ?`).run(approve ? 'approved' : 'denied', nowLocal(), r.id);
  dbMod.adminLog(`SHIFT_${r.kind.toUpperCase()}_${approve ? 'APPROVED' : 'DENIED'}`, `${r.staff_name} shift #${r.shift_id}`);
  res.json({ ok: true, status: approve ? 'approved' : 'denied', shift: shiftRow(r.shift_id) });
});

// ── COVERAGE: seasons, exceptions, the master switch (owner) ───────────────
function parseSeason(row) { let d = [], b = []; try { d = JSON.parse(row.payload || '[]'); } catch {} try { b = JSON.parse(row.shifts || '[]'); } catch {} return { id: row.id, name: row.name, days: d, blocks: b, created_at: row.created_at }; }
router.get('/coverage', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const cfg = configService.getConfig();
  const rows = dbMod.db.prepare(`SELECT * FROM coverage_templates ORDER BY name`).all();
  res.json({ templates: rows.map(parseSeason), activeId: staffingSvc.coverageActiveId(), scheduleOff: !!(cfg.coverage && cfg.coverage.scheduleOff) });
});
router.post('/coverage/template', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { id, name, days, blocks } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name the season' });
  if (!Array.isArray(days) || days.length !== 7) return res.status(400).json({ error: 'days must have exactly 7 entries, Monday first' });
  const cleanDays = [];
  for (let i = 0; i < 7; i++) {
    const d = days[i] || {}; const on = !!(d.staffed === 1 || d.staffed === true);
    const s = String(d.start || '').trim(), e = String(d.end || '').trim();
    if (on && (s || e) && !(TIME_RE.test(s) && TIME_RE.test(e) && e > s)) return res.status(400).json({ error: `Day ${i + 1}: start/end must be HH:MM with end after start (23:59 for midnight), or both blank for all day` });
    cleanDays.push({ dow: i, staffed: on ? 1 : 0, start: on ? s : '', end: on ? e : '' });
  }
  const cleanBlocks = [];
  for (const b of (Array.isArray(blocks) ? blocks : [])) {
    const n = String(b.name || '').trim().slice(0, 30), s = String(b.start || '').trim(), e = String(b.end || '').trim();
    if (!n || !TIME_RE.test(s) || !TIME_RE.test(e) || e <= s) return res.status(400).json({ error: `Shift block "${n || '?'}" needs a name and HH:MM start/end with end after start` });
    // which days the block is expected on (Mon=0..Sun=6); none/all = every day
    const dset = Array.isArray(b.days) ? [...new Set(b.days.map(Number).filter(x => x >= 0 && x <= 6))] : [];
    cleanBlocks.push(Object.assign({ name: n, start: s, end: e }, dset.length && dset.length < 7 ? { days: dset.sort() } : {}));   // overlap between blocks is intentional
  }
  let sid = parseInt(id, 10) || 0;
  if (sid && dbMod.db.prepare(`SELECT id FROM coverage_templates WHERE id = ?`).get(sid)) {
    dbMod.db.prepare(`UPDATE coverage_templates SET name = ?, payload = ?, shifts = ? WHERE id = ?`).run(String(name).trim().slice(0, 40), JSON.stringify(cleanDays), JSON.stringify(cleanBlocks), sid);
  } else {
    dbMod.db.prepare(`INSERT INTO coverage_templates (name, payload, shifts) VALUES (?,?,?)`).run(String(name).trim().slice(0, 40), JSON.stringify(cleanDays), JSON.stringify(cleanBlocks));
    sid = lastId('coverage_templates');
    // the first season a facility saves is what it meant - activate it
    if (!staffingSvc.coverageActiveId()) { const c = configService.getConfig(); c.coverage = Object.assign({}, c.coverage, { activeTemplateId: sid }); configService.saveConfig(c); }
  }
  dbMod.adminLog('SEASON_SAVED', String(name).trim());
  res.json({ ok: true, id: sid, activeId: staffingSvc.coverageActiveId() });
});
router.delete('/coverage/template/:id', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const id = parseInt(req.params.id, 10);
  dbMod.db.prepare(`DELETE FROM coverage_templates WHERE id = ?`).run(id);
  const c = configService.getConfig();
  if (c.coverage && Number(c.coverage.activeTemplateId) === id) { c.coverage.activeTemplateId = null; configService.saveConfig(c); }
  res.json({ ok: true, activeId: staffingSvc.coverageActiveId() });
});
router.post('/coverage/activate', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const id = parseInt(req.body?.id, 10) || null;
  if (id && !dbMod.db.prepare(`SELECT id FROM coverage_templates WHERE id = ?`).get(id)) return res.status(404).json({ error: 'Season not found' });
  const c = configService.getConfig(); c.coverage = Object.assign({}, c.coverage, { activeTemplateId: id }); configService.saveConfig(c);
  dbMod.adminLog('SEASON_ACTIVATED', id ? `#${id}` : 'none (calendar rules)');
  res.json({ ok: true, activeId: staffingSvc.coverageActiveId() });
});
router.post('/coverage/exception', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const { date, staffed, start_time, end_time, note } = req.body || {};
  if (!DATE_RE.test(String(date || ''))) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const on = !!(staffed === 1 || staffed === true);
  const s = String(start_time || '').trim(), e = String(end_time || '').trim();
  if (on && (s || e) && !(TIME_RE.test(s) && TIME_RE.test(e) && e > s)) return res.status(400).json({ error: 'start/end must be HH:MM with end after start, or blank for all day' });
  dbMod.db.prepare(`DELETE FROM coverage_exceptions WHERE date = ?`).run(date);
  dbMod.db.prepare(`INSERT INTO coverage_exceptions (date, staffed, start_time, end_time, note) VALUES (?,?,?,?,?)`).run(date, on ? 1 : 0, on ? s : '', on ? e : '', String(note || '').slice(0, 120));
  dbMod.adminLog(on ? 'COVERAGE_DAY_FORCED' : 'COVERAGE_DAY_OFF', date);
  res.json({ ok: true, window: staffingSvc.effectiveWindow(date) });
});
router.delete('/coverage/exception/:date', staff.requireAdminOnly, requireScheduling, (req, res) => {
  dbMod.db.prepare(`DELETE FROM coverage_exceptions WHERE date = ?`).run(req.params.date); res.json({ ok: true });
});
router.post('/coverage/schedule-off', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const off = !!req.body?.off;
  const c = configService.getConfig(); c.coverage = Object.assign({}, c.coverage, { scheduleOff: off }); configService.saveConfig(c);
  dbMod.adminLog(off ? 'STAFFED_HOURS_OFF' : 'STAFFED_HOURS_ON', 'master switch');
  res.json({ ok: true, scheduleOff: off });
});

// ── DASHBOARD: one call for the ops card ───────────────────────────────────
router.get('/ops-today', staff.requireAdminOnly, requireScheduling, (req, res) => {
  const onClock = dbMod.db.prepare(`SELECT id, staff_code, staff_name, clock_in, clock_in_ms FROM time_entries WHERE clock_out IS NULL ORDER BY clock_in`).all()
    .map(r => ({ id: r.id, code: r.staff_code, name: (rosterByCode(r.staff_code) || {}).name || r.staff_name, since: r.clock_in, minutes: r.clock_in_ms ? tc.minutesBetweenMs(r.clock_in_ms, Date.now()) : null }));
  const pendingTimeoff = dbMod.db.prepare(`SELECT * FROM timeoff_requests WHERE status = 'pending' ORDER BY created_at`).all();
  const pendingReq = dbMod.db.prepare(`SELECT r.*, s.date, s.start_time, s.end_time, s.label FROM shift_requests r JOIN shifts s ON s.id = r.shift_id WHERE r.status = 'pending' ORDER BY r.created_at`).all();
  const flagged = dbMod.db.prepare(`SELECT id, staff_code, staff_name, clock_in, clock_out, worked_minutes, flag_reason FROM time_entries WHERE flagged = 1 AND reviewed = 0 ORDER BY clock_in DESC`).all();
  // the 7-day alarm (the handoff's own rule): any uncovered block or open
  // shift inside the next week is red on the dashboard
  const today = tc.localToday(); let uncoveredBlocks7d = 0, firstGap = null;
  for (let i = 0; i < 7; i++) { const d = tc.addDays(today, i); const g = coverageGaps(d); if (g.uncovered) { uncoveredBlocks7d += g.uncovered; if (!firstGap) firstGap = d; } }
  const openShifts7d = (dbMod.db.prepare(`SELECT COUNT(*) AS c FROM shifts WHERE staff_code IS NULL AND date BETWEEN ? AND ?`).get(today, tc.addDays(today, 6)) || {}).c || 0;
  res.json({ onClock, pendingTimeoff, pendingReq, flagged, alarm: { uncoveredBlocks7d, openShifts7d, firstGap } });
});

module.exports = router;
