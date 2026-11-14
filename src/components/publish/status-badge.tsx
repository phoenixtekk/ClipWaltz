import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/social/ui-types";

const VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  published: "default",
  scheduled: "secondary",
  queued: "secondary",
  publishing: "secondary",
  failed: "destructive",
  partial: "destructive",
  handoff: "outline",
  draft: "outline",
};

/** A post's (or one destination's) status as a shadcn Badge. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status] ?? "outline"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function ApprovalBadge({ status }: { status: string }) {
  if (status === "pending") return <Badge variant="secondary">Awaiting approval</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (status === "approved") return <Badge variant="outline">Approved</Badge>;
  return null;
}
