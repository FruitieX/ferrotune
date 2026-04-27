/**
 * Global setup for Playwright E2E tests.
 *
 * This script:
 * 1. Checks that test fixtures exist
 * 2. Verifies that the Vite app has been built
 * 3. Kills any stale process on port 13000
 * 4. Starts the Vite preview server (shared by all workers)
 *
 * Each test worker spawns its own Ferrotune server via fixtures.ts
 */

import { spawn, execSync, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Store Vite preview server info globally so teardown can access it
declare global {
  var __VITE_PREVIEW_SERVER__:
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

/** Check if Vite build exists */
function buildExists(clientDir: string): boolean {
  const indexHtml = path.join(clientDir, "out/index.html");
  return fs.existsSync(indexHtml);
}

/** Kill any process using the specified port */
function killProcessOnPort(port: number): void {
  try {
    // Try to find and kill any process using the port (Linux/macOS)
    // Using fuser which is commonly available
    try {
      execSync(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: "ignore" });
      console.log(`   Killed stale process on port ${port}`);
    } catch {
      // fuser not available or no process found, try lsof + kill
      try {
        const pid = execSync(`lsof -t -i:${port} 2>/dev/null`)
          .toString()
          .trim();
        if (pid) {
          execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore" });
          console.log(`   Killed stale process (PID ${pid}) on port ${port}`);
        }
      } catch {
        // No process found or lsof not available - port is likely free
      }
    }
  } catch {
    // Ignore errors - port is probably free
  }
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
  const vitePort = 13000;

  // Verify Vite build exists (moon should have built it via task dependencies)
  if (!buildExists(clientDir)) {
    throw new Error(
      "Vite build not found. Run 'moon run client:build' first, or use 'moon run client:test-e2e' which handles this automatically.",
    );
  }
  console.log("✅ Using existing Vite build\n");

  // Kill any stale process on the Vite preview port before starting
  console.log(`Checking for stale processes on port ${vitePort}...`);
  killProcessOnPort(vitePort);

  // Small delay to ensure port is released
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Start Vite preview server
  console.log(`Starting Vite preview server on port ${vitePort}...`);

  const viteProcess = spawn("pnpm", ["exec", "vite", "preview"], {
    cwd: clientDir,
    env: {
      ...process.env,
      PORT: vitePort.toString(),
    },
    stdio: "pipe",
    detached: false,
  });

  let viteOutput = "";
  let viteError = "";

  viteProcess.stdout?.on("data", (data) => {
    viteOutput += data.toString();
    if (process.env.DEBUG) {
      console.log(`[vite] ${data}`);
    }
  });

  viteProcess.stderr?.on("data", (data) => {
    viteError += data.toString();
    if (process.env.DEBUG) {
      console.error(`[vite] ${data}`);
    }
  });

  viteProcess.on("error", (err) => {
    console.error("Failed to start Vite preview server:", err);
  });

  viteProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Vite preview server exited with code ${code}`);
      console.error("Vite output:", viteOutput);
      console.error("Vite errors:", viteError);
    }
  });

  // Wait for Vite preview to be ready
  const viteUrl = `http://localhost:${vitePort}`;
  const viteReady = await waitForServer(viteUrl, 30000);

  if (!viteReady) {
    console.error("Vite preview server failed to start. Output:", viteOutput);
    console.error("Vite errors:", viteError);
    viteProcess.kill();
    throw new Error("Vite preview server failed to start within timeout");
  }

  console.log(`✅ Vite preview server ready at http://localhost:${vitePort}`);

  // Store Vite preview server info for teardown
  global.__VITE_PREVIEW_SERVER__ = {
    process: viteProcess,
    port: vitePort,
  };

  console.log("\n📊 Test data (per worker):");
  console.log("   - 3 artists (Test Artist, Another Artist, Various Artists)");
  console.log("   - 3 albums");
  console.log("   - 7 tracks (5 MP3, 2 FLAC)");
  console.log("");
  console.log("🚀 Each test worker will spawn its own Ferrotune server\n");
}
