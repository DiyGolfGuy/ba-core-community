# Choose and prepare your booking domain

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

Use a domain you control for your public BA Core booking page. This guide uses `example.com` for the main site and `book.example.com` for bookings. Use your own domain in Cloudflare and BA Core.

| What you have | Which steps to follow |
|---|---|
| No domain yet | Register a new domain below. |
| A domain with **Active** status in your Cloudflare account | Pick an unused booking subdomain and go to the tunnel guide. |
| A domain with another DNS provider | Prepare a copy of the DNS records, then follow the nameserver migration steps below. |

Your **registrar** manages the domain registration and renewal. Your **DNS provider** tells visitors and email services where to go. Your **tunnel** connects the booking address to BA Core. You can keep your existing registrar, website host, and email provider when you move DNS to Cloudflare.

## Register a new domain

1. Sign in to [Cloudflare](https://dash.cloudflare.com/) using an account you control. Verify the account email and enable two-factor authentication.
2. Open **Register domains** in the dashboard and search for the name you want. Choose **Purchase** on the available name.
3. Review the term, price, renewal date, and auto-renew setting. Enter your own registration contact details and complete the purchase.
4. Check your inbox for the registrant verification email and complete any verification requested. Keep the renewal details and registrar recovery information where you can find them.
5. Open the domain in Cloudflare and confirm the status is **Active**. Domains registered through Cloudflare already use its nameservers.
6. Choose an unused subdomain such as `book.example.com`. The tunnel creates the record when you publish the route. Continue to the [Cloudflare Tunnel guide](CLOUDFLARE-TUNNEL.md).

[Cloudflare’s domain registration instructions](https://developers.cloudflare.com/registrar/get-started/register-domain/)

## Use your existing domain

If Cloudflare already shows the domain as **Active**, open its **DNS → Records** page and make sure your chosen booking subdomain is unused. An existing record belongs to a service. Use another label such as `reserve` if `book` is already in use.

If your current nameservers are with another provider, schedule this change when you can test your website and email immediately afterward. If you can’t account for an existing record or don’t have access to the registrar, stop before changing nameservers. You can use a separate domain for BA Core and leave the existing domain’s DNS untouched.

### Copy and compare DNS before switching

1. Sign in to the current DNS provider. Export the zone records if possible. Otherwise, make a private list of each record’s name, type, value, priority if present, and proxy status where applicable. Record the currently assigned nameservers at your registrar. Note whether DNSSEC is enabled and keep access to the old zone until the new setup is verified.
2. In Cloudflare, open **Domains → Onboard a domain**. Enter the main domain, such as `example.com`, and follow the prompt to add DNS records and choose a plan.
3. Compare **DNS → Records** in Cloudflare with your private list. The automatic scan can miss records. Add missing records before changing nameservers.

| Keep working | Records to check |
|---|---|
| Main website | The main domain and `www` records, often `A`, `AAAA`, or `CNAME`. Preserve the destination and the website host’s required proxy setting. |
| Incoming and outgoing email | `MX` targets and priorities, any host records for those targets, SPF `TXT`, DKIM, DMARC, and any verification or auto-configuration records your email provider uses. Keep mail-only host records **DNS only**. |
| Other existing services | Every active subdomain, service discovery record, certificate record, and provider verification record. |
| BA Core booking page | Choose an unused label. The [tunnel guide](CLOUDFLARE-TUNNEL.md) creates the booking record after the Pi is ready. |

### Switch nameservers and check your services

1. If DNSSEC is enabled with the old DNS provider, follow the registrar’s instructions to disable it and remove the old **DS record** before switching nameservers. Wait for its removal to propagate. If you use `dig`, `dig +short DS example.com` should stop returning the old record. A stale DS record can cause lookup failures even if your DNS records were copied correctly. For a domain that must keep DNSSEC active throughout the move, use Cloudflare’s separate multi-signer migration procedure.
2. In the Cloudflare domain overview, copy the two nameserver addresses Cloudflare assigned to your domain. At your **registrar**, open the domain’s nameserver settings and replace the old nameserver list with exactly the assigned pair. Save. This step changes who answers DNS for the domain.
3. Wait for Cloudflare to show **Active**. If it stays pending, compare both nameserver addresses at the registrar and check for an old DS record. DNS caches can take time to refresh. If you have `dig`, use `dig +short NS example.com` as an additional check.
4. Open your main website and `www` address from outside your network. Send and receive a test email with an address outside your domain. Check any other existing subdomains you rely on. If something fails, compare its required records with your old zone and your provider’s instructions.
5. If you want DNSSEC after the move, enable it in Cloudflare **DNS → Settings** once the zone is active. If your registrar asks for a DS record, enter the **new** values Cloudflare provides and verify that DNSSEC is active. Cloudflare Registrar domains use its registrar workflow.
6. Keep your DNS export and a note of the old setup until the move is verified. Use the [Cloudflare Tunnel guide](CLOUDFLARE-TUNNEL.md) to publish only the chosen booking hostname.

[Cloudflare’s DNS migration instructions](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) · [Pending nameserver troubleshooting](https://developers.cloudflare.com/dns/zone-setups/troubleshooting/pending-nameservers/) · [Email DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/) · [DNSSEC migration](https://developers.cloudflare.com/dns/dnssec/validation-and-key-management/)
