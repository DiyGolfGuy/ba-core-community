'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { hasPrototypeKeys } = require('../services/object-keys');

const source = path.resolve(__dirname, '..');

test('nested prototype keys cannot enter a configuration through a file or merge', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-config-keys-'));
  try {
    const services = path.join(dir, 'services');
    fs.mkdirSync(services);
    for (const file of ['config.js', 'object-keys.js']) fs.copyFileSync(path.join(source, 'services', file), path.join(services, file));
    const config = require(path.join(services, 'config.js'));
    const incoming = JSON.parse('{"server":{"businessName":"Fixture Facility","__proto__":{"privileged":true}},"bays":[{"name":"Bay One","constructor":{"prototype":{"privileged":true}}}]}');
    assert.equal(hasPrototypeKeys(incoming), true);
    fs.writeFileSync(config.CONFIG_PATH, JSON.stringify(incoming));
    const loaded = config.getConfig();
    assert.equal(loaded.server.businessName, 'Fixture Facility');
    assert.equal(loaded.server.privileged, undefined);
    assert.equal(hasPrototypeKeys(loaded), false);

    config.saveConfig(JSON.parse('{"bays":[{"name":"Bay Two","prototype":{"privileged":true}}],"__proto__":{"privileged":true}}'));
    const saved = JSON.parse(fs.readFileSync(config.CONFIG_PATH));
    assert.equal(saved.bays[0].name, 'Bay Two');
    assert.equal(saved.server.businessName, 'Fixture Facility');
    assert.equal(hasPrototypeKeys(saved), false);
    assert.equal(Object.prototype.privileged, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backup metadata quotes schema identifiers and safely stores reserved object keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-backup-identifiers-'));
  const autosaveStarted = global._dbAutoSaveStarted;
  try {
    // This isolated check writes synchronously while creating its backup.
    global._dbAutoSaveStarted = true;
    fs.cpSync(path.join(source, 'services'), path.join(dir, 'services'), { recursive: true });
    fs.copyFileSync(path.join(source, 'package.json'), path.join(dir, 'package.json'));
    fs.symlinkSync(path.join(source, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const db = require(path.join(dir, 'services', 'db.js'));
    await db.initDb();
    const table = 'weird"); DROP TABLE bookings; --';
    const identifier = '"' + table.replace(/"/g, '""') + '"';
    db.db.exec(`CREATE TABLE ${identifier} (example TEXT)`);
    db.db.prepare(`INSERT INTO ${identifier} (example) VALUES (?)`).run('fixture');
    db.db.exec('CREATE TABLE "__proto__" (example TEXT)');
    const archive = await require(path.join(dir, 'services', 'backup.js')).createBackup();
    const manifest = JSON.parse(execFileSync('unzip', ['-p', archive, 'backup.json'], { encoding: 'utf8' }));
    assert.deepEqual(manifest.schema.tables[table], ['example']);
    assert.equal(manifest.rows[table], 1);
    assert.equal(Object.hasOwn(manifest.schema.tables, '__proto__'), true);
    assert.deepEqual(manifest.schema.tables.__proto__, ['example']);
    assert.equal(manifest.rows.__proto__, 0);
    assert.ok(db.db.prepare('SELECT COUNT(*) AS n FROM bookings').get());
  } finally {
    if (autosaveStarted === undefined) delete global._dbAutoSaveStarted;
    else global._dbAutoSaveStarted = autosaveStarted;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
