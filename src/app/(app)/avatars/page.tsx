import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { listPresenters } from "@/lib/presenter-actions";
import { listLibraryPresenters } from "@/lib/presenter-library-actions";
import { AvatarsManager } from "@/components/avatars-manager";

export const metadata = { title: "Waltz Avatar" };

export default async function AvatarsPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in?redirect=%2Favatars");
  const [res, lib] = await Promise.all([listPresenters(), listLibraryPresenters()]);
  if (!res.ok) throw new Error(res.error);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Waltz Avatar</h1>
        <p className="text-sm text-muted-foreground">
          Your own AI presenter: record yourself once, then any script in a WaltzDeck video is spoken by you — your face,
          lip-synced. Every presenter video is labelled “AI-generated”.
        </p>
      </div>
      <AvatarsManager initial={res.data} library={lib.ok ? lib.data : []} />
    </div>
  );
}
