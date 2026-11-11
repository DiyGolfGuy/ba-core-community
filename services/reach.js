// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// services/reach.js - WHO CAN REACH THIS ROUTE, DECLARED (maintainer, Sep 21 2026)
//
// The product already knew how to refuse tunnel traffic - staff sign-in has
// done it correctly for weeks - but that check lived on three paths out of 368
// and every other route was reachable from the open internet because nobody
// had said otherwise. That is how `/api/setup/complete` ended up answering the
// world: not because anyone decided it should, but because reach was something
// three routes REMEMBERED rather than something every route DECLARED.
//
// So reach is a property now, and the default is NO.
//
//   public        anyone, from anywhere. The booking grid, the website, the
//                 pages a customer must reach before they have any credential.
//   owner         reachable from anywhere, because an owner runs their facility
//                 from their phone and applies packs from wherever they are -
//                 the ROUTE'S OWN auth is the gate, and reach does not second
//                 guess it. Declaring `owner` is also a claim that the route
//                 HAS an auth guard, which test-reach checks.
//   lan           the facility's own network only, no exemption for anybody.
//                 Setup, restore and recovery internals: things that rebuild
//                 the unit and must never be reachable across the internet
//                 even with a correct password.
//   lanOrOwner    the facility's network, OR an authenticated owner. Staff
//                 codes and the pad live here: staff sign in on the premises,
//                 while the owner manages the roster from the admin console
//                 wherever they are. The owner's existing staffRemoteAccess
//                 switch still opens it to staff remotely when they choose.
//
// REACH IS NOT AUTHENTICATION. It answers "may this caller knock", never "may
// this caller do it". Every route keeps the guard it already had.
'use strict';

const CLASSES = ['public', 'owner', 'lan', 'lanOrOwner'];

// Declared by MOUNT PREFIX, longest match wins, with per-route overrides below.
// A prefix that is not here at all is REFUSED - that is the deny-by-default,
// and test-reach fails the moment the tree mounts something this map has not
// heard of, naming it.
const PREFIXES = {
  // ── the customer's own surface ──────────────────────────────────────────
  '/api/bookings':     'public',   // the grid, the quote, checkout, confirm
  '/api/customer':     'public',   // a customer finding their own booking by PIN
  '/api/pricing':      'public',   // the quote and code validation (writes check isAdmin)
  '/api/memberships':  'public',   // the tiers page, joining online, the member portal
  '/api/members':      'public',   // validate-pin and the portal; the admin routes check requireAdmin
  '/api/waivers':      'public',   // the document a customer must read and sign
  '/api/gifts':        'public',   // buying and redeeming a gift card
  '/api/website':      'public',   // GET is the public site; every write is requireSensitive
  '/api/uploads':      'public',   // GET logo/hero are the site's own images; writes check isAdmin
  '/api/content':      'public',
  '/api/contact':      'public',
  '/api/seo':          'public',
  '/api/theme':        'public',
  '/api/time':         'public',
  '/api/announcement': 'public',
  '/api/booking-rules':'public',
  '/api/session':      'public',
  '/api/stripe':       'public',   // Stripe's own webhook, from Stripe's network; verifies its signature
  '/api/twilio':       'public',   // the carrier's inbound webhook; verifies its signature
  '/api/cloudprnt':    'public',   // the counter printer polls this with its own token in the path

  // ── the owner, from anywhere ────────────────────────────────────────────
  '/api/admin':        'owner',    // an owner runs the facility and applies packs from wherever they are
  '/api/auth':         'owner',    // signing in has to work from anywhere
  '/api/terminal':     'owner',    // the card reader's settings and its webhook
  '/api/me':           'owner',    // the employee shift app on a phone, off-premises: maintainer's ruling Sep 21 2026 - stays reachable from home; requireAnyStaff is the gate
  '/api/backup':       'owner',    // the off-site pull, gated by a 64-char token
  '/api/calendar':     'owner',    // the owner's private calendar link (Oct 19 2026), gated by its 43-char key - Google, Apple and Outlook read it over the tunnel

  // ── the facility's own network ──────────────────────────────────────────
  '/api/setup':        'lan',      // the wizard rebuilds the unit: never from the internet
  '/api/simulator':    'lan',      // bay PC status: a LAN-only diagnostic

  // ── the premises, or the owner ──────────────────────────────────────────
  // /api/staff ALREADY behaves exactly this way (routes/staff.js has refused
  // tunnel traffic for weeks unless the caller is the owner or the owner has
  // turned staffRemoteAccess on), so declaring it changes nothing - it just
  // writes down what the code already does, where the next person will look.
  '/api/staff':        'lanOrOwner',
  // THE COUNTER PAD'S API IS PREMISES-ONLY (maintainer's ruling, Sep 21 2026). Tabs,
  // orders, payments at the counter, the drawer and end-of-day are things a
  // person does standing in the building, so a pad on cellular reaching the
  // unit through the tunnel is refused here before any route runs. The same
  // class as /api/staff - the pad's other calls - so the pad behaves as one
  // thing: the premises, the owner's own switch (staffRemoteAccess), or the
  // signed-in owner. The owner is let through because the ADMIN CONSOLE lives
  // under this prefix too (the F&B menu editor, the review card, tax codes,
  // end-of-day are all /api/pos/... calls from admin.html) and an owner edits
  // the menu from home; a plain 'lan' would have locked them out of it, which
  // is the one thing a reach change must never do.
  '/api/pos':          'lanOrOwner',
};

