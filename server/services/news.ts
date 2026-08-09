import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { createDb, type Db } from "../db/client";
import { newId } from "../db/id";
import { newsItem } from "../db/schema";
import type { NewsCategory } from "../../app/lib/taxonomy";

/*
 * The hobby news brief.
 *
 * This module quotes news; it never writes any. Every row that reaches the
 * database carries the publisher's name and the exact URL it came from, and an
 * item that cannot supply both is dropped rather than published — which is what
 * the NOT NULL on those two columns is there to enforce. There is deliberately
 * no model call anywhere in this file: a summariser with no source text in
 * front of it is just a plausible-sounding fabricator, and hobby news is
 * exactly the sort of thing people repeat without checking.
 *
 * Workers has no XML parser, so the feed reader below is written by hand. It is
 * forgiving on purpose — real feeds are full of CDATA, double-escaped entities,
 * missing dates and empty descriptions — but forgiving about *shape*, never
 * about provenance.
 */

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

export type NewsSource = {
  /** Shown on every row and every item page. Use the masthead, not a slug. */
  name: string;
  feedUrl: string;
  category: NewsCategory;
};

/*
 * Kept in code rather than in a table. A source list is a product decision that
 * wants reviewing in a pull request — adding one from an admin form is how an
 * aggregator ends up quietly syndicating an SEO farm.
 *
 * Warhammer Community and Bell of Lost Souls are the obvious absences: both
 * refuse automated requests outright (403), so there is nothing to fetch and
 * nothing worth pretending about.
 */
export const NEWS_SOURCES: NewsSource[] = [
  /* Warhammer */
  {
    name: "Goonhammer",
    feedUrl: "https://www.goonhammer.com/feed/",
    category: "warhammer",
  },
  {
    name: "Spikey Bits",
    feedUrl: "https://spikeybits.com/feed/",
    category: "warhammer",
  },
  {
    name: "Sprues & Brews",
    feedUrl: "https://spruesandbrews.com/feed/",
    category: "warhammer",
  },
  {
    name: "Tale of Painters",
    feedUrl: "https://www.taleofpainters.com/feed/",
    category: "warhammer",
  },
  {
    name: "Frontline Gaming",
    feedUrl: "https://www.frontlinegaming.org/feed/",
    category: "warhammer",
  },
  {
    name: "Wargamer",
    feedUrl: "https://www.wargamer.com/warhammer-40k/feed",
    category: "warhammer",
  },

  /* The wider hobby — board games, historicals, scale models, plastic kits */
  {
    name: "Tabletop Gaming News",
    feedUrl: "https://www.tabletopgamingnews.com/feed/",
    category: "wider",
  },
  {
    name: "Tabletop Gaming",
    feedUrl: "https://www.tabletopgaming.co.uk/feed",
    category: "wider",
  },
  {
    name: "OnTableTop",
    feedUrl: "https://ontabletop.com/feed/",
    category: "wider",
  },
  {
    name: "Wargames Illustrated",
    feedUrl: "https://wargamesillustrated.net/feed/",
    category: "wider",
  },
  {
    name: "Scale Modelling Now",
    feedUrl: "https://scalemodellingnow.com/feed/",
    category: "wider",
  },
  {
    // Atom rather than RSS, which is the point of keeping it in the list: the
    // parser's Atom path is exercised in production, not only in tests.
    name: "Wargames Atlantic",
    feedUrl: "https://www.wargamesatlantic.com/blogs/news.atom",
    category: "wider",
  },
];

/* -------------------------------------------------------------------------- */
/* Tunables                                                                   */
/* -------------------------------------------------------------------------- */

/** Identifies us to publishers, and gives them somewhere to complain. */
export const USER_AGENT =
  "SprueTubeNewsBot/1.0 (+https://spruetube.app/news; hobby news aggregator)";

/** One slow feed must not eat the cron's budget. */
export const FETCH_TIMEOUT_MS = 8_000;

/** Feeds with a year of full post bodies exist; read a bounded prefix. */
const MAX_FEED_BYTES = 2_000_000;

/** How many items a single run may publish. A brief, not a firehose. */
export const MAX_ITEMS_PER_RUN = 12;

/** So one prolific blog cannot become the whole day's news. */
export const MAX_ITEMS_PER_SOURCE = 3;

