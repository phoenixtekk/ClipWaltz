"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertTriangle, Loader2, ExternalLink, FolderTree, CloudUpload, Unplug, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { disconnectCloud, saveRenderToCloud, setCloudFolderLayout, type CloudProviderState, type CloudRouting, type RecentSave } from "@/lib/cloud-actions";
import { CloudRoutingEditor } from "@/components/cloud-routing-editor";
import { PROVIDER_LABEL, isCloudProvider, type CloudProviderId, type FolderLayout } from "@/lib/cloud/types";
import { unwrap } from "@/lib/action-result";
import { LocalDate } from "@/components/local-date";

// Brand-neutral marks: a coloured tile with the provider's initial (no third-party logos shipped).
const MARK: Record<CloudProviderId, { bg: string; text: string }> = {
  google_drive: { bg: "#1a73e8", text: "G" },
  onedrive: { bg: "#0364b8", text: "O" },
  dropbox: { bg: "#0061fe", text: "D" },
};
const WHERE: Record<CloudProviderId, string> = {
  google_drive: "My Drive › ClipWaltz. ClipWaltz can only see the files it creates there.",
  onedrive: "OneDrive › ClipWaltz.",
  dropbox: "Dropbox › ClipWaltz (inside Apps if the app uses an app folder).",
};
const LAYOUTS: { key: FolderLayout; label: string }[] = [
  { key: "category", label: "ClipWaltz › Category › Project" },
  { key: "project", label: "ClipWaltz › Project" },
  { key: "flat", label: "ClipWaltz (all in one folder)" },
];
const RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "connected — new videos will be saved there automatically." },
  error: { ok: false, text: "couldn't be connected. Please try again." },
  cancelled: { ok: false, text: "wasn't connected (permission was declined)." },
  unavailable: { ok: false, text: "isn't available yet." },
};

export function CloudStorageSettings({
  providers, recent, provider, result, routing,
}: {
  providers: CloudProviderState[];
  routing: CloudRouting;
  recent: RecentSave[];
  provider?: string;
  result?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<unknown>, ok?: string) =>
    start(async () => {
      try { await fn(); if (ok) toast.success(ok); router.refresh(); } catch (e) { toast.error((e as Error).message || "Something went wrong."); }
    });

  // Saves in progress → refresh every few seconds.
  const busy = recent.some((r) => r.status === "queued" || r.status === "uploading");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [busy, router]);

  const banner = provider && isCloudProvider(provider) && result && RESULT[result] ? { name: PROVIDER_LABEL[provider], ...RESULT[result] } : null;

  return (
    <div className="space-y-6">
      {banner ? (
        <p role="status" className={cn("rounded-xl border px-4 py-3 text-sm", banner.ok ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "border-destructive/40 bg-destructive/10 text-destructive")}>
          {banner.name} {banner.text}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {providers.map((p) => {
          const c = p.connection;
          const mark = MARK[p.id];
          return (
            <section key={p.id} className="cw-glass flex flex-col gap-3 rounded-2xl p-4" aria-labelledby={`cs-${p.id}`}>
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold text-white" style={{ background: mark.bg }} aria-hidden>{mark.text}</span>
                <div className="min-w-0 flex-1">
                  <h2 id={`cs-${p.id}`} className="font-semibold">{PROVIDER_LABEL[p.id]}</h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {c ? <>Connected{c.accountLabel ? <> as <span className="text-foreground">{c.accountLabel}</span></> : null}</> : p.available ? "Not connected" : "Coming soon"}
                  </p>
                </div>
                {c ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><Check className="size-3" /> On</span> : null}
              </div>

              {c?.lastError ? (
                <p className="flex gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> <span>Last save failed: {c.lastError}</span>
                </p>
              ) : null}

              {c ? (
                <div className="space-y-3 text-sm">
                  <label className="block space-y-1">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><FolderTree className="size-3.5" /> Folders</span>
                    <select
                      value={c.folderLayout} disabled={pending}
                      onChange={(e) => act(async () => unwrap(await setCloudFolderLayout(p.id, e.target.value as FolderLayout)))}
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                    </select>
                  </label>
                  <p className="text-xs text-muted-foreground">Saved in {WHERE[p.id]}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {p.available ? `Videos go to ${WHERE[p.id]}` : `${PROVIDER_LABEL[p.id]} isn't switched on for ClipWaltz yet.`}
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                {p.available ? (
                  <Button variant={c ? "outline" : "default"} size="sm" nativeButton={false} render={<a href={`/api/oauth/cloud/${p.id}/start`} />}>
                    {c ? <><RefreshCw className="size-3.5" /> Reconnect</> : <><CloudUpload className="size-3.5" /> Connect</>}
                  </Button>
                ) : null}
                {c ? (
                  <Button variant="ghost" size="sm" disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Disconnect ${PROVIDER_LABEL[p.id]}? Videos already saved stay in your ${PROVIDER_LABEL[p.id]}.`))
                        act(async () => unwrap(await disconnectCloud(p.id)), `${PROVIDER_LABEL[p.id]} disconnected`);
                    }}>
                    <Unplug className="size-3.5" /> Disconnect
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {routing.connected.length ? <CloudRoutingEditor routing={routing} /> : null}

      <p className="flex gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        ClipWaltz only uploads your finished videos — it never reads or deletes anything else, and your sign-in to each
        service is stored encrypted. You can also save any past version from a project&apos;s Render history (the cloud button).
      </p>

      <section className="cw-glass space-y-2 rounded-2xl p-4">
        <h2 className="text-sm font-semibold">Recent saves</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing saved yet. Your next finished video will appear here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                {r.status === "done" ? <Check className="size-4 shrink-0 text-emerald-600" />
                  : r.status === "failed" ? <AlertTriangle className="size-4 shrink-0 text-destructive" />
                    : <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{r.projectTitle} <span className="text-muted-foreground">v{r.version} → {PROVIDER_LABEL[r.provider]}</span></p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.status === "failed" ? r.error : r.status === "done" ? r.remotePath : r.status === "uploading" ? "Uploading…" : "Waiting to upload…"}
                    {" · "}<LocalDate value={r.at} />
                  </p>
                </div>
                {r.status === "done" && r.remoteUrl ? (
                  <a href={r.remoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Open <ExternalLink className="size-3" />
                  </a>
                ) : null}
                {r.status === "failed" ? (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => act(async () => unwrap(await saveRenderToCloud(r.renderId, r.provider)), "Trying again…")}>
                    Retry
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
