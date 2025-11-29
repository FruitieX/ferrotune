/**
 * Global setup for Playwright E2E tests.
 * 
 * This script:
 * 1. Starts a fresh Ferrotune server with test fixtures
 * 2. Scans the music library
 * 3. Makes the server available for all tests
 * 
 * The server is stopped in global-teardown.ts
 */

import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Store server info globally so teardown can access it
declare global {
  var __FERROTUNE_SERVER__: {
    process: ChildProcess;
    port: number;
    adminPort: number;
    tempDir: string;
    username: string;
    password: string;
  } | undefined;
  
  var __NEXTJS_SERVER__: {
    process: ChildProcess;
    port: number;
  } | undefined;
}

/** Wait for server to be ready */
async function waitForServer(url: string, timeout: number = 30000): Promise<boolean> {
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

/** Find the ferrotune binary */
function findBinary(): string {
  const projectRoot = path.resolve(__dirname, "../..");
  
  // Try debug build first
  const debugBinary = path.join(projectRoot, "target/debug/ferrotune");
  if (fs.existsSync(debugBinary)) {
    return debugBinary;
  }
  
  // Try release build
  const releaseBinary = path.join(projectRoot, "target/release/ferrotune");
  if (fs.existsSync(releaseBinary)) {
    return releaseBinary;
  }
  
  throw new Error(
    "Ferrotune binary not found. Run 'cargo build' in the project root first."
  );
}

/** Check if test fixtures exist */
function fixturesExist(): boolean {
  const projectRoot = path.resolve(__dirname, "../..");
  const fixturesDir = path.join(projectRoot, "tests/fixtures/music");
  return fs.existsSync(fixturesDir) && fs.readdirSync(fixturesDir).length > 0;
}

/** Copy directory recursively */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export default async function globalSetup() {
  console.log("\n🔧 Setting up Ferrotune test server...\n");
  
  // Check if we should use an external server
  if (process.env.FERROTUNE_EXTERNAL_SERVER === "true") {
    console.log("Using external Ferrotune server at", process.env.FERROTUNE_TEST_URL || "http://localhost:4040");
    return;
  }
  
  // Check prerequisites
  const binary = findBinary();
  console.log(`Found ferrotune binary: ${binary}`);
  
  if (!fixturesExist()) {
    console.log("\n⚠️  Test fixtures not found!");
    console.log("Run this command to generate them:\n");
    console.log("  cd .. && ./scripts/generate-test-fixtures.sh\n");
    throw new Error("Test fixtures not found. Run generate-test-fixtures.sh first.");
  }
  
  // Use fixed test ports (different from default 4040/4041)
  const port = 14040;
  const adminPort = 14041;
  
  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ferrotune-e2e-"));
  const dbPath = path.join(tempDir, "ferrotune.db");
  const configPath = path.join(tempDir, "config.toml");
  const cacheDir = path.join(tempDir, "cache");
  const musicDir = path.join(tempDir, "music");
  
  fs.mkdirSync(cacheDir, { recursive: true });
  
  // Copy test fixtures
  const projectRoot = path.resolve(__dirname, "../..");
  const fixturesMusic = path.join(projectRoot, "tests/fixtures/music");
  console.log(`Copying test fixtures from ${fixturesMusic}`);
  copyDirSync(fixturesMusic, musicDir);
  
  // Generate config
  const username = "testadmin";
  const password = "testpass";
  
  const config = `
[server]
host = "127.0.0.1"
port = ${port}
admin_port = ${adminPort}
name = "Ferrotune E2E Test"
admin_user = "${username}"
admin_password = "${password}"

[database]
path = "${dbPath}"

[music]
readonly_tags = true

[[music.folders]]
name = "Test Music"
path = "${musicDir}"

[cache]
path = "${cacheDir}"
max_cover_size = 512
`;
  
  fs.writeFileSync(configPath, config);
  console.log(`Created config at ${configPath}`);
  
  // Scan the library first
  console.log("Scanning music library...");
  try {
    execSync(`"${binary}" --config "${configPath}" scan`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log("Library scan complete");
  } catch (error: any) {
    console.error("Failed to scan library:", error.stderr || error.message);
    throw error;
  }
  
  // Start the server
  console.log(`Starting Ferrotune test server on ports ${port}/${adminPort}...`);
  const serverProcess = spawn(binary, ["--config", configPath, "serve"], {
    stdio: "pipe",
    detached: false,
  });
  
  let serverError = "";
  let serverOutput = "";
  
  serverProcess.stdout?.on("data", (data) => {
    serverOutput += data.toString();
    if (process.env.DEBUG) {
      console.log(`[ferrotune] ${data}`);
    }
  });
  
  serverProcess.stderr?.on("data", (data) => {
    serverError += data.toString();
    if (process.env.DEBUG) {
      console.error(`[ferrotune] ${data}`);
    }
  });
  
  serverProcess.on("error", (err) => {
    console.error("Failed to start server:", err);
  });
  
  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Server exited with code ${code}`);
      console.error("Server output:", serverOutput);
      console.error("Server errors:", serverError);
    }
  });
  
  // Wait for server to be ready
  const pingUrl = `http://127.0.0.1:${port}/rest/ping?u=${username}&p=${password}&v=1.16.1&c=test&f=json`;
  const ready = await waitForServer(pingUrl);
  
  if (!ready) {
    console.error("Server failed to start. Output:", serverOutput);
    console.error("Server errors:", serverError);
    serverProcess.kill();
    throw new Error("Ferrotune server failed to start within timeout");
  }
  
  console.log(`✅ Ferrotune server ready at http://127.0.0.1:${port}`);
  
  // Store server info for tests and teardown
  global.__FERROTUNE_SERVER__ = {
    process: serverProcess,
    port,
    adminPort,
    tempDir,
    username,
    password,
  };
  
  // Write server info to a file so tests can read it
  const serverInfoPath = path.join(tempDir, "server-info.json");
  fs.writeFileSync(serverInfoPath, JSON.stringify({
    url: `http://127.0.0.1:${port}`,
    adminUrl: `http://127.0.0.1:${adminPort}`,
    username,
    password,
    tempDir,
  }));
  
  // Set environment variables for tests
  process.env.FERROTUNE_TEST_URL = `http://127.0.0.1:${port}`;
  process.env.FERROTUNE_TEST_USER = username;
  process.env.FERROTUNE_TEST_PASS = password;
  process.env.FERROTUNE_SERVER_INFO = serverInfoPath;
  
  // Write a .env.test file that fixtures can read
  // This is needed because env vars don't propagate to worker processes
  const envTestPath = path.join(__dirname, ".env.test");
  fs.writeFileSync(envTestPath, `FERROTUNE_TEST_URL=http://127.0.0.1:${port}
FERROTUNE_TEST_USER=${username}
FERROTUNE_TEST_PASS=${password}
`);
  
  console.log("\n📊 Test data available:");
  console.log("   - 3 artists (Test Artist, Another Artist, Various Artists)");
  console.log("   - 3 albums");
  console.log("   - 7 tracks (5 MP3, 2 FLAC)");
  console.log("");
  
  // Start Next.js dev server
  const nextPort = 13000;
  console.log(`\nStarting Next.js dev server on port ${nextPort}...`);
  
  const clientDir = __dirname.replace(/\/e2e$/, "");
  const nextProcess = spawn("npm", ["run", "dev"], {
    cwd: clientDir,
    env: { 
      ...process.env, 
      PORT: nextPort.toString(),
      NEXT_DIST_DIR: ".next-test",  // Use separate build dir for tests
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
  const nextReady = await waitForServer(nextUrl, 60000); // Longer timeout for Next.js
  
  if (!nextReady) {
    console.error("Next.js server failed to start. Output:", nextOutput);
    console.error("Next.js errors:", nextError);
    nextProcess.kill();
    serverProcess.kill();
    throw new Error("Next.js server failed to start within timeout");
  }
  
  console.log(`✅ Next.js dev server ready at http://localhost:${nextPort}`);
  
  // Store Next.js server info for teardown
  global.__NEXTJS_SERVER__ = {
    process: nextProcess,
    port: nextPort,
  };
}
