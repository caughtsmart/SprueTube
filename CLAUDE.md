# SprueTube — notes for Claude

## Outstanding: turn Web Push live

Web Push is **built and merged-ready** (PR #14 / `docs/NOTIFICATIONS.md`) but is
**not yet switched on in production** — it stays a silent no-op until the VAPID
keys exist. **At the start of a SprueTube session, remind Graham** that this is
pending and offer to walk through the setup. The steps live in
`docs/NOTIFICATIONS.md` under "Turning Web Push on"; the short version:

1. Merge PR #14 if not already merged.
2. `node scripts/generate-vapid-keys.mjs` — keep the pair safe.
3. `npm run db:migrate:remote` (creates `notification_pref`, `push_subscription`).
4. `wrangler secret put` the three `VAPID_*` values.
5. `npm run deploy`.
6. Verify: Settings → Notifications toggle appears; test with a second account.

Once push is live in production, **delete this section** — it will be stale.

## Next feature after that

Email digests — the second half of `docs/NOTIFICATIONS.md`, still a design:
a consent-aware mailer (separate from transactional `server/services/email.ts`),
a weekly cron job riding the existing `*/15` schedule, and one-click unsubscribe.
