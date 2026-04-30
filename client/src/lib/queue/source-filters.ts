export function queueTextFilter(
  searchTerm: string,
  shouldApplySearchTerm: boolean,
): { filter: string } | undefined {
  const trimmed = searchTerm.trim();
  if (!shouldApplySearchTerm || !trimmed) return undefined;
  return { filter: trimmed };
}

export function queueQueryValue(
  searchTerm: string,
  shouldApplySearchTerm: boolean,
): string {
  const trimmed = searchTerm.trim();
  return shouldApplySearchTerm && trimmed ? trimmed : "*";
}

export function isSearchTermExcludedFromQueue(
  searchTerm: string,
  shouldApplySearchTerm: boolean,
): boolean {
  return !shouldApplySearchTerm && searchTerm.trim().length > 0;
}
