"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { unwrap } from "@/lib/action-result";
import { makeExplainerNow } from "@/lib/social/p5-actions";
import type { RenderJobView } from "@/lib/social/render-jobs";
import type { DestinationView } from "@/lib/social/ui-types";
import { ChannelChecklist } from "./channel-checklist";
import { RenderJobsList } from "./render-jobs-list";

/** Publish → Explainers: make one narrated explainer episode now (Auto Post rules make them on a schedule). */
export function ExplainerMaker({
  destinations,
  jobs,
  cost,
  ownerVoice,
}: {
  destinations: DestinationView[];
  jobs: RenderJobView[];
  cost: number;
  ownerVoice: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [link, setLink] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [reviewFirst, setReviewFirst] = useState(true);

  function submit() {
    start(async () => {
      try {
        unwrap(await makeExplainerNow({ topic, brief, link, providers: keys, reviewFirst }));
        toast.success("Explainer started — it takes about 10 minutes.");
        setTopic("");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clapperboard className="size-4" /> Make an explainer</CardTitle>
          <CardDescription>
            A 3–5 minute narrated video: the AI writes a six-part script from your brief, it is voiced
            {ownerVoice ? " in your channel voice" : " with a natural AI voice"}, drawn as diagrams with captions, and cut for each
            channel (YouTube gets chapters and a thumbnail; a podcast show gets the audio). {cost} AI credits, refunded if it fails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ex-topic">Topic</Label>
            <Input id="ex-topic" value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Why compliance policies and configuration profiles are different things" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-brief">Brief</Label>
            <Textarea
              id="ex-brief"
              rows={6}
              value={brief}
              maxLength={8000}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Who the channel is for, the voice to use, what to always get right, and what to point viewers to at the end."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-link">Link for the description (optional)</Label>
            <Input id="ex-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
          </div>
          <div className="space-y-1.5">
            <Label>Publish to</Label>
            <ChannelChecklist destinations={destinations} value={keys} onChange={setKeys} />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Switch checked={reviewFirst} onCheckedChange={setReviewFirst} /> Hold the finished video in Drafts for me to review first
          </Label>
        </CardContent>
        <CardFooter>
          <Button onClick={submit} disabled={busy || !topic.trim() || !brief.trim() || !keys.length}>
            {busy ? <Loader2 className="animate-spin" /> : <Clapperboard />} Make the explainer
          </Button>
        </CardFooter>
      </Card>
      <RenderJobsList kind="explainer" initial={jobs} />
    </div>
  );
}
