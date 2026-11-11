// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// ═══════════════════════════════════════════════════════════════════════════════
//  services/monitor-builder.js — Builds the per-bay Session Monitor package
//
//  Assembles a ready-to-run, zero-edit package for one bay:
//    - session-monitor.py  (template filled: bay identity, URLs, timing, and
//                           base64-embedded QR codes + logo — nothing to edit)
//    - install-monitor.bat (creates folder, installs Python deps, registers the
//                           Task Scheduler task, starts it)
//    - README.txt          (plain-language install + troubleshooting)
//
//  QR codes are generated HERE on the Pi (qrcode npm package) with the proven
//  scannable-from-across-the-room parameters, so the bay PCs never need a QR
//  library. The logo comes from the facility's uploaded logo if present.
// ═══════════════════════════════════════════════════════════════════════════════

const fs      = require('fs');
const path    = require('path');
const QRCode  = require('qrcode');
const { getConfig } = require('./config');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'session-monitor.py.template');
const UPLOADS_DIR   = path.join(__dirname, '..', 'public', 'uploads');

// Proven QR parameters: High error correction + wide quiet zone is the
// difference between "camera ignores it" and "instant scan" off a TV.
const QR_OPTS = { errorCorrectionLevel: 'H', scale: 12, margin: 5 };

// The facility's public base URL: prefer the SEO domain, fall back to a LAN
// address so the package still works pre-domain.
function baseUrl(cfg) {
  const d = (cfg.seo?.domain || '').trim().replace(/\/+$/, '');
  if (d) return d.startsWith('http') ? d : `https://${d}`;
  return `http://${getLanIp()}:${cfg.server?.port || 3001}`;
}

// THE WATCHER CALLS THE UNIT ON THE LAN, NEVER THROUGH THE INTERNET (Sep 25 2026, the
// pilot facility handoff section 4). SERVER_URL used to be the public domain whenever one was set,
// so every bay PC's poll went out to the internet and came back in through the tunnel -
// counted against the facility's ONE public address with every guest phone on its Wi-Fi.
// When that ran out the watcher got a 429, showed no end-of-session popup and logged
// nothing. The QR codes stay on the public address: those are for customers' phones.
function lanBase(cfg) { return `http://${getLanIp()}:${cfg.server?.port || 3001}`; }

// The unit's own address on the facility's network: a private (RFC 1918) address
// first, so a VPN or container interface listed ahead of eth0/wlan0 is never chosen.
function getLanIp() {
  try {
    const nets = require('os').networkInterfaces();
    const all = [];
    for (const name of Object.keys(nets)) for (const net of nets[name]) if (net.family === 'IPv4' && !net.internal) all.push(net.address);
    const priv = all.find(a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a));
    if (priv || all[0]) return priv || all[0];
  } catch {}
  return '127.0.0.1';
}

// Find the uploaded facility logo (any image named logo.*) and return base64.
function logoB64() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return '';
    const f = fs.readdirSync(UPLOADS_DIR).find(x => /^logo\.(png|jpg|jpeg|webp)$/i.test(x));
    if (!f) return '';
    return fs.readFileSync(path.join(UPLOADS_DIR, f)).toString('base64');
  } catch { return ''; }
}

