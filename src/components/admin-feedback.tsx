"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "cn";
import { setFeedbackStatus, type FeedbackItem } from "@/lib/feedback-actions";

const KIND_LABEL: Record<string, string> = { idea: "Idea", bug: "Bug", praise: "Praise", other: "Other" };

/** /admin → Feedback inbox (beta). Newest first; mark read / done. */
export function AdminFeedback({ items }: { items: FeedbackItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const mark = (id: string, status: "read" | "done" | "new") =>
    start(async () => {
      try { await setFeedbackStatus(id, status); router.refresh(); } catch (e) { toast.error((e as Error).message); }
    });
  if (!items.length) return <p className="text-sm text-muted-foreground">No feedback yet. It arrives from “Send feedback” in the user menu.</p>;
  return (
    <ul className="space-y-2">
      {items.map((f) => (
        <li key={f.id} className={cn("rounded-xl border border-border p-3 text-sm", f.status === "done" && "opacity-60")}>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={cn("rounded-full border px-2 py-0.5 font-medium", f.kind === "bug" ? "border-destructive/50 text-destructive" : "border-border")}>{KIND_LABEL[f.kind] ?? f.kind}</span>
            <span>{f.email ?? "deleted account"}</span>
            {f.page ? <span>· {f.page}</span> : null}
            <span>· {new Date(f.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
            {f.status === "new" ? <span className="font-semibold text-primary">· new</span> : null}
          </div>
          <p className="whitespace-pre-wrap">{f.message}</p>
          <div className="mt-2 flex gap-3 text-xs">
            {f.status !== "read" && f.status !== "done" ? <button type="button" disabled={pending} onClick={() => mark(f.id, "read")} className="text-muted-foreground hover:text-foreground">Mark read</button> : null}
            {f.status !== "done" ? <button type="button" disabled={pending} onClick={() => mark(f.id, "done")} className="text-muted-foreground hover:text-foreground">Done</button>
              : <button type="button" disabled={pending} onClick={() => mark(f.id, "new")} className="text-muted-foreground hover:text-foreground">Reopen</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
