"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const ITEMS: { href: string; label: string }[] = [
  { href: "/publish", label: "Overview" },
  { href: "/publish/compose", label: "Compose" },
  { href: "/publish/posts", label: "Posts" },
  { href: "/publish/drafts", label: "Drafts" },
  { href: "/publish/favorites", label: "Favorites" },
  { href: "/publish/shared", label: "Shared" },
  { href: "/publish/calendar", label: "Calendar" },
  { href: "/publish/auto", label: "Auto Post" },
  { href: "/publish/explainers", label: "Explainers" },
  { href: "/publish/shorts", label: "Shorts" },
  { href: "/publish/podcast", label: "Podcast" },
  { href: "/publish/by-hand", label: "Post by hand" },
  { href: "/publish/analytics", label: "Analytics" },
  { href: "/publish/comments", label: "Comments" },
  { href: "/publish/networks", label: "Networks" },
];

/** The Publish section's own navigation (a horizontal, scrollable tab strip). */
export function PublishNav() {
  const path = usePathname();
  return (
    <nav aria-label="Publish" className="-mx-1 overflow-x-auto">
      <ul className="flex w-max items-center gap-1 rounded-lg bg-muted p-[3px]">
        {ITEMS.map((i) => {
          const active = i.href === "/publish" ? path === "/publish" : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
