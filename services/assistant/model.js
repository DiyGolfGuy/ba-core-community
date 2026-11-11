// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/model.js - TALKING TO THE OWNER'S OWN AI MODEL
//
// BA Core Community runs no model of its own. The assistant answers with the hosted model the owner connected in
// Admin > Owner Chat > Hosted AI settings: OpenAI or Claude, on the owner's own API key. That connection (provider, key,
// model, thinking effort, output allowance) lives in services/owner-ai-settings.js - a private file beside the app,
// never in config.json and never in a backup. A key is never typed into the chat and never reaches the conversation.
//   openai     - OpenAI's Chat Completions (POST https://api.openai.com/v1/chat/completions, the key as a Bearer token),
//                max_completion_tokens (max_tokens is deprecated there) and the service's own sampling defaults.
//   anthropic  - Claude through Anthropic's Messages API (POST https://api.anthropic.com/v1/messages, the key as a Bearer
//                token, anthropic-version 2026-10-21; system at the top level; tools as name/description/input_schema; a
//                tool_use block answered by a tool_result block in the next user turn; consecutive turns of one role
//                combined). No sampling settings are sent (they are refused on this version), tool_choice is only auto
//                or none (a forced tool is refused by the current models), and thinking is left to the model - its depth
//                follows the owner's effort setting when one is saved.
// With no connection saved, chat() answers { ok: false, notConnected: true } and the engine says where to connect one.
//
// Nothing here decides anything: the model's words come back as text, and its proposed tool calls as names and arguments,
// which services/assistant/engine.js checks against the action list. A model that answers badly - no answer, broken JSON
// in its arguments, a tool that does not exist - is reported as what it is, never repaired by guessing.
'use strict';

