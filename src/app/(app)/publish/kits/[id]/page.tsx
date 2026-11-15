import { notFound } from "next/navigation";
import { KitDetail } from "@/components/kits/kit-detail";
import { publishPage } from "@/lib/social/page-context";
import { getKitRow, kitView } from "@/lib/kits/kits";

export const metadata = { title: "Post kit · Publish" };

export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const sc = await publishPage();
  if (!sc) return null;
  const { id } = await params;
  const row = await getKitRow(sc.workspaceId, id);
  if (!row) notFound();
  return <KitDetail initial={kitView(row, sc.role)} />;
}
