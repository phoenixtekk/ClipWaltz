"use client";
// WaltzDeck backdrops (owner request 2026-10-03): what sits behind text-only scenes (and media zoomed out below fill).
// Pick a built-in style tinted from the brand kit, its strength, Shuffle for a new arrangement — or have Waltz AI
// make a text-free image (costs AI credits, refunded if it fails). Used for the deck default (Brand tab) and for one
// scene (the scene inspector, where "Deck default" follows the deck). The drawing is worker/deck/backdrop.mjs, the
// same code the render and the slide exports use.
import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Shuffle, Sparkles, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CreditsLine, notEnough } from "@/components/credits-line";
import { unwrap } from "@/lib/action-result";
import { BACKDROP_COST, type CreditBalance } from "@/lib/credits";
import { deleteBackdropImage, generateBackdrop, type DeckData } from "@/lib/deck-actions";
import { BACKDROP_PRESETS, type BackdropPresetKey, type ResolvedBackdrop, type SceneBackdrop } from "@/lib/deck/types";
import { BACKDROP_STYLES, INTENSITIES } from "../../../worker/deck/backdrop.mjs";
import { Backdrop, type FrameBrand } from "./scene-frame";

const ACTIVE = (s: string) => !["failed", "cancelled", "completed", "retried"].includes(s);
const INTENSITY_LABEL = { calm: "Calm", balanced: "Balanced", vivid: "Vivid" } as const;

