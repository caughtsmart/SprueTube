# Where things stand

Written 12 August 2026 and revised 15 August, the second time with the
production database and the live site checked directly rather than inferred, so
the next session can start without re-deriving anything. `ROADMAP.md` says what to build next and
`COMPLIANCE.md` tracks the legal obligations; this file says what state the
thing is actually in and which of its details will bite you.

## Live and working

spruetube.app is deployed and in use. Posts with photos, build logs, the daily
news digest, commissions, private messaging, the marketplace, moderation, and
the Cabinet theme are all in production.

Recently finished, in order:

- **The contact form** at `/contact`. Sends through the Cloudflare Email Sending
  binding — no API key anywhere. Topic dropdown, honeypot, five submissions an
  hour per IP, every field escaped into the HTML part. Confirmed working end to
  end.
- **Email addresses off the site.** `hello@spruetube.app` is the only one
  published. It is a role address forwarded by Email Routing to Graham and
  Leigh, confirmed by delivery on 12 August. `safety@` and `privacy@` are gone —
  they were published for months and never onboarded, so anything sent to them
  would have bounced. They are topics on the form now, and the two that carry a
  clock get `[priority]` in the subject line.
- **Mobile overflow.** A pasted link no longer widens the page on a phone.

Landed in parallel with the above, from other sessions, so it is worth knowing
this file did not build it:

- **Web Push** — built end to end and **dormant**. Tables, sender, service
  worker and the Settings toggle all shipped; every send is a no-op until the
  three `VAPID_*` keys are set. `docs/NOTIFICATIONS.md` has the go-live runbook
  and the design for email digests, which remain a design.
- **AdSense** — was wired up with a real publisher id, then **removed** in the
  engagement-features work below. See it there.

## Engagement features (this session)

A batch of community and discovery work landed together. Migration
`0005_engagement_features` adds three tables (`pin`, `challenge`, `feedback`);
apply it and re-run `scripts/seed.sql` in production (both idempotent).

- **Discovery hub** — `/explore` is now the place to explore the site: a
  "Top painters right now" board, current painting challenges, the trending
  feed, and browse-by-game/theme. The board's ranking is a published formula in
  `server/services/discovery.ts` — engagement over a 45-day window, lifted
  gently by how many distinct weeks someone posted in (capped at six, never a
  streak). Cached in KV like the homepage highlights.
- **Pins** — signed-in people can pin games and themes (a ☆ on each chip) into
  a "Your shortcuts" row. `pin` table, `services/pins.ts`, `/api/v1/pins`. It is
  a personal reordering only, never a ranking signal.
- **Painting challenges** — DB-driven prompts (`challenge` table,
  `services/challenges.ts`), surfaced on the hub and as a one-line nudge on the
  signed-in home feed. Entries are just posts carrying the challenge's tag —
  no judging, no timer. Add one with an `INSERT`; two are seeded.
- **Bug & feature form** — `/feedback`, distinct from `/contact`. Persists to
  the `feedback` table (the durable record) and emails the shared inbox as a
  nudge. Honeypotted, rate limited, open signed-out.
- **Sharing** — a Share control on every post card: native share sheet where the
  browser has it, else copy-link plus X/Facebook/Reddit/Bluesky/WhatsApp/email.
  No SDKs, no cookies (`app/lib/share.ts`, `components/ShareButton.tsx`).
- **AdSense removed** — no third-party ad network at all now. House ads only,
  every one a Loaded Dice promo, including a brand ad linking to the homepage.
  No ad cookies, so no consent banner owed. The sidebar ad fetches itself on the
  client (`SelfFetchingAd`).

## What is outstanding

Ranked by what actually blocks something. Items 1 and 2 were found on 15 August
by querying production; everything under them was already known.

1. ~~**Production D1 is three migrations behind.**~~ Applied on 15 August, and
   this is the one that mattered: `d1_migrations` recorded only `0000_init` and
   `0001_fluffy_drax`, so `notification_pref`, `push_subscription`, `recipe`,
   `recipe_step`, `post_recipe`, `recipe_save` and `profile.recipe_count` did
   not exist. The loaders in `app/routes/profile.tsx` and `app/routes/post.tsx`
   call `listRecipesByOwner` unconditionally, so every profile page and every
   post page was 500ing against the live schema — invisible only because the
   launch curtain returns 503 for every path.

   `0002_brainy_stick`, `0003_sad_wolf_cub` and `0004_overconfident_doctor_strange`
   are now applied and recorded in the ledger, and the loaders' query shapes
   were run against production afterwards to confirm they resolve. Nothing was
   dropped; all three were `CREATE TABLE`, `CREATE INDEX` and one
   `ALTER TABLE … ADD COLUMN`.

   **The first person through the curtain should still load a profile and a post
   page**, because a clean SQL query is evidence and a rendered page is proof.

2. **The cause is unfixed, so it will happen again.** Workers Builds deploys
   code without applying migrations — the trap already documented below, now hit
   twice. Change the deploy command in **Workers & Pages → spruetube → Settings
   → Builds** to:

   ```
   npx wrangler d1 migrations apply spruetube --remote && npx wrangler deploy
   ```

