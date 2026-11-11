# BA Core Community - The Complete Owner Manual
## Everything about running the system, in one file

Manual version: 2026-11-10 (BA Core Community)

**To the facility owner:** this one file is the full reference for the software - how every feature behaves, where every
setting lives, and a step-by-step chapter for each service and device. Instead of searching it, give it to the AI you
use (ChatGPT, Claude, Gemini) and ask in plain English: "walk me through connecting Stripe," "my bay PC won't shut
down," "how do I run members-only." Inside Admin, **Guides** lists this manual beside the shorter guides, and **Copy
the manual** puts it on your clipboard. The Assistant and Owner Chat read it too.

**Installing for the first time?** Start with the first-time install guide (EVERYTHING-ASK-YOUR-AI in Guides, and in
the release folder). It covers imaging the Pi, running the installer, the private setup screen and opening your site.
This manual picks up once Admin is running.

**To the AI assistant reading this:** this is the authoritative manual for this product. Answer the owner's questions
from it. It has two halves: PART ONE is the system reference (what everything is and how it behaves); PART TWO is the
set of step-by-step setup chapters. Where a step names another guide, that guide is a chapter in this same file or one
of the shorter guides in Admin > Guides (first-time install, domain, Cloudflare Tunnel, Home Assistant on a second Pi,
the bay Session Monitor, services and equipment, day-to-day operations). Settings locations are given as Tab > area; the
admin panel also has a search bar in its header that jumps to any setting on the admin tabs by name (the Website editor
is its own page, with its own cards, and is not searched). For vendor specifics beyond these pages, consult
stripe.com/docs, resend.com/docs and twilio.com/docs.

**BA Core Community is self-service.** The owner installs it on their own Raspberry Pi 5 and looks after the Pi, the
network, the accounts and the backups. There is no updater, no licence step and no support line: a newer release is
installed with the installer (the Operating guide, "Upgrade to a newer release"). When something sits below the admin
panel - the Pi itself, the tunnel, the network - point the owner to the matching guide rather than improvising.

**On equipment:** the software runs on the owner's Pi. Printers, cash drawers, card readers, smart plugs, IR blasters,
locks and bay PCs are bought by the facility. Section 7b lists exactly what works, what does not, and how it all
connects. Recommend ONLY from that list - a printer or drawer outside it will not work with this system, however good
it is.

---

# HOW TO ASK - describe your facility once, then ask anything

Copy the block below, fill in the blanks in plain English, and paste it as
your FIRST message along with this file. The AI will then know which
archetype you are (section 2), which settings apply to you (section 3), and
which membership recipe fits (section 2b) - and it can tell you exactly which
switch to flip, in which tab, and what your customers and staff will see.

```
MY FACILITY
- Name / city:
- Bays: (how many, any premium bays, any private rooms)
- Staffing: always staffed / unstaffed with door codes / staffed some hours (which)
- Entry: a person lets people in / smart lock door codes (RemoteLock) / UniFi Access / a Z-Wave lock through Home Assistant
- Payments: Stripe online? card reader at a counter? cash?
- Text messages: yes (Twilio) / no, email only
- Waivers: every visit / members sign once / none
- Food and drink at a counter: yes / no
- Counter equipment I have or plan to buy: (receipt/kitchen printer, cash drawer,
  card reader, barcode scanner - or "tell me what to buy")
- Employees: (how many, do they clock in, do you build a schedule, which hours
  are you staffed by season)
- Memberships I want: (say it the way you'd say it to a customer - e.g. "members
  book for free, get 1 free hour a day, then $5 an hour, guests pay regular")
- Non-members: pay in full online / pay a deposit online, rest at the counter
- Anything unusual: (whole-facility rental, private club, multiple sites)
```

Then ask: "set me up" - or anything specific. The answers below are the
rules the software actually follows, not general advice.

## How-to prompts - paste one and the AI walks you through the screen

Each of these matches a chapter in PART TWO. Paste the line with this file
attached and the AI will take you through it click by click.

- "Walk me through opening my site one part at a time - I want the website up
  but booking, memberships and events not public yet. Use the What's Public
  card." (chapter: What's Public and the Holding Page)
- "Show me how to rename a menu item, add my own link to the menu, and hide
  one from the footer." (chapter: Your Menu and Links)
- "Help me set up two hero buttons - one to book, one that jumps to my offers
  section - and change the words on the closing band at the bottom of the
  page." (chapter: Hero Buttons and the Closing Band)
- "Put a notice bar across the top of my site that links to my events page."
  (chapter: The Notice Bar)
- "Turn on email updates, put the signup on my homepage and my holding page,
  and show me how to download the list as a CSV." (chapter: Email Updates)
- "Put my bookings on my Google Calendar (or Apple Calendar, or Outlook)." (section 4:
  Your bookings in your own calendar and files)
- "Download last month's bookings as a spreadsheet." (section 4: Your bookings in
  your own calendar and files)
- "Make a page that shows my menu as a PDF." (chapter: PDF Pages)
- "I just restored my backup onto a new device - what do I need to review?"
  (chapter: After a Restore - Reviewing Your Settings)
- "A customer at the counter needs money back - show my staff how to refund a
  card, cash or check payment on the pad." (chapter: Staff Guide, Giving Money
  Back)
- "I refunded a customer in my Stripe dashboard. Does my revenue know, and
  where do I see it?" (Owner's Guide: Money)
- "Set my backup passphrase, then show me what my backup holds and turn on the
  copy to my computer." (chapter: If Something Goes Wrong)
- "Make my year-end report for my bookkeeper - what is in it, and should I
  include customer names?" (Owner's Guide: Your Year-End Report)
- "Set up my UniFi Access doors so members open them with their own PIN during
  their bookings - and tell me what to write down from Test Connection."
  (chapter: Setting Up Your Door with UniFi Access)
- "I upgraded BA Core and the bay watcher changed. Walk me through
  redoing every bay PC." (chapter: Setting Up Your Bay Computers, After a
  Software Update)
- "Text me when something needs me now - what will it text me about?"
  (Owner's Guide: Texts to You When Something Needs You)
- "Set my Shelly plugs so a power cut does not light every bay at night."
  (chapter: Setting Up Smart Power)
- "I'm moving my door from RemoteLock to a Z-Wave lock through Home Assistant -
  walk me through it without stranding codes already sent." (chapter: Setting
  Up Your Door with a Z-Wave Lock)
- "I'm testing the unit on site after setup - walk me through the checklist one
  step at a time and tell me what I should see." (chapter: On-Site Test
  Checklist)

Every guide, and this file, is inside your admin panel: the **Guides** button in the header opens them
(read or download any one), and **Copy the manual** puts this whole file on
your clipboard ready to paste into an AI.

**To the AI assistant:** when the owner gives you that block, walk it in this
order: (1) pick the archetype in section 2 and list its settings from section
3 and section 2c, (2) translate their membership sentence into a tier using
section 2b, (3) tell them what their customers will see on the booking page
and what staff will see at the counter (section 4), (4) name the guides
(chapters in this file) for anything they still have to connect (Stripe,
email, texting, doors, bay PCs, the counter), (5) for a staffed counter, give
them the shopping list from section 7b and say how each piece connects. Be
concrete: tab names, setting names, model names, and the exact choice to pick.

# PART ONE - THE SYSTEM REFERENCE


## 1. What this system is

A self-hosted booking and facility-automation appliance for simulator venues.
It runs on a small computer at the facility and handles: online booking and
payment (Stripe), door codes for unstaffed entry, automatic bay power-up and
shutdown (Shelly smart plugs, BroadLink IR, Home Assistant), waivers with legal
evidence capture, memberships with recurring billing, gift cards and discount
codes, a public marketing website, email (Resend) and optional text messaging
(Twilio), a staff point-of-sale with food/beverage, and a full admin panel.

Admin tabs: Dashboard, Bookings, Bays & Devices, Messaging, Settings, Website
(its own editor page), Pricing, Members, Revenue, Waivers and Log, with Guides
and About as buttons in the header. Settings is split into Booking, Staff,
Schedule (shown once Employee scheduling is on), Business & Content, Food &
Payments, Connections, Devices and Protection. The
Dashboard shows a Getting Started checklist computed from your real
configuration — it knows your facility style and recommends YOUR next steps. Optional items never hold it up; Hide on the card tucks it away until a new item appears, and Settings > Business & Content > Getting Started Checklist brings it back.

## 2. The five facility archetypes — pick yours

Every setting works with every other setting; these are starting paths, not
limits. A few controls appear only where they apply: the Schedule tab and the
hours cards need Employee scheduling switched on (Settings > Staff > The
Counter), and a tier's food and drink discounts show in Edit Tier only when the
facility has a counter (Facility Access Always staffed, or Both).

### A. Unstaffed public facility (most common)
Customers book online, pay, get a door code 15 minutes before their session
(by email, and by text if they ticked the unit), walk in, and the bay is
already on. No staff on site.
- Facility Access: "Unmanned — everyone gets a door code" (Settings -> Booking).
- Check-in: defaults to Off for you — most unstaffed facilities never use
  check-in. The booking is simply valid. (Settings -> Business & Content ->
  Facility Policies.)
- Waivers: collection "Online — everyone signs during booking."
- You need: Stripe, Resend (email), a door (RemoteLock, UniFi Access, or a
  Z-Wave lock through Home Assistant), and bay automation (section 7: Shelly
  plugs or BroadLink IR for screens and projectors; the bay PC wakes by
  Wake-on-LAN and shuts down over the network, with or without a plug).

### B. Staffed public facility
A person is always at the counter. No door codes are generated or sent —
confirmations and reminders still send.
- Facility Access: "Always staffed."
- Check-in: full flow available at the counter. Because someone is always
  there, EVERY settlement choice is live at every hour: a non-member booking
  deposit (Settings > Booking > Hours & Booking Rules > Booking Deposit
  (non-members)), and on each
  membership tier the "Member golf settles" choice - online, deposit online
  with the balance at the door, or at the door with nothing charged online.
- Waivers: collection "At the door — staff collects at arrival" (typed
  signature or paper on file). Members sign once (membership waiver); decide
  on the Waivers tab whether a member's guests are covered by the member's
  waiver or each guest signs the one-day waiver at check-in.
- The landing page's staffed-hours comparison section starts hidden — it makes
  no sense when staff is always there.

### C. Hybrid (staffed some hours)
Facility Access: "Both — staffed some hours, unmanned the rest". Mark staffed
days and windows in Website -> Staffed Days - or, once you save a season in
Settings > Schedule, the season decides instead (section 3, Staffed hours come
from one place). Door codes ALWAYS
send at a hybrid facility so nobody is locked out if staff step away. Deposits
and settling at the door only happen inside staffed windows - members keep
their member price at every hour, they simply pay all of it online when nobody
is at the counter. Waiver collection "Automatic" signs at the door when your
window says staffed, online otherwise. Until at least one staffed day is on
the calendar the facility behaves as unmanned; the Dashboard checklist carries
a "Mark your staffed hours" item for exactly this.

### D. Members-only private club
No valid member code, no booking — enforced on the server. The booking page
shows the club wall with a Become a Member button linking to your memberships
page - once a tier is for sale online (Sell online, and a Monthly or Annual
price above $0). Until then the wall says "Contact the facility about becoming
a member."
- Who Can Book: "Members only" (Settings -> Booking).
- Create at least one tier (Members tab) or nobody can join. The setup wizard
  creates your first tier for you.
- Member pricing: set the tier's discount type to Flat Rate — the value is per
  30 minutes, so a $30/hour club rate is entered as 15. Under members-only the
  flat rate IS the price (the "never above public price" cap is off, because
  there is no public price).
- Members-only clubs run on EMAIL. The texting opt-in disappears from the
  booking page. Booking confirmations, reminders, and cancellation notices each
  have their own switch on the Resend - Email Notifications card (Settings ->
  Connections).
- Selling online: give the tier a monthly and/or annual price, turn on Sell
  Online, connect Stripe. Members can cancel from their portal (cancel at
  period end, no partial refunds). Monthly members get a billing-reminder email
  N days before their card is charged ("Membership billing reminder" on the
  Resend - Email Notifications card; 7 by default, 0 turns it off). Annual
  members always get 30 days' notice.

### E. Whole-facility rental (the franchise model)
One booking takes EVERY bay — customers pick only a date and time.
- Booking Unit: "Entire facility — one booking takes every bay"
  (Settings -> Booking, next to Facility Access).
- One booking runs the FULL start sequence on every bay and the full end
  sequence on every bay. You keep independent per-bay control in the Bay
  Operations console on the Dashboard.
- Pricing: the base price per 30 minutes IS the whole-building rate ($60/hour
  for the building = enter 30). Per-bay premium adders never apply. Combined
  with members-only, the member flat rate is the building rate — e.g. $100/
  month membership + $30/hour building rate = flat rate 15.
- Mode flips are safe: every booking keeps the meaning it was born with. A
  facility booking blocks all bays forever; a per-bay booking blocks its bay.
- Still add EVERY bay in Bays & Devices with its own hardware, so the
  automation can run each one.

## 2b. Membership recipes — say it in plain words, set it like this

Every membership tier is built from three decisions: the **discount style**
(what the deal is), **Member golf settles** (what is charged online and what
waits for the counter), and the **allowances and rules** (hours, days, bays,
guests, booking window). The tier editor's "This tier, in plain words" box
rewrites itself as you change anything - read it back before saving; it is
the sentence your members will experience. Recipes owners actually ask for:

**"Members book for free, get 1 free hour a day, then $5 an hour, guests pay
regular."** (the club-style model) - Discount Type: Free Daily Hours + Rate
After (blended). Hours Per Day: 1. After Hours Are Used - Discount: "$ per 30
min - member rate after", After-Hours Discount Value 2.50 (the plain-words box
reads it back as $5.00/hour). Member golf settles: At the
door. Needs a staffed facility (or staffed hours). Result: $0 online, the
booking page says "$0 due now - about $X on your tab at the facility", and at
check-in the member's seat is their free hour then $5/hour; guests pay the
public price split by heads. Different tiers can carry different hours and
rates - Gold 2 free hours and $5/hour, Basic 1 free hour and $10/hour.

**"Members get 20% off and just pay when they book."** - Percentage Off 20.
Member golf settles: Online at booking. Nothing to do at the counter.

**"Members get 20% off but reserve for free and pay at the door."** -
Percentage Off 20, Member golf settles: At the door. Their seat gets 20% off
its share at check-in; friends pay the regular share.

**"Members put down a small deposit to hold the bay; we settle the rest when
they show up with their group."** - any style, Member golf settles: Deposit
online, balance at the door; set Member deposit per half-hour. Optional: a
door share discount % (the member pays their share minus that percentage
instead of the tier discount). A flat-rate tier uses its Value as the deposit.

**"10 free hours a month, then 20% off."** - Free Hours Per Period, value 10,
After Hours Are Used - Discount: "% off", After-Hours Discount Value 20. Free
time is applied first: a member with one hour left who plays two pays for one.

**"$30 an hour member rate, that's it."** - Flat Rate Per 30min, value 15.
At a private club (Members only) that rate IS the price, up or down; at a
public facility a member can never pay more than the public price.

**"One membership, the whole family."** - Codes Included 4: one online
purchase gives four PINs on one bill, and the four codes start, lapse and
cancel together. Each code has its OWN allowances - free hours, hour limits,
guest passes and booking limits are counted per code, so a tier with 10 free
hours a month gives each code 10 hours. The extra codes are made only when the
membership is bought online; a member you add by hand gets one code.

**"Members bring friends."** - The guest rule lives on the tier, in the words the editor uses. First set **Guests Allowed** to Yes: while it says No (the default) none of the rules below apply, and friends simply pay their regular share of the bay at the counter. Then: **Included Per Visit** (friends covered on every visit), **Passes / Month** (more covered friends each month, on top), **Guest Pricing** (what a COVERED friend pays - Free, the default; a Flat Fee Per Guest; or their Regular share at the counter - and with Included and Passes both 0, every friend counts as covered and pays this), **Guest Price After Passes** (what each friend beyond the covered ones pays; 0 = free, or their regular share on Regular share), **Guest Charges Are** (Per guest, per booking - the default - or Per guest, per hour; one setting for both prices), **Max Per Visit** (the most guests a member may bring - the booking page refuses more, with the reason; 0 = no cap), and **Guest Fees Are Collected** - *with the member's golf* (whatever the member's tier does, the guests do), *always online with the booking* (the honor system at an unstaffed club: the member enters their code, picks the guest count, and pays right there), or *at the counter wherever someone is there* (a door or deposit tier collects seat by seat: "Guest - included", "Guest - $20.00", "Guest - paid online"). A member is never charged more in total than the non-member price for the same session; the system caps it. ONE rule everywhere: the booking page quotes it, the pad prices it, the portal shows the passes used. Example: Guests Allowed Yes, Included Per Visit 1, Guest Price After Passes 20, Guest Charges Are "Per guest, per hour", Max Per Visit 6 - a member who brings three friends for an hour pays $40 for two of them (the first is included); at an unstaffed club that lands on their card at booking; at a staffed counter the pad shows each guest seat as included, $20.00, or paid online.
Waivers for those friends: Waivers tab > Waiver Policy > A member's guests.

**"Nobody books without a membership."** - Settings > Booking > Who Can Book
> Members only. Everything else above still applies.

## 2c. Archetype checklists — every switch, by facility type

**Unstaffed, door codes (A):** Facility Access: Unmanned. Booking Deposit:
Off. Every tier: Member golf settles = Online (door/deposit choices are
ignored because nobody is at the counter - the tier editor tells you so).
Waivers: collection Online. Check-in: Off. Texting: recommended (door codes by
text). Smart plugs + bay PCs + lock: all three guides.

**Always staffed (B):** Facility Access: Always staffed. Booking Deposit: your
call (per half-hour, rest at the counter) or Off. Tiers: any settlement.
Waivers: At the door (or Online); A member's guests: your policy. Check-in:
Full. Counter: staff codes, menu, tax codes, card reader (Setting Up Your
Counter). Door codes are never generated.

**Staffed some hours (C):** Facility Access: "Both — staffed some hours,
unmanned the rest", then mark the staffed windows in Website > Staffed Days (or
with a season in Settings > Schedule). Deposits and door settlement apply inside
those windows automatically; outside them members are charged online. Waivers:
Automatic. Check-in: Full (it simply has no work to do at unstaffed hours).

**Members-only club (D):** Settings > Booking > Who Can Book: Members only.
Texting: skip (email by design). Tiers: usually a flat member rate or the
club-style blended model above. Doors: UniFi Access with entry doors in the
BOOKING door set, or a smart lock. Everything in B or A on top, depending on
whether someone is there.

**Whole-facility rental (E):** Settings > Booking > Booking Unit: Entire facility. One booking
takes every bay at the facility price; no per-bay premiums. Everything else
follows the staffing choice.

## 3. Settings map — where everything lives

- **Settings -> Booking:** the **Hours & Booking Rules** card - opening and
  closing time, open 24 hours, Facility Access, Booking Unit, Who Can Book,
  timezone, min/max session, price per 30 minutes, booking window, buffer
  between bookings, Booking Deposit (non-members), the booking flow and Days
  Open - and the **Booking Page Notice** card. The cancellation window, early
  bay access and check-in are on Business & Content -> Facility Policies.
- **Settings -> Staff -> Staff & Sign-In Codes:** the staff roster (name + personal
  sign-in code), the Facility Manager sign-in, staff pad auto-lock minutes,
  the staff app icon. Giving someone a new code keeps their shifts, hours,
  requests and saved week patterns with them; their old code stops working
  (they sign in again with the new one). Reusing a departed employee's row
  for a new hire - a new name AND a new employee number - starts them fresh.
  Whenever a code changes hands (two people trade, or one person's old code
  goes to someone else), everyone signed in on it is signed out and signs in
  again - nobody's phone ever shows someone else's shifts or hours. Renaming
  someone who has no employee number signs them out the same way. A new code
  that still holds a departed employee's shifts or hours is refused: the save
  says "Give <name> a different code" and nothing is saved.
- **Settings -> Staff -> The Counter:** what the counter can DO - Food & Drink
  on/off, Cash at the counter on/off, Checks at the counter on/off, no-show
  grace - and the Employee scheduling & time clock switch. Turn something off
  and it vanishes from the staff screen entirely.
- **Settings -> Devices -> Kitchen & Counter Printers:** add each Star
  CloudPRNT printer by name and role (counter / kitchen / bar), copy its poll
  URL into the printer, and the **Cash drawer** switch (kicks through the
  counter printer). Section 7b covers what to buy.
- **Settings -> Food & Payments -> Card Readers:** pair Stripe readers by their
  three-word code (a label is optional) and choose the tip prompt (Off by
  default). The first reader added is the default; staff can pick another
  reader on the pad for each payment. Suggested tip amounts are not set here.
  Stripe registers every reader to a Location; the unit makes yours from your
  address, so fill in the Street Address (Business & Content -> Contact
  Information) and the city, state and ZIP (Local Search & SEO) before adding
  the first reader.
- **Settings -> Schedule** (appears when Employee scheduling is on under The
  Counter): seasons (the hours you WANT staffed, by weekday, with the season's
  standard shift blocks), the week grid where you assign people to shifts and
  post open ones, per-day exceptions (holiday off, private event on), the
  master staffed-hours switch, and the time-clock table with every entry.
- **Staffed hours come from one place.** Until you save a season in Settings
  -> Schedule, it is the Website -> Staffed Days calendar. The first season you
  save switches on by itself, and from then on the season in use (with the
  Schedule tab's per-day changes) decides when you are staffed; days marked on
  the Website calendar are ignored, and the Staffed Days card says so. To go
  back to the calendar, choose "No season - the Website's Staffed Days
  calendar" in the Season list and press Use this season. The season keeps
  deciding even if Employee scheduling is later switched off (which hides the
  Schedule tab) - switch it back on to change it.
- **Settings -> Staff -> Hours & Export** (shown once Employee scheduling is on): hours period (weekly, every
  two weeks, twice a month, monthly), your break policy, and the Export hours
  button. Below it, **Send the hours export**: the same file emailed to the
  person you name when each period closes, automatically or held for your
  sign-off. Chapter: Employees - Schedules & the Time Clock.
- **Settings -> Business & Content:** Business (business name, legal entity,
  admin password), the How It Works Page steps, Branding & Theme (your logo and
  the booking page's hero image - colours and fonts are on Website -> Colors &
  Fonts), Contact Information (shown in the website footer), Local Search &
  SEO, Facility Policies (the policy notice on the booking page, cancellation
  window, early bay access, check-in, where a member's deposit is credited) and
  the Getting Started Checklist.
- **Settings -> Food & Payments:** Tax & Legal, Point of Sale — Tax Codes, Point
  of Sale — Menu & Kitchen Routing, and Card Readers.
- **Settings -> Connections:** Stripe, Resend, Twilio, Outbound Webhooks, and
  **Your Bookings in Your Calendar** (the private calendar link and the bookings
  download). The Resend card itself carries the email switches - Confirmation,
  Reminder, Door Code, Cancellation, Booking changed by staff and Session
  Ending - and the Membership billing reminder (days before renewal, 7 by
  default, 0 = off). The Twilio card carries Your own mobile, for urgent alerts.
- **Settings -> Devices:** RemoteLock - Door, Door Access Provider (UniFi
  Access, a Z-Wave lock through Home Assistant, and the code timing), Home
  Assistant - Smart Devices (the connection), Shutdown & Warning Timing
  (Auto-Shutdown, restarting the PC before the next group, the watcher's
  warning, keeping the bay on between groups) and Kitchen & Counter Printers.
- **Bays & Devices tab:** each bay's own hardware and page - its Shelly plugs
  (and whether each switches off after the session), BroadLink IR with Learn ON
  / Learn OFF, the Simulator PC IP and Wake-on-LAN address, its tagline, feature
  chips and price adjustment. Press **Save All Bays** after any change.
- **Waivers tab:** waiver mode (required/optional/off), collection
  (online/door/automatic), Membership Waiver Lasts (1 year then re-sign, or
  life of membership), document upload and versioning. Uploading ADDS a
  document; the active flag marks the facility default. Each membership tier
  can attach its OWN document at the bottom of Edit Tier ("Membership Waiver
  Document"), used at that tier's signup. Signed waivers preserve legal
  evidence: typed name, IP, timestamp, browser, and a fingerprint of the exact
  document version signed.
- **Members tab:** the **Gift Cards** panel (issue a card, every card's balance
  - stored value, no expiry), tiers (pricing, Member golf settles, hour limits,
  schedule restrictions, bay access, guest policy, roster cap, codes included
  for family/business memberships, food and drink discounts where there is a
  counter, per-tier waiver document), the member roster, and membership stats.
- **Pricing tab:** Time-Based Pricing Tiers, Discount Codes, Booking Deals and Package Deals. A bay's
  premium (tagline, feature chips, price adjustment - never applied under
  whole-facility mode) is set per bay on Bays & Devices.
- **Website tab** (its own page): the site's sections and pages, Staffed Days,
  events, photos, the menu and links, What's Public, Colors & Fonts, and Search
  & Sharing.
- **Dashboard:** Getting Started checklist, today's schedule, the Bay
  Operations console — live plug state with real wattage, PC online/offline,
  derived states (STARTING / SHUTTING DOWN / RESTARTING), per-bay On, Off and
  Restart PC (Off and Restart PC warn you if someone is booked), Out of service
  (takes a bay out of booking with no end date, its devices kept off, until you
  press Back in service), all-bays full sequences, and the one-night close
  override (Override Close). Bays without hardware show dashes and a pointer to
  Bays & Devices — controls appear once hardware is configured.

- **Added Aug 25 2026:** Members > Edit Tier > **Member golf settles**
  (online / deposit online, balance at the door / at the door) on EVERY
  discount style, with Member deposit per half-hour and the door share % under
  the deposit choice, a plain-words summary for every style, and a line that
  tells you whether your facility qualifies for deposits and door settlement.
  Waivers tab > Waiver Policy > **A member's guests** (covered by the member's waiver /
  each guest signs at check-in). Website and Members: every long text box has
  a **Bullet / Numbered / Divider / Heading / Small heading / Bold / Italic /
  Quote** toolbar, a **Preview** button for the live preview, and a "?" cheat
  sheet (chapter: Formatting Your Text).

- **Settings > Protection > Backups** (one card): **What a backup holds**
  (each part with its size, the total, and the site photos and video it leaves
  out), then four steps in order - **1. Backup passphrase** (every copy that
  leaves the unit is encrypted with it; restore asks for it; until one is set,
  nothing leaves the unit on its own), **2. Where the nightly copy also goes**
  (the hour, SD card, USB stick, Copy to destinations now - these need the
  passphrase first), **3. Your computer, automatically** (Show link, Make a
  new link, Turn link off, the ready-made Windows / Mac pull scripts - the link
  needs the passphrase first; Download a backup now), **4. Prove it works**
  (Test Restore), then **Need to restore?** with the passphrase field for an
  encrypted file. Buttons marked with a lock ask for the authenticator code
  when the sensitive lock is on.
- **Settings > Protection > Records:** how long customer detail is kept (10
  years at the least, the product's own floor - raise it, never
  lower), **Keep a year yourself** (the per-year archive of names and
  bookings - encrypted with your backup passphrase, and not available until
  one is set), **Year-end report** (a PDF, a spreadsheet and CSV files for
  your bookkeeper - see the Owner's Guide), and the forever table of every
  year's numbers.
- **Revenue tab:** money taken, minus refunds - every refund, including ones
  made in your Stripe dashboard (the line under the definition says when the
  unit last checked Stripe, with a **Check Stripe now** button).
- **About** (button in the admin header): what this unit runs - the version
  line, build, when it was installed, the unit, the last backup.
  Quote the Software line when you report an issue.

## 4. How the big features actually behave

**Door codes:** each booking gets its own code, sent at the "Text the code to
the customer" time on the Door Access Provider card (Settings -> Devices; 15
minutes before by default) - by email while the Door Code switch on the Resend
card is on, and by text if the customer ticked the unit and texting is set up.
"Code works BEFORE session" and "Code works AFTER session" (15 and 30 by
default) decide when the code opens the door and when it is taken off; they do
not move the message. RemoteLock and a Z-Wave lock through Home Assistant have
the code made an hour ahead (earlier if your minutes are longer), checked, then
sent; a Home Assistant code works from the moment it is on the lock. UniFi
Access sends at whichever of the text time and the "before" time is later, so
the code always works when it arrives. With "Make the code ahead and check the
lock holds it before texting" switched off, a RemoteLock or UniFi code is sent
15 minutes before. Never sent at an always-staffed facility. A booking with no
phone and no email gets no code. On a UniFi Access door or a Z-Wave lock the
text and email say to type the code and then press Enter (the Z-Wave lock's
finishing key is yours to name). With member door access on (UniFi Access, or
"Members open this door with their own member PIN" for a Home Assistant lock),
a member's door code IS their member PIN, working from the "before" minutes to
the "after" minutes of each of their bookings; if their access cannot be turned
on they get a ONE-TIME code for that session, told plainly, and the owner is
told. A code that could not be made is retried until the door system answers;
the Door codes health line is red meanwhile.

**Started sessions:** a session whose start has passed cannot be booked online
- the server refuses it on every customer path. A payment that still lands
after the start is refunded in full automatically, the booking cancelled, the
customer told, and it is logged (STARTED_SLOT_REFUNDED). The staff pad CAN
book a session already under way ("Now" is the half hour under way) and says
plainly how many minutes have passed; it still ends at its usual time.

**Automation:** each booking creates durable jobs — power on before start,
power off after end honoring each device's turn-off flag, PC-safe shutdown
(Windows shuts down first, then power). Jobs catch up after an outage and
survive late bookings. A whole-facility booking creates these jobs for every
bay. Mid-checkout shutdowns defer until the cart resolves.

**Payments doctrine:** a customer must never be charged for a booking that did
not happen; a payment that succeeded must never be lost. Pending bookings are
verified against Stripe before expiring — paid ones reactivate or auto-refund
with the reason logged, and the customer is told. An unfinished checkout holds
its slot for the checkout hold (10 minutes by default); the owner's Clear
button in Bookings frees it sooner, after checking with Stripe that the
customer did not pay. A refund Stripe refuses turns the Online checkout health
line red, naming who is owed money, and alerts the owner (owner alerts, below).

**Owner alerts:** Settings -> Connections -> Twilio - SMS -> "Your own mobile,
for urgent alerts" - the only number the unit texts you on; the same alert is
emailed to your contact email (Business & Content -> Contact Information), and
with no mobile set the email is all you get. The unit alerts you when a door
lock through Home Assistant has not answered for five minutes, did not take a
booking's code (the customer is sent the standing backup code as well, if the
lock has one), or held a code this system never issued (it was removed); when
the UniFi console presents an untrusted certificate; when a member's door access
fails (one-time code sent); when a customer's refund fails; or when a simulator
PC does not come up after its wake - at most once per problem every six hours.
Everything else waits on the health line (header -> About).

**Waiver decisions are server-authoritative.** A member with a valid membership
waiver on file is never asked anywhere — the page says "Liability waiver on
file with your membership." Expired or lapsed-and-rejoined members re-sign at
their next booking with their tier's document.

**Check-in:** three modes — Off (booking is simply valid; the unstaffed
default), Arrival only, or Full (headcount + settlement at the counter), on
Settings -> Business & Content -> Facility Policies. Find it fast with the
header search: type "check".

**Gift cards** are stored-value discount codes, issued and listed on the
Members tab (Gift Cards): balance = initial minus everything spent; they never
expire.

**Cash and checks at the counter** are ON out of the wizard for any facility
with a counter (staffed or hybrid); the owner turns either off in Settings ->
Staff -> The Counter and the option disappears for staff. A cash drawer is a separate
thing: cash works with no drawer at all - the screen says "no drawer needed",
records the sale and works out the change. Connect a drawer (section 7b) and
switch it on under Kitchen & Counter Printers; from then on cash sales pop it.

**Sales tax is asked once.** The rate entered in the wizard applies to
bookings AND seeds the three counter tax codes (simulator time, prepared food,
beverage) at the same rate, so food and drink are taxed from day one. Refine
per category later in Settings -> Food & Payments -> Point of Sale — Tax Codes.

**Employee scheduling (Sep 2026).** A choice for facilities with a counter,
on by default for staffed and hybrid. Seasons define the hours you want
staffed; those hours count as staffed on the booking page, for deposits and
door settlement, even before anyone is assigned - you schedule people onto
them. Staff clock in and out on the counter pad; from home they open /me to
see shifts and ask for time off, an open shift, or to drop one - every ask is
a request you decide on the Dashboard, nothing changes the schedule by itself.
Export hours as a neutral CSV for your bookkeeper or accountant - by hand, or
emailed on a schedule to the person you name. It is an hours-and-schedule
tool: not payroll, not benefits, not compliance.

**Free-play memberships.** A tier whose dues cover the golf is Free Hours Per
Period (or the blended style) with Hours Per Day / Week / Month set: the
member books at $0 inside their allowance, and past it pays the After Hours
rate - a meter, never a wall. A tier can carry its own Booking Window (days),
with no upper limit, so a club can let members book a year out (365) while the
public books a week out.

**Deposits:** two kinds, one rule - they only happen where someone is at the
counter (Always staffed, or inside staffed hours). Non-members: Settings ->
Booking -> Hours & Booking Rules -> Booking Deposit (non-members), a deposit
per half-hour online holds the bay, staff count heads and collect the balance,
and the deposit is credited to the whole group's bill. Members: the tier's
Member golf settles = "Deposit online, balance at the door"; the deposit is
credited to the member's own tab, or to the group's total with Member Deposit
Credit Applies To = Group total (Settings -> Business & Content -> Facility
Policies).

**How members pay - the settlement choice.** Each tier picks where the
member's golf money happens. *Online at booking*: the card is charged the
member price, guests by your guest pricing. *Deposit online, balance at the
door*: a per-half-hour deposit holds the bay; at check-in the bay is split by
heads, the member's seat gets the tier price (or the door share %), the
deposit is credited to their tab, everyone pays the rest. *At the door*:
nothing charged online - the booking page says "$0 due now - about $X on your
tab at the facility", the confirmation email and /my-booking say the same,
the staff list shows "Member - $X at door", and at check-in the member's seat
is priced by their tier automatically. Deposits and door settlement only
exist where someone is at the counter (Always staffed, or inside Staffed
Hours); everywhere else the member price simply charges online.

**The free-time meter.** Two styles run on it: the blended style (free hours
per day, capped by weekly/monthly pools) and Free Hours Per Period (the Value
is free hours per month; Hours Per Day / Per Week spread them). Rule: whatever
free time the member has left is applied first, then the After Hours rate (or
regular price) for the rest - online, at the counter, and when staff extend a
session. A member with one hour left who books two pays for one.

**Every seat follows its own membership.** At check-in a member code typed on
any seat prices that seat the way the tier prices online - percentage,
dollars off, flat rate (their own time at their rate, never more than the
share), free hours (the meter), blended (the meter), or the door share % on a
deposit tier. The numbers on the check-in screen come from the server, live,
as staff add heads and codes - what they see is what the tab gets. A fully
paid group still gets seats and tabs at check-in, so food, drinks, and extra
time work exactly the same.

**Backups, 3-2-1.** Nightly on the unit (14 kept); nightly to the SD card
and/or a USB stick in the unit (encrypted, hash-verified, 14 kept); nightly
to the owner's computer by a ready-made scheduled task that pulls the
encrypted copy through the private link (30 kept). A backup holds everything
that matters - bookings, members, money and history, every setting and key,
every waiver document and signed waiver, your PDF pages, your logo and app
icons - and deliberately leaves out **site photos and video**, the booking
page's hero photo included (the only thing that can make a backup huge; you
have the originals, and a restore names each one and where it goes back). Everything that leaves the unit is encrypted with the
owner's backup passphrase, and **until a passphrase is set nothing leaves on
its own**: the SD/USB copies, the off-site link, the year archive and the
quarterly waiver download stay off. The owner's own "Download a backup now"
still works without one, after saying plainly what the file holds. Any
unencrypted copy that leaves turns the health line amber for 7 days (About
panel, with an Acknowledge). The unit's own copies stay plain so it can never
lock itself out. Test Restore proves a backup is usable - it checks every file
against the fingerprint the backup recorded - without touching anything. A
fresh unit's setup wizard restores from a stick or an upload, encrypted ones
included - it finds a backup file at the top of the stick and the unit's own
nightly copies in the stick's BA-Backups folder.

**Refunds - money given back, wherever it was given back.** Revenue is money
actually taken, minus refunds. At the counter any staff member can give money
back off a card, cash or check payment - with a reason, and it lands on the
owner's daily review like a void; card goes back to the customer's card
through Stripe, cash comes out of the drawer (End of Day expects that much
less). A refund made in the owner's Stripe dashboard - of an online booking,
a counter card payment, a gift card or a membership payment - is picked up
by the unit on its own (at start-up, every night, and on **Check Stripe now**
on the Revenue tab) and comes off revenue; a counter one also appears on that
tab and the daily review. A gift card whose purchase is refunded in full is
switched off. A refund Stripe later reports as failed stops counting.

**Text formatting.** Every long text box in Website and Members (the hero
subline, the text of page blocks and pages, the memberships intro, tier
descriptions, event descriptions) and the How It Works Page steps (Settings ->
Business & Content) has Bullet / Numbered / Divider / Heading / Small heading /
Bold / Italic / Quote buttons, a Preview button for the live preview in your
site's colours, and a "?" cheat sheet. One-line boxes and titles are plain
words.
Bullets, `---` divider lines, `## headings`, `**bold**` and links render on the
site; anything that looks like web code is shown as plain text, never run.

