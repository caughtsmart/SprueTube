/*
 * Discover ranking.
 *
 * A Hacker News style decay: engagement in the numerator, age in the
 * denominator. A post with ten likes an hour old should sit above one with
 * forty likes from last week, otherwise the front page ossifies and new
 * painters never get seen — which is the failure mode that kills small
 * communities.
 *
 * Comments are worth more than likes because a comment is a conversation and a
 * like is a reflex. Views barely count; they are trivially inflated.
 */

const LIKE_WEIGHT = 1;
const COMMENT_WEIGHT = 3;
const VIEW_WEIGHT = 0.02;
/** Above 1 the curve is steeper than linear, so fresh posts win decisively. */
const GRAVITY = 1.5;
/** Hours added to the age so a brand-new post is not divided by ~zero. */
const AGE_OFFSET = 2;

export function hotScore(input: {
  likeCount: number;
  commentCount: number;
  viewCount: number;
  publishedAt: number | null;
  now?: number;
}): number {
  const nowSeconds = input.now ?? Math.floor(Date.now() / 1000);
  const published = input.publishedAt ?? nowSeconds;
  const ageHours = Math.max(0, (nowSeconds - published) / 3600);

  const engagement =
    input.likeCount * LIKE_WEIGHT +
    input.commentCount * COMMENT_WEIGHT +
    input.viewCount * VIEW_WEIGHT;

  // Every post starts at 1 rather than 0 so that an brand-new post with no
  // engagement still outranks an old post with none.
  return (engagement + 1) / Math.pow(ageHours + AGE_OFFSET, GRAVITY);
}

/**
 * How far back the scheduled refresh walks. Older posts have decayed far enough
 * that their exact score no longer changes the order of anything on Discover.
 *
 * The refresh runs in JavaScript rather than as one big SQL UPDATE on purpose:
 * `power()` is a compile-time optional SQLite function, and depending on it
 * would make the whole feed hostage to a build flag we do not control.
 */
export const REFRESH_WINDOW_SECONDS = 72 * 60 * 60;
