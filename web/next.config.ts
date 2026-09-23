import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // one self-contained server bundle for the container image (no node_modules copy, no `next` CLI at runtime)
  output: "standalone",
  turbopack: { root: __dirname },
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
