// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/flyers.js - A FLYER FOR ANYTHING THE FACILITY RUNS (Oct 22 2026, night)
//
//  maintainer: "people can do any type of specials ... make a flyer and put it on the home page and email it out ... export it and put
//  in on FB? like we do for turf league tracker ... good nice flyers"; "the .model and code need to know exactly how to do this
//  and walk the user through everything on specials FB flyers". A homepage special had its flyer (special_flyer, public/flyer.js);
//  now every booking deal, package deal, event and counter special can have one too, in the same four designed layouts and the
//  site's own fonts, colours, name and logo. What a flyer says comes from the thing itself - its name, its line, its price or
//  deal, its days - never from the model. The owner's page draws it (the fonts are there), saves it like any photo, and puts it
//  first in the homepage's offer slides until the thing's own last day; the chat card and the Website editor's Offer Slides card
//  download it at the sizes Facebook and Instagram use (public/flyer.js SIZES).
// ═════════════════════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'public', 'site-layout.js'));

const money = (c) => '$' + ((c | 0) % 100 ? ((c | 0) / 100).toFixed(2) : String((c | 0) / 100));
const len = (m) => m % 60 ? (m < 60 ? `${m} min` : `${m / 60} hours`) : `${m / 60} hour${m === 60 ? '' : 's'}`;
function hourWords(hm) { const [h, m] = String(hm).split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; }
const startWords = (from, until) => from && until ? `${hourWords(from)} - ${hourWords(until)}` : from ? `from ${hourWords(from)}` : until ? `until ${hourWords(until)}` : '';
const dateWords = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const plain = (s, n) => { const t = String(s || '').replace(/<[^>]*>/g, ' ').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '...' : t; };

/** What every flyer is drawn with: the site's own colours, fonts (and where they load from) and name, and the top's photos.
 *  content: the website's content as the caller has it (the assistant's ctx.website) - left out, the saved one. */
function base(content) {
  const cfg = require('./config').getConfig(), site = content || cfg.content || {}, T = require('./theme');
  const th = T.resolveSaved(site.theme), c = th.colors, F = T.FONTS;
  return {
    colors: { dark: c.headerBg, onDark: c.headerText, accent: c.accent, btn: c.btn, onBtn: c.btnText, light: c.bg, ink: c.heading, text: c.text },
    fonts: { heading: (F[th.fonts.heading] || F.playfair || {}).stack || 'Georgia,serif', body: (F[th.fonts.body] || {}).stack || 'system-ui,sans-serif' },
    fontHref: T.fontHref(th.fonts),
    business: (cfg.server && cfg.server.businessName) || cfg.businessName || '',
    site: String((cfg.seo && cfg.seo.domain) || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),   // (website_address_set's own key)
    photos: ((site.hero || {}).images || []).filter(Boolean).slice(0, 6)
  };
}

/** Each thing a flyer can be made for, with its words: { kind, id, name, kicker, title, line, price, until, photo }. Only what is
 *  on and not over: a deal or a package switched off, or an event or a special already past, has nothing to advertise. */
function sources(today) {
  if (!today) { try { today = require('./revenue').facilityToday(); } catch { today = new Date().toISOString().slice(0, 10); } }
  const out = [];
  try {
    const Dl = require('./deals');
    for (const d of Dl.list()) {
      if (!d.active || (d.date_to && d.date_to < today)) continue;
      const price = d.kind === 'free_items' ? `${Dl.itemsWords(d)} free` : d.kind === 'free_minutes' ? `Last ${d.value === 60 ? 'hour' : len(d.value)} free` : d.kind === 'percent' ? `${d.value}% off` : `${money(d.value)} off`;
      // (its last day on the flyer too - "through Nov 30": the research, Oct 23 2026)
      out.push({ kind: 'deal', id: d.id, name: d.name, kicker: [L.daysWords(d.days), startWords(d.start_from, d.start_until), d.date_to ? Dl.spanWords('', d.date_to) : ''].filter(Boolean).join(' · '), title: d.name, line: d.words || Dl.words(d), price, until: d.date_to || '' });
    }
  } catch {}
  try {
    const P = require('./packages');
    for (const p of P.list()) {
      if (!p.active || (p.date_to && p.date_to < today)) continue;
      const inc = P.includesWords(p);
      out.push({ kind: 'package', id: p.id, name: p.name, kicker: [L.daysWords(p.days), startWords(p.start_from, p.start_until), p.date_to ? require('./deals').spanWords('', p.date_to) : ''].filter(Boolean).join(' · '), title: p.name,
        line: p.words || `${P.hrs(p.minutes)} of bay time${inc ? ' with ' + inc : ''}`, price: p.price_type === 'per_person' ? `${money(p.price_cents)} a person` : money(p.price_cents), until: p.date_to || '' });
    }
  } catch {}
  try {
    for (const e of require('./db').db.prepare(`SELECT id, title, event_date, description, flyer FROM website_events WHERE event_date >= ? ORDER BY event_date`).all(today))
      out.push({ kind: 'event', id: e.id, name: e.title, kicker: dateWords(e.event_date), title: e.title, line: plain(e.description, 140), price: '', until: e.event_date, photo: e.flyer || '' });
  } catch {}
  try {
    const S = require('./specials');
    for (const sp of S.list()) {
      if (!sp.active || (sp.date && sp.date < today)) continue;
      out.push({ kind: 'special', id: sp.id, name: sp.name, kicker: [sp.date ? dateWords(sp.date) : L.daysWords(sp.days), S.timeWords(sp)].filter(Boolean).join(' · '), title: sp.name,
        line: sp.words || `${S.dealWords(sp)} - ${S.coverWords(sp)}`, price: S.dealWords(sp), until: sp.date || '' });
    }
  } catch {}
  return out;
}

/** The offer slides with a flyer put first: { label, title, text, img, flyer, until, enabled } - the slide a flyer for the same
 *  thing had before is taken out (one flyer a thing). until: the thing's own last day, after which the homepage leaves it out. */
function slidesWith(offers, s, flyerPath) {
  const list = (offers && Array.isArray(offers.slides) ? offers.slides : []).filter(x => !(x && x.flyerFor && x.flyerFor === `${s.kind}:${s.id}`)).map(x => Object.assign({}, x));
  list.unshift({ label: s.kicker || '', title: s.title || s.name, text: [s.line, s.price].filter(Boolean).join(' · ').slice(0, 300), img: '', flyer: flyerPath, flyerFor: `${s.kind}:${s.id}`, until: s.until || '', enabled: true });
  return list;
}

module.exports = { base, sources, slidesWith };
