"use client";
// WaltzDeck editor: brief → media (+ per-item notes) → AI storyboard (scene cards) → preview → render.
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles, Upload, Loader2, Lock, Unlock, Trash2, Plus, ArrowUp, ArrowDown, Wand2, Play, Pause, RotateCcw, Info, ImageIcon, Mic, Captions,
  FileUp, Globe, Presentation, FileText, FileDown, Download,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { aspectClass, isWide } from "@/lib/aspect";
import {
  DECK_MODES, LANGUAGES, LAYOUTS, MAX_BULLETS, VOICES,
  type BrandSuggestion, type Campaign, type DeckBrief, type DeckExport, type DeckExportFormat, type DeckScene, type SceneTextMode, type TextMode, type VoiceMode,
} from "@/lib/deck/types";
import {
  getDeck, saveBrief, setAssetNote, describeAsset, requestPlan, updateScene, rewriteSceneText, reorderScenes, addScene, deleteScene,
  requestDeckExport, importFromUrl, fillScene, translateDeck,
  type DeckData, type DeckAsset, type ScenePatch,
} from "@/lib/deck-actions";
import { PresentView } from "./present-view";
import { unwrap } from "@/lib/action-result";
import { CampaignPanel } from "./campaign-panel";
import { AiFill } from "./ai-fill";
import { useCredits } from "@/components/credits-line";
import type { CreditBalance } from "@/lib/credits";
import { uploadProjectFile, isSupported } from "@/lib/upload-client";
import { SceneFrame, type FrameBrand } from "./scene-frame";
import { BRAND_FONTS, BRAND_FONTS_CSS, type BrandKit } from "@/lib/brand";
import { saveBrandKit, uploadBrandLogo, suggestBrandFromSite, applyBrandSuggestion, dismissBrandSuggestion } from "@/lib/brand-actions";

const BUSY = new Set(["queued", "describing", "planning"]);
const IMPORT_BUSY = new Set(["queued", "reading", "summarizing"]);
const field = "w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

