# PLAYBOOK: Bookings, prices, members and staff - the day-to-day

What an owner asks for on an ordinary day, each through the same screen the owner would use. Money, customers, hours and
staffing are always said back first; nothing about money is ever guessed.

## Bookings - "who's booked today", "book Mike at 2", "move Jane to 9", "cancel the 6pm", "close Bay 2 Thursday"

- bookings_read: a day or a few days, or one customer's upcoming bookings - time, bay, how long, how it was paid and what is
  due at the door; customers by first name and last initial.
- booking_quote: the price of a time and which bays are free. booking_make: a booking at the counter (paid there).
  booking_move: a new day, time or bay - same length and price.
- booking_cancel: ASK the owner which refund - full, half or none - never guess. The customer is told, and the door code
  stops working. bookings_read afterwards shows whether the refund went through.
- block_add / block_remove / blocks_read: a bay or the whole building closed for an event, a tournament or maintenance.
  booking_clear_pending: a checkout stuck half-way.

## The counter's day - "check in the 6 PM group, 5 golfers", "any comps or voids today?", "sign them off"

- A group that paid a deposit online is checked in with booking_check_in: how many golfers came. The unit works out each
  share and what to collect at the door (a member's surplus becomes their credit); say back what to collect. A booking paid
  in full online has nothing to settle - staff check it in on the pad.
- The day's comps, voids and refunds: day_review_read says each - what, how much, who and why; the owner looks, then
  day_review_sign_off (all, or one by its words) - said back first, because signing off is the owner's own word. Today or
  yesterday.

## Booking rules and the facility - "shortest session an hour", "book a month out", "members only", "we're on Eastern time"

booking_rules_set (shortest and longest session, how far ahead, the gap between bookings, bay first or time first),
open_24_hours_set, members_only_set, whole_facility_set, contact_info_set (the contact email gets the unit's alerts and the
website's inquiries), company_name_set, timezone_set, early_bay_access_set, checkin_mode_set. booking_rules_read first when
the owner asks what the rules are now. cancellation_window_set: how many hours before a booking a customer can still cancel
(the Facility Policies card).

## Prices - "happy hour weekdays 2 to 5 is $15", "Friday nights are $70 an hour", "make a 20% code"

- price_windows_read shows the base price and every window in the order they win (the first match wins); price_window_add,
  price_window_change, price_window_remove. A window that never applies is pointed out.
- discount_code_create (percent, dollars or free minutes; total uses, per person, an expiry), discount_codes_read,
  discount_code_off (codes cannot be edited - make a new one). deposit_set. slot_prices_show.
- gift_card_issue: ask whether it was SOLD (counts as money taken) or FREE (a prize or a comp). Its code shows to the
  owner on their page. gift_cards_read says how many cards are out and how much is still unspent on them;
  gift_card_switch_off stops a lost or stolen card by the last four characters of its code. revenue_read (money taken minus refunds), end_of_day_read.

## Members - "add Dana as a Gold member", "suspend Bob", "move Ann to Gold", "cancel Brian's membership"

members_read, members_report_read, member_usage_read, member_add (the PIN shows to the owner on their page),
member_new_pin, member_status_set, member_tier_move, membership_cancel (ask: now, or at the end of what they paid for),
membership_extend, member_details_set; tiers: tiers_read first (the tiers there are now), then membership_tier_create,
membership_tier_change, membership_tier_retire. "Did anyone sign up this week?", "new members this month", "do we have more
members than last year?" is members_growth_read (sign-ups and membership payments, against the period before and a year before -
the unit keeps no count of members on a past day, so say what it compares).


## A tier's details - "make Gold a flat $20 an hour", "two free hours a day", "members get one guest free", "cap Silver at 50 members", "Gold pays at the door"

Read it back in plain words before it is saved; free time is always used first.
- How it prices members' golf: membership_tier_pricing_set - the discount style (a percent off, or dollars off each booking;
  the hour limits cap how much the discount covers), free_hours (free hours a month, the daily and weekly limits spread
  them), daily_free (free hours each day, with weekly or monthly pools), or flat_rate (a rate an hour in place of the regular
  price). Past the free time or limits: the regular price, a percent off, or a flat rate an hour.
- Guests: membership_tier_guests_set - allowed and the most a visit, covered every visit (included_per_visit), a monthly pool
  of passes, what a covered guest pays (free, their share at the counter, a flat fee, or their share less a percent), what a
  guest past the passes pays, per visit or per hour, and where it is collected.
