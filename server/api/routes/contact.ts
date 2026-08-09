import { Hono } from "hono";
import {
  apiError,
  badRequest,
  fieldErrors,
  rateLimit,
  type ApiEnv,
} from "../context";
import { canSendEmail, contactEmail, sendEmail } from "../../services/email";
import { contactSchema } from "../validators";
import { CONTACT_TOPIC_LABELS } from "../../../app/lib/taxonomy";

export const contact = new Hono<ApiEnv>();

/**
 * Where the addresses come from.
 *
 * A var rather than a constant, so changing who reads the inbox is a config
 * edit and a deploy rather than a code change — and so a staging deploy can
 * point somewhere harmless. Comma-separated because wrangler vars are strings.
 */
function readRecipients(env: Env): string[] {
  return (env.CONTACT_RECIPIENTS ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * The contact form.
 *
 * Open to anyone — a person who cannot sign in is exactly the person most
 * likely to need this. That makes it the one unauthenticated endpoint that
 * sends email, so it is rate limited by IP, honeypotted, and capped well below
 * anything that would matter to the sending quota.
 *
 * Unlike the auth mail, a failure here is reported. `deliver` swallows errors
 * because better-auth's response cannot say anything either way; this response
 * can, and a contact form that quietly bins the message is worse than no
 * contact form at all — the page offers a mailto as the fallback.
 */
contact.post("/contact", async (c) => {
  await rateLimit(c, "contact", { max: 5, windowSeconds: 3600 });

  const parsed = contactSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    throw badRequest("Have another look at the form.", {
      fields: fieldErrors(parsed.error.issues),
    });
  }

  const input = parsed.data;

  // A filled honeypot is a bot. Answer as though it worked and send nothing.
  if (input.website && input.website.trim().length > 0) {
    return c.json({ ok: true });
  }

  const to = readRecipients(c.env);
  if (!to.length || !canSendEmail(c.env)) {
    console.error(
      "contact: cannot send — %s",
      to.length ? "no EMAIL binding" : "CONTACT_RECIPIENTS is empty",
    );
    throw apiError(
      503,
      "email_unavailable",
      "Our contact form is not working right now. Email us directly and we will pick it up.",
    );
  }

  /*
   * The sender's own account, when they have one.
   *
   * Taken from the session rather than from anything they typed, so it is a
   * fact about who is asking rather than a claim. Someone writing in about a
   * suspended account can say they are @whoever; only this line proves it.
   */
  const profile = c.get("profile");

  try {
    await sendEmail(
      c.env,
      contactEmail({
        to,
        topic: CONTACT_TOPIC_LABELS[input.topic],
        name: input.name,
        email: input.email,
        message: input.message,
        username: profile?.username ?? null,
      }),
    );
  } catch (error) {
    console.error(
      "contact: send failed",
      error instanceof Error ? error.message : error,
    );
    throw apiError(
      502,
      "email_failed",
      "That did not send. Try again in a minute, or email us directly.",
    );
  }

  return c.json({ ok: true });
});
