/**
 * Global teardown for Playwright E2E tests.
 * 
 * This script stops the Ferrotune server and cleans up temp files.
 */

import * as fs from "fs";
import * as path from "path";

export default async function globalTeardown() {
  console.log("\n🧹 Cleaning up test servers...\n");
  
  // Clean up .env.test file
  const envTestPath = path.join(__dirname, ".env.test");
  if (fs.existsSync(envTestPath)) {
    fs.unlinkSync(envTestPath);
  }
  
  // Stop Next.js dev server
  const nextServerInfo = global.__NEXTJS_SERVER__;
  if (nextServerInfo) {
    console.log("Stopping Next.js dev server...");
    nextServerInfo.process.kill("SIGTERM");
    
    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // Force kill if still running
    try {
      nextServerInfo.process.kill("SIGKILL");
    } catch {
      // Already dead
    }
  }
  
  // Skip Ferrotune cleanup if using external server
  if (process.env.FERROTUNE_EXTERNAL_SERVER === "true") {
    console.log("Using external server, skipping Ferrotune cleanup");
    return;
  }
  
  const serverInfo = global.__FERROTUNE_SERVER__;
  
  if (serverInfo) {
    // Stop the server
    console.log("Stopping Ferrotune server...");
    serverInfo.process.kill("SIGTERM");
    
    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // Force kill if still running
    try {
      serverInfo.process.kill("SIGKILL");
    } catch {
      // Already dead
    }
    
    // Clean up temp directory
    console.log(`Removing temp directory: ${serverInfo.tempDir}`);
    try {
      fs.rmSync(serverInfo.tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn("Failed to remove temp directory:", err);
    }
    
    console.log("✅ Cleanup complete");
  } else {
    console.log("No Ferrotune server to clean up");
  }
}
