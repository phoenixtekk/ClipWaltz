"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Coins, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { unwrap } from "@/lib/action-result";
import { LocalDate } from "@/components/local-date";
import { buildContentPlan, saveContentPlan } from "@/lib/social/ui-actions";
import { providerName, type DestinationView } from "@/lib/social/ui-types";

const ANGLES: { key: string; label: string; help: string }[] = [
  { key: "problem", label: "Problem → solution", help: "A pain the reader has, then the fix" },
  { key: "educational", label: "Educational", help: "One useful tip or how-to" },
  { key: "proof", label: "Social proof", help: "A result or customer moment (no invented numbers)" },
  { key: "minimal", label: "Minimalist", help: "One or two punchy lines" },
];
const ANGLE_LABEL = Object.fromEntries(ANGLES.map((a) => [a.key, a.label]));

type Preview = {
  drafts: { angle: string; text: string; at: string; similarity: number }[];
  dropped: { angle: string; at: string; reason: string }[];
  credits: number;
  timezone: string;
  maxSimilarity: number;
};

/** G14 "Plan a week": brief → distinct drafts across four angles, placed on the calendar at suggested times. */
export function PlanMaker({ destinations, imageCost }: { destinations: DestinationView[]; imageCost: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const usable = destinations.filter((d) => d.configured);
  const [brief, setBrief] = useState("");
  const [days, setDays] = useState(7);
  const [perDay, setPerDay] = useState(1);
  const [angles, setAngles] = useState<string[]>(ANGLES.map((a) => a.key));
  const [keys, setKeys] = useState<string[]>([]);
  const [autoImage, setAutoImage] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);

  const total = (preview?.drafts.length ?? 0) * (autoImage ? imageCost : 0);

  function make() {
    start(async () => {
      try {
        setPreview(unwrap(await buildContentPlan({ brief, days, perDay, angles, keys, autoImage })));
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function save() {
    if (!preview) return;
    start(async () => {
      try {
        const r = unwrap(await saveContentPlan({ drafts: preview.drafts, keys, autoImage, confirmCredits: total }));
        toast.success(`${r.created} drafts added to the calendar. Nothing goes out until you schedule them.`);
        setConfirming(false);
        router.push("/publish/calendar");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const posts = Math.min(days * perDay, 21);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>What is the week about?</CardTitle>
            <CardDescription>
              A product, a launch, an offer, a theme. The AI Box writes one post per slot from four different angles, and checks that no
              two are near-duplicates. Writing is free.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              aria-label="Brief"
              value={brief}
              maxLength={3000}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. Our new cold-brew subscription: delivered weekly, cancel any time, launch discount until Friday."
              className="min-h-32"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan-days">Days</Label>
                <Input id="plan-days" type="number" min={1} max={14} value={days} onChange={(e) => setDays(Math.min(14, Math.max(1, Number(e.target.value) || 1)))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-perday">Posts per day</Label>
                <Input id="plan-perday" type="number" min={1} max={3} value={perDay} onChange={(e) => setPerDay(Math.min(3, Math.max(1, Number(e.target.value) || 1)))} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Angles</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {ANGLES.map((a) => (
                  <Label key={a.key} className="flex items-start gap-2 font-normal">
                    <Checkbox
                      checked={angles.includes(a.key)}
                      onCheckedChange={(v) => setAngles((s) => (v ? [...new Set([...s, a.key])] : s.filter((x) => x !== a.key)))}
                    />
                    <span>
                      <span className="block text-sm">{a.label}</span>
                      <span className="block text-xs text-muted-foreground">{a.help}</span>
                    </span>
                  </Label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {preview ? (
          <Card>
            <CardHeader>
              <CardTitle>The plan — {preview.drafts.length} drafts</CardTitle>
              <CardDescription>
                Most similar pair: {preview.maxSimilarity.toFixed(2)} (anything at 0.94 or above is re-written or dropped). Times are suggested
                slots in {preview.timezone}; you can move them on the calendar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {preview.drafts.map((d, i) => (
                <div key={`${d.at}-${i}`} className="space-y-1.5 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{ANGLE_LABEL[d.angle] ?? d.angle}</Badge>
                    <LocalDate value={d.at} />
                    <span className="ml-auto tabular-nums">similarity {d.similarity.toFixed(2)}</span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remove this draft"
                      onClick={() => setPreview((p) => (p ? { ...p, drafts: p.drafts.filter((_, j) => j !== i) } : p))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Textarea
                    aria-label={`Draft ${i + 1}`}
                    value={d.text}
                    onChange={(e) =>
                      setPreview((p) => (p ? { ...p, drafts: p.drafts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) } : p))
                    }
                    className="min-h-24 text-sm"
                  />
                </div>
              ))}
              {preview.dropped.length ? (
                <p className="text-xs text-muted-foreground">
                  {preview.dropped.length} slot{preview.dropped.length === 1 ? " was" : "s were"} left empty: {preview.dropped[0].reason}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-4 lg:sticky lg:top-[calc(var(--cw-header-h)+1rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>{usable.length ? "Every draft goes to these." : "No channels connected yet."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {usable.map((d) => (
              <Label key={d.key} className="flex items-center gap-2 font-normal">
                <Checkbox checked={keys.includes(d.key)} onCheckedChange={(v) => setKeys((s) => (v ? [...new Set([...s, d.key])] : s.filter((k) => k !== d.key)))} />
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className="text-xs text-muted-foreground">{providerName(d.provider)}</span>
              </Label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Coins className="size-4" /> Credits</CardTitle>
            <CardDescription>Writing the plan is free. Only AI pictures use credits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="flex items-start gap-2 font-normal">
              <Checkbox checked={autoImage} onCheckedChange={(v) => setAutoImage(Boolean(v))} />
              <span className="text-sm">
                Add an AI picture to each post ({imageCost} credits each, made and charged when the post is published)
              </span>
            </Label>
            <p className="text-sm">
              Total: <b className="tabular-nums">{(preview?.drafts.length ?? posts) * (autoImage ? imageCost : 0)}</b> credits
              {preview ? "" : ` for up to ${posts} posts`}
            </p>
            <Button type="button" className="w-full" disabled={busy || brief.trim().length < 10 || !keys.length || !angles.length} onClick={make}>
              {busy && !confirming ? <Loader2 className="animate-spin" /> : <Sparkles />} {preview ? "Write it again" : "Write the plan"}
            </Button>
            {busy && !preview ? <p className="text-xs text-muted-foreground">Writing {posts} posts takes a minute or two.</p> : null}
            {preview?.drafts.length ? (
              <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => setConfirming(true)}>
                <CalendarPlus /> Add {preview.drafts.length} drafts to the calendar
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Link href="/publish/calendar" className={buttonVariants({ variant: "ghost", size: "sm" })}>Open the calendar</Link>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {preview?.drafts.length ?? 0} drafts?</DialogTitle>
            <DialogDescription>
              They land on the calendar as drafts — nothing is published or scheduled until you do it.
              {autoImage
                ? ` Total: ${total} credits (${preview?.drafts.length ?? 0} AI pictures × ${imageCost}), charged as each picture is made when its post is published.`
                : " Total: 0 credits."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button disabled={busy} onClick={save}>
              {busy ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Confirm{autoImage ? ` · ${total} credits` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
