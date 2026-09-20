// Save renders into a user-chosen folder via the File System Access API. Browsers block
// writing to a typed absolute path for security, so the user PICKS a folder once; the handle
// is remembered (IndexedDB) and future downloads write straight into it. Falls back to a
// normal browser download when the API is unavailable or no folder is set.

const DB_NAME = "clipwaltz";
const STORE = "kv";
const KEY = "downloadDir";

type DirHandle = FileSystemDirectoryHandle;

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => res(req.result as T | undefined);
    req.onerror = () => rej(req.error);
  });
}
async function idbSet(key: string, val: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
async function idbDel(key: string): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

export function supportsFolderPicker(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function getStoredFolder(): Promise<{ handle: DirHandle; name: string } | null> {
  try {
    const handle = await idbGet<DirHandle>(KEY);
    if (!handle) return null;
    return { handle, name: handle.name };
  } catch {
    return null;
  }
}

export async function chooseDownloadFolder(): Promise<string | null> {
  if (!supportsFolderPicker()) return null;
  const picker = (window as unknown as {
    showDirectoryPicker: (o?: { mode?: string }) => Promise<DirHandle>;
  }).showDirectoryPicker;
  const handle = await picker({ mode: "readwrite" });
  await idbSet(KEY, handle);
  return handle.name;
}

export async function clearDownloadFolder(): Promise<void> {
  try {
    await idbDel(KEY);
  } catch {
    /* ignore */
  }
}

type Permable = DirHandle & {
  queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
};
async function ensurePermission(handle: DirHandle): Promise<boolean> {
  const h = handle as Permable;
  try {
    if ((await h.queryPermission?.({ mode: "readwrite" })) === "granted") return true;
    return (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

function filenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, "").trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : null;
}

/**
 * Save the render at `url` into the chosen folder when one is set and permitted; otherwise a
 * normal browser download. Returns where it went so the caller can message the user.
 */
export async function downloadRender(url: string, fallbackName = "clipwaltz-video.mp4"): Promise<"folder" | "browser"> {
  const stored = await getStoredFolder();
  if (stored && (await ensurePermission(stored.handle))) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const name = filenameFromDisposition(res.headers.get("content-disposition")) || fallbackName;
    const dir = stored.handle as DirHandle & {
      getFileHandle: (n: string, o?: { create?: boolean }) => Promise<FileSystemFileHandle>;
    };
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    if (res.body) {
      await res.body.pipeTo(writable); // streams to disk; closes on completion
    } else {
      await writable.write(await res.blob());
      await writable.close();
    }
    return "folder";
  }
  // Fallback: let the browser handle it (default Downloads folder).
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return "browser";
}
