import { Hono } from "hono";
import {
  apiError,
  badRequest,
  fieldErrors,
  rateLimit,
  type ApiEnv,
} from "../context";
import { canSendEmail, feedbackEmail, sendEmail } from "../../services/email";
import { createFeedback } from "../../services/feedback";
import { feedbackSchema } from "../validators";
import { FEEDBACK_KIND_LABELS } from "../../../app/lib/taxonomy";

export const feedback = new Hono<ApiEnv>();

/** The same shared inbox the contact form uses; a config edit, not a code one. */
function readRecipients(env: Env): string[] {
  return (env.CONTACT_RECIPIENTS ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * Bug reports and feature requests.
 *
 * Open to anyone: a person who has hit a bug that stops them signing in is
 * exactly who needs to report it. So, like the contact form, it is rate limited
 * by IP and honeypotted.
 *
 * Unlike the contact form it keeps a copy — the row is written first and is the
 * durable record, then the email is attempted as a nudge. A failed send is
 * logged but does not fail the request: the feedback is already safe in D1, and
 * losing the notification is a smaller problem than telling a painter their bug
 * report bounced when it did not.
 */
feedback.post("/feedback", async (c) => {
  await rateLimit(c, "feedback", { max: 10, windowSeconds: 3600 });

  const parsed = feedbackSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Have another look at the form.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const input = parsed.data;

  // A filled honeypot is a bot. Answer as though it worked and store nothing.
  if (input.website && input.website.trim().length > 0) {
    return c.json({ ok: true });
  }

  const user = c.get("user");
  const profile = c.get("profile");
  const db = c.get("db");

  let stored: { id: string };
  try {
    stored = await createFeedback(db, {
      userId: user?.id ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      pageUrl: input.pageUrl ?? null,
      contactEmail: input.email ?? null,
    });
  } catch (error) {
    console.error(
      "feedback: store failed",
      error instanceof Error ? error.message : error,
    );
    throw apiError(
      500,
      "feedback_failed",
      "That did not save. Try again in a minute, or email hello@spruetube.app.",
    );
  }

  // The email is a best-effort nudge; the row above is the record.
  const to = readRecipients(c.env);
  if (to.length && canSendEmail(c.env)) {
    c.executionCtx?.waitUntil(
      sendEmail(
        c.env,
        feedbackEmail({
          to,
          kind: input.kind,
          title: input.title,
          body: input.body,
          pageUrl: input.pageUrl ?? null,
          email: input.email ?? null,
          username: profile?.username ?? null,
        }),
      ).catch((error) =>
        console.error(
          "feedback: notify failed for %s (%s)",
          stored.id,
          FEEDBACK_KIND_LABELS[input.kind],
          error instanceof Error ? error.message : error,
        ),
      ),
    );
  } else {
    console.warn("feedback: stored %s but no email configured", stored.id);
  }

  return c.json({ ok: true });
});
