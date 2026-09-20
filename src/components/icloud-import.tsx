"use client";
import { useState } from "react";
import { Cloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * iCloud Photos "connector". Apple offers NO third-party API to read a user's iCloud Photo
 * Library (Sign in with Apple is auth-only; CloudKit exposes only your own app's data), so
 * this is honest guidance to the paths that DO work — the OS file picker on Apple devices
 * already reaches iCloud Photos, and iCloud for Windows syncs to a local folder.
 */
export function ICloudImport() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Cloud className="size-4" /> iCloud Photos
      </Button>
      {open ? (
        <div className="w-full rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-foreground">Importing from iCloud Photos</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mb-2">
            Apple doesn&rsquo;t provide a way for websites to connect to iCloud Photos directly. Use the
            picker below instead — it already reaches your iCloud library:
          </p>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <b className="text-foreground">iPhone / iPad / Mac:</b> tap <b>&ldquo;Choose files / folder&rdquo;</b>{" "}
              below — the Apple picker includes your iCloud Photos.
            </li>
            <li>
              <b className="text-foreground">Windows:</b> install <b>iCloud for Windows</b>, turn on iCloud
              Photos, then pick from the synced <code>iCloud Photos</code> folder with &ldquo;Choose files / folder&rdquo;.
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );
}
