/*
 * Transactional email.
 *
 * Resend, over its HTTP API rather than SMTP — Workers cannot open a raw TCP
 * socket to port 587, so every SMTP library is out. A plain `fetch` is all this
 * needs, which also means no dependency to keep current.
 *
 * Only two messages exist, and both are a link the recipient has to click.
 * Marketing mail, digests and notification email are a different problem with
 * different rules (unsubscribe headers, consent records, send reputation) and
 * do not belong in this file when they arrive.
 */

const API_URL = "https://api.resend.com/emails";

export class EmailError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

export type Message = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * True when the mailer can actually send.
 *
 * The key is a secret, so it is empty on a fresh deploy until someone runs
 * `wrangler secret put RESEND_API_KEY`. Everything else on the site works
 * without it, so this is checked rather than assumed.
 */
export function canSendEmail(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/**
 * Send one message.
 *
 * Throws on failure. Callers reached from an auth endpoint should catch —
 * see the note on `deliver` below for why.
 */
export async function sendEmail(env: Env, message: Message): Promise<void> {
  if (!canSendEmail(env)) {
    throw new EmailError("RESEND_API_KEY is not set");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    // Resend returns { name, message } on error. Read it as text so a proxy
    // error page — which is not JSON — does not throw inside the error path.
    const detail = await response.text().catch(() => "");
    throw new EmailError(`Resend returned ${response.status}`, detail);
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
 * Outside production the link is printed instead, so local development and
 * preview deploys have a working reset flow with no API key at all.
 */
export async function deliver(
  env: Env,
  message: Message,
  link: string,
): Promise<void> {
  if (!canSendEmail(env)) {
    if (env.ENVIRONMENT === "production") {
      console.error(
        `email: RESEND_API_KEY unset, dropped "${message.subject}" to ${message.to}`,
      );
    } else {
      console.info(`email: would send "${message.subject}" to ${message.to}`);
      console.info(`email: link is ${link}`);
    }
    return;
  }

  try {
    await sendEmail(env, message);
  } catch (error) {
    console.error(
      `email: failed to send "${message.subject}" to ${message.to}`,
      error instanceof EmailError ? error.detail : error,
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
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">
      Sprue<span style="color:#ff7a2f;">Tube</span>
    </p>
    <h1 style="margin:0 0 12px;font-size:18px;font-weight:700;">${options.heading}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">${options.body}</p>
    <a href="${options.buttonUrl}" style="display:inline-block;background:#ff7a2f;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${options.buttonLabel}</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#78716c;">
      If the button does not work, paste this into your browser:<br>
      <span style="word-break:break-all;color:#57534e;">${options.buttonUrl}</span>
    </p>
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
      buttonLabel: "Choose a new password",
      buttonUrl: options.url,
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
      buttonLabel: "Confirm my email",
      buttonUrl: options.url,
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
