# Operate and recover BA Core

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

Use this after the [Ask Your AI installation guide](EVERYTHING-ASK-YOUR-AI.md). Work through tests with a fictional customer and provider sandbox accounts. For automation and entry codes, use the [second-Pi guide](HOME-ASSISTANT-SECOND-PI.md).

## Launch in stages

1. From your facility network, open `http://ba-core.local:3001/admin` or use your Pi’s local IP. Sign in as owner and set up two-factor authentication. Store the recovery codes where you can get to them if you lose your phone.
2. Open **Settings → Booking → Hours & Booking Rules**. Confirm your facility time zone, hours, time increments, minimum and maximum session, and advance booking window. Try an after-midnight booking in a dummy bay if your facility offers those hours.
3. Open **Bays & Devices** and check which bays are active and how they are named. Start with one enabled test bay. In **Bookings**, make a dummy reservation and confirm that the same slot can’t be booked again. Cancel and verify the slot becomes available.
4. In **Website → What’s Public**, enable one section at a time. Review your site from cellular. Check the opening times, directions, customer booking links, and any policy links. Keep signups or public booking held until you have tested the services they depend on.
5. Test a complete customer booking and cancellation. If payments are connected, confirm the matching event or payment in the provider dashboard and the booking status in BA Core. If you use email or SMS, verify the notification arrives. If a booking grants entry, check the booking times and the actual keypad at the facility.

## Build your website

1. In Admin, open **Website**. Start with **Colors & Fonts**, then fill in the **Hero** section and point a booking button to `/book`.
2. Use **Page Layout** to arrange the homepage and **Pages** to create pages such as house rules or directions. Add the pages you want people to find to the navigation. Use **Show Preview** and check both a narrow and wide screen.
3. Save each section, then open **What’s Public**. Publish only the sections you’ve checked. Try your public link from a phone off Wi-Fi once your tunnel is ready. Click through to the booking and contact pages.

For an optional hero background video, sign in to the Pi over SSH, run `sudo apt install ffmpeg`, then retry the upload in the website editor.

## Run the counter with POS

### Set up a working counter

