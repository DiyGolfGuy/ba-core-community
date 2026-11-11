// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/theme.js — ONE BRAND, EVERYWHERE (maintainer ruled Aug 11).
//
// THE PROBLEM THIS FIXES: two disconnected theme systems existed. The
// marketing website had 8 presets + 13 editable roles stored in
// website_content; the booking app read five unrelated keys out of
// config.json that NO admin screen ever wrote. A facility could pick
// "Navy & Copper" for their site and customers would still land on a
// gold-and-green booking page. Now both read this.
//
// DELIBERATELY NOT THEMED (maintainer confirmed):
//   /staff  - keeps its steel-blue identity so staff can tell at a glance
//             which app they are in on a shared tablet.
//   /admin  - keeps its own colors AND is the escape hatch: if a custom
//             theme were ever unreadable, the owner must still be able to
//             get into settings to fix it.
'use strict';

const dbM = require('./db');

// The 8 shipped presets. Kept server-side so every surface resolves the
// same palette without the browser having to know them.
const PRESETS = {
  'fairway-light': {bg:'#f5f3ea',bg2:'#edeadd',card:'#fffef8',line:'#e2ddcb',text:'#3a4436',muted:'#657163',heading:'#1c3a26',accent:'#866914',accent2:'#765c12',btn:'#1c3a26',btnText:'#f7f5ec',headerBg:'#14301d',headerText:'#f2efe2'},
  'pine-dark':   {bg:'#0d1810',bg2:'#111f15',card:'#16241a',line:'#24382a',text:'#c8d2c4',muted:'#8fa08c',heading:'#eef3ea',accent:'#c9a227',accent2:'#d8b544',btn:'#c9a227',btnText:'#14301d',headerBg:'#0a130d',headerText:'#eef3ea'},
  'navy-copper': {bg:'#f4f5f7',bg2:'#e9ecf0',card:'#ffffff',line:'#dde2e9',text:'#3a4350',muted:'#666f7d',heading:'#152238',accent:'#9c5e33',accent2:'#8f5228',btn:'#152238',btnText:'#f4f5f7',headerBg:'#101a2b',headerText:'#eef1f6'},
  'charcoal-red':{bg:'#f6f5f3',bg2:'#ecebe7',card:'#ffffff',line:'#e0ded8',text:'#3d3d3b',muted:'#6f6f6c',heading:'#232323',accent:'#b23a30',accent2:'#8f2d25',btn:'#232323',btnText:'#f6f5f3',headerBg:'#1b1b1b',headerText:'#f1efeb'},
  'slate-teal':  {bg:'#f3f6f5',bg2:'#e7edeb',card:'#ffffff',line:'#dbe4e1',text:'#39443f',muted:'#64716c',heading:'#16332b',accent:'#1c7e67',accent2:'#166a56',btn:'#16332b',btnText:'#f3f6f5',headerBg:'#122822',headerText:'#edf3f0'},
  'sand-forest': {bg:'#f7f2e7',bg2:'#efe7d4',card:'#fffdf6',line:'#e6dcc4',text:'#4a4636',muted:'#716e5d',heading:'#2e4426',accent:'#667428',accent2:'#5f6e22',btn:'#2e4426',btnText:'#f7f2e7',headerBg:'#24361e',headerText:'#f2efe0'},
  'midnight-ice':{bg:'#0e1116',bg2:'#141922',card:'#1a212c',line:'#26303e',text:'#c3ccd8',muted:'#8794a4',heading:'#eef3f8',accent:'#5ab0d8',accent2:'#7cc4e4',btn:'#5ab0d8',btnText:'#0e1116',headerBg:'#0a0d12',headerText:'#eef3f8'},
  'plum-gold':   {bg:'#f6f3f6',bg2:'#ece5ec',card:'#fffdff',line:'#e2d8e2',text:'#443a44',muted:'#756a75',heading:'#3a1f3a',accent:'#866914',accent2:'#765c12',btn:'#3a1f3a',btnText:'#f6f3f6',headerBg:'#2b172b',headerText:'#f2ecf2'}
};
const DEFAULT_PRESET = 'pine-dark';
const ROLES = ['bg','bg2','card','line','text','muted','heading','accent','accent2','btn','btnText','headerBg','headerText'];

