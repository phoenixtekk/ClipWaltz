"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Package } from "lucide-react";
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
 * "Post kit" on a finished render, export or campaign variant: opens Publish → Post kits → New with the video as the
 * source (captions per network, written for posting by hand — owner 2026-11-14). Hidden when Publish is off.
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
  const href = renderId ? `/publish/kits/new?render=${encodeURIComponent(renderId)}` : `/publish/kits/new?export=${encodeURIComponent(exportId!)}`;
  return (
    <Link
      href={href}
      title="Make a post kit: captions and files for each network"
      aria-label={iconOnly ? "Make a post kit" : undefined}
      className={cn(buttonVariants({ variant, size: iconOnly ? "icon-sm" : size }), className)}
    >
      <Package className="size-4" />
      {iconOnly ? null : "Post kit"}
    </Link>
  );
}
