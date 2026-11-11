// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// assistant-apply.js - HOW A CHANGE IS MADE, WITH THE OWNER'S OWN SESSION (Oct 20 2026)
//
// The assistant never changes anything itself: it proposes, and the owner's page makes the change through the same routes
// the owner's screens use (services/assistant/actions.js). This is that page's half, in one module (UMD like
// site-layout.js) so the owner's chat page and the battery run the SAME code - a battery that applied changes its own way
// would be proving the author's model of the page, not the page.
//
//   op 'http'     one request the screens make: { method, path, body, reveal? } - `reveal` names fields of the reply that
//                 the OWNER sees on the page (a new member's PIN) and the assistant never does
//   op 'config'   the Settings save: read the config, set [[dot.path, value]], save it whole; `expect` [[path, value]] must
//                 still hold (a bay is found by its place in the list)
//   op 'content'  the Website editor's save of one section: `set` [[dot.path, value]] and `push` [[dot.path, [items]]] on the
//                 section as it is; `append` an item to a list section (unique by a field); `match` [field, value] picks one
//                 item of a list section to `set` on, or to `remove`
//   op 'layout'   a change to the homepage's sections through site-layout.js applyEdit, on the site as it is now
//   op 'nav'      one menu entry: `key` with `set` { label, href, top, foot }, or `remove` (the owner's own links only)
//   op 'merge'    a whole-record save (a route that replaces the record): `get` the list, find the record by `find`
//                 [field, value] (in `list`, the reply's key holding the list, when it is not the reply itself), lay `set` over
//                 it, and send `fields` of it to `put` with `method` (PUT unless said)
//   op 'undo'     the last change to one part of the website taken back (`key`): the version saved before it comes back
//   op 'flyer'    a special's flyer (public/flyer.js): the page draws `draw` with the special's `photo` and the logo, saves it
//                 like any photo, then makes `then` with the saved address in place of __FLYER__ (Oct 20 2026)
//   op 'steps'    several of the above under one yes, in order, stopping at the first refusal
// Every result is { ok, status, error, data, focus, keys } - data is a few plain facts for the assistant (never a route's
// whole answer: a shift's row carries the staff member's sign-in code), focus the part of the site to show, keys the parts
// of the website saved (each can be undone: op 'undo').
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAAssistApply = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var setPath = function (o, dotted, v) { var k = String(dotted).split('.'); var x = o; for (var i = 0; i < k.length - 1; i++) { if (!x[k[i]] || typeof x[k[i]] !== 'object') x[k[i]] = {}; x = x[k[i]]; } x[k[k.length - 1]] = v; };
  var getPath = function (o, d) { return String(d).split('.').reduce(function (x, k) { return (x && typeof x === 'object') ? x[k] : undefined; }, o); };
  var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  var errorOf = function (r) { var j = r.json || {}; return j.error || (Array.isArray(j.problems) ? j.problems.map(function (p) { return p.message; }).join(' ') : '') || (r.ok ? 'it did not happen' : 'it answered ' + r.status); };
  // a route that answers 200 with { success: false } or { ok: false } did NOT do it (rule 29)
  var worked = function (r) { var j = r.json || {}; return r.ok && j.success !== false && j.ok !== false; };
  /** What the assistant hears back from a route: a few plain facts, never its whole answer. */
  function resultOf(j) {
    j = j || {};
    if (j.shift) return { shift_id: j.shift.id, date: j.shift.date, from: j.shift.start_time, to: j.shift.end_time };
    if (j.radios) return { radios: j.radios, did: j.did };
    var o = {};
    if (j.id) o.id = j.id;
    if (j.booking && typeof j.booking === 'object') { if (j.booking.id) o.id = j.booking.id; if (j.booking.price_cents != null) o.price_cents = j.booking.price_cents; }
    if (j.date) o.date = j.date;
    if (j.device && typeof j.device === 'object') o.device = j.device.name || j.device.id;
    // a cancel: whether the money really went back (the route says "Cancelled - full refund" even when it did not)
    if (j.refund_type !== undefined) { o.refunded = !!j.refunded; o.refund_type = j.refund_type; if (j.refund_amount_cents != null) o.refund_cents = j.refund_amount_cents; }
    ['applied', 'copied'].forEach(function (k) { if (typeof j[k] === 'number') o[k] = j[k]; });
    if (typeof j.skipped === 'number') o.skipped = j.skipped; else if (Array.isArray(j.skipped)) o.skipped = j.skipped.length;
    // a member's door access not yet on the console - words with no PIN in them; a PIN that had to change is said as a
    // fact only (its text carries the PIN)
    if (typeof j.doorConsole === 'string' && j.doorConsole) o.door_console = j.doorConsole.slice(0, 200);
    if (j.pinChanged) o.pin_changed = true;
    // a group checked in (Oct 20 2026, late): what to collect at the door, each share, and a member's credit
    if (typeof j.collect_cents === 'number') { o.collect_cents = j.collect_cents; if (typeof j.share_cents === 'number') o.share_cents = j.share_cents; if (j.credit_to_member_cents) o.credit_to_member_cents = j.credit_to_member_cents; if (typeof j.actual_golfers === 'number') o.golfers = j.actual_golfers; }
    // a test email or text (Oct 20 2026, latest): sent, held back on a test unit, or what is missing - never called sent when
    // it was refused; Stripe's refunds picked up; a card reader paired (its name only)
    if (typeof j.sent === 'boolean') { o.sent = j.sent; if (j.heldBack) o.held_back = true; if (j.missing) o.missing = String(j.missing).slice(0, 200); if (j.error) o.why_not = String(j.error).slice(0, 200); if (j.to) o.to = String(j.to).slice(0, 60); }
    if (typeof j.checked === 'number' && typeof j.recorded === 'number') { o.checked = j.checked; o.recorded = j.recorded; o.updated = j.updated | 0; if (j.skipped === true) o.no_stripe = true; if (j.error) o.why_not = String(j.error).slice(0, 200); }
    if (j.reader && typeof j.reader === 'object' && j.reader.label) o.reader = String(j.reader.label).slice(0, 60);
    // a thermostat set now (Oct 21 2026, the sandbox's note): the mode it was set for and what was sent - and a change the
    // route answered with nothing sent says so (a thermostat switched off at the wall answered "ok", and was told as set)
    if (typeof j.mode === 'string' && /^[a-z_]{2,20}$/.test(j.mode)) { o.mode = j.mode; if (typeof j.sent === 'string' && /^\d{2,3}(?:\.\d)?(?:-\d{2,3}(?:\.\d)?)?$/.test(j.sent)) o.setpoint = j.sent; }
    if (j.skipped === true) { o.skipped = true; if (j.reason) o.why_not = String(j.reason).slice(0, 200); }
    return Object.keys(o).length ? o : 'ok';
  }
  // which part of the homepage a content key draws (the landing page's own section ids)
  var FOCUS = { hero: 'hero', offers: 'offers', steps: 'steps', staffed: 'staffed', gallery: 'gallery', promo: 'promo', visit: 'visit', memberships: 'membershipsSec' };

  /**
   * io: { api(method, path, body) -> Promise<{ ok, status, json }>, layout: the site-layout.js module,
   *       draw(spec, { photo, logo }) -> Promise<image blob> and upload(blob, name) -> Promise<{ ok, path, error }> - the page's
   *       canvas and its photo upload, for a flyer (a page without them refuses one in words) }
   * Returns { apply(request) -> Promise<result> } plus the helpers the page's cards use.
   */
  function create(io) {
    var api = io.api, L = io.layout;
    var refused = function (r) { return { ok: false, status: r.status, error: errorOf(r) }; };
    var readSite = function () { return api('GET', '/api/website/content').then(function (g) { if (!g.ok) throw new Error('the website could not be read'); return (g.json && g.json.content) || {}; }); };
    var saveSite = function (key, value) { return api('PUT', '/api/website/content', { key: key, value: value }); };
    var ops = {
      http: function (q) {
        if (!/^\/api\//.test(String(q.path)) || ['GET', 'POST', 'PUT', 'DELETE'].indexOf(q.method) < 0) return Promise.resolve({ ok: false, error: 'not a request this page makes' });
        return api(q.method, q.path, q.body).then(function (r) {
          // a bay's sequence answers step by step (services/sequence.js): say which devices did not answer and which toggle
          // codes were held back, so "part of the bay" is not told as "nothing happened" - or as "done"
          var st = r.json && Array.isArray(r.json.steps) ? r.json.steps : (r.json && Array.isArray(r.json.bays) ? [].concat.apply([], r.json.bays.map(function (b) { return (b && b.steps) || []; })) : null);
          var failed = st ? st.filter(function (x) { return x && x.ok === false; }).map(function (x) { return x.target + (x.error ? ' (' + String(x.error).slice(0, 60) + ')' : ''); }) : [];
          var held = st ? st.filter(function (x) { return x && x.skipped && x.ok !== false; }).map(function (x) { return x.target; }) : [];
          if (!worked(r)) { var rf = refused(r); if (failed.length) rf.error = 'these did not answer: ' + failed.join(', '); return rf; }
          // every bay at once answers ok whatever each bay did (services/sequence.js allBays): what did not answer still goes
          // back by name - it was dropped, and "every bay off" with a dead plug read as done (rule 29; test-demo-model D19b)
          var out = { ok: true, status: r.status, data: st ? { done: st.filter(function (x) { return x && x.ok !== false && !x.skipped; }).length, not_sent: held.length ? held : undefined, failed: failed.length ? failed : undefined } : resultOf(r.json) };
          // what the owner must see and the assistant must not (a new member's PIN, a gift card's code): shown on the page
          // only - `reveal` is [[words for the owner, the reply's field], ...]
          if (Array.isArray(q.reveal)) { var shown = []; q.reveal.forEach(function (rv) { var v = getPath(r.json || {}, rv[1]); if (v !== undefined && v !== null && v !== '') shown.push([rv[0], String(v)]); }); if (shown.length) out.shown = shown; }
          // a value the unit made for the owner before the request (a new staff sign-in code, Oct 20 2026): shown the same way
          if (Array.isArray(q.showOwner)) out.shown = (out.shown || []).concat(q.showOwner.map(function (x) { return [String(x[0]), String(x[1])]; }));
          return out;
        });
      },
      config: function (q) {
        return api('GET', '/api/admin/config').then(function (g) {
          if (!g.ok) return { ok: false, error: 'the settings could not be read' };
          var cfg = g.json;
          // what the proposal was built against must still be so (a bay is found by its place in the list)
          for (var i = 0; i < (q.expect || []).length; i++) if (getPath(cfg, q.expect[i][0]) !== q.expect[i][1]) return { ok: false, error: 'the settings changed since this was suggested - ask again' };
          (q.set || []).forEach(function (kv) { setPath(cfg, kv[0], kv[1]); });
          return api('POST', '/api/admin/config', cfg).then(function (r) { return r.ok ? { ok: true, status: r.status, data: 'ok' } : refused(r); });
        });
      },
      content: function (q) {
        return readSite().then(function (site) {
          var cur = site[q.key], value;
          if (q.append) {
            // a new item at the end of a list (a page): never over one already there with the same address
            value = Array.isArray(cur) ? cur.slice() : [];
            var item = Object.assign({}, q.append);
            if (q.unique) { var base = item[q.unique], n = 2; while (value.some(function (x) { return x && x[q.unique] === item[q.unique]; })) item[q.unique] = base + '-' + (n++); }
            value.push(item);
          } else if (q.match) {
            // one item of a list section (a page by its address): changed in place, or taken out
            value = Array.isArray(cur) ? clone(cur) : [];
            var at = -1; value.forEach(function (x, i) { if (at < 0 && x && String(x[q.match[0]]).toLowerCase() === String(q.match[1]).toLowerCase()) at = i; });
            if (at < 0) return { ok: false, error: 'it is not there any more - ask again' };
            if (q.remove) value.splice(at, 1); else (q.set || []).forEach(function (kv) { setPath(value[at], kv[0], kv[1]); });
          } else {
            value = clone(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {});
            (q.set || []).forEach(function (kv) { setPath(value, kv[0], kv[1]); });
            // items added to a list inside the section (the gallery's photos): after what is there
            (q.push || []).forEach(function (kv) { var arr = Array.isArray(getPath(value, kv[0])) ? getPath(value, kv[0]).slice() : []; arr.push.apply(arr, kv[1]); setPath(value, kv[0], arr); });
          }
          return saveSite(q.key, value).then(function (r) { return r.ok ? { ok: true, status: r.status, data: 'ok', focus: q.focus || FOCUS[q.key], keys: [q.key] } : refused(r); });
        });
      },
      layout: function (q) {
        if (!L) return Promise.resolve({ ok: false, error: 'this page cannot change the layout' });
        return readSite().then(function (site) {
          var r;
          try { r = L.applyEdit(site, q.edit); } catch (e) { return { ok: false, error: e.message }; }
          var keys = Object.keys(r.save), i = 0;
          var next = function () {
            if (i >= keys.length) {
              var id = r.block.id, type = r.block.type;
              var sid = L.BUILTIN[type] ? Object.keys(L.SECTION_IDS).filter(function (k) { return L.SECTION_IDS[k] === type; })[0] : 'blk-' + id;
              var data = { section: id, name: r.block.label }; if (q.edit && q.edit.do === 'add') data.added = id; if (r.note) data.note = r.note;
              return { ok: true, data: data, focus: q.edit && q.edit.do === 'remove' ? null : sid, keys: keys };
            }
            var k = keys[i++];
            return saveSite(k, r.save[k]).then(function (s) { return s.ok ? next() : refused(s); });
          };
          return next();
        });
      },
      nav: function (q) {
        return readSite().then(function (site) {
          var nav = clone(site.nav && typeof site.nav === 'object' ? site.nav : {}) || {};
          var items = Array.isArray(nav.items) ? nav.items : [];
          var at = -1; items.forEach(function (x, i) { if (x && x.key === q.key) at = i; });
          if (q.remove) { if (at < 0) return { ok: false, error: 'that link is not in the menu' }; items.splice(at, 1); }
          else {
            if (at < 0) { items.push({ key: q.key }); at = items.length - 1; }
            Object.keys(q.set || {}).forEach(function (k) { items[at][k] = q.set[k]; });
            if (q.position === 'first' && at > 0) items.unshift(items.splice(at, 1)[0]);
          }
          nav.items = items;
          return saveSite('nav', nav).then(function (r) { return r.ok ? { ok: true, status: r.status, data: 'ok', keys: ['nav'] } : refused(r); });
        });
      },
      merge: function (q) {
        return api('GET', q.get).then(function (g) {
          if (!g.ok) return refused(g);
          var list = q.list ? (g.json || {})[q.list] : g.json;
          var rec = (Array.isArray(list) ? list : []).filter(function (x) { return x && String(x[q.find[0]]) === String(q.find[1]); })[0];
          if (!rec) return { ok: false, error: 'it is not there any more - ask again' };
          var body = {};
          (q.fields || Object.keys(rec)).forEach(function (f) { body[f] = rec[f]; });
          Object.keys(q.set || {}).forEach(function (f) { body[f] = q.set[f]; });
          return api(q.method || 'PUT', q.put, body).then(function (r) { return worked(r) ? { ok: true, status: r.status, data: resultOf(r.json) } : refused(r); });
        });
      },
      // the last change to one part of the website taken back: the version saved before it comes back (every save keeps
      // the one it replaced - routes/website.js saveContent), and a restore keeps what it replaced, so undo again is redo
      undo: function (q) {
        return api('GET', '/api/website/history?key=' + encodeURIComponent(q.key)).then(function (h) {
          if (!h.ok) return refused(h);
          var v = ((h.json || {}).versions || [])[0];
          if (!v) return { ok: false, error: 'there is no earlier version of that part to go back to' };
          return api('POST', '/api/website/history/restore', { id: v.id }).then(function (r) { return r.ok ? { ok: true, status: r.status, data: { restored: v.summary || 'the version before' }, focus: FOCUS[q.key], keys: [q.key] } : refused(r); });
        });
      },
      flyer: function (q) {
        if (!io.draw || !io.upload) return Promise.resolve({ ok: false, error: 'this page cannot draw a flyer - open the assistant in a browser' });
        return Promise.resolve(io.draw(q.draw || {}, { photo: q.photo || '', logo: !!q.logo })).then(function (blob) {
          if (!blob) return { ok: false, error: 'the flyer could not be drawn' };
          return Promise.resolve(io.upload(blob, 'flyer.jpg')).then(function (up) {
            if (!up || !up.ok || !up.path) return { ok: false, error: (up && up.error) || 'the flyer could not be saved' };
            // what the chat's download buttons need to put the card on a square or a Story (its edge colour, the site's address)
            var d0 = q.draw || {}, dl = { bg: (d0.colors || {}).dark, color: (d0.colors || {}).onDark, font: (d0.fonts || {}).body, site: d0.site || '', name: d0.title || 'flyer', slides: !!q.then };
            // (a flyer only to download and email - not put anywhere on the site - has nothing more to do: Oct 22 2026, night)
            if (!q.then) return { ok: true, status: 200, data: { flyer: up.path }, image: up.path, flyer: dl };
            var then = JSON.parse(JSON.stringify(q.then || {}).split('__FLYER__').join(up.path));
            if (!ops[then.op] || then.op === 'flyer') return { ok: false, error: 'not a request this page makes' };
            return ops[then.op](then).then(function (r) { if (r.ok) { r.data = Object.assign({}, r.data && typeof r.data === 'object' ? r.data : {}, { flyer: up.path }); r.image = up.path; r.flyer = dl; r.focus = 'offers'; } return r; });
          });
        });
      },
      steps: function (q) {
        var list = q.steps || [], i = 0, last = null;
        var next = function () {
          if (i >= list.length) return last || { ok: true, data: 'ok' };
          var s = list[i++];
          if (!ops[s.op] || s.op === 'steps') return { ok: false, error: 'not a request this page makes' };
          return ops[s.op](s).then(function (r) { if (!r.ok) { r.error = (list.length > 1 ? 'step ' + i + ' of ' + list.length + ': ' : '') + r.error; return r; } last = r; return next(); });
        };
        return next();
      }
    };
    /** A secret the owner typed in the page's masked box: into a setting by its place, or to its own route. Never logged here. */
    function secret(q, value) {
      if (q.configPath) return ops.config({ set: (q.set || []).concat([[q.configPath, value]]), expect: q.expect });
      if (!/^\/api\//.test(String(q.path)) || q.method !== 'POST') return Promise.resolve({ ok: false, error: 'not a request this page makes' });
      var body = {}; body[q.field] = value;
      return api('POST', q.path, body).then(function (r) { return r.ok ? { ok: true, status: r.status, data: 'set' } : refused(r); });
    }
    function apply(q) {
      q = q || {};
      if (!ops[q.op]) return Promise.resolve({ ok: false, error: 'not a request this page makes' });
      return Promise.resolve().then(function () { return ops[q.op](q); }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
    }
    return { apply: apply, secret: secret, ops: Object.keys(ops) };
  }
  return { create: create, resultOf: resultOf, setPath: setPath, getPath: getPath, errorOf: errorOf, worked: worked, FOCUS: FOCUS };
});
