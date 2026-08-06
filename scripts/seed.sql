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
