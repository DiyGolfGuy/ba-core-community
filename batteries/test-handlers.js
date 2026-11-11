// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-handlers.js — EVERY INLINE HANDLER RESOLVES (W37, Sep 8 2026)
//
// pilot facility failure #3: a block edit replaced the span between two anchors and took
// submitBooking() with it. The page still parsed, every syntax check passed,
// and Confirm & Pay silently did nothing on the live site for a day.
//
// This battery collects every inline onclick/onchange/... on every page and
// proves the function each one names is actually defined - in the page itself
// or in a local script the page loads. It runs in milliseconds and it is the
// cheapest insurance in the suite.
//
// Same-day idempotent: reads files, writes nothing.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); pass++; }
  else { console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
}

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');

// Names that are the language or the browser, not ours.
const BUILTIN = new Set([
  'if', 'for', 'while', 'switch', 'return', 'typeof', 'catch', 'function', 'do', 'else', 'new', 'delete', 'void',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'RegExp', 'Promise', 'Error', 'Set', 'Map',
  'parseInt', 'parseFloat', 'isNaN', 'alert', 'confirm', 'prompt', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'requestAnimationFrame', 'queueMicrotask',
  'var'  // `var(--gold)` inside an inline style string is CSS, not a call
]);

// Everything the page can legitimately define a handler as.
function collectDefinitions(src, into) {
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) into.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g)) into.add(m[1]);
  for (const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) into.add(m[1]);
  // object-literal method shorthand assigned to window, e.g. window.X = { go(){} }
  for (const m of src.matchAll(/^\s{0,8}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) into.add(m[1]);
  return into;
}

// A page can load its handlers from a local script - /update-bar.js and
// /site-layout.js both define functions the pages call inline.
function linkedScripts(src) {
  const out = [];
  for (const m of src.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/g)) {
    const href = m[1];
    if (/^https?:|^\/\//.test(href)) continue;       // CDN: not ours to prove
    out.push(href.replace(/^\//, '').split('?')[0]);
  }
  return out;
}

const ATTR = /\son(?:click|change|input|submit|blur|focus|keyup|keydown|keypress|mouseover|mouseout|mousedown|mouseup|touchstart|touchend|load|error)\s*=\s*("([^"]*)"|'([^']*)')/g;

const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html')).sort();
ok('there are pages to check', pages.length > 0, { pages: pages.length });

let totalHandlers = 0, totalCalls = 0;
const unresolved = [];

for (const page of pages) {
  const src = fs.readFileSync(path.join(PUB, page), 'utf8');
  const defined = collectDefinitions(src, new Set());
  for (const rel of linkedScripts(src)) {
    for (const base of [PUB, ROOT]) {
      const fp = path.join(base, rel);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { collectDefinitions(fs.readFileSync(fp, 'utf8'), defined); break; }
    }
  }
  for (const m of src.matchAll(ATTR)) {
    const body = m[2] !== undefined ? m[2] : m[3];
    totalHandlers++;
    for (const c of body.matchAll(/(?:^|[^.\w$'"])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const fn = c[1];
      if (BUILTIN.has(fn)) continue;
      totalCalls++;
      if (!defined.has(fn)) unresolved.push(`${page}: ${fn}()  in  ${body.slice(0, 70)}`);
    }
  }
}

ok('every page carries inline handlers to check', totalHandlers > 100, { handlers: totalHandlers });
ok('EVERY inline handler on EVERY page resolves to a function that exists',
   unresolved.length === 0, unresolved.slice(0, 12));

// The pages an owner, a staff member or a customer actually clicks must each
// carry handlers - a page that suddenly has none has probably lost its script.
for (const p of ['admin.html', 'staff.html', 'index.html', 'me.html']) {
  const src = fs.readFileSync(path.join(PUB, p), 'utf8');
  const n = [...src.matchAll(ATTR)].length;
  ok(`${p} still wires its controls (${n} inline handlers)`, n > 0, { handlers: n });
}

// FAIL-FIRST: the check itself must be able to see a missing function. We prove
// it on a synthetic page rather than by breaking a real one.
{
  const broken = '<button onclick="totallyMissingFn()">Go</button><script>function somethingElse(){}</script>';
  const defined = collectDefinitions(broken, new Set());
  const miss = [...broken.matchAll(ATTR)]
    .flatMap(m => [...(m[2] || '').matchAll(/(?:^|[^.\w$'"])([A-Za-z_$][\w$]*)\s*\(/g)])
    .map(c => c[1]).filter(f => !BUILTIN.has(f) && !defined.has(f));
  ok('FAIL-FIRST: the check catches a handler whose function was deleted',
     miss.length === 1 && miss[0] === 'totallyMissingFn', miss);
  const fixed = '<button onclick="totallyMissingFn()">Go</button><script>function totallyMissingFn(){}</script>';
  const d2 = collectDefinitions(fixed, new Set());
  ok('FAIL-FIRST: and passes once the function is there', d2.has('totallyMissingFn'));
}

console.log(`\nHANDLERS: ${pass} passed, ${fail} failed  (${totalHandlers} inline handlers, ${totalCalls} calls, ${pages.length} pages)`);
process.exit(fail ? 1 : 0);
