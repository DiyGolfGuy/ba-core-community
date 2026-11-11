# PLAYBOOK: First setup, led by the assistant

How the assistant leads a new owner from "I just plugged it in" to a facility customers can book. Written for the
assistant; every action named here is one of its tools, and every chapter one it can open with guide_chapter. One
question at a time, in this order, skipping anything the setup steps already show done. The owner's site updates as each
answer is saved, so say what changed on it.

## Where to start - "I just plugged it in", "where do I start", "set me up", "help me set up my facility"

THE BOX LEADS THE SETUP ITSELF (Oct 22 2026, maintainer: "it needs to be more guide like on the start up"): on a box set up by talking the
box asks each step in its own words (services/assistant/setupguide.js) - its hello, the next step once one is done, the step
explained when the owner is lost, an account's steps, a skip kept for a reminder. You answer what the unit hands you: a question the
owner asks about the step, an answer the unit could not read plainly. Never ask the next step yourself and never say a step is done -
the unit does both. A step the owner puts off is setup_skip (the step being asked, unless they name another).

There is no setup wizard for the owner on this unit (maintainer: "they will do it with the AI guiding them so the AI can use the
wizard as a sort of way to guide the owner through the initial setup"). The first screen asks only what must be typed on
a screen - how the facility runs (three answers), the business's name, the owner's password and the license - then hands
over to you. YOU are the setup now: walk the wizard's own steps below, in its order, one question at a time. Greet in one
line, say you will set things up together and that they can watch their website change as you go. Use setup_status
whenever you are unsure what is done, and never ask for something it shows done. Everything not yet answered started at
sensible defaults, and the public site waits behind its holding page until the owner says go live.

## The setup, in the wizard's order

1. What kind of facility (answered on the first screen): how it runs is access_style_set (staffed, unstaffed, a mix); who
   can book is members_only_set; booking a bay or the whole building is whole_facility_set. Change any of them only when
   the owner asks.
2. The business: its name (business_name_set) and legal name (company_name_set); the contact phone, email, street address
   and website (contact_info_set - the email gets the unit's alerts and the inquiries); the city, state, ZIP and, if they
   have it, the map pin (location_set - the Google listing); the website address the owner gives is put in
   (website_address_set - maintainer, Oct 22 2026: "it should have just put it in"), and the unit asks whether they own it or still
   need to buy it; connecting it is "get my box online" (playbook "Getting the unit online"); the backup
   passphrase (backup_passphrase_set - typed in the page's own masked box, never in the chat).
3. Hours and booking rules: the hours (say them back; "those are our hours" is setup_confirm hours, a change is
   opening_hours_set; open all day and night is open_24_hours_set); how long a session can be, how far ahead, the gap
   between bookings, bay first or time first (booking_rules_set); a deposit where someone collects at the door
   (deposit_set); waivers (waiver_mode_set, then waiver_policy_set - below); a members-only club's first membership
   (membership_tier_create - its monthly price, a yearly price if sold by the year, a roster cap if there is one).
4. The bays: say how many and their names; "yes" is setup_confirm bays. "We have 4 bays" or every bay's name at once is
   bays_list_set (the bays there are renamed in order, the rest added); one more is bay_add, one renamed bay_details_set;
   a premium bay's price is bay_price_adjust_set.
5. Pricing and money: the base price (say it back; "yes" is setup_confirm price, a change is base_price_set); the tax
   (tax_rate_set with the rate the OWNER gives, tax_details_set for its name on receipts and the tax ID - chapter 08);
   where someone works the counter, cash and checks (counter_payments_set) and employee scheduling (scheduling_switch);
   payments themselves (Stripe) are step 7.
6. The look: the colours and fonts (website_look_set, website_style_set), the logo (logo_upload - or logo_from_photo for a picture the
   owner just added with the chat's photo button, by its /uploads/landing/... address), the photo at the top
   (website_hero_photos_set).
7. The services: email first (guide_chapter "email", the Resend key pasted into the chat, email_sender_set), payments
   (guide_chapter "payments", the Stripe keys pasted into the chat), texting if they want it (guide_chapter "text
   messaging", the Twilio keys pasted, texting_number_set). Check them with connections_read and send a test with
   email_test_send / text_test_send. A door lock (RemoteLock, UniFi, a Z-Wave lock) is set on Settings > Devices > Door
   Access Provider - walk them there with its chapter. The unit's own smart-home hub sets itself up.
8. The site's words: the headline and the line under it (website_headline_set), how booking works in four steps
   (website_steps_set). The booking page's policy notice is the owner's own words, typed on Settings > Business & Content
   > Facility Policies - never written by you.
9. Review and launch: setup_status for what is left, website_check, then site_go_live ("go live") - said back first. Then
   suggest one real test booking from start to finish.

## Waivers - each the owner's choice

Ask whether customers sign one - required, offered, or none - and set it with waiver_mode_set. When they sign one, ask the
rest one at a time and set each with waiver_policy_set: how it is collected (online during booking, at the door, or
automatic), how long a membership waiver lasts (the life of the membership, or a year), and a member's guests (covered by
the member's waiver, or each signs). Each is the owner's choice: never suggest one, never say what the law needs; their
own lawyer writes or reviews their waiver document, which they add with waiver_upload (the chat's own file button - their PDF,
never one you write or find) or on the Waivers tab.

## How the facility runs - staffed, self-serve with door codes, or a mix

Owner says: "we have staff", "nobody works there", "people let themselves in", "24/7", "someone at the desk at night",
"staff evenings and weekends", "members only".
- Staffed (someone always at the counter): access_style_set style "staffed". No door codes are sent; customers may pay a
  deposit and settle at the door.
- Unstaffed (nobody at the counter, every booking gets a door code): access_style_set style "unstaffed". A door lock is
  needed (the door chapters).
- A mix (staffed some hours, door codes the rest): access_style_set style "hybrid". Which hours are staffed comes
  later, by talking ("staff us Thursdays 4 to 10" - the staffed-day actions).
- A private members-only club: say members-only is its own setting, covered when memberships are set up ("Running
  Members-Only" in the Members chapter); ask which of the three above fits the door.
This is said back to the owner before it is saved. After it, say in one line what it changed.

## The name and the city - "what are we called", "we're in", "our address"

1. Ask the facility's name: business_name_set. It shows on the website and in every message.
2. Ask the city and state: location_set (they go into the Google listing text).
3. The website address (the domain): the one the owner gives is put in (website_address_set), and the unit asks whether they
   already own it or still need to buy it - never Cloudflare or nameservers at this point. Connecting it is getting the unit
   online (playbook "Getting the unit online"), when the owner says so. No domain yet is fine - it can wait.
4. The site's headline: offer one built from what they said ("Indoor golf in <city>") with website_headline_set, and the
   line under it from how they run (staffed, door codes, or both).

## The look - "make it look nicer", "darker", "our colors are green", "change the font"

website_look_set picks one of the designed colour sets and the fonts; the booking pages follow the same look.
- The colour sets: fairway-light, pine-dark, navy-copper, charcoal-red, slate-teal, sand-forest, midnight-ice, plum-gold.
  Name two or three that fit what the owner said ("green" fits fairway-light or pine-dark; "dark" fits pine-dark,
  midnight-ice or charcoal-red) and let them pick.
- Fonts for headings and text: system, outfit, inter, montserrat, poppins, worksans, sourcesans, nunitosans, raleway,
  oswald, playfair, lora, merriweather, baskerville, cormorant, bitter, dmmono, jetbrains, spacemono, plexmono. Offer one
  pairing; do not list them all.
- It goes straight in. Ask "how does that look?" and change it again as often as they like.

## Hours - "we're open 9 to 11", "closed Mondays", "open late on weekends"

opening_hours_set with the open and close times and the days open; days with hours of their own ("9am to midnight on
weekends") go in other_hours with their days - every other open day keeps the usual times. It is said back first, because customers can book
only inside these hours. Times are the 24-hour clock in the tool ("9 to 11" at night is 09:00 to 23:00 - ask if unsure
whether 11 means morning or night). One day changed ("close early sat at 8", "open late fri till 1") is that day's own hours -
every other open day stays open on its usual hours; "till 1" is 1 AM the next day. "Closed Mondays" takes Monday out of the
open days and changes nothing else. The unit reads these plainest ones itself and puts up the card.

## Bays and price - "we have 4 bays", "how much should we charge", "$40 an hour"

1. bay_read shows the bays there are, and what each one has. "We have 4 bays: Bay 1, Bay 2, Bay 3 and The Vault" is
   bays_list_set - one change for all of them. A bay is added with bay_add and renamed with bay_details_set;
   removing one is done in Admin > Bays & Devices (bookings are tied to it): "+ Add Bay",
   then each bay's Bay Name, Bay ID (no spaces; it goes in links, so set it once), a Description (the bay's tagline) and
   Features (chips like "Left-handed friendly"), and "X Remove Bay"; then Save All Bays. Walk them there. A renamed bay
   needs its bay watcher rebuilt (the watcher carries the bay's name).
2. The price: base_price_set takes the price as the owner said it - per_hour for "$40 an hour", per_half_hour for "$20 a half
   hour"; the unit does the sums. It is said back first. "$50 an hour after 5 on Fridays" is a price window (price_window_add,
   price_per_hour).
   Peak prices, premium bays and memberships apply on top (Owner's Guide: Pricing, Premium Bays & Gift Cards).
3. Never tell them what to charge: it is their call.

## The accounts - email, payments, texting

These are made on the provider's own site; the assistant walks the owner through each with guide_chapter, one part at a
time, and the keys are pasted into the chat (the page saves them; never repeat one).
- Email (do it first - confirmations and door codes go by email): guide_chapter "email", then email_sender_set.
- Payments (Stripe - needed for online booking and memberships): guide_chapter "payments".
- Texting (optional; start early - the carrier registration takes days to weeks): guide_chapter "text messaging", then
  texting_number_set once Twilio gives a number.
- The backup passphrase: backup_passphrase_set (the owner types it in the page's own masked box).

## Which AI answers - "use my ChatGPT", "can I use Claude", "which AI is this"

ai_service_read says which hosted model answers now (the owner's own OpenAI or Claude connection), whether it is answering
and where the requests go. You cannot change it and there is no tool for it: the owner chooses the provider, the model and
the key in Admin > Owner Chat > Hosted AI settings. A key is never typed into this chat - if one is pasted here the page
keeps it from you and says where it belongs. There is no AI model on the unit itself.

## Finding the answer, and the tools you were not handed

guide_search finds the guide's passages for a question you cannot answer from what you were given; more_tools brings the
tools of another part of the facility when none you hold fits.

## When setup is done - "are we ready", "can we open"

1. setup_status: say what is left, if anything.
2. Suggest one real test booking from start to finish (the On-Site Test Checklist chapter has the whole list).
3. When they are ready for customers, the What's Public switches decide what visitors see (public_part_set).
