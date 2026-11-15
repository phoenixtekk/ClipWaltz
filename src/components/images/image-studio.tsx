"use client";
// Waltz Image studio (plan G1 / G2 / G5): one editor for image ads, carousels and memes. Words are edited here and
// saved as data; the preview is composited on the server (/api/images/[id]/render) — no GPU job, so editing a headline
// is free and instant. Only "Make with AI" spends credits (IMAGE_COST per picture, refunded if it fails).
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Download, FileArchive, ImagePlus, Library, Loader2, Package, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditsLine, notEnough } from "@/components/credits-line";
import { unwrap } from "@/lib/action-result";
import { IMAGE_COST } from "@/lib/credits";
import { deleteDesign, deletePicture, generatePictures, getDesign, saveDesign, saveToLibrary } from "@/lib/image-ad/image-actions";
import type { CarouselData, CarouselSlide, DesignData, DesignImageView, DesignView, ImageAdData, MemeData } from "@/lib/image-ad/types";
import {
  AD_LAYOUTS, CAROUSEL_FORMATS, CAROUSEL_MAX, CAROUSEL_MIN, IMAGE_FORMATS, IMAGE_STYLES, MAX_VARIATIONS, MEME_LAYOUTS, TEXT_LIMITS, imageFormat,
} from "../../../worker/image/presets.mjs";

