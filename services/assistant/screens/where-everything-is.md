# SCREENS: where everything is

(Read from the real Admin pages and the Website editor by tools/screen-map.js - 2026-10-22. Each part below is one card: where it is, what it says, what can be set on it. On BA Core 2 AI the assistant does these by talking, and the screen beside the chat moves to the card; the card itself is always there too.)

## Admin > Dashboard > Today's Schedule

Where: Admin, the Dashboard tab, the "Today's Schedule" card.

## Admin > Dashboard > Block Off a Bay — Events & Maintenance

Where: Admin, the Dashboard tab, the "Block Off a Bay — Events & Maintenance" card.
On it: Bay; Type; Label (optional); Start date; End date; All day; Start; End
Buttons: Block Bay

## Admin > Bays & Devices > The Whole Facility

Where: Admin, the Bays & Devices tab, the "The Whole Facility" card.
Buttons: Discover Entities, + Add Facility Device

## Admin > Bays & Devices > Bay Routines

Where: Admin, the Bays & Devices tab, the "Bay Routines" card.
What it says: No routines on Bay 1 yet. Add more steps once it is made (Change it). A program it closes must have been shown on that PC. Needs this bay's watcher built after this update (Build Session Monitor on the bay, as for any new screen).
On it: When a session starts - minutes before; When a session ends (set the bay back for the next player); Every day at (up to six times); When the PC starts; A button on the staff pad; When this program opens; When this program closes (keeps it running); When a window with these words appears; Hotkey on the PC
Buttons: Bay 1, The Vault, Bay 3, Teach a new routine on Bay 1's PC, Make it

## Admin > Bays & Devices > Simulator PC Setup — Session Monitor & Remote Shutdown

Where: Admin, the Bays & Devices tab, the "Simulator PC Setup — Session Monitor & Remote Shutdown" card.
What it says: Each bay PC needs a one-time setup so the system can shut it down after sessions and show on-screen warnings. Do these steps signed in as the PC's ADMIN account.

## Admin > Messaging > Text Message Settings

Where: Admin, the Messaging tab, the "Text Message Settings" card.
What it says: e.g. 60 = 1 hour before · 30 = 30 min before · 120 = 2 hours before
On it: Reminder Timing (minutes before tee time)

## Admin > Messaging > Confirmation Text

Where: Admin, the Messaging tab, the "Confirmation Text" card.
What it says: Sent immediately after booking. Staffed facility? Swap the door-code line for “Staff will get you set up.”
Buttons: Reset to Default

## Admin > Messaging > Reminder Text

Where: Admin, the Messaging tab, the "Reminder Text" card.
What it says: Staffed facility? Drop the door-code line. Reminder timing is set under Messaging → Reminder Timing.
Buttons: Reset to Default

## Admin > Messaging > Door Code Text

Where: Admin, the Messaging tab, the "Door Code Text" card.
What it says: Sent at the Door Access timing (15 minutes before start unless you change it) with their door code. Placeholder [Code] is required.
Buttons: Reset to Default

## Admin > Messaging > 15 Min Warning — No Next Booking

Where: Admin, the Messaging tab, the "15 Min Warning — No Next Booking" card.
What it says: Sent when no one is after them — they can extend if they want. Near closing, when no more time fits before you close, the product sends its own short text instead (“We close soon - please wrap up on time”), so nobody is offered time the booking page would refuse.
Buttons: Reset to Default

## Admin > Messaging > 15 Min Warning — Next Group Waiting

Where: Admin, the Messaging tab, the "15 Min Warning — Next Group Waiting" card.
What it says: Sent when someone is booked right after them
Buttons: Reset to Default

## Admin > Messaging > Cancellation Text

Where: Admin, the Messaging tab, the "Cancellation Text" card.
What it says: Sent when a booking is cancelled
Buttons: Reset to Default

## Admin > Messaging > Email Messages

Where: Admin, the Messaging tab, the "Email Messages" card.
What it says: Receipt & tax breakdown are appended automatically [Code] is required PIN, billing terms & cancellation info are always appended below your greeting Grace period & payment-update link are always appended Sent once when a member's timed waiver enters the reminder window (Waivers tab). The date, the "sign at your next booking or at the counter" line and the portal link are always appended
Buttons: Reset to Default, Save Email Messages

## Admin > Settings > Staff > Staff & Sign-In Codes

Where: Admin, the Settings tab, the Staff group, the "Staff & Sign-In Codes" card.
What it says: Your employees for the staff surface at /staff (facility network only). Each person signs in with their own 4-6 digit code; every check-in, order, payment, and bay action is stamped with their name. Codes must be unique. The staff surface exists wherever this roster has active codes — fully staffed facilities and hybrid bar-open windows alike. Remove every code and /staff goes dark. Idle minutes before /staff locks and asks for a sign-in code again. Short keeps a counter tablet safe; longer suits a busy bar. Employees add /staff to their phone home screen as an app - this icon is what they tap. Opens straight to the code pad, works only on facility Wi-Fi. What your staff can do at the counter on /staff. Everything here is a plain on/off — turn something off and it stops appearing for staff entirely, so nobody is offered a payment method or a screen this facility does not us
On it: Staff & Sign-In Codes; Facility Manager sign-in (optional); Staff pad auto-lock (minutes); Staff app icon (PNG, 512x512 recommended); Food & Drink on the counter; Cash at the counter; Checks at the counter; Employee scheduling & time clock; Staffed-hours label on the booking page; No-show after (minutes)
Buttons: + Add employee, Save staff, Set, Turn off

