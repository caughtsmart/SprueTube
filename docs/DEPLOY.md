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

## 2. Fill in the account vars

Two placeholders remain in `wrangler.jsonc` under `vars`. They are the only
ones left.

| Var | Where to find it |
| --- | --- |
| `CF_ACCOUNT_ID` | `npx wrangler whoami` after logging in |
| `CF_IMAGES_ACCOUNT_HASH` | Images → any delivery URL: `imagedelivery.net/<hash>/…` |

Leave `ADSENSE_CLIENT` empty. It stays empty until AdSense approves the site —
see step 7.

## 3. Set the secrets

```bash
# 32 random bytes. Rotating this later signs everyone out.
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET

# API token with Cloudflare Images:Edit on this account.
npx wrangler secret put CF_API_TOKEN
```

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
4. On approval: set `ADSENSE_CLIENT` to your `ca-pub-…` id in `wrangler.jsonc`,
   fill in the three slot ids in `app/components/AdSlot.tsx`, and add
   `<AdSenseScript />` to the `<head>` in `app/root.tsx`.

House ads keep running underneath as the fallback for unfilled impressions.

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
and blocking. 36 checks.

It creates two throwaway accounts prefixed `verify-` and prints the one-line
command to remove them.

Behind Access, pass an Access service token or every request gets the login page
instead of the app — the script detects that case and says so rather than
reporting 36 confusing failures:

```bash
CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
  npm run verify -- https://spruetube.app
```

## 11. Set up the safety inboxes

`safety@spruetube.app` and `privacy@spruetube.app` are published in the app and
in the legal pages. They must reach a human. Cloudflare **Email Routing** will
forward them to an existing mailbox for free.

---

## Ongoing

**Deploys**

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
