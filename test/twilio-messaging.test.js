'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const twilio = require('twilio');
const { removeRetiredSettings } = require('../services/config');

const cfg = {
  server: { businessName: 'Example Studio' },
  booking: { staffedAccess: true },
  twilio: { accountSid: 'example-account', authToken: 'example-token', phoneNumber: '+12025550148' },
  sms: {
    shortBrand: 'Unapproved Sender',
    confirmationMsg: 'Unapproved custom confirmation',
    reminderMsg: 'Unapproved custom reminder',
    doorCodeMsg: 'Unapproved custom door code',
    cancellationMsg: 'Unapproved custom cancellation',
    endingWarningMsg: 'Unapproved custom ending notice',
    endingWarningBacktobbackMsg: 'Unapproved custom next-group notice'
  }
};
const outbound = [];
let stop = false;
let ledgerDown = false;
let carrierOptOut = false;
let recordedOptOuts = 0;
function stub(name, exports) { require.cache[require.resolve(name)] = { exports }; }
stub('../services/config', { getConfig: () => cfg });
stub('../services/db', {
  adminLog() {},
  smsOptOut() { recordedOptOuts++; },
  isSmsOptedOut() {
    if (ledgerDown) throw new Error('consent lookup unavailable');
    return stop;
  }
});
stub('../services/doorlock', { codeTimingForPage: () => '', codeTimingPhrase: () => 'not used' });
stub('twilio', Object.assign(() => ({
  messages: {
    async create(message) {
      if (carrierOptOut) throw Object.assign(new Error('The recipient opted out'), { code: 21610 });
      outbound.push(message);
      return { sid: 'example-message' };
    }
  }
}), { validateRequest: twilio.validateRequest }));
delete process.env.SMS_DRYRUN;
const sms = require('../services/sms');
const booking = { phone: '+12025550147', bay_name: 'Bay 1', date: '2026-11-20', start_time: '10:00', duration_minutes: 60 };

test('fixed outbound builders ignore every old template and sender override', async () => {
  const allowed = { ...booking, sms_consent: 1 };
  await sms.sendConfirmation(allowed);
  await sms.sendReminder(allowed, 60);
  await sms.sendDoorCode(allowed, '123456');
  await sms.sendCancellation(allowed);
  await sms.sendSessionEndingWarning(allowed, false);
  await sms.sendSessionEndingWarning(allowed, true, '11:00');
  await sms.sendSessionEndingWarning(allowed, false, null, true);
  await sms.sendSessionEndingWarning(allowed, false, null, false, true);
  await sms.sendVerificationCode(allowed.phone, '123456');
  assert.equal(outbound.length, 9);
  for (const { body } of outbound) {
    assert.match(body, /^Example Studio:/);
    assert.match(body, /Reply STOP to opt out\. Msg & data rates may apply\.$/);
    assert.doesNotMatch(body, /Unapproved|book more time/i);
  }
  assert.match(outbound[0].body, /Staff will set you up/);
  assert.doesNotMatch(outbound[0].body, /Code texted/);
  assert.match(outbound[8].body, /Your verification code is 123456/);
  assert.equal(sms.templateExamples(cfg).length, 9);
  assert.match(sms.finalize('Example Studio: reserved bay named Reply STOP', 'Example Studio'), /Reply STOP to opt out\. Msg & data rates may apply\.$/);
});

test('transactional sends need explicit booking consent and all sends honor STOP', async () => {
  const count = outbound.length;
  await sms.sendConfirmation(booking);
  await sms.sendReminder({ ...booking, sms_consent: 0 });
  await sms.sendCancellation({ ...booking, sms_consent: 'true' });
  await sms.sendDoorCode({ ...booking, sms_consent: '1' }, '123456');
  assert.equal(outbound.length, count);
  stop = true;
  try {
    assert.equal(await sms.sendVerificationCode(booking.phone, '123456'), undefined);
    assert.equal(outbound.length, count);
  } finally {
    stop = false;
  }
  ledgerDown = true;
  try {
    assert.equal(await sms.sendVerificationCode(booking.phone, '123456'), false);
    assert.equal(outbound.length, count);
  } finally {
    ledgerDown = false;
  }
  assert.equal(sms.bookingSmsAvailable(cfg), true);
  assert.equal(sms.bookingSmsAvailable({ ...cfg, booking: { membersOnly: true } }), false);
  assert.equal(sms.bookingSmsAvailable({ twilio: { accountSid: 'example-account', authToken: 'example-token' } }), false);
});

