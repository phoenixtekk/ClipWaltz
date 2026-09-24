import Link from "next/link";
import { Button } from "@/components/ui/button";

// Routes to the New Project wizard (template selection → import).
export function NewProjectButton({
  size = "default",
  label = "+ New Project",
  workspaceId,
}: {
  size?: "default" | "sm" | "lg";
  label?: string;
  workspaceId?: string; // create inside this (shared) workspace; default = personal
}) {
  const href = workspaceId ? `/projects/new?ws=${encodeURIComponent(workspaceId)}` : "/projects/new";
  return (
    <Button render={<Link href={href} />} size={size}>
      {label}
    </Button>
  );
}
