// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/staffpwa.js — the staff surface as an installable PWA.
//
// Employees add /staff to their phone's home screen: the facility's own icon,
// opens straight to the code pad, and stays resident in the background. The
// LAN-only law is untouched — the service worker only makes the SHELL load
// fast; every API call still refuses off the facility network (tunnel serves
// the offsite page; off-network the shell shows the connect-to-wifi panel).
//
// Icon: owners upload a PNG (512x512 recommended) from the Staff roster card.
// Until then a generated steel-blue default keeps the manifest valid — built
// here as a real PNG (zlib IDAT + our own CRC32) because the Pi stack ships
// no image libraries and never will for one square.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const configService = require('./config');

const ICON_PATH = path.join(__dirname, '..', 'public', 'staff-icon.png');
const MAX_ICON_BYTES = 1024 * 1024; // 1 MB
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ── CRC32 (PNG chunk checksums) ──────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Solid-color square PNG (truecolor 8-bit), the honest default.
function defaultIconPng(size, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// A file that exists but is not a PNG is treated as missing. The golden tree
// once carried an 8-byte stub left behind by a battery run in the live tree;
// with an exists-only check every clone shipped a broken staff-app icon.
function iconIsValid() {
  try {
    const fd = fs.openSync(ICON_PATH, 'r');
    try {
      const head = Buffer.alloc(8);
      const n = fs.readSync(fd, head, 0, 8, 0);
      return n === 8 && head.equals(PNG_MAGIC) && fs.fstatSync(fd).size > 8;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

function ensureStaffIcon() {
  try {
    if (!iconIsValid()) {
      fs.writeFileSync(ICON_PATH, defaultIconPng(192, 0x5b, 0x9b, 0xd5)); // staff steel-blue
      console.log('Staff PWA icon: generated default at', ICON_PATH);
    }
  } catch (e) { console.error('Staff icon ensure failed:', e.message); }
}

// Owner upload: base64 PNG (data-URL prefix tolerated), magic + size checked.
function saveStaffIcon(base64) {
  const clean = String(base64 || '').replace(/^data:image\/png;base64,/, '').trim();
  if (!clean) throw new Error('No image data received');
  let buf;
  try { buf = Buffer.from(clean, 'base64'); } catch { throw new Error('Invalid base64'); }
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('The icon must be a PNG file');
  if (buf.length > MAX_ICON_BYTES) throw new Error('Icon too large - keep it under 1 MB (512x512 is plenty)');
  fs.writeFileSync(ICON_PATH, buf);
  return { bytes: buf.length };
}

function iconVersion() {
  try { return String(Math.floor(fs.statSync(ICON_PATH).mtimeMs)); } catch { return '0'; }
}

function manifest() {
  const cfg = configService.getConfig();
  const name = (cfg.server && cfg.server.businessName ? cfg.server.businessName + ' ' : '') + 'Staff';
  const v = iconVersion();
  return {
    name,
    short_name: 'Staff',
    description: 'Staff counter for check-ins, tabs, ordering, and end of day. Facility network only.',
    start_url: '/staff',
    scope: '/staff',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#060a06',
    theme_color: '#5b9bd5',
    icons: [
      { src: '/staff-icon.png?v=' + v, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/staff-icon.png?v=' + v, sizes: '512x512', type: 'image/png', purpose: 'any' }
    ]
  };
}

module.exports = { ensureStaffIcon, saveStaffIcon, manifest, iconVersion, ICON_PATH };
