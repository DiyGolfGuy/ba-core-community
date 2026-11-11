// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/colours.js - COLOURS BY NAME (branch feature/ai-edition)
//
// A small model says "dark green", not #1c3a26. One list for every colour the assistant names: the website's colours
// (areas/website.js) and, since Oct 21 2026, a bay routine's button on the staff pad (maintainer: "make sure all that is ...
// editable with color choice using the AI").
'use strict';

const NAMED = Object.freeze({ black: '#111111', white: '#ffffff', 'off white': '#f7f5ef', cream: '#f5efe0', beige: '#e8dcc4', tan: '#c9b18a', brown: '#5b3a1e', 'dark brown': '#3b2412',
    red: '#c0392b', 'dark red': '#8b1e1e', maroon: '#6b1d24', burgundy: '#7a1f2b', crimson: '#b0172f', coral: '#e2725b', salmon: '#e9967a', pink: '#d94f8a', 'hot pink': '#e0218a',
    orange: '#e67e22', 'burnt orange': '#c1571b', gold: '#c9a227', yellow: '#f1c40f', mustard: '#c9a227', lime: '#7cb518', green: '#2e7d32', 'dark green': '#1c3a26',
    'forest green': '#1f4d2b', 'golf green': '#2e6b3a', olive: '#667428', mint: '#7fd1ae', teal: '#1c7e67', turquoise: '#1aa6a6', cyan: '#18a3c4', 'sky blue': '#5ab0d8',
    blue: '#1f5fbf', 'royal blue': '#2948b8', navy: '#152238', 'navy blue': '#152238', 'dark blue': '#13294b', purple: '#6a3d9a', violet: '#7d4fc4', plum: '#3a1f3a',
    lavender: '#b9a7e0', gray: '#6f6f6c', grey: '#6f6f6c', 'light gray': '#e6e6e3', 'light grey': '#e6e6e3', 'dark gray': '#333333', 'dark grey': '#333333', charcoal: '#232323', silver: '#c0c0c0' });

/** "#1C3A26", "#1c3", "dark green" -> "#1c3a26"; anything else -> null. */
function hexOf(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map(x => x + x).join('');
  return NAMED[s] || null;
}
/** The colour's own name when it has one ("#2e7d32" -> "green"), else the hex. */
function nameOf(hex) {
  const h = String(hex || '').toLowerCase();
  const hit = Object.keys(NAMED).find(k => NAMED[k] === h);
  return hit || h;
}

module.exports = { NAMED, hexOf, nameOf };
