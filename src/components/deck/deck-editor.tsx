"use client";
// WaltzDeck editor: brief → media (+ per-item notes) → AI storyboard (scene cards) → preview → render.
import { Fragment, useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles, Upload, Loader2, Lock, Unlock, Trash2, Plus, ArrowUp, ArrowDown, Wand2, Play, Pause, RotateCcw, Info, ImageIcon, Mic, Captions,
  FileUp, Globe, Presentation, FileText, FileDown, Download, Crop, Music, Palette, Megaphone, Clapperboard, ChevronRight, SkipBack, SkipForward,
  Copy, Film, Type, ListChecks, Shuffle, CheckCircle2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { aspectClass, isWide } from "@/lib/aspect";
import {
  CAMERA_MODES, DECK_MODES, LANGUAGES, LAYOUTS, MAX_BULLETS, MOTION_FIELDS, chatThinking, deckFillSeconds, MOTIONS, MOTION_LABELS, TONES, VOICES, type CameraMode,
  type BrandSuggestion, type Campaign, type DeckBrief, type DeckExport, type DeckExportFormat, type DeckScene, type SceneTextMode, type TextMode, type VoiceMode, type ResolvedBackdrop,
} from "@/lib/deck/types";
import {
  getDeck, saveBrief, setAssetNote, describeAsset, requestPlan, updateScene, rewriteSceneText, reorderScenes, deleteScene,
  requestDeckExport, importFromUrl, fillScene, translateDeck, getBriefHistory, removeBriefHistory, setDeckBackdrop, setDeckMotion, insertScene,
  type DeckData, type DeckAsset, type ScenePatch, type NewScene,
} from "@/lib/deck-actions";
import { PresentView } from "./present-view";
import { DeckChatPanel } from "./deck-chat";
import { EditableTitle } from "@/components/studio/editable-title";
import { unwrap } from "@/lib/action-result";
import { CampaignPanel } from "./campaign-panel";
import { AudioMix } from "./audio-mix";
import { pickMove } from "@/lib/deck/camera";
import { AiFill } from "./ai-fill";
import { useCredits } from "@/components/credits-line";
import { generationCost, type CreditBalance } from "@/lib/credits";
import { uploadProjectFile, isSupported } from "@/lib/upload-client";
import { Backdrop, DeckMotionContext, SceneFrame, type FrameBrand } from "./scene-frame";
import { LOOKS } from "../../../worker/deck/motion.mjs";
import { BackdropPicker } from "./backdrop-picker";
import { BACKDROP_STYLES } from "../../../worker/deck/backdrop.mjs";

const BACKDROP_LABEL: Record<string, string> = Object.fromEntries(BACKDROP_STYLES.map((s) => [s.key, s.label]));
import { SceneMediaDialog } from "./scene-media-dialog";
import { StudioShell, StudioPanel, type StudioTab, type StudioStep } from "@/components/studio/studio-shell";
import { aspectNumber } from "@/lib/deck/frame";
import { rotatedFill } from "@/lib/rotation";
import { LocalDate } from "@/components/local-date";
import { deleteAsset } from "@/lib/asset-actions";
import { BRAND_FONTS, BRAND_FONTS_CSS, MAX_PRONUNCIATIONS, type BrandKit, type Pronunciation } from "@/lib/brand";
import { saveBrandKit, savePronunciations, uploadBrandLogo, suggestBrandFromSite, applyBrandSuggestion, dismissBrandSuggestion } from "@/lib/brand-actions";

const BUSY = new Set(["queued", "describing", "planning"]);
const IMPORT_BUSY = new Set(["queued", "reading", "summarizing"]);
type DeckTab = "storyboard" | "audio" | "brand" | "slides" | "campaign" | "render";
const field = "w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

export function DeckEditor({ initial, initialBrand, initialCampaigns, initialHistory, musicSlot, canEdit, renderSlot }: {
  initial: DeckData; initialBrand: BrandKit | null; initialCampaigns: Campaign[]; initialHistory: { id: string; text: string }[];
  musicSlot: ReactNode; canEdit: boolean; renderSlot: ReactNode;
}) {
  const [data, setData] = useState(initial);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(initialBrand);
  const [logoVersion, setLogoVersion] = useState(0);
  const [brief, setBrief] = useState<DeckBrief>(initial.deck.brief);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [tab, setTab] = useState<DeckTab>("storyboard");
  // The scene shown on the stage and in the inspector (falls back to the first when it's gone, e.g. after a re-plan).
  const [selId, setSelId] = useState<string | null>(initial.scenes[0]?.id ?? null);
  const [history, setHistory] = useState(initialHistory);
  const reloadHistory = () => { void getBriefHistory().then(unwrap).then(setHistory).catch(() => {}); };
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
  const chatBusy = chatThinking(data.deck.chat);
  // Scenes the planner (or the chat) suggested a real AI-filmed shot for, not filmed yet.
  // Only layouts that show media (an animated layout like steps draws its own picture — a shot there is never seen).
  const shotScenes = data.scenes.filter((x) => x.prompt && !x.assetId && !data.fills[x.id] && !x.locked && MOTION_FIELDS[x.layout]?.media !== "ignored");
  const shotCost = shotScenes.reduce((n, x) => n + generationCost(deckFillSeconds(x.durationSec)), 0);
  const router = useRouter();
  // AI credits: re-read whenever a fill job starts or ends (a failed one refunds).
  const backdropBusy = data.backdropJobs.some((j) => !["failed", "cancelled", "completed", "retried"].includes(j.status));
  const credits = useCredits(JSON.stringify([data.fills, data.backdropJobs]));

  const refresh = useCallback(async () => {
    try {
      setData(unwrap(await getDeck(projectId)));
    } catch { /* keep the last good state */ }
  }, [projectId]);

  // Poll while the worker is busy (planning, rewriting, describing fresh uploads, importing, exporting).
  useEffect(() => {
    if (!planBusy && !rewriting && !describing && !importBusy && !exporting && !filling && !brandReading && !translating && !backdropBusy && !chatBusy) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [planBusy, rewriting, describing, importBusy, exporting, filling, brandReading, translating, backdropBusy, chatBusy, refresh]);

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

  // Timeline: insert a scene at a gap (0 = start … scenes.length = end) and select it; move a scene to a gap.
  const insertAt = (at: number, spec: NewScene) =>
    start(async () => {
      try {
        const id = unwrap(await insertScene(projectId, at, spec));
        await refresh();
        setSelId(id);
        toast.success(spec.kind === "duplicate" ? "Scene copied." : "write" in spec && spec.write ? "Scene added — the AI is writing its words." : "Scene added.");
      } catch (e) {
        toast.error((e as Error).message || "Couldn't add the scene.");
      }
    });
  const moveTo = (sceneId: string, gap: number) => {
    const ids = data.scenes.map((x) => x.id);
    const from = ids.indexOf(sceneId);
    if (from < 0) return;
    const to = gap > from ? gap - 1 : gap;
    if (to === from) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sceneId);
    act(async () => unwrap(await reorderScenes(projectId, ids)));
  };
  // New text scenes get AI-written words unless the deck's text is Off (the menu has a switch).
  const [aiWrites, setAiWrites] = useState(initial.deck.brief.textMode !== "off");

  const saveBriefNow = (patch: Partial<DeckBrief> = {}) => {
    const next = { ...brief, ...patch };
    setBrief(next);
    act(async () => { unwrap(await saveBrief(projectId, next)); reloadHistory(); });
  };

  const assetById = new Map(data.assets.map((a) => [a.id, a]));
  const frameBrand: FrameBrand = brandKit?.applied
    ? { primary: brandKit.primary, secondary: brandKit.secondary, headingFont: brandKit.headingFont, bodyFont: brandKit.bodyFont,
        logoUrl: brandKit.hasLogo ? `/api/projects/${projectId}/brand-logo?v=${logoVersion}` : null }
    : null;
  // The deck default backdrop, ready to draw (the server's copy — the worker sets it when an AI backdrop finishes).
  const deckBackdrop: ResolvedBackdrop = (() => {
    const b = data.deck.brief.backdrop;
    if (!b) return { style: "brand", intensity: "balanced", seed: 0 };
    if (b.style !== "ai") return b;
    const img = data.backdropImages.find((i) => i.id === b.imageId);
    return img ? { ...b, imageUrl: img.url, tone: img.tone, grid: img.grid } : { style: "brand", intensity: b.intensity, seed: b.seed };
  })();
  const pickerProps = {
    projectId, brand: frameBrand, images: data.backdropImages, jobs: data.backdropJobs, credits, canEdit, onChanged: refresh,
  };
  const total = data.scenes.reduce((n, s) => n + s.durationSec, 0);
  const aspectCss = aspectClass(data.project.aspect);
  const unused = plan.status === "ready" ? (plan.unusedAssetIds ?? []).filter((id) => !data.scenes.some((s) => s.assetId === id)) : [];

  const selIndex = Math.max(0, data.scenes.findIndex((s) => s.id === selId));
  const selScene = data.scenes[selIndex] ?? null;
  const modeLabel = DECK_MODES.find((m) => m.key === brief.mode)?.label ?? "Slideshow";
  const tabs: StudioTab<DeckTab>[] = [
    { key: "storyboard", label: "Storyboard", icon: <Wand2 className="size-4" /> },
    { key: "audio", label: "Audio", icon: <Music className="size-4" /> },
    { key: "brand", label: "Brand", icon: <Palette className="size-4" /> },
    { key: "slides", label: "Slides", icon: <Presentation className="size-4" /> },
    { key: "campaign", label: "Campaign", icon: <Megaphone className="size-4" /> },
    { key: "render", label: "Render", icon: <Clapperboard className="size-4" /> },
  ];
  const planButton = (
    <Button className="w-full" disabled={!canEdit || pending || planBusy || (!data.assets.length && brief.mode !== "explainer")}
      onClick={() => act(async () => { unwrap(await saveBrief(projectId, brief)); unwrap(await requestPlan(projectId)); })}>
      {planBusy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
      {data.scenes.length ? "Re-plan (keeps locked scenes)" : "Plan my video"}
    </Button>
  );
  const shotsButton = shotScenes.length && canEdit ? (
    <Button variant="secondary" className="w-full" disabled={pending || planBusy || (credits ? credits.left < shotCost : false)}
      title={shotScenes.map((x, i) => `${i + 1}. ${x.prompt}`).join("\n")}
      onClick={() => start(async () => {
        // Each scene on its own: one failure (e.g. not enough credits) doesn't hide the shots that did start.
        let ok = 0;
        let err = "";
        for (const x of shotScenes) {
          try { unwrap(await fillScene(projectId, x.id, { mode: "generate", prompt: x.prompt ?? undefined })); ok++; }
          catch (e) { err = (e as Error).message || "Couldn't start that shot."; }
        }
        await refresh();
        if (ok) toast.success(`Filming ${ok} of ${shotScenes.length} AI shot${shotScenes.length === 1 ? "" : "s"} — each drops into its scene when it's ready (about 10 minutes each).`);
        if (err) toast.error(err);
      })}>
      <Clapperboard className="size-4" /> Film {shotScenes.length} suggested AI shot{shotScenes.length === 1 ? "" : "s"} · {shotCost} credits
    </Button>
  ) : null;

  const left = (() => {
    if (tab === "audio") return (
      <StudioPanel title="Music & voice">
        <div className="space-y-4">
          {(brief.audio?.music ?? true) ? musicSlot : <p className="text-xs text-muted-foreground">No music — turn it back on below.</p>}
          <AudioMix value={brief.audio} hasVoice={(brief.voice?.mode ?? "off") !== "off"} canEdit={canEdit} onChange={(audio) => saveBriefNow({ audio })} />
        </div>
      </StudioPanel>
    );
    if (tab === "brand") return (
      <StudioPanel title="Brand">
        <div className="space-y-5">
          <BrandSection projectId={projectId} kit={brandKit} canEdit={canEdit} suggestion={brandSug} onChanged={refresh}
            onSaved={(k, logo) => { setBrandKit(k); if (logo) setLogoVersion((v) => v + 1); }} />
          <section className="space-y-2 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-semibold">Animated scenes look</h3>
              <p className="text-[11px] text-muted-foreground">The art direction of every animated scene. Shuffle gives each scene a new variant — the same storyboard, a different film.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={data.deck.brief.motion?.look ?? "auto"} disabled={!canEdit} aria-label="Animated scenes look"
                onChange={(e) => act(async () => { const m = unwrap(await setDeckMotion(projectId, { look: e.target.value })); setBrief((b) => ({ ...b, motion: m })); })}
                className={cn(field, "h-8 w-auto")}>
                <option value="auto">Auto (changes with every plan)</option>
                {LOOKS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
              <Button size="sm" variant="secondary" disabled={!canEdit}
                onClick={() => act(async () => { const m = unwrap(await setDeckMotion(projectId, { shuffle: true })); setBrief((b) => ({ ...b, motion: m })); }, "Shuffled — every animated scene has a new variant.")}>
                <Shuffle className="size-4" /> Shuffle
              </Button>
            </div>
          </section>
          <section className="space-y-2 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-semibold">Text slide backdrop</h3>
              <p className="text-[11px] text-muted-foreground">Behind every text-only scene, in your brand colours. A scene can pick its own in the scene panel.</p>
            </div>
            <BackdropPicker {...pickerProps} scope="deck" value={data.deck.brief.backdrop ?? null} fallback={{ style: "brand", intensity: "balanced", seed: 0 }}
              onChange={(v) => act(async () => unwrap(await setDeckBackdrop(projectId, v)))} />
          </section>
        </div>
      </StudioPanel>
    );
    if (tab === "slides") return (
      <StudioPanel title={brief.mode === "presentation" ? "Present & export" : "Slides"}>
        {data.scenes.length ? (
          <SlidesSection projectId={projectId} exports={data.exports} canEdit={canEdit} presentation={brief.mode === "presentation"}
            onPresent={() => setPresenting(selIndex)}
            onExport={(f) => act(async () => unwrap(await requestDeckExport(projectId, f)), f === "pdf" ? "Making your PDF…" : "Making your PowerPoint…")} />
        ) : <p className="text-xs text-muted-foreground">Plan the storyboard first — each scene becomes a slide.</p>}
      </StudioPanel>
    );
    if (tab === "campaign") return (
      <StudioPanel title="Campaign pack">
        {data.scenes.length ? (
          <CampaignPanel projectId={projectId} initial={initialCampaigns} canEdit={canEdit} scenes={data.scenes} assets={data.assets} brand={frameBrand}
            aspect={data.project.aspect} voiceOn={(brief.voice?.mode ?? "off") !== "off"} ctaText={brief.cta?.text ?? ""} />
        ) : <p className="text-xs text-muted-foreground">Plan the storyboard first — a pack tests alternatives of it.</p>}
      </StudioPanel>
    );
    if (tab === "render") return null; // kept mounted below
    return (
      <StudioPanel title="Brief" actions={<span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">AI planner</span>}
        footer={<div className="space-y-1.5">{planButton}<PlanStatus plan={plan} />{shotsButton}</div>}>
        <div className="space-y-4">
          <div className="flex rounded-lg border border-border bg-muted/50 p-0.5 text-sm">
            {DECK_MODES.map((m) => (
              <button key={m.key} type="button" disabled={!canEdit} aria-pressed={brief.mode === m.key} title={m.desc}
                onClick={() => saveBriefNow({
                  mode: m.key, lengthSec: m.defaultLength,
                  // An explainer is narrated: switching to it turns the AI voiceover on (it can be turned off again).
                  ...(m.key === "explainer" && (brief.voice?.mode ?? "off") === "off" ? { voice: { voiceId: "af_heart", speed: 1, ...brief.voice, mode: "auto" as const } } : {}),
                })}
                className={cn("min-w-0 flex-1 truncate rounded-md px-1 py-1.5 text-xs", brief.mode === m.key ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground")}>
                {m.label}
              </button>
            ))}
          </div>
          {canEdit ? <ImportBar projectId={projectId} status={imp} busy={importBusy} onStarted={refresh} /> : null}
          <label className="block space-y-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{brief.mode === "presentation" ? "What is this presentation about?" : "What is this video for?"}</span>
              {canEdit ? (
                <BriefHistory items={history} onUse={(text) => saveBriefNow({ prompt: text })}
                  onRemove={(id) => { setHistory(history.filter((h) => h.id !== id)); void removeBriefHistory(id).then(unwrap).catch(() => {}); }} />
              ) : null}
            </span>
            <textarea value={brief.prompt} disabled={!canEdit} onChange={(e) => setBrief({ ...brief, prompt: e.target.value })} onBlur={() => saveBriefNow()}
              rows={4} maxLength={2000}
              placeholder={brief.mode === "ad"
                ? "e.g. 15-second Instagram ad for our cold brew — summer vibe, easy to order, for busy commuters."
                : brief.mode === "presentation"
                  ? "e.g. Q3 review for the team — what went well, what we learned, next steps. Friendly, clear."
                  : brief.mode === "explainer"
                    ? "e.g. 40-second explainer for TxtYa: groups are spread across texts, chats and email — one message reaches everyone on the channel they already use."
                  : "e.g. Our family trip to Lake Powell — warm, fun, in the order it happened."}
              className={cn(field, "resize-y py-2")} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Tone</span>
              <ToneField value={brief.tone ?? ""} disabled={!canEdit} onChange={(tone) => setBrief({ ...brief, tone })} onCommit={(tone) => saveBriefNow({ tone })} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Offer</span>
              <input value={brief.offer ?? ""} disabled={!canEdit} onChange={(e) => setBrief({ ...brief, offer: e.target.value })} onBlur={() => saveBriefNow()} placeholder="20% off weekdays" className={cn(field, "h-8")} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Call to action</span>
              <input value={brief.cta?.text ?? ""} disabled={!canEdit} onChange={(e) => setBrief({ ...brief, cta: { text: e.target.value, url: brief.cta?.url } })} onBlur={() => saveBriefNow()} placeholder="Book at example.com" className={cn(field, "h-8")} />
            </label>
            <label className="col-span-2 block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Length · {brief.lengthSec}s</span>
              <input type="range" min={6} max={brief.mode === "ad" ? 60 : 180} step={1} value={brief.lengthSec} disabled={!canEdit}
                onChange={(e) => setBrief({ ...brief, lengthSec: Number(e.target.value) })} onPointerUp={() => saveBriefNow()} onKeyUp={() => saveBriefNow()} className="w-full" />
            </label>
          </div>
          <Fold title="Text on video" value={`${brief.textMode === "auto" ? "Auto" : brief.textMode === "manual" ? "Manual" : "Off"} · ${LANGUAGES.find((l) => l.code === (brief.language ?? "en"))?.label ?? ""}`}>
            <div className="flex flex-wrap gap-1.5">
              {([["auto", "Auto — AI writes it"], ["manual", "Manual — I'll write it"], ["off", "Off — no text"]] as [TextMode, string][]).map(([k, label]) => (
                <button key={k} type="button" disabled={!canEdit} aria-pressed={brief.textMode === k} onClick={() => saveBriefNow({ textMode: k })}
                  className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", brief.textMode === k ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="font-medium text-muted-foreground">Language</span>
              <select value={brief.language ?? "en"} disabled={!canEdit} onChange={(e) => saveBriefNow({ language: e.target.value as DeckBrief["language"] })}
                className={cn(field, "h-8 w-auto text-xs")} aria-label="Language of the text and voice">
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <p className="text-[11px] text-muted-foreground">The language of the AI&apos;s text, the voice and captions.</p>
          </Fold>
          <Fold title="Camera" value={CAMERA_MODES.find((m) => m.key === (brief.camera?.mode ?? "off"))?.label ?? ""}>
            <div className="flex flex-wrap gap-1.5">
              {CAMERA_MODES.map((m) => (
                <button key={m.key} type="button" disabled={!canEdit} aria-pressed={(brief.camera?.mode ?? "off") === m.key} title={m.desc}
                  onClick={() => saveBriefNow({ camera: { mode: m.key as CameraMode } })}
                  className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", (brief.camera?.mode ?? "off") === m.key ? "border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10" : "border-border text-muted-foreground hover:text-foreground")}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{CAMERA_MODES.find((m) => m.key === (brief.camera?.mode ?? "off"))?.desc} Text always stays steady.</p>
          </Fold>
          <Fold title="Voiceover" value={(brief.voice?.mode ?? "off") === "off" ? "Off" : `${VOICES.find((v) => v.id === brief.voice?.voiceId)?.label.split(" — ")[0] ?? "On"} · ${(brief.voice?.speed ?? 1).toFixed(2)}×`}>
            <VoiceControls brief={brief} canEdit={canEdit} onChange={(patch) => saveBriefNow(patch)} />
          </Fold>
        </div>
      </StudioPanel>
    );
  })();

  const stage = (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        {selScene ? (
          <span><b className="font-semibold text-foreground">Scene {selIndex + 1} of {data.scenes.length}</b> · <span className="capitalize">{selScene.role}</span> · {LAYOUTS.find((l) => l.key === selScene.layout)?.label ?? selScene.layout}</span>
        ) : <b className="font-semibold text-foreground">Preview</b>}
        {brief.translatedFrom || tr.status !== "idle" ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {translating ? <Loader2 className="size-3.5 animate-spin text-[color:var(--cw-violet)]" /> : <Globe className="size-3.5 text-[color:var(--cw-violet)]" />}
            <span className="truncate">
              {LANGUAGES.find((l) => l.code === (brief.language ?? "en"))?.label} version
              {brief.translatedFrom ? <> of <Link className="underline" href={`/projects/${brief.translatedFrom.projectId}/deck`}>{brief.translatedFrom.title}</Link></> : null}
              {translating ? " — translating the words…" : null}
              {tr.status === "ready" ? ` — translated.${tr.kept ? ` ${tr.kept} line${tr.kept === 1 ? "" : "s"} kept in the original language — edit them by hand.` : ""}` : null}
              {tr.status === "failed" ? <span className="text-destructive"> — translation failed: {tr.error}</span> : null}
            </span>
          </span>
        ) : null}
        <span className="ml-auto rounded-full border border-border px-2 py-0.5">{data.project.aspect}</span>
        {brief.camera?.mode && brief.camera.mode !== "off" ? <span className="rounded-full border border-border px-2 py-0.5">Camera: {CAMERA_MODES.find((m) => m.key === brief.camera?.mode)?.label}</span> : null}
      </div>
      {data.scenes.length ? (
        <DeckStage projectId={projectId} scenes={data.scenes} assets={assetById} aspect={data.project.aspect} aspectCss={aspectCss} brand={frameBrand}
          cameraMode={brief.camera?.mode} index={selIndex} onIndex={(i) => setSelId(data.scenes[i]?.id ?? null)} onPresent={() => setPresenting(selIndex)} />
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm space-y-2">
            <Sparkles className="mx-auto size-6 text-[color:var(--cw-violet)]" />
            <p className="text-sm font-medium">No storyboard yet</p>
            <p className="text-xs text-muted-foreground">Add your photos and videos (bottom left), write the brief, then press <b>Plan my video</b>. Nothing is rendered until you say so.</p>
          </div>
        </div>
      )}
    </>
  );

  const inspector = selScene ? (
    <StudioPanel title={`Scene ${selIndex + 1}`} bodyClassName="p-2">
      <SceneCard
        key={selScene.id}
        stacked
        projectId={projectId}
        scene={selScene}
        index={selIndex}
        count={data.scenes.length}
        asset={selScene.assetId ? assetById.get(selScene.assetId) ?? null : null}
        assets={data.assets}
        aspectCss={aspectCss}
        wide={isWide(data.project.aspect)}
        canEdit={canEdit}
        brand={frameBrand}
        voiceMode={brief.voice?.mode ?? "off"}
        presentation={brief.mode === "presentation"}
        fill={data.fills[selScene.id]}
        credits={credits}
        onFill={(mode, prompt) => new Promise<void>((resolve) => act(async () => { try { unwrap(await fillScene(projectId, selScene.id, { mode, prompt })); } finally { resolve(); } },
          mode === "animate" ? "Bringing it to life — the clip replaces this scene's photo when it's ready." : "Making the shot — it goes into this scene when it's ready."))}
        onPatch={(patch) => act(async () => unwrap(await updateScene(projectId, selScene.id, patch)))}
        onRewrite={(ins) => act(async () => unwrap(await rewriteSceneText(projectId, selScene.id, ins)))}
        onMove={(dir) => {
          const ids = data.scenes.map((x) => x.id);
          const j = selIndex + dir;
          if (j < 0 || j >= ids.length) return;
          [ids[selIndex], ids[j]] = [ids[j], ids[selIndex]];
          act(async () => unwrap(await reorderScenes(projectId, ids)));
        }}
        onDelete={() => { setSelId(data.scenes[selIndex + 1]?.id ?? data.scenes[selIndex - 1]?.id ?? null); act(async () => unwrap(await deleteScene(projectId, selScene.id))); }}
        usedBy={selScene.assetId ? data.scenes.filter((x) => x.assetId === selScene.assetId).length : 0}
        onMediaChanged={refresh}
        onAddAfter={() => insertAt(selIndex + 1, { kind: "title", write: aiWrites })}
        backdropSlot={!selScene.assetId || (selScene.frame?.zoom ?? 1) < 1 ? (
          <BackdropPicker {...pickerProps} scope="scene" sceneId={selScene.id} value={selScene.background} fallback={deckBackdrop}
            onChange={(v) => act(async () => unwrap(await updateScene(projectId, selScene.id, { background: v })))} />
        ) : null}
      />
    </StudioPanel>
  ) : null;

  const steps: StudioStep[] = [
    { label: "Add media", hint: data.assets.length ? `${data.assets.length} file${data.assets.length === 1 ? "" : "s"}${describing ? " · looking…" : " · all seen"}` : brief.mode === "explainer" ? "optional for explainers" : "photos & videos", state: data.assets.length ? "done" : "current" },
    { label: "Brief & plan", hint: data.scenes.length ? `${data.scenes.length} scenes planned` : "write the brief, then plan", state: data.scenes.length ? "done" : data.assets.length || brief.mode === "explainer" ? "current" : "todo", onClick: () => setTab("storyboard") },
    { label: "Review scenes", hint: "text, media, voice", state: data.scenes.length ? "current" : "todo" },
    { label: "Render & share", hint: "video, slides, campaign", state: "todo", onClick: () => setTab("render") },
  ];

  return (
    <DeckMotionContext.Provider value={data.deck.brief.motion ?? null}>
      {/* Same font families the render box has installed (src/lib/brand.ts) — so the preview matches. */}
      <link rel="stylesheet" href={BRAND_FONTS_CSS} precedence="default" />
      <StudioShell
        kind="WaltzDeck"
        leftWide={tab === "audio"}
        title={<EditableTitle projectId={projectId} title={data.project.title} canEdit={canEdit} onRenamed={() => { router.refresh(); return refresh(); }} />}
        subtitle={`${modeLabel} · ${data.scenes.length ? `${data.scenes.length} scenes · ${total.toFixed(1)}s of ${brief.lengthSec}s` : "not planned yet"}`}
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        tools={
          <>
            {canEdit && data.scenes.length ? (
              <select value="" disabled={pending || translating} aria-label="Translate this deck"
                onChange={(e) => {
                  const lang = e.target.value;
                  if (!lang) return;
                  act(async () => { const id = unwrap(await translateDeck(projectId, lang)); router.push(`/projects/${id}/deck`); },
                    "Translated copy created — the words are being translated now.");
                }}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-muted-foreground">
                <option value="">Translate to…</option>
                {LANGUAGES.filter((l) => l.code !== (brief.language ?? "en")).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            ) : null}
            {data.scenes.length ? <Button size="sm" variant="secondary" onClick={() => setPresenting(selIndex)}><Presentation className="size-4" /> Present</Button> : null}
            <Button size="sm" className="cw-spectrum-btn" onClick={() => setTab("render")}><Clapperboard className="size-4" /> Render HD</Button>
          </>
        }
        left={
          <>
            {left}
            {/* The render panel stays mounted (hidden on other tabs) so a running render keeps polling and its status survives. */}
            <div className={tab === "render" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
              <StudioPanel title={brief.mode === "presentation" ? "Render as a video" : "Render"}>{renderSlot}</StudioPanel>
            </div>
          </>
        }
        stage={stage}
        inspector={inspector}
        bottomLeft={
          <StudioPanel title={<>Your media <span className="font-normal normal-case tracking-normal">· {data.assets.length}</span></>}>
            <MediaSection projectId={projectId} assets={data.assets} scenes={data.scenes} canEdit={canEdit} onChange={refresh}
              unused={canEdit ? unused.map((id) => assetById.get(id)).filter((a): a is DeckAsset => !!a) : []}
              onAddScene={(id) => insertAt(data.scenes.length, { kind: "media", assetId: id, write: aiWrites })} />
          </StudioPanel>
        }
        bottom={
          <SceneStrip projectId={projectId} scenes={data.scenes} assets={assetById} brand={frameBrand} sel={selScene?.id ?? null} onSelect={setSelId}
            canEdit={canEdit} voiceOn={(brief.voice?.mode ?? "off") !== "off" || brief.mode === "presentation"} total={total} targetSec={brief.lengthSec}
            assetList={data.assets} aiWrites={aiWrites} onAiWrites={setAiWrites} hasCta={!!brief.cta?.text}
            onInsert={insertAt} onMove={moveTo} />
        }
        steps={steps}
      />
      <DeckChatPanel projectId={projectId} chat={data.deck.chat ?? { status: "idle", messages: [] }} canEdit={canEdit} hasScenes={data.scenes.length > 0}
        onChanged={refresh} onRender={() => setTab("render")} />
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
    </DeckMotionContext.Provider>
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
            <Download className="size-3.5" /> Download (<LocalDate value={e.finishedAt ?? e.createdAt} options={{ dateStyle: "short", timeStyle: "short" }} />)
          </a>
        ) : null}
        {busy ? <span className="text-xs text-muted-foreground">Making it…</span> : null}
        {e?.status === "failed" ? <span className="text-xs text-destructive">Failed: {e.error}</span> : null}
      </div>
    );
  };
  return (
    <section className="space-y-3">
      <Button size="sm" onClick={onPresent}><Presentation className="size-4" /> Present</Button>
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

/** Recent "What is this video for?" briefs (the user's last 15, across projects): click to reuse, × to forget. */
function BriefHistory({ items, onUse, onRemove }: { items: { id: string; text: string }[]; onUse: (text: string) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs font-medium text-[color:var(--cw-violet)] hover:underline">
        Recent ({items.length}) ▾
      </button>
      {open ? (
        <span className="absolute right-0 top-6 z-20 block w-[min(26rem,85vw)] space-y-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {items.map((h) => (
            <span key={h.id} className="flex items-start gap-1 rounded-md hover:bg-muted">
              <button type="button" onClick={() => { onUse(h.text); setOpen(false); }} className="min-w-0 flex-1 px-2 py-1.5 text-left text-xs" title={h.text}>
                <span className="line-clamp-2">{h.text}</span>
              </button>
              <button type="button" aria-label="Remove from history" onClick={() => onRemove(h.id)} className="grid size-7 shrink-0 place-items-center text-muted-foreground hover:text-foreground">×</button>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** Tone: presets the model understands, or your own words ("Custom…"). */
function ToneField({ value, disabled, onChange, onCommit }: { value: string; disabled: boolean; onChange: (v: string) => void; onCommit: (v: string) => void }) {
  const preset = (TONES as readonly string[]).includes(value);
  // Derived each render: a free-text tone set elsewhere (an import, a translation) must show as Custom.
  const [customOpen, setCustom] = useState(false);
  const custom = customOpen || (!!value && !preset);
  return (
    <span className="flex gap-2">
      <select value={custom ? "__custom" : value} disabled={disabled} aria-label="Tone"
        onChange={(e) => {
          if (e.target.value === "__custom") { setCustom(true); return; }
          setCustom(false);
          onChange(e.target.value);
          onCommit(e.target.value);
        }}
        className={cn(field, "h-9", custom ? "w-32 shrink-0" : "")}>
        <option value="">No particular tone</option>
        {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        <option value="__custom">Custom…</option>
      </select>
      {custom ? (
        <input value={value} disabled={disabled} maxLength={100} autoFocus placeholder="e.g. cosy and nostalgic" aria-label="Custom tone"
          onChange={(e) => onChange(e.target.value)} onBlur={() => onCommit(value)} className={cn(field, "h-9")} />
      ) : null}
    </span>
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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
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
      <PronunciationList projectId={projectId} initial={kit?.pronunciations ?? []} canEdit={canEdit} onSaved={onSaved} />
      {canEdit ? (
        <BrandFromSite projectId={projectId} suggestion={suggestion} onChanged={onChanged}
          onApplied={(k) => { setV({ primary: k.primary, secondary: k.secondary, headingFont: k.headingFont, bodyFont: k.bodyFont, applied: true }); onSaved(k, true); }} />
      ) : null}
    </section>
  );
}

/** "Say it right": how the voiceover says brand words (TxtYa → Text Ya). Captions and on-screen text keep the
 *  written word. Saved for the workspace on blur / remove, used on the next render. */
function PronunciationList({ projectId, initial, canEdit, onSaved }: {
  projectId: string; initial: Pronunciation[]; canEdit: boolean; onSaved: (k: BrandKit) => void;
}) {
  const [rows, setRows] = useState<Pronunciation[]>(initial);
  const [busy, setBusy] = useState(false);
  const saved = useRef(JSON.stringify(initial));
  const save = async (next: Pronunciation[]) => {
    const clean = next.filter((r) => r.word.trim() && r.say.trim());
    if (JSON.stringify(clean) === saved.current) return;
    setBusy(true);
    try {
      const k = unwrap(await savePronunciations(projectId, clean));
      saved.current = JSON.stringify(k.pronunciations);
      onSaved(k);
    } catch (e) { toast.error((e as Error).message || "Couldn't save pronunciations."); }
    setBusy(false);
  };
  const set = (i: number, patch: Partial<Pronunciation>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium"><Mic className="size-3.5" /> Say it right</div>
      <p className="text-[11px] text-muted-foreground">
        How the voiceover should say your brand or product names. Captions and on-screen text keep the written word.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={r.word} maxLength={40} placeholder="Written (TxtYa)" aria-label="Written word" disabled={!canEdit || busy}
            onChange={(e) => set(i, { word: e.target.value })} onBlur={() => save(rows)} className={cn(field, "h-8")} />
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <input value={r.say} maxLength={80} placeholder="Say it as (Text Ya)" aria-label="Say it as" disabled={!canEdit || busy}
            onChange={(e) => set(i, { say: e.target.value })} onBlur={() => save(rows)} className={cn(field, "h-8")} />
          {canEdit ? (
            <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Remove" disabled={busy}
              onClick={() => { const next = rows.filter((_, k) => k !== i); setRows(next); save(next); }}>
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit && rows.length < MAX_PRONUNCIATIONS ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRows([...rows, { word: "", say: "" }])}>
          <Plus className="size-4" /> Add a word
        </Button>
      ) : null}
    </div>
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

function MediaSection({ projectId, assets, scenes, canEdit, onChange, unused, onAddScene }: {
  projectId: string; assets: DeckAsset[]; scenes: DeckScene[]; canEdit: boolean; onChange: () => void;
  /** Files the plan left out — offered as "add to the storyboard". */
  unused: DeckAsset[]; onAddScene: (assetId: string) => void;
}) {
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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {canEdit ? (
          <>
            <input ref={input} type="file" multiple accept="image/*,video/*,.insv,.insp,.lrv,.heic" className="hidden" onChange={(e) => upload(e.target.files)} />
            <Button variant="secondary" size="sm" className="w-full" disabled={!!uploading} onClick={() => input.current?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {uploading ? `${pct}%` : "Add photos & videos"}
            </Button>
          </>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">Add a note to any item and the AI follows it — &ldquo;hero shot, say it&apos;s organic&rdquo;, &ldquo;show this first&rdquo;, &ldquo;end on this&rdquo;. Put exact wording in quotes.</p>
      <ul className="space-y-2">
        {assets.map((a) => (
          <MediaRow key={a.id} projectId={projectId} asset={a} canEdit={canEdit} usedBy={scenes.filter((s) => s.assetId === a.id).length} onRemoved={onChange} />
        ))}
      </ul>
      {!assets.length ? <p className="text-xs text-muted-foreground">No media yet.</p> : null}
      {unused.length ? (
        <div className="space-y-1.5 rounded-lg border border-dashed border-border p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Not in the storyboard yet — tap to add at the end:</p>
          <div className="flex flex-wrap gap-1.5">
            {unused.map((a) => (
              <button key={a.id} type="button" onClick={() => onAddScene(a.id)} className="max-w-full truncate rounded-md border border-border px-2 py-0.5 text-[11px] hover:border-primary">+ {a.name}</button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MediaRow({ projectId, asset, canEdit, usedBy, onRemoved }: { projectId: string; asset: DeckAsset; canEdit: boolean; usedBy: number; onRemoved: () => void }) {
  const [note, setNote] = useState(asset.note ?? "");
  const [removing, setRemoving] = useState(false);
  const src = `/api/projects/${projectId}/assets/${asset.id}`;
  const remove = async () => {
    const scenes = !usedBy ? "No scene uses it" : usedBy === 1 ? "1 scene uses it and becomes a text card" : `${usedBy} scenes use it and become text cards`;
    if (!window.confirm(`Delete "${asset.name}" from this project? ${scenes}. The file stays in your media library.`)) return;
    setRemoving(true);
    try {
      unwrap(await deleteAsset(projectId, asset.id));
      toast.success("Removed from the project.");
      onRemoved();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete it.");
      setRemoving(false);
    }
  };
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-background/40 p-2" draggable={canEdit}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_ASSET, asset.id); e.dataTransfer.effectAllowed = "copy"; }}
      title={canEdit ? "Drag onto the timeline to add it as a scene there" : undefined}>
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
          {canEdit ? (
            <span className="ml-auto">
              <IconBtn label="Delete from project" disabled={removing} onClick={remove}>
                {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </IconBtn>
            </span>
          ) : null}
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
  usedBy, onMediaChanged, stacked = false, backdropSlot = null,
}: {
  projectId: string; scene: DeckScene; index: number; count: number; asset: DeckAsset | null; assets: DeckAsset[];
  aspectCss: string; wide: boolean; canEdit: boolean; brand: FrameBrand; voiceMode: VoiceMode; presentation: boolean;
  fill?: { status: string; progress: number; error: string | null }; credits: CreditBalance | null;
  onFill: (mode: "animate" | "generate", prompt?: string) => Promise<void>;
  onPatch: (p: ScenePatch) => void; onRewrite: (instruction: string) => void; onMove: (dir: -1 | 1) => void; onDelete: () => void; onAddAfter: () => void;
  usedBy: number; onMediaChanged: () => void;
  /** One column (the studio inspector) instead of thumbnail beside the fields. */
  stacked?: boolean;
  /** Backdrop picker (text-only scenes and media zoomed out below fill). */
  backdropSlot?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(scene.text.headline ?? "");
  const [sub, setSub] = useState(scene.text.sub ?? "");
  const [bullets, setBullets] = useState((scene.text.bullets ?? []).join("\n"));
  const mg = MOTION_FIELDS[scene.layout] ?? null; // animated layout: what its text fields mean
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
  // Say clearly when a rewrite lands (owner, 2026-10-05: "no message at all" — the result was a small grey word).
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      if (/^Rewritten/.test(scene.why ?? "")) toast.success(`Scene ${index + 1} rewritten — check the new words.`);
      else if (/^Couldn't/.test(scene.why ?? "")) toast.error(scene.why ?? "Couldn't rewrite this scene.");
      else if (/^No change/.test(scene.why ?? "")) toast.message(scene.why ?? "No change.");
    }
    wasBusy.current = busy;
  }, [busy, scene.why, index]);
  const rewritten = !busy && /^Rewritten/.test(scene.why ?? "");
  const textOff = scene.textMode === "none";
  return (
    <article className={cn("rounded-xl border bg-card p-3", scene.locked ? "border-[color:var(--cw-violet)]/60" : "border-border")}>
      <div className={cn("grid gap-3", stacked ? "" : wide ? "sm:grid-cols-[180px_minmax(0,1fr)]" : "sm:grid-cols-[110px_minmax(0,1fr)]")}>
        <div className={cn("space-y-1.5", stacked && !wide && "mx-auto w-full max-w-[200px]")}>
          {asset && canEdit ? (
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit this scene's media" title="Edit media — crop, reposition, rotate, choose the part"
              className="block w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <SceneFrame projectId={projectId} scene={{ ...scene, text: { headline, sub, bullets: bullets.split("\n").filter(Boolean) } }} asset={asset} aspectCss={aspectCss} startAt={scene.inSec} brand={brand} />
            </button>
          ) : (
            <SceneFrame projectId={projectId} scene={{ ...scene, text: { headline, sub, bullets: bullets.split("\n").filter(Boolean) } }} asset={asset} aspectCss={aspectCss} startAt={scene.inSec} brand={brand} />
          )}
          {asset && canEdit ? (
            <Button type="button" variant="secondary" size="sm" className="w-full" onClick={() => setEditing(true)}>
              <Crop className="size-3.5" /> Edit media
            </Button>
          ) : null}
        </div>
        {editing && asset ? (
          <SceneMediaDialog projectId={projectId} scene={scene} asset={asset} aspectCss={aspectCss} wide={wide} brand={brand} usedBy={usedBy}
            onClose={() => setEditing(false)} onSaved={onMediaChanged} />
        ) : null}
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
            <select value={scene.motion} disabled={!canEdit} onChange={(e) => onPatch({ motion: e.target.value })} className="h-7 rounded-md border border-border bg-background px-1.5" title="Camera move for this scene (dynamic camera)">
              {MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
            </select>
            {voiceMode !== "off" ? (
              <select value={scene.captionPosition ?? ""} disabled={!canEdit} aria-label="Where this scene's voiceover captions show"
                onChange={(e) => onPatch({ captionPosition: (e.target.value || null) as "top" | "bottom" | null })}
                className="h-7 rounded-md border border-border bg-background px-1.5" title="Where this scene's voiceover words show">
                <option value="">Captions: Deck default</option>
                <option value="top">Captions: Top</option>
                <option value="bottom">Captions: Bottom</option>
              </select>
            ) : null}
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
              <input value={headline} disabled={!canEdit || busy} onChange={(e) => setHeadline(e.target.value)} onBlur={commitText} maxLength={90}
                placeholder={mg?.headline ?? "Headline"} aria-label={mg?.headline ?? "Headline"} className={cn(field, "h-8 font-semibold")} />
              {!mg || mg.sub ? (
                <input value={sub} disabled={!canEdit || busy} onChange={(e) => setSub(e.target.value)} onBlur={commitText} maxLength={140}
                  placeholder={mg?.sub ?? "Subline (optional)"} aria-label={mg?.sub ?? "Subline"} className={cn(field, "h-8")} />
              ) : null}
              {scene.layout === "bullets" || scene.layout === "slide" || mg?.bullets ? (
                <textarea value={bullets} disabled={!canEdit || busy} onChange={(e) => setBullets(e.target.value)} onBlur={commitText} rows={mg ? 4 : 3}
                  placeholder={mg?.bullets ?? `One point per line (up to ${MAX_BULLETS})`} aria-label={mg?.bullets ?? "Points"} className={cn(field, "py-1.5 text-xs")} />
              ) : null}
              {mg && asset && mg.media === "ignored" ? (
                <p className="text-[11px] text-muted-foreground">This animated layout draws its own picture — the scene&apos;s media isn&apos;t shown.</p>
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
              <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) { onRewrite(ask.trim()); setAsk(""); } }} className="flex basis-full items-end gap-1.5">
                {/* Owner request 2026-10-05: bigger and resizable (drag the corner). Enter sends, Shift+Enter = new line. */}
                <textarea value={ask} disabled={!canEdit || busy} onChange={(e) => setAsk(e.target.value)} maxLength={600} rows={3}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (ask.trim()) { onRewrite(ask.trim()); setAsk(""); } } }}
                  placeholder="Tell the AI what to change in this scene…" aria-label="Tell the AI what to change in this scene"
                  className={cn(field, "max-h-[40vh] min-h-[4.5rem] resize-y py-1.5 text-xs")} />
                <Button type="submit" size="sm" disabled={!canEdit || busy || !ask.trim()} title="Rewrite this scene">
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                </Button>
              </form>
            ) : null}
            <select value={scene.assetId ?? ""} disabled={!canEdit} onChange={(e) => onPatch({ assetId: e.target.value || null })} className="h-7 max-w-[160px] rounded-md border border-border bg-background px-1.5 text-[11px]" title="Media">
              <option value="">Text card (no media)</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {backdropSlot ? (
            <Fold title="Backdrop" value={scene.background ? (scene.background.style === "ai" ? "AI image" : BACKDROP_LABEL[scene.background.style] ?? "") : "Deck default"}>
              {backdropSlot}
            </Fold>
          ) : null}
          <AiFill sceneSec={scene.durationSec} hasPhoto={asset?.kind === "photo"} fill={fill} credits={credits} canEdit={canEdit} onFill={onFill}
            defaultPrompt={scene.prompt || [scene.text.headline, scene.text.sub].filter(Boolean).join(" — ")} />
          {scene.why ? (
            <p className={cn("flex items-center gap-1 text-[11px]", /^Couldn't/.test(scene.why) && !busy ? "font-medium text-destructive"
              : rewritten ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : /^Couldn't/.test(scene.why) ? <Info className="size-3" />
                : rewritten ? <CheckCircle2 className="size-3.5" /> : <Sparkles className="size-3" />} {scene.why}
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

/** A collapsible group in the brief (keeps the panel short; the summary shows the current choice). */
function Fold({ title, value, children }: { title: string; value: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <span className="ml-auto truncate font-normal text-muted-foreground">{value}</span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-2 px-2.5 pb-2.5">{children}</div>
    </details>
  );
}

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** The studio stage: the selected scene with its text, played scene by scene (instant, low-res, no music). */
function DeckStage({ projectId, scenes, assets, aspect, aspectCss, brand, cameraMode, index, onIndex, onPresent }: {
  projectId: string; scenes: DeckScene[]; assets: Map<string, DeckAsset>; aspect: string; aspectCss: string; brand: FrameBrand;
  cameraMode?: CameraMode; index: number; onIndex: (i: number) => void; onPresent: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const cur = scenes[Math.min(index, scenes.length - 1)];
  // The timer depends only on which scene plays and for how long, so a parent re-render (polling, typing) never
  // restarts it; the latest onIndex is read through a ref.
  const onIndexRef = useRef(onIndex);
  useEffect(() => { onIndexRef.current = onIndex; });
  const curId = cur?.id, curDur = cur?.durationSec ?? 0;
  useEffect(() => {
    if (!playing || !curId) return;
    const t = setTimeout(() => {
      if (index + 1 < scenes.length) onIndexRef.current(index + 1);
      else setPlaying(false);
    }, curDur * 1000);
    return () => clearTimeout(t);
  }, [playing, index, curId, curDur, scenes.length]);
  if (!cur) return null;
  const asset = cur.assetId ? assets.get(cur.assetId) ?? null : null;
  const start = scenes.slice(0, index).reduce((n, s) => n + s.durationSec, 0);
  const total = scenes.reduce((n, s) => n + s.durationSec, 0);
  const ar = aspectNumber(aspect);
  return (
    <>
      {/* The frame fits the pane both ways: its width is the smaller of the pane width and pane height × aspect. */}
      <div className="grid min-h-0 flex-1 place-items-center p-3 [container-type:size] max-lg:min-h-[18rem]">
        <div style={{ width: `min(100cqw, calc(100cqh * ${ar}))` }}>
          <SceneFrame key={`${cur.id}-${index}`} projectId={projectId} scene={cur} asset={asset} aspectCss={aspectCss} playing={playing} startAt={cur.inSec} brand={brand}
            cameraMode={cameraMode} durationSec={cur.durationSec} move={pickMove(cur, asset?.seen ?? "", cameraMode, index, !!asset)} className="shadow-2xl" />
        </div>
      </div>
      {!asset && cur.assetId ? <p className="flex items-center justify-center gap-1 pb-1 text-xs text-muted-foreground"><ImageIcon className="size-3" /> This scene&apos;s file was removed.</p> : null}
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2">
        <IconBtn label="Previous scene" disabled={index === 0} onClick={() => { setPlaying(false); onIndex(index - 1); }}><SkipBack className="size-4" /></IconBtn>
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}
          className="grid size-8 place-items-center rounded-full bg-foreground text-background hover:opacity-90">
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
        <IconBtn label="Next scene" disabled={index >= scenes.length - 1} onClick={() => { setPlaying(false); onIndex(index + 1); }}><SkipForward className="size-4" /></IconBtn>
        <IconBtn label="Play from the start" onClick={() => { onIndex(0); setPlaying(true); }}><RotateCcw className="size-4" /></IconBtn>
        <span className="font-mono text-xs tabular-nums text-muted-foreground"><span className="text-foreground">{fmtSec(start)}</span> / {fmtSec(total)}</span>
        <div className="mx-2 flex h-1.5 min-w-0 flex-1 gap-0.5">
          {scenes.map((s, k) => (
            <button key={s.id} type="button" aria-label={`Go to scene ${k + 1}`} onClick={() => { setPlaying(false); onIndex(k); }}
              style={{ flexGrow: s.durationSec }} className={cn("h-full rounded-full", k === index ? "bg-[color:var(--cw-blue)]" : k < index ? "bg-foreground/40" : "bg-muted")} />
          ))}
        </div>
        <span className="hidden rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground xl:inline">instant · low-res · no music</span>
        <IconBtn label="Present full screen" onClick={onPresent}><Presentation className="size-4" /></IconBtn>
      </div>
    </>
  );
}

/** The studio timeline: scenes as blocks sized by their length, with the narration lane under them. */
const DRAG_SCENE = "application/x-cw-scene";
const DRAG_ASSET = "application/x-cw-asset";
const GAP = 14; // px between timeline blocks (each gap is an insert point)

function SceneStrip({ projectId, scenes, assets, brand, sel, onSelect, canEdit, voiceOn, total, targetSec, assetList, aiWrites, onAiWrites, hasCta, onInsert, onMove }: {
  projectId: string; scenes: DeckScene[]; assets: Map<string, DeckAsset>; brand: FrameBrand; sel: string | null; onSelect: (id: string) => void;
  canEdit: boolean; voiceOn: boolean; total: number; targetSec: number;
  assetList: DeckAsset[]; aiWrites: boolean; onAiWrites: (v: boolean) => void; hasCta: boolean;
  onInsert: (at: number, spec: NewScene) => void; onMove: (sceneId: string, gap: number) => void;
}) {
  const [pps, setPps] = useState(22); // pixels per second
  const [dragging, setDragging] = useState<string | null>(null); // scene being dragged
  const width = (d: number) => Math.max(88, d * pps);
  // Ticks only over the planned seconds (past the last scene there is no block to place them on).
  const ticks: number[] = [];
  for (let s = 0; s <= total; s += 5) ticks.push(s);
  const rulerW = GAP + scenes.reduce((n, s) => n + width(s.durationSec) + GAP, 0) + 96;
  const menu = (at: number) => (
    <InsertMenu at={at} count={scenes.length} assets={assetList} aiWrites={aiWrites} onAiWrites={onAiWrites} hasCta={hasCta}
      prev={scenes[at - 1] ?? null} next={scenes[at] ?? null} onInsert={onInsert} />
  );
  const drop = (at: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const sceneId = e.dataTransfer.getData(DRAG_SCENE);
    const assetId = e.dataTransfer.getData(DRAG_ASSET);
    setDragging(null);
    if (sceneId) onMove(sceneId, at);
    else if (assetId) onInsert(at, { kind: "media", assetId, write: aiWrites });
  };
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Timeline</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {scenes.length} scene{scenes.length === 1 ? "" : "s"} · {total.toFixed(1)}s of {targetSec}s
        </span>
        {canEdit && scenes.length ? (
          <span className="hidden text-[11px] text-muted-foreground lg:inline">Press + between scenes to add one there · drag a scene or a file onto a gap</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && scenes.length ? (
            <InsertMenu at={scenes.length} count={scenes.length} assets={assetList} aiWrites={aiWrites} onAiWrites={onAiWrites} hasCta={hasCta}
              prev={scenes[scenes.length - 1] ?? null} next={null} onInsert={onInsert}
              trigger={<Button size="sm" variant="ghost" />} label={<><Plus className="size-3.5" /> Add scene</>} />
          ) : null}
          <label htmlFor="deck-zoom" className="text-[11px] text-muted-foreground">Zoom</label>
          <input id="deck-zoom" type="range" min={10} max={48} value={pps} onChange={(e) => setPps(Number(e.target.value))} className="w-20" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {scenes.length ? (
          <div className="grid w-max grid-cols-[4.5rem_auto] text-[11px]">
            <div className="h-5 border-b border-border" />
            <div className="relative h-5 border-b border-border font-mono text-[10px] text-muted-foreground" style={{ width: rulerW }}>
              {/* Seconds are spread over the real scene widths, so the ticks line up with the blocks. */}
              {ticks.map((s) => <span key={s} className="absolute top-0.5 -translate-x-0" style={{ left: xAt(scenes, s, width) }}>{fmtSec(s).replace(/\.0$/, "")}</span>)}
            </div>
            <div className="flex items-center gap-1.5 border-b border-border px-2 text-muted-foreground"><b className="rounded border border-border px-1 font-mono text-[10px] text-foreground">V1</b>Scenes</div>
            <div className="flex border-b border-border py-1.5">
              {scenes.map((s, i) => {
                const a = s.assetId ? assets.get(s.assetId) ?? null : null;
                return (
                  <Fragment key={s.id}>
                    {canEdit ? <InsertGap at={i} menu={menu(i)} onDrop={drop(i)} dragging={dragging} blocked={dragging === s.id || dragging === scenes[i - 1]?.id} /> : <span style={{ width: GAP }} className="shrink-0" />}
                    <button type="button" onClick={() => onSelect(s.id)} aria-pressed={sel === s.id} title={s.text.headline || `Scene ${i + 1}`}
                      draggable={canEdit}
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG_SCENE, s.id); e.dataTransfer.effectAllowed = "move"; setDragging(s.id); }}
                      onDragEnd={() => setDragging(null)}
                      style={{ width: width(s.durationSec) }}
                      className={cn("relative h-16 shrink-0 overflow-hidden rounded-md border text-left [container-type:size]",
                        dragging === s.id && "opacity-40",
                        sel === s.id ? "border-[color:var(--cw-violet)] ring-2 ring-[color:var(--cw-violet)]/60" : "border-white/10 hover:border-white/30")}>
                      <SceneThumb projectId={projectId} asset={a} scene={s} brand={brand} />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 font-mono text-[9.5px] text-white">{i + 1} · {s.durationSec}s</span>
                      {s.locked ? <Lock className="absolute right-1 top-1 size-3 text-white drop-shadow" /> : null}
                      {s.why === "Rewriting…" ? <Loader2 className="absolute right-1 bottom-6 size-3 animate-spin text-white drop-shadow" /> : null}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-[10.5px] font-semibold text-white">
                        {s.text.headline || (a ? a.name : "Text card")}
                      </span>
                    </button>
                  </Fragment>
                );
              })}
              {canEdit ? (
                <InsertGap at={scenes.length} menu={menu(scenes.length)} onDrop={drop(scenes.length)} dragging={dragging} blocked={dragging === scenes[scenes.length - 1]?.id} end />
              ) : null}
            </div>
            {voiceOn ? (
              <>
                <div className="flex items-center gap-1.5 border-b border-border px-2 text-muted-foreground"><b className="rounded border border-border px-1 font-mono text-[10px] text-foreground">A1</b>Voice</div>
                <div className="flex border-b border-border py-1" style={{ paddingLeft: GAP }}>
                  {scenes.map((s) => (
                    <button key={s.id} type="button" onClick={() => onSelect(s.id)} style={{ width: width(s.durationSec), marginRight: GAP }}
                      className="h-7 shrink-0 overflow-hidden rounded px-1.5 text-left">
                      {s.voice ? (
                        <span className="block h-full truncate rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10.5px] leading-7 text-emerald-200">{s.voice}</span>
                      ) : <span className="block h-full rounded border border-dashed border-border px-1.5 text-[10.5px] leading-7 text-muted-foreground">silent</span>}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : <p className="p-4 text-xs text-muted-foreground">The storyboard appears here once it&apos;s planned — one block per scene, sized by its length.</p>}
      </div>
    </>
  );
}

/**
 * An insert point on the timeline: a slim gap that shows a + on hover (opens the add menu), widens into a drop zone
 * while a scene or a media file is dragged over it. The `end` one is a visible "Add" tile.
 */
function InsertGap({ at, menu, onDrop, dragging, blocked, end = false }: {
  at: number; menu: ReactNode; onDrop: (e: React.DragEvent) => void; dragging: string | null; blocked: boolean; end?: boolean;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: React.DragEvent) => !blocked && (e.dataTransfer.types.includes(DRAG_SCENE) || e.dataTransfer.types.includes(DRAG_ASSET));
  return (
    <div data-gap={at}
      onDragOver={(e) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_SCENE) ? "move" : "copy"; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e); }}
      style={{ width: over ? 64 : end ? 84 : GAP }}
      className={cn("group/gap relative flex h-16 shrink-0 items-center justify-center transition-[width] duration-150",
        over && "rounded-md border-2 border-dashed border-[color:var(--cw-violet)] bg-[color:var(--cw-violet)]/10",
        end && !over && "ml-[2px] rounded-md border border-dashed border-border hover:border-[color:var(--cw-violet)]",
        dragging && !blocked && !over && !end && "bg-[color:var(--cw-violet)]/10")}>
      {!end && !over ? <span className="pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-[color:var(--cw-violet)] opacity-0 group-hover/gap:opacity-60" /> : null}
      {over ? <span className="text-[10px] font-medium text-[color:var(--cw-violet)]">{dragging ? "Move here" : "Add here"}</span> : menu}
    </div>
  );
}

/** The "add a scene here" menu. `at` = where it goes (0 = start, count = end). */
function InsertMenu({ at, count, assets, aiWrites, onAiWrites, hasCta, prev, next, onInsert, trigger, label }: {
  at: number; count: number; assets: DeckAsset[]; aiWrites: boolean; onAiWrites: (v: boolean) => void; hasCta: boolean;
  prev: DeckScene | null; next: DeckScene | null; onInsert: (at: number, spec: NewScene) => void;
  /** Custom trigger element (default: the round + of a gap / the end tile). */
  trigger?: React.ReactElement; label?: ReactNode;
}) {
  const where = at === 0 ? "at the start" : at >= count ? "at the end" : `between scene ${at} and ${at + 1}`;
  const add = (spec: NewScene) => onInsert(at, spec);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Add a scene ${where}`} title={`Add a scene ${where}`}
        render={trigger ?? (
          <button type="button" className={cn("flex items-center justify-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-primary",
            at >= count ? "h-full w-full gap-1 rounded-md bg-transparent text-[11px] font-medium text-muted-foreground hover:text-foreground"
              : "z-10 size-5 bg-[color:var(--cw-violet)] opacity-0 shadow group-hover/gap:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100")} />
        )}>
        {label ?? (at >= count ? <><Plus className="size-3.5" /> Add</> : <Plus className="size-3" />)}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">Add a scene {where}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem onClick={() => add({ kind: "title", write: aiWrites })}><Type className="size-4" /> Title card</DropdownMenuItem>
        <DropdownMenuItem onClick={() => add({ kind: "slide", write: aiWrites })}><ListChecks className="size-4" /> Slide — title + points</DropdownMenuItem>
        <DropdownMenuItem onClick={() => add({ kind: "cta", write: aiWrites && !hasCta })}><Megaphone className="size-4" /> Call to action</DropdownMenuItem>
        {assets.length ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Film className="size-4" /> Photo or video</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-60">
              {assets.map((a) => (
                <DropdownMenuItem key={a.id} onClick={() => add({ kind: "media", assetId: a.id, write: aiWrites })}>
                  {a.kind === "video" ? <Film className="size-4" /> : <ImageIcon className="size-4" />}
                  <span className="truncate">{a.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {prev || next ? <DropdownMenuSeparator /> : null}
        {prev ? <DropdownMenuItem onClick={() => add({ kind: "duplicate", sceneId: prev.id })}><Copy className="size-4" /> Copy scene {at} here</DropdownMenuItem> : null}
        {next ? <DropdownMenuItem onClick={() => add({ kind: "duplicate", sceneId: next.id })}><Copy className="size-4" /> Copy scene {at + 1} here</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={aiWrites} onCheckedChange={(v) => onAiWrites(!!v)}>
          <Sparkles className="size-4" /> AI writes the words
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pixel position of second `t` along the strip (each scene's block covers its own seconds, after its gap). */
function xAt(scenes: DeckScene[], t: number, width: (d: number) => number) {
  let x = GAP, acc = 0;
  for (const s of scenes) {
    if (t <= acc + s.durationSec) return x + ((t - acc) / s.durationSec) * width(s.durationSec);
    x += width(s.durationSec) + GAP;
    acc += s.durationSec;
  }
  return x;
}

/** Small picture for a timeline block: the scene's photo / video frame, or its brand colours for a text card. */
function SceneThumb({ projectId, asset, scene, brand }: { projectId: string; asset: DeckAsset | null; scene: DeckScene; brand: FrameBrand }) {
  if (!asset) return <Backdrop backdrop={scene.backdrop} brand={brand} aspect={2.5} zone="center" />;
  const src = `/api/projects/${projectId}/assets/${asset.id}`;
  return asset.kind === "video"
    ? <video src={`${src}#t=${Math.max(0.1, scene.inSec ?? 0.5)}`} muted preload="metadata" className="absolute inset-0 size-full object-cover" style={rotatedFill(asset.rotation)} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={src} alt="" className="absolute inset-0 size-full object-cover" style={rotatedFill(asset.rotation)} />;
}
