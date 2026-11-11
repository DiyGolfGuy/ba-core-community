'use strict';

// install.sh cannot run for real here (it needs root, systemd and a Pi), so this
// drives the shipped script against a throwaway root: its absolute paths are
// rewritten into a temp directory and the system commands it calls are stand-ins
// that record what they were asked. The script's own logic - a fresh install, a
// repeat run, an upgrade that keeps the facility's files, and a failed upgrade
// putting the earlier version back - runs unchanged.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const source = path.resolve(__dirname, '..');
const bash = spawnSync('bash', ['-c', 'command -v flock && command -v cmp && command -v find']).status === 0;

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-installer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'stubs');
  fs.mkdirSync(bin);
  const log = path.join(root, 'commands.log');
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/bin/bash\necho "' + name + ' $*" >> "' + log + '"\n' + body + '\n', { mode: 0o755 });
  stub('uname', 'echo aarch64');
  stub('dpkg', 'echo arm64');
  stub('apt-get', '[ -f "' + root + '/python-packages-available" ] && [[ "$*" == *python3-broadlink* ]] && touch "' + root + '/python-modules"; exit 0');
  stub('ss', 'exit 0');
  stub('id', 'exit 1');
  stub('useradd', 'exit 0');
  stub('chown', 'exit 0');
  stub('sleep', 'exit 0');
  stub('runuser', 'while [ "$1" != "--" ]; do shift; done; shift; exec "$@"');
  stub('python3', '[ -f "' + root + '/python-modules" ]');
  // `install` without the ownership a throwaway root cannot grant
  stub('install', 'args=(); while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac; done; exec /usr/bin/install "${args[@]}"');
  stub('systemctl', `state="${root}/service-running"
case "$1" in
  cat) [ -f "${root}/etc/systemd/system/ba-core.service" ];;
  is-active) [ -f "$state" ];;
  stop) [[ "$*" == *ba-core.service* ]] && rm -f "$state"; exit 0;;
  start|restart) [[ "$*" == *ba-core.service* ]] && touch "$state"; exit 0;;
  enable) [[ "$*" == *--now* && "$*" == *ba-core.service* ]] && touch "$state"; exit 0;;
  *) exit 0;;
esac`);
  // The health probe answers from the code that is installed: a release whose server.js says BROKEN never comes up.
  stub('curl', `if grep -q BROKEN "${root}/var/lib/ba-core/app/server.js" 2>/dev/null; then exit 22; fi
echo '{"local":true,"setup_complete":false,"lan_ready":false}'`);
  // The pinned Node: answers the installer's checks, and "installs" dependencies by leaving a marker.
  const nodeDir = path.join(root, 'opt/ba-core/node-v26.13.0/bin');
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, 'node'), `#!/bin/bash
case "$1" in
  --version) echo v26.13.0;;
  -p) if [ "$2" = "process.arch" ]; then echo arm64; else exec "${process.execPath}" "$@"; fi;;
  */npm-cli.js) mkdir -p node_modules && echo installed > node_modules/.installed;;
  *) exec "${process.execPath}" "$@";;
esac
`, { mode: 0o755 });
  return { root, bin, log };
}

function release(box, name, files) {
  const dir = path.join(box.root, name, 'ba-core');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  fs.mkdirSync(path.join(dir, 'packaging'), { recursive: true });
  for (const unit of ['ba-core.service', 'ba-core-broadlink.service', 'ba-core-mcp']) {
    fs.copyFileSync(path.join(source, 'packaging', unit), path.join(dir, 'packaging', unit));
  }
  const script = fs.readFileSync(path.join(source, 'install.sh'), 'utf8')
    .replaceAll('/var/lib/ba-core', box.root + '/var/lib/ba-core')
    .replaceAll('/opt/ba-core', box.root + '/opt/ba-core')
    .replaceAll('/etc/systemd/system', box.root + '/etc/systemd/system')
    .replaceAll('/usr/local/lib/ba-core', box.root + '/usr/local/lib/ba-core')
    .replaceAll('/usr/local/bin/ba-core-mcp', box.root + '/usr/local/bin/ba-core-mcp')
    .replaceAll('/run/ba-core-install.lock', box.root + '/install.lock')
    .replace('[[ $EUID == 0 ]]', 'true')
    .replace('[[ -d /run/systemd/system ]]', 'true');
  const outside = script.split('\n').filter(line => /\/(var\/lib\/ba-core|opt\/ba-core|etc\/systemd\/system|usr\/local\/(lib|bin)\/ba-core|run\/ba-core)/.test(line.replaceAll(box.root + '/', '')));
  assert.deepEqual(outside, [], 'every system path was moved into the throwaway root');
  fs.writeFileSync(path.join(dir, 'install.sh'), script, { mode: 0o755 });
  return dir;
}

