"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setWatermarkPaidPlans } from "@/lib/admin-actions";

/** /admin switch: does the ClipWaltz logo go on Plus/Pro videos too? (Free is always watermarked.) */
export function AdminWatermark({ paidWatermarked }: { paidWatermarked: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(paidWatermarked);
  const [pending, start] = useTransition();

  const toggle = () =>
    start(async () => {
      const next = !on;
      try {
        await setWatermarkPaidPlans(next);
        setOn(next);
        toast.success(next ? "Paid plans are watermarked again" : "Paid plans are now watermark-free");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not save");
      }
    });

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1 text-sm">
        <p className="font-medium">Watermark paid plans (Plus &amp; Pro)</p>
        <p className="text-muted-foreground">
          The logo goes bottom-left on every music video, AI generation, enhancement, storyboard and export.
          Free is always watermarked. Applies to new videos only — finished ones keep what they were made with.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Watermark paid plans"
        disabled={pending}
        onClick={toggle}
        className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-muted"}`}
      >
        <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
        {pending && <Loader2 className="absolute -right-6 size-4 animate-spin text-muted-foreground" />}
      </button>
    </div>
  );
}
