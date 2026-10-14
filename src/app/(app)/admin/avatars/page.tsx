import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin";
import { adminListLibrary } from "@/lib/presenter-library-actions";
import { AdminAvatars } from "@/components/admin-avatars";

export const metadata = { title: "Presenter library" };

export default async function AdminAvatarsPage() {
  if (!(await getAdminSession())) redirect("/projects");
  const res = await adminListLibrary();
  if (!res.ok) throw new Error(res.error);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Presenter library</h1>
        <p className="text-sm text-muted-foreground">
          Waltz Avatar presenters every user can pick: <b>AI presenters</b> (fictional faces generated here) and <b>licensed
          actors</b> (their footage + a signed release covering AI likeness and voice — scope, territory and term). A presenter
          shows in users&apos; library only once it&apos;s ready and published.
        </p>
      </div>
      <AdminAvatars initial={res.data} />
    </div>
  );
}
