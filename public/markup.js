// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// public/markup.js - THE ONE text-formatting renderer.
//
// Loaded by the browser as <script src="/markup.js"> (global BAMarkup) AND
// required by the server (services/markup.js re-exports this file). The
// admin editor's live preview, the public memberships page, the member
// portal, and server-rendered custom pages all call this exact function,
// so what the owner sees in the preview is what visitors get, by construction.
//
// landing.html keeps its own inline copy of markup() on purpose: the landing
// page must render even if a script file fails to load, and it is the
// canonical reference. test-website-pages.js extracts that inline copy and
// asserts it behaves IDENTICALLY to this file on a sample that exercises
// every rule below. Change one, change both, or the battery fails.
//
// Rules (escape FIRST - raw HTML never renders), applied in this order:
//   **bold**                       -> <strong>
//   ---  (or 5+ underscores) alone -> divider rule
//   ## Heading alone on a line     -> <h4> sub-heading
//   [label](https://... or /path)  -> link (http/https/site-relative only)
//   lines starting "- "            -> bulleted list
//   lines starting "1. " or "1) "  -> numbered list        (B-wave 1, Sep 11 2026)
//   lines starting "> "            -> quote                (B-wave 1)
//   _words_                        -> <em> italics          (B-wave 1)
//   ### Small heading alone        -> <h5> second heading  (B-wave 1)
//   blank line                     -> paragraph break; single newline -> <br>
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAMarkup = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function markupToHtml(t) {
    let x = esc(t || '');
    x = x.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // B-wave 1 (Sep 11 2026): italics - _words_ between non-word characters; a
    // snake_case_name is left alone and a row of underscores is still a divider
    x = x.replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>');
    // dividers: --- on its own line, or a run of 5+ underscores (grandfathers
    // hand-typed separator rows into styled rules automatically)
    x = x.replace(/^[ \t]*(?:-{3,}|_{5,})[ \t]*$/gm, '<hr style="border:none;border-top:1px solid var(--accent);opacity:.55;margin:14px 0">');
    // sub-headings: ## Heading on its own line
    // second heading level: ### Small heading on its own line (B-wave 1)
    x = x.replace(/^###[ \t]+(.+)$/gm, '<h5 style="margin:12px 0 4px;letter-spacing:.3px;font-size:.95em">$1</h5>');
    x = x.replace(/^##[ \t]+(.+)$/gm, '<h4 style="margin:14px 0 6px;letter-spacing:.4px">$1</h4>');
    x = x.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, function (m, label, url) {
      return '<a href="' + url + '" style="color:var(--accent)">' + label + '</a>';
    });
    const blocks = x.split(/\n\s*\n/).map(function (b) {
      const lines = b.split('\n');
      if (lines.length && lines.every(function (l) { return /^\s*-\s+/.test(l) || !l.trim(); })) {
        const items = lines.filter(function (l) { return l.trim(); }).map(function (l) { return '<li>' + l.replace(/^\s*-\s+/, '') + '</li>'; }).join('');
        return '<ul style="margin:8px 0 8px 20px">' + items + '</ul>';
      }
      // numbered list: 1. or 1) at the start of every line (B-wave 1)
      if (lines.length && lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l) || !l.trim(); })) {
        const items = lines.filter(function (l) { return l.trim(); }).map(function (l) { return '<li>' + l.replace(/^\s*\d+[.)]\s+/, '') + '</li>'; }).join('');
        return '<ol style="margin:8px 0 8px 22px">' + items + '</ol>';
      }
      // quote: every line starts with > (escaped by then) (B-wave 1)
      if (lines.length && lines.every(function (l) { return /^\s*&gt;(\s|$)/.test(l) || !l.trim(); })) {
        const q = lines.filter(function (l) { return l.trim(); }).map(function (l) { return l.replace(/^\s*&gt;\s?/, ''); }).join('<br>');
        return '<blockquote style="margin:10px 0;padding:6px 14px;border-left:3px solid var(--accent);opacity:.92">' + q + '</blockquote>';
      }
      return '<p style="margin:8px 0">' + b.replace(/\n/g, '<br>') + '</p>';
    });
    return blocks.join('');
  }

  // Reference sample: exercises EVERY rule. Batteries render this through
  // each copy of the renderer and demand identical output.
  const REFERENCE_SAMPLE = 'Hello **there**\n\n- a\n- b\n\n[Book](/book) and <script>x</script>\n\n---\n\n## Members\n\n_______\nplain **bold** line\n  ---  \n## not a heading in a bullet? - no\n- **bold** item\n\n_soft_ words, a snake_case_name and (_an aside_)\n\n### Small heading\n\n> a quoted line\n> and another\n\n1. one\n2. two\n3) three\n\n_______\n\n> lonely quote';

  return { esc, markupToHtml, REFERENCE_SAMPLE };
}));
