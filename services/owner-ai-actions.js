'use strict';

const { randomUUID } = require('node:crypto');
const dbModule = require('./db');
const pos = require('./pos');
const { getConfig, saveConfig } = require('./config');
const layout = require('../public/site-layout');
const theme = require('./theme');

const MENU_TOPIC = /\b(?:beer|ipa|ale|drinks?|food|menu|pos|counter|pizza|soda|kitchen|sold out)\b/i;
const SITE_TOPIC = /\b(?:web\s?site|home\s?page|hero|landing page|site|faq|branding|page|headline|navigation|colou?rs?|theme|button)\b/i;
const FACILITY_TOPIC = /\b(?:automation|bay|bays|wake|turn off|shut\s?down|watcher|counter|gap|food and drink)\b/i;
const SITE_KEYS = ['hero', 'theme', 'layout', 'sections', 'pages', 'nav'];
const SECTION_TYPES = ['text', 'story', 'faq', 'rates', 'quotes'];
const HERO_FIELDS = { tag: 120, headline: 180, sub: 900, ctaText: 70, ctaLink: 400 };
const DEVICES = { shelly: 'shellyDevices', homeAssistant: 'haDevices', broadlink: 'broadlinkDevices' };
const POWER_RULES = { minutesBefore: [1, 60], minutesAfter: [5, 120], turnOffAfter: null };
const CLIMATE_RULES = { leadTimeMins: [1, 120], setbackDelayMins: [1, 120] };
const FACILITY_FIELDS = {
  keepOnGapMins: { path: ['automation', 'keepOnGapMins'], label: 'Keep the bay on between groups (minutes)', min: 0, max: 240, fallback: 30 },
  manualOffGraceSecs: { path: ['automation', 'manualOffGraceSecs'], label: 'Bay Off waits for the PC (seconds)', min: 0, max: 600, fallback: 90 },
  warnMins: { path: ['monitor', 'warnMins'], label: 'Watcher warning (minutes before end)', min: 1, max: 240, fallback: 10 },
  shutdownEnabled: { path: ['shutdown', 'enabled'], label: 'Shut down after the last booking', fallback: true },
  foodAndDrink: { path: ['pos', 'fnb'], label: 'Food & Drink on the counter', fallback: true },
  acceptCash: { path: ['pos', 'payments', 'cash'], label: 'Accept cash at the counter', fallback: true },
  acceptCheck: { path: ['pos', 'payments', 'check'], label: 'Accept checks at the counter', fallback: true },
};

const ACTIONS = Object.freeze({
  menu: 'Use {"action":"menu","items":[{"id":"existing item ID","priceCents":500}]}. Editable fields are name, priceCents, active, and category. To add, omit id and supply name, priceCents, and category name. Ask which item if more than one fits. A proposal can cover several items.',
  website: 'Use {"action":"website","changes":[...]}. Change kinds: {"kind":"hero","fields":{"tag":"","headline":"","sub":"","ctaText":"","ctaLink":"/book"}}, {"kind":"theme","preset":"preset ID","colors":{"accent":"#aabbcc"}}, {"kind":"section","type":"text","fields":{"title":"","body":""}}, {"kind":"page","slug":"page-slug","fields":{"title":"","body":"","metaTitle":"","metaDescription":""}}, and {"kind":"link","label":"Book a bay","href":"/book","top":true,"foot":true}. Omit fields you are keeping. Every field you send replaces the stored value whole: for faq or quotes \"items\" send the complete list including the items you are keeping, and for a page \"body\" send the complete new body. Only change an existing section whose current fields are in the request context, and only change an existing page body when the \"body\" of that page is in the request context; otherwise ask the owner to name the section or page. For an existing section use its id, for an existing custom navigation link use its key. Section types: text (title, kicker, body), story (title, kicker, p1, p2, calloutTitle, calloutText, linkText, linkUrl), faq (title, kicker, items of {q,a}), rates (title, kicker, note), quotes (use actual supplied quotes only). New pages are drafts. A full website request can combine several changes. Base copy on supplied facts; ask for missing hours, prices, or policies before writing them.',
  facility: 'Use {"action":"facility","settings":{...}} with only these supported keys: ' + Object.keys(FACILITY_FIELDS).join(', ') + '. Use numbers for timing and booleans for switches. To change a bay use {"action":"facility","bays":[{"id":"bay ID","name":"optional name","pcWakeMinutesBefore":10,"devices":[{"type":"shelly","index":0,"rules":{"minutesBefore":10}}]}]}. Use the supplied bay ID and device type and index. Power-device rules are minutesBefore, minutesAfter and turnOffAfter. Climate rules are leadTimeMins and setbackDelayMins. Omit values you are keeping.',
});

