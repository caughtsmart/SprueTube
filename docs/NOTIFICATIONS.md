# Notifications: Web Push and email digests

A design for reaching people when they are not looking at the site. Until
recently notifications were in-app only — a row in the `notification` table, a
bell badge, a list at `/notifications`, and nothing until the tab was opened.
This document plans the two channels that change that, in the order they should
be built: **Web Push** first, **email digests** second.

> **Status.** Web Push is **built** — the `notification_pref` and
> `push_subscription` tables, the `server/services/push.ts` sender (VAPID +
> aes128gcm, no dependencies), the `createNotification` fan-out, the
> subscribe/unsubscribe API, the `/sw.js` service worker, and the Settings
> toggle all shipped. Turn it on for an environment by setting the three
> `VAPID_*` keys (`node scripts/generate-vapid-keys.mjs`); with them unset every
> send is a no-op. **Email digests remain a design** — the sections below are
> the plan of record for that half.

Native mobile push (APNs/FCM) is out of scope here — it is gated on the iOS app,
which does not exist yet. See `docs/ROADMAP.md`. Everything below runs on the
current stack: one Cloudflare Worker, D1, KV, Drizzle.

## Turning Web Push on

The code is live but dormant until the VAPID keys exist. To switch it on in
production (roughly ten minutes, most of it the deploy):

1. **Merge PR #14** if it is not already in `main`.
2. **Mint the key pair** — `node scripts/generate-vapid-keys.mjs`. Generate it
   once and keep it; regenerating invalidates every existing subscription
   (browsers re-subscribe on their next Settings visit, so it is recoverable).
   Point `VAPID_SUBJECT` at a mailbox you actually read.
3. **Apply the migration** — `npm run db:migrate:remote` (creates
   `notification_pref` and `push_subscription`; additive, touches nothing else).
4. **Set the three secrets** —
   `echo -n "<value>" | npx wrangler secret put VAPID_PUBLIC_KEY`, and the same
   for `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
5. **Deploy** — `npm run deploy`.
6. **Verify** — Settings → Notifications now shows the toggle; `curl
   https://spruetube.app/api/v1/push/config` returns the public key; a like or
   comment from a second account produces a push with the tab closed.

Notes: HTTPS only (localhost counts); iPhone needs the site added to the Home
Screen before it will push; the toggle is per-device, not per-account; a like or
comment on your own post never notifies you, so test with a second account. To
try it locally first, put the keys in `.dev.vars`, `npm run db:migrate:local`,
`npm run dev`.

## Principles

- **One write path already exists — use it.** Every interaction that becomes a
  notification goes through `createNotification()` in
  `server/services/posts.ts`. It is called from posts, projects, messaging and
  moderation. That function is the single choke point where an outbound channel
  hooks in, and no caller needs to know a channel was added.
- **Delivery never blocks the interaction.** A like must not wait on a push, and
  a failed push must not fail the like. Fan-out is best-effort, after the row is
  committed, on `ctx.waitUntil`.
- **Consent is per-channel and revocable.** In-app notifications are not opt-in;
  push and email are. A person who never grants either sees exactly what they
  see today.
- **Digest, not per-event, for email.** Per-interaction email is the wrong
  default for this hobby — a model takes weeks, nobody wants twelve emails about
  one photo. Email is a batched "what you missed", matching the roadmap.

## The shared foundation: preferences

Both channels need a place to record what a person agreed to. There is none
today — `settings.tsx` edits the profile and nothing else. This is built first
because both channels depend on it and neither is legal without it (unsubscribe
for email, revocation for push).

### `notification_pref`

One row per user, created lazily on first visit to the settings panel. Absence
means "defaults", so existing accounts need no backfill.

| Column | Type | Meaning |
| --- | --- | --- |
| `user_id` | text, PK, FK → user | Owner. |
| `push_enabled` | int (bool) | Master switch for Web Push. Default 0. |
| `email_digest` | text enum | `off` \| `weekly` \| `daily`. Default `weekly`. |
| `email_marketing` | int (bool) | Reserved for the future marketing list. Default 0, untouched by this work. |
| `muted_types` | text (JSON array) | Notification `type` values the person never wants pushed or digested, e.g. `["like"]`. In-app is unaffected. |
| `digest_last_sent_at` | int (unix) | Watermark, so a digest never repeats a notification. |
| `updated_at` | int (unix) | |

`muted_types` reuses the existing notification `type` enum
(`like`, `comment`, `reply`, `follow`, `mention`, `system`, `message`,
`listing_reply`) — no second taxonomy. Defaults are chosen so the loudest,
lowest-value event (`like`) is easy to silence and the rest arrive.

