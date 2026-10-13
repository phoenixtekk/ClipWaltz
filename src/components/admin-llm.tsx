"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, PlugZap, Save, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  saveLlmProvider,
  setLlmPlatformKey,
  testLlmPlatformKey,
  type LlmAdminProvider,
} from "@/lib/llm-actions";
import { unwrap } from "@/lib/action-result";

const PLANS = [
  { key: "free", label: "Free" },
  { key: "plus", label: "Plus" },
  { key: "pro", label: "Pro" },
] as const;
const inputCls = "h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";

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

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

function ProviderCard({ p }: { p: LlmAdminProvider }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(p.enabled);
  const [plans, setPlans] = useState<string[]>(p.plans);
  const [allowOwnKey, setAllowOwnKey] = useState(p.allowOwnKey);
  const [model, setModel] = useState(p.model);
  const [visionModel, setVisionModel] = useState(p.visionModel);
  const [dailyLimit, setDailyLimit] = useState(String(p.dailyLimit));
  const [key, setKey] = useState("");
  const dirty =
    enabled !== p.enabled || allowOwnKey !== p.allowOwnKey || model !== p.model || visionModel !== p.visionModel ||
    dailyLimit !== String(p.dailyLimit) ||
    plans.slice().sort().join() !== p.plans.slice().sort().join();

  function run<T>(fn: () => Promise<T>, ok: string | ((v: T) => string), after?: () => void) {
    start(async () => {
      try {
        const v = await fn();
        toast.success(typeof ok === "function" ? ok(v) : ok);
        after?.();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not save");
      }
    });
  }

  const usable = enabled && plans.length > 0 && (p.platformKeyLast4 || allowOwnKey);
  return (
    <div className="cw-glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">
            {p.label} <span className="text-xs font-normal text-muted-foreground">by {p.vendor}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {usable ? "Offered to users" : "Not offered"} · {p.ownKeyUsers} user key{p.ownKeyUsers === 1 ? "" : "s"} saved
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          On <Toggle on={enabled} onChange={setEnabled} label={`${p.label} on`} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Plans that can use it</div>
          <div className="flex gap-3">
            {PLANS.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={plans.includes(t.key)}
                  onChange={(e) => setPlans((cur) => (e.target.checked ? [...cur, t.key] : cur.filter((x) => x !== t.key)))}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-2 text-sm sm:justify-start">
          Users can add their own key <Toggle on={allowOwnKey} onChange={setAllowOwnKey} label="Allow users' own keys" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Model (writing)
          <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.defaultModel} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Model (looking at photos &amp; video frames)
          <input className={inputCls} value={visionModel} onChange={(e) => setVisionModel(e.target.value)} placeholder={p.defaultModel} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Daily limit per user on ClipWaltz&apos;s key (AI jobs; then the built-in model takes over until tomorrow, UTC)
          <input className={inputCls} type="number" min={1} max={10000} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || pending}
          onClick={() => run(() => saveLlmProvider(p.id, { enabled, plans, allowOwnKey, model, visionModel, dailyLimit: Number(dailyLimit) }).then(unwrap), `${p.label} saved`)}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" /> ClipWaltz&apos;s key
          <span className="text-xs font-normal text-muted-foreground">
            {p.platformKeyLast4 ? `saved · ends in ${p.platformKeyLast4} — usage is billed to ClipWaltz` : "none — users on these plans need their own key"}
          </span>
        </div>
        {p.lastError ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Last failure {when(p.lastErrorAt)}: {p.lastError}
          </p>
        ) : p.lastOkAt ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-500">
            <CheckCircle2 className="size-3.5" /> Last used {when(p.lastOkAt)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <input
            className={cn(inputCls, "max-w-sm flex-1")}
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={p.platformKeyLast4 ? "Paste a new key to replace it" : "Paste an API key"}
          />
          <Button size="sm" disabled={!key.trim() || pending} onClick={() => run(() => setLlmPlatformKey(p.id, key).then(unwrap), "Key tested and saved", () => setKey(""))}>
            Test &amp; save
          </Button>
          {p.platformKeyLast4 && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => testLlmPlatformKey(p.id).then(unwrap), (ms) => `Key works — answered in ${(ms / 1000).toFixed(1)} s`)}>
                <PlugZap className="size-4" /> Test
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => confirm(`Remove ClipWaltz's ${p.label} key? Users without their own key go back to the built-in model.`) && run(() => setLlmPlatformKey(p.id, null).then(unwrap), "Key removed")}
              >
                <Trash2 className="size-4" /> Remove
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminLlm({ providers }: { providers: LlmAdminProvider[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Writing &amp; planning models</h2>
        <p className="text-xs text-muted-foreground">
          The built-in model (the AI Box) always works. Turn on an outside model per plan, then add ClipWaltz&apos;s own key
          (ClipWaltz pays the vendor), let users add their own key (they pay), or both. Each user picks their model under
          Account → AI models. If an outside model fails, that job finishes on the built-in model.
        </p>
      </div>
      <div className="grid gap-3">
        {providers.map((p) => (
          <ProviderCard key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}
