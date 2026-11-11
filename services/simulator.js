// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/simulator.js  —  Simulator PC Control
//
//  Uses net rpc shutdown (Samba) to shut down Windows PCs directly from the Pi.
//  No agent or extra software needed on the simulator PCs.
//
//  Requirements on each simulator PC:
//    1. An Admin user account (e.g. Admin / password)
//    2. Remote Shutdown firewall rule enabled:
//       Enable-NetFirewallRule -DisplayGroup "Remote Shutdown"
//       netsh firewall set service RemoteAdmin enable
//       reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f
//
//  Config per bay in config.json:
//    simulatorPcIp:    "192.168.1.xxx"
//    simulatorWinUser: "Admin"
//    simulatorWinPass: "password"
// ═══════════════════════════════════════════════════════════════════════════════

const { spawn }     = require('child_process');
const { getConfig } = require('./config');
const { adminLog }  = require('./db');

/** Get bay config by ID */
function getBayById(bayId) {
  return getConfig().bays.find(b => b.id === bayId);
}

function scrubSecrets(text, password) {
  const source = String(text || '');
  return password ? source.split(password).join('********') : source;
}

// Launch Samba directly and pass its password on a dedicated inherited pipe.
// The password stays out of the child arguments, environment, and filesystem.
const PC_CMD_TIMEOUT_MS = () => Number(process.env.BA_PC_CMD_TIMEOUT_MS) || 30000;
function runCmd(args, user, password) {
  if (/[%\r\n\0]/.test(user) || /[\r\n\0]/.test(password)) {
    return Promise.resolve({ success: false, error: 'Invalid characters in the Windows username or password.' });
  }
  const env = { ...process.env, PASSWD_FD: '3' };
  delete env.PASSWD;
  delete env.PASSWD_FILE;

  return new Promise(resolve => {
    const child = spawn('net', [...args, '--user=' + user], { env, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    const timeout = PC_CMD_TIMEOUT_MS();
    let timedOut = false;
    let outputSize = 0;
    const errorOutput = [];
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    // A PC THAT DOES NOT ANSWER NEVER HOLDS UP ANYTHING ELSE. 'close' waits for
    // every holder of the child's pipes, so a helper process that inherited them
    // could keep the scheduler's minute waiting long after the kill. At the time
    // limit the command is killed, its pipes are dropped and the answer is given
    // now - a failure the scheduler retries.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      for (const stream of child.stdio) if (stream) stream.destroy();
      finish({ success: false, error: `the PC did not answer within ${Math.round(timeout / 1000)} seconds` });
    }, timeout);

    child.stderr.on('data', chunk => {
      outputSize += chunk.length;
      if (outputSize <= 16 * 1024) errorOutput.push(chunk);
    });
    child.once('error', error => finish({ success: false, error: scrubSecrets(error.message, password) }));
    child.once('close', (code, signal) => {
      if (timedOut) return finish({ success: false, error: `the PC did not answer within ${Math.round(timeout / 1000)} seconds` });
      if (code === 0) return finish({ success: true });
      const diagnostic = outputSize <= 16 * 1024 ? Buffer.concat(errorOutput).toString('utf8') : '';
      finish({ success: false, error: scrubSecrets(diagnostic, password).trim() || `Samba net exited with ${signal || 'code ' + code}.` });
    });
    // If Samba exits before consuming its password, the child exit/error above
    // provides the diagnostic. Ignore the broken pipe so it cannot stop BA Core.
    child.stdio[3].on('error', () => {});
    child.stdio[3].end(password + '\n');
  });
}

/**
 * Send shutdown command to a Windows PC via net rpc shutdown.
 * Shows a message on screen, player can dismiss it and keep playing.
 * PC shuts down when the delay timer expires — no second popup.
 *
 * @param {object} bay - Bay config object
 * @param {number} delaySecs - Seconds until PC actually shuts down (default 180 = 3 min)
 * @param {string} message - Message shown on the PC screen
 */
