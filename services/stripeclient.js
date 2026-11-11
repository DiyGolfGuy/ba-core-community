// Copyright (c) 2025-2026 BA Custom Products LLC.
// See LICENSE.txt for use and distribution terms.
'use strict';

const Stripe = require('stripe');

// Keep the API version used by the prior SDK. Terminal, membership webhooks,
// and Stripe Tax select their own versions at their respective boundaries.
const apiVersion = '2026-07-29.dahlia';

function stripeClient(key) {
  const options = { apiVersion };
  // Only a sandbox key can be sent to the local integration test server.
  if (process.env.BA_STRIPE_API_BASE && /^sk_test_/.test(key)) {
    const base = new URL(process.env.BA_STRIPE_API_BASE);
    options.host = base.hostname;
    options.port = Number(base.port) || 80;
    options.protocol = base.protocol.slice(0, -1);
  }
  return new Stripe(key, options);
}

module.exports = { stripeClient };