1. Open **Admin → Settings → Staff → Staff & Sign-In Codes**. Create a test employee and sign-in code. Under **The Counter**, choose whether to offer **Food & Drink**, cash, and checks. A staffed golf-only counter can keep Food & Drink off and still check in and collect for golf.
2. Open **Settings → Food & Payments → Point of Sale – Tax Codes**. Set the codes you use for simulator time and each food, beverage, or merchandise category. Verify the rates and whether the displayed prices include tax using a test sale.
3. In **Menu & Kitchen Routing**, add a category, pick its default tax code and print destination, then add a priced item. For example, add a **Drinks** category and an item called **House Lager** at **$5.00**. Choose **Bar** if a separate bar printer should receive it. Use the item-level choices or routing overrides where an item needs its own settings.
4. For a card reader, complete the [Stripe Terminal steps](SERVICE-SETUP.md#stripe-terminal). For receipts or kitchen/bar tickets, complete the [printer setup](SERVICE-SETUP.md#counter-and-kitchen-printers). Start with one payment method and one test order, then add hardware.

### Practice the staff flow

1. Open `/staff` on the counter device. Use **New booking** for a phone or walk-in reservation. For an order without golf, open a **Walk-in tab** when Food & Drink is enabled.
2. Find a booked party in **Tee Times** and check them in if your setup uses check-in. Open the tab, add a test item, and send it to the appropriate printer if configured. Check the total before taking payment. Settle by a method you enabled and verify the receipt.
3. Use **Admin → Revenue → End of Day** to compare the sale, tax, tender, and drawer count where applicable. Check the same charge in Stripe if you used a reader. Test a cancelled reader attempt separately and confirm the check stays unpaid.

For an existing menu item, you can also ask hosted Owner Chat “Change House Lager to $5.” Review the item, category, and old and new price, then select **Apply reviewed changes**. The new price is for future orders. Check the staff menu after applying. [Owner Chat guide](BA-CORE-MCP.md)

## Automate a bay around bookings

1. In **Admin → Bays & Devices**, open a bay and check that it is active. Start with a test lamp on a [direct Shelly plug](SERVICE-SETUP.md#direct-shelly-power) or [Home Assistant switch](HOME-ASSISTANT-SECOND-PI.md#run-bay-equipment-from-bookings). Set when it comes on, whether BA Core turns it off, and the after-session delay. Select **Save All Bays**. Test the device with its manual controls before scheduling it.
2. Under **Settings → Devices → Shutdown & Warning Timing**, review **Keep the bay on between groups (minutes)**. This gives nearby bookings a continuous run instead of an off/on cycle. Review the PC shutdown and watcher warning settings separately. **Bay Off waits for the PC** is the manual shutdown wait, separate from a device’s scheduled off delay.
3. Make a short fictional booking. Watch the lamp turn on at the lead time and off at the expected delay. Then try back-to-back bookings and bookings separated by a longer gap. Use **Log** and **About → Health → Automation** to compare the configured schedule with the physical result. Test a cancellation and verify the next legitimate booking still behaves as intended.
4. For facility-wide equipment shared across bays, assign the same physical device identity to each applicable bay. For Home Assistant, select the same entity ID. For a direct Shelly, use the same reserved IP. Use consistent timing and test with overlapping bookings in two bays. Confirm the equipment stays on while the other bay needs it. Keep the entrance lock under **Door Access Provider**, separate from bay power controls.
5. If the bay uses a Windows PC, [install its Session Monitor](BAY-PC-SESSION-MONITOR.md) and check the warning display separately. Set up Wake-on-LAN or graceful remote shutdown using the [Windows bay computer steps](SERVICE-SETUP.md#windows-bay-computers). Keep a PC’s smart plug powered while testing both. Add projectors, TVs, and other equipment one at a time after the test lamp works.

You can ask hosted Owner Chat to propose facility timing changes such as “Keep bays on for gaps up to 20 minutes.” Review the timing, apply it, and repeat your booking test. [Owner Chat guide](BA-CORE-MCP.md)

## Common jobs

| Job | In Admin | Check |
|---|---|---|
| Change hours, rate, or buffer | Settings → Booking | Reprice a sample slot, then check new availability on the booking page. |
| Block a bay for maintenance | Bookings | Confirm the customer calendar with the bay out of service. |
| Create a membership tier | Members | Check which hours are included, limits, and how extra time is charged with a dummy member. |
| Change the website | Website | Preview mobile, test buttons and navigation, then open the intended sections. |
| Train counter staff | Settings → Staff, then the staff page | Verify each staff member uses their own sign-in. Test the counter with an allowed payment method and a dummy sale. |
| Add a bay device | Bays & Devices | Run an on-site booking through start and end. Check the device and the log rather than relying on the preview alone. |
| Diagnose an outage | About → Health and Log | Identify which service stopped. Check LAN access before changing the tunnel, database, or an integration. |

## Back up and practise recovery

1. In Admin, search Settings for **Backup** and set a backup passphrase. Keep it separately from the encrypted backup. Download a full backup using the owner controls. Store an encrypted copy off the Pi and verify that the date and size are plausible. Keep important uploaded media separately if the backup summary lists it as excluded.
2. Keep the app version and installation instructions with the copy. BA Core and Home Assistant have separate backups. The Home Assistant backup does not replace your BA Core backup.
3. For a restore test, set up a spare Pi with this same version. Keep it on a test network without a public route or connected production equipment. Use a **synthetic backup** first. Sign in, open the restore control, and select the backup. The restore replaces the installation’s current records and settings.
4. After restore, check bookings, facility settings, waivers, and any uploaded media you expect. Review provider settings, scheduled automation, DNS, and the public hostname before connecting a restored system to real services. If the original and replacement Pi are both available, keep only one active for the facility.
5. Before an upgrade, take a fresh backup and read that version’s release notes. The installer upgrades an existing installation in place and puts the earlier version back if the new one does not start (see **Upgrade to a newer release** below). Try a new version on a spare Pi first if you can.

### Optional nightly copies to a USB drive or SD card

On the Pi, mount each backup device at its own directory directly under `/media/ba-core`, such as `/media/ba-core/backup-usb`. Leave the empty mountpoint owned by root and give the `ba-core` service account write access to the mounted filesystem. Confirm `findmnt --mountpoint /media/ba-core/backup-usb` shows the intended device. If you configure mounting at boot, confirm the device is mounted after reboot as well.

After creating the mount directory and mounting the device, run `sudo systemctl restart ba-core`. In **Settings → Protection → Backups**, set a backup passphrase, confirm the drive is detected, and select **USB stick in the unit** or **SD card**. Use **Copy to destinations now** to confirm Admin reports a successful copy and the device contains a `.baenc` file in `BA-Backups`. The app keeps its local backup when the extra device is unplugged.

## Upgrade to a newer release

BA Core Community has no automatic updater. You install a newer release yourself, on the Pi, with the same installer.

1. Take a backup first. In **Admin → Settings → Protection**, choose **Back up now** and download the encrypted copy to your computer.
2. Copy the new `ba-core-pi5-arm64.tar.gz` and its `.sha256` file to the Pi with `scp`, as you did for the first install.
3. On the Pi, check the download and extract it into a new folder:

   ```bash
   sha256sum -c ba-core-pi5-arm64.tar.gz.sha256
   mkdir -p ~/ba-core-new && tar -xzf ba-core-pi5-arm64.tar.gz -C ~/ba-core-new
   cd ~/ba-core-new/ba-core && sudo bash ./install.sh
   ```

4. The installer prepares the new release while your site stays up, then stops BA Core for a short moment, switches to the new release, and starts it.

Your settings, bookings, members, backups, waivers, uploaded photos, and the hosted AI connection are kept. If the new release does not start, the installer puts the earlier version back by itself and says so; nothing in your data is changed. After a successful upgrade the earlier version and a copy of its settings and database stay on the Pi under `/var/lib/ba-core/`. The installer prints their paths and the command to remove them once you are happy.

Running the installer again from a release that is already installed changes nothing.

## BroadLink infrared devices

BroadLink IR control needs two system packages, `python3-flask` and `python3-broadlink`. The installer adds them when Raspberry Pi OS offers them and starts the bridge as the `ba-core-broadlink` service. If they are not available it says so in one line and carries on; everything except the BroadLink cards works. Check the bridge with `sudo systemctl status ba-core-broadlink`.

## First checks during an outage

- **Admin is down on the LAN.** Verify Pi power, Ethernet and the local IP. Over SSH run `systemctl status ba-core --no-pager`. View recent messages locally with `sudo journalctl -u ba-core -n 60 --no-pager`. Share only redacted excerpts.
- **LAN works but the public address fails.** Verify the tunnel status and the route to `http://127.0.0.1:3001`. Test from cellular. Inspect the local Cloudflare service with `systemctl status cloudflared --no-pager`.
- **The public site works but an integration fails.** Check the relevant service’s own status and error first, then BA Core’s Log. Test one service or device at a time.
- **A storage failure requires a spare.** Bring up the tested replacement and restore your verified backup. Confirm the app and booking data before turning on the tunnel or automation. Re-image a failed drive only after preserving any data you need.
