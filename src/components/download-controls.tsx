"use client";
import { useEffect, useState } from "react";
import { Download, FolderOpen, FolderCheck, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  supportsFolderPicker,
  getStoredFolder,
  chooseDownloadFolder,
  clearDownloadFolder,
  downloadRender,
} from "@/lib/download-folder";

/** Download button that honours the chosen download folder (see DownloadFolderChip). */
export function DownloadButton({ url, fallbackName }: { url: string; fallbackName: string }) {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      const where = await downloadRender(url, fallbackName);
      if (where === "folder") toast.success("Saved to your download folder.");
    } catch {
      toast.error("Download failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download
    </Button>
  );
}

/** Pick / show / clear the folder that downloads save into. Hidden on unsupported browsers. */
export function DownloadFolderChip() {
  const [state, setState] = useState<{ supported: boolean; folder: string | null }>({ supported: false, folder: null });

  useEffect(() => {
    let live = true;
    (async () => {
      const supported = supportsFolderPicker();
      const f = supported ? await getStoredFolder() : null;
      if (live) setState({ supported, folder: f?.name ?? null });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!state.supported) return null;

  async function choose() {
    try {
      const name = await chooseDownloadFolder();
      if (name) {
        setState((s) => ({ ...s, folder: name }));
        toast.success(`Downloads will save to "${name}".`);
      }
    } catch {
      /* user cancelled the picker */
    }
  }
  async function clear() {
    await clearDownloadFolder();
    setState((s) => ({ ...s, folder: null }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Download folder:</span>
      {state.folder ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-medium text-primary">
          <FolderCheck className="size-3.5" />
          {state.folder}
          <button type="button" onClick={choose} className="ml-0.5 underline-offset-2 hover:underline">
            change
          </button>
          <button type="button" onClick={clear} aria-label="Clear download folder" className="hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={choose}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <FolderOpen className="size-3.5" /> Choose folder…
        </button>
      )}
    </div>
  );
}
