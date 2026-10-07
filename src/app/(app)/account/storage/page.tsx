import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { getCloudRouting, getCloudStorage } from "@/lib/cloud-actions";
import { CloudStorageSettings } from "@/components/cloud-storage-settings";

export const metadata = { title: "Cloud storage" };

export default async function CloudStoragePage({ searchParams }: { searchParams: Promise<{ provider?: string; result?: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in?redirect=%2Faccount%2Fstorage");
  const { provider, result } = await searchParams;
  const [data, routing] = await Promise.all([getCloudStorage(), getCloudRouting()]);
  if (!data.ok) throw new Error(data.error);
  if (!routing.ok) throw new Error(routing.error);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Cloud storage</h1>
          <Link href="/account/storage/analytics" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
            <BarChart3 className="size-4" /> Analytics
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect your cloud storage and every video you finish is saved there automatically, in a
          <span className="font-medium text-foreground"> ClipWaltz</span> folder sorted by category and project.
        </p>
      </div>
      <CloudStorageSettings providers={data.data.providers} recent={data.data.recent} provider={provider} result={result} routing={routing.data} />
    </div>
  );
}