async function sendShutdown(bay, delaySecs = 180, message = '') {
  const ip   = bay.simulatorPcIp;
  const user = bay.simulatorWinUser || 'Admin';
  const pass = bay.simulatorWinPass || '';

  if (!ip) {
    // A-wave 12b: an absent device is not a refusal. This returned the same bare
    // `false` as a PC that would not shut down, so the moment the scheduler started
    // reading the answer, every bay without a PC failed its shutdown on every
    // booking - which is the default state of every freshly-wizarded unit.
    console.warn(`No PC IP configured for bay ${bay.name}`);
    return { skipped: true, reason: 'no simulator PC is configured for this bay' };
  }

  // ALREADY OFF IS DONE, NOT FAILED (maintainer, Sep 16 2026). Rule 31 says a device the
  // facility does not HAVE is not a failure - and A-wave 12 read that as "no IP
  // configured" only. A bay PC that is simply switched off (someone pressed the
  // button, a previous session's shutdown landed, the wall socket is on a timer)
  // answered `net rpc` with a connection failure, which mustHaveWorked threw on,
  // which retried every ten minutes for ever and painted the health line red.
  // The purpose of this call is for the PC to end up off. If it is already off,
  // the purpose is served: that is a SUCCESS, not something to retry.
  if ((await probePc(ip)) === false) {
    // A DISTINCT EVENT, because nothing was sent. Writing SHUTDOWN_SENT here put a
    // thing the unit only INFERRED into the owner's record as a thing it did -
    // rule 29's headline case, from the wrong side. And the probe cannot actually
    // tell "off" from "did not answer port 445 in 2.5 s": both resolve false. What
    // saves this is that `net rpc` rides the same port, so a PC that cannot answer
    // 445 could not have been shut down by the old code either - the outcome is
    // the same, only now it is not retried six times and not called a success.
    adminLog('SHUTDOWN_SKIPPED', `Bay: ${bay.name} | IP: ${ip} | did not answer on port 445 - it is off, or unreachable; nothing was sent`);
    return { skipped: true, reason: 'this bay\'s PC did not answer - it is off or unreachable, so no shutdown was sent' };
  }

  const msg = message || `Your session ends in ${Math.round(delaySecs / 60)} minutes. The computer will shut down automatically. Thank you for playing!`;
  // -f = force: closes all apps and signs out every profile unconditionally.
  // Required for unmanned operation — a second signed-in account or an app
  // with an "unsaved changes" prompt can stall a polite shutdown forever.
  const result = await runCmd(['rpc', 'shutdown', '-f', '-I', String(ip),
    '-t', String(delaySecs), '-C', msg], user, pass);
  if (result.success) {
    adminLog('SHUTDOWN_SENT', `Bay: ${bay.name} | IP: ${ip} | Delay: ${delaySecs}s`);
  } else {
    adminLog('SHUTDOWN_ERROR', `Bay: ${bay.name} | ${result.error}`);
  }
  // the refusal carries its own words (Oct 21 2026): a bare false read "the device did not answer" on the job and the health
  // line whatever the PC said - "did not answer within 30 seconds", a wrong password, a refused connection
  return result.success ? true : { success: false, error: result.error };
}

/** Cancel a pending shutdown */
async function cancelShutdown(bay) {
  const ip   = bay.simulatorPcIp;
  const user = bay.simulatorWinUser || 'Admin';
  const pass = bay.simulatorWinPass || '';

  if (!ip) return false;

  const result = await runCmd(['rpc', 'shutdown', '-a', '-I', String(ip)], user, pass);
  if (result.success) adminLog('SHUTDOWN_CANCELLED', `Bay: ${bay.name}`);
  return result.success;
}

/** TCP probe: is the sim PC alive on the network? Port 445 (Windows file
 * sharing / the same channel net-rpc uses) answers fast when Windows is up. */
function probePc(ip, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!ip) return resolve(null);
    const net = require('net');
    // BA_PC_PROBE_PORT: a battery's stand-in PC (445 needs root to listen on) - never set on a unit
    const sock = net.connect({ host: ip, port: Number(process.env.BA_PC_PROBE_PORT) || 445, timeout: timeoutMs });
    const done = (v) => { try { sock.destroy(); } catch {} resolve(v); };
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error',   () => done(false));
  });
}

/** Restart the sim PC - same proven net-rpc channel as shutdown, -r flag. */
async function sendRestart(bay, delaySecs = 10) {
  const ip   = bay.simulatorPcIp;
  const user = bay.simulatorWinUser || 'Admin';
  const pass = bay.simulatorWinPass || '';
  if (!ip) return false;
  const result = await runCmd(['rpc', 'shutdown', '-r', '-f', '-I', String(ip),
    '-t', String(delaySecs), '-C', 'Restarting - back in a minute.'], user, pass);
  adminLog(result.success ? 'RESTART_SENT' : 'RESTART_ERROR', `Bay: ${bay.name} | IP: ${ip}${result.success ? '' : ' | ' + result.error}`);
  return result.success;
}

/**
 * Wake-on-LAN: send a magic packet to wake a sim PC from soft-off (S5).
 * Standard packet = 6x0xFF followed by the MAC repeated 16 times (102 bytes),
 * UDP-broadcast to 255.255.255.255:9. WOL has no auth (the MAC isn't secret)
 * and only works from inside the LAN; a packet to an already-on PC is a no-op,
 * so this never disturbs an active session. (Ported from pilot facility, Aug 2026.)
 *
 * @param {string} mac - the sim PC's ONBOARD NIC MAC (12 hex chars, any separators)
 * @returns {boolean} true if a packet was sent
 */
function wakePc(mac) {
  const hex = String(mac || '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) { try { adminLog('PC_WAKE_FAIL', `invalid MAC: ${mac}`); } catch {} return false; }
  const macBuf = Buffer.from(hex, 'hex');
  const packet = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
  try {
    const dgram = require('dgram');
    const sock = dgram.createSocket('udp4');
    sock.once('error', () => { try { sock.close(); } catch {} });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch {}
      sock.send(packet, 0, packet.length, 9, '255.255.255.255', () => { try { sock.close(); } catch {} });
    });
    return true;
  } catch (e) { try { adminLog('PC_WAKE_FAIL', `${mac}: ${e.message}`); } catch {} return false; }
}

module.exports = {
  scrubSecrets, sendShutdown, cancelShutdown, getBayById, probePc, sendRestart, wakePc };
