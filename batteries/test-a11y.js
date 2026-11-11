// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-a11y.js — accessibility as a STANDING check, not a one-time audit.
// Scans every customer- and staff-facing page for the barriers that actually
// stop people: controls a screen reader cannot name, keyboard traps, invisible
// focus, images with no text alternative, and headings that lie about
// structure. Fails the build so a11y cannot quietly regress.
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '\n        ' + (Array.isArray(x) ? x.slice(0, 6).join('\n        ') : x) : '')); } };

// Pages real people use. Internal/dev pages excluded deliberately.
const PAGES = ['index.html', 'landing.html', 'admin.html', 'staff.html', 'setup.html',
               'memberships.html', 'gift-cards.html', 'events.html', 'how-it-works.html',
               'my-booking.html', 'privacy.html', 'sms-terms.html', 'coming-soon.html',
               'admin-website.html', 'me.html', 'my-membership.html', 'kiosk.html',
               'staff-offsite.html', 'locked.html'];

const load = (f) => {
  const p = path.join('public', f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
// Strip <script> and <style> so markup checks never trip over JS template
// strings that merely contain angle brackets.
const markup = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

const present = PAGES.filter(p => load(p) !== null);
console.log(`Scanning ${present.length} pages\n`);

// ── 1. Language ──
{
  const bad = present.filter(f => !/<html[^>]*\blang=/i.test(load(f)));
  ok('every page declares a language (screen readers pick the right voice)', bad.length === 0, bad);
}

// ── 2. Page title ──
{
  const bad = present.filter(f => !/<title>\s*\S/i.test(load(f)));
  ok('every page has a title', bad.length === 0, bad);
}

// ── 3. Viewport must not block zoom ──
{
  const bad = present.filter(f => /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(load(f)));
  ok('no page blocks pinch-zoom (low-vision users need it)', bad.length === 0, bad);
}

// ── 4. Images need a text alternative ──
{
  const bad = [];
  for (const f of present) {
    for (const img of markup(load(f)).match(/<img\b[^>]*>/gi) || []) {
      if (!/\balt=/i.test(img)) bad.push(`${f}: ${img.slice(0, 70)}`);
    }
  }
  ok('every image has alt text (decorative images use alt="")', bad.length === 0, bad);
}

// ── 5. Form controls must have an accessible name ──
{
  const bad = [];
  for (const f of present) {
    const h = markup(load(f));
    const labelFor = new Set((h.match(/<label[^>]*\bfor="([^"]+)"/gi) || [])
      .map(m => (m.match(/for="([^"]+)"/i) || [])[1]));
    // A control WRAPPED in a label is implicitly named - no id needed.
    const wrappedSpans = [];
    for (const lm of h.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)) {
      wrappedSpans.push([lm.index, lm.index + lm[0].length]);
    }
    const isWrapped = (idx) => wrappedSpans.some(([a, b]) => idx > a && idx < b);
    for (const m of h.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
      const el = m[0];
      const type = (el.match(/type="([^"]+)"/i) || [])[1] || 'text';
      if (['hidden', 'submit', 'button', 'image'].includes(type.toLowerCase())) continue;
      const id = (el.match(/\bid="([^"]+)"/i) || [])[1];
      const named = (id && labelFor.has(id)) || isWrapped(m.index)
        || /aria-label=|aria-labelledby=|title=/i.test(el);
      if (!named) bad.push(`${f}: ${el.slice(0, 78)}`);
    }
  }
  ok('every form control is labelled for a screen reader', bad.length === 0, bad);
}

// ── 6. Buttons and links need discernible text ──
{
  const bad = [];
  for (const f of present) {
    const h = markup(load(f));
    for (const m of h.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || []) {
      const inner = m.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim();
      if (!inner && !/aria-label=|title=/i.test(m)) bad.push(`${f}: ${m.slice(0, 70).replace(/\s+/g, ' ')}`);
    }
    for (const m of h.match(/<a\b[^>]*href=[^>]*>[\s\S]*?<\/a>/gi) || []) {
      const inner = m.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim();
      if (!inner && !/aria-label=|title=/i.test(m)) bad.push(`${f}: ${m.slice(0, 70).replace(/\s+/g, ' ')}`);
    }
  }
  ok('every button and link has a name a screen reader can announce', bad.length === 0, bad);
}

// ── 7. Clickable non-buttons must be keyboard reachable ──
{
  const bad = [];
  for (const f of present) {
    for (const el of markup(load(f)).match(/<(div|span|li|td)\b[^>]*\bonclick=[^>]*>/gi) || []) {
      const reachable = /tabindex=/i.test(el) && /role=/i.test(el);
      if (!reachable) bad.push(`${f}: ${el.slice(0, 78)}`);
    }
  }
  ok('clickable elements are reachable by keyboard (tabindex + role)', bad.length === 0, bad);
}

// ── 8. Focus must be visible ──
{
  const bad = present.filter(f => {
    const h = load(f);
    if (!/<style/i.test(h)) return false;
    const killsOutline = /outline\s*:\s*(none|0)/i.test(h);
    const restores = /:focus-visible|:focus\s*\{[^}]*outline|box-shadow[^;]*focus/i.test(h);
    return killsOutline && !restores;
  });
  ok('no page removes the focus ring without replacing it', bad.length === 0, bad);
}

// ── 9. Heading structure must not skip levels ──
{
  const bad = [];
  for (const f of present) {
    const levels = (markup(load(f)).match(/<h([1-6])\b/gi) || []).map(m => parseInt(m[2], 10));
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) { bad.push(`${f}: h${levels[i-1]} jumps to h${levels[i]}`); break; }
    }
  }
  ok('heading levels never skip (structure is navigable)', bad.length === 0, bad);
}

// ── 10. Status messages must be announced ──
{
  const customerFacing = ['index.html', 'my-booking.html', 'memberships.html', 'gift-cards.html'];
  const bad = customerFacing.filter(f => {
    const h = load(f); if (!h) return false;
    // Only containers count - an <input>/<textarea> named "msg" is a field
    // the user types into, not a region that announces changes.
    const hasStatus = /<(?:div|span|p)\b[^>]*(?:id="(?:toast|statusMsg|errorMsg|loginError)"|class="[^"]*\b(?:toast|error|status)\b)/i.test(h);
    return hasStatus && !/aria-live=|role="(alert|status)"/i.test(h);
  });
  ok('customer pages announce status and error messages (aria-live)', bad.length === 0, bad);
}