## Admin > Settings > Business & Content > How It Works Page

Where: Admin, the Settings tab, the Business & Content group, the "How It Works Page" card.
What it says: These steps are the /how-it-works page your customers see (linked from your website). Edit them to match YOUR facility - house rules, food policy, whatever fits. Add or remove steps freely.
Buttons: + Add Step, Save How It Works

## Admin > Settings > Business & Content > Business

Where: Admin, the Settings tab, the Business & Content group, the "Business" card.
What it says: The registered company name shown on your Privacy Policy and Terms pages. Leave blank to use your business name there. At least 8 characters. Leave blank to keep your current password.
On it: Business Name; Legal Entity (optional); Admin Password; Confirm New Password

## Admin > Settings > Booking > Booking Page Notice

Where: Admin, the Settings tab, the Booking group, the "Booking Page Notice" card.
What it says: Tapping the bar goes here. One of your pages or a full https:// address; leave blank for a plain notice. The bar shows on the booking page and every website page.
On it: Show the notice banner; Notice text; Notice link (optional)

## Admin > Settings > Business & Content > Branding & Theme

Where: Admin, the Settings tab, the Business & Content group, the "Branding & Theme" card.
What it says: PNG, JPG or WebP, up to 10 MB (an SVG is refused) Shows behind the hero section on booking page
On it: Logo (top left of booking page); Hero Background Image; Console Colors
Buttons: Upload Logo, Remove Logo, Upload Image, Remove Image

## Admin > Settings > Connections > Twilio - SMS

Where: Admin, the Settings tab, the Connections group, the "Twilio - SMS" card.
What it says: Texts must open with your brand. A long business name eats the 160-character single-segment budget and every text can bill as two or three messages. A short all-caps brand here (FAIRWAY instead of Fairway Indoor Golf Club LLC) keeps most texts to ONE segment — roughly half to two-thirds off your SMS bill. Leave blank to use your full business name. Your texting provider is Twilio. That is what this system sends through and what your guides walk you through registering. Bird below is an optional automatic BACKUP only — if you fill it in, a text that Twilio refuses is retried through Bird. You never have to set it up. E.164 format: +1 then 10 digits Numbers that texted STOP: checking… To your own mobile - the owner alerts number below. Save the card first.
On it: Short Brand for Texts (optional); Account SID; Auth Token; Phone Number; Your own mobile, for urgent alerts; Bird API Key (optional automatic backup — not required); Bird Workspace ID; Bird Channel ID
Buttons: Send a test text

## Admin > Settings > Connections > Stripe - Payments

Where: Admin, the Settings tab, the Connections group, the "Stripe - Payments" card.
What it says: Your revenue reports subtract these to estimate what Stripe keeps. Defaults match Stripe's standard US pricing (2.9% + 30¢ online, 2.7% + 5¢ on a reader) — only change them if your Stripe account has negotiated rates. Reporting only; never changes what a customer is charged. ⚠ Use sk_test_ while testing
On it: Processing Fee Estimates (for revenue reports); Online %; Online fixed (¢); Card reader %; Reader fixed (¢); Secret Key; Publishable Key; Webhook Secret (optional)

## Admin > Settings > Devices > RemoteLock - Door

Where: Admin, the Settings tab, the Devices group, the "RemoteLock - Door" card.
What it says: Find at developer.remotelock.com
On it: Client ID; Client Secret; Device ID

## Admin > Settings > Devices > Door Access Provider

Where: Admin, the Settings tab, the Devices group, the "Door Access Provider" card.
What it says: Which system issues each booking's door code. RemoteLock uses one lock via their cloud; UniFi Access uses your own UniFi console and can open multiple doors; Home Assistant drives a Z-Wave lock on your own network (no cloud). Only the chosen provider is used. Applies to every provider. Example: 15 before / 30 after (the defaults) means a 3:00-4:00 booking's code opens the door from 2:45 to 4:30. Locks Home Assistant knows about. Refresh the list The key on this lock's keypad that finishes a code, in words - the door-code text says "Type it, then press ..." with exactly this. On: a member's PIN is put in one of the booking slots for their booking's door window and taken out after - back-to-back bookings keep it in with no gap. Off: every booking, a member's too, gets a code of its own.
On it: Provider; Code works BEFORE session (min); Code works AFTER session (min); Text the code to the customer (min before); Make the code ahead and check the lock holds it before texting; Lock; Booking slots from; to; Backup code slot; After typing the code, the customer presses; Members open this door with their own member PIN; How codes are written; Console Address (LAN); API Token; PIN Length; Enable member door access
Buttons: Test the lock, Set a new backup code now, Sync All Members Now, Test Connection

## Admin > Settings > Devices > Home Assistant - Smart Devices

Where: Admin, the Settings tab, the Devices group, the "Home Assistant - Smart Devices" card.
What it says: Connect once here, then assign entities to bays in Bays & Devices. Controls any switch, light, thermostat, or lock Home Assistant manages. Local address with http:// and port (usually 8123) HA: profile → Security → Long-Lived Access Tokens → Create Token
On it: Enable Home Assistant; Home Assistant URL; Long-Lived Access Token
Buttons: Test Connection

## Admin > Settings > Connections > Resend - Email Notifications

