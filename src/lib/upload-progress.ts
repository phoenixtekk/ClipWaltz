/** Upload a file as the raw request body with progress (XHR: fetch has no upload progress). Browser only. */
export function uploadWithProgress(url: string, body: Blob, onProgress: (f: number) => void): Promise<{ seconds: number }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("content-type", body.type || "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(x.responseText || `Upload failed (${x.status})`)));
    x.onerror = () => reject(new Error("Upload failed — check your connection"));
    x.send(body);
  });
}

const PART = 8 * 2 ** 20;
const ONE_SHOT_MAX = 64 * 2 ** 20; // Cloudflare refuses request bodies over 100 MB; bigger files go up in parts

/** One part (PUT) with progress; a few retries for tunnel / network hiccups on long uploads. */
async function putPart(url: string, body: Blob, onProgress: (loaded: number) => void): Promise<string> {
  for (let tryNo = 1; ; tryNo++) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("PUT", url);
        x.timeout = 120_000;
        x.upload.onprogress = (e) => onProgress(e.loaded);
        x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(JSON.parse(x.responseText).etag) : reject(Object.assign(new Error(x.responseText || `Upload failed (${x.status})`), { status: x.status })));
        x.onerror = x.ontimeout = () => reject(new Error("Upload failed — check your connection"));
        x.send(body);
      });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      if (tryNo >= 4 || (status >= 400 && status < 500)) throw e;
      onProgress(0);
      await new Promise((r) => setTimeout(r, 1000 * tryNo));
    }
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()) || `Upload failed (${r.status})`);
  return r.json() as Promise<T>;
}

/** Presenter footage: one request when small, else in parts (`<url>/upload`) so any size up to the limit gets through. */
export async function uploadFootage(url: string, body: Blob, onProgress: (f: number) => void): Promise<{ seconds: number }> {
  if (body.size <= ONE_SHOT_MAX) return uploadWithProgress(url, body, onProgress);
  const { token, uploadId } = await postJson<{ token: string; uploadId: string }>(`${url}/upload`, { action: "init" });
  try {
    const parts: { PartNumber: number; ETag: string }[] = [];
    for (let n = 1, at = 0; at < body.size; n++, at += PART) {
      const q = new URLSearchParams({ token, uploadId, partNumber: String(n) });
      const etag = await putPart(`${url}/upload?${q}`, body.slice(at, at + PART), (loaded) => onProgress(Math.min(0.99, (at + loaded) / body.size)));
      parts.push({ PartNumber: n, ETag: etag });
    }
    return await postJson<{ seconds: number }>(`${url}/upload`, { action: "complete", token, uploadId, parts });
  } catch (e) {
    void postJson(`${url}/upload`, { action: "abort", token, uploadId }).catch(() => {});
    throw e;
  }
}
