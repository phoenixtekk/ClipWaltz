"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { createProject } from "@/lib/project-actions";
import type { AiTemplate } from "@/lib/template-actions";

const TEMPLATE_GLYPH: Record<string, string> = {
  product: "◎", social: "▶", story: "❝", event: "✺", travel: "⛰", cinematic: "🎬",
};

type Template = {
  key: string;
  label: string;
  glyph: string;
  desc: string;
  active: boolean;
};

// Product names (2026-09-25): AutoWaltz = media → music video; Waltz AI = AI-generated clips.
const KINDS = [["music", "AutoWaltz", "music video from my media"], ["ai", "Waltz AI", "AI video from a template"]] as const;

const TEMPLATES: Template[] = [
  { key: "trip", label: "Trip", glyph: "✈", desc: "Vacations, road trips, getaways", active: true },
  { key: "event", label: "Event / Wedding", glyph: "◈", desc: "Weddings, parties, concerts", active: true },
  { key: "birthday", label: "Birthday", glyph: "✿", desc: "Birthdays & milestones", active: false },
  { key: "surprise", label: "Surprise me", glyph: "✦", desc: "Let ClipWaltz choose the style", active: true },
];

export function NewProjectWizard({ workspaceId, aiTemplates = [] }: { workspaceId?: string; aiTemplates?: AiTemplate[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"music" | "ai">("music");
  const [selected, setSelected] = useState("trip");
  const [aiTemplateId, setAiTemplateId] = useState<string | null>(aiTemplates[0]?.id ?? null);
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();

  function onContinue() {
    if (!name.trim()) {
      toast.error("Give your project a name.");
      return;
    }
    start(async () => {
      try {
        const tpl = kind === "ai" ? aiTemplates.find((t) => t.id === aiTemplateId) ?? null : null;
        const projectAspect = tpl ? (tpl.settings.aspect === "9:16" ? "9:16" : "16:9") : aspect;
        const id = await createProject(kind === "music" ? selected : "surprise", projectAspect, workspaceId, {
          title: name, description, aiTemplateId: tpl?.id,
        });
        // CW-MVP-010: straight into the project — music videos start by importing media,
        // AI templates open the Generate tab pre-filled (CW-MVP-151).
        router.push(tpl ? `/projects/${id}/edit?tab=generate` : `/projects/${id}/import`);
      } catch (e) {
        toast.error((e as Error).message || "Could not create the project. Please try again.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* header + step indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
          <p className="text-sm text-muted-foreground">Name it, then pick an occasion or an AI template.</p>
        </div>
        <ol className="flex items-center gap-2 text-xs font-medium">
          <li className="rounded-full border border-primary bg-primary/10 px-3 py-1 text-primary">
            1 · Setup
          </li>
          <li className="rounded-full border border-border px-3 py-1 text-muted-foreground">
            2 · Import
          </li>
        </ol>
      </div>

      {/* name + description (CW-MVP-010) */}
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Project name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            autoFocus
            placeholder="e.g. Lake Pleasant birthday ride"
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Description <span className="font-normal text-muted-foreground">(optional)</span></span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="What's this video about?"
            className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>

      {/* music video (occasions) vs AI template (CW-MVP-150) */}
      <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 text-sm font-medium">
        {KINDS.map(([k, name, desc]) => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={cn("rounded-md px-3 py-1.5 transition-colors", kind === k ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground")}>
            <span className="font-semibold">{name}</span>
            <span className="hidden sm:inline"> · {desc}</span>
          </button>
        ))}
      </div>

      {kind === "ai" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {aiTemplates.map((t) => {
            const isSelected = aiTemplateId === t.id;
            return (
              <button key={t.id} type="button" aria-pressed={isSelected} disabled={pending} onClick={() => setAiTemplateId(t.id)}
                className={cn("flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:border-primary/60",
                  isSelected ? "border-primary bg-primary/10" : "border-border bg-card")}>
                <span className="grid size-10 place-items-center rounded-lg bg-muted text-lg">{TEMPLATE_GLYPH[t.category ?? ""] ?? "✦"}</span>
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{t.settings.aspect} · {t.settings.duration}s · {t.settings.quality}</p>
                </div>
              </button>
            );
          })}
          {aiTemplates.length === 0 ? <p className="text-sm text-muted-foreground">No AI templates are available right now.</p> : null}
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TEMPLATES.map((t) => {
          const isSelected = selected === t.key;
          return (
            <button
              key={t.key}
              type="button"
              disabled={!t.active || pending}
              aria-pressed={isSelected}
              onClick={() => t.active && setSelected(t.key)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors",
                t.active
                  ? "cursor-pointer hover:border-primary/60"
                  : "cursor-not-allowed opacity-60",
                isSelected ? "border-primary bg-primary/10" : "border-border bg-card",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="grid size-10 place-items-center rounded-lg bg-muted text-lg">
                  {t.glyph}
                </span>
                {!t.active ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Coming soon
                  </span>
                ) : isSelected ? (
                  <span className="rounded-full border border-primary bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Selected
                  </span>
                ) : null}
              </div>
              <div>
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
      )}

      {/* aspect + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className={cn("flex items-center gap-2", kind === "ai" && "invisible")}>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Aspect</span>
          {([
            { key: "9:16", label: "9:16 vertical", box: "h-5 w-3" },
            { key: "16:9", label: "16:9 wide", box: "h-3 w-5" },
          ] as const).map((a) => (
            <button
              key={a.key}
              type="button"
              aria-pressed={aspect === a.key}
              disabled={pending}
              onClick={() => setAspect(a.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                aspect === a.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={cn("rounded-[3px] border-2 border-current", a.box)} />
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" render={<Link href="/projects" />}>
            Cancel
          </Button>
          <Button onClick={onContinue} disabled={pending || !name.trim() || (kind === "ai" && !aiTemplateId)}>
            {pending ? "Creating…" : "Continue →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
