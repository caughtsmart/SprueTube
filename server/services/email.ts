/*
 * Transactional email.
 *
 * Cloudflare Email Sending, through the `EMAIL` binding declared in
 * wrangler.jsonc. The binding is the credential — there is no API key to mint,
 * store, rotate or leak, which removes the single most awkward step in setting
 * this up and the most likely thing to be sitting in a git history somewhere.
 *
 * The sending domain is onboarded once with `wrangler email sending enable
 * spruetube.app`, which writes the SPF and DKIM records into Cloudflare DNS
 * directly. Nothing to copy between two dashboards and nothing to get wrong.
 *
 * Three messages exist: two account links the recipient has to click, and the
 * contact form, which goes the other way — from a visitor to the people who run
 * the place. Marketing mail, digests and notification email are a different
 * problem with different rules — consent records, unsubscribe headers, send
 * reputation — and do not belong in this file when they arrive. Cloudflare say
 * the same: Email Sending is for transactional mail only.
 */

export class EmailError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

export type Message = {
  /** One address, or several for a shared inbox. */
  to: string | string[];
  /**
   * Where a reply should go.
   *
   * The `from` address cannot be the person writing — Email Sending only
   * accepts a sender on an onboarded domain, and forging one would fail SPF
   * anyway. So contact mail arrives from noreply@ and replying goes to them,
   * which is the behaviour a person expects when they hit reply.
   */
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

/** Readable in a log line whether `to` is one address or several. */
function recipients(message: Message): string {
  return Array.isArray(message.to) ? message.to.join(", ") : message.to;
}

/**
 * True when the mailer can actually send.
 *
 * Guards against the binding having been dropped from wrangler.jsonc rather
 * than against a missing key — there is no key. If this is false the Worker was
 * deployed with a broken config, which is worth a loud log line.
 */
export function canSendEmail(env: Env): boolean {
  return Boolean(env.EMAIL);
}

/**
 * Send one message. Throws on failure.
 *
 * The binding throws plain `Error` objects carrying a string `code`, so the
 * useful part is pulled out and rethrown as something typed. Callers reached
 * from an auth endpoint should use `deliver` instead — see the note there.
 */
export async function sendEmail(env: Env, message: Message): Promise<void> {
  if (!canSendEmail(env)) {
    throw new EmailError("the EMAIL binding is missing from wrangler.jsonc");
  }

  try {
    await env.EMAIL.send({
      to: message.to,
      from: { email: env.EMAIL_FROM, name: env.SITE_NAME },
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : undefined;
    throw new EmailError(
      error instanceof Error ? error.message : "email send failed",
      code,
    );
  }
}

/**
 * Turn each error code into something a person can act on.
 *
 * A bare "E_SENDER_NOT_VERIFIED" in the logs at 11pm is a puzzle; the fix
 * belongs next to the symptom.
 */
function explain(code: string | undefined): string {
  switch (code) {
    case "E_SENDER_NOT_VERIFIED":
    case "E_SENDER_DOMAIN_NOT_AVAILABLE":
      return "the sending domain is not onboarded — run `wrangler email sending enable spruetube.app`";
    case "E_DAILY_LIMIT_EXCEEDED":
      return "the daily sending quota is used up";
    case "E_RATE_LIMIT_EXCEEDED":
      return "rate limited by Email Sending";
    case "E_CONTENT_TOO_LARGE":
      return "the message is over the size limit";
    default:
      return code ?? "no error code";
  }
}

/**
 * Send, and turn a failure into a log line instead of an exception.
 *
 * better-auth runs these hooks in the background of a request whose response is
 * deliberately uninformative — "if this email exists, check your inbox" — so a
 * throw here cannot reach the user, and letting it escape risks an unhandled
 * rejection taking down the isolate mid-request. Logging keeps the failure
 * visible in Workers observability, which is on.
 *
 * `wrangler dev` simulates the binding and writes each message to a file rather
 * than sending it, so local development needs no configuration at all. The link
 * is logged as well, because reading it out of the console beats digging the
 * file out of a temp directory.
 */
export async function deliver(
  env: Env,
  message: Message,
  link: string,
): Promise<void> {
  if (env.ENVIRONMENT !== "production") {
    console.info(`email: "${message.subject}" to ${recipients(message)}`);
    console.info(`email: link is ${link}`);
  }

  if (!canSendEmail(env)) {
    console.error(
      `email: no EMAIL binding, dropped "${message.subject}" to ${recipients(message)}`,
    );
    return;
  }

  try {
    await sendEmail(env, message);
  } catch (error) {
    const code = error instanceof EmailError ? error.code : undefined;
    console.error(
      `email: failed to send "${message.subject}" to ${recipients(message)} — ${explain(code)}`,
      error instanceof Error ? error.message : error,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Escape for interpolation into the HTML body.
 *
 * A display name is user-controlled and arrives here unfiltered. Most mail
 * clients strip scripts, but they render markup, and "Dear <b>everyone</b>" is
 * the polite end of what someone would do with the gap.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
 * Inline styles and no stylesheet, because Gmail strips <style> blocks and
 * Outlook renders with Word's engine. Nothing here relies on flexbox, custom
 * properties, or a web font — the layout has to survive being ignored.
 */
function layout(options: {
  heading: string;
  /** Already escaped, and may carry markup — see the contact template. */
  body: string;
  /** Absent on mail that asks the reader to do nothing but read it. */
  button?: { label: string; url: string };
  footer: string;
}): string {
  const button = options.button
    ? `<a href="${options.button.url}" style="display:inline-block;background:#ff7a2f;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${options.button.label}</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#78716c;">
      If the button does not work, paste this into your browser:<br>
      <span style="word-break:break-all;color:#57534e;">${options.button.url}</span>
    </p>`
    : "";

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">
      Sprue<span style="color:#ff7a2f;">Tube</span>
    </p>
    <h1 style="margin:0 0 12px;font-size:18px;font-weight:700;">${options.heading}</h1>
    <div style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">${options.body}</div>
    ${button}
    <hr style="border:none;border-top:1px solid #e7e5e4;margin:24px 0;">
    <p style="margin:0;font-size:13px;line-height:1.6;color:#78716c;">${options.footer}</p>
  </div>
</body>
</html>`;
}

export function resetPasswordEmail(options: {
  to: string;
  name: string;
  url: string;
}): Message {
  const name = escapeHtml(options.name);
  return {
    to: options.to,
    subject: "Reset your SprueTube password",
    html: layout({
      heading: `Hello ${name}`,
      body: "Someone asked to reset the password on your SprueTube account. Use the button below within the next hour.",
      button: { label: "Choose a new password", url: options.url },
      footer:
        "If this was not you, ignore this email — your password stays as it is, and the link expires on its own.",
    }),
    text: [
      `Hello ${options.name}`,
      "",
      "Someone asked to reset the password on your SprueTube account.",
      "Open this link within the next hour to choose a new one:",
      "",
      options.url,
      "",
      "If this was not you, ignore this email. Your password stays as it is,",
      "and the link expires on its own.",
    ].join("\n"),
  };
}

export function verifyEmail(options: {
  to: string;
  name: string;
  url: string;
}): Message {
  const name = escapeHtml(options.name);
  return {
    to: options.to,
    subject: "Confirm your email for SprueTube",
    html: layout({
      heading: `Welcome, ${name}`,
      body: "Confirm this address so we can reach you about your account — and so you can get back in if you ever forget your password.",
      button: { label: "Confirm my email", url: options.url },
      footer:
        "If you did not sign up for SprueTube, ignore this email and the account will go no further.",
    }),
    text: [
      `Welcome, ${options.name}`,
      "",
      "Confirm this address so we can reach you about your account — and so",
      "you can get back in if you ever forget your password:",
      "",
      options.url,
      "",
      "If you did not sign up for SprueTube, ignore this email.",
    ].join("\n"),
  };
}

/**
 * The contact form, arriving in the Loaded Dice inbox.
 *
 * Everything here except the topic is typed by a stranger, so every field goes
 * through `escapeHtml` — including the address, which is validated as an email
 * but is still a string somebody chose. The subject line carries the topic and
 * the sender's name so the inbox is sortable at a glance, and `replyTo` is set
 * to the writer so hitting reply does the obvious thing.
 */
export function contactEmail(options: {
  to: string[];
  topic: string;
  name: string;
  email: string;
  message: string;
  /** Set when the sender was signed in — worth knowing before replying. */
  username: string | null;
  /**
   * Safety and data rights, which are the two that carry a clock.
   *
   * A marker in the subject line rather than a header, because a header is
   * only visible to a mail client that was configured to look for it, and the
   * subject is visible in every inbox on every device without any setup.
   */
  urgent?: boolean;
}): Message {
  const name = escapeHtml(options.name);
  const from = escapeHtml(options.email);
  const account = options.username
    ? `<a href="https://spruetube.app/@${escapeHtml(options.username)}">@${escapeHtml(options.username)}</a>`
    : "not signed in";

  return {
    to: options.to,
    replyTo: options.email,
    subject: options.urgent
      ? `SprueTube [priority] — ${options.topic} — ${options.name}`
      : `SprueTube — ${options.topic} — ${options.name}`,
    html: layout({
      heading: `${options.topic} from ${name}`,
      body: [
        `<p style="margin:0 0 16px;"><strong>From:</strong> ${name} &lt;${from}&gt;<br>`,
        `<strong>Account:</strong> ${account}</p>`,
        `<p style="margin:0;white-space:pre-wrap;">${escapeHtml(options.message)}</p>`,
      ].join("\n"),
      footer:
        "Sent from the contact form on spruetube.app. Reply to this email and it goes straight back to them.",
    }),
    text: [
      `${options.topic} from ${options.name}`,
      "",
      `From: ${options.name} <${options.email}>`,
      `Account: ${options.username ? `@${options.username}` : "not signed in"}`,
      "",
      options.message,
      "",
      "—",
      "Sent from the contact form on spruetube.app.",
      "Reply to this email and it goes straight back to them.",
    ].join("\n"),
  };
}
