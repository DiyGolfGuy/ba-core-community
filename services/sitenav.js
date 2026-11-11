// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/sitenav.js - ONE navigation model for every public page (Sep 5 2026).
//
// The owner arranges it once on the Website editor's Navigation card:
// website_content.nav = { items: [ { key, top, foot } ... ] } in display order.
// Built-in pages carry their own top/foot flags here; a custom page's flags
// live ON THE PAGE (pages[].showInNav / showInFooter - the only place they are
// asked) and nav.items holds only its position ('page:<slug>'). Memberships
// appears only while a tier is sellable online, exactly as the landing page's
// own section does. resolve() returns what the pages render; the sitemap reads
// the same list so a crawler and a visitor see one site.
'use strict';

const BUILTIN = [
  { key: 'events',       label: 'Events',       href: '/events',       top: true,  foot: true,  surface: 'events' },
  { key: 'memberships',  label: 'Memberships',  href: '/memberships',  top: true,  foot: true,  needsTiers: true, surface: 'memberships' },
  { key: 'gift-cards',   label: 'Gift Cards',   href: '/gift-cards',   top: false, foot: true,  surface: 'giftCards' },
  { key: 'how-it-works', label: 'How It Works', href: '/how-it-works', top: false, foot: true },
  // W44: leagues has no product page - it is a holding page the owner can make
  // public (What's public card). Off by default; appears in the menu only then.
  { key: 'leagues',      label: 'Leagues',      href: '/leagues',      top: true,  foot: true,  surface: 'leagues' }
];

// ── WHAT'S PUBLIC (W44, Sep 10 2026) ────────────────────────────────────────
// The owner decides, per public surface, from the Website editor - never a
// separate site, never a deploy. website_content.settings.public =
// { booking, memberships, portal, events, giftCards, leagues, pages: { slug } }.
// Absent = public (leagues absent = not public: nothing to show but a holding
// page). Off means the ROUTE and its API answer the holding page or 404 - and
// every menu item, hero button, footer link, sitemap entry and section that
// points at it hides on its own because they all read this one map.
const SURFACES = {
  booking:     { label: 'Booking (the booking page and My Booking)', paths: ['/book', '/my-booking'],
                 api: ['/api/bookings/', '/api/customer/', '/api/pricing/calculate', '/api/pricing/validate-code', '/api/members/validate-pin', '/api/members/guest-quote'] },
  memberships: { label: 'Memberships (the tiers page and joining online)', paths: ['/memberships'],
                 api: ['/api/memberships/public', '/api/memberships/checkout', '/api/memberships/success', '/api/memberships/mock-pay'] },
  portal:      { label: 'Member portal (My Membership)', paths: ['/my-membership'],
                 api: ['/api/members/portal', '/api/memberships/portal/', '/api/members/record-usage'] },
  events:      { label: 'Events page', paths: ['/events'], api: [] },
  giftCards:   { label: 'Gift cards', paths: ['/gift-cards'], api: ['/api/gifts/checkout', '/api/gifts/confirm'] },
  leagues:     { label: 'Leagues (a holding page only - no leagues page exists yet)', paths: ['/leagues'], api: [], defaultOff: true },
  // W45: email updates - its own page and the signup route; ON only while the owner's Email Updates card is on
  // the signup ROUTE is not gated here: its own limiter must count every request (test-limiters drives it), and the route answers 404 itself while the card is off
  updates:     { label: 'Email updates (the signup page)', paths: ['/updates'], api: [], defaultOff: true, fromSignup: true }
};
const SIGNUP_DEFAULT = { enabled: false, title: 'Get email updates', text: 'Opening news, events and offers - a few emails a year, never more.', button: 'Sign me up', onHolding: true };
function signup(settings) {
  const g = (settings && settings.signup) || {};
  return { enabled: g.enabled === true, title: String(g.title || '').trim() || SIGNUP_DEFAULT.title, text: String(g.text || '').trim() || SIGNUP_DEFAULT.text, button: String(g.button || '').trim() || SIGNUP_DEFAULT.button, onHolding: g.onHolding !== false };
}
const HOLDING_DEFAULT = { headline: 'Not yet public', text: 'This part of our site is not open yet. Check back soon.' };

