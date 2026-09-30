"use client";
// WaltzDeck "Music & voice" mix: music on/off, levels (dB), tone presets for each, and how the music behaves under a
// voiceover. The render applies the same settings (worker/render-worker.mjs MUSIC_TONE / VOICE_TONE / duck modes).
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "cn";
import { DEFAULT_AUDIO, DUCK_MODES, MUSIC_TONES, VOICE_TONES, type DeckAudio } from "@/lib/deck/types";

const field = "rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary";
const db = (v: number) => `${v > 0 ? "+" : ""}${v} dB`;

export function AudioMix({ value, hasVoice, canEdit, onChange }: {
  value: DeckAudio | undefined; hasVoice: boolean; canEdit: boolean; onChange: (a: DeckAudio) => void;
}) {
  const a = { ...DEFAULT_AUDIO, ...(value ?? {}) };
  // Sliders keep a local value while dragging and save on release.
  const [mg, setMg] = useState(a.musicGainDb);
  const [vg, setVg] = useState(a.voiceGainDb);
  const set = (patch: Partial<DeckAudio>) => onChange({ ...a, musicGainDb: mg, voiceGainDb: vg, ...patch });
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><SlidersHorizontal className="size-3.5" /> Mix</p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={a.music} disabled={!canEdit} onChange={(e) => set({ music: e.target.checked })} />
        Music in this video
      </label>
      <div className={cn("grid gap-3 sm:grid-cols-2", !a.music && "pointer-events-none opacity-50")}>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Music level · {db(mg)}</span>
          <input type="range" min={-24} max={6} step={0.5} value={mg} disabled={!canEdit} onChange={(e) => setMg(Number(e.target.value))}
            onPointerUp={() => set({ musicGainDb: mg })} onKeyUp={() => set({ musicGainDb: mg })} className="w-full" aria-label="Music level" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Music tone</span>
          <select value={a.musicTone} disabled={!canEdit} onChange={(e) => set({ musicTone: e.target.value as DeckAudio["musicTone"] })} className={cn(field, "h-8 w-full")} aria-label="Music tone">
            {MUSIC_TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
      </div>
      {hasVoice ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Voice level · {db(vg)}</span>
              <input type="range" min={-12} max={6} step={0.5} value={vg} disabled={!canEdit} onChange={(e) => setVg(Number(e.target.value))}
                onPointerUp={() => set({ voiceGainDb: vg })} onKeyUp={() => set({ voiceGainDb: vg })} className="w-full" aria-label="Voice level" />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Voice tone</span>
              <select value={a.voiceTone} disabled={!canEdit} onChange={(e) => set({ voiceTone: e.target.value as DeckAudio["voiceTone"] })} className={cn(field, "h-8 w-full")} aria-label="Voice tone">
                {VOICE_TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
          </div>
          {a.music ? (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Music while the voice talks</span>
              <div className="flex flex-wrap gap-2">
                {DUCK_MODES.map((m) => (
                  <button key={m.key} type="button" disabled={!canEdit} aria-pressed={a.duck === m.key} onClick={() => set({ duck: m.key })} title={m.desc}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium", a.duck === m.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{DUCK_MODES.find((m) => m.key === a.duck)?.desc}</p>
            </div>
          ) : null}
        </>
      ) : <p className="text-[11px] text-muted-foreground">Turn on a voiceover in the brief to set the voice level and tone.</p>}
    </div>
  );
}
