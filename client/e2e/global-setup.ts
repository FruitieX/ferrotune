/**
 * Global setup for Playwright E2E tests.
 *
 * This script:
 * 1. Checks that test fixtures exist
 * 2. Builds the Next.js app (if not already built)
 * 3. Starts the Next.js production server (shared by all workers)
 *
 * Each test worker spawns its own Ferrotune server via fixtures.ts
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Store Next.js server info globally so teardown can access it
declare global {
  var __NEXTJS_SERVER__:
    | {
        process: ChildProcess;
        port: number;
      }
    | undefined;
}

/** Wait for server to be ready */
async function waitForServer(
  url: string,
  timeout: number = 60000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Check if test fixtures exist */
function fixturesExist(): boolean {
  const projectRoot = path.resolve(__dirname, "../..");
  const fixturesDir = path.join(projectRoot, "tests/fixtures/music");
  return fs.existsSync(fixturesDir) && fs.readdirSync(fixturesDir).length > 0;
}

/** Check if ferrotune binary exists */
function binaryExists(): boolean {
  const projectRoot = path.resolve(__dirname, "../..");
  const debugBinary = path.join(projectRoot, "target/debug/ferrotune");
  const releaseBinary = path.join(projectRoot, "target/release/ferrotune");
  return fs.existsSync(debugBinary) || fs.existsSync(releaseBinary);
}

/** Check if Next.js build exists */
function buildExists(clientDir: string): boolean {
  const buildDir = path.join(clientDir, ".next");
  const buildManifest = path.join(buildDir, "BUILD_ID");
  return fs.existsSync(buildManifest);
}

export default async function globalSetup() {
  console.log("\n🔧 Setting up E2E test environment...\n");

  // Check prerequisites (unless using external server)
  if (process.env.FERROTUNE_EXTERNAL_SERVER !== "true") {
    if (!binaryExists()) {
      throw new Error(
        "Ferrotune binary not found. Run 'cargo build' in the project root first.",
      );
    }

    if (!fixturesExist()) {
      console.log("\n⚠️  Test fixtures not found!");
      console.log("Run this command to generate them:\n");
      console.log("  cd .. && ./scripts/generate-test-fixtures.sh\n");
      throw new Error(
        "Test fixtures not found. Run generate-test-fixtures.sh first.",
      );
    }

    console.log("✅ Prerequisites check passed");
    console.log("   - Ferrotune binary found");
    console.log("   - Test fixtures found");
    console.log("");
  }

  const clientDir = __dirname.replace(/\/e2e$/, "");
  const nextPort = 13000;

  // Verify Next.js build exists (moon should have built it via task dependencies)
  if (!buildExists(clientDir)) {
    throw new Error(
      "Next.js build not found. Run 'moon run client:build' first, or use 'moon run client:test-e2e' which handles this automatically.",
    );
  }
  console.log("✅ Using existing Next.js build\n");

  // Start Next.js production server (faster than dev server)
  console.log(`Starting Next.js production server on port ${nextPort}...`);

  const nextProcess = spawn("npm", ["run", "start"], {
    cwd: clientDir,
    env: {
      ...process.env,
      PORT: nextPort.toString(),
    },
    stdio: "pipe",
    detached: false,
  });

  let nextOutput = "";
  let nextError = "";

  nextProcess.stdout?.on("data", (data) => {
    nextOutput += data.toString();
    if (process.env.DEBUG) {
      console.log(`[next] ${data}`);
    }
  });

  nextProcess.stderr?.on("data", (data) => {
    nextError += data.toString();
    if (process.env.DEBUG) {
      console.error(`[next] ${data}`);
    }
  });

  nextProcess.on("error", (err) => {
    console.error("Failed to start Next.js server:", err);
  });

  nextProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Next.js server exited with code ${code}`);
      console.error("Next.js output:", nextOutput);
      console.error("Next.js errors:", nextError);
    }
  });

  // Wait for Next.js to be ready
  const nextUrl = `http://localhost:${nextPort}`;
  const nextReady = await waitForServer(nextUrl, 30000); // Production starts faster

  if (!nextReady) {
    console.error("Next.js server failed to start. Output:", nextOutput);
    console.error("Next.js errors:", nextError);
    nextProcess.kill();
    throw new Error("Next.js server failed to start within timeout");
  }

  console.log(
    `✅ Next.js production server ready at http://localhost:${nextPort}`,
  );

  // Store Next.js server info for teardown
  global.__NEXTJS_SERVER__ = {
    process: nextProcess,
    port: nextPort,
  };

  console.log("\n📊 Test data (per worker):");
  console.log("   - 3 artists (Test Artist, Another Artist, Various Artists)");
  console.log("   - 3 albums");
  console.log("   - 7 tracks (5 MP3, 2 FLAC)");
  console.log("");
  console.log("🚀 Each test worker will spawn its own Ferrotune server\n");
}
