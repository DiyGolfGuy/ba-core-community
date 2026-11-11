'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: pause } = require('node:timers/promises');

const source = path.resolve(__dirname, '..');

function request(port, pathname, { method = 'GET', headers = {}, body, bytes } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: bytes.toString(), bytes });
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(bytes ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
}

async function availablePort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function boot(directory, port, preload, env = {}) {
  const args = preload ? ['--require', preload, 'server.js'] : ['server.js'];
  const child = spawn(process.execPath, args, {
    cwd: directory,
    env: { ...process.env, BA_CORE_COMMUNITY: '1', BA_DISABLE_SCHEDULER: '1', ...env },
    stdio: 'ignore'
  });
  const exited = once(child, 'exit');
  for (let i = 0; i < 120 && child.exitCode === null; i++) {
    try {
      await request(port, '/setup');
      return { child, exited };
    } catch {
      await pause(50);
    }
  }
  child.kill('SIGTERM');
  await exited;
  assert.fail('The disposable BA Core service did not start');
}

function installFixture(directory) {
  for (const item of ['server.js', 'package.json', 'public', 'routes', 'services', 'scripts', 'templates', 'docs']) {
    fs.cpSync(path.join(source, item), path.join(directory, item), { recursive: true });
  }
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
}

function restoreRequest(port, backup, passphrase) {
  const boundary = 'test-' + randomBytes(12).toString('hex');
  const bytes = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="passphrase"\r\n\r\n${passphrase}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="backup"; filename="test.baenc"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n'),
    backup,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return request(port, '/api/admin/restore', {
    method: 'POST',
    headers: {
      Origin: `http://127.0.0.1:${port}`,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': bytes.length
    },
    bytes
  });
}

