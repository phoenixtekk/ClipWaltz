// Browser-side upload of post media. Small files go in one POST to /api/social/media; anything over the proxy's
// request cap goes up in 8 MB parts (direct to the storage edge when it is on, else through the app, with retries).

export interface UploadedMedia {
  id: string;
  kind: "image" | "video";
  size: number;
}

const SINGLE_MAX = 40 * 1024 * 1024; // under the 55 MB proxy body cap with room for multipart overhead
const PART_SIZE = 8 * 1024 * 1024;
const RETRIES = 3;

function xhrSend(method: string, url: string, body: Blob | FormData, onProgress: (loaded: number) => void): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(body);
  });
}

function errorOf(xhr: XMLHttpRequest, fallback: string): string {
  try {
    return (JSON.parse(xhr.responseText) as { error?: string }).error || fallback;
  } catch {
    return fallback;
  }
}

async function single(file: File, onProgress: (pct: number) => void): Promise<UploadedMedia> {
  const form = new FormData();
  form.append("file", file);
  const xhr = await xhrSend("POST", "/api/social/media", form, (l) => onProgress(Math.min(99, Math.round((l / file.size) * 100))));
  if (xhr.status < 200 || xhr.status >= 300) throw new Error(errorOf(xhr, `Upload failed (${xhr.status}).`));
  const j = JSON.parse(xhr.responseText) as { id: string; kind: "image" | "video" };
  onProgress(100);
  return { id: j.id, kind: j.kind, size: file.size };
}

let directOff = false;
async function putPart(id: string, uploadId: string, n: number, chunk: Blob, onLoaded: (l: number) => void): Promise<string> {
  const q = new URLSearchParams({ uploadId, partNumber: String(n) });
  if (!directOff) {
    try {
      const res = await fetch(`/api/social/media/${id}/part?${q}`);
      if (res.status === 404) directOff = true;
      if (res.ok) {
        const { url } = (await res.json()) as { url: string };
        const xhr = await xhrSend("PUT", url, chunk, onLoaded);
        const etag = xhr.getResponseHeader("ETag");
        if (xhr.status >= 200 && xhr.status < 300 && etag) return etag;
      }
    } catch {
      /* fall through to the proxied upload */
    }
  }
  let last: Error | null = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const xhr = await xhrSend("PUT", `/api/social/media/${id}/part?${q}`, chunk, onLoaded);
      if (xhr.status >= 200 && xhr.status < 300) return (JSON.parse(xhr.responseText) as { etag: string }).etag;
      last = new Error(errorOf(xhr, `Part ${n} failed (${xhr.status}).`));
    } catch (e) {
      last = e as Error;
    }
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  throw last ?? new Error(`Part ${n} failed.`);
}

async function chunked(file: File, onProgress: (pct: number) => void): Promise<UploadedMedia> {
  const post = (body: object) =>
    fetch("/api/social/media/multipart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const init = await post({ action: "init", name: file.name, type: file.type, size: file.size });
  const ij = (await init.json().catch(() => ({}))) as { id?: string; uploadId?: string; error?: string };
  if (!init.ok || !ij.id || !ij.uploadId) throw new Error(ij.error || "Could not start the upload.");
  const { id, uploadId } = ij as { id: string; uploadId: string };
  try {
    const parts: { PartNumber: number; ETag: string }[] = [];
    const total = Math.ceil(file.size / PART_SIZE);
    let done = 0;
    for (let n = 1; n <= total; n++) {
      const start = (n - 1) * PART_SIZE;
      const chunk = file.slice(start, Math.min(start + PART_SIZE, file.size));
      const etag = await putPart(id, uploadId, n, chunk, (l) => onProgress(Math.min(99, Math.round(((done + l) / file.size) * 100))));
      parts.push({ PartNumber: n, ETag: etag });
      done += chunk.size;
    }
    const c = await post({ action: "complete", id, uploadId, parts, name: file.name, type: file.type });
    const cj = (await c.json().catch(() => ({}))) as { kind?: "image" | "video"; size?: number; error?: string };
    if (!c.ok) throw new Error(cj.error || "Could not finish the upload.");
    onProgress(100);
    return { id, kind: cj.kind ?? (file.type.startsWith("video/") ? "video" : "image"), size: cj.size ?? file.size };
  } catch (e) {
    await post({ action: "abort", id, uploadId }).catch(() => {});
    throw e;
  }
}

export function uploadPostMedia(file: File, onProgress: (pct: number) => void): Promise<UploadedMedia> {
  return file.size > SINGLE_MAX ? chunked(file, onProgress) : single(file, onProgress);
}
