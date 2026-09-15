import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <div className="max-w-2xl space-y-4">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          ClipWaltz
        </p>
        <h1 className="text-balance text-4xl font-semibold sm:text-5xl">
          Turn the photos and videos on your phone into a polished, music-driven
          highlight video in under a minute.
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">
          Drop in your memories. ClipWaltz auto-edits them in the cloud — beat-synced
          cuts, licensed music, ready to post. No editing required.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button render={<Link href="/sign-up" />} size="lg">
          Start free →
        </Button>
        <Button render={<Link href="/sign-in" />} size="lg" variant="outline">
          Log in
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        MVP scaffold · desktop web · www.clipwaltz.com
      </p>
    </main>
  );
}
