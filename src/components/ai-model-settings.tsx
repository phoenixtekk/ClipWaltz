"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, PlugZap, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  saveMyAiKey,
  deleteMyAiKey,
  testMyAiKey,
  setMyAiModel,
  setMyAiKeyModel,
  type MyAiModels,
} from "@/lib/llm-actions";
import { unwrap } from "@/lib/action-result";
import { ComputerSettings } from "@/components/computer-settings";

const inputCls = "h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";
type Provider = MyAiModels["providers"][number];

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run<T>(fn: () => Promise<T>, ok: string | ((v: T) => string), after?: () => void) {
    start(async () => {
      try {
        const v = await fn();
        toast.success(typeof ok === "function" ? ok(v) : ok);
        after?.();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Something went wrong");
      }
    });
  }
  return { pending, run };
}

function Choice({ checked, onSelect, title, detail, disabled }: { checked: boolean; onSelect: () => void; title: string; detail: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={title}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
        checked ? "border-primary bg-primary/10" : "border-border hover:border-primary/60",
      )}
    >
      <span className={cn("mt-1 size-3.5 shrink-0 rounded-full border-2", checked ? "border-primary bg-primary" : "border-muted-foreground/50")} />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function KeyCard({ p }: { p: Provider }) {
  const { pending, run } = useRun();
  const [key, setKey] = useState("");
  const [model, setModel] = useState(p.myKey?.model ?? "");
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="size-4" /> Your {p.label} key
        <span className="text-xs font-normal text-muted-foreground">{p.myKey ? `saved · ends in ${p.myKey.last4}` : `from your ${p.vendor} account (${p.keyHint})`}</span>
      </div>
      {p.myKey?.lastError ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Failed {p.myKey.lastErrorAt ? new Date(p.myKey.lastErrorAt).toLocaleString() : ""}: {p.myKey.lastError}. The built-in model finished that job.
        </p>
      ) : p.myKey?.lastUsedAt ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-500">
          <CheckCircle2 className="size-3.5" /> Last worked {new Date(p.myKey.lastUsedAt).toLocaleString()}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <input
          className={cn(inputCls, "min-w-0 flex-1")}
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={p.myKey ? "Paste a new key to replace it" : "Paste your API key"}
        />
        <input
          className={cn(inputCls, "w-48")}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={`Model (default ${p.defaultModel})`}
          aria-label="Model"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {key.trim() ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => saveMyAiKey(p.id, key, model || null).then(unwrap), "Key tested and saved", () => setKey(""))}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Test &amp; save
          </Button>
        ) : p.myKey && model !== (p.myKey.model ?? "") ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => setMyAiKeyModel(p.id, model || null).then(unwrap), "Model saved")}>
            Save model
          </Button>
        ) : null}
        {p.myKey && (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => testMyAiKey(p.id).then(unwrap), (ms) => `Your key works — answered in ${(ms / 1000).toFixed(1)} s`)}>
              <PlugZap className="size-4" /> Test
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => confirm(`Delete your ${p.label} key from ClipWaltz?`) && run(() => deleteMyAiKey(p.id).then(unwrap), "Key deleted")}>
              <Trash2 className="size-4" /> Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function AiModelSettings({ data }: { data: MyAiModels }) {
  const { pending, run } = useRun();
  const available = data.providers.filter((p) => p.available && (p.platform || p.allowOwnKey));
  const is = (provider: string, source?: string) => data.choice.provider === provider && (!source || data.choice.source === source);
  const pick = (provider: string, source: "platform" | "own" | "computer", label: string) => run(() => setMyAiModel(provider, source).then(unwrap), `${label} now writes your scripts`);

  return (
    <div className="space-y-6">
      <section className="cw-glass space-y-3 rounded-2xl p-4">
        <div>
          <h2 className="flex items-center gap-2 font-medium"><Sparkles className="size-4" /> Model that writes for you</h2>
          <p className="text-xs text-muted-foreground">
            Used for WaltzDeck plans, scripts and voice lines, Edit with AI, scene rewrites, translations, campaign hooks,
            imports and describing your photos and clips.
          </p>
        </div>
        {data.choiceInactive && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {data.choiceInactive}
          </p>
        )}
        <div role="radiogroup" className="grid gap-2">
          <Choice
            checked={is("builtin")}
            disabled={pending}
            onSelect={() => pick("builtin", "platform", "The built-in model")}
            title="Built-in (ClipWaltz AI)"
            detail="Runs on ClipWaltz's own servers. Included in every plan; your media never leaves ClipWaltz."
          />
          {available.flatMap((p) => [
            ...(p.platform
              ? [
                  <Choice
                    key={`${p.id}-platform`}
                    checked={is(p.id, "platform")}
                    disabled={pending}
                    onSelect={() => pick(p.id, "platform", p.label)}
                    title={`${p.label} — included with your plan`}
                    detail={`By ${p.vendor}. Up to ${p.dailyLimit} AI jobs a day${is(p.id, "platform") ? ` (${p.usedToday} used today)` : ""}, then the built-in model until tomorrow. Your text and photo frames are sent to ${p.vendor}.`}
                  />,
                ]
              : []),
            ...(p.allowOwnKey
              ? [
                  <Choice
                    key={`${p.id}-own`}
                    checked={is(p.id, "own")}
                    disabled={pending || !p.myKey}
                    onSelect={() => pick(p.id, "own", `${p.label} (your key)`)}
                    title={`${p.label} — with your own key`}
                    detail={p.myKey ? `Billed to your ${p.vendor} account. Text and photo frames go to ${p.vendor}.` : "Add your key below first."}
                  />,
                ]
              : []),
          ])}
          {data.computer.available && (
            <Choice
              checked={is("connector")}
              disabled={pending || !data.computer.computers.some((c) => c.models.length)}
              onSelect={() => pick("connector", "computer", "Your computer")}
              title="Your computer — Ollama via the ClipWaltz Connector"
              detail={
                data.computer.computers.some((c) => c.models.length)
                  ? "Free, and your text and photo frames go only to your computer. If it's off, the built-in model writes for you."
                  : "Connect a computer below first."
              }
            />
          )}
        </div>
        {!available.length && !data.computer.available && (
          <p className="text-xs text-muted-foreground">No outside models are offered on your plan yet — the built-in model writes for you.</p>
        )}
      </section>

      {available.some((p) => p.allowOwnKey) && (
        <section className="space-y-3">
          <div>
            <h2 className="font-medium">Your own API keys</h2>
            <p className="text-xs text-muted-foreground">
              Keys are tested before they&apos;re saved, stored encrypted and never shown again — only the last 4 characters.
              The vendor bills your account for what ClipWaltz uses.
            </p>
          </div>
          {available.filter((p) => p.allowOwnKey).map((p) => (
            <KeyCard key={p.id} p={p} />
          ))}
        </section>
      )}

      {data.computer.available && <ComputerSettings computers={data.computer.computers} />}
    </div>
  );
}
