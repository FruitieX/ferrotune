"use client";

import { useState, useRef, useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Filter, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AdvancedFilterBuilder,
  buildFieldsWithLibraries,
  DEFAULT_SONG_FIELDS,
  DEFAULT_ALBUM_FIELDS,
  DEFAULT_ARTIST_FIELDS,
  EMPTY_FILTERS,
  createDefaultCondition,
  filtersToSearchParams,
  type AdvancedFilters as RuleBasedFilters,
  type FilterCondition,
  type FieldDefinition,
} from "@/components/common/advanced-filter-builder";
import {
  advancedFiltersAtom,
  hasActiveFiltersAtom,
  type AdvancedFilters as FlatFilters,
} from "@/lib/store/ui";
import { getClient } from "@/lib/api/client";
import { SmartPlaylistNameDialog } from "@/components/playlists/smart-playlist-name-dialog";

interface AdvancedFilterDialogProps {
  className?: string;
  /** When provided, the dialog becomes controlled */
  open?: boolean;
  /** Called when open state changes (for controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** Whether to show the trigger button (default: true) */
  showTrigger?: boolean;
  /** Which library view type to show fields for (default: "songs") */
  viewType?: "songs" | "albums" | "artists";
}

/**
 * Convert flat filters (from atom) to rule-based filters for the builder.
 */
function flatToRules(flat: FlatFilters): RuleBasedFilters {
  const conditions: FilterCondition[] = [];
  let id = 0;
  const nextId = () => `c${id++}`;

  // Year range
  if (flat.minYear !== undefined) {
    conditions.push({
      id: nextId(),
      field: "year",
      operator: "gte",
      value: flat.minYear,
    });
  }
  if (flat.maxYear !== undefined) {
    conditions.push({
      id: nextId(),
      field: "year",
      operator: "lte",
      value: flat.maxYear,
    });
  }

  // Genre
  if (flat.genre) {
    conditions.push({
      id: nextId(),
      field: "genre",
      operator: "eq",
      value: flat.genre,
    });
  }

  // Duration range
  if (flat.minDuration !== undefined) {
    conditions.push({
      id: nextId(),
      field: "duration",
      operator: "gte",
      value: flat.minDuration,
    });
  }
  if (flat.maxDuration !== undefined) {
    conditions.push({
      id: nextId(),
      field: "duration",
      operator: "lte",
      value: flat.maxDuration,
    });
  }

  // Rating range
  if (flat.minRating !== undefined) {
    conditions.push({
      id: nextId(),
      field: "rating",
      operator: "gte",
      value: flat.minRating,
    });
  }
  if (flat.maxRating !== undefined) {
    conditions.push({
      id: nextId(),
      field: "rating",
      operator: "lte",
      value: flat.maxRating,
    });
  }

  // Starred only
  if (flat.starredOnly) {
    conditions.push({
      id: nextId(),
      field: "starred",
      operator: "eq",
      value: true,
    });
  }

  // Play count range
  if (flat.minPlayCount !== undefined) {
    conditions.push({
      id: nextId(),
      field: "playCount",
      operator: "gte",
      value: flat.minPlayCount,
    });
  }
  if (flat.maxPlayCount !== undefined) {
    conditions.push({
      id: nextId(),
      field: "playCount",
      operator: "lte",
      value: flat.maxPlayCount,
    });
  }

  // Shuffle excluded
  if (flat.shuffleExcludedOnly) {
    conditions.push({
      id: nextId(),
      field: "shuffleExcluded",
      operator: "eq",
      value: true,
    });
  }

  // Bitrate range
  if (flat.minBitrate !== undefined) {
    conditions.push({
      id: nextId(),
      field: "bitrate",
      operator: "gte",
      value: flat.minBitrate,
    });
  }
  if (flat.maxBitrate !== undefined) {
    conditions.push({
      id: nextId(),
      field: "bitrate",
      operator: "lte",
      value: flat.maxBitrate,
    });
  }

  // Date added range
  if (flat.addedAfter) {
    conditions.push({
      id: nextId(),
      field: "dateAdded",
      operator: "gt",
      value: flat.addedAfter,
    });
  }
  if (flat.addedBefore) {
    conditions.push({
      id: nextId(),
      field: "dateAdded",
      operator: "lt",
      value: flat.addedBefore,
    });
  }

  // Last played range
  if (flat.lastPlayedAfter) {
    conditions.push({
      id: nextId(),
      field: "lastPlayed",
      operator: "gt",
      value: flat.lastPlayedAfter,
    });
  }
  if (flat.lastPlayedBefore) {
    conditions.push({
      id: nextId(),
      field: "lastPlayed",
      operator: "lt",
      value: flat.lastPlayedBefore,
    });
  }

  // Text filters
  if (flat.artistFilter) {
    conditions.push({
      id: nextId(),
      field: "artist",
      operator: "contains",
      value: flat.artistFilter,
    });
  }
  if (flat.albumFilter) {
    conditions.push({
      id: nextId(),
      field: "album",
      operator: "contains",
      value: flat.albumFilter,
    });
  }
  if (flat.titleFilter) {
    conditions.push({
      id: nextId(),
      field: "title",
      operator: "contains",
      value: flat.titleFilter,
    });
  }

  // File format
  if (flat.fileFormat) {
    conditions.push({
      id: nextId(),
      field: "fileFormat",
      operator: "eq",
      value: flat.fileFormat,
    });
  }

  // Cover art (enum: missing = "is not" + "any")
  if (flat.missingCoverArt) {
    conditions.push({
      id: nextId(),
      field: "coverArt",
      operator: "neq",
      value: "any",
    });
  }

  // Library/music folder
  if (flat.musicFolderId != null) {
    conditions.push({
      id: nextId(),
      field: "library",
      operator: "eq",
      value: flat.musicFolderId,
    });
  }

  if (flat.disabledOnly) {
    conditions.push({
      id: nextId(),
      field: "disabled",
      operator: "eq",
      value: true,
    });
  }

  return {
    logic: "and",
    conditions,
  };
}

