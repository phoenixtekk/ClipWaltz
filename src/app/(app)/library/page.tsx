import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { getUserMedia } from "@/lib/media";
import { listProjects } from "@/lib/projects";
import { hasDriveConnection, driveConfigured } from "@/lib/drive";
import { MediaLibrary } from "@/components/media-library";

export const metadata = { title: "Media library" };

export default async function LibraryPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in");
  const [media, projects, driveConnected] = await Promise.all([
    getUserMedia(userId),
    listProjects(),
    hasDriveConnection(userId),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Media library</h1>
        <p className="text-sm text-muted-foreground">
          Every photo &amp; video you&apos;ve imported — reuse them across projects, back them up, download, and tidy up.
        </p>
      </div>
      <MediaLibrary
        media={media}
        projects={projects.map((p) => ({ id: p.id, title: p.title }))}
        driveConnected={driveConnected}
        driveAvailable={driveConfigured()}
      />
    </div>
  );
}
