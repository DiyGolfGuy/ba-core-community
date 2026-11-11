// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// routes/routines.js - ROUTINES TAUGHT ON A BAY PC (Oct 21 2026)
//
// The owner's (and the assistant's) side of services/routines.js: /api/admin/routines, behind the admin console's own
// sign-in. Teaching, saving, changing and removing are the owner's; running one and reading them, any admin's. The
// watcher's side is routes/session-routines.js; the staff pad's Run button is routes/staff.js.
// The routines card on Bays & Devices (admin.html #routinesCard) and the assistant (services/assistant/areas/bays.js) call
// exactly these, so nothing one can do is missing from the other (maintainer, Oct 21 2026, night: "make sure all that is ...
// editable with color choice using the AI").
'use strict';
const R = require('../services/routines');
const { getConfig } = require('../services/config');

const bayExists = (id) => (getConfig().bays || []).some(b => b && b.id === id);
const bayName = (id) => { const b = (getConfig().bays || []).find(x => x && x.id === id); return b ? (b.name || b.id) : id; };

// ── the owner ── each handler registered by routes/admin.js as router.<method>('/routines...') - straight on the admin
// router, never a router inside it: the route list every check walks (test-assistant-map M1 reads the route files; the
// canary walks services/reach.js routes) sees only the routes a mounted router holds itself, and a nested one hid all eight
const admin = {};
{
  const a = { get: (p, ...h) => { admin['GET ' + p] = h; }, post: (p, ...h) => { admin['POST ' + p] = h; }, put: (p, ...h) => { admin['PUT ' + p] = h; }, delete: (p, ...h) => { admin['DELETE ' + p] = h; } };
  const requireOwner = (req, res, next) => require('../services/auth').requireOwner(req, res, next);
  const words = (r, pc) => Object.assign({}, r, { steps: r.steps.map((s, i) => ({ n: i + 1, say: R.stepWords(s), do: s.do, by: s.by, seconds: s.seconds, wait: s.wait, look: s.look ? true : undefined })),
    when: R.triggerWords(r.triggers), text_color: R.textOn(r.color), needs: R.needsOf(r, pc),
    runs: R.runsOf(r.id, 3).map(x => ({ asked: x.requested_at, by: x.source, done: x.finished_at, ok: x.ok === null ? null : !!x.ok, detail: x.detail || '' })) });
  const out = (r) => words(r, R.pcOf(r.bay_id));
  a.get('/routines', (req, res) => {
    R.settleStale();
    const bays = (getConfig().bays || []).filter(b => b && b.id && (!req.query.bay || b.id === req.query.bay));
    // a teaching back from its PC carries its steps in words too (the card shows the draft before it is saved)
    const teach = (t) => (t && Array.isArray(t.steps) ? Object.assign({}, t, { says: t.steps.map(R.stepWords) }) : t);
    res.json({ palette: R.PALETTE, bays: bays.map(b => { const pc = R.pcOf(b.id); return { id: b.id, name: b.name || b.id, teach: teach(R.teachState(b.id)), pc, routines: R.list(b.id).map(r => words(r, pc)) }; }) });
  });
  a.post('/routines/teach', requireOwner, (req, res) => {
    const b = req.body || {};
    if (!bayExists(b.bay_id)) return res.status(404).json({ error: 'no such bay' });
    res.json(Object.assign({ ok: true }, R.teachStart(b.bay_id, b.name, { program: b.program })));
  });
  a.delete('/routines/teach', requireOwner, (req, res) => { if (!bayExists(req.query.bay)) return res.status(404).json({ error: 'no such bay' }); R.teachCancel(req.query.bay); res.json({ ok: true }); });
  // the steps the bay PC sent back, saved as a routine (or onto one, to teach it again)
  a.post('/routines/save', requireOwner, (req, res) => {
    const b = req.body || {};
    if (!bayExists(b.bay_id)) return res.status(404).json({ error: 'no such bay' });
    try { res.json({ ok: true, routine: out(R.teachSave(b.bay_id, { id: b.id, name: b.name, triggers: b.triggers, color: b.color })) }); }
    catch (e) { res.status(409).json({ error: e.message }); }
  });
  // a routine made from words alone: no clicks and no program opened (those are shown on the PC)
  a.post('/routines', requireOwner, (req, res) => {
    const b = req.body || {};
    if (!bayExists(b.bay_id)) return res.status(404).json({ error: 'no such bay' });
    try { res.json({ ok: true, routine: out(R.create({ bay_id: b.bay_id, name: b.name, steps: b.steps, triggers: b.triggers, color: b.color })) }); }
    catch (e) { res.status(409).json({ error: e.message }); }
  });
  // a routine's name, when it runs, its colour, and whether it is paused
  a.put('/routines/:id', requireOwner, (req, res) => {
    const cur = R.get(req.params.id); if (!cur) return res.status(404).json({ error: 'no such routine' });
    const b = req.body || {};
    try {
      res.json({ ok: true, routine: out(R.save({ id: cur.id, bay_id: cur.bay_id, name: b.name !== undefined ? b.name : cur.name, steps: cur.steps,
        triggers: b.triggers !== undefined ? b.triggers : cur.triggers, color: b.color, enabled: b.enabled === undefined ? undefined : b.enabled !== false })) });
    } catch (e) { res.status(409).json({ error: e.message }); }
  });
  // ONE STEP CHANGED, MOVED, TAKEN OUT OR ADDED (by talking: "click Practice Range by its words", "wait 5 seconds after it
  // opens", "then press Enter", "type the Uneekor password there", "move step 4 up"). The list is changed here so each click
  // keeps the picture the PC took, and the whole routine is checked again.
  const EDITABLE = { click: ['by', 'wait', 'label', 'double', 'button'], wait: ['seconds'], wait_window: ['seconds', 'title'], key: ['keys'], type: ['text'], close: ['seconds'], open: ['args'], type_secret: ['name'] };
  a.post('/routines/:id/steps', requireOwner, (req, res) => {
    const cur = R.get(req.params.id); if (!cur) return res.status(404).json({ error: 'no such routine' });
    const b = req.body || {}, n = Number(b.n), steps = cur.steps.slice();
    try {
      if (b.op === 'set') {
        if (!(n >= 1 && n <= steps.length)) throw new Error(`there is no step ${b.n} (it has ${steps.length})`);
        const s = Object.assign({}, steps[n - 1]), allowed = EDITABLE[s.do] || [];
        const asked = Object.keys(b.step || {}), wrong = asked.filter(k => !allowed.includes(k));
        if (!asked.length) throw new Error('say what to change in it');
        if (wrong.length) throw new Error(`step ${n} (${R.stepWords(s)}) has no "${wrong[0]}" to change`);
        Object.assign(s, b.step); steps[n - 1] = s;
      } else if (b.op === 'remove') {
        if (!(n >= 1 && n <= steps.length)) throw new Error(`there is no step ${b.n} (it has ${steps.length})`);
        if (steps.length === 1) throw new Error('that is its only step - remove the routine instead');
        steps.splice(n - 1, 1);
      } else if (b.op === 'move') {
        const to = Number(b.to);
        if (!(n >= 1 && n <= steps.length)) throw new Error(`there is no step ${b.n} (it has ${steps.length})`);
        if (!(Number.isInteger(to) && to >= 1 && to <= steps.length)) throw new Error(`a step moves to a place from 1 to ${steps.length}`);
        if (to === n) throw new Error(`step ${n} is already there`);
        const [s] = steps.splice(n - 1, 1); steps.splice(to - 1, 0, s);
      } else if (b.op === 'insert') {
        if (!(n >= 0 && n <= steps.length)) throw new Error(`a step goes after step 0 to ${steps.length}`);
        if (!b.step || R.TAUGHT_ONLY.includes(b.step.do)) throw new Error('a click or a program to open is taught on the PC, never typed in - teach the routine again for it');
        steps.splice(n, 0, b.step);
      } else throw new Error('change a step, move one, take one out, or add one');
      res.json({ ok: true, routine: out(R.save({ id: cur.id, bay_id: cur.bay_id, name: cur.name, steps, triggers: cur.triggers })) });
    } catch (e) { res.status(409).json({ error: e.message }); }
  });
  // the same routine on other bays ("all" for every other bay); each bay says how it went and what its PC still needs shown
  a.post('/routines/:id/copy', requireOwner, (req, res) => {
    const cur = R.get(req.params.id); if (!cur) return res.status(404).json({ error: 'no such routine' });
    const b = req.body || {}, bays = (getConfig().bays || []).filter(x => x && x.id);
    const want = b.bays === 'all' ? bays.map(x => x.id).filter(id => id !== cur.bay_id) : (Array.isArray(b.bays) ? b.bays.map(String) : []);
    const missing = want.filter(id => !bays.some(x => x.id === id));
    if (missing.length) return res.status(404).json({ error: `no such bay: ${missing[0]}` });
    if (!want.filter(id => id !== cur.bay_id).length) return res.status(409).json({ error: 'say which other bays to copy it to' });
    const done = R.copyTo(cur.id, want, { replace: b.replace === true }).map(x => Object.assign({ bay: bayName(x.bay_id) }, x));
    res.status(done.some(x => x.ok) ? 200 : 409).json(Object.assign({ ok: done.some(x => x.ok), bays: done }, done.some(x => x.ok) ? {} : { error: done.map(x => `${x.bay}: ${x.error}`).join('; ') }));
  });
  a.post('/routines/:id/run', (req, res) => {
    const cur = R.get(req.params.id); if (!cur) return res.status(404).json({ error: 'no such routine' });
    const r = R.requestRun(cur.id, 'owner', { expires_at: new Date(Date.now() + 15 * 60000).toISOString().replace('T', ' ').slice(0, 19) });
    res.json({ ok: true, run: r.id, already: r.already, bay: bayName(cur.bay_id) });
  });
  a.delete('/routines/:id', requireOwner, (req, res) => (R.remove(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'no such routine' })));
}

module.exports = { admin };
