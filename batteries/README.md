# Batteries

Longer checks that drive a real BA Core server through its HTTP routes: bookings and money, refunds and tax, the counter, members, door codes, bay automation across restarts, backups, the website builder, and the device stand-ins. They complement the quick suite in `test/` (`npm test`).

```bash
npm ci
bash batteries/run.sh              # every battery, about half an hour
bash batteries/run.sh refunds tax  # only the ones you name
```

Each battery starts its own server on fixed ports and writes its own `config.json` and `bookings.db` where it runs. `run.sh` therefore copies the tree to a temporary folder first and runs one battery at a time; it refuses to start while another run is in progress on the same machine. A battery prints one `PASS` or `FAIL` line per check and exits non-zero when anything failed.

Everything in them is synthetic: fictional facilities, example phone numbers, and stand-ins for Stripe, the door consoles, Home Assistant, and the bay PCs under `tools/`.

## Signing in

These batteries send the owner's password in an `x-admin-password` header. BA Core Community does not accept that header; an owner signs in and gets a session cookie and a CSRF token. `support/header-session.cjs` bridges the two for tests only: `run.sh` loads it into the server processes a battery starts, and it exchanges a correct header for a real session before the request reaches the app. It is never loaded by an installed BA Core.

## What is not here

Batteries for features Community does not have (the updater, licensing, fleet and shipping tools), batteries that need a real Stripe sandbox or Twilio test account, and the ones written around an on-unit AI model are left out. The Assistant on a hosted model is covered in `test/assistant-hosted.test.js` and `test/assistant-model.test.js`.
