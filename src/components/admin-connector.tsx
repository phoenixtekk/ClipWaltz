"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Monitor, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { saveConnectorAdmin, type ConnectorAdmin } from "@/lib/llm-actions";
import { unwrap } from "@/lib/action-result";

const PLANS = [
  { key: "free", label: "Free" },
  { key: "plus", label: "Plus" },
  { key: "pro", label: "Pro" },
] as const;

export function AdminConnector({ c }: { c: ConnectorAdmin }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(c.enabled);
  const [plans, setPlans] = useState<string[]>(c.plans);
  const dirty = enabled !== c.enabled || plans.slice().sort().join() !== c.plans.slice().sort().join();

  return (
    <div className="cw-glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <Monitor className="size-4" /> Users&apos; own computers <span className="text-xs font-normal text-muted-foreground">ClipWaltz Connector + Ollama</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {c.paired} computer{c.paired === 1 ? "" : "s"} connected · {c.online} online now. Free to ClipWaltz — the user&apos;s computer does the work.
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          On
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Users' own computers on"
            onClick={() => setEnabled(!enabled)}
            className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", enabled ? "bg-emerald-600" : "bg-muted-foreground/30")}
          >
            <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-4" : "translate-x-0.5")} />
          </button>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <Button
          size="sm"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              try {
                unwrap(await saveConnectorAdmin({ enabled, plans }));
                toast.success("Saved");
                router.refresh();
              } catch (e) {
                toast.error((e as Error).message);
              }
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
        </Button>
      </div>
    </div>
  );
}