class StaleOwnerAction extends Error {}

function fields(value, allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length > 0 && Object.keys(value).every(key => allowed.includes(key));
}

function validText(value, max, required = false) {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}

function safeLink(value) {
  return /^(?:\/(?!\/)|https:\/\/[a-z0-9])[^\s<>'"\\]*$/i.test(value);
}

function atomic(write) {
  dbModule.db.exec('BEGIN IMMEDIATE');
  try {
    write();
    dbModule.db.exec('COMMIT');
  } catch (error) {
    dbModule.db.exec('ROLLBACK');
    throw error;
  }
}

function review(read, state, before, after, write, label) {
  if (!after.length) return null;
  const snapshot = JSON.stringify(state);
  return {
    before: before.join('\n'), after: after.join('\n'),
    apply() {
      if (JSON.stringify(read()) !== snapshot) throw new StaleOwnerAction('The values changed after this preview. Ask again to review the current values.');
      write();
      return label;
    },
  };
}

function menuState() {
  const categories = dbModule.db.prepare('SELECT * FROM menu_categories ORDER BY sort, name, id').all();
  const items = dbModule.db.prepare('SELECT * FROM menu_items ORDER BY sort, name, id').all();
  return { categories, items };
}

function menuReview(proposal) {
  if (!fields(proposal, ['action', 'items']) || !Array.isArray(proposal.items) || proposal.items.length > 24) return null;
  const state = menuState();
  const categories = state.categories.slice();
  const newCategories = [];
  const changes = [];
  const before = [];
  const after = [];
  for (const change of proposal.items) {
    if (!fields(change, ['id', 'name', 'priceCents', 'active', 'category'])) return null;
    const current = change.id === undefined ? null : state.items.find(item => item.id === change.id);
    if ((change.id !== undefined && !current) || (current && changes.some(item => item.id === current.id))) return null;
    const name = change.name ?? current?.name;
    const price = change.priceCents ?? current?.price_cents;
    const active = change.active ?? (current ? !!current.active : true);
    if (!validText(name, 80, true) || !Number.isInteger(price) || price < 0 || price > 1_000_000 ||
        typeof active !== 'boolean' || (change.category !== undefined && !validText(change.category, 60, true))) return null;
    let category = change.category === undefined ? categories.find(item => item.id === current?.category_id)
      : categories.find(item => item.name.toLowerCase() === change.category.trim().toLowerCase());
    if (!category && change.category) {
      const name = change.category.trim();
      category = { id: randomUUID(), name, sort: categories.length,
        printer_role: /beer|wine|cocktail|bar/i.test(name) ? 'bar' : 'kitchen',
        tax_category: /beer|wine|cocktail|bar|drinks?|beverage/i.test(name) ? 'beverage' : 'food' };
      categories.push(category);
      newCategories.push(category);
    }
    if (!category) return null;
    const id = current?.id || randomUUID();
    const item = { ...current, id, name: name.trim(), price_cents: price, category_id: category.id, active };
    if (state.items.concat(changes).some(other => other.id !== id && other.category_id === category.id &&
        other.name.toLowerCase() === item.name.toLowerCase())) return null;
    if (current && current.name === item.name && current.price_cents === price &&
        current.category_id === category.id && !!current.active === active) continue;
    changes.push(item);
    const describe = (row, group) => row.name + ' · $' + (row.price_cents / 100).toFixed(2) +
      ' · ' + group + (row.active ? '' : ' · hidden');
    before.push(current ? describe(current, categories.find(group => group.id === current.category_id)?.name || 'Menu') : 'New menu item');
    after.push(describe(item, category.name));
  }
  for (const category of newCategories) after.push('New category: ' + category.name + ' · ' + category.printer_role + ' routing · ' + category.tax_category + ' tax code');
  return review(menuState, state, before, after, () => atomic(() => {
    newCategories.forEach(pos.upsertCategory);
    changes.forEach(pos.upsertItem);
    dbModule.adminLog('OWNER_CHAT_MENU_SAVED', changes.length + ' menu item(s)');
  }), 'Saved the counter menu. Open Menu & Kitchen Routing to review it.');
}

function siteState() {
  const rows = dbModule.db.prepare("SELECT key, value FROM website_content WHERE key IN (" + SITE_KEYS.map(() => '?').join(',') + ') ORDER BY key').all(...SITE_KEYS);
  const state = {};
  for (const row of rows) {
    try { state[row.key] = JSON.parse(row.value); } catch {}
  }
  return state;
}

function recordChange(before, after, label, oldValue, newValue) {
  if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
  const value = entry => entry === undefined ? '(new)' : typeof entry === 'string' ? entry : JSON.stringify(entry);
  before.push(label + ' · ' + value(oldValue));
  after.push(label + ' · ' + value(newValue));
}

function textPatch(value, limits) {
  if (!fields(value, Object.keys(limits))) return null;
  return Object.entries(value).every(([key, text]) => validText(text, limits[key])) ? value : null;
}

function applyHero(change, site, before, after) {
  if (!fields(change, ['kind', 'fields'])) return false;
  const patch = textPatch(change.fields, HERO_FIELDS);
  if (!patch || (patch.ctaLink && !safeLink(patch.ctaLink))) return false;
  const hero = { ...site.hero };
  const buttons = Array.isArray(hero.buttons) ? hero.buttons.slice() : [];
  const first = { ...buttons[0] };
  for (const [key, value] of Object.entries(patch)) {
    const buttonKey = key === 'ctaText' ? 'label' : key === 'ctaLink' ? 'link' : null;
    recordChange(before, after, 'Hero ' + key, (buttonKey && first[buttonKey]) || hero[key], value);
    hero[key] = value;
    if (buttonKey) first[buttonKey] = value;
  }
  if (patch.ctaText !== undefined || patch.ctaLink !== undefined) {
    buttons[0] = { label: hero.ctaText || 'Book a Bay', link: hero.ctaLink || '/book', on: true, ...first };
    hero.buttons = buttons;
  }
  site.hero = hero;
  return true;
}

function applyTheme(change, site, before, after) {
  if (!fields(change, ['kind', 'preset', 'colors']) || (!change.preset && !change.colors) ||
      (change.preset !== undefined && !Object.hasOwn(theme.PRESETS, change.preset))) return false;
  const previous = site.theme || {};
  const preset = change.preset || previous.preset || theme.DEFAULT_PRESET;
  const next = { ...previous, preset };
  if (change.colors !== undefined) {
    if (!fields(change.colors, Object.keys(theme.PRESETS[theme.DEFAULT_PRESET])) ||
        !Object.values(change.colors).every(value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))) return false;
    next.colors = { ...theme.PRESETS[preset], ...(change.preset ? {} : previous.colors), ...change.colors };
    next.custom = true;
  } else {
    next.custom = false;
  }
  recordChange(before, after, 'Site colors', previous.custom ? previous.colors : previous.preset, next.custom ? next.colors : next.preset);
  site.theme = next;
  return true;
}

