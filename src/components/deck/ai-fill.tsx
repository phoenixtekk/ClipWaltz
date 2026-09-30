"use client";
// WaltzDeck AI fill (phase 5) on a scene card: bring the scene's photo to life, or generate a missing shot from a
// description. Costs AI credits (shown before starting, refunded if it fails); the finished clip replaces the
// scene's media on its own (worker/generation-worker.mjs deckFillScene).
import { useState } from "react";
import { Clapperboard, Loader2, Wand2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CreditsLine, notEnough } from "@/components/credits-line";
import { generationCost, type CreditBalance } from "@/lib/credits";

/** Same rule as fillScene (src/lib/deck-actions.ts): the shortest Waltz AI length that covers the scene. */
const fillSeconds = (sceneSec: number) => [3, 5, 8].find((d) => d >= sceneSec) ?? 8;
const ACTIVE = (s: string) => !["failed", "cancelled", "completed", "retried"].includes(s);

export function AiFill({ sceneSec, hasPhoto, defaultPrompt, fill, credits, canEdit, onFill }: {
  sceneSec: number; hasPhoto: boolean; defaultPrompt: string;
  fill?: { status: string; progress: number; error: string | null };
  credits: CreditBalance | null; canEdit: boolean;
  onFill: (mode: "animate" | "generate", prompt?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [busy, setBusy] = useState(false);
  const cost = generationCost(fillSeconds(sceneSec));
  if (fill && ACTIVE(fill.status)) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-[color:var(--cw-violet)]" />
        AI is making this shot{fill.status === "queued" ? " (waiting for the GPU)" : ""}… {fill.progress ? `${fill.progress}%` : ""}
      </p>
    );
  }
  if (!canEdit) return null;
  const go = async (mode: "animate" | "generate") => {
    setBusy(true);
    try { await onFill(mode, mode === "generate" ? prompt : undefined); setOpen(false); } finally { setBusy(false); }
  };
  const short = notEnough(credits, cost);
  return (
    <div className="space-y-1.5">
      {fill && (fill.status === "failed" || fill.status === "cancelled") ? (
        <p className="text-[11px] text-destructive">The last AI clip {fill.status === "failed" ? "failed" : "was cancelled"} — its credits were refunded.{fill.error ? ` (${fill.error.slice(0, 120)})` : ""}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {hasPhoto ? (
          <Button size="sm" variant="secondary" disabled={busy || short} onClick={() => void go("animate")} title={`Turn this photo into a ${fillSeconds(sceneSec)} s video clip`}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Bring to life
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Clapperboard className="size-3.5" /> {hasPhoto ? "Or generate a new shot" : "Generate a shot"}
        </Button>
      </div>
      {open ? (
        <div className="flex gap-1.5">
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={900} placeholder="Describe the shot — e.g. slow drone shot over a lake at sunset"
            className={cn("h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus:border-primary")} aria-label="Describe the AI shot" />
          <Button size="sm" disabled={busy || short || !prompt.trim()} onClick={() => void go("generate")}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Make it
          </Button>
        </div>
      ) : null}
      {hasPhoto || open ? <CreditsLine cost={cost} balance={credits} /> : null}
    </div>
  );
}
