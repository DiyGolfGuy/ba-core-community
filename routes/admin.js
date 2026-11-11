// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  routes/admin.js  —  Admin API (Password Protected)
// ═══════════════════════════════════════════════════════════════════════════════

const express  = require('express');
const router   = express.Router();
const { stripeClient } = require('../services/stripeclient');
const path     = require('path');
const fs       = require('fs');
const dbModule = require('../services/db');
const { getConfig, saveConfig }    = require('../services/config');
const { controlAll, controlBay, controlDevice, getAllStatus, restartBay } = require('../services/shelly');
const { revokeDoorCode }           = require('../services/doorlock');
const { sendCancellation }         = require('../services/sms');
const broadlink                    = require('../services/broadlink');

// Always get db at call time via dbModule.db
const db = () => dbModule.db;

function getStripe() {
  const key = getConfig().stripe?.secretKey;
  if (!key || key.startsWith('PASTE') || key === '') return null;
  return stripeClient(key);
}

// ── AUTH WITH LOCKOUT ────────────────────────────────────────────────────────
// Track failed attempts per IP
const failedAttempts = {};
const LOCKOUT_THRESHOLD = 10;    // attempts before lockout
const LOCKOUT_DURATION  = 60 * 60 * 1000; // 1 hour

router.use((req, res, next) => {
  // Real client, not the tunnel hop: keyed on req.ip, every remote visitor
  // shared ONE lockout bucket, so a single attacker could lock the owner out.
  const ip       = require('../services/auth').getClientIp(req);
  const password = req.headers['x-admin-password'];   // query-string auth removed (Security Wave)
  const cfg      = getConfig();

  // The server admits unfinished setup only through the private SSH forward.
  if (!cfg.setup?.completed) return next();

  // Check if IP is locked out
  const record = failedAttempts[ip];
  if (record && record.count >= LOCKOUT_THRESHOLD) {
    const timeLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    if (Date.now() < record.lockedUntil) {
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${timeLeft} minute(s).` });
    } else {
      // Lockout expired — reset
      delete failedAttempts[ip];
    }
  }

  // Session cookie or hashed-password header both satisfy auth now.
  const auth = require('../services/auth');
  if (auth.verifyAdminRequest(req)) { delete failedAttempts[ip]; return next(); }
  // W39 (Sep 9 2026): a request that presented NO credential at all - no
  // password header, no cookie - is not a guess, and must not spend the
  // owner's lockout budget. Before this, a stray pre-login call from the admin
  // page (W36's STOP-count loader on DOMContentLoaded) counted as a failed
  // attempt on every load, and the page's reload-on-401 turned that into ten
  // attempts in ten seconds and an hour's lockout before the owner had typed a
  // single character. Brute force still needs credentials, and every request
  // that carries one is still counted exactly as before.
  const presentedCredential = !!password || !!(req.headers.cookie && req.headers.cookie.length);
  if (!presentedCredential) return res.status(401).json({ error: 'Unauthorized' });
  {
    if (!failedAttempts[ip]) failedAttempts[ip] = { count: 0, lockedUntil: 0 };
    failedAttempts[ip].count++;
    if (failedAttempts[ip].count >= LOCKOUT_THRESHOLD) {
      failedAttempts[ip].lockedUntil = Date.now() + LOCKOUT_DURATION;
      require('../services/db').adminLog('ADMIN_LOCKOUT', `IP: ${ip}`);
      return res.status(429).json({ error: 'Too many failed attempts. Locked out for 1 hour.' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
});

// ── CONFIG ────────────────────────────────────────────────────────────────────
router.get('/stripetax/status', async (req, res) => {
  try { res.json(await require('../services/stripetax').readiness()); }
  catch (e) { res.json({ configured: false, error: e.message }); }
});

router.get('/sms/templates', require('../services/auth').requireOwner, (req, res) => {
  res.json({ templates: require('../services/sms').templateExamples(getConfig()) });
});

router.get('/config',  (req, res) => res.json(require('../services/auth').sanitizeConfigForClient(getConfig())));

router.post('/config', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, (req, res) => {
  // ONE TRUTH FOR STAFFING (Aug 20 truth audit): accessStyle is the declared
  // access mode; staffedAccess is what the runtime gates read (door codes,
  // waiver auto-collection, deposits). They used to stay in sync only by
  // writer discipline. Now the server DERIVES the boolean whenever the style
  // is present, so no client - present or future - can ever desync them.
  try { require('../services/staffing').normalizeAccessStyle(req.body?.booking); } catch {}
  try { if (req.body?.booking?.accessStyle) req.body.booking.staffedAccess = req.body.booking.accessStyle === 'staffed'; } catch {}
  {
    // a secret typed onto its saved mask is refused in words, never dropped while the
    // screen says saved (Sep 25 2026, the pilot facility handoff's masked-field bug)
    const typedOnto = require('../services/auth').maskedFieldEdits(req.body || {}, getConfig());
    if (typedOnto.length) return res.status(400).json({ error: `A saved secret was typed onto instead of replaced (${typedOnto.join(', ')}). Click the field to clear it, type the whole new value, and save again - nothing was changed.`, fields: typedOnto });
  }
  req.body = require('../services/auth').mergeIncomingConfig(req.body || {}, getConfig());
  // REFUSE A KEY THAT CANNOT WORK, AT THE POINT OF PASTING (maintainer, Sep 17 2026 -
  // a live customer pasted a merchant id into the Publishable Key box, the
  // product took it, and he was left with a facility that could not charge
  // anyone). Reporting the state honestly afterwards is not enough.
  {
    const problems = require('../services/stripestatus').validateStripeKeys(req.body, getConfig());
    if (problems.length) return res.status(400).json({ error: problems[0].message, field: problems[0].field, problems });
  }
  try {
    // A new admin password never touches disk as plaintext: hash it now,
    // effective for the very next sign-in (maintainer, Aug 13).
    const pw = req.body?.server?.adminPassword;
    if (pw) delete req.body.server.adminPassword;
    saveConfig(req.body);
    if (pw) require('../services/auth').setAdminPassword(pw);
    // RE-TEST ON SAVE, not only at boot (maintainer, Sep 17 2026). An owner who has just
    // fixed a key must see the badge change without restarting the unit. The old
    // complaint is dropped first, so a good key clears a stale red immediately;
    // the call itself is fire-and-forget - it re-records a failure if there still
    // is one, and nothing about saving settings waits on Stripe being reachable.
    try {
      const SS = require('../services/stripestatus');
      SS.clearStripeFailure();
      const cfgNow = getConfig();
      if (SS.stripeStatus(cfgNow).ready) {
        require('../services/membership-billing').stripeCall('GET', '/balance')
          .then(() => {}).catch(() => {});   // the client records the verdict either way
      }
    } catch {}
    dbModule.adminLog(pw ? 'CONFIG_SAVED_PASSWORD_CHANGED' : 'CONFIG_SAVED');
    res.json({ success: true, password_changed: !!pw });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Owner chat uses the same stored booking settings as the Settings screen.
const ownerChat = require('../services/owner-chat');
const { setupWalkthrough, hostedGuideContext } = require('../services/owner-chat-guides');
const { GUIDE_DIR, GUIDE_TITLES: installedGuideTitles } = require('../services/installed-guides');
const ownerAI = require('../services/owner-ai-provider');
const ownerAISettings = require('../services/owner-ai-settings');
const ownerAIActions = require('../services/owner-ai-actions');
const chatAuth = require('../services/auth');
const proposals = new Map();
const proposalLifetime = 5 * 60 * 1000;
const hostedChatLimiter = require('express-rate-limit')({
  windowMs: 60_000,
  limit: 12,
  keyGenerator: () => 'owner-hosted-chat',
  legacyHeaders: false,
  message: { error: 'Too many hosted requests. Try again in a minute.' }
});
let hostedChatInFlight = false;
// The hosted conversation is kept here, per owner sign-in, so a follow-up has
// its context without the browser resending it (request bodies stay small).
const hostedTurns = new Map();
const hostedTurnLifetime = 30 * 60 * 1000;
function hostedHistory(sid, fresh) {
  const now = Date.now();
  for (const [key, entry] of hostedTurns) if (entry.expires <= now) hostedTurns.delete(key);
  if (fresh) hostedTurns.delete(sid);
  return hostedTurns.get(sid)?.turns || [];
}
function rememberHostedTurn(sid, request, reply) {
  const turns = [...(hostedTurns.get(sid)?.turns || []), { request, reply }].slice(-6);
  hostedTurns.set(sid, { turns, expires: Date.now() + hostedTurnLifetime });
}

function reviewOwnerChatChange(req, res, response, change) {
  const now = Date.now();
  for (const [key, proposal] of proposals) {
    if (proposal.expires <= now) proposals.delete(key);
  }
  if (proposals.size >= 100) return res.status(429).json({ error: 'Too many pending proposals. Try again shortly.' });
  const session = chatAuth.sessionFrom(req, 'admin');
  if (!session) return res.status(401).json({ error: 'Sign in as the owner and ask again.' });
  const id = require('node:crypto').randomUUID();
  proposals.set(id, { sid: session.sid, change, expires: now + proposalLifetime });
  return res.json({ ...response, proposal: { id, before: change.before, after: change.after } });
}

function bookingChatChange(current, patch) {
  const after = ownerChat.describe({ ...current, ...patch });
  return {
    before: ownerChat.describe(current), after,
    apply() {
      if (JSON.stringify(ownerChat.bookingSettings(getConfig())) !== JSON.stringify(current)) {
        throw new ownerAIActions.StaleOwnerAction('Booking settings changed after this proposal. Ask again to review the new values.');
      }
      saveConfig({ booking: patch });
      dbModule.adminLog('OWNER_CHAT_BOOKING_SETTINGS_SAVED');
      return 'Saved. ' + after;
    },
  };
}

router.post('/owner-chat', chatAuth.requireOwner, (req, res) => {
  const config = getConfig();
  if (!config.setup?.completed) return res.sendStatus(404);
  try {
    const current = ownerChat.bookingSettings(config);
    const answer = ownerChat.interpret(req.body?.message, current);
    if (answer.setupWalkthrough) {
      return res.json(setupWalkthrough(readSetupStatus(config).items, {
        twoFactor: chatAuth.twofaState(),
        hasActiveBay: (config.bays || []).some(bay => bay.active !== false),
        accessStyle: require('../services/staffing').accessStyleOf(config.booking),
      }));
    }
    if (!answer.patch) return res.json(answer);
    return reviewOwnerChatChange(req, res, { reply: 'Review the proposed change before applying it.' },
      bookingChatChange(current, answer.patch));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function privateOwnerChat(req, res, next) {
  if (!getConfig().setup?.completed) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  return next();
}

function requireSecureKeyEntry(req, res, next) {
  const loopback = /^(127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress);
  const localHost = /^127\.0\.0\.1(?::[0-9]+)?$/.test(req.get('host') || '');
  const tunneled = req.get('cf-connecting-ip') || req.get('cf-ray');
  if (req.secure || (loopback && localHost && !tunneled)) return next();
  return res.status(403).json({ error: 'Open Admin over HTTPS or the private SSH forward before entering an API key.' });
}

const settingsPath = '/owner-chat/hosted/settings';
router.get(settingsPath, chatAuth.requireOwner, privateOwnerChat, (req, res) => {
  try {
    res.json(ownerAISettings.status(ownerAISettings.read()));
  } catch {
    res.status(500).json({ error: 'Hosted AI settings could not be read. Replace the connection or check the Pi file permissions.' });
  }
});

router.put(settingsPath, chatAuth.requireOwner, privateOwnerChat, requireSecureKeyEntry, chatAuth.requireSensitive, (req, res) => {
  try {
    let apiKey = req.body?.apiKey;
    if (apiKey === '' || apiKey == null) {
      const existing = ownerAISettings.read();
      if (existing && existing.provider === req.body?.provider) apiKey = existing.apiKey;
    }
    const settings = ownerAISettings.validate({ ...req.body, apiKey });
    ownerAISettings.write(settings);
    res.json(ownerAISettings.status(settings));
  } catch (error) {
    if (error instanceof RangeError) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Hosted AI settings could not be saved on this Pi.' });
  }
});

router.delete(settingsPath, chatAuth.requireOwner, privateOwnerChat, chatAuth.requireSensitive, (req, res) => {
  try {
    ownerAISettings.remove();
    res.json(ownerAISettings.status(null));
  } catch {
    res.status(500).json({ error: 'The hosted AI connection could not be removed from this Pi.' });
  }
});

router.post('/owner-chat/hosted', chatAuth.requireOwner, privateOwnerChat, hostedChatLimiter, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > ownerAI.MAX_HOSTED_MESSAGE) {
    return res.status(400).json({ error: 'Enter a request of 1 to ' + ownerAI.MAX_HOSTED_MESSAGE + ' characters.' });
  }
  if (hostedChatInFlight) return res.status(429).json({ error: 'A hosted AI request is still running. Try again when it finishes.' });
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  res.once('close', cancel);
  hostedChatInFlight = true;
  try {
    const settings = ownerAISettings.read();
    if (!settings) return res.status(409).json({ error: 'Save your provider connection in Hosted AI settings first.' });
    if (message.includes(settings.apiKey)) return res.status(400).json({ error: 'Remove the API key from your request before sending it.' });
    const current = ownerChat.bookingSettings(getConfig());
    const site = db().prepare("SELECT value FROM website_content WHERE key = 'settings'").get();
    const { booking } = require('../services/sitenav').publicMap(site ? JSON.parse(site.value) : {});
    const health = { service: 'running', publicBookingHeld: !booking };
    const editing = { actions: ownerAIActions.ACTIONS, ...ownerAIActions.actionContext(message) };
    const guidance = hostedGuideContext(message, Boolean(editing.menu));
    const sid = chatAuth.sessionFrom(req, 'admin')?.sid;
    const history = sid ? hostedHistory(sid, req.body?.fresh === true) : [];
    const answer = await ownerAI.askOwnerAI({ ...settings, message, history, bookingSettings: current, health, guidance, editing },
      { cancelSignal: cancellation.signal });
    if (res.destroyed) return;
    if (sid) rememberHostedTurn(sid, message, answer.text);
    const response = { reply: answer.text, guidance: {
      destinations: guidance.destinations,
      sources: guidance.excerpts.map(({ file, title, heading }) => ({ file, title, heading })),
    } };
    if (!answer.proposal) return res.json(response);
    if (answer.proposal.action) {
      const change = ownerAIActions.prepareOwnerAction(answer.proposal, editing);
      if (!change) {
        response.reply += '\n\nA change could not be prepared. Name the exact item, section or page and ask again, or use the Admin links below. A page longer than 8,000 characters is edited in the Website editor.';
        return res.json(response);
      }
      response.reply += '\n\nReview these values before applying the change.';
      return reviewOwnerChatChange(req, res, response, change);
    }
    const { patch } = ownerChat.interpret('BA-CORE-PROPOSAL ' + JSON.stringify(answer.proposal), current);
    response.reply += '\n\nReview the proposed change before applying it.';
    return reviewOwnerChatChange(req, res, response, bookingChatChange(current, patch));
  } catch (error) {
    if (res.destroyed) return;
    if (error instanceof ownerAI.OwnerAIProviderError) return res.status(502).json({ error: error.message });
    res.status(500).json({ error: 'Hosted AI could not complete the request. Local Owner Chat is still available.' });
  } finally {
    res.removeListener('close', cancel);
    hostedChatInFlight = false;
  }
});

router.post('/owner-chat/apply', chatAuth.requireOwner, chatAuth.requireSensitive, (req, res) => {
  const id = req.body?.id;
  const proposal = proposals.get(id);
  if (!proposal || proposal.sid !== chatAuth.sessionFrom(req, 'admin').sid || proposal.expires <= Date.now()) {
    return res.status(409).json({ error: 'This proposal expired or belongs to a different sign-in. Ask again.' });
  }
  proposals.delete(id);
  try {
    return res.json({ reply: proposal.change.apply() });
  } catch (error) {
    if (error instanceof ownerAIActions.StaleOwnerAction) return res.status(409).json({ error: error.message });
    return res.status(500).json({ error: 'The proposed change could not be saved. Check the Admin screen before trying again.' });
  }
});

// ── BOOKINGS ──────────────────────────────────────────────────────────────────
router.get('/bookings', (req, res) => {
  // Auto-complete past active bookings before returning results.
  // BY THE END, NOT THE START (Sep 23 2026). This read `date` - the day a
  // session STARTED - so a session crossing midnight was marked completed the
  // moment anyone opened this list after midnight, while the customer was still
  // playing: /api/session/status then read the bay idle, and the bay PC stopped
  // warning, stopped offering more time, and could raise the reserved screen on
  // them. The scheduler's own sweep has always used end_date; this is the same
  // predicate, so the two can no longer disagree.
  try {
    const now = new Date();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const nowTime  = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    const pastBookings = db().prepare(
      `SELECT id FROM bookings WHERE status='active'
         AND (COALESCE(end_date, date) < ? OR (COALESCE(end_date, date) = ? AND end_time <= ?))`
    ).all(todayStr, todayStr, nowTime);
    if (pastBookings.length > 0) {
      for (const b of pastBookings) {
        db().prepare(`UPDATE bookings SET status='completed', updated_at=datetime('now') WHERE id=?`).run(b.id);
      }
    }
  } catch (err) { console.error('Auto-complete error:', err.message); }

  const { status, date, search, page = 1, per_page = 50 } = req.query;
  const pp = Math.min(parseInt(per_page) || 50, 200);
  const pg = Math.max(parseInt(page) || 1, 1);
  const offset = (pg - 1) * pp;

  let where = `WHERE 1=1 AND (b.booking_type IS NULL OR b.booking_type = 'customer')`;
  const params = [];
  if (status) { where += ` AND b.status=?`;  params.push(status); }
  if (date)   { where += ` AND b.date=?`;    params.push(date); }
  if (search?.trim()) {
    // a phone matches however it was typed: 202-555-0147, (202) 555-0147 and +12025550147 are
    // one person (Sep 25 2026) - the digits are compared, not the punctuation
    const dg = require('../services/phone').digits(search);
    where += ` AND (b.name LIKE ? OR b.phone LIKE ? OR b.bay_name LIKE ?` + (dg.length >= 4 ? ` OR replace(replace(replace(replace(replace(b.phone,'+',''),'-',''),' ',''),'(',''),')','') LIKE ?` : '') + `)`;
    const s = `%${search.trim()}%`;
    params.push(s, s, s);
    if (dg.length >= 4) params.push(`%${dg}%`);
  }

  const countRow = db().prepare(`SELECT COUNT(*) as total FROM bookings b ${where}`).get(...params);
  const total = countRow ? countRow.total : 0;

  const rows = db().prepare(
    `SELECT b.*, m.name AS member_name, mt.name AS member_tier, mt.badge_color AS member_badge,
            dc.code AS discount_code, dc.type AS discount_type,
            (SELECT COALESCE(SUM(discount_cents),0) FROM discount_uses u WHERE u.booking_id = b.id) AS discount_cents
     FROM bookings b
       LEFT JOIN members m ON m.id = b.member_id
       LEFT JOIN membership_tiers mt ON mt.id = m.tier_id
       LEFT JOIN discount_uses du ON du.id = (
         SELECT u2.id FROM discount_uses u2 WHERE u2.booking_id = b.id AND u2.discount_cents > 0 ORDER BY u2.used_at, u2.id LIMIT 1)
       LEFT JOIN discount_codes dc ON dc.id = du.code_id
     ${where} ORDER BY b.date DESC, b.start_time DESC LIMIT ? OFFSET ?`
  ).all(...params, pp, offset);

  res.json({ bookings: rows, total, page: pg, per_page: pp, pages: Math.ceil(total / pp) });
});

// ── LOG ───────────────────────────────────────────────────────────────────────
// Numbers that texted STOP (Sep 6 2026). Read-only: STOP means stop, so no
// screen can clear one - only the person texting START.
router.get('/sms-optouts', (req, res) => {
  try { const rows = require('../services/db').listSmsOptOuts(); res.json({ count: rows.length, optouts: rows }); }
  catch (e) { res.json({ count: 0, optouts: [] }); }
});

router.get('/log', (req, res) => {
  const { page = 1, per_page = 50 } = req.query;
  const pp = Math.min(parseInt(per_page) || 50, 200);
  const pg = Math.max(parseInt(page) || 1, 1);
  const offset = (pg - 1) * pp;

  const countRow = db().prepare(`SELECT COUNT(*) as total FROM admin_log`).get();
  const total = countRow ? countRow.total : 0;
  const rows = db().prepare(`SELECT * FROM admin_log ORDER BY id DESC LIMIT ? OFFSET ?`).all(pp, offset);
  res.json({ entries: rows, total, page: pg, pages: Math.ceil(total / pp) });
});

// ── SHELLY — specific routes BEFORE wildcard ──────────────────────────────────
router.post('/shelly/bay', async (req, res) => {
  // Accept bay_id OR bayId: the admin Quick Controls client sends bay_id, and a
  // mismatch here silently 400'd every On/Off as "Failed" (maintainer, Aug 15 - the
  // same bay_id/bayId defect pilot facility hit). Take both so no client can trip it.
  const b = req.body || {};
  const bayId = b.bayId || b.bay_id;
  const action = b.action;
  if (!bayId || !['on','off'].includes(action)) return res.status(400).json({ error: 'Provide bay_id and action (on/off)' });
  // The TRUE tee-time procedure, not a raw plug toggle (maintainer, Aug 13): ON runs
  // the full session-start set; OFF shuts the simulator PC down first and
  // waits for it before cutting power. services/sequence.js.
  const seq = require('../services/sequence');
  res.json(action === 'on' ? await seq.startBay(bayId, { source: 'admin' }) : await seq.stopBay(bayId, { source: 'admin' }));
});

router.post('/shelly/device', async (req, res) => {
  const { ip, gen, action } = req.body;
  if (!ip) return res.status(400).json({ error: 'Provide ip' });
  const out = await controlDevice(ip, gen || 2, action === 'on');
  // the command ledger (services/devicelog, Sep 25 2026): a press here is a command like any other
  try { const bay = (require('../services/config').getConfig().bays || []).find(b => (b.shellyDevices || []).some(d => d.ip === ip)); require('../services/devicelog').record({ device: 'shelly:' + ip, bayId: bay ? bay.id : '', op: action === 'on' ? 'on' : 'off', source: 'manual - admin plug button', ok: !!(out && out.success), detail: out && out.error }); } catch {}
  res.json(out);
});

router.get('/shelly/status', async (req, res) => {
  res.json(await getAllStatus());
});

// ── BAY BLOCKS (events / tournaments / maintenance) ──────────────────────────
// A block takes ONE bay offline for a window (hours or days) without touching
// general booking - other bays stay open, and customers simply can't book the
// blocked bay for that window. Stored as a booking row with booking_type set to
// the block type and status 'active', so findConflict() already refuses
// overlapping customer bookings. 'maintenance' additionally skips all
// automation (the scheduler checks booking_type). No door code, no revenue.
router.get('/blocks', (req, res) => {
  try {
    const from = String(req.query.from || require('../services/revenue').facilityToday()).slice(0, 10);
    const rows = db().prepare(
      `SELECT id, bay_id, bay_name, date, end_date, start_time, end_time, booking_type, name
         FROM bookings
        WHERE booking_type IN ('event','tournament','maintenance')
          AND status = 'active'
          AND (end_date >= ? OR date >= ?)
        ORDER BY date, start_time`
    ).all(from, from);
    res.json({ blocks: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/blocks', (req, res) => {
  try {
    const b = req.body || {};
    const bayId = b.bay_id || b.bayId;
    const type = String(b.type || b.booking_type || '').toLowerCase();
    const label = String(b.label || b.name || '').trim();
    const date = String(b.date || '').slice(0, 10);
    const allDay = !!b.all_day;
    let startTime = String(b.start_time || '').slice(0, 5);
    let endTime = String(b.end_time || '').slice(0, 5);
    let endDate = String(b.end_date || date).slice(0, 10);

    if (!['event', 'tournament', 'maintenance'].includes(type)) {
      return res.status(400).json({ error: 'type must be event, tournament, or maintenance' });
    }
    const cfg = getConfig();
    // CLOSING THE WHOLE BUILDING IS ONE ACTION (maintainer's ruling, Sep 19 2026).
    // A party, a repair, a private event: the owner closes the facility for a
    // window, with his own label, and it shows in the calendar as one entry.
    // Blocking each bay in turn was what he was reduced to, and it is the wrong
    // shape even when it works - two rows cannot carry one label, cannot be
    // cancelled as one, and read as two closures.
    // It needs no new conflict rule: a row stamped whole_facility=1 already
    // blocks every bay forever, whatever the live setting says - the stamp on
    // the row wins (bookingcore rule 2) - and the scheduler already wakes
    // nothing for a maintenance row.
    const facilityWide = bayId === 'facility' || bayId === 'all' || b.whole_facility === true;
    const bay = facilityWide ? null : (cfg.bays || []).find(x => x.id === bayId);
    if (!facilityWide && !bay) return res.status(400).json({ error: 'Unknown bay' });
    if (facilityWide && !(cfg.bays || []).length) return res.status(400).json({ error: 'No bays are configured' });
    if (!date) return res.status(400).json({ error: 'A date is required' });

    // All-day = the facility's full operating window, from opening on the first day to closing on the last.
    // (Oct 20 2026) A close after midnight is the NEXT day's clock, as the booking rules read it (closeNextDay) - the window
    // ended before it started and blocked nothing; and an all-day block over several days blocked only its first, the end
    // date it was given thrown away. An end date left before the start (the card's own field still on today) is one day.
    if (allDay) {
      if (!(endDate >= date)) endDate = date;
      // (opening on the first day, closing on the last - each day's own hours, if it has them: services/hours.js)
      const hrs = require('../services/hours'), bk = hrs.on(cfg.booking, date), bkEnd = hrs.on(cfg.booking, endDate);
      const close = bkEnd.closeTime && bkEnd.closeTime !== '00:00' ? bkEnd.closeTime : '';
      startTime = bk.open24Hours ? '00:00' : (bk.openTime || '05:00');
      endTime = bk.open24Hours || !close ? '23:59' : close;
      if (!bk.open24Hours && close && (bkEnd.closeNextDay || close <= bkEnd.openTime)) {
        const [y, m, d] = endDate.split('-').map(Number);
        endDate = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      }
    }
    if (!startTime || !endTime) return res.status(400).json({ error: 'Provide a start and end time, or choose all day' });

    // 62-day cap on any single block window.
    const span = (new Date(endDate) - new Date(date)) / 86400000;
    if (span < 0) return res.status(400).json({ error: 'End date is before the start date' });
    if (span > 62) return res.status(400).json({ error: 'A block can span at most 62 days' });

    // Conflict check: refuse if this window overlaps an existing CUSTOMER booking
    // on this bay (you can't block a bay a paying customer already holds). We
    // surface the overlaps so the owner can decide.
    const core = require('../services/bookingcore');
    const durationMins = core.toMins(endTime) + ((new Date(endDate) - new Date(date)) / 86400000) * 1440 - core.toMins(startTime);
    // A BLOCK IS A BAY-LEVEL HOLD, NEVER A BUILDING BOOKING (maintainer, Sep 18 2026,
    // a staffed two-bay facility in whole-facility mode). findConflict derives
    // "does this candidate own the building" from the LIVE setting when the
    // caller does not say, so in facility mode every candidate - including a
    // maintenance block on one bay - clashed with every row on every bay. The
    // owner took Bay One out for maintenance and then could not block Bay Two
    // ("This overlaps an existing booking on Bay Two") and it read as booked.
    // Taking one bay out is not booking the building, so say so explicitly.
    // What this does NOT change, and should not: a row STAMPED
    // whole_facility=1 still clashes with a block on any bay - you cannot take
    // a bay out from under a customer who holds the whole building - and a
    // per-bay customer booking on THIS bay still refuses it.
    // A bay block asks about ONE bay; closing the building asks about all of
    // them, which is exactly what wholeFacility:true means to findConflict.
    const conflict = core.findConflict({ bay_id: facilityWide ? ((cfg.bays || [])[0] || {}).id : bayId,
      date, start_time: startTime, end_time: endTime, end_date: endDate,
      duration_minutes: durationMins, wholeFacility: facilityWide });
    if (conflict) {
      return res.status(409).json({ error: 'This overlaps an existing booking on ' + (facilityWide ? 'the facility' : bay.name), conflict: { name: conflict.name, date: conflict.date, start_time: conflict.start_time, end_time: conflict.end_time } });
    }

    const { v4: uuidv4 } = require('uuid');
    const id = 'blk-' + uuidv4();
    const typeLabel = { event: 'Event', tournament: 'Tournament', maintenance: 'Maintenance' }[type];
    const holdName = facilityWide ? (cfg.server?.businessName || 'The whole facility') : bay.name;
    const holdBayId = facilityWide ? ((cfg.bays || [])[0] || {}).id : bayId;
    db().prepare(
      `INSERT INTO bookings (id, bay_id, bay_name, name, phone, email, date, start_time, end_time, end_date,
         duration_minutes, price_cents, status, booking_type, whole_facility)
       VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, 0, 'active', ?, ?)`
    ).run(id, holdBayId, holdName, label || typeLabel, date, startTime, endTime, endDate, Math.max(0, Math.round(durationMins)), type, facilityWide ? 1 : 0);
    dbModule.save();
    dbModule.adminLog('BAY_BLOCK_CREATED', typeLabel + (facilityWide ? ' - THE WHOLE FACILITY' : ' on ' + bay.name) + ' ' + date + (endDate !== date ? ' to ' + endDate : '') + ' ' + startTime + '-' + endTime);
    res.json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/blocks/:id', (req, res) => {
  try {
    const row = db().prepare(`SELECT bay_name, booking_type FROM bookings WHERE id = ? AND booking_type IN ('event','tournament','maintenance')`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Block not found' });
    db().prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(req.params.id);
    try { require('../services/pricing').releaseBookingCodes(req.params.id); } catch (e) { console.error('code release:', e.message); }
    dbModule.save();
    dbModule.adminLog('BAY_BLOCK_REMOVED', (row.booking_type || 'block') + ' on ' + row.bay_name + ' removed');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


router.post('/shelly/:action', async (req, res) => {
  const { action } = req.params;
  if (!['on','off'].includes(action)) return res.status(400).json({ error: 'Use on or off' });
  res.json(await require('../services/sequence').allBays(action === 'on' ? 'start' : 'stop', { source: 'admin, all bays' }));
});

// ── CANCEL BOOKING WITH REFUND OPTIONS ────────────────────────────────────────
// refund_type: 'full', 'half', 'none' (default: 'full')
router.post('/booking/cancel/:id', async (req, res) => {
  const booking = db().prepare(`SELECT * FROM bookings WHERE id=?`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  // ONE CANCEL AT A TIME, AND NEVER TWICE (Oct 3 2026; pilot facility's handoff section 2 - the Oct 2 fix covered the customer's
  // and the staff pad's cancels only). A second click while the first waited on Stripe texted and emailed the customer
  // twice, and a cancel from a stale list ran the refund again and logged it FAILED. The claim is the same one the
  // staff pad and the customer hold (services/bookingedit), so two different people cannot cancel one booking at once.
  if (booking.status === 'cancelled') return res.status(400).json({ error: 'Already cancelled.' });
  const CANCELLING = require('../services/bookingedit').CANCELLING;
  if (CANCELLING.has(booking.id)) return res.status(409).json({ error: 'This booking is already being cancelled - one moment.', inProgress: true });
  CANCELLING.add(booking.id);
  try { return await ownerCancelOnce(req, res, booking); }
  finally { CANCELLING.delete(booking.id); }
});
async function ownerCancelOnce(req, res, booking) {

  // A REFUND IS NEVER GUESSED (maintainer, Sep 21 2026, pilot facility's money finding #1, present
  // here verbatim). An unrecognised refund_type used to sail past the `!== 'none'`
  // test (so the card WAS refunded), miss the `=== 'half'` branch (so it was
  // refunded in FULL), and then fall through the label ternary to its last arm -
  // so the owner's record and the customer's email both said "No refund" over a
  // full refund. Both screens only ever send full / half / none; anything else is
  // a stale page or a crafted request, and the right answer to either is to move
  // no money at all and say so.
  const refundType = req.body.refund_type || 'full';
  if (!['full', 'half', 'none'].includes(refundType)) {
    try { dbModule.adminLog('REFUND_TYPE_REFUSED', `Booking: ${req.params.id} | asked for: ${String(refundType).slice(0, 40)}`); } catch {}
    return res.status(400).json({ error: 'Unknown refund type - nothing was cancelled and no money moved.' });
  }

  // Revoke door access if already generated
  // a refusal is logged against this booking and retried now, never thrown away (doorlock.revokeOnCancel)
  if (booking.remotelock_person_id) await require('../services/doorlock').revokeOnCancel(booking, 'the owner');

  // Stripe refund
  let refunded = false;
  let refundAmount = 0;
  let refundError = '';
  const stripe = getStripe();

  // #18b async-capture resilience: refund even when stripe_charge_id was stored
  // null (the charge attached after confirm). Prefer the charge; if we don't have
  // one, retrieve the intent and refund by its latest_charge (backfilling the row)
  // or, failing that, by payment_intent. A succeeded payment must always be
  // refundable through this button.
  if (stripe && (booking.stripe_charge_id || booking.stripe_payment_intent) && refundType !== 'none') {
    try {
      let chargeId = booking.stripe_charge_id;
      let piId = booking.stripe_payment_intent;
      if (!chargeId && piId) {
        try {
          const intent = await stripe.paymentIntents.retrieve(piId);
          if (intent && intent.latest_charge) {
            chargeId = intent.latest_charge;
            // backfill so future reads and reporting have it
            db().prepare(`UPDATE bookings SET stripe_charge_id=? WHERE id=?`).run(chargeId, booking.id);
          }
        } catch (e) { /* fall through to payment_intent refund */ }
      }

      const refundOpts = Object.assign(chargeId ? { charge: chargeId } : { payment_intent: piId }, { metadata: require('../services/stripemark').marker() });

      if (refundType === 'half') {
        // half of what the customer paid - the session AND its tax (services/bookingedit.js halfOfPaid)
        refundOpts.amount = await require('../services/bookingedit').halfOfPaid(stripe, booking, chargeId);
        refundAmount = refundOpts.amount;
      } else {
        refundAmount = (booking.price_cents | 0) + (booking.tax_cents | 0);
      }

      if (refundType === 'half' && !(refundOpts.amount > 0)) {
        // half or more already went back (an owner's refund in Stripe) - the customer has their half; Stripe refuses 0
        refunded = true; refundAmount = 0;
        dbModule.adminLog('STRIPE_REFUND', `Booking: ${booking.id} | Type: half | Amount: $0.00 | half or more of what was paid had already been refunded in Stripe - nothing more sent`);
      } else {
      const rf = await stripe.refunds.create(refundOpts, { idempotencyKey: 'rf-' + booking.id + '-' + refundType });
      if (rf && rf.amount) refundAmount = rf.amount;   // what Stripe gave back, in the log and the reply
      refunded = true;
      try { dbModule.markRefunded(booking.id, null, rf, 'owner-cancel'); } catch (e) {}
      dbModule.adminLog('STRIPE_REFUND', `Booking: ${booking.id} | Type: ${refundType} | Amount: $${(refundAmount/100).toFixed(2)} | via ${chargeId ? 'charge' : 'payment_intent'}`);
      }
    } catch (err) {
      console.error('Refund error:', err.message);
      refundError = err.message;
      dbModule.adminLog('STRIPE_REFUND_ERROR', `Booking: ${booking.id} | Error: ${err.message}`);
    }
  } else if (!stripe && refundType !== 'none' && (booking.stripe_charge_id || booking.stripe_payment_intent)) refundError = 'Stripe is not set up on this unit';

  // Update booking status
  db().prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(booking.id);
  try { require('../services/pricing').releaseBookingCodes(booking.id); } catch (e) { console.error('code release:', e.message); }

  // Remove member usage if this was a member booking
  if (booking.member_id) {
    try {
      db().prepare(`DELETE FROM member_usage WHERE booking_id=?`).run(booking.id);
      db().prepare(`DELETE FROM member_guests WHERE booking_id=?`).run(booking.id);
    } catch (err) { console.error('Member usage cleanup error:', err.message); }
  }

  // Only send cancellation messages for active/completed bookings — not pending_payment
  if (booking.status === 'active' || booking.status === 'completed') {
    await sendCancellation(booking);
    // and the email (Oct 20 2026): the staff pad's cancel and the customer's own emailed it, the owner's sent only the
    // text - a customer who never said yes to texts heard nothing and came in for a bay that was gone
    try { if (booking.email) await require('../services/email').sendCancellationEmail(booking); } catch (e) { console.error('cancel email:', e.message); }
  }

  const refundLabel = refundType === 'full' ? 'Full refund' : refundType === 'half' ? '50% refund' : 'No refund';
  // ✗ FAILED only for a refund that was ASKED for (Oct 3 2026): a chosen "No refund" was logged "No refund ✗ FAILED" -
  // the owner's log calling a decision a failure. A paid booking known only by its payment id is a refund asked for too.
  const refundAsked = refundType !== 'none' && !!(booking.stripe_charge_id || booking.stripe_payment_intent);
  dbModule.adminLog('ADMIN_CANCEL', `ID: ${booking.id} | Was: ${booking.status} | Refund: ${refundLabel}${refunded ? ' ✓' : refundAsked ? ' ✗ FAILED' : ''}`);
  // Restore any member credit the booking consumed at creation.
  try {
    const used = dbModule.db.prepare(
      `SELECT member_id, COALESCE(SUM(-delta_cents),0) AS used FROM member_credit
       WHERE booking_id = ? AND reason = 'Applied to booking' GROUP BY member_id`
    ).get(booking.id);
    if (used && used.used > 0) {
      const already = dbModule.db.prepare(
        `SELECT COUNT(*) AS c FROM member_credit WHERE booking_id = ? AND reason LIKE 'Restored%'`
      ).get(booking.id);
      if (!already?.c) {
        dbModule.db.prepare(
          `INSERT INTO member_credit (member_id, delta_cents, reason, booking_id) VALUES (?,?,?,?)`
        ).run(used.member_id, used.used, 'Restored - booking cancelled', booking.id);
      }
    }
  } catch (e) { console.error('Credit restore error:', e.message); }
  try { require('../services/gifts').restoreGiftUse(req.params.id); } catch (e) { console.error('Gift restore error:', e.message); }
  try { const wh = require('../services/webhooks'); wh.dispatch('booking.cancelled', Object.assign(wh.bookingFields(booking), { by: 'admin' })); } catch {}   // the owner or a manager, in Admin

  // A REFUND THAT DID NOT GO THROUGH IS SAID (Oct 20 2026, found by the AI branch's bookings map - rule 29): the reply read
  // "Cancelled - full refund" as a success when the refund failed or Stripe had no keys, and only the log said FAILED
  const refundFailed = refundAsked && !refunded;
  res.json({
    success: true,
    refunded,
    refund_failed: refundFailed || undefined,
    refund_type: refundType,
    refund_amount_cents: refundAmount,
    message: refunded ? `Cancelled with ${refundLabel.toLowerCase()} ($${(refundAmount/100).toFixed(2)})`
      : refundFailed ? `Cancelled - but the ${refundLabel.toLowerCase()} did NOT go through (${refundError || 'Stripe did not answer'}). The customer has not been refunded: refund them in Stripe.`
      : `Cancelled — ${refundLabel.toLowerCase()}`
  });
}

// ── DELETE PENDING PAYMENT BOOKING ───────────────────────────────────────────
// Immediately expire an abandoned pending_payment booking to free the slot.
//
// ASK STRIPE BEFORE KEEPING SOMEBODY'S MONEY (maintainer, Sep 19 2026, the redirect
// review). This route used to flip the row to expired with no Stripe call of
// any kind - no retrieve, no cancel, no refund - while the checkout sweeper
// beside it does all three. That is backwards: this is the button an owner
// reaches for exactly when a checkout LOOKS stuck, which is precisely the
// state a customer who paid through a redirect method and never made it back
// leaves behind. Pressing it kept their money and resold their slot.
// Now it asks the same question the sweeper asks, and answers honestly.
// ── POST /api/admin/memberships/reconcile ────────────────────────────────────
// CHECK NOW (maintainer, Sep 20 2026, rule 11): the owner's own button for "did anyone
// pay for a membership the unit never saw". Runs the same reconcile the boot
// and the nightly run, and answers with what it found.
router.post('/memberships/reconcile', require('../services/auth').requireOwner, async (req, res) => {
  try {
    const r = await require('../services/membership-lifecycle').reconcileOrphanJoins();
    dbModule.adminLog('MEMBERSHIP_RECONCILE_RUN', `by the owner - checked ${r.checked}, recovered ${r.recovered}, pending ${r.pending}, could not create ${r.failed.length}${r.error ? ' - ' + r.error : ''}`);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/booking/expire/:id', async (req, res) => {
  const booking = db().prepare(`SELECT * FROM bookings WHERE id=? AND status='pending_payment'`).get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Not found or not pending' });

  let stripe = null;
  try {
    const key = require('../services/config').getConfig().stripe?.secretKey;
    if (key && !key.startsWith('PASTE')) stripe = module.exports._stripeForTest || stripeClient(key);
  } catch {}

  let alreadyCancelled = false;
  if (stripe && booking.stripe_payment_intent) {
    let pi = null;
    try { pi = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent); }
    catch (e) {
      // Rule 29: an answer we could not get is never recorded as "not paid".
      dbModule.adminLog('ADMIN_EXPIRE_DEFERRED', `${req.params.id} - Stripe could not be asked whether this was paid (${e.message}); the booking was LEFT pending`);
      return res.status(503).json({ error: 'Stripe could not be reached to check whether this customer already paid. Nothing was changed - try again in a moment.' });
    }
    if (pi && pi.status === 'succeeded') {
      // They paid. Their slot is not ours to give away silently.
      return res.status(409).json({
        error: 'This customer has already paid - their payment went through even though the booking never finished. Confirm it instead, or cancel it so they are refunded.',
        paid: true, amountCents: pi.amount_received || pi.amount || booking.price_cents
      });
    }
    // Not paid: cancel the intent so no hold sits on their card - unless it is
    // ALREADY cancelled (maintainer, Sep 23 2026). Stripe refuses to cancel a cancelled
    // intent, and this button read that refusal as "it may have just succeeded",
    // left the row pending and told the owner the unit would settle it - which
    // it never did (the sweeper deferred the same row for ever). The answer was
    // already in hand from the retrieve above: nothing can charge that card.
    if (!(pi && pi.status === 'canceled')) {
      try { await stripe.paymentIntents.cancel(booking.stripe_payment_intent); }
      catch (e) {
        // SAY WHAT IS TRUE (Sep 25 2026, maintainer's item 4). This answered every refusal with "it may
        // have just succeeded ... the unit will settle it within a few minutes" - true for a
        // payment that landed a beat earlier, false for a bank payment still PROCESSING, which
        // can take days and which Stripe will not cancel at all. Ask Stripe again and say which.
        let now = null; try { now = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent); } catch {}
        dbModule.adminLog('ADMIN_EXPIRE_DEFERRED', `${req.params.id} - the intent could not be cancelled (${e.message}); Stripe now says ${now ? now.status : 'nothing'}; the booking was LEFT pending for the sweeper`);
        if (now && now.status === 'succeeded') return res.status(409).json({ error: 'This customer\'s payment went through a moment ago. Confirm the booking instead, or cancel it so they are refunded.', paid: true, amountCents: now.amount_received || now.amount || booking.price_cents });
        if (now && now.status === 'processing') return res.status(409).json({ error: 'The customer\'s bank is still processing this payment, and Stripe will not cancel it while it does. Nothing was changed. The unit checks it every few minutes and confirms the booking or releases the slot when the bank finishes - for a bank payment that can take a few days.', processing: true });
        return res.status(503).json({ error: `Stripe would not cancel this payment just now (${String(e.message).slice(0, 120)}). Nothing was changed; the unit keeps checking it and settles it as soon as Stripe gives an answer.` });
      }
    } else alreadyCancelled = true;
  }

  db().prepare(`UPDATE bookings SET status='expired', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  try { require('../services/pricing').releaseBookingCodes(req.params.id); } catch (e) {}
  dbModule.adminLog('ADMIN_EXPIRE', `Manually expired pending booking: ${req.params.id}${alreadyCancelled ? ' (the payment had already been cancelled, card not charged)' : booking.stripe_payment_intent ? ' (intent cancelled, card not charged)' : ''}`);
  res.json({ success: true });
});

// ── BROADLINK IR ENDPOINTS ───────────────────────────────────────────────────

router.get('/broadlink/discover', async (req, res) => {
  const result = await broadlink.discoverDevices();
  res.json(result);
});

router.post('/broadlink/test', async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  const result = await broadlink.testDevice(ip);
  res.json(result);
});