// ── 11. Colour must not be the only signal ──
{
  const bad = present.filter(f => /color:\s*(red|green)\b/i.test(markup(load(f))) &&
                                  !/aria-|role=|<strong|<b>/i.test(markup(load(f))));
  ok('meaning is never carried by colour alone', bad.length === 0, bad);
}

// ── 12. A main landmark on EVERY page; a skip link wherever a header comes first ──
// (Sep 6 2026: was two pages. The staff pad and the employee page had neither.)
{
  const bad = present.filter(f => !/<main\b|role="main"/i.test(load(f)));
  ok('every page has a main landmark', bad.length === 0, bad);
  const headerFirst = ['index.html', 'landing.html', 'admin.html', 'staff.html', 'me.html', 'setup.html',
                       'my-booking.html', 'my-membership.html', 'privacy.html', 'sms-terms.html', 'admin-website.html'];
  const bad2 = headerFirst.filter(f => { const h = load(f); return h && !/class="skip-link"/i.test(h); });
  ok('every page with a header before its content offers a skip link', bad2.length === 0, bad2);
  const chrome = load('../public/site-chrome.js') || (fs.existsSync('public/site-chrome.js') ? fs.readFileSync('public/site-chrome.js', 'utf8') : '');
  ok('the shared site header adds a skip link to #main-content on every chrome page',
     /skip-link/.test(chrome) && /main-content/.test(chrome) &&
     ['events.html', 'memberships.html', 'gift-cards.html', 'how-it-works.html'].every(f => /<main[^>]*id="main-content"/.test(load(f) || '')));
}

