// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-markup-editor.js - the toolbar + live-preview text editor (Aug 25, late).
//
// Two halves, no browser and no new dependency:
//   1. LOGIC - public/markup-editor.js is driven under node against a fake
//      textarea (value + selection + setRangeText), proving every toolbar
//      action and the Enter rules produce exactly the syntax the renderer
//      reads - and that each edit fires the page's 'input' event so
//      markDirty/secInput keep working.
//   2. WIRING - both admin pages load /markup.js then /markup-editor.js,
//      every markup-rendered text box carries data-ba-editor, the tier
//      description is a real textarea, attach/refresh calls sit where content
//      is loaded, and the help card teaches every rule the renderer has.
// Read-only: never writes config, DB, or any file.
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const ED = require('./public/markup-editor.js');
const MK = require('./public/markup.js');

function ta(v, s, e) {
  return {
    value: v, selectionStart: s, selectionEnd: e == null ? s : e, events: [],
    focus() {}, addEventListener() {},
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    setRangeText(t, a, b) { this.value = this.value.slice(0, a) + t + this.value.slice(b); },
    dispatchEvent(ev) { this.events.push(ev.type); }
  };
}
const enter = (t, extra) => { const ev = Object.assign({ key: 'Enter', target: t, pd: false, preventDefault() { this.pd = true; } }, extra || {}); ED.handleKeydown(ev); return ev; };

