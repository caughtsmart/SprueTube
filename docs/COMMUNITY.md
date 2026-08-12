# Community and gamification

A design for two things people ask a hobby network for: somewhere to *belong*,
and a reason to *keep showing up*. Both are what draws people to Reddit. Neither
is built here yet — grouping is only the game-system and tag taxonomy, and the
only recognition on the site is a like count and the homepage highlights strip.

This document plans them in the order they should be built, and — because both
are the kind of feature that is easy to get wrong — it is as much about what we
will **not** build as what we will.

> **Status.** Design only. Nothing here is built. Web Push
> (`docs/NOTIFICATIONS.md`) is a soft dependency: challenge results and awards
> are far better as a push than a bell badge nobody sees, but every part of this
> degrades to in-app notifications if push is still dormant.

## The thesis: reward making, not talking

Reddit is a machine for *talking*. Text, upvotes, downvotes, and karma for
volume. If SprueTube builds that, it is a worse Reddit with a hundredth of the
users. The atoms here are different and stronger: people photograph physical
things they are actually making, and the schema already captures the one axis
Reddit structurally cannot — **progress**. `post.wipStage` runs sprue →
assembled → primed → … → finished, and a `project` is a build log that tells
that story start to end.

So the whole design leans one way: **Reddit gamifies talking; SprueTube rewards
making and finishing.** A community here is people working on the same thing, not
people arguing about it. A reward here is recognition for a model painted or a
newcomer helped, not a number that goes up when you post a hot take.

This is not a tone preference. It is the difference between a mechanic that makes
someone finish the kit that has sat primed on their desk for a year, and one that
makes them refresh a feed. Only the first is worth building.

## What the roadmap already forbids, and why it is right

`docs/ROADMAP.md` has a "Things worth not doing" section, and two of its three
entries land directly on this work. They are load-bearing constraints, not
suggestions:

- **"Stories, streaks, or anything with a timer. Painting a model takes weeks.
  Mechanics that punish absence are wrong for this hobby."** So there are **no
  streaks here.** A daily-streak counter is the single most obvious gamification
  mechanic and it is banned on purpose: it would punish the person who spent the
  week actually painting instead of posting, which is precisely backwards. The
  test every mechanic below has to pass: *does it reward the hobby, or does it
  reward opening the app?* Anything that only rewards the second is out.
- **"An engagement-maximising algorithm. The whole pitch is that this is not
  that. Discover being a published formula in one file is a feature."** So every
  score in this document — how a challenge is judged, how a badge is earned, what
  makes the recognition strip — is a **published rule in one file**, the way
  `server/services/ranking.ts` is. No opaque XP curve tuned in the dark to lift a
  daily-actives graph. If we cannot write the rule on the About page without
  embarrassment, it does not ship.

There is a real tension to name out loud: gamification is *usually* the dark-
pattern toolkit, and this codebase's entire pitch is being the opposite of that.
The resolution is that the mechanics here are the **trophy cabinet, not the slot
machine** — recognition of things that already happened, on transparent rules,
never a variable-reward loop engineered to be compulsive.

---

# Part one: Communities

## The gap

Content is already grouped. `getFeed` in `server/services/feed.ts` filters by
`gameSystem`, `/systems/:system` renders that feed, `/tags/:tag` renders a tag
feed, and a profile carries a `systems` array. What is missing is **belonging**:
there is no act of *joining*, no membership, no "your communities", no place that
is a community's own — an about, its rules, its pinned work, its people. You can
read the Necromunda feed; you cannot *be* a Necromunda person on the site in any
way the site records.

## The decision: curate communities, do not let anyone create them

The obvious move is a `group` table anyone can create — subreddits. We are not
doing that first, and possibly not at all, for the same reason DMs were cut
(`docs/ARCHITECTURE.md`): **a feature that multiplies moderation surface on a
platform with one moderator is a liability, not a feature.** Open group creation
brings the two failure modes Reddit spent fifteen years fighting:

- **Dead communities.** A thousand groups with one post each. The taxonomy does
  not have this problem because content already flows through it — the Warhammer
  40K feed is never empty.
- **Unsupervised spaces.** A user-created group is a room whose door the operator
  did not build and cannot see into, on a UK user-to-user service where the
  Online Safety Act makes the operator responsible for what happens in it.

So **communities are the existing taxonomy, promoted to first-class objects** —
curated, finite, already full of content — with membership and identity layered
on. Every game system becomes a community. Nobody has to seed one, and there is a
bounded, known list to moderate.

Open, user-created **Clubs** — a real-world gaming club or a painting circle
running its own space — is a genuinely good idea and a natural paid-tier or
later feature, but it inherits every moderation problem above and should not lead.
It is in "Further out" at the end of this document, not here.

## Schema

