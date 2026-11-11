// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-hero-announcement.js — #5 hero mobile video + iOS autoplay + the
// saveHero-deletes-mobile-video bug; #13 announcement banner admin editor.
// (pilot facility spec, maintainer Aug 15.)
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

(async () => {
  const root = __dirname;

  // ── #5 hero video ──────────────────────────────────────────────────────────
  console.log('\u2500\u2500 #5 hero video: mobile rendition + iOS autoplay \u2500\u2500');
  {
    const land = fs.readFileSync(path.join(root, 'public/landing.html'), 'utf8');
    ok('#5: phones get the mobile rendition (videoMobile), falling back to desktop video',
       land.includes('(innerWidth <= 860) ? (h.videoMobile || h.video'));
    ok('#5: autoplay uses ATTRIBUTE forms (iOS ignores JS-property muted)',
       land.includes("setAttribute('muted', '')") && land.includes("setAttribute('playsinline', '')"));
    ok('#5: play() is called with a catch so a blocked autoplay is harmless',
       /v\.play\(\);\s*if \(pl && pl\.catch\)/.test(land) || land.includes('pl.catch(() => {})'));
    ok('#5: videoMobile is in the hero DEFAULTS', land.includes("videoMobile:''"));
  }

  // ── #5b saveHero must not delete videoMobile ───────────────────────────────
  console.log('\u2500\u2500 #5b saveHero preserves the mobile video \u2500\u2500');
  {
    const aw = fs.readFileSync(path.join(root, 'public/admin-website.html'), 'utf8');
    ok('#5b: saveHero builds OVER the existing hero (Object.assign), not from scratch',
       aw.includes('Object.assign({}, C.hero||{}'));
    ok('#5b: a Mobile Video Path field exists and is saved', aw.includes('heroVideoMobile'));
    ok('#5b: the mobile field is loaded from hero.videoMobile', aw.includes('mv.value=hero.videoMobile'));
  }

  // ── #13 announcement editor ────────────────────────────────────────────────
  console.log('\u2500\u2500 #13 announcement banner admin editor \u2500\u2500');
  {
    const adm = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
    ok('#13: a Booking Page Notice card exists with enable + message',
       adm.includes('cfg_announcement_enabled') && adm.includes('cfg_announcement_message'));
    ok('#13: it saves through the existing config POST (no new endpoint)',
       adm.includes('cfg.announcement = Object.assign'));
    ok('#13: it loads the current announcement into the fields',
       adm.includes('ae.checked = !!(cfg.announcement'));
    // the config default + server endpoint the booking page reads
    const cfgsrc = fs.readFileSync(path.join(root, 'services/config.js'), 'utf8');
    ok('#13: announcement default exists in config', /announcement:\s*\{/.test(cfgsrc));
    const srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    ok('#13: GET /api/announcement serves it to the booking page', srv.includes("app.get('/api/announcement'"));
    const idx = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
    ok('#13: the booking page renders the banner when enabled', idx.includes("fetch('/api/announcement')") && idx.includes('ann.enabled && ann.message'));
  }

  console.log('\nHERO & ANNOUNCEMENT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
