import { getObjectStream } from "@/lib/storage";
import { appUrl } from "@/lib/social/app-url";

// Serving podcast assets (ported from Social Publishing; bytes now come from MinIO instead of local disk).
//
// Apple: "Display your show artwork and allow streaming playback of your episodes by enabling your hosting server for
// HTTP HEAD requests and byte-range requests." Podcast clients HEAD to check size and freshness before downloading, and
// range-request to seek and to resume. The size is the one stored on the `social_media` row (the same number the feed
// puts in `<enclosure length>`), so HEAD never touches MinIO and the feed and the file can never disagree.
//
// Deliberately NOT the app's `serveObject`: that one may 302 to a presigned media.clipwaltz.com URL, and a redirected
// enclosure would make the IAB download counting (which needs the bytes actually sent) impossible.

/** Absolute site origin (the canonical www. host). Feed URLs must be absolute. */
export function siteOrigin(): string {
  return appUrl();
}

interface ServeOpts {
  mime: string;
  /** Seconds. Artwork and audio never change once published, so this is long. */
  maxAge?: number;
  /** Feeds the `Last-Modified` header that Apple asks artwork hosts to answer. */
  lastModified?: Date;
  signal?: AbortSignal;
}

export interface Served {
  response: Response;
  /** Bytes this response will send (0 for HEAD / 416) — what the analytics count. */
  sending: number;
}

/**
 * Serve a stored object with HEAD and `Range` support. A HEAD gets the real headers and no body; `Range: bytes=a-b`
 * gets a 206 with `Content-Range`; an unsatisfiable one a 416 with the size. Anything else is a 200 that still
 * advertises `Accept-Ranges`.
 */
export async function serveStored(
  method: string,
  rangeHeader: string | null,
  storageKey: string,
  size: number,
  opts: ServeOpts,
): Promise<Served> {
  const headers: Record<string, string> = {
    "Content-Type": opts.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": `public, max-age=${opts.maxAge ?? 86_400}`,
  };
  if (opts.lastModified) headers["Last-Modified"] = opts.lastModified.toUTCString();

  if (method === "HEAD") {
    return { response: new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(size) } }), sending: 0 };
  }

  const range = parseRange(rangeHeader, size);
  if (range === "unsatisfiable") {
    return { response: new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } }), sending: 0 };
  }

  let body: ReadableStream<Uint8Array>;
  try {
    body = await getObjectStream(storageKey, range, opts.signal);
  } catch {
    return { response: new Response("Not found", { status: 404 }), sending: 0 };
  }

  if (range) {
    const length = range.end - range.start + 1;
    return {
      response: new Response(body as unknown as BodyInit, {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(length) },
      }),
      sending: length,
    };
  }
  return {
    response: new Response(body as unknown as BodyInit, { status: 200, headers: { ...headers, "Content-Length": String(size) } }),
    sending: size,
  };
}

/**
 * Parse a single-range `Range` header. A multi-range request falls back to the full body (legal, and no podcast client
 * asks for multipart). Suffix ranges (`bytes=-500`) are supported because resumption logic uses them.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    const wanted = parseInt(rawEnd, 10);
    if (!Number.isFinite(wanted) || wanted <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }

  const start = parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(parseInt(rawEnd, 10), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}
