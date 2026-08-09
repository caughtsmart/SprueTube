/*
 * Measure horizontal overflow at phone width.
 *
 * Reading classNames tells you where an overflow is possible. This tells you
 * where one actually happens, and names the element responsible — which is the
 * difference between fixing the cause and fixing something adjacent to it.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5173";
/*
 * 375 is the iPhone reference width. Pass another to check a narrower phone —
 * 320 is a Galaxy Fold cover screen and an original SE, and it is where a
 * layout that merely squeaks through at 375 gives itself away.
 */
const WIDTH = Number(process.argv[2]) || 375;

const PATHS = [
  "/",
  "/explore",
  "/news",
  "/market",
  "/commissions",
  "/about",
  "/rules",
  "/safety",
  "/privacy",
  "/terms",
  "/contact",
  "/login",
  "/signup",
  "/forgot-password",
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({
  viewport: { width: WIDTH, height: 780 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const results = [];

for (const path of PATHS) {
  try {
    await page.goto(`${BASE}${path}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
  } catch (error) {
    results.push({ path, error: String(error).split("\n")[0] });
    continue;
  }

  const found = await page.evaluate((viewport) => {
    const doc = document.documentElement;
    const scrollWidth = Math.max(doc.scrollWidth, document.body.scrollWidth);

    // Name every element whose right edge lands beyond the viewport. Filter to
    // the ones that are not merely inheriting an over-wide ancestor: report the
    // deepest offenders, which are the ones worth changing.
    const culprits = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const overhang = Math.round(rect.right - viewport);
      if (overhang <= 1) continue;
      culprits.push({
        overhang,
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") ?? "").slice(0, 120),
        text: (el.textContent ?? "").trim().slice(0, 60),
        children: el.children.length,
      });
    }

    culprits.sort((a, b) => b.overhang - a.overhang);
    return { scrollWidth, culprits: culprits.slice(0, 8) };
  }, WIDTH);

  results.push({
    path,
    scrollWidth: found.scrollWidth,
    overflow: found.scrollWidth - WIDTH,
    culprits: found.culprits,
  });
}

/*
 * Probes: the content-driven cases, which a fresh database cannot produce.
 *
 * A local D1 has no posts, comments or messages in it — deliberately, since
 * seeding fake people is a lie the site never recovers from — so the sweep
 * above can only ever prove the chrome is sound. These fixtures paste the real
 * component markup into a real page, so it is measured against the real
 * stylesheet, with the content a person actually pastes: an eBay URL, a
 * fifty-character display name, an unbroken compound word.
 *
 * Each probe is the markup as it now stands. A regression that strips a
 * `truncate` or a `break-all` shows up here as a number, not as a shrug.
 *
 * The composer grid is here because an audit called it the certain culprit and
 * measurement said otherwise — it clears 320px with room to spare. It stays as
 * a probe so the next person does not have to re-derive that.
 */
const URL_ = "https://www.ebay.co.uk/itm/1234567890?_trkparms=amclksrc%3DITM%26aid%3D1110018%26algo%3DHOMESPLICE";
const NAME = "Bartholomew Fitzwilliam-Harrington III";
const HANDLE = "bartholomew_fitzwill";
const TOKEN = "AntiDisestablishmentarianismWarhammer40000CommissionPainting";

const PROBES = [
  {
    name: "post card header (name + handle)",
    html: `<article class="st-card overflow-hidden"><div class="flex items-start gap-3 p-4"><span class="shrink-0" style="width:40px;height:40px;background:#555;border-radius:99px;display:inline-block"></span><div class="min-w-0 flex-1"><div class="flex flex-wrap items-baseline gap-x-2"><a class="st-text-strong truncate text-sm font-semibold">${NAME}</a><span class="st-text-muted truncate text-xs">@${HANDLE}</span></div></div></div></article>`,
  },
  {
    name: "comment body with a pasted URL",
    html: `<li class="st-card p-3" style="list-style:none"><div class="flex gap-3"><span class="shrink-0" style="width:32px;height:32px;background:#555;border-radius:99px;display:inline-block"></span><div class="min-w-0 flex-1"><div class="flex flex-wrap items-baseline gap-x-2"><a class="st-text-strong truncate text-sm font-semibold">${NAME}</a><span class="st-text-muted text-xs">2h</span></div><p class="mt-1 text-sm leading-relaxed whitespace-pre-wrap">Got mine here ${URL_}</p></div></div></li>`,
  },
  {
    name: "message bubble with a pasted URL",
    html: `<div class="flex justify-end"><div class="max-w-[85%]"><div class="rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-relaxed whitespace-pre-wrap" style="background:#444">${URL_}</div></div></div>`,
  },
  {
    name: "composer photo grid (alt-text inputs)",
    html: `<form class="st-card space-y-4 p-4"><ul class="grid grid-cols-2 gap-3 sm:grid-cols-3" style="list-style:none;padding:0"><li class="st-border rounded-lg border p-2"><div style="aspect-ratio:1;background:#555"></div><input class="st-input mt-2 text-xs" placeholder="Describe it (alt text)"></li><li class="st-border rounded-lg border p-2"><div style="aspect-ratio:1;background:#555"></div><input class="st-input mt-2 text-xs" placeholder="Describe it (alt text)"></li></ul></form>`,
  },
  {
    name: "listing body, URL as its own link text",
    html: `<div class="mt-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap">Also listed at <a class="st-link break-all">${URL_}</a></div>`,
  },
  {
    name: "profile website link",
    html: `<div class="st-text-muted mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>Joined 1 May 2026</span><a class="st-link min-w-0 break-all">${URL_.slice(8)}</a></div>`,
  },
  {
    name: "commission card owner row",
    html: `<article class="st-card overflow-hidden"><div class="st-border flex min-w-0 items-center gap-2 border-t px-4 py-3"><a class="flex min-w-0 items-center gap-2"><span class="shrink-0" style="width:28px;height:28px;background:#555;border-radius:99px;display:inline-block"></span><span class="st-text-strong truncate text-sm font-medium">${NAME}</span><span class="st-text-muted truncate text-sm">@${HANDLE}</span></a></div></article>`,
  },
  {
    name: "commission title beside a chip",
    html: `<div class="flex flex-wrap items-start justify-between gap-3"><h1 class="min-w-0 text-xl font-bold">${TOKEN}</h1><span class="st-chip shrink-0">Open to work</span></div>`,
  },
  {
    name: "build-log owner row",
    html: `<a class="mt-2 flex min-w-0 items-center gap-2"><span class="shrink-0" style="width:32px;height:32px;background:#555;border-radius:99px;display:inline-block"></span><span class="st-text-strong truncate text-sm font-medium">${NAME}</span><span class="st-text-muted truncate text-sm">@${HANDLE}</span></a>`,
  },
  {
    name: "moderation queue, reported spam",
    html: `<div class="st-card p-3"><p class="whitespace-pre-wrap">Buy now ${URL_}</p></div>`,
  },
  {
    name: "conversation header",
    html: `<header class="flex items-center gap-3"><a class="st-text-muted text-sm">←</a><a class="flex min-w-0 items-center gap-2"><span class="shrink-0" style="width:36px;height:36px;background:#555;border-radius:99px;display:inline-block"></span><span class="min-w-0"><span class="st-text-strong block truncate text-sm font-semibold">${NAME}</span><span class="st-text-muted block truncate text-xs">@${HANDLE}</span></span></a></header>`,
  },
  {
    name: "prose page with a long unbroken token",
    html: `<div class="st-prose"><p>Registered office ${TOKEN}${TOKEN}</p></div>`,
  },
];

await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" });

const probeResults = await page.evaluate(
  ([probes, viewport]) => {
    const host = document.querySelector("main");
    const out = [];
    for (const probe of probes) {
      const holder = document.createElement("div");
      holder.innerHTML = probe.html;
      host.replaceChildren(holder);
      // Force layout before measuring.
      void document.documentElement.scrollWidth;
      const scrollWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      );
      let worst = 0;
      for (const el of holder.querySelectorAll("*")) {
        const right = el.getBoundingClientRect().right;
        worst = Math.max(worst, Math.round(right - viewport));
      }
      out.push({ name: probe.name, scrollWidth, worst });
    }
    return out;
  },
  [PROBES, WIDTH],
);

await browser.close();

console.log("\n--- component probes (real markup, real stylesheet) ---");
let badProbes = 0;
for (const p of probeResults) {
  const over = p.scrollWidth - WIDTH;
  if (over > 0 || p.worst > 1) badProbes++;
  const flag = over > 0 || p.worst > 1 ? "OVERFLOW" : "ok";
  console.log(
    `  ${flag.padEnd(9)} ${p.name.padEnd(42)} page=${p.scrollWidth} worstEdge=+${p.worst}px`,
  );
}
console.log(`  ${badProbes}/${probeResults.length} probes overflow`);

let bad = 0;
for (const r of results) {
  if (r.error) {
    console.log(`\n${r.path}  ERROR  ${r.error}`);
    continue;
  }
  const flag = r.overflow > 0 ? "OVERFLOW" : "ok";
  if (r.overflow > 0) bad++;
  console.log(`\n${r.path}  ${flag}  scrollWidth=${r.scrollWidth} (+${r.overflow})`);
  for (const c of r.culprits) {
    console.log(`    +${c.overhang}px  <${c.tag} class="${c.cls}">  ${JSON.stringify(c.text)}`);
  }
}
console.log(`\n${bad}/${results.length} pages overflow at ${WIDTH}px`);