### Settings UI

A new "Notifications" section in `app/routes/settings.tsx`:

- **Push** — one button. It requests browser permission, subscribes, and flips
  `push_enabled`. The button reflects the *browser's* permission state, not just
  the DB, because a person can revoke at the OS level and the server cannot see
  that until a send fails.
- **Email** — a radio for `off` / `weekly` / `daily`, and per-type checkboxes
  writing `muted_types`.

## Web Push

### Why Web Push

It reaches existing web users — including an installed PWA on Android and,
since Safari 16, on iOS — with no app, no store review, and no new vendor. The
protocol is a W3C standard; Cloudflare Workers can sign and send it with Web
Crypto, which is already available in the runtime. The only new secret is a
VAPID key pair.

### Schema: `push_subscription`

A person has many subscriptions — one per browser/device. This is the table the
roadmap calls "the token table", in its web form.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `push_` + the standard id scheme. |
| `user_id` | text, FK → user, cascade | Owner. |
| `endpoint` | text, unique | The push service URL the browser gave us. Unique so a re-subscribe upserts rather than duplicates. |
| `p256dh` | text | Client public key, for payload encryption. |
| `auth` | text | Client auth secret, for payload encryption. |
| `user_agent` | text, null | So a person can recognise "Firefox on the laptop" in a device list later. |
| `created_at` | int | |
| `last_success_at` | int, null | Bumped on every accepted send. |
| `failure_count` | int, default 0 | Consecutive failures; used to prune dead endpoints. |

Index on `user_id` — every send starts "give me this user's subscriptions".

### The client half

1. A **service worker** at `/sw.js` (served as a route, so it is same-origin and
   scoped to the root). Its only job for now is a `push` event handler that
   calls `showNotification`, and a `notificationclick` handler that focuses or
   opens the target URL carried in the payload.
2. A small client module: request `Notification.permission`, call
   `registration.pushManager.subscribe({ applicationServerKey })` with the
   public VAPID key, and `POST` the resulting subscription JSON to a new
   endpoint.

### The server half

New routes under the existing safety/people notification group:

- `POST /api/v1/push/subscribe` — upsert a `push_subscription` on `endpoint`,
  set `push_enabled` if this is the first one.
- `POST /api/v1/push/unsubscribe` — delete by endpoint.

A new `server/services/push.ts`:

- `sendWebPush(env, subscription, payload)` — builds an encrypted, VAPID-signed
  request per RFC 8291 / RFC 8030 using Web Crypto, `fetch`es the endpoint, and
  maps the response:
  - `201` — success, bump `last_success_at`, reset `failure_count`.
  - `404` / `410` — the subscription is gone. **Delete the row.** This is the
    normal way subscriptions die and must not be treated as an error to retry.
  - `429` / `5xx` — transient; increment `failure_count`, drop the row once it
    crosses a threshold (say 5).
- `pushToUser(env, userId, notification)` — load the user's subscriptions and
  fan out. No-op if `push_enabled` is 0 or the type is in `muted_types`.

There are mature descriptions of the encryption, but no runtime dependency is
needed: `aes128gcm`, an ECDH agreement and an HKDF are all Web Crypto
primitives. If that proves fiddly, a single small pure-JS library
(`@block65/webcrypto-web-push` or similar, zero Node built-ins) is acceptable —
the constraint is Workers-compatible, not dependency-free.

### Wiring it in

`createNotification()` gains an optional fan-out at its tail:

```ts
export async function createNotification(db, input) {
  await db.insert(notification).values({ /* unchanged */ });

  // Best-effort, out of band. Never throws into the caller.
  input.ctx?.waitUntil(
    pushToUser(input.env, input.userId, input).catch((e) =>
      console.error("push fan-out failed", e),
    ),
  );
}
```

The signature grows an optional `env` and `ctx`. Callers that have them (the API
routes, which hold the Hono context) pass them and get push; callers that do not
(a background job) simply do not, and the in-app row still writes. This keeps the
change additive — no existing call site breaks by omission.

The payload is small and self-contained: `{ title, body, url, icon }`, built
from the same `preview` string the in-app list already renders. Deep-link `url`
reuses the exact href logic in `app/routes/notifications.tsx` (a follow → the
profile, a message → the conversation, a post → the post) so tapping a push
lands in the same place as tapping the row.

## Email digests

### Why a digest, and why a new mailer

`server/services/email.ts` is transactional mail through Cloudflare Email
Sending, and its own header note is explicit that digests "are a different
problem with different rules — consent records, unsubscribe headers, send
reputation — and do not belong in this file." That judgement holds:

