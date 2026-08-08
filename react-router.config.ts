import type { Config } from "@react-router/dev/config";

export default {
  // Server-side render. Public post and profile pages need to be crawlable —
  // organic search and Google Discover are the cheapest growth we get, and
  // AdSense will not approve a site that serves an empty shell to crawlers.
  ssr: true,
} satisfies Config;