export function DeckEditor({ initial, initialBrand, initialCampaigns, canEdit, renderSlot }: {
  initial: DeckData; initialBrand: BrandKit | null; initialCampaigns: Campaign[]; canEdit: boolean; renderSlot: ReactNode;
}) {
  const [data, setData] = useState(initial);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(initialBrand);
  const [logoVersion, setLogoVersion] = useState(0);
  const [brief, setBrief] = useState<DeckBrief>(initial.deck.brief);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const projectId = data.project.id;
  const plan = data.deck.plan ?? { status: "idle" as const };
  const planBusy = BUSY.has(plan.status);
  const rewriting = data.scenes.some((s) => s.why === "Rewriting…");
  const describing = data.assets.some((a) => !a.described);
  const imp = data.deck.import ?? { status: "idle" as const };
  const importBusy = IMPORT_BUSY.has(imp.status);
  const exporting = data.exports.some((e) => e.status === "queued" || e.status === "running");
  const filling = Object.values(data.fills).some((f) => !["failed", "cancelled"].includes(f.status));
  const brandSug = data.deck.brandSuggestion ?? { status: "idle" as const };
  const brandReading = brandSug.status === "queued" || brandSug.status === "reading";
  const tr = data.deck.translation ?? { status: "idle" as const };
  const translating = tr.status === "queued" || tr.status === "translating";
  const router = useRouter();
  // AI credits: re-read whenever a fill job starts or ends (a failed one refunds).
  const credits = useCredits(JSON.stringify(data.fills));

  const refresh = useCallback(async () => {
    try {
      setData(unwrap(await getDeck(projectId)));
    } catch { /* keep the last good state */ }
  }, [projectId]);

  // Poll while the worker is busy (planning, rewriting, describing fresh uploads, importing, exporting).
  useEffect(() => {
    if (!planBusy && !rewriting && !describing && !importBusy && !exporting && !filling && !brandReading && !translating) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [planBusy, rewriting, describing, importBusy, exporting, filling, brandReading, translating, refresh]);

  // A translation fills the brief on the server: adopt it once, when it finishes.
  const [trSeen, setTrSeen] = useState(tr.status);
  if (tr.status !== trSeen) {
    setTrSeen(tr.status);
    if (tr.status === "ready") setBrief(data.deck.brief);
  }

  // An import fills the brief (and may switch the mode) on the server: adopt it once, when the import finishes.
  const [importSeen, setImportSeen] = useState(imp.status);
  if (imp.status !== importSeen) {
    setImportSeen(imp.status);
    if (imp.status === "ready") setBrief(data.deck.brief);
  }

  const act = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      try {
        await fn();
        if (ok) toast.success(ok);
        await refresh();
      } catch (e) {
        toast.error((e as Error).message || "Something went wrong.");
      }
    });

  const saveBriefNow = (patch: Partial<DeckBrief> = {}) => {
    const next = { ...brief, ...patch };
    setBrief(next);
    act(async () => unwrap(await saveBrief(projectId, next)));
  };

  const assetById = new Map(data.assets.map((a) => [a.id, a]));
  const frameBrand: FrameBrand = brandKit?.applied
    ? { primary: brandKit.primary, secondary: brandKit.secondary, headingFont: brandKit.headingFont, bodyFont: brandKit.bodyFont,
        logoUrl: brandKit.hasLogo ? `/api/projects/${projectId}/brand-logo?v=${logoVersion}` : null }
    : null;
  const total = data.scenes.reduce((n, s) => n + s.durationSec, 0);
  const aspectCss = aspectClass(data.project.aspect);
  const unused = plan.status === "ready" ? (plan.unusedAssetIds ?? []).filter((id) => !data.scenes.some((s) => s.assetId === id)) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Same font families the render box has installed (src/lib/brand.ts) — so the preview matches. */}
      <link rel="stylesheet" href={BRAND_FONTS_CSS} precedence="default" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[color:var(--cw-violet)]">
            <Sparkles className="size-3.5" /> WaltzDeck
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.project.title}</h1>
          <p className="text-sm text-muted-foreground">
            Your photos and videos, a brief, and notes per item → an on-brand {brief.mode === "ad" ? "ad" : brief.mode === "presentation" ? "presentation" : "slideshow"}, scene by scene.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && data.scenes.length ? (
            <select value="" disabled={pending || translating} aria-label="Translate this deck"
              onChange={(e) => {
                const lang = e.target.value;
                if (!lang) return;
                act(async () => { const id = unwrap(await translateDeck(projectId, lang)); router.push(`/projects/${id}/deck`); },
                  "Translated copy created — the words are being translated now.");
              }}
              className="h-8 rounded-full border border-border bg-background px-3 text-xs text-muted-foreground">
              <option value="">Translate to…</option>
              {LANGUAGES.filter((l) => l.code !== (brief.language ?? "en")).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          ) : null}
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{data.project.aspect}</span>
        </div>
      </header>
      {brief.translatedFrom || tr.status !== "idle" ? (
        <div className="cw-glass flex flex-wrap items-center gap-2 rounded-xl px-4 py-2 text-xs">
          {translating ? <Loader2 className="size-3.5 animate-spin text-[color:var(--cw-violet)]" /> : <Globe className="size-3.5 text-[color:var(--cw-violet)]" />}
          <span>
            {LANGUAGES.find((l) => l.code === (brief.language ?? "en"))?.label} version
            {brief.translatedFrom ? <> of <Link className="underline" href={`/projects/${brief.translatedFrom.projectId}/deck`}>{brief.translatedFrom.title}</Link></> : null}
            {translating ? " — translating the words…" : null}
            {tr.status === "ready" ? ` — translated. Check the scenes, then render.${tr.kept ? ` ${tr.kept} line${tr.kept === 1 ? "" : "s"} kept in the original language (a number or web address didn't survive) — edit them by hand.` : ""}` : null}
            {tr.status === "failed" ? <span className="text-destructive"> — translation failed: {tr.error}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* ── left: brief + media ── */}
        <div className="space-y-6">
          <section className="cw-glass space-y-4 rounded-xl p-4">
            <h2 className="text-sm font-semibold">1 · Brief</h2>
            <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 text-sm">
              {DECK_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={brief.mode === m.key}
                  onClick={() => saveBriefNow({ mode: m.key, lengthSec: m.defaultLength })}
                  className={cn("rounded-md px-3 py-1.5", brief.mode === m.key ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground")}
                  title={m.desc}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {canEdit ? <ImportBar projectId={projectId} status={imp} busy={importBusy} onStarted={refresh} /> : null}
            <label className="block space-y-1">
              <span className="text-sm font-medium">{brief.mode === "presentation" ? "What is this presentation about?" : "What is this video for?"}</span>
              <textarea
                value={brief.prompt}
                disabled={!canEdit}
                onChange={(e) => setBrief({ ...brief, prompt: e.target.value })}
                onBlur={() => saveBriefNow()}
                rows={4}
                maxLength={2000}
                placeholder={brief.mode === "ad"
                  ? "e.g. 15-second Instagram ad for our cold brew — summer vibe, easy to order, for busy commuters."
                  : brief.mode === "presentation"
                    ? "e.g. Q3 review for the team — what went well, what we learned, next steps. Friendly, clear."
                    : "e.g. Our family trip to Lake Powell — warm, fun, in the order it happened."}
                className={cn(field, "resize-y py-2")}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Tone</span>
                <input value={brief.tone ?? ""} disabled={!canEdit} onChange={(e) => setBrief({ ...brief, tone: e.target.value })} onBlur={() => saveBriefNow()} placeholder="energetic, friendly" className={cn(field, "h-9")} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Offer (optional)</span>
                <input value={brief.offer ?? ""} disabled={!canEdit} onChange={(e) => setBrief({ ...brief, offer: e.target.value })} onBlur={() => saveBriefNow()} placeholder="20% off weekdays" className={cn(field, "h-9")} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Call to action {brief.mode === "ad" ? "" : "(optional)"}</span>
                <input value={brief.cta?.text ?? ""} disabled={!canEdit} onChange={(e) => setBrief({ ...brief, cta: { text: e.target.value, url: brief.cta?.url } })} onBlur={() => saveBriefNow()} placeholder="Book at example.com" className={cn(field, "h-9")} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Length · {brief.lengthSec}s</span>
                <input type="range" min={6} max={brief.mode === "ad" ? 60 : 180} step={1} value={brief.lengthSec} disabled={!canEdit}
                  onChange={(e) => setBrief({ ...brief, lengthSec: Number(e.target.value) })} onPointerUp={() => saveBriefNow()} onKeyUp={() => saveBriefNow()} className="h-9 w-full" />
              </label>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Text on video</span>
              <div className="flex flex-wrap gap-2">
                {([
                  ["auto", "Auto — AI writes it"],
                  ["manual", "Manual — I'll write it"],
                  ["off", "Off — no text"],
                ] as [TextMode, string][]).map(([k, label]) => (
                  <button key={k} type="button" disabled={!canEdit} aria-pressed={brief.textMode === k} onClick={() => saveBriefNow({ textMode: k })}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium", brief.textMode === k ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="font-medium text-muted-foreground">Language</span>
              <select value={brief.language ?? "en"} disabled={!canEdit} onChange={(e) => saveBriefNow({ language: e.target.value as DeckBrief["language"] })}
                className={cn(field, "h-8 w-auto text-xs")} aria-label="Language of the text and voice">
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <span className="text-[11px] text-muted-foreground">for the AI&apos;s text, the voice and captions</span>
            </label>
            <VoiceControls brief={brief} canEdit={canEdit} onChange={(patch) => saveBriefNow(patch)} />
          </section>

          <BrandSection projectId={projectId} kit={brandKit} canEdit={canEdit} suggestion={brandSug} onChanged={refresh}
            onSaved={(k, logo) => { setBrandKit(k); if (logo) setLogoVersion((v) => v + 1); }} />

          <MediaSection projectId={projectId} assets={data.assets} canEdit={canEdit} onChange={refresh} />
        </div>

        {/* ── right: storyboard + preview + render ── */}
        <div className="space-y-6">
          <section className="cw-glass space-y-4 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">2 · Storyboard</h2>
              <Button disabled={!canEdit || pending || planBusy || !data.assets.length}
                onClick={() => act(async () => { unwrap(await saveBrief(projectId, brief)); unwrap(await requestPlan(projectId)); })}>
                {planBusy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {data.scenes.length ? "Re-plan (keeps locked scenes)" : "Plan my video"}
              </Button>
            </div>
            <PlanStatus plan={plan} />
            {data.scenes.length ? (
              <p className="text-xs text-muted-foreground">
                {data.scenes.length} scenes · {total.toFixed(1)}s of {brief.lengthSec}s
                {unused.length ? ` · ${unused.length} of your files not used yet (add them from the media list)` : ""}
              </p>
            ) : null}
            <div className="space-y-3">
              {data.scenes.map((s, i) => (
                <SceneCard
                  key={s.id}
                  projectId={projectId}
                  scene={s}
                  index={i}
                  count={data.scenes.length}
                  asset={s.assetId ? assetById.get(s.assetId) ?? null : null}
                  assets={data.assets}
                  aspectCss={aspectCss}
                  wide={isWide(data.project.aspect)}
                  canEdit={canEdit}
                  brand={frameBrand}
                  voiceMode={brief.voice?.mode ?? "off"}
                  presentation={brief.mode === "presentation"}
                  fill={data.fills[s.id]}
                  credits={credits}
                  onFill={(mode, prompt) => new Promise<void>((resolve) => act(async () => { try { unwrap(await fillScene(projectId, s.id, { mode, prompt })); } finally { resolve(); } },
                    mode === "animate" ? "Bringing it to life — the clip replaces this scene's photo when it's ready." : "Making the shot — it goes into this scene when it's ready."))}
                  onPatch={(patch) => act(async () => unwrap(await updateScene(projectId, s.id, patch)))}
                  onRewrite={(ins) => act(async () => unwrap(await rewriteSceneText(projectId, s.id, ins)))}
                  onMove={(dir) => {
                    const ids = data.scenes.map((x) => x.id);
                    const j = i + dir;
                    if (j < 0 || j >= ids.length) return;
                    [ids[i], ids[j]] = [ids[j], ids[i]];
                    act(async () => unwrap(await reorderScenes(projectId, ids)));
                  }}
                  onDelete={() => act(async () => unwrap(await deleteScene(projectId, s.id)))}
                  onAddAfter={() => act(async () => unwrap(await addScene(projectId, i, null)))}
                />
              ))}
            </div>
            {unused.length && canEdit ? (
              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Not in the storyboard yet — tap to add at the end:</p>
                <div className="flex flex-wrap gap-2">
                  {unused.map((id) => {
                    const a = assetById.get(id);
                    return a ? (
                      <button key={id} type="button" onClick={() => act(async () => unwrap(await addScene(projectId, data.scenes.length - 1, id)))}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary">+ {a.name}</button>
                    ) : null;
                  })}
                </div>
              </div>
            ) : null}
          </section>

          {data.scenes.length ? <DeckPreview projectId={projectId} scenes={data.scenes} assets={assetById} aspectCss={aspectCss} wide={isWide(data.project.aspect)} brand={frameBrand} /> : null}

          {data.scenes.length ? (
            <SlidesSection
              projectId={projectId}
              exports={data.exports}
              canEdit={canEdit}
              presentation={brief.mode === "presentation"}
              onPresent={() => setPresenting(0)}
              onExport={(f) => act(async () => unwrap(await requestDeckExport(projectId, f)), f === "pdf" ? "Making your PDF…" : "Making your PowerPoint…")}
            />
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">3 · Render{brief.mode === "presentation" ? " as a video" : ""}</h2>
            {renderSlot}
          </section>

          {data.scenes.length ? (
            <CampaignPanel
              projectId={projectId}
              initial={initialCampaigns}
              canEdit={canEdit}
              scenes={data.scenes}
              assets={data.assets}
              brand={frameBrand}
              aspect={data.project.aspect}
              voiceOn={(brief.voice?.mode ?? "off") !== "off"}
              ctaText={brief.cta?.text ?? ""}
            />
          ) : null}
        </div>
      </div>
      {presenting !== null && data.scenes.length ? (
        <PresentView
          projectId={projectId}
          scenes={data.scenes}
          assets={assetById}
          aspect={data.project.aspect}
          brand={frameBrand}
          start={presenting}
          onClose={() => setPresenting(null)}
        />
      ) : null}
    </div>
  );
}

/** Start from an existing PowerPoint / PDF (one scene per slide) or a web page (fills the brief). */
function ImportBar({ projectId, status, busy, onStarted }: {
  projectId: string; status: NonNullable<DeckData["deck"]["import"]>; busy: boolean; onStarted: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`/api/projects/${projectId}/deck-import`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.text()) || "Import failed.");
      toast.success(`Reading ${f.name}…`);
      onStarted();
    } catch (e) {
      toast.error((e as Error).message || "Import failed.");
    }
    setSending(false);
    if (input.current) input.current.value = "";
  };
  const fromUrl = async () => {
    if (!url.trim()) return;
    setSending(true);
    try {
      unwrap(await importFromUrl(projectId, url));
      toast.success("Reading the page…");
      setUrl("");
      setOpen(false);
      onStarted();
    } catch (e) {
      toast.error((e as Error).message || "Import failed.");
    }
    setSending(false);
  };
  const working = busy || sending;
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Start from what you have:</span>
        <input ref={input} type="file" accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <Button size="sm" variant="secondary" disabled={working} onClick={() => input.current?.click()}>
          <FileUp className="size-4" /> PowerPoint or PDF
        </Button>
        <Button size="sm" variant="secondary" disabled={working} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Globe className="size-4" /> Web page
        </Button>
      </div>
      {open ? (
        <form onSubmit={(e) => { e.preventDefault(); void fromUrl(); }} className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-product-page.com" maxLength={500} className={cn(field, "h-8 text-xs")} aria-label="Web page address" />
          <Button size="sm" type="submit" disabled={working || !url.trim()}>Import</Button>
        </form>
      ) : null}
      {status.status === "queued" || status.status === "reading" ? <Status spin>Reading {status.name}…</Status> : null}
      {status.status === "summarizing" ? <Status spin>Writing your brief from {status.name}…</Status> : null}
      {status.status === "ready" ? <p className="text-xs text-muted-foreground">Imported {status.name}: {status.note}</p> : null}
      {status.status === "failed" ? <p className="text-xs text-destructive">Import failed: {status.error}</p> : null}
      {status.status === "idle" ? (
        <p className="text-[11px] text-muted-foreground">A deck becomes one scene per slide (your words, pictures and speaker notes). A web page fills in the brief.</p>
      ) : null}
    </div>
  );
}

/** Present full screen, or export the storyboard as a PDF / editable PowerPoint (built on the render box). */
function SlidesSection({ projectId, exports, canEdit, presentation, onPresent, onExport }: {
  projectId: string; exports: DeckExport[]; canEdit: boolean; presentation: boolean; onPresent: () => void; onExport: (f: DeckExportFormat) => void;
}) {
  const row = (format: DeckExportFormat, label: string, Icon: typeof FileText) => {
    const e = exports.find((x) => x.format === format);
    const busy = e?.status === "queued" || e?.status === "running";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!canEdit || busy} onClick={() => onExport(format)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />} {e?.status === "done" ? `New ${label}` : label}
        </Button>
        {e?.status === "done" ? (
          <a href={`/api/projects/${projectId}/deck-exports/${e.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--cw-violet)] hover:underline">
            <Download className="size-3.5" /> Download ({new Date(e.finishedAt ?? e.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })})
          </a>
        ) : null}
        {busy ? <span className="text-xs text-muted-foreground">Making it…</span> : null}
        {e?.status === "failed" ? <span className="text-xs text-destructive">Failed: {e.error}</span> : null}
      </div>
    );
  };
  return (
    <section className="cw-glass space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{presentation ? "Present & export" : "Slides"}</h2>
        <Button size="sm" onClick={onPresent}><Presentation className="size-4" /> Present</Button>
      </div>
      <div className="space-y-2">
        {row("pdf", "PDF", FileText)}
        {row("pptx", "PowerPoint", FileDown)}
      </div>
      <p className="text-[11px] text-muted-foreground">
        One slide per scene, same look as the video. PowerPoint text stays editable and each scene&apos;s {presentation ? "notes become" : "voice line becomes"}
        {" "}the speaker notes; video scenes show a still frame. Present: arrow keys or click to move, N for notes, Esc to leave.
      </p>
    </section>
  );
}

function VoiceControls({ brief, canEdit, onChange }: { brief: DeckBrief; canEdit: boolean; onChange: (p: Partial<DeckBrief>) => void }) {
  const v = brief.voice ?? { mode: "off" as VoiceMode, voiceId: "af_heart", speed: 1 };
  const captions = brief.captions?.enabled ?? true;
  const [speed, setSpeed] = useState(v.speed);
  const audio = useRef<HTMLAudioElement | null>(null);
  const preview = () => {
    const a = audio.current;
    if (!a) return;
    a.src = `/voices/${v.voiceId}.mp3`;
    a.playbackRate = speed;
    void a.play().catch(() => {});
  };
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Mic className="size-3.5" /> Voiceover</span>
      <div className="flex flex-wrap gap-2">
        {([
          ["off", "Off"],
          ["auto", "AI writes it"],
          ["manual", "I'll write it"],
        ] as [VoiceMode, string][]).map(([k, label]) => (
          <button key={k} type="button" disabled={!canEdit} aria-pressed={v.mode === k} onClick={() => onChange({ voice: { ...v, mode: k } })}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", v.mode === k ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {v.mode !== "off" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={v.voiceId} disabled={!canEdit} onChange={(e) => onChange({ voice: { ...v, voiceId: e.target.value } })} className={cn(field, "h-8 max-w-[240px] text-xs")} aria-label="Voice">
              {VOICES.filter((o) => o.lang === (brief.language ?? "en")).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <Button type="button" size="sm" variant="secondary" onClick={preview}><Play className="size-3.5" /> Hear it</Button>
            <audio ref={audio} preload="none" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Speed {speed.toFixed(2)}×
            <input type="range" min={0.8} max={1.25} step={0.05} value={speed} disabled={!canEdit}
              onChange={(e) => setSpeed(Number(e.target.value))}
              onPointerUp={() => onChange({ voice: { ...v, speed } })} onKeyUp={() => onChange({ voice: { ...v, speed } })} className="flex-1" />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={captions} disabled={!canEdit} onChange={(e) => onChange({ captions: { enabled: e.target.checked } })} />
            <Captions className="size-3.5" /> Captions — each word lights up as it&apos;s spoken
          </label>
          <p className="text-[11px] text-muted-foreground">
            {v.mode === "auto" ? "Plan (or re-plan) and the AI writes a line per scene; scenes get longer if a line needs it." : "Write a line on each scene card; scenes get longer if a line needs it."}
            {" "}Voices are generated privately on ClipWaltz&apos;s own servers.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function BrandSection({ projectId, kit, canEdit, suggestion, onChanged, onSaved }: {
  projectId: string; kit: BrandKit | null; canEdit: boolean; onSaved: (k: BrandKit, logoChanged?: boolean) => void;
  suggestion: BrandSuggestion; onChanged: () => Promise<void> | void;
}) {
  const [v, setV] = useState({
    primary: kit?.primary ?? "#8b5cf6", secondary: kit?.secondary ?? "#120a24",
    headingFont: kit?.headingFont ?? "Montserrat", bodyFont: kit?.bodyFont ?? "Inter", applied: kit?.applied ?? false,
  });
  const [busy, setBusy] = useState(false);
  const logo = useRef<HTMLInputElement | null>(null);
  const save = async (next = v) => {
    setV(next);
    setBusy(true);
    try { onSaved(unwrap(await saveBrandKit(projectId, next))); } catch (e) { toast.error((e as Error).message || "Couldn't save the brand kit."); }
    setBusy(false);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("logo", f);
      unwrap(await uploadBrandLogo(projectId, fd));
      onSaved(unwrap(await saveBrandKit(projectId, { ...v, applied: true })), true);
      setV({ ...v, applied: true });
      toast.success("Logo added — it shows on title and call-to-action cards.");
    } catch (e) { toast.error((e as Error).message || "Couldn't upload the logo."); }
    setBusy(false);
  };
  return (
    <section className="cw-glass space-y-3 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Brand</h2>
        <label className="inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={v.applied} disabled={!canEdit || busy} onChange={(e) => save({ ...v, applied: e.target.checked })} />
          Use my brand on this video
        </label>
      </div>
      <div className={cn("grid gap-3 sm:grid-cols-2", !v.applied && "opacity-60")}>
        <label className="flex items-center gap-2 text-xs">
          <input type="color" value={v.primary} disabled={!canEdit || busy} onChange={(e) => setV({ ...v, primary: e.target.value })} onBlur={() => save()} className="h-8 w-10 rounded border border-border bg-background" />
          Main colour (buttons, bullets, cards)
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="color" value={v.secondary} disabled={!canEdit || busy} onChange={(e) => setV({ ...v, secondary: e.target.value })} onBlur={() => save()} className="h-8 w-10 rounded border border-border bg-background" />
          Background colour (cards)
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Headline font</span>
          <select value={v.headingFont} disabled={!canEdit || busy} onChange={(e) => save({ ...v, headingFont: e.target.value })} className={cn(field, "h-8")} style={{ fontFamily: `'${v.headingFont}'` }}>
            {BRAND_FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Text font</span>
          <select value={v.bodyFont} disabled={!canEdit || busy} onChange={(e) => save({ ...v, bodyFont: e.target.value })} className={cn(field, "h-8")} style={{ fontFamily: `'${v.bodyFont}'` }}>
            {BRAND_FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {kit?.hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/projects/${projectId}/brand-logo?t=${kit.id}`} alt="Brand logo" className="h-10 max-w-[120px] rounded bg-muted object-contain p-1" />
        ) : null}
        {canEdit ? (
          <>
            <input ref={logo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => logo.current?.click()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />} {kit?.hasLogo ? "Replace logo" : "Add logo"}
            </Button>
          </>
        ) : null}
        <span className="text-[11px] text-muted-foreground">Saved for your workspace — reuse it on every video.</span>
      </div>
      {canEdit ? (
        <BrandFromSite projectId={projectId} suggestion={suggestion} onChanged={onChanged}
          onApplied={(k) => { setV({ primary: k.primary, secondary: k.secondary, headingFont: k.headingFont, bodyFont: k.bodyFont, applied: true }); onSaved(k, true); }} />
      ) : null}
    </section>
  );
}

/** "Build my kit from my website": the worker reads the page and suggests colours, fonts and a logo to review. */
function BrandFromSite({ projectId, suggestion, onChanged, onApplied }: {
  projectId: string; suggestion: BrandSuggestion; onChanged: () => Promise<void> | void; onApplied: (k: BrandKit) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error((e as Error).message || "Something went wrong."); }
    setBusy(false);
    await onChanged();
  };
  const reading = suggestion.status === "queued" || suggestion.status === "reading";
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) void run(async () => unwrap(await suggestBrandFromSite(projectId, url))); }} className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="your-site.com — build my kit from my website" maxLength={500}
          className={cn(field, "h-8 text-xs")} aria-label="Your website" />
        <Button size="sm" variant="secondary" type="submit" disabled={busy || reading || !url.trim()}>
          {reading ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />} Read it
        </Button>
      </form>
      {reading ? <Status spin>Looking at {suggestion.url}…</Status> : null}
      {suggestion.status === "failed" ? <p className="text-xs text-destructive">{suggestion.error}</p> : null}
      {suggestion.status === "ready" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[color:var(--cw-violet)]/50 p-2">
          <span className="flex gap-1" aria-label="Suggested colours">
            <span className="size-7 rounded-md border border-border" style={{ background: suggestion.primary }} title={`Main ${suggestion.primary}`} />
            <span className="size-7 rounded-md border border-border" style={{ background: suggestion.secondary }} title={`Background ${suggestion.secondary}`} />
          </span>
          {suggestion.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/projects/${projectId}/brand-logo?suggestion=1&k=${encodeURIComponent(suggestion.logoKey)}`} alt="Suggested logo" className="h-8 max-w-[96px] rounded bg-muted object-contain p-0.5" />
          ) : null}
          <span className="text-xs">
            <span style={{ fontFamily: `'${suggestion.headingFont}'` }} className="font-bold">{suggestion.headingFont}</span>
            {" / "}<span style={{ fontFamily: `'${suggestion.bodyFont}'` }}>{suggestion.bodyFont}</span>
            <span className="block text-[11px] text-muted-foreground">From {new URL(suggestion.url).hostname}{suggestion.found && !suggestion.found.fonts ? " · fonts: our closest defaults" : ""}</span>
          </span>
          <span className="ml-auto flex gap-1">
            <Button size="sm" disabled={busy} onClick={() => void run(async () => { onApplied(unwrap(await applyBrandSuggestion(projectId))); toast.success("Brand kit updated from your website."); })}>Use these</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => unwrap(await dismissBrandSuggestion(projectId)))}>Dismiss</Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function PlanStatus({ plan }: { plan: NonNullable<DeckData["deck"]["plan"]> }) {
  if (plan.status === "idle") return <p className="text-xs text-muted-foreground">Write the brief, add your media (with notes if you like), then plan. Nothing is rendered until you say so.</p>;
  if (plan.status === "queued") return <Status spin>Waiting for the AI…</Status>;
  if (plan.status === "describing") return <Status spin>Looking at your media {plan.done != null ? `(${plan.done + 1}/${plan.total})` : ""}…</Status>;
  if (plan.status === "planning") return <Status spin>Writing the storyboard…</Status>;
  if (plan.status === "failed") return <p className="text-xs text-destructive">Planning failed: {plan.error}</p>;
  return null;
}
const Status = ({ children, spin }: { children: ReactNode; spin?: boolean }) => (
  <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">{spin ? <Loader2 className="size-3.5 animate-spin text-[color:var(--cw-violet)]" /> : null}{children}</p>
);

function MediaSection({ projectId, assets, canEdit, onChange }: { projectId: string; assets: DeckAsset[]; canEdit: boolean; onChange: () => void }) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (!isSupported(f)) { toast.error(`${f.name}: that file type isn't supported.`); continue; }
      setUploading(f.name);
      setPct(0);
      try {
        const res = await uploadProjectFile(projectId, f, setPct);
        await describeAsset(projectId, res.id).then(unwrap).catch(() => {});
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message || "upload failed"}`);
      }
    }
    setUploading(null);
    onChange();
  };
  return (
    <section className="cw-glass space-y-3 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Your media <span className="font-normal text-muted-foreground">· {assets.length}</span></h2>
        {canEdit ? (
          <>
            <input ref={input} type="file" multiple accept="image/*,video/*,.insv,.insp,.lrv,.heic" className="hidden" onChange={(e) => upload(e.target.files)} />
            <Button variant="secondary" size="sm" disabled={!!uploading} onClick={() => input.current?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {uploading ? `${pct}%` : "Add photos & videos"}
            </Button>
          </>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">Add a note to any item and the AI follows it — &ldquo;hero shot, say it&apos;s organic&rdquo;, &ldquo;show this first&rdquo;, &ldquo;end on this&rdquo;. Put exact wording in quotes.</p>
      <ul className="space-y-2">
        {assets.map((a) => <MediaRow key={a.id} projectId={projectId} asset={a} canEdit={canEdit} />)}
      </ul>
      {!assets.length ? <p className="text-xs text-muted-foreground">No media yet.</p> : null}
    </section>
  );
}

function MediaRow({ projectId, asset, canEdit }: { projectId: string; asset: DeckAsset; canEdit: boolean }) {
  const [note, setNote] = useState(asset.note ?? "");
  const src = `/api/projects/${projectId}/assets/${asset.id}`;
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-background/40 p-2">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-md bg-muted [container-type:size]">
        {asset.kind === "video"
          ? <video src={`${src}#t=0.5`} muted preload="metadata" className="size-full object-cover" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={src} alt="" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-medium">{asset.name}</p>
          {asset.described
            ? <span title={asset.summary ?? ""} className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"><Info className="size-3" /> seen</span>
            : <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> looking…</span>}
        </div>
        <input
          value={note}
          disabled={!canEdit}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== (asset.note ?? "")) void setAssetNote(projectId, asset.id, note).then(unwrap).catch(() => toast.error("Couldn't save the note.")); }}
          maxLength={300}
          placeholder="Note for the AI (optional)"
          className={cn(field, "h-8 text-xs")}
        />
      </div>
    </li>
  );
}

