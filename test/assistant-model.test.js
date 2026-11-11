'use strict';

// The assistant's model layer: the request each provider is sent, built from
// the owner's private connection file, and what comes back.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const source = path.resolve(__dirname, '..');
const apiKey = 'sk-ant-fixtureassistantkey0123456789';

function workdir(t, connection) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-model-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  fs.cpSync(path.join(source, 'services'), path.join(work, 'services'), { recursive: true });
  fs.copyFileSync(path.join(source, 'package.json'), path.join(work, 'package.json'));
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(work, 'node_modules'), 'dir');
  if (connection) fs.writeFileSync(path.join(work, 'owner-ai-secrets.json'), JSON.stringify(connection) + '\n', { mode: 0o600 });
  return work;
}

// Runs model.chat() in a throwaway copy with fetch replaced; prints { sent, result }.
function ask(work, reply, request) {
  const script = `
    const sent = [];
    globalThis.fetch = async (url, options) => {
      sent.push({ url, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
      const r = ${JSON.stringify(reply)};
      return new Response(JSON.stringify(r.json), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
    };
    require('./services/assistant/model').chat(${JSON.stringify(request)}).then(result => console.log(JSON.stringify({ sent, result })));`;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: work, encoding: 'utf8',
    env: { ...process.env, BA_TEST_ANTHROPIC_URL: 'https://claude.invalid/v1', BA_TEST_OPENAI_URL: 'https://openai.invalid/v1' } });
  return JSON.parse(out.trim().split('\n').at(-1));
}

const tools = [{ type: 'function', function: { name: 'menu_read', description: 'Read the menu', parameters: { type: 'object', properties: {} } } }];
const thinking = { type: 'thinking', thinking: '', signature: 'fixture-signature' };

