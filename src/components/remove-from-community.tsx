"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";
import { shareRender } from "@/lib/feed-actions";

/** Owner-only control on a watch page to pull their video from the community feed. */
export function RemoveFromCommunity({ renderId }: { renderId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [removed, setRemoved] = useState(false);

  function remove() {
    if (!window.confirm("Remove this video from the community? It becomes private again.")) return;
    start(async () => {
      try {
        await shareRender(renderId, "private");
        setRemoved(true);
        toast.success("Removed from the community.");
        router.push("/community");
        router.refresh();
      } catch {
        toast.error("Could not remove it.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending || removed}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-60"
    >
      <EyeOff className="size-4" /> {removed ? "Removed" : "Remove from community"}
    </button>
  );
}
