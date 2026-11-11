// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  server.js  —  Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

const express   = require('express');
const path      = require('path');
const rateLimit = require('express-rate-limit');

// Cloudflared connects from loopback; trust ONLY that hop, never arbitrary
// X-Forwarded-For from the open internet.
// Rate limits are keyed on the real client (cf-connecting-ip when tunnelled,
// socket address on the LAN) so one attacker cannot lock out everyone else.
const realClientKey = (req) => {
  try { return require('./services/auth').getClientIp(req); }
  catch { return (req.socket && req.socket.remoteAddress) || 'unknown'; }
};

// ── RATE LIMITERS ─────────────────────────────────────────────────────────────

// General API limit — 500 requests per 15 min per IP
const generalLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  // the verified OWNER is not anonymous abuse - their admin screens poll, and
  // the bench load test drives every surface from one machine with this key
  skip: (req) => {
    // the bay PCs' session poll has its own bucket (sessionStatusLimiter): a watcher built
    // before Sep 25 2026 polls through the public domain, and must never spend - or be
    // refused by - the budget every guest phone on the facility's Wi-Fi shares
    if (req.method === 'GET' && String(req.originalUrl || '').split('?')[0] === '/api/session/status') return true;
    if (String(req.originalUrl || '').split('?')[0].startsWith('/api/session/routines')) return true;   // the same watchers' routines poll
    try { return require('./services/auth').verifyAdminRequest(req); } catch { return false; }
  },
  message: { error: 'Too many requests, please try again later.' }
});
// The bay PCs' poll: every bay every 30 s is 30 per 15 minutes per bay, all behind the
// facility's one public address when a watcher was built with the domain. Its own
// bucket, sized for a large facility and still a bound on a stranger (Sep 25 2026).
const sessionStatusLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 15 * 60 * 1000,
  max: 1800,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Booking limit — 10 bookings per hour per IP (prevents spam)
const bookingLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 60 * 60 * 1000,
  max: 10,
  // the OWNER exercising their own booking page (or the bench seeder with the
  // owner's password) is not a spammer - a verified owner request skips it
  skip: (req) => { try { return require('./services/auth').verifyAdminRequest(req); } catch { return false; } },
  message: { error: 'Too many booking attempts. Please try again in an hour.' }
});

// Admin limit — 20 attempts per 15 min per IP, skip successful requests
const adminLimiter = rateLimit({
  // W39 (Sep 9 2026): a request that presented NO credential - no password header,
  // no cookie - is not a guess and must not spend the owner's budget. Twenty bare
  // page loads used to block an IP from /api/admin for 15 minutes; brute force
  // needs a credential, and every request carrying one still counts.
  skip: (req) => {
    const presented = !!req.headers['x-admin-password'] || !!(req.headers.cookie && req.headers.cookie.length);
    if (!presented) return true;
    try { return require('./services/auth').verifyAdminRequest(req); } catch { return false; }
  },
  keyGenerator: realClientKey,
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true, // only count failed attempts
  message: { error: 'Too many admin attempts. Try again in 15 minutes.' }
});

// PIN request limit — 5 per hour per IP (prevents SMS spam)
const pinLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many PIN requests. Please try again in an hour.' }
});
// Customer code check + self-cancel (Sep 6 2026): the six-digit code lives ten
// minutes and the route destroys it after five wrong tries; this caps how many
// guesses one address can even make.
const customerVerifyLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many attempts. Please request a new code in a few minutes.' }
});

// Discount code limit — 20 per hour per IP
const pricingLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many pricing requests.' }
});

const discountLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many discount code attempts.' }
});

// Membership PIN validation — 30 per hour per IP (generous for testing)
// A REPORT IS NOT AN ACTION (maintainer, Sep 20 2026). The payment-library report takes
// no credential by design - a customer whose browser failed must still be able
// to tell the unit - so it needs its own tight ceiling rather than the general
// 500-per-15-minutes. A real browser reports once; six an hour is generous.
const reportLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: { error: 'Too many reports from this device. Please try again later.', recorded: false }
});

// A GUESS LIMITER, NOT A PRESENCE LIMITER (maintainer, Sep 20 2026).
// This was 30 an hour PER IP counting every request, and at a private club
// everybody books from the building's wi-fi - so thirty legitimate members
// sharing one address locked each other out on an ordinary evening. That is a
// real failure at exactly the kind of facility we sell to.
//
// maintainer's instruction was "per member, not per IP". Keyed literally on the PIN
// that would be WORSE than doing nothing: every guessed code is a different
// key, so an attacker gets a fresh 30-an-hour budget for each of ten thousand
// guesses and the brute-force protection disappears. So the key stays the
// address and the COUNTING changes - the same shape adminLimiter has used
// since W39. A member whose code is right is never counted, so a club on one
// wi-fi can never run itself out; a request with no code at all is not a guess;
// only a WRONG code spends the budget, and it spends it exactly as before.
const memberPinLimiter = rateLimit({
  keyGenerator: realClientKey,
  windowMs: 60 * 60 * 1000,
  max: 30,
  skip: (req) => {
    // no code presented is not a guess (W39's rule, applied here)
    // A PIN can arrive in the QUERY as well as the body: /api/waivers/needed
    // takes ?pin= and answers differently for a real one, which made it a
    // member-PIN oracle on a route this limiter never covered (maintainer, Sep 21 2026).
    const b = req.body || {}, q = req.query || {};
    const presented = !!(b.pin || b.code || b.member_pin || q.pin);
    if (!presented) return true;
    // the OWNER exercising their own booking page is not brute-forcing their
    // own members' PINs - the same door bookingLimiter and adminLimiter have
    try { return require('./services/auth').verifyAdminRequest(req); } catch { return false; }
  },
  skipSuccessfulRequests: true,
  // The route answers 200 with valid:false for a wrong code, so "successful"
  // cannot be the status - the route says so itself on res.locals.
  requestWasSuccessful: (req, res) => !!(res.locals && res.locals.pinOk),
  message: { error: 'Too many membership PIN attempts. Please try again later.' }
});

const reach              = require('./services/reach');
const { getConfig }      = require('./services/config');
const { initDb }         = require('./services/db');
const { startScheduler } = require('./services/scheduler');
// (simulator status is served via /api/session/status below)

const app = express();
// ── A HANDLER THAT REJECTS STILL ANSWERS (Sep 25 2026, the pilot facility handoff section 5) ──
// Express 4 does not catch a rejected async handler: the rejection went to the
// process's unhandledRejection logger and the request got NO reply at all - a
// customer's PIN request, their cancel and the booking page's create each hung
// for good on a phone number sent as a number. Every layer's handler is guarded
// here, once, for every router: a thrown error or a rejected promise goes to
// next(err), and the one error handler at the end of the chain answers in JSON.
// Nothing about a handler that succeeds changes - not a status, not a field.
// (declared at module level, never inside a block - test-scope, pilot facility lesson #5)
function guardedHandle(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next();          // an error handler: only ever called with an error
  let r;
  try { r = fn(req, res, next); } catch (err) { return next(err); }
  if (r && typeof r.then === 'function') r.then(null, err => next(err || new Error('handler rejected')));
}
const ExpressLayer = require('express/lib/router/layer');
if (!ExpressLayer.prototype.__baGuarded) {
  ExpressLayer.prototype.handle_request = guardedHandle;
  ExpressLayer.prototype.__baGuarded = true;
}
// Trust the tunnel on this unit (cloudflared connects from loopback) and nothing else. A second line set it to 1
// (any one hop) and won: a device on the facility's LAN could then write any address into X-Forwarded-For and have
// it recorded as the customer's (waiver, consent and ledger records read req.ip). The limiters and the lockout never
// read req.ip (auth.getClientIp / realClientKey). One setting, here (Oct 19 2026, the pack review).
app.set('trust proxy', 'loopback');

app.locals.restartAfterSetup = (res) => {
  if (!app.locals.setupLoopbackOnly || !require('./services/auth').setupComplete() || process.env.BA_CORE_COMMUNITY !== '1') return;
  res.once('finish', () => process.kill(process.pid, 'SIGTERM'));
};

// First boot is reached through an SSH forward. Check the authority as well
// as the socket so a browser cannot reach setup through a rebound hostname.
app.use((req, res, next) => {
  if (require('./services/auth').setupComplete()) return next();
  const host = req.headers.host || '';
  const tunnelled = req.headers['cf-connecting-ip'] || req.headers['cf-ray'];
  const loopback = req.socket.remoteAddress === '127.0.0.1';
  if (!loopback || tunnelled || !/^127\.0\.0\.1(?::[0-9]+)?$/.test(host)) {
    return res.status(403).send('Complete setup through the private SSH connection.');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== 'http://' + host) {
    return res.status(403).json({ error: 'Open the setup wizard in your forwarded browser session.' });
  }
  next();
});
// Resilience: an unmanned device should log async failures, not die from them.
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err?.message || err);
});

// CORS deliberately NOT enabled: every page, the booking app, admin and the
// staff surface are served from this same origin, so cross-origin access has
// no legitimate use here - and an open policy let any website read responses
// from a facility's system. (Security tail, Aug 11.)
// Stripe webhook MUST see the raw body for signature verification — mounted
// BEFORE the JSON parser. Membership billing renewals/failures arrive here.
// Stripe webhook MUST see the raw body for signature verification — mounted
// BEFORE the JSON parser. Membership billing renewals/failures arrive here.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '512kb' }), async (req, res) => {
  try {
    const { getConfig } = require('./services/config');
    const billing = require('./services/membership-billing');
    const secret = getConfig().stripe?.webhookSecret || '';
    const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    if (!billing.verifyWebhookSignature(raw, req.headers['stripe-signature'], secret)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = JSON.parse(raw);
    await require('./services/membership-lifecycle').applyEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('webhook:', err.message);
    res.status(400).json({ error: 'Webhook error' });
  }
});

app.use(express.json({ limit: '10kb' })); // Limit body size to prevent large payload attacks

const { hasPrototypeKeys, stripPrototypeKeys } = require('./services/object-keys');
app.use((req, res, next) => {
  if (hasPrototypeKeys(req.body) || hasPrototypeKeys(req.query)) {
    return res.status(400).json({ error: 'Unsupported object key in request.' });
  }
  next();
});

// Migrate any plaintext owner password from a legacy backup to a scrypt verifier.
require('./services/auth').ensurePasswordHashed();
require('./services/config').scrubLegacySettings();
// Parse cookies for session auth (tiny, dependency-free).
app.use((req, _res, next) => { req._authReady = true; next(); });

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // The editor's live preview embeds /landing?preview=1 in an iframe on the
  // SAME origin (wave C, Sep 5 2026). (Oct 20 2026): the assistant's
  // live view shows the screen a change lives on - an admin card, the booking page,
  // a page of the owner's own - asked with ?frame=1, on the SAME origin only (a
  // page of anyone else's still cannot frame it). Everything else stays unframeable.
  const framable = !!req.query && ((req.path === '/landing' && req.query.preview === '1') || req.query.frame === '1');
  res.setHeader('X-Frame-Options', framable ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(self)');
  // CSP: 'unsafe-inline' is required because the pages are self-contained
  // (inline <script>/<style> by design - no build step on a Pi). It still
  // blocks the attacks that matter here: loading script from an attacker's
  // domain, embedding plugins, hijacking <base>, and posting forms offsite.
  let _an = { ga4: '', pixel: '' }; try { _an = analyticsIds(); } catch {}
  const _scriptExtra = (_an.ga4 ? ' https://www.googletagmanager.com' : '') + (_an.pixel ? ' https://connect.facebook.net' : '');
  const _connectExtra = (_an.ga4 ? ' https://www.google-analytics.com https://analytics.google.com https://*.google-analytics.com https://www.googletagmanager.com' : '') + (_an.pixel ? ' https://www.facebook.com' : '');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // STRIPE'S OWN LIST (docs.stripe.com/security/guide, "Content Security Policy" -
    // Stripe.js and Link, read Sep 25 2026 for the pilot facility handoff section 5): script-src
    // https://*.js.stripe.com https://js.stripe.com; frame-src the same plus
    // https://hooks.stripe.com (the frame a card that needs 3-D Secure or a redirect
    // method opens) and Link's https://link.com https://*.link.com; connect-src
    // https://api.stripe.com plus Link's. We had js.stripe.com alone in script and
    // frame, and neither the 3-D Secure frame host nor Link's.
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com" + _scriptExtra,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    // js.stripe.com / fonts.* added Sep 20 2026: defence in depth. The real fix
    // is that the service worker no longer fetches these (it let them through to
    // the browser), but a future in-page fetch of the payment library or a font
    // must not be silently strangled by connect-src the way the SW's was.
    "connect-src 'self' https://api.stripe.com https://js.stripe.com https://link.com https://*.link.com https://fonts.googleapis.com https://fonts.gstatic.com" + _connectExtra,
    "worker-src 'self' blob:",          // W45: the vendored pdf.js worker on a PDF page
    "frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://link.com https://*.link.com https://www.google.com https://maps.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    framable ? "frame-ancestors 'self'" : "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // Hide server info
  res.removeHeader('X-Powered-By');
  next();
});

// Hide Express signature
app.disable('x-powered-by');

