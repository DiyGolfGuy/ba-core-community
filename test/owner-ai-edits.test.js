'use strict';

// Hosted Owner Chat website edits replace a stored value whole. These checks
// hold the two rules that keep that from deleting an owner's content: the model
// is shown everything an edit would replace, and an edit to content it was not
// shown is refused.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-edits-'));
process.env.BA_DB_PATH = path.join(work, 'bookings.db');
const dbModule = require('../services/db');
const layout = require('../public/site-layout');
const { actionContext, prepareOwnerAction } = require('../services/owner-ai-actions');

const faqItems = [
  { q: 'Where do I park?', a: 'Use the lot behind the building.' },
  { q: 'Can I bring my own clubs?', a: 'Yes. Rental sets are at the counter too.' },
  { q: 'How early should I arrive?', a: 'Ten minutes before your tee time.' },
];
const shortBody = 'Welcome to Example Indoor Golf. '.repeat(160).trim();   // about 5,000 characters
const longBody = 'House rules for every bay. '.repeat(400).trim();         // over 8,000 characters

function save(key, value) {
  dbModule.db.prepare('INSERT INTO website_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
function read(key) {
  return JSON.parse(dbModule.db.prepare('SELECT value FROM website_content WHERE key = ?').get(key).value);
}

test('a website edit never replaces content the model was not shown', async (t) => {
  // No autosave timer: this check reads and writes its own throwaway database.
  const autosaveStarted = global._dbAutoSaveStarted;
  global._dbAutoSaveStarted = true;
  await dbModule.initDb();
  require('../services/pos').ensureSchema();
  t.after(() => {
    if (autosaveStarted === undefined) delete global._dbAutoSaveStarted;
    else global._dbAutoSaveStarted = autosaveStarted;
    fs.rmSync(work, { recursive: true, force: true });
  });

  const blocks = layout.defaultLayout({});
  const faq = { ...layout.CUSTOM.faq.make(), id: 'faq-fixture', type: 'faq', on: true, title: 'Questions', items: faqItems };
  blocks.push(faq);
  save('layout', layout.toStored(blocks));
  save('pages', [
    { slug: 'about-us', title: 'About us', published: true, kind: 'text', body: shortBody },
    { slug: 'house-rules', title: 'House rules', published: true, kind: 'text', body: longBody },
  ]);
  assert.ok(shortBody.length > 4000 && shortBody.length <= 8000);
  assert.ok(longBody.length > 8000);

  // The model sees every FAQ item and the complete body of the page the owner named.
  const context = actionContext('Add a question about gift cards to the FAQ on the website and tidy the About us page.');
  const shown = context.website.sections.find(section => section.id === 'faq-fixture');
  assert.deepEqual(shown.fields.items, faqItems);
  const about = context.website.pages.find(page => page.slug === 'about-us');
  assert.equal(about.body, shortBody);
  const rules = context.website.pages.find(page => page.slug === 'house-rules');
  assert.equal(rules.body, undefined);
  assert.equal(rules.bodyTooLongToEdit, true);

  // With the whole list in hand, a full replacement keeps the three and adds one.
  const added = [...faqItems, { q: 'Do you sell gift cards?', a: 'Yes, at the counter and online.' }];
  const keep = prepareOwnerAction({ action: 'website', changes: [
    { kind: 'section', id: 'faq-fixture', fields: { items: added } },
    { kind: 'page', slug: 'about-us', fields: { body: shortBody + ' Open every day.' } },
  ] }, context);
  assert.ok(keep, 'an edit to shown content is prepared for review');
  keep.apply();
  const stored = layout.defaultLayout({ layout: read('layout') }).find(block => block.id === 'faq-fixture');
  assert.deepEqual(stored.items, added);
  assert.equal(read('pages').find(page => page.slug === 'about-us').body, shortBody + ' Open every day.');

  // A request that never showed the section or the page body cannot replace either.
  const blind = actionContext('Change the beer price.');
  assert.equal(blind.website, undefined);
  assert.equal(prepareOwnerAction({ action: 'website', changes: [
    { kind: 'section', id: 'faq-fixture', fields: { items: [{ q: 'Only one?', a: 'Yes.' }] } },
  ] }, blind), null);
  assert.equal(prepareOwnerAction({ action: 'website', changes: [
    { kind: 'page', slug: 'about-us', fields: { body: 'Short.' } },
  ] }, blind), null);

  // A page too long to send whole keeps its body; its title can still change.
  const again = actionContext('Rewrite the House rules page on the website.');
  assert.equal(prepareOwnerAction({ action: 'website', changes: [
    { kind: 'page', slug: 'house-rules', fields: { body: 'Be kind.' } },
  ] }, again), null);
  const retitle = prepareOwnerAction({ action: 'website', changes: [
    { kind: 'page', slug: 'house-rules', fields: { title: 'Bay rules' } },
  ] }, again);
  assert.ok(retitle);
  retitle.apply();
  const page = read('pages').find(entry => entry.slug === 'house-rules');
  assert.equal(page.title, 'Bay rules');
  assert.equal(page.body, longBody);

  // New sections and new pages need no prior content.
  assert.ok(prepareOwnerAction({ action: 'website', changes: [
    { kind: 'section', type: 'text', fields: { title: 'Leagues', body: 'Winter league starts soon.' } },
    { kind: 'page', slug: 'leagues', fields: { title: 'Leagues', body: 'Details to follow.' } },
  ] }, blind));
});
