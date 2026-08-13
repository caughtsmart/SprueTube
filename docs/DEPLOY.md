# Deploying SprueTube to spruetube.app

Written to be followed top to bottom on a fresh Cloudflare account. Roughly an
hour, most of it waiting for DNS and dashboard clicks.

Everything below assumes `npx wrangler login` has been run, or that
`CLOUDFLARE_API_TOKEN` is set.

---

## 1. Storage — already done

The D1 database and the KV namespace exist, their ids are in `wrangler.jsonc`,
the schema is applied and the house ads are seeded. Nothing to do here.

| Resource | Name | Id |
| --- | --- | --- |
| D1 (region WEUR) | `spruetube` | `d15396fa-e98d-46c5-9212-1c38dbbb1c2f` |
| KV | `spruetube-cache` | `6f09e2419a8f44c5a5114fa204cac13c` |

To confirm:

```bash
npx wrangler d1 execute spruetube --remote \
  --command "SELECT count(*) AS tables FROM sqlite_master WHERE type='table'"
```

There is no R2 bucket, on purpose. Photos go to Cloudflare Images and video to
Stream, so nothing in the codebase reads a bucket, and an unused binding
pointing at a bucket that does not exist fails the deploy. R2 also has to be
enabled once from the dashboard before any bucket can be created. Add the
binding back when there is a reason to — untouched originals, or data exports.

## 2. The account vars

`CF_ACCOUNT_ID` and `CF_IMAGES_ACCOUNT_HASH` are both committed in
`wrangler.jsonc`. Neither is a credential — the account id only names the
account, and the images hash appears in the `src` of every photo the site
serves. An API token is what actually grants access, and that is a secret.

Deploying to a *different* Cloudflare account means changing both by hand:

| Var | Where to find it |
| --- | --- |
| `CF_ACCOUNT_ID` | `npx wrangler whoami` after logging in |
| `CF_IMAGES_ACCOUNT_HASH` | Images → any delivery URL: `imagedelivery.net/<hash>/…` |

`scripts/deploy.sh` warns if the configured account is not the one you are
signed in as. It will not rewrite the file to match: a deploy script that edits
a tracked file leaves the working tree dirty after every run, and the next
`git pull` then refuses — quietly enough that you deploy stale code without
noticing.

Leave `ADSENSE_CLIENT` empty. It stays empty until AdSense approves the site —
see step 7.

## 3. Set the secrets

```bash
# 32 random bytes. Rotating this later signs everyone out.
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET

# API token with Cloudflare Images:Edit on this account.
npx wrangler secret put CF_API_TOKEN
```

There is no email API key. Transactional email goes through the Cloudflare
`EMAIL` binding, which is authorised by being bound — see step 11.

**Web Push (optional, but cheap).** Generate a VAPID key pair once and set the
three keys. With them unset, push is simply off and every send is a no-op; with
them set, the Settings → Notifications toggle starts working and interactions
reach people with the tab closed.

```bash
node scripts/generate-vapid-keys.mjs   # prints the three values below
echo -n "<public key>"  | npx wrangler secret put VAPID_PUBLIC_KEY
echo -n "<private key>" | npx wrangler secret put VAPID_PRIVATE_KEY
echo -n "mailto:safety@spruetube.app" | npx wrangler secret put VAPID_SUBJECT
```

The public key is genuinely public — it is shipped to every browser so it can
subscribe — but it lives with the other two as a secret so the trio is managed
together and rotating them is one operation. Rotating the pair invalidates every
existing subscription; browsers re-subscribe on their next visit to Settings.

Create that token at **My Profile → API Tokens → Create Token → Custom token**
with exactly one permission: *Account · Cloudflare Images · Edit*. Nothing else
— this token is used by a Worker that serves the public internet.

## 4. Configure Images

Images → **Variants**. Create these four names; the code requests them by name
and an unknown variant is a 404, not a fallback.

