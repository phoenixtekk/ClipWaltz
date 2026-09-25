import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/admin";
import { getOpsQueue, getUsageMetrics } from "@/lib/ops-admin-actions";
import { AdminOps } from "@/components/admin-ops";

export const metadata = { title: "Operations" };

export default async function AdminOpsPage() {
  const admin = await getAdminSession();
  if (!admin) redirect("/projects");
  const [queue, usage] = await Promise.all([getOpsQueue(), getUsageMetrics(30)]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="cw-glass flex items-center justify-between gap-3 rounded-2xl p-4">
        <div>
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground">Live AI queues and GPU status, recent jobs, and usage.</p>
        </div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Admin</Link>
      </div>
      <AdminOps initialQueue={queue} initialUsage={usage} />
    </div>
  );
}
