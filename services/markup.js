// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/markup.js - server-side text formatting for custom pages.
//
// This is a thin re-export of public/markup.js: ONE renderer for the server,
// the admin editor's live preview, and every public page that formats owner
// text. It used to carry its own copy, and that copy silently fell behind
// (dividers and headings never reached server-rendered pages). Now there is
// nothing here to fall behind. landing.html keeps an inline copy for
// resilience; test-website-pages.js proves the two behave identically.
'use strict';

const shared = require('../public/markup.js');

module.exports = { markupToHtml: shared.markupToHtml, esc: shared.esc, REFERENCE_SAMPLE: shared.REFERENCE_SAMPLE };
