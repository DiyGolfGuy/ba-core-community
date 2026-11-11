'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { GUIDE_DIR, searchGuides } = require('./installed-guides');

// Keep account walkthroughs in the same order as the shipped guide, as in Core 2 AI.
const operatingGuide = 'OPERATING-GUIDE.md';
const serviceGuide = 'SERVICE-SETUP.md';
const setupGuide = 'EVERYTHING-ASK-YOUR-AI.md';

function numberedSteps(file, heading) {
  const lines = readFileSync(join(GUIDE_DIR, file), 'utf8').split(/\r?\n/);
  const start = lines.findIndex(line => line.replace(/^#+\s+/, '') === heading && line.startsWith('#'));
  if (start < 0) throw new Error('The installed guide is missing a walkthrough section.');
  const level = lines[start].indexOf(' ');
  const steps = [];
  for (const line of lines.slice(start + 1)) {
    const depth = /^(#+)\s/.exec(line)?.[1].length;
    if (depth && depth <= level) break;
    if (depth) continue;
    const step = /^\d+\. (.+)/.exec(line);
    if (step) steps.push(step[1].replace(/\*\*|\x60/g, ''));
  }
  return steps;
}

const guides = [
  {
    match: /\b(?:home assistant|z[ -]?wave|remotelock|remote lock|unifi access)\b/,
    routeOnly: true, destinations: ['doors', 'homeAssistant'],
  },
  {
    match: /\b(?:pos|point of sale|counter|menu|beer|food|drinks?|kitchen|tax codes?)\b/,
    routeOnly: true, destinations: ['menu', 'counter'],
  },
  {
    match: /\b(?:printers?|receipts?|cash drawer)\b/,
    routeOnly: true, destinations: ['printers'],
  },
  {
    match: /\b(?:stripe terminal|card readers?|s700|s710)\b/,
    routeOnly: true, destinations: ['terminal'],
  },
  {
    match: /\b(?:backups?|restore|recovery|spare pi|usb copy)\b/,
    title: 'Backups and recovery', file: operatingGuide, destinations: ['backuppass'],
    steps: [
      'Open Settings → Protection → Backups. Set a backup passphrase and store it separately from the backup.',
      'Download an encrypted backup and keep a copy off the Pi. Use the backup summary to check whether any uploaded media needs its own copy.',
      'Practise with a synthetic backup on a spare installation running the same version. A restore replaces that installation’s records and settings. Keep its public route and facility equipment disconnected.',
      'After restoring, check bookings and settings. Review automation before reconnecting equipment and reconnect hosted AI with your own provider key if you use it.',
    ],
  },
  {
    match: /\b(?:two[- ]factor|2fa|mfa|authenticator)\b/,
    title: 'Protect the owner sign-in', file: setupGuide, destinations: ['security'],
    steps: [
      'In Admin, find Two-Factor Authentication in Settings and start enrolment.',
      'Add the account to your authenticator and verify a code. Keep the recovery codes somewhere you can reach if you lose the phone.',
      'Confirm you can sign in again with your authenticator. Use the recovery codes only when you need them.',
    ],
  },
  {
    match: /\b(?:stripe(?! terminal)|webhooks?|online payments?|checkout|refunds?)\b/,
    title: 'Test online payments with Stripe', file: serviceGuide, destinations: ['stripe'],
    steps: () => [
      ...numberedSteps(serviceGuide, 'Start in a sandbox'),
      'Check the event delivery under Stripe Workbench → Webhooks as described in the services guide. Finish sandbox tests before switching to live keys.',
    ],
  },
  {
    match: /\b(?:resend|e-?mail)\b/,
    title: 'Send booking email with Resend', file: serviceGuide, destinations: ['resend'],
    steps: () => numberedSteps(serviceGuide, 'Resend email'),
  },
  {
    match: /\b(?:twilio|sms|text messaging|text messages?|texting)\b/,
    title: 'Set up booking texts with Twilio', file: serviceGuide, destinations: ['twilio'],
    steps: () => [
      'The full guide covers US local numbers. Follow the registration path for your number type. Keep booking email working while waiting for texting approval.',
      ...numberedSteps(serviceGuide, 'Prepare the booking website and opt-in proof'),
      ...numberedSteps(serviceGuide, 'Submit your application in the Twilio Console'),
      'Use the examples in the full guide to complete the application. Wait for the sender and campaign to be approved before sending customer messages.',
      ...numberedSteps(serviceGuide, 'Connect the number and check STOP, HELP, and START'),
    ],
  },
  {
    match: /\b(?:cloudflare|tunnels?|public (?:address|domain|hostname)|dns|domain|outside the (?:facility|network))\b/,
    title: 'Put your booking site on a public address', file: 'CLOUDFLARE-TUNNEL.md', destinations: ['domain', 'public'],
    steps: [
      'Finish the local booking test. In your Cloudflare account, create a tunnel and follow its Linux ARM64 connector instructions on the Pi.',
      'Once the connector is healthy, publish a route for your chosen hostname to http://127.0.0.1:3001. Save the matching HTTPS address in BA Core’s Local Search & SEO settings.',
      'Open the address on a phone off Wi-Fi. Verify the intended site opens, Admin requires sign-in, and /setup is unavailable. Keep public booking held until your payment and access tests are complete.',
    ],
  },
  {
    match: /\b(?:door|locks?|keypads?|remote\s?lock|unifi access|entry codes?|z-wave)\b/,
    title: 'Test booking-driven door access', file: serviceGuide, destinations: ['doors'],
    steps: [
      'Use the guide for your lock provider to connect and test the lock independently. For a Home Assistant Z-Wave lock, use the second-Pi Home Assistant guide to test code slots.',
      'Configure the door and its booking timing in Admin. With someone on site and a way to enter manually, make one fictional reservation.',
      'Verify the code is programmed and works in its intended window. Test cancellation, expiry, and what happens if the provider or lock goes offline before enabling unattended entry.',
    ],
  },
  {
    match: /\b(?:session monitor|watcher|windows|bay pc|wake-on-lan|add[ -]time)\b/,
    title: 'Install the Windows bay Session Monitor', file: 'BAY-PC-SESSION-MONITOR.md', destinations: ['bays'],
    steps: [
      'From the bay PC, check that it can reach BA Core on the Pi’s local address. Install Python 3 with the Windows launcher and Tcl/Tk, then run py --version and py -m tkinter.',
      'Open Bays & Devices, expand the bay, and choose Build Session Monitor. Copy and extract that bay’s ZIP on the matching PC. Follow the included README to run install-monitor.bat as administrator.',
      'Restart and sign in to Windows as the simulator user. Use a dummy booking to check the reserved screen, the ending warning, and the add-time QR when the next slot is available.',
    ],
  },
  {
    match: /\b(?:home assistant|hass)\b/,
    title: 'Connect a Home Assistant Pi', file: 'HOME-ASSISTANT-SECOND-PI.md', destinations: ['homeAssistant', 'bays'],
    steps: [
      'Install Home Assistant on a separate Pi. Give it a stable local address and pair and test the first device in Home Assistant.',
      'In Home Assistant, create a long-lived access token. In BA Core Admin, enter the Home Assistant URL and token in Settings → Devices → Home Assistant - Smart Devices. Test the connection and save.',
      'Assign a test entity in Bays & Devices. Verify a manual action, then watch a fictional booking through its start and end before adding more equipment.',
    ],
  },
  {
    match: /\b(?:bays?|devices?|automation|shelly|plugs?|projectors?|lights?)\b/,
    title: 'Set up a bay and its equipment', file: operatingGuide, destinations: ['bays', 'automation'],
    steps: [
      'In Bays & Devices, name one bay and confirm it is active. Check that it is available for the hours you want in Settings → Booking.',
      'If you need automation, connect one device first. For Home Assistant, use the second-Pi guide. Start with a harmless device test such as switching a lamp on and off.',
      'Set the before- and after-booking timing and make a short fictional booking. Watch the equipment through the start, end, and a pair of back-to-back bookings.',
    ],
  },
  {
    match: /\b(?:pos|point of sale|counter|staff|menu|receipts?|printers?|kitchen|walk[ -]?in|stripe terminal|card readers?|s700|s710)\b/,
    title: 'Set up and test the counter', file: operatingGuide, destinations: ['counter', 'menu'],
    steps: [
      'Set up staff sign-in and enable Food & Drink if you sell it. In Point of Sale, open Tax Codes and Menu & Kitchen Routing to configure your menu and printing.',
      'Sign in at /staff as a test staff member. Make a fictional walk-in or find a test booking in Tee Times and open its tab.',
      'Add a test item and settle with the payment method you intend to use. If you use a card reader or printer, confirm the charge, receipt, and kitchen ticket as applicable.',
    ],
  },
  {
    match: /\b(?:memberships?|members?|waivers?)\b/,
    title: 'Test memberships and waivers', file: setupGuide, destinations: ['members', 'waivers'],
    steps: [
      'Open Members in Admin to set up a test tier. Set the included hours, booking limits, and extra-time pricing for that tier.',
      'Use a fictional member to verify availability, price, and limits. If you bill for recurring memberships, check signup, renewal events, and cancellation in a Stripe Sandbox.',
      'Search Settings for Waivers if your facility uses them. Run a test booking or check-in and confirm the fictional signature is recorded where you expect it.',
    ],
  },
  {
    match: /\b(?:website|branding|home ?page|hero|headline|site builder|logo|navigation|page layout|faq|colors|colours)\b/,
    title: 'Build and preview the website', file: operatingGuide, destinations: ['website', 'public'],
    steps: [
      'Open Website in Admin. Start with Colors & Fonts and Hero. Point your booking button to /book.',
      'Use Page Layout to arrange the homepage and Pages to add details such as directions and house rules. Use Show Preview on both a narrow and a wide screen.',
      'In What’s Public, open only the sections you’ve checked. Once the tunnel is ready, use a phone off Wi-Fi to test the site and booking links.',
    ],
  },
  {
    match: /\b(?:codex|claude|hosted ai|ai client|mcp|api key)\b/,
    title: 'Connect your own AI', file: 'BA-CORE-MCP.md',
    steps: [
      'For AI in this dialog, open Admin over HTTPS or the private SSH forward. Open Hosted AI settings and choose OpenAI or Claude.',
      'Enter a model ID your provider account can access, set its thinking effort and output tokens if desired, and put the provider API key in the key field. Save the connection.',
      'Use Ask hosted AI for a harder question and review any proposed change before applying it. To use Codex or Claude Code from your computer, follow the private SSH instructions in the full guide.',
    ],
  },
  {
    match: /\b(?:bookings?|reservations?|availability|calendar|hours|rates?|prices?|buffers?|cancels?|cancellations?)\b/,
    title: 'Check booking rules and run a test', file: operatingGuide, destinations: ['hours', 'bookings'],
    steps: [
      'Open Settings → Booking → Hours & Booking Rules. Confirm the time zone, available days and hours, session lengths, and booking window.',
      'Check the base rate and any bay or time-specific pricing. In Bookings, make a fictional reservation for an active bay. Confirm the slot becomes unavailable.',
      'Cancel that reservation in Admin and verify the slot is free again. Check the customer booking flow before opening public booking.',
    ],
  },
];

const help = 'Ask locally about setup, booking, Stripe, email, texts, your website, Cloudflare, bays, locks, the Windows watcher, POS, memberships, backups, or connecting your AI. You can also say “show hours”, “set hours from 9 AM to 10 PM”, or “set price to $35 per 30 minutes”.';
const setupWords = /\b(?:setup|set up|launch|go live|first boot|getting started|start|install|checklist|raspberry pi|pi 5)\b/;

function localGuide(words) {
  if (/^(?:help|what can you (?:do|help with)|(?:show |list )?(?:help )?topics)$/.test(words)) return { reply: help };
  const proposalRequest = /\bpropose\b/.test(words);
  const match = !proposalRequest && guides.find(guide => !guide.routeOnly && guide.match.test(words));
  if (!match) {
    if (!proposalRequest && setupWords.test(words)) return { setupWalkthrough: true };
    return { reply: help + ' For a different request, copy it to your AI client or use Ask hosted AI if connected.', handoff: true };
  }
  const { title, file, steps, destinations } = match;
  const topics = typeof steps === 'function' ? steps() : steps;
  return { reply: topics[0], guide: { title, file, steps: topics.map(text => ({ text, setting: destinations?.[0] })) } };
}

const destinationLabels = {
  doors: 'Settings → Devices → Door Access Provider',
  homeAssistant: 'Settings → Devices → Home Assistant',
  automation: 'Settings → Devices → Shutdown & Warning Timing',
  printers: 'Settings → Devices → Kitchen & Counter Printers',
  counter: 'Settings → Staff → The Counter',
  menu: 'Settings → Food & Payments → Menu & Kitchen Routing',
  terminal: 'Settings → Food & Payments → Card Readers',
  stripe: 'Settings → Connections → Stripe',
  resend: 'Settings → Connections → Resend',
  twilio: 'Settings → Connections → Twilio',
  domain: 'Settings → Business & Content → Local Search & SEO',
  backuppass: 'Settings → Protection → Backups',
  security: 'Settings → Protection → Two-Factor Authentication',
  hours: 'Settings → Booking → Hours & Booking Rules',
  bays: 'Bays & Devices', members: 'Members', waivers: 'Waivers', bookings: 'Bookings',
  website: 'Website editor', public: 'Website → What’s Public',
};

function hostedGuideContext(message, menuRequested) {
  const query = menuRequested ? ('POS menu ' + message).slice(0, 4000) : message;
  const lower = query.toLowerCase();
  const ids = [...new Set(guides.filter(guide => guide.match.test(lower)).flatMap(guide => guide.destinations || []))];
  return { excerpts: searchGuides(query), destinations: ids.slice(0, 4).map(id => ({ id, label: destinationLabels[id] })) };
}

// Core 2 AI starts with unfinished checklist items and lets owners leave a step
// for later. Community uses the existing Admin checklist as the source of status.
function setupWalkthrough(items, { twoFactor, hasActiveBay, accessStyle }) {
  const open = new Map(items.filter(item => !item.done).map(item => [item.id, item]));
  const steps = [];
  const add = (id, title, text, file, setting) => steps.push({ id, title, text, file, setting });
  const unfinished = (id, text, file, setting = id) => {
    const item = open.get(id);
    if (item) add(id, item.label, text, file, setting);
  };
  if (!twoFactor.enabledLogin || !twoFactor.enabledSensitive) {
    add('security', 'Protect the owner account', 'Open Settings → Protection → Two-Factor Authentication. Enrol your authenticator, save the recovery codes, and turn on both sign-in and sensitive-action protection. Try a fresh sign-in.', setupGuide, 'security');
  }
  unfinished('branding', 'Confirm the name customers should see. Add a logo if you have one. You can leave this for later.', operatingGuide);
  unfinished('citystate', 'Add your facility city and state in Local Search & SEO so your site displays the right location.', operatingGuide);
  unfinished('access', 'Choose staffed, unstaffed, or hybrid access in Booking settings.', operatingGuide);
  unfinished('hours', 'Confirm the facility time zone, opening hours, session lengths, booking window, and base rate.', operatingGuide);
  if (!hasActiveBay) add('bays', 'Enable a test bay', 'Open Bays & Devices. Name one bay, enable it for booking, and save.', operatingGuide, 'bays');
  unfinished('wfrate', 'Confirm the rate per 30 minutes for the entire facility.', operatingGuide, 'hours');
  unfinished('staffedhours', 'For hybrid access, enter staffed days and hours. Test a staffed slot and an unstaffed slot before relying on deposits or door codes.', operatingGuide);
  unfinished('checkin', 'Review whether check-in fits your unstaffed access. If customers let themselves in, confirm which instructions they receive.', operatingGuide, null);
  unfinished('staffedcopy', 'Check that the website explains how staff will greet customers and when to arrive.', operatingGuide);
  unfinished('tier', 'Create your first membership tier and verify its included hours, limits, and extra-time price.', setupGuide, 'members');
  for (const id of ['mwaiver', 'waiverdoc']) {
    unfinished(id, 'If you require a waiver, upload and activate your own waiver PDF. Verify a fictional customer can sign it.', setupGuide, 'waivers');
  }
  add('local-booking', 'Prove one booking locally', 'Keep the public tunnel unpublished. Check hours and prices, then make and cancel a fictional reservation. Verify the same slot cannot be booked twice and becomes available after cancellation.', operatingGuide, 'bookings');
  unfinished('backuppass', 'Set a separate backup passphrase and save it somewhere you can reach during a recovery.', operatingGuide);
  add('backup-test', 'Keep a recovery copy', 'Download an encrypted backup off the Pi. Practise restoring a synthetic backup on a spare installation before relying on it.', operatingGuide, 'backuppass');
  unfinished('domain', 'If you want public bookings, choose a domain and put the exact HTTPS origin in Local Search & SEO. You can leave this for a local-only installation.', 'DOMAIN-SETUP.md');
  add('tunnel', 'Check the public address if you use one', 'Follow the Cloudflare Tunnel guide. Test the hostname on a phone off Wi-Fi, including the holding page and that /setup is inaccessible. Keep customer booking held while testing.', 'CLOUDFLARE-TUNNEL.md');
  unfinished('stripe', 'If you accept online cards, connect matching Stripe Sandbox keys. Test a payment, the webhook delivery, cancellation, and any refund. Ask locally about Stripe for the full walkthrough.', serviceGuide);
  unfinished('resend', 'Verify your sending domain in Resend and add a From address and sending key. Test the actual confirmation and cancellation with an inbox you control.', serviceGuide);
  unfinished('twilio', 'Texting is optional. Use the Twilio guide if you need SMS. Keep email working while the sender is approved, then test opt-in, STOP, HELP, and START.', serviceGuide);
  if (accessStyle !== 'staffed') {
    add('access-test', 'Prove entry on site', 'Use a test reservation to check entry instructions and the actual door or keypad. Verify that any booking PIN works in its window and that cancellation, expiry, and an outage behave as expected.', serviceGuide, 'bays');
  }
  if (accessStyle !== 'unmanned') {
    add('counter-test', 'Practise the staffed flow', 'Have a test staff member open /staff. Run a fictional check-in or walk-in. If you sell items, test settling a tab and any receipt or kitchen printer you use.', operatingGuide);
  }
  add('launch', 'Review before opening bookings', 'Reboot the Pi and confirm Admin and local booking recover. Test any bay automation through a booking. When the payment, messaging, and access flows you use are ready, review Website → What’s Public and verify the customer path from outside.', setupGuide, 'public');
  return { reply: steps[0].text, guide: { id: 'setup', title: 'Get your facility ready', file: setupGuide, steps } };
}

module.exports = { localGuide, setupWalkthrough, hostedGuideContext };
