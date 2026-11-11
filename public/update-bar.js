// Copyright (c) 2025-2026 BA Custom Products LLC.
// update-bar.js - "an update landed, reload to get it" (W28, maintainer, Sep 2 2026).
// A phone tab left open on /admin, /staff or /me keeps the OLD page after a
// wave lands on the unit. /api/time carries a build stamp that changes when
// the unit's files change; this compares it every minute and the moment the
// tab comes back to the front, and shows one bar with a Reload button.
(function () {
  var seen = null, bar = null;
  function show() {
    if (bar) return;
    bar = document.createElement('div');
    bar.id = 'updateBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 14px;background:#c9a227;color:#111;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4)';
    bar.innerHTML = '<span>This screen was updated. Reload to get the latest.</span><button type="button" style="background:#111;color:#f3e6b8;border:0;padding:8px 16px;border-radius:6px;font:600 14px system-ui,sans-serif;cursor:pointer" onclick="location.reload()">Reload</button>';
    document.body.appendChild(bar);
  }
  function check() {
    return fetch('/api/time', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.build) return false;
      if (seen === null) { seen = j.build; return false; }
      if (j.build !== seen) { show(); return true; }
      return false;
    }).catch(function () { return false; });
  }
  window.BAUpdate = { check: check, seen: function () { return seen; } };
  check();
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
})();
