import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Film } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { postByShareToken } from "@/lib/social/ui";
import { ReviewDecision } from "@/components/publish/review-decision";
import { STATUS_LABEL, providerName } from "@/lib/social/ui-types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Post for review", robots: { index: false, follow: false } };

// Public, read-only review link for a post (/r/<token>). Shows the text, each channel's own version and the media —
// nothing else about the workspace. The owner turns the link off from the post's menu, which makes this a 404.
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const post = await postByShareToken(token);
  if (!post) notFound();

  const versions = post.destinations
    .map((d) => ({ ...d, text: post.perNetwork?.[d.key]?.text }))
    .filter((d): d is typeof d & { text: string } => Boolean(d.text?.trim()));

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="ClipWaltz home">
            <Image src="/logo-2.png" alt="" width={273} height={263} className="size-7" />
            <span className="cw-gradient-text text-lg font-bold tracking-tight">ClipWaltz</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Post for review <Badge variant="outline">{STATUS_LABEL[post.status] ?? post.status}</Badge>
              {post.approvalStatus === "pending" ? <Badge>Waiting for approval</Badge> : null}
              {post.approvalStatus === "approved" ? <Badge variant="secondary">Approved</Badge> : null}
              {post.approvalStatus === "rejected" ? <Badge variant="destructive">Changes requested</Badge> : null}
            </CardTitle>
            <CardDescription>
              Shared with you to read before (or after) it goes out. Planned for: {post.destinations.map((d) => providerName(d.provider)).join(", ") || "no channels yet"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-base whitespace-pre-wrap">{post.text}</p>
            {post.link ? (
              <a href={post.link} rel="noopener noreferrer nofollow" target="_blank" className="text-sm break-all text-primary underline underline-offset-2">
                {post.link}
              </a>
            ) : null}
            {post.media.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {post.media.map((m) =>
                  m.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed media URL
                    <img key={m.id} src={m.previewUrl} alt={m.filename} className="aspect-square w-full rounded-lg object-cover" />
                  ) : (
                    <div key={m.id} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-border text-xs text-muted-foreground">
                      <Film className="size-6" /> {m.filename}
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
        {versions.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Versions for each channel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {versions.map((v, i) => (
                <div key={v.key} className="space-y-1">
                  {i > 0 ? <Separator className="mb-4" /> : null}
                  <p className="text-sm font-medium">{providerName(v.provider)}</p>
                  <p className="text-sm whitespace-pre-wrap">{v.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
        {post.approvalStatus === "pending" ? <ReviewDecision token={token} /> : null}
        <p className="text-center text-xs text-muted-foreground">
          Made with <Link href="/" className="underline underline-offset-2">ClipWaltz</Link>.
        </p>
      </main>
    </div>
  );
}
