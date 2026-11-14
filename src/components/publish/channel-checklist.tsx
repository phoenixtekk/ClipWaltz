"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { DestinationView } from "@/lib/social/ui-types";

/** A checklist of the workspace's usable destinations (connected, not paused). */
export function ChannelChecklist({
  destinations,
  value,
  onChange,
  exclude = [],
}: {
  destinations: DestinationView[];
  value: string[];
  onChange: (keys: string[]) => void;
  /** Providers to leave out (a Short has no audio, so no podcast). */
  exclude?: string[];
}) {
  const usable = destinations.filter((d) => d.configured && !d.paused && !exclude.includes(d.provider));
  if (!usable.length) return <p className="text-sm text-muted-foreground">Connect a channel under Networks first.</p>;
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {usable.map((d) => (
        <Label key={d.key} className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={value.includes(d.key)}
            onCheckedChange={(on) => onChange(on ? [...value, d.key] : value.filter((k) => k !== d.key))}
          />
          <span className="truncate">{d.label}</span>
        </Label>
      ))}
    </div>
  );
}
