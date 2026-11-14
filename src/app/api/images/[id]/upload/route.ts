import { randomUUID } from "crypto";
import { db, schema } from "@/db";
import { getAuthUserId } from "@/lib/auth";
import { loadDesign } from "@/lib/image-ad/designs";
import { putObject } from "@/lib/storage";
import { imageSize } from "../../../../../../worker/image/compose.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// POST multipart/form-data { file } — add the user's own picture to a design (editor+). Free: no AI involved. The
// picture is decoded once here so a file that isn't really an image is refused now, not at render time.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const { id } = await params;
  const d = await loadDesign(userId, id, "editor");
  if (!d) return Response.json({ error: "Design not found." }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file." }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return Response.json({ error: "Use a PNG, JPEG or WebP picture." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That picture is over 20 MB." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  let size: { width: number; height: number };
  try {
    size = await imageSize(bytes);
  } catch {
    return Response.json({ error: "That file couldn't be read as a picture." }, { status: 400 });
  }
  const imageId = randomUUID();
  const key = `images/${d.row.workspaceId}/${id}/pic/${imageId}.${ext}`;
  await putObject(key, bytes, file.type);
  await db.insert(schema.imageDesignImages).values({
    id: imageId, designId: id, workspaceId: d.row.workspaceId, source: "upload", storageKey: key, width: size.width, height: size.height,
  });
  return Response.json({ id: imageId, width: size.width, height: size.height });
}
