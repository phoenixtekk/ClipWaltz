"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Eye, EyeOff, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Announcement } from "@/lib/announcements";
import {
  createAnnouncement,
  toggleAnnouncement,
  deleteAnnouncement,
} from "@/lib/announcement-actions";

const PLACEMENT_LABEL: Record<string, string> = {
  dashboard_banner: "Dashboard banner",
  dashboard_card: "Dashboard card",
  community: "Community",
};
const AUDIENCE_LABEL: Record<string, string> = {
  all: "Everyone",
  free: "Free users",
  paid: "Paid users",
};

export function AdminAnnouncements({ announcements }: { announcements: Announcement[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(announcements.length === 0);
  const [pending, start] = useTransition();

  const submit = (form: FormData) =>
    start(async () => {
      try {
        await createAnnouncement(form);
        toast.success("Announcement published");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not publish");
      }
    });

  const act = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Action failed");
      }
    });

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--cw-violet)] hover:underline"
      >
        <Plus className="size-4" /> {open ? "Hide form" : "New announcement"}
      </button>

      {open ? (
        <form action={submit} className="cw-glass grid gap-3 rounded-xl p-4 sm:grid-cols-2">
          <label className="sm:col-span-2 space-y-1">
            <span className="text-xs text-muted-foreground">Title *</span>
            <Input name="title" required maxLength={120} placeholder="Introducing Cinematic presets" />
          </label>
          <label className="sm:col-span-2 space-y-1">
            <span className="text-xs text-muted-foreground">Body</span>
            <textarea
              name="body"
              maxLength={500}
              rows={2}
              placeholder="Short supporting copy…"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">CTA label</span>
            <Input name="ctaLabel" maxLength={40} placeholder="Upgrade to Pro" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">CTA URL</span>
            <Input name="ctaUrl" maxLength={500} placeholder="/account/billing or https://…" />
          </label>
          <label className="sm:col-span-2 space-y-1">
            <span className="text-xs text-muted-foreground">Image URL (optional)</span>
            <Input name="imageUrl" maxLength={500} placeholder="https://…" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Placement</span>
            <select name="placement" className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm">
              <option value="dashboard_card">Dashboard card</option>
              <option value="dashboard_banner">Dashboard banner</option>
              <option value="community">Community</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Audience</span>
            <select name="audience" className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm">
              <option value="all">Everyone</option>
              <option value="free">Free users (upsell)</option>
              <option value="paid">Paid users</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Accent</span>
            <select name="accent" className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm">
              <option value="violet">Violet</option>
              <option value="blue">Blue</option>
              <option value="magenta">Magenta</option>
              <option value="coral">Coral</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Starts (optional)</span>
              <Input name="startsAt" type="datetime-local" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Ends (optional)</span>
              <Input name="endsAt" type="datetime-local" />
            </label>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Publish announcement
            </Button>
          </div>
        </form>
      ) : null}

      {announcements.length ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Placement</th>
                <th className="px-4 py-2 font-medium">Audience</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {announcements.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{a.title}</div>
                    {a.body ? <div className="max-w-xs truncate text-xs text-muted-foreground">{a.body}</div> : null}
                  </td>
                  <td className="px-4 py-2 text-xs">{PLACEMENT_LABEL[a.placement]}</td>
                  <td className="px-4 py-2 text-xs">{AUDIENCE_LABEL[a.audience]}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.active ? "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {a.active ? "Live" : "Paused"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={a.active ? "Pause" : "Activate"}
                        disabled={pending}
                        onClick={() => act(() => toggleAnnouncement(a.id, !a.active), a.active ? "Paused" : "Live")}
                      >
                        {a.active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`Delete "${a.title}"?`))
                            act(() => deleteAnnouncement(a.id), "Deleted");
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No announcements yet.</p>
      )}
    </div>
  );
}