// WHAT REACH DELIBERATELY LEAVES REACHABLE. /api/me - the employee shift app -
// is served over the tunnel with no restriction and people use it from their
// phones off-premises. maintainer's ruling (Sep 21 2026): it stays reachable from
// home, clock-in included, as it is today; staff.requireAnyStaff is the gate.
// If someone later declares it lan or lanOrOwner, test-reach 3m fails and the
// change has to be a decision rather than a tidy-looking edit.


// Per-route overrides, for the handful that differ from their prefix.
const ROUTES = {
  // The owner setting the staff app's icon from the admin console. It is NOT
  // under /api/staff (different path, so it does not inherit lanOrOwner) and it
  // must not be: the owner uploads it from wherever they are, and
  // staff.requireAdminOnly is the gate. Found by deny-by-default on the first
  // run of test-reach, which is the entire point of deny-by-default.
  '/api/staff-icon': 'owner',
};

// ── WHAT A DEVICE IS TOLD, AND WHY EACH KEY IS THERE (maintainer, Sep 23 2026) ──────
// pilot facility's security pass took bookingId out of a public reply because nothing in
// its repo read it. Something did: the watcher on every bay PC, which offers the
// customer more time once per booking with `warning_shown_for != booking_id`,
// starting from None. With the key gone that reads None != None - False - and
// both bays quietly stopped offering more time. Nothing failed; the popup just
// never came.
//
// maintainer's ruling, the same as pilot facility's: A DEVICE'S FEATURE OUTRANKS AN OUTSIDE-SURFACE
// TRIM. A reply that a machine off the unit reads is declared here key by key,
// with its readers and the reason, so the next audit finds the reason beside the
// field instead of deciding from a grep of this tree. The readers live on other
// machines and some are not in this tree at all (the bay PC watcher was built in
// a chat), so "nothing here reads it" is never evidence. What a key opens on
// ANOTHER route is a question for that route, never a reason to take the key
// away from the device. test-outside-readers fails when a reply is missing a key
// a reader reads, when a reply carries a key with no reason written here, and
// when a reader's path is not reachable from where that reader sits.
const REPLY_KEYS = {
  'GET /api/session/status': {
    readers: [
      'the bay PC watcher - built in a chat, runs on every bay PC, NOT in this tree. Reads bookingId, minsLeft, hasNext, active, warnMins, minsUntilNext, nextStart (recorded from maintainer, Sep 23 2026).',
      'templates/session-monitor.py.template - filled per bay by services/monitor-builder.js. Since Sep 25 2026 its SERVER_URL is the unit\'s LAN address and its FALLBACK_URL the domain (asked only when the LAN address does not answer); watchers built before then call the domain, so this route must answer over the tunnel as well.',
    ],
    keys: {
      active:        'Both readers branch on it: true means a session is running (the end-of-session warning and the offer of more time), false means the bay is idle (the reserved-screen timing).',
      bookingId:     'The once-per-booking guard. The watcher pops its offer when `mins_left <= warn_mins and mins_left > 0 and warning_shown_for != booking_id`, with warning_shown_for starting at None; the template keys its warning the same way. Without this key the offer NEVER shows - pilot facility\'s bays, Sep 22 2026.',
      minsLeft:      'Minutes until the running session ends. Both readers compare it with warnMins to decide when the warning and the offer of more time appear.',
      warnMins:      'The owner\'s warning lead time (cfg.monitor.warnMins), served live so a change in Settings reaches every bay PC without rebuilding its script. The watcher\'s popup condition reads it.',
      hasNext:       'Whether NO more time can be booked right after this session: the next tee time starts before the facility\'s minimum session could fit (maintainer, Oct 2 2026; it used to be any later booking), or the facility closes first (Oct 3 2026). Chooses the end-of-session message: wrap up when nothing can be added, the offer of more time when a session can be booked.',
      minsUntilNext: 'Minutes until the next booking on this bay. When idle, the bay PC puts up or lifts the reserved screen on it.',
      nextStart:     'The next booking\'s start time, shown on the reserved screen when the bay is idle.',
      endTime:       'The running session\'s end time. Neither known reader reads it today; it has been in this reply since before the baseline and a bay PC set up by hand may read it. Removing a key from a device\'s reply is how pilot facility\'s bays broke - remove it only on maintainer\'s word.',
    },
  },
  // THE BAY PC'S ROUTINES (Oct 21 2026; routes/routines.js, services/routines.js). The watcher asks with its own
  // bay key (x-bay-key, minted when its package is built) and gets a 401 and nothing else without it; a watcher built before
  // this, or set up by hand, never calls these.
  'GET /api/session/routines': {
    readers: ['templates/session-monitor.py.template - its teach mode and routine runner (watchers built from Oct 21 2026 on the BA Core 2 AI branch). The watcher built in a chat is NOT in this tree and never calls this route.'],
    keys: {
      ok:       'true with the bay key; a watcher reads nothing else from a refusal and tries again on its next poll.',
      teach:    'A teaching the owner started on this bay ({id, name}, and program when it only shows the PC a program - Oct 21 2026, night) or null: the watcher puts up its teaching bar (for a program, what to open) and records the owner\'s clicks until Ctrl+Shift+F11.',
      routines: 'This bay\'s routines ({id, name, steps, hotkey}): the watcher registers each hotkey, and runs the steps when asked.',
      run:      'The oldest run waiting for this bay ({id, routine_id}) or null - claimed by this answer, so it runs once.',
    },
  },
  'POST /api/session/routines/recording': {
    readers: ['templates/session-monitor.py.template - sends the steps it recorded when the owner ends teaching.'],
    keys: {
      ok:    'Whether the unit kept the steps as a draft for the owner to save; the watcher says so on its teaching bar.',
      steps: 'How many steps the unit kept, said on the teaching bar.',
      stopped: 'The unit took a teaching stopped on the PC (Ctrl+Shift+F10, or nothing done) and stopped waiting for it.',
      error: 'Why the unit refused them (no teaching waiting, a step out of bounds), said on the teaching bar.',
      say:   'The unit\'s own last words for the teaching bar (Oct 21 2026, night: a program shown to the PC - "Taught on this PC: GSPro"); a watcher without it says its own.',
      program: 'The teaching only showed the PC a program: nothing was kept as a routine.',
      opened:  'The programs opened while that bar was up - on the PC\'s own list now.',
    },
  },
  'POST /api/session/routines/result': {
    readers: ['templates/session-monitor.py.template - reports how a run went, once, after the last step or the step that stopped it.'],
    keys: {
      ok:      'Whether the unit recorded the result; the watcher sends it again on its next poll until it is.',
      already: 'The run was finished already (it waited too long, or was reported twice): the watcher stops sending it.',
      error:   'No such run on this bay: the watcher drops it.',
    },
  },
};

