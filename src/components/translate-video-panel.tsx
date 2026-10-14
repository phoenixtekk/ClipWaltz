"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Film, Languages, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { CreditsLine, notEnough, useCredits } from "@/components/credits-line";
import { unwrap } from "@/lib/action-result";
import type { AssetSummary } from "@/lib/assets";
import { LANGUAGES } from "@/lib/deck/types";
import { listPresenters } from "@/lib/presenter-actions";
import { TRANSLATE_MAX_SECONDS, presenterCredits, type PresenterView } from "@/lib/presenters";
import { createTranslatedVideo, getTranslationPrep, prepareTranslation, type TranslationPrep } from "@/lib/translate-actions";

/** Waltz AI → Translate a video (Waltz Avatar Phase 3): a video of yourself → review the translation → the same video in
 *  another language, in your own cloned voice, with your lips re-synced. */
export function TranslateVideoPanel({ projectId, videos, busy, onStarted }: {
  projectId: string; videos: AssetSummary[]; busy: boolean; onStarted: (jobId: string) => void;
}) {
  const [presenters, setPresenters] = useState<PresenterView[] | null>(null);
  const [videoId, setVideoId] = useState<string | null>(videos[0]?.id ?? null);
  const [presenterId, setPresenterId] = useState<string>("");
  const [lang, setLang] = useState<string>("es");
  const [prepId, setPrepId] = useState<string | null>(null);
  const [prep, setPrep] = useState<TranslationPrep | null>(null);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const credits = useCredits(busy);

  useEffect(() => {
    void listPresenters().then((r) => {
      const ok = r.ok ? r.data.filter((p) => p.status === "ready" && p.voiceStatus === "ready") : [];
      setPresenters(ok);
      if (ok[0]) setPresenterId(ok[0].id);
    });
  }, []);
  // Poll the transcribe + translate step.
  useEffect(() => {
    if (!prepId) return;
    let stop = false;
    const tick = async () => {
      const r = await getTranslationPrep(prepId);
      if (stop || !r.ok) return;
      setPrep(r.data);
      if (r.data.status === "completed") setText(r.data.translation ?? "");
      if (r.data.status === "failed") toast.error(r.data.error ?? "Couldn't transcribe that video");
      if (!["completed", "failed"].includes(r.data.status)) setTimeout(tick, 3000);
    };
    void tick();
    return () => { stop = true; };
  }, [prepId]);

  const video = videos.find((v) => v.id === videoId) ?? null;
  const seconds = Math.min(TRANSLATE_MAX_SECONDS, prep?.seconds ?? video?.durationSec ?? 0);
  const cost = presenterCredits(seconds * 2);
  const working = !!prepId && !!prep && !["completed", "failed"].includes(prep.status);

  if (presenters && !presenters.length) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-border p-6 text-center text-sm">
        <Languages className="mx-auto size-6 text-muted-foreground" />
        <p className="font-medium">Translate videos of yourself</p>
        <p className="text-xs text-muted-foreground">
          First create your presenter and set up your own voice on <Link href="/avatars" className="underline">Avatars</Link> — that&apos;s how
          we know the video is you.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A video of you talking → the same video in another language, in your own voice, with your lips re-synced. Up to {TRANSLATE_MAX_SECONDS / 60} minutes.
      </p>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Video</span>
        {videos.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Film className="size-4" /> Add a video of yourself to this project first.</p>
        ) : (
          <select value={videoId ?? ""} onChange={(e) => { setVideoId(e.target.value); setPrepId(null); setPrep(null); }} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
            {videos.map((v) => <option key={v.id} value={v.id}>{v.name}{v.durationSec ? ` · ${Math.round(v.durationSec)} s` : ""}</option>)}
          </select>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          You (your presenter)
          <select value={presenterId} onChange={(e) => setPresenterId(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground">
            {(presenters ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Into
          <select value={lang} onChange={(e) => { setLang(e.target.value); setPrepId(null); setPrep(null); }} className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground">
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      </div>
      {!prep || prep.status === "failed" ? (
        <Button disabled={pending || !videoId || !presenterId}
          onClick={() => start(async () => {
            try {
              setPrep(null);
              setPrepId(unwrap(await prepareTranslation({ projectId, assetId: videoId!, presenterId, lang })));
            } catch (e) {
              toast.error((e as Error).message);
            }
          })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />} Transcribe &amp; translate (free)
        </Button>
      ) : working ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Listening and translating…</p>
      ) : (
        <div className="space-y-2">
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">What the video says</summary>
            <p className="mt-1 whitespace-pre-wrap">{prep.source}</p>
          </details>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Translation — edit anything before it&apos;s spoken</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={6000}
              className={cn("w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-primary")} />
          </label>
          <Button size="lg" disabled={busy || pending || !text.trim() || notEnough(credits, cost)}
            className="h-12 w-full bg-[image:var(--cw-spectrum)] font-semibold text-white"
            onClick={() => start(async () => {
              try {
                const id = unwrap(await createTranslatedVideo({ prepJobId: prepId!, text }));
                toast.success("Translating — it'll appear under Generated versions");
                onStarted(id);
                setPrepId(null);
                setPrep(null);
              } catch (e) {
                toast.error((e as Error).message);
              }
            })}>
            <Sparkles className="size-4" /> Make the translated video
          </Button>
          <CreditsLine cost={cost} balance={credits} className="w-full justify-center" />
          <p className="text-center text-[11px] text-muted-foreground">Labelled “AI-generated”. Only videos of yourself — we check the voice matches your presenter.</p>
        </div>
      )}
    </div>
  );
}
