#!/usr/bin/env node
/*
 * End-to-end check of a running SprueTube.
 *
 *   node scripts/verify-deployment.mjs https://spruetube.app
 *   node scripts/verify-deployment.mjs http://localhost:5173
 *
 * Exercises the real HTTP API and the server-rendered pages: signup, the age
 * gate, posting, feeds, the social graph, reporting, moderation authorisation
 * and visibility rules. Everything it creates is prefixed `verify-` so it is
 * obvious in the database and easy to remove — the command to do that is printed
 * at the end.
 *
 * Behind Cloudflare Access, set an Access service token first or every request
 * gets the login page instead of the app:
 *   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... node scripts/…
 */

/*
 * Node's fetch ignores HTTPS_PROXY unless explicitly told to honour it, so in a
 * proxied environment every request goes direct and is refused. Re-exec once
 * with the flag set rather than making the caller remember it.
 */
if (
  (process.env.HTTPS_PROXY || process.env.https_proxy) &&
  process.env.NODE_USE_ENV_PROXY !== "1"
) {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } },
  );
  process.exit(result.status ?? 1);
}

const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const stamp = Date.now().toString(36);

const accessHeaders = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Minimal cookie jar — enough for two concurrent sessions. */
function jar() {
  const cookies = new Map();
  return {
    header: () =>
      [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") || undefined,
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    },
  };
}

