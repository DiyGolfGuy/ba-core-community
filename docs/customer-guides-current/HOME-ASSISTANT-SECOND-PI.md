# Run Home Assistant on a second Raspberry Pi

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

Use this guide if BA Core should turn on bay equipment, adjust a thermostat, or issue booking PINs through a compatible Z-Wave keypad lock. BA Core runs on your booking Pi. Home Assistant OS, your device integrations, and any USB radio run on a second Pi. The two computers communicate on your private network. If you already have Home Assistant at your facility, start at [Connect BA Core](#connect-ba-core).

> **Ask your AI.** Attach this guide and the BA Core setup guide. Tell the AI whether you want bay automation, booking PINs, or both. Ask it to walk through one checkpoint at a time. Use fictional booking details when testing, and keep your real access token, Z-Wave security keys, keypad PINs, and backup files out of the conversation.

| Component | What it does |
|---|---|
| BA Core Pi | Runs bookings and decides when an assigned device should act. The booking website can use your Cloudflare Tunnel. |
| Home Assistant Pi | Runs Home Assistant OS and manages devices. The Z-Wave USB controller plugs into this Pi and talks to the keypad lock over Z-Wave. Keep its dashboard on the trusted local network. |
| Your lock, thermostat, or switch | Carries out the action. Check that each feature you need works in Home Assistant, then test it through a BA Core booking. |

## Image and start the Home Assistant Pi

You need a second Raspberry Pi 5 with power supply, wired Ethernet, a microSD card and reader, and a computer running Raspberry Pi Imager. Home Assistant recommends an A2 microSD card of at least 32 GB and a Pi with at least 2 GB of RAM. If you use a USB radio, plug it into the Home Assistant Pi when you reach the device setup. A radio is optional for IP-based devices.

1. Open Raspberry Pi Imager on your computer. Choose **Raspberry Pi 5** and **Other specific-purpose OS → Home automation → Home Assistant → Home Assistant OS for Raspberry Pi 5**. Select the microSD card for Home Assistant. Writing erases the selected card. Confirm it is the card intended for this Pi before you proceed.
2. Write the image, wait for Imager to finish, and eject the card. With the second Pi powered off, insert its card and connect Ethernet. Connect power last. The first boot needs internet access and can take several minutes.
3. On a computer on the same network, open `http://homeassistant.local:8123`. If the name does not resolve, find the second Pi in your router's connected devices and use `http://YOUR-HA-PI-IP:8123`. Verify which device you are opening if your network already has another Home Assistant instance.
4. On the welcome screen, choose to create a new Home Assistant installation and make your own administrator account. Check your facility's time zone and preferred units in the onboarding screens or system settings.
5. In your router, give the Home Assistant Pi a DHCP reservation so it keeps the same address after a reboot. Record that address and reserve the BA Core Pi's address too if you have network rules that reference it.

The Home Assistant browser setup does not need the BA Core installer or the BA Core Pi's SSH commands. Keep the two storage cards labelled so you can distinguish them later. [Home Assistant installation on Raspberry Pi](https://www.home-assistant.io/installation/raspberrypi/) · [Home Assistant onboarding](https://www.home-assistant.io/getting-started/onboarding/)

## Connect BA Core

1. In Home Assistant, sign in with an administrator account. Open your **profile → Security → Long-lived access tokens → Create Token**. Name the token something identifiable, such as `BA Core booking Pi`. Copy it directly into the BA Core settings or your password manager. Home Assistant shows it once. To rotate it, create a replacement, save and test it in BA Core, then revoke the old one in Home Assistant.
2. In BA Core, open **Admin → Settings → Devices → Home Assistant – Smart Devices**. Set **Enable Home Assistant** to **Yes**. Enter `http://homeassistant.local:8123` or the Home Assistant Pi's reserved LAN address with `http://` and port `8123`. Paste the token into **Long-Lived Access Token**. During initial BA Core setup, the same connection can be entered under **Connect Your Services → Bay Automation**.
3. Click **Test Connection**. Expect a connected message and an entity count. Then save. If the URL works in your browser but the BA Core test times out, check whether the two Pis are on networks that can reach one another. For separate VLANs, allow the BA Core Pi to reach the Home Assistant Pi on its configured API port and use the reserved IP if local names do not resolve across the VLANs.
4. Use the LAN address directly. A Cloudflare login page or other browser-only sign-in page will not serve the API. The stock local HTTP address is for a trusted network. If you already use HTTPS locally, use a name and certificate the BA Core Pi trusts.

This is a credential issued by your own Home Assistant, used only for this optional integration. The token carries the Home Assistant account's permissions. An administrator token is needed for the keypad arrival events described below. Keep the token in BA Core settings and secure backups. [Home Assistant access tokens](https://contributors.home-assistant.io/core/internals/auth-api/#long-lived-access-tokens)

## Run bay equipment from bookings

First add and test each device in Home Assistant. If Home Assistant cannot reliably operate it from its own dashboard, fix that connection before assigning it in BA Core.

1. In **BA Core Admin → Bays & Devices**, open a bay and find **Home Assistant Devices**.
2. Select **Discover Entities**, then **+ Add HA Device**. Give the device a readable name and choose its exact entity ID. Example names are `switch.demo_bay_lamp`, `light.demo_bay_spots`, and `climate.demo_room`.
3. Choose **Power** for an on/off device. Set when it should come on, whether it should turn off automatically, and how long to wait after the session. Start with a harmless load such as a test lamp. Choose **Climate** for a thermostat. Enter comfort temperature, separate heating and cooling idle temperatures, the lead time, and the setback delay. Use the temperature unit shown in your Home Assistant.
4. Select **Save All Bays**. Test the bay's manual On and Off actions from BA Core's Dashboard when it is safe to run the bay. Then create a fictional test booking and watch for both the start and end actions at their configured times. Verify the physical device and the BA Core Log.

A thermostat uses the heating or cooling setpoint for its current mode. In heat/cool mode BA Core sends a range. A thermostat set to Off, Fan Only, or Dry is left in that mode. A device shared across bays can use the same entity ID on each bay. Test with overlapping bookings to verify the device stays active while another bay still needs it. For a switch already managed by another Home Assistant automation, check which rule should control it to avoid conflicting actions.

**Keep entrance access separate from bay power.** A `lock.*` entity assigned as a bay Power device can be directly unlocked and locked by a bay action. A `cover.*` entity can be opened and closed. To give customers timed PIN access at the entrance, use the **Door Access Provider** flow below. Leave the entrance lock out of the bay power list.

## Set up Z-Wave booking PINs

Skip this section if staff let customers in, or if your facility uses a different door provider. A Home Assistant lock tile that can lock and unlock proves basic control. Booking PINs also need a compatible keypad lock that reports PIN management through Z-Wave JS.

For the local alternative to RemoteLock, use **BA Core on the booking Pi → Home Assistant on the second Pi 5 → Z-Wave USB adapter → keypad lock**. BA Core sends the PIN request across the local network, and Home Assistant writes it to the lock over Z-Wave.

The tested reference setup uses a **Zooz ZST39 LR** USB controller and a **Yale YRL216/YRL236-series** keypad lever with a Z-Wave module. The tested lock joined with **S0 Legacy** security. The bench check programmed and cleared a test slot, observed keypad unlock, and checked reconnection after reboot. Pair your own lock with the secure mode it supports, then do the separate BA Core booking test below.

### Pair and test the lock in Home Assistant

1. Use a supported Z-Wave USB adapter and lock for your region. Plug the adapter into the **Home Assistant Pi**. In Home Assistant, accept its discovered **Z-Wave** integration and choose the recommended installation. On Home Assistant OS, this sets up the **Z-Wave JS** app, previously called an add-on. If the adapter does not appear, use the adapter and discovery troubleshooting in the official Z-Wave guide.
2. Go to **Settings → Connectivity → Z-Wave → Add device**. Follow the lock maker's procedure and use SmartStart if the lock supports it. For a lock, pair with the secure mode the lock supports. Use S2 where supported. Older keypad locks that require encryption can use S0 if that is the secure mode the manufacturer supports. Keep QR codes, pairing PINs, and network keys private. An already paired lock may need proper exclusion from its old network before inclusion.
3. Wait for the Z-Wave interview to finish. Record the lock entity ID, for example `lock.demo_entry`. With someone at the door and a physical way back in, test Lock and Unlock in Home Assistant. Check the lock's PIN length and usable code slots from the device details or manufacturer guide.
4. In Home Assistant's **Developer tools → Actions**, run **Z-Wave: Set lock user code** on a known free slot with a temporary PIN. Try the PIN at the keypad. Run **Z-Wave: Clear lock user code** for that slot and confirm the keypad rejects the old PIN.

[Home Assistant Z-Wave setup, inclusion and troubleshooting](https://www.home-assistant.io/integrations/zwave_js/#getting-started) · [Z-Wave secure inclusion](https://www.home-assistant.io/integrations/zwave_js/#should-i-use-secure-inclusion)

### Assign booking slots in BA Core

1. Confirm the Home Assistant connection above is working with an administrator's token. In **BA Core Admin → Settings → Devices → Door Access Provider**, select **Home Assistant (Z-Wave lock, no cloud)**. Select the lock and refresh the list if you paired it recently.
2. Reserve a **Booking slots from / to** range and a separate **Backup code slot** within the lock's supported capacity. The UI suggests slots 10 through 29 and backup slot 30. Use those numbers only if your lock has them and they are free. Move existing staff or maintenance codes outside these reserved slots before testing. BA Core can clear codes it finds in its reserved slots on the User Code path.
3. Tell customers which keypad button submits a PIN. Leave **How codes are written** on **Decide from what Home Assistant answers**. Keep member PINs off until single-booking PINs pass the full test. If using member PINs later, test them within the booking window and with consecutive reservations.
4. Review the booking code preparation, notification, and expiry timing. A PIN on this type of lock can open the door as soon as the lock has it. With advance preparation on, BA Core can set the PIN before it sends the message. Notification timing and physical lock availability are separate. Leave the confirmation option on while testing.
5. Save and press **Test the lock**. Confirm it sees the selected lock, can manage PINs, and can subscribe to keypad events with your administrator token. BA Core can use a supported **User Code** path with physical slot readback or the newer **credential actions** on compatible locks. Treat the result as the path for this lock. If the result says the lock cannot manage codes, leave customer PIN access off until you have compatible hardware or choose another provider.
6. Once the lock passes, use **Set a new backup code now** to prepare the reserved backup slot. Arrange a physical key or staffed fallback while testing. A fallback PIN can only work if it was already written to a working lock.

### Prove the entire door workflow

- [ ] Keep the site closed to public test traffic. Use a fictional booking and an email address or phone you control. Choose a start time that lets you observe code preparation and delivery.
- [ ] In BA Core's **Log**, check that the code was created and confirmed. On the User Code path, look for `DOOR_CODE_HELD`. Verify that the intended notification reached your test inbox or phone.
- [ ] Type the PIN on the physical keypad and check that the door opens. Confirm that BA Core records the keypad arrival in **Bookings** or in the Log, usually as `DOOR_ARRIVAL`.
- [ ] Cancel a test booking or let its door window expire. Confirm revocation in the Log and try the old PIN at the door. Repeat both cancellation and expiry before using unattended entry.
- [ ] When there are no visitors to strand, restart the Home Assistant Pi. Recheck the connection and lock, and use a new test booking to verify code issuance, arrival, and revocation. If you test an outage, have a physical entry method and reconnect everything before resuming public access.

Use the real keypad and the on-site checklist to verify your installed lock, firmware, radio, network, and settings.

## Troubleshooting and recovery

| What you see | What to check |
|---|---|
| Home Assistant page will not open | Verify the HA Pi has finished booting, has Ethernet and a DHCP address, and is reachable from the same network. Try its LAN IP and port 8123. |
| BA Core says unauthorized or 401 | Confirm the URL belongs to the correct Home Assistant instance. Create and test a replacement token. Keep it out of diagnostics you share. |
| BA Core says that the address answered but did not return the API | Confirm you used the LAN Home Assistant base URL, without a dashboard path, login portal, or `/api` suffix. |
| Connection works but a device is missing | Check the integration and entity in Home Assistant first. Confirm it is enabled and available, then save the connection and rediscover in BA Core. |
| Lock can open in Home Assistant but BA Core cannot issue a PIN | Check Z-Wave pairing and security, the chosen lock entity, its supported PIN length and slots, and **Test the lock**. A generic Home Assistant lock integration may only support lock and unlock. |
| Codes work but arrivals are absent | Use **Test the lock** to check the token's administrator status, then test from the keypad. A manual unlock in the Home Assistant UI is different from a keypad event. |
| HA or lock goes offline | Check **About → Health → Door codes**, BA Core's Log, and the Z-Wave device in Home Assistant. BA Core can retry outstanding door jobs after recovery. A code already stored on a lock can remain usable while the lock is unreachable. Check that revocation completed after recovery. Full slot reconciliation applies to the User Code path. |
| No fallback message arrives | Check whether the backup slot was previously programmed and whether your notification provider and owner alerts work. Keep the physical access plan available. |
| A thermostat stays idle or uses the wrong unit | Confirm the entity is reachable and in the intended HVAC mode. Check Home Assistant's temperature units and the two idle setpoints. |

Back up the two systems separately. Keep the BA Core backup off the booking Pi. In Home Assistant, create and download a Home Assistant backup and retain its emergency kit or recovery key securely. If you use Z-Wave, follow the adapter backup procedure and securely retain the network keys. A BA Core restore brings back the booking settings. Home Assistant, its radio network, and the lock have their own recovery procedures. After either system is restored, verify addresses, credentials, manual device control, and a fresh test booking before using unattended entry.

[Home Assistant backups](https://www.home-assistant.io/common-tasks/general/#backups) · [Z-Wave network backup and restore](https://www.home-assistant.io/integrations/zwave_js/#backing-up-your-z-wave-network)
