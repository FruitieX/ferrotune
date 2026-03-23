import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: {
    compilationMode: "infer",
  },
  // Allow large file uploads (10GB) for tagger audio replacement
  experimental: {
    proxyClientMaxBodySize: "10gb",
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
  // Allow dev server to be accessed from Tailscale and local network
  allowedDevOrigins: [
    "*.tailscale",
    "*.local",
    "*.lan",
    "10.0.2.2",
    "192.168.*.*",
  ],
  // Required for SSE
  compress: false,
  // Proxy API requests to backend in development
  async rewrites() {
    // Only proxy in development mode
    if (process.env.NODE_ENV !== "development") {
      return [];
    }
    return [
      {
        source: "/ferrotune/:path*",
        destination: "http://localhost:4040/ferrotune/:path*",
      },
      {
        source: "/rest/:path*",
        destination: "http://localhost:4040/rest/:path*",
      },
    ];
  },
};

export default nextConfig;
