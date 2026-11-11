#!/usr/bin/env node
// Writes mcp/owner-actions.json: the Assistant's action list (names, what each
// does, and the values each takes) as plain data for the SSH bridge, which runs
// apart from the app and never loads its code. Run after changing an action:
//   node scripts/gen-owner-actions.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function catalogue() {
  const actions = require('../services/assistant/actions');
  return {
    areas: Object.fromEntries(actions.AREAS.map(area => [area, actions.AREA_SAY[area] || area])),
    actions: actions.ACTIONS.filter(a => !['more_tools', 'ask_owner'].includes(a.name)).map(a => ({
      name: a.name,
      area: a.area || 'core',
      changes: a.kind === 'write',
      asksFirst: a.kind === 'write' && (typeof a.confirm === 'function' ? 'sometimes' : !!a.confirm),
      does: a.say,
      params: a.params || { type: 'object', properties: {} },
    })),
  };
}

const file = path.join(__dirname, '..', 'mcp', 'owner-actions.json');
if (require.main === module) {
  fs.writeFileSync(file, JSON.stringify(catalogue(), null, 1) + '\n');
  console.log('Wrote ' + path.relative(process.cwd(), file));
}
module.exports = { catalogue, file };
