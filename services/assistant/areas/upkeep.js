// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/upkeep.js - THE UNIT ITSELF AND ITS DOORS' TIMING, BY TALKING (Oct 21 2026; branch
// feature/ai-edition). Built with the helpers services/assistant/actions.js hands every area.
//
// maintainer, Oct 21: "lets build the last things" - the gap audit's items 10 to 12 (BA-CORE-2-AI.md step 4): software updates
// (Settings > Protection > Software Updates - check, now, tonight after closing, called off, undone; the emailed file
// too), the owner's files (the Revenue tab's CSV, Bookings in Your Calendar's export, the hours export, the year-end
// report, the email sign-up list), and when a door code works and is texted (Settings > Devices > Door Access Provider).
// Each drives the route the owner's own card uses, so the same checks apply. A door is never opened, locked or given a
// code here - only the owner's numbers for when codes work.
'use strict';

module.exports = (H) => {
  const { ActionError, DATE } = H;
  const getJson = async (ctx, path) => {
    const r = await ctx.call('GET', path);
    if (!r || r.status >= 400) throw new ActionError((r && r.json && r.json.error) || `it answered ${r ? r.status : 'nothing'}`);
    return r.json || {};
  };
  const ago = (iso) => { const t = Date.parse(iso || ''); if (!t) return null; const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 120 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
  const mb = (n) => n ? (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0) + ' MB' : undefined;
  const STAGE = { downloading: 'fetching it', verifying: 'checking it is BA\'s', installing: 'installing it', scheduled: 'fetched and checked - it installs tonight after closing', done: 'installed', failed: 'it could not finish' };

  const loaders = {
    // the settings as the owner's Settings screen reads them (secrets stay masked by the route; only plain numbers are used)
    upkeepConfig: async (ctx) => { try { return await getJson(ctx, '/api/admin/config'); } catch { return null; } },
    // every booking still to come or under way (status active), for "does this bay still have bookings"
    upkeepBookings: async (ctx) => {
      try {
        const out = [];
        for (let page = 1, pages = 1; page <= pages && page <= 25; page++) {   // the route gives 200 a page
          const j = await getJson(ctx, `/api/admin/bookings?status=active&per_page=200&page=${page}`);
          pages = Number(j.pages) || 1;
          for (const b of j.bookings || []) out.push({ id: b.id, bay_id: b.bay_id, date: b.date });
        }
        return out.sort((x, y) => String(x.date).localeCompare(String(y.date)));
      } catch { return null; }
    },
  };
  const printerOf = (ctx, said) => {
    const list = cfgOf(ctx).printers || [], n = String(said || '').trim().toLowerCase();
    const hit = list.filter(p => String(p.name).toLowerCase() === n).concat(list.filter(p => String(p.name).toLowerCase().includes(n) && String(p.name).toLowerCase() !== n));
    if (!list.length) throw new ActionError('there are no printers yet - printer_add');
    if (!hit.length) throw new ActionError(`no printer called "${said}" (the printers: ${list.map(p => p.name).join(', ')})`);
    return hit[0];
  };
  const timeOf = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
  const cfgOf = (ctx) => { if (!ctx.upkeepConfig) throw new ActionError('the settings could not be read just now - try again'); return ctx.upkeepConfig; };
  // when a code works and when it is texted - the Door Access Provider card's own defaults (doorlock.codeWindowMins: the old
  // single buffer first, then 15 before / 30 after; the text 15 before; the lock checked first unless switched off)
  const timing = (c) => {
    const b = c.booking || {}, d = c.doorAccess || {}, set = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
    const legacy = set(b.doorCodeBufferMins) ? Number(b.doorCodeBufferMins) : null;
    return { before: set(b.doorCodeLeadMins) ? Number(b.doorCodeLeadMins) : (legacy ?? 15), after: set(b.doorCodeLagMins) ? Number(b.doorCodeLagMins) : (legacy ?? 30),
      text: set(d.textLeadMins) ? Number(d.textLeadMins) : 15, check: d.confirmBeforeText !== false };
  };
  const PROVIDER = { remotelock: 'RemoteLock', unifi: 'UniFi Access', ha: 'a lock on Home Assistant (Z-Wave)', none: 'no lock' };
  const yearNow = (ctx) => Number(String(ctx.today || '').slice(0, 4)) || new Date().getFullYear();
  const RANGE = { from: { ...DATE, description: 'the first day (YYYY-MM-DD)' }, to: { ...DATE, description: 'the last day (YYYY-MM-DD)' } };
  const range = (a, ctx) => {
    const to = a.to || ctx.today, from = a.from || (String(ctx.today || '').slice(0, 8) + '01');
    if (from > to) throw new ActionError('the first day must be on or before the last');
    return [from, to];
  };

  const actions = [
    // ── SOFTWARE UPDATES (Settings > Protection > Software Updates; rule 35: nothing installs without the owner's word) ──
    { name: 'updates_read', area: 'unit', kind: 'read',
      say: 'See the software: the version this unit runs, whether BA has an update waiting for it and what it is, one being fetched or set for tonight, when the unit last asked BA, whether it asks by itself each day, and whether the last update can be undone',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const [on, st] = await Promise.all([getJson(ctx, '/api/admin/update/online'), getJson(ctx, '/api/admin/update/status')]);
        const o = on.offer, j = on.job;
        return {
          running: st.label || (st.version && st.version.tag) || 'unknown',
          waiting: o ? { update: o.tag, what_it_is: o.summary || undefined, size: mb(o.size), published: o.published || undefined } : (on.ended ? `nothing - the updates included with this unit ended on ${on.ended}` : 'nothing new'),
          in_progress: j ? { update: j.tag, when: j.when === 'tonight' ? 'tonight after closing' : 'now', stage: STAGE[j.stage] || j.stage, problem: j.error || undefined } : undefined,
          set_for_tonight: st.scheduled ? `${st.scheduled.version} - installs between ${st.scheduled.window || '2 and 6 AM'} when no session is on or near` : undefined,
          last_asked_ba: on.configured ? (ago(on.lastCheck) || 'not yet') : 'never - this unit has no update address (an update file BA emails still works)',
          last_answer: on.lastResult === 'refused' ? 'refused - the list was not BA\'s' : on.lastNote || undefined,
          asks_by_itself_each_day: !!on.autoCheck,
          can_undo_last_update: !!st.canRollback, last_undone: st.lastRollback ? (st.lastRollback.from ? `${st.lastRollback.from} back to ${st.lastRollback.to}` : true) : undefined,
          checking_after_restart: st.pending ? 'the last update is still being checked' : undefined };
      } },
    { name: 'updates_check', area: 'unit', kind: 'write', confirm: false,
      say: 'Ask BA\'s update list now whether there is an update for this unit (it also asks by itself each day). Then updates_read says what came back',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'POST', path: '/api/admin/update/online/check' }),
      describe: () => 'Check BA\'s update list for this unit now' },
    { name: 'update_install', area: 'unit', kind: 'write', confirm: true,
      say: 'Install the update BA has waiting (updates_read first): tonight after closing (recommended - between 2 and 6 AM, when no session is on or near) or now. Now restarts the unit in a minute or two and this chat starts over. An update that breaks booking undoes itself',
      params: { type: 'object', properties: { when: { type: 'string', enum: ['tonight', 'now'] } }, required: ['when'] },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/admin/update/online/install', body: { when: a.when } }),
      describe: (a) => a.when === 'now' ? 'Install the waiting update now: the unit fetches only what it needs, checks it is BA\'s, installs it and restarts - bookings are refused for a minute or two, and this chat starts over when it is back. If booking does not work after it, it undoes itself'
        : 'Install the waiting update tonight after closing: fetched and checked now, installed between 2 and 6 AM when no session is on or near' },
    { name: 'update_tonight_cancel', area: 'unit', kind: 'write', confirm: true,
      say: 'Call off an update set to install tonight (it stays available to install later) ("skip tonight\'s update", "not tonight after all")',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'DELETE', path: '/api/admin/update/schedule' }),
      describe: () => 'Call off tonight\'s update - nothing installs tonight; it can be installed later' },
    { name: 'update_undo', area: 'unit', kind: 'write', confirm: true,
      say: 'Undo the last update: put back the version before it (only when updates_read says it can be undone). The unit restarts and this chat starts over',
      params: { type: 'object', properties: {} },
      build: () => ({ op: 'http', method: 'POST', path: '/api/admin/update/rollback' }),
      describe: () => 'Undo the last update: the version before it comes back and the unit restarts - bookings are refused for a minute or two, and this chat starts over when it is back' },
    { name: 'updates_auto_check_set', area: 'unit', kind: 'write', confirm: false,
      say: 'Whether the unit asks BA\'s update list by itself once a day (it only asks - nothing installs without the owner)',
      params: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/admin/update/online/auto', body: { on: a.on } }),
      describe: (a) => a.on ? 'Ask BA\'s update list by itself once a day (nothing installs without you)' : 'Stop asking BA\'s update list by itself - only when you tap Check' },
    { name: 'update_file_install', area: 'unit', kind: 'write', confirm: true,
      say: 'Install an update FILE BA emailed (a .zip): the chat shows a button to pick it; tonight after closing (recommended) or now. Only a file BA signed installs',
      params: { type: 'object', properties: { when: { type: 'string', enum: ['tonight', 'now'] } }, required: ['when'] },
      build: (a) => ({ op: 'upload', route: a.when === 'now' ? '/api/admin/update/apply' : '/api/admin/update/schedule', field: 'pack', accept: '.zip,application/zip', label: 'Choose the update file' }),
      describe: (a) => a.when === 'now' ? 'Install the update file BA sent you, now: pick the .zip - only a file BA signed installs, and the unit restarts (this chat starts over)'
        : 'Install the update file BA sent you, tonight after closing: pick the .zip - it is checked now and installed between 2 and 6 AM when no session is on or near' },

    // ── THE OWNER'S FILES (the Revenue tab, Bookings in Your Calendar, the hours, the year-end report, the sign-up list) ──
    { name: 'export_file', area: 'unit', kind: 'write', confirm: false,
      say: 'A file of the owner\'s records to download from the chat: revenue (a CSV of money taken and refunded), bookings (a spreadsheet, a CSV, or a calendar file for their phone\'s calendar), hours (the staff hours for a pay period), the year-end report (the zip for the accountant - no customer names unless asked, and then it needs the backup passphrase), or the email sign-up list. The tax spreadsheet is tax_export',
      params: { type: 'object', properties: Object.assign({
        what: { type: 'string', enum: ['revenue', 'bookings', 'hours', 'year_report', 'email_list'] },
        format: { type: 'string', enum: ['xlsx', 'csv', 'ics'], description: 'bookings only: xlsx (a spreadsheet - the usual), csv, or ics (a calendar file)' },
        with_names: { type: 'boolean', description: 'bookings: customer names (yes when not said); the year-end report: names (no when not said)' },
        with_contact: { type: 'boolean', description: 'bookings only: phone numbers and emails too' },
        year: { type: 'integer', minimum: 2000, maximum: 2100, description: 'the year-end report\'s year (this year so far when not said)' } }, RANGE), required: ['what'] },
      build: (a, ctx) => {
        if (a.what === 'revenue') { const [f, t] = range(a, ctx); return { op: 'download', path: `/api/admin/revenue/csv?from=${f}&to=${t}`, label: 'Download the revenue CSV' }; }
        if (a.what === 'bookings') { const [f, t] = range(a, ctx); const fmt = a.format || 'xlsx'; return { op: 'download', path: `/api/admin/bookings/export?from=${f}&to=${t}&format=${fmt}&names=${a.with_names === false ? 0 : 1}${a.with_contact ? '&contact=1' : ''}`, label: `Download the bookings (${fmt === 'ics' ? 'calendar file' : fmt.toUpperCase()})` }; }
        if (a.what === 'hours') { const [f, t] = range(a, ctx); return { op: 'download', path: `/api/staff/hours/export?start=${f}&end=${t}`, label: 'Download the hours' }; }
        if (a.what === 'year_report') { const y = a.year || yearNow(ctx); if (y > yearNow(ctx)) throw new ActionError(`${y} has not started`); const yp = `/api/admin/records/year-report/${y}`; return { op: 'download', path: yp + (a.with_names ? '?names=1' : ''), label: `Download the ${y} year-end report` }; }
        return { op: 'download', path: '/api/website/subscribers.csv', label: 'Download the email sign-up list' };
      },
      describe: (a, ctx) => {
        const span = () => { const [f, t] = range(a, ctx); return f === t ? `for ${f}` : `from ${f} to ${t}`; };
        if (a.what === 'revenue') return `The revenue ${span()} as a CSV: money taken, refunds and what was kept, by day - the Revenue tab's own file.`;
        if (a.what === 'bookings') return `The bookings ${span()} as ${a.format === 'ics' ? 'a calendar file your phone\'s calendar opens' : a.format === 'csv' ? 'a CSV' : 'a spreadsheet'}${a.with_names === false ? ', without customer names' : ''}${a.with_contact ? ', with phone numbers and emails' : ''}.`;
        if (a.what === 'hours') return `The staff hours ${span()} as a CSV - the same file as the hours export.`;
        if (a.what === 'year_report') { const y = a.year || yearNow(ctx); return `The ${y} year-end report${y === yearNow(ctx) ? ' (so far)' : ''}: one zip for your accountant - a PDF, a workbook and the CSVs${a.with_names ? ', with customer names, encrypted with your backup passphrase' : ', with no customer names'}.`; }
        return 'The email sign-up list as a CSV - the people who asked for your emails.';
      } },

    // ── WHEN A DOOR CODE WORKS AND IS TEXTED (Settings > Devices > Door Access Provider). maintainer, Oct 3 2026: codes made ahead,
    //    texted 15 minutes before, working until 30 after - the owner's numbers. The code itself never passes through here ──
    { name: 'doors_read', area: 'doors', kind: 'read', needs: ['upkeepConfig'],
      say: 'See the door: which lock the codes go to (RemoteLock, UniFi Access, a Z-Wave lock on Home Assistant, or none), how long before and after a session a code works, how long before a session it is texted, and whether the lock is checked to hold the code before it is texted. Whether codes are working now is health_read',
      params: { type: 'object', properties: {} },
      local: (a, ctx) => {
        const c = cfgOf(ctx), t = timing(c), p = String((c.doorAccess || {}).provider || '').toLowerCase() || (c.remotelock && c.remotelock.clientId ? 'remotelock' : 'none');
        return { lock: PROVIDER[p] || p, staffed_no_codes: !!(c.booking && c.booking.staffedAccess) || undefined,
          code_works_before_session_mins: t.before, code_works_after_session_mins: t.after, texted_before_session_mins: t.text, lock_checked_before_texting: t.check,
          where: 'Settings > Devices > Door Access Provider' };
      } },
    { name: 'door_code_timing_set', area: 'doors', kind: 'write', confirm: true, needs: ['upkeepConfig'],
      // the owner's plain numbers (Oct 23 2026, the 4B three times over: "door codes should start working 30 minutes early" was looked
      // up, then claimed as done with nothing put up): "start working 30 minutes early", "an hour before", "stop working 15 minutes
      // after", "text it 20 minutes before" - only what was said, nothing filled in
      read: (words) => {
        const s = String(words || '').toLowerCase();
        if (!/\b(?:door )?codes?\b|\bpins?\b/.test(s)) return null;
        const mins = (n, u) => { const v = /^half/.test(n) ? 0.5 : /^an?$/.test(n) ? 1 : Number(n); return Math.round(/^h/.test(u) ? v * 60 : v); };
        const AMT = '(\\d{1,3}|an?|half an?)\\s*(hours?|hrs?|min(?:ute)?s?)';
        const out = {};
        let m = s.match(new RegExp('\\b(?:start|starts|work|works|working|begin|begins|(?:be |are |r |is )?(?:good|active|live|valid)|go live|turn on)\\b[^.?!]{0,20}?\\b' + AMT + '\\s*(?:early|earlier|before|ahead)'));
        if (m) out.works_before = mins(m[1], m[2]);
        m = s.match(new RegExp('\\b(?:stop|stops|end|ends|quit|quits|expire|expires|turn off)\\b[^.?!]{0,20}?\\b' + AMT + '\\s*(?:after|later)'));
        if (m) out.works_after = mins(m[1], m[2]);
        m = s.match(new RegExp('\\b(?:text|texted|send|sent|email|emailed)\\b[^.?!]{0,25}?\\b' + AMT + '\\s*(?:before|ahead|early)'));
        if (m) out.texted_before = mins(m[1], m[2]);
        return Object.values(out).some(v => Number.isFinite(v) && v >= 0 && v <= 240) ? out : null;
      },
      say: 'Change when a door code works and is texted (the owner\'s numbers): minutes before a session it starts working, minutes after it stops, minutes before the session it is texted, and whether the lock is checked to hold it before it is texted. A customer told "the code didn\'t work yet" usually needs works_before longer',
      params: { type: 'object', properties: {
        works_before: { type: 'integer', minimum: 0, maximum: 240, description: 'minutes before the session the code starts working ("an hour early" is 60, "from 15 minutes before" is 15)' },
        works_after: { type: 'integer', minimum: 0, maximum: 240, description: 'minutes after the session the code stops working' },
        texted_before: { type: 'integer', minimum: 0, maximum: 240, description: 'minutes before the session the code is texted (and emailed)' },
        check_lock_first: { type: 'boolean', description: 'make the code ahead and check the lock holds it before texting it' } } },
      build: (a, ctx) => {
        cfgOf(ctx);
        const set = [];
        if (a.works_before != null) set.push(['booking.doorCodeLeadMins', a.works_before]);
        if (a.works_after != null) set.push(['booking.doorCodeLagMins', a.works_after]);
        if (a.texted_before != null) set.push(['doorAccess.textLeadMins', a.texted_before]);
        if (a.check_lock_first != null) set.push(['doorAccess.confirmBeforeText', a.check_lock_first]);
        if (!set.length) throw new ActionError('say what to change: when the code starts or stops working, when it is texted, or whether the lock is checked first');
        return { op: 'config', set };
      },
      describe: (a, ctx) => {
        const t = Object.assign(timing(cfgOf(ctx)), a.works_before != null ? { before: a.works_before } : {}, a.works_after != null ? { after: a.works_after } : {}, a.texted_before != null ? { text: a.texted_before } : {}, a.check_lock_first != null ? { check: a.check_lock_first } : {});
        return `Door codes from now on: working from ${t.before} minutes before each session until ${t.after} minutes after it; texted ${t.text} minutes before${t.check ? ', once the lock is checked to hold it' : ''}.`;
      } },

    // ── ONE-TIME SETUP, BY TALKING (Oct 21 2026 - the gap audit's item 15). Left on their own screens on purpose: a lock's
    //    keys (Settings > Devices > Door Access Provider - credentials stay the owner's own screens), teaching a TV remote
    //    (the owner points the remote at the bridge: Bays & Devices' Learn), and the top of the page's video (the Website
    //    editor's Hero card compresses it for minutes) ──
    { name: 'counter_settings_set', area: 'money', kind: 'write', confirm: true,
      say: 'The Counter card\'s other switches: food and drink on the counter (the menu, tabs, kitchen tickets) or golf only; the cash drawer (a printer-driven drawer that kicks open on a cash sale); and how many minutes after the start a booking nobody checked in for counts as a no-show - taking cash and checks is counter_payments_set',
      params: { type: 'object', properties: { food_and_drink: { type: 'boolean' }, cash_drawer: { type: 'boolean' }, no_show_after_mins: { type: 'integer', minimum: 0, maximum: 120 } } },
      build: (a) => {
        const set = [];
        if (a.food_and_drink != null) set.push(['pos.fnb', a.food_and_drink]);
        if (a.cash_drawer != null) set.push(['pos.drawer.enabled', a.cash_drawer]);
        if (a.no_show_after_mins != null) set.push(['pos.noShowGraceMins', a.no_show_after_mins]);
        if (!set.length) throw new ActionError('say what to change: food and drink, the cash drawer, or the no-show minutes');
        return { op: 'config', set };
      },
      describe: (a) => 'The counter: ' + [a.food_and_drink != null && (a.food_and_drink ? 'food and drink on (the menu, tabs, kitchen tickets)' : 'golf only - no food and drink'),
        a.cash_drawer != null && (a.cash_drawer ? 'the cash drawer kicks open on every cash sale (it plugs into the counter printer)' : 'no cash drawer'),
        a.no_show_after_mins != null && `a booking nobody checked in for is a no-show ${a.no_show_after_mins} minutes after its start`].filter(Boolean).join('; ') },
    { name: 'printers_read', area: 'menu', kind: 'read', needs: ['upkeepConfig'],
      say: 'See the kitchen, bar and counter printers (their names and what each prints)',
      params: { type: 'object', properties: {} },
      local: (a, ctx) => ({ printers: (cfgOf(ctx).printers || []).map(p => ({ printer: p.name, prints: { counter: 'receipts at the counter', kitchen: 'kitchen tickets', bar: 'bar tickets' }[p.role] || p.role })),
        cash_drawer: !!(((cfgOf(ctx).pos || {}).drawer || {}).enabled), where: 'Settings > Devices > Kitchen & Counter Printers' }) },
    { name: 'printer_add', area: 'menu', kind: 'write', confirm: true,
      say: 'Add a Star CloudPRNT printer: its name and what it prints (counter receipts, kitchen tickets or bar tickets). Its address for the printer\'s own CloudPRNT settings shows on the printers card - walk the owner through typing it in, then printer_test',
      params: { type: 'object', properties: { name: { type: 'string', minLength: 2, maxLength: 40 }, prints: { type: 'string', enum: ['counter', 'kitchen', 'bar'] } }, required: ['name', 'prints'] },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/admin/printers/add', body: { name: a.name, role: a.prints } }),
      describe: (a) => `Add the printer "${a.name}" for ${({ counter: 'counter receipts', kitchen: 'kitchen tickets', bar: 'bar tickets' })[a.prints]}. Its address for the printer's CloudPRNT settings shows on the Kitchen & Counter Printers card.` },
    { name: 'printer_test', area: 'menu', kind: 'write', confirm: false, needs: ['upkeepConfig'],
      say: 'Send a test page to a printer (it collects it within seconds when its CloudPRNT settings are right)',
      params: { type: 'object', properties: { printer: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['printer'] },
      build: (a, ctx) => ({ op: 'http', method: 'POST', path: '/api/admin/printers/test', body: { printer_id: printerOf(ctx, a.printer).id } }),
      describe: (a, ctx) => `Send a test page to "${printerOf(ctx, a.printer).name}" - it should print within a few seconds` },
    { name: 'printer_remove', area: 'menu', kind: 'write', confirm: true, needs: ['upkeepConfig'],
      say: 'Take a printer off (its CloudPRNT address stops working at once)',
      params: { type: 'object', properties: { printer: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['printer'] },
      build: (a, ctx) => { const c = cfgOf(ctx), p = printerOf(ctx, a.printer); return { op: 'config', set: [['printers', (c.printers || []).filter(x => x.id !== p.id)]], expect: [['printers.length', (c.printers || []).length]] }; },
      describe: (a, ctx) => `Take the printer "${printerOf(ctx, a.printer).name}" off - its address stops working at once` },
    { name: 'backups_read', area: 'unit', kind: 'read',
      say: 'See the backups: the newest one on the unit, the nightly copy to an SD card or USB stick (on or off, the hour, whether the last copy worked), whether a backup passphrase is set, and what storage is plugged in',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => {
        const [st, v] = await Promise.all([getJson(ctx, '/api/admin/backup/status'), getJson(ctx, '/api/admin/backup/vault').catch(() => ({}))]);
        const S = st.settings || {}, L = st.localLatest || null;
        return { newest_on_unit: L ? { at: L.date || undefined, size: mb(L.size) } : 'none yet', nightly_copy_to: { off: 'nowhere - only on the unit', sd: 'the SD card', usb: 'the USB stick', both: 'the SD card and the USB stick' }[S.destination || 'off'],
          at_hour: S.hour, last_copies: Object.fromEntries(Object.entries(st.status || {}).map(([k, x]) => [k, x && x.ok ? 'worked' + (x.at ? ' ' + x.at : '') : 'did not work' + (x && x.error ? ': ' + x.error : '')])),
          passphrase_set: !!(v.set || (v.vault && v.vault.set)), plugged_in: (st.detected || []).map(d => d.label || d.kind), where: 'Settings > Protection > Backups' };
      } },
    { name: 'backup_copies_set', area: 'unit', kind: 'write', confirm: true,
      say: 'Where the nightly backup is copied - nowhere, the SD card, the USB stick or both - and the hour (0-23). A copy that leaves the unit is always encrypted, so it needs the backup passphrase set first (backup_passphrase_set)',
      params: { type: 'object', properties: { copy_to: { type: 'string', enum: ['off', 'sd', 'usb', 'both'] }, hour: { type: 'integer', minimum: 0, maximum: 23, description: '3 = 3 AM (3 when not said)' } }, required: ['copy_to'] },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/admin/backup/settings', body: { enabled: true, destination: a.copy_to, hour: a.hour != null ? a.hour : 3 } }),
      describe: (a) => a.copy_to === 'off' ? 'The nightly backup stays on the unit only - no copy to a card or stick' : `Every night at ${timeOf(a.hour != null ? a.hour : 3)}, the backup is copied, encrypted, to ${({ sd: 'the SD card', usb: 'the USB stick', both: 'the SD card and the USB stick' })[a.copy_to]}` },
    { name: 'backup_now', area: 'unit', kind: 'write', confirm: false,
      say: 'Make a backup right now (on the unit; to the USB stick or SD card too when asked - encrypted)',
      params: { type: 'object', properties: { copy_to: { type: 'string', enum: ['unit', 'usb', 'sd'] } } },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/admin/backup/run-now', body: { dest: a.copy_to && a.copy_to !== 'unit' ? a.copy_to : 'local' } }),
      describe: (a) => `Make a backup now${a.copy_to && a.copy_to !== 'unit' ? ' and copy it, encrypted, to the ' + (a.copy_to === 'usb' ? 'USB stick' : 'SD card') : ', on the unit'}` },
    { name: 'records_settings_set', area: 'unit', kind: 'write', confirm: true,
      say: 'How long a person\'s details are kept before they are taken out of the records (at least 10 years - BA\'s own ruling for the product, not a legal number; the owner may set longer), and how many months the owner\'s log keeps (at least 12). Facility figures are never deleted. Never suggest a number',
      params: { type: 'object', properties: { years: { type: 'integer', minimum: 10, maximum: 100 }, log_months: { type: 'integer', minimum: 12, maximum: 600 } } },
      build: (a) => {
        if (a.years == null && a.log_months == null) throw new ActionError('say the years, or the months of the owner\'s log');
        return { op: 'http', method: 'POST', path: '/api/admin/records/settings', body: Object.assign({}, a.years != null ? { retentionYears: a.years } : {}, a.log_months != null ? { adminLogMonths: a.log_months } : {}) };
      },
      describe: (a) => [a.years != null && `A person's details are kept ${a.years} years, then taken out of the records (the facility's figures stay for ever; 10 years is BA's own floor for the product, not a legal number)`,
        a.log_months != null && `the owner's log keeps ${a.log_months} months`].filter(Boolean).join('; ') },
    { name: 'calendar_feed_read', area: 'unit', kind: 'read',
      say: 'See the private calendar link (the owner\'s bookings in their own phone or computer calendar): whether it is on, whether it shows names and contact details, and when a calendar last read it. The link itself is on its card, never said in the chat',
      params: { type: 'object', properties: {} },
      local: async (a, ctx) => { const j = await getJson(ctx, '/api/admin/calendar'); return { on: !!j.enabled, shows_names: !!j.names, shows_phone_and_email: !!j.contact, last_read_by_a_calendar: ago(j.lastReadAt) || 'never', link: j.enabled ? 'on the card - copy it into the calendar app as a subscription' : undefined, note: j.note || undefined, where: 'Settings > Connections > Your Bookings in Your Calendar' }; } },
    { name: 'calendar_feed_set', area: 'unit', kind: 'write', confirm: true,
      say: 'Turn the private calendar link on or off, choose whether it shows customer names and phone and email, or make a new link (the old one stops working - for a lost phone)',
      params: { type: 'object', properties: { on: { type: 'boolean' }, names: { type: 'boolean' }, contact: { type: 'boolean' }, new_link: { type: 'boolean' } } },
      build: (a) => {
        const body = {}; if (a.on != null) body.enabled = a.on; if (a.names != null) body.names = a.names; if (a.contact != null) body.contact = a.contact; if (a.new_link) body.newLink = true;
        if (!Object.keys(body).length) throw new ActionError('say what to change about the calendar link');
        return { op: 'http', method: 'POST', path: '/api/admin/calendar', body };
      },
      describe: (a) => 'Your bookings in your own calendar: ' + [a.on != null && (a.on ? 'on - the private link is on its card; add it to your calendar app' : 'off - the link stops working'), a.names != null && (a.names ? 'with customer names' : 'without customer names'),
        a.contact != null && (a.contact ? 'with phone numbers and emails' : 'without phone numbers and emails'), a.new_link && 'a new link (the old one stops working)'].filter(Boolean).join('; ') },
    { name: 'how_it_works_page_set', area: 'pages', kind: 'write', confirm: false, needs: ['upkeepConfig'],
      say: 'The How It Works page (/how-it-works): its steps, each a title and a line or two, in order. Change one by its number, add one, take one out, or give the whole list',
      params: { type: 'object', properties: {
        step: { type: 'integer', minimum: 1, maximum: 20, description: 'the step to change or take out (leave out to add one at the end)' },
        title: { type: 'string', maxLength: 60 }, words: { type: 'string', maxLength: 600 }, remove: { type: 'boolean' } } },
      build: (a, ctx) => {
        const c = cfgOf(ctx), list = (((c.content || {}).howItWorks) || []).map(x => Object.assign({}, x));
        if (a.step == null) { if (!a.title || !a.words) throw new ActionError('a new step needs a title and its words'); list.push({ title: a.title, body: a.words }); }
        else {
          const x = list[a.step - 1]; if (!x) throw new ActionError(`there is no step ${a.step} (there are ${list.length})`);
          if (a.remove) list.splice(a.step - 1, 1);
          else { if (a.title === undefined && a.words === undefined) throw new ActionError('say the step\'s new title or words, or take it out'); if (a.title !== undefined) x.title = a.title; if (a.words !== undefined) x.body = a.words; }
        }
        return { op: 'config', set: [['content.howItWorks', list]], expect: [['content.howItWorks.length', (((c.content || {}).howItWorks) || []).length]] };
      },
      describe: (a, ctx) => { const list = (((cfgOf(ctx).content || {}).howItWorks) || []); const x = a.step ? list[a.step - 1] || {} : {};
        return a.step == null ? `Add a step to the How It Works page: "${a.title}"` : a.remove ? `Take step ${a.step} ("${x.title || ''}") off the How It Works page` : `How It Works, step ${a.step}${x.title ? ' ("' + x.title + '")' : ''}: ` + [a.title !== undefined && `titled "${a.title}"`, a.words !== undefined && 'new words'].filter(Boolean).join(', '); } },
    { name: 'console_look_set', area: 'look', kind: 'write', confirm: false,
      say: 'The admin console\'s own look (this panel, not the website): dark gold, dark green, dark blue, dark red, dark purple, light, or matching the website\'s brand. The sign-in screen always offers standard colors, so a pick can never lock the owner out',
      params: { type: 'object', properties: { look: { type: 'string', enum: ['dark-gold', 'dark-green', 'dark-blue', 'dark-red', 'dark-purple', 'light', 'match-brand'] } }, required: ['look'] },
      build: (a) => ({ op: 'http', method: 'POST', path: '/api/website/console-look', body: { name: a.look } }),
      describe: (a) => `The admin console's look: ${a.look === 'match-brand' ? 'matching your website\'s colors' : a.look.replace('-', ' ')} (the website does not change)` },
    { name: 'bay_remove', area: 'baysetup', kind: 'write', confirm: true, needs: ['bays', 'upkeepBookings'],
      say: 'Take a bay off for good, with its devices. Refused while it has bookings still to come (move or cancel them first); past bookings keep its name. To close it for a while instead, bay_service_set or a block',
      params: { type: 'object', properties: { bay: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['bay'] },
      build: (a, ctx) => {
        const i = H.bayIndex(ctx, a.bay), bays = ctx.bays || [], bay = bays[i];
        if (bays.length < 2) throw new ActionError('this is the only bay - a facility needs at least one');
        const B = ctx.upkeepBookings; if (!B) throw new ActionError('the bookings could not be read just now - try again');
        const ahead = B.filter(b => b.bay_id === bay.id);
        if (ahead.length) throw new ActionError(`${bay.name} has ${ahead.length} booking${ahead.length === 1 ? '' : 's'} still to come (the first on ${ahead[0].date}) - move or cancel ${ahead.length === 1 ? 'it' : 'them'} first`);
        return { op: 'config', set: [['bays', bays.filter((b, j) => j !== i)]], expect: [[`bays.${i}.id`, bay.id], ['bays.length', bays.length]] };
      },
      describe: (a, ctx) => { const bay = (ctx.bays || [])[H.bayIndex(ctx, a.bay)] || { name: a.bay }; return `Take ${bay.name} off for good, with its devices. Customers can no longer book it; past bookings keep its name. Its bay PC's watcher no longer matters.`; } },
  ];
  return { actions, loaders };
};
