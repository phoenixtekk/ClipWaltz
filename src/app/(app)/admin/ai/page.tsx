import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/admin";
import { getAiRegistry } from "@/lib/ai-admin-actions";
import { AdminAi } from "@/components/admin-ai";

export const metadata = { title: "AI models & routing" };

export default async function AdminAiPage() {
  const admin = await getAdminSession();
  if (!admin) redirect("/projects");
  const registry = await getAiRegistry();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="cw-glass flex items-center justify-between gap-3 rounded-2xl p-4">
        <div>
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">AI models &amp; routing</h1>
          <p className="text-sm text-muted-foreground">
            Turn models and workflows on or off, and choose which workflow and settings each quality level uses.
          </p>
        </div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Admin</Link>
      </div>
      <AdminAi registry={registry} />
    </div>
  );
}
