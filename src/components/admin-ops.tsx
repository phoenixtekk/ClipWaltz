"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "cn";
import { getOpsQueue, getUsageMetrics, type OpsQueue, type UsageMetrics } from "@/lib/ops-admin-actions";

const cell = "px-2 py-1.5 text-left align-top";
const fmtSec = (s: number | null) => (s == null ? "—" : s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const STATUS_CLS: Record<string, string> = {
  completed: "text-emerald-600", failed: "text-destructive", cancelled: "text-muted-foreground", retried: "text-muted-foreground",
  queued: "text-amber-600",
};

export function AdminOps({ initialQueue, initialUsage }: { initialQueue: OpsQueue; initialUsage: UsageMetrics }) {
  const [q, setQ] = useState(initialQueue);
  const [usage, setUsage] = useState(initialUsage);
  const [loading, setLoading] = useState(false);

  // CW-MVP-192: live queue — refresh every 10 s while the page is open.
  useEffect(() => {
    const t = setInterval(() => { getOpsQueue().then(setQ, () => {}); }, 10_000);
    return () => clearInterval(t);
  }, []);

  function setDays(d: number) {
    setLoading(true);
    getUsageMetrics(d).then(setUsage, () => {}).finally(() => setLoading(false));
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Queues</h2>
          <button type="button" onClick={() => getOpsQueue().then(setQ, () => {})} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <RefreshCw className="size-3" /> Refresh (auto every 10 s)
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {q.queues.map((x) => (
            <div key={x.name} className="rounded-xl border border-border p-3">
              <div className="text-xs text-muted-foreground">{x.name} queue</div>
              {x.waiting < 0 ? (
                <div className="text-sm text-destructive">Redis unreachable</div>
              ) : (
                <div className="mt-1 text-sm">
                  <span className="text-lg font-semibold">{x.waiting}</span> waiting · <span className="font-semibold">{x.active}</span> active
                  <div className="text-[11px] text-muted-foreground">{x.delayed} retrying · {x.failed} failed (kept) · {x.completed} done (kept)</div>
                </div>
              )}
            </div>
          ))}
          <div className="rounded-xl border border-border p-3">
            <div className="text-xs text-muted-foreground">AI studio (AISERVER)</div>
            {q.studio ? (
              <div className="mt-1 text-sm">
                <span className="font-semibold">{q.studio.state}</span> · {q.studio.activeJobs} active
                <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  {q.studio.backends.map((b, i) => (
                    <div key={b.url}>GPU {i}: <span className={b.online ? "text-emerald-600" : "text-destructive"}>{b.online ? "online" : "offline"}</span> · {b.activeJobs} job{b.activeJobs === 1 ? "" : "s"}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-destructive">Unreachable</div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Music-video renders (last 24 h + in flight): {q.renders.length ? q.renders.map((r) => `${r.n} ${r.status}`).join(" · ") : "none"}
        </p>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className={cell}>When</th><th className={cell}>Type</th><th className={cell}>Status</th><th className={cell}>Project / user</th>
                <th className={cell}>Workflow</th><th className={cell}>Waited</th><th className={cell}>Ran</th><th className={cell}>Error</th>
              </tr>
            </thead>
            <tbody>
              {q.jobs.map((j) => (
                <tr key={j.id} className="border-t border-border">
                  <td className={cell}>{new Date(j.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className={cell}>{j.jobType.replace(/_/g, " ")}{j.quality ? ` · ${j.quality}` : ""}</td>
                  <td className={cn(cell, "font-medium", STATUS_CLS[j.status] ?? "text-[color:var(--cw-violet)]")}>
                    {j.status}{!["completed", "failed", "cancelled", "retried", "queued"].includes(j.status) ? ` ${j.progress}%` : ""}
                  </td>
                  <td className={cell}>{j.project}<div className="text-muted-foreground">{j.user ?? "—"}</div></td>
                  <td className={cell}><code>{j.workflow ?? "—"}</code></td>
                  <td className={cell}>{fmtSec(j.waitSeconds)}</td>
                  <td className={cell}>{fmtSec(j.runSeconds)}</td>
                  <td className={cn(cell, "max-w-56 text-destructive")} title={j.errorDetail ?? undefined}>{j.error ?? ""}</td>
                </tr>
              ))}
              {q.jobs.length === 0 ? (
                <tr><td className={cn(cell, "text-muted-foreground")} colSpan={8}>No AI jobs yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Usage — last {usage.days} days</h2>
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
            {[7, 30].map((d) => (
              <button key={d} type="button" disabled={loading} onClick={() => setDays(d)}
                className={cn("rounded-md px-2.5 py-1", usage.days === d ? "bg-muted font-medium" : "text-muted-foreground")}>
                {d} days
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {usage.totals.map((t) => (
            <div key={t.label} className="rounded-xl border border-border p-3">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="text-xl font-semibold">{t.value}</div>
              {t.hint ? <div className="text-[11px] text-muted-foreground">{t.hint}</div> : null}
            </div>
          ))}
        </div>
        {usage.byType.length ? (
          <p className="text-xs text-muted-foreground">
            Average GPU run time: {usage.byType.map((t) => `${t.type.replace(/_/g, " ")} ${fmtSec(t.avgRunSec)}`).join(" · ")}
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr><th className={cell}>Day</th><th className={cell}>Generations</th><th className={cell}>Enhancements</th><th className={cell}>Exports</th><th className={cell}>Renders</th><th className={cell}>Failed</th><th className={cell}>Active users</th></tr>
            </thead>
            <tbody>
              {usage.daily.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className={cell}>{d.day}</td><td className={cell}>{d.generations}</td><td className={cell}>{d.enhancements}</td>
                  <td className={cell}>{d.exports}</td><td className={cell}>{d.renders}</td>
                  <td className={cn(cell, d.failed ? "text-destructive" : "")}>{d.failed}</td><td className={cell}>{d.activeUsers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
