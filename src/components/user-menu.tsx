"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User as UserIcon, CreditCard, Bell, Users, LifeBuoy, MessageSquare } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "@/components/feedback-dialog";

export function UserMenu() {
  const router = useRouter();
  const { data } = useSession();
  const email = data?.user?.email;
  const name = data?.user?.name;
  const initial = (name || email || "?").charAt(0).toUpperCase();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Account" className="rounded-full" />
        }
      >
        <span className="grid size-7 place-items-center rounded-full bg-secondary text-sm font-medium">
          {initial}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {/* GroupLabel must live inside a Group (Base UI throws error #31 otherwise). */}
          <DropdownMenuLabel>
            <div className="flex items-center gap-2">
              <UserIcon className="size-4" />
              <span className="truncate">{name || email || "Account"}</span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/account/profile")}>
          <UserIcon className="size-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/account/workspace")}>
          <Users className="size-4" /> Workspace
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/account/billing")}>
          <CreditCard className="size-4" /> Billing
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/account/notifications")}>
          <Bell className="size-4" /> Notifications
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/help")}>
          <LifeBuoy className="size-4" /> Help Center
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
          <MessageSquare className="size-4" /> Send feedback
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:bg-destructive/10">
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}
