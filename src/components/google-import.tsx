"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Cloud, Loader2, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GoogleImport({
  projectId,
  connected,
  feedback,
}: {
  projectId: string;
  connected: boolean;
  feedback?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "picking" | "importing">("idle");
  const notified = useRef(false);

  useEffect(() => {
    if (notified.current || !feedback) return;
    notified.current = true;
    if (feedback === "connected") toast.success("Google Photos connected — pick your photos.");
    else if (feedback === "error") toast.error("Could not connect Google. Please try again.");
    else if (feedback === "unconfigured") toast.error("Google import isn't configured yet.");
  }, [feedback]);

  async function start() {
    setPhase("picking");
    try {
      const sres = await fetch("/api/import/google/session", { method: "POST" });
      const sj = await sres.json();
      if (!sres.ok) throw new Error(sj.error || "Could not start the Google picker");
      const win = window.open(sj.pickerUri, "_blank", "noopener,noreferrer");
      if (!win) {
        toast.message("Pop-up blocked — open the picker manually", { description: "Then come back here." });
        window.location.href = sj.pickerUri;
      }
      const sessionId: string = sj.sessionId;
      const deadline = Date.now() + 5 * 60 * 1000;
      let ready = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const pres = await fetch(`/api/import/google/poll?sessionId=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        if (pres.ok && (await pres.json()).ready) {
          ready = true;
          break;
        }
      }
      if (!ready) {
        toast.error("Timed out waiting for your selection.");
        return;
      }
      setPhase("importing");
      const ires = await fetch("/api/import/google/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, sessionId }),
      });
      const ij = await ires.json();
      if (!ires.ok) throw new Error(ij.error || "Import failed");
      toast.success(`Imported ${ij.imported} item${ij.imported === 1 ? "" : "s"} from Google Photos.`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Google import failed.");
    } finally {
      setPhase("idle");
    }
  }

  if (!connected) {
    return (
      <Button variant="outline" render={<a href={`/api/oauth/google/start?projectId=${projectId}`} />}>
        <Cloud className="size-4" /> Connect Google Photos
      </Button>
    );
  }
  return (
    <Button variant="outline" onClick={start} disabled={phase !== "idle"}>
      {phase === "idle" ? (
        <>
          <ImagePlus className="size-4" /> Import from Google Photos
        </>
      ) : (
        <>
          <Loader2 className="size-4 animate-spin" />
          {phase === "picking" ? "Waiting for your picks…" : "Importing…"}
        </>
      )}
    </Button>
  );
}
