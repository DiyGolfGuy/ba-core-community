// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/session-routines.js - THE BAY PC'S WATCHER AND ITS ROUTINES (Oct 21 2026)
//
// /api/session/routines - the watcher on a bay PC, with its own bay key in x-bay-key (minted when its package is built;
// services/monitor-builder.js). Reach is public (/api/session, services/reach.js) because a watcher may fall back to the
// unit's public address; the key is the gate, and a request without it gets nothing. Each reply a watcher reads is declared
// key by key in services/reach.js REPLY_KEYS (rule 36). The owner's side is in routes/routines.js.
'use strict';
const express = require('express');
const R = require('../services/routines');
const { getConfig } = require('../services/config');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));   // a recording carries a small picture per click
const bayExists = (id) => (getConfig().bays || []).some(b => b && b.id === id);
function bayKey(req, res, next) {
  const bay = String((req.query && req.query.bay) || (req.body && req.body.bay) || '');
  // the same answer for a missing bay, a missing key and a wrong key: nothing about which bays exist leaks
  if (!bay || !bayExists(bay) || !R.keyOk(bay, String(req.get('x-bay-key') || ''))) return res.status(401).json({ ok: false, error: 'this watcher has no key for this bay - download its package again from the bay in Admin' });
  req.bayId = bay;
  next();
}
// a watcher built from Oct 21 2026 (night) says which programs this PC was taught (base names, comma-separated): the card
// and the assistant then know which bay's PC still has to be shown a program a copied routine opens
router.get('/', bayKey, (req, res) => {
  const taught = typeof req.query.taught === 'string' ? req.query.taught.slice(0, 4000).split(',').map(x => x.trim()).filter(Boolean) : undefined;
  res.json(Object.assign({ ok: true }, R.watcherPoll(req.bayId, taught)));
});
router.post('/recording', bayKey, (req, res) => {
  const b = req.body || {};
  const r = R.teachReceive(req.bayId, b.teach_id, b.steps, b.cancelled === true);
  res.status(r.ok ? 200 : 409).json(r.ok ? (r.stopped ? { ok: true, stopped: true } : r.program ? { ok: true, program: true, opened: r.opened, say: r.say } : { ok: true, steps: r.steps.length }) : r);
});
router.post('/result', bayKey, (req, res) => {
  const b = req.body || {};
  // a run the unit asked for (run_id), or one the PC started itself (routine_id and what started it - its hotkey, Windows
  // starting, a program or a window)
  const r = R.runResult(req.bayId, b.run_id, { ok: b.ok === true, failed_step: b.failed_step, detail: b.detail, routine_id: b.routine_id, source: b.source });
  res.status(r.ok ? 200 : 404).json(r);
});

module.exports = router;