// ── ROUTES ────────────────────────────────────────────────────────────────────
// ── SETUP MIDDLEWARE — redirect to coming soon if not set up ─────────────────
app.use((req, res, next) => {
  const cfg = require('./services/config').getConfig();
  if (cfg.setup?.completed) return next();

  // Always allow: setup wizard, setup API, contact API, SEO API, icons, manifest, sw.js
  // PLUG-ANYWHERE SECURITY: the wizard must never be reachable from the public
  // internet. Tunnel traffic arrives via cloudflared on localhost but carries
  // Cloudflare's headers - LAN requests never do. Header present = internet =
  // coming-soon, even for /setup. maintainer/the owner runs setup on the LAN
  // (hostname.local:3001), which sails through untouched.
  const viaTunnel = !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
  const allowed = ['/setup', '/api/setup', '/api/auth', '/api/uploads', '/api/website', '/api/contact', '/api/seo', '/api/theme', '/api/time', '/api/admin/homeassistant/test', '/api/admin/timezone', '/api/admin/restore'];
  if (!viaTunnel && allowed.some(p => req.path.startsWith(p))) return next();
  if (viaTunnel && ['/api/contact', '/api/seo', '/api/theme', '/api/time'].some(p => req.path.startsWith(p))) return next();
  if (req.path.match(/\.(png|ico|json|woff|woff2|svg|webp)$/)) return next();
  if (req.path === '/sw.js' || req.path === '/robots.txt' || req.path === '/sitemap.xml') return next();
  // Compliance pages must be reachable before launch (Twilio reviewers check these)
  if (req.path === '/privacy' || req.path === '/sms-terms') return next();

  // API calls get 503
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'System not yet configured' });
  }

  // ALL page requests get coming soon
  return res.sendFile(require('path').join(__dirname, 'public', 'coming-soon.html'));
});

// ── SETUP IS OVER WHEN IT IS OVER (maintainer, Sep 21 2026) ──────────────────────────
// The wizard runs ONCE, on the facility's own network, before the unit is in
// service. Two things were wrong at once. `/api/setup/complete` guarded itself
// with an && chain whose middle term (`!auth.setupComplete()`) goes FALSE the
// moment setup finishes - so the guard stopped guarding at exactly the point it
// began to matter - and nothing anywhere refused tunnel traffic to it, so a
// shipped unit answered the open internet: an anonymous POST rewrote config.json
// and set the owner password. Its two siblings (check-usb, restore) had the
// plain `if (completed) 403` and were fine; this brings all three under one
// rule instead of three hand-written ones.
//
// THIS IS A GATE, NOT A What's-Public SURFACE, and that was a deliberate choice.
// `sitenav.SURFACES` is the OWNER'S map of what a visitor may see (rule 20);
// setup is never something an owner publishes, so an entry there would make the
// wizard's security depend on a website switch. publicGate also waves through
// any signed-in owner or staff token - correct for a hidden page, wrong for
// "setup is finished". A gate says it once, for every /api/setup/* route that
// exists today or is added later, and logs the refusal with the caller's IP.
// One row per caller per hour, not one per request: a scanner walking
// /api/setup/* would otherwise write a line every time and bury the real
// events in a log the owner keeps for twelve months (pilot facility's 6,141-row lesson,
// and the same shape as the payment-library reporter's throttle).
const _setupRefusals = new Map();   // ip -> last logged ms
function _noteSetupRefusal(ip, detail) {
  const now = Date.now(), last = _setupRefusals.get(ip) || 0;
  if (now - last < 60 * 60 * 1000) return;
  _setupRefusals.set(ip, now);
  if (_setupRefusals.size > 500) { for (const [k, v] of _setupRefusals) if (now - v > 60 * 60 * 1000) _setupRefusals.delete(k); }
  try { require('./services/db').adminLog('SETUP_REFUSED', detail); } catch {}
}
app.use('/api/setup', (req, res, next) => {
  const auth = require('./services/auth');
  const ip = auth.getClientIp(req);
  // cloudflared connects from loopback and stamps these; a LAN visitor cannot
  // be mistaken for one, and a tunnel visitor cannot hide (the header is only
  // believed on the loopback hop - getClientIp's rule).
  const viaTunnel = !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
  const refuse = (why) => {
    _noteSetupRefusal(ip, `${why} | ${req.method} ${req.path} | IP: ${ip}`);
    return res.status(403).json({ error: 'Setup is not available on this unit.' });
  };
  if (viaTunnel) return refuse('reached over the tunnel');
  let done = false;
  try { done = !!require('./services/config').getConfig().setup?.completed; } catch { done = true; }  // unreadable config: refuse, never open
  if (done) return refuse('setup is already complete');
  next();
});

// ── HOMEPAGE FLIP ────────────────────────────────────────────────────────────
// The owner chooses (Admin → Website → Homepage) whether the marketing landing
// page or the booking app answers at /. The booking app is ALWAYS at /book, so
// every QR code and link keeps working in both modes. Registered BEFORE the
// static middleware so it can intercept /; falls through to the booking app.
// THE WEBSITE SWITCH (maintainer, Sep 5 2026: "some facilities won't need a full
// website, so they gotta be able to turn it off"). website_content.settings
// .siteEnabled === false means: no landing page (/landing and /events send
// visitors to /book), the booking app is the homepage whatever the flip says,
// and the public pages draw a plain header (name + Book) instead of the
// marketing menu. Custom pages (/p/terms) stay reachable - a facility with no
// website still has terms. Default: on.
function siteSettings() {
  // one tiny row, read on every templated page and CSP header - NOT cached: a
  // save must show on the very next request (a two-second cache hid the flip
  // and the switch from the battery, and would from an owner clicking Save
  // then Reload).
  try {
    const row = require('./services/db').db.prepare(`SELECT value FROM website_content WHERE key = 'settings'`).get();
    const settings = row ? JSON.parse(row.value) : {};
    stripPrototypeKeys(settings);
    return settings || {};
  } catch { return {}; }
}
// ANALYTICS (wave D, Sep 5 2026): off unless the owner typed an id. A GA4
// measurement id or a Meta pixel id adds exactly the hosts it needs to the
// page's security policy and a gtag/fbq snippet to the public pages - nothing
// else changes, and the Privacy page says so while it is on.
function analyticsIds() {
  const a = (siteSettings().analytics) || {};
  const ga4 = /^G-[A-Z0-9]{4,16}$/.test(String(a.ga4 || '').trim()) ? String(a.ga4).trim() : '';
  const pixel = /^\d{8,20}$/.test(String(a.metaPixel || '').trim()) ? String(a.metaPixel).trim() : '';
  return { ga4, pixel };
}
function siteOn() { return siteSettings().siteEnabled !== false; }
// ── WHAT'S PUBLIC (W44, Sep 10 2026) ─────────────────────────────────────────
// The owner controls what is public per surface from the Website editor
// (services/sitenav SURFACES). Off means the ROUTE and its API answer the
// holding page (a custom page: 404; leagues off: 404) - typing /book gets the
// holding page, not the grid. A signed-in owner or a staff token keeps
// working: the pad still books, the admin still reads. Every menu item, hero
// button, footer link and sitemap entry reads the same map and hides itself.
function publicGate(req, res, next) {
  const sn = require('./services/sitenav');
  const surface = sn.surfaceFor(req.path);
  if (!surface) return next();
  let map; try { map = sn.publicMap(siteSettings()); } catch { return next(); }
  if (sn.isPublic(map, surface)) return next();
  try { if (require('./services/auth').verifyAdminRequest(req)) return next(); } catch {}
  try { const t = req.headers['x-staff-token']; if (t && require('./services/staff').validate(t)) return next(); } catch {}
  res.set('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not yet public' });
  if (surface.startsWith('page:') || surface === 'leagues' || surface === 'updates') return res.status(404).send('Page not found');
  return serveTemplated('not-yet.html')(req, res);
}
app.use(publicGate);
// ── REACH: WHO MAY KNOCK (maintainer, Sep 21 2026) ───────────────────────────────────
// Declared per mount in services/reach.js, longest prefix wins, and a path no
// declaration covers is REFUSED. This is reach only - every route keeps the
// auth guard it already had behind it. Pages and static files are not gated
// here; the two that need it (/setup, /staff) gate themselves in their own
// handlers, and test-reach asserts that stays true.
app.use(reach.gate);
// W45: email updates - the signup page (gated above while the card is off) and
// the unsubscribe link, which always works: a token from an old email, no sign-in.
app.get('/updates', (req, res) => serveTemplated('updates.html')(req, res));
app.get('/updates/unsubscribe', (req, res) => {
  const row = require('./services/subscribers').unsubscribe(req.query.t);
  const cfg = require('./services/config').getConfig();
  const biz = String(cfg.server?.businessName || '').replace(/[<>"&]/g, '');
  const body = row
    ? `<h1>You are unsubscribed</h1><p>${biz} will not email ${String(row.email).replace(/[<>"&]/g, '')} again. Changed your mind? Sign up again any time.</p>`
    : `<h1>That link is not valid</h1><p>It may have been used already, or copied incompletely. Nothing has changed.</p>`;
  res.status(row ? 200 : 404).set('Cache-Control', 'no-store').type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>Email updates — ${biz}</title><link rel="stylesheet" href="/site.css"><script src="/site-chrome.js" defer></script></head><body><header class="siteHead" id="siteHead" data-name="${biz}"></header><main class="siteMain" id="main-content" style="max-width:640px;margin:0 auto;padding:60px 20px">${body}<p><a href="/">&lsaquo; Back to the home page</a></p></main><footer class="siteFoot" id="siteFoot" data-name="${biz}"></footer></body></html>`);
});
// Leagues: no product page exists - when the owner makes it public it is the
// holding page under its own address (and a menu item); off, the gate 404s it.
app.get('/leagues', (req, res) => serveTemplated('not-yet.html')(req, res));
app.get('/', (req, res, next) => {
  try {
    const st = siteSettings();
    if (st.homepage === 'landing' && st.siteEnabled !== false) {
      return serveTemplated('landing.html')(req, res);
    }
    // W44: the booking app is the homepage but booking is not public yet - the
    // landing page stands in while the site is on; otherwise the holding page.
    if (!require('./services/sitenav').publicMap(st).booking && !require('./services/auth').verifyAdminRequest(req)) {
      return serveTemplated(st.siteEnabled !== false ? 'landing.html' : 'not-yet.html')(req, res);
    }
  } catch { /* db not ready or no settings row — booking stays the homepage */ }
  // Booking app as homepage: serve it TEMPLATED. Falling through to the static
  // middleware would ship the raw file with unfilled {{TOKEN}}s in the head.
  return serveTemplated('index.html')(req, res);
});

// Direct hits on the raw file go to the templated route for the same reason.
app.get('/index.html', (req, res) => res.redirect(301, '/'));

// SITEMAP + ROBOTS (Sep 5 2026): built from the same navigation model the
// pages render, with ABSOLUTE addresses (the old static file listed "/", which
// crawlers reject). Registered before the static middleware on purpose.
function siteUrl(req) {
  const cfg = require('./services/config').getConfig();
  return (cfg.seo?.domain || '').trim().replace(/\/+$/, '') || (req.protocol + '://' + req.get('host'));
}
app.get('/sitemap.xml', (req, res) => {
  try {
    const base = siteUrl(req);
    const st = siteSettings();
    const on = st.siteEnabled !== false;
    const urls = [{ loc: '/', pri: '1.0' }, { loc: '/book', pri: '0.9' }];
    if (on && st.homepage !== 'landing') urls.push({ loc: '/landing', pri: '0.9' });
    let nav = { items: [] };
    try { nav = require('./services/sitenav').resolve(require('./routes/website').buildPublic(false).content); } catch {}
    const sn = require('./services/sitenav'); const pub = sn.publicMap(st);
    if (!pub.booking) { const i = urls.findIndex(u => u.loc === '/book'); if (i >= 0) urls.splice(i, 1); }   // W44: not yet public - not in the sitemap
    for (const it of nav.items) { if (it.builtin && !on && it.key === 'events') continue; if (it.external || !sn.hrefPublic(pub, it.href)) continue; urls.push({ loc: it.href, pri: it.builtin ? '0.8' : '0.6' }); }
    for (const l of ['/how-it-works', '/gift-cards', '/memberships']) if (!urls.some(u => u.loc === l) && sn.hrefPublic(pub, l) && (l !== '/memberships' || require('./services/sitenav').sellableTiers())) urls.push({ loc: l, pri: '0.7' });
    urls.push({ loc: '/privacy', pri: '0.3' }, { loc: '/sms-terms', pri: '0.3' });
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    res.type('application/xml').set('Cache-Control', 'no-cache').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u => `  <url><loc>${esc(base + u.loc)}</loc><priority>${u.pri}</priority></url>`).join('\n') + '\n</urlset>\n');
  } catch { res.status(500).type('text/plain').send('sitemap unavailable'); }
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'no-cache').send(['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /admin-website', 'Disallow: /staff', 'Disallow: /me', 'Disallow: /kiosk', 'Disallow: /setup', 'Disallow: /api/', `Sitemap: ${siteUrl(req)}/sitemap.xml`, ''].join('\n'));
});

// ── CUSTOM PAGES (Example Owner's wizard questions, Aug 19) ─────────────────────────
// Owner-built pages (Terms, house rules, league info...) stored in
// website_content under 'pages': [{ slug, title, body, published, showInNav,
// showInFooter }]. Served at /p/<slug>. DRAFTS (published:false) return 404
// to the public but render for a signed-in admin - build ahead, publish when
// ready. Body is the safe mini-markup, server-rendered: escaped first, so
// owner text can never inject script.
app.get('/p/:slug', (req, res) => {
  try {
    const dbm = require('./services/db');
    const row = dbm.db.prepare(`SELECT value FROM website_content WHERE key = 'pages'`).get();
    const pages = row ? JSON.parse(row.value) : [];
    const slug = String(req.params.slug || '').toLowerCase();
    const page = (Array.isArray(pages) ? pages : []).find(pg => pg && String(pg.slug || '').toLowerCase() === slug);
    const isAdmin = require('./services/auth').verifyAdminRequest(req);
    if (!page || (!page.published && !isAdmin)) return res.status(404).send('Page not found');
    const { markupToHtml, esc } = require('./services/markup');
    const cfg = require('./services/config').getConfig();
    // A PAGE MADE OF SECTIONS (Oct 20 2026, late; maintainer: "pages not pages ... so people can really make it feel
    // like there own site"): drawn by the homepage itself - the same renderer, the same look - told which page it is
    // (window.BA_PAGE), with the page's own title and search words. A draft is drawn for a signed-in owner only (above).
    if (require('./public/site-layout.js').isSectionsPage(page)) {
      const name = cfg.server?.businessName || cfg.businessName || '';
      let html = fillTokens(require('fs').readFileSync(path.join(__dirname, 'public', 'landing.html'), 'utf8'), req, 'landing.html',
        { title: String(page.metaTitle || '').trim() || (String(page.title || page.slug) + ' — ' + name), description: String(page.metaDescription || '').trim(), image: String(page.shareImage || '').trim() });
      html = html.replace('</head>', `<script>window.BA_PAGE=${JSON.stringify({ slug: String(page.slug).toLowerCase(), draft: !page.published }).replace(/</g, '\\u003c')};</script>` + (page.published ? '' : '<meta name="robots" content="noindex">') + '</head>');
      // its own address, never the homepage's: landing.html names the homepage as its canonical, and a page drawn by it would
      // tell a search engine it is a copy of the homepage (and share as the homepage)
      const own = (m, a, u, b) => a + String(u).replace(/\/+$/, '') + '/p/' + encodeURIComponent(String(page.slug).toLowerCase()) + b;
      html = html.replace(/(<link rel="canonical" href=")([^"]*)(")/, own).replace(/(<meta property="og:url" content=")([^"]*)(")/, own);
      res.set('Cache-Control', 'no-cache');
      return res.type('html').send(html);
    }
    const biz = esc(cfg.server?.businessName || cfg.businessName || '');
    const draftBar = (!page.published && isAdmin)
      ? '<div style="background:#c9a227;color:#14301d;padding:8px 16px;font-weight:700;text-align:center">DRAFT - only signed-in admins can see this page. Publish it in Website > Pages.</div>'
      : '';
    // Sep 5 2026: the page wears the site's own chrome (site.css + the shared
    // header/footer) and the same head tokens as every templated page.
        const pageTitle = String(page.metaTitle || '').trim() || (page.title + ' — ' + (cfg.server?.businessName || cfg.businessName || ''));
    const head = fillTokens(`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">` +
      `<meta name="description" content="{{META_DESCRIPTION}}"><meta property="og:title" content="${esc(pageTitle)}"><meta property="og:type" content="website"><meta property="og:site_name" content="{{BUSINESS_NAME}}"><meta property="og:image" content="{{OG_IMAGE}}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{{OG_IMAGE}}">` +
      `<link rel="icon" type="image/png" href="/icons/icon-192.png"><link rel="stylesheet" href="/site.css"><script src="/site-chrome.js" defer></script></head>`, req, 'page.html', { description: page.metaDescription ? String(page.metaDescription) : '', image: page.shareImage ? String(page.shareImage) : '' });
    res.type('html').send(`<!DOCTYPE html><html lang="en"><head>` + head.replace('</head>', '') +
      (page.published ? '' : '<meta name="robots" content="noindex">') +
      `<title>${esc(pageTitle)}</title>` +
      `<style>.siteProse h1{font-size:clamp(28px,4vw,40px)}</style></head><body>` +
      draftBar +
      `<header class="siteHead" id="siteHead" data-name="${biz}"></header>` +
      `<main class="siteMain siteProse" id="main-content"><div class="mono">${biz}</div><h1>${esc(page.title)}</h1>` +
      // W45: a PDF page - the document first (viewer + the Open / Download buttons), the owner's text below
      (page.kind === 'pdf' && /^\/uploads\/docs\/[a-zA-Z0-9_.-]+\.pdf$/.test(String(page.pdf || ''))
        ? `<div id="pdfPage" data-src="${esc(page.pdf)}"><div class="pdfBar"><a class="siteBtn" href="${esc(page.pdf)}" target="_blank" rel="noopener">${esc(String(page.openLabel || '').trim() || 'Open the PDF')}</a><a class="siteBtn ghost" href="${esc(page.pdf)}" download>${esc(String(page.downloadLabel || '').trim() || 'Download')}</a><span class="status" id="pdfStatus"></span></div><div id="pdfPages" aria-label="Document pages"></div></div><script type="module" src="/pdf-page.js"></script>` +
          (String(page.body || '').trim() ? `<div class="pdfText">${markupToHtml(page.body)}</div>` : '')
        : markupToHtml(page.body)) +
      `</main><footer class="siteFoot" id="siteFoot" data-name="${biz}">&copy; ${new Date().getFullYear()} ${biz}</footer></body></html>`);
  } catch (err) { res.status(500).send('Page error'); }
});

