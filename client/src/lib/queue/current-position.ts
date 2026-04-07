import type { QueueSourceInfo } from "@/lib/api/types";
import type { ServerQueueState } from "@/lib/store/server-queue";

type QueueSort = { field: string; direction: string };

interface ExpectedQueueSource {
  type: string;
  id?: string | null;
  filters?: Record<string, unknown> | null;
  sort?: QueueSort | null;
}

interface CurrentQueuePositionOptions {
  queueState: ServerQueueState | null;
  expectedSource: ExpectedQueueSource;
  displayIndex?: number;
  allowShuffled?: boolean;
}

function normalizeComparableValue(value: unknown): unknown {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeComparableValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [
          key,
          normalizeComparableValue(nestedValue),
        ]),
    );
  }

  return value;
}

function areComparableValuesEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeComparableValue(left)) ===
    JSON.stringify(normalizeComparableValue(right))
  );
}

export function queueSourceMatchesView(
  queueState: ServerQueueState | null,
  expectedSource: ExpectedQueueSource,
): boolean {
  if (!queueState) return false;

  const queueSource: QueueSourceInfo | undefined = queueState.source;
  if (!queueSource || queueSource.type !== expectedSource.type) {
    return false;
  }

  if (
    expectedSource.id !== undefined &&
    queueSource.id !== (expectedSource.id ?? null)
  ) {
    return false;
  }

  if (
    !areComparableValuesEqual(
      queueSource.filters,
      expectedSource.filters ?? null,
    )
  ) {
    return false;
  }

  if (
    !areComparableValuesEqual(queueSource.sort, expectedSource.sort ?? null)
  ) {
    return false;
  }

  return true;
}

export function getCurrentQueuePositionMatch({
  queueState,
  expectedSource,
  displayIndex,
  allowShuffled = false,
}: CurrentQueuePositionOptions): boolean | undefined {
  if (displayIndex === undefined) return undefined;
  if (!queueState) return undefined;
  if (!queueSourceMatchesView(queueState, expectedSource)) return undefined;
  if (queueState.isShuffled && !allowShuffled) return undefined;

  return queueState.currentIndex === displayIndex;
}
