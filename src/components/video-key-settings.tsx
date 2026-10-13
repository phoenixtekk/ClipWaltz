"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Film, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { deleteMyVideoKey, saveMyVideoKey, type MyVideoModels } from "@/lib/video-provider-actions";
import { unwrap } from "@/lib/action-result";

const inputCls = "h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";

function VideoKeyCard({ k }: { k: MyVideoModels["keys"][number] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const run = (fn: () => Promise<unknown>, ok: string, after?: () => void) =>
    start(async () => {
      try {
        await fn();
        toast.success(ok);
        after?.();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="size-4" /> Your {k.label} key
        <span className="text-xs font-normal text-muted-foreground">{k.myKey ? `saved · ends in ${k.myKey.last4}` : k.keyHint}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className={inputCls} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={k.myKey ? "Paste a new key to replace it" : "Paste your API key"} />
        <Button size="sm" disabled={pending || !key.trim()} onClick={() => run(() => saveMyVideoKey(k.id, key).then(unwrap), "Key checked and saved", () => setKey(""))}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Check &amp; save
        </Button>
        {k.myKey && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => confirm(`Delete your ${k.label} key from ClipWaltz?`) && run(() => deleteMyVideoKey(k.id).then(unwrap), "Key deleted")}>
            <Trash2 className="size-4" /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}

export function VideoKeySettings({ data }: { data: MyVideoModels }) {
  if (!data.keys.length && !data.offers.length) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className={cn("flex items-center gap-2 font-medium")}><Film className="size-4" /> Video models (Waltz AI)</h2>
        <p className="text-xs text-muted-foreground">
          {data.offers.length
            ? `Offered in the Generate tab: ${data.offers.map((o) => `${o.label} (${o.source === "own" ? "your key" : `${o.creditsPerSec} credits/s`})`).join(", ")}.`
            : "No cloud video models are offered on your plan yet."}{" "}
          With your own key, clips cost no ClipWaltz credits — the vendor bills your account. Keys are checked with a free
          lookup, stored encrypted and only shown as their last 4 characters.
        </p>
      </div>
      {data.keys.map((k) => (
        <VideoKeyCard key={k.id} k={k} />
      ))}
    </section>
  );
}
