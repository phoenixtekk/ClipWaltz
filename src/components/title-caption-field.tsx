"use client";
import { useState, useTransition } from "react";
import { Type } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { setProjectStyle } from "@/lib/project-actions";

/** Title / caption for the finished video. Lives in the Timeline tab so it sits with the clips. */
export function TitleCaptionField({
  projectId,
  initialTitle,
}: {
  projectId: string;
  initialTitle: string | null;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    if ((title.trim() || null) === (initialTitle ?? null)) return;
    startTransition(async () => {
      try {
        await setProjectStyle(projectId, { titleText: title });
      } catch {
        toast.error("Could not save title.");
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor="cw-title" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Type className="size-3.5" /> Title / caption (optional)
      </label>
      <Input
        id="cw-title"
        value={title}
        maxLength={80}
        placeholder="e.g. Italy 2026"
        disabled={pending}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
