// Copyright (c) 2025-2026 BA Custom Products LLC.
// tools/fake-clock.js - A PRELOAD THAT MOVES THE CLOCK (anti-drift 2, Sep 11 2026).
//   node -r ./tools/fake-clock.js server.js        with BA_FAKE_NOW=2025-09-12T14:00:00
// Every `new Date()` and `Date.now()` in the process answer the fake moment
// and run forward from it at real speed; `new Date(x)` and Date.parse are
// untouched. sql.js's own datetime('now') follows too (emscripten reads
// Date.now()), so rows the product stamps carry the fake date - proven in the
// aging generator's first run. Refuses to load without BA_FAKE_NOW (nothing on
// a real unit can trip it), and never ships in a pack's runtime path: it is a
// tool the batteries and tools/age-facility.js preload on purpose.
'use strict';
const iso = process.env.BA_FAKE_NOW;
if (!iso) throw new Error('tools/fake-clock.js: BA_FAKE_NOW is not set - this preload is for the aging generator and the aged-unit battery only');
const RealDate = Date;
const target = RealDate.parse(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : iso + (iso.includes('T') ? '' : 'T12:00:00'));
if (!Number.isFinite(target)) throw new Error('tools/fake-clock.js: BA_FAKE_NOW is not a date: ' + iso);
let offset = target - RealDate.now();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
  static now() { return RealDate.now() + offset; }
}
Object.defineProperty(FakeDate, 'name', { value: 'Date' });
global.Date = FakeDate;
// the generator moves the clock INSIDE one process (a day's scheduler ticks every ten
// minutes without a process per tick): global.__baFakeClock.set('2025-09-12T14:10:00')
global.__baFakeClock = { set(iso2) { const t = RealDate.parse(iso2.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso2) ? iso2 : iso2); if (!Number.isFinite(t)) throw new Error('bad fake time ' + iso2); offset = t - RealDate.now(); }, get() { return new RealDate(RealDate.now() + offset).toISOString(); } };
