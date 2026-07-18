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
    const exited = once(viteServerInfo.process, "exit");
    viteServerInfo.process.kill("SIGTERM");
    if (viteServerInfo.process.exitCode === null) {
      await exited;
    }

    console.log("✅ Vite preview server stopped");
  } else {
    console.log("No Vite preview server to clean up");
  }

  console.log("✅ Global teardown complete\n");
}
import { once } from "events";
