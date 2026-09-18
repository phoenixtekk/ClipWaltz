import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type SocialLinks = {
  website: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
};

export type ProfileRender = {
  renderId: string;
  title: string;
  aspect: string;
  likes: number;
};

export type PublicProfile = {
  id: string;
  name: string;
  image: string | null;
  bio: string | null;
  links: SocialLinks;
  renders: ProfileRender[];
};

const likeCount = sql<number>`(select count(*)::int from render_likes rl where rl.render_id = ${schema.renders.id})`;

/** Normalize a stored social value into a full URL for a given network. */
export function socialUrl(
  kind: "website" | "instagram" | "tiktok" | "youtube",
  value: string | null,
): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (kind) {
    case "website":
      return `https://${v}`;
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "tiktok":
      return `https://tiktok.com/@${handle}`;
    case "youtube":
      return `https://youtube.com/@${handle}`;
  }
}

/** Public creator profile + their public creations. Null if the user doesn't exist. */
export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const [u] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      bio: schema.user.bio,
      website: schema.user.website,
      instagram: schema.user.instagram,
      tiktok: schema.user.tiktok,
      youtube: schema.user.youtube,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!u) return null;

  const rows = await db
    .select({
      renderId: schema.renders.id,
      aspect: schema.renders.aspect,
      title: schema.projects.title,
      likes: likeCount,
    })
    .from(schema.renders)
    .innerJoin(schema.projects, eq(schema.renders.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.projects.ownerId, userId),
        eq(schema.renders.visibility, "public"),
        isNotNull(schema.renders.outputKey),
      ),
    )
    .orderBy(desc(schema.renders.sharedAt))
    .limit(60);

  return {
    id: u.id,
    name: u.name || "Someone",
    image: u.image,
    bio: u.bio,
    links: {
      website: u.website,
      instagram: u.instagram,
      tiktok: u.tiktok,
      youtube: u.youtube,
    },
    renders: rows.map((r) => ({
      renderId: r.renderId,
      title: r.title,
      aspect: r.aspect,
      likes: r.likes,
    })),
  };
}

export type MyProfile = {
  name: string;
  bio: string | null;
} & SocialLinks;

/** The signed-in user's editable profile fields. */
export async function getMyProfile(userId: string): Promise<MyProfile | null> {
  const [u] = await db
    .select({
      name: schema.user.name,
      bio: schema.user.bio,
      website: schema.user.website,
      instagram: schema.user.instagram,
      tiktok: schema.user.tiktok,
      youtube: schema.user.youtube,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return u ?? null;
}
