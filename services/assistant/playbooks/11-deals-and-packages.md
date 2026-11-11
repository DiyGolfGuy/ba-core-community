# PLAYBOOK: Deals, packages and specials - and teaching the owner what they can run

maintainer: "the Ai needs to do and and sometimes even say this is what I can do so it needs to teach the owner some things along the
way". Most owners do not know every kind of deal a golf simulator facility runs. When they ask for ideas, or say business is
slow on a day, or ask "what can you do", the assistant shows them - with examples made from their own menu and price - and
sets up the one they pick. Money is always said back first, and a price or a tax is never guessed: what the owner did not say,
the unit asks.

## "What deals can I run?", "any ideas?", "Tuesdays are dead", "how do I get more people in?"

1. deal_ideas: every kind there is, each with an example from this facility, and what is set now.
2. Say three or four of them back in plain words, the ones that fit what the owner said (a slow day: a booking deal or a happy
   hour on that day; parties: a package; the bar: a drink special), each with its example. Ask which one they want - with
   ask_owner and the kinds as answers to tap.
3. Set up the one they pick with its tool, asking what the tool needs one question at a time. Say what each one does to the
   price before the yes (the card says it too).

The kinds, what each is for, and HOW THE CUSTOMER GETS IT (say this part every time - owners ask "do they have to pick it?"):
- **A booking deal** (deal_set) - no code, the price is lower when a booking fits it: "book 2 hours on Tuesdays, the last 30
  minutes free", "buy an hour, get an hour" (2 hours, the last 60 free), "20% off any booking of 3 hours or more", "$10 off
  weeknights after 8". Fills slow days and stretches visits. The customer books as usual and the lower price is just there -
  nothing to pick, nothing to type, online or at the counter. Only the best deal that fits is taken; a member books at their
  own price and never pays more than the deal.
- **Something free with a booking** (deal_set, kind free_things) - "book 2 hours, get 2 free pitchers", "a free appetizer with
  any booking on Mondays". Nothing to pick and no special booking (maintainer: "they just get the pitchers at the front desk no need for
  a special booking. That gets confusing"): the customer books as usual, the booking page and their confirmation say "2 Pitchers
  free at the front desk", and staff hand them over - the staff pad shows "Free: 2 Pitchers" on that booking, and they ring up
  at $0 on its tab. The bay's price does not change, so it can stand beside a money deal. Needs someone at a counter with food
  and drink (an unstaffed facility: offer it only on staffed days, by its start window).
- **A package** (package_set) - bay time and what comes with it at one price: "2 hours and a pitcher for $60", a birthday
  party at $25 a person with a pizza and 2 drinks each, a corporate outing for 3 hours. Customers pick it on the booking page
  and pay in full; at the counter what it includes rings up at $0 on that booking until it is used up.
- **A happy hour or peak price** (price_window_add) - a different half-hour price at set times: weekdays 2 to 5 cheaper,
  Friday and Saturday nights higher.
- **A food or drink special** (counter_special_set) - the counter charges it while it is on: Taco Tuesday, $1 off draft beer
  Fridays 4 to 7, half-off wings during the game.
- **A discount code** (discount_code_create) - customers type it when they book: SPRING20 for 20% off, a limit and an end said
  first.
- **A rate checked at the door** (discount_code_create with check_at_door) - military, first responders, seniors, students:
  MILITARY20 for 20% off, check_at_door "a military ID". The customer types the code when they book and is told to bring their
  ID (the booking page, the confirmation and its email, their booking online); the staff pad shows "Check: a military ID" on their
  booking and at check-in. It works EVERY visit unless the owner says a limit. "Seniors too" right after is the same deal for seniors,
  checked by a senior ID - never a new amount nobody said. A code comes off after any booking deal that fits.
- **A first-visit offer** - a code that works once for each person (discount_code_create; one use per phone number unless the
  owner says otherwise), like WELCOME10 for $10 off, then shown in the website's first-visit band (website_promo_set): "First
  visit? $10 off with WELCOME10". A code comes off the whole booking - never promise "your first hour half off". A first-visit code has no check at the
  door unless the owner asks for one (then the staff pad shows what they wrote).
- **A membership** (membership_tier_create) - monthly, with free hours or a lower price.
- **Gift cards** (gift_card_issue) - for the holidays, for a raffle.

## A package - "make a birthday package", "2 hours and a pitcher for $60", "a corporate package"

