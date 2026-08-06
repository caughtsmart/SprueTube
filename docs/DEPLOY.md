# Deploying SprueTube to spruetube.app

Written to be followed top to bottom on a fresh Cloudflare account. Roughly an
hour, most of it waiting for DNS and dashboard clicks.

Everything below assumes `npx wrangler login` has been run, or that
`CLOUDFLARE_API_TOKEN` is set.

---

## 1. Create the storage

```bash
npx wrangler d1 create spruetube
npx wrangler r2 bucket create spruetube-media
npx wrangler kv namespace create CACHE
```

Each command prints an id. Put them into `wrangler.jsonc`, replacing:

- `REPLACE_WITH_D1_DATABASE_ID`
- `REPLACE_WITH_KV_NAMESPACE_ID`

Then apply the schema:

```bash
npm run db:migrate:remote
```

## 2. Fill in the account vars

In `wrangler.jsonc` under `vars`:

| Var | Where to find it |
| --- | --- |
| `CF_ACCOUNT_ID` | Dashboard sidebar, or `npx wrangler whoami` |
| `CF_IMAGES_ACCOUNT_HASH` | Images → any delivery URL: `imagedelivery.net/<hash>/…` |
| `CF_STREAM_CUSTOMER_SUBDOMAIN` | Stream → an embed URL: `customer-xxxx.cloudflarestream.com` |

Leave `ADSENSE_CLIENT` empty. It stays empty until AdSense approves the site —
see step 8.

## 3. Set the secrets

```bash
# 32 random bytes. Rotating this later signs everyone out.
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET

# API token with Images:Edit and Stream:Edit on this account.
npx wrangler secret put CF_API_TOKEN
```

Create that token at **My Profile → API Tokens → Create Token → Custom token**
with exactly two permissions: *Account · Cloudflare Images · Edit* and
*Account · Stream · Edit*. Nothing else — this token is used by a Worker that
serves the public internet.

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

## 5. Configure Stream and its webhook

Stream → **Settings → Webhooks** → add:

```
https://spruetube.app/api/v1/webhooks/stream
```

Copy the signing secret it shows you, then:

```bash
npx wrangler secret put CF_STREAM_WEBHOOK_SECRET
```

This webhook is the only thing that moves a video post from `processing` to
`published`. Without it, videos upload and never appear. (The 15-minute cron
sweep catches stragglers, but do not rely on it as the primary path.)

## 6. Deploy and attach the domain

```bash
npm run deploy
```

Then Workers & Pages → `spruetube` → **Settings → Domains & Routes** → add
`spruetube.app` and `www.spruetube.app` as custom domains. Cloudflare creates
the DNS records itself; there is nothing to add by hand.

Pick one canonical host and redirect the other. `www` → apex is the convention:
Rules → **Redirect Rules** → `http.host eq "www.spruetube.app"` → dynamic
redirect to `concat("https://spruetube.app", http.request.uri.path)`, 301.

## 7. Social sign-in

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

## 8. Advertising

AdSense will not approve an empty site. The order that works:

1. Launch with house ads only (`ADSENSE_CLIENT` empty). They are already seeded
   by `scripts/seed.sql`.
2. Get real content and real traffic — a few dozen posts and a few weeks.
3. Apply to AdSense. Point it at `spruetube.app`.
4. On approval: set `ADSENSE_CLIENT` to your `ca-pub-…` id in `wrangler.jsonc`,
   fill in the three slot ids in `app/components/AdSlot.tsx`, and add
   `<AdSenseScript />` to the `<head>` in `app/root.tsx`.

House ads keep running underneath as the fallback for unfilled impressions.

## 9. Make yourself an admin

```bash
npx wrangler d1 execute spruetube --remote \
  --command "UPDATE profile SET role='admin' WHERE username='yourname'"
```

Do this immediately after your first sign-up. Until someone is an admin, reports
pile up with nobody able to action them.

## 10. Seed the house ads

```bash
npx wrangler d1 execute spruetube --remote --file=./scripts/seed.sql
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
| Videos stay "processing" forever | Stream webhook not registered, or `CF_STREAM_WEBHOOK_SECRET` wrong. Check `wrangler tail` for `bad_signature`. |
| Images 404 after upload | Variant name missing in the Images dashboard. |
| "Missing or null Origin" on sign-in | Request Origin is not in `trustedOrigins` — check `SITE_URL` matches the host being used. |
| Everyone signed out at once | `BETTER_AUTH_SECRET` changed. |
| Uploads return 502 | `CF_API_TOKEN` missing, expired, or lacking Images/Stream Edit. |
