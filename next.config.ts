import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This endpoint is a local-only bridge to the Python model lab and returns
  // 404 in production. Its dynamic child-process arguments make NFT assume it
  // can read any project file, so keep dev assets out of the server trace.
  outputFileTracingExcludes: {
    "/api/dev/sketchxai": [
      "./.git/**/*",
      "./docs/**/*",
      "./inspriation-ui/**/*",
      "./ml/**/*",
      "./party/**/*",
      "./public/**/*",
      "./scripts/**/*",
      "./src/**/*",
      "./test/**/*",
      "./README.md",
      "./eslint.config.mjs",
      "./next.config.ts",
      "./partykit.json",
      "./tsconfig.json",
      "./vitest.config.ts",
    ],
  },
};

export default nextConfig;