| Variant | Width | Fit | Used for |
| --- | --- | --- | --- |
| `thumbnail` | 400 | cover | Grid tiles, multi-photo posts |
| `avatar` | 160 | cover | Profile pictures |
| `feed` | 1200 | scale-down | Single-photo posts |
| `full` | 2000 | scale-down | Post detail, Open Graph images |
| `public` | — | — | Exists by default; leave it |

Leave "require signed URLs" **off**. Everything here is public content behind a
public feed, and signing would break the plain `<img>` tags that keep it fast.

## 5. Deploy and attach the domain

```bash
./scripts/deploy.sh
```

That script resolves the account id from `wrangler whoami` and writes it into
`wrangler.jsonc`, refuses to deploy if the typecheck or tests fail, deploys, and
then generates `BETTER_AUTH_SECRET` if it is not already set — in that order,
because on a fresh account the Worker has to exist before a secret can attach to
it. It warns about anything still missing rather than failing, so a first preview
gets up with only these two commands:

```bash
npx wrangler login
./scripts/deploy.sh
```

Plain `npm run deploy` still works if you would rather do the steps yourself.

Then Workers & Pages → `spruetube` → **Settings → Domains & Routes** → add
`spruetube.app` and `www.spruetube.app` as custom domains. Cloudflare creates
the DNS records itself; there is nothing to add by hand.

Pick one canonical host and redirect the other. `www` → apex is the convention:
Rules → **Redirect Rules** → `http.host eq "www.spruetube.app"` → dynamic
redirect to `concat("https://spruetube.app", http.request.uri.path)`, 301.

## 5a. Previewing behind Cloudflare Access (Zero Trust)

Putting Access in front of `spruetube.app` is the right way to preview a UGC
platform before it is ready for the public: no crawlers, no strangers signing
up, no AdSense review happening early, and nothing to un-launch afterwards.

Zero Trust → Access → Applications → **Add a self-hosted application**, domain
`spruetube.app` (add `www.spruetube.app` too if it is attached), then a policy
of Allow / Emails / your own address.

### Nothing to work around

Access in front of the whole hostname used to break the Cloudflare Stream
webhook, which needed a path-scoped Bypass application. With video gone there
is no inbound machine-to-machine callback at all, so a single Allow policy over
the whole site is enough.

### What else changes, and does not matter yet

- Crawlers cannot reach the site, so `robots.txt`, the sitemap and Open Graph
  previews do nothing. All correct for a preview.
- Link unfurls in Slack, Discord and WhatsApp will show the Access login page
  rather than a post.
- Google and Apple sign-in still work: the visitor is already through Access in
  a browser, and the OAuth callback is a browser redirect.
- Anything automated you point at the site needs an Access service token,
  including the verification script in step 10.

### Preview without the real domain

If you would rather not point `spruetube.app` at anything yet, deploy to the
`workers.dev` subdomain instead: remove the `routes` block from
`wrangler.jsonc`, deploy, and use `spruetube.<your-subdomain>.workers.dev`. Set
`SITE_URL` to that host as well, or sign-in will refuse the request — the origin
has to match what better-auth trusts.

## 6. Social sign-in

Optional for web, **required before the iOS app can ship** — App Store guideline
4.8 requires Sign in with Apple alongside any other third-party login.

**Google** — Cloud Console → Credentials → OAuth client ID → Web application.
Authorised redirect URI:

```
https://spruetube.app/api/auth/callback/google
```

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

**Apple** — Apple Developer → Certificates, Identifiers & Profiles. You need an
App ID with Sign in with Apple enabled, a Services ID (this is the client id), a
private key, and the team id. The client secret is a JWT you generate from the
key and it **expires after six months**, so put a calendar reminder in now
rather than finding out when sign-ins start failing.

```
https://spruetube.app/api/auth/callback/apple
```

```bash
npx wrangler secret put APPLE_CLIENT_ID
npx wrangler secret put APPLE_CLIENT_SECRET
```

Both buttons hide themselves when the secrets are absent, so partial setup is
safe.

## 7. Advertising

AdSense will not approve an empty site. The order that works:

