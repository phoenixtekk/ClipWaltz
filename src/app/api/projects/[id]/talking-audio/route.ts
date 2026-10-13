import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requireUserId } from "@/lib/auth";
import { putObject } from "@/lib/storage";
import { userCanAccessProject } from "@/lib/workspace";
import { TALKING_AUDIO_MAX_BYTES, TALKING_MAX_SECONDS } from "@/lib/talking-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);

// Waltz AI → Talking photo: the user's own recording instead of a typed script. The file is normalised here (first
// 30 s, mono AAC) and stored at talking/<projectId>/<uuid>-<ms>.m4a — the measured length is part of the key, which
// only this route writes, so the server action can price the job from the key without trusting the browser.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new NextResponse("unauthenticated", { status: 401 });
  }
  if (!(await userCanAccessProject(userId, projectId, "editor"))) return new NextResponse("not found", { status: 404 });

  let file: File | null = null;
  try {
    const f = (await req.formData()).get("file");
    if (f instanceof File) file = f;
  } catch {
    /* fallthrough */
  }
  if (!file) return new NextResponse("no file", { status: 400 });
  if (file.size > TALKING_AUDIO_MAX_BYTES) return new NextResponse("That recording is too large (max 20 MB).", { status: 413 });
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/") && !/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(file.name)) {
    return new NextResponse("Use an audio file: MP3, M4A, WAV, OGG, OPUS, FLAC or WEBM.", { status: 415 });
  }

  const dir = await mkdtemp(join(tmpdir(), "cw-talk-"));
  try {
    const src = join(dir, "in"), out = join(dir, "out.m4a");
    await writeFile(src, new Uint8Array(await file.arrayBuffer()));
    try {
      await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vn", "-t", String(TALKING_MAX_SECONDS), "-ac", "1", "-ar", "24000",
        "-c:a", "aac", "-b:a", "128k", out], { timeout: 60_000 });
    } catch {
      return new NextResponse("We couldn't read that recording. Try MP3, M4A or WAV.", { status: 415 });
    }
    const duration = async (p: string) => {
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", p], { timeout: 30_000 });
      return Number(stdout.trim());
    };
    const seconds = await duration(out);
    if (!Number.isFinite(seconds) || seconds < 0.5) return new NextResponse("That recording is too short (under half a second).", { status: 422 });
    const original = await duration(src).catch(() => seconds);
    const ms = Math.round(Math.min(TALKING_MAX_SECONDS, seconds) * 1000);
    const key = `talking/${projectId}/${randomUUID()}-${ms}ms.m4a`;
    await putObject(key, new Uint8Array(await readFile(out)), "audio/mp4");
    return NextResponse.json({ key, seconds: ms / 1000, trimmed: original > TALKING_MAX_SECONDS + 0.05 });
  } catch (e) {
    console.error("[talking-audio]", (e as Error).message);
    return new NextResponse("Could not store the recording. Try again.", { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
