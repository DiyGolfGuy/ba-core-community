// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-scope.js — DECLARED WHERE IT IS USED (W37, Sep 8 2026)
//
// pilot facility failure #5 hung every card payment twice in one day, for two reasons:
//   1. a const array declared INSIDE the request handler, BELOW the line that
//      used it. JavaScript throws on that. The handler died as an unhandled
//      rejection, the server never replied, the browser spun forever.
//   2. after the fix, a re-check calling a helper declared in a NESTED BLOCK
//      400 lines earlier, invisible at handler level. Same symptom, same silence.
//
// WHAT THIS BATTERY DOES AND DOES NOT DO - read this before extending it.
// There is no JavaScript parser on a unit (no native modules, and no test is
// worth a new dependency), so this does NOT attempt full scope resolution. A
// first draft tried, and reported nineteen suspects that were all ordinary
// block shadowing - three branches each with their own `const id`. A check that
// cries wolf gets switched off, so this one was cut back to two shapes it can
// decide EXACTLY, both of which are the shapes that actually took pilot facility down:
//
//   A. a `function` declaration sitting inside a plain block (if / for / try),
//      rather than at module level or directly in a function body. That is the
//      "inner-block declaration" pilot facility's rule names, and it is a bug waiting
//      whether or not anything calls it from outside yet.
//   B. inside a route handler body, at the body's own top level, a const or
//      let used ABOVE its own declaration. Nested blocks and closures are
//      skipped on purpose - a closure referring to a later const is legal.
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

// Blank strings, template literals and comments, keeping every character
// position so line numbers stay honest. (Brace balance after this is asserted
// per file below - a file that does not balance is reported, never assumed.)
function blank(src) {
  const out = src.split('');
  const n = src.length;
  const wipe = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };

  // Template literals nest: `a ${ fn(`b`) } c`. Blanking to the first unescaped
  // backtick ends the literal at the INNER one and every brace after it is
  // misread - which is exactly how the first draft of this battery decided nine
  // files had unbalanced braces. Walk ${ } depth and recurse into it.
  function skipTemplate(start) {
    let i = start + 1;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { wipe(start, i); return i + 1; }
      if (src[i] === '$' && src[i + 1] === '{') {
        wipe(start, i);                       // blank the literal text so far
        let depth = 1; i += 2;
        const exprStart = i;
        while (i < n && depth > 0) {
          const c = src[i];
          if (c === '\\') { i += 2; continue; }
          if (c === '`') { i = skipTemplate(i); continue; }
          if (c === '"' || c === "'") { const q = c; i++; while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) { i++; break; } i++; } continue; }
          if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
            // a regex inside an interpolation - /"/g must not be read as a quote
            let k = i - 1; while (k >= 0 && /\s/.test(src[k])) k--;
            const prev = k >= 0 ? src[k] : '(';
            if ('(,=:[!&|?{};'.includes(prev)) {
              let j2 = i + 1, cls = false, closed = false;
              while (j2 < n) { const ch2 = src[j2];
                if (ch2 === '\\') { j2 += 2; continue; }
                if (ch2 === '\n') break;
                if (cls) { if (ch2 === ']') cls = false; }
                else if (ch2 === '[') cls = true;
                else if (ch2 === '/') { closed = true; break; }
                j2++; }
              if (closed) { i = j2 + 1; continue; }
            }
          }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          i++;
        }
        void exprStart;                       // the expression stays as CODE
        start = i;                            // resume blanking after it
        continue;
      }
      i++;
    }
    wipe(start, n);
    return n;
  }

  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; wipe(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; wipe(i, j + 2); i = j + 2; continue; }
    if (c === '`') { const end = skipTemplate(i); wipe(i, i + 1); if (end <= n) wipe(end - 1, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; }
      wipe(i, j + 1); i = j + 1; continue;
    }
    // A regex literal can carry braces (\d{4}) - blank it. A slash that starts
    // one always follows an operator, a keyword, '(' or ',' - never a value.
    if (c === '/') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      const prev = k >= 0 ? src[k] : '(';
      if ('(,=:[!&|?{};+-*%<>~^'.includes(prev) || /\b(return|typeof|case|in|of|do|else)$/.test(src.slice(Math.max(0, k - 8), k + 1))) {
        let j = i + 1, cls = false, closed = false;
        while (j < n) {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (ch === '\n') break;
          if (cls) { if (ch === ']') cls = false; }
          else if (ch === '[') cls = true;
          else if (ch === '/') { closed = true; break; }
          j++;
        }
        if (closed) { wipe(i, j + 1); i = j + 1; continue; }
      }
    }
    i++;
  }
  return out.join('');
}