1. Launch with house ads only (`ADSENSE_CLIENT` empty). They are already seeded
   by `scripts/seed.sql`.
2. Get real content and real traffic — a few dozen posts and a few weeks.
3. Apply to AdSense. Point it at `spruetube.app`.
4. On approval: set `ADSENSE_CLIENT` to your `ca-pub-…` id in `wrangler.jsonc`.
   This loads `<AdSenseScript />` (already wired into the `<head>` in
   `app/root.tsx`) so the site is verified and Auto ads can run.
5. When you have real ad units, fill in the three slot ids in
   `app/components/AdSlot.tsx`. Each slot only renders a network unit once its
   id is set; until then it keeps serving the house ad.

House ads keep running underneath as the fallback for unfilled impressions and
for any slot without a configured id.

## 8. Make yourself an admin

```bash
npx wrangler d1 execute spruetube --remote \
  --command "UPDATE profile SET role='admin' WHERE username='yourname'"
```

Do this immediately after your first sign-up. Until someone is an admin, reports
pile up with nobody able to action them.

## 9. Seed the house ads

Already applied to the remote database — four Loaded Dice promos across the
feed, sidebar and post slots. Re-running is harmless (`INSERT OR IGNORE`):

```bash
npx wrangler d1 execute spruetube --remote --file=./scripts/seed.sql
```

## 10. Verify the deployment

```bash
npm run verify -- https://spruetube.app
```

Drives the real API and the rendered pages: signup, the age gate, posting,
hashtag extraction, all feed tabs, follows, idempotent likes, comments,
notifications, followers-only visibility, reporting, moderation authorisation
and blocking. 39 checks.

It creates two throwaway accounts prefixed `verify-` and prints the one-line
command to remove them.

Behind Access, pass an Access service token or every request gets the login page
instead of the app — the script detects that case and says so rather than
reporting 39 confusing failures:

```bash
CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
  npm run verify -- https://spruetube.app
```

## 11. Email

Two directions, two different services. Both are needed.

### Sending — Cloudflare Email Sending

Password resets and email confirmation, through the `send_email` binding in
`wrangler.jsonc`. There is no API key: the binding is the credential, so nothing
has to be minted, stored or rotated, and nothing can leak into git.

**Requires the Workers Paid plan.** Email Sending is not offered on the free
plan. 3,000 messages a month are included, then $0.35 per 1,000 — far beyond
what a community this size will send on resets alone.

Onboard the domain once:

```bash
npx wrangler email sending enable spruetube.app
npx wrangler email sending dns get spruetube.app   # confirm SPF and DKIM landed
```

That writes the SPF and DKIM records straight into Cloudflare DNS, which is the
whole reason this is less trouble than a third-party sender: no records to copy
between two dashboards, and no chance of leaving one proxied by mistake. Usually
live within 5–15 minutes.

`EMAIL_FROM` in `wrangler.jsonc` is `noreply@spruetube.app` — the address only,
because the binding takes the display name separately and reads it from
`SITE_NAME`. The address must be on the onboarded domain, and must match
`allowed_sender_addresses` on the binding.

Until the domain is onboarded, nothing breaks and nobody is told: the site still
offers "reset my password", still says "check your email", and the send fails
with `E_SENDER_NOT_VERIFIED` in the Workers log. Verify it properly by actually
resetting your own password.

### The contact form

`/contact` uses the same binding, and is the one place a message travels from a
stranger to us rather than the other way round. Two things follow from that:

- The sender is still `noreply@spruetube.app`. It cannot be the person writing —
  `allowed_sender_addresses` would refuse it, and forging their domain would
  fail SPF at the receiving end anyway. Their address goes in `Reply-To`, so
  hitting reply in the inbox does what it looks like it does.
- `CONTACT_RECIPIENTS` in `wrangler.jsonc` is a comma-separated list, currently
  `graham@loadeddice.uk,leigh@loadeddice.uk`. Everyone on it is in `To:` and can
  see the others. Changing who reads the inbox is a config edit and a deploy, no
  code change — and a staging deploy can point it somewhere harmless.

