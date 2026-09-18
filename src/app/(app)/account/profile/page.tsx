import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import { ProfileForm } from "@/components/profile-form";

export const metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in");
  const profile = await getMyProfile(userId);
  if (!profile) redirect("/sign-in");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          This is shown on your public creations and your creator page.
        </p>
      </div>
      <ProfileForm initial={profile} userId={userId} />
    </div>
  );
}
