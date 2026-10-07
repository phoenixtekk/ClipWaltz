"use client";
import { Check } from "lucide-react";
import { cn } from "cn";
import { PROVIDER_LABEL, type CloudProviderId } from "@/lib/cloud/types";

/** Toggle chips for connected cloud storage providers ("save to these"). Empty selection = don't save. */
export function CloudTargetPicker({
  connected, value, onChange, disabled, label = "Save to",
}: {
  connected: CloudProviderId[];
  value: CloudProviderId[];
  onChange: (v: CloudProviderId[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {connected.map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p} type="button" aria-pressed={on} disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
              on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {on ? <Check className="size-3" /> : null}
            {PROVIDER_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}
