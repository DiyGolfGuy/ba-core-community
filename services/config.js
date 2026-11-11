// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/config.js  —  Configuration Management
//  Reads/writes config.json live — no restart needed
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { stripPrototypeKeys } = require('./object-keys');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  unit: { id: '' },   // rule 25 (Sep 12 2026): this unit's own id, minted on first use, carried on every Stripe object it makes
  records: { adminLogMonths: 12 },   // the owner's log kept at least twelve months, pruned by age (maintainer, Sep 12 2026); retentionYears lives here too when the owner sets it
  // ── SETUP ──────────────────────────────────────────────────────────────────
  setup: {
    completed: false
  },

  // ── SERVER ─────────────────────────────────────────────────────────────────
  server: {
    businessName:  '',
    port:          3001,
    timezone:      'America/Chicago',
    // Staff roster for the /staff surface: [{ name, code (4-6 digits, unique),
    // active }]. Codes are LAN-only identities; owner edits via Admin.
    staff:         []
  },

  // ── STAFF SURFACE / POS ────────────────────────────────────────────────────
  pos: {
    autoLockMins:    2,     // idle minutes before the staff pad locks
    fnb:             true,  // false = staffed but no food & beverage layer
    noShowGraceMins: 15     // minutes past start before a booking reads no-show
  },

  // ── EMPLOYEES: SCHEDULING & TIME CLOCK (Sep 2026) ──────────────────────────
  // An hours-and-schedule tool for facilities with a counter. NOT payroll,
  // benefits or compliance (CLAUDE.md rule 12): it records hours, builds a
  // schedule, and exports neutral CSV for the facility's own payroll provider.
  // OFF by default; the wizard turns it on for staffed and hybrid facilities;
  // the owner flips it any time under Settings > Staff > The Counter.
  scheduling: {
    enabled:       false,
    staffedLabel:  'Staffed hours',   // what the booking page calls a staffed window
    hoursPeriod:   'weekly',          // weekly | biweekly | semimonthly | monthly
    anchorDate:    '',                // a known period start (weekly/biweekly); '' = most recent Monday
    semiMonthlyDays: [1, 16],
    // W29 (Sep 3 2026): the hours export, emailed on the period the owner
    // already chose above - never asked twice. Off until the owner names a
    // recipient AND ticks the plain-CSV box. mode 'auto' sends daysAfter
    // days after a period closes at `time`; 'hold' emails the owner a
    // review link at that moment and sends only on Approve. The owner is
    // always copied (cfg.contact.email). services/hourssend.js.
    hoursSend: { enabled: false, recipients: [], daysAfter: 1, time: '06:00', mode: 'auto', plainCsvOk: false, enabledAt: '' },
    // The facility's OWN break policy - shown as arithmetic on the builder,
    // never stated as a requirement. 0 = no rule.
    breaks: { restEveryHours: 0, mealAfterHours: 0, mealPaid: false }
  },
  coverage: {
    activeTemplateId: null,           // the season in force, or null (legacy staffed_days rules)
    scheduleOff:      false           // master switch: true = nothing is staffed, whatever the season says
  },

  // ── THEME ──────────────────────────────────────────────────────────────────
  // (removed Aug 13 2026) cfg.theme was the pre-unification booking palette.
  // The brand now lives in website_content.theme (services/theme.js) and the
  // admin console look in cfg.adminTheme. scrubLegacySettings() strips the stale
  // key from existing units at boot so it can never leak anywhere.

  // ── BOOKING RULES ──────────────────────────────────────────────────────────
  // Hours semantics:
  //   openTime   = earliest a session can START
  //   closeTime  = when the facility CLOSES; every session must END by this time
  //   closeNextDay = true if closeTime is after midnight (e.g. close at 02:00)
  //   open24Hours  = true → no close cap at all; sessions may run up to
  //                  maxSessionMins and cross midnight freely
  // Hours before start inside which a cancellation is "late". Staff can
  // override with a recorded reason; the customer self-serve path cannot.
  // 0 disables the window entirely (cancel any time).
  cancellationPolicy: { windowHours: 24 },
  // Bookings are always on the 30-minute grid. A walk-in at 2:40 books 3:00.
  // Staff may still power the bay on early as a courtesy when it is sitting
  // empty - if the facility allows it. This never changes the booking or the
  // price; it is access, not billing.
  allowEarlyBayOn: true,
  // W37 (Sep 8 2026): ONE number for the checkout hold, in minutes. The
  // availability grid hides the slot for this long, the booking route refuses
  // to sell over a hold this fresh, and the sweeper expires an unpaid checkout
  // at exactly the same edge. pilot facility had three different numbers and told a
  // customer to come back for a slot their own booking code would have given
  // them; we had three too, and ours let the slot be sold twice.
  bookingHoldMins: 10,
  waiver: {
    // 'required' = every booking signs (default, today's behavior)
    // 'optional' = offered but never blocks a booking
    // 'off'      = never asked; existing signed waivers and the admin
    //              archive stay intact so flipping back on is instant
    mode: 'required',
    // where non-members sign: 'online' during booking, 'door' at arrival,
    // 'auto' = door inside staffed hours, online otherwise
    collection: 'online',
    // a member's waiver lasts 'membership' (life of it) or 'annual' (365 days);
    // any tier may override this with its own waiver_term
    membershipTerm: 'membership',
    // days before a timed (annual) membership waiver runs out that the member
    // is reminded and asked to re-sign; 0 = no reminders (Sep 1 2026)
    reminderDays: 30,
    // 'member' = a member's waiver covers their guests (the member is
    //            responsible for them); 'each' = every guest signs at check-in
    guests: 'member'
  },
  booking: {
    // (the door code's window is NOT defaulted here: doorlock.codeWindowMins falls back to an old unit's legacy
    //  doorCodeBufferMins first, then 15 before / 30 after - maintainer, Oct 3 2026; a default here would hide the legacy number)
    openDays:          ['mon','tue','wed','thu','fri','sat','sun'],
    openTime:          '05:00',
    closeTime:         '23:30',
    closeNextDay:      false,
    open24Hours:       false,
    // a day's own hours over the one set above: { sat: { open: '09:00', close: '00:00' } } (services/hours.js, Oct 22 2026)
    dayHours:          {},
    windowDays:        7,
    minSessionMins:    30,
    maxSessionMins:    240,
    bufferMins:        0,
    pricePerHalfHour:  15,
    bookingFlow:       'bay-first',  // 'bay-first' | 'time-first'
    // Staffed facilities: no door codes generated or sent; reminders and
    // confirmations still work. Set true for manned locations or no smart lock.
    staffedAccess: false,
    // FACILITY BOOKING DEPOSIT (non-members, online only): 'off' | 'per30'.
    // per30 charges depositPer30 dollars per half-hour online; the group
    // settles the remainder at the door and the deposit credits the GROUP.
    // Guardrail: the deposit never exceeds the full session price.
    depositMode:   'off',
    depositPer30:  10
  },

  // ── CONTENT ────────────────────────────────────────────────────────────────
  content: {
    heroTagline:   'Play On Your Terms',
    heroDesc:      'Choose your bay, pick your time, and step into the simulator. Book online 24/7.',
    policyNotice:  '',
    alcoholPolicy: '',
    howItWorks: [
      { title: 'Book Online',        body: 'Reserve your bay in minutes. Pick your date, time, and session length. Pay securely online and your session is confirmed instantly.' },
      { title: 'Get Your Door Code', body: 'Shortly before your session a unique door code arrives by email - or by text if you opt in. Enter it on the keypad to access your bay.' },
      { title: 'Your Bay is Ready',  body: 'The simulator powers on automatically before you arrive. Everything is set up and waiting — just walk in and start playing.' },
      { title: 'During Your Session',body: 'Please remove outdoor footwear before entering the bay. Clean clubs at the washing station before play. Use only approved balls provided.' },
      { title: 'Food & Drinks',      body: 'Snacks and refreshments available on site. Check with staff for food and beverage options during staffed hours.' },
      { title: 'Wrapping Up',        body: 'At the end of your session the bay shuts down automatically. If another group is booked after you please exit promptly so they can start on time.' },
      { title: 'Questions?',         body: 'Visit our website or follow us on social media for staffed hours and specials.' }
    ]
  },

  // ── CONTACT ────────────────────────────────────────────────────────────────
  contact: {
    phone:   '',
    email:   '',
    address: '',
    website: '',
    hours:   ''
  },

  // ── SEO / LOCAL SEARCH ──────────────────────────────────────────────────────
  // Drives page title, meta tags, geo tags, and JSON-LD structured data.
  // All optional — the site works without them, but they help local search.
  seo: {
    city:        '',
    state:       '',
    zip:         '',
    county:      '',
    latitude:    '',
    longitude:   '',
    domain:      '',          // e.g. https://yourdomain.com (used for canonical + sitemap)
    metaDescription: '',      // optional override; auto-generated if blank
    footerBlurb: ''           // optional visible SEO prose for the footer
  },

  // ── BAYS ───────────────────────────────────────────────────────────────────
  bays: [],

  // ── SMS ────────────────────────────────────────────────────────────────────
  sms: {
    sendConfirmation:    true,
    sendReminder:        true,
    reminderMinsBefore:  60,
    sendDoorCode:        true,
    sendCancellation:    true,
    sendEndingWarning:   true,
    // How long a booking's door code works BEFORE the session starts and
    // AFTER it ends (minutes) - owner-set in Settings. Applies to whichever
    // door provider is chosen. Legacy doorCodeBufferMins is the fallback.
    doorCodeLeadMins:    15,
    doorCodeLagMins:     15,    // never read here (doorlock reads booking.*) - kept as it was, rule 14
  },

  // ── ANNOUNCEMENT BANNER ──────────────────────────────────────────────────────
  announcement: {
    enabled: false,
    message: '',
    link: ''          // W44: an optional address the bar links to (a page of yours or https://)
  },
  // Staff sign-in is LAN-only by default. staffRemoteAccess is a TEMPORARY owner
  // switch (demos/testing) to let staff work over the public domain; ship OFF.
  // (Named distinctly so it never collides with the server.staff accounts array.)
  staffRemoteAccess: false,

  // ── SHUTDOWN ───────────────────────────────────────────────────────────────
  // The shutdown command fires right AT session end (delay 0). The on-PC
  // session monitor handles the earlier on-screen warning separately.
  shutdown: {
    enabled:            true,
    // Oct 2 2026 (maintainer): when the PC is still on behind the reserved screen before a group, restart it 10
    // minutes before their tee time so the new group finds the game's main menu, not the last group's
    // round - whatever the gap (Oct 3). Never between back-to-back sessions, never while anyone is
    // playing. ON by default (maintainer, Oct 3 2026: "ON by default"); the owner can switch it off.
    restart:            true,
    // warningMinsBefore removed Aug 13 2026 - it was never a shutdown
    // countdown; the watcher warning lives at monitor.warnMins
  },

  // ── SESSION MONITOR (the script on each bay PC) ───────────────────────────
  // warnMins: how many minutes before session end the on-screen popup shows.
  // Served to the bay PCs via /api/session/status so timing changes here
  // apply everywhere without redeploying PC scripts.
  monitor: {
    warnMins: 10
  },

  // ── TAX & LEGAL ──────────────────────────────────────────────────────────
  // IMPORTANT: The business owner is responsible for verifying the correct
  // tax rate for their location and updating it when rates change.
  tax: {
    enabled:    false,
    rate:       0,              // Tax rate as percentage, e.g. 7.375 for 7.375%
    label:      'Sales Tax',    // Displayed on receipts, e.g. 'Local Sales Tax'
    taxId:      '',             // Optional business tax ID for receipts
    region:     ''              // State/region identifier for display
  },

  // ── SMS PROVIDER ──────────────────────────────────────────────────────────
  smsProvider: {
    primary: 'twilio'
  },

  // ── INTEGRATIONS ───────────────────────────────────────────────────────────
  twilio: {
    accountSid:  '',
    authToken:   '',
    phoneNumber: ''
  },
  messagebird: {
    apiKey:      '',
    phoneNumber: '',
    // W37b (Sep 8 2026): services/sms.sendViaBird reads apiKey, workspaceId and
    // channelId - it has never read phoneNumber. The defaults declared
    // phoneNumber and neither of the two the code actually needs, so a fresh
    // unit's config did not describe the fallback provider it ships with. Added
    // (never renamed, never dropped - rule 14); phoneNumber stays.
    workspaceId: '',
    channelId:   ''
  },
  resend: {
    apiKey:            '',
    fromEmail:         '',
    sendConfirmation:  true,
    sendReminder:      true,
    sendDoorCode:      true,
    sendCancellation:  true,
    sendEndingWarning: true,
    sendMoved:         true     // maintainer, Oct 4 2026: "If staff move a booking sure email them"
  },
  stripe: {
    // Stripe processing fees, used by revenue reporting. Online (card-not-
    // present, i.e. booking checkout) defaults 2.9% + 30c; in-person (Terminal
    // at the counter) defaults 2.7% + 5c. Overridable per facility.
    feePercent:          2.9,
    feeFixedCents:       30,
    inPersonFeePercent:  2.7,
    inPersonFeeFixedCents: 5,
    secretKey:      '',
    publishableKey: ''
  },
  remotelock: {
    clientId:     '',
    clientSecret: '',
    deviceId:     ''
  },

  // ── DOOR ACCESS PROVIDER ─────────────────────────────────────────────────
  // Which system issues per-booking door PINs. RemoteLock (cloud, single
  // door) or UniFi Access (the facility's own console, multiple doors).
  doorAccess: {
    provider: 'remotelock',
    // THE NEW FLOW IS THE DEFAULT (maintainer, Sep 21 2026 - no facility has real
    // customers yet): create the code at the owner's lead, ask the lock whether it
    // holds it, and text at textLeadMins. A provider that cannot answer
    // (RemoteLock until its sync fields are verified, UniFi) texts on the old
    // timing rather than holding the customer. An owner may switch the whole
    // flow OFF here and get today's exact behaviour: create and text together at
    // start minus 15 (test-door-classic holds that path to main's own job table).
    confirmBeforeText: true,
    textLeadMins: 15      // the customer is texted this many minutes before start (the old fixed 15)
  },

  // ── UNIFI ACCESS ─────────────────────────────────────────────────────────
  // Local API on the facility's UniFi console. apiStyle is auto-detected on
  // Test Connection (documented :12445 Bearer vs /proxy/access X-API-KEY)
  // and remembered here. pinLength must match the console's PIN setting.
  unifiAccess: {
    host:      '',            // console IP or hostname on the LAN
    apiToken:  '',
    doorIds:   [],            // doors this facility's codes unlock
    // 6, not 4 (Sep 16 2026). A UniFi console enforces ONE PIN length and a
    // member's PIN is six digits, so a fresh unit defaulting to 4 shipped a
    // configuration in which member sync could not work at all. An EXISTING unit
    // keeps whatever its owner chose - this is only the template for a new one.
    // The live number is services/doorlock.js doorPinLength(), which reads
    // doorAccess.pinLength and falls back to this key.
    pinLength: 6,
    apiStyle:  '',
    // Member Access Network: members become console users (member PIN =
    // door PIN); tiers grant always-on doors; bookings BOOST the user's
    // policies for the session window. memberPinForBookings: members without
    // a console user still get visitors carrying THEIR pin when possible.
    memberAccess: { enabled: false, memberPinForBookings: true }
  },

  // ── HOME ASSISTANT ─────────────────────────────────────────────────────────
  // The catch-all smart integration. Facility runs Home Assistant on their own
  // network; we control any entity it exposes (switches, climate, locks, etc.).
  homeAssistant: {
    enabled:       false,
    url:           '',            // e.g. http://homeassistant.local:8123
    token:         '',            // long-lived access token
    customActions: [],            // [{ event:'start'|'end', domain, service, data, enabled }]
    // (Oct 19 2026): Home Assistant runs inside the box and the unit sets it up itself
    // (services/hasetup.js) - its first run, its own token, its radios. The sign-in it makes is kept in
    // homeAssistant.login and never sent to a browser (auth REMOVE_PATHS).
    builtIn:       false,
    // A Z-WAVE LOCK THROUGH THE OWNER'S OWN HOME ASSISTANT (feature/door-interface).
    // Booking codes live in slotFrom..slotTo on the lock; backupSlot holds a
    // standing code, rotated daily, texted alongside when a code never confirms.
    // backupCode is a credential: never sent to a browser (auth REMOVE_PATHS).
    lock: { entityId: '', slotFrom: 10, slotTo: 29, backupSlot: 30, backupCode: '', backupSetOn: '',
            memberPins: false,   // members open this door with their own PIN, put in a slot for the booking window (Sep 26 2026)
            finishKey: '' }      // the key after the digits, in words - '' means "the check mark" (the Yale)
  },

  // ── URGENT ALERTS TO THE OWNER (Sep 25 2026, services/owneralert.js) ──────────
  // The owner's own mobile - never the facility's public contact number, which may be a
  // landline or the front desk. Empty means no texts; the contact email still gets them.
  alerts: {
    ownerMobile: ''
  },

  // ── THE ASSISTANT (Oct 19 2026 - services/assistant/) ──────────────────
  // The owner's AI: the box's own model (llama.cpp's server speaks an OpenAI-style chat with tools at this address) or
  // the owner's own cloud key, by their choice. It changes things only through the owner's own routes. Off until set.
  // Oct 20 2026 (maintainer: small models on the box, "then they can add a token or API key to talk to their big models if they
  // want"): which one answers, and the box's quick model in front of its main one (services/assistant/model.js).
  assistant: {
    enabled:  true,                          // the Assistant page; the model itself is the owner's hosted connection
    // The keys below came with an older layout and are no longer read: the model, its key and its settings live in
    // Admin > Owner Chat > Hosted AI settings (services/owner-ai-settings.js), never in this file or a backup.
    endpoint: '',
    model:    '',
    apiKey:   '',
    provider: '',
    quickModel: '',
    cloudModel: '',
    cloudEndpoint: ''
  },

  // ── THE BOOKINGS IN THE OWNER'S OWN CALENDAR (Oct 19 2026, services/calendarfeed.js) ──────
  // A private iCalendar link Google, Apple and Outlook subscribe to - no outside service in
  // between. Off until the owner turns it on; the token is the link's key, made by the unit and
  // never sent to a browser in the settings (auth REMOVE_PATHS) - the card reads its own route.
  calendarFeed: {
    enabled: false,
    token:   '',
    names:   true,    // customer names on the calendar
    contact: false    // phone and email in each booking's notes
  }
};

