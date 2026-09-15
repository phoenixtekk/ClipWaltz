"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createProject } from "@/lib/project-actions";

export function NewProjectButton({
  size = "default",
  label = "+ New Project",
}: {
  size?: "default" | "sm" | "lg";
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      try {
        await createProject();
        router.refresh();
        // TODO: once the New Project wizard (screen 04) exists, route to it:
        // router.push(`/projects/${id}/import`);
      } catch {
        toast.error("Could not create a project. Please try again.");
      }
    });
  }

  return (
    <Button size={size} onClick={onClick} disabled={pending}>
      {pending ? "Creating…" : label}
    </Button>
  );
}
