// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { askOwnerAI, DEFAULT_MODELS, DEFAULT_OUTPUT_TOKENS, OwnerAIProviderError, MAX_HOSTED_MESSAGE } = require('../services/owner-ai-provider');

const apiKey = 'fixture-ai-key-123456';
const request = { provider: 'openai', apiKey, message: 'Help me adjust our late-night rate.' };

function openAIReply(answer) {
  return Response.json({ status: 'completed', output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] },
  ] });
}

function eventStream(events, splitAt) {
  const bytes = Buffer.from(events.map(event => 'event: ' + event.type + '\r\ndata: ' + JSON.stringify(event) + '\r\n\r\n').join(''));
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, splitAt));
      controller.enqueue(bytes.subarray(splitAt));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

test('OpenAI uses model defaults and only includes allowlisted facility context', async () => {
  const proposal = { openTime: '09:00', closeTime: '01:00', pricePerHalfHour: 35 };
  const result = await askOwnerAI({
    ...request,
    bookingSettings: { openTime: '08:00', closeTime: '02:00', open24Hours: false, closeNextDay: true,
      pricePerHalfHour: 25, ownerEmail: 'owner@example.test' },
    health: { service: 'running', publicBookingHeld: true, summary: 'private error details' },
  }, {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.Authorization, 'Bearer ' + apiKey);
      assert.ok(!options.body.includes(apiKey));
      const body = JSON.parse(options.body);
      assert.equal(body.model, DEFAULT_MODELS.openai);
      assert.equal(body.store, false);
      assert.equal(body.reasoning, undefined);
      assert.equal(body.max_output_tokens, undefined);
      assert.equal(body.tools, undefined);
      assert.deepEqual(JSON.parse(body.input), {
        request: request.message,
        booking: { openTime: '08:00', closeTime: '02:00', open24Hours: false, closeNextDay: true, pricePerHalfHour: 25 },
        health: { service: 'running', publicBookingHeld: true },
      });
      return openAIReply({ text: 'Review the proposed hours and rate.', proposal });
    },
  });
  assert.deepEqual(result, { text: 'Review the proposed hours and rate.', proposal });
});

test('Claude Messages uses the optional workspace and returns text without an action', async () => {
  const result = await askOwnerAI({
    ...request, provider: 'anthropic', workspaceId: 'wrkspc_fixture', message: 'Where do I set up a second bay?',
    bookingSettings: { openTime: 'private-note', closeTime: '15:00', pricePerHalfHour: '18.00' },
    health: { service: 'private-status', publicBookingHeld: 'private-value' },
  }, {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(options.headers.Authorization, 'Bearer ' + apiKey);
      assert.equal(options.headers['anthropic-version'], '2026-10-21');
      assert.equal(options.headers['anthropic-workspace-id'], 'wrkspc_fixture');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.model, DEFAULT_MODELS.anthropic);
      assert.equal(body.thinking, undefined);
      assert.equal(body.output_config, undefined);
      assert.equal(body.max_tokens, DEFAULT_OUTPUT_TOKENS.anthropic);
      assert.equal(body.tools, undefined);
      assert.deepEqual(JSON.parse(body.messages[0].content), {
        request: 'Where do I set up a second bay?', booking: { closeTime: '15:00' }, health: {},
      });
      return Response.json({ stop_reason: 'end_turn', content: [
        { type: 'text', text: JSON.stringify({ text: 'Start in Admin under Bays & Devices.', proposal: null }) },
      ] });
    },
  });
  assert.deepEqual(result, { text: 'Start in Admin under Bays & Devices.', proposal: null });
});

test('a custom OpenAI model uses the chosen effort and output allowance and returns the full reply', async () => {
  const answer = { text: 'Example detail.\n'.repeat(6000) + 'End of reply.', proposal: null };
  const result = await askOwnerAI({ ...request, model: 'gpt-6.1-sol', reasoningMode: 'pro', effort: 'max', maxOutputTokens: 96_000 }, {
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-6.1-sol');
      assert.equal(body.stream, true);
      assert.deepEqual(body.reasoning, { effort: 'max', mode: 'pro' });
      assert.equal(body.max_output_tokens, 96_000);
      return eventStream([{ type: 'response.completed', response: await openAIReply(answer).json() }], 11);
    },
  });
  assert.deepEqual(result, answer);
});

