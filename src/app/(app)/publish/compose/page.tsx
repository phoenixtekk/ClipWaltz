import { Composer } from "@/components/publish/composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { aiConfigured } from "@/lib/social/ai";
import { publishPage } from "@/lib/social/page-context";
import { destinationsView, exportPrefill, getPostView, renderPrefill } from "@/lib/social/ui";

export const metadata = { title: "Compose · Publish" };

// /publish/compose             new post
// /publish/compose?render=<id> new post with a finished render attached (Publish button on renders / campaign variants)
// /publish/compose?export=<id> new post with a finished export attached
// /publish/compose?post=<id>   edit a saved draft / scheduled / queued post
export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sc = await publishPage("editor");
  if (!sc) return null;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const postId = one("post");
  const renderId = one("render");
  const exportId = one("export");

  const [destinations, editing, prefill] = await Promise.all([
    destinationsView(sc.workspaceId),
    postId ? getPostView(sc.workspaceId, postId) : Promise.resolve(null),
    renderId
      ? renderPrefill(sc.userId, sc.workspaceId, renderId)
      : exportId
        ? exportPrefill(sc.userId, sc.workspaceId, exportId)
        : Promise.resolve(null),
  ]);
  const missing = Boolean(renderId || exportId) && !prefill;

  return (
    <div className="space-y-4">
      {missing ? (
        <Alert variant="destructive">
          <AlertTitle>That video can&apos;t be attached</AlertTitle>
          <AlertDescription>It isn&apos;t finished, was deleted, or belongs to a project you can&apos;t open. You can still write a post.</AlertDescription>
        </Alert>
      ) : null}
      {postId && !editing ? (
        <Alert variant="destructive">
          <AlertTitle>Post not found</AlertTitle>
          <AlertDescription>It may have been deleted. You are writing a new post instead.</AlertDescription>
        </Alert>
      ) : null}
      <Composer
        key={editing?.id ?? renderId ?? exportId ?? "new"}
        destinations={destinations}
        prefill={prefill}
        editing={editing}
        aiAvailable={aiConfigured()}
      />
    </div>
  );
}
