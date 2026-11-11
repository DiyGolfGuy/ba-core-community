// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/assistant/screens.js - WHERE EACH CHANGE SHOWS (Oct 20 2026, night)
//
// maintainer: "basicly no manual controls they tell the AI it moves them to that page and they see it update live". Every action
// names the screen its change lives on; the chat page (public/assistant.js showScreen) moves the view beside the chat there
// and reloads it, so the owner watches the change land and never opens a screen themselves. A read moves the view too
// ("who's booked today" opens the bookings). One of:
//   { site: 'home', focus }        the homepage, scrolled to a part (the applier's own focus - the section that changed -
//                                  wins over this one)
//   { page: '/book' }              a public page: the booking page, the events page, a page of the owner's own (/p/...)
//   { admin: 'pricing', card }     the owner's admin panel at one tab, and the card on it (admin.html ADMIN_CARDS keys),
//                                  in its live view (?frame=1: no header, no tabs, the owner's own session)
//   { editor: 'cardInbox' }        the Website editor at one card (its own card ids), in its live view
//   { staff: 'menu', part }        the staff pad's menu as a server sees it, at one part of the menu (maintainer: "see it get built
//                                  out and how it looks for the server"), read-only in its live view
// A screen may carry `also`: other views of the same change, each with its label, offered beside the view (the website's
// menu and the server view of it).
// test-assistant A50 holds it: every action that changes something has a screen, every admin card key and editor card id
// is on its page, and every page answers.
'use strict';

