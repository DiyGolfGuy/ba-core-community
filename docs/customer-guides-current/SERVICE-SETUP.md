# Connect payments, messaging, doors, and bay equipment

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

This guide starts after BA Core is installed and you can sign in to Admin. Set up only what you need. Work on one provider or bay at a time and verify each result before opening bookings. Examples such as `book.example.com`, Demo Bay, and a test lamp are fictional. Replace the example domain with your actual booking hostname before configuring a provider. Use your own accounts and paste credentials only into the corresponding settings. Keep keys, real booking details, and generated bay PC packages out of chat and GitHub.

> **Ask your AI.** Attach this file with the BA Core installation guide. Say which connection you want, where you are in its steps, and the last check that passed. Ask for one next step and an expected result. Share redacted errors only. Refer to the linked provider guide if a dashboard has moved a menu.

| If you want | Start here |
|---|---|
| Payment when a customer books | [Stripe online payments](#stripe-online-payments) |
| Booking and access emails | [Resend email](#resend-email) |
| Optional booking SMS | [Twilio text messaging](#twilio-text-messaging) |
| A smart plug on a local network | [Direct Shelly power](#direct-shelly-power) |
| Shared facility equipment and bay start/end timing | [Automation and commissioning](#facility-and-bay-automation) |
| Automatic PC wake or on-screen session reminders | [Windows bay computers](#windows-bay-computers) |
| Unattended entry with a third-party lock service or console | [RemoteLock or UniFi Access](#remotelock-or-unifi-access) |
| Local Z-Wave keypad access through a second Pi | [Home Assistant and Z-Wave](HOME-ASSISTANT-SECOND-PI.md#set-up-z-wave-booking-pins) |
| Counter, kitchen, and bar tickets | [Counter and kitchen printers](#counter-and-kitchen-printers) |
| Card payments at a staffed counter | [Stripe Terminal](#stripe-terminal) |

For Home Assistant bay devices or a Z-Wave keypad lock on a separate Pi, use the Home Assistant guide instead of the direct device or door instructions below.

## Stripe online payments

### Start in a sandbox

1. Sign in to your Stripe Dashboard and select or create a **Sandbox**. Open **Workbench → API keys**. Get the publishable and secret keys from the **same** sandbox. Test keys start with `pk_test_` and `sk_test_`.
2. In BA Core, open **Admin → Settings → Connections → Stripe – Payments**. Enter the key pair and **Save Settings**. Use the standard Stripe secret key for this release. BA Core currently validates this format and uses it for more than checkout, including membership and webhook setup. Treat it as a high-privilege credential. Look for **TEST MODE** in Admin.
3. If testing from outside, set your real bare HTTPS site origin in BA Core's **Local Search & SEO** settings and verify that the Cloudflare hostname serves the app over cellular. Use an origin such as `https://book.example.com` without `/book` or another path. Keep access to test bookings under your control. Do not accept real customer reservations while using test keys.
4. Book a fictional session using Stripe's published test card `4242 4242 4242 4242`, a future expiry, and any valid-format CVC. Confirm that Stripe lists a successful payment **in the same sandbox**, that BA Core lists a paid booking for the correct bay and amount, and that the intended confirmation arrived. Try Stripe's published decline card too. The declined checkout should not leave a paid booking.
5. Cancel the successful test booking as permitted by your rules. Verify the slot becomes available and verify the refund in Stripe if the cancellation calls for one. If you sell recurring memberships, make a sandbox membership purchase and check that its membership state and associated event delivery work.

[Stripe testing and test cards](https://docs.stripe.com/testing) · [Stripe API keys](https://docs.stripe.com/keys)

### Verify the webhook

Stripe sends payment, refund, membership, and Terminal notifications back to BA Core. The endpoint is `https://YOUR-BOOKING-HOST/api/stripe/webhook`. Stripe should be able to reach that endpoint without a browser login or a Cloudflare challenge. BA Core validates Stripe's signing secret.

- After saving your public origin and Stripe keys, restart BA Core during an idle window so it attempts webhook registration. In **Stripe Workbench → Webhooks**, select the same sandbox and confirm a destination for your BA Core endpoint exists. Use a dedicated hostname for this instance. BA Core manages endpoints at its exact URL and can replace duplicates. Check for an existing destination before manually adding one.
- Open a relevant event delivery in Stripe and check for a successful HTTP response after an actual test checkout, membership payment, or refund. Verify the expected outcome in BA Core too. Successful delivery alone does not prove the event did what you intended.
- If you deliberately set up a manual webhook, use the event set supported by your BA Core release and enter that endpoint's signing secret in **Stripe – Payments → Webhook Secret**. This base handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `terminal.reader.action_failed`, `charge.refunded`, `refund.created`, `refund.updated`, and `refund.failed`. Match the endpoint's event schema to your release. The base registers events with Stripe API version `2025-03-31.basil`.
- If delivery fails, check the exact URL, public route, Dashboard mode, and signing secret for that destination. The Stripe CLI listener has its own signing secret. An unsigned browser request does not test a signed webhook.

BA Core pins its Stripe API versions so a new SDK or a Dashboard API-version change does not change the request and event formats it uses.

[Stripe webhook setup and delivery](https://docs.stripe.com/webhooks)

### Go live

Complete Stripe's business verification and confirm your bank and payout settings in Stripe. At a quiet time, switch both keys in BA Core to the corresponding live keys from your own account, save, and confirm the Admin badge says **LIVE**. Recheck webhook registration and delivery in **live** mode. If you entered a manual sandbox signing secret, set the corresponding live endpoint's secret before relying on live events. When the site is ready, make a small authorised purchase using a real card, verify the booking and payment, and process a refund if appropriate. Check Stripe and BA Core separately. Keep test and live records distinct.

## Resend email

1. In Resend, open **Domains → Add Domain** and choose a sending domain you control. A dedicated subdomain such as `mail.example.com` keeps this purpose separate from your existing mail setup.
2. Copy the DNS records Resend actually shows into the DNS provider for that domain. If Cloudflare manages your DNS, use its **DNS → Records** page. Check each record's name and value carefully. Preserve the records for any existing mailbox service. Return to Resend and verify the domain before sending.
3. Open **Resend → API Keys** and create a key with **Sending access**, restricted to the selected domain where available. Enter it in **BA Core Admin → Settings → Connections → Resend – Email Notifications → API Key**. Enter **From Email** on the verified sending domain and save. Use a monitored mailbox or forwarding address if you want to receive replies.
4. Enable the notification types you want. Keep the **Door Code** email enabled if customers depend on it for entry. Make and cancel a fictional booking using an inbox you control. Check the received messages and delivery records in Resend. For unstaffed access, test that a customer who leaves SMS unchecked still receives the intended door instructions by email.

[Resend verified domains](https://resend.com/docs/dashboard/domains/introduction) · [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction) · [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)

## Twilio text messaging

These steps cover a **Twilio US local 10-digit sender** texting US recipients. Twilio calls the registration **A2P 10DLC**. Toll-free numbers and short codes have different registration paths. Use your own Twilio account and real business information. BA Core supplies fixed booking opt-in, policy pages, and customer SMS wording. You configure your business identity, notification types, and timing. The sender and campaign still require approval through Twilio’s review process. Keep email working while registration is pending.

### Prepare the booking website and opt-in proof

1. In BA Core, set your customer-facing **Business Name**, the **Legal Entity** that owns it, the facility address, and a monitored support email. Under **Settings → Local Search & SEO**, set **Domain (when live)** to your real public HTTPS origin, such as `https://book.example.com`. Use the legal name exactly as registered with your tax or business authority and match any public-facing DBA to your Twilio profile.
2. On a phone with Wi-Fi off, open `https://book.example.com/privacy` and `https://book.example.com/sms-terms`, using your own hostname. Both must be reachable by reviewers without sign-in. Check that the pages show your real name and contact information and accurately describe the service you will offer. BA Core renders these paths from the shipped copy and your business details. If Cloudflare obfuscates the published support email, check the public page source and configure an exception for the two policy pages so a reviewer can read the address.
3. Open `/book` and proceed to **Your Details & Payment**. Check that the mobile-number field and the optional SMS checkbox appear in this step. The checkbox starts unchecked. The text names your business and explains what will be sent, frequency, possible message and data rates, STOP, HELP, and where to read the terms and privacy policy. The customer can complete the booking with the box unchecked. The checkbox appears when SMS is configured and the public booking flow supports SMS. Members-only booking uses email.
4. For a live, reviewable form, give Twilio the `/book` URL and tell reviewers how to reach **Your Details & Payment**. If the form is still private or behind a login, use the screenshot-proof option described by Twilio. Capture the actual booking step and the resulting confirmation screen in a controlled test using fictional booking details. Share a reviewer-accessible link with private information removed. Confirm the email fallback works before submitting, including how customers get an entry code when SMS is unchecked. Keep real customer messages off during testing and until the sender is approved.

[Twilio’s campaign onboarding guide](https://help.twilio.com/hc/en-us/articles/11847054539547-A2P-10DLC-Campaign-Approval-Best-Practices) · [Twilio’s policy and terms URL fields](https://www.twilio.com/en-us/changelog/-u-s--a2p-10dlc--campaign-registration---privacy-policy---terms-) · [Cloudflare Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)

### Submit your application in the Twilio Console

1. Choose an SMS-capable US local number. In Twilio Console, open **Trust & Compliance → A2P Brands** for Standard or Low-Volume Standard registration. Complete your customer profile and register the Brand type that applies to you. Use the legal name, registration details, address, and contacts requested for that profile. Follow Twilio’s separate Sole Proprietor flow if your account qualifies for it.
2. Open **A2P Campaigns** and create the campaign for your Brand. Use the category available in your account that accurately describes your booking notices. Associate the campaign’s **Messaging Service** and add the same number you plan to enter in BA Core to its **Sender Pool**.
3. Adapt the following examples with your actual business name and hostname. Use the description and samples for the texts you enable. Keep the shipped opt-in and message language in the app and use its actual wording as the basis for your application.

| Twilio field | Example to adapt |
|---|---|
| Campaign description | `[Business Name] sends transactional booking texts to customers who choose SMS updates when reserving a simulator session. Messages include confirmations, reminders, and cancellations. At our self-service facility, we also send door access codes. Frequency varies, typically 2 to 5 messages per booking.` Remove the self-service sentence if it does not apply. List any other enabled booking notifications, such as session-ending reminders, and check that the frequency matches your live form. |
| Message flow or how users consent | `Customers visit https://book.example.com/book, choose a session, and enter their mobile number on Your Details & Payment. They can check a separate, initially unchecked box for SMS updates from [Business Name]. The checkbox is optional. When an opted-in booking completes, the customer receives a booking confirmation text if enabled. Customers can book without SMS and use email instead. Text STOP to opt out or HELP for support.` |
| Primary opt-in method and proof | Choose **Web form**. Provide the exact booking URL or the reviewer-accessible proof link. Describe the checkboxes and the final booking action as they appear on your site. |
| Privacy Policy URL | `https://book.example.com/privacy` |
| Terms & Conditions URL | `https://book.example.com/sms-terms` |

Provide at least two sample messages from your actual booking flow. In **BA Core Admin → Messaging → Texting → Locked SMS Templates**, copy the read-only samples for the notices you enabled. The card renders fictional examples with the same message builders BA Core uses for sending. Twilio asks for the sender name, example placeholders in brackets, and an opt-out instruction. These are staffed-facility examples based on the shipped messages.

> [Business Name]: Booked! [Bay], [Date] [Start Time]. Staff will set you up. Details emailed. Reply STOP to opt out. Msg & data rates may apply.

> [Business Name]: Your [Date] [Start Time] booking is cancelled. Refund if applicable. Reply STOP to opt out. Msg & data rates may apply.

For self-service entry, use the confirmation variant that explains when the code arrives and include a matching example if door texts are enabled. For example, `[Business Name]: Door code [Code]. [Bay] [Start Time], today only. Enter on the keypad. Reply STOP to opt out. Msg & data rates may apply.` Use the actual door wording for your installed provider. Replace `[Business Name]` with the sender name before submission. Use placeholders for customer data, reservation details, and codes. The original opt-in for recurring booking updates is the booking form. Describe **START** as resubscribing after an opt-out, if that is how your sender is configured.

If customers can use phone lookup in **My Bookings**, describe that separate action too. Selecting **Send Verification Code** requests one verification text for access to existing bookings. Include the verification message from **Locked SMS Templates** and show the reviewer the one-time request screen. Customers can use email to access their bookings.

Submit the campaign, watch its status in the Console, and follow any requests for corrections or evidence. Wait for the campaign and sending number to show the approved or verified status applicable to your account. The shipped language helps you describe the flow consistently. Reviewers still assess your business, website, submitted materials, number, and use case. If you later change the sending identity or campaign flow, check Twilio’s current requirements before using the revised setup.

[Twilio A2P 10DLC overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) · [Twilio Console registration quickstart and sample fields](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart) · [Twilio Standard and Low-Volume Standard registration](https://help.twilio.com/articles/52182476727195)

### Connect the number and check STOP, HELP, and START

1. Select the Twilio account that owns the registered number. Find its **Account SID** and **Auth Token** under the Console’s account credentials. In **BA Core Admin → Settings → Connections → Twilio – SMS**, enter those values and the approved **Phone Number** in international format, then save. BA Core sends from that configured number. For a Twilio-only acceptance test, leave the optional backup SMS provider blank.
2. In the Twilio **Messaging Service → Integration** settings, send incoming messages by **HTTP POST** to `https://book.example.com/api/twilio/incoming`, using your own hostname. If the service is configured to defer to the sender’s webhook, set the same URL and method in the sending number’s inbound message configuration. Use one effective route. BA Core verifies Twilio’s signature, so use the exact public HTTPS endpoint and keep the webhook accessible without a browser login or challenge.
3. If you enable **Advanced Opt-Out** in Twilio, use replies that match your booking program. Adapt these examples with your public business name and monitored support contact. Twilio sends its own configured reply for matched keywords and tells BA Core which keyword matched. BA Core records the change and avoids a duplicate reply.

   | Keyword | Example reply |
   |---|---|
   | STOP | `[Business Name]: You are unsubscribed from booking texts and will get no more. Reply START to resubscribe.` |
   | HELP | `[Business Name]: For help with booking texts, contact [Support phone or email]. Reply STOP to unsubscribe. Msg & data rates may apply.` |
   | START | `[Business Name]: You are resubscribed to booking texts. Reply HELP for help, STOP to unsubscribe. Msg & data rates may apply.` |

4. From the real booking form, make one test booking with the box unchecked and one with it checked, using a mobile number you control. Check that only the opted-in booking produces its booking text and that email works for both. Reply **HELP** and check the support details. Reply **STOP**, then verify the opt-out in Admin and that a later booking notification to that number is suppressed. Reply **START** and verify an eligible, opted-in test booking can receive texts again. Cancel test bookings in BA Core. STOP controls texts while the booking remains on the calendar.

If a keyword reply reaches the phone but BA Core records no opt-out, check the signed inbound delivery in Twilio’s Debugger. Match the full public HTTPS URL, confirm the selected account’s token, and check whether the Messaging Service or the sender owns the effective webhook. If Twilio reports `21610`, the recipient has opted out. Let the recipient resubscribe from their handset before you retest.

[Twilio account credentials](https://help.twilio.com/articles/223136027-Auth-Tokens-and-How-to-Change-Them) · [Twilio Messaging Services and incoming webhooks](https://www.twilio.com/docs/messaging/services) · [Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out) · [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security) · [Twilio Debugger](https://www.twilio.com/docs/usage/troubleshooting/debugging-your-application) · [Twilio error 21610](https://www.twilio.com/docs/api/errors/21610)

## Direct Shelly power

1. Use a Shelly plug that suits your region and equipment. Pair it using the model's instructions and join it to the private equipment network. Use a test lamp first. Check the plug's local control page or app before relying on its schedule.
2. Find the plug's IP in the device settings or router and reserve it in DHCP. Keep the control address reachable from BA Core and separate from guest Wi-Fi. Direct BA Core control does not send a Shelly login password. If your network policy requires device authentication, keep it enabled and use a supported intermediary such as your separate Home Assistant setup.
3. Open **Admin → Bays & Devices → your bay → Shelly Devices → Add Device**. Enter a name such as **Bay 1 Test Lamp**, the reserved IP, and the generation. Select **Gen 1** for its relay interface or **Gen 2 / 3 / 4** for compatible switch RPC devices. Set **Minutes Before T-Time**, **Auto Turn Off**, and **Turn Off After (minutes)**, then **Save All Bays**.
4. Test the plug's row **On** and **Off** with the lamp, then make a test booking. Check the lead time, what happens after a session, and any shared gap rules. If testing a network drop, use the lamp and look at **About → Health → Automation** and the **Log** for disconnect and recovery.
5. For a Wake-on-LAN PC, leave the PC's power supply energised. Use **No – leave on** for that PC's plug. Configure the plug's power-on behaviour after an outage deliberately. A plug supplying a WOL PC has to come back on for the PC to receive a wake packet. Use the bay's normal shutdown sequence for a running PC.

[Shelly local control example](https://kb.shelly.cloud/knowledge-base/shelly-plus-plug-us-web-interface-guide) · [Shelly switch RPC](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/) · [Shelly authentication](https://shelly-api-docs.shelly.cloud/gen2/General/Authentication/)

## Facility and bay automation

Use **Bays & Devices** to assign equipment and set each device’s lead and off delay. Use **Settings → Devices → Shutdown & Warning Timing** for the keep-on gap between bookings, manual Bay Off wait, and Windows watcher warning. Use a second Pi running Home Assistant for devices you already manage there, including compatible climate entities. Use **Door Access Provider** for booking entry PINs.

Run a manual lamp test, a full booking, back-to-back bookings, and an overlap if equipment is shared across bays. Check the physical equipment, **Log**, and **About → Health → Automation** before enabling it for customers. [Full operating checklist](OPERATING-GUIDE.md#automate-a-bay-around-bookings)

## Windows bay computers

A Windows bay computer can use three independent features. Start with the session display and a manual power test. Add automatic shutdown when you have tested it safely.

### Install the session monitor

Use the [Windows Session Monitor guide](BAY-PC-SESSION-MONITOR.md) to build the ZIP for each bay, install it on the matching PC, and test the booking screens.

### Wake and shut down

- **Wake on LAN.** Put the PC on wired Ethernet, preferably its onboard port, and keep it powered. On the PC, run `getmac /v` and identify the wired adapter's physical address. Enable the motherboard's wake setting and the adapter's **Wake on Magic Packet** option if present. With the correct Ethernet driver, check the adapter's power-management settings. Firmware features that cut standby power can prevent wake. Windows wake from a full shutdown varies by hardware and firmware. Test from the actual power state you plan to use.
- **Enter the wake settings.** Reserve the PC's address in your router, then open **BA Core Admin → Bays & Devices → your bay**. Enter **Simulator PC IP**, **PC MAC Address – Wake-on-LAN**, and **Wake PC – minutes before session**. Save. Put the PC in the intended off or sleep state, then press **Wake PC (test)**. Verify a booking also wakes it at the configured time. Keep the PC plug on. For a machine that supports restoring on AC power instead, use its firmware's **Restore on AC Power Loss** setting and only cycle power after Windows is known to be down.
- **Optional graceful remote shutdown.** On the booking Pi, run `sudo apt update` and `sudo apt install samba-common-bin`, then check `net --version`. The monitor handles the screen and works without this package. BA Core's separate Windows shutdown path needs the saved PC address, a Windows account authorised for remote shutdown, and private network access to Windows remote administration. In **Bays & Devices**, fill in **Windows Username** and **Windows Password** for that account, then save. In Windows, use the applicable **Remote Shutdown** and **File and Printer Sharing** firewall rules on the private network, limited to the booking Pi's reserved IP. Check the **Force shutdown from a remote system** user right if access is denied. Some local-account setups are blocked by Windows remote UAC restrictions. The legacy `LocalAccountTokenFilterPolicy=1` setting changes filtering machine-wide. Keep the default if you can and use manual shutdown if an acceptable restricted configuration does not work.
- **Verify before allowing automatic power cut.** Test the Dashboard's Off control with no active players. Watch Windows shut down cleanly while the PC plug stays energised. Repeat with a test booking ending. If it stays on, check IP, Windows account rights, firewall scope, and the BA Core Log. Keep the plug powered until the graceful shutdown path passes.

[Windows power states and wake behaviour](https://learn.microsoft.com/en-us/windows/win32/power/system-power-states) · [Windows remote UAC restrictions](https://learn.microsoft.com/en-us/troubleshoot/windows-server/windows-security/user-account-control-and-remote-restriction) · [Remote shutdown user right](https://learn.microsoft.com/en-us/windows/security/threat-protection/security-policy-settings/force-shutdown-from-a-remote-system)

## RemoteLock or UniFi Access

Use a door provider only if customers should receive a PIN. Set the facility's access style under **Settings → Booking → Facility Access**. Keep a physical key or staffed entry method available during commissioning. Set up and test your door in the provider first. The supported paths below use different credentials and timing.

### RemoteLock

1. Register a compatible lock in your RemoteLock account. Check with RemoteLock that your account plan includes API access for a client-credentials OAuth application. Use the provider's test controls to verify the lock can receive a timed code.
2. Create the OAuth application in RemoteLock's developer portal with **Client Credentials**. Record the **Client ID**, **Client Secret**, and the **Device ID** of the exact lock from RemoteLock. The device ID appears in the lock's page URL. Enter the secret only in the BA Core settings field.
3. In BA Core open **Admin → Settings → Devices**. Select **RemoteLock** in **Door Access Provider** and fill in the three values under **RemoteLock – Door**. Review **Code works BEFORE session**, **Code works AFTER session**, and your notification lead. Save. Check the access style in **Settings → Booking → Facility Access** so the test booking is one that needs a PIN.
4. Make a fictional booking. Check the BA Core **Log**, then the timed Access Guest in RemoteLock and the lock's sync status. Try the PIN on the actual keypad before, during, and after the window. Repeat with a cancellation. Confirm the email or text reaches an inbox or number you control.
5. If the provider shows the guest but the keypad refuses its PIN, check the device ID, the lock’s connection and last sync, and the booking time zone and access window. Test the configured fallback with someone on site. Keep the physical entry method available if the lock or its cloud connection goes offline.

[RemoteLock API and OAuth](https://developer.remotelock.com/api/docs)

### UniFi Access

1. Use a compatible console running **UniFi Access** and a keypad reader on each door that should accept PINs. Create and test the doors in Access first. Reserve the console's LAN address. In **Access → Settings → General**, verify the PIN length before deploying codes. If you use BA Core's member PIN option, use six digits on both sides. Changing a console's PIN length can invalidate existing codes, so coordinate that change before testing.
2. Create an **Access API Token** from the Access application's API Token settings and consult the API reference for your console version. The menu can appear under **Settings → General/Security** or under the account's API key controls. For booking visitors, give **Edit** on Visitor and **View** on Space. If enabling member access, also grant **Edit** on User and Access Policy. Record any expiry so you can rotate the token before it lapses.
3. In BA Core, go to **Admin → Settings → Devices → Door Access Provider → UniFi Access**. Enter the console's LAN address, token, and matching PIN length. Use **Test Connection** to find doors and door groups. Confirm you reached your intended console before relying on the saved certificate fingerprint. If the app reports a changed certificate, verify the reason and console identity before accepting it.
4. Select the facility doors every booking needs and save. If a bay has its own door, assign it only to that bay under **Bays & Devices → Private Room Door Access (UniFi)**. Keep the console and API on your private network. The Cloudflare Tunnel is for BA Core's booking site.
5. Test a fictional booking at each physical reader before, during, and after its allowed window. Check the visitor and doors in Access. Test cancellation and try the same PIN at a door outside the selection. If using member access, test the booked window and any deliberately assigned always-on doors. If **Test Connection** works but the PIN fails, check reader keypad support, PIN length, selected door, and the visitor schedule.

[UniFi Access PIN configuration](https://help.ui.com/hc/en-us/articles/29027022553239-Configuring-PIN-Unlock-in-UniFi-Access)

## Stripe Terminal

This is optional for staffed counter payments. Use a Stripe smart reader supported by your BA Core release, Stripe account region, and network. A standalone internet-connected reader such as a supported S700 uses the server-driven Terminal flow. Check Stripe's compatibility guide for the exact hardware and region before ordering.

1. Set up Stripe first. In BA Core, fill in the **Street Address** under **Settings → Business & Content → Contact Information** and the **city, state and ZIP/postal code** under **Local Search & SEO**. BA Core uses the facility address to make the Stripe Location.
2. In the correct Stripe mode, connect the reader to its network and open its settings to generate the **pairing code**. In **BA Core Admin → Settings → Food & Payments → Card Readers**, enter **Pairing code from the reader screen**, name the reader, and click **Add reader**. Follow your exact reader's Stripe setup instructions for its menus.
3. Set up a staff sign-in under **Settings → Staff → Staff & Sign-In Codes**. On the local network, open `/staff`, create a fictional test check, and send it to the reader. In a sandbox use Stripe's supported simulated-reader or physical test-card procedure for your setup. A browser checkout test card number is for online tests, separate from a physical reader test.
4. Verify that the reader shows the correct amount and that the staff check stays unpaid until Stripe confirms. Check the same amount and status in Stripe and in BA Core's End of Day review. Test a cancellation and confirm it does not mark the check paid. If you enable reader tips, test their record separately. Once live, run a small authorised counter sale and verify its outcome in both systems.

[Register Stripe Terminal readers](https://docs.stripe.com/terminal/fleet/register-readers) · [Stripe simulated reader](https://docs.stripe.com/terminal/payments/connect-reader?reader-type=simulated&terminal-sdk-platform=server-driven)

## Counter and kitchen printers

1. Use a printer that supports **Star CloudPRNT** in the installed hardware and firmware. Put the printer on a network that can reach the BA Core Pi and give the Pi a stable LAN address. A model such as the mC-Print3 has model-specific CloudPRNT setup in its web interface.
2. In **Admin → Settings → Devices → Kitchen & Counter Printers**, name the printer, choose **Counter (receipts)**, **Kitchen**, or **Bar**, and select **Add**. Copy the poll URL shown for that printer to its **CloudPRNT Server URL** field and enable polling on the printer. Use the full LAN URL BA Core supplies.
3. In **Settings → Food & Payments → Menu & Kitchen Routing**, assign each category or item to the intended print destination. Test a fictional order and confirm the kitchen or bar gets the right items and the counter gets the receipt.
4. If you use a supported printer-driven cash drawer, connect it to the counter printer’s drawer port, then enable **Cash drawer** and test it with a cash sale. Cash can also be recorded with the drawer turned off. Test End of Day after the sale. If nothing prints, check the poll URL, printer network, and role before changing menu routing.

[Star mC-Print3 CloudPRNT setup](https://www.star-m.jp/products/s_print/mcprint3/manual/en/settings/settingsCloudPRNT.htm) · [POS walkthrough](OPERATING-GUIDE.md#run-the-counter-with-pos)