function sectionPatch(type, patch) {
  const sample = layout.CUSTOM[type].make();
  const allowed = Object.keys(sample).filter(key => key !== 'img');
  if (!fields(patch, allowed)) return false;
  return Object.entries(patch).every(([key, value]) => {
    if (key === 'linkUrl') return value === '' || (validText(value, 400) && safeLink(value));
    if (key !== 'items') return validText(value, key === 'title' ? 180 : 3000);
    const keys = Object.keys(sample.items[0]);
    return Array.isArray(value) && value.length <= 12 && value.every(item => fields(item, keys) &&
      keys.every(field => validText(item[field], 1200, true)));
  });
}

function applySection(change, site, before, after, shown) {
  if (!fields(change, ['kind', 'id', 'type', 'fields', 'position', 'visible'])) return false;
  // A field replaces the stored value whole, so the model must have been shown it.
  if (change.id !== undefined && change.fields !== undefined && !shown.sections.has(change.id)) return false;
  const blocks = layout.defaultLayout(site);
  const index = change.id === undefined ? -1 : blocks.findIndex(block => block.id === change.id);
  const previous = blocks[index];
  const type = previous?.type || change.type;
  if ((change.id !== undefined && !previous) || (change.type !== undefined && change.type !== type) ||
      !SECTION_TYPES.includes(type) || (!previous && blocks.length >= layout.MAX_BLOCKS) ||
      (change.position !== undefined && (!Number.isInteger(change.position) || change.position < 1 || change.position > blocks.length + (previous ? 0 : 1))) ||
      (change.visible !== undefined && typeof change.visible !== 'boolean') ||
      (change.fields !== undefined && !sectionPatch(type, change.fields)) ||
      (!previous && !validText(change.fields?.title, 180, true))) return false;
  const next = { id: randomUUID(), type, on: true, ...previous, ...change.fields };
  if (change.visible !== undefined) next.on = change.visible;
  if (index >= 0) blocks.splice(index, 1);
  const position = change.position === undefined ? (index < 0 ? blocks.length : index) : change.position - 1;
  blocks.splice(position, 0, next);
  const describe = (block, order) => block && { position: order + 1, visible: block.on !== false,
    ...Object.fromEntries(Object.keys(layout.CUSTOM[type].make()).filter(key => key !== 'img' && Object.hasOwn(block, key)).map(key => [key, block[key]])) };
  recordChange(before, after, 'Homepage section (' + type + ')', describe(previous, index), describe(next, position));
  site.layout = layout.toStored(blocks);
  return true;
}

