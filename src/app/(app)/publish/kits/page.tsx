import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { KitList } from "@/components/kits/kit-list";
import { publishPage } from "@/lib/social/page-context";
import { listKits } from "@/lib/kits/kits";
import { roleAtLeast } from "@/lib/workspace";

export const metadata = { title: "Post kits · Publish" };

export default async function KitsPage() {
  const sc = await publishPage();
  if (!sc) return null;
  const kits = await listKits(sc.workspaceId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          <Package className="mr-1 inline size-4 align-[-3px]" />
          A post kit turns one video, image design, upload or idea into everything you need to post it yourself. Each network
          gets a caption and hashtags written for it, a title where it has one, and pictures made at its size. Copy, download,
          post, then tick it off. ClipWaltz doesn&apos;t post anything for you.
        </p>
        {roleAtLeast(sc.role, "editor") ? (
          <Link href="/publish/kits/new" className={buttonVariants()}><Plus /> New kit</Link>
        ) : null}
      </div>
      <KitList kits={kits} />
    </div>
  );
}