/**
 * Convert rule-based filters to flat filters for the API.
 */
function rulesToFlat(rules: RuleBasedFilters): FlatFilters {
  return filtersToSearchParams(rules) as FlatFilters;
}

export function AdvancedFilterDialog({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
  viewType = "songs",
}: AdvancedFilterDialogProps) {
  const [flatFilters, setFlatFilters] = useAtom(advancedFiltersAtom);
  const hasActiveFilters = useAtomValue(hasActiveFiltersAtom);
  const [internalOpen, setInternalOpen] = useState(false);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  // Snapshot of filters when dialog was opened, for cancel/rollback
  const snapshotRef = useRef<FlatFilters>({});

  // Fetch music folders for the library field
  const { data: musicFolders = [] } = useQuery({
    queryKey: ["musicFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) return [];
      const response = await client.getAdminMusicFolders();
      return response.musicFolders ?? [];
    },
  });

  // Select base fields based on view type
  const baseFields: FieldDefinition[] =
    viewType === "albums"
      ? DEFAULT_ALBUM_FIELDS
      : viewType === "artists"
        ? DEFAULT_ARTIST_FIELDS
        : DEFAULT_SONG_FIELDS;

  const fields = buildFieldsWithLibraries(baseFields, musicFolders);

  // Use controlled or internal state
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? (value: boolean) => controlledOnOpenChange?.(value)
    : setInternalOpen;

  // Local rule-based state for the builder
  const [localFilters, setLocalFilters] =
    useState<RuleBasedFilters>(EMPTY_FILTERS);

  // Count active filters
  const activeFilterCount = Object.entries(flatFilters).filter(
    ([, v]) => v !== undefined && v !== false && v !== "",
  ).length;

  // Debounced live-apply: when localFilters change while dialog is open,
  // apply them to the atom after a short delay
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const flat = rulesToFlat(localFilters);
      setFlatFilters(flat);
    }, 300);
    return () => clearTimeout(timer);
  }, [localFilters, open, setFlatFilters]);

  const initLocalFilters = (flat: FlatFilters) => {
    const filters = flatToRules(flat);
    if (filters.conditions.length === 0) {
      filters.conditions.push(createDefaultCondition(fields));
    }
    setLocalFilters(filters);
  };

  const handleOpen = () => {
    snapshotRef.current = flatFilters;
    initLocalFilters(flatFilters);
    setOpen(true);
  };

  // Handle dialog open state change (including controlled mode)
  const handleOpenChange = (value: boolean) => {
    if (value) {
      snapshotRef.current = flatFilters;
      initLocalFilters(flatFilters);
    } else {
      // Closing via backdrop/escape = cancel: rollback to snapshot
      setFlatFilters(snapshotRef.current);
    }
    setOpen(value);
  };

  const handleApply = () => {
    // Commit current state (already live-applied via debounce)
    const flat = rulesToFlat(localFilters);
    setFlatFilters(flat);
    setOpen(false);
  };

  const handleCancel = () => {
    // Rollback to snapshot
    setFlatFilters(snapshotRef.current);
    setOpen(false);
  };

  const handleClear = () => {
    setLocalFilters(EMPTY_FILTERS);
    setFlatFilters({});
    snapshotRef.current = {};
    setOpen(false);
  };

  // Create smart playlist from current filter rules
  const createSmartPlaylistMutation = useMutation({
    mutationFn: async (name: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Filter out conditions with empty values (except empty/notEmpty operators)
      const validConditions = localFilters.conditions.filter(
        (c) =>
          ["empty", "notEmpty"].includes(c.operator) ||
          (c.value !== "" && c.value !== undefined),
      );

      if (validConditions.length === 0) {
        throw new Error("No valid filter conditions");
      }

      return client.createSmartPlaylist({
        name,
        comment: null,
        isPublic: false,
        rules: {
          conditions: validConditions.map((c) => ({
            field: c.field,
            operator: c.operator,
            value: c.value,
          })),
          logic: localFilters.logic,
        },
        sortField: null,
        sortDirection: null,
        maxSongs: null,
        folderId: null,
      });
    },
    onSuccess: (_, name) => {
      toast.success(`Smart playlist "${name}" created`);
      queryClient.invalidateQueries({ queryKey: ["smartPlaylists"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    },
    onError: (error) => {
      toast.error(`Failed to create smart playlist: ${error.message}`);
    },
  });

  const hasValidConditions = localFilters.conditions.some(
    (c) =>
      ["empty", "notEmpty"].includes(c.operator) ||
      (c.value !== "" && c.value !== undefined),
  );

  return (
    <>
      {showTrigger && (
        <Button
          variant={hasActiveFilters ? "default" : "outline"}
          size="icon"
          className={cn("h-8 w-8 relative", className)}
          onClick={handleOpen}
          aria-label="Advanced filters"
        >
          <Filter className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <Badge
              variant="secondary"
              className="absolute -top-1 -right-1 h-4 min-w-4 p-0 text-[10px] flex items-center justify-center"
            >
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Advanced Filters</DialogTitle>
            <DialogDescription className="sr-only">
              Configure advanced filter rules
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-auto py-4">
            <AdvancedFilterBuilder
              value={localFilters}
              onChange={setLocalFilters}
              fields={fields}
              maxHeight="400px"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {hasValidConditions && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNameDialogOpen(true)}
                disabled={createSmartPlaylistMutation.isPending}
                className="mr-auto"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Save as Smart Playlist
              </Button>
            )}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                onClick={handleClear}
                className="text-destructive"
              >
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            )}
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleApply}>Apply Filters</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SmartPlaylistNameDialog
        open={nameDialogOpen}
        onOpenChange={setNameDialogOpen}
        onConfirm={(name) => {
          createSmartPlaylistMutation.mutate(name);
          setNameDialogOpen(false);
        }}
        isPending={createSmartPlaylistMutation.isPending}
      />
    </>
  );
}

/**
 * Shows active filter badges that can be individually removed.
 * Re-exported from filter-popover for compatibility.
 */
export { ActiveFilterBadges } from "@/components/shared/filter-popover";