function applyPage(change, site, before, after, shown) {
  if (!fields(change, ['kind', 'slug', 'fields']) || typeof change.slug !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change.slug) || change.slug.length > 48) return false;
  const patch = textPatch(change.fields, { title: 120, body: 8000, metaTitle: 120, metaDescription: 240 });
  if (!patch || (patch.title !== undefined && !validText(patch.title, 120, true))) return false;
  const pages = Array.isArray(site.pages) ? site.pages.slice() : [];
  const index = pages.findIndex(page => page?.slug === change.slug);
  const previous = pages[index];
  if (!previous && (!validText(patch.title, 120, true) || pages.length >= 40)) return false;
  // The new body replaces the old one whole: refuse it unless this request
  // showed the model the complete current body.
  if (previous && patch.body !== undefined && typeof previous.body === 'string' && previous.body.length && !shown.pages.has(change.slug)) return false;
  const next = { slug: change.slug, published: false, kind: 'text', showInNav: false, showInFooter: true, ...previous, ...patch };
  for (const [key, value] of Object.entries(patch)) recordChange(before, after, '/p/' + change.slug + ' ' + key, previous?.[key], value);
  if (index < 0) pages.push(next);
  else pages[index] = next;
  site.pages = pages;
  return true;
}

function applyLink(change, site, before, after) {
  if (!fields(change, ['kind', 'key', 'label', 'href', 'top', 'foot'])) return false;
  const items = Array.isArray(site.nav?.items) ? site.nav.items.slice() : [];
  const index = change.key === undefined ? -1 : items.findIndex(item => item?.key === change.key && item.key.startsWith('link:'));
  const previous = items[index];
  const label = change.label ?? previous?.label;
  const href = change.href ?? previous?.href;
  if ((change.key !== undefined && !previous) || (!previous && items.length >= 40) || !validText(label, 75, true) ||
      !validText(href, 400, true) || !safeLink(href) || ['top', 'foot'].some(key => change[key] !== undefined && typeof change[key] !== 'boolean')) return false;
  const next = { key: 'link:' + randomUUID(), top: true, foot: false, ...previous, label, href };
  for (const key of ['top', 'foot']) if (change[key] !== undefined) next[key] = change[key];
  recordChange(before, after, 'Website link', previous, next);
  if (index < 0) items.push(next);
  else items[index] = next;
  site.nav = { ...site.nav, items };
  return true;
}

const siteEdits = Object.freeze({ hero: applyHero, theme: applyTheme, section: applySection, page: applyPage, link: applyLink });

function websiteReview(proposal, context) {
  if (!fields(proposal, ['action', 'changes']) || !Array.isArray(proposal.changes) || proposal.changes.length > 16) return null;
  const shown = {
    sections: new Set((context?.website?.sections || []).filter(section => section.fields).map(section => section.id)),
    pages: new Set((context?.website?.pages || []).filter(page => typeof page.body === 'string').map(page => page.slug)),
  };
  const state = siteState();
  const next = { ...state };
  const before = [];
  const after = [];
  for (const change of proposal.changes) {
    if (typeof change?.kind !== 'string' || !Object.hasOwn(siteEdits, change.kind) || !siteEdits[change.kind](change, next, before, after, shown)) return null;
  }
  const values = Object.entries(next).filter(([key, value]) => JSON.stringify(state[key]) !== JSON.stringify(value));
  if (values.some(([, value]) => Buffer.byteLength(JSON.stringify(value), 'utf8') > 200 * 1024)) return null;
  return review(siteState, state, before, after, () => {
    const website = require('../routes/website');
    atomic(() => {
      for (const [key, value] of values) website.saveContent(key, JSON.stringify(value), 'Owner Chat');
      dbModule.adminLog('OWNER_CHAT_WEBSITE_SAVED', values.map(([key]) => key).join(', '));
    });
    website.bumpWrite();
  }, 'Saved the website edits. Open Website to preview. New pages are drafts.');
}

