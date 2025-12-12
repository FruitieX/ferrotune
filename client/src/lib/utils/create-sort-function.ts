/**
 * Generic sort function factory.
 * Creates type-safe sort functions by providing field extractors.
 */

type SortDirection = "asc" | "desc";

/**
 * A field extractor defines how to get a comparable value from an item.
 * Returns string | number for comparison.
 */
type FieldExtractor<T> = (item: T) => string | number;

/**
 * Field extractors map for a given type.
 * Keys are field names, values are functions that extract comparable values.
 */
type FieldExtractors<T> = Record<string, FieldExtractor<T>>;

interface CreateSortFunctionOptions<T> {
  /** Map of field names to extractor functions */
  extractors: FieldExtractors<T>;
  /** Default field to use when the requested field is not found */
  defaultField: string;
}

/**
 * Creates a reusable sort function for a given item type.
 *
 * @example
 * ```ts
 * const sortSongs = createSortFunction<Song>({
 *   extractors: {
 *     name: (s) => s.title?.toLowerCase() ?? '',
 *     artist: (s) => s.artist?.toLowerCase() ?? '',
 *     year: (s) => s.year ?? 0,
 *   },
 *   defaultField: 'name',
 * });
 *
 * // Usage:
 * const sorted = sortSongs(songs, 'artist', 'asc');
 * ```
 */
export function createSortFunction<T>({
  extractors,
  defaultField,
}: CreateSortFunctionOptions<T>): (
  items: T[],
  field: string,
  direction: SortDirection,
) => T[] {
  return (items: T[], field: string, direction: SortDirection): T[] => {
    // "custom" means preserve original order (no sorting)
    if (field === "custom") {
      return direction === "desc" ? [...items].reverse() : items;
    }

    // Get the extractor for the requested field, or fall back to default
    const extractor = extractors[field] ?? extractors[defaultField];

    if (!extractor) {
      // No valid extractor found - return unsorted
      return items;
    }

    const sorted = [...items].sort((a, b) => {
      const aVal = extractor(a);
      const bVal = extractor(b);

      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    });

    return direction === "desc" ? sorted.reverse() : sorted;
  };
}
