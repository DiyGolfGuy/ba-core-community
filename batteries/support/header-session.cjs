// TEST SUPPORT ONLY - never loaded by the product.
//
// The batteries in this folder were written for an edition whose admin routes
// also took the owner's password in an `x-admin-password` header. BA Core
// Community signs an owner in with a session cookie and a CSRF token and
// nothing else. Rather than rewrite every battery's sign-in, the runner loads
// this file into the server processes a battery starts (NODE_OPTIONS=--require):
// when a request carries the header and no session, the password is checked by
// the product's own verifier and a real session is made for it, so the request
// continues through the product's own session and CSRF checks.
'use strict';
const http = require('http');
const path = require('path');

const emit = http.Server.prototype.emit;
const sessions = new Map();   // password -> { sid, csrf }

http.Server.prototype.emit = function (event, req) {
  if (event === 'request' && req && req.headers && req.headers['x-admin-password'] && !/ba_session=/.test(req.headers.cookie || '')) {
    try {
      const auth = require(path.join(process.cwd(), 'services', 'auth'));
      const password = String(req.headers['x-admin-password']);
      const scope = auth.verifyAdminPassword(password) ? 'admin'
        : (auth.managerEnabled && auth.managerEnabled() && auth.verifyManagerPassword(password) ? 'manager' : null);
      if (scope) {
        let session = sessions.get(scope + ':' + password);
        if (!session || !auth.sessionFrom({ headers: { cookie: 'ba_session=' + session.sid } }, scope)) {
          session = auth.createSession(scope, req);
          sessions.set(scope + ':' + password, session);
        }
        req.headers.cookie = (req.headers.cookie ? req.headers.cookie + '; ' : '') + 'ba_session=' + session.sid;
        req.headers['x-csrf'] = session.csrf;
        const at = req.rawHeaders.findIndex((name, index) => index % 2 === 0 && name.toLowerCase() === 'cookie');
        if (at >= 0) req.rawHeaders[at + 1] = req.headers.cookie; else req.rawHeaders.push('Cookie', req.headers.cookie);
      }
    } catch { /* not a BA Core server process, or not ready: the request goes on as it came */ }
  }
  return emit.apply(this, arguments);
};
