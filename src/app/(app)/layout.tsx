import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const admin = isAdminEmail(session.user.email);

  return (
    <div className="cw-app flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="flex w-full items-center justify-between px-6 py-3">
          <Link href="/projects" className="flex items-center gap-2" aria-label="ClipWaltz home">
            <Image src="/logo-2.png" alt="" width={273} height={263} className="size-7" priority />
            <span className="cw-gradient-text text-lg font-bold tracking-tight">ClipWaltz</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/library"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Library
            </Link>
            <Link
              href="/community"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Community
            </Link>
            {admin ? (
              <Link
                href="/admin"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Admin
              </Link>
            ) : null}
            <ThemeToggle className="grid size-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground" />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="w-full flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
