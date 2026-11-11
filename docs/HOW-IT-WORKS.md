# How BA Core Community works

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

BA Core Community runs the booking site and facility controls for a simulator venue on a Raspberry Pi 5. Start with your bays, hours, and prices. Add payments, notifications, or equipment controls as your operation needs them. A small staffed venue can use the booking tools and counter without setting up door codes or smart devices.

## A booking from start to finish

1. **A customer chooses a bay and time.** Your booking page shows availability based on your hours, bay settings, and existing reservations or blocks. Pricing and any applicable membership rules come from the settings you entered.
2. **BA Core checks and records the reservation.** If you connect Stripe for online payments, checkout also runs through your Stripe account. Your Pi records the booking and its status. Use Admin or the staff page to manage reservations according to the access you give your staff.
3. **The customer gets the information they need.** With messaging configured, BA Core can send confirmations or reminders. Customers who opt in can receive the supported booking texts. An unattended venue can configure a compatible door integration and test how customers receive an entry code.
4. **The bay is prepared and reset.** You can use scheduled actions to wake a supported bay PC or control configured devices around a session. The [Windows Session Monitor](customer-guides-current/BAY-PC-SESSION-MONITOR.md) can show session information on a bay PC. Test each device and its recovery behavior on site.

## What runs where

| Part | What it does |
| --- | --- |
| Booking Pi | Runs the website, Admin, staff page, scheduling, and enabled automation. Bookings and settings are stored on the Pi. |
| Owner and staff devices | Use a browser. The owner configures the site, rates, memberships, devices, and access. Staff use their assigned sign-in for day-to-day work. |
| Public hostname | An optional Cloudflare Tunnel routes requests from your own domain to the booking Pi. You can get the system working on your local network first. |
| Connected providers | Stripe, Resend, Twilio, and other integrations use credentials from your accounts and receive the information needed to perform the actions you enable. |
| Optional equipment | Supported network devices, a Windows bay PC, or a separate Home Assistant Pi handle the facility-side actions you configure. |

## First day with your own installation

Follow the [Pi installation guide](customer-guides-current/EVERYTHING-ASK-YOUR-AI.md), then make a fictional booking from the customer side. Check that it appears in Admin, blocks the slot, and frees the slot when you cancel. Test your equipment locally. If a provider needs a public HTTPS address for callbacks or review, follow the [domain guide](customer-guides-current/DOMAIN-SETUP.md) and [tunnel guide](customer-guides-current/CLOUDFLARE-TUNNEL.md) before testing that provider. Hold public booking until the intended payment flow passes. BA Core can record bookings while Stripe is disconnected.

Use the [service setup guide](customer-guides-current/SERVICE-SETUP.md) for each optional connection and the [operating guide](customer-guides-current/OPERATING-GUIDE.md) for everyday tasks, backup, and recovery. Store an encrypted backup off the Pi and practice restoring it on a separate installation. Keep backup archives, passphrases, provider keys, and customer details private.

## Make changes yourself

For ordinary settings, start in Admin. [Owner Chat](customer-guides-current/BA-CORE-MCP.md) can draft an hours or base-price change and show what would change before you apply it. Connecting your own Codex or Claude Code client is optional. For code changes, work in a separate checkout and [test with fictional data](customer-guides-current/AI-CUSTOMIZE-CODE.md) before deploying to your facility.

Community is self-service. Use the guides, local logs, and your provider's dashboard to work through setup. Before opening a real facility, complete the checks for your hardware and accounts. The [release review](RELEASE-REVIEW.md) distinguishes the checks that can be run locally from those that need a real Pi, public hostname, or physical equipment.