test('a carrier STOP is recorded without rerouting a message around it', async (t) => {
  carrierOptOut = true;
  cfg.messagebird = { apiKey: 'example-key', workspaceId: 'example-workspace', channelId: 'example-channel' };
  const bird = t.mock.method(globalThis, 'fetch', async () => ({ ok: false, json: async () => ({ message: 'Unavailable' }) }));
  try {
    assert.equal(await sms.sendVerificationCode(booking.phone, '123456'), false);
    assert.equal(recordedOptOuts, 1);
    assert.equal(bird.mock.callCount(), 0);
    cfg.smsProvider = { primary: 'messagebird' };
    assert.equal(await sms.sendVerificationCode(booking.phone, '123456'), false);
    assert.equal(recordedOptOuts, 2);
    assert.equal(bird.mock.callCount(), 1);
  } finally {
    carrierOptOut = false;
    delete cfg.messagebird;
    delete cfg.smsProvider;
  }
});

test('legacy consent and SMS edits are stripped while useful delivery settings stay', () => {
  const legacy = {
    content: { smsConsent: 'Override', headline: 'Example' },
    sms: { ...cfg.sms, sendReminder: false, reminderMinsBefore: 45 },
    twilio: { ...cfg.twilio }
  };
  assert.equal(removeRetiredSettings(legacy), true);
  assert.deepEqual(legacy.content, { headline: 'Example' });
  assert.deepEqual(legacy.sms, { sendReminder: false, reminderMinsBefore: 45 });
  assert.deepEqual(legacy.twilio, cfg.twilio);
});

test('public consent remains optional and the owner screens contain no SMS wording editor', () => {
  const publicFile = name => readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
  const bookingHtml = publicFile('index.html');
  const checkbox = /<input[^>]*\bid="smsOptIn"[^>]*>/.exec(bookingHtml);
  assert.ok(checkbox);
  assert.doesNotMatch(checkbox[0], /\bchecked\b|\brequired\b/);
  assert.match(bookingHtml, /from {{BUSINESS_NAME}} at the number provided/);
  assert.match(bookingHtml, /Consent is not a condition of any purchase/);
  assert.match(bookingHtml, /Reply STOP to cancel or HELP for help/);
  assert.match(bookingHtml, /href="\/sms-terms"/);
  assert.match(bookingHtml, /href="\/privacy"/);
  assert.doesNotMatch(publicFile('setup.html'), /id="smsConsent"/);
  assert.match(publicFile('admin.html'), /Locked SMS Templates/);
  assert.doesNotMatch(publicFile('admin.html'), /saveSmsMessages|sms_confirmationMsg|cfg_sms_shortBrand/);
  assert.match(publicFile('privacy.html'), /text messaging originator opt-in data and consent/);
  assert.match(publicFile('sms-terms.html'), /Terms &amp; Conditions/);
});


test('Twilio STOP and HELP callbacks require an authentic exact request signature', () => {
  const { twilioSignatureValid } = require('../services/auth');
  const url = 'https://book.example.com/api/twilio/incoming';
  const headers = { host: 'book.example.com', 'x-forwarded-proto': 'https' };
  const originalUrl = '/api/twilio/incoming';
  for (const body of [
    { From: booking.phone, Body: 'STOP', OptOutType: 'STOP' },
    { From: booking.phone, Body: 'HELP', OptOutType: 'HELP' },
    { From: booking.phone, Body: 'START', OptOutType: 'START' }
  ]) {
    const sig = twilio.getExpectedTwilioSignature(cfg.twilio.authToken, url, body);
    assert.equal(twilioSignatureValid({ headers, originalUrl, body }), false);
    const signedHeaders = { ...headers, 'x-twilio-signature': sig };
    assert.equal(twilioSignatureValid({ headers: signedHeaders, originalUrl, body }), true);
    assert.equal(twilioSignatureValid({
      headers: signedHeaders, originalUrl, body: { ...body, From: '+12025550149' }
    }), false);
  }
});