function facilityState() {
  const config = getConfig();
  return Object.fromEntries(Object.entries(FACILITY_FIELDS).map(([key, { path, fallback }]) =>
    [key, path.reduce((value, part) => value?.[part], config) ?? fallback]));
}

function deviceRules(device) {
  return device.kind === 'climate' ? CLIMATE_RULES : POWER_RULES;
}

function changeBay(change, bays, before, after) {
  if (!fields(change, ['id', 'name', 'pcWakeMinutesBefore', 'devices'])) return false;
  const bay = bays.find(item => item.id === change.id);
  if (!bay || (change.name !== undefined && !validText(change.name, 80, true)) ||
      (change.pcWakeMinutesBefore !== undefined && (!Number.isInteger(change.pcWakeMinutesBefore) || change.pcWakeMinutesBefore < 0 || change.pcWakeMinutesBefore > 120)) ||
      (change.devices !== undefined && (!Array.isArray(change.devices) || change.devices.length > 16))) return false;
  const label = bay.name || 'Bay';
  for (const key of ['name', 'pcWakeMinutesBefore']) {
    if (change[key] === undefined) continue;
    recordChange(before, after, label + ' · ' + (key === 'name' ? 'name' : 'PC wake (minutes before)'), bay[key], change[key]);
    bay[key] = change[key];
  }
  for (const edit of change.devices || []) {
    if (!fields(edit, ['type', 'index', 'rules']) || typeof edit.type !== 'string' || !Object.hasOwn(DEVICES, edit.type) ||
        !Number.isInteger(edit.index) || edit.index < 0) return false;
    const device = bay[DEVICES[edit.type]]?.[edit.index];
    if (!device || !fields(edit.rules, Object.keys(deviceRules(device)))) return false;
    for (const [key, value] of Object.entries(edit.rules)) {
      const limits = deviceRules(device)[key];
      if (limits ? (!Number.isInteger(value) || value < limits[0] || value > limits[1]) : typeof value !== 'boolean') return false;
      recordChange(before, after, label + ' · ' + (device.name || edit.type + ' ' + (edit.index + 1)) + ' · ' + key, device[key], value);
      device[key] = value;
    }
  }
  return true;
}

function facilityReview(proposal) {
  if (!fields(proposal, ['action', 'settings', 'bays']) ||
      (proposal.settings !== undefined && !fields(proposal.settings, Object.keys(FACILITY_FIELDS))) ||
      (proposal.bays !== undefined && (!Array.isArray(proposal.bays) || proposal.bays.length > 12))) return null;
  const read = () => ({ settings: facilityState(), bays: proposal.bays ? getConfig().bays : undefined });
  const state = read();
  const before = [];
  const after = [];
  const patch = {};
  for (const [key, value] of Object.entries(proposal.settings || {})) {
    const { label, path, min, max } = FACILITY_FIELDS[key];
    if (min === undefined ? typeof value !== 'boolean' : (!Number.isInteger(value) || value < min || value > max)) return null;
    recordChange(before, after, label, state.settings[key], value);
    let group = patch;
    for (const part of path.slice(0, -1)) group = group[part] ||= {};
    group[path.at(-1)] = value;
  }
  if (proposal.bays) {
    patch.bays = structuredClone(state.bays || []);
    for (const change of proposal.bays) if (!changeBay(change, patch.bays, before, after)) return null;
  }
  return review(read, state, before, after, () => {
    saveConfig(patch);
    dbModule.adminLog('OWNER_CHAT_FACILITY_SETTINGS_SAVED', Object.keys(patch).join(', '));
  }, 'Saved the facility settings. Use a test booking to verify any automation timing changes.');
}

const reviews = Object.freeze({ menu: menuReview, website: websiteReview, facility: facilityReview });

