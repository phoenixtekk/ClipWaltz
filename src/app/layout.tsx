import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeGuard } from "@/components/theme-guard";
import { PwaRegister } from "@/components/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com"),
  title: {
    default: "ClipWaltz — auto music-video maker",
    template: "%s · ClipWaltz",
  },
  description:
    "Turn the photos and videos on your phone into a polished, music-driven highlight video in under a minute — no editing required.",
  // G16 PWA: the manifest is src/app/manifest.ts; iOS uses these for "Add to Home Screen".
  appleWebApp: { capable: true, title: "ClipWaltz", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#0f0c1d" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Set theme before paint (no flash): stored choice, else system preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('cw-theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark');}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeGuard />
        <PwaRegister />
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
