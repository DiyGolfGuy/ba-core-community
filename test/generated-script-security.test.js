const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('Session Monitor keeps facility strings out of executable Python and batch source', async t => {
  const bay = {
    id: 'bay"\\id',
    name: 'Bay "one" & echo UNWANTED\nraise RuntimeError("unwanted") & %TEMP%'
  };
  const businessName = 'Example "club"\nnew line — 名';
  const config = {
    bays: [bay],
    server: { businessName, port: 3001 },
    seo: { domain: 'https://example.test' },
    monitor: { warnMins: '10; raise RuntimeError("unwanted")' }
  };
  t.mock.method(require('../services/config'), 'getConfig', () => config);
  const { buildPackage } = require('../services/monitor-builder');
  const pkg = await buildPackage(bay.id);
  const files = Object.fromEntries(pkg.files.map(file => [file.name, file.content]));
  const python = files['session-monitor.py'];
  const batch = files['install-monitor.bat'];
  assert.doesNotMatch(python, /UNWANTED|raise RuntimeError|%TEMP%/);
  assert.doesNotMatch(batch, /UNWANTED|raise RuntimeError|%TEMP%/);

  const encoded = python.match(/base64\.b64decode\("([A-Za-z0-9+/=]+)"\)/)[1];
  const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  assert.equal(decoded.bayId, bay.id);
  assert.equal(decoded.bayName, bay.name);
  assert.equal(decoded.businessName, businessName);
  assert.equal(decoded.warnMins, 10);
  const parsed = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: python, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
});

test('backup script refuses non-origins and passes its token as URL data', t => {
  const { pullScript } = require('../services/backupvault');
  for (const unsafe of [
    'file:///tmp/unwanted',
    'https://person:password@example.test',
    'https://example.test/$(printf%20unwanted)',
    'https://example.test\x27',
    'https://example.test?test=1',
  ]) {
    assert.throws(() => pullScript('mac', unsafe, 'fake'), /HTTP or HTTPS origin/);
    assert.throws(() => pullScript('windows', unsafe, 'fake'), /HTTP or HTTPS origin/);
  }

  const fakeToken = "sample'; & $(printf injected)\nnext";
  const windows = pullScript('windows', 'https://example.test/', fakeToken);
  const expected = new URL('https://example.test/api/backup/pull');
  expected.searchParams.set('token', fakeToken);
  assert.ok(windows.includes("Invoke-WebRequest -Uri '" + expected.href + "'"));
  assert.ok(!windows.includes(fakeToken));

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ba script test '));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const trace = path.join(work, 'curl-args');
  const destination = path.join(work, 'BA-Backups');
  fs.mkdirSync(destination);
  for (let day = 1; day <= 31; day++) {
    fs.writeFileSync(path.join(destination, `offsite-backup-2000-01-${String(day).padStart(2, '0')}.baenc`), 'fake');
  }
  fs.writeFileSync(path.join(destination, 'offsite-backup-1999-01-01.txt'), 'keep this');
  fs.writeFileSync(path.join(work, 'curl'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$TRACE"\n', { mode: 0o700 });
  const mac = spawnSync('bash', [], {
    input: pullScript('mac', 'https://example.test/', fakeToken),
    env: { ...process.env, HOME: work, PATH: work + ':' + process.env.PATH, TRACE: trace },
    encoding: 'utf8',
  });
  assert.equal(mac.status, 0, mac.stderr || mac.error?.message);
  const args = fs.readFileSync(trace, 'utf8').split('\n');
  assert.equal(args.filter(arg => arg === expected.href).length, 1);
  assert.equal(fs.existsSync(path.join(destination, 'offsite-backup-2000-01-01.baenc')), false);
  assert.equal(fs.existsSync(path.join(destination, 'offsite-backup-2000-01-02.baenc')), true);
  assert.equal(fs.readFileSync(path.join(destination, 'offsite-backup-1999-01-01.txt'), 'utf8'), 'keep this');
});

test('Samba receives the password on fd 3 and redacts it even if diagnostics repeat it', async t => {
  const logs = [];
  t.mock.method(require('../services/db'), 'adminLog', (...entry) => logs.push(entry));
  const { sendRestart } = require('../services/simulator');
  const password = ' fake password & % ! ';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-net-test-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const envChanges = { PATH: work + ':' + process.env.PATH, PASSWD: 'unwanted', PASSWD_FILE: '/not-used',
    BA_TEST_NET_TRACE: path.join(work, 'net.json') };
  for (const [name, value] of Object.entries(envChanges)) {
    const old = process.env[name];
    process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
  fs.writeFileSync(path.join(work, 'net'), `#!${process.execPath}
const fs = require('node:fs');
const password = fs.readFileSync(Number(process.env.PASSWD_FD), 'utf8');
fs.writeFileSync(process.env.BA_TEST_NET_TRACE, JSON.stringify({
  args: process.argv.slice(2), password, overrides: [process.env.PASSWD, process.env.PASSWD_FILE],
}));
console.error('Simulated diagnostic ' + password.slice(0, -1));
process.exit(1);
`, { mode: 0o700 });

  assert.equal(await sendRestart({ name: 'Example Bay', simulatorPcIp: '192.0.2.42', simulatorWinUser: 'ExampleUser', simulatorWinPass: password }), false);
  const trace = JSON.parse(fs.readFileSync(envChanges.BA_TEST_NET_TRACE, 'utf8'));
  assert.ok(trace.args.includes('--user=ExampleUser'));
  assert.ok(trace.args.every(arg => !arg.includes(password)));
  assert.deepEqual(trace.overrides, [null, null]);
  assert.equal(trace.password, password + '\n');
  assert.equal(logs[0][0], 'RESTART_ERROR');
  assert.match(logs[0][1], /Simulated diagnostic \*{8}/);
  assert.ok(!logs[0][1].includes(password));
});
