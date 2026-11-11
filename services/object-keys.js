'use strict';

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Walk arrays as well as objects. Iteration avoids exhausting the call stack
// on nested input before it reaches a request handler or configuration merge.
function inspectObjectKeys(value, remove = false) {
  const pending = [value];
  const seen = new WeakSet();
  let found = false;
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const key of Object.keys(item)) {
      if (PROTOTYPE_KEYS.has(key)) {
        if (!remove) return true;
        delete item[key];
        found = true;
      } else if (item[key] && typeof item[key] === 'object') {
        pending.push(item[key]);
      }
    }
  }
  return found;
}

function hasPrototypeKeys(value) {
  return inspectObjectKeys(value);
}

function stripPrototypeKeys(value) {
  return inspectObjectKeys(value, true);
}

module.exports = { hasPrototypeKeys, stripPrototypeKeys };