// Serve static files AFTER setup check
// PWA manifest: dynamic so the installed app carries the FACILITY's name,
// not a generic one. Colors keep the product defaults unless configured.
app.get('/manifest.json', (req, res) => {
  const cfg = getConfig();
  const name = cfg.server?.businessName || 'Booking System';
  res.json({
    name: name,
    short_name: name.split(' ')[0].slice(0, 12) || 'Book',
    description: `Book your simulator session at ${name}`,
    start_url: '/',
    display: 'standalone',
    background_color: '#060a06',
    theme_color: '#c9a227',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  });
});

// DELIVERY TRUTH (maintainer, Aug 14): app shells must never be heuristically cached -
// phones were running hours-old staff.html because no Cache-Control shipped.
// no-cache = always revalidate (cheap 304s via ETag), never silently stale.
app.use((req, res, next) => {
  const p = req.path;
  // .js covers sw.js, staff-sw.js AND the shared shell scripts (/markup.js,
  // /markup-editor.js, Aug 25): a page revalidated every load but running an
  // hours-old editor script is the same silent-stale failure in a new coat.
  if (p === '/' || p === '/staff' || p === '/admin' || p === '/me' || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('-manifest.json')) {
    res.set('Cache-Control', 'no-cache');
  }
  next();
});
app.get(['/setup', '/setup.html'], (req, res) => {
  if (require('./services/auth').setupComplete()) return res.redirect('/admin');
  return res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Apply general rate limit to all API routes
app.use('/api/session/status', sessionStatusLimiter);
app.use('/api/', generalLimiter);

// Specific tighter limits on sensitive endpoints
app.use('/api/bookings/create-payment-intent', bookingLimiter);
app.use('/api/bookings/confirm',               bookingLimiter);
app.use('/api/bookings/payment-library-unreachable', reportLimiter);
app.use('/api/customer/request-pin',           pinLimiter);
app.use('/api/customer/verify-pin',            customerVerifyLimiter);
app.use('/api/customer/cancel',                customerVerifyLimiter);
app.use('/api/pricing/validate-code',          discountLimiter);
app.use('/api/members/validate-pin',           memberPinLimiter);
app.use('/api/members/portal',                 memberPinLimiter);
app.use('/api/memberships/portal',             memberPinLimiter); // self-cancel + billing: PIN brute-force protection
app.use('/api/waivers/needed',                 memberPinLimiter); // ?pin= answers differently for a real member - same guess budget

reach.mount(app, '/api/bookings', require('./routes/bookings'));
reach.mount(app, '/api/admin',    adminLimiter, require('./routes/admin'));
reach.mount(app, '/api/customer', require('./routes/customer'));
reach.mount(app, '/api/members',  require('./routes/members'));
// the bay PCs' routines (Oct 21 2026): their watcher, with its own bay key - the session poll's own bucket
reach.mount(app, '/api/session/routines', sessionStatusLimiter, require('./routes/session-routines'));

// ── PUBLIC THEME ENDPOINT ────────────────────────────────────────────────────
app.get('/api/theme', (req, res) => {
  // ONE BRAND, EVERYWHERE: the booking app now inherits the same theme the
  // owner picks for their website (maintainer, Aug 11). Previously this served five
  // orphaned keys from config.json that no admin screen ever wrote, which is
  // why the booking page never matched the marketing site.
  try {
    res.set('Cache-Control', 'no-cache');
    return res.json(require('./services/theme').forBookingApp());
  } catch (e) {
    // NEVER serve cfg.theme here: that orphaned key was written by the old
    // admin picker and a stale pick could paint the customer app. If the
    // theme service itself is broken, the default preset keeps booking
    // readable until it is fixed (pine-dark, forBookingApp shape).
    return res.json({
      bgColor: '#0d1810', surfaceColor: '#16241a', accentColor: '#c9a227',
      textColor: '#c8d2c4', mutedColor: '#8fa08c', headingColor: '#eef3ea',
      lineColor: '#24382a', btnColor: '#c9a227', btnTextColor: '#14301d',
      headerBg: '#0a130d', headerText: '#eef3ea', altBgColor: '#111f15',
      accent2Color: '#d8b544', preset: 'pine-dark', custom: false
    });
  }
});

// ── PUBLIC CONTENT ENDPOINT ───────────────────────────────────────────────────
app.get('/api/content', (req, res) => {
  const cfg = require('./services/config').getConfig();
  res.json(cfg.content || {});
});

// ── PUBLIC BOOKING RULES ENDPOINT ────────────────────────────────────────────
app.get('/api/booking-rules', (req, res) => {
  const cfg = require('./services/config').getConfig();
  res.json({
    openDays:       cfg.booking.openDays,
    openTime:       cfg.booking.openTime,
    closeTime:      cfg.booking.closeTime,
    closeNextDay:   !!cfg.booking.closeNextDay,
    open24Hours:    !!cfg.booking.open24Hours,
    // the days with hours of their own (services/hours.js): the page draws each day's times from these
    dayHours:       require('./services/hours').dayHours(cfg.booking),
    staffedAccess:  !!cfg.booking.staffedAccess,
    // when the door code arrives, in the owner's minutes ('' = no door code: staffed, or no lock) - the success screen
    codeTiming:     require('./services/doorlock').codeTimingForPage(cfg),
    membersOnly:    !!cfg.booking.membersOnly,
    wholeFacility:  !!cfg.booking.wholeFacility,
    // Mirrors the exact conditions services/sms.js uses to send - the page
    // must never offer texting the pipeline cannot deliver.
    smsAvailable:   require('./services/sms').bookingSmsAvailable(cfg),
    reviewUrl:      (cfg.seo?.reviewUrl || '').trim(),
    windowDays:     cfg.booking.windowDays,
    minSessionMins: cfg.booking.minSessionMins,
    maxSessionMins: cfg.booking.maxSessionMins,
    bufferMins:     cfg.booking.bufferMins,
    bookingFlow:    cfg.booking.bookingFlow || 'bay-first',
    depositMode:    cfg.booking.depositMode || 'off',
    depositPer30:   Number(cfg.booking.depositPer30) || 0,
    staffedWindows: require('./services/staffing').upcomingStaffedWindows(60),
    // what the booking page calls a staffed window ("Staffed hours", "Bar open")
    staffedLabel: ((cfg.scheduling && cfg.scheduling.staffedLabel) || '').trim() || 'Staffed hours'
  });
});

// ── PUBLIC CONTACT INFO ENDPOINT (no auth needed) ───────────────────────────
app.get('/api/contact', (req, res) => {
  const cfg = require('./services/config').getConfig();
  res.json({
    businessName: cfg.server.businessName,
    ...cfg.contact
  });
});

// ── PUBLIC SERVER TIME ENDPOINT (no auth) ───────────────────────────────────
// The frontend anchors "now" to THIS (the Pi's clock) instead of the visitor's
// browser clock, so every time in the system — front and back — uses one clock.
// W28 (maintainer, Sep 2 2026): a build stamp for the pages' update bar. Hashed from the
// sizes and mtimes of the files a wave can change, stat'ed at most every 5 s.
let _buildStamp = { at: 0, v: '' };
function buildStamp() {
  if (Date.now() - _buildStamp.at < 5000) return _buildStamp.v;
  const fs = require('fs'), crypto = require('crypto'); const h = crypto.createHash('sha256');
  for (const dir of ['public', 'routes', 'services', '.']) {
    let names = []; try { names = fs.readdirSync(path.join(__dirname, dir)).filter(f => /\.(html|js|json)$/.test(f)).sort(); } catch {}
    for (const f of names) { try { const st = fs.statSync(path.join(__dirname, dir, f)); h.update(dir + '/' + f + ':' + st.size + ':' + Math.floor(st.mtimeMs) + '\n'); } catch {} }
  }
  _buildStamp = { at: Date.now(), v: h.digest('hex').slice(0, 16) }; return _buildStamp.v;
}
app.get('/api/time', (req, res) => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  res.json({
    build: buildStamp(),
    // Wall-clock date/time on the Pi, in the Pi's local timezone.
    date:  `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
    time:  `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    epoch: now.getTime(),
    zone:  (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })()
  });
});

// ── PUBLIC SEO ENDPOINT (no auth needed) ────────────────────────────────────
app.get('/api/seo', (req, res) => {
  const cfg = require('./services/config').getConfig();
  res.json({
    businessName: cfg.server.businessName || '',
    ...cfg.contact,
    ...(cfg.seo || {})
  });
});

// ── PUBLIC ANNOUNCEMENT ENDPOINT ──────────────────────────────────────────────
app.get('/api/announcement', (req, res) => {
  const cfg = require('./services/config').getConfig();
  res.json(cfg.announcement || { enabled: false, message: '' });
});

reach.mount(app, '/api/waivers',  require('./routes/waivers'));
reach.mount(app, '/api/uploads', require('./routes/uploads'));

// ── WEBSITE / LANDING PAGE (CMS) ─────────────────────────────────────────────
reach.mount(app, '/api/terminal', require('./routes/terminal'));
reach.mount(app, '/api/website', (req, res, next) => {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  // The contrast audit is read-only (it computes ratios and changes nothing),
  // so it must not demand a 2FA step-up - otherwise the warning that protects
  // legibility would itself be locked behind a code while the owner is
  // mid-edit. Every other website write stays gated.
  if (req.path === '/theme/audit') return next();
  // A VISITOR's own forms are not the owner's rooms (Oct 20 2026): the inquiry form and the email sign-up are public by
  // design (rate-limited, trapped for bots), and with the lock on they answered every visitor 401 (test-2fa)
  if (req.method === 'POST' && (req.path === '/inquiry' || req.path === '/subscribe')) return next();
  return require('./services/auth').requireSensitive(req, res, next);
}, require('./routes/website'));