// ── 12b. Colour presets meet WCAG AA 4.5:1 for every text role, on both surfaces ──
// (Sep 6 2026, maintainer: "as compliant as possible". Muted and accent text read at
// 2.9-4.2:1 in six of the eight shipped light presets before this.)
{
  let theme = null; try { theme = require('./services/theme'); } catch {}
  const PAIRS = [['text','bg'],['text','card'],['heading','bg'],['heading','card'],['btnText','btn'],['headerText','headerBg'],
                 ['muted','bg'],['muted','card'],['accent','bg'],['accent','card'],['accent2','bg'],['accent2','card']];
  const bad = [];
  if (theme) for (const k of Object.keys(theme.PRESETS)) {
    const p = theme.PRESETS[k];
    for (const [fg, bg] of PAIRS) { const r = theme.contrastRatio(p[fg], p[bg]); if (!(r >= 4.5)) bad.push(`${k} ${fg}/${bg} ${r}`); }
    const a = theme.auditColors(p); if (!a.ok) bad.push(`${k}: audit says ${a.issues.map(i => i.pair).join(', ')}`);
  }
  ok('every shipped colour preset reads at 4.5:1 for body, muted, heading, accent, link, button and header text (WCAG AA)', !!theme && bad.length === 0, bad);
  // the owner's own colours are held to the same bar by the editor's warning
  const src = theme ? fs.readFileSync('services/theme.js', 'utf8') : '';
  ok('the theme audit that warns owners measures muted, accent and link text at 4.5 (not 3.0)',
     /\['muted', 'bg', 4\.5/.test(src) && /\['accent', 'card', 4\.5/.test(src) && /\['accent2', 'bg', 4\.5/.test(src) && !/, 3, '/.test(src));
  // every copy of the preset table carries the same values
  const copies = ['public/landing.html', 'public/admin-website.html'].map(f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const drift = [];
  if (theme) for (const k of Object.keys(theme.PRESETS)) for (const role of ['muted', 'accent', 'accent2', 'text', 'bg'])
    for (const c of copies) if (c && !c.includes(role + ":'" + theme.PRESETS[k][role] + "'")) drift.push(k + '.' + role);
  ok('the landing page and the editor carry the same preset values as the server', drift.length === 0, drift.slice(0, 6));
  // links on the dark header and footer read in header text, which IS measured
  const css = fs.existsSync('public/site.css') ? fs.readFileSync('public/site.css', 'utf8') : '';
  ok('links on the dark header and footer use the measured header text colour, not the accent',
     css.includes('.siteFoot a{color:var(--headerText)') && css.includes('.drawer a.book{color:var(--headerText)'));
}

// ── 12c. Moving content: the video block can be paused and respects reduced motion ──
{
  const h = load('landing.html') || '';
  ok('an autoplaying video block has a Pause/Play control with aria-pressed',
     h.includes('class="vidToggle"') && h.includes('aria-pressed=') && h.includes('function vidToggle('));
  ok('the video does not autoplay for a visitor who asked for reduced motion',
     h.includes("matchMedia('(prefers-reduced-motion: reduce)')") && h.includes("REDUCE_MOTION ? '' : ' autoplay'"));
  ok('reveal animations are switched off under reduced motion', /prefers-reduced-motion: reduce\)\{ \.reveal\{opacity:1;transform:none;transition:none\}/.test(h));
}

// ── 13. Every button must actually DO something ──
// A control wired to a function that does not exist fails silently: the
// owner clicks Save, nothing happens, no error they can see, work lost.
// Found exactly that on the SMS templates card (saveSms() never existed).
{
  const KEYWORDS = new Set(['if','for','while','switch','return','typeof','new','delete','catch','function']);
  const GLOBALS = new Set(['alert','confirm','prompt','parseInt','parseFloat','String','Number','Boolean',
                           'setTimeout','setInterval','encodeURIComponent','decodeURIComponent','isNaN']);
  const dead = [];
  for (const f of present) {
    const h = load(f);
    const scripts = (h.match(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi) || []).join(' ');
    const body = markup(h);
    const defined = new Set();
    for (const m of scripts.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
    for (const m of scripts.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)) defined.add(m[1]);
    for (const m of scripts.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
    for (const h2 of body.matchAll(/on(?:click|change|input|submit|keydown|blur|focus)="([^"]+)"/gi)) {
      for (const c of h2[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = c[1];
        if (KEYWORDS.has(name) || GLOBALS.has(name) || defined.has(name)) continue;
        dead.push(`${f}: ${name}() is called by a control but never defined`);
      }
    }
  }
  ok('every button and control calls a function that exists', dead.length === 0, dead);
}

// ── 14. Settings must stay navigable ──
// 19 cards on one endless page meant the staff roster was findable only by
// scrolling past everything else - functionally the same as not existing.
{
  const h = load('admin.html') || '';
  const i = h.indexOf('id="tab-settings"'), j = h.indexOf('id="tab-pricing"');
  const seg = (i >= 0 && j > i) ? h.slice(i, j) : '';
  const cards = (seg.match(/<div class="card"[^>]*>\s*<div class="card-title"/g) || []).length;
  const grouped = (seg.match(/data-sgroup="/g) || []).length;
  ok('every Settings card belongs to a navigable group', cards > 0 && grouped >= cards, { cards, grouped });
  ok('Settings has a sub-navigation', /id="settingsSubnav"/.test(h));
  // The long tabs all need it, not just Settings - 10+ cards on one scroll is
  // how the staff roster became unfindable in the first place.
  for (const [tab, nav] of [['sms', 'smsSubnav'], ['members', 'memSubnav']]) {
    const sm = h.match(new RegExp('<div class="section"[^>]*id="tab-' + tab + '"[^>]*>'));
    if (!sm) continue;
    const from = h.indexOf(sm[0]);
    const rest = h.slice(from + sm[0].length);
    const to = rest.indexOf('<div class="section"');
    const sseg = to > 0 ? rest.slice(0, to) : rest;
    const c = (sseg.match(/<div class="card"[^>]*>\s*<div class="card-title"/g) || []).length;
    const g = (sseg.match(/data-sgroup="/g) || []).length;
    ok(`the ${tab} tab is grouped and navigable`, c === 0 || (g >= c && h.includes('id="' + nav + '"')), { tab, cards: c, grouped: g });
  }
  ok('staff sign-in codes are their own card, not buried in another',
     /card-title[^>]*>(?:<span[^>]*><\/span>)?\s*Staff &amp; Sign-In Codes/.test(h));
}

// ── 15. Password fields must not be mistaken for credentials ──
// Every API-key box was type="password" with no autocomplete, so the browser
// offered to "save your password" when an owner saved a MENU CATEGORY - and
// would happily autofill the admin password into the Stripe secret key box,
// silently breaking payments.
{
  const h = load('admin.html') || '';
  const pw = h.match(/<input[^>]*type="password"[^>]*>/g) || [];
  const unmarked = pw.filter(t => !/autocomplete=/.test(t));
  ok('every password-type field declares its autocomplete intent', unmarked.length === 0,
     unmarked.map(t => (t.match(/id="([^"]+)"/) || [])[1]));
  ok('exactly one field is a real credential', (h.match(/autocomplete="current-password"/g) || []).length === 1);
}

// ── 16. Menu starters must reference things that exist ──
// A starter with an invented tax code creates a category taxed at 0% - and
// nobody notices missing tax until a filing.
{
  const h = load('admin.html') || '';
  const taxes = [...new Set([...h.matchAll(/tax:'(\w+)'/g)].map(m => m[1]))];
  const roles = [...new Set([...h.matchAll(/role:'(\w+)'/g)].map(m => m[1]))];
  const validTax = ['sim', 'food', 'beverage'];
  const validRole = ['kitchen', 'bar', 'counter'];
  ok('every menu starter uses a real tax code', taxes.every(t => validTax.includes(t)), taxes);
  ok('every menu starter uses a real printer role', roles.every(r => validRole.includes(r)), roles);
}

// ── 17a. NOTHING may be double-bound ──
// Two listeners on one button both fire: one navigated away while the other
// toasted at a screen that no longer existed.
{
  const dbl = [];
  for (const f of ['staff.html', 'admin.html', 'admin-website.html']) {
    const h = load(f); if (!h) continue;
    const seen = {};
    for (const m of h.matchAll(/getElementById\('([\w-]+)'\)\.addEventListener\('(\w+)'/g)) {
      const k = f + ':' + m[1] + ':' + m[2];
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] === 2) dbl.push(k);
    }
  }
  ok('no element has two listeners bound for the same event', dbl.length === 0, dbl);
}

// ── 17b. STRUCTURE: sections must NEST correctly, not merely balance ──
// A cut-and-paste of one card left an extra </div> in one section and an
// unclosed <div> in the next. The COUNTS still matched, so every check
// passed - while four admin tabs rendered blank because they were nested
// inside a hidden parent. Balanced counts are not correct structure.
{
  const h = load('admin.html') || '';
  const body = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  let depth = 0; const depths = [];
  for (const m of body.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    if (m[0] === '</div>') depth--;
    else {
      const s = m[0].match(/id="tab-(\w+)"/);
      if (s) depths.push([s[1], depth]);
      depth++;
    }
  }
  ok('admin markup closes cleanly (final depth 0)', depth === 0, depth);
  const levels = [...new Set(depths.map(d => d[1]))];
  ok('every admin tab sits at the SAME nesting depth', levels.length === 1,
     depths.filter(d => d[1] !== levels[0]));
}

// ── 17. No malformed self-closing tags ──
{
  const bad = present.filter(f => /\/\s+aria-label=/.test(load(f)));
  ok('no malformed tags (stray slash before an attribute)', bad.length === 0, bad);
}

console.log('── bindings execute AFTER their markup exists (Aug 13) ──');
// The staff freeze: homeBar markup sat at the END of body, BELOW the script
// that bound its buttons at parse time - null.addEventListener threw and
// every binding after it died. Pad worked, dashboard froze. This scans each
// page for top-level getElementById(...).addEventListener lines and asserts
// the id's markup appears EARLIER in the file than the binding.
for (const f of ['staff.html', 'admin.html', 'admin-website.html', 'index.html', 'setup.html']) {
  const h = load(f) || '';
  const re = /^document\.getElementById\('([^']+)'\)\.addEventListener/gm;
  const bad = [];
  let m;
  while ((m = re.exec(h)) !== null) {
    const idPos = h.indexOf(`id="${m[1]}"`);
    if (idPos === -1) bad.push(m[1] + ' (no markup at all)');
    else if (idPos > m.index) bad.push(m[1] + ' (markup below the binding)');
  }
  ok(`${f}: every top-level binding target exists above it`, bad.length === 0, bad);
}

console.log('── password-manager hygiene (Aug 13) ──');// Chrome offered to SAVE a staff member's sign-in code as a website password
// - a shared-tablet nightmare. Roster inputs are explicitly non-credentials;
// the stored admin password field uses new-password (suppresses save
// prompts); the actual sign-in field keeps current-password on purpose.
{ const h = load('admin.html') || '';
  ok('staff roster name input is marked non-credential',
     h.includes('name="staff-name" autocomplete="off" data-1p-ignore data-lpignore="true"'));
  ok('staff roster code input is marked non-credential',
     h.includes('name="staff-code" autocomplete="off" data-1p-ignore data-lpignore="true"'));
  ok('stored admin password field uses new-password',
     h.includes('id="cfg_adminPassword" type="password" autocomplete="new-password"'));
  ok('sign-in field stays current-password (the login save offer is legitimate)',
     h.includes('id="pwInput" name="admin-password" autocomplete="current-password"')); }

console.log('\u2500\u2500 WEB HYGIENE SWEEP (maintainer law, Aug 14: adjacent issues hunted, locked) \u2500\u2500');
{
  const fs3 = require('fs');
  const st3 = fs3.readFileSync('./public/staff.html', 'utf8');
  const ix3 = fs3.readFileSync('./public/index.html', 'utf8');
  const ad3 = fs3.readFileSync('./public/admin.html', 'utf8');
  ok('hygiene: no page ever blocks pinch-zoom',
     !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1[^.]/.test(st3 + ix3 + ad3));
  ok('hygiene: modals and sheets can never trap content off-screen (max-height + scroll)',
     st3.includes('max-height:88dvh;overflow-y:auto') && st3.includes('max-height:88dvh;overflow:auto'));
  ok('hygiene: dynamic viewport units on every full-height surface (URL-bar safe)',
     st3.includes('min-height:100dvh') && st3.includes('100dvh - 108px') && ix3.includes('100dvh') && ad3.includes('100dvh'));
  ok('hygiene: no sub-16px text inputs remain (iOS focus-zoom jump)',
     ![...st3.matchAll(/([^{}]*input[^{}]*)\{([^}]*)\}/g)].some(m => /font-size:1[0-5]px/.test(m[2]))
     && ![...ix3.matchAll(/([^{}]*input[^{}]*)\{([^}]*)\}/g)].some(m => /font-size:1[0-5]px/.test(m[2])));
  ok('hygiene: the dead adminPassword vestige is gone; central error toast covers every save',
     !ad3.includes("!== adminPassword) adminPassword =") && ad3.includes("toast(data.error||'Request failed'"));
}

// ── responsive layout hygiene: no rigid multi-col grids that overflow ────────
{
  const fsL = require('fs');
  const admHtml = fsL.readFileSync(__dirname + '/public/admin.html', 'utf8');
  // rigid 4-col form grids (1fr x4) cramp on phone/tablet - none should remain
  const rigid4 = (admHtml.match(/grid-template-columns:1fr 1fr 1fr 1fr(?!\s*!important)/g) || []).length;
  ok('layout: no rigid 4-column grids remain (they crush on mobile)', rigid4 === 0, { rigid4 });
  // the discount form must be auto-fit, not a fixed 7-col row
  ok('layout: the discount code form is one row on desktop and stacks on mobile',
     admHtml.includes('grid-template-columns:1.1fr 1.4fr 1.2fr 0.8fr 0.9fr 1.3fr 1.1fr auto') && /discount[\s\S]{0,400}data-gridform/i.test(admHtml.slice(admHtml.indexOf('DISCOUNT CODES'))));
  // the POS item action column has room for its buttons + a mobile card fallback
  ok('layout: POS item rows give the action buttons room and stack on phone',
     admHtml.includes('minmax(200px,auto)') && admHtml.includes('@media(max-width:760px)'));
  // pricing tier + member code grid-forms collapse on narrow screens
  ok('layout: grid-form rows (tiers, member codes) collapse to one column on mobile',
     admHtml.includes('[data-gridform]{grid-template-columns:1fr') && admHtml.includes('data-gridform'));
}

console.log(`\nACCESSIBILITY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
