# Release review

## Source and data

- Build from this reviewed snapshot. The first commit should contain application code, synthetic tests, generic guides, and third-party notices only.
- Keep BA Custom Products LLC credited as the maker. Use fictional facilities and sample bookings in the guides, installer, and test data.
- Review every tracked path and the exact Git history before the repository changes visibility. Review text, archives, images, vendor provenance, test fixtures, and GitHub releases or Actions artifacts. Customer records, real facility configuration, private operating history, passwords, access codes, live provider tokens, backups, signed updates, and private domains belong outside the candidate.
- Keep any site-specific deny list and scanner output outside this repo. An independent reviewer should compare against the source and inspect the exact tarball.
- The source is published under the PolyForm Shield License 1.0.0 (`LICENSE.txt`). Keep that file and its Required Notice line in every copy and installer, and preserve the applicable third-party notices.

## Build and prove the archive

Run tests on a development machine using Node 26.13.0 LTS and a throwaway test directory. The installer downloads the official Linux ARM64 build and checks its pinned SHA-256. The tests use synthetic data.

`npm test` is the quick suite. It covers blank setup, the first-run guide, the local Owner Chat walkthrough, booking and encrypted restore, simulated Stripe payment and refund requests, signed webhooks, Resend confirmation and cancellation payloads, and Twilio consent and opt-out behavior. The hosted AI checks use simulated responses for both providers and cover guide retrieval, reviewed menu and website changes, key handling, conversation history, provider errors, and long replies. The Assistant checks cover the request sent to each provider, a tool call becoming a card that only the owner's signed-in request applies, the built-in reader with no model connected, a pasted `BA-CORE-ACTION` line, and every route the action list names. `test/installer.test.js` drives `install.sh` against a throwaway root with stand-in system commands: a fresh install, a repeat run, an upgrade that keeps every facility file, and a failed upgrade rolled back.

`bash batteries/run.sh` runs the longer batteries (bookings and money, refunds and tax, the counter, members, door codes, automation across restarts, backups, the website builder) against a copy of the tree. See [batteries/README.md](../batteries/README.md). Run both before building a release. Record the Node version and the totals in the commit that attaches the installer.

```bash
npm ci --ignore-scripts
npm test
bash batteries/run.sh
npm audit --omit=dev
bash packaging/build-release.sh HEAD
(cd dist && sha256sum -c ba-core-pi5-arm64.tar.gz.sha256)
tar -tzf dist/ba-core-pi5-arm64.tar.gz
```

## Commission an installation

The simulated installer test is not a Pi. Before relying on a release, install it on a bench Pi, then upgrade that Pi from the previous release with real data in place: confirm bookings, settings, uploads and the hosted AI connection survive, that the earlier version is kept under `/var/lib/ba-core/`, and that a deliberately broken release is rolled back. If you use BroadLink devices, confirm `python3-flask` and `python3-broadlink` installed and `systemctl status ba-core-broadlink` is active.

Follow the owner guide when setting up a venue. Check private first setup, the initial booking hold, and that the site resumes after reboot. Use **Owner Chat → Continue setup** to find the next unfinished step. Before opening bookings, use your own Stripe sandbox and a test hostname to check payment, signed webhook delivery, and cancellation. Confirm the setup wizard is unreachable from outside. For your recovery test, restore an encrypted backup to a spare installation.

On the bench Pi, follow the operating guide for an encrypted copy to a mounted USB drive or SD card. Confirm the device is detected after reboot, verify a `.baenc` file is written to it, and confirm the empty mountpoint is ignored after removing the device. Use that encrypted file for the second-install restore test.

If you use Home Assistant, test your hardware and supported functions with dummy bookings. Verify automatic bay actions at session start and end. For any physical entry lock, test programming, readback, cancellation, expiry, and an outage on-site before relying on it.

Use the installer archive and matching checksum shipped with this source for these checks.

On that Pi, use the owner’s MFA-protected session to connect OpenAI and Claude in turn with test credentials. Try the default model and another supported model and effort. Ask for device setup help and follow the Admin shortcut. Ask for a test menu price, homepage and draft page, and a bay timing change. Compare the values before and after **Apply reviewed changes**. Check that the website editor can preview the draft page and that the public visitor cannot open it. Verify the provider receives the requested guide excerpts and relevant editable values and that the key stays out of browser responses, logs, and backups. Test key replacement, disconnect, provider errors, and **Ask locally**. Restore to a clean installation and confirm the provider must be reconnected there.

In the **Assistant**, try a plain request with no model connected, then connect each provider and try a longer one. Approve a card and compare the values before and after. Paste an API key into the chat and confirm it is removed and not saved. Confirm customers appear to the model by first name and last initial only.

Try the AI bridge from both clients over SSH. Search and read an installed guide, check health, and draft a typed hours or pricing proposal. List the Assistant’s actions, prepare one with `prepare_action`, paste the `BA-CORE-ACTION` line into the Assistant and approve the card. Inspect the tool results for secrets and booking data. Paste the proposal into Owner Chat and verify the values after owner approval. Treat code changes as a separate development workflow.

The repository's history was reduced to a clean snapshot before publication. Review every later change the same way before it is pushed.
