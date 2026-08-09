import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Exactly two addresses may appear in the source, and neither belongs to a
 * person.
 *
 * `hello@spruetube.app` is published deliberately — the law requires an address
 * and a form alone does not satisfy it, which is set out on CONTACT_EMAIL in
 * app/lib/legal.ts. It is a role address forwarded by Email Routing, so the
 * person reading it can change without a deploy.
 *
 * `noreply@spruetube.app` is the envelope sender on outbound mail. Nobody is
 * invited to write to it.
 *
 * Everything else is a defect, and the two that matter are a personal address
 * — the whole point of the role address is that graham@ and leigh@ stay off a
 * page that is crawled, archived and scraped — and the resurrection of
 * safety@ or privacy@, which are not onboarded and would silently bounce a
 * report.
 *
 * This walks the source rather than trusting review, because an address is one
 * character of markup away from being back and it would come back in exactly
 * the place nobody re-reads: a paragraph of the privacy notice, a moderation
 * message, a footer.
 */

const ROOTS = ["app", "server", "workers"];
const CODE = /\.(ts|tsx)$/;

/** The only two that may appear, and why. */
const ALLOWED = new Set(["hello@spruetube.app", "noreply@spruetube.app"]);

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

/** Every address on either of our domains, with the file it came from. */
function addressesInSource(): string[] {
  const pattern = /[\w.+-]+@(?:spruetube\.app|loadeddice\.uk)/g;
  const found: string[] = [];
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      found.push(`${file}: ${match[0]}`);
    }
  }
  return found;
}

describe("published email addresses", () => {
  it("finds source to check, so a broken walk cannot pass silently", () => {
    // Without this, a typo in ROOTS turns every assertion below into a
    // vacuous truth about an empty list.
    expect(files.length).toBeGreaterThan(40);
  });

  it("publishes hello@ somewhere, because the law requires an address", () => {
    // Deleting it is the failure mode this guards: a tidy-up that removes the
    // last mailto: would put the site back out of step with regulation 6, and
    // silently, since nothing else would break.
    expect(
      addressesInSource().some((entry) =>
        entry.endsWith("hello@spruetube.app"),
      ),
    ).toBe(true);
  });

  it("names no personal address", () => {
    const offenders = addressesInSource().filter((entry) =>
      entry.includes("@loadeddice.uk"),
    );
    expect(offenders).toEqual([]);
  });

  it("does not resurrect safety@ or privacy@, which would bounce", () => {
    const offenders = addressesInSource().filter(
      (entry) =>
        entry.endsWith("safety@spruetube.app") ||
        entry.endsWith("privacy@spruetube.app"),
    );
    expect(offenders).toEqual([]);
  });

  it("names nothing else on either domain", () => {
    const offenders = addressesInSource().filter(
      (entry) => !ALLOWED.has(entry.slice(entry.lastIndexOf(" ") + 1)),
    );
    expect(offenders).toEqual([]);
  });
});
