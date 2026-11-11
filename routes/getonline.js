// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/getonline.js - GETTING THE BOX ONLINE (Oct 21 2026)
//
// The owner's (and the assistant's) side of services/getonline.js: /api/admin/getonline, behind the admin console's own
// sign-in, every route the owner's alone - connecting the box acts on the owner's own Cloudflare account. Registered by
// routes/admin.js straight on its router, as the routines are (a nested router hides its routes from the route checks).
'use strict';
const G = require('../services/getonline');

const admin = {};
{
  const requireOwner = (req, res, next) => require('../services/auth').requireOwner(req, res, next);
  admin['GET /getonline'] = [requireOwner, async (req, res) => res.json(await G.status())];
  // a read (the assistant's reads are GETs): what the world sees of a domain
  admin['GET /getonline/domain'] = [requireOwner, async (req, res) => { const r = await G.checkDomain(req.query.d); res.status(r.error && !r.address ? 400 : 200).json(r); }];
  admin['POST /getonline/connect'] = [requireOwner, async (req, res) => {
    const b = req.body || {};
    const r = await G.connect(b.addresses || b.address, { replace: b.replace === true });
    res.status(r.error ? 409 : 200).json(r);
  }];
  admin['DELETE /getonline/connect'] = [requireOwner, (req, res) => res.json(G.cancel())];
  admin['POST /getonline/check'] = [requireOwner, async (req, res) => { const r = await G.checkNow(); res.status(r.error ? 409 : 200).json(r); }];
}

module.exports = { admin };
