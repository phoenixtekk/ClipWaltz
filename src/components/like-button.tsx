"use client";
import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { toggleLike } from "@/lib/feed-actions";

export function LikeButton({
  renderId,
  initialLiked,
  initialCount,
}: {
  renderId: string;
  initialLiked: boolean;
  initialCount: number;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, start] = useTransition();

  function onClick() {
    const prevLiked = liked;
    const prevCount = count;
    const next = !liked;
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    start(async () => {
      try {
        const res = await toggleLike(renderId);
        setLiked(res);
      } catch {
        setLiked(prevLiked);
        setCount(prevCount);
        toast.error("Sign in to like creations.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-60"
    >
      <Heart className={cn("size-4", liked && "fill-red-500 text-red-500")} />
      {count}
    </button>
  );
}