const KIND_LABEL = { image: "Image", carousel: "Carousel", meme: "Meme" } as const;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function ImageStudio({ initial, publishEnabled }: { initial: DesignView; publishEnabled: boolean }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [data, setData] = useState<DesignData>(initial.data);
  const [title, setTitle] = useState(initial.title);
  const [format, setFormat] = useState(initial.format);
  const [rev, setRev] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, start] = useTransition();
  const [slideIdx, setSlideIdx] = useState(0);
  const id = view.id;
  const canEdit = view.canEdit;
  const fmt = imageFormat(format);
  const outputs = view.kind === "carousel" ? (data as CarouselData).slides.length : 1;
  const current = Math.min(slideIdx, outputs - 1);

  // ── Save (debounced) → re-composite ───────────────────────────────────────────
  const pending = useRef<{ title?: string; format?: string; data?: DesignData }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setSaving(true);
    try {
      unwrap(await saveDesign(id, patch));
      setRev((r) => r + 1);
      setDirty(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [id]);
  const queueSave = useCallback((patch: { title?: string; format?: string; data?: DesignData }) => {
    pending.current = { ...pending.current, ...patch };
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const update = (next: DesignData) => {
    setData(next);
    queueSave({ data: next });
  };

  // ── Poll while AI pictures are rendering ───────────────────────────────────────
  const rendering = view.images.some((i) => i.status === "pending");
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(async () => {
      try {
        const v = unwrap(await getDesign(id));
        setView((old) => {
          const became = v.images.some((i) => i.status !== "pending" && old.images.find((o) => o.id === i.id)?.status === "pending");
          if (became) setRev((r) => r + 1);
          return { ...old, images: v.images, credits: v.credits };
        });
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(t);
  }, [rendering, id]);

  async function refreshFrom(v: DesignView) {
    setView(v);
    setData(v.data);
    setRev((r) => r + 1);
  }

  // ── Pictures ───────────────────────────────────────────────────────────────────
  const pictureOf = (d: DesignData): string | null =>
    view.kind === "carousel" ? ((d as CarouselData).slides[current]?.imageId ?? null) : ((d as ImageAdData | MemeData).imageId ?? null);
  const choosePicture = (imageId: string | null) => {
    if (view.kind === "carousel") {
      const c = data as CarouselData;
      update({ ...c, slides: c.slides.map((s, i) => (i === current ? { ...s, imageId } : s)) });
    } else update({ ...(data as ImageAdData | MemeData), imageId } as DesignData);
  };

  async function generate(brief: string, style: string, count: number) {
    await flush();
    start(async () => {
      try {
        const slideId = view.kind === "carousel" ? (data as CarouselData).slides[current]?.id : null;
        const v = unwrap(await generatePictures(id, { brief, style, count, slideId }));
        await refreshFrom(v);
        toast.success(count > 1 ? `Making ${count} pictures…` : "Making the picture…");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  async function upload(file: File) {
    await flush();
    const fd = new FormData();
    fd.append("file", file);
    start(async () => {
      try {
        const r = await fetch(`/api/images/${id}/upload`, { method: "POST", body: fd });
        const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!r.ok || !j.id) throw new Error(j.error || "Upload failed.");
        const v = unwrap(await getDesign(id));
        setView(v);
        // Apply it straight away.
        const nextData = view.kind === "carousel"
          ? { ...(data as CarouselData), slides: (data as CarouselData).slides.map((s, i) => (i === current ? { ...s, imageId: j.id! } : s)) }
          : ({ ...(data as ImageAdData | MemeData), imageId: j.id } as DesignData);
        setData(nextData);
        unwrap(await saveDesign(id, { data: nextData }));
        setRev((x) => x + 1);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  async function removePicture(imageId: string) {
    await flush();
    start(async () => {
      try {
        await refreshFrom(unwrap(await deletePicture(id, imageId)));
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  // ── Output actions ─────────────────────────────────────────────────────────────
  async function onSaveLibrary() {
    await flush();
    start(async () => {
      try {
        const r = unwrap(await saveToLibrary(id));
        toast.success(`${r.saved} image${r.saved === 1 ? "" : "s"} saved to your Media library.`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }
  async function onPublish() {
    await flush();
    start(async () => {
      try {
        router.push(`/publish/kits/new?design=${encodeURIComponent(id)}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }
  async function onDelete() {
    if (!confirm("Delete this design and its pictures? Images already saved to your library or posted stay.")) return;
    start(async () => {
      try {
        unwrap(await deleteDesign(id));
        router.push("/images");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const previewSrc = `/api/images/${id}/render?i=${current}&r=${rev}`;
  const selected = pictureOf(data);
  const formats = view.kind === "carousel" ? IMAGE_FORMATS.filter((f) => CAROUSEL_FORMATS.includes(f.key)) : IMAGE_FORMATS;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/images" />}>← Waltz Image</Button>
          <Badge variant="secondary">{KIND_LABEL[view.kind]}</Badge>
          <Input
            value={title}
            disabled={!canEdit}
            maxLength={100}
            onChange={(e) => { setTitle(e.target.value); queueSave({ title: e.target.value }); }}
            className="h-8 max-w-sm font-medium"
            aria-label="Design name"
          />
          <span className="text-xs text-muted-foreground">{saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/images/${id}/render?i=${current}&download=1&r=${rev}`} />}>
            <Download /> PNG
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/images/${id}/render?i=${current}&fmt=jpg&download=1&r=${rev}`} />}>
            <Download /> JPG
          </Button>
          {outputs > 1 ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/images/${id}/zip?r=${rev}`} />}>
              <FileArchive /> All slides (ZIP)
            </Button>
          ) : null}
          {canEdit ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onSaveLibrary}><Library /> Save to library</Button>
          ) : null}
          {canEdit && publishEnabled ? (
            <Button size="sm" disabled={busy} onClick={onPublish}><Package /> Post kit</Button>
          ) : null}
          {canEdit ? (
            <Button variant="ghost" size="icon-sm" disabled={busy} onClick={onDelete} aria-label="Delete design"><Trash2 /></Button>
          ) : null}
        </div>
      </div>

      {view.brand.missingFonts.length ? (
        <Alert>
          <AlertTitle>Brand font not on this server</AlertTitle>
          <AlertDescription>
            {view.brand.missingFonts.join(" and ")} {view.brand.missingFonts.length === 1 ? "isn't" : "aren't"} installed where images are drawn, so a similar sans is used instead.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        {/* Preview */}
        <div className="space-y-3">
          <div className="grid place-items-center rounded-xl border border-border bg-muted/40 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- composited on demand by /api/images/[id]/render */}
            <img
              key={previewSrc}
              src={previewSrc}
              alt={`${KIND_LABEL[view.kind]} preview`}
              width={fmt.width}
              height={fmt.height}
              className="h-auto max-h-[70vh] w-auto max-w-full rounded-md shadow-sm"
              style={{ aspectRatio: `${fmt.width} / ${fmt.height}` }}
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {fmt.label} · {fmt.width}×{fmt.height} px · {fmt.use}
            {view.kind === "carousel" ? ` · slide ${current + 1} of ${outputs}` : ""}
          </p>
          {view.kind === "carousel" ? (
            <SlideStrip
              id={id}
              data={data as CarouselData}
              current={current}
              rev={rev}
              canEdit={canEdit}
              onSelect={setSlideIdx}
              onChange={(next, sel) => { update(next); if (sel != null) setSlideIdx(sel); }}
            />
          ) : null}
        </div>

        {/* Controls */}
        <div className="space-y-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Format</CardTitle>
              <CardDescription>Exact pixel sizes for each network.</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={format}
                disabled={!canEdit}
                onValueChange={(v) => { if (!v) return; setFormat(v as typeof format); queueSave({ format: String(v) }); }}
                items={formats.map((f) => ({ value: f.key, label: `${f.key} · ${f.label} (${f.width}×${f.height})` }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {formats.map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.key} · {f.label} ({f.width}×{f.height})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {view.kind !== "carousel" && view.images.some((i) => i.source === "ai") ? (
                <p className="mt-2 text-[11px] text-muted-foreground">AI pictures are drawn for the format they were made in; another format crops them to fit.</p>
              ) : null}
            </CardContent>
          </Card>

          {view.kind === "image" ? <AdText data={data as ImageAdData} canEdit={canEdit} onChange={update} brand={view.brand} /> : null}
          {view.kind === "meme" ? <MemeText data={data as MemeData} canEdit={canEdit} onChange={update} /> : null}
          {view.kind === "carousel" ? (
            <SlideText data={data as CarouselData} index={current} canEdit={canEdit} onChange={update} brand={view.brand} />
          ) : null}

          <PicturePanel
            kind={view.kind}
            images={view.images}
            selected={selected}
            canEdit={canEdit}
            busy={busy}
            credits={view.credits}
            initialBrief={(data as { brief?: string }).brief ?? ""}
            initialStyle={(data as { style?: string }).style ?? "photographic"}
            onGenerate={generate}
            onUpload={upload}
            onChoose={choosePicture}
            onRemove={removePicture}
          />
        </div>
      </div>
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={cn("text-[11px] tabular-nums", value.length > max * 0.9 ? "text-amber-600" : "text-muted-foreground")}>{value.length}/{max}</span>;
}

function Field({ label, value, max, onChange, disabled, multiline, placeholder }: {
  label: string; value: string; max: number; onChange: (v: string) => void; disabled?: boolean; multiline?: boolean; placeholder?: string;
}) {
  const fid = useMemo(() => `f-${label.replace(/\W+/g, "-").toLowerCase()}`, [label]);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={fid}>{label}</Label>
        <Counter value={value} max={max} />
      </div>
      {multiline ? (
        <Textarea id={fid} value={value} maxLength={max} rows={2} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={fid} value={value} maxLength={max} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function BrandToggle({ on, onChange, disabled, brand }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; brand: DesignView["brand"] }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
      <Label className="flex items-center gap-2 text-sm font-normal">
        <Switch checked={on} disabled={disabled} onCheckedChange={(v) => onChange(!!v)} />
        Use brand kit
      </Label>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-3.5 rounded-full border" style={{ background: brand.primary }} />
        <span className="size-3.5 rounded-full border" style={{ background: brand.secondary }} />
        {brand.headingFont}{brand.hasLogo ? " · logo" : ""}{brand.fromKit ? "" : " (defaults)"}
      </span>
    </div>
  );
}

function AdText({ data, canEdit, onChange, brand }: { data: ImageAdData; canEdit: boolean; onChange: (d: DesignData) => void; brand: DesignView["brand"] }) {
  const set = (p: Partial<ImageAdData>) => onChange({ ...data, ...p });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Ad text</CardTitle>
        <CardDescription>Drawn over the picture, pixel-sharp. Edits are free — no new AI picture.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Layout</Label>
          <Select value={data.layout} disabled={!canEdit} onValueChange={(v) => v && set({ layout: v as ImageAdData["layout"] })}
            items={AD_LAYOUTS.map((l) => ({ value: l.key, label: l.label }))}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{AD_LAYOUTS.map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {data.layout !== "none" ? (
          <>
            <Field label="Headline" value={data.headline} max={TEXT_LIMITS.headline} disabled={!canEdit} onChange={(v) => set({ headline: v })} placeholder="e.g. Spring sale: 30% off" />
            <Field label="Subhead" value={data.subhead} max={TEXT_LIMITS.subhead} disabled={!canEdit} multiline onChange={(v) => set({ subhead: v })} />
            <Field label="Button" value={data.cta} max={TEXT_LIMITS.cta} disabled={!canEdit} onChange={(v) => set({ cta: v })} placeholder="e.g. Shop now" />
            <BrandToggle on={data.useBrand} disabled={!canEdit} onChange={(useBrand) => set({ useBrand })} brand={brand} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MemeText({ data, canEdit, onChange }: { data: MemeData; canEdit: boolean; onChange: (d: DesignData) => void }) {
  const set = (p: Partial<MemeData>) => onChange({ ...data, ...p });
  const layout = MEME_LAYOUTS.find((m) => m.key === data.layout) ?? MEME_LAYOUTS[0];
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Meme</CardTitle>
        <CardDescription>Original layouts only — your photo or an AI picture underneath. Long text shrinks to fit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {MEME_LAYOUTS.map((m) => (
            <button key={m.key} type="button" disabled={!canEdit} aria-pressed={data.layout === m.key} aria-label={`${m.label}: ${m.desc}`} onClick={() => set({ layout: m.key })}
              className={cn("rounded-lg border p-2 text-left text-xs transition-colors hover:border-primary/60", data.layout === m.key ? "border-primary bg-primary/10" : "border-border")}>
              <span className="block font-medium">{m.label}</span>
              <span className="text-muted-foreground">{m.desc}</span>
            </button>
          ))}
        </div>
        {layout.fields.includes("top") ? <Field label="Top text" value={data.top} max={TEXT_LIMITS.top} disabled={!canEdit} onChange={(v) => set({ top: v })} /> : null}
        {layout.fields.includes("bottom") ? <Field label="Bottom text" value={data.bottom} max={TEXT_LIMITS.bottom} disabled={!canEdit} onChange={(v) => set({ bottom: v })} /> : null}
        {layout.fields.includes("caption") ? <Field label="Caption" value={data.caption} max={TEXT_LIMITS.caption} disabled={!canEdit} multiline onChange={(v) => set({ caption: v })} /> : null}
      </CardContent>
    </Card>
  );
}

function SlideText({ data, index, canEdit, onChange, brand }: { data: CarouselData; index: number; canEdit: boolean; onChange: (d: DesignData) => void; brand: DesignView["brand"] }) {
  const slide = data.slides[index];
  if (!slide) return null;
  const setSlide = (p: Partial<CarouselSlide>) => onChange({ ...data, slides: data.slides.map((s, i) => (i === index ? { ...s, ...p } : s)) });
  const last = index === data.slides.length - 1;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Slide {index + 1}{index === 0 ? " · hook" : last && data.cta ? " · call to action" : ""}</CardTitle>
        <CardDescription>Template slides use your brand colours and cost nothing. Add an AI background below if you want one.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Headline" value={slide.headline} max={TEXT_LIMITS.headline} disabled={!canEdit} onChange={(v) => setSlide({ headline: v })} />
        <Field label="Body" value={slide.body} max={TEXT_LIMITS.body} disabled={!canEdit} multiline onChange={(v) => setSlide({ body: v })} />
        <Field label="Last slide's button" value={data.cta} max={TEXT_LIMITS.cta} disabled={!canEdit} onChange={(v) => onChange({ ...data, cta: v })} placeholder="Leave empty for no button" />
        <BrandToggle on={data.useBrand} disabled={!canEdit} onChange={(useBrand) => onChange({ ...data, useBrand })} brand={brand} />
      </CardContent>
    </Card>
  );
}

function SlideStrip({ id, data, current, rev, canEdit, onSelect, onChange }: {
  id: string; data: CarouselData; current: number; rev: number; canEdit: boolean;
  onSelect: (i: number) => void; onChange: (d: CarouselData, select?: number) => void;
}) {
  const n = data.slides.length;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= n) return;
    const slides = [...data.slides];
    const [s] = slides.splice(from, 1);
    slides.splice(to, 0, s);
    onChange({ ...data, slides }, to);
  };
  const add = (copy: boolean) => {
    if (n >= CAROUSEL_MAX) return;
    const base = data.slides[current];
    const slide: CarouselSlide = copy && base ? { ...base, id: newId() } : { id: newId(), imageId: null, headline: "New slide", body: "" };
    const slides = [...data.slides];
    slides.splice(current + 1, 0, slide);
    onChange({ ...data, slides }, current + 1);
  };
  const remove = () => {
    if (n <= CAROUSEL_MIN) return;
    onChange({ ...data, slides: data.slides.filter((_, i) => i !== current) }, Math.max(0, current - 1));
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.slides.map((s, i) => (
          <button key={s.id} type="button" onClick={() => onSelect(i)} aria-label={`Slide ${i + 1}`} aria-pressed={i === current}
            className={cn("relative shrink-0 overflow-hidden rounded-md border-2", i === current ? "border-primary" : "border-transparent hover:border-border")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- composited thumbnail */}
            <img src={`/api/images/${id}/render?i=${i}&r=${rev}`} alt="" className="h-20 w-auto" loading="lazy" />
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
          </button>
        ))}
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => move(current, current - 1)} disabled={current === 0}><ArrowUp className="-rotate-90" /> Move left</Button>
          <Button variant="outline" size="sm" onClick={() => move(current, current + 1)} disabled={current === n - 1}><ArrowDown className="-rotate-90" /> Move right</Button>
          <Button variant="outline" size="sm" onClick={() => add(false)} disabled={n >= CAROUSEL_MAX}><Plus /> Add slide</Button>
          <Button variant="outline" size="sm" onClick={() => add(true)} disabled={n >= CAROUSEL_MAX}><Copy /> Duplicate</Button>
          <Button variant="ghost" size="sm" onClick={remove} disabled={n <= CAROUSEL_MIN}><X /> Remove</Button>
          <span className="text-[11px] text-muted-foreground">{n} of {CAROUSEL_MAX} slides</span>
        </div>
      ) : null}
    </div>
  );
}

function PicturePanel({ kind, images, selected, canEdit, busy, credits, initialBrief, initialStyle, onGenerate, onUpload, onChoose, onRemove }: {
  kind: DesignView["kind"]; images: DesignImageView[]; selected: string | null; canEdit: boolean; busy: boolean; credits: DesignView["credits"];
  initialBrief: string; initialStyle: string;
  onGenerate: (brief: string, style: string, count: number) => void; onUpload: (f: File) => void;
  onChoose: (id: string | null) => void; onRemove: (id: string) => void;
}) {
  const [brief, setBrief] = useState(initialBrief);
  const [style, setStyle] = useState(initialStyle);
  const [count, setCount] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const cost = IMAGE_COST * (kind === "image" ? count : 1);
  const short = notEnough(credits, cost);
  const title = kind === "carousel" ? "Slide background" : "Picture";
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {kind === "carousel" ? "None = a brand-colour template slide (free)." : kind === "meme" ? "Upload your own (free) or make one with AI." : "Describe it and Waltz AI paints it — no words in the picture; your text goes on top."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit ? (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="img-brief">Describe the picture</Label>
                <Counter value={brief} max={TEXT_LIMITS.prompt} />
              </div>
              <Textarea id="img-brief" rows={3} maxLength={TEXT_LIMITS.prompt} value={brief} onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. Handmade ceramic mugs on a sunny kitchen counter" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1 space-y-1.5">
                <Label>Style</Label>
                <Select value={style} onValueChange={(v) => v && setStyle(String(v))} items={IMAGE_STYLES.map((s) => ({ value: s.key, label: s.label }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{IMAGE_STYLES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {kind === "image" ? (
                <div className="space-y-1.5">
                  <Label>Variations</Label>
                  <Select value={String(count)} onValueChange={(v) => v && setCount(Number(v))}
                    items={Array.from({ length: MAX_VARIATIONS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>{Array.from({ length: MAX_VARIATIONS }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !brief.trim() || short} onClick={() => onGenerate(brief, style, count)}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Make with AI
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload /> Upload</Button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
            </div>
            <CreditsLine cost={cost} balance={credits} />
          </>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          {kind === "carousel" ? (
            <button type="button" disabled={!canEdit} onClick={() => onChoose(null)} aria-pressed={!selected}
              className={cn("grid aspect-square place-items-center rounded-md border-2 text-[11px] text-muted-foreground", !selected ? "border-primary" : "border-border")}>
              <ImagePlus className="size-4" /> Template
            </button>
          ) : null}
          {images.map((img) => (
            <div key={img.id} className={cn("group relative aspect-square overflow-hidden rounded-md border-2", selected === img.id ? "border-primary" : "border-border")}>
              {img.status === "ready" && img.url ? (
                <button type="button" className="size-full" disabled={!canEdit} onClick={() => onChoose(img.id)} aria-label="Use this picture">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private picture route */}
                  <img src={img.url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              ) : img.status === "pending" ? (
                <div className="grid size-full place-items-center bg-muted text-[11px] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Painting…</div>
              ) : (
                <div className="grid size-full place-items-center bg-destructive/10 p-1 text-center text-[10px] text-destructive" title={img.error ?? ""}>Failed — refunded</div>
              )}
              <Badge variant="secondary" className="absolute left-1 top-1 h-4 px-1 text-[9px]">{img.source === "ai" ? "AI" : "Upload"}</Badge>
              {canEdit && img.status !== "pending" ? (
                <button type="button" onClick={() => onRemove(img.id)} aria-label="Remove picture"
                  className="absolute right-1 top-1 hidden rounded bg-black/60 p-0.5 text-white group-hover:block"><X className="size-3" /></button>
              ) : null}
            </div>
          ))}
        </div>
        {!images.length ? <p className="text-xs text-muted-foreground">No pictures yet.</p> : null}
      </CardContent>
    </Card>
  );
}
