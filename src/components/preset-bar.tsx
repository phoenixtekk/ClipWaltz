"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Wand2, Loader2, Check, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Preset } from "@/lib/presets";
import {
  applyPreset,
  createPresetFromProject,
  updatePresetFromProject,
  deletePreset,
} from "@/lib/preset-actions";

/**
 * Format + Style + overlay presets, in the editor. Pick a preset then Apply it, snapshot the
 * current project as a new personal preset, or (for your own presets) re-save the current look
 * into it or delete it.
 */
export function PresetBar({ projectId, presets }: { projectId: string; presets: Preset[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState("");

  const builtins = presets.filter((p) => p.kind === "builtin");
  const mine = presets.filter((p) => p.kind === "user");
  const globals = presets.filter((p) => p.kind === "global");
  const selectedPreset = presets.find((p) => p.id === selected) ?? null;
  const ownSelected = selectedPreset?.kind === "user";

  const apply = () => {
    if (!selected) return;
    start(async () => {
      try {
        await applyPreset(projectId, selected);
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

  const update = () => {
    if (!ownSelected || !selectedPreset) return;
    if (!window.confirm(`Overwrite “${selectedPreset.name}” with this project's current settings?`)) return;
    start(async () => {
      try {
        await updatePresetFromProject(projectId, selectedPreset.id);
        toast.success(`Updated “${selectedPreset.name}”`);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not update preset");
      }
    });
  };

  const remove = () => {
    if (!ownSelected || !selectedPreset) return;
    if (!window.confirm(`Delete the preset “${selectedPreset.name}”? This can't be undone.`)) return;
    start(async () => {
      try {
        await deletePreset(selectedPreset.id);
        toast.success(`Deleted “${selectedPreset.name}”`);
        setSelected("");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not delete preset");
      }
    });
  };

  return (
    <div className="cw-glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Wand2 className="size-4 text-[color:var(--cw-violet)]" /> Presets
      </span>
      <select
        aria-label="Choose a preset"
        value={selected}
        disabled={pending}
        onChange={(e) => setSelected(e.target.value)}
        className="h-9 rounded-full border border-border bg-card px-3 pr-8 text-sm text-foreground disabled:opacity-60"
      >
        <option value="">Choose a preset…</option>
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
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        ) : null}
        <optgroup label="Starters">
          {builtins.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </optgroup>
      </select>

      <Button size="sm" onClick={apply} disabled={pending || !selected}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Apply
      </Button>

      {ownSelected ? (
        <>
          <Button variant="outline" size="sm" onClick={update} disabled={pending} title="Overwrite this preset with the current settings">
            <Save className="size-4" /> Update
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={remove}
            disabled={pending}
            title="Delete this preset"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </>
      ) : null}

      <Button variant="outline" size="sm" onClick={save} disabled={pending}>
        <BookmarkPlus className="size-4" /> Save as new
      </Button>

      <p className="ml-auto hidden text-xs text-muted-foreground lg:block">
        Saves aspect, length, style, effects &amp; overlays.
      </p>
    </div>
  );
}
