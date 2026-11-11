'use strict';

// A damaged config.json must leave the service running in setup mode so the
// owner can restore a backup. Under systemd a throw at boot is a restart loop.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('an unreadable config.json does not stop the boot-time settings scrub', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-config-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '..');
  fs.cpSync(path.join(source, 'services'), path.join(work, 'services'), { recursive: true });
  fs.copyFileSync(path.join(source, 'package.json'), path.join(work, 'package.json'));
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(work, 'node_modules'), 'dir');
  const damaged = '{"server": {"businessName": "Example Indoor Golf"';
  fs.writeFileSync(path.join(work, 'config.json'), damaged);

  const out = execFileSync(process.execPath, ['-e', `
    const config = require('./services/config');
    config.scrubLegacySettings();
    console.log(JSON.stringify({ completed: !!config.getConfig().setup?.completed }));`],
    { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.deepEqual(JSON.parse(out.trim().split('\n').at(-1)), { completed: false });
  assert.equal(fs.readFileSync(path.join(work, 'config.json'), 'utf8'), damaged, 'the damaged file is left for the owner to inspect');
});
