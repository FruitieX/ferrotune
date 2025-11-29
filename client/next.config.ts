import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: {
    compilationMode: "all",
  },
  // Use a different build directory for tests to avoid conflicts with dev
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