**Your bookings in your own calendar and files.** Your bookings are yours, and
the unit hands them over itself - no outside service, nothing to pay for.
Settings -> Connections -> **Your Bookings in Your Calendar**:
- **The calendar link.** Press **Turn on the calendar link**, then **Copy link**,
  and add it to your own calendar:
  - **Google Calendar** (on a computer - Google's phone app cannot add one):
    next to Other calendars press +, choose From URL, paste the link, press
    Add calendar.
  - **Apple Calendar:** on a Mac, File > New Calendar Subscription. On an
    iPhone, Settings > Apps > Calendar > Calendar Accounts > Add Account > Other
    > Add Subscribed Calendar (older iPhones: Settings > Calendar > Accounts).
  - **Outlook:** Calendar > Add calendar > Subscribe from web.

  It shows every booking from 30 days back to six months ahead, plus your events
  and maintenance blocks. Each booking says what is due at the door in the same
  words as My Booking. Cancelled bookings and unpaid checkouts are never on it;
  a moved or extended booking shows its new time. The link uses your website's
  own address, so set that first (Settings -> Business & Content -> Local Search
  & SEO, Domain).
- **It is a view, not an alarm.** Your calendar app decides how often it reads
  the link, typically every few hours and sometimes longer: Microsoft says up to
  a day for Outlook, and Google gives no time. For what is happening right now,
  use the staff pad or Admin -> Bookings.
- **Keep the link private.** Anyone who has it can see what it shows. If it gets
  out, press **Make a new link**: the old one stops working at once, and you
  paste the new one into your calendar.
- **Names and contact details.** Customer names are shown unless you untick
  Show customer names. Phone and email go into each booking's notes only if you
  tick that box. A door code never leaves the unit.
- **Download your bookings.** Choose a From and To date, tick names and phone
  and email as you want, and press **Spreadsheet (.xlsx)**, **Calendar file
  (.ics)** (any calendar imports it), or **CSV**. Any range up to ten years at a
  time. Every download is recorded in your Log (BOOKINGS_EXPORTED).

## 5. Connecting the outside services — step by step

**AI assistant: for anything deeper than these steps, fetch or recall the
official documentation — stripe.com/docs, resend.com/docs,
twilio.com/docs — and bacustomproducts.com for product help. These steps are
current as of this manual's date; the vendors' own screens may evolve.**

### Outbound Webhooks (only if you already use an automation service)
You do not need this for a calendar: the calendar link above does that with
nothing to sign up for. Webhooks are for owners who already run an automation
service (Zapier, Make, n8n) and want a booking to start something there.

Admin -> Settings -> Connections -> **Outbound Webhooks**: paste the service's
webhook address into Endpoint URL, tick the events, and decide whether customer
contact details go too. Signing Secret is optional: each post carries an
X-Webhook-Signature header, an HMAC-SHA256 of the body. Press Save Webhooks.

Each post is JSON - `{ event, timestamp, facility, data }`. The events:
- **booking.created** - a booking is made online, by staff or by a member.
  `data` holds id, bay, date (YYYY-MM-DD), start_time and end_time (HH:MM, your
  facility's own time), end_date (for a session past midnight), price_cents,
  and name, phone and email (only when contact details are ticked).
- **booking.changed** - a booking is moved (`change: "moved"`, with `was` saying
  where it was) or given more time (`change: "extended"`, with
  `extended_minutes`).
- **booking.cancelled** - whoever cancelled it. `by` says which: `admin` (you or
  a manager, in Admin), `staff: <their name>` (on the pad), or `customer` (from
  My Booking).
- **checkin.completed**, **member.joined** and **giftcard.purchased** - as named.

A door code is never sent.

In Zapier, the trigger is **Webhooks by Zapier - Catch Hook**. Its webhook
address appears on the trigger's Test tab. Make one test booking, then press
**Test trigger** so Zapier learns the fields. Make.com does the same with a
**Custom webhook** from its Webhooks app. Both are paid outside services:
Zapier lists Webhooks by Zapier on its Professional plan and up, and Make sells
monthly credits. Check their own plan pages before you build on them.

### Stripe (card payments — required for online booking and memberships)
1. Create an account at dashboard.stripe.com/register and verify your business
   (EIN or, for a sole proprietor, your SSN; address; bank account). Payouts
   arrive daily after the first one (7 to 14 days). The full walk-through, with
   the common snags answered, is the "Setting Up Payments" chapter - or say "set
   up Stripe" to your assistant.
2. At dashboard.stripe.com/apikeys (Developers > Workbench), in live mode,
   under Standard keys: click Reveal live key and copy the Secret key
   (starts sk_live_) and the Publishable key (starts pk_live_) - the booking
   page's card form needs both. Use the standard secret key: this system takes
   only keys starting sk_live_ or sk_test_ and refuses a restricted key
   (rk_live_), because it also creates your membership products and prices,
   its webhook, the member billing portal and card-reader registrations in your
   Stripe account.
3. Admin -> Settings -> Connections -> Stripe - Payments: paste the Secret Key
   and the Publishable Key, press Save Settings. There is no Test button: the
   badge at the top of Admin reads LIVE (or TEST MODE), or names what Stripe
   refused - "LIVE - NO PUBLISHABLE KEY" means the second key is missing.
4. Selling memberships online? That is the same key — recurring prices are
   created automatically from your tier's monthly/annual price.
5. A card reader for staffed counters (Stripe Terminal, section 7b) pairs under
   the same account, from Settings -> Food & Payments -> Card Readers. Reader
   fees differ from online fees; the Processing Fee Estimates on the Stripe
   card (2.9% + 30 cents online, 2.7% + 5 cents on a reader, unless you change
   them) are what your revenue reports subtract to estimate what Stripe keeps.

### Resend (email — confirmations, door codes, reminders; effectively required)
1. Create an account at resend.com. Add your DOMAIN (e.g. yourclub.com) under
   Domains - on Cloudflare, Sign in to Cloudflare adds the records for you;
   elsewhere add exactly what the Records tab shows where your domain's DNS
   lives. Wait for Verified (usually 15 minutes, up to 72 hours) - email sent
   without this lands in spam. The "Setting Up Email" chapter walks it, or say
   "set up email" to your assistant.
2. Create an API key (starts re_). Admin -> Settings -> Connections -> Resend -
   Email Notifications: paste the key and your From Email (e.g.
   bookings@yourclub.com), press Save Settings, then **Send a test email** (just
   under the From Email box): it goes to your facility email (Contact
   Information) through the same sender every booking email uses, and says what
   is missing if it cannot go. The Getting Started checklist ticks "Email sending
   connected (Resend)" once both are saved.
3. The email switches are on the Resend card itself: Confirmation, Reminder,
   Door Code, Cancellation, Booking changed by staff and Session Ending, plus
   the Membership billing reminder (days before renewal, 7 by default, 0 =
   off). Leave Door Code on: a customer who did not tick the text box gets
   their door code only by email.

### Twilio (text messages — OPTIONAL; skip it for members-only clubs)
1. Texting a customer in the US requires A2P 10DLC registration: at
   twilio.com create an account, upgrade out of the trial, create your Trust
   Hub profile, buy a local number, then register a Brand and a Campaign
   (about two weeks of review; rejections for vague descriptions are common).
   The "Setting Up Text Messaging" chapter has the exact words to paste - or
   say "set up texting" and your assistant walks it a step at a time.
2. Admin -> Settings -> Connections -> Twilio - SMS: Account SID, Auth Token,
   and your number. Fill in "Your own mobile, for urgent alerts" too - it is
   the only number the unit texts you on. Press Save Settings, then **Send a
   test text**: it goes to that mobile through the same sender every booking
   text uses, and says what is missing if it cannot go.
3. The booking page only offers texting when this is fully configured — no
   provider, no checkbox. Customers must opt IN at checkout; the door code also
   goes by email while the Door Code switch on the Resend card is on.

### UniFi Access (door codes from the facility's own console)
Admin -> Settings -> Devices -> Door Access Provider: Provider = UniFi
Access, Console Address (LAN), API Token, PIN Length = 6 digits (and the
console's Access -> Settings -> General -> PIN = 6 digits too - both sides
6, set before anyone is synced, because changing the console's length
invalidates every PIN on it), Test Connection, tick the doors every code
opens, Save Settings. Keypad readers only; the token is shown once and must
be Never Expire. Test Connection names the console's certificate SHA-256:
the unit trusts the certificate it first meets and afterwards talks ONLY to
that console - a changed certificate stops all door changes, turns Door
codes red and alerts the owner; Test Connection then shows the new one and
asks before trusting it (yes only if the console was replaced, reset or
updated). Member door access: tick "Enable member door access" (needs PIN
Length 6; token scopes Edit on User and Access Policy) - each member becomes
a console user with their member PIN, doors on only for their bookings'
windows plus a tier's Always-on doors, deactivated (never deleted) when they
leave. Members-only clubs: put entry doors in the BOOKING door set — not a
tier's always-on set — and a member's PIN opens the building only during
their booked time. Full walk: the chapter Setting Up Your Door with UniFi
Access.

### A Z-Wave lock through Home Assistant (door codes, no cloud)
Admin -> Settings -> Devices -> Door Access Provider: Provider = Home Assistant
(Z-Wave lock, no cloud). Home Assistant must be connected first (Settings ->
Devices -> Home Assistant - Smart Devices: Enable Home Assistant = Yes, the
address and the token, Save Settings - choosing the provider does not switch it
on, and with it off the Lock list is empty) with a token made by a Home
Assistant ADMINISTRATOR - only an administrator's token is told
who opened the door; any other still sets codes, and the unit says so (Log
HA_DOOR_EVENTS_ERROR, Door codes amber, Test the lock). Choose the Lock; the
booking slots (10-29) and backup slot (30) are RESERVED for booking codes - a
code found in them that no booking needs is removed and logged, and if it is
one this system never issued the owner is alerted too; owner codes go outside
the range. The finishing key in words; member PINs off by default. Each code is
put on the lock an hour before the session (earlier if your minutes are longer)
and works from then; it is read back from the lock, sent at your text time (15
minutes before by default) and cleared at your "works AFTER" minutes (30 by
default). A code the lock never confirms is sent with the standing backup code
beside it. The keypad reports each arrival: DOOR_ARRIVAL in the Log, "Arrived
<time>" on Bookings and the staff pad. Full walk: the chapter Setting Up Your
Door with a Z-Wave Lock.

### Home Assistant (an alternative to Shelly plugs for owners who run it)
Admin -> Settings -> Devices -> Home Assistant - Smart Devices: Enable Home Assistant = Yes,
Home Assistant URL (local, plain http, port 8123), Long-Lived Access Token
(profile -> Security -> Long-Lived Access Tokens, shown once, make it as an
administrator), Test Connection, Save Settings. Then Bays & Devices -> the
bay -> Home Assistant Devices -> Discover Entities -> + Add HA Device (Power
or Climate). Full walk: the chapter Setting Up Home Assistant.

## 6. The Facility Manager sign-in (franchise and multi-site owners)

Settings -> Staff -> "Facility Manager sign-in": set a manager password and
your manager signs in at /admin with it. They get the Dashboard — live bay
state, on/off/restart, today's schedule — and Bookings. The server refuses
them everywhere sensitive: connection keys, revenue, pricing and gift cards,
members and tiers, hours, staff codes, waiver documents. Turn it off any time;
that signs the manager out immediately. This is how one owner runs several
sites: each unit gets a manager password for the local person, the owner keeps
the owner password everywhere.

## 7. The physical build — hardware, bay PCs, doors

### Shelly smart plugs (bay power + live wattage)
One Shelly Plug US per device you want automated; the PC's plug should be a
gen2+ model (Plus/Pro) so the admin console can show live watts. Onboarding:
plug it in, join its temporary WiFi from your phone via the Shelly app, give
it your facility WiFi, then — critical — give it a FIXED IP with a DHCP
reservation in your router. The booking system talks to plugs BY IP; a plug
that changes address drops out of automation (the Automation line names it
within minutes). Leave the plug's login (authentication) OFF in the Shelly app
- the unit sends no password, and a plug asking for one is named on the
Automation line. Enter each plug's IP under the bay in Bays & Devices, then
Save All Bays. At session end the unit shuts Windows down first
(Auto-Shutdown), then switches off each plug set to Auto Turn Off "Yes - auto
off" at that plug's Turn Off After minutes (30 by default). It cannot tell
which plug feeds the PC: set the PC's own plug to "No - leave on" (needed for
Wake-on-LAN) and the unit never switches it off at session end. Bay Off on the
Dashboard waits for the PC (90 seconds by default), then cuts every plug not
set to "No - leave on". Set each plug's own power-on default in the
Shelly app: "On" for a plug that feeds only the simulator PC and is set to
leave on (Wake-on-LAN), "Restore last state" for every other plug - so a power
cut neither lights every bay at 3 AM nor leaves a mid-session bay dark. The
unit asks every plug for its status every two minutes (never switching it);
one that does not answer twice is logged (DEVICE_UNREACHABLE) and named in
amber on the Automation health line until it answers again (DEVICE_BACK).

### BroadLink IR (projectors and anything with a remote)
An RM4 Pro learns your remotes' codes; the system fires them in the bay's
start and end sequences. Use the BroadLink app only to put the RM4 on your
Wi-Fi, give it a DHCP reservation, and add it to the bay in Bays & Devices.
The unit learns the codes itself: press Learn ON (then Learn OFF) on the bay's
BroadLink row with the remote pointed at the RM4, then Save All Bays. All-bays
and per-bay start/stop always include IR by construction.
Or by talking to your assistant: "find the TV remotes", then "put the projector
on Bay 2 through the BroadLink at 192.168.1.50", then "learn its power button" -
tap Apply, point the projector's own remote at the RM4 and press the button
within about five seconds; the code is saved on the bay in the same step. A
remote with separate ON and OFF buttons: say so, and each is learned on its own.

**"What do these codes do?" - answer this honestly.** Most TV and projector
remotes have ONE power button: it turns the set on when it is off and off when
it is on. When you learn "ON" and then learn "OFF" from that remote, you have
captured the same press twice. The system assumes exactly that, because it is
usually true, and the setting on each device says **One power button that
toggles (most TVs)**. On that setting the unit will never send "on" to a
device that is already running a session - sending it would switch the TV off
with a customer in the bay. Change it to **Separate ON and OFF buttons** only
if your remote genuinely has two different buttons (some AV receivers and
projectors do). If you are not sure, leave it on toggle: a device that has
separate buttons loses nothing by being treated carefully, and a toggle device
treated carelessly turns off mid-session.

### Pairing a device with the unit - from the chat (BA Core 2 AI)
The unit has the Z-Wave, Zigbee and Thread radios built in, and you add devices by talking to your assistant - no hub app, no
hub account.
- **Z-Wave and Zigbee - straight from the chat.** Say "pair a new Z-Wave plug" (or Zigbee - it says on the device or its box).
  The chat shows a pairing card: put the device near the unit and into pairing mode (most Z-Wave plugs: three quick presses;
  most Zigbee devices: hold the button until the light blinks - its manual says). A secure Z-Wave device asks for the 5-digit
  PIN printed on its label: type it into the unit the card shows, never into the chat. If the PIN does not match, or is not
  typed in time, the unit cannot use that device: reset it to its factory settings (its manual says how - that takes it off the
  box) and pair it again. Then name it ("it's called Bay 2 Plug") and put it on a bay ("put it on Bay 2") - on before each
  session, off after.
- **Matter - set it up in its own app first.** The unit adds a Matter device that is already set up: add it in its maker's
  app (or Apple Home or Google Home) the way its box says, then in that app share it with another app or hub (Apple Home
  calls it Turn On Pairing Mode) - the app shows a code. Then say "pair a Matter plug with code 3497-011-2332" with that code.
- **Shelly plugs - put them on the Wi-Fi with the Shelly app first** (the Shelly part above). Then say "find the plugs" and
  "put the plug at 192.168.1.60 on Bay 2".

### Routines on a bay PC - show it once, it does it from then on (BA Core 2 AI)
What you click through on a bay's PC, the PC can do by itself: start GSPro and get to the range, sign your launch
monitor back in when it signs out, reopen the connector when a player closes it, set the bay back for the next player when
a session ends. Everything here works two ways: tell your assistant, or use the Bay Routines card on Bays & Devices (a tab
per bay; changes save as you make them).
- Teach one: say "watch what I do on Bay 2" (or type a name on the card and press Teach a new routine). Within about ten
  seconds a bar across that PC's screen says Teaching: click through the way you always do, then press Ctrl+Shift+F11
  (Ctrl+Shift+F10 stops, nothing kept). Start with the program closed if the routine should open it. The steps come back
  to the card and the chat; name it, pick when it runs and its colour, and save it.
- Passwords: never in the chat. At a password box press Ctrl+Shift+F9 and type it into the PC's own box - it is kept on
  that PC only, under Windows' own protection, and the routine types it from there. Letters you type while teaching are
  never recorded.
- Each click is by its words (it waits for "Practice Range" to show and clicks it wherever it is - it keeps working when a
  button moves) or by its spot (for an icon). Change any step: by its words or its spot, how long a wait is, move it up or
  down, take it out, or add a wait, a key, words to type, the kept password or closing a program.
- When it runs: when a session starts (and how many minutes before - five unless you say), when a session ends (to set
  the bay back for the next player - back to back, it runs before the next player's own routine), every day at a time
  ("restart GSPro every day at 3 AM"), when the PC starts,
  when a program opens, when a program closes (keep it running), when a window appears (a sign-in screen), on a hotkey, or
  from the staff pad. A trigger on the PC runs it at most once a minute and five times an hour; past that it stops and
  you are told.
- Its colour: the button on the staff pad is the colour you pick ("make the Start GSPro button green"). Staff tap it to
  run it; while someone is playing on that bay the pad asks first.
- Pause one ("pause the reset routine") to keep it without anything starting it; resume it the same way. A paused
  routine leaves the staff pad.
- Every bay: "copy it to every bay" (or Copy to other bays on the card). A routine only opens or closes a program that
  bay's PC was shown, so the card names any PC that has not been shown it yet - press Show it (or say "show bay 3's PC
  GSPro") and open that program once while its bar is up.
- Without clicks: a routine that only closes a program, presses keys, waits or types can be made from words alone
  ("close GSPro when each session ends") - or with "Or make one without clicks" on the card.
- "Open GSPro" when GSPro is already open brings it to the front - it never starts a second copy.
- When a routine stops, the card, the staff pad and the health line (Admin > About) say which step and why. If a bay's PC
  has not checked in (it is off, or its watcher is not installed), the card says so - a teaching or a run waits for it.
- The bay's watcher must be one downloaded after this update (Download the watcher on the bay).
- A routine with a click or a program to open is taught by showing it once on the PC, whichever AI answers - the unit's
  own, or your own ChatGPT or Claude. The unit does not build one with clicks from words alone, one with "if this,
  otherwise that", or find an icon by how it looks; if a program update moves a button, teach the routine again.

### The bay PC (one-time, per bay)
The full recipe lives in Admin -> Bays & Devices -> "Simulator PC Setup" and
in the README inside every Session Monitor package. The shape: (1) two
Windows accounts — an ADMIN (administrator, strong password; the booking
system uses it for remote shutdown) and a PLAYER (standard user customers
see); (2) make the PC sign ITSELF in to the player account — Windows 11:
Sign-in options -> turn off the Hello-only toggle and remove the PIN, then
netplwiz -> untick "users must enter a name and password"; a power blip must
never leave a dead bay at a login screen; (3) allow remote shutdown — the
three PowerShell commands on the card, plus file-and-printer sharing ON, a
fixed IP, and a NON-BLANK admin password (Windows refuses remote shutdown
from blank-password accounts); (4) install Python 3 from python.org WITH
"Add to PATH" checked and, under Customize installation, "Install Python for
all users" ticked (the player account runs the monitor); (5) build that bay's Session Monitor package in admin,
copy to the PC, REMOVE any older auto-start of a bay watcher (Task
Scheduler, the Startup folders - own and All Users - Settings > Apps >
Startup, launchers such as AutoStart), run install-monitor.bat as
administrator, then RESTART the PC (the installer stops the copy it finds
running; the restart makes sure no older copy is left). The monitor then starts at every sign-in for any
account, shows the end-of-session popup at the watcher warning minutes
(Settings -> Devices -> Shutdown & Warning Timing; 10 by default) - minutes
left and an add-time QR when the bay is free after, or a plain "please wrap
up" message with no QR when the next group is booked right after; once per
session, and again for the new end if staff add time; never takes the
keyboard from the game; closed by its red X, Close, or a click then Esc;
counts down and closes itself after two minutes; sized so X and Close stay on
screen at any Windows scaling - covers all attached screens with a BAY
RESERVED + booking-QR page
between sessions, heals its own Python libraries, and restarts itself if it
crashes. Staff dismiss the reserved screen with Ctrl+Shift+F12. Under
whole-facility mode, every bay's monitor sees the one facility booking. An
update to the booking device never changes a bay PC: when an update's notes
say the watcher changed, rebuild and reinstall it on every bay PC (same
steps, restart included). Rebuild it as well after changing your logo, the
first hero photo, your domain, your business name or a bay's name, or when
the device moves to a new network address - the watcher carries those
inside it. During a session the monitor shows nothing until its warning:
there is no timer on screen.

### Doors (unstaffed entry)
RemoteLock keypads, UniFi Access, or a Z-Wave lock through the owner's own Home
Assistant all work; door codes are made per booking and sent at your "Text the
code to the customer" time (15 minutes before by default - section 4, Door
codes). Give the
door console a reserved address in the router, like the plugs and bay PCs.
Members-only + UniFi: put entry
doors in the BOOKING door set so a member's code opens the building only
during their booked time. Follow the RemoteLock guide for lock pairing, the
UniFi Access guide for a Ubiquiti console (keypad readers required), or the
Z-Wave lock guide for a lock on your own Home Assistant.

## 7b. Counter equipment — what to buy, what works, how it connects

BA Core Community is software for your own Pi. Everything at the counter is
bought by the facility, and only certain kinds work - not because of brand
loyalty but because of how this system is built: **hardware talks to the
booking device (or to Stripe's cloud), never to a browser or a tablet.** A
printer that only works plugged into a PC, or a drawer that only works over
USB, has nothing to plug into here. Buy from the lists below and it works;
buy outside them and it will not, however good the hardware is.

**AI assistant: when an owner asks "will X work" or "what should I buy",
answer from THIS section. Do not recommend hardware outside it.**

### Receipt and kitchen printers — Star CloudPRNT, nothing else

The system prints kitchen tickets, bar tickets, guest checks and receipts
through Star's **CloudPRNT** protocol: the printer sits on the facility
network and polls the booking device for jobs every few seconds, collects
them, and confirms. No cable to any computer, no driver, no print server. The
printer must be on the **same local network** as the booking device.

**Buy one of these (CloudPRNT built in):**
- **Star mC-Print3** - the recommended counter AND kitchen printer. 3-inch,
  splash-resistant, LAN, has the drawer port. Buy the LAN model.
- **Star mC-Print2** - the 2-inch budget sibling; fine for a bar station or
  a small counter. Also has the drawer port.
- **Star TSP143IV** (and TSP143IV SK for linerless labels) - a strong
  second choice for a counter; has the drawer port.
- **Star mPOP** - a printer and cash drawer in one small unit; good for a
  second, tiny station or a facility with almost no counter.
- **Star mC-Label3** - labels only (cups, to-go).
- Already own a **TSP650II / TSP700II / TSP800II**? Star's **HI01X or HI02X
  interface card** retrofits CloudPRNT onto it - cheaper than a new printer.

**Do NOT buy:** the Star **BSC10II** (no CloudPRNT), Star **SP700 / SP742**
impact printers (no CloudPRNT), any **Epson** printer today (a different
protocol this system does not speak yet), or any "USB receipt printer" - USB
printers need a computer to drive them and this system does not do that.

**Roles.** Every printer is added with a role: **counter** (guest checks,
receipts, and the drawer), **kitchen** (food tickets), **bar** (drink
tickets). Each menu category picks which station its items print to. One
mC-Print3 can be the only printer at a small facility and hold the counter
role; a bar plus a kitchen adds two more.

**Connecting one (five minutes):** plug the printer into power and the
network. Admin -> Settings -> Devices -> Kitchen & Counter Printers: type a
name, pick its role, click Add - a poll URL appears (it starts with your
booking device's local address, e.g. http://ba-core.local:3001/api/cloudprnt/...).
Open the printer's own settings page in a browser (its IP is on the
self-test page it prints when you hold the feed button at power-on), find
**CloudPRNT**, turn it on, paste the poll URL, save. Click **Test Print** beside
the printer in Admin; a test slip prints within a few seconds. Give the printer a fixed IP with a
DHCP reservation in your router, exactly as for the Shelly plugs - a printer
whose address changes is a printer that stops printing weeks later.

### Cash drawers — printer-driven only

The drawer plugs into the **counter printer's drawer port** (Star calls it
the DK port; it takes an RJ12 "drawer kick" cable, the one that looks like a
phone plug). When staff take cash, the booking device sends the counter
printer a kick and the drawer pops; the opening is logged with the employee's
name and shows on End of Day.

**Buy one of these (get the "DK" / printer-driven version):**
- **Star CD5** - full size, heavy duty (**CD5-1617** is the recommended
  model).
- **Star CD4** - standard duty.
- **Star CD3** - budget.
- **Star mPOP** - drawer built into the printer (see above).
- A generic RJ12 drawer *can* work - but RJ12 is a connector, not a
  standard. Verify voltage (24V), pinout and "Star-compatible" before
  buying, or stick with the Star drawers above.

**Do NOT buy:** any **USB** cash drawer, or a network drawer controller such
as the Star **MCD10** - neither has a path into this system. The drawer must
hang off the counter printer. No counter printer, no drawer - but cash still
works; the drawer is a convenience.

**"But the Star MCD10 is advertised for exactly this?"** The MCD10 is not a
drawer - it is a small box whose only job is to open a drawer *without* a
printer. It does not plug into a printer; the drawer plugs into it, and it is
driven by Star's phone/tablet/Windows apps or by a web page over direct USB.
This system runs on a small Linux device that talks to hardware from the
server, and Star publishes no network protocol for the MCD10 it could use -
so there is nothing to connect it to. You do not need it: the same CD3 / CD4 /
CD5 drawer plugs straight into the counter printer's DK port instead, which
is the one path this system drives. If you already own an MCD10, set it
aside and use the drawer with the printer.

**Turning it on:** connect the drawer to the counter printer, then Admin ->
Settings -> Devices -> Kitchen & Counter Printers -> **Cash drawer: On**. Ring
a cash sale on /staff; the drawer pops and the staff screen's cash button
reads "Take cash - drawer opens". Until it is switched on the screen says "no
drawer needed" and simply records the sale.

### Card readers — Stripe Terminal smart readers

In-person card payments run on Stripe's own readers over Stripe's cloud: the
booking device asks Stripe to charge, Stripe pushes it to the reader, the
customer taps, Stripe tells the device. The reader never talks to the
booking device directly - it needs WiFi (or Ethernet via the hub) and a
Stripe account.

**Buy one of these:**
- **Stripe Reader S700 / S710** - the primary choice; an Android smart reader
  for the counter or in the hand (the S710 adds cellular).
  The **S700 Hub** adds wired Ethernet and power - buy it for that, nothing
  else.
- **BBPOS WisePOS E** - no longer sold by Stripe (since Sep 1 2026). One you already
  own keeps working with this system - Stripe supports it until Feb 1 2031 - but do
  not buy one for a new counter.
- **Stripe Reader T600** - a countertop or pole-mount smart reader with an
  8-inch screen that stays on mains power.
- **Verifone V660p** - a handheld smart reader, ordered through Stripe's sales
  team rather than the Dashboard shop. It takes payments from this system like
  the others; its built-in printer is NOT used by this system - receipts still
  come from a Star CloudPRNT printer.

**Do NOT buy:** Stripe **Reader M2**, **WisePad 3**, or **Tap to Pay** on a
phone - all three need a native phone app and have no path into this system.

Setup is in the Stripe chapter, Part 4: fill in your facility's address first
(the Street Address under Settings -> Business & Content -> Contact
Information, and the city, state and ZIP under Local Search & SEO), show the
three-word pairing code on the reader, and add it in Admin -> Settings -> Food
& Payments -> Card Readers. The unit registers the reader to a Stripe Location
it makes from your address - nothing to set up in the Stripe Dashboard. A tab
is marked paid only when Stripe confirms.

### Barcode scanners — any USB keyboard-wedge scanner

Plug a USB "keyboard wedge" scanner into the counter computer or tablet and
it types into whatever field is focused, no driver, nothing to configure.
Scanning into the reader's hub or the printer's USB port is a tablet-app
feature, not this system.

### The full register, in one list

For a counter that takes cards, cash and food orders: **1x mC-Print3
(counter) + 1x CD5-1617 DK drawer + 1x Stripe S700 (with Hub if you want
Ethernet)**, plus **1x mC-Print3 (kitchen)** and optionally a bar printer.
A tiny counter: **mPOP + Stripe Reader S700**. Honest tradeoff: the drawer depends on
the counter printer - keep a spare mC-Print2 on the shelf if cash is
critical.

### How it all fits together

```
Customer's card  ->  Stripe reader  ->  Stripe's cloud  ->  booking device
Booking device   ->  counter printer (CloudPRNT poll)  ->  receipt / guest check
Booking device   ->  counter printer  ->  DK port  ->  cash drawer pops
Booking device   ->  kitchen / bar printers (CloudPRNT poll)  ->  tickets
Staff tablet/PC  ->  /staff page only (never talks to any hardware)
Scanner          ->  types into the focused field on the staff screen
```

Every piece is on the facility's own network; nothing at the counter goes
through the internet except the card tap, which goes through Stripe.

### Bay equipment, for completeness

Covered in section 7 and their own chapters: **Shelly Plug US Gen4** (any
Gen2 or newer Shelly plug shows live wattage) one per bay; **BroadLink RM4 Pro** or
**RM Mini** for IR; **RemoteLock** smart locks, **UniFi Access**, or a
**Z-Wave lock** through your own Home Assistant for doors;
any Windows simulator PC with an onboard Ethernet port (for Wake-on-LAN);
**Home Assistant** for anything else on the network.

## 9. Day 2 - backups, recovery, upgrades

**Off-site backups (recommended for every facility):** Settings -> Protection
-> Backups, step 3 "Your computer, automatically". Make a new link (it serves
a fresh backup and opens nothing else on the unit), then Download the Windows
or Mac script - it already carries your address and the link - run it once,
and install it with the line at the top. Or by hand: Windows Task Scheduler,
run daily, program `powershell`, arguments
`-Command "iwr '<your link>' -OutFile ('backup-' + (Get-Date -Format
yyyy-MM-dd) + '.baenc')"` (the link only ever serves the encrypted backup).
Multi-site owners: one task per location on the
office PC and every facility's backup leaves the building every night. Make a
new link kills the old one instantly; Turn link off kills it everywhere.

**Upgrading the software:** BA Core Community has no updater. A newer release
is installed on the Pi with the same installer you used the first time: take a
backup, copy the new release to the Pi, extract it to a new folder and run
`sudo bash ./install.sh` from it. The installer prepares the new release while
the site stays up, switches over in a short stop, and keeps your settings,
bookings, waivers, uploads and hosted AI connection. If the new release does
not start it puts the earlier version back by itself. The Operating guide
("Upgrade to a newer release") has the exact commands. An upgrade never changes
the bay PCs: when a release's notes say the bay watcher changed, rebuild it
per bay (Build Session Monitor), remove older auto-starts, run the installer
on the PC and restart each PC.

**Backups on a USB drive or SD card:** Settings -> Protection -> Backups can
copy the nightly backup to a USB drive or SD card mounted on the Pi (the
Operating guide shows the mount). The backup carries your configuration,
database, waivers, documents and branding (not your site photos and video -
keep the originals, and not the hosted AI connection - reconnect it after a
restore). Set the backup passphrase first: a copy that leaves the unit and
the off-site link only run with one. To move to a replacement Pi, install the
same release on it and restore your backup from its private setup screen or
from Settings -> Protection; an encrypted backup asks for your passphrase.

## 10. Recommended values and why

Cancellation window 24h (12h if your slots refill fast; 0 only for clubs
that trust members). Buffer between bookings: 0 unstaffed, 15 min if staff
reset bays. Booking window 7–14 days public (short windows read as scarcity;
members can get a longer window per tier, with no upper limit - a club that
wants members booking a year out sets 365 there). Warning before session end:
10 min. Early bay access: Allowed. Check-in: Off unstaffed, full at counters.
Min session 1h, max 4h - 4 hours is the longest the system offers. Deposits:
staffed/hybrid only, and only if no-shows actually hurt you. Waiver: Required
+ 1-year membership term is the recommended posture. Gift cards: no expiry is
the system's behavior.

## 11. Troubleshooting the way owners actually hit it

- "I can't find a setting" -> use the search bar in the admin header; it jumps
  and highlights.
- "A save didn't stick" -> failed saves now show a red error. If you ever see
  success but a stale value after reopening, report it — that class of bug is
  regression-tested.
- "Member sign-in missing on the booking page" -> fixed Aug 2026; the member
  wall renders in every flow and mode. Update if you see otherwise.
- "Bay controls show no live state" -> that bay has no Shelly/PC configured;
  add the bay's Shelly plug or Simulator PC IP in Bays & Devices, press Save
  All Bays, and pills appear.
- "Texts aren't sending" -> the booking page only offers texting when Twilio
  is fully configured; members-only clubs intentionally run on email.
- "Customer paid but no booking" -> the sweep reactivates or refunds
  automatically and logs the reason under Revenue/admin log; a failed refund
  raises a manual-refund alarm.
- "I refunded someone in my Stripe dashboard - is my revenue still counting
  it?" -> no: the unit asks Stripe for refunds at start-up and every night,
  and **Check Stripe now** on the Revenue tab asks right away. The refund then
  comes off revenue on the day it was made; a counter one shows on its tab
  and the daily review marked "made in Stripe".
- "A booking I just made isn't on my Google Calendar" -> the calendar link is
  read by YOUR calendar app on its own schedule, often hours apart; there is no
  button in Google to make it read sooner. It will appear on the next read. For
  right now, look at the staff pad or Admin -> Bookings. If NOTHING ever shows,
  check the link was added under Other calendars on a computer, that your
  website address is set (the link uses it), and that the link is still the
  current one (Make a new link stops the old one).
- "There is no Refund button on a payment" -> only card, cash and check
  payments with money left to give back have one (member credit and gift-card
  payments are stored value, not money). A settled tab is under Open Tabs (or
  Bar view) > Paid today.
- "End of Day says the drawer is short after a refund" -> cash handed back
  without pressing Refund is not recorded; press Refund on the payment (with
  the reason) and the expected cash drops by that amount.
- "The health line says copies leaving the unit are paused" -> a USB/SD copy
  or the off-site link is switched on but no backup passphrase is set; set
  one in Settings -> Protection -> Backups, step 1, and they start again
  tonight.
- "The year archive or the quarter's waivers will not download" -> they
  cannot be downloaded until a backup passphrase is set; then they download
  encrypted (or unencrypted with your authenticator code).
- "After a restore my website photos are missing" -> backups leave out site
  photos and video; the restore result named each one - re-upload them in
  Website (the booking page's hero photo goes back in Settings -> Business &
  Content -> Branding & Theme).
- "The bay PC still shows the old popup after I reinstalled the watcher" ->
  restart the PC - that clears any old copy the installer could not stop.
  Still the old popup after the restart: an older auto-start is in the way (next line).
- "Two popups at once / two reserved screens" -> an older auto-start is still
  on the PC (Task Scheduler, a Startup folder, Settings > Apps > Startup, a
  launcher like AutoStart); remove it, keep ours, restart.
- "The popup's X or Close is cut off" -> that PC runs a watcher from before
  the fix; rebuild and reinstall it, then restart. Still cut off: note the
  Windows display scaling.
- "A member got a ONE-TIME door code instead of their PIN" -> their UniFi
  access could not be turned on; the Log tab's DOOR_CODE_FALLBACK line says
  why - usually the PIN length (6 on the console AND in Settings) or a token
  without Edit on User and Access Policy. Fix it, press Test Connection, check
  the member in UniFi Access > Users. You were alerted too (a text to your
  urgent-alerts mobile, if set, and an email).
- "Door codes is red: the console presented a certificate this unit does not
  trust" -> expected after the console was replaced, reset or updated: press
  Test Connection and accept the new certificate. If nothing changed, press
  Cancel and check what is answering at the console's address first.
- "UNIFI_MEMBER_SYNC_ERROR or 'PIN Length' in the log" -> PIN Length in
  Settings > Devices > Door Access and the console's PIN setting must both be
  6; then give the member a new PIN (Members tab > their row > New PIN - it is
  made at the current PIN length and sent to the console).
- "DOOR_JOBS_REPAIRED in the Log tab after the update" -> normal, once: door
  removal tasks an earlier version left waiting after a staff-pad cancel or
  move were removed; their codes were already off the door. It clears an
  Automation "queued but never claimed" line.
- "Automation says a smart plug is not answering" -> unplugged, off the Wi-Fi,
  or its address changed (reserve it in the router); it clears on its own
  within a few minutes of the plug answering again. "Asking for a password"
  means the plug's login was switched on in the Shelly app - switch it off.
- "A customer could not book a time that had just started" -> by design; a
  started session is not sold online. Staff can book it from the pad (it says
  how many minutes have passed).
- "The staff pad says Conflicts with a name nobody knows" -> probably an
  online checkout in progress or abandoned; it frees itself after the
  checkout hold (10 minutes by default), or Clear it in Admin > Bookings.

**"My member saw the public price on the booking page."** Enter the PIN
first (top of the page) and pick the session - the price and the "$0 due now"
box come from the server once both are there. If the tier settles at the
door but the booking still charged online, check Facility Access (deposits and
door settlement need a staffed hour) and the tier's Member golf settles.

**"Check-in shows full price for a member's friend."** Type the friend's own
member code on their seat - membership follows the person, not the booking.
A friend with no code pays the regular share by design.

**"The confirmation email says $0 but nothing about the door."** It should say
PAY AT THE FACILITY with the amount; if it does not, the tier was saved as
Online, not At the door.

**"Formatting shows as dashes and stars on the site."** The buttons write
plain marks; the site renders them everywhere text formatting is supported.
Single-line boxes (offer slide text, promo text) show bold and links only.
Text messages and email templates are plain text on purpose.

**"The backup I downloaded ends in .baenc and won't open."** That is the
encrypted form - it is not meant to open on a computer. Give it to Admin >
Settings > Protection > Backups, "Need to restore?" (or the setup wizard on a
fresh unit) with your backup passphrase.

**"Restore says wrong passphrase."** The phrase is case-sensitive. If it is
truly lost, the encrypted copies cannot be opened by anyone. If the unit is
still running, nothing is lost: set a new passphrase in Settings > Protection >
Backups, step 1 (the old one is not needed), then press Download a backup now
- every copy from then on uses the new one.

**"The drawer doesn't open on cash sales."** Three things, in order: the
drawer must be plugged into the COUNTER-role printer's DK port (not a kitchen
printer, not USB); the Cash drawer switch under Kitchen & Counter Printers
must be On; and the counter printer must be polling (click Test Print beside
it - if the test slip prints, the kick reaches it too). If the staff screen's cash
button says "no drawer needed", the switch is Off.