router.post('/broadlink/learn/start', async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  const result = await broadlink.startLearning(ip);
  res.json(result);
});

router.post('/broadlink/learn/capture', async (req, res) => {
  const result = await broadlink.captureCode();
  res.json(result);
});

// LEARN A TV'S CODE AND KEEP IT, IN ONE STEP (Oct 21 2026 - the device audit: a TV's codes could be learned
// only on the bay's page - Learn, the remote's button, then Save All Bays - so the assistant could not set a TV up). The
// BroadLink listens, the owner presses the button on the TV's own remote within a few seconds, and the code is saved on that
// bay's TV at the place the caller read it (the bay's id, the TV's place in its list and its address must still match - a
// save in between is never written over). 'power' is the one button of a TV whose remote toggles (rule 16): it is saved as
// both its on and its off code and the TV stays a toggle; 'on' and 'off' are for a remote with separate buttons. The same
// gate as the bay editor's save (the owner, and the 2FA step-up when the owner locked settings). The code never comes back.
const IR_LEARN_WAIT_MS = () => (process.env.BA_IR_LEARN_WAIT_MS !== undefined ? Number(process.env.BA_IR_LEARN_WAIT_MS) : 3000);
router.post('/broadlink/learn/assign', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, async (req, res) => {
  const b = req.body || {}, which = String(b.which || ''), index = Number(b.index);
  if (!['power', 'on', 'off'].includes(which)) return res.status(400).json({ error: 'which must be power, on or off' });
  const find = (cfg) => {
    const bay = (cfg.bays || []).find(x => x && x.id === b.bay_id);
    const d = bay && Array.isArray(bay.broadlinkDevices) && Number.isInteger(index) ? bay.broadlinkDevices[index] : null;
    return d && d.ip && d.ip === b.ip ? { bay, d } : null;
  };
  const at = find(getConfig());
  if (!at) return res.status(409).json({ error: 'that TV remote is not on that bay any more - read the bay again' });
  const discrete = require('../services/devicelog').irStyle(at.d) === 'discrete';
  if (which === 'power' && discrete) return res.status(400).json({ error: `${at.d.name || at.d.ip} is set to separate ON and OFF buttons - learn each one` });
  if (which !== 'power' && !discrete) return res.status(400).json({ error: `${at.d.name || at.d.ip} has one power button (a toggle) - learn its power button` });
  const started = await broadlink.startLearning(at.d.ip);
  if (!started || started.success !== true) return res.json({ success: false, error: `the BroadLink at ${at.d.ip} did not start listening${started && started.error ? ': ' + started.error : ''}` });
  await new Promise(r => setTimeout(r, IR_LEARN_WAIT_MS()));
  const got = await broadlink.captureCode();
  if (!got || got.success !== true || !got.command) return res.json({ success: false, error: (got && got.error) || 'no code was heard - point the remote at the BroadLink and press the button again' });
  const cfg = getConfig(), now = find(cfg);
  if (!now) return res.status(409).json({ error: 'that TV remote was changed on the bay while it was listening - nothing was saved' });
  if (which !== 'off') now.d.onCommand = got.command;
  if (which !== 'on') now.d.offCommand = got.command;
  if (which === 'power') now.d.codeStyle = 'toggle';
  saveConfig(cfg);
  dbModule.adminLog('BROADLINK_LEARNED', `${now.bay.name}: ${now.d.name || now.d.ip} - its ${which === 'power' ? 'power button (on and off)' : which.toUpperCase() + ' button'}`);
  res.json({ success: true, learned: which, device: { name: now.d.name || now.d.ip } });
});

