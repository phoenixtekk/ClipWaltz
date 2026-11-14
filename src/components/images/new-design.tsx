"use client";
// Waltz Image: pick what to make and its format, then open the studio. Shared by the /images page and the New project
// wizard's "Waltz Image" tab.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/action-result";
import { createDesign } from "@/lib/image-ad/image-actions";
import { DESIGN_KINDS, type DesignKind } from "@/lib/image-ad/types";
import { CAROUSEL_FORMATS, IMAGE_FORMATS } from "../../../worker/image/presets.mjs";

export function NewDesign({ title, compact = false }: { title?: string; compact?: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<DesignKind>("image");
  const [format, setFormat] = useState<string>("1:1");
  const [pending, start] = useTransition();
  const formats = kind === "carousel" ? IMAGE_FORMATS.filter((f) => CAROUSEL_FORMATS.includes(f.key)) : IMAGE_FORMATS;
  const fmt = formats.some((f) => f.key === format) ? format : formats[0].key;

  function go() {
    start(async () => {
      try {
        const id = unwrap(await createDesign(kind, fmt, title));
        router.push(`/images/${id}`);
      } catch (e) {
        toast.error((e as Error).message || "Couldn't start the design.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className={cn("grid grid-cols-1 gap-3", compact ? "sm:grid-cols-3" : "sm:grid-cols-3")}>
        {DESIGN_KINDS.map((k) => (
          <button key={k.key} type="button" aria-pressed={kind === k.key} disabled={pending} onClick={() => setKind(k.key)}
            className={cn("flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors hover:border-primary/60",
              kind === k.key ? "border-primary bg-primary/10" : "border-border bg-card")}>
            <p className="text-sm font-medium">{k.label}</p>
            <p className="text-xs text-muted-foreground">{k.desc}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Format</span>
        {formats.map((f) => (
          <button key={f.key} type="button" aria-pressed={fmt === f.key} disabled={pending} onClick={() => setFormat(f.key)} title={`${f.width}×${f.height} · ${f.use}`}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              fmt === f.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {f.key} {f.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={go} disabled={pending}>{pending ? "Creating…" : "Open the studio →"}</Button>
        <p className="text-xs text-muted-foreground">Text and templates are free. Each AI picture uses 2 AI credits (refunded if it fails).</p>
      </div>
    </div>
  );
}
