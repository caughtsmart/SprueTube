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
newcomer helped, not a number that climbs when you post a hot take.

### An honesty about retention, and about Reddit

Two things have to be said plainly, because the rest of the document is only
honest if they are.

**Gamification is not the retention engine, and nothing here pretends it is.**
The real reason a small hobby network keeps someone is the plain social loop it
*already* ships: "someone answered my WIP question", "someone commented on my
army". Everything below is **recognition and belonging layered on top of that
loop** — a trophy cabinet, not a slot machine, and deliberately not a variable-
reward mechanic engineered to be compulsive. A badge you earn once and keep
forever is, by construction, not a thing that pulls you back tomorrow. That is a
feature, not an oversight: the roadmap forbids the mechanics that *would* pull you
back compulsively, and we are keeping that promise even where it costs us the
easy retention win.

**Gamification is also not the migration story.** r/minipainting is half a
million people with instant answers and years of SEO. Nobody defects from that
for a badge. What actually pulls a painter here is the *tooling Reddit cannot
build* — structured build logs instead of flat threads, paint lists that resolve
to a shop, the WIP-stage spine — most of which already exists or is on the
roadmap. This document is mostly for the people **already here**, to make them
stay and feel part of something. Where a mechanic *does* help acquisition, it is
called out; the rest is retention-of-the-committed, not conquest of Reddit. (And
the painters who most value "finishing" are as likely to be on **Instagram** as
Reddit — a useful thing to remember when the wording drifts toward "beat
Reddit".)

## What the roadmap already forbids, and why it is right

`docs/ROADMAP.md` has a "Things worth not doing" section, and two of its three
entries land directly on this work. They are load-bearing constraints:

- **"Stories, streaks, or anything with a timer. Painting a model takes weeks.
  Mechanics that punish absence are wrong for this hobby."** So there are **no
  streaks here.** The test every mechanic below has to pass: *does it reward the
  hobby, or does it reward opening the app?* One mechanic — challenges — has a
  deadline, and §Challenges argues *explicitly and by the ban's rationale rather
  than its letter* why a chosen, no-penalty deadline is not the thing the ban is
  about. It does not pretend a `closes_at` is not a timer; it argues it is a
  harmless one.
- **"An engagement-maximising algorithm. The whole pitch is that this is not
  that. Discover being a published formula in one file is a feature."** So every
  score here — how a challenge is judged, what earns a badge, what fills a
  recognition strip — is a **published rule in code**, the way
  `server/services/ranking.ts` is. No opaque XP curve tuned in the dark to lift a
  daily-actives graph.

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
doing that first, and possibly not at all. The reason is the safety posture the
architecture already commits to (`docs/ARCHITECTURE.md`, "Safety is in the schema,
not bolted on"): SprueTube is a UK user-to-user service under the Online Safety
Act, run by **one moderator**. Open group creation multiplies the moderation
surface without multiplying the moderators, and brings the two failure modes
Reddit spent fifteen years fighting:

- **Dead communities.** A thousand groups with one post each. The taxonomy does
  not have this problem because content already flows through it — the Warhammer
  40K feed is never empty.
- **Unsupervised spaces.** A user-created group is a room whose door the operator
  did not build and cannot see into, on a service where the operator is legally
  responsible for what happens in it.

So **communities are the existing taxonomy, promoted to first-class objects** —
curated, finite, already full of content — with membership and identity layered
on. Every game system becomes a community. Nobody has to seed one, and there is a
bounded, known list to moderate.

Open, user-created **Clubs** — a real-world gaming club or painting circle
running its own space — is a genuinely good idea and a natural paid-tier feature,
but it inherits every moderation problem above and must not lead. It is in
"Further out".

## Schema

The taxonomy in `app/lib/taxonomy.ts` stays the source of truth for *which*
communities exist — a community cannot exist for a system that is not a real
system. A new table holds only the editable, per-community state that does not
belong in a code constant.

### `community`

One row per system slug, created lazily the first time an admin edits it or the
first member joins. Absence means "use the taxonomy defaults", so no backfill.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `comm_` + the standard id scheme. |
| `slug` | text, unique | The system slug from `taxonomy.ts`. The join key to feeds and profiles. |
| `description` | text, null | The "about" panel. Falls back to a taxonomy default. |
| `rules` | text, null | Community-specific posting rules. |
| `banner_image_id` | text, null | Cloudflare Images id, same as a profile banner. |
| `pinned_post_id` | text, null, FK → post | One pinned post. Unlike `project.pinnedPostId` (which carries *no* FK, to avoid a circular table-definition bootstrap — see `schema.ts`), this table is declared after `post`, so it can carry a real foreign key. |
| `member_count` | int, default 0 | Denormalised, batched with the join/leave write, `max(0, n-1)` on leave. |
| `created_at` / `updated_at` | int | |

### `community_member`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `cmem_` + id scheme. A monotonic id so membership lists paginate keyset on the primary key, like every other list on the site (`docs/ARCHITECTURE.md`, "Ids") rather than falling back to `OFFSET`. |
| `community_id` | text, FK → community, cascade | |
| `user_id` | text, FK → user, cascade | |
| `role` | text enum | `member` \| `moderator`. Scoped to one community; the global `profile.role` is unchanged and still outranks it. |
| `created_at` | int | |

A unique constraint on `(community_id, user_id)` — a person is in a community
once — is the "am I a member" lookup and the membership index, the same role the
composite key plays on `follow` and `like`; the separate `id` exists only so the
list is keyset-pageable.

## What a community page is

`/systems/:system` stops being only a feed and becomes the community. Reusing the
existing route means every link already pointing there keeps working.

- A **header**: name, banner, a **Join** button (the only genuinely new
  interaction — everything below already exists).
- The **feed**, exactly `getFeed({ gameSystem })` as today.
- An **about / rules** panel from the `community` row.
- A **pinned post**.
- **Your communities** becomes a nav section and a home surface: the systems you
  joined. Joining also gives a real "communities" home feed — posts from systems
  you joined — which is a better cold-start feed for a new painter than "people
  you follow" when they follow nobody yet.

## Small numbers are a deadness signal — hide them until they aren't

This is the correction that makes communities safe to ship at a hundred users.
A **`member_count` of 3 next to a Join button reads as "abandoned", not
"exclusive"** — surfacing a small number is worse than surfacing none. So:

- **Member counts and per-community highlight strips are hidden below a
  threshold** (start at ~25 members / ~10 distinct recent authors, tuned in one
  constant). Below it, the page shows the feed and the Join button and *no
  numbers*. The community still works; it just does not advertise its own
  emptiness. This mirrors what Reddit itself learned about suppressing low counts.
- The threshold lives beside the highlights constants, published like everything
  else — not a hidden growth hack, a stated "we don't show a number until it
  means something".

## Moderation

A `community_member.role` of `moderator` may remove a post *from the community*
(unset its `gameSystem`, not delete it) and pin. Three honest consequences the
first draft glossed:

1. **This needs a new `moderation_action.action` value.** That enum is a closed
   set today (`remove_post`, `restore_post`, … — `schema.ts`) with no
   "remove-from-community" or "pin" member. Recording a community-mod action
   faithfully — which the append-only audit log and the OSA both require — means
   an additive enum change and its migration. It is small, but it is *not* "no new
   machinery"; it is new machinery that reuses the existing table.
2. **Appointing a community moderator is itself an admin-only, logged action.**
   The whole case against user-created groups is unsupervised delegated power, so
   we do not then hand out delegated power casually: community mods are appointed
   by a global admin only, cannot appoint others, and the appointment writes to
   `moderation_action` like any other privileged act. Otherwise the clubs
   rejection and the community-mod grant would be governed by inconsistent
   standards.
3. **The community's own `description`/`rules` are admin/mod-authored free text**,
   and unlike a post they are not automatically covered by `ReportButton`. They
   need the same report path a bio has. Reports from a community page carry the
   broken rule in the report `details` field (the `report` table has a `reason`
   enum plus free-text `details`, no structured rule field), which is workable,
   not literal.

---

# Part two: Gamification

The trophy cabinet, not the slot machine. Four mechanics — but reordered from the
first draft, because the review made one thing obvious: **most of these need a
crowd, and the site does not have one yet.** Only two work when there are fifty
people in the building, and those two now lead.

| Mechanic | Works at tiny scale? | Why |
| --- | --- | --- |
| **Helpfulness marks** | ✅ Yes | One person helping one person is a complete unit. Needs no crowd. |
| **Challenges (moderator-judged / sponsored)** | ✅ Yes | Graham picks a winner from three entries. Works day one. |
| **Achievements / badges** | ⚠️ Partly | Individual, but the most generic mechanic and the least differentiating. |
| **Challenges (community-judged, most-likes)** | ❌ No | "Winner by most likes" among two entries and five voters is a popularity vote among friends. |
| **Recognition strips** | ❌ No | A wall capped at two-per-author needs more than two authors. |

## 1. Helpfulness — reputation for teachers, not talkers (build first)

Karma rewards whoever posts most. The person who quietly answers "how did you get
that oil-wash so clean" in ten threads is the reason a community is worth being
in, and a like does not capture it — `ranking.ts` itself says a like is a reflex,
and it lands on pretty pictures, not good answers.

So: a **"this helped me" mark on a comment**, distinct from a like — a new table,
because it means something different and should be counted and shown differently.
It leads the build order precisely because it is the one mechanic that is *fully
alive at any scale*: it needs no crowd, and "found helpful 147 times" is the most
defensible answer to Reddit karma this design has.

### `helpful`

| Column | Type | Meaning |
| --- | --- | --- |
| `comment_id` | text, FK → comment, cascade | |
| `user_id` | text, FK → user, cascade | The person helped. |
| `created_at` | int | |

Primary key `(comment_id, user_id)` — one mark per person per comment, the same
idempotent shape as `like`, so a second click is a no-op and it cannot be farmed.
`comment.helpful_count` and `profile.helpful_received_count` are denormalised in
the write batch.

**On the "not a number that goes up" thesis.** The thesis above says the reward
is "not a number that climbs when you post a hot take", and here is a number that
climbs. That is deliberate and it is the *single* exception: it is bounded to a
behaviour the site actively wants (helping), not to volume, and it is capped at
one per person per comment so it cannot be inflated by posting more. It is a
number that goes up *for teaching*, which is the one thing worth counting. The
thesis is not "no counts ever"; it is "no count that rewards noise" — and this
one does not.

## 2. Challenges — the flagship, led by its sponsored variant

Time-boxed, themed events people opt into. Already on the roadmap — "Painting
competitions with judging. Loaded Dice already runs them." The most valuable
mechanic here, and the review sharpened three things about it.

**Lead with real prizes, not badges.** The single change that makes a hundred
people actually show up is a **Loaded Dice-sponsored challenge with a real prize**
— a paint set, a voucher. The commercial tie-in is right there and the first
draft used one line of it. A monthly sponsored challenge funds itself in goodwill,
gives "an invitation, not a punishment" real stakes, and motivates more than the
entire badge catalogue combined. This is the acquisition-helping mechanic; treat
it as the headline.

**Ride the hobby's real calendar; do not invent one.** Painters already rally
around named seasonal events with existing gravity — **Dreadtober**,
**Squaduary**, **Armies on Parade** season. A challenge that rides one of those
walks into a crowd; a home-grown "Best Rust" for an empty network starts a party
in an empty room. The schema below is event-shaped precisely so it can host an
existing event, not only a bespoke one.

**Default to moderator judging; treat most-likes as the crowd-only variant.** See
the state machine.

### Schema

#### `challenge`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `chl_` + id scheme. |
| `community_id` | text, null → community | Scoped to a community, or site-wide. |
| `title` / `prompt` | text | The brief. |
| `opens_at` / `closes_at` | int | The window. Entries only in it. |
| `status` | text enum | `scheduled` \| `open` \| `judging` \| `closed`. Advanced by cron. |
| `judging` | text enum | `moderator` (a judge picks — the **default**) \| `community` (most likes among entries). |
| `sponsor` | text, null | e.g. a Loaded Dice prize line, shown on the page. |
| `winner_post_id` | text, null | Set when it closes. |
| `entry_count` | int, default 0 | Denormalised. |

#### `challenge_entry`

An entry is a **post** — no new content type, no second compose flow.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text, PK | `cent_` + id scheme, so the entry list / gallery paginates keyset. |
| `challenge_id` | text, FK, cascade | |
| `post_id` | text, FK, cascade | |
| `user_id` | text, FK, cascade | The entrant, for the per-person cap. |
| `created_at` | int | |

A unique `(challenge_id, post_id)`, and a per-person entry cap on `user_id`
enforced at write time.

### Lifecycle, on the existing cron

One cron (`*/15 * * * *`); new scheduled work **rides that tick and picks its own
slot** (`docs/NOTIFICATIONS.md`, `refreshHotScores`). Challenges do the same:

1. `scheduled → open` when `opens_at` passes.
2. `open → judging` when `closes_at` passes.
3. In `judging`: **moderator** judging (the default) waits for a human pick.
   **community** judging takes the entry with the most likes — see the
   manipulation note below.
4. `judging → closed`: set `winner_post_id`, award a winner badge and an entrant
   badge (see §3 for why entering is markable), notify all through
   `createNotification()`.

Bounded, paged work per tick, like the digest and the hot-score sweep.

**Like-manipulation is a real vector for community judging, and it is guarded.**
The moment likes *decide a public winner*, they invite brigading and sockpuppet
votes in a way the ambient feed never does — a gap the first draft waved away
with "nothing new to game". So: **moderator judging is the default for anything
with a prize**, and community judging discounts likes from accounts created after
the challenge opened and from anyone the entrant has blocked/been blocked by. The
schema-first safety posture applies to the *deciding metric*, not only to the
entries.

**On the timer ban, stated plainly.** `closes_at` is a timer. The roadmap bans
timers because "mechanics that punish absence are wrong for this hobby" — so this
is a reasoned exception to the *letter* of the ban, justified by its *rationale*:
a challenge deadline punishes nothing. You opt in; not entering costs you nothing;
no counter resets; nothing is lost. It is a competition, not a streak, and the
distinction is the presence or absence of punishment, which the rationale is
about. If a challenge ever grew a penalty for non-participation, it would fall
under the ban.

## 3. Achievements — a garnish, not a course

Binary, permanent badges tied to durable artefacts, shown on a profile. Demoted
from the first draft's second slot to a garnish, because the review is right: as a
standalone build they are the most generic, most "gamification-y", least
differentiating thing here. **Ship one or two badges as a garnish on Helpfulness
and Challenges; do not spend a dedicated build cycle on a trophy cabinet before
the room has people in it.**

Two honest corrections to how they were specified:

**Split the catalogue from the rule.** The first draft put both a badge's data
*and its earning rule* in `taxonomy.ts`. That breaks the module's "imports
nothing" invariant (`docs/ARCHITECTURE.md`, "The taxonomy module") — the
catalogue (slug, label, description) is data and belongs there; the **earning
predicate is logic** over `post`/`project` rows and belongs in a service,
`server/services/badges.ts`, the `ranking.ts` analogue. Taxonomy keeps importing
nothing; the predicate takes already-loaded plain data.

**Be honest about what "the full journey" badge rewards.** A badge for a project
whose posts span `sprue` through `finished` does **not** reward *painting well* —
it rewards *documenting a build stage by stage*, which is a discipline most
hobbyists do not naturally follow, and performing it is partly feed-serving
behaviour. That is defensible, but only if stated: the site *wants* documented
build logs (they are the best content and the SEO answers to "how to paint X"), so
rewarding documentation is a legitimate aim — as long as we never dress it up as
rewarding craft. The badge is "you documented a full build", not "you are a good
painter".

**Drop the founder-era badge.** "Early member of a community" fails the design's
own headline test — joining is a pure app action with no craft artefact, so it
rewards *opening the app early*, exactly what the thesis rules out. It also breaks
the "nothing to farm, every badge tied to a durable artefact" guarantee. Cut it.
The **entrant badge** is the milder, acceptable version — it is one-time and tied
to a posted model — and the anti-gaming claim is narrowed to match: *every badge
is tied either to a durable craft artefact or to a one-time, non-repeatable act
that cannot be farmed.*

Starting set, all pure predicates over existing rows: **first finished build log**
(`project.status = 'finished'`), **the full journey** (documented sprue→finished,
framed as above), **helping hand** (a threshold of `helpful` marks), **challenge
winner / entrant**. Awards fan out through `createNotification()`; removing the
artefact revokes the badge in the same write.

## 4. Recognition surfaces, not leaderboards (crowd-gated)

The homepage highlights instinct is right — `highlights.ts` shows "a wall of
models rather than a leaderboard of posts" and caps two per author so one good
month is not one person's gallery. That is the model, and there is **no global
all-time leaderboard anywhere in this design** — it is the one surface that would
pull the whole site toward *rewarding the app*.

But this is crowd-gated and the first draft overstated the reuse. Three
corrections:

- **The pattern is reusable; the code is not "verbatim".** `getHighlights` reads
  one global KV key (`highlights:v1`) over one global candidate set, and
  `topProjects`/`topImages` take no scoping argument. Community-scoped highlights,
  a newcomer spotlight and challenge galleries each need **their own cache key and
  their own scoped query** — the shape carries over, the functions do not as-is.
- **The two-per-author cap is images-only today.** `capPerAuthor` runs in
  `assembleImageHighlights`; `assembleProjectHighlights` does *not* cap. Any
  project-based community strip must add the cap, not inherit it.
- These surfaces stay **hidden until a community crosses the count threshold**
  (above) — a two-author wall is worse than none — and they apply the viewer's
  **blocks and mutes** (`hiddenAmong` does both, not blocks alone).

When they do light up: **community highlights** (scoped strip), **newcomer
spotlight** (recent good work by recently-joined painters — `profile.created_at`;
the ranking file already calls new painters being seen the thing that stops the
front page ossifying), and **challenge galleries** (every entry to a closed
challenge, winner first, the rest an *unranked* wall — the losers are not a list
of losers).

---

# Part three: the adjacent bet — Recipes

The strongest "different / better than Reddit" idea to come out of review is not
in either half above, so it gets its own note. The best answers to "what colours
did you use" currently evaporate into comment threads. `post_product` — the
"paints used" strip — is already 80% of a reusable **paint recipe**: a named
scheme (base / wash / highlight / technique) attached to a model, saveable,
re-applicable to a new post, and resolving to the Loaded Dice catalogue exactly as
roadmap item 3 ("paint links that resolve") already wants.

Recipes are the single most-requested durable artefact in the hobby, Reddit's
flat threads structurally cannot hold them, and they monetise directly through the
shop. Where helpful-marks make good *answers* visible but ephemeral, recipes make
the *knowledge itself* durable and searchable. This is a content feature more than
a community or gamification one, and it deserves its own design rather than a
subsection here — but it is flagged at the top of "what to build next", because it
does more for the leave-Reddit case than every badge combined.

---

## Notifications

Everything above fans out through the one existing choke point,
`createNotification()` (`docs/NOTIFICATIONS.md`). Adding the new types (`badge`,
`challenge_result`, `helpful`) is **additive but not free**: it touches three
places, not one — the Drizzle `notification.type` enum, the hardcoded `type` union
in `createNotification`'s signature (`server/services/posts.ts`), and
`NotificationType` in `server/services/push.ts`. They then ride the existing
`muted_types` preference for nothing extra, and once Web Push is live a challenge
result or badge arrives as a push with no further work.

## Safety

The schema-first posture (`docs/ARCHITECTURE.md`) applies, and the review found
three surfaces the first draft left uncovered — now folded into the sections above
and gathered here:

- **Community pages and challenge entries** are posts/profiles under the hood, so
  `ReportButton`, `block` and `mute` cover them, and `hiddenAmong` is reused so a
  blocked painter never appears in a spotlight or gallery.
- **A community's own `description`/`rules`** are admin/mod free text and need
  their own report path — they are *not* auto-covered the way a post is.
- **Community moderators** are admin-appointed only, cannot appoint others, act
  only within their community, and every action (including the appointment) is in
  the append-only `moderation_action` log — which needs a new enum value for the
  community-remove/pin actions.
- **Community-judged challenges** guard the deciding metric against like
  manipulation (moderator judging by default for prizes; discounted likes from
  fresh/blocked accounts).
- **Badges and helpful marks** carry no free text and are idempotent and artefact-
  tied, so they are not a harassment channel.

## Migrations

Additive only, generated with `npm run db:generate`: `community`,
`community_member`, `user_badge`, `challenge`, `challenge_entry`, `helpful`, the
denormalised counters (`community.member_count`, `profile.badge_count`,
`profile.helpful_received_count`, `comment.helpful_count`, `challenge.entry_count`),
**and one additive `moderation_action.action` enum value** for community actions.
Every existing account and post behaves exactly as today with none of these rows
present.

## Testing

Following the `tests/logic.test.ts` and highlights style — pure logic gets unit
tests, the rest is thin:

- **Challenge state machine** — `scheduled → open → judging → closed` on given
  clock times; moderator vs community winner selection; the per-person entry cap;
  the fresh-account like discount in community judging.
- **Badge predicates** — each rule a pure function of existing rows: a full
  sprue→finished project earns the journey badge; a project missing `primed` does
  not; deleting the project revokes it.
- **Idempotent marks** — a second `helpful` from the same person is a no-op; a
  delete decrements with the `max(0, n-1)` floor.
- **Count-threshold gating** — a community below the threshold surfaces no member
  count and no highlight strip; above it, both appear.
- **Hidden filtering** — a blocked *or muted* author is absent from community
  highlights, the newcomer spotlight and a challenge gallery.

## Build order

Reordered from the first draft to lead with what works at fifty users and to stop
front-loading the least differentiating mechanic.

1. **Communities** — `community` + `community_member`, the Join button, the
   community page over the existing `getFeed`, "your communities" in nav — **with
   member counts and highlight strips gated behind the count threshold**. This is
   belonging, it reuses the feed almost entirely, and it is the ground the rest
   stands on (a challenge scopes to a community; a community highlight is a scoped
   highlight).
2. **Helpfulness** — the `helpful` mark and the one reputation number. Second, not
   last: it is the cheapest to build, the only mechanic fully alive at tiny scale,
   and the most defensible answer to Reddit karma.
3. **Challenges — sponsored / moderator-judged variant first.** The real value
   driver. Ship the part that works small (a human picks a winner from a handful
   of entries, ideally with a Loaded Dice prize, ideally riding Dreadtober or
   Squaduary); add community/most-likes judging with its manipulation guards once
   there is a crowd to vote.
4. **Achievements** — a garnish of one or two badges on the above, catalogue in
   `taxonomy.ts` and predicates in `badges.ts`. Not a dedicated cabinet-building
   cycle.

**Recipes** (Part three) and the **pile of shame** (below) are their own designs,
sequenced against this by value — recipes rate highly.

## Further out — deliberately not first

- **Recipes.** Big enough to deserve its own document (Part three). Rated the top
  "next thing to design" for the leave-Reddit case.
- **The pile of shame.** A personal backlog tracker — the universal hobby meme of
  unbuilt kits — celebrating a kit moving from "in the pile" to "painted". It may
  be the most native retention object in the hobby, and "help finishing" is
  exactly the thesis; the reason it is not in Part two is only that it is a new
  content type, a larger build than a layer on existing ones. Worth bringing
  forward the moment communities land.
- **User-created Clubs.** Real gaming clubs running their own space — a natural
  paid tier, but it reintroduces every moderation problem curated communities
  avoid, so it waits for a second moderator. The `community` table is already its
  shape.
- **A paid tier around all of this** — a bigger cabinet, custom community themes,
  running your own sponsored challenge — the healthier revenue line the roadmap
  already anticipates, and this feature set is what would carry it.