// W22 (bench load test, Sep 2 2026): getConfig() is called many times per
// request and used to read, parse and deep-merge config.json every time -
// a fifth of the CPU under load. The merged config is now cached against the
// file's mtime and size; a stat is all a hot call pays. Callers may mutate
// what they get and hand it to saveConfig(), so every call still receives
// its OWN copy (structuredClone of the cached merge), never the shared one.
let _cfgCache = null;   // { mtimeMs, size, merged }
// W44 (Sep 10 2026): after a restore, which settings were NOT in the backup and
// therefore sit at their defaults - the wizard's result screen lists them so
// the owner reviews them (a backup from an older unit never asked the newer
// wizard questions). Dot paths into DEFAULTS that the file lacks; internal
// auth keys are not settings and are left out.
const DEFAULTS_HIDDEN = /^(server\.adminAuth|server\.adminAuthDefault|server\.adminPassword|setup\.completed|calendarFeed\.token)$/;
function defaultsFilled(fileObj) {
  let file = fileObj;
  if (!file) { try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { file = {}; } }
  const flat = (o, pre) => Object.entries(o || {}).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flat(v, pre + k + '.') : [pre + k]);
  const have = new Set(flat(file, ''));
  return flat(DEFAULTS, '').filter(k => !have.has(k) && !DEFAULTS_HIDDEN.test(k)).sort();
}

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const st = fs.statSync(CONFIG_PATH);
      if (_cfgCache && _cfgCache.mtimeMs === st.mtimeMs && _cfgCache.size === st.size) return structuredClone(_cfgCache.merged);
      const raw  = fs.readFileSync(CONFIG_PATH, 'utf8');
      const file = JSON.parse(raw);
      removeRetiredSettings(file);
      const merged = deepMerge(DEFAULTS, file);
      // Once migrated to a verifier, never let the DEFAULTS plaintext return.
      if (merged.server && merged.server.adminAuth && !(file.server && file.server.adminPassword)) {
        delete merged.server.adminPassword;
      }
      _cfgCache = { mtimeMs: st.mtimeMs, size: st.size, merged: structuredClone(merged) };
      return merged;
    }
  } catch (err) {
    console.error('Config read error:', err.message);
  }
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function saveConfig(data) {
  stripPrototypeKeys(data);
  const current = getConfig();
  const merged  = deepMerge(current, data);
  // A verifier in the incoming or current state means the plaintext seed must
  // never be persisted, even though getConfig() seeds it for a fresh unit.
  if (merged.server && merged.server.adminAuth &&
      !(data && data.server && typeof data.server.adminPassword === 'string')) {
    delete merged.server.adminPassword;
  }
  writeConfigRaw(merged);
}

