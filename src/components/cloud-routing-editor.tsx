"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2, Route, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CloudTargetPicker } from "@/components/cloud-target-picker";
import { saveCloudRouting, type CloudRouting } from "@/lib/cloud-actions";
import { PROVIDER_LABEL } from "@/lib/cloud/types";
import { RULE_FIELDS, RULE_FIELD_LABEL, VIDEO_TYPES, VIDEO_TYPE_LABEL, type CloudRule, type RuleField } from "@/lib/cloud/routing-shared";
import { unwrap } from "@/lib/action-result";

const field = "h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Account → Cloud storage → "Where videos go": default destinations + ordered rules (first match wins). */
export function CloudRoutingEditor({ routing }: { routing: CloudRouting }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [defaults, setDefaults] = useState(routing.prefs.defaultTargets.filter((p) => routing.connected.includes(p)));
  const [rules, setRules] = useState<CloudRule[]>(routing.prefs.rules);
  const [dirty, setDirty] = useState(false);
  const { connected } = routing;

  const options = (f: RuleField): { value: string; label: string }[] =>
    f === "type" ? VIDEO_TYPES.map((t) => ({ value: t, label: VIDEO_TYPE_LABEL[t] }))
      : f === "category" ? routing.categories.map((c) => ({ value: c, label: c }))
        : routing.aspects.map((a) => ({ value: a, label: a }));
  const change = (fn: () => void) => { fn(); setDirty(true); };
  const update = (i: number, patch: Partial<CloudRule>) => change(() => setRules(rules.map((r, k) => (k === i ? { ...r, ...patch } : r))));
  const move = (i: number, d: -1 | 1) => change(() => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRules(next);
  });
  const add = () => change(() => setRules([...rules, { id: crypto.randomUUID(), field: "type", values: [], targets: [...defaults] }]));

  const save = () => start(async () => {
    try {
      const incomplete = rules.filter((r) => r.values.length === 0);
      if (incomplete.length) throw new Error("Pick at least one value for every rule (or delete it).");
      unwrap(await saveCloudRouting({ defaultTargets: defaults, rules }));
      setDirty(false);
      toast.success("Saved — new videos will follow these settings");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Could not save.");
    }
  });

  return (
    <section className="cw-glass space-y-4 rounded-2xl p-4" aria-labelledby="route-h">
      <div className="flex items-start gap-2">
        <Route className="mt-0.5 size-4 text-primary" />
        <div>
          <h2 id="route-h" className="text-sm font-semibold">Where videos go</h2>
          <p className="text-xs text-muted-foreground">
            Rules are checked top to bottom; the first one that matches decides. Videos no rule matches go to your default.
            A project&apos;s own setting (Video properties) or a choice you make when rendering always wins.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Default — save every other finished video to</p>
        <CloudTargetPicker connected={connected} value={defaults} onChange={(v) => change(() => setDefaults(v))} disabled={pending} />
        {defaults.length === 0 ? <p className="text-[11px] text-muted-foreground">Nothing selected — videos no rule matches aren&apos;t saved.</p> : null}
      </div>

      <ol className="space-y-2">
        {rules.map((r, i) => (
          <li key={r.id} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-semibold text-muted-foreground">{i + 1}.</span>
              <span>When</span>
              <select aria-label="Rule matches on" value={r.field} className={field}
                onChange={(e) => update(i, { field: e.target.value as RuleField, values: [] })}>
                {RULE_FIELDS.map((f) => <option key={f} value={f}>{RULE_FIELD_LABEL[f].toLowerCase()}</option>)}
              </select>
              <span>is</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button type="button" aria-label="Move rule up" disabled={i === 0} onClick={() => move(i, -1)} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                <button type="button" aria-label="Move rule down" disabled={i === rules.length - 1} onClick={() => move(i, 1)} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                <button type="button" aria-label="Delete rule" onClick={() => change(() => setRules(rules.filter((_, k) => k !== i)))} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
              </div>
            </div>
            <div role="group" aria-label="Values" className="flex flex-wrap gap-1.5">
              {options(r.field).map((o) => {
                const on = r.values.includes(o.value);
                return (
                  <button key={o.value} type="button" aria-pressed={on}
                    onClick={() => update(i, { values: on ? r.values.filter((v) => v !== o.value) : [...r.values, o.value] })}
                    className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>
                    {o.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>→ save to</span>
              <CloudTargetPicker connected={connected} value={r.targets} onChange={(v) => update(i, { targets: v })} />
              {r.targets.length === 0 ? <span className="text-xs text-muted-foreground">(don&apos;t save)</span> : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={add} disabled={pending || rules.length >= 30}><Plus className="size-3.5" /> Add rule</Button>
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
        </Button>
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        {!routing.prefs.saved && connected.length ? (
          <span className="text-xs text-muted-foreground">Currently: every finished video goes to {routing.prefs.defaultTargets.map((p) => PROVIDER_LABEL[p]).join(" and ") || "nowhere"}.</span>
        ) : null}
      </div>
    </section>
  );
}