test('first boot rejects foreign setup requests and starts a blank site, books and cancels, and restores an encrypted backup', { timeout: 20000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-test-'));
  let running;
  try {
    installFixture(directory);
    const port = await availablePort();
    const config = path.join(directory, 'config.json');
    fs.writeFileSync(config, JSON.stringify({
      server: { port, bootstrapAuth: { marker: 'retired-example' } },
      setup: { defaultPassword: 'retired-example', eulaAccepted: true },
      updates: { automatic: true }
    }));
    fs.writeFileSync(path.join(directory, 'license.json'), JSON.stringify({ board: 'deliberately-different-example' }));
    const hostedCalls = path.join(directory, 'provider-requests.jsonl');
    const preload = path.join(directory, 'provider-stub.cjs');
    const key = 'test-owner-api-key-for-hosted';
    const claudeKey = 'test-claude-owner-api-key';
    fs.writeFileSync(preload, `
      const originalFetch = globalThis.fetch;
      const assert = require('node:assert/strict');
      globalThis.fetch = async (url, options) => {
        if (url === 'https://api.anthropic.com/v1/messages') {
          assert.equal(options.headers.Authorization, 'Bearer ' + ${JSON.stringify(claudeKey)});
          assert.equal(options.headers['anthropic-workspace-id'], 'wrkspc_fixture');
          const body = JSON.parse(options.body);
          assert.equal(body.model, 'claude-opus-5-5');
          assert.equal(body.thinking, undefined);
          assert.deepEqual(body.output_config, { effort: 'max' });
          assert.equal(body.max_tokens, 48_000);
          const input = JSON.parse(body.messages.at(-1).content);
          if (input.request === 'Simulate a provider limit.') {
            return Response.json({}, { status: 429 });
          }
          require('node:fs').appendFileSync(${JSON.stringify(hostedCalls)}, options.body + '\\n');
          const answer = input.request.startsWith('Draft a website')
            ? { text: 'Review the homepage and draft page.', proposal: { action: 'website', changes: [
                { kind: 'hero', fields: { headline: 'Fictional Fairway', sub: 'Four indoor bays.', ctaText: 'Reserve a Bay', ctaLink: '/book' } },
                { kind: 'theme', preset: 'navy-copper' },
                { kind: 'section', type: 'faq', fields: { title: 'First visit', items: [{ q: 'Where do I book?', a: 'Use Reserve a Bay.' }] } },
                { kind: 'page', slug: 'first-visit', fields: { title: 'First visit', body: 'Arrive at your reserved time.' } },
              ] } }
            : { text: 'Review the proposed hours.', proposal: { openTime: '19:00', closeTime: '02:00' } };
          return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] });
        }
        if (url !== 'https://api.openai.com/v1/responses') return originalFetch(url, options);
        assert.equal(options.headers.Authorization, 'Bearer ' + ${JSON.stringify(key)});
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'gpt-6-astra');
        assert.deepEqual(body.reasoning, { effort: 'xhigh' });
        assert.equal(body.max_output_tokens, 64_000);
        require('node:fs').appendFileSync(${JSON.stringify(hostedCalls)}, options.body + '\\n');
        const input = JSON.parse(Array.isArray(body.input) ? body.input.at(-1).content : body.input);
        let answer = { text: 'Review the new base rate.', proposal: { pricePerHalfHour: 31.25 } };
        if (input.request.includes('House Lager')) {
          // counter guidance comes from the operating guide or the full manual's counter chapters
          assert.ok(input.guidance.excerpts.some(section => ['OPERATING-GUIDE.md', 'OWNER-MANUAL.md'].includes(section.file)));
          const item = input.editing.menu.items.find(item => item.name === 'House Lager');
          assert.ok(item);
          answer = { text: 'Review the menu price.', proposal: { action: 'menu',
            items: [{ id: item.id, priceCents: input.request.includes('$6') ? 600 : 500 }] } };
        }
        if (input.request.startsWith('Keep bays on')) {
          const bay = input.editing.bays[0];
          answer = { text: 'Review the bay settings.', proposal: { action: 'facility',
            settings: { keepOnGapMins: 20 }, bays: [{ id: bay.id, pcWakeMinutesBefore: 12 }] } };
        }
        return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] });
      };
    `);
    running = await boot(directory, port);

    assert.equal((await request(port, '/setup')).status, 200);
    assert.match((await request(port, '/api/setup/guide')).body, /From a blank Raspberry Pi 5/);
    assert.equal((await request(port, '/api/setup/guide', { headers: { 'CF-Ray': 'synthetic' } })).status, 403);
    const cleaned = JSON.parse(fs.readFileSync(config));
    assert.equal(cleaned.server.bootstrapAuth, undefined);
    assert.equal(cleaned.setup.defaultPassword, undefined);
    assert.equal(cleaned.setup.eulaAccepted, undefined);
    assert.equal(cleaned.updates, undefined);
    assert.equal((await request(port, '/api/auth/setup/login', {
      method: 'POST', headers: { Origin: `http://127.0.0.1:${port}` }, body: {}
    })).status, 404);
    assert.equal((await request(port, '/setup', { headers: { Host: 'example.com' } })).status, 403);
    assert.equal((await request(port, '/setup', { headers: { 'CF-Ray': 'synthetic' } })).status, 403);
    assert.equal((await request(port, '/api/setup/complete', { method: 'POST', headers: { Origin: 'http://example.com' }, body: {} })).status, 403);

    const headers = { Origin: `http://127.0.0.1:${port}` };
    const pollution = JSON.parse('{"booking":{"__proto__":{"open24Hours":true}}}');
    assert.equal((await request(port, '/api/setup/complete', { method: 'POST', headers, body: pollution })).status, 400);
    assert.equal((await request(port, '/api/auth/setup/state?setting[constructor][prototype]=bad')).status, 400);
    assert.equal(JSON.parse(fs.readFileSync(config)).setup?.completed, undefined);

    assert.equal((await request(port, '/api/setup/complete', { method: 'POST', headers, body: {} })).status, 400);
    assert.equal(JSON.parse((await request(port, '/api/auth/setup/state')).body).setup_complete, false);
    assert.equal(JSON.parse(fs.readFileSync(config)).server.adminAuth, undefined);

    const password = randomBytes(16).toString('hex');
    const body = {
      server: { businessName: 'Example Test Studio', adminPassword: password, timezone: 'UTC' },
      bays: [{ id: 'example-bay', name: 'Example Bay', active: true, priceAdjustCents: -500 }],
      booking: { accessStyle: 'staffed', openDays: [0, 1, 2, 3, 4, 5, 6], bookingWindowDays: 14 }
    };
    assert.equal((await request(port, '/api/setup/complete', { method: 'POST', headers, body })).status, 200);
    await running.exited;
    const stored = JSON.parse(fs.readFileSync(config));
    assert.equal(stored.setup.completed, true);
    assert.equal(stored.server.adminPassword, undefined);
    assert.equal(stored.server.adminAuth.algo, 'scrypt');

    running = await boot(directory, port, preload);
    assert.equal((await request(port, '/setup')).headers.location, '/admin');
    assert.equal((await request(port, '/api/setup/guide')).status, 403);
    assert.doesNotMatch((await request(port, '/setup.html')).body, /reviewCard/);
    assert.equal((await request(port, '/api/setup/complete', { method: 'POST', headers, body })).status, 403);
    assert.match((await request(port, '/book')).body, /Not yet public/i);
    assert.equal((await request(port, '/api/admin/config', { headers: { 'X-Admin-Password': password } })).status, 401);

    const login = await request(port, '/api/auth/admin/login', { method: 'POST', body: { password } });
    assert.equal(login.status, 200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const guides = await request(port, '/api/admin/guides', { headers: { Cookie: cookie } });
    assert.equal(guides.status, 200);
    const installedGuides = JSON.parse(guides.body).guides;
    assert.ok(installedGuides.some((guide) => guide.file === 'HOME-ASSISTANT-SECOND-PI.md'));
    for (const file of ['EVERYTHING-ASK-YOUR-AI.pdf', 'HOME-ASSISTANT-SECOND-PI.pdf']) {
      assert.ok(installedGuides.some((guide) => guide.file === file && guide.kind === 'pdf'));
      const printable = await request(port, '/api/admin/guides/' + file + '?download=1', { headers: { Cookie: cookie } });
      assert.equal(printable.status, 200);
      assert.equal(printable.headers['content-type'], 'application/pdf');
      assert.match(printable.headers['content-disposition'], /^attachment;/);
      assert.match(printable.body, /^%PDF-/);
    }
    const adminHeaders = { Cookie: cookie, 'X-CSRF': JSON.parse(login.body).csrf };
    const initialBookings = await request(port, '/api/admin/bookings', { headers: adminHeaders });
    assert.deepEqual(JSON.parse(initialBookings.body).bookings, []);
    const command = 'BA-CORE-PROPOSAL {"openTime":"20:00","closeTime":"02:00","pricePerHalfHour":25.50}';
    assert.equal((await request(port, '/api/admin/owner-chat', { method: 'POST', body: { message: command } })).status, 401);
    assert.equal((await request(port, '/api/admin/update/status', { headers: adminHeaders })).status, 404);
    const preview = await request(port, '/api/admin/owner-chat', { method: 'POST', headers: adminHeaders, body: { message: command } });
    assert.equal(preview.status, 200);
    const { proposal } = JSON.parse(preview.body);
    assert.match(proposal.after, /20:00 to 02:00 the next day.*25.50/);
    assert.notEqual(JSON.parse(fs.readFileSync(config)).booking.pricePerHalfHour, 25.50);
    const apply = await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders, body: { id: proposal.id } });
    assert.equal(apply.status, 200);
    const saved = JSON.parse(fs.readFileSync(config)).booking;
    assert.equal(saved.pricePerHalfHour, 25.50);
    assert.equal(saved.closeNextDay, true);
    assert.equal((await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders, body: { id: proposal.id } })).status, 409);

    // The held public surface must reject booking requests until an owner opens it.
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const appointment = {
      name: 'Example Guest', phone: '202-555-0147', email: 'guest@example.com',
      date, start_time: '21:00', duration_minutes: 30, bay_id: 'example-bay'
    };
    const bookUrl = '/api/bookings/create-payment-intent';
    assert.equal((await request(port, bookUrl, { method: 'POST', body: appointment })).status, 404);
    const openSite = await request(port, '/api/website/content', {
      method: 'PUT', headers: adminHeaders,
      body: { key: 'settings', value: { siteEnabled: true, public: { booking: true } } }
    });
    assert.equal(openSite.status, 200);

    const booking = await request(port, bookUrl, { method: 'POST', body: appointment });
    assert.equal(booking.status, 200, booking.body);
    const confirmation = JSON.parse(booking.body);
    assert.equal(confirmation.devMode, true);
    assert.ok(confirmation.bookingId);
    assert.equal(confirmation.priceCents, 2050);
    const availabilityUrl = '/api/bookings/availability?date=' + date;
    const taken = await request(port, availabilityUrl);
    assert.equal(taken.status, 200);
    assert.equal(JSON.parse(taken.body).slotFree['21:00'], false);
    assert.doesNotMatch(taken.body, /Example Guest|guest@example[.]com|2025550147/);
    const duplicate = await request(port, bookUrl, { method: 'POST', body: appointment });
    assert.equal(duplicate.status, 409);
    const ownerBookings = await request(port, '/api/admin/bookings', { headers: adminHeaders });
    assert.ok(JSON.parse(ownerBookings.body).bookings.some(row => row.id === confirmation.bookingId));

    // Exercise both hosted connections through the real owner routes with synthetic replies.
    const settingsUrl = '/api/admin/owner-chat/hosted/settings';
    const hostedUrl = '/api/admin/owner-chat/hosted';
    const connection = { provider: 'openai', apiKey: key };
    const settingsFile = path.join(directory, 'owner-ai-secrets.json');
    const hostedMessage = { message: 'Propose a base rate of $31.25 per half hour.' };
    const localGuide = await request(port, '/api/admin/owner-chat', { method: 'POST', headers: adminHeaders,
      body: { message: 'How do I set up Stripe?' } });
    assert.equal(localGuide.status, 200);
    const { guide, proposal: localProposal } = JSON.parse(localGuide.body);
    assert.equal(guide.title, 'Test online payments with Stripe');
    assert.match(guide.steps[0].text, /Stripe Dashboard/);
    assert.match(guide.steps.at(-1).text, /live keys/);
    assert.equal(localProposal, undefined);
    assert.equal((await request(port, '/api/admin/guides/' + guide.file, { headers: adminHeaders })).status, 200);
    // "Copy the manual" and "Download" in Guides read the Ask Your AI file from here.
    const manual = await request(port, '/api/admin/owner-guide', { headers: adminHeaders });
    assert.equal(manual.status, 200, manual.body);
    assert.match(manual.headers['content-disposition'], /OWNER-MANUAL[.]md/);
    assert.match(manual.body, /Complete Owner Manual/);
    assert.ok(manual.body.length > 200_000, 'the whole manual is served');
    assert.equal(fs.existsSync(hostedCalls), false);
    const setupWalk = await request(port, '/api/admin/owner-chat', { method: 'POST', headers: adminHeaders,
      body: { message: 'Continue setup' } });
    assert.equal(setupWalk.status, 200, setupWalk.body);
    const setupSteps = JSON.parse(setupWalk.body).guide.steps;
    assert.equal(setupSteps[0].id, 'security');
    assert.ok(setupSteps.some(step => step.id === 'local-booking'));
    assert.ok(setupSteps.some(step => step.id === 'counter-test'));
    assert.ok(!setupSteps.some(step => step.id === 'access-test'));
    assert.equal((await request(port, settingsUrl)).status, 401);
    assert.equal((await request(port, hostedUrl, { method: 'POST', headers: adminHeaders, body: hostedMessage })).status, 409);
    assert.equal((await request(port, settingsUrl, { method: 'PUT', headers: { Cookie: cookie }, body: connection })).status, 401);
    assert.equal((await request(port, settingsUrl, { method: 'PUT', headers: { ...adminHeaders, Host: 'ba-core.local' }, body: connection })).status, 403);
    const malformed = await request(port, settingsUrl, { method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      bytes: Buffer.from('{"apiKey":"' + key + '" "provider":"openai"}') });
    assert.equal(malformed.status, 400);
    assert.ok(!malformed.body.includes(key));
    assert.equal(fs.existsSync(settingsFile), false);
    const connected = await request(port, settingsUrl, { method: 'PUT', headers: adminHeaders, body: connection });
    assert.equal(connected.status, 200, connected.body);
    assert.equal(JSON.parse(connected.body).provider, 'openai');
    assert.ok(!connected.body.includes(key));
    assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o600);
    assert.ok(!fs.readFileSync(config, 'utf8').includes(key));
    const connectionStatus = await request(port, settingsUrl, { headers: adminHeaders });
    assert.equal(connectionStatus.headers['cache-control'], 'no-store');
    assert.ok(!connectionStatus.body.includes(key));
    const preferences = { provider: 'openai', model: 'gpt-6-astra', effort: 'xhigh', maxOutputTokens: 64_000 };
    const updated = await request(port, settingsUrl, { method: 'PUT', headers: adminHeaders,
      body: { ...preferences, apiKey: '' } });
    assert.equal(updated.status, 200, updated.body);
    for (const [name, value] of Object.entries(preferences)) assert.equal(JSON.parse(updated.body)[name], value);
    assert.ok(!updated.body.includes(key));
    assert.equal((await request(port, settingsUrl, { method: 'PUT', headers: adminHeaders,
      body: { provider: 'anthropic', apiKey: '' } })).status, 400);
    const managerPassword = randomBytes(16).toString('hex');
    assert.equal((await request(port, '/api/admin/manager-password', { method: 'POST', headers: adminHeaders, body: { password: managerPassword } })).status, 200);
    const manager = await request(port, '/api/auth/admin/login', { method: 'POST', body: { password: managerPassword } });
    assert.equal(JSON.parse(manager.body).role, 'manager');
    const managerHeaders = { Cookie: manager.headers['set-cookie'][0].split(';')[0], 'X-CSRF': JSON.parse(manager.body).csrf };
    assert.equal((await request(port, settingsUrl, { headers: managerHeaders })).status, 403);
    assert.equal((await request(port, hostedUrl, { method: 'POST', headers: managerHeaders, body: hostedMessage })).status, 403);
    const localHelp = await request(port, '/api/admin/owner-chat', { method: 'POST', headers: adminHeaders, body: hostedMessage });
    assert.equal(JSON.parse(localHelp.body).handoff, true);
    assert.equal((await request(port, hostedUrl, { method: 'POST', headers: adminHeaders, body: { message: key } })).status, 400);
    assert.equal(fs.existsSync(hostedCalls), false);

    const hostedPreview = await request(port, hostedUrl, { method: 'POST', headers: adminHeaders, body: hostedMessage });
    assert.equal(hostedPreview.status, 200, hostedPreview.body);
    const hostedProposal = JSON.parse(hostedPreview.body).proposal;
    assert.match(hostedProposal.after, /31\.25 per 30 minutes/);
    assert.equal(JSON.parse(fs.readFileSync(config)).booking.pricePerHalfHour, 25.50);
    const outbound = fs.readFileSync(hostedCalls, 'utf8');
    assert.doesNotMatch(outbound, /Example Guest|guest@example\.com|202-555-0147|test-owner-api-key-for-hosted/);
    assert.deepEqual(JSON.parse(JSON.parse(outbound).input).health, { service: 'running', publicBookingHeld: false });
    const hostedApply = await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders, body: { id: hostedProposal.id } });
    assert.equal(hostedApply.status, 200, hostedApply.body);
    assert.equal(JSON.parse(fs.readFileSync(config)).booking.pricePerHalfHour, 31.25);

    const menuCategory = await request(port, '/api/pos/menu/category', { method: 'POST', headers: adminHeaders,
      body: { name: 'Test Drinks', printer_role: 'bar', tax_category: 'beverage' } });
    assert.equal(menuCategory.status, 200, menuCategory.body);
    const categoryId = JSON.parse(menuCategory.body).id;
    const menuItem = await request(port, '/api/pos/menu/item', { method: 'POST', headers: adminHeaders,
      body: { category_id: categoryId, name: 'House Lager', price_cents: 425, sort: 2, tax_category: 'beverage' } });
    assert.equal(menuItem.status, 200, menuItem.body);
    const itemId = JSON.parse(menuItem.body).id;
    const menuPreview = await request(port, hostedUrl, { method: 'POST', headers: adminHeaders,
      body: { message: 'Change House Lager to five dollars.' } });
    assert.equal(menuPreview.status, 200, menuPreview.body);
    const menuReview = JSON.parse(menuPreview.body);
    assert.match(menuReview.proposal.before, /\$4\.25/);
    assert.match(menuReview.proposal.after, /\$5\.00/);
    assert.ok(menuReview.guidance.destinations.some(entry => entry.id === 'menu'));
    const readMenu = async () => {
      const result = await request(port, '/api/pos/menu', { headers: adminHeaders });
      assert.equal(result.status, 200, result.body);
      return JSON.parse(result.body).menu.find(group => group.id === categoryId).items.find(item => item.id === itemId);
    };
    assert.equal((await readMenu()).price_cents, 425);
    const menuApply = await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders,
      body: { id: menuReview.proposal.id } });
    assert.equal(menuApply.status, 200, menuApply.body);
    const savedMenu = await readMenu();
    assert.equal(savedMenu.price_cents, 500);
    assert.equal(savedMenu.tax_category, 'beverage');
    assert.equal(savedMenu.sort, 2);

    const stalePreview = await request(port, hostedUrl, { method: 'POST', headers: adminHeaders,
      body: { message: 'Change House Lager on the menu to $6.' } });
    assert.equal(stalePreview.status, 200, stalePreview.body);
    assert.equal((await request(port, '/api/pos/menu/item', { method: 'POST', headers: adminHeaders,
      body: { id: itemId, category_id: categoryId, name: 'House Lager', price_cents: 550, sort: 2, tax_category: 'beverage' } })).status, 200);
    assert.equal((await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders,
      body: { id: JSON.parse(stalePreview.body).proposal.id } })).status, 409);
    assert.equal((await readMenu()).price_cents, 550);

    const facilityPreview = await request(port, hostedUrl, { method: 'POST', headers: adminHeaders,
      body: { message: 'Keep bays on for gaps up to 20 minutes and wake the first bay PC 12 minutes before bookings.' } });
    assert.equal(facilityPreview.status, 200, facilityPreview.body);
    const facilityReview = JSON.parse(facilityPreview.body).proposal;
    assert.match(facilityReview.after, /between groups \(minutes\) · 20/);
    const priorBay = JSON.parse(fs.readFileSync(config)).bays[0];
    assert.equal((await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders,
      body: { id: facilityReview.id } })).status, 200);
    const savedFacility = JSON.parse(fs.readFileSync(config));
    assert.equal(savedFacility.automation.keepOnGapMins, 20);
    assert.deepEqual(savedFacility.bays[0], { ...priorBay, pcWakeMinutesBefore: 12 });

    const claudeConnection = { provider: 'anthropic', apiKey: claudeKey, workspaceId: 'wrkspc_fixture',
      model: 'claude-opus-5-5', effort: 'max', maxOutputTokens: 48_000 };
    const switched = await request(port, settingsUrl, { method: 'PUT', headers: adminHeaders, body: claudeConnection });
    assert.equal(switched.status, 200, switched.body);
    assert.equal(JSON.parse(switched.body).provider, 'anthropic');
    assert.ok(!switched.body.includes(claudeKey));
    assert.ok(!fs.readFileSync(settingsFile, 'utf8').includes(key));
    const claudePreview = await request(port, hostedUrl, { method: 'POST', headers: adminHeaders,
      body: { message: 'Propose opening at 19:00 and closing at 02:00.' } });
    assert.equal(claudePreview.status, 200, claudePreview.body);
    const claudeProposal = JSON.parse(claudePreview.body).proposal;
    assert.match(claudeProposal.after, /19:00 to 02:00 the next day/);
    assert.equal(JSON.parse(fs.readFileSync(config)).booking.openTime, '20:00');
    const claudeOutbound = fs.readFileSync(hostedCalls, 'utf8').trim().split('\n').at(-1);
    assert.ok(!claudeOutbound.includes(claudeKey));
    assert.doesNotMatch(claudeOutbound, /Example Guest|guest@example\.com|202-555-0147/);
    const claudeApply = await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders,
      body: { id: claudeProposal.id } });
    assert.equal(claudeApply.status, 200, claudeApply.body);
    assert.equal(JSON.parse(fs.readFileSync(config)).booking.openTime, '19:00');

    const sitePreview = await request(port, hostedUrl, { method: 'POST', headers: adminHeaders,
      body: { message: 'Draft a website homepage and first-visit FAQ for four indoor bays.' } });
    assert.equal(sitePreview.status, 200, sitePreview.body);
    const siteReview = JSON.parse(sitePreview.body);
    assert.match(siteReview.proposal.after, /Fictional Fairway/);
    assert.match(siteReview.proposal.after, /Where do I book/);
    assert.equal((await request(port, '/p/first-visit', { headers: adminHeaders })).status, 404);
    const siteApply = await request(port, '/api/admin/owner-chat/apply', { method: 'POST', headers: adminHeaders,
      body: { id: siteReview.proposal.id } });
    assert.equal(siteApply.status, 200, siteApply.body);
    const siteAfter = await request(port, '/api/website/content', { headers: adminHeaders });
    const savedSite = JSON.parse(siteAfter.body).content;
    assert.equal(savedSite.hero.headline, 'Fictional Fairway');
    assert.equal(savedSite.hero.buttons[0].link, '/book');
    assert.equal(savedSite.theme.preset, 'navy-copper');
    assert.ok(savedSite.layout.blocks.some(block => block.title === 'First visit'));
    assert.equal((await request(port, '/p/first-visit')).status, 404);
    assert.match((await request(port, '/p/first-visit', { headers: adminHeaders })).body, /Arrive at your reserved time/);

    const limited = await request(port, hostedUrl, { method: 'POST', headers: adminHeaders,
      body: { message: 'Simulate a provider limit.' } });
    assert.equal(limited.status, 502);
    assert.match(JSON.parse(limited.body).error, /usage limit/);
    const localAfterLimit = await request(port, '/api/admin/owner-chat', { method: 'POST', headers: adminHeaders,
      body: { message: 'Show hours' } });
    assert.equal(localAfterLimit.status, 200);
    assert.match(JSON.parse(localAfterLimit.body).reply, /19:00 to 02:00 the next day/);

    // Export and decrypt a backup of the real synthetic booking.
    const passphrase = randomBytes(18).toString('hex');
    const vault = await request(port, '/api/admin/backup/vault/passphrase', {
      method: 'POST', headers: adminHeaders, body: { passphrase }
    });
    assert.equal(vault.status, 200, vault.body);
    const backup = await request(port, '/api/admin/backup', { headers: adminHeaders });
    assert.equal(backup.status, 200, backup.body);
    assert.match(backup.headers['content-disposition'], /[.]baenc/);
    assert.equal(backup.bytes.includes(Buffer.from('Example Guest')), false);
    const inspect = await request(port, '/api/admin/backup/test-restore', {
      method: 'POST', headers: adminHeaders, body: {}
    });
    assert.equal(inspect.status, 200, inspect.body);
    assert.equal(JSON.parse(inspect.body).ok, true, inspect.body);
    assert.equal(JSON.parse(inspect.body).counts.bookings, 1);
    assert.equal((await request(port, settingsUrl, { method: 'DELETE', headers: adminHeaders })).status, 200);
    assert.equal(fs.existsSync(settingsFile), false);
    assert.equal((await request(port, hostedUrl, { method: 'POST', headers: adminHeaders, body: hostedMessage })).status, 409);

    // Exercise the XLSX and outer ZIP writers through the normal owner report.
    const year = new Date().getFullYear();
    const report = await request(port, '/api/admin/records/year-report/' + year, { headers: adminHeaders });
    assert.equal(report.status, 200, report.body);
    assert.match(report.headers['content-disposition'], /[.]zip/);
    const reportFile = path.join(directory, 'example-year-report.zip');
    fs.writeFileSync(reportFile, report.bytes);
    const reportNames = execFileSync('unzip', ['-Z1', reportFile], { encoding: 'utf8' });
    assert.match(reportNames, /workbook[.]xlsx/);
    assert.match(reportNames, /report[.]pdf/);
    const csv = execFileSync('unzip', ['-p', reportFile, '*/csv/*.csv'], { encoding: 'utf8' });
    assert.doesNotMatch(csv, /Example Guest|guest@example[.]com/);


    assert.equal((await request(port, '/api/bookings/cancel/' + confirmation.bookingId, { method: 'POST', body: {} })).status, 410);
    const cancellation = await request(port, '/api/admin/booking/cancel/' + confirmation.bookingId, {
      method: 'POST', headers: adminHeaders, body: { refund_type: 'none' }
    });
    assert.equal(cancellation.status, 200, cancellation.body);
    const freed = await request(port, availabilityUrl);
    assert.equal(JSON.parse(freed.body).slotFree['21:00'], true);

    const freePreview = await request(port, '/api/admin/owner-chat', {
      method: 'POST', headers: adminHeaders, body: { message: 'BA-CORE-PROPOSAL {"pricePerHalfHour":0}' }
    });
    assert.equal(freePreview.status, 200, freePreview.body);
    const freeApply = await request(port, '/api/admin/owner-chat/apply', {
      method: 'POST', headers: adminHeaders, body: { id: JSON.parse(freePreview.body).proposal.id }
    });
    assert.equal(freeApply.status, 200, freeApply.body);
    const quoteUrl = `/api/pricing/calculate?date=${date}&start_time=21:00&duration_minutes=30`;
    const standardQuote = await request(port, quoteUrl);
    assert.equal(standardQuote.status, 200, standardQuote.body);
    assert.equal(JSON.parse(standardQuote.body).priceCents, 0);
    const discountedQuote = await request(port, quoteUrl + '&bay_id=example-bay');
    assert.equal(discountedQuote.status, 200, discountedQuote.body);
    assert.equal(JSON.parse(discountedQuote.body).priceCents, 0);
    const freeBooking = await request(port, bookUrl, { method: 'POST', body: appointment });
    assert.equal(freeBooking.status, 200, freeBooking.body);
    const freeConfirmation = JSON.parse(freeBooking.body);
    assert.equal(freeConfirmation.priceCents, 0);
    assert.ok(freeConfirmation.bookingId);

    // Restore the exact downloaded bytes into a second, blank installation.
    running.child.kill('SIGTERM');
    await running.exited;
    running = null;
    const replacement = path.join(directory, 'replacement');
    fs.mkdirSync(replacement);
    installFixture(replacement);
    fs.writeFileSync(path.join(replacement, 'config.json'), JSON.stringify({ server: { port } }));
    running = await boot(replacement, port);

    const rejectedRestore = await restoreRequest(port, backup.bytes, passphrase + '-wrong');
    assert.equal(rejectedRestore.status, 400, rejectedRestore.body);
    assert.equal(JSON.parse((await request(port, '/api/auth/setup/state')).body).setup_complete, false);
    const restored = await restoreRequest(port, backup.bytes, passphrase);
    assert.equal(restored.status, 200, restored.body);
    assert.equal(JSON.parse(restored.body).ok, true);
    assert.equal(fs.existsSync(path.join(replacement, 'owner-ai-secrets.json')), false);
    await running.exited;
    running = await boot(replacement, port);
    const restoredLogin = await request(port, '/api/auth/admin/login', { method: 'POST', body: { password } });
    assert.equal(restoredLogin.status, 200, restoredLogin.body);
    const restoredCookie = restoredLogin.headers['set-cookie'][0].split(';')[0];
    const restoredRows = await request(port, '/api/admin/bookings', { headers: { Cookie: restoredCookie } });
    const recovered = JSON.parse(restoredRows.body).bookings.find(row => row.id === confirmation.bookingId);
    assert.equal(recovered?.status, 'active');



  } finally {
    if (running && running.child.exitCode === null) running.child.kill('SIGTERM');
    if (running) await running.exited;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Stripe checkout verifies payment and its webhook while Resend handles booking and cancellation emails', { timeout: 15000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-core-payments-'));
  const requests = [];
  const intent = {
    id: 'pi_fixture', object: 'payment_intent', amount: 2500, currency: 'usd',
    status: 'requires_payment_method', client_secret: 'pi_fixture_secret_example'
  };
  const provider = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    switch (req.url) {
      case '/v1/payment_intents':
      case '/v1/payment_intents/pi_fixture':
        res.end(JSON.stringify(intent));
        break;
      case '/v1/refunds':
        res.end(JSON.stringify({ id: 're_fixture', amount: 2500, status: 'succeeded', charge: 'ch_fixture' }));
        break;
      case '/emails':
        res.end(JSON.stringify({ id: 'email_fixture' }));
        break;
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: 'Unexpected fixture request' } }));
    }
  });
  let running;
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const base = 'http://127.0.0.1:' + provider.address().port;
    const env = { BA_STRIPE_API_BASE: base, BA_RESEND_API: base + '/emails', EMAIL_DRYRUN: '0' };
    installFixture(directory);
    const port = await availablePort();
    const config = path.join(directory, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ server: { port } }));
    running = await boot(directory, port, null, env);

    const password = randomBytes(16).toString('hex');
    const stripe = { publishableKey: 'pk_test_fixture', secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture' };
    const resend = {
      apiKey: 're_fixture', fromEmail: 'booking@mail.example.com', sendConfirmation: true, sendCancellation: true
    };
    const setup = await request(port, '/api/setup/complete', {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:' + port },
      body: {
        server: { businessName: 'Example Studio', adminPassword: password, timezone: 'UTC' },
        bays: [{ id: 'example-bay', name: 'Example Bay', active: true }],
        booking: { accessStyle: 'staffed', openDays: [0, 1, 2, 3, 4, 5, 6], pricePerHalfHour: 25 },
        contact: { email: 'help@example.com' },
        stripe,
        resend
      }
    });
    assert.equal(setup.status, 200, setup.body);
    await running.exited;
    running = await boot(directory, port, null, env);
    const login = await request(port, '/api/auth/admin/login', { method: 'POST', body: { password } });
    assert.equal(login.status, 200, login.body);
    const headers = { Cookie: login.headers['set-cookie'][0].split(';')[0], 'X-CSRF': JSON.parse(login.body).csrf };
    const opened = await request(port, '/api/website/content', {
      method: 'PUT', headers, body: { key: 'settings', value: { siteEnabled: true, public: { booking: true } } }
    });
    assert.equal(opened.status, 200, opened.body);

    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const checkout = await request(port, '/api/bookings/create-payment-intent', {
      method: 'POST', body: { name: 'Example Guest', email: 'guest@example.com', phone: '202-555-0147',
        date, start_time: '12:00', duration_minutes: 30, bay_id: 'example-bay', sms_consent: false }
    });
    assert.equal(checkout.status, 200, checkout.body);
    const { bookingId, clientSecret, totalCents } = JSON.parse(checkout.body);
    assert.equal(clientSecret, intent.client_secret);
    assert.equal(totalCents, 2500);
    const create = requests.find(r => r.path === '/v1/payment_intents');
    assert.equal(create.method, 'POST');
    assert.equal(create.headers['stripe-version'], '2026-07-29.dahlia');
    assert.equal(create.headers.authorization, 'Bearer sk_test_fixture');
    assert.equal(new URLSearchParams(create.body).get('amount'), '2500');
    const confirm = () => request(port, '/api/bookings/confirm', { method: 'POST', body: { bookingId } });
    assert.equal((await confirm()).status, 402);

    const savedConfig = JSON.parse(fs.readFileSync(config, 'utf8'));
    fs.writeFileSync(config, JSON.stringify({ ...savedConfig, stripe: { ...savedConfig.stripe, secretKey: '' } }));
    assert.equal((await confirm()).status, 503);
    const rows = await request(port, '/api/admin/bookings', { headers });
    assert.equal(JSON.parse(rows.body).bookings.find(row => row.id === bookingId).status, 'pending_payment');
    fs.writeFileSync(config, JSON.stringify(savedConfig));

    intent.status = 'succeeded';
    intent.latest_charge = 'ch_fixture';
    const webhook = { id: 'evt_fixture', type: 'payment_intent.succeeded', data: { object: intent } };
    const webhookRequest = signature => request(port, '/api/stripe/webhook', {
      method: 'POST', headers: { 'Stripe-Signature': signature }, body: webhook
    });
    assert.equal((await webhookRequest('invalid')).status, 400);
    const signature = require('stripe').webhooks.generateTestHeaderString({
      payload: JSON.stringify(webhook), secret: stripe.webhookSecret
    });
    assert.equal((await webhookRequest(signature)).status, 200);
    assert.equal((await confirm()).status, 200);

    const cancellation = await request(port, '/api/admin/booking/cancel/' + bookingId, {
      method: 'POST', headers, body: { refund_type: 'full' }
    });
    assert.equal(cancellation.status, 200, cancellation.body);
    const refund = requests.find(r => r.path === '/v1/refunds');
    assert.equal(refund.headers['stripe-version'], '2026-07-29.dahlia');
    assert.equal(refund.headers['idempotency-key'], 'rf-' + bookingId + '-full');
    assert.equal(new URLSearchParams(refund.body).get('charge'), 'ch_fixture');

    const mail = () => requests.filter(r => r.path === '/emails');
    for (let i = 0; i < 50 && mail().length < 2; i++) await pause(20);
    assert.equal(mail().length, 2);
    const subjects = mail().map(r => {
      assert.equal(r.method, 'POST');
      assert.equal(r.headers.authorization, 'Bearer re_fixture');
      assert.match(r.headers['content-type'], /^application\/json/);
      const message = JSON.parse(r.body);
      assert.equal(message.from, resend.fromEmail);
      assert.deepEqual(message.to, ['guest@example.com']);
      assert.deepEqual(message.reply_to, ['help@example.com']);
      assert.equal(message.attachments[0].filename, 'booking.ics');
      return message.subject;
    }).sort();
    assert.match(subjects[0], /^Booking Cancelled/);
    assert.match(subjects[1], /^Booking Confirmed/);
  } finally {
    if (running && running.child.exitCode === null) running.child.kill('SIGTERM');
    if (running) await running.exited;
    await new Promise(resolve => provider.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