Where: Admin, the Settings tab, the Connections group, the "Resend - Email Notifications" card.
What it says: Send booking confirmations, reminders, and door codes via email alongside SMS. Get your API key at resend.com Must be a verified domain in your Resend account To your facility email (Contact Information). Save the card first. Monthly members get an email this many days before their card is charged, telling them the amount and date. 0 turns the monthly reminder off. Yearly members always get their reminder 30 days out — that one cannot be switched off.
On it: API Key; From Email; Confirmation; Membership billing reminder (days before renewal); Reminder; Door Code (never sent when Facility Access is Staffed) - leave this on; Cancellation; Booking changed by staff; Session Ending
Buttons: Send a test email

## Admin > Settings > Booking > Hours & Booking Rules

Where: Admin, the Settings tab, the Booking group, the "Hours & Booking Rules" card.
What it says: Earliest time a session can start When you close. Every session must END by this time. For a MIDNIGHT close, enter 12:00 AM Check if you close at e.g. 1:00 or 2:00 AM (past midnight) No closing cap — sessions can run any length up to Max Session and cross midnight All booking times, reminders, and shutdowns use this timezone. It should match where the facility is located.
On it: Opening Time; Closing Time; Closing time is after midnight; Open 24 hours; Facility Access; Booking Unit; Who Can Book; Timezone; Min Session; Max Session; Price Per 30 Minutes ($); Booking Window; Buffer Between Bookings; Booking Deposit (non-members); Deposit per half-hour ($); Booking Flow; Bay → Date → Time; Date → Time → Auto-assign Bay; Days Open
Buttons: Detect from location

## Admin > Settings > Business & Content > Contact Information - Displayed in website footer

Where: Admin, the Settings tab, the Business & Content group, the "Contact Information - Displayed in website footer" card.
What it says: Appears in the footer of the booking and manage booking pages
On it: Phone Number; Email Address; Street Address; Website URL; Hours of Operation

## Admin > Settings > Food & Payments > Tax & Legal

Where: Admin, the Settings tab, the Food & Payments group, the "Tax & Legal" card.
What it says: Enter as percentage. Example: 7.375 for 7.375% Shows on customer receipts
On it: Collect tax on bookings; Tax Rate (%); Tax Label; Region / State; Tax ID (optional)

## Admin > Settings > Food & Payments > Point of Sale — Tax Codes

Where: Admin, the Settings tab, the Food & Payments group, the "Point of Sale — Tax Codes" card.
What it says: Stripe taxes by this address - your facility. Alcohol codes are worded for packaged sales - confirm your state's on-premises treatment with your accountant.
On it: Let Stripe compute tax (Stripe Tax); Venue Street Address; City (tax address); State (2 letters); ZIP; Stripe code: Simulator time; Stripe code: Food; Stripe code: Beverage
Buttons: ×, + Add code, Save tax codes, Check Stripe Tax status

## Admin > Settings > Food & Payments > Point of Sale — Menu & Kitchen Routing

Where: Admin, the Settings tab, the Food & Payments group, the "Point of Sale — Menu & Kitchen Routing" card.
What it says: Categories set the default printer and tax code; items inherit unless overridden. The staff surface reads this instantly — staff never build the menu, but they can 86 an item in one tap on the floor (shown here read-only). Deactivating hides from staff without losing history.
On it: Category name; Prints to; Tax code (default); Active
Buttons: Drinks bar - beverage - 4 items, Food kitchen - food - 4 items, Pro Shop kitchen - retail - 2 items, + Add category, Burgers, Pizza, Wings, Salads, Sandwiches, Sides, Beer, Cocktails, Wine, Soft Drinks

## Admin > Settings > Food & Payments > Specials & Deals

Where: Admin, the Settings tab, the Food & Payments group, the "Specials & Deals" card.
What it says: A special really changes the price at the counter while it is on: the servers' pads ring it up at the special price (tax is worked out from that price), the line says which special it is, and your website's weekly specials show it. A member gets the better of a special and their own perk, never both. Set one here, or tell your assistant (“Taco Tuesday - tacos are $3 from 5 to 9”). No specials yet.
Buttons: + Add a special

## Admin > Settings > Business & Content > Local Search & SEO

Where: Admin, the Settings tab, the Business & Content group, the "Local Search & SEO" card.
What it says: These help your booking site appear in local Google searches. All optional. The single biggest local-search factor is a Google Business Profile (business.google.com) — set one up too. From Google Maps — right-click your location In Google Search or Maps, manage your Business Profile and look for "Get more reviews" / "Ask for reviews" — copy that link. Customers who tap it land directly on the 5-star box. When set, a "Leave us a review" line appears on the booking success screen. Used for canonical URL + sitemap Moved (W44): your site description - site-wide and per page - is edited on the Website editor › Search & Sharing card, one place. Anything typed here before still shows until you save one there.
On it: City (shown in search results); State; ZIP Code; County; Latitude; Longitude; Google Review Link (optional); Domain (when live); Meta Description; Footer SEO Text (optional)

## Admin > Settings > Devices > Shutdown & Warning Timing

