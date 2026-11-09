import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  async redirects() {
    return [
      // the free background remover was retired (2026-11-08); the token maker does the same job for
      // tokens, so old links and search results land there instead of a 404 (audit A9)
      { source: "/tools/background-remover", destination: "/tools/token-maker", permanent: true },
    ];
  },
};

export default nextConfig;
