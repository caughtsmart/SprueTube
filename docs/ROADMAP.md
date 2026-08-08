# Roadmap

Ordered by what blocks what, not by what is most exciting.

## Before launch

These are gaps in what is already built, and the site should not be public
without them.

- **Transactional email.** No verification, no password reset. Someone who
  forgets their password today is locked out permanently. Wire up Resend or
  MailChannels, then set `requireEmailVerification: true` in `server/auth.ts`.
- **Legal entity in the documents.** `app/routes/privacy.tsx` and
  `app/routes/terms.tsx` contain `[LEGAL ENTITY]` placeholders. See
  `docs/COMPLIANCE.md`.
- **The safety inboxes.** `safety@` and `privacy@` are published in the app and
  must reach a person.
- **Someone made admin.** Reports pile up unactionable until then.
- **A backup job.** `wrangler d1 export` on a schedule.

## Getting the first hundred people

Nothing else matters until this works. A social network with no people is a
static site with extra steps.

- Post the existing Loaded Dice community there first — they already know the
  brand and have work to show.
- Seed genuinely. Ten real build logs from ten real painters beat a thousand
  fake accounts, and fake accounts poison a community permanently.
- Weekly prompts ("show us your worst mould lines") give people a reason to post
  when they have nothing finished.
- **Do not** buy traffic before the feed has content. It converts at nothing and
  burns the impression.

## Next features, in order

1. **Project pages.** The schema and the API are done; the UI is a stub on the
   profile page. This is the differentiator against Instagram and it is nearly
   free to finish.
2. **Search.** D1 supports FTS5. Posts, tags and usernames.
3. **Paint links that resolve.** Right now `shopUrl` is stored but never filled
   in. Match paint names against the Loaded Dice catalogue at write time, via the
   Shopify Storefront API, and the "paints used" strip starts earning.
4. **Image moderation.** Workers AI can screen uploads for explicit content
   before publication. Cheap, and it takes the worst category off the queue.
5. **Follow suggestions.** "Painters who also do Necromunda" — the `systems`
   field on a profile already carries the signal.
6. **Email digests.** A weekly "what you missed" is the single most effective
   retention mechanic for a small community.

## Deferred on purpose

**Video.** Cut before launch. It brought Cloudflare Stream, a signed webhook, a
`processing` post state, a reconciliation sweep and an Access bypass — five
moving parts and a bill that grows with the library forever, for something that
is not what this hobby is. Bring it back when people ask for it, not before. The
working implementation is in git history at `a974c37`.

**The iOS app.** The API is versioned at `/api/v1`, which is all the groundwork
worth having until an app exists. The bearer-token plugin and the push-token
table were removed — they were scaffolding for something unbuilt, and untested
scaffolding rots.

When it does happen, the order that works:

1. **Read-only first.** Feed, post detail, profiles. Proves the API is complete
   and gets you through App Store review once with something small.
2. **Auth.** Sign in with Apple becomes mandatory (guideline 4.8) as soon as any
   other social login exists. Re-add the bearer plugin then.
3. **Posting.** The camera is the reason a hobby app exists on a phone. Direct
   upload to Images works identically from a native client.
4. **Push.** Re-add the token table and an APNs sender.

Build it with **Expo** — this codebase is already TypeScript and React, and the
taxonomy and API-client modules port straight across.

**What App Store review checks for a UGC app** (guideline 1.2): content
filtering, a report path, user blocking, published contact details, and evidence
reports are acted on within 24 hours. All of that exists on the web already; the
app has to expose it, not invent it.

## Further out

- Video, if enough people ask for it.
- Direct messages, only with moderation tooling built at the same time.
- A paid tier — no ads, bigger uploads, custom profile themes. A community this
  specific will support one, and it is a healthier revenue line than ads alone.
- Painting competitions with judging. Loaded Dice already runs them.
- Android. The Expo codebase makes it mostly a build target.

## Things worth not doing

- **An engagement-maximising algorithm.** The whole pitch is that this is not
  that. Discover being a published formula in one file is a feature.
- **Stories, streaks, or anything with a timer.** Painting a model takes weeks.
  Mechanics that punish absence are wrong for this hobby.
- **Selling user data.** Ads and the shop are the model. Anything else breaks
  the promise on the About page.
