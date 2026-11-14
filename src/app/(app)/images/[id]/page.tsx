import { notFound } from "next/navigation";
import { requireUserId, getSession } from "@/lib/auth";
import { designView, loadDesign } from "@/lib/image-ad/designs";
import { socialAllowedFor } from "@/lib/social/access";
import { ImageStudio } from "@/components/images/image-studio";

export const metadata = { title: "Waltz Image" };

export default async function ImageDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const d = await loadDesign(userId, id, "viewer");
  if (!d) notFound();
  const session = await getSession();
  const view = await designView(userId, d.row, d.role);
  return <ImageStudio initial={view} publishEnabled={socialAllowedFor(session?.user.email)} />;
}
