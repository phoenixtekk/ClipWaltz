"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Film, KeyRound, Loader2, PlugZap, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { saveVideoProvider, setVideoPlatformKey, testVideoPlatformKey, type VideoAdminProvider } from "@/lib/video-provider-actions";
import { unwrap } from "@/lib/action-result";

const PLANS = [
  { key: "free", label: "Free" },
  { key: "plus", label: "Plus" },
  { key: "pro", label: "Pro" },
] as const;
const inputCls = "h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";
// A credit's worth on each paid plan (BILLING.md: Plus $15 / 300, Pro $39 / 1,000) — shown so the admin can price above cost.
const CREDIT_USD = { plus: 15 / 300, pro: 39 / 1000 };

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", on ? "bg-emerald-600" : "bg-muted-foreground/30")}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

function VideoCard({ p }: { p: VideoAdminProvider }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(p.enabled);
  const [plans, setPlans] = useState<string[]>(p.plans);
  const [allowOwnKey, setAllowOwnKey] = useState(p.allowOwnKey);
  const [dailyLimit, setDailyLimit] = useState(String(p.dailyLimit));
  const [credits, setCredits] = useState<Record<string, string>>(Object.fromEntries(p.models.map((m) => [m.id, String(m.credits)])));
  const [off, setOff] = useState<string[]>(p.models.filter((m) => !m.enabled).map((m) => m.id));
  const [key, setKey] = useState("");

  function run<T>(fn: () => Promise<T>, ok: string, after?: () => void) {
    start(async () => {
      try {
        await fn();
        toast.success(ok);
        after?.();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not save");
      }
    });
  }

  return (
    <div className="cw-glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">
            {p.label} <span className="text-xs font-normal text-muted-foreground">by {p.vendor}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {p.ownKeyUsers} user key{p.ownKeyUsers === 1 ? "" : "s"} saved{p.credit ? ` · requires a "${p.credit}" credit in the app` : ""}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          On <Toggle on={enabled} onChange={setEnabled} label={`${p.label} video on`} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex gap-3">
          {PLANS.map((t) => (
            <label key={t.key} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={plans.includes(t.key)} onChange={(e) => setPlans((c) => (e.target.checked ? [...c, t.key] : c.filter((x) => x !== t.key)))} />
              {t.label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          Users can add their own key <Toggle on={allowOwnKey} onChange={setAllowOwnKey} label={`Allow users' own ${p.label} keys`} />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Clips per user per day on ClipWaltz&apos;s key
          <input className={cn(inputCls, "w-20")} type="number" min={1} max={1000} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
        </label>
      </div>

      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">Model</th>
            <th className="py-1 text-left font-normal">Vendor cost</th>
            <th className="py-1 text-left font-normal">Credits / second (ClipWaltz&apos;s key)</th>
            <th className="py-1 text-left font-normal">Offered</th>
          </tr>
        </thead>
        <tbody>
          {p.models.map((m) => {
            const c = Number(credits[m.id]);
            const margin = (plan: "plus" | "pro") => (Number.isFinite(c) ? c * CREDIT_USD[plan] - m.usdPerSec : NaN);
            return (
              <tr key={m.id} className="border-t border-border">
                <td className="py-1.5">{m.label}</td>
                <td className="py-1.5 text-muted-foreground">${m.usdPerSec.toFixed(3)}/s</td>
                <td className="py-1.5">
                  <input className={cn(inputCls, "w-20")} type="number" min={0} max={100} step={0.5} value={credits[m.id]} onChange={(e) => setCredits((x) => ({ ...x, [m.id]: e.target.value }))} />
                  <span className={cn("ml-2 text-xs", margin("pro") < 0 ? "text-amber-500" : "text-muted-foreground")}>
                    {Number.isFinite(c) ? `≈ $${(c * CREDIT_USD.pro).toFixed(3)}/s on Pro, $${(c * CREDIT_USD.plus).toFixed(3)}/s on Plus${margin("pro") < 0 ? " — below cost on Pro" : ""}` : ""}
                  </span>
                </td>
                <td className="py-1.5">
                  <Toggle on={!off.includes(m.id)} onChange={(v) => setOff((x) => (v ? x.filter((y) => y !== m.id) : [...x, m.id]))} label={`Offer ${m.label}`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => saveVideoProvider(p.id, { enabled, plans, allowOwnKey, dailyLimit: Number(dailyLimit), credits: Object.fromEntries(Object.entries(credits).map(([k, v]) => [k, Number(v)])), disabledModels: off }).then(unwrap),
              `${p.label} saved`,
            )
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" /> ClipWaltz&apos;s key
          <span className="text-xs font-normal text-muted-foreground">
            {p.platformKeyLast4 ? `saved · ends in ${p.platformKeyLast4} — clips are billed to ClipWaltz` : "none — only users with their own key can use it"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <input className={cn(inputCls, "h-8 max-w-sm flex-1")} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.platformKeyLast4 ? "Paste a new key to replace it" : "Paste an API key"} />
          <Button size="sm" disabled={!key.trim() || pending} onClick={() => run(() => setVideoPlatformKey(p.id, key).then(unwrap), "Key checked and saved", () => setKey(""))}>
            Check &amp; save
          </Button>
          {p.platformKeyLast4 && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => testVideoPlatformKey(p.id).then(unwrap), "The vendor accepted the key")}>
                <PlugZap className="size-4" /> Check
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => confirm(`Remove ClipWaltz's ${p.label} key? Users without their own key lose these models.`) && run(() => setVideoPlatformKey(p.id, null).then(unwrap), "Key removed")}>
                <Trash2 className="size-4" /> Remove
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">The check asks the vendor to look up a task that doesn&apos;t exist — free; it proves the key is accepted, not that the account has credit.</p>
      </div>
    </div>
  );
}

export function AdminVideo({ providers }: { providers: VideoAdminProvider[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium"><Film className="size-4" /> Video models (Waltz AI)</h2>
        <p className="text-xs text-muted-foreground">
          Cloud video models next to the built-in Wan 2.2. A model is offered when its vendor is on for the user&apos;s plan and
          there&apos;s a key: the user&apos;s own (free on ClipWaltz) or ClipWaltz&apos;s (charged in credits per second, capped per day).
          A failed cloud clip is never retried automatically and its credits are refunded.
        </p>
      </div>
      {providers.map((p) => (
        <VideoCard key={p.id} p={p} />
      ))}
    </section>
  );
}