Where: Admin, the Settings tab, the Devices group, the "Shutdown & Warning Timing" card.
What it says: When the next session on a bay starts within this many minutes of the last one ending, the bay's plugs, TV and PC stay on through the gap instead of switching off and back on. Pressing Bay Off shuts the PC down first, then waits up to this long for it to go down before switching off its plug, the projector and the TV. When the on-screen warning appears: the book-more-time QR if nobody follows, or the wrap-up message if the next group is booked. This is the number the bay watcher actually uses. Booking window and base price moved to Settings → Booking → Hours & Booking Rules, where they belong. They used to be editable in two places, and saving here would quietly overwrite a change made there.
On it: Keep the bay on between groups (minutes); Bay Off waits for the PC (seconds); Watcher warning (minutes before end)

## Admin > Settings > Business & Content > Getting Started Checklist

Where: Admin, the Settings tab, the Business & Content group, the "Getting Started Checklist" card.

## Admin > Settings > Staff > Hours & Export

Where: Admin, the Settings tab, the Staff group, the "Hours & Export" card.
What it says: Tracks hours and schedules. Not payroll, benefits, or compliance — export the hours to your payroll or accounting system. Weekly / every two weeks: any Monday your periods start on. Blank = most recent Monday. Your facility's own policy, shown to staff as plain arithmetic ("6.5 hrs — meal break due per facility policy"). 0 = no rule. Employee Name, Employee Number, Period Start, Period End, Hours Worked, Break Minutes — and a footer that says these are recorded hours, not a payroll calculation.
On it: Hours period; A period start you know; The two days; Rest break every (hours); Meal break after (hours); Meal break is paid; From; To
Buttons: Save, This period, Last period, Export hours (CSV)

## Admin > Settings > Staff > Send the hours export Off

Where: Admin, the Settings tab, the Staff group, the "Send the hours export Off" card.
What it says: Emails the same file the Export hours (CSV) button makes — byte for byte, footer included — to a person you name, every time an hours period closes. You are always copied. Anyone you choose: your bookkeeper, your accountant, a shared mailbox, yourself at another address. A copy always goes to your facility email (Business & Content — change it there). Hours period: — — set in Hours & Export above, used here as-is. The period closes at midnight on its last day. If the unit is switched off at that moment it goes as soon as it is back on — never twice. Turning this on starts with the period that closes next; use Send now for the one that already closed. Sending stays Off until this unit is ticked.
On it: Scheduled sending; Send it to (one or more emails, comma-separated); After a period closes, send; At; Send it automaticallyAt the time above the file goes to the addresses ; Hold it for my sign-offAt the time above you get an email with the hou; I understand the file travels as a plain CSV attachment in ordinary em
Buttons: Save, Send now, Resend last, Approve and send, Download to check first, Skip this period

## Admin > Settings > Schedule > Employee Schedule

