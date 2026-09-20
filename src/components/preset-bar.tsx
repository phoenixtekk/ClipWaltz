"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Preset } from "@/lib/presets";
import { applyPreset, createPresetFromProject } from "@/lib/preset-actions";

/**
 * Format + Style + overlay presets, in the editor. Apply a saved/starter look in one click, or
 * snapshot the current project as a new personal preset.
 */
export function PresetBar({ projectId, presets }: { projectId: string; presets: Preset[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState("");

  const builtins = presets.filter((p) => p.kind === "builtin");
  const mine = presets.filter((p) => p.kind === "user");
  const globals = presets.filter((p) => p.kind === "global");

  const apply = (id: string) => {
    if (!id) return;
    setSelected(id);
    start(async () => {
      try {
        await applyPreset(projectId, id);
        toast.success("Preset applied");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not apply preset");
      }
    });
  };

  const save = () => {
    const name = window.prompt("Name this preset (Format + Style + overlays):", "My look");
    if (name == null) return;
    start(async () => {
      try {
        await createPresetFromProject(projectId, name);
        toast.success("Preset saved");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not save preset");
      }
    });
  };

  return (
    <div className="cw-glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Wand2 className="size-4 text-[color:var(--cw-violet)]" /> Presets
      </span>
      <div className="relative">
        <select
          aria-label="Apply a preset"
          value={selected}
          disabled={pending}
          onChange={(e) => apply(e.target.value)}
          className="h-9 rounded-full border border-border bg-card px-3 pr-8 text-sm text-foreground disabled:opacity-60"
        >
          <option value="">Apply a preset…</option>
          {mine.length ? (
            <optgroup label="Your presets">
              {mine.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.isDefault ? "★ " : ""}
                  {p.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {globals.length ? (
            <optgroup label="Featured (ClipWaltz)">
              {globals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Starters">
            {builtins.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <Button variant="outline" size="sm" onClick={save} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <BookmarkPlus className="size-4" />}
        Save as preset
      </Button>
      <p className="ml-auto hidden text-xs text-muted-foreground sm:block">
        Saves aspect, length, style, effects &amp; overlays. Manage on your dashboard.
      </p>
    </div>
  );
}
