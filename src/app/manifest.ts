import type { MetadataRoute } from "next";

// G16 (decision D7: PWA). Served by Next at /manifest.webmanifest and linked from every page's <head>.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ClipWaltz",
    short_name: "ClipWaltz",
    description: "Make music videos, ads and social posts, and publish them — from your phone or desktop.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0f0c1d",
    theme_color: "#0f0c1d",
    categories: ["photo", "productivity", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New video", url: "/projects/new" },
      { name: "Compose a post", url: "/publish/compose" },
      { name: "Approvals", url: "/publish/review" },
    ],
  };
}
