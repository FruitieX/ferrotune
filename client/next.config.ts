import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: {
    compilationMode: "infer",
  },
  // Use different build directories:
  // - NEXT_DIST_DIR env var takes priority (for tests)
  // - .next-dev for development (npm run dev)
  // - .next for production builds
  distDir:
    process.env.NEXT_DIST_DIR ||
    (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  // Disable dev indicators (overlay) during Playwright tests
  devIndicators:
    process.env.NEXT_DISABLE_DEV_OVERLAY === "true" ? false : undefined,
  // Enable static export for embedding into release binaries
  output: process.env.NEXT_OUTPUT_STATIC === "1" ? "export" : undefined,
};

export default nextConfig;
