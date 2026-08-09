import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  capPerSource,
  decodeEntities,
  MAX_ITEMS_PER_RUN,
  NEWS_SOURCES,
  newsSlug,
  parseFeed,
  parseFeedDate,
  selectBalanced,
  shouldRunDailyIngest,
  stripHtml,
  summarise,
} from "../server/services/news";
import type { NewsCategory } from "../app/lib/taxonomy";

/*
 * The fixtures below are trimmed from the real feeds in NEWS_SOURCES, kept in
 * their original mess — tabs, CDATA, double-escaped entities, a guid that is
 * not a URL, an item with no description at all. A parser that only survives
 * tidy XML survives nothing, because no feed in the list emits tidy XML.
 */

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:atom="http://www.w3.org/2005/Atom"
	xmlns:media="http://search.yahoo.com/mrss/">
<channel>
	<title>Scale Modelling Now</title>
	<atom:link href="https://www.scalemodellingnow.com/feed/" rel="self" type="application/rss+xml" />
	<link>https://www.scalemodellingnow.com</link>
	<description>Kit reviews and build guides</description>
	<lastBuildDate>Fri, 08 Aug 2026 09:12:00 +0000</lastBuildDate>
	<item>
		<title>Revell Hawker Hunter T.7/T.7A 1:32 &#8211; in-box kit review</title>
		<link>https://www.scalemodellingnow.com/revell-hawker-hunter-t7-t7a-132?utm_source=rss&#038;utm_medium=feed#respond</link>
		<dc:creator><![CDATA[Francis Porter]]></dc:creator>
		<pubDate>Thu, 06 Aug 2026 18:52:04 +0000</pubDate>
		<category><![CDATA[Aircraft]]></category>
		<guid isPermaLink="false">https://www.scalemodellingnow.com/?p=166721</guid>
		<description><![CDATA[<p>Kit Ref: 03786. In-Box Video Browse with Geoff Coughlin. The long-awaited Hunter series two-seater &#8211; reconstructed using 3D scanning technology. Precise panel lines throughout, and a choice of two marking options.</p>
<p>The post <a href="https://www.scalemodellingnow.com/revell-hawker-hunter-t7-t7a-132">Revell Hawker Hunter T.7/T.7A 1:32</a> appeared first on <a href="https://www.scalemodellingnow.com">Scale Modelling Now</a>.</p>
]]></description>
	</item>
	<item>
		<title>This Warhammer 40k artist paints primarchs and it&#039;s cute as HECK</title>
		<link>https://www.wargamer.com/warhammer-40k/fan-art-big-pangolin-primarch-daughters</link>
		<guid isPermaLink="true">https://www.wargamer.com/warhammer-40k/fan-art-big-pangolin-primarch-daughters</guid>
		<description>
			<![CDATA[
			<p>If Warhammer 40,000&amp;#8217;s mighty demigod primarchs were adorable single dads, this is what you&#039;d get.</p>
			]]>
		</description>
		<content:encoded><![CDATA[<p>A much longer article body that must never be mistaken for the excerpt.</p>]]></content:encoded>
	</item>
	<item>
		<title><![CDATA[Black Library Readers&#x27; Hall of Fame]]></title>
		<link>https://www.goonhammer.com/black-library-readers-hall-of-fame/</link>
		<pubDate>not a date at all</pubDate>
		<description />
	</item>
</channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xml:lang="en" xmlns="http://www.w3.org/2005/Atom" xmlns:s="http://jadedpixel.com/-/spec/shopify">
  <id>https://wargamesatlantic.com/blogs/news</id>
  <title>Wargames Atlantic News</title>
  <link rel="self" type="application/atom+xml" href="https://www.wargamesatlantic.com/blogs/news.atom"/>
  <entry>
    <id>https://wargamesatlantic.com/blogs/news/rifleman-harris-and-villagers-2</id>
    <published>2026-08-06T21:19:30-04:00</published>
    <updated>2026-08-07T09:02:11-04:00</updated>
    <link rel="replies" type="text/html" href="https://wargamesatlantic.com/blogs/news/rifleman-harris-and-villagers-2#comments"/>
    <link rel="alternate" type="text/html" href="https://wargamesatlantic.com/blogs/news/rifleman-harris-and-villagers-2"/>
    <title>Two Exciting Releases Today! Rifleman Harris and Villagers 2!</title>
    <author><name>Wargames Atlantic</name></author>
    <content type="html">
      <![CDATA[<p>Another of our bi-weekly release dates arrives and we have a double release today!</p>
<p style="text-align: center;"><a href="https://wargamesatlantic.com/products/rifleman-harris"><img src="https://cdn.shopify.com/files/54.jpg?v=1786049770" alt=""></a></p>
<p>Depicted as he was in the novel and show Sharpe&#39;s Rifles, Harris is our third entry in the Sharpe Legends series.</p>]]>
    </content>
  </entry>
  <entry>
    <id>https://wargamesatlantic.com/blogs/news/plastic-sprue-preview</id>
    <link rel="alternate" type="text/html" href="https://wargamesatlantic.com/blogs/news/plastic-sprue-preview"/>
    <title>Plastic sprue preview</title>
    <summary>A first look at the new hard plastic frame.</summary>
  </entry>
</feed>`;

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

describe("NEWS_SOURCES", () => {
  it("is split evenly between Warhammer and the wider hobby", () => {
    const warhammer = NEWS_SOURCES.filter((s) => s.category === "warhammer");
    const wider = NEWS_SOURCES.filter((s) => s.category === "wider");
    expect(warhammer.length).toBe(wider.length);
  });

  it("has no duplicate feeds and every URL is https", () => {
    const urls = NEWS_SOURCES.map((s) => s.feedUrl);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url.startsWith("https://")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

describe("parseFeed — RSS 2.0", () => {
  const items = parseFeed(RSS_FIXTURE);

  it("reads every item in the channel", () => {
    expect(items).toHaveLength(3);
  });

  it("decodes entities in the title", () => {
    expect(items[0]!.title).toBe(
      "Revell Hawker Hunter T.7/T.7A 1:32 – in-box kit review",
    );
  });

  it("decodes entities inside CDATA titles", () => {
    expect(items[2]!.title).toBe("Black Library Readers' Hall of Fame");
  });

  it("prefers <link> over a guid that is not a permalink", () => {
    expect(items[0]!.link).toContain(
      "https://www.scalemodellingnow.com/revell-hawker-hunter-t7-t7a-132",
    );
    expect(items[0]!.link).not.toContain("?p=166721");
  });

  it("takes the excerpt, never content:encoded, when both are present", () => {
    expect(items[1]!.description).toContain("adorable single dads");
    expect(items[1]!.description).not.toContain("much longer article body");
  });

  it("parses an RFC 822 pubDate", () => {
    expect(items[0]!.publishedAt).toBe(
      Math.floor(Date.parse("Thu, 06 Aug 2026 18:52:04 +0000") / 1000),
    );
  });

  it("returns null rather than a wrong date when there is no usable one", () => {
    expect(items[1]!.publishedAt).toBeNull();
    expect(items[2]!.publishedAt).toBeNull();
  });

  it("copes with a self-closing empty description", () => {
    expect(items[2]!.description).toBeNull();
  });
});

describe("parseFeed — Atom", () => {
  const items = parseFeed(ATOM_FIXTURE);

  it("reads entries when there are no items", () => {
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe(
      "Two Exciting Releases Today! Rifleman Harris and Villagers 2!",
    );
  });

  it("follows rel=alternate rather than the first link in the entry", () => {
    expect(items[0]!.link).toBe(
      "https://wargamesatlantic.com/blogs/news/rifleman-harris-and-villagers-2",
    );
  });

  it("prefers published over updated", () => {
    expect(items[0]!.publishedAt).toBe(
      Math.floor(Date.parse("2026-08-06T21:19:30-04:00") / 1000),
    );
  });

  it("falls back to summary when there is no content", () => {
    expect(items[1]!.description).toBe(
      "A first look at the new hard plastic frame.",
    );
    expect(items[1]!.publishedAt).toBeNull();
  });
});

describe("parseFeed — hostile and broken input", () => {
  it("returns nothing rather than throwing on rubbish", () => {
    expect(parseFeed("")).toEqual([]);
    expect(parseFeed(null)).toEqual([]);
    expect(parseFeed("<html><body>not a feed</body></html>")).toEqual([]);
    expect(parseFeed("<rss><channel><item>")).toEqual([]);
  });

  it("drops an item with no link, since it could not be attributed", () => {
    const xml = `<rss><channel><item><title>Orphan</title></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([]);
  });

  it("drops an item with no title", () => {
    const xml = `<rss><channel><item><link>https://example.com/a</link></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([]);
  });

  it("ignores a commented-out item", () => {
    const xml = `<rss><channel><!-- <item><title>Ghost</title><link>https://example.com/g</link></item> --><item><title>Real</title><link>https://example.com/r</link></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Real");
  });

  it("survives a truncated feed by dropping the unterminated item", () => {
    const truncated = RSS_FIXTURE.slice(0, RSS_FIXTURE.indexOf("<pubDate>not"));
    expect(parseFeed(truncated)).toHaveLength(2);
  });
});

