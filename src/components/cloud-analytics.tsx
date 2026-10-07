"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, MinusCircle, Table2 } from "lucide-react";
import { cn } from "cn";
import type { CloudAnalytics } from "@/lib/cloud-actions";
import { CLOUD_PROVIDERS, PROVIDER_LABEL, type CloudProviderId } from "@/lib/cloud/types";
import { VIDEO_TYPE_LABEL, type VideoType } from "@/lib/cloud/routing-shared";
import { LocalDate } from "@/components/local-date";

// Colours by role (validated with the dataviz validator: adjacent CVD ΔE ≥ 8.4, normal ≥ 19.8 in both modes).
// Each provider keeps its slot whatever is shown — colour follows the entity, never its rank. Light-mode aqua and
// yellow sit under 3:1 on white, so every chart carries direct labels and a table view.
const VIZ_CSS = `
.cw-viz { --s-google_drive:#2a78d6; --s-onedrive:#eb6834; --s-dropbox:#1baf7a; --s-box:#eda100; --seq:#2a78d6;
  --grid: color-mix(in oklab, currentColor 12%, transparent); --good:#0ca30c; --critical:#d03b3b; --warning:#fab219; }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) .cw-viz {
  --s-google_drive:#3987e5; --s-onedrive:#d95926; --s-dropbox:#199e70; --s-box:#c98500; --seq:#3987e5; } }
:root[data-theme="dark"] .cw-viz, .dark .cw-viz { --s-google_drive:#3987e5; --s-onedrive:#d95926; --s-dropbox:#199e70; --s-box:#c98500; --seq:#3987e5; }
`;
const color = (p: CloudProviderId) => `var(--s-${p})`;

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
const fmtSecs = (s: number | null) => (s == null ? "—" : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const RANGES = [7, 30, 90, 365];

export function CloudAnalyticsView({ data }: { data: CloudAnalytics }) {
  const t = data.totals;
  const empty = t.saved + t.failed + t.pending === 0;
  return (
    <div className="cw-viz space-y-6">
      <style>{VIZ_CSS}</style>

      <nav aria-label="Time range" className="flex flex-wrap gap-1.5">
        {RANGES.map((d) => (
          <Link key={d} href={`/account/storage/analytics?days=${d}`} aria-current={d === data.days ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", d === data.days ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>
            {d === 365 ? "Last year" : `Last ${d} days`}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Videos saved" value={String(t.saved)} />
        <Tile label="Data saved" value={fmtBytes(t.bytes)} />
        <Tile label="Success rate" value={t.successRate == null ? "—" : `${Math.round(t.successRate * 100)}%`} />
        <Tile label="Avg. time to save" value={fmtSecs(t.avgSeconds)} />
        <Tile label="Failed" value={String(t.failed)} tone={t.failed ? "critical" : undefined} />
        <Tile label="In progress" value={String(t.pending)} />
      </div>

      <StatusTable data={data} />

      {empty ? (
        <p className="cw-glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
          Nothing was saved in this period. Finished videos appear here once a storage service is connected.
        </p>
      ) : (
        <>
          <DailyChart data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <BarList title="By storage service" rows={data.byProvider.filter((r) => r.saved).map((r) => ({ key: r.provider, label: PROVIDER_LABEL[r.provider], bytes: r.bytes, count: r.saved, fill: color(r.provider) }))} />
            <BarList title="By video type" rows={data.byType.map((r) => ({ key: r.type, label: VIDEO_TYPE_LABEL[r.type as VideoType] ?? r.type, bytes: r.bytes, count: r.saved, fill: "var(--seq)" }))} />
            <BarList title="By format" rows={data.byFormat.map((r) => ({ key: r.aspect, label: r.aspect, bytes: r.bytes, count: r.saved, fill: "var(--seq)" }))} />
            <BarList title="Biggest projects" rows={data.topProjects.map((r) => ({ key: r.title, label: r.title, bytes: r.bytes, count: r.saved, fill: "var(--seq)" }))} />
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "critical" }) {
  return (
    <div className="cw-glass rounded-2xl p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "critical" && "text-destructive")}>{value}</p>
    </div>
  );
}

function Health({ h }: { h: "ok" | "error" | "off" }) {
  if (h === "ok") return <span className="inline-flex items-center gap-1 text-xs"><CheckCircle2 className="size-3.5" style={{ color: "var(--good)" }} /> Healthy</span>;
  if (h === "error") return <span className="inline-flex items-center gap-1 text-xs"><AlertTriangle className="size-3.5" style={{ color: "var(--critical)" }} /> Needs attention</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><MinusCircle className="size-3.5" /> Not connected</span>;
}

function StatusTable({ data }: { data: CloudAnalytics }) {
  return (
    <section className="cw-glass overflow-x-auto rounded-2xl p-4">
      <h2 className="mb-3 text-sm font-semibold">Storage status</h2>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr><th className="pb-2 font-medium">Service</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Space used</th>
            <th className="pb-2 text-right font-medium">Saved</th><th className="pb-2 text-right font-medium">Failed</th><th className="pb-2 text-right font-medium">Queued</th>
            <th className="pb-2 text-right font-medium">Avg. time</th><th className="pb-2 font-medium">Last save</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.connections.map((c) => {
            const p = data.byProvider.find((x) => x.provider === c.provider)!;
            const q = c.quota;
            const pct = q?.total ? Math.min(1, q.used / q.total) : null;
            return (
              <tr key={c.provider} className="align-top">
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full" style={{ background: color(c.provider) }} />{PROVIDER_LABEL[c.provider]}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.accountLabel ?? (c.available ? "" : "Coming soon")}</span>
                </td>
                <td className="py-2 pr-3"><Health h={c.health} />{c.lastError ? <span className="block max-w-56 truncate text-xs text-muted-foreground" title={c.lastError}>{c.lastError}</span> : null}</td>
                <td className="py-2 pr-3">
                  {q ? (
                    <div className="w-40 space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={q.total ?? undefined} aria-valuenow={q.used}
                        aria-label={`${PROVIDER_LABEL[c.provider]} space used`}>
                        {pct != null ? <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct * 100)}%`, background: pct > 0.9 ? "var(--critical)" : color(c.provider) }} /> : null}
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{fmtBytes(q.used)} of {q.total ? fmtBytes(q.total) : "unlimited"}{pct != null ? ` (${Math.round(pct * 100)}%)` : ""}</span>
                    </div>
                  ) : <span className="text-xs text-muted-foreground">{c.connected ? "Not reported" : "—"}</span>}
                </td>
                <td className="py-2 text-right tabular-nums">{p.saved}<span className="block text-xs text-muted-foreground">{fmtBytes(p.bytes)}</span></td>
                <td className="py-2 text-right tabular-nums">{p.failed}</td>
                <td className="py-2 text-right tabular-nums">{p.pending}</td>
                <td className="py-2 text-right tabular-nums">{fmtSecs(p.avgSeconds)}</td>
                <td className="py-2 pl-3 text-xs text-muted-foreground">{p.lastAt ? <LocalDate value={p.lastAt} /> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Data saved per day, stacked by service (one axis: bytes). Hover a day for its numbers; table view below. */
function DailyChart({ data }: { data: CloudAnalytics }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(() => {
    const out: string[] = [];
    const end = new Date(data.asOf).getTime();
    for (let i = data.days - 1; i >= 0; i--) out.push(new Date(end - i * 86400_000).toISOString().slice(0, 10));
    return out;
  }, [data.days, data.asOf]);
  const shown = CLOUD_PROVIDERS.filter((p) => data.daily.some((d) => d.provider === p));
  const cell = (day: string, p: CloudProviderId) => data.daily.find((d) => d.day === day && d.provider === p);
  const totals = days.map((day) => shown.reduce((a, p) => a + (cell(day, p)?.bytes ?? 0), 0));
  const max = Math.max(1, ...totals);
  const W = 720, H = 200, padL = 56, padB = 22, plotW = W - padL - 8, plotH = H - padB - 8;
  const bw = plotW / days.length;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <section className="cw-glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Data saved per day</h2>
        <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend">
          {shown.map((p) => <li key={p} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: color(p) }} />{PROVIDER_LABEL[p]}</li>)}
        </ul>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Bytes saved per day, stacked by storage service" onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => {
            const y = 8 + plotH - (v / max) * plotH;
            return (
              <g key={v}>
                <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="var(--grid)" />
                <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{fmtBytes(v)}</text>
              </g>
            );
          })}
          {days.map((day, i) => {
            let y = 8 + plotH;
            const x = padL + i * bw;
            const w = Math.max(1, bw - 2); // 2px surface gap between bars
            return (
              <g key={day} onMouseEnter={() => setHover(i)}>
                <rect x={x} y={8} width={bw} height={plotH} fill="transparent" />
                {shown.map((p) => {
                  const b = cell(day, p)?.bytes ?? 0;
                  if (!b) return null;
                  const h = (b / max) * plotH;
                  y -= h;
                  return <rect key={p} x={x + 1} y={y} width={w} height={Math.max(1, h - 2)} rx={Math.min(4, w / 2)} fill={color(p)} opacity={hover == null || hover === i ? 1 : 0.45} />;
                })}
                {(i === 0 || i === days.length - 1 || (days.length <= 31 && i % 7 === 0)) ? (
                  <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{label(day)}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {hover != null ? (
          <div className="pointer-events-none absolute top-0 rounded-lg border border-border bg-background/95 px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `${Math.min(80, ((padL + hover * bw) / W) * 100)}%` }}>
            <p className="font-medium">{label(days[hover])} · {fmtBytes(totals[hover])}</p>
            {shown.map((p) => {
              const c = cell(days[hover], p);
              return c ? <p key={p} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: color(p) }} />{PROVIDER_LABEL[p]}: {c.saved} · {fmtBytes(c.bytes)}</p> : null;
            })}
          </div>
        ) : null}
      </div>
      <TableView>
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Day</th>{shown.map((p) => <th key={p} className="py-1 text-right font-medium">{PROVIDER_LABEL[p]}</th>)}</tr></thead>
          <tbody>
            {days.filter((_, i) => totals[i] > 0).map((day) => (
              <tr key={day}><td className="py-0.5">{label(day)}</td>{shown.map((p) => {
                const c = cell(day, p);
                return <td key={p} className="py-0.5 text-right tabular-nums">{c ? `${c.saved} · ${fmtBytes(c.bytes)}` : "—"}</td>;
              })}</tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </section>
  );
}

/** Horizontal bars with direct labels (bytes) and counts — magnitude by category. */
function BarList({ title, rows }: { title: string; rows: { key: string; label: string; bytes: number; count: number; fill: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.bytes));
  return (
    <section className="cw-glass space-y-3 rounded-2xl p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">No data.</p> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs" title={`${r.label}: ${r.count} videos, ${fmtBytes(r.bytes)}`}>
              <span className="truncate">{r.label}</span>
              <span className="h-3 overflow-hidden rounded-r-[4px] bg-transparent">
                <span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max(1.5, (r.bytes / max) * 100)}%`, background: r.fill }} />
              </span>
              <span className="tabular-nums text-muted-foreground">{fmtBytes(r.bytes)} · {r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TableView({ children }: { children: React.ReactNode }) {
  return (
    <details className="text-xs">
      <summary className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"><Table2 className="size-3.5" /> Show as table</summary>
      <div className="mt-2 max-h-64 overflow-auto">{children}</div>
    </details>
  );
}