function run(box, dir) {
  for (const sub of ['var/lib', 'etc/systemd/system', 'usr/local/lib', 'usr/local/bin']) fs.mkdirSync(path.join(box.root, sub), { recursive: true });
  return spawnSync('bash', [path.join(dir, 'install.sh')], { encoding: 'utf8', env: { ...process.env, PATH: box.bin + path.delimiter + process.env.PATH } });
}

const manifest = version => JSON.stringify({ name: 'ba-core-community', version, engines: { node: '26.13.0' } });
const base = {
  'server.js': '// release one\n',
  'package.json': manifest('2.0.0'),
  'package-lock.json': '{}',
  'broadlink-bridge.py': '# bridge\n',
  'public/index.html': '<p>one</p>',
  'public/retired.js': '// gone in release two',
  'routes/old-route.js': '// gone in release two',
  'services/installed-guides.js': '// reader one\n',
  'mcp/ba-core-mcp.js': '// bridge one\n',
  'docs/customer-guides-current/OPERATING-GUIDE.md': '# Operate\n',
  'docs/customer-guides-current/OLD-GUIDE.md': '# Old\n',
};
const next = {
  'server.js': '// release two\n',
  'package.json': manifest('2.1.0'),
  'package-lock.json': '{"two":true}',
  'broadlink-bridge.py': '# bridge\n',
  'public/index.html': '<p>two</p>',
  'routes/new-route.js': '// new in release two',
  'services/installed-guides.js': '// reader two\n',
  'mcp/ba-core-mcp.js': '// bridge two\n',
  'docs/customer-guides-current/OPERATING-GUIDE.md': '# Operate, revised\n',
};

// What a running facility leaves in its app directory.
function addFacilityData(app) {
  const data = {
    'config.json': '{"server":{"businessName":"Example Indoor Golf"}}',
    'bookings.db': 'database bytes',
    'owner-ai-secrets.json': '{"provider":"anthropic"}',
    'backups/nightly/2026-11-01.zip': 'backup bytes',
    'waivers/2026/signed.pdf': 'waiver bytes',
    'public/uploads/landing/hero.jpg': 'photo bytes',
    'public/icons/icon-192.png': 'icon bytes',
    'public/staff-icon.png': 'staff icon bytes',
    'tunnel/config.yml': 'tunnel: example',
    '.owner-note': 'kept',
  };
  for (const [file, content] of Object.entries(data)) {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    fs.writeFileSync(path.join(app, file), content);
  }
  fs.chmodSync(path.join(app, 'owner-ai-secrets.json'), 0o600);
  return data;
}

