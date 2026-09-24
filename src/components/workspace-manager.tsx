"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, LogOut, Mail, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkspaceRole } from "@/lib/workspace";
import {
  changeMemberRole,
  inviteMember,
  leaveWorkspace,
  removeMember,
  renameWorkspace,
  revokeInvite,
  type ActionResult,
  type WorkspaceDetail,
  type WorkspaceListItem,
} from "@/lib/workspace-actions";

const ROLE_HELP: Record<WorkspaceRole, string> = {
  owner: "Owns the workspace",
  admin: "Edits projects, deletes projects, manages members",
  editor: "Edits, uploads, renders and generates",
  viewer: "Watches and downloads only",
};

const selectCls =
  "h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-primary disabled:opacity-60";

export function WorkspaceManager({
  workspaces,
  detail,
  userId,
}: {
  workspaces: WorkspaceListItem[];
  detail: WorkspaceDetail;
  userId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const isAdmin = detail.myRole === "owner" || detail.myRole === "admin";
  const isOwner = detail.myRole === "owner";
  // Roles the caller may assign: the owner can grant admin; admins only editor/viewer.
  const assignable: WorkspaceRole[] = isOwner ? ["admin", "editor", "viewer"] : ["editor", "viewer"];

  function act<T extends object>(fn: () => Promise<ActionResult<T>>, ok?: string, after?: (r: T) => void) {
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        if (ok) toast.success(ok);
        after?.(r);
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  function invite(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    act(() => inviteMember(detail.id, addr, role), `Invite sent to ${addr}.`, (r) => {
      setEmail("");
      setLastLink(r.url);
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  return (
    <div className="space-y-6">
      {workspaces.length > 1 ? (
        <div className="cw-glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
          <span className="text-xs font-medium text-muted-foreground">Workspace</span>
          {workspaces.map((w) => (
            <Button
              key={w.id}
              size="sm"
              variant={w.id === detail.id ? "default" : "outline"}
              onClick={() => router.push(`/account/workspace?ws=${w.id}`)}
            >
              {w.name}
              {!w.isPersonal ? <span className="ml-1 text-[11px] opacity-70">· {w.ownerName}</span> : null}
            </Button>
          ))}
        </div>
      ) : null}

      <section className="cw-glass space-y-3 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{detail.name}</h2>
            <p className="text-xs text-muted-foreground">
              Your role: <b className="capitalize">{detail.myRole}</b> — {ROLE_HELP[detail.myRole]}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {isAdmin ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  const n = window.prompt("Workspace name", detail.name);
                  if (n?.trim() && n.trim() !== detail.name) act(() => renameWorkspace(detail.id, n.trim()), "Workspace renamed.");
                }}
              >
                <Pencil className="size-4" /> Rename
              </Button>
            ) : null}
            {!isOwner ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Leave “${detail.name}”? You'll lose access to its projects.`)) {
                    act(() => leaveWorkspace(detail.id), "You left the workspace.", () => router.push("/account/workspace"));
                  }
                }}
              >
                <LogOut className="size-4" /> Leave
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {isAdmin ? (
        <section className="cw-glass space-y-3 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-medium">
            <UserPlus className="size-4" /> Invite someone
          </h3>
          <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              required
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-label="Email address to invite"
              className="sm:flex-1"
            />
            <select
              aria-label="Role for the invite"
              className={selectCls + " h-9"}
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              {assignable.map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending || !email.trim()}>
              <Mail className="size-4" /> Send invite
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}. The link expires in 7 days and works once, for that email address.</p>
          {lastLink ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 truncate text-xs">{lastLink}</code>
              <Button size="sm" variant="outline" onClick={() => copy(lastLink)}>
                <Copy className="size-4" /> Copy link
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="cw-glass space-y-3 rounded-2xl p-5">
        <h3 className="flex items-center gap-2 font-medium">
          <Users className="size-4" /> Members ({detail.members.length})
        </h3>
        <ul className="divide-y divide-border">
          {detail.members.map((m) => {
            const self = m.userId === userId;
            const canManage = !self && m.role !== "owner" && (isOwner || (isAdmin && m.role !== "admin"));
            return (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name || m.email} {self ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                {canManage ? (
                  <>
                    <select
                      aria-label={`Role for ${m.email}`}
                      className={selectCls}
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => act(() => changeMemberRole(m.id, e.target.value), "Role updated.")}
                    >
                      {(assignable.includes(m.role) ? assignable : [m.role, ...assignable]).map((r) => (
                        <option key={r} value={r}>
                          {r[0].toUpperCase() + r.slice(1)}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${m.email}`}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Remove ${m.name || m.email} from “${detail.name}”?`)) act(() => removeMember(m.id), "Member removed.");
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{m.role}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {isAdmin && detail.invites.length ? (
        <section className="cw-glass space-y-3 rounded-2xl p-5">
          <h3 className="font-medium">Pending invites ({detail.invites.length})</h3>
          <ul className="divide-y divide-border">
            {detail.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="capitalize">{i.role}</span>
                    {i.invitedBy ? ` · invited by ${i.invitedBy}` : ""} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => act(() => revokeInvite(i.id), "Invite revoked.")}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">To resend, invite the same address again — the old link stops working.</p>
        </section>
      ) : null}
    </div>
  );
}