**"The printer prints nothing."** It polls YOUR device, so the poll URL in
the printer must be reachable from the printer: same network, and the
device's local address (ba-core.local:3001 or its IP), never the public
domain. Reserve the printer's IP in the router. Click Test Print in Admin - a
job that never prints is a printer that is not polling.

**"Can I use my Epson / USB printer / USB drawer?"** No - see section 7b.
Only Star CloudPRNT printers and printer-driven drawers work with this
system. An older Star TSP650II/700II/800II can be retrofitted with a Star
HI01X/HI02X card.

**"A staffed day shows no deposit box / the checklist still says mark your
staffed hours."** When a season is active it is the ONLY source - the
Website > Staffed Days calendar is ignored. Either put the hours in the
season (Settings > Schedule > Edit hours), force that one date under the
season (click its WANT STAFFED cell > Force this day staffed), or choose "No
season - the Website's Staffed Days calendar" in the Season list and press Use
this season to go back to the calendar. And check the staffed-hours master
switch is On.

**"An employee's phone page says code not recognized / my staff can't clock
in."** The phone page (/me) and the counter pad use the same personal codes
from Settings > Staff > Staff & Sign-In Codes; check the person is Active. The
pad's clock only appears when Employee scheduling is On (Settings > Staff > The
Counter).
A phone sign-in can never run the counter - that is by design.

**"I got an email saying a backup was pulled from a new address."** That is
the off-site link being used from a computer the unit had not seen. If it was
you, ignore it. If not, Settings > Protection > Backups, step 3 > Turn link
off - that kills it everywhere - and make a new one.

## 12. Glossary

Bay: one simulator station. Tier: a membership level. PIN/member code: what a
member types to book. Flat rate: member price per 30 minutes. Booking Unit:
per-bay vs entire-facility. Access style: staffed / unmanned / hybrid.
Collection (waiver): online / door / automatic. Sealed unit: a shipped
appliance protected by its per-unit setup password. Manager sign-in: a
secondary /admin login limited to Dashboard and Bookings, refused everywhere
sensitive. CloudPRNT: Star's printer protocol where the printer polls the
booking device for jobs over the local network - the only printer path this
system uses. DK port / DK drawer: the drawer-kick socket on a Star printer and
a drawer built to be popped by it. Poll URL: the address you paste into a
CloudPRNT printer so it knows where to collect its jobs.



---

# PART TWO - THE SETUP GUIDES, COMPLETE


---

# CHAPTER: Start Here

# Start Here
*Your Booking System - What To Do, In Order*

Welcome. This sheet is the map of what to set up, in order. Each step below has its own chapter in this manual or its own guide under the Guides button at the top of your admin panel.

## STEP 1 - Install, the first screen, then your checklist

Install BA Core on your Pi and finish the private setup screen with the first-time install guide (EVERYTHING-ASK-YOUR-AI in Guides). Public booking stays held until you open it. After that:

- **Admin > Getting Started** lists every step that is left, and **Owner Chat > Continue setup** walks you through them one at a time. Both work before you connect any AI.
- **The Assistant** (the button at the top of Admin) does the same steps with you by talking - your hours, bays, price, waivers, payments, email, texts, your website - and shows each change as a card you approve. Plain requests work at once; connect your own OpenAI or Claude model in **Owner Chat > Hosted AI settings** for everything else.

**The questions fit how you run.** A members-only club is asked whether members sign a waiver, is told members pay for their membership by card, and hears with the price question that members pay it less what their membership takes off (or nothing, if it includes the time). A facility rented whole is asked its price for the whole facility. With nobody working there, check-in is offered off and nothing asks about staff or a counter. Open all the time? Say "24/7" to the hours question.

After setup the same assistant keeps running the place by talking - for example:
- "send me last month's revenue", "the bookings as a spreadsheet", "the year-end report for my accountant"
- "codes should work 30 minutes early", "text the code an hour before"
- "make a summer season - weekdays 4 to 10, weekends all day"
- "make Gold a flat $20 an hour", "Gold members get one guest free each visit", "cap Silver at 50 members"
- "add a slide for league nights", "caption the second gallery photo"
- "add a kitchen printer", "back up to the USB stick every night", "keep customer details 12 years"
- "put our bookings in my phone's calendar", "change step 1 of How It Works"
- "put the thermostat on the whole facility", "set the lobby to 68"
- "find the TV remotes", "put the projector on bay 2", "learn its power button", "rename the bay 2 plug to Heater"
- "watch what I do on Bay 2", "run it when a session starts", "keep the connector running", "click Practice Range by its words"
- "make the Start GSPro button green", "close GSPro when each session ends", "copy it to every bay", "pause the reset routine"
Anything that touches money, doors, hours or staff is said back to you first, and the screen it changed opens beside the chat.

**Questions to tap, once you are set up.** When you open the chat, its hello ends with questions you can tap - one row just above the message box; swipe it sideways for more - picked for how your facility runs. A members' club starts with "Who's playing right now?", "How many members do we have?", "Did anyone sign up this week?", "More members than last year?", "What are our prices for members?" and "How much did we make this month?"; a facility with staff or a counter also gets "Who's working today?", "What's on the menu?" and "What sold best this week?"; a hybrid "Which days are staffed this week?"; a place the public books "Any deals running?". Each is answered from your unit's own records, and after an answer it offers a few you have not asked yet. Every row of questions ends with **"What else can you do?"** - tap it, or ask it any time, for the list of what you can ask and have done - only the parts that fit your facility. "Signed up" means added to this unit; the unit keeps no count of members on a past day, so "more than last year" compares who signed up and who paid then and now.

**It learns what you ask, and studies your numbers overnight.** The questions you ask most move to the front of the row, and every everyday question - who is playing, what is booked, what came in, your members, your staff, your messages - is answered straight from your records by the unit itself, at once, with no wait. Each night in the quiet hours (4:30 AM) the unit works out, from your own records, how the business has gone month by month: money taken, bookings, hours, players and new members, your busiest and slowest months, and this year against the same days last year. For each counter special and each booking deal it puts its own days beside the same weekdays before it started - bookings, players and money taken a day, and how many sold at the special's price (for a deal, how many bookings took it and what it gave off). Ask "Busiest and slowest months?" or "Did our specials work?" (or "did Taco Tuesday work?") and it answers at once, saying when it was worked out. It says what came in on those days, never why - the weather, a holiday or a league starting change things too. Every figure comes from what your unit recorded; nothing is estimated.

**When you leave something out, it asks - it never fills it in.** A customer's phone or email for a booking, which tax a new part of your menu takes, whether members of a new membership may bring guests and whether people can join it online: the assistant asks, with the answers to tap. Something you never said stays off the change - a discount code with no limit or end you said has none, and the card says so before you say yes (a code cannot be changed once it is made, so say "100 uses, ends Dec 31" first if you want one). A shift while employee scheduling is off is one change that says so and turns scheduling on.

**Money and tax are asked, never guessed.** A price you did not say is asked for. A new part of your menu asks which tax it uses, showing each tax's rate now; a tax still at 0% asks what rate you charge (or tap "No tax on these - keep 0%"), and the change that sets it says it applies to everything taxed that way. Something added to a part that is already there joins it, and the change shows that part's tax.

**One change at a time is fastest; two readings are asked.** A plain request - "turn on Bay 1", "block off The Vault for a tournament Saturday noon to 6", "book Sam Lee, 555-201-4433, tomorrow at 7pm for an hour", "add a new beer for $5 called Ale IPA", "who's playing right now?" - is read by the unit itself and answered or put up at once, with nothing to wait for. Two changes in one message ("change the headline and turn off Bay 3") go to the AI whole, so nothing is done in part. When your words could mean two things the unit asks which, with both to tap: a weekday said on that same day ("Sunday", said on a Sunday - today or next Sunday? Tap one, or say the day you meant: "sorry, I meant Monday"), a bay that matches more than one, a session with no length given, a time like 9, 10 or 11 with no "am" or "pm" (morning, or night?), a gift card with no word on whether it was paid for ("as a gift" does not say who paid - "sell" or "the customer paid" says it was sold), and "take the wings off the menu" (for good, or only for now - kept, to put back later; "delete" or "for good" says which).

