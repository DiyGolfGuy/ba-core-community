# BA Core · Ask Your AI

**From a blank Raspberry Pi 5 to your own booking site**

Built by BA Custom Products LLC, maker of simulator control boxes and bay software. [BA Custom Products](https://www.bacustomproducts.com/)

> Use fictional data during setup and test bookings. The Community Pi 5 installer includes optional hosted AI in Owner Chat. Test the live services and equipment you enable at your venue before opening bookings.

## 1. Start here

BA Core is a booking and facility management app. Your Pi runs the booking calendar, website, owner dashboard, database, and automation. A fresh install starts with a blank database and your own settings. BA Core Community needs no activation key, BA account, or provider credentials to install and complete first setup.

**Yes, you use SSH.** From your Windows, Mac, or Linux computer, you sign in to the Pi over your local network, copy the installer using `scp`, then run it on the Pi. A second SSH command opens the first-run wizard privately in your computer’s browser. Day-to-day bookings and settings use your browser.

Have the Pi 5, its storage and power supply, another computer on the same network, and the **Pi installer tarball and matching checksum**. The Pi needs internet access during installation to download its software dependencies. Get both files from the [BA Core Community Pi 5 download page](https://github.com/DiyGolfGuy/ba-core-community#start-with-one-bay).

| What you want to do | Where you do it |
|---|---|
| Prepare the Pi and copy the installer | Raspberry Pi Imager and a terminal on your computer |
| Run the installer | In a terminal signed in to the Pi over SSH |
| Configure BA Core for the first time | A private SSH connection from your computer to the Pi, then `http://127.0.0.1:33001/setup` in your computer’s browser |
| Run your facility after setup | `http://ba-core.local:3001/admin` on your local network |
| Book a session as a customer | Your public address once you publish it, such as `https://book.example.com` |
| Ask for help before the Pi is online | Give this Markdown file to Claude or Codex and tell it which step you are on |
| Finish the setup checks and learn common jobs | **Admin → Owner Chat → Continue setup** or **Ask locally**, with no API key |
| Use your own hosted AI from Admin | **Owner Chat → Hosted AI settings** |
| Let Codex or Claude Code check service health or draft a settings proposal | Your own AI client on your computer over the Pi’s private SSH connection |

**To the AI reading this file.** Walk the owner through one checkpoint at a time. First ask which section they are on, whether their computer runs Windows, macOS, or Linux, and what they see. Label every command with where it runs. Use the owner’s actual hostname, login name, and domain in examples once known. Explain what success looks like and wait for it before moving on. Use this manual and the guides shipped with the owner’s installer for BA Core instructions. For vendor screens that changed, use the official links in the relevant section. Mark proposed features as draft. Keep secrets out of the chat. Tell the owner where to enter a password, token, API key, or recovery code themselves. Use made-up booking data for examples and ask for redacted diagnostics.

A good first message to attach with this file:

> I have a Raspberry Pi 5 and a blank microSD card. My computer runs Windows. I want a two-bay staffed facility with Stripe payments and email confirmations. Walk me through step one, then wait until I confirm it worked.

### Which password or token goes where

| Credential | When to use it |
|---|---|
| Pi username and Linux password from Imager | At an SSH password prompt and when `sudo` asks for your Linux account password. If you configured SSH keys, your SSH client uses your private key to sign in. |
| BA Core owner password | Create it in the wizard. Use it later at `/admin`. |
| Authenticator code and recovery codes | Protect the BA Core owner account after you enable two-factor authentication. |
| Backup passphrase | Optional during first setup. Save it separately so you can decrypt an encrypted backup. |
| Your own Cloudflare tunnel token and provider keys | Enter only for the optional services you connect. Cloudflare’s token belongs in its `cloudflared` service-install command. Stripe, Resend, Twilio, or Home Assistant credentials go in their own BA Core settings. |
| OpenAI or Claude API key | For optional hosted requests, enter it in **Owner Chat → Hosted AI settings** over HTTPS or the private SSH forward. Codex and Claude Code use their own sign-in for the separate SSH connection. |

## 2. Image and boot the Pi

You’ll need a Pi 5, a suitable power supply, a microSD card or compatible SSD, a way to connect the storage to your computer, and a network connection. Raspberry Pi recommends its 27 W USB-C supply for Pi 5. The main path below uses a microSD card and wired Ethernet. A compatible NVMe SSD and M.2 adapter can be used instead. For that path, image the SSD in a suitable enclosure and follow the official NVMe boot-order instructions if the Pi fails to boot from it.

1. Install **Raspberry Pi Imager** on your computer. Insert your blank microSD card.
2. In Imager, select **Raspberry Pi 5**, **Raspberry Pi OS Lite (64-bit)**, and the correct storage device. Leave **Exclude system drives** enabled. The write erases the selected drive.
3. In OS customisation, set the hostname to `ba-core` and choose a username and password for Linux. This guide uses `baowner` as an example username. Write down the hostname and username. Set the correct localisation and time zone. Configure Wi-Fi if you’re using it.
4. Under **Remote Access**, enable **SSH**. Select public-key authentication if you have an SSH key configured. If you choose password authentication, use the unique Linux password you just set. This is separate from the BA Core owner password you’ll create later.
5. Review the drive selection, write the image, and wait for verification to finish. Eject the card, insert it into the powered-off Pi, attach Ethernet, then connect power.
6. Give the Pi a minute or two. On **Windows**, open **PowerShell**. On **macOS**, open **Terminal** under Applications → Utilities. On **Linux**, open your terminal app. Run `ssh -V` to check that the SSH client is available. If Windows says `ssh` or `scp` is unrecognized, enable **OpenSSH Client** in Optional Features, then open a new PowerShell window. On Linux, install your distribution’s OpenSSH client if needed.

**On your computer**, sign in. Replace `baowner` with the Linux username you chose in Imager.

```bash
ssh baowner@ba-core.local
```

If the name fails, find the Pi’s IP address in your router’s connected-devices list and use that in place of `ba-core.local` in every SSH, `scp`, and LAN browser example. Use the same local network as the Pi and avoid a guest network that isolates clients.

On the first connection, verify that the hostname or IP belongs to your newly imaged Pi before accepting its SSH host key. If you have a monitor attached, you can check the Pi’s Ed25519 fingerprint on its own terminal with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and compare it with the fingerprint SSH displays. At a password prompt, type your Linux password and press Enter. The terminal hides the characters as you type. When the prompt changes to something like `baowner@ba-core:~ $`, commands in that terminal run **on the Pi**.

**On the Pi, after SSH connects**

```bash
hostname
hostname -I
uname -m
dpkg --print-architecture
sudo apt update
sudo apt upgrade
```

Expect your chosen hostname, at least one local IP address, `aarch64`, and `arm64`. If you see a different architecture, recheck the 64-bit OS image before installing. Review any update prompt. If an OS update calls for a restart, run `sudo reboot`, wait for the Pi to start again, then reconnect from your computer. A DHCP reservation in your router can give the Pi a stable address. When you finish this check, type `exit` to return to your own computer’s prompt.

[Raspberry Pi Imager and headless setup](https://www.raspberrypi.com/documentation/computers/getting-started.html) · [Raspberry Pi SSH and SCP](https://www.raspberrypi.com/documentation/computers/remote-access.html) · [Windows OpenSSH Client](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse) · [Raspberry Pi OS downloads](https://www.raspberrypi.com/software/operating-systems/) · [NVMe boot](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#nvme-ssd-boot)

## 3. Install BA Core from the release tarball

**Use the installer tarball and its matching checksum.** The Pi installer is the named ARM64 tarball. GitHub’s automatically generated source archives do not serve as Pi installers.

1. On your computer, download `ba-core-pi5-arm64.tar.gz` and `ba-core-pi5-arm64.tar.gz.sha256` from the same build. Keep both files in the same folder and leave the `.tar.gz` intact.
2. Open a terminal **on your computer** in that folder. Use `cd` with the actual folder path in quotes, then use `ls` to check that both files are there. For example, if you saved both files in Downloads, run `cd "$HOME/Downloads"`. Run `scp` to copy the two files to the Pi’s home folder. Once both files finish transferring, use `ssh` to sign in again. Substitute your own SSH username and Pi hostname or IP address.

```bash
scp ba-core-pi5-arm64.tar.gz ba-core-pi5-arm64.tar.gz.sha256 baowner@ba-core.local:
ssh baowner@ba-core.local
```

3. In the **Pi’s SSH session**, verify the archive. The checksum should print `ba-core-pi5-arm64.tar.gz: OK`. If it fails, redownload both files from the same download page and copy them to the Pi again. Inspect the file list and look for the top-level `ba-core/` folder with `ba-core/install.sh` inside it.

```bash
cd "$HOME"
sha256sum -c ba-core-pi5-arm64.tar.gz.sha256
tar -tzf ba-core-pi5-arm64.tar.gz ba-core/install.sh
```

4. Still **on the Pi**, extract into a new staging folder and run the installer. The first command prints the folder path for your records. Run these commands in order, stopping if one fails. If `sudo` asks for a password, use your Pi’s Linux account password.

```bash
stage=$(mktemp -d "$HOME/ba-core-install.XXXXXX")
printf '%s\n' "$stage"
tar -xzf ba-core-pi5-arm64.tar.gz -C "$stage"
cd "$stage/ba-core"
sudo bash ./install.sh
```

The installer downloads the release’s pinned Node runtime, installs the app and dependencies, and starts the `ba-core` service as a dedicated, unprivileged Linux account. The running app and its data live under `/var/lib/ba-core/app`, separate from the extracted installer. The service is enabled to start after a reboot. The installer prints the SSH forwarding command for the next step. On first boot, the wizard listens only on the Pi’s loopback address. Your own SSH sign-in is how you reach it.

**On the Pi**, the service name is `ba-core`:

```bash
systemctl is-active ba-core
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/setup
```

Expect `active` and `200` on a fresh install. After the wizard is complete, `/setup` redirects to Admin. If the service fails, use `systemctl status ba-core --no-pager` and read its last messages with `sudo journalctl -u ba-core -n 60 --no-pager`. Share only redacted excerpts if you need help. Keep the extracted installer until the Pi passes the initial checks.

[Pi 5 installer download and checksum](https://github.com/DiyGolfGuy/ba-core-community#start-with-one-bay)

## 4. Open BA Core and run the setup wizard

From your computer on the **same local network**, open a **second** PowerShell or Terminal window. This starts at your computer’s prompt, even if the first window is still signed in to the Pi. Run this command with your Pi username and hostname or IP address.

```bash
ssh -o ExitOnForwardFailure=yes -N -L 127.0.0.1:33001:127.0.0.1:3001 baowner@ba-core.local
```

This forwards port `33001` on your computer to port `3001` on the Pi. Leave that window open. An empty terminal after SSH connects is expected. On **that same computer**, open `http://127.0.0.1:33001/setup` in your browser. Use the full `http://` address with `127.0.0.1` exactly as written. A phone or another computer has its own `127.0.0.1` and cannot use this forward. If port `33001` is already in use, choose another unused port and change the first port in the command and the port in the browser URL. Keep the public Cloudflare route unpublished during first setup.

Start with the services you actually need. A staffed counter can test reservations locally and take payment in person. A self-service facility should test the payment and door flows it will rely on before opening. If you choose hybrid access, configure staffed days and test one slot of each kind. For members-only booking, create and test a membership tier before inviting members. You can add optional provider accounts after the wizard.

| Wizard screen | What to put in |
|---|---|
| What Kind of Facility Is This? | Who can book, how customers get in, and whether they reserve one bay or the whole facility |
| Your Business | Name, contact info, and time zone. Choose a unique owner password of 8 to 256 characters and optionally a different backup passphrase of at least 10 characters. |
| Hours & Booking Rules | Facility time zone, hours, allowed booking lengths, booking window, and any between-session buffer |
| Your Simulator Bays | Customer-facing bay names and the bookable spaces you actually have |
| Pricing & Money | Base rates, relevant deposits, and the payment or tax settings you use |
| Choose Your Look | Logo, colours, and basic branding |
| Connect Your Services | Add the accounts you’re ready to connect, or leave them blank and connect them in Admin later. |
| Your Site’s Words | Booking page copy and instructions that match how customers arrive |
| Review & Launch | Review your choices and finish the wizard. The app starts with public booking closed. |

### Check the first launch on the local network

1. After finishing the wizard, allow a few seconds for the service to restart. On the same network, open `http://ba-core.local:3001/admin` or use `http://` followed by the Pi’s IP and `:3001/admin`. Sign in with the **BA Core owner password** you chose in the wizard. When the normal local Admin address works, you can close the temporary SSH forward with Ctrl+C in its terminal.
2. Choose **Walk me through setup** in the Admin Dashboard’s **Getting Started** card, or **Continue setup** in **Owner Chat**. Start with **Settings → Protection → Two-Factor Authentication**. Enrol your authenticator, save the recovery codes, enable sign-in and sensitive-action protection, and verify a fresh owner sign-in. Check the bay list, hours, and prices.
3. While the Cloudflare route is still unpublished, use **Website → What’s Public** to turn on **Booking**, then choose **Save What’s Public**. In a private browser window, go to the Pi’s LAN address with `/book` and make a reservation with fictional details. For a members-only facility, add a fictional member in **Members** first and use its member code. With live providers disconnected, check that the reservation appears in Admin, cancel it there, and verify the slot becomes available. Turn Booking off again and save. A signed-out browser should now see the holding page.
4. For a fresh-install reboot check, sign in to the Pi over SSH and run `sudo reboot`. Reconnect after the Pi starts, confirm `systemctl is-active ba-core` prints `active`, and sign in at the normal LAN Admin address. You can now proceed to the public tunnel guide.

## 5. Connect your own Cloudflare Tunnel

See [Choose or move a domain](DOMAIN-SETUP.md) for buying a domain or using one you own. The [Cloudflare Tunnel guide](CLOUDFLARE-TUNNEL.md) has the full setup and troubleshooting steps.

A tunnel lets Cloudflare send traffic for your public hostname to BA Core through `cloudflared` on your Pi. Use a domain in **your** Cloudflare account. If you have an existing website, use a spare subdomain such as `book.example.com`. If you’re adding an existing domain to Cloudflare DNS, confirm the current website and email records are in place before switching nameservers at the registrar.

1. In Cloudflare, open **Networking → Tunnels → Create Tunnel** and name it, for example `ba-core`. You can create the tunnel entry before finishing local setup. Wait until the local checks in Section 4 pass before publishing the route.
2. In **Setup Environment**, choose the Debian/Linux ARM64 instructions. Run the dashboard’s `cloudflared` install instructions on the Pi. Then use the service-install command from the dashboard. Its shape is shown below. Copy the real command from your own dashboard. The token lets someone run your tunnel, so keep it out of chat, screenshots, GitHub, and shared logs.

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
```

3. Check for **Healthy** in the Cloudflare dashboard. On the Pi, `systemctl status cloudflared --no-pager` should show the service running.
4. Open the tunnel’s **Routes → Add route → Published application**. Set the hostname to your chosen subdomain and domain. Set the origin service to **HTTP**, `http://127.0.0.1:3001`. Save the route. Visitors use `https://book.example.com`. The loopback origin is the Pi itself, where both services are running. This setup uses the outbound tunnel and needs no router port forward.
5. In BA Core, set the website’s public address to your exact HTTPS hostname. Use Admin’s settings search if you can’t find the address field. This is the address BA Core uses for customer-facing links and integrations.
6. Turn off Wi-Fi on your phone and open the public address over cellular. Confirm you see your site or the intended holding page. Check that the public `/setup` path never shows the wizard and that Admin requires sign-in. When you’re ready for an end-to-end test, open the booking pages temporarily and test the complete customer flow.

If you expose the tunnel token, rotate it in Cloudflare and update the connector. The Cloudflare token authorizes Cloudflare’s own service. BA Core itself has no activation key. The website’s public address and your LAN setup address serve different purposes. Use the LAN address for setup and local recovery.

[Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) · [Cloudflare DNS and nameservers](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) · [Tunnel tokens](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)

## 6. Connect services and test a full booking

Use the [services and equipment guide](SERVICE-SETUP.md) for detailed provider and device steps.

Enable only the services your facility needs. Open **Guides** in Admin for the detailed BA Core settings and hardware instructions shipped with your release.

| Feature | Where to start | What to prove before relying on it |
|---|---|---|
| Stripe payments | **Settings → Connections → Stripe – Payments**. Start with one matching Sandbox key pair. | Admin indicates test mode. A test checkout from your public site appears in BA Core and Stripe. If your workflow uses Stripe webhooks, check delivery for `https://book.example.com/api/stripe/webhook` in the same sandbox. |
| Email | Verify your sending domain in Resend, then configure BA Core’s email connection and sender. | A real test address receives the confirmation, any required access instructions, and the cancellation. |
| SMS | Use the [Twilio registration walkthrough](SERVICE-SETUP.md#twilio-text-messaging) if you want booking texts. It covers your own account, the shipped opt-in and policy pages, campaign samples, and the signed inbound webhook. | A consenting test recipient receives the intended messages and can get help or opt out. Verify email works with SMS unchecked. |
| Waivers | Use the Admin settings search for waivers and select the appropriate booking or check-in workflow. | A test customer can open and sign your chosen waiver. The signature is recorded with the booking. |
| Memberships | Open **Members** and set up a test tier. | A test member can book within the tier’s limits and pays the intended price. Test renewal and cancellation if you use recurring billing. |
| Doors and bay automation | Open **Bays & Devices** or search Settings for your provider. Add one bay and one device at a time. | A test access code works during its intended window. Test a booking start and end on site and confirm the equipment behaves as expected. |
| Counter and staff | Set up staff sign-in, then enable the counter features and equipment you need. | Staff can do their assigned tasks with their own sign-in and run a test sale or settlement. |
| Website | Open **Website** and use **What’s Public** to control which sections visitors can see. | The public site works on a phone off-site. Booking, contact information, and customer links lead to the intended pages. |

Before launch, check a complete booking and cancellation using a fictional customer. If you accept cards, use Stripe’s official sandbox test cards with test keys. If Stripe delivery reports a signature error, verify the endpoint’s signing secret and that keys, endpoint, and event all belong to the same Stripe environment. When moving to live payments, confirm the Admin mode and your live webhook configuration separately. A booking confirmation and a payment record are two separate checks.

[Stripe testing](https://docs.stripe.com/testing) · [Stripe webhooks](https://docs.stripe.com/webhooks) · [Resend domains](https://resend.com/docs/dashboard/domains/introduction) · [Twilio US A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)

For Windows bay PCs, follow the [Session Monitor installation guide](BAY-PC-SESSION-MONITOR.md).

## 7. Run, back up, and recover your facility

See the [operating and recovery guide](OPERATING-GUIDE.md) for daily workflows and a test restore. If you want to connect smart devices or a keypad lock through Home Assistant, use the [separate Home Assistant Pi guide](HOME-ASSISTANT-SECOND-PI.md).

Use **Dashboard** for what’s happening now, **Bookings** for reservations and changes, **Members** for access and tiers, **Bays & Devices** for equipment, and **Website** for the public pages. In Admin, use **About → Health** and the **Log** tab when a service or device misbehaves. If you lose internet access, try Admin from the same network as the Pi. The local app can still be reachable while the tunnel, payments, messages, or AI provider are unavailable.

- **Back up.** Use Admin’s Protection settings to set a backup passphrase and keep an encrypted copy off the Pi. Confirm that a recent copy exists and that you can find its passphrase. A CSV export is useful for records. For recovery, use the full backup for your release.
- **Test a restore.** Use a spare Pi or a separate test installation. Start in isolation, with outgoing integrations disabled or sandboxed. Follow the release’s restore instructions. Confirm bookings, settings, and uploaded files are present, then review domain, integrations, and device addresses before making any restored system public.
- **Upgrade.** Make a fresh backup, copy the newer release to the Pi, extract it into a new folder and run `sudo bash ./install.sh` from it. The installer keeps your settings, bookings and files, and puts the earlier version back by itself if the new one does not start. [Upgrade to a newer release](OPERATING-GUIDE.md#upgrade-to-a-newer-release)
- **After a restart or update.** Check LAN Admin, the public site from cellular, the tunnel and app services, one test booking, and the integrations your business relies on.

## 8. Fix common problems yourself

| What you see | What to check first |
|---|---|
| The Pi doesn’t show up in the router | Confirm power, storage, and Ethernet. Recheck the selected Pi model and OS image in Imager. If you used NVMe, check the official boot-order instructions in Section 2. |
| SSH can’t find `ba-core.local` | Try the Pi’s address from your router. Confirm both devices are on the same network and you’re using the username set in Imager. |
| SSH reports `Connection refused` or `Permission denied` | For refusal, check that SSH was enabled in Imager and that the address belongs to the Pi. For permission errors, check the Imager username and your chosen password or SSH key. |
| SSH reports that the host identification changed | Confirm the change on the Pi first. A reimage creates new host keys. After verifying the replacement, run `ssh-keygen -R ba-core.local` on your computer, substituting the exact hostname or IP used in the connection. |
| The setup page won’t load | Keep the forwarding terminal open and use `http://127.0.0.1:33001/setup` on that same computer. In a separate regular SSH session, check that BA Core is active and responds locally on port 3001. |
| The installer was interrupted | Inspect the installer message or service logs. Correct the problem, then run `sudo bash ./install.sh` again from the same extracted release. Preserve any existing app directory or data if the installer asks you to inspect it. |
| A release archive fails verification | Redownload the archive and matching checksum from the same download page. Check the filename and architecture before extracting anything. |
| The LAN site works and the public site fails | Check tunnel health, the hostname and origin in the Cloudflare route, and `systemctl status cloudflared --no-pager` on the Pi. Then test again over cellular. |
| The public site shows the holding page | Use **Website → What’s Public** to confirm what you’ve opened. Review the launch checklist before enabling public booking. |
| A test booking works but no email arrives | Check the verified sending domain, sender address, and Admin log. Then check delivery in Resend and the recipient’s spam folder. |
| Stripe reports a webhook signature error | Compare the signing secret for that exact endpoint and mode with the value in BA Core. See Section 6. |
| A bay PC or lock stops responding after a reboot | Check its local IP and network reachability, then check the configured address and provider in BA Core. Use an on-site test booking before relying on the device again. |
| A hosted AI request fails | Check the Pi’s internet connection and the selected provider, model access, and billing. Replace the key from **Owner Chat → Hosted AI settings** if needed. Use **Ask locally** for the local commands. |
| Your AI client can’t reach the Pi | First check your private connection and the AI client’s own sign-in. You can still use BA Core directly in your browser and attach this manual to a separate chat. |

If you need help, gather the BA Core version shown in **Admin → About** if available, the checkpoint that failed, the exact error with secrets removed, and what you already tried. Attach this guide and that summary to Claude or Codex. If Admin opens, ask **Owner Chat → Ask locally** about the service you are setting up.

## 9. Use your own AI

**Ask Your AI is this document.** You can attach it to an AI chat before the Pi is even powered on. The AI can walk you through commands and settings based on what you tell it you see. When asking for help, give it the last step that worked and the error with private details removed.

**Use Owner Chat on the Pi.** Choose **Continue setup** for one step at a time from your facility checklist. Use **Go to this setting** when shown, then reopen Owner Chat to resume. You can go back, say “I’m stuck,” or skip a step for now and return to it later. For a specific task, ask locally about Stripe, email, the website, a bay device, or backups. You can also say “show hours,” “set hours from 9 AM to 10 PM,” or “set price to $35 per 30 minutes.” Review the current and proposed settings and press **Apply this change** to save.

**Connect your own hosted AI.** Sign in as the owner over HTTPS or the private SSH forward and use **Owner Chat → Hosted AI settings** to choose OpenAI or Claude and save your own provider API key. If sensitive-action two-factor is enabled, enter your authenticator code when prompted. Usage goes through your provider API account and may incur charges. Choose **Ask hosted AI** to get answers based on the Pi’s installed guides, with shortcuts to the appropriate Admin screens. You can also ask it to update a menu price, draft website copy and pages, or propose a bay timing change. Review the proposed values before selecting **Apply reviewed changes**. Keep credentials, door codes, and customer details out of the message. [Hosted AI setup and data sent to the provider](BA-CORE-MCP.md#optional-hosted-ai-in-owner-chat)

**Use the Assistant for the hands-on work.** The **Assistant** button at the top of Admin opens a chat beside a live view of your site. It reads plain requests itself (“add Root Beer for $3 to Drinks”, “we’re closed Mondays”) and uses your connected OpenAI or Claude model for the rest. Every change comes back as a card you approve with your own sign-in; a key is never typed into the chat. After Admin is running, the [complete owner manual](OWNER-MANUAL.md) is the full reference for every feature and setting, and **Guides → Copy the manual** puts it on your clipboard for any AI.

**Connect Codex or Claude Code separately.** Sign in on your computer using the client’s own flow. The SSH connection uses **MCP**, a way for the AI client to call named tools, on your local network. Ask it to search and read the Pi’s owner guides, explain where to click, check service status, or draft a booking hours or base-price proposal to review in Owner Chat. [SSH guide, diagnostics, and proposal tools](BA-CORE-MCP.md#connect-codex-or-claude-code-over-ssh)

For code changes, use a separate development checkout and test with sample data before installing any change on your Pi. [Customize the code with AI](AI-CUSTOMIZE-CODE.md)

[Codex sign-in](https://developers.openai.com/codex/auth) · [Codex MCP](https://developers.openai.com/codex/mcp) · [Claude Code setup](https://code.claude.com/docs/en/setup) · [Claude Code MCP](https://code.claude.com/docs/en/mcp)