package_set. Its bay time, its price (flat, or a person's with the least and the most players), what it includes (an item by
name, or any of a part of the menu - "2 beers each" is 2 from Beer a person), its days and start window if it has them. Its
price and its tax are the owner's: call without them and the unit asks - the tax with the counter's taxes to tap (all of it as a
booking, all of it as one tax code, or split: the golf part as a booking and the rest at a code). The card says what it comes
to for its least and most players, with the tax. A package the menu cannot hold yet (a pizza not on the menu): add it to the
menu first (menu_items_add). Changing one: package_set with package (its name now); bookings already made keep what they bought.

## Packages everywhere they are sold - "show our packages on the website", "book Sam on the birthday package Saturday at 2 for 8"

- On the website: packages_on_website - each package on sale as a card with its price,
  what it includes and when, and a Book button that opens the booking page with it picked. The booking page lists them anyway.
- At the counter, for a walk-in or a phone call ("book Pat Lee on the party package Saturday at 2 for 8"): booking_make with
  package (its name) and players - never package_set, which changes the package itself. Its length and price are the
  package's, paid at the counter, and what it includes rings up at $0 on that booking. Staff can do the same on the pad (New
  booking > Package).

## A booking deal - "last 30 minutes free on Tuesdays", "20% off 3 hours or more", "$10 off after 8 on weeknights"

deal_set. Its kind (the last minutes free, a percent off, dollars off), how much (the owner's number - otherwise the unit
asks), the booking it needs (at least 2 hours - a minutes-free deal always needs one, and the unit asks when it was not said:
the free minutes come off the end of a longer booking), its days and start window. The card says what a booking comes to at the
standard rate. The owner's shorthand is read as meant: "2 hrs" is 2 hours, and "free 30 days if they book 2 hrs" is 30 minutes -
the card says it in full before the yes. Changing or switching off: deal_set with deal (its name now), or deal_remove.

## Something free with a booking - "book 2 hours get 2 free pitchers", "free appetizer with any booking Mondays"

deal_set with kind free_things and free (what comes free off the menu, and how many - "2 pitchers"). The booking it needs and
the days, as with any deal. It is NOT a package: never package_set for this, and never ask the customer to choose anything. The
card says what it is worth at the menu's prices and that staff hand it over. A menu with two pitchers: the unit asks which.

## Which one is it? - a deal, a package or a counter special

- The customer books as usual and gets time or money off: a booking deal.
- The customer books as usual and gets something at the desk: a booking deal with free things.
- The customer picks a bundle and pays one price for it (a party, "2 hours and a pitcher for $60"): a package.
- Food or drink costs less at certain times, whoever buys it: a counter special.

## A flyer for it - "make a flyer for the Tuesday deal", "a flyer for the birthday package", "put it on Facebook"

flyer_make with about (the deal's, package's, event's or special's name). Its words come from the thing itself; the look is
poster unless the owner asks ("bolder", "use the photo", "simpler"). It goes first in the homepage's slides until the thing's
own last day. The chat shows the flyer with three buttons: a Facebook or Instagram post, a square post, and a Story.
To put it on Facebook or Instagram, walk the owner through it one step at a time:
1. Tap "Download for a Facebook or Instagram post" under the flyer (a Story: "Story").
2. Open Facebook (or Instagram) on the phone or computer and start a new post (Instagram: the + button, then Post or Story).
3. Add the picture just downloaded - it is in the phone's photos or the computer's Downloads.
4. Write a line (the unit can suggest one: the deal in plain words and the website's address), then Post or Share.
Then offer to email it to everyone signed up: newsletter_send with the flyer as its picture. Something not set up yet ("a flyer
for our grand opening"): flyer_make with title, words and price in the owner's own words. A special in the homepage's specials
section: special_flyer. By hand: Website editor > Offer Slides > Make a flyer. Finding them later: Website editor > Offer
Slides - each flyer is a slide there with its Download buttons, until its deal ends. A flyer is only a picture: set up the deal
or package FIRST (a flyer for something not set up is put up as a card saying so), then make its flyer.

## What is set now, and taking one off - "what packages do we have?", "drop the corporate package"

deals_read lists every package and booking deal with its price, what it includes, when and its tax. Taking one off: package_remove
(bookings already made keep what they bought) or deal_remove - only when the owner asks for it in so many words.

## Where they live - "take me to packages", "where are the deals?"

Pricing > Booking Deals and Pricing > Package Deals (the owner can do all of it there by hand); the food and drink specials are
Settings > Food & Payments > Specials & Deals; codes are Pricing > Discount Codes; flyers are Website editor > Offer Slides >
Make a flyer. "Take me to packages" opens the card beside the chat.

## Not built yet - say so plainly, and the nearest thing

- Prepaid hour packs ("buy 10 hours, get 2 free"): a gift card of that value is the way today.
- A bonus on a gift card ("buy $100, get $120"): not yet - recorded for later.
- Loyalty points or "the 10th visit free": not yet.
