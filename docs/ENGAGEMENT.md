# Engagement features

The community and discovery features, and how to operate them. Design notes live
next to the code; this is the "how do I run it" page.

## The discovery hub (`/explore`)

`/explore` is the front door for exploring the site — distinct from the home
feed, which stays the returning painter's own following/discover/latest feed.

It shows, in order: your pinned shortcuts (signed in), current painting
challenges, the top-painters board, browse-by-game and browse-by-theme chips,
recipes people are keeping, and the trending feed.

### Top painters — how the ranking works

`server/services/discovery.ts`, and it is a **published formula in one file** on
purpose, the same principle as Discover's `ranking.ts`:

```
score = engagement × (1 + 0.15 × min(weeksActive, 6))
engagement  = Σ (likes + 3·comments) over the painter's public posts in the
              last 45 days
weeksActive = distinct 7-day buckets they posted in, within that window
```

Consistency is a **gentle multiplier, never a streak**: a painter active across
six weeks is lifted by up to 90%, but a single high-engagement post still
outranks a low-engagement steady presence, and a quiet fortnight costs nothing.
The board is cached in KV for 15 minutes and each viewer's blocks/mutes are
applied to the cached list afterwards. Nothing here punishes absence — painting
a model takes weeks (see `ROADMAP.md`, "Things worth not doing").

## Pins

Signed-in people pin a game or a theme with the ☆ on its chip; pins gather into
a "Your shortcuts" row at the top of `/explore`. A pin is a personal reordering
only — it is never a ranking signal and never affects anyone else. Table `pin`,
service `server/services/pins.ts`, API `GET/POST/DELETE /api/v1/pins`.

## Painting challenges

A challenge is a themed reason to post. It names a prompt and a tag; the entries
are simply the posts carrying that tag — no entry table, no judging, no timer
that punishes a miss. Shown on `/explore` and as a one-line nudge on the
signed-in home feed.

**Add one** (no admin screen yet, the same trade as house ads):

```sql
INSERT INTO challenge (id, slug, title, prompt, tag, starts_at, ends_at, active)
VALUES (
  'ch_2026_09',
  'september-terrain',
  'Terrain month',
  'Paint the board, not the army. Show a piece of scenery you finished.',
  'terrainmonth',   -- letters/numbers/underscore only, so it works inline as #terrainmonth
  NULL,             -- starts_at: NULL = already running
  unixepoch('now', '+30 days'),  -- ends_at: NULL = evergreen
  1
);
```

Run it with `wrangler d1 execute spruetube --remote --command "…"`, or add it to
`scripts/seed.sql` and re-run the seed. Retire one by setting `active = 0`. The
tag must be a single token (letters, numbers, underscores) so people can write
`#terrainmonth` inline in a post body and have it count.

## House ads

Every ad is a Loaded Dice house ad from the `ad_placement` table — there is no
third-party ad network. Slots: `feed`, `sidebar`, `post`. Edit the rows to
change what runs; `weight` sets the share of impressions within a slot, and
`impressions`/`clicks` on each row show what is earning its place. Seeds live in
`scripts/seed.sql`. See `docs/DEPLOY.md` §7.

## Feedback (bugs & ideas)

`/feedback` collects bug reports and feature requests, separate from `/contact`.
Every submission is written to the `feedback` table (the durable record) and
emailed to `CONTACT_RECIPIENTS` as a nudge. It is honeypotted, rate limited (10
per hour per IP) and open to signed-out visitors.

**Read the queue:**

```bash
npx wrangler d1 execute spruetube --remote \
  --command "SELECT created_at, kind, title, status FROM feedback ORDER BY created_at DESC LIMIT 50"
```

`status` is `open` → `planned` / `done` / `declined`; update it by hand as you
work through them. There is no admin screen yet.

## Helpful marks & the Helpful badge

Recognition for being useful in the comments — the place painting tips actually
get given.

- **Mark helpful.** Every comment has a 💡 "Helpful" control (the comment-like
  endpoint under a clearer name). You cannot mark your own comment, so a
  comment's count is always *other people* vouching, and marks are one per
  person (the like table's primary key).
- **The tally.** `profile.helpfulCount` is the running total of helpful marks a
  person's comments have collected, shown as a "helpful marks" stat on their
  profile. Denormalised, kept in the same batch as the mark.
- **The badge.** `profile.helpfulBadge` — a small "💡 Helpful" chip by their
  name on their profile and on their comments. It is **gated**: awarded only the
  first time one of their comments is marked helpful by
  `HELPFUL_BADGE_THRESHOLD` (3) distinct other people — three people finding one
  comment useful, not three scattered marks. It is **sticky**: once earned it
  stays (a badge you keep re-earning is a timer, which this site does not do).

The threshold lives in `server/services/helpful.ts` (pure, tested); the award
happens in `toggleCommentLike` (`server/api/routes/content.ts`). Surfaced today
on the post page and profile; image/build-log comments use the same endpoint and
count toward the badge, and can show the button later.

## Sharing

Every post card has a Share control. On a device with the native share sheet it
hands off to it; everywhere else it offers copy-link plus X, Facebook, Reddit,
Bluesky, WhatsApp and email. All plain links to public composers — no network
SDKs and no cookies. `app/lib/share.ts` builds the links; `ShareButton` renders
the menu.
