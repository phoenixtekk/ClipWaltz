"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, Film, Image as ImageIcon, Check, X, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { AssetSummary } from "@/lib/assets";

type Item = {
  localId: string;
  name: string;
  kind: "photo" | "video";
  progress: number;
  status: "uploading" | "done" | "error";
};

type Tab = "drop" | "pick" | "phone";

export function ImportUploader({
  projectId,
  initial,
}: {
  projectId: string;
  initial: AssetSummary[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("drop");
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const uploadedCount = initial.length + items.filter((i) => i.status === "done").length;
  const anyUploading = items.some((i) => i.status === "uploading");

  function uploadOne(file: File, localId: string) {
    const type = file.type || "application/octet-stream";
    const q = new URLSearchParams({ name: file.name, type });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/assets?${q.toString()}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setItems((prev) => prev.map((i) => (i.localId === localId ? { ...i, progress: pct } : i)));
      }
    };
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      setItems((prev) =>
        prev.map((i) =>
          i.localId === localId
            ? { ...i, status: ok ? "done" : "error", progress: ok ? 100 : i.progress }
            : i,
        ),
      );
      if (!ok) toast.error(`Upload failed: ${file.name}`);
      else router.refresh();
    };
    xhr.onerror = () => {
      setItems((prev) => prev.map((i) => (i.localId === localId ? { ...i, status: "error" } : i)));
      toast.error(`Upload failed: ${file.name}`);
    };
    xhr.send(file);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const accepted = Array.from(list).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    );
    const skipped = list.length - accepted.length;
    if (skipped > 0) toast.message(`Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"}`);
    for (const file of accepted) {
      const localId = crypto.randomUUID();
      const kind: Item["kind"] = file.type.startsWith("video/") ? "video" : "photo";
      setItems((prev) => [...prev, { localId, name: file.name, kind, progress: 0, status: "uploading" }]);
      uploadOne(file, localId);
    }
  }

  return (
    <div className="space-y-5">
      {/* tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {(
          [
            ["drop", "Drag & drop"],
            ["pick", "Choose files / folder"],
            ["phone", "Connect your phone"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* hidden inputs (shared) */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        // folder selection (Chromium/Safari); non-standard attributes
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* tab: drop */}
      {tab === "drop" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
          )}
        >
          <UploadCloud className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Drag photos &amp; videos here</p>
          <p className="text-xs text-muted-foreground">or click to choose files · images and video</p>
        </div>
      ) : null}

      {/* tab: pick */}
      {tab === "pick" ? (
        <div className="flex flex-wrap gap-3 rounded-xl border border-border p-6">
          <Button onClick={() => fileInput.current?.click()}>Choose files</Button>
          <Button variant="outline" onClick={() => folderInput.current?.click()}>
            Choose a folder
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            Pick individual photos/videos, or a whole folder at once.
          </p>
        </div>
      ) : null}

      {/* tab: phone (OS-assisted, honest) */}
      {tab === "phone" ? (
        <div className="space-y-4 rounded-xl border border-border p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Smartphone className="size-4 text-primary" /> Connect your phone by USB
          </div>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="mr-2 font-semibold text-foreground">1.</span>Plug your phone into this
              computer with a USB cable.
            </li>
            <li>
              <span className="mr-2 font-semibold text-foreground">2.</span>Your computer opens the
              phone — <b>Windows:</b> This PC → your phone → DCIM. <b>Mac:</b> Photos / Image Capture
              (iPhone), or Android File Transfer (Android).
            </li>
            <li>
              <span className="mr-2 font-semibold text-foreground">3.</span>Choose those files here:
            </li>
          </ol>
          <Button onClick={() => fileInput.current?.click()}>Choose files from your phone</Button>
          <p className="text-xs text-muted-foreground">
            ClipWaltz imports files your computer can see — a browser can&apos;t read a phone&apos;s
            library directly over USB.
          </p>
        </div>
      ) : null}

      {/* upload list */}
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((i) => (
            <li
              key={i.localId}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              {i.kind === "video" ? (
                <Film className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
              {i.status === "uploading" ? (
                <div className="flex w-28 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${i.progress}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs text-muted-foreground">{i.progress}%</span>
                </div>
              ) : i.status === "done" ? (
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <X className="size-4 text-destructive" />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {/* footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {uploadedCount > 0
            ? `${uploadedCount} file${uploadedCount === 1 ? "" : "s"} ready`
            : "Add at least one photo or video to continue."}
        </p>
        <Button
          disabled={anyUploading || uploadedCount === 0}
          onClick={() => router.push(`/projects/${projectId}/edit`)}
        >
          {anyUploading ? "Uploading…" : "Continue →"}
        </Button>
      </div>
    </div>
  );
}
