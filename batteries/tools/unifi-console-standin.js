// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  tools/unifi-console-standin.js  —  ONE UniFi Access console stand-in
//
//  Rule 29's battery clause and rule 27's stand-in reader, applied to the one
//  integration the bench cannot own. Until Sep 16 2026 there were TWO hand-made
//  stand-in consoles (test-unifi-access.js and test-unifi-restart.js) and between
//  them they could emit exactly TWO non-success states: a 400 when a PIN was not
//  four digits, and a bare 404 on an unmatched route. Every other route answered
//  HTTP 200 `{code:'SUCCESS'}` unconditionally - it never read the token, never
//  refused a duplicate PIN, never rejected a door id it had not issued, never
//  timed out, never returned 429 and never returned a body it could not parse.
//
//  So every UniFi assertion in the suite was a tautology: the console agreed with
//  whatever we sent it. That is exactly the failure maintainer named twice (the lock
//  stand-in that threw where the product resolves; the plug and PC stand-ins that
//  answered yes in the scenario named for a facility that owns neither).
//
//  WHAT THE REAL CONSOLE DOES, and therefore what this must be able to do
//  (UniFi Access API Reference v4.2.16, maintainer's copy - it wins over anything
//  community; the OpenAPI conversion at github.com/YuDefine/unifi-access-api-openapi
//  agrees on shapes but was generated from the same schema tables, so it is not
//  independent evidence and is never the sole source for a behaviour here):
//    - s2.2 status table: 200 400 401 402 403 429 500 502 503 504.
//    - s2.3/s2.4 envelope: {"code":"SUCCESS","msg":"success","data":…} and
//      {"code":"CODE_PARAMS_INVALID","msg":"Invalid parameters."} - an ERROR can
//      arrive with HTTP 200 and a non-SUCCESS code. Our call() reads both; this
//      stand-in must be able to produce both.
//    - the CODE_* table, incl. CODE_CREDS_PIN_CODE_CREDS_ALREADY_EXIST and
//      CODE_CREDS_PIN_CODE_CREDS_LENGTH_INVALID - the two that decide whether our
//      locally-minted PIN design works at all.
//    - s3.5: `pagination` is a SIBLING of `data`, not a field inside it.
//
//  WHAT IT DELIBERATELY DOES NOT DECIDE. Three shapes are genuinely unsettled
//  from the documentation and need a real console (see the audit, Part 3). This
//  module makes each one a SWITCH rather than picking a side, so a battery can
//  assert our behaviour under both answers and neither the module nor the battery
//  quietly encodes its author's belief:
//    - doorPath:   'flat' (/doors) | 'spaces' (/spaces/doors)
//    - visitorGrantKey: 'resources' | 'resource' | 'both'
//    - visitorListFields: which fields GET /visitors echoes back (the reference's
//      response samples omit remarks/start_time/end_time; its schema table lists
//      them). 'full' | 'documented-response'
//
//  USE:  const { startConsole } = require('./tools/unifi-console-standin');
//        const c = await startConsole({ port: 12445, token: 'tok-123' });
//        c.state / c.faults.set({ ... }) / await c.stop()
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const https = require('https');
const { execFileSync } = require('child_process');

const KEY = '/tmp/unifi-mock.key';
const CRT = '/tmp/unifi-mock.crt';

/** A SECOND self-signed pair, for a battery that needs a different console on the
 *  same address - an impostor, or a console that was replaced. Made fresh each call. */
function otherTls(tag) {
  const k = `/tmp/unifi-mock-${tag}-${process.pid}.key`, c = `/tmp/unifi-mock-${tag}-${process.pid}.crt`;
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', k, '-out', c,
    '-days', '2', '-nodes', '-subj', '/CN=' + tag], { timeout: 60000, stdio: 'ignore' });
  const out = { key: fs.readFileSync(k), cert: fs.readFileSync(c) };
  try { fs.unlinkSync(k); fs.unlinkSync(c); } catch {}
  return out;
}

