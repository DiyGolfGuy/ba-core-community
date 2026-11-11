// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═════════════════════════════════════════════════════════════════════════════
//  services/assistant/answers.js - THE BOX'S OWN WORDS FOR WHAT IT LOOKED UP (Oct 25 2026)
//
//  maintainer, Oct 25 2026: "we can do this without the 4b ... run the commands you have been that dont even need AI just standard things
//  people ask and direct them so just keep making that stronger. Basically in a sense we are building our own AI in a way just with
//  hard code"; and before it: "Always real data never guessed".
//
//  An everyday question the box recognises (engine.js EVERYDAY) is looked up by the box itself; these words say what that read found,
//  at once, with nothing added - no model in between to paraphrase, slow down or get a number wrong. Each answer is built only from the
//  read's own result; a read with no words here, or one that went wrong in a way an owner cannot act on, goes to the model as before.
//  The demo brain (a sandbox's stand-in) words its own, so its menu of what it understands stays what a visitor sees.
//
//  THE READ'S OWN FIELDS, AND NOTHING SAID THAT THE READ SAYS IS NOT SO (Oct 25 2026, the review of the box's own words - test-box-answers):
//  every answer here reads the field names its read really returns (the events' `event`, the inbox's `from`, a device's `controls`, a
//  member's `free_time`, a menu part's `switched_off`, a tier's `retired`) - a field read under the wrong name was dropped in silence, and
//  "Open 10:00 AM - 10:00 PM, every day" was said to a facility open till 1 AM on Fridays. Dates and times are said as an owner reads them,
//  never as stored. Where a read leaves out the one fact that decides the answer (a season over the staffed calendar, a lock that is
//  chosen but not connected, a special switched off), that fact is read from the product's own gate in the unit's own process - the
//  function the route itself calls. Where it cannot be read there (the demo brain's process), the box says only what the read itself
//  found, named for what it is ("Marked staffed on the Website calendar"), and where even that would promise something - a door code
//  texted - the model words it.
// ═════════════════════════════════════════════════════════════════════════════
'use strict';

const list = (v, none) => (Array.isArray(v) ? (v.length ? v.join('; ') : none) : (v || none));
const lines = (v) => (Array.isArray(v) && v.length ? '\n- ' + v.join('\n- ') : '');
const cap = (s) => String(s || '').replace(/^./, c => c.toUpperCase());
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const isNone = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const H = () => require('./helpers');

// ── a stored date, time or day as an owner reads it (Oct 25 2026: "Last visits: 2026-10-20 120 min", "sends 2026-11-02 09:00",
//    "joined 2026-03-01" and "mon,tue,wed" reached owners) ──
const ISO_DAY = /^\d{4}-\d\d-\d\d$/;
const dayOf = (v) => (ISO_DAY.test(String(v || '')) ? H().dayWords(String(v)) : String(v == null ? '' : v));
// a date that may be years back carries its year ("joined Mar 1, 2025")
const dateOf = (v) => (ISO_DAY.test(String(v || '')) ? new Date(v + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : String(v == null ? '' : v));
const clockOf = (t) => (t === '23:59' || t === '24:00' ? 'midnight' : /^\d\d:\d\d$/.test(String(t || '')) ? H().timeWords(t) : String(t || ''));
// a local stamp "YYYY-MM-DD HH:MM" (hours_send_read's next send)
// a day more than about ten months ahead says its year (Oct 27 2026, the review of 116dc9a): "Wed, Dec 1" set 400 days out read as
// the coming Dec 1 - a Tuesday
const farDayOf = (v) => (ISO_DAY.test(String(v || '')) && Date.parse(v + 'T12:00:00Z') - Date.now() > 300 * 864e5 ? `${dayOf(v)}, ${String(v).slice(0, 4)}` : dayOf(v));
const stampOf = (v) => { const m = String(v || '').match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d)/); return m ? `${H().dayWords(m[1])}, ${clockOf(m[2])}` : dayOf(v); };
const minsWords = (n) => { n = Math.round(Number(n) || 0); if (n < 60) return plural(n, 'minute'); const h = Math.floor(n / 60), m = n % 60; return plural(h, 'hour') + (m ? ` ${plural(m, 'minute')}` : ''); };
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAME = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const andList = (l) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);
// days in words, Monday first, a run of three or more as "Monday to Friday": ["sat", "sun"] -> "Saturday and Sunday"
function daysWords(keys) {
  const ks = WEEK.filter(d => keys.includes(d)), runs = [];
  for (const d of ks) { const r = runs[runs.length - 1]; if (r && WEEK.indexOf(d) === WEEK.indexOf(r[r.length - 1]) + 1) r.push(d); else runs.push([d]); }
  return andList(runs.flatMap(r => (r.length >= 3 ? [`${DAY_NAME[r[0]]} to ${DAY_NAME[r[r.length - 1]]}`] : r.map(d => DAY_NAME[d]))));
}
// the days a read wrote as codes ("mon,tue,wed" or "mon, tue"), or null when any of it is not a day
const dayCodes = (v) => { const ks = String(v || '').toLowerCase().split(/\s*,\s*/).filter(Boolean); return ks.length && ks.every(d => DAY_NAME[d]) ? ks : null; };