// THE FACILITY'S PICTURE BEHIND THE RESERVED SCREEN (maintainer, Oct 2 2026): "bay reserved. With a picture of the
// facility picture. Like the Hero or whatever we have." The website's first hero photo - its 1600-wide JPEG
// rendition (services/siteimages, made for phones, small enough to carry inside the script), or the photo
// itself when it is a small JPEG or PNG. No hero photo, a video hero with no poster, or one too big: the
// reserved screen stays plain, as it always was. Only a file under public/uploads/landing is ever read.
const HERO_MAX_BYTES = 900 * 1024;
function heroB64() {
  try {
    const row = require('./db').db.prepare(`SELECT value FROM website_content WHERE key = 'hero'`).get();
    const h = row ? JSON.parse(row.value) : null;
    const isOurs = x => typeof x === 'string' && /^\/uploads\/landing\/[^/]+\.(jpe?g|png|webp)$/i.test(x);
    const src = (h && Array.isArray(h.images) && h.images.find(isOurs)) || (h && isOurs(h.poster) ? h.poster : '');
    if (!src) return '';
    const landing = path.join(__dirname, '..', 'public', 'uploads', 'landing');
    const orig = path.join(landing, path.basename(src));
    const cands = [orig.replace(/\.(jpe?g|png|webp)$/i, '.w1600.jpg')];
    if (/\.(jpe?g|png)$/i.test(orig)) cands.push(orig);
    for (const f of cands) {
      try { const st = fs.statSync(f); if (st.isFile() && st.size > 0 && st.size <= HERO_MAX_BYTES) return fs.readFileSync(f).toString('base64'); } catch {}
    }
    return '';
  } catch { return ''; }
}

