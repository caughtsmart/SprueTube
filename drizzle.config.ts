import { defineConfig } from "drizzle-kit";

/*
 * Only used to *generate* SQL into ./migrations. Applying them is wrangler's
 * job (`npm run db:migrate:local` / `:remote`), which is why there is no
 * dbCredentials block here.
 */
export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  casing: "snake_case",
});