Where: Admin, the Settings tab, the Schedule group, the "Employee Schedule" card.
What it says: Tracks hours and schedules. Not payroll, benefits, or compliance — export the hours to your payroll or accounting system. Hours marked "want staffed" count as staffed even before anyone is assigned: the slot stays bookable and you schedule people onto it. Employee scheduling is switched off. Turn it on under Settings → Staff → The Counter and this tab wakes up. Click a + to give someone a shift (open shifts that day first, then this season's blocks, then custom times). Click a shift to change or remove it. Click a WANT STAFFED cell to post an open shift or mark the day differently.
On it: Season (hours you want staffed); Staffed hours; Season name; Shift blocks — the standard shifts of this season (overlap is fine)
Buttons: Use this season, Edit hours, + New season, Set every day like Monday, + Add block, Save season, Cancel, Delete season, ←, →, This week, Copy to next week, Save as pattern, Apply to this week

## Admin > Settings > Schedule > Time Clock

Where: Admin, the Settings tab, the Schedule group, the "Time Clock" card.
What it says: Every entry is stamped with who recorded it and who edited it. Employee self-fixes ("forgot to clock out") arrive flagged for your review.
On it: From; To
Buttons: Show

## Admin > Settings > Protection > Backups

Where: Admin, the Settings tab, the Protection group, the "Backups" card.
What it says: Four steps, top to bottom, in the order to do them. Buttons marked 🔒 ask for your authenticator code when the sensitive lock is on. Everything that matters: bookings, members, money and history, your settings, every signed waiver and waiver document, your PDF pages, your logo and app icons. Site photos and video are left out — they are the only thing that can make a backup huge, and you have the originals. After a restore you re-upload them in Website; the restore tells you which ones. Two other files leave this unit from other places and follow the same passphrase: the year archive (the Records card, below) and each quarter's signed waivers (the Waivers tab) — neither can be downloaded until a passphrase is set. Every night at a full backup is written to this unit (14 kept). Tick the extra places it should also be copied to — each one is checked byte for byte and keeps 14
Its parts: What a backup holds —; 1. Backup passphrase —; 2. Where the nightly copy also goes; 3. Your computer, automatically —; 4. Prove it works; Need to restore?
On it: SD card (a unit that runs from NVMe has the SD card as second storage ; USB stick in the unit
Buttons: Set passphrase 🔒, Turn off encryption 🔒, Copy to destinations now, Show link 🔒, Make a new link 🔒, Turn link off 🔒, Download Windows script 🔒, Download Mac script 🔒, Download a backup now, Test restore, Restore

## Admin > Settings > Protection > Records

Where: Admin, the Settings tab, the Protection group, the "Records" card.
What it says: Names, phone numbers, emails and signed waivers are removed automatically after this many years — whole calendar years at a time, so nothing goes before its time. Your business numbers are never part of this: revenue, tax collected, busy times and member counts from every year stay in the system forever. 10 years is the minimum; you may keep detail longer, never shorter. Every sign-in, setting, copy, apply and shift lands in the owner's log. It is kept at least twelve months whatever the volume and pruned by age each night - never by a row count. Want the full customer detail from a year past the window? Download that year's archive: every booking with names and contact info, every signed waiver with its PDF, and the members from that year. It downloads encrypted with your backup passphrase, like every copy that leaves this unit — with no passphrase set it cannot be downloa
Its parts: 1. How long customer detail is kept —; 2. Keep a year yourself; 3. Year-end report; 4. Your years at a glance kept forever
On it: Include customer names
Buttons: Save 🔒, Save, Download year archive, Download unencrypted 🔒, Download year-end report

## Admin > Settings > Protection > Automation Health

Where: Admin, the Settings tab, the Protection group, the "Automation Health" card.
What it says: Power-on, door codes, reminders and shutdown. Anything that fails is retried automatically and shown here — automation is never allowed to fail quietly.

## Admin > Settings > Food & Payments > Card Readers

Where: Admin, the Settings tab, the Food & Payments group, the "Card Readers" card.
On it: Pairing code from the reader screen; Label; Tip prompt on the reader
Buttons: Add reader, Save reader settings

## Admin > Settings > Business & Content > Facility Policies

Where: Admin, the Settings tab, the Business & Content group, the "Facility Policies" card.
What it says: For a member who paid a deposit online (Member golf settles: deposit online). Member's tab: the deposit is the member's money — their share draws from it and any surplus becomes their standing credit, applied automatically to their next booking. Group total: the deposit reduces what the whole group owes at the door.
On it: Cancellation window (hours before start); Policy notice on the booking page; Early bay access; Check-in; Member Deposit Credit Applies To

## Admin > Settings > Protection > Two-Factor Authentication

Where: Admin, the Settings tab, the Protection group, the "Two-Factor Authentication" card.
What it says: Add an authenticator-app code (Google Authenticator, Authy, 1Password...) on top of your password. Two independent switches: one for signing in, one that locks the sensitive rooms — settings, website builder, webhooks, secret keys, texting and email — behind a fresh code even inside an open session (15-minute window per code).

## Admin > Pricing > Time-Based Pricing Tiers

Where: Admin, the Pricing tab, the "Time-Based Pricing Tiers" card.
On it: Show these prices to customers under each time slot in the booking gri
Buttons: + Add

## Admin > Pricing > Discount Codes

Where: Admin, the Pricing tab, the "Discount Codes" card.
What it says: % or $ or mins blank = unlimited Use unlimited for member codes Blank = never expires. The code stops working at the END of this date.
On it: Code; Description; Type; Value; Max Uses; Per Person; Expires
Buttons: + Create, Uses, Deactivate

## Admin > Pricing > Booking Deals

Where: Admin, the Pricing tab, the "Booking Deals" card.
What it says: No booking deals yet.
Buttons: + Add a deal

## Admin > Pricing > Package Deals

Where: Admin, the Pricing tab, the "Package Deals" card.
What it says: No packages yet.
Buttons: + Add a package

## Admin > Members > Membership Revenue by Tier

Where: Admin, the Members tab, the "Membership Revenue by Tier" card.

## Admin > Members > Membership Tiers

Where: Admin, the Members tab, the "Membership Tiers" card.
What it says: Appears on your website's membership cards, the public memberships page, and the member's portal. The preview shows exactly what they will see. One purchase generates this many member codes. 1 = individual. 4 = family/business: buyer named at signup, Codes 2–4 arrive active with their own PINs. The whole group activates, lapses, and cancels together. The hour allowances below become a free-time meter, never a wall: the front of every session is covered by whatever free time the member has left that day (capped by the weekly/monthly pools), and time past that is priced by the After Hours rate above. Bookings are never blocked by the limits. The Value field is not used by this style. For a flat-rate tier in deposit mode the Value field below is the deposit — the dollars you collect online per half hour. A 1-hour booking charges this × 2. What holds the bay online. Guardrail b
On it: Tier Name; Badge Color; Description (shown on the membership cards); Discount Type; Codes Included; Member golf settles; Member deposit per half-hour ($); Member's discount off their door share (%); Food discount; Food amount; Drink discount; Drink amount; Value; Hours Per Day; Hours Per Week; Hours Per Month; Allowed Days; Earliest Start Time; Latest Start Time; Booking Window (days); Monthly Price ($); Annual Price ($); Grace Period (days); Roster Cap
Buttons: Edit, Deactivate, ✕ Close, Choose Doors, 💾 Save Tier, + Add New Tier

## Admin > Members > Members

Where: Admin, the Members tab, the "Members" card.
What it says: Leave blank to auto-generate a unique 6-digit PIN (recommended). Type one only if the member already knows a PIN from a previous system - duplicates are rejected automatically.
On it: Name; Phone; Email; Tier; PIN (optional)
Buttons: + Add, Usage, Extend, New PIN, Deactivate

## Admin > Revenue > Where the Money Came From — selected range

Where: Admin, the Revenue tab, the "Where the Money Came From — selected range" card.

## Admin > Revenue > Tax & Fees — selected range

Where: Admin, the Revenue tab, the "Tax & Fees — selected range" card.

## Admin > Revenue > In-Person Counter Sales — selected range

Where: Admin, the Revenue tab, the "In-Person Counter Sales — selected range" card.

## Admin > Revenue > All Payments Combined — selected range

Where: Admin, the Revenue tab, the "All Payments Combined — selected range" card.

## Admin > Revenue > Busiest Days — selected range

Where: Admin, the Revenue tab, the "Busiest Days — selected range" card.

## Admin > Revenue > Daily Revenue

Where: Admin, the Revenue tab, the "Daily Revenue" card.

## Admin > Revenue > Revenue by Bay — selected range

Where: Admin, the Revenue tab, the "Revenue by Bay — selected range" card.

## Admin > Waivers > Waiver Policy

Where: Admin, the Waivers tab, the "Waiver Policy" card.
On it: Liability waiver; Waiver collection; A member’s guests; Membership waiver lasts; Ask for a fresh waiver this many days before it runs out
Buttons: 💾 Save Waiver Policy

## Admin > Waivers > Upload New Waiver

Where: Admin, the Waivers tab, the "Upload New Waiver" card.
What it says: Bump this when the text changes - signed records store which version each customer agreed to.
On it: Waiver Name; Version; Description (optional); PDF File
Buttons: Upload Waiver PDF

## Admin > Waivers > Current Active Waiver

Where: Admin, the Waivers tab, the "Current Active Waiver" card.

## Admin > Waivers > All Waiver Versions

Where: Admin, the Waivers tab, the "All Waiver Versions" card.

## Admin > Waivers > Signed Agreements

Where: Admin, the Waivers tab, the "Signed Agreements" card.
Buttons: ↻ Refresh

## Admin > Waivers > Signed Agreements — Quarterly Archive

Where: Admin, the Waivers tab, the "Signed Agreements — Quarterly Archive" card.
Buttons: Download Q3 2026, Unencrypted 🔒

## Website editor > Your Website

Where: Admin, the Website tab (the Website editor), the "Your Website" card.
What it says: Most facilities build their website here. If yours has a website somewhere else, or does not want one, turn this off: visitors go straight to your booking page, the menu of marketing pages disappears, and everything below is kept for the day you switch it back on. Your booking page, memberships, gift cards and any pages you publish (terms, house rules) keep working either way.
On it: Use the website built here (landing page, events, the site menu)
Buttons: Save, Previous versions

## Website editor > Colors & Fonts

Where: Admin, the Website tab (the Website editor), the "Colors & Fonts" card.
What it says: Pick a professional preset, or switch to Custom and choose every color yourself. This is the only place appearance is set - your whole site, the booking app, and the admin console look below. Your site ships with three faces - one for headings, one for everything you read, and one for the small line above a heading. Pick your own, or tick the unit to use a single font for the whole site including every button. This applies everywhere: marketing pages, custom pages, the booking app, memberships and gift cards. Font sets - a whole pairing in one tap: Titles and section headings Everything a visitor reads, and every button
On it: Custom colors (advanced); Use one font everywhere (headings, text, buttons and the small lines a; HEADINGS; BODY TEXT & BUTTONS; SMALL LINES; Plain small lines (turn off the wide-spaced CAPITALS above headings an; BUTTONS; BUTTON WORDS; CARDS AND PHOTOS; CARD SHADOWS; SPACE BETWEEN SECTIONS; PAGE WIDTH; TEXT SIZE; TEXT WEIGHT; SPACE BETWEEN LINES; HEADING SIZE; HEADING WEIGHT; HEADING STYLE; HEADING LETTER SPACING; TOP OF THE PAGE: WORDS; TOP OF THE PAGE: HEIGHT; TOP OF THE PAGE: SHADE OVER THE PHOTO; TOP BAR; THE MENU
Buttons: Original, Clean, Sporty, Elegant, Strong, Sleek, Warm, Clubhouse, Signature, Classic, Modern, Bold, Minimal, Friendly

## Website editor > Hero — The First Thing Visitors See

Where: Admin, the Website tab (the Website editor), the "Hero — The First Thing Visitors See" card.
What it says: Hero image/poster: about 1920x1080 - upload the best copy you have; phone-sized versions are made for you. Hero video: MP4, 10-30s, under ~12 MB (mobile video can be a smaller portrait cut). Your headline, a short line under it, and up to 3 big photos that fade between each other. Optional: a background video (plays on desktop only). A small word under the hero buttons telling a visitor there is more below. Off by default - most people know how to scroll, and on a short first screen it points at nothing. Search tip: work your city and "golf simulator" in naturally — e.g. "Council Bluffs' Premier Indoor Golf." Google weighs this line heavily. State-of-the-art golf simulators with true self-service access. Book online, get your door code, and play.
On it: SMALL TAG LINE (ABOVE HEADLINE); SHOW YOUR LOGO IN THE TOP BAR; SHOW THE "SCROLL DOWN" HINT UNDER THE BUTTONS; WHAT THE HINT SAYS; HEADLINE; SUBLINE; HERO BUTTONS (UP TO TWO); BUTTON 1 TEXT; BUTTON 1 GOES TO; Show; BUTTON 2 TEXT (OPTIONAL); BUTTON 2 GOES TO; HERO PHOTOS (UP TO 3); BACKGROUND VIDEO (OPTIONAL — PLAYS ON DESKTOP ONLY, MUTED); Video Path; Mobile Video Path (optional - a smaller/vertical cut for phones); Poster Path
Buttons: Bullet, Numbered, Divider, Heading, Small heading, Bold, Italic, Quote, ?, Preview, Upload, Upload Video, Remove, Save Hero

## Website editor > Offer Slides — Full-Screen Slideshow

Where: Admin, the Website tab (the Website editor), the "Offer Slides — Full-Screen Slideshow" card.
What it says: Five big slides that auto-advance, each with a photo and a short message. Turn the whole slideshow off if you don't want it. Shown or hidden - and placed on the page - on the Page Layout card.
On it: Show; SMALL LABEL; TITLE; TEXT
Buttons: Upload Photo, Save Offer Slides, Previous versions

## Website editor > Page Layout — Your Page, Block by Block

Where: Admin, the Website tab (the Website editor), the "Page Layout — Your Page, Block by Block" card.
What it says: Top to bottom, exactly as visitors scroll. The hero always leads and the footer always closes. Tick Show to hide a block without losing its words, use the arrows to move it, click a block to edit it. Built-in blocks keep their words on their own cards below; added blocks are edited right here. The built-in blocks (slides, gallery, find us...) live here. Any block you add can move to a page of its own. Five big slides that auto-advance (edited on the Offer Slides card). The numbered strip (edited on the How It Works card). The next two weeks of staffed hours (Staffed Days card).
On it: PAGE; Show
Buttons: ↑, ↓, + Add a block, Save Page Layout, Previous versions

## Website editor > How It Works — 4 Steps

Where: Admin, the Website tab (the Website editor), the "How It Works — 4 Steps" card.
What it says: The numbered strip that explains your self-service flow. Shown or hidden - and placed on the page - on the Page Layout card.
On it: SECTION TITLE; TITLE; TEXT
Buttons: Save Steps, Previous versions

## Website editor > Staffed Days

Where: Admin, the Website tab (the Website editor), the "Staffed Days" card.
What it says: If your facility is self-service with occasional staffed hours, mark the days someone is on site — the landing page shows the next two weeks automatically. Fully self-service or fully staffed? Just turn the section off or on to match. Shown or hidden - and placed on the page - on the Page Layout card. Fully self-service. Book online, get your unique door code by text, and let yourself in. Your bay is powered up and ready when you arrive.
On it: SECTION TITLE; INTRO LINE; "ALL OTHER TIMES" TEXT; Start; End; Note (optional); Sun; Mon; Tue; Wed; Thu; Fri; Sat; START; END; FROM; THROUGH
Buttons: Bullet, Numbered, Divider, Heading, Small heading, Bold, Italic, Quote, ?, Preview, Save Text, Previous versions, ‹ Prev, Next ›

## Website editor > Photo Gallery

Where: Admin, the Website tab (the Website editor), the "Photo Gallery" card.
What it says: Recommended: landscape photos about 1600x900 (JPG, under 1 MB each). Square-ish also works; very tall photos get cropped. Your facility, your way — add as many photos as you like, with optional captions. Drag order with the arrows. Photos are automatically resized on upload so they load fast. Shown or hidden - and placed on the page - on the Page Layout card. All 0 photo(s) are sized for phones. Size all photos for phones
Buttons: Add Photo, Save Gallery, Size all photos for phones

## Website editor > Pages Terms & Conditions, house rules, league info - any standalone page

Where: Admin, the Website tab (the Website editor), the "Pages Terms & Conditions, house rules, league info - any standalone page" card.
What it says: Terms & Conditions, house rules, league info - any standalone page No pages yet. The page lives at /p/slug - letters, numbers, dashes. Up to 25 MB. It shows inline on computers and phones with Open and Download buttons; the text below is optional. This page is made of blocks, like your homepage - arrange them on the Page Layout card (pick this page at the top). Its title, address, search words and whether it is published stay here.
On it: Page Title; Web Address (slug); Page type; The document; The "open" button says; The "download" button says; Page Body; Search title; Description; Published (visible to everyone); FOOTER LINKS (EXTERNAL ALLOWED)
Buttons: + Add Page, Upload PDF, Bullet, Numbered, Divider, Heading, Small heading, Bold, Italic, Quote, ?, Preview, Upload share image, Use site-wide

## Website editor > Events

Where: Admin, the Website tab (the Website editor), the "Events" card.
What it says: Upcoming events show on the landing page and at /events. Past events disappear automatically — nothing to clean up. Adding and deleting saves instantly. Shown or hidden - and placed on the page - on the Page Layout card.
On it: TITLE; DATE; DESCRIPTION (OPTIONAL); MORE-DETAILS LINK (OPTIONAL); FLYER IMAGE (OPTIONAL)
Buttons: Bullet, Numbered, Divider, Heading, Small heading, Bold, Italic, Quote, ?, Preview, Upload, Add Event, Cancel

## Website editor > Memberships Section

Where: Admin, the Website tab (the Website editor), the "Memberships Section" card.
What it says: Shows your sellable membership tiers as cards on the landing page — live pricing, spots remaining, and a Join button that goes to your online signup page. The cards come from your tiers (Admin → Members → edit a tier → set prices + check Sell Online), so they are always current. This section hides itself automatically if no tiers are sellable online. Shown or hidden - and placed on the page - on the Page Layout card.
On it: SMALL HEADING (KICKER); SECTION TITLE; INTRO TEXT (OPTIONAL)
Buttons: Bullet, Numbered, Divider, Heading, Small heading, Bold, Italic, Quote, ?, Preview, Save Memberships Section, Previous versions

## Website editor > Promo Banner

Where: Admin, the Website tab (the Website editor), the "Promo Banner" card.
What it says: A bold band with a discount code — great for first-visit offers. Create the matching code under Admin → Pricing. Shown or hidden - and placed on the page - on the Page Layout card.
On it: SMALL LABEL; DISCOUNT CODE; TITLE; TEXT
Buttons: Save Promo, Previous versions

## Website editor > Contact & Social

Where: Admin, the Website tab (the Website editor), the "Contact & Social" card.
What it says: Your address is the one in Admin → Settings → Business & Content → Contact Information. Here you control the contact line, the map and your social links. Paste the full address of each page you have (https://...). They appear as icons in the footer of every page and tell search engines these profiles are yours. Your Google review link lives in Settings → Business & Content → Local Search & SEO and shows here automatically. Shown with your profiles in the footer and in the Social row block. Nothing shows while all are blank.
On it: PUBLIC PHONE (BLANK = USE SETTINGS PHONE); PUBLIC EMAIL (BLANK = USE SETTINGS EMAIL); Show hours of operation (from your booking hours in Admin \u2192 Setti; Show the map; FACEBOOK; INSTAGRAM; TIKTOK; YOUTUBE; X (TWITTER)
Buttons: + Add a link, Save Contact & Social, Previous versions

## Website editor > Navigation

Where: Admin, the Website tab (the Website editor), the "Navigation" card.
What it says: What appears in the menu at the top of every page and in the footer, in the order you set. Memberships shows only while a tier is sold online; drafts never show. On phones the top menu folds into a menu button. /memberships · shows while a tier sells online /how-it-works /leagues · not yet public - hidden until it is · shows while Leagues is public Your own menu item: a label and where it goes (one of your pages or a full https:// address).
On it: Top menu; Footer
Buttons: ↑, ↓, + Add a link, Save Navigation, Previous versions

## Website editor > Email Updates

Where: Admin, the Website tab (the Website editor), the "Email Updates" card.
What it says: Nobody yet. Switch Email Updates on and place the block, or point a hero button at /updates.
On it: Email updates are ON (the page, the block and the holding-page signup ; TITLE; BUTTON; LINE UNDER THE TITLE; Also show the signup on the holding page (not-yet-public parts of the 
Buttons: Save Email Updates, Previous versions, Refresh

## Website editor > What's Public

Where: Admin, the Website tab (the Website editor), the "What's Public" card.
What it says: The booking page (/book) and My Booking. Off: the address shows the holding page; the grid, prices and checkout are not reachable. The memberships page and joining online. My Membership (/my-membership) where members sign in. The events page. The gift cards page and buying one.
On it: Public; THE HOLDING PAGE (WHAT A VISITOR SEES AT A PART THAT IS NOT YET PUBLIC; HEADLINE; TEXT
Buttons: Save What's Public, Previous versions

## Website editor > Search & Sharing

Where: Admin, the Website tab (the Website editor), the "Search & Sharing" card.
What it says: What search engines and shared links show - site-wide, and per page below (W44). Your city, domain and Google review link are set once in Settings → Business & Content → Local Search & SEO. A sitemap is published for you at /sitemap.xml. Blank uses "Your Business Name — Indoor Golf Simulators". Put your city in it if you can. Blank uses your first hero photo, or your logo. Best size about 1200x630. Blank = the automatic line. Keep it under about 160 characters for search results. Each public page can carry its own search title, description and share image - including the holding page. Custom pages set theirs on the Pages card.
On it: SITE TITLE (BROWSER TAB AND SEARCH RESULT HEADLINE); SHARE IMAGE (THE PICTURE A TEXT OR SOCIAL POST SHOWS WITH YOUR LINK); SITE DESCRIPTION (THE LINE UNDER YOUR NAME IN A SEARCH RESULT AND IN A; SEARCH TITLE; DESCRIPTION
Buttons: Upload, Use hero photo, Save Search & Sharing, Previous versions

## Website editor > Site-wide

Where: Admin, the Website tab (the Website editor), the "Site-wide" card.
What it says: Notice bar. The notice you set in Admin → Settings → Booking → Booking Page Notice shows on the booking page AND at the top of every website page - one notice, set once. Paste the id from your own Google Analytics or Meta account. Only that provider's addresses are allowed onto your pages, nothing else changes, and your Privacy page says visits are counted while it is on. Clear the field to turn it off. Search titles, descriptions and share images - site-wide and per page - live on the Search & Sharing card (W44).
On it: GOOGLE ANALYTICS 4 MEASUREMENT ID; META (FACEBOOK) PIXEL ID
Buttons: Save Site-wide, Previous versions

## Website editor > Inbox

Where: Admin, the Website tab (the Website editor), the "Inbox" card.
What it says: Everything visitors send through an Inquiry form block on your page. Each one is also emailed to your facility address when email is set up; nothing is lost if it is not. Mark them handled as you go. Nothing yet. Add an Inquiry form block on Page Layout and visitors can write to you.
Buttons: Refresh

## Website editor > Homepage

Where: Admin, the Website tab (the Website editor), the "Homepage" card.
What it says: When your landing page is ready, make it your homepage. Your booking app moves to /book — and every QR code, link, and monitor keeps working automatically. You can switch back any time.
Buttons: Make Landing Page My Homepage
