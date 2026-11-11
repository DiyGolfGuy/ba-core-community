# PLAYBOOK: Bay automation - bays that turn on and off with bookings

What follows each booking by itself: the bay's power (smart plugs, or devices on the unit's smart-home hub), its PC
(woken before the session, shut down after), its projector or TV (by infrared or the hub), and climate. Everything is
set per bay in Admin > Bays & Devices; much of it the assistant does by talking. Power follows bookings from the moment
a bay has its devices.

## Bays that turn on before a booking - "turn the bays on by themselves", "power on before the session", "automation"

How it behaves, in words the owner can check: each bay powers on ahead of the session (10 minutes before, by default,
per device) and off after it ends: the PC is told to shut down at the end, and each plug, TV and smart-home device goes
off at its own minutes after. The plug a PC runs from should be set to stay on (Windows shuts down first; the Bay Off
button waits for the PC, the after-session timing does not). Back-to-back bookings keep the bay on across short gaps.
Each device goes on its own: one that does not answer never stops the others, and it is retried and shown on Admin >
About > Health (Automation) - a Shelly plug that drops off the network is named there within minutes.
Lead the owner through, one bay at a time: the plugs or hub devices, then the PC, then the projector or TV.

## Smart plugs (Shelly) - "set up the smart plugs", "the plug", "outlet", "power strip"

The plugs join the facility's Wi-Fi in the Shelly Smart Control app; the guide chapter "Setting Up Smart Power" walks it
(guide_chapter "smart power"), one part at a time. The parts that matter most:
1. The plug's login stays OFF in the Shelly app (the unit sends no password).
2. A FIXED address for every plug: a DHCP reservation in the router (the number-one cause of a plug that stops working
   weeks later). Then network_scan finds the plugs and their addresses.
3. bay_plug_add puts a plug on its bay (said back first). The plug that feeds the bay PC is set to stay on (Wake-on-LAN
   needs it); every other plug turns off after the session.
4. The plug's own power-on default in the Shelly app: "On" for the PC's plug, "Restore last state" for every other.
5. Test it: plug_switch on, then off (turning off is said back first). Then one real test booking a few minutes out.
6. A plug renamed, or at a new address after a router change: bay_device_set. Taken off a bay: bay_plug_remove.

## Devices on the unit's own hub - Z-Wave, Zigbee, Matter plugs, switches, thermostats

smarthome_read first: the hub, every device paired and which bay each is on. bay_device_remove takes one off a bay, so it no longer
follows that bay's bookings (the device stays paired).

Home Assistant runs on the owner's own second Raspberry Pi (the Home Assistant guide in Admin > Guides sets it up); this
unit reaches it over the building's network with the address and token saved in Settings > Connections. If
smarthome_read says it is not connected, that guide comes first. Then, per device:
1. device_pair with the kind (zwave, zigbee or matter - it says on the device or its box; Matter needs its 11-digit
   pairing code). The chat shows the owner what to press.
2. Ask what it is, and whether it is for one bay or the whole facility: device_name_set ("Bay 2 Projector", "Lobby
   Thermostat"), then bay_device_add for one bay - power (on a few minutes before each session, off after) or climate - or
   facility_device_set for the whole building (below). A thermostat is the facility's unless the owner says that bay has
   its own.
3. Offer a test: device_switch on, then off.
The assistant never locks or unlocks a door; doors open with the booking's code.

## The whole facility - "the heat and AC", "the thermostat", "the TV in the lounge", "the lobby lights", "the sign"

A facility device follows the whole building, never one bay: it comes on before the first booking in ANY bay, stays on
while the next booking anywhere starts within its gap, and goes to standby when nothing is booked inside the gap - off, or
a thermostat to its idle temperature for the mode it is in (heating or cooling). One bay's session ending never turns down
the heat or turns off the game on the lounge TV. facility_device_set adds one or changes one already there; ask one
question at a time:
1. How early it comes on before the first booking (minutes_before): a thermostat needs time to warm or cool the room.
2. How long a gap between bookings keeps it on (keep_on_gap): "if nothing is booked for three hours, turn it down" is 180;
   "turn the TV off when nothing is booked within an hour, back on ten minutes before the next" is keep_on_gap 60 with
   minutes_before 10. Without a number from the owner: a thermostat 180, a TV or lights 60. 0 is standby as soon as each
   run of bookings ends.
3. A thermostat's temperatures: comfort while bookings are on, and standby - idle_heat_temp while heating (below comfort),
   idle_cool_temp with the AC on (above comfort; left out, it mirrors the heating one above comfort).
4. Or it follows the opening hours instead (follows "hours") - a staffed place that is heated whenever it is open.
A device on the facility is not also on a bay: take it off the bay first (bay_device_remove). smarthome_read says what each
facility device is doing now and why ("on - the booking at 6:00 PM (Bay 2)"). facility_device_remove takes one off.
"Set the lobby to 68" now: thermostat_set (for the mode the thermostat is in); its schedule sets it again at its next change.
A facility device that does not answer never stops a bay's own devices or another facility device: each one goes on its own,
and one that failed is retried and shows on the health line.

## The bay PC - wake it before the session, shut it down after

bay_pc_signin_set saves the PC's Windows ADMIN user name; the owner types its password in the page's own private box - you
never see or ask for it.

- network_scan lists the PCs on the network by their own names; ask which bay each is in, then bay_pc_link with its
  address and its wake ID (the MAC address from the scan). Said back first. The bay shuts its PC down through the PC's
  address WITH the PC's Windows ADMIN user and password: bay_pc_signin_set saves the user (and the address), and the owner
  types the password in the chat's own private box. Until a password is saved, bay_pc_link saves only the wake ID, so the
  bay never tries a shutdown Windows would refuse.
- The timing for every bay is on Admin > Settings > Devices > Shutdown & Warning Timing: Enable Auto-Shutdown, Restart
  the PC before the next group, Keep the bay on between groups (minutes, 30 by default), Bay Off waits for the PC
  (seconds, 90), and the watcher's warning minutes (10).
- Remote shutdown needs Windows prepared once per PC: two accounts (an ADMIN with a non-blank password, the PLAYER that
  signs itself in), remote shutdown allowed, a fixed address. That is the guide's "Setting Up Your Bay Computers"
  chapter (guide_chapter "bay computers") - walk it part by part.
- Wake-on-LAN works ONLY through the motherboard's onboard ethernet port (a USB adapter or Wi-Fi cannot wake a PC that
  is off): wake on in the BIOS ("Resume by PCI-E Device" or similar), Fast Startup off in Windows, the MAC of the onboard
  port entered on the bay, its address re-reserved against that MAC. Part 5 of the bay computers chapter.
