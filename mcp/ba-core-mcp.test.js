'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { test } = require('node:test');
const { inspectHealth, readLocalHttp, readService, serve } = require('./ba-core-mcp');

test('service probe runs fixed systemctl arguments and returns only allowed states', async () => {
  const run = async (file, args, options) => {
    assert.equal(file, '/usr/bin/systemctl');
    assert.deepEqual(args, [
      '--no-pager', 'show', '--property=LoadState', '--property=ActiveState', 'ba-core.service',
    ]);
    assert.equal(options.timeout, 2000);
    assert.equal(options.env.PATH, '/usr/bin:/bin');
    return { stdout: 'LoadState=loaded\nActiveState=active\nEnvironment=EXAMPLE_SECRET' };
  };
  assert.equal(await readService('ba-core.service', run), 'active');
  assert.equal(await readService('cloudflared.service', async () => {
    throw Object.assign(new Error('EXAMPLE_SECRET'), { stdout: 'LoadState=not-found\nActiveState=inactive' });
  }), 'not-installed');
  assert.equal(await readService('ba-core.service', async () => ({
    stdout: 'LoadState=loaded\nActiveState=EXAMPLE_SECRET',
  })), 'unknown');
});

test('HTTP probe reads only the loopback status and ignores the response body', async () => {
  let closed = false;
  const request = (options, reply) => {
    assert.equal(options.hostname, '127.0.0.1');
    assert.equal(options.port, 3001);
    assert.equal(options.path, '/');
    assert.equal(options.method, 'HEAD');
    assert.equal(options.agent, false);
    const req = new EventEmitter();
    req.end = () => reply({ statusCode: 302, destroy() { closed = true; } });
    return req;
  };
  assert.equal(await readLocalHttp(request), 302);
  assert.equal(closed, true);
  assert.equal(await readLocalHttp(() => {
    const req = new EventEmitter();
    req.end = () => req.emit('error', new Error('EXAMPLE_SECRET'));
    return req;
  }), null);
});

test('health checks only BA Core, cloudflared and local HTTP', async () => {
  const units = [];
  const result = await inspectHealth(async unit => {
    units.push(unit);
    return unit === 'ba-core.service' ? 'active' : 'not-installed';
  }, async () => 200);
  assert.deepEqual(units, ['ba-core.service', 'cloudflared.service']);
  assert.deepEqual(result, { baCore: 'active', cloudflared: 'not-installed', localHttpStatus: 200 });
});

async function simulate(requests, inspect) {
  const input = Readable.from(requests.map(request => (
    (typeof request === 'string' ? request : JSON.stringify({ jsonrpc: '2.0', ...request })) + '\n'
  )));
  let buffer = '';
  const output = new Writable({
    write(chunk, _encoding, callback) { buffer += chunk.toString(); callback(); },
  });
  await serve(input, output, inspect);
  return buffer.trim().split('\n').map(line => JSON.parse(line));
}

