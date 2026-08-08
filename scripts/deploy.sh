#!/usr/bin/env bash
#
# First-deploy helper for SprueTube.
#
# Does the fiddly, get-it-wrong-once parts: resolves the account id rather than
# making you paste it, generates the session secret, and refuses to deploy if
# the code does not compile. Safe to re-run.
#
#   ./scripts/deploy.sh
#
# Requires `wrangler login` first (or CLOUDFLARE_API_TOKEN in the environment).

set -euo pipefail

cd "$(dirname "$0")/.."

info() { printf '\033[1;36m→\033[0m %s\n' "$1"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$1"; }
die() {
  printf '\033[1;31m✗\033[0m %s\n' "$1" >&2
  exit 1
}

# --- Authentication ----------------------------------------------------------

info "Checking Cloudflare authentication"
if ! whoami_out=$(npx wrangler whoami 2>&1); then
  die "wrangler could not run. Try 'npm install' first."
fi
if grep -qi "not authenticated" <<<"$whoami_out"; then
  die "Not signed in. Run 'npx wrangler login', then re-run this script."
fi
ok "Signed in"

# --- Account id --------------------------------------------------------------

# `wrangler whoami` prints a table; the account id is the 32-hex cell.
account_id=$(grep -oiE '\b[0-9a-f]{32}\b' <<<"$whoami_out" | head -1 || true)

if grep -q 'REPLACE_WITH_ACCOUNT_ID' wrangler.jsonc; then
  [[ -n $account_id ]] || die "Could not read the account id from 'wrangler whoami'. Set CF_ACCOUNT_ID in wrangler.jsonc by hand, then re-run."
  info "Writing account id into wrangler.jsonc"
  # Done in Python to avoid the GNU/BSD `sed -i` portability difference.
  python3 - "$account_id" <<'PY'
import pathlib, sys
p = pathlib.Path("wrangler.jsonc")
p.write_text(p.read_text().replace("REPLACE_WITH_ACCOUNT_ID", sys.argv[1]))
PY
  ok "CF_ACCOUNT_ID set to $account_id"
else
  ok "CF_ACCOUNT_ID already set"
fi

# --- Verify before shipping --------------------------------------------------

info "Typechecking"
npm run typecheck >/dev/null || die "Typecheck failed. Not deploying."
ok "Types clean"

info "Running tests"
npm test >/dev/null 2>&1 || die "Tests failed. Not deploying."
ok "Tests pass"

# --- Deploy ------------------------------------------------------------------
#
# Deploy runs BEFORE the secrets are set, deliberately. On a fresh account the
# Worker does not exist yet, and `wrangler secret put` against a Worker that is
# not there fails. Secrets apply to a live Worker without needing a redeploy, so
# this order works on both the first run and every later one.

info "Deploying"
npm run deploy
ok "Worker deployed"

# --- Secrets -----------------------------------------------------------------

secret_list=$(npx wrangler secret list 2>/dev/null || true)

# Plain substring match on the name, not a quoted JSON match: if wrangler ever
# changes this output format, a false *positive* only skips setting a secret and
# prints a warning, whereas a false negative would silently rotate
# BETTER_AUTH_SECRET and sign every existing user out.
has_secret() { grep -q "$1" <<<"$secret_list"; }

if has_secret BETTER_AUTH_SECRET; then
  ok "BETTER_AUTH_SECRET already set (untouched — rotating it signs everyone out)"
else
  info "Generating BETTER_AUTH_SECRET"
  openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET >/dev/null
  ok "BETTER_AUTH_SECRET set"
fi

echo
if ! has_secret CF_API_TOKEN; then
  warn "CF_API_TOKEN not set — photo and video uploads will return 502."
  warn "  npx wrangler secret put CF_API_TOKEN"
  warn "  (a token with only Images:Edit and Stream:Edit)"
fi
if ! has_secret CF_STREAM_WEBHOOK_SECRET; then
  warn "CF_STREAM_WEBHOOK_SECRET not set — the Stream webhook refuses unsigned"
  warn "callbacks, so video stays 'processing' until the 15-minute sweep."
fi
if grep -q 'REPLACE_WITH_IMAGES_ACCOUNT_HASH' wrangler.jsonc; then
  warn "CF_IMAGES_ACCOUNT_HASH still a placeholder — photos will not render."
  warn "Avatars fall back to initials, so the site is usable meanwhile."
fi
if grep -q 'REPLACE_WITH_STREAM_SUBDOMAIN' wrangler.jsonc; then
  warn "CF_STREAM_CUSTOMER_SUBDOMAIN still a placeholder — video will not play."
fi

# --- What is left ------------------------------------------------------------

cat <<'NEXT'

Next:
  1. Attach the domain — Workers & Pages → spruetube → Settings →
     Domains & Routes → add spruetube.app
  2. Gating the preview with Access? Add the Bypass application for
     /api/v1/webhooks/stream, or video will never publish.
     See docs/DEPLOY.md step 6a.
  3. Sign up, then make yourself admin — until someone is, reports pile up
     with nobody able to action them:
       npx wrangler d1 execute spruetube --remote \
         --command "UPDATE profile SET role='admin' WHERE username='you'"
NEXT