console.log('\u2500\u2500 1. editor logic \u2500\u2500');
{
  let t = ta('one\ntwo\nthree', 0, 13); ED.actions.bullet(t);
  ok('Bullet: every selected line gets "- " and the selection covers the result', t.value === '- one\n- two\n- three' && t.selectionStart === 0 && t.selectionEnd === 19, t.value);
  ok('every programmatic edit fires input (markDirty / secInput keep working)', t.events.length === 1 && t.events[0] === 'input');
  ED.actions.bullet(t);
  ok('Bullet again: toggles the markers off', t.value === 'one\ntwo\nthree', t.value);
  t = ta('', 0); ED.actions.bullet(t);
  ok('Bullet on an empty box starts a list', t.value === '- ' && t.selectionEnd === 2, t.value);
  t = ta('a\nb\n\nc', 0, 6); ED.actions.bullet(t);
  ok('Bullet skips blank separator lines (no empty bullets)', t.value === '- a\n- b\n\n- c', t.value);
  t = ta('already\n- yes', 0, 13); ED.actions.bullet(t);
  ok('Bullet on a mixed selection bullets the missing lines, never doubles a marker', t.value === '- already\n- yes', t.value);
  ok('Bullet output is what the renderer reads as a list', /<ul[^>]*><li>already<\/li><li>yes<\/li><\/ul>/.test(MK.markupToHtml(t.value)), MK.markupToHtml(t.value));

  t = ta('Members', 0, 7); ED.actions.heading(t);
  ok('Heading writes "## " on the line', t.value === '## Members', t.value);
  ok('Heading output renders as h4', MK.markupToHtml(t.value).includes('<h4') && MK.markupToHtml(t.value).includes('Members</h4>'));
  ED.actions.heading(t);
  ok('Heading again: toggles off', t.value === 'Members', t.value);

  t = ta('make this bold', 5, 9); ED.actions.bold(t);
  ok('Bold wraps the selection in ** **', t.value === 'make **this** bold' && t.selectionStart === 5 && t.selectionEnd === 13, t.value);
  ok('Bold output renders as <strong>', MK.markupToHtml(t.value).includes('<strong>this</strong>'));
  ED.actions.bold(t);
  ok('Bold again on the wrapped words: unwraps', t.value === 'make this bold', t.value);
  t = ta('**ab**', 2, 4); ED.actions.bold(t);
  ok('Bold with only the inner word selected: unwraps the surrounding markers', t.value === 'ab', t.value);
  t = ta('x', 1); ED.actions.bold(t);
  ok('Bold with nothing selected inserts placeholder text and selects it for overtyping', t.value === 'x**bold text**' && t.value.slice(t.selectionStart, t.selectionEnd) === 'bold text', t.value);
  t = ta('l1\nl2', 0, 5); ED.actions.bold(t);
  ok('Bold over two lines bolds each line separately (renderer never matches across a newline)', t.value === '**l1**\n**l2**' && (MK.markupToHtml(t.value).match(/<strong>/g) || []).length === 2, t.value);

  t = ta('above', 5); ED.actions.divider(t);
  ok('Divider at end of text: blank line, ---, new line to keep typing', t.value === 'above\n\n---\n' && t.selectionStart === t.value.length, t.value);
  t = ta('above\nbelow', 5); ED.actions.divider(t);
  ok('Divider mid-text: --- sits on its own line with blank lines both sides', t.value === 'above\n\n---\n\nbelow', t.value);
  t = ta('above\n\n', 7); ED.actions.divider(t);
  ok('Divider after an existing blank line does not stack extra blank lines', t.value === 'above\n\n---\n', t.value);
  t = ta('', 0); ED.actions.divider(t);
  ok('Divider in an empty box', t.value === '---\n', t.value);
  ok('Divider output renders as the accent rule', MK.markupToHtml('a\n\n---\n\nb').includes('<hr style="border:none;border-top:1px solid var(--accent)'));

  t = ta('- item', 6); let ev = enter(t);
  ok('Enter inside a bullet continues the list', ev.pd && t.value === '- item\n- ' && t.selectionStart === 9, t.value);
  t = ta('- a\n- ', 6); ev = enter(t);
  ok('Enter on an empty bullet ends the list (marker removed, cursor on the empty line)', ev.pd && t.value === '- a\n' && t.selectionStart === 4, t.value);
  t = ta('- one two', 5); ev = enter(t);
  ok('Enter mid-bullet splits it: the rest becomes the next bullet', ev.pd && t.value === '- one\n- two' && t.selectionStart === 8, t.value);
  t = ta('  - nested', 10); ev = enter(t);
  ok('Enter keeps the indent of a nested bullet', ev.pd && t.value === '  - nested\n  - ', t.value);
  t = ta('plain line', 10); ev = enter(t);
  ok('Enter on a plain line is left to the browser', !ev.pd && t.value === 'plain line');
  t = ta('- item', 6); ev = enter(t, { shiftKey: true });
  ok('Shift+Enter is never intercepted', !ev.pd && t.value === '- item');
  t = ta('- item', 0, 6); ev = enter(t);
  ok('Enter with a range selected is left to the browser', !ev.pd && t.value === '- item');
  t = ta('word', 0, 4); ev = enter(t, { key: 'b', ctrlKey: true });
  ok('Ctrl+B bolds the selection', ev.pd && t.value === '**word**', t.value);

  ok('help example renders every construct (heading, bullets, bold, divider, link)', (() => {
    const h = MK.markupToHtml(ED.EXAMPLE);
    return h.includes('<h4') && h.includes('<li>') && h.includes('<strong>') && h.includes('<hr ') && h.includes('<a href="/p/contact"');
  })());
}