Unlike the password reset, a failed send here is reported to the person rather
than swallowed: they get a 502 saying so, with their text still in the box. A
contact form that quietly bins messages is worse than no contact form, and that
matters more here than it would elsewhere — see below.

### One published address, and only one

`hello@spruetube.app` is the only address in the app, defined once as
`CONTACT_EMAIL` in `app/lib/legal.ts` and shown on `/contact`, `/terms` and
`/privacy`. It is published because regulation 6 of the Electronic Commerce (EC
Directive) Regulations 2002 requires it and a form alone does not satisfy that —
the reasoning is on the constant.

No personal address appears anywhere, and `safety@` / `privacy@` are gone: both
were published for months without ever being onboarded, so anything sent to them
would have bounced. `tests/no-published-email.test.ts` fails the build on any
address that is not `hello@` or `noreply@`, and also fails if `hello@` is ever
deleted — losing it would put the site back out of step with reg. 6 silently,
since nothing else would break.

`/contact` is still the route the site pushes people towards, because it
collects a topic. Safety reports and UK GDPR requests are topics rather than
addresses; the two that carry a clock are listed in `URGENT_CONTACT_TOPICS` and
get `[priority]` in the subject line so a shared inbox can filter them.

### Receiving — Cloudflare Email Routing

`hello@spruetube.app` must reach a person. Cloudflare **Email Routing** forwards
it for free:

It now lives under **Compute → Email Service → Email Routing**, at the *account*
level rather than on the zone — it used to be an **Email** tab inside the domain,
which is where older instructions (including an earlier version of this file)
send you. Direct link: `https://dash.cloudflare.com/?to=/:account/email-service/routing`.

1. **Onboard Domain** → pick `spruetube.app`. It offers to add the MX, SPF and
   DKIM records to the root domain; take it. This is the step that creates the
   MX, and without it nothing below has any effect.
2. **Destination Addresses** → add `graham@loadeddice.uk` and
   `leigh@loadeddice.uk`. These are account-level, not per-domain. Each gets a
   verification email that has to be clicked — **any rule pointing at an
   unverified address stays disabled**, which is the failure that looks like
   nothing happening.
3. **Routing Rules** → **Create routing rule**. Email pattern `hello`, domain
   `spruetube.app`, action *Send to an email*, destination both addresses.
4. Leave the catch-all **off**. On a domain with a published address it is a
   spam magnet and nothing needs it.

Sending and Routing are separate halves that do not disturb each other, and
they keep their records in different places — which matters when you are
reading DNS to work out what is wrong:

| | Records live on | DKIM selector |
|---|---|---|
| Email **Sending** (outbound) | `cf-bounce.spruetube.app` | `cf-bounce._domainkey` |
| Email **Routing** (inbound) | the root domain | `cf2024-1._domainkey` |

So an apex with no MX and no SPF, while `cf-bounce` has both, means exactly one
thing: Sending is onboarded and Routing is not.

**Check DNS first, then send a test.** A test message that fails to arrive tells
you nothing about why; the MX record tells you whether delivery was ever
possible:

```bash
dig +short MX spruetube.app        # expect three *.mx.cloudflare.net entries
```

Empty output means Email Routing is not live on the zone, and every message to
`hello@` is undeliverable no matter what the routing rules say. Senders fall
back to the A record under RFC 5321 §5.1, which here is Cloudflare's HTTP proxy
— it does not speak SMTP, so the mail hangs and eventually bounces.

Then email `hello@spruetube.app` from outside and confirm it lands in both
inboxes. Until both checks pass, the address on the terms page is a dead end,
which is worse than the form-only state it replaced.

### When a test message does not arrive

**Look at the Activity log first.** Compute → Email Service → **Activity log**,
which lists every inbound message and what Email Routing did with it —
*Forwarded*, *Dropped*, *Rejected*, *Delivery failed* or *Error* — and expands to
show the SPF, DKIM and DMARC results. It answers the only question that matters
at this point: did the message reach Cloudflare at all? Everything below is
guesswork until you have looked.

