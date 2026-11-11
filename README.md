# BA Core Community

**Build your booking website, run your counter, and automate your simulator bays from a Raspberry Pi 5.**

Built by **BA Custom Products LLC**, a veteran-owned golf simulator hardware and software shop in Thief River Falls, Minnesota. [bacustomproducts.com](https://www.bacustomproducts.com/)

[Download the Pi 5 installer](https://github.com/DiyGolfGuy/ba-core-community/raw/refs/heads/main/ba-core-pi5-arm64.tar.gz) · [First-time install guide](docs/customer-guides-current/EVERYTHING-ASK-YOUR-AI.md) · [Try the sandbox](https://babookingsandbox.com/?tour=1)

BA Core Community is a self-hosted booking, POS, website builder, and facility automation platform for Raspberry Pi 5. It is designed for staffed, unstaffed, and hybrid simulator facilities. Your installation starts blank, and you set the hours, rates, rules, and equipment that fit your venue.

> **Community release, as is.** This build includes the Pi 5 installer, the Assistant, and hosted Owner Chat. Core workflows and simulated provider connections passed local tests; the installer’s upgrade path and the features added from the AI edition have automated coverage but have not yet been run on a Pi. The [release checklist](docs/RELEASE-REVIEW.md) also covers commissioning with your own accounts and equipment.

## See it in action

The [BA Booking Sandbox](https://babookingsandbox.com/) is a fictional facility. Take the [guided tour](https://babookingsandbox.com/?tour=1) to see the customer booking flow, the staff counter, and owner settings. The sandbox also previews **BA Core 2 AI**, the separate paid edition that runs AI locally on the AIX1.

## What BA Custom Products makes

| Offering | What it covers |
| --- | --- |
| Golf simulator controls | Hand-built V2.5 wireless control boxes, SimMarshal Bluetooth controls, and the six-button Companion for touchscreen setups. [Control boxes](https://www.bacustomproducts.com/control-boxes) |
| Free bay software | BA BayLauncher organizes a bay's apps into game cards. BA Remapper maps control-box buttons to on-screen actions. ProTee AutoStart helps start GSPro and ProTee VX together. |
| Facility software | BA Core Community is the self-service Pi 5 edition. The upcoming BA Core 2 AI adds on-site AI for building the website and running the facility. |
| Custom shop services | Club building and regripping, 3D printing and scanning, laser engraving, and personalized products. |

[See products, downloads, and shop services](https://www.bacustomproducts.com/)

## What you can run

| Area | What it does |
| --- | --- |
| **Website builder** | Build a site with your logo, photos, colors, style presets, and fonts. Edit the layout, build pages from sections, set navigation, and preview the result. Show your live menu, specials, and packages, make a flyer for a deal or event, and send a newsletter to your email sign-ups. Choose which sections go public and link directly into booking and memberships. |
| **Point of sale** | Staff can check in a reservation, create a walk-in booking or tab, ring up food and drinks, and settle the bill using the payment options you enable. Configure menu items, tax codes, counter specials that change the price on a schedule, and routing to supported receipt or kitchen printers. |
| **Booking and memberships** | Let customers reserve bays online. Set availability, rates, per-day hours, and membership rules in Admin. Run booking deals (“last 30 minutes free on Tuesdays”), packages that bundle bay time with food at one price, and door-check discount codes. Connect your own Stripe account if you want to take online card payments. |
| **Facility and bay automation** | Run compatible Shelly plugs, Home Assistant switches or thermostats, BroadLink IR devices, and bay PCs around bookings. Configure each bay’s lead times, off delays, and the keep-on gap between groups. Put shared equipment such as the heat or a lounge TV on the whole facility’s schedule, pair Home Assistant devices from Admin, and find bay PCs and plugs with a network scan. |
| **Door access** | Issue booking PINs through RemoteLock, a compatible UniFi Access console, or a Z-Wave keypad lock managed by Home Assistant on a separate Pi. |
| **Windows bay watcher** | Build a **Session Monitor** package for each bay PC. It can show the reserved screen, session-ending warnings, and an add-time QR code when the next slot is free. Teach it **bay routines** (a sequence of clicks and keys shown once on that PC) to run when a session starts or from the staff pad. The watcher handles the screen. BA Core schedules the bay’s power and equipment. |
| **Owner controls** | Manage bookings and settings, check service and device status, read period-over-period insights and a tax export, and download an encrypted backup. Connect your own OpenAI or Claude key and run the place by talking in the **Assistant**: every change comes back as a card you approve. |

## Use your own AI

BA Core Community has no AI model inside it. You connect the one you already use.

- **The Assistant** (the button at the top of Admin) is a chat beside a live view of your site and screens. Plain requests such as “add Root Beer for $3 to Drinks,” “we’re closed Mondays,” or “take me to the schedule” are read by BA Core itself and work before you connect anything. For longer or looser requests it uses the OpenAI or Claude model you connect, with about 285 typed actions across the menu, website, bookings, members, staff, bays, messages, and money. Each change is shown as a card and nothing happens until you approve it with your own sign-in.
- **Owner Chat** holds the connection. Choose **Hosted AI settings** to pick OpenAI or Claude, a model your API account can use, and how hard it thinks. The key is stored in a private file on the Pi, outside your settings and backups, and is never typed into a chat. **Continue setup** and **Ask locally** work with no AI connected.
- **Codex and Claude Code** connect over private SSH. They can search and read the installed guides, check service health, and prepare any Assistant action as one line you paste into the Assistant to review and approve.

Customers are shown to a hosted model by first name and last initial only; phone numbers, email addresses, door codes, and PINs are never sent. [Owner Chat, the Assistant, and AI connections](docs/customer-guides-current/BA-CORE-MCP.md)

## Start with one bay

1. Image a Pi 5 with **Raspberry Pi OS Lite (64-bit)**. Enable SSH in Raspberry Pi Imager and connect the Pi to your local network.
2. Use the BA Core Pi installer tarball and its matching SHA-256 file. From Windows PowerShell or a macOS or Linux terminal, copy both files to the Pi with `scp`. Sign in with SSH, verify the checksum, extract the archive, and run `sudo bash ./install.sh` from the extracted `ba-core` directory.
3. Open the private SSH forward from a second terminal on your computer. Leave it open while you visit `http://127.0.0.1:33001/setup` in your browser and create your owner password.
4. After setup restarts the service, sign in to Admin on the local network and choose **Getting Started → Walk me through setup**. Configure one bay and make a fictional booking. Keep customer booking held until you’ve tested the payment and access flows you intend to use. BA Core can record a reservation without charging when Stripe is disconnected.
5. Add equipment, provider accounts, and public access as needed. Use your own domain and Cloudflare account if you want a public hostname.

The Pi 5 installer includes the Assistant, Owner Chat, the optional OpenAI and Claude connection, the complete owner manual, and nine shorter guides. The first-time install guide gives the exact terminal commands, browser addresses, and checks for each step.

To move to a newer release later, run the new release’s installer on the same Pi. It keeps your settings, bookings, and files, and puts the earlier version back if the new one does not start. [Upgrade to a newer release](docs/customer-guides-current/OPERATING-GUIDE.md#upgrade-to-a-newer-release)

[Pi 5 installer](https://github.com/DiyGolfGuy/ba-core-community/raw/refs/heads/main/ba-core-pi5-arm64.tar.gz) · [SHA-256 checksum](https://github.com/DiyGolfGuy/ba-core-community/raw/refs/heads/main/ba-core-pi5-arm64.tar.gz.sha256) · [First-time install guide](docs/customer-guides-current/EVERYTHING-ASK-YOUR-AI.md)

## Find your guide

| I want to… | Start here |
| --- | --- |
| Understand what happens before, during, and after a booking | [How BA Core works](docs/HOW-IT-WORKS.md) |
| Look up any feature or setting, or hand the whole reference to an AI | [The complete owner manual](docs/customer-guides-current/OWNER-MANUAL.md) |
| Install from a blank Pi or ask an AI to guide me | [First-time install and Ask Your AI](docs/customer-guides-current/EVERYTHING-ASK-YOUR-AI.md) |
| Set up the website or run the POS | [Website and counter operations](docs/customer-guides-current/OPERATING-GUIDE.md) |
| Configure receipt printers, kitchen tickets, or a Stripe reader | [Counter equipment](docs/customer-guides-current/SERVICE-SETUP.md#stripe-terminal) |
| Install the watcher on a Windows bay PC | [Session Monitor installation](docs/customer-guides-current/BAY-PC-SESSION-MONITOR.md) |
| Choose my domain and make booking available outside the facility | [Domain setup](docs/customer-guides-current/DOMAIN-SETUP.md) and [Cloudflare Tunnel](docs/customer-guides-current/CLOUDFLARE-TUNNEL.md) |
| Connect Stripe, email, or SMS | [Services and equipment](docs/customer-guides-current/SERVICE-SETUP.md) |
| Set up a RemoteLock or UniFi Access door | [RemoteLock and UniFi Access](docs/customer-guides-current/SERVICE-SETUP.md#remotelock-or-unifi-access) |
| Use Home Assistant on a separate Pi or set up a local Z-Wave lock | [Home Assistant and Z-Wave](docs/customer-guides-current/HOME-ASSISTANT-SECOND-PI.md) |
| Set up Shelly or test bay and shared facility automation | [Shelly setup](docs/customer-guides-current/SERVICE-SETUP.md#direct-shelly-power) · [Automation checklist](docs/customer-guides-current/OPERATING-GUIDE.md#automate-a-bay-around-bookings) |
| Use Owner Chat, connect Codex or Claude Code, or change the code | [Owner Chat and AI connection](docs/customer-guides-current/BA-CORE-MCP.md) and [Customize the source](docs/customer-guides-current/AI-CUSTOMIZE-CODE.md) |

Open **Guides** in Admin for printable PDFs and Markdown copies you can share with your AI assistant. [Ask Your AI PDF](docs/customer-guides-current/EVERYTHING-ASK-YOUR-AI.pdf) · [All owner guides](docs/customer-guides-current/)

## Self-service setup

Community is intended to be a free, self-service edition for operators who install and manage their own system. You supply the Pi and manage your network, accounts, backups, and troubleshooting. BA Core uses the owner password you create during setup. Connected services use your own accounts, and providers can charge for domains, payments, messages, or hosted AI usage.

Start with the guides and **Admin → About → Health**. If you report an issue, include the BA Core version, Pi OS version, the steps you tried, and a redacted error. Use fictional bookings in screenshots and examples.

## Work on the code

Open any source file below on GitHub, use **Go to file** to find a path, or use **Code → Download ZIP** to scan the source locally. Start with the parts you want to review or customize.

| Area | Source |
| --- | --- |
| Server and local storage | [Server entry point](server.js) and [database](services/db.js) |
| Booking and prices | [Booking routes](routes/bookings.js) and [pricing rules](services/pricing.js) |
| Point of sale | [Staff counter screen](public/staff.html) and [staff routes](routes/staff.js) |
| Website builder | [Editor screen](public/admin-website.html) and [website routes](routes/website.js) |
| Booking-driven bay automation | [Scheduler](services/scheduler.js) and [device services](services/) |
| Windows bay watcher | [Session Monitor source](templates/session-monitor.py.template) and [package builder](services/monitor-builder.js) |
| The Assistant and optional AI | [Action catalogue](services/assistant/actions.js), [model connection](services/assistant/model.js), [Local Owner Chat](services/owner-chat.js) and [Codex or Claude Code bridge](mcp/ba-core-mcp.js) |
| Installer and tests | [Pi installer](install.sh), [archive builder](packaging/build-release.sh), [automated checks](test/), and the longer [batteries](batteries/) |

Use a separate Git checkout with fictional data. The [release checklist](docs/RELEASE-REVIEW.md) lists the tested Node version, test commands, and the Linux build steps for the Pi installer. 

## License

BA Core Community is source-available under the [PolyForm Shield License 1.0.0](LICENSE.txt). You may use it, change it, and share it for any purpose, including running your own facility on it, except to provide a product that competes with BA Core or with a product BA Custom Products LLC provides using it. It comes with no warranty and no support. Third-party components keep their own licenses.
