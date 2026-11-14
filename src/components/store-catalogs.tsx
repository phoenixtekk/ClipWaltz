"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, PackagePlus, Plug, RefreshCw, Store, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductPack } from "@/components/product-pack";
import { unwrap } from "@/lib/action-result";
import {
  connectCommerceStore, disableCommerceWebhooks, disconnectCommerceStore, enableCommerceWebhooks, syncCommerceStore,
} from "@/lib/commerce/actions";
import type { ProductView } from "@/lib/product-actions";

type StoreRow = {
  id: string; platform: string; storeUrl: string; label: string | null; currency: string | null; lastSyncedAt: string | null;
  lastSyncCount: number | null; lastError: string | null; webhooks: boolean;
};
type ProductRow = {
  id: string; connectionId: string | null; title: string; url: string; price: string | null; currency: string | null; brand: string | null;
  images: string[]; available: boolean | null; description: string | null; source: string;
};

const PLATFORM: Record<string, { name: string; hint: string }> = {
  shopify: { name: "Shopify", hint: "Your shop's own address, e.g. https://shop.example.com. No key needed." },
  woocommerce: { name: "WooCommerce", hint: "Your WordPress site's address. No key needed (uses WooCommerce's public Store API)." },
  wix: { name: "Wix", hint: "Your site's address, plus an API key with Wix Stores read permission and the site id." },
};