const HOME = { site: 'home' };
const at = (focus) => ({ site: 'home', focus });
const admin = (tab, card) => (card ? { admin: tab, card } : { admin: tab });
const editor = (card) => ({ editor: card });
// THE MENU'S SCREENS (Oct 20 2026, night): the website's menu section when it shows the counter's menu live, with the server
// view beside it; the server view alone when the website does not show the menu yet - at the part that changed
function menuScreen(a, ctx) {
  const cats = ((ctx.menu || {}).cats) || [], n = (x) => String(x || '').trim().toLowerCase();
  let part = a.move_to || a.part || null;
  if (!part && a.item) { const c = cats.find(x => (x.items || []).some(i => n(i.name) === n(a.item))); if (c) part = c.name; }
  const staff = { staff: 'menu', part: part || null };
  let sec = null, onPage = null;
  try {
    const L = require('../../public/site-layout.js'), live = (b) => b.type === 'menu' && b.source === 'counter' && b.on !== false;
    sec = L.defaultLayout(ctx.website || {}).find(live) || null;
    // on a page of its own (Oct 20 2026, late): that page is where the website shows it
    if (!sec) for (const p of ((ctx.website || {}).pages || [])) { const b = p && p.published && L.pageLayout(p).find(live); if (b) { sec = b; onPage = p.slug; break; } }
  } catch {}
  if (!sec) return staff;
  return Object.assign(onPage ? { page: '/p/' + onPage } : { site: 'home', focus: 'blk-' + sec.id }, { label: 'Your website', also: [Object.assign({ label: 'Server view' }, staff)] });
}
// A SPECIAL'S PLACES (Oct 20 2026, night): where it was just put - the top of the homepage, the slides under it, the booking
// page - with its other places beside it
const PLACE = { top: { site: 'home', focus: 'hero', label: 'Top of the homepage' }, slides: { site: 'home', focus: 'offers', label: 'The slides' }, booking: { page: '/book', label: 'Booking page' } };
function placesScreen(list) {
  const views = (list || []).filter(x => PLACE[x]).map(x => Object.assign({}, PLACE[x]));
  if (!views.length) return null;
  return views.length === 1 ? views[0] : Object.assign(views[0], { also: views.slice(1) });
}
const specialsScreen = (a) => placesScreen(((a.items || a.add_items || []).find(x => x && x.show_also && x.show_also.length) || {}).show_also) || HOME;
const slugOf = (title) => String(title || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
// A PAGE OF THE OWNER'S OWN (Oct 20 2026, late): a section changed on a page shows that page; one moved shows the page it went
// to (the homepage when it came home); a page that is not made yet is where it will be
function pageScreen(ref, ctx) {
  const L = require('../../public/site-layout.js');
  if (L.isHome(ref)) return null;
  const pages = ((ctx.website || {}).pages) || [];
  try { return { page: '/p/' + pages[L.pageIndex(pages, ref)].slug }; } catch { return { page: '/p/' + slugOf(ref) }; }
}
const onPage = (base) => (a, ctx) => pageScreen(a.page, ctx) || (typeof base === 'function' ? base(a, ctx) : base);

const SCREENS = {
  // ── the website: the homepage, its parts, its other pages ──
  announcement_set: at('hero'), website_headline_set: at('hero'), website_hero_set: at('hero'), website_hero_photos_set: at('hero'),
  website_promo_set: at('promo'), website_steps_set: at('steps'), website_gallery_add: at('gallery'),
  website_section_add: onPage(specialsScreen), website_section_edit: onPage(specialsScreen), special_place: (a) => placesScreen(a.show_also) || HOME, website_section_move: onPage(HOME), website_section_show: onPage(HOME), website_section_remove: onPage(HOME),
  website_section_to_page: (a, ctx) => pageScreen(a.to_page, ctx) || HOME, website_one_page: HOME,
  special_flyer: (a) => (a.in_slides === false ? HOME : Object.assign({}, PLACE.slides)),
  flyer_make: (a) => (a.in_slides === false ? HOME : Object.assign({}, PLACE.slides)),
  setup_confirm: admin('settings', 'checklist'), setup_skip: admin('settings', 'checklist'), waiver_mode_set: admin('waivers', 'waiverPolicy'), waiver_policy_set: admin('waivers', 'waiverPolicy'), site_go_live: { page: '/book' },
  staff_add: admin('settings', 'staffCodes'), staff_details_set: admin('settings', 'staffCodes'),
  clock_entry_delete: admin('settings', 'timeClock'), hours_send_read: admin('settings', 'hoursSend'), hours_send_decide: admin('settings', 'hoursSend'), hours_send_now: admin('settings', 'hoursSend'),
  booking_check_in: admin('dashboard', 'todayAt'), day_review_read: admin('dashboard', 'review'), day_review_sign_off: admin('dashboard', 'review'),
  website_words_set: HOME, website_undo: HOME, website_read: HOME, website_check: HOME, website_section_read: onPage(HOME), website_history_read: HOME,
  event_add: { page: '/events' }, event_edit: { page: '/events' }, event_remove: { page: '/events' }, events_read: { page: '/events' },
  website_page_create: (a) => ({ page: '/p/' + slugOf(a.title) }),
  // a page of the owner's own by its title or its address, as the website holds it (ctx.website: the content the action read)
  website_page_edit: (a, ctx) => {
    const n = String(a.page || '').toLowerCase().replace(/^\/?p\//, '').trim();
    const p = (((ctx.website || {}).pages) || []).find(x => x && (String(x.slug).toLowerCase() === n || String(x.title || '').toLowerCase() === n));
    return p ? { page: '/p/' + p.slug } : editor('cardPages');
  },
  website_page_remove: editor('cardPages'),
  // the look: the top of the homepage shows it first
  website_look_set: at('hero'), logo_upload: at('hero'), logo_from_photo: at('hero'), waiver_upload: admin('waivers', 'waiverPolicy'), website_style_set: at('hero'), website_colors_set: at('hero'), website_fonts_set: at('hero'),
  // the site's settings
  website_contact_set: at('visit'), website_social_set: at('visit'), website_menu_set: at('hero'), website_homepage_set: { page: '/' },
  public_part_set: editor('cardPublic'), website_search_set: editor('cardShare'), website_holding_set: editor('cardSite'),
  email_updates_set: editor('cardSignup'), website_analytics_set: editor('cardSitewide'),
  // ── the bays and their devices ──
  plug_switch: admin('bays'), bay_switch: admin('bays'), all_bays_switch: admin('bays'), bay_service_set: admin('bays'), bay_pc_restart: admin('bays'),
  bay_pc_wake: admin('bays'), bay_power_cycle: admin('bays'), bay_close_override_set: admin('bays'), automation_retry: admin('settings', 'automation'),
  bay_read: admin('bays'), automation_read: admin('settings', 'automation'),
  bay_pc_link: admin('bays', 'pcSetup'), bay_plug_add: admin('bays'), bay_watcher_download: admin('bays', 'pcSetup'), bay_pc_signin_set: admin('bays', 'pcSetup'),
  bay_timing_set: admin('settings', 'timing'), bay_device_timing_set: admin('bays'), bay_plug_remove: admin('bays'), bay_ir_test: admin('bays'),
  tv_remote_find: admin('bays'), bay_tv_add: admin('bays'), bay_tv_learn: admin('bays'), bay_tv_remove: admin('bays'), bay_device_set: admin('bays'),
  // (Oct 21 2026, night) the Bay Routines card on Bays & Devices
  routines_read: admin('bays', 'routines'), routine_teach: admin('bays', 'routines'), routine_save: admin('bays', 'routines'), routine_when_set: admin('bays', 'routines'),
  routine_step_set: admin('bays', 'routines'), routine_run: admin('bays', 'routines'), routine_remove: admin('bays', 'routines'), routine_copy: admin('bays', 'routines'),
  routine_create: admin('bays', 'routines'),
  bay_details_set: admin('bays'), bay_price_adjust_set: admin('bays'), bay_add: admin('bays'), bays_list_set: admin('bays'), network_scan: admin('bays'),
  smarthome_setup: admin('settings', 'homeAssistant'), device_pair: admin('bays'), device_name_set: admin('bays'), bay_device_add: admin('bays'),
  bay_device_remove: admin('bays'), device_switch: admin('bays'), smarthome_read: admin('bays'),
  facility_device_set: admin('bays', 'facilityDevices'), facility_device_remove: admin('bays', 'facilityDevices'), thermostat_set: admin('bays', 'facilityDevices'),
  // ── bookings ──
  booking_make: admin('bookings'), booking_move: admin('bookings'), booking_cancel: admin('bookings'), booking_clear_pending: admin('bookings'),
  block_add: admin('dashboard', 'blocks'), block_remove: admin('dashboard', 'blocks'), blocks_read: admin('dashboard', 'blocks'),   // the Dashboard's card
  checkin_mode_set: admin('settings', 'policies'), bookings_read: admin('bookings'), booking_quote: { page: '/book' },
  // ── money ──
  base_price_set: admin('settings', 'hours'), price_window_add: admin('pricing', 'priceWindows'), price_window_change: admin('pricing', 'priceWindows'),
  price_window_remove: admin('pricing', 'priceWindows'), price_windows_read: admin('pricing', 'priceWindows'), slot_prices_show: { page: '/book' },
  discount_code_create: admin('pricing', 'discountCodes'), discount_code_off: admin('pricing', 'discountCodes'), discount_codes_read: admin('pricing', 'discountCodes'),
  deposit_set: admin('settings', 'hours'), gift_card_issue: admin('members', 'giftCards'), gift_card_switch_off: admin('members', 'giftCards'),
  gift_cards_read: admin('members', 'giftCards'), revenue_read: admin('revenue'), end_of_day_read: admin('revenue', 'eod'),
  // ── members ──
  membership_tier_create: admin('members', 'tiers'), membership_tier_change: admin('members', 'tiers'), membership_tier_retire: admin('members', 'tiers'),
  membership_tier_pricing_set: admin('members', 'tiers'), membership_tier_guests_set: admin('members', 'tiers'), membership_tier_rules_set: admin('members', 'tiers'),
  tiers_read: admin('members', 'tiers'), member_status_set: admin('members', 'members'), member_tier_move: admin('members', 'members'),
  membership_cancel: admin('members', 'members'), membership_extend: admin('members', 'members'), member_add: admin('members', 'members'),
  member_new_pin: admin('members', 'members'), member_details_set: admin('members', 'members'), members_read: admin('members', 'members'),
  members_report_read: admin('members', 'members'), member_usage_read: admin('members', 'members'),
  // ── messages ──
  email_sender_set: admin('settings', 'resend'), texting_number_set: admin('settings', 'twilio'), message_words_set: admin('sms'), message_words_read: admin('sms'),
  message_switch_set: admin('sms', 'texts'), reminder_timing_set: admin('sms', 'texts'), texts_signed_as_set: admin('settings', 'twilio'), messages_settings_read: admin('sms', 'texts'),
  text_stops_read: admin('sms', 'texts'), owner_alert_mobile_set: admin('settings', 'twilio'), webhook_set: admin('settings', 'webhooks'), webhook_read: admin('settings', 'webhooks'),
  newsletter_send: editor('cardSignup'), newsletter_cancel: editor('cardSignup'), newsletters_read: editor('cardSignup'), email_signups_count: editor('cardSignup'),
  inbox_mark: editor('cardInbox'), inbox_read: editor('cardInbox'),
  // ── the facility's setup ──
  business_name_set: admin('settings', 'business'), company_name_set: admin('settings', 'business'), timezone_set: admin('settings', 'hours'),
  opening_hours_set: admin('settings', 'hours'), open_24_hours_set: admin('settings', 'hours'), booking_rules_set: admin('settings', 'hours'), booking_rules_read: admin('settings', 'hours'),
  cancellation_window_set: admin('settings', 'policies'), members_only_set: admin('settings', 'hours'), whole_facility_set: admin('settings', 'hours'),
  early_bay_access_set: admin('settings', 'policies'), location_set: admin('settings', 'seo'), contact_info_set: admin('settings', 'contact'),
  website_address_set: admin('settings', 'seo'), access_style_set: admin('settings', 'hours'), backup_passphrase_set: admin('settings', 'backups'),
  ai_service_set: null, ai_service_read: null, setup_status: admin('settings', 'checklist'), health_read: admin('settings', 'automation'),
  // ── staff and the schedule ──
  // (a shift while employee scheduling is off is one change that also turns it on - actions.js - and both are shown: the
  // schedule, and beside it The Counter, where that switch is)
  schedule_add_shift: (a, ctx) => { const c = ctx.opsConfig; return c && !c.error && !(c.scheduling && c.scheduling.enabled) ? Object.assign(admin('settings', 'schedule'), { also: [Object.assign({ label: 'Scheduling switch' }, admin('settings', 'counter'))] }) : admin('settings', 'schedule'); }, schedule_remove_shift: admin('settings', 'schedule'), schedule_copy_week: admin('settings', 'schedule'),
  schedule_change_shift: admin('settings', 'schedule'), request_decide: admin('settings', 'schedule'), pattern_save: admin('settings', 'schedule'),
  pattern_apply: admin('settings', 'schedule'), schedule_read: admin('settings', 'schedule'), requests_read: admin('settings', 'schedule'),
  clock_out_now: admin('settings', 'timeClock'), clock_entry_fix: admin('settings', 'timeClock'), clock_fix_accept: admin('settings', 'timeClock'), clock_read: admin('settings', 'timeClock'),
  staff_signin_set: admin('settings', 'staffCodes'), roster_read: admin('settings', 'staffCodes'),
  // the staffed days are the Website editor's card
  staffed_set_day: editor('cardStaffed'), staffed_remove_day: editor('cardStaffed'), staffed_set_weekly: editor('cardStaffed'), season_use: editor('cardStaffed'),
  season_hours_set: editor('cardStaffed'), staffed_hours_switch: editor('cardStaffed'), staffed_day_restore: editor('cardStaffed'), staffed_read: editor('cardStaffed'),
  schedule_setup_read: admin('settings', 'schedule'),
  season_create: admin('settings', 'schedule'), season_remove: admin('settings', 'schedule'), season_blocks_set: admin('settings', 'schedule'), pattern_remove: admin('settings', 'schedule'),
  // ── how the business is doing (Oct 20 2026, late): the Revenue tab; a day's bookings, the bookings; who is playing, the
  //    bays; a tax rate, the card it lives on (the bookings' tax on Tax & Legal, a counter code on the Tax Codes card) ──
  insights_read: admin('revenue'), tax_collected_read: admin('revenue'), tax_export: admin('revenue'), day_outlook_read: admin('bookings'),
  playing_now_read: admin('bays'), tax_rates_read: admin('settings', 'taxLegal'),
  tax_rate_set: (a) => (/^(the )?(bookings?|sessions?|online|tee ?times?)( tax)?$/i.test(String(a.which || '').trim()) ? admin('settings', 'taxLegal') : admin('settings', 'posTax')),
  // ── payments, email and texting (Oct 20 2026, latest): the card each lives on ──
  connections_read: admin('settings', 'stripe'), email_test_send: admin('settings', 'resend'), text_test_send: admin('settings', 'twilio'),
  card_readers_read: admin('settings', 'readers'), card_reader_add: admin('settings', 'readers'), card_reader_remove: admin('settings', 'readers'),
  tip_prompt_set: admin('settings', 'readers'), stripe_refunds_check: admin('revenue'), counter_payments_set: admin('settings', 'counter'),
  scheduling_switch: admin('settings', 'counter'), tax_details_set: admin('settings', 'taxLegal'),
  // ── the one menu ──
  menu_read: menuScreen, menu_items_add: menuScreen, menu_item_change: menuScreen, menu_item_remove: menuScreen, menu_item_sold_out: menuScreen,
  // the counter's specials (Oct 22 2026): their own card (Settings > Food & Payments > Specials & Deals - maintainer: "a specials screen for
  // specials so that has somewhere to live"), with the pad's menu - where the special price shows while it is on - and the website
  // package deals and booking deals (Oct 22 2026): their own cards on Pricing
  deals_read: admin('pricing', 'packages'), deal_ideas: admin('pricing', 'bookingDeals'), deal_set: admin('pricing', 'bookingDeals'), deal_remove: admin('pricing', 'bookingDeals'),
  package_set: admin('pricing', 'packages'), package_remove: admin('pricing', 'packages'), packages_on_website: at(null),
  counter_specials_read: admin('settings', 'specials'),
  counter_special_set: Object.assign(admin('settings', 'specials'), { label: 'Specials & Deals', also: [{ staff: 'menu', part: null, label: 'Server view' }, { site: 'home', label: 'Your website' }] }),
  counter_special_remove: Object.assign(admin('settings', 'specials'), { label: 'Specials & Deals', also: [{ staff: 'menu', part: null, label: 'Server view' }] }),
  // an item's choices show on the pad, not the website: the server view first (Oct 20 2026, late)
  menu_item_choices: (a, ctx) => { const sc = menuScreen(a, ctx); return sc.staff ? sc : Object.assign({}, (sc.also || [])[0] || sc, { also: [Object.assign({}, sc, { also: undefined })] }); },
  menu_part_change: menuScreen,
  // ── the offer slides and the gallery, one at a time (Oct 21 2026) ──
  website_slides_read: at('offers'), website_slide_set: at('offers'), website_slide_remove: at('offers'), website_gallery_photo_set: at('gallery'),
  // ── the unit itself and the doors' timing (Oct 21 2026, areas/upkeep.js) ──
  // getting the box online (Oct 21 2026): the health line's "Website tunnel" is where a connection shows on the unit
  online_read: admin('settings', 'automation'), domain_check: null, box_connect: admin('settings', 'automation'), box_connect_stop: admin('settings', 'automation'),
  site_check_now: admin('settings', 'automation'),
  updates_read: admin('settings', 'updates'), updates_check: admin('settings', 'updates'), update_install: admin('settings', 'updates'),
  update_tonight_cancel: admin('settings', 'updates'), update_undo: admin('settings', 'updates'), updates_auto_check_set: admin('settings', 'updates'),
  update_file_install: admin('settings', 'updates'),
  export_file: (a) => ({ revenue: admin('revenue'), bookings: admin('bookings'), hours: admin('settings', 'hoursSend'), year_report: admin('settings', 'records'), email_list: editor('cardSignup') })[a.what] || admin('revenue'),
  doors_read: admin('settings', 'doorAccess'), door_code_timing_set: admin('settings', 'doorAccess'),
  // ── one-time setup by talking (Oct 21 2026) ──
  counter_settings_set: admin('settings', 'counter'), printers_read: admin('settings', 'printers'), printer_add: admin('settings', 'printers'),
  printer_test: admin('settings', 'printers'), printer_remove: admin('settings', 'printers'), backups_read: admin('settings', 'backups'),
  backup_copies_set: admin('settings', 'backups'), backup_now: admin('settings', 'backups'), records_settings_set: admin('settings', 'records'),
  calendar_feed_read: admin('settings', 'calendar'), calendar_feed_set: admin('settings', 'calendar'), how_it_works_page_set: { page: '/how-it-works' },
  console_look_set: editor('cardTheme'), bay_remove: admin('bays'),
};

/** The screen an action's change shows on (null: nothing to show - a question, a guide, the AI's own settings). */
function screenOf(name, args, ctx) {
  const s = SCREENS[name];
  if (typeof s === 'function') { try { return s(args || {}, ctx || {}); } catch { return null; } }
  return s || null;
}

module.exports = { SCREENS, screenOf, slugOf };
