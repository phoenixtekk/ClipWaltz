import Link from "next/link";
import { Button } from "@/components/ui/button";

// Routes to the New Project wizard (template selection → import).
export function NewProjectButton({
  size = "default",
  label = "+ New Project",
}: {
  size?: "default" | "sm" | "lg";
  label?: string;
}) {
  return (
    <Button render={<Link href="/projects/new" />} size={size}>
      {label}
    </Button>
  );
}
