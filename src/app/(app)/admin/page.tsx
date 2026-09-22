import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin";
import { listUsersAdmin, listInvitesAdmin } from "@/lib/admin-actions";
import { getContestsAdmin, getActiveContest, getContestBoard } from "@/lib/contest";
import { listAllAnnouncements } from "@/lib/announcements";
import { AdminGrantForm, RevokeButton } from "@/components/admin-grant-form";
import { AdminContest } from "@/components/admin-contest";
import { AdminAnnouncements } from "@/components/admin-announcements";

export const metadata = { title: "Admin" };

const TIER_BADGE: Record<string, string> = {
  pro: "bg-primary/10 text-primary",
  plus: "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400",
  free: "bg-muted text-muted-foreground",
};

export default async function AdminPage() {
  const admin = await getAdminSession();
  if (!admin) redirect("/projects");

  const [users, invites, contests, active, announcements] = await Promise.all([
    listUsersAdmin(),
    listInvitesAdmin(),
    getContestsAdmin(),
    getActiveContest(),
    listAllAnnouncements(),
  ]);
  const pending = invites.filter((i) => !i.redeemedAt);
  const activeEntries = active ? await getContestBoard(active.id) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Invite people and grant Plus/Pro access — lifetime or with an expiry date.
          </p>
        </div>
        <a href="/admin/batch" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary hover:text-primary">
          🎬 Auto-Batch
        </a>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Grant / invite access</h2>
        <AdminGrantForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Monthly Theme Challenge</h2>
        <AdminContest contests={contests} activeEntries={activeEntries} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Announcements &amp; promos</h2>
          <p className="text-xs text-muted-foreground">
            In-app content on the dashboard &amp; community — upgrade promos (target Free users),
            feature drops, contest banners, cross-promo. Scheduled &amp; dismissible.
          </p>
        </div>
        <AdminAnnouncements announcements={announcements} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Users <span className="text-muted-foreground">({users.length})</span>
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Tier</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{u.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TIER_BADGE[u.tier] ?? TIER_BADGE.free}`}>
                      {u.tier}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {u.tier !== "free" ? <RevokeButton userId={u.id} email={u.email} /> : null}
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No users yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {pending.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">
            Pending invites <span className="text-muted-foreground">({pending.length})</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Tier</th>
                  <th className="px-4 py-2 font-medium">Expires</th>
                  <th className="px-4 py-2 font-medium">Invited</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pending.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2">{i.email}</td>
                    <td className="px-4 py-2 capitalize">{i.tier}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "Lifetime"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(i.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
