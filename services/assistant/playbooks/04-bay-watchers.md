# PLAYBOOK: The bay watcher - the program on each bay PC

The bay watcher is the Session Monitor: a small program on each bay's Windows PC. It shows the ending warning before a
session ends and covers the screens with a BAY RESERVED page between sessions. During a session it shows NOTHING until
its warning - there is no timer on the screen, and an owner who expects one will think it is broken. It is built for each
bay by the unit and installed on that bay's PC by the owner (the assistant cannot reach a PC's desktop - it walks the
owner through it). The full recipe is the guide's "Setting Up Your Bay Computers" chapter (guide_chapter "bay
computers"), parts 1 to 5.

## Installing the watcher on a bay PC - "install the popup", "put the watcher on the computers", "the warning program"

bay_watcher_download builds that bay's watcher - one zip per bay, never another bay's - and the chat shows the download.

Walk the owner through, for one bay at a time, waiting for each step:
1. First the things built INTO the watcher, so it is not built twice: the website's domain, the logo, and the website's
   hero photo (it sits behind the reserved screen). Set them before building.
2. The PC is prepared (part 1 of the chapter): the ADMIN and PLAYER accounts, the PC signing itself in, remote shutdown
   allowed, a fixed address. The PC's address and the ADMIN account's Windows user: bay_pc_signin_set (the owner types the
   password in the chat's own private box), and the wake ID with bay_pc_link - or on the bay's page in Admin > Bays &
   Devices (Simulator PC IP, the Windows user and password), then Save All Bays.
3. Python 3 from python.org, with "Add Python to PATH" checked and, under Customize installation, "Install Python for
   all users" ticked - the player account runs the watcher.
4. Admin > Bays & Devices > that bay > Build Session Monitor: a zip made for that exact bay. Copy it to that bay's PC
   (a USB stick works) and unzip it. Each bay has its own zip: never install one bay's on another bay's PC.
5. Take out any OLDER auto-start of a bay watcher first - ours or anyone's - in four places: Task Scheduler, the Startup
   folders (the user's own and All Users), Settings > Apps > Startup, and launchers such as AutoStart.
6. Right-click install-monitor.bat > Run as administrator. Then RESTART the PC.
7. Prove it (part 4): a test booking a few minutes out - the PC boots and signs itself in with no login screen; at the
   warning minutes before the end the warning appears; after the session the PC shuts down cleanly before the plug goes
   off. With nothing booked in the next 10 minutes, the PC shows the BAY RESERVED screen.

## What the watcher shows - "what does the popup do", "the reserved screen", "the QR code"

- During a session: nothing, until the warning.
- The warning at "Watcher warning (minutes before end)" - Admin > Settings > Devices > Shutdown & Warning Timing, 10 by
  default (changing it needs no rebuild). When the bay is free after, it shows the minutes left and a QR code to add
  time from a phone; when the next group is booked right after, a plain "please wrap up" with no QR. Once per session
  (again if staff add time). It never takes the keyboard from the game; it closes with its red X, Close, or a click then
  Esc, and by itself after two minutes.
- Between sessions: a BAY RESERVED page on every screen, with the next start time and a booking QR. It lifts 10 minutes
  before the next booking. Staff hide it with Ctrl+Shift+F12 (until the next session).
- The same Settings > Devices card: Enable Auto-Shutdown, "Restart the PC before the next group" (on by default), "Keep
  the bay on between groups (minutes)" (30 by default), and how long Bay Off waits for the PC (90 seconds).

## The watcher isn't working - "the popup doesn't show", "two popups", "old popup", "reserved screen stuck"

- No warning and no reserved screen ever: run install-monitor.bat again as administrator, then restart the PC. If
  warnings stopped after a Windows Python update: on the PC run py -m pip install requests Pillow, then restart.
- Still the old popup after reinstalling: restart the PC. Still old after that: an older auto-start is in the way
  (step 5's four places).
- Two popups at once, or two reserved screens: an older auto-start is still on the PC - remove it, keep ours, restart.
- The X or Close runs off the screen: that PC's watcher is older than the fix - rebuild and reinstall it.
- Reserved screen stuck on: Ctrl+Shift+F12 on that PC's keyboard.
- The PC never shuts down: the ADMIN password must not be blank, and the IP, user and password on the bay must match the
  PC exactly.
- The PC does not sign itself in: the watcher never starts (part 1, automatic sign-in).

## When to rebuild a watcher - "do I need to reinstall the watcher?", "after an update", "I changed my logo"

The watcher carries some things inside it, made when it was built: the logo, the website's hero photo, the domain (its QR
codes), the business name, the bay's name, and the unit's own network address. Rebuild and reinstall it on every bay PC
(Build Session Monitor, copy, take out older auto-starts, run the installer as administrator, restart) when:
- an update's notes say the bay watcher changed - an update never changes a bay PC by itself;
- the logo, the website's hero photo, the domain, the business name or a bay's name changes;
- the unit moves to a new network address (a new router, or the spare swapped in).
The warning minutes are not built in: they change at once from Settings > Devices.