const TIMEOUT_MS = Number(process.env.BA_TEST_ASSISTANT_TIMEOUT_MS) || 180000;
// the services' own addresses; a test points them at its stand-ins
const OPENAI_URL = (process.env.BA_TEST_OPENAI_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const ANTHROPIC_URL = (process.env.BA_TEST_ANTHROPIC_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
const ANTHROPIC_VERSION = '2026-10-21';
// A hosted model thinks before it answers, and that thinking is paid out of the same allowance as the answer, so a
// request gets room; the bill is what is used, not the allowance. One request is answered whole (not streamed), so the
// allowance stays under what a single reply can carry without a timeout.
const SERVICE_MAX_TOKENS = 8192;
const SERVICE_TOKEN_CEILING = 16000;
const PROVIDERS = ['openai', 'anthropic'];
const NAMES = { openai: 'OpenAI', anthropic: 'Anthropic (Claude)', none: 'no AI model' };
const CONNECT_HINT = 'No AI model is connected. Connect OpenAI or Claude in Admin > Owner Chat > Hosted AI settings, then ask again.';
const DEFAULT_ENDPOINT = '';   // there is no model on this unit; kept so older callers read an empty address

function connection() {
  try { return require('../owner-ai-settings').read(); } catch { return null; }
}

function settings() {
  let a = {}; try { a = require('../config').getConfig().assistant || {}; } catch {}
  const c = connection();
  const provider = c && PROVIDERS.includes(c.provider) ? c.provider : 'none';
  return {
    enabled: a.enabled !== false,          // the page is on unless the owner switched it off
    connected: provider !== 'none',
    provider,
    model: c ? String(c.model || '') : '',
    cloudModel: c ? String(c.model || '') : '',
    apiKey: c ? String(c.apiKey || '') : '',
    workspaceId: c ? String(c.workspaceId || '') : '',
    effort: (c && c.effort) || null,
    maxOutputTokens: (c && Number.isSafeInteger(c.maxOutputTokens)) ? c.maxOutputTokens : null,
    endpoint: '', quickModel: '', cloudEndpoint: '', temperature: null,
  };
}

/** One hosted model answers; there is no quick model in front of it. */
function hasQuick() { return false; }

function target(s) {
  return { provider: s.provider, url: s.provider === 'anthropic' ? ANTHROPIC_URL : OPENAI_URL, model: s.cloudModel, key: s.apiKey,
    workspaceId: s.workspaceId, effort: s.effort, maxOutputTokens: s.maxOutputTokens };
}

const why = (e) => String((e && e.cause && e.cause.code) || (e && e.name === 'TimeoutError' && 'it took too long') || (e && e.code) || (e && e.message) || e).slice(0, 80);
const scrub = (text, key) => (key ? String(text).split(key).join('[redacted]') : String(text));
const allowance = (t, asked) => Math.min(SERVICE_TOKEN_CEILING, t.maxOutputTokens || Math.max(asked, SERVICE_MAX_TOKENS));

// A refusal from the service, in words the owner can act on (the same fixed messages Owner Chat gives; never the
// service's own text, and never the key).
function refused(t, status, j) {
  const e = (j && j.error && typeof j.error === 'object') ? j.error : (j || {});
  let message;
  try { message = require('../owner-ai-provider').providerHttpError(status, { type: e.type, code: e.code, message: typeof e.message === 'string' ? e.message : '' }).message; }
  catch { message = `${NAMES[t.provider]} answered ${status}.`; }
  return { ok: false, status, error: scrub(message, t.key) };
}

// ── OpenAI's chat ──
async function openaiStyle(t, { messages, tools, maxTokens, toolChoice }) {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + t.key };
  // a turn Claude answered carries Claude's own blocks for Claude (raw); the OpenAI-style chat takes the plain message
  const plain = messages.map(m => { if (!m.raw) return m; const c = Object.assign({}, m); delete c.raw; return c; });
  const body = { model: t.model, messages: plain, tools: tools && tools.length ? tools : undefined, tool_choice: tools && tools.length ? (toolChoice === 'none' ? 'none' : 'auto') : undefined };
  body.max_completion_tokens = allowance(t, maxTokens);   // max_tokens is deprecated; temperature stays the service's own
  let r;
  try { r = await fetch(t.url + '/chat/completions', { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), body: JSON.stringify(body) }); }
  catch (e) { return { ok: false, unreachable: true, error: `${NAMES.openai} did not answer (${scrub(why(e), t.key)}). Check this unit's internet connection.` }; }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) return refused(t, r.status, j);
  const msg = j && j.choices && j.choices[0] && j.choices[0].message;
  if (!msg) return { ok: false, error: 'the model answered with nothing to read' };
  if (msg.refusal && !String(msg.content || '').trim() && !(Array.isArray(msg.tool_calls) && msg.tool_calls.length)) return { ok: false, error: 'The model declined this request. Rephrase it, or make the change in Admin directly.' };
  // its allowance spent before a word was said (a reasoning model's thinking counts) is not an answer
  if (j.choices[0].finish_reason === 'length' && !String(msg.content || '').trim() && !(Array.isArray(msg.tool_calls) && msg.tool_calls.length)) return { ok: false, error: `${NAMES.openai} ran out of room before it answered - raise the output tokens or lower the thinking effort in Hosted AI settings` };
  const toolCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c, i) => {
    const fn = (c && c.function) || {};
    let args = {}, argsError = null;
    if (fn.arguments && typeof fn.arguments === 'object') args = fn.arguments;
    else if (fn.arguments) { try { args = JSON.parse(fn.arguments); } catch { argsError = 'its arguments were not readable JSON'; } }
    return { id: String(c.id || ('call_' + i)), name: String(fn.name || ''), args, argsError, raw: fn.arguments };
  });
  return { ok: true, text: scrub(String(msg.content || '').trim(), t.key), toolCalls, usage: j.usage || null };
}

