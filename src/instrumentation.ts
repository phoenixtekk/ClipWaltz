// Server instrumentation. Proxied media routes stream objects from MinIO; when a client
// aborts (video range requests, navigating away) the stream controller can throw
// "Controller is already closed" (ERR_INVALID_STATE) as an *uncaught* exception, which was
// crash-looping the server. Swallow those transient client-abort errors; let real ones crash.
export function register() {
  const isClientAbort = (e: unknown): boolean => {
    const err = e as { code?: string; name?: string; message?: string } | null;
    const code = err?.code ?? "";
    const msg = err?.message ?? "";
    const name = err?.name ?? "";
    return (
      code === "ERR_INVALID_STATE" ||
      code === "ERR_STREAM_PREMATURE_CLOSE" ||
      code === "ECONNRESET" ||
      code === "ABORT_ERR" ||
      name === "AbortError" ||
      /Controller is already closed|already closed|aborted|premature close/i.test(msg)
    );
  };

  process.on("uncaughtException", (e) => {
    if (isClientAbort(e)) {
      console.warn("[stream] ignored client-abort:", (e as Error).message);
      return;
    }
    console.error("uncaughtException:", e);
    process.exit(1); // preserve crash-on-real-error (pm2 restarts)
  });

  process.on("unhandledRejection", (e) => {
    if (isClientAbort(e)) {
      console.warn("[stream] ignored rejection:", (e as { message?: string })?.message);
      return;
    }
    console.error("unhandledRejection:", e);
  });

  console.log("[instrumentation] stream-abort guard installed");
}
