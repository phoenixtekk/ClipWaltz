"use client";
import { useState } from "react";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** G9: Approve / Request changes on the public review link. The token in the URL is the only credential. */
export function ReviewDecision({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approved" | "changes_requested" | null>(null);
  const [done, setDone] = useState<"approved" | "changes_requested" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(decision: "approved" | "changes_requested") {
    setError(null);
    if (decision === "changes_requested" && !note.trim()) {
      setError("Say what needs to change, so the author knows what to fix.");
      return;
    }
    setBusy(decision);
    try {
      const r = await fetch(`/api/social/review/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note, name }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setError(j.error ?? "That didn't work — try again.");
      else setDone(decision);
    } catch {
      setError("That didn't work — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{done === "approved" ? "Approved — thank you" : "Changes requested — thank you"}</CardTitle>
          <CardDescription>
            {done === "approved" ? "The author has been told it can go out." : "The author has your note and will send a new version."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your decision</CardTitle>
        <CardDescription>This post is waiting for approval. Nothing is published until it is approved.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="rv-name">Your name (optional)</Label>
          <Input id="rv-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rv-note">Note (needed when you request changes)</Label>
          <Textarea id="rv-note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className="min-h-24" />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy !== null} onClick={() => void send("approved")}>
            {busy === "approved" ? <Loader2 className="animate-spin" /> : <Check />} Approve
          </Button>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void send("changes_requested")}>
            {busy === "changes_requested" ? <Loader2 className="animate-spin" /> : <MessageSquareWarning />} Request changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
