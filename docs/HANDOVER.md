# Where things stand

Written 12 August 2026, at the end of a working session, so the next one can
start without re-deriving anything. `ROADMAP.md` says what to build next and
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

Ranked by what actually blocks something.

1. **Someone made admin.** Reports pile up unactionable until a real account has
   `role = 'admin'`. This is a one-row UPDATE against D1 and it has not been
   done.
2. **A D1 backup job.** `wrangler d1 export` on a schedule. There is no backup
   of the production database at all right now, which is the single largest
   unhedged risk in the project — everything else here is recoverable.
3. **A solicitor reading the terms and privacy notice.** They are complete and
   accurate about what the software does, which is the hard part, but nobody
   qualified has read them.
4. **Web Push is off.** The code is shipped and inert until `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set — roughly ten minutes, most
   of it the deploy, per `docs/NOTIFICATIONS.md`. One detail that runbook
   predates: `VAPID_SUBJECT` wants a mailbox somebody reads, and the only
   address the site publishes now is `hello@spruetube.app`, so use
   `mailto:hello@spruetube.app` rather than a personal one.
5. **Mandatory email verification** is deliberately off. Turning it on is a
   one-way door that locks out every account created before the flip, including
   the admin. `DEPLOY.md` §11 has the order to do it in.
6. **The rate limiter is not atomic.** KV read-compare-write, so a parallel
   burst passes almost entirely. It stops a runaway retry loop, which is what
   this actually sees. A real fix needs a Durable Object. Documented in
   `server/api/context.ts`, and honest about it.
7. **The news sources need signing off.** Twelve feeds, chosen but never
   reviewed by a person.
8. **Tab-bar glyphs** are Unicode characters standing in for a real 20px stroke
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

**The assistant cannot see the live site or the Cloudflare account.** Cloudflare
Access blocks it, the container's `CF_API_TOKEN` is empty, and outbound SMTP is
blocked. Anything needing the dashboard or a real email has to be done by a
person and reported back. Authorising the Cloudflare connectors on claude.ai
would remove most of that limitation.

## Checks worth running

```bash
npm run typecheck     # wrangler types + react-router typegen + tsc
npm test              # 285 tests, no database needed
npm run check:mobile  # 375px and 320px sweep + component probes; needs npm run dev
```

`npm run check:mobile` also takes a width: `node scripts/check-mobile-overflow.mjs 320`.
It sweeps the public pages and then runs probes that paste real component markup
into a real page, because a fresh local D1 has no posts in it and the sweep alone
can only prove the chrome is sound.

## Nothing is in flight

No open pull requests from this work, and `main` is deployed. PR #11 carried the
Email Routing documentation and the compliance record; its history is messy on
purpose, containing two wrong diagnoses and their corrections, and the wrong
turns are the useful part of it.