function SceneCard({
  projectId, scene, index, count, asset, assets, aspectCss, wide, canEdit, brand, voiceMode, presentation, fill, credits, onFill, onPatch, onRewrite, onMove, onDelete, onAddAfter,
}: {
  projectId: string; scene: DeckScene; index: number; count: number; asset: DeckAsset | null; assets: DeckAsset[];
  aspectCss: string; wide: boolean; canEdit: boolean; brand: FrameBrand; voiceMode: VoiceMode; presentation: boolean;
  fill?: { status: string; progress: number; error: string | null }; credits: CreditBalance | null;
  onFill: (mode: "animate" | "generate", prompt?: string) => Promise<void>;
  onPatch: (p: ScenePatch) => void; onRewrite: (instruction: string) => void; onMove: (dir: -1 | 1) => void; onDelete: () => void; onAddAfter: () => void;
}) {
  const [headline, setHeadline] = useState(scene.text.headline ?? "");
  const [sub, setSub] = useState(scene.text.sub ?? "");
  const [bullets, setBullets] = useState((scene.text.bullets ?? []).join("\n"));
  const [ask, setAsk] = useState("");
  const [voice, setVoice] = useState(scene.voice ?? "");
  // Pick up server-side rewrites (the card stays mounted while the worker updates the text).
  const serverText = JSON.stringify(scene.text);
  const [seen, setSeen] = useState(serverText);
  if (serverText !== seen) {
    setSeen(serverText);
    setHeadline(scene.text.headline ?? "");
    setSub(scene.text.sub ?? "");
    setBullets((scene.text.bullets ?? []).join("\n"));
  }
  const [seenVoice, setSeenVoice] = useState(scene.voice ?? "");
  if ((scene.voice ?? "") !== seenVoice) {
    setSeenVoice(scene.voice ?? "");
    setVoice(scene.voice ?? "");
  }
  const commitText = () => {
    const next = { headline: headline.trim(), sub: sub.trim(), bullets: bullets.split("\n").map((b) => b.trim()).filter(Boolean) };
    if (JSON.stringify(next) === JSON.stringify({ headline: scene.text.headline ?? "", sub: scene.text.sub ?? "", bullets: scene.text.bullets ?? [] })) return;
    onPatch({ text: next });
  };
  const busy = scene.why === "Rewriting…";
  const textOff = scene.textMode === "none";
  return (
    <article className={cn("rounded-xl border bg-card p-3", scene.locked ? "border-[color:var(--cw-violet)]/60" : "border-border")}>
      <div className={cn("grid gap-3", wide ? "sm:grid-cols-[180px_minmax(0,1fr)]" : "sm:grid-cols-[110px_minmax(0,1fr)]")}>
        <SceneFrame projectId={projectId} scene={{ ...scene, text: { headline, sub, bullets: bullets.split("\n").filter(Boolean) } }} asset={asset} aspectCss={aspectCss} startAt={scene.inSec} brand={brand} />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">#{index + 1}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{scene.role}</span>
            <label className="inline-flex items-center gap-1 text-muted-foreground">
              <input type="number" min={0.8} max={15} step={0.1} defaultValue={scene.durationSec} disabled={!canEdit}
                onBlur={(e) => { const v = Number(e.target.value); if (v && v !== scene.durationSec) onPatch({ durationSec: v }); }}
                className="h-7 w-16 rounded-md border border-border bg-background px-1.5 text-center" />s
            </label>
            <select value={scene.layout} disabled={!canEdit} onChange={(e) => onPatch({ layout: e.target.value })} className="h-7 rounded-md border border-border bg-background px-1.5">
              {LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
            <select value={scene.textMode} disabled={!canEdit} onChange={(e) => onPatch({ textMode: e.target.value as SceneTextMode })} className="h-7 rounded-md border border-border bg-background px-1.5" title="Text on this scene">
              <option value="auto">Text: Auto</option>
              <option value="manual">Text: Manual</option>
              <option value="none">Text: None</option>
            </select>
            <div className="ml-auto flex items-center gap-0.5">
              <IconBtn label={scene.locked ? "Unlock (re-plans may change it)" : "Lock (re-plans keep it)"} disabled={!canEdit} onClick={() => onPatch({ locked: !scene.locked })}>
                {scene.locked ? <Lock className="size-3.5 text-[color:var(--cw-violet)]" /> : <Unlock className="size-3.5" />}
              </IconBtn>
              <IconBtn label="Move up" disabled={!canEdit || index === 0} onClick={() => onMove(-1)}><ArrowUp className="size-3.5" /></IconBtn>
              <IconBtn label="Move down" disabled={!canEdit || index === count - 1} onClick={() => onMove(1)}><ArrowDown className="size-3.5" /></IconBtn>
              <IconBtn label="Add a text card after this" disabled={!canEdit} onClick={onAddAfter}><Plus className="size-3.5" /></IconBtn>
              <IconBtn label="Delete scene" disabled={!canEdit} onClick={onDelete}><Trash2 className="size-3.5" /></IconBtn>
            </div>
          </div>

          {!textOff ? (
            <div className="space-y-1.5">
              <input value={headline} disabled={!canEdit || busy} onChange={(e) => setHeadline(e.target.value)} onBlur={commitText} maxLength={90} placeholder="Headline" className={cn(field, "h-8 font-semibold")} />
              <input value={sub} disabled={!canEdit || busy} onChange={(e) => setSub(e.target.value)} onBlur={commitText} maxLength={140} placeholder="Subline (optional)" className={cn(field, "h-8")} />
              {scene.layout === "bullets" || scene.layout === "slide" ? (
                <textarea value={bullets} disabled={!canEdit || busy} onChange={(e) => setBullets(e.target.value)} onBlur={commitText} rows={3} placeholder={`One point per line (up to ${MAX_BULLETS})`} className={cn(field, "py-1.5 text-xs")} />
              ) : null}
            </div>
          ) : <p className="text-xs text-muted-foreground">No text on this scene.</p>}

          {voiceMode !== "off" || presentation ? (
            <label className="flex items-start gap-2">
              <Mic className="mt-2 size-3.5 shrink-0 text-[color:var(--cw-violet)]" />
              <textarea
                value={voice}
                disabled={!canEdit || busy}
                onChange={(e) => setVoice(e.target.value)}
                onBlur={() => { if (voice.trim() !== (scene.voice ?? "").trim()) onPatch({ voice: voice.trim() }); }}
                rows={2}
                maxLength={400}
                placeholder={voiceMode === "off"
                  ? "Speaker notes (shown when you present; the voiceover if you turn it on)"
                  : voiceMode === "auto" ? "Narration (the AI writes it when you plan)" : "What the voice says in this scene (leave empty for silence)"}
                className={cn(field, "py-1.5 text-xs")}
              />
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            {!textOff ? (["rewrite", "shorter", "punchier"] as const).map((k) => (
              <button key={k} type="button" disabled={!canEdit || busy} onClick={() => onRewrite(k)}
                className="rounded-full border border-border px-2.5 py-0.5 text-[11px] capitalize text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50">
                {k === "rewrite" ? "Rewrite" : k}
              </button>
            )) : null}
            {!textOff ? (
              <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) { onRewrite(ask.trim()); setAsk(""); } }} className="flex min-w-[160px] flex-1 items-center gap-1">
                <input value={ask} disabled={!canEdit || busy} onChange={(e) => setAsk(e.target.value)} maxLength={300} placeholder="Tell the AI what to change in this scene…" className={cn(field, "h-7 text-[11px]")} />
              </form>
            ) : null}
            <select value={scene.assetId ?? ""} disabled={!canEdit} onChange={(e) => onPatch({ assetId: e.target.value || null })} className="h-7 max-w-[160px] rounded-md border border-border bg-background px-1.5 text-[11px]" title="Media">
              <option value="">Text card (no media)</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <AiFill sceneSec={scene.durationSec} hasPhoto={asset?.kind === "photo"} fill={fill} credits={credits} canEdit={canEdit} onFill={onFill}
            defaultPrompt={[scene.text.headline, scene.text.sub].filter(Boolean).join(" — ")} />
          {scene.why ? (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} {scene.why}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const IconBtn = ({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) => (
  <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">{children}</button>
);

/** Plays the storyboard scene by scene with its text (instant, low-res, no render). */
function DeckPreview({ projectId, scenes, assets, aspectCss, wide, brand }: {
  projectId: string; scenes: DeckScene[]; assets: Map<string, DeckAsset>; aspectCss: string; wide: boolean; brand: FrameBrand;
}) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const cur = scenes[Math.min(i, scenes.length - 1)];
  useEffect(() => {
    if (!playing || !cur) return;
    const t = setTimeout(() => {
      if (i + 1 < scenes.length) setI(i + 1);
      else setPlaying(false);
    }, cur.durationSec * 1000);
    return () => clearTimeout(t);
  }, [playing, i, cur, scenes.length]);
  if (!cur) return null;
  const asset = cur.assetId ? assets.get(cur.assetId) ?? null : null;
  return (
    <section className="cw-glass space-y-3 rounded-xl p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        Preview <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">instant · low-res · no music</span>
      </h2>
      <div className={cn("mx-auto", wide ? "max-w-[520px]" : "max-w-[300px]")}>
        <SceneFrame key={`${cur.id}-${i}`} projectId={projectId} scene={cur} asset={asset} aspectCss={aspectCss} playing={playing} startAt={cur.inSec} brand={brand} />
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setPlaying(!playing)}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />} {playing ? "Pause" : "Play"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setI(0); setPlaying(true); }}><RotateCcw className="size-4" /> Restart</Button>
        <span className="text-xs text-muted-foreground">Scene {i + 1}/{scenes.length}</span>
      </div>
      <div className="flex gap-1">
        {scenes.map((s, k) => (
          <button key={s.id} type="button" aria-label={`Go to scene ${k + 1}`} onClick={() => { setI(k); setPlaying(false); }}
            style={{ flexGrow: s.durationSec }} className={cn("h-1.5 rounded-full", k === i ? "bg-[color:var(--cw-violet)]" : k < i ? "bg-foreground/40" : "bg-muted")} />
        ))}
      </div>
      {!asset && cur.assetId ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><ImageIcon className="size-3" /> This scene&apos;s file was removed.</p> : null}
    </section>
  );
}
