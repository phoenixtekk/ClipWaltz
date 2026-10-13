import { redirect } from "next/navigation";
import Link from "next/link";
import { Monitor } from "lucide-react";
import { getAuthUserId } from "@/lib/auth";
import { ApproveCode } from "@/components/computer-settings";

export const metadata = { title: "Connect a computer" };

// The link the ClipWaltz Connector prints while pairing. The code is typed by the user from their own screen (never
// taken from the link), then the page shows which computer is asking before it can be approved.
export default async function ConnectComputerPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/sign-in?redirect=%2Faccount%2Fai%2Fconnect");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="cw-gradient-text flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Monitor className="size-6 text-primary" /> Connect a computer
        </h1>
        <p className="text-sm text-muted-foreground">
          Type the code the ClipWaltz Connector shows on <span className="font-medium text-foreground">your</span> computer.
          Once approved, ClipWaltz can send writing jobs to the Ollama models on that computer.
        </p>
      </div>
      <div className="cw-glass space-y-3 rounded-2xl p-4">
        <ApproveCode />
      </div>
      <Link href="/account/ai" className="text-sm text-muted-foreground hover:text-foreground">← AI models</Link>
    </div>
  );
}