router.post('/broadlink/send', async (req, res) => {
  const { ip, command } = req.body;
  if (!ip || !command) return res.status(400).json({ error: 'ip and command required' });
  const result = await broadlink.sendCommand(ip, command);
  res.json(result);
});

router.get('/broadlink/status', async (req, res) => {
  const running = await broadlink.isBridgeRunning();
  res.json({ running });
});

// ── BACKUP — download all critical data as a zip ─────────────────────────────
// Uses the archiver library (no shell), preserving the real folder structure so
// restores put everything back in the right place. Captures the database,
// config, all waivers, and uploaded images.
// ── REVENUE ANALYTICS ────────────────────────────────────────────────────────
// Backend for the Revenue tab. ONE DEFINITION (maintainer, Sep 23 2026): revenue is money
// actually taken, minus refunds - services/revenue.js, the same place the ten-year
// records read. This used to count every active booking's price as revenue whether
// or not money was taken, never subtracted a refund, dropped a cancellation that
// kept part of the fee, and counted member CREDIT at the counter as card money.
// Money is counted on the day it was taken; the ACTIVITY here (bookings, hours)
// is the sessions that took place, by the session's own date.
// The period report - revenue, its parts, the estimated fees, take-home - lives
// in services/revenue.js (report) so the Revenue tab and the yearly export read
// the same figures (Sep 23 2026).
function revRange(startStr, endStr) { return require('../services/revenue').report(startStr, endStr); }
// ── INSIGHTS: memberships & groups, computed from verified sources ────────────
// settlements = group sizes / discounts / door money; member_usage = visits &
// guests; member_credit = ledger; members+tiers = computed subscription revenue
// (actual invoice amounts live in Stripe - labeled as computed in the UI).
router.get('/insights', (req, res) => {
  try {
    const D = dbModule.db;
    const g = (sql, ...p) => { try { return D.prepare(sql).get(...p) || {}; } catch { return {}; } };
    const all = (sql, ...p) => { try { return D.prepare(sql).all(...p); } catch { return []; } };

    // Group sizes (all-time settlements; 30d window where noted)
    const grp = g(`SELECT COUNT(*) n, AVG(actual_golfers) avg FROM settlements`);
    const dist = {}; for (let i = 1; i <= 5; i++) dist[i] = 0; dist['6+'] = 0;
    for (const r of all(`SELECT actual_golfers ag, COUNT(*) c FROM settlements GROUP BY actual_golfers`)) {
      if (r.ag >= 6) dist['6+'] += r.c; else dist[r.ag] = r.c;
    }
    const wk = g(`SELECT AVG(s.actual_golfers) avg FROM settlements s JOIN bookings b ON b.id = s.booking_id
      WHERE CAST(strftime('%w', b.date) AS INTEGER) IN (0,5,6)`);
    const withGuests = g(`SELECT SUM(CASE WHEN actual_golfers > 1 THEN 1 ELSE 0 END)*100.0/MAX(COUNT(*),1) pct FROM settlements`);

    // Show-up discipline, last 30 days (deposit bookings whose end passed)
    const shows = g(`SELECT
        SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) showed,
        SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) noshow
      FROM bookings b LEFT JOIN settlements s ON s.booking_id = b.id
      WHERE b.is_deposit = 1 AND b.status IN ('active','completed')
        AND b.date >= date('now','-30 days') AND (b.date || 'T' || b.end_time) < strftime('%Y-%m-%dT%H:%M','now','localtime')`);
    const cancels = g(`SELECT COUNT(*) c FROM bookings WHERE status='cancelled' AND updated_at >= datetime('now','-30 days')`);

    // Per-tier P&L (this calendar month)
    // Paying units only: multi-code CHILDREN ride one subscription — counting
    // them would multiply revenue by the code count (caught in verification).
    const tiers = all(`SELECT t.id, t.name,
        SUM(CASE WHEN (m.parent_member_id IS NULL OR m.parent_member_id = '')
             THEN (CASE WHEN m.billing_cadence='annual' THEN t.price_annual/12.0 ELSE t.price_monthly END) ELSE 0 END) sub_rev,
        SUM(CASE WHEN (m.parent_member_id IS NULL OR m.parent_member_id = '') THEN 1 ELSE 0 END) paying,
        COUNT(m.id) codes
      FROM membership_tiers t JOIN members m ON m.tier_id = t.id AND m.status='active'
      GROUP BY t.id ORDER BY sub_rev DESC`);
    const discMonth = all(`SELECT m.tier_id, SUM(s.member_discount_cents) d FROM settlements s
      JOIN bookings b ON b.id = s.booking_id JOIN members m ON m.id = b.member_id
      WHERE strftime('%Y-%m', s.settled_at) = strftime('%Y-%m','now') GROUP BY m.tier_id`);
    const dmap = {}; for (const r of discMonth) dmap[r.tier_id] = r.d || 0;
    const creditOut = g(`SELECT COALESCE(SUM(delta_cents),0) bal FROM member_credit`);

    // Engagement (30d) + savings YTD
    const activeMembers = g(`SELECT COUNT(*) c FROM members WHERE status='active'`).c || 0;
    const eng = g(`SELECT COUNT(*) visits, COALESCE(SUM(guest_count),0) guests FROM member_usage WHERE date >= date('now','-30 days')`);
    const savings = g(`SELECT COALESCE(SUM(member_discount_cents),0) d FROM settlements WHERE strftime('%Y', settled_at) = strftime('%Y','now')`);
    const top = g(`SELECT m.name, COUNT(*) c FROM member_usage u JOIN members m ON m.id = u.member_id
      WHERE u.date >= date('now','-30 days') GROUP BY u.member_id ORDER BY c DESC LIMIT 1`);

    // Realized rate, last 30 days
    const door = g(`SELECT COALESCE(SUM(collect_cents),0) + COALESCE(SUM(deposit_cents),0) c FROM settlements s
      JOIN bookings b ON b.id = s.booking_id WHERE b.date >= date('now','-30 days')`);
    const online = g(`SELECT COALESCE(SUM(price_cents),0) c, COALESCE(SUM(duration_minutes),0) mins FROM bookings
      WHERE status IN ('active','completed') AND is_deposit = 0 AND date >= date('now','-30 days')`);
    const depMins = g(`SELECT COALESCE(SUM(b.duration_minutes),0) mins, COALESCE(SUM(s.actual_golfers * b.duration_minutes),0) gmins
      FROM settlements s JOIN bookings b ON b.id = s.booking_id WHERE b.date >= date('now','-30 days')`);
    const totalCents = (door.c || 0) + (online.c || 0);
    const totalHours = ((online.mins || 0) + (depMins.mins || 0)) / 60;
    const golferHours = ((depMins.gmins || 0) + (online.mins || 0)) / 60; // non-deposit assumed 1 golfer known

    res.json({
      groups: { settled: grp.n || 0, avg: grp.avg || 0, weekend_avg: wk.avg || 0, with_guests_pct: withGuests.pct || 0, dist },
      shows: { showed: shows.showed || 0, noshow: shows.noshow || 0, cancels_30d: cancels.c || 0 },
      tiers: tiers.map(t => ({ name: t.name, paying: t.paying, codes: t.codes, sub_rev_dollars: Math.round(t.sub_rev || 0), discounts_cents: dmap[t.id] || 0 })),
      credit_outstanding_cents: Math.max(0, creditOut.bal || 0),
      gift_liability_cents: (function () {
        // Outstanding gift-card value = money the facility already collected
        // but still owes in play. Real liability; belongs on the owner's page.
        try {
          const cards = dbModule.db.prepare(`SELECT id, value FROM discount_codes WHERE type='gift'`).all();
          let total = 0;
          for (const c of cards) {
            const used = dbModule.db.prepare(`SELECT COALESCE(SUM(discount_cents),0) AS c FROM discount_uses WHERE code_id=?`).get(c.id);
            total += Math.max(0, Math.round((c.value || 0) * 100) - (used.c || 0));
          }
          return total;
        } catch { return 0; }
      })(),
      engagement: { active_members: activeMembers, visits_30d: eng.visits || 0, guests_30d: eng.guests || 0,
        savings_ytd_cents: savings.d || 0, top_member: top.name ? `${top.name} — ${top.c} visits` : null },
      realized: { total_cents_30d: totalCents, bay_hours_30d: Math.round(totalHours * 10) / 10,
        per_bay_hour_cents: totalHours > 0 ? Math.round(totalCents / totalHours) : 0,
        per_golfer_hour_cents: golferHours > 0 ? Math.round(totalCents / golferHours) : 0 }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── RESTART A BAY: power cycle it (the frozen-simulator fix) ──────────────
// ── A BAY OUT OF SERVICE IS A STATE, NOT A WINDOW (maintainer's ruling, Sep 19 2026) ──
// A block is a window with an end time; "this bay is down until I say
// otherwise" is not. The flag already existed (`bay.maintenance`) and was read
// in five places in routes/bookings.js - availability, the bay list, the
// refusal - but NOTHING could set it. It was a feature with no switch.
// It lives in Bay Operations because that is where an owner is standing when
// they take a bay out: the same screen as the plug, the PC and the restart.
// What it does: that bay disappears from booking and its devices never wake.
// What it does NOT do: change the price, or stop the building being sold.
router.post('/bays/:bayId/maintenance', (req, res) => {
  try {
    const cfg = getConfig();
    const bay = (cfg.bays || []).find(b => b.id === req.params.bayId);
    if (!bay) return res.status(404).json({ error: 'Unknown bay' });
    const on = !!(req.body && req.body.maintenance);
    bay.maintenance = on;
    if (!on) delete bay.maintenance;
    require('../services/config').saveConfig(cfg);
    dbModule.adminLog('BAY_MAINTENANCE', `${bay.name} ${on ? 'taken OUT OF SERVICE' : 'put back in service'}`);
    res.json({ ok: true, bay: bay.id, maintenance: on });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bays/:bayId/restart', async (req, res) => {
  try {
    const out = await restartBay(req.params.bayId);
    dbModule.adminLog('BAY_RESTART', `${req.params.bayId}${out.skipped ? ' (no plugs configured)' : ''}`);
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Could not restart that bay' }); }
});

// ── AUTOMATION HEALTH: failure must never be silent (maintainer, Aug 11) ───────────
// rule 23 (A-wave 5): THE UNIT-HEALTH LINE - what the scheduler's tick stored, or ?fresh=1 to
// compute now. Owner and manager may read it (the About panel does); nothing here is a setting.
router.get('/health', (req, res) => {
  try { res.json(require('../services/unithealth').current({ fresh: String(req.query.fresh || '') === '1' })); }
  catch (e) { res.status(500).json({ ok: false, level: 'red', error: 'Health unavailable: ' + e.message }); }
});
// The owner draws a line under unencrypted copies they have dealt with (Sep 23
// 2026) - the same shape as the checkout acknowledgement: owner only, nothing
// deleted, the acknowledgement is its own row in their log.
router.post('/health/ack/plaincopy', require('../services/auth').requireOwner, (req, res) => {
  dbModule.adminLog('BACKUP_LEFT_PLAIN_ACK', 'The owner acknowledged the unencrypted copies so far - anything before this line is not counted on the health line');
  try { require('../services/unithealth').refresh(); } catch {}
  res.json({ acknowledged: true });
});
router.get('/automation/health', (req, res) => {
  try { res.json(require('../services/automation').health({ hours: parseInt(req.query.hours, 10) || 48 })); }
  catch (e) { res.status(500).json({ error: 'Health unavailable' }); }
});
router.post('/automation/retry', (req, res) => {
  const { booking_id, kind, device_key } = req.body || {};
  if (!booking_id || !kind) return res.status(400).json({ error: 'booking_id and kind are required' });
  try {
    const r = require('../services/automation').retryNow(booking_id, kind, device_key || '');
    if (r && r.queued === false) return res.status(409).json({ error: r.reason });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not requeue' }); }
});

// ── WEBHOOKS: last delivery (so the owner can see it is actually working) ────
router.get('/webhooks/last', (req, res) => {
  try { res.json(require('../services/webhooks').lastDelivery() || { none: true }); }
  catch { res.json({ none: true }); }
});

// ── THE BOOKINGS IN THE OWNER'S OWN CALENDAR AND FILES (Oct 19 2026, services/calendarfeed.js) ──
// The private link is a credential, so the card and its switches are the owner's; an export is the owner's too, and
// each one is written in the owner's log (what, which days, with or without names and contact details).
router.get('/calendar', require('../services/auth').requireOwner, (req, res) => res.json(require('../services/calendarfeed').state()));
router.post('/calendar', require('../services/auth').requireOwner, (req, res) => {
  const b = req.body || {};
  res.json(require('../services/calendarfeed').update({ enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined, names: typeof b.names === 'boolean' ? b.names : undefined,
    contact: typeof b.contact === 'boolean' ? b.contact : undefined, newLink: b.newLink === true }));
});
// WHAT THE UNIT TRACKS, AS ANSWERS (Oct 20 2026, late; maintainer: "turn it into usable information for the owner"):
// services/insights.js - a period against the one before it (money is the owner's, as on the Revenue tab), one day, who is
// playing now, and the tax for a range as a workbook
const INS_DATE = /^\d{4}-\d{2}-\d{2}$/;
const insRange = (q, f = 'from', t = 'to') => {
  const from = String(q[f] || ''), to = String(q[t] || '');
  if (!INS_DATE.test(from) || !INS_DATE.test(to) || to < from) return { error: `${f} and ${t} are dates (YYYY-MM-DD), ${f} first` };
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 3700) return { error: 'ten years at a time at most' };
  return { from, to };
};
// cfrom and cto: what the period is put against ("the same days last month"); without them, the days just before it.
// /insights/period - GET /insights is the memberships-and-groups read above (the admin page's), and it stays as it is
router.get('/insights/period', require('../services/auth').requireOwner, (req, res) => {
  const q = req.query || {}, r = insRange(q); if (r.error) return res.status(400).json({ error: r.error });
  const c = q.cfrom || q.cto ? insRange(q, 'cfrom', 'cto') : {}; if (c.error) return res.status(400).json({ error: c.error });
  try { res.json(require('../services/insights').summary(r.from, r.to, c.from, c.to)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// from=HH:MM: only what runs from then ("tonight"), with each hour's bays booked and the bays free all that time
router.get('/insights/day', (req, res) => {
  const q = req.query || {}, d = String(q.date || ''), f = q.from ? String(q.from) : '';
  if (!INS_DATE.test(d)) return res.status(400).json({ error: 'date is YYYY-MM-DD' });
  if (f && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f)) return res.status(400).json({ error: 'from is a time, HH:MM' });
  try { res.json(require('../services/insights').day(d, f || undefined)); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/insights/now', (req, res) => {
  try { res.json(require('../services/insights').now()); } catch (e) { res.status(500).json({ error: e.message }); }
});
// THE OWNER'S QUESTIONS ABOUT THEIR PEOPLE AND MONEY (Oct 25 2026 - services/insights.js): what a group spends online
// and at the counter, the guests members bring, the members who play most, the customers coming back and what they spend
router.get('/insights/:kind(groups|guests|top-members|customers)', require('../services/auth').requireOwner, (req, res) => {
  const r = insRange(req.query || {}); if (r.error) return res.status(400).json({ error: r.error });
  const I = require('../services/insights'), f = { groups: I.groups, guests: I.guests, 'top-members': I.topMembers, customers: I.customersDetail }[req.params.kind];
  try { res.json(f(r.from, r.to)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// THE FACILITY, STUDIED (Oct 25 2026 - services/study.js): kind=trends (month by month, the busiest and slowest
// months, the growth against a year before) or kind=specials (each counter special's days beside the same days before it) - worked
// out at night and kept for the day, or worked out now on a day with none
router.get('/study', require('../services/auth').requireOwner, (req, res) => {
  const kind = String((req.query || {}).kind || '');
  if (!['trends', 'specials'].includes(kind)) return res.status(400).json({ error: 'kind is trends or specials' });
  // (fresh=1: worked out again now, whatever was kept)
  try { res.json(require('../services/study').get(kind, { force: String((req.query || {}).fresh || '') === '1' })); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/tax/export.xlsx', require('../services/auth').requireOwner, async (req, res) => {
  const r = insRange(req.query || {}); if (r.error) return res.status(400).json({ error: r.error });
  const work = require('../services/backup').workDir('export');
  const drop = () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch {} };
  try {
    const name = `tax-${r.from}-to-${r.to}.xlsx`, out = require('path').join(work, name);
    await require('../services/xlsxwriter').writeXlsx(require('../services/insights').taxSheets(r.from, r.to), out, { title: `Tax ${r.from} to ${r.to}` });
    dbModule.adminLog('TAX_EXPORTED', `${r.from} to ${r.to}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    const rs = fs.createReadStream(out); rs.on('close', drop); rs.on('error', () => { drop(); if (!res.headersSent) res.status(500).end(); }); rs.pipe(res);
  } catch (e) { drop(); res.status(500).json({ error: e.message }); }
});
router.get('/bookings/export', require('../services/auth').requireOwner, async (req, res) => {
  const q = req.query || {};
  const fmt = String(q.format || '');
  const names = q.names !== '0', contact = q.contact === '1';
  const work = fmt === 'xlsx' ? require('../services/backup').workDir('export') : null;
  const drop = () => { if (work) { try { fs.rmSync(work, { recursive: true, force: true }); } catch {} } };
  try {
    const out = await require('../services/calendarfeed').exportBookings({ from: String(q.from || ''), to: String(q.to || ''), format: fmt, names, contact }, work);
    dbModule.adminLog('BOOKINGS_EXPORTED', `${q.from} to ${q.to} as ${fmt}${names ? ', with customer names' : ', no names'}${contact ? ', with phone and email' : ''}`);
    res.setHeader('Content-Type', out.type);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (out.body !== undefined) { drop(); return res.send(out.body); }
    const rs = fs.createReadStream(out.path);
    rs.on('close', drop);
    rs.on('error', () => { drop(); if (!res.headersSent) res.status(500).json({ error: 'The export failed' }); else res.destroy(); });
    rs.pipe(res);
  } catch (e) {
    drop();
    res.status(e.status || 500).json({ error: e.status ? e.message : 'The export failed: ' + e.message });
  }
});

// ── KITCHEN/COUNTER PRINTERS: registry + test print ──────────────────────────
router.post('/printers/add', (req, res) => {
  try {
    const { name, role } = req.body || {};
    if (!name?.trim() || !['kitchen', 'bar', 'counter'].includes(role))
      return res.status(400).json({ error: 'Name and a valid role are required.' });
    const cfg = getConfig();
    cfg.printers = cfg.printers || [];
    const token = 'prn_' + require('crypto').randomBytes(12).toString('hex');
    const p = { id: 'prn-' + Date.now(), name: name.trim(), role, token };
    cfg.printers.push(p);
    saveConfig(cfg);
    dbModule.adminLog('PRINTER_ADDED', `${p.name} (${role})`);
    res.json({ success: true, printer: p, pollUrl: `/api/cloudprnt/${token}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/printers/test', (req, res) => {
  try {
    const cfg = getConfig();
    const p = (cfg.printers || []).find(x => x.id === req.body?.printer_id);
    if (!p) return res.status(404).json({ error: 'Printer not found' });
    require('../services/printing').enqueue(p.id,
      'TEST PRINT\n' + p.name + ' (' + p.role + ')\n' + new Date().toLocaleString() + '\nIf you can read this, CloudPRNT is\ntalking to your booking system.\n');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BAY OPERATIONS: live state + PC restart ───────────────────────────────────
// Manual-facility grace: bays with no smart hardware report mode:'manual';
// a facility with none anywhere gets hasHardware:false and the console hides.
router.get('/baystate', async (req, res) => {
  try {
    const cfg = getConfig();
    const { getStatus } = require('../services/shelly');
    const { probePc } = require('../services/simulator');
    const out = [];
    for (const bay of (cfg.bays || []).filter(b => b.active)) {
      const plugDev = (bay.shellyDevices || []).find(d => d.ip);
      // `maintenance` rides along so Bay Operations can show the state and its
      // toggle - the flag is the one the booking routes already read (Sep 19 2026)
      const entry = { id: bay.id, name: bay.name, mode: 'manual', plug: null, pc: null, maintenance: !!bay.maintenance };
      if (plugDev) {
        entry.mode = 'smart';
        const st = await getStatus(plugDev.ip, plugDev.gen || 1);
        entry.plug = st.success ? { on: !!st.on, watts: st.watts ?? null } : { on: null, watts: null, unreachable: true };
      }
      if (bay.simulatorPcIp) {
        entry.mode = 'smart';
        entry.pc = { online: await probePc(bay.simulatorPcIp) };
      }
      entry.closeOverride = !!bay.closeOverride;
      out.push(entry);
    }
    res.json({ hasHardware: out.some(b => b.mode === 'smart'), open24Hours: !!cfg.booking?.open24Hours, bays: out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// WAKE-ON-LAN (pilot facility, Aug 2026): fire a magic packet. Test button passes a raw
// MAC; a saved bay can pass bay_id and we use its stored pcMac. Owner-only.
router.post('/pc/wake', async (req, res) => {
  try {
    const { mac, bay_id } = req.body || {};
    const { getBayById, wakePc } = require('../services/simulator');
    let target = (mac || '').trim();
    if (!target && bay_id) {
      const bay = getBayById(bay_id);
      if (!bay) return res.status(404).json({ error: 'Bay not found' });
      target = (bay.pcMac || '').trim();
    }
    if (!target) return res.status(400).json({ error: 'No MAC address provided for this bay' });
    const ok = wakePc(target);
    if (ok) dbModule.adminLog('PC_WAKE', `${target}${bay_id ? ' | bay ' + bay_id : ' | test'}`);
    res.json({ success: ok, error: ok ? undefined : 'Invalid MAC address' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pc/restart', async (req, res) => {
  try {
    const { bay_id } = req.body || {};
    const { getBayById, sendRestart } = require('../services/simulator');
    const bay = getBayById(bay_id);
    if (!bay) return res.status(404).json({ error: 'Bay not found' });
    if (!bay.simulatorPcIp) return res.status(400).json({ error: 'No PC configured for this bay' });
    const ok = await sendRestart(bay);
    res.json({ success: ok });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GROUP CHECK-IN: today list + settlement ──────────────────────────────────
// Today's bookings with check-in state. Deposit bookings carry the button;
// unchecked deposit bookings past start+15min show as no-shows (reversible).
router.get('/today', (req, res) => {
  try {
    const today = require('../services/revenue').facilityToday();   // the facility's day, not UTC's (test-facility-day)
    const rows = dbModule.db.prepare(`
      SELECT b.id, b.bay_name, b.name, b.date, b.start_time, b.end_time,
             b.duration_minutes, b.price_cents, b.status, b.is_deposit,
             b.member_id, b.member_guest_count,
             s.actual_golfers, s.collect_cents, s.credit_to_member_cents,
             s.settled_by, s.settled_at,
             m.name AS member_name, mt.share_discount_pct
      FROM bookings b
      LEFT JOIN settlements s ON s.booking_id = b.id
      LEFT JOIN members m ON m.id = b.member_id
      LEFT JOIN membership_tiers mt ON mt.id = m.tier_id
      WHERE b.date = ? AND b.status IN ('active','completed')
      ORDER BY b.start_time`).all(today);
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const t2m = (t) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
    res.json(rows.map(r => ({
      ...r,
      checked_in: !!r.settled_at,
      no_show: !!r.is_deposit && !r.settled_at && nowMins > t2m(r.start_time) + 15 && nowMins < t2m(r.end_time) + 24 * 60,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Settle a deposit booking at the door. Math per the settled design:
// shares per person from the anonymous standard total; member share gets the
// tier's share-discount %; the DEPOSIT IS THE MEMBER'S MONEY — it covers his
// share and the surplus becomes his standing tab credit (default mode), or in
// 'group' mode it reduces the whole group's bill.
router.post('/checkin', (req, res) => {
  try {
    const { booking_id, actual_golfers, settled_by } = req.body || {};
    const n = parseInt(actual_golfers);
    if (!booking_id || !n || n < 1 || n > 30) return res.status(400).json({ error: 'booking_id and actual_golfers (1-30) required' });
    const b = dbModule.db.prepare(`SELECT b.*, m.id AS mid, mt.share_discount_pct
      FROM bookings b LEFT JOIN members m ON m.id = b.member_id
      LEFT JOIN membership_tiers mt ON mt.id = m.tier_id WHERE b.id = ?`).get(booking_id);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (!b.is_deposit) return res.status(400).json({ error: 'Not a deposit booking' });
    const existing = dbModule.db.prepare(`SELECT id FROM settlements WHERE booking_id = ?`).get(booking_id);
    if (existing) return res.status(409).json({ error: 'Already checked in' });

    const { calculatePrice } = require('../services/pricing');
    const standard = b.package_id ? (b.price_cents | 0) : Math.max(0, calculatePrice(b.date, b.start_time, b.duration_minutes, b.bay_id) - (b.deal_cents | 0));   // (less its booking deal; a package: its own price)
    const share = Math.round(standard / n);
    const dPct = b.share_discount_pct || 0;
    const memberShare = b.member_id ? Math.round(share * (1 - dPct / 100)) : 0;
    const discountGiven = b.member_id ? (share - memberShare) : 0;
    const deposit = b.price_cents || 0;
    const creditMode = (getConfig().membership?.depositCreditMode === 'group') ? 'group' : 'member_tab';
    let collect, creditToMember = 0;
    if (creditMode === 'member_tab') {
      // Member's money: covers HIS share; surplus -> his standing credit.
      // Guests owe their full shares regardless.
      const guestTotal = share * (n - (b.member_id ? 1 : 0));
      const memberOwes = Math.max(0, memberShare - deposit);
      creditToMember = Math.max(0, deposit - memberShare);
      collect = guestTotal + memberOwes;
    } else {
      // Group mode: deposit reduces the whole group's bill.
      const groupTotal = (share * (n - (b.member_id ? 1 : 0))) + memberShare;
      collect = Math.max(0, groupTotal - deposit);
    }
    dbModule.db.prepare(`INSERT INTO settlements (booking_id, actual_golfers, standard_total_cents,
      member_share_cents, member_discount_cents, deposit_cents, credit_to_member_cents,
      collect_cents, credit_mode, settled_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(booking_id, n, standard, memberShare, discountGiven, deposit, creditToMember, collect, creditMode, String(settled_by || 'Staff').slice(0, 60));
    if (creditToMember > 0 && b.mid) {
      dbModule.db.prepare(`INSERT INTO member_credit (member_id, delta_cents, reason, booking_id)
        VALUES (?,?,?,?)`).run(b.mid, creditToMember, 'Deposit surplus at check-in', booking_id);
    }
    try { require('../services/webhooks').dispatch('checkin.completed', { booking_id: b.id, bay: b.bay_name, golfers: n, collect_cents: collect, employee: String(settled_by || '').trim() }); } catch {}
    dbModule.adminLog('GROUP_CHECKIN', `${b.name} ${b.date} ${b.start_time} - ${n} golfers, collect $${(collect/100).toFixed(2)}${creditToMember ? `, member credit +$${(creditToMember/100).toFixed(2)}` : ''} (${String(settled_by || 'Staff').slice(0,60)})`);
    res.json({ success: true, actual_golfers: n, share_cents: share, member_share_cents: memberShare,
      member_discount_cents: discountGiven, deposit_cents: deposit, credit_to_member_cents: creditToMember,
      collect_cents: collect, credit_mode: creditMode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Both owner and manager can see disk space and About.
router.get('/disk', (req, res) => {
  try { res.json(require('../services/backup').diskSpace()); }
  catch (e) { res.json({ free: null, need: null, low: false, message: null }); }
});
router.get('/about', (req, res) => {
  try {
    const ver = require('../services/version');
    const bk = require('../services/backup');
    const vault = require('../services/backupvault');
    const cfg = getConfig();
    const v = ver.current();
    const nets = Object.values(require('os').networkInterfaces()).flat();
    const lan = nets.find(n => n.family === 'IPv4' && !n.internal)?.address || null;
    let latest = null; try { latest = bk.statusReport().localLatest; } catch {}
    res.json({ business: cfg.server?.businessName || '', version: v, label: ver.label(v),
      node: process.version, hostname: require('os').hostname(), lan,
      lastBackup: latest ? { file: latest.name, size: latest.size, at: latest.date, encryptedCopies: !!vault.vaultState().set } : null,
      // rule 23: the health summary rides the About panel and its copy line (maintainer's ruling)
      health: (() => { try { const u = require('../services/unithealth'); const c = u.current(); return { ok: c.ok, level: c.level, checkedAt: c.checkedAt, summary: c.summary, line: u.line(),
        // each signal that needs the owner, with what to do and - where the owner can draw a line under it - the Acknowledge route
        attention: (c.signals || []).filter(x => x.level !== 'green').map(x => ({ key: x.key, label: x.label, level: x.level, detail: x.detail, action: x.action, ack: x.ack || null })) }; } catch (e) { return { ok: false, level: 'red', summary: 'unavailable: ' + e.message, line: 'Health: RED - unavailable', attention: [] }; } })() });
  } catch (e) { res.status(500).json({ error: 'About unavailable' }); }
});
// The VERSION stamp on its own - Admin > About reads this.
router.get('/version', require('../services/auth').requireOwner, (req, res) => {
  const ver = require('../services/version');
  const v = ver.current();
  res.json(Object.assign({ label: ver.label(v), node: process.version }, v));
});
// ── OFF-SITE BACKUP PULL TOKEN (maintainer, Aug 20): a long random token that opens
// exactly ONE door - downloading the backup zip - so a home PC, NAS, or the
// franchise office can pull nightly through the unit's own domain. ────────────
// ── THE VAULT (Aug 26): passphrase, off-site pull script, test restore ──────
const vaultSvc = require('../services/backupvault');
router.get('/backup/vault', require('../services/auth').requireOwner, (req, res) => {
  res.json(vaultSvc.status());
});
router.post('/backup/vault/passphrase', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, (req, res) => {
  try {
    const { passphrase, clear } = req.body || {};
    if (clear) {
      // Turning encryption off while a copy is set to leave would silently stop
      // it; say what to switch off first instead (Sep 23 2026).
      const b = getConfig().backup || {};
      const on = [].concat(b.enabled !== false && ['sd', 'usb', 'both'].includes(b.destination) ? ['the nightly copy to the SD card or USB stick (step 2)'] : [], b.pullToken ? ['the off-site link (step 3)'] : []);
      if (on.length) return res.status(409).json({ error: `Turn off ${on.join(' and ')} first - they only ever carry encrypted copies.` });
      const st = vaultSvc.clearPassphrase(); dbModule.adminLog('BACKUP_VAULT_CLEARED', 'no passphrase - nothing leaves this unit encrypted until one is set'); return res.json({ ok: true, vault: st });
    }
    const st = vaultSvc.setPassphrase(passphrase);
    dbModule.adminLog('BACKUP_VAULT_SET', 'off-device backups encrypted');
    res.json({ ok: true, vault: st });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// "My computer": a scheduled task with the address and token already filled in
router.get('/backup/pull-script', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, (req, res) => {
  const cfg = getConfig();
  const token = cfg.backup && cfg.backup.pullToken;
  if (!token) return res.status(400).json({ error: 'Turn on the off-site backup link first' });
  const os = req.query.os === 'mac' ? 'mac' : 'windows';
  const domain = (cfg.seo && cfg.seo.domain || '').trim();
  const base = domain ? 'https://' + domain.replace(/^https?:\/\//, '') : (req.protocol + '://' + req.get('host'));
  let body;
  try { body = vaultSvc.pullScript(os, base, token); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const name = os === 'mac' ? 'ba-backup.sh' : 'ba-backup.ps1';
  dbModule.adminLog('BACKUP_PULL_SCRIPT', name);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
});
// prove the newest backup restores (into scratch - nothing on the unit changes)
router.post('/backup/test-restore', require('../services/auth').requireOwner, async (req, res) => {
  try {
    const r = await vaultSvc.testRestore();
    dbModule.adminLog(r.ok ? 'BACKUP_TEST_OK' : 'BACKUP_TEST_FAILED', r.ok ? `${r.file}: ${r.counts.bookings} bookings, ${r.counts.members} members, ${r.counts.signed_waivers} signed waivers` : (r.error || 'failed'));
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'Test restore failed' }); }
});

// What a backup holds, before the owner makes one (Sep 23 2026): each part and
// its size, the total, and what is left out - from the builder's own list.
router.get('/backup/contents', require('../services/auth').requireOwner, (req, res) => {
  try { res.json(Object.assign({ ok: true }, require('../services/backup').contents())); }
  catch (e) { res.status(500).json({ ok: false, error: 'Could not read what a backup holds' }); }
});

router.get('/backup/pull-token', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, (req, res) => {
  const cfg = getConfig();
  res.json({ token: cfg.backup?.pullToken || null });
});
router.post('/backup/pull-token', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, (req, res) => {
  // writeConfigRaw, not saveConfig: saveConfig deep-merges, so a deleted key
  // silently survives it - the disable would be a lie (caught by P3).
  const cs = require('../services/config');
  const cfg = cs.getConfig();
  const enable = !(req.body && req.body.disable);
  // The link only ever hands out encrypted backups (maintainer, Sep 23 2026).
  if (enable && !vaultSvc.vaultState().set) return res.status(400).json({ error: vaultSvc.NEEDS_PASSPHRASE, needsPassphrase: true });
  cfg.backup = cfg.backup || {};
  if (enable) cfg.backup.pullToken = require('crypto').randomBytes(32).toString('hex');
  else delete cfg.backup.pullToken;
  cs.writeConfigRaw(cfg);
  dbModule.adminLog(enable ? 'BACKUP_TOKEN_SET' : 'BACKUP_TOKEN_CLEARED');
  res.json({ success: true, token: enable ? cfg.backup.pullToken : null });
});

// ── MANAGER PASSWORD (owner-only): set or clear the secondary sign-in ────────
router.post('/manager-password', require('../services/auth').requireOwner, (req, res) => {
  try {
    const pw = String((req.body && req.body.password) || '').trim();
    require('../services/auth').setManagerPassword(pw);
    dbModule.adminLog(pw ? 'MANAGER_PASSWORD_SET' : 'MANAGER_PASSWORD_CLEARED');
    res.json({ success: true, enabled: !!pw });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── AI SETUP ASSISTANT PACK ──────────────────────────────────────────────────
// One LLM-consumable master document the owner feeds to Claude/ChatGPT/Gemini
// and asks setup questions about THEIR facility style. Regenerated each wave;
// the battery fails the suite if it goes stale.
router.get('/owner-guide', (req, res) => {
  // ONE AI file (Aug 25): the USB stick's EVERYTHING-ASK-YOUR-AI.md is the
  // master - the same file the customer already has. The old 20 KB
  // AI-SETUP-ASSISTANT pack was a second, smaller copy of the same idea.
  // The complete owner manual is the one file to hand an AI; the first-time
  // install guide is the fallback on a tree that does not carry it.
  const fs2 = require('fs');
  const name = fs2.existsSync(path.join(GUIDE_DIR, 'OWNER-MANUAL.md')) ? 'OWNER-MANUAL.md' : 'EVERYTHING-ASK-YOUR-AI.md';
  const p2 = path.join(GUIDE_DIR, name);
  if (!fs2.existsSync(p2)) return res.status(404).json({ error: 'Guide not found' });
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(p2);
});

// ── GUIDES & HELP (maintainer, Aug 25): every guide on the USB stick, readable and
// downloadable from the admin so a lost stick costs nothing. Files live in
// docs/customer-guides-current; names are whitelisted (no traversal) ──
const GUIDE_NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(pdf|md)$/;
const GUIDE_TITLES = {
  ...Object.fromEntries(Object.entries(installedGuideTitles).flatMap(([file, title]) =>
    [[file, title], [file.replace(/\.md$/, '.pdf'), title + ' (PDF)']])),
  'START-HERE.pdf': 'Start Here - what to do, in order',
  'owners-guide.pdf': "Owner's Guide - running the system day to day",
  'members-guide.pdf': 'Members & Memberships',
  'staff-guide.pdf': 'Staff Guide - working the counter',
  'pos-setup-guide.pdf': 'Setting Up Your Counter - staff codes, menu, card reader',
  'website-builder-guide.pdf': 'Building Your Website - blocks, colors, photos, navigation, sharing',
  'whats-public-guide.pdf': "What's Public and the Holding Page - open your site one part at a time",
  'menu-and-links-guide.pdf': 'Your Menu and Links - rename, re-point, add your own',
  'hero-buttons-guide.pdf': 'Hero Buttons and the Closing Band',
  'notice-bar-guide.pdf': 'The Notice Bar - one line on every page, with a link',
  'email-updates-guide.pdf': 'Email Updates - a signup on your device, a CSV you can download',
  'pdf-pages-guide.pdf': 'PDF Pages - a menu or a flyer as a page of your site',
  'after-a-restore-guide.pdf': 'After a Restore - Reviewing Your Settings',
  'text-formatting-guide.pdf': 'Formatting Your Text - bullets, dividers, headings, bold',
  'stripe-setup-guide.pdf': 'Setting Up Payments (Stripe)',
  'resend-setup-guide.pdf': 'Setting Up Email (Resend)',
  'twilio-setup-guide.pdf': 'Setting Up Text Messaging (Twilio)',
  'remotelock-setup-guide.pdf': 'Setting Up Your Door (RemoteLock)',
  'unifi-access-setup-guide.pdf': 'Setting Up Your Door with UniFi Access',
  'zwave-lock-setup-guide.pdf': 'Setting Up Your Door with a Z-Wave Lock (through your own Home Assistant)',
  'shelly-setup-guide.pdf': 'Setting Up Smart Power (Shelly)',
  'home-assistant-setup-guide.pdf': 'Setting Up Home Assistant (an alternative to Shelly plugs)',
  'bay-pc-setup-guide.pdf': 'Setting Up Your Bay Computers (incl. Wake-on-LAN)',
  'onsite-test-checklist.pdf': 'On-Site Test Checklist - doors, members and bay automation, tested on the premises (print it)',
  'spare-and-recovery.pdf': 'If Something Goes Wrong - backups, the spare, recovery',
  'your-domain-before-we-build.pdf': 'Your Domain - before we build'
};
router.get('/guides', (req, res) => {
  const fs2 = require('fs');
  let names = [];
  try { names = fs2.readdirSync(GUIDE_DIR).filter(n => GUIDE_NAME_OK.test(n)); } catch { names = []; }
  const order = Object.keys(GUIDE_TITLES);
  names.sort((a, b) => (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b)) || a.localeCompare(b));
  res.json({ guides: names.map(n => {
    let size = 0; try { size = fs2.statSync(path.join(GUIDE_DIR, n)).size; } catch {}
    return { file: n, title: GUIDE_TITLES[n] || n.replace(/[-_]/g, ' ').replace(/\.(pdf|md)$/, ''), kind: n.endsWith('.md') ? 'md' : 'pdf', size };
  }) });
});
router.get('/guides/:file', (req, res) => {
  const name = String(req.params.file || '');
  if (!GUIDE_NAME_OK.test(name)) return res.status(400).json({ error: 'Bad guide name' });
  const full = path.join(GUIDE_DIR, name);
  if (!full.startsWith(GUIDE_DIR + path.sep) || !require('fs').existsSync(full)) return res.status(404).json({ error: 'Guide not found' });
  const download = req.query.download === '1' || name.endsWith('.md');
  res.setHeader('Content-Type', name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/pdf');
  res.setHeader('Content-Disposition', (download ? 'attachment' : 'inline') + '; filename="' + name + '"');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(full);
});

// ── GETTING STARTED: live setup completion, computed from real config ─────────
function readSetupStatus(cfg) {
  const fs2 = require('fs');
  const iconsOk = fs2.existsSync(path.join(__dirname, '..', 'public', 'icons', 'icon-192.png'));
  const staffed = !!cfg.booking?.staffedAccess;
  const SS = require('../services/stripestatus').stripeStatus(cfg);
  const items = [
    { id: 'password',  label: 'Admin password set',                done: !!(cfg.server?.adminPassword || cfg.server?.adminAuth), tab: 'settings' },
    { id: 'branding',  label: 'Business name & logo',             sub: iconsOk ? 'App icons generated' : 'Upload a logo to generate app icons', done: !!cfg.server?.businessName && iconsOk, tab: 'settings' },
    { id: 'citystate', label: 'City & state',                     sub: 'Powers your Google listing text', done: !!(cfg.seo?.city && cfg.seo?.state), tab: 'settings' },
    { id: 'hours',     label: 'Hours of operation',               done: !!(cfg.booking?.openTime && cfg.booking?.closeTime && (cfg.booking?.openDays || []).length), tab: 'hours' },
    { id: 'domain',    label: 'Website address',                  sub: 'Your domain, for links & search', done: !!cfg.seo?.domain, tab: 'settings' },
    { id: 'access',    label: 'Facility access mode',             sub: 'Staffed, or door codes?', done: cfg.booking?.staffedAccess !== undefined && cfg.booking?.accessModeChosen !== false, tab: 'hours' },
    // ONE TRUTH (Sep 17 2026, a live customer): this was `!!cfg.stripe?.secretKey`
    // - any non-empty string ticked it green, including a publishable key in the
    // wrong box - while the header badge said NO STRIPE. Both now read
    // services/stripestatus, and the label says what is actually wrong.
    { id: 'stripe',    label: SS.label, sub: SS.detail || undefined, done: SS.ready, tab: 'integrations' },
    // the key AND the From address (Oct 3 2026): a key alone ticked this while every email was being dropped
    { id: 'resend',    label: 'Email sending connected (Resend)', sub: (cfg.resend?.apiKey && !String(cfg.resend?.fromEmail || '').trim()) ? 'Add the From address - without it no email can be sent' : undefined, done: !!(cfg.resend?.apiKey && String(cfg.resend?.fromEmail || '').trim()), tab: 'integrations' },
    // Read where the keys LIVE (Oct 3 2026): this read cfg.sms.accountSid, which nothing ever writes, so the item never
    // ticked for a facility whose texts were going out. The same test the sender uses (services/sms.js).
    { id: 'twilio',    label: 'Text messaging (Twilio)',          sub: 'Optional', optional: true, done: !!((cfg.twilio?.accountSid && cfg.twilio?.authToken && !String(cfg.twilio.accountSid).startsWith('PASTE')) || (cfg.messagebird?.apiKey && !String(cfg.messagebird.apiKey).startsWith('PASTE'))), tab: 'integrations' },
    { id: 'event',     label: 'Add your first event',             sub: 'Optional — shows on your Events page', optional: true, done: false, tab: 'website' },
    // Asked once in the wizard; this is the reminder, not a second question (maintainer, Sep 23 2026).
    (() => { const set = require('../services/backupvault').vaultState().set;
      return { id: 'backuppass', label: 'Backup passphrase', sub: set ? 'Copies that leave this unit are encrypted' : 'Until one is set, backups stay on this unit - no USB copy, no copy to your computer', done: set, tab: 'settings' }; })(),
  ];
  if (staffed) items.push({ id: 'staffedcopy', label: 'Review your landing page text', sub: "Defaults describe self-service - edit if you're staffed", done: !!cfg.setupAck?.staffedcopy, tab: 'website' });
  // SETUP-AWARE GUIDANCE (maintainer, Aug 20): the checklist points each facility
  // down ITS path. Nothing is ever hidden in the product - these are
  // recommendations derived from the shape the owner chose, and they
  // recompute if the shape changes later.
  if (cfg.booking?.membersOnly) {
    let tierCount = 0, tierWaiverOk = false;
    try {
      tierCount = dbModule.db.prepare(`SELECT COUNT(*) AS c FROM membership_tiers WHERE active=1`).get()?.c || 0;
      tierWaiverOk = !!dbModule.db.prepare(`SELECT COUNT(*) AS c FROM waivers WHERE active=1`).get()?.c
        || !!dbModule.db.prepare(`SELECT COUNT(*) AS c FROM membership_tiers WHERE active=1 AND waiver_id IS NOT NULL AND waiver_id != ''`).get()?.c;
    } catch {}
    items.push({ id: 'tier', label: 'Create your membership tier', sub: 'Members-only: no tier means nobody can join or book', done: tierCount > 0, tab: 'members' });
    items.push({ id: 'mwaiver', label: 'Membership waiver document', sub: 'Upload on Waivers; attach per-tier in Edit Tier if a tier needs its own', done: tierWaiverOk, tab: 'waivers' });
  }
  // WAIVER TRUTH (Sep 1 2026 audit): a facility that wants waivers but has no
  // document uploaded asks nobody to sign anything - silently. Say so, once
  // (members-only facilities already carry the mwaiver item above).
  if (!cfg.booking?.membersOnly && (cfg.waiver?.mode || 'required') !== 'off') {
    let hasDoc = false;
    try { hasDoc = !!dbModule.db.prepare(`SELECT COUNT(*) AS c FROM waivers WHERE active=1`).get()?.c; } catch {}
    items.push({ id: 'waiverdoc', label: 'Upload your liability waiver', sub: 'Waivers are ' + (cfg.waiver?.mode === 'optional' ? 'offered' : 'required') + ' - until a PDF is active on the Waivers tab nobody is asked to sign', done: hasDoc, tab: 'waivers' });
  }
  // HYBRID'S ONE REQUIRED STEP (maintainer, Sep 1 2026 — bench finding F3). A hybrid
  // has staffedAccess false, so services/staffing.js decides staffed-or-not
  // ENTIRELY from staffed_days rows. With that calendar empty, every deposit
  // tier and every door-settling member tier quietly falls back to
  // pay-in-full-online - correct behaviour, but it means the deposit the
  // owner configured in the wizard does nothing at all, with no indication.
  // Every other shape had a checklist item for its required step; hybrid,
  // the only shape that cannot work without one, had none.
  // Coverage is counted from TODAY forward: a calendar that has run out is
  // the same problem as one that was never filled.
  if (require('../services/staffing').accessStyleOf(cfg.booking) === 'hybrid') {
    // Coverage counts whether it comes from the calendar or from an active
    // scheduling season - one source (services/staffing.js), so a hybrid on a
    // season is never nagged for a calendar it does not use.
    let upcoming = 0; let viaSeason = false;
    try {
      const st = require('../services/staffing');
      const w = st.upcomingStaffedWindows(366) || [];
      upcoming = w.length; viaSeason = !!st.activeSeason();
    } catch {}
    const off = !!(cfg.coverage && cfg.coverage.scheduleOff);
    items.push({ id: 'staffedhours', label: 'Mark your staffed hours',
      sub: off ? 'Staffed hours are switched OFF (Settings > Schedule) - everyone pays in full online until they are back on'
        : upcoming > 0
          ? `${upcoming} staffed day${upcoming === 1 ? '' : 's'} ahead${viaSeason ? ' from your active season' : ' on the calendar'}`
          : 'Until a day is marked, deposits and door settlement never apply - everyone pays in full online',
      done: upcoming > 0 && !off, tab: viaSeason ? 'settings' : 'website' });
  }
  if (require('../services/staffing').accessStyleOf(cfg.booking) === 'unmanned') {
    items.push({ id: 'checkin', label: 'Check-in mode reviewed', sub: 'Most unmanned facilities run this Off - yours is ' + ((cfg.pos?.checkinMode || 'full') === 'off' ? 'Off' : 'On'), done: (cfg.pos?.checkinMode || 'full') === 'off' || !!cfg.setupAck?.checkin, tab: 'settings' });
  }
  if (cfg.booking?.wholeFacility) {
    items.push({ id: 'wfrate', label: 'Whole-building rate confirmed', sub: 'Base per-30 is the ENTIRE facility rate; bay premiums never apply', done: !!cfg.setupAck?.wfrate || (cfg.booking?.pricePerHalfHour || 0) > 0, tab: 'hours' });
  }
  // SET UP BY TALKING (Oct 20 2026, late): what the first screen did not ask, carried here for the assistant to
  // ask one at a time - each ticks when the owner answers it (or changes it through the assistant) - and, last, opening the
  // site to the public (it is held behind the holding page until then)
  if (cfg.setup && cfg.setup.byAssistant) {
    const ack = cfg.setupAck || {}, want = Array.isArray(cfg.setup.toConfirm) ? cfg.setup.toConfirm : [];
    const days = (cfg.booking?.openDays || []).length, bays = (cfg.bays || []).filter(b => b && b.active !== false);
    if (want.includes('hours')) items.push({ id: 'confirmhours', label: 'Your opening hours', sub: cfg.booking?.open24Hours ? 'Open 24 hours - right, or change them' : `${cfg.booking?.openTime || '?'} to ${cfg.booking?.closeTime || '?'}, ${days} day${days === 1 ? '' : 's'} a week - right, or change them`, done: !!ack.hours, tab: 'hours' });
    if (want.includes('bays')) items.push({ id: 'confirmbays', label: 'Your bays', sub: `${bays.length} so far: ${bays.map(b => b.name).join(', ').slice(0, 80) || 'none'} - name each, or add more`, done: !!ack.bays, tab: 'bays' });
    if (want.includes('price')) items.push({ id: 'confirmprice', label: 'Your price', sub: `$${Number(cfg.booking?.pricePerHalfHour || 0).toFixed(2)} per half hour - right, or change it`, done: !!ack.price, tab: 'pricing' });
    if (want.includes('waiver')) items.push({ id: 'confirmwaiver', label: 'Waivers', sub: 'Required, offered, or none - yours to decide', done: !!ack.waiver, tab: 'waivers' });
    let open = true;
    try { const r = dbModule.db.prepare(`SELECT value FROM website_content WHERE key = 'settings'`).get(); open = require('../services/sitenav').publicMap(r ? JSON.parse(r.value) : {}).booking !== false; } catch {}
    items.push({ id: 'golive', label: 'Open your site to the public', sub: open ? 'Your site is open to the public' : 'Visitors see "not yet public" until you say it is ready - say "go live"', done: open, tab: 'website' });
  }
  // first-event check from DB
  try {
    const evc = dbModule.db.prepare('SELECT COUNT(*) AS c FROM website_events').get();
    const ev = items.find(i => i.id === 'event'); if (ev) ev.done = (evc?.c || 0) > 0;
  } catch {}
  // SET UP BY TALKING, IN THE WIZARD'S ORDER (Oct 21 2026; the sandbox, FROM-SANDBOX.md: after the first screen the assistant
  // opened with "Email sending connected (Resend)" - this card's own order, with the first screen's carried items last). The
  // brief tells the model to lead "starting with the first" and hands it eight items, and playbook 01 walks the wizard's nine
  // steps; so while the assistant leads setup the list is in those steps' order, and the card shows the same. A stable sort:
  // items of one step keep their order; an item no step names goes with the services.
  if (cfg.setup && cfg.setup.byAssistant) {
    // (Oct 22 2026: the order the assistant now asks in itself - services/assistant/setupguide.js STEPS: the easy answers first, then
    // the accounts, the look and the passphrase, and opening the site last)
    const STEP = { password: 0, citystate: 1, domain: 2, confirmbays: 3, access: 4, hours: 5, confirmhours: 5, staffedhours: 6, confirmprice: 7, wfrate: 7,
      confirmwaiver: 8, waiverdoc: 8.1, mwaiver: 8.1, tier: 8.2, checkin: 8.3, stripe: 9, resend: 10, twilio: 11, branding: 12, backuppass: 13,
      staffedcopy: 14, event: 14.5, golive: 15 };
    items.sort((x, y) => (STEP[x.id] || 7.5) - (STEP[y.id] || 7.5));
  }
  // a step the owner put off by talking (setup_skip, BA Core 2 AI, Oct 22 2026): still open, marked with the day - the assistant
  // reminds them of it (services/assistant/setupguide.js)
  const skippedOn = (cfg.setupSkipped && typeof cfg.setupSkipped === 'object') ? cfg.setupSkipped : {};
  for (const i of items) if (!i.done && typeof skippedOn[i.id] === 'string' && skippedOn[i.id]) i.skipped = skippedOn[i.id];
  const ignored = cfg.setupIgnored || [];
  const visible = items.filter(i => !ignored.includes(i.id));
  const doneCount = visible.filter(i => i.done).length;
  // W1 (maintainer's walk-through, Sep 2026): the card used to stay forever, because
  // OPTIONAL items counted against "complete" and any dismissed item pinned
  // it. Now: complete = every REQUIRED visible item done; dismissed items
  // never pin the card; and the owner can hide it outright - it only comes
  // back if a genuinely NEW item appears (a style change can add one).
  const requiredOpen = visible.filter(i => !i.optional && !i.done);
  const complete = requiredOpen.length === 0;
  const hid = cfg.setupHidden && Array.isArray(cfg.setupHidden.ids) ? cfg.setupHidden.ids : null;
  const hidden = !!hid && visible.every(i => hid.includes(i.id));
  return { items: visible, ignored: items.filter(i => ignored.includes(i.id)).map(i => ({ id: i.id, label: i.label })),
    done: doneCount, total: visible.length, complete, required_open: requiredOpen.length,
    optional_open: visible.filter(i => i.optional && !i.done).length, hidden };
}
router.get('/setup-status', (req, res) => res.json(readSetupStatus(getConfig())));
// Hide the checklist from the dashboard. Stores the ids it had at that
// moment, so a new item (one the owner has never seen) un-hides it.
router.post('/setup-hide', (req, res) => {
  const cfg = getConfig();
  if (req.body && req.body.hide === false) { delete cfg.setupHidden; saveConfig(cfg); return res.json({ success: true, hidden: false }); }
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 50) : [];
  cfg.setupHidden = { ids, at: new Date().toISOString() };
  saveConfig(cfg);
  dbModule.adminLog('SETUP_CHECKLIST_HIDDEN', ids.length + ' items');
  res.json({ success: true, hidden: true });
});

// Ignore / restore a setup item ("skip, never silently forget")
router.post('/setup-ignore', (req, res) => {
  const { id, restore } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const cfg = getConfig();
  cfg.setupIgnored = cfg.setupIgnored || [];
  if (restore) cfg.setupIgnored = cfg.setupIgnored.filter(x => x !== id);
  else if (!cfg.setupIgnored.includes(id)) cfg.setupIgnored.push(id);
  if (id === 'staffedcopy' && !restore) { cfg.setupAck = cfg.setupAck || {}; }
  saveConfig(cfg);
  res.json({ success: true });
});

// Acknowledge the staffed-copy review (done = owner confirmed they looked)
router.post('/setup-ack', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const cfg = getConfig();
  cfg.setupAck = cfg.setupAck || {}; cfg.setupAck[id] = true; saveConfig(cfg);
  res.json({ success: true });
});

router.get('/revenue/summary', require('../services/auth').requireOwner, (req, res) => {
  try {
    const cfg = require('../services/config').getConfig();
    // the facility's today (Oct 2026): the UTC date turned at 7 PM Central and every card read the next day's $0
    const rv = require('../services/revenue');
    const t = rv.facilityToday();
    const wkStart = rv.addDays(t, -6);
    const moStart = t.slice(0, 8) + '01';
    const yrStart = t.slice(0, 4) + '-01-01';
    const start = String(req.query.start || moStart).slice(0, 10);
    const end   = String(req.query.end || t).slice(0, 10);
    const range = revRange(start, end);
    // occupancy: booked hours vs open capacity across the range (services/revenue.activity)
    const act = require('../services/revenue').activity(start, end);
    const bookedHours = act.booked_hours, occupancy = act.occupancy;
    // membership MRR: active online members at monthly value (annual at 1/12)
    const mrrRow = db().prepare(`SELECT
        COALESCE(SUM(CASE WHEN m.billing_cadence='annual' THEN t.price_annual/12.0 ELSE t.price_monthly END),0) AS mrr
      FROM members m JOIN membership_tiers t ON t.id = m.tier_id
      WHERE m.status='active' AND m.stripe_subscription_id != ''`).get();
    // By bay and by weekday: the sessions that took place in the range, each
    // worth the money actually taken for it (services/revenue.activity).
    const byBay = act.by_bay, byDow = act.by_dow;
    const out = {
      today: revRange(t, t), week: revRange(wkStart, t),
      month: revRange(moStart, t), year: revRange(yrStart, t),
      // Item 6 (tax visibility): the quarter is the natural tax-remittance
      // period - most facilities file sales tax quarterly. Quarter start =
      // this month floored to the calendar quarter (Jan/Apr/Jul/Oct 1).
      quarter: revRange(t.slice(0, 5) + String(Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0') + '-01', t),
      range, occupancy, bookedHours, rangeStart: start, rangeEnd: end, byBay, byDow
    };
    // #10: membership MRR is noise for a non-membership facility - only include
    // it when memberships are actually on.
    if (!cfg.features || cfg.features.memberships !== false) {
      out.membership_mrr_cents = Math.round((mrrRow.mrr || 0) * 100);
    }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// #9: TAX REMITTANCE CSV - per-booking detail + a SUMMARY block + a TAX
// REMITTANCE block an accountant can file from. GET so a plain browser
// download (window.location) works; auth rides the admin session cookie
// enforced by the router.use guard above.
router.get('/revenue/csv', require('../services/auth').requireOwner, (req, res) => {
  try {
    const cfg = require('../services/config').getConfig();
    const t = require('../services/revenue').facilityToday();
    const start = String(req.query.from || req.query.start || (t.slice(0,8)+'01')).slice(0,10);
    const end   = String(req.query.to   || req.query.end   || t).slice(0,10);
    const biz = (cfg.businessName || cfg.server?.businessName || 'Facility').replace(/[\r\n,]/g, ' ');
    const m = require('../services/revenue').money(start, end);
    const range = revRange(start, end);
    const money = c => (((c||0)/100).toFixed(2));
    const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
    const KIND = { session: 'Session paid online', 'counter-card': 'Counter - card', 'counter-cash': 'Counter - cash', 'counter-check': 'Counter - check', 'gift-card': 'Gift card sold', membership: 'Membership payment', refund: 'Refund' };
    const L = [];
    L.push(esc(biz + ' - Revenue & Tax Report'));
    L.push('Period,' + start + ' to ' + end);
    L.push('Generated,' + new Date().toISOString());
    L.push(esc('Revenue,money this unit recorded taking - online sessions, the counter (card/cash/check), gift cards sold, membership payments - minus refunds; each counted on the day it was taken' + (m.timezone ? ' (' + m.timezone + ')' : '')));
    L.push('');
    L.push(['Date','What','Customer','Detail','Amount','Tax included','Booking','Reference'].join(','));
    for (const it of m.items) {
      L.push([esc(it.day), esc(KIND[it.kind] || it.kind), esc(it.who), esc(it.what), money(it.cents), money(it.tax_cents), esc(it.booking || ''), esc(it.ref)].join(','));
    }
    L.push('');
    L.push('SUMMARY');
    L.push('Sessions paid online,' + money(m.sessions.gross_cents));
    L.push('Counter - card,' + money(m.counter.by_method.card));
    L.push('Counter - cash,' + money(m.counter.by_method.cash));
    L.push('Counter - check,' + money(m.counter.by_method.check));
    L.push('Gift cards sold,' + money(m.gifts.cents));
    L.push('Membership payments,' + money(m.memberships.cents));
    L.push('Refunds,-' + money(m.refunds.cents));
    L.push('REVENUE (money taken minus refunds),' + money(m.revenue_cents));
    L.push('Tips (the staff\'s - not revenue),' + money(m.counter.tips_cents));
    L.push('Estimated processor fees,' + money(range.total_stripe_fees_cents));
    L.push('Take-home after estimated fees,' + money(range.take_home_cents));
    L.push('');
    L.push('NOT REVENUE - what did not come in');
    L.push('Checkouts that expired unpaid,' + m.not_revenue.expired_unpaid.count + ' (' + money(m.not_revenue.expired_unpaid.cents) + ' never taken)');
    L.push('Member credit spent,' + money(m.not_revenue.member_credit_cents));
    L.push('Gift cards spent,' + money(m.not_revenue.gift_card_spend_cents));
    L.push('');
    L.push('TAX REMITTANCE SUMMARY');
    L.push('Revenue before tax,' + money(m.revenue_cents - m.tax_cents));
    L.push('Tax collected on online sessions and memberships (remit to authority),' + money(m.tax_cents));
    L.push(esc('Counter sales,tax the counter charged is inside the counter money above - End of Day shows it by tax category'));
    if (cfg.tax && cfg.tax.label) L.push('Tax label,' + esc(cfg.tax.label));
    if (cfg.tax && cfg.tax.rate) L.push('Configured rate,' + cfg.tax.rate + '%');
    const csvBody = L.join('\r\n');
    const fname = 'revenue-' + start + '-to-' + end + '.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
    res.send(csvBody);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// REFUNDS MADE IN STRIPE'S DASHBOARD (maintainer, Sep 24 2026): when the unit last asked
// Stripe, and the owner's Check now. The same check runs at boot and every night.
router.get('/refunds/status', require('../services/auth').requireOwner, (req, res) => {
  const rf = require('../services/refunds');
  // one idea of what a Stripe key is (services/stripestatus - test-stripe-status F3)
  res.json({ last: rf.lastCheck(), stripe: require('../services/stripestatus').stripeStatus(getConfig()).level !== 'none' });
});
router.post('/refunds/check', require('../services/auth').requireOwner, async (req, res) => {
  try { res.json(await require('../services/refunds').checkStripe()); }
  catch (e) { res.status(500).json({ error: 'Could not check Stripe: ' + e.message }); }
});
// A TEST EMAIL AND A TEST TEXT (Oct 20 2026; maintainer: "payments resend twilio basicly all the things we have
// proven before ... make sure the ai can drive that"): to the owner's own email and mobile - where the owner's alerts go
// (services/owneralert.js) - through the very senders every booking email and text uses. What is missing is said, never
// called a failure (rule 31); a refusal is never called sent (rule 29); a unit holding messages back says so.
const TEST_WHEN = () => new Date().toLocaleString('en-US', { timeZone: require('../services/revenue').tzOf() || undefined, dateStyle: 'medium', timeStyle: 'short' });
const lastLogSince = (events, sinceIso) => { try { return dbModule.db.prepare(`SELECT event, detail FROM admin_log WHERE event IN (${events.map(() => '?').join(',')}) AND created_at >= ? ORDER BY id DESC LIMIT 1`).get(...events, sinceIso.replace('T', ' ').slice(0, 19)) || null; } catch { return null; } };
const maskTo = (v) => String(v).replace(/^(.{2}).*(@.*)$/, '$1***$2').replace(/^(\+?\d{2}).*(\d{2})$/, '$1******$2');
router.post('/messages/test-email', require('../services/auth').requireOwner, async (req, res) => {
  const cfg = getConfig(), to = String((cfg.contact || {}).email || '').trim(), biz = (cfg.server && cfg.server.businessName) || 'Your booking system';
  const held = process.env.EMAIL_DRYRUN === '1';
  if (!to) return res.json({ sent: false, missing: 'your facility email (Settings > Business & Content > Contact Information) - the test goes there' });
  if (!held && !String((cfg.resend || {}).apiKey || '').startsWith('re_')) return res.json({ sent: false, missing: 'the Resend key (paste it into the chat, or Settings > Connections > Resend)' });
  if (!held && !String((cfg.resend || {}).fromEmail || '').trim()) return res.json({ sent: false, missing: 'the From address on the Resend card - without it no email can be sent' });
  const since = new Date(Date.now() - 1000).toISOString();
  const r = await require('../services/email').sendEmail({ to, subject: `${biz} - a test email`, text: `This is a test from your booking system, sent ${TEST_WHEN()} because you asked for one.\n\nIf you are reading it, email works: booking confirmations, reminders and door codes go out the same way.` });
  const why = r === false ? ((lastLogSince(['EMAIL_FAILED', 'EMAIL_ERROR'], since) || {}).detail || '').replace(/^To: [^|]*\| ?/, '') : '';
  try { dbModule.adminLog('TEST_EMAIL', `to ${maskTo(to)}: ${r === true ? (held ? 'held back (this unit sends no email)' : 'sent') : r === false ? 'FAILED - ' + why : 'not sent'}`); } catch {}
  res.json({ sent: r === true && !held, heldBack: held || undefined, to: maskTo(to), error: r === false ? (why || 'Resend refused it') : undefined, missing: r === undefined ? 'email is not set up' : undefined });
});
router.post('/messages/test-text', require('../services/auth').requireOwner, async (req, res) => {
  const cfg = getConfig(), biz = (cfg.server && cfg.server.businessName) || 'Your booking system';
  const to = require('../services/phone').normalize(String((cfg.alerts && cfg.alerts.ownerMobile) || '').trim());
  const held = process.env.SMS_DRYRUN === '1';
  if (!to) return res.json({ sent: false, missing: 'your own mobile number (the owner alerts number on the Twilio card) - the test goes there' });
  const since = new Date(Date.now() - 1000).toISOString();
  const r = await require('../services/sms').sendSMS(to, `${biz}: a test text from your booking system, sent ${TEST_WHEN()}. Texting works.`);
  const ok = r === true || (r && r.success === true), failed = r === false || (r && r.success === false);
  const why = failed ? ((lastLogSince(['SMS_FAILED', 'SMS_ERROR'], since) || {}).detail || '').replace(/^To: [^|—-]*[|—-] ?/, '') : '';
  try { dbModule.adminLog('TEST_TEXT', `to ${maskTo(to)}: ${ok ? (held ? 'held back (this unit sends no texts)' : 'sent') : failed ? 'FAILED - ' + why : 'not sent'}`); } catch {}
  res.json({ sent: ok && !held, heldBack: (ok && held) || undefined, to: maskTo(to), error: failed ? (why || 'the provider refused it') : undefined, missing: r === undefined ? 'texting is not set up (the Twilio account SID, auth token and number)' : undefined });
});
// The charts: money taken minus refunds, by the day (or month) it was taken -
// the same definition, bucketed.
router.get('/revenue/monthly', require('../services/auth').requireOwner, (req, res) => {
  try {
    const year = String(req.query.year || new Date().getFullYear()).slice(0, 4);
    const by = require('../services/revenue').series(`${year}-01-01`, `${year}-12-31`, 'month');
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const row = by.get(key);
      out.push({ month: key, revenue_cents: row ? row.revenue_cents : 0, count: row ? row.count : 0 });
    }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/revenue/daily', require('../services/auth').requireOwner, (req, res) => {
  try {
    const year = String(req.query.year || new Date().getFullYear()).slice(0, 4);
    const month = String(req.query.month || (new Date().getMonth() + 1)).padStart(2, '0');
    const prefix = `${year}-${month}`;
    const daysIn = new Date(Number(year), Number(month), 0).getDate();
    const by = require('../services/revenue').series(`${prefix}-01`, `${prefix}-${String(daysIn).padStart(2, '0')}`, 'day');
    const out = [];
    for (let d = 1; d <= daysIn; d++) {
      const key = `${prefix}-${String(d).padStart(2, '0')}`;
      const row = by.get(key);
      out.push({ date: key, revenue_cents: row ? row.revenue_cents : 0, count: row ? row.count : 0 });
    }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── REVENUE ANALYTICS ────────────────────────────────────────────────────────
// ── RECORDS & RETENTION (maintainer's doctrine, Aug 25 2026) ─────────────────────────
// Person detail purges at >= 10 years (10 is the FLOOR); facility numbers are
// forever. Status feeds the Records card; the per-year archive is the owner's
// door to keeping detail longer - and it leaves the unit under vault law.
router.get('/records/status', (req, res) => {
  try { res.json(require('../services/records').status()); }
  catch (e) { res.status(500).json({ error: 'Records status unavailable' }); }
});
router.post('/records/settings', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, (req, res) => {
  const recSvc = require('../services/records');
  const csvc = require('../services/config');
  const cfg = csvc.getConfig();
  const body = req.body || {};
  // the owner's log: months kept, floor twelve (maintainer, Sep 12 2026) - may come alone or with the years
  if (body.adminLogMonths !== undefined) {
    const m = parseInt(body.adminLogMonths, 10);
    if (!Number.isInteger(m) || m > 600) return res.status(400).json({ error: 'The owner\'s log is kept a number of months (up to 600)' });
    if (m < dbModule.ADMIN_LOG_FLOOR_MONTHS) return res.status(400).json({ error: `The owner's log can be kept longer but never less than ${dbModule.ADMIN_LOG_FLOOR_MONTHS} months` });
    cfg.records = Object.assign({}, cfg.records, { adminLogMonths: m });
    csvc.saveConfig(cfg);
    dbModule.adminLog('RECORDS_SETTINGS', `owner's log kept ${m} months`);
    if (body.retentionYears === undefined) return res.json({ ok: true, retention_years: recSvc.retentionYears(), admin_log_months: dbModule.adminLogMonths() });
  }
  const n = parseInt(body.retentionYears, 10);
  if (!Number.isInteger(n) || n > 100) return res.status(400).json({ error: 'Retention must be a number of years (up to 100)' });
  if (n < recSvc.FLOOR_YEARS) return res.status(400).json({ error: `Retention can be raised but never set below ${recSvc.FLOOR_YEARS} years` });
  cfg.records = Object.assign({}, csvc.getConfig().records, { retentionYears: n });
  csvc.saveConfig(cfg);
  dbModule.adminLog('RECORDS_SETTINGS', `retention ${n} years`);
  res.json({ ok: true, retention_years: recSvc.retentionYears(), admin_log_months: dbModule.adminLogMonths() });
});
// Owner-triggered purge of everything already past its date (the nightly job
// does the same on its own; this is the "run it now" door).
router.post('/records/purge-now', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, async (req, res) => {
  try {
    const r = await require('../services/records').runNightly();
    res.json({ ok: true, purged: r.purged, warned: r.warned });
  } catch (e) { res.status(500).json({ error: 'Purge failed' }); }
});
// The per-year archive: full person detail while it still exists. A download
// is a copy that LEAVES the unit - vault law from the backup download applies
// verbatim: encrypted when the passphrase is set; ?plain=1 takes the step-up.
router.get('/records/archive/:year', require('../services/auth').requireOwner, async (req, res) => {
  const y = parseInt(req.params.year, 10);
  const nowY = new Date().getFullYear();
  if (!Number.isInteger(y) || y < 2000 || y > nowY) return res.status(400).json({ error: 'Bad year' });
  const vault = require('../services/backupvault');
  // A year's records with names and money is the thing most worth encrypting
  // (maintainer, Sep 24 2026): the same rule as USB, off-site and the waiver archive -
  // refused without a passphrase, plain only behind the 2FA step-up.
  if (!vault.vaultState().set) return res.status(409).json({ error: vault.NEEDS_PASSPHRASE, needsPassphrase: true });
  if (req.query.plain === '1') {
    return require('../services/auth').requireSensitive(req, res, () => streamYearArchive(req, res, y, false));
  }
  return streamYearArchive(req, res, y, true);
});
// THE YEAR-END REPORT (maintainer, Sep 23 2026): a PDF, a workbook, CSVs and a README
// for the year, every figure from services/revenue.js. Customer names are left
// out unless asked for; with them the zip is encrypted with the backup
// passphrase and refused without one. Built on the card, never in /tmp.
router.get('/records/year-report/:year', require('../services/auth').requireOwner, async (req, res) => {
  const y = parseInt(req.params.year, 10);
  if (!Number.isInteger(y) || y < 2000 || y > new Date().getFullYear()) return res.status(400).json({ error: 'Bad year' });
  const names = req.query.names === '1';
  const vault = require('../services/backupvault');
  if (names && !vault.vaultState().set) return res.status(409).json({ error: 'A report with customer names leaves this unit encrypted, so it needs a backup passphrase first (Settings > Protection > Backups, step 1). Without names it downloads now.', needsPassphrase: true });
  const work = require('../services/backup').workDir('yearreport');
  const drop = () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch {} };
  try {
    const out = await require('../services/yearexport').build(y, { names, workDir: work });
    const file = names ? vault.encryptFile(out.zipPath, out.zipPath.replace(/\.zip$/, '.baenc')) : out.zipPath;
    dbModule.adminLog('YEAR_REPORT', `${y}${out.data.partial ? ' (so far, through ' + out.data.to + ')' : ''} - ${names ? 'with customer names, encrypted' : 'no customer names'}`);
    res.setHeader('Content-Type', names ? 'application/octet-stream' : 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    res.setHeader('Cache-Control', 'no-store');
    const rs = fs.createReadStream(file);
    rs.on('close', drop);
    rs.on('error', () => { drop(); if (!res.headersSent) res.status(500).json({ error: 'Report failed' }); else res.destroy(); });
    rs.pipe(res);
  } catch (e) {
    drop();
    try { dbModule.adminLog('YEAR_REPORT_FAILED', `${y}: ${e.message}`); } catch {}
    if (!res.headersSent) res.status(500).json({ error: 'The report could not be built: ' + e.message });
  }
});
async function streamYearArchive(req, res, y, encrypt) {
  const os = require('os');
  const recSvc = require('../services/records');
  const vault = require('../services/backupvault');
  const cfg = getConfig();
  const bizName = (cfg.server.businessName || 'booking-system').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-records-'));
  const zipPath = path.join(tmp, `records-${y}.zip`);
  try {
    try { dbModule.save(); } catch {}
    await recSvc.buildYearArchive(y, zipPath);
    let file = zipPath, ext = 'zip', type = 'application/zip';
    if (encrypt) { file = vault.encryptFile(zipPath, zipPath + '.baenc'); ext = 'baenc'; type = 'application/octet-stream'; }
    dbModule.adminLog('RECORDS_ARCHIVE', `year ${y} downloaded (${encrypt ? 'encrypted' : 'plain'})`);
    if (!encrypt) vault.notePlainCopy(`the ${y} records archive downloaded unencrypted`);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${bizName}-records-${y}.${ext}"`);
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(file);
    stream.on('close', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
    stream.pipe(res);
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: 'Archive failed' });
  }
}

// ── BACKUP DESTINATIONS (SD/USB nightly): status, settings, run-now ─────────
router.get('/backup/status', (req, res) => {
  try { res.json(require('../services/backup').statusReport()); }
  catch (e) { res.status(500).json({ error: 'Status unavailable' }); }
});
router.post('/backup/settings', require('../services/auth').requireSensitive, (req, res) => {
  const { enabled, destination, hour } = req.body || {};
  if (!['off', 'sd', 'usb', 'both'].includes(destination)) {
    return res.status(400).json({ error: 'Destination must be off, sd, usb, or both' });
  }
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) {
    return res.status(400).json({ error: 'Hour must be 0-23' });
  }
  // A copy on a stick or a card someone can pull out leaves the unit: only ever
  // encrypted, so it cannot be switched on before there is a passphrase (maintainer, Sep 23 2026).
  if (destination !== 'off' && !require('../services/backupvault').vaultState().set) {
    return res.status(400).json({ error: require('../services/backupvault').NEEDS_PASSPHRASE, needsPassphrase: true });
  }
  const csvc = require('../services/config');
  const cfg = csvc.getConfig();
  cfg.backup = Object.assign({}, cfg.backup, { enabled: enabled !== false, destination, hour: h });
  csvc.saveConfig(cfg);
  dbModule.adminLog('BACKUP_SETTINGS', `${destination} @ ${String(h).padStart(2, '0')}:00`);
  res.json({ ok: true, settings: { enabled: enabled !== false, destination, hour: h } });
});
router.post('/backup/run-now', async (req, res) => {
  try {
    const bk = require('../services/backup');
    const kind = (req.body && req.body.dest) || 'local';
    const local = await bk.createBackup();
    dbModule.adminLog('BACKUP_CREATED', require('path').basename(local));
    if (kind === 'local') return res.json({ ok: true, local: require('path').basename(local) });
    const dest = bk.detectDestinations().find(d => d.kind === kind);
    if (!dest) return res.status(404).json({ error: kind.toUpperCase() + ' storage is not connected' });
    const st = bk.copyBackupTo(dest, local);
    if (st.paused) return res.status(409).json({ error: require('../services/backupvault').NEEDS_PASSPHRASE, needsPassphrase: true });
    if (!st.ok) return res.status(500).json({ error: st.error || 'Backup copy failed' });
    res.json({ ok: true, copied: st });
  } catch (e) { res.status(500).json({ error: 'Backup failed' }); }
});

router.get('/backup', require('../services/auth').requireOwner, async (req, res, next) => {
  // THE VAULT: a download is a copy that leaves the unit. With a passphrase set
  // it is served encrypted; a plain zip needs the 2FA step-up (?plain=1).
  const vault = require('../services/backupvault');
  if (vault.vaultState().set && req.query.plain === '1') {
    return require('../services/auth').requireSensitive(req, res, () => streamPlainBackup(req, res));
  }
  if (!vault.vaultState().set) return streamPlainBackup(req, res);
  try {
    const zip = await require('../services/backup').createBackup();
    const enc = vault.offsiteCopyOf(zip);
    const cfg = getConfig();
    const bizName = (cfg.server.businessName || 'booking-system').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const dateStr = new Date().toISOString().slice(0, 10);
    dbModule.adminLog('BACKUP_DOWNLOADED', 'encrypted');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${bizName}-backup-${dateStr}.baenc"`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(enc).pipe(res);
  } catch (e) { res.status(500).json({ error: 'Backup failed' }); }
});
// THE PLAIN DOWNLOAD IS THE SAME BACKUP (maintainer, Sep 23 2026). It used to build its
// own list - the database, the config and the four folders - and so a plain
// download had no VERSION, no staff icon and nothing saying what wrote it. It is
// now createBackup(), the one builder every other backup uses, streamed as-is.
async function streamPlainBackup(req, res) {
  let zip;
  try { zip = await require('../services/backup').createBackup(); }
  catch (e) { try { dbModule.adminLog('BACKUP_FAILED', (e && e.message) || 'backup failed'); } catch {} return res.status(500).json({ error: 'Backup failed' }); }
  const cfg     = getConfig();
  const bizName = (cfg.server.businessName || 'booking-system').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${bizName}-backup-${dateStr}.zip`;
  try {
    const csvc = require('../services/config');
    const c = csvc.getConfig();
    c.backup = Object.assign({}, c.backup, { lastManualDownload: new Date().toISOString() });
    csvc.saveConfig(c);
    dbModule.adminLog('BACKUP_MANUAL_DOWNLOAD', filename);
  } catch {}
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Cache-Control', 'no-store');
  const rs = fs.createReadStream(zip);
  rs.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Backup failed' }); else res.destroy(); });
  rs.on('end', () => { try { dbModule.adminLog('BACKUP_DOWNLOADED', 'plain'); } catch {} require('../services/backupvault').notePlainCopy(`a full backup downloaded unencrypted (${filename})`); });
  rs.pipe(res);
}

// ── RESTORE — upload a backup zip and restore all data ───────────────────────
// Accepts a .zip produced by the backup endpoint. Extracts to a temp dir,
// verifies it looks like a real backup, then restores DB, config, waivers, and
// images in place and reloads the database. Overwrites live data — the UI
// requires an explicit confirmation before calling this.
// NO SIZE CAP, AND NEVER IN /tmp (maintainer, Sep 23 2026). /tmp on a unit is memory,
// and a ten-year facility's backup can outgrow the old 200 MB cap - which would
// have refused the one restore that mattered. The upload, the decrypted copy and
// the unpacked files all live in the work folder beside the backups, on the card,
// and the only limit is the room the unit actually has: asked before a byte is
// received (from the upload's declared length) and again once it is here.
const multerRestore = require('multer');
const restoreUpload = multerRestore({
  storage: multerRestore.diskStorage({
    destination: (req, file, cb) => { try { cb(null, require('../services/backup').workDir('upload')); } catch (e) { cb(e); } },
    filename: (req, file, cb) => cb(null, 'backup-upload')
  }),
  limits: { files: 1 }
});
function restoreRoomFirst(req, res, next) {
  const declared = Number(req.headers['content-length']) || 0;
  const room = require('../services/backup').restoreRoom(declared);
  if (declared && !room.ok) { req.resume(); return res.status(507).json({ error: room.message, noRoom: true }); }
  next();
}

// OWNER ONLY (Sep 23 2026): a restore replaces config.json, and config.json holds
// the owner's password - a manager able to restore a hand-made backup could make
// themselves the owner. The download beside it was already owner-only.
// The SSH-forwarded wizard can restore before an owner account exists.
function restoreGuard(req, res, next) {
  if (!getConfig().setup?.completed) return next();
  return require('../services/auth').requireOwner(req, res, next);
}
router.post('/restore', restoreGuard, restoreRoomFirst, restoreUpload.single('backup'), (req, res) => {
  const { execFile } = require('child_process');
  const appDir = path.join(__dirname, '..');

  if (!req.file) return res.status(400).json({ error: 'No backup file uploaded.' });

  let zipPath = req.file.path;
  const workDir = path.dirname(req.file.path);           // this upload's own folder on the card
  const tmpDir  = path.join(workDir, 'unpacked');

  const cleanup = () => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  };
  const room = require('../services/backup').restoreRoom(req.file.size);
  if (!room.ok) { cleanup(); return res.status(507).json({ error: room.message, noRoom: true }); }

  // Extract with execFile (args array, no shell) into an isolated work dir.
  fs.mkdirSync(tmpDir, { recursive: true });
  // THE VAULT: an encrypted backup needs the passphrase (sent with the upload)
  const vault = require('../services/backupvault');
  if (vault.isEncrypted(zipPath)) {
    const pass = (req.body && req.body.passphrase) || '';
    if (!pass) { cleanup(); return res.status(400).json({ error: 'This backup is encrypted - enter the backup passphrase', needsPassphrase: true }); }
    try { zipPath = vault.decryptFile(zipPath, pass, path.join(workDir, 'decrypted.zip')); }
    catch (e) { cleanup(); return res.status(400).json({ error: e.message, needsPassphrase: true }); }
  }
  execFile('unzip', ['-o', zipPath, '-d', tmpDir], { timeout: 10 * 60000 }, async (err) => {
    if (err) { cleanup(); return res.status(400).json({ error: 'Could not read the backup file (not a valid zip).' }); }

    // Validate: a real backup must contain at least the database or config.
    const hasDb  = fs.existsSync(path.join(tmpDir, 'bookings.db'));
    const hasCfg = fs.existsSync(path.join(tmpDir, 'config.json'));
    if (!hasDb && !hasCfg) {
      cleanup();
      return res.status(400).json({ error: 'This does not look like a valid backup (no database or config found).' });
    }

    try {
      // Restore only the known data files.
      // W23 (Sep 2 2026): a W22 save already on its way would rename the OLD
      // export over the restored file after this copy - reload() only settled
      // AFTER the copy, so the restore was silently lost. Settle first.
      // rule 43 (Oct 8 2026): the unpacked backup is brought to today's layout BEFORE anything is
      // copied onto the unit (services/importers.js); a conversion that fails throws here, before a
      // single file is written, and the catch below reports it
      const converted = require('../services/importers').convert(tmpDir);
      if (hasDb)  await dbModule.settle();
      if (hasDb)  fs.copyFileSync(path.join(tmpDir, 'bookings.db'), path.join(appDir, 'bookings.db'));
      if (hasCfg) fs.copyFileSync(path.join(tmpDir, 'config.json'), path.join(appDir, 'config.json'));

      // Restore directories (waivers + uploads), preserving structure.
      const restoreDir = (rel) => {
        const src = path.join(tmpDir, rel);
        const dest = path.join(appDir, rel);
        if (!fs.existsSync(src)) return;
        // RECURSIVE copy is required: website photos and the hero video live in
        // public/uploads/landing/ (a subdirectory). A flat file loop silently
        // dropped them - the backup carried them, the restore lost them.
        fs.cpSync(src, dest, { recursive: true });
      };
      restoreDir(path.join('waivers', 'uploads'));
      restoreDir(path.join('waivers', 'signed'));
      restoreDir(path.join('public', 'uploads'));
      restoreDir(path.join('public', 'icons'));
      // The staff app's icon rides in every backup (the one builder); put it back.
      const staffIcon = path.join(tmpDir, 'public', 'staff-icon.png');
      if (fs.existsSync(staffIcon)) fs.copyFileSync(staffIcon, path.join(appDir, 'public', 'staff-icon.png'));
      // What the backup says it is (backup.json) - null for one made before backups described themselves.
      const bk = require('../services/backup');
      const manifest = bk.readManifest(tmpDir);

      // Reload the DB so the running app uses the restored data. Config is read
      // fresh from disk on every getConfig() call, so no reload needed for it.
      if (hasDb) await dbModule.reload();
      // the restored facility's zone, now - a restore never ran the wizard's zone step (Oct 3 2026)
      if (hasCfg) { try { require('../services/timezone').ensureConfiguredZone('after a restore', (ev, d) => dbModule.adminLog(ev, d)); } catch (e) {} }
      // W44: a backup from an older unit is migrated now (core + service tables,
      // flushed to disk) - not at the next restart.
      const migrated = hasDb ? require('../services/schema').migrateAfterRestore() : null;
      const defaults = hasCfg ? require('../services/config').defaultsFilled() : [];

      dbModule.adminLog('RESTORE_COMPLETED', `${bk.describeManifest(manifest)} | ${require('../services/importers').line(converted)} | db:${hasDb} config:${hasCfg}` + (migrated ? `; schema ${migrated.tables} tables` : '') + (defaults.length ? `; ${defaults.length} settings at defaults` : ''));
      cleanup();
      req.app.locals.restartAfterSetup(res);
      res.json({ ok: true, restored: { database: hasDb, config: hasCfg }, migrated, defaults, converted,
        setupComplete: require('../services/auth').setupComplete(),
        madeBy: bk.describeManifest(manifest), leftOut: bk.leftOutOf(manifest),
        manifest: manifest ? { writtenBy: manifest.writtenBy, createdAt: manifest.createdAt, unit: manifest.unit } : null });
    } catch (e) {
      cleanup();
      dbModule.adminLog('RESTORE_FAILED', e.message);
      res.status(500).json({ error: 'Restore failed: ' + e.message });
    }
  });
});

// ── HOME ASSISTANT ────────────────────────────────────────────────────────────
const homeassistant = require('../services/homeassistant');

// Test connection — proves URL + token reach HA and can read live state.
// Accepts optional { url, token } in body to test BEFORE saving (used by wizard).
// UniFi Access "Test Connection": accepts optional { host, apiToken } to test
// BEFORE saving. Detects the working transport (documented :12445 Bearer vs
// /proxy/access X-API-KEY), persists it, and returns the console's doors so
// the owner picks from a list instead of hunting for ids.
// Live door + group lists for the pickers in Bays and Members. Read-only.
// Member Access Network: push every active member to the console (users +
// PINs + tier static policies). Owner-triggered from Settings; also safe to
// re-run any time (create-or-update semantics).
const A_UNIFI = require('../services/auth');
router.post('/unifi/sync-members', A_UNIFI.requireOwner, A_UNIFI.requireSensitive, async (req, res) => {
  try {
    const out = await require('../services/unifiaccess').syncAllMembers();
    dbModule.adminLog('UNIFI_SYNC_ALL', `${out.ok} ok, ${out.failed.length} failed`);
    res.json({ ok: true, synced: out.ok, failed: out.failed });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

router.get('/unifi/doors', A_UNIFI.requireOwner, async (req, res) => {
  try { res.json(Object.assign({ ok: true }, await require('../services/unifiaccess').listAccessTargets())); }
  catch (err) { res.json({ ok: false, error: err.message, doors: [], groups: [] }); }
});

router.post('/unifi/test', A_UNIFI.requireOwner, A_UNIFI.requireSensitive, async (req, res) => {
  const { host, apiToken, trustCert } = req.body || {};
  const cfgSvc = require('../services/config');
  const cfg = cfgSvc.getConfig();
  const prior = JSON.parse(JSON.stringify(cfg.unifiAccess || {}));
  // HALF ONE (U10): the admin page fills its token field from the MASKED config,
  // so the field holds '__SECRET_UNCHANGED__:abcd' and Test Connection posted
  // that string AS THE TOKEN. It was then written over the real one and the test
  // failed - which means Test Connection has never once succeeded on a unit whose
  // token was already saved. Every owner past setup has only ever seen "Failed:".
  // The sentinel means "the one you already have", exactly as it does on save.
  const sentinel = String(apiToken || '').startsWith('__SECRET_UNCHANGED__');
  const trialToken = sentinel ? '' : String(apiToken || '');
  // HALF TWO (D4): a host the CALLER names must never be paired with the token we
  // have STORED. Doing so turned this route into "send the facility's door token
  // to any address I name". It is behind the owner's login and 2FA now, so this
  // is defence in depth rather than an open door - but a trial host is only ever
  // tested with a trial token supplied in the same request.
  const trialHost = String(host || '');
  if (trialHost && trialHost !== prior.host && !trialToken) {
    return res.json({ ok: false, error: 'To test a different console address, paste its API token in the same box - this unit will not send the saved token to a new address.' });
  }
  try {
    if (trialHost || trialToken) {
      // trial values: write temporarily so the client reads them, restore on failure
      cfg.unifiAccess = Object.assign({}, cfg.unifiAccess, {
        host: trialHost || prior.host, apiToken: trialToken || prior.apiToken, apiStyle: ''
      });
      cfgSvc.writeConfigRaw(cfg);
    }
    // trustCert: the fingerprint the owner was just SHOWN and accepted (the console's
    // certificate changed) - only a certificate with exactly that fingerprint is trusted
    const out = await require('../services/unifiaccess').testConnection({ trustCert: /^[0-9A-Fa-f:]{64,}$/.test(String(trustCert || '')) ? String(trustCert) : '' });
    dbModule.adminLog('UNIFI_TEST_OK', `style: ${out.style} | doors: ${out.doors.length} | groups: ${(out.groups || []).length}` + (out.cert ? ` | certificate SHA-256 ${out.cert.sha256}` : ''));
    res.json({ ok: true, style: out.style, doors: out.doors, groups: out.groups || [], cert: out.cert || null });
  } catch (err) {
    // Restore the three fields the trial touched - NOT the whole block (U9). This
    // used to assign `prior` wholesale, which also rolled back anything else
    // written into unifiAccess in the meantime: the managed schedule and policy
    // ids, and (once it lands) the console's pinned certificate.
    try {
      const c2 = cfgSvc.getConfig();
      c2.unifiAccess = Object.assign({}, c2.unifiAccess, {
        host: prior.host, apiToken: prior.apiToken, apiStyle: prior.apiStyle
      });
      cfgSvc.writeConfigRaw(c2);
    } catch {}
    dbModule.adminLog('UNIFI_TEST_FAILED', String(err.message).slice(0, 180));
    // the console's certificate changed: say which certificate it is now, so the owner
    // can compare it with the console and accept exactly that one
    const certChanged = err.certChanged || (err.cause && err.cause.certChanged) || null;
    res.json(Object.assign({ ok: false, error: err.message }, certChanged ? { certChanged } : {}));
  }
});

router.post('/homeassistant/test', async (req, res) => {
  const { url, token } = req.body || {};
  if (url || token) {
    // Temporary test with provided creds (not yet saved)
    const { getConfig: gc } = require('../services/config');
    const saved = gc().homeAssistant || {};
    // A MASKED FIELD IS "USE THE SAVED ONE" (Sep 25 2026). The page holds the saved
    // token as '__SECRET_UNCHANGED__:abcd', and that string was sent to Home Assistant
    // as the Bearer token - Test Connection failed on every unit with a token saved.
    // And the SAVED token is only ever sent to the SAVED address: a caller who supplies
    // a new URL supplies the token for it too, so nobody signed in (a manager included)
    // can have this unit hand its token to a server of their choosing.
    const sentinel = String(token || '').startsWith(require('../services/auth').SECRET_SENTINEL);
    const useSaved = !token || sentinel;
    const newUrl = url && String(url).replace(/\/+$/, '') !== String(saved.url || '').replace(/\/+$/, '');
    if (useSaved && newUrl) return res.json({ ok: false, error: 'Enter the access token to test a new address - the saved token is only ever sent to the saved address.' });
    const testCfg = { enabled: true, url: url || saved.url, token: useSaved ? saved.token : token };
    // Inline test using the provided values
    try {
      const base = (testCfg.url || '').replace(/\/+$/, '');
      if (!base) return res.json({ ok: false, error: 'URL required' });
      if (!testCfg.token) return res.json({ ok: false, error: 'Token required' });
      const headers = { Authorization: `Bearer ${testCfg.token}`, 'Content-Type': 'application/json' };
      const ping = await fetch(`${base}/api/`, { headers, signal: AbortSignal.timeout(8000) });
      if (!ping.ok) return res.json({ ok: false, error: `HA returned ${ping.status} — check token` });
      const statesRes = await fetch(`${base}/api/states`, { headers, signal: AbortSignal.timeout(8000) });
      const states = statesRes.ok ? await statesRes.json() : [];
      return res.json({ ok: true, message: 'Connected to Home Assistant', entityCount: Array.isArray(states) ? states.length : 0 });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }
  // Test saved config
  const result = await homeassistant.testConnection();
  res.json(result);
});

// Discover entities grouped by domain (switches, climate, locks, covers, lights)
router.get('/homeassistant/entities', async (req, res) => {
  try {
    const result = await homeassistant.discoverEntities();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually fire an entity on/off from admin (test a device wiring)
router.post('/homeassistant/control', async (req, res) => {
  const { entity_id, on } = req.body || {};
  if (!entity_id) return res.status(400).json({ error: 'entity_id required' });
  const result = await homeassistant.setEntity(entity_id, on !== false);
  res.json(result);
});

// A THERMOSTAT SET NOW (Oct 21 2026 - the device audit: "set the lobby to 68" had no way through; the
// devices card's test only switches on and off). One temperature, for the mode the thermostat is in
// (homeassistant.setClimate): heat or cool takes it; heat/cool holds two degrees either side of it; a thermostat someone
// switched off is left alone and the answer says why. The facility's own times set it again at their next change.
router.post('/homeassistant/climate', async (req, res) => {
  const { entity_id } = req.body || {}, t = Number((req.body || {}).temperature);
  if (!/^climate\.[a-z0-9_]+$/.test(String(entity_id || ''))) return res.status(400).json({ error: 'a thermostat (climate.<name>) is needed' });
  if (!Number.isFinite(t) || t < 40 || t > 95) return res.status(400).json({ error: 'the temperature must be between 40 and 95' });
  const result = await homeassistant.setClimate(entity_id, { heat: t, cool: t, range: [t - 2, t + 2] });
  try { require('../services/devicelog').record({ device: 'ha:' + entity_id, bayId: null, op: 'on', source: 'manual - assistant', ok: !!(result && (result.success || result.skipped)), detail: result && result.skipped ? result.reason : (result && result.error) || '' }); } catch {}
  res.json(result);
});

// Read one entity's current state (verify a command worked)
// ── the Home Assistant lock (feature/door-interface) ────────────────────────
router.post('/hadoor/test', require('../services/auth').requireOwner, async (req, res) => {
  const b = req.body || {};
  const opts = {};
  if (b.entityId) opts.entityId = String(b.entityId);
  for (const k of ['slotFrom', 'slotTo', 'backupSlot']) if (b[k]) opts[k] = Number(b[k]);
  res.json(await require('../services/hadoor').testLock(opts));
});
router.post('/hadoor/backup', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, async (req, res) => {
  const r = await require('../services/hadoor').ensureBackup(true);
  // the code itself never rides back to the browser - the owner sees that it was set
  res.json(r && r.pin ? { ok: true, pin: true, fresh: r.fresh } : { ok: false, error: (r && r.error) || 'could not set the backup code' });
});
router.get('/homeassistant/state', async (req, res) => {
  const { entity_id } = req.query;
  if (!entity_id) return res.status(400).json({ error: 'entity_id required' });
  const result = await homeassistant.getEntityState(entity_id);
  res.json(result);
});

// ── THE SMART-HOME HUB (Oct 19 2026): the box's own Home Assistant set up by the unit, and its devices -
//    what is there, pairing (Z-Wave, Zigbee, Matter), names. services/hasetup.js and services/hadevices.js. Seeing is any
//    signed-in admin's; setting up, pairing and naming are the owner's, as the rest of the devices card is. ──
router.get('/smarthome', async (req, res) => {
  const [hub, devs] = await Promise.all([require('../services/hasetup').status(), require('../services/hadevices').list()]);
  res.json({ hub, devices: devs.devices, connected: devs.connected, reason: devs.reason || undefined, pairing: require('../services/hadevices').status(),
    facility: require('../services/facilitydevices').status() });
});
// what each facility device (the heat and AC, a lounge TV) is doing now and why - services/facilitydevices, Oct 21 2026
router.get('/facility-devices', (req, res) => res.json({ devices: require('../services/facilitydevices').status() }));
router.post('/smarthome/setup', require('../services/auth').requireOwner, async (req, res) => {
  const r = await require('../services/hasetup').setup({ from: 'owner' });
  res.status(r.ok ? 200 : (r.notBuiltIn ? 409 : 503)).json(r);
});
router.post('/smarthome/pair', require('../services/auth').requireOwner, async (req, res) => {
  const b = req.body || {};
  const r = await require('../services/hadevices').start({ protocol: String(b.protocol || ''), code: b.code });
  res.status(r.ok ? 200 : 409).json(r);
});
router.get('/smarthome/pair', (req, res) => res.json(require('../services/hadevices').status()));
router.post('/smarthome/pair/pin', require('../services/auth').requireOwner, async (req, res) => {
  const r = await require('../services/hadevices').pin((req.body || {}).pin);
  res.status(r.ok ? 200 : 409).json(r);
});
router.post('/smarthome/pair/stop', require('../services/auth').requireOwner, async (req, res) => res.json(await require('../services/hadevices').stop()));
router.post('/smarthome/devices/:id/name', require('../services/auth').requireOwner, async (req, res) => {
  const r = await require('../services/hadevices').rename(req.params.id, (req.body || {}).name);
  res.status(r.ok ? 200 : 409).json(r);
});
// the built-in Home Assistant's own sign-in, for an owner who wants its screens: never in the config the browser
// reads (auth REMOVE_PATHS), shown only here, behind the step-up
router.post('/smarthome/login', require('../services/auth').requireOwner, require('../services/auth').requireSensitive, (req, res) => {
  const l = (getConfig().homeAssistant || {}).login;
  if (!l || !l.username) return res.status(404).json({ error: 'this unit did not make a Home Assistant sign-in' });
  res.json({ url: (getConfig().homeAssistant || {}).url || '', username: l.username, password: l.password });
});

// ── SESSION MONITOR BUILDER ───────────────────────────────────────────────
// Builds a ready-to-run, zero-edit monitor package for one bay: the filled
// Python script (QRs + logo embedded), an installer, and a README. Streams
// as a zip named after the bay so multi-bay owners can't mix packages up.
router.get('/bays/:bayId/monitor-package', async (req, res) => {
  try {
    const { buildPackage } = require('../services/monitor-builder');
    const { ZipArchive } = require('archiver');
    const pkg = await buildPackage(req.params.bayId);

    res.setHeader('Content-Disposition', `attachment; filename="session-monitor-${pkg.safeBay}.zip"`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Build failed' }); else res.destroy(); });
    archive.pipe(res);
    for (const f of pkg.files) archive.append(f.content, { name: f.name });
    await archive.finalize();
    dbModule.adminLog('MONITOR_BUILT', `Bay: ${req.params.bayId}`);
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ error: e.message });
  }
});

// ── CLOSE-TIME OVERRIDE ───────────────────────────────────────────────────
// One-night override: skip the close-time hard shutdown for a bay tonight.
// Self-cleaning — the scheduler resets the flag the moment it is honored.
router.post('/close-override/:bayId', (req, res) => {
  const { saveConfig } = require('../services/config');
  const cfg = getConfig();
  const bay = (cfg.bays || []).find(b => b.id === req.params.bayId);
  if (!bay) return res.status(404).json({ error: 'Bay not found' });
  bay.closeOverride = !bay.closeOverride;
  saveConfig(cfg);
  dbModule.adminLog('CLOSE_OVERRIDE', `Bay: ${bay.name} | ${bay.closeOverride ? 'SET (one night)' : 'CLEARED'}`);
  res.json({ ok: true, bayId: bay.id, closeOverride: !!bay.closeOverride });
});

// ── TIMEZONE ──────────────────────────────────────────────────────────────
// GET current timezone (OS + configured), POST detect (from IP), POST set.
router.get('/timezone', (req, res) => {
  const tz = require('../services/timezone');
  const cfg = getConfig();
  res.json({
    osZone: tz.currentOSZone(),
    configured: cfg.server?.timezone || '',
    zones: tz.listZones()
  });
});

router.post('/timezone/detect', async (req, res) => {
  const tz = require('../services/timezone');
  const result = await tz.detectFromIP();
  res.json(result);
});

router.post('/timezone/set', async (req, res) => {
  const tz = require('../services/timezone');
  const { timezone } = req.body || {};
  if (!tz.isValidZone(timezone)) {
    return res.status(400).json({ ok: false, error: 'Invalid or unknown timezone.' });
  }
  const result = await tz.applyTimezone(timezone);
  if (result.ok) {
    // Persist the chosen zone in config so admin can display it.
    try {
      const { saveConfig } = require('../services/config');
      const cfg = getConfig();
      cfg.server = cfg.server || {};
      cfg.server.timezone = timezone;
      saveConfig(cfg);
    } catch (e) { /* non-fatal */ }
  }
  res.json(result);
});

// ── THE ASSISTANT (Oct 19 2026 - services/assistant/) ──────────────────────
// The owner's alone. The engine READS through the owner's own routes with the owner's own session (the cookie this
// request carried, from this box to itself) and never writes: the owner's page applies what it proposes, with the
// owner's own session, so every change passes the same checks as the owner's screens. Off until switched on
// (assistant.enabled) - a unit without it is silent, never a failure (rule 31).
{
  const ownerOnly = require('../services/auth').requireOwner;
  const assistantCtx = async (req) => {
    const port = req.socket.localPort, cookie = req.headers.cookie || '';
    const call = async (method, p) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { cookie }, signal: AbortSignal.timeout(30000) }); let json = null; try { json = await r.json(); } catch {} return { status: r.status, json }; };
    let today; try { today = require('../services/revenue').facilityToday(); } catch { today = new Date().toISOString().slice(0, 10); }
    const ctx = { call, today, weekday: new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), time: new Date().toTimeString().slice(0, 5), businessName: (getConfig().server || {}).businessName || '' };
    try { const r = await call('GET', '/api/admin/setup-status'); ctx.setup = (r.json && r.json.items) || []; } catch { ctx.setup = []; }
    // WHAT IS WAITING FOR THE OWNER (maintainer: "the a I just needs to prompt the owner"): the health line's warnings, staff
    // requests waiting for a decision, an update ready to install - so the assistant can say so first
    ctx.waiting = [];
    try { const r = await call('GET', '/api/admin/health'); for (const sg of ((r.json && r.json.signals) || []).filter(x => x.level && x.level !== 'green')) ctx.waiting.push(`${sg.label || sg.key}${sg.level === 'red' ? ' (needs attention now)' : ''}${sg.action ? ' - ' + sg.action : ''}`); } catch {}
    try { if ((getConfig().scheduling || {}).enabled) { const r = await call('GET', `/api/staff/schedule?start=${today}&end=${today}`); const n = ((r.json && r.json.pendingReq) || []).length + ((r.json && r.json.pendingTimeoff) || []).length; if (n) ctx.waiting.push(`${n} staff request${n === 1 ? '' : 's'} waiting for a yes or no`); } } catch {}
    return ctx;
  };
  router.get('/assistant/status', ownerOnly, async (req, res) => {
    // no speech-to-text runs on this unit, so the page shows no microphone (voice: false)
    res.json({ model: await require('../services/assistant/model').status(), keyPatterns: require('../services/assistant/secrets').patternsForClient(), guide: require('../services/assistant/knowledge').stats(),
      voice: false });
  });
  router.get('/assistant/actions', ownerOnly, (req, res) => res.json(require('../services/assistant/actions').publicCatalog()));
  // A TURN THAT TAKES A WHILE (Oct 21 2026, latest - maintainer: "keep in mind the tunnel and cloudflare"). Cloudflare
  // answers 524 to a request whose answer has not started within 100 seconds, and a small model working through a few steps
  // can take that long: the owner on their phone, over the tunnel, would see an error while the box carried on. So a turn -
  // or the words after a change - still working after TURN_WAIT_MS answers 202 { pending } and the page asks
  // GET /assistant/pending/:id until it is done; the work goes on either way, and a fast turn answers exactly as before.
  // One at a time per conversation: a second message while one works is told to wait (and never runs the model twice).
  const TURN_WAIT_MS = () => Number(process.env.BA_TEST_TURN_WAIT_MS) || 25000;
  const turnJobs = new Map();   // id -> { id, conv, at, done, status, out }
  const answerOrWait = async (res, conversation, work, statusOf) => {
    const old = Date.now() - 20 * 60000;
    for (const [k, j] of turnJobs) if (j.at < old) turnJobs.delete(k);
    if (conversation && [...turnJobs.values()].some(j => j.conv === conversation && !j.done)) return res.status(409).json({ error: 'Still working on your last message - one moment.', busy: true });
    // the box's AI answers a few at a time: more at once (a stuck page, a script on a stolen sign-in over the tunnel) waits its
    // turn instead of crowding out the owner's own
    if ([...turnJobs.values()].filter(j => !j.done).length >= 3) return res.status(429).json({ error: 'The assistant is answering other messages - try again in a moment.', busy: true });
    const id = require('crypto').randomBytes(12).toString('base64url');
    const job = { id, conv: conversation || null, at: Date.now(), done: false, status: 200, out: null };
    turnJobs.set(id, job);
    const finished = work().then(out => { job.out = out; job.status = statusOf(out); },
      e => { job.out = { error: 'The assistant stopped: ' + String((e && e.message) || e).slice(0, 200) }; job.status = 500; }).then(() => { job.done = true; });
    const first = await Promise.race([finished.then(() => 'done'), new Promise(r => setTimeout(() => r('wait'), TURN_WAIT_MS()))]);
    if (first === 'done') { turnJobs.delete(id); return res.status(job.status).json(job.out); }
    res.status(202).json({ pending: id });
  };
  router.get('/assistant/pending/:id', ownerOnly, (req, res) => {
    const j = turnJobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: 'That answer is no longer here - ask again.' });
    if (!j.done) return res.status(202).json({ pending: j.id });
    turnJobs.delete(j.id);
    res.status(j.status).json(j.out);
  });
  router.post('/assistant/turn', ownerOnly, async (req, res) => {
    const b = req.body || {};
    if (typeof b.text !== 'string' || !b.text.trim()) return res.status(400).json({ error: 'Say something first' });
    if (!require('../services/assistant/model').settings().enabled) return res.status(409).json({ error: 'The assistant is switched off for this unit.' });
    const ctx = await assistantCtx(req);
    return answerOrWait(res, b.conversation, () => require('../services/assistant/engine').turn({ conversation: b.conversation, text: b.text, keysSaved: b.keysSaved, ctx }),
      (out) => (out.error ? (out.unreachable ? 503 : 502) : 200));
  });
  router.post('/assistant/applied', ownerOnly, async (req, res) => {
    const b = req.body || {};
    const ctx = await assistantCtx(req);
    return answerOrWait(res, b.conversation, () => require('../services/assistant/engine').applied({ conversation: b.conversation, results: b.results, ctx }),
      (out) => (out.error ? (out.unreachable ? 503 : 409) : 200));
  });
}

// routines taught on a bay PC (Oct 21 2026): routes/routines.js
const ROUTINES = require('./routines').admin;
router.get('/routines', ...ROUTINES['GET /routines']);
router.post('/routines/teach', ...ROUTINES['POST /routines/teach']);
router.delete('/routines/teach', ...ROUTINES['DELETE /routines/teach']);
router.post('/routines/save', ...ROUTINES['POST /routines/save']);
router.post('/routines', ...ROUTINES['POST /routines']);
router.put('/routines/:id', ...ROUTINES['PUT /routines/:id']);
router.post('/routines/:id/steps', ...ROUTINES['POST /routines/:id/steps']);
router.post('/routines/:id/copy', ...ROUTINES['POST /routines/:id/copy']);
router.post('/routines/:id/run', ...ROUTINES['POST /routines/:id/run']);
router.delete('/routines/:id', ...ROUTINES['DELETE /routines/:id']);

// getting the box online - "Connect my box" and the domain check (Oct 21 2026): routes/getonline.js
const GETONLINE = require('./getonline').admin;
router.get('/getonline', ...GETONLINE['GET /getonline']);
router.get('/getonline/domain', ...GETONLINE['GET /getonline/domain']);
router.post('/getonline/connect', ...GETONLINE['POST /getonline/connect']);
router.delete('/getonline/connect', ...GETONLINE['DELETE /getonline/connect']);
router.post('/getonline/check', ...GETONLINE['POST /getonline/check']);

module.exports = router;