export function BackdropPicker({
  projectId, scope, sceneId, value, fallback, brand, images, jobs, credits, canEdit, onChange, onChanged,
}: {
  projectId: string;
  /** "deck" = the default for every text scene; "scene" = one scene (null value = follow the deck default). */
  scope: "deck" | "scene";
  sceneId?: string;
  value: SceneBackdrop | null;
  /** What applies when `value` is null: the deck default (scene scope) or the brand gradient. */
  fallback: ResolvedBackdrop;
  brand: FrameBrand;
  images: DeckData["backdropImages"];
  jobs: DeckData["backdropJobs"];
  credits: CreditBalance | null;
  canEdit: boolean;
  onChange: (v: SceneBackdrop | null) => void;
  /** After a generate / delete (the editor re-reads the deck). */
  onChanged: () => void;
}) {
  const [preset, setPreset] = useState<BackdropPresetKey>("keynote");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const own = value;
  const eff: SceneBackdrop = own ?? fallback;
  const myJobs = jobs.filter((j) => (scope === "deck" ? !j.sceneId : j.sceneId === sceneId));
  const running = myJobs.find((j) => ACTIVE(j.status));
  const failed = !running ? myJobs.find((j) => j.status === "failed") : null;
  const short = notEnough(credits, BACKDROP_COST);

  const pick = (style: SceneBackdrop["style"], imageId?: string) =>
    onChange({ style, intensity: eff.intensity ?? "balanced", seed: eff.seed ?? 0, ...(imageId ? { imageId } : {}) });
  const tile = (b: Partial<ResolvedBackdrop>) => <Backdrop backdrop={b as ResolvedBackdrop} brand={brand} aspect={16 / 9} zone="center" />;
  const selected = (style: string, imageId?: string) => !!own && own.style === style && (style !== "ai" || own.imageId === imageId);

  async function generate() {
    setBusy(true);
    try {
      unwrap(await generateBackdrop(projectId, { preset, prompt: detail, sceneId: scope === "scene" ? sceneId : null, intensity: eff.intensity }));
      toast.success("Making your backdrop — it's applied when it's ready (about half a minute).");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't start the AI backdrop.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this AI backdrop? Scenes using it go back to the deck default.")) return;
    try {
      unwrap(await deleteBackdropImage(projectId, id));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete it.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {scope === "scene" ? (
          <Tile label="Deck default" selected={!own} disabled={!canEdit} onClick={() => onChange(null)}>{tile(fallback)}</Tile>
        ) : null}
        {BACKDROP_STYLES.map((s) => (
          <Tile key={s.key} label={s.label} title={s.desc} selected={selected(s.key)} disabled={!canEdit} onClick={() => pick(s.key)}>
            {tile({ style: s.key, intensity: eff.intensity, seed: eff.seed })}
          </Tile>
        ))}
      </div>

      {images.length ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Your AI backdrops</p>
          <div className="grid grid-cols-3 gap-1.5">
            {images.map((img) => (
              <div key={img.id} className="group relative">
                <Tile label={img.prompt || BACKDROP_PRESETS.find((p) => p.key === img.preset)?.label || "AI backdrop"} selected={selected("ai", img.id)}
                  disabled={!canEdit} onClick={() => pick("ai", img.id)}>
                  {tile({ style: "ai", intensity: eff.intensity, imageUrl: img.url, tone: img.tone, grid: img.grid })}
                </Tile>
                {canEdit ? (
                  <button type="button" aria-label="Delete this AI backdrop" title="Delete" onClick={() => void remove(img.id)}
                    className="absolute right-1 top-1 hidden rounded-full bg-black/70 p-0.5 text-white group-hover:block focus-visible:block">
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-muted/50 p-0.5 text-[11px]" role="group" aria-label="Strength">
          {INTENSITIES.map((k) => (
            <button key={k} type="button" disabled={!canEdit || eff.style === "brand"} aria-pressed={eff.intensity === k}
              onClick={() => onChange({ ...eff, ...(eff.style === "ai" ? { imageId: eff.imageId } : {}), intensity: k })}
              className={cn("rounded-md px-2 py-1 disabled:opacity-40", eff.intensity === k ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground")}>
              {INTENSITY_LABEL[k]}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={!canEdit || eff.style === "brand" || eff.style === "ai"}
          onClick={() => onChange({ ...eff, seed: Math.floor(Math.random() * 99999) + 1 })} title="Re-arrange the shapes">
          <Shuffle className="size-3.5" /> Shuffle
        </Button>
      </div>

      {canEdit ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium"><Sparkles className="size-3.5 text-[color:var(--cw-violet)]" /> AI backdrop</p>
          {running ? (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-[color:var(--cw-violet)]" />
              Making your backdrop{running.status === "queued" ? " (waiting for the GPU)" : ""}…
            </p>
          ) : (
            <>
              {failed ? <p className="text-[11px] text-destructive">The last AI backdrop failed — its credits were refunded.{failed.error ? ` (${failed.error.slice(0, 120)})` : ""}</p> : null}
              <div className="flex flex-wrap gap-1">
                {[...BACKDROP_PRESETS.map((p) => ({ key: p.key as BackdropPresetKey, label: p.label })), { key: "custom" as const, label: "My own" }].map((p) => (
                  <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}
                    className={cn("rounded-full border px-2 py-0.5 text-[11px]", preset === p.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
                    {p.label}
                  </button>
                ))}
              </div>
              <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={400} aria-label="Describe the backdrop"
                placeholder={preset === "custom" ? "Describe it — e.g. soft morning light through a window" : "Add a detail (optional)"}
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus:border-primary" />
              <div className="flex items-center justify-between gap-2">
                <CreditsLine cost={BACKDROP_COST} balance={credits} />
                <Button type="button" size="sm" disabled={busy || short || (preset === "custom" && !detail.trim())} onClick={() => void generate()}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Make it
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {scope === "deck" ? "Used for every text scene that hasn't picked its own." : "Used for this scene only."} Made in your brand colour, with room for the words.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Tile({ label, title, selected, disabled, onClick, children }: {
  label: string; title?: string; selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected} title={title ?? label}
      className={cn("group/t block w-full space-y-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed")}>
      <span className={cn("relative block aspect-video w-full overflow-hidden rounded-md border [container-type:size]",
        selected ? "border-[color:var(--cw-violet)] ring-2 ring-[color:var(--cw-violet)]/60" : "border-border group-hover/t:border-foreground/40")}>
        {children}
        {selected ? <Check className="absolute right-1 top-1 size-3.5 rounded-full bg-[color:var(--cw-violet)] p-0.5 text-white" /> : null}
      </span>
      <span className="block truncate text-[10.5px] text-muted-foreground">{label}</span>
    </button>
  );
}
