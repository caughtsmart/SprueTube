import { describe, expect, it } from "vitest";
import {
  earnsHelpfulBadge,
  HELPFUL_BADGE_THRESHOLD,
} from "../server/services/helpful";

/*
 * The badge is meant to be hard to earn and impossible to fake. The pure rule
 * is all that is testable here; the "other people only, one mark each" part is
 * enforced by the self-mark guard and the like table's primary key.
 */
describe("earnsHelpfulBadge", () => {
  it("is not earned below the threshold", () => {
    for (let n = 0; n < HELPFUL_BADGE_THRESHOLD; n++) {
      expect(earnsHelpfulBadge(n)).toBe(false);
    }
  });

  it("is earned once a single comment reaches the threshold", () => {
    expect(earnsHelpfulBadge(HELPFUL_BADGE_THRESHOLD)).toBe(true);
  });

  it("stays earned above the threshold", () => {
    expect(earnsHelpfulBadge(HELPFUL_BADGE_THRESHOLD + 5)).toBe(true);
  });

  it("keeps the bar at three distinct people", () => {
    // A guard on the number itself: dropping it to 1 would make a badge from a
    // single like, which is the thing this feature is explicitly not.
    expect(HELPFUL_BADGE_THRESHOLD).toBe(3);
    expect(earnsHelpfulBadge(2)).toBe(false);
  });
});
