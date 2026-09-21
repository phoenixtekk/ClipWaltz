/* ClipWaltz service worker — Web Push for render-complete notifications.
   Registered by src/lib/notify-client.ts at scope "/". Kept intentionally tiny:
   it only handles push delivery + notification clicks. No offline/caching. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
      if (focused) return;

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
