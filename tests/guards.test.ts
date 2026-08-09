import { describe, expect, it } from "vitest";
import { interactionProblem } from "../server/services/moderation";

/*
 * The shared interaction guard — the pure half.
 *
 * `checkInteraction` loads the two facts this decides on and hands them over,
 * so every write path in the app ends up here. Kept in its own file so it does
 * not collide with whatever else is being written in tests/logic.test.ts.
 */

const facts = (over: Partial<Parameters<typeof interactionProblem>[0]> = {}) => ({
  viewerId: "u_viewer",
  subjectId: "u_subject",
  subjectStatus: "active",
  blocked: false,
  ...over,
});

describe("interactionProblem", () => {
  it("allows an ordinary interaction between two active strangers", () => {
    expect(interactionProblem(facts())).toBeNull();
  });

  it("refuses a blocked viewer", () => {
    expect(interactionProblem(facts({ blocked: true }))).toBe("blocked");
  });

  it("does not care which way round the block runs", () => {
    // The caller resolves both directions to one boolean, so being blocked and
    // having blocked are the same answer here. That is the point of the guard:
    // a block is mutual, and a write path must not have to remember that.
    expect(interactionProblem(facts({ blocked: true }))).toBe("blocked");
  });

  it("refuses a suspended account", () => {
    expect(interactionProblem(facts({ subjectStatus: "suspended" }))).toBe(
      "unavailable",
    );
  });

  it("refuses a deleted account", () => {
    expect(interactionProblem(facts({ subjectStatus: "deleted" }))).toBe(
      "unavailable",
    );
  });

  it("reports a suspended account as unavailable rather than blocked", () => {
    // Callers answer "blocked" with the 404 a missing row gets so the block is
    // not announced, and "unavailable" with a plain 403. Getting these the
    // wrong way round would tell a blocked person they had been blocked.
    expect(
      interactionProblem(facts({ subjectStatus: "suspended", blocked: true })),
    ).toBe("unavailable");
  });

  it("lets someone act on their own things whatever their status", () => {
    // A suspended person can still delete their own post, and a self-block
    // cannot exist. Without this the guard would lock people out of their own
    // work the moment they were suspended.
    expect(
      interactionProblem(
        facts({
          viewerId: "u_same",
          subjectId: "u_same",
          subjectStatus: "suspended",
          blocked: true,
        }),
      ),
    ).toBeNull();
  });

  it("treats an unrecognised status as unavailable", () => {
    // Fail closed: a status this code has not been taught about is not a
    // licence to write.
    expect(interactionProblem(facts({ subjectStatus: "shadowbanned" }))).toBe(
      "unavailable",
    );
  });
});