console.log('\n\u2500\u2500 2. wiring \u2500\u2500');
{
  const editorSrc = fs.readFileSync('public/markup-editor.js', 'utf8');
  const sharedSrc = fs.readFileSync('public/markup.js', 'utf8');
  ok('markup.js is a browser global AND a CommonJS module (one file, two callers)', sharedSrc.includes('root.BAMarkup = factory()') && sharedSrc.includes('module.exports = factory()'));
  ok('editor depends only on the shared renderer (no library, no network beyond /api/theme)', !/https?:\/\/(?!\S*api\.)/.test(editorSrc.replace(/\/\/.*$/gm, '')) && editorSrc.includes("fetch('/api/theme')") && editorSrc.includes("require('./markup.js')"));
  ok('editor keeps native undo (insertText) with a setRangeText fallback', editorSrc.includes("execCommand('insertText'") && editorSrc.includes('ta.setRangeText('));
  ok('toolbar buttons are type=button with visible words (Bullet / Divider / Heading / Bold / Preview) + a named help button',
     editorSrc.includes("b.type = 'button'") && ["btn('Bullet'", "btn('Divider'", "btn('Heading'", "btn('Bold'", "btn('Preview'"].every(x => editorSrc.includes(x)) && editorSrc.includes("aria: 'Formatting help'"));
  ok('toolbar is announced as a toolbar; preview toggle exposes aria-pressed; help exposes aria-expanded',
     editorSrc.includes("setAttribute('role', 'toolbar')") && editorSrc.includes("'aria-pressed'") && editorSrc.includes("'aria-expanded'"));
  ok('preview is painted with the site theme from /api/theme (accent, heading, text, muted, surface, line)',
     ["'--accent': t.accentColor", "'--heading': t.headingColor", "'--text': t.textColor", "'--muted': t.mutedColor", "'--card': t.surfaceColor", "'--line': t.lineColor"].every(x => editorSrc.includes(x)));
  ok('help card names every rule the renderer has (bullet, ---, underscores, ##, **, link, blank line) and says HTML is never run',
     ['<code>- Item</code>', '<code>---</code>', 'five or more underscores', '<code>## Words</code>', '<code>**words**</code>', '<code>[Book now](/book)</code>', 'A blank line', 'never run'].every(x => editorSrc.includes(x)));

  const site = fs.readFileSync('public/admin-website.html', 'utf8');
  const order = site.indexOf('<script src="/markup.js"></script>');
  ok('website builder loads /markup.js then /markup-editor.js before its own script', order > -1 && order < site.indexOf('<script src="/markup-editor.js"></script>') && site.indexOf('<script src="/markup-editor.js"></script>') < site.indexOf('<script>\nlet CSRF'));
  for (const id of ['heroSub', 'staffedSelf', 'pgBody', 'memIntroIn']) {
    const tag = (site.match(new RegExp('<textarea id="' + id + '"[^>]*>')) || [])[0] || '';
    ok('website builder: #' + id + ' (rendered by markup() on the site) carries data-ba-editor', tag.includes('data-ba-editor'), tag);
  }
  // Sep 5 2026: the Sections card became the Page Layout block editor - the story block's two paragraphs, the text block body, the rates note and the form intro all carry the editor
  ok('website builder: story Paragraph 1 and 2, text body, rates note and form intro carry data-ba-editor (bf(..., editor:true) emits it)', site.includes("${opts.editor?'data-ba-editor':''}") && site.includes("bf('p1','Paragraph 1',b.p1,{area:true,editor:true})") && site.includes("bf('p2','Paragraph 2 (optional)',b.p2,{area:true,editor:true})") && site.includes("bf('body','Text',b.body,{area:true,editor:true,rows:6})") && site.includes("bf('intro','Line under the title (optional)',b.intro,{area:true,editor:true,rows:3})"));
  ok('website builder: the block editor re-render attaches editors (attachAll(host) after the innerHTML)', /host\.innerHTML=f\+'<\/div>';\n  BAEditor\.attachAll\(host\);\n}/.test(site));
  ok('website builder: after content loads, attachAll + refreshAll run (then the live preview starts)', site.includes('BAEditor.attachAll(); BAEditor.refreshAll();\n  // live preview (wave C)\n  pvStart();'));
  ok('website builder: page form new/edit refresh the body preview', (site.match(/BAEditor\.refresh\('pgBody'\)/g) || []).length === 2);
  ok('website builder: the Pages card hint points at the buttons instead of asking owners to memorize syntax', site.includes('Bullet &middot; Divider &middot; Heading &middot; Bold</b> buttons'));
  ok('website builder: event Description carries data-ba-editor and its preview is cleared after save', /<textarea id="evDesc"[^>]*data-ba-editor/.test(site) && site.includes("document.getElementById('evDesc').value='';BAEditor.refresh('evDesc');"));
  ok('website builder: single-line inputs (offers, steps, promo, staffed intro line) stay inputs - toolbar is for long text only',
     site.includes('<input type="text" data-o="text"') && site.includes('<input type="text" data-st="text"') && site.includes('<input type="text" id="promoText"') && site.includes('<input type="text" id="staffedP"'));

  const admin = fs.readFileSync('public/admin.html', 'utf8');
  const aOrder = admin.indexOf('<script src="/markup.js"></script>');
  ok('admin loads /markup.js then /markup-editor.js before its own script', aOrder > -1 && aOrder < admin.indexOf('<script src="/markup-editor.js"></script>') && admin.indexOf('<script src="/markup-editor.js"></script>') < admin.indexOf('<script>\n', aOrder + 60));
  ok('admin: tier Description is a TEXTAREA with data-ba-editor (was a one-line input)', /<textarea id="tierDesc"[^>]*data-ba-editor/.test(admin) && !/<input id="tierDesc"/.test(admin));
  ok('admin: tier Description still has its label and the form still reads it on save', admin.includes('<label for="tierDesc">') && admin.includes("description: document.getElementById('tierDesc').value.trim()"));
  ok('admin: opening the tier form attaches + refreshes the description editor', admin.includes("document.getElementById('tierDesc').value = tier?.description || '';\n  BAEditor.attach('tierDesc'); BAEditor.refresh('tierDesc');"));
  ok('admin: memberships-page intro carries data-ba-editor and is attached + refreshed when loaded', /<textarea id="memIntroText"[^>]*data-ba-editor/.test(admin) && admin.includes("BAEditor.attach('memIntroText'); BAEditor.refresh('memIntroText');"));
  ok('admin: How It Works step bodies carry data-ba-editor and rows are attached after every render/add',
     admin.includes('placeholder="Step description" data-ba-editor') && (admin.match(/BAEditor\.attachAll\(document\.getElementById\('hiwSteps'\)\)/g) || []).length === 2);
  ok('admin: SMS and email templates stay plain text (no editor - phones do not render bullets)', !/id="(sms_|em_)[A-Za-z]+"[^>]*data-ba-editor/.test(admin));
  ok('admin: static tier form does not skip heading levels (no h4 emitted into the page shell)', !/<h4/.test(admin.replace(/<script[\s\S]*?<\/script>/g, '')));
  // DELIVERY TRUTH: the shell scripts must revalidate every load like the pages do
  const server = fs.readFileSync('server.js', 'utf8');
  ok('server serves .js (markup.js, markup-editor.js, service workers) with Cache-Control: no-cache', /p\.endsWith\('\.js'\)/.test(server) && /res\.set\('Cache-Control', 'no-cache'\)/.test(server));
}