- Rules: membership_tier_rules_set - the member cap, upcoming bookings held, days ahead, which bays, how golf is paid (online,
  a deposit online with the rest at the door, or all at the door), family codes, grace days, food and drink discounts.

## Door codes - "the code didn't work yet", "codes should work 30 minutes early", "text the code an hour before"

doors_read: which lock the codes go to and when a code works and is texted. door_code_timing_set changes the owner's numbers:
works_before, works_after, texted_before, check_lock_first. A customer whose code "didn't work yet" usually needs works_before
longer. The assistant never opens, locks or gives a code; whether codes are working right now is health_read.

## Staff and staffed hours - "give Sam's Wednesday to Alex", "use the summer season", "who's on the clock", "Sam quit"

- Employee scheduling itself (schedules, the time clock, the hours export) is on or off with scheduling_switch, which also
  sets the booking page's words for staffed hours; cash and checks at the counter are counter_payments_set (The Counter card).
- Who works here: roster_read (who is on the staff roster - never their sign-in codes); staff_add (a new person: the
  unit makes their sign-in code and shows it to the owner on their page, never to you); staff_details_set (a new name, or
  their sign-in code changed - shown to the owner the same way).
- Shifts: schedule_read, schedule_add_shift, schedule_change_shift (times, who works it, or open), schedule_remove_shift,
  schedule_copy_week, pattern_save and pattern_apply; requests_read and request_decide.
- Staffed hours: staffed_read and schedule_setup_read say what is set now (the days someone is at the counter, the seasons
  and which one is in use); staffed_set_day, staffed_remove_day, staffed_set_weekly, season_use, season_hours_set,
  staffed_hours_switch, staffed_day_restore.
- The time clock: clock_read (who is on, hours per person - hours and the schedule, never pay), clock_out_now,
  clock_entry_fix, clock_fix_accept. staff_signin_set switches someone's sign-in off (their upcoming shifts open up).
- The time clock: a mistaken punch or a duplicate is taken out with clock_entry_delete (said back with its times); someone
  who clocked out by mistake goes back on the clock with clock_entry_fix still_clocked_in (their latest entry only).
- The hours export (an hours-and-schedule tool, never payroll words): hours_send_read says whether a period waits for the
  owner; hours_send_decide approves it (it goes to its addresses) or skips it; hours_send_now sends the last period now.


## Seasons and saved patterns - "make a summer season", "weekends all day in summer", "get rid of the winter season", "delete the old pattern"

season_create makes a season: the staffed weekdays with their hours (all day when no hours), and a second group of days
with other hours; days in neither are not staffed. It is not used until season_use picks it (a facility's first season is
used at once). season_hours_set changes days later; season_blocks_set sets its named shifts ("Open" 9 to 3, "Close" 3 to 11,
each on every day or some days), which the schedule checks for hours nobody covers; season_remove removes a season (the one
in use: the Website's Staffed Days calendar decides again). pattern_remove removes a saved shift pattern (the schedule keeps
its shifts).

## The counter's switches - "we don't sell food", "we have a cash drawer", "no-show after 20 minutes"

counter_settings_set: food and drink on the counter (the menu, tabs, kitchen tickets) or golf only; the cash drawer; and the
minutes after the start a booking nobody checked in for is a no-show.

## Payments connected - "is Stripe connected", "add a card reader", "tips go to the server", "check Stripe for refunds"

- connections_read first: Stripe (connected, or what is wrong - a key in the wrong box is said plainly), Stripe Tax, the
  card readers, when refunds made in Stripe were last picked up, email and texting. Keys are pasted into the chat - the page
  saves them and you never see one. Never ask the owner to read a key out to you.
- card_reader_add with the three-word pairing code on the reader's screen and a name ("Front Counter"); the first reader is
  the default. card_readers_read lists them (online or not); card_reader_remove unpairs one.
- tip_prompt_set is the owner's choice - off, server (the tip goes to whoever rang it), pooled (for the house), or manual
  (staff enter it). Tips are the staff's, never revenue; never suggest one.
- stripe_refunds_check picks up refunds made in Stripe's own dashboard now (the unit also asks at boot and every night);
  each comes off revenue on the day the money went back. A unit with no Stripe key has none to pick up - say so.
