import type { Page } from "@playwright/test";

export async function setDocumentVisibility(
  page: Page,
  visibilityState: DocumentVisibilityState,
): Promise<void> {
  await page.evaluate((nextVisibilityState) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => nextVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibilityState);
}