- **Nothing in the log.** The message never arrived. DNS or the sending side.
- **Forwarded.** Cloudflare did its job and the message is at Google. Look
  again in the destination mailbox, including All Mail.
- **Dropped / Rejected / Delivery failed.** The row says which, and expanding it
  says why.

Three things that produce "it just never turned up", in the order they are
worth checking:

1. **You sent it from the destination address.** This is what it was in August
   2026, after an afternoon spent looking everywhere else. Sending from
   `graham@loadeddice.uk` to `hello@spruetube.app`, which forwards straight back
   to `graham@loadeddice.uk`, means Google suppresses the message as one
   returning to the account that sent it — not in the inbox, not in spam,
   nothing anywhere reporting a failure. Cloudflare's own documentation says to
   test from a different account for exactly this reason. Send from a personal
   address on another provider before concluding anything is broken.
2. **A destination address has not been verified.** Its rule stays disabled and
   the mail is dropped. Destination Addresses shows this and nothing else does.
3. **The routing rule is disabled**, or its pattern does not match. Check the
   status toggle reads Active.

And one thing that is *not* evidence: **Email Routing does not send non-delivery
reports.** A message it drops or rejects produces no bounce to the sender, so
"I did not get a bounce" tells you nothing at all about whether it was
delivered.

Two traps worth knowing, because both fail quietly:

- A destination address that has not confirmed by email is dropped rather than
  bounced. The dashboard shows it as unverified; nothing else will tell you.
- Outbound mail is a different path entirely. Password resets and the contact
  form work off the Email Sending binding and never consult the MX, so they
  will keep working perfectly while inbound is completely dead. Do not read one
  as evidence about the other.

### Outbound authentication is already sound

Worth writing down, because the apex looks alarming until you know where to
look. `dig +short TXT spruetube.app` returns nothing and `_dmarc` says
`p=reject`, which reads like a domain that publishes a strict policy it cannot
satisfy. It isn't. Email Sending keeps its SPF and DKIM on the `cf-bounce`
subdomain, and all three are present and correct:

```bash
dig +short TXT cf-bounce.spruetube.app              # v=spf1 include:_spf.mx.cloudflare.net ~all
dig +short TXT cf-bounce._domainkey.spruetube.app   # v=DKIM1; ...
dig +short MX  cf-bounce.spruetube.app              # route1/2/3.mx.cloudflare.net
```

The apex SPF is Email **Routing**'s to add, and it appears when Routing is
onboarded. Do not hand-write one on the root domain to "fix" the gap — you would
be authorising the wrong thing, and Routing's onboarding wants to manage that
record itself.

### Turning on mandatory verification

`requireEmailVerification` in `server/auth.ts` is `false`, and flipping it is a
one-way door for anyone who already has an account. better-auth refuses the
sign-in of a user whose `emailVerified` is false — it does not prompt them to
verify, it just says no. Every account created before the flip, yours included,
is locked out.

So do it in this order:

```bash
# 1. Confirm sending works — reset your own password end to end first.

# 2. Grandfather in everyone who signed up before verification existed.
npx wrangler d1 execute spruetube --remote \
  --command "UPDATE user SET email_verified = 1"

# 3. Only now set requireEmailVerification: true in server/auth.ts and deploy.
```

New sign-ups already receive a confirmation email — `sendOnSignUp` is on — so
the flag is the only thing left to change.

---

## Continuous deployment

Merging to `main` deploys the site. Cloudflare **Workers Builds** watches the
repository, so nothing is deployed from anyone's laptop and no clone has to be
kept in step.

Set up once, in the dashboard: **Workers & Pages → spruetube → Settings →
Builds → Connect repository**.

| Field | Value |
| --- | --- |
| Repository | `caughtsmart/SprueTube` |
| Branch | `main` |
| Build command | `npm run build:ci` |
| Deploy command | `npx wrangler deploy` |

`build:ci` runs the typecheck, the unit tests and the build. A failure at any of
those stops the deploy, so a red build leaves the previous version serving
rather than replacing it with a broken one.

