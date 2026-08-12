/*
 * SprueTube service worker.
 *
 * Deliberately tiny: its only job is Web Push. It shows the notification the
 * server sent, and it opens the right page when the notification is clicked.
 * There is no offline caching here — the site is server-rendered and a stale
 * cache of a social feed is worse than a network request.
 *
 * Served from /public as a static file so it sits at the origin root and can
 * therefore control the whole site. It is plain JavaScript on purpose: no build
 * step touches it, so what ships is exactly what is written here.
 */

// A new worker should take over straight away rather than waiting for every tab
// using the old one to close — there is no cached state to invalidate.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  // The payload is JSON built by server/services/push.ts. Guard the parse: a
  // push with no body, or a malformed one, should still surface something
  // rather than throwing and showing the browser's generic fallback.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: "SprueTube", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "SprueTube";
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.svg",
    badge: "/favicon.svg",
    // Carried through to the click handler so it knows where to go.
    data: { url: data.url || "/notifications" },
    // Collapse a burst from the same person into one notification rather than
    // stacking five likes into five buzzes.
    tag: data.url || undefined,
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";
  const targetUrl = new URL(target, self.location.origin).href;

  // Focus an existing SprueTube tab if one is open — a person rarely wants a
  // second copy of the site — and only open a new one when none is.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (new URL(client.url).origin === self.location.origin && "focus" in client) {
            return client.focus().then(() =>
              "navigate" in client ? client.navigate(targetUrl) : undefined,
            );
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
