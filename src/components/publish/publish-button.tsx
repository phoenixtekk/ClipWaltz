"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { publishEnabled } from "@/lib/social/ui-actions";

// One lookup per page load: is Social Publishing on for this account? (Flag on, or a site admin while it is off.)
let enabled: Promise<boolean> | null = null;
function usePublishEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    enabled ??= publishEnabled().catch(() => false);
    enabled.then((v) => {
      if (live) setOn(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return on;
}

/**
 * "Publish" on a finished render, export or campaign variant: opens the composer with the video attached, its
 * AI-written description as the text and networks suggested by its aspect ratio. Hidden when publishing is off.
 */
export function PublishButton({
  renderId,
  exportId,
  variant = "outline",
  size = "default",
  iconOnly = false,
  className,
}: {
  renderId?: string;
  exportId?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "xs" | "icon-sm";
  iconOnly?: boolean;
  className?: string;
}) {
  const on = usePublishEnabled();
  if (!on || (!renderId && !exportId)) return null;
  const href = renderId ? `/publish/compose?render=${encodeURIComponent(renderId)}` : `/publish/compose?export=${encodeURIComponent(exportId!)}`;
  return (
    <Link
      href={href}
      title="Publish to your social channels"
      aria-label={iconOnly ? "Publish to social channels" : undefined}
      className={cn(buttonVariants({ variant, size: iconOnly ? "icon-sm" : size }), className)}
    >
      <Send className="size-4" />
      {iconOnly ? null : "Publish"}
    </Link>
  );
}
