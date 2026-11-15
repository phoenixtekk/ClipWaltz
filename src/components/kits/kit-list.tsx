import Link from "next/link";
import { CheckCircle2, FileText, Loader2, Package, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { kitNetwork, type KitListItem } from "@/lib/kits/types";

/** Publish → Post kits: every kit of the workspace, newest first. */
export function KitList({ kits }: { kits: KitListItem[] }) {
  if (!kits.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Package className="size-4" /> No kits yet</CardTitle>
          <CardDescription>
            Press New kit, or use the Post kit button on a finished video or a Waltz Image design.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {kits.map((k) => {
        const done = k.networks.length > 0 && k.posted >= k.networks.length;
        return (
          <li key={k.id}>
            <Link href={`/publish/kits/${k.id}`} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <div className="flex aspect-[16/9] items-center justify-center overflow-hidden rounded-t-xl bg-muted">
                  {k.thumbMediaId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/kits/${k.id}/file/${k.thumbMediaId}`} alt="" className="size-full object-contain" loading="lazy" />
                  ) : (
                    <FileText className="size-8 text-muted-foreground" />
                  )}
                </div>
                <CardContent className="space-y-2 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 font-medium">{k.title}</p>
                    {k.status === "writing" ? (
                      <Badge variant="secondary"><Loader2 className="animate-spin" /> Writing</Badge>
                    ) : k.status === "failed" ? (
                      <Badge variant="destructive"><TriangleAlert /> Needs a retry</Badge>
                    ) : done ? (
                      <Badge><CheckCircle2 /> All posted</Badge>
                    ) : (
                      <Badge variant="outline">{k.posted}/{k.networks.length} posted</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{k.sourceLabel} · {new Date(k.createdAt).toLocaleDateString()}</p>
                  <p className="text-xs text-muted-foreground">{k.networks.map((n) => kitNetwork(n)?.label ?? n).join(" · ")}</p>
                </CardContent>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