test('install.sh installs, repeats harmlessly, upgrades keeping the facility\'s files, and undoes a failed upgrade', { skip: bash ? false : 'needs bash, flock, cmp and find', timeout: 120000 }, (t) => {
  const box = sandbox(t);
  const app = path.join(box.root, 'var/lib/ba-core/app');
  const lib = path.join(box.root, 'usr/local/lib/ba-core');
  const read = file => fs.readFileSync(file, 'utf8');
  const commands = () => (fs.existsSync(box.log) ? read(box.log) : '');

  // A fresh install: the app, its dependencies, the service and the diagnostics files; BroadLink left idle without its packages.
  const one = release(box, 'release-one', base);
  const fresh = run(box, one);
  assert.equal(fresh.status, 0, fresh.stderr + fresh.stdout);
  assert.equal(read(path.join(app, 'server.js')), base['server.js']);
  assert.ok(fs.existsSync(path.join(app, 'node_modules/.installed')));
  assert.ok(fs.existsSync(path.join(box.root, 'etc/systemd/system/ba-core.service')));
  assert.equal(read(path.join(lib, 'ba-core-mcp.js')), base['mcp/ba-core-mcp.js']);
  assert.ok(fs.existsSync(path.join(lib, 'guides/OLD-GUIDE.md')));
  assert.match(fresh.stdout, /BroadLink IR is not available/);
  assert.ok(!fs.existsSync(path.join(box.root, 'etc/systemd/system/ba-core-broadlink.service')));
  assert.match(fresh.stdout, /BA Core is running/);

  // The same release again changes nothing.
  const data = addFacilityData(app);
  const before = read(path.join(app, 'server.js'));
  const again = run(box, one);
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.match(again.stdout, /already installed/);
  assert.equal(read(path.join(app, 'server.js')), before);
  assert.ok(!fs.readdirSync(path.join(box.root, 'var/lib/ba-core')).some(name => name.startsWith('app.previous')));

  // A release that does not start is undone: the earlier code and every facility file are back, and the run fails loudly.
  const broken = release(box, 'release-broken', { ...next, 'server.js': '// BROKEN release\n' });
  const failed = run(box, broken);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /upgrade was undone/);
  assert.equal(read(path.join(app, 'server.js')), base['server.js']);
  assert.equal(read(path.join(lib, 'ba-core-mcp.js')), base['mcp/ba-core-mcp.js'], 'the diagnostics files went back too');
  for (const [file, content] of Object.entries(data)) assert.equal(read(path.join(app, file)), content, file + ' survived the failed upgrade');
  assert.ok(fs.existsSync(path.join(box.root, 'service-running')), 'the earlier version was started again');

  // The upgrade: new code in, removed files gone, every facility file byte for byte, modes kept, BroadLink enabled once its packages exist.
  fs.writeFileSync(path.join(box.root, 'python-packages-available'), '');
  const two = release(box, 'release-two', next);
  const upgraded = run(box, two);
  assert.equal(upgraded.status, 0, upgraded.stderr + upgraded.stdout);
  assert.match(upgraded.stdout, /upgraded from 2\.0\.0 to 2\.1\.0/);
  assert.equal(read(path.join(app, 'server.js')), next['server.js']);
  assert.equal(read(path.join(app, 'public/index.html')), next['public/index.html']);
  assert.ok(fs.existsSync(path.join(app, 'routes/new-route.js')));
  assert.ok(!fs.existsSync(path.join(app, 'routes/old-route.js')), 'a route the new release dropped is gone');
  assert.ok(!fs.existsSync(path.join(app, 'public/retired.js')), 'a page script the new release dropped is gone');
  assert.ok(fs.existsSync(path.join(app, 'node_modules/.installed')));
  for (const [file, content] of Object.entries(data)) assert.equal(read(path.join(app, file)), content, file + ' survived the upgrade');
  assert.equal(fs.statSync(path.join(app, 'owner-ai-secrets.json')).mode & 0o777, 0o600);
  assert.equal(read(path.join(lib, 'ba-core-mcp.js')), next['mcp/ba-core-mcp.js']);
  assert.equal(read(path.join(lib, 'guides/OPERATING-GUIDE.md')), next['docs/customer-guides-current/OPERATING-GUIDE.md']);
  assert.ok(!fs.existsSync(path.join(lib, 'guides/OLD-GUIDE.md')), 'a guide the new release dropped is gone');
  assert.ok(fs.existsSync(path.join(box.root, 'etc/systemd/system/ba-core-broadlink.service')));
  assert.match(commands(), /systemctl enable ba-core-broadlink\.service/);

  // One earlier version is kept, whole, with its own copy of the settings; the failed attempt's leftovers are cleared.
  const kept = fs.readdirSync(path.join(box.root, 'var/lib/ba-core'));
  const previous = kept.filter(name => name.startsWith('app.previous-'));
  assert.equal(previous.length, 1);
  assert.equal(kept.filter(name => name.startsWith('app.failed-')).length, 0);
  assert.equal(kept.filter(name => name.startsWith('.upgrade-')).length, 1);
  const earlier = path.join(box.root, 'var/lib/ba-core', previous[0]);
  assert.equal(read(path.join(earlier, 'server.js')), base['server.js']);
  assert.equal(read(path.join(earlier, 'config.json')), data['config.json']);
  // config.json is a real copy: a change made by the new version must not reach the earlier one.
  fs.appendFileSync(path.join(app, 'config.json'), ' ');
  assert.equal(read(path.join(earlier, 'config.json')), data['config.json']);
});
