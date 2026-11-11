// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// site-style.js - THE SITE'S STYLE, AS SETTINGS (Oct 20 2026)
//
// maintainer: "maybe even let the ai change some of the code in small allowed places for color or layout or somethings. idk you
// decide". The decision, which keeps rule 40 (what runs on a unit is exactly what the signed pack covered): the "small
// allowed places" are SETTINGS the signed pages read, never code. Each place is a short list of named choices, each choice
// a few CSS custom properties, and the FIRST choice of each is the site as it has always looked and sets nothing - so a
// unit that never touches Style renders exactly as before, and every page keeps its own built-in value as the fallback.
// Stored in website_content.theme.design (rule 14: a new key, nothing renamed). One module (UMD like site-layout.js) for
// the server (services/theme.js puts the properties in every public page's <style id="ba-theme">), the landing page's
// live preview, the Website editor's Style card and the assistant's website_style_set.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BASiteStyle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // [choice, words for the owner, properties]; the first is the default and sets nothing
  var STYLE = {
    buttons:     { label: 'Buttons', choices: [['standard', 'Slightly rounded (as built)', {}], ['square', 'Square', { '--btn-radius': '0px' }], ['rounded', 'Rounded', { '--btn-radius': '12px' }], ['pill', 'Pill', { '--btn-radius': '999px' }]] },
    buttonText:  { label: 'Button words', choices: [['standard', 'As written (as built)', {}], ['capitals', 'CAPITALS', { '--btn-transform': 'uppercase', '--btn-letters': '1.5px' }]] },
    corners:     { label: 'Cards and photos', choices: [['standard', 'Softly rounded (as built)', {}], ['square', 'Square corners', { '--radius': '0px', '--img-radius': '0px' }], ['round', 'Round corners', { '--radius': '18px', '--img-radius': '16px' }]] },
    cards:       { label: 'Card shadows', choices: [['flat', 'Flat (as built)', {}], ['lifted', 'Lifted, with a soft shadow', { '--card-shadow': '0 12px 30px rgba(0,0,0,.16)' }]] },
    spacing:     { label: 'Space between sections', choices: [['standard', 'Standard (as built)', {}], ['compact', 'Compact', { '--section-pad': '56px' }], ['airy', 'Airy', { '--section-pad': '120px' }]] },
    width:       { label: 'Page width', choices: [['standard', 'Standard (as built)', {}], ['narrow', 'Narrow', { '--wrap': '960px' }], ['wide', 'Wide', { '--wrap': '1320px' }]] },
    textSize:    { label: 'Text size', choices: [['standard', 'Standard (as built)', {}], ['larger', 'Larger - easier to read', { '--text-scale': '1.12' }], ['largest', 'Largest', { '--text-scale': '1.25' }]] },
    // (Oct 20 2026, maintainer: "Consistency and the readability, and that looks nice and fancy") the words themselves
    textWeight:  { label: 'Text weight', choices: [['standard', 'As built', {}], ['light', 'Light', { '--text-weight': '300' }], ['regular', 'Regular - easier to read', { '--text-weight': '400' }], ['medium', 'Medium', { '--text-weight': '500' }]] },
    textLines:   { label: 'Space between lines', choices: [['standard', 'As built', {}], ['closer', 'Closer', { '--text-lines': '1.4' }], ['relaxed', 'Relaxed - easier to read', { '--text-lines': '1.85' }]] },
    headingSize: { label: 'Heading size', choices: [['standard', 'Standard (as built)', {}], ['smaller', 'Smaller', { '--heading-scale': '.86' }], ['bigger', 'Bigger', { '--heading-scale': '1.14' }]] },
    headingCase: { label: 'Headings', choices: [['standard', 'As written (as built)', {}], ['capitals', 'ALL CAPITALS', { '--heading-transform': 'uppercase', '--heading-spacing': '1px' }]] },
    headingWeight: { label: 'Heading weight', choices: [['standard', 'Bold (as built)', {}], ['regular', 'Regular', { '--heading-weight': '400' }], ['semibold', 'Semi-bold', { '--heading-weight': '600' }], ['heavy', 'Extra bold', { '--heading-weight': '800' }]] },
    headingStyle: { label: 'Heading style', choices: [['standard', 'Upright (as built)', {}], ['italic', 'Italic', { '--heading-style': 'italic' }]] },
    // after headingCase, so a letter spacing the owner picks wins over the 1px the capitals bring
    headingLetters: { label: 'Heading letter spacing', choices: [['standard', 'As built', {}], ['tight', 'Tight', { '--heading-spacing': '-1px' }], ['wide', 'Wide', { '--heading-spacing': '2px' }], ['wider', 'Wider', { '--heading-spacing': '4px' }]] },
    heroAlign:   { label: 'Top of the page: words', choices: [['centred', 'Centred (as built)', {}], ['left', 'On the left', { '--hero-items': 'flex-start', '--hero-text': 'left', '--hero-pad-x': '8vw' }]] },
    heroHeight:  { label: 'Top of the page: height', choices: [['tall', 'Tall (as built)', {}], ['short', 'Shorter', { '--hero-height': '64vh' }], ['full', 'The whole screen', { '--hero-height': '100vh' }]] },
    heroShade:   { label: 'Top of the page: shade over the photo', choices: [['standard', 'Standard (as built)', {}], ['lighter', 'Lighter', { '--hero-shade': 'linear-gradient(180deg,rgba(8,14,9,.38) 0%,rgba(8,14,9,.14) 45%,rgba(8,14,9,.55) 100%)' }], ['darker', 'Darker', { '--hero-shade': 'linear-gradient(180deg,rgba(8,14,9,.72) 0%,rgba(8,14,9,.5) 45%,rgba(8,14,9,.86) 100%)' }]] },
    topBar:      { label: 'Top bar', choices: [['over-photo', 'Over the photo (as built)', {}], ['solid', 'A solid bar', { '--topbar-bg': 'var(--headerBg)' }]] },
    // (Oct 20 2026, late; maintainer: "tabs no tabs ... all the fun website building stuff") the menu's shape: links in the top bar
    // (as built), tabs under the top bar on every screen (the page you are on marked), or a menu button only; and on phones
    // an app-style bar at the bottom - Home, two of the menu's links and Book, always in reach
    menuStyle:   { label: 'The menu', choices: [['links', 'Links in the top bar (as built)', {}], ['tabs', 'Tabs under the top bar, on every screen', { '--nav-links': 'none', '--nav-tabs': 'flex', '--nav-btn-phone': 'none' }], ['button', 'A menu button only', { '--nav-links': 'none', '--nav-btn-wide': 'inline-flex', '--nav-drawer-wide': 'block' }]] },
    phoneBar:    { label: 'Phones: a bar at the bottom', choices: [['off', 'No (as built)', {}], ['on', 'Yes - Home, the menu and Book, always in reach', { '--phonebar': 'flex', '--phonebar-pad': '64px' }]] },
    bookBar:     { label: 'Book Now bar while scrolling', choices: [['on', 'Shown (as built)', {}], ['off', 'Not shown', { '--sticky-display': 'none' }]] },
    motion:      { label: 'Sections fade in while scrolling', choices: [['on', 'Yes (as built)', {}], ['off', 'No - everything shows at once', { '--reveal-o': '1', '--reveal-t': 'none' }]] }
  };
  // a whole look in one word: every place set, so switching from one look to another leaves nothing of the first behind
  var LOOKS = {
    classic:  { label: 'Classic - the site as built', set: {} },
    modern:   { label: 'Modern - pill buttons, round corners, room to breathe', set: { buttons: 'pill', corners: 'round', cards: 'lifted', spacing: 'airy', heroAlign: 'left' } },
    bold:     { label: 'Bold - square edges, big capital headings, a solid top bar', set: { buttons: 'square', corners: 'square', headingSize: 'bigger', headingCase: 'capitals', topBar: 'solid', heroShade: 'darker' } },
    minimal:  { label: 'Minimal - quiet, narrow and still', set: { buttons: 'rounded', spacing: 'airy', width: 'narrow', headingSize: 'smaller', heroShade: 'lighter', motion: 'off' } },
    friendly: { label: 'Friendly - soft and rounded', set: { buttons: 'pill', corners: 'round', cards: 'lifted', heroHeight: 'short' } }
  };
  function choiceOf(key, v) { var c = STYLE[key].choices; for (var i = 0; i < c.length; i++) if (c[i][0] === v) return c[i]; return c[0]; }
  /** Every place with its choice in force (a missing or unknown one is the default). */
  function resolve(saved) {
    var s = (saved && typeof saved === 'object') ? saved : {}, out = {};
    Object.keys(STYLE).forEach(function (k) { out[k] = choiceOf(k, s[k])[0]; });
    return out;
  }
  /** The CSS custom properties for a saved style: only what differs from the site as built. */
  function vars(saved) {
    var r = resolve(saved), out = {};
    Object.keys(STYLE).forEach(function (k) { var p = choiceOf(k, r[k])[2]; for (var v in p) out[v] = p[v]; });
    return out;
  }
  function css(saved) { var v = vars(saved), s = ''; for (var k in v) s += k + ':' + v[k] + ';'; return s; }
  /** What to store: only known places with known choices, and only those that are not the default. */
  function clean(saved) {
    var r = resolve(saved), out = {};
    Object.keys(STYLE).forEach(function (k) { if (r[k] !== STYLE[k].choices[0][0]) out[k] = r[k]; });
    return out;
  }
  /** A look applied: every place reset to the site as built, then the look's own choices. */
  function withLook(look) { var l = LOOKS[look]; if (!l) return null; var out = {}; for (var k in l.set) out[k] = l.set[k]; return clean(out); }
  function choices(key) { return STYLE[key] ? STYLE[key].choices.map(function (c) { return c[0]; }) : []; }
  function words(key, v) { return STYLE[key] ? choiceOf(key, v)[1] : ''; }
  return { STYLE: STYLE, LOOKS: LOOKS, resolve: resolve, vars: vars, css: css, clean: clean, withLook: withLook, choices: choices, words: words };
});