// `context` is what actionContext() gave the model for this request. Website
// edits are checked against it so nothing the model never saw is replaced.
function prepareOwnerAction(proposal, context) {
  return typeof proposal?.action === 'string' && Object.hasOwn(reviews, proposal.action) ? reviews[proposal.action](proposal, context) : null;
}

const PAGE_BODY_MAX = 8000;
const SECTION_CONTEXT_MAX = 60_000;

// Each section with the fields an edit would replace. When the whole homepage
// is too large to send, only the sections the owner named carry their fields.
function shownSections(blocks, mentioned) {
  const editable = block => {
    const sample = layout.CUSTOM[block.type]?.make();
    if (!sample || !SECTION_TYPES.includes(block.type)) return undefined;
    return Object.fromEntries(Object.keys(sample).filter(key => key !== 'img' && Object.hasOwn(block, key)).map(key => [key, block[key]]));
  };
  const all = blocks.map(block => ({ id: block.id, type: block.type, title: block.title, visible: block.on !== false, fields: editable(block) }));
  if (JSON.stringify(all).length <= SECTION_CONTEXT_MAX) return all;
  return all.map(section => (mentioned(section.title) || mentioned(section.type)) ? section : { ...section, fields: undefined });
}

function actionContext(message) {
  const context = {};
  const lower = message.toLowerCase();
  const { categories, items } = menuState();
  const menuWords = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const requestWords = ' ' + menuWords(message) + ' ';
  const mentionedItems = new Set();
  for (const { id, name } of items) {
    const itemWords = menuWords(name);
    if (itemWords.length > 1 && requestWords.includes(' ' + itemWords + ' ')) mentionedItems.add(id);
  }
  if (MENU_TOPIC.test(message) || mentionedItems.size) {
    context.menu = {
      categories: categories.slice(0, 36).map(({ name }) => name),
      items: items.sort((a, b) => Number(mentionedItems.has(b.id)) - Number(mentionedItems.has(a.id)))
        .slice(0, 100).map(({ id, name, price_cents, category_id, active }) =>
          ({ id, name, priceCents: price_cents, category: categories.find(item => item.id === category_id)?.name, active: !!active })),
    };
  }
  if (SITE_TOPIC.test(message)) {
    const site = siteState();
    const mentioned = value => typeof value === 'string' && value.length >= 3 && lower.includes(value.toLowerCase());
    const pages = Array.isArray(site.pages) ? site.pages : [];
    context.website = {
      hero: Object.fromEntries(Object.keys(HERO_FIELDS).filter(key => typeof site.hero?.[key] === 'string').map(key => [key, site.hero[key].slice(0, HERO_FIELDS[key])])),
      presets: Object.keys(theme.PRESETS), theme: site.theme?.custom ? site.theme.colors : site.theme?.preset || theme.DEFAULT_PRESET,
      sections: shownSections(layout.defaultLayout(site), mentioned),
      // A page body is sent whole or not at all: a cut-off body would come back
      // as the new page.
      pages: pages.filter(page => page && typeof page.slug === 'string').slice(0, 40).map(({ slug, title, published, body }) => ({
        slug, title, published,
        body: (mentioned(slug) || mentioned(title)) && typeof body === 'string' && body.length <= PAGE_BODY_MAX ? body : undefined,
        bodyTooLongToEdit: typeof body === 'string' && body.length > PAGE_BODY_MAX ? true : undefined,
      })),
      links: (Array.isArray(site.nav?.items) ? site.nav.items : []).filter(item => typeof item?.key === 'string' && item.key.startsWith('link:'))
        .slice(0, 30).map(({ key, label, top, foot }) => ({ key, label, top, foot })),
    };
  }
  if (FACILITY_TOPIC.test(message)) {
    context.facility = facilityState();
    context.bays = (getConfig().bays || []).slice(0, 24).map(bay => ({
      id: bay.id, name: bay.name, pcWakeMinutesBefore: bay.pcWakeMinutesBefore,
      devices: Object.entries(DEVICES).flatMap(([type, field]) => (bay[field] || []).slice(0, 16).map((device, index) => ({
        type, index, name: device.name, kind: device.kind,
        rules: Object.fromEntries(Object.keys(deviceRules(device)).map(key => [key, device[key]])),
      }))),
    }));
  }
  return context;
}

module.exports = { ACTIONS, StaleOwnerAction, actionContext, prepareOwnerAction };