test('stdio negotiates a version and lists the bounded owner tools', async () => {
  let calls = 0;
  const messages = await simulate([
    '{EXAMPLE_SECRET',
    { id: 1, method: 'tools/list' },
    { id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { method: 'notifications/initialized' },
    { id: 3, method: 'tools/list' },
    { id: 4, method: 'tools/call', params: { name: 'run', arguments: { command: 'EXAMPLE_SECRET' } } },
    { id: 5, method: 'tools/call', params: { name: 'get_service_health', arguments: { host: 'EXAMPLE_SECRET' } } },
    { id: 6, method: 'tools/call', params: { name: 'get_service_health' } },
    { id: 7, method: 'unknown' },
  ], async () => {
    calls++;
    return { baCore: 'active', cloudflared: 'not-installed', localHttpStatus: 200 };
  });
  assert.deepEqual(messages.map(message => message.id), [null, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(messages[0].error.code, -32700);
  assert.equal(messages[1].error.code, -32000);
  assert.equal(messages[2].result.protocolVersion, '2025-06-18');
  assert.deepEqual(messages[3].result.tools.map(tool => tool.name),
    ['get_service_health', 'prepare_booking_settings', 'search_owner_guides', 'read_owner_guide',
      'list_owner_actions', 'describe_owner_action', 'prepare_action']);
  assert.equal(messages[3].result.tools[0].annotations.readOnlyHint, true);
  assert.equal(messages[4].error.code, -32602);
  assert.equal(messages[5].error.code, -32602);
  assert.deepEqual(JSON.parse(messages[6].result.content[0].text), {
    baCore: 'active', cloudflared: 'not-installed', localHttpStatus: 200,
  });
  assert.equal(messages[7].error.code, -32601);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(messages), /EXAMPLE_SECRET/);
});

test('the SSH connector searches installed guides and reads only a known guide', async () => {
  const calls = [
    { name: 'search_owner_guides', arguments: { query: 'UniFi Access keypad' } },
    { name: 'read_owner_guide', arguments: { file: 'SERVICE-SETUP.md' } },
    { name: 'read_owner_guide', arguments: { file: 'SERVICE-SETUP.md', offset: 6000 } },
    { name: 'read_owner_guide', arguments: { file: '../../config.json' } },
  ];
  const messages = await simulate([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    ...calls.map((params, index) => ({ id: index + 2, method: 'tools/call', params })),
  ]);
  const [search, first, second] = messages.slice(1, 4).map(message => JSON.parse(message.result.content[0].text));
  assert.ok(search.some(section => section.file === 'SERVICE-SETUP.md' && section.heading === 'UniFi Access'));
  assert.equal(first.nextOffset, 6000);
  assert.notEqual(first.text, second.text);
  assert.equal(messages[4].result.isError, true);
  assert.doesNotMatch(messages[4].result.content[0].text, /config\.json/);
});

test('booking proposal prepares only a verbatim copyable line without probing the Pi', async () => {
  const invoke = (id, args) => ({
    id, method: 'tools/call', params: { name: 'prepare_booking_settings', arguments: args },
  });
  const messages = await simulate([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    invoke(2, { pricePerHalfHour: 19.99 }),
    invoke(3, { openTime: '20:00', closeTime: '02:30' }),
    invoke(4, { pricePerHalfHour: 10_000, closeTime: '22:00', openTime: '09:00' }),
    invoke(5, { pricePerHalfHour: 0 }),
  ], () => assert.fail('Preparing a proposal must not read live state'));
  assert.deepEqual(messages.slice(1).map(message => message.result.content[0].text), [
    'BA-CORE-PROPOSAL {"pricePerHalfHour":19.99}',
    'BA-CORE-PROPOSAL {"openTime":"20:00","closeTime":"02:30"}',
    'BA-CORE-PROPOSAL {"openTime":"09:00","closeTime":"22:00","pricePerHalfHour":10000}',
    'BA-CORE-PROPOSAL {"pricePerHalfHour":0}',
  ]);
});

test('booking proposal rejects partial hours, unsupported inputs and unsafe amounts', async () => {
  const invalid = [
    undefined, null, [], {}, { openTime: '09:00' }, { closeTime: '22:00', pricePerHalfHour: 30 },
    { openTime: '9:00', closeTime: '22:00' }, { openTime: '09:00', closeTime: '24:00' },
    { openTime: '09:00', closeTime: '09:00' },
    { openTime: '09:00\n', closeTime: '22:00' }, { openTime: '09:60', closeTime: '22:00' },
    { openTime: 9, closeTime: '22:00' }, { pricePerHalfHour: '19.99' },
    { pricePerHalfHour: 10000.01 }, { pricePerHalfHour: -1 }, { pricePerHalfHour: 1.235 },
    { pricePerHalfHour: 30, destination: 'EXAMPLE_SECRET' },
  ];
  const messages = await simulate([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    ...invalid.map((args, i) => ({
      id: i + 2, method: 'tools/call', params: { name: 'prepare_booking_settings', arguments: args },
    })),
  ], () => assert.fail('Invalid proposal must not read live state'));
  assert.equal(messages.length, invalid.length + 1);
  for (const message of messages.slice(1)) assert.equal(message.result.isError, true);
  assert.doesNotMatch(JSON.stringify(messages), /EXAMPLE_SECRET|BA-CORE-PROPOSAL/);
});

test('unexpected failures are safe and contain no raw diagnostics', async () => {
  const messages = await simulate([
    { id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
    { id: 2, method: 'tools/call', params: { name: 'get_service_health', arguments: {} } },
  ], async () => { throw new Error('EXAMPLE_SECRET'); });
  assert.equal(messages[0].result.protocolVersion, '2025-11-25');
  assert.equal(messages[1].result.isError, true);
  assert.doesNotMatch(JSON.stringify(messages), /EXAMPLE_SECRET/);
});

test('an AI client can find an Assistant action and prepare it as a line the owner pastes, and nothing more', async () => {
  const messages = await simulate([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { id: 2, method: 'tools/call', params: { name: 'list_owner_actions', arguments: { area: 'menu', query: 'add items' } } },
    { id: 3, method: 'tools/call', params: { name: 'describe_owner_action', arguments: { name: 'menu_items_add' } } },
    { id: 4, method: 'tools/call', params: { name: 'prepare_action', arguments: { name: 'menu_items_add', args: { part: 'Drinks', items: [{ name: 'Root Beer', price: 3 }] } } } },
    { id: 5, method: 'tools/call', params: { name: 'prepare_action', arguments: { name: 'update_install', args: {} } } },
    { id: 6, method: 'tools/call', params: { name: 'prepare_action', arguments: { name: 'menu_items_add', args: { part: 'Drinks' } } } },
    { id: 7, method: 'tools/call', params: { name: 'prepare_action', arguments: { name: 'menu_items_add', args: { part: 'Drinks', items: [], shell: 'EXAMPLE_SECRET' } } } },
    { id: 8, method: 'tools/call', params: { name: 'describe_owner_action', arguments: { name: 'ai_service_set' } } },
    { id: 9, method: 'tools/call', params: { name: 'list_owner_actions', arguments: { run: 'EXAMPLE_SECRET' } } },
  ], async () => assert.fail('The action tools never probe the Pi'));
  const text = index => messages[index].result.content[0].text;
  const listed = JSON.parse(text(1));
  assert.ok(listed.actions.some(action => action.name === 'menu_items_add' && action.changes === true));
  assert.ok(Object.hasOwn(listed.areas, 'menu'));
  assert.ok(listed.actions.length <= 40);
  const described = JSON.parse(text(2));
  assert.deepEqual(described.params.required, ['part', 'items']);
  assert.equal(text(3), 'BA-CORE-ACTION {"name":"menu_items_add","args":{"part":"Drinks","items":[{"name":"Root Beer","price":3}]}}');
  for (const index of [4, 5, 6, 7, 8]) assert.equal(messages[index].result.isError, true, 'request ' + (index + 1) + ' is refused');
  assert.doesNotMatch(JSON.stringify(messages), /EXAMPLE_SECRET/);
});

test('the bridge\'s action list matches the Assistant\'s own, with no updater or key-setting action in it', () => {
  const { catalogue, file } = require('../scripts/gen-owner-actions');
  const shipped = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  assert.deepEqual(shipped, JSON.parse(JSON.stringify(catalogue())), 'run node scripts/gen-owner-actions.js after changing an action');
  assert.ok(shipped.actions.length > 250);
  assert.ok(!shipped.actions.some(action => /^updates?_|^ai_service_set$|^texts_signed_as_set$/.test(action.name)));
});
