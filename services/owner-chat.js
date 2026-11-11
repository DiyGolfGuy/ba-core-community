'use strict';

const { localGuide } = require('./owner-chat-guides');

const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const proposalPrefix = 'BA-CORE-PROPOSAL ';
const bookingFields = ['openTime', 'closeTime', 'open24Hours', 'closeNextDay', 'pricePerHalfHour'];

function bookingSettings(config) {
  return Object.fromEntries(bookingFields.map(key => [key, config.booking[key]]));
}

function parseTime(text) {
  const match = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const suffix = match[3]?.toLowerCase();
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (suffix === 'pm' ? 12 : 0);
  } else if (hour > 23 || match[2] === undefined) {
    return null;
  }
  return String(hour).padStart(2, '0') + ':' + (match[2] || '00');
}

function normalizeProposal(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('The proposal must contain booking settings.');
  const keys = Object.keys(values);
  if (!keys.length || keys.some(key => !['openTime', 'closeTime', 'pricePerHalfHour'].includes(key))) {
    throw new Error('A proposal can contain hours and base price only.');
  }
  const patch = {};
  if ('openTime' in values || 'closeTime' in values) {
    const { openTime, closeTime } = values;
    if (typeof openTime !== 'string' || typeof closeTime !== 'string' ||
        !timePattern.test(openTime) || !timePattern.test(closeTime) || openTime === closeTime) {
      throw new Error('Give different opening and closing times in HH:MM. For round-the-clock bookings, say “set hours to 24/7”.');
    }
    Object.assign(patch, { openTime, closeTime, open24Hours: false, closeNextDay: closeTime < openTime });
  }
  if ('pricePerHalfHour' in values) {
    const price = values.pricePerHalfHour;
    if (typeof price !== 'number' || price < 0 || price > 10000 || !/^\d+(?:\.\d{1,2})?$/.test(String(price))) {
      throw new Error('Give a price from $0 to $10,000 per half hour, with up to two decimal places.');
    }
    patch.pricePerHalfHour = price;
  }
  return patch;
}

function describe(settings) {
  const hours = settings.open24Hours ? 'Open 24 hours' :
    `${settings.openTime} to ${settings.closeTime}${settings.closeNextDay ? ' the next day' : ''}`;
  return `${hours}. Base rate is $${Number(settings.pricePerHalfHour).toFixed(2)} per 30 minutes.`;
}

function interpret(raw, current) {
  const message = typeof raw === 'string' ? raw.trim() : '';
  if (!message || message.length > 500) throw new Error('Enter a request of 1 to 500 characters.');
  if (message.startsWith(proposalPrefix)) {
    let parsed;
    try { parsed = JSON.parse(message.slice(proposalPrefix.length)); }
    catch { throw new Error('Paste the complete proposal line from your AI client.'); }
    return { patch: normalizeProposal(parsed) };
  }
  const words = message.replace(/[.!?]$/, '').toLowerCase();
  if (/^(?:(?:show|what are|what is|what's) (?:the |my |our )?)?(?:hours|price|base price|booking settings|hours and prices)$/.test(words)) {
    return { reply: describe(current) };
  }
  if (/^(?:set |change )?(?:the |my |our )?(?:booking )?hours (?:to )?(?:24\/7|24 hours)$/.test(words)) {
    return { patch: { open24Hours: true } };
  }
  const hours = /^(?:set |change )?(?:the |my |our )?(?:booking )?hours (?:(?:to|from) )?(.+) (?:to|until|-) (.+)$/.exec(words);
  if (hours) {
    const openTime = parseTime(hours[1]);
    const closeTime = parseTime(hours[2]);
    if (!openTime || !closeTime) throw new Error('Use a time like 09:00 or 9 AM. Try “set hours from 9 AM to 10 PM”.');
    return { patch: normalizeProposal({ openTime, closeTime }) };
  }
  const price = /^(?:set |change )?(?:the |my |our )?(?:base )?price (?:to )?\$?(\d+(?:\.\d{1,2})?)\s*(?:per (hour|30 min(?:utes)?|half[- ]hour))?$/.exec(words);
  if (price) {
    const amount = Number(price[1]);
    const rate = price[2] === 'hour' ? Math.round(amount * 50) / 100 : amount;
    return { patch: normalizeProposal({ pricePerHalfHour: rate }) };
  }
  return localGuide(words);
}

module.exports = { bookingSettings, describe, interpret };
