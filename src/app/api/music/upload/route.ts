import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthUserId } from "@/lib/auth";
import { putObject } from "@/lib/storage";
import { db, schema } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024; // 30 MB per upload

// Upload a personal MP3 into the user's music library (owner-scoped music_tracks row). The file is
// proxied straight to MinIO so storage stays off the public internet; the row is then selectable
// in the editor's Music → Upload tab, exactly like a catalog track.
export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    /* fallthrough */
  }
  if (!file) return new NextResponse("no file", { status: 400 });

  const isMp3 = file.type === "audio/mpeg" || /\.mp3$/i.test(file.name);
  if (!isMp3) return new NextResponse("Only MP3 files are supported.", { status: 415 });
  if (file.size > MAX_BYTES) return new NextResponse("File is too large (max 30 MB).", { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = randomUUID();
  const key = `music/user/${userId}/${id}.mp3`;
  try {
    await putObject(key, bytes, "audio/mpeg");
  } catch {
    return new NextResponse("Could not store the file. Try again.", { status: 502 });
  }

  const title = (file.name.replace(/\.[^.]+$/, "").trim() || "My track").slice(0, 120);
  await db.insert(schema.musicTracks).values({
    id,
    ownerId: userId,
    title,
    storageKey: key,
    provider: "upload",
    premium: false,
    active: true,
  });

  return NextResponse.json({ id, title });
}
