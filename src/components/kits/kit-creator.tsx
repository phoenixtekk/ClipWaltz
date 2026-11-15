"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Film, ImageIcon, Loader2, Package, Type, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { unwrap } from "@/lib/action-result";
import { createPostKit } from "@/lib/kits/kit-actions";
import { KIT_NETWORKS, defaultNetworks, networksFor, type KitStart, type MediaShape } from "@/lib/kits/types";
import { uploadPostMedia } from "@/components/publish/upload-media";

interface Uploaded { id: string; kind: "image" | "video"; name: string; preview: string | null }

/** Publish → Post kits → New: pick the source and networks; the kit page fills in as captions are written. */
export function KitCreator({ initial, query }: { initial: KitStart; query: { render: string | null; export: string | null; design: string | null } }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [brief, setBrief] = useState(initial.brief);
  const [link, setLink] = useState(initial.link ?? "");
  const [uploads, setUploads] = useState<Uploaded[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fixedSource = initial.source.kind !== "none";

  const shape: MediaShape = fixedSource ? initial.shape : uploads.some((u) => u.kind === "video") ? "video" : uploads.length ? "image" : "none";
  const allowed = useMemo(() => new Set(networksFor(shape).map((n) => n.id)), [shape]);
  const [picked, setPicked] = useState<string[]>(initial.suggested);
  const [touched, setTouched] = useState(false);
  // Until the person changes the ticks, follow the source: uploading a video swaps in the video networks.
  const nets = touched ? picked.filter((p) => allowed.has(p)) : defaultNetworks(shape, initial.aspect).filter((p) => allowed.has(p));

  function toggle(id: string, on: boolean) {
    const base = touched ? picked : nets;
    setTouched(true);
    setPicked(on ? [...new Set([...base, id])] : base.filter((x) => x !== id));
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    const hasVideo = list.some((f) => f.type.startsWith("video/")) || uploads.some((u) => u.kind === "video");
    if (hasVideo && (list.length + uploads.length > 1)) {
      toast.error("Add one video, or up to 10 images — not both.");
      return;
    }
    if (uploads.length + list.length > 10) {
      toast.error("Up to 10 images per kit.");
      return;
    }
    try {
      for (const f of list) {
        setProgress(0);
        const m = await uploadPostMedia(f, setProgress);
        setUploads((u) => [...u, { id: m.id, kind: m.kind, name: f.name, preview: m.kind === "image" ? URL.createObjectURL(f) : null }]);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function submit() {
    start(async () => {
      try {
        const r = unwrap(await createPostKit({
          title, brief, link: link.trim() || null, networks: nets,
          render: query.render, export: query.export, design: query.design,
          mediaIds: fixedSource ? [] : uploads.map((u) => u.id),
        }));
        router.push(`/publish/kits/${r.id}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const src = initial.source;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Package className="size-4" /> New post kit</CardTitle>
          <CardDescription>
            Captions are written on the AI Box (0 credits). Pictures are made at each network&apos;s size: a Waltz Image design is
            redrawn so its text isn&apos;t cut off, and uploaded photos are cropped around their subject.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {initial.problem ? (
            <Alert variant="destructive">
              <AlertTitle>That source can&apos;t be used</AlertTitle>
              <AlertDescription>{initial.problem} You can still make a kit from an idea or uploads.</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label>Made from</Label>
            {fixedSource ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                {src.kind === "design" ? <ImageIcon className="size-4" /> : <Film className="size-4" />}
                <span className="font-medium">
                  {src.kind === "render" ? "Video" : src.kind === "export" ? "Export" : src.kind === "design" ? (src.designKind === "carousel" ? "Carousel" : src.designKind === "meme" ? "Meme" : "Image design") : ""}
                </span>
                <span className="text-muted-foreground">{"title" in src ? src.title : ""}{"aspect" in src && src.aspect ? ` · ${src.aspect}` : ""}</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" disabled={progress !== null} onClick={() => fileRef.current?.click()}>
                    {progress !== null ? <Loader2 className="animate-spin" /> : <Upload />} Upload images or a video
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {uploads.length ? `${uploads.length} file${uploads.length === 1 ? "" : "s"}` : <><Type className="mr-1 inline size-3.5" />Or leave empty for a text-only kit.</>}
                  </span>
                  <input ref={fileRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => onFiles(e.target.files)} />
                </div>
                {progress !== null ? <Progress value={progress} /> : null}
                {uploads.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {uploads.map((u) => (
                      <li key={u.id} className="relative flex size-20 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs">
                        {u.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.preview} alt={u.name} className="size-full object-cover" />
                        ) : (
                          <Film className="size-6 text-muted-foreground" />
                        )}
                        <button type="button" aria-label={`Remove ${u.name}`} onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))} className="absolute top-0.5 right-0.5 rounded-full bg-background/90 p-0.5">
                          <X className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kit-title">Title</Label>
            <Input id="kit-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Used as the YouTube / Pinterest title and to find the kit later" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-brief">What the post should say</Label>
            <Textarea id="kit-brief" rows={6} value={brief} maxLength={4000} onChange={(e) => setBrief(e.target.value)}
              placeholder="The point of the post, who it's for, any facts, offer or call to action to include." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-link">Link (optional)</Label>
            <Input id="kit-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={submit} disabled={busy || progress !== null || !nets.length || (!brief.trim() && !fixedSource && !uploads.length)}>
            {busy ? <Loader2 className="animate-spin" /> : <Package />} Make the kit
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Networks</CardTitle>
          <CardDescription>
            {shape === "video" ? "Networks that take a video." : shape === "image" ? "Networks that take pictures." : "Text-only posts. Instagram, TikTok, YouTube and Pinterest need a picture or video."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {KIT_NETWORKS.map((n) => {
              const ok = allowed.has(n.id);
              return (
                <li key={n.id}>
                  <Label className={`flex items-center gap-3 rounded-lg border p-2.5 font-normal ${ok ? "" : "opacity-50"}`}>
                    <Checkbox checked={nets.includes(n.id)} disabled={!ok} onCheckedChange={(v) => toggle(n.id, Boolean(v))} />
                    <span className="flex-1 font-medium">{n.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {shape === "image" && n.takesImage ? `${n.imageFormat} pictures` : n.captionMax ? `${n.captionMax.toLocaleString()} chars` : ""}
                    </span>
                  </Label>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
