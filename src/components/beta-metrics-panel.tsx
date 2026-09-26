import type { BetaMetrics, Metric } from "@/lib/beta-metrics";

// /admin/ops → Beta metrics (DESIGN_BUILD_PLAN §3): cost, funnel and reliability, 7 vs 30 days.
function Group({ title, week, month }: { title: string; week: Metric[]; month: Metric[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {month.map((m, i) => (
          <div key={m.label} className="rounded-xl border border-border p-3">
            <div className="text-xs text-muted-foreground">{m.label}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-semibold">{m.value}</span>
              <span className="text-xs text-muted-foreground">7 d: {week[i]?.value ?? "—"}</span>
            </div>
            {m.hint ? <div className="text-[11px] text-muted-foreground">{m.hint}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BetaMetricsPanel({ week, month }: { week: BetaMetrics; month: BetaMetrics }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">Beta metrics — last 30 days</h2>
        <p className="text-xs text-muted-foreground">
          {month.eventsSince
            ? `Event tracking since ${new Date(month.eventsSince).toLocaleDateString(undefined, { dateStyle: "medium" })}; earlier activity only counts where the database already recorded it.`
            : "No tracked events yet — the funnel figures start filling in as people use the app."}
        </p>
      </div>
      <Group title="Cost" week={week.cost} month={month.cost} />
      <Group title="Funnel" week={week.funnel} month={month.funnel} />
      <Group title="Reliability" week={week.reliability} month={month.reliability} />
      {month.topRenderErrors.length ? (
        <div className="rounded-xl border border-border p-3 text-sm">
          <div className="mb-1 text-xs text-muted-foreground">Top render failure reasons (30 d)</div>
          <ul className="space-y-0.5">
            {month.topRenderErrors.map((e) => (
              <li key={e.error} className="flex justify-between gap-3"><span className="truncate">{e.error}</span><span className="tabular-nums text-muted-foreground">{e.n}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
