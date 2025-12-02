import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: {
    compilationMode: "all",
  },
  // Use a different build directory for tests to avoid conflicts with dev
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Disable dev indicators (overlay) during Playwright tests
  devIndicators: process.env.NEXT_DISABLE_DEV_OVERLAY === "true" ? false : undefined,
  // Enable static export for embedding into release binaries
  output: process.env.NEXT_OUTPUT_STATIC === "1" ? "export" : undefined,
};

export default nextConfig;
