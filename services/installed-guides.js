'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const GUIDE_DIR = join(__dirname, '..', 'docs', 'customer-guides-current');
const GUIDE_TITLES = Object.freeze({
  'HOME-ASSISTANT-SECOND-PI.md': 'Home Assistant on a Second Raspberry Pi',
  'OPERATING-GUIDE.md': 'Day-to-day operations and recovery',
  'BA-CORE-MCP.md': 'Owner Chat and your AI client',
  'BAY-PC-SESSION-MONITOR.md': 'Windows bay Session Monitor',
  'DOMAIN-SETUP.md': 'Choose or move a domain',
  'CLOUDFLARE-TUNNEL.md': 'Connect your own Cloudflare Tunnel',
  'SERVICE-SETUP.md': 'Payments, messages, and equipment',
  'AI-CUSTOMIZE-CODE.md': 'Customize the source code with AI',
  'EVERYTHING-ASK-YOUR-AI.md': 'BA Core · Ask Your AI (first-time install and setup)',
  'OWNER-MANUAL.md': 'The complete owner manual (every feature, setting and setup chapter)',
});
const GUIDE_FILES = Object.keys(GUIDE_TITLES);
const SECTION_LIMIT = 3600;
const PAGE_LIMIT = 6000;
const STOP_WORDS = new Set('a an and are can could do does for from get how i in is it me my of on or our set that the their this to up use want what when where which with would you your'.split(' '));

function readGuide(file, directory) {
  if (!Object.hasOwn(GUIDE_TITLES, file)) return '';
  try {
    return readFileSync(join(directory, file), 'utf8');
  } catch {
    return '';
  }
}

function guidePage(file, offset = 0, directory = GUIDE_DIR) {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const body = readGuide(file, directory);
  if (!body || offset >= body.length) return null;
  const end = Math.min(offset + PAGE_LIMIT, body.length);
  return { file, title: GUIDE_TITLES[file], text: body.slice(offset, end),
    nextOffset: end < body.length ? end : null };
}

function words(text) {
  return new Set((text.toLowerCase()
    .replace(/z[\s-]*wave/g, 'zwave')
    .replace(/remote[\s-]*lock/g, 'remotelock')
    .match(/[a-z0-9]+/g) || []).filter(word => word.length > 1 && !STOP_WORDS.has(word)));
}

function sections(body) {
  const result = [];
  let heading = 'Overview';
  let lines = [];
  let inCode = false;
  function addSection() {
    const text = lines.join('\n').trim();
    if (text) result.push({ heading, text });
    lines = [];
  }
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const match = !inCode && /^#{1,6}\s+(.+)$/.exec(line);
    if (match) {
      addSection();
      heading = match[1];
    } else {
      lines.push(line);
    }
  }
  addSection();
  return result;
}

function searchGuides(query, directory = GUIDE_DIR) {
  if (typeof query !== 'string' || !query.trim() || query.length > 4000) return [];
  const terms = [...words(query)];
  const matches = [];
  for (const file of GUIDE_FILES) {
    for (const { heading, text } of sections(readGuide(file, directory))) {
      const headingTerms = words(heading);
      let best = null;
      let start = 0;
      while (start < text.length) {
        let end = Math.min(start + SECTION_LIMIT, text.length);
        const lineEnd = text.lastIndexOf('\n', end);
        if (end < text.length && lineEnd > start + SECTION_LIMIT / 2) end = lineEnd;
        const excerpt = text.slice(start, end).trim();
        const textTerms = words(excerpt);
        const score = terms.reduce((sum, term) => sum + (headingTerms.has(term) ? 5 : 0) + (textTerms.has(term) ? 1 : 0), 0);
        if (score && (!best || score > best.score)) best = { score, file, title: GUIDE_TITLES[file], heading, text: excerpt };
        start = end;
      }
      if (best) matches.push(best);
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 4).map(({ score, ...match }) => match);
}

module.exports = { GUIDE_DIR, GUIDE_FILES, GUIDE_TITLES, guidePage, searchGuides };
