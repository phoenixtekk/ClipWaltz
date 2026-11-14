import { Composer } from "@/components/publish/composer";
import { RoleRequired } from "@/components/publish/role-required";
import { roleAtLeast } from "@/lib/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { aiConfigured } from "@/lib/social/ai";
import { publishPage } from "@/lib/social/page-context";
import { destinationsView, exportPrefill, getPostView, imagesPrefill, renderPrefill } from "@/lib/social/ui";

export const metadata = { title: "Compose · Publish" };

// /publish/compose             new post
// /publish/compose?render=<id> new post with a finished render attached (Publish button on renders / campaign variants)
// /publish/compose?export=<id> new post with a finished export attached
// /publish/compose?post=<id>   edit a saved draft / scheduled / queued post
// /publish/compose?media=<id,…>&from=<design> new post with Waltz Image outputs attached (Publish on an image design)
export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sc = await publishPage();
  if (!sc) return null;
  if (!roleAtLeast(sc.role, "editor")) return <RoleRequired role={sc.role} need="editor" />;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const postId = one("post");
  const renderId = one("render");
  const exportId = one("export");
  const mediaIds = one("media");
  const fromDesign = one("from");

  const [destinations, editing, prefill] = await Promise.all([
    destinationsView(sc.workspaceId),
    postId ? getPostView(sc.workspaceId, postId) : Promise.resolve(null),
    renderId
      ? renderPrefill(sc.userId, sc.workspaceId, renderId)
      : exportId
        ? exportPrefill(sc.userId, sc.workspaceId, exportId)
        : mediaIds
          ? imagesPrefill(sc.userId, sc.workspaceId, mediaIds, fromDesign)
          : Promise.resolve(null),
  ]);
  const missing = Boolean(renderId || exportId) && !prefill;
  const missingImages = Boolean(mediaIds) && !renderId && !exportId && !prefill;

  return (
    <div className="space-y-4">
      {missing ? (
        <Alert variant="destructive">
          <AlertTitle>That video can&apos;t be attached</AlertTitle>
          <AlertDescription>It isn&apos;t finished, was deleted, or belongs to a project you can&apos;t open. You can still write a post.</AlertDescription>
        </Alert>
      ) : null}
      {missingImages ? (
        <Alert variant="destructive">
          <AlertTitle>Those images can&apos;t be attached</AlertTitle>
          <AlertDescription>They were already used in a post or deleted. Open the design and press Publish again.</AlertDescription>
        </Alert>
      ) : null}
      {postId && !editing ? (
        <Alert variant="destructive">
          <AlertTitle>Post not found</AlertTitle>
          <AlertDescription>It may have been deleted. You are writing a new post instead.</AlertDescription>
        </Alert>
      ) : null}
      <Composer
        key={editing?.id ?? renderId ?? exportId ?? mediaIds ?? "new"}
        destinations={destinations}
        prefill={prefill}
        editing={editing}
        aiAvailable={aiConfigured()}
        approvalRule={{ required: sc.requireApproval, approver: sc.approver }}
      />
    </div>
  );
}