// Is the `{` at idx the body of a function, or a plain block? Decidable:
// an arrow body ends with `=>`; a function/method body ends with a `)` whose
// matching `(` is NOT preceded by if / for / while / switch / catch.
function opensFunctionBody(src, idx) {
  let k = idx - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k >= 1 && src[k] === '>' && src[k - 1] === '=') return true;      // => {
  if (k < 0 || src[k] !== ')') return false;                            // else/try/do/bare/object
  let depth = 0, j = k;
  for (; j >= 0; j--) {
    if (src[j] === ')') depth++;
    else if (src[j] === '(') { depth--; if (depth === 0) break; }
  }
  if (j < 0) return false;
  let p = j - 1;
  while (p >= 0 && /\s/.test(src[p])) p--;
  let word = '';
  while (p >= 0 && /[\w$]/.test(src[p])) { word = src[p] + word; p--; }
  return !['if', 'for', 'while', 'switch', 'catch'].includes(word);
}

const lineOf = (raw, idx) => raw.slice(0, idx).split('\n').length;

// ── A. function declarations inside a plain block ───────────────────────────
// Walk the blanked source keeping a stack that remembers, for each open brace,
// whether it opened a FUNCTION BODY or a plain block.
function nestedFunctionDecls(raw) {
  const src = blank(raw);
  const hits = [];
  const stack = [];                       // true = this brace opened a function body
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { stack.push(opensFunctionBody(src, i)); continue; }
    if (ch === '}') { stack.pop(); continue; }
    if (ch !== 'f') continue;
    const m = /^function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i, i + 90));
    if (!m) continue;
    if (i > 0 && /[\w$.]/.test(src[i - 1])) continue;
    // Inside a plain block if the innermost open brace was NOT a function body.
    if (stack.length && stack[stack.length - 1] === false) {
      hits.push(`line ${lineOf(raw, i)}: function ${m[1]}() is declared inside a plain block`);
    }
  }
  return hits;
}

// ── B. use-before-declaration at a route handler's own top level ────────────
function handlerBodies(raw) {
  const src = blank(raw);
  const out = [];
  const re = /router\.(get|post|put|delete|patch)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const arrow = src.indexOf('=>', m.index);
    if (arrow < 0 || arrow - m.index > 300) continue;
    let i = arrow;
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) continue;
    let depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    out.push({ start: i, end, body: src.slice(i, end + 1), line: lineOf(raw, m.index) });
  }
  return out;
}

function tdzInHandler(raw, h) {
  const hits = [];
  const b = h.body;
  // positions at the body's OWN top level (depth 1 from the opening brace)
  const top = [];
  let depth = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === '{') { depth++; continue; }
    if (b[i] === '}') { depth--; continue; }
    if (depth === 1) top.push(i);
  }
  const isTop = new Set(top);
  for (const m of b.matchAll(/\b(const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (!isTop.has(m.index)) continue;                       // nested block: not our business
    const name = m[2];
    const before = b.slice(0, m.index);
    const ref = new RegExp('(^|[^.\\w$])' + name.replace(/\$/g, '\\$') + '\\s*[\\(\\)\\[\\].,;=+*/%<>!&|?:\\s]');
    let found = -1;
    for (const r of before.matchAll(new RegExp(ref.source, 'g'))) {
      const at = r.index + r[1].length;
      if (!isTop.has(at)) continue;                            // only a TOP-LEVEL use is a certain throw
      // A use inside a function - its parameter list, or the body of an arrow
      // written without braces - is DEFERRED, not immediate, and naming a
      // const declared later is legal there. Walk back to the start of the
      // statement; if a `function` or `=>` sits between it and the use, skip.
      let s0 = at;
      while (s0 > 0 && !';{}'.includes(b[s0 - 1])) s0--;
      const stmt = b.slice(s0, at);
      if (/=>|\bfunction\b/.test(stmt)) continue;
      // `const f = (id) => ...` - `id` here is the arrow's PARAMETER, and the
      // `=>` sits after it, so the statement text above cannot see it. Walk out
      // to the enclosing paren group and look at what follows its close.
      let depth2 = 0, k2 = at - 1, openAt = -1;
      for (; k2 >= s0; k2--) {
        if (b[k2] === ')') depth2++;
        else if (b[k2] === '(') { if (depth2 === 0) { openAt = k2; break; } depth2--; }
      }
      if (openAt >= 0) {
        let d3 = 0, c3 = openAt;
        for (; c3 < b.length; c3++) { if (b[c3] === '(') d3++; else if (b[c3] === ')') { d3--; if (d3 === 0) break; } }
        if (/^\s*=>/.test(b.slice(c3 + 1, c3 + 6))) continue;
      }
      found = at; break;
    }
    if (found >= 0) {
      hits.push(`handler at line ${h.line}: ${m[1]} ${name} is used on line ${lineOf(raw, h.start + found)} and declared on line ${lineOf(raw, h.start + m.index)}`);
    }
  }
  return hits;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (['routes', 'services', 'tools'].includes(e.name) || dir !== __dirname) walk(fp, acc); }
    else if (e.name.endsWith('.js') && !e.name.startsWith('test-')) acc.push(fp);
  }
  return acc;
}

