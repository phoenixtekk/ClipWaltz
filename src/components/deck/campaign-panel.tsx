"use client";
// WaltzDeck campaign packs (phase 4): test hooks × CTAs × lengths × shapes from one storyboard, render the batch,
// share each variant's landing page and see which one wins (views, completion, CTA clicks) — then make more like it.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, Megaphone, Plus, Trash2, Trophy, Link2, Copy, Download, Sparkles, ExternalLink, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { aspectClass } from "@/lib/aspect";
import {
  CAMPAIGN_ASPECTS, CAMPAIGN_LENGTHS, MAX_VARIANTS, MIN_VIEWS_FOR_WINNER,
  type Campaign, type CampaignHook, type DeckScene,
} from "@/lib/deck/types";
import {
  getCampaigns, createCampaign, updateCampaignDraft, renderCampaign, setCampaignShared, discardCampaignDraft, moreLikeThis,
  type DraftPatch,
} from "@/lib/campaign-actions";
import { rate, utmUrl } from "@/lib/campaign";
import type { DeckAsset } from "@/lib/deck-actions";
import { SceneFrame, type FrameBrand } from "./scene-frame";
import { unwrap } from "@/lib/action-result";

const field = "w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary";
const LIVE = new Set(["drafting", "building"]);
const pct = (n: number, d: number) => (d > 0 ? `${Math.round(rate(n, d) * 1000) / 10}%` : "—");

export function CampaignPanel({ projectId, initial, canEdit, scenes, assets, brand, aspect, voiceOn, ctaText }: {
  projectId: string; initial: Campaign[]; canEdit: boolean; scenes: DeckScene[]; assets: DeckAsset[]; brand: FrameBrand; aspect: string; voiceOn: boolean; ctaText: string;
}) {
  const [packs, setPacks] = useState<Campaign[] | null>(initial);
  const [showNew, setShowNew] = useState(false);
  const refresh = useCallback(async () => {
    try { setPacks(unwrap(await getCampaigns(projectId))); } catch { /* keep the last good state */ }
  }, [projectId]);
  const live = !!packs?.some((p) => LIVE.has(p.status) || (p.status === "rendering" && p.variants.some((v) => v.status === "queued" || v.status === "rendering")));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [live, refresh]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error((e as Error).message || "Something went wrong."); }
    await refresh();
  };
  const hook = scenes.find((s) => s.role === "hook") ?? scenes[0];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  return (
    <section className="cw-glass space-y-4 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="size-4 text-[color:var(--cw-violet)]" /> 4 · Campaign pack</h2>
        {canEdit && packs?.length && !showNew ? <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}><Plus className="size-4" /> New pack</Button> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Test which opening, call to action, length and shape works best: the AI writes alternative hooks, ClipWaltz renders every
        combination (up to {MAX_VARIANTS}), and each video gets its own link that counts views, completions and clicks.
      </p>
      {packs === null ? <p className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading packs…</p> : null}
      {canEdit && packs && (!packs.length || showNew) ? (
        <NewPack defaultAspect={aspect} ctaText={ctaText} onCancel={packs.length ? () => setShowNew(false) : undefined}
          onCreate={(input) => run(async () => { unwrap(await createCampaign(projectId, input)); setShowNew(false); })} />
      ) : null}
      {packs?.map((p) => p.status === "drafting" || p.status === "draft" ? (
        <DraftPack key={p.id} pack={p} canEdit={canEdit} assets={assets} assetById={assetById} brand={brand} baseLayout={hook?.layout ?? "headline-bottom"}
          voiceOn={voiceOn} projectId={projectId}
          onSave={(patch) => run(async () => unwrap(await updateCampaignDraft(projectId, p.id, patch)))}
          onRender={() => run(async () => unwrap(await renderCampaign(projectId, p.id)), "Rendering your pack — videos appear here as they finish.")}
          onDiscard={() => run(async () => unwrap(await discardCampaignDraft(projectId, p.id)), "Draft discarded.")} />
      ) : (
        <PackResults key={p.id} pack={p} canEdit={canEdit}
          onShare={(on) => run(async () => unwrap(await setCampaignShared(projectId, p.id, on)), on ? "Share links are on." : "Share links are off.")}
          onMore={(renderId) => run(async () => unwrap(await moreLikeThis(projectId, renderId)), "New draft pack: the AI is writing hooks in the same style.")} />
      ))}
    </section>
  );
}

