/**
 * Global teardown for Playwright E2E tests.
 *
 * This script stops the shared Vite preview server.
 * Each worker's Ferrotune server is cleaned up via the worker-scoped fixture.
 */

export default async function globalTeardown() {
  console.log("\n🧹 Cleaning up test environment...\n");

  // Stop Vite preview server
  const viteServerInfo = global.__VITE_PREVIEW_SERVER__;
  if (viteServerInfo) {
    console.log("Stopping Vite preview server...");
    viteServerInfo.process.kill("SIGTERM");

    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Force kill if still running
    try {
      viteServerInfo.process.kill("SIGKILL");
    } catch {
      // Already dead
    }

    console.log("✅ Vite preview server stopped");
  } else {
    console.log("No Vite preview server to clean up");
  }

  console.log("✅ Global teardown complete\n");
}
