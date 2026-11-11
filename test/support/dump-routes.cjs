// Preload: after the app starts listening, write every mounted route (METHOD path) to BA_ROUTES_OUT and exit.
const express = require(require('path').join(process.cwd(), 'node_modules', 'express'));
const listen = express.application.listen;
express.application.listen = function (...args) {
  const server = listen.apply(this, args);
  const out = [];
  const prefixOf = (layer) => {
    if (layer.regexp.fast_slash) return '';
    const m = /^\/\^((?:\\\/[^\\?]+)+)\\\/\?\(\?=\\\/\|\$\)\/i$/.exec(String(layer.regexp));
    return m ? m[1].replace(/\\\//g, '/') : '<' + String(layer.regexp) + '>';
  };
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) for (const method of Object.keys(layer.route.methods)) out.push(method.toUpperCase() + ' ' + prefix + layer.route.path);
      else if (layer.handle && layer.handle.stack) walk(layer.handle.stack, prefix + prefixOf(layer));
    }
  };
  walk(this._router.stack, '');
  require('fs').writeFileSync(process.env.BA_ROUTES_OUT, [...new Set(out)].sort().join('\n') + '\n');
  setTimeout(() => process.exit(0), 200);
  return server;
};
