"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { submitFeedback } from "@/lib/feedback-actions";

const KINDS = [
  { key: "idea", label: "Idea" },
  { key: "bug", label: "Something's broken" },
  { key: "praise", label: "I like this" },
  { key: "other", label: "Other" },
] as const;

/** Beta feedback form (opened from the user menu). Records the page it was sent from. */
export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [kind, setKind] = useState<string>("idea");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const send = () =>
    start(async () => {
      try {
        await submitFeedback(kind, message, pathname);
        toast.success("Thanks — we read every message.");
        setMessage("");
        onClose();
      } catch (e) {
        toast.error((e as Error).message || "Could not send");
      }
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="fb-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-background p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="fb-title" className="text-base font-semibold">Send feedback</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}
              className={cn("rounded-full border px-3 py-1 text-sm", kind === k.key ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>
              {k.label}
            </button>
          ))}
        </div>
        <textarea ref={box} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={5}
          aria-label="Your feedback" placeholder="What would make ClipWaltz better for you?"
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Sent with the page you&apos;re on.</span>
          <Button onClick={send} disabled={pending || message.trim().length < 3}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Send
          </Button>
        </div>
      </div>
    </div>
  );
}
