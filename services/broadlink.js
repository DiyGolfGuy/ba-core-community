// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/broadlink.js — BroadLink IR Control
//
//  Calls the local Python bridge (broadlink-bridge.py) on port 3002.
//  Completely separate from Shelly — won't affect existing plug control.
// ═══════════════════════════════════════════════════════════════════════════════

// TEST SEAM (Sep 17 2026), the same shape services/remotelock.js ENDPOINTS has.
// The bench runs the REAL broadlink-bridge on 127.0.0.1:3002, so a battery that
// stands its own bridge up there gets EADDRINUSE - which is how this was found:
// green on the workshop, red on the Pi. Production never sets the variable.
const BRIDGE_URL = process.env.BA_BROADLINK_BRIDGE || 'http://localhost:3002';

async function bridgeRequest(path, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000)
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${BRIDGE_URL}${path}`, opts);
    return await res.json();
  } catch (err) {
    console.error(`BroadLink bridge error [${path}]: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Check if the bridge is running
 */
async function isBridgeRunning() {
  try {
    const res = await bridgeRequest('/health');
    return res.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Send an IR command to a BroadLink device
 * @param {string} ip - Device IP
 * @param {string} command - Base64 encoded IR code
 */
async function sendCommand(ip, command) {
  if (!ip || !command) return { error: 'ip and command required' };
  const res = await bridgeRequest('/send', 'POST', { ip, command });
  if (res.success) {
    console.log(`📺 IR sent → ${ip}`);
  } else {
    console.error(`📺 IR failed → ${ip}: ${res.error}`);
  }
  return res;
}

/**
 * Discover BroadLink devices on the network
 */
async function discoverDevices() {
  return await bridgeRequest('/discover');
}

/**
 * Start IR learning mode on a device
 */
async function startLearning(ip) {
  return await bridgeRequest('/learn/start', 'POST', { ip });
}

/**
 * Capture the learned IR code
 */
async function captureCode() {
  return await bridgeRequest('/learn/capture', 'POST', {});
}

/**
 * Test connection to a device
 */
async function testDevice(ip) {
  return await bridgeRequest('/test', 'POST', { ip });
}

module.exports = {
  sendCommand,
  discoverDevices,
  startLearning,
  captureCode,
  testDevice,
  isBridgeRunning
};
