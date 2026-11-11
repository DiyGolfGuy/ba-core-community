// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/members.js  —  Membership Tiers, Members, Usage & Validation
// ═══════════════════════════════════════════════════════════════════════════════

const express    = require('express');
// a PIN typed by the owner opens the door when member door access is on, so it must be the door's
// length (the build review: a 4-digit PIN from an old system was taken, refused by a 6-digit console
// on every retry, and the owner was told the console was "not answering")
function doorPinLenWrong(pin) {
  try {
    if (!require('../services/memberaccess').memberAccessOn()) return '';
    const n = require('../services/doorlock').doorPinLength();
    return n && String(pin).length !== Number(n) ? `Member PINs open the door here, so they are ${n} digits - the PIN Length set under Settings > Devices > Door Access` : '';
  } catch { return ''; }
}
// what the owner is told when the door console has not taken a member yet (Sep 25 2026)
const doorConsoleNote = r => r && r.refused
  ? `refused it: ${r.refused}. If it names the PIN length, set PIN Length (Settings > Devices > Door Access) and the console's own PIN setting to the same number of digits`
  : 'not answering - the PIN is checked when it is back, and the member is texted if it has to change';
const router     = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getConfig }   = require('../services/config');

function db()       { return require('../services/db').db; }
function adminLog(e,d) { require('../services/db').adminLog(e,d); }

const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];

// ── ADMIN AUTH MIDDLEWARE ──────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  // OWNER-ONLY (maintainer, Aug 20): members and their money are keys the manager
  // sign-in never holds - the shared requireOwner refuses manager sessions
  // with a clear message, server-side, no matter what the UI shows.
  return require('../services/auth').requireOwner(req, res, next);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

/** A unique member PIN at the facility's ONE door-PIN length.
 *  It was hardcoded to six digits while visitor PINs followed a separate setting
 *  that defaulted to four - and a UniFi console enforces one length for both, so
 *  the two populations could not coexist on a default unit. One number now
 *  (services/doorlock.js doorPinLength); see the note there.
 *  A member's EXISTING PIN is never rewritten by this - it is what they type at
 *  the door and on the staff pad, and changing it under them would be worse than
 *  a length mismatch. Only newly minted PINs use the current length. */
/** A door credential never goes into the owner's log in full (maintainer, Sep 16 2026).
 *  Last four, so a human can still match a log line to a member they are looking
 *  at, without the log itself being a working key. */
function maskPin(pin) {
  const s = String(pin || '');
  return s.length <= 4 ? s : '*'.repeat(s.length - 4) + s.slice(-4);
}

function generatePin(avoid) { return require('../services/memberpin').generate(avoid); }   // one generator for every member PIN (Sep 25 2026)

