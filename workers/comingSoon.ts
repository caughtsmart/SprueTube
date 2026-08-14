/*
 * "Coming soon" gate — a launch curtain drawn in front of the whole site.
 *
 * Cloudflare Access / Zero Trust locks the site behind an identity provider,
 * which has the side effect of locking *you* out while you are still building
 * it. This does the opposite: the public sees a holding page, and anyone who
 * has the preview link walks straight through and uses the real site as normal.
 *
 * It is an env-gated no-op, exactly like Web Push and paint resolution — with
 * nothing configured it does nothing and every request passes:
 *
 *   COMING_SOON         unset / "" / "false" / "0" / "off"  ⇒ off.
 *                       anything else truthy                ⇒ on, curtain up.
 *   COMING_SOON_BYPASS  the shared preview token. Opening any URL with
 *                       ?preview=<token> sets a cookie and redirects to the
 *                       clean URL; from then on that browser sees the real
 *                       site. ?preview=out clears it again. Unset ⇒ nobody can
 *                       get behind the curtain, so set this *before* turning
 *                       the gate on or you lock yourself out too.
 *
 * Flip it without a redeploy:
 *   wrangler secret put COMING_SOON       # value "true"  — curtain up
 *   wrangler secret delete COMING_SOON    #               — curtain down
 */

const BYPASS_COOKIE = "st_preview";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface ComingSoonEnv {
  COMING_SOON?: string;
  COMING_SOON_BYPASS?: string;
  SITE_NAME?: string;
}

/** Truthy in the feature-flag sense — "", "false", "0", "off", "no" are all off. */
function enabled(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

/** Length-safe compare that does not short-circuit on the first differing byte. */
function tokenMatches(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function setCookie(value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${BYPASS_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  // Secure would stop the cookie being stored over plain http://localhost, so
  // it is only set on the real, https site.
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Returns a holding page — or a redirect that grants/clears the preview cookie —
 * when the request should be curtained off, or `null` to let it pass through to
 * the app untouched.
 */
export function comingSoonGate(
  request: Request,
  env: ComingSoonEnv,
): Response | null {
  if (!enabled(env.COMING_SOON)) return null;

  const token = env.COMING_SOON_BYPASS?.trim() ?? "";
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

  // A ?preview=<token> link is how you hand someone the keys. Match it, drop a
  // cookie, then bounce to the clean URL so the token does not linger in the
  // address bar, in history, or in analytics. ?preview=out drops the cookie.
  const preview = url.searchParams.get("preview");
  if (preview !== null) {
    url.searchParams.delete("preview");
    const headers = new Headers({
      Location: url.pathname + url.search + url.hash,
      "Cache-Control": "no-store",
    });
    if (preview === "out") {
      headers.append("Set-Cookie", setCookie("", 0, secure));
    } else if (tokenMatches(preview, token)) {
      headers.append("Set-Cookie", setCookie(token, COOKIE_MAX_AGE, secure));
    }
    return new Response(null, { status: 302, headers });
  }

  // Already holding a valid preview cookie? Straight through to the real site.
  const cookieToken = readCookie(request.headers.get("Cookie"), BYPASS_COOKIE);
  if (cookieToken && tokenMatches(cookieToken, token)) return null;

  // Everyone else gets the curtain. 503 + Retry-After keeps search engines from
  // indexing the placeholder as though it were the finished site.
  return new Response(page(env.SITE_NAME ?? "SprueTube"), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "3600",
      "X-Robots-Tag": "noindex",
    },
  });
}

/**
 * The holding page itself — one self-contained document with no external
 * requests, so it renders even with the rest of the site curtained off. Brand
 * is the Cabinet palette: charcoal #333 and Loaded Dice amber, hazard stripe,
 * charcoal-on-amber (never white on amber).
 */
function page(siteName: string): string {
  const name = escapeHtml(siteName);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<meta name="theme-color" content="#333333" />
<title>${name} — coming soon</title>
<style>
  :root {
    --charcoal: #333333;
    --charcoal-deep: #1f1f1f;
    --card: #3d3d3d;
    --amber: #fbad36;
    --amber-deep: #2a2a2a;
    --on-amber: #1f1f1f;
    --text: #f7f6f4;
    --muted: #b8b8b8;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--charcoal);
    color: var(--text);
    font-family: "Space Grotesk", ui-sans-serif, system-ui, -apple-system,
      "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    line-height: 1.5;
  }
  .card {
    width: 100%;
    max-width: 34rem;
    background: var(--card);
    border-radius: 0.75rem;
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.42);
    overflow: hidden;
  }
  .hazard {
    height: 10px;
    background: repeating-linear-gradient(
      45deg,
      var(--amber) 0 16px,
      var(--amber-deep) 16px 32px
    );
  }
  .body { padding: 2.5rem 2rem 2.25rem; text-align: center; }
  .wordmark {
    font-size: clamp(2.25rem, 8vw, 3.25rem);
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0.25rem 0 0;
  }
  .wordmark .dot { color: var(--amber); }
  .tag {
    display: inline-block;
    margin-top: 1.25rem;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    background: var(--amber);
    color: var(--on-amber);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 {
    font-size: 1.35rem;
    font-weight: 700;
    margin: 1.5rem 0 0;
  }
  p { color: var(--muted); margin: 0.85rem auto 0; max-width: 28rem; }
  .foot {
    margin-top: 2rem;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .foot a { color: var(--amber); text-decoration: none; }
  .foot a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main class="card">
    <div class="hazard" aria-hidden="true"></div>
    <div class="body">
      <div class="wordmark">${name}<span class="dot">.</span></div>
      <span class="tag">Coming soon</span>
      <h1>We're still on the workbench.</h1>
      <p>
        ${name} is the social network for miniature painters and model makers —
        and it's being primed, based and based-coated for launch. It won't be
        long. Check back soon.
      </p>
      <p class="foot">
        Want a look behind the curtain? Ask us for a preview link, or say hello
        at <a href="mailto:hello@spruetube.app">hello@spruetube.app</a>.
      </p>
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
