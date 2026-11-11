# PLAYBOOK: Getting the unit online

How the assistant gets the owner's box online: their own address (domain) and the unit's own connection to it, in the
owner's own Cloudflare account (maintainer, Oct 21 2026: "as much on the customer as possible and as easy as possible for them to do
it"). Written for the assistant; every action named here is one of its tools, and the steps the owner takes on Cloudflare's
and their domain company's own pages are in the chapter "Getting Your Box Online" (guide_chapter). One step at a time; say
what each step is for in one line; never claim a step is done until a tool shows it.

## Where to start - "get my box online", "connect my box", "set up my domain", "how do people find my site"

Ask which way it is, unless the talk already said:
1. "We set it up for you" (the paid extra) - the unit is already online: online_read shows it. Two things are left for the
   owner - confirming the registry's email, and later taking the domain into their own Cloudflare account. Both are in
   the chapter; read it to them.
2. "I already have a domain" - check it first: domain_check with their domain. Then the chapter's Way 2, in order: their
   free Cloudflare account; the domain added there (Free plan); DNSSEC off at their domain company if domain_check says
   it is on; the nameservers changed to the two Cloudflare shows; wait for Active (domain_check again: "on Cloudflare").
3. "Start fresh" - their free Cloudflare account, then a new domain bought in Cloudflare (the chapter's Way 3). It is on
   Cloudflare at once.

## Before connecting - what domain_check tells you, and what to ask

- Not on Cloudflare yet: do not connect. Say which nameservers the world sees now and walk the next step of Way 2.
- It receives email: before the switch, the owner checks those email records are on Cloudflare's DNS page - their email
  keeps working only then.
- DNSSEC on: it is turned off at the domain company FIRST.
- It points somewhere now: ask whether that is their current website. Their choice: the unit takes the address (only with
  their words "replace it" - box_connect replace_existing), or the unit uses a part of the domain, such as
  book.theirdomain.com, and the old site stays.

## Connecting - box_connect

When domain_check says the domain is on Cloudflare: box_connect with the address(es) the owner chose (the domain and
www.the-domain, or a part such as book.the-domain). The chat shows a card: they tap Connect, then "Open Cloudflare's
sign-in", sign in, pick the domain and tap Authorize. The card follows the unit and says how it ended - never read a link
out yourself. What the unit keeps, if they ask: only the key that runs this one connection; the sign-in Cloudflare gave it is
deleted. The site shows "coming soon" until they say go live (site_go_live).
- "It said not finished in time": the sign-in waits about ten minutes - box_connect again and open the link straight away.
- "Already has a record": the address points somewhere now - ask: replace it, or a part of the domain.
- To stop a sign-in that is waiting: box_connect_stop.

## After - "is my site up yet", "is my domain ready yet"

site_check_now asks the address from outside the way a visitor would (a new address can take a few minutes); online_read
shows the connection, its service and the last try. domain_check answers "is my domain on Cloudflare yet". If the
connection's service is not running, the health line says so (health_read) - a restart of the unit is the first step.
