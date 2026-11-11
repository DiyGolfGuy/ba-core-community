// Copyright (c) 2025-2026 BA Custom Products LLC.
// site-chrome.js - the shared header, phone menu and footer of every public
// page (Sep 5 2026). Reads the ONE navigation model the server resolves
// (window.BA_SITE.nav, inlined at serve time; fetched when absent), the
// owner's social links and footer links, and the business name from the
// element's data-name. With the website switched OFF the header is just the
// name and a Book button - the app pages still work, the marketing menu is gone.
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function safeHref(u) { return /^(https?:\/\/|\/)/.test(String(u || '')) ? String(u) : '#'; }
  var ICONS = {
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-8.2h2.8l.4-3.3h-3.2V8.4c0-.9.3-1.6 1.6-1.6h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.3h2.8V22h3.4z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.3a4.7 4.7 0 100 9.4 4.7 4.7 0 000-9.4zm0 7.7a3 3 0 110-6 3 3 0 010 6zm6-7.9a1.1 1.1 0 11-2.2 0 1.1 1.1 0 012.2 0zM12 2c-2.7 0-3 0-4.1.1-2.9.1-4.5 1.7-4.6 4.6C3.2 7.8 3.2 8.1 3.2 12s0 4.2.1 5.3c.1 2.9 1.7 4.5 4.6 4.6 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c2.9-.1 4.5-1.7 4.6-4.6.1-1.1.1-1.4.1-5.3s0-4.2-.1-5.3c-.1-2.9-1.7-4.5-4.6-4.6C15 2 14.7 2 12 2zm0 1.7c2.7 0 3 0 4 .1 2.2.1 3.1 1 3.2 3.2.1 1 .1 1.3.1 4s0 3-.1 4c-.1 2.2-1 3.1-3.2 3.2-1 .1-1.3.1-4 .1s-3 0-4-.1c-2.2-.1-3.1-1-3.2-3.2-.1-1-.1-1.3-.1-4s0-3 .1-4c.1-2.2 1-3.1 3.2-3.2 1-.1 1.3-.1 4-.1z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 5.8A4.3 4.3 0 0115.5 3h-3.1v12.4a2.6 2.6 0 11-1.8-2.5V9.7a5.7 5.7 0 104.9 5.7V9.2a7.3 7.3 0 004.3 1.4V7.5a4.3 4.3 0 01-3.2-1.7z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a2.5 2.5 0 00-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 002.4 7.2 26 26 0 002 12a26 26 0 00.4 4.8 2.5 2.5 0 001.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 001.8-1.8A26 26 0 0022 12a26 26 0 00-.4-4.8zM10 15V9l5.2 3L10 15z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 3h3l-6.8 7.8L21.8 21h-6.2l-4.9-6.3L5.1 21h-3l7.3-8.3L1.8 3h6.3l4.4 5.8L17.5 3zm-1.1 16.2h1.7L7.1 4.7H5.3l11.1 14.5z"/></svg>',
    google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4a4.6 4.6 0 01-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.2z"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a6 6 0 01-5.6-4.1H3.1v2.6A10 10 0 0012 22z"/><path d="M6.4 13.9a6 6 0 010-3.8V7.5H3.1a10 10 0 000 9l3.3-2.6z"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 003.1 7.5l3.3 2.6A6 6 0 0112 6z"/></svg>'
  };
  var LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', google: 'Google reviews' };

  function data() {
    if (window.BA_SITE) return Promise.resolve(window.BA_SITE);
    return fetch('/api/website/content').then(function (r) { return r.json(); }).catch(function () { return {}; });
  }

  function renderHead(el, d) {
    // Keyboard users skip the header (Sep 6 2026): every chrome page carries <main id="main-content">.
    if (!document.querySelector('a.skip-link') && document.getElementById('main-content')) {
      var sk = document.createElement('a'); sk.className = 'skip-link'; sk.href = '#main-content'; sk.textContent = 'Skip to content';
      document.body.insertBefore(sk, document.body.firstChild);
    }
    var name = el.getAttribute('data-name') || '';
    var nav = d.nav || { enabled: true, top: [], foot: [] };
    var on = nav.enabled !== false;
    var home = on && nav.homepage === 'landing' ? '/' : (on ? '/landing' : '/');
    var logo = (d.content && d.content.hero && d.content.hero.showLogo === false) ? '' : '<img src="/uploads/logo.png" alt="" onerror="this.remove()">';
    var links = on ? (nav.top || []) : [];
    // W44: a link the owner pointed off-site opens in a new tab; the Book button
    // hides itself while booking is not yet public (What's public card).
    var a = function (l, cls) { return '<a href="' + esc(safeHref(l.href)) + '"' + (cls ? ' class="' + cls + '"' : '') + (l.external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>'; };
    var bookOn = !(nav.public && nav.public.booking === false);
    var nav_html = links.map(function (l) { return a(l); }).join('');
    el.innerHTML = '<div class="bar">' +
      '<a class="brand" href="' + home + '">' + logo + '<span>' + esc(name) + '</span></a>' +
      '<nav aria-label="Site">' + nav_html + '</nav>' +
      '<div class="cta">' + (bookOn ? '<a class="siteBtn" href="/book">Book Now</a>' : '') +
      (links.length ? '<button class="menuBtn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="siteDrawer">&#9776;</button>' : '') + '</div></div>' +
      (links.length ? '<div class="drawer" id="siteDrawer">' + nav_html + (bookOn ? '<a class="book" href="/book">Book Now</a>' : '') + '</div>' : '');
    // the menu's other shapes (Oct 20 2026, late; site-style.js menuStyle / phoneBar): tabs under the bar and the phones'
    // bottom bar - drawn always, shown only when the owner chose them (site.css reads the same properties as the homepage)
    var here = function (h) { return h === location.pathname || (h === home && (location.pathname === '/' || location.pathname === '/landing')); };
    var mark = function (l, cls) { var x = a(l, cls); return here(l.href) ? x.replace('<a ', '<a aria-current="page" ') : x; };
    if (links.length) el.insertAdjacentHTML('beforeend', '<nav class="navTabs" aria-label="Pages">' + [{ href: home, label: 'Home' }].concat(links).map(function (l) { return mark(l); }).join('') + '</nav>');
    if (!document.querySelector('.phoneBar')) document.body.insertAdjacentHTML('beforeend', '<nav class="phoneBar" aria-label="Quick links">' + [{ href: home, label: 'Home' }].concat(links.slice(0, bookOn ? 2 : 3)).map(function (l) { return mark(l); }).join('') + (bookOn ? mark({ href: '/book', label: 'Book' }, 'book') : '') + '</nav>');
    var btn = el.querySelector('.menuBtn'), drawer = el.querySelector('.drawer');
    if (btn && drawer) btn.addEventListener('click', function () { var open = drawer.classList.toggle('open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  }

  function socialHtml(social) {
    var keys = ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'google'];
    var out = '';
    keys.forEach(function (k) {
      var u = social && social[k];
      if (typeof u === 'string' && /^https:\/\//.test(u)) out += '<a href="' + esc(u) + '" target="_blank" rel="noopener" aria-label="' + LABELS[k] + '" title="' + LABELS[k] + '">' + ICONS[k] + '</a>';
    });
    // W44 addendum: free-form links (Contact & Social card > More links) - label + https address
    (social && Array.isArray(social.more) ? social.more : []).forEach(function (l) {
      if (l && l.label && typeof l.url === 'string' && /^https:\/\//.test(l.url)) out += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener" class="more">' + esc(l.label) + '</a>';
    });
    return out ? '<div class="social">' + out + '</div>' : '';           // off when empty
  }

  function renderFoot(el, d) {
    var name = el.getAttribute('data-name') || '';
    var nav = d.nav || { enabled: true, foot: [] };
    var on = nav.enabled !== false;
    var bookOn = !(nav.public && nav.public.booking === false);
    var links = (bookOn ? [{ href: '/book', label: 'Book a Bay' }] : []).concat(on ? (nav.foot || []) : []);
    // W44 addendum: the owner's footer links come RESOLVED from the server (nav.extra) - a link
    // pointing at a hidden section, a missing page or a gated surface is not in the list
    var extra = Array.isArray(nav.extra) ? nav.extra : [];
    extra.forEach(function (l) { if (l && l.label && /^(https?:\/\/|\/)/.test(l.href || '')) links.push({ href: l.href, label: l.label, external: !!l.external }); });
    links.push({ href: '/privacy', label: 'Privacy Policy' }, { href: '/sms-terms', label: 'SMS Terms' });
    el.innerHTML = '<div class="in"><div class="links">' + links.map(function (l) { return '<a href="' + esc(safeHref(l.href)) + '"' + (l.external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>'; }).join('') + '</div>' +
      socialHtml(on ? (d.content && d.content.social) : null) +
      '<div class="copy">&copy; ' + new Date().getFullYear() + ' ' + esc(name) + '</div></div>';
  }

  // The ONE notice (Settings > Notice) - the booking page shows it, so does every website page.
  function renderAnnouncement(d) {
    var a = d && d.announcement; if (!a || !a.enabled || !a.message) return;
    if (document.getElementById('siteAnn')) return;           // the landing page draws its own
    var el = document.createElement('div'); el.id = 'siteAnn'; el.className = 'siteAnn';
    // W44: the notice may link somewhere (Settings > Notice); a link makes the whole bar the link
    if (a.link && /^(https?:\/\/|\/)/.test(a.link)) { var l = document.createElement('a'); l.href = a.link; l.textContent = a.message; l.style.cssText = 'color:inherit;text-decoration:underline'; if (/^https?:/.test(a.link)) { l.target = '_blank'; l.rel = 'noopener'; } el.appendChild(l); }
    else el.textContent = a.message;
    document.body.insertBefore(el, document.body.firstChild);
  }
  function boot() {
    var head = document.getElementById('siteHead'), foot = document.getElementById('siteFoot');
    if (!head && !foot) return;
    data().then(function (d) { renderAnnouncement(d || {}); if (head) renderHead(head, d || {}); if (foot) renderFoot(foot, d || {}); });
  }
  window.BASiteChrome = { boot: boot, socialHtml: socialHtml, ICONS: ICONS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
