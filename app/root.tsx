import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { AppShell } from "./components/AppShell";
import {
  getScope,
  publicConfig,
  viewerPayload,
  type PublicConfig,
  type ViewerPayload,
} from "./lib/data.server";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://imagedelivery.net" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export async function loader({ context, request }: Route.LoaderArgs) {
  const scope = await getScope(context, request);
  return {
    viewer: viewerPayload(scope),
    config: publicConfig(scope.env),
  };
}

export type RootData = { viewer: ViewerPayload; config: PublicConfig };

/** Root data from anywhere in the tree, without prop drilling. */
export function useRoot(): RootData {
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    data ?? {
      viewer: null,
      config: {
        siteName: "SprueTube",
        siteUrl: "https://spruetube.app",
        shopName: "Loaded Dice",
        shopUrl: "https://www.loadeddice.uk",
        imagesAccountHash: "",
        vapidPublicKey: null,
      },
    }
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Loaded Dice charcoal — matches --surface-page. */}
        <meta name="theme-color" content="#333333" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "That is our fault, not yours. Try again in a moment.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Nothing here";
      detail =
        "This page has been stripped, primed and lost. Check the link, or head back to the feed.";
    } else {
      title = `${error.status}`;
      detail = error.statusText || detail;
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <div aria-hidden className="st-hazard mx-auto h-2.5 w-40 rounded-sm" />
        <h1 className="mt-6 text-2xl font-bold">{title}</h1>
        <p className="st-text-muted st-body mt-3 text-sm">{detail}</p>
        <a href="/" className="st-btn st-btn-primary mt-8">
          Back to the feed
        </a>
        {import.meta.env.DEV && error instanceof Error ? (
          <pre className="st-card st-text-muted mt-8 overflow-x-auto p-4 text-left text-xs">
            {error.stack}
          </pre>
        ) : null}
      </div>
    </AppShell>
  );
}
