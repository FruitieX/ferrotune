"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckSquare,
  Filter,
  History,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import { invalidatePlayCountQueries } from "@/lib/api/cache-invalidation";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useScrollRestoration } from "@/lib/hooks/use-scroll-restoration";
import { cn } from "@/lib/utils";
import { formatCount, formatDuration } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DetailHeader } from "@/components/shared/detail-header";
import { CoverImage } from "@/components/shared/cover-image";
import { EmptyState } from "@/components/shared/empty-state";
import { VirtualizedList } from "@/components/shared/virtualized-grid";
import type { ManagedHistoryEntry } from "@/lib/api/generated/ManagedHistoryEntry";
import type { ManagedHistoryEntryKind } from "@/lib/api/generated/ManagedHistoryEntryKind";
import type { ManagedHistoryFilter } from "@/lib/api/generated/ManagedHistoryFilter";

const PAGE_SIZE = 100;
const GROUP_GAP_MS = 15 * 60 * 1000;
const GROUP_DURATION_GRACE_MS = 5 * 60 * 1000;

type CheckedState = boolean | "indeterminate";

interface FilterForm {
  from: string;
  to: string;
  minDuration: string;
  maxDuration: string;
  includeScrobbles: boolean;
  includeSessions: boolean;
}

interface AppliedFilters {
  from?: string;
  to?: string;
  minDuration?: number;
  maxDuration?: number;
  includeScrobbles: boolean;
  includeSessions: boolean;
}

interface HistoryGroup {
  id: string;
  startAt: string | null;
  endAt: string | null;
  entries: ManagedHistoryEntry[];
}

type TimelineItem =
  | { type: "group"; group: HistoryGroup }
  | { type: "entry"; entry: ManagedHistoryEntry; groupId: string };

function readBooleanParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value !== "false";
}

function isoToDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function datetimeLocalToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function positiveNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function formFromSearchParams(
  searchParams: ReturnType<typeof useSearchParams>,
): FilterForm {
  return {
    from: isoToDatetimeLocal(searchParams.get("from")),
    to: isoToDatetimeLocal(searchParams.get("to")),
    minDuration: searchParams.get("minDuration") ?? "",
    maxDuration: searchParams.get("maxDuration") ?? "",
    includeScrobbles: readBooleanParam(
      searchParams.get("includeScrobbles"),
      true,
    ),
    includeSessions: readBooleanParam(
      searchParams.get("includeSessions"),
      true,
    ),
  };
}

function appliedFiltersFromForm(form: FilterForm): AppliedFilters {
  return {
    from: datetimeLocalToIso(form.from),
    to: datetimeLocalToIso(form.to),
    minDuration: positiveNumber(form.minDuration),
    maxDuration: positiveNumber(form.maxDuration),
    includeScrobbles: form.includeScrobbles,
    includeSessions: form.includeSessions,
  };
}

function requestFilter(filters: AppliedFilters): ManagedHistoryFilter {
  return {
    from: filters.from ?? null,
    to: filters.to ?? null,
    minDuration: filters.minDuration ?? null,
    maxDuration: filters.maxDuration ?? null,
  };
}

function kindsFromFilters(filters: AppliedFilters): ManagedHistoryEntryKind[] {
  const kinds: ManagedHistoryEntryKind[] = [];
  if (filters.includeScrobbles) kinds.push("scrobble");
  if (filters.includeSessions) kinds.push("session");
  return kinds;
}

function updateUrl(
  router: ReturnType<typeof useRouter>,
  filters: AppliedFilters,
) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.minDuration !== undefined)
    params.set("minDuration", String(filters.minDuration));
  if (filters.maxDuration !== undefined)
    params.set("maxDuration", String(filters.maxDuration));
  if (!filters.includeScrobbles) params.set("includeScrobbles", "false");
  if (!filters.includeSessions) params.set("includeSessions", "false");

  const query = params.toString();
  router.replace(query ? `/history/manage?${query}` : "/history/manage", {
    scroll: false,
  });
}

function entryKey(entry: ManagedHistoryEntry): string {
  return `${entry.kind}:${entry.id}`;
}

function eventTime(entry: ManagedHistoryEntry): number | null {
  if (!entry.eventAt) return null;
  const time = new Date(entry.eventAt).getTime();
  return Number.isNaN(time) ? null : time;
}

function continuousThreshold(entry: ManagedHistoryEntry): number {
  const durationSeconds = entry.durationSeconds ?? entry.song.duration ?? 0;
  return Math.max(
    GROUP_GAP_MS,
    durationSeconds * 1000 + GROUP_DURATION_GRACE_MS,
  );
}

