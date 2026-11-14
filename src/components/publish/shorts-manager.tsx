"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Play, Plus, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LocalDate } from "@/components/local-date";
import { unwrap } from "@/lib/action-result";
import {
  makeShortNow, removeShortsRule, runShortsRuleNow, saveShortsRule, setShortsRuleOn,
} from "@/lib/social/p5-actions";
import type { RenderJobView } from "@/lib/social/render-jobs";
import type { DestinationView } from "@/lib/social/ui-types";
import { ChannelChecklist } from "./channel-checklist";
import { RenderJobsList } from "./render-jobs-list";

export interface ShortRuleView {
  id: string;
  name: string;
  source: string;
  solutionFilter: string;
  seedPrompt: string;
  topics: string;
  daysOfWeek: string;
  timeOfDay: string;
  timezone: string | null;
  providers: string;
  active: boolean;
  reviewFirst: boolean;
  held: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Draft {
  id?: string;
  name: string;
  source: "seed" | "workplace";
  solutionFilter: string;
  seedPrompt: string;
  topics: string;
  days: number[];
  time: string;
  timezone: string;
  providers: string[];
  active: boolean;
  reviewFirst: boolean;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function toDraft(r: ShortRuleView | null): Draft {
  return {
    id: r?.id,
    name: r?.name ?? "Shorts",
    source: r?.source === "workplace" ? "workplace" : "seed",
    solutionFilter: r?.solutionFilter ?? "",
    seedPrompt: r?.seedPrompt ?? "",
    topics: r?.topics ?? "",
    days: (r?.daysOfWeek ?? "1,2,3,4,5").split(",").filter(Boolean).map(Number),
    time: r?.timeOfDay ?? "09:00",
    timezone: r?.timezone || tz(),
    providers: (r?.providers ?? "").split(",").filter(Boolean),
    active: r?.active ?? true,
    reviewFirst: r?.reviewFirst ?? true,
  };
}

/** Publish → Shorts: rules that make one vertical tip video per slot, plus "make one now". */
export function ShortsManager({
  rules,
  destinations,
  jobs,
  cost,
  admin,
  solutions,
}: {
  rules: ShortRuleView[];
  destinations: DestinationView[];
  jobs: RenderJobView[];
  cost: number;
  /** The Phoenixtekk admin workspace: may ground Shorts in the Workplace catalogue. */
  admin: boolean;
  solutions: { sku: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [reviewFirst, setReviewFirst] = useState(true);
  const label = (k: string) => destinations.find((d) => d.key === k)?.label ?? k.split("#")[0];

  function run(fn: () => Promise<unknown>, ok?: string) {
    start(async () => {
      try {
        await fn();
        if (ok) toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="size-4" /> Make a Short now</CardTitle>
            <CardDescription>
              A 30–50 second vertical tip video: a hook, two to four concrete steps and a payoff, narrated with word-by-word
              captions. Made for YouTube Shorts, TikTok, Reels and the rest. {cost} AI credits, refunded if it fails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sh-topic">Topic</Label>
              <Input id="sh-topic" value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Three settings that stop a phone from leaking work files" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sh-brief">Brief (optional)</Label>
              <Textarea id="sh-brief" rows={4} value={brief} maxLength={8000} onChange={(e) => setBrief(e.target.value)} placeholder="Who it's for and anything it must get right." />
            </div>
            <div className="space-y-1.5">
              <Label>Publish to</Label>
              <ChannelChecklist destinations={destinations} value={keys} onChange={setKeys} exclude={["podcast"]} />
            </div>
            <Label className="flex items-center gap-2 font-normal">
              <Switch checked={reviewFirst} onCheckedChange={setReviewFirst} /> Hold it in Drafts for me to review first
            </Label>
          </CardContent>
          <CardFooter>
            <Button
              disabled={busy || !topic.trim() || !keys.length}
              onClick={() => run(async () => {
                unwrap(await makeShortNow({ topic, brief, providers: keys, reviewFirst }));
                setTopic("");
              }, "Short started — about two minutes.")}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Play />} Make the Short
            </Button>
          </CardFooter>
        </Card>
        <RenderJobsList kind="short" initial={jobs} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Shorts rules</h2>
          <p className="text-sm text-muted-foreground">Make one Short per time slot, working through your topics in turn.</p>
        </div>
        <Button onClick={() => setDraft(toDraft(null))}><Plus /> New rule</Button>
      </div>

      {rules.length === 0 ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">No Shorts rules yet.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rules.map((r) => (
            <Card key={r.id} size="sm">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {r.name}
                  <Badge variant="outline">{r.source === "workplace" ? "Workplace catalogue" : "Your topics"}</Badge>
                  {r.held ? <Badge variant="secondary">On hold (imported)</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {r.daysOfWeek.split(",").filter(Boolean).map((d) => DAYS[Number(d)]).join(", ")} at {r.timeOfDay}
                  {r.timezone ? ` (${r.timezone})` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {r.providers.split(",").filter(Boolean).map((k) => <Badge key={k} variant="secondary">{label(k)}</Badge>)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.active && r.nextRunAt ? <>Next <LocalDate value={r.nextRunAt} /></> : r.active ? "Scheduling…" : "Off"}
                  {r.lastRunAt ? <> · last <LocalDate value={r.lastRunAt} /></> : null}
                  {r.reviewFirst ? " · review first" : ""}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Label className="flex items-center gap-2 font-normal">
                    <Switch checked={r.active} disabled={busy || r.held} onCheckedChange={(v) => run(async () => unwrap(await setShortsRuleOn(r.id, v)))} /> On
                  </Label>
                  <Button size="sm" variant="outline" disabled={busy || r.held} onClick={() => run(async () => unwrap(await runShortsRuleNow(r.id)), "Short started.")}>
                    <Play /> Run now
                  </Button>
                  <Button size="sm" variant="outline" disabled={r.held} onClick={() => setDraft(toDraft(r))}><Pencil /> Edit</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => unwrap(await removeShortsRule(r.id)), "Rule deleted.")}>
                    <Trash2 /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => (o ? null : setDraft(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit Shorts rule" : "New Shorts rule"}</DialogTitle>
            <DialogDescription>Each slot makes one Short ({cost} AI credits, charged to you). Times are read in the rule&apos;s time zone.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sr-name">Name</Label>
                <Input id="sr-name" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              {admin ? (
                <div className="space-y-1.5">
                  <Label>Write from</Label>
                  <Select
                    value={draft.source}
                    onValueChange={(v) => setDraft({ ...draft, source: v === "workplace" ? "workplace" : "seed" })}
                    items={[{ value: "seed", label: "My brief and topics" }, { value: "workplace", label: "The Workplace solution catalogue" }]}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seed">My brief and topics</SelectItem>
                      <SelectItem value="workplace">The Workplace solution catalogue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {draft.source === "workplace" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sr-filter">Only solutions whose name or SKU contains (optional)</Label>
                  <Input id="sr-filter" value={draft.solutionFilter} onChange={(e) => setDraft({ ...draft, solutionFilter: e.target.value })} placeholder="e.g. Intune" />
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const f = draft.solutionFilter.trim().toLowerCase();
                      const n = f ? solutions.filter((s) => s.name.toLowerCase().includes(f) || s.sku.toLowerCase().includes(f)).length : solutions.length;
                      return `${n} of ${solutions.length} solutions match. Each Short is written only from one solution's page and links to it.`;
                    })()}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="sr-seed">Brief</Label>
                    <Textarea id="sr-seed" rows={4} value={draft.seedPrompt} onChange={(e) => setDraft({ ...draft, seedPrompt: e.target.value })} placeholder="Who it's for and anything it must get right." />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sr-topics">Topics (comma-separated — used in turn)</Label>
                    <Textarea id="sr-topics" rows={3} value={draft.topics} onChange={(e) => setDraft({ ...draft, topics: e.target.value })} />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label>Days</Label>
                <div className="flex flex-wrap gap-3">
                  {DAYS.map((d, i) => (
                    <Label key={d} className="flex items-center gap-1.5 font-normal">
                      <Checkbox
                        checked={draft.days.includes(i)}
                        onCheckedChange={(on) => setDraft({ ...draft, days: on ? [...draft.days, i].sort() : draft.days.filter((x) => x !== i) })}
                      />
                      {d}
                    </Label>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sr-time">Time (24h)</Label>
                  <Input id="sr-time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} placeholder="09:00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sr-tz">Time zone</Label>
                  <Input id="sr-tz" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Publish to</Label>
                <ChannelChecklist destinations={destinations} value={draft.providers} onChange={(p) => setDraft({ ...draft, providers: p })} exclude={["podcast"]} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 font-normal">
                  <Switch checked={draft.reviewFirst} onCheckedChange={(v) => setDraft({ ...draft, reviewFirst: v })} /> Hold each Short in Drafts for me to review first
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /> Rule is on
                </Label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={busy || !draft || !draft.providers.length || !draft.days.length}
              onClick={() => {
                const d = draft;
                if (!d) return;
                run(async () => {
                  unwrap(await saveShortsRule({
                    id: d.id, name: d.name, source: d.source, solutionFilter: d.solutionFilter, seedPrompt: d.seedPrompt,
                    topics: d.topics, daysOfWeek: d.days.join(","), timeOfDay: d.time, timezone: d.timezone,
                    providers: d.providers.join(","), active: d.active, reviewFirst: d.reviewFirst,
                  }));
                  setDraft(null);
                }, "Rule saved.");
              }}
            >
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
