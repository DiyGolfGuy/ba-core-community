// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/schema.js - the ONE list of service-owned schema steps (W44, Sep 10 2026).
//
// services/db.js applies the core tables and columns (applySchema, at boot and
// after every reload). A few services own their own tables and add them at
// boot from server.js. A backup from an OLDER unit restored through the wizard
// or the Backups card used to get the core migration only at the next restart
// and the service tables never until then - so this list runs at boot AND right
// after a restore, from one place, in the same order. Requires are lazy: the
// services require db.js themselves.
'use strict';

function ensureServiceSchemas() {
  require('./pos').ensureSchema();
  require('./terminal').ensureSchema();
  require('./automation').ensureSchema();
  require('./checks').ensureSchema();
  require('./checks').ensureShareColumn();
  try { require('./records').ensureSchema(); } catch {}
  try { require('./subscribers').ensureSchema(); } catch {}   // W45: email updates
}

/** After a restore: the core migration, the service tables, and the file on disk
 *  current before the server answers - the wizard's "Reloading" must clear onto
 *  a database the current code can run on. Returns what was applied. */
function migrateAfterRestore() {
  const dbm = require('./db');
  dbm.migrate();
  ensureServiceSchemas();
  // a restored database is a new one: its End of Day rows get the evening rekey too (the review - the rekey runs once per
  // boot, and a restore does not restart the unit)
  try { require('./pos').rekeyEveningCloses(); } catch {}
  dbm.flushSync();
  return { tables: tableCount(dbm) };
}

function tableCount(dbm) {
  try { return dbm.db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get().n; } catch { return -1; }
}

module.exports = { ensureServiceSchemas, migrateAfterRestore, tableCount };
