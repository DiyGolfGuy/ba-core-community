'use strict';

// The Assistant on a hosted model, end to end: the connection comes from the
// owner's private Hosted AI settings file, the model's tool call becomes a
// proposal, and only the owner's own signed-in request changes anything.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: pause } = require('node:timers/promises');

const source = path.resolve(__dirname, '..');
const apiKey = 'sk-proj-fixtureassistantkey0123456789';
const ownerPassword = 'fixture-owner-password-1';

function request(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: text, json });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

// A stand-in for the provider: records what it was sent and answers from a script.
async function provider(script) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const answer = script(req, body, calls.length);
      res.writeHead(answer.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer.json));
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { calls, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}

async function boot(directory, port, env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: directory, stdio: 'ignore',
    env: { ...process.env, BA_CORE_COMMUNITY: '1', BA_DISABLE_SCHEDULER: '1', ...env } });
  for (let i = 0; i < 200 && child.exitCode === null; i++) {
    try { await request(port, '/api/time'); return child; } catch { await pause(50); }
  }
  child.kill('SIGKILL');
  assert.fail('The disposable BA Core service did not start');
}

function fixture(connection) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-assistant-'));
  for (const item of ['server.js', 'package.json', 'public', 'routes', 'services', 'scripts', 'templates', 'docs']) {
    fs.cpSync(path.join(source, item), path.join(directory, item), { recursive: true });
  }
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  if (connection) fs.writeFileSync(path.join(directory, 'owner-ai-secrets.json'), JSON.stringify(connection) + '\n', { mode: 0o600 });
  return directory;
}

async function signIn(port) {
  const login = await request(port, '/api/auth/admin/login', { method: 'POST', body: { password: ownerPassword } });
  assert.equal(login.status, 200, login.body);
  return { Cookie: login.headers['set-cookie'][0].split(';')[0], 'X-CSRF': login.json.csrf };
}

test('a hosted model proposes through the Assistant and only the owner applies', { timeout: 60000 }, async (t) => {
  const toolCall = { id: 'call_1', type: 'function', function: { name: 'menu_items_add',
    arguments: JSON.stringify({ part: 'Drinks', items: [{ name: 'Sarsaparilla', price: 3 }] }) } };
  const openai = await provider((req, body, n) => {
    if (req.method === 'GET') return { json: { data: [{ id: 'gpt-fixture' }] } };
    const last = body.messages.at(-1);
    if (last.role === 'tool') return { json: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Sarsaparilla is on the menu now.' } }] } };
    if (last.role === 'user' && /sarsaparilla soda/i.test(String(last.content))) return { json: { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [toolCall] } }] } };
    return { json: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello. What would you like to change?' } }] } };
  });
  const port = await freePort();
  const directory = fixture({ provider: 'openai', apiKey, model: 'gpt-fixture', workspaceId: '', effort: null, maxOutputTokens: null, reasoningMode: null });
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    server: { port, businessName: 'Example Indoor Golf', adminPassword: ownerPassword },
    setup: { completed: true, completedAt: new Date().toISOString() },
    bays: [{ id: 'bay-1', name: 'Bay 1', active: true }],
  }));
  const child = await boot(directory, port, { BA_TEST_OPENAI_URL: openai.url });
  t.after(async () => { child.kill('SIGKILL'); await openai.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  const owner = await signIn(port);
  assert.equal((await request(port, '/api/admin/assistant/status')).status, 401);

  const status = await request(port, '/api/admin/assistant/status', { headers: owner });
  assert.equal(status.status, 200, status.body);
  assert.equal(status.json.model.connected, true);
  assert.equal(status.json.model.provider, 'openai');
  assert.equal(status.json.model.model, 'gpt-fixture');
  assert.equal(status.json.voice, false);
  assert.ok(!status.body.includes(apiKey));
  assert.match(status.json.model.where, /first name and last initial/);

  const category = await request(port, '/api/pos/menu/category', { method: 'POST', headers: owner,
    body: { name: 'Drinks', printer_role: 'bar', tax_category: 'beverage' } });
  assert.equal(category.status, 200, category.body);

  const applier = require('../public/assistant-apply.js').create({
    api: async (method, pathname, body) => {
      const r = await request(port, pathname, { method, headers: owner, body });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.json };
    },
    layout: require('../public/site-layout.js'),
  });
  const menu = async () => (await request(port, '/api/pos/menu?all=1', { headers: owner })).body;
  const posts = () => openai.calls.filter(call => call.method === 'POST');

  // A plain request is read by the unit itself: a proposal with no call to the provider, and nothing written yet.
  const plain = await request(port, '/api/admin/assistant/turn', { method: 'POST', headers: owner,
    body: { text: 'Add Root Beer for $3 to Drinks.' } });
  assert.equal(plain.status, 200, plain.body);
  assert.equal(plain.json.proposals.length, 1, plain.body);
  assert.equal(plain.json.proposals[0].action, 'menu_items_add');
  assert.equal(posts().length, 0);
  assert.ok(!/Root Beer/.test(await menu()));

  // The page applies the proposal with the owner's own session, through the ordinary route.
  const first = await applier.apply(plain.json.proposals[0].request);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.match(await menu(), /Root Beer/);

  // A request in the owner's own roundabout words goes to the hosted model, which answers with a tool call.
  const turn = await request(port, '/api/admin/assistant/turn', { method: 'POST', headers: owner,
    body: { conversation: plain.json.conversation, text: 'My cousin keeps asking for that old-time sarsaparilla soda - can the drinks list carry one, $3 a glass?' } });
  assert.equal(turn.status, 200, turn.body);
  assert.equal(turn.json.proposals.length, 1, turn.body);
  const proposal = turn.json.proposals[0];
  assert.equal(proposal.action, 'menu_items_add');

  // The provider got the owner's key as a Bearer token, the tools, and no sampling settings; nothing wrote yet.
  const sent = posts()[0];
  assert.ok(sent, 'the hosted model was asked');
  assert.equal(sent.url, '/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer ' + apiKey);
  assert.equal(sent.body.model, 'gpt-fixture');
  assert.ok(sent.body.tools.some(tool => tool.function.name === 'menu_items_add'));
  assert.ok(!sent.body.tools.some(tool => /^update|^ai_service_set$/.test(tool.function.name)));
  for (const field of ['temperature', 'top_p', 'top_k', 'max_tokens']) assert.equal(sent.body[field], undefined);
  assert.ok(sent.body.max_completion_tokens >= 8192);
  assert.ok(!JSON.stringify(sent.body).includes(apiKey));
  assert.ok(!/Sarsaparilla/.test(await menu()));

  const result = await applier.apply(proposal.request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(await menu(), /Sarsaparilla/);

  const applied = await request(port, '/api/admin/assistant/applied', { method: 'POST', headers: owner,
    body: { conversation: turn.json.conversation, results: [{ id: proposal.id, ok: true, result: result.data || 'ok' }] } });
  assert.equal(applied.status, 200, applied.body);

  // A key pasted by mistake is caught by shape and never reaches the model.
  const pasted = await request(port, '/api/admin/assistant/turn', { method: 'POST', headers: owner,
    body: { conversation: turn.json.conversation, text: 'here is my key sk-proj-anotherfixturekey9876543210 please remember it for the winter league idea' } });
  assert.ok(pasted.status === 200 || pasted.status === 400, pasted.body);
  assert.ok(!JSON.stringify(openai.calls).includes('sk-proj-anotherfixturekey9876543210'));

  // The key is in the private file only: not in config.json, the conversation, or any reply.
  assert.ok(!fs.readFileSync(path.join(directory, 'config.json'), 'utf8').includes(apiKey));
  for (const reply of [plain.body, turn.body, applied.body, pasted.body]) assert.ok(!reply.includes(apiKey));
});