The taxonomy in `app/lib/taxonomy.ts` stays the source of truth for *which*
communities exist — a community cannot exist for a system that is not a real
system. A new table holds only the editable, per-community state that does not
belong in a code constant.

### `community`

One row per system slug, created lazily the first time an admin edits it or the
first member joins. Absence means "use the taxonomy defaults", so no backfill and
no migration of the existing systems is needed.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `comm_` + the standard id scheme. |
| `slug` | text, unique | The system slug from `taxonomy.ts`. The join key to feeds and profiles. |
| `description` | text, null | The "about" panel. Falls back to a taxonomy default. |
| `rules` | text, null | Community-specific posting rules, shown on the page and in the report context. |
| `banner_image_id` | text, null | Cloudflare Images id, same as a profile banner. |
| `pinned_post_id` | text, null → post | One pinned post, like a project's `pinnedPostId`. |
| `member_count` | int, default 0 | Denormalised, batched with the join/leave write, `max(0, n-1)` on leave — the house pattern. |
| `created_at` / `updated_at` | int | |

### `community_member`

| Column | Type | Meaning |
| --- | --- | --- |
| `community_id` | text, FK → community, cascade | |
| `user_id` | text, FK → user, cascade | |
| `role` | text enum | `member` \| `moderator`. A community moderator is scoped to one community; the global `profile.role` is unchanged and still outranks it. |
| `created_at` | int | |

Composite primary key `(community_id, user_id)` — a person is in a community once
— which doubles as the "am I a member" lookup and the membership-list index, the
same shape as `follow` and `like`.

## What a community page is

`/systems/:system` stops being only a feed and becomes the community. Reusing the
existing route means every link already pointing there keeps working.

- A **header**: name, banner, member count, a **Join** button (the only genuinely
  new interaction — everything below already exists).
- The **feed**, exactly `getFeed({ gameSystem })` as today.
- An **about / rules** panel from the `community` row.
- A **pinned post**, reusing the project pin pattern.
- **Your communities** becomes a nav section and a home surface: the systems you
  have joined, so the site has a shape that is *yours* rather than one global
  feed. This is the belonging the gap was about.

Joining also gives the feed a real "Following"-style signal it lacks: a
"communities" home tab can show posts from systems you joined, which is a better
cold-start feed for a new painter than "people you follow" when they follow
nobody yet.

## Moderation

A `community_member.role` of `moderator` may remove a post *from the community*
(unset its `gameSystem`, not delete it) and pin. Every such action writes a
`moderation_action` row exactly as global moderation does — the audit log is
append-only and already built, and community mod actions belong in it for the
same Online Safety Act reason global ones do. Reports from a community page carry
the community's `rules` into the report context so the queue sees which rule was
broken. No new moderation *machinery* — only a new, narrower actor who can reach
part of it.

---

# Part two: Gamification

Four mechanics, each of which had to pass *rewards the hobby, not the app*. They
are ordered by how native they are to the craft.

## 1. Achievements — the trophy cabinet

Recognition for things a painter actually did, shown on their profile. Not a
level, not points, not a currency. A badge is binary and permanent: you finished
your first build log, or you have not yet.

The catalogue is **code, not data** — a constant in `app/lib/taxonomy.ts` beside
the WIP stages, so a badge's existence and its rule live in the same reviewed,
version-controlled place as everything else transparent on this site. Only the
*award* is a row.

### `user_badge`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `badge_` + id scheme. |
| `user_id` | text, FK → user, cascade | |
| `badge_slug` | text | Key into the code catalogue. |
| `awarded_at` | int | |
| `context_id` | text, null | The post/project/community that earned it, for a "for *this*" link. |

Unique on `(user_id, badge_slug)` — a badge is earned once. A small
`badge_count` on `profile` follows the denormalisation convention so a profile
header needs no `COUNT(*)`.

### What earns one, and how it is checked

Every rule is a pure predicate over data that already exists, evaluated at the
moment the triggering write happens (a post published, a project marked
finished) — never a background scan of everyone. Starting set, all derived from
existing tables:

- **First finished build log** — a `project` moved to `status = 'finished'`.
- **The full journey** — a project whose posts span `sprue` through `finished`
  in `wipStage`. This one badge does more for the product than any streak could:
  it rewards documenting a model from frame to finish, which is exactly the
  content the site wants and the hardest to get.
- **Helping hand** — passed a threshold of *helpful* marks (Part two, §3).
- **Challenge wins / entries** — awarded by the challenge machinery (§2).
- **Community founder-era** — an early member of a community, from
  `community_member.created_at`. A one-off, not a recurring timer.

Awards fan out through the existing `createNotification()` — a new `badge`
notification type — so they arrive by push once push is live, and never punish
absence: you earn a badge by doing the thing, whenever you do it.

