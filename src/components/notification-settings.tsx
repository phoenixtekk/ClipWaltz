"use client";
import { useEffect, useState, useTransition } from "react";
import { Bell, MonitorSmartphone, AppWindow, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  notificationsSupported,
  pushSupported,
  permissionState,
  requestPermission,
  getInTabPref,
  setInTabPref,
  isPushSubscribed,
  enablePush,
  disablePush,
} from "@/lib/notify-client";

export function NotificationSettings({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [mounted, setMounted] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [inTab, setInTab] = useState(true);
  const [push, setPush] = useState(false);
  const [pending, start] = useTransition();
  const supported = mounted && notificationsSupported();
  const canPush = mounted && pushSupported() && Boolean(vapidPublicKey);

  useEffect(() => {
    // Browser-only reads, deferred off the effect body (avoids cascading-render lint
    // + hydration mismatch — the server render has no window/Notification).
    queueMicrotask(() => {
      setMounted(true);
      setPerm(permissionState());
      setInTab(getInTabPref());
    });
    isPushSubscribed().then(setPush);
  }, []);

  function toggleInTab() {
    start(async () => {
      const next = !inTab;
      if (next && perm !== "granted") {
        const p = await requestPermission();
        setPerm(p);
        if (p !== "granted") {
          toast.error("Notifications are blocked in your browser settings.");
          return;
        }
      }
      setInTabPref(next);
      setInTab(next);
      toast.success(next ? "In-tab notifications on." : "In-tab notifications off.");
    });
  }

  function togglePush() {
    start(async () => {
      try {
        if (!push) {
          await enablePush(vapidPublicKey);
          setPerm(permissionState());
          setPush(true);
          toast.success("You'll get a notification even when ClipWaltz is closed.");
        } else {
          await disablePush();
          setPush(false);
          toast.success("Background notifications off for this browser.");
        }
      } catch (e) {
        toast.error((e as Error).message || "Could not update push notifications.");
      }
    });
  }

  return (
    <div className="space-y-5">
      {mounted && !supported ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          This browser doesn&apos;t support notifications.
        </p>
      ) : null}

      {mounted && supported && perm === "denied" ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          Notifications are blocked for this site. Enable them in your browser&apos;s site
          settings, then come back.
        </p>
      ) : null}

      <ToggleRow
        icon={<AppWindow className="size-5" />}
        title="Browser notification (while ClipWaltz is open)"
        desc="Pop a notification the moment a render finishes and you're on the site."
        checked={inTab}
        disabled={!supported || pending}
        onToggle={toggleInTab}
      />

      <ToggleRow
        icon={<MonitorSmartphone className="size-5" />}
        title="Windows notification (even when ClipWaltz is closed)"
        desc="A desktop toast when your video is ready, even if the tab is closed. Applies to this browser on this device."
        checked={push}
        disabled={!canPush || pending}
        onToggle={togglePush}
        note={
          mounted && !canPush
            ? vapidPublicKey
              ? "This browser can't do background push."
              : "Background push isn't configured on the server yet."
            : undefined
        }
      />
    </div>
  );
}

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  disabled,
  onToggle,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  note?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        {note ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{note}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}

export function NotificationsHeader() {
  return (
    <div className="flex items-center gap-2">
      <Bell className="size-5 text-primary" />
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
    </div>
  );
}
