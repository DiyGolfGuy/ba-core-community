// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/connections.js - PAYMENTS, EMAIL AND TEXTING, CHECKED AND TESTED BY TALKING (BA Core 2 AI,
// Oct 20 2026, latest). Built with the helpers services/assistant/actions.js hands every area.
//
// maintainer: "payments resend twilio basicly all the things we have proven before and on real devices so make sure the ai can
// drive that". The keys themselves are pasted into the chat, where the owner's page saves them (secrets.js) and the
// assistant never sees them. These drive what the owner's screens already do, through the same routes: whether each
// service is connected and what is missing (the setup checklist's own judgement, services/stripestatus.js for Stripe), a
// test email and a test text to the owner's own address and mobile (routes/admin.js /messages/test-*), the card readers
// (routes/terminal.js - pairing, removing, the tip prompt), and the refunds made in Stripe's own dashboard picked up now
// (/api/admin/refunds/check, rule 39).
'use strict';

module.exports = (H) => {
  const { ActionError } = H;
  const getJson = async (ctx, path) => {
    const r = await ctx.call('GET', path);
    if (!r || r.status >= 400) throw new Error((r && r.json && r.json.error) || `it answered ${r ? r.status : 'nothing'}`);
    return r.json || {};
  };
  const soft = async (ctx, path) => { try { return await getJson(ctx, path); } catch { return null; } };
  const when = (iso) => { const t = Date.parse(iso || ''); if (!t) return null; const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 120 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
  const TIPS = { off: 'off - never asks for a tip', server: 'on - the tip goes to the employee who rang it', pooled: 'on - tips pooled for the house', manual: 'staff enter tips by hand (no prompt on the reader)' };

  // the card readers as the counter's own card shows them (routes/terminal.js GET /readers) - their names, never more
  const loaders = {
    cardReaders: async (ctx) => { const j = await soft(ctx, '/api/terminal/readers'); return j ? { readers: (j.readers || []).map(r => ({ id: r.id, label: r.label || 'Reader' })), def: j.default || null } : { error: true }; },
  };
  const readerOf = (ctx, said) => {
    const R = ctx.cardReaders; if (!R || R.error) throw new ActionError('the card readers could not be read just now - try again in a moment');
    const n = String(said || '').trim().toLowerCase();
    const hit = R.readers.filter(r => r.label.toLowerCase() === n).concat(R.readers.filter(r => r.label.toLowerCase().includes(n) && r.label.toLowerCase() !== n));
    if (!R.readers.length) throw new ActionError('there are no card readers paired');
    if (!n && R.readers.length === 1) return R.readers[0];
    if (!hit.length) throw new ActionError(`no reader called "${said}" - the readers: ${R.readers.map(r => r.label).join(', ')}`);
    if (hit.length > 1 && hit[0].label.toLowerCase() !== n) throw new ActionError(`${hit.length} readers match "${said}" - say which: ${hit.map(r => r.label).join(', ')}`);
    return hit[0];
  };

  const actions = [
    // the setup checklist's own judgement of each (routes/admin.js setup-status - Stripe through services/stripestatus.js),
    // Stripe Tax (GET /api/admin/stripetax/status), the readers, and when Stripe was last asked for refunds
    { name: 'connections_read', area: 'money', kind: 'read',
      say: 'Whether payments, email and texting are connected and what is missing for each: Stripe (connected, test or live, anything wrong), Stripe Tax, the card readers, when refunds made in Stripe were last picked up; email (Resend - the key and the From address); texting (Twilio - the account and the number). Keys are pasted into this chat to save them - you never see them',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const st = await soft(ctx, '/api/admin/setup-status'), item = (id) => ((st && st.items) || []).find(x => x.id === id) || null;
        const said = (it, none) => (!it ? none : it.done ? 'connected' + (it.sub ? ` (${it.sub})` : '') : `not yet - ${it.label}${it.sub && it.sub !== 'Optional' ? ': ' + it.sub : ''}`);
        const [tax, readers, refunds] = await Promise.all([soft(ctx, '/api/admin/stripetax/status'), soft(ctx, '/api/terminal/readers'), soft(ctx, '/api/admin/refunds/status')]);
        const last = refunds && refunds.last;
        return {
          stripe: said(item('stripe'), 'could not be read'),
          stripe_tax: !tax ? undefined : tax.configured ? (tax.settings_active ? 'on Stripe\'s side: set up' : 'on Stripe\'s side: not active yet - finish it in Stripe') : 'not in use (the rates on the Point of Sale - Tax Codes card are used)',
          card_readers: !readers ? undefined : (readers.readers || []).length ? (readers.readers || []).map(r => `${r.label || 'Reader'}${r.live && r.live.status ? ' (' + r.live.status + ')' : ''}${r.id === readers.default ? ' - the default' : ''}`) : 'none paired',
          tip_prompt: readers && readers.tips ? TIPS[readers.tips.mode] || readers.tips.mode : undefined,
          refunds_from_stripe: !refunds || !refunds.stripe ? undefined : last ? `last picked up ${when(last.at) || last.at}${last.recorded ? `, ${last.recorded} new` : ''}${last.error ? ' - it could not finish: ' + String(last.error).slice(0, 120) : ''}` : 'not checked yet',
          email: said(item('resend'), 'could not be read'),
          texting: said(item('twilio'), 'could not be read'),
          keys: 'paste a Stripe, Resend or Twilio key into this chat and the page saves it - you never see it'
        };
      } },
    { name: 'email_test_send', area: 'messages', kind: 'write', confirm: false,
      say: 'Send a test email to the facility\'s own email address, through the same sender every booking email uses - it says whether it went, or what is missing (the key, the From address, the facility\'s email)',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'POST', path: '/api/admin/messages/test-email', body: {} }),
      describe: () => 'A test email to your facility email, sent the way every booking email goes' },
    { name: 'text_test_send', area: 'messages', kind: 'write', confirm: false,
      say: 'Send a test text to the owner\'s own mobile (the owner alerts number), through the same sender every booking text uses - it says whether it went, or what is missing',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'POST', path: '/api/admin/messages/test-text', body: {} }),
      describe: () => 'A test text to your own mobile, sent the way every booking text goes' },
    { name: 'card_readers_read', area: 'money', kind: 'read',
      say: 'The card readers at the counter: each one\'s name, whether it is online, which is the default, and the tip prompt',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        let j; try { j = await getJson(ctx, '/api/terminal/readers'); } catch (e) { return { error: String(e.message).slice(0, 200), routeSaid: true }; }
        return { readers: (j.readers || []).length ? j.readers.map(r => `${r.label || 'Reader'}${r.live && r.live.status ? ' (' + r.live.status + ')' : ''}${r.id === j.default ? ' - the default' : ''}`) : 'none paired',
          tip_prompt: j.tips ? TIPS[j.tips.mode] || j.tips.mode : undefined, simulated: j.simulated ? 'Stripe test mode: readers here are simulated' : undefined };
      } },
    // POST /api/terminal/readers (routes/terminal.js:30, owner) - Stripe pairs it by the three words on its screen
    { name: 'card_reader_add', area: 'money', kind: 'write', confirm: true,
      say: 'Pair a Stripe card reader: the three-word pairing code its screen shows (like "apple-grape-orange") and a name for it ("Front Counter"). The first reader becomes the default',
      params: { type: 'object', properties: { code: { type: 'string', minLength: 5, maxLength: 60, description: 'the pairing code on the reader\'s screen' }, name: { type: 'string', maxLength: 40, description: 'what to call it; "Front Counter" when not said' } }, required: ['code'] },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/terminal/readers', body: { registration_code: String(a.code).trim().toLowerCase(), label: (a.name || 'Front Counter').trim() } }),
      describe: (a) => `Pair the card reader showing "${String(a.code).trim().toLowerCase()}" as "${(a.name || 'Front Counter').trim()}" - the counter can take cards on it once it shows as online` },
    { name: 'card_reader_remove', area: 'money', kind: 'write', confirm: true, needs: ['cardReaders'],
      say: 'Unpair a card reader by its name - the counter stops offering it',
      params: { type: 'object', properties: { reader: { type: 'string', maxLength: 40, description: 'its name' } } },
      build: (a, ctx) => { const r = readerOf(ctx, a.reader); return { op: 'http', method: 'DELETE', path: '/api/terminal/readers/' + encodeURIComponent(r.id) }; },
      describe: (a, ctx) => `Unpair the card reader "${readerOf(ctx, a.reader).label}" - the counter stops offering it` },
    // POST /api/terminal/settings (routes/terminal.js) - the reader card's own tip setting
    { name: 'tip_prompt_set', area: 'money', kind: 'write', confirm: true,
      say: 'Set the tip prompt on the card reader: off (never asks), server (the tip goes to the employee who rang it), pooled (tips pooled for the house), or manual (staff enter tips, no prompt). The owner chooses - tips are the staff\'s, never revenue',
      params: { type: 'object', properties: { mode: { type: 'string', enum: ['off', 'server', 'pooled', 'manual'] } }, required: ['mode'] },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/terminal/settings', body: { tipMode: a.mode } }),
      describe: (a) => `The tip prompt on the card reader: ${TIPS[a.mode]}` },
    // THE COUNTER'S SWITCHES (the wizard's money step, The Counter card): whether staff may take cash and checks
    { name: 'counter_payments_set', area: 'money', kind: 'write', confirm: true,
      say: 'Whether staff may take cash, and checks, at the counter (card is always there when a reader or Stripe is set up) ("no more checks", "we take cash now")',
      params: { type: 'object', properties: { cash: { type: 'boolean' }, check: { type: 'boolean' } } },
      build: (a) => {
        const set = [];
        if (a.cash !== undefined) set.push(['pos.payments.cash', !!a.cash]);
        if (a.check !== undefined) set.push(['pos.payments.check', !!a.check]);
        if (!set.length) throw new ActionError('say cash, checks, or both - on or off');
        return { op: 'config', set };
      },
      describe: (a) => 'At the counter: ' + [a.cash !== undefined && (a.cash ? 'staff can take cash' : 'no cash - card only'), a.check !== undefined && (a.check ? 'staff can take a check' : 'no checks')].filter(Boolean).join(', ') },
    // POST /api/admin/refunds/check (owner) - the owner's "Check Stripe now" (rule 39)
    { name: 'stripe_refunds_check', area: 'money', kind: 'write', confirm: false,
      say: 'Pick up refunds made in Stripe\'s own dashboard now (the unit also asks at boot and every night): each is taken off revenue on the day the money went back',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'POST', path: '/api/admin/refunds/check', body: {} }),
      describe: () => 'Ask Stripe now for refunds made in its dashboard, so revenue takes them off' },
  ];

  return { actions, loaders };
};