// ── Claude, through Anthropic's own Messages API ──
const toolId = (x) => String(x || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'call';   // the API's id pattern: ^[a-zA-Z0-9_-]+$
/** The conversation (kept in the OpenAI-style shape) and the tools, as the Messages API takes them. */
function toAnthropic(messages, tools) {
  const system = [], out = [];
  const push = (role, blocks) => { const last = out[out.length - 1]; if (last && last.role === role) last.content.push(...blocks); else out.push({ role, content: blocks }); };
  for (const m of messages) {
    if (m.role === 'system') { if (m.content) system.push(String(m.content)); continue; }
    if (m.role === 'tool') { push('user', [{ type: 'tool_result', tool_use_id: toolId(m.tool_call_id), content: String(m.content || '') || '(nothing)' }]); continue; }
    if (m.role === 'user') { if (m.content) push('user', [{ type: 'text', text: String(m.content) }]); continue; }
    // a turn Claude itself answered goes back exactly as it came - its thinking blocks first, "complete and unmodified":
    // "when you return tool results, you must pass the thinking blocks from the assistant message back to the API"
    if (m.role === 'assistant' && m.raw && m.raw.provider === 'anthropic' && Array.isArray(m.raw.content) && m.raw.content.length) { push('assistant', m.raw.content.map(b => Object.assign({}, b))); continue; }
    if (m.role === 'assistant') {
      const blocks = m.content ? [{ type: 'text', text: String(m.content) }] : [];
      for (const c of m.tool_calls || []) {
        const fn = c.function || {};
        let input = fn.arguments;
        if (typeof input === 'string') { try { input = JSON.parse(input || '{}'); } catch { input = {}; } }
        if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
        blocks.push({ type: 'tool_use', id: toolId(c.id), name: String(fn.name || ''), input });
      }
      if (blocks.length) push('assistant', blocks);
    }
  }
  const t = (tools || []).map(x => ({ name: x.function.name, description: x.function.description, input_schema: x.function.parameters || { type: 'object', properties: {} } }));
  return { system: system.join('\n\n'), messages: out, tools: t };
}
async function anthropic(t, { messages, tools, maxTokens, toolChoice }) {
  const a = toAnthropic(messages, tools);
  const body = { model: t.model, max_tokens: allowance(t, maxTokens), messages: a.messages };
  if (a.system) body.system = a.system;
  if (t.effort) body.output_config = { effort: t.effort };
  // THE TOOL LIST CACHED: the model is handed every tool the turn may need on every call - tens of thousands of tokens.
  // A cache breakpoint on the last tool caches the whole list as one prefix, and the top-level breakpoint moves forward
  // as the conversation grows; a read from the cache costs a fraction of the input price and lives five minutes from
  // its last use. The list is the same for every conversation, so the second request onward reads it from the cache.
  if (a.tools.length) {
    const list = a.tools.slice(); list[list.length - 1] = Object.assign({}, list[list.length - 1], { cache_control: { type: 'ephemeral' } });
    Object.assign(body, { tools: list, tool_choice: { type: toolChoice === 'none' ? 'none' : 'auto' } });
  }
  body.cache_control = { type: 'ephemeral' };
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + t.key, 'anthropic-version': ANTHROPIC_VERSION };
  if (t.workspaceId) headers['anthropic-workspace-id'] = t.workspaceId;
  let r;
  try { r = await fetch(t.url + '/messages', { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), body: JSON.stringify(body) }); }
  catch (e) { return { ok: false, unreachable: true, error: `${NAMES.anthropic} did not answer (${scrub(why(e), t.key)}). Check this unit's internet connection.` }; }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) return refused(t, r.status, j);
  // a declined request comes back as an ordinary reply: read why it stopped before reading what it says
  if (j && j.stop_reason === 'refusal') return { ok: false, error: 'The model declined this request. Rephrase it, or make the change in Admin directly.' };
  if (!j || !Array.isArray(j.content)) return { ok: false, error: 'the model answered with nothing to read' };
  // stopped at the allowance: what came back is cut short (a tool call half written), never acted on
  if (j.stop_reason === 'max_tokens') return { ok: false, error: `${NAMES.anthropic} ran out of room before it answered - raise the output tokens or lower the thinking effort in Hosted AI settings` };
  const text = scrub(j.content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n').trim(), t.key);
  const toolCalls = j.content.filter(b => b && b.type === 'tool_use').map((b, i) => {
    const good = b.input && typeof b.input === 'object' && !Array.isArray(b.input);
    return { id: String(b.id || ('toolu_' + i)), name: String(b.name || ''), args: good ? b.input : {}, argsError: good ? null : 'its arguments were not readable JSON', raw: JSON.stringify(b.input == null ? {} : b.input) };
  });
  const u = j.usage || {};
  // Claude's own blocks (its thinking among them) ride with the turn, to go back unchanged with the tool results.
  // input_tokens counts only what came after the last breakpoint: the prompt is all three, and what the cache answered is said
  const cached = Number(u.cache_read_input_tokens) || 0, written = Number(u.cache_creation_input_tokens) || 0;
  return { ok: true, text, toolCalls, usage: { prompt_tokens: (Number(u.input_tokens) || 0) + cached + written, completion_tokens: u.output_tokens, cached_tokens: cached, cache_written_tokens: written }, raw: { provider: 'anthropic', content: j.content } };
}