describe("parseFeedDate", () => {
  it("reads RFC 822 and ISO 8601", () => {
    // 2026-08-06 18:52:04 UTC, and 2026-08-07 01:19:30 UTC.
    expect(parseFeedDate("Thu, 06 Aug 2026 18:52:04 +0000")).toBe(1786042324);
    expect(parseFeedDate("2026-08-06T21:19:30-04:00")).toBe(1786065570);
  });

  it("treats placeholder epochs as missing", () => {
    expect(parseFeedDate("Thu, 01 Jan 1970 00:00:00 +0000")).toBeNull();
  });

  it("returns null for nonsense and for nothing", () => {
    expect(parseFeedDate("soon")).toBeNull();
    expect(parseFeedDate("")).toBeNull();
    expect(parseFeedDate(null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Entities and the HTML stripper                                             */
/* -------------------------------------------------------------------------- */

describe("decodeEntities", () => {
  it("handles named, decimal and hexadecimal forms", () => {
    expect(decodeEntities("Blood &amp; Glory &#8211; &#x27;Eavy Metal")).toBe(
      "Blood & Glory – 'Eavy Metal",
    );
  });

  it("undoes the double escaping feeds are full of", () => {
    expect(decodeEntities("Sharpe&amp;#39;s Rifles")).toBe("Sharpe's Rifles");
  });

  it("leaves an unknown entity exactly as written", () => {
    expect(decodeEntities("&thetasym; &notanentity;")).toBe(
      "&thetasym; &notanentity;",
    );
  });

  it("refuses code points that would corrupt the string", () => {
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
    expect(decodeEntities("&#0;")).toBe("&#0;");
  });
});

describe("stripHtml", () => {
  it("removes scripts and their contents entirely", () => {
    const nasty = `<p>New kit.</p><script>alert(document.cookie)</script><style>.x{color:red}</style>`;
    const out = stripHtml(nasty);
    expect(out).toBe("New kit.");
    expect(out).not.toContain("alert");
  });

  it("removes an unclosed script rather than leaving its body as prose", () => {
    const out = stripHtml(`<p>Real text.</p><script>fetch("https://evil")`);
    expect(out).toBe("Real text.");
  });

  it("drops tracking pixels and image markup", () => {
    const out = stripHtml(
      `<img src="https://assetsio.gnwcdn.com/art.png?width=690" /> <p>Hello Wizard is a new RPG.</p><img src="https://track.example/p.gif?id=1" width="1" height="1">`,
    );
    expect(out).toBe("Hello Wizard is a new RPG.");
  });

  it("does not run block elements together", () => {
    expect(stripHtml("<p>First sentence.</p><p>Second sentence.</p>")).toBe(
      "First sentence. Second sentence.",
    );
    expect(stripHtml("Line one<br/>Line two")).toBe("Line one Line two");
  });

  it("strips markup that was double-escaped in the feed", () => {
    const out = stripHtml("&lt;img src=x onerror=alert(1)&gt; Real summary.");
    expect(out).toBe("Real summary.");
    expect(out).not.toContain("<");
  });

  it("removes the CMS trailer that follows every WordPress excerpt", () => {
    const out = stripHtml(
      `<p>A choice of two marking options.</p><p>The post <a href="#">Revell Hunter</a> appeared first on <a href="#">Scale Modelling Now</a>.</p>`,
    );
    expect(out).toBe("A choice of two marking options.");
  });

  it("turns a cut-off excerpt marker into an honest ellipsis", () => {
    expect(stripHtml("<p>Precise panel lines throughout [&#8230;]</p>")).toBe(
      "Precise panel lines throughout…",
    );
  });

  it("removes a trailing read-more", () => {
    expect(stripHtml("<p>Something happened.</p><p>Read more</p>")).toBe(
      "Something happened.",
    );
  });

  it("removes a CMS trailer that has a strapline bolted after it", () => {
    const out = stripHtml(
      "<p>A budget army deal.</p><p>The post %%post_title%% appeared first on %%site_link%%. Expert tactics since 2011.</p>",
    );
    expect(out).toBe("A budget army deal.");
  });

  it("handles nothing at all", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml("")).toBe("");
    expect(stripHtml("<div><span></span></div>")).toBe("");
  });

  it("leaves plain prose untouched apart from whitespace", () => {
    expect(stripHtml("  Two   spaces  and\na newline. ")).toBe(
      "Two spaces and a newline.",
    );
  });
});

describe("summarise", () => {
  const long =
    "One sentence here. Two sentences here. Three sentences here. Four sentences here. Five sentences here.";

  it("keeps at most three sentences", () => {
    expect(summarise(long)).toBe(
      "One sentence here. Two sentences here. Three sentences here.",
    );
  });

  it("truncates on a word boundary with an ellipsis", () => {
    const out = summarise("Warhammer ".repeat(60), 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("Warhamm…");
  });

  it("returns something for a single sentence with no full stop", () => {
    expect(summarise("New plastic Orks revealed at the weekend")).toBe(
      "New plastic Orks revealed at the weekend",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(summarise("")).toBe("");
    expect(summarise("   ")).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* Slugs and URLs                                                             */
/* -------------------------------------------------------------------------- */

describe("newsSlug", () => {
  const url = "https://www.goonhammer.com/black-library-hall-of-fame/";

  it("is a clean, lowercase, hyphenated slug", () => {
    expect(newsSlug("Black Library Readers' Hall of Fame", url)).toMatch(
      /^black-library-readers-hall-of-fame-[a-z0-9]{7}$/,
    );
  });

  it("is stable, so re-running the ingest cannot fork an item", () => {
    expect(newsSlug("Same headline", url)).toBe(newsSlug("Same headline", url));
  });

  it("separates two outlets running the same headline", () => {
    const a = newsSlug("Games Workshop reveals new Orks", "https://a.test/x");
    const b = newsSlug("Games Workshop reveals new Orks", "https://b.test/y");
    expect(a).not.toBe(b);
    expect(a.startsWith("games-workshop-reveals-new-orks-")).toBe(true);
  });

  it("flattens accents rather than dropping the letter", () => {
    expect(newsSlug("Légion de la Mort", url).startsWith("legion-de-la-mort-")).toBe(
      true,
    );
  });

  it("still produces a usable slug from an unslugabble title", () => {
    expect(newsSlug("★★★", url)).toMatch(/^item-[a-z0-9]{7}$/);
  });
});

describe("canonicalUrl", () => {
  it("strips campaign parameters and fragments", () => {
    expect(
      canonicalUrl(
        "https://example.com/post?utm_source=rss&utm_medium=feed&id=7#respond",
      ),
    ).toBe("https://example.com/post?id=7");
  });

  it("makes the two spellings of one article dedupe to the same key", () => {
    expect(canonicalUrl("https://Example.com/post#comments")).toBe(
      canonicalUrl("https://example.com/post?utm_campaign=daily"),
    );
  });

  it("refuses anything that is not a web URL", () => {
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalUrl("/relative/path")).toBeNull();
    expect(canonicalUrl("mailto:someone@example.com")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
    expect(canonicalUrl(null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

type Pick = { category: NewsCategory; publishedAt: number; sourceName: string };

function make(
  category: NewsCategory,
  count: number,
  sourceName = category,
): Pick[] {
  return Array.from({ length: count }, (_, i) => ({
    category,
    sourceName,
    publishedAt: 1_800_000_000 - i * 3600,
  }));
}

describe("selectBalanced", () => {
  it("splits a full run down the middle", () => {
    const chosen = selectBalanced(
      [...make("warhammer", 20), ...make("wider", 20)],
      MAX_ITEMS_PER_RUN,
    );
    expect(chosen).toHaveLength(MAX_ITEMS_PER_RUN);
    expect(chosen.filter((c) => c.category === "warhammer")).toHaveLength(
      MAX_ITEMS_PER_RUN / 2,
    );
  });

  it("never lets the two sides drift more than one apart, at any odd limit", () => {
    for (const limit of [1, 3, 5, 7, 9, 11]) {
      const chosen = selectBalanced(
        [...make("warhammer", 20), ...make("wider", 20)],
        limit,
      );
      const warhammer = chosen.filter((c) => c.category === "warhammer").length;
      expect(chosen).toHaveLength(limit);
      expect(Math.abs(warhammer - (chosen.length - warhammer))).toBeLessThanOrEqual(1);
    }
  });

  it("alternates rather than blocking one category together", () => {
    const chosen = selectBalanced(
      [...make("warhammer", 10), ...make("wider", 10)],
      6,
    );
    for (let i = 1; i < chosen.length; i++) {
      expect(chosen[i]!.category).not.toBe(chosen[i - 1]!.category);
    }
  });

  it("fills up from the other side when one runs dry", () => {
    const chosen = selectBalanced(
      [...make("warhammer", 10), ...make("wider", 2)],
      8,
    );
    expect(chosen).toHaveLength(8);
    expect(chosen.filter((c) => c.category === "wider")).toHaveLength(2);
  });

  it("takes the newest first within each half", () => {
    const chosen = selectBalanced(
      [...make("warhammer", 5), ...make("wider", 5)],
      4,
    );
    const warhammer = chosen.filter((c) => c.category === "warhammer");
    expect(warhammer[0]!.publishedAt).toBeGreaterThan(
      warhammer[1]!.publishedAt,
    );
  });

  it("leads with whichever side has the fresher headline", () => {
    const stale = make("warhammer", 3).map((c) => ({
      ...c,
      publishedAt: c.publishedAt - 86_400,
    }));
    expect(selectBalanced([...stale, ...make("wider", 3)], 4)[0]!.category).toBe(
      "wider",
    );
  });

  it("publishes nothing when there is nothing, and honours a zero limit", () => {
    expect(selectBalanced([], 10)).toEqual([]);
    expect(selectBalanced(make("wider", 5), 0)).toEqual([]);
  });
});

describe("capPerSource", () => {
  it("stops one prolific blog from becoming the whole brief", () => {
    const items = [
      ...make("warhammer", 8, "Spikey Bits"),
      ...make("wider", 2, "OnTableTop"),
    ];
    const capped = capPerSource(items, 3);
    expect(capped.filter((i) => i.sourceName === "Spikey Bits")).toHaveLength(3);
    expect(capped.filter((i) => i.sourceName === "OnTableTop")).toHaveLength(2);
  });

  it("keeps the order it was given, so newest-first survives the cap", () => {
    const items = make("wider", 5, "Dicebreaker");
    const capped = capPerSource(items, 2);
    expect(capped[0]!.publishedAt).toBe(items[0]!.publishedAt);
    expect(capped[1]!.publishedAt).toBe(items[1]!.publishedAt);
  });
});

/* -------------------------------------------------------------------------- */
/* Scheduling                                                                 */
/* -------------------------------------------------------------------------- */

describe("shouldRunDailyIngest", () => {
  const at = (iso: string) => Date.parse(iso);

  it("fires on exactly one tick of the quarter-hourly cron", () => {
    const ticks = [
      "2026-08-08T05:45:00Z",
      "2026-08-08T06:00:00Z",
      "2026-08-08T06:15:00Z",
      "2026-08-08T06:30:00Z",
      "2026-08-08T06:45:00Z",
      "2026-08-08T07:00:00Z",
    ];
    expect(ticks.filter((t) => shouldRunDailyIngest(at(t)))).toEqual([
      "2026-08-08T06:00:00Z",
    ]);
  });

  it("stays quiet for the rest of the day", () => {
    expect(shouldRunDailyIngest(at("2026-08-08T00:00:00Z"))).toBe(false);
    expect(shouldRunDailyIngest(at("2026-08-08T18:00:00Z"))).toBe(false);
  });

  it("does not run on a broken timestamp", () => {
    expect(shouldRunDailyIngest(Number.NaN)).toBe(false);
  });
});
