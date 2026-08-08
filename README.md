# SprueTube

A social network for miniature painters and model makers, at
[spruetube.app](https://spruetube.app).

SprueTube started as a community feed bolted onto the Loaded Dice Shopify store.
This repository is the standalone platform: its own domain, its own accounts, its
own brand, and an API built so that the iOS app can be a client of the same
server rather than a second implementation of it.

## What it does

- **Accounts** — email and password, plus Google and Sign in with Apple when
  configured. 13+ age gate.
- **Posts** — text, up to eight photos, or a video. Tagged with the game system,
  the scale, and the stage the model is at (sprue → assembled → primed →
  … → finished).
- **Projects** — group posts into one build log so a whole army reads as a story.
- **Paints used** — name the paints on a post and they appear under the photo,
  optionally linked to the shop. This is the commercial layer, and it works
  because it answers the question everyone asks anyway.
- **Feeds** — chronological *Following*, ranked *Discover*, plus tag and
  game-system feeds. Keyset pagination throughout.
- **Social** — follows, likes, threaded comments, bookmarks, mentions,
  notifications.
- **Safety** — reporting on every post, comment and profile; blocking; muting; a
  prioritised moderation queue and an append-only audit log.
- **Advertising** — in-feed and sidebar slots, wired for AdSense with database
  house ads as the always-on fallback.

## Stack

Everything runs on Cloudflare, in one Worker.

| Concern | Choice |
| --- | --- |
| Runtime | Cloudflare Workers |
| Web | React Router v8 (framework mode, SSR) + Tailwind v4 |
| API | Hono, mounted at `/api` in the same Worker |
| Database | D1 (SQLite) with Drizzle ORM |
| Auth | better-auth |
| Images | Cloudflare Images, direct creator upload |
| Video | Cloudflare Stream, direct creator upload + webhook |
| Rate limits / cache | Workers KV |

Why one Worker rather than two: a single deploy, one set of bindings, and the
site and its API share an origin so there are no cross-domain cookie problems.
`server/api` is a self-contained Hono app, so lifting it into its own Worker
later is a small change, not a rewrite.

## Getting started

```bash
npm install
cp .dev.vars.example .dev.vars     # then fill in BETTER_AUTH_SECRET
npm run db:migrate:local
npm run db:seed:local              # house ads only, no fake users
npm run dev                        # http://localhost:5173
```

Uploads need a real `CF_API_TOKEN`; everything else works without one.

If every page suddenly 500s with `no such table`, the local database is empty
because miniflare keys its local D1 file on the `database_id` in
`wrangler.jsonc` — change that id and you get a different, unmigrated file. Run
`npm run db:migrate:local && npm run db:seed:local` again and restart the dev
server.

To make yourself a moderator locally:

```bash
npx wrangler d1 execute spruetube --local \
  --command "UPDATE profile SET role='admin' WHERE username='yourname'"
```

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server with live bindings |
| `npm run build` | Production build |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run typecheck` | Regenerate types, then `tsc -b` |
| `npm test` | Unit tests |
| `npm run db:generate` | Generate a migration from the schema |
| `npm run db:migrate:local` / `:remote` | Apply migrations |
| `npm run verify` | End-to-end check against a running instance |

## Layout

```
app/                 React Router: routes, components, client helpers
  lib/taxonomy.ts    Game systems, stages, limits — no imports, shared with the server
  lib/data.server.ts Loader-side bridge to the service layer
server/
  api/               Hono app: routes, middleware, Zod validators
  db/                Drizzle schema, client, id generation
  services/          Feed, posts, media, moderation, ads, ranking
workers/app.ts       Worker entry: /api/* → Hono, everything else → SSR
migrations/          Generated D1 SQL
docs/                Architecture, deployment, roadmap, compliance
```

Loaders call `server/services` directly rather than fetching the site's own
API — same Worker, so a self-fetch would cost a second request and a second
session lookup for nothing. The HTTP API is still the contract: the browser uses
it for likes, infinite scroll and uploads, and the iOS app will use it for
everything.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit, and why
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — first deploy to spruetube.app, step by step
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what is next, including the iOS app
- [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) — what must be true before launch

## Before you launch

The privacy notice and terms have `[LEGAL ENTITY]` placeholders in them, and
`docs/COMPLIANCE.md` lists what still needs a human decision. Read that file
first — a UGC platform has obligations that are much cheaper to meet before
launch than after.
