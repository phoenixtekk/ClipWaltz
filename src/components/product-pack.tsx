"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Coins, ImageIcon, Link2, Loader2, PackagePlus, Video } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unwrap } from "@/lib/action-result";
import {
  makeProductPack, quoteProductPack, readProductUrl, type PackResult, type ProductView,
} from "@/lib/product-actions";

const FORMATS = [
  { key: "1:1", label: "Square post" },
  { key: "4:5", label: "Portrait feed" },
  { key: "9:16", label: "Story / Reel" },
  { key: "1.91:1", label: "Link / ad card" },
  { key: "2:3", label: "Pin" },
];

const SOURCE: Record<string, string> = {
  jsonld: "product data on the page",
  og: "the page's product tags",
  text: "the page text (no product data found — check the details)",
  catalog: "your store catalog",
};

/**
 * G3: "Start from a product link" — product page → image ads (Waltz Image) + a WaltzDeck video brief.
 * G10: with `initial`, the product comes from a synced store catalog and the link reader is hidden.
 */
export function ProductPack({ initial }: { initial?: ProductView } = {}) {
  const [busy, start] = useTransition();
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<ProductView | null>(initial ?? null);
  const [formats, setFormats] = useState<string[]>(["1:1", "9:16"]);
  const [deck, setDeck] = useState(true);
  const [aiIfNone, setAiIfNone] = useState(false);
  const [quote, setQuote] = useState<{ hasPhoto: boolean; credits: number } | null>(null);
  const [result, setResult] = useState<PackResult | null>(null);
  const quoted = useRef(false);
  // A catalog product is already read: ask for the first quote once (credits depend on whether it has a usable photo).
  useEffect(() => {
    if (!initial || quoted.current) return;
    quoted.current = true;
    start(async () => {
      try {
        setQuote(unwrap(await quoteProductPack(initial.id, ["1:1", "9:16"], false)));
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }, [initial]);

  function read(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        setResult(null);
        setQuote(null);
        const p = unwrap(await readProductUrl(url));
        setProduct(p);
        setQuote(unwrap(await quoteProductPack(p.id, formats, aiIfNone)));
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function requote(nextFormats: string[], nextAi: boolean) {
    if (!product) return;
    start(async () => {
      try {
        setQuote(unwrap(await quoteProductPack(product.id, nextFormats, nextAi)));
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function make() {
    if (!product || !quote) return;
    start(async () => {
      try {
        const r = unwrap(await makeProductPack({ productId: product.id, formats, aiPictureIfNone: aiIfNone, deck, confirmCredits: quote.credits }));
        setResult(r);
        toast.success("Your pack is ready.");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Card className={initial ? "" : "mb-6"}>
      <CardHeader className={initial ? "hidden" : undefined}>
        <CardTitle className="flex items-center gap-2"><Link2 className="size-4" /> Start from a product link</CardTitle>
        <CardDescription>
          Paste a product page (Shopify, WooCommerce or any shop). ClipWaltz reads the name, price and photos, then makes image ads and a
          video ad brief from it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={read} className={initial ? "hidden" : "flex flex-col gap-2 sm:flex-row"}>
          <Input type="url" inputMode="url" required placeholder="https://shop.example.com/products/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Product page address" className="sm:flex-1" />
          <Button type="submit" disabled={busy || !url.trim()}>
            {busy && !product ? <Loader2 className="animate-spin" /> : <Link2 />} Read the page
          </Button>
        </form>

        {product ? (
          <div className="space-y-4 rounded-lg border border-border p-3">
            <div className="space-y-1">
              <p className="font-medium">{product.title}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {product.price ? <Badge variant="secondary">{product.currency ? `${product.currency} ` : ""}{product.price}</Badge> : <Badge variant="outline">No price found</Badge>}
                {product.brand ? <span>{product.brand}</span> : null}
                <span>{product.images.length} photo{product.images.length === 1 ? "" : "s"} found</span>
              </p>
              <p className="text-xs text-muted-foreground">Read from {SOURCE[product.source] ?? product.source}.</p>
              {product.description ? <p className="line-clamp-3 text-sm">{product.description}</p> : null}
            </div>
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><ImageIcon className="size-4" /> Image ads</p>
              <div className="flex flex-wrap gap-3">
                {FORMATS.map((f) => (
                  <Label key={f.key} className="flex items-center gap-1.5 font-normal">
                    <Checkbox
                      checked={formats.includes(f.key)}
                      onCheckedChange={(v) => {
                        const next = v ? [...new Set([...formats, f.key])] : formats.filter((x) => x !== f.key);
                        setFormats(next);
                        requote(next, aiIfNone);
                      }}
                    />
                    {f.label} <span className="text-xs text-muted-foreground">{f.key}</span>
                  </Label>
                ))}
              </div>
              {quote && !quote.hasPhoto ? (
                <Label className="flex items-start gap-2 font-normal">
                  <Checkbox
                    checked={aiIfNone}
                    onCheckedChange={(v) => {
                      setAiIfNone(Boolean(v));
                      requote(formats, Boolean(v));
                    }}
                  />
                  <span className="text-sm">No usable product photo on the page. Make an AI picture for each ad (else the ads are text-led on your brand colours).</span>
                </Label>
              ) : null}
            </div>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={deck} onCheckedChange={(v) => setDeck(Boolean(v))} />
              <Video className="size-4" /> A WaltzDeck video ad brief (you plan and render it next; its credits show there)
            </Label>
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-1.5 text-sm">
                <Coins className="size-4" /> Total now: <b className="tabular-nums">{quote ? quote.credits : "…"}</b> credits
              </p>
              <Button type="button" disabled={busy || !quote || (!formats.length && !deck)} onClick={make}>
                {busy && product ? <Loader2 className="animate-spin" /> : <PackagePlus />} Make the pack{quote?.credits ? ` · ${quote.credits} credits` : ""}
              </Button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {result.note ? <p className="text-amber-700 dark:text-amber-400">{result.note}</p> : null}
            <div className="flex flex-wrap gap-2">
              {result.designs.map((d) => (
                <Link key={d.id} href={`/images/${d.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <ImageIcon /> Ad {d.format}
                </Link>
              ))}
              {result.projectId ? (
                <Link href={`/projects/${result.projectId}/deck`} className={buttonVariants({ size: "sm" })}>
                  <Video /> Open the video brief
                </Link>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">Publish any ad from its page — the composer can write the post copy and hashtags for each network in one click.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
