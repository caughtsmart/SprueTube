import { Link } from "react-router";
import { Logo } from "./Logo";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md py-8">
      <div className="mb-6 text-center">
        <Link to="/" className="inline-flex items-center gap-2">
          <Logo className="h-9 w-9" />
          <span className="font-display st-text-strong text-xl font-bold">
            Sprue<span className="text-[var(--color-primer-500)]">Tube</span>
          </span>
        </Link>
      </div>

      <div className="st-card p-6">
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle ? (
          <p className="st-text-muted mt-1 mb-5 text-sm">{subtitle}</p>
        ) : (
          <div className="mb-5" />
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Social sign-in.
 *
 * Apple is not decoration: once the iOS app offers Google sign-in, App Store
 * guideline 4.8 requires an equivalent private option, and Sign in with Apple
 * is the one everybody uses for it. Building the button now means the web and
 * the app share one account from day one.
 */
export function OAuthButtons({
  googleEnabled,
  appleEnabled,
  action,
}: {
  googleEnabled: boolean;
  appleEnabled: boolean;
  action: string;
}) {
  if (!googleEnabled && !appleEnabled) return null;

  return (
    <>
      <div className="space-y-2">
        {googleEnabled ? (
          <a
            href="/api/auth/sign-in/social?provider=google"
            className="st-btn st-btn-ghost w-full"
          >
            <span aria-hidden>G</span> {action} with Google
          </a>
        ) : null}
        {appleEnabled ? (
          <a
            href="/api/auth/sign-in/social?provider=apple"
            className="st-btn st-btn-ghost w-full"
          >
            <span aria-hidden></span> {action} with Apple
          </a>
        ) : null}
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="st-border h-px flex-1 border-t" />
        <span className="st-text-muted text-xs">or</span>
        <span className="st-border h-px flex-1 border-t" />
      </div>
    </>
  );
}
