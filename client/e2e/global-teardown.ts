/**
 * Global teardown for Playwright E2E tests.
 *
 * This script stops the shared Next.js production server.
 * Each worker's Ferrotune server is cleaned up via the worker-scoped fixture.
 */

export default async function globalTeardown() {
  console.log("\n🧹 Cleaning up test environment...\n");

  // Stop Next.js production server
  const nextServerInfo = global.__NEXTJS_SERVER__;
  if (nextServerInfo) {
    console.log("Stopping Next.js production server...");
    nextServerInfo.process.kill("SIGTERM");

    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Force kill if still running
    try {
      nextServerInfo.process.kill("SIGKILL");
    } catch {
      // Already dead
    }

    console.log("✅ Next.js server stopped");
  } else {
    console.log("No Next.js server to clean up");
  }

  console.log("✅ Global teardown complete\n");
}
