// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-inserts.js — EVERY INSERT BALANCES (W37, Sep 8 2026)
//
// pilot facility failure #4: a column was added to an INSERT's column list without a
// matching placeholder. Every value after it shifted one position, a timezone
// landed in a timestamp column, and nothing threw.
//
// test-sql-bindings.js already proves placeholders == bind arguments. It cannot
// see this bug: drop a placeholder and the arg count drops with it, so that
// check still balances. THIS one compares the COLUMN LIST to the VALUES LIST.
//
// Nested parens are the trap - datetime('now') and datetime('now','-10 minutes')
// are ONE value each and break a naive comma split, so we walk the string.
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

// Walk from an opening paren to its match, returning the inside and the index
// after the close. String-aware, so a paren or comma inside quotes is inert.
function balanced(src, open) {
  if (src[open] !== '(') return null;
  let depth = 0, quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return { inner: src.slice(open + 1, i), end: i + 1 }; }
  }
  return null;
}

// Split on TOP-LEVEL commas only: datetime('now','-10 minutes') stays one item.
function topLevelSplit(s) {
  const out = []; let depth = 0, quote = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { cur += ch; if (ch === '\\') { cur += s[++i] || ''; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(x => x.length);
}

/** Every `INSERT INTO t (cols) VALUES (...)` in one source file. */
function findInserts(src, file) {
  const found = [];
  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([A-Za-z_][\w]*)\s*\(/gi;
  let m;
  while ((m = re.exec(src))) {
    const colOpen = m.index + m[0].length - 1;
    const cols = balanced(src, colOpen);
    if (!cols) continue;
    const after = src.slice(cols.end, cols.end + 400);
    const vm = after.match(/^\s*VALUES\s*\(/i);
    if (!vm) continue;                        // INSERT ... SELECT: nothing to balance
    const valOpen = cols.end + vm[0].length - 1;
    const vals = balanced(src, valOpen);
    if (!vals) continue;
    const line = src.slice(0, m.index).split('\n').length;
    found.push({
      file, line, table: m[1],
      cols: topLevelSplit(cols.inner),
      vals: topLevelSplit(vals.inner)
    });
  }
  return found;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, acc);
    else if (e.name.endsWith('.js') && !e.name.startsWith('test-')) acc.push(fp);
  }
  return acc;
}

const files = walk(__dirname);
let all = [];
for (const f of files) all = all.concat(findInserts(fs.readFileSync(f, 'utf8'), path.relative(__dirname, f)));

ok('the tree has INSERTs to check', all.length > 20, { inserts: all.length });

const unbalanced = all.filter(i => i.cols.length !== i.vals.length)
  .map(i => `${i.file}:${i.line} ${i.table} - ${i.cols.length} columns vs ${i.vals.length} values`);
ok('EVERY INSERT names exactly as many values as columns', unbalanced.length === 0, unbalanced.slice(0, 10));

// The tables where a shifted value costs money or evidence get named, so a
// failure says which one and nobody has to go looking.
for (const t of ['bookings', 'signed_waivers', 'discount_uses', 'member_usage', 'member_credit', 'tab_payments']) {
  const mine = all.filter(i => i.table === t);
  const bad = mine.filter(i => i.cols.length !== i.vals.length);
  ok(`${t}: ${mine.length} INSERT${mine.length === 1 ? '' : 's'}, all balanced`, mine.length > 0 && bad.length === 0,
     bad.map(i => `${i.file}:${i.line} ${i.cols.length}/${i.vals.length}`));
}

// Nested parens really are handled - the trap that breaks a naive regex.
{
  const probe = `INSERT INTO t (a, b, c) VALUES (?, datetime('now','-10 minutes'), ?)`;
  const r = findInserts(probe, 'probe')[0];
  ok('nested parens count as ONE value: datetime(\'now\',\'-10 minutes\') does not split',
     !!r && r.cols.length === 3 && r.vals.length === 3, r && { cols: r.cols.length, vals: r.vals.length });
}

// FAIL-FIRST: this is pilot facility's exact defect, and the check must see it.
{
  const broken = `INSERT INTO t (a, b, c, d) VALUES (?, ?, datetime('now'))`;
  const r = findInserts(broken, 'probe')[0];
  ok('FAIL-FIRST: a column added without its placeholder is caught (4 columns, 3 values)',
     !!r && r.cols.length === 4 && r.vals.length === 3, r && { cols: r.cols.length, vals: r.vals.length });
  const fixed = `INSERT INTO t (a, b, c, d) VALUES (?, ?, ?, datetime('now'))`;
  const r2 = findInserts(fixed, 'probe')[0];
  ok('FAIL-FIRST: and passes once the placeholder is added', !!r2 && r2.cols.length === r2.vals.length);
}

console.log(`\nINSERTS: ${pass} passed, ${fail} failed  (${all.length} INSERT statements across ${files.length} files)`);
process.exit(fail ? 1 : 0);