- "Wake PC - minutes before session" (10 is a good default) is on the bay's row in Admin > Bays & Devices. The best
  arrangement: the PC's plug left on AND the MAC entered - the wake packet boots it, the shutdown is graceful.

## Projectors and TVs - "set up the TV", "the projector doesn't turn on", "the TV should turn off after"

- By infrared: a BroadLink RM4 Pro on the Wi-Fi with a fixed address (a reservation in the router, like the plugs).
  tv_remote_find lists the BroadLinks on the network and which bays each is on; bay_tv_add puts the TV on its bay (said
  back first). Ask what it is ("TV", "Projector") and whether its own remote has one power button or separate ON and OFF.
- Then its code, from the TV's own remote: bay_tv_learn. Tell the owner before they tap Apply: point the remote at the
  BroadLink and press the button within about five seconds. The code is saved on the bay in the same step.
- Most remotes have ONE power button that toggles: it is learned once and used for on and off, and the unit keeps track
  of whether the TV is on, so a second press never switches it back. Only a remote with truly separate ON and OFF buttons
  is set that way (separate_buttons) - then its ON and its OFF button are learned one at a time.
- Try it: bay_switch on, then off (turning off is said back first). bay_ir_test sends one code, only for a TV with
  separate buttons.
- Renamed, at a new address, or one power button after all: bay_device_set. Taken off: bay_tv_remove (its codes go too).
- Or by the hub, when the TV or projector has a Z-Wave, Zigbee or Matter plug or a Home Assistant integration: pair it
  and put it on the bay (previous section).

## Routines on a bay's PC - "watch me", "teach it to start GSPro", "sign back in to Uneekor", "keep the connector running"

What the owner shows once on a bay's PC, the PC does again by itself: start the simulator and get it to the range, sign a
launch monitor back in when it signs out, reopen a program the players closed. Lead it like this:
1. routine_teach with the bay and a name for what it does. Before they tap Apply, say how teaching works on the PC: a bar
   across the top; click through the way they always do; Ctrl+Shift+F11 to finish, Ctrl+Shift+F10 to stop. Ask them to
   start with the program closed if the routine should open it. The bay's watcher must be one downloaded after this
   update (bay_watcher_download) - offer it first if the owner is not sure.
2. A password is NEVER said or typed in this chat. At a password box on the PC they press Ctrl+Shift+F9 and type it into
   the PC's own box: it is kept on that PC only, under Windows' own protection, and the routine types it from there. If
   they start telling you a password, stop them and say this.
3. routines_read shows the steps once they come back. Read them back in a line or two. For the clicks that have words,
   ask once: click them by their words (it waits for them to show and clicks them wherever they are - it keeps working
   when a button moves) or by their spot? By their words is the better answer unless it is an icon with no words. Change
   any one step with routine_step_set (by its words or its spot, a longer wait, a key press, the kept password).
4. routine_save with when it runs - ask, one question: when a session starts (on_session_start; minutes_before_session if
   they want it ready earlier - five unless they say), when a session ends - to set the bay back for the next player
   (on_session_end; it runs before the next session's own routine), every day at a time (every_day_at: "3:00 AM" -
   a nightly reset, the programs up at opening), when the PC starts (on_windows_start), when a program
   opens (when_program_opens), when a program closes - to keep it running (when_program_closes), when a window appears - a
   sign-in screen (when_window_appears), a hotkey (hotkey), the staff pad (staff_pad, on unless they say not), or only when
   asked. Several at once are fine. Offer a colour for its staff pad button (colour: green, red, navy ...).
