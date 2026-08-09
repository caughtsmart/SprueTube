import { Link, NavLink, useLocation } from "react-router";
import { useRoot } from "../root";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";

/**
 * The frame every page sits in: a sidebar on desktop, a bottom bar on mobile.
 *
 * Mobile gets the bottom bar because this is a phone-first product — people
 * photograph a model at the desk and post it from the same spot — and because
 * it is the navigation the iOS app will use, so the web and the app should not
 * feel like different products.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { viewer } = useRoot();

  return (
    <div className="min-h-dvh">
      <TopBar />
      {/*
        The bottom padding clears the fixed mobile bar, so it is only owed when
        that bar is there. Signed out — which is every first visit — it was 96px
        of empty page under the fold.
      */}
      <div
        className={`mx-auto flex w-full max-w-6xl gap-6 px-4 md:px-6 md:pb-10 ${
          viewer ? "pb-24" : "pb-10"
        }`}
      >
        <SideNav />
        <main className="min-w-0 flex-1 py-5">{children}</main>
      </div>
      {viewer ? <MobileBar /> : null}
    </div>
  );
}

function TopBar() {
  const { viewer } = useRoot();

  return (
    <header className="sticky top-0 z-30 bg-[var(--surface-page)]/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 md:px-6">
        <Link to="/" className="flex items-center gap-2" aria-label="SprueTube home">
          <Logo className="h-7 w-7" />
          <span className="font-display st-text-strong hidden text-lg font-bold sm:block">
            Sprue<span className="text-[var(--color-primer-500)]">Tube</span>
          </span>
        </Link>

        <div className="flex-1" />

        {viewer ? (
          <div className="flex items-center gap-2">
            <Link to="/compose" className="st-btn st-btn-primary text-sm">
              Post
            </Link>
            <Link to={`/@${viewer.username}`} aria-label="Your profile">
              <Avatar
                username={viewer.username}
                src={viewer.avatarUrl}
                size={34}
              />
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" className="st-btn st-btn-ghost text-sm">
              Sign in
            </Link>
            <Link to="/signup" className="st-btn st-btn-primary text-sm">
              Join
            </Link>
          </div>
        )}
      </div>
      {/*
        The concept ends the top bar with tape, not a hairline. It is the first
        thing on every page and the reason the site reads as a workbench rather
        than a dashboard.
      */}
      <div aria-hidden className="st-hazard-thin" />
    </header>
  );
}

/*
 * Order is roughly "how often would someone want this", not feature importance.
 * News and the market are public: a visitor who has not signed up yet is
 * exactly who they are for, and hiding them behind auth would make the site
 * look emptier than it is.
 */
const NAV = [
  { to: "/", label: "Feed", icon: "▤", end: true },
  { to: "/explore", label: "Explore", icon: "◈" },
  { to: "/news", label: "News", icon: "◰" },
  { to: "/market", label: "Buy & sell", icon: "◫" },
  { to: "/commissions", label: "Commissions", icon: "✦" },
  { to: "/messages", label: "Messages", icon: "✉", auth: true },
  { to: "/notifications", label: "Notifications", icon: "◎", auth: true },
  { to: "/saved", label: "Saved", icon: "❏", auth: true },
  { to: "/settings", label: "Settings", icon: "⚙", auth: true },
];

function SideNav() {
  const { viewer } = useRoot();

  return (
    <nav className="hidden w-52 shrink-0 py-5 md:block">
      <div className="sticky top-20 flex flex-col gap-1">
        {NAV.filter((item) => !item.auth || viewer).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "st-raised st-text-strong"
                  : "st-text-muted hover:st-text-strong",
              ].join(" ")
            }
          >
            <span aria-hidden className="text-base">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}

        {viewer?.isModerator ? (
          <NavLink
            to="/moderation"
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "st-raised st-text-strong"
                  : "st-text-muted hover:st-text-strong",
              ].join(" ")
            }
          >
            <span aria-hidden className="text-base">
              ⚑
            </span>
            Moderation
          </NavLink>
        ) : null}

        <FooterLinks />
      </div>
    </nav>
  );
}

function FooterLinks() {
  const { shopName, shopUrl } = useRoot().config;

  return (
    <div className="st-text-muted mt-8 flex flex-col gap-2 px-3 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Link to="/about" className="hover:underline">
          About
        </Link>
        <Link to="/rules" className="hover:underline">
          Rules
        </Link>
        <Link to="/safety" className="hover:underline">
          Safety
        </Link>
        <Link to="/privacy" className="hover:underline">
          Privacy
        </Link>
        <Link to="/terms" className="hover:underline">
          Terms
        </Link>
        <Link to="/contact" className="hover:underline">
          Contact
        </Link>
      </div>
      {/*
        The only unpaid mention of the shop in the chrome. Keeping it to one
        quiet line is what makes SprueTube read as a community rather than as a
        storefront with a comments section.
      */}
      <a
        href={`${shopUrl}?utm_source=spruetube&utm_medium=nav`}
        rel="noopener"
        className="hover:underline"
      >
        Paint and kits at {shopName} ↗
      </a>
      <p className="mt-1 opacity-70">© {new Date().getFullYear()} SprueTube</p>
    </div>
  );
}

function MobileBar() {
  const { viewer } = useRoot();
  const location = useLocation();

  const items = [
    { to: "/", label: "Feed", icon: "▤" },
    { to: "/explore", label: "Explore", icon: "◈" },
    { to: "/compose", label: "Post", icon: "＋" },
    { to: "/notifications", label: "Alerts", icon: "◎" },
    { to: `/@${viewer?.username ?? ""}`, label: "You", icon: "◍" },
  ];

  return (
    <nav className="st-border fixed inset-x-0 bottom-0 z-30 border-t bg-[var(--surface-page)]/95 backdrop-blur md:hidden">
      <div className="flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active =
            item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.label}
              to={item.to}
              className={[
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
                active ? "st-text-strong" : "st-text-muted",
              ].join(" ")}
            >
              <span aria-hidden className="text-lg leading-none">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
