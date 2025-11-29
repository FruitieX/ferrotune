import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: {
    compilationMode: "all",
  },
  // Use a different build directory for tests to avoid conflicts with dev
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Disable dev indicators (overlay) during Playwright tests
  devIndicators: process.env.PLAYWRIGHT_TEST === "1" ? false : undefined,
};

export default nextConfig;
