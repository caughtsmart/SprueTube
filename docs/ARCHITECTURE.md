# Architecture

The decisions that are expensive to reverse, and why they went the way they did.

## One Worker, two halves

`workers/app.ts` looks at the path. `/api/*` goes to a Hono app; everything else
goes to the React Router SSR handler.

The alternative was two Workers with a service binding. One Worker won because:

- The site and its API share an origin, so session cookies just work. Two
  origins means either cross-subdomain cookie config or a token scheme on the
  web client too, both of which are more to get wrong.
- One deploy, one set of bindings, one place to look at logs.
- Splitting later is cheap: `server/api` is a self-contained Hono app that
  exports a fetch handler. Moving it out is a new `wrangler.jsonc` and a service
  binding, not a rewrite.

The API is versioned at `/api/v1` from day one. It costs one path segment, and
it means a client we do not control — a native app later, someone's script —
can keep working while the web app moves on. There is no other iOS groundwork:
that was cut until an app actually exists.

## Loaders call services, the browser calls the API

Server-rendered pages call `server/services/*` directly. The browser calls
`/api/v1/*`.

Both paths exist deliberately. A loader fetching its own Worker over HTTP would
pay for a second request and a second session lookup to reach code already in
the same isolate. But the HTTP API is not a second-class citizen — it is what
the feed's infinite scroll, every like and every photo upload run on, so it is
exercised constantly.

`app/lib/data.server.ts` is the bridge. The `.server.ts` suffix guarantees it
cannot end up in the client bundle regardless of how a route imports it.

## The taxonomy module

`app/lib/taxonomy.ts` holds the game systems, the WIP stages, the report reasons
and the size limits. It imports nothing, and the server's Zod schemas import
*from* it rather than the other way round.

This is not tidiness. The first version had the lists next to the validators, so
every route that rendered a dropdown pulled Zod (~70 kB) and the Drizzle schema
(~28 kB) into the browser bundle. Inverting the dependency removed both. If you
add a shared constant, it goes in taxonomy — never the reverse.

## Ids

Ids are `prefix_<base36 ms><counter><random>`, so `ORDER BY id` is creation
order. That makes keyset pagination work on the primary key with no secondary
index and no cursor table, and it makes ids self-describing in logs.

## Feed pagination

Keyset, not `OFFSET`. Cursors are `(sortKey, id)` pairs:

- Chronological feeds sort on `published_at`.
- Discover sorts on `hot_score`.

`OFFSET` on a live feed duplicates and skips rows as new posts land mid-scroll.
Keyset cannot, because the cursor names a position in the data rather than a
count of rows.

## Ranking

`server/services/ranking.ts`. Engagement over decayed age:

```
(likes + 3·comments + 0.02·views + 1) / (ageHours + 2)^1.5
```

Comments outweigh likes because a comment is a conversation and a like is a
reflex. The `+1` means a brand-new post with nothing on it still outranks an old
post with nothing on it, which is what stops the front page ossifying and new
painters never being seen.

The score is written on every engagement, and a cron sweep every 15 minutes
recomputes the last 72 hours so posts nobody touches still fall down the page.

That sweep runs in **JavaScript**, not one big SQL `UPDATE`. `power()` is an
optional SQLite build flag, and making the entire Discover feed depend on a
build flag we do not control is a bad trade for a query that runs 96 times a
day.

## Counts are denormalised

`like_count`, `follower_count`, `post_count` and friends are columns, not
`COUNT(*)`. Every writer updates them inside the same `db.batch()` as the row it
inserts — D1 runs a batch as one transaction, so a post and its counters land
together or not at all.

The trade is drift if a code path forgets. Decrements are all
`max(0, count - 1)` so drift can never render as a negative.

## Photos, not video

Cloudflare Images mints a one-time upload URL. The browser posts the file
straight to Cloudflare; the Worker only ever handles the id. A failed upload
costs nothing and the Workers body-size limit never comes into it.

**There is no video, and that is a decision rather than an omission.** Video
meant Cloudflare Stream, a signed webhook, a `processing` post state that hid
posts from every feed until a callback arrived, a reconciliation sweep for the
callbacks that never did, and a Cloudflare Access bypass so the callback could
reach us at all. That is five moving parts and a bill that grows with the
library forever, for a feature that is not what this hobby is about — miniature
painting is photographs.

It can come back when it earns its way. The shape to restore is in git history
at commit `a974c37`.

## Safety is in the schema, not bolted on

`report`, `block`, `mute` and `moderation_action` are first-class tables, and
`ReportButton` is on every post, comment and profile.

SprueTube is a UK user-to-user service, so the Online Safety Act applies: a
reporting path, swift handling of illegal content, and records of what was
decided. App Store guideline 1.2 wants the same shape. Both are far cheaper to
build now than to retrofit onto a live community.

Reports carry a `priority` derived from the reason, so the queue is ordered by
severity rather than arrival — child safety and illegal content are looked at
before someone's complaint about a repost. `moderation_action` is append-only:
never updated, never deleted, including for dismissals. "We looked at this and
decided to do nothing" is exactly the kind of thing you need to be able to
prove.

## Advertising in two layers

House ads live in D1 and render from day one. AdSense, when configured, takes
over the same slots.

House ads are not a placeholder. AdSense fills nowhere near 100% of impressions
on a small site, and an empty ad box is space that could have been a Loaded Dice
referral. Building against real ad-shaped boxes from the start also means the
layout was never designed as if ads did not exist.

Slots are injected every six posts and never at index 0. The first thing a
visitor sees should be a miniature somebody painted.

## Rendering user text

Post bodies are attacker-controlled. `parseBody` returns typed segments — text,
tag, mention, link — and the components render them as React nodes. There is no
`dangerouslySetInnerHTML` anywhere in the app, so there is no path from a post
body to executed markup.

User-supplied links carry `rel="nofollow ugc noopener noreferrer"`. Without
`nofollow`, a UGC site becomes an SEO spam target within weeks of anyone
noticing it exists.

## SEO

Server rendering is not a preference here, it is load-bearing. "How to paint
Death Guard rust" is a real query with real volume and every post is a potential
answer, so organic search is the cheapest growth available. AdSense also will not
approve a site that serves crawlers an empty shell.

Hence: SSR on, per-route meta and Open Graph tags, a sitemap covering public
posts and profiles, and `robots.txt` excluding the signed-in-only routes a
crawler could only ever see as a redirect.

## What is deliberately missing

- **Video.** See above.
- **Native-app groundwork.** No bearer tokens, no push-token table. The API is
  still versioned at `/api/v1`, which costs a path segment and means a future
  client is not blocked — but nothing is built for an app that does not exist.
- **Direct messages.** A DM system on a platform with one moderator is a
  harassment vector with no supervision.
- **A recommendation algorithm.** Discover is a published formula in one file.
- **Analytics tracking.** Nothing beyond the ad network's own.
- **Email.** No verification or password reset yet; both need a provider wired
  in. Tracked in `docs/ROADMAP.md`.
