"use client";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DesignListItem } from "@/lib/image-ad/types";

const CTAS: { key: string; label: string }[] = [
  { key: "SHOP_NOW", label: "Shop now" }, { key: "LEARN_MORE", label: "Learn more" }, { key: "SIGN_UP", label: "Sign up" },
  { key: "ORDER_NOW", label: "Order now" }, { key: "BOOK_NOW", label: "Book now" }, { key: "GET_OFFER", label: "Get offer" },
  { key: "CONTACT_US", label: "Contact us" }, { key: "DOWNLOAD", label: "Download" }, { key: "SUBSCRIBE", label: "Subscribe" },
];
const GOOGLE_OK = new Set(["1.91:1", "1:1", "4:5"]);

export function AdsExport({ designs }: { designs: DesignListItem[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [campaign, setCampaign] = useState("");
  const [landingUrl, setLandingUrl] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [cta, setCta] = useState("LEARN_MORE");
  const [busy, setBusy] = useState(false);

  const chosen = designs.filter((d) => picked.includes(d.id));
  const hasLandscape = chosen.some((d) => d.format === "1.91:1");
  const hasSquare = chosen.some((d) => d.format === "1:1");

  async function download(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/images/ads-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ designIds: picked, campaign, landingUrl, primaryText, businessName, cta }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The export failed.");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "ads-export.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast.success("Downloaded. Open README.txt in the ZIP for the import steps.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={download} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Pick the ads</CardTitle>
          <CardDescription>Each image (or carousel slide) becomes one ad for Meta. Google Performance Max uses the 1.91:1, 1:1 and 4:5 ones.</CardDescription>
        </CardHeader>
        <CardContent>
          {designs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No designs yet — make some in Waltz Image first.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {designs.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 rounded-lg border border-border p-2">
                  <div className="grid aspect-square place-items-center bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element -- composited on demand */}
                    <img src={`/api/images/${d.id}/render?i=0&r=${encodeURIComponent(d.updatedAt)}`} alt="" loading="lazy" className="max-h-full max-w-full rounded" />
                  </div>
                  <Label className="flex items-center gap-2 font-normal">
                    <Checkbox aria-label={d.title} checked={picked.includes(d.id)} onCheckedChange={(v) => setPicked(v ? [...picked, d.id] : picked.filter((x) => x !== d.id))} />
                    <span className="truncate text-sm">{d.title}</span>
                  </Label>
                  <span className="flex gap-1 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{d.format}</Badge>
                    {GOOGLE_OK.has(d.format) ? null : <span>Meta only</span>}
                    {d.outputs > 1 ? <span>· {d.outputs} slides</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Campaign details</CardTitle>
          <CardDescription>Links get utm_source, utm_medium, utm_campaign and utm_content so you can see which ad worked.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ax-campaign">Campaign name</Label>
            <Input id="ax-campaign" required maxLength={100} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Spring sale" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ax-url">Landing page</Label>
            <Input id="ax-url" required type="url" value={landingUrl} onChange={(e) => setLandingUrl(e.target.value)} placeholder="https://www.example.com/sale" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ax-biz">Business name <span className="text-muted-foreground">(Google, up to 25 characters)</span></Label>
            <Input id="ax-biz" maxLength={25} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ax-cta">Button (Meta)</Label>
            <select id="ax-cta" value={cta} onChange={(e) => setCta(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
              {CTAS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ax-text">
              Primary text <span className="text-muted-foreground">(the words above the ad; Google uses it as the long headline and a description)</span>
            </Label>
            <Textarea id="ax-text" maxLength={2000} rows={3} value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !picked.length || !campaign.trim() || !landingUrl.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />} Download ZIP
        </Button>
        {picked.length && (!hasLandscape || !hasSquare) ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Google needs at least one landscape 1.91:1 and one square 1:1 image — the Meta file is fine either way.
          </p>
        ) : null}
      </div>
    </form>
  );
}