// ── THE PRODUCT'S OWN GATE, IN THE UNIT'S OWN PROCESS (Oct 25 2026): a module the unit has already loaded (the route the read just
//    called loaded it), or null. Nothing is loaded from here: a stand-in brain or a battery that only wants the words loads nothing of
//    the unit's, and an answer that needs the gate is then left to the model ──
const loaded = (rel) => { try { const m = require.cache[require.resolve(rel)]; return m && m.exports ? m.exports : null; } catch { return null; } };
// who decides the staffed hours today - services/staffing.effectiveWindow's own order: the facility runs staffed (every day), staffed
// hours switched off (no day), a season in use (its weekdays, and the single days changed from it), else the Website calendar (GET
// /api/website/staffed reads the same). { unreadable } when a season decides but its changed days cannot be read here: the model words it
function staffedRule() {
  const S = loaded('../staffing'), C = loaded('../config');
  if (!S || !C || typeof S.activeSeason !== 'function' || typeof C.getConfig !== 'function') return null;
  try {
    const cfg = C.getConfig() || {};
    // (the Schedule tab - the "Staffed hours" switch, the season, a single day changed - shows only while Employee scheduling is on:
    // admin.html schedVisibility; routes/website.js reads the same)
    const schedulingOn = !!(cfg.scheduling && cfg.scheduling.enabled);
    if ((S.accessStyleOf ? S.accessStyleOf(cfg.booking) : '') === 'staffed') return { always: true };
    if (cfg.coverage && cfg.coverage.scheduleOff === true) return { off: true, schedulingOn };
    const season = S.activeSeason();
    if (!season) return { calendar: true };
    const changed = seasonChanges(S, season, cfg);
    return changed ? { season, schedulingOn, changed } : { unreadable: true };
  } catch { return null; }
}
// THE SINGLE DAYS CHANGED FROM A SEASON (Oct 27 2026, the review of the box's own words: "are we staffed this week" was given the
// season's weekdays alone - "Thursday 4:00 PM - 10:00 PM" in a week whose Thursday the owner had made unstaffed for a holiday - while
// services/staffing.effectiveWindow's step 3 lets a day changed on the Schedule tab (coverage_exceptions) outrank the season's weekday).
// The read does not carry the range asked about, so every day changed from today on is said with its own date, each decided by
// effectiveWindow itself (the function the booking page and checkout call) and said only where it differs from the season's weekday;
// a day already past is not. Null when they cannot be read in this process.
function seasonChanges(S, season, cfg) {
  const D = loaded('../db');
  if (!D || !D.db || typeof S.effectiveWindow !== 'function' || typeof S.dowMon0 !== 'function') return null;
  try {
    // (the facility's own date - services/timeclock.localToday's reading: at 9 PM in Chicago the UTC date is already tomorrow)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: (cfg.server && cfg.server.timezone) || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (!ISO_DAY.test(today)) return null;
    const rows = D.db.prepare(`SELECT date, note FROM coverage_exceptions WHERE date >= ? ORDER BY date ASC, id DESC`).all(today);
    const days = Array.isArray(season.days) ? season.days : [], out = [], seen = new Set();
    const span = (w) => (!w ? 'none' : w.whole ? 'all' : `${w.start}-${w.end}`);
    for (const ex of rows || []) {
      if (!ex || !ISO_DAY.test(String(ex.date)) || seen.has(ex.date)) continue;
      seen.add(ex.date);   // (the newest row for a day, as effectiveWindow reads it)
      const d = days[S.dowMon0(ex.date)] || {}, s = String(d.start || '').trim(), e = String(d.end || '').trim();
      const usual = d.staffed === 1 || d.staffed === true ? (s && e ? `${s}-${e}` : 'all') : 'none', w = S.effectiveWindow(ex.date);
      if (span(w) === usual) continue;
      out.push({ date: ex.date, hours: !w ? 'not staffed' : w.whole ? 'all day' : `${clockOf(w.start)} - ${clockOf(w.end)}`, note: String(ex.note || '').trim() });
    }
    return out;
  } catch { return null; }
}
// (the Website card's own words for it - admin-website.html staffedSourceNote: the Schedule tab is hidden while scheduling is off)
const TAB_HIDDEN = ' The Schedule tab is hidden while Employee scheduling is off: switch it on in Settings > Staff > The Counter first.';
// a season's staffed weekdays (Monday first, as Settings > Schedule keeps them), the same hours together: "Thursday 4:00 PM - 10:00 PM;
// Friday and Saturday all day"
function seasonWords(season) {
  const days = Array.isArray(season.days) ? season.days : [], groups = [];
  WEEK.forEach((d, i) => {
    const x = days[i] || {}; if (!(x.staffed === 1 || x.staffed === true)) return;
    const h = x.start && x.end ? `${clockOf(x.start)} - ${clockOf(x.end)}` : 'all day', g = groups.find(y => y.h === h);
    if (g) g.days.push(d); else groups.push({ h, days: [d] });
  });
  return groups.map(g => `${daysWords(g.days)} ${g.h}`).join('; ');
}

