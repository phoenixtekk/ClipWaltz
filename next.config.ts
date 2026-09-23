import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The proxy (src/proxy.ts) buffers request bodies in memory; the default cap is 10MB, which
    // truncated music uploads (/api/music/upload allows up to 50MB → single POST). Raise it to
    // cover that. Project video uploads use chunked multipart, so their per-request bodies stay small.
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
