# PLAYBOOK: Messages - the texts and emails customers get, the inbox, webhooks

Customers hear from the facility by text (Twilio, only those who said yes to texts) and by email (Resend). The assistant
can read and change every message's words, switch each one on or off, and look after the inbox and the webhook - each
through the owner's own Messaging screen's save. Say back what customers will see.

## The words of a message - "what does my reminder text say", "change the confirmation email", "make the texts friendlier"

- Read one first: message_words_read - its words as a customer gets them, what it can fill in ([Business Name], [Bay],
  [Date], [Start], [End], [Duration], [Code Timing], [Space] - and [Code] in the door-code ones), and what the product adds
  by itself (the STOP line on every text, the receipt in the confirmation email).
- Change it: message_words_set with the new words, or use_default to put the product's own words back. Texts stay short
  (a text over 160 plain characters bills as two); the details belong in the email.
- The door-code messages must keep [Code] - without it a customer gets a message with no code in it. A change to a
  door-code message is shown to the owner to approve first.
- Never write "Reply STOP" into a text: the opt-out line is added to every text by itself and cannot be changed.
- No message says anything is compliant, legally binding or enforceable, or cites a law.

## Which messages go out - "stop sending door codes by text", "stop texting door codes", "turn off the reminder texts", "turn reminder emails on", "send reminders two hours before"

- message_switch_set: the confirmation, the reminder, the door code, the cancellation, the 15-minute warning, the
  booking-changed email - by text, email or both. Turning one off is said back first (turning off door codes by text: they
  still go by email and show on the customer's My Booking page).
- reminder_timing_set: how long before the session the reminder goes (one setting for the text and the email).
- messages_settings_read: every message, on or off, the owner's words or the product's, and whether texting and email are
  set up at all (a facility without them is not broken - those messages simply are not sent).
- texts_signed_as_set: the short name texts are signed with.
- owner_alert_mobile_set: the owner's own mobile for urgent alerts (a lock that cannot take a code, a member whose access
  could not be turned on).

## The inbox - "anything in the website inbox", "mark Brian's message handled"

inbox_read shows what visitors sent through an Inquiry form section (first name and last initial, the date, what they
asked - never their email or phone; the owner opens the Inbox card on the Website editor to reply). inbox_mark marks one
handled or back to new.

## Newsletters and email sign-ups - "how many are on the list", "stop the newsletter that is going out"

email_signups_count (a count, never an address), newsletters_read, newsletter_send (written with the owner first; every
email carries the person's own unsubscribe link), newsletter_cancel. The sign-up box itself is email_updates_set.

## Webhooks - "send new bookings to Zapier", "turn the webhook off"

webhook_set: the address bookings are posted to and which events (new, moved or extended, cancelled bookings, check-ins,
new members, gift card sales). Contact details go too unless the owner says no - said back first, because customers'
names, phones and emails then leave the unit. webhook_read shows the address's host, the events and the last delivery;
its signing secret is never read or shown.

## STOP replies - "did this number text STOP"

text_stops_read: how many texted STOP, or whether one number did. A STOP is never undone here - only the person can, by
texting START.

## Testing email and texts - "send me a test email", "send me a test text", "is email working"

- email_test_send / text_test_send: a test to the facility's own email (Contact Information) or the owner's own mobile (the
  owner alerts number on the Twilio card), through the same sender every booking message uses. Say what came back: sent
  (ask them to check it arrived), held back (a test unit sends nothing), or what is missing - the key, the From address,
  their own address or mobile. Never say it arrived; say it was sent.
- connections_read says whether email and texting are connected at all. A key is pasted into the chat - the page saves it
  and you never see it.

## What there is no screen for

No route emails all members or one customer, resends a confirmation or schedules a newsletter. Say so plainly; the
newsletter reaches the people signed up for email updates.
