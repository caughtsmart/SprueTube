import { defineConfig } from "vitest/config";

/*
 * These tests cover the pure logic only — ranking, text parsing, ids,
 * formatting, the age gate. Anything that touches D1 or Cloudflare bindings is
 * covered by exercising the real Worker against a local D1 instead; mocking a
 * database tells you your mock works, not your query.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
