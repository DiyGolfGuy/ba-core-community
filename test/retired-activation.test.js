'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { convert } = require('../services/importers');

test('a legacy backup cannot restore appliance activation or updater settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-legacy-backup-'));
  try {
    const config = path.join(dir, 'config.json');
    const owner = { adminAuth: { hash: 'owner-fixture' }, twofa: { enabled: true } };
    const stripe = { secretKey: 'payment-fixture' };
    const completedAt = '2024-01-02T03:04:05.000Z';
    fs.writeFileSync(config, JSON.stringify({
      setup: { completed: true, defaultPassword: 'retired-fixture', eula: { acceptedAt: completedAt } },
      server: { ...owner, bootstrapAuth: { hash: 'retired-fixture' } },
      stripe,
      updates: { autoCheck: true }
    }));

    convert(dir);
    assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')), {
      setup: { completed: true, completedAt },
      server: owner,
      stripe
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
