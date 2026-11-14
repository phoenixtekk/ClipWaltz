/* ClipWaltz service worker — Web Push + PWA offline fallback.
   Registered at scope "/" by src/components/pwa-register.tsx (every page) and src/lib/notify-client.ts (push opt-in);
   it is one worker, so registering it twice is harmless and push subscriptions are kept.
   Push: delivery + notification clicks (unchanged). PWA (G16): caches ONLY the offline page and its icon at install, and
   serves that page when a page navigation fails because there is no network. Nothing else is cached or intercepted —
   API calls, media, uploads and assets always go straight to the network. */

const OFFLINE_CACHE = "cw-offline-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(OFFLINE_CACHE);
        await cache.addAll([new Request(OFFLINE_URL, { cache: "reload" }), "/icons/icon-192.png"]);
      } catch {
        /* offline page could not be cached now — push still works; the next install retries */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("cw-offline-") && key !== OFFLINE_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname === "/icons/icon-192.png") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }
  if (req.mode !== "navigate") return; // everything but page loads goes straight to the network
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        return (await caches.match(OFFLINE_URL)) || new Response("You are offline.", { status: 503, headers: { "content-type": "text/plain" } });
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "ClipWaltz";
  const body = data.body || "Your video is ready.";
  const url = data.url || "/projects";
  const tag = data.tag || "clipwaltz-render";

  event.waitUntil(
    (async () => {
      // If a ClipWaltz tab is focused, let the in-tab notification handle it so we
      // don't double-notify. When you're away (no focused tab), show the OS toast.
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const focused = wins.some((w) => w.focused);
      if (focused && !data.force) return;

      await self.registration.showNotification(title, {
        body,
        tag,
        icon: "/logo-2.png",
        badge: "/logo-2.png",
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/projects";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        // Focus an existing ClipWaltz tab if one is open.
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w && w.url !== url) {
            try {
              await w.navigate(url);
            } catch {
              /* cross-origin/navigation blocked — ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