/**
 * One request. messages: OpenAI-style ({ role, content, tool_calls?, tool_call_id? }). tools: from actions.tools().
 * Returns { ok: true, text, toolCalls: [{ id, name, args, argsError }], usage, provider, model }
 *      or { ok: false, error, unreachable?, notConnected? }.
 */
async function chat({ messages, tools, maxTokens = 600, toolChoice = 'auto' }) {
  const s = settings();
  if (!s.connected) return { ok: false, notConnected: true, error: CONNECT_HINT };
  const t = target(s);
  if (!t.model) return { ok: false, error: `no model is chosen for ${NAMES[t.provider]} - set one in Hosted AI settings` };
  const req = { messages, tools, maxTokens, toolChoice };
  const r = t.provider === 'anthropic' ? await anthropic(t, req) : await openaiStyle(t, req);
  return Object.assign(r, { provider: t.provider, model: t.model });
}

/** Is the model there? { configured, connected, reachable, provider, name, model, where, models, error } - a quick look,
 *  never a failure. */
async function look(t) {
  const headers = t.provider === 'anthropic' ? { authorization: 'Bearer ' + t.key, 'anthropic-version': ANTHROPIC_VERSION } : { authorization: 'Bearer ' + t.key };
  if (t.provider === 'anthropic' && t.workspaceId) headers['anthropic-workspace-id'] = t.workspaceId;
  try {
    const r = await fetch(t.url + '/models', { headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
    let j = null; try { j = await r.json(); } catch {}
    const ids = (j && Array.isArray(j.data) ? j.data : []).map(m => m && m.id).filter(Boolean);
    return { reachable: r.ok, error: r.ok ? null : 'answered ' + r.status, models: ids.slice(0, 40), modelListed: ids.length ? ids.includes(t.model) : null };
  } catch (e) { return { reachable: false, error: scrub(why(e), t.key) }; }
}
async function status() {
  const s = settings();
  const base = { provider: s.provider, name: NAMES[s.provider], model: s.cloudModel, quickModel: null, connected: s.connected, enabled: s.enabled };
  if (!s.enabled) return Object.assign({ configured: false, reachable: false, connect: null }, base);
  if (!s.connected) return Object.assign({ configured: false, reachable: false, connect: CONNECT_HINT }, base);
  return Object.assign({ configured: true,
    where: `Your requests, and what the assistant looks up to answer them, go to ${NAMES[s.provider]} on your own API key. Customers are named by first name and last initial only; phone numbers and email addresses are never sent.` },
    base, await look(target(s)));
}

module.exports = { chat, status, settings, hasQuick, toAnthropic, DEFAULT_ENDPOINT, PROVIDERS, NAMES, CONNECT_HINT };