test('with no model connected the Assistant still reads plain requests and says where to connect one', { timeout: 60000 }, async (t) => {
  const port = await freePort();
  const directory = fixture(null);
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    server: { port, businessName: 'Example Indoor Golf', adminPassword: ownerPassword },
    setup: { completed: true, completedAt: new Date().toISOString() },
    bays: [{ id: 'bay-1', name: 'Bay 1', active: true }],
    // a key left in an older config is dropped at boot, never used
    assistant: { enabled: true, provider: 'openai', apiKey, cloudModel: 'gpt-fixture' },
  }));
  const child = await boot(directory, port, { BA_TEST_OPENAI_URL: 'http://127.0.0.1:9' });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(directory, { recursive: true, force: true }); });
  const owner = await signIn(port);

  const status = await request(port, '/api/admin/assistant/status', { headers: owner });
  assert.equal(status.json.model.connected, false);
  assert.equal(status.json.model.configured, false);
  assert.match(status.json.model.connect, /Hosted AI settings/);
  assert.ok(!fs.readFileSync(path.join(directory, 'config.json'), 'utf8').includes(apiKey), 'the old key was dropped from config.json');

  const category = await request(port, '/api/pos/menu/category', { method: 'POST', headers: owner,
    body: { name: 'Drinks', printer_role: 'bar', tax_category: 'beverage' } });
  assert.equal(category.status, 200, category.body);
  const plain = await request(port, '/api/admin/assistant/turn', { method: 'POST', headers: owner,
    body: { text: 'Add Root Beer for $3 to Drinks.' } });
  assert.equal(plain.status, 200, plain.body);
  assert.equal(plain.json.proposals[0].action, 'menu_items_add');

  // An action prepared by the owner's own AI client (the MCP bridge's prepare_action) is pasted in as one line: it becomes
  // an ordinary card, checked by the same rules, and still changes nothing until the owner applies it.
  const line = 'BA-CORE-ACTION ' + JSON.stringify({ name: 'menu_items_add', args: { part: 'Drinks', items: [{ name: 'Ginger Ale', price: 4 }] } });
  const pasted = await request(port, '/api/admin/assistant/turn', { method: 'POST', headers: owner, body: { text: line } });
  assert.equal(pasted.status, 200, pasted.body);
  assert.equal(pasted.json.proposals.length, 1, pasted.body);
  assert.equal(pasted.json.proposals[0].action, 'menu_items_add');
  assert.equal(pasted.json.proposals[0].request.body.price_cents, 400);
  assert.ok(!/Ginger Ale/.test((await request(port, '/api/pos/menu?all=1', { headers: owner })).body));
  for (const bad of ['BA-CORE-ACTION {"name":"update_install","args":{}}', 'BA-CORE-ACTION {"name":"menu_items_add","args":{"part":"Drinks","items":[{"name":"Free Beer","price":-1}]}}', 'BA-CORE-ACTION {not json}']) {
    const refused = await request(port, '/api/admin/assistant/turn', { method: 'POST', headers: owner, body: { text: bad } });
    assert.equal((refused.json.proposals || []).length, 0, refused.body);
  }

  const hard = await request(port, '/api/admin/assistant/turn', { method: 'POST', headers: owner,
    body: { conversation: plain.json.conversation, text: 'My cousin keeps asking for that old-time sarsaparilla soda - can the drinks list carry one, $3 a glass?' } });
  assert.match(hard.body, /Hosted AI settings/, hard.body);
  assert.equal((hard.json.proposals || []).length, 0);
});
