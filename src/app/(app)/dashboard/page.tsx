import Link from "next/link";
import { FolderOpen, Film, Clock, Heart, MessageCircle, Sparkles, Users, ArrowRight } from "lucide-react";
import { getSession, requireUserId } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { getDashboardStats } from "@/lib/dashboard";
import { watermarkPaidPlans } from "@/lib/watermark";
import { getPublicFeed } from "@/lib/feed";
import { listActiveAnnouncements } from "@/lib/announcements";
import { NewProjectButton } from "@/components/new-project-button";
import { ProjectCard } from "@/components/project-card";
import { AnnouncementsView } from "@/components/announcements-view";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getSession();
  const userId = await requireUserId();
  const [stats, projects, feed] = await Promise.all([
    getDashboardStats(userId),
    listProjects(),
    getPublicFeed(8),
  ]);
  const paidWatermarked = stats.tier === "free" ? await watermarkPaidPlans() : true;
  const [banners, cards] = await Promise.all([
    listActiveAnnouncements("dashboard_banner", stats.tier),
    listActiveAnnouncements("dashboard_card", stats.tier),
  ]);

  const firstName = (session?.user?.name || "").split(" ")[0] || "there";
  const recent = projects.slice(0, 6);
  const quotaPct =
    stats.quota == null ? 0 : Math.min(100, Math.round((stats.rendersThisMonth / stats.quota) * 100));

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="cw-gradient-text text-2xl font-semibold tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">Your ClipWaltz studio at a glance.</p>
        </div>
        <NewProjectButton />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        {/* main column */}
        <div className="space-y-6">
          <AnnouncementsView banner={banners[0] ?? null} cards={cards} />

          {/* analytics tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile icon={<FolderOpen className="size-4" />} label="Projects" value={stats.projects} accent="violet" />
            <Tile icon={<Film className="size-4" />} label="Videos made" value={stats.rendered} accent="blue" />
            <Tile icon={<Clock className="size-4" />} label="Minutes" value={stats.minutes} accent="magenta" />
            <Tile icon={<Heart className="size-4" />} label="Likes" value={stats.likes} accent="coral" />
            <Tile icon={<MessageCircle className="size-4" />} label="Comments" value={stats.comments} accent="violet" />
          </div>

          {/* plan usage meter */}
          <div className="cw-glass rounded-2xl p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium capitalize">{stats.tier} plan</span>
              <span className="text-muted-foreground">
                {stats.quota == null
                  ? `${stats.rendersThisMonth} renders this month · unlimited`
                  : `${stats.rendersThisMonth} / ${stats.quota} renders this month`}
              </span>
            </div>
            {stats.quota != null ? (
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${quotaPct}%`, background: "var(--cw-spectrum)" }}
                />
              </div>
            ) : null}
            {stats.tier === "free" ? (
              <div className="mt-3">
                <Link
                  href="/account/billing"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--cw-violet)] hover:underline"
                >
                  <Sparkles className="size-3.5" /> Upgrade for more renders{paidWatermarked ? "" : " & no watermark"}
                </Link>
              </div>
            ) : null}
          </div>

          {/* jump back in */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Jump back in</h2>
              <Link href="/projects" className="text-xs text-muted-foreground hover:text-foreground">
                All projects →
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="cw-glass flex flex-col items-center gap-4 rounded-2xl py-12 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  No projects yet — drop in photos and videos and ClipWaltz auto-edits them into a
                  music-driven highlight video.
                </p>
                <NewProjectButton size="lg" label="+ New Project" />
              </div>
            ) : (
              <div className="grid grid-cols-3 items-start gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {recent.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* right rail: community feed → clicking anything goes to /community */}
        <aside className="cw-glass rounded-2xl p-4 xl:sticky xl:top-4">
          <div className="mb-3 flex items-center justify-between">
            <Link href="/community" className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-foreground">
              <Users className="size-4 text-[color:var(--cw-violet)]" /> From the community
            </Link>
            <Link href="/community" className="text-xs text-muted-foreground hover:text-foreground">
              See all
            </Link>
          </div>
          {feed.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No public creations yet. <Link href="/community" className="text-[color:var(--cw-violet)] hover:underline">Explore the community →</Link>
            </p>
          ) : (
            <ul className="space-y-2">
              {feed.map((f) => (
                <li key={f.renderId}>
                  <Link
                    href="/community"
                    className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2 transition-colors hover:border-[color:var(--cw-violet)]/40 hover:bg-card"
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-[10px] font-semibold text-white"
                      style={{ background: "var(--cw-spectrum)" }}
                    >
                      {f.aspect}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{f.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">by {f.creator}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Heart className="size-3.5" /> {f.likes}
                    </span>
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/community"
                  className="flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium text-[color:var(--cw-violet)] hover:underline"
                >
                  Open the community <ArrowRight className="size-3.5" />
                </Link>
              </li>
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

const TILE_ACCENT: Record<string, string> = {
  violet: "text-[color:var(--cw-violet)]",
  blue: "text-[color:var(--cw-blue)]",
  magenta: "text-[color:var(--cw-magenta)]",
  coral: "text-[color:var(--cw-coral)]",
};

function Tile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="cw-glass rounded-2xl p-4">
      <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${TILE_ACCENT[accent] ?? TILE_ACCENT.violet}`}>
        {icon}
        <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value.toLocaleString()}</div>
    </div>
  );
}