// Safe display of the site URL (no scheme) under QR codes.
function displayUrl(url) { return url.replace(/^https?:\/\//, ''); }

// Build the filled monitor script + companion files for one bay.
// Returns { files: [{name, content}], filenameSafeBay }.
async function buildPackage(bayId) {
  const cfg = getConfig();
  const bay = (cfg.bays || []).find(b => b.id === bayId);
  if (!bay) throw new Error('Bay not found');
  if (!fs.existsSync(TEMPLATE_PATH)) throw new Error('Monitor template missing on this device');

  const base    = baseUrl(cfg);   // the public face - the QR codes and the address shown under them
  const lan     = lanBase(cfg);   // what THIS program polls: the unit on the facility's own network
  // NOT A PACKAGE THAT POLLS ITSELF (Oct 3 2026, the Sep 25 review's leftover): with no network address the unit baked
  // 127.0.0.1 into the watcher - on the bay PC that is the bay PC, so it showed nothing, and nothing said why at build
  // time. With a website address set the watcher still has the public way in; without one, the build stops and says so.
  if (/^http:\/\/127\./.test(lan) && !(cfg.seo?.domain || '').trim())
    throw new Error('This unit has no address on your network right now, so a monitor built now could not reach it. Connect the booking system to your network (cable or Wi-Fi), then build again.');
  const bizName = cfg.server?.businessName || 'Booking System';

  // Both QRs point at /book, which serves the booking app in BOTH homepage
  // modes (booking-as-homepage and landing-as-homepage) — so monitor packages
  // never need rebuilding when the owner flips their homepage.
  const [qrBay, qrGeneric] = await Promise.all([
    QRCode.toBuffer(`${base}/book?bay=${encodeURIComponent(bay.id)}`, QR_OPTS),
    QRCode.toBuffer(`${base}/book`, QR_OPTS)
  ]);

  const warnMins = Number(cfg.monitor?.warnMins);
  const monitorConfig = {
    serverUrl:     lan,
    // the public address as a FALLBACK only (Sep 25 2026, the Monday review): a watcher
    // built with the LAN address alone went silent for good the day the unit's address
    // changed or a spare was swapped in; now it falls back to the domain until rebuilt
    fallbackUrl:   (cfg.seo?.domain || '').trim() ? base : '',
    bayId:         String(bay.id),
    bayName:       String(bay.name || bay.id),
    siteUrl:       displayUrl(base),
    warnMins:      Number.isInteger(warnMins) && warnMins >= 3 && warnMins <= 60 ? warnMins : 10,
    qrBay:         qrBay.toString('base64'),
    qrGeneric:     qrGeneric.toString('base64'),
    logo:          logoB64(),
    hero:          heroB64(),
    businessName:  String(bizName),
    // its own key for the bay's routines (services/routines.js): only its hash is kept on the unit, the newest
    // three per bay, so a second download does not strand the watcher already installed
    bayKey:        (() => { try { return require('./routines').mintKey(bay.id); } catch { return ''; } })()   // no key: the watcher runs no routines
  };

  // Only base64 bytes enter Python source. The monitor decodes the JSON as data.
  const encoded = Buffer.from(JSON.stringify(monitorConfig), 'utf8').toString('base64');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const script = template.replace('{{CONFIG_B64}}', encoded);
  if (script === template || script.includes('{{')) throw new Error('Monitor template has invalid placeholders');

  const safeBay = (bay.name || bay.id).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

  // The Windows installer is static and may run with administrator privileges.
  const installBat = `@echo off
setlocal DisableDelayedExpansion
REM ============================================================
REM  Session Monitor installer
REM  Run this ON the bay PC, as the ADMIN account,
REM  by right-clicking and choosing "Run as administrator".
REM ============================================================
echo.
echo Installing Session Monitor...
echo.

if not exist "C:\\SessionMonitor" mkdir "C:\\SessionMonitor"
copy /Y "%~dp0session-monitor.py" "C:\\SessionMonitor\\session-monitor.py" >nul
if errorlevel 1 ( echo ERROR: could not copy the script. & pause & exit /b 1 )

py --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python not found. Install Python 3 from python.org first:
  echo CHECK the "Add Python to PATH" box, choose Customize installation, and tick
  echo "Install Python for all users" - the player account runs this monitor. Then run this again.
  pause & exit /b 1
)

REM A FAILED LIBRARY INSTALL DOES NOT STOP THE INSTALL (Oct 3 2026): it used to say "Python not found" and quit,
REM so a bay PC with no internet got no watcher at all - and the watcher runs without these libraries and
REM installs them itself once it can.
echo Installing Python libraries (requests, Pillow)...
py -m pip install --quiet requests Pillow
if errorlevel 1 (
  echo NOTE: the Python libraries could not be installed right now - no internet on this PC?
  echo The monitor runs without them and installs them itself once it can. Carrying on.
)

echo Registering the monitor to start at EVERY sign-in...
REM The old Task Scheduler approach only fired for the account that installed
REM it - on a two-account bay PC (admin installs, PLAYER auto-signs-in) the
REM monitor never started. A launcher in the ALL-USERS Startup folder runs for
REM whichever account signs in; pyw runs it with no console window; the
REM monitor's own single-instance guard stops doubles.
schtasks /Delete /F /TN "Session Monitor" >nul 2>&1
(
  echo Set sh = CreateObject^("WScript.Shell"^)
  echo sh.Run "pyw C:\\SessionMonitor\\session-monitor.py", 0, False
) > "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp\\SessionMonitor.vbs"
if errorlevel 1 ( echo ERROR: could not write the startup launcher. Run this installer as administrator. & pause & exit /b 1 )

echo Stopping a monitor that is already running, if any...
REM A copy already running keeps the OLD version until the PC restarts - the new copy sees it and
REM steps aside (one per bay, by its mutex). Stop it first, so the new one takes over now
REM (Oct 2026). Only the session monitor's own script is matched; nothing else is touched.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'Name=''pythonw.exe'' OR Name=''python.exe''' | Where-Object { $_.CommandLine -like '*SessionMonitor*session-monitor.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting the monitor now...
start "" pyw C:\\SessionMonitor\\session-monitor.py

echo.
echo Done. Session Monitor is installed on this PC.
echo The monitor starts automatically whenever ANY account signs in.
echo.
pause
`;

  const readme = `SESSION MONITOR — ${bay.name}
${bizName}
============================================================

THIS PACKAGE IS FOR ONE SPECIFIC BAY: ${bay.name}
Do not install it on a different bay's PC — build a separate
package for each bay from the admin panel.

WHAT IT DOES
  - Shows a warning on screen before a customer's session ends
    (with a scan-to-add-time QR code when the bay is free after)
  - Shows a "BAY RESERVED" screen with a booking QR between sessions
  - Staff: press Ctrl+Shift+F12 to dismiss the reserved screen
    (it stays off until the next session starts)

INSTALL (on the bay PC, signed in as the ADMIN account)
  1. If Python is not installed yet: download Python 3 from
     python.org/downloads and run the installer. IMPORTANT: check
     the "Add Python to PATH" box, then choose "Customize
     installation", Next, and tick "Install Python for all users"
     before Install. The player account signs in on its own and
     runs this monitor, so Python must be there for every account,
     not only the admin.
  2. If this PC ever ran a bay watcher before (ours or anyone's),
     remove whatever starts it first: Task Scheduler, the Startup
     folders (the account's own and All Users), the Startup apps
     list in Windows Settings (Apps, then Startup), and launchers
     such as AutoStart.
  3. Right-click install-monitor.bat and choose
     "Run as administrator".
  4. Restart the PC. From then on the monitor starts whenever ANY
     account signs in - including the player account. During a
     session it shows nothing until the ending warning (there is
     no timer); between sessions it shows the BAY RESERVED screen.

MAKE THE PC SIGN ITSELF IN (no login screen - essential for an
unstaffed facility, so a power blip never leaves a dead bay)
  Do this signed in as the PLAYER account:
  1. Windows 11 first: Settings > Accounts > Sign-in options >
     turn OFF "For improved security, only allow Windows Hello
     sign-in..." (if this stays on, the checkbox in step 3 is
     hidden). Also remove any PIN from the player account.
  2. Press Windows+R, type  netplwiz  and press Enter.
  3. Select the PLAYER account, UNTICK "Users must enter a user
     name and password to use this computer", click OK, and type
     the player account's password (or leave blank if it has
     none) to confirm.
  4. Restart to test: the PC should land on the player desktop
     with no login screen, and the monitor comes up on its own.

AUTOMATIC POWER OFF AND RESTART (set up once, separately)

  The on-screen warnings above come from this program. Turning the
  PC OFF at closing time, and the Restart button your staff can
  press, are sent from the booking system itself over your local
  network - not by this program. For those two to work, this PC
  needs to accept them:

    1. This PC must be on the SAME network as the booking system,
       with a fixed IP address. Reserve one in your router so it
       never changes.
    2. Windows: Settings > Network > Advanced network settings >
       Advanced sharing settings. Turn ON "File and printer
       sharing" for your Private network.
    3. The account used must be a LOCAL ADMINISTRATOR with a
       password set. Windows refuses remote shutdown from an
       account with a blank password.
    4. Enter that PC's IP address, username and password in the
       booking system under Admin > Bays & Devices.

  If a Restart press does nothing, one of those four is the cause -
  almost always a blank password or file sharing left off.

CHANGING THE WARNING TIME
  The "minutes before end" warning time is controlled from the
  booking system admin panel — no changes needed on this PC.

IF IT STOPS WORKING
  - This monitor talks to the booking system on your own network at
    ${lan}.${monitorConfig.fallbackUrl ? `
    If that address stops answering, it asks the facility's public
    address (${displayUrl(monitorConfig.fallbackUrl)}) instead until you rebuild it.` : ''}
    Give the booking system (the Raspberry Pi) a fixed address in your
    router so it never changes; if it ever does, download this package
    again from Admin, re-run the installer, then restart this PC (the
    installer stops the copy it finds running; the restart makes sure
    no older copy is left).
  - The monitor heals itself after Windows Python updates (it
    reinstalls its own libraries if an update removed them) and
    restarts itself if it ever crashes. If it is still not
    running, restart the PC — it starts at every login.
  - Manual fallback, in PowerShell on this PC:
      py -m pip install requests Pillow
      pyw C:\SessionMonitor\session-monitor.py
  - To check it is running: Task Manager > Details > look for
    a pythonw process.

REINSTALL / UPDATE
  Build a fresh package from the admin panel any time (for
  example after changing your logo or domain) and run the
  installer again — it replaces the old one cleanly.
`;

  return {
    safeBay,
    files: [
      { name: 'session-monitor.py',  content: script },
      { name: 'install-monitor.bat', content: installBat },
      { name: 'README.txt',          content: readme }
    ]
  };
}

module.exports = { buildPackage };
