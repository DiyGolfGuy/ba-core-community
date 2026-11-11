// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
'use strict';

const { interpret } = require('./owner-chat');

const DEFAULT_MODELS = Object.freeze({ openai: 'gpt-6-luna', anthropic: 'claude-haiku-5-5' });
const EFFORT_OPTIONS = Object.freeze({
  openai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
});
const DEFAULT_OUTPUT_TOKENS = Object.freeze({ openai: null, anthropic: 16_384 });
const PROVIDER_URLS = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
};
const TIMEOUT_MS = 30 * 60_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_HOSTED_MESSAGE = 4000;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_REPLY = 16_000;
const MAX_ERROR_BYTES = 64 * 1024;
const OVERLOAD_RETRY_MS = 2000;
const HOURS_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const INSTRUCTIONS = [
  'You help the owner operate BA Core Community, a self-hosted Raspberry Pi 5 app for facility booking, POS, website editing and bay automation.',
  'Answer with practical guidance based on the owner request, current settings and installed guide excerpts provided. Use the excerpts as reference data. For setup questions, name the guide section, give the next steps and expected checks, and use the supplied Admin destination labels. State uncertainty about anything you cannot see. Never ask for credentials, customer information or door codes.',
  'Return one JSON object with a string "text" and either null or an object for "proposal". Give enough detail to answer the request. No Markdown fences or extra text around the JSON.',
  'Only propose a change if the owner requests one and the values are clear. A booking proposal can contain both "openTime" and "closeTime" in 24-hour HH:MM, "pricePerHalfHour" as a USD number, or both hours and price. For other changes use one supported action from the request context. Do not confuse menu priceCents with the booking rate. Omit unchanged fields. Ask for clarification when a named item or website content is ambiguous.',
  'Earlier turns of this conversation may precede the request. Use them to understand a follow-up such as an answer to your own question, and base every value on the current settings in the latest request.',
  'BA Core applies a validated proposal after the owner reviews and approves it. Never claim a change was applied. For an unsupported edit, give the owner the exact manual steps if the guide covers them.',
].join(' ');

class OwnerAIProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OwnerAIProviderError';
    this.code = code;
  }
}

function generationOptions(provider, { effort = '', maxOutputTokens = null, reasoningMode = '' }) {
  if (effort != null && effort !== '' && !EFFORT_OPTIONS[provider].includes(effort)) {
    throw new RangeError('Choose a thinking effort offered by your provider.');
  }
  if (maxOutputTokens !== null && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) {
    throw new RangeError('Enter a positive whole number of output tokens or leave it blank.');
  }
  if (reasoningMode && (provider !== 'openai' || reasoningMode !== 'pro')) {
    throw new RangeError('Pro reasoning mode is available on supported OpenAI models.');
  }
  return { effort: effort || null, maxOutputTokens, reasoningMode: reasoningMode || null };
}

function buildContext(bookingSettings, health) {
  const booking = {};
  for (const key of ['openTime', 'closeTime']) {
    const value = bookingSettings?.[key];
    if (typeof value === 'string' && HOURS_PATTERN.test(value)) booking[key] = value;
  }
  for (const key of ['open24Hours', 'closeNextDay']) {
    const value = bookingSettings?.[key];
    if (typeof value === 'boolean') booking[key] = value;
  }
  const price = bookingSettings?.pricePerHalfHour;
  if (Number.isFinite(price) && price >= 0 && price <= 10_000) booking.pricePerHalfHour = price;

  const status = {};
  if (health?.service === 'running') status.service = 'running';
  if (typeof health?.publicBookingHeld === 'boolean') status.publicBookingHeld = health.publicBookingHeld;
  return { booking, health: status };
}