test('Claude streams a long reply without returning thinking text or losing split characters', async () => {
  const answer = { text: '© Example detail.\n'.repeat(6000) + 'End of reply.', proposal: null };
  const json = JSON.stringify(answer);
  const events = [
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Private reasoning' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: json.slice(0, 1000) } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: json.slice(1000) } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ];
  const head = events.slice(0, 2).map(event => 'event: ' + event.type + '\r\ndata: ' + JSON.stringify(event) + '\r\n\r\n').join('');
  const splitAt = Buffer.byteLength(head.slice(0, head.indexOf('©'))) + 1;
  const result = await askOwnerAI({ ...request, provider: 'anthropic', effort: 'max', maxOutputTokens: 128_000 }, {
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.stream, true);
      assert.equal(body.max_tokens, 128_000);
      assert.deepEqual(body.output_config, { effort: 'max' });
      return eventStream(events, splitAt);
    },
  });
  assert.deepEqual(result, answer);
});

test('both providers report when thinking and reply tokens exhaust the output allowance', async () => {
  for (const [provider, payload] of [
    ['openai', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }],
    ['anthropic', { stop_reason: 'max_tokens', content: [] }],
  ]) {
    await assert.rejects(askOwnerAI({ ...request, provider }, {
      fetchImpl: async () => Response.json(payload),
    }), { code: 'provider_output_limit' });
  }
});

test('invalid or overbroad model proposals are discarded and echoed keys are redacted', async () => {
  for (const proposal of [
    { openTime: '08:00' }, { pricePerHalfHour: 32.001 }, { pricePerHalfHour: '32' },
    { pricePerHalfHour: 32, customerData: true }, JSON.parse('{"__proto__":{"pricePerHalfHour":0}}'),
  ]) {
    const result = await askOwnerAI(request, {
      fetchImpl: async () => openAIReply({ text: 'Provider text: ' + apiKey, proposal }),
    });
    assert.deepEqual(result, { text: 'Provider text: [redacted]', proposal: null });
  }
});

test('provider failures expose only stable app errors', async () => {
  for (const [status, code] of [[401, 'provider_auth'], [404, 'provider_model'], [429, 'provider_rate_limit'], [500, 'provider_unavailable']]) {
    await assert.rejects(askOwnerAI(request, {
      fetchImpl: async () => new Response(apiKey, { status }),
    }), error => error instanceof OwnerAIProviderError && error.code === code && !error.message.includes(apiKey));
  }
  await assert.rejects(askOwnerAI(request, {
    fetchImpl: async () => { throw new Error(apiKey); },
  }), error => error.code === 'provider_unavailable' && !error.message.includes(apiKey));
});

test('truncated, malformed and oversized replies fail without exposing provider data', async () => {
  for (const response of [
    Response.json({ status: 'incomplete', output: [] }),
    Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [
      { type: 'output_text', text: apiKey },
    ] }] }),
    new Response(new Uint8Array(16 * 1024 * 1024 + 1)),
    eventStream([{ type: 'response.output_text.delta', delta: apiKey }], 15),
  ]) {
    await assert.rejects(askOwnerAI(request, {
      fetchImpl: async () => response,
    }), error => error.code === 'provider_response' && !error.message.includes(apiKey));
  }
});

test('invalid owner input is rejected before contacting the provider', async () => {
  const fetchImpl = async () => { assert.fail('Unexpected provider request'); };
  await assert.rejects(askOwnerAI({ ...request, provider: '__proto__' }, { fetchImpl }), { code: 'invalid_config' });
  await assert.rejects(askOwnerAI({ ...request, apiKey: 'abc\nInjected: value' }, { fetchImpl }), { code: 'invalid_config' });
  await assert.rejects(askOwnerAI({ ...request, provider: 'anthropic', effort: 'none' }, { fetchImpl }), { code: 'invalid_config' });
  await assert.rejects(askOwnerAI({ ...request, provider: 'anthropic', reasoningMode: 'pro' }, { fetchImpl }), { code: 'invalid_config' });
  await assert.rejects(askOwnerAI({ ...request, maxOutputTokens: 0 }, { fetchImpl }), { code: 'invalid_config' });
  await assert.rejects(askOwnerAI({ ...request, message: 'Here is my key ' + apiKey }, { fetchImpl }), { code: 'invalid_input' });
  await assert.rejects(askOwnerAI({ ...request, message: 'a'.repeat(MAX_HOSTED_MESSAGE + 1) }, { fetchImpl }), { code: 'invalid_input' });
});