// Pages are served to browsers, not called by machines. They are declared so
// the battery can see them, and the two that already gate themselves keep doing
// so in their own handlers (/setup is pre-setup only, /staff shows the offsite
// card over the tunnel).
const PAGES_PUBLIC = true;

/** Longest-prefix lookup. Returns a class name, or null when nothing declares it. */
function classFor(pathname) {
  const p = String(pathname || '').split('?')[0];
  if (ROUTES[p]) return ROUTES[p];
  let best = null, bestLen = -1;
  for (const pre of Object.keys(PREFIXES)) {
    if ((p === pre || p.startsWith(pre + '/')) && pre.length > bestLen) { best = PREFIXES[pre]; bestLen = pre.length; }
  }
  return best;
}

function viaTunnel(req) {
  return !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
}

/** The gate. Reach only - every route keeps its own auth behind this. */
function gate(req, res, next) {
  const p = req.path;
  if (!p.startsWith('/api/')) return next();          // pages and static are not API reach
  const cls = classFor(p);
  const tunnelled = viaTunnel(req);

  const refuse = (why) => {
    try {
      const ip = require('./auth').getClientIp(req);
      noteRefusal(ip, `${why} | ${req.method} ${p} | IP: ${ip}`);
    } catch {}
    return res.status(403).json({ error: 'Not available from here.' });
  };

  if (!cls) return refuse('no reach is declared for this path');   // deny by default
  if (!tunnelled) return next();                                   // on the premises: reach never refuses
  if (cls === 'public' || cls === 'owner') return next();
  if (cls === 'lan') return refuse('declared lan, reached over the tunnel');
  if (cls === 'lanOrOwner') {
    try { if (require('./auth').verifyAdminRequest(req)) return next(); } catch {}
    try { if (require('./config').getConfig().staffRemoteAccess) return next(); } catch {}
    return refuse('declared lanOrOwner, reached over the tunnel by neither the owner nor with staffRemoteAccess on');
  }
  return refuse('unknown reach class ' + cls);
}