test('Claude is asked on the current API with the owner\'s settings, and its blocks go back unchanged', (t) => {
  const work = workdir(t, { provider: 'anthropic', apiKey, model: 'claude-opus-5-5', workspaceId: 'wrkspc_fixture', effort: 'high', maxOutputTokens: 48000, reasoningMode: null });
  const first = ask(work, { json: { stop_reason: 'tool_use', content: [thinking, { type: 'tool_use', id: 'toolu_1', name: 'menu_read', input: {} }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
  { messages: [{ role: 'system', content: 'You help the owner.' }, { role: 'user', content: 'What is on the menu?' }], tools });
  const { headers, body, url } = first.sent[0];
  assert.equal(url, 'https://claude.invalid/v1/messages');
  assert.equal(headers.authorization, 'Bearer ' + apiKey);
  assert.equal(headers['anthropic-version'], '2026-10-21');
  assert.equal(headers['anthropic-workspace-id'], 'wrkspc_fixture');
  assert.equal(headers['x-api-key'], undefined);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.system, 'You help the owner.');
  assert.deepEqual(body.output_config, { effort: 'high' });
  assert.equal(body.max_tokens, 16000, 'one whole reply stays under the non-streamed ceiling');
  assert.deepEqual(body.tool_choice, { type: 'auto' });
  assert.deepEqual(body.tools.at(-1).cache_control, { type: 'ephemeral' });
  for (const field of ['temperature', 'top_p', 'top_k', 'thinking']) assert.equal(body[field], undefined, field + ' is not sent');
  assert.ok(!JSON.stringify(body).includes(apiKey));
  assert.equal(first.result.ok, true);
  assert.deepEqual(first.result.toolCalls.map(call => [call.name, call.argsError]), [['menu_read', null]]);
  assert.equal(first.result.usage.prompt_tokens, 110);

  // The answered turn goes back exactly as it came, thinking block first, with the tool's result after it.
  const second = ask(work, { json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Two beers and a pizza. ' + apiKey }] } },
    { messages: [{ role: 'user', content: 'What is on the menu?' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'toolu_1', function: { name: 'menu_read', arguments: '{}' } }], raw: first.result.raw },
      { role: 'tool', tool_call_id: 'toolu_1', content: '{"items":3}' }], tools, toolChoice: 'none' });
  const turns = second.sent[0].body.messages;
  assert.deepEqual(turns[1].content[0], thinking);
  assert.equal(turns[1].content[1].type, 'tool_use');
  assert.deepEqual(turns[2].content[0], { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"items":3}' });
  assert.deepEqual(second.sent[0].body.tool_choice, { type: 'none' });
  assert.equal(second.result.text, 'Two beers and a pizza. [redacted]', 'a key echoed by the model is redacted');
});

test('a refusal, a spent allowance and provider errors come back as words the owner can act on', (t) => {
  const work = workdir(t, { provider: 'anthropic', apiKey, model: 'claude-haiku-5-5', workspaceId: '', effort: null, maxOutputTokens: null, reasoningMode: null });
  const request = { messages: [{ role: 'user', content: 'Hello' }], tools };
  const defaults = ask(work, { json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi.' }] } }, request);
  assert.equal(defaults.sent[0].body.max_tokens, 8192);
  assert.equal(defaults.sent[0].body.output_config, undefined);
  assert.equal(defaults.sent[0].headers['anthropic-workspace-id'], undefined);

  const refusal = ask(work, { json: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] } }, request).result;
  assert.equal(refusal.ok, false);
  assert.match(refusal.error, /declined/);
  const cut = ask(work, { json: { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Half an ans' }] } }, request).result;
  assert.match(cut.error, /ran out of room/);
  const billing = ask(work, { status: 400, json: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low. ' + apiKey } } }, request).result;
  assert.match(billing.error, /credit/);
  assert.ok(!billing.error.includes(apiKey));
  const unknown = ask(work, { status: 404, json: { error: { type: 'not_found_error', message: 'model: nope' } } }, request).result;
  assert.match(unknown.error, /model ID/);
  const denied = ask(work, { status: 401, json: { error: { type: 'authentication_error', message: 'invalid bearer token' } } }, request).result;
  assert.match(denied.error, /API key/);
});

test('OpenAI is asked through chat completions, and no connection means no request', (t) => {
  const work = workdir(t, { provider: 'openai', apiKey: 'sk-proj-fixtureassistantkey0123456789', model: 'gpt-fixture', workspaceId: '', effort: null, maxOutputTokens: 4096, reasoningMode: null });
  const reply = ask(work, { json: { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'menu_read', arguments: '{not json' } }] } }] } },
  { messages: [{ role: 'user', content: 'Menu?' }], tools });
  assert.equal(reply.sent[0].url, 'https://openai.invalid/v1/chat/completions');
  assert.equal(reply.sent[0].headers.authorization, 'Bearer sk-proj-fixtureassistantkey0123456789');
  assert.equal(reply.sent[0].body.max_completion_tokens, 4096);
  for (const field of ['temperature', 'top_p', 'max_tokens']) assert.equal(reply.sent[0].body[field], undefined);
  assert.equal(reply.result.toolCalls[0].argsError, 'its arguments were not readable JSON', 'broken arguments are reported, never repaired');

  const none = ask(workdir(t, null), { json: {} }, { messages: [{ role: 'user', content: 'Menu?' }], tools });
  assert.equal(none.sent.length, 0);
  assert.equal(none.result.notConnected, true);
  assert.match(none.result.error, /Hosted AI settings/);
});

test('every route the assistant can ask for is mounted, and nothing reaches for the removed updater', { timeout: 60000 }, (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-routes-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  for (const item of ['server.js', 'package.json', 'public', 'routes', 'services', 'scripts', 'templates', 'docs']) {
    fs.cpSync(path.join(source, item), path.join(work, item), { recursive: true });
  }
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(work, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify({ server: { port: 0 }, setup: { completed: true } }));
  const routesFile = path.join(work, 'routes.txt');
  spawnSync(process.execPath, ['--require', path.join(__dirname, 'support', 'dump-routes.cjs'), 'server.js'], { cwd: work, timeout: 40000, stdio: 'ignore',
    env: { ...process.env, BA_ROUTES_OUT: routesFile, BA_DISABLE_SCHEDULER: '1', BA_CORE_COMMUNITY: '1' } });
  const mounted = fs.readFileSync(routesFile, 'utf8').trim().split('\n').map(line => line.split(' ')[1]);
  assert.ok(mounted.length > 300, 'the app mounted its routes');
  const patterns = mounted.map(route => new RegExp('^' + route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_]+(\\\([^)]*\\\))?\\?\??/g, '[^/]+') + '/?$'));

  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) files.push(full);
    }
  })(path.join(source, 'services', 'assistant'));
  files.push(path.join(source, 'public', 'assistant.js'), path.join(source, 'public', 'assistant-apply.js'));
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/[`'"](\/api\/[A-Za-z0-9_\-/:.${}?=&%[\]() +,'|!]*?)[`'"]/g)) {
      let asked = match[1].split('?')[0].replace(/\$\{[^}]*\}/g, 'X').replace(/\/$/, '');
      if (patterns.some(pattern => pattern.test(asked))) continue;
      // a path finished by concatenation is a prefix of some mounted route
      const stem = asked.replace(/X$/, '').replace(/\/$/, '');
      if (mounted.some(route => route.startsWith(stem + '/'))) continue;
      missing.push(path.relative(source, file) + ': ' + match[1]);
    }
  }
  const actions = require('../services/assistant/actions');
  const names = actions.ACTIONS.map(action => action.name);
  // the updater's routes are still named by the retired actions' source, and by nothing an owner or a model can reach
  const live = missing.filter(entry => !/\/api\/admin\/update\//.test(entry));
  assert.deepEqual(live, []);
  assert.ok(!names.some(name => /^updates?_/.test(name) || name === 'ai_service_set' || name === 'texts_signed_as_set'), 'no updater, key-setting or text-brand action is offered');
  assert.ok(names.length > 250 && names.includes('menu_items_add') && names.includes('ai_service_read'));
});