const SAY = {
  playing_now_read: (o) => `Right now (${o.now}): ${list(o.playing, 'nobody is playing')}. Next today: ${list(o.next_today, 'nothing else booked')}.`,
  day_outlook_read: (o) => {
    if (!o.bookings) return `${o.day}: ${o.note || 'nothing booked'}.${o.evening && o.evening.free_all_the_time ? ` From ${o.evening.from} every bay is free.` : ''}`;
    const e = o.evening;
    return `${o.day}: ${plural(o.bookings, 'booking')}, ${o.hours_booked} hours booked, first at ${o.first_start}, last finishing ${o.last_finish}. Longest: ${o.longest}.`
      + (e ? ` From ${e.from}: ${e.busiest_hour ? 'busiest at ' + e.busiest_hour : 'no bay booked'}${Array.isArray(e.free_all_the_time) && e.free_all_the_time.length ? `; free all evening: ${e.free_all_the_time.join(', ')}` : ''}.` : '')
      + lines(o.list);
  },
  bookings_read: (o) => (o.upcoming_for ? `Coming up for ${o.upcoming_for}:${lines(o.bookings)}` : `${o.to ? `${o.from} to ${o.to}` : o.from}: ${plural(Number(o.booked) || 0, 'booking')}${o.cancelled ? `, ${o.cancelled} cancelled` : ''}${o.unfinished_checkouts ? `, ${o.unfinished_checkouts} checkouts not finished` : ''}.${Array.isArray(o.bookings) && o.bookings[0] !== 'no bookings' ? lines(o.bookings) : ''}`),
  schedule_read: (o) => {
    // (the shift as an owner reads it - "Sun, Oct 25, 5:00 PM - 10:00 PM" - never the stored "2026-10-25 17:00-22:00")
    const H = require('./helpers'), when = (x) => (/^\d{4}-\d\d-\d\d$/.test(String(x.date)) ? H.dayWords(x.date) : x.date) + ', ' + [x.from, x.to].map(t => (/^\d\d:\d\d$/.test(String(t)) ? H.timeWords(t) : t)).join(' - ');
    const s = (o.shifts || []).map(x => `${when(x)}: ${x.who}${x.label ? ' (' + x.label + ')' : ''}`);
    return `${s.length ? 'On the schedule:' + lines(s) : 'Nobody is on the schedule then.'}${o.requests_waiting ? `\n${plural(o.requests_waiting, 'request')} waiting for your yes or no.` : ''}${o.hours_nobody_covers ? `\n${plural(o.hours_nobody_covers, 'hour')} nobody covers.` : ''}`;
  },
  roster_read: (o) => (Array.isArray(o.staff) && o.staff.length ? `Your staff: ${o.staff.join(', ')}.` : 'Nobody is on the staff list yet - say "add Jordan Lee to the staff".'),
  clock_read: null,   // (its shapes vary by what was asked - the model words it)
  // (time off and a shift to pick up or drop, each in its own words - the dates as an owner reads them)
  requests_read: (o) => {
    if (!Array.isArray(o.waiting)) return null;
    const H = require('./helpers'), day = (d) => (/^\d{4}-\d\d-\d\d$/.test(String(d)) ? H.dayWords(d) : d);
    const shift = (x) => { const m = String(x || '').match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)-(\d\d:\d\d)$/); return m ? `${H.dayWords(m[1])}, ${H.timeWords(m[2])} - ${H.timeWords(m[3])}` : x; };
    const one = (w) => (w.kind === 'shift' ? `${w.who} wants ${w.wants} the shift ${shift(w.shift)}` : `${w.who} - time off ${day(w.from)}${w.to && w.to !== w.from ? ' to ' + day(w.to) : ''}${w.note ? ' (' + w.note + ')' : ''}`) + ` (#${w.request_id})`;
    return o.waiting.length ? `Waiting for your yes or no:${lines(o.waiting.map(one))}` : 'No requests waiting.';
  },
  // (Oct 25 2026, the review: "are we staffed this week" on a facility whose season decides was told "No staffed days in that time - door
  // codes only", and one with staffed hours switched off was given calendar days that no longer count: the read lists the Website
  // calendar only, and the calendar decides only when nothing above it does - staffedRule, the product's own order. Where that cannot be
  // read - outside the unit's own process, the demo brain's - the calendar is said as the calendar, never as who is staffed)
  // (Oct 27 2026, the review of those words: with Employee scheduling off the owner was sent to Settings > Schedule, a tab hidden then -
  // the Website card's own note is said with it; and a season's weekdays were said over a day changed from it - seasonChanges)
  staffed_read: (o) => {
    const r = staffedRule(), marked = Array.isArray(o.staffed_days) && o.staffed_days.length;
    if (!r) return Array.isArray(o.staffed_days) ? `Marked staffed on the Website calendar:${lines(o.staffed_days.map(d => `${d.day}, ${d.hours}${d.note ? ' (' + d.note + ')' : ''}`))}`
      : /^no staffed days\b/i.test(String(o.staffed_days)) ? 'No days are marked staffed on the Website calendar in that time.' : null;
    if (r.unreadable) return null;
    if (r.always) return 'Every day counts as staffed: the facility is set to run staffed (Settings > Booking > Facility Access), so every booking is a staffed one - the days marked on the Website calendar do not change that.';
    if (r.off) return `Staffed hours are switched off in Settings > Schedule (the "Staffed hours" switch): no day counts as staffed until they are switched back on there${marked ? ' - the days marked on the Website calendar are not counted' : ''}.${r.schedulingOn ? '' : TAB_HIDDEN}`;
    if (r.season) { const w = seasonWords(r.season), name = r.season.name || 'in use', ch = r.changed || [], shown = ch.slice(0, 8);
      return `The season "${name}" in Settings > Schedule decides your staffed hours${w ? `: ${w}` : ', and it marks no day as staffed'}.${marked ? ' The days marked on the Website calendar are not counted while it is in use.' : ''}${r.schedulingOn ? '' : TAB_HIDDEN}`
        + (ch.length ? `\nSingle days changed from it:${lines(shown.map(c => `${farDayOf(c.date)}: ${c.hours}${c.note ? ' (' + c.note + ')' : ''}`))}${ch.length > shown.length ? `\n(and ${ch.length - shown.length} more after those)` : ''}` : ''); }
    return Array.isArray(o.staffed_days) ? `Staffed:${lines(o.staffed_days.map(d => `${d.day}, ${d.hours}${d.note ? ' (' + d.note + ')' : ''}`))}`
      : /^no staffed days\b/i.test(String(o.staffed_days)) ? 'No staffed days in that time.' : null;
  },
  // (a part or an item switched off is marked as the read marks it - `switched_off`, areas/menu.js menu_read; the owner may switch it back
  // on, so it is shown, never dropped - Oct 25 2026: "Old IPA $6" was said beside the items on sale)
  menu_read: (o) => {
    const parts = (o.menu || []).map(p => `${p.part}${p.switched_off ? ' (switched off)' : ''}: ${(p.items || []).map(i => `${i.item} ${i.price}${i.sold_out ? ' (sold out)' : ''}${i.switched_off ? ' (switched off)' : ''}`).join(', ') || 'nothing yet'}`);
    return (parts.length ? 'Your menu:' + lines(parts) : 'Nothing on the menu yet - say "add a new beer for $5 called Ale IPA".') + (/^no\b/.test(String(o.on_the_website || '')) ? '\nIt is not on your website yet - say "show our menu on the website" to add it.' : '');
  },
  // (Oct 25 2026, the review: "What specials are running?" listed a special switched off and a one-day special long past under "Your
  // specials:", with "2026-10-18" and "mon,tue,wed" as stored. The read carries neither the switch nor today's date, so both come from
  // services/specials itself - list() is the route's own rows in the read's own order, clock() the facility's date; a list that no longer
  // matches the read is not matched up by guesswork: the model words it. Outside the unit's own process (the demo brain's) the read is
  // said as it came - its days in words, what is on now - with nothing said about the rest)
  counter_specials_read: (o) => {
    if (!Array.isArray(o.specials)) return null;
    if (!o.specials.length) return 'No counter specials - say "wings $2 off on Tuesdays" to make one.';
    const weekly = (ds) => (ds.length === 1 ? 'every ' + DAY_NAME[ds[0]] : daysWords(ds));
    const asRead = () => `Your specials:${lines(o.specials.map(s => { const m = /^([^,]*(?:,[a-z]{3})*),\s*(.*)$/.exec(String(s.when || '')) || [], ds = dayCodes(m[1]);
      return `${s.special} - ${s.deal} on ${s.on}, ${m[1] ? `${ISO_DAY.test(m[1]) ? dayOf(m[1]) : ds ? weekly(ds) : m[1]}, ${m[2]}` : s.when}${s.on_now ? ' (on now)' : ''}`; }))}`;
    const S = loaded('../specials');
    if (!S) return asRead();
    let rows, today;
    try { rows = S.list(); today = S.clock().date; } catch { return null; }
    if (Array.isArray(rows) && !rows.length) return asRead();   // (its table not open in this process - services/specials.list answers [] then)
    if (!Array.isArray(rows) || rows.length !== o.specials.length || rows.some((r, i) => !r || r.name !== o.specials[i].special) || !ISO_DAY.test(String(today))) return null;
    // (its days and time from the row itself, in the route's own words for the time - services/specials.timeWords)
    const when = (r) => { const ds = dayCodes(r.days), t = typeof S.timeWords === 'function' ? S.timeWords(r) : '';
      return `${r.date ? dayOf(r.date) : ds ? weekly(ds) : r.days ? String(r.days) : 'every day'}, ${t || 'all day'}`; };
    // (a one-day special running past midnight is still on in the small hours after its day - on now is never "past")
    const one = (s, i) => { const r = rows[i], past = !!r.date && r.date < today && !s.on_now;
      return `${s.special} - ${s.deal} on ${s.on}, ${when(r)}${s.on_now ? ' (on now)' : ''}${!r.active ? ' (switched off)' : past ? ' (past - that day is over)' : ''}`; };
    return `Your specials:${lines(o.specials.map(one))}`;
  },
  tax_rates_read: (o) => `Bookings: ${o.bookings}. At the counter: ${list(o.counter_codes, 'no tax codes')}. Stripe Tax: ${o.stripe_tax}. The rates are yours to set and keep current - the box does not look them up.`,
  tax_collected_read: (o) => `${o.period}: ${o.tax_collected} tax collected - online ${o.online}; counter ${o.counter}.${Array.isArray(o.counter_by_code) && o.counter_by_code.length ? ' By code: ' + o.counter_by_code.join('; ') + '.' : ''} Say "export the tax" for the spreadsheet.`,
  revenue_read: (o) => `${o.period}: ${o.revenue} taken (money actually taken, minus refunds). It came in as ${Object.entries(o.came_in || {}).filter(([, v]) => v && v !== '$0.00').map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') || 'nothing yet'}; refunds ${o.refunds}. ${o.sessions_played} sessions played; the bays were booked ${String(o.busy || '').replace(/ of open bay hours$/, ' of their open hours')}. Card fees about ${o.estimated_card_fees}; kept after card fees ${o.take_home_estimate}.`,
  insights_read: (o) => {
    const b = o.bookings || {}, m = o.money || {}, c = o.customers || {}, s = o.memberships || {};
    return `${o.period}, against ${o.against}:\n- Money: ${m.revenue} taken (${m.moved}); kept after card fees ${m.kept_after_card_fees}\n- Bookings: ${b.count} (${b.moved}), ${b.hours_played} hours${b.bays_full ? '; ' + b.bays_full : ''}\n- Players: ${c.played} (${c.new} new, ${c.coming_back} coming back; ${c.against} the period before)`
      + (s.active_now ? `\n- Members: ${s.joined} joined (${s.joined_against} before), ${s.active_now} active` : '')
      + (b.busiest_day ? `\n- Busiest day: ${b.busiest_day}; busiest start: ${b.busiest_start}` : '')
      + (Array.isArray(o.counter_best_sellers) && o.counter_best_sellers.length ? `\n- Best sellers: ${o.counter_best_sellers.join('; ')}` : '')
      + '\nProfit: the box knows the money taken and the card fees, not rent, staff or stock - take those from what was kept.';
  },
  trends_read: (o) => (typeof o.months === 'string' ? o.months : `Busiest month: ${o.busiest_month}.${o.slowest_month ? `\nSlowest: ${o.slowest_month}.` : ''}${o.this_year ? '\n' + o.this_year + '.' : ''}${o.last_three_months ? '\n' + o.last_three_months + '.' : ''}\nMonth by month (records from ${o.records_start}):${lines(o.months)}\nWorked out ${o.worked_out}.`),
  specials_effect_read: (o) => (typeof o.specials === 'string' ? o.specials : o.specials.map(x => x.note ? `${x.special}: ${x.note}.` : `${x.special} (${x.runs}, since ${x.since}):\n- With it: ${x.with_it}\n- Before it: ${x.before_it}${x.on_its_days ? '\n- On its days: ' + x.on_its_days : ''}`).join('\n') + '\n' + cap(o.means) + '.'),
  members_report_read: (o) => `${plural(o.active_members, 'active member')} - ${o.billed_online} billed online, ${o.added_by_hand} added by hand${o.payment_past_due ? `, ${o.payment_past_due} with a payment past due` : ''}. ${o.joined_last_30_days} joined in the last 30 days.${Array.isArray(o.by_tier) && o.by_tier.length ? ' By membership: ' + o.by_tier.map(t => `${t.tier} ${t.active}`).join(', ') + '.' : ''} Membership value: ${o.monthly_value}.`,
  members_growth_read: (o) => `${o.period}: ${o.signed_up} signed up${Array.isArray(o.who_signed_up) ? ' - ' + o.who_signed_up.join('; ') : ''}.${lines((o.compared_with || []).map(cap))}\n${o.active_members_now} active members now.`,
  members_read: (o) => {
    const t = o.totals || {};
    return `${t.active} active, ${t.suspended} paused, ${t.ended} ended.${Array.isArray(o.by_tier) && o.by_tier.length ? ' By membership: ' + o.by_tier.filter(x => x.active).map(x => `${x.tier} ${x.active}`).join(', ') + '.' : ''}${Array.isArray(o.members) && o.members.length ? lines(o.members.filter(m => m && m.who).map(m => `${m.who} - ${m.tier}, ${m.status}${m.joined ? ', joined ' + dateOf(m.joined) : ''}`)) : ''}${o.showing ? '\n(' + o.showing + ')' : ''}`;
  },
  // (the free time left is the read's `free_time` - areas/money.js member_usage_read; it read `free_time_left`, which no read sets, so a
  // member's free hours left - rule 3, free time first - were never said; the last visits as an owner reads them, Oct 25 2026)
  member_usage_read: (o) => `${o.member} (${o.tier}, ${o.status}): played ${o.played.today} today, ${o.played.this_week} this week, ${o.played.this_month} this month; ${plural(Number(o.guests_this_month) || 0, 'guest')} this month.`
    + (o.free_time ? ` Free time left: ${o.free_time}.` : '') + (o.tier_gives ? ` ${cap(o.tier)} gives ${o.tier_gives}.` : '')
    + (Array.isArray(o.last_visits) && o.last_visits.length ? ' Last visits: ' + o.last_visits.map(v => `${dayOf(v.date)}, ${minsWords(v.minutes)}${v.bay ? ' on ' + v.bay : ''}${v.guests ? ` with ${plural(Number(v.guests), 'guest')}` : ''}`).join('; ') + '.' : ''),
  // (a tier deleted on the Members screen is only retired - GET /api/members/tiers still returns it, and the read marks it `retired`
  // (areas/money.js tierWords); it was said beside the tiers on offer, Oct 25 2026. Shown last and marked, never dropped: its members
  // keep it until moved)
  tiers_read: (o) => (Array.isArray(o.tiers) && o.tiers.length ? `Your memberships:${lines(o.tiers.filter(t => !t.retired).concat(o.tiers.filter(t => t.retired)).map(t => `${t.tier}${t.retired ? ' (retired - no longer offered)' : ''} - ${t.price}: ${t.members_get}; ${t.when}; ${t.guests}${t.sold_online === false && !t.retired ? '; not sold online' : ''}${t.active_members !== undefined ? ` (${plural(t.active_members, 'member')})` : ''}`))}` : 'No memberships yet - say "make a new membership called Gold, $99 a month with 8 hours included".'),
  // (each message as the read gives it - areas/messages.js inbox_read: `from`, `when`, the form, the date and party size asked about, the
  // first words, and on the box's own AI the email and phone; it read `who` and `about`, which no read sets, so the sender was dropped -
  // Oct 25 2026)
  inbox_read: (o) => {
    const one = (m) => { if (typeof m === 'string') return m;
      const asked = [m.about_date && `day asked about: ${m.about_date}`, m.people && `people: ${m.people}`, m.email && `email ${m.email}`, m.phone && `phone ${m.phone}`].filter(Boolean);
      return `${[m.from, m.when].filter(Boolean).join(', ')}${m.form ? ` (${m.form})` : ''}${m.handled ? ' - handled' : ''}: ${m.says && m.says !== '(no message)' ? `"${m.says}"` : 'no message'}${asked.length ? ' - ' + asked.join('; ') : ''}`; };
    const shown = (o.messages || []).map(one);
    return `${o.new_messages ? `${plural(Number(o.new_messages), 'new message')}:` : `No new messages.${shown.length ? '\nThe latest:' : ''}`}${lines(shown)}`
      + (o.more_not_shown ? `\n(and ${o.more_not_shown} more in Admin > Website > Inbox)` : '') + (o.contact_details ? `\n${cap(o.contact_details)}.` : '');
  },
  updates_read: (o) => `Running: ${o.running}. Waiting: ${o.waiting}.${o.last_asked_ba ? ' Last asked BA: ' + o.last_asked_ba + '.' : ''}${o.can_undo_last_update ? ' The last update can be undone.' : ''}`,
  health_read: (o) => (Array.isArray(o.needs_attention) ? (o.needs_attention.length ? `Needs your attention:${lines(o.needs_attention.map(n => `${n.what} (${n.level})${n.do ? ' - ' + n.do : ''}`))}` : 'Everything is working - nothing needs your attention.') : null),
  setup_status: (o) => {
    const it = o.items || [], open = it.filter(i => !i.done), req = open.filter(i => !i.optional);
    return open.length ? `Set up: ${it.length - open.length} of ${it.length}. Still to do:${lines(req.concat(open.filter(i => i.optional)).map(i => `${i.label}${i.optional ? ' (optional)' : ''}${i.sub ? ' - ' + i.sub : ''}`))}` : 'Everything on the setup list is done.';
  },
  deals_read: (o) => `Booking deals: ${list((o.booking_deals || []).map(d => `${d.deal} - ${d.what}${d.on ? '' : ' (off)'}`), 'none')}. Packages: ${list((o.packages || []).map(p => `${p.package} - ${p.price}${p.includes ? ', ' + p.includes : ''}${p.on ? '' : ' (off)'}`), 'none')}.`,
  deal_ideas: (o) => (Array.isArray(o.ideas) ? `Here is what the box can run for you:${lines(o.ideas.map(i => `${i.kind}: ${i.example} (${i.how})`))}\nSay one the way you would put it and the box sets it up.` : null),
  discount_codes_read: (o) => (Array.isArray(o.codes) ? (o.codes.length ? `Your codes:${lines(o.codes.map(c => `${c.code} - ${c.gives}, used ${c.used}, ${c.per_person}, ${c.expires}${c.works_now === false ? ' (not working now)' : ''}`))}` : 'No discount codes yet - say "make a code SPRING20 for 20% off".') : null),
  // (a day with hours of its own is said with them - the read's `days_with_own_hours`, services/hours.js; "Open 10:00 AM - 10:00 PM, every
  // day" was said to a facility open till 1 AM on Fridays and Saturdays, the hours the box itself puts up from "open late fri till 1".
  // The days in words, "open 24 hours" said once - Oct 25 2026)
  booking_rules_read: (o) => {
    const all = String(o.days_open || 'every day') === 'every day', days = all ? WEEK.slice() : dayCodes(o.days_open);
    if (!days) return null;
    const open = WEEK.filter(d => days.includes(d)), shut = WEEK.filter(d => !open.includes(d)), own = {};
    for (const part of String(o.days_with_own_hours || '').split(/,\s*(?=(?:sun|mon|tue|wed|thu|fri|sat) )/).filter(Boolean)) {
      const m = /^(sun|mon|tue|wed|thu|fri|sat) (.+)$/.exec(part.trim()); if (!m) return null; own[m[1]] = m[2]; }
    const which = all ? 'every day' : daysWords(open) + (shut.length ? ` (closed ${daysWords(shut)})` : '');
    let hours;
    if (/^open 24 hours$/i.test(String(o.open))) hours = `Open 24 hours, ${which}`;
    else {
      // the open days, each with its own hours or the usual ones, the days next to each other with the same hours together
      const groups = [];
      for (const d of open) { const h = own[d] || String(o.open), g = groups[groups.length - 1];
        if (g && g.h === h && WEEK.indexOf(d) === WEEK.indexOf(g.days[g.days.length - 1]) + 1) g.days.push(d); else groups.push({ h, days: [d] }); }
      hours = groups.length === 1 ? `Open ${groups[0].h}, ${which}` : `Open ${which}: ${groups.map(g => `${daysWords(g.days)} ${g.h}`).join('; ')}`;
    }
    return `${hours}. ${cap(o.how_it_runs)}; ${o.who_can_book} can book; one booking takes ${o.one_booking_takes}; sessions ${o.session_length}; book up to ${o.book_ahead_days} days ahead; cancel up to ${o.cancel_up_to_hours_before} hours before; check-in ${o.check_in}.`;
  },
  // (each device with what each of its controls is doing now and where it is - the read keeps those under `controls` (`is`, `bay`) and the
  // whole facility's own devices under `facility`; it read `d.state` and `d.bay`, which no read sets, so on or off was never said - Oct 25
  // 2026. Home Assistant's own words for a state: unavailable is a device not answering)
  smarthome_read: (o) => {
    const is = (v) => ({ on: 'on', off: 'off', unavailable: 'not answering', unknown: 'state not known' }[String(v)] || String(v == null ? 'state not known' : v));
    const where = (b) => (!b || b === 'not on a bay' ? 'not on a bay' : b === 'the facility' ? 'the whole facility' : b);
    const dev = (d) => { if (typeof d === 'string') return d;
      const cs = Array.isArray(d.controls) ? d.controls : [], kind = d.kind && d.kind !== 'other' ? ` (${d.kind})` : '';
      if (cs.length === 1) return `${d.device}${kind}: ${is(cs[0].is)}, ${where(cs[0].bay)}`;
      return `${d.device}${kind}: ${cs.map(c => `${c.name} ${is(c.is)}, ${where(c.bay)}`).join('; ') || 'nothing on it to switch'}`; };
    const hub = o.hub && o.hub.connected ? 'The smart-home hub is connected.' : `The smart-home hub is not connected${o.hub && o.hub.why ? ' - ' + o.hub.why : ''}.`;
    const fac = Array.isArray(o.facility) && o.facility.length ? `\nThe facility's own devices:${lines(o.facility.map(f => `${f.device}: ${f.now}${f.why ? ' - ' + f.why : ''} (follows ${f.follows})`))}` : '';
    return `${hub}${Array.isArray(o.devices) && o.devices.length ? ' Devices:' + lines(o.devices.map(dev)) : ' No devices paired yet - say "pair a plug" to add one.'}${fac}${o.pairing_now ? `\nPairing now: ${o.pairing_now}` : ''}`;
  },
  // (no code is made or texted at a facility set to run staffed, or with no lock connected - services/doorlock: codeTimingForPage,
  // lockConfigured, the product's own gates; "Door codes go to no lock ... texted 15 minutes before" and "Door codes go to RemoteLock" on a
  // factory-fresh unit with no lock were said, Oct 25 2026. Whether the chosen lock is connected is the product's own test, read in the
  // unit's own process; not known there, the model words it)
  doors_read: (o) => {
    const where = o.where ? ` (${o.where})` : '';
    if (o.staffed_no_codes) return `No door codes are made or texted: the facility is set to run staffed.${where}`;
    if (o.lock === 'no lock') return `No door codes are made or texted: no lock is set up. To send codes, choose your lock${where}.`;
    const D = loaded('../doorlock'); let connected;
    try { connected = D.lockConfigured(); } catch { return null; }
    if (connected !== true) return `No door codes are made or texted yet: ${o.lock} is chosen, but it is not connected - its details are not saved${where}.`;
    return `Door codes go to ${o.lock}: a code works ${o.code_works_before_session_mins} minutes before a session until ${o.code_works_after_session_mins} minutes after, and is texted ${o.texted_before_session_mins} minutes before${o.lock_checked_before_texting ? ' - once the lock has confirmed it' : ''}.${where}`;
  },
  connections_read: (o) => { const st = (v, how) => (/^not yet\b/.test(String(v)) ? `not set up yet - say "${how}"` : v);
    return `Card payments (Stripe): ${/^not yet\b/.test(String(o.stripe)) ? 'not set up yet - say "connect Stripe"' : o.stripe}\nEmail: ${st(o.email, 'set up email')}\nTexting: ${st(o.texting, 'set up texting')}\nCard readers: ${o.card_readers}\nTips: ${o.tip_prompt}`; },
  gift_cards_read: (o) => (typeof o.gift_cards === 'string' ? cap(o.gift_cards) + '.' : null),
  blocks_read: (o) => (Array.isArray(o.blocks) ? (o.blocks.length && o.blocks[0] !== 'no blocks' ? `Blocked off:${lines(o.blocks)}` : 'Nothing is blocked off.') : null),
  automation_read: (o) => (o.all_well ? 'Everything turned on and off as it should.' : `${(o.problems || []).length ? 'Problems:' + lines(o.problems.map(p => typeof p === 'string' ? p : [p.what || p.job, p.bay, p.why || p.error].filter(Boolean).join(' - '))) + '\n' : 'Nothing failed. '}${o.retrying_by_themselves ? (o.retrying_by_themselves === 1 ? '1 step is retrying by itself. ' : `${o.retrying_by_themselves} steps are retrying by themselves. `) : ''}${o.past_their_time_not_run_yet ? (o.past_their_time_not_run_yet === 1 ? '1 step is past its time and has not run yet.' : `${o.past_their_time_not_run_yet} steps are past their time and have not run yet.`) : ''}`),
  end_of_day_read: (o) => (o.counter && typeof o.counter === 'string' ? `${o.day}: ${o.counter}.` : null),
  // (each event by its name - the read's `event`, areas/website.js events_read; it read `title`, so only dates were said - Oct 25 2026)
  events_read: (o) => (Array.isArray(o.upcoming) ? (o.upcoming.length ? `Coming up:${lines(o.upcoming.map(e => typeof e === 'string' ? e : [e.event, e.when || dayOf(e.date)].filter(Boolean).join(' - ')))}` : 'No events coming up - say "add league night next Thursday at 7".') : null),
  // (online means a connection was made once - services/getonline `connected` is a tunnel and its file, nothing more; whether the site
  // answers from outside is the last check's, and the connection program and service are their own facts. "Online: yes" was said while
  // the last check found the site not answering, Oct 25 2026 - each said as the read has it, and "online" only when it answered)
  online_read: (o) => {
    const c = String(o.connected || ''), m = /^yes - at (.*)$/.exec(c);
    const now = o.connecting_now ? `\nConnecting now: ${o.connecting_now}.` : '';
    if (!m) return `Not online yet${/^not yet\b/.test(c) ? c.replace(/^not yet/, '') : ''}.${now}${o.last_try ? `\nThe last try: ${o.last_try}.` : ''}`;
    const at = m[1] || 'its address', out = String(o.answers_from_outside || '');
    const svc = String(o.connection_service || ''), problems = [];
    if (o.program) problems.push(cap(o.program));
    if (/^not on this box\b/.test(svc)) problems.push('This Pi has no cloudflared service this software can restart - finish with the Cloudflare Tunnel guide (Admin > Guides)');
    // (systemd's own words: "reloading" is a running service reading its settings again - Oct 27 2026)
    else if (svc && !/^(?:active|reloading)$/.test(svc)) problems.push(`The connection service is not running (it reads "${svc}")`);
    // ("online" is never said over the box's own side of the connection not working, Oct 27 2026 - "Your site is online at x.com" came
    // first, and "The connection service is not running" after it: the last outside check is stored, not asked again, and may be from
    // before the service stopped. Each fact is said as the read has it, and the owner is told how to ask again)
    const head = problems.length ? `Your site is set up at ${at}, but the box's side of its connection is not working:${lines(problems)}\n`
      + (out === 'yes' ? 'It answered from outside the last time the box checked - ask me to check it from outside again to see whether it still does.'
        : /^not\b/.test(out) ? 'It did not answer from outside the last time the box checked.' : 'The box has not checked it from outside yet.')
      : out === 'yes' ? `Your site is online at ${at}: it answered from outside the last time the box checked.`
      : /^not\b/.test(out) ? `Your site is set up at ${at}, but it did not answer from outside the last time the box checked - ask me to check it from outside again.`
      : `Your site is set up at ${at}; the box has not checked it from outside yet - ask me to check it from outside.`;
    return head + now + (o.last_try && !/^connected\b/.test(String(o.last_try)) ? `\nThe last try: ${o.last_try}.` : '');
  },
  // ONE BAY, IN FULL (Oct 25 2026, the review: "what happens in Bay 1 when a session starts" - engine.js EVERYDAY's bay_read {bay} - was
  // told the bay's status and never what switches on or when): one bay asked about is said with everything its read gives (areas/bays.js
  // bayEntry) - its PC's timing, every plug, TV remote and smart-home device with its timing, its routines, what is on now and what went
  // wrong; a bay switched off in the bay list is said so, never "in service"
  bay_read: (o) => {
    if (!Array.isArray(o.bays)) return null;
    if (!o.bays.length) return o.note ? cap(o.note) + '.' : null;
    const f = o.facility || {};
    const head = (b) => `${b.bay}: ${b.in_use ? String(b.in_use).replace(/^no - /, '').replace(/: /, ' - ') : b.service}, ${b.now}${b.next_today && b.next_today !== 'none' ? `, next ${b.next_today}` : ''}${b.sessions_still_to_come_today ? ` (${plural(b.sessions_still_to_come_today, 'session')} still to come today)` : ''}${b.pc ? '; PC ' + String(b.pc).replace(/^its pc /i, '') : ''}`;
    let out = `The bays now:${lines(o.bays.map(head))}`;
    if (o.bays.length === 1) {
      const b = o.bays[0], arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
      const timing = [b.pc_timing && `The PC: ${b.pc_timing}`, ...arr(b.plugs).map(x => `Smart plug - ${x}`), ...arr(b.tv_remotes).map(x => `TV remote - ${x}`), ...arr(b.smart_home).map(x => `Smart-home device - ${x}`),
        ...(Array.isArray(b.routines) ? b.routines.map(x => `Routine on its PC - ${x}`) : [])].filter(Boolean);
      // (nothing set up is said only from the read's full entry - a short one, cut for length (its note), leaves the devices out)
      out += timing.length ? `\nWhen a session starts and ends on ${b.bay}:${lines(timing)}`
        : b.devices && b.devices !== 'none' ? `\nOn ${b.bay}: ${b.devices}.`
        : !o.note ? `\nNothing is set up on ${b.bay} to switch on or off for a session - no PC wake-up, plugs, TV remotes, smart-home devices or routines.` : '';
      if (typeof b.routines === 'string') out += `\nRoutines: ${b.routines}.`;
      if (b.tv_remotes && /^NOT\b/.test(String(f.tv_remote_bridge || ''))) out += `\nThe TV remote bridge is ${f.tv_remote_bridge}.`;
      if (b.smart_home && /^not set up\b/.test(String(f.home_assistant || ''))) out += `\nHome Assistant is ${f.home_assistant}.`;
      const nowOn = arr(b.plugs_now).length ? arr(b.plugs_now).join('; ') : b.first_plug_now ? `the first plug ${b.first_plug_now}` : '';
      if (nowOn) out += `\nPlugs now: ${nowOn}.`;
      if (arr(b.blocks_today).length) out += `\nBlocked later today:${lines(arr(b.blocks_today))}`;
      if (b.closing_override) out += `\nThe closing override is ${b.closing_override}.`;
      if (Array.isArray(b.problems) && b.problems.length) out += `\nWhat went wrong on ${b.bay}:${lines(b.problems)}`;
    }
    return out + (f.automation ? `\nAutomation: ${f.automation}.` : '') + (f.auto_shutdown ? `\nAuto shutdown ${f.auto_shutdown}; bays kept on ${f.keep_bays_on_between_sessions}; warning ${f.on_screen_warning}; closing ${f.closing_time}.` : '')
      + (/\bnot shown\b/.test(String(o.note || '')) ? `\n(${cap(String(o.note).replace(/\bbay\(s\)/, 'bays'))}.)` : '');   // (bays left out for length are said; "short form" is the read's own business)
  },
  routines_read: (o) => (Array.isArray(o.bays) ? `Routines:${lines(o.bays.map(b => `${b.bay}: ${Array.isArray(b.routines) && b.routines.length ? b.routines.map(r => typeof r === 'string' ? r : (r.name || r.routine || '')).filter(Boolean).join(', ') : 'none yet'}${b.pc && /not checked in/.test(b.pc) ? ' - its PC has not checked in yet (the bay watcher on that PC, and the PC on)' : ''}`))}` : null),
  website_slides_read: (o) => (Array.isArray(o.slides) ? `Slides (${o.slides_section || 'shown'}):${lines(o.slides.map(x => `${x.number}. ${x.title}${x.shown === false ? ' (hidden)' : ''}${x.photo === 'no' ? '' : ' (photo)'}`))}\nGallery: ${Array.isArray(o.gallery) ? plural(o.gallery.length, 'photo') : 'none'}.` : null),
  website_read: (o) => {
    const secs = Array.isArray(o.sections) ? o.sections : [], top = o.top_of_page || {};
    if (!secs.length && !o.top_of_page) return null;
    const name = (x) => x.name || x.section;
    return `Your website: ${o.homepage || ''}.\nThe top: ${top.headline === '(standard)' ? 'the standard headline' : `"${top.headline}"`}${Array.isArray(top.buttons) ? `, buttons: ${top.buttons.filter(b => b.shows !== false).map(b => b.words).join(', ') || 'none'}` : ''}${top.photos ? `, ${plural(top.photos, 'photo')}` : ''}.`
      + `\nShowing: ${secs.filter(x => x.shows !== false).map(name).join(', ') || 'nothing'}.` + (secs.some(x => x.shows === false) ? `\nHidden: ${secs.filter(x => x.shows === false).map(name).join(', ')}.` : '');
  },
  counter_spend_read: (o) => (typeof o.groups === 'string' ? `${o.period}: ${o.groups}.` : `${o.period}: ${o.groups} groups, ${o.bought_at_counter} bought at the counter.\n- A group: ${o.a_group}${o.a_group_that_bought ? '\n- A group that bought: ' + o.a_group_that_bought : ''}${o.sold_most ? '\n- Sold most: ' + o.sold_most.join(', ') : ''}\n(${o.means})`),
  // (maintainer, Oct 25 2026: "Some places have a member brings a guest and the guest pays the difference ... Not all actually most facility
  // won't do it that way. Someone books and then they just bring people and its not really noted anywhere": guests are counted only
  // when a member books with guests under a membership that takes them - said so, never a count of people nobody recorded)
  member_guests_read: (o) => (!o.memberships_allowing_guests && !o.guests
    ? 'Guests are counted only when a member books with guests under a membership that takes guests - none of yours does, so people who come along on a booking are not recorded anywhere.'
    : `${o.period}: members brought ${plural(o.guests, 'guest')} on ${o.visits_with_guests} of ${plural(o.member_visits, 'visit')}.${Array.isArray(o.bring_the_most) ? '\nBring the most:' + lines(o.bring_the_most) : ''}\n(Counted when a member books with guests under a membership that takes them; people who just come along are not recorded.)`),
  top_members_read: (o) => `${o.period}: ${o.played}${o.did_not_play ? `; ${o.did_not_play} did not play` : ''}.${Array.isArray(o.top) ? '\nPlay most:' + lines(o.top) : ' ' + cap(o.top) + '.'}`,
  booking_quote: (o) => (typeof o.bays === 'string' ? `${o.when}: ${o.bays}.` : `${o.when}:${lines((o.bays || []).map(b => `${b.bay}: ${b.answer}`))}`) + (o.note ? `\n${cap(o.note)}.` : ''),
  domain_check: (o) => (o.problem ? `${o.domain}: ${o.problem}` : Array.isArray(o.what_it_means) ? o.what_it_means.join(' ') : null),
  network_scan: (o) => {
    const pcs = (o.pcs || []).map(p => `${p.name} at ${p.address}`), plugs = (o.plugs || []).map(p => `${p.plug}${p.model && p.model !== p.plug ? ` (${p.model})` : ''} at ${p.address} - ${p.bay}${p.login ? `; ${p.login}` : ''}`);
    const note = o.note && !/\b[a-z]+_[a-z_]+\b/.test(o.note) ? `\n${cap(o.note)}` : '';
    return `On the network${o.network ? ` (${o.network})` : ''}: ${pcs.length ? plural(pcs.length, 'PC') + lines(pcs) : 'no PCs answered'}\n${plugs.length ? plural(plugs.length, 'smart plug') + lines(plugs) : 'No smart plugs answered - a new plug goes on the Wi-Fi with the Shelly app first.'}${note}`; },
  tv_remote_find: (o) => (Array.isArray(o.found) && o.found.length ? `TV remotes (BroadLink) on the network:${lines(o.found.map(d => `${d.model} at ${d.address} - ${Array.isArray(d.on) ? 'on ' + d.on.join(', ') : d.on}`))}`
    : 'No TV remote (BroadLink) answered: it must be plugged in and joined to the same network as the box first (its own app does that).'),
  // the texts and emails (the messages set, Oct 25 2026) - each built from what its read returns (areas/messages.js, actions.js)
  email_signups_count: (o) => `${plural(Number(o.signed_up) || 0, 'person', 'people')} signed up for your email updates${o.unsubscribed ? ` (${o.unsubscribed} unsubscribed)` : ''}.`,
  newsletters_read: (o) => (Array.isArray(o.sent) && o.sent.length ? `Your newsletters:${lines(o.sent.map(n => `"${n.subject}" - ${n.status}, ${n.sent} of ${n.of} sent`))}` : 'No newsletter has gone out yet.') + (/^no\b/.test(String(o.can_send || '')) ? `\nOne cannot go out yet: ${String(o.can_send).replace(/^no - /, '')}.` : ''),
  message_words_read: (o) => `${cap(o.message)} (${o.using}${o.sent ? ', ' + o.sent : ''}):${o.example ? `\n"${o.example}"` : o.words ? `\n"${o.words}"` : ' no words yet.'}${o.example && o.example_is ? `\n(That is ${o.example_is}.)` : ''}`,
  text_stops_read: (o) => (o.that_number ? `That number ${o.that_number}. ` : '') + `${plural(Number(o.texted_stop) || 0, 'person', 'people')} texted STOP${o.latest ? ` (the latest ${o.latest})` : ''} - they get no texts from the box until they text START themselves.`,
  hours_send_read: (o) => `The hours export ${o.sends_itself ? `sends itself${o.to ? ' to ' + o.to : ''}${o.waits_for_owner ? ', after your yes' : ''}` : 'is not set to send itself'}. Waiting for you: ${typeof o.waiting_for_you === 'object' && o.waiting_for_you ? `${o.waiting_for_you.period} - ${plural(Number(o.waiting_for_you.people) || 0, 'person', 'people')}, ${o.waiting_for_you.hours} hours` : 'nothing'}.${o.next && o.next.period ? ` Next: ${o.next.period}${o.next.sends ? ', sends ' + stampOf(o.next.sends) : ''}${o.next.overdue ? ' (overdue)' : ''}.` : ''}${o.clock_fixes_to_review ? ` ${plural(o.clock_fixes_to_review, 'clock fix', 'clock fixes')} to review first.` : ''}`,
  customers_read: (o) => (typeof o.customers === 'string' ? `${o.period}: ${o.customers}.` : `${o.period}: ${o.customers} customers - ${o.new} new, ${o.coming_back} coming back; ${o.came_more_than_once} came more than once (${o.visits_each} visits each).\n- Spend a visit: ${o.spend_a_visit}; a customer: ${o.spend_a_customer}${Array.isArray(o.come_most) && o.come_most.length ? '\n- Come most: ' + o.come_most.join('; ') : ''}\n(${o.means})`),
};

