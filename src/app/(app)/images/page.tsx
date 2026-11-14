import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { ensurePersonalWorkspace } from "@/lib/workspace";
import { listDesigns } from "@/lib/image-ad/designs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewDesign } from "@/components/images/new-design";

export const metadata = { title: "Waltz Image" };

const KIND = { image: "Image", carousel: "Carousel", meme: "Meme" } as const;

export default async function ImagesPage() {
  const userId = await requireUserId();
  const designs = await listDesigns(await ensurePersonalWorkspace(userId));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waltz Image</h1>
        <p className="text-sm text-muted-foreground">Image ads, social graphics, carousels and memes — sized exactly for each network.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Make something new</CardTitle>
          <CardDescription>Pick what to make and its shape. You can change the format later.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewDesign />
        </CardContent>
      </Card>
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Your designs</h2>
        {designs.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {designs.map((d) => (
              <Link key={d.id} href={`/images/${d.id}`} className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/60">
                <div className="grid aspect-square place-items-center bg-muted/40 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- composited on demand */}
                  <img src={`/api/images/${d.id}/render?i=0&r=${encodeURIComponent(d.updatedAt)}`} alt="" loading="lazy" className="max-h-full max-w-full rounded" />
                </div>
                <div className="space-y-1 p-2.5">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{KIND[d.kind]}</Badge>
                    {d.format}{d.outputs > 1 ? ` · ${d.outputs} slides` : ""}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing yet — your images, carousels and memes will show here.</p>
        )}
      </div>
    </div>
  );
}
