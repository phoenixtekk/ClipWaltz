"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trophy, Crown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminContest, ContestEntry } from "@/lib/contest";
import { createContest, closeContest } from "@/lib/contest-actions";

export function AdminContest({
  contests,
  activeEntries,
}: {
  contests: AdminContest[];
  activeEntries: ContestEntry[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [theme, setTheme] = useState("");
  const [desc, setDesc] = useState("");

  const active = contests.find((c) => c.status === "active") ?? null;
  const past = contests.filter((c) => c.status === "closed");
  const leader = activeEntries[0] ?? null;

  function create() {
    if (!theme.trim()) return;
    start(async () => {
      try {
        await createContest({ theme, description: desc });
        setTheme("");
        setDesc("");
        toast.success("Challenge started.");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not start the challenge.");
      }
    });
  }

  function close(id: string) {
    if (!window.confirm("Close this challenge and grant the likes-leader Pro (30 days)?")) return;
    start(async () => {
      try {
        const { winner } = await closeContest(id);
        toast.success(winner ? `Closed — ${winner} won and was granted Pro.` : "Closed (no entries).");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not close the challenge.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {active ? (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <Trophy className="size-3.5" /> Active challenge
              </p>
              <p className="mt-1 text-lg font-semibold">{active.theme}</p>
              {active.description ? <p className="text-sm text-muted-foreground">{active.description}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">{active.entries} entr{active.entries === 1 ? "y" : "ies"}</p>
            </div>
            <Button variant="destructive" onClick={() => close(active.id)} disabled={pending}>
              <Crown className="size-4" /> Close &amp; crown winner
            </Button>
          </div>
          {activeEntries.length > 0 ? (
            <div className="mt-3 border-t border-primary/20 pt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Leaderboard {leader ? `— ${leader.creator} leads` : ""}
              </p>
              <ol className="space-y-1 text-sm">
                {activeEntries.slice(0, 5).map((e, i) => (
                  <li key={e.renderId} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="text-muted-foreground">{i + 1}.</span> {e.creator} — {e.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground">♥ {e.likes}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-sm font-medium">Start a Monthly Theme Challenge</p>
          <Input value={theme} maxLength={120} onChange={(e) => setTheme(e.target.value)} placeholder="Theme, e.g. “Autumn light”" />
          <Input value={desc} maxLength={400} onChange={(e) => setDesc(e.target.value)} placeholder="Short description (optional)" />
          <Button onClick={create} disabled={pending || !theme.trim()}>Start challenge</Button>
        </div>
      )}

      {past.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Past challenge</th>
                <th className="px-4 py-2 font-medium">Entries</th>
                <th className="px-4 py-2 font-medium">Winner</th>
                <th className="px-4 py-2 font-medium">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {past.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-medium">{c.theme}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.entries}</td>
                  <td className="px-4 py-2">{c.winnerName ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {c.closedAt ? new Date(c.closedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