**Anti-gaming.** Because every badge is binary and tied to a durable artefact (a
finished project, a real win), there is nothing to farm — you cannot post your
way to "finished a build log" without finishing a build log. Removing the
artefact (deleting the project) revokes the badge in the same write.

## 2. Challenges — the flagship

Time-boxed, themed events people opt into: *"Paint the oldest kit in your pile."*
*"Squad of the month."* *"Best rust."* This is the one mechanic that is both
community and gamification at once, and it is already on the roadmap —
"Painting competitions with judging. Loaded Dice already runs them." It is the
feature most worth building well.

It also threads the streak ban precisely. A challenge has a deadline, but it is a
deadline you **chose to enter**, and not entering costs you nothing — no counter
resets, no badge is lost, the page does not guilt you. That is the whole
difference between a competition and a streak: one is an invitation, the other a
punishment for living your life.

### Schema

#### `challenge`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `chl_` + id scheme. |
| `community_id` | text, null → community | Scoped to a community, or site-wide if null. |
| `title` / `prompt` | text | The brief. |
| `opens_at` / `closes_at` | int | The window. Entries only in it. |
| `status` | text enum | `scheduled` \| `open` \| `judging` \| `closed`. Advanced by cron, never by hand. |
| `judging` | text enum | `community` (most likes among entries) \| `moderator` (a judge picks). |
| `winner_post_id` | text, null | Set when it closes. |
| `entry_count` | int, default 0 | Denormalised. |

#### `challenge_entry`

An entry is a **post** — no new content type, no second compose flow. A post
enters by pointing at the challenge.

| Column | Type | Meaning |
| --- | --- | --- |
| `challenge_id` | text, FK, cascade | |
| `post_id` | text, FK, cascade | |
| `user_id` | text, FK, cascade | The entrant, denormalised off the post for the per-person cap. |
| `created_at` | int | |

Primary key `(challenge_id, post_id)`. A per-person entry cap (one, usually) is
enforced on `user_id` at write time.

### Lifecycle, on the existing cron

There is one cron (`*/15 * * * *`), and the convention (`docs/NOTIFICATIONS.md`,
the news ingest, `refreshHotScores`) is that new scheduled work **rides that tick
and picks its own slot** rather than adding a schedule. Challenges do the same:

1. `scheduled → open` when `opens_at` passes.
2. `open → judging` when `closes_at` passes.
3. In `judging`: for `community` judging, the winner is the entry with the most
   likes — reusing the like count already on every post, no new voting system and
   nothing new to game beyond likes themselves. For `moderator` judging, it waits
   for a human pick.
4. `judging → closed`: set `winner_post_id`, award a **challenge-winner badge**
   to the winner and an **entrant badge** to everyone who entered (entering is
   itself worth marking — it is the participation the site wants), and notify all
   of them through `createNotification()`.

Bounded, paged work per tick, like the digest and the hot-score sweep, so a busy
month cannot blow the D1 statement limit in one invocation.

### Why this beats a leaderboard

A challenge is a *level playing field with a fresh start* — everyone begins the
month at zero entries. That is the opposite of a global all-time chart, which
just crowns whoever already had the most followers and demoralises everyone else.
The next section makes that principle general.

## 3. Helpfulness — reputation for teachers, not talkers

Karma rewards whoever posts most. The person who quietly answers "how did you get
that oil-wash so clean" in ten comment threads is the reason a community is worth
being in, and a like does not capture it — a like is a reflex (the ranking file
says so), and it lands on pretty pictures, not good answers.

So: a **"this helped me" mark on a comment**, distinct from a like. It is a new
table rather than a reuse of the polymorphic `like`, because it means something
different and should be counted and displayed differently.

### `helpful`

| Column | Type | Meaning |
| --- | --- | --- |
| `comment_id` | text, FK → comment, cascade | |
| `user_id` | text, FK → user, cascade | The person helped. |
| `created_at` | int | |

Primary key `(comment_id, user_id)` — one mark per person per comment, the same
idempotent shape as `like`, so it cannot be farmed by clicking twice.
`comment.helpful_count` and `profile.helpful_received_count` are denormalised in
the write batch, and the profile figure is the only reputation number on the
site: not "karma", but "found helpful **147** times", which says exactly what it
means and rewards exactly the right behaviour.

## 4. Recognition surfaces, not leaderboards

The homepage already has the right instinct in `server/services/highlights.ts`:
its own comment says it shows "a wall of models rather than a leaderboard of
posts", and it **caps two per author** so one good month cannot become one
person's gallery. That is the model for all recognition here, and it is why there
is no global ranked chart anywhere in this design.

