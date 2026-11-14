import { requireUserId } from "@/lib/auth";
import { activeWorkspaceId } from "@/lib/active-workspace";
import { listDesigns } from "@/lib/image-ad/designs";
import { AdsExport } from "@/components/images/ads-export";

export const metadata = { title: "Export for ads · Waltz Image" };
export const dynamic = "force-dynamic";

// G11: pick designs → Meta Ads Manager bulk-import CSV + Google Ads Editor (Performance Max) CSV, with the images.
export default async function AdsExportPage() {
  const userId = await requireUserId();
  const designs = await listDesigns(await activeWorkspaceId(userId));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Export for ads</h1>
        <p className="text-sm text-muted-foreground">
          Download your ads as files you import into Meta Ads Manager and Google Ads Editor. ClipWaltz never connects to your ad
          accounts — nothing is created or spent until you import and turn it on yourself.
        </p>
      </div>
      <AdsExport designs={designs} />
    </div>
  );
}
