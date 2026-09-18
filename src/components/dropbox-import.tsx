"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Cloud, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type DropboxFile = { link: string; name: string };
type DropboxSDK = {
  choose(opts: {
    linkType: "direct" | "preview";
    multiselect: boolean;
    extensions?: string[];
    success: (files: DropboxFile[]) => void;
    cancel?: () => void;
  }): void;
};
declare global {
  interface Window {
    Dropbox?: DropboxSDK;
  }
}

const APP_KEY = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY;

export function DropboxImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!APP_KEY) return;
    if (window.Dropbox) {
      queueMicrotask(() => setReady(true));
      return;
    }
    let s = document.getElementById("dropboxjs") as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement("script");
      s.src = "https://www.dropbox.com/static/api/2/dropins.js";
      s.id = "dropboxjs";
      s.setAttribute("data-app-key", APP_KEY);
      document.body.appendChild(s);
    }
    const onload = () => setReady(true);
    s.addEventListener("load", onload);
    return () => s?.removeEventListener("load", onload);
  }, []);

  function choose() {
    if (!window.Dropbox) {
      toast.error("Dropbox isn't ready yet — try again in a moment.");
      return;
    }
    window.Dropbox.choose({
      linkType: "direct",
      multiselect: true,
      extensions: ["images", "video"],
      success: async (files) => {
        setBusy(true);
        try {
          const res = await fetch("/api/import/urls", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              source: "dropbox",
              files: files.map((f) => ({ url: f.link, name: f.name })),
            }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error || "Import failed");
          toast.success(`Imported ${j.imported} item${j.imported === 1 ? "" : "s"} from Dropbox.`);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message || "Dropbox import failed.");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (!APP_KEY) return null;
  return (
    <Button variant="outline" onClick={choose} disabled={busy || !ready}>
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" /> Importing…
        </>
      ) : (
        <>
          <Cloud className="size-4" /> Import from Dropbox
        </>
      )}
    </Button>
  );
}
