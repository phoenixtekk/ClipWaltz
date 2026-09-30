"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film, Ratio, Sparkles, Layers, Music, Wand2, Clapperboard, Bookmark, Upload, MousePointerClick, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudioShell, StudioPanel, type StudioTab, type StudioStep } from "@/components/studio/studio-shell";
import type { ProjectDetail } from "@/lib/projects";
import type { AssetSummary } from "@/lib/assets";
import type { Track } from "@/lib/music";
import type { RenderStatus, RenderHistoryItem } from "@/lib/render";
import type { Preset } from "@/lib/presets";
import { RenderHistory } from "@/components/render-history";
import { PresetBar } from "@/components/preset-bar";
import { ProjectEditor } from "@/components/project-editor";
import { ProjectTimeline } from "@/components/project-timeline";
import { ClipInspector } from "@/components/clip-inspector";
import { TitleCaptionField } from "@/components/title-caption-field";
import { OverlayEditor } from "@/components/overlay-editor";
import { DraftPreview } from "@/components/draft-preview";
import { RenderPanel } from "@/components/render-panel";
import { MusicPanel } from "@/components/music-panel";
import { GenerationPanel } from "@/components/generation-panel";
import { DriveBackupButton } from "@/components/drive-backup-button";
import type { GenerationSettings } from "@/lib/generation-settings";
import { NewProjectButton } from "@/components/new-project-button";

type Tab = "clips" | "format" | "style" | "overlays" | "generate" | "music" | "render";
const TABS: StudioTab<Tab>[] = [
  { key: "clips", label: "Clips", icon: <Film className="size-4" /> },
  { key: "format", label: "Format", icon: <Ratio className="size-4" /> },
  { key: "style", label: "Style", icon: <Sparkles className="size-4" /> },
  { key: "overlays", label: "Overlays", icon: <Layers className="size-4" /> },
  { key: "generate", label: "Waltz AI", icon: <Wand2 className="size-4" /> },
  { key: "music", label: "Music", icon: <Music className="size-4" /> },
  { key: "render", label: "Render", icon: <Clapperboard className="size-4" /> },
];

// Remount the inspector whenever the saved clip changes (timeline trim, a save, a refresh) so its
// form state is re-seeded from the server values.
const clipKey = (a: AssetSummary) =>
  `${a.id}:${a.rotation}:${a.trimStart}:${a.trimEnd}:${a.durationOverride}:${a.reframeMode}:${(a.tags ?? []).join(",")}`;

/**
 * AutoWaltz editor on the one-screen studio (StudioShell): section tabs drive the left panel, the
 * draft preview fills the stage, the selected timeline clip's settings sit in the inspector and the
 * timeline runs along the bottom. `readOnly` (viewers, ADR-0004) disables every edit control
 * natively via fieldsets; tabs, players and download links still work. The server rejects edits regardless.
 */
