/*
 * The "Helpful" badge — recognition for being useful in the comments.
 *
 * Deliberately hard to earn and impossible to fake. A comment is marked helpful
 * by *other* people (you cannot mark your own), and the badge is only awarded
 * once a single comment clears the threshold below — three distinct people
 * finding one comment useful, not three scattered marks across mediocre ones.
 * Once earned it is kept: this is a reward, not a streak.
 *
 * The rule lives here, pure and tested, so the number is never a mystery and so
 * the one place that awards the badge and any future backfill agree on it.
 */

export const HELPFUL_BADGE_THRESHOLD = 3;

/**
 * Whether a comment that has just reached `newHelpfulCount` marks earns its
 * author the badge. `newHelpfulCount` is the count *after* the mark that
 * triggered the check.
 */
export function earnsHelpfulBadge(newHelpfulCount: number): boolean {
  return newHelpfulCount >= HELPFUL_BADGE_THRESHOLD;
}