/** A self-signed pair, made once per machine per two days. Batteries share it. */
function ensureTls() {
  if (fs.existsSync(KEY) && fs.existsSync(CRT)) return { key: fs.readFileSync(KEY), cert: fs.readFileSync(CRT) };
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', KEY, '-out', CRT,
    '-days', '2', '-nodes', '-subj', '/CN=localhost'], { timeout: 60000, stdio: 'ignore' });
  return { key: fs.readFileSync(KEY), cert: fs.readFileSync(CRT) };
}

// The documented error codes this stand-in can produce, with the HTTP status the
// reference pairs them with. A battery names the code, never a bare number.
const CODES = {
  SUCCESS:                                 [200, 'success'],
  CODE_PARAMS_INVALID:                     [400, 'Invalid parameters.'],
  CODE_ACCESS_TOKEN_INVALID:               [401, 'The request lacks a valid API token.'],
  CODE_UNAUTHORIZED:                       [403, 'The API token used does not have the necessary permissions.'],
  CODE_OPERATION_FORBIDDEN:                [403, 'Operation forbidden.'],
  CODE_RESOURCE_NOT_FOUND:                 [404, 'The resource does not exist.'],
  CODE_NOT_EXISTS:                         [404, 'Not exists.'],
  CODE_CREDS_PIN_CODE_CREDS_ALREADY_EXIST: [200, 'The PIN code already exists.'],
  CODE_CREDS_PIN_CODE_CREDS_LENGTH_INVALID:[200, 'The PIN code length does not meet the preset requirements.'],
  CODE_SYSTEM_ERROR:                       [500, 'System error.'],
};

const DEFAULT_FAULTS = {
  // ── authentication ──
  token:        null,   // when set, a request must present it or get 401
  scopes:       null,   // when set, an array; a call needing a scope not in it gets 403
  // ── the three genuinely unsettled shapes (see the header) ──
  doorPath:          'flat',          // 'flat' | 'spaces'
  visitorGrantKey:   'both',          // which key the console READS for a visitor's doors
  visitorListFields: 'full',          // 'full' | 'documented-response'
  // Does PUT MERGE the fields you send, or REPLACE the record with them? No
  // source answers it, so this is a switch and the batteries drive BOTH sides.
  // Under 'replace' a partial update blanks everything it did not send - which
  // for a visitor means its doors. (maintainer, Sep 16 2026: the code must be correct
  // under either reading, so the stand-in must be able to be either.)
  putMode:      'merge',              // 'merge' | 'replace'
  // ── console settings a real one enforces ──
  pinLength:    4,      // 4 | 6 | 8 | 'variable'
  pinUnique:    true,   // refuse a PIN already held by any visitor or user
  scheduleNamesUnique: true,
  // ── transport behaviour ──
  pageSizeCap:  0,      // >0: the console silently returns at most this many rows
  paginationSibling: true,
  slowMs:       0,      // delay every response by this long (our client times out at 8000)
  slowDeleteMs: 0,      // a DELETE is received (counted in deleteStarts) and finishes this much later - a kill mid-delete
  rateLimitAfter: 0,    // >0: every request past this count in the window answers 429
  htmlBody:     false,  // answer HTTP 200 with the UniFi OS login page instead of JSON
  down:         false,  // refuse the connection at the socket
  // ── the member path (Sep 25 2026) ──
  reportsUserAccess: true,   // false: GET /users/:id NEVER carries access_policy_ids, expand[] or not (audit U14/U21, open question 3)
  refuseUserPolicies: false, // true: PUT /users/:id/access_policies answers 403 - access that cannot be turned on
  failNext:     null,   // {code, times} - force the next N answers to this CODE_*
};

