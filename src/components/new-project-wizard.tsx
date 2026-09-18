"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { createProject } from "@/lib/project-actions";

type Template = {
  key: string;
  label: string;
  glyph: string;
  desc: string;
  active: boolean;
};

const TEMPLATES: Template[] = [
  { key: "trip", label: "Trip", glyph: "✈", desc: "Vacations, road trips, getaways", active: true },
  { key: "event", label: "Event / Wedding", glyph: "◈", desc: "Weddings, parties, concerts", active: true },
  { key: "birthday", label: "Birthday", glyph: "✿", desc: "Birthdays & milestones", active: false },
  { key: "surprise", label: "Surprise me", glyph: "✦", desc: "Let ClipWaltz choose the style", active: true },
];

export function NewProjectWizard() {
  const router = useRouter();
  const [selected, setSelected] = useState("trip");
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [pending, start] = useTransition();

  function onContinue() {
    start(async () => {
      try {
        const id = await createProject(selected, aspect);
        router.push(`/projects/${id}/import`);
      } catch {
        toast.error("Could not create the project. Please try again.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* header + step indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
          <p className="text-sm text-muted-foreground">Pick an occasion — or let us choose.</p>
        </div>
        <ol className="flex items-center gap-2 text-xs font-medium">
          <li className="rounded-full border border-primary bg-primary/10 px-3 py-1 text-primary">
            1 · Occasion
          </li>
          <li className="rounded-full border border-border px-3 py-1 text-muted-foreground">
            2 · Import
          </li>
        </ol>
      </div>

      {/* template tiles */}
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

      {/* aspect + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
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
          <Button onClick={onContinue} disabled={pending}>
            {pending ? "Creating…" : "Continue →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