function shouldStartNewGroup(
  previous: ManagedHistoryEntry | null,
  current: ManagedHistoryEntry,
): boolean {
  if (!previous) return true;
  const previousTime = eventTime(previous);
  const currentTime = eventTime(current);
  if (previousTime === null || currentTime === null) return true;
  return Math.abs(previousTime - currentTime) > continuousThreshold(current);
}

function buildGroups(entries: ManagedHistoryEntry[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  let currentGroup: HistoryGroup | null = null;
  let previous: ManagedHistoryEntry | null = null;

  for (const entry of entries) {
    if (shouldStartNewGroup(previous, entry) || !currentGroup) {
      currentGroup = {
        id: `group-${groups.length}-${entry.eventAt ?? entryKey(entry)}`,
        startAt: entry.eventAt,
        endAt: entry.eventAt,
        entries: [],
      };
      groups.push(currentGroup);
    }

    currentGroup.entries.push(entry);
    currentGroup.endAt = entry.eventAt;
    previous = entry;
  }

  return groups;
}

function flattenGroups(groups: HistoryGroup[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const group of groups) {
    items.push({ type: "group", group });
    for (const entry of group.entries) {
      items.push({ type: "entry", entry, groupId: group.id });
    }
  }
  return items;
}

function formatDateTime(value: string | null): string {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTime(value: string | null): string {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupRange(group: HistoryGroup): string {
  if (!group.startAt || !group.endAt) return "No timestamp";
  const start = new Date(group.startAt);
  const end = new Date(group.endAt);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${start.toLocaleDateString(undefined, { dateStyle: "medium" })} • ${formatTime(group.endAt)} – ${formatTime(group.startAt)}`;
  }
  return `${formatDateTime(group.endAt)} – ${formatDateTime(group.startAt)}`;
}

function selectedState(
  keys: string[],
  selectedKeys: Set<string>,
  allMatchingSelected: boolean,
): CheckedState {
  if (allMatchingSelected) return true;
  const selectedCount = keys.filter((key) => selectedKeys.has(key)).length;
  if (selectedCount === 0) return false;
  return selectedCount === keys.length ? true : "indeterminate";
}

function selectedIds(
  entries: ManagedHistoryEntry[],
  selectedKeys: Set<string>,
) {
  const scrobbleIds: number[] = [];
  const sessionIds: number[] = [];
  for (const entry of entries) {
    if (!selectedKeys.has(entryKey(entry))) continue;
    if (entry.kind === "scrobble") {
      scrobbleIds.push(entry.id);
    } else {
      sessionIds.push(entry.id);
    }
  }
  return { scrobbleIds, sessionIds };
}

function coverUrl(entry: ManagedHistoryEntry): string | undefined {
  const client = getClient();
  if (!client || !entry.song.coverArt) return undefined;
  return client.getCoverArtUrl(entry.song.coverArt, "small");
}

function HistoryEntryRow({
  entry,
  checked,
  disabled,
  onToggle,
}: {
  entry: ManagedHistoryEntry;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border/60 px-4 py-3 hover:bg-muted/40",
        checked && "bg-primary/5",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={`Select ${entry.song.title}`}
      />
      <CoverImage
        src={coverUrl(entry)}
        inlineData={entry.song.coverArtData}
        alt={entry.song.title}
        type="song"
        size="sm"
        priority={false}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{entry.song.title}</p>
          <Badge variant={entry.kind === "scrobble" ? "default" : "secondary"}>
            {entry.kind === "scrobble" ? "Scrobble" : "Session"}
          </Badge>
          {entry.skipped && <Badge variant="outline">Skipped</Badge>}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {entry.song.artist}
          {entry.song.album ? ` • ${entry.song.album}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{formatDateTime(entry.eventAt)}</span>
          {entry.kind === "session" && entry.durationSeconds !== null && (
            <span>Listened {formatDuration(entry.durationSeconds)}</span>
          )}
          {entry.kind === "scrobble" && entry.playCount !== null && (
            <span>{formatCount(entry.playCount, "play")}</span>
          )}
          {entry.description && <span>{entry.description}</span>}
          {entry.queueSourceType && (
            <span>Source: {entry.queueSourceType}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupHeader({
  group,
  checked,
  disabled,
  onToggle,
}: {
  group: HistoryGroup;
  checked: CheckedState;
  disabled: boolean;
  onToggle: () => void;
}) {
  const scrobbles = group.entries.filter(
    (entry) => entry.kind === "scrobble",
  ).length;
  const sessions = group.entries.length - scrobbles;

  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-3">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={onToggle}
          aria-label={`Select group ${groupRange(group)}`}
        />
        <div>
          <p className="text-sm font-semibold">{groupRange(group)}</p>
          <p className="text-xs text-muted-foreground">
            {formatCount(group.entries.length, "entry")} •{" "}
            {formatCount(scrobbles, "scrobble")} •{" "}
            {formatCount(sessions, "session")}
          </p>
        </div>
      </div>
      <Badge variant="outline">Listening session</Badge>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3 px-4 lg:px-6 py-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-10 w-10 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ManageHistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  useScrollRestoration();

  const [form, setForm] = useState<FilterForm>(() =>
    formFromSearchParams(searchParams),
  );
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(() =>
    appliedFiltersFromForm(formFromSearchParams(searchParams)),
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const historyQuery = useInfiniteQuery({
    queryKey: ["history-manage", appliedFilters],
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const offset = typeof pageParam === "number" ? pageParam : 0;
      return client.getManagedHistoryEntries({
        from: appliedFilters.from,
        to: appliedFilters.to,
        minDuration: appliedFilters.minDuration,
        maxDuration: appliedFilters.maxDuration,
        includeScrobbles: appliedFilters.includeScrobbles,
        includeSessions: appliedFilters.includeSessions,
        offset,
        limit: PAGE_SIZE,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce(
        (total, page) => total + page.items.length,
        0,
      );
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: isReady,
  });

  const entries = historyQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = historyQuery.data?.pages[0]?.total ?? 0;
  const groups = buildGroups(entries);
  const timelineItems = flattenGroups(groups);
  const selectedCount = allMatchingSelected ? total : selectedKeys.size;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      if (allMatchingSelected) {
        return client.deleteMatchingManagedHistoryEntries({
          filter: requestFilter(appliedFilters),
          kinds: kindsFromFilters(appliedFilters),
        });
      }
      return client.deleteManagedHistoryEntries(
        selectedIds(entries, selectedKeys),
      );
    },
    onSuccess: (response) => {
      toast.success(response.message);
      setSelectedKeys(new Set());
      setAllMatchingSelected(false);
      setShowDeleteDialog(false);
      queryClient.invalidateQueries({ queryKey: ["history-manage"] });
      queryClient.invalidateQueries({ queryKey: ["playHistory"] });
      queryClient.invalidateQueries({ queryKey: ["listeningStats"] });
      invalidatePlayCountQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete history entries");
      setShowDeleteDialog(false);
    },
  });

  const applyFilters = () => {
    const nextFilters = appliedFiltersFromForm(form);
    setAppliedFilters(nextFilters);
    setSelectedKeys(new Set());
    setAllMatchingSelected(false);
    updateUrl(router, nextFilters);
  };

  const clearFilters = () => {
    const nextForm: FilterForm = {
      from: "",
      to: "",
      minDuration: "",
      maxDuration: "",
      includeScrobbles: true,
      includeSessions: true,
    };
    const nextFilters = appliedFiltersFromForm(nextForm);
    setForm(nextForm);
    setAppliedFilters(nextFilters);
    setSelectedKeys(new Set());
    setAllMatchingSelected(false);
    updateUrl(router, nextFilters);
  };

  const toggleEntry = (entry: ManagedHistoryEntry) => {
    if (allMatchingSelected) return;
    const key = entryKey(entry);
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedKeys(next);
  };

  const toggleKeys = (keys: string[]) => {
    if (allMatchingSelected) return;
    const next = new Set(selectedKeys);
    const allSelected = keys.every((key) => next.has(key));
    for (const key of keys) {
      if (allSelected) {
        next.delete(key);
      } else {
        next.add(key);
      }
    }
    setSelectedKeys(next);
  };

  const selectLoaded = () => {
    setAllMatchingSelected(false);
    const loadedKeys = entries.map(entryKey);
    toggleKeys(loadedKeys);
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
    setAllMatchingSelected(false);
  };

  const canDelete = selectedCount > 0 && !deleteMutation.isPending;
  const canSelectAllMatching =
    total > 0 &&
    (appliedFilters.includeScrobbles || appliedFilters.includeSessions);

  if (!isMounted || authLoading) {
    return (
      <div className="min-h-dvh">
        <DetailHeader
          icon={History}
          label="History"
          title="Manage listening history"
          isLoading
        />
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-28">
      <DetailHeader
        icon={History}
        iconClassName="bg-linear-to-br from-amber-500 to-red-700"
        gradientColor="rgba(245,158,11,0.2)"
        label="History"
        title="Manage listening history"
        subtitle={`${formatCount(total, "entry")} matching current filters`}
      />

      <div className="border-b border-border px-4 lg:px-6 py-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="history-from">From</Label>
              <Input
                id="history-from"
                type="datetime-local"
                value={form.from}
                onChange={(event) =>
                  setForm({ ...form, from: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="history-to">To</Label>
              <Input
                id="history-to"
                type="datetime-local"
                value={form.to}
                onChange={(event) =>
                  setForm({ ...form, to: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="history-min-duration">
                Min session duration (seconds)
              </Label>
              <Input
                id="history-min-duration"
                inputMode="numeric"
                min={0}
                type="number"
                value={form.minDuration}
                onChange={(event) =>
                  setForm({ ...form, minDuration: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="history-max-duration">
                Max session duration (seconds)
              </Label>
              <Input
                id="history-max-duration"
                inputMode="numeric"
                min={0}
                type="number"
                value={form.maxDuration}
                onChange={(event) =>
                  setForm({ ...form, maxDuration: event.target.value })
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={applyFilters} className="gap-2">
              <Filter className="h-4 w-4" />
              Apply filters
            </Button>
            <Button variant="outline" onClick={clearFilters} className="gap-2">
              <X className="h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={form.includeScrobbles}
              onCheckedChange={() =>
                setForm({ ...form, includeScrobbles: !form.includeScrobbles })
              }
            />
            Include scrobbles
          </Label>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={form.includeSessions}
              onCheckedChange={() =>
                setForm({ ...form, includeSessions: !form.includeSessions })
              }
            />
            Include listening sessions
          </Label>
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Duration filters only apply to listening sessions.
          </span>
        </div>
      </div>

      <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 lg:px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckSquare className="h-4 w-4" />
            {selectedCount > 0
              ? `${selectedCount.toLocaleString()} selected`
              : "No entries selected"}
            {allMatchingSelected && (
              <Badge variant="secondary">All matching filters</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={selectLoaded}
              disabled={entries.length === 0 || allMatchingSelected}
            >
              Select loaded
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAllMatchingSelected(true);
                setSelectedKeys(new Set());
              }}
              disabled={!canSelectAllMatching}
            >
              Select all matching filter
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={selectedCount === 0}
            >
              Clear selection
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              disabled={!canDelete}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </Button>
          </div>
        </div>
      </div>

      {historyQuery.isLoading ? (
        <LoadingState />
      ) : historyQuery.error ? (
        <div className="px-4 lg:px-6 py-12 text-center text-destructive">
          Failed to load history entries.
        </div>
      ) : timelineItems.length > 0 ? (
        <VirtualizedList
          items={timelineItems}
          renderItem={(item) => {
            if (item.type === "group") {
              const keys = item.group.entries.map(entryKey);
              return (
                <GroupHeader
                  group={item.group}
                  checked={selectedState(
                    keys,
                    selectedKeys,
                    allMatchingSelected,
                  )}
                  disabled={allMatchingSelected}
                  onToggle={() => toggleKeys(keys)}
                />
              );
            }
            return (
              <HistoryEntryRow
                entry={item.entry}
                checked={
                  allMatchingSelected || selectedKeys.has(entryKey(item.entry))
                }
                disabled={allMatchingSelected}
                onToggle={() => toggleEntry(item.entry)}
              />
            );
          }}
          renderSkeleton={() => <Skeleton className="mx-4 h-16" />}
          getItemKey={(item) =>
            item.type === "group" ? item.group.id : entryKey(item.entry)
          }
          estimateItemHeight={72}
          hasNextPage={historyQuery.hasNextPage}
          isFetchingNextPage={historyQuery.isFetchingNextPage}
          fetchNextPage={() => historyQuery.fetchNextPage()}
          autoScrollMargin
        />
      ) : (
        <div className="px-4 lg:px-6 py-12">
          <EmptyState
            icon={CalendarClock}
            title="No matching history entries"
            description="Try widening the date range or clearing the duration filters."
          />
        </div>
      )}

      {historyQuery.isFetchingNextPage && (
        <div className="flex justify-center py-4 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading more entries…
        </div>
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete listening history entries?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedCount.toLocaleString()}{" "}
              selected {selectedCount === 1 ? "entry" : "entries"}. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {allMatchingSelected && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              You selected every entry matching the current filters, including
              entries that are not loaded in the list yet.
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete entries
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
