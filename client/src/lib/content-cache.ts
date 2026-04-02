/**
 * High-level cache for sparse pagination page data.
 *
 * Built on top of the unified cache store. Stores individual pages keyed by
 * serialized query key + page index, so navigating back to a previously
 * visited view renders instantly from cache.
 */

import { cacheGet, cacheSet, cacheDelByPrefix } from "@/lib/cache-store";

/** Data stored per cached page. */
export interface CachedPageData<T> {
  items: T[];
  total: number;
  metadata?: unknown;
  /** Timestamp when this page was cached. */
  cachedAt: number;
}

function pageKeyPrefix(queryKey: readonly unknown[]): string {
  return `page:${JSON.stringify(queryKey)}`;
}

function pageKey(queryKey: readonly unknown[], pageIndex: number): string {
  return `${pageKeyPrefix(queryKey)}:${pageIndex}`;
}

/** Retrieve a single cached page. Returns undefined on miss. */
export async function getCachedPage<T>(
  queryKey: readonly unknown[],
  pageIndex: number,
): Promise<CachedPageData<T> | undefined> {
  return cacheGet<CachedPageData<T>>(pageKey(queryKey, pageIndex));
}

/** Store a single page in the cache. */
export async function setCachedPage<T>(
  queryKey: readonly unknown[],
  pageIndex: number,
  data: Omit<CachedPageData<T>, "cachedAt">,
): Promise<void> {
  await cacheSet(pageKey(queryKey, pageIndex), {
    ...data,
    cachedAt: Date.now(),
  });
}

/** Remove all cached pages for a given query key. */
export async function clearCachedPages(
  queryKey: readonly unknown[],
): Promise<void> {
  await cacheDelByPrefix(pageKeyPrefix(queryKey));
}