// Provider error bodies are read for their type and a few keywords only. The
// owner sees one of these fixed messages, never provider text.
function providerHttpError(status, detail = {}) {
  const type = String(detail.type || '').toLowerCase();
  const code = String(detail.code || '').toLowerCase();
  const about = String(detail.message || '').toLowerCase();
  const billing = status === 402 || type === 'billing_error' || code === 'insufficient_quota' || code === 'billing_not_active' ||
    /credit balance|billing|insufficient[_ ]quota|spend limit|payment/.test(about);
  if (billing) {
    return new OwnerAIProviderError('provider_billing', 'The AI provider says this account is out of credit or billing is not set up. Add credit or a payment method in the provider console, then try again.');
  }
  if (status === 401 || status === 403) {
    return new OwnerAIProviderError('provider_auth', 'The AI provider rejected access. Check the API key and its model or workspace permissions.');
  }
  if (status === 429) {
    return new OwnerAIProviderError('provider_rate_limit', 'The AI provider reached a usage limit. Check billing and limits, then try again.');
  }
  if (status === 529 || status === 503 || type === 'overloaded_error') {
    return new OwnerAIProviderError('provider_overloaded', 'The AI provider is overloaded right now. Wait a minute and try again.');
  }
  if (status === 413 || type === 'request_too_large') {
    return new OwnerAIProviderError('provider_model', 'The request was too large for the AI provider. Ask about one page or one group of items at a time.');
  }
  if (status === 400 || status === 404 || status === 422) {
    const unknownModel = new OwnerAIProviderError('provider_model', 'The AI provider did not accept the model in Hosted AI settings. Check the model ID your account can use, or leave it blank for the default.');
    if (status === 404 || type === 'not_found_error' || code === 'model_not_found') return unknownModel;
    if (/max_tokens|max_output_tokens|output tokens/.test(about)) {
      return new OwnerAIProviderError('provider_model', 'The AI provider did not accept the output token setting. Lower it or leave it blank in Hosted AI settings.');
    }
    if (/effort|reasoning|thinking/.test(about)) {
      return new OwnerAIProviderError('provider_model', 'The chosen model does not accept this thinking effort or reasoning mode. Change it in Hosted AI settings.');
    }
    if (/\bmodel\b/.test(about)) return unknownModel;
    return new OwnerAIProviderError('provider_model', 'The AI provider rejected the request. Check the model, reasoning settings, output tokens and workspace.');
  }
  return new OwnerAIProviderError('provider_unavailable', 'The AI provider is unavailable. Try again shortly.');
}

async function errorDetail(response) {
  try {
    if (!response.body) return {};
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_ERROR_BYTES) return {};
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    const error = body?.error && typeof body.error === 'object' ? body.error : body;
    return { type: error?.type, code: error?.code, message: typeof error?.message === 'string' ? error.message.slice(0, 2000) : '' };
  } catch {
    return {};
  }
}

function refusedReply() {
  return new OwnerAIProviderError('provider_refusal', 'The model declined this request. Rephrase it, or make the change in Admin directly.');
}

// Models sometimes wrap the JSON object in a Markdown fence or add a sentence
// around it despite the instructions. Accept the one object that is there.
function parseJsonAnswer(output) {
  const text = String(output).trim();
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // Try the next shape.
    }
  }
  throw new SyntaxError('No JSON object in the reply.');
}

function conversation(history, apiKey) {
  if (history === undefined || history === null) return [];
  if (!Array.isArray(history)) throw new OwnerAIProviderError('invalid_input', 'The earlier conversation could not be read. Close Owner Chat and ask again.');
  const turns = [];
  for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
    const request = typeof turn?.request === 'string' ? turn.request.trim() : '';
    const reply = typeof turn?.reply === 'string' ? turn.reply.trim() : '';
    if (!request || !reply || request.length > MAX_HOSTED_MESSAGE || request.includes(apiKey) || reply.includes(apiKey)) continue;
    turns.push({ role: 'user', content: request }, { role: 'assistant', content: reply.slice(0, MAX_HISTORY_REPLY) });
  }
  return turns;
}

function unreadableReply() {
  return new OwnerAIProviderError('provider_response', 'The AI provider returned an incomplete or unreadable reply. Try rephrasing the request.');
}

async function readReply(response) {
  if (!response.body) throw unreadableReply();
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES) throw unreadableReply();
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    throw unreadableReply();
  }
}