// ── B-wave 1 (Sep 11 2026): the four new marks - numbered lists, italics, quotes, a small heading ──
// Negative proof: the renderer before this wave rendered "1. one" as a paragraph, "_x_" as
// literal underscores, "> q" as "&gt; q" in a paragraph and "### h" as a paragraph.
{
  const R = MK.markupToHtml;
  const editorSrc = fs.readFileSync('public/markup-editor.js', 'utf8');
  ok('numbered list: "1. one / 2. two / 3) three" renders ONE <ol> with three items', /^<ol[^>]*><li>one<\/li><li>two<\/li><li>three<\/li><\/ol>$/.test(R('1. one\n2. two\n3) three')), R('1. one\n2. two\n3) three'));
  ok('numbered list: a line that is not numbered breaks the list back into a paragraph (mixed block stays a paragraph)', /^<p/.test(R('1. one\nplain')), R('1. one\nplain'));
  ok('italics: _words_ between non-word characters render <em>', R('say _hello_ there') === '<p style="margin:8px 0">say <em>hello</em> there</p>', R('say _hello_ there'));
  ok('italics: a snake_case_name is left alone, and a row of underscores is still a divider', !/<em>/.test(R('a snake_case_name here')) && /<hr/.test(R('_______')) && !/<em>/.test(R('_______')), { snake: R('a snake_case_name here'), rule: R('_______') });
  ok('italics: (_an aside_) inside brackets works, bold and italic in one line both render', /\(<em>an aside<\/em>\)/.test(R('(_an aside_)')) && /<strong>b<\/strong> and <em>i<\/em>/.test(R('**b** and _i_')));
  ok('quote: lines starting with > become ONE <blockquote> with <br> between the lines, the > gone', /^<blockquote[^>]*>a quoted line<br>and another<\/blockquote>$/.test(R('> a quoted line\n> and another')), R('> a quoted line\n> and another'));
  ok('quote: the accent-coloured left border is the only styling (no third-party, no class the site does not define)', /border-left:3px solid var\(--accent\)/.test(R('> q')));
  ok('small heading: ### Words on its own line renders <h5>; ## still renders <h4>; #### is plain text', /<h5[^>]*>Small<\/h5>/.test(R('### Small')) && /<h4[^>]*>Big<\/h4>/.test(R('## Big')) && !/<h[45]/.test(R('#### four')), { h5: R('### Small'), h4: R('## Big') });
  ok('the reference sample exercises every new mark, so the lockstep battery (landing.html inline copy vs markup.js) covers them too', /_soft_/.test(MK.REFERENCE_SAMPLE) && /### Small heading/.test(MK.REFERENCE_SAMPLE) && /> a quoted line/.test(MK.REFERENCE_SAMPLE) && /1\. one\n2\. two\n3\) three/.test(MK.REFERENCE_SAMPLE) && /_______/.test(MK.REFERENCE_SAMPLE));
  // the toolbar
  let t = ta('one\ntwo\nthree', 0, 13); ED.actions.numbered(t);
  ok('Numbered: three selected lines become 1. 2. 3.', t.value === '1. one\n2. two\n3. three', t.value);
  ED.actions.numbered(t);
  ok('Numbered again: the numbers come off', t.value === 'one\ntwo\nthree', t.value);
  t = ta('make this italic', 5, 9); ED.actions.italic(t);
  ok('Italic: wraps the selected word in underscores', t.value === 'make _this_ italic', t.value);
  ED.actions.italic(t);
  ok('Italic again on the same selection: unwraps it', t.value === 'make this italic', t.value);
  t = ta('', 0); ED.actions.italic(t);
  ok('Italic with nothing selected: inserts "italic text" ready to overtype', t.value === '_italic text_' && t.selectionStart === 1 && t.selectionEnd === 12, [t.value, t.selectionStart, t.selectionEnd]);
  t = ta('a line', 0); ED.actions.quote(t);
  ok('Quote: the line gets "> "', t.value === '> a line', t.value);
  t = ta('a line', 0); ED.actions.subheading(t);
  ok('Small heading: the line gets "### "', t.value === '### a line', t.value);
  t = ta('1. first', 8); const ev1 = enter(t);
  ok('Enter inside a numbered item writes the NEXT number', ev1.pd === true && t.value === '1. first\n2. ', t.value);
  t = ta('1. first\n2. ', 12); const ev2 = enter(t);
  ok('Enter on an empty numbered item ends the list', ev2.pd === true && t.value === '1. first\n', JSON.stringify(t.value));
  t = ta('> a quote', 9); const ev3 = enter(t);
  ok('Enter inside a quote continues the quote', ev3.pd === true && t.value === '> a quote\n> ', t.value);
  t = ta('7) seven', 8); const ev4 = enter(t);
  ok('a "7)" item continues as "8)"', ev4.pd === true && t.value === '7) seven\n8) ', t.value);
  ok('the cheat sheet and the example show the new marks', /1\. Item/.test(editorSrc) && /_words_/.test(editorSrc) && /&gt; Words/.test(editorSrc) && /### Words/.test(editorSrc) && /1\. Pick a bay/.test(ED.EXAMPLE) && /_a member since 2024_/.test(ED.EXAMPLE));
  ok('Ctrl+I is italic', /e\.key === 'i' \|\| e\.key === 'I'/.test(editorSrc));
}

console.log('\nMARKUP-EDITOR: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