test('a fenced or prefaced JSON reply is still read, and plain prose is still refused', async () => {
  const answer = { text: 'Open the Menu tab.', proposal: null };
  for (const wrapped of [
    '```json\n' + JSON.stringify(answer) + '\n```',
    'Here is the answer:\n' + JSON.stringify(answer),
    '  ' + JSON.stringify(answer) + '\n',
  ]) {
    const result = await askOwnerAI(request, { fetchImpl: async () => Response.json({ status: 'completed', output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: wrapped }] },
    ] }) });
    assert.deepEqual(result, answer);
  }
  await assert.rejects(askOwnerAI(request, { fetchImpl: async () => Response.json({ status: 'completed', output: [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Open the Menu tab.' }] },
  ] }) }), { code: 'provider_response' });
});

test('earlier turns reach both providers as conversation, never a turn holding the key', async () => {
  const history = [
    { request: 'Which beer do you mean?', reply: 'House Lager or Pale Ale?' },
    { request: 'my key is ' + apiKey, reply: 'Noted.' },
    { request: '', reply: 'An empty request is skipped.' },
  ];
  const expected = [
    { role: 'user', content: 'Which beer do you mean?' },
    { role: 'assistant', content: 'House Lager or Pale Ale?' },
  ];
  await askOwnerAI({ ...request, message: 'The lager.', history }, { fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.input.slice(0, -1), expected);
    assert.equal(JSON.parse(body.input.at(-1).content).request, 'The lager.');
    assert.ok(!options.body.includes(apiKey));
    return openAIReply({ text: 'House Lager it is.', proposal: null });
  } });
  await askOwnerAI({ ...request, provider: 'anthropic', message: 'The lager.', history }, { fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages.slice(0, -1), expected);
    assert.equal(JSON.parse(body.messages.at(-1).content).request, 'The lager.');
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ text: 'House Lager it is.', proposal: null }) }] });
  } });
  await assert.rejects(askOwnerAI({ ...request, history: 'not a list' }, { fetchImpl: async () => assert.fail('Unexpected provider request') }),
    { code: 'invalid_input' });
});

test('billing, overload, unknown-model and refusal answers each say what the owner can do', async () => {
  const failure = (status, error) => async () => Response.json({ error }, { status });
  await assert.rejects(askOwnerAI(request, { fetchImpl: failure(400, { type: 'invalid_request_error', message: 'Your credit balance is too low. ' + apiKey }) }),
    error => error.code === 'provider_billing' && /credit/.test(error.message) && !error.message.includes(apiKey));
  await assert.rejects(askOwnerAI(request, { fetchImpl: failure(429, { code: 'insufficient_quota', message: 'You exceeded your current quota.' }) }),
    { code: 'provider_billing' });
  await assert.rejects(askOwnerAI(request, { fetchImpl: failure(404, { type: 'not_found_error', message: 'model: example-model' }) }),
    error => error.code === 'provider_model' && /model ID/.test(error.message));
  await assert.rejects(askOwnerAI(request, { fetchImpl: failure(400, { type: 'invalid_request_error', message: 'max_tokens: 900000 > 128000' }) }),
    error => error.code === 'provider_model' && /output token/.test(error.message));

  let calls = 0;
  const recovered = await askOwnerAI(request, { retryDelayMs: 1, fetchImpl: async () =>
    ++calls === 1 ? Response.json({ error: { type: 'overloaded_error' } }, { status: 529 }) : openAIReply({ text: 'Back.', proposal: null }) });
  assert.deepEqual(recovered, { text: 'Back.', proposal: null });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(askOwnerAI(request, { retryDelayMs: 1, fetchImpl: async () => {
    calls++;
    return Response.json({ error: { type: 'overloaded_error' } }, { status: 529 });
  } }), { code: 'provider_overloaded' });
  assert.equal(calls, 2);

  await assert.rejects(askOwnerAI({ ...request, provider: 'anthropic' }, { fetchImpl: async () =>
    Response.json({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] }) }), { code: 'provider_refusal' });
  await assert.rejects(askOwnerAI(request, { fetchImpl: async () => Response.json({ status: 'completed', output: [
    { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No.' }] },
  ] }) }), { code: 'provider_refusal' });
});
