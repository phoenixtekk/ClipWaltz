"use client";
import { useState, useTransition } from "react";
import { Trophy, Check } from "lucide-react";
import { toast } from "sonner";
import { enterContest, withdrawContest } from "@/lib/contest-actions";

/** Enter/withdraw the current render in the active Monthly Theme Challenge. */
export function EnterContestButton({
  renderId,
  theme,
  initialEntered,
  isPublic,
}: {
  renderId: string;
  theme: string;
  initialEntered: boolean;
  isPublic: boolean;
}) {
  const [entered, setEntered] = useState(initialEntered);
  const [pending, start] = useTransition();

  function toggle() {
    start(async () => {
      try {
        if (entered) {
          await withdrawContest(renderId);
          setEntered(false);
        } else {
          const { theme: t } = await enterContest(renderId);
          setEntered(true);
          toast.success(`Entered the “${t}” challenge — likes are votes!`);
        }
      } catch (e) {
        toast.error((e as Error).message || "Could not update your entry.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-emerald-600/20 pt-3 text-xs">
      <span className="inline-flex items-center gap-1 font-medium text-[color:var(--cw-violet)]">
        <Trophy className="size-3.5" /> Challenge: {theme}
      </span>
      {!isPublic && !entered ? (
        <span className="text-muted-foreground">Set sharing to Public to enter.</span>
      ) : entered ? (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 font-medium text-primary disabled:opacity-60"
        >
          <Check className="size-3.5" /> Entered — withdraw
        </button>
      ) : (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          Enter this challenge
        </button>
      )}
    </div>
  );
}