Reusing that exact pattern (compute in KV every 15 minutes, cap per author, apply
the viewer's blocks to a short candidate list afterwards):

- **Community highlights** — the highlights strip, scoped to one community, on
  its page.
- **Newcomer spotlight** — recent good work by people who joined recently, using
  `profile.created_at`. New painters being seen is called out in the ranking file
  as the thing that stops the front page ossifying; this makes it a surface.
- **Challenge galleries** — every entry to a closed challenge, winner first, the
  rest an unranked wall. The losers are not a list of losers.

No all-time top-users board. It is the one recognition surface that would pull the
whole site toward *rewards the app, not the hobby*, and it is deliberately absent
for the same reason the engagement algorithm is.

---

## Notifications

Everything above fans out through the one existing choke point,
`createNotification()` (`docs/NOTIFICATIONS.md`). New `notification` types —
`badge`, `challenge_result`, `helpful` — slot into the existing enum and the
existing `muted_types` preference, so a person who does not want to hear about
likes-analogues can silence them and nothing about the plumbing is new. Once Web
Push is live, a challenge result or a badge arrives as a push with no extra work;
until then it is a bell badge, exactly like every other notification today.

## Safety

New surfaces are new abuse surfaces, and the schema-first safety posture
(`docs/ARCHITECTURE.md`) applies:

- **Community pages and challenge entries** are posts and profiles under the
  hood, so `ReportButton`, `block` and `mute` already cover them — the
  `hiddenAmong` filter in `highlights.ts` is reused verbatim for every new
  recognition surface, so a blocked painter never appears in a spotlight or a
  challenge gallery either.
- **Badges and helpful marks** are un-forgeable by construction (tied to durable
  artefacts; idempotent composite keys) and carry no free-text, so they are not a
  harassment channel the way a rename or a bio can be.
- **Community moderators** act only within their community and every action they
  take is in the append-only `moderation_action` log, so a bad community mod is
  auditable and reversible by a global moderator.

## Migrations

Additive only, generated with `npm run db:generate` per the existing workflow:
`community`, `community_member`, `user_badge`, `challenge`, `challenge_entry`,
`helpful`, plus the denormalised counters (`community.member_count`,
`profile.badge_count`, `profile.helpful_received_count`, `comment.helpful_count`,
`challenge.entry_count`). Every existing account and post behaves exactly as it
does today with none of these rows present — a person who joins nothing, enters
nothing and is marked helpful by nobody sees the site unchanged.

## Testing

Following the `tests/logic.test.ts` and highlights style — pure logic gets unit
tests, the rest is thin:

- **Challenge state machine** — `scheduled → open → judging → closed` on given
  clock times, community-judging winner selection, the per-person entry cap.
- **Badge predicates** — each rule is a pure function of existing rows; test that
  a full sprue→finished project earns the journey badge and a three-post project
  missing `primed` does not.
- **Idempotent marks** — a second `helpful` from the same person is a no-op and
  does not double the count; a `410`-style delete decrements with the
  `max(0, n-1)` floor.
- **Hidden filtering** — a blocked author is absent from community highlights,
  the newcomer spotlight and a challenge gallery, reusing the highlights tests.

## Build order

Ordered by what unlocks what, and so that each step is worth shipping alone.

1. **Communities** — `community` + `community_member`, the Join button, the
   community page over the existing system feed, "your communities" in nav. This
   is *belonging*, it reuses `getFeed` almost entirely, and it is the ground the
   rest stands on (a challenge is scoped to a community; a community highlight is
   a scoped highlight).
2. **Achievements** — `user_badge`, the code catalogue, the award hooks on
   publish/finish, the profile display. Small, self-contained, and it makes the
   next step's rewards mean something.
3. **Challenges** — the flagship. `challenge` + `challenge_entry`, entry from the
   existing compose flow, the cron lifecycle, community-then-moderator judging,
   winner and entrant badges, the challenge gallery.
4. **Helpfulness** — the `helpful` mark and the one reputation number. Last
   because it is the least urgent and the most easily added once the rest exists.

## Further out — deliberately not first

- **User-created Clubs.** Real gaming clubs and painting circles running their
  own space. A strong feature and a natural paid tier, but it reintroduces every
  moderation problem that curated communities avoid, so it waits until there is
  more than one moderator and a reason. The `community` table is already the
  shape it would take.
- **The pile of shame.** A personal backlog tracker — the beloved hobby meme of
  unbuilt kits — that celebrates a kit moving from "in the pile" to "painted". It
  is a genuinely native retention tool *if* it is framed as help finishing and
  never as a timer counting your guilt. It is a new content type rather than a
  layer on existing ones, so it is a larger build than anything above and belongs
  in its own design.
- **A paid tier around all of this** — a bigger trophy cabinet, custom community
  themes, running your own challenge — is the healthier revenue line the roadmap
  already anticipates, and this feature set is what would carry it.