// One row per caller per hour, so a scanner cannot bury the owner's log.
const _refusals = new Map();
function noteRefusal(ip, detail) {
  const now = Date.now(), last = _refusals.get(ip) || 0;
  if (now - last < 60 * 60 * 1000) return;
  _refusals.set(ip, now);
  if (_refusals.size > 500) { for (const [k, v] of _refusals) if (now - v > 60 * 60 * 1000) _refusals.delete(k); }
  try { require('./db').adminLog('REACH_REFUSED', detail); } catch {}
}

// ── the registry: mount() records the prefix so nothing has to be recovered
// from an Express layer regexp (which is lossy - it yields /api for /api/x). ──
const MOUNTED = [];
function mount(app, prefix, ...handlers) {
  MOUNTED.push({ prefix, router: handlers[handlers.length - 1] });
  return app.use(prefix, ...handlers);
}

/** Every route the app really has: routers through mount(), plus app-level ones. */
function routes(app) {
  const out = [];
  for (const m of MOUNTED) {
    const stack = (m.router && m.router.stack) || [];
    for (const l of stack) {
      if (!l.route) continue;
      for (const meth of Object.keys(l.route.methods)) {
        if (l.route.methods[meth]) out.push({ method: meth.toUpperCase(), path: (m.prefix + l.route.path).replace(/\/$/, '') || m.prefix, via: 'router' });
      }
    }
  }
  const top = (app._router || app.router || {}).stack || [];
  for (const l of top) {
    if (!l.route) continue;
    for (const meth of Object.keys(l.route.methods)) {
      if (l.route.methods[meth]) out.push({ method: meth.toUpperCase(), path: l.route.path, via: 'app' });
    }
  }
  return out;
}

module.exports = { CLASSES, PREFIXES, ROUTES, REPLY_KEYS, classFor, gate, mount, routes, viaTunnel, PAGES_PUBLIC };
