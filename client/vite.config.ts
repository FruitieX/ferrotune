import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    alias: {
      "@": srcDir,
      "next/image": fileURLToPath(
        new URL("./src/lib/next-compat/image.tsx", import.meta.url),
      ),
      "next/link": fileURLToPath(
        new URL("./src/lib/next-compat/link.tsx", import.meta.url),
      ),
      "next/navigation": fileURLToPath(
        new URL("./src/lib/next-compat/navigation.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/ferrotune": "http://localhost:4040",
      "/rest": "http://localhost:4040",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 13000,
    strictPort: true,
  },
  build: {
    outDir: "out",
    emptyOutDir: true,
    target: "es2022",
  },
});
