// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/online.js - GETTING THE BOX ONLINE, BY TALKING (Oct 21 2026; branch
// feature/ai-edition). Built with the helpers services/assistant/actions.js hands every area.
//
// maintainer: "if they have a domain it gets pointed at the box ... as much on the customer as possible and as easy as possible for
// them to do it ... make sure the AI can do all of that and really guide them in a meaningfull way from real documents and
// tests." The steps the owner takes in their own Cloudflare account and at the company that sold them their domain are in
// the guide's chapter "Getting Your Box Online" (guide_chapter reads it); these are the box's part, through the owner's
// routes (routes/getonline.js, services/getonline.js): what the world sees of the domain, connecting the box (the chat's
// card shows Cloudflare's sign-in button - the link never passes through the model), and whether the site answers.
'use strict';

module.exports = (H) => {
  const { ActionError } = H;
  const getJson = async (ctx, path) => {
    const r = await ctx.call('GET', path);
    if (!r || r.status >= 400) throw new ActionError((r && r.json && r.json.error) || `it answered ${r ? r.status : 'nothing'}`);
    return r.json || {};
  };
  const STAGE = { starting: 'starting', 'waiting-for-signin': 'waiting for the owner to sign in to Cloudflare and tap Authorize',
    'making-the-tunnel': 'signed in - making the box\'s own connection', 'pointing-the-address': 'pointing the address at the box',
    'starting-the-connection': 'starting the connection', 'checking-from-outside': 'checking the address from outside',
    done: 'connected', failed: 'did not finish', cancelled: 'stopped', 'no-service': 'made, but this box has no tunnel service to run it' };
  const plainAddresses = (list) => (Array.isArray(list) ? list : [list]).map(x => String(x || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '')).filter(Boolean);
  const ADDR = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  const actions = [
    { name: 'online_read', area: 'online', kind: 'read',
      say: 'See how the box is online: the address(es) its site answers at, whether it answers from outside right now, whether its connection (the tunnel) is running, and a connection being made now (its stage, or why it did not finish)',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const s = await getJson(ctx, '/api/admin/getonline');
        const j = s.job;
        return {
          connected: s.connected ? `yes - at ${(s.addresses || []).join(', ')}` : 'not yet - say "connect my box" once the domain is on Cloudflare (domain_check says)',
          answers_from_outside: s.reachable === null ? undefined : (s.reachable ? 'yes' : 'not when last checked - site_check_now asks again'),
          connection_service: s.service === 'none' ? 'not on this box (see the Cloudflare Tunnel guide in Admin > Guides)' : s.service,
          connecting_now: j && !j.finishedAt ? STAGE[j.stage] || j.stage : undefined,
          last_try: j && j.finishedAt ? `${STAGE[j.stage] || j.stage}${j.error ? ' - ' + j.error : ''}` : undefined,
          program: s.program ? undefined : 'the connection program (cloudflared) is not installed - follow the Cloudflare Tunnel guide (Admin > Guides)' };
      } },
    { name: 'domain_check', area: 'online', kind: 'read',
      say: 'Look up a domain the way the world sees it, from the box: whether it is registered, whose nameservers it uses (on Cloudflare yet?), whether it receives email (those records must come across), whether DNSSEC is on (turned off at the old company before the nameservers change), and where the address points now (a current website?). Use it before connecting, and to answer "is my domain ready yet"',
      params: { type: 'object', properties: { domain: { type: 'string', minLength: 4, maxLength: 120, description: 'like yourgolf.com, or the address the site will use (book.yourgolf.com)' } }, required: ['domain'] },
      local: async (a, ctx) => {
        const j = await getJson(ctx, '/api/admin/getonline/domain?d=' + encodeURIComponent(a.domain));
        if (j.error && !j.zone) throw new ActionError(j.error);
        return j.error ? { domain: j.address, problem: j.error }
          : { domain: j.zone, address: j.address, registered: j.registered, on_cloudflare: j.onCloudflare, nameservers: j.nameservers, email_records: j.email && j.email.length ? j.email : undefined,
            dnssec_on: j.dnssec || undefined, points_to_now: j.pointsTo && j.pointsTo.length ? j.pointsTo : undefined, what_it_means: j.says };
      } },
    { name: 'box_connect', area: 'online', kind: 'write', confirm: true,
      say: 'Connect the box to the owner\'s own Cloudflare account so its site answers at their address: the chat shows a card with Cloudflare\'s sign-in button; the owner signs in, picks the domain and taps Authorize, and the box makes its own connection and the address record (it keeps only a key that runs this one connection). The domain must be on Cloudflare first (domain_check). replace_existing only when the owner said to replace what the address points to now',
      params: { type: 'object', properties: {
        addresses: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 4, maxLength: 120 }, description: 'where the site answers: the domain (yourgolf.com) and/or www.yourgolf.com, or a part of it (book.yourgolf.com)' },
        replace_existing: { type: 'boolean', description: 'true only when the owner said to replace what the address points to now (their current website)' } }, required: ['addresses'] },
      build: (a) => {
        const list = plainAddresses(a.addresses);
        const bad = list.find(x => !ADDR.test(x)); if (bad) throw new ActionError(`"${bad}" is not an address a site can answer at (like yourgolf.com or book.yourgolf.com)`);
        if (!list.length) throw new ActionError('say which address the site should answer at');
        return { op: 'connect', addresses: list, replace: a.replace_existing === true };
      },
      describe: (a) => {
        const list = plainAddresses(a.addresses);
        return `Connect the box at ${list.join(' and ')}: open Cloudflare's sign-in below, pick ${list[0].split('.').slice(-2).join('.')}, and tap Authorize. The box makes its own connection${a.replace_existing ? ` and REPLACES what ${list.join(' and ')} points to now` : ''} - it keeps only a key that runs this one connection, never your Cloudflare sign-in.`;
      } },
    { name: 'box_connect_stop', area: 'online', kind: 'write', confirm: false,
      say: 'Stop a connection that is waiting for the owner to sign in (to start again later)',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'DELETE', path: '/api/admin/getonline/connect' }),
      describe: () => 'Stop waiting for the Cloudflare sign-in' },
    { name: 'site_check_now', area: 'online', kind: 'write', confirm: false,
      say: 'Ask the box\'s own address from outside now, the way a visitor would ("is my site up yet") - after connecting, the address can take a few minutes to answer',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'POST', path: '/api/admin/getonline/check' }),
      describe: () => 'Check the site from outside now' },
  ];
  return { actions, loaders: {} };
};
