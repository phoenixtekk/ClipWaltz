"use client";
import { useState } from "react";
import Link from "next/link";
import { ListVideo, Film, Ratio, Sparkles, Layers, Music, Wand2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "@/lib/projects";
import type { AssetSummary } from "@/lib/assets";
import type { Track } from "@/lib/music";
import type { RenderStatus, RenderHistoryItem } from "@/lib/render";
import type { Preset } from "@/lib/presets";
import { RenderHistory } from "@/components/render-history";
import { PresetBar } from "@/components/preset-bar";
import { ProjectEditor } from "@/components/project-editor";
import { ProjectTimeline } from "@/components/project-timeline";
import { TitleCaptionField } from "@/components/title-caption-field";
import { OverlayEditor } from "@/components/overlay-editor";
import { DraftPreview } from "@/components/draft-preview";
import { RenderPanel } from "@/components/render-panel";
import { MusicPanel } from "@/components/music-panel";
import { GenerationPanel } from "@/components/generation-panel";
import type { GenerationSettings } from "@/lib/generation-settings";
import { NewProjectButton } from "@/components/new-project-button";

type Tab = "timeline" | "clips" | "format" | "style" | "overlays" | "generate";
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "timeline", label: "Timeline", icon: <ListVideo className="size-4" /> },
  { key: "clips", label: "Clips", icon: <Film className="size-4" /> },
  { key: "format", label: "Format", icon: <Ratio className="size-4" /> },
  { key: "style", label: "Style", icon: <Sparkles className="size-4" /> },
  { key: "overlays", label: "Overlays", icon: <Layers className="size-4" /> },
  { key: "generate", label: "Waltz AI", icon: <Wand2 className="size-4" /> },
];

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
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "timeline");

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

  return (
    <div className="mx-auto w-full max-w-[110rem] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">{project.title}</h1>
          <p className="text-sm text-muted-foreground">
            {assets.length} clip{assets.length === 1 ? "" : "s"} · template: {project.template} · {project.aspect}
          </p>
        </div>
        <NewProjectButton />
      </div>

      <PresetBar projectId={projectId} presets={presets} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
        {/* main column */}
        <div className="space-y-6">
          {/* draft preview — scrolls with the page (not pinned) so it moves out of view as you
              scroll down to the editing tabs / render panel. */}
          <div className="space-y-6">
          <div className="cw-glass rounded-2xl p-4">
            <DraftPreview
              projectId={projectId}
              assets={assets}
              musicTrackId={project.musicTrackId}
              musicTrackTitle={musicTrackTitle}
              lengthSec={project.lengthSec}
              aspect={project.aspect}
              loopToFill={project.loopToFill}
            />
          </div>

          {/* tabbed workspace */}
          <div className="cw-glass rounded-2xl p-3">
            <div className="mb-3 flex flex-wrap gap-1 rounded-xl bg-muted/40 p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    tab === t.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>

            <div>
              {tab === "timeline" ? (
                <div className="space-y-4">
                  <TitleCaptionField projectId={projectId} initialTitle={project.titleText} />
                  <ProjectTimeline projectId={projectId} assets={assets} />
                </div>
              ) : null}
              {tab === "clips" ? <ProjectEditor section="clips" {...editorProps} /> : null}
              {tab === "format" ? <ProjectEditor section="format" {...editorProps} /> : null}
              {tab === "style" ? <ProjectEditor section="style" {...editorProps} /> : null}
              {tab === "overlays" ? (
                <OverlayEditor
                  projectId={projectId}
                  initialOverlays={project.overlays}
                  aspect={project.aspect}
                  backdropAssetId={backdropAssetId}
                  lengthSec={project.lengthSec}
                />
              ) : null}
              {tab === "generate" ? (
                <GenerationPanel
                  projectId={projectId}
                  photos={assets.filter((a) => a.kind === "photo" && a.uploadState === "uploaded")}
                  templateSettings={templateSettings}
                />
              ) : null}
            </div>
          </div>
          </div>

          <RenderPanel projectId={projectId} initial={latestRender} canRender={assets.length > 0} contest={contest} title={project.title} />

          <RenderHistory renders={renders} />

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Button variant="ghost" render={<Link href={`/projects/${projectId}/import`} />}>
              ← Back to import
            </Button>
            <Button variant="outline" render={<Link href="/projects" />}>
              Save &amp; exit
            </Button>
          </div>
        </div>

        {/* studio column: tabbed audio container */}
        <div className="xl:sticky xl:top-4 xl:self-start">
          <div className="cw-glass rounded-2xl p-3">
            <div className="mb-3 flex gap-1 rounded-xl bg-muted/40 p-1">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 text-sm font-medium shadow-sm">
                <Music className="size-4 text-primary" /> Music
              </span>
            </div>
            <MusicPanel
              projectId={projectId}
              tracks={tracks}
              musicTrackId={project.musicTrackId}
              favorites={favorites}
              embedded
            />
          </div>
        </div>
      </div>
    </div>
  );
}
