import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthUserId } from "@/lib/auth";
import { getCloudAnalytics } from "@/lib/cloud-actions";
import { CloudAnalyticsView } from "@/components/cloud-analytics";

export const metadata = { title: "Cloud storage analytics" };

export default async function CloudAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in?redirect=%2Faccount%2Fstorage%2Fanalytics");
  const { days } = await searchParams;
  const data = await getCloudAnalytics(Number(days) || 30);
  if (!data.ok) throw new Error(data.error);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <Link href="/account/storage" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Cloud storage
        </Link>
        <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Cloud storage analytics</h1>
        <p className="text-sm text-muted-foreground">What ClipWaltz has saved to your connected storage, how big it is, and how each service is doing.</p>
      </div>
      <CloudAnalyticsView data={data.data} />
    </div>
  );
}