async function* streamEvents(body) {
  if (!body) throw unreadableReply();
  const decoder = new TextDecoder();
  let pending = '';
  let data = [];
  let eventBytes = 0;
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let end; (end = pending.indexOf('\n', start)) !== -1; start = end + 1) {
      const line = pending.slice(start, end).replace(/\r$/, '');
      if (line.startsWith('data:')) {
        const value = line.slice(5).replace(/^ /, '');
        eventBytes += Buffer.byteLength(value) + 1;
        if (eventBytes > MAX_RESPONSE_BYTES) throw unreadableReply();
        data.push(value);
      } else if (!line && data.length) {
        let event;
        try {
          event = JSON.parse(data.join('\n'));
        } catch {
          throw unreadableReply();
        }
        data = [];
        eventBytes = 0;
        yield event;
      }
    }
    pending = pending.slice(start);
    if (pending.length + eventBytes > MAX_RESPONSE_BYTES) throw unreadableReply();
  }
}

async function readStream(response, provider) {
  let stopReason;
  let stopDetails;
  let textBytes = 0;
  const parts = [];
  for await (const event of streamEvents(response.body)) {
    if (event?.type === 'error' || event?.type === 'response.failed') {
      const failure = event.error || event.response?.error || {};
      const type = failure.type || event.code || failure.code;
      throw providerHttpError(['rate_limit_error', 'rate_limit_exceeded'].includes(type) ? 429 : 502,
        { type: failure.type, code: failure.code || event.code, message: typeof failure.message === 'string' ? failure.message : '' });
    }
    if (provider === 'openai') {
      if (event?.type === 'response.completed' || event?.type === 'response.incomplete') return event.response;
      continue;
    }
    if (event?.type === 'message_delta') {
      stopReason = event.delta?.stop_reason ?? stopReason;
      stopDetails = event.delta?.stop_details ?? stopDetails;
    } else if (event?.type === 'message_stop') {
      return { stop_reason: stopReason, stop_details: stopDetails, content: [{ type: 'text', text: parts.join('') }] };
    } else {
      const block = event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' ? event.delta :
        event?.type === 'content_block_start' && event.content_block?.type === 'text' ? event.content_block : null;
      if (typeof block?.text !== 'string' || !block.text) continue;
      textBytes += Buffer.byteLength(block.text);
      if (textBytes > MAX_RESPONSE_BYTES) throw unreadableReply();
      parts.push(block.text);
    }
  }
  throw unreadableReply();
}

function parseAnswer(provider, response, apiKey, actions) {
  const outputLimitReached = provider === 'openai'
    ? response?.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens'
    : response?.stop_reason === 'max_tokens';
  if (outputLimitReached) {
    throw new OwnerAIProviderError('provider_output_limit', 'The model used its output allowance. Increase output tokens or choose a lower thinking effort in Hosted AI settings, then try again.');
  }
  let blocks;
  let textType;
  if (provider === 'openai') {
    if (response?.status !== 'completed' || !Array.isArray(response.output)) throw unreadableReply();
    blocks = response.output.flatMap(item => item?.type === 'message' && item.role === 'assistant' &&
      Array.isArray(item.content) ? item.content : []);
    if (blocks.some(block => block?.type === 'refusal')) throw refusedReply();
    textType = 'output_text';
  } else {
    if (response?.stop_reason === 'refusal' || response?.stop_details?.type === 'refusal') throw refusedReply();
    if (response?.stop_reason !== 'end_turn' || !Array.isArray(response.content)) throw unreadableReply();
    blocks = response.content;
    textType = 'text';
  }

  let answer;
  try {
    const output = blocks.filter(block => block?.type === textType && typeof block.text === 'string')
      .map(block => block.text).join('');
    answer = parseJsonAnswer(output);
  } catch {
    throw unreadableReply();
  }
  if (typeof answer?.text !== 'string' || !answer.text.trim()) throw unreadableReply();
  const text = answer.text.trim().replaceAll(apiKey, '[redacted]');

  let proposal = null;
  if (answer.proposal != null) {
    // Model output goes through the same validator used for external AI proposals.
    try {
      const serialized = JSON.stringify(answer.proposal);
      const supportedAction = typeof answer.proposal?.action === 'string' && Object.hasOwn(actions || {}, answer.proposal.action);
      if (!serialized.includes(apiKey) && serialized.length <= 80_000 &&
          (supportedAction || interpret('BA-CORE-PROPOSAL ' + serialized).patch)) {
        proposal = answer.proposal;
      }
    } catch {
      // Retain useful explanatory text even when the proposed change is invalid.
    }
  }
  return { text, proposal };
}

