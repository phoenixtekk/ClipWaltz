"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getDriveStatus, backupToDrive, type DriveStatus } from "@/lib/drive-actions";

/**
 * Google Drive backup of a project's original uploads (restored after the Media Library removal).
 * Hidden when Drive isn't configured on the server. Connect → OAuth and back to this page.
 */
export function DriveBackupButton({ projectId, total, backedUp }: { projectId: string; total: number; backedUp: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [pending, start] = useTransition();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => { getDriveStatus().then(setStatus, () => {}); }, []);
  // While backups run in the background, refresh the clip list every 20 s until all are done.
  const active = waiting && backedUp < total;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [active, router]);

  if (!status?.configured || total === 0) return null;
  const left = total - backedUp;
  const cls = "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:border-[color:var(--cw-violet)] hover:text-[color:var(--cw-violet)] disabled:opacity-50";

  if (!status.connected) {
    return (
      <a className={cls} href={`/api/oauth/google/drive/start?returnTo=${encodeURIComponent(`/projects/${projectId}/edit`)}`}>
        <CloudUpload className="size-3.5" /> Connect Google Drive
      </a>
    );
  }
  if (left <= 0) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600"><Check className="size-3.5" /> Originals backed up to Drive</span>;
  }
  return (
    <button type="button" className={cls} disabled={pending || active}
      onClick={() => start(async () => {
        try {
          const r = await backupToDrive(projectId);
          setWaiting(r.started > 0);
          toast.message(r.started ? `Backing up ${r.started} original${r.started === 1 ? "" : "s"} to Google Drive…` : "Nothing new to back up.");
        } catch (e) {
          toast.error((e as Error).message || "Could not start the backup.");
        }
      })}>
      {active ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
      {active ? `Backing up… ${backedUp}/${total}` : `Back up ${left} original${left === 1 ? "" : "s"} to Drive`}
    </button>
  );
}
