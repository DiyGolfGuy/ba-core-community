'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_MODELS, DEFAULT_OUTPUT_TOKENS, EFFORT_OPTIONS, generationOptions } = require('./owner-ai-provider');

const file = path.join(__dirname, '..', 'owner-ai-secrets.json');

function validate(input) {
  const { provider, apiKey } = input || {};
  if (typeof provider !== 'string' || !Object.hasOwn(DEFAULT_MODELS, provider)) throw new RangeError('Choose OpenAI or Claude.');
  if (typeof apiKey !== 'string' || !/^[!-~]{16,512}$/.test(apiKey)) {
    throw new RangeError('Enter the complete provider API key without spaces.');
  }
  const model = input.model || DEFAULT_MODELS[provider];
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)) {
    throw new RangeError('Enter a valid provider model ID or leave it blank for the default.');
  }
  const workspaceId = provider === 'anthropic' ? input.workspaceId || '' : '';
  if (typeof workspaceId !== 'string' || (workspaceId && !/^wrkspc_[a-zA-Z0-9_-]{1,120}$/.test(workspaceId))) {
    throw new RangeError('Enter a Claude workspace ID beginning with wrkspc_, or leave it blank for a workspace-scoped key.');
  }
  if (model.includes(apiKey) || workspaceId.includes(apiKey)) {
    throw new RangeError('Enter the API key only in the API key field.');
  }
  return { provider, apiKey, model, workspaceId, ...generationOptions(provider, input) };
}

function read() {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > 4096 ||
        (process.geteuid && info.uid !== process.geteuid())) {
      throw new Error('Hosted AI credentials must be in a private service-owned file.');
    }
    return validate(JSON.parse(fs.readFileSync(fd, 'utf8')));
  } finally {
    fs.closeSync(fd);
  }
}

function write(settings) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function remove() {
  fs.rmSync(file, { force: true });
}

function status(settings) {
  return {
    provider: settings?.provider ?? null,
    model: settings?.model ?? null,
    workspaceId: settings?.workspaceId || null,
    effort: settings?.effort ?? null,
    maxOutputTokens: settings?.maxOutputTokens ?? null,
    reasoningMode: settings?.reasoningMode ?? null,
    defaultModels: DEFAULT_MODELS,
    defaultMaxOutputTokens: DEFAULT_OUTPUT_TOKENS,
    effortOptions: EFFORT_OPTIONS,
  };
}

module.exports = { validate, read, write, remove, status };
