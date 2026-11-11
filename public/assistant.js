// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// public/assistant.js - THE OWNER'S SETUP CHAT (Oct 19 2026; the approved look Oct 20)
//
// What the page does that the server cannot:
//   KEYS: a key pasted into the box is caught by its shape (the patterns come from the server,
//     services/assistant/secrets.js), saved through the owner's own settings route - the same route, validation and
//     step-up as the Settings screen - and replaced in the message by what it was and its last four characters. The
//     model, the server's conversation and the owner's log never see it.
//   CHANGES: what the assistant proposes is applied HERE, with the owner's own session: straight in when it only
//     changes how things look, and only on the owner's "Yes" when it touches money, doors, hours, staffing or the
//     schedule. The page applies only requests to the product's own /api/ routes.
//   THE SITE, LIVE (maintainer, Oct 20: "this is how it looks as they build it"): the owner's own website beside the chat,
//     reloaded the moment a change is saved, with what changed named above it.
//   WHAT A MODEL CANNOT DO ITSELF: take photos (picked here, shrunk the way the Website editor shrinks them, uploaded to
//     its route; the model is told their addresses and the owner sees them), hand over a file (a download card), type a
//     secret (a masked card straight to the route or the setting), and the authenticator code when the owner has
//     locked the sensitive areas (asked here, never by the model).
//   VOICE: replies can be read aloud by the phone's own voice. There is no speech-to-text on this unit, so no microphone
//     is shown (the status route answers voice: false).
(() => {
  'use strict';
  let CSRF = '', conversation = null, patterns = null, busy = false;
  let cardOpen = null, queued = null;   // a change card waiting for Yes or No; a message typed while it waited
  const $ = (id) => document.getElementById(id);
  const $log = $('log'), $say = $('say'), $send = $('send'), $form = $('composer'), $chips = $('chips'), $frame = $('siteFrame');

  const scrollDown = () => { $log.scrollTop = $log.scrollHeight; };
  const add = (cls, text) => { const d = document.createElement('div'); d.className = 'b ' + cls; d.textContent = text; $log.appendChild(d); scrollDown(); return d; };
  const note = (text) => { const d = document.createElement('div'); d.className = 'note'; d.textContent = text; $log.appendChild(d); scrollDown(); return d; };
  const { setPath, errorOf } = window.BAAssistApply;

  // ── every request, with the authenticator code asked once when the owner has locked the sensitive areas ──
  let stepUpAsk = null;
  const askCode = () => stepUpAsk || (stepUpAsk = new Promise((resolve) => {
    const c = document.createElement('div'); c.className = 'card';
    const t = document.createElement('p'); t.textContent = 'This part is locked behind two-factor. Type the code from your authenticator app (or a recovery code) to carry on for the next 15 minutes.'; c.appendChild(t);
    const lab = document.createElement('label'); lab.className = 'sr'; lab.textContent = 'Authenticator code'; const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'numeric'; i.autocomplete = 'one-time-code'; i.id = 'stepCode' + Date.now(); lab.htmlFor = i.id; c.append(lab, i);
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'go'; ok.textContent = 'Unlock';
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Not now';
    const msg = document.createElement('p'); msg.className = 'done';
    row.append(ok, no); c.append(row, msg); $log.appendChild(c); scrollDown(); i.focus();
    const end = (v, words) => { row.remove(); i.disabled = true; msg.textContent = words; stepUpAsk = null; resolve(v); };
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      const r = await fetch('/api/auth/2fa/step-up', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': CSRF }, body: JSON.stringify({ code: i.value.trim() }) });
      if (r.ok) return end(true, 'Unlocked.');
      ok.disabled = false; msg.textContent = 'That code did not match - try again.';
    });
    no.addEventListener('click', () => end(false, 'Left locked.'));
  }));
  async function send(method, url, body, isForm) {
    const go = () => fetch(url, { method, credentials: 'same-origin', headers: isForm ? { 'x-csrf': CSRF } : { 'content-type': 'application/json', 'x-csrf': CSRF }, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)) });
    let r = await go();
    if (r.status === 403) {
      let peek = null; try { peek = await r.clone().json(); } catch {}
      if (peek && peek.stepUpRequired && await askCode()) r = await go();
    }
    let json = null; try { json = await r.json(); } catch {}
    // STILL WORKING (Oct 21 2026, latest): a turn that takes a while answers 202 { pending }, so a slow answer never meets
    // Cloudflare's 100-second limit over the tunnel - asked again until it is done (the box keeps working)
    // quick at first (most turns finish within seconds), then every two seconds for a long one
    const until = Date.now() + 20 * 60000;
    for (let n = 0; r.status === 202 && json && json.pending && Date.now() < until; n++) {
      await new Promise(ok => setTimeout(ok, n < 8 ? 250 : n < 16 ? 1000 : 2000));
      try { r = await fetch('/api/admin/assistant/pending/' + encodeURIComponent(json.pending), { credentials: 'same-origin', headers: { 'x-csrf': CSRF } }); } catch { continue; }
      const id = json.pending; json = null; try { json = await r.json(); } catch {}
      if (r.status === 202 && !(json && json.pending)) json = { pending: id };
    }
    return { ok: r.ok, status: r.status, json };
  }
  const api = (method, url, body) => send(method, url, body, false);
  // (Oct 25 2026) a sign-in ends (an hour idle, or twelve hours after it began - services/auth.js): said plainly, and a card that was
  // watching something stops - every request with the ended sign-in counts as a failed attempt, and twenty in fifteen minutes lock
  // this address out of the admin pages (server.js adminLimiter). The pairing and connecting cards asked again every two seconds
  // for ever; found when the overnight model run outlived its own twelve-hour sign-in
  const SIGNED_OUT = 'Your sign-in ended. Sign in on the admin page again, then come back here.';

  // ── keys: the same shapes the server knows ──
  function findKeys(text) {
    const out = []; const taken = (a, b) => out.some(f => a < f.end && b > f.start);
    const scan = (k) => { const re = new RegExp(k.source, 'g'); let m; while ((m = re.exec(text))) { const a = m.index, b = a + m[0].length; if (!taken(a, b)) out.push({ say: k.say, path: k.path, value: m[0], start: a, end: b, last4: m[0].slice(-4) }); } };
    for (const k of patterns.kinds) scan(k);
    // (or the Auth Token pasted on its own - the walk asks for it after the SID; it went to the assistant as words until Oct 22 2026)
    if (out.some(f => f.path === 'twilio.accountSid') || /^\s*[0-9a-fA-F]{32}\s*$/.test(text)) scan(patterns.twilioToken);
    return out.sort((x, y) => x.start - y.start);
  }
  const scrub = (text, found) => { let s = '', at = 0; for (const f of found) { s += text.slice(at, f.start) + `[${f.say} - ends in ${f.last4}]`; at = f.end; } return s + text.slice(at); };
  async function saveKeys(found) {
    const g = await api('GET', '/api/admin/config');
    if (!g.ok) return found.map(f => ({ say: f.say, last4: f.last4, ok: false, error: 'the settings could not be read' }));
    // an AI provider key has no field here: it is kept out of the chat and saved only in Hosted AI settings
    const kept = found.filter(f => f.path);
    for (const f of kept) setPath(g.json, f.path, f.value);
    const p = kept.length ? await api('POST', '/api/admin/config', g.json) : { ok: true };
    return found.map(f => !f.path
      ? { say: f.say, last4: f.last4, ok: false, error: 'an AI provider key is entered only in Admin > Owner Chat > Hosted AI settings - it was not sent to the assistant' }
      : { say: f.say, last4: f.last4, ok: p.ok, error: p.ok ? null : errorOf(p) });
  }

  // ── the site, live ──
  // the page as saved (live=1: no "unsaved changes" tag); the part that changed scrolled into view and lit up for a moment,
  // or, when nothing in particular changed, the place the owner was looking at kept
  const REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function refreshSite(what, focus) {
    let keepY = 0; try { keepY = (onHome && $frame.contentWindow) ? $frame.contentWindow.scrollY : 0; } catch {}
    onHome = true; $('addr').textContent = SITE_NAME;
    $frame.onload = () => {
      try {
        const w = $frame.contentWindow, d = $frame.contentDocument; wireFrame(d);
        const el = focus ? d.getElementById(focus) : null;
        if (el) {
          el.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' });
          if (!REDUCE && el.animate) el.animate([{ boxShadow: 'inset 0 0 0 5px rgba(47,128,237,.95)' }, { boxShadow: 'inset 0 0 0 5px rgba(47,128,237,0)' }], { duration: 2600, easing: 'ease-out' });
        } else if (keepY) w.scrollTo(0, keepY);
      } catch {}
    };
    $frame.src = '/landing?preview=1&live=1&_=' + Date.now();
    updated(what);
  }
  function updated(what) {
    if (!what) return;
    const u = $('updated'); u.hidden = false; u.textContent = 'Just updated: ' + what;
    if (document.body.dataset.tab === 'chat') { $('tabDot').classList.remove('sr'); $('tabDot').textContent = ' ●'; $('tabDot').setAttribute('aria-label', 'updated'); }
  }
  // ── THE SCREEN A CHANGE LIVES ON (Oct 20 2026; maintainer: "they tell the AI it moves them to that page and they see it update
  //    live"): every change and every look-up names its screen (services/assistant/screens.js) and the view beside the chat
  //    moves there and reloads - the homepage at the part that changed, a public page, the owner's admin panel at the card,
  //    or the Website editor at the card, each in its live view (frame=1: no header, no tabs, this session) ──
  let SITE_NAME = 'your site', onHome = true;
  const ADMIN_NAMES = { dashboard: 'Dashboard', bookings: 'Bookings', bays: 'Bays & Devices', sms: 'Messages', settings: 'Settings', pricing: 'Pricing',
    members: 'Members', revenue: 'Revenue', waivers: 'Waivers', log: 'Log' };
  // the views of the last change, when it has more than one (the website's menu and the server view of it): one button each
  let viewSet = null;
  const labelOf = (v) => v.label || (v.staff ? 'Server view' : v.site || v.page ? 'Your website' : v.editor ? 'Website editor' : 'Admin');
  function drawViews(cur) {
    const box = $('views'); box.textContent = ''; box.hidden = !(viewSet && viewSet.length > 1);
    if (box.hidden) return;
    for (const v of viewSet) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = labelOf(v); b.setAttribute('aria-pressed', String(v === cur));
      b.addEventListener('click', () => showScreen(v, null, null, true)); box.appendChild(b);
    }
  }
  function showScreen(sc, what, focus, sameChange) {
    if (!sameChange) viewSet = sc && Array.isArray(sc.also) && sc.also.length ? [sc].concat(sc.also) : null;
    drawViews(sc);
    $('openView').href = !sc || sc.site ? '/landing' : sc.page ? sc.page : sc.admin ? '/admin' : sc.editor ? '/admin-website' : sc.staff ? '/staff' : '/landing';
    // a screen that names a part of the homepage (a special put at the top) wins over the part the change saved
    if (!sc || sc.site) return refreshSite(what, (sc && sc.focus) || focus || null);
    let src = '', name = '';
    if (sc.page && /^\/[A-Za-z0-9/_.-]*$/.test(sc.page)) { src = sc.page + '?frame=1'; name = SITE_NAME + (sc.page === '/' ? '' : sc.page); }
    else if (sc.admin && /^[a-z]+$/.test(sc.admin)) { src = '/admin?frame=1&view=' + sc.admin + (sc.card && /^[A-Za-z]+$/.test(sc.card) ? '&card=' + sc.card : '') + (sc.part ? '&part=' + encodeURIComponent(String(sc.part).slice(0, 60)) : ''); name = 'Admin - ' + (ADMIN_NAMES[sc.admin] || sc.admin); }
    else if (sc.editor && /^card[A-Za-z]+$/.test(sc.editor)) { src = '/admin-website?frame=1&card=' + sc.editor; name = 'Website editor'; }
    // the staff pad's menu as a server sees it, at the part that changed (read-only: a tap rings nothing up)
    else if (sc.staff === 'menu') { src = '/staff?frame=1&view=menu' + (sc.part ? '&part=' + encodeURIComponent(String(sc.part).slice(0, 60)) : ''); name = 'Server view' + (sc.part ? ' - ' + sc.part : ''); }
    else return refreshSite(what, focus);
    onHome = false; $frame.onload = null;
    // a page of the owner's own opens at the section that changed (Oct 20 2026, late)
    const hash = sc.page && /^blk-[A-Za-z0-9_-]+$/.test(String(focus || '')) ? '#' + focus : '';
    $frame.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now() + hash;
    $('addr').textContent = name;
    updated(what);
  }
  // inside the live site: only the homepage can sit in this frame, so a link to another page opens beside the chat; and when
  // the owner is pointing at a part, a click picks it to talk about instead of following anything
  let pointing = false, about = null;
  const PARTS = 'section[id], header#hero, footer';
  function partName(el) {
    const L = window.BASiteLayout;
    if (el.id === 'hero') return { id: 'hero', name: 'the top of the page' };
    if (el.tagName === 'FOOTER') return { id: 'footer', name: 'the footer' };
    if (/^blk-/.test(el.id)) { const h = el.querySelector('h2'); return { id: el.id.slice(4), name: (h && h.textContent.trim()) || 'a section' }; }
    const type = L && L.SECTION_IDS[el.id]; return { id: type || el.id, name: (type && L.BUILTIN[type] ? L.BUILTIN[type].label : el.id) };
  }
  function wireFrame(d) {
    if (!d || d.__baWired) return; d.__baWired = true;
    let lit = null;
    const light = (el) => { if (lit && lit !== el) lit.style.outline = ''; lit = el; if (el) { el.style.outline = '4px dashed rgba(47,128,237,.9)'; el.style.outlineOffset = '-4px'; } };
    d.addEventListener('mouseover', (e) => { if (!pointing) { if (lit) light(null); return; } light(e.target.closest && e.target.closest(PARTS)); });
    d.addEventListener('click', (e) => {
      if (pointing) {
        const el = e.target.closest && e.target.closest(PARTS); e.preventDefault(); e.stopPropagation();
        if (!el) return;
        light(null); setPointing(false); about = partName(el); showAbout(); $say.focus(); return;
      }
      const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;   // a section of this page: it scrolls itself
      e.preventDefault(); window.open(new URL(href, location.origin).href, '_blank', 'noopener');
    }, true);
  }
  function setPointing(on) {
    pointing = on; const b = $('point'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Click a part of your site' : 'Point at a part';
    if (on && document.body.dataset.tab === 'chat') tab('site');
  }
  function showAbout() {
    const box = $('about'); box.textContent = ''; box.hidden = !about; if (!about) return;
    const t = document.createElement('span'); t.textContent = 'About: ' + about.name;
    const x = document.createElement('button'); x.type = 'button'; x.textContent = 'x'; x.setAttribute('aria-label', 'Stop talking about ' + about.name); x.addEventListener('click', () => { about = null; showAbout(); });
    box.append(t, x); if (document.body.dataset.tab === 'site') tab('chat');
  }
  // the device the site is looked at on: the whole width, or a phone's
  function setViewport(which) { $('frameBox').classList.toggle('phone', which === 'phone'); $('vwComputer').setAttribute('aria-pressed', String(which !== 'phone')); $('vwPhone').setAttribute('aria-pressed', String(which === 'phone')); }

  // UNDO, ONE TAP (Oct 20 2026): each website change the assistant made can be taken back from its own line; only the newest
  // change of a part keeps its Undo (an older one would take back the newer). The assistant is told on the next message.
  const WEB_OPS = new Set(['content', 'layout', 'nav', 'undo']);
  const undoFor = new Map(); const undone = [];
  function offerUndo(host, p, res) {
    if (!res || !res.ok || !Array.isArray(res.keys) || !res.keys.length) return;
    for (const k of res.keys) { const old = undoFor.get(k); if (old) old.remove(); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'undo'; b.textContent = 'Undo'; b.setAttribute('aria-label', 'Undo: ' + p.describe);
    for (const k of res.keys) undoFor.set(k, b);
    b.addEventListener('click', async () => {
      b.disabled = true; let ok = true;
      for (const k of res.keys.slice().reverse()) { const r = await applier.apply({ op: 'undo', key: k }); ok = ok && r.ok; if (undoFor.get(k) === b) undoFor.delete(k); }
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'undone', textContent: ok ? ' Undone.' : ' Could not undo - try Previous versions on the Website editor.' }));
      if (ok) { undone.push(p.describe); refreshSite('Undone: ' + p.describe, res.focus); }
    });
    host.appendChild(b);
  }

  async function refreshStep() {
    const r = await api('GET', '/api/admin/setup-status');
    const items = (r.json && r.json.items) || [];
    if (!items.length) { $('step').textContent = 'Ask me anything about your facility'; return; }
    const todo = items.filter(i => !i.done && !i.optional);
    const done = items.filter(i => i.done).length;
    $('step').textContent = todo.length ? `${done} of ${items.length} set up · next: ${todo[0].label}` : 'Setup is done · ask me to change anything';
  }

  // ── changes: applied with the owner's own session, by the one module the battery runs too (assistant-apply.js) ──
  // A SPECIAL'S FLYER (Oct 20 2026, late): drawn here, where the site's own fonts can load (public/flyer.js), and saved like
  // any photo - the canvas waits for the fonts, the special's photo and the logo first, so the card never falls back to a
  // system face
  async function drawFlyer(spec, src) {
    if (!window.BAFlyer) return null;
    if (spec.fontHref && !document.querySelector('link[data-flyer-fonts]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = spec.fontHref; l.dataset.flyerFonts = '1'; document.head.appendChild(l);
      await new Promise(r => { l.onload = r; l.onerror = r; setTimeout(r, 5000); });
    }
    const f = spec.fonts || {};
    try { await Promise.all(['700 100px ' + f.heading, '400 40px ' + f.body, '700 40px ' + f.body].map(x => document.fonts.load(x))); } catch {}
    const load = (u) => u ? new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = u; }) : Promise.resolve(null);
    let logoUrl = ''; if (src.logo) { try { const g = await api('GET', '/api/uploads/logo'); logoUrl = g.ok && g.json && g.json.hasLogo ? g.json.url : ''; } catch {} }
    const [photo, logo] = await Promise.all([load(src.photo), load(logoUrl)]);
    const cv = document.createElement('canvas'); cv.width = window.BAFlyer.W; cv.height = window.BAFlyer.H;
    window.BAFlyer.draw(cv.getContext('2d'), spec, { photo, logo });
    return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
  }
  async function uploadFlyer(blob, name) {
    const fd = new FormData(); fd.append('photo', blob, name || 'flyer.jpg');
    const r = await send('POST', '/api/website/upload', fd, true);
    return r.ok && r.json && r.json.path ? { ok: true, path: r.json.path } : { ok: false, error: errorOf(r) };
  }
  const applier = window.BAAssistApply.create({ api, layout: window.BASiteLayout, draw: drawFlyer, upload: uploadFlyer });
  // the flyer itself, in the chat - whatever day it is for (the slides show it only on its day) - and its downloads at the sizes
  // Facebook and Instagram use (Oct 22 2026, night; maintainer: "export it and put in on FB? like we do for turf league tracker")
  function flyerCard(path, o) {
    o = o || {};
    const c = card(o.slides === false ? 'The flyer - ready to download and to email out:' : 'The flyer - in your homepage\'s slides, ready to download and to email out:', 'FLYER');
    const a = document.createElement('a'); a.href = path; a.target = '_blank'; a.rel = 'noopener';
    const im = document.createElement('img'); im.src = path; im.alt = 'The flyer'; im.style.cssText = 'display:block;width:100%;max-width:280px;border-radius:8px;margin-top:8px';
    a.appendChild(im); c.appendChild(a);
    if (!window.BAFlyer || !window.BAFlyer.download) return;
    const row = document.createElement('div'); row.className = 'chips'; row.style.marginTop = '8px';
    [['post', 'Download for a Facebook or Instagram post'], ['square', 'Square'], ['story', 'Story']].forEach(([size, words]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = words;
      b.onclick = () => window.BAFlyer.download(im, size, o, o.name || 'flyer');
      row.appendChild(b);
    });
    c.appendChild(row);
    const tip = document.createElement('div'); tip.style.cssText = 'font-size:12px;opacity:.8;margin-top:6px';
    tip.textContent = 'To share it: download it, then make a new post (or a Story) on Facebook or Instagram and add the picture.';
    c.appendChild(tip);
  }
  async function apply(p) {
    const r = await applier.apply(p.request || {});
    if (r.ok && r.shown) revealCard(p, r.shown);   // the owner's eyes only - never sent on to the assistant
    if (r.ok && r.image) flyerCard(r.image, r.flyer);
    return { id: p.id, applied: true, ok: !!r.ok, status: r.status, error: r.ok ? null : (r.error || 'it did not happen'), data: r.ok ? r.data : null, focus: r.focus, keys: r.keys };
  }
  // FOR THE OWNER'S EYES (Oct 20 2026): a value a change made that the owner needs and the assistant must never see - a new
  // member's PIN, a gift card's code. Shown here with a Copy button; the result sent back carries only "done".
  function revealCard(p, shown) {
    const c = card(p.describe, 'FOR YOUR EYES ONLY');
    for (const [label, value] of shown) {
      const row = document.createElement('div'); row.className = 'row'; row.style.alignItems = 'center';
      const t = document.createElement('p'); t.textContent = label + ': '; const b = document.createElement('b'); b.textContent = value; t.appendChild(b);
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy'; copy.setAttribute('aria-label', 'Copy ' + label);
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(value); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select it to copy'; } });
      row.append(t, copy); c.appendChild(row);
    }
    const n = document.createElement('p'); n.className = 'done'; n.textContent = 'Only you see this - it is not in the chat with the assistant.'; c.appendChild(n);
  }

  const card = (describe, kicker) => {
    const c = document.createElement('div'); c.className = 'card';
    if (kicker) { const k = document.createElement('div'); k.className = 'kicker'; k.textContent = kicker; c.appendChild(k); }
    const t = document.createElement('p'); t.textContent = describe; c.appendChild(t);
    $log.appendChild(c); scrollDown(); return c;
  };
  // A SECRET THE MODEL NEVER SEES: a masked box (twice when asked), sent straight to the owner's own route, or into a
  // setting by its place (a bay PC's Windows password); only "set" or the refusal goes back to the assistant.
  const askSecret = (p) => new Promise((resolve) => {
    const q = p.request || {};
    const c = card(p.describe, 'KEEPS IT PRIVATE');
    if (q.hint) { const h = document.createElement('p'); h.textContent = q.hint; h.style.fontSize = '14px'; c.appendChild(h); }
    const mk = (label) => { const lab = document.createElement('label'); lab.className = 'sr'; lab.textContent = label; const i = document.createElement('input'); i.type = 'password'; i.autocomplete = 'new-password'; i.placeholder = label; i.id = 'sec' + Math.random().toString(36).slice(2); lab.htmlFor = i.id; c.append(lab, i); return i; };
    const one = mk(q.label || 'Type it here'), two = q.confirmTwice ? mk('Type it again') : null;
    const row = document.createElement('div'); row.className = 'row';
    const save = document.createElement('button'); save.className = 'go'; save.type = 'button'; save.textContent = 'Save'; save.setAttribute('aria-label', 'Save: ' + (q.label || 'it'));
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Not now'; no.setAttribute('aria-label', 'Not now: ' + (q.label || 'it'));
    const msg = document.createElement('p'); msg.className = 'done';
    row.append(save, no); c.append(row, msg); one.focus();
    const finish = (r, words) => { row.remove(); one.remove(); if (two) two.remove(); msg.textContent = words; resolve(r); };
    save.addEventListener('click', async () => {
      const v = one.value;
      if (q.minLength && v.length < q.minLength) { msg.textContent = `At least ${q.minLength} characters.`; return; }
      if (two && v !== two.value) { msg.textContent = 'The two do not match - type it again.'; return; }
      save.disabled = no.disabled = true;
      const r = await applier.secret(q, v);
      one.value = ''; if (two) two.value = '';
      finish({ id: p.id, applied: true, ok: !!r.ok, status: r.status, error: r.ok ? null : r.error }, r.ok ? 'Saved.' : 'Not saved: ' + r.error);
    });
    no.addEventListener('click', () => finish({ id: p.id, applied: false }, 'Not now.'));
  });
  // PAIRING A DEVICE (Oct 19 2026): the hub's pairing runs on the unit; this card starts it, shows what to do next (press
  // the button, type the PIN on the label), and tells the assistant what joined. The PIN goes from this box to the unit,
  // never into the chat.
  const pairCard = (p) => new Promise((resolve) => {
    const q = p.request || {};
    const c = card(p.describe, 'PAIRING');
    const st = document.createElement('p'); st.className = 'done'; st.setAttribute('aria-live', 'polite'); st.textContent = 'Starting...'; c.appendChild(st);
    const pinRow = document.createElement('div'); pinRow.className = 'row'; pinRow.style.display = 'none';
    const pin = document.createElement('input'); pin.inputMode = 'numeric'; pin.maxLength = 5; pin.autocomplete = 'off'; pin.placeholder = '5-digit PIN'; pin.setAttribute('aria-label', 'The 5-digit PIN on the device’s label');
    pin.style.cssText = 'flex:1;min-width:0';
    const sendPin = document.createElement('button'); sendPin.className = 'go'; sendPin.type = 'button'; sendPin.textContent = 'Send PIN'; sendPin.setAttribute('aria-label', 'Send the PIN to the hub');
    pinRow.append(pin, sendPin);
    const row = document.createElement('div'); row.className = 'row';
    const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = 'Stop pairing'; stop.setAttribute('aria-label', 'Stop pairing');
    row.appendChild(stop); c.append(pinRow, row); scrollDown();
    let over = false, timer = null;
    const finish = (r, words) => { if (over) return; over = true; clearTimeout(timer); row.remove(); pinRow.remove(); st.textContent = words; resolve(r); };
    const left = (s) => s == null ? '' : ` (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left)`;
    const poll = async () => {
      if (over) return;
      const r = await api('GET', '/api/admin/smarthome/pair');
      const s = r.json || {};
      if (r.status === 401) return finish({ id: p.id, applied: true, ok: false, error: 'the sign-in ended before the pairing finished' }, SIGNED_OUT + ' Then ask "what devices do we have" to see whether it joined.');
      if (!r.ok) { timer = setTimeout(poll, 2000); return; }
      if (s.pairing) {
        st.textContent = (s.say || 'Pairing...') + (['waiting', 'needs_pin'].includes(s.state) ? left(s.secondsLeft) : '');
        const wantPin = s.state === 'needs_pin';
        if (wantPin && pinRow.style.display === 'none') { pinRow.style.display = ''; pin.focus(); }
        if (!wantPin) pinRow.style.display = 'none';
        timer = setTimeout(poll, 1500); return;
      }
      if (s.state === 'done') {
        const controls = (s.controls || []).map(x => ({ control: x.entity_id, name: x.name, what: x.what, is: x.state }));
        return finish({ id: p.id, applied: true, ok: true, data: { joined: s.device ? s.device.name : 'a device', kind: s.kind, maker: (s.device && s.device.maker) || undefined, model: (s.device && s.device.model) || undefined, controls, note: s.say || undefined, low_security: s.lowSecurity || undefined } },
          (s.say || 'Paired.') + (controls.length ? ' It controls: ' + controls.map(x => x.name).join(', ') + '.' : ''));
      }
      finish({ id: p.id, applied: true, ok: false, error: s.say || 'nothing joined' }, s.say || 'Nothing joined.');
    };
    sendPin.addEventListener('click', async () => {
      if (!/^\d{5}$/.test(pin.value.trim())) { st.textContent = 'The PIN is five digits.'; return; }
      sendPin.disabled = true;
      const r = await api('POST', '/api/admin/smarthome/pair/pin', { pin: pin.value.trim() });
      pin.value = ''; sendPin.disabled = false;
      if (!r.ok) st.textContent = errorOf(r);
    });
    stop.addEventListener('click', async () => { stop.disabled = true; await api('POST', '/api/admin/smarthome/pair/stop'); });
    (async () => {
      const r = await api('POST', '/api/admin/smarthome/pair', { protocol: q.protocol, code: q.code });
      if (!r.ok) return finish({ id: p.id, applied: true, ok: false, status: r.status, error: errorOf(r) }, 'Not started: ' + errorOf(r));
      poll();
    })();
  });
  // CONNECT MY BOX (Oct 21 2026): the box signs in to the owner's own Cloudflare with cloudflared's own sign-in. This card
  // starts it on the owner's tap, shows Cloudflare's sign-in button (the link goes from the box to this page, never through
  // the assistant), follows the box's stages, and tells the assistant how it ended.
  const CONNECT_STAGE = { starting: 'Starting...', 'waiting-for-signin': 'Waiting for you: sign in to Cloudflare, pick your domain, and tap Authorize. This card finishes on its own.',
    'making-the-tunnel': 'Signed in - making the box\'s own connection...', 'pointing-the-address': 'Pointing your address at the box...',
    'starting-the-connection': 'Starting the connection...', 'checking-from-outside': 'Checking your address from outside - this can take a minute or two...' };
  const connectCard = (p) => new Promise((resolve) => {
    const q = p.request || {};
    const c = card(p.describe, 'CONNECT MY BOX');
    const st = document.createElement('p'); st.className = 'done'; st.setAttribute('aria-live', 'polite');
    const row = document.createElement('div'); row.className = 'row';
    const go = document.createElement('button'); go.className = 'go'; go.type = 'button'; go.textContent = 'Connect'; go.setAttribute('aria-label', 'Connect the box to Cloudflare');
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Not now'; no.setAttribute('aria-label', 'Not now: connect the box');
    row.append(go, no); c.append(row, st); scrollDown();
    let over = false, timer = null;
    const finish = (r, words) => { if (over) return; over = true; clearTimeout(timer); row.remove(); st.textContent = words; resolve(r); };
    const poll = async () => {
      if (over) return;
      const r = await api('GET', '/api/admin/getonline');
      if (r.status === 401) return finish({ id: p.id, applied: true, ok: false, error: 'the sign-in ended before the box was connected' }, SIGNED_OUT + ' Then ask "is my site up yet".');
      const j = r.ok && r.json ? r.json.job : null;
      if (!j) { timer = setTimeout(poll, 2500); return; }
      if (!j.finishedAt) { st.textContent = CONNECT_STAGE[j.stage] || j.stage; timer = setTimeout(poll, 2000); return; }
      if (j.stage === 'done') return finish({ id: p.id, applied: true, ok: true, data: { status: 'connected', did: 'connected the box at ' + (j.addresses || []).join(', '), note: j.reachable ? 'it answers from outside' : 'not answering from outside yet - a new address can take a few minutes' } },
        'Connected at ' + (j.addresses || []).join(', ') + (j.reachable ? ' - it answers from outside.' : ' - it can take a few minutes to answer from outside.'));
      if (j.stage === 'cancelled') return finish({ id: p.id, applied: false }, 'Stopped.');
      finish({ id: p.id, applied: true, ok: false, error: j.error || 'it did not finish' }, 'Not connected: ' + (j.error || 'it did not finish'));
    };
    no.addEventListener('click', () => finish({ id: p.id, applied: false }, 'Not now.'));
    go.addEventListener('click', async () => {
      go.disabled = no.disabled = true; st.textContent = 'Starting...';
      const r = await api('POST', '/api/admin/getonline/connect', { addresses: q.addresses, replace: q.replace === true });
      if (!r.ok || !r.json || !r.json.url) return finish({ id: p.id, applied: true, ok: false, status: r.status, error: errorOf(r) }, 'Not started: ' + errorOf(r));
      go.remove(); no.remove();
      const a = document.createElement('a'); a.className = 'btn go'; a.href = r.json.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = "Open Cloudflare's sign-in";
      a.setAttribute('aria-label', "Open Cloudflare's sign-in in a new tab");
      const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = 'Stop'; stop.setAttribute('aria-label', 'Stop connecting');
      stop.addEventListener('click', async () => { stop.disabled = true; await api('DELETE', '/api/admin/getonline/connect'); });
      row.append(a, stop);
      poll();
    });
  });
  // A FILE THE OWNER PICKS (the logo, a PDF page, a waiver document): the card asks for it and sends it to its own route
  // as the screen would; pictures are shrunk first the way the Website editor shrinks them.
  const shrink = (file, max) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { let w = img.width, h = img.height; if (w > max) { h = Math.round(h * max / w); w = max; } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); c.toBlob(b => b ? res(b) : rej(new Error('Resize failed')), 'image/jpeg', 0.82); };
    img.onerror = () => rej(new Error('Could not read that picture'));
    img.src = URL.createObjectURL(file);
  });
  const uploadCard = (p) => new Promise((resolve) => {
    const q = p.request || {};
    const c = card(p.describe, 'ADD A FILE');
    const lab = document.createElement('label'); lab.className = 'btn go'; lab.textContent = q.label || 'Choose a file';
    const f = document.createElement('input'); f.type = 'file'; f.accept = q.accept || ''; f.className = 'sr'; lab.appendChild(f);
    const row = document.createElement('div'); row.className = 'row';
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Not now';
    const msg = document.createElement('p'); msg.className = 'done';
    row.append(lab, no); c.append(row, msg); scrollDown();
    const finish = (r, words) => { row.remove(); msg.textContent = words; resolve(r); };
    f.addEventListener('change', async () => {
      const file = f.files && f.files[0]; if (!file) return;
      if (!/^\/api\//.test(String(q.route))) return finish({ id: p.id, applied: true, ok: false, error: 'not a request this page makes' }, 'Not done.');
      msg.textContent = 'Sending...';
      try {
        const fd = new FormData();
        if (q.shrink && /^image\//.test(file.type)) fd.append(q.field, await shrink(file, q.shrink), (file.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg');
        else fd.append(q.field, file, file.name);
        // (the form's other fields a route needs beside the file - the waiver's name and version, Oct 22 2026)
        if (q.fields && typeof q.fields === 'object') for (const k of Object.keys(q.fields)) fd.append(k, String(q.fields[k]));
        const r = await send('POST', q.route, fd, true);
        const j = r.json || {};
        const ok = r.ok && j.success !== false && j.ok !== false;
        finish({ id: p.id, applied: true, ok, status: r.status, error: ok ? null : errorOf(r), data: ok ? { file: file.name, path: j.path || j.url || undefined } : null }, ok ? 'Added: ' + file.name : 'Not added: ' + errorOf(r));
      } catch (e) { finish({ id: p.id, applied: true, ok: false, error: String(e && e.message || e) }, 'Not added: ' + (e && e.message || e)); }
    });
    no.addEventListener('click', () => finish({ id: p.id, applied: false }, 'Not now.'));
  });
  // A FILE FOR THE OWNER (a bay's watcher, an export): fetched with the owner's own session and saved by the browser.
  const downloadCard = (p) => new Promise((resolve) => {
    const q = p.request || {};
    const c = card(p.describe, 'DOWNLOAD');
    const row = document.createElement('div'); row.className = 'row';
    const get = document.createElement('button'); get.type = 'button'; get.className = 'go'; get.textContent = q.label || 'Download';
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Not now';
    const msg = document.createElement('p'); msg.className = 'done';
    row.append(get, no); c.append(row, msg); scrollDown();
    const finish = (r, words) => { row.remove(); msg.textContent = words; resolve(r); };
    get.addEventListener('click', async () => {
      if (!/^\/api\//.test(String(q.path))) return finish({ id: p.id, applied: true, ok: false, error: 'not a request this page makes' }, 'Not done.');
      get.disabled = true; msg.textContent = 'Getting it ready...';
      let r = await fetch(q.path, { credentials: 'same-origin', headers: { 'x-csrf': CSRF } });
      if (r.status === 403 && await askCode()) r = await fetch(q.path, { credentials: 'same-origin', headers: { 'x-csrf': CSRF } });
      if (!r.ok) { let j = null; try { j = await r.json(); } catch {} return finish({ id: p.id, applied: true, ok: false, status: r.status, error: (j && j.error) || ('it answered ' + r.status) }, 'Not downloaded: ' + ((j && j.error) || r.status)); }
      const blob = await r.blob();
      const name = q.filename || ((r.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/) || [])[1] || 'download';
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      finish({ id: p.id, applied: true, ok: true, data: { file: name, bytes: blob.size } }, 'Downloaded: ' + name);
    });
    no.addEventListener('click', () => finish({ id: p.id, applied: false }, 'Not now.'));
  });
  const ask = (p) => new Promise((resolve) => {
    const c = card(p.describe, 'CHANGE TO APPROVE');
    const row = document.createElement('div'); row.className = 'row';
    const yes = document.createElement('button'); yes.className = 'go'; yes.type = 'button'; yes.textContent = 'Yes, do it'; yes.setAttribute('aria-label', 'Yes, do it: ' + p.describe);
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'No'; no.setAttribute('aria-label', 'No, do not: ' + p.describe);
    row.append(yes, no); c.appendChild(row);
    const done = async (go, movedOn) => {
      cardOpen = null; $send.disabled = true;
      yes.disabled = no.disabled = true;
      const r = go ? await apply(p) : { id: p.id, applied: false };
      const web = WEB_OPS.has(p.request && p.request.op);
      row.remove(); const d = document.createElement('p'); d.className = 'done'; d.textContent = !go ? (movedOn ? 'Not done - you moved on to something else.' : 'Not done.') : r.ok ? (web ? 'Saved - it is on your site.' : 'Done.') : 'Not done: ' + r.error; c.appendChild(d);
      if (go && web) offerUndo(d, p, r);
      resolve(r);
    };
    yes.addEventListener('click', () => done(true)); no.addEventListener('click', () => done(false));
    // THE OWNER CAN TYPE WHILE A CARD WAITS (Oct 24 2026 - the chat at every size: the Send button stayed off until Yes or No, so
    // "actually make it $35" meant tapping No and typing again): a new message is this card's No, said as "you moved on", and is
    // sent the moment the card's answer has been told to the assistant
    cardOpen = () => done(false, true); $send.disabled = false;
  });

  // ── quick answers the assistant offers ──
  // (one row that scrolls sideways - maintainer, Oct 25 2026: "Make this as scroll along the bottom ... You can add more if its suggested
  // prompts": the facility's questions all fit in it; the edge with more to see fades - more-l / more-r - and a wheel scrolls it)
  function showChoices(list) {
    $chips.textContent = ''; $chips.scrollLeft = 0;
    for (const label of (list || []).slice(0, 26)) {   // (two dozen of the facility's questions and "What else can you do?" - engine.js CARDS_SHOWN)
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', 'Answer: ' + label);
      b.addEventListener('click', () => { if (busy) return; $chips.textContent = ''; chipEdges(); say(label); });
      $chips.appendChild(b);
    }
    chipEdges();
  }
  function chipEdges() {
    const more = $chips.scrollWidth - $chips.clientWidth;
    $chips.classList.toggle('more-l', more > 2 && $chips.scrollLeft > 2);
    $chips.classList.toggle('more-r', more > 2 && $chips.scrollLeft < more - 2);
  }
  $chips.addEventListener('scroll', chipEdges, { passive: true });
  window.addEventListener('resize', chipEdges);
  $chips.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && $chips.scrollWidth > $chips.clientWidth) { $chips.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });

  async function handle(r, afterChange) {
    if (!r.ok) { note(r.status === 401 ? SIGNED_OUT : errorOf(r)); return; }
    const j = r.json || {};
    if (j.conversation) conversation = j.conversation;
    if (j.keyRemoved) note('A key was taken out of your message before it went anywhere. Paste it again on its own and it will be saved.');
    if (j.reply) { add('ai', j.reply); aloud(j.reply); }
    if (j.reply && Array.isArray(j.sources) && j.sources.length) { const s = document.createElement('div'); s.className = 'src'; s.textContent = 'From your guide: ' + [...new Set(j.sources.map(x => String(x.heading).split(' > ').pop()))].join(' · '); $log.appendChild(s); scrollDown(); }
    showChoices(j.choices);
    const props = j.proposals || [];
    // an answer with no change: the view moves to what the AI looked at - but never away from a change just made
    if (!props.length) { if (j.screen && !afterChange) showScreen(j.screen); return; }
    const results = [];
    let changed = null, focus = null, screen = null;
    for (const p of props) {
      const op = p.request && p.request.op;
      let res;
      if (op === 'secret') res = await askSecret(p);
      else if (op === 'pair') res = await pairCard(p);
      else if (op === 'connect') res = await connectCard(p);
      else if (op === 'upload') res = await uploadCard(p);
      else if (op === 'download') res = await downloadCard(p);
      else if (p.confirm) res = await ask(p);
      else { res = await apply(p); const n = note(res.ok ? 'Done: ' + p.describe : 'Not done: ' + p.describe + ' - ' + res.error); if (WEB_OPS.has(op)) offerUndo(n, p, res); }
      if (res && res.ok && op !== 'download') { changed = p.describe; if (res.focus) focus = res.focus; if (p.screen !== undefined) screen = p.screen; }
      results.push(res);
    }
    if (changed) { showScreen(screen, changed, focus); refreshStep(); }
    await handle(await api('POST', '/api/admin/assistant/applied', { conversation, results }), afterChange || !!changed);
  }

  async function say(text, quiet) {
    if (busy) return; busy = true; $send.disabled = true; $chips.textContent = '';
    try {
      const found = findKeys(text);
      const keysSaved = found.length ? await saveKeys(found) : [];
      const shown = scrub(text, found);
      if (shown.trim() && !quiet) add('owner', shown);
      for (const k of keysSaved) note(k.ok ? `Saved your ${k.say} (it ends in ${k.last4}).` : `Your ${k.say} was not saved: ${k.error}`);
      const thinking = note('Thinking...');
      let sent = shown || '(the owner pasted a key)';
      if (about && !quiet) sent = `(About the homepage's ${about.name === 'the top of the page' || about.name === 'the footer' ? about.name : `section "${about.name}" (id ${about.id})`}) ` + sent;
      if (undone.length) sent = `(The owner undid: ${undone.splice(0).join('; ')}.) ` + sent;
      const r = await api('POST', '/api/admin/assistant/turn', { conversation, text: sent, keysSaved });
      thinking.remove();
      await handle(r);
    } catch (e) { note('Something went wrong: ' + String(e && e.message || e)); }
    finally { busy = false; $send.disabled = false; $say.focus(); if (queued !== null) { const t = queued; queued = null; say(t); } }
  }

  // ── photos: picked here, shrunk like the Website editor shrinks them, uploaded, shown, and named to the assistant ──
  $('attach').addEventListener('click', () => { if (!busy) $('photos').click(); });
  $('photos').addEventListener('change', async () => {
    const files = [...($('photos').files || [])].slice(0, 12); $('photos').value = '';
    if (!files.length || busy) return;
    const strip = document.createElement('div'); strip.className = 'thumbs';
    files.forEach((f, i) => { const fig = document.createElement('figure'); const im = document.createElement('img'); im.src = URL.createObjectURL(f); im.alt = 'Photo ' + (i + 1) + ': ' + f.name; const cap = document.createElement('figcaption'); cap.textContent = String(i + 1); fig.append(im, cap); strip.appendChild(fig); });
    $log.appendChild(strip); scrollDown();
    const sending = note(`Adding ${files.length} photo${files.length === 1 ? '' : 's'}...`);
    const paths = [];
    for (const f of files) {
      try {
        const fd = new FormData(); fd.append('photo', await shrink(f, 2000), (f.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg');
        const r = await send('POST', '/api/website/upload', fd, true);
        paths.push(r.ok && r.json && r.json.path ? r.json.path : null);
        if (!r.ok) note(`Photo ${paths.length} (${f.name}) was not added: ${errorOf(r)}`);
      } catch (e) { paths.push(null); note(`Photo ${paths.length} (${f.name}) could not be read.`); }
    }
    sending.remove();
    // one address to a line, nothing after it: a model copies a sentence's full stop into the address otherwise
    const okOnes = paths.map((p, i) => p ? `photo ${i + 1} = ${p}` : null).filter(Boolean);
    if (!okOnes.length) return;
    say(`(The owner added ${okOnes.length} photo${okOnes.length === 1 ? '' : 's'} for the website. You cannot see them; the owner can. When the owner has not said where they go, ask which should lead the top of the site, then place them:\n${okOnes.join('\n')}\n)`, true);
  });

  // ── phone: the chat and the site, a tab apart ──
  const tab = (which) => {
    document.body.dataset.tab = which;
    $('tabChat').setAttribute('aria-selected', String(which === 'chat')); $('tabSite').setAttribute('aria-selected', String(which === 'site'));
    if (which === 'site') { $('tabDot').classList.add('sr'); $('tabDot').textContent = '- updated'; }
  };
  // pointing is at a part of the homepage: from another screen, the homepage comes back first
  $('point').addEventListener('click', () => { if (!pointing && !onHome) refreshSite(null); setPointing(!pointing); });
  $('vwComputer').addEventListener('click', () => setViewport('computer'));
  $('vwPhone').addEventListener('click', () => setViewport('phone'));
  $('tabChat').addEventListener('click', () => tab('chat'));
  $('tabSite').addEventListener('click', () => tab('site'));

  // ── VOICE: said, not typed (Oct 21 2026). Tap the microphone, talk, tap it again: the recording (16 kHz, 16-bit, one
  //    channel - what the box's voice reads without converting) goes to the box, comes back as words, and is sent as typed
  //    words. Shown only when the box's voice answers and this browser will open a microphone (an https address only). ──
  const $mic = $('mic'), $speak = $('speak');
  let rec = null, speakOn = false;
  const MAX_SECS = 90;
  function wav16k(chunks, rate) {
    let n = 0; for (const c of chunks) n += c.length;
    const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const ratio = rate / 16000, len = Math.floor(all.length / ratio), pcm = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const at = i * ratio, k = Math.floor(at), f = at - k, v = all[k] + ((all[k + 1] !== undefined ? all[k + 1] : all[k]) - all[k]) * f;
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    const buf = new ArrayBuffer(44 + pcm.length * 2), dv = new DataView(buf);
    const str = (at, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(at + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return new Blob([buf], { type: 'audio/wav' });
  }
  async function micStart() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try { await ctx.resume(); } catch {}          // some phones make it paused even inside the tap (Safari)
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), chunks = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc); proc.connect(ctx.destination);
    rec = { stream, ctx, src, proc, chunks, rate: ctx.sampleRate, timer: setTimeout(() => { if (rec) micStop(); }, MAX_SECS * 1000) };
    $mic.classList.add('rec'); $mic.setAttribute('aria-pressed', 'true'); $mic.setAttribute('aria-label', 'Listening - tap to send what you said');
  }
  async function micStop() {
    const r = rec; rec = null; if (!r) return;
    clearTimeout(r.timer);
    try { r.proc.disconnect(); r.src.disconnect(); } catch {}
    r.stream.getTracks().forEach(t => t.stop());
    try { await r.ctx.close(); } catch {}
    $mic.classList.remove('rec'); $mic.setAttribute('aria-pressed', 'false'); $mic.setAttribute('aria-label', 'Talk instead of typing');
    const heard = note('Listening to what you said...');
    let res = null;
    try {
      // BA Core Community has no speech-to-text on the unit (the status answers voice: false and the microphone stays
      // hidden), so a recording has nowhere to go.
      res = { error: 'speech-to-text is not available on this unit - type it for now' };
    } catch (e) { res = { error: 'type it for now' }; }
    heard.remove();
    if (res && res.text) say(res.text); else note((res && res.error) ? cap1(res.error) + '.' : 'Nothing came back - type it for now.');
  }
  const cap1 = (t) => String(t).replace(/^./, c => c.toUpperCase()).replace(/\.$/, '');
  $mic.addEventListener('click', async () => {
    if (rec) return micStop();
    if (busy) return;
    try { await micStart(); } catch (e) { note('The microphone did not open' + (e && e.name === 'NotAllowedError' ? ' - allow it for this page in your browser, then tap it again.' : '.')); }
  });
  // replies read aloud by this phone's own voice - a choice kept on this phone only
  function aloud(text) { try { if (speakOn && window.speechSynthesis) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(text).slice(0, 600))); } } catch {} }
  function setSpeak(on) { speakOn = on; $speak.setAttribute('aria-pressed', String(on)); const w = 'Read replies aloud: ' + (on ? 'on' : 'off'); $speak.setAttribute('aria-label', w); $speak.title = w; try { localStorage.setItem('ba.assistant.speak', on ? '1' : '0'); } catch {} if (!on) { try { window.speechSynthesis.cancel(); } catch {} } }
  $speak.addEventListener('click', () => setSpeak(!speakOn));
  function voiceReady(v) {
    if (window.speechSynthesis) { $speak.hidden = false; let on = false; try { on = localStorage.getItem('ba.assistant.speak') === '1'; } catch {} setSpeak(on); }
    if (!v || !v.ready) return;                                    // no voice on this unit: no microphone (rule 31)
    // a browser opens a microphone only on a secure address (the facility's own https address): elsewhere none is shown and
    // nothing is said - the chat is the way, the microphone an extra (maintainer, Oct 21 2026); the guide says where it shows
    if (window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) $mic.hidden = false;
  }

  // a message sent while the last one is still being worked on (Enter in the box - the Send button is off): kept in the box
  // and said so, never cleared and dropped (Oct 21 2026, latest - a slow answer made it likely)
  let heldNote = null;
  $form.addEventListener('submit', (e) => {
    e.preventDefault(); const t = $say.value; if (!t.trim()) return;
    if (busy && cardOpen) { if (heldNote) { heldNote.remove(); heldNote = null; } $say.value = ''; fitSay(); queued = t; cardOpen(); return; }
    if (busy) { if (!heldNote || !heldNote.isConnected) heldNote = note('Still working on your last message - yours is kept in the box; send it when this one is done.'); return; }
    if (heldNote) { heldNote.remove(); heldNote = null; }
    $say.value = ''; fitSay(); say(t);
  });
  $say.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $form.requestSubmit(); } });
  // the box grows with what is typed, up to its own max-height (then it scrolls), and goes back to its size once sent (Oct 23 2026)
  // (empty, it is the page's own size for that screen; a turned tablet fits it again)
  const fitSay = () => { $say.style.height = ''; if (!$say.value) return; $say.style.height = 'auto'; const max = parseFloat(getComputedStyle($say).maxHeight) || 300; $say.style.height = Math.min($say.scrollHeight + 2, max) + 'px'; };
  $say.addEventListener('input', fitSay);
  addEventListener('resize', fitSay);

  (async () => {
    const s = await api('GET', '/api/auth/admin/session');
    if (!s.ok) { note('Sign in on the admin page first, then come back here.'); $send.disabled = true; return; }
    CSRF = s.json.csrf || '';
    refreshSite(null); refreshStep();
    try { const c = await api('GET', '/api/admin/config'); const d = c.json && c.json.seo && c.json.seo.domain; if (d) { SITE_NAME = String(d).replace(/^https?:\/\//, ''); $('addr').textContent = SITE_NAME; } } catch {}
    const st = await api('GET', '/api/admin/assistant/status');
    if (!st.ok) { note(errorOf(st)); $send.disabled = true; return; }
    patterns = st.json.keyPatterns;
    voiceReady(st.json.voice);
    const m = st.json.model || {};
    if (m.enabled === false) { note('The assistant is switched off for this unit.'); $send.disabled = true; return; }
    // no model yet: say where to connect one; the chat stays open for what the unit can answer by itself
    if (!m.connected) { $('who').textContent = 'No AI model connected'; note((m.connect || 'No AI model is connected.') + ' Open Admin, choose Owner Chat, then Hosted AI settings.'); return; }
    $('who').textContent = m.connected ? 'Answering with ' + m.name : 'No AI model connected';
    // the owner's own AI service (Oct 20 2026): who answers, and where the requests go, said once when the chat opens
    if (m.connected) note(`Answering with ${m.name}${m.model ? ' (' + m.model + ')' : ''}. ${m.where || ''}` + (m.reachable ? '' : ` It is not answering right now${m.error ? ' (' + m.error + ')' : ''}` + (m.box && m.box.reachable ? ', so the box’s own AI answers instead.' : '.')));
    else if (!m.reachable) note('The assistant’s model is not answering right now' + (m.error ? ' (' + m.error + ')' : '') + '. You can still use the admin page.');
    // the assistant speaks first: a greeting, and the first setup question when setup is not finished
    // straight from the first screen (set up by talking, Oct 20 2026, late): the rest of setup is the assistant's to lead
    if (/[?&]setup=1(?:&|$)/.test(location.search)) say('(The owner just opened the assistant. They have just finished the first setup screen: their business name, their password and how the facility runs. Their site shows "not yet public" to visitors until they say go live. Welcome them in one short line, then ask the first setup question - one at a time.)', true);
    else say('(The owner just opened the assistant. Greet them in one short line. If setup is not finished, ask the first setup question.)', true);
  })();
})();
