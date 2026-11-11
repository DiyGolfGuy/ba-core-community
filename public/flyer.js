// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// flyer.js - A SPECIAL'S FLYER, DRAWN IN THE OWNER'S OWN BRAND (Oct 20 2026, late)
//
// maintainer: "allow them to build out a cool AI but not AI slop special of the day card to have in the slide show of hero ... so
// have it build some sort of flyer they can either send out in an email if people signed up for it." The call: no generated
// art. Four designed layouts, each filled with the facility's own fonts, colours, name, logo and photo, drawn on a canvas in
// the owner's browser (where the site's web fonts are), then saved like any photo the owner uploads. The same card goes in
// the slides under the top of the homepage and at the top of the email to the people who signed up.
//   poster  the photo above, the words on the site's header colour (the usual choice)
//   bold    the button colour edge to edge, the price or the name huge - for a deal
//   photo   the photo edge to edge, the words over its darkened foot
//   clean   light and quiet: the page colour, a thin accent rule, the photo framed
// 1080 x 1350 (4:5): whole on a phone in the slides, in an email column, and on a social feed. UMD like site-layout.js, so a
// battery can read its layouts and helpers; draw() needs a canvas, which only the browser has.
//
// THE SIZES TO DOWNLOAD (Oct 22 2026, night; maintainer: "export it and put in on FB? like we do for turf league tracker"): Meta's own
// ad guides give 4:5 for the Facebook and Instagram feeds (1080 x 1350 is that shape) and 9:16 for Stories; Instagram takes a
// square too. variant() puts the drawn card whole on a canvas of the size asked - never cropped, so no word is ever cut off -
// on its own edge colour: the post as drawn, a square (the card centred), and a Story (the card in the middle band, clear of
// the top the apps cover). Every size carries the website's address, in the card's own foot.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAFlyer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var W = 1080, H = 1350;
  var LAYOUTS = {
    poster: 'The photo above, the words on your header colour',
    bold: 'Your button colour edge to edge, the deal huge',
    photo: 'The photo edge to edge, the words over it',
    clean: 'Light and quiet, the photo framed'
  };

  /** Words broken into lines no wider than maxW at the font now set. */
  function wrap(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (!cur || ctx.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  /** The largest size from maxSize down to minSize at which the words fit in maxLines lines; at minSize the last line is cut
   *  with an ellipsis rather than ever running off the card. */
  function fit(ctx, text, fontAt, maxW, maxLines, maxSize, minSize) {
    for (var s = maxSize; s >= minSize; s -= 4) {
      ctx.font = fontAt(s);
      var lines = wrap(ctx, text, maxW);
      if (lines.length <= maxLines && lines.every(function (l) { return ctx.measureText(l).width <= maxW; })) return { size: s, lines: lines };
    }
    ctx.font = fontAt(minSize);
    var all = wrap(ctx, text, maxW), out = all.slice(0, maxLines);
    // too long even at the smallest size: whole words come off the last line until it and the ellipsis fit (a single word too
    // wide for the card loses letters)
    if (all.length > maxLines) {
      var last = out[maxLines - 1];
      while (/\s/.test(last) && ctx.measureText(last + '...').width > maxW) last = last.replace(/\s+\S+$/, '');
      while (last.length > 1 && ctx.measureText(last + '...').width > maxW) last = last.slice(0, -1);
      out[maxLines - 1] = last.replace(/[\s,;:-]+$/, '') + '...';
    }
    return { size: minSize, lines: out };
  }
  function lines(ctx, l, x, y, lh) { l.forEach(function (t, i) { ctx.fillText(t, x, y + i * lh); }); return y + l.length * lh; }
  // an image drawn to cover a box, centred - the way object-fit: cover does it
  function cover(ctx, img, x, y, w, h) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height; if (!iw || !ih) return;
    var s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }
  function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function pill(ctx, text, x, y, fontAt, bg, fg) {
    ctx.font = fontAt(46); var tw = ctx.measureText(text).width, ph = 84, pw = tw + 64;
    ctx.fillStyle = bg; rounded(ctx, x, y, pw, ph, 42); ctx.fill();
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 32, y + ph / 2 + 2); ctx.textBaseline = 'alphabetic';
    return y + ph;
  }
  function spaced(ctx, text, x, y, px) { var cx = x; String(text).split('').forEach(function (ch) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + px; }); return cx; }
  // the foot every layout shares: a hairline, the logo (when there is one), the business's name and, under it, where to book - the
  // website's address on every size, not only the Story's (the research, Oct 23 2026: a flyer always says where to go)
  function foot(ctx, s, img, color, line, y) {
    ctx.fillStyle = line; ctx.fillRect(80, y, W - 160, 2);
    var x = 80;
    if (img.logo) { var lh = 76, lw = Math.min(260, (img.logo.naturalWidth || img.logo.width) * lh / (img.logo.naturalHeight || img.logo.height || 1)); ctx.drawImage(img.logo, x, y + 32, lw, lh); x += lw + 24; }
    ctx.fillStyle = color; ctx.font = '600 34px ' + s.fonts.body;
    spaced(ctx, String(s.business || '').toUpperCase().slice(0, 40), x, y + (s.site ? 72 : 82), 3);
    if (s.site) { ctx.font = '500 30px ' + s.fonts.body; ctx.fillText('Book at ' + String(s.site).slice(0, 40), x, y + 120); }
  }

  /**
   * Draw a flyer. spec: { layout, kicker, title, line, price, business, colors: { dark, onDark, accent, btn, onBtn, light, ink,
   * text }, fonts: { heading, body } (CSS font-family lists) }; img: { photo, logo } (loaded images, or null).
   */
  function draw(ctx, s, img) {
    img = img || {}; var c = s.colors || {}, L = LAYOUTS[s.layout] ? s.layout : 'poster';
    if (L === 'photo' && !img.photo) L = 'poster';
    var head = function (n) { return '700 ' + n + 'px ' + s.fonts.heading; }, body = function (n) { return '400 ' + n + 'px ' + s.fonts.body; }, bodyB = function (n) { return '700 ' + n + 'px ' + s.fonts.body; };
    var maxW = W - 160, y;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    if (L === 'poster') {
      ctx.fillStyle = c.dark; ctx.fillRect(0, 0, W, H);
      if (img.photo) {
        cover(ctx, img.photo, 0, 0, W, 700);
        var g = ctx.createLinearGradient(0, 420, 0, 700); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, c.dark); ctx.fillStyle = g; ctx.fillRect(0, 420, W, 280);
        y = 770;
      } else { ctx.fillStyle = c.accent; ctx.fillRect(80, 120, 140, 10); y = 250; }
      ctx.fillStyle = c.accent; ctx.font = '700 34px ' + s.fonts.body; spaced(ctx, String(s.kicker || '').toUpperCase(), 80, y, 6);
      var t = fit(ctx, s.title, head, maxW, img.photo ? 2 : 3, img.photo ? 112 : 140, 60); ctx.fillStyle = c.onDark; ctx.font = head(t.size);
      y = lines(ctx, t.lines, 80, y + 24 + t.size, t.size * 1.04);
      if (s.line) { var l = fit(ctx, s.line, body, maxW, 3, 44, 32); ctx.font = body(l.size); ctx.globalAlpha = 0.86; y = lines(ctx, l.lines, 80, y + 24 + l.size * 0.4, l.size * 1.3); ctx.globalAlpha = 1; }
      if (s.price) pill(ctx, s.price, 80, Math.min(y + 30, H - 330), bodyB, c.btn, c.onBtn);
      foot(ctx, s, img, c.onDark, 'rgba(255,255,255,.22)', H - 190);
    } else if (L === 'bold') {
      ctx.fillStyle = c.btn; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = c.onBtn; ctx.font = '700 34px ' + s.fonts.body; spaced(ctx, String(s.kicker || '').toUpperCase(), 80, 170, 6);
      var big = s.price ? String(s.price).toUpperCase() : s.title, b = fit(ctx, big, head, maxW, 2, 300, 120);
      ctx.font = head(b.size); y = lines(ctx, b.lines, 80, 200 + b.size, b.size * 0.98);
      if (s.price) { var t2 = fit(ctx, s.title, head, maxW, 2, 96, 56); ctx.font = head(t2.size); y = lines(ctx, t2.lines, 80, y + 30 + t2.size * 0.2, t2.size * 1.05); }
      if (s.line) { var l2 = fit(ctx, s.line, body, maxW, 3, 44, 32); ctx.font = body(l2.size); ctx.globalAlpha = 0.9; lines(ctx, l2.lines, 80, y + 30 + l2.size * 0.4, l2.size * 1.3); ctx.globalAlpha = 1; }
      ctx.fillStyle = c.dark; ctx.fillRect(0, H - 220, W, 220);
      foot(ctx, s, img, c.onDark, 'rgba(255,255,255,0)', H - 200);
    } else if (L === 'photo') {
      cover(ctx, img.photo, 0, 0, W, H);
      var g2 = ctx.createLinearGradient(0, H * 0.35, 0, H); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.55, 'rgba(0,0,0,.62)'); g2.addColorStop(1, 'rgba(0,0,0,.88)'); ctx.fillStyle = g2; ctx.fillRect(0, H * 0.35, W, H * 0.65);
      var t3 = fit(ctx, s.title, head, maxW, 2, 120, 60), l3 = s.line ? fit(ctx, s.line, body, maxW, 2, 42, 32) : { size: 0, lines: [] };
      y = H - 240 - (s.price ? 110 : 0) - l3.lines.length * l3.size * 1.3 - t3.lines.length * t3.size * 1.04;
      ctx.fillStyle = c.accent; ctx.font = '700 34px ' + s.fonts.body; spaced(ctx, String(s.kicker || '').toUpperCase(), 80, y, 6);
      ctx.fillStyle = '#ffffff'; ctx.font = head(t3.size); y = lines(ctx, t3.lines, 80, y + 20 + t3.size, t3.size * 1.04);
      if (l3.lines.length) { ctx.font = body(l3.size); ctx.globalAlpha = 0.9; y = lines(ctx, l3.lines, 80, y + 16 + l3.size * 0.4, l3.size * 1.3); ctx.globalAlpha = 1; }
      if (s.price) pill(ctx, s.price, 80, y + 24, bodyB, c.btn, c.onBtn);
      foot(ctx, s, img, '#ffffff', 'rgba(255,255,255,.3)', H - 190);
    } else {
      ctx.fillStyle = c.light; ctx.fillRect(0, 0, W, H);
      y = 110;
      if (img.photo) { ctx.save(); rounded(ctx, 80, y, maxW, 520, 18); ctx.clip(); cover(ctx, img.photo, 80, y, maxW, 520); ctx.restore(); y += 520 + 90; }
      else { ctx.fillStyle = c.accent; ctx.fillRect(80, y + 40, 140, 8); y += 170; }
      ctx.fillStyle = c.accent; ctx.font = '700 32px ' + s.fonts.body; spaced(ctx, String(s.kicker || '').toUpperCase(), 80, y, 6);
      var t4 = fit(ctx, s.title, head, maxW, img.photo ? 2 : 3, img.photo ? 100 : 130, 56); ctx.fillStyle = c.ink; ctx.font = head(t4.size);
      y = lines(ctx, t4.lines, 80, y + 22 + t4.size, t4.size * 1.05);
      if (s.line) { var l4 = fit(ctx, s.line, body, maxW, 3, 42, 30); ctx.fillStyle = c.text; ctx.font = body(l4.size); y = lines(ctx, l4.lines, 80, y + 22 + l4.size * 0.4, l4.size * 1.32); }
      if (s.price) { ctx.fillStyle = c.accent; ctx.font = head(84); ctx.fillText(String(s.price), 80, Math.min(y + 110, H - 250)); }
      foot(ctx, s, img, c.text, 'rgba(0,0,0,.14)', H - 190);
    }
    return L;
  }
  var SIZES = {
    post: { w: 1080, h: 1350, label: 'Facebook & Instagram post (4:5)' },
    square: { w: 1080, h: 1080, label: 'Square post (1:1)' },
    story: { w: 1080, h: 1920, label: 'Story (9:16)' }
  };
  /** The drawn card (an image or a canvas, 1080 x 1350) on a canvas of one of SIZES. o: { bg, color, font, site } - the edge
   *  colour (left out: the card's own top-left corner), and for a Story the address under the card. Returns the size's name. */
  function variant(ctx, card, size, o) {
    o = o || {}; var z = SIZES[size] ? size : 'post', S = SIZES[z];
    var cw = card.naturalWidth || card.width || W, ch = card.naturalHeight || card.height || H;
    var bg = o.bg;
    if (!bg) { try { var c2 = document.createElement('canvas'); c2.width = c2.height = 1; var x2 = c2.getContext('2d'); x2.drawImage(card, 0, 0, 1, 1, 0, 0, 1, 1); var d = x2.getImageData(0, 0, 1, 1).data; bg = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')'; } catch (e) { bg = '#111111'; } }
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S.w, S.h);
    if (z === 'post') { ctx.drawImage(card, 0, 0, cw, ch, 0, 0, S.w, S.h); return z; }
    if (z === 'square') { var sw = Math.round(S.h * cw / ch); ctx.drawImage(card, 0, 0, cw, ch, Math.round((S.w - sw) / 2), 0, sw, S.h); return z; }
    // a Story: the card at 92% of the width, its top 14% down - clear of the name and the progress bar at the top (Meta's safe zone
    // keeps the top 14% clear); the card's own foot says where to book
    var w = Math.round(S.w * 0.92), h = Math.round(w * ch / cw), x = Math.round((S.w - w) / 2), y = Math.round(S.h * 0.14);
    ctx.drawImage(card, 0, 0, cw, ch, x, y, w, h);
    return z;
  }
  /** Download the card at a size (the browser's own save): card an image or a canvas; name without its ending. */
  function download(card, size, o, name) {
    var S = SIZES[size] || SIZES.post, cv = document.createElement('canvas'); cv.width = S.w; cv.height = S.h;
    variant(cv.getContext('2d'), card, size, o);
    return new Promise(function (res) {
      cv.toBlob(function (blob) {
        if (!blob) return res(false);
        var a = document.createElement('a'), u = URL.createObjectURL(blob);
        a.href = u; a.download = String(name || 'flyer').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 50) + '-' + size + '.jpg';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); res(true);
      }, 'image/jpeg', 0.92);
    });
  }
  return { W: W, H: H, LAYOUTS: LAYOUTS, SIZES: SIZES, draw: draw, variant: variant, download: download, wrap: wrap, fit: fit };
});
