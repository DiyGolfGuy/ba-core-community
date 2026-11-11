#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const http = require('node:http');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const { join } = require('node:path');
const installed = __dirname === '/usr/local/lib/ba-core';
const { GUIDE_FILES, guidePage, searchGuides } = require(installed ? './installed-guides' : '../services/installed-guides');
const guideDirectory = installed ? join(__dirname, 'guides') : undefined;
// The Assistant's action list as plain data (scripts/gen-owner-actions.js). The bridge only reads it: it never loads the
// app's code, reads its database or settings, or sends anything to it.
let OWNER_ACTIONS = { areas: {}, actions: [] };
try { OWNER_ACTIONS = JSON.parse(require('node:fs').readFileSync(join(__dirname, 'owner-actions.json'), 'utf8')); } catch { /* an older install: no action tools */ }
const ACTION_BY_NAME = new Map(OWNER_ACTIONS.actions.map(action => [action.name, action]));

const runFile = promisify(execFile);
const TIMEOUT_MS = 2_000;
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ACTIVE_STATES = new Set([
  'active', 'inactive', 'activating', 'deactivating', 'failed',
  'reloading', 'refreshing', 'maintenance',
]);
const HEALTH_TOOL = {
  name: 'get_service_health',
  description: 'Check the BA Core and optional Cloudflare connector services and the local BA Core HTTP response.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const PROPOSAL_TOOL = {
  name: 'prepare_booking_settings',
  description: 'Prepare a line the owner can paste into BA Core Admin chat to review changes to booking hours or price. Return the line verbatim so the owner can copy it.',
  inputSchema: {
    type: 'object',
    properties: {
      openTime: { type: 'string', maxLength: 5, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', description: 'Opening time in 24-hour HH:MM' },
      closeTime: { type: 'string', maxLength: 5, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', description: 'Closing time in 24-hour HH:MM' },
      pricePerHalfHour: { type: 'number', minimum: 0, maximum: 10_000, multipleOf: 0.01, description: 'Base price in USD per half hour' },
    },
    dependentRequired: { openTime: ['closeTime'], closeTime: ['openTime'] },
    minProperties: 1,
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const SEARCH_GUIDES_TOOL = {
  name: 'search_owner_guides',
  description: 'Search the owner guides shipped with this BA Core version for relevant sections and Admin instructions.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 500 } }, required: ['query'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const READ_GUIDE_TOOL = {
  name: 'read_owner_guide',
  description: 'Read a bundled owner guide. Use the returned nextOffset to read the next part.',
  inputSchema: { type: 'object', properties: { file: { type: 'string', enum: GUIDE_FILES }, offset: { type: 'integer', minimum: 0 } },
    required: ['file'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const LIST_ACTIONS_TOOL = {
  name: 'list_owner_actions',
  description: 'List what the BA Core Assistant can do for the owner (menu, website, bookings, members, bays, messages, money and more). Filter by area or by words; then use describe_owner_action for the values one action takes.',
  inputSchema: { type: 'object', properties: {
    area: { type: 'string', maxLength: 40, description: 'One area name from a previous call, such as menu or website' },
    query: { type: 'string', maxLength: 200, description: 'Words to look for in what an action does' } }, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const DESCRIBE_ACTION_TOOL = {
  name: 'describe_owner_action',
  description: 'Describe one Assistant action by name: what it does and the JSON Schema of the values it takes.',
  inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['name'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const PREPARE_ACTION_TOOL = {
  name: 'prepare_action',
  description: 'Prepare one Assistant action as a line the owner pastes into the BA Core Assistant page, where it is checked and shown as a card to approve. This changes nothing on the Pi. Return the line verbatim so the owner can copy it. Use only values the owner gave you.',
  inputSchema: { type: 'object', properties: {
    name: { type: 'string', minLength: 1, maxLength: 80, description: 'An action name from list_owner_actions' },
    args: { type: 'object', description: 'The values, following describe_owner_action' } }, required: ['name'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

function listOwnerActions(args) {
  if (args !== undefined && (!isObject(args) || Object.keys(args).some(key => !['area', 'query'].includes(key)))) return null;
  const area = args?.area, query = args?.query;
  if ((area !== undefined && (typeof area !== 'string' || area.length > 40)) || (query !== undefined && (typeof query !== 'string' || query.length > 200))) return null;
  const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1);
  const found = OWNER_ACTIONS.actions.filter(action => (!area || action.area === area) &&
    words.every(word => (action.name + ' ' + action.does).toLowerCase().includes(word)));
  return { areas: OWNER_ACTIONS.areas, matching: found.length,
    actions: found.slice(0, 40).map(action => ({ name: action.name, area: action.area, changes: action.changes,
      does: action.does.length > 220 ? action.does.slice(0, 220) + '...' : action.does })) };
}

// A shape check only: the Assistant applies the full rules when the owner pastes the line.
function prepareAction(args) {
  if (!isObject(args) || Object.keys(args).some(key => !['name', 'args'].includes(key)) || typeof args.name !== 'string') return null;
  const action = ACTION_BY_NAME.get(args.name);
  const values = args.args === undefined ? {} : args.args;
  if (!action || !isObject(values)) return null;
  const allowed = action.params?.properties || {};
  if (Object.keys(values).some(key => !Object.hasOwn(allowed, key))) return null;
  if ((action.params?.required || []).some(key => !Object.hasOwn(values, key))) return null;
  const line = 'BA-CORE-ACTION ' + JSON.stringify({ name: action.name, args: values });
  return line.length > 20_000 || /[\r\n]/.test(line) ? null : line;
}

async function readService(unit, run = runFile) {
  const result = await run('/usr/bin/systemctl', [
    '--no-pager', 'show', '--property=LoadState', '--property=ActiveState', unit,
  ], {
    timeout: TIMEOUT_MS,
    maxBuffer: 2_048,
    env: { PATH: '/usr/bin:/bin', LANG: 'C' },
  }).catch(error => ({ stdout: error.stdout }));

  // Allowlist values so unexpected command output never leaves the Pi.
  const lines = String(result.stdout || '').split('\n');
  if (lines.includes('LoadState=not-found')) return 'not-installed';
  if (lines.includes('LoadState=masked')) return 'masked';
  if (!lines.includes('LoadState=loaded')) return 'unknown';
  const active = lines.find(line => line.startsWith('ActiveState='))?.slice(12);
  return ACTIVE_STATES.has(active) ? active : 'unknown';
}

function readLocalHttp(request = http.request) {
  return new Promise(resolve => {
    const check = request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/',
      method: 'HEAD',
      agent: false,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }, response => {
      response.destroy();
      const status = response.statusCode;
      resolve(Number.isInteger(status) && status >= 100 && status <= 599 ? status : null);
    });
    check.on('error', () => resolve(null));
    check.end();
  });
}

async function inspectHealth(readUnit = readService, readHttp = readLocalHttp) {
  const [baCore, cloudflared, localHttpStatus] = await Promise.all([
    readUnit('ba-core.service'),
    readUnit('cloudflared.service'),
    readHttp(),
  ]);
  return { baCore, cloudflared, localHttpStatus };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function prepareBookingSettings(args) {
  const fields = PROPOSAL_TOOL.inputSchema.properties;
  if (!isObject(args) || !Object.keys(args).length || Object.keys(args).some(key => !Object.hasOwn(fields, key))) {
    return null;
  }
  const hasHours = Object.hasOwn(args, 'openTime') || Object.hasOwn(args, 'closeTime');
  const hasPrice = Object.hasOwn(args, 'pricePerHalfHour');
  const proposal = {};
  if (hasHours) {
    const time = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    if (args.openTime === args.closeTime ||
        !['openTime', 'closeTime'].every(key => typeof args[key] === 'string' && args[key].length === 5 && time.test(args[key]))) {
      return null;
    }
    proposal.openTime = args.openTime;
    proposal.closeTime = args.closeTime;
  }
  if (hasPrice) {
    const price = args.pricePerHalfHour;
    if (typeof price !== 'number' || price > 10_000 || !/^\d+(?:\.\d{1,2})?$/.test(String(price))) {
      return null;
    }
    proposal.pricePerHalfHour = price;
  }
  return 'BA-CORE-PROPOSAL ' + JSON.stringify(proposal);
}

async function serve(input, output, inspect = inspectHealth) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  let initialized = false;
  const send = body => output.write(JSON.stringify({ jsonrpc: '2.0', ...body }) + '\n');
  const fail = (id, code, message) => send({ id, error: { code, message } });

  for await (const line of lines) {
    let message;
    try {
      if (Buffer.byteLength(line) > 64 * 1024) throw new Error();
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, 'Invalid JSON message');
      continue;
    }
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      fail(null, -32600, 'Invalid request');
      continue;
    }
    if (!Object.hasOwn(message, 'id')) continue;
    const { id, method, params } = message;
    if (!(typeof id === 'string' || Number.isInteger(id))) {
      fail(null, -32600, 'Invalid request ID');
      continue;
    }
    const reply = result => send({ id, result });
    if (method === 'initialize') {
      if (!isObject(params) || typeof params.protocolVersion !== 'string') {
        fail(id, -32602, 'A protocol version is required');
        continue;
      }
      initialized = true;
      reply({
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'ba-core-diagnostics', version: '0.1.0' },
      });
    } else if (method === 'ping') {
      reply({});
    } else if (!initialized) {
      fail(id, -32000, 'Initialize before using tools');
    } else if (method === 'tools/list') {
      reply({ tools: [HEALTH_TOOL, PROPOSAL_TOOL, SEARCH_GUIDES_TOOL, READ_GUIDE_TOOL,
        ...(OWNER_ACTIONS.actions.length ? [LIST_ACTIONS_TOOL, DESCRIBE_ACTION_TOOL, PREPARE_ACTION_TOOL] : [])] });
    } else if (method === 'tools/call') {
      if (params?.name === SEARCH_GUIDES_TOOL.name || params?.name === READ_GUIDE_TOOL.name) {
        const args = params.arguments;
        const allowed = params.name === SEARCH_GUIDES_TOOL.name ? SEARCH_GUIDES_TOOL.inputSchema.properties : READ_GUIDE_TOOL.inputSchema.properties;
        let result = null;
        if (isObject(args) && Object.keys(args).every(key => Object.hasOwn(allowed, key))) {
          if (params.name === SEARCH_GUIDES_TOOL.name) {
            if (typeof args.query === 'string' && args.query.trim() && args.query.length <= 500) {
              result = searchGuides(args.query, guideDirectory);
            }
          } else {
            result = guidePage(args.file, args.offset, guideDirectory);
          }
        }
        reply(result === null
          ? { isError: true, content: [{ type: 'text', text: 'Choose an installed guide and a valid offset, or supply a short search query.' }] }
          : { content: [{ type: 'text', text: JSON.stringify(result) }] });
        continue;
      }
      if ([LIST_ACTIONS_TOOL.name, DESCRIBE_ACTION_TOOL.name, PREPARE_ACTION_TOOL.name].includes(params?.name)) {
        let result = null;
        if (params.name === LIST_ACTIONS_TOOL.name) result = listOwnerActions(params.arguments);
        else if (params.name === PREPARE_ACTION_TOOL.name) result = prepareAction(params.arguments);
        else if (isObject(params.arguments) && Object.keys(params.arguments).length === 1 && typeof params.arguments.name === 'string') {
          const action = ACTION_BY_NAME.get(params.arguments.name);
          result = action ? { name: action.name, area: action.area, changes: action.changes, asksFirst: action.asksFirst, does: action.does, params: action.params } : null;
        }
        reply(result === null
          ? { isError: true, content: [{ type: 'text', text: 'Use an action name from list_owner_actions and only the values describe_owner_action lists, including every required one.' }] }
          : { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] });
        continue;
      }
      if (params?.name === PROPOSAL_TOOL.name) {
        const proposal = prepareBookingSettings(params.arguments);
        if (proposal === null) {
          reply({
            isError: true,
            content: [{ type: 'text', text: 'Provide different opening and closing times in 24-hour HH:MM, a USD price per half hour from 0 to 10000 with up to two decimal places, or both. For round-the-clock bookings, enter “set hours to 24/7” in BA Core Owner Chat.' }],
          });
          continue;
        }
        reply({ content: [{ type: 'text', text: proposal }] });
        continue;
      }
      if (params?.name !== HEALTH_TOOL.name || (params.arguments !== undefined &&
        (!isObject(params.arguments) || Object.keys(params.arguments).length !== 0))) {
        fail(id, -32602, 'Unknown tool or unsupported arguments');
        continue;
      }
      try {
        reply({ content: [{ type: 'text', text: JSON.stringify(await inspect()) }] });
      } catch {
        reply({ isError: true, content: [{ type: 'text', text: 'Service health could not be read.' }] });
      }
    } else {
      fail(id, -32601, 'Method not found');
    }
  }
}

if (require.main === module) {
  serve(process.stdin, process.stdout).catch(() => {
    process.stderr.write('BA Core diagnostics stopped.\n');
    process.exitCode = 1;
  });
}

module.exports = { inspectHealth, listOwnerActions, prepareAction, readLocalHttp, readService, serve };