function startConsole(opts = {}) {
  const tls = opts.tls || ensureTls();
  const port = opts.port || 12445;

  const state = {
    requests: [],                 // every request, with the auth headers as sent
    visitors: {},                 // id -> the create body, plus pin
    users: {},                    // id -> { body, policies, pin, status }
    policies: {},                 // id -> { name, resources, schedule_id }
    schedules: {},                // id -> name
    doors:  (opts.doors  || [{ id: 'door-front', name: 'Front Door' }, { id: 'door-bay', name: 'Bay Door' }]),
    groups: (opts.groups || [{ id: 'grp-lounge', name: 'Member Lounge' }]),
    seeded: [],                   // visitor rows placed here before the product runs (rule 22)
    deleted: [],
    deleteStarts: 0,
    deletes: 0,          // legacy alias the older batteries read
    counters: { schedulesCreated: 0, usersCreated: 0, visitorsCreated: 0, policiesCreated: 0, requests: 0 },
  };

  const faults = Object.assign({}, DEFAULT_FAULTS, opts.faults || {});
  const setFaults = (o) => Object.assign(faults, o || {});

  /** Every PIN the console currently holds, visitors and users alike. */
  const pinsInUse = () => [
    ...Object.values(state.visitors).map(v => v && v.pin),
    ...Object.values(state.users).map(u => u && u.pin),
  ].filter(Boolean);

  const pinLengthOk = (pin) => faults.pinLength === 'variable'
    ? /^\d{4,8}$/.test(pin)
    : String(pin).length === Number(faults.pinLength);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let served = 0;

  const srv = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
      const rec = {
        method: req.method, url: req.url,
        auth: req.headers.authorization || '', xkey: req.headers['x-api-key'] || '',
        body: parsed, rawBody: body, at: Date.now(),
      };
      state.requests.push(rec);
      state.counters.requests++;
      served++;

      if (faults.slowMs) await sleep(faults.slowMs);

      // ── the envelope. An error may carry HTTP 200; the reference's own
      //    CODE_CREDS_* values do exactly that, which is why call() must read
      //    the body's `code` and not only the status. ──
      const answer = (code, data) => {
        const [status, msg] = CODES[code] || [200, ''];
        res.writeHead(status, { 'Content-Type': 'application/json' });
        const out = { code, msg };
        if (data !== undefined) out.data = data;
        res.end(JSON.stringify(out));
      };
      const page = (rows, pageNum, pageSize) => {
        const cap = faults.pageSizeCap > 0 ? Math.min(pageSize, faults.pageSizeCap) : pageSize;
        const slice = rows.slice((pageNum - 1) * cap, (pageNum - 1) * cap + cap);
        const [status, msg] = CODES.SUCCESS;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        const out = { code: 'SUCCESS', msg, data: slice };
        // s3.5: pagination is a SIBLING of data. The old stand-ins had none at
        // all, which is why listAllVisitors' short-page assumption was invisible.
        if (faults.paginationSibling) out.pagination = { page_num: pageNum, page_size: cap, total: rows.length };
        res.end(JSON.stringify(out));
      };

      // ── transport-level faults, before anything is read ──
      if (faults.htmlBody) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<!doctype html><html><head><title>UniFi OS</title></head><body><div id="app"></div></body></html>');
      }
      if (faults.rateLimitAfter > 0 && served > faults.rateLimitAfter) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 'CODE_LIMITED', msg: 'Too many requests were sent to the API in a short amount of time.' }));
      }
      if (faults.failNext && faults.failNext.times > 0) {
        faults.failNext.times--;
        return answer(faults.failNext.code);
      }

      // ── authentication. The old stand-ins RECORDED these headers and never
      //    read them, so call()'s 401/403 branch had never once executed. ──
      if (faults.token) {
        const bearer = /^Bearer\s+(.*)$/.exec(rec.auth);
        const presented = (bearer && bearer[1]) || rec.xkey || '';
        if (presented !== faults.token) return answer('CODE_ACCESS_TOKEN_INVALID');
      }
      const needScope = (s) => {
        if (!faults.scopes) return false;
        if (faults.scopes.includes(s)) return false;
        answer('CODE_UNAUTHORIZED');
        return true;
      };

      const u = req.url;
      const M = req.method;
      // The path the product actually calls, with the style prefix stripped. The
      // old stand-ins used suffix-anchored regexes (/\/doors$/), which match
      // /doors and /spaces/doors identically - so they could never tell us which
      // one we send. Here the tail is exact.
      const tail = u.replace(/^.*\/api\/v1\/developer/, '').replace(/^.*\/integration\/v1/, '');
      const q = new URL('https://x' + (tail.startsWith('/') ? tail : '/' + tail)).searchParams;
      const bare = tail.replace(/\?.*$/, '');

      const doorsPath  = faults.doorPath === 'spaces' ? '/spaces/doors'       : '/doors';
      const groupsPath = faults.doorPath === 'spaces' ? '/spaces/door_groups' : '/door_groups';

      // ── doors and door groups ──
      if (M === 'GET' && bare === doorsPath)  { if (needScope('view:space')) return; return answer('SUCCESS', state.doors.slice()); }
      if (M === 'GET' && bare === groupsPath) { if (needScope('view:space')) return; return answer('SUCCESS', state.groups.slice()); }
      // the path we do NOT serve answers as the real console would: not found.
      if (M === 'GET' && (bare === '/doors' || bare === '/spaces/doors' || bare === '/door_groups' || bare === '/spaces/door_groups'))
        return answer('CODE_RESOURCE_NOT_FOUND');

      // ── visitors ──
      if (M === 'POST' && bare === '/visitors') {
        if (needScope('edit:visitor')) return;
        const b = rec.body || {};
        // WHICH KEY carries the door grant is unsettled (audit U5). The console
        // reads the configured one; a battery asserts our behaviour under each.
        const granted = faults.visitorGrantKey === 'resource' ? b.resource
          : faults.visitorGrantKey === 'resources' ? b.resources
          : (b.resource || b.resources);
        const id = 'vis-' + (++state.counters.visitorsCreated);
        state.visitors[id] = Object.assign({}, b, { id, resources: granted || [], pin: null });
        // The reference's create response echoes the visitor. A visitor created
        // with no doors is a REAL outcome and the reply is where it shows.
        return answer('SUCCESS', { id, resources: granted || [] });
      }
      let m;
      if ((m = /^\/visitors\/([^/?]+)\/pin_codes$/.exec(bare)) && M === 'PUT') {
        if (needScope('edit:visitor')) return;
        const v = state.visitors[m[1]];
        if (!v) return answer('CODE_NOT_EXISTS');
        const pin = String((rec.body || {}).pin_code || '');
        if (!pinLengthOk(pin)) return answer('CODE_CREDS_PIN_CODE_CREDS_LENGTH_INVALID');
        if (faults.pinUnique && pinsInUse().includes(pin)) return answer('CODE_CREDS_PIN_CODE_CREDS_ALREADY_EXIST');
        v.pin = pin;
        return answer('SUCCESS');
      }
      if ((m = /^\/visitors\/([^/?]+)$/.exec(bare)) && M === 'PUT') {
        if (needScope('edit:visitor')) return;
        const v = state.visitors[m[1]];
        if (!v) return answer('CODE_NOT_EXISTS');
        const body = rec.body || {};
        if (faults.putMode === 'replace') {
          // the record becomes EXACTLY what was sent - anything omitted is gone
          const id = v.id, pin = v.pin;
          for (const k of Object.keys(v)) delete v[k];
          Object.assign(v, body, { id, pin });
          if (body.resource && !body.resources) v.resources = body.resource;
        } else {
          Object.assign(v, body);
        }
        return answer('SUCCESS', { id: v.id });
      }
      if ((m = /^\/visitors\/([^/?]+)$/.exec(bare)) && M === 'DELETE') {
        if (needScope('edit:visitor')) return;
        const id = m[1];
        state.deleteStarts++; state.deletes++;
        if (faults.slowDeleteMs) await sleep(faults.slowDeleteMs);
        const known = !!state.visitors[id] || state.seeded.some(v => v.id === id);
        if (!known) return answer('CODE_NOT_EXISTS');
        state.deleted.push({ id, force: /is_force=true/.test(u), at: Date.now() });
        delete state.visitors[id];
        state.seeded = state.seeded.filter(v => v.id !== id);
        return answer('SUCCESS');
      }
      if ((m = /^\/visitors\/([^/?]+)$/.exec(bare)) && M === 'GET') {
        if (needScope('view:visitor')) return;
        const v = state.visitors[m[1]] || state.seeded.find(x => x.id === m[1]);
        if (!v) return answer('CODE_NOT_EXISTS');
        return answer('SUCCESS', faults.visitorListFields === 'documented-response'
          ? { id: v.id, first_name: v.first_name, last_name: v.last_name, status: v.status || 'ACTIVE', resources: v.resources || [], pin_code: v.pin || null }
          : Object.assign({}, v));
      }
      if (M === 'GET' && bare === '/visitors') {
        if (needScope('view:visitor')) return;
        const pn = Number(q.get('page_num') || 1), ps = Number(q.get('page_size') || 25);
        const rows = state.seeded.concat(Object.values(state.visitors));
        // WHAT COMES BACK is the other unsettled shape (audit U23): the
        // reference's four visitor response samples carry none of remarks,
        // start_time or end_time, while its schema table lists all three. The
        // sweep's three guards read exactly those fields, so a battery must be
        // able to run the sweep against BOTH answers.
        const shaped = faults.visitorListFields === 'documented-response'
          ? rows.map(v => ({ id: v.id, first_name: v.first_name, last_name: v.last_name,
                             status: v.status || 'ACTIVE', resources: v.resources || [], pin_code: v.pin || null }))
          : rows.slice();
        return page(shaped, pn, ps);
      }

      // ── users (the Member Access Network) ──
      if (M === 'POST' && bare === '/users') {
        if (needScope('edit:user')) return;
        const id = 'user-' + (++state.counters.usersCreated);
        state.users[id] = { body: rec.body, policies: [], pin: null, status: 'ACTIVE' };
        return answer('SUCCESS', { id });
      }
      if ((m = /^\/users\/([^/?]+)\/pin_codes$/.exec(bare)) && M === 'PUT') {
        if (needScope('edit:user')) return;
        const usr = state.users[m[1]];
        if (!usr) return answer('CODE_NOT_EXISTS');
        const pin = String((rec.body || {}).pin_code || '');
        if (!pinLengthOk(pin)) return answer('CODE_CREDS_PIN_CODE_CREDS_LENGTH_INVALID');
        if (faults.pinUnique && pinsInUse().includes(pin)) return answer('CODE_CREDS_PIN_CODE_CREDS_ALREADY_EXIST');
        usr.pin = pin;
        return answer('SUCCESS');
      }
      if ((m = /^\/users\/([^/?]+)\/access_policies$/.exec(bare)) && M === 'PUT') {
        if (needScope('edit:access_policy')) return;
        const usr = state.users[m[1]];
        if (!usr) return answer('CODE_NOT_EXISTS');
        if (faults.refuseUserPolicies) return answer('CODE_OPERATION_FORBIDDEN');
        usr.policies = (rec.body || {}).access_policy_ids || [];
        return answer('SUCCESS');
      }
      if ((m = /^\/users\/([^/?]+)$/.exec(bare)) && M === 'GET') {
        if (needScope('view:user')) return;
        const usr = state.users[m[1]];
        if (!usr) return answer('CODE_NOT_EXISTS');
        // Whether access_policy_ids comes back without expand[] is the third
        // unsettled shape (audit U14/U21). `expandPolicies:false` models a
        // console that omits it - the case where our code reads `|| []` and
        // then WRITES that empty list back over the member's real access.
        const out = { id: m[1], status: usr.status };
        if (faults.reportsUserAccess === false) {
          // this console does not tell us what a user holds - at all
        } else if (opts.expandPolicies === false && !q.getAll('expand[]').includes('access_policy')) {
          // field simply absent
        } else out.access_policy_ids = usr.policies.slice();
        return answer('SUCCESS', out);
      }
      if ((m = /^\/users\/([^/?]+)$/.exec(bare)) && M === 'PUT') {
        if (needScope('edit:user')) return;
        const usr = state.users[m[1]];
        if (!usr) return answer('CODE_NOT_EXISTS');
        const body = rec.body || {};
        if (faults.putMode === 'replace') {
          // policies and pin live on their own sub-resources and are untouched
          usr.body = Object.assign({}, body);
          usr.status = body.status || 'ACTIVE';
        } else {
          usr.body = Object.assign({}, usr.body, body);
          usr.status = body.status || usr.status;
        }
        return answer('SUCCESS');
      }

      // ── access policies and schedules ──
      // The recovery path ensureAlwaysSchedule uses when a name clash means we
      // already made this schedule - it had no route here, so the recovery could
      // never be exercised and reported "not readable on the console either".
      if (M === 'GET' && bare === '/access_policies/schedules') {
        if (needScope('view:access_policy')) return;
        return answer('SUCCESS', Object.entries(state.schedules).map(([id, name]) => ({ id, name })));
      }
      if (M === 'POST' && bare === '/access_policies/schedules') {
        if (needScope('edit:access_policy')) return;
        const name = (rec.body || {}).name || '';
        if (faults.scheduleNamesUnique && Object.values(state.schedules).includes(name))
          return answer('CODE_PARAMS_INVALID');
        const id = 'sched-' + (++state.counters.schedulesCreated);
        state.schedules[id] = name;
        return answer('SUCCESS', { id });
      }
      if (M === 'POST' && bare === '/access_policies') {
        if (needScope('edit:access_policy')) return;
        const b = rec.body || {};
        if (b.schedule_id && !state.schedules[b.schedule_id]) return answer('CODE_NOT_EXISTS');
        const id = 'pol-' + (++state.counters.policiesCreated);
        // the policy key question, same switch as the visitor's
        state.policies[id] = { name: b.name, resources: (b.resource || b.resources || []), schedule_id: b.schedule_id };
        return answer('SUCCESS', { id });
      }
      if ((m = /^\/access_policies\/([^/?]+)$/.exec(bare)) && M === 'PUT') {
        if (needScope('edit:access_policy')) return;
        if (!state.policies[m[1]]) return answer('CODE_NOT_EXISTS');
        const b = rec.body || {};
        if (b.schedule_id && !state.schedules[b.schedule_id]) return answer('CODE_NOT_EXISTS');
        Object.assign(state.policies[m[1]], { name: b.name, resources: (b.resource || b.resources || []) });
        return answer('SUCCESS');
      }

      return answer('CODE_RESOURCE_NOT_FOUND');
    });
  });

  // `down` was declared above and never implemented until Sep 25 2026 - a fault the
  // stand-in claimed and could not produce. A console that is off or unplugged: the
  // connection is dropped before TLS, so nothing is ever answered.
  srv.on('connection', sock => { if (faults.down) sock.destroy(); });

  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({
      srv, state, faults,
      port,
      set: setFaults,
      /** Put visitor rows on the console before the product ever runs (rule 22). */
      seed: (rows) => { state.seeded.push(...rows); },
      stop: () => new Promise(r => srv.close(r)),
    }));
  });
}

module.exports = { startConsole, ensureTls, otherTls, CODES, DEFAULT_FAULTS };
