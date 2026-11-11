// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/db.js  —  SQLite Database (sql.js)
// ═══════════════════════════════════════════════════════════════════════════════

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

// BA_DB_PATH: tools (schema dump) and batteries point the database somewhere
// else. Never set on a unit - the file lives beside the tree, as always.
const DB_PATH = process.env.BA_DB_PATH || path.join(__dirname, '..', 'bookings.db');

// Internal sql.js database instance — set during initDb()
let _db = null;

// ── INIT ──────────────────────────────────────────────────────────────────────
// The additive schema (rule 14): CREATE IF NOT EXISTS and ALTER ... ADD COLUMN
// in try {} - idempotent, so it runs on every boot and after every reload().
function applySchema() {
  _db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id                    TEXT PRIMARY KEY,
    bay_id                TEXT NOT NULL DEFAULT 'any',
    bay_name              TEXT NOT NULL DEFAULT '',
    name                  TEXT NOT NULL,
    phone                 TEXT NOT NULL,
    email                 TEXT,
    date                  TEXT NOT NULL,
    start_time            TEXT NOT NULL,
    end_time              TEXT NOT NULL,
    end_date              TEXT,
    duration_minutes      INTEGER NOT NULL,
    price_cents           INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'pending_payment',
    stripe_payment_intent TEXT,
    stripe_charge_id      TEXT,
    refunded_at           TEXT,
    door_code             TEXT,
    remotelock_person_id  TEXT,
    sms_confirmation_sent INTEGER DEFAULT 0,
    sms_reminder_sent     INTEGER DEFAULT 0,
    sms_code_sent         INTEGER DEFAULT 0,
    shelly_triggered      INTEGER DEFAULT 0,
    shutdown_warned       INTEGER DEFAULT 0,
    shutdown_sent         INTEGER DEFAULT 0,
    waiver_id             TEXT,
    waiver_agreed_at      TEXT,
    waiver_ip             TEXT,
    signature_name        TEXT,
    session_ending_warned INTEGER DEFAULT 0,
    sms_consent           INTEGER DEFAULT 0,
    is_deposit            INTEGER DEFAULT 0,
    member_id             TEXT,
    member_guest_count    INTEGER DEFAULT 0,
    created_at            TEXT DEFAULT (datetime('now')),
    updated_at            TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS admin_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event      TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS waivers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    filename    TEXT NOT NULL,
    version     TEXT NOT NULL,
    description TEXT,
    active      INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  )`);

  _db.run(`CREATE TABLE IF NOT EXISTS signed_waivers (
    id              TEXT PRIMARY KEY,
    booking_id      TEXT NOT NULL,
    waiver_id       TEXT NOT NULL,
    waiver_name     TEXT NOT NULL,
    waiver_version  TEXT NOT NULL,
    customer_name   TEXT NOT NULL,
    customer_phone  TEXT NOT NULL,
    agreed_at       TEXT NOT NULL,
    ip_address      TEXT,
    signature_name  TEXT,
    signed_pdf_path TEXT,
    bay_name        TEXT,
    session_date    TEXT,
    session_time    TEXT
  )`);

  // ── PRICING TIERS ──────────────────────────────────────────────────────────
  _db.run(`CREATE TABLE IF NOT EXISTS pricing_tiers (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    days         TEXT NOT NULL,
    start_time   TEXT NOT NULL,
    end_time     TEXT NOT NULL,
    price_per_half_hour REAL NOT NULL,
    active       INTEGER DEFAULT 1,
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  )`);

  // ── DISCOUNT CODES ──────────────────────────────────────────────────────────
  _db.run(`CREATE TABLE IF NOT EXISTS discount_codes (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    description     TEXT,
    type            TEXT NOT NULL,
    value           REAL NOT NULL,
    max_uses        INTEGER,
    uses_count      INTEGER DEFAULT 0,
    per_phone_limit INTEGER DEFAULT 1,
    expires_at      TEXT,
    active          INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
  )`);

  // ── DISCOUNT CODE USES ───────────────────────────────────────────────────────
  _db.run(`CREATE TABLE IF NOT EXISTS discount_uses (
    id          TEXT PRIMARY KEY,
    code_id     TEXT NOT NULL,
    booking_id  TEXT NOT NULL,
    phone       TEXT NOT NULL,
    discount_cents INTEGER NOT NULL,
    used_at     TEXT DEFAULT (datetime('now'))
  )`);

  // ── MONEY THAT CANNOT BE WORKED OUT LATER (maintainer, Sep 23 2026) ──
  // Revenue is money taken minus refunds (services/revenue.js). Two facts are
  // gone the moment they happen unless they are written down: how much a refund
  // gave back (a half refund and a full one leave the same refunded_at), and what
  // a membership payment was (Stripe holds the invoice; the unit only moved a
  // date). Each row is keyed by Stripe's own id, so a retry writes nothing twice.
  _db.run(`CREATE TABLE IF NOT EXISTS refunds (
    id           TEXT PRIMARY KEY,
    booking_id   TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    at           TEXT NOT NULL,
    source       TEXT DEFAULT ''
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS membership_payments (
    invoice_id      TEXT PRIMARY KEY,
    member_id       TEXT DEFAULT '',
    subscription_id TEXT DEFAULT '',
    amount_cents    INTEGER NOT NULL,
    tax_cents       INTEGER DEFAULT 0,
    paid_at         TEXT NOT NULL,
    source          TEXT DEFAULT ''
  )`);

  // ── GIFT-CARD CHECKOUTS THIS UNIT STARTED (Oct 3 2026) ──
  // A gift paid by Klarna, Cash App, a bank payment, or by a buyer whose browser never came back finishes after the
  // page has gone. Each checkout's payment id is kept here (no person: the id, when, and whether its card was issued)
  // so services/gifts.js can ask Stripe about exactly these and issue the card once the money lands.
  _db.run(`CREATE TABLE IF NOT EXISTS gift_checkouts (
    pi_id      TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    status     TEXT DEFAULT 'open',
    mode       TEXT DEFAULT ''
  )`);
  // which of Stripe's two modes made it ('live' / 'test'): a checkout made while the owner practised with Sandbox keys is
  // never asked about with the live key (Stripe's "similar object exists in test mode" reads as a wrong-key fault)
  try { _db.run(`ALTER TABLE gift_checkouts ADD COLUMN mode TEXT DEFAULT ''`); } catch {}

  // ── MEMBERSHIP TIERS ──────────────────────────────────────────────────────────
  _db.run(`CREATE TABLE IF NOT EXISTS membership_tiers (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    description           TEXT DEFAULT '',
    badge_color           TEXT DEFAULT '#c9a227',
    discount_type         TEXT NOT NULL DEFAULT 'percentage',
    discount_value        REAL NOT NULL DEFAULT 0,
    hours_per_day         REAL DEFAULT 0,
    hours_per_week        REAL DEFAULT 0,
    hours_per_month       REAL DEFAULT 0,
    allowed_days          TEXT DEFAULT '',
    earliest_time         TEXT DEFAULT '',
    latest_time           TEXT DEFAULT '',
    allowed_bays          TEXT DEFAULT '',
    booking_window_days   INTEGER DEFAULT 0,
    guest_allowed         INTEGER DEFAULT 0,
    guest_max_per_visit   INTEGER DEFAULT 0,
    guest_passes_per_month INTEGER DEFAULT 0,
    guest_pricing_type    TEXT DEFAULT 'free',
    guest_pricing_value   REAL DEFAULT 0,
    max_active_bookings   INTEGER DEFAULT 0,
    price_monthly         REAL DEFAULT 0,
    price_annual          REAL DEFAULT 0,
    grace_days            INTEGER DEFAULT 14,
    roster_cap            INTEGER DEFAULT 0,
    sell_online           INTEGER DEFAULT 0,
    stripe_product_id     TEXT DEFAULT '',
    over_limit_discount_type  TEXT DEFAULT '',
    over_limit_discount_value REAL DEFAULT 0,
    guest_overflow_price      REAL DEFAULT 0,
    guest_pricing_basis       TEXT DEFAULT 'booking',
    deposit_mode              INTEGER DEFAULT 0,
    share_discount_pct        REAL DEFAULT 0,
    codes_included            INTEGER DEFAULT 1,
    sort_order            INTEGER DEFAULT 0,
    active                INTEGER DEFAULT 1,
    created_at            TEXT DEFAULT (datetime('now'))
  )`);

  // ── MEMBERS ────────────────────────────────────────────────────────────────────
  _db.run(`CREATE TABLE IF NOT EXISTS members (
    id         TEXT PRIMARY KEY,
    tier_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    email      TEXT DEFAULT '',
    pin        TEXT NOT NULL UNIQUE,
    status     TEXT NOT NULL DEFAULT 'active',
    stripe_customer_id     TEXT DEFAULT '',
    stripe_subscription_id TEXT DEFAULT '',
    billing_cadence        TEXT DEFAULT '',
    sub_status             TEXT DEFAULT '',
    current_period_end     TEXT DEFAULT '',
    past_due_since         TEXT DEFAULT '',
    cancel_at_period_end   INTEGER DEFAULT 0,
    annual_reminder_sent   TEXT DEFAULT '',
    notes      TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // ── MEMBER USAGE — tracks hours used per booking ───────────────────────────
  _db.run(`CREATE TABLE IF NOT EXISTS member_usage (
    id               TEXT PRIMARY KEY,
    member_id        TEXT NOT NULL,
    booking_id       TEXT NOT NULL,
    date             TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    guest_count      INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now'))
  )`);

  // ── MEMBER GUEST LOG — individual guest visit tracking ─────────────────────
  _db.run(`CREATE TABLE IF NOT EXISTS member_guests (
    id         TEXT PRIMARY KEY,
    member_id  TEXT NOT NULL,
    booking_id TEXT NOT NULL,
    date       TEXT NOT NULL,
    guest_count INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ── WEBSITE CMS — landing page content, events, staffed-hours calendar ────
  // website_content: one row per page section, value is a JSON blob.
  // website_events: upcoming events shown on the landing/events pages; past
  //   events auto-expire from public payloads (event_date >= today).
  // staffed_days: per-DATE rows (not a weekly pattern) so removing one
  //   Saturday is trivial and each date is its own fact.
  _db.run(`CREATE TABLE IF NOT EXISTS website_content (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  // website_content_history (B-wave 1, Sep 11 2026): every save of a website
  // card keeps the value it REPLACED, so an owner can put a card back the way
  // it was ("Previous versions" on every card). Additive; the newest thirty
  // per key are kept. A restore goes through the same save, so the version
  // it replaced is kept too - a restore can itself be undone.
  _db.run(`CREATE TABLE IF NOT EXISTS website_content_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    saved_at   TEXT NOT NULL DEFAULT (datetime('now')),
    saved_by   TEXT DEFAULT ''
  )`);
  try { _db.run(`CREATE INDEX IF NOT EXISTS idx_wch_key ON website_content_history (key, id)`); } catch {}
  // sms_optouts (Sep 6 2026, hardening wave): a phone that texted STOP. The
  // carrier-side block only exists on Twilio; the unit keeps its own list so
  // no provider, no reseed and no new booking can text that number again
  // until it texts START. Key = the digits, last ten (US numbers).
  _db.run(`CREATE TABLE IF NOT EXISTS sms_optouts (
    phone        TEXT PRIMARY KEY,
    opted_out_at TEXT DEFAULT (datetime('now')),
    source       TEXT,
    keyword      TEXT
  )`);
  // website_inquiries (Sep 5 2026, website builder wave D): what visitors send
  // through the Inquiry form block - kept on the unit so nothing is lost when
  // the email is not configured; status new|handled.
  _db.run(`CREATE TABLE IF NOT EXISTS website_inquiries (
    id          TEXT PRIMARY KEY,
    created_at  TEXT DEFAULT (datetime('now')),
    name        TEXT,
    email       TEXT,
    phone       TEXT,
    want_date   TEXT,
    people      TEXT,
    message     TEXT,
    block       TEXT,
    ip          TEXT,
    status      TEXT DEFAULT 'new',
    emailed     INTEGER DEFAULT 0
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS website_events (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    event_date  TEXT NOT NULL,
    description TEXT,
    flyer       TEXT,
    link        TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS staffed_days (
    date       TEXT PRIMARY KEY,
    start_time TEXT,
    end_time   TEXT,
    note       TEXT
  )`);

  // ── INDEXES — fast lookups on frequently queried columns ──────────────────
  // IF NOT EXISTS prevents errors on restart
  _db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_date_bay ON bookings (date, bay_id)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (phone)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings (email)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_date_status ON bookings (date, status)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_discount_uses_phone ON discount_uses (phone)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_discount_uses_code ON discount_uses (code_id)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_signed_waivers_booking ON signed_waivers (booking_id)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log (created_at)`);
  // by event too (Sep 25 2026, the build review): the health line, the plug probe and the checkout
  // signal ask for one event every minute, and each ask was a scan of a year of the owner's log
  try { _db.run(`CREATE INDEX IF NOT EXISTS idx_admin_log_event ON admin_log (event, id)`); } catch {}

  // ── COLUMN MIGRATIONS — safely add columns for upgrades ───────────────────
  try { _db.run(`ALTER TABLE bookings ADD COLUMN member_id TEXT`); } catch {}
  // PACKAGE DEALS (Oct 22 2026 - services/packages.js): the package a booking was bought with, and its own copy of
  // it as bought (what it includes, its players, its price and tax) - a later change to the package never changes the booking.
  // And a booking deal that priced it (services/deals.js): its name and what it took off, as charged
  try { _db.run(`ALTER TABLE bookings ADD COLUMN package_id TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN package_name TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN package_json TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN deal_name TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN deal_cents INTEGER DEFAULT 0`); } catch {}
  // and what a booking comes with from a free-things deal ("book 2 hours, 2 pitchers free"), as it stood when booked - Oct 22 2026
  try { _db.run(`ALTER TABLE bookings ADD COLUMN deal_items_json TEXT DEFAULT ''`); } catch {}
  // UniFi Access: per-tier extra doors/groups a member's booking code unlocks
  // (JSON array of 'door:<id>' / 'group:<id>' strings). Additive, default ''.
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN unifi_doors TEXT DEFAULT ''`); } catch {}
  // Blend memberships (Aug 2026): where this tier's golf money settles.
  // 'online' = charged at booking (every tier before this feature).
  // 'door'   = member golf lands on their tab at staff check-in; nothing online.
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN settlement_mode TEXT DEFAULT 'online'`); } catch {}
  // Member Access Network: always-on doors per tier + the console user ref
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN unifi_static_doors TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_user_id TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN member_guest_count INTEGER DEFAULT 0`); } catch {}
  // Blend memberships: the member's blended price is DECIDED AT BOOKING and
  // stored - the counter reads it back, so a later same-day booking can never
  // reshuffle whose hour was free (the price you saw is the price you pay).
  try { _db.run(`ALTER TABLE bookings ADD COLUMN member_due_cents INTEGER`); } catch {}
  // WHEN THE CUSTOMER ACTUALLY AGREED, and from where (maintainer, Sep 19 2026).
  // signed_waivers.agreed_at is stamped datetime('now') at INSERT, which is
  // right only while the record is written seconds later inside /confirm. A
  // booking rescued by the checkout sweeper records minutes late, and stamping
  // the sweeper's clock would be a WRONG record under rule 15, not a late one.
  // waiver_ip has been read by bookingledger for months and never existed.
  // WHETHER THE MONEY WENT BACK, ON THE ROW (maintainer, Sep 20 2026). The product
  // refunds in six places and recorded it only in the owner's log, so nothing
  // could ask "is anyone still owed money" without re-reading Stripe booking by
  // booking. The health line needs that answer every minute, and a customer who
  // has been made whole should stop showing up as one who has not.
  try { _db.run(`ALTER TABLE bookings ADD COLUMN refunded_at TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN waiver_agreed_at TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN waiver_ip TEXT`); } catch {}
  // THE DOOR CODE'S OWN STATE (feature/door-interface, Sep 21 2026). Create and
  // text used to be one act; now a code is created, CONFIRMED, and only then
  // texted. state: pending | held | unknown | failed. polls counts confirm
  // attempts for the late-booking hold. door_fallback_code is the standing
  // backup code texted alongside when the real one never confirmed.
  // door_used_at is stamped when the lock reports the code used at the keypad.
  try { _db.run(`ALTER TABLE bookings ADD COLUMN door_code_state TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN door_code_created_at TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN door_code_polls INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN door_code_polled_at TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN door_fallback_code TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN door_used_at TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN signature_name TEXT`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN session_ending_warned INTEGER DEFAULT 0`); } catch {}
  // sms_consent: default 1 so existing/legacy bookings still receive texts.
  // New bookings set 0 explicitly when the customer leaves the (optional) box unchecked.
  try { _db.run(`ALTER TABLE bookings ADD COLUMN sms_consent INTEGER DEFAULT 0`); } catch {}
  // end_date: the calendar day a session ENDS. Defaults to the start date.
  // A session that ends at or after midnight stores end_date = date + 1.
  try { _db.run(`ALTER TABLE bookings ADD COLUMN end_date TEXT`); } catch {}
  // updated_at: written by scheduler/checkin/bookingedit and 6 route files.
  // Present in the fresh CREATE TABLE but ABSENT from legacy bookings tables
  // that predate it - and an UPDATE naming a missing column throws. (Adjacent
  // find during the #1 legacy-boot sweep, maintainer/pilot facility Aug 15.)
  try { _db.run(`ALTER TABLE bookings ADD COLUMN updated_at TEXT`); } catch {}
  // tax_cents: the sales tax collected on THIS booking, stored at creation so
  // revenue reporting sums real collected tax instead of reverse-engineering it
  // from a rate that may have changed since. (#9 accountant reporting, Aug 15.)
  try { _db.run(`ALTER TABLE bookings ADD COLUMN tax_cents INTEGER DEFAULT 0`); } catch {}
  // booking_type: 'customer' (default) or a BLOCK type (event/tournament/
  // maintenance). Blocks reserve a bay so customers can't book it, but they are
  // not customer bookings - no door code, no revenue, and 'maintenance' skips
  // all automation. (Admin bay-blocking for events/maintenance, maintainer Aug 15.)
  try { _db.run(`ALTER TABLE bookings ADD COLUMN booking_type TEXT DEFAULT 'customer'`); } catch {}

  // ── WAVE B (staff surface): per-seat check-in ─────────────────────────────
  // One row per person in a checked-in group. tab_id links their POS tab;
  // waiver_signed_id links their signed_waivers row; golf_cents is THEIR golf
  // share as settled (0 for prepaid / covered seats). Additive, boot-safe.
  _db.run(`CREATE TABLE IF NOT EXISTS seats (
    id               TEXT PRIMARY KEY,
    booking_id       TEXT NOT NULL,
    name             TEXT NOT NULL,
    member_id        TEXT,
    tab_id           TEXT,
    waiver_signed_id TEXT,
    pass_covered     INTEGER DEFAULT 0,
    golf_cents       INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now'))
  )`);
  try { _db.run(`CREATE INDEX IF NOT EXISTS idx_seats_booking ON seats (booking_id)`); } catch {}
  // signed_waivers grows two columns: how it was signed (digital typed name vs
  // a one-tap paper attestation) and which employee handled it at the counter.
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN method TEXT DEFAULT 'digital'`); } catch {}
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN employee TEXT`); } catch {}
  // Waiver batch (Aug 2026): membership-long waivers + bulletproof identity.
  // scope: 'booking' (covers that visit) or 'membership' (rides the membership).
  // member_id anchors membership-scope rows; identity fields follow ESIGN/UETA
  // audit-trail best practice (user agent + SHA-256 of the exact PDF signed).
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN scope TEXT DEFAULT 'booking'`); } catch {}
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN member_id TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN customer_email TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN user_agent TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN doc_sha256 TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN guardian_for TEXT DEFAULT ''`); } catch {}
  // Per-tier waiver document (empty = the facility's active waiver).
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN waiver_id TEXT DEFAULT ''`); } catch {}
  // Per-tier waiver TERM (waiver audit, Sep 1 2026): '' = the facility's
  // "Membership waiver lasts" setting, else 'membership' | 'annual' | 'visit'
  // ('visit' = members of this tier sign every visit, like guests - day passes).
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN waiver_term TEXT DEFAULT ''`); } catch {}
  // Booking rows already carry waiver_id + signature_name; guardian capacity
  // and the signing browser's user agent join them so paid bookings can write
  // the full identity trail at confirmation time (signing happens at create).
  try { _db.run(`ALTER TABLE bookings ADD COLUMN waiver_guardian_for TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN waiver_user_agent TEXT DEFAULT ''`); } catch {}
  // Membership-waiver validity anchor: a signature only credits if signed at or
  // after the member's latest activation, so lapse-and-rejoin means sign again.
  try { _db.run(`ALTER TABLE members ADD COLUMN last_activated_at TEXT DEFAULT ''`); } catch {}
  try { _db.run(`UPDATE members SET last_activated_at = created_at WHERE last_activated_at IS NULL OR last_activated_at = ''`); } catch {}
  // Membership billing (M1)
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN price_monthly REAL DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN price_annual REAL DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN grace_days INTEGER DEFAULT 14`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN roster_cap INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN sell_online INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN stripe_product_id TEXT DEFAULT ''`); } catch {}
  // Hybrid pricing: discount that applies AFTER hour limits are used up
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN over_limit_discount_type TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN over_limit_discount_value REAL DEFAULT 0`); } catch {}
  // MEMBER PERKS BEYOND GOLF (maintainer, Aug 11). A staffed facility may include
  // food and drink benefits in a membership - "10% off food and $1 off
  // drinks". Type is '' (none) | 'percent' | 'fixed'; fixed is per item.
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN food_discount_type TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN food_discount_value REAL DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN beverage_discount_type TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN beverage_discount_value REAL DEFAULT 0`); } catch {}
  // Guest overflow: $ per guest after monthly guest passes are used
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN guest_overflow_price REAL DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN guest_pricing_basis TEXT DEFAULT 'booking'`); } catch {}
  // THE GUEST LAW (Sep 1 2026): 1 once the tier editor has saved the guest
  // policy explicitly; legacy rows (0) keep their old counter meaning (see
  // services/guests.js effectiveGuestType). Bookings remember how many of
  // their guests were COVERED by passes, so confirm and the counter never
  // burn a pass twice.
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN guest_pricing_set INTEGER DEFAULT 0`); } catch {}
  // maintainer, Sep 1 2026: included guests PER VISIT (on top of any monthly passes) and
  // where guest fees are collected ('auto' follows the tier's settlement and
  // the staffing law, 'online' always with the booking, 'door' at the counter
  // wherever someone is there). A booking remembers what it collected online.
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN guest_included_per_visit INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN guest_collect TEXT DEFAULT 'auto'`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN guest_fee_online_cents INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN member_guest_covered INTEGER DEFAULT 0`); } catch {}
  // Deposit mode: the member's per-hour price is only a deposit; balance settled
  // at the door. share_discount_pct powers the per-headcount price table.
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN deposit_mode INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN share_discount_pct REAL DEFAULT 0`); } catch {}
  // SETTLEMENT FOR EVERY TIER STYLE (Aug 25, late): settlement_mode is now
  // 'online' | 'deposit' | 'door' for ANY discount type (blend kept its
  // online/door pair). deposit_mode stays as the compatibility flag and is
  // kept in sync on every save; existing deposit tiers are backfilled once.
  // deposit_per30 is the deposit for non-flat-rate tiers (a flat-rate tier in
  // deposit mode keeps Value as the deposit - the locked Aug 2026 model).
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN deposit_per30 REAL DEFAULT 0`); } catch {}
  try { _db.run(`UPDATE membership_tiers SET settlement_mode='deposit' WHERE deposit_mode=1 AND (settlement_mode IS NULL OR settlement_mode='' OR settlement_mode='online')`); } catch {}
  // Multi-code memberships: one purchase generates N codes (family/business).
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN codes_included INTEGER DEFAULT 1`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN parent_member_id TEXT DEFAULT ''`); } catch {}
  // CloudPRNT print queue: jobs survive restarts; printers poll and collect.
  _db.run(`CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    printer_id TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    created_at TEXT DEFAULT (datetime('now')),
    done_at TEXT DEFAULT ''
  )`);
  try { _db.run(`ALTER TABLE bookings ADD COLUMN is_deposit INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE print_jobs ADD COLUMN drawer INTEGER DEFAULT 0`); } catch {}
  // Group check-in settlements: one row per checked-in deposit booking.
  _db.run(`CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT NOT NULL UNIQUE,
    actual_golfers INTEGER NOT NULL,
    standard_total_cents INTEGER NOT NULL,
    member_share_cents INTEGER DEFAULT 0,
    member_discount_cents INTEGER DEFAULT 0,
    deposit_cents INTEGER DEFAULT 0,
    credit_to_member_cents INTEGER DEFAULT 0,
    collect_cents INTEGER DEFAULT 0,
    credit_mode TEXT DEFAULT 'member_tab',
    settled_by TEXT DEFAULT '',
    settled_at TEXT DEFAULT (datetime('now'))
  )`);
  // Member credit LEDGER: balance = SUM(delta_cents). Self-auditing; no balance
  // column to drift. Surplus deposits in, bookings out, expiries/refunds back in.
  _db.run(`CREATE TABLE IF NOT EXISTS member_credit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    delta_cents INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    booking_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  try { _db.run(`ALTER TABLE members ADD COLUMN stripe_customer_id TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN stripe_subscription_id TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN billing_cadence TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN sub_status TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN current_period_end TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN past_due_since TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0`); } catch {}

  // ── EMPLOYEES: SCHEDULING & TIME CLOCK (Sep 2026) ────────────────────────
  // Seven tables, all additive, plain indexes only (sql.js). staff_code is the
  // durable identity everywhere - names are display and get purged at the
  // retention floor (services/records.js). Times are stored twice on the
  // clock: a LOCAL 'YYYY-MM-DD HH:MM:SS' string that sorts and date()-filters
  // directly, and epoch ms for exact DST-safe durations.
  _db.run(`CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_code TEXT NOT NULL,
    staff_name TEXT DEFAULT '',
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    clock_in_ms INTEGER,
    clock_out_ms INTEGER,
    worked_minutes INTEGER,
    break_minutes INTEGER DEFAULT 0,
    source TEXT DEFAULT 'self',
    flagged INTEGER DEFAULT 0,
    flag_reason TEXT DEFAULT '',
    reviewed INTEGER DEFAULT 0,
    reviewed_by TEXT DEFAULT '',
    edited_by TEXT DEFAULT '',
    edited_at TEXT,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_time_entries_code_in ON time_entries (staff_code, clock_in)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_time_entries_out ON time_entries (clock_out)`);
  // W29 (Sep 3 2026): one row per hours period the scheduled send touched -
  // held (waiting for the owner), sent, skipped, failed (retried hourly).
  // The csv column is the exact bytes that went, so Resend last resends
  // them; sha256 lets a battery prove identity with the manual export.
  _db.run(`CREATE TABLE IF NOT EXISTS hours_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    status TEXT NOT NULL,
    how TEXT DEFAULT '',
    recipients TEXT DEFAULT '',
    cc TEXT DEFAULT '',
    people INTEGER DEFAULT 0,
    total_minutes INTEGER DEFAULT 0,
    bytes INTEGER DEFAULT 0,
    sha256 TEXT DEFAULT '',
    csv TEXT DEFAULT '',
    token TEXT DEFAULT '',
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT,
    approved_at TEXT,
    last_attempt_at TEXT
  )`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_hours_sends_period ON hours_sends (period_start, period_end)`);
  _db.run(`CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    staff_code TEXT,
    label TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts (date)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_shifts_code_date ON shifts (staff_code, date)`);
  _db.run(`CREATE TABLE IF NOT EXISTS shift_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS timeoff_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_code TEXT NOT NULL,
    staff_name TEXT DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    decided_by TEXT DEFAULT '',
    decided_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS shift_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    staff_code TEXT NOT NULL,
    staff_name TEXT DEFAULT '',
    kind TEXT NOT NULL,
    note TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    decided_by TEXT DEFAULT '',
    decided_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS coverage_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    shifts TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  try { _db.run(`ALTER TABLE coverage_templates ADD COLUMN shifts TEXT DEFAULT '[]'`); } catch {}
  _db.run(`CREATE TABLE IF NOT EXISTS coverage_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    staffed INTEGER DEFAULT 0,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_coverage_exceptions_date ON coverage_exceptions (date)`);
  // WHOLE-FACILITY RENTAL (Aug 2026): a booking born under facility mode is
  // stamped on its own row. The STAMP - never the live setting - decides
  // conflicts and automation for that booking forever, so flipping the mode
  // later can never change what an existing booking means.
  try { _db.run(`ALTER TABLE bookings ADD COLUMN whole_facility INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN annual_reminder_sent TEXT DEFAULT ''`); } catch {}
  // waiver renewal reminder once-guard: holds the expires_at it was sent for (Sep 1 2026)
  try { _db.run(`ALTER TABLE members ADD COLUMN waiver_reminder_sent TEXT DEFAULT ''`); } catch {}
  // A member's UniFi console user, written from THIS UNIT'S record of what it set (Sep 25 2026,
  // services/memberaccess.js): the PIN it last set, the status it last set, the policies it
  // last granted, and a change the console has not taken yet with its retry state.
  // THE COMMAND LEDGER (Sep 25 2026, services/devicelog.js): every command sent to a bay device,
  // by the scheduler or a person pressing Bay On / Bay Off - operational, pruned after 180 days
  try { _db.run(`CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device TEXT NOT NULL, bay_id TEXT DEFAULT '',
    op TEXT NOT NULL, source TEXT DEFAULT '', ok INTEGER DEFAULT 1, detail TEXT DEFAULT '',
    at TEXT DEFAULT (datetime('now')))`); } catch {}
  try { _db.run(`CREATE INDEX IF NOT EXISTS idx_device_commands ON device_commands (device, id)`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_pin_set TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_status TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_granted TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_dirty INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_attempts INTEGER DEFAULT 0`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_next_try TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE members ADD COLUMN unifi_error TEXT DEFAULT ''`); } catch {}
  // W37 (Sep 8 2026): the discount a booking was born with rides the ROW, so the
  // ledger can be written from the row alone at whichever moment the booking
  // becomes real. Before this, recordDiscountUse ran on the free and dev-mode
  // branches only - a code or gift card spent on a Stripe-paid booking was never
  // recorded anywhere, so a gift card never decremented and a limited code never
  // ran out (proved on the bench, docs/internal/w37-repro.js).
  try { _db.run(`ALTER TABLE bookings ADD COLUMN discount_code_id TEXT DEFAULT ''`); } catch {}
  // A CODE STAFF CHECK AT THE DOOR (Oct 22 2026, night - the research: military, first-responder, senior, student
  // rates are a code checked against an ID at the desk): what staff check, said on the booking's row and at check-in
  try { _db.run(`ALTER TABLE discount_codes ADD COLUMN door_check TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE bookings ADD COLUMN discount_cents INTEGER DEFAULT 0`); } catch {}
  // Oct 3 2026: WHEN a checkout became a booking (UTC, like created_at). created_at is when the checkout STARTED, so a
  // Klarna payment that finished after the reminder moment was texted its reminder a minute after its confirmation.
  // Written by /confirm and the sweeper's restore - the two places a pending_payment row turns active.
  try { _db.run(`ALTER TABLE bookings ADD COLUMN confirmed_at TEXT DEFAULT ''`); } catch {}
  // W37: WHERE a signature was captured, kept separately from WHAT it covers.
  // A membership-scope record must not carry a booking id - a waiver that
  // rides a membership is not an attendance record - but losing the booking it
  // was taken at would lose real provenance. So booking_id stays empty on a
  // membership row and captured_booking_id remembers the visit.
  try { _db.run(`ALTER TABLE signed_waivers ADD COLUMN captured_booking_id TEXT DEFAULT ''`); } catch {}
  // Backfill any existing rows: end_date = date where it's null (all pre-existing
  // bookings ended the same day since crossing midnight wasn't allowed before).
  try { _db.run(`UPDATE bookings SET end_date = date WHERE end_date IS NULL OR end_date = ''`); } catch {}
  try { _db.run(`ALTER TABLE membership_tiers ADD COLUMN max_active_bookings INTEGER DEFAULT 0`); } catch {}
  // EVERY REFUND, WHEREVER IT WAS MADE (maintainer, Sep 24 2026): a refund made in
  // Stripe's own dashboard is picked up (services/refunds.js), so `refunds` now
  // holds gift-card purchase and membership refunds too - `kind` says which
  // (booking rows are 'booking', as every row before this was), `ref` names the
  // gift card or invoice, `status` follows Stripe's (a refund that FAILS stops
  // counting), `payment_intent` is the payment it came off.
  try { _db.run(`ALTER TABLE refunds ADD COLUMN kind TEXT DEFAULT 'booking'`); } catch {}
  try { _db.run(`ALTER TABLE refunds ADD COLUMN ref TEXT DEFAULT ''`); } catch {}
  try { _db.run(`ALTER TABLE refunds ADD COLUMN status TEXT DEFAULT 'succeeded'`); } catch {}
  try { _db.run(`ALTER TABLE refunds ADD COLUMN payment_intent TEXT DEFAULT ''`); } catch {}

  // ── MEMBER-DEPENDENT INDEXES — created AFTER the column migrations above ───
  // (maintainer/pilot facility rebase, Aug 15: on a LEGACY database these columns do not exist
  // until the ALTERs run. Creating an index on member_id BEFORE the ALTER
  // boot-crashes with "no such column: member_id". A fresh install never sees
  // it; any migrated or restored DB does. These must live here, last.)
  try { _db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_member ON bookings (member_id)`); } catch {}
  try { _db.run(`CREATE INDEX IF NOT EXISTS idx_member_usage_member_date ON member_usage (member_id, date)`); } catch {}
  try { _db.run(`CREATE INDEX IF NOT EXISTS idx_member_guests_member_date ON member_guests (member_id, date)`); } catch {}

}

async function initDb() {
  sweepTmp();
  const SQL = await initSqlJs();
  _SQL = SQL; guardStack(SQL);
  const existed = fs.existsSync(DB_PATH);
  _db = existed
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
  _savedMark = existed ? changeMark() : null;   // a new, empty database has nothing on disk yet

  // W44 (Sep 10 2026): the schema block is ONE function, run at boot AND after
  // every reload() - a backup from an older unit restored through the wizard
  // or the Backups card used to keep its old schema in memory (and on disk)
  // until the next restart; any route touching a newer table failed until then.
  applySchema();

  // ── AUTO-SAVE — write to disk every 30 seconds ────────────────────────────
  // sql.js runs in-memory; if Pi loses power between saves, data is lost.
  // This keeps max data loss to 30 seconds.
  // W40 (Sep 9 2026): the tick used to call save() unconditionally - a full
  // rewrite of the file every 30 s whether or not anything changed, from EVERY
  // process that ever called initDb(). Six forgotten `node -e` one-liners on the
  // bench each held a stale copy and rewrote the live database every 30 s for a
  // day. The tick is now a backstop only: it writes when a change is pending,
  // and the ownership check below refuses a stale writer outright.
  // Only the process that CLAIMED the writer's role (server.js, right after
  // initDb) runs the tick and the exit flush - they are the safety net for the
  // routes that write through the raw handle without marking anything dirty.
  // A process that never claims (a one-liner, a battery reading state) has no
  // automatic write at all; its explicit saveDb() still works, ownership-checked.
  if (!global._dbAutoSaveStarted) {
    global._dbAutoSaveStarted = true;
    _tick = setInterval(() => {
      // Oct 8 2026: it wrote the whole file every 30 s whether or not anything had changed - the comment above
      // said "when a change is pending" and the code did not. It still catches a write that never scheduled a
      // save (total_changes counts every change on the connection, whatever path made it).
      if (_writer && engineCheck('the 30-second check')) return;   // a broken engine is never written to; the process restarts
      try { if (_writer && (_savedMark === null || changeMark() !== _savedMark)) flushSync(); } catch (e) { saveFailed('the 30-second save', e); }
    }, Number(process.env.BA_TEST_DB_TICK_MS) || 30000);
  }
  if (_stackBase === null) { try { _stackBase = SQL.stackSave(); } catch {} }   // where the stack rests between calls

  // ── ADMIN LOG — kept by AGE, never by row count (maintainer, Sep 12 2026) ────────
  // The old rule kept the last 5,000 rows: the aged hybrid year showed that is
  // about two months of a busy facility's owner log. Now the owner's log is
  // kept for at least twelve months whatever the volume (records.adminLogMonths,
  // floor 12, the owner may set longer) and pruned by age here at boot and by
  // the records job each night. Whatever a year generates is still there at
  // the end of it.
  try { _bootPruned = pruneAdminLog({ persist: false }); } catch {}

  // W40: a file that already exists is NOT rewritten at load. The migrations
  // above are idempotent and live in memory until this process's first real
  // write; rewriting an unchanged file here was the one write every
  // maintenance one-liner made - a new inode the live server then saw as
  // foreign. A fresh database is created on disk now, as before.
  if (!existed) flushSync();
  _owned = stampNow();
  console.log('✅ Database ready ->', DB_PATH);
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
// W22 (bench load test, Sep 2 2026): every statement used to rewrite the whole
// database file synchronously - open-with-truncate, write, close - on the
// request path. On the Pi's SD card that open waited on the card's writeback
// of the previous rewrite, so ONE booking (a dozen statements) blocked the
// event loop for 1.5 s and six people booking at once stalled the server for
// twenty seconds. Now:
//   - statements mark the database dirty; ONE write is coalesced 40 ms after
//     the last statement (never later than 500 ms after the first);
//   - the write goes to bookings.db.tmp and is renamed into place, so the
//     live file is never truncated and a power cut mid-write can no longer
//     leave a half-written database (it used to);
//   - the write itself is asynchronous - the request path only pays for the
//     in-memory export (under a millisecond);
//   - flushSync() is the synchronous, immediate write: exit, restore, backups
//     and batteries use it. saveDb() is its public name.
// W23 (Sep 2 2026) - what a power cut can still lose, written down:
//   - the tmp file is fdatasync'd before the rename (both paths), so once the
//     rename is on disk the new file's bytes are too. Without it durability
//     waited on the kernel's journal commit, about five seconds on ext4.
//   - the residual window is the coalesce delay: a statement acknowledged to
//     the client in the last 40 ms (500 ms at most, under a steady stream)
//     plus the write itself (tens of ms on the SD card) is not on disk yet.
//     A booking confirmed on screen and charged by Stripe inside that window
//     is gone after a cut; the file is a complete older copy, never a torn
//     one. Before W22 the exposure was the same five seconds with the added
//     risk of a truncated file, so this is strictly smaller.
//   - the directory is fsync'd after the rename so the new name is durable
//     too; a cut between rename and that fsync shows the previous complete
//     file, never a torn one.
// W23b (bench, Sep 2 2026): the synchronous flush (a backup, a counter save,
// exit) and the asynchronous write used to share ONE tmp name. A flush while
// an async write was in flight truncated the file the async writer was still
// writing, renamed that torn file into place, and the async rename then
// failed with ENOENT (seen in the Pi's log). Now every write gets its own tmp
// name, and a sync flush bumps the generation so a superseded async write
// deletes its tmp instead of renaming an OLDER export over the newer one.
const SAVE_DELAY_MS = 40, SAVE_MAX_MS = 500;
let _dirty = false, _timer = null, _firstDirtyAt = 0, _writing = null, _again = false, _gen = 0, _tmpSeq = 0;
// what the file on disk holds, as SQLite counts it (Oct 8 2026): taken right after every load (before the schema is
// brought current, so a migration still counts as a change) and right after every export - an export closes and
// reopens the database inside sql.js, which resets total_changes() to zero
let _savedMark = null;
function tmpName() { return `${DB_PATH}.tmp-${process.pid}-${++_tmpSeq}`; }
function sweepTmp() {   // leftovers from a cut or a kill mid-write
  try { for (const f of fs.readdirSync(path.dirname(DB_PATH))) if (f.startsWith(path.basename(DB_PATH) + '.tmp')) { try { fs.unlinkSync(path.join(path.dirname(DB_PATH), f)); } catch {} } } catch {}
}
// ── ONE WRITER (W40, Sep 9 2026) ────────────────────────────────────────────
// The file on disk belongs to whichever process last loaded or wrote it. Every
// write first checks that the file is still the one THIS process last saw
// (inode, mtime, size). If another process has written it since, ours is a
// STALE copy and writing it would throw that work away - so the write is
// refused, said once in the log, and this process re-reads the file so its
// memory follows the disk. The server is the only legitimate writer and never
// trips this; a forgotten maintenance one-liner does, and now does no harm.
let _owned = null, _ownedNext = null, _tick = null, _staleSaid = false, _writer = false, _bootPruned = 0;
// The writer, and only the writer, puts the boot prune on disk - and says so in the
// owner's own log, so a restored unit does not silently lose a year of its history
// on its first restart with nothing anywhere to read.
function claimWriter() {
  _writer = true;
  noteEngineRestart();
  if (process.env.BA_TEST_DB_BREAK_AFTER_MS) setTimeout(() => { try { testBreakEngine(process.env.BA_TEST_DB_BREAK_KIND || 'burn'); } catch (e) { console.error('test break: ' + e.message); } }, Number(process.env.BA_TEST_DB_BREAK_AFTER_MS)).unref?.();
  try {
    const n = _bootPruned + pruneAdminLog({ persist: false });
    if (n > 0) { adminLog('ADMIN_LOG_PRUNED', `${n} entr${n === 1 ? 'y' : 'ies'} older than ${adminLogMonths()} months removed at start-up (the owner's log is kept by age; Settings > Protection > Records sets how long)`); save(); }
  } catch {}
  _bootPruned = 0;
}
function stampNow() { try { const st = fs.statSync(DB_PATH); return { ino: st.ino, mtimeMs: st.mtimeMs, size: st.size }; } catch { return null; } }
function sameStamp(a, b) { return !!a && !!b && a.ino === b.ino && a.mtimeMs === b.mtimeMs && a.size === b.size; }
// true when the file on disk is not the one this process last loaded or wrote
// (_ownedNext is our own async write between its rename and the moment the
// callback records it - a sync flush landing in that gap must not read our own
// file as foreign and throw away everything since the export; W40e, the Pi)
function stampOf(f) { try { const st = fs.statSync(f); return { ino: st.ino, mtimeMs: st.mtimeMs, size: st.size }; } catch { return null; } }
function foreignOnDisk() { const now = stampNow(); return !!(_owned && now && !sameStamp(now, _owned) && !sameStamp(now, _ownedNext)); }
let _staleCount = 0, _staleLast = 0;
function staleRefusals() { return { count: _staleCount, last: _staleLast }; }   // rule 23: the health line reads it
// The owner's log is pruned by AGE (rule: at least twelve months, never fewer).
const ADMIN_LOG_FLOOR_MONTHS = 12;
function adminLogMonths() {
  try { const n = parseInt(require('./config').getConfig().records?.adminLogMonths, 10); return Number.isFinite(n) ? Math.max(ADMIN_LOG_FLOOR_MONTHS, n) : ADMIN_LOG_FLOOR_MONTHS; } catch { return ADMIN_LOG_FLOOR_MONTHS; }
}
// persist=false: delete in MEMORY only, never schedule a write. The boot prune uses
// it, because initDb() runs in every process that loads the database - a battery, a
// tool, a one-liner - and save() there renames a whole snapshot over bookings.db,
// which is precisely the W40 incident (a new inode the live server then refuses as
// foreign, DB_STALE_WRITER_REFUSED, and the rows it had acknowledged but not yet
// flushed are gone). The claimed writer persists it when it claims.
function pruneAdminLog({ persist = true } = {}) {
  if (!_db) return 0;
  const months = adminLogMonths();
  const before = (() => { try { return all(`SELECT COUNT(*) AS c FROM admin_log WHERE created_at < datetime('now', ?)`, '-' + months + ' months')[0].c; } catch { return 0; } })();
  if (before > 0) { _db.run("DELETE FROM admin_log WHERE created_at < datetime('now', ?)", ['-' + months + ' months']); if (persist) save(); }
  return before;
}
function adminLogStats() {
  try {
    const o = all(`SELECT COUNT(*) AS rows, MIN(created_at) AS oldest, MAX(created_at) AS newest, SUM(LENGTH(event) + LENGTH(COALESCE(detail,'')) + 40) AS approx_bytes FROM admin_log`)[0];
    return { rows: o.rows, oldest: o.oldest, newest: o.newest, approxBytes: o.approx_bytes || 0, months: adminLogMonths(), floorMonths: ADMIN_LOG_FLOOR_MONTHS };
  } catch { return null; }
}
function refuseStale(where) {
  _staleCount++; _staleLast = Date.now();
  if (!_staleSaid) {
    _staleSaid = true;
    const now = stampNow();
    console.error(`DB_STALE_WRITER_REFUSED: ${where} - bookings.db on disk was written by another process (ino ${now && now.ino}, ${now && now.size} bytes) since this one last touched it (ino ${_owned && _owned.ino}, ${_owned && _owned.size} bytes). This process's copy is stale; nothing was written. Re-reading the file.`);
  }
  if (_tick) { clearInterval(_tick); _tick = null; }
  _dirty = false; _firstDirtyAt = 0; if (_timer) { clearTimeout(_timer); _timer = null; }
  reload().catch(() => {});
}
function writeAtomicSync() {
  if (foreignOnDisk()) { refuseStale('sync write'); return; }
  _gen++;                        // any async write still in flight is superseded
  const tmp = tmpName();
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, Buffer.from(exportNow())); _savedMark = changeMark(); fs.fdatasyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, DB_PATH);
  } catch (e) { _savedMark = null; try { fs.unlinkSync(tmp); } catch {} throw e; }   // not on disk after all: the 30-second backstop tries again
  syncDirSync();
  _owned = stampNow();
  saveOk();
}
// the rename is durable only once the directory entry is: fsync the folder too
function syncDirSync() {
  try { const d = fs.openSync(path.dirname(DB_PATH), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch {}
}
async function syncDirAsync() {
  try { const d = await fs.promises.open(path.dirname(DB_PATH), 'r'); try { await d.sync(); } finally { await d.close(); } } catch {}
}
// sql.js's export() closes and reopens the connection; when it throws, look at the engine at once (it may be left
// holding a closed or zombie connection - the Oct 11 bench) rather than waiting for the next tick
function exportNow() {
  try { return _db.export(); }
  catch (e) { const err = e instanceof Error ? e : new Error(String(e)); afterError('a save'); throw err; }
}
let _saveSaidAt = 0, _saveFailingSince = 0, _saveLastError = '';
function saveFailed(where, e) {
  _savedMark = null;   // not on disk: the next tick tries again
  if (!_saveFailingSince) _saveFailingSince = Date.now();
  _saveLastError = String((e && e.message) || e).slice(0, 200);
  if (Date.now() - _saveSaidAt > 10 * 60000) { _saveSaidAt = Date.now(); try { console.error(`DB_SAVE_FAILED: ${where} - ${_saveLastError}`); } catch {} }
}
function saveOk() { _saveFailingSince = 0; _saveLastError = ''; }
/** the health line reads it: since when saves have been failing (0 = they are not), and why */
function saveHealth() { return { failingSince: _saveFailingSince, lastError: _saveLastError }; }
function flushSync() {
  if (!_db || _engineDead) return;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _dirty = false; _firstDirtyAt = 0;
  writeAtomicSync();
}
function flushAsync() {
  if (!_db || _engineDead) return Promise.resolve();
  if (_writing) { _again = true; return _writing; }
  if (foreignOnDisk()) { refuseStale('async write'); return Promise.resolve(); }
  let buf;
  try { buf = Buffer.from(exportNow()); } catch (e) { saveFailed('a save', e); return Promise.resolve(); }
  _savedMark = changeMark();
  const tmp = tmpName();
  const gen = ++_gen;
  _writing = fs.promises.open(tmp, 'w')
    .then(async fh => { try { await fh.writeFile(buf); await fh.datasync(); } finally { await fh.close(); } })
    .then(() => {
      if (gen !== _gen) return fs.promises.unlink(tmp).catch(() => {});   // a sync flush already wrote something newer
      // the inode, size and mtime survive the rename: claim them BEFORE it so no
      // check between the rename and this callback can read our own file as foreign
      _ownedNext = stampOf(tmp);
      return fs.promises.rename(tmp, DB_PATH)
        .then(() => { if (gen === _gen) { _owned = _ownedNext; } _ownedNext = null; saveOk(); })
        .then(syncDirAsync);
    })
    .catch(e => { saveFailed('a save', e); fs.promises.unlink(tmp).catch(() => {}); })   // not on disk: the backstop tries again
    .finally(() => { _writing = null; if (_again) { _again = false; scheduleSave(); } });
  return _writing;
}
function scheduleSave() {
  if (!_db || _engineDead) return;
  _dirty = true;
  const now = Date.now();
  if (!_firstDirtyAt) _firstDirtyAt = now;
  if (_timer) clearTimeout(_timer);
  const wait = Math.max(0, Math.min(SAVE_DELAY_MS, SAVE_MAX_MS - (now - _firstDirtyAt)));
  _timer = setTimeout(() => { _timer = null; _dirty = false; _firstDirtyAt = 0; flushAsync(); }, wait);
}
// the name every statement helper calls - now a scheduled write, not a blocking one
function save() { scheduleSave(); }
// Resolve once everything dirty RIGHT NOW is on disk (A-wave 5b, Sep 11 2026,
// found on the bench): a job's lease must be durable before the device is
// driven, or a crash inside the 40 ms save window loses the lease and the
// next boot drives the device again. The write stays asynchronous (never a
// blocking export on the event loop); the caller simply waits for it.
async function flushed() {
  if (!_db) return;
  for (let i = 0; i < 3; i++) {
    if (_writing) { try { await _writing; } catch {} }
    if (_timer) { clearTimeout(_timer); _timer = null; }
    if (!_dirty) return;
    _dirty = false; _firstDirtyAt = 0;
    try { await flushAsync(); } catch {}
  }
}
// wait for any write already on its way (restore replaces the file underneath us)
async function settle() { if (_timer) { clearTimeout(_timer); _timer = null; } _dirty = false; _firstDirtyAt = 0; if (_writing) { try { await _writing; } catch {} } }

// Re-open the database from disk. Used after a restore replaces bookings.db so
// the running app picks up the restored data without a full process restart.
async function reload() {
  await settle();   // never let a scheduled write clobber the restored file
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  _SQL = SQL; guardStack(SQL);
  const old = _db;
  _db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
  if (old && old !== _db) { try { old.close(); } catch {} }   // its memory and in-memory file go with it (the night's review)
  _savedMark = fs.existsSync(DB_PATH) ? changeMark() : null;
  applySchema();   // W44: a restored older database is current the moment it is loaded
  // A restore is the case the boot prune was actually for: a backup carrying years of
  // log. Bring it under the age rule here (in memory - the writer's next save puts it
  // on disk) and record it, rather than deleting it silently at the next restart.
  try { const n = pruneAdminLog({ persist: false }); if (n > 0 && _writer) { adminLog('ADMIN_LOG_PRUNED', `${n} entries older than ${adminLogMonths()} months removed after a restore (the owner's log is kept by age)`); save(); } } catch {}
  _owned = stampNow(); _staleSaid = false;
}

// ── LOW LEVEL HELPERS ─────────────────────────────────────────────────────────
function all(sql, ...params) {
  if (_engineDead) throw new Error(ENGINE_DEAD_MSG);
  checkParams(sql, params);
  let stmt = null;
  try {
    stmt = _db.prepare(sql);
    const rows = [];
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } catch (e) { afterError('a read'); throw e instanceof Error ? e : new Error(String(e)); }
  finally { if (stmt) { try { stmt.free(); } catch {} } }   // Oct 18 2026: a statement that threw was never freed
}

function get(sql, ...params) {
  return all(sql, ...params)[0];
}

// SAVE WHAT CHANGED, NOT WHAT RAN (Oct 8 2026, measured on the bench: an IDLE unit wrote its whole database to
// the SD card every ~13-20 s, 151 MB in ten minutes - 22 GB a day - for a 0.5 MB file). Every statement used to
// schedule a save of the whole file, whether or not it changed anything, and the scheduler's tick runs dozens
// that change nothing: ensureJob's INSERT OR IGNORE for jobs that already exist (an ignored insert still moves
// the AUTOINCREMENT counter, but changes no row), ensureSchema's CREATE TABLE IF NOT EXISTS before every ledger
// call, UPDATEs that match nothing. A card wears out from writes, and a worn card is a unit nobody can fix
// remotely (maintainer, Oct 8). So a statement saves only when SQLite says something changed: a row (total_changes) or
// the schema (schema_version, which a CREATE ... IF NOT EXISTS of an existing table does not move). If either
// cannot be read, it saves, as before.
// THE DATABASE ENGINE NEVER STAYS BROKEN (Oct 18-19 2026, found on the bench). From Oct 11 the bench's in-memory database
// (sql.js, WebAssembly) refused every call - "bad parameter or other API misuse", later "memory access out of bounds" -
// while the server went on answering for a WEEK: the page loaded, the watchdog's /api/time was fine, and every booking,
// availability and automation call failed. The cause (the night's review, measured here): sql.js 1.14.1's
// Database.exec() leaked 16 bytes of its fixed 5 MB WebAssembly stack on every call (sql.js #630, fixed in 1.14.2), and
// save-on-change (Oct 8) called exec() twice per write and on every tick - about 55 hours of an idle unit, then the stack
// ran into the memory below it. Four layers now:
//   1. sql.js is PINNED to 1.14.2 (package.json) and every exec() restores the stack it found (guardStack) - so a later
//      build that leaks again cannot take a unit down;
//   2. the writer's tick reads how far the stack has drifted: past STACK_DRIFT_RESTART it saves and restarts at the next
//      quiet moment (past STACK_DRIFT_NOW, at once) - the failure caught BEFORE it happens, with nothing lost;
//   3. the engine is asked a real question (a row from bookings) on the tick and after any failed query or save; when it
//      cannot answer, nothing more is asked of it, nothing from its memory is written over the good file, a marker is left
//      for the owner's log and the health line, and the process exits AT ONCE so PM2 starts it on the last good save
//      (DB_ENGINE_FAILED, then DB_ENGINE_RESTARTED once) - a 200 ms grace let callers back in and 3 of 16 trials hung;
//   4. run() and all() never leave a statement open (sql.js's prepare(sql, params) binds before it registers, so a
//      thrown bind orphaned one that every later save closed the connection over - its own way to the same state, ~4,090
//      such saves): prepare, bind, free in a finally; a value SQLite cannot take is a plain Error (DB_BIND_REFUSED, once).
// A failing SAVE is said on the health line too (red after two minutes: bookings since then exist only in memory).
// test-db-engine.
const ENGINE_MARK = path.join(path.dirname(DB_PATH), 'backups', 'db-engine-failed.json');
const STACK_DRIFT_RESTART = 1 << 20, STACK_DRIFT_NOW = 3 << 20;
const ENGINE_DEAD_MSG = 'The database engine stopped - the unit is restarting';
let _SQL = null, _engineDead = false, _stackBase = null;
const _bindSaid = new Set();
function engineMark(m) { try { fs.mkdirSync(path.dirname(ENGINE_MARK), { recursive: true }); fs.writeFileSync(ENGINE_MARK, JSON.stringify(m)); } catch {} }
// every exec() leaves the shared stack as it found it (the module is one per process: this covers every connection)
function guardStack(SQL) {
  try {
    if (!SQL || !SQL.Database || SQL.Database.prototype.__baStackSafe || typeof SQL.stackSave !== 'function' || typeof SQL.stackRestore !== 'function') return;
    const ex = SQL.Database.prototype.exec;
    SQL.Database.prototype.exec = function (...a) { const sp = SQL.stackSave(); try { return ex.apply(this, a); } finally { SQL.stackRestore(sp); } };
    SQL.Database.prototype.__baStackSafe = true;
  } catch {}
}
function stackDrift() { try { return _SQL && _stackBase !== null ? _stackBase - _SQL.stackSave() : 0; } catch { return 0; } }
function engineDead(what, why) {
  if (_engineDead) return true;
  _engineDead = true;
  try { console.error(`DB_ENGINE_FAILED: the in-memory database stopped working (${what}${why ? '; noticed by ' + why : ''}). Nothing is written; restarting so the last good save on disk is read again.`); } catch {}
  engineMark({ at: new Date().toISOString(), why: what, kind: 'restarted', pid: process.pid });
  if (_tick) { clearInterval(_tick); _tick = null; }
  if (_timer) { clearTimeout(_timer); _timer = null; }
  process.exit(1);
}
/** true when the engine is unusable (the process is then already on its way out). Only the writer acts on it. */
function engineCheck(why) {
  if (!_db || _engineDead) return _engineDead;
  let err = null;
  try { _db.exec('SELECT 1 FROM bookings LIMIT 1'); } catch (e) { err = e; }
  if (err) {
    if (!_writer) return true;   // a tool or a battery reading the file never writes it and never exits the process
    return engineDead(String((err && err.message) || err).slice(0, 200), why);
  }
  // the stack creeping down is the bench's failure arriving: save while the engine still answers, then restart
  const drift = stackDrift();
  if (_writer && drift > STACK_DRIFT_RESTART) {
    let quiet = true; try { quiet = !require('./scheduler').sessionOnOrNear(new Date()); } catch {}
    if (quiet || drift > STACK_DRIFT_NOW) {
      try { flushSync(); } catch {}
      const at = new Date().toISOString(), what = `the database engine's stack had drifted ${Math.round(drift / 1024)} KB`;
      try { console.error(`DB_ENGINE_STACK: ${what}; saved and restarting before it can fail`); } catch {}
      engineMark({ at, why: what, kind: 'stack', pid: process.pid });
      _engineDead = true;
      if (_tick) { clearInterval(_tick); _tick = null; }
      process.exit(1);
    }
  }
  return false;
}
// after a failed query or save: was it the query, or the engine?
function afterError(where) { try { engineCheck(where); } catch {} }
// a value SQLite can store, or a plain Error naming the one it cannot (never sql.js's thrown string)
function checkParams(sql, params) {
  for (let i = 0; i < params.length; i++) {
    const v = params[i];
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' || v instanceof Uint8Array || Array.isArray(v)) continue;
    const key = String(sql).slice(0, 80) + '#' + i;
    if (!_bindSaid.has(key)) { _bindSaid.add(key); try { console.error(`DB_BIND_REFUSED: parameter ${i + 1} is ${v === undefined ? 'undefined' : typeof v} in: ${String(sql).replace(/\s+/g, ' ').slice(0, 160)}`); } catch {} }
    throw new Error(`Database refused a value: parameter ${i + 1} is ${v === undefined ? 'undefined' : typeof v}`);
  }
}
// the restart after an engine failure (or the stack's early warning): told in the owner's log once, read by the health line for a week
function engineFailure() { try { return JSON.parse(fs.readFileSync(ENGINE_MARK, 'utf8')); } catch { return null; } }
function noteEngineRestart() {
  const m = engineFailure(); if (!m || m.logged) return;
  try {
    if (m.kind === 'stack') adminLog('DB_ENGINE_RESTARTED', `The database engine was wearing down (${m.why}) and the unit saved and restarted itself at ${m.at}, before it could fail - nothing was lost. If this happens again, consult the troubleshooting guide.`);
    else adminLog('DB_ENGINE_RESTARTED', `The database stopped working in memory at ${m.at} (${m.why}) and the unit restarted itself; it read the last good save. Changes made in the last few seconds before that may need entering again.`);
    m.logged = new Date().toISOString(); engineMark(m);
  } catch {}
}
// a battery's ways in: burn the stack as the leak did (the real failure), or drift it (the early warning)
function testBreakEngine(kind) {
  if (kind === 'drift') { _SQL.stackAlloc(3584 * 1024); return; }   // past STACK_DRIFT_NOW, still room to work
  _SQL.stackAlloc(6 * 1024 * 1024);
}

function changeMark() {
  try { const r = _db.exec('SELECT total_changes(), (SELECT schema_version FROM pragma_schema_version)'); return r[0].values[0].join(':'); }
  catch { return null; }
}
function run(sql, ...params) {
  if (_engineDead) throw new Error(ENGINE_DEAD_MSG);
  checkParams(sql, params);
  const before = changeMark();
  let stmt = null;
  try { stmt = _db.prepare(sql); stmt.bind(params); stmt.step(); }   // registered BEFORE the bind, freed whatever happens - one statement, as always
  catch (e) { afterError('a write'); throw e instanceof Error ? e : new Error(String(e)); }
  finally { if (stmt) { try { stmt.free(); } catch {} } }
  if (before === null || changeMark() !== before) save();
}

// ── DB PROXY — safe to import anywhere, always uses live _db ─────────────────
// Routes import this and call db.prepare(...).run/get/all
const db = {
  prepare(sql) {
    return {
      all:  (...p) => all(sql, ...p),
      get:  (...p) => get(sql, ...p),
      run:  (...p) => { run(sql, ...p); }
    };
  },
  exec(sql) { if (_engineDead) throw new Error(ENGINE_DEAD_MSG); const before = changeMark(); _db.run(sql); if (before === null || changeMark() !== before) save(); }
};

// ── NAMED HELPERS ─────────────────────────────────────────────────────────────

function getBookingsForDate(date, bayId) {
  // Match bookings that START on this date OR END on this date (a session that
  // began the previous night and crosses midnight into this date). Callers use
  // date + end_date to place each booking on an absolute timeline.
  if (bayId) return all(
    `SELECT id, bay_id, bay_name, date, start_time, end_time, end_date, name, whole_facility FROM bookings
     WHERE (date=? OR end_date=?) AND bay_id=? AND status='active'`,
    date, date, bayId
  );
  return all(
    `SELECT id, bay_id, bay_name, date, start_time, end_time, end_date, name, whole_facility FROM bookings
     WHERE (date=? OR end_date=?) AND status='active'`,
    date, date
  );
}

function getBookingById(id) {
  return get(`SELECT * FROM bookings WHERE id=?`, id);
}

function getUpcomingBookings(dates) {
  if (!dates.length) return [];
  const ph = dates.map(() => '?').join(',');
  // Match on either start date OR end_date so a session that started yesterday
  // and crosses into today (end_date in window) is still tracked for its
  // device-OFF / shutdown. Include recently completed so OFF fires after a session
  // ends - for 150 minutes (Sep 25 2026, the build review): "turn off after" goes to
  // 120 on every device card, and past the old 60 that OFF was never claimed - the
  // bay stayed on and the health line read red for ever.
  return all(
    `SELECT * FROM bookings
     WHERE (date IN (${ph}) OR end_date IN (${ph}))
       AND (status='active' OR (status='completed' AND updated_at >= datetime('now','-150 minutes')))`,
    ...dates, ...dates
  );
}

// ── STOP MEANS STOP (Sep 6 2026) ────────────────────────────────────────────
function smsKey(phone) { const d = String(phone || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function smsOptOut(phone, keyword, source) {
  const k = smsKey(phone); if (!k) return false;
  run(`INSERT OR REPLACE INTO sms_optouts (phone, opted_out_at, source, keyword) VALUES (?, datetime('now'), ?, ?)`, k, source || 'sms', String(keyword || '').slice(0, 20));
  return true;
}
function smsOptIn(phone) { const k = smsKey(phone); if (!k) return false; run(`DELETE FROM sms_optouts WHERE phone = ?`, k); return true; }
function isSmsOptedOut(phone) { const k = smsKey(phone); if (!k) return false; return !!get(`SELECT phone FROM sms_optouts WHERE phone = ?`, k); }
function listSmsOptOuts() { return all(`SELECT phone, opted_out_at, source, keyword FROM sms_optouts ORDER BY opted_out_at DESC`); }

// ONE PLACE STAMPS A REFUND (maintainer, Sep 20 2026). Six sites create refunds; each
// calls this the moment Stripe accepts one, so "is anyone still owed money" is a
// question the unit can answer off its own disk instead of re-reading Stripe
// booking by booking. Idempotent: the first stamp wins, so a partial refund
// followed by another does not rewrite the date the money first went back.
// THE AMOUNT TOO (Sep 23 2026): revenue is money taken minus refunds, and a half
// refund must be told from a full one - pass Stripe's refund object and the row
// is written to `refunds`, keyed by its id (a retry that returns the same refund
// writes nothing twice). `source` names the site that gave it back.
function markRefunded(bookingId, when, refund, source) {
  if (!bookingId) return false;
  try {
    const at = when || (refund && refund.created ? new Date(refund.created * 1000).toISOString() : new Date().toISOString());
    run(`UPDATE bookings SET refunded_at = COALESCE(NULLIF(refunded_at,''), ?), updated_at = datetime('now') WHERE id = ?`,
        at, bookingId);
    if (refund && refund.id && Number.isFinite(Number(refund.amount))) {
      run(`INSERT OR IGNORE INTO refunds (id, booking_id, amount_cents, at, source) VALUES (?,?,?,?,?)`,
          String(refund.id), bookingId, Number(refund.amount) | 0, at, String(source || ''));
    }
    return true;
  } catch (e) { return false; }
}
// A membership payment Stripe reported paid (the webhook, the nightly reconcile,
// the join). `invoice` is Stripe's invoice object; keyed by its id.
function recordMembershipPayment(invoice, memberId, source) {
  if (!invoice || !invoice.id || invoice.status && invoice.status !== 'paid') return false;
  const cents = Number(invoice.amount_paid != null ? invoice.amount_paid : invoice.total);
  if (!Number.isFinite(cents) || cents <= 0) return false;
  const paidUnix = (invoice.status_transitions && invoice.status_transitions.paid_at) || invoice.created;
  const at = paidUnix ? new Date(paidUnix * 1000).toISOString() : new Date().toISOString();
  const tax = Number(invoice.tax != null ? invoice.tax : (Array.isArray(invoice.total_taxes) ? invoice.total_taxes.reduce((s, t) => s + (Number(t.amount) || 0), 0) : 0)) || 0;
  const sub = invoice.subscription || (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription) || '';
  try {
    run(`INSERT OR IGNORE INTO membership_payments (invoice_id, member_id, subscription_id, amount_cents, tax_cents, paid_at, source) VALUES (?,?,?,?,?,?,?)`,
        String(invoice.id), String(memberId || ''), String(sub || ''), cents | 0, tax | 0, at, String(source || ''));
    return true;
  } catch (e) { return false; }
}

function adminLog(event, detail = '') {
  run(`INSERT INTO admin_log (event, detail) VALUES (?, ?)`, event, detail);
}

function getAdminLog(limit = 100) {
  return all(`SELECT * FROM admin_log ORDER BY created_at DESC LIMIT ?`, limit);
}

function getActiveWaiver() {
  return get(`SELECT * FROM waivers WHERE active=1 ORDER BY created_at DESC LIMIT 1`);
}

function getWaiverById(id) {
  return get(`SELECT * FROM waivers WHERE id=?`, id);
}

function getAllWaivers() {
  return all(`SELECT * FROM waivers ORDER BY created_at DESC`);
}

function getSignedWaiverByBooking(bookingId) {
  // W37: a membership-scope signature captured AT a booking keeps its
  // provenance in captured_booking_id, so this lookup must ask for both.
  return get(`SELECT * FROM signed_waivers WHERE booking_id=? OR (captured_booking_id=? AND captured_booking_id<>'')`, bookingId, bookingId);
}

function getSignedWaivers(limit = 200) {
  return all(`SELECT * FROM signed_waivers ORDER BY agreed_at DESC LIMIT ?`, limit);
}

// ── MEMBERSHIP HELPERS ────────────────────────────────────────────────────────

function getMemberByPin(pin) {
  const row = get(`SELECT m.*, mt.name as tier_name, mt.discount_type, mt.discount_value,
    mt.hours_per_day, mt.hours_per_week, mt.hours_per_month,
    mt.allowed_days, mt.earliest_time, mt.latest_time, mt.allowed_bays,
    mt.booking_window_days, mt.guest_allowed, mt.guest_max_per_visit,
    mt.guest_passes_per_month, mt.guest_pricing_type, mt.guest_pricing_value,
    mt.over_limit_discount_type, mt.over_limit_discount_value, mt.guest_overflow_price, mt.guest_pricing_basis,
    mt.guest_pricing_set, mt.guest_included_per_visit, mt.guest_collect,
    mt.deposit_mode, mt.share_discount_pct, mt.settlement_mode, mt.deposit_per30,
    mt.max_active_bookings, mt.badge_color
    FROM members m JOIN membership_tiers mt ON m.tier_id = mt.id
    WHERE m.pin = ? AND m.status = 'active' AND mt.active = 1`, pin);
  // FREE-HOURS AUTO-CAP: "Free Hours Per Period" with no hour limits set would
  // otherwise mean unlimited free sessions (the discount math is per-session).
  // The value becomes the monthly cap by default; any explicit limit wins.
  if (row && row.discount_type === 'free_hours' && !row.hours_per_day && !row.hours_per_week && !row.hours_per_month) {
    row.hours_per_month = row.discount_value;
  }
  return row;
}

function getMemberById(id) {
  return get(`SELECT m.*, mt.name as tier_name FROM members m
    LEFT JOIN membership_tiers mt ON m.tier_id = mt.id WHERE m.id = ?`, id);
}

function getMemberUsageForDay(memberId, date) {
  const row = get(`SELECT COALESCE(SUM(duration_minutes),0) as total
    FROM member_usage WHERE member_id=? AND date=?`, memberId, date);
  return row ? row.total : 0;
}

function getMemberUsageForWeek(memberId, weekStart, weekEnd) {
  const row = get(`SELECT COALESCE(SUM(duration_minutes),0) as total
    FROM member_usage WHERE member_id=? AND date>=? AND date<=?`,
    memberId, weekStart, weekEnd);
  return row ? row.total : 0;
}

function getMemberUsageForMonth(memberId, monthStart, monthEnd) {
  const row = get(`SELECT COALESCE(SUM(duration_minutes),0) as total
    FROM member_usage WHERE member_id=? AND date>=? AND date<=?`,
    memberId, monthStart, monthEnd);
  return row ? row.total : 0;
}

function getMemberGuestCountForMonth(memberId, monthStart, monthEnd) {
  const row = get(`SELECT COALESCE(SUM(guest_count),0) as total
    FROM member_guests WHERE member_id=? AND date>=? AND date<=?`,
    memberId, monthStart, monthEnd);
  return row ? row.total : 0;
}

// ── GRACEFUL SHUTDOWN — save database before process exits ──────────────────
// Catches PM2 restart, CTRL+C, and uncaught crashes
function gracefulSave(signal) {
  try {
    if (_engineDead) { console.error(`DB_ENGINE: exit (${signal}) - nothing more is written from this process`); return; }
    if (_db && _writer) {
      // W40: only the claimed writer flushes on exit, and never over a file
      // another process has written since (writeAtomicSync refuses that by
      // itself; this keeps the log honest)
      if (foreignOnDisk()) { console.error(`DB_STALE_WRITER_REFUSED: exit (${signal}) - not written`); return; }
      // an exit after a crash nobody caught: write only from an engine that still answers and whose stack is sound -
      // memory that cannot be trusted never goes over the good file (Oct 19 2026)
      let sound = stackDrift() <= STACK_DRIFT_NOW;
      if (sound) { try { _db.exec('SELECT 1 FROM bookings LIMIT 1'); } catch { sound = false; } }
      if (!sound) { _engineDead = true; engineMark({ at: new Date().toISOString(), why: 'the engine did not answer at exit', kind: 'restarted', pid: process.pid }); console.error(`DB_ENGINE: exit (${signal}) - the engine did not answer; nothing written`); return; }
      flushSync();
      console.log(`Database saved before ${signal}`);
    }
  } catch {}
}
process.on('SIGINT',  () => { gracefulSave('SIGINT');  process.exit(0); });
process.on('SIGTERM', () => { gracefulSave('SIGTERM'); process.exit(0); });
process.on('exit',    () => { gracefulSave('exit'); });

module.exports = {
  staleRefusals,
  db,
  initDb,
  save,
  saveDb: flushSync, flushSync, flushed, settle, claimWriter, engineCheck, engineFailure, saveHealth,
  engineStats: () => ({ stackDrift: stackDrift() }),   // test-db-engine, the health line
  engineTestBreak: (kind) => { if (process.env.BA_TEST_DB_HOOKS !== '1') throw new Error('test hook off'); testBreakEngine(kind); },
  pruneAdminLog, adminLogMonths, adminLogStats, ADMIN_LOG_FLOOR_MONTHS,
  reload,
  migrate: applySchema,
  getBookingsForDate,
  getBookingById,
  getUpcomingBookings,
  adminLog,
  markRefunded,
  recordMembershipPayment,
  getAdminLog,
  smsKey, smsOptOut, smsOptIn, isSmsOptedOut, listSmsOptOuts,
  getActiveWaiver,
  getWaiverById,
  getAllWaivers,
  getSignedWaiverByBooking,
  getSignedWaivers,
  getMemberByPin,
  getMemberById,
  getMemberUsageForDay,
  getMemberUsageForWeek,
  getMemberUsageForMonth,
  getMemberGuestCountForMonth
};
