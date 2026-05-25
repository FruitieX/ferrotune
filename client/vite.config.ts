import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const rootDir = fileURLToPath(new URL("..", import.meta.url));

type PackageJson = {
  version?: unknown;
};

function getPackageVersion() {
  const packageJson = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as PackageJson;

  return typeof packageJson.version === "string"
    ? packageJson.version
    : "unknown";
}

function getBuildDate() {
  const explicitBuildDate =
    process.env.VITE_BUILD_DATE ?? process.env.BUILD_DATE;
  if (explicitBuildDate) {
    return explicitBuildDate;
  }

  return new Date().toISOString();
}

function getGitCommit() {
  const explicitCommit =
    process.env.VITE_GIT_COMMIT ??
    process.env.GIT_COMMIT ??
    process.env.GITHUB_SHA;
  if (explicitCommit) {
    return explicitCommit.slice(0, 12);
  }

  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const buildInfo = {
  version: process.env.VITE_APP_VERSION ?? getPackageVersion(),
  buildDate: getBuildDate(),
  gitCommit: getGitCommit(),
};

export default defineConfig(({ command }) => {
  const plugins =
    command === "build"
      ? [react(), babel({ presets: [reactCompilerPreset()] })]
      : [react()];

  return {
    plugins,
    define: {
      __FERROTUNE_BUILD_INFO__: JSON.stringify(buildInfo),
    },
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
        "/api": "http://localhost:4040",
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
  };
});
