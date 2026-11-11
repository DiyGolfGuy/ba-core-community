'use strict';

// A bay PC that takes the connection and never answers must not hold up the
// scheduler: the command is ended at its time limit even when a helper process
// it started is still holding the command's pipes open.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('a bay PC command that hangs is answered at its time limit', { timeout: 20000 }, (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-net-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '..');
  fs.cpSync(path.join(source, 'services'), path.join(work, 'services'), { recursive: true });
  fs.copyFileSync(path.join(source, 'package.json'), path.join(work, 'package.json'));
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(work, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify({
    setup: { completed: true },
    bays: [{ id: 'bay-1', name: 'Bay One', active: true, simulatorPcIp: '127.0.0.1', simulatorWinUser: 'Admin', simulatorWinPass: 'fixture-pass' }],
  }));
  const bin = path.join(work, 'bin');
  fs.mkdirSync(bin);
  // The stand-in for Samba's `net`: a shell whose child keeps the inherited pipes open.
  fs.writeFileSync(path.join(bin, 'net'), '#!/bin/sh\nsleep 15\n', { mode: 0o755 });

  // A listener stands in for the PC's port 445, so the probe passes and the command runs.
  const script = `
    global._dbAutoSaveStarted = true;
    const pc = require('node:net').createServer(socket => socket.on('error', () => {})).listen(0, '127.0.0.1', () => {
      process.env.BA_PC_PROBE_PORT = String(pc.address().port);
      const started = Date.now();
      require('./services/db').initDb()
        .then(() => require('./services/simulator').sendShutdown(require('./services/config').getConfig().bays[0], 0))
        .then(result => { console.log(JSON.stringify({ result, ms: Date.now() - started })); process.exit(0); });
    });`;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: work, encoding: 'utf8', timeout: 12000,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, BA_PC_CMD_TIMEOUT_MS: '400',
      BA_DB_PATH: path.join(work, 'bookings.db') } });
  const { result, ms } = JSON.parse(out.trim().split('\n').at(-1));
  assert.equal(result.success, false);
  assert.match(result.error, /did not answer within/);
  assert.ok(ms < 5000, 'answered at the limit, not when the helper exits (took ' + ms + ' ms)');
});
