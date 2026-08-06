import { createContext } from "react-router";

/**
 * How loaders and actions reach Cloudflare bindings.
 *
 * React Router v8 replaced the old plain-object `AppLoadContext` with typed
 * contexts, so the worker entry populates this one per request and route
 * modules read it back with `context.get(cloudflare)`.
 */
export const cloudflare = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();
