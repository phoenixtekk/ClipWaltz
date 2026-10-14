"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Loader2, Monitor, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { approvePairing, lookupPairing, removeComputer, setComputerModel, type MyComputer, type PendingComputer } from "@/lib/llm-actions";
import { unwrap } from "@/lib/action-result";

const inputCls = "h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary";
const code = "rounded bg-muted px-1.5 py-0.5 font-mono text-xs";

/**
 * Connect a computer in two steps: type the code the Connector shows on YOUR screen, check which computer is asking
 * (name, system, where from, when), then approve. The code is never filled in from a link (device-flow phishing guard).
 */
export function ApproveCode() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState("");
  const [found, setFound] = useState<PendingComputer | null>(null);
  const act = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  if (found) {
    const mins = found.minutesAgo;
    return (
      <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
        <div className="text-sm">
          <div className="font-medium">Connect &ldquo;{found.name}&rdquo;?</div>
          <div className="text-xs text-muted-foreground">
            {found.platform ?? "unknown system"}
            {found.version ? ` · Connector v${found.version}` : ""} · started {mins === 0 ? "just now" : `${mins} min ago`}
            {found.origin ? ` · from ${found.origin}` : ""} · code {found.code}
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Approve only if this is your own computer and you just ran <span className={code}>pair</span> on it. A computer you
            approve receives the text and photo frames of the AI jobs you send it — never approve a code someone sent you.
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              act(async () => {
                const { name } = unwrap(await approvePairing(found.code));
                toast.success(`"${name}" is connected — it appears below in a few seconds`);
                setFound(null);
                setValue("");
                router.push("/account/ai");
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Approve this computer
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setFound(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input
        className={cn(inputCls, "w-40 font-mono uppercase tracking-widest")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ABCD-EFGH"
        aria-label="Code shown by the Connector on your computer"
        autoComplete="off"
        maxLength={9}
      />
      <Button
        size="sm"
        disabled={pending || value.replace(/[^A-Za-z0-9]/g, "").length !== 8}
        onClick={() => act(async () => setFound(unwrap(await lookupPairing(value))))}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null} Check code
      </Button>
    </div>
  );
}

// Template ids → names (public/connector/clipwaltz-connector.mjs TEMPLATES).
const VIDEO_LABELS: Record<string, string> = { "wan-i2v-v1": "Image → video", "clipwaltz-talking-v1": "Talking photo", "infinitetalk-v1": "Talking photo, high quality (24 GB)" };

/** Connector v0.2: GPU + which videos this computer's ComfyUI can make, or what's missing. */
function VideoStatus({ c }: { c: MyComputer }) {
  if (!c.video) return null; // a v0.1 Connector, or never reported
  if (!c.video.ok) return <p className="text-xs text-muted-foreground">Video: {c.video.error ?? "ComfyUI not found"} — optional, see below.</p>;
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>Video: {c.gpu ? `${c.gpu.name}, ${Math.round(c.gpu.vramMb / 1024)} GB` : "no NVIDIA GPU found"}</p>
      {Object.keys(VIDEO_LABELS).map((id) => (
        <p key={id} className={cn("flex items-start gap-1.5", c.video!.ready.includes(id) ? "text-emerald-500" : "")}>
          {c.video!.ready.includes(id) ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
          {VIDEO_LABELS[id]}
          {c.video!.ready.includes(id) ? " — ready, free in Waltz AI" : ` — needs ${(c.video!.missing[id] ?? ["the latest Connector"]).join(", ")}`}
        </p>
      ))}
    </div>
  );
}

function ComputerRow({ c }: { c: MyComputer }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className={cn("size-2 rounded-full", c.online ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          {c.name}
          <span className="text-xs font-normal text-muted-foreground">
            {c.online ? "online" : c.lastSeenAt ? `offline · last seen ${new Date(c.lastSeenAt).toLocaleString()}` : "offline"}
            {c.platform ? ` · ${c.platform}` : ""}
            {c.version ? ` · v${c.version}` : ""}
          </span>
        </div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => confirm(`Disconnect "${c.name}"? Its Connector stops working at once.`) && run(() => removeComputer(c.id).then(unwrap), "Computer disconnected")}>
          <Trash2 className="size-4" /> Disconnect
        </Button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Model for writing
        <select
          className={cn(inputCls, "h-8 min-w-48")}
          value={c.model ?? ""}
          disabled={pending || !c.models.length}
          onChange={(e) => run(() => setComputerModel(c.id, e.target.value || null).then(unwrap), "Model saved")}
        >
          <option value="">{c.models.length ? `Automatic (${c.models[0]})` : "No models reported yet"}</option>
          {c.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <VideoStatus c={c} />
      {c.lastError ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {c.lastErrorAt ? new Date(c.lastErrorAt).toLocaleString() : ""}: {c.lastError}
        </p>
      ) : c.lastUsedAt ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-500">
          <CheckCircle2 className="size-3.5" /> Last wrote for you {new Date(c.lastUsedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

export function ComputerSettings({ computers }: { computers: MyComputer[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium"><Monitor className="size-4" /> Your computers</h2>
        <p className="text-xs text-muted-foreground">
          Run AI on your own computer — free, and what it works on goes only to your computer. The ClipWaltz Connector only
          makes outbound connections to ClipWaltz (nothing to open on your router); it sends writing jobs to your local
          Ollama and, if you set it up, video jobs to your local ComfyUI — nothing else.
        </p>
      </div>
      {computers.map((c) => (
        <ComputerRow key={c.id} c={c} />
      ))}
      <div className="space-y-2 rounded-xl border border-dashed border-border p-3 text-sm">
        <div className="font-medium">Connect a computer</div>
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>
            Install <a className="underline" href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> and a model
            (for example <span className={code}>ollama pull qwen3:8b</span>), and <a className="underline" href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js 18 or newer</a>.
          </li>
          <li>
            <a className="inline-flex items-center gap-1 underline" href="/connector/clipwaltz-connector.mjs" download>
              <Download className="size-3.5" /> Download the ClipWaltz Connector
            </a>{" "}
            and, in that folder, run <span className={code}>node clipwaltz-connector.mjs pair</span>.
          </li>
          <li>Type the code it shows on your screen here, check it&apos;s your computer, and approve:</li>
        </ol>
        <ApproveCode />
        <p className="text-xs text-muted-foreground">
          Then keep it running with <span className={code}>node clipwaltz-connector.mjs</span>. Jobs wait up to 45 seconds for
          your computer; if it&apos;s off, the built-in model writes for you.
        </p>
      </div>
      <div className="space-y-2 rounded-xl border border-dashed border-border p-3 text-sm">
        <div className="font-medium">Optional: make videos on your own GPU (free)</div>
        <p className="text-xs text-muted-foreground">
          With an NVIDIA GPU (8 GB+, 10 GB recommended) the Connector can render Waltz AI clips — image → video and talking
          photos — on your computer at no credit cost. Your photo and speech go to your computer and the finished video comes back.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>
            Install <a className="underline" href="https://github.com/Comfy-Org/ComfyUI/releases" target="_blank" rel="noreferrer">ComfyUI</a> (Windows:
            the portable NVIDIA download) and start it once.
          </li>
          <li>
            Image → video: put <span className={code}>wan2.2_ti2v_5B_fp16.safetensors</span> in models/diffusion_models,{" "}
            <span className={code}>umt5_xxl_fp8_e4m3fn_scaled.safetensors</span> in models/text_encoders and{" "}
            <span className={code}>wan2.2_vae.safetensors</span> in models/vae (all from Hugging Face, Comfy-Org/Wan_2.2_ComfyUI_Repackaged).
          </li>
          <li>
            Talking photo: install the{" "}
            <a className="underline" href="https://github.com/phoenixtekk/ComfyUI-ClipWaltz" target="_blank" rel="noreferrer">
              ClipWaltz node pack
            </a>{" "}
            — in ComfyUI/custom_nodes run{" "}
            <span className={code}>git clone https://github.com/phoenixtekk/ComfyUI-ClipWaltz comfyui-clipwaltz</span> (no git?{" "}
            <a className="inline-flex items-center gap-1 underline" href="/connector/comfyui-clipwaltz.zip" download>
              <Download className="size-3.5" /> zip
            </a>
            ), then follow its README (two commands: install, then download the models).
          </li>
          <li>Restart ComfyUI, then the Connector — this page shows what your computer can make.</li>
        </ol>
      </div>
    </section>
  );
}
