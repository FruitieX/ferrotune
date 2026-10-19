/**
 * Detecting that the server now serves a newer web client build.
 *
 * Built assets have content-hashed names and the server only has the current
 * build's files, so a tab opened before a deploy can no longer load lazy route
 * chunks: those imports fail for good and only a page reload recovers.
 */

const STALE_ASSET_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
];

/** Whether an error comes from loading a code chunk the server no longer has. */
export function isStaleAssetError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return STALE_ASSET_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/** The hashed entry script of a built index.html, e.g. `/assets/index-AbC123.js`. */
export function entryScriptFromHtml(html: string): string | null {
  const match = html.match(
    /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]*\/assets\/[^"]+)"/,
  );
  return match ? match[1] : null;
}

/** The entry script this page was loaded with, or null in dev builds. */
export function currentEntryScript(): string | null {
  const script = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/"]',
  );
  return script ? script.getAttribute("src") : null;
}

/** Fetches index.html and returns its entry script, bypassing caches. */
export async function fetchLatestEntryScript(): Promise<string | null> {
  const response = await fetch("/", {
    cache: "no-store",
    headers: { Accept: "text/html" },
  });
  if (!response.ok) {
    return null;
  }
  return entryScriptFromHtml(await response.text());
}
