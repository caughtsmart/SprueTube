/*
 * Browser-side Web Push.
 *
 * Registers the service worker, walks the person through the permission prompt,
 * and hands the resulting subscription to our API. The heavy lifting — signing,
 * encrypting, sending — is the server's; this file only ever deals in the
 * browser's own PushManager.
 */

import { api } from "./api";

/** Where the service worker lives. Root scope, so it controls the whole site. */
const SERVICE_WORKER_URL = "/sw.js";

/**
 * True when this browser can do Web Push at all. Older Safari and most in-app
 * browsers cannot, so the UI has to ask before offering the toggle.
 */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The browser's current permission, or "unsupported" when there is no API. */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * True on an iPhone/iPad that is *not* running as an installed web app.
 *
 * iOS is the one platform where "unsupported" is really "not yet": Safari only
 * exposes the Push API to a site added to the Home Screen and opened from that
 * icon. So when push looks unsupported here, the right message is not "your
 * browser can't" but "add it to your Home Screen first" — this tells the two
 * apart. iPadOS reports itself as a Mac, hence the touch-points check.
 */
export function iosNeedsInstall(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  const isIos =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;

  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register(SERVICE_WORKER_URL);
}

/**
 * Turn push on for this browser.
 *
 * Registers the worker, asks for permission (a no-op if already granted), then
 * subscribes and stores the subscription server-side. Returns false when the
 * person declines the prompt — the caller reflects that rather than treating it
 * as an error. Throws only when something actually breaks.
 */
export async function enablePush(vapidPublicKey: string): Promise<boolean> {
  if (!pushSupported()) throw new Error("Push is not supported here.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await registration();
  await navigator.serviceWorker.ready;

  // Reuse an existing subscription when the browser already has one — resubscribing
  // with the same key returns it unchanged, and re-registering it with us is a
  // harmless upsert that also repairs a subscription the server had dropped.
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  await api.post("/push/subscribe", serialise(subscription));
  return true;
}

/** Turn push off for this browser: drop it here and forget it server-side. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;

  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;

  // Tell the server first. If the local unsubscribe fails we have still stopped
  // the sends, which is the part that matters.
  await api
    .post("/push/unsubscribe", { endpoint: subscription.endpoint })
    .catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

/** Is this exact browser currently subscribed? Drives the toggle's state. */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  return Boolean(subscription);
}

/*
 * A PushSubscription's toJSON gives exactly the shape our API expects
 * ({ endpoint, keys: { p256dh, auth } }), but its type is loose — pull the
 * pieces out explicitly so a browser that ever omits a key fails here, with a
 * clear message, rather than sending half a subscription.
 */
function serialise(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("This browser returned an incomplete push subscription.");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

/*
 * applicationServerKey wants raw bytes, but the key travels as base64url. Pad
 * it back to standard base64 and decode. Written out rather than pulled from a
 * library because it is eight lines and a dependency for eight lines is a poor
 * trade.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