// Persist EXACTLY the given config with no defaults merge and no re-seed.
// Used by the auth migration so a deleted plaintext password stays deleted.
function writeConfigRaw(cfg) {
  removeRetiredSettings(cfg);
  const temporary = CONFIG_PATH + '.next';
  fs.writeFileSync(temporary, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, CONFIG_PATH);
  _cfgCache = null;
}

// Older backups may still contain commercial appliance settings. Keep owner
// login and provider settings while stripping the retired setup and updater data.
function removeRetiredSettings(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  let changed = stripPrototypeKeys(cfg);
  const remove = (obj, key) => {
    if (obj && Object.hasOwn(obj, key)) {
      delete obj[key];
      changed = true;
    }
  };
  remove(cfg, 'theme');
  remove(cfg, 'updates');
  // Customer SMS disclosures and bodies are fixed to the shipped campaign flow.
  remove(cfg.content, 'smsConsent');
  for (const field of ['shortBrand', 'confirmationMsg', 'doorCodeMsg', 'reminderMsg',
    'cancellationMsg', 'endingWarningMsg', 'endingWarningBacktobbackMsg']) remove(cfg.sms, field);
  remove(cfg.server, 'bootstrapAuth');
  // The hosted AI key lives only in owner-ai-secrets.json; one restored inside an older config is dropped.
  remove(cfg.assistant, 'apiKey');
  if (cfg.setup?.completed && !cfg.setup.completedAt && cfg.setup.eula?.acceptedAt) {
    cfg.setup.completedAt = cfg.setup.eula.acceptedAt;
  }
  remove(cfg.setup, 'defaultPassword');
  remove(cfg.setup, 'eula');
  remove(cfg.setup, 'eulaAccepted');
  return changed;
}

function scrubLegacySettings() {
  // An unreadable config is the boot path's problem (getConfig falls back to
  // defaults and the unit opens in setup mode). Throwing here would crash-loop
  // the service under systemd instead of letting the owner restore a backup.
  try {
    if (!fs.existsSync(CONFIG_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (removeRetiredSettings(raw)) writeConfigRaw(raw);
  } catch (err) {
    console.error('Config: retired settings were not scrubbed (' + err.message + ').');
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const previous = Object.hasOwn(result, key) ? result[key] : null;
      result[key] = deepMerge(previous, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

module.exports = {
  defaultsFilled, getConfig, saveConfig, writeConfigRaw, removeRetiredSettings, scrubLegacySettings, CONFIG_PATH };
