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
- **AdSense** — `ADSENSE_CLIENT` is now a real publisher id, and the sidebar
  unit sits in an xl-only right rail.

## What is outstanding

Ranked by what actually blocks something. Items 1 and 2 were found on 15 August
by querying production; everything under them was already known.

1. **Production D1 is three migrations behind, and this breaks core pages.**
   `d1_migrations` on the remote database records only `0000_init` and
   `0001_fluffy_drax`. Unapplied:

   | Migration | Creates | Shipped by |
   | --- | --- | --- |
   | `0002_brainy_stick` | `notification_pref`, `push_subscription` | PR #14 |
   | `0003_sad_wolf_cub` | `recipe`, `recipe_step`, `post_recipe`, `profile.recipe_count` | PR #15 |
   | `0004_overconfident_doctor_strange` | `recipe_save` | PR #15 |

   The loaders in `app/routes/profile.tsx` and `app/routes/post.tsx` both call
   `listRecipesByOwner` unconditionally, so **every profile page and every post
   page 500s** against the current schema. Nobody has seen it because the launch
   curtain (below) is returning 503 for every path, which masks it completely.
   Fix, before the curtain comes down:

   ```bash
   npm run db:migrate:remote
   ```

   All three are additive — `CREATE TABLE`, `CREATE INDEX` and one
   `ALTER TABLE … ADD COLUMN`. Nothing drops, so there is no data at risk.

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