function Toggle({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={cn("rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50", on ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}
const flip = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

function NewPack({ defaultAspect, ctaText, onCreate, onCancel }: {
  defaultAspect: string; ctaText: string; onCancel?: () => void;
  onCreate: (i: { aiHooks: number; aiCtas: number; extraCtas: string[]; lengths: number[]; aspects: string[] }) => Promise<void>;
}) {
  const [aiHooks, setAiHooks] = useState(2);
  const [aiCtas, setAiCtas] = useState(ctaText ? 1 : 0);
  const [extra, setExtra] = useState("");
  const [lengths, setLengths] = useState<number[]>([15]);
  const [aspects, setAspects] = useState<string[]>([defaultAspect]);
  const [busy, setBusy] = useState(false);
  const extras = extra.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const n = (1 + aiHooks) * (1 + extras.length + aiCtas) * Math.max(1, lengths.length) * Math.max(1, aspects.length);
  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Hooks — your current opening, plus new ones by the AI</span>
        <div className="flex flex-wrap gap-2">{[0, 1, 2, 3].map((k) => <Toggle key={k} on={aiHooks === k} onClick={() => setAiHooks(k)}>{k === 0 ? "Just mine" : `+${k} AI`}</Toggle>)}</div>
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Calls to action — &ldquo;{ctaText || "none in the brief"}&rdquo;, plus:</span>
        <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} maxLength={400} placeholder="Other wordings to test, one per line (optional)" className={cn(field, "py-1.5 text-xs")} />
        {ctaText ? (
          <div className="flex flex-wrap gap-2">{[0, 1, 2].map((k) => <Toggle key={k} on={aiCtas === k} onClick={() => setAiCtas(k)}>{k === 0 ? "No AI CTAs" : `+${k} by AI`}</Toggle>)}</div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Lengths</span>
          <div className="flex flex-wrap gap-2">{CAMPAIGN_LENGTHS.map((L) => <Toggle key={L} on={lengths.includes(L)} onClick={() => setLengths(flip(lengths, L))}>{L}s</Toggle>)}</div>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Shapes</span>
          <div className="flex flex-wrap gap-2">{CAMPAIGN_ASPECTS.map((a) => <Toggle key={a} on={aspects.includes(a)} onClick={() => setAspects(flip(aspects, a))}>{a}</Toggle>)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !lengths.length || !aspects.length}
          onClick={async () => { setBusy(true); await onCreate({ aiHooks, aiCtas, extraCtas: extras, lengths, aspects }); setBusy(false); }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {aiHooks || aiCtas ? "Write the options" : "Create pack"}
        </Button>
        {onCancel ? <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button> : null}
        <span className={cn("text-xs", n > MAX_VARIANTS ? "text-destructive" : "text-muted-foreground")}>
          ≈ {n} video{n === 1 ? "" : "s"}{n > MAX_VARIANTS ? ` — at most ${MAX_VARIANTS}; you can remove options before rendering` : ""}. You review everything before anything renders.
        </span>
      </div>
    </div>
  );
}

function DraftPack({ pack, canEdit, assets, assetById, brand, baseLayout, voiceOn, projectId, onSave, onRender, onDiscard }: {
  pack: Campaign; canEdit: boolean; assets: DeckAsset[]; assetById: Map<string, DeckAsset>; brand: FrameBrand; baseLayout: string;
  voiceOn: boolean; projectId: string; onSave: (p: DraftPatch) => Promise<void>; onRender: () => Promise<void>; onDiscard: () => Promise<void>;
}) {
  const cfg = pack.config;
  const [hooks, setHooks] = useState<CampaignHook[]>(cfg.hooks);
  const [ctas, setCtas] = useState(cfg.ctas);
  const [link, setLink] = useState(cfg.ctaUrl ?? "");
  const [busy, setBusy] = useState(false);
  // Adopt the AI's options when they arrive (the card stays mounted while the worker writes them).
  const serverKey = JSON.stringify([cfg.hooks.map((h) => h.id), cfg.ctas.map((c) => c.id)]);
  const [seen, setSeen] = useState(serverKey);
  if (serverKey !== seen) {
    // Take the server's list, but keep rows the owner is still typing (local "new-…" ids not saved yet).
    setSeen(serverKey);
    setHooks([...cfg.hooks, ...hooks.filter((h) => h.id.startsWith("new-") && !h.headline.trim())]);
    setCtas([...cfg.ctas, ...ctas.filter((c) => c.id.startsWith("new-") && !c.text.trim())]);
  }
  const drafting = pack.status === "drafting";
  const saveHooks = (next = hooks) => onSave({ hooks: next.map((h) => ({ id: h.id, headline: h.headline, sub: h.sub, voice: h.voice, assetId: h.assetId })) });
  const saveCtas = (next = ctas) => onSave({ ctas: next.map((c) => ({ id: c.id, text: c.text })) });
  const n = hooks.length * ctas.length * cfg.lengths.length * cfg.aspects.length;
  const aspectCss = aspectClass(cfg.aspects[0]);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{pack.name} <span className="font-normal text-muted-foreground">· draft</span></p>
        {drafting ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin text-[color:var(--cw-violet)]" /> The AI is writing options…</span> : null}
      </div>
      {pack.error ? <p className="text-xs text-destructive">{pack.error}</p> : null}
      {cfg.winner ? <p className="text-xs text-muted-foreground">Keeping the winner &ldquo;{cfg.winner.headline}&rdquo; and testing new hooks in the same style.</p> : null}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Hooks (the opening scene)</p>
        {hooks.map((h, i) => {
          const a = h.assetId ? assetById.get(h.assetId) ?? null : null;
          return (
            <div key={h.id} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[88px_minmax(0,1fr)]">
              <SceneFrame projectId={projectId} scene={{ layout: baseLayout, textMode: "auto", text: { headline: h.headline, sub: h.sub }, assetId: h.assetId }}
                asset={a} aspectCss={aspectCss} startAt={h.inSec ?? null} brand={brand} />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{"ABCD"[i]}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{h.original ? "your current hook" : h.angle || h.source}</span>
                  {!h.original && canEdit ? (
                    <button type="button" aria-label="Remove hook" disabled={drafting} onClick={() => { const next = hooks.filter((x) => x.id !== h.id); setHooks(next); void saveHooks(next); }}
                      className="ml-auto grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"><Trash2 className="size-3.5" /></button>
                  ) : null}
                </div>
                {h.original ? (
                  <p className="text-sm font-semibold">{h.headline || <span className="text-muted-foreground">(no text)</span>}<span className="block text-[11px] font-normal text-muted-foreground">Edit it in the storyboard.</span></p>
                ) : (
                  <>
                    <input value={h.headline} disabled={!canEdit || drafting} maxLength={90} onChange={(e) => setHooks(hooks.map((x) => x.id === h.id ? { ...x, headline: e.target.value } : x))}
                      onBlur={() => saveHooks()} className={cn(field, "h-8 font-semibold")} aria-label="Hook headline" />
                    {voiceOn ? (
                      <input value={h.voice ?? ""} disabled={!canEdit || drafting} maxLength={300} placeholder="What the voice says" onChange={(e) => setHooks(hooks.map((x) => x.id === h.id ? { ...x, voice: e.target.value } : x))}
                        onBlur={() => saveHooks()} className={cn(field, "h-8 text-xs")} aria-label="Hook voice line" />
                    ) : null}
                    <select value={h.assetId ?? ""} disabled={!canEdit || drafting} aria-label="Hook media"
                      onChange={(e) => { const next = hooks.map((x) => x.id === h.id ? { ...x, assetId: e.target.value || null } : x); setHooks(next); void saveHooks(next); }}
                      className="h-7 max-w-full rounded-md border border-border bg-background px-1.5 text-[11px]">
                      <option value="">Text card (no media)</option>
                      {assets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    {h.why ? <p className="text-[11px] text-muted-foreground">{h.why}</p> : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {canEdit && hooks.length < 4 ? (
          <Button size="sm" variant="ghost" disabled={drafting} onClick={() => {
            const base = hooks[0];
            setHooks([...hooks, { id: `new-${Date.now()}`, source: "you", assetId: base?.assetId ?? null, headline: "", sub: "", voice: "" }]);
          }}><Plus className="size-4" /> Add my own hook</Button>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Calls to action</p>
        {ctas.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2">
            <span className="w-4 text-xs font-semibold">{i + 1}</span>
            {c.original ? <p className="flex-1 text-sm">{c.text} <span className="text-[11px] text-muted-foreground">(from the brief)</span></p> : (
              <>
                <input value={c.text} disabled={!canEdit || drafting} maxLength={120} onChange={(e) => setCtas(ctas.map((x) => x.id === c.id ? { ...x, text: e.target.value } : x))}
                  onBlur={() => saveCtas()} className={cn(field, "h-8")} aria-label={`Call to action ${i + 1}`} />
                {canEdit ? <button type="button" aria-label="Remove call to action" disabled={drafting} onClick={() => { const next = ctas.filter((x) => x.id !== c.id); setCtas(next); void saveCtas(next); }}
                  className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"><X className="size-3.5" /></button> : null}
              </>
            )}
          </div>
        ))}
        {canEdit && ctas.length < 4 ? <Button size="sm" variant="ghost" disabled={drafting} onClick={() => setCtas([...ctas, { id: `new-${Date.now()}`, source: "you", text: "" }])}><Plus className="size-4" /> Add a call to action</Button> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Lengths</span>
          <div className="flex flex-wrap gap-2">{CAMPAIGN_LENGTHS.map((L) => <Toggle key={L} disabled={!canEdit || drafting} on={cfg.lengths.includes(L)} onClick={() => onSave({ lengths: flip(cfg.lengths, L) })}>{L}s</Toggle>)}</div>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Shapes</span>
          <div className="flex flex-wrap gap-2">{CAMPAIGN_ASPECTS.map((a) => <Toggle key={a} disabled={!canEdit || drafting} on={cfg.aspects.includes(a)} onClick={() => onSave({ aspects: flip(cfg.aspects, a) })}>{a}</Toggle>)}</div>
        </div>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Where the call-to-action button goes (tracked, with UTM tags)</span>
        <input value={link} disabled={!canEdit || drafting} maxLength={500} placeholder="https://your-site.com/book" onChange={(e) => setLink(e.target.value)}
          onBlur={() => { if (link !== (cfg.ctaUrl ?? "")) void onSave({ ctaUrl: link }); }} className={cn(field, "h-8 text-xs")} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canEdit || drafting || busy || !n || n > MAX_VARIANTS || hooks.some((h) => !h.headline.trim() && !h.original)}
          onClick={async () => { setBusy(true); await onRender(); setBusy(false); }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />} Render {n} video{n === 1 ? "" : "s"}
        </Button>
        {canEdit ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onDiscard()}>Discard</Button> : null}
        <span className={cn("text-xs", n > MAX_VARIANTS ? "text-destructive" : "text-muted-foreground")}>
          {hooks.length} hook{hooks.length === 1 ? "" : "s"} × {ctas.length} CTA{ctas.length === 1 ? "" : "s"} × {cfg.lengths.length} length{cfg.lengths.length === 1 ? "" : "s"} × {cfg.aspects.length} shape{cfg.aspects.length === 1 ? "" : "s"}
          {n > MAX_VARIANTS ? ` — at most ${MAX_VARIANTS}` : ""}
        </span>
      </div>
    </div>
  );
}

function PackResults({ pack, canEdit, onShare, onMore }: {
  pack: Campaign; canEdit: boolean; onShare: (on: boolean) => Promise<void>; onMore: (renderId: string) => Promise<void>;
}) {
  const ready = pack.variants.filter((v) => v.status === "done").length;
  const winner = pack.variants.find((v) => v.renderId === pack.winnerRenderId) ?? null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied.`); } catch { toast.error("Couldn't copy — select it by hand."); }
  };
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{pack.name}</p>
        <span className="text-xs text-muted-foreground">
          {pack.status === "building" ? "Building…" : `${ready}/${pack.variants.length} ready`}
          {pack.variants.some((v) => v.status === "failed") ? ` · ${pack.variants.filter((v) => v.status === "failed").length} failed` : ""}
        </span>
        {pack.status === "building" || pack.variants.some((v) => v.status === "queued" || v.status === "rendering") ? <Loader2 className="size-3.5 animate-spin text-[color:var(--cw-violet)]" /> : null}
        <label className="ml-auto inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={pack.shared} disabled={!canEdit || pack.status === "building"} onChange={(e) => void onShare(e.target.checked)} />
          <Link2 className="size-3.5" /> Share links on
        </label>
      </div>
      {pack.error ? <p className="text-xs text-destructive">{pack.error}</p> : null}
      {winner ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs">
          <Trophy className="size-4 text-amber-500" />
          <span><b>{winner.code}</b> leads — {pct(winner.stats.clicks, winner.stats.views)} click rate over {winner.stats.views} views ({pct(winner.stats.completes, winner.stats.plays)} watched to the end).</span>
          {canEdit ? <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void onMore(winner.renderId)}><Sparkles className="size-4" /> Make more like the winner</Button> : null}
        </div>
      ) : pack.variants.length > 1 ? (
        <p className="text-[11px] text-muted-foreground">
          {pack.shared ? `A winner is called once two or more videos have ${MIN_VIEWS_FOR_WINNER}+ views.` : "Turn share links on and post the links (or the downloaded videos with the tracked link) to start collecting stats."}
          {" "}Your own views don&apos;t count.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2 font-medium">Video</th><th className="pr-2 font-medium">Hook</th><th className="pr-2 font-medium">Call to action</th>
              <th className="pr-2 text-right font-medium">Views</th><th className="pr-2 text-right font-medium">Watched to end</th>
              <th className="pr-2 text-right font-medium">Clicks</th><th className="pr-2 text-right font-medium">Click rate</th><th className="font-medium" />
            </tr>
          </thead>
          <tbody>
            {pack.variants.map((v) => {
              const landing = `${origin}/c/${v.renderId}`;
              const tracked = utmUrl(pack.config.ctaUrl, pack.name, v);
              return (
                <tr key={v.renderId} className={cn("border-b border-border/60 align-top", v.renderId === pack.winnerRenderId && "bg-amber-400/5")}>
                  <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">
                    {v.renderId === pack.winnerRenderId ? <Trophy className="mr-1 inline size-3.5 text-amber-500" /> : null}{v.label}
                    <span className="block font-normal text-muted-foreground">
                      {v.status === "done" ? "ready" : v.status === "failed" ? <span className="text-destructive">failed</span> : <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> {v.status}</span>}
                    </span>
                  </td>
                  <td className="max-w-[180px] pr-2">{v.hookHeadline}<span className="block text-muted-foreground">{v.angle}</span></td>
                  <td className="max-w-[160px] pr-2">{v.ctaText}</td>
                  <td className="pr-2 text-right tabular-nums">{v.stats.views}</td>
                  <td className="pr-2 text-right tabular-nums">{pct(v.stats.completes, v.stats.plays)}</td>
                  <td className="pr-2 text-right tabular-nums">{v.stats.clicks}</td>
                  <td className="pr-2 text-right tabular-nums">{pct(v.stats.clicks, v.stats.views)}</td>
                  <td className="whitespace-nowrap">
                    {v.status === "done" ? (
                      <span className="inline-flex items-center gap-0.5">
                        {pack.shared ? (
                          <>
                            <IconLink label="Open the landing page" href={`/c/${v.renderId}`}><ExternalLink className="size-3.5" /></IconLink>
                            <IconBtn label="Copy the landing page link" onClick={() => void copy(landing, "Link")}><Copy className="size-3.5" /></IconBtn>
                          </>
                        ) : null}
                        {tracked ? <IconBtn label="Copy the tracked CTA link (UTM) — use it as the ad's destination" onClick={() => void copy(tracked, "Tracked link")}><Link2 className="size-3.5" /></IconBtn> : null}
                        <IconLink label="Download the video" href={`/api/renders/${v.renderId}/download`}><Download className="size-3.5" /></IconLink>
                        {canEdit ? <IconBtn label="Make more like this one" onClick={() => void onMore(v.renderId)}><Sparkles className="size-3.5" /></IconBtn> : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Views, completion and clicks come from each video&apos;s landing page. Posting the downloaded video on an ad platform? Use its
        tracked link (<Link2 className="inline size-3" />) as the destination and your own analytics show which variant sent each visitor.
      </p>
    </div>
  );
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">{children}</button>
);
const IconLink = ({ label, href, children }: { label: string; href: string; children: ReactNode }) => (
  <a aria-label={label} title={label} href={href} target={href.startsWith("/c/") ? "_blank" : undefined} rel="noopener"
    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">{children}</a>
);