/**
 * Items older than this are skipped when the feed gives a date. A feed that has
 * not moved in months should contribute nothing rather than backfill the page
 * with things that were news in the spring.
 */
export const MAX_ITEM_AGE_DAYS = 30;

export const MAX_SUMMARY_LENGTH = 320;
export const MAX_TITLE_LENGTH = 200;

/* -------------------------------------------------------------------------- */
/* Entities and markup                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Only the entities that actually turn up in hobby feeds. A complete HTML5
 * table is ~2,200 names and would be dead weight in the Worker bundle; anything
 * missing is left as written, which reads oddly but never corrupts the text.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  minus: "−",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  dagger: "†",
  deg: "°",
  pound: "£",
  euro: "€",
  cent: "¢",
  yen: "¥",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  frac12: "½",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  ntilde: "ñ",
  oslash: "ø",
  aring: "å",
};

const ENTITY_PATTERN = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * Decodes one layer of entities.
 *
 * Unknown names and out-of-range code points are left exactly as written. A
 * feed that says `&thetasym;` should look wrong rather than lose a character,
 * and a lone surrogate would make the string unusable downstream.
 */
export function decodeEntitiesOnce(input: string): string {
  return input.replace(ENTITY_PATTERN, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/**
 * Feeds routinely double-escape — `&amp;#8217;` for an apostrophe — so one pass
 * leaves visible rubbish in the summary. Two passes fix the common case and the
 * bound stops a hand-crafted `&amp;amp;amp;…` chain from costing anything.
 *
 * Decoding cannot reintroduce live markup here because every caller strips tags
 * again afterwards, and nothing this module produces is ever rendered as HTML.
 */
export function decodeEntities(input: string, passes = 2): string {
  let out = input;
  for (let i = 0; i < passes; i++) {
    const next = decodeEntitiesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

/*
 * WordPress and most CMSs bolt these on to every excerpt. They are navigation,
 * not news, and they read as nonsense once the link they belonged to is gone.
 *
 * The "appeared first on" rule eats everything after it rather than matching to
 * the end of the string: several feeds append a strapline afterwards, and one in
 * the source list leaks the raw `%%post_title%%` placeholder.
 */
const TRAILERS: [RegExp, string][] = [
  [/\s*The post\b[\s\S]*?\bappeared first on\b[\s\S]*$/i, ""],
  [
    /\s*(continue reading|read more|read the full (article|story|post))\s*[…\.→>»]*\s*$/i,
    "",
  ],
  // The excerpt was cut mid-sentence by the CMS. Say so with an ellipsis rather
  // than leaving a bare dangling clause.
  [/\s*\[\s*(…|\.\.\.)\s*\]\s*$/, "…"],
];

function removeTrailers(value: string): string {
  let out = value;
  for (const [pattern, replacement] of TRAILERS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Feed markup in, plain text out.
 *
 * Feeds carry tracking pixels, share widgets and — occasionally — script tags,
 * so summaries are stored as text and rendered as text. Nothing downstream uses
 * dangerouslySetInnerHTML; this exists so the stored value is not markup in the
 * first place, which is the difference between one safe render and every future
 * render being safe.
 */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";

  let text = unwrapCdata(input);
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(
    /<(script|style|iframe|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  // An unbalanced <script> would otherwise leave its body behind as prose.
  text = text.replace(/<(script|style)\b[\s\S]*$/i, " ");
  // Block edges become spaces, or "…finished.</p><p>Next" runs into one word.
  text = text.replace(
    /<\/?(p|div|br|li|ul|ol|tr|td|h[1-6]|blockquote|section|figure)\b[^>]*>/gi,
    " ",
  );
  text = stripTags(text);
  text = decodeEntities(text);
  // Decoding can reveal markup that the feed had escaped twice. It is only text
  // by this point, but "<img src=x>" is not a summary.
  text = stripTags(text);
  text = removeTrailers(collapse(text));

  return collapse(text);
}

/* -------------------------------------------------------------------------- */
/* Summaries and slugs                                                        */
/* -------------------------------------------------------------------------- */

function truncateOnWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(" ");
  const kept = space > maxLength * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,;:–—-]+$/, "")}…`;
}

/**
 * A few sentences, no more. The summary is a pointer to somebody else's
 * article, so taking their whole piece would be both rude and legally silly.
 */
export function summarise(
  text: string,
  maxLength = MAX_SUMMARY_LENGTH,
  maxSentences = 3,
): string {
  const flat = collapse(text);
  if (!flat) return "";

  const sentences = flat.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g) ?? [flat];

  let out = "";
  for (const sentence of sentences.slice(0, maxSentences)) {
    const candidate = `${out}${sentence}`.trimEnd();
    if (out && candidate.length > maxLength) break;
    out = `${candidate} `;
  }

  return truncateOnWord(out.trim() || flat, maxLength);
}

function slugifyTitle(value: string): string {
  return (
    value
      .toLowerCase()
      // NFKD splits an accented letter into letter plus combining mark; drop
      // the marks so "Légion" becomes "legion" rather than "le-gion".
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "item"
  );
}

/** FNV-1a. Not a security hash — just a stable short suffix. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(-7);
}

/**
 * Slug for an item's page.
 *
 * The source URL is folded in because two outlets covering the same reveal
 * genuinely do publish the same headline on the same morning, and `slug` is
 * unique. Deriving it from the URL rather than a counter also makes the slug
 * stable: re-running the ingest produces the same slug for the same article.
 */
export function newsSlug(title: string, sourceUrl: string): string {
  return `${slugifyTitle(title)}-${shortHash(sourceUrl)}`;
}

/**
 * Normalises a link so "have we already got this?" is answerable.
 *
 * Campaign parameters are what make the same article arrive twice, once from
 * the feed and once with `?utm_source=rss` bolted on. The fragment goes for the
 * same reason. Nothing else about the URL is touched — rewriting a destination
 * is not this function's business.
 */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(decodeEntities(raw).trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;

  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_[a-z_]*|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

/* -------------------------------------------------------------------------- */
/* Feed parsing                                                               */
/* -------------------------------------------------------------------------- */

export type ParsedItem = {
  title: string;
  link: string;
  /** Still markup at this point — run it through stripHtml. */
  description: string | null;
  /** Unix seconds, or null when the feed has no usable date. */
  publishedAt: number | null;
};

const ITEM_BLOCK = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi;
const ENTRY_BLOCK = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry\s*>/gi;

function tagPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`,
    "i",
  );
}

/**
 * First non-empty of the given tags. Names are matched whole, so asking for
 * `content` does not accidentally return `content:encoded` — which matters,
 * because that one holds the entire article.
 */
function firstTag(block: string, names: string[]): string | null {
  for (const name of names) {
    const match = block.match(tagPattern(name));
    const value = match ? unwrapCdata(match[1] ?? "") : "";
    if (value.trim()) return value;
  }
  return null;
}

/** Atom puts the article URL in an attribute rather than in the element. */
function atomLink(block: string): string | null {
  let fallback: string | null = null;

  for (const match of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;

    const rel = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!rel || rel === "alternate") return href;
    // self, replies, enclosure and edit all point somewhere that is not the
    // article, and linking a reader at the feed itself is worse than nothing.
    if (!["self", "replies", "enclosure", "edit", "hub"].includes(rel)) {
      fallback ??= href;
    }
  }

  return fallback;
}

/** `<guid isPermaLink="false">` is an id, not a URL, and often ends up `?p=12`. */
function permalinkGuid(block: string): string | null {
  const match = block.match(/<guid\b([^>]*)>([\s\S]*?)<\/guid\s*>/i);
  if (!match) return null;
  if (/ispermalink\s*=\s*["']false["']/i.test(match[1] ?? "")) return null;
  return unwrapCdata(match[2] ?? "").trim() || null;
}

/**
 * Unix seconds from an RSS or Atom date, or null.
 *
 * Anything before 1990 is treated as absent: feeds emit epoch-zero placeholders
 * when a date is missing, and a 1970 item would sit at the bottom of the page
 * for ever rather than being skipped.
 */
export function parseFeedDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(decodeEntities(value).trim());
  if (!Number.isFinite(parsed)) return null;
  const seconds = Math.floor(parsed / 1000);
  return seconds < 631_152_000 ? null : seconds;
}

/**
 * RSS 2.0 and Atom, from the same function.
 *
 * The two formats differ in about six places and agree everywhere else, so
 * telling them apart is not worth a branch: take whichever block element is
 * present and ask for both spellings of every field.
 */
export function parseFeed(xml: string | null | undefined): ParsedItem[] {
  if (!xml) return [];

  // Strip comments first, so a commented-out example item is not ingested.
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");

  let blocks = [...text.matchAll(ITEM_BLOCK)].map((m) => m[1] ?? "");
  if (!blocks.length) {
    blocks = [...text.matchAll(ENTRY_BLOCK)].map((m) => m[1] ?? "");
  }

  const items: ParsedItem[] = [];

  for (const block of blocks) {
    const rawTitle = firstTag(block, ["title"]);
    const title = collapse(decodeEntities(stripTags(rawTitle ?? "")));
    if (!title) continue;

    const rawLink =
      firstTag(block, ["link"]) ??
      atomLink(block) ??
      firstTag(block, ["id"]) ??
      permalinkGuid(block);
    const link = rawLink ? collapse(decodeEntities(rawLink)) : "";
    if (!link) continue;

    items.push({
      title: truncateOnWord(title, MAX_TITLE_LENGTH),
      link,
      // `description`/`summary` are the excerpt; `content:encoded`/`content`
      // are the whole article, used only when there is no excerpt at all.
      description: firstTag(block, [
        "description",
        "summary",
        "content:encoded",
        "content",
      ]),
      publishedAt: parseFeedDate(
        firstTag(block, ["pubdate", "published", "dc:date", "updated", "date"]),
      ),
    });
  }

  return items;
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

export type Candidate = {
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  category: NewsCategory;
  publishedAt: number;
};

/** Keeps the first `max` items from each source, in the order given. */
export function capPerSource<T extends { sourceName: string }>(
  items: T[],
  max = MAX_ITEMS_PER_SOURCE,
): T[] {
  const counts = new Map<string, number>();
  const kept: T[] = [];

  for (const item of items) {
    const used = counts.get(item.sourceName) ?? 0;
    if (used >= max) continue;
    counts.set(item.sourceName, used + 1);
    kept.push(item);
  }

  return kept;
}

/**
 * Picks the day's items, alternating between the two halves of the brief.
 *
 * The 50/50 split is the product, not a nice-to-have — a page that drifts into
 * being all Warhammer stops being a hobby brief — so it is enforced by strict
 * alternation rather than by hoping the feeds cooperate. While both sides have
 * something to give, the counts can never differ by more than one. When one
 * side runs dry the other fills the rest: a half-empty page helps nobody, and
 * `ingestNews` reports the resulting split so a persistently lopsided run is
 * visible in the logs rather than silent.
 */
export function selectBalanced<
  T extends { category: NewsCategory; publishedAt: number },
>(candidates: T[], limit = MAX_ITEMS_PER_RUN): T[] {
  if (limit <= 0) return [];

  const newestFirst = (a: T, b: T) => b.publishedAt - a.publishedAt;
  const queues: Record<NewsCategory, T[]> = {
    warhammer: candidates
      .filter((c) => c.category === "warhammer")
      .sort(newestFirst),
    wider: candidates.filter((c) => c.category === "wider").sort(newestFirst),
  };

  // Start with whichever side has the fresher headline, so the top of the page
  // is the newest thing we found rather than always the same category.
  let turn: NewsCategory =
    (queues.wider[0]?.publishedAt ?? -Infinity) >
    (queues.warhammer[0]?.publishedAt ?? -Infinity)
      ? "wider"
      : "warhammer";

  const picked: T[] = [];
  while (picked.length < limit) {
    const other: NewsCategory = turn === "warhammer" ? "wider" : "warhammer";
    const from = queues[turn].length ? turn : other;
    const next = queues[from].shift();
    if (!next) break;
    picked.push(next);
    turn = from === "warhammer" ? "wider" : "warhammer";
  }

  return picked;
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function fetchFeed(
  source: NewsSource,
  fetchImpl: FetchLike,
): Promise<string> {
  const response = await fetchImpl(source.feedUrl, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept:
        "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
    },
    // Every outbound call is bounded. A publisher having a bad morning must not
    // hold the cron open until the Worker is killed.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = await response.text();
  // A truncated tail simply has no closing </item>, so the parser drops it.
  return body.length > MAX_FEED_BYTES ? body.slice(0, MAX_FEED_BYTES) : body;
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/* -------------------------------------------------------------------------- */
/* Ingest                                                                     */
/* -------------------------------------------------------------------------- */

export type IngestResult = {
  sourcesRead: number;
  failures: { source: string; reason: string }[];
  candidates: number;
  inserted: number;
  split: Record<NewsCategory, number>;
};

export type IngestOptions = {
  sources?: NewsSource[];
  limit?: number;
  /** Unix seconds. Injectable so the age window is testable. */
  now?: number;
  fetchImpl?: FetchLike;
  db?: Db;
};

function toCandidate(
  item: ParsedItem,
  source: NewsSource,
  now: number,
): Candidate | null {
  const sourceUrl = canonicalUrl(item.link);
  if (!sourceUrl) return null;

  const title = collapse(item.title);
  if (!title) return null;

  // Future-dated items exist (scheduled posts, wrong timezones) and would pin
  // themselves to the top of the page until the clock caught up.
  const publishedAt = Math.min(item.publishedAt ?? now, now);
  if (
    item.publishedAt !== null &&
    publishedAt < now - MAX_ITEM_AGE_DAYS * 86_400
  ) {
    return null;
  }

  // No excerpt in the feed: fall back to the headline, which is still the
  // publisher's own words. Never our own, and never a model's.
  const summary = summarise(stripHtml(item.description)) || title;

  return {
    title,
    summary,
    sourceName: source.name,
    sourceUrl,
    category: source.category,
    publishedAt,
  };
}

/**
 * One day's ingest.
 *
 * Feeds are read in parallel and independently: a source that 403s, times out
 * or serves broken XML is recorded and skipped, and the rest of the run carries
 * on. If everything fails, nothing is published — which is the correct outcome,
 * because the alternative is a page of news nobody wrote.
 */
export async function ingestNews(
  env: Env,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const {
    sources = NEWS_SOURCES,
    limit = MAX_ITEMS_PER_RUN,
    now = Math.floor(Date.now() / 1000),
    fetchImpl = fetch as FetchLike,
    db = createDb(env.DB),
  } = options;

  const results = await Promise.allSettled(
    sources.map((source) => fetchFeed(source, fetchImpl)),
  );

  const failures: IngestResult["failures"] = [];
  const candidates: Candidate[] = [];
  const seenUrls = new Set<string>();

  results.forEach((result, index) => {
    const source = sources[index]!;
    if (result.status === "rejected") {
      failures.push({ source: source.name, reason: reasonOf(result.reason) });
      return;
    }

    try {
      for (const item of parseFeed(result.value)) {
        const candidate = toCandidate(item, source, now);
        if (!candidate) continue;
        if (seenUrls.has(candidate.sourceUrl)) continue;
        seenUrls.add(candidate.sourceUrl);
        candidates.push(candidate);
      }
    } catch (error) {
      failures.push({ source: source.name, reason: reasonOf(error) });
    }
  });

  const shortlist = capPerSource(
    [...candidates].sort((a, b) => b.publishedAt - a.publishedAt),
  );

  const fresh = await withoutKnownUrls(db, shortlist);
  const chosen = selectBalanced(fresh, limit);

  const rows = chosen.map((candidate) => ({
    id: newId("news"),
    slug: newsSlug(candidate.title, candidate.sourceUrl),
    title: candidate.title,
    summary: candidate.summary,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    category: candidate.category,
    publishedAt: candidate.publishedAt,
  }));

  // Chunked because D1 caps bound parameters per statement, and eight columns
  // times a dozen rows is enough to trip it. ON CONFLICT DO NOTHING covers both
  // unique indexes, so a run that overlaps another is a no-op rather than a 500.
  for (let i = 0; i < rows.length; i += 10) {
    await db
      .insert(newsItem)
      .values(rows.slice(i, i + 10))
      .onConflictDoNothing();
  }

  return {
    sourcesRead: sources.length - failures.length,
    failures,
    candidates: shortlist.length,
    inserted: rows.length,
    split: {
      warhammer: chosen.filter((c) => c.category === "warhammer").length,
      wider: chosen.filter((c) => c.category === "wider").length,
    },
  };
}

/** Drops candidates whose source URL is already in the table. */
async function withoutKnownUrls(
  db: Db,
  candidates: Candidate[],
): Promise<Candidate[]> {
  if (!candidates.length) return [];

  const known = new Set<string>();
  const urls = candidates.map((c) => c.sourceUrl);

  for (let i = 0; i < urls.length; i += 50) {
    const chunk = urls.slice(i, i + 50);
    const rows = await db
      .select({ sourceUrl: newsItem.sourceUrl })
      .from(newsItem)
      .where(inArray(newsItem.sourceUrl, chunk));
    for (const row of rows) known.add(row.sourceUrl);
  }

  return candidates.filter((c) => !known.has(c.sourceUrl));
}

/* -------------------------------------------------------------------------- */
/* Scheduling                                                                 */
/* -------------------------------------------------------------------------- */

/** Early enough that the brief is there before the first cup of tea. */
export const NEWS_INGEST_HOUR_UTC = 6;

/**
 * Whether this cron tick is the daily one.
 *
 * The Worker has a single cron expression, and adding a second would mean
 * editing wrangler.jsonc, so the daily job rides the quarter-hourly sweep and
 * picks its slot from the tick's own scheduled time. Exactly one tick per day
 * falls inside the window; if a tick is retried and two do, the unique index on
 * `source_url` makes the second run a no-op.
 */
export function shouldRunDailyIngest(
  scheduledTime: number,
  cronIntervalMinutes = 15,
): boolean {
  const at = new Date(scheduledTime);
  if (Number.isNaN(at.getTime())) return false;
  return (
    at.getUTCHours() === NEWS_INGEST_HOUR_UTC &&
    at.getUTCMinutes() < cronIntervalMinutes
  );
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export type NewsListItem = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  category: NewsCategory;
  status: "published" | "hidden";
  publishedAt: number;
};

export const NEWS_PAGE_SIZE = 30;

const NEWS_COLUMNS = {
  id: newsItem.id,
  slug: newsItem.slug,
  title: newsItem.title,
  summary: newsItem.summary,
  sourceName: newsItem.sourceName,
  sourceUrl: newsItem.sourceUrl,
  category: newsItem.category,
  status: newsItem.status,
  publishedAt: newsItem.publishedAt,
};

export type NewsPage = { items: NewsListItem[]; nextCursor: number | null };

/**
 * Newest first, paged on `publishedAt`.
 *
 * The cursor is the timestamp rather than an opaque token because ties are
 * harmless here — a day's ingest is a dozen rows, not a busy feed — and a
 * readable cursor makes the API easy to use from a script.
 */
export async function listNews(
  db: Db,
  options: {
    category?: NewsCategory | null;
    before?: number | null;
    limit?: number;
    includeHidden?: boolean;
  } = {},
): Promise<NewsPage> {
  const limit = Math.min(Math.max(options.limit ?? NEWS_PAGE_SIZE, 1), 50);

  const filters = [
    options.includeHidden ? undefined : eq(newsItem.status, "published"),
    options.category ? eq(newsItem.category, options.category) : undefined,
    options.before ? lt(newsItem.publishedAt, options.before) : undefined,
  ].filter((f) => f !== undefined);

  const rows = await db
    .select(NEWS_COLUMNS)
    .from(newsItem)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(newsItem.publishedAt), desc(newsItem.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit) as NewsListItem[];
  const nextCursor =
    rows.length > limit ? (items[items.length - 1]?.publishedAt ?? null) : null;

  return { items, nextCursor };
}

export async function getNewsBySlug(
  db: Db,
  slug: string,
  options: { includeHidden?: boolean } = {},
): Promise<NewsListItem | null> {
  const rows = await db
    .select(NEWS_COLUMNS)
    .from(newsItem)
    .where(
      options.includeHidden
        ? eq(newsItem.slug, slug)
        : and(eq(newsItem.slug, slug), eq(newsItem.status, "published")),
    )
    .limit(1);

  return (rows[0] as NewsListItem | undefined) ?? null;
}

/** Admin-only. Hiding is the whole moderation story for news — nothing is edited. */
export async function setNewsStatus(
  db: Db,
  id: string,
  status: "published" | "hidden",
): Promise<NewsListItem | null> {
  const rows = await db
    .update(newsItem)
    .set({ status })
    .where(eq(newsItem.id, id))
    .returning(NEWS_COLUMNS);

  return (rows[0] as NewsListItem | undefined) ?? null;
}

/** Recent items for the sitemap and any "latest headlines" strip. */
export async function recentNewsSlugs(db: Db, limit = 100) {
  return db
    .select({ slug: newsItem.slug, publishedAt: newsItem.publishedAt })
    .from(newsItem)
    .where(eq(newsItem.status, "published"))
    .orderBy(desc(newsItem.publishedAt))
    .limit(limit);
}
