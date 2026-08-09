import { Hono } from "hono";
import type { ApiEnv } from "../context";

/*
 * Placeholder module, wired into server/api/index.ts already so that adding
 * routes here needs no change to the mounting.
 */
export const market = new Hono<ApiEnv>();
