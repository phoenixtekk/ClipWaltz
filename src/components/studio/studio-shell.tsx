"use client";
// One-screen studio layout shared by the WaltzDeck and AutoWaltz editors (approved mockup 2026-09-30):
// top bar (project, section tabs, tools) · left context panel · preview stage · inspector · media bin + timeline
// · step bar. On large screens it fills the viewport under the app header and nothing scrolls but the panels;
// below `lg` the areas stack (preview, tab panel, inspector, bottom) and the page scrolls.
import type { ReactNode } from "react";
import { cn } from "cn";

export type StudioTab<K extends string> = { key: K; label: string; icon?: ReactNode };
export type StudioStep = { label: string; hint?: string; state: "done" | "current" | "todo"; onClick?: () => void };

export function StudioShell<K extends string>({
  kind, title, subtitle, tabs, tab, onTab, tools, left, stage, inspector, bottomLeft, bottom, steps, leftWide = false,
}: {
  kind: string; title: ReactNode; subtitle?: ReactNode;
  tabs: StudioTab<K>[]; tab: K; onTab: (k: K) => void;
  tools?: ReactNode; left: ReactNode; stage: ReactNode; inspector?: ReactNode;
  bottomLeft?: ReactNode; bottom?: ReactNode; steps?: StudioStep[];
  /** A wider left panel for content that needs it (the music library: its tabs and track rows). */
  leftWide?: boolean;
}) {
  return (
    <div className="cw-studio -mx-6 -my-8 flex flex-col gap-2 p-2 lg:h-[calc(100dvh-var(--cw-header-h))]">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 lg:flex-nowrap">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">{kind}</span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {subtitle ? <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        <nav role="tablist" aria-label="Editor sections" className="order-3 -mx-1 flex w-full gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] lg:order-none lg:mx-auto lg:w-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => onTab(t.key)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                "after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full",
                tab === t.key && "after:bg-primary",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 lg:ml-0 lg:flex-nowrap">{tools}</div>
      </div>

      {/* work area */}
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-2",
          "grid-cols-1 [grid-template-areas:'stage'_'left'_'insp'_'bottom']",
          "lg:grid-rows-[minmax(0,1fr)_minmax(13rem,34%)]",
          inspector
            ? leftWide
              ? "lg:grid-cols-[clamp(22rem,27vw,26rem)_minmax(0,1fr)_clamp(15rem,20vw,19rem)] lg:[grid-template-areas:'left_stage_insp'_'left_bottom_bottom']"
              : "lg:grid-cols-[clamp(17rem,22vw,21rem)_minmax(0,1fr)_clamp(15rem,20vw,19rem)] lg:[grid-template-areas:'left_stage_insp'_'left_bottom_bottom']"
            : leftWide
              ? "lg:grid-cols-[clamp(22rem,27vw,26rem)_minmax(0,1fr)] lg:[grid-template-areas:'left_stage'_'left_bottom']"
              : "lg:grid-cols-[clamp(17rem,22vw,21rem)_minmax(0,1fr)] lg:[grid-template-areas:'left_stage'_'left_bottom']",
        )}
      >
        <section className="cw-studio-pane [grid-area:left] max-lg:max-h-[80vh]">{left}</section>
        <section className="cw-studio-pane [grid-area:stage] max-lg:min-h-[22rem]">{stage}</section>
        {inspector ? <section className="cw-studio-pane [grid-area:insp] max-lg:max-h-[80vh]">{inspector}</section> : null}
        <div className={cn("grid min-h-0 gap-2 [grid-area:bottom]", bottomLeft ? "lg:grid-cols-[clamp(14rem,19vw,18rem)_minmax(0,1fr)]" : "")}>
          {bottomLeft ? <section className="cw-studio-pane max-lg:max-h-[60vh]">{bottomLeft}</section> : null}
          {bottom ? <section className="cw-studio-pane max-lg:max-h-[70vh]">{bottom}</section> : null}
        </div>
      </div>

      {/* step bar */}
      {steps?.length ? (
        <ol className="grid grid-cols-2 gap-x-3 gap-y-1 px-1 sm:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                onClick={s.onClick}
                disabled={!s.onClick}
                aria-current={s.state === "current" ? "step" : undefined}
                className={cn(
                  "w-full border-t-2 pt-1 text-left text-xs font-medium disabled:cursor-default",
                  s.state === "done" && "border-emerald-500/60 text-muted-foreground",
                  s.state === "current" && "border-primary text-foreground",
                  s.state === "todo" && "border-border text-muted-foreground/70",
                  s.onClick && "hover:text-foreground",
                )}
              >
                {i + 1}. {s.label}
                {s.hint ? <span className="block truncate text-[11px] font-normal text-muted-foreground">{s.hint}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** A studio panel: fixed header, scrolling body, optional pinned footer. */
export function StudioPanel({ title, actions, footer, children, bodyClassName }: {
  title: ReactNode; actions?: ReactNode; footer?: ReactNode; children: ReactNode; bodyClassName?: string;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-3", bodyClassName)}>{children}</div>
      {footer ? <div className="shrink-0 border-t border-border p-2">{footer}</div> : null}
    </>
  );
}
