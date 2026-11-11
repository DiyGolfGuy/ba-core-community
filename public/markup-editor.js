// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
//
// public/markup-editor.js - the toolbar + live-preview editor for admin text
// blocks. Wraps a plain <textarea>: nothing about the stored text changes
// (it is still the portable, copyable markup syntax), the owner just never
// has to memorize it.
//
//   Toolbar   Bullet / Numbered / Divider / Heading / Small heading / Bold /
//             Italic / Quote write the syntax for them (B-wave 1, Sep 11 2026,
//             added the numbered list, the small heading, italics and quotes).
//   Enter     inside a bullet continues the list; Enter on an empty bullet
//             ends it.
//   Preview   a live panel rendered by BAMarkup.markupToHtml - the SAME
//             function the live site uses - painted in the site's real theme
//             colours (fetched once from /api/theme).
//   ?         opens the cheat card: every mark, what it becomes, an example.
//
// Requires /markup.js (global BAMarkup) loaded first. No other dependency.
//
// Usage:  BAEditor.attach('heroSub')            one textarea (id or element)
//         BAEditor.attachAll(rootElement)       every textarea[data-ba-editor]
//         BAEditor.refresh('heroSub')           re-render after code sets .value
//         BAEditor.refreshAll()
//
// Programmatic edits dispatch a real 'input' event on the textarea, so the
// page's existing oninput handlers (markDirty, secInput, ...) keep working.
(function (root) {
  'use strict';

  const CSS = [
    '.ba-ed{margin:0 0 4px}',
    '.ba-ed-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}',
    '.ba-ed-bar button{background:var(--panel2,#1e1e1e);border:1px solid var(--border,#2a2a2a);color:var(--text,#e8e8e8);padding:6px 11px;min-height:32px;font-family:inherit;font-size:12px;line-height:1;cursor:pointer;border-radius:3px}',
    '.ba-ed-bar button:hover{border-color:var(--gold,#c9a227)}',
    '.ba-ed-bar button:focus-visible{outline:2px solid var(--gold,#c9a227);outline-offset:1px}',
    '.ba-ed-bar button[aria-pressed="true"]{border-color:var(--gold,#c9a227);color:var(--gold,#c9a227)}',
    '.ba-ed-bar .ba-ed-sp{flex:1}',
    '.ba-ed-bar .ba-ed-help-btn{min-width:32px;font-weight:700}',
    '.ba-ed-body{display:grid;grid-template-columns:1fr;gap:10px;align-items:stretch}',
    '@media(min-width:900px){.ba-ed.ba-split .ba-ed-body{grid-template-columns:1fr 1fr}}',
    '.ba-ed textarea{width:100%;box-sizing:border-box;min-height:110px;background:var(--panel2,#1e1e1e);border:1px solid var(--border,#2a2a2a);color:var(--text,#e8e8e8);padding:10px 12px;font-family:inherit;font-size:13.5px;line-height:1.55;resize:vertical;outline:none;border-radius:3px}',
    '.ba-ed textarea:focus{border-color:var(--gold,#c9a227)}',
    '.ba-ed-pv{display:flex;flex-direction:column;min-height:110px;border:1px solid var(--border,#2a2a2a);border-radius:3px;overflow:hidden}',
    '.ba-ed-pv-cap{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted,#888);padding:5px 10px;border-bottom:1px solid var(--border,#2a2a2a);background:var(--panel2,#1e1e1e)}',
    '.ba-ed-pv-body{flex:1;padding:12px 14px;font-family:"Outfit",sans-serif;font-size:14px;line-height:1.6;background:var(--card,#fffef8);color:var(--text,#3a4436);overflow:auto;word-break:break-word}',
    '.ba-ed-pv-body h4{color:var(--heading,#1c3a26);font-size:15px}',
    '.ba-ed-pv-body strong{font-weight:700}',
    '.ba-ed-pv-body .ba-ed-empty{color:var(--muted,#71806f);font-style:italic}',
    '.ba-ed-help{display:none;margin:0 0 10px;padding:12px 14px;border:1px solid var(--gold,#c9a227);border-radius:4px;background:var(--panel2,#1e1e1e);font-size:12.5px;line-height:1.5}',
    '.ba-ed-help.on{display:block}',
    '.ba-ed-help table{border-collapse:collapse;width:100%;margin:6px 0 10px}',
    '.ba-ed-help th,.ba-ed-help td{text-align:left;vertical-align:top;padding:5px 8px 5px 0;border-bottom:1px solid var(--border,#2a2a2a)}',
    '.ba-ed-help th{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted,#888);font-weight:600}',
    '.ba-ed-help code{font-family:"DM Mono",monospace;font-size:12px;color:var(--gold,#c9a227);white-space:pre}',
    '.ba-ed-help .ba-ed-ex{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media(max-width:640px){.ba-ed-help .ba-ed-ex{grid-template-columns:1fr}}',
    '.ba-ed-help .ba-ed-ex pre{margin:0;padding:10px;border:1px solid var(--border,#2a2a2a);border-radius:3px;font-family:"DM Mono",monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;color:var(--text,#e8e8e8)}',
    '.ba-ed-help .ba-ed-ex .ba-ed-pv{min-height:0}',
    '.ba-ed-help .ba-ed-close{margin-top:4px}'
  ].join('\n');

  const EXAMPLE = '## What you get\n\n- 10 hours every month\n- **Guests welcome** at the member rate\n- Book up to 14 days ahead\n\n### How to start\n\n1. Pick a bay\n2. Pick a time\n\n> "Best night out in town" - _a member since 2024_\n\n---\n\nQuestions? [Send us a note](/p/contact)';

  // Site theme for the preview, fetched once and shared by every editor on
  // the page. Falls back to the default brand if the request fails.
  const theme = { vars: null, pending: null };
  const DEFAULT_THEME = { bgColor: '#f5f3ea', surfaceColor: '#fffef8', accentColor: '#b08a1d', textColor: '#3a4436', mutedColor: '#71806f', headingColor: '#1c3a26', lineColor: '#e2ddcb' };
  function themeVars(t) {
    return {
      '--bg': t.bgColor, '--card': t.surfaceColor, '--accent': t.accentColor, '--text': t.textColor,
      '--muted': t.mutedColor, '--heading': t.headingColor, '--line': t.lineColor
    };
  }
  function loadTheme() {
    if (theme.vars) return Promise.resolve(theme.vars);
    if (theme.pending) return theme.pending;
    theme.pending = (typeof fetch === 'function' ? fetch('/api/theme').then(r => r.ok ? r.json() : DEFAULT_THEME) : Promise.resolve(DEFAULT_THEME))
      .catch(() => DEFAULT_THEME)
      .then(t => { theme.vars = themeVars(Object.assign({}, DEFAULT_THEME, t || {})); return theme.vars; });
    return theme.pending;
  }
  function paint(el, vars) { for (const k in vars) if (vars[k]) el.style.setProperty(k, vars[k]); }

  function ensureCss() {
    if (document.getElementById('ba-editor-css')) return;
    const s = document.createElement('style');
    s.id = 'ba-editor-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── textarea surgery ───────────────────────────────────────────────────────
  // execCommand('insertText') keeps the browser's native undo stack intact
  // (Ctrl+Z undoes a toolbar click). Falls back to setRangeText where the
  // command is unsupported. Always finishes by firing 'input'.
  function replaceRange(ta, start, end, text, selStart, selEnd) {
    const expected = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start, end);
    let done = false;
    try {
      if (typeof document !== 'undefined' && typeof document.execCommand === 'function' && document.queryCommandSupported && document.queryCommandSupported('insertText')) {
        done = document.execCommand('insertText', false, text) && ta.value === expected;
      }
    } catch (e) { done = false; }
    if (!done) {
      if (typeof ta.setRangeText === 'function') ta.setRangeText(text, start, end, 'end');
      else ta.value = expected;
    }
    const a = selStart == null ? start + text.length : selStart;
    const b = selEnd == null ? a : selEnd;
    ta.setSelectionRange(a, b);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function lineBounds(v, start, end) {
    const ls = v.lastIndexOf('\n', start - 1) + 1;
    let le = v.indexOf('\n', end);
    if (le === -1) le = v.length;
    // a selection ending exactly at the start of a line should not drag that
    // line in (the classic shift+down over-select)
    if (end > start && end > ls && v[end - 1] === '\n') le = end - 1;
    return [ls, le];
  }

  function toggleLinePrefix(ta, prefix, testRe) {
    const v = ta.value;
    const [ls, le] = lineBounds(v, ta.selectionStart, ta.selectionEnd);
    const lines = v.slice(ls, le).split('\n');
    const content = lines.filter(l => l.trim());
    const allOn = content.length > 0 && content.every(l => testRe.test(l));
    const out = lines.map(l => {
      if (allOn) return l.replace(testRe, '$1');
      if (!l.trim() && lines.length > 1) return l;          // leave blank separators alone
      if (testRe.test(l)) return l;                          // already marked: never double it
      return l.replace(/^(\s*)/, '$1' + prefix);
    }).join('\n');
    replaceRange(ta, ls, le, out, ls, ls + out.length);
  }

  // B-wave 1 (Sep 11 2026): a numbered list - every line in the selection gets its
  // number; if every line is numbered already the numbers come off
  function toggleNumbered(ta) {
    const v = ta.value;
    const [ls, le] = lineBounds(v, ta.selectionStart, ta.selectionEnd);
    const lines = v.slice(ls, le).split('\n');
    const content = lines.filter(l => l.trim());
    const re = /^(\s*)\d+[.)]\s+/;
    const allOn = content.length > 0 && content.every(l => re.test(l));
    let n = 0;
    const out = lines.map(l => {
      if (allOn) return l.replace(re, '$1');
      if (!l.trim() && lines.length > 1) return l;
      n++;
      if (re.test(l)) return l.replace(re, '$1' + n + '. ');
      return l.replace(/^(\s*)/, '$1' + n + '. ');
    }).join('\n');
    replaceRange(ta, ls, le, out, ls, ls + out.length);
  }
  function wrapWords(ta, mark, placeholder) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) { const t = mark + placeholder + mark; replaceRange(ta, s, e, t, s + mark.length, s + mark.length + placeholder.length); return; }
    const sel = v.slice(s, e);
    const esc = mark.replace(/[*]/g, '\\*');
    const wrapped = sel.match(new RegExp('^' + esc + '([\\s\\S]+)' + esc + '$'));
    if (wrapped) { replaceRange(ta, s, e, wrapped[1], s, s + wrapped[1].length); return; }
    if (v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark) { replaceRange(ta, s - mark.length, e + mark.length, sel, s - mark.length, s - mark.length + sel.length); return; }
    const out = sel.split('\n').map(l => { const m = l.match(/^(\s*)(.*?)(\s*)$/); return m[2] ? m[1] + mark + m[2] + mark + m[3] : l; }).join('\n');
    replaceRange(ta, s, e, out, s, s + out.length);
  }

  const actions = {
    bullet(ta) { toggleLinePrefix(ta, '- ', /^(\s*)-\s+/); },
    numbered(ta) { toggleNumbered(ta); },
    heading(ta) { toggleLinePrefix(ta, '## ', /^(\s*)##\s+/); },
    subheading(ta) { toggleLinePrefix(ta, '### ', /^(\s*)###\s+/); },
    quote(ta) { toggleLinePrefix(ta, '> ', /^(\s*)>\s+/); },
    italic(ta) { wrapWords(ta, '_', 'italic text'); },
    bold(ta) {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      if (s === e) {
        const t = '**bold text**';
        replaceRange(ta, s, e, t, s + 2, s + 2 + 'bold text'.length);
        return;
      }
      const sel = v.slice(s, e);
      const wrapped = sel.match(/^\*\*([\s\S]+)\*\*$/);
      if (wrapped) { replaceRange(ta, s, e, wrapped[1], s, s + wrapped[1].length); return; }
      if (v.slice(s - 2, s) === '**' && v.slice(e, e + 2) === '**') { replaceRange(ta, s - 2, e + 2, sel, s - 2, s - 2 + sel.length); return; }
      // bold never crosses a line break (the renderer will not match it), so
      // a multi-line selection bolds each line's text separately
      const out = sel.split('\n').map(l => {
        const m = l.match(/^(\s*)(.*?)(\s*)$/);
        return m[2] ? m[1] + '**' + m[2] + '**' + m[3] : l;
      }).join('\n');
      replaceRange(ta, s, e, out, s, s + out.length);
    },
    divider(ta) {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const before = v.slice(0, s), after = v.slice(e);
      const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      const t = pre + '---' + post;
      replaceRange(ta, s, e, t, s + t.length, s + t.length);
    }
  };

  function onKeydown(e) {
    const ta = e.target;
    if (e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); actions.bold(ta); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); actions.italic(ta); return; }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const v = ta.value, pos = ta.selectionStart;
    const ls = v.lastIndexOf('\n', pos - 1) + 1;
    // a bullet, a numbered item (B-wave 1: the next number) or a quote line continues on Enter
    const line = v.slice(ls, pos);
    let m = line.match(/^(\s*)-\s(.*)$/), next = '- ';
    if (!m) { const n = line.match(/^(\s*)(\d+)([.)])\s(.*)$/); if (n) { m = [n[0], n[1], n[4]]; next = (Number(n[2]) + 1) + n[3] + ' '; } }
    if (!m) { const q = line.match(/^(\s*)>\s(.*)$/); if (q) { m = q; next = '> '; } }
    if (!m) return;
    let le = v.indexOf('\n', pos); if (le === -1) le = v.length;
    e.preventDefault();
    if (!m[2].trim() && !v.slice(pos, le).trim()) {
      replaceRange(ta, ls, le, '', ls, ls);              // empty item: end the list / quote
    } else {
      // split mid-line: the text after the cursor becomes the new item,
      // minus any space that sat between the cursor and it
      const ins = '\n' + m[1] + next;
      const rest = v.slice(pos, le).replace(/^[ \t]+/, '');
      replaceRange(ta, pos, le, ins + rest, pos + ins.length, pos + ins.length);
    }
  }

  // ── build ──────────────────────────────────────────────────────────────────
  // The renderer: the page's global BAMarkup (browser), or the module itself
  // when a battery drives this file under node.
  function markup() {
    if (root.BAMarkup) return root.BAMarkup;
    if (typeof require === 'function') { try { return require('./markup.js'); } catch (e) { return null; } }
    return null;
  }

  function render(ta) {
    const pv = ta._baEd && ta._baEd.pvBody;
    if (!pv) return;
    const v = ta.value;
    pv.innerHTML = v.trim() ? markup().markupToHtml(v) : '<div class="ba-ed-empty">Preview appears here as you type.</div>';
  }

  function btn(label, opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (opts && opts.title) b.title = opts.title;
    if (opts && opts.aria) b.setAttribute('aria-label', opts.aria);
    if (opts && opts.cls) b.className = opts.cls;
    return b;
  }

  function buildHelp(ed) {
    const h = document.createElement('div');
    h.className = 'ba-ed-help';
    h.setAttribute('role', 'region');
    h.setAttribute('aria-label', 'Formatting help');
    const rows = [
      ['<code>- Item</code> (one per line)', 'A bulleted list. Press Enter inside a bullet and the next one is started for you; Enter on an empty bullet ends the list.'],
      ['<code>---</code> on its own line', 'A divider rule in your accent colour. A row of five or more underscores does the same.'],
      ['<code>## Words</code> on its own line', 'A sub-heading.'],
      ['<code>1. Item</code> (one per line)', 'A numbered list - 1) works too. Enter continues the numbering; Enter on an empty item ends it.'],
      ['<code>### Words</code> on its own line', 'A smaller heading under a sub-heading.'],
      ['<code>**words**</code>', '<strong>Bold</strong> words.'],
      ['<code>_words_</code>', '<em>Italic</em> words (Ctrl+I). A word_with_underscores is left alone.'],
      ['<code>&gt; Words</code> on its own line', 'A quote, marked with a line in your accent colour. Several lines make one quote.'],
      ['<code>[Book now](/book)</code>', 'A link. Use a full https:// address or a page on your site like /memberships.'],
      ['A blank line', 'A new paragraph. A single line break stays a line break.']
    ];
    h.innerHTML = '<div style="font-weight:600;margin-bottom:2px">Formatting - the buttons write these for you</div>' +
      '<table><tr><th>Type this</th><th>You get</th></tr>' +
      rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</table>' +
      '<div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted,#888);margin-bottom:6px">Example</div>' +
      '<div class="ba-ed-ex"><pre></pre><div class="ba-ed-pv"><div class="ba-ed-pv-cap">Shows on your site as</div><div class="ba-ed-pv-body"></div></div></div>' +
      '<div style="margin-top:8px;color:var(--muted,#888)">Anything that looks like HTML is shown as plain text, never run - your pages stay safe.</div>';
    h.querySelector('pre').textContent = EXAMPLE;
    h.querySelector('.ba-ed-pv-body').innerHTML = markup().markupToHtml(EXAMPLE);
    const close = btn('Close help', { cls: 'ba-ed-close' });
    close.addEventListener('click', () => ed.setHelp(false));
    h.appendChild(close);
    loadTheme().then(vars => paint(h.querySelector('.ba-ed-pv'), vars));
    return h;
  }

  function attach(target, opts) {
    const ta = typeof target === 'string' ? document.getElementById(target) : target;
    if (!ta || ta.tagName !== 'TEXTAREA' || ta._baEd) return ta || null;
    if (!markup()) { console.error('BAEditor: /markup.js must load before /markup-editor.js'); return ta; }
    opts = opts || {};
    ensureCss();

    const wrap = document.createElement('div'); wrap.className = 'ba-ed';
    const bar = document.createElement('div'); bar.className = 'ba-ed-bar';
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Text formatting');
    const body = document.createElement('div'); body.className = 'ba-ed-body';
    const pv = document.createElement('div'); pv.className = 'ba-ed-pv';
    pv.innerHTML = '<div class="ba-ed-pv-cap">Preview - what visitors see</div><div class="ba-ed-pv-body"></div>';

    const bBullet = btn('Bullet', { title: 'Make the selected lines a bulleted list' });
    const bNumbered = btn('Numbered', { title: 'Make the selected lines a numbered list' });
    const bDivider = btn('Divider', { title: 'Insert a divider line' });
    const bHeading = btn('Heading', { title: 'Make this line a sub-heading' });
    const bSub = btn('Small heading', { title: 'Make this line a smaller heading' });
    const bBold = btn('Bold', { title: 'Bold the selected words (Ctrl+B)' });
    const bItalic = btn('Italic', { title: 'Italicise the selected words (Ctrl+I)' });
    const bQuote = btn('Quote', { title: 'Make the selected lines a quote' });
    const bHelp = btn('?', { title: 'Formatting help', aria: 'Formatting help', cls: 'ba-ed-help-btn' });
    const bPreview = btn('Preview', { title: 'Show or hide the live preview' });
    const sp = document.createElement('span'); sp.className = 'ba-ed-sp';
    [bBullet, bNumbered, bDivider, bHeading, bSub, bBold, bItalic, bQuote, bHelp, sp, bPreview].forEach(el => bar.appendChild(el));

    ta.parentNode.insertBefore(wrap, ta);
    wrap.appendChild(bar);
    wrap.appendChild(body);
    body.appendChild(ta);
    body.appendChild(pv);

    const ed = { wrap, bar, body, pv, pvBody: pv.querySelector('.ba-ed-pv-body'), help: null, previewOn: true };
    ta._baEd = ed;
    ta.dataset.baEditorReady = '1';

    ed.setPreview = on => {
      ed.previewOn = !!on;
      pv.style.display = on ? '' : 'none';
      wrap.classList.toggle('ba-split', !!on);
      bPreview.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) render(ta);
    };
    ed.setHelp = on => {
      if (!ed.help) { ed.help = buildHelp(ed); wrap.insertBefore(ed.help, body); }
      ed.help.classList.toggle('on', !!on);
      bHelp.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (!on) bHelp.focus();
    };

    bBullet.addEventListener('click', () => actions.bullet(ta));
    bNumbered.addEventListener('click', () => actions.numbered(ta));
    bSub.addEventListener('click', () => actions.subheading(ta));
    bItalic.addEventListener('click', () => actions.italic(ta));
    bQuote.addEventListener('click', () => actions.quote(ta));
    bDivider.addEventListener('click', () => actions.divider(ta));
    bHeading.addEventListener('click', () => actions.heading(ta));
    bBold.addEventListener('click', () => actions.bold(ta));
    bHelp.addEventListener('click', () => ed.setHelp(!(ed.help && ed.help.classList.contains('on'))));
    bPreview.addEventListener('click', () => ed.setPreview(!ed.previewOn));
    bHelp.setAttribute('aria-expanded', 'false');

    ta.addEventListener('keydown', onKeydown);
    ['input', 'change', 'focus', 'blur', 'keyup'].forEach(ev => ta.addEventListener(ev, () => render(ta)));

    ed.setPreview(opts.preview !== false);
    loadTheme().then(vars => paint(pv, vars));
    return ta;
  }

  function attachAll(rootEl) {
    const r = rootEl || document;
    r.querySelectorAll('textarea[data-ba-editor]').forEach(ta => attach(ta));
  }
  function refresh(target) {
    const ta = typeof target === 'string' ? document.getElementById(target) : target;
    if (ta && ta._baEd) render(ta);
  }
  function refreshAll() { document.querySelectorAll('textarea[data-ba-editor-ready]').forEach(render); }

  const api = { attach, attachAll, refresh, refreshAll, actions, handleKeydown: onKeydown, EXAMPLE, _replaceRange: replaceRange, _lineBounds: lineBounds, _toggleNumbered: toggleNumbered };
  root.BAEditor = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : this));
