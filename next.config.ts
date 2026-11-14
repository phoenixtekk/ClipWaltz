import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native addon (Social Publishing image fitting + Pinterest Pin reshaping, src/lib/social/publishing). Not on Next's
  // built-in external list (only `canvas` is), so keep it out of the server bundle and load it from node_modules.
  serverExternalPackages: ["@napi-rs/canvas"],
  experimental: {
    // The proxy (src/proxy.ts) buffers request bodies in memory; the default cap is 10MB, which
    // truncated music uploads (/api/music/upload allows up to 50MB → single POST). Raise it to
    // cover that. Project video uploads use chunked multipart, so their per-request bodies stay small.
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
