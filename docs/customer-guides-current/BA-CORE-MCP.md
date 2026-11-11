# Owner Chat and your AI client

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

Open **Admin → Owner Chat → Continue setup** to work through the current checklist and opening checks. Use **Ask locally** for common tasks such as “how do I set up Stripe?” or “how do I restore a backup?” Move through the steps or download the relevant guide. You can also say “show hours,” “set hours from 9 AM to 10 PM,” or “set price to $35 per half hour.” If BA Core proposes a change, review the current and proposed values before choosing **Apply reviewed changes**.

## Optional hosted AI in Owner Chat

The Community Pi 5 installer includes this option. Test the connection on your Pi with your own API account and the model you plan to use. [Commissioning checklist](../RELEASE-REVIEW.md#commission-an-installation)

The selected model runs at OpenAI or Anthropic. The Pi sends requests over the internet using your API key. You can choose a larger text model if your API account has access to it.

1. Sign in as the owner using your HTTPS Admin address or the private SSH forward at `http://127.0.0.1:33001/admin`.
2. In **Owner Chat**, open **Hosted AI settings** and choose **OpenAI / Codex models** or **Claude**. The starting models are `gpt-6-luna` and `claude-haiku-5-5`. Enter a text model ID your API account can access, such as `gpt-6-astra` or `claude-opus-5-5`. Choose a thinking effort and output allowance supported by that model. For an organization-scoped Claude key, enter the workspace ID.
3. Enter your own provider API key and save. To change model, effort, or output tokens for the same provider, leave the key field blank to keep the saved key. Enter a new key when changing providers or rotating a key. If sensitive-action two-factor is enabled, enter your authenticator code when prompted. Usage goes through your provider API account and may incur charges. [OpenAI Platform API keys](https://platform.openai.com/api-keys) · [Claude Console API keys](https://platform.claude.com/settings/keys) · [Claude workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces)
4. Type a request in Owner Chat and choose **Ask hosted AI**. Open the suggested Admin location or guide below the reply to follow its instructions. If you asked for an edit, BA Core shows the current and proposed values. Choose **Apply reviewed changes** to save after reviewing them.

### Ask for help or make a change

| Try asking | What to review |
|---|---|
| “Walk me through setting up a Z-Wave booking PIN using my second Pi.” | The answer uses relevant installed guide sections and links to the Home Assistant and Door Access settings. |
| “Change House Lager to $5.00.” | Check the exact menu item, category, and price. Apply the edit and check the staff menu. |
| “Draft the homepage for our four-bay simulator lounge, with a Book a Bay button, a first-visit FAQ, and a draft About page.” | Review the headline, buttons, page copy, and layout before applying. Open **Website** to preview. Publish new pages separately when ready. Edits to a site that is already public can appear after you apply them. |
| “Keep bay equipment on through gaps up to 20 minutes.” | Check the proposed timing and test it with fictional bookings after saving. |

For longer setup tasks, name the device and the last step you completed in each question. The hosted model uses the installed guides and the current request to give you the next steps. When an edit needs a manual step such as pairing a physical reader or entering a provider credential, follow the linked screen and the guide.

Leave **Thinking effort** on **Provider default** to use the model’s usual behavior. Supported OpenAI models also offer **Pro** reasoning mode. Thinking and replies share the output allowance. A blank **Output tokens** field uses the OpenAI model’s default or 16,384 tokens for Claude. Enter the allowance you want within your model’s limits. Hosted requests can run for up to 30 minutes and show the complete reply when ready. Use the private SSH forward for long requests that may outlast a web proxy’s timeout. [OpenAI reasoning effort](https://developers.openai.com/api/docs/guides/reasoning) · [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)

Use the dedicated key field for credentials. The key lives in a separate owner secrets file on the Pi and is excluded from BA Core backups. After restoring on a fresh Pi, reconnect the provider from Owner Chat. Each hosted request is independent. BA Core searches all nine installed Markdown guides on the Pi and sends relevant excerpts and Admin locations with your request, booking hours, base price, and basic service status. For a menu, website, or facility timing task it also includes the relevant editable values. Keep customer details, door codes, passwords, and keys out of the message. The **Ask locally** button uses the Pi’s local Owner Chat commands.

## Connect Codex or Claude Code over SSH

This is a separate connection. Use your own Codex or Claude Code client to search and read the installed owner guides, check the Pi’s service health, or prepare a booking settings proposal. Sign in to your client as usual. The connector runs on demand over your existing SSH connection.

Use this setup after the Pi installer has placed the `ba-core-mcp` command at `/usr/local/bin/ba-core-mcp`. Run the AI client on your computer and keep the Pi’s SSH service on the trusted local network. Use an unprivileged Pi SSH account with no access to the BA Core state directory. First connect manually over SSH, verify the Pi’s host key, and confirm that your existing non-interactive SSH authentication works. The AI client runs the SSH command without a terminal or a password prompt.

Replace `ba-diagnostics@ba-core.local` with your own unprivileged SSH username and the Pi hostname. From your computer, choose the command for your client.

**Codex**

```sh
codex mcp add ba-core -- ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ClearAllForwardings=yes ba-diagnostics@ba-core.local /usr/local/bin/ba-core-mcp
```

**Claude Code**

```sh
claude mcp add --transport stdio ba-core -- ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ClearAllForwardings=yes ba-diagnostics@ba-core.local /usr/local/bin/ba-core-mcp
```

Open your client and use `/mcp` or the client’s MCP list to confirm `ba-core` is connected.

### Read the guides on the Pi

Ask, “Search BA Core’s installed guides for UniFi Access setup, then walk me through the next step in Admin.” The `search_owner_guides` tool finds relevant sections. The `read_owner_guide` tool reads any of the nine guide files by name and can continue at the returned offset. Ask the client to use these instructions when explaining where to click. The guides are the same Markdown content available in **Admin → Guides**.

### Check service health

Ask, “Use BA Core’s diagnostics tool to tell me whether the booking service and Cloudflare connector are running.” The `get_service_health` tool reads fixed service states and the local HTTP status. A typical response for a LAN-only install is `baCore: active`, `cloudflared: not-installed`, and `localHttpStatus: 200`. A redirect response can also indicate the local app is responding. A null HTTP status means the local probe received no response. Test the public hostname separately when you configure a tunnel.

### Prepare a booking settings change

Ask, “Use BA Core’s proposal tool to set opening to 9 AM, closing to 10 PM and the base price to $35 per half hour. Give me the line to paste into Admin chat.” The `prepare_booking_settings` tool produces a line like this.

```text
BA-CORE-PROPOSAL {"openTime":"09:00","closeTime":"22:00","pricePerHalfHour":35}
```

Copy the single line from the client and paste it into BA Core’s **Owner Chat** in Admin. Check the proposed values, then use its approval control if you want to apply them. The tool accepts both opening and closing times together in 24-hour format, the base price in USD per half hour, or both. For a price-only change, give the tool just the price.

### Prepare any Assistant action

Your AI client can also prepare the same actions the **Assistant** page offers: menu items and specials, website sections and pages, hours, prices, deals and packages, members and tiers, staff schedules, bay timing, messages, and more. Ask, “List what BA Core can do for the menu,” then “Prepare adding Root Beer for $3 to Drinks.” The client uses three tools:

- `list_owner_actions` lists actions by area or by words.
- `describe_owner_action` shows the values one action takes.
- `prepare_action` returns one line to paste.

```text
BA-CORE-ACTION {"name":"menu_items_add","args":{"part":"Drinks","items":[{"name":"Root Beer","price":3}]}}
```

Paste that line into the **Assistant** page in Admin (the Assistant button at the top). BA Core checks it against the same rules as a typed request and shows a card with exactly what will change. Nothing changes until you approve the card with your own sign-in. The tools only read a list of action names shipped with this version: they cannot read bookings, customers, settings or keys, and they cannot change anything on the Pi.

## The Assistant page

The **Assistant** button at the top of Admin opens a chat beside a live view of your site and screens. Plain requests such as “add Root Beer for $3 to Drinks,” “we’re closed Mondays,” or “take me to the schedule” are read by BA Core itself and work before you connect any AI. For longer or looser requests it uses the OpenAI or Claude model you connected in **Owner Chat → Hosted AI settings**. Every change arrives as a card to approve. Customers are shown to the model by first name and last initial only, and an API key pasted into the chat is removed before it is sent anywhere.

Keep the SSH connector on your trusted network and the customer tunnel dedicated to public booking traffic. Use hosted Owner Chat in Admin for supported menu and website edits, and use a separate development checkout for application code changes. [Customize BA Core with your AI](AI-CUSTOMIZE-CODE.md)

[Codex MCP setup](https://developers.openai.com/codex/mcp) · [Claude Code MCP setup](https://code.claude.com/docs/en/mcp)