/** The box's own answer to a read it ran, or null (no words for that read, or nothing an owner can act on in its result). */
function say(read, out) {
  const f = SAY[read];
  if (!f || !out || typeof out !== 'object') return null;
  if (out.error) {
    // (a refusal in the owner's own terms is said as it is; one written for the model - a tool's name - goes to the model)
    // (and so does one that tells the model what to do - "ask the owner which one, then use its #number" reached an owner with two
    // members called Pat, Oct 25 2026: engine.js OWNER_SAFE's own tests - "the owner", an opening say / ask / use / pick)
    // (a refusal that is only a status - "that answered 503", "the inbox answered 500" - has no words of its own: the box says plainly
    // that the look-up failed when the unit itself did not answer or erred, and anything else goes to the model - Oct 25 2026)
    const raw = String(out.error).trim(), bare = /^(?:that|it|the [a-z ]{1,30}?) answered (\d{3}|nothing)\.?$/i.exec(raw);
    if (bare) return bare[1] === 'nothing' || Number(bare[1]) >= 500 ? 'That could not be looked up just now - the unit did not answer as it should. Try again in a moment.' : null;
    const e = raw.replace(/^that answered \d+:\s*/, '');
    return /\b[a-z]+_[a-z_]+\b/.test(e) || /\bthe owner\b|^\s*(?:say|ask|use|pick)\b|\(\w+ with \w+\)/i.test(e) ? null : cap(e).replace(/\.?$/, '.');
  }
  // (a reminder written for the model inside a result - "(domain_check says)" - comes out; a tool's name left anywhere sends it to
  // the model, never to the owner)
  try { const w = String(f(out) || '').replace(/\s*\([^()]*\b[a-z]+_[a-z_]+\b[^()]*\)/g, ''); return w && !/undefined|\[object Object\]|\b[a-z]+_[a-z]+_?[a-z_]*\b/.test(w) ? w : null; } catch { return null; }
}
const has = (read) => !!SAY[read];

module.exports = { say, has, SAY };