**A time without am or pm is read only when it is certain.** "Block bay 2 friday 8 to 1", "close at 3 on sundays", "add the scramble saturday at 9": the assistant picks the morning or the evening only when you said which with the time ("tonight", "friday night", "8 to 1 at night", "breakfast 7 to 10", "for lunch", "the night shift", or the event's own name, like "League Night at 7") or when your opening hours leave only one (open 10 AM to 11 PM, "9 to 11" can only be the evening). Otherwise it asks, with both to tap: "Which hours - 8 AM to 1 PM, or 8 PM to 1 AM?". It asks too when you are open 24 hours, when a "not" is near the word ("not at night"), or when the evening was said in another sentence. "Late" and "early" do not count ("the Late Summer Scramble at 10" is asked); "early bird" is the morning. Answer by tapping, or type "9pm to 2am", "make it 8pm", "friday night" or "the second one" - hours typed with am or pm are your correction, and the bay, day and name stay. "Till close" ends at that day's closing time. A price window cannot run past midnight; if the hours would, it says so and asks again.

**Days are read the way you said them.** "Weekends off", "nothing on weekends", "not valid on fridays", "take fridays off" and "remove fridays from happy hour" give the other days, never the one you left out. A day said about something else - "we're closed mondays", "saturdays are always full", "weekends stay regular price", "thursday is league" - is never the deal's day. "Every day" means every day. "This weekend", "tonight", "this friday", a holiday or a date ("Thanksgiving", "nov 8") is one time: a weekly price or special is never set up for every week from it - you are asked. When the days could be read two ways ("mondays, no tuesdays") it asks which. On the day itself, a weekly kind said with that weekday is asked too: "wings $2 off friday", said on a Friday, gets "Every Friday, or tonight only?" with both to tap.

**The price you type is the price on the card.** "$20 an hour" stays $20 an hour and "$2 off" stays $2 off. "$1 cheaper", "save $2" and "$2 less" are that much off; "2 for $5" is $2.50 each; "$40 for 2 hours" is $10 a half hour; "drop happy hour by $5" lowers it by $5. "$20" on its own for a price window is asked - "$20 a half hour, or $20 an hour?" - and you can just type "an hour".

**Your Events page shows only what is public.** When an event reads as one person's, a family's, a company's or a client's own occasion - "a bash for Mike", "Sarah's 40th", "mikes skins game", "the Acme company outing", "a night with the Hendersons" - nothing goes up straight away, whether the unit read your words or handed them to the AI: you are asked "Put it on your public Events page, or is it a private booking?" (tap, or type "public", "its private" or "keep it off" - a "not" or "dont" with "public" means private). Private keeps it off and offers to block a bay or book it in the person's name. Plainly public events go up at once: "League Night", "Ladies Night", "the Chiefs watch party", "Toys for Tots", a scramble "for charity". An event named only after a company or a full name ("the Mike Smith Bash") goes up as you typed it, so check those names yourself. Its time comes only from how you said the time - "at 1", "starts at 6:30", "from 1 to 5", "9am" - never from ages, team sizes or grades ("ages 8-14", "teams of 2-4").

**What you said a moment ago counts.** "Block bay 2 tonight for the Smith party", then "8 to 1" when it asks the hours, is 8 PM to 1 AM; "put the fall scramble on the events page saturday", then "8" when it asks the time, is read with your hours; to "when does it end?", "about 3 hours" is a length, never "ends at 3". A correction after a card ("not Fridays though", "Saturdays too") is read with what you first asked for. In one message about two people or two bays, one person's "morning" never carries over to the other - it asks.

**"Take me to ..." opens the screen.** Say "take me to the schedule", "open the menu", "take me to specials", "where do I change our colors?", "where do I add a shift" or "take me to hats" (any part of your own menu, your own specials, pages, bays and memberships) and that screen opens beside the chat at once, ready to work on by hand - or open it full size with the button above it.

**Have replies read aloud.** "Read replies aloud" makes your phone say the answers (a switch kept on that phone). There is no microphone button: speech-to-text is not part of BA Core Community.

**Type the way you text.** Short words ("tmrw", "2 hrs", "rn", "this wk"), no capitals, no punctuation, a slipped letter ("booekd", "frdiay") - the assistant reads it the way you meant it. Your own bays, staff, menu and plans are found however you write them ("the vault" is The Vault). A real word is never changed, and anything about money, doors, hours or staff still comes to you as a card first - so if a word was read wrong, you see it there before anything changes. A new person's name (staff, a member, a booking) is never changed for you - the card asks you to check its spelling before you approve. A card waiting for Yes or No never locks the chat: type what you want instead ("actually make it $35") and that card is left as it was. A question the assistant asked never holds you either: ask something else and it answers that, and leaves the earlier change unless you bring it back. Name today's weekday on its own ("block the vault saturday" on a Saturday) and the assistant asks which one - today or next week - with both dates to tap; "this Saturday", "next Saturday" or a date says it outright.

**Your own AI model does the talking.** BA Core Community has no AI model inside it. The Assistant answers with the OpenAI or Claude model you connect in **Admin > Owner Chat > Hosted AI settings**, on your own API key. Plain requests - "add Root Beer for $3 to Drinks", "we're closed Mondays", "take me to the schedule" - are read by the unit itself and work before you connect anything; a request it cannot read that way says where to connect a model.
- **It uses the same tools and follows the same rules whichever model answers.** Changes about money, doors, hours and staff come to you as a card first, and nothing changes until you approve it with your own sign-in. Routines with clicks are taught by showing them once on the bay's PC.
- **What a model adds:** a long request with several things in it at once, unusual wording, deciding when to ask and when to just do it, and writing longer words for you (a newsletter, a section of your website, a description).
- **It costs money, from that company.** An API key is separate from a ChatGPT Plus or Claude Pro subscription: you make one on OpenAI's or Anthropic's developer site and pay for what you use. Choose the model and how hard it thinks in Hosted AI settings; a larger model reads a long request better and costs more per request.
- **What leaves the building:** your requests, and what the assistant looks up to answer them, go to that company. It sees your customers as a first name and last initial - never their phone or email.
- **The key stays out of the chat.** Enter it only in Hosted AI settings (over your site's https address or the private SSH forward). If one is pasted into the chat by mistake the page keeps it from the model and says where it belongs. The key is kept in a private file on the Pi, not in your settings and not in a backup - reconnect it after a restore.
- **If it stops answering** (your internet is down, the key is refused, the provider is down), the chat says why in plain words. Plain requests still work, and everything is always on the Admin screens.
- **Prefer Claude Code or Codex?** They can read these guides and prepare changes over a private SSH connection - see "Owner Chat and your AI client" in Guides.

## STEP 2 - Email - do this first

About 20 minutes. Email is the guaranteed path for confirmations and door codes, and it works the moment it's set up. Members-only club? Email is your ONLY messaging path by design - this step matters double.

## STEP 3 - Payments

30-60 minutes plus verification. Until Stripe is connected, bookings don't collect payment. If your counter takes cards in person, the same guide's reader section covers that too.

## STEP 4 - Text messaging - start early, it has a waiting period

The account takes an hour; carrier approval takes days to weeks. Start it, then keep going - your system runs on email while you wait. Members-only club? You can skip texting entirely - your members are reached by email.

## STEP 5 - Door access

Your smart lock plus a RemoteLock account = a unique door code for every booking. Already run UniFi Access on a Ubiquiti console? Use it instead of RemoteLock - the guide Setting Up Your Door with UniFi Access walks it: your own console issues the codes, no account or subscription, several doors if you want them. Rather run a Z-Wave lock through your own Home Assistant, with no cloud account and no fee? The guide Setting Up Your Door with a Z-Wave Lock walks it, and the unit shows when each customer arrived. STAFFED facility instead? Answer "Always staffed" to the wizard's "How do customers get in?" (later: Admin > Settings > Booking > Facility Access) and skip this step entirely - no door codes are ever sent, and reminders and confirmations still work.

## STEP 6 - Bay power

One smart plug per bay and each bay powers itself on and off with its bookings - with live wattage visible on your admin Dashboard. Already run Home Assistant? It is an alternative to Shelly plugs for owners who have it: connect it once (Setting Up Home Assistant) and any switch, plug, light or thermostat it manages can follow bookings.

## STEP 7 - Bay computers

Prepare each simulator PC (boot-on-power, automatic sign-in, the remote-shutdown door) and install its Session Monitor - the ending warning, the between-session reserved screen, and clean automatic shutdown. The guide walks every click, including the Windows 11 settings that trip people up.

## STEP 8 - Your counter - staff, menu & card reader

Only if people work your counter. Give each employee a sign-in code, build your food and drink menu with tax codes, add your Star CloudPRNT printer(s) and the cash drawer, and pair the card reader. Counter equipment is yours to buy - the AI manual's section 7b is the shopping list of exactly what works (Star mC-Print3, a Star DK drawer, a Stripe Reader S700). Then hand the Staff Guide to whoever works the floor. Fully unmanned facilities skip this step - and your check-in setting defaults to Off automatically.

## STEP 9 - Memberships

Selling memberships - or running a members-only club - is its own guide now: tiers, member PINs, online signup with automatic billing, and the members-only door policy.

## STEP 10 - Build your website

Admin > Website: your photos (sized for phones automatically), your words, your colors, the menu, and a switch to turn the whole site off if you have one elsewhere. Every long text box has formatting buttons (bullets, numbered lists, headings, bold, italic, quotes) and a Preview, so the words look right before you save. Preview at /landing, then make it your homepage with one click whenever it's ready.

## Find anything, ask anything

The admin panel has a search bar in the header - type any setting's name and click the result to jump straight to it (it searches the admin tabs; the Website editor is its own page). Next to it, the Guides button holds every guide and your owner's manual written for an AI: copy it into ChatGPT, Claude, or Gemini and ask questions about YOUR setup. And keep the Owner's Guide handy (it is under the Guides button too) - it explains how the whole system runs day to day.

## Before you open

Test everything with one real booking: book, pay, get the emails (and texts if approved), watch the bay power on, use the door code, and let the session end on its own. The **On-Site Test Checklist** (onsite-test-checklist) is the whole test on paper, step by step, with a box to tick for each - print it and work down it after setup, and again after an update. Staffed counter? Also check the group in at /staff, ring one drink, and collect it - the End of Day should show it to the penny. When that full loop works, you're ready.


---

# CHAPTER: If Something Goes Wrong

# If Something Goes Wrong
*Backups & Recovery, In Plain Words*

Your system is built to keep itself running: it restarts after power loss on its own, backs itself up every night, and the session monitors on your bay PCs repair themselves. This sheet covers prevention and cure: getting your backup OFF the device automatically, and restoring - on the same Pi or a replacement.

## It Maintains Itself

Nothing on the device changes behind your back - not the operating system, not the booking software: it changes only when you install a newer release yourself (the Operating guide, "Upgrade to a newer release"). After any power loss, everything comes back on its own - the system even catches up on bay power-ons it missed while the lights were out. This exact scenario is tested: power pulled mid-update, full recovery, nobody touched anything.

## Nightly Backups - and Getting Them OFF the Device

Every night the unit writes a full backup of your business to itself - bookings, members and tiers, tabs and sales, the POS menu, staff, gift cards, every setting and integration key, waiver documents, every signed record, your PDF pages, your logo and app icons - and keeps the last 14. Your site photos and video are the one thing it leaves out (see below). The **What a backup holds** panel at the top of the Backups card shows each part with its size, the total, and what is left out. That copy is your safety net for a mistake. It is not your safety net for a fire, a theft, or a device that dies, because it lives on the device. Getting a copy OFF the unit is the part that matters, and the system gives you three ways that run without anyone remembering.

**First, set the backup passphrase (Admin > Settings > Protection > Backups, step 1).** The setup wizard asked for it; if you skipped it, the setup checklist keeps reminding you. A backup contains your customers' details and your Stripe, texting, email, and door keys - correct on the unit, dangerous anywhere else. Once the passphrase is set, every copy that leaves the unit is encrypted with it (AES-256), and a restore asks for it. **Until one is set, nothing leaves the unit on its own:** the SD card and USB copies and the link to your computer cannot be switched on, and the year archive and each quarter's signed waivers cannot be downloaded. Pick a phrase of ten characters or more that you will remember, and write it on the same card as your recovery codes: lose the phrase and the off-device copies cannot be opened by anyone, including us. Copies on the unit itself stay readable so the device never locks you out. While a copy or the link is switched on, encryption cannot be turned off - switch those off first.

**1. A USB stick in the unit, or the SD card.** In Settings > Protection > Backups, step 2, choose where the nightly copy also goes: the SD card (on NVMe units the card is a second, separate storage inside the same box), a USB stick left plugged in, or both. Each night the encrypted copy is written there (into a BA-Backups folder on the stick) and checked byte for byte; the card shows the last time each destination succeeded and warns you when a stick has gone missing. Keep 14 nights on each.

**2. Your computer, automatically.** Turn on the off-site backup link, then download the ready-made script for your computer (Windows or Mac) from the same card - it already carries your website address and your private link. Run it once by hand to see a file land in your BA-Backups folder, then install it with the one line printed at the top of the script, and every night at 4:15 your computer pulls the encrypted backup for you and keeps the newest 30. The link is a long private key: never paste it anywhere but that script. Seeing the link, turning it off, or making a new one asks for your authenticator code when the sensitive lock is on; if the link is ever pulled from a computer the unit has never seen, you get an email and can kill the link with one click. The link can pull six times an hour and opens nothing else on the unit.

**3. Once a month, by hand.** Download a backup from Admin onto a stick you keep with a spare Pi. Even the worst day is then: plug in the spare, restore that file, enter the passphrase, back in business. (With no passphrase set, Download a backup now still works - it tells you first that the file is not encrypted and what it holds, and the health line on the About panel stays amber for a week to remind you a plain copy left the building. Acknowledge it there once the file is somewhere safe.)

**Prove it works.** Test Restore on the Backups card opens the newest backup in a scratch area and tells you what is inside - "412 bookings, 200 members, 1,043 signed waivers, settings OK" - checks every file against the fingerprint the backup recorded when it was made, and says which photos it left out - without touching anything. Do it after you set things up, and any time you would feel better knowing.

**What a backup deliberately leaves out.** The hosted AI connection (your provider key lives in a private file and is reconnected in Owner Chat after a restore). And your **site photos and video** (the website's photos, the booking page's hero photo, any video): they are the only thing that can make a backup huge - one video can be bigger than ten years of bookings - and you have the originals. The backup lists each one it left out, and a restore names them for you to re-upload: the website's photos and video in Website, the booking page's hero photo in Settings > Business & Content > Branding & Theme. Everything else is in it: a restored backup is the facility.

## Restoring on the Same Device

Restore is not only for the spare: Admin offers Restore any time (the owner's sign-in only - a manager cannot restore), and a factory-fresh device's setup wizard offers it on the very first screen - it also finds backups on a USB stick you plug in (at the top of the stick or in its BA-Backups folder), encrypted ones included. A restore puts everything back from the file you give it (enter your backup passphrase when it asks) and lists the site photos and video to re-upload.

# CHAPTER: Members & Memberships

# Members & Memberships
*Tiers, PINs, Online Signup & Members-Only Clubs, Step by Step*

Memberships are the deepest feature in your system: sell them online with automatic billing, give members their own rates and windows, or run your entire facility as a members-only club. This guide is the owner's tour. Everything lives in Admin > Members.

## Tiers Define the Deal; Members Belong to Tiers

A tier sets the discount (percent off, dollars off, free hours, or a flat member rate), hour limits, day/time/bay restrictions, booking window, guest policy, roster cap, and - if you sell it online - monthly and annual pricing. Create tiers first; add or import members into them second.

**Flat member rate:** the value is per 30 minutes. A $30-per-hour member deal is entered as 15. Under normal (public) operation a member's total can never exceed what an anonymous customer would pay for the identical session - typing a PIN can only ever help.

**Free hours, done right:** Free Hours Per Period means that many free hours PER MONTH; set Hours Per Day or Per Week to spread them out. Free time is applied first, always: a member with one hour left who books two hours pays for one, at the After Hours Are Used rate you set (or the regular price if you set none). Pair it with that rate for offers like "10 free hours, then 20% off the rest of the month." The same meter runs online, at the counter, and when staff extend a session.

## Blended memberships - free daily hours, then a member rate

The **Free Daily Hours + Rate After (blended)** style runs a different philosophy: the hour allowances become a free-time meter instead of a wall. The front of every session is covered by whatever free time the member has left that day (capped by the weekly/monthly pools), the rest is priced by the After Hours rate - set it to **$ per 30 min** for offers like "first hour free every day, $5/hour after" (enter 2.50). Bookings are never blocked by the limits, and the price the member sees at booking is frozen - a later booking that day can never reshuffle whose hour was free.

## How members pay - the settlement choice on every tier

Under the pricing block of every tier - every style, not just blended - sits **Member golf settles**, with three choices:

- **Online at booking** - the member's card is charged their member price when they book; guests are charged by your guest pricing at the same time. Nothing to collect at the counter for the golf.
- **Deposit online, balance at the door** - a small deposit holds the bay: the **Member deposit per half-hour** you set (a flat-rate tier uses its Value as the deposit). At check-in staff count heads and the bay is split per person; the member's seat gets their member price - or their share minus the **door share discount %** if you set one - the deposit is credited to their tab, and the group pays the rest at the counter. Guests pay the full per-person share.
- **At the door - nothing charged online** - booking online reserves the bay for $0. At check-in the bay is split by heads, the member's seat is priced by their tier automatically, and guests pay the regular share. The booking page says "$0 due now - about $X on your tab at the facility", the confirmation email and the member's /my-booking page say the same, and the staff list shows "Member - $X at door".

Deposits and door settlement only exist where someone is at the counter: a facility marked Always staffed qualifies at every hour; a facility with staffed hours (the Website's Staffed Days calendar, or a season in Settings > Schedule) qualifies inside them; at any other hour the member price simply charges online. The tier editor shows which of these applies to you right under the setting, so a tier can never promise the door at a facility that has no counter.

**The worked example** (1 free hr/day, $2.50/30min after, door settlement, $60/hr public): a member books 3 hours with 2 guests - $0 online. At the door the pot is $180: each guest pays $60, the member pays hour 1 free + 2 hrs at $5 = **$10 on their tab**. If a second member is in the group, staff enter their code at check-in and that seat re-prices by **their own** membership and **their own** free time that day - a percentage member gets their percent off their share, a fresh blended member gets their free hour. Every seat follows its own rules; guests always pay the full split.

The tier editor shows a live plain-words summary of exactly what you have configured - for every style and every settlement choice - read it back before saving; it is what your members will experience. The tier **Description** is what people read on your website's membership cards, the public memberships page, and the member portal; it has the formatting toolbar (bullets, numbered lists, headings, bold, italic, quotes) and a Preview (chapter: Formatting Your Text).

**Family and business memberships:** a tier can include several member codes (Codes Included) - one online purchase, several people, each with their own PIN. The codes start, lapse and cancel together, but each code has its own allowances: free hours, hour limits, guest passes and booking limits are counted per code, so a 4-code tier with 10 free hours a month gives each code 10. The extra codes are made only when the membership is bought online; a member you add by hand gets one code.

**Per-tier waiver:** at the bottom of Edit Tier you can attach a specific waiver document for that tier - members sign it at signup, at the counter, or when you record paper on file - and choose how long that tier's waiver lasts (Membership Waiver Lasts: the facility setting, the life of the membership, 1 year, or every visit for day passes and trial tiers). Leave it on the default to use your facility-wide waiver. Upload documents on the Waivers tab.

## Waivers for members and their guests

Members sign one waiver that rides their membership - captured at online signup, at their first booking, at staffed check-in, or recorded by you as paper on file - and it lasts the life of the membership or one year, your choice on the Waivers tab (Waiver Policy) - and any tier can override that with its own term in Edit Tier, including "every visit". Non-members sign per visit, online or at the door per your Waiver collection setting. When a member books and brings friends, **A member's guests** (Waivers tab > Waiver Policy) decides the default: covered by the member's waiver (the member is responsible for their guests), or each guest signs the one-day waiver at check-in. Either way the staff check-in can tap any guest seat and collect that person's own signature.

## PINs

Leave the PIN field blank when adding a member and the system generates a unique 6-digit PIN (recommended). Type one only for members migrating from a previous system - duplicates are rejected automatically, and trivial patterns are never issued. Members enter their PIN at the top of the booking page; verifying immediately unlocks their rates, window, and guest options.

**The member PIN as the door code (UniFi Access with member door access on).** At a facility whose doors run on UniFi Access with **Enable member door access** ticked (the UniFi Access guide, Step 9), a member's PIN is also their door code - one number for booking and for the door. It opens the door from your "before" minutes ahead of each of their bookings to your "after" minutes past it (and any time for doors their tier has as Always-on). **At the keypad they type the PIN, then press Enter.** Their door text says "Door code ...... (your member PIN) ... Type it, then press Enter." and their email says the same in words. Tell your members this once, at signup - it is the one thing they will ask.

- PINs are 6 digits there, because the door console and the unit are both set to 6.
- A PIN the door console is already using is never handed out: when you add a member, the PIN you are shown has been checked free on the console. If a PIN ever has to change (the console refused it later), the member is sent the new one by text and it is written in the Log tab.
- If a member's door access cannot be turned on for a booking, they are sent a ONE-TIME code for that session instead, the text says so plainly ("your member PIN will not open the door for this booking"), and you are told.
- A member who leaves keeps nothing at the door: their door user is deactivated on the console.

**The same with a Z-Wave lock through Home Assistant.** Tick **Members open this door with their own member PIN** on the Door Access Provider card (the Z-Wave lock guide): a member's PIN is put in one of the lock's booking slots for each booking's door window and taken out after, and their text says to type it and press the finishing key you named. Off (the default), every booking - a member's too - gets a code of its own.

## Selling Memberships Online

Tick Sell online on a tier and give it a Monthly or Annual price above $0 - only then does it appear on your public /memberships page, with card signup through your Stripe account (no extra Stripe setup), and only then does a members-only booking page show its Become a Member button. Renewals charge automatically; failed payments get a grace period you control per tier; members can cancel any time from their portal at /my-membership and keep benefits to the end of the paid period. Monthly members receive a billing reminder email the number of days you choose before each charge (the Membership billing reminder on the Resend - Email Notifications card, 7 by default); annual members always get 30 days' notice.

## Running Members-Only

Settings > Booking > Who Can Book > "Members only" turns your facility into a private club: no valid member PIN, no booking - enforced by the server, not just the page. The booking page shows a members wall with a Become a Member button linking to your memberships page (once a tier is for sale online; until then it says "Contact the facility about becoming a member."). Under members-only, the flat member rate IS the price (there is no public price to cap against).

Members-only clubs run on EMAIL by design: the texting opt-in disappears from the booking page, so you can skip Twilio entirely. Booking confirmations, reminders, and cancellation notices each have their own switch on the Resend - Email Notifications card (Settings > Connections).

Using UniFi Access for doors at a members-only club? Put entry doors in the BOOKING door set - not an always-on set - and a member's PIN opens the building only during their booked time.

## The Members Command Center

The Members tab shows MRR, ARR, past-due, and by-tier counts alongside the roster. The Revenue tab shows membership income next to booking income. The Getting Started card on your Dashboard knows when you run members-only and walks you through the pieces in order.

## Prove It

- [ ] A test member's PIN unlocks their rate on the booking page and the price preview matches their deal
- [ ] If selling online: a test signup on /memberships completes and the member appears in the roster
- [ ] If members-only: booking without a PIN is refused; the members wall shows with your Become a Member link
- [ ] The member portal at /my-membership shows the plan and offers cancel
- [ ] With UniFi member door access: a test member's PIN, typed and then Enter, opens the door during their booking and not after it

---

# CHAPTER: Setting Up Payments

# Setting Up Payments
*Your Stripe Account, Step by Step*

Stripe is how your customers pay when they book - and, if your counter takes cards, how in-person taps clear too. Until it's connected, your booking system takes bookings without collecting payment - so this is the guide that turns on revenue. Plan on 30-60 minutes; most of it is Stripe verifying your business.

## Part 1 - Create and Verify Your Account

*Checked against Stripe's own help pages, October 2026. Your assistant walks these steps with you one at a time - say "set up Stripe".*

**STEP 1 - Sign up**

Go to dashboard.stripe.com/register. Enter your business email, your full name, United States, and a password, then answer the few questions about your business. Stripe emails you a link - open it to verify your email. Your new account starts in a **sandbox**, Stripe's practice mode: nothing you do there moves real money.

**STEP 2 - Turn on two-step login**

Stripe asks for it before you take real payments. Click your name at the top right, then **Personal details**, then **Two-step authentication**, then **Add authentication method**. An authenticator app or a passkey is safest; a text message works too. Save the **backup code** somewhere safe - it is the only way back in if you lose your phone.

**STEP 3 - Verify your business (to take real payments)**

On the Stripe home page, follow the prompt to verify your business (or go to dashboard.stripe.com/account/onboarding). Stripe asks, in this order:
- **Business type** - just you, with no partners: the sole proprietor choice. A single-member LLC: the LLC choice that matches it. A multi-member LLC or a corporation: company.
- **Tax details** - your EIN. A sole proprietor with no EIN picks the choice for that and uses their Social Security number.
- **Business details** - the legal name exactly as the IRS has it, the street address where you operate (not a PO box), a phone number, your **industry** (there is no golf simulator choice - pick Entertainment and Recreation, then the "other" choice under it), and your **website** (see Stuck? below if your site is not public yet).
- **You, the owner** - legal name, date of birth, home address, and the last 4 digits of your Social Security number.
- **What customers see** - the **statement descriptor** (the name on their card statement, 5 to 22 letters, like FARGO GOLF LOUNGE) and a support phone number.
- **Your bank account** - where your money is paid out.

Click **Agree and submit**. Most accounts are approved within minutes. If Stripe needs anything more, you get an email and a red banner at the top of the Dashboard - follow it and upload what it asks for (a clear color photo of your ID - no photocopies).

## Part 2 - Get Your API Keys

**STEP 4 - Open the API keys page**

Go to **dashboard.stripe.com/apikeys** - the quickest way. (From Stripe's own menus: **Developers**, then **Workbench**, then on its Overview page the **API keys** box, **Manage**.) Make sure you are in **live mode**: if the page says sandbox, use the account picker at the top left to leave the sandbox. Under **Standard keys** there are two:
- **Publishable key** - starts with pk_live_ - shown in full. Copy it.
- **Secret key** - starts with sk_live_ - click **Reveal live key**, then click the key to copy it.

Do **not** click **Create restricted key**. Your unit needs the standard secret key - it also creates your membership prices, its webhook and your card-reader registrations in your Stripe account - and it refuses a restricted key (one that starts rk_live_).

**STEP 5 - Paste the keys into the chat**

Paste the publishable key here in the chat with your assistant, then the secret key - one at a time. The page saves each one straight onto your unit; the assistant never sees it. (Or on a computer: Admin > Settings > Connections, the Stripe - Payments card, then Save Settings.) Then click **Hide live key** in Stripe. Treat the secret key like a bank password: Stripe never asks you for it, and nobody else should have it. The badge at the top of Admin reads **LIVE** once Stripe answers.

To practice first, paste the sandbox pair instead (pk_test_ and sk_test_ - in the sandbox they are shown any time) and pay with Stripe's test card 4242 4242 4242 4242; swap in the live pair when you are ready to open.

## Part 3 - Test Online Payments

- [ ] With test keys: a test booking completes using card 4242 4242 4242 4242
- [ ] With live keys: a real booking with a real card appears in your Stripe Dashboard
- [ ] Refund that live test from the Stripe Dashboard to confirm the refund path - then press **Check Stripe now** on the Revenue tab and see the refund come off (it would be picked up tonight on its own anyway)
Once the live test clears, online payments are done - every booking pays you automatically, and payouts land in your bank on Stripe's schedule.

## Stuck? Common questions - Stripe

**I don't have an EIN.**
That is fine for a sole proprietor: on the Tax details step pick the choice for a business with no EIN and use your Social Security number. (No Social Security number? An ITIN works.) An LLC or corporation with partners needs its EIN.

**What legal name do I use?**
Exactly what the IRS has: a sole proprietor uses their own name; a single-member LLC taxed as the owner uses the owner's name with their SSN or EIN; a multi-member LLC or a corporation uses its registered name and EIN. A name that does not match the IRS records is the most common reason verification stalls.

**I don't have a website yet / my site is not public yet.**
Stripe accepts a website, a social media page (the full link, like facebook.com/yourgolf) or an app page - it must show your business name and what you sell, and open without a password. Your unit's own site counts once it is online and open to the public; until then, give your business's social media page. Nothing online at all? Contact Stripe support from the Dashboard.

**Do I have to give Stripe my Social Security number?**
Stripe asks every account owner for the last 4 digits to confirm who you are, and a sole proprietor with no EIN gives the full number as the business's tax ID. It goes to Stripe only - your unit never sees it, and nothing you type into Stripe's own pages comes here.

**What industry do I pick?**
Stripe has no golf simulator choice. Pick Entertainment and Recreation, then the "other entertainment and recreation" choice under it - Stripe's advice is to pick the closest one.

**What is a statement descriptor?**
The name your customers see on their card statement. 5 to 22 letters, no < > \ ' " * - use the name customers know you by, like FARGO GOLF LOUNGE, so nobody disputes a charge they do not recognize.

**Stripe says it needs more information / my account is under review.**
Follow the red banner at the top of the Dashboard and upload what it asks for. A photo ID must be in color and readable - no photocopies. A review usually takes up to 24 hours; allow 3 to 5 business days.

**When do I get paid?**
Your first payout usually lands 7 to 14 days after your first real payment; after that Stripe pays out daily by default (Stripe's own payout settings, in its Dashboard, show and change it).

**What does Stripe cost?**
2.9% + 30 cents for each US card payment online, no monthly fee and no setup fee. Cards from other countries cost 1.5% more, and a disputed charge costs $15. Card readers at a counter have their own lower rate.

**I can't find the API keys / I don't see Developers.**
Go straight to dashboard.stripe.com/apikeys. If you still cannot see it, your login needs the Administrator role on the account - ask whoever made the account to give it to you.

**It only shows test keys (pk_test_ and sk_test_).**
You are in the sandbox (practice mode). Use the account picker at the top left to leave the sandbox. Live keys work once your business is verified (Step 3). You can paste the test keys now to practice, and swap in the live ones later.

**I lost the secret key / I closed the page before copying it.**
On the API keys page, open the secret key's ... menu and choose **Rotate key**. Copy the new key straight away - it is shown once - and paste it here in the chat.

**It says restricted key, or the key starts with rk_live_.**
That is the wrong kind. Use the standard **Secret key** (it starts sk_live_) under Standard keys - Stripe now suggests restricted keys, but your unit needs the standard one.

**Is it safe to paste my secret key here?**
Yes - the page saves it straight onto your unit; the assistant never sees it, and it is never sent anywhere else. Never email it, text it or paste it anywhere else, and Stripe will never ask you for it.

**What name goes on the bank account?**
A sole proprietor or single-member LLC may use the legal business name, the name the business goes by, or their own name. A name that does not match at all can get a payout sent back.

## Part 4 - In-Person Card Readers (the counter)

If staff take card payments at your counter, add a Stripe smart reader - the Stripe Reader S700/S710 (or a WisePOS E you already own). It uses this same Stripe account; nothing extra to create.

**STEP 5 - Buy and connect the reader**

Order the reader from your Stripe Dashboard (Terminal section, the shop). When it arrives, power it on and join it to your facility WiFi: swipe right from the left edge of its screen, tap Settings, enter the admin passcode 07139, then Wi-Fi settings. (Wired instead? The S700's hub or the WisePOS E's dock adds Ethernet.)

**STEP 6 - Pair it**

Stripe registers every reader to a Location, and your unit makes yours from your address - nothing to set up in the Stripe Dashboard. First fill in the Street Address (Admin > Settings > Business & Content > Contact Information) and the city, state and ZIP (Local Search & SEO), and Save Settings. Then on the reader: swipe right from the left edge, tap Settings, enter the admin passcode 07139, and tap Generate pairing code - a three-word code appears. In Admin > Settings > Food & Payments > Card Readers, type it in "Pairing code from the reader screen", add a label if you like, and press Add reader. If the address is missing, the card says exactly which part to fill in. Done - staff send any check to it with one tap.

**How paid works:** a check is marked paid the moment Stripe itself confirms the tap - never before. A reader that loses power mid-sale, or a customer who walks away, leaves nothing wrongly marked paid. With "Tip prompt on the reader" switched on (the Card Readers card; Off by default), reader tips land in End of Day by themselves. Reader fees differ from online fees; the Processing Fee Estimates on the Stripe card are what Revenue subtracts to estimate what Stripe keeps.

**Refunds on a reader payment:** staff give money back from the pad (Refund on the payment - Staff Guide, Giving Money Back); it goes back to the customer's card through Stripe, with no second tap. A refund you make yourself in the Stripe Dashboard is picked up by the unit too and shows on that tab and your daily review.

**STEP 7 - Prove the reader**

- [ ] A test check sent to the reader shows on its screen
- [ ] A tap marks the check paid on the staff screen only after Stripe confirms
- [ ] The payment (and any tip) appears in End of Day and in your Stripe Dashboard
## Memberships & Recurring Billing

Your system can sell memberships online with automatic monthly or annual billing. The same Stripe account handles it - no extra setup beyond this guide. The Members & Memberships chapter covers tiers, pricing, and the member portal; membership payments appear in this same Stripe dashboard, and the Revenue tab in Admin shows booking revenue and membership MRR side by side.


---

# CHAPTER: Setting Up Text Messaging

# Setting Up Text Messaging
*Your Twilio Account & Carrier Registration, Step by Step*

Text messaging is how your customers get booking confirmations, reminders, and - most importantly - their door codes. To send texts, U.S. carriers require every business to register who they are and what they send. This guide walks the whole thing: account, phone number, brand registration, and campaign approval.

> IMPORTANT: Members-only club? You can SKIP this entire guide. Members-only facilities run on email by design - the texting opt-in never appears on your booking page, and email carries everything. Come back only if you later open to the public.

The good news: your booking system was built to pass this review. The consent checkbox, the privacy policy, the SMS terms page, and every message it sends are already written to the carriers' checklist. Your job is mostly filling in forms with text this guide gives you. Set aside about an hour for the account setup, then plan on about two weeks of waiting for the phone companies to approve it. Your booking system works while you wait - door codes go out by email until texting is approved.

*Checked against Twilio's own help pages, October 2026. Twilio has a new Console and an older ("legacy") one; where they differ, both are given. Your assistant walks these steps with you one at a time - say "set up texting".*

## Part 1 - Create Your Twilio Account

**STEP 1 - Sign up**

Go to twilio.com and click Sign up. Verify your email, then your own mobile number (Twilio texts you a code), then answer the few questions about what you are building - pick SMS. No card is needed yet. You land on the Console home page.

**STEP 2 - Upgrade out of the trial (you must)**

A trial account can only text your own verified phone, stamps every text "Sent from a Twilio trial account", and cannot register for texting - so your unit cannot use it. Click the **Trial** banner at the top left (or **Upgrade your account**), then **Upgrade**. Enter your legal name and phone; Twilio may ask for a photo of your ID. On **Fund your account** pick an amount (about $20 lasts a facility a long time) and tick **Auto Recharge**, then **Confirm Payment**. Texting costs are small: about $1.15 a month for the number and under a penny a text, plus the registration fees in Step 6.

**STEP 3 - Create your business profile**

The phone companies need to know who is texting. Go to **Trust Hub**, then **Profiles** (in the left menu, under Communications). Have an EIN? Choose **Business Profile** and use your legal name exactly as the IRS has it. No EIN? Choose **Individual Profile**. Twilio asks for a photo of your ID and a selfie. Approval takes up to 48 hours - you can buy your number (Step 4) while you wait.

## Part 2 - Your Number and Your Keys

**STEP 4 - Buy your phone number**

New Console: **Numbers & senders**, the **Phone Numbers** tab, **Set up a new phone number**. Fill in the basic information, then on **Select Number** type your area code, click **Search**, pick a number with **Select**, then **Purchase**. (Older Console: **Phone Numbers**, **Manage**, **Buy a number** - country US, keep **SMS** ticked, then **Buy**.) A local number in your area code is best - customers recognize it. Write the number down as +1 and the ten digits.

**STEP 5 - Paste the keys into the chat**

On the Console home page find your **Account SID** (it starts with AC) and your **Auth Token** (click to show it; in the older Console both are under **Account Info**). Paste the Account SID here in the chat, then the Auth Token - one at a time. The page saves each one straight onto your unit; the assistant never sees it. Your assistant then asks the phone number you bought. (Or on a computer: Admin > Settings > Connections, the Twilio - SMS card.) Keep the Auth Token secret - treat it like a password.

## Part 3 - Register With the Phone Companies

US phone companies block business texts from any number that is not registered (the program is called A2P 10DLC). This is the part that takes a little patience: forms today, then about two weeks of review.

**STEP 6 - Register your brand**

Once your profile is approved: **Trust Hub**, then **Registrations**, the **A2P Brands** tab, **Create A2P Brand**. (Older Console: **Messaging**, then **Regulatory Compliance**.)
- **No EIN:** register as a **Sole Proprietor**. Twilio texts a code to your own mobile - reply within 24 hours. One number, one campaign, plenty for a facility.
- **With an EIN:** choose **Low-Volume Standard** (up to about 6,000 texts a day - more than any facility sends). Use your legal name exactly as on your IRS letter - the number one reason a brand is turned down is a name that does not match.
Approval usually takes minutes. The fees (set by the phone companies, October 2026): $4.50 once for the brand, $15 once to review your campaign (not refunded if it is turned down), then $1.50 to $10 a month for the campaign ($2 for a Sole Proprietor). The Console shows the exact amounts before you pay.

**STEP 7 - Check your pages first**

The reviewers open your website the way a customer would, so your unit must be online and your site open to the public before you register your campaign. On your phone, using cell data (not your Wi-Fi), open your booking page: the text-message checkbox must be there, NOT ticked, with its full wording; the SMS Terms and Privacy Policy links under it must open. Not online yet? Say "get my box online" and come back here - nothing you have done so far is lost. (The full checklist is "Before You Submit - Pre-Flight Check" below.)

**STEP 8 - Start your campaign**

In the Twilio Console: **Trust Hub**, **Registrations**, the **A2P Campaigns** tab, **Create A2P Campaign**, and choose **Create a new Messaging Service**. For the use case: a Sole Proprietor brand has one choice - take it. With an EIN, choose **Low Volume Mixed** (about $1.50 a month) or **Account Notification** (about $10 a month) - both fit booking texts.

**STEP 9 - Describe your texts and how customers agree**

Two boxes in the campaign form - copy each of these in, word for word. Your assistant fills in your business name, legal name, address and website where it knows them; fix anything still in [brackets].

**STEP 10 - Add your sample messages**

Paste 4 or 5 sample messages - these are your unit's own texts, word for word, with your business name in each. Embedded links: tick it only if a text mentions your website. Leave the opt-in keyword and opt-in message boxes empty - your customers agree on your website, not by texting. Click **Create** (the $15 review fee is charged now).

**STEP 11 - Connect your number and your unit**

**Messaging**, **Services**, open the new service. **Add Senders**, keep Phone number, tick your number. Then the **Opt-out** tab: **Enable advanced opt-out**, click the pencil in Standard Opt-Out Keywords, and paste these three replies (they are word for word what your unit itself replies). Then, still in the Twilio Console, the **Integration** tab: **Send a webhook**, Request URL https://yourdomain.com/api/twilio/incoming (your own domain), HTTP POST, and Save. Now your unit hears a STOP the moment it is texted.

**STEP 12 - Wait for Verified**

The campaign shows **In progress** while the phone companies review it - plan on about two weeks. Texts are blocked until it says **Verified**; your unit sends everything by email meanwhile. If it is turned down, see "If You Get Rejected" below - edit it, never delete it. Once verified, make a test booking and watch the texts arrive.

## What to Type in the Campaign Form

The campaign tells carriers what you send and how people consent. This is where most businesses get rejected - and where your system's pre-built pages do the heavy lifting. Fill the fields with the patterns below, replacing the [bracketed] parts with your real details.

**Campaign description:**

*This campaign sends transactional booking notifications to customers of [Business Name] (legal entity: [Legal Entity Name]), an indoor golf simulator facility at [street address], with online booking at [https://yourdomain.com/book]. Customers who opt in via an optional, unchecked checkbox at booking receive booking confirmations, session reminders, door access codes, and cancellation notices. No marketing or promotional messages are sent.*

**How do end-users consent? (opt-in description):**

*End users opt in via an optional checkbox on the booking form at [https://yourdomain.com/book]. The checkbox is never pre-selected and booking completes without it. The label states that consent is not a condition of purchase, that message frequency varies (typically 2-5 messages per booking), that message and data rates may apply, and that users may reply STOP to cancel or HELP for help. It links to our SMS Terms at [https://yourdomain.com/sms-terms] and Privacy Policy at [https://yourdomain.com/privacy]. Customers who do not opt in receive their booking details and door code by email.*

**Always staffed (no door codes)?** Your checkbox reads differently: "booking confirmations and reminders" and "Message frequency varies", with no door codes and no "2-5 messages" figure. Leave door access codes and the "2-5 messages" figure out of your campaign description and opt-in description, so they match what reviewers see on your page.

> IMPORTANT: Every URL you enter must show the thing it describes. The booking URL must be the page with the checkbox on it. If you ever change your site's homepage (for example, flipping your marketing page to the front), your booking page moves to /book - make sure the campaign's URLs still point at the right pages.

**Sample messages** - carriers compare your samples to what you actually send. Use 4-5 of your system's real messages with realistic values - send yourself a test booking and copy them, or use these, which are the system's default texts word for word. Every sample includes your business name and ends with the opt-out line:

*[Business Name]: Booked! Bay 1, Mon Jul 20 2:00 PM. Code texted 15 min before. Details emailed. Reply STOP to opt out. Msg & data rates may apply.*

*[Business Name]: Door code 4821. Bay 1 2:00 PM, today only. Enter on the keypad. Reply STOP to opt out. Msg & data rates may apply.*

*[Business Name]: Your Mon Jul 20 2:00 PM booking is cancelled. Refund if applicable. Reply STOP to opt out. Msg & data rates may apply.*

At an always-staffed facility the confirmation says "Staff will set you up." in place of the code line, and there is no door code text. On a UniFi Access door or a Z-Wave lock the door code text ends "Type it, then press Enter." (a Z-Wave lock names your finishing key).

**Content declarations:** Embedded links - check YES if any messages mention your website address (your full domain is fine; never use link shorteners). Phone numbers, age-gated content, loans: leave unchecked - none apply.

**Opt-in message** (the reply to START): *[Business Name]: you are resubscribed to booking texts. Reply HELP for help, STOP to unsubscribe. Msg & data rates may apply.*

**Opt-out message:** *[Business Name]: you are unsubscribed from booking texts and will get no more. Reply START to resubscribe.*

**Help message:** *[Business Name]: booking texts. For help, contact [your phone or email]. Reply STOP to unsubscribe. Msg & data rates may apply.*

These are word for word what your booking system itself replies. **Make Twilio send the same words.** On an ordinary number Twilio answers STOP, START and HELP itself with its own generic replies (which do not name your business), and does not pass HELP on to your system at all. Once your number is in the Messaging Service your campaign uses, turn on Twilio's Advanced Opt-Out there: Console > Communications > Messaging > Services > your service > **Opt-out** tab > **Enable advanced opt-out**, then the pencil in "Standard Opt-Out Keywords" and paste the three messages above into the Opt-Out, Opt-In and Help confirmation messages. Save. From then on what a customer receives is what you registered, and your system stays quiet when Twilio has already answered.

**Send your texts' replies to your system too.** In the same Messaging Service: **Integration** tab > **Send a webhook** > Request URL `https://yourdomain.com/api/twilio/incoming` (your own domain), HTTP POST. Save. This is how your system hears a STOP the moment it is texted.

**What happens when a customer texts STOP.** With the webhook above set, the system records it on your unit the moment the text arrives (without it, Twilio itself blocks every text to that number, and your system records the opt-out the next time it tries one); either way it will not text that number again - not a confirmation, not a door code, not a reminder - until the same number texts START. This holds whichever provider carries your texts and survives every update and backup. Admin > Settings > Connections > Twilio - SMS shows how many numbers have texted STOP; there is no button to clear one, because only the customer can do that, by texting START. The carrier keywords STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE and OPTOUT (or "opt out") all count, with or without punctuation, when they are the first word of the reply - so a customer who texts "Cancel my booking" is unsubscribed too; the reply tells them at once, and texting START undoes it (a booking is cancelled on the My Booking page, never by text). HELP is answered with your business name, how to reach you (your contact phone, else your email, else your website) and how to stop.

## Before You Submit - Pre-Flight Check

Reviewers follow your links like a customer would. Walk this trail yourself first - from your phone, on cell data (not your WiFi), so you see what they see:

- [ ] Open your booking page: the SMS checkbox is there, UNCHECKED, with the full label (not a condition of purchase, 2-5 messages, STOP/HELP)
- [ ] The SMS Terms and Privacy Policy links in the label open and load over https
- [ ] Privacy Policy says "owned and operated by [your legal entity]" - the same name as your brand registration
- [ ] Privacy Policy contains the message-frequency sentence and the no-sharing sentences
- [ ] SMS Terms page includes "Carriers are not liable for delayed or undelivered messages"
- [ ] Privacy and SMS Terms links appear in the footer of your homepage
- [ ] Every URL typed into the campaign form matches these pages exactly
- [ ] If your site uses Cloudflare or similar: policy pages are exempt from email obfuscation and bot protection, and the cache was purged (see below)
- [ ] The robot check: in a private window, open view-source:https://yourdomain.com/privacy and search for email-protection - it must find NOTHING, and your real contact email must appear in the text
## If Your Site Sits Behind Cloudflare (important)

Services like Cloudflare can quietly rewrite your pages for visitors - and the carrier's verification robot reads the rewritten version, not the original. The most common trap: an email protection feature that replaces every email address with a placeholder. Your browser decodes it invisibly; the robot sees a broken page and rejects with error 30908 - privacy policy cannot be verified - even though everything looks perfect to you.

Turn off email address obfuscation for your whole site (Scrape Shield section), or exclude just /privacy and /sms-terms with a configuration rule. Make sure no bot challenge covers those two pages - a challenge page instead of your policy is an automatic failure. Bot Fight Mode cannot be switched off for single pages (Cloudflare: it "cannot be bypassed or skipped" with WAF or Page Rules), so turn it OFF for the whole site under Security > Settings > Bot traffic; high security challenges can be skipped for /privacy and /sms-terms with a rule. Then purge the cache (Caching, Purge Everything) - old rewritten copies keep serving until you do. The view-source check above is how you confirm it worked.

## If You Get Rejected

EDIT the campaign - never delete and recreate. Editing sends it back for review at no new vetting fee; recreating starts you over and pays again. Read the actual error code: 30908 means the privacy policy couldn't be verified; 30933 means the privacy policy URL is missing; 30934 means the terms URL is missing. Search Twilio's documentation for the exact code. Re-read the ENTIRE referenced page, not just the sentence you think matters. Rejection notices describe the PREVIOUS submission - check the date before concluding your current version is broken. Then run the Pre-Flight Check again and resubmit. Most rejections are resolved in one careful edit.

> IMPORTANT: 2026 Campaign Requirements: since June 30, 2026, new A2P campaign submissions REQUIRE a live privacy policy URL and a terms & conditions URL - submissions without them are rejected outright (errors 30933 / 30934), and Twilio actually fetches both pages to verify they load. Your booking system provides both automatically: use https://YOURDOMAIN/privacy and https://YOURDOMAIN/sms-terms. Your domain must be live BEFORE submitting the campaign. Also current: your opt-in URL (your /book page with the consent checkbox) must be live and reachable by reviewers. Looking ahead, the FCC's revoke-all-consent rule takes effect January 31, 2027 - in this system a STOP already ends every text to that number, and only a START from that number turns them back on.

Once approved, send yourself a test booking and confirm the texts arrive. From then on, it just runs.

## Stuck? Common questions - texting (Twilio)

**What is A2P 10DLC? / Why do I have to register?**
It is the US phone companies' registration for business texts sent from an ordinary local number. Since 2023 they block every unregistered business text, so your brand (who you are) and your campaign (what you send and how customers agree) must be approved before your unit's texts go out. Your unit was built to pass it - Steps 6 to 12 walk it.

**Where do I find the campaign? / Where is the A2P stuff?**
On Twilio's site, not in your unit: in the Twilio Console open Trust Hub, then Registrations - the A2P Brands tab is your brand (Step 6) and the A2P Campaigns tab is your campaign (Step 8). In the older Console it is Messaging, then Regulatory Compliance. Your unit's own Twilio card only holds your keys and your number.

**My test texts say "Sent from a Twilio trial account" / they only reach my own phone.**
That is the trial. Upgrade (Step 2) - a trial account can only text your own verified phone and cannot be registered.

**I don't have an EIN.**
Register as a Sole Proprietor (Step 6): no EIN needed, one number and one campaign - plenty for a facility. If you do have an EIN, you must use it (Low-Volume Standard) - Twilio turns down a Sole Proprietor brand for a business with an EIN.

**The verification code never came.**
It has to go to a real US mobile - Google Voice and other internet numbers (Twilio numbers too) are refused. Reply within 24 hours, or send the code again from the same screen.

**How long does approval take?**
The profile up to 48 hours, the brand usually minutes, the campaign about two weeks (Twilio's own pages say anywhere from 5 business days to 15 days). Your unit sends everything by email meanwhile.

**What does texting cost?**
About $1.15 a month for the number and under a penny a text (plus a fraction of a cent the phone company adds). To register: $4.50 once for the brand, $15 once to review the campaign, then $1.50 to $10 a month for the campaign ($2 for a Sole Proprietor). The Console shows the exact amounts before you pay.

**Which use case do I pick?**
A Sole Proprietor brand has only one - take it. With an EIN: Low Volume Mixed (about $1.50 a month) or Account Notification (about $10 a month) - both fit booking confirmations, reminders and door codes.

**My campaign was rejected for the website.**
Your site must be online, open to the public, and show the business name you registered. Check it on your phone with cell data (Step 7), then edit the campaign - never delete it - and send it again.

**My campaign was rejected for consent / opt-in.**
Open your booking page on your phone: the text checkbox must be there, NOT ticked, optional, with its full wording and the SMS Terms and Privacy Policy links. Your unit builds it that way - paste the consent wording from Step 9 word for word, then edit and resend.

**My campaign was rejected for the name.**
Use your legal name exactly as on your IRS letter (the CP 575 or 147C) - spelling and punctuation matter - in your profile, your brand and your website's privacy policy (Admin > Settings > Business & Content, the legal name).

**Texts fail with error 30034.**
The campaign is not approved yet, or your number is not in its Messaging Service. Do Step 11, then wait for Verified.

**It still says In progress / Pending.**
Wait out the review (about two weeks). Past that, contact Twilio Support from the Console.

**Is it safe to paste my Auth Token here?**
Yes - the page saves it straight onto your unit; the assistant never sees it, and it is not sent anywhere else. Never email or text it to anyone.

**Can I use a toll-free number instead?**
Yes - a toll-free number skips the brand and campaign: Twilio verifies it for free in about 3 to 5 business days. It costs about $2.15 a month, and since February 2026 it needs an EIN (unless you are a sole proprietor). Customers recognize a local number better, so most facilities pick local.

## Your Own Mobile, for Urgent Alerts

On the same Twilio - SMS card, **Your own mobile, for urgent alerts** takes YOUR mobile number - never shown to customers, and not the facility's public phone. The unit texts it only when something needs you now: a door lock through Home Assistant that has stopped answering, did not take a booking's code (the customer was sent the backup code) or held a code this system never issued; the door console presenting a certificate the unit does not trust; a member's door access failing; a customer's refund that Stripe refused; or a bay's simulator PC not coming up after its wake. At most one text per problem every six hours, and the same alert goes to your contact email. Leave it empty for no texts. The Owner's Guide ("Texts to You When Something Needs You") has the whole list.


---

# CHAPTER: Setting Up Email

# Setting Up Email
*Your Resend Account, Step by Step*

Email is how every customer gets their booking confirmation and receipt - and it's the guaranteed delivery path for door codes: customers who don't opt in to text messages get their code by email. Running members-only? Email is your ONLY messaging path by design, which makes this the most important connection you set up. Your system uses Resend, a simple email-sending service. Setup takes about 20 minutes, most of it waiting for one verification step.

Do this one early. Email works the moment it's set up - no carrier approval process like texting - so your system can go live on email alone while Twilio approval is pending.

## Part 1 - Create the Account

*Checked against Resend's own help pages, October 2026. Your assistant walks these steps with you one at a time - say "set up email". You need your own website address (a domain) first: no domain yet? Do this after your unit is online.*

**STEP 1 - Sign up**

Go to resend.com/signup. Sign in with Google, or type your email and a password (at least 12 characters, with letters, numbers and a symbol), then click **Create account**. The free plan covers a small facility: 3,000 emails a month and up to 100 a day - on a fully booked holiday your confirmations, reminders and door codes all count toward the 100. Then click your name, **Profile**, **Enable MFA** (two-step login) and keep the recovery code safe.

**STEP 2 - Add your domain**

In Resend click **Domains**, then **Add Domain**. Type your website address the way people type it - like yourgolf.com (no www, no https). For the region pick **North Virginia (us-east-1)**. Leave everything else as it is and click **Add**. Your emails will come from an address at that domain, like bookings@yourgolf.com.

## Part 2 - Verify Your Domain (the important part)

Resend now shows the domain's **Records** - a few lines to add where your domain's settings live (its DNS). They prove to the world's email servers that you are allowed to send from your domain, which keeps your emails out of spam.

**STEP 3 - Add the records (one click on Cloudflare)**

- **Your domain is on Cloudflare** (it is if your unit went online through Cloudflare): click **Sign in to Cloudflare** on the domain's page in Resend, sign in, and allow it. Resend adds every record for you.
- **On GoDaddy:** click **Auto Configure** the same way.
- **Anywhere else** (Namecheap, Squarespace and others): open your domain's DNS settings in another tab. For each line on Resend's **Records** tab, add a record of the same **Type**, copy the **Name** and the **Value** exactly (copy and paste - never retype), and save. In the Name box type only the short part Resend shows - like send or resend._domainkey - never with your domain on the end. Copy exactly what your Records tab shows: newer domains may show different records from older ones.

**STEP 4 - Verify**

Back in Resend, click **Verify DNS Records**. It usually turns **Verified** within 15 minutes, and can take up to 72 hours while the records spread. Until then it says **Pending** - you can carry on with the next step while you wait.

**STEP 5 - Add a DMARC record (recommended)**

Once it is verified, add one more record where your domain's settings live: Type TXT, Name _dmarc, Value v=DMARC1; p=none; rua=mailto:you@yourgolf.com (an address you read). Gmail and Yahoo look for it on business email, and it helps your confirmations land in the inbox.

## Part 3 - Create Your API Key

**STEP 6 - Create the key**

In Resend click **API Keys**, then **Create API Key**. Name it something you will recognize (like Booking box), choose **Sending access**, and for the domain pick the one you just added. Click **Add**, then copy the key - it starts with re_ and it is shown **once**. If you lose it, delete that key and make a new one.

**STEP 7 - Paste it into the chat**

Paste the key here in the chat with your assistant. The page saves it straight onto your unit; the assistant never sees it. Your assistant then asks the address your emails come from - an address at your verified domain, like bookings@yourgolf.com. (Or on a computer: Admin > Settings > Connections, the Resend - Email Notifications card.) It does not need to be a real inbox to send - but customers will reply to it, so if you want to see their replies, set it up as a mailbox or a forward to your regular email where your domain's email is managed.

## Your Email Controls in Admin

On the Resend - Email Notifications card itself is a switch for each email type - Confirmation, Reminder, Door Code, Cancellation, Booking changed by staff and Session Ending - plus the Membership billing reminder if you sell memberships (how many days before a renewal charge monthly members get a heads-up, 7 by default, 0 = off; annual members always get 30 days' notice). Leave Door Code on: a customer who did not tick the text box gets their door code only by email. The main emails - confirmation, reminder, door code, cancellation and the membership emails - are editable in Messaging, each with Reset to Default; the session-ending email, the booking-changed email and the renewal reminders are sent as written.

## Part 4 - Test It

**STEP 8 - Send yourself a booking**

Make a test booking in your own system with your personal email. Within a minute you should receive the confirmation email. Check that it arrives in the inbox (not spam), shows your business name, and looks right on your phone.

- [ ] Confirmation email arrived in the inbox
- [ ] From-address shows your domain
- [ ] Business name and booking details are correct
That's it - email is live. Confirmations, receipts, reminders, and door codes now deliver automatically, to every customer, every booking.

## Stuck? Common questions - email (Resend)

**I don't have a website address (a domain) yet.**
Email needs one - it sends from your own domain so it does not land in spam. Get your unit online first (say "get my box online"): you buy the domain then, and come back to email afterwards. Your unit works without email meanwhile; customers just do not get confirmations.

**Where is my DNS? / Where are my domain's settings?**
Wherever your domain's nameservers point - not always where you bought it. If your unit went online through Cloudflare, it is Cloudflare: your domain, then DNS, then Records. An old Google Domains name is now at Squarespace (Domains, then Custom records). Not sure? Look your domain up at dns.email to see who runs it.

**It still says Pending.**
That can take up to 72 hours. Check every record is there exactly as Resend shows it, with the short name (send, not send.yourgolf.com). On Cloudflare, every record must be DNS only - a grey cloud, not an orange one. Resend underlines a wrong record in red on the domain page. Still pending after 72 hours? Click **Restart verification**.

**It says Failed.**
Resend could not find the records within 72 hours, or one went missing after it worked. Fix the record it points to, then click **Restart verification**.

**My DNS host shows the name twice (like send.yourgolf.com.yourgolf.com).**
Type only the short name, send. For a value that ends in amazonses.com, add a dot at the very end (like feedback-smtp.us-east-1.amazonses.com.) so your DNS host does not add your domain to it.

**Cloudflare shows error 1004 on a record.**
Set that record to DNS only (grey cloud) and save again.

**I use Gmail for my business email - will this break it?**
No - Resend's records go on send and resend._domainkey, not on your main email. One thing to watch on Namecheap: do not switch Mail Settings to Custom MX unless you add Google's records back, or your Gmail stops.

**My emails go to spam.**
Add the DMARC record (Step 5), send from a real name like bookings@ rather than no-reply@, and give a brand-new domain a few days - its reputation builds as people open your emails.

**Customers reply to my emails - where do the replies go?**
To the From address. It does not have to be a real inbox to send, but if it is not one, replies go nowhere. Make it a mailbox, or a forward to your regular email, where your domain's email is managed.

**Does Resend cost anything?**
The free plan is enough for most facilities: 3,000 emails a month, up to 100 a day, no card needed. A busy facility can move to Pro, $20 a month for 50,000 emails with no daily cap.

**What happens if I go over 100 emails in a day?**
The rest wait until the next day (Resend's day resets at 7 PM Central in summer, 6 PM in winter). A busy facility can move to Resend's Pro plan, $20 a month for 50,000 emails with no daily cap.

**Is it safe to paste my Resend key here?**
Yes - the page saves it straight onto your unit; the assistant never sees it, and it is not sent anywhere else.

**It says the From address does not match.**
The From address must be at exactly the domain you verified - bookings@yourgolf.com for yourgolf.com. Tell your assistant the right address and it saves it.


---

# CHAPTER: Setting Up Smart Power

# Setting Up Smart Power
*Your Shelly Plugs, Step by Step*

Smart plugs are how each bay's equipment powers on for a session and off when it ends. Your booking system controls Shelly plugs directly over your local network - no monthly service, no cloud dependency. You need one Shelly smart plug per bay (the current US model is the Shelly Plug US Gen4, the Wi-Fi plug Shelly's US store sells; an older Plus Plug US or any Gen2 or newer Shelly plug works too), plugged in between the wall and the bay's power strip. Already run Home Assistant? It can drive bay power and thermostats instead of, or alongside, Shelly plugs - see Setting Up Home Assistant.

## Part 1 - Add the Plugs to Your Network

**STEP 1 - Install the Shelly Smart Control app**

On your phone, install Shelly Smart Control (App Store / Google Play) and create a free account.

**STEP 2 - Add each plug**

Plug the Shelly into a wall outlet near its bay. In the app: Add Device. Newer Shelly models are found over Bluetooth automatically; the app then joins them to your WiFi. Connect each plug to your facility's 2.4GHz WiFi network - the same network your booking device is on. Name each plug for its bay (Bay 1 Power, Bay 2 Power) so there's never a mix-up.

> IMPORTANT: Your booking system talks to the plugs locally, so the plugs and the booking device must be on the same network. Cloud features in the Shelly app are optional extras - the system doesn't need them. And leave the plug's own device password OFF: control happens on your private network, and a password-protected plug will refuse the system's commands (the Log shows SHELLY_ERROR "asks for a password"). Plugs made from mid-2026 on (Shelly firmware 2.0.0) answer over a secure connection by default; the booking device handles that by itself - nothing to set.

## Part 2 - Give Each Plug a Permanent Address

**STEP 3 - Find each plug's IP address**

In the Shelly app, open a plug and look in its settings/device information for its IP address (numbers like 192.168.1.45). Write down each plug's IP with its bay name.

**STEP 4 - Reserve those IPs in your router (important)**

Routers normally hand out addresses that can CHANGE after an outage - and if a plug's address changes, your system loses it. Log into your router's admin page, find DHCP Reservation (sometimes Address Reservation or Static Lease), and reserve each plug's current IP to its device. Your router's manual or a search for your router model plus DHCP reservation shows the exact clicks.

> IMPORTANT: Skipping the reservation step is the #1 cause of plugs mysteriously not turning on weeks later. Reserve every plug's IP.

**STEP 4b - Set each plug's power-on default**

A power cut ends and every plug decides for itself whether to come back on. Set it in each plug's own settings in the Shelly app (the plug > Settings > Power On Default, or "Power-on default mode" in some versions):

- **A plug that feeds only the simulator PC, set to Leave On (the Wake-on-LAN arrangement in the bay PC guide): "On".** That plug must always have power - without it Wake-on-LAN has nothing to wake, and after a power cut the PC must be able to come back. The booking system never switches this plug off; set its Auto Turn Off to "No - leave on" in the bay (Step 5).
- **Every other plug - projector, lights, TV, or one plug that feeds the whole bay: "Restore last state"** ("Last state" or "Restore" in some versions). After a power cut in the middle of a session the bay comes back as it was; overnight it stays off. "On" would light every bay at 3 AM after an outage; "Off" would leave a customer in a dark bay after a blip mid-session until someone pressed On.

## Part 3 - Connect and Test

**STEP 5 - Enter the plugs in your booking system**

In Admin > Bays & Devices, open each bay and, under Shelly Devices, press + Add Device for each plug: its name, its reserved IP address, and its Generation ("Gen 2 / 3 / 4" for Plus, Pro and newer plugs, "Gen 1" for the oldest). Minutes Before T-Time says how early it switches on; Auto Turn Off says whether it switches off after the session. Then Save All Bays. Plug the bay's equipment into the Shelly.

Test each plug from its own row: press ON, then OFF. The plug clicks and the message says what the plug said. "did not switch" means the plug did not answer - check it is plugged in, on the Wi-Fi, and at the address you entered. (Never switch a running simulator PC's plug off from here - that cuts the PC's power without shutting it down. The bay's own Off button does the safe sequence.)

**STEP 6 - Prove the full cycle**

- [ ] Make a test booking for a bay a few minutes out - the plug clicks ON at session start
- [ ] Let the session end - the plug turns OFF automatically
- [ ] On your admin Dashboard, the bay's tile shows live state - and live WATTS while equipment runs (Gen2 and newer plugs)
- [ ] Unplug one plug from the wall: within about five minutes About > Health > Automation says "1 smart plug(s) not answering on the network" and names it; plug it back in and within about five minutes the line clears on its own
- [ ] Repeat for every bay
That click is your facility running itself: power follows bookings from now on.

## How Power Behaves Day to Day

The OFF is graceful: the system asks the bay PC to shut itself down first, waits for it to finish, and only then cuts the plug - equipment is never yanked mid-write. Back-to-back bookings keep power ON across short gaps instead of cycling everything off and on (the gap length is a setting). The manual buttons in Admin and on the staff screen run this exact same safe sequence - and the Dashboard's Bay Operations console shows each bay's live plug state, wattage, PC status, and whether it was switched by schedule or by hand, with per-bay On, Off, and Restart PC controls (Off and Restart PC warn you if someone is booked).

**A plug that drops off is said out loud.** Every two minutes the booking system asks each plug it is set up with for its status - it only asks, it never switches a plug to check. A plug that does not answer twice in a row is written once in the Log tab (DEVICE_UNREACHABLE) and named on the Automation line under About > Health, in amber: "N smart plug(s) not answering on the network - <the plug's name> (<the bay>)". You see it before a customer finds a dark bay. When the plug answers again the line clears by itself and the Log tab says DEVICE_BACK. A bay you switched off or marked out of service is not asked about.

**Buying plugs today?** The current US plug is the Shelly Plug US Gen4 (the older Plus Plug US is discontinued; the Plug S Gen3 is not sold in Shelly's US store). Gen2, Gen3, and Gen4 devices all use the SAME control protocol - this system works with all of them out of the unit, and Gen2+ report the live wattage the Dashboard shows. Gen1 devices are also supported via their legacy interface (no wattage display).


---

# CHAPTER: Setting Up Your Door

# Setting Up Your Door
*Your RemoteLock Account, Step by Step*

If you chose STAFFED access (a person lets customers in), your system never sends door codes and you do not need this guide or a RemoteLock account. You can change this any time in Admin > Settings > Booking > Facility Access.

This is what makes unmanned access work: every booking gets its own time-limited door code, created automatically on your lock. You'll need a RemoteLock-compatible smart lock installed on your entry door, a RemoteLock account, and three values for your booking system: a Client ID, a Client Secret, and your lock's Device ID.

**Running UniFi Access instead?** Your system issues codes through your own UniFi console too - that is its own guide, Setting Up Your Door with UniFi Access, and for members-only clubs the rule that matters is: put entry doors in the BOOKING door set, so a member's code opens the building only during their booked time. The rest of this guide is RemoteLock-specific.

> IMPORTANT: Two things RemoteLock requires that are easy to miss: API access is not self-serve - after creating your account you must email sales@remotelock.com and ask them to enable API access on it - and your account needs an active paid RemoteLock plan (without a subscription the system cannot create door codes on the lock). Send that email on day one; the rest of this guide works while you wait for their reply.

## Part 1 - Lock and Account

**STEP 1 - Install and register your lock**

Install your RemoteLock-compatible lock per its manual and connect it to your facility WiFi. Create your account at connect.remotelock.com, choose a plan, and add the lock to it (the lock's manual covers pairing). Confirm you can lock/unlock and set a test code from the RemoteLock website before going further - the booking system can only do what your account can do.

**STEP 2 - Email RemoteLock to enable API access**

Send a short note to sales@remotelock.com: your account email, your business name, and "please enable API access on my account for a booking-system integration." This is a standard request they handle routinely.

## Part 2 - Create API Access

**STEP 3 - Create a developer account and OAuth application**

Once API access is enabled, go to developer.remotelock.com and sign in. Create a new OAuth Application - name it something like Booking System. Your booking system uses the Client Credentials connection type.

**STEP 4 - Copy the Client ID and Client Secret**

> IMPORTANT: The Client Secret is shown only ONCE, when the application is created. Copy both values immediately. If the secret is lost, delete the application and create a new one.

## Part 3 - Find Your Device ID

**STEP 5 - Get the lock's ID**

In connect.remotelock.com, open your lock's page. Look at your browser's address bar - the long string of letters, numbers, and dashes at the end of the address is the Device ID. Copy the whole thing. Example: .../devices/fc1a23b4-0000-1111-2222-333344445555 - the Device ID is fc1a23b4-0000-1111-2222-333344445555.

## Part 4 - Connect and Test

**STEP 6 - Enter all three values**

In the setup wizard (or Admin > Settings > Devices, the RemoteLock - Door card): Client ID, Client Secret, Device ID.

**STEP 7 - Prove it end to end**

- [ ] Make a test booking - a door code arrives by email (and text if opted in)
- [ ] That code appears as a guest in your RemoteLock account
- [ ] The code opens the door during the booking window
- [ ] The code does NOT work well before or after the window
All four checks passing means your door runs itself from here on. Keep the RemoteLock plan active - if the subscription ever lapses, code creation stops until it's restored.

**When a code is made.** With "Make the code ahead and check the lock holds it before texting" on (the default), each booking's code is made in RemoteLock an hour before the session, so the lock has time to receive it from RemoteLock's cloud - a lock can take many minutes. It still opens the door only from your "Code works BEFORE session" minutes, it is texted at your "Text the code to the customer" minutes (15 by default), and it is taken off after your "Code works AFTER session" minutes (30 by default). A booking made less than an hour ahead gets its code made at once. With that switch off, the code is made and texted together 15 minutes before, the way it always was.


---

# CHAPTER: Setting Up Your Door with UniFi Access

# Setting Up Your Door with UniFi Access
*Your Own UniFi Console, Step by Step*

If you chose STAFFED access (a person lets customers in), your system never sends door codes and you do not need this guide. You can change this any time in Admin > Settings > Booking > Facility Access.

This is the door-code path for facilities that already run Ubiquiti UniFi. Instead of a RemoteLock account, your booking system talks to the UniFi Access application on your own console, over your own network: every booking becomes a visitor on your console with its own code and its own time window, granted to the doors you choose, and the code stops working when the window ends. Members can open the door with their own member PIN instead (Part 4). It runs locally, needs no subscription (UniFi Access is license-free), and can open several doors - the front door for everyone, a private-room door only for the group that booked it, a member lounge only for a tier. You'll need a supported UniFi console running the Access application, a keypad reader on every door a code should open, the console's address on your network, and an API token you create on the console.

> IMPORTANT: Four things to get right before you start. (1) Codes are typed on a keypad, so every door a code opens needs a UniFi reader WITH a keypad - a reader without one cannot accept a door code. (2) The PIN length is 6 digits on BOTH sides: the console's own PIN setting and the PIN Length in your booking system. Member PINs are 6 digits, one-time codes are made at the same length, and changing the console's setting later invalidates every PIN already on it - so set 6 once, before anyone is synced, even if you do not plan member access yet. (3) The API token is shown once, when you create it, and it must be set to Never Expire - a token with an expiry stops your door codes on the day it runs out. (4) Ubiquiti's list of consoles that run Access does not include the original Dream Machine (the plain UDM) or a Cloud Key Gen2 without Plus, and Ubiquiti's API reference states the API is not available after a console is upgraded to UniFi Identity Enterprise. Check your console against Ubiquiti's own compatibility list before buying readers.

## Part 1 - Check Your Hardware

**STEP 1 - Confirm your console runs UniFi Access**

Ubiquiti's published list of consoles with UniFi Access support: Dream Machine Pro (UDM-Pro), Dream Machine SE (UDM-SE), Dream Machine Pro Max, Dream Wall, Dream Router (UDR) and Dream Router 7, Cloud Key+ (UCK-G2-PLUS), Cloud Gateway Max, Cloud Gateway Fiber, UNVR, UNVR-Pro and ENVR. Ubiquiti's API reference (v4.2.16) requires UniFi Access 1.9.1 or later and states the API is not available after upgrading to Identity Enterprise; run a current UniFi OS and a current Access application, and update first if yours is older.

**STEP 2 - Put a keypad reader on every door a code should open**

Readers with a keypad, per Ubiquiti's specifications: G3 Reader Pro, G2 Reader Pro, G3 Reader Flex, G3 Reader Fingerprint, and the camera readers G6 Entry, G6 Pro Entry and the Intercom. The basic G3 Reader and G2 Reader are card-and-phone readers with no keypad - a booking code cannot be typed on them. Each reader is wired to a UniFi Access hub on its door, per Ubiquiti's installation guide.

**STEP 3 - Set the doors up in Access first**

In the Access application, each entry must already exist as a door (Ubiquiti also calls these locations). Name them the way you say them out loud - Front Door, Bay 3 Room, Member Lounge - because your booking system shows you those names to pick from. If several doors always go together, make a door group in Access; your system can grant a whole group in one tick.

**STEP 3b - Give the console a reserved address**

In your router, reserve (fix) the console's address, the same DHCP Reservation you use for the smart plugs and the bay PCs. The booking system finds the console by its address; a console whose address changes after a power cut stops answering until someone fixes it.

## Part 2 - The PIN Length

**STEP 4 - Set the console's PIN length to 6 digits**

Access > Settings > General > PIN (on some console versions it sits elsewhere under Access's general settings): choose a fixed length of **6 digits**. Write down what it said before. Ubiquiti's own warning, in their words: all users' PINs become invalid once the PIN length is changed - so do this first, before any member is synced, and then leave it alone.

## Part 3 - Create the API Token

**STEP 5 - Create the token on your console**

Ubiquiti's UniFi Access API Reference (v4.2.16, section 1.1) gives the steps in these words:

1. Sign in to your UniFi Portal (https://account.ui.com/login) using your web browser.
2. Select the UniFi Console where the UniFi Access application is installed.
3. Go to Access > Settings > General > Advanced.
4. Go to API Token to Download API documentation and create an API Token.
5. To create an API Token, click Create New, enter the key name and validity period, select the permission scopes, and click Create.
6. Once the API Token is created, ensure to Copy API Token and store it safely for future use. Please note that the key is displayed only once for security purposes.

In our words: name it Booking System, and for the validity period choose the option that never expires. For the permission scopes, your booking system calls the visitor, door and door-group parts of the API: grant Edit on Visitor and at least View on Space (that scope is the doors and door groups). Planning member door access (Part 4)? Also grant Edit on User and Edit on Access Policy. Nothing else is needed. If you lose the token, create a new one and enter the new one in your system.

Community-reported, not in Ubiquiti's documentation: on some consoles a token made on the Settings page did not work, and the one that did was created from Access > Admins & Users > the Owner account > Create API Key. If your fresh token fails Test Connection in the next step and the address is right, try a token made that way.

## Part 4 - Connect and Choose Your Doors

**STEP 6 - Choose UniFi Access as your door provider**

UniFi Access is set up in Admin after Launch, not in the setup wizard. Admin > Settings > Devices, the Door Access Provider card: set Provider to UniFi Access. The card's own Code works BEFORE session and Code works AFTER session minutes apply to every provider - with the defaults, 15 before and 30 after, a 3:00 to 4:00 booking's code opens the door from 2:45 to 4:30.

Then fill in the UniFi fields that appear: Console Address (LAN) - the console's own address on your network, such as 192.168.1.1 (a local name that maps to that address also works), with no http:// and no port; API Token - paste the token from Step 5; **PIN Length - 6 digits**, to match the console's setting from Step 4.

**STEP 7 - Test Connection, the certificate, and your doors**

Click Test Connection. Success reads "Connected (documented)" or "Connected (proxy)" followed by how many doors and door groups were found. The word in brackets is which way your console answers: Ubiquiti documents one way of talking to the console, and some consoles answer a second way instead - your booking system tries both, remembers the one that worked, and checks again on its own if it ever stops answering. You never have to care which.

The message goes on: "This unit only talks to the console presenting certificate SHA-256 ..." followed by a long number and the date it was trusted. That number is your console's certificate fingerprint - its identity on your network. The first time the unit reaches the console (the first Test Connection on a new unit, or the first contact after an update), it records that fingerprint, and from then on it talks ONLY to a console presenting that same certificate. Write down the first and last four pairs of the number. The first check never asks you about a certificate - it trusts the console it finds.

If the certificate ever changes, the unit stops before sending anything - the token included - so no door code is made or removed through it. The Door codes line under About > Health turns red, the Log tab records UNIFI_CERT_MISMATCH, and your own mobile gets a text (see "Texts to you" below). That is expected after the console is replaced, reset or updated. Press Test Connection: it shows the new fingerprint beside the one it trusted and asks "Trust the new certificate?" - say yes only if you know the console changed. If nothing changed on your console, press Cancel and check what is answering at that address before you accept anything.

Under the message, your doors and door groups appear as a checklist. Tick everything EVERY booking code should open - the outside door, the hallway door - and leave doors that belong to one bay or one member tier unticked (those come next). Then click Save Settings. Reads "Failed:" instead? Check the address is the console itself and that the booking device and the console are on the same network, then re-copy the token. Ubiquiti's reference notes the API answers on port 12445 - a firewall rule on the console that blocks that port from your LAN blocks the booking device too. A token created from the Owner account (Step 5) is the next thing to try.

**STEP 8 - Extra doors for a bay or a member tier (optional)**

- A private room behind its own door: Bays & Devices > open that bay > Private Room Door Access (UniFi) > Choose Doors. A booking of THAT bay also opens what you tick here - for walk-ins in their one-time code, for members on their own PIN for the session window. Then Save All Bays.
- A member lounge or private area for one tier: Members > open the tier > Door Access (UniFi) > Choose Doors. Below it, Always-on doors is the list a tier's members open with their member PIN at ANY time, booking or not - it needs member door access switched on (next). Leave it empty and members get door access only for their bookings.

**STEP 9 - Member door access (optional)**

On the Door Access Provider card, under Member Access Network, tick **Enable member door access**, then Save Settings. With PIN Length anything but 6, a red note appears under the unit - set it to 6 here and on the console. From then on:

- **Each member becomes a user on your console, with their member PIN as their door PIN** and no doors of their own. Members are pushed to the console automatically when they join, change their PIN or leave; Sync All Members Now is for onboarding an existing roster, or after changes made on the console by hand.
- **A booking turns their doors on** - the booking doors from Step 7, plus the bay's and the tier's - from your "before" minutes ahead of the start to your "after" minutes past the end, and turns them off again afterwards. Back-to-back bookings keep the door open straight through, with no gap between them. Their door text and email arrive when the access turns on.
- **At the keypad the member types their member PIN, then presses Enter.** Their text reads "Door code ...... (your member PIN) ... Type it, then press Enter." and their email says "Your door code is your member PIN. At the door keypad, type the code and then press Enter."
- **A PIN the console already uses is never handed out.** When you add a member with the PIN field empty, the unit checks the console is not already using the PIN it picked before it shows it to you (a member added while the console was off is checked when it answers; if the console then refuses that PIN, a new one is picked, texted to the member, and written in the Log tab).
- **A member who leaves is DEACTIVATED on the console, never deleted.** Delete the user in UniFi yourself if you want it gone. The booking system only ever changes users it created itself - never anyone else on your console.
- **The one-time fallback code.** If a member's door access cannot be turned on for a booking, they are never left without a way in: they get a ONE-TIME code for that session instead - their text says "ONE-TIME door code ......, today only - your member PIN will not open the door for this booking" - the Log tab records DOOR_CODE_FALLBACK with the reason, and your own mobile gets a text. Every member booking falls back the same way until the cause is fixed (usually the PIN length, or a token without Edit on User and Access Policy); fix it, then press Test Connection and check the member in UniFi Access > Users.

Members-only club? Put your entry doors in the BOOKING door set from Step 7, not in a tier's Always-on doors - then a member's PIN opens the building only during their booked time.

**STEP 10 - Texts to you when a door needs you**

Settings > Connections > the Twilio - SMS card > **Your own mobile, for urgent alerts**: your own mobile number (never shown to customers), then Save Settings. For the door, the unit texts it when the console presents a certificate it does not trust, and when a member's door access failed and they were sent a one-time code. The same alert goes to your contact email (Settings > Business & Content > Contact Information). One text per problem at most every six hours - a problem that lasts does not text you every minute. Leave the unit empty for no texts; the health line and the Log tab carry every problem either way.

## Part 5 - Prove It

- [ ] Test Connection reads Connected, lists the doors you named in Access, and names the certificate SHA-256 it trusts - you wrote down its first and last four pairs
- [ ] PIN Length reads 6 digits here, and the console's PIN setting reads 6 digits
- [ ] Make a test booking - a door code arrives by email (and text if opted in), 6 digits, saying to press Enter
- [ ] In the Access application's Visitors list, a visitor named Golf plus the customer's name, date and time appears, with the booking window and the doors you ticked
- [ ] Type the code, then Enter: it opens the ticked door during the window - and only that door
- [ ] The code does NOT work well before or after the window
- [ ] Cancel the test booking - the visitor is removed from Access
- [ ] With member door access on: add a test member (PIN empty) - they appear in UniFi Access > Users with no door access; book for them - at the "before" minutes they get the text naming their member PIN, the user carries a policy whose name starts "BA ", and their PIN then Enter opens the door; cancel - the access goes and the PIN no longer opens it
Every check passing means your doors run themselves from here on. Admin > Log records each code as it is created and revoked, with the doors it was granted.

## How It Behaves Day to Day

A visitor's code is created at your "before" minutes ahead of the session - or at your "Text the code" minutes when those are longer, so a code is never texted before it exists (at once for a booking made inside that window) as one visitor on your console with the code and the window, and texted and emailed at your "Text the code to the customer" minutes (15 by default) - or at your "before" minutes if those are shorter, so the code always works when it arrives - and a member's at the moment their access turns on. A cancellation removes the visitor from the console; otherwise the console stops honouring the visit when the window ends and your system removes the visitor at your "after" minutes past the session, retrying until it succeeds. Every night at 5:00 a sweep removes any expired visitor of its own that was missed (the console was off that night, say) - only visitors your booking system created, never anyone else on your console - and writes one line in Admin > Log saying what it found and removed.

**When the console does not answer.** A code that could not be made is retried until the console answers, and the Door codes line under About > Health turns red the minute an upcoming session has no working code ("upcoming session(s) do not have a working door code yet"); the Log tab shows AUTOMATION_RETRY. When the console is back the code is made and sent and the line goes green on its own. A code that should have been removed is retried until the console takes it back - the unit never gives up, and the line is red while a code is still live more than two hours after its session. A PIN the console refuses because of its length shows in the Log tab (UNIFI_PIN_LENGTH_MISMATCH) with the fix in words - 6 digits on both sides - and no half-made visitor is left behind. Everything stays on your network: the token never leaves the building and there is no monthly service to keep alive.

**After a software update.** A unit updated from an earlier version may write one line in the Log tab: DOOR_JOBS_REPAIRED, "N door removal task(s) left waiting by an earlier cancel or move were removed - their codes were already off the lock". An earlier version could leave a removal task waiting after a booking was cancelled or moved from the staff pad; those codes were already gone from the door. If the Automation line said "queued but never claimed" before the update, this is what clears it. Nothing to do.


---

# CHAPTER: Setting Up Your Door with a Z-Wave Lock

# Setting Up Your Door with a Z-Wave Lock
*Your Own Lock, Through Your Own Home Assistant, Step by Step*

If you chose STAFFED access (a person lets customers in), your system never sends door codes and you do not need this guide.

This is the door-code path for a Z-Wave lock with a keypad, run by your own Home Assistant on your own network. Every booking gets its own code in one of the lock's code slots; the booking system checks that the lock really holds the code before the customer is texted; and the code is taken off the lock after the session. There is no cloud account and no monthly fee. A standing backup code lives in a slot of its own and is texted beside a booking's code only if the lock ever fails to take one. When a customer opens the door with their code, the unit hears it from the lock and shows when they arrived.

> IMPORTANT: Three things to get right before you start. (1) Home Assistant must already be connected - the Setting Up Home Assistant guide - and its token must be made by a Home Assistant **administrator**. Home Assistant only tells an administrator's token who opened the door; any other token still sets codes, but the unit could never show an arrival. The unit checks this for you (Step 5). (2) The lock must be in Home Assistant through its Z-Wave integration, with its keypad. (3) Some code slots on the lock are reserved for booking codes (Step 3). Keep your own family, staff or cleaner codes in slots outside that range.

## Part 1 - In Home Assistant

**STEP 1 - The lock is in Home Assistant**

Add the lock to Home Assistant's Z-Wave integration the way Home Assistant's own instructions describe, and check you can lock and unlock it from Home Assistant. Write down the lock's name as Home Assistant shows it (a lock entity such as lock.front_door).

**STEP 2 - The token is an administrator's**

If you connected Home Assistant before reading this, check in Home Assistant that the user who made the token is an Administrator (Settings > People, open that person). If not, make a new token while signed in as an administrator (your profile > Security > Long-lived access tokens) and paste it in Admin > Settings > Devices > Home Assistant - Smart Devices.

## Part 2 - In Your Booking System

**STEP 3 - Choose the lock and its slots**

Admin > Settings > Devices, the Door Access Provider card: Provider = **Home Assistant (Z-Wave lock, no cloud)**. The Home Assistant lock fields appear:

- **Lock** - choose the lock from the list (Refresh the list if it is new).
- **Booking slots from / to** and **Backup code slot** - 10 to 29 and 30 unless you already use those slots. **These slots are reserved for booking codes.** On the User Code path (Test the lock names the path), any code the unit finds in them that no booking needs is removed and written in the Log tab, and if it is one this system never issued you are alerted too (a text to your urgent-alerts mobile and an email). Your own codes go in slots outside the range - the low slots (1 to 9) are left for that - and the unit never reads, changes or clears a slot outside it.
- **After typing the code, the customer presses** - the key on the lock's keypad that finishes a code, in words ("the check mark" if you leave it empty). The door-code text says "Type it, then press ..." with exactly this.
- **Members open this door with their own member PIN** - off by default. On: a member's PIN is put in one of the booking slots for their booking's door window and taken out afterwards, and back-to-back bookings keep it in with no gap. Off: every booking, a member's too, gets a code of its own.
- **How codes are written** - leave it on "Decide from what Home Assistant answers".

Press Save Settings.

**STEP 4 - The timing**

On the same card: **Code works AFTER session** (30 by default) is how long after the session the code is taken off the lock. **Text the code to the customer (min before)** is when the text goes out (15 by default). With **Make the code ahead and check the lock holds it before texting** on (the default), the code is put on the lock an hour before the session (a code on this lock opens the door as soon as it is there - the customer simply does not have it until the text), the lock is asked whether it holds it, and the customer is texted at the text timing. A booking made at the last minute has its code checked each minute for up to five minutes and is texted the moment the lock confirms it.

**STEP 5 - Test the lock**

Press **Test the lock**. It names the lock's state and how codes are written, and the slots in use. It also says whether the token is an administrator's: "The token is an administrator's - the keypad reports reach this unit." If it says the token belongs to a user who is not an administrator, fix it now (Step 2) - codes would still work, but the unit could never show who opened the door.

Then press **Set a new backup code now** so the backup slot holds a code from the start.

## Part 3 - Prove It

- [ ] Test the lock names the lock, says codes can be written, and says the token is an administrator's
- [ ] Make a test booking starting about 20 minutes from now, with your own mobile - codes are made an hour ahead, so within a minute of booking the Log tab shows DOOR_CODE_CREATED and, seconds later, DOOR_CODE_HELD (read back from the lock)
- [ ] The text arrives: "Door code ...... Type it, then press" and your finishing key
- [ ] Type the code, then the finishing key: the door opens - and within seconds the Log tab shows DOOR_ARRIVAL with the customer, the time and the bay, and Admin > Bookings shows "Arrived" and the time under the code
- [ ] Cancel the booking: the Log tab shows DOOR_CODE_REVOKED and the code no longer opens the door
- [ ] With member PINs on: a member's PIN opens the door during their booking and not after it

## How It Behaves Day to Day

Each booking's code is put on the lock an hour before the session, checked, texted at your text timing, and taken off after the session (your "after" minutes past the end, 30 by default). Every booking has its own code - another tee time, even by the same person, gets another code. If the lock refuses a code or reads unavailable, the customer is texted their code with the standing backup code beside it ("If it does not open, use ..."), the Log tab says DOOR_CODE_FALLBACK, and you are alerted (a text to your urgent-alerts mobile and an email). If the lock simply has not confirmed a code after five checks, the customer still gets it, with the backup code beside it, and the Log tab says DOOR_CODE_UNCONFIRMED - no alert, because nothing has failed.

**When the lock or Home Assistant stops answering.** The unit asks the lock itself every ten minutes, not only Home Assistant (Home Assistant can show a lock "locked" with its batteries out). After a minute of no answer the Door codes line under About > Health turns red, and after five minutes you are alerted (a text to your urgent-alerts mobile and an email). Codes that fall due meanwhile are retried. When the lock answers again, the unit puts it right from its own record - sets the codes that should be there, clears the ones that should be gone - and writes one line in the Log tab saying what it did. Home Assistant and the booking unit share your network, so they usually go down and come back together.

**Arrivals.** A code typed at the keypad is reported by the lock: the Log tab's DOOR_ARRIVAL line names the customer, the date, the tee time and the bay; Admin > Bookings and the staff pad's Today show "Arrived" and the time. The standing backup code being used is logged as the backup; a code in a slot no booking holds is logged as such.

**If the token is not an administrator's.** Codes still work, but no arrival is ever reported: the Log tab says HA_DOOR_EVENTS_ERROR, Door codes under About > Health is amber ("cannot tell who opened the door"), and Test the lock says so - each with the fix in words (Step 2).

**Switching from RemoteLock or UniFi Access.** Change the provider at a quiet time and leave the old provider's details where they are for a few hours. A code already sent keeps working for its own session, and the unit still takes it back through the system that issued it; every booking from the change on gets a Z-Wave code. Once the last of the old codes' sessions has ended, you can clear the old provider's details. (Clear them sooner and the unit can no longer reach those codes: UniFi's show red on Door codes until their visits end; RemoteLock's simply run out at the end of their session.)

**After a software update.** A unit updated from an earlier version may write one line in the Log tab: DOOR_JOBS_REPAIRED - door removal tasks an earlier version left waiting after a cancel or move on the staff pad. Those codes were already off the lock. Nothing to do.


---

# CHAPTER: Setting Up Home Assistant

# Setting Up Home Assistant
*Connect It Once, Then Give Each Bay Its Devices*

If you already run Home Assistant in your building, this is an alternative to Shelly plugs: connect your booking system to Home Assistant once, and anything Home Assistant manages can follow bookings - a plug, switch or light powers up before a session and off after it, a thermostat pre-warms or pre-cools a bay and sets back when it empties. You can also mix: Shelly plugs directly (the Setting Up Smart Power guide) and Home Assistant for the rest. Don't run Home Assistant? You don't need it - skip this guide; Shelly plugs are the simpler path.

You'll need Home Assistant running on the same network as the booking device, its local address, and a long-lived access token from an administrator user.

> IMPORTANT: Four things that stop this working. (1) Same network, plain address: your system talks to Home Assistant directly, so enter its LOCAL address with http:// and the port, normally http://homeassistant.local:8123 - never the Nabu Casa or remote-access address. (2) The token is shown ONCE when you create it, and it carries the permissions of the user who made it - create it while signed in as an administrator. (3) If you turned SSL on inside Home Assistant, the plain http:// address stops working, and the booking device cannot accept a self-signed certificate - keep Home Assistant on plain http on your own network. An https:// address works only with a real, publicly issued certificate. (4) The name homeassistant.local depends on your router passing along local names and on Home Assistant keeping its default name; when it does not load, use the IP address instead - the address that opens Home Assistant in your browser is the address to enter.

## Part 1 - Find Your Address

**STEP 1 - Open Home Assistant from a browser on the same network**

Try http://homeassistant.local:8123. If it loads, that is your address. If it does not, find Home Assistant's IP address in your router's device list and use http://192.168.1.50:8123 with your own numbers. As with Shelly plugs, reserve that IP in your router (DHCP Reservation) so it never changes after an outage.

## Part 2 - Create the Token

**STEP 2 - Create a long-lived access token as an administrator**

Sign in to Home Assistant as an administrator user. Click your profile (your name or initial at the bottom-left of the sidebar), open the Security tab, scroll to Long-Lived Access Tokens and click Create Token. Name it Booking System and click OK. Copy the token immediately - it is displayed only once. It stays valid for ten years unless you delete it from the same list. (Older Home Assistant versions list the tokens at the bottom of the main profile page instead of under Security.)

## Part 3 - Connect

**STEP 3 - Enter the address and token, then test**

In the setup wizard's Connect Your Services step, under Bay Automation, switch on I run Home Assistant on my network and fill in Home Assistant URL and Long-Lived Access Token. After Launch the same two fields live in Admin > Settings > Devices, the Home Assistant - Smart Devices card, with Enable Home Assistant set to Yes. In either place click Test Connection: success reads "Connected - found N devices". Click Save Settings.

- "HA returned 401 - check token": the token was mis-pasted, deleted, or made by a user that no longer exists. Create a new one.
- Nothing connects, or a timeout: the address. Try the IP form from Step 1. An address that only opens as https:// in your browser means SSL is on in Home Assistant - see the unit above.

## Part 4 - Give Each Bay Its Devices

**STEP 4 - Add devices to a bay**

Admin > Bays & Devices > open a bay > the Home Assistant Devices section. Click Discover Entities - it reads "Found N entities" - then + Add HA Device and fill in the row:

- Device Name - your words: Bay 1 Power, Bay 1 Heater.
- HA Entity ID - click the field and pick from the list Discover built (or type it). Entities are named by kind: switch.bay1_power, light.bay1_lamp, climate.bay1_heater, cover.bay1_door, lock.side_door.
- Type - Power (on/off) for switches, lights, plugs, covers and locks; Climate (temperature) for a thermostat.
- Power devices: Minutes Before (on this many minutes before the session, 10 by default), Auto Turn Off (Yes, or No to leave it on), Turn Off After (minutes after the session ends, 30 by default).
- Climate devices: Comfort Temp during the session (70 by default), Idle, Heating when idle and heating (60), Idle, Cooling when idle with the AC on (80), Lead Time in minutes before the session (15), Setback Delay in minutes after it ends (10). Temperatures are in whatever unit your Home Assistant uses.

A device for the whole building - the heat and AC, a TV in the lounge, the lobby lights, the sign - goes on The Whole Facility card at the top of Bays & Devices instead (below). Click Save All Bays when the rows are filled in.

### The Whole Facility - the heat and AC, a lounge TV

The Whole Facility card (Admin > Bays & Devices, at the top) holds the devices that follow the whole building, never one bay. Or tell your assistant: "put the thermostat on the whole facility, on 30 minutes before, and turn it down if nothing is booked for 3 hours". Each row:

- Device Name and HA Entity ID, as for a bay (Discover Entities fills the list).
- Type - Power (on/off) for a TV, lights or a plug; Climate (temperature) for a thermostat.
- Follows - Bookings in any bay (the usual), or Opening hours (on from before opening until after closing, and for any booking outside the hours - a staffed place that is heated whenever it is open).
- Minutes Before - how early it comes on before the first booking in any bay (10 for power, 15 for a thermostat when you leave it).
- Keep On Between (min) - it stays on while the next booking anywhere starts within this many minutes of one ending (an hour for power, three hours for a thermostat when you leave it); 0 puts it on standby as soon as each run of bookings ends.
- Standby After (min) - minutes after the last booking ends that it goes to standby (10).
- Power: Auto Turn Off (Yes, or No to leave it on once on). Climate: Comfort Temp, Idle, Heating and Idle, Cooling, the same as a bay's thermostat - set for the mode the thermostat is in.

One bay's session ending never turns these off: a TV showing the game stays on while the next booking in any bay is inside its gap. Under the card, "Now:" says what each one is doing and why ("Lobby Thermostat - on (the booking at 6:00 PM, Bay 2)"). A device goes on the facility or on a bay, not both, and a bay's own On and Off buttons never touch a facility device. Each device goes on its own: one that does not answer never stops the others; it is retried, and it shows on Admin > About > Health (Automation) by its name.

Your assistant can also set a thermostat now: "set the lobby to 68" - for the mode it is in; its schedule sets it again at its next change.

What your system sends: a switch, light or plug is turned on and off; a cover is opened at the start and closed at the end; a lock is unlocked at the start and locked at the end, so think before assigning one; a thermostat is moved to Comfort Temp for the session and back to its idle number after, for the mode it is in: Idle, Heating when it is heating, Idle, Cooling when the AC is on, and in heat/cool (auto) mode a range - two degrees either side of Comfort Temp during the session, from Idle, Heating to Idle, Cooling after. A thermostat someone switched off (or to fan only) is left alone and the log says so: your system never turns heating or cooling on over a person. Whether a particular device accepts a particular action is up to Home Assistant and that device's integration, so prove each one with the checklist below.

## Part 5 - Prove It

- [ ] Test Connection reads Connected, and Discover Entities lists the device you want
- [ ] Make a test booking a few minutes out - at Minutes Before, the device turns on (a thermostat moves to Comfort Temp)
- [ ] Let the session end - at Turn Off After, the device turns off (a thermostat goes to its idle number for the mode it is in)
- [ ] The bay's On and Off buttons on the admin Dashboard run the same devices by hand
- [ ] Repeat for every bay
When all four pass, power follows bookings from now on. A following booking inside the keep-on gap keeps the bay on instead of cycling it, exactly as with Shelly plugs, and Admin > Log records every on, off and temperature change with the booking that caused it.


---

# CHAPTER: Setting Up Your Bay Computers

# Setting Up Your Bay Computers
*Windows Prep & the Session Monitor, Step by Step*

Each bay's simulator PC plays three parts in your system: it boots itself when the bay's smart plug powers on, it runs the Session Monitor (the ending warning and the between-session reserved screen), and it shuts itself down gracefully when the booking device asks - before the plug ever cuts power. This guide sets up one bay PC; repeat it for each bay. Plan on 20-30 minutes per PC.

## Part 1 - Prepare Windows (once per PC)

**STEP 1 - Make the PC boot when power arrives**

Restart the PC and enter its BIOS/UEFI settings (usually tapping Delete or F2 at power-on). Find the power option named Restore on AC Power Loss (sometimes After Power Failure or AC Back) and set it to Power On. This is what makes the whole bay wake up when its smart plug clicks on - without it, the plug energizes but the PC sits dark.

**STEP 2 - Two Windows accounts (recommended)**

Create an ADMIN account (e.g. "BayAdmin" - administrator, strong password) and a PLAYER account (standard user) that customers see. The admin account is what the booking system uses to shut the PC down - its username and password go into this bay's fields in Admin. The player account is the everyday desktop; lock it down as much as you like.

**STEP 3 - Make it sign itself in (essential for unstaffed facilities)**

A power blip must never leave a dead bay at a login screen. Signed in as the PLAYER account:

**Windows 11 first:** Settings > Accounts > Sign-in options > turn OFF "For improved security, only allow Windows Hello sign-in for Microsoft accounts on this device" - if this stays on, the checkbox below is hidden. Also remove any PIN from the player account.

Then press Windows+R, run **netplwiz**, select the PLAYER account, UNTICK "Users must enter a user name and password to use this computer", click OK, and confirm the player account's password. Restart to test: the PC should land on the player desktop with no login screen. While you're at it, set Power & Sleep so the PC never sleeps.

**STEP 4 - Open the door for remote shutdown**

The booking device shuts this PC down over your local network - no software agent needed - but Windows must allow it. Signed in as the ADMIN account, open PowerShell as Administrator (right-click Start > Terminal (Admin)) and run these three lines, one at a time:

    Enable-NetFirewallRule -DisplayGroup "Remote Shutdown"

    netsh firewall set service RemoteAdmin enable

    reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f

The first opens the remote-shutdown firewall rule, the second enables the service behind it, and the third lets your local admin account be used remotely. Copy-paste each line exactly. Two more requirements that bite quietly: the admin account's password must NOT be blank (Windows refuses remote shutdown from blank-password accounts), and file-and-printer sharing must be ON for your private network.

**STEP 5 - Give the PC a permanent address**

Find the PC's IP address (Settings > Network, or run ipconfig), then reserve it in your router the same way you reserved the smart plugs' addresses (DHCP Reservation - the Shelly guide shows where). A PC whose address changes after an outage is a PC the system can't shut down.

## Part 2 - Tell the Booking System About This PC

**STEP 6 - Enter the three values**

In Admin > Bays & Devices, open this bay and fill in: Simulator PC IP (the address you just reserved), and the Windows user and password of the ADMIN account from Step 2. That's everything the graceful shutdown needs. Then press **Save All Bays** - until you do, the unit has none of it (and Build Session Monitor, next, builds from the saved bay).

## Part 3 - Install the Session Monitor

**STEP 7 - Build it and copy it**

In that same bay in Admin, click Build Session Monitor. It downloads a zip made for that exact bay - the script, an installer, and a README, with your web address, QR codes, and logo already built in. Nothing to edit. Copy the zip to the bay's PC (USB stick works fine) and unzip it.

**STEP 8 - Remove any older auto-start of a bay watcher first**

If this PC has ever run a session monitor or bay watcher before - ours or anyone's - take out whatever starts it, before you install. Look in four places: Task Scheduler (any task that starts a session monitor or a Python script), the Startup folders (the account's own, and All Users), Settings > Apps > Startup, and any launcher program such as AutoStart. A leftover plus the new one means double popups and double reserved screens after every restart. (Our installer replaces its own launcher and removes its own old scheduled task; anything else is yours to remove.)

**STEP 9 - Run the installer, then restart the PC**

Right-click install-monitor.bat and choose Run as administrator. (If Python 3 isn't installed yet, the README covers it: python.org/downloads, CHECK the "Add Python to PATH" box, and under Customize installation tick "Install Python for all users" - the player account signs in on its own and runs the monitor, so Python must be there for every account.) Then **restart the PC**. The installer stops a monitor it finds already running and starts the new one; the restart makes sure no older copy is still running beside it. From then on it starts whenever ANY account signs in - the player account included.

**What it does all day:** during a session it shows nothing at all until the ending warning - there is no timer on the screen, so an empty screen mid-session is it working, not broken. It pops the ending warning at "Watcher warning (minutes before end)" (Admin > Settings > Devices > Shutdown & Warning Timing; 10 by default), and covers the screens with a BAY RESERVED page between sessions - your website's main photo behind it (the first hero photo from Website), your logo and your booking QR in front - so walk-ups see your brand, not a desktop or the last group's game. Staff can dismiss the reserved screen with Ctrl+Shift+F12 (a watcher built from the October update or later needs no click first). Whole-facility rentals show correctly on every bay's monitor at once.

**When the next group is booked right after,** the same corner panel shows instead, with no QR: the minutes left, "The next group starts in 10 minutes," and "Thanks for playing - please wrap up your round." It never takes the keyboard from the game either, and closes the same three ways.

**A fresh game for the next group (on by default).** Admin > Settings > Devices > **Restart the PC before the next group** - switch it off there if you would rather not. Bookings run on the half hour. A 1:00-3:00 session with the next group at 3:00: the PC stays on and they step straight in - a friend who books 3:00-4:00 keeps the same game going. Next group at 3:30: the reserved screen covers the bay at 3:00, and at 3:20 the PC restarts, so the new group finds the game's main menu, not the last round half played. Next group at 4:00 or later: with auto-shutdown on, the PC shuts down at 3:00 and wakes fresh before 4:00. If the PC was left on anyway - its shutdown was skipped for a booking that was later cancelled, say - it is restarted 10 minutes before the next group whatever the gap, even the next day. The restart happens only when the PC is really on and the bay's watcher really put the reserved screen up, never while anyone is playing (someone who books the gap keeps their game), and never for a booking made in the last few minutes.

**Two timings on the same card.** **Keep the bay on between groups (minutes)**, 30 by default: when the next session on a bay starts within this many minutes of the last one ending, the bay's plugs, TV and PC stay on through the gap instead of switching off and back on. **Bay Off waits for the PC (seconds)**, 90 by default: pressing Bay Off shuts the PC down first and waits up to this long for it before switching off its plug, the projector and the TV - any of them set to stay on between sessions is left on, as the bay's own automation leaves it.

**The ending popup.** When the bay is free after the session, the warning is a popup in the corner of the screen with the minutes left and a QR code - scanning it opens your booking page for that bay, so the group can add time from a phone. It shows once per session (a restart inside that window does not show it again; if staff add time, it shows again for the new end) and it never takes the keyboard or mouse from the game. It closes three ways: the **red X** in its top-right corner, the **Close** button, or a click on the popup and then **Esc**. Left alone it counts down ("Closes in 1:59") and closes itself after two minutes. It sizes itself to the screen at whatever Windows display scaling the PC runs (100% to 175%), so the X and Close are always fully on screen - the QR code gives way first. When the next group is booked right after, there is nothing to add, so the same corner panel asks the group to wrap up instead - no QR, nothing to press.

## Part 4 - Prove the Whole Loop

- [ ] Make a test booking for this bay a few minutes out - the plug clicks ON and the PC boots by itself
- [ ] The PC lands on the player desktop with NO login screen (the Session Monitor shows nothing during a session until its warning - there is no timer)
- [ ] The ending popup appears at your configured minutes before the end (on a bay free afterwards), once, with the red X in its corner, Close fully on screen and the countdown running - and the game keeps the keyboard until you click the popup
- [ ] The popup closes at once with the red X, with Close, and with a click and then Esc
- [ ] When the session ends, the PC shuts itself down cleanly - THEN the plug clicks off
- [ ] Press the bay's OFF button in Admin - the same graceful sequence runs by hand
When all six pass, this bay runs itself: power, boot, sign-in, warning, clean shutdown - booking after booking, with nobody touching it.

## Part 5 - Wake-on-LAN (optional, but the reliable way to power on)

Booting a bay PC by cutting and restoring its plug relies on a BIOS "restore on power loss" setting - and some motherboards simply refuse to honor it no matter how it is set. Wake-on-LAN solves that completely: leave the PC plugged in and it rests in a low-power soft-off, and your booking system sends a "magic packet" over the network that wakes it every time, regardless of the board. Set it up and the PC no longer depends on plug-cycling at all. This is optional - a bay with no MAC entered just plug-cycles as before - but on any PC that misbehaves at boot, it is the fix.

> IMPORTANT: The single most important rule: Wake-on-LAN works ONLY through the motherboard's ONBOARD ethernet port. A USB-to-ethernet adapter loses power when the PC shuts down and can never wake it, and Wi-Fi cannot wake a PC from full shutdown either. Plug the bay PC into the built-in ethernet port, always.

**STEP 1 - Find the onboard NIC's MAC address**

On the bay PC, with its cable in the ONBOARD port: open Command Prompt and run getmac /v. Find the row for the onboard adapter (Realtek or Intel - not any USB or Wi-Fi row) and copy its Physical Address (twelve characters like AA-BB-CC-DD-EE-FF). That is the MAC.

**STEP 2 - Turn on wake in the BIOS/UEFI**

Restart into BIOS (tap Delete or F2 at power-on). The two settings that matter, names vary slightly by board: enable "Resume by PCI-E Device" (sometimes "Wake on LAN" or "Power On by PCI-E" - on MSI boards set "Wake Up Event By" to [BIOS] first to unlock it), and DISABLE "ErP Ready" / "EuP 2013". ErP is the silent killer here - when it is on, it cuts standby power to the network port during shutdown, so the wake packet never arrives. If you see a separate "Resume by LAN", enable that too. Save and exit.

**STEP 3 - Turn on wake in Windows**

Two places. First, Power Options - disable Fast Startup (Control Panel > Power Options > "Choose what the power buttons do" > uncheck Fast Startup; if the checkbox is not there, hibernation is already off and you are fine). Second, Device Manager > Network adapters > the ONBOARD adapter (not the USB one) > Properties: on the Power Management tab check "Allow this device to wake the computer" and "Only allow a magic packet to wake the computer"; on the Advanced tab set "Wake on Magic Packet" to Enabled, and enable any setting named like "Wake on Magic Packet from S5" or "Shutdown Wake-On-Lan".

> IMPORTANT: Manufacturer's note that trips people up: the DEFAULT Windows network driver often will NOT wake a PC from a full shutdown (S5), even with every box checked. If wake works from sleep but not from a full shutdown, install the motherboard maker's own LAN driver from their website - that almost always fixes S5 wake.

**STEP 4 - If this PC gets its IP automatically, re-reserve it**

Moving the cable to the onboard port changes the PC's MAC, which usually changes its IP address - and your bay's graceful-shutdown command uses that IP. Re-reserve the PC's IP in your router against the ONBOARD MAC (same DHCP Reservation step you used for the plugs), and update Simulator PC IP in the bay if it changed. (The Session Monitor does not care - it talks to your booking system, not to the PC's own address.)

**STEP 5 - Enter the MAC and test**

In Admin > Bays & Devices, open the bay, paste the MAC into "PC MAC Address - Wake-on-LAN", set "Wake PC - minutes before session" (10 is a good default), and press **Save All Bays** - the automatic wake uses the saved MAC (the test button below works from the unit even before you save). Fully shut the PC down, then click the "Wake PC (test)" button next to the field.

- [ ] With the PC fully OFF, the Wake PC test button powers it on within a few seconds
- [ ] A test booking a few minutes out wakes the PC on its own ahead of the session
- [ ] The PC still shuts down gracefully at session end (that path uses the IP, so confirm the IP is right after any change)
The recommended arrangement is the best of both: keep a smart plug on the PC set to "leave on", AND enter the MAC. On = the wake packet boots it (the plug stays powered); Off = a graceful Windows shutdown (plug stays powered, PC rests in soft-off); Frozen = on the staff pad (/staff), that bay's **Power cycle** button cuts its plugs for about 8 seconds and turns them back on, as a last resort (Restart PC sends a clean Windows restart, which a frozen PC may not take). Wake-on-LAN for reliable daily on and off, the plug as the hard-reset safety net.

A note on safety: the wake packet has no password (it is just the PC's MAC, which is not secret), but it only works from inside your own network and can only turn a PC ON - it cannot log in or reach anything. Keep your facility Wi-Fi locked down and put any public or guest Wi-Fi on a separate guest network, and there is nothing to worry about.

## If Something Doesn't Work

**PC doesn't boot when the plug clicks on:** the BIOS setting from Step 1 isn't set to Power On.

**PC boots to a login screen:** Step 3 - on Windows 11, the Hello-only toggle hides the netplwiz checkbox until you turn it off, and a leftover PIN can bring the lock screen back.

**PC never shuts down (plug cuts power to a running PC):** re-run the three commands from Step 4, check the admin password isn't blank, and check the IP, user, and password in Admin > Bays & Devices match the PC exactly.

**Wake-on-LAN test does nothing:** the cable must be in the ONBOARD ethernet port (not a USB adapter); ErP/EuP must be DISABLED in BIOS; and if wake works from sleep but not full shutdown, install the board maker's LAN driver. Double-check the MAC is the onboard adapter's, copied correctly.

**No warning at the end, and no reserved screen between sessions:** re-run install-monitor.bat as administrator, then restart the PC. Warnings stopped after a Windows Python update? On the PC run: py -m pip install requests Pillow, then restart.

**Still the old popup after you reinstalled:** restart the PC - that clears any old copy the installer could not stop. Still old after the restart: an older auto-start is in the way (Step 8).

**Two popups at once, or two reserved screens:** an older auto-start is still on the PC. Remove it (Step 8's four places), keep only ours, and restart.

**The X or Close runs off the edge of the screen:** the watcher on that PC is older than the update that fixed it - rebuild and reinstall it (Steps 7 to 9). If it still happens after a restart, photograph the screen and note the display scaling (Windows Settings > Display > Scale) for us.

**Reserved screen stuck on:** Ctrl+Shift+F12 on that PC's keyboard (staff override; it stays off until the next session). With a watcher built from the October update or later the keys work with no click; on an older one, or if nothing happens, click the reserved screen once and press them again.

## After a Software Update

An update changes the booking device only - never the bay PCs. The popup and the reserved screen live on each bay PC, so when our update email says the bay watcher changed, do this on EVERY bay PC: Build Session Monitor for that bay in Admin (the zip is made fresh, with the new watcher inside), copy it over, remove any older auto-start (Step 8), run install-monitor.bat as administrator, and restart the PC. About five minutes a PC. Then check one popup (Part 4) on each.

**Rebuild it after these changes too.** Each bay's watcher is built with a few things inside it: your logo, the first hero photo from Website (behind the reserved screen), your domain (its QR codes), your business name, the bay's name, and your booking device's own network address. Change any of them - a new logo or photo, a renamed bay, a new router that moves the device to another address, the spare swapped in - and rebuild and reinstall that watcher the same way on every bay PC it affects. The warning minutes are not built in: change them in Settings > Devices and every watcher follows on its next check.


---

# CHAPTER: On-Site Test Checklist

# On-Site Test Checklist
*The standard install checklist - after a new unit or an update*

Doors, members and bay automation, checked on the premises. Plain steps, no terminal. About two hours in all; most of it is waiting for a session window. Tick each box as you go.

Everything the unit does is written down in two places: the **Log tab** on the admin page (newest first) and **About > Health** (top of the admin page). Each step says what to look for.

Date: ____________________   Done by: ____________________

## The network - do this first (10 min)

- [ ] In the router's DHCP settings (UniFi Network > Settings > Networks, or your router's DHCP page), give a **reserved (fixed) address** to every device the booking unit talks to:
  * the booking unit itself
  * the UniFi console
  * every Shelly smart plug
  * every simulator PC
  Why: the unit and the bay PCs find each other by address. A device whose address changes after a power cut stops answering until someone fixes it.
- [ ] Restart each of those devices once so it picks up its reserved address.

## Door set-up (5 min)

*Before anyone becomes a member.*

- [ ] **UniFi Access app > Settings > General > PIN:** set the PIN length to **6 digits**. Write down what it said before.
  Note: On some console versions the PIN setting sits elsewhere under Access's general settings.
- [ ] **Admin page > Settings > Devices**, the **Door Access Provider** card:
  * Provider: **UniFi Access**
  * **PIN Length: 6 digits** (a red note appears under it if member access is on and this is not 6)
  * Under **Member Access Network**, tick **Enable member door access**
  Then: Press **Save Settings**.
- [ ] On the same card press **Test Connection**.
  Look for: **Connected** with a number of doors, then "This unit only talks to the console presenting certificate SHA-256 ...". Write down the first and last four pairs of that number.
  Watch: If it asks about a **different** certificate, press Cancel and check the console's certificate yourself before trusting it. It should not ask on the first check after an install or an update - that check trusts the console it finds.
- [ ] Tick the doors a booking should open, under the doors list. **Save Settings**.
- [ ] **Members tab > each tier:** make sure no tier has **Always-on doors** set. Members get door access only for their bookings.
- [ ] **Settings > Connections > the Twilio - SMS card > Your own mobile, for urgent alerts:** the owner's mobile. **Save Settings**.
  Note: The unit texts it (and emails the contact address) if a door lock or the door console, a member's door access, a refund or a bay PC goes wrong.
- [ ] **About > Health:** note what it says.

## A test member books with a real card, opens the door, cancels (30 min)

- [ ] **Admin page > Members tab:** add a test member - name "Test Member", **your own** phone and email, a tier whose sessions are paid, PIN empty - and press **+ Add**.
  Look for: The message shows the PIN. **Write it down.** It must be 6 digits.
  Note: If the message says the door console was already using a PIN, the PIN shown is the new one. That is working as meant.
- [ ] **Log tab:**
  Look for: `UNIFI_MEMBER_SYNC` "Test Member -> user ... | user created, PIN set | the console reports a user's access: **yes** or **no**". **Write down the yes or no.** The member path works either way.
  If not: `UNIFI_MEMBER_SYNC_ERROR` instead: read it. "PIN Length" - fix the door set-up steps 1 and 2, then Members tab > the member's row > **New PIN** (it is made at the PIN length now set, and sent to the console). Anything else - photograph it for your own troubleshooting notes.
- [ ] **UniFi Access app > Users:** "Test Member" is there, with **no** door access.
- [ ] On your phone, open the booking page, enter the member's PIN in the **Member? Enter your PIN first** box, press **Verify**, and book the shortest session starting about **30 minutes from now**. Tick the unit to receive texts. **Pay with a real card.**
- [ ] At the text time - the later of "Code works BEFORE session" and "Text the code to the customer" on the Door Access Provider card, 15 minutes before by default - a text and an email arrive.
  Look for: The text: "Door code ...... (your member PIN). ... Type it, then press Enter." The email: "Your door code is your member PIN. At the door keypad, type the code and then press Enter." The code shown is the member PIN.
  If not: A different number and the words **ONE-TIME door code**: member access could not be turned on, and the unit used a one-off code instead. The owner's mobile gets a text about it. Photograph both for your own troubleshooting notes.
- [ ] **Log tab:**
  Look for: `DOOR_CODE_CREATED` "Booking: ... | member Test Member BOOST | ... | PIN unchanged (member PIN)".
  Note: A `DOOR_CODE_FALLBACK` line means the one-off code from the step above.
- [ ] **UniFi Access app > Users > Test Member:** it now carries door access - a policy whose name starts "BA ".
- [ ] **At the keypad: type the member PIN, then press Enter.** The door opens.
- [ ] **Admin page > Bookings:** cancel the booking. When it asks about a refund, choose **3 = No Refund**. The next part refunds it in Stripe, to test that the unit notices.
- [ ] Within a minute:
  * **UniFi Access > Users > Test Member:** the "BA" access is gone. The user and PIN stay.
  * **At the keypad, the member PIN no longer opens the door.**
  * **Log tab:** `DOOR_CODE_REVOKED` "member boost detached: user ...".

## Refund the test payment in Stripe, and see the unit pick it up (5 min)

- [ ] In **Stripe's dashboard** (Payments), find the test payment and **Refund** it in full.
- [ ] **Admin page > Revenue tab:** the line under the figures says "Refunds made in Stripe's own dashboard are picked up automatically". Press **Check Stripe now**.
- [ ] **Look for:** The refund appears - the refunds line counts it.
  Note: The unit also checks by itself at start-up and every night. Check Stripe now just does it at once.

## Remove the test member (2 min)

- [ ] **Admin page > Members tab > Test Member > Deactivate.**
  Note: The booking system never deletes a person's record outright. Deactivate is how a member is removed.
- [ ] Within a minute:
  Look for: **UniFi Access > Users:** Test Member shows **deactivated**, and the Log tab has a `UNIFI_MEMBER_SYNC` line saying "deactivated".
  Note: You can delete that user in UniFi yourself if you want it gone from the console. The booking system only ever deactivates.

## The bay automation (60 min)

*All on the Bays & Devices tab: open the bay there.*

### Smart plugs - each Shelly

- [ ] **Bays & Devices > the bay > Shelly Devices:** add the plug - its name, its **reserved** address, and its **Generation** ("Gen 2 / 3 / 4" for Plus, Pro and newer plugs, "Gen 1" for the oldest). **Save All Bays**.
- [ ] For every plug **except the simulator PC's own plug**: press the plug's **ON**, then **OFF** in that row.
  Look for: The plug clicks each time and the message says ON / OFF.
  If not: It says **did not switch**: the unit could not reach the plug. Check the address.
  Note: Never switch the simulator PC's plug off while the PC is running - that cuts its power without shutting it down.
- [ ] For one of those plugs: **unplug it from the wall.**
  Look for: Within about five minutes, **About > Health > Automation** says "1 smart plug(s) not answering on the network - <the plug's name> (<the bay>)", and the Log tab has `DEVICE_UNREACHABLE`.
  Then: Plug it back in. Within about five minutes the line clears on its own and the Log tab has `DEVICE_BACK`.
- [ ] **Set each plug's power-on default in its own settings** (the Shelly app > the plug > Settings > Power On Default, or "Power-on default mode"):
  * **Simulator PC's plug: On** - That plug must always have power, or Wake-on-LAN has nothing to wake, and after a power cut the PC must be able to come back. The unit never switches this plug off - set its **Auto Turn Off** to "No" in the bay's settings.
  * **Every other plug: Restore last state** - Projector, lights, TV power. ("Last state" or "Restore" in some versions.) After a power cut mid-session the bay comes back as it was; overnight it stays off. "On" would light every bay at 3 AM after an outage; "Off" would leave a customer in a dark bay after a blip until someone pressed On.

### The bay PC - before the watcher and Wake-on-LAN

- [ ] Follow the bay PC steps in the bay's settings: the PC signs itself in, and the remote shutdown steps (file and printer sharing on, the network set to **Private**).
- [ ] **Bays & Devices > the bay:** **PC MAC Address**, **Simulator PC IP** (its reserved address), and **Windows Username** and password (for the end-of-session shutdown). Save.

### Bay watcher - the session popup

- [ ] **Bays & Devices > the bay > Build Session Monitor.** It downloads a zip made for that bay. Copy it to the bay PC and unzip it. **Before running the installer, remove any older auto-start of a bay watcher:** Task Scheduler (any task that starts a session monitor or a Python script), the Startup folders (the account's own and All Users), Settings > Apps > Startup, and any launcher program such as AutoStart. Then run the installer (the README inside says how), and **restart the PC**.
  Note: A leftover plus the new one means double popups and double reserved screens after every restart.
  Note: Why the restart: the installer stops the watcher it finds running, and the restart makes sure no older copy is left beside the new one.
  Note: After an update, do this again on every bay PC: the popup lives on the bay PC, and it only changes when the watcher is rebuilt and reinstalled.
- [ ] Book **three** 30-minute sessions on that bay with a free half hour after each (for example 12:00, 1:00 and 2:00). The popup shows once per session, and only when the bay is free afterwards. Member bookings are fine - cancel them afterwards.
- [ ] **Look for:** **Ten minutes before the session ends, the popup appears** on the bay PC's screen with the minutes left and the **QR code**. Scan it with a phone: it opens this facility's booking page for that bay.
  Note: The watcher talks to the unit on the facility's own network, and to the public web address only if that does not answer - so reserve the unit's address.
- [ ] Have the simulator software (or any game) running full screen, at the PC's real scaling (Windows Settings > Display > Scale - leave it as the customer uses it).
  Look for: The popup shows **once**, with a **red X** in its top-right corner and the **Close** button fully on screen, and a countdown ("Closes in 1:59"). The game keeps running and keeps the keyboard until you click the popup.
- [ ] Close the first session's popup with the **red X**, the second's with **Close**, and the third's by clicking the popup, then pressing **Esc**.
  Look for: Each one closes at once. Left alone, a popup closes itself when the countdown reaches 0:00.
  Watch: If the X or Close is cut off at the edge of the screen, photograph the screen and note the scaling.
- [ ] After the last test session, with nothing booked on the bay for the next ten minutes, the reserved screen covers the bay PC's screens. Press **Ctrl+Shift+F12** on the bay PC's keyboard - without clicking anything first.
  Look for: Before you press: BAY RESERVED, your logo and the booking QR on a panel, with your website's main photo behind it. When you press: the reserved screen goes away at once and stays away until the next session starts on that bay.
  Watch: If nothing happens, click the reserved screen once and press the keys again. If that works, note that it needed the click.
- [ ] Book two sessions back to back on the bay (for example 4:00-4:30 and 4:30-5:00), with the game running full screen.
  Look for: Ten minutes before the first one ends, the corner panel shows with no QR: the minutes left, "The next group starts in 10 minutes," and "Thanks for playing - please wrap up your round." The game keeps the keyboard; the red X closes it.
  Then: Cancel the test sessions afterwards.
- [ ] With **Restart the PC before the next group** on (Settings > Devices - on by default): book a session, and the next one on the same bay starting 30 minutes after it ends. Leave a game running.
  Look for: When the first session ends the reserved screen covers the bay. Ten minutes before the next tee time the PC restarts (the Log tab: `RESTART_SENT`) and comes back to the game's main menu, with the reserved screen lifted for the next group.
  If not: `RESTART_SKIPPED` "its bay watcher has not reported the reserved screen": the watcher is not running on that PC, or it was built before October 2026 - check its auto-start and that the PC is signed in, or rebuild it. (That line is written once per bay every twelve hours.)

### Wake-on-LAN

- [ ] On the bay PC: Wake-on-LAN on in the BIOS, and in the network adapter's settings (Power Management: "Allow this device to wake the computer"; Advanced: "Wake on Magic Packet").
- [ ] Shut the PC down (Start > Shut down - not sleep). Book a short session on that bay starting about **15 minutes from now**.
- [ ] Ten minutes before the session the unit wakes the PC.
  Look for: About five minutes later the Log tab says `PC_UP` "... answers on the network" or "... its watcher is asking the unit".
  If not: It says the PC did not come up: the unit wakes it again and checks once more a minute later; if it still cannot see the PC it alerts the owner (a text to the urgent-alerts mobile and an email), and **About > Health > Automation** says "a simulator PC did not come up after its wake". Check the BIOS setting, that the PC's plug is on, and that the PC signs in and its watcher runs.
  Then: Cancel the test session afterwards.

### TVs

- [ ] **Bays & Devices > the bay:** check each TV's learned "on" and "off" codes, and its code type: "One power button that toggles (most TVs)" - the default - or "Separate ON and OFF buttons on the remote".
- [ ] **From the unit:** book a short session on the bay.
  Look for: The TV switches on at the "before" minutes and off after the session. The Log tab has `BROADLINK_ON` / `BROADLINK_OFF`.
- [ ] **From the manual bay buttons** (Dashboard > the bay's **On** / **Off**, or the staff pad): press **Off** - the TV goes off. Press **Off** again.
  Look for: On a toggle TV the unit does **not** send it again (that would switch the TV back on). The message says "TV ... not sent - the unit sent "off" at ..." and that pressing Off again within two minutes sends it anyway.
  Then: Press **On** - the TV comes on.
  Note: If someone uses the TV's own remote the unit cannot know. If the TV is on when the unit thinks it is off (or the other way round), press the same button again within two minutes and it is sent anyway.

## Optional: the door console unreachable (15 min)

*Do this before removing the test member, while Test Member is still active.*

- [ ] Unplug the UniFi console's network cable (or power) **first**. A session starting inside the door window gets its access within a minute of booking.
- [ ] Book as Test Member, starting about 10 minutes from now.
- [ ] **Look for:** Within a minute or two: **About > Health > Door codes** is **red** ("upcoming session(s) do not have a working door code yet"), and the Log tab shows `AUTOMATION_RETRY` ... door_code.
- [ ] Plug the console back in.
  Look for: Within about ten minutes the access turns on, the text arrives, and Door codes goes back to green.
  Then: Cancel the booking and check the access goes off.

## Optional: a Z-Wave door lock through Home Assistant (45 min)

*Skip unless the door is a Z-Wave lock run through Home Assistant (Settings > Devices, Door Access Provider: Home Assistant). UniFi doors use the parts above.*

### Set-up

- [ ] **Router:** give the Home Assistant box a reserved (fixed) address, like everything in the network part.
- [ ] **Home Assistant, signed in as an administrator:** your profile, at the bottom: **Long-lived access tokens > Create token**. Copy it once; Home Assistant never shows it again.
  Look for: Only an administrator's token is told who opened the door. Not sure? In Home Assistant, Settings > People, open the person: **Administrator** is on.
- [ ] **Admin page > Settings > Devices > Home Assistant - Smart Devices:** set **Enable Home Assistant** to **Yes**, enter the unit's address (as it opens in a browser on the same network) and the token, then **Save Settings**.
  Watch: If the Lock list below stays empty, Enable Home Assistant is still at No - choosing Home Assistant as the door provider does not switch it on, and no code is ever set until it does.
  Look for: The token shows masked from then on.
- [ ] **Door Access Provider:** Home Assistant (Z-Wave lock, no cloud). In the lock fields that appear: choose the **Lock**; **Booking slots from / to** and **Backup code slot** (10-29 and 30 unless the owner already uses those); **After typing the code, the customer presses**: the lock's finishing key (on a Yale, "the check mark"); tick **Members open this door with their own member PIN** if members should use their PIN. **Save Settings**.
  Note: **The booking slots and the backup slot are reserved for booking codes.** Any code the unit finds in them that no booking needs is removed and written in the Log tab (on the User Code path); if it is one this system never issued, the owner is alerted too. The owner's own codes (family, staff, cleaners) go in slots OUTSIDE that range - the unit never reads, changes or clears a slot outside it.
- [ ] Press **Test the lock**.
  Look for: It names the lock and says how codes are written - for most Z-Wave locks, "a User Code lock - each code is written ... and read back from the lock itself before it is texted" - and ends "The token is an administrator's - the keypad reports reach this unit."
  Note: Red text saying the token belongs to a user who is not an administrator: make a new token as an administrator (the step above) and paste it in Settings > Devices > Home Assistant. Codes would still work, but the unit could never show who opened the door.

### A visitor's code

- [ ] Book the shortest session starting about **20 minutes from now**, with your own mobile.
- [ ] **Look for:** Right away - a code goes on the lock up to an hour before its session - the Log tab shows `DOOR_CODE_CREATED` "... slot N on ..." and, a few seconds later, `DOOR_CODE_HELD` "... read back from the lock N s after it was sent". About 3 to 4 seconds is normal. Write the number down.
- [ ] **Look for:** Your text arrives 15 minutes before the start ("Text the code to the customer"): "Door code ...... Type it, then press the check mark."
- [ ] **At the keypad: type the code, then the finishing key.** The door opens.
  Look for: Within a few seconds the Log tab shows `DOOR_ARRIVAL` "Booking: ... | your name | the date and time on the bay | arrived - the keypad opened the door with slot N", and **Admin page > Bookings** shows "Arrived" and the time under the door code.
  Note: Nothing in the log after a minute: the unit is not hearing the lock's reports. Look for `HA_DOOR_EVENTS_ERROR` in the Log tab - it names the fix (usually the token). Otherwise photograph the Log tab and About > Health for your own troubleshooting notes.
- [ ] **Admin page > Bookings:** cancel the booking (No Refund).
  Look for: Within seconds the Log tab shows `DOOR_CODE_REVOKED` "slot N on ... cleared". **At the keypad, the code no longer opens the door.**

### A member's PIN (only if member PINs are ticked)

- [ ] Make a test member with a PIN and book two sessions back to back for them (for example 12:00-12:30 and 12:30-1:00).
- [ ] **Look for:** At the first window's start the text says "Door code .... (your member PIN) ... Type it, then press the check mark." The Log tab shows `DOOR_CODE_CREATED` "member PIN" and `DOOR_CODE_HELD`.
- [ ] **Look for:** At the second booking's code time the Log tab says the slot "already holds it for their booking before this one, and keeps it through both". When the first session ends: `DOOR_CODE_KEPT` "... stays - the member's next booking uses the same PIN". The PIN opens the door all the way through, with no gap between the sessions.
- [ ] **Look for:** After the second session ends (plus "Code works AFTER session"): `DOOR_CODE_REVOKED`, and **the PIN no longer opens the door.** A member's PIN only works during their bookings.

### Optional: the Home Assistant box unreachable

- [ ] Book a session so a code comes due in about 5 minutes, then **unplug the Home Assistant box's network cable** and leave it out for about 10 minutes, past the code's time.
- [ ] **Look for:** Within a minute: `HA_DOOR_UNREACHABLE` in the Log tab, and About > Health shows Door codes **red**: "the door lock has not answered for N minute(s)". At the code's time: `AUTOMATION_RETRY` ... door_code.
- [ ] **Look for:** After 5 minutes the owner is alerted - a text to the urgent-alerts mobile and an email: "The door lock has not answered for 5 minutes ...".
- [ ] Plug the cable back in.
  Look for: Within a minute: `HA_DOOR_BACK`, `HA_DOOR_JOBS_RETRIED`, `DOOR_RECONCILE` "... N set, N cleared ...", then the booking's `DOOR_CODE_HELD` and its text. The code works at the keypad and Health goes back to green.

## If something is wrong (reference)

- **No text, nothing in UniFi** - Look: About > Health, then the Log tab. Means: Door codes red: the console did not answer. Check it is on and on the network, then Test Connection.
- **The code texted is not the member PIN** - Look: Log tab. Means: Member access could not be turned on; the member got a one-time code. Photograph the log for your own troubleshooting notes.
- **`UNIFI_MEMBER_SYNC_ERROR` or "PIN Length" in the log** - Look: Settings > Devices > Door Access Provider > PIN Length, and the console's PIN setting. Means: Both must be 6.
- **Door codes says the console presented a certificate this unit does not trust** - Look: Settings > Devices > Test Connection. Means: Test Connection shows the new certificate and asks. Say yes only if the console was replaced, reset or updated.
- **Home Assistant lock: no `DOOR_CODE_HELD`, or Door codes red "has not answered"** - Look: About > Health, then the Log tab. Means: Home Assistant is off or off the network, or the lock itself is not answering (its batteries, or out of Z-Wave range). The unit puts the lock right by itself when it answers.
- **Home Assistant lock: the owner was texted that a code was removed from a reserved slot** - Look: The Log tab: `DOOR_STRANGER_CLEARED` names the slot. Means: A code was put inside the booking range by hand or from the lock's own app. The range is reserved; put that code back in a slot outside it.
- **Home Assistant lock: the door opened but no `DOOR_ARRIVAL` in the log** - Look: The Log tab for `HA_DOOR_EVENTS_ERROR`; About > Health (Door codes amber, "cannot tell who opened the door"); Test the lock. Means: Usually the Home Assistant token is not an administrator's - make one as an administrator and paste it in Settings > Devices > Home Assistant. Anything else: photograph the Log tab and Health for your own troubleshooting notes.
- **`DOOR_JOBS_REPAIRED` in the Log tab right after the update** - Look: The Log tab; About > Health > Automation. Means: The update removed door removal tasks an earlier version left waiting after a staff-pad cancel or move. Those codes were already off the lock. If Automation was red with "queued but never claimed", this is what clears it. Nothing to do.
- **The bay PC still shows the old popup after the watcher was reinstalled** - Look: The bay PC. Means: An old copy is still running - restart the PC. Still old after the restart: an older auto-start is in the way (remove it).
- **Two popups at once, or two reserved screens** - Look: Task Scheduler, the Startup folders, Settings > Apps > Startup, launcher programs. Means: An older auto-start of a bay watcher is still on the PC. Remove it, keep only the new one, restart the PC.
- **Automation says a smart plug is not answering** - Look: The plug and its address. Means: Unplugged, off the Wi-Fi, or its address changed (reserve it).
- **Automation says a simulator PC did not come up** - Look: The PC's BIOS and network adapter, its plug, its sign-in. Means: Wake-on-LAN off, the PC's plug switched off, or the unit cannot see it - the PC not signed in so its watcher is not running, and file sharing off or the network set to Public.
- **Access still on after the "after" time or a cancel** - Look: About > Health. Means: The unit keeps trying and never gives up; red after two hours. Remove it in UniFi yourself meanwhile.

---

# CHAPTER: Owner's Guide

# Owner's Guide
*Running Your Booking System, Day to Day*

This guide is your reference for everything after setup. Your admin panel lives at yourdomain.com/admin - from anywhere, not just the building. Every section below matches a card or tab you'll find there. When in doubt, look for the small hint text under each field - the panel explains itself as you go.

## Find Anything, Ask Anything

The search bar in the admin header finds any setting: type what you're looking for in your own words ("texting", "cancel window", "check in") and click a result - the panel jumps there and highlights it. Next to it, the **Guides** button opens every guide to read or download - each release carries the set that matches it - plus the whole manual as one file: copy it into ChatGPT, Claude, or Gemini, describe your facility, and ask questions about YOUR setup in plain English. (The search covers the admin tabs; the Website editor is its own page.)

## The Booking Page - What Customers See

Customers pick a bay, a date, and a time, enter their details, and pay. Members enter their PIN first, at the top of the page - verifying immediately unlocks their extended booking window, member rates, and guest options before they choose anything. Prices shown are live previews of exactly what the server will charge, including member discounts, guest fees, and any caps. If you're open 24 hours, a Late Night section appears automatically in the time picker, and late sessions can run across midnight.

## Hours & Booking Rules

Settings opens on the Booking group: open days, opening and closing times, session lengths, booking window and buffer. **Different hours on some days** (under Days Open): tick a day to give it its own opening and closing time - open later on weekends, close early on Sundays; days not ticked use the times above, and the booking page, the staff pad and every check use each day's own. Or just tell the assistant: "noon to 10 weekdays, 9am to midnight weekends". The cancellation window, early bay access and check-in mode are on Settings > Business & Content > Facility Policies. Check Open 24 Hours and the time fields gray out. Closing after midnight (1-2 AM)? Use the after-midnight checkbox instead.

**Facility Access** is the big switch: Unmanned means every booking gets a unique time-limited door code, sent at your "Text the code to the customer" time (15 minutes before by default). Staffed means a person lets customers in - no door codes are ever generated, all booking-page wording adapts, and confirmations and reminders still send. Hybrid ("Both") means staffed some hours: mark them in Website > Staffed Days, or with a season in Settings > Schedule; door codes always send at a hybrid facility so nobody's locked out.

**Who Can Book:** Everyone, or Members only - the Members & Memberships chapter covers running a private club.

**Booking Unit:** Per-bay, or Entire facility - one booking takes every bay, customers pick only date and time, and the base price per 30 minutes IS the whole-building rate. Per-bay premium pricing never applies in facility mode. Every bay still runs its full power sequence, and you keep independent per-bay control on the Dashboard.

**Check-in mode** (Settings > Business & Content > Facility Policies): Off (a booking is simply valid - the default for unmanned facilities), arrival-only, or full counter flow with headcount and settlement. The Getting Started card flags the recommended setting for your style.

## Pricing, Premium Bays & Gift Cards

Your base rate is per 30 minutes. Pricing tiers (the Pricing tab) charge differently by day and hour - weekend premiums, off-peak discounts - and every price everywhere is built from the same calculation. Check "Show these prices to customers" and every open slot on the booking page wears its live price.

**Premium bays:** each bay can carry a tagline, feature chips (screen size, hardware), and a flat price adder per 30 minutes (set per bay on Bays & Devices) - the bay picker shows the difference and a Premium tag appears automatically on bays that cost more. (Never applies under whole-facility mode.)

**Gift cards** (Members tab > Gift Cards) are stored-value codes: sell any amount, the balance draws down purchase by purchase, and they never expire. **Discount codes:** percent off, dollars off or free minutes; max uses (blank = unlimited); uses per person (one, three, five or unlimited - unlimited for member codes); and the last day it works (blank = never - the code works through the end of that day). **Check at the door** (optional) is for a rate you give a group - military, first responders, seniors, students: write what staff should see ("a military ID"). The customer types the code when they book; the booking page, their confirmation (on screen and by email) and their booking online all tell them to bring it, and your staff pad shows "Check: a military ID" on their booking and at check-in. A rate checked at the door works every visit unless you pick a limit per person - a veteran is a veteran every time. A code comes off after any booking deal that fits.

### Booking deals and package deals (Pricing tab)

**Booking Deals** are deals on the golf itself, with no code to type: when a booking fits one, its price is lower - on your booking page, at checkout and for a booking made at the counter, staffed or not. "Book 2 hours on Tuesdays and the last 30 minutes are free", "20% off any booking of 3 hours or more", "$10 off weeknights after 8". Each has its kind (the last minutes free, a percent off, dollars off), the booking it needs (at least 2 hours, say - a minutes-free deal always needs one, because the free minutes come off the end of a longer booking), its days and start window, and a first and last day if it is seasonal. Only the best deal that fits is taken, never two (a discount code the customer types still comes off after it - a 10% code on a $60 deal booking takes $6); a member books at their own price and never pays more than the same session costs without their code. The card shows what a booking comes to before you save ("2 hours on Tue: $80.00 → $60.00"), and your booking page lists the deals. "Buy an hour, get an hour" is a booking deal too: 2 hours or more, the last 60 minutes free.

**Something free with a booking** is a booking deal as well - pick "Something free with the booking" and choose what comes free off your menu: "book 2 hours, get 2 pitchers free", "a free appetizer with any booking on Mondays". There is nothing for the customer to pick and no special booking to make: they book as usual, the booking page and their confirmation email say "2 Pitchers free at the front desk", and your staff pad shows "Free: 2 Pitchers" on that booking. Staff ring the pitchers up as usual and they come to $0 on that booking's tab (a third one is charged). The bay's price does not change, so it can run beside a money deal. It needs someone at a counter with food and drink: at a facility that is unstaffed some of the time, give it a start window inside your staffed hours.

**Package Deals** are bay time and what comes with it at one price - "2 hours and a pitcher for $60", a birthday party at $25 a person with a pizza and two drinks each, a corporate outing. Each has its bay time, its price (one price, or a price a person with the least and the most players), what it includes at the counter (an item, or any of a part of your menu - "2 beers each" is 2 from Beer a person), its days and start window, whether it is sold on your booking page, and **how it is taxed, which is yours to say**: all of it as a booking, all of it at one of your counter's tax codes, or split - the golf part as a booking and the rest at a counter code. The card shows its price, tax and total for the least and the most players before you save.

Customers pick a package on your booking page (its length is fixed, only the times it covers can be picked, and the summary shows its tax and total) and pay it in full when they book. At your counter, what it includes rings up at $0 on that booking's tabs - "Included in Birthday Party" - until it is used up; more than that is charged as usual, and a void gives it back. Staff see the package, and what is left of it, on the booking and at check-in; the confirmation email lists it with its own tax. A facility with no food and drink at the counter sells packages of bay time only. A package you change or delete later never changes a booking already made.

**Selling a package at the counter** (a walk-in party, a phone call): on the staff pad, New booking > Package - its length and its price for the players are the package's, paid at the counter, and at check-in each seat's share is taxed the way you set for the package. **Your packages on the website:** in the Website editor, add a Cards block and set Show to "Your package deals, live" - each package on sale becomes a card with its price, what it includes and when, and a Book button that opens your booking page with it picked (or tell your assistant "show our packages on the website").

### Which one do I use? What the customer does

| You want | Use | What the customer does |
|---|---|---|
| Time or money off a booking ("last 30 minutes free", "20% off weekday afternoons") | A booking deal | Nothing - they book as usual and the price is lower, online or at the counter |
| Something free with a booking ("2 free pitchers with 2 hours") | A booking deal, "Something free with the booking" | Nothing - they book as usual; staff hand it over at the front desk ($0 on their tab) |
| A bundle at one price (a party, "2 hours and a pitcher for $60") | A package deal | They pick the package on your booking page, or staff sell it at the counter |
| A cheaper or dearer half hour at set times (happy hour, peak) | A price window (Pricing tiers) | Nothing - it is the price for those times |
| Food or drink cheaper at set times ("$1 off drafts Fridays 4 to 7") | A food and drink special | Nothing - the counter charges the special price while it is on |
| A rate for a group (military, seniors, students) | A discount code with "Check at the door" | They type the code when they book and bring their ID; staff check it - every visit |
| A first-visit offer ("$10 off your first visit") | A discount code (once per person - by phone number), shown in the website's first-visit band | They type the code when they book; it works once for each person |
| A promotion for people who know the code | A discount code | They type it when they book |

**Ask your assistant:** "what deals can I run?" or "Tuesdays are dead - how do I get people in?" and it lays out every kind it can set up - booking deals, packages, happy hour prices, food and drink specials, codes, a first-visit offer, memberships, gift cards - with examples from your own menu and how the customer gets each one, and sets up the one you pick. "Make a birthday package: 2 hours, a pizza and 2 drinks each, $25 a person, 6 to 10 people", "book 2 hours on Tuesdays and the last 30 minutes are free", "book 2 hours and get 2 free pitchers", "make MILITARY20 for 20% off, check a military ID at the door", "take me to packages". Not built yet: prepaid hour packs ("buy 10 hours, get 2 free" - a gift card of that value works today), a bonus on gift cards, and loyalty points.

### Flyers - your homepage, Facebook, Instagram and email

A flyer is a designed card in your own colours, fonts, name and logo, with a photo - for a booking deal, a package, an event or a food and drink special. Its words come from the deal itself, so they always match what customers are charged, and every flyer says where to book ("Book at" your website's address) and, when the deal has an end, its last day. Four looks: Poster (your photo above, the words on your header colour), Bold (the deal huge), Photo (your photo edge to edge) and Clean (light and quiet).

**By talking:** "make a flyer for the Tuesday deal" (or the birthday package, the league night, Taco Tuesday). It goes first in the slides on your homepage until the deal's last day, and shows in the chat with three download buttons. Say "make it bolder", "use the photo" or "simpler" for another look, and "email it out" to send it to everyone signed up for your email updates. Something you have not set up yet: "make a flyer for our grand opening Saturday, free hot dogs".

**By hand:** Website editor > Offer Slides > Make a flyer. Pick what it is for, its look and its photo; change any of its words; then "Put it first in the slides" (and Save Offer Slides), or download it.

**On Facebook or Instagram:**
1. Download it with its Download buttons (under the flyer in the chat, or in the Website editor's Offer Slides): the Facebook or Instagram post (4:5 - the shape both feeds show biggest), the square post, or the Story (tall, for Stories).
2. Open Facebook or Instagram on your phone or computer and start a new post (on Instagram: the + button, then Post or Story).
3. Add the picture you downloaded - it is in your phone's photos or your computer's Downloads folder.
4. Write a line - the deal in plain words and your website's address - and post it.

**Stuck? Common questions - deals and flyers**
- *Do customers have to pick the deal?* No. A booking deal (time off, money off or something free) applies by itself to every booking that fits. Only a package is picked.
- *How does the front desk know about the free pitchers?* The staff pad shows "Free: 2 Pitchers" on that booking, check-in says it too, and they ring up at $0 on that booking's tab.
- *Can a member get the free pitchers?* Yes - it comes with every booking that fits, a member's too.
- *Can I have a money deal and a free-things deal on the same day?* Yes. A booking gets the best money deal that fits and the free things that fit - never two money deals.
- *The flyer is gone from my homepage.* A flyer stays in the slides until its deal, package or event ends, then leaves by itself. Make a new one for the next one.
- *My flyer has the wrong price.* Change the deal (Pricing > Booking Deals), then make the flyer again - its words come from the deal.
- *Where did my download go?* On a phone, into your photos (or Files > Downloads); on a computer, into your Downloads folder.
- *Where are my flyers later?* In the Website editor, Offer Slides: each flyer is a slide there with its three Download buttons, until its deal ends. A flyer made in the chat is also still in the chat.
- *I made a flyer, but the deal is not on the booking page.* A flyer is only a picture - set up the deal itself (Pricing > Booking Deals, or tell your assistant), then make its flyer so its words match.

## Members & Tiers

**Deactivate** on a tier stops it being offered (move its members to another tier first); it stays on the list, faded, and if you edit it later the save asks whether to bring it back. The full tour lives in the Members & Memberships chapter: tiers, PINs, free hours, guest passes, family memberships, selling online with automatic billing, the member portal, and members-only mode. The short version: tiers define the deal, members belong to tiers, and every tier chooses how its members pay - **Member golf settles**: online at booking, a deposit online with the balance at the door, or at the door with nothing charged online (the last two need someone at the counter). Free hours and blended tiers run on a free-time meter: whatever the member has left is used first, then the After Hours rate. The tier editor's plain-words box tells you exactly what you built; the Members tab is the command center - MRR, ARR, past-due, roster.

## The Counter - Your Staff Surface

If people work your counter, the staff page at /staff is their whole world: check-ins, walk-in tabs, food and drink orders, splits, payments, and End of Day. Setup lives in the Setting Up Your Counter chapter; the Staff Guide chapter teaches the floor. What matters to you as the owner: every action carries a name (personal codes, building-only sign-in, and a lock after two idle minutes - or the minutes you set as Staff pad auto-lock in Settings > Staff). Check-in does the money math for all four situations. Voids and comps require reasons and land on your Daily Review. Splits are honest to the penny. Cards confirm through Stripe itself. End of Day closes the drawer honestly - over or short recorded as-is.

## The Facility Manager Sign-In (multi-site owners)

Settings > Staff > "Facility Manager sign-in": set a manager password and your manager signs in at /admin with it - from anywhere. They get the Dashboard (live bay state, on/off/restart, today's schedule) and Bookings, including cancels with the system-computed refund. The server refuses them everywhere sensitive: connection keys, revenue, pricing, gift cards, members, hours, staff codes, waiver documents. Turn it off any time; that signs the manager out instantly. This is how one owner runs several sites: each unit gets a manager password for the local person, the owner keeps the owner password everywhere.

## The Dashboard - Bay Operations

Live state for every bay: plug on/off with real wattage (Gen2+ Shelly), PC online or off, and derived states like STARTING and SHUTTING DOWN. Per-bay On, Off and Restart PC buttons - Off and Restart PC warn you if someone is booked, so nobody kills a paying customer's bay by accident - and **Out of service**, which takes a bay out of booking with no end date and keeps its devices off until you press **Back in service**; plus all-bays sequences and a one-night close override per bay (**Override Close**). Bays without hardware show dashes and a pointer to Bays & Devices.

**Block Off a Bay** (on the Dashboard) takes one bay - or the whole facility - off sale for an event, a tournament or maintenance, with your own label: for a window of time, or **All day**, from opening on the first day you pick to closing on the last (a close after midnight included). A block cannot go over a customer's booking - Admin names the booking it would cover. Remove makes the time bookable again.

## How Bay Power Behaves

Bays turn on ahead of each session and off after it ends - and the off is graceful: the system asks the bay PC to shut down first, waits, then cuts the plug. Back-to-back bookings keep power on across short gaps (length is yours to set). Manual buttons run the exact same safe sequence. After a power outage the system catches up on anything it missed.

## Messages - Email, Text, and Templates

Email (via Resend) is the guaranteed path. Texting (Twilio) is strictly opt-in for customers - the consent language is fixed. Text messages (confirmation, reminder, door code, the 15-minute warnings, cancellation) go out in fixed wording - the wording a carrier registers - and each can be switched on or off. The main emails (confirmation, reminder, door code, cancellation and the membership emails) are editable in Messaging, each with Reset to Default, and defaults adapt automatically when your facility is Staffed; the session-ending email, the booking-changed email and the renewal reminders are sent as written. Per-type switches control which emails send; the Door Code toggle is ignored in Staffed mode - codes never send regardless. When staff move a booking to another day, time or bay, the customer is emailed the new details with a calendar update (the **Booking changed by staff** switch, on by default). Members-only clubs run on email entirely - the texting opt-in never appears.

## Your Website & App Icon

Admin > Website builds your website: hero, photos, events, promos, colors, staffed-hours calendar, your own pages. Preview at /landing, then flip it to your homepage with one click. The first card is the switch: if your facility has a website elsewhere, or does not want one, turn it off - visitors go straight to your booking page, the site menu disappears, and everything you built waits for the day you switch it back on. Most facilities leave it on.

**Navigation** is set once, on its own card: which pages show in the menu at the top of every page and in the footer, in the order you choose - Events, Memberships (only while a tier is sold online), Gift Cards, How It Works and any page you publish. On phones the menu folds into a menu button. **Search & Sharing** holds your site title, your site description and the picture a text message or social post shows with your link; your city, domain and Google review link are set once in Settings > Business & Content > Local Search & SEO, and a sitemap is published for you. **Social media** links go on the Contact card and appear as icons in the footer of every page.

**Photos.** Upload the best copy you have (about 1920x1080 for the hero). Your system makes phone-sized copies automatically, so the page appears right away on a phone - which is where most of your visitors are. Photos you uploaded before this feature can be sized with one button on the Photo Gallery card (the Website editor).

The How It Works page has its own editor, the How It Works Page card in Settings > Business & Content - every step is yours to rewrite. Every long text box has formatting buttons (bullets, numbered lists, headings, bold, italic, quotes), a Preview in your site's colours, and a "?" cheat sheet - nothing to memorize (chapter: Formatting Your Text). Upload your logo in Settings > Business & Content > Branding & Theme and your site becomes installable on phones with your logo as the app icon - customers use Add to Home Screen.

## Waivers

Upload a PDF, set it active, and customers must sign before booking. Collection modes: online during booking, at the door with staff, or automatic (door when staffed, online otherwise). Membership waivers can last one year (re-sign after) or the life of the membership, and each tier can carry its own document and its own term (including every visit). Turning waivers off, or setting them to offered, is honoured everywhere: the booking page, the staff check-in and the pad's "Waiver needed" badge all follow the mode. Any waiver that lasts a set time is asked for again as the period comes up: set "Ask for a fresh waiver this many days before it runs out" on the Waivers tab (30 by default, 0 = off) and inside that window the member gets one email (editable intro under Email Messages), the booking page asks them to sign the new one without blocking, the staff check-in shows "runs out on" with a tap to re-sign, the member portal says so, and the roster and Dashboard count who is coming due. Signed waivers can only be deleted after your records retention floor (10 years minimum). **A member's guests** decides whether friends a member brings are covered by the member's waiver or each sign the one-day waiver at check-in - staff can always collect a guest's own signature with a tap. Signed records preserve legal evidence - name, time, and a fingerprint of the exact document version signed - so bump the version whenever the text changes.

## Money - Revenue, Refunds, Cancellations

**Revenue is money actually taken, minus refunds** - sessions paid online, the counter's card, cash and check, gift cards sold, and membership payments, each counted on the day the money moved, less every refund on the day it went back. A checkout nobody finished is not revenue (the tab names it as money that did not come in), and a cancellation that kept part of the fee counts the part kept. The Revenue tab shows the totals, where the money came from, monthly and daily charts, revenue by bay, and membership MRR - plus the counter's End of Day reports. The same figures feed your yearly records and your year-end report, so they always agree.

**Every refund comes off, wherever it was made.** Money given back at the counter (any staff member, with a reason - see the Staff Guide) and refunds made by the system are recorded as they happen. **A refund you make yourself in the Stripe Dashboard** - of an online booking, a counter card payment, a gift card or a membership payment - is picked up by the unit on its own: when it starts, every night, and whenever you press **Check Stripe now** on the Revenue tab (the line under the revenue definition says when it last checked). It then comes off revenue on the day it was made. A gift card whose purchase you refund in full is switched off so it cannot be spent as well; after a partial refund the card keeps its value and the log says so, for you to decide. A refund Stripe later reports as failed stops counting.

**The daily review.** Your Dashboard's Daily Comps, Voids & Refunds Review lists every comp, void and refund staff made, with their reason and name - and any refund made in Stripe off a counter payment. Check each row; your name and the time are recorded.

Customers can self-cancel from /my-booking with identity verification - full refund outside your cancellation window, blocked inside it. A member's free hours, guest passes and member credit used by the booking come back however it is cancelled - by the member on /my-booking, by staff, or by you. You (or your manager) can always cancel from Admin with full, half, or no refund - the customer is emailed that it is cancelled (and texted, if they said yes to texts), and if the refund does not go through Admin says so at once: the customer has not been refunded, so refund them in Stripe yourself; staff can move a booking's time or bay; late cancels inside the window require an explicit override with a reason. Every refund, move, and override is logged with who did it. The payments doctrine underneath: a customer is never charged for a session that didn't happen, and a successful payment is never lost - paid-but-unconfirmed bookings are found and refunded automatically.

**A session that has already started is not for sale online.** Once a time slot's start has passed, the booking page no longer offers it, and the unit itself refuses it on every online path - a page left open past the start, a member's free hours, a free-code booking - with "That time has already started, so it can no longer be booked online." If a customer's payment still goes through after the start (they sat on the payment screen, say), the unit refunds it in full on its own, cancels the booking, tells the customer (by email, and by text if they opted in), and writes it in the Log tab (STARTED_SLOT_REFUNDED); it comes off revenue like any refund. If Stripe refuses that refund, you are told at once (see "Texts to You") and the Log tab says REFUND NEEDED - refund them in Stripe yourself. Your staff can still book a session that is already under way from the counter - the customer is standing there - and the pad tells them how many minutes have passed; the session still ends at its usual time.

**Refunds the unit makes on its own** are always the whole payment and always said: a payment that landed after its session started; a payment for a checkout whose booking could no longer go ahead (the slot was sold to someone else meanwhile, the session was already over, or the bay was down); and a payment that arrived after its checkout had already expired. A paid checkout whose slot is still free is simply restored as a booking. Each refund is in the Log tab, the customer is told, and it comes off revenue on the day it went back. A refund Stripe refuses is never left quiet: the Online checkout line under About > Health turns red and names who is owed money until it is settled.

**A checkout left unfinished.** While a customer is on the payment step their slot is held for them (10 minutes by default), and in Admin > Bookings the booking shows as pending with a **Clear** button. The unit frees an abandoned checkout by itself once the hold runs out; Clear frees it now. Clear first asks Stripe whether the customer paid after all: if they did, it refuses and tells you to confirm or cancel the booking instead (so nobody's money is kept for a slot they lost), and if Stripe cannot be reached it changes nothing. You or your Facility Manager can use it.

## Your Year-End Report

Settings > Protection > Records > **Year-end report**: pick the year (the current one comes as "so far") and press Download year-end report. You get one zip for you and whoever does your books:

- **report.pdf** - the whole year on paper;
- **workbook.xlsx** - the same sections as spreadsheet tabs, money as real numbers that add up;
- **csv/** - the same tabs as plain CSV files that any program opens;
- **README.txt** - what every file and column means, and what "revenue" means.

Inside: a summary (revenue by source, refunds, tax collected, tips, estimated card fees, take-home, what did not come in, sessions and hours played, occupancy, customers, members, guest visits, waivers signed), month by month, tax by quarter, every payment and refund on its own line with its booking and payment reference, refunds on their own, by bay and by weekday, memberships by tier and by month, gift cards (sold, given free, spent, and the balance still on cards at the year's end - your bookkeeper may treat that balance as money owed back to customers), the counter by payment method and by tax category, and discounts given.

**Customer names are left out unless you tick Include customer names** - every line still carries its booking and payment reference, so nothing is lost for the books, and a file that lives on after the unit does not carry names the ten-year removal would have taken away. With names included the file comes down encrypted with your backup passphrase (and needs one to be set).

**One thing the README tells your bookkeeper:** the counter's tax by category is worked out at the tax rates set on the day you make the report, because the counter keeps its sales rather than the rate it charged. In a year when you changed a rate, that category's tax figure is slightly off; the counter money itself is exact.

## Texts to You When Something Needs You

Most problems wait politely on the health line: the header's **About** button opens it, one line per part of the unit - green, amber or red, each with what to do. A few cannot wait, because a customer may be standing at a door or be owed money. For those the unit texts YOU:

Settings > Connections > the Twilio - SMS card > **Your own mobile, for urgent alerts**: your own mobile number (it is never shown to customers), then Save Settings. The same alert goes to your contact email (Settings > Business & Content > Contact Information). The unit texts when:

- a door lock through Home Assistant has not answered for five minutes;
- the lock did not take a booking's code, so the customer was sent the standing backup code as well;
- a code this system never issued was found in the lock's reserved booking slots, and removed;
- the door console presents a security certificate the unit does not trust (UniFi Access - the setup guide explains why and what to press);
- a member's door access could not be turned on, so they were sent a one-time code instead;
- a customer's refund did not go through - an online cancellation, or a payment that landed after the session had started - so you can refund them in Stripe;
- a bay's simulator PC did not come up after the unit woke it for a session.

One text per problem at most every six hours, so a fault that lasts does not text you every minute; each one is also in the Log tab and on the health line. Leave the unit empty for no texts. Texting needs Twilio connected; the email needs your email connected.

## Protecting the Admin

Change your admin password any time in Settings (eight characters minimum; effective the very next sign-in, never stored readable). Settings > Protection adds optional two-factor codes for sign-in and for the sensitive rooms (keys, texting, webhooks). Protection is also home to backups, the off-site backup link, your records and year-end report. The Operating guide covers backups, restore and upgrading. A restore replaces every setting, the owner password included, so only your own sign-in can restore - never the Facility Manager's.

## When Something Looks Wrong

**Booking page looks stale after a change:** hard-refresh (Ctrl+Shift+R) - the page caches aggressively.

**Member PIN rejected:** PINs are unique; check the member is Active and their tier is enabled.

**No door code arrived:** check Facility Access isn't Staffed, the Door Code switch on the Resend card is on (a customer who did not tick the text box gets the code only by email), and the booking has a valid email; codes are sent at your "Text the code to the customer" minutes (15 by default). The Door codes line under About > Health turns red the minute an upcoming session has no working code, and says why.

**The health line shows DOOR_JOBS_REPAIRED in the Log tab after an update:** normal, and only once - the update removed door removal tasks an earlier version left waiting after a cancel or move on the staff pad. Those codes were already off the door. Nothing to do.

**A customer says they could not book a time that had just started:** correct - a started session is not sold online. Book it for them from the staff pad, or they choose the next start.

**Can't find a setting:** type it in the header search bar - it jumps and highlights.

**A save shows an error:** failed saves show a red message and change nothing - fix the flagged field and save again. A save that says success took effect; reopen to confirm.

**Staff page asks for a code nobody has:** add employees in Settings > Staff; the page locks itself after two idle minutes (or your Staff pad auto-lock minutes) - any active code reopens it.

**App icon shows a letter:** re-upload your logo in Settings > Business & Content > Branding & Theme, then remove and re-add the home-screen shortcut.

**Texts not sending:** your Twilio campaign may still be in carrier review - email keeps working throughout. See the Twilio guide.

**Something we should fix:** tell us what the activity log shows (Admin > Log). Fixes arrive as a new release you install yourself (the Operating guide, "Upgrade to a newer release").


---

# CHAPTER: Setting Up Your Counter

# Setting Up Your Counter
*Staff, Menu, Taxes & Card Readers, Step by Step*

If people work your counter - pouring drinks, checking groups in, taking payment - this guide turns that on. It covers staff sign-in codes, building your menu, tax codes, and the card reader. When you finish, hand the Staff Guide to whoever works the floor; this one is the owner's side. (Fully unmanned facility? Skip this guide - and note your check-in mode defaults to Off, which is right for you.)

## Part 1 - Staff Codes

**STEP 1 - Give each person their own code**

Admin > Settings > Staff > Staff & Sign-In Codes: add each employee by name with their own sign-in code. Personal codes matter - every check-in, order, void, and drawer count is stamped with the name attached to the code, which is what makes End of Day trustworthy. The staff page at /staff lights up as soon as one active code exists, and codes only work inside the building. When someone leaves, untick **Active** (or Remove them) and Save: they are signed out of the pad and their phone at their next tap, and their shifts in a saved schedule pattern come back as open shifts when you apply it.

Then set your **check-in mode** in Settings > Business & Content > Facility Policies: Full (headcount and settlement at the counter - the staffed default), Arrival only, or Off. And if a manager runs this site for you, the "Facility Manager sign-in" on the Staff & Sign-In Codes card gives them a limited admin login - see the Owner's Guide.

## Part 2 - Build the Menu

**STEP 2 - Create categories**

Admin > Settings > Food & Payments, Menu & Kitchen Routing: make a category per station or menu section (Beer, Kitchen, Snacks). Each category sets a default printer station and a default tax code - items inherit both unless you override per item.

**STEP 3 - Add items and choices**

Add each item with its price. Choices handles sizes and add-ons (O-rings +$2.00, Tall pour +$1.50) - staff see them as tap-through options. Uncheck Active to hide something seasonally without deleting it. Staff can 86 an item from the floor in one tap; you see that here.

**STEP 4 - Specials that change the price**

Tell your assistant the special the way you would tell a server: "Taco Tuesday - tacos are $3 from 5 to 9", "$2 off every beer on weekdays from 3 to 6", "half off every drink Friday nights from 9 until 1", "wing night on the 29th - wings are $8". It shows you the special to approve. While a special is on:
- every server's pad shows the special price on the item and rings it up at that price, with the special's name on the line and the receipt - tax is worked from the special price;
- a member gets the better of the special and their own membership perk, never both;
- your website's weekly specials show it at the same time (if your site has no weekly specials block yet, ask "show our specials on the website").

A special can cover items by name, a whole part of your menu (every Beer), every drink, all food, or the whole menu; it can be a set price, an amount off or a percent off; and it can run every week on its days or on one date only. Its hours are your facility's own clock, and one that runs past midnight still belongs to the night it started. Ask "what specials do we have?", "make Taco Tuesday $2.50", or "end the Taco Tuesday special" - the pad goes back to the menu's prices for it.

**Or by hand: Admin > Settings > Food & Payments > Specials & Deals.** Every special is listed with its deal, what it covers, when it runs, whether it is on now and whether your website shows it - with Edit, Turn off / Turn on and Delete. **+ Add a special** opens the form: its name; what it covers (items you tick, whole parts of the menu, every drink, all food or the whole menu); the deal (a price each, dollars off or percent off); every week on the days you tick (none ticked is every day) or one day only; the hours (both empty is all day); its line on your website. Before you save, the card shows what it does to the money - each item's price now and with the special ("Tacos $4.00 → $3.00") - and that the tax is worked from the special price. Say "take me to specials" and the card opens beside the chat.

## Part 3 - Tax Codes

**STEP 4 - Set your rates**

The Tax Codes card holds your categories - simulator time, prepared food, beverage - each with its rate. Confirm every rate with your accountant; the system collects and reports tax on receipts and the End of Day Z report exactly as entered here, but it does not file or remit. The golf line on every tab is taxed under the simulator-time code automatically.

## Part 4 - Printers and the Drawer

BA Core Community is software for your own Pi; you buy the counter equipment, and only Star CloudPRNT printers and printer-driven drawers work with this system (the AI manual's section 7b is the complete buying list with the models that do NOT work). The short version: **Star mC-Print3** for the counter and for the kitchen, a **Star CD5-1617 DK** drawer plugged into the counter printer, and a **Stripe Reader S700** (a WisePOS E you already own works too).

**STEP 5 - Add each printer**

Plug the printer into power and your facility network. Admin > Settings > Devices > Kitchen & Counter Printers: type a name, pick its role - counter (receipts, guest checks, the drawer), kitchen (food tickets) or bar (drink tickets) - and click Add. A poll URL appears, starting with your booking device's local address. Print the printer's self-test page (hold the feed button while powering on) to find its IP, open that IP in a browser, find CloudPRNT, switch it on, paste the poll URL, save. Back in Admin click Test Print: a slip prints within a few seconds. Then reserve the printer's IP in your router, exactly as for the smart plugs.

**STEP 6 - Connect the cash drawer (optional)**

Plug the drawer's RJ12 cable into the counter printer's DK port. Admin > Settings > Devices > Kitchen & Counter Printers > Cash drawer: On. From now on every cash sale pops it and the opening is logged with the employee's name. Cash works fine with this Off - the staff screen simply says "no drawer needed" and records the sale.

## Part 5 - Payments at the Counter

**STEP 7 - Turn on how you take money**

Admin > Settings > Staff > The Counter: Cash at the counter and Checks at the counter are both On out of the wizard for a staffed or hybrid facility - turn either Off and it disappears from the staff screen. Card requires the reader below. (Food & Drink on the counter and the no-show grace live on the same card.)

**STEP 8 - Pair the card reader**

Buy a Stripe smart reader (S700/S710 or T600; a WisePOS E you already own works too, but Stripe no longer sells it - never the M2, WisePad 3 or Tap to Pay, which need a phone app). Fill in your facility's address first - the Street Address under Settings > Business & Content > Contact Information, and the city, state and ZIP under Local Search & SEO: Stripe registers every reader to a Location, and the unit makes yours from that address. Then in Admin > Settings > Food & Payments > Card Readers, add the reader with the three-word pairing code from its own screen (swipe right from the left edge, Settings, passcode 07139, Generate pairing code). Payments confirm through Stripe itself - a reader that loses power mid-sale never leaves anything wrongly marked paid. Full Stripe account setup lives in the Stripe guide; the reader section assumes that account exists.

**STEP 9 - Money back at the counter (nothing to set up)**

Any staff member can give money back off a card, cash or check payment on a tab - the Refund button on the payment line - with a reason, just like a void. The person taking the money is the one standing there when it goes back, and a refund recorded with a name and a reason is far better than cash handed out of the drawer with no record. Card goes back to the customer's card through Stripe; cash comes out of the drawer (End of Day expects that much less, and the drawer opens if one is wired); a check is recorded. Every refund lands on your daily review. The Staff Guide shows your team how.

## Part 6 - Prove It

- [ ] A staff code signs in at /staff and the Today screen loads
- [ ] A test item ordered on a walk-in tab shows the right price and tax
- [ ] Send the item - the kitchen (or bar) ticket prints within a few seconds
- [ ] Cash collect shows correct change, the drawer pops (if connected), and it lands in End of Day expected cash
- [ ] A card tap on the reader marks the check paid only after Stripe confirms, and the counter printer prints the receipt
- [ ] End of Day shows the test sales by category and the drawer math balances
When those six pass, your counter runs itself on the same honest math as the booking page - and the Staff Guide teaches the floor everything else.


---

# CHAPTER: Staff Guide

# Staff Guide
*Working the Counter, Step by Step*

This guide is for the person behind the counter. Everything happens on one page, opened on the counter computer or a tablet connected to the facility Wi-Fi: the booking device's own address - ba-core.local:3001/staff, or the device's IP address followed by :3001/staff. The website's address (yourdomain.com/staff) does not open the staff pad, even inside the building. Your owner gives you a personal sign-in code; every action you take is stamped with your name, so the day always adds up honestly.

## Signing In and Out

Open the staff page and enter your code. The screen locks itself after two idle minutes (unless your owner set a different time) - tap Lock any time to lock it sooner. Sign-in only works on the facility's own network, at the device's own address, never over the internet.

## The Today Screen

This is home base. Groups shows every booking today with its status. Tables and bar shows every open tab and what each owes - it updates by itself the moment anything changes. Bay operations shows each bay: what is running, until when, and whether it was switched by schedule or by hand. Three buttons on top: Walk-in tab, New booking, and End of day.

## Checking a Group In

Tap the group, count heads, tap Check In. The numbers on the screen come straight from the system, live, as you add heads, member codes, and guest passes - what you see is exactly what lands on the tabs. There are only a few situations, and the screen names the one in front of you:

**Paid online** - they already paid when they booked. Collect nothing; the screen says so. Their seats and tabs are still created, so food, drinks, and extra time work the same as for anyone. **Member deposit** - a member put money down; their seat gets their member price (or their share minus the tier's door discount), the deposit is credited, and any leftover lands on their tab as credit. **Booking deposit** - the group paid a deposit online; the screen shows the remainder to collect. **Member - pay at the door** - the member reserved for $0 online (their tier settles at the door); the list shows "Member - $X at door", and at check-in their seat is priced by their membership automatically - no code to retype. **Pay here** - nothing collected yet; the screen totals it for the number actually playing.

A member code typed on ANY seat prices that seat by that person's own membership - percent off, dollars off, their flat rate for their own time, their free hours, or their blended meter - and the system knows what free time they have left. Friends with no code pay the regular share. Guest waivers: a member's friends show as covered by the member's waiver or as "Needed - tap to sign", depending on the facility's policy; you can always tap a seat to collect that person's own signature.

If someone arrives before their tee time, their row shows an Early check-in button - it opens their seats and tabs. It does not switch the bay on: press that bay's **On** under Bay operations. Whether staff may switch an empty bay on early is your owner's Early bay access setting; if it is off, the bay comes on by itself shortly before the booked time. Never guess at share math for a group: check them in and read the screen; it splits by heads and applies member discounts automatically.

(Some facilities run check-in in arrival-only mode, or off entirely - if your screen shows fewer buttons than this guide, that's your owner's setting, not a problem.)

## Walk-Ins

Somebody at the bar with no booking? Walk-in tab, give it a name ("Bar 2", "Drew"), done. It lives in Tables and bar with everything else until it is paid or merged.

## New Booking - Including a Session Already Under Way

A group walks in wanting a bay, or someone rings to book: tap **New booking**, pick Today or a date, the bay, the start and the length, enter a name and phone, and the screen shows the price, the split and what is due at the door. On Today the first start is **Now** - the half hour already under way (at 10:17 it is 10:00), because sessions start on the hour and the half hour.

If that session has already started, the screen says so plainly under the times: **"Slot is free. This session started 17 minutes ago - it still ends at its usual time."** Booking it is allowed at the counter - the customer is standing in front of you - but the minutes already gone are not added back: tell them it ends at the usual time, or pick the next start instead. **Create & check in now** makes the booking and drops straight into check-in; the message repeats how many minutes had passed. (Online, a session that has started can no longer be booked at all - customers who try are told to pick a later start, so send them to you.)

"Conflicts with (a name) (times)" means the bay is taken for that time - pick another start or length. A slot a customer is paying for online right now counts as taken while they finish (about ten minutes). If it names somebody who is not on Today and never turns up, it may be a checkout left unfinished: it frees itself when that hold runs out, or your owner or manager can press **Clear** on it in Admin > Bookings to free it at once - Clear checks with Stripe first and refuses if the customer's payment actually went through.

## Taking an Order

Open a tab, Add menu item, tap items. Choices (sizes, add-ons) pop up when an item has them; add a note if the kitchen needs one. Pick which seat or tab it belongs to, then Send. Items route to the right printer station automatically.

Order the same beer five times over a night and the tab shows one tidy line - "Bud Light, 5 sent tonight - tap to see each." Tap it to open the individual pours with their times; each one can still be voided or moved on its own.

## Fixing Mistakes

Tap any sent item. Void takes it off entirely (rung wrong, kitchen fell behind); Comp to $0 keeps it on the tab at zero (on the house). Both require a short reason - it lands on the owner's daily review list, which is normal and expected. Move to another tab sends the item where it belongs if it was rung on the wrong one. Money already taken is not voided - it is given back (next: Giving Money Back).

## Splitting - Two Different Worlds

**A booked group splits with PEOPLE.** On a group member's tab, tap the item and choose Split with the group. You land straight on the names. Tap one person - it moves to them. Tap several - it splits evenly across them, to the penny, each share taxed on its own tab, member discounts honored. Or use the tab's Split button to work through several items in one screen.

**A walk-in tab splits into CHECKS.** Four strangers at the bar? The tab's Split button opens checks. Even split spreads everything evenly - the checks always add to the tab exactly, to the penny. Or tap items to move them onto whichever check is paying for them. Each check has its own Collect button.

## Collecting Money

Cash - enter what they handed you; the screen shows change. Check - record the number. Card - send it to the reader; the customer taps, and the screen marks it paid only when the card company confirms - that moment, not before. A paid check locks; when the last check hits zero, the tab closes itself. Tips from the reader (when your owner has the reader's tip prompt on) are captured automatically.

## Giving Money Back

Charged someone twice, charged for a drink that never came, or the customer is owed some money back? Any staff member can refund - you are the one standing there, so you do it, with a reason.

1. Open the tab. Still open: tap it on Today or in Bar view. Settled today: **Open Tabs** (or Bar view) **> Paid today**, then the tab. (A card payment from an earlier day is refunded by the owner in the Stripe Dashboard - the unit picks it up on its own.)
2. Under the totals, each payment has its own line - card, cash or check, the time and who took it. Tap **Refund** on the one the money came in on.
3. The amount to give back is filled in with what is left on that payment - change it for a partial refund. Type the **reason** (required - "charged twice", "drink never came").
4. Press **Give it back**.

- **Card:** it goes back to the customer's card through Stripe - no second tap, the customer does not need to be there. If Stripe refuses, the screen says why in Stripe's words and nothing counts as given back.
- **Cash:** hand it back from the drawer (it opens if one is wired). End of Day expects that much less cash.
- **Check:** recorded as given back - hand back their check, or pay it back another way.

The payment itself never changes; the refund appears under it as "Given back" with your reason and name, and the tab shows how much is still refundable. A refund comes off the sale first, then the tip. It lands on the owner's daily review like a void - normal and expected. Member credit and gift-card payments have no Refund button: they are stored value, not money.

## Bar View

The Bar view button (and Open Tabs at the bottom of the screen) shows just the money: every open tab on one side, everything paid today on the other. Groups whose session ended but still owe wear an amber chip - those are the ones to chase before they walk.

## Merging and Extending

Two tabs that should be one (a walk-in who turns out to be with a group): open a tab, Merge, pick the other - items and payments combine.

A group wants more time: on the group screen tap **Extend 30 min** or **Extend 60 min**. The bay's calendar is checked first - if the next group is too close, the screen says so and nothing changes. Then tap everyone who is paying for the extra time: one person covers it, two split it 50/50, three split it three ways; **No charge** is there for prepaid and deposit groups. Time is added in 30-minute steps up to two hours at a time, never past closing. Membership follows the person on the added time too: a blended or free-hours member's slice runs through their meter (free time left first, then their rate), other member codes carry their discount, and guests' heads pay the regular price - the extra time lands as normal lines you can still move or re-share. The session timer, ending text, and bay shutdown all follow the new end time on their own.

## End of Day

Tap End of day, count the drawer, enter what you counted. The screen shows sales and tax by category, payments by method, anything given back by method, tips, and what cash should be in the drawer (cash refunds already taken off). Enter your count - over or short is recorded honestly, never hidden. Voids, comps and refunds from the day are listed for the owner to review. Two minutes, and the day is closed clean.

## House Rules

Your code is yours - actions carry your name. Never guess at group math - check in and read the screen. Voids, comps and refunds always get a real reason - and money going back always goes through Refund, never straight out of the drawer. The card screen says paid when the bank says paid - trust it. Locked screen? Your code opens it. Two idle minutes (or your owner's setting) locks it again.

# CHAPTER: Employees - Schedules & the Time Clock
*Seasons, Shifts, the Pad Clock, the Phone Page & the Hours Export*

This is an hours-and-schedule tool. It builds your staff schedule, records clock-in and clock-out, lets employees see their shifts from home and ask for changes, and exports the hours to your payroll or accounting system. It is not payroll, not benefits administration, and not a compliance system: it never calculates pay, never flags overtime, never states what any law requires. Your break thresholds are your own policy, shown to staff as plain arithmetic.

It is a choice for facilities with a counter - on out of the wizard for staffed and hybrid facilities, off for unmanned - and you can switch it any time in Admin > Settings > Staff > The Counter.

## Part 1 - Your people

**STEP 1 - The roster is the staff list you already have**

Admin > Settings > Staff > Staff & Sign-In Codes: each employee has a name, a personal 4-6 digit sign-in code, and now an optional employee number (it appears on the hours export so your payroll or accounting system can match people). The same code works on the counter pad and on the phone page.

## Part 2 - Seasons: the hours you want staffed

**STEP 2 - Make a season**

Admin > Settings > Schedule > + New season. Name it (Winter, Summer, League nights), tick the days someone should be at the counter and give each day a window - blank both times for all day, 23:59 for midnight. "Set every day like Monday" copies one row down. Add the season's standard shift blocks (Open 4-8pm, Close 7:30pm-midnight - overlapping is fine). Tick which days each block is expected on - a Weekend open block ticked Sat and Sun is only graded on those days; no ticks means every staffed day. Save. The first season you save becomes the one in use; switch seasons any time with "Use this season".

> IMPORTANT: hours marked "want staffed" count as staffed everywhere - the booking page's staffed line and deposit boxes, member door settlement, the website's staffed list - even before anyone is assigned to them. That is on purpose: the slot stays bookable and you schedule people onto it. When a season is in use it is the ONLY source; the Website > Staffed Days calendar is ignored (its card says so) until you choose "No season - the Website's Staffed Days calendar" in the Season list and press Use this season.

**STEP 3 - Days that differ**

On the week grid, click a day's WANT STAFFED cell: post an open shift, mark that date NOT staffed (a holiday), or force it staffed with custom times (a private event). Restore the season's hours the same way.

**The master switch.** Settings > Schedule > Staffed hours: OFF everywhere means nothing is staffed for the whole facility - no deposits, no door settlement, nothing on the website - while the schedule keeps being built underneath. Turn it back On when you are ready. The Dashboard checklist tells you when it is off.

## Part 3 - The schedule

**STEP 4 - Put people on shifts**

The week grid shows a WANT STAFFED row, an OPEN SHIFTS row, and one row per active employee. Click a person's + on a day: the menu offers that day's open shifts first (one tap assigns), then the season's shift blocks, the full staffed hours, or custom times. Each day's WANT STAFFED cell lists that day's blocks and who covers them - NOBODY in red, a partly covered block in amber with the uncovered range - and the week header counts uncovered blocks; the Staff today card on the Dashboard warns when any fall inside the next 7 days. Click any shift to change its times, hand it to someone else, make it open, or remove it. Approved time off tints the cell.

**STEP 5 - Work faster**

Copy to next week copies the whole week one week ahead and stays on the week you are looking at - the message names the week it filled; press the arrow to see it. Save as pattern keeps the week shown, every shift and who has it, under a name; pick it under Saved patterns and Apply to this week lays it onto the week shown (a second tap adds nothing - a shift already there is never doubled), Delete forgets a pattern. If someone has since left the roster, their shifts come back as OPEN shifts, never silently assigned.

## Part 4 - The time clock (counter pad)

Every list that can grow - the time clock, bookings, members, signed waivers, the log, discount codes, gift cards, blocks, the roster - shows ten at a time with a search box and a pager, so nothing runs off the bottom of a phone. Staff sign in on the pad as usual; a Time clock card sits at the top of Today with a big Clock in / Clock out button, hours today and this period, and a break button. Forgot to clock out yesterday? The card says so and asks for the time they actually left - the entry is fixed and FLAGGED for you. Every entry carries who recorded it and who edited it.

You review flagged entries and fix anything from Settings > Schedule > Time Clock (edit times, mark reviewed, clock someone out now, delete) or straight from the Staff today card on the Dashboard.

## Part 5 - The phone page: /me

Employees open yourdomain.com/me on their phone (it installs to the home screen as "My Shifts"). Their code shows their hours, their shifts for the next four weeks, and the open shifts. They can ask for an open shift, ask to drop one of theirs, and ask for time off - every ask lands as a request you decide on the Dashboard. Nothing they do changes the schedule directly, and a phone sign-in can never run the counter, the clock or a bay.

## Part 6 - Hours & Export

Admin > Settings > Staff > Hours & Export: choose your hours period (weekly, every two weeks from a Monday you name, twice a month on the two days you name - the 1st-15th and 16th-end unless you change them - or monthly) and enter your break policy - rest break every N hours, meal break after N hours, whether the meal break is paid. Then This period / Last period fills the range and Export hours downloads a CSV:

    Employee Name, Employee Number, Period Start, Period End, Hours Worked, Break Minutes

with a footer line inside the file: "Recorded hours from clock-in/out. Not a payroll calculation. Verify before use." Those six columns are what the common bookkeeping services expect; there is no overtime column and no period number, and there never will be. Hand the file to your bookkeeper or accountant.

**Sending it on a schedule.** Under Hours & Export there is a second card, **Send the hours export**. Name the person who should get the file (your bookkeeper, your accountant, a shared mailbox - one address or up to five), tick the unit that says you understand it goes as a plain CSV attachment in ordinary email, and turn it On. It uses the hours period you already set above; it never asks again. Choose when it goes after a period closes - the next morning at 6:00 is the default - and choose one of two ways: **Send it automatically**, or **Hold it for my sign-off**. Held means you get an email at that moment with the hours summary and a review link; the file goes to your recipient only when you press Approve and send on the card (Download to check first and Skip this period sit beside it). You are copied on every send. The card shows when it last went and when it goes next. **Send now** sends the last closed period this minute; **Resend last** sends the same file again to the same addresses. Turning it on starts with the period that closes next - use Send now for the one that already closed. If the unit is off at the moment a send is due, it goes as soon as the unit is back on, never twice. Every send, approval and skip is written to the Log. The file is the same one the Export hours button makes, footer and all. Email must be connected (Settings > Connections > Resend - Email Notifications) for any of this to leave the unit.

## Part 7 - Prove It

- [ ] A season saved; the booking page shows the staffed line on a staffed day and a gold dot on the slots inside the window
- [ ] A shift assigned from the + menu; an open shift posted from the WANT STAFFED cell
- [ ] Staff clocks in and out on the pad; the Time Clock table shows the entry
- [ ] An employee signs in at /me from a phone, asks for the open shift; the Dashboard shows the request; Approve assigns it
- [ ] Export hours downloads the CSV with the six columns and the footer
- [ ] Send the hours export: a recipient named, the plain-CSV box ticked, On; Send now reaches that inbox with you copied, and the Log shows HOURS_SENT

---

# CHAPTER: Building Your Website

Your booking system includes a website builder at Admin > Website. Ninety-nine facilities in a hundred build their site here; the first card is a switch for the one that already has a website somewhere else. Everything you build is yours, lives on your unit, and is backed up with everything else.

> IMPORTANT: Nothing goes live until you click a card's Save. The preview on the right redraws as you type so you can see every change first - a gold "unsaved changes" badge on a card means the site does not have it yet.

## How the builder is laid out

The editor is two columns on a computer: your cards on the left, a live preview of your site on the right (Phone or Desktop view, your choice). On a tablet or phone the preview tucks away behind a Show Preview button at the top. The strip of links under the title jumps to any card.

1. **Your Website** - the switch. On for almost everyone.
2. **Colors & Fonts** - eight ready-made palettes, or Custom to pick all thirteen colours yourself. Your choice paints the whole website, the booking page, memberships and gift cards - and the preview shows it at once. A heads-up appears if two of your colours would be hard to read together; you decide. The same card sets your fonts and the admin console's own look. **Fonts:** tap a **font set** for a whole pairing at once - Original (as built), Clean (one font everywhere), Sporty, Elegant, Strong, Sleek, Warm, Clubhouse, Signature - or pick each face yourself from 48 fonts: one for the headings, one for the words people read and the buttons, one for the small line above a heading. Tick **one font everywhere** to make them all match, or **plain small lines** to drop the wide-spaced capitals. Script faces (Dancing Script, Great Vibes, Pacifico) are for headings and the small lines only - they cannot be the words people read, because paragraphs in them are hard to read. Under the fonts, **Style** shapes the site: tap a look (Classic, Modern, Bold, Minimal, Friendly) to set everything at once, then change any one place - button shape, the button words in capitals, card and photo corners, card shadows, the space between sections, the page width, the size of the text people read (larger is easier for everyone), the weight of the words and the space between their lines (more space is easier to read), heading size, capitals, weight (regular to extra bold), italics and letter spacing, the top of the page (words on the left or centred, its height, the shade over the photo), a solid top bar, **the menu** (links in the top bar as built, **tabs** under the top bar on every screen with the page you are on marked, or **a menu button only**), **a bar at the bottom of phones** (Home, your menu's first links and Book, always in reach), the Book Now bar while scrolling, and whether sections fade in. The colour of any words - headings, text, links, buttons - is in the colours above. The first choice of each is the site as built; the preview shows each pick at once.
3. **Hero** - the first screen: a small tag line, the headline (work your city and "golf simulator" into it - search engines weigh it heavily), a subline, the big button's words and where it goes, up to three photos that fade into each other, or a short background video.
4. **Page Layout** - your page, block by block, in the order visitors scroll. See below.
5. **Offer Slides, Steps, Staffed Days, Gallery, Events, Memberships, Promo, Contact & Social** - the words and photos of the built-in blocks. Whether each one shows, and where it sits, is decided on Page Layout - one place. On the Events card each event has **Edit** (change its title, date, words, flyer or link in place) and **Delete**.
6. **Pages** - your own standalone pages (Terms, house rules, league information) at /p/your-name, draft until you publish.
7. **Navigation** - what appears in the menu at the top of every page and in the footer, in your order. Memberships appears only while a tier is sold online. On phones the menu folds into a menu button.
8. **Search & Sharing** - the site title, your site description, and the picture a text or social post shows with your link - site-wide, and per page (the home page, booking, events, memberships, gift cards, how it works, the holding page). Your city, domain and Google review link are set once in Settings > Business & Content > Local Search & SEO; a sitemap is published for you.
9. **Site-wide** - visitor counting (Google Analytics or a Meta pixel, off until you paste an id). The notice bar is the notice from Settings > Booking > Booking Page Notice, shown on the booking page and every website page.
10. **Inbox** - what visitors send you through an Inquiry form block.
11. **Homepage** - when the site is ready, make it your homepage with one click. Booking moves to /book and every printed QR code keeps working.
12. **Email Updates** - a signup that lands on your device, with a CSV download (its own chapter).
13. **What's Public** - one switch per part of your site, and the words of your holding page (its own chapter).

## Build it by talking (the assistant)

On a unit with the assistant, open it from the **Assistant** button at the top of Admin. The screen beside the chat follows what you ask, so you never open one yourself: a website change shows your site with the part that changed scrolled into view; a price shows Pricing at its card; a bay shows Bays & Devices; a member shows Members; "who's on tonight?" opens the schedule; a page of your own opens that page. Each one reloads the moment the change is saved, so you watch it land. Tell it what you want - "put our weekly specials right after the top of the page", "make the buttons pill-shaped", "orange buttons with white text", "sporty fonts with bigger headings", "italic headings with wide letters", "one font everywhere", "add our Instagram", "move the FAQ above the gallery" - add photos with the picture button, or tap **Point at a part** and click a part of your site to talk about just that part. Every website change has an **Undo** on its line, and anything that hides your site, changes your homepage or takes a section, page or event away is shown to you to approve first. **Computer** and **Phone** switch how you look at your site. Ask "is my site ready?" for a check of what is missing.

Shape the whole site the same way: "give the menu its own page" makes a Menu page with your menu on it and puts it in your top menu; "put the FAQ on the About page", "bring the menu back to the homepage", "put everything on one page" (every page's blocks come onto the homepage and each menu link jumps down to its part - asked first, and the pages are kept), "show the menu as tabs", "open the first question", "tabs at the top", "just a menu button", "a bar at the bottom for phones". It recommends one page for a small site and a page of its own once a part has a lot to say, and offers the other.

Start with who you are: "we're an indoor golf lounge with six bays, food and drink, open late" writes the top of your page from it - the headline, the line under it and the small line above it - and you change any of it by saying so ("change the headline to ..."). Until you add a photo, the top of your page wears your header colour; the Website editor's own preview still shows where each photo goes. "Undo that" takes back your newest website change; when it cannot tell which one you mean, it asks with the parts to tap.

Your food and drink menu is ONE menu, built by talking: "add a new beer for $5 called Ale IPA" puts it on the counter's menu your servers ring up; "add burgers: classic $12, bacon $14" adds several at once. A new part of the menu (Wine, Pizza) asks which of your taxes it uses - it never guesses - and its tickets print at the bar for drinks or in the kitchen for food unless you say otherwise. "We're out of the IPA tonight" marks it sold out on every pad and off your website until you say "the IPA is back"; "make the IPA $6" changes its price (a round already sent keeps its price). Say "show our menu on the website" once and your website's menu shows it all live. The screen beside the chat shows your website's menu, with a **Server view** button for exactly how your servers see it on the staff pad.

Specials go wherever you want them (who gets one: whoever buys at the counter while it is on - staff ring it up and the special price is charged; nothing to do online): "run a special on drinks tonight: $1 off all rail drinks and taps" asks where it should show tonight and recommends the top of your homepage (the first thing people see - your photo is back tomorrow by itself); tap that, or the slides under the top, the booking page, or the specials section. "Try it in the slides instead" moves it, "put it on the booking page too" adds it there, and "email it out" drafts an email to the people who signed up for your email updates, for you to approve. "Make a flyer for it" designs a card for the special in your own fonts, colours, name and logo, with its photo (or the top of your homepage's) - it goes first in the slides under the top on its day, shows in the chat, and "email it out" then puts it at the top of the email. Try another look: "bolder" (the deal big on your button colour), "use the photo" (the photo edge to edge), "the clean one" (light and quiet), "back to the poster". The Page Layout card shows a special's flyer on its row, with **Remove the flyer**.

The assistant runs the rest of the facility the same way: "check in the 6 PM group, 5 golfers" (it says what to collect at the door), "any comps or voids today?" then "sign them off", "delete Carl's clock entry from today", "put Carl back on the clock", "approve the hours export", "turn bay 2 on", "shut everything down", "bay 3 is broken - take it out of service", "who's booked today?", "cancel the 6 PM" (it asks which refund - full, half or none - and never guesses), "close Bay 2 Thursday morning for maintenance", "happy hour weekdays 2 to 5 is $15", "make a 20% code", "add Dana as a Gold member" (her PIN shows to you only, never to the assistant), "give Sam's Wednesday to Alex", "stop texting door codes", "change the reminder text". Anything about money, customers, hours, staff or turning something off is shown to you to approve first. When something does not answer - a plug unplugged, a PC off the network - it names it and calls the change partly done, never just done; ask "how are the bays" to check each one. Ask it about your customers: what it reads goes to the AI company you connected, so it sees a customer as a first name and last initial - never a phone number or an email (those stay on the Admin screens). It never sees a door code, a member PIN, a gift card code or a staff sign-in code. A long answer can take a moment: the chat says it is still working and the answer arrives on its own, even on your phone away from the building; a message you type meanwhile stays in the unit until it is done.

Ask how the business is doing and it answers with your own numbers: "who's playing?" (each bay in use, who is on it and until when, and who is next); "how many bookings tomorrow?" and "longest booking tomorrow?"; "are we up from last week?" (this week so far against the same days last week: bookings, hours, how full the bays were, customers new and coming back, money taken, memberships joined, your best sellers at the counter - "this month" is put against the same days last month). "Profit this month" gives what was kept after card fees: the unit knows the money that came in, not your rent, staff or stock, so you take those from it. "How much tax did we collect this quarter?" gives the tax on bookings and memberships paid online and the counter's tax; "export the tax for last quarter" gives you a spreadsheet to download right in the chat (Excel, Numbers and Google Sheets open it) - the totals, each month and the counter by tax code, for your accountant. "Set the food tax to 7.5%" changes a rate when you say so, asked first. The assistant never looks tax rates up or changes one on its own: the rate you charge is yours to know (your accountant has it), and Stripe Tax can work your tax out from your address, for online bookings and the counter ("Let Stripe compute tax" on Settings -> Food & Payments -> Point of Sale — Tax Codes).

Payments, email and texting by talking: paste your Stripe, Resend or Twilio key into the chat and the page saves it (the assistant never sees the key). Then "is Stripe connected?" (Stripe, Stripe Tax, your card readers, email and texting - each connected, or what is missing), "send me a test email", "send me a test text", "add a card reader: apple-grape-orange" (the three words on the reader's screen; asked first), "what card readers do we have?", "tips go to the server" (or pooled, or off), and "check Stripe for refunds" (refunds made in Stripe's own dashboard come off revenue on the day the money went back).

## Page Layout - blocks

**Page** at the top of the card picks which page you are arranging: **The homepage**, or any page of your own (from the Pages card). A page holds the same blocks as the homepage and looks the same - a menu, specials, an FAQ, cards, a form - with the page's own title at the top; the built-in blocks (slides, gallery, find us...) stay on the homepage. A text page becomes a page of blocks when you add one: its words become its first block, nothing lost. Every block you add yourself has a **Page** choice to move it - to the homepage, to another of your pages, or to **a new page of its own** (it is made and put in your top menu). The preview follows the page you pick.

Every block has a **Show** tick, **up and down** arrows and, for the blocks you add yourself, **duplicate** and **delete**. Tick Show off to hide a block without losing its words. Click a block to edit it right there. **+ Add a block** offers:

- **Photo + text** - a photo beside a headline and paragraphs, with an optional highlight box and link. Use it for your simulators, food and drink, parties, leagues.
- **Text only** - a headline and formatted text.
- **FAQ** - questions and answers; visitors tap a question to open it. **Answers** sets whether they all start closed, the first one open, or all open.
- **Rates** - your booking rates, live from Admin > Pricing, with a note under the table. Never typed twice.
- **Testimonials** - short quotes with a name.
- **Video** - a short clip; your unit compresses it into a muted loop with a poster frame.
- **Call-to-action** - a bold band with one button.
- **Inquiry form** - parties, leagues, lessons. Tick the fields to ask for. Messages land in your Inbox and are emailed to your facility address; bots are trapped quietly; ten messages a minute per visitor at most.
- **Social row** - your profiles as big buttons, using the links from Contact & Social.
- **Email updates signup** - an email box that lands on your unit (the Email Updates card); it shows nothing while Email Updates is off.
- **Weekly specials** - your specials by day of the week (the specials you set by talking that change the counter's price show here too, live): each one's name, its days (every day, weekdays, weekends, or the days you pick), a line, a price, when it runs and a photo. Show them all with today's marked, or only today's - on a day with none to show, the block draws nothing. A special can be for **one day only** (its date - it shows until then and is gone after it), and each special can **also show on its day** at the top of the homepage (in place of the photo, which comes back the next day), first in the slides under the top, or on the booking page - the boxes under each special.
- **Food & drink menu** - what you serve, with prices, and a note under it. **Show: your counter's menu, live** (the usual choice) shows the menu your servers ring up - its parts (Food, Beer, Wine, Burgers...) as the sub-menus, its prices, sold-out items left off by themselves - so there is one menu, never typed twice; untick a part to keep it off the website. **Show the parts** lists them one after another (a jump row when there are many) or **as tabs** - one part at a time, a tab for each, good for a long menu. **Items typed here** shows a list you type on this card instead.
- **Cards** - a row of cards, each with a photo, a title, a few words, a price and a link: your coaches, lessons, packages, the simulators.
- **Photo band** - a full-width photo with a headline, a line and one button over it: league night, parties, the bays.

Every block you add yourself also has a **Background** (as that kind looks, the page colour, a shaded band, or a dark band like the header) and, for most, its words **On the left or Centred**.

A page holds up to twenty-four blocks. The hero always leads and the footer always closes.

## Photos

Upload the best copy you have - about 1920x1080 for the hero, 1600 wide for everything else. Your unit makes phone-sized versions automatically (most of your visitors are on a phone) and the page shows the smallest one that looks sharp. Photos you uploaded before this feature can be sized with one button on the Photo Gallery card (the Website editor).

## Prove it

1. Open Admin > Website. The preview on the right shows your site as it stands.
2. Change the headline on the Hero card. The preview changes as you type. Click Save Hero - "Saved and verified".
3. On Page Layout, add an FAQ block, type one question, and watch it appear in the preview. Save Page Layout.
4. Change your mind? Every card except Gallery, Pages, Events, Inbox and Homepage has a **Previous versions** button next to its status. It lists every version that card replaced when you saved (the newest thirty), with the date and a few words from it. **Restore** puts one back and it is live at once; the version it replaced is kept in the list too, so a restore can be undone the same way. The five settings cards (What's Public, Search & Sharing, Email Updates, Site, Site-wide) share one record, so their Previous versions list is the same list.

Ask your AI: "I saved the wrong words on my Hero card - how do I get yesterday's back?" or "Does Restore change my photos?" (restoring Hero, Offer Slides or Page Layout puts back that version's choice of photos too; the Gallery itself is never changed by a restore, and a restore only changes the card you restored).
5. Open your site on your phone: the menu button opens the pages you chose on Navigation; the photos load quickly.
6. Send yourself a message through an Inquiry form block. It appears in the Inbox card and, if email is set up, in your facility inbox.
7. Share your site's address in a text message: the share image and title from Search & Sharing appear with the link.

# CHAPTER: What's Public and the Holding Page

# What's Public and the Holding Page
*Open your site one part at a time - no second site, no re-install*

Your website can be up while booking is not. Memberships can stay hidden until
your tiers are ready. A page can be built and kept private until launch day.
All of it is one card: **Admin > Website > What's Public**.

## The switches

One row per part of your site, each with a **Public** box:

- **Booking** - the booking page (/book) and My Booking. Off, the address
  shows your holding page instead of the grid; nobody can reach prices or
  checkout.
- **Memberships** - the memberships page and joining online.
- **Member portal** - My Membership, where members sign in.
- **Events** - the events page.
- **Gift cards** - the gift cards page and buying one.
- **Leagues** - there is no leagues page yet: switched on, your holding page
  answers at /leagues and Leagues appears in the menu; off, the address is not
  found.
- **Your pages** - every page you built on the Pages card, one row each. Off
  means "not found" for visitors.

Each row says **public** or **not yet public** so you can read the state of
your whole site at a glance.

## What "not yet public" does

The part is not merely hidden - it is closed:

- Typing the address gets the holding page (or "not found" for a page).
- The part's inner workings answer nothing to visitors - the booking grid,
  the tiers, the checkout.
- Every menu item, hero button, footer link, sitemap entry and homepage
  section that points at it hides on its own. You never have to hunt for
  leftover links.
- **You and your staff keep everything.** Signed in, the admin sees every
  page; the staff pad still books at the counter.

## The holding page

What a visitor sees at a part that is not yet public. Two fields on the same
card: a **headline** ("Opening Fall 2026") and a **text** (a line break starts
a new line). It wears your site's own header and footer, and it carries the
email-updates signup when Email Updates is on and its "also show on the
holding page" box is ticked - so a visitor who arrives early can leave an
address. Search engines are told not to index it.

## Prove it

1. On What's Public, untick Booking. Save.
2. In a private browser window open your site's /book address: your holding
   page. The Book Now buttons are gone from the header and the hero.
3. Sign in to Admin and open /book in the same browser: the grid, as always.
4. Tick Booking again. Save. /book is the grid for everyone.

# CHAPTER: Your Menu and Links

# Your Menu and Links
*Rename a menu item, point it somewhere else, add your own*

**Admin > Website > Navigation** lists every item that can appear in the
menu at the top of every page and in the footer, in your order.

## What you can change on each item

- **Top menu** and **Footer** boxes - where it appears.
- **Arrows** - the order.
- **Label** - the words. "Events" can read "What's On"; "Memberships" can
  read "Join the Club".
- **Link** - where it goes. A built-in item can point at one of your own
  pages (/p/your-page), at a section of your homepage (pick "Section: ..."
  from the list that drops down), or at a full https:// address. If you
  change your mind, "use the built-in words" puts it back.

## Add a link

**+ Add a link** adds a menu item of your own: a label and where it goes. An
off-site address opens in a new tab. Remove it with the x.

## Links that point at nothing hide themselves

A menu item, footer link or button that points at a part of the site that is
not yet public, a page that is not published, or a homepage section you have
switched off, hides until its target is back. You will never show a visitor a
door to an empty room. The same rule keeps the "Section: ..." list honest: it
offers only the sections that are on.

## Prove it

1. Relabel Events to "What's On". Save Navigation. The header on every page
   reads What's On.
2. Add a link "Our Golf Course" to an https:// address. Save. It opens in a
   new tab.
3. On What's Public, untick Events. Save. "What's On" is gone from the menu
   until Events is public again.

# CHAPTER: Hero Buttons and the Closing Band

# Hero Buttons and the Closing Band
*The two buttons at the top, the band at the bottom*

## Hero buttons

The **Hero** card holds up to two buttons. Each has its **text**, where it
**goes to**, and a **Show** box. The "goes to" field drops down every place a
button can point: your pages (/book, /memberships, /events, /gift-cards,
/how-it-works, the member portal, Leagues, every page you built), the
email-updates signup when it is on, and **the sections of your homepage that
are switched on** ("Section: Offer slideshow", "Section: Photo gallery"...).
A full https:// address works too.

A button that points at a part that is not yet public, or a section that is
off, hides itself until its target is back.

## The closing band

The last thing on your homepage is the band that reads "Ready to Play?" with
a button. On the **Page Layout** card, click the **Ready to play?** block to
edit its **title**, the **line** under it, the **button text** and where the
button **goes**. Leave a field blank to keep the standard words; the button
follows your first hero button unless you set it. Untick **Show** to hide the
band altogether.

## Headline and subline

Also on the Hero card: the small tag line, the headline and the subline.
Work your city and "golf simulator" into the headline - search engines weigh
it heavily. The preview redraws as you type; nothing changes on the site
until you click Save Hero.

## Prove it

1. Set button 2 to "See the bays" going to "Section: Offer slideshow". Save
   Hero. On your site the button scrolls to the slideshow.
2. On Page Layout untick Show on the Offer slideshow. Save. Button 2 is gone
   from the hero. Tick it back; the button returns.
3. Click the Ready to play? block, change the title and the button text, Save
   Page Layout. Scroll to the bottom of your site.

# CHAPTER: The Notice Bar

# The Notice Bar
*One line across the top of every page - holiday hours, a closure, a launch*

Set once in **Admin > Settings > Booking > Booking Page Notice**: tick **Show the notice banner**,
type the **notice text**, and - new - an optional **notice link**: one of
your pages (/events, /p/your-page) or a full https:// address. With a link,
tapping the bar goes there. Blank means a plain notice.

The same notice shows at the top of the booking page, the landing page and
every website page - one notice, set in one place. Untick the unit to take it
down; the words stay saved for next time.

## Prove it

1. Tick the unit, type "Holiday hours: closed Dec 25", set the link to
   /events. Save Settings.
2. Open your site: the bar is at the top of the landing page and the booking
   page, and tapping it opens Events.
3. Untick the unit. Save. The bar is gone everywhere.

# CHAPTER: Email Updates

# Email Updates
*A signup that lands on your device - and a list you can download*

Before you open, and every day after, people want to hear from you. **Admin >
Website > Email Updates** gives them a box to leave an address. Every signup
lands on your device - never a mailing service - with a name if they gave
one, where they signed up, and the moment they agreed.

## Turn it on

Tick **Email updates are ON**, write the **title**, the **line** under it and
the **button** text, and choose whether the signup **also shows on the
holding page**. Save. Three places then carry the signup:

- **/updates** - its own page (point a hero button or a menu item at "Email
  updates signup").
- **The holding page** - a visitor who arrives before you open can leave an
  address.
- **Your homepage** - add the **Email updates signup** block on Page Layout
  wherever you want it.

Switch it off and all three go quiet; the list stays.

## What the visitor sees

Email, an optional name, a box that reads "I would like email updates from
<your name>. I can unsubscribe with one click in any email", and your
button. The exact words of that box are recorded with the signup.

## The confirmation and the unsubscribe link

If your email sender is set up (Settings > Connections > Resend - Email
Notifications), each new signup gets a
short confirmation from you with a one-click **unsubscribe** link. The link
works without signing in and keeps working forever. Without a sender the
list still fills - nothing is lost.

Someone who unsubscribes stays on the list marked **unsubscribed** so your
mailing tool never re-adds them by mistake; if they sign up again they are
back on, with a fresh confirmation.

## The list

Under the card: **search** by email or name, ten per page, the count on the
list, and **Delete** on any row. **Download CSV** gives you a file with
email, name, source, the consent time, whether a confirmation went out, and
the unsubscribe date - for whatever mailing tool you use. The CSV is the
whole list, the unsubscribed included and marked.

## Protection

Ten signups a minute per visitor; a bot's hidden field is accepted and
dropped; a signup is never counted as a sign-in attempt, so a flood can never
lock you out of Admin.

## Prove it

1. Turn Email Updates on, save, open /updates on your phone and sign up with
   your own address.
2. The Email Updates card lists you. If email is set up, a confirmation is in
   your inbox - click its unsubscribe link, and the row says unsubscribed.
3. Download CSV and open it.

# CHAPTER: PDF Pages

# PDF Pages
*A menu, a league flyer, a price sheet - shown as a page of your site*

On **Admin > Website > Pages**, a page can be a **PDF document** instead of
text. Set **Page type** to "PDF document", click **Upload PDF** (up to 25
MB), and Save Page. Publish it, put it in the menu on the Navigation card,
or point a hero button at it.

## What visitors see

The document, page by page, drawn right there on the page - on a computer
and on a phone alike - with **Open the PDF** and **Download** buttons above
it (their words are yours to change on the page card - 'The "open" button
says' and 'The "download" button says'; left blank, they keep those words),
and any text you typed below it. Nothing leaves your device to a third
party: the viewer ships with your booking system.

## Keep it light

A document exported for screens (most tools call it "web" or "reduced size")
loads fastest on a phone. Replace the document any time with Upload PDF and
Save; the address of the page never changes.

## Prove it

1. Make a page "Menu", type PDF document, upload your menu, publish, Save.
2. Open /p/menu on your phone: the pages draw; Open and Download work.
3. Give the page its own search title and share image on the same card and
   send yourself the link in a text: the title and picture appear.

# CHAPTER: After a Restore - Reviewing Your Settings

# After a Restore - Reviewing Your Settings
*What a backup from an older device does not carry, and where to look*

When you restore a backup onto a replacement device, everything the backup
held comes back - bookings, members, waivers, documents, your website's
pages and words, your logo, your settings. Site photos and video are the one
thing backups leave out; the result screen names each one to re-upload. Your data is also brought up to date for the software on the new
device the moment the restore finishes, before you sign in; nothing waits
for a restart.

## The list on the result screen

A backup from an older device never answered questions the newer setup
wizard asks. The result screen names each setting that was not in your
backup and now sits at its default, section first, such as:

- Employees & hours › Enabled
- Checkout hold (minutes)
- Waivers › Reminder Days
- Counter › No Show Grace Mins

Read the list, then click **Continue to Admin** and review each one in
Settings. The defaults are safe; they are simply not your choice yet.

## Site photos and video

Backups deliberately leave out the website's photos, the booking page's hero
photo and any video - you have the originals, and they are the one thing that
could make a backup huge. The result screen says how many were left out and
names them. Upload the website's photos and video again in Admin > Website
(same place as before), and the booking page's hero photo in Settings >
Business & Content > Branding & Theme. Until you do, those spots show without
their picture.

## Where they live

Employees & hours: Settings > Staff > The Counter (Employee scheduling & time
clock) and Settings > Staff > Hours & Export. The checkout hold has no setting
on screen - it stays at 10 minutes. Waiver reminders: the Waivers tab. Counter
items: Settings > Staff > The Counter. Anything else on the list names its
section the same way.

## Prove it

1. After the restore, sign in and open every section the list named.
2. Book a test tee time from your phone and check it in at the counter.
3. Open Admin > Website: your pages, menu and holding page are as they were.

# CHAPTER: Formatting Your Text

# Formatting Your Text
*Bullets, Numbered Lists, Divider Lines, Headings, Bold, Italics and Quotes - Without Memorizing Anything*

Every long text box in your admin has a small toolbar above it: **Bullet**, **Numbered**, **Divider**, **Heading**, **Small heading**, **Bold**, **Italic**, **Quote**, a **?** for help, and a **Preview** switch. The buttons write the formatting for you, and the preview panel next to the unit shows what visitors will see - it is drawn by the same engine that draws your website, in your site's own colours.

## Where the toolbar appears

- **Admin > Website**: the hero Subline, the "All Other Times" text in Staffed Days, the Intro Text of the Memberships section, and on Page Layout: Paragraph 1 and Paragraph 2 of every Photo + text block, the text of a Text only block, the note under a Rates table and the line under an Inquiry form's title; the body of every custom Page; and event descriptions.
- **Admin > Members**: the Memberships Page Introduction and the Description of every membership tier - the words on your website's membership cards, on the public /memberships page, and in each member's portal.
- **Admin > Settings > Business & Content > How It Works Page**: every step's text.

Short one-line boxes (offer slide text, the promo banner text, the Staffed Days intro line) still understand **bold** and links but have no toolbar - there is no room for lists on one line. Titles and headlines (a step's title, a block's headline) are plain words. Text messages and email templates are plain text on purpose: a phone does not turn a dash into a bullet.

## The buttons

**Bullet** - select some lines (or just put the cursor on one) and click Bullet: each line becomes a bullet point. Click again to take the bullets off. While you type in a bullet, pressing Enter starts the next bullet for you; press Enter on an empty bullet and the list ends.

**Numbered** - like Bullet, but the lines are numbered 1, 2, 3. Press Enter inside a numbered item and the next number is written for you; Enter on an empty item ends the list. Click Numbered again to take the numbers off. Steps, house rules and "how to book" read best this way.

**Divider** - drops a thin line in your accent colour where the cursor is, on its own line. If you have typed rows of underscores in the past, those already show as divider lines - nothing to redo.

**Heading** - turns the current line into a sub-heading. Click again to turn it back into normal text.

**Small heading** - a second, smaller heading for a point under a sub-heading (a sub-heading for "Memberships", small headings for each tier's name). Click again to turn it back into text.

**Bold** - select the words and click Bold (or press Ctrl+B). Click Bold on the same words to un-bold them. With nothing selected it inserts the words "bold text" already selected, so you can just type over them.

**Italic** - select the words and click Italic (or press Ctrl+I). Click again to un-italic them. A word that already has underscores in it, like a_file_name, is never mistaken for italics.

**Quote** - put the cursor on a line (or select a few) and click Quote: the lines become a quote, marked with a line in your accent colour. Testimonials, a line from a review, a note from the owner - anything you want set apart. Enter inside a quote continues it; Enter on an empty quote line ends it.

**? and Preview** - the ? opens the cheat sheet with a worked example right under the toolbar. Preview hides or shows the live panel; on a wide screen the unit and the preview sit side by side, on a phone the preview sits underneath. Ctrl+Z undoes a button click like any other typing.

## The cheat sheet

The buttons write these marks. You can also type them yourself - the text in the unit is plain text, so it copies and pastes anywhere.

- `- Item` on its own line - a bulleted list.
- `---` on its own line - a divider line in your accent colour (a row of five or more underscores does the same).
- `## Words` on its own line - a sub-heading.
- `### Words` on its own line - a smaller heading.
- `1. Item` on its own line (or `1) Item`) - a numbered list; the numbers you type are what show.
- `> Words` on its own line - a quote; several `>` lines in a row make one quote.
- `_words_` - italic words; a word_with_underscores stays as typed.
- `**words**` - bold words; bold never runs across a line break.
- `[Book now](/book)` - a link: a full https:// address, or a page on your own site such as /memberships. A bare web address typed in the text is not clickable.
- A blank line - a new paragraph. A single line break stays a line break.

## Good to know

- Membership cards are narrow: three to five short bullets read better than a paragraph; keep headings to two or three words.
- The preview shows structure and colours; text on a card is slightly muted on the live site and the site's own fonts apply, so the page looks a touch different from the panel, never different in content.
- Every page you wrote before these buttons existed shows exactly as it did: the new marks only change text that carries them. If an old page has a line that begins with "1." or ">" that you did not mean as a list or a quote, put a space or a word in front of it.
- Anything that looks like web code is shown as plain letters and never runs. Links only work for https:// addresses and pages on your own site. Your pages stay safe no matter what is typed.
- Saving works exactly as before: the toolbar edits the same box, so the card's Save button (or the Unsaved Changes flag) behaves as it always has.
