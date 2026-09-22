import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/admin";
import { listBatches } from "@/lib/batch";
import { listPresets } from "@/lib/presets";
import { getMusicTracks } from "@/lib/music";
import { BatchManager } from "@/components/batch-manager";

export const metadata = { title: "Auto-Batch" };

export default async function BatchPage() {
  const admin = await getAdminSession();
  if (!admin) redirect("/projects");
  const userId = (admin as { user: { id: string } }).user.id;

  const [batches, presets, tracks] = await Promise.all([
    listBatches(userId),
    listPresets(),
    getMusicTracks(userId),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="cw-glass flex items-center justify-between gap-3 rounded-2xl p-4">
        <div>
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Auto-Batch Studio</h1>
          <p className="text-sm text-muted-foreground">
            Render folders of media into videos automatically, on a schedule.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Admin</Link>
      </div>
      <BatchManager
        batches={batches}
        presets={presets.map((p) => ({ id: p.id, name: p.name }))}
        tracks={tracks.map((t) => ({ id: t.id, title: t.title }))}
      />
    </div>
  );
}
