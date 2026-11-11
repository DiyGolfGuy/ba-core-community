# Put BA Core online with your Cloudflare Tunnel

Built by BA Custom Products LLC. [bacustomproducts.com](https://www.bacustomproducts.com/)

Follow this guide after you can sign in to BA Core on your local network. The examples use `book.example.com` as the public address. Replace it with your own booking hostname. Keep the default BA Core port `3001` unless you deliberately changed the installation.

## 1. Check BA Core on the Pi first

1. Complete first setup over SSH, then sign in to the BA Core owner dashboard from your local network. Turn on owner two-factor authentication and save your recovery codes privately. Use [Ask Your AI](EVERYTHING-ASK-YOUR-AI.md) for the installation and setup steps.
2. Make and cancel a fictional test booking. In **Website → What’s Public**, keep customer booking on the holding page until you are ready for the off-site test.
3. SSH into the **BA Core Pi** and run the checks below. The OS architecture should print `arm64`, the service should print `active`, and `curl` should show an HTTP response. Fix a local connection failure before adding a Cloudflare route.

```bash
dpkg --print-architecture
systemctl is-active ba-core
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/
```

You also need an **Active** domain in your own Cloudflare account and an unused hostname such as `book.example.com`. See [Choose and prepare your booking domain](DOMAIN-SETUP.md).

## 2. Create and connect the tunnel

1. Sign in to [Cloudflare](https://dash.cloudflare.com/) in your browser. Open **Networking → Tunnels**, choose **Create Tunnel**, and give it a name such as `ba-core`. If asked for a connector type, choose `cloudflared`.
2. Under **Setup Environment**, choose the Debian or Linux install instructions for **ARM64**. Run Cloudflare’s installation commands in your SSH terminal on the **BA Core Pi**. You can check the installation on that Pi with `cloudflared --version`.
3. Copy the **service install** command from the tunnel’s dashboard. The placeholder below shows its shape. Use the actual command only on your own Pi. Anyone with its token can run your connector, so keep the command out of AI chats, screenshots, and shared terminal output.

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
```

4. On the Pi, run `systemctl is-active cloudflared`. The expected result is `active`. In Cloudflare, wait for **Healthy**, then continue. If the Pi already runs a Cloudflare service, check which tunnel it serves before replacing it.

This connector opens outbound connections to Cloudflare. Leave router port forwarding off. A restrictive egress firewall may need to allow Cloudflare Tunnel traffic on outbound port `7844`. Follow Cloudflare’s system requirements for the destination and protocol rules.

[Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) · [ARM64 downloads](https://developers.cloudflare.com/tunnel/downloads/) · [Tunnel tokens](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/) · [Network requirements](https://developers.cloudflare.com/tunnel/platform/system-requirements/)

## 3. Publish the booking hostname

1. In Cloudflare, open your tunnel and choose **Routes → Add route → Published application**.
2. Under **Hostname**, enter your subdomain and pick your domain. Leave **Path** empty so BA Core can serve its booking pages, assets, and callbacks on that hostname.
3. For the origin, select **HTTP** and enter `127.0.0.1:3001` if Cloudflare separates the type and address. If it asks for a full service URL, enter `http://127.0.0.1:3001`. Visitors use `https://book.example.com`. The HTTP address here is a local connection from `cloudflared` to BA Core on the same Pi.
4. Save the route. Cloudflare creates the DNS record for your tunnel. If it reports an existing record at that name, inspect it in **DNS → Records** before deciding whether to use a different hostname. Keep existing website and email records in place.
5. In BA Core, open **Admin → Settings** and search for **Domain (when live)** under **Local Search & SEO**. Set it to the full public HTTPS URL, such as `https://book.example.com`, and save. This field controls the public address BA Core uses for links. The separate **Website URL** in **Contact Information** is for the website footer.

Publish only the BA Core route. The separate Home Assistant Pi, SSH access, and the AI diagnostics connection use their own private access paths.

## 4. Test from outside your network

1. Turn Wi-Fi off on your phone and open the public address on cellular data. Confirm that it loads securely over HTTPS and displays the intended site or holding page.
2. From the same phone, check `/setup`. The first-run wizard should stay unavailable on the public address. Check that `/admin` requires owner sign-in. If either page exposes the wizard or owner data unexpectedly, remove the published route and investigate before opening bookings.
3. When ready, enable booking in **Website → What’s Public**. Use fictional details to make and cancel a booking over cellular. Confirm both show correctly in BA Core. If you take online payments, use the payment provider’s sandbox and verify the public webhook if your setup uses one. Follow the provider setup guide before enabling live payments.
4. During a planned test window, reboot the Pi and repeat the local and cellular checks. This verifies that BA Core and `cloudflared` both start automatically.

## Fix the right part first

Run these on the **BA Core Pi**. Read logs privately and redact credentials and customer details before sharing any part of them.

```bash
systemctl is-active ba-core cloudflared
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/
sudo journalctl -u cloudflared -n 60 --no-pager
```

| What you see | What to check |
|---|---|
| Cloudflare error **1033** | Cloudflare has no healthy connector for this tunnel. Check the **Healthy** state, the Pi’s internet connection, the `cloudflared` service, and outbound firewall rules. Confirm you installed the command for this tunnel. |
| Cloudflare **502** with an origin connection error | The tunnel is up and the connector can’t reach BA Core. Run the local `curl` check. Confirm BA Core is running and the Cloudflare route uses **HTTP** at `127.0.0.1:3001` on the same Pi. |
| Browser says the domain can’t be found | Confirm the domain is **Active**, the route shows the exact booking hostname, and its DNS record exists in the right Cloudflare zone. Check the domain guide if nameservers recently changed. |
| Holding page loads and booking stays closed | Check **Website → What’s Public**. The holding page means the hostname reached BA Core. Enable booking when the setup and public checks are complete. |
| Tunnel token was exposed | Rotate it in Cloudflare, disconnect any existing connections as described in Cloudflare’s compromised-token instructions, and reinstall the connector using the new dashboard command. Then confirm **Healthy** and test over cellular again. |

[Cloudflare Tunnel troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/) · [Token rotation and compromised-token recovery](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)