3. ~~**Someone made admin.**~~ Done. `caughtsmart` has `role = 'admin'`,
   confirmed against the live database on 15 August. The report queue has
   nothing in it yet.

4. **A D1 backup job.** `wrangler d1 export` on a schedule. There is still no
   backup of the production database at all, which remains the single largest
   unhedged risk — everything else here is recoverable.

5. **A solicitor reading the terms and privacy notice.** They are complete and
   accurate about what the software does, which is the hard part, but nobody
   qualified has read them.

6. **Web Push is off.** PR #14 is merged and deployed, so the code is live and
   inert. Two things are needed, in this order: migration `0002` from item 1
   (without it the Settings toggle writes to a table that does not exist), then
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` per
   `docs/NOTIFICATIONS.md`. One detail that runbook predates: `VAPID_SUBJECT`
   wants a mailbox somebody reads, and the only address the site publishes now
   is `hello@spruetube.app`, so use `mailto:hello@spruetube.app` rather than a
   personal one.

7. **There is nothing to look at.** One user, one post from 8 August, no
   projects and no recipes. The migrations and the curtain are plumbing; the
   feed being empty is what actually stops this launching. `ROADMAP.md` §"Getting
   the first hundred people" is the real next job.

8. **Mandatory email verification** is deliberately off. Turning it on is a
   one-way door that locks out every account created before the flip, including
   the admin. `DEPLOY.md` §11 has the order to do it in.

9. **The rate limiter is not atomic.** KV read-compare-write, so a parallel
   burst passes almost entirely. It stops a runaway retry loop, which is what
   this actually sees. A real fix needs a Durable Object. Documented in
   `server/api/context.ts`, and honest about it.

10. **The news sources need signing off.** Twelve feeds, chosen but never
    reviewed by a person. The daily ingest itself is healthy — 84 items stored,
    last run 06:00 on 15 August.

11. **Tab-bar glyphs** are Unicode characters standing in for a real 20px stroke
    icon set.

## Things that will waste your time if you do not know them

**Workers Builds does not run migrations.** It runs `npm run build:ci` and
`npx wrangler deploy`. A merged PR with a migration in it deploys code that
expects a schema the database does not have, and the site breaks. Run
`npm run db:migrate:remote` yourself after merging one. This has already caused
one outage. Changing the deploy command to
`npx wrangler d1 migrations apply spruetube --remote && npx wrangler deploy`
would fix it permanently and is worth doing.

**Outbound and inbound email are unrelated paths.** Sending goes through the
`EMAIL` binding and its records live on `cf-bounce.spruetube.app`. Routing owns
the root domain's MX, SPF and `cf2024-1` DKIM. Password resets working tells you
nothing whatsoever about whether mail to `hello@` arrives, which is how two days
went missing in August. `DEPLOY.md` §11 has the troubleshooting order — read the
Activity log first, and never test by sending from the destination address,
because Google silently suppresses a message returning to the account that sent
it.

**`drizzle-kit` has generated a broken migration here before.** The table-rebuild
it emits for SQLite selected new columns from the old table, which would have
silently dropped every comment. Read generated migrations before applying them,
and test on a local copy with real rows in it.

**The assistant can now see production, and it changes what is worth asking
for.** The Cloudflare connector is authorised on claude.ai, so a session can
read the live D1 (`d1_migrations`, row counts, schema drift) and fetch the site
over HTTPS — which is how the migration drift above was found rather than
guessed. Still out of reach: the Cloudflare dashboard itself, Workers secrets
(names and values alike), and real email, so `wrangler secret put`, the Builds
settings and anything needing an inbox are still a person's job. Read the
database before believing a document about it, this one included.

## Checks worth running

```bash
npm run typecheck     # wrangler types + react-router typegen + tsc
npm test              # 327 tests, no database needed
npm run check:mobile  # 375px and 320px sweep + component probes; needs npm run dev
```

`npm run check:mobile` also takes a width: `node scripts/check-mobile-overflow.mjs 320`.
It sweeps the public pages and then runs probes that paste real component markup
into a real page, because a fresh local D1 has no posts in it and the sweep alone
can only prove the chrome is sound.

## Where production actually stands

Checked on 15 August, not assumed.

- **No open pull requests.** Everything from #1 to #17 is merged, Web Push (#14)
  and the recipe stack (#15) included.
- **`main` is deployed.** The curtain page from #17 is the one production
  serves, so the running Worker is current.
- **The launch curtain is up.** Every path — pages and `/api` — returns `503`
  with `Retry-After: 3600` and the branded holding page, which means the
  `COMING_SOON` secret is set on the Worker and is overriding the `"false"` in
  `wrangler.jsonc`. Getting back in needs the `?preview=<COMING_SOON_BYPASS>`
  link; `DEPLOY.md` §5b has the mechanics.
- **The build is green.** `npm run typecheck` clean, 327 tests passing.
- PR #11 carried the Email Routing documentation and the compliance record; its
  history is messy on purpose, containing two wrong diagnoses and their
  corrections, and the wrong turns are the useful part of it.
