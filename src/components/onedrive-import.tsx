"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Cloud, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type OneDriveFile = { name?: string; "@microsoft.graph.downloadUrl"?: string };
type OneDriveSDK = {
  open(opts: {
    clientId: string;
    action: "download";
    multiSelect: boolean;
    openInNewWindow: boolean;
    advanced?: Record<string, unknown>;
    success: (r: { value?: OneDriveFile[] }) => void;
    cancel?: () => void;
    error?: (e: unknown) => void;
  }): void;
};
declare global {
  interface Window {
    OneDrive?: OneDriveSDK;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_MS_CLIENT_ID;

export function OneDriveImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return;
    if (window.OneDrive) {
      queueMicrotask(() => setReady(true));
      return;
    }
    let s = document.getElementById("onedrivejs") as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement("script");
      s.src = "https://js.live.net/v7.2/OneDrive.js";
      s.id = "onedrivejs";
      document.body.appendChild(s);
    }
    const onload = () => setReady(true);
    s.addEventListener("load", onload);
    return () => s?.removeEventListener("load", onload);
  }, []);

  function open() {
    if (!window.OneDrive) {
      toast.error("OneDrive isn't ready yet — try again in a moment.");
      return;
    }
    window.OneDrive.open({
      clientId: CLIENT_ID as string,
      action: "download",
      multiSelect: true,
      openInNewWindow: true,
      advanced: {
        redirectUri: `${window.location.origin}/api/oauth/microsoft/callback`,
        filter: "photo,video",
      },
      success: async (r) => {
        const files = (r.value ?? [])
          .map((f) => ({ url: f["@microsoft.graph.downloadUrl"] ?? "", name: f.name ?? "file" }))
          .filter((f) => f.url);
        if (!files.length) return;
        setBusy(true);
        try {
          const res = await fetch("/api/import/urls", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId, source: "onedrive", files }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error || "Import failed");
          toast.success(`Imported ${j.imported} item${j.imported === 1 ? "" : "s"} from OneDrive.`);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message || "OneDrive import failed.");
        } finally {
          setBusy(false);
        }
      },
      cancel: () => {},
      error: () => toast.error("OneDrive picker error."),
    });
  }

  if (!CLIENT_ID) return null;
  return (
    <Button variant="outline" onClick={open} disabled={busy || !ready}>
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" /> Importing…
        </>
      ) : (
        <>
          <Cloud className="size-4" /> Import from OneDrive
        </>
      )}
    </Button>
  );
}
