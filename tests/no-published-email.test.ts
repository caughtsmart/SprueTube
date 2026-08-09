import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * No email address is published on the site. Not one.
 *
 * Every route to us goes through /contact, which is a deliberate decision and
 * a fragile one: an address is a single character of markup away from being
 * back, and it would come back in exactly the place nobody re-reads — a
 * paragraph of the privacy notice, a moderation message, a footer.
 *
 * So this test walks the source rather than trusting review. It is the only
 * test here that reads the filesystem, which is worth it because the thing it
 * protects is a promise made to the person who typed the address in.
 *
 * `noreply@spruetube.app` is exempt: it is the envelope sender in config and
 * on outbound mail, never a route in. Nobody is being invited to write to it.
 */

const ROOTS = ["app", "server", "workers"];
const CODE = /\.(ts|tsx)$/;

/** Addresses that may legitimately appear, because nothing invites a reply. */
const ALLOWED = new Set(["noreply@spruetube.app"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...sourceFiles(path));
    else if (CODE.test(item.name)) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)));

describe("no published email address", () => {
  it("finds source to check, so a broken walk cannot pass silently", () => {
    // Without this, a typo in ROOTS turns every assertion below into a
    // vacuous truth about an empty list.
    expect(files.length).toBeGreaterThan(40);
  });

  it("has no mailto: link anywhere in the app", () => {
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes("mailto:"),
    );
    expect(offenders).toEqual([]);
  });

  it("names no address on either of our domains", () => {
    const pattern = /[\w.+-]+@(?:spruetube\.app|loadeddice\.uk)/g;
    const offenders: string[] = [];

    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
        if (!ALLOWED.has(match[0])) offenders.push(`${file}: ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