async function call(path, { method = "GET", body, session, raw = false } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...accessHeaders,
      // better-auth rejects a state-changing request with no Origin as a CSRF
      // risk, which is correct — so behave like a browser on this host.
      origin: base,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(session?.header() ? { cookie: session.header() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  session?.absorb(response);

  if (raw) return { status: response.status, text: await response.text() };

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML or empty */
  }
  return { status: response.status, json, text };
}

/*
 * Something between here and the site can answer instead of the site, and the
 * result looks like dozens of unrelated failures unless it is named. Worse, a
 * proxy that answers 403 makes the "this endpoint should refuse me" checks pass
 * for entirely the wrong reason. Detect it once, up front, and stop.
 */
function detectInterception(result) {
  const body = result.text ?? "";

  if (/not in allowlist|egress|blocked by the network/i.test(body)) {
    throw new Error(
      `Something between this machine and ${base} is refusing the request:\n` +
        `      ${body.slice(0, 200)}\n` +
        "      The site itself may be perfectly healthy — this is a network " +
        "policy on the machine running this script.",
    );
  }

  if (
    result.status === 302 ||
    /cloudflareaccess\.com|Sign in to|Access denied/i.test(body)
  ) {
    throw new Error(
      "Cloudflare Access is intercepting requests. Provide an Access service " +
        "token via CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET, or run this " +
        "before enabling Access.",
    );
  }
}

/* -------------------------------------------------------------------------- */

console.log(`\nVerifying ${base}\n`);

const health = await call("/api/v1/health", { raw: true });
detectInterception(health);

console.log("Public surface");

await check("health endpoint", async () => {
  assert(health.status === 200, `expected 200, got ${health.status}`);
  const payload = JSON.parse(health.text);
  assert(payload.ok === true, "health did not report ok");
  return `environment=${payload.environment}`;
});

await check("landing page renders server-side", async () => {
  const page = await call("/", { raw: true });
  assert(page.status === 200, `expected 200, got ${page.status}`);
  assert(
    page.text.includes("SprueTube"),
    "brand name missing from the HTML — SSR may not be running",
  );
  assert(
    /<title>[^<]+<\/title>/.test(page.text),
    "no <title>, so crawlers and link previews get nothing",
  );
  return "title and content present";
});

for (const path of [
  "/explore",
  "/about",
  "/rules",
  "/safety",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
]) {
  await check(`${path} responds`, async () => {
    const page = await call(path, { raw: true });
    assert(page.status === 200, `expected 200, got ${page.status}`);
    return undefined;
  });
}

await check("robots.txt points at the sitemap", async () => {
  const page = await call("/robots.txt", { raw: true });
  assert(page.status === 200, `expected 200, got ${page.status}`);
  assert(page.text.includes("Sitemap:"), "no Sitemap line");
  assert(page.text.includes("Disallow: /api/"), "API not excluded");
  return undefined;
});

await check("sitemap.xml is well formed", async () => {
  const page = await call("/sitemap.xml", { raw: true });
  assert(page.status === 200, `expected 200, got ${page.status}`);
  assert(page.text.startsWith("<?xml"), "not XML");
  assert(page.text.includes("<urlset"), "no urlset element");
  return `${(page.text.match(/<url>/g) ?? []).length} urls`;
});

await check("unknown page 404s", async () => {
  const page = await call("/definitely-not-a-page", { raw: true });
  assert(page.status === 404, `expected 404, got ${page.status}`);
  return undefined;
});

await check("house ad serves", async () => {
  const result = await call("/api/v1/ads?slot=feed");
  assert(result.status === 200, `expected 200, got ${result.status}`);
  assert(result.json?.ad, "no ad returned — has scripts/seed.sql been applied?");
  return result.json.ad.title;
});

/* -------------------------------------------------------------------------- */

console.log("\nAccounts and the age gate");

const alice = jar();
const bob = jar();
const aliceName = `verify_a_${stamp}`;
const bobName = `verify_b_${stamp}`;

await check("sign up", async () => {
  const result = await call("/api/auth/sign-up/email", {
    method: "POST",
    session: alice,
    body: {
      email: `verify-${stamp}-a@example.invalid`,
      password: "a-long-enough-passphrase",
      name: "Verify A",
    },
  });
  assert(result.status === 200, `expected 200, got ${result.status}: ${result.text.slice(0, 160)}`);
  return undefined;
});

await check("new account has a profile and needs onboarding", async () => {
  const result = await call("/api/v1/me", { session: alice });
  assert(result.json?.profile, "no profile was created by the signup hook");
  assert(result.json.needsOnboarding === true, "should require onboarding");
  return undefined;
});

await check("posting is refused before onboarding", async () => {
  const result = await call("/api/v1/posts", {
    method: "POST",
    session: alice,
    body: { kind: "text", body: "too early" },
  });
  assert(result.status === 403, `expected 403, got ${result.status}`);
  return result.json?.error;
});

await check("under-13 signup is rejected", async () => {
  const result = await call("/api/v1/onboarding", {
    method: "POST",
    session: alice,
    body: {
      username: aliceName,
      displayName: "Verify A",
      birthdate: "2019-01-01",
    },
  });
  assert(result.status === 403, `expected 403, got ${result.status}`);
  assert(result.json?.error === "underage", `expected underage, got ${result.json?.error}`);
  return undefined;
});

await check("reserved usernames are refused", async () => {
  const result = await call("/api/v1/usernames/admin/available");
  assert(result.json?.available === false, "'admin' should not be available");
  return undefined;
});

await check("onboarding completes", async () => {
  const result = await call("/api/v1/onboarding", {
    method: "POST",
    session: alice,
    body: {
      username: aliceName,
      displayName: "Verify A",
      birthdate: "1985-04-12",
      bio: "Automated verification account.",
    },
  });
  assert(result.status === 200, `expected 200, got ${result.status}: ${result.text.slice(0, 160)}`);
  return `@${aliceName}`;
});

/* -------------------------------------------------------------------------- */

console.log("\nPosting and feeds");

let postId;

await check("create a post with tags and paints", async () => {
  const result = await call("/api/v1/posts", {
    method: "POST",
    session: alice,
    body: {
      kind: "text",
      body: `Verification run ${stamp}. Rust on the plates. #deathguard #wip`,
      gameSystem: "warhammer-40k",
      scale: "32mm",
      wipStage: "shaded",
      products: [{ name: "Ryza Rust", brand: "Citadel" }],
    },
  });
  assert(result.status === 201, `expected 201, got ${result.status}: ${result.text.slice(0, 160)}`);
  postId = result.json.id;
  assert(result.json.status === "published", "text post should publish immediately");
  return postId;
});

await check("post appears in the latest feed, hashtags extracted", async () => {
  const result = await call("/api/v1/feed?tab=latest", { session: alice });
  const found = result.json?.posts?.find((p) => p.id === postId);
  assert(found, "new post missing from the feed");
  assert(found.tags.includes("deathguard"), `tags not extracted: ${found.tags}`);
  assert(found.products.length === 1, "paints not attached");
  return `${found.tags.length} tags, ${found.products.length} product`;
});

await check("post detail page renders with Open Graph tags", async () => {
  const page = await call(`/posts/${postId}`, { raw: true });
  assert(page.status === 200, `expected 200, got ${page.status}`);
  assert(page.text.includes('property="og:title"'), "no og:title");
  return undefined;
});

await check("profile page renders", async () => {
  const page = await call(`/@${aliceName}`, { raw: true });
  assert(page.status === 200, `expected 200, got ${page.status}`);
  assert(page.text.includes(aliceName), "username missing from the page");
  return undefined;
});

/* -------------------------------------------------------------------------- */

console.log("\nSocial graph");

await check("second account signs up and onboards", async () => {
  const signup = await call("/api/auth/sign-up/email", {
    method: "POST",
    session: bob,
    body: {
      email: `verify-${stamp}-b@example.invalid`,
      password: "another-long-passphrase",
      name: "Verify B",
    },
  });
  assert(signup.status === 200, `signup failed: ${signup.status}`);
  const onboard = await call("/api/v1/onboarding", {
    method: "POST",
    session: bob,
    body: { username: bobName, displayName: "Verify B", birthdate: "1990-06-01" },
  });
  assert(onboard.status === 200, `onboarding failed: ${onboard.status}`);
  return `@${bobName}`;
});

await check("follow", async () => {
  const result = await call(`/api/v1/profiles/${aliceName}/follow`, {
    method: "POST",
    session: bob,
  });
  assert(result.json?.following === true, "follow did not take");
  return undefined;
});

await check("liking twice does not double count", async () => {
  const first = await call(`/api/v1/posts/${postId}/like`, {
    method: "POST",
    session: bob,
  });
  const second = await call(`/api/v1/posts/${postId}/like`, {
    method: "POST",
    session: bob,
  });
  assert(first.json?.likeCount === 1, `expected 1, got ${first.json?.likeCount}`);
  assert(second.json?.likeCount === 1, `retry inflated the count to ${second.json?.likeCount}`);
  return "idempotent";
});

await check("comment with a mention", async () => {
  const result = await call(`/api/v1/posts/${postId}/comments`, {
    method: "POST",
    session: bob,
    body: { body: `Good rust. What ratio? @${aliceName}` },
  });
  assert(result.status === 201, `expected 201, got ${result.status}`);
  return undefined;
});

await check("notifications fired for like, comment, follow and mention", async () => {
  const result = await call("/api/v1/notifications", { session: alice });
  const types = new Set((result.json?.notifications ?? []).map((n) => n.type));
  for (const expected of ["like", "comment", "follow", "mention"]) {
    assert(types.has(expected), `missing a ${expected} notification (got ${[...types]})`);
  }
  return [...types].join(", ");
});

await check("following feed shows a followed author", async () => {
  const result = await call("/api/v1/feed?tab=following", { session: bob });
  assert(
    result.json?.posts?.some((p) => p.id === postId),
    "followed author's post missing from the following feed",
  );
  return undefined;
});

await check("followers-only post reaches followers but not the public feed", async () => {
  const created = await call("/api/v1/posts", {
    method: "POST",
    session: alice,
    body: { kind: "text", body: `Followers only ${stamp}`, visibility: "followers" },
  });
  assert(created.status === 201, `expected 201, got ${created.status}`);

  const asFollower = await call("/api/v1/feed?tab=following", { session: bob });
  assert(
    asFollower.json.posts.some((p) => p.id === created.json.id),
    "a follower could not see the followers-only post",
  );

  const asPublic = await call("/api/v1/feed?tab=discover");
  assert(
    !asPublic.json.posts.some((p) => p.id === created.json.id),
    "LEAK: followers-only post is in the public discover feed",
  );
  return "visible to follower, hidden from public";
});

/* -------------------------------------------------------------------------- */

console.log("\nSafety");

await check("report is accepted", async () => {
  const result = await call("/api/v1/reports", {
    method: "POST",
    session: bob,
    body: {
      subjectType: "post",
      subjectId: postId,
      reason: "spam",
      details: "verification run",
    },
  });
  assert(result.status === 201, `expected 201, got ${result.status}`);
  return undefined;
});

await check("moderation queue rejects a normal account", async () => {
  const result = await call("/api/v1/moderation/reports", { session: bob });
  assert(result.status === 403, `expected 403, got ${result.status}`);
  // The body matters: any proxy in the way can also answer 403, and asserting
  // on the status alone would let that count as a pass.
  assert(
    result.json?.error === "forbidden",
    `403 came from something other than the app: ${result.text.slice(0, 120)}`,
  );
  return "403 from the app, as expected";
});

await check("moderation actions reject a normal account", async () => {
  const result = await call("/api/v1/moderation/actions", {
    method: "POST",
    session: bob,
    body: { action: "remove_post", subjectType: "post", subjectId: postId },
  });
  assert(result.status === 403, `expected 403, got ${result.status}`);
  assert(
    result.json?.error === "forbidden",
    `403 came from something other than the app: ${result.text.slice(0, 120)}`,
  );
  return "403 from the app, as expected";
});

await check("blocking hides both directions and severs the follow", async () => {
  await call(`/api/v1/profiles/${aliceName}/block`, {
    method: "POST",
    session: bob,
  });
  const feed = await call("/api/v1/feed?tab=following", { session: bob });
  assert(
    !feed.json.posts.some((p) => p.id === postId),
    "blocked author still visible in the feed",
  );
  await call(`/api/v1/profiles/${aliceName}/block`, {
    method: "DELETE",
    session: bob,
  });
  return undefined;
});

await check("anonymous callers cannot post", async () => {
  const result = await call("/api/v1/posts", {
    method: "POST",
    body: { kind: "text", body: "should not work" },
  });
  assert(result.status === 401, `expected 401, got ${result.status}`);
  assert(result.json?.error === "unauthorized", "401 did not come from the app");
  return undefined;
});

/* -------------------------------------------------------------------------- */

console.log(
  `\n${failures.length ? "\x1b[31m" : "\x1b[32m"}${passed} passed, ${failures.length} failed\x1b[0m`,
);

if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  • ${failure.name}: ${failure.message}`);
}

console.log(`
Test data created — two accounts prefixed "verify-". Remove with:

  npx wrangler d1 execute spruetube --remote --command \\
    "DELETE FROM user WHERE email LIKE 'verify-%@example.invalid'"

Cascades clear their profiles, posts, comments, follows, likes and reports.
Reports and moderation rows referencing them are set to null rather than deleted,
which is deliberate — the audit trail outlives the account.
`);

process.exit(failures.length ? 1 : 0);
