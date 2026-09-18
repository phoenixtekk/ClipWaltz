"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, AtSign, Video, Music2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MyProfile } from "@/lib/profile";
import { updateProfile } from "@/lib/profile-actions";

export function ProfileForm({ initial, userId }: { initial: MyProfile; userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    name: initial.name ?? "",
    bio: initial.bio ?? "",
    website: initial.website ?? "",
    instagram: initial.instagram ?? "",
    tiktok: initial.tiktok ?? "",
    youtube: initial.youtube ?? "",
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  function save() {
    start(async () => {
      try {
        await updateProfile(f);
        toast.success("Profile saved.");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message || "Could not save your profile.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="pf-name" className="text-xs font-medium text-muted-foreground">Display name</label>
        <Input id="pf-name" value={f.name} maxLength={80} onChange={set("name")} placeholder="Your name" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="pf-bio" className="text-xs font-medium text-muted-foreground">Bio</label>
        <textarea
          id="pf-bio"
          value={f.bio}
          maxLength={400}
          onChange={set("bio")}
          rows={3}
          placeholder="A line about you and the videos you make."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <p className="text-right text-[11px] text-muted-foreground">{f.bio.length}/400</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <LinkField icon={<Globe className="size-4" />} id="pf-web" label="Website" value={f.website} onChange={set("website")} placeholder="yoursite.com" />
        <LinkField icon={<AtSign className="size-4" />} id="pf-ig" label="Instagram" value={f.instagram} onChange={set("instagram")} placeholder="@handle" />
        <LinkField icon={<Music2 className="size-4" />} id="pf-tt" label="TikTok" value={f.tiktok} onChange={set("tiktok")} placeholder="@handle" />
        <LinkField icon={<Video className="size-4" />} id="pf-yt" label="YouTube" value={f.youtube} onChange={set("youtube")} placeholder="@handle" />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
        <Button variant="ghost" render={<a href={`/u/${userId}`} target="_blank" rel="noreferrer" />}>
          View public profile ↗
        </Button>
      </div>
    </div>
  );
}

function LinkField({
  icon,
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  icon: React.ReactNode;
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {label}
      </label>
      <Input id={id} value={value} maxLength={120} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}
