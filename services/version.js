// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
'use strict';

const { version } = require('../package.json');

function current() {
  // Keep the backup metadata fields for compatibility with older archives.
  return { tag: version, commit: null, drift: null, date: null };
}

function label(v = current()) {
  return v.tag;
}

module.exports = { current, label };
