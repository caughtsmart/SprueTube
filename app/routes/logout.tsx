import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { getEnv } from "../lib/data.server";
import { getAuth } from "../../server/auth";

/**
 * Sign-out is POST-only. A GET would let any page on the internet log a visitor
 * out with an <img> tag — harmless as attacks go, extremely annoying in practice.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);

  const response = await getAuth(env).handler(
    new Request(new URL("/api/auth/sign-out", env.SITE_URL), {
      method: "POST",
      headers: request.headers,
    }),
  );

  // Carry better-auth's cookie-clearing headers through to the redirect.
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  headers.set("location", "/");

  return new Response(null, { status: 302, headers });
}

export async function loader() {
  throw redirect("/");
}