function isHex(v) { return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v); }

// Read the owner's saved theme choice (website_content.theme) and resolve it
// to a complete 13-role palette. Any missing or malformed role falls back to
// the preset's value, so a partial save can never produce a broken site.
// ── TYPOGRAPHY (maintainer, Sep 17 2026, from a live customer) ───────────────────────
// "Is there any way to standardize all these fonts? there looks to be 4
// different fonts." He was right, and for two reasons. The product hardcoded
// three families in site.css with no way to change them - and the CUSTOM PAGE
// renderer loaded no webfont at all, so /p/ pages fell back to Georgia,
// system-ui and Menlo while the rest of his site used the real ones. Three
// unrelated fallback faces on one page, none of them his brand.
//
// So: fonts are part of the theme now, exactly like colours - one place, one
// save, the whole site and the booking app. The catalogue is curated rather
// than a free text box: a typed family name is a broken page and a font the
// browser has to go and not find. Every family here is a real Google Fonts
// family with weights that family actually publishes, and 'system' asks for no
// webfont at all, which is the fastest option and the right one for an owner
// who just wants it to look like everything else on their phone.
const FONTS = {
  // id            label                       stack                                                          google family + weights (null = no webfont)
  // (Oct 20 2026, BA Core 2 AI: maintainer, "being able to change fonts ... make fonts all the same are huge, people like that.
  //  Consistency and the readability, and that looks nice and fancy") 48 families. Every weight listed is one Google Fonts
  //  publishes for that family (their own catalogue, fonts.google.com/metadata/fonts, read Oct 20): 300 to 800 and italic
  //  400 and 700 where they exist, so a heavier or italic heading is the real face, never a faked one. 'script' faces are
  //  for headings and the small lines only - never body text (resolveFonts below).
  system:        { label: 'System (fastest)',          kind: 'sans',    stack: `system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`, google: null },
  outfit:        { label: 'Outfit',                    kind: 'sans',    stack: `'Outfit',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Outfit:wght@300;400;500;600;700;800' },
  inter:         { label: 'Inter',                     kind: 'sans',    stack: `'Inter',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  montserrat:    { label: 'Montserrat',                kind: 'sans',    stack: `'Montserrat',system-ui,'Segoe UI',sans-serif`, google: 'Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  poppins:       { label: 'Poppins',                   kind: 'sans',    stack: `'Poppins',system-ui,'Segoe UI',sans-serif`, google: 'Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  worksans:      { label: 'Work Sans',                 kind: 'sans',    stack: `'Work Sans',system-ui,'Segoe UI',sans-serif`, google: 'Work+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  sourcesans:    { label: 'Source Sans 3',             kind: 'sans',    stack: `'Source Sans 3',system-ui,'Segoe UI',sans-serif`, google: 'Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  nunitosans:    { label: 'Nunito Sans',               kind: 'sans',    stack: `'Nunito Sans',system-ui,'Segoe UI',sans-serif`, google: 'Nunito+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  raleway:       { label: 'Raleway',                   kind: 'sans',    stack: `'Raleway',system-ui,'Segoe UI',sans-serif`, google: 'Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  oswald:        { label: 'Oswald',                    kind: 'display', stack: `'Oswald',Impact,system-ui,sans-serif`, google: 'Oswald:wght@300;400;500;600;700' },
  playfair:      { label: 'Playfair Display',          kind: 'serif',   stack: `'Playfair Display',Georgia,serif`, google: 'Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  lora:          { label: 'Lora',                      kind: 'serif',   stack: `'Lora',Georgia,serif`, google: 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700' },
  merriweather:  { label: 'Merriweather',              kind: 'serif',   stack: `'Merriweather',Georgia,serif`, google: 'Merriweather:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  baskerville:   { label: 'Libre Baskerville',         kind: 'serif',   stack: `'Libre Baskerville',Georgia,serif`, google: 'Libre+Baskerville:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700' },
  cormorant:     { label: 'Cormorant Garamond',        kind: 'serif',   stack: `'Cormorant Garamond',Garamond,Georgia,serif`, google: 'Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700' },
  bitter:        { label: 'Bitter',                    kind: 'serif',   stack: `'Bitter',Georgia,serif`, google: 'Bitter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  dmmono:        { label: 'DM Mono',                   kind: 'mono',    stack: `'DM Mono',ui-monospace,Menlo,monospace`, google: 'DM+Mono:ital,wght@0,300;0,400;0,500;1,400' },
  jetbrains:     { label: 'JetBrains Mono',            kind: 'mono',    stack: `'JetBrains Mono',ui-monospace,Menlo,monospace`, google: 'JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  spacemono:     { label: 'Space Mono',                kind: 'mono',    stack: `'Space Mono',ui-monospace,Menlo,monospace`, google: 'Space+Mono:ital,wght@0,400;0,700;1,400;1,700' },
  plexmono:      { label: 'IBM Plex Mono',             kind: 'mono',    stack: `'IBM Plex Mono',ui-monospace,Menlo,monospace`, google: 'IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700' },
  manrope:       { label: 'Manrope',                   kind: 'sans',    stack: `'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Manrope:wght@300;400;500;600;700;800' },
  jakarta:       { label: 'Plus Jakarta Sans',         kind: 'sans',    stack: `'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  rubik:         { label: 'Rubik',                     kind: 'sans',    stack: `'Rubik',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Rubik:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  lexend:        { label: 'Lexend',                    kind: 'sans',    stack: `'Lexend',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Lexend:wght@300;400;500;600;700;800' },
  sora:          { label: 'Sora',                      kind: 'sans',    stack: `'Sora',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Sora:wght@300;400;500;600;700;800' },
  spacegrotesk:  { label: 'Space Grotesk',             kind: 'sans',    stack: `'Space Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Space+Grotesk:wght@300;400;500;600;700' },
  josefin:       { label: 'Josefin Sans',              kind: 'sans',    stack: `'Josefin Sans',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Josefin+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700' },
  barlow:        { label: 'Barlow',                    kind: 'sans',    stack: `'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Barlow:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  kanit:         { label: 'Kanit',                     kind: 'sans',    stack: `'Kanit',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Kanit:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  archivo:       { label: 'Archivo',                   kind: 'sans',    stack: `'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif`, google: 'Archivo:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  bebas:         { label: 'Bebas Neue',                kind: 'display', stack: `'Bebas Neue',Impact,system-ui,sans-serif`, google: 'Bebas+Neue:wght@400' },
  anton:         { label: 'Anton',                     kind: 'display', stack: `'Anton',Impact,system-ui,sans-serif`, google: 'Anton:wght@400' },
  teko:          { label: 'Teko',                      kind: 'display', stack: `'Teko',Impact,system-ui,sans-serif`, google: 'Teko:wght@300;400;500;600;700' },
  barlowcond:    { label: 'Barlow Condensed',          kind: 'display', stack: `'Barlow Condensed',Impact,system-ui,sans-serif`, google: 'Barlow+Condensed:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  sairacond:     { label: 'Saira Condensed',           kind: 'display', stack: `'Saira Condensed',Impact,system-ui,sans-serif`, google: 'Saira+Condensed:wght@300;400;500;600;700;800' },
  archivoblack:  { label: 'Archivo Black',             kind: 'display', stack: `'Archivo Black',Impact,system-ui,sans-serif`, google: 'Archivo+Black:wght@400' },
  russo:         { label: 'Russo One',                 kind: 'display', stack: `'Russo One',Impact,system-ui,sans-serif`, google: 'Russo+One:wght@400' },
  righteous:     { label: 'Righteous',                 kind: 'display', stack: `'Righteous',Impact,system-ui,sans-serif`, google: 'Righteous:wght@400' },
  alfaslab:      { label: 'Alfa Slab One',             kind: 'display', stack: `'Alfa Slab One',Impact,system-ui,sans-serif`, google: 'Alfa+Slab+One:wght@400' },
  abril:         { label: 'Abril Fatface',             kind: 'display', stack: `'Abril Fatface',Impact,system-ui,sans-serif`, google: 'Abril+Fatface:wght@400' },
  dmserif:       { label: 'DM Serif Display',          kind: 'serif',   stack: `'DM Serif Display',Georgia,serif`, google: 'DM+Serif+Display:ital,wght@0,400;1,400' },
  cinzel:        { label: 'Cinzel',                    kind: 'serif',   stack: `'Cinzel',Georgia,serif`, google: 'Cinzel:wght@400;500;600;700;800' },
  bodoni:        { label: 'Bodoni Moda',               kind: 'serif',   stack: `'Bodoni Moda',Georgia,serif`, google: 'Bodoni+Moda:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  fraunces:      { label: 'Fraunces',                  kind: 'serif',   stack: `'Fraunces',Georgia,serif`, google: 'Fraunces:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700' },
  robotoslab:    { label: 'Roboto Slab',               kind: 'serif',   stack: `'Roboto Slab',Georgia,serif`, google: 'Roboto+Slab:wght@300;400;500;600;700;800' },
  dancing:       { label: 'Dancing Script',            kind: 'script',  stack: `'Dancing Script',cursive`, google: 'Dancing+Script:wght@400;500;600;700' },
  greatvibes:    { label: 'Great Vibes',               kind: 'script',  stack: `'Great Vibes',cursive`, google: 'Great+Vibes:wght@400' },
  pacifico:      { label: 'Pacifico',                  kind: 'script',  stack: `'Pacifico',cursive`, google: 'Pacifico:wght@400' },
};
// what every unit has looked like since the site builder shipped - the default
// never moves, so an owner who never opens the card sees no change at all
const DEFAULT_FONTS = { heading: 'playfair', body: 'outfit', accent: 'dmmono', matchAll: false, accentStyle: 'spaced' };
const FONT_ROLES = ['heading', 'body', 'accent'];
// FONT SETS (Oct 20 2026): a whole pairing in one word, chosen for readability - a display or serif face for the headings
// with a plain face for the words, and the small lines in one of the two. Named apart from the style looks
// (public/site-style.js), so "make it look modern" and "sporty fonts" never mean the same thing.
const FONT_SETS = {
  original:  { label: 'Original - Playfair Display headings, Outfit text (the site as built)', heading: 'playfair', body: 'outfit', accent: 'dmmono' },
  clean:     { label: 'Clean - one font everywhere (Inter)', heading: 'inter', body: 'inter', accent: 'inter', matchAll: true },
  sporty:    { label: 'Sporty - Bebas Neue headings, Barlow text', heading: 'bebas', body: 'barlow', accent: 'barlowcond' },
  elegant:   { label: 'Elegant - Cormorant Garamond headings, Lora text', heading: 'cormorant', body: 'lora', accent: 'cormorant' },
  strong:    { label: 'Strong - Anton headings, Rubik text', heading: 'anton', body: 'rubik', accent: 'rubik' },
  sleek:     { label: 'Sleek - Space Grotesk headings, Manrope text', heading: 'spacegrotesk', body: 'manrope', accent: 'spacegrotesk' },
  warm:      { label: 'Warm - Poppins headings, Nunito Sans text', heading: 'poppins', body: 'nunitosans', accent: 'poppins' },
  clubhouse: { label: 'Clubhouse - DM Serif Display headings, Source Sans 3 text', heading: 'dmserif', body: 'sourcesans', accent: 'sourcesans' },
  signature: { label: 'Signature - Dancing Script headings, Nunito Sans text', heading: 'dancing', body: 'nunitosans', accent: 'nunitosans' },
};
// a script face is for headings and the small lines - never what a visitor reads at length (readability)
const BODY_OK = (id) => !!FONTS[id] && FONTS[id].kind !== 'script';

/** The three font ids in force, with matchAll folded in.
 *  matchAll is the uniformity the customer asked for: ONE family everywhere,
 *  including the small line above a heading and every button. */
function resolveFonts(saved) {
  const f = (saved && typeof saved.fonts === 'object' && saved.fonts) || {};
  const out = {};
  for (const r of FONT_ROLES) out[r] = FONTS[f[r]] ? f[r] : DEFAULT_FONTS[r];
  if (!BODY_OK(out.body)) out.body = DEFAULT_FONTS.body;   // never a script face for the words (Oct 20 2026)
  out.matchAll = !!f.matchAll;
  out.accentStyle = f.accentStyle === 'plain' ? 'plain' : 'spaced';
  if (out.matchAll) { out.heading = out.body; out.accent = out.body; }
  return out;
}

/** The CSS custom properties the whole site reads. The three variable names are
 *  the ones site.css has always used, so every existing rule keeps working. */
function fontVars(fonts) {
  const f = fonts || resolveFonts(null);
  const st = id => (FONTS[id] || FONTS.system).stack;
  return {
    '--font-display': st(f.heading),
    '--font-body':    st(f.body),
    '--font-mono':    st(f.accent),
    // the small caps line above a heading. Its 4px letter-spacing and
    // UPPERCASE are what make one family read as a second one - the customer
    // counted four faces on a page that only had three. 'plain' turns the
    // treatment off and leaves it as ordinary small text.
    '--kicker-spacing':   f.accentStyle === 'plain' ? '0' : '4px',
    '--kicker-transform': f.accentStyle === 'plain' ? 'none' : 'uppercase',
    // the business name in the top bar is the same story - 3px of tracking on
    // an ordinary sans reads as a different face to most people
    '--brand-spacing':    f.accentStyle === 'plain' ? '.5px' : '3px',
  };
}

/** The ONE stylesheet link for exactly the families in use - no more, no fewer.
 *  Returns '' when every chosen font is the system stack (no request at all). */
function fontHref(fonts) {
  const f = fonts || resolveFonts(null);
  const fams = [];
  for (const id of [f.heading, f.body, f.accent]) {
    const g = (FONTS[id] || {}).google;
    if (g && !fams.includes(g)) fams.push(g);
  }
  if (!fams.length) return '';
  return 'https://fonts.googleapis.com/css2?' + fams.map(x => 'family=' + x).join('&') + '&display=swap';
}

function resolve() {
  let saved = null;
  try {
    const row = dbM.db.prepare(`SELECT value FROM website_content WHERE key = 'theme'`).get();
    if (row) saved = JSON.parse(row.value);
  } catch { saved = null; }
  return resolveSaved(saved);
}
/** The theme as the owner saved it (website_content.theme), resolved - colours, fonts, style. resolve() reads it first;
 *  the assistant passes the one it read through the owner's own routes (Oct 20 2026, late: a flyer's brand). */
function resolveSaved(saved) {
  saved = (saved && typeof saved === 'object') ? saved : null;
  const presetKey = (saved && saved.preset && PRESETS[saved.preset]) ? saved.preset : DEFAULT_PRESET;
  const base = PRESETS[presetKey];
  const out = Object.assign({}, base);

  if (saved && saved.custom && saved.colors && typeof saved.colors === 'object') {
    for (const role of ROLES) {
      if (isHex(saved.colors[role])) out[role] = saved.colors[role];
    }
  }
  return { preset: presetKey, custom: !!(saved && saved.custom), colors: out, fonts: resolveFonts(saved), design: STYLE.resolve(saved && saved.design) };
}
// THE SITE'S STYLE (Oct 20 2026): the places an owner - or their assistant - may change how the site is
// shaped, as settings the signed pages read (public/site-style.js). Only what differs from the site as built becomes a
// property, so a unit that never chose a style gets no new line at all.
const STYLE = require('../public/site-style.js');
function designVars(design) { return STYLE.vars(design); }

// Map the 13 brand roles onto the variables the BOOKING APP understands.
// The app was written against five loose keys; rather than rewrite every
// consumer, we translate here so one brand drives both surfaces.
function forBookingApp() {
  const { colors, preset, custom } = resolve();
  return {
    // legacy key names the booking app already reads
    bgColor:      colors.bg,
    surfaceColor: colors.card,
    accentColor:  colors.accent,
    textColor:    colors.text,
    mutedColor:   colors.muted,
    // richer set for surfaces that want it (headers, buttons, borders)
    headingColor: colors.heading,
    lineColor:    colors.line,
    btnColor:     colors.btn,
    btnTextColor: colors.btnText,
    headerBg:     colors.headerBg,
    headerText:   colors.headerText,
    altBgColor:   colors.bg2,
    accent2Color: colors.accent2,
    // provenance so a client can cache-bust or debug
    preset, custom
  };
}

// ── CONTRAST SAFETY (maintainer: "contrast safety always needs to be a priority") ──
// WCAG relative luminance + contrast ratio. Used to WARN, never to block:
// the owner's brand is theirs, but they should be told before customers
// hit an unreadable page.
function luminance(hex) {
  const h = String(hex).replace('#', '');
  const chan = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}
function contrastRatio(a, b) {
  if (!isHex(a) || !isHex(b)) return 21;
  const l1 = luminance(a), l2 = luminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// Pairs that decide whether a real customer can read the page.
// Thresholds (Sep 6 2026, maintainer: "as compliant as possible"): WCAG AA is 4.5:1
// for text below 24px, and every role here is used at small sizes somewhere -
// muted for labels and hints, accent for kickers and prices, accent2 for
// links and the mono eyebrow. So every text pair is held to 4.5 against BOTH
// surfaces it can sit on (page and card). The shipped presets pass all of
// them (their muted/accent/accent2 were darkened on Sep 6 2026 to get there),
// so the warning only ever speaks up about an owner's own colours. Links on
// the dark header and footer use headerText, which is measured against
// headerBg - that is why accent is not measured against the header.
const PAIRS = [
  ['text', 'bg', 4.5, 'Body Text on Page Background'],
  ['text', 'card', 4.5, 'Body Text on Card Background'],
  ['heading', 'bg', 4.5, 'Headings on Page Background'],
  ['heading', 'card', 4.5, 'Headings on Card Background'],
  ['btnText', 'btn', 4.5, 'Button Text on Buttons'],
  ['headerText', 'headerBg', 4.5, 'Header Text on Header Background'],
  ['muted', 'bg', 4.5, 'Muted Text on Page Background'],
  ['muted', 'card', 4.5, 'Muted Text on Card Background'],
  ['accent', 'bg', 4.5, 'Accent Text on Page Background'],
  ['accent', 'card', 4.5, 'Accent Text on Card Background'],
  ['accent2', 'bg', 4.5, 'Links on Page Background'],
  ['accent2', 'card', 4.5, 'Links on Card Background']
];

function auditColors(colors) {
  const issues = [];
  for (const [fg, bg, min, label] of PAIRS) {
    const r = contrastRatio(colors[fg], colors[bg]);
    if (r < min) issues.push({ pair: label, ratio: r, needed: min });
  }
  return { ok: issues.length === 0, issues };
}

function audit() { return auditColors(resolve().colors); }

module.exports = {
  PRESETS, ROLES, DEFAULT_PRESET,
  FONTS, FONT_ROLES, DEFAULT_FONTS, FONT_SETS, BODY_OK, resolveFonts, fontVars, fontHref, designVars,
  resolve, resolveSaved, forBookingApp, contrastRatio, auditColors, audit, isHex
};
