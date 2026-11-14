import { OfflineRetry } from "@/components/offline-retry";

export const metadata = { title: "You're offline" };
export const dynamic = "force-static";

// G16: the page the service worker (public/sw.js) shows when a page can't load because there is no connection.
// Static and public (src/proxy.ts) so it can be cached at install time.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- cached by the service worker */}
      <img src="/icons/icon-192.png" alt="" width={72} height={72} />
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="text-sm text-muted-foreground">
        ClipWaltz needs a connection to load this page. Your projects and posts are safe on our servers — try again when you&apos;re back online.
      </p>
      <OfflineRetry />
    </main>
  );
}
