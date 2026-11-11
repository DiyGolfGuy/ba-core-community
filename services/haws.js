// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/haws.js  -  ONE CONVERSATION WITH HOME ASSISTANT OVER ITS WEBSOCKET
//  (Oct 19 2026)
//
//  The REST API (services/homeassistant.js) reads states and calls services. What
//  a hub OWNER does - pair a device, name it, list what is on the network, make a
//  token - Home Assistant offers only on its websocket. This is the client for
//  that: Node's own WebSocket (no dependency, rule 40), one session per job.
//
//  Built from Home Assistant's own source (2026.9.4, read in the workshop lab):
//   [W1] components/websocket_api: auth_required -> {type:"auth", access_token}
//        -> auth_ok | auth_invalid (then the socket closes); every command carries
//        an id that only increases; a command answers {id, type:"result",
//        success, result | error:{code, message}}; a subscription's events arrive
//        as {id, type:"event", event} with the command's own id - and may arrive
//        BEFORE its result (zwave_js/add_node sends "inclusion started" while the
//        controller is still being asked); {type:"unsubscribe_events",
//        subscription:id} ends any subscription (commands.py handle_unsubscribe_events
//        calls connection.subscriptions[id]).
//   [W2] the same file: ping -> pong.
//
//  A session never throws past its caller: open() rejects with an Error whose
//  .code is 'unreachable', 'auth_invalid', 'timeout' or 'closed'; call() rejects
//  with Home Assistant's own error code and message.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

const wsUrl = (httpUrl) => String(httpUrl || '').trim().replace(/\/+$/, '').replace(/^http/i, 'ws') + '/api/websocket';
const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * open({ url, token, timeoutMs }) -> session
 *   session.call(type, fields, timeoutMs)            -> result (rejects with { code, message })
 *   session.subscribe(type, fields, onEvent, ms)     -> { id, result, stop() }   (onEvent(event) for each event)
 *   session.onClose(fn)                               -> fn() once, when the socket goes
 *   session.close()
 *   session.haVersion
 */
function open({ url, token, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') return reject(fail('unreachable', 'this Node has no WebSocket'));
    if (!url) return reject(fail('unreachable', 'no Home Assistant address'));
    if (!token) return reject(fail('auth_invalid', 'no Home Assistant token'));
    let ws, opened = false, nextId = 0, closed = false;
    const pending = new Map();      // id -> { resolve, reject, timer }
    const subs = new Map();         // id -> onEvent
    const closers = [];
    const t = setTimeout(() => { if (!opened) { try { ws && ws.close(); } catch {} reject(fail('timeout', 'Home Assistant did not answer')); } }, timeoutMs);
    try { ws = new WebSocket(wsUrl(url)); } catch (e) { clearTimeout(t); return reject(fail('unreachable', String(e && e.message || e))); }
    const send = (o) => ws.send(JSON.stringify(o));
    const session = {
      haVersion: null,
      call(type, fields = {}, ms = 15000) {
        if (closed) return Promise.reject(fail('closed', 'the Home Assistant connection closed'));
        const id = ++nextId;
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(id); rej(fail('timeout', `Home Assistant did not answer ${type}`)); }, ms);
          pending.set(id, { resolve: res, reject: rej, timer });
          try { send(Object.assign({}, fields, { id, type })); } catch (e) { clearTimeout(timer); pending.delete(id); rej(fail('closed', String(e && e.message || e))); }
        });
      },
      async subscribe(type, fields, onEvent, ms = 15000) {
        if (closed) throw fail('closed', 'the Home Assistant connection closed');
        const id = nextId + 1;            // the id call() is about to use: events can come before the result [W1]
        subs.set(id, onEvent);
        try {
          const result = await session.call(type, fields, ms);
          return { id, result, stop: () => { subs.delete(id); return closed ? Promise.resolve() : session.call('unsubscribe_events', { subscription: id }, 5000).catch(() => {}); } };
        } catch (e) { subs.delete(id); throw e; }
      },
      onClose(fn) { if (closed) fn(); else closers.push(fn); },
      close() { try { ws.close(); } catch {} },
    };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data)); } catch { return; }
      if (msg.type === 'auth_required') { try { send({ type: 'auth', access_token: token }); } catch {} return; }
      if (msg.type === 'auth_ok') { opened = true; clearTimeout(t); session.haVersion = msg.ha_version || null; return resolve(session); }
      if (msg.type === 'auth_invalid') { clearTimeout(t); try { ws.close(); } catch {} return reject(fail('auth_invalid', msg.message || 'Home Assistant refused the token')); }
      if (msg.type === 'result' && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
        if (msg.success) p.resolve(msg.result); else p.reject(fail((msg.error && msg.error.code) || 'failed', (msg.error && msg.error.message) || 'Home Assistant refused it'));
        return;
      }
      if (msg.type === 'event' && subs.has(msg.id)) { try { subs.get(msg.id)(msg.event); } catch {} return; }
      if (msg.type === 'pong' && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); p.resolve('pong'); }
    };
    ws.onerror = () => { if (!opened) { clearTimeout(t); reject(fail('unreachable', 'could not reach Home Assistant at ' + url)); } };
    ws.onclose = () => {
      closed = true; clearTimeout(t);
      if (!opened) reject(fail('unreachable', 'Home Assistant closed the connection'));
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(fail('closed', 'the Home Assistant connection closed')); }
      pending.clear(); subs.clear();
      for (const fn of closers.splice(0)) { try { fn(); } catch {} }
    };
  });
}

/** One command on a session of its own: open, call, close. */
async function once(opts, type, fields, ms) {
  const s = await open(opts);
  try { return await s.call(type, fields, ms); } finally { s.close(); }
}

module.exports = { open, once, wsUrl };