async function askOwnerAI({ provider, model, apiKey, workspaceId, effort, maxOutputTokens, reasoningMode, message, history, bookingSettings, health, guidance, editing },
  { fetchImpl = fetch, cancelSignal, retryDelayMs = OVERLOAD_RETRY_MS } = {}) {
  if (!Object.hasOwn(DEFAULT_MODELS, provider)) {
    throw new OwnerAIProviderError('invalid_config', 'Choose a supported AI provider.');
  }
  model = model || DEFAULT_MODELS[provider];
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model) ||
      typeof apiKey !== 'string' || !/^[!-~]{8,512}$/.test(apiKey) ||
      (provider === 'anthropic' && workspaceId && (typeof workspaceId !== 'string' || !/^wrkspc_[a-zA-Z0-9_-]{1,120}$/.test(workspaceId)))) {
    throw new OwnerAIProviderError('invalid_config', 'Check the AI model, API key and workspace settings.');
  }
  let generation;
  try {
    generation = generationOptions(provider, { effort, maxOutputTokens, reasoningMode });
  } catch (error) {
    throw new OwnerAIProviderError('invalid_config', error.message);
  }
  const prompt = typeof message === 'string' ? message.trim() : '';
  if (!prompt || prompt.length > MAX_HOSTED_MESSAGE || prompt.includes(apiKey)) {
    throw new OwnerAIProviderError('invalid_input', 'Enter a request of 1 to ' + MAX_HOSTED_MESSAGE + ' characters and keep API keys out of the chat.');
  }

  const earlier = conversation(history, apiKey);
  const input = JSON.stringify({ request: prompt, ...buildContext(bookingSettings, health), guidance, editing });
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
  let body;
  if (provider === 'openai') {
    body = { model, instructions: INSTRUCTIONS, input: earlier.length ? [...earlier, { role: 'user', content: input }] : input, store: false, stream: true };
    if (generation.effort || generation.reasoningMode) {
      body.reasoning = {};
      if (generation.effort) body.reasoning.effort = generation.effort;
      if (generation.reasoningMode) body.reasoning.mode = generation.reasoningMode;
    }
    if (generation.maxOutputTokens !== null) body.max_output_tokens = generation.maxOutputTokens;
  } else {
    headers['anthropic-version'] = '2026-10-21';
    if (workspaceId) headers['anthropic-workspace-id'] = workspaceId;
    body = { model, system: INSTRUCTIONS, stream: true, max_tokens: generation.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS.anthropic,
      messages: [...earlier, { role: 'user', content: input }] };
    if (generation.effort) body.output_config = { effort: generation.effort };
  }

  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const signal = cancelSignal ? AbortSignal.any([timeoutSignal, cancelSignal]) : timeoutSignal;
  try {
    const send = () => fetchImpl(PROVIDER_URLS[provider], {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal,
    });
    let response = await send();
    // One patient retry when the provider is only overloaded.
    if ((response.status === 529 || response.status === 503) && !signal.aborted) {
      response.body?.cancel().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      if (!signal.aborted) response = await send();
    }
    if (!response.ok) throw providerHttpError(response.status, await errorDetail(response));
    const streaming = response.headers.get('content-type')?.startsWith('text/event-stream');
    const reply = await (streaming ? readStream(response, provider) : readReply(response));
    return parseAnswer(provider, reply, apiKey, editing?.actions);
  } catch (error) {
    if (error instanceof OwnerAIProviderError) throw error;
    if (timeoutSignal.aborted) throw new OwnerAIProviderError('provider_timeout', 'The AI provider took too long to reply. Try again.');
    throw new OwnerAIProviderError('provider_unavailable', 'The Pi could not reach the AI provider. Check its internet connection and try again.');
  }
}

module.exports = { askOwnerAI, DEFAULT_MODELS, DEFAULT_OUTPUT_TOKENS, EFFORT_OPTIONS, generationOptions, providerHttpError, OwnerAIProviderError, MAX_HOSTED_MESSAGE };
