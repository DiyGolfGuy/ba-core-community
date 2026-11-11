// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  tools/remotelock-standin.js  —  a RemoteLock API that can REFUSE
//
//  RemoteLock is the PRIMARY door provider: the default in config, the one proven
//  at a live facility, and the one most units will ever use. UniFi is the extra
//  for places that already run Ubiquiti.
//
//  Until Sep 16 2026 it had NO stand-in and NO battery of its own, while UniFi had
//  three batteries and a console stand-in with a twelve-state fault table. The
//  extra had received far more scrutiny than the default - so every failure state
//  below was unexercised, and reading services/remotelock.js against them turned
//  up worse hygiene than UniFi had before its own audit: a reply shape taken on
//  faith, a guest created then stranded if the door grant failed, and the literal
//  string 'CHECK_APP' handed to a customer as their door code.
//
//  Shapes follow developer.remotelock.com/api/docs: JSON:API-style
//  { data: { id, type, attributes } }, OAuth client_credentials at /oauth/token,
//  and the documented statuses (401 bad token, 404 unknown person, 422 invalid,
//  429 rate limited, 5xx).
//
//  USE:  const { startLock } = require('./tools/remotelock-standin');
//        const L = await startLock({ port: 14567 });
//        process.env.BA_REMOTELOCK_BASE = L.base;  BA_REMOTELOCK_AUTH = L.auth;
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const http = require('http');

const DEFAULT_FAULTS = {
  token:        'rl-test-token',  // what /oauth/token hands out
  authFails:    false,            // the OAuth step itself refuses (bad credentials)
  rejectToken:  false,            // every API call answers 401
  pinMode:      'pin',            // 'pin' | 'access_pin' | 'code' | 'none' - which field carries it, or none at all
  pinValue:     null,             // force an exact PIN string - for shapes we have never seen but must not refuse
  noId:         false,            // the create reply omits the id
  badShape:     false,            // the create reply is not { data: {...} }
  grantFails:   false,            // creating the guest works; granting the door does not
  deleteStatus: 0,                // >0: DELETE answers this status (404 = already gone)
  rateLimit:    0,                // >0: every call past this count answers 429
  slowMs:       0,                // delay every answer
  htmlBody:     false,            // answer 200 with HTML instead of JSON
};

function startLock(opts = {}) {
  const port = opts.port || 14567;
  const faults = Object.assign({}, DEFAULT_FAULTS, opts.faults || {});
  const state = { requests: [], persons: {}, accesses: [], deleted: [], tokenGrants: 0, n: 0 };
  let served = 0;

  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      let parsed = null;
      try { parsed = body && body.trim().startsWith('{') ? JSON.parse(body) : body; } catch { parsed = body; }
      state.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: parsed });
      served++;
      if (faults.slowMs) await new Promise(r => setTimeout(r, faults.slowMs));

      const send = (status, obj, type) => {
        res.writeHead(status, { 'Content-Type': type || 'application/json' });
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
      };
      if (faults.htmlBody) return send(200, '<!doctype html><html><body>RemoteLock</body></html>', 'text/html');
      if (faults.rateLimit > 0 && served > faults.rateLimit) return send(429, { error: 'rate limited' });

      // ── OAuth ──
      if (req.method === 'POST' && /\/oauth\/token$/.test(req.url)) {
        if (faults.authFails) return send(401, { error: 'invalid_client' });
        state.tokenGrants++;
        return send(200, { access_token: faults.token, token_type: 'bearer', expires_in: 7200 });
      }

      const bearer = /^Bearer\s+(.*)$/.exec(state.requests[state.requests.length - 1].auth || '');
      if (faults.rejectToken || !bearer || bearer[1] !== faults.token) return send(401, { error: 'unauthorized' });

      // ── list access persons (DOCUMENTED: page/per_page, meta.total_pages,
      //    attributes[status] defaulting to current+upcoming) ──
      if (req.method === 'GET' && /\/access_persons(\?|$)/.test(req.url)) {
        const q = new URL('http://x' + req.url).searchParams;
        const status = q.get('attributes[status]') || 'current';
        const per = Math.min(Number(q.get('per_page') || 25), 50);
        const page = Number(q.get('page') || 1);
        const rows = Object.values(state.persons)
          .filter(p => (p.status || 'current') === status)
          .map(p => ({ id: p.id, type: 'access_guest', attributes: Object.assign({ status: p.status || 'current' }, p.attrs, { pin: p.pin }) }));
        const slice = rows.slice((page - 1) * per, page * per);
        return send(200, { data: slice, meta: { page, per_page: per, total_count: rows.length, total_pages: Math.max(1, Math.ceil(rows.length / per)) } });
      }

      // ── create a guest ──
      if (req.method === 'POST' && /\/access_persons$/.test(req.url)) {
        const id = 'rlp-' + (++state.n);
        const pin = faults.pinValue !== null ? String(faults.pinValue) : String(1000 + (state.n * 7) % 9000);
        state.persons[id] = { id, pin, attrs: (parsed && parsed.attributes) || {} };
        if (faults.badShape) return send(200, { person: { id } });
        const attributes = Object.assign({}, (parsed && parsed.attributes) || {});
        if (faults.pinMode === 'pin') attributes.pin = pin;
        else if (faults.pinMode === 'access_pin') attributes.access_pin = pin;
        else if (faults.pinMode === 'code') attributes.code = pin;
        // 'none': the reply carries no PIN at all - the case that used to become 'CHECK_APP'
        return send(200, { data: Object.assign({ type: 'access_guest', attributes }, faults.noId ? {} : { id }) });
      }

      // ── grant the door ──
      let m;
      if (req.method === 'POST' && (m = /\/access_persons\/([^/]+)\/accesses$/.exec(req.url))) {
        if (faults.grantFails) return send(422, { error: 'accessible_id is invalid' });
        if (!state.persons[m[1]]) return send(404, { error: 'not found' });
        state.accesses.push({ person: m[1], body: parsed });
        return send(200, { data: { id: 'acc-' + state.accesses.length, type: 'access' } });
      }

      // ── revoke ──
      if (req.method === 'DELETE' && (m = /\/access_persons\/([^/?]+)$/.exec(req.url))) {
        if (faults.deleteStatus) return send(faults.deleteStatus, { error: 'refused' });
        if (!state.persons[m[1]]) return send(404, { error: 'not found' });
        delete state.persons[m[1]];
        state.deleted.push(m[1]);
        return send(204, '');
      }
      return send(404, { error: 'no route' });
    });
  });

  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({
      srv, state, faults, port,
      base: `http://127.0.0.1:${port}`,
      auth: `http://127.0.0.1:${port}/oauth/token`,
      set: (o) => Object.assign(faults, o || {}),
      /** plant a guest the lock already holds - an orphan from before the fix */
      seed: (rows) => { for (const r of rows) state.persons[r.id] = { id: r.id, pin: r.pin || '9999', status: r.status || 'expired', attrs: { name: r.name, ends_at: r.ends_at } }; },
      /** every PIN the lock currently holds */
      pins: () => Object.values(state.persons).map(p => p.pin),
      stop: () => new Promise(r => srv.close(r)),
    }));
  });
}

module.exports = { startLock, DEFAULT_FAULTS };
