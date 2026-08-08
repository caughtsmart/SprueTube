/*
 * Sortable ids.
 *
 * Every id starts with a base36 millisecond timestamp, so `ORDER BY id` matches
 * creation order and keyset pagination works on the primary key alone — no
 * secondary index, no cursor table. A per-millisecond counter keeps ids unique
 * when several rows are created inside the same tick.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

let lastMs = 0;
let counter = 0;

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/**
 * @param prefix Short type marker, e.g. `p` for post. Makes ids readable in
 *   logs and makes it obvious when the wrong id is passed to a query.
 */
export function newId(prefix: string): string {
  const ms = Date.now();
  if (ms === lastMs) {
    counter += 1;
  } else {
    lastMs = ms;
    counter = 0;
  }
  const time = ms.toString(36).padStart(9, "0");
  const seq = counter.toString(36).padStart(2, "0");
  return `${prefix}_${time}${seq}${randomSuffix(8)}`;
}

/** Milliseconds encoded in an id, or null if it is not one of ours. */
export function idTimestamp(id: string): number | null {
  const body = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  if (body.length < 9) return null;
  const ms = parseInt(body.slice(0, 9), 36);
  return Number.isFinite(ms) ? ms : null;
}