Secrets are not touched by a deploy. They live on the Worker and survive every
build, which is why none of them appear here.

**This makes merging the same thing as deploying.** Two things keep that safe:

- CI runs the same checks on every pull request, plus `wrangler deploy
  --dry-run`, which validates `wrangler.jsonc` and catches a malformed or
  missing binding before it can reach production.
- The branch ruleset in `.github/ruleset-main.json` requires those checks to
  pass before anything can merge. Apply it under **Settings → Rules → Rulesets
  → New ruleset → Import**. Without it, merging is deploying with nothing in
  between.

### Everything else from a browser

With Workers Builds connected, no part of running this site needs a terminal.

| Task | Where |
| --- | --- |
| Review and merge changes | github.com |
| Deploy | Automatic on merge |
| Add or rotate a secret | Worker → Settings → Variables and Secrets |
| Run SQL (make an admin, check counts) | Storage & Databases → D1 → spruetube → Console |
| Read logs | Worker → Logs |
| Email sending setup | Compute & AI → Email Service |

## Ongoing

**Deploying from a laptop**

Still supported, and useful when Workers Builds is not connected yet or you want
to ship without merging. `scripts/deploy.sh` does the same checks first:

```bash
npm run typecheck && npm test && npm run deploy
```

**Schema changes** — edit `server/db/schema.ts`, then:

```bash
npm run db:generate
npm run db:migrate:local     # try it locally first
npm run db:migrate:remote
```

D1 has no transactional DDL rollback. Read the generated SQL in `migrations/`
before applying it to production, especially anything that drops a column.

**Branch protection**

`main` should only move through a pull request with green CI. The rule is kept
in `.github/ruleset-main.json` so the setting is reviewable in git rather than
being invisible dashboard state. Apply it once with the `gh` CLI:

```bash
gh api --method POST /repos/caughtsmart/SprueTube/rulesets \
  --input .github/ruleset-main.json
```

Or by hand: Settings → Rules → Rulesets → New branch ruleset.

What it does, and why each part:

- **Require a pull request**, with **zero required approvals**. There is one
  developer; demanding an approval nobody can give would block every merge.
  Zero still forces the PR flow, so CI always runs before anything lands.
- **Require the `Typecheck, test, build` check**, strict — the branch must be up
  to date with `main`, so the checks that pass are the checks for the merge
  result rather than for a stale snapshot. If that becomes annoying with several
  PRs open at once, set `strict_required_status_checks_policy` to `false`.
- **Block deletion and force-pushes** on `main`.
- **Repository admins can bypass**, which mirrors GitHub's own default. A rule
  you cannot ever get past during a genuine emergency tends to get deleted
  rather than worked around. Drop the `bypass_actors` entry if you would rather
  be locked in.

Rulesets rather than classic branch protection, because classic protected
branches need a paid plan on a private repository and rulesets do not.

**Backups**

```bash
npx wrangler d1 export spruetube --remote --output=backup-$(date +%F).sql
```

Worth a scheduled job once there is content worth losing. D1 has
point-in-time recovery, but an export you hold yourself is the one you can
restore without Cloudflare.

**Logs** — `npx wrangler tail`, or the Observability tab (already enabled in
`wrangler.jsonc`).

## What breaks first, and why

| Symptom | Cause |
| --- | --- |
| Broken image icons everywhere | `CF_IMAGES_ACCOUNT_HASH` still a placeholder. The URL builders return null for a placeholder so avatars fall back to initials, but an already-uploaded image cannot be shown. |
| Every page is the Access login screen, including link previews | Working as intended; see step 5a. |
| Photos 404 after upload | Variant name missing in the Images dashboard. |
| "Missing or null Origin" on sign-in | Request Origin is not in `trustedOrigins` — check `SITE_URL` matches the host being used. |
| Everyone signed out at once | `BETTER_AUTH_SECRET` changed. |
| Photo uploads return 502 | `CF_API_TOKEN` missing, expired, or lacking Images:Edit. |
