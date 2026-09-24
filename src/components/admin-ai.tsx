"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  setModelEnabled,
  setWorkflowEnabled,
  saveRoutingRule,
  deleteRoutingRule,
  type AiRegistry,
} from "@/lib/ai-admin-actions";

const TASKS = [
  { key: "text_to_video", label: "Text → video" },
  { key: "image_to_video", label: "Image → video" },
] as const;
const QUALITIES = ["preview", "standard", "high"] as const;

type Rule = AiRegistry["rules"][number];

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        on ? "bg-emerald-600" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

const cell = "px-3 py-2 text-left align-middle";
const inputCls = "h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";

export function AdminAi({ registry }: { registry: AiRegistry }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { models, workflows, rules } = registry;

  const modelOn = new Map(models.map((m) => [m.name, m.enabled]));
  const wfById = new Map(workflows.map((w) => [w.id, w]));
  const usable = (r: Rule) => {
    const w = wfById.get(r.workflowRegistryId);
    return r.enabled && !!w?.enabled && !!(w.modelName && modelOn.get(w.modelName));
  };
  // The rule the routing engine will pick for each task+quality (lowest priority, then id).
  const winner = new Map<string, string>();
  for (const r of [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
    const k = `${r.task}:${r.quality}`;
    if (!winner.has(k) && usable(r)) winner.set(k, r.id);
  }

  function run(fn: () => Promise<void>, ok: string) {
    start(async () => {
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not save");
      }
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Models</h2>
        <p className="text-xs text-muted-foreground">Turning a model off disables every workflow that uses it.</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr><th className={cell}>Model</th><th className={cell}>Role</th><th className={cell}>VRAM</th><th className={cell}>Enabled</th></tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className={cell}>
                    <div className="font-medium">{m.family ?? m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.description}</div>
                  </td>
                  <td className={cell}>{m.role}</td>
                  <td className={cell}>{m.vramProfileMb ? `${(m.vramProfileMb / 1024).toFixed(1)} GB` : "—"}</td>
                  <td className={cell}>
                    <Toggle on={m.enabled} disabled={pending} onChange={(v) => run(() => setModelEnabled(m.id, v), `${m.name} ${v ? "enabled" : "disabled"}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Workflows</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr><th className={cell}>Workflow</th><th className={cell}>Task</th><th className={cell}>Model</th><th className={cell}>Enabled</th></tr>
            </thead>
            <tbody>
              {workflows.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className={cell}><code className="text-xs">{w.id}</code></td>
                  <td className={cell}>{w.task ?? "—"}</td>
                  <td className={cell}>
                    {w.modelName}
                    {w.enabled && w.modelName && !modelOn.get(w.modelName) ? (
                      <span className="ml-2 text-xs text-amber-600">model off</span>
                    ) : null}
                  </td>
                  <td className={cell}>
                    <Toggle on={w.enabled} disabled={pending} onChange={(v) => run(() => setWorkflowEnabled(w.id, v), `${w.id} ${v ? "enabled" : "disabled"}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Routing rules</h2>
          <p className="text-xs text-muted-foreground">
            For each task and quality the lowest-priority usable rule wins (rule, workflow and model all enabled); the
            others are fallbacks. Steps: sampler steps (blank = workflow default). Changes apply to the next job.
          </p>
        </div>
        {TASKS.map((t) => (
          <div key={t.key} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</h3>
            {QUALITIES.map((q) => {
              const list = rules.filter((r) => r.task === t.key && r.quality === q);
              const none = !winner.has(`${t.key}:${q}`);
              return (
                <div key={q} className="rounded-xl border border-border p-2">
                  <div className="mb-1 flex items-center gap-2 px-1 text-sm font-medium capitalize">
                    {q}
                    {none ? (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-600">
                        <AlertTriangle className="size-3.5" /> no usable rule — unavailable to users
                      </span>
                    ) : null}
                  </div>
                  {list.map((r) => (
                    <RuleRow key={r.id} rule={r} workflows={workflows.filter((w) => w.task === t.key)} active={winner.get(`${t.key}:${q}`) === r.id} pending={pending} run={run} />
                  ))}
                  <RuleRow
                    rule={{ id: "", task: t.key, quality: q, workflowRegistryId: workflows.find((w) => w.task === t.key)?.id ?? "", steps: null, priority: (list.at(-1)?.priority ?? -10) + 10, enabled: true }}
                    workflows={workflows.filter((w) => w.task === t.key)}
                    active={false}
                    pending={pending}
                    run={run}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

function RuleRow({
  rule, workflows, active, pending, run,
}: {
  rule: Rule;
  workflows: AiRegistry["workflows"];
  active: boolean;
  pending: boolean;
  run: (fn: () => Promise<void>, ok: string) => void;
}) {
  const isNew = !rule.id;
  const [wf, setWf] = useState(rule.workflowRegistryId);
  const [steps, setSteps] = useState(rule.steps == null ? "" : String(rule.steps));
  const [priority, setPriority] = useState(String(rule.priority));
  const [enabled, setEnabled] = useState(rule.enabled);
  const input = () => ({
    task: rule.task, quality: rule.quality, workflowRegistryId: wf,
    steps: steps.trim() === "" ? null : Number(steps), priority: Number(priority), enabled,
  });
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-lg px-1 py-1.5", active && "bg-emerald-600/5", isNew && "opacity-80")}>
      <select value={wf} onChange={(e) => setWf(e.target.value)} className={cn(inputCls, "min-w-48")} aria-label="Workflow">
        {workflows.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        steps <input value={steps} onChange={(e) => setSteps(e.target.value.replace(/[^0-9]/g, ""))} placeholder="default" className={cn(inputCls, "w-20")} />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        priority <input value={priority} onChange={(e) => setPriority(e.target.value.replace(/[^0-9]/g, ""))} className={cn(inputCls, "w-16")} />
      </label>
      {isNew ? null : (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Toggle on={enabled} onChange={setEnabled} disabled={pending} /> on
        </label>
      )}
      {active ? <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">in use</span> : null}
      <div className="ml-auto flex gap-1">
        {isNew ? (
          <Button size="sm" variant="outline" disabled={pending || !wf} onClick={() => run(() => saveRoutingRule(null, input()), "Rule added")}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add fallback
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => saveRoutingRule(rule.id, input()), "Rule saved")}>
              <Save className="size-3.5" /> Save
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteRoutingRule(rule.id), "Rule deleted")} aria-label="Delete rule">
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
