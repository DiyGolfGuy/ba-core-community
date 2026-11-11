// Copyright (c) 2025-2026 BA Custom Products LLC.
// signup.js - THE ONE email-updates form (W45, Sep 10 2026). Drawn by the
// homepage block, the holding page and /updates from the same code: reads the
// owner's words (nav.signup from the content API or the inlined BA_SITE),
// draws nothing while Email Updates is off, posts to /api/website/subscribe,
// and says what happened in plain words. The consent line is recorded with
// the signup exactly as shown.
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function data() {
    if (window.BA_SITE) return Promise.resolve(window.BA_SITE);
    return fetch('/api/website/content').then(function (r) { return r.json(); }).catch(function () { return {}; });
  }
  function consentLine(name) { return 'I would like email updates from ' + name + '. I can unsubscribe with one click in any email.'; }
  function draw(host, sg, opts) {
    var name = (document.querySelector('[data-name]') || {}).getAttribute ? (document.querySelector('[data-name]').getAttribute('data-name') || '') : '';
    var id = 'su' + Math.random().toString(36).slice(2, 7);
    host.innerHTML = '<form class="inq signup-form" novalidate>' +
      '<div class="two"><div><label for="' + id + '-email">Email</label><input id="' + id + '-email" name="email" type="email" autocomplete="email" required inputmode="email"></div>' +
      '<div><label for="' + id + '-name">Name (optional)</label><input id="' + id + '-name" name="name" type="text" autocomplete="name"></div></div>' +
      '<input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">' +
      '<label class="consent" style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:10px 0"><input type="checkbox" name="agree" required style="margin-top:3px"><span>' + esc(consentLine(name)) + '</span></label>' +
      '<button type="submit" class="btn gold">' + esc(sg.button || 'Sign me up') + '</button><div class="msg" aria-live="polite" style="margin-top:10px"></div></form>';
    var f = host.querySelector('form');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = f.querySelector('.msg'), btn = f.querySelector('button[type=submit]');
      if (window.PREVIEW || /[?&]preview=1/.test(location.search)) { msg.textContent = 'Preview - nothing is sent from here.'; return; }
      var email = f.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Please enter a working email address.'; f.email.focus(); return; }
      if (!f.agree.checked) { msg.textContent = 'Please tick the box so we know you want the emails.'; return; }
      btn.disabled = true; msg.textContent = 'One moment...';
      fetch('/api/website/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, name: f.name.value.trim(), website: f.website.value, source: opts.source || 'site', consent: consentLine(name) }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (!x.ok) throw new Error(x.d.error || 'Could not sign you up - please try again.');
          msg.textContent = x.d.alreadyOn ? 'You are already on the list - thank you.' : (x.d.confirmationSent ? 'You are on the list. A confirmation is on its way to ' + email + '.' : 'You are on the list - thank you.');
          f.email.value = ''; f.name.value = ''; f.agree.checked = false;
        })
        .catch(function (e) { msg.textContent = e.message; })
        .then(function () { btn.disabled = false; });
    });
  }
  function mount(host, opts) {
    opts = opts || {};
    if (!host) return;
    data().then(function (d) {
      var sg = (d && d.nav && d.nav.signup) || null;
      if (!sg || !sg.enabled) { host.innerHTML = ''; if (opts.whenOff) opts.whenOff(); return; }
      if (opts.titleEl) opts.titleEl.textContent = sg.title;
      if (opts.textEl) opts.textEl.textContent = sg.text;
      draw(host, sg, opts);
    });
  }
  window.BASignup = { mount: mount, draw: draw, consentLine: consentLine };
})();
