import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(binding: D1Database) {
  return drizzle(binding, { schema, casing: "snake_case" });
}

export { schema };
