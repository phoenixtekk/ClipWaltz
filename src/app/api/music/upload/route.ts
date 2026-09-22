import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthUserId } from "@/lib/auth";
import { putObject } from "@/lib/storage";
import { db, schema } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per upload (covers WAV/FLAC, not just compressed)

// Accepted audio formats → (canonical stored extension, MIME for MinIO/serving). The render worker
// (ffmpeg) decodes any of these; the extension/MIME just help in-browser audition. `.mpa`/`.mp2`
// are MPEG audio and are stored/served as audio/mpeg.
const AUDIO: Record<string, { ext: string; mime: string }> = {
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  mpa: { ext: "mpa", mime: "audio/mpeg" },
  mp2: { ext: "mp2", mime: "audio/mpeg" },
  m4a: { ext: "m4a", mime: "audio/mp4" },
  aac: { ext: "aac", mime: "audio/aac" },
  wav: { ext: "wav", mime: "audio/wav" },
  ogg: { ext: "ogg", mime: "audio/ogg" },
  oga: { ext: "oga", mime: "audio/ogg" },
  opus: { ext: "opus", mime: "audio/ogg" },
  flac: { ext: "flac", mime: "audio/flac" },
};

// Upload a personal music file into the user's library (owner-scoped music_tracks row). Proxied
// straight to MinIO so storage stays off the public internet; then selectable in Music → Upload.
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

  const extIn = (file.name.split(".").pop() ?? "").toLowerCase();
  const fmt = AUDIO[extIn] ?? (file.type.startsWith("audio/") ? { ext: extIn || "mp3", mime: file.type } : null);
  if (!fmt) {
    return new NextResponse("Unsupported file. Use MP3, MPA, M4A, AAC, WAV, OGG, OPUS or FLAC.", { status: 415 });
  }
  if (file.size > MAX_BYTES) return new NextResponse("File is too large (max 50 MB).", { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = randomUUID();
  const key = `music/user/${userId}/${id}.${fmt.ext}`;
  try {
    await putObject(key, bytes, fmt.mime);
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
