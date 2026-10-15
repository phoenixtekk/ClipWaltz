import "server-only";
import { execFile } from "child_process";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAdminSession } from "./admin";
import { putObject, listObjectKeys, purgePrefix } from "./storage";

const run = promisify(execFile);

/** Thrown with a message (and HTTP status) the browser shows as-is. */
export class UploadError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** The caller's own presenter, still being set up (draft / failed). */
export async function draftPresenter(userId: string, id: string) {
  const [p] = await db.select().from(schema.presenters).where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, userId)));
  if (!p) throw new UploadError("Presenter not found", 404);
  if (p.status !== "draft" && p.status !== "failed") throw new UploadError("This presenter is already being made", 409);
  return p;
}

/** The request body (the raw file) to a temp file, refusing anything over `max` bytes while it streams. */
async function bodyToFile(req: Request, file: string, max: number): Promise<void> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max) throw new UploadError(`That file is too large (max ${Math.round(max / 2 ** 20)} MB)`, 413);
  if (!req.body) throw new UploadError("No file", 400);
  let size = 0;
  const capped = Readable.fromWeb(req.body as import("stream/web").ReadableStream).on("data", (c: Buffer) => {
    size += c.length;
    if (size > max) capped.destroy(new UploadError(`That file is too large (max ${Math.round(max / 2 ** 20)} MB)`, 413));
  });
  await pipeline(capped, createWriteStream(file));
  if (size === 0) throw new UploadError("No file", 400);
}

async function seconds(p: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", p], { timeout: 30_000 });
  return Number(stdout.trim());
}

/** Upload (request body or URL) → H.264/AAC MP4 at 25 fps, longest side ≤ 1920, first `keepSeconds` → MinIO `key`. Returns its length. */
export async function storeNormalisedVideo(source: Request | string, key: string, opts: { max: number; keepSeconds: number; minSeconds: number; what: string }) {
  const dir = await mkdtemp(join(tmpdir(), "cw-presenter-"));
  try {
    let src = join(dir, "in");
    const out = join(dir, "out.mp4");
    // `source` is the request (the raw file as its body) or a URL ffmpeg reads (a stored upload, see footage/upload).
    if (typeof source === "string") src = source;
    else await bodyToFile(source, src, opts.max);
    try {
      await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-t", String(opts.keepSeconds),
        "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',fps=25,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-ac", "1", "-ar", "48000", "-b:a", "128k",
        "-movflags", "+faststart", out], { timeout: 10 * 60_000 });
    } catch {
      throw new UploadError(`We couldn't read that ${opts.what}. Use MP4, MOV or WEBM with sound.`, 415);
    }
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", out], { timeout: 30_000 });
    if (!stdout.trim()) throw new UploadError(`The ${opts.what} has no sound — we need to hear you speak`, 422);
    const len = await seconds(out);
    if (!(len >= opts.minSeconds)) throw new UploadError(`The ${opts.what} is too short (at least ${opts.minSeconds} seconds)`, 422);
    await putObject(key, new Uint8Array(await readFile(out)), "video/mp4");
    return { seconds: Math.round(len * 10) / 10 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** After `newKey` became the presenter's file: remove every other upload of the same kind (`<prefix>*.mp4`) — earlier
 *  ones and any from overlapping uploads. */
export async function replaceKey(prefix: string, newKey: string) {
  for (const k of await listObjectKeys(prefix).catch(() => [] as string[])) if (k !== newKey) await purgePrefix(k).catch(() => {});
}

/** The presenter whose footage the caller may set: their own twin, or — for any admin — a library presenter (AI / licensed
 *  actor). Files live under the row's owner, so every admin can manage an actor another admin created. */
export async function footagePresenter(id: string, userId: string) {
  const [p] = await db.select().from(schema.presenters).where(eq(schema.presenters.id, id));
  const library = p && (p.kind === "ai" || p.kind === "actor");
  if (!p || (library ? !(await getAdminSession()) : p.userId !== userId)) throw new UploadError("Presenter not found", 404);
  if (p.kind === "twin" && p.source !== "video") throw new UploadError("This presenter isn't made from a video", 409);
  if (p.status !== "draft" && p.status !== "failed") throw new UploadError("This presenter is already being made", 409);
  return { owner: p.userId };
}

/** Make the stored footage at `key` the presenter's — only while it's still being set up (not queued / building / ready,
 *  not deleted meanwhile); else the new file is dropped. False when it was dropped. */
export async function saveFootage(id: string, owner: string, key: string): Promise<boolean> {
  const [row] = await db.update(schema.presenters).set({ footageKey: key, status: "draft", error: null, updatedAt: new Date() })
    .where(and(eq(schema.presenters.id, id), eq(schema.presenters.userId, owner), inArray(schema.presenters.status, ["draft", "failed"])))
    .returning({ id: schema.presenters.id });
  if (!row) {
    await purgePrefix(key).catch(() => {});
    return false;
  }
  await replaceKey(`presenters/${owner}/${id}/footage-`, key);
  return true;
}