export function StoreCatalogs({ canManage, canEdit, stores, products }: { canManage: boolean; canEdit: boolean; stores: StoreRow[]; products: ProductRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [platform, setPlatform] = useState<"shopify" | "woocommerce" | "wix">("shopify");
  const [storeUrl, setStoreUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [siteId, setSiteId] = useState("");
  const [filter, setFilter] = useState("");
  const [pack, setPack] = useState<ProductView | null>(null);
  const [hook, setHook] = useState<{ id: string; platform: string; url?: string; secret?: string | null } | null>(null);
  const [shopifySecret, setShopifySecret] = useState("");

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });

  function connect(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const r = unwrap(await connectCommerceStore({ platform, storeUrl, apiKey, siteId }));
      if ("error" in r.sync) toast.warning(`Connected, but the first sync failed: ${r.sync.error}`);
      else toast.success(`Connected — ${r.sync.synced} product${r.sync.synced === 1 ? "" : "s"} synced.`);
      setStoreUrl("");
      setApiKey("");
      setSiteId("");
      router.refresh();
    });
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? products.filter((p) => p.title.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q)) : products;
  }, [products, filter]);
  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.label ?? "";

  return (
    <div className="space-y-6">
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plug className="size-4" /> Connect a store</CardTitle>
            <CardDescription>{PLATFORM[platform].hint}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={connect} className="space-y-3">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Store platform">
                {(["shopify", "woocommerce", "wix"] as const).map((p) => (
                  <Button key={p} type="button" role="radio" aria-checked={platform === p} variant={platform === p ? "default" : "outline"} size="sm" onClick={() => setPlatform(p)}>
                    {PLATFORM[p].name}
                  </Button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="store-url">Store address</Label>
                <Input id="store-url" required inputMode="url" placeholder="https://shop.example.com" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} />
              </div>
              {platform === "wix" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="wix-key">Wix API key</Label>
                    <Input id="wix-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wix-site">Site id</Label>
                    <Input id="wix-site" autoComplete="off" placeholder="1a2b3c4d-…" value={siteId} onChange={(e) => setSiteId(e.target.value)} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    The key is stored encrypted and never shown again. Create it in Wix: account settings → API Keys → Generate API Key, with the Wix Stores read permission for this site.
                  </p>
                </div>
              ) : null}
              <Button type="submit" disabled={busy || !storeUrl.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Store />} Connect and sync
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Connected stores</CardTitle>
          <CardDescription>Sync again any time — new products are added, changed prices and titles are updated, removed products disappear.</CardDescription>
        </CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stores yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {stores.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {s.label} <Badge variant="secondary">{PLATFORM[s.platform]?.name ?? s.platform}</Badge>{" "}
                      {s.webhooks ? <Badge variant="outline">Live updates on</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.storeUrl} · {s.lastSyncedAt ? `${s.lastSyncCount ?? 0} products, synced ${new Date(s.lastSyncedAt).toLocaleString()}` : "Not synced yet"}
                    </p>
                    {s.lastError ? <p className="text-xs text-destructive">{s.lastError}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEdit ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => {
                        const r = unwrap(await syncCommerceStore(s.id));
                        toast.success(`${r.synced} products synced${r.removed ? `, ${r.removed} removed` : ""}.`);
                        router.refresh();
                      })}>
                        <RefreshCw /> Sync now
                      </Button>
                    ) : null}
                    {canManage && s.platform !== "wix" ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setHook({ id: s.id, platform: s.platform })}>
                        <Webhook /> Live updates
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                        if (!confirm("Disconnect this store? Its products are removed from ClipWaltz and any saved key is deleted. Ads you already made stay.")) return;
                        run(async () => {
                          unwrap(await disconnectCommerceStore(s.id));
                          toast.success("Store disconnected.");
                          router.refresh();
                        });
                      }}>
                        <Trash2 /> Disconnect
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {products.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Products ({products.length})</CardTitle>
            <CardDescription>Pick a product to make image ads and a video ad brief from it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Filter products" aria-label="Filter products" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-sm" />
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.slice(0, 120).map((p) => (
                <li key={p.id} className="flex gap-3 rounded-lg border border-border p-2">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote store images, any host
                    <img src={p.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="size-16 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="line-clamp-2 text-sm font-medium">{p.title}</p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {p.price ? <span>{p.currency ? `${p.currency} ` : ""}{p.price}</span> : null}
                      {p.available === false ? <Badge variant="outline">Out of stock</Badge> : null}
                      <span className="truncate">{storeName(p.connectionId)}</span>
                    </p>
                    {canEdit ? (
                      <Button size="sm" variant="secondary" onClick={() => setPack({
                        id: p.id, url: p.url, title: p.title, description: p.description, price: p.price, currency: p.currency, brand: p.brand, images: p.images, source: p.source,
                      })}>
                        <PackagePlus /> Make a pack
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {shown.length > 120 ? <p className="text-xs text-muted-foreground">Showing 120 of {shown.length} — filter to find the rest.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={Boolean(pack)} onOpenChange={(o) => !o && setPack(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Make a pack</DialogTitle>
            <DialogDescription>Image ads in the sizes you pick, plus a WaltzDeck video ad brief. Credits are shown before anything is made.</DialogDescription>
          </DialogHeader>
          {pack ? <ProductPack key={pack.id} initial={pack} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(hook)} onOpenChange={(o) => !o && (setHook(null), setShopifySecret(""))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Live product updates</DialogTitle>
            <DialogDescription>
              {hook?.platform === "shopify"
                ? "In Shopify: Settings → Notifications → Webhooks → Create webhook for Product creation, Product update and Product deletion (JSON), with the URL below. Then paste the signing secret Shopify shows on that page."
                : "In WordPress: WooCommerce → Settings → Advanced → Webhooks → Add webhook for Product created, updated and deleted, with the URL and secret below."}
            </DialogDescription>
          </DialogHeader>
          {hook ? (
            <div className="space-y-3">
              {hook.platform === "shopify" && !hook.url ? (
                <div className="space-y-1.5">
                  <Label htmlFor="shopify-secret">Shopify webhook signing secret</Label>
                  <Input id="shopify-secret" type="password" autoComplete="off" value={shopifySecret} onChange={(e) => setShopifySecret(e.target.value)} />
                </div>
              ) : null}
              {hook.url ? (
                <div className="space-y-2">
                  <Field label="Delivery URL" value={hook.url} />
                  {hook.secret ? <Field label="Secret (shown once)" value={hook.secret} /> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!hook.url ? (
                  <Button disabled={busy || (hook.platform === "shopify" && shopifySecret.trim().length < 16)} onClick={() => run(async () => {
                    const r = unwrap(await enableCommerceWebhooks(hook.id, shopifySecret));
                    setHook({ ...hook, url: r.url, secret: r.secret });
                    router.refresh();
                  })}>
                    <Webhook /> Turn on
                  </Button>
                ) : null}
                <Button variant="outline" disabled={busy} onClick={() => run(async () => {
                  unwrap(await disableCommerceWebhooks(hook.id));
                  toast.success("Live updates turned off.");
                  setHook(null);
                  router.refresh();
                })}>
                  Turn off
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied."))}>
          <Copy />
        </Button>
      </div>
    </div>
  );
}
