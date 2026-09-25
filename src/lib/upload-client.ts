// Client-side upload helper shared by the import screen and the timeline insert.
// Small files go via a single POST; large files use resumable multipart (per-part retry)
// so big videos/.insv actually upload. Returns the created asset's info.

export type UploadedAsset = {
  id: string;
  kind: string;
  sourceFormat: string | null;
  conversionState: string;
};

const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;
const PART_RETRIES = 3;

function is360(name: string) {
  return /\.(insv|lrv|insp)$/i.test(name);
}
function contentType(file: File) {
  // 360 files often report no/odd MIME; the server keys off the extension either way.
  return file.type || "application/octet-stream";
}
export function isSupported(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/") || is360(file.name);
}
function sourceFormatOf(name: string): string | null {
  const m = name.toLowerCase().match(/\.(insv|lrv|insp)$/);
  return m ? m[1] : null;
}

function simplePost(projectId: string, file: File, onProgress?: (pct: number) => void): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ name: file.name, type: contentType(file) });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/assets?${q.toString()}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const j = JSON.parse(xhr.responseText) as UploadedAsset;
          resolve({ id: j.id, kind: j.kind, sourceFormat: j.sourceFormat ?? null, conversionState: j.conversionState ?? "ready" });
        } catch {
          reject(new Error("bad response"));
        }
      } else {
        reject(new Error(`upload http ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(file);
  });
}

// Storage edge (ADR-0003): PUT a part straight to MinIO via a presigned media.clipwaltz.com URL and
// return its ETag. Rejects on ANY problem so callers fall back to the proxied /part upload; after
// the server says the edge is off, stop asking for this page load.
let directOff = false;
export function putPartDirect(
  projectId: string,
  assetId: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  onProgress: (loaded: number) => void,
  timeoutMs = 10 * 60 * 1000,
): Promise<string> {
  if (directOff) return Promise.reject(new Error("direct upload off"));
  const q = new URLSearchParams({ uploadId, partNumber: String(partNumber) });
  return fetch(`/api/projects/${projectId}/assets/${assetId}/part?${q.toString()}`)
    .then(async (res) => {
      if (res.status === 404 && (await res.clone().json().catch(() => ({}))).direct === false) directOff = true;
      if (!res.ok) throw new Error(`presign ${res.status}`);
      return ((await res.json()) as { url: string }).url;
    })
    .then(
      (url) =>
        new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", url);
          xhr.timeout = timeoutMs;
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(e.loaded);
          };
          xhr.onload = () => {
            const etag = xhr.getResponseHeader("ETag");
            if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
            else reject(new Error(`direct part ${partNumber}: HTTP ${xhr.status}${etag ? "" : " (no ETag)"}`));
          };
          xhr.onerror = () => reject(new Error(`direct part ${partNumber}: network error`));
          xhr.ontimeout = () => reject(new Error(`direct part ${partNumber}: timed out`));
          xhr.send(chunk);
        }),
    );
}

function putPart(
  projectId: string,
  assetId: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  onProgress: (loaded: number) => void,
): Promise<string> {
  return putPartDirect(projectId, assetId, uploadId, partNumber, chunk, onProgress).catch((err) => {
    if (!directOff) console.warn(`[upload] direct part ${partNumber} failed, using proxy:`, (err as Error).message);
    return putPartProxied(projectId, assetId, uploadId, partNumber, chunk, onProgress);
  });
}

function putPartProxied(
  projectId: string,
  assetId: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  onProgress: (loaded: number) => void,
): Promise<string> {
  const attempt = (tryNo: number): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const q = new URLSearchParams({ uploadId, partNumber: String(partNumber) });
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/projects/${projectId}/assets/${assetId}/part?${q.toString()}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve((JSON.parse(xhr.responseText) as { etag: string }).etag);
          } catch {
            reject(new Error("bad part response"));
          }
        } else reject(new Error(`part ${partNumber} http ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error(`part ${partNumber} network error`));
      xhr.send(chunk);
    }).catch((err) => {
      if (tryNo < PART_RETRIES) return new Promise<string>((r) => setTimeout(r, 800 * tryNo)).then(() => attempt(tryNo + 1));
      throw err;
    });
  return attempt(1);
}

async function multipart(projectId: string, file: File, onProgress?: (pct: number) => void): Promise<UploadedAsset> {
  const res = await fetch(`/api/projects/${projectId}/assets/multipart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "init", name: file.name, type: contentType(file) }),
  });
  if (!res.ok) throw new Error("init failed");
  const { assetId, uploadId, kind } = (await res.json()) as { assetId: string; uploadId: string; kind: string };

  const totalParts = Math.ceil(file.size / PART_SIZE);
  const parts: { PartNumber: number; ETag: string }[] = [];
  let baseLoaded = 0;
  for (let p = 1; p <= totalParts; p++) {
    const start = (p - 1) * PART_SIZE;
    const end = Math.min(start + PART_SIZE, file.size);
    const etag = await putPart(projectId, assetId, uploadId, p, file.slice(start, end), (loaded) => {
      onProgress?.(Math.min(99, Math.round(((baseLoaded + loaded) / file.size) * 100)));
    });
    parts.push({ PartNumber: p, ETag: etag });
    baseLoaded += end - start;
  }

  const cres = await fetch(`/api/projects/${projectId}/assets/multipart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", assetId, uploadId, parts }),
  });
  if (!cres.ok) throw new Error("complete failed");
  onProgress?.(100);
  const sf = sourceFormatOf(file.name);
  return { id: assetId, kind, sourceFormat: sf, conversionState: sf ? "pending" : "ready" };
}

/** Upload a file to a project; small → POST, large → resumable multipart. */
export function uploadProjectFile(projectId: string, file: File, onProgress?: (pct: number) => void): Promise<UploadedAsset> {
  return file.size > MULTIPART_THRESHOLD ? multipart(projectId, file, onProgress) : simplePost(projectId, file, onProgress);
}