- **Cloudflare Email Sending is transactional-only** by Cloudflare's own terms,
  and is throttled for it. A weekly blast to the whole user base is not what it
  is for.
- Bulk mail needs a **`List-Unsubscribe` header** (RFC 8058, one-click), a
  suppression list, and its own sending reputation kept apart from the
  password-reset mail you cannot afford to have land in spam.

So digests get a **new provider** wired behind a new module,
`server/services/digest.ts`, most likely Resend or Amazon SES (both are plain
HTTPS APIs that work from a Worker; the choice is a deploy-time decision, not an
architectural one). The transactional path in `email.ts` is left exactly as it
is.

### The job

There is one cron expression for the whole Worker (`*/15 * * * *`), and the
convention here — see the news ingest in `workers/app.ts` — is that new
scheduled work *rides that tick and picks its own slot* rather than adding a
second schedule. The digest follows suit:

```ts
if (shouldRunWeeklyDigest(controller.scheduledTime)) {
  ctx.waitUntil(sendDigests(env).catch((e) => console.error("digest failed", e)));
}
```

`shouldRunWeeklyDigest` fires on one quarter-hour slot per week (e.g. Sunday
17:00, chosen because that is when hobbyists are home and the feed is fresh);
the daily variant fires once a day for people who chose `daily`.

`sendDigests(env)`:

1. Select users whose `email_digest` is not `off` and whose cadence is due
   relative to `digest_last_sent_at`.
2. For each, load notifications since their watermark, minus `muted_types`,
   minus anything from blocked/muted actors (reuse `blockedUserIds` — the
   in-app list already does this filtering).
3. Skip anyone with nothing new. **An empty digest is never sent** — it is the
   fastest way to train people to unsubscribe.
4. Render a summary ("3 new followers, 5 likes, 2 comments" with the top few
   previews and thumbnails), send via the new provider, advance
   `digest_last_sent_at`.

Batched and paged like `refreshHotScores` — bounded work per invocation, so a
growing user base cannot blow the D1 statement limit or the Worker CPU budget in
one tick.

### Unsubscribe

Every digest carries a one-click unsubscribe: a signed, tokenised link
(`/unsubscribe?t=…`, HMAC over user id + purpose with `BETTER_AUTH_SECRET`, no
login required) that sets `email_digest = off`, plus the matching
`List-Unsubscribe` and `List-Unsubscribe-Post` headers so a mail client's own
button works. This is a legal requirement for bulk mail, not a nicety.

## Config and secrets

New to `wrangler.jsonc` / secrets:

```
VAPID_PUBLIC_KEY     var    — safe to expose; the client needs it to subscribe
VAPID_PRIVATE_KEY    secret — signs push requests
VAPID_SUBJECT        var    — a mailto: contact, required by the VAPID spec
DIGEST_API_KEY       secret — the chosen email provider's key
DIGEST_FROM          var    — e.g. digest@spruetube.app, a separate address
```

No change to the `EMAIL` binding: transactional mail is untouched.

## Migrations

Two new tables (`notification_pref`, `push_subscription`), no changes to
existing ones. Generated with `npm run db:generate` from the Drizzle schema, per
the existing workflow. Additive and back-compatible: an account with no
preference row and no subscription behaves exactly as it does today.

## Testing

- **Preferences and muting** are pure logic — unit-test that `pushToUser` and
  the digest selector honour `push_enabled`, `email_digest` and `muted_types`,
  and that blocked actors are excluded. This mirrors the existing
  `tests/logic.test.ts` style.
- **Dead-subscription pruning** — assert a `410` deletes the row and does not
  count as a retryable failure.
- **Empty digest** — assert a user with nothing new is not emailed and their
  watermark does not move.
- **No-secrets fallback** — with no VAPID keys and no digest provider, both
  channels degrade to no-ops with a single log line, exactly as `email.ts` does
  when the `EMAIL` binding is absent. Local dev needs no configuration to keep
  working. Guard this the way `no-published-email.test.ts` already guards the
  transactional path.

## Build order

1. `notification_pref` table + the settings UI. Nothing sends yet; this is the
   consent surface both channels stand on.
2. Web Push end to end: `push_subscription`, service worker, subscribe/
   unsubscribe routes, `push.ts`, and the `createNotification` fan-out. Ship it;
   it needs no new vendor and reaches web users immediately.
3. Email digests: pick the provider, `digest.ts`, the weekly job riding the
   cron, tokenised unsubscribe.

Native APNs/FCM stays deferred behind the iOS app, and when it arrives it reuses
this exact shape — a per-device token table and a `pushToUser` sibling — so this
work is the groundwork for it, not a throwaway.