/** The resolved map: every surface true/false plus pages: { slug: true/false }. */
function publicMap(settings) {
  const p = (settings && settings.public && typeof settings.public === 'object') ? settings.public : {};
  const out = { pages: {} };
  for (const [k, d] of Object.entries(SURFACES)) out[k] = d.fromSignup ? signup(settings).enabled : (typeof p[k] === 'boolean' ? p[k] : !d.defaultOff);
  if (p.pages && typeof p.pages === 'object') for (const [slug, v] of Object.entries(p.pages)) out.pages[String(slug).toLowerCase()] = v !== false;
  return out;
}
function holding(settings) {
  const h = (settings && settings.holding) || {};
  return { headline: String(h.headline || '').trim() || HOLDING_DEFAULT.headline, text: String(h.text || '').trim() || HOLDING_DEFAULT.text };
}
/** Which surface a request path belongs to, or null. Custom pages answer 'page:<slug>'. */
function surfaceFor(reqPath) {
  const pth = String(reqPath || '').toLowerCase();
  if (pth.startsWith('/updates/unsubscribe')) return null;        // an unsubscribe link from an old email must ALWAYS work
  for (const [k, d] of Object.entries(SURFACES)) {
    if (d.paths.some(p => pth === p || pth.startsWith(p + '/') || pth === p + '.html')) return k;
    if (d.api.some(a => a.endsWith('/') ? pth.startsWith(a) : (pth === a || pth.startsWith(a + '?')))) return k;
  }
  const m = pth.match(/^\/p\/([a-z0-9-]+)/);
  if (m) return 'page:' + m[1];
  return null;
}
function isPublic(map, surface) {
  if (!surface) return true;
  if (surface.startsWith('page:')) return map.pages[surface.slice(5)] !== false;
  return map[surface] !== false;
}
/** A link's target, when it is one of ours: is it public? External links always are. */
function hrefPublic(map, href) {
  const h = String(href || '');
  if (!h.startsWith('/')) return true;
  return isPublic(map, surfaceFor(h.split('#')[0]));
}
// ── A LINK THAT POINTS AT NOTHING HIDES (W44 addendum, Sep 10 2026) ────────
// A menu item, footer link or button may point at a homepage section
// (/landing#offers, /#gallery, #blk-<id>), a custom page (/p/<slug>) or a
// gated surface. It is ALIVE only if that target is there: the section's
// block is placed and on, the page is published and public, the surface is
// public. The same rule runs on the page (public/site-layout.js linkAlive)
// for the hero buttons and the closing band - one rule, two copies, the
// battery holds them in lockstep.
function sectionOn(content, id) {
  try {
    const L = require('../public/site-layout.js');
    return L.sectionOn(content, id);
  } catch { return true; }
}
function linkAlive(content, map, href) {
  const h = String(href || '').trim();
  if (!h) return false;
  if (/^https?:\/\//.test(h)) return true;
  if (!h.startsWith('/') && !h.startsWith('#')) return false;
  const [pathPart, frag] = h.split('#');
  if (pathPart && !hrefPublic(map, pathPart)) return false;
  const pm = pathPart.match(/^\/p\/([a-z0-9-]+)\/?$/i);
  if (pm) {
    const pages = Array.isArray(content && content.pages) ? content.pages : [];
    const pg = pages.find(x => x && x.published && String(x.slug || '').toLowerCase() === pm[1].toLowerCase());
    if (!pg) return false;
  }
  if (frag !== undefined) {
    if (!frag) return false;                                       // an empty anchor is nothing
    // a homepage SECTION anchor follows its block; any other in-page anchor (#main, #main-content) is the page's own business
    if ((pathPart === '' || pathPart === '/' || pathPart === '/landing') && isSectionId(frag)) return sectionOn(content, frag);
  }
  return true;
}
function isSectionId(id) {
  try { const L = require('../public/site-layout.js'); return !!L.SECTION_IDS[id] || /^blk-/.test(String(id)); } catch { return /^blk-/.test(String(id)); }
}

function sellableTiers() {
  try {
    const row = require('./db').db.prepare(`SELECT COUNT(*) AS n FROM membership_tiers WHERE active=1 AND sell_online=1 AND (price_monthly > 0 OR price_annual > 0)`).get();
    return !!(row && row.n > 0);
  } catch { return false; }
}

/** content = the parsed website_content map (pages already filtered for the caller). */
function resolve(content) {
  content = content || {};
  const settings = content.settings || {};
  const saved = (content.nav && Array.isArray(content.nav.items)) ? content.nav.items : [];
  const pages = Array.isArray(content.pages) ? content.pages.filter(p => p && p.published && p.slug) : [];
  const tiers = sellableTiers();
  const out = [];
  const seen = new Set();
  const push = (entry) => { if (!entry || seen.has(entry.key)) return; seen.add(entry.key); out.push(entry); };
  const pub = publicMap(settings);
  // W44: a built-in may carry the owner's own label and link (Navigation card);
  // a bad link falls back to the built-in's own.
  const cleanLabel = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const cleanHref = v => /^(https?:\/\/[^\s<>"']+|\/[^\s<>"']*)$/.test(String(v || '').trim()) ? String(v).trim() : '';
  const builtin = (key, flags) => {
    const b = BUILTIN.find(x => x.key === key); if (!b) return null;
    if (b.needsTiers && !tiers) return null;
    if (b.surface && !pub[b.surface]) return null;                       // not yet public: gone from every menu
    const label = cleanLabel(flags && flags.label) || b.label;
    let href = cleanHref(flags && flags.href) || b.href;
    if (href !== b.href && !linkAlive(content, pub, href)) href = b.href;   // an override pointing at nothing falls back to the built-in address
    return { key: b.key, label, href, top: flags && typeof flags.top === 'boolean' ? flags.top : b.top, foot: flags && typeof flags.foot === 'boolean' ? flags.foot : b.foot, builtin: true,
             external: /^https?:/.test(href), defaultLabel: b.label, defaultHref: b.href };
  };
  const page = (slug) => {
    const p = pages.find(x => String(x.slug).toLowerCase() === String(slug).toLowerCase()); if (!p) return null;
    if (pub.pages[String(p.slug).toLowerCase()] === false) return null;   // the owner took this page off the public site
    return { key: 'page:' + p.slug, label: p.title || p.slug, href: '/p/' + p.slug, top: !!p.showInNav, foot: !!p.showInFooter, builtin: false, external: false };
  };
  // W44: the owner's own links (Navigation card: "Add a link") - a label and a
  // URL, internal or external, in the same list with the same top/footer boxes.
  const link = (it) => {
    const label = cleanLabel(it.label), href = cleanHref(it.href);
    if (!label || !href) return null;
    if (!linkAlive(content, pub, href)) return null;                   // points at nothing: hidden with it
    return { key: it.key, label, href, top: it.top !== false, foot: it.foot !== false, builtin: false, custom: true, external: /^https?:/.test(href) };
  };
  for (const it of saved) {
    if (!it || typeof it.key !== 'string') continue;
    push(it.key.startsWith('page:') ? page(it.key.slice(5)) : it.key.startsWith('link:') ? link(it) : builtin(it.key, it));
  }
  for (const b of BUILTIN) push(builtin(b.key, null));
  for (const p of pages) push(page(p.slug));
  // the owner's footer links (Site-wide card) resolved by the same rule
  const extra = (Array.isArray(settings.footerLinks) ? settings.footerLinks : [])
    .map(l => l && ({ label: cleanLabel(l.label), href: cleanHref(l.url || l.href) }))
    .filter(l => l && l.label && l.href && linkAlive(content, pub, l.href))
    .map(l => ({ label: l.label, href: l.href, external: /^https?:/.test(l.href) }));
  return {
    extra,
    enabled: settings.siteEnabled !== false,
    homepage: settings.homepage === 'landing' ? 'landing' : 'booking',
    items: out,
    top: out.filter(x => x.top),
    foot: out.filter(x => x.foot),
    public: pub,
    holding: holding(settings),
    signup: signup(settings)
  };
}

module.exports = { BUILTIN, SURFACES, HOLDING_DEFAULT, SIGNUP_DEFAULT, resolve, sellableTiers, publicMap, holding, signup, surfaceFor, isPublic, hrefPublic, linkAlive, sectionOn };