const files = [...new Set(walk(__dirname).concat([path.join(__dirname, 'server.js')]))].filter(f => fs.existsSync(f));

// A file whose braces do not balance after blanking cannot be reasoned about.
// Say so rather than passing quietly - never accept a result from a check that
// did not actually run.
const unbalanced = [];
for (const f of files) {
  const b = blank(fs.readFileSync(f, 'utf8'));
  let d = 0;
  for (const ch of b) { if (ch === '{') d++; else if (ch === '}') d--; }
  if (d !== 0) unbalanced.push(path.relative(__dirname, f) + ' (delta ' + d + ')');
}
ok('every file analysed has balanced braces, so the walk is meaningful', unbalanced.length === 0, unbalanced);

let nested = [], tdz = [], handlerCount = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const rel = path.relative(__dirname, f);
  for (const h of nestedFunctionDecls(raw)) nested.push(rel + ' ' + h);
  for (const h of handlerBodies(raw)) { handlerCount++; for (const t of tdzInHandler(raw, h)) tdz.push(rel + ' ' + t); }
}

ok('there are route handlers to audit', handlerCount > 40, { handlers: handlerCount, files: files.length });
ok('NO function is declared inside a plain if/for/try block', nested.length === 0, nested.slice(0, 10));
ok('NO const or let is used above its own declaration at a handler\'s top level', tdz.length === 0, tdz.slice(0, 10));

// ── FAIL-FIRST: both halves of pilot facility's hang, and the shadowing that must NOT fire
{
  const tdzSrc = "router.post('/x', async (req, res) => {\n  const body = pick(TEXTS);\n  const TEXTS = ['a','b'];\n  res.json({ body });\n});\n";
  const h = handlerBodies(tdzSrc)[0];
  const hits = h ? tdzInHandler(tdzSrc, h) : [];
  ok('FAIL-FIRST: a const used above its declaration in a handler is caught (pilot facility hang one)',
     hits.length === 1 && /TEXTS/.test(hits[0]), hits);

  const fixedSrc = "router.post('/x', async (req, res) => {\n  const TEXTS = ['a','b'];\n  const body = pick(TEXTS);\n  res.json({ body });\n});\n";
  const h2 = handlerBodies(fixedSrc)[0];
  ok('FAIL-FIRST: and the same handler passes once the const moves above its use',
     h2 && tdzInHandler(fixedSrc, h2).length === 0);

  const nestedSrc = "function outer(){\n  if (ready) {\n    function helper(){ return 1; }\n    helper();\n  }\n}\n";
  ok('FAIL-FIRST: a function declared inside an if block is caught (pilot facility hang two)',
     nestedFunctionDecls(nestedSrc).length === 1, nestedFunctionDecls(nestedSrc));

  const moduleSrc = "function helper(){ return 1; }\nfunction outer(){\n  if (ready) { helper(); }\n}\n";
  ok('FAIL-FIRST: and the same helper at module scope passes',
     nestedFunctionDecls(moduleSrc).length === 0, nestedFunctionDecls(moduleSrc));

  const shadowSrc = "router.post('/z', (req,res) => {\n  if (a) { const id = 1; use(id); }\n  if (b) { const id = 2; use(id); }\n  res.json({});\n});\n";
  const h3 = handlerBodies(shadowSrc)[0];
  ok('NOT A FALSE ALARM: the same name declared in sibling branches is fine',
     h3 && tdzInHandler(shadowSrc, h3).length === 0 && nestedFunctionDecls(shadowSrc).length === 0);

  const closureSrc = "router.post('/c', (req,res) => {\n  const go = () => later;\n  const later = 5;\n  res.json({ go });\n});\n";
  const h4 = handlerBodies(closureSrc)[0];
  ok('NOT A FALSE ALARM: a closure that names a const declared later is legal',
     h4 && tdzInHandler(closureSrc, h4).length === 0, h4 && tdzInHandler(closureSrc, h4));
}

console.log(`\nSCOPE: ${pass} passed, ${fail} failed  (${files.length} files, ${handlerCount} route handlers)`);
process.exit(fail ? 1 : 0);
