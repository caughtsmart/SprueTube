import { describe, expect, it } from "vitest";
import { comingSoonGate, type ComingSoonEnv } from "../workers/comingSoon";

/*
 * The launch curtain — the pure request → Response half.
 *
 * comingSoonGate() is the whole feature: given a request and the env, it either
 * returns a holding page / a cookie-granting redirect, or `null` to let the app
 * serve the request. Everything below pins that behaviour so the curtain can't
 * silently start gating (or stop gating) the real site.
 */

const TOKEN = "let-me-in-1234";

function req(url: string, cookie?: string): Request {
  return new Request(url, cookie ? { headers: { Cookie: cookie } } : undefined);
}

function on(over: Partial<ComingSoonEnv> = {}): ComingSoonEnv {
  return { COMING_SOON: "true", COMING_SOON_BYPASS: TOKEN, ...over };
}

describe("comingSoonGate", () => {
  it("passes everything through when the curtain is off", () => {
    for (const value of [undefined, "", "false", "0", "off", "no"]) {
      const res = comingSoonGate(
        req("https://spruetube.app/"),
        { COMING_SOON: value, COMING_SOON_BYPASS: TOKEN },
      );
      expect(res, `COMING_SOON=${String(value)} should be off`).toBeNull();
    }
  });

  it("serves the holding page to the public when on", () => {
    const res = comingSoonGate(req("https://spruetube.app/"), on());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(res!.headers.get("Retry-After")).toBe("3600");
    expect(res!.headers.get("Cache-Control")).toBe("no-store");
  });

  it("gates the API as well as the pages", () => {
    // The whole point is that nobody sees the site — the shared API included.
    const res = comingSoonGate(req("https://spruetube.app/api/feed"), on());
    expect(res?.status).toBe(503);
  });

  it("hands out a preview cookie for a correct ?preview token and redirects clean", () => {
    const res = comingSoonGate(
      req(`https://spruetube.app/discover?preview=${TOKEN}`),
      on(),
    );
    expect(res!.status).toBe(302);
    // The token must not survive into the address bar or analytics.
    expect(res!.headers.get("Location")).toBe("/discover");
    const setCookie = res!.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("st_preview=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("lets a browser holding the cookie straight through to the real site", () => {
    const res = comingSoonGate(
      req("https://spruetube.app/", `st_preview=${TOKEN}`),
      on(),
    );
    expect(res).toBeNull();
  });

  it("keeps the curtain up for a wrong ?preview token and sets no cookie", () => {
    const res = comingSoonGate(
      req("https://spruetube.app/?preview=nope"),
      on(),
    );
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Set-Cookie")).toBeNull();
    // Following that redirect lands back on the holding page, not the site.
    const after = comingSoonGate(req("https://spruetube.app/"), on());
    expect(after?.status).toBe(503);
  });

  it("keeps the curtain up for a stale or forged cookie", () => {
    const res = comingSoonGate(
      req("https://spruetube.app/", "st_preview=old-token"),
      on(),
    );
    expect(res?.status).toBe(503);
  });

  it("clears the cookie on ?preview=out", () => {
    const res = comingSoonGate(req("https://spruetube.app/?preview=out"), on());
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("cannot be bypassed when no token is configured", () => {
    // Curtain on but no bypass secret: fail closed, nobody gets in — not even
    // with an empty ?preview= or a matching-looking empty cookie.
    const env = { COMING_SOON: "true" } as ComingSoonEnv;
    expect(comingSoonGate(req("https://spruetube.app/?preview="), env)!.status).toBe(302);
    expect(comingSoonGate(req("https://spruetube.app/"), env)?.status).toBe(503);
    expect(
      comingSoonGate(req("https://spruetube.app/", "st_preview="), env)?.status,
    ).toBe(503);
  });

  it("omits Secure on plain http so the cookie still works on localhost", () => {
    const res = comingSoonGate(
      req(`http://localhost:5173/?preview=${TOKEN}`),
      on(),
    );
    const setCookie = res!.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("st_preview=");
    expect(setCookie).not.toContain("Secure");
  });
});
