import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { NotificationSettings, NotificationsHeader } from "@/components/notification-settings";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in");

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <NotificationsHeader />
        <p className="text-sm text-muted-foreground">
          Choose how ClipWaltz lets you know when a video finishes rendering. Settings apply to
          this browser on this device.
        </p>
      </div>
      <NotificationSettings vapidPublicKey={vapidPublicKey} />
    </div>
  );
}
