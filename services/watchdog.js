// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/watchdog.js - A FROZEN UNIT RESTARTS ITSELF (maintainer, Oct 8 2026: "what is
//  vitaly important is no down time that is on me from an over site i missed that i
//  cant remidy remotly")
//
//  PM2 starts the product again when it CRASHES. Nothing started it again when it
//  FROZE - a loop that never yields, or a server that stops answering while the
//  process lives on - and a frozen unit stays dark, bookings and all, until someone
//  on site pulls the plug. So a WORKER THREAD (its own event loop: it keeps running
//  when the main one is stuck) watches two things, every CHECK_MS:
//    - the main thread's heartbeat: a shared counter the main thread bumps every few
//      seconds; if it has not moved for STALL_MS, the main thread is stuck
//    - the server itself: GET /api/time on its own port; if nothing has answered for
//      STALL_MS, the server is not serving whatever the main thread is doing
//  STALL_MS is five minutes - longer than anything the product does on purpose (an
//  update's unzip, a large restore, a year-end export) - so a slow moment is never a
//  restart. On a stall it writes one line to the console (PM2's log) and ends the
//  process: SIGTERM when the main thread still runs (the database saves on the way
//  out), SIGKILL when it does not (a frozen main thread cannot run a handler - the
//  database on disk is the last complete write, never a torn one). PM2 starts it
//  again; after an update the boot guard counts that start like any other, so an
//  update that freezes on boot is rolled back the way one that crashes is.
//
//  This cannot catch a process the kernel itself has frozen (a card that stops
//  answering mid-write) - that is the Pi's hardware watchdog, set in the image.
//  BA_WATCHDOG_OFF=1 (a unit's own flag) switches it off; BA_WATCHDOG_STALL_MS and
//  BA_WATCHDOG_CHECK_MS are for its battery (test-watchdog).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const STALL_MS = Number(process.env.BA_WATCHDOG_STALL_MS) || 5 * 60 * 1000;
const CHECK_MS = Number(process.env.BA_WATCHDOG_CHECK_MS) || 30 * 1000;
const BEAT_MS = Math.max(200, Math.min(5000, Math.floor(STALL_MS / 10)));

let started = false;

// the watcher, run in its own thread
const WORKER = `
const { workerData } = require('worker_threads');
const beat = new Int32Array(workerData.sab);
const { port, stallMs, checkMs, pid } = workerData;
// a MONOTONIC clock (Oct 19 2026, the night's review): a Pi has no clock battery - after a power cut it boots at its last
// saved time and the network time then steps it forward, by hours. On Date.now() that step looked like a stall of hours
// and the watchdog killed a healthy product in the middle of its catch-up. performance.now() never jumps.
const now = () => performance.now();
// test-watchdog W7 only: the wall clock steps BA_TEST_WATCHDOG_DATE_STEP_H hours part-way through (network time after a cut)
if (process.env.BA_TEST_WATCHDOG_DATE_JUMP_MS) { const real = Date.now, at = real() + Number(process.env.BA_TEST_WATCHDOG_DATE_JUMP_MS), step = Number(process.env.BA_TEST_WATCHDOG_DATE_STEP_H || 6) * 3600000; Date.now = () => real() + (real() > at ? step : 0); }
let lastBeat = Atomics.load(beat, 0), beatAt = now(), answerAt = now(), termAt = 0;
// straight to the log's file descriptor: a worker's process.stderr is relayed THROUGH the main thread - the very
// thread that is frozen - so a line written that way never arrives (the first battery run caught it)
const say = m => { try { require('fs').writeSync(2, 'watchdog: ' + m + '\\n'); } catch {} };
setInterval(async () => {
  const b = Atomics.load(beat, 0);
  if (b !== lastBeat) { lastBeat = b; beatAt = now(); }
  try { const r = await fetch('http://127.0.0.1:' + port + '/api/time', { signal: AbortSignal.timeout(Math.min(15000, Math.max(1000, checkMs))) }); if (r.ok) answerAt = now(); } catch {}
  const t = now();
  if (t - beatAt > stallMs) {
    say('the main thread has not run for ' + Math.round((t - beatAt) / 1000) + ' s - ending the process so PM2 starts it again');
    process.kill(pid, 'SIGKILL');
  } else if (t - answerAt > stallMs) {
    if (!termAt) { termAt = t; say('the server has not answered for ' + Math.round((t - answerAt) / 1000) + ' s - asking the process to stop so PM2 starts it again'); process.kill(pid, 'SIGTERM'); }
    else if (t - termAt > Math.max(30000, checkMs * 2)) { say('it did not stop - ending it'); process.kill(pid, 'SIGKILL'); }
  }
}, checkMs);
`;

/** server.js calls this once the port is listening. Never throws. */
function start(port) {
  try {
    if (started || process.env.BA_WATCHDOG_OFF === '1') return false;
    const { Worker } = require('worker_threads');
    const sab = new SharedArrayBuffer(4);
    const beat = new Int32Array(sab);
    setInterval(() => Atomics.add(beat, 0, 1), BEAT_MS).unref();
    const w = new Worker(WORKER, { eval: true, workerData: { sab, port: Number(port), stallMs: STALL_MS, checkMs: CHECK_MS, pid: process.pid } });
    w.unref();
    w.on('error', e => { try { console.error('watchdog stopped: ' + e.message); } catch {} });
    started = true;
    // a battery's way to freeze the main thread or deafen the server (test-watchdog only)
    if (process.env.BA_TEST_FREEZE_AFTER_MS) setTimeout(() => { for (;;) { /* frozen on purpose */ } }, Number(process.env.BA_TEST_FREEZE_AFTER_MS));
    return true;
  } catch (e) { try { console.error('watchdog not started: ' + e.message); } catch {} return false; }
}

module.exports = { start, STALL_MS, CHECK_MS };