5. Offer a test: routine_run (said back first, and it names a session playing there - the clicks happen on their screen).
   routines_read says how it went; a run that stopped names its step and why ("the GSPro window did not appear").
Everything about a routine can change by talking (routine_when_set): when it runs, its name, its COLOUR on the staff pad,
and paused or running (paused: nothing starts it but the owner, and it leaves the staff pad). "Make the Start GSPro button
green" is routine_when_set colour - never the website's colours. Steps: routine_step_set (by its words or its spot, a
wait's seconds, moved up or down, taken out, or a wait, a key, words typed, the kept password or closing a program added
after a step). The same Bay Routines card on Bays & Devices does all of it.
More than one bay: routine_copy puts a routine on other bays ("copy it to every bay" - to: ["all"]). A routine only opens
or closes a program that PC was shown, so a copy names the bays whose PC has not been shown it (its_pc_not_yet_shown in
routines_read): routine_teach with program shows it - the bar on that PC says to open it once.
A routine with no clicks and no program to open can be made from words: routine_create ("close
GSPro when each session ends", "press Escape twice then wait 3 seconds"). Anything with a click is shown on the PC.
A trigger on the PC runs a routine at most once a minute and five times an hour; past that it stops and the owner is told.
routine_remove takes one away.
What you can do here: teaching, naming, the steps read back, spot or words, changes to a step, when it runs, its
colour, pausing, copying, routines without clicks, why a run stopped - whichever hosted model answers. Not something this
unit does, whichever model answers (there is no tool for it): a routine with
clicks built from words alone with nothing shown, a routine with "if this, otherwise that", finding an icon with no words by
how it looks, working out a routine an update broke by looking at the screen. Say so plainly when they ask for one, and offer
to teach it by showing instead (routine_teach) - teaching it again also mends one an update broke.

## Something isn't turning on or off - "the bay didn't come on", "the plug isn't working"

1. health_read: the Automation line names a device that is not answering.
2. A plug: plugged in, on the Wi-Fi, at the address entered (the reservation), its login off. Test from its row.
3. The PC did not wake: its plug must stay on, Wake-on-LAN on in BIOS and Windows, the MAC entered on the bay.
4. The PC did not shut down: the ADMIN account's password is set and entered on the bay, remote shutdown allowed.
5. Still stuck: the guide's "If Something Doesn't Work" (bay computers) and "Troubleshooting".

## Running the bays now - "turn bay 2 on", "shut everything down", "bay 3 is broken", "restart the PC in bay 1"

- bay_read: every bay at a glance - a session on and until when, the next one today, in or out of service, its PC, its
  plugs, TV remotes and smart-home devices with their timing, and anything that did not work.
- A whole bay on or off now, exactly as at a session's start or end: bay_switch (off shuts the PC down first, then the
  rest; a device set to stay on is left on). Every bay: all_bays_switch (an out-of-service bay stays dark on All On).
  Turning off is said back first, and names a session playing there.
- One thing in a bay: device_switch (a smart-home device) or plug_switch (a Shelly plug).
- Out of service and back: bay_service_set - customers cannot book it and its equipment stays off; bookings already made
  stay (say how many). For a few hours, a block on the bookings side fits better (block_add).
- The PC: bay_pc_restart (a normal Windows restart), bay_pc_wake (wake just the PC), bay_power_cycle (cut the bay's power
  for a few seconds - only for a frozen PC that will not restart). bay_close_override_set keeps a PC on past closing once.

## When something did not switch - "did anything fail", "the projector didn't come on", "try it again"

automation_read lists what the automation could not do lately - per bay and session time, each with a short job code -
and automation_retry tries one again (or every failed one on a bay). A device that is not set up is never a failure.

## Setting the bays up - timing, plugs, remotes, names, a new bay

- When each device comes on before a session and goes off after: bay_device_timing_set (a plug, a TV remote, a smart-home
  device, a thermostat, or the PC's wake-up). The Shutdown & Warning Timing for all bays: bay_timing_set.
- A plug off a bay: bay_plug_remove. A TV remote's learned code tested: bay_ir_test (only for a remote with separate on and
  off buttons - a one-button remote is never pressed from here).
- A bay's name, tagline and feature chips: bay_details_set (rebuild its watcher after a rename). A premium or cheaper bay:
  bay_price_adjust_set. A new bay: bay_add (bookable at once, or kept out of service until it is ready).

## Taking a bay off for good - "we got rid of bay 4", "remove the old bay"

bay_remove takes a bay off with its devices - refused while it has bookings still to come (move or cancel them first); past
bookings keep its name. To close it for a while instead: bay_service_set, or a block.