/** Get week start (Monday) and end (Sunday) for a date */
function getWeekBounds(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const mon = new Date(d); mon.setDate(d.getDate() - diff);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = dt => dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

/** Get month start and end for a date */
function getMonthBounds(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end   = new Date(d.getFullYear(), d.getMonth()+1, 0);
  const fmt = dt => dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  return { monthStart: fmt(start), monthEnd: fmt(end) };
}

/** Convert HH:MM to minutes */
function toMins(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }

// ═══════════════════════════════════════════════════════════════════════════════
//  TIER ENDPOINTS (admin only)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/members/tiers — list all tiers
// ── UniFi Member Access Network hook (best-effort, never blocks a response) ──
// Called after ANY member lifecycle change. Active member -> create-or-update
// the console user (name/PIN/tier static policy). Inactive/cancelled ->
// DEACTIVATE the console user IMMEDIATELY - a cancelled member's PIN must die
// the moment staff cancels them, not at the next manual Sync All.
function unifiMemberHook(memberId) {
  // services/memberaccess (Sep 25 2026): marked, tried now, and retried by the scheduler's
  // tick until the console takes it - never best-effort, never lost
  try { require('../services/memberaccess').touch(memberId); } catch {}
}
// A FAMILY'S CODES FOLLOW ITS PRIMARY (Oct 20 2026, found by the AI branch's members map): Stripe's own events already end
// and restore the whole group (services/membership-lifecycle.js), but the owner's Cancel now, Deactivate and a status change
// left the other codes working - the door included - until a webhook came. Only a primary carries the group.
function familyFollows(member, status) {
  if (!member || member.parent_member_id) return;
  try {
    db().prepare(`UPDATE members SET status=?, updated_at=datetime('now') WHERE parent_member_id=?`).run(status, member.id);
    require('../services/memberaccess').touchFamily(member.id);
  } catch {}
}

router.get('/tiers', requireAdmin, (req, res) => {
  try {
    const tiers = db().prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM members m WHERE m.tier_id = t.id AND m.status = 'active') AS roster_count
      FROM membership_tiers t ORDER BY t.sort_order ASC, t.name ASC`).all();
    res.json(tiers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/members/tiers/:id — single tier with member count
router.get('/tiers/:id', requireAdmin, (req, res) => {
  try {
    const tier = db().prepare(`SELECT * FROM membership_tiers WHERE id=?`).get(req.params.id);
    if (!tier) return res.status(404).json({ error: 'Tier not found' });
    const count = db().prepare(`SELECT COUNT(*) as c FROM members WHERE tier_id=? AND status='active'`).get(req.params.id);
    tier.member_count = count?.c || 0;
    res.json(tier);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/members/tiers — create tier
// Regenerate a member code's PIN (family code leaked, employee turnover, etc.)
router.post('/:id/new-pin', requireAdmin, async (req, res) => {
  try {
    const m = db().prepare(`SELECT id FROM members WHERE id=?`).get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Member not found' });
    let pin = generatePin();
    db().prepare(`UPDATE members SET pin=? WHERE id=?`).run(pin, req.params.id);
    // checked free on the door console BEFORE it is shown (a refused one is re-picked here)
    const s = await require('../services/memberaccess').syncNow(req.params.id);
    if (s && s.pin) pin = s.pin;
    require('../services/db').adminLog('MEMBER_PIN_REGENERATED', `Member ${req.params.id}`);
    res.json({ success: true, pin, doorConsole: s && s.pending ? doorConsoleNote(s) : undefined });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tiers', requireAdmin, (req, res) => {
  try {
    const { name, description, badge_color, discount_type, discount_value,
      hours_per_day, hours_per_week, hours_per_month,
      allowed_days, earliest_time, latest_time, allowed_bays,
      booking_window_days, guest_allowed, guest_max_per_visit,
      guest_passes_per_month, guest_pricing_type, guest_pricing_value, sort_order,
      max_active_bookings, price_monthly, price_annual, grace_days, roster_cap, sell_online,
      over_limit_discount_type, over_limit_discount_value, guest_overflow_price, guest_pricing_basis,
      deposit_mode, share_discount_pct, codes_included, settlement_mode, deposit_per30,
      food_discount_type, food_discount_value,
      beverage_discount_type, beverage_discount_value } = req.body;
    const settle = normalizeSettlement(settlement_mode, deposit_mode);

    if (!name?.trim()) return res.status(400).json({ error: 'Tier name is required' });

    const id = uuidv4();
    db().prepare(`INSERT INTO membership_tiers
      (id, name, description, badge_color, discount_type, discount_value,
       hours_per_day, hours_per_week, hours_per_month,
       allowed_days, earliest_time, latest_time, allowed_bays,
       booking_window_days, guest_allowed, guest_max_per_visit,
       guest_passes_per_month, guest_pricing_type, guest_pricing_value, sort_order,
       max_active_bookings, price_monthly, price_annual, grace_days, roster_cap, sell_online,
       over_limit_discount_type, over_limit_discount_value, guest_overflow_price, guest_pricing_basis,
       deposit_mode, share_discount_pct, codes_included, settlement_mode, deposit_per30,
       food_discount_type, food_discount_value, beverage_discount_type, beverage_discount_value, guest_pricing_set, guest_included_per_visit, guest_collect)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name.trim(), description||'', badge_color||'#c9a227',
      discount_type||'percentage', discount_value||0,
      hours_per_day||0, hours_per_week||0, hours_per_month||0,
      allowed_days||'', earliest_time||'', latest_time||'',
      allowed_bays||'', booking_window_days||0,
      guest_allowed?1:0, guest_max_per_visit||0,
      guest_passes_per_month||0, guest_pricing_type||'free',
      guest_pricing_value||0, sort_order||0,
      max_active_bookings||0, price_monthly||0, price_annual||0,
      (grace_days===undefined||grace_days===null||grace_days==='')?14:parseInt(grace_days),
      roster_cap||0, sell_online?1:0,
      over_limit_discount_type||'', over_limit_discount_value||0, guest_overflow_price||0, guest_pricing_basis||'booking',
      settle === 'deposit' ? 1 : 0, share_discount_pct||0, Math.max(1, parseInt(codes_included)||1),
      settle, Number(deposit_per30)||0,
      food_discount_type||'', food_discount_value||0,
      beverage_discount_type||'', beverage_discount_value||0,
      (guest_pricing_type !== undefined || guest_allowed !== undefined) ? 1 : 0,
      Math.max(0, parseInt(req.body.guest_included_per_visit, 10) || 0), ['auto', 'online', 'door'].includes(String(req.body.guest_collect || '')) ? String(req.body.guest_collect) : 'auto');

    adminLog('TIER_CREATED', `${name.trim()} | ${discount_type} ${discount_value}`);
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/members/tiers/:id — update tier
router.put('/tiers/:id', requireAdmin, (req, res) => {
  try {
    const existing = db().prepare(`SELECT id FROM membership_tiers WHERE id=?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tier not found' });

    const { name, description, badge_color, discount_type, discount_value,
      hours_per_day, hours_per_week, hours_per_month,
      allowed_days, earliest_time, latest_time, allowed_bays,
      booking_window_days, guest_allowed, guest_max_per_visit,
      guest_passes_per_month, guest_pricing_type, guest_pricing_value,
      sort_order, active,
      max_active_bookings, price_monthly, price_annual, grace_days, roster_cap, sell_online,
      over_limit_discount_type, over_limit_discount_value, guest_overflow_price, guest_pricing_basis,
      deposit_mode, share_discount_pct, codes_included, settlement_mode, deposit_per30,
      food_discount_type, food_discount_value,
      beverage_discount_type, beverage_discount_value } = req.body;
    const settle = normalizeSettlement(settlement_mode, deposit_mode);

    db().prepare(`UPDATE membership_tiers SET
      name=?, description=?, badge_color=?, discount_type=?, discount_value=?,
      hours_per_day=?, hours_per_week=?, hours_per_month=?,
      allowed_days=?, earliest_time=?, latest_time=?, allowed_bays=?,
      booking_window_days=?, guest_allowed=?, guest_max_per_visit=?,
      guest_passes_per_month=?, guest_pricing_type=?, guest_pricing_value=?,
      sort_order=?, active=?,
      max_active_bookings=?, price_monthly=?, price_annual=?, grace_days=?, roster_cap=?, sell_online=?,
      over_limit_discount_type=?, over_limit_discount_value=?, guest_overflow_price=?, guest_pricing_basis=?,
      deposit_mode=?, share_discount_pct=?, codes_included=?, settlement_mode=?, deposit_per30=?,
      food_discount_type=?, food_discount_value=?,
      beverage_discount_type=?, beverage_discount_value=?,
      guest_pricing_set = CASE WHEN ? = 1 THEN 1 ELSE guest_pricing_set END,
      guest_included_per_visit=?, guest_collect=?
      WHERE id=?`)
    .run(name, description||'', badge_color||'#c9a227',
      discount_type||'percentage', discount_value||0,
      hours_per_day||0, hours_per_week||0, hours_per_month||0,
      allowed_days||'', earliest_time||'', latest_time||'',
      allowed_bays||'', booking_window_days||0,
      guest_allowed?1:0, guest_max_per_visit||0,
      guest_passes_per_month||0, guest_pricing_type||'free',
      guest_pricing_value||0, sort_order||0, active!==undefined?active:1,
      max_active_bookings||0, price_monthly||0, price_annual||0,
      (grace_days===undefined||grace_days===null||grace_days==='')?14:parseInt(grace_days),
      roster_cap||0, sell_online?1:0,
      over_limit_discount_type||'', over_limit_discount_value||0, guest_overflow_price||0, guest_pricing_basis||'booking',
      settle === 'deposit' ? 1 : 0, share_discount_pct||0, Math.max(1, parseInt(codes_included)||1),
      settle, Number(deposit_per30)||0,
      food_discount_type||'', food_discount_value||0,
      beverage_discount_type||'', beverage_discount_value||0,
      (guest_pricing_type !== undefined || guest_allowed !== undefined) ? 1 : 0,
      Math.max(0, parseInt(req.body.guest_included_per_visit, 10) || 0), ['auto', 'online', 'door'].includes(String(req.body.guest_collect || '')) ? String(req.body.guest_collect) : 'auto', req.params.id);

    adminLog('TIER_UPDATED', name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/members/tiers/:id — deactivate tier (never hard delete)
// Per-tier membership waiver document. Same dedicated-route pattern as the
// UniFi pickers so the fragile positional tier UPDATE never needs touching.
// Empty waiver_id = this tier signs the facility's active waiver.
router.put('/tiers/:id/waiver-doc', requireAdmin, (req, res) => {
  try {
    const tier = db().prepare(`SELECT id, name FROM membership_tiers WHERE id=?`).get(req.params.id);
    if (!tier) return res.status(404).json({ error: 'Tier not found' });
    const waiverId = String(req.body?.waiver_id || '').trim();
    if (waiverId) {
      const w = db().prepare(`SELECT id, name FROM waivers WHERE id=?`).get(waiverId);
      if (!w) return res.status(400).json({ error: 'That waiver document no longer exists.' });
    }
    // waiver_term (waiver audit, Sep 1 2026): '' = facility setting, else
    // membership | annual | visit. Only touched when the client sends it.
    const TERMS = require('../services/memberwaiver').TERMS;
    let term;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'waiver_term')) {
      term = String(req.body.waiver_term || '').trim();
      if (term && !TERMS.includes(term)) return res.status(400).json({ error: 'waiver_term must be membership, annual, visit, or blank for the facility setting.' });
    }
    if (term === undefined) db().prepare(`UPDATE membership_tiers SET waiver_id=? WHERE id=?`).run(waiverId, req.params.id);
    else db().prepare(`UPDATE membership_tiers SET waiver_id=?, waiver_term=? WHERE id=?`).run(waiverId, term, req.params.id);
    adminLog('TIER_WAIVER_DOC_SET', `${tier.name} | ${waiverId || 'facility active waiver'} | ${term === undefined ? 'term untouched' : (term || 'facility term')}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// UniFi Access: which extra doors/groups this tier's members unlock when they
// book. Stored as a JSON array of 'door:<id>' / 'group:<id>' strings. A
// dedicated route (not the 37-column tier UPDATE) so the fragile positional
// queries never need touching.
// Always-on doors for this tier's members (Member Access Network).
router.put('/tiers/:id/unifi-static-doors', requireAdmin, (req, res) => {
  try {
    const list = Array.isArray(req.body?.unifi_static_doors) ? req.body.unifi_static_doors.filter(x => typeof x === 'string').slice(0, 64) : [];
    db().prepare(`UPDATE membership_tiers SET unifi_static_doors=? WHERE id=?`).run(JSON.stringify(list), req.params.id);
    require('../services/db').adminLog('TIER_UNIFI_STATIC', `${req.params.id}: ${list.join(',') || '(none)'}`);
    // Re-sync this tier's members in the background so the change reaches the
    // console without waiting for a manual Sync All (covers the tier-had-no-
    // doors-before case, where members hold zero policies to auto-update).
    setImmediate(() => {
      try {
        for (const r of db().prepare(`SELECT id FROM members WHERE tier_id=? AND status='active'`).all(req.params.id)) unifiMemberHook(r.id);
      } catch {}
    });
    res.json({ ok: true, unifi_static_doors: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tiers/:id/unifi-doors', requireAdmin, (req, res) => {
  try {
    const list = Array.isArray(req.body?.unifi_doors) ? req.body.unifi_doors.filter(x => typeof x === 'string').slice(0, 64) : [];
    const out = db().prepare(`UPDATE membership_tiers SET unifi_doors=? WHERE id=?`).run(JSON.stringify(list), req.params.id);
    require('../services/db').adminLog('TIER_UNIFI_DOORS', `${req.params.id}: ${list.join(',') || '(none)'}`);
    res.json({ ok: true, unifi_doors: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tiers/:id', requireAdmin, (req, res) => {
  try {
    const tier = db().prepare(`SELECT name FROM membership_tiers WHERE id=?`).get(req.params.id);
    if (!tier) return res.status(404).json({ error: 'Tier not found' });

    const memberCount = db().prepare(`SELECT COUNT(*) as c FROM members WHERE tier_id=? AND status='active'`).get(req.params.id);
    if (memberCount?.c > 0) {
      return res.status(400).json({ error: `Cannot deactivate — ${memberCount.c} active member(s) still on this tier. Move them first.` });
    }

    db().prepare(`UPDATE membership_tiers SET active=0 WHERE id=?`).run(req.params.id);
    adminLog('TIER_DEACTIVATED', tier.name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MEMBER ENDPOINTS (admin only)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/members — list members with tier info
router.get('/', requireAdmin, (req, res) => {
  try {
    // names only (Oct 22 2026): the assistant tells a member by their name in the owner's words - the list's own
    // query counts every member's bookings, too much to run on every message of a big facility's chat
    if (req.query.names === '1') return res.json(db().prepare(`SELECT name FROM members WHERE status IS NULL OR status != 'cancelled'`).all().map(r => r.name).filter(Boolean));
    const { tier_id, status, search } = req.query;
    let sql = `SELECT m.*, mt.name as tier_name, mt.badge_color,
      (SELECT COUNT(*) FROM bookings b WHERE b.member_id = m.id AND b.status IN ('active','completed')) AS bookings_count,
      (SELECT COALESCE(SUM(b.duration_minutes),0) FROM bookings b WHERE b.member_id = m.id AND b.status IN ('active','completed')) AS minutes_played
      FROM members m LEFT JOIN membership_tiers mt ON m.tier_id = mt.id WHERE 1=1`;
    const params = [];

    if (tier_id)  { sql += ` AND m.tier_id=?`; params.push(tier_id); }
    if (status)   { sql += ` AND m.status=?`; params.push(status); }
    if (search)   {
      // a phone matches however it was typed (Sep 25 2026, the build review): phones are stored as
      // +1 and ten digits now, so "202-555-0147" typed in the search found no one added since
      const dg = require('../services/phone').digits(search);
      sql += ` AND (m.name LIKE ? OR m.phone LIKE ? OR m.email LIKE ?` + (dg.length >= 4 ? ` OR replace(replace(replace(replace(replace(m.phone,'+',''),'-',''),' ',''),'(',''),')','') LIKE ?` : '') + `)`;
      params.push(`%${search}%`,`%${search}%`,`%${search}%`);
      if (dg.length >= 4) params.push(`%${dg}%`);
    }

    sql += ` ORDER BY m.name ASC`;
    const members = db().prepare(sql).all(...params);
    // Membership-waiver column for the admin table: one prepass query, then
    // the validity engine per member (Pi-scale rosters; identity-anchored).
    try {
      const mw = require('../services/memberwaiver');
      for (const m of members) {
        const st = mw.memberWaiverStatus(m.id);
        m.waiver_on_file = st.on_file ? 1 : 0;
        m.waiver_expired = st.expired ? 1 : 0;
        m.waiver_version = st.version || '';
        m.waiver_signed_at = st.signed_at || '';
        m.waiver_signed_id = st.on_file ? st.signed_id : '';
        m.waiver_term = st.term || '';
        m.waiver_expires_at = st.expires_at || '';
        m.waiver_days_left = (st.days_left === null || st.days_left === undefined) ? '' : st.days_left;
        m.waiver_renew_due = st.renew_due ? 1 : 0;
      }
    } catch {}
    res.json(members);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/members/guest-quote?pin&guests&date&duration&start_time - the guest
// law's answer for the booking page (server-authoritative, same rule as the
// counter). Knowing a valid PIN is the trust bar, as with validate-pin.
router.get('/guest-quote', (req, res) => {
  try {
    const member = require('../services/db').getMemberByPin(String(req.query.pin || '').trim());
    if (!member || member.status !== 'active') return res.status(404).json({ error: 'Member not found' });
    const guests = Math.max(0, parseInt(req.query.guests, 10) || 0);
    const date = String(req.query.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const dur = parseInt(req.query.duration, 10) || 60;
    const startTime = String(req.query.start_time || '12:00');
    const pricing = require('../services/pricing');
    let standard = 0;
    try { standard = pricing.calculatePrice(date, startTime, dur, null); } catch {}
    const settle = pricing.tierSettlement ? pricing.tierSettlement(member) : (member.settlement_mode || 'online');
    let staffed = true;
    try { staffed = require('../services/staffing').isStaffedAt(date, startTime); } catch {}
    const guestsSvc = require('../services/guests');
    const atCounter = guestsSvc.collectMode(member, { staffedHere: staffed, doorSettle: settle === 'door' && staffed }) === 'counter';
    const q = guestsSvc.guestQuote({ tier: member, memberId: member.id, guests, date, durationMinutes: dur, standardCents: standard, context: atCounter ? 'counter' : 'booking' });
    res.json(Object.assign({ at_counter: !!atCounter, members_only: !!((require('../services/config').getConfig().booking || {}).membersOnly) }, q));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/members/stats — dashboard stats for members tab
router.get('/stats', requireAdmin, (req, res) => {
  try {
    const totalMembers = db().prepare(`SELECT COUNT(*) as c FROM members WHERE status='active'`).get();
    const totalTiers   = db().prepare(`SELECT COUNT(*) as c FROM membership_tiers WHERE active=1`).get();

    const now = new Date();
    const todayStr = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    const { monthStart, monthEnd } = getMonthBounds(todayStr);

    const monthUsage = db().prepare(
      `SELECT COALESCE(SUM(duration_minutes),0) as total FROM member_usage WHERE date>=? AND date<=?`
    ).get(monthStart, monthEnd);

    const monthBookings = db().prepare(
      `SELECT COUNT(*) as c FROM member_usage WHERE date>=? AND date<=?`
    ).get(monthStart, monthEnd);

    let renewing = [], lead = 0;
    try { const mw = require('../services/memberwaiver'); lead = mw.cfgWaiver().reminderDays; renewing = mw.renewalsDue(); } catch {}
    res.json({
      active_members: totalMembers?.c || 0,
      active_tiers:   totalTiers?.c || 0,
      waivers_renewing: renewing.length,
      waivers_renewing_first: renewing.length ? renewing.slice().sort((a, b) => a.days_left - b.days_left)[0] : null,
      waiver_reminder_days: lead,
      month_hours:    Math.round((monthUsage?.total || 0) / 60 * 10) / 10,
      month_bookings: monthBookings?.c || 0
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/members/:id — single member with usage summary
// GET /api/members/report — membership revenue + roster analytics (admin)
router.get('/report', requireAdmin, (req, res) => {
  try {
    const members = db().prepare(`SELECT m.*, t.name AS tier_name, t.badge_color, t.price_monthly, t.price_annual, t.roster_cap
      FROM members m LEFT JOIN membership_tiers t ON t.id = m.tier_id`).all();
    const active = members.filter(m => m.status === 'active');
    const pastDue = active.filter(m => m.sub_status === 'past_due');
    const billingM = active.filter(m => m.stripe_subscription_id);
    let mrr = 0;
    for (const m of billingM) {
      if (m.billing_cadence === 'annual') mrr += (m.price_annual || 0) / 12;
      else mrr += (m.price_monthly || 0);
    }
    const tiers = db().prepare(`SELECT t.*, 
      (SELECT COUNT(*) FROM members m WHERE m.tier_id=t.id AND m.status='active') AS active_count,
      (SELECT COUNT(*) FROM members m WHERE m.tier_id=t.id AND m.status='active' AND m.billing_cadence='monthly') AS monthly_count,
      (SELECT COUNT(*) FROM members m WHERE m.tier_id=t.id AND m.status='active' AND m.billing_cadence='annual') AS annual_count
      FROM membership_tiers t WHERE t.active=1 ORDER BY t.sort_order`).all();
    const byTier = tiers.map(t => ({
      name: t.name, badge_color: t.badge_color, active: t.active_count, cap: t.roster_cap || 0,
      mrr: Math.round(((t.monthly_count * (t.price_monthly || 0)) + (t.annual_count * (t.price_annual || 0) / 12)) * 100) / 100
    }));
    const joins30 = members.filter(m => m.created_at && (Date.now() - new Date(m.created_at)) < 30 * 86400000).length;
    res.json({
      active_members: active.length, billing_members: billingM.length,
      manual_members: active.length - billingM.length, past_due: pastDue.length,
      mrr: Math.round(mrr * 100) / 100, arr: Math.round(mrr * 12 * 100) / 100,
      joins_30d: joins30, by_tier: byTier
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/members/growth?from&to[&cfrom&cto][&yfrom&yto] - who joined in a period, against the period before and the same days a
// year before, with the membership money paid in each and how many members paid it (Oct 25 2026; maintainer: "Did anyone sign
// up this week? ... year over year, have we grown? Do we have more members?"). Joined is the day a member was added to this unit;
// every date is the facility's own (services/revenue.js localDate). The unit keeps no count of members on a past day, so a year ago
// is read from who joined and who paid then; firstRecord is the first day the unit holds anything, so a span before it says so,
// never "nobody joined".
router.get('/growth', requireAdmin, (req, res) => {
  try {
    const rv = require('../services/revenue'), tz = rv.tzOf(), D = /^\d{4}-\d{2}-\d{2}$/;
    const span = (f, t) => (D.test(String(f || '')) && D.test(String(t || '')) && f <= t ? { from: f, to: t } : null);
    const main = span(req.query.from, req.query.to);
    if (!main) return res.status(400).json({ error: 'from and to (YYYY-MM-DD, from first) are needed' });
    const members = db().prepare(`SELECT m.id, m.name, m.status, m.created_at, t.name AS tier_name FROM members m LEFT JOIN membership_tiers t ON t.id = m.tier_id`).all()
      .map(m => Object.assign(m, { day: rv.localDate(m.created_at, tz) }));
    const pays = db().prepare(`SELECT member_id, amount_cents, paid_at FROM membership_payments`).all().map(p => Object.assign(p, { day: rv.localDate(p.paid_at, tz) }));
    let firstBooking = ''; try { firstBooking = rv.localDate((db().prepare(`SELECT MIN(created_at) AS c FROM bookings`).get() || {}).c, tz); } catch {}
    const setupDay = rv.localDate(((getConfig().setup || {}).eula || {}).acceptedAt, tz);
    const firstRecord = [setupDay, firstBooking].concat(members.map(m => m.day), pays.map(p => p.day)).filter(Boolean).sort()[0] || null;
    const inSpan = (d, s) => !!d && d >= s.from && d <= s.to;
    const of = (s) => {
      if (!s) return undefined;
      const joined = members.filter(m => inSpan(m.day, s)), paid = pays.filter(p => inSpan(p.day, s));
      return { from: s.from, to: s.to, beforeRecords: !firstRecord || s.to < firstRecord, joined: joined.length,
        paid: { payments: paid.length, members: new Set(paid.map(p => p.member_id).filter(Boolean)).size, cents: paid.reduce((n, p) => n + (p.amount_cents | 0), 0) } };
    };
    const out = of(main);
    out.who = members.filter(m => inSpan(m.day, main)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50)
      .map(m => ({ name: m.name, tier: m.tier_name || '', day: m.day, status: m.status }));
    res.json({ period: out, before: of(span(req.query.cfrom, req.query.cto)), yearBefore: of(span(req.query.yfrom, req.query.yto)),
      activeNow: members.filter(m => m.status === 'active').length, firstRecord });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAdmin, (req, res) => {
  try {
    if (['tiers','validate-pin','check-limits','stats','portal','record-usage','growth'].includes(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const member = require('../services/db').getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json(member);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/members — create member
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { tier_id, name, phone, email, pin, notes } = req.body;
    // A HAND-MADE MEMBER CAN CARRY THEIR BILLING (maintainer, Sep 20 2026). The owner's
    // only way to fix a paid signup the unit never saw used to be creating the
    // member here - with no subscription id, so the reconcile skipped them,
    // renewals never tracked, past-due never showed, the portal's cancel and
    // billing buttons did nothing, and a cancellation in Stripe was never
    // learned. The manual fix traded a visible problem for a silent one.
    const subId = String(req.body.stripe_subscription_id || '').trim();
    const custId = String(req.body.stripe_customer_id || '').trim();
    if (subId && !/^sub_[A-Za-z0-9_]+$/.test(subId)) return res.status(400).json({ error: 'That does not look like a Stripe subscription id (sub_...)' });
    if (custId && !/^cus_[A-Za-z0-9_]+$/.test(custId)) return res.status(400).json({ error: 'That does not look like a Stripe customer id (cus_...)' });
    if (subId) {
      const taken = db().prepare(`SELECT id, name FROM members WHERE stripe_subscription_id=?`).get(subId);
      if (taken) return res.status(409).json({ error: `That subscription is already linked to ${taken.name}.` });
    }
    if (!tier_id) return res.status(400).json({ error: 'Tier is required' });
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!phone?.trim()) return res.status(400).json({ error: 'Phone is required' });

    // Verify tier exists
    const tier = db().prepare(`SELECT id, name FROM membership_tiers WHERE id=? AND active=1`).get(tier_id);
    if (!tier) return res.status(400).json({ error: 'Invalid or inactive tier' });

    // Generate or validate PIN
    let memberPin = pin?.trim();
    if (memberPin) {
      if (!/^\d{4,8}$/.test(memberPin)) return res.status(400).json({ error: 'PIN must be 4-8 digits' });
      const lenWrong = doorPinLenWrong(memberPin); if (lenWrong) return res.status(400).json({ error: lenWrong });
      const exists = db().prepare(`SELECT id FROM members WHERE pin=?`).get(memberPin);
      if (exists) return res.status(400).json({ error: 'This PIN is already in use' });
    } else {
      memberPin = generatePin();
    }

    const id = uuidv4();
    db().prepare(`INSERT INTO members (id, tier_id, name, phone, email, pin, notes, last_activated_at,
        stripe_subscription_id, stripe_customer_id, sub_status, billing_cadence)
      VALUES (?,?,?,?,?,?,?,datetime('now'),?,?,?,?)`)
    .run(id, tier_id, name.trim(), require('../services/phone').normalize(phone), email?.trim()||'', memberPin, notes||'',
         subId, custId, subId ? 'active' : '', subId ? (['monthly','annual'].includes(req.body.billing_cadence) ? req.body.billing_cadence : 'monthly') : '');
    // THE PIN IS CHECKED FREE ON THE DOOR CONSOLE BEFORE ANYONE SEES IT (maintainer, Sep 25 2026): a
    // PIN the console already holds is re-picked here. A console that does not answer in ten
    // seconds does not hold the signup up (ruling 1) - the answer says so, and a refusal later
    // is re-picked and texted to the member.
    const typed = memberPin;
    const synced = await require('../services/memberaccess').syncNow(id);
    if (synced && synced.pin) memberPin = synced.pin;

    // MASKED, BY BA'S RULING (Sep 16 2026). A booking PIN dies with its session;
    // a MEMBER's PIN opens the door for the life of the membership, and the
    // owner's log is kept at least twelve months (rule 6) and rides inside every
    // backup that leaves the unit. An owner who needs a member's real PIN reads
    // it off the console or the member's own record - that is the system of
    // record, not this log.
    adminLog('MEMBER_CREATED', `${name.trim()} | PIN: ${maskPin(memberPin)} | Tier: ${tier.name}`);
    res.json({ success: true, id, pin: memberPin,
      pinChanged: memberPin !== typed ? 'the door console was already using ' + (pin ? 'the PIN you typed' : 'the first PIN picked') + ', so this member\'s PIN is ' + memberPin : undefined,
      doorConsole: synced && synced.pending ? doorConsoleNote(synced) : undefined });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/members/:id — update member
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = db().prepare(`SELECT * FROM members WHERE id=?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    const { pin } = req.body;
    // A FIELD NOT SENT KEEPS ITS VALUE (Oct 20 2026, found by the AI branch's members map): this replaced the whole record,
    // so the family-code Rename - which sends only the name - answered 500 (no tier), and any partial save would have set a
    // suspended member back to active and blanked their notes and email. The Members editor sends every field, as before.
    const b = req.body || {}, has = k => Object.prototype.hasOwnProperty.call(b, k);
    const tier_id = has('tier_id') ? b.tier_id : existing.tier_id;
    const name = has('name') ? b.name : existing.name;
    const phone = has('phone') ? b.phone : existing.phone;
    const email = has('email') ? b.email : existing.email;
    const status = has('status') ? b.status : existing.status;
    const notes = has('notes') ? b.notes : existing.notes;
    // Waiver validity anchor: a NON-active -> active transition is a
    // reactivation, and maintainer's rule is lapse-and-rejoin means sign again -
    // moving last_activated_at is what expires the old membership waiver.
    const reactivating = existing.status !== 'active' && (status || 'active') === 'active';

    // If changing PIN, validate uniqueness
    if (pin?.trim()) {
      if (!/^\d{4,8}$/.test(pin.trim())) return res.status(400).json({ error: 'PIN must be 4-8 digits' });
      const lenWrong = doorPinLenWrong(pin.trim()); if (lenWrong) return res.status(400).json({ error: lenWrong });
      const pinCheck = db().prepare(`SELECT id FROM members WHERE pin=? AND id!=?`).get(pin.trim(), req.params.id);
      if (pinCheck) return res.status(400).json({ error: 'This PIN is already in use' });
    }

    db().prepare(`UPDATE members SET
      tier_id=?, name=?, phone=?, email=?, pin=COALESCE(?,pin),
      status=?, notes=?, updated_at=datetime('now')
      WHERE id=?`)
    .run(tier_id, name, require('../services/phone').normalize(phone), email||'', pin?.trim()||null,
      status||'active', notes||'', req.params.id);
    if (reactivating) {
      db().prepare(`UPDATE members SET last_activated_at=datetime('now') WHERE id=?`).run(req.params.id);
    }
    // a primary's status change carries its family's codes (suspended, back on, ended)
    if ((status || 'active') !== existing.status) familyFollows(existing, status || 'active');
    // a changed PIN is checked on the door console before the answer (re-picked if it is held)
    let pinNow = null;
    if (pin?.trim()) { const sy = await require('../services/memberaccess').syncNow(req.params.id); pinNow = sy && sy.pin; }
    else unifiMemberHook(req.params.id);

    // Link (or re-link) billing by hand - the same validation as create.
    if (req.body.stripe_subscription_id !== undefined || req.body.stripe_customer_id !== undefined) {
      const subId = String(req.body.stripe_subscription_id || '').trim();
      const custId = String(req.body.stripe_customer_id || '').trim();
      if (subId && !/^sub_[A-Za-z0-9_]+$/.test(subId)) return res.status(400).json({ error: 'That does not look like a Stripe subscription id (sub_...)' });
      if (custId && !/^cus_[A-Za-z0-9_]+$/.test(custId)) return res.status(400).json({ error: 'That does not look like a Stripe customer id (cus_...)' });
      if (subId) {
        const taken = db().prepare(`SELECT id, name FROM members WHERE stripe_subscription_id=? AND id!=?`).get(subId, req.params.id);
        if (taken) return res.status(409).json({ error: `That subscription is already linked to ${taken.name}.` });
      }
      db().prepare(`UPDATE members SET stripe_subscription_id=?, stripe_customer_id=?,
        sub_status=CASE WHEN ?<>'' THEN 'active' ELSE sub_status END WHERE id=?`).run(subId, custId, subId, req.params.id);
    }
    adminLog('MEMBER_UPDATED', `${name} | ${status||'active'}`);
    res.json({ success: true, pin: pinNow && pin && pinNow !== pin.trim() ? pinNow : undefined });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/members/:id — deactivate (never hard delete)
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const member = db().prepare(`SELECT id, name, parent_member_id FROM members WHERE id=?`).get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    db().prepare(`UPDATE members SET status='inactive', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
    unifiMemberHook(req.params.id);
    familyFollows(member, 'inactive');
    adminLog('MEMBER_DEACTIVATED', member.name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/members/:id/waiver-attest — owner records a paper membership
// waiver on file at the facility (maintainer's "it's on hand at the facility" case).
// Generates the printable attestation record with the verifying admin stamped.
router.post('/:id/waiver-attest', requireAdmin, (req, res) => {
  try {
    const member = require('../services/db').getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.status !== 'active') return res.status(400).json({ error: 'Member is not active - reactivate first, then record the waiver.' });
    const mw = require('../services/memberwaiver');
    if (mw.cfgWaiver().mode === 'off') return res.status(400).json({ error: 'Waivers are turned off for this facility.' });
    const doc = mw.docForTier(member.tier_id);
    if (!doc) return res.status(400).json({ error: 'No waiver document is uploaded yet - add one on the Waivers tab first.' });
    const out = mw.recordMembershipWaiver(member, doc, {
      method: 'paper',
      employee: 'Owner/Admin',
      guardianFor: String(req.body?.guardian_for || '').trim() || null,
      ipAddress: req.ip || '',
      context: 'owner attestation - physical waiver on file at the facility'
    });
    if (!out) return res.status(500).json({ error: 'Could not record the attestation.' });
    adminLog('MEMBER_WAIVER_ATTESTED', `${member.name} | ${doc.name} v${doc.version}`);
    res.json({ success: true, signed_id: out.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/members/:id/waiver-record — latest membership-scope record for the
// admin table's view link (download rides the existing signed-waiver route).
router.get('/:id/waiver-record', requireAdmin, (req, res) => {
  try {
    const row = db().prepare(
      `SELECT id, waiver_name, waiver_version, agreed_at, method, signed_pdf_path
         FROM signed_waivers WHERE member_id = ? AND scope = 'membership'
        ORDER BY agreed_at DESC LIMIT 1`
    ).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'No membership waiver on record for this member.' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/members/:id/usage — usage report for a member
router.get('/:id/usage', requireAdmin, (req, res) => {
  try {
    const member = require('../services/db').getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Get usage records
    const usage = db().prepare(
      `SELECT mu.*, b.bay_name, b.start_time, b.end_time
       FROM member_usage mu LEFT JOIN bookings b ON mu.booking_id = b.id
       WHERE mu.member_id=? ORDER BY mu.date DESC LIMIT 100`
    ).all(req.params.id);

    // Current period summaries
    const now = new Date();
    const todayStr = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    const { weekStart, weekEnd } = getWeekBounds(todayStr);
    const { monthStart, monthEnd } = getMonthBounds(todayStr);

    const dbMod = require('../services/db');
    const todayMins = dbMod.getMemberUsageForDay(req.params.id, todayStr);
    const weekMins  = dbMod.getMemberUsageForWeek(req.params.id, weekStart, weekEnd);
    const monthMins = dbMod.getMemberUsageForMonth(req.params.id, monthStart, monthEnd);
    const guestCount = dbMod.getMemberGuestCountForMonth(req.params.id, monthStart, monthEnd);

    res.json({
      member,
      usage,
      summary: {
        today_minutes: todayMins,
        week_minutes: weekMins,
        month_minutes: monthMins,
        month_guest_count: guestCount
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS (no admin auth — used by booking page)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/members/validate-pin — validate member PIN and return tier info + limits
// 'online' | 'deposit' | 'door' for every tier style. The legacy deposit
// checkbox (deposit_mode) still means 'deposit'; the blend select sends door/online.
function normalizeSettlement(settlement_mode, deposit_mode) {
  if (settlement_mode === 'door' || settlement_mode === 'deposit') return settlement_mode;
  if (deposit_mode) return 'deposit';
  return 'online';
}

// Plain-words summary of a blended tier for the welcome line - the same
// wording rule the tier editor's "in plain words" box uses.
function blendWelcome(m) {
  const meter = require('../services/pricing').meterFor(m) || m;
  const allow = [];
  if (meter.hours_per_day > 0) allow.push(`${meter.hours_per_day} free hour${Number(meter.hours_per_day) !== 1 ? 's' : ''} per day`);
  if (meter.hours_per_week > 0) allow.push(`${meter.hours_per_week}/week`);
  if (meter.hours_per_month > 0) allow.push(`${meter.hours_per_month} free hour${Number(meter.hours_per_month) !== 1 ? 's' : ''} per month`);
  let after;
  if (m.over_limit_discount_type === 'flat_rate') after = `$${(Number(m.over_limit_discount_value) * 2).toFixed(2)}/hour after`;
  else if (m.over_limit_discount_type === 'percentage') after = `${m.over_limit_discount_value}% off after`;
  else if (m.over_limit_discount_type === 'fixed') after = `$${m.over_limit_discount_value} off per session after`;
  else after = 'regular price after';
  return (allow.length ? allow.join(', ') + ', ' : '') + after + '.';
}

// THE THREE HONEST ANSWERS (maintainer's ruling 1, Sep 19 2026). A price a member
// will not be charged is worse than no price at all, so a session covered by
// their hours says so in words, and a session we cannot price before checkout
// says THAT rather than guessing a number.
function quoteLabel(q) {
  const money = c => '$' + (c / 100).toFixed(2);
  if (!q || q.kind === 'unknown') return 'Your price is confirmed at checkout';
  if (q.kind === 'included')      return 'Included in your hours';
  if (q.doorSettle)               return money(q.golfCents) + ' on your tab at the facility';
  if (q.depositApplied)           return money(q.dueNowCents) + ' now, ' + money(q.doorDueCents) + ' at the facility';
  return money(q.golfCents);
}

router.post('/validate-pin', (req, res) => {
  try {
    const { pin, date, start_time, duration_minutes, bay_id, guest_count } = req.body;

    if (!pin?.trim()) return res.status(400).json({ valid: false, message: 'Please enter your membership PIN.' });

    const member = require('../services/db').getMemberByPin(pin.trim());
    if (!member) return res.json({ valid: false, message: 'Invalid membership PIN.' });
    // THE CODE WAS RIGHT (maintainer, Sep 20 2026). memberPinLimiter counts only wrong
    // codes, so a club whose members all book from one wi-fi cannot lock itself
    // out. A restricted or over-limit member still counts as right here - they
    // ARE a member; the rules below price or refuse them honestly.
    res.locals.pinOk = true;

    // ── Schedule restrictions ───────────────────────────────────────────────
    if (date) {
      const dayName = DAY_NAMES[new Date(date + 'T12:00:00').getDay()];

      // Day restriction
      if (member.allowed_days && member.allowed_days.trim()) {
        const days = member.allowed_days.split(',').map(d => d.trim().toLowerCase());
        if (!days.includes(dayName)) {
          return res.json({
            valid: true, restricted: true,
            member_name: member.name, tier_name: member.tier_name, badge_color: member.badge_color,
            message: `Your ${member.tier_name} membership is not available on ${dayName.charAt(0).toUpperCase()+dayName.slice(1)}s. You can still book at regular price.`
          });
        }
      }

      // Time restriction
      if (start_time && member.earliest_time && member.latest_time) {
        const startMin = toMins(start_time);
        const earliest = toMins(member.earliest_time);
        const latest   = toMins(member.latest_time);
        if (startMin < earliest || startMin >= latest) {
          return res.json({
            valid: true, restricted: true,
            member_name: member.name, tier_name: member.tier_name, badge_color: member.badge_color,
            message: `Your ${member.tier_name} membership is available ${member.earliest_time}–${member.latest_time} only. You can still book at regular price.`
          });
        }
      }

      // Bay restriction
      if (bay_id && member.allowed_bays && member.allowed_bays.trim()) {
        const bays = member.allowed_bays.split(',').map(b => b.trim());
        if (!bays.includes(bay_id)) {
          return res.json({
            valid: true, restricted: true,
            member_name: member.name, tier_name: member.tier_name, badge_color: member.badge_color,
            message: `Your ${member.tier_name} membership does not include this bay. You can still book at regular price.`
          });
        }
      }
    }

    // ── Hour limit checks ──────────────────────────────────────────────────
    const dbMod = require('../services/db');
    let overLimit = false;
    let limitMessage = '';

    // BLENDED TIERS (Aug 25): hour allowances are a free-time meter, never a
    // wall. The over-limit machinery below must not fire for them - a 3-hour
    // session against 1 free hour is 1 free + 2 paid, not "limit reached".
    // The quote is built from the SAME functions the payment path runs
    // (pricing.computeBlend, staffing.isStaffedAt, pricing.calculatePrice)
    // so the page can show the member exactly what create-payment-intent
    // will do - $0 due now for door tiers, the blended price otherwise.
    const isBlend = require('../services/pricing').isMeterTier(member);   // blended OR free hours per period
    let blend = null;
    if (isBlend && date && start_time && duration_minutes) {
      try {
        const pricing = require('../services/pricing');
        const dur = parseInt(duration_minutes);
        const publicCents = pricing.calculatePrice(date, start_time, dur, (bay_id && bay_id !== 'auto') ? bay_id : null);
        const info = pricing.computeBlend(pricing.meterFor(member), date, dur, publicCents);
        const doorSettle = (member.settlement_mode || 'online') === 'door' && require('../services/staffing').isStaffedAt(date, start_time);
        blend = {
          settlement: (member.settlement_mode || 'online') === 'door' ? 'door' : 'online',
          door_settle: doorSettle,
          public_cents: publicCents,
          member_cents: info.memberCents,
          due_now_cents: doorSettle ? 0 : info.memberCents,
          door_due_cents: doorSettle ? info.memberCents : 0,
          free_minutes: info.freeMinutes,
          paid_minutes: info.paidMinutes,
          note: info.description
        };
      } catch (e) { blend = null; }
    }

    // NON-BLEND SETTLEMENT QUOTE (Aug 25, late): a tier of ANY style can settle
    // online, by deposit, or at the door. Same functions as the payment path.
    let settle = null;
    if (!isBlend && date && start_time && duration_minutes) {
      try {
        settle = require('../services/pricing').settlementQuote(member, date, start_time, parseInt(duration_minutes), (bay_id && bay_id !== 'auto') ? bay_id : null);
      } catch (e) { settle = null; }
    }

    if (!isBlend && date && duration_minutes) {
      const todayStr = date;
      const { weekStart, weekEnd }   = getWeekBounds(todayStr);
      const { monthStart, monthEnd } = getMonthBounds(todayStr);
      const dur = parseInt(duration_minutes);

      if (member.hours_per_day > 0) {
        const used = dbMod.getMemberUsageForDay(member.id, todayStr);
        const limitMins = member.hours_per_day * 60;
        if (used + dur > limitMins) {
          overLimit = true;
          const remaining = Math.max(0, limitMins - used);
          limitMessage = `Daily limit: ${member.hours_per_day}hr${member.hours_per_day!==1?'s':''}. ${remaining>0 ? Math.round(remaining)+' min remaining today.' : 'Limit reached today.'}`;
        }
      }

      if (!overLimit && member.hours_per_week > 0) {
        const used = dbMod.getMemberUsageForWeek(member.id, weekStart, weekEnd);
        const limitMins = member.hours_per_week * 60;
        if (used + dur > limitMins) {
          overLimit = true;
          const remaining = Math.max(0, limitMins - used);
          limitMessage = `Weekly limit: ${member.hours_per_week}hr${member.hours_per_week!==1?'s':''}. ${remaining>0 ? Math.round(remaining)+' min remaining this week.' : 'Limit reached this week.'}`;
        }
      }

      if (!overLimit && member.hours_per_month > 0) {
        const used = dbMod.getMemberUsageForMonth(member.id, monthStart, monthEnd);
        const limitMins = member.hours_per_month * 60;
        if (used + dur > limitMins) {
          overLimit = true;
          const remaining = Math.max(0, limitMins - used);
          limitMessage = `Monthly limit: ${member.hours_per_month}hr${member.hours_per_month!==1?'s':''}. ${remaining>0 ? Math.round(remaining)+' min remaining this month.' : 'Limit reached this month.'}`;
        }
      }
    }

    // ── Guest check ────────────────────────────────────────────────────────
    let guestInfo = null;
    let guestPassesRemaining = null;
    const reqGuests = parseInt(guest_count) || 0;

    // Always calculate remaining guest passes for display. Verify-first sends
    // no date yet - passes are a monthly allowance, so default to this month.
    if (member.guest_allowed && member.guest_passes_per_month > 0) {
      guestPassesRemaining = require('../services/guests').guestPassesLeft(member.id, member, date || new Date().toISOString().slice(0, 10));
    }

    if (reqGuests > 0) {
      if (!member.guest_allowed) {
        guestInfo = { allowed: false, message: 'Your membership does not include guest privileges.' };
      } else if (member.guest_max_per_visit > 0 && reqGuests > member.guest_max_per_visit) {
        guestInfo = { allowed: false, message: `Maximum ${member.guest_max_per_visit} guest(s) per visit.` };
      } else if (guestPassesRemaining !== null && reqGuests > guestPassesRemaining) {
        guestInfo = { allowed: false, message: `${guestPassesRemaining} guest pass(es) remaining this month.` };
      } else {
        guestInfo = { allowed: true, pricing_type: member.guest_pricing_type, pricing_value: member.guest_pricing_value };
      }
    }

    // ── WHAT THIS MEMBER IS SHOWN BEFORE CHECKOUT (maintainer, Sep 19 2026) ────────
    // The booking page used to draw its slot chips and duration pills from the
    // ANONYMOUS pricing route, so a member shopped at the public rate and only
    // met their own rate at checkout. Both now come from pricing.sessionQuote
    // - the same call create-payment-intent prices the golf with - and they
    // ride along on the PIN check the page already makes, so identifying
    // yourself costs no extra request against the member PIN limiter.
    //   quote     - this exact session, with the tier-crossing breakdown
    //   dayRates  - the member's own per-30 rate for every slot chip that day
    let quote = null, dayRates = null, durationQuotes = null;
    try {
      const pr = require('../services/pricing');
      const qBay = (bay_id && bay_id !== 'auto') ? bay_id : null;
      if (date && start_time && duration_minutes) {
        const q = pr.sessionQuote(member, date, start_time, parseInt(duration_minutes), qBay);
        quote = {
          kind: q.kind, label: quoteLabel(q),
          publicCents: q.publicCents, golfCents: q.golfCents,
          dueNowCents: q.dueNowCents, doorDueCents: q.doorDueCents,
          depositCents: q.depositCents, doorSettle: q.doorSettle,
          depositApplied: q.depositApplied, memberApplied: q.memberApplied,
          overLimit: q.overLimit, freeMinutes: q.freeMinutes, paidMinutes: q.paidMinutes,
          segments: q.segments, breakdown: q.breakdown, note: q.note
        };
      }
      // Every duration the page offers at this start, in ONE call - so a member
      // browsing durations costs no further requests against the PIN limiter
      // and every pill is the same computation the charge will make.
      if (date && start_time) {
        const cfgB2 = require('../services/config').getConfig().booking || {};
        const lo = parseInt(cfgB2.minSessionMins) || 30;
        const hi = parseInt(cfgB2.maxSessionMins) || 240;
        durationQuotes = {};
        for (let d2 = 30; d2 <= 480; d2 += 30) {
          if (d2 < lo || d2 > hi) continue;
          const dq = pr.sessionQuote(member, date, start_time, d2, qBay);
          durationQuotes[d2] = { kind: dq.kind, label: quoteLabel(dq),
                                 golfCents: dq.golfCents, dueNowCents: dq.dueNowCents,
                                 breakdown: dq.breakdown };
        }
      }
      if (date) {
        const cfgB = require('../services/config').getConfig().booking || {};
        const minSession = parseInt(cfgB.minSessionMins) || 30;
        dayRates = {};
        for (let m = 0; m < 1440; m += 30) {
          const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
          dayRates[t] = pr.slotRateFor(member, date, t, minSession, qBay);
        }
      }
    } catch (e) {
      // maintainer's ruling 1: where the honest answer cannot be known, say so - never
      // fall back to a public number and let the member believe it is theirs.
      quote = { kind: 'unknown', label: 'Your price is confirmed at checkout' };
      dayRates = null; durationQuotes = null;
    }

    // ── Response ────────────────────────────────────────────────────────────
    res.json({
      valid: true,
      quote,
      dayRates,
      durationQuotes,
      restricted: false,
      over_limit: overLimit,
      limit_message: limitMessage,
      member_id:    member.id,
      member_name:  member.name,
      tier_name:    member.tier_name,
      badge_color:  member.badge_color,
      // Membership waiver status - identity-anchored; the booking page uses
      // this to skip the ask (on file) or explain the renewal (expired).
      waiver: (() => { try {
        const mw = require('../services/memberwaiver');
        if (mw.cfgWaiver().mode === 'off') return { required: false };
        const st = mw.memberWaiverStatus(member.id);
        return { required: true, on_file: st.on_file, expired: st.expired, reason: st.reason, version: st.version, term: st.term, expires_at: st.expires_at, days_left: st.days_left, renew_due: st.renew_due };
      } catch { return { required: true, on_file: false, expired: false, reason: 'none' }; } })(),
      // Hybrid pricing: when hour limits are used up, a tier can define a
      // secondary discount for the rest of the period instead of full price.
      discount_type:  overLimit ? (member.over_limit_discount_type || null) : member.discount_type,
      discount_value: overLimit ? (member.over_limit_discount_type ? member.over_limit_discount_value : 0) : member.discount_value,
      over_limit_secondary: overLimit && !!member.over_limit_discount_type,
      // Blended tiers: the pre-checkout quote (null until a session is chosen;
      // absent entirely for every other tier style).
      ...(isBlend ? { blend, settlement_mode: (member.settlement_mode || 'online') === 'door' ? 'door' : 'online',
                      hours_per_day: member.hours_per_day || 0, hours_per_week: member.hours_per_week || 0, hours_per_month: member.hours_per_month || 0 }
                  : { settle, settlement_mode: normalizeSettlement(member.settlement_mode, member.deposit_mode), deposit_per30: Number(member.deposit_per30) || 0 }),
      guest_overflow_price: member.guest_overflow_price || 0,
      // Deposit mode: online charge is only a deposit; door settles the rest.
      deposit_mode: !!member.deposit_mode,
      share_discount_pct: member.share_discount_pct || 0,
      credit_cents: (() => { try {
        const row = require('../services/db').db.prepare(`SELECT COALESCE(SUM(delta_cents),0) AS bal FROM member_credit WHERE member_id = ?`).get(member.id);
        return Math.max(0, row?.bal || 0);
      } catch { return 0; } })(),
      // Savings YTD - same definition the owner's Insights uses, scoped to
      // this member, so the two screens can never disagree.
      savings_ytd_cents: (() => { try {
        const row = require('../services/db').db.prepare(
          `SELECT COALESCE(SUM(s.member_discount_cents),0) AS d
             FROM settlements s JOIN bookings b ON b.id = s.booking_id
            WHERE b.member_id = ?
              AND strftime('%Y', s.settled_at) = strftime('%Y','now')`
        ).get(member.id);
        return Math.max(0, row?.d || 0);
      } catch { return 0; } })(),
      guest_pricing_basis: member.guest_pricing_basis || 'booking',
      guest_pricing_type_effective: require('../services/guests').effectiveGuestType(member),
      booking_window_days: member.booking_window_days || 0,
      guest_allowed:       member.guest_allowed ? true : false,
      guest_max_per_visit: member.guest_max_per_visit || 0,
      guest_pricing_type:  member.guest_pricing_type || 'free',
      guest_pricing_value: member.guest_pricing_value || 0,
      guest_info: guestInfo,
      guest_passes_remaining: guestPassesRemaining,
      message: isBlend
        ? `Welcome back, ${member.name}! ${member.tier_name} member - ${blendWelcome(member)}`
        : overLimit
        ? `Welcome back, ${member.name}! ${limitMessage} You can still book at regular price.`
        : `Welcome back, ${member.name}! ${member.tier_name} member — ${member.discount_type === 'percentage' ? member.discount_value+'% off' : member.discount_type === 'fixed' ? '$'+member.discount_value+' off' : member.discount_type === 'free_hours' ? member.discount_value+' free hrs' : 'member pricing'} applied.`
    });

  } catch (err) { res.status(500).json({ valid: false, message: 'Error validating PIN.' }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MEMBER PORTAL (public — members log in with name + PIN)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/members/portal — member self-service login
// POST /api/members/:id/cancel — admin cancels a membership.
// mode 'period_end': billing stops at period end, benefits continue until then.
// mode 'now': immediate — subscription canceled and member deactivated.
router.post('/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const m = db().prepare(`SELECT * FROM members WHERE id=?`).get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Member not found' });
    const mode = req.body?.mode === 'period_end' ? 'period_end' : 'now';
    if (m.stripe_subscription_id) {
      // Stripe's refusal STOPS the cancel (Oct 3 2026): it was printed to the console and the member marked cancelled
      // anyway, while Stripe kept billing them. Nothing is changed here unless the billing really stopped.
      try { await require('../services/membership-billing').stopBilling(m.stripe_subscription_id, mode === 'period_end'); }
      catch (e) {
        const why = String((e && e.message) || 'no answer from Stripe').slice(0, 200);
        adminLog('MEMBER_CANCEL_FAILED', `${m.name} (${mode}) | Stripe did not cancel the subscription: ${why} - the member was NOT cancelled and is still billed`);
        return res.status(502).json({ error: `Stripe did not cancel this membership's billing (${why}). Nothing was changed - the member is still billed. Try again, or cancel the subscription in Stripe's dashboard.` });
      }
    }
    if (mode === 'period_end' && m.stripe_subscription_id) {
      db().prepare(`UPDATE members SET cancel_at_period_end=1 WHERE id=?`).run(m.id);
    } else {
      db().prepare(`UPDATE members SET status='inactive', sub_status=CASE WHEN stripe_subscription_id!='' THEN 'canceled' ELSE sub_status END WHERE id=?`).run(m.id);
      unifiMemberHook(m.id);
      familyFollows(m, 'inactive');
    }
    adminLog('MEMBER_CANCELED_ADMIN', `${m.name} (${mode})`);
    if (mode === 'period_end' && m.email) {
      try {
        const email = require('../services/email');
        if (email.sendCancellationConfirmed) {
          await email.sendCancellationConfirmed({ to: m.email, name: m.name, ends: (m.current_period_end || '').slice(0, 10) });
        }
      } catch {}
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/members/:id/extend — admin sets/extends the membership end date.
router.post('/:id/extend', requireAdmin, (req, res) => {
  try {
    const m = db().prepare(`SELECT * FROM members WHERE id=?`).get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Member not found' });
    const d = String(req.body?.current_period_end || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
    db().prepare(`UPDATE members SET current_period_end=?, status='active' WHERE id=?`).run(d + 'T23:59:59.000Z', m.id);
    unifiMemberHook(m.id);
    adminLog('MEMBER_EXTENDED', `${m.name} -> ${d}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/portal', (req, res) => {
  try {
    const { pin, name } = req.body;
    if (!pin?.trim() || !name?.trim()) return res.status(400).json({ error: 'Please enter your name and PIN.' });

    const member = require('../services/db').getMemberByPin(pin.trim());
    if (!member) return res.status(401).json({ error: 'Invalid PIN.' });
    res.locals.pinOk = true;   // a right code never spends the guess budget

    // Verify name matches (case-insensitive, loose match)
    const memberNameLower = member.name.toLowerCase().trim();
    const inputNameLower  = name.toLowerCase().trim();
    if (!memberNameLower.includes(inputNameLower) && !inputNameLower.includes(memberNameLower)) {
      return res.status(401).json({ error: 'Name and PIN do not match.' });
    }

    const dbMod = require('../services/db');
    const now = new Date();
    const todayStr = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    const { weekStart, weekEnd } = getWeekBounds(todayStr);
    const { monthStart, monthEnd } = getMonthBounds(todayStr);

    const todayMins = dbMod.getMemberUsageForDay(member.id, todayStr);
    const weekMins  = dbMod.getMemberUsageForWeek(member.id, weekStart, weekEnd);
    const monthMins = dbMod.getMemberUsageForMonth(member.id, monthStart, monthEnd);
    const guestCount = dbMod.getMemberGuestCountForMonth(member.id, monthStart, monthEnd);

    // Recent bookings
    const recentBookings = db().prepare(
      `SELECT mu.date, mu.duration_minutes, mu.guest_count, b.bay_name, b.start_time, b.end_time
       FROM member_usage mu LEFT JOIN bookings b ON mu.booking_id = b.id
       WHERE mu.member_id=? ORDER BY mu.date DESC, b.start_time DESC LIMIT 20`
    ).all(member.id);

    // Upcoming bookings
    const upcomingBookings = db().prepare(
      `SELECT b.date, b.start_time, b.end_time, b.bay_name, b.duration_minutes, b.status
       FROM bookings b WHERE b.member_id=? AND b.date>=? AND b.status='active'
       ORDER BY b.date ASC, b.start_time ASC LIMIT 10`
    ).all(member.id, todayStr);

    // Tier details
    const tier = db().prepare(`SELECT * FROM membership_tiers WHERE id=?`).get(member.tier_id);

    res.json({
      // waiver on file with the membership (Sep 1 2026): the member sees the
      // date it runs out and is told to re-sign as it comes up
      waiver: (() => { try {
        const mw = require('../services/memberwaiver');
        if (mw.cfgWaiver().mode === 'off') return null;
        const st = mw.memberWaiverStatus(member.id);
        return { on_file: st.on_file, expired: st.expired, reason: st.reason, term: st.term, expires_at: st.expires_at, days_left: st.days_left, renew_due: st.renew_due };
      } catch { return null; } })(),
      family: (() => { try {
        const db2 = require('../services/db').db;
        const rootId = member.parent_member_id || member.id;
        const rows = db2.prepare(`SELECT id, name, pin, status, parent_member_id FROM members
          WHERE (id = ? OR parent_member_id = ?) AND id != ?
          ORDER BY parent_member_id, name`).all(rootId, rootId, member.id);
        return rows.map(x => ({ name: x.name, pin: x.pin, status: x.status, is_primary: !x.parent_member_id }));
      } catch { return []; } })(),
      credit_cents: (() => { try { const row = require('../services/db').db.prepare(`SELECT COALESCE(SUM(delta_cents),0) AS bal FROM member_credit WHERE member_id = ?`).get(member.id); return Math.max(0, row?.bal || 0); } catch { return 0; } })(),
      member: {
        name:       member.name,
        phone:      member.phone,
        email:      member.email,
        tier_name:  member.tier_name,
        badge_color: member.badge_color,
        member_since: member.created_at,
        billing_cadence: member.billing_cadence || '',
        sub_status: member.sub_status || '',
        current_period_end: member.current_period_end || '',
        cancel_at_period_end: !!member.cancel_at_period_end,
        online_billing: !!(member.stripe_subscription_id),
        next_amount: member.stripe_subscription_id
          ? (member.billing_cadence === 'annual' ? (tier?.price_annual || 0) : (tier?.price_monthly || 0))
          : 0
      },
      tier: tier ? {
        name:            tier.name,
        description:     tier.description,
        discount_type:   tier.discount_type,
        discount_value:  tier.discount_value,
        hours_per_day:   tier.hours_per_day,
        hours_per_week:  tier.hours_per_week,
        hours_per_month: tier.hours_per_month,
        allowed_days:    tier.allowed_days,
        earliest_time:   tier.earliest_time,
        latest_time:     tier.latest_time,
        guest_allowed:         tier.guest_allowed,
        guest_max_per_visit:   tier.guest_max_per_visit,
        guest_passes_per_month: tier.guest_passes_per_month,
        guest_pricing_type:    tier.guest_pricing_type,
        guest_pricing_value:   tier.guest_pricing_value,
        booking_window_days:   tier.booking_window_days
      } : null,
      usage: {
        today_minutes:  todayMins,
        today_hours:    Math.round(todayMins / 6) / 10,
        week_minutes:   weekMins,
        week_hours:     Math.round(weekMins / 6) / 10,
        month_minutes:  monthMins,
        month_hours:    Math.round(monthMins / 6) / 10,
        remaining_today_hrs:  tier && tier.hours_per_day > 0 ? Math.max(0, Math.round((tier.hours_per_day * 60 - todayMins) / 6) / 10) : null,
        remaining_week_hrs:   tier && tier.hours_per_week > 0 ? Math.max(0, Math.round((tier.hours_per_week * 60 - weekMins) / 6) / 10) : null,
        remaining_month_hrs:  tier && tier.hours_per_month > 0 ? Math.max(0, Math.round((tier.hours_per_month * 60 - monthMins) / 6) / 10) : null,
        guest_passes_used:      guestCount,
        guest_passes_remaining: tier && tier.guest_passes_per_month > 0 ? Math.max(0, tier.guest_passes_per_month - guestCount) : null,
        savings_ytd_cents: (() => { try {
          const row = require('../services/db').db.prepare(
            `SELECT COALESCE(SUM(s.member_discount_cents),0) AS d
               FROM settlements s JOIN bookings b ON b.id = s.booking_id
              WHERE b.member_id = ?
                AND strftime('%Y', s.settled_at) = strftime('%Y','now')`
          ).get(member.id);
          return Math.max(0, row?.d || 0);
        } catch { return 0; } })()
      },
      recent_bookings:   recentBookings,
      upcoming_bookings: upcomingBookings
    });
  } catch (err) { res.status(500).json({ error: 'Error loading portal.' }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  USAGE TRACKING (called internally after booking confirmed)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/members/record-usage — record member usage after booking
// REQUIRES ADMIN (maintainer, Sep 21 2026). This had no guard at all: any anonymous
// caller could insert member_usage and member_guests rows, burning a member's
// included hours and inflating the guest counts the allowance rules and the
// owner's numbers read. Nothing in the product calls it - the booking path
// writes usage through services/bookingledger and services/checkin - so the
// guard costs an owner nothing and closes a write into member data.
router.post('/record-usage', requireAdmin, (req, res) => {
  try {
    const { member_id, booking_id, date, duration_minutes, guest_count } = req.body;
    if (!member_id || !booking_id) return res.status(400).json({ error: 'Missing fields' });

    const id = uuidv4();
    db().prepare(`INSERT INTO member_usage (id, member_id, booking_id, date, duration_minutes, guest_count)
      VALUES (?,?,?,?,?,?)`)
    .run(id, member_id, booking_id, date, duration_minutes||0, guest_count||0);

    // Record guest log if guests were brought
    if (guest_count > 0) {
      const gId = uuidv4();
      db().prepare(`INSERT INTO member_guests (id, member_id, booking_id, date, guest_count)
        VALUES (?,?,?,?,?)`)
      .run(gId, member_id, booking_id, date, guest_count);
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN STATS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
