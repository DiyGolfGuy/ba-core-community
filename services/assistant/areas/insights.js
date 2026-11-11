// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/areas/insights.js - HOW THE BUSINESS IS DOING, ASKED IN WORDS (Oct 20 2026, late; branch
// feature/ai-edition). Built with the helpers services/assistant/actions.js hands every area (HELPERS); same rules as the
// actions there.
//
// maintainer: "checking who is playing. Profit that month memberships sold, how many books are we up from last week or month. How
// many bookings tmr. Longest booking tmr. all that good stuff ... think of everything we track and the AI can do something
// with it and turn it into usable information for the owner. Even tax things ... tell them how much tax they collected and
// export the tax in the chat as an excel". Every figure is services/insights.js through routes/admin.js (/insights/period,
// /insights/day, /insights/now, /tax/export.xlsx); its money is services/revenue.js (rule 38: money actually taken, minus
// refunds). A customer is their whole name on the box's own AI, a first name and a last initial with the owner's own AI
// service (services/assistant/privacy.js).
// A PERIOD IS PUT AGAINST THE SAME DAYS BEFORE IT: this week so far against the same days last week, this month so far
// against the same days last month - never a part of a month against a whole one.
// TAX LAW IS NEVER LOOKED UP (a call made in the work, OPEN until maintainer rules - docs/internal/BA-CORE-2-AI.md): a rate the
// assistant found and set would be the product supplying legal content (rule 15), and the unit's own Tax & Legal card says
// the rate is the owner's to verify and keep current. The assistant reads the rates, changes one to the rate the OWNER
// gives, and names the product's automatic option - Stripe Tax, worked out by Stripe from the venue's address for online
// bookings and the counter (the Point of Sale - Tax Codes card's "Let Stripe compute tax").
'use strict';

