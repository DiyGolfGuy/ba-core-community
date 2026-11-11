// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/importers.js - OLD BACKUPS INTO TODAY'S LAYOUT (CLAUDE.md rule 43)
//
//  maintainer, Oct 8 2026: "even massive updates can take old facility data. even if it ...
//  puts it in different places it needs to so something in each new version that is
//  substantualy different that can take the old backup data and know what to do with it."
//
//  Every restore - the wizard's upload, the owner's restore in Settings > Protection,
//  a backup found on a USB stick - hands the UNPACKED backup to convert() before
//  anything is copied onto the unit. convert() reads what the backup says it is
//  (backup.json: formatVersion, writtenBy, the columns of every table; a backup made
//  before Sep 23 2026 has no backup.json - "format 0") and runs, in order, every
//  conversion below that applies to it. Each conversion rewrites the unpacked copy, so
//  what lands on the unit is already in today's layout. A conversion that throws stops
//  the restore before a byte is copied - a half-converted facility is never restored.
//
//  TODAY THE LIST IS EMPTY, ON PURPOSE. Rule 14 (additive only) means every older
//  layout IS today's layout minus what was added since, and the restore's own
//  migration (schema.migrateAfterRestore) adds the rest. The first version that moves
//  data somewhere new - renames or splits a table, changes what a column means, keeps
//  a setting under another key, leaves SQLite - adds its conversion HERE, and
//  test-backup-bridge (every shipped version's frozen backup onto a new unit) fails
//  until it does. Every old layout is on record: fleet/schema/<tag>.json (the tables,
//  columns and config keys of each shipped version) and fleet/fixtures/<tag>/backup.*
//  (the real backup files those versions made).
//
//  A conversion: { id: 'NNN-short-name', why: 'what moved, when, maintainer's ruling',
//                  applies: (manifest, dir) => boolean, run: (dir, manifest) => void }
//  - ids are numbered in order and never reused or removed (a backup from any year
//    may need any of them, in order)
//  - applies() reads the backup, never the unit; run() touches only `dir`
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const CONVERSIONS = [];

/** What a backup says it is. One made before backups described themselves is format 0. */
function describe(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'backup.json'), 'utf8'));
    return Object.assign({ formatVersion: 1 }, m);
  } catch { return { formatVersion: 0, writtenBy: null, schema: null }; }
}

/** Bring an unpacked backup into today's layout. Returns what it was and which conversions ran. */
function convert(dir, list) {
  const m = describe(dir);
  const settingsPath = path.join(dir, 'config.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Backup settings must be an object');
    if (require('./config').removeRetiredSettings(settings)) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    }
  }
  const ran = [];
  for (const c of (list || CONVERSIONS)) {
    if (!c.applies(m, dir)) continue;
    try { c.run(dir, m); }
    catch (e) { throw new Error(`converting this backup to today's layout failed at ${c.id}: ${e.message} - nothing was restored`); }
    ran.push(c.id);
  }
  return { format: m.formatVersion || 0, writtenBy: m.writtenBy ? (m.writtenBy.tag || null) : null, ran };
}

/** One line for the owner's log. */
function line(r) {
  if (!r) return 'conversions: not run';
  return `backup format ${r.format}${r.writtenBy ? ' from ' + r.writtenBy : ''}; conversions: ${r.ran.length ? r.ran.join(', ') : 'none needed'}`;
}

module.exports = { convert, describe, line, CONVERSIONS };
