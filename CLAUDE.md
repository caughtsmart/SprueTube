# SprueTube — notes for Claude

## Outstanding: turn Web Push live

Web Push is **built and merged-ready** (PR #14 / `docs/NOTIFICATIONS.md`) but is
**not yet switched on in production** — it stays a silent no-op until the VAPID
keys exist. **At the start of a SprueTube session, remind Graham** that this is
pending and offer to walk through the setup. The steps live in
`docs/NOTIFICATIONS.md` under "Turning Web Push on"; the short version:

1. ~~Merge PR #14.~~ Merged 12 August, and deployed.
2. `npm run db:migrate:remote` — **do this first and it fixes more than push.**
   Production is three migrations behind, not one: `0002` is push's two tables,
   `0003`/`0004` are the recipe stack, and without those the profile and post
   pages 500. See `docs/HANDOVER.md` §"What is outstanding" item 1.
3. `node scripts/generate-vapid-keys.mjs` — keep the pair safe.
4. `wrangler secret put` the three `VAPID_*` values. Use
   `mailto:hello@spruetube.app` for `VAPID_SUBJECT` — it is the only address the
   site publishes, and the runbook predates that.
5. `npm run deploy`.
6. Verify: Settings → Notifications toggle appears; test with a second account.

Once push is live in production, **delete this section** — it will be stale.

## Next feature after that

Email digests — the second half of `docs/NOTIFICATIONS.md`, still a design:
a consent-aware mailer (separate from transactional `server/services/email.ts`),
a weekly cron job riding the existing `*/15` schedule, and one-click unsubscribe.
