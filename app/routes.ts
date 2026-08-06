import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // Auth
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("welcome", "routes/onboarding.tsx"),

  // Core app
  route("explore", "routes/explore.tsx"),
  route("compose", "routes/compose.tsx"),
  route("notifications", "routes/notifications.tsx"),
  route("saved", "routes/saved.tsx"),
  route("settings", "routes/settings.tsx"),
  route("posts/:postId", "routes/post.tsx"),
  route("tags/:tag", "routes/tag.tsx"),
  route("systems/:system", "routes/system.tsx"),

  // Profiles live at /@username. React Router only matches a whole segment as
  // a param, so the '@' is captured as part of the value and validated in the
  // loader. Declared last: every static route above wins the match first.
  route(":handle", "routes/profile.tsx"),

  // Moderation
  route("moderation", "routes/moderation.tsx"),

  // Static and legal. A UGC platform has to publish these before it launches,
  // not after — both the Online Safety Act and the App Store ask for them.
  route("about", "routes/about.tsx"),
  route("rules", "routes/rules.tsx"),
  route("safety", "routes/safety.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),

  // Crawler files
  route("robots.txt", "routes/robots.tsx"),
  route("sitemap.xml", "routes/sitemap.tsx"),
] satisfies RouteConfig;
