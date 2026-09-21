"use client";
// Client helpers for render-complete notifications.
// Two independent, per-browser preferences:
//   1. In-tab  (localStorage "cw-notify-intab")  — fire a Notification while ClipWaltz is open.
//   2. OS push (a Web Push subscription on file)  — OS toast even when ClipWaltz is closed.

const INTAB_KEY = "cw-notify-intab";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permissionState(): NotificationPermission {
  if (!notificationsSupported()) return "denied";
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// ---- In-tab preference (per-browser) --------------------------------------
export function getInTabPref(): boolean {
  try {
    // Default ON once permission is granted; explicit "0" turns it off.
    return localStorage.getItem(INTAB_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setInTabPref(on: boolean): void {
  try {
    localStorage.setItem(INTAB_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — ignore */
  }
}

/** Fire a local notification for a finished render (used by the open tab). */
export function notifyRenderDone(title: string, body: string, url: string): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (!getInTabPref()) return;
  try {
    const n = new Notification(title, { body, icon: "/logo-2.png", tag: "clipwaltz-render" });
    n.onclick = () => {
      window.focus();
      window.location.href = url;
      n.close();
    };
  } catch {
    /* some browsers require the SW path — ignore */
  }
}

// ---- OS push (per-browser subscription) -----------------------------------
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Is this browser currently subscribed to OS push? (checked against the server) */
export async function isPushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return false;
    const res = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
      cache: "no-store",
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { subscribed?: boolean };
    return Boolean(j.subscribed);
  } catch {
    return false;
  }
}

/** Turn OS push ON for this browser: register SW, subscribe, persist server-side. */
export async function enablePush(vapidPublicKey: string): Promise<void> {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications.");
  const perm = await requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted.");
  if (!vapidPublicKey) throw new Error("Push isn't configured on the server.");

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) throw new Error("Could not save your subscription. Try again.");
}

/** Turn OS push OFF for this browser: remove server record + browser subscription. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}