export function EditorWorkspace({
  projectId,
  project,
  presets,
  assets,
  tracks,
  favorites,
  latestRender,
  renders,
  contest,
  musicTrackTitle,
  backdropAssetId,
  initialTab,
  templateSettings,
  readOnly = false,
}: {
  projectId: string;
  project: ProjectDetail;
  presets: Preset[];
  assets: AssetSummary[];
  tracks: Track[];
  favorites: string[];
  latestRender: RenderStatus;
  renders: RenderHistoryItem[];
  contest: { theme: string; entered: boolean } | null;
  musicTrackTitle: string | null;
  backdropAssetId: string | null;
  initialTab?: Tab;
  templateSettings?: GenerationSettings | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab ?? "clips");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = assets.find((a) => a.id === selectedId) ?? null; // gone once the clip is removed

  const editorProps = {
    projectId,
    assets,
    lengthSec: project.lengthSec,
    aspect: project.aspect,
    styleFilter: project.styleFilter,
    lightFx: project.lightFx,
    transition: project.transition,
    motion: project.motion,
    fades: project.fades,
    fadeOut: project.fadeOut,
    smartCut: project.smartCut,
    beatSync: project.beatSync,
    waltzToMusic: project.waltzToMusic,
    describe: project.describe,
    postTopic: project.postTopic,
    postTemplate: project.postTemplate,
    originalAudio: project.originalAudio,
    musicVolume: project.musicVolume,
    originalVolume: project.originalVolume,
    loopToFill: project.loopToFill,
    maxFootage: project.maxFootage,
    hasRender: !!latestRender?.hasOutput,
  };

  const clipCount = `${assets.length} clip${assets.length === 1 ? "" : "s"}`;
  const uploaded = assets.filter((a) => a.uploadState === "uploaded");
  const videos = uploaded.filter((a) => a.kind === "video").length;
  const converting = uploaded.filter((a) => a.sourceFormat && a.conversionState !== "ready" && a.conversionState !== "failed").length;
  const rendered = !!latestRender?.hasOutput;

  const steps: StudioStep[] = [
    { label: "Upload footage", hint: clipCount, state: assets.length ? "done" : "current", onClick: () => router.push(`/projects/${projectId}/import`) },
    { label: "Edit", hint: "Clips, style & music", state: "current" },
    { label: "Render", hint: rendered ? `v${latestRender?.version} ready` : "Render HD", state: rendered ? "done" : "todo", onClick: () => setTab("render") },
    { label: "Share", hint: rendered ? "Download or post" : "After the render", state: rendered ? "done" : "todo", onClick: () => setTab("render") },
  ];

  // The left panel follows the section tab. Waltz AI and Render stay mounted (hidden when not shown) so a running
  // job or render keeps polling and its progress survives a tab switch; the other panels are cheap to re-mount.
  const kept = (k: Tab, panel: React.ReactNode) => (
    <div className={tab === k ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{panel}</div>
  );
  const shown = (() => {
    switch (tab) {
      case "clips":
        return (
          <StudioPanel title="Clips">
            <div className="space-y-4">
              <TitleCaptionField projectId={projectId} initialTitle={project.titleText} />
              <ProjectEditor section="clips" {...editorProps} />
            </div>
          </StudioPanel>
        );
      case "format":
        return <StudioPanel title="Format"><ProjectEditor section="format" {...editorProps} /></StudioPanel>;
      case "style":
        return <StudioPanel title="Style"><ProjectEditor section="style" {...editorProps} /></StudioPanel>;
      case "overlays":
        return (
          <StudioPanel title="Overlays">
            <OverlayEditor
              projectId={projectId}
              initialOverlays={project.overlays}
              aspect={project.aspect}
              backdropAssetId={backdropAssetId}
              lengthSec={project.lengthSec}
            />
          </StudioPanel>
        );
      case "music":
        return (
          <StudioPanel title="Music">
            <MusicPanel projectId={projectId} tracks={tracks} musicTrackId={project.musicTrackId} favorites={favorites} embedded />
          </StudioPanel>
        );
      default:
        return null;
    }
  })();
  const left = (
    <>
      {shown}
      {kept("generate", (
        <StudioPanel title="Waltz AI">
          <GenerationPanel
            projectId={projectId}
            photos={uploaded.filter((a) => a.kind === "photo")}
            templateSettings={templateSettings}
          />
        </StudioPanel>
      ))}
      {kept("render", (
        <StudioPanel
          title="Render"
          footer={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/projects/${projectId}/import`} />}>
                ← Back to import
              </Button>
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/projects" />}>
                Save &amp; exit
              </Button>
              <span className="ml-auto"><NewProjectButton size="sm" /></span>
            </div>
          }
        >
          <div className="space-y-4">
            <RenderPanel projectId={projectId} initial={latestRender} canRender={assets.length > 0} contest={contest} title={project.title} />
            <RenderHistory renders={renders} />
          </div>
        </StudioPanel>
      ))}
    </>
  );

  return (
    <StudioShell
      kind="AutoWaltz"
      title={project.title}
      subtitle={`${clipCount} · ${project.template} · ${project.aspect}`}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      tools={
        <>
          {readOnly ? (
            <span role="status" title="You're a viewer in this workspace. Ask an admin for editor access to make changes." className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              <Eye className="size-3.5" /> View only
            </span>
          ) : null}
          <fieldset disabled={readOnly} className="contents">
            <PresetsPopover projectId={projectId} presets={presets} />
          </fieldset>
          <Button size="sm" onClick={() => setTab("render")}>
            <Clapperboard className="size-4" /> Render HD
          </Button>
        </>
      }
      // `@container`: panel content lays out by the panel's width (narrow at lg+, full width when stacked).
      left={<fieldset disabled={readOnly} className="contents"><div className="@container flex min-h-0 flex-1 flex-col">{left}</div></fieldset>}
      stage={
        <fieldset disabled={readOnly} className="contents">
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <DraftPreview
              projectId={projectId}
              assets={assets}
              musicTrackId={project.musicTrackId}
              musicTrackTitle={musicTrackTitle}
              lengthSec={project.lengthSec}
              aspect={project.aspect}
              loopToFill={project.loopToFill}
              fill
            />
          </div>
        </fieldset>
      }
      inspector={
        <StudioPanel
          title={selected ? `Clip ${assets.indexOf(selected) + 1} of ${assets.length}` : "Clip"}
        >
          {selected ? (
            <fieldset disabled={readOnly} className="contents">
              <ClipInspector
                key={clipKey(selected)}
                projectId={projectId}
                asset={selected}
                onSaved={() => router.refresh()}
                onClose={() => setSelectedId(null)}
              />
            </fieldset>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center text-muted-foreground">
              <MousePointerClick className="size-6" />
              <p className="text-sm font-medium text-foreground">No clip selected</p>
              <p className="text-xs">Click a clip on the timeline to preview it, trim it, set its screen time, turn it upright or tag it.</p>
            </div>
          )}
        </StudioPanel>
      }
      bottomLeft={
        <StudioPanel title="Footage">
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{videos}</span> video{videos === 1 ? "" : "s"} ·{" "}
              <span className="font-medium">{uploaded.length - videos}</span> photo{uploaded.length - videos === 1 ? "" : "s"}
              {converting ? <span className="block text-xs text-muted-foreground">{converting} 360 clip{converting === 1 ? "" : "s"} converting…</span> : null}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Music className="size-3.5 shrink-0" />
              <span className="truncate">{musicTrackTitle ?? "No music yet"}</span>
            </p>
            <fieldset disabled={readOnly} className="contents">
              <DriveBackupButton projectId={projectId} total={uploaded.length} backedUp={uploaded.filter((a) => a.driveBackedUp).length} />
            </fieldset>
            <Button variant="outline" size="sm" className="w-full" nativeButton={false} render={<Link href={`/projects/${projectId}/import`} />}>
              <Upload className="size-4" /> Add footage
            </Button>
          </div>
        </StudioPanel>
      }
      bottom={
        <fieldset disabled={readOnly} className="contents">
          <ProjectTimeline projectId={projectId} assets={assets} selectedId={selectedId} onSelect={setSelectedId} />
        </fieldset>
      }
      steps={steps}
    />
  );
}

/** Top-bar "Presets" toggle: the preset bar in a small popover (click outside / Escape closes it). */
function PresetsPopover({ projectId, presets }: { projectId: string; presets: Preset[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <Bookmark className="size-4" /> Presets
      </Button>
      {open ? (
        <div role="dialog" aria-label="Presets" className="absolute right-0 top-full z-50 mt-2 w-[min(36rem,calc(100vw-2rem))] rounded-2xl bg-background/95 shadow-2xl">
          <PresetBar projectId={projectId} presets={presets} />
        </div>
      ) : null}
    </div>
  );
}
