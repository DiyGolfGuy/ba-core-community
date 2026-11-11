// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-website-pages.js — custom pages + mini-markup (Example Owner's wizard batch):
//  A  markup is escape-FIRST: owner text can never inject script; javascript:
//     URLs never become links (only http(s):// and /path)
//  B  server (services/markup.js) and landing.html markup() stay in lockstep
//  C  live: published page serves at /p/<slug>; drafts 404 publicly but render
//     for a signed-in admin with the DRAFT banner; nav/footer data flows via
//     the public content API; CTA config present in landing
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

(async () => {
  const root = __dirname;
  const { markupToHtml } = require('./services/markup');

  // ── A: safety ────────────────────────────────────────────────────────────
  const evil = markupToHtml('<script>alert(1)</script> **bold** [x](javascript:alert(1)) [ok](https://a.b) [rel](/book)');
  ok('script tags stay escaped', !evil.includes('<script>') && evil.includes('&lt;script&gt;'));
  ok('javascript: URLs never become links', !evil.includes('href="javascript:'));
  ok('https and /path links render', evil.includes('href="https://a.b"') && evil.includes('href="/book"'));
  ok('bold renders', evil.includes('<strong>bold</strong>'));
  const lists = markupToHtml('Intro line\n\n- one\n- two\n\nAfter');
  ok('bullets + paragraphs render', lists.includes('<ul') && lists.includes('<li>one</li>') && (lists.match(/<p /g) || []).length === 2, lists);

  // ── B: lockstep with the landing renderer ──────────────────────────────────
  const landing = fs.readFileSync(path.join(root, 'public/landing.html'), 'utf8');
  const fnMatch = landing.match(/function markup\(t\)\{[\s\S]*?\n\}/);
  ok('landing has its own markup()', !!fnMatch);
  if (fnMatch) {
    const escFn = "function esc(s) { return String(s == null ? '' : s).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;'}[c])); }";
    const clientMarkup = new Function('t', "function esc(s){ return String(s == null ? '' : s).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])); }\n" + fnMatch[0] + "\nreturn markup(t);");
    const sample = 'Hello **there**\n\n- a\n- b\n\n[Book](/book) and <script>x</script>';
    ok('server and client renderers agree on the reference sample', clientMarkup(sample) === markupToHtml(sample), { client: clientMarkup(sample).slice(0, 80), server: markupToHtml(sample).slice(0, 80) });
    // ONE renderer (Aug 25, late): public/markup.js is what the server, the admin
    // preview, the memberships page and the member portal all run. Landing's
    // inline copy must match it on EVERY rule (dividers and headings included -
    // the old sample never exercised them, which is how the server copy drifted).
    const shared = require('./public/markup.js');
    const full = shared.REFERENCE_SAMPLE;
    ok('reference sample exercises every rule (bold, bullets, link, ---, _____, ## heading, escaping)',
       /\*\*/.test(full) && /\n- /.test(full) && /\]\(/.test(full) && /\n---\n/.test(full) && /_{5,}/.test(full) && /\n## /.test(full) && /<script>/.test(full));
    ok('landing inline markup() == public/markup.js on the full reference sample', clientMarkup(full) === shared.markupToHtml(full),
       { client: clientMarkup(full).slice(0, 120), shared: shared.markupToHtml(full).slice(0, 120) });
    ok('services/markup.js is a re-export of public/markup.js (no second copy to drift)',
       fs.readFileSync(path.join(root, 'services/markup.js'), 'utf8').includes("require('../public/markup.js')") && markupToHtml(full) === shared.markupToHtml(full));
    // fuzz: same output on 3,000 random strings built from the syntax alphabet
    const alphabet = ['a', 'b', ' ', '\n', '-', '*', '#', '_', '[', ']', '(', ')', '/', ':', '<', '>', '&', '"', 'h', 't', 'p'];
    let seed = 42, mismatch = 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 3000; i++) {
      let str = ''; const n = Math.floor(rnd() * 40);
      for (let j = 0; j < n; j++) str += alphabet[Math.floor(rnd() * alphabet.length)];
      if (clientMarkup(str) !== shared.markupToHtml(str)) mismatch++;
    }
    ok('landing inline markup() == public/markup.js on 3,000 fuzzed inputs', mismatch === 0, mismatch);
    const dh = shared.markupToHtml('a\n\n---\n\n## Members\n\n_______');
    ok('shared renderer emits dividers for --- and _____, and h4 for ## headings', (dh.match(/<hr /g) || []).length === 2 && dh.includes('<h4'));
  }
  // every public surface that shows owner-formatted text runs the shared file
  const memPage = fs.readFileSync(path.join(root, 'public/memberships.html'), 'utf8');
  ok('memberships page loads /markup.js and formats the intro AND tier descriptions through it (renderSimple variant retired)',
     memPage.includes('<script src="/markup.js"></script>') && memPage.includes("el.innerHTML = markup(intro);") && memPage.includes("markup(t.description || '')") && !memPage.includes('renderSimple'));
  const portal = fs.readFileSync(path.join(root, 'public/my-membership.html'), 'utf8');
  ok('member portal loads /markup.js and renders the tier description escaped+formatted (never raw innerHTML)',
     portal.includes('<script src="/markup.js"></script>') && portal.includes('${markup(t.description)}') && !portal.includes("perks.push({ k: 'Notes', v: t.description })"));
  // events + How It Works (Aug 25, late): the last two owner-text surfaces that rendered escaped
  const evPage = fs.readFileSync(path.join(root, 'public/events.html'), 'utf8');
  const hiwPage = fs.readFileSync(path.join(root, 'public/how-it-works.html'), 'utf8');
  ok('events page + landing next-event card render event descriptions through markup()',
     evPage.includes('<script src="/markup.js"></script>') && evPage.includes('${markup(e.description)}') && landing.includes('${markup(e.description)}') && !landing.includes('${esc(e.description)}'));
  ok('How It Works step bodies render through markup() and the page wears the site design (site.css, shared chrome)',
     hiwPage.includes('<script src="/markup.js"></script>') && hiwPage.includes('${markup(s.body)}') && hiwPage.includes('href="/site.css"') && hiwPage.includes('id="siteHead"') && !hiwPage.includes('${esc(s.body)}') && !hiwPage.includes('/api/theme'));
  // ── Sep 5 2026: one design system, one nav model, phone photos, the switch ──
  console.log('\u2500\u2500 Sep 5 2026: one site \u2500\u2500');
  const edSrc = fs.readFileSync(path.join(root, 'public/admin-website.html'), 'utf8');
  const gcPage = fs.readFileSync(path.join(root, 'public/gift-cards.html'), 'utf8');
  const siteCss = fs.readFileSync(path.join(root, 'public/site.css'), 'utf8');
  const chrome = fs.readFileSync(path.join(root, 'public/site-chrome.js'), 'utf8');
  ok('every secondary page wears site.css + the shared header/footer (no third stylesheet, no Georgia palette)',
     [evPage, memPage, gcPage, hiwPage].every(h => h.includes('href="/site.css"') && h.includes('src="/site-chrome.js"') && h.includes('id="siteHead"') && h.includes('id="siteFoot"')) && !gcPage.includes('theme.css') && !memPage.includes("font-family:Georgia"));
  ok('every secondary page carries og tags, a canonical and the share image token',
     [evPage, memPage, gcPage, hiwPage].every(h => h.includes('og:title') && h.includes('{{OG_IMAGE}}') && h.includes('rel="canonical"') && h.includes('twitter:card')));
  ok('site.css reads the 13 brand roles and keeps the legacy aliases the older pages use (--gold, --border, --panel)',
     siteCss.includes('--gold:var(--accent)') && siteCss.includes('--border:var(--line)') && siteCss.includes('--panel:var(--card)') && siteCss.includes('.siteHead') && siteCss.includes('.menuBtn') && siteCss.includes('.drawer'));
  ok('the chrome renders the top menu, a phone drawer with aria-expanded, footer links, social icons - and a plain header when the site is off',
     chrome.includes("nav.enabled !== false") && chrome.includes('aria-expanded') && chrome.includes('siteDrawer') && chrome.includes('socialHtml') && chrome.includes('window.BA_SITE') && chrome.includes("rel=\"noopener\""));
  ok('landing: default preset is pine-dark in :root and the editor (the server default - no more light editor / dark site)',
     landing.includes('--bg:#0d1810; --bg2:#111f15') && edSrc.includes("let themePreset = 'pine-dark'") && !edSrc.includes(":'fairway-light';"));
  ok('landing: every button reads the button roles, never a hard-coded dark text', landing.includes('.btn.gold{background:var(--btn);color:var(--btnText)}') && landing.includes('.topbar a.book{background:var(--btn);color:var(--btnText)') && !landing.includes('color:#14301d'));
  ok('landing: photos go through pic() -> <picture> with WebP + JPEG srcset from the server index; hero 1 is fetchpriority high, the rest lazy',
     landing.includes('function pic(src, sizes, o)') && landing.includes('type="image/webp"') && landing.includes("fetchpriority=\"high\"") && landing.includes("pic(src, '100vw', { eager: i === 0") && landing.includes("pic(it.img, '(max-width:600px) 78vw, 560px'") && landing.includes('IMAGES = data.images || {}'));
  // (Oct 20 2026, late, BA Core 2 AI) it also fetches when the page it draws is not in the inlined data - a draft page made of
  // sections, opened by the signed-in owner (the public copy never holds a draft)
  ok('landing: adopts the inlined content (window.BA_SITE) and only fetches when it is absent (or lacks the draft page being drawn); nav comes from the ONE model with the pages-flag fallback',
     landing.includes('if (window.BA_SITE) { adopt(window.BA_SITE); }') && landing.includes('if (!window.BA_SITE || PAGE_MISSING) {') && landing.includes('NAV.top.map') && landing.includes("pg.published && pg.showInNav") && landing.includes('heroDrawer'));
  ok('landing: sharing head - SITE_TITLE, META_DESCRIPTION, OG_IMAGE, twitter card, site.css + chrome footer', landing.includes('<title>{{SITE_TITLE}}</title>') && landing.includes('{{META_DESCRIPTION}}') && landing.includes('{{OG_IMAGE}}') && landing.includes('class="siteFoot" id="siteFoot"'));
  const srvSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  ok('server: fillTokens is ONE filler for templated pages and /p/<slug>; empty og:image is removed, content inlined for the content pages, robots + sitemap dynamic',
     srvSrc.includes('function fillTokens(html, req, file, over)') && srvSrc.includes("html.replace(/<meta (?:property|name)=\"(?:og:image|twitter:image)\" content=\"\">") && srvSrc.includes('window.BA_SITE=') && srvSrc.includes("app.get('/sitemap.xml'") && srvSrc.includes("app.get('/robots.txt'") && !fs.existsSync(path.join(root, 'public/sitemap.xml')) && !fs.existsSync(path.join(root, 'public/robots.txt')));
  ok('server: the website switch - /landing and /events redirect to /book when off, homepage falls back to booking, /p pages stay',
     srvSrc.includes('function siteOn()') && srvSrc.includes("siteOn() ? serveTemplated('landing.html')(req, res) : res.redirect(302, '/book')") && srvSrc.includes("st.homepage === 'landing' && st.siteEnabled !== false"));
  ok('editor: Your Website switch, Navigation card, Search & Sharing card, social fields, phone-sizing button, the page form no longer asks nav/footer (asked once on Navigation)',
     edSrc.includes('id="cardSite"') && edSrc.includes('id="siteEnabled"') && edSrc.includes('id="cardNav"') && edSrc.includes('async function saveNav()') && edSrc.includes('id="cardShare"') && edSrc.includes('id="siteTitle"') && edSrc.includes('id="socInstagram"') && edSrc.includes('optimizePhotos()') && !edSrc.includes('id="pgNav"') && !edSrc.includes('id="pgFooter"'));
  ok('editor: hygiene - saveMemberships defined once, CTA fields mark dirty, hero uploads at 2000px, session resume no longer references an undefined variable',
     (edSrc.match(/function saveMemberships\(\)/g) || []).length === 1 && edSrc.includes("id=\"heroBtn1Label\" placeholder=\"Book a Bay\" oninput=\"markDirty('cardHero');postPreview()\"") && edSrc.includes("kind==='hero'?2000:1600") && !edSrc.includes('if(PW){') && edSrc.includes("if(s.ok){ CSRF=(await s.json()).csrf||''; await boot(); loadPosMenu(); openFrameCard(); }"));   // Oct 20 2026: the resume also opens the assistant's live view at its card and reads the counter's menu
  const nav = require('./services/sitenav');
  { const r = nav.resolve({ pages: [{ slug: 'terms', title: 'Terms', published: true, showInNav: true, showInFooter: true }, { slug: 'draft', title: 'D', published: false, showInNav: true }], nav: { items: [{ key: 'page:terms' }, { key: 'how-it-works', top: true, foot: false }, { key: 'events', top: false, foot: true }] } });
    ok('sitenav: saved order wins, built-in flags override defaults, missing built-ins append with defaults, drafts never appear, memberships hidden without a sellable tier',
       r.items.map(x => x.key).join(',') === 'page:terms,how-it-works,events,gift-cards' && r.items[1].top === true && r.items[1].foot === false && r.items[2].top === false && r.top.map(x => x.key).join(',') === 'page:terms,how-it-works' && !r.items.some(x => x.key === 'memberships' || x.key === 'page:draft'), r.items.map(x => x.key));
    ok('sitenav: enabled/homepage come from settings', nav.resolve({ settings: { siteEnabled: false, homepage: 'landing' } }).enabled === false && nav.resolve({ settings: { homepage: 'landing' } }).homepage === 'landing' && nav.resolve({}).enabled === true); }
  { const si = require('./services/siteimages');
    ok('siteimages: renditions are named <base>.w<width>.jpg/.webp and recognised as renditions, never originals', si.isRendition('a.w480.jpg') && si.isRendition('a.w960.webp') && !si.isRendition('a.jpg') && si.WIDTHS.join(',') === '480,960,1600'); }
  // ── waves B/C/D (Sep 5 2026): the page as blocks, the live preview, site-wide ──
  console.log('\u2500\u2500 Sep 5 2026: blocks, preview, site-wide \u2500\u2500');
  const SL = require('./public/site-layout.js');
  { const d = SL.defaultLayout({ sections: { items: [{ enabled: true, title: 'A', p1: 'x' }, { enabled: false, title: 'B', p1: 'y' }, { enabled: false }, { enabled: false }] } });
    ok('site-layout: without a saved layout the page is the one it always was - offers, the old sections as story blocks (on/off kept), steps, staffed, gallery, event, memberships, promo, visit, ctaEnd',
       d.map(b => b.type).join(',') === 'offers,story,story,steps,staffed,gallery,event,memberships,promo,visit,ctaEnd' && d[1].on === true && d[2].on === false && d[1].title === 'A', d.map(b => b.type + ':' + b.on));
    const c = { offers: { enabled: false }, promo: {}, settings: {} };
    ok('site-layout: a built-in reads its ON flag where it always lived (offers.enabled false -> off, promo default off, gallery default on)', SL.isOn({ type: 'offers' }, c) === false && SL.isOn({ type: 'promo' }, c) === false && SL.isOn({ type: 'gallery' }, c) === true && SL.isOn({ type: 'ctaEnd', on: false }, c) === false);
    ok('site-layout: setOn writes the flag into the content and names the key to save (one truth, asked once)', SL.setOn({ type: 'offers' }, c, true) === 'offers' && c.offers.enabled === true && SL.setOn({ type: 'gallery' }, c, false) === 'settings' && c.settings.galleryEnabled === false && SL.setOn({ type: 'faq', on: true }, c, false) === null);
    const saved = SL.defaultLayout({ layout: { blocks: [{ id: 'f', type: 'faq', title: 'Q' }, { id: 'steps', type: 'steps' }, { id: 'x', type: 'bogus' }, { id: 'ctaEnd', type: 'ctaEnd', on: false }] } });
    ok('site-layout: a saved layout is normalised - unknown types dropped, every built-in appended once, custom blocks whole, ctaEnd keeps its own on', saved.map(b => b.type).join(',') === 'faq,steps,ctaEnd,offers,staffed,gallery,event,memberships,promo,visit' && saved[2].on === false && !saved.some(b => b.type === 'bogus'), saved.map(b => b.type));
    const many = SL.defaultLayout({ layout: { blocks: Array.from({ length: 40 }, (_, i) => ({ id: 'k' + i, type: 'text', title: 't' + i })) } });
    ok('site-layout: capped at 24 blocks; newBlock() makes every custom kind with an id and on=true; toStored keeps built-ins as position only', many.length === 24 && Object.keys(SL.CUSTOM).every(t => { const b = SL.newBlock(t); return b && b.id && b.type === t && b.on === true; }) && JSON.stringify(SL.toStored([{ id: 'offers', type: 'offers', on: false }]).blocks[0]) === '{"id":"offers","type":"offers"}'); }
  ok('landing: loads site-layout.js, applies the layout by moving the built-in sections and rendering custom blocks, renders all nine kinds, posts the inquiry, listens for the editor preview on the same origin only',
     landing.includes('<script src="/site-layout.js"></script>') && landing.includes('function applyLayout()') && landing.includes("case 'faq'") && landing.includes("case 'rates'") && landing.includes("case 'quotes'") && landing.includes("case 'video'") && landing.includes("case 'cta'") && landing.includes("case 'form'") && landing.includes("case 'social'") && landing.includes("case 'text'") && landing.includes("case 'story'") && landing.includes("fetch('/api/website/inquiry'") && landing.includes("if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'ba-preview') return;") && landing.includes("get('preview') === '1'"));
  ok('landing: the inquiry form carries the hidden trap field and never sends from the preview; the announcement bar reads the ONE notice', landing.includes('name="website" tabindex="-1"') && landing.includes("if (PREVIEW) { msg.textContent = 'Preview - nothing is sent from here.'") && landing.includes('function renderAnnouncement()') && landing.includes('id="siteAnn"'));
  ok('chrome: draws the same notice on every other page (never twice)', chrome.includes('function renderAnnouncement(d)') && chrome.includes("if (document.getElementById('siteAnn')) return;"));
  ok('server: inquiry route is rate-limited, trap-dropped, validated, stored first then emailed; inbox list + status; layout is a content key; rates + announcement in the public content',
     fs.readFileSync(path.join(root, 'routes/website.js'), 'utf8').includes("router.post('/inquiry', inquiryLimiter") && fs.readFileSync(path.join(root, 'routes/website.js'), 'utf8').includes("if (clip(b.website, 200)) return res.json({ ok: true });") && fs.readFileSync(path.join(root, 'routes/website.js'), 'utf8').includes("router.get('/inquiries', requireAdmin") && fs.readFileSync(path.join(root, 'routes/website.js'), 'utf8').includes("'layout'];") && fs.readFileSync(path.join(root, 'routes/website.js'), 'utf8').includes('FROM pricing_tiers WHERE active = 1') && fs.readFileSync(path.join(root, 'services/db.js'), 'utf8').includes('CREATE TABLE IF NOT EXISTS website_inquiries'));
  ok('server: analytics ids are validated, add only their hosts to the CSP, inject on public pages only, and the privacy page carries the note token', srvSrc.includes('function analyticsIds()') && srvSrc.includes("/^G-[A-Z0-9]{4,16}$/") && srvSrc.includes("https://www.googletagmanager.com' : ''") && srvSrc.includes("!/admin|staff|me\\.html|setup|kiosk/.test(file)") && srvSrc.includes('fill.ANALYTICS_NOTE') && fs.readFileSync(path.join(root, 'public/privacy.html'), 'utf8').includes('{{ANALYTICS_NOTE}}') && srvSrc.includes("'events.html': 'events'"));
  ok('landing website sections (Paragraph 1/2) render through markup(), not esc()',
     landing.includes('<div class="secText">${markup(it.p1)}</div>') && landing.includes('<div class="secText">${markup(it.p2)}</div>') && !landing.includes('<p>${esc(it.p1)}</p>'));
  ok('landing renders custom nav + footer links', landing.includes('renderCustomNav') && landing.includes('footExtra'));
  ok('nav insert targets the REAL topbar CTA (a.book) with header-matched color', landing.includes("querySelector('a.book, a.btn')") && landing.includes('color:#f2efe2;text-decoration:none'));
  ok('landing paragraph fields render through markup (all six)',
     (landing.match(/markup\((h\.sub|s\.text|sf\.p1|sf\.selfText|p\.text)/g) || []).length >= 6,
     (landing.match(/markup\(/g) || []).length);
  ok('landing hero CTA is config-driven', landing.includes("ctaText:'Book a Bay'") && landing.includes("id=\"heroCta\""));
  const editor = fs.readFileSync(path.join(root, 'public/admin-website.html'), 'utf8');
  ok('editor has the Pages card + footer links + hero button fields (W44: two buttons) + image hints',
     editor.includes('cardPages') && editor.includes('footerLinksSave') && editor.includes('heroBtn1Label') && editor.includes('1920x1080'));

  // ── C: live draft/publish lifecycle ────────────────────────────────────────
  console.log('\u2500\u2500 live serve \u2500\u2500');
  const cfgPath = path.join(root, 'config.json');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  fs.writeFileSync(cfgPath, JSON.stringify({
    businessName: 'Pages Test', setup: { completed: true }, booking: { staffedAccess: false },
    server: { port: 3037, adminPassword: 'testpw123', businessName: 'Pages Test' },
    bays: [{ id: 'bay1', name: 'B1', active: true }]
  }));
  // a leftover server on 3037 (from a killed run) would answer for this battery and fail it with 401s that look like product bugs (the project's section 4)
  let held = false; try { held = (await fetch('http://localhost:3037/api/time')).ok; } catch {}
  if (held) { console.log('FAIL  port 3037 already answers - an orphaned server is running; kill it and rerun'); fail++; console.log('\nWEBSITE PAGES: ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
  const child = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let up = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const r = await fetch('http://localhost:3037/api/time'); if (r.ok) { up = true; break; } } catch {}
  }
  ok('server up', up);
  if (up) {
    const r1 = await fetch('http://localhost:3037/api/auth/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw123' }) });
    const j1 = await r1.json();
    const cookie = (r1.headers.get('set-cookie') || '').split(';')[0];
    ok('admin login for content writes', !!j1.csrf);
    const put = (key, value) => fetch('http://localhost:3037/api/website/content', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf': j1.csrf, cookie },
      body: JSON.stringify({ key, value })
    });
    const pages = [
      { slug: 'terms', title: 'Terms & Conditions', body: 'Be **nice**.\n\n- rule one\n- rule two', published: true, showInNav: true, showInFooter: true },
      { slug: 'league-info', title: 'League Info', body: 'Coming soon [Book](/book)', published: false, showInNav: false, showInFooter: false }
    ];
    const pr = await put('pages', pages);
    const prj = await pr.json();
    ok('pages saved through the content API', prj.ok === true, prj);

    const pub = await fetch('http://localhost:3037/p/terms');
    const pubHtml = await pub.text();
    ok('published page serves at /p/<slug>', pub.status === 200 && pubHtml.includes('<strong>nice</strong>') && pubHtml.includes('<li>rule one</li>'));
    ok('published page carries the business name + title', pubHtml.includes('Terms &amp; Conditions') && pubHtml.includes('Pages Test'));

    const draftAnon = await fetch('http://localhost:3037/p/league-info');
    ok('draft is 404 to the public', draftAnon.status === 404);
    const draftAdmin = await fetch('http://localhost:3037/p/league-info', { headers: { cookie } });
    const draftHtml = await draftAdmin.text();
    ok('draft renders for a signed-in admin with the DRAFT banner', draftAdmin.status === 200 && draftHtml.includes('DRAFT'));
    ok('draft page is noindex', draftHtml.includes('noindex'));

    const missing = await fetch('http://localhost:3037/p/nope');
    ok('unknown slug is 404', missing.status === 404);

    const content = await (await fetch('http://localhost:3037/api/website/content')).json();
    const cp = content.content && content.content.pages;
    ok('public content API carries ONLY published pages (draft bodies never leak)',
       Array.isArray(cp) && cp.length === 1 && cp[0].slug === 'terms' && !JSON.stringify(cp).includes('Coming soon'));
    const contentAdmin = await (await fetch('http://localhost:3037/api/website/content', { headers: { cookie } })).json();
    const cpa = contentAdmin.content && contentAdmin.content.pages;
    ok('signed-in editor still sees drafts (editor unbroken)', Array.isArray(cpa) && cpa.length === 2);

    // ── Sep 5 2026 live: one site ──
    ok('content API carries images{} and the resolved nav (terms in the top menu and footer, built-ins with defaults)',
       content.images && typeof content.images === 'object' && content.nav && content.nav.top.some(x => x.href === '/p/terms') && content.nav.items.some(x => x.key === 'events' && x.top) && !content.nav.items.some(x => x.key === 'memberships'), content.nav && content.nav.items.map(x => x.key));
    const landingHtml = await (await fetch('http://localhost:3037/landing')).text();
    ok('landing is served with the content INLINED (window.BA_SITE) and the theme injected; draft pages never ride along', landingHtml.includes('id="ba-site"') && landingHtml.includes('window.BA_SITE=') && landingHtml.includes('id="ba-theme"') && !landingHtml.includes('Coming soon'));
    ok('landing without a share image carries NO og:image tag (never an empty one); title falls back to "<name> — Indoor Golf Simulators"', !landingHtml.includes('og:image') && !landingHtml.includes('twitter:image') && landingHtml.includes('<title>Pages Test — Indoor Golf Simulators</title>'));
    // ── WHAT THE PAGE INLINES IS WHAT THE OWNER SET (Oct 20 2026) ──
    // window.BA_SITE carries the booking rates (Pricing) and the opening hours (Settings), neither of them website content,
    // and the page cache was stamped on website content alone - so a new rate or an earlier opening stayed off the homepage
    // until the website itself changed or the day turned. Seen on BA Core 2 AI, where the counter's menu rides along too.
    { const inl = async () => { const h = await (await fetch('http://localhost:3037/landing')).text(); const m = h.match(/window\.BA_SITE=(.*?);<\/script>/s); return m ? JSON.parse(m[1]) : {}; };
      const H = { 'Content-Type': 'application/json', 'x-csrf': j1.csrf, cookie };
      const open0 = ((await inl()).hours || {}).open || '';
      const tr = await (await fetch('http://localhost:3037/api/pricing/tiers', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Inline Check Rate', days: '0,1,2,3,4,5,6', start_time: '20:00', end_time: '22:00', price_per_half_hour: 31 }) })).json();
      const cr = await fetch('http://localhost:3037/api/admin/config', { method: 'POST', headers: H, body: JSON.stringify({ booking: { openTime: '07:15' } }) });
      const now = await inl();
      ok('the homepage shows a rate and an opening hour the owner just changed (the page cache is stamped on what the page inlines, not on the website\'s own content alone)',
         !!tr.success && cr.ok && (now.rates || []).some(x => x.name === 'Inline Check Rate' && +x.price_per_half_hour === 31) && (now.hours || {}).open === '07:15',
         { rates: (now.rates || []).map(x => x.name), open: (now.hours || {}).open });
      if (tr.id) await fetch('http://localhost:3037/api/pricing/tiers/' + tr.id, { method: 'DELETE', headers: H });
      await fetch('http://localhost:3037/api/admin/config', { method: 'POST', headers: H, body: JSON.stringify({ booking: { openTime: open0 } }) });
    }
    // ── A PAGE MADE OF SECTIONS (Oct 20 2026, late; maintainer: "pages not pages") ── drawn by the homepage's own page,
    // told which page it is, with the page's own search title and words; a draft one is the signed-in owner's only
    {
      const pr2 = await put('pages', pages.concat([
        { slug: 'secpage', title: 'Section Page', body: '', published: true, showInNav: true, showInFooter: false, metaTitle: 'Our Sections Page', metaDescription: 'Words for search here.', blocks: [{ id: 'bsp1', type: 'faq', title: 'Asked a lot', items: [{ q: 'Q one?', a: 'A one.' }], on: true }] },
        { slug: 'secdraft', title: 'Draft Sections', body: '', published: false, blocks: [{ id: 'bsp2', type: 'text', title: 'Hidden', body: 'Not yet.' }] }]));
      const h = await (await fetch('http://localhost:3037/p/secpage')).text();
      const d1 = await fetch('http://localhost:3037/p/secdraft'), d2 = await fetch('http://localhost:3037/p/secdraft', { headers: { cookie } }), d2h = await d2.text();
      ok('a page made of sections is drawn by the homepage itself - told which page it is, its own search title and words and its own address (never the homepage\'s canonical), its sections in the inlined data; a draft one is 404 to the public and drawn for the signed-in owner, kept out of search',
         pr2.ok && h.includes('window.BA_PAGE={"slug":"secpage","draft":false}') && h.includes('<title>Our Sections Page</title>') && /<link rel="canonical" href="[^"]*\/p\/secpage">/.test(h) && /<meta property="og:url" content="[^"]*\/p\/secpage">/.test(h) && h.includes('Words for search here.') && h.includes('"bsp1"') && h.includes('id="heroImgs"')
         && d1.status === 404 && d2.status === 200 && d2h.includes('"draft":true') && d2h.includes('noindex'),
         { title: (h.match(/<title>[^<]*<\/title>/) || [])[0], canonical: (h.match(/<link rel="canonical"[^>]*>/) || [])[0], d1: d1.status, d2: d2.status });
      await put('pages', pages);
    }
    // ── FONTS ARE PART OF THE THEME (Sep 17 2026, from a live customer) ──────
    // He counted four faces on one custom page. Two reasons: nothing in the
    // product let him choose a font, AND the custom-page renderer loaded no
    // webfont at all - /p/ pages fell back to Georgia, system-ui and Menlo
    // while the rest of his site used the real ones. Now every public page
    // carries the SAME single link, built from the families actually chosen.
    {
      const th = require('./services/theme');
      const pageHtml = await (await fetch('http://localhost:3037/p/terms')).text();
      // the STYLESHEET link only - the two preconnects point at the same hosts
      const links = h => (h.match(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi) || []).filter(x => /rel=["']?stylesheet/.test(x) || /id="ba-fonts"/.test(x));
      ok('fonts: a CUSTOM PAGE loads the site fonts - the bug the customer was looking at',
         links(pageHtml).length === 1 && pageHtml.includes('id="ba-fonts"'), links(pageHtml));
      ok('fonts: the marketing page carries exactly ONE font link, not the hardcoded one plus ours',
         links(landingHtml).length === 1, links(landingHtml));
      ok('fonts: every page gets the same link, and it names only the families in use',
         links(pageHtml)[0] === links(landingHtml)[0] && links(landingHtml)[0].includes('Playfair+Display') && links(landingHtml)[0].includes('Outfit') && links(landingHtml)[0].includes('DM+Mono'),
         links(landingHtml)[0]);
      ok('fonts: the three family variables ride in the theme block beside the colours, on both',
         /--font-display:/.test(pageHtml) && /--font-body:/.test(pageHtml) && /--font-mono:/.test(pageHtml) && /--font-display:/.test(landingHtml));
      // the editor picker, the live preview and the server must mean the same
      // thing by "Lora" - three copies of the catalogue, held in lockstep here
      const ed = fs.readFileSync('./public/admin-website.html', 'utf8');
      const land = fs.readFileSync('./public/landing.html', 'utf8');
      const missing = Object.keys(th.FONTS).filter(id => !new RegExp("\\b" + id + "\\s*:").test(land) || !new RegExp("'" + id + "'").test(ed));
      ok('fonts: the editor picker and the live preview carry every family the server knows - no option that paints nothing',
         missing.length === 0, missing);
      ok('fonts: the Colors & Fonts card offers the pickers, the one-font switch and the plain-small-lines switch',
         ed.includes('id="fontGrid"') && ed.includes('id="fontMatch"') && ed.includes('id="fontAccentPlain"') && ed.includes('function fontsFromForm()') && ed.includes('theme.fonts=fontsFromForm()'));
      ok('fonts: the live preview repaints them - applyFonts runs in renderAll and swaps the stylesheet, so a pick shows before a save',
         land.includes('function applyFonts(') && /renderAll\(\) \{[\s\S]{0,120}applyFonts/.test(land) && land.includes("id = 'ba-fonts'"));
    }
    const pubHtml2 = await (await fetch('http://localhost:3037/p/terms')).text();
    ok('published page wears the site chrome (site.css, header, footer) and carries no unfilled token', pubHtml2.includes('href="/site.css"') && pubHtml2.includes('id="siteHead"') && pubHtml2.includes('id="siteFoot"') && !pubHtml2.includes('{{'));
    for (const pth of ['/events', '/how-it-works', '/gift-cards', '/memberships']) {
      const h = await (await fetch('http://localhost:3037' + pth)).text();
      ok(`${pth} is templated: chrome present, zero unfilled tokens, business name in the title`, h.includes('id="siteHead"') && !h.includes('{{') && h.includes('Pages Test'));
    }
    const sm = await (await fetch('http://localhost:3037/sitemap.xml')).text();
    ok('sitemap is dynamic with ABSOLUTE addresses: /, /book, /landing, /events, /p/terms, never the draft', sm.includes('<loc>http://localhost:3037/</loc>') && sm.includes('/book</loc>') && sm.includes('/landing</loc>') && sm.includes('/events</loc>') && sm.includes('/p/terms</loc>') && !sm.includes('league-info'));
    const rb = await (await fetch('http://localhost:3037/robots.txt')).text();
    ok('robots.txt points at the absolute sitemap and hides admin, staff, me, kiosk, setup, api', rb.includes('Sitemap: http://localhost:3037/sitemap.xml') && ['/admin', '/admin-website', '/staff', '/me', '/kiosk', '/setup', '/api/'].every(x => rb.includes('Disallow: ' + x)));
    // share image + site title
    await put('settings', { siteTitle: 'Pages Test Indoor Golf in Testville', shareImage: '/uploads/landing/share.jpg', homepage: 'landing' });
    const home = await (await fetch('http://localhost:3037/')).text();
    ok('with the flip on and the site on, / is the landing page with the owner\'s title and an absolute og:image', home.includes('id="ba-site"') && home.includes('<title>Pages Test Indoor Golf in Testville</title>') && home.includes('og:image" content="http://localhost:3037/uploads/landing/share.jpg"'));
    // social -> JSON-LD sameAs
    await put('social', { instagram: 'https://instagram.com/pagestest', facebook: 'https://facebook.com/pagestest' });
    const home2 = await (await fetch('http://localhost:3037/')).text();
    ok('social links become an Organization JSON-LD sameAs block (search engines learn the profiles are yours)', home2.includes('"sameAs":["https://instagram.com/pagestest","https://facebook.com/pagestest"]'));
    // the switch
    await put('settings', { siteEnabled: false, homepage: 'landing' });
    const offLanding = await fetch('http://localhost:3037/landing', { redirect: 'manual' });
    const offEvents = await fetch('http://localhost:3037/events', { redirect: 'manual' });
    const offHome = await (await fetch('http://localhost:3037/')).text();
    const offTerms = await fetch('http://localhost:3037/p/terms');
    const offSm = await (await fetch('http://localhost:3037/sitemap.xml')).text();
    const offNav = await (await fetch('http://localhost:3037/api/website/content')).json();
    ok('website OFF: /landing and /events -> 302 /book, / is the booking app despite the flip, /p/terms still serves, sitemap drops /landing, nav says disabled',
       offLanding.status === 302 && /\/book$/.test(offLanding.headers.get('location') || '') && offEvents.status === 302 && offHome.includes('Book a Session') && offTerms.status === 200 && !offSm.includes('/landing</loc>') && offNav.nav.enabled === false);
    await put('settings', { siteEnabled: true, homepage: 'booking' });
    ok('website back ON: /landing serves again', (await fetch('http://localhost:3037/landing', { redirect: 'manual' })).status === 200);

    // ── W44 (Sep 10 2026): WHAT'S PUBLIC, nav overrides, hero buttons, the closing band, the notice link ──
    console.log('── W44: what is public, per element, from the editor ──');
    const B = 'http://localhost:3037';
    const st = async (p, o) => { try { return (await fetch(B + p, o)).status; } catch { return 0; } };
    ok('W44: everything public by default - /book, /memberships, /my-membership, /events, /gift-cards and their APIs answer; /leagues is 404 (no page exists until the owner opens it)',
       (await st('/book')) === 200 && (await st('/memberships')) === 200 && (await st('/my-membership')) === 200 && (await st('/events')) === 200 && (await st('/gift-cards')) === 200 && (await st('/api/bookings/availability?date=2026-12-01')) === 200 && (await st('/api/memberships/public')) === 200 && (await st('/leagues')) === 404);
    await put('settings', { siteEnabled: true, homepage: 'landing', public: { booking: false, memberships: false, portal: false, giftCards: false, leagues: true, pages: { terms: false } }, holding: { headline: 'Opening Fall 2026', text: 'Line one\nLine two' } });
    const hold = await fetch(B + '/book'); const holdHtml = await hold.text();
    ok('W44: booking OFF - typing /book gets the HOLDING PAGE (200, noindex, the owner\'s headline and text, the site chrome), not the grid', hold.status === 200 && holdHtml.includes('Opening Fall 2026') && holdHtml.includes('Line one') && holdHtml.includes('noindex') && holdHtml.includes('id="siteHead"') && !holdHtml.includes('Book a Session'), holdHtml.slice(0, 200));
    ok('W44: booking OFF - My Booking is the holding page too, and the booking APIs answer 404 (availability, bays, checkout, the customer code routes, member PIN)',
       (await st('/my-booking')) === 200 && (await (await fetch(B + '/my-booking')).text()).includes('Opening Fall 2026') && (await st('/api/bookings/availability?date=2026-12-01')) === 404 && (await st('/api/bookings/bays')) === 404 && (await st('/api/bookings/create-payment-intent', { method: 'POST' })) === 404 && (await st('/api/customer/request-pin', { method: 'POST' })) === 404 && (await st('/api/members/validate-pin', { method: 'POST' })) === 404);
    ok('W44: memberships / portal / gift cards OFF - the pages hold, their APIs 404; a custom page switched off is 404; leagues ON is the holding page at /leagues',
       (await (await fetch(B + '/memberships')).text()).includes('Opening Fall 2026') && (await st('/api/memberships/public')) === 404 && (await st('/my-membership')) === 200 && (await st('/api/members/portal', { method: 'POST' })) === 404 && (await st('/api/gifts/checkout', { method: 'POST' })) === 404 && (await st('/p/terms')) === 404 && (await st('/leagues')) === 200 && (await (await fetch(B + '/leagues')).text()).includes('Line two'));
    ok('W44: what stays: events, how-it-works, privacy, sms-terms, the content API, /api/time', (await st('/events')) === 200 && (await st('/how-it-works')) === 200 && (await st('/privacy')) === 200 && (await st('/api/website/content')) === 200 && (await st('/api/time')) === 200);
    ok('W44: the signed-in owner keeps everything - the booking API and the switched-off page answer with the session', (await st('/api/bookings/availability?date=2026-12-01', { headers: { cookie } })) === 200 && (await st('/p/terms', { headers: { cookie } })) === 200);
    const stok = (await (await fetch(B + '/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '0000' }) })).json()).token;
    ok('W44: a staff token passes the gate too (the pad still books) - or no staff code exists on this test unit and the check is moot', !stok || (await st('/api/bookings/availability?date=2026-12-01', { headers: { 'x-staff-token': stok } })) === 200);
    const smOff = await (await fetch(B + '/sitemap.xml')).text();
    ok('W44: the sitemap drops every address that is not public (/book, /memberships, /gift-cards, /p/terms) and lists /leagues and /events', !smOff.includes('/book</loc>') && !smOff.includes('/memberships</loc>') && !smOff.includes('/gift-cards</loc>') && !smOff.includes('/p/terms') && smOff.includes('/leagues</loc>') && smOff.includes('/events</loc>'), smOff.match(/<loc>[^<]*/g));
    const cOff = await (await fetch(B + '/api/website/content')).json();
    ok('W44: the navigation model drops memberships, gift cards and the switched-off page, adds Leagues, and carries the public map + holding words for the pages to read',
       cOff.nav && !cOff.nav.items.some(i => i.key === 'memberships' || i.key === 'gift-cards' || i.key === 'page:terms') && cOff.nav.items.some(i => i.key === 'leagues' && i.top) && cOff.nav.public && cOff.nav.public.booking === false && cOff.nav.public.pages.terms === false && cOff.nav.holding.headline === 'Opening Fall 2026', cOff.nav && cOff.nav.items.map(i => i.key));
    ok('W44: the notice carries its link (Settings > Notice) - empty here, present as a field', cOff.announcement && 'link' in cOff.announcement);
    const homeOff = await (await fetch(B + '/')).text();
    ok('W44: / with the landing homepage still serves the landing while booking is off', homeOff.includes('id="ba-site"'));
    await put('settings', { siteEnabled: true, homepage: 'booking', public: { booking: false } });
    ok('W44: / with the BOOKING homepage and booking off - the landing page stands in (the site is on), never the grid', (await (await fetch(B + '/')).text()).includes('id="heroHeadline"'));
    await put('settings', { siteEnabled: false, homepage: 'booking', public: { booking: false } });
    ok('W44: / with the site OFF and booking off - the holding page', (await (await fetch(B + '/')).text()).includes('id="holdingHeadline"'));
    await put('settings', { siteEnabled: true, homepage: 'booking' });
    ok('W44: switches back on - /book is the grid again, /leagues 404 again, /p/terms serves', (await (await fetch(B + '/book')).text()).includes('Book a Session') && (await st('/leagues')) === 404 && (await st('/p/terms')) === 200);
    // one map, two copies: services/sitenav (the gate, the sitemap) and public/site-layout.js (the pages) must agree
    { const sn = require('./services/sitenav'); const L = require('./public/site-layout.js');
      const settings = { public: { booking: false, leagues: true, pages: { terms: false } } };
      const sample = ['/book', '/book/', '/my-booking', '/memberships', '/my-membership', '/events', '/gift-cards', '/leagues', '/p/terms', '/p/Terms#top', '/p/other', '/how-it-works', 'https://x.y/', '#offers', '/'];
      const srv = sample.map(h => sn.hrefPublic(sn.publicMap(settings), h)), cli = sample.map(h => L.hrefPublic(L.publicMap(settings), h));
      ok('W44: the server\'s hrefPublic (gate, sitemap) and the client\'s (buttons, sections, footer) agree on every sample address', JSON.stringify(srv) === JSON.stringify(cli), { srv, cli });
      ok('W44: the server SURFACES list and the client SURFACE_PATHS name the same paths', Object.values(sn.SURFACES).flatMap(d => d.paths).sort().join() === Object.keys(L.SURFACE_PATHS).sort().join());
    }
    // nav: label + link overrides for built-ins, the owner's own links, bad links fall back
    await put('nav', { items: [{ key: 'events', top: true, foot: true, label: "What's On", href: '/events' }, { key: 'link:l1', label: 'Our Golf Course', href: 'https://example.com/course', top: true, foot: false }, { key: 'link:l2', label: 'no link', href: '', top: true }, { key: 'gift-cards', top: true, foot: true, label: '', href: 'javascript:alert(1)' }] });
    const cNav = await (await fetch(B + '/api/website/content')).json();
    const top = cNav.nav.top;
    ok('W44: a built-in carries the owner\'s label ("What\'s On" for Events) and remembers its built-in words; a bad link falls back to the built-in link', top.find(i => i.key === 'events').label === "What's On" && top.find(i => i.key === 'events').defaultLabel === 'Events' && top.find(i => i.key === 'gift-cards').href === '/gift-cards' && top.find(i => i.key === 'gift-cards').label === 'Gift Cards', top);
    ok('W44: the owner\'s own link is in the top menu, marked external (opens in a new tab); a link without an address is dropped', top.some(i => i.key === 'link:l1' && i.external === true && i.href === 'https://example.com/course' && i.custom) && !top.some(i => i.key === 'link:l2') && !cNav.nav.foot.some(i => i.key === 'link:l1'));
    // hero buttons + the closing band + the notice link ride through the content API and the inlined page
    await put('hero', { headline: 'Two buttons', buttons: [{ label: 'Book a Bay', link: '/book', show: true }, { label: 'Join', link: '/memberships', show: true }], ctaText: 'Book a Bay', ctaLink: '/book' });
    await put('layout', { blocks: [{ id: 'offers', type: 'offers' }, { id: 'ctaEnd', type: 'ctaEnd', on: true, title: 'See you on the tee', text: 'Any day, any hour.', button: 'Reserve', link: '/book' }] });
    const landW = await (await fetch(B + '/landing')).text();
    ok('W44: the landing carries two hero button slots, the closing band with ids, and the inlined content has the buttons and the band\'s own words', landW.includes('id="heroCta2"') && landW.includes('id="finalTitle"') && landW.includes('"buttons":[{"label":"Book a Bay"') && landW.includes('"title":"See you on the tee"') && landW.includes('"button":"Reserve"'));
    const L2 = require('./public/site-layout.js');
    const lay2 = L2.defaultLayout((await (await fetch(B + '/api/website/content')).json()).content);
    ok('W44: site-layout keeps the closing band\'s fields through normalisation and storage', (() => { const e = lay2.find(b => b.type === 'ctaEnd'); const stored = L2.toStored(lay2).blocks.find(b => b.type === 'ctaEnd'); return e && e.title === 'See you on the tee' && e.button === 'Reserve' && stored.link === '/book'; })());
    await put('nav', { items: [] }); await put('layout', { blocks: [] });

    // ── B-wave 1 (Sep 11 2026): PREVIOUS VERSIONS - every save keeps what it replaced; Restore puts it back ──
    console.log('── B-wave 1: previous versions and restore ──');
    {
      const HB = 'http://localhost:3037';
      const H = { 'Content-Type': 'application/json', 'x-admin-password': 'testpw123' };
      const hist = async key => (await fetch(HB + '/api/website/history?key=' + key, { headers: H })).json();
      const content = async () => (await fetch(HB + '/api/website/content')).json();
      await put('promo', { enabled: true, label: 'FIRST', title: 'Version one', text: 'one' });
      const h0 = await hist('promo');
      await put('promo', { enabled: true, label: 'FIRST', title: 'Version two', text: 'two' });
      const h1 = await hist('promo');
      ok('a save keeps the value it REPLACED as a version (one more after the second save), newest first, with a readable summary', h1.versions.length === h0.versions.length + 1 && h1.versions[0].summary === 'Version one' && /^\d{4}-\d\d-\d\d/.test(h1.versions[0].savedAt), h1.versions.slice(0, 2));
      await put('promo', { enabled: true, label: 'FIRST', title: 'Version two', text: 'two' });
      ok('saving the SAME value again keeps no version (nothing was replaced)', (await hist('promo')).versions.length === h1.versions.length);
      const one = h1.versions[0];
      const got = await (await fetch(HB + '/api/website/history/' + one.id, { headers: H })).json();
      ok('a version can be read back in full', got.key === 'promo' && got.value && got.value.title === 'Version one', got);
      const rs = await fetch(HB + '/api/website/history/restore', { method: 'POST', headers: H, body: JSON.stringify({ id: one.id }) });
      const now = (await content()).content.promo;
      ok('Restore puts the version back as the LIVE value (the content API answers with it)', rs.status === 200 && now && now.title === 'Version one', { s: rs.status, now });
      const h2 = await hist('promo');
      ok('the restore itself is a save: the value it replaced ("Version two") is now the newest version, marked as a restore', h2.versions[0].summary === 'Version two' && /restore of version/.test(h2.versions[0].note || ''), h2.versions[0]);
      const bad = await fetch(HB + '/api/website/history/restore', { method: 'POST', headers: H, body: JSON.stringify({ id: 99999999 }) });
      ok('restoring a version that does not exist is refused (404), nothing changes', bad.status === 404 && (await content()).content.promo.title === 'Version one');
      const anon = await fetch(HB + '/api/website/history?key=promo');
      ok('the history is the owner\'s: a visitor gets 401', anon.status === 401, anon.status);
      const badKey = await fetch(HB + '/api/website/history?key=nope', { headers: H });
      ok('an unknown key is refused (400)', badKey.status === 400);
      // the cap: thirty per key, the oldest dropped
      for (let i = 0; i < 34; i++) await put('promo', { enabled: true, label: 'FIRST', title: 'Version ' + (10 + i), text: 't' });
      const h3 = await hist('promo');
      ok('at most thirty versions are kept per key (the oldest fall off), newest first', h3.versions.length === 30 && h3.versions[0].summary === 'Version 42', { n: h3.versions.length, top: h3.versions[0] && h3.versions[0].summary });
      const log = await (await fetch(HB + '/api/admin/log?per_page=50', { headers: H })).json();
      const rows = Array.isArray(log) ? log : (Object.values(log || {}).find(Array.isArray) || []);
      ok('the owner\'s log records the restore (WEBSITE_CONTENT_RESTORED with the section and the version)', rows.some(e => e.event === 'WEBSITE_CONTENT_RESTORED' && /Section: promo \| version \d+/.test(e.detail || '')), rows.filter(e => /RESTORED/.test(e.event)).map(e => e.detail));
      // the editor: a Previous versions button on every card that saves a content key, and the modal
      const aw = require('fs').readFileSync(require('path').join(root, 'public', 'admin-website.html'), 'utf8');
      const btns = (aw.match(/histOpen\('([a-z]+)','st[A-Za-z]+'\)/g) || []);
      ok('every card that saves a website key has a Previous versions button (fifteen save rows), and the modal restores through boot() + pvReload()', btns.length === 15 && /id="histModal"/.test(aw) && /async function histRestore\(id\)/.test(aw) && /await boot\(\);/.test(aw) && /pvReload\(\);/.test(aw), btns.length);
      await put('promo', { enabled: false, label: '', title: '', text: '' });
    }

    // ── W44 addendum: a link that points at nothing hides with it; per-page search words; free-form social ──
    console.log('── W44 addendum: dead links, per-page words, social ──');
    await put('settings', { siteEnabled: true, homepage: 'landing', public: { booking: false, pages: { terms: true } }, footerLinks: [{ label: 'Rules', url: '/p/terms' }, { label: 'Ghost page', url: '/p/nope' }, { label: 'Book', url: '/book' }, { label: 'Promo', url: '/landing#promo' }, { label: 'Offers', url: '/landing#offers' }, { label: 'Off site', url: 'https://example.com/x' }, { label: 'Empty', url: '/#' }] });
    await put('nav', { items: [{ key: 'link:a', label: 'To promo', href: '/landing#promo', top: true }, { key: 'link:b', label: 'To offers', href: '/landing#offers', top: true }, { key: 'link:c', label: 'Ghost', href: '/p/nope', top: true }, { key: 'events', top: true, foot: true, href: '/p/nope' }] });
    const cA = await (await fetch(B + '/api/website/content')).json();
    ok('W44a: the footer links come RESOLVED - a missing page, a gated surface, an off section (promo) and an empty anchor are dropped; a published page, an on section and an off-site link stay',
       cA.nav.extra.map(l => l.label).join(',') === 'Rules,Offers,Off site', cA.nav.extra);
    ok('W44a: an owner\'s menu link to an off section or a missing page is dropped; to an on section it stays; a built-in re-pointed at a missing page falls back to its own address',
       !cA.nav.top.some(i => i.key === 'link:a' || i.key === 'link:c') && cA.nav.top.some(i => i.key === 'link:b') && cA.nav.top.find(i => i.key === 'events').href === '/events', cA.nav.top.map(i => i.key + '=' + i.href));
    { const sn = require('./services/sitenav'); const L = require('./public/site-layout.js');
      const content = { pages: [{ slug: 'rules', published: true }, { slug: 'draft', published: false }], settings: { public: { booking: false } }, promo: { enabled: false }, layout: { blocks: [{ id: 'offers', type: 'offers' }, { id: 'c1', type: 'faq', on: true }, { id: 'c2', type: 'text', on: false }] } };
      const sample = ['/book', '/landing#offers', '/#promo', '#blk-c1', '/landing#blk-c2', '/p/rules', '/p/draft', '/p/nope', '/events', 'https://x.y', '#', '/landing#nothing', 'javascript:x', '', '/my-booking#x', '/how-it-works', '#main', '/landing#main-content'];
      const srv = sample.map(h => sn.linkAlive(content, sn.publicMap(content.settings), h)), cli = sample.map(h => L.linkAlive(content, L.publicMap(content.settings), h));
      ok('W44a: server linkAlive (nav, footer) and client linkAlive (buttons, band) agree on every sample', JSON.stringify(srv) === JSON.stringify(cli), { srv, cli });
      ok('W44a: the rule itself - gated /book dead, on section alive, off section dead, custom block on alive / off dead, published page alive, draft or missing page dead, external alive, empty anchor dead',
         JSON.stringify(srv) === JSON.stringify([false, true, false, true, false, true, false, false, true, true, false, true, false, false, false, true, true, true]), srv);
    }
    // every server-rendered public page: no anchor without a target, no bare "#"
    for (const pth of ['/landing', '/events', '/memberships', '/gift-cards', '/how-it-works', '/p/terms', '/leagues', '/book']) {
      const h = await (await fetch(B + pth)).text();
      const ids = new Set([...h.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
      const anchors = [...h.matchAll(/href="#([^"]*)"/g)].map(m => m[1]);
      const dead = anchors.filter(a => !a || !ids.has(a));
      ok(`W44a: ${pth} - every in-page anchor points at an element that exists on the page (${anchors.length} anchors)`, dead.length === 0, dead);
    }
    // per-page search words and images
    await put('settings', { siteEnabled: true, homepage: 'landing', metaDescription: 'Our own words about the place.', pageMeta: { events: { title: 'Fun Nights', description: 'What is on this month.', image: '/uploads/landing/events-share.jpg' }, holding: { title: 'Soon', description: 'Opening soon.' } } });
    const evH = await (await fetch(B + '/events')).text();
    ok('W44a: the events page carries its own title, description and share image (og + twitter)', evH.includes('<title>Fun Nights</title>') && evH.includes('og:title" content="Fun Nights"') && evH.includes('name="description" content="What is on this month."') && evH.includes('og:image" content="http://localhost:3037/uploads/landing/events-share.jpg"'), evH.match(/<title>[^<]*|og:image" content="[^"]*/g));
    const lnH = await (await fetch(B + '/landing')).text();
    ok('W44a: the landing carries the site-wide description from the editor (never the booking words)', lnH.includes('content="Our own words about the place."') && !lnH.includes('book a bay, get your door code'));
    await put('settings', { siteEnabled: true, homepage: 'landing', public: { booking: false }, pageMeta: { holding: { title: 'Soon', description: 'Opening soon.' } } });
    const hoH = await (await fetch(B + '/book')).text();
    ok('W44a: the holding page carries its own search title and description', hoH.includes('<title>Soon</title>') && hoH.includes('content="Opening soon."'));
    await put('pages', [{ slug: 'terms', title: 'Terms & Conditions', body: 'Be **nice**.', published: true, showInNav: true, showInFooter: true, metaTitle: 'House Rules at Pages Test', metaDescription: 'The rules, plainly.', shareImage: '/uploads/landing/rules.jpg' }]);
    const tH = await (await fetch(B + '/p/terms')).text();
    ok('W44a: a custom page carries its own search title, og:title, description and share image', tH.includes('<title>House Rules at Pages Test</title>') && tH.includes('og:title" content="House Rules at Pages Test"') && tH.includes('content="The rules, plainly."') && tH.includes('og:image" content="http://localhost:3037/uploads/landing/rules.jpg"'), tH.match(/<title>[^<]*|og:image" content="[^"]*/g));
    await put('settings', { siteEnabled: true, homepage: 'landing' });
    const legacyH = await (await fetch(B + '/landing')).text();
    ok('W44a: with no editor description the older Settings > SEO words are still read (rule 14), and the content API hands them to the editor', legacyH.includes('name="description" content="') && (await (await fetch(B + '/api/website/content')).json()).meta && 'legacyDescription' in (await (await fetch(B + '/api/website/content')).json()).meta);
    // free-form social links
    await put('social', { instagram: 'https://instagram.com/pagestest', more: [{ label: 'LinkedIn', url: 'https://linkedin.com/company/pt' }, { label: 'bad', url: 'http://insecure' }] });
    const soc = (await (await fetch(B + '/api/website/content')).json()).content.social;
    ok('W44a: free-form social links ride with the profiles in the content API', Array.isArray(soc.more) && soc.more.length === 2 && soc.more[0].label === 'LinkedIn');
    await put('social', {}); await put('nav', { items: [] }); await put('pages', pages);

    // ── blocks, inquiry, analytics (waves B/C/D) live ──
    const lay = await put('layout', { blocks: [{ id: 'offers', type: 'offers' }, { id: 'f1', type: 'faq', on: true, title: 'FAQ', items: [{ q: 'Clubs?', a: 'Provided' }] }, { id: 'q1', type: 'form', on: true, title: 'Ask us', fields: ['name', 'email', 'message'] }, { id: 'steps', type: 'steps' }] });
    ok('layout saves through the content API and rides in the inlined content', (await lay.json()).ok === true && (await (await fetch('http://localhost:3037/landing')).text()).includes('"type":"faq"'));
    const inq = await (await fetch('http://localhost:3037/api/website/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pat Party', email: 'pat@example.com', people: '12', message: 'Birthday for twelve', block: 'q1' }) })).json();
    const trap = await (await fetch('http://localhost:3037/api/website/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bot', email: 'b@x.io', message: 'spam', website: 'http://spam' }) })).json();
    const bad = await fetch('http://localhost:3037/api/website/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Nobody', message: 'no way to reply' }) });
    const inbox = await (await fetch('http://localhost:3037/api/website/inquiries', { headers: { cookie } })).json();
    ok('inquiry: a real one is stored (new, not emailed - no email configured), the trap-filled one is accepted and DROPPED, one with no contact is refused', inq.ok === true && trap.ok === true && bad.status === 400 && inbox.inquiries.length === 1 && inbox.inquiries[0].name === 'Pat Party' && inbox.inquiries[0].status === 'new' && inbox.newCount === 1, inbox.inquiries.map(r => r.name));
    ok('inquiry: anonymous cannot read the inbox', (await fetch('http://localhost:3037/api/website/inquiries')).status === 401);
    const mark = await (await fetch('http://localhost:3037/api/website/inquiries/' + inbox.inquiries[0].id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf': j1.csrf, cookie }, body: JSON.stringify({ status: 'handled' }) })).json();
    ok('inquiry: the owner marks it handled', mark.status === 'handled' && (await (await fetch('http://localhost:3037/api/website/inquiries', { headers: { cookie } })).json()).newCount === 0);
    let limited = 0; for (let i = 0; i < 12; i++) { const r = await fetch('http://localhost:3037/api/website/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'R' + i, phone: '555' }) }); if (r.status === 429) limited++; }
    ok('inquiry: the eleventh message in a minute from one address is refused (429)', limited >= 1, limited);
    const csp0 = (await fetch('http://localhost:3037/landing')).headers.get('content-security-policy') || '';
    ok('analytics OFF: no gtag on the page, no Google host in the CSP', !csp0.includes('googletagmanager') && !(await (await fetch('http://localhost:3037/landing')).text()).includes('gtag/js'));
    await put('settings', { siteEnabled: true, homepage: 'booking', analytics: { ga4: 'G-TEST1234', metaPixel: '123456789012345' }, pageTitles: { events: 'Fun Nights at Pages Test' } });
    await new Promise(r => setTimeout(r, 2200));
    const landOn = await fetch('http://localhost:3037/landing'); const landOnHtml = await landOn.text();
    ok('analytics ON: the gtag + pixel snippets are on the public page and ONLY their hosts join the CSP', landOnHtml.includes('gtag/js?id=G-TEST1234') && landOnHtml.includes("fbq('init','123456789012345')") && /googletagmanager/.test(landOn.headers.get('content-security-policy')) && /connect\.facebook\.net/.test(landOn.headers.get('content-security-policy')));
    ok('analytics ON: never on the admin pages; the Privacy page says visits are counted; the owner\'s events title wins', !(await (await fetch('http://localhost:3037/admin-website')).text()).includes('gtag/js') && (await (await fetch('http://localhost:3037/privacy')).text()).includes('counts visits with Google Analytics and the Meta pixel') && (await (await fetch('http://localhost:3037/events')).text()).includes('<title>Fun Nights at Pages Test</title>'));
    await put('settings', { siteEnabled: true, homepage: 'booking' });
    await new Promise(r => setTimeout(r, 2200));
    ok('analytics OFF again: the snippet and the hosts are gone', !(await (await fetch('http://localhost:3037/landing')).text()).includes('gtag/js') && !((await fetch('http://localhost:3037/landing')).headers.get('content-security-policy') || '').includes('googletagmanager'));
    const pv = await fetch('http://localhost:3037/landing?preview=1'); const plain = await fetch('http://localhost:3037/landing');
    ok('live preview: /landing?preview=1 may be framed by its own origin only (SAMEORIGIN + frame-ancestors self); every other page stays DENY / none', pv.headers.get('x-frame-options') === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(pv.headers.get('content-security-policy')) && plain.headers.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(plain.headers.get('content-security-policy')) && (await fetch('http://localhost:3037/events?preview=1')).headers.get('x-frame-options') === 'DENY' && /frame-src 'self'/.test((await fetch('http://localhost:3037/admin-website')).headers.get('content-security-policy')));
    const annHtml = await (await fetch('http://localhost:3037/events')).text();
    ok('the announcement rides in the inlined content of every content page (Settings > Notice, one notice)', annHtml.includes('"announcement":{"enabled":false') || annHtml.includes('"announcement":{"enabled":true'));
    // photo pipeline: upload a real image, expect renditions + the index entry
    let pillow = true; try { require('child_process').execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); } catch { pillow = false; }
    if (pillow) {
      const tmp = path.join(require('os').tmpdir(), 'ba-site-photo-' + Date.now() + '.jpg');
      require('child_process').execFileSync('python3', ['-c', `from PIL import Image; Image.new('RGB',(1900,1200),(40,80,50)).save(${JSON.stringify(tmp)}, quality=88)`]);
      const fd = new FormData(); fd.append('photo', new Blob([fs.readFileSync(tmp)], { type: 'image/jpeg' }), 'bench-bay.jpg');
      const up = await fetch('http://localhost:3037/api/website/upload', { method: 'POST', headers: { 'x-csrf': j1.csrf, cookie }, body: fd });
      const upj = await up.json();
      ok('upload makes phone renditions (480/960/1600 JPEG + WebP) and reports them', up.status === 200 && upj.optimized === true && upj.sizes.join(',') === '480,960,1600' && upj.width === 1900, upj);
      const stored = path.join(root, 'public', upj.path || '');
      const base = stored.replace(/\.[A-Za-z0-9]+$/, '');
      ok('rendition files exist beside the original and the 480 WebP is a fraction of it', fs.existsSync(base + '.w480.webp') && fs.existsSync(base + '.w960.jpg') && fs.existsSync(base + '.w1600.jpg') && fs.statSync(base + '.w480.webp').size < fs.statSync(stored).size / 5);
      const idx = await (await fetch('http://localhost:3037/api/website/content')).json();
      ok('the public index lists the photo with width, height and sizes so pages can build srcset', idx.images && idx.images[upj.path] && idx.images[upj.path].w === 1900 && idx.images[upj.path].sizes.length === 3, idx.images && idx.images[upj.path]);
      // heal: an original dropped in by hand (no renditions) is picked up by optimize
      const hand = path.join(root, 'public', 'uploads', 'landing', 'hand-copied.jpg'); fs.copyFileSync(tmp, hand);
      const pend = await (await fetch('http://localhost:3037/api/website/optimize-photos', { headers: { cookie } })).json();
      ok('a photo without renditions shows as pending', pend.pending >= 1, pend);
      const opt = await (await fetch('http://localhost:3037/api/website/optimize-photos', { method: 'POST', headers: { 'x-csrf': j1.csrf, cookie, 'Content-Type': 'application/json' }, body: '{}' })).json();
      await new Promise(r => setTimeout(r, 2500));
      ok('optimize sizes it in the background and the index picks it up', opt.queued >= 1 && fs.existsSync(hand.replace(/\.jpg$/, '.w480.webp')), opt);
      for (const f of fs.readdirSync(path.join(root, 'public', 'uploads', 'landing'))) if (/^(\d+-bench-bay|hand-copied)/.test(f)) fs.unlinkSync(path.join(root, 'public', 'uploads', 'landing', f));
      try { fs.unlinkSync(tmp); } catch {}
    } else { console.log('  (no Pillow on this machine - the rendition pipeline is proven on the bench)'); }
    // ── W45 (Sep 10 2026): email updates, PDF pages ──
    console.log('── W45: email updates, PDF pages ──');
    // the unit's sender "configured": restart this battery's server with EMAIL_DRYRUN=1 and keep its output - the
    // confirmation (and the unsubscribe link in it) is read from what the sender would have sent, byte for byte
    try { child.kill('SIGINT'); } catch {}
    for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:3037/api/time'); await new Promise(r => setTimeout(r, 250)); } catch { break; } }
    let srvOut = '';
    const child2 = spawn('node', ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { EMAIL_DRYRUN: '1', BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
    child2.stdout.on('data', d => srvOut += d); child2.stderr.on('data', d => srvOut += d);
    let up2 = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 400)); try { const r = await fetch('http://localhost:3037/api/time'); if (r.ok) { up2 = true; break; } } catch {} }
    ok('W45: the server is back with the dry-run sender (EMAIL_DRYRUN) for the email proofs', up2);
    const r2 = await fetch(B + '/api/auth/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw123' }) });
    const j2 = await r2.json(); const cookie2 = (r2.headers.get('set-cookie') || '').split(';')[0];
    const put2 = (key, value) => fetch(B + '/api/website/content', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf': j2.csrf, cookie: cookie2 }, body: JSON.stringify({ key, value }) });
    const post = (b) => fetch(B + '/api/website/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    ok('W45: with Email Updates off, /updates and the signup route are 404; an unsubscribe link still answers (404 for a bad token, never the holding page)', (await st('/updates')) === 404 && (await post({ email: 'a@b.co' })).status === 404 && (await st('/updates/unsubscribe?t=abc')) === 404 && !(await (await fetch(B + '/updates/unsubscribe?t=abc')).text()).includes('id="holdingHeadline"'));
    await put2('settings', { siteEnabled: true, homepage: 'landing', signup: { enabled: true, title: 'Hear first', text: 'A few emails a year.', button: 'Count me in', onHolding: true }, public: { booking: false } });
    const upH = await (await fetch(B + '/updates')).text();
    ok('W45: Email Updates ON - /updates is a chrome page with the one signup script; the holding page carries the signup slot and script', upH.includes('id="siteHead"') && upH.includes('/signup.js') && upH.includes('id="signupForm"') && (await (await fetch(B + '/book')).text()).includes('id="holdingSignup"'));
    const s1 = await (await post({ email: 'Pat@Example.com', name: 'Pat', source: 'page', consent: 'I would like email updates.' })).json();
    ok('W45: a signup lands on the unit (normalised email, name, source, the consent line) and a confirmation goes through the configured sender with an unsubscribe link', s1.ok === true && s1.confirmationSent === true && s1.alreadyOn === false, s1);
    const s2 = await (await post({ email: 'pat@example.com' })).json();
    ok('W45: the same email again is idempotent (already on the list, no second confirmation)', s2.ok === true && s2.alreadyOn === true && s2.confirmationSent === false, s2);
    ok('W45: a bad address is refused (400); the trap field is accepted and dropped', (await post({ email: 'nope' })).status === 400 && (await (await post({ email: 'bot@x.io', website: 'filled' })).json()).ok === true);
    const lst = await (await fetch(B + '/api/website/subscribers?q=pat', { headers: { cookie: cookie2 } })).json();
    ok('W45: the owner\'s list answers with search, paging and the counts; the bot never got in', lst.total === 1 && lst.active === 1 && lst.rows[0].email === 'pat@example.com' && lst.rows[0].name === 'Pat' && lst.rows[0].source === 'page' && lst.rows[0].confirmed_email === 1 && lst.page === 1 && lst.pages === 1 && (await (await fetch(B + '/api/website/subscribers?q=bot', { headers: { cookie: cookie2 } })).json()).total === 0, lst);
    const csvT = await (await fetch(B + '/api/website/subscribers.csv', { headers: { cookie: cookie2 } })).text();
    ok('W45: the CSV export carries a header row and the signup with its consent time', csvT.split('\n')[0] === 'email,name,source,consented_at,confirmation_email_sent,unsubscribed_at' && /^pat@example\.com,Pat,page,\d{4}-\d{2}-\d{2} /.test(csvT.split('\n')[1]), csvT.slice(0, 160));
    ok('W45: anonymous cannot read the list or the CSV or delete', (await st('/api/website/subscribers')) === 401 && (await st('/api/website/subscribers.csv')) === 401 && (await fetch(B + '/api/website/subscribers/' + lst.rows[0].id, { method: 'DELETE' })).status === 401);
    // the token rides in the email only (EMAIL_DRYRUN logs subject + recipients); the owner's list must not hand it out
    const tokRow = await (await fetch(B + '/api/website/subscribers?q=pat', { headers: { cookie: cookie2 } })).json();
    ok('W45: the list never hands out the unsubscribe token (it lives in the email only)', !JSON.stringify(tokRow).includes('unsub_token'));
    const un = await fetch(B + '/updates/unsubscribe?t=' + 'f'.repeat(32)); ok('W45: a wrong unsubscribe token is refused with a plain page', un.status === 404 && /not valid/.test(await un.text()));
    const realTok = (srvOut.match(/\/updates\/unsubscribe\?t=([a-f0-9]{32})/) || [])[1] || '';
    ok('W45: the confirmation the sender would have sent carries the one-click unsubscribe link (32-hex token) and the facility name', /^[a-f0-9]{32}$/.test(realTok) && /You are on the list - Pages Test/.test(srvOut), srvOut.split('\n').filter(l => /DRYRUN EMAIL/.test(l)).slice(-2));
    const un2 = await fetch(B + '/updates/unsubscribe?t=' + realTok);
    ok('W45: the unsubscribe link works without signing in and the list shows it', un2.status === 200 && /You are unsubscribed/.test(await un2.text()) && (await (await fetch(B + '/api/website/subscribers', { headers: { cookie: cookie2 } })).json()).active === 0);
    const s3 = await (await post({ email: 'pat@example.com' })).json();
    ok('W45: signing up again after unsubscribing puts them back with a fresh confirmation', s3.ok === true && s3.alreadyOn === false && s3.confirmationSent === true && (await (await fetch(B + '/api/website/subscribers', { headers: { cookie: cookie2 } })).json()).active === 1);
    let limitedSu = 0; for (let i = 0; i < 14; i++) { if ((await post({ email: `u${i}@example.com` })).status === 429) limitedSu++; }
    ok('W45: the signup route has its own limiter (429 after ten a minute)', limitedSu >= 1, limitedSu);
    const relog = await fetch(B + '/api/auth/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testpw123' }) });
    ok('W45: a signup flood NEVER counts as a login guess - the owner still signs in (no credential was presented, W39)', relog.status === 200 && !!(await relog.json()).csrf);
    const del = await fetch(B + '/api/website/subscribers/' + lst.rows[0].id, { method: 'DELETE', headers: { 'x-csrf': j2.csrf, cookie: cookie2 } });
    ok('W45: the owner deletes a signup; deleting it again is 404', del.status === 200 && (await fetch(B + '/api/website/subscribers/' + lst.rows[0].id, { method: 'DELETE', headers: { 'x-csrf': j2.csrf, cookie: cookie2 } })).status === 404);
    const cS = await (await fetch(B + '/api/website/content')).json();
    ok('W45: the content API carries the signup words for the block, the holding page and /updates, and the updates surface reads public', cS.nav.signup && cS.nav.signup.enabled === true && cS.nav.signup.title === 'Hear first' && cS.nav.signup.button === 'Count me in' && cS.nav.public.updates === true);
    const landS = await (await fetch(B + '/landing')).text();
    ok('W45: the landing loads the one signup script (the block draws from it)', landS.includes('/signup.js'));
    // PDF pages
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 40 Td (Hello PDF) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000178 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n270\n%%EOF\n');
    const upPdf = async (bytes, name) => { const fd = new FormData(); fd.append('pdf', new Blob([bytes], { type: 'application/pdf' }), name); const r = await fetch(B + '/api/website/upload-pdf', { method: 'POST', headers: { 'x-csrf': j2.csrf, cookie: cookie2 }, body: fd }); return { status: r.status, d: await r.json().catch(() => null) }; };
    const good = await upPdf(pdfBytes, 'menu.pdf');
    ok('W45: a PDF uploads to /uploads/docs (a unit file) and the answer carries its path and size', good.status === 200 && good.d.ok && /^\/uploads\/docs\/\d+-menu\.pdf$/.test(good.d.path) && good.d.size === pdfBytes.length, good.d);
    const fake = await upPdf(Buffer.from('not a pdf'), 'menu.pdf');
    ok('W45: bytes that are not a PDF are refused whatever the file was called, and nothing is left on disk', fake.status === 400 && /not a PDF/.test(fake.d.error) && fs.readdirSync(path.join(root, 'public', 'uploads', 'docs')).filter(f => f.endsWith('.pdf')).length === 1, fake.d);
    ok('W45: anonymous cannot upload a PDF', (await fetch(B + '/api/website/upload-pdf', { method: 'POST' })).status === 401);
    await put2('pages', [{ slug: 'menu', title: 'Our Menu', body: 'Prices include tax.', published: true, showInNav: true, showInFooter: true, kind: 'pdf', pdf: good.d.path, metaTitle: 'Menu at Pages Test' }]);
    const pgR = await fetch(B + '/p/menu'); const pgH = await pgR.text();
    ok('W45: a PDF page renders the viewer (the vendored pdf.js module), the Open and Download buttons, the text below, its own search title, and the CSP allows the worker', pgR.status === 200 && pgH.includes('id="pdfPage"') && pgH.includes(`data-src="${good.d.path}"`) && pgH.includes('src="/pdf-page.js"') && pgH.includes('Open the PDF') && pgH.includes('download>Download') && pgH.includes('Prices include tax') && pgH.includes('<title>Menu at Pages Test</title>') && /worker-src 'self' blob:/.test(pgR.headers.get('content-security-policy') || ''));
    ok('W45: the viewer files are vendored and served from the unit (pdf.min.mjs, the worker, the licence, the standard fonts) - no CDN', (await st('/vendor/pdfjs/pdf.min.mjs')) === 200 && (await st('/vendor/pdfjs/pdf.worker.min.mjs')) === 200 && (await st('/vendor/pdfjs/LICENSE')) === 200 && fs.readdirSync(path.join(root, 'public', 'vendor', 'pdfjs', 'standard_fonts')).length > 5 && !fs.readFileSync(path.join(root, 'public', 'pdf-page.js'), 'utf8').includes('cdn'));
    ok('W45: the document itself serves as application/pdf', (await fetch(B + good.d.path)).headers.get('content-type').includes('application/pdf'));
    await put2('pages', [{ slug: 'menu', title: 'Our Menu', body: '', published: true, kind: 'pdf', pdf: '/etc/passwd' }]);
    ok('W45: a pdf path outside /uploads/docs never becomes a viewer', !(await (await fetch(B + '/p/menu')).text()).includes('id="pdfPage"'));
    // RULE 30, THE LIVE CASE THAT FOUND IT (a pilot facility, Sep 16 2026). Example Owner's
    // /p/pressrelease drew a blank yellow button beside Download. His stored page
    // carries exactly six keys - slug, title, body, published, showInNav,
    // showInFooter - and no openLabel, kind or pdf at all, because it was written
    // before the PDF-page feature existed. So the label was not cleared by an
    // owner and nothing failed to save: we shipped a renderer with no default for
    // a field older pages simply do not have. THIS is the shape that must never
    // render a nameless control again.
    await put2('pages', [{ slug: 'legacydoc', title: 'Press Release', body: 'Words.', published: true, showInNav: true, showInFooter: true, kind: 'pdf', pdf: good.d.path }]);
    { const h = await (await fetch(B + '/p/legacydoc')).text();
      const labels = [...h.matchAll(/<a class="siteBtn[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map(m => m[1].trim());
      ok('W45/rule 30: a page written before openLabel existed still names both buttons - no control renders with an empty name',
         labels.length === 2 && labels.every(x => x.length > 0) && labels[0] === 'Open the PDF' && labels[1] === 'Download', labels); }
    await put2('pages', [{ slug: 'legacydoc', title: 'Press Release', body: 'Words.', published: true, kind: 'pdf', pdf: good.d.path, openLabel: '   ', downloadLabel: '' }]);
    { const h = await (await fetch(B + '/p/legacydoc')).text();
      const labels = [...h.matchAll(/<a class="siteBtn[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map(m => m[1].trim());
      ok('W45/rule 30: an owner who CLEARS a label gets the product\'s word back, never a blank button',
         labels.length === 2 && labels.every(x => x.length > 0), labels); }
    await put2('pages', pages); await put2('settings', { siteEnabled: true, homepage: 'landing' });
    // the second server must be GONE - a survivor on 3037 answers for the next run and fails it with 401s that look like product bugs
    try { child2.kill('SIGINT'); } catch {}
    await new Promise(r => setTimeout(r, 1500)); try { child2.kill('SIGKILL'); } catch {}
    try { for (const f of fs.readdirSync(path.join(root, 'public', 'uploads', 'docs'))) if (f.endsWith('.pdf')) fs.unlinkSync(path.join(root, 'public', 'uploads', 'docs', f)); } catch {}
  }
  child.kill('SIGKILL');
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root, 'bookings.db')); } catch {}
  try { fs.unlinkSync(path.join(root, 'BOOTSTRAP-PASSWORD.txt')); } catch {}
  try { fs.unlinkSync(path.join(root, 'license.json')); } catch {}

  console.log('\nWEBSITE PAGES: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