module.exports = (H) => {
  const { ActionError, normDate, dayWords, timeWords, addDays, TIME } = H;
  const { pastDate, rangeOf, spanWords, PERIODS, PAST_DATE, cents, num } = require('./money')(H).words;
  const pad = (n) => String(n).padStart(2, '0');
  const days = (f, t) => Math.round((Date.parse(t + 'T12:00:00Z') - Date.parse(f + 'T12:00:00Z')) / 86400000) + 1;
  // the study's words (trends_read, specials_effect_read): "Mar 2026", "Tuesdays", a time kept, a year against the one before
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAYS_S = { sun: 'Sundays', mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays' };
  const monthWords = (m) => `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const runsWords = (every) => (every === 'every day' || every === 'one day' ? every : String(every).split(',').map(d => DAYS_S[d.trim()] || d).join(', '));
  const timeOf = (iso) => { try { return new Date(iso).toLocaleString('en-US', { timeZone: require('../../revenue').tzOf() || undefined, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return String(iso || '').slice(0, 16); } };
  const yearAgo = (j, g, words) => (!g ? undefined : g.before_records ? `${words}: no records from a year before (the box's start ${dayWords(j.first_record)})`
    : `${words} (${spanWords(g.from, g.to)}): ${cents(g.now.revenue_cents)} taken and ${num(g.now.bookings)} bookings, against ${cents(g.year_before.revenue_cents)} and ${num(g.year_before.bookings)} the same days a year before - money ${movedMoney(g.now.revenue_cents, g.year_before.revenue_cents)}, bookings ${movedCount(g.now.bookings, g.year_before.bookings)}`);
  const getJson = async (ctx, path) => {
    const r = await ctx.call('GET', path);
    if (!r || r.status >= 400) throw new Error((r && r.json && r.json.error) || `it answered ${r ? r.status : 'nothing'}`);
    return r.json || {};
  };
  // a read whose route refused is the facility's answer, not the model's mistake (engine.js routeSaid)
  const guard = (fn) => async (a, ctx) => {
    try { return await fn(a, ctx); } catch (e) { if (e instanceof ActionError) throw e; return { error: String((e && e.message) || e).slice(0, 300), routeSaid: true }; }
  };

  // ── what a period is put against ───────────────────────────────────────────────────────────────────────────────
  // the same day `months` back, held to that month's last day (Oct 31 -> Sep 30)
  function monthsBack(d, months) {
    let y = +d.slice(0, 4), m = +d.slice(5, 7) - months; const day = +d.slice(8, 10);
    while (m < 1) { m += 12; y--; }
    return `${y}-${pad(m)}-${pad(Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate()))}`;
  }
  const monthEnd = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
  function compareOf(a, from, to) {
    const back = (n, words) => ({ from: addDays(from, -n), to: addDays(to, -n), words });
    const months = (n, words) => ({ from: monthsBack(from, n), to: monthsBack(to, n), words });
    switch (a.from || a.to ? '' : (a.period || 'this_month')) {
      case 'today': return back(7, 'the same day last week');
      case 'yesterday': return back(7, 'the same day the week before');
      case 'this_week': return back(7, 'the same days last week');
      case 'last_week': return back(7, 'the week before');
      case 'last_7_days': return back(7, 'the 7 days before');
      case 'this_month': return months(1, 'the same days last month');
      case 'last_month': { const f = monthsBack(from, 1); return { from: f, to: monthEnd(f), words: 'the month before' }; }
      case 'this_quarter': return months(3, 'the same days last quarter');
      case 'last_quarter': { const f = monthsBack(from, 3); return { from: f, to: monthEnd(monthsBack(from, 1)), words: 'the quarter before' }; }
      case 'this_year': return months(12, 'the same days last year');
      case 'last_year': return months(12, 'the year before');
      default: { const n = days(from, to); return { from: addDays(from, -n), to: addDays(from, -1), words: n === 1 ? 'the day before' : `the ${n} days before` }; }
    }
  }

  // ── the words ───────────────────────────────────────────────────────────────────────────────────────────────
  const pct = (now, was) => Math.round(((now - was) / was) * 1000) / 10;
  const movedCount = (now, was) => { now = num(now); was = num(was); if (now === was) return 'the same'; if (!was) return `up ${now} (from none)`; return `${now > was ? 'up' : 'down'} ${Math.abs(now - was)} (${Math.abs(pct(now, was))}%)`; };
  const movedMoney = (now, was) => { now = num(now); was = num(was); if (now === was) return 'the same'; if (!was) return `up ${cents(now)} (from none)`; return `${now > was ? 'up' : 'down'} ${cents(Math.abs(now - was))} (${Math.abs(pct(now, was))}%)`; };
  const lengthWords = (min) => { min = num(min); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minutes` : ''}` : `${m} minutes`; };
  // "3:00 PM to 6:00 PM in Bay 3 - 3 hours, Dana W." (with its day, over a period)
  const longestWords = (L, withDay) => `${withDay ? dayWords(L.date) + ', ' : ''}${timeWords(L.start)}${L.end ? ' to ' + timeWords(L.end) : ''}${L.bay ? ' in ' + L.bay : ''} - ${lengthWords(L.minutes)}, ${L.who}`;
  function summaryWords(j, words) {
    const B = j.bookings || {}, M = j.money || {}, S = j.memberships || {}, C = j.customers || {}, T = j.tax || {};
    return {
      period: spanWords(j.period.from, j.period.to), against: `${words} (${spanWords(j.previous.from, j.previous.to)})`,
      bookings: { count: num(B.count), against: num(B.previous_count), moved: movedCount(B.count, B.previous_count),
        hours_played: num(B.hours), hours_against: num(B.previous_hours),
        bays_full: B.full_pct == null ? undefined : `${B.full_pct}% of the open bay hours (against ${num(B.previous_full_pct)}%)`,
        cancelled: num(B.cancelled) || undefined, by_members: num(B.by_members) || undefined,
        average_length: B.count ? lengthWords(B.average_minutes) : undefined, longest: B.longest ? longestWords(B.longest, true) : undefined,
        busiest_day: B.busiest_weekday ? `${B.busiest_weekday.day} (${B.busiest_weekday.bookings})` : undefined,
        busiest_start: B.busiest_start ? `${timeWords(B.busiest_start.hour)} (${B.busiest_start.bookings} began then)` : undefined,
        by_bay: B.by_bay && Object.keys(B.by_bay).length ? B.by_bay : undefined },
      customers: { played: num(C.played), new: num(C.new), coming_back: num(C.coming_back), against: num(C.previous_played) },
      money: { revenue: cents(M.revenue_cents), against: cents(M.previous_revenue_cents), moved: movedMoney(M.revenue_cents, M.previous_revenue_cents),
        revenue_means: 'money actually taken, minus refunds, tax included',
        came_in: { sessions_online: cents(M.sessions_cents), counter: cents(M.counter_cents), gift_cards_sold: cents(M.gift_cards_sold_cents), memberships: cents(M.memberships_cents) },
        refunds: cents(M.refunds_cents), tips: `${cents(M.tips_cents)} (the staff's, not revenue)`, card_fees_estimate: cents(M.card_fees_estimate_cents),
        kept_after_card_fees: cents(M.take_home_estimate_cents),
        profit: 'the unit knows the money taken and the card fees, not the other costs (rent, staff, stock) - take those from what was kept after card fees',
        gift_cards_still_to_spend: M.gift_cards_still_to_spend_cents == null ? undefined : cents(M.gift_cards_still_to_spend_cents) },
      memberships: { joined: num(S.joined), joined_against: num(S.previous_joined), payments: num(S.payments), paid: cents(S.payments_cents), active_now: num(S.active_now) },
      counter_best_sellers: (j.counter_best_sellers || []).length ? j.counter_best_sellers.slice(0, 5).map(x => `${x.item}: ${num(x.sold)} sold, ${cents(x.sales_cents)}`) : undefined,
      tax_collected: cents(T.total_cents)
    };
  }
  // a day the owner names: today, tomorrow, a weekday (the next one), or one that has been (yesterday, "last friday")
  function anyDay(v, today) {
    if (v == null || v === '') return today;
    const d = normDate(v, today); if (d) return d;
    return pastDate(v, today, 'that day');
  }

  // ── the tax settings, only these (GET /api/admin/config, routes/admin.js:98; GET /api/pos/tax-codes, routes/pos.js:126) ──
  const loaders = {
    taxSettings: async (ctx) => {
      let c = null, k = null;
      try { c = await getJson(ctx, '/api/admin/config'); } catch {}
      try { k = await getJson(ctx, '/api/pos/tax-codes'); } catch {}
      const t = (c && c.tax) || {}, p = ((c && c.pos) || {}).tax || {};
      return { read: !!c, rawRate: t.rate, bookings: { on: !!t.enabled, rate: Number(t.rate) || 0, label: String(t.label || 'Sales Tax') },
        stripeTax: !!p.stripeTax, codes: Array.isArray(k && k.codes) ? k.codes : [] };
    },
  };
  const taxOf = (ctx) => { const T = ctx.taxSettings; if (!T || !T.read) throw new ActionError('the tax settings could not be read just now - try again in a moment'); return T; };
  const codeWords = (c) => `${c.name}: ${num(c.rate)}%`;
  // which tax the owner means: the bookings' tax, or one of the counter's codes by its name or id
  function whichTax(T, said) {
    const n = String(said || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (/^(the )?(bookings?|sessions?|online|tee ?times?)( tax)?$/.test(n)) return { kind: 'bookings' };
    const name = n.replace(/ tax$/, '').replace(/^the /, ''), alias = { drinks: 'beverage', drink: 'beverage', bar: 'beverage', golf: 'sim', simulator: 'sim', bays: 'sim' };
    const want = alias[name] || name;
    const hit = T.codes.filter(c => String(c.id).toLowerCase() === want || String(c.name).toLowerCase() === want || String(c.name).toLowerCase().startsWith(want));
    if (hit.length === 1) return { kind: 'code', code: hit[0] };
    throw new ActionError(hit.length ? `${hit.length} tax codes match "${said}" (${hit.map(codeWords).join(', ')}) - say which` : `no tax called "${said}" - the taxes are: bookings (${T.bookings.rate}%), ${T.codes.map(codeWords).join(', ')}`);
  }
  const RANGE = { period: { type: 'string', enum: PERIODS, description: 'one of: ' + PERIODS.join(', ') + ' (this_month when not said)' },
    from: { ...PAST_DATE, description: 'the first day, for any other range (YYYY-MM-DD)' }, to: { ...PAST_DATE, description: 'the last day (today when not said)' } };

  const actions = [
    // GET /api/admin/insights/period?from&to&cfrom&cto (routes/admin.js, owner only) - services/insights.js summary()
    { name: 'insights_read', area: 'numbers', kind: 'read',
      say: 'How the business is doing for a period, put against the same days before it (this week so far against the same days last week, this month so far against the same days last month): bookings and hours played (up or down), how full the bays were, the longest booking, the busiest day and start time, customers new and coming back, money taken (revenue - money actually taken, minus refunds) up or down, what was kept after card fees, memberships joined and paid, the counter\'s best sellers, the tax collected. For "how did we do", "are we up from last week", "profit this month", "memberships sold"',
      params: { type: 'object', properties: RANGE },
      local: guard(async (a, ctx) => {
        const [from, to] = rangeOf(a, ctx.today), c = compareOf(a, from, to);
        return summaryWords(await getJson(ctx, `/api/admin/insights/period?from=${from}&to=${to}&cfrom=${c.from}&cto=${c.to}`), c.words);
      }) },
    // GET /api/admin/insights/day?date (routes/admin.js) - services/insights.js day()
    { name: 'day_outlook_read', area: 'numbers', kind: 'read',
      say: 'One day\'s bookings in numbers - tomorrow, today, a weekday or one that has been: how many, the hours booked, the longest booking, the first start and the last finish, each bay\'s count, and the list (who, bay, start, length). With from_time ("tonight" is from 17:00): only what runs from then, the busiest hour and the bays free all that time. For "how many bookings tomorrow", "longest booking tomorrow", "how busy is Saturday", "what is tonight looking like"',
      params: { type: 'object', properties: { date: { type: 'string', maxLength: 20, description: 'the day: tomorrow, today, a weekday name (the next one), yesterday, "last friday", or YYYY-MM-DD; today when not said' },
        from_time: { ...TIME, description: 'only from this time on (HH:MM) - 17:00 for "tonight"' } } },
      local: guard(async (a, ctx) => {
        const d = anyDay(a.date, ctx.today), j = await getJson(ctx, `/api/admin/insights/day?date=${d}${a.from_time ? '&from=' + a.from_time : ''}`), E = j.evening;
        const evening = E ? { from: timeWords(E.from), until: timeWords(E.until), busiest_hour: E.busiest_hour ? `${timeWords(E.busiest_hour.at)}, ${E.busiest_hour.booked} of ${E.bays} bays booked` : 'no bay is booked',
          free_all_the_time: E.free_all_the_time.length ? E.free_all_the_time : 'none', by_hour: E.by_hour.map(h => `${timeWords(h.at)}: ${h.booked} of ${E.bays}`) } : undefined;
        if (!num(j.count)) return { day: dayWords(d), bookings: 0, evening, note: d >= ctx.today ? 'nothing booked yet' : 'nobody played that day' };
        return { day: dayWords(d), bookings: num(j.count), evening, hours_booked: num(j.hours), longest: j.longest ? longestWords(j.longest) : undefined,
          first_start: j.first_start ? timeWords(j.first_start) : undefined, last_finish: j.last_end ? timeWords(j.last_end.slice(0, 5)) + (j.last_end.length > 5 ? ' (the next day)' : '') : undefined,
          by_bay: j.by_bay, list: (j.list || []).map(b => `${timeWords(b.start)} ${b.bay ? b.bay + ' ' : ''}${b.who}, ${lengthWords(b.minutes)}${b.member ? ' (member)' : ''}`) };
      }) },
    // GET /api/admin/insights/now (routes/admin.js) - services/insights.js now()
    { name: 'playing_now_read', area: 'numbers', kind: 'read',
      say: 'Who is playing right now: each bay in use, who is on it and until when - and who is next on each bay today. For "who\'s playing", "who\'s on the bays", "is anyone in bay 2"',
      params: { type: 'object', properties: {} },
      local: guard(async (a, ctx) => {
        const j = await getJson(ctx, '/api/admin/insights/now');
        const next = Object.entries(j.next_up || {}).map(([bay, x]) => `${bay}: ${x.who} at ${timeWords(x.at)}`);
        return { now: timeWords(j.time || '00:00'), playing: (j.playing || []).length ? j.playing.map(p => `${p.bay || 'a bay'}: ${p.who}${p.member ? ' (member)' : ''}, until ${timeWords(p.until)}`) : 'nobody is playing right now',
          next_today: next.length ? next : 'nothing else booked today' };
      }) },
    // THE OWNER'S QUESTIONS ABOUT THEIR PEOPLE AND MONEY (maintainer, Oct 25 2026: "how many people bring if its that style facility if member
    // pay to bring people, how.much each group spends on food, beer etc. If that facility has that ... returning customers, Aug spend,
    // how many times top.members play") - GET /api/admin/insights/<kind> (services/insights.js), for a period (this month when not said)
    { name: 'counter_spend_read', area: 'numbers', kind: 'read',
      say: 'What a group (a booking) spends: online, for bay time at the door and at the counter - the counter by the owner\'s own menu parts (food, beer, ...) - per group and per group that bought, and what sold most. For "how much does each group spend on food and beer", "average bar tab", "counter spend per group"',
      params: { type: 'object', properties: RANGE },
      local: guard(async (a, ctx) => {
        const [from, to] = rangeOf(a, ctx.today), j = await getJson(ctx, `/api/admin/insights/groups?from=${from}&to=${to}`);
        if (!j.groups) return { period: spanWords(from, to), groups: 'no bookings played in that time' };
        // (the review, Oct 25 2026) the bay money a group paid at the door is its own figure, never "counter" spend and never "$0.00
        // online for the bay"; a part nobody paid in that time is left out of the sentence; the counter is named by the owner's
        // own menu parts, before tax, as the menu prices them
        const P = j.per_group || {}, Bt = j.per_group_that_bought || {};
        const ways = [num(j.online_total_cents) ? `${cents(P.online_cents)} paid online` : null, num(j.door_total_cents) ? `${cents(P.door_cents)} for bay time at the door` : null, `${cents(P.counter_cents)} at the counter`].filter(Boolean);
        return { period: spanWords(from, to), groups: num(j.groups), bought_at_counter: `${num(j.bought_at_counter)} of ${num(j.groups)} groups`,
          a_group: `${cents(P.total_cents)} in all, tax included - ${ways.join(', ')}${num(j.given_back_total_cents) ? `, less ${cents(P.given_back_cents)} given back at the counter` : ''}`,
          a_group_that_bought: j.bought_at_counter ? `${cents(Bt.counter_cents)} at the counter, tax included${(Bt.by_part || []).length ? ' - by menu part, before tax: ' + Bt.by_part.map(x => `${x.part} ${cents(x.cents)}`).join(', ') : ''}` : undefined,
          sold_most: (j.top_items || []).length ? j.top_items.map(x => `${x.name} (${num(x.qty)})`) : undefined,
          means: 'a group is one booking that has started; online is what it paid online, less refunds; at the door is the bay time (or the package) rung up on its tabs at check-in, extra time included, member credit taken off; the counter is everything else its tabs rang up (comps and voids left out); tax at the rates set today' };
      }) },
    { name: 'member_guests_read', area: 'numbers', kind: 'read',
      say: 'The guests members bring: how many guests in a period, on how many member visits, and the members who bring the most. For "how many people do members bring", "who brings the most guests"',
      params: { type: 'object', properties: RANGE },
      local: guard(async (a, ctx) => {
        const [from, to] = rangeOf(a, ctx.today), j = await getJson(ctx, `/api/admin/insights/guests?from=${from}&to=${to}`);
        return { period: spanWords(from, to), guests: num(j.guests), member_visits: num(j.member_visits), visits_with_guests: num(j.visits_with_guests),
          bring_the_most: (j.top || []).length ? j.top.map(x => `${x.who} (${x.tier || 'no tier'}): ${num(x.guests)} guest${x.guests === 1 ? '' : 's'} on ${num(x.visits)} visit${x.visits === 1 ? '' : 's'}`) : 'nobody brought a guest',
          memberships_allowing_guests: num(j.tiers_allowing_guests) };
      }) },
    { name: 'top_members_read', area: 'numbers', kind: 'read',
      say: 'The members who play most in a period: each one\'s visits, hours and guests, and how many active members did not play at all. For "top members", "who plays the most", "how often do our best members play"',
      params: { type: 'object', properties: RANGE },
      local: guard(async (a, ctx) => {
        const [from, to] = rangeOf(a, ctx.today), j = await getJson(ctx, `/api/admin/insights/top-members?from=${from}&to=${to}`);
        // (the review, Oct 25 2026) a member who played and has since ended is not one of today's active members: "3 of 1 active
        // members played" put them over the active count - the active ones who played are said apart from the rest
        const N = num(j.members_who_played), K = j.active_who_played == null ? N : num(j.active_who_played), Y = num(j.active_members), V = num(j.member_visits);
        const visitsW = `${V} visit${V === 1 ? '' : 's'}`;
        return { period: spanWords(from, to), played: N === K ? `${K} of ${Y} active members played (${visitsW})`
            : `${K} of ${Y} active members played, and ${N - K} no longer active (${visitsW} in all)`,
          did_not_play: num(j.active_who_did_not_play),
          top: (j.top || []).length ? j.top.map(x => `${x.who} (${x.tier || 'no tier'}): ${num(x.visits)} visit${x.visits === 1 ? '' : 's'}, ${num(x.hours)} hour${num(x.hours) === 1 ? '' : 's'}${x.guests ? `, ${x.guests} guest${x.guests === 1 ? '' : 's'}` : ''}`) : 'no member played in that time' };
      }) },
    { name: 'customers_read', area: 'numbers', kind: 'read',
      say: 'The customers in a period: how many, new or coming back, how many came more than once, visits each, what they spend a visit and each (online plus the counter), and who comes most. For "returning customers", "regulars", "average spend", "top customers"',
      params: { type: 'object', properties: RANGE },
      local: guard(async (a, ctx) => {
        const [from, to] = rangeOf(a, ctx.today), j = await getJson(ctx, `/api/admin/insights/customers?from=${from}&to=${to}`);
        if (!j.customers) return { period: spanWords(from, to), customers: 'nobody played in that time' };
        return { period: spanWords(from, to), customers: num(j.customers), new: num(j.new), coming_back: num(j.coming_back), came_more_than_once: num(j.came_more_than_once),
          visits_each: num(j.visits_each), spend_a_visit: cents(j.spend_a_visit_cents), spend_a_customer: cents(j.spend_a_customer_cents),
          come_most: (j.top || []).map(x => `${x.who}${x.member ? ' (member)' : ''}: ${num(x.visits)} visit${x.visits === 1 ? '' : 's'}, ${cents(x.cents)}`),
          means: 'a customer is one phone number (or email) and a visit a booking that has started; spend is what they paid online less refunds, plus what their tabs rang up (bay time at the door and the counter, tax at the rates set today), less money given back at the counter' };
      }) },
    // THE FACILITY, STUDIED (maintainer, Oct 25 2026: "see growth progress revenue over time busy months slow months if a special actually
    // worked and got more people in ... did more people come in so they actually made more money") - GET /api/admin/study
    // (services/study.js): worked out from the records in the quiet hours and kept, or now when it is old; never a guess
    { name: 'trends_read', area: 'numbers', kind: 'read',
      say: 'How the business has gone month by month, from the unit\'s own records (up to two years): the money taken, bookings, hours, players and new members each month; the busiest and the slowest whole month; this year so far and the last three whole months against the same days a year before. For "busiest months", "slow months", "revenue over time", "month by month", "how have we grown over the year"',
      params: { type: 'object', properties: {} },
      local: guard(async (a, ctx) => {
        const j = await getJson(ctx, '/api/admin/study?kind=trends');
        if (!j.first_record) return { months: 'nothing recorded yet - no bookings or sales for the box to study' };
        const line = (x) => `${monthWords(x.month)}${x.so_far ? ' (so far)' : ''}: ${cents(x.revenue_cents)} taken, ${num(x.bookings)} bookings, ${num(x.hours)} hours, ${num(x.players)} players${x.joined ? `, ${x.joined} new member${x.joined === 1 ? '' : 's'}` : ''}`;
        return { records_start: dayWords(j.first_record), months: (j.months || []).slice(-12).map(line),
          busiest_month: j.busiest ? line(j.busiest) : 'not enough whole months yet - it takes two',
          slowest_month: j.slowest ? line(j.slowest) : undefined,
          this_year: yearAgo(j, (j.growth || {}).this_year, 'This year so far'), last_three_months: yearAgo(j, (j.growth || {}).last_three_months, 'The last three whole months'),
          worked_out: j.kept ? `in the quiet hours, kept (${timeOf(j.computed_at)})` : 'just now',
          means: 'all from the box\'s own records - money is money actually taken, minus refunds; a player is one phone number' };
      }) },
    { name: 'specials_effect_read', area: 'numbers', kind: 'read',
      say: 'Whether a counter special or a booking deal brought more in: each one\'s own days since it began beside the same days before it started - bookings, players and money taken a day - and how many sold at its price (a deal: how many bookings took it). From the records, side by side; it cannot say why. For "did the special work", "is taco tuesday working", "did the deal work", "did more people come in", "did we make more"',
      params: { type: 'object', properties: { special: { type: 'string', maxLength: 60, description: 'one special by its name; every one when not said' } } },
      local: guard(async (a, ctx) => {
        const j = await getJson(ctx, '/api/admin/study?kind=specials');
        let list = j.specials || [];
        if (a.special) {
          const n = String(a.special).toLowerCase().trim();
          list = list.filter(x => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
          if (!list.length) throw new ActionError(`there is no special called "${a.special}" - the specials are ${(j.specials || []).map(x => x.name).join(', ') || 'none yet'}`);
        }
        if (!list.length) return { specials: 'no counter specials yet - once one has run a few of its days, this shows what came in on them against the days before it' };
        const side = (x) => `${x.days} day${x.days === 1 ? '' : 's'} (${spanWords(x.from, x.to)}): ${x.a_day.bookings} booking${x.a_day.bookings === 1 ? '' : 's'}, ${x.a_day.players} player${x.a_day.players === 1 ? '' : 's'} and ${cents(x.a_day.revenue_cents)} taken a day`;
        const by = (now, was, unit, money) => { const d = Math.round((now - was) * 10) / 10; if (!d) return `the same ${unit}`; return `${d > 0 ? 'up' : 'down'} ${money ? cents(Math.abs(d)) : Math.abs(d) + ' ' + unit} a day`; };
        return { specials: list.map(x => (!x.with_it ? { special: x.name, note: x.note } : {
            special: x.name + (x.kind === 'deal' ? ' (a booking deal)' : '') + (x.active ? '' : ' (switched off now)'), runs: runsWords(x.every), since: dayWords(x.started),
            with_it: `${side(x.with_it)}; ${x.kind === 'deal' ? `${num(x.with_it.sold)} booking${x.with_it.sold === 1 ? '' : 's'} took the deal (${cents(x.with_it.sold_cents)} off)` : `${num(x.with_it.sold)} sold at its price (${cents(x.with_it.sold_cents)})`}`,
            before_it: x.before_it ? side(x.before_it) : x.before_records,
            on_its_days: x.before_it ? [by(x.with_it.a_day.bookings, x.before_it.a_day.bookings, 'bookings'), by(x.with_it.a_day.players, x.before_it.a_day.players, 'players'), 'money ' + by(x.with_it.a_day.revenue_cents, x.before_it.a_day.revenue_cents, '', true)].join(', ') : undefined })),
          means: 'days side by side from the records - what came in on them, not why (the weather, a holiday or a league starting change things too); money is money actually taken, minus refunds, for the whole day',
          worked_out: j.kept ? `in the quiet hours, kept (${timeOf(j.computed_at)})` : 'just now' };
      }) },
    // the tax part of GET /api/admin/insights/period, with the rates set now
    { name: 'tax_collected_read', area: 'numbers', kind: 'read', needs: ['taxSettings'],
      say: 'How much tax was collected for a period: on sessions and memberships paid online, at the counter by tax code, and the total - with the rates set now. Offer tax_export for the spreadsheet',
      params: { type: 'object', properties: RANGE },
      local: guard(async (a, ctx) => {
        const [from, to] = rangeOf(a, ctx.today), j = await getJson(ctx, `/api/admin/insights/period?from=${from}&to=${to}`), T = j.tax || {}, S = ctx.taxSettings || {};
        return { period: spanWords(from, to), tax_collected: cents(T.total_cents), online: `${cents(T.online_cents)} (sessions and memberships paid online, less the tax share of refunds)`,
          counter: `${cents(T.counter_cents)} (worked out from the counter's sales at the rates set now)`,
          counter_by_code: (T.counter_by_category || []).map(c => `${c.category}: ${cents(c.sales_cents)} sold at ${num(c.rate)}% = ${cents(c.tax_cents)}`),
          stripe_tax: T.by_stripe_tax ? 'Stripe Tax works the tax out - the counter figure here is at the rates on the Point of Sale - Tax Codes card, and Stripe\'s own tax reports have the exact amounts' : undefined,
          rates_now: S.read ? { bookings: S.bookings.on ? `${S.bookings.rate}% (${S.bookings.label})` : 'not charged', counter: S.codes.map(codeWords) } : undefined,
          revenue_before_online_tax: cents(num((j.money || {}).revenue_cents) - num(T.online_cents)) };
      }) },
    // GET /api/admin/tax/export.xlsx?from&to (routes/admin.js, owner only) - a workbook: the totals, each month, the counter
    // by tax code (services/insights.js taxSheets, written by services/xlsxwriter.js)
    { name: 'tax_export', area: 'numbers', kind: 'write', confirm: false,
      say: 'The tax collected for a period as a spreadsheet the owner downloads from the chat (Excel, Numbers and Google Sheets open it): the totals, each month, and the counter by tax code',
      params: { type: 'object', properties: RANGE },
      build: (a, ctx) => { const [from, to] = rangeOf(a, ctx.today); return { op: 'download', path: `/api/admin/tax/export.xlsx?from=${from}&to=${to}`, label: 'Download the tax spreadsheet' }; },
      describe: (a, ctx) => { const [from, to] = rangeOf(a, ctx.today); return `The tax collected ${spanWords(from, to)} as a spreadsheet: the totals, each month, and the counter by tax code - for your accountant.`; } },
    { name: 'tax_rates_read', area: 'numbers', kind: 'read', needs: ['taxSettings'],
      say: 'The tax rates set now: the tax on bookings paid online (on or off, its rate and its name on receipts), each of the counter\'s tax codes, and whether Stripe Tax works the tax out',
      params: { type: 'object', properties: {} },
      local: (a, ctx) => {
        const T = taxOf(ctx);
        return { bookings: T.bookings.on ? `${T.bookings.rate}% (${T.bookings.label} on receipts)` : `not charged (${T.bookings.rate}% is kept for when it is)`,
          counter_codes: T.codes.map(codeWords), stripe_tax: T.stripeTax ? 'on - Stripe works the tax out from the venue\'s address, for online bookings and the counter; the rates above are used only when it cannot' : 'off - the rates above are used',
          note: 'the rates are the owner\'s to give and keep current - the unit does not look tax rates up' };
      } },
    // what the receipts say about the tax (the Tax & Legal card: its label, the state or region, the business's tax ID) - the
    // owner's words, never looked up
    { name: 'tax_details_set', area: 'numbers', kind: 'write', confirm: true,
      say: 'Set what the receipts say about the tax: its name on receipts (the owner\'s words, like "Sales Tax"), the state or region shown with it, and the business\'s tax ID - the owner\'s own words, never looked up',
      params: { type: 'object', properties: { label: { type: 'string', minLength: 2, maxLength: 40 }, region: { type: 'string', maxLength: 40 }, tax_id: { type: 'string', maxLength: 40 } } },
      build: (a) => {
        const set = [];
        if (a.label !== undefined) set.push(['tax.label', a.label.trim()]);
        if (a.region !== undefined) set.push(['tax.region', a.region.trim()]);
        if (a.tax_id !== undefined) set.push(['tax.taxId', a.tax_id.trim()]);
        if (!set.length) throw new ActionError('say the tax\'s name on receipts, the region, or the tax ID');
        return { op: 'config', set };
      },
      describe: (a) => 'On receipts: ' + [a.label !== undefined && `the tax is called "${a.label.trim()}"`, a.region !== undefined && `the region "${a.region.trim()}"`, a.tax_id !== undefined && `the tax ID ${a.tax_id.trim() || '(none)'}`].filter(Boolean).join(', ') },
    // the bookings' tax: the Settings save (op config: tax.rate, tax.enabled - admin.html's Tax & Legal card); a counter code:
    // POST /api/pos/tax-codes (routes/pos.js:130, owner only) with every code, as the Tax Codes card saves them
    { name: 'tax_rate_set', area: 'numbers', kind: 'write', confirm: true, needs: ['taxSettings'],
      say: 'Change a tax rate to the one the OWNER gives - never a rate you looked up or worked out: the tax on bookings paid online, or one of the counter\'s tax codes (food, drinks, the golf line...). Or start or stop charging tax on bookings. A sale already made keeps the tax it was charged',
      params: { type: 'object', properties: {
        which: { type: 'string', minLength: 2, maxLength: 40, description: '"bookings" for the tax on bookings paid online, or the counter tax code\'s name (like Food, Beverage, Sim)' },
        rate: { type: 'number', minimum: 0, maximum: 30, description: 'the percent the owner said, like 7.375' },
        collect: { type: 'boolean', description: 'bookings only: false stops charging tax on bookings, true starts again' } }, required: ['which'] },
      build: (a, ctx) => {
        const T = taxOf(ctx), w = whichTax(T, a.which);
        if (a.rate === undefined && a.collect === undefined) throw new ActionError('say the new rate (a percent), or whether to charge it at all');
        if (w.kind === 'bookings') {
          const set = [];
          if (a.rate !== undefined) set.push(['tax.rate', a.rate]);
          if (a.collect !== undefined) set.push(['tax.enabled', !!a.collect]); else if (a.rate > 0 && !T.bookings.on) set.push(['tax.enabled', true]);
          return { op: 'config', set, expect: [['tax.rate', T.rawRate]] };
        }
        if (a.collect !== undefined) throw new ActionError('a counter tax code is not switched off - give it a rate of 0');
        if (a.rate === undefined) throw new ActionError(`say the new rate for ${w.code.name}`);
        return { op: 'http', method: 'POST', path: '/api/pos/tax-codes', body: { codes: T.codes.map(c => (c.id === w.code.id ? Object.assign({}, c, { rate: a.rate }) : c)) } };
      },
      describe: (a, ctx) => {
        const T = taxOf(ctx), w = whichTax(T, a.which), kept = ' Sales already made keep the tax they were charged.';
        if (w.kind === 'bookings') {
          const on = a.collect !== undefined ? !!a.collect : (a.rate > 0 ? true : T.bookings.on);
          if (!on) return `Stop charging tax on bookings paid online (it was ${T.bookings.rate}%).${kept}`;
          return `Tax on bookings paid online: ${a.rate !== undefined ? a.rate : T.bookings.rate}%${a.rate !== undefined ? ` (it was ${T.bookings.rate}%)` : ''}${T.bookings.on ? '' : ' - and bookings start being charged it (it was off)'}${T.stripeTax ? ' - while Stripe Tax is on, Stripe works the tax out and this rate is used only when it cannot' : ''}.${kept}`;
        }
        return `The counter's ${w.code.name} tax: ${a.rate}% (it was ${num(w.code.rate)}%), on every tab from now on${T.stripeTax ? ' - while Stripe Tax is on, Stripe works the tax out and this rate is used only when it cannot' : ''}.${kept}`;
      } },
  ];

  return { actions, loaders };
};
