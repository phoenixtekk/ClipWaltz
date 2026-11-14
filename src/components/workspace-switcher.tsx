"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Loader2, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createWorkspace, switchWorkspace, type WorkspaceAllowance, type WorkspaceListItem,
} from "@/lib/workspace-actions";

/**
 * G15: the top-bar workspace switcher. One workspace per client or brand; the active one decides which projects,
 * brand kit, images, channels and calendar you see. The server re-checks membership on every request.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  allowance,
}: {
  workspaces: WorkspaceListItem[];
  activeId: string;
  allowance: WorkspaceAllowance;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const canCreate = allowance.owned < allowance.limit;

  function pick(id: string) {
    if (id === activeId) return;
    start(async () => {
      const r = await switchWorkspace(id);
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await createWorkspace(name);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`“${name.trim()}” created — you're working in it now.`);
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  const label = (w: WorkspaceListItem) => (w.isPersonal ? `${w.name} (personal)` : w.name);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="max-w-[14rem] gap-1.5" aria-label="Switch workspace" />}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
          <span className="truncate">{active ? active.name : "Workspace"}</span>
          <ChevronsUpDown className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem key={w.id} onClick={() => pick(w.id)}>
                <Check className={w.id === activeId ? "size-4" : "size-4 opacity-0"} />
                <span className="min-w-0 flex-1 truncate">{label(w)}</span>
                <span className="text-[11px] capitalize text-muted-foreground">{w.role}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New workspace
            <span className="ml-auto text-[11px] text-muted-foreground">
              {allowance.owned}/{allowance.limit}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/account/workspace")}>
            <Settings2 className="size-4" /> Members &amp; approvals
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={create} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New workspace</DialogTitle>
              <DialogDescription>
                One workspace per client or brand — each has its own projects, brand kit, images, social channels, calendar and
                members.
              </DialogDescription>
            </DialogHeader>
            {canCreate ? (
              <div className="space-y-1.5">
                <Label htmlFor="ws-name">Name</Label>
                <Input id="ws-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Acme Coffee" autoFocus />
                <p className="text-xs text-muted-foreground">
                  You own {allowance.owned} of {allowance.limit} workspace{allowance.limit === 1 ? "" : "s"} your plan allows.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {allowance.tier === "pro"
                  ? `You already own ${allowance.limit} workspaces, the Pro plan's limit.`
                  : "More workspaces (one per client or brand) come with the Pro plan — up to 5."}
              </p>
            )}
            <DialogFooter>
              {canCreate ? (
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Plus />} Create
                </Button>
              ) : (
                <Button type="button" onClick={() => router.push("/account/billing")}>See plans</Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
