# Install the Windows bay Session Monitor

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

The Session Monitor is the watcher that displays **Bay Reserved**, session-ending notices, and booking QR codes on a Windows bay PC. It uses the booking schedule from BA Core. Build one package per bay and install it only on the matching PC.

## 1. Prepare the Pi and bay PC

- Connect the Windows PC to a trusted network that can reach the booking Pi. Wired Ethernet is preferable if you plan to use Wake-on-LAN. Reserve the Pi’s IP address in your router so the monitor can keep finding it. BA Core normally listens on TCP port `3001`.
- From the bay PC, open `http://PI-LAN-IP:3001/admin` in a browser. Replace `PI-LAN-IP` with the Pi’s actual LAN address. Seeing the sign-in page is enough to verify the connection. If it does not open, fix the LAN connection before building the watcher.
- On the Windows PC, install Python 3 for all users with the **Python launcher** and **Tcl/Tk** components. The batch installer calls `py` and `pyw`. With the classic Windows installer, select **Add Python to PATH**, choose **Customize installation**, and select **Install Python for all users**. Verify `py --version` and `py -m tkinter` from PowerShell while signed in as the player account. The second command should open a small test window you can close.

[Python for Windows downloads](https://www.python.org/downloads/windows/) · [Python Windows installation options](https://docs.python.org/3.13/using/windows.html)

## 2. Build and install the package

1. In BA Core, go to **Admin → Bays & Devices**, expand the bay, and save any changes to its name or ID. If you have a public booking domain, confirm **Settings → Local Search & SEO → Domain (when live)** before building so the QR codes go to that address.
2. Click **Build Session Monitor** on the bay card. For a bay called Bay 1, the file is `session-monitor-bay-1.zip`. It contains `session-monitor.py`, `install-monitor.bat`, and a bay-specific `README.txt`. The generated README includes the exact Pi URL built into the package.
3. Copy the ZIP to that bay’s Windows PC and choose **Extract All**. If the PC has an older watcher, remove its startup entry from Task Scheduler, the Windows Startup folders or Startup apps list, or the launcher that starts it. Keep one watcher running per bay PC.
4. Sign in as an administrator. Right-click the extracted `install-monitor.bat` and select **Run as administrator**. The installer copies the script to `C:\SessionMonitor\session-monitor.py`, attempts to install `requests` and Pillow, and registers `SessionMonitor.vbs` in Windows’ all-users Startup folder. A failed download of those libraries does not stop installation. The watcher has a fallback for polling and rendering QR images, and can retry the libraries later. The reserved-screen photo needs Pillow.
5. Restart the PC and sign in with the account that actually runs the simulator. The monitor starts when Windows signs in. It needs a signed-in desktop to display anything. If you choose automatic sign-in for an unattended bay, use a dedicated standard Windows account and test a reboot before relying on it.

The monitor asks the Pi’s LAN address for the bay’s status about every 30 seconds. If a public hostname was present when built, it can fall back to that hostname if the LAN address fails. The QR links use the configured public hostname, or the LAN address when you build without one. A LAN-only QR requires the phone to be on a network that can reach the Pi.

## 3. Know what the screens do

| When | What you should see |
| --- | --- |
| A bay is idle and its next session is more than 10 minutes away, or there is no next session | **BAY RESERVED** on connected displays, a booking QR, and the next start time when available. |
| The next session is within 10 minutes, or a session is underway | The reserved screen clears on a poll. The watcher usually stays out of view during play until the ending warning. There is no permanent on-screen session timer. |
| The warning time arrives and more time fits | A popup shows the remaining minutes and a QR to the bay’s booking page. The customer still has to complete a booking. Availability is checked at checkout. |
| The warning time arrives and more time does not fit | A wrap-up notice with no add-time QR. The booking schedule and closing hours determine whether a slot fits. |

Change the warning in **Admin → Settings → Devices → Shutdown & Warning Timing → Watcher warning (minutes before end)**. The field defaults to 10 minutes and accepts 3–60. The monitor reads the saved timing from BA Core, so a warning-time change alone does not need a reinstall.

- Close an ending popup with its **X**, **Close**, or **Esc** after clicking the popup. It also closes by itself after about two minutes.
- **Ctrl+Shift+F12** dismisses the reserved screen and keeps it down until the next active session resets the override. If another program has that shortcut, click the reserved screen first and press the keys. This is a local staff convenience, not a Windows lock screen or an access-control boundary.

## 4. Test on site before putting the bay into service

1. Reboot and sign in as the player. Check for a `pythonw.exe` process running `session-monitor.py` under **Task Manager → Details**. With no booking due within 10 minutes, look for **BAY RESERVED**. Scan the QR on a phone and check that it opens the intended booking site.
2. Make a fictional reservation. Check that the reserved screen clears shortly before the start and stays clear during play. Near the end, check the add-time prompt with a free following slot. In a separate test, put a booking or closing time immediately after the session to check the wrap-up notice.
3. Keep the Windows PC running after a test session to check the reserved screen again. Press **Ctrl+Shift+F12** to confirm the override, then start another test session to reset it.

Wake-on-LAN, screen display, and remote shutdown are separate functions. **Wake PC (test)** on the bay card checks the PC’s wake support and saved MAC address. BA Core sends optional shutdown and restart commands over the LAN with a suitable Windows account and the Pi’s Samba client. The watcher does not send those commands. Use [the Windows power setup steps](SERVICE-SETUP.md#wake-and-shut-down) to test them separately. Leave the PC’s power supply on for Wake-on-LAN.

## 5. Troubleshoot or reinstall

| Symptom | What to check |
| --- | --- |
| The installer reports Python is missing, or the watcher never starts | On the player account, verify `py --version` and `py -m tkinter`. Check the all-users launcher under `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\SessionMonitor.vbs`. For visible errors, run `py C:\SessionMonitor\session-monitor.py` in PowerShell when the existing watcher is stopped. |
| Windows starts but no watcher appears | Sign in. Confirm the launcher is enabled and the Pi URL in the generated README is reachable from the bay PC. During an active session the watcher has no display until the warning. |
| The wrong bay shows, a QR points to the old website, or the Pi’s address changed | Build a new package from the correct bay card, extract it, run the installer as administrator again, and restart. Rebuild after changes to the bay ID or name, public domain, Pi address, business name, logo, hero image, or watcher software. |
| The QR or photo is missing | Confirm the page renders at the current Windows display scaling. Check Python’s Pillow package for photo support. An add-time QR is omitted when there is no eligible slot. |
| The PC will not wake or shut down | Verify those controls independently in the [Windows power setup steps](SERVICE-SETUP.md#wake-and-shut-down). Reinstalling the watcher does not change Windows wake support, shutdown credentials, or firewall rules. |

The generated package contains site-specific settings, images, and booking URLs. Keep it private. It needs no separate watcher key or Windows shutdown password. Enter optional shutdown credentials only in the owner’s BA Core bay settings. Keep the monitor on the bay’s ordinary Windows account after installation. For internet access, follow the [Cloudflare Tunnel guide](CLOUDFLARE-TUNNEL.md) and keep Windows management ports off the public internet.