// Landing and events pages are static files with {{TOKEN}} identity slots,
// filled from config at serve time so the SEO head, JSON-LD, and visible
// address are always the customer's own. Cached until the file or the
// relevant config values change.
const _pageCache = {};
// Pages that read the website content: it is INLINED into the HTML at serve
// time (window.BA_SITE) so a phone paints the real hero, words and photos on
// the first render instead of after a second round trip (Sep 5 2026).
const CONTENT_PAGES = new Set(['landing.html', 'events.html', 'memberships.html', 'gift-cards.html', 'how-it-works.html', 'page.html']);
function contentStamp() {
  try {
    const db = require('./services/db').db;
    const a = db.prepare(`SELECT MAX(updated_at) AS m, COUNT(*) AS n FROM website_content`).get() || {};
    const b = db.prepare(`SELECT COUNT(*) AS n, MAX(event_date) AS m FROM website_events`).get() || {};
    let img = ''; try { const d = path.join(__dirname, 'public', 'uploads', 'landing'); img = require('fs').statSync(d).mtimeMs + ':' + require('fs').readdirSync(d).length; } catch {}
    let tiers = ''; try { tiers = String(require('./services/sitenav').sellableTiers()); } catch {}
    // updated_at is whole seconds - two saves in one second would collide, so the
    // website route's write counter rides along too.
    let wv = 0; try { wv = require('./routes/website').writeVersion(); } catch {}
    // the facility's own date (Oct 20 2026): the UTC date turned at 7 PM Central and then NOT at the facility's midnight,
    // so a cached page kept yesterday's "next event" (and on this branch "today's special") until 7 PM the next day
    // (test-facility-day F11)
    let day = ''; try { day = require('./services/revenue').facilityToday(); } catch { day = new Date().toISOString().slice(0, 10); }
    return `${a.m}|${a.n}|${b.n}|${b.m}|${img}|${tiers}|${wv}|${day}`;
  } catch { return 'nocontent'; }
}
// WHAT THE PAGE INLINES (Oct 20 2026): window.BA_SITE also carries the booking rates (Pricing), the opening hours
// (Settings), the staffed days and the review link - none of them website content - so a new rate or an earlier opening
// stayed off the homepage until the website itself changed or the day turned. The stamp is a hash of exactly what is
// inlined, whatever it is read from, so a part added to it later cannot be missed (test-website-pages).
function inlinedStamp() {
  try { return require('crypto').createHash('sha1').update(JSON.stringify(require('./routes/website').buildPublic(false))).digest('base64'); }
  catch { return 'noinline'; }
}
// Fill {{TOKENS}} in a page (or a head fragment) from config + the website
// settings. Used by serveTemplated and by the /p/<slug> renderer.
function fillTokens(html, req, file, over) {
  const fs = require('fs');
  const cfg  = require('./services/config').getConfig();
  const st = siteSettings();
  const fill = {
    BUSINESS_NAME: cfg.server?.businessName || 'Our Facility',
    ADDRESS:       cfg.contact?.address || '',
    CITY:          cfg.seo?.city  || '',
    STATE:         cfg.seo?.state || '',
    ZIP:           cfg.seo?.zip   || '',
    DOMAIN:        cfg.seo?.domain || '',
    PHONE:         cfg.contact?.phone || '',
    EMAIL:         cfg.contact?.email || '',
    LEGAL_ENTITY:  cfg.server?.legalEntity || cfg.server?.businessName || '',
    // W44: the holding page's words (Website editor > What's public)
    HOLDING_HEADLINE: require('./services/sitenav').holding(st).headline,
    HOLDING_TEXT:     require('./services/sitenav').holding(st).text
  };
  const _city = fill.CITY.trim(), _state = fill.STATE.trim(), _zip = fill.ZIP.trim();
  fill.CITY_STATE     = [_city, _state].filter(Boolean).join(', ');
  fill.IN_CITY_STATE  = fill.CITY_STATE ? ' in ' + fill.CITY_STATE : '';
  fill.CITY_STATE_ZIP = (fill.CITY_STATE + (_zip ? ' ' + _zip : '')).trim();
  fill.ADDR_FULL      = [fill.ADDRESS.trim(), _city, (_state + ' ' + _zip).trim()].filter(Boolean).join(', ');
  fill.SITE_URL = (cfg.seo?.domain || '').trim().replace(/\/+$/, '') || (req.protocol + '://' + req.get('host'));
  const _lat = String(cfg.seo?.latitude ?? '').trim(), _lng = String(cfg.seo?.longitude ?? '').trim();
  fill.GEO_REGION   = _state ? 'US-' + _state.toUpperCase().slice(0, 2) : '';
  fill.GEO_POSITION = (_lat && _lng) ? `${_lat};${_lng}` : '';
  fill.GEO_ICBM     = (_lat && _lng) ? `${_lat}, ${_lng}` : '';
  // Search & sharing (Sep 5 2026): the site title, the description (Settings >
  // Local Search & SEO, the one place it is asked) and the share image - the
  // owner's pick, else hero photo 1, else the logo, else nothing.
  fill.SITE_TITLE = (st.siteTitle || '').trim() || (fill.BUSINESS_NAME + ' — Indoor Golf Simulators');
  // W44 addendum: the site-wide description is the Website editor's (Search &
  // Sharing); the old Settings > SEO field is still read (rule 14); the booking
  // words are the LAST fallback, never the owner's copy.
  fill.META_DESCRIPTION = (st.metaDescription || '').trim() || (cfg.seo?.metaDescription || '').trim() || (fill.BUSINESS_NAME + ' — book a bay, get your door code, and play. Indoor golf simulators' + fill.IN_CITY_STATE + '.');
  let share = (st.shareImage || '').trim();
  if (!share) { try { const row = require('./services/db').db.prepare(`SELECT value FROM website_content WHERE key = 'hero'`).get(); const h = row ? JSON.parse(row.value) : null; if (h && Array.isArray(h.images) && h.images[0]) share = h.images[0]; } catch {} }
  if (!share) { for (const n of ['logo.png', 'logo.jpg']) if (fs.existsSync(path.join(__dirname, 'public', 'uploads', n))) { share = '/uploads/' + n; break; } }
  fill.OG_IMAGE = share ? (/^https?:/.test(share) ? share : fill.SITE_URL + share) : '';
  const an = analyticsIds();
  fill.ANALYTICS_NOTE = (an.ga4 || an.pixel) ? ('This website counts visits with ' + [an.ga4 ? 'Google Analytics' : '', an.pixel ? 'the Meta pixel' : ''].filter(Boolean).join(' and ') + ' so we can see which pages people use. It does not read your bookings or payments.') : '';
  for (const [k, v] of Object.entries(fill)) html = html.split(`{{${k}}}`).join(String(v).replace(/[<>"]/g, ''));
  // Per-page search titles (wave D): the owner's own title for a built-in page
  // replaces the automatic "<Page> — <Name>" in <title> and og:title.
  const PT = { 'events.html': 'events', 'memberships.html': 'memberships', 'gift-cards.html': 'giftCards', 'how-it-works.html': 'howItWorks' };
  // W44 addendum: per-page title, description and share image (Search & Sharing
  // card: settings.pageMeta[key] = { title, description, image }; the older
  // settings.pageTitles is still read for the title). A custom page passes its
  // own words in `over`; the holding page is 'holding'.
  const PK = Object.assign({ 'landing.html': 'landing', 'index.html': 'booking', 'not-yet.html': 'holding' }, PT);
  const key = PK[file];
  const pm = { ...(key ? st.pageMeta?.[key] : null), ...over };
  const clean = v => String(v || '').trim().replace(/[<>"]/g, '');
  const title = clean(pm.title) || (key && PT[file] ? clean((st.pageTitles || {})[key]) : '');
  const desc = clean(pm.description);
  const img = clean(pm.image);
  if (title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`);
  if (desc) html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`).replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`);
  if (img) { const abs = /^https?:/.test(img) ? img : fill.SITE_URL + img; html = html.replace(/(<meta property="og:image" content=")[^"]*(")/g, `$1${abs}$2`).replace(/(<meta name="twitter:image" content=")[^"]*(")/g, `$1${abs}$2`); }
  // Analytics snippets on the public pages only when an id is set (never on admin, staff or /me).
  if ((an.ga4 || an.pixel) && html.includes('</head>') && !/admin|staff|me\.html|setup|kiosk/.test(file)) {
    let snip = '';
    if (an.ga4) snip += `<script async src="https://www.googletagmanager.com/gtag/js?id=${an.ga4}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${an.ga4}',{anonymize_ip:true});</script>`;
    if (an.pixel) snip += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${an.pixel}');fbq('track','PageView');</script>`;
    html = html.replace('</head>', snip + '</head>');
  }
  // an empty share image is no tag at all, never an empty one
  html = html.replace(/<meta (?:property|name)="(?:og:image|twitter:image)" content="">\s*/g, '');
  // ONE BRAND: the chosen theme's 13 colour roles AND its three fonts injected as
  // CSS variables. Fonts joined the theme on Sep 17 2026 (a live customer counted
  // four faces on one page) and ride exactly the same path as the colours - one
  // place, one save, every public surface.
  try {
    const th = require('./services/theme');
    const t = th.resolve();
    const fv = th.fontVars(t.fonts);
    const dv = th.designVars(t.design);   // the site's style: only what differs from the site as built
    const vars = Object.keys(t.colors).map(k => `--${k}:${t.colors[k]};`).join('')
               + Object.keys(fv).map(k => `${k}:${fv[k]};`).join('')
               + Object.keys(dv).map(k => `${k}:${dv[k]};`).join('');
    if (vars && html.includes('</head>')) html = html.replace('</head>', `<style id="ba-theme">:root{${vars}}</style></head>`);
    // THE WEBFONT LINK IS THE OWNER'S CHOICE, NOT A HARDCODED LINE IN TWELVE
    // FILES. Twelve pages each carried the same fixed Playfair/Outfit/DM Mono
    // link - and the custom-page renderer carried NONE, which is the bug the
    // customer was actually looking at: /p/ pages fell back to Georgia,
    // system-ui and Menlo while the rest of the site used the real faces. One
    // rule now: whatever link a page ships with is replaced by the families
    // actually in use, and a page with no link gets one. An all-system choice
    // asks for no webfont at all.
    if (html.includes('</head>') && !/admin|staff|me\.html|kiosk|setup/.test(String(file || ''))) {
      const href = th.fontHref(t.fonts);
      const tag = href
        ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link id="ba-fonts" href="${href}" rel="stylesheet">`
        : '';
      // strip whatever the file shipped with, then put ours in once. (Doing it
      // the other way round - replace the first, remove the rest - removes the
      // one just inserted, which is exactly what the first cut of this did.)
      html = html.replace(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/gi, '');
      if (tag) html = html.replace('</head>', tag + '</head>');
    }
  } catch { /* keep the page's built-in defaults */ }
  if (CONTENT_PAGES.has(file) && html.includes('</head>')) {
    try {
      const pub = require('./routes/website').buildPublic(false);
      const social = (pub.content && pub.content.social) || {};
      const same = Object.values(social).filter(u => typeof u === 'string' && /^https:\/\//.test(u));
      let inject = `<script id="ba-site">window.BA_SITE=${JSON.stringify(pub).replace(/</g, '\\u003c')};</script>`;
      if (same.length) inject += `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: fill.BUSINESS_NAME, url: fill.SITE_URL, sameAs: same }).replace(/</g, '\\u003c')}</script>`;
      html = html.replace('</head>', inject + '</head>');
    } catch { /* the page fetches the content itself */ }
  }
  return html;
}
function serveTemplated(file) {
  const fs = require('fs');
  return (req, res) => {
    try {
      const cfg  = require('./services/config').getConfig();
      const full = path.join(__dirname, 'public', file);
      let _themeStamp = '';
      try { const _t = require('./services/theme').resolve(); _themeStamp = JSON.stringify([_t.colors, _t.fonts, _t.design]); } catch {}
      const stamp = _themeStamp + '|' + fs.statSync(full).mtimeMs + '|' + ((cfg.seo?.domain || '').trim() ? '' : req.get('host')) + '|' + (cfg.server?.businessName || '')
        + (file === 'not-yet.html' ? '|' + JSON.stringify(siteSettings().holding || '') : '') + '|' + JSON.stringify(cfg.announcement || {}) /* W44: the ONE notice rides inlined - a change must show on the next request */ + '|' + (cfg.seo?.domain || '') + '|' + (cfg.contact?.address || '') + '|' + (cfg.seo?.city || '') + '|' + (cfg.seo?.state || '') + '|' + (cfg.seo?.zip || '') + '|' + (cfg.contact?.phone || '') + '|' + (cfg.contact?.email || '') + '|' + (cfg.server?.legalEntity || '') + '|' + (cfg.seo?.latitude || '') + '|' + (cfg.seo?.longitude || '') + '|' + (cfg.seo?.metaDescription || '') + '|' + (CONTENT_PAGES.has(file) || file === 'index.html' ? contentStamp() : '') + '|' + (CONTENT_PAGES.has(file) ? inlinedStamp() : '') + '|' + JSON.stringify(siteSettings());
      if (!_pageCache[file] || _pageCache[file].stamp !== stamp) {
        const html = fillTokens(fs.readFileSync(full, 'utf8'), req, file);
        _pageCache[file] = { stamp, html };
      }
      res.type('html').send(_pageCache[file].html);
    } catch {
      res.status(500).send('Page unavailable');
    }
  };
}
// The marketing pages honour the website switch: off -> straight to booking.
app.get('/landing', (req, res) => siteOn() ? serveTemplated('landing.html')(req, res) : res.redirect(302, '/book'));
app.get('/events',  (req, res) => siteOn() ? serveTemplated('events.html')(req, res) : res.redirect(302, '/book'));
// /book ALWAYS serves the booking app, in both homepage modes — so QR codes
// and links printed today keep working after the homepage flip.
app.get('/book', serveTemplated('index.html'));
app.get('/admin-website', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-website.html')));

// Serve uploaded files publicly
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
reach.mount(app, '/api/pricing', require('./routes/pricing'));

// ── TWILIO INCOMING WEBHOOK ──────────────────────────────────────────────────
// Handles STOP/HELP replies from customers
// Use the facility sender name and escape it before putting it in TwiML.
function smsBrand() { try { return require('./services/sms').brandFor(getConfig()) || 'Booking texts'; } catch { return 'Booking texts'; } }
function xmlText(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
app.post('/api/twilio/incoming', express.urlencoded({ extended: false }), (req, res) => {
  if (!require('./services/auth').twilioSignatureValid(req)) {
    return res.status(403).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }
  const body  = String(req.body.Body || '').trim().toUpperCase().slice(0, 160);
  const from  = String(req.body.From || '').slice(0, 32);
  const dbm = require('./services/db');
  dbm.adminLog('SMS_INCOMING', 'Verified Twilio callback received');

  // Twilio expects TwiML response
  res.setHeader('Content-Type', 'text/xml');
  // The carrier keywords (Twilio's own list). STOP is RECORDED here, not just
  // answered: sendSMS refuses the number from now on, whichever provider
  // carries the text, until START arrives (Sep 6 2026). REVOKE and OPTOUT joined
  // Twilio's default list on May 13 2025 (Twilio changelog, read Oct 18 2026) -
  // Twilio already blocks the number for them; the unit records it too.
  // THE FIRST WORD COUNTS (W36), punctuation aside ("Stop." / "STOP!"), and "opt out" in two words is OPTOUT (Oct 19
  // 2026). Twilio itself matches only a whole-message keyword ("Stop please" is not blocked there); the unit errs toward
  // honouring a request to stop, and the reply tells the customer at once how to undo it.
  const words = body.replace(/[^A-Z0-9\s]/g, ' ').trim().split(/\s+/);
  let word = words[0] || '';
  if (word === 'OPT' && words[1] === 'OUT') word = 'OPTOUT';
  // OptOutType (Twilio's Advanced Opt-Out on a Messaging Service, twilio.com/docs/sms/services/advanced-opt-out): Twilio
  // matched one of the account's own keywords - perhaps one this list does not know - and has ALREADY sent its
  // confirmation reply, so the unit records it and adds no second message.
  const optType = String(req.body.OptOutType || '').toUpperCase();
  const quiet = ['STOP', 'START', 'HELP'].includes(optType);
  if (optType === 'STOP' || (!quiet && ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'].includes(word))) {
    dbm.smsOptOut(from, word || optType, 'twilio');
    dbm.adminLog('SMS_OPT_OUT', `From: ${from} | ${word || optType}${optType ? ' (OptOutType ' + optType + ')' : ''}`);
    // the replies name who is texting (Oct 19 2026, with HELP below): a customer who texts "Stop please" or "Cancel my
    // booking" - words Twilio's own whole-message keywords do not catch - is answered by the unit, and the words match the
    // opt-out and opt-in messages the guide has the owner register and set in Twilio's Advanced Opt-Out
    res.send(quiet ? '<Response></Response>' : '<Response><Message>' + xmlText(`${smsBrand()}: you are unsubscribed from booking texts and will get no more. Reply START to resubscribe.`) + '</Message></Response>');
  } else if (optType === 'START' || (!quiet && ['START', 'YES', 'UNSTOP', 'SUBSCRIBE'].includes(word))) {
    dbm.smsOptIn(from);
    dbm.adminLog('SMS_OPT_IN', `From: ${from} | ${word || optType}${optType ? ' (OptOutType ' + optType + ')' : ''}`);
    res.send(quiet ? '<Response></Response>' : '<Response><Message>' + xmlText(`${smsBrand()}: you are resubscribed to booking texts. Reply HELP for help, STOP to unsubscribe. Msg & data rates may apply.`) + '</Message></Response>');
  } else if (quiet) {
    res.send('<Response></Response>');   // HELP: Twilio answered it already
  } else if (word === 'HELP' || word === 'INFO') {
    // THE HELP REPLY SAYS WHO IS TEXTING AND HOW TO REACH THEM (Oct 19 2026, found reading the guide against the code - it
    // ended "For help contact us" with no name and no contact): Twilio's reference has a HELP reply carry the brand and a
    // support contact (the UsAppToPerson resource's help message, required when the sender answers HELP itself, as this
    // unit does), and carriers' registration review expects the brand, a contact and how to stop
    const hc = getConfig();
    const reach = (hc.contact && (hc.contact.phone || hc.contact.email)) || String((hc.seo && hc.seo.domain) || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    res.send('<Response><Message>' + xmlText(`${smsBrand()}: booking texts. For help, ${reach ? 'contact ' + reach : 'contact the facility'}. Reply STOP to unsubscribe. Msg & data rates may apply.`) + '</Message></Response>');
  } else {
    res.send('<Response></Response>'); // no reply for other messages
  }
});

// ── SETUP WIZARD API ─────────────────────────────────────────────────────────
app.get('/api/setup/guide', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.download(path.join(__dirname, 'docs', 'customer-guides-current', 'EVERYTHING-ASK-YOUR-AI.md'));
});

app.post('/api/setup/complete', (req, res) => {
  // The wizard must not let an owner finish with a payment config that cannot
  // take a payment (maintainer, Sep 17 2026, a live customer). Same one validator as
  // Settings - there is one idea of what a Stripe key looks like.
  {
    const problems = require('./services/stripestatus').validateStripeKeys(req.body, require('./services/config').getConfig());
    if (problems.length) return res.status(400).json({ error: problems[0].message, field: problems[0].field, problems });
  }
  try {
    const auth = require('./services/auth');
    // SETUP IS DONE MEANS DONE (maintainer, Sep 21 2026). This used to be one && chain
    // that included `!auth.setupComplete()`, so once setup finished the whole
    // condition went false and the route stopped asking for anything at all.
    // The two checks are now separate because they answer different questions,
    // and the /api/setup gate above says the same thing first - belt and braces
    // on the one route that can rewrite config.json and the owner password.
    if (auth.setupComplete()) {
      try { require('./services/db').adminLog('SETUP_COMPLETE_REFUSED', `IP: ${auth.getClientIp(req)}`); } catch {}
      return res.status(403).json({ error: 'Setup is not available on this unit.' });
    }
    const { saveConfig } = require('./services/config');
    const incoming = req.body || {};
    const chosen = typeof incoming.server?.adminPassword === 'string' ? incoming.server.adminPassword : '';
    if (chosen.trim().length < 8 || chosen.length > 256) {
      return res.status(400).json({ error: 'Choose an owner password of 8 to 256 characters.' });
    }
    // Store the chosen verifier and the completion flag in the same write.
    incoming.server = {
      businessName: incoming.server.businessName,
      legalEntity: incoming.server.legalEntity,
      timezone: incoming.server.timezone,
      adminAuth: auth.hashPassword(chosen)
    };
    incoming.setup = { completed: true, completedAt: new Date().toISOString() };
    // THE BACKUP PASSPHRASE, ASKED ONCE IN THE WIZARD (maintainer, Sep 23 2026). Optional;
    // never saved as typed - taken out of the payload before anything is written
    // and kept only as the derived key the vault uses. A short one is refused
    // before setup changes anything.
    const backupPass = typeof incoming.backupPassphrase === 'string' ? incoming.backupPassphrase : '';
    delete incoming.backupPassphrase;
    if (backupPass && (backupPass.length < 10 || backupPass === chosen)) return res.status(400).json({ error: 'Backup passphrase: use at least 10 characters - a short phrase you will remember beats a password you will lose.', field: 'backupPassphrase' });
    // ONE TRUTH FOR STAFFING (Aug 20 truth audit): the server derives the
    // runtime boolean from the declared style - same law as the admin save.
    // Canonicalize the style FIRST ('codes' -> 'unmanned'), then derive the
    // runtime boolean from it. One vocabulary from here down.
    try { require('./services/staffing').normalizeAccessStyle(incoming.booking); } catch {}
    try { if (incoming.booking?.accessStyle) incoming.booking.staffedAccess = incoming.booking.accessStyle === 'staffed'; } catch {}
    // ACCESS-AWARE CHECK-IN DEFAULT (maintainer's ruling): an unmanned facility runs
    // no counter, so check-in starts OFF; staffed and hybrid counters keep
    // the full flow. The control stays visible in Settings > Business & Content > Facility Policies either
    // way - this is a smart default, never a gate. Only set when the wizard
    // did not explicitly carry one.
    try {
      if (incoming.booking?.accessStyle && !(incoming.pos && incoming.pos.checkinMode)) {
        const style = require('./services/staffing').accessStyleOf(incoming.booking);
        incoming.pos = Object.assign({}, incoming.pos, {
          checkinMode: style === 'unmanned' ? 'off' : 'full'
        });
      }
      // CASH AND CHECKS ON, WRITTEN DOWN (maintainer's ruling, Sep 1 2026 — F1).
      // posCfg() already defaults both true, but a default that lives only in
      // code leaves config.json silent about it, and the owner's screen then
      // shows a setting nothing states. The wizard writes it explicitly, just
      // as it writes checkinMode, so the stored config IS the truth.
      // A cash drawer is a separate question and stays off until one is wired.
      if (!(incoming.pos && incoming.pos.payments)) {
        incoming.pos = Object.assign({}, incoming.pos, { payments: { cash: true, check: true } });
      }
      // EMPLOYEE SCHEDULING (Sep 2026): a choice for facilities with a
      // counter. On for staffed and hybrid out of the wizard, off for unmanned
      // - unless the payload carries the owner's own answer. Flippable any
      // time under Settings > Staff > The Counter.
      if (incoming.booking?.accessStyle && !(incoming.scheduling && typeof incoming.scheduling.enabled === 'boolean')) {
        const style = require('./services/staffing').accessStyleOf(incoming.booking);
        incoming.scheduling = Object.assign({}, incoming.scheduling, { enabled: style !== 'unmanned' });
      }
    } catch {}
    // ONE TAX QUESTION (maintainer, Sep 1 2026 — bench finding F2). The wizard asks
    // for a sales tax rate once. It used to land in cfg.tax, which only the
    // BOOKING path reads; the POS reads cfg.pos.tax.categories, which nothing
    // seeded — so a facility that answered the wizard honestly sold food and
    // drink completely untaxed and was never told. The same answer now seeds
    // the three starting tax codes (sim / food / beverage) at that rate.
    // Refining a category later in Admin > Point of Sale > Tax Codes is
    // untouched; this only fills the blank, and only when the wizard actually
    // carried a rate and the payload did not already bring its own codes.
    try {
      const tx = incoming.tax || {};
      const rate = Number(tx.rate) || 0;
      const alreadySet = incoming.pos && incoming.pos.tax &&
        (Array.isArray(incoming.pos.tax.codes) && incoming.pos.tax.codes.length);
      if (tx.enabled && rate > 0 && !alreadySet) {
        const names = { sim: 'Simulator time', food: 'Prepared food', beverage: 'Beverage' };
        const codes = ['sim', 'food', 'beverage'].map(id => ({ id, name: names[id], rate, stripe_code: '' }));
        incoming.pos = Object.assign({}, incoming.pos, {
          tax: Object.assign({ stripeTax: false }, (incoming.pos && incoming.pos.tax) || {}, {
            codes,
            categories: { sim: rate, food: rate, beverage: rate }
          })
        });
      }
    } catch (e) { console.error('wizard tax seed:', e.message); }

    const dbm = require('./services/db');
    const settings = siteSettings();
    settings.public = { ...settings.public, booking: false, memberships: false, portal: false, events: false, giftCards: false };
    settings.siteEnabled = false;
    dbm.db.prepare("INSERT OR REPLACE INTO website_content (key, value, updated_at) VALUES ('settings', ?, datetime('now'))")
      .run(JSON.stringify(settings));
    saveConfig(incoming);
    if (backupPass) {
      try { require('./services/backupvault').setPassphrase(backupPass); require('./services/db').adminLog('BACKUP_VAULT_SET', 'set in the setup wizard - copies that leave this unit are encrypted'); }
      catch (e) { console.error('wizard backup passphrase:', e.message); }
    }
    // The wizard's access answer seeds the marketing website's staffed-hours
    // section: an ALWAYS-STAFFED facility starts with that section hidden (a
    // "staffed days vs self-service" comparison makes no sense when staff is
    // always there); unmanned and hybrid facilities keep it. The old
    // booking.unmanned key is honored as a fallback for any stale caller.
    // The owner can flip it any time in Admin -> Website.
    try {
      if (req.body?.booking?.accessStyle === 'staffed' || req.body?.booking?.unmanned === false) {
        const dbm = require('./services/db');
        dbm.db.prepare(`INSERT OR REPLACE INTO website_content (key, value, updated_at) VALUES ('staffed', ?, datetime('now'))`)
          .run(JSON.stringify({ enabled: false }));
      }
    } catch { /* website tables not ready — landing defaults still apply */ }
    // ...and, set up by talking, the public parts answer the holding page (W44 - the one map) until the owner says the site is
    // ready: the booking page, memberships, the member portal, events and gift cards. A signed-in owner always gets through,
    // so the assistant's live view and the owner's own test bookings work meanwhile.
    try {
      if (incoming.setup && incoming.setup.byAssistant === true) {
        const dbm = require('./services/db');
        const row = dbm.db.prepare(`SELECT value FROM website_content WHERE key = 'settings'`).get();
        let st = {}; try { st = (row && JSON.parse(row.value)) || {}; } catch { st = {}; }
        st.public = Object.assign({}, st.public, { booking: false, memberships: false, portal: false, events: false, giftCards: false });
        dbm.db.prepare(`INSERT OR REPLACE INTO website_content (key, value, updated_at) VALUES ('settings', ?, datetime('now'))`).run(JSON.stringify(st));
        dbm.adminLog('SETUP_BY_ASSISTANT', 'the first screen finished; the public site is held until the owner says it is ready');
      }
    } catch { /* website tables not ready - the checklist still asks */ }

    // MEMBERS-ONLY FIRST TIER (Aug 2026): a private club with zero tiers is a
    // locked door - nobody could join or book. The wizard collects one tier
    // and it is created HERE, atomically with the rest of setup. flat_rate is
    // the club's real booking price (per 30 minutes); everything else keeps
    // schema defaults and is refined later in Admin -> Members -> Tiers.
    try {
      const ft = req.body?.firstTier;
      if (req.body?.booking?.membersOnly && ft && String(ft.name || '').trim()) {
        const dbm = require('./services/db');
        const tierId = require('uuid').v4();
        dbm.db.prepare(`INSERT INTO membership_tiers
            (id, name, discount_type, discount_value, price_monthly, price_annual, roster_cap, sell_online, active)
          VALUES (?,?,?,?,?,?,?,?,1)`)
          .run(tierId, String(ft.name).trim().slice(0, 60), 'flat_rate',
            Math.max(0, Number(ft.rate_per_30) || 0),
            Math.max(0, Number(ft.price_monthly) || 0),
            Math.max(0, Number(ft.price_annual) || 0),
            Math.max(0, parseInt(ft.roster_cap) || 0),
            ft.sell_online ? 1 : 0);
        dbm.flushed().catch(() => {});   // written now, never freezing the unit (see services/bookingledger)
        dbm.adminLog && dbm.adminLog('TIER_CREATED', `${String(ft.name).trim()} (setup wizard)`);
      }
    } catch (e) { console.error('wizard first tier:', e.message); }
    console.log('Setup complete. Public booking is held until the owner opens it.');
    req.app.locals.restartAfterSetup(res);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── OFF-SITE BACKUP PULL (token-only) ────────────────────────────────────────
// GET /api/backup/pull?token=... streams a fresh backup zip. No session, no
// password - the token IS the credential, it is 64 hex chars minimum, compared
// constant-time, and it opens nothing else on this unit. Through the tunnel
// domain this makes nightly off-site pulls a one-line scheduled task.
// THE VAULT (Aug 26): the pull serves the ENCRYPTED form when a passphrase is
// set, is rate-limited (a token is a bearer credential), and a pull from an
// address this unit has never seen is logged and emailed to the owner.
const pullLimiter = rateLimit({ keyGenerator: realClientKey, windowMs: 60 * 60 * 1000, max: 6,
  message: { error: 'Too many backup pulls - try again in an hour.' } });
app.get('/api/backup/pull', pullLimiter, async (req, res) => {
  try {
    const csvc = require('./services/config');
    const cfg = csvc.getConfig();
    const want = cfg.backup && cfg.backup.pullToken;
    const got = String(req.query.token || '');
    const crypto2 = require('crypto');
    const okTok = !!want && want.length >= 64 && got.length === want.length &&
      crypto2.timingSafeEqual(Buffer.from(got), Buffer.from(want));
    if (!okTok) return res.status(401).json({ error: 'Unauthorized' });
    const vault = require('./services/backupvault');
    // THE LINK ONLY EVER HANDS OUT AN ENCRYPTED BACKUP (maintainer, Sep 23 2026). A link
    // made before the rule, on a unit with no passphrase, is refused - never
    // served plain - and the owner's health line says it is paused.
    if (!vault.vaultState().set) {
      try { require('./services/db').adminLog('BACKUP_PULL_REFUSED', `off-site pull from ${realClientKey(req)} refused - no backup passphrase is set`); } catch {}
      return res.status(409).json({ error: 'This unit has no backup passphrase set, so it will not hand out a backup over the link. The owner sets one in Admin > Settings > Protection > Backups.' });
    }
    const zip = await require('./services/backup').createBackup();
    const file = vault.offsiteCopyOf(zip);
    const ip = realClientKey(req);
    const seen = new Set((cfg.backup && cfg.backup.pullSeenIps) || []);
    const firstTime = !seen.has(ip);
    try {
      const c = csvc.getConfig();
      c.backup = Object.assign({}, c.backup, { lastPull: { at: new Date().toISOString(), ip, encrypted: file !== zip },
        pullSeenIps: [...seen, ip].slice(-20) });
      csvc.saveConfig(c);
    } catch {}
    try { require('./services/db').adminLog(firstTime ? 'BACKUP_PULL_NEW_ADDRESS' : 'BACKUP_PULLED', `off-site pull from ${ip}`); } catch {}
    if (firstTime) {
      const to = (cfg.contact && cfg.contact.email) || null;
      if (to) { try { require('./services/email').sendEmail({ to, subject: `${cfg.server?.businessName || 'Your booking system'}: backup pulled from a new address`,
        text: `A backup of your system was just downloaded using your off-site backup link from a computer this unit had not seen before (${ip}).\n\nIf that was you setting up a new computer, nothing to do. If not, open Admin > Settings > Protection > Backups and disable the link right away - that kills it everywhere.` }); } catch {} }
    }
    const name = require('path').basename(file).replace(/^auto-/, 'offsite-');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Type', file === zip ? 'application/zip' : 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    require('fs').createReadStream(file).pipe(res);
  } catch (err) { res.status(500).json({ error: 'Backup failed' }); }
});

// ── THE PRIVATE CALENDAR LINK (Oct 19 2026, services/calendarfeed.js) ──────────────────────────
// GET /api/calendar/<key>.ics - the owner's bookings as an iCalendar feed that Google Calendar,
// Apple Calendar and Outlook subscribe to from the facility's own address. The key in the path IS
// the credential (32 random bytes, constant-time, made new in one tap); no session, and it opens
// nothing else. A wrong, old or switched-off link is a plain 404 - the same as no link at all.
// Rate-limited per caller: a calendar service reads every few hours, a person reloads a few times.
const calendarLimiter = rateLimit({ keyGenerator: realClientKey, windowMs: 60 * 60 * 1000, max: 120,
  message: { error: 'Too many reads of this calendar - try again in an hour.' } });
app.get('/api/calendar/:key.ics', calendarLimiter, (req, res) => {
  try {
    const body = require('./services/calendarfeed').feedFor(req.params.key);
    if (!body) return res.status(404).type('text/plain').send('Not found');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="bookings.ics"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  } catch (err) { res.status(500).type('text/plain').send('The calendar could not be built'); }
});

// ── USB BACKUP DETECTION ─────────────────────────────────────────────────────
// Scans mounted USB drives for backup zip files
app.get('/api/setup/check-usb', (req, res) => {
  const cfg = require('./services/config').getConfig();
  if (cfg.setup?.completed) return res.status(403).json({ error: 'Setup already completed' });

  const fs = require('fs');
  // BA_SETUP_MEDIA_DIR is a TEST seam only (test-wizard-restore puts a "drive"
  // under /tmp, which the restore route already accepts); no unit sets it.
  const mediaDir = process.env.BA_SETUP_MEDIA_DIR || '/media/ba-core';
  const backups = [];

  try {
    if (!fs.existsSync(mediaDir)) return res.json({ backups: [] });
    const drives = fs.readdirSync(mediaDir);
    for (const drive of drives) {
      // THE STICK'S OWN BACKUP FOLDER TOO (Oct 19 2026, found reading the guide against the code): a unit writes its
      // nightly USB copies into <stick>/BA-Backups/ (services/backup.js MEDIA_SUBDIR), and this looked only at the top of
      // the stick - so a cold spare plugged in with the dead unit's stick offered no restore (rule 45)
      for (const sub of ['', 'BA-Backups']) {
        const drivePath = path.join(mediaDir, drive, sub);
        try {
          const files = fs.readdirSync(drivePath);
          for (const file of files) {
            if ((file.endsWith('.zip') || file.endsWith('.baenc')) && /backup|BA-FULLDB/i.test(file)) {
              const stat = fs.statSync(path.join(drivePath, file));
              if (!stat.isFile()) continue;
              backups.push({
                filename: file,
                drive: drive,
                path: path.join(drivePath, file),
                size: Math.round(stat.size / 1024),
                date: stat.mtime.toISOString()
              });
            }
          }
        } catch {}
      }
    }
  } catch {}

  // Sort newest first
  backups.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ backups });
});

// ── RESTORE FROM USB BACKUP ──────────────────────────────────────────────────
app.post('/api/setup/restore', (req, res) => {
  const cfg = require('./services/config').getConfig();
  if (cfg.setup?.completed) return res.status(403).json({ error: 'Setup already completed' });

  const { backupPath, passphrase } = req.body;
  if (!backupPath) return res.status(400).json({ error: 'No backup file specified' });

  const fs = require('fs');
  const pathMod = require('path');
  const { execFile } = require('child_process');

  // Canonicalize and confine to removable-media / temp mount points only.
  let realPath;
  try { realPath = fs.realpathSync(backupPath); } catch { return res.status(404).json({ error: 'Backup file not found' }); }
  const okRoot = ['/media/', '/mnt/', '/tmp/'].some(r => realPath.startsWith(r));
  if (!okRoot) return res.status(403).json({ error: 'Invalid backup path' });
  if (!/\.(zip|backup|baenc)$/i.test(realPath)) return res.status(400).json({ error: 'Not a backup archive' });

  const appDir = path.join(__dirname);
  // The decrypted copy and the unpacked files go in the work folder on the card,
  // never /tmp - that is memory on a unit (Sep 23 2026) - after asking for room.
  const bkRoom = require('./services/backup').restoreRoom(fs.statSync(realPath).size);
  if (!bkRoom.ok) return res.status(507).json({ error: bkRoom.message, noRoom: true });
  const workDir = require('./services/backup').workDir('setup-restore');
  const tmpDir = pathMod.join(workDir, 'unpacked');
  const dropWork = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} };

  fs.mkdirSync(tmpDir, { recursive: true });
  // THE VAULT: an encrypted backup needs the owner's passphrase - decrypt to a
  // temp zip first, then the restore is exactly what it always was
  const vault = require('./services/backupvault');
  let zipToRestore = realPath;
  if (vault.isEncrypted(realPath)) {
    if (!passphrase) { dropWork(); return res.status(400).json({ error: 'This backup is encrypted - enter the backup passphrase', needsPassphrase: true }); }
    try { zipToRestore = vault.decryptFile(realPath, passphrase, path.join(workDir, 'decrypted.zip')); }
    catch (e) { dropWork(); return res.status(400).json({ error: e.message, needsPassphrase: true }); }
  }
  execFile('unzip', ['-o', zipToRestore, '-d', tmpDir], { timeout: 10 * 60000 }, (err) => {
    if (err) { dropWork(); return res.status(500).json({ error: 'Failed to unzip backup' }); }

    // W41 (Sep 9 2026): the running server holds the database in memory. Settle
    // any write on its way BEFORE the file is replaced, and re-read it AFTER -
    // the admin restore learned this in W23; this path had not, so a restore
    // before the wizard left the server's memory on the old data (and, before
    // ONE WRITER, its next flush wrote that old data back over the restore).
    const dbModule = require('./services/db');
    // What the backup says it is (backup.json), read before the temp folder goes.
    const bk = require('./services/backup');
    const manifest = bk.readManifest(tmpDir);
    // rule 43 (Oct 8 2026): the unpacked backup is brought to today's layout BEFORE anything is copied
    // onto the unit (services/importers.js - the one place a conversion lives); a conversion that fails
    // stops the restore with nothing changed
    let converted;
    try { converted = require('./services/importers').convert(tmpDir); }
    catch (e) { dropWork(); try { require('./services/db').adminLog('RESTORE_FAILED', e.message); } catch {} return res.status(500).json({ error: e.message }); }
    dbModule.settle().then(() => {
      const restored = require('./services/backup').restoreFromExtracted(tmpDir, appDir);
      return dbModule.reload().then(() => restored);
    }).then(restored => {
      dropWork();
      // W44 (Sep 10 2026): a backup from an OLDER unit is migrated NOW - the core
      // tables and columns, the service tables, and the file on disk - before this
      // answer, so "Reloading" clears onto a database the current code runs on.
      // The wizard values the backup never carried sit at their defaults; the
      // result screen lists them for the owner to review.
      const migrated = require('./services/schema').migrateAfterRestore();
      const defaults = require('./services/config').defaultsFilled();
      // the restored facility's zone, now - restoring here skips the wizard's zone step (a spare or a replacement board)
      try { require('./services/timezone').ensureConfiguredZone('after a restore at setup', (ev, d) => dbModule.adminLog(ev, d)); } catch (e) {}
      console.log('✅ Backup restored:', restored.join(', '), '- schema current (' + migrated.tables + ' tables), ' + defaults.length + ' setting(s) at defaults');
      try { dbModule.adminLog('RESTORE_WIZARD', `${bk.describeManifest(manifest)} | ${require('./services/importers').line(converted)} | restored ${restored.join(', ')}; schema migrated to ${migrated.tables} tables; ${defaults.length} settings at defaults`); } catch {}
      req.app.locals.restartAfterSetup(res);
      res.json({ success: true, restored, migrated, defaults, converted,
        setupComplete: require('./services/auth').setupComplete(),
        madeBy: bk.describeManifest(manifest), leftOut: bk.leftOutOf(manifest),
        manifest: manifest ? { writtenBy: manifest.writtenBy, createdAt: manifest.createdAt, unit: manifest.unit } : null });
    }).catch(restoreErr => {
      dropWork();
      res.status(500).json({ error: 'Restore failed: ' + restoreErr.message });
    });
  });
});

// ── SIMULATOR STATUS (polled by kiosk) ───────────────────────────────────────
app.get('/api/simulator/status', (req, res) => {
  // Back-compat alias — redirect callers to the canonical session status endpoint
  const { bay } = req.query;
  if (!bay) return res.status(400).json({ error: 'bay param required' });
  res.redirect(307, `/api/session/status?bay=${encodeURIComponent(bay)}`);
});

// ── PAGE ROUTES ───────────────────────────────────────────────────────────────
app.get('/admin',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
// the owner's setup chat: the page signs in through the owner's own session, like /admin
app.get('/assistant',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'assistant.html')));

// ── REVENUE REPORTING ─────────────────────────────────────────────────────────
const { requireAdmin } = require('./services/auth');

// Helper — date range string → { count, revenue_cents, duration_minutes }
function revenueQuery(db, start, end) {
  return db.prepare(
    `SELECT COUNT(*) as count,
            COALESCE(SUM(price_cents), 0) as revenue_cents,
            COALESCE(SUM(duration_minutes), 0) as duration_minutes
     FROM bookings WHERE status='active' AND date >= ? AND date <= ?`
  ).get(start, end);
}

// NOTE: /api/admin/revenue/{summary,daily,monthly} live in routes/admin.js.
// Duplicates were registered here too, but the admin router mounts FIRST so
// these never ran - dead code that looked live. Anyone fixing a revenue bug
// here would have seen no change. The router version is also richer
// (membership MRR, occupancy, month/year params).

// ── OWNER AUTH: login (password -> cookie session), logout, and setup login ──
app.post('/api/auth/admin/login', (req, res) => {
  const auth = require('./services/auth');
  const ip = auth.getClientIp(req);
  const locked = auth.loginLocked(ip);
  if (locked) return res.status(429).json({ error: `Too many attempts. Try again in ${locked} minute(s).` });
  const pw = (req.body && req.body.password) || '';
  // W40 (Sep 9 2026): an EMPTY password is no credential at all - a tap on
  // Sign In with nothing typed, or a bare POST - and is never counted as a
  // guess. Brute force needs a password; every request carrying one counts.
  if (!pw) return res.status(401).json({ error: 'Enter your password.' });
  const isOwner = auth.verifyAdminPassword(pw);
  const isManager = !isOwner && auth.verifyManagerPassword(pw);
  if (!isOwner && !isManager) {
    auth.loginFailed(ip);
    try { require('./services/db').adminLog('ADMIN_LOGIN_FAILED', 'IP: ' + ip); } catch {}
    return res.status(401).json({ error: 'Incorrect password' });
  }
  auth.loginSucceeded(ip);
  const cfg = require('./services/config').getConfig();
  if (isManager) {
    // Managers are an operational sign-in: no 2FA flow, no sensitive rooms
    // (requireOwner refuses them server-side regardless of any UI).
    const { sid, csrf } = auth.createSession('manager', req);
    auth.setSessionCookie(req, res, sid);
    try { require('./services/db').adminLog('MANAGER_LOGIN', 'IP: ' + ip); } catch {}
    return res.json({ ok: true, csrf, role: 'manager' });
  }
  if (auth.twofaState().enabledLogin) {
    const { sid } = auth.createSession('twofa-pending', req);
    auth.setSessionCookie(req, res, sid);
    return res.json({ ok: true, twofaRequired: true });
  }
  const { sid, csrf } = auth.createSession('admin', req);
  auth.setSessionCookie(req, res, sid);
  try { require('./services/db').adminLog('ADMIN_LOGIN', 'IP: ' + ip); } catch {}
  res.json({ ok: true, csrf, role: 'owner', mustChangePassword: !!(cfg.server && cfg.server.adminAuthDefault) });
});

// Who am I: the admin UI asks once and shapes itself to the role.
app.get('/api/auth/whoami', (req, res) => {
  const auth = require('./services/auth');
  const role = auth.requestRole(req);
  if (!role) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ role, managerEnabled: auth.managerEnabled() });
});
// Second step of a 2FA-enabled sign-in: pending cookie + authenticator code.
app.post('/api/auth/admin/login-2fa', (req, res) => {
  const auth = require('./services/auth');
  const ip = auth.getClientIp(req);
  const locked = auth.loginLocked(ip);
  if (locked) return res.status(429).json({ error: `Too many attempts. Try again in ${locked} minute(s).` });
  const pending = auth.sessionFrom(req, 'twofa-pending');
  if (!pending) return res.status(401).json({ error: 'Sign in again' });
  const code2 = (req.body && req.body.code) || '';
  if (!code2) return res.status(401).json({ error: 'Enter the code from your authenticator app.' });   // W40: no code is not a guess
  if (!auth.verifyAnySecond(code2)) {
    auth.loginFailed(ip);
    return res.status(401).json({ error: 'That code did not match' });
  }
  auth.loginSucceeded(ip);
  auth.destroySession(req);
  const { sid, csrf } = auth.createSession('admin', req);
  auth.setSessionCookie(req, res, sid);
  try { require('./services/db').adminLog('ADMIN_LOGIN', '2FA, IP: ' + ip); } catch {}
  const cfg = require('./services/config').getConfig();
  res.json({ ok: true, csrf, mustChangePassword: !!(cfg.server && cfg.server.adminAuthDefault) });
});
app.post('/api/auth/admin/logout', (req, res) => {
  const auth = require('./services/auth');
  auth.destroySession(req);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});
app.get('/api/auth/admin/session', (req, res) => {
  const auth = require('./services/auth');
  const s = auth.sessionFrom(req, 'admin');
  if (!s) return res.status(401).json({ ok: false });
  const cfg = require('./services/config').getConfig();
  res.json({ ok: true, csrf: s.csrf, mustChangePassword: !!(cfg.server && cfg.server.adminAuthDefault) });
});
app.post('/api/auth/admin/change-password', (req, res) => {
  const auth = require('./services/auth');
  if (!auth.verifyAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { currentPassword, newPassword } = req.body || {};
  if (!auth.verifyAdminPassword(currentPassword || '')) return res.status(401).json({ error: 'Current password is incorrect' });
  try { auth.setAdminPassword(newPassword); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const { sid, csrf } = auth.createSession('admin', req);   // rotate session
  auth.setSessionCookie(req, res, sid);
  try { require('./services/db').adminLog('ADMIN_PASSWORD_CHANGED', ''); } catch {}
  res.json({ ok: true, csrf });
});
// ── TWO-FACTOR management (all steps re-verify the password) + step-up ──────
app.post('/api/auth/2fa/setup', (req, res) => {
  const auth = require('./services/auth');
  if (!auth.verifyAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!auth.verifyAdminPassword((req.body && req.body.currentPassword) || ''))
    return res.status(401).json({ error: 'Current password is incorrect' });
  // ENROLLING OVER AN EXISTING FACTOR IS A CHANGE TO THE FACTOR (maintainer, Sep 21 2026).
  // /2fa/settings and /2fa/disable both demanded a live code; this one did not,
  // and verifyAdminRequest is satisfied by the x-admin-password header alone -
  // no session, no second factor. So anyone holding the password could mint a
  // NEW enrollment secret, confirm it with their own authenticator, and become
  // the second factor: 2FA was decorative against exactly the person it exists
  // to stop, and the new code then satisfied requireSensitive too.
  if (auth.twofaState().enrolled && !auth.verifyAnySecond((req.body && req.body.code) || '')) {
    try { require('./services/db').adminLog('2FA_REPLACE_REFUSED', `IP: ${auth.getClientIp(req)}`); } catch {}
    return res.status(401).json({ error: 'Enter a current authenticator code to replace two-factor authentication', stepUpRequired: true });
  }
  res.json(Object.assign({ ok: true }, auth.beginTwofaEnroll()));
});
app.post('/api/auth/2fa/confirm', (req, res) => {
  const auth = require('./services/auth');
  if (!auth.verifyAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  const out = auth.confirmTwofaEnroll((req.body && req.body.code) || '');
  if (!out.ok) return res.status(400).json(out);
  res.json(out);
});
app.post('/api/auth/2fa/settings', (req, res) => {
  const auth = require('./services/auth');
  if (!auth.verifyAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!auth.verifyAdminPassword((req.body && req.body.currentPassword) || ''))
    return res.status(401).json({ error: 'Current password is incorrect' });
  if (!auth.verifyAnySecond((req.body && req.body.code) || ''))
    return res.status(401).json({ error: 'Enter a current authenticator code to change these switches' });
  const out = auth.setTwofaToggles(req.body || {});
  if (!out.ok) return res.status(400).json(out);
  require('./services/db').adminLog('2FA_SETTINGS', JSON.stringify(out.state));
  res.json(out);
});
app.post('/api/auth/2fa/disable', (req, res) => {
  const auth = require('./services/auth');
  if (!auth.verifyAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!auth.verifyAdminPassword((req.body && req.body.currentPassword) || ''))
    return res.status(401).json({ error: 'Current password is incorrect' });
  if (!auth.verifyAnySecond((req.body && req.body.code) || ''))
    return res.status(401).json({ error: 'Enter a current authenticator code to turn 2FA off' });
  auth.disableTwofa();
  res.json({ ok: true });
});
app.get('/api/auth/2fa/state', (req, res) => {
  const auth = require('./services/auth');
  if (!auth.verifyAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json(auth.twofaState());
});
app.post('/api/auth/2fa/step-up', (req, res) => {
  const auth = require('./services/auth');
  if (!auth.verifyAnySecond((req.body && req.body.code) || ''))
    return res.status(401).json({ error: 'That code did not match' });
  if (!auth.grantStepUp(req)) return res.status(401).json({ error: 'Sign in first' });
  res.json({ ok: true, minutes: 15 });
});

// The wizard can query state through the first-run loopback guard.
app.get('/api/auth/setup/state', (req, res) => {
  const completed = require('./services/auth').setupComplete();
  res.set('Cache-Control', 'no-store');
  res.json({ local: true, setup_complete: completed, lan_ready: completed && !req.app.locals.setupLoopbackOnly });
});
app.get('/coming-soon',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'coming-soon.html')));

// ── /staff: the staff surface (LAN-only, staffed facilities only) ────────────
// Tunnel traffic (Cloudflare headers) gets the facility-network-only page —
// same detection as the /setup gate. Unstaffed facilities have no staff
// surface at all (absent, not disabled).
// ── STAFF PWA: manifest + owner icon (surface installs to phone home screens) ─
require('./services/staffpwa').ensureStaffIcon();
app.get('/staff-manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(require('./services/staffpwa').manifest());
});
app.post('/api/staff-icon', require('./services/staff').requireAdminOnly, (req, res) => {
  try {
    const out = require('./services/staffpwa').saveStaffIcon(req.body && req.body.data);
    require('./services/db').adminLog('STAFF_ICON_SET', out.bytes + ' bytes');
    res.json({ ok: true, bytes: out.bytes, v: require('./services/staffpwa').iconVersion() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/staff', (req, res) => {
  const viaTunnel = !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
  // staff.allowRemote (config, DEFAULT OFF): a TEMPORARY owner switch to let the
  // real staff page load over the public domain - for demos/testing only. Ships
  // OFF so a delivered unit is LAN-only. Flip off before shipping.
  const allowRemote = !!require('./services/config').getConfig().staffRemoteAccess;
  // the assistant's server view (Oct 20 2026): the signed-in owner sees the counter's menu as a server will -
  // from anywhere, and before the pad is in use (building the menu comes first); read-only, so nothing else of the pad opens
  const serverView = !!req.query && req.query.frame === '1' && req.query.view === 'menu' && require('./services/auth').verifyAdminRequest(req);
  if (viaTunnel && !allowRemote && !serverView) return res.sendFile(path.join(__dirname, 'public', 'staff-offsite.html'));
  const cfg = require('./services/config').getConfig();
  if (!serverView && !require('./services/staff').surfaceEnabled()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'staff.html'));
});

// ── CloudPRNT: Star printers poll here for jobs (LAN-first, token = auth) ────
// Protocol per Star CloudPRNT Guide (verified Aug 2026): printer POSTs status
// polls; server answers { jobReady, mediaTypes }; printer GETs the job body
// with ?type=<chosen mediaType>&token=...; printer confirms with DELETE.
app.post('/api/cloudprnt/:ptoken', (req, res) => {
  const { printerByToken } = require('./services/printing');
  const p = printerByToken(req.params.ptoken);
  if (!p) return res.status(404).json({ jobReady: false });
  const job = require('./services/db').db.prepare(
    `SELECT id FROM print_jobs WHERE printer_id=? AND status='queued' ORDER BY id LIMIT 1`).get(p.id);
  res.json(job ? { jobReady: true, mediaTypes: ['text/plain'], jobToken: String(job.id), deleteMethod: 'DELETE' }
               : { jobReady: false });
});
app.get('/api/cloudprnt/:ptoken', (req, res) => {
  const { printerByToken } = require('./services/printing');
  const p = printerByToken(req.params.ptoken);
  if (!p) return res.status(404).end();
  const db2 = require('./services/db').db;
  const tok = req.query.token;
  const job = tok
    ? db2.prepare(`SELECT * FROM print_jobs WHERE id=? AND printer_id=? AND status IN ('queued','fetched')`).get(parseInt(tok), p.id)
    : db2.prepare(`SELECT * FROM print_jobs WHERE printer_id=? AND status='queued' ORDER BY id LIMIT 1`).get(p.id);
  if (!job) return res.status(404).end();
  db2.prepare(`UPDATE print_jobs SET status='fetched' WHERE id=?`).run(job.id);
  // Star CloudPRNT: drawer kick for text/plain jobs is requested via the
  // GET response header (X-Star-CashDrawer: start|end) per the Star
  // CloudPRNT Developer Guide — device commands can't embed in text/plain.
  if (job.drawer) res.set('X-Star-CashDrawer', 'start');
  res.type('text/plain').send(job.body);
});
app.delete('/api/cloudprnt/:ptoken', (req, res) => {
  const { printerByToken } = require('./services/printing');
  const p = printerByToken(req.params.ptoken);
  if (!p) return res.status(404).end();
  const db2 = require('./services/db').db;
  const tok = parseInt(req.query.token || '0');
  const job = tok
    ? db2.prepare(`SELECT id FROM print_jobs WHERE id=? AND printer_id=?`).get(tok, p.id)
    : db2.prepare(`SELECT id FROM print_jobs WHERE printer_id=? AND status='fetched' ORDER BY id LIMIT 1`).get(p.id);
  if (job) db2.prepare(`UPDATE print_jobs SET status='done', done_at=datetime('now') WHERE id=?`).run(job.id);
  res.status(200).end();
});
app.get('/api/content/how-it-works', (req, res) => {
  const cfg = getConfig();
  res.json({ steps: cfg.content?.howItWorks || [] });
});
app.get('/how-it-works',   serveTemplated('how-it-works.html'));
app.get('/kiosk',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'kiosk.html')));
app.get('/my-booking', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-booking.html')));
app.get('/my-membership', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-membership.html')));
app.get('/memberships', serveTemplated('memberships.html'));
app.get('/gift-cards', serveTemplated('gift-cards.html'));
reach.mount(app, '/api/memberships', require('./routes/memberships'));
reach.mount(app, '/api/gifts', require('./routes/gifts'));
reach.mount(app, '/api/pos', require('./routes/pos'));
reach.mount(app, '/api/staff', require('./routes/staff'));
// ── /me: the employee app (Sep 2026) - the ANYWHERE lane ────────────────────
// Served over the tunnel on purpose: an employee checks a schedule from home.
// The page can only view and request; nothing behind /api/me operates the
// facility (services/staff.js requireAnyStaff). Off when scheduling is off.
reach.mount(app, '/api/me', require('./routes/me'));
app.get('/me', (req, res) => {
  const cfg = require('./services/config').getConfig();
  if (!(cfg.scheduling && cfg.scheduling.enabled) || !require('./services/staff').surfaceEnabled()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'me.html'));
});
app.get('/me-manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  const m = require('./services/staffpwa').manifest();
  const cfg = require('./services/config').getConfig();
  res.json(Object.assign({}, m, {
    name: ((cfg.server && cfg.server.businessName) ? cfg.server.businessName + ' ' : '') + 'My Shifts',
    short_name: 'My Shifts',
    description: 'Your schedule, hours and requests.',
    start_url: '/me', scope: '/me'
  }));
});
app.get('/sms-terms', serveTemplated('sms-terms.html'));
app.get('/privacy',   serveTemplated('privacy.html'));

// ── SESSION STATUS (for simulator PC monitor) ─────────────────────────────────
app.get('/api/session/status', (req, res) => {
  const { bay } = req.query;
  if (!bay) return res.json({ active: false });
  try { require('./services/baypresence').note(bay, req.query.guard); } catch {}   // the bay's PC is up and asking (Wake-on-LAN's check reads it), and whether its reserved screen is up
  const { db } = require('./services/db');

  // Day-aware: reason on an absolute minute timeline (same approach as the
  // scheduler) so sessions crossing midnight stay visible to the bay monitor.
  const pad = n => String(n).padStart(2, '0');
  const toMins = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const dayIndex = ds => { const [y, m, d] = ds.split('-').map(Number); return Math.floor(new Date(y, m - 1, d).getTime() / 86400000); };
  const absOf = (dateStr, timeStr) => dayIndex(dateStr) * 1440 + toMins(timeStr);

  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const yd = new Date(now); yd.setDate(yd.getDate() - 1);
  const yesterday = `${yd.getFullYear()}-${pad(yd.getMonth() + 1)}-${pad(yd.getDate())}`;
  const td = new Date(now); td.setDate(td.getDate() + 1);
  const tomorrow = `${td.getFullYear()}-${pad(td.getMonth() + 1)}-${pad(td.getDate())}`;
  const nowAbs = dayIndex(today) * 1440 + now.getHours() * 60 + now.getMinutes();

  // Pull candidates: anything starting today or yesterday, or ending today
  // (a session that began last night and crosses midnight).
  const rows = db.prepare(
    `SELECT id, start_time, end_time, date, end_date, booking_type FROM bookings
     WHERE (bay_id = ? OR whole_facility = 1)
       AND status = 'active' AND (date = ? OR date = ? OR date = ? OR end_date = ?)`
  ).all(bay, today, yesterday, tomorrow, today);
  // WHOLE-FACILITY (Aug 20): a stamped booking owns EVERY bay, so every
  // bay's monitor must see it - warnings fire and reserved screens lift on
  // both bays for the one booking. Same stamp rule as THE TRUNK.
  // tomorrow joins the pull (Aug 13): a late-night gap whose next group sits
  // past midnight used to lose its next-pointer, blinding the unblank timer.

  const withAbs = rows.map(b => ({
    ...b,
    absStart: absOf(b.date, b.start_time),
    absEnd:   absOf(b.end_date || b.date, b.end_time)
  }));

  // A MAINTENANCE BLOCK IS NOT A SESSION (Oct 3 2026, the inventory): the bay is out of service, nobody is playing,
  // and the scheduler drives nothing for it - but the screen took it for one, lifted the reserved screen and offered
  // "add more time" near its end. It still counts as the NEXT booking below, so no time is offered into a block.
  // Events and tournaments are people playing, and stay sessions.
  const active = withAbs.find(b => b.booking_type !== 'maintenance' && b.absStart <= nowAbs && nowAbs < b.absEnd) || null;

  // Next upcoming booking after the reference point (end of active session, or now).
  const refAbs = active ? active.absEnd : nowAbs;
  const next = withAbs
    .filter(b => b.absStart >= refAbs)
    .sort((a, b) => a.absStart - b.absStart)[0] || null;
  const minsUntilNext = next ? next.absStart - nowAbs : null;

  const cfg = require('./services/config').getConfig();
  const warnMins = cfg.monitor?.warnMins || 10;   // shutdown.warningMinsBefore is dead (Aug 13)

  if (!active) {
    return res.json({
      active: false,
      nextStart:    next?.start_time || null,
      minsUntilNext
    });
  }

  // EVERY KEY IN BOTH REPLIES IS READ BY A MACHINE THAT IS NOT IN THIS TREE (maintainer,
  // Sep 23 2026) - the watcher on each bay PC. Each one is declared, with its
  // readers and its reason, in services/reach.js REPLY_KEYS, and
  // test-outside-readers fails if one goes missing. Never remove a key here
  // because nothing in this repo reads it: that is how pilot facility's bays stopped
  // offering customers more time.
  // "BOOKED NEXT" MEANS BOOKED RIGHT AFTER (maintainer, Oct 2 2026: "if someone has a tee time from 1-3 then there
  // is a slot even a 30 min one at 3-3:30 the qr code for more time comes up and offers more time ... If they
  // have 10 min left and the next tee time is at 3 then 10 min before they get a wrap up message"). hasNext
  // used to be true for ANY later booking - tonight's 7:00 or tomorrow's 9:00 - so a group whose next half
  // hour was free was told to wrap up and never offered more time. It is true now only when the next tee time
  // starts before a 30-minute session could fit after this one; nextStart and minsUntilNext are unchanged.
  // The watcher on every bay PC reads it as it always has, so this needs no watcher rebuild.
  // AND NOT AT CLOSING (Oct 3 2026, the pack review): the last group of the night - their next booking
  // tomorrow - was offered more time the booking page cannot sell. The offer now shows only when the
  // facility's minimum session would fit right after this one: before the next tee time, and - unless the
  // facility is open around the clock - starting at or after opening and ending by closing, the bounds the
  // create route enforces (routes/bookings.js). Otherwise the group is asked to wrap up.
  // The one rule, shared with the 15-minute text (services/bookingcore.js moreTimeFits).
  const canAddTime = require('./services/bookingcore').moreTimeFits(cfg, active.end_time, next ? next.absStart - active.absEnd : null, active.date);
  const bookedRightAfter = !canAddTime;
  res.json({
    active:       true,
    bookingId:    active.id,
    minsLeft:     active.absEnd - nowAbs,
    hasNext:      bookedRightAfter,
    endTime:      active.end_time,
    warnMins,
    nextStart:    next?.start_time || null,
    minsUntilNext
  });
});

// ── THE ONE ERROR ANSWER (Sep 25 2026) ───────────────────────────────────────
// Last in the chain, so every error any handler throws, rejects or passes on lands
// here. JSON, never HTML; never a stack, an internal message or a path. A 4xx carries
// its message only when the error says it is meant for the caller (err.expose - a
// body the parser could not read); an upload too large is 413 "File too large"
// (pilot facility answered 500 for it). A 5xx is a fault in this product: it goes to the
// owner's log with the route, where somebody can find it.
const requestErrorSeen = new Map();   // route -> { at, more } for the owner's-log line above
// The full pattern of the route that failed - its router's mount prefix and its own pattern
// ('/api/waivers/signed/quarter/:year/:q'). At this point req.path is the whole path again and
// req.route the inner route, so the prefix is the path less as many segments as the pattern has.
function routePattern(req) {
  const full = String(req.path || '');
  const pat = req.route && typeof req.route.path === 'string' ? req.route.path : '';
  if (!pat || pat === '/') return full;
  const n = pat.split('/').filter(Boolean).length, segs = full.split('/').filter(Boolean);
  return (segs.length >= n ? '/' + segs.slice(0, segs.length - n).join('/') : '').replace(/\/$/, '') + pat;
}
app.use((err, req, res, next) => {
  const raw = Number(err && (err.status || err.statusCode));
  let code = raw >= 400 && raw < 600 ? raw : 500;
  if (err && err.code === 'LIMIT_FILE_SIZE') code = 413;
  if (/^\/api\/admin\/owner-chat\/hosted(?:\/|$)/i.test(req.path)) {
    // Parser errors can quote raw input. This path carries credentials and private prompts.
    if (res.headersSent) return res.end();
    return res.set('Cache-Control', 'no-store').status(code).json({
      error: code === 413 ? 'The hosted AI request is too large.' : 'The hosted AI request could not be read.'
    });
  }
  try { console.error('REQUEST ERROR', req.method, String(req.path || '').slice(0, 120), code, err && err.message); } catch {}
  if (code >= 500) {
    // one line per route per ten minutes, with how many it stood for (Sep 25 2026, the
    // Monday review): a caller who can make a route fail must not be able to fill the
    // owner's log - and the database - one request at a time
    const k = req.method + ' ' + routePattern(req).slice(0, 100), seen = requestErrorSeen.get(k);   // the route's pattern, so /x/1, /x/2 ... are one route
    if (seen && Date.now() - seen.at < 600000) seen.more++;
    else {
      if (requestErrorSeen.size > 500) requestErrorSeen.clear();
      requestErrorSeen.set(k, { at: Date.now(), more: 0 });
      try { require('./services/db').adminLog('REQUEST_ERROR', `${k} | ${String((err && err.message) || err).slice(0, 160)}` + (seen && seen.more ? ` | and ${seen.more} more on this route in the ten minutes before` : '')); } catch {}
    }
  }
  if (res.headersSent) { try { res.end(); } catch {} return; }
  const error = code === 413 ? (err && err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : 'That was more than this unit accepts in one request')
    : code < 500 ? ((err && err.expose && err.message) ? String(err.message).slice(0, 200) : 'The request could not be read.')
    : 'Something went wrong on this unit and the request did not finish. Try again, and if it keeps happening tell the facility.';
  res.status(code).json({ error });
});

// ── START ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  require('./services/db').claimWriter();   // W40: this process is THE writer - the tick and the exit flush are its safety net
  require('./services/schema').ensureServiceSchemas();   // W44: ONE list, also run after a restore

  // the facility's own zone before anything reads the clock (services/timezone.js, Oct 3 2026)
  try { require('./services/timezone').ensureConfiguredZone('at start', (ev, d) => require('./services/db').adminLog(ev, d)); } catch (e) {}

  const cfg  = getConfig();
  const PORT = cfg.server.port || 3000;

  // THE PRODUCT PUBLISHES WHAT IT ACTUALLY MOUNTED (maintainer, Sep 21 2026). test-reach
  // grades THIS, not a list it re-derives for itself - a battery that builds its
  // own idea of the route table can only ever agree with its author.
  if (process.env.BA_REACH_DUMP) {
    try { require('fs').writeFileSync('/tmp/ba-reach-registry.json', JSON.stringify(reach.routes(app))); } catch (e) {}
  }
  app.locals.setupLoopbackOnly = !cfg.setup?.completed;
  const host = app.locals.setupLoopbackOnly ? '127.0.0.1' : '0.0.0.0';
  const httpServer = app.listen(PORT, host, () => {
    // a frozen unit restarts itself (services/watchdog.js, maintainer Oct 8 2026: no downtime that cannot be fixed remotely)
    require('./services/watchdog').start(PORT);
    if (process.env.BA_TEST_DEAF_AFTER_MS) setTimeout(() => httpServer.close(), Number(process.env.BA_TEST_DEAF_AFTER_MS));   // test-watchdog only
    console.log('\n  ⛳  Booking System — Server');
    console.log('  ──────────────────────────────────────────');
    console.log(`  Customer:   http://localhost:${PORT}`);
    console.log(`  My Booking: http://localhost:${PORT}/my-booking`);
    console.log(`  Admin:      http://localhost:${PORT}/admin`);
    console.log(`  Kiosk:      http://localhost:${PORT}/kiosk`);
    console.log(`  Business:   ${cfg.server.businessName}`);
    console.log(`  Bays:       ${(cfg.bays||[]).map(b=>b.name).join(', ')}`);
    console.log(`  Twilio:     ${cfg.twilio.phoneNumber ? 'Configured' : 'Not configured'}`);
    console.log(`  Stripe:     ${cfg.stripe.secretKey?.startsWith('sk_live') ? '✅ LIVE' : cfg.stripe.secretKey?.startsWith('sk_test') ? '🧪 TEST' : '⚠ Not configured'}`);
    console.log('  ──────────────────────────────────────────\n');
  });

  // BA_DISABLE_SCHEDULER=1 is for test-unit-health ONLY (the dead-checker proof): a unit that boots
  // without its scheduler must read RED on the health line, never green
  if (process.env.BA_DISABLE_SCHEDULER === '1') console.log('Scheduler DISABLED by BA_DISABLE_SCHEDULER (a battery)'); else startScheduler();
}

start().catch(err => {
  console.error('❌ Failed to start:', err.message);
  process.exit(1);
});
