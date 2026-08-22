-- Seed data for local development and for a fresh production database.
--
-- Only house ads: everything else on SprueTube should be real content posted by
-- real people. Seeding fake users and fake posts makes a new community look
-- busy for about a day and dishonest forever after.
--
-- Apply with:  npm run db:seed:local
--       or:    wrangler d1 execute spruetube --remote --file=./scripts/seed.sql

INSERT OR IGNORE INTO ad_placement
  (id, slot, title, body, image_url, target_url, cta_label, weight, active)
VALUES
  (
    'ad_seed_home',
    'feed',
    'Loaded Dice — the shop that funds SprueTube',
    'Warhammer, TCGs, board games, paints and terrain, from an award-winning independent hobby shop in South Wales. Every order keeps SprueTube free and ad-network-free.',
    NULL,
    'https://www.loadeddice.uk?utm_source=spruetube&utm_medium=house_ad&utm_campaign=brand_home',
    'Visit Loaded Dice',
    4,
    1
  ),
  (
    'ad_seed_paints',
    'feed',
    'Paints, brushes and everything else',
    'Loaded Dice stocks Citadel, Army Painter and Vallejo, with next-day UK delivery. Award-winning hobby shop, run by people who paint.',
    NULL,
    'https://www.loadeddice.uk/collections/paint-sets?utm_source=spruetube&utm_medium=house_ad&utm_campaign=feed',
    'Browse paints',
    3,
    1
  ),
  (
    'ad_seed_starter',
    'feed',
    'Just starting out?',
    'Starter sets with the paints, brushes and a model to put them on — no guessing which twelve pots you actually need.',
    NULL,
    'https://www.loadeddice.uk/collections/miniature-painting-kits-high-quality-paints-for-model-making-in-uk?utm_source=spruetube&utm_medium=house_ad&utm_campaign=starter',
    'See starter kits',
    2,
    1
  ),
  (
    'ad_seed_sidebar',
    'sidebar',
    'Loaded Dice',
    'The South Wales hobby shop that funds SprueTube. Warhammer, TCGs, paints and terrain.',
    NULL,
    'https://www.loadeddice.uk?utm_source=spruetube&utm_medium=house_ad&utm_campaign=sidebar',
    'Have a look',
    1,
    1
  ),
  (
    'ad_seed_post',
    'post',
    'Basing materials and terrain',
    'Tufts, flock, texture pastes and scenics — the bit everyone leaves until last.',
    NULL,
    'https://www.loadeddice.uk/collections/miniature-basing-materials-for-model-makers-warhammer-basing?utm_source=spruetube&utm_medium=house_ad&utm_campaign=post',
    'Browse basing',
    1,
    1
  );

-- Community painting prompts. A challenge is just a themed reason to post — the
-- entries are the posts carrying its tag, so tags are single tokens (letters
-- only) that work inline as #hashtags. No judging, no timer that punishes a
-- quiet fortnight. Add a new one with another INSERT; flip active to 0 to retire
-- one. See server/services/challenges.ts.
INSERT OR IGNORE INTO challenge
  (id, slug, title, prompt, tag, starts_at, ends_at, active)
VALUES
  (
    'ch_seed_mouldlines',
    'mould-line-amnesty',
    'Mould Line Amnesty',
    'Nobody scrapes every mould line. Post a model you are happy with anyway — half-primed, badly lit, honest. Tag it and it lands here.',
    'mouldlines',
    NULL,
    NULL,
    1
  ),
  (
    'ch_seed_firstmini',
    'your-first-miniature',
    'Your very first miniature',
    'Dig out the first thing you ever painted and show it next to something recent. We all started somewhere — this is the most encouraging post a beginner can see.',
    'firstmini',
    NULL,
    NULL,
    1
  );
