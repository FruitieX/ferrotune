"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Wand2, AlertCircle, Music } from "lucide-react";
import { formatDurationMs } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { getClient } from "@/lib/api/client";
import type { PlaylistSongEntry } from "@/lib/api/generated/PlaylistSongEntry";
import {
  MatchableTrack,
  SearchOptions,
  MatchingProgress,
  SearchOptionsControl,
  MatchSummary,
  TabbedTrackList,
  useTrackMatcher,
} from "./track-matcher";

interface MassResolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  /** Filter text to apply when fetching entries (matches current playlist view filter) */
  filter?: string;
  /** Sort field to apply when fetching entries */
  sortField?: string;
  /** Sort direction */
  sortDir?: string;
}

type ResolveStep = "loading" | "options" | "matching" | "preview" | "saving";

interface MissingEntry {
  position: number;
  entryId: string;
  missing: {
    title: string | null;
    artist: string | null;
    album: string | null;
    duration: number | null;
    raw: string;
  };
}

export function MassResolveDialog({
  open,
  onOpenChange,
  playlistId,
  filter,
  sortField,
  sortDir,
}: MassResolveDialogProps) {
  const queryClient = useQueryClient();
  const { matchTracks, cancel: cancelMatching } = useTrackMatcher();

  const [step, setStep] = useState<ResolveStep>("loading");
  const [missingEntries, setMissingEntries] = useState<MissingEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [matchedTracks, setMatchedTracks] = useState<MatchableTrack[]>([]);
  const [matchingProgress, setMatchingProgress] = useState(0);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    useTitle: true,
    useArtist: true,
    useAlbum: true,
  });
  const [confirmCloseDialogOpen, setConfirmCloseDialogOpen] = useState(false);

  // Count statistics (used in multiple places)
  const matchedCount = matchedTracks.filter((t) => t.match).length;
  const selectedMatchedCount = matchedTracks.filter(
    (t) => t.match && t.selected !== false,
  ).length;
  const unmatchedCount = matchedTracks.filter((t) => !t.match).length;

  // Check if there are unsaved matches
  const hasUnsavedChanges = step === "preview" && selectedMatchedCount > 0;

  // Fetch all missing entries when dialog opens
  useEffect(() => {
    if (!open) return;

    const fetchMissingEntries = async () => {
      setStep("loading");
      setLoadError(null);
      setMissingEntries([]);

      const client = getClient();
      if (!client) {
        setLoadError("Not connected");
        return;
      }

      try {
        // Fetch only missing entries using the entryType filter
        // This is much more efficient than fetching all entries and filtering client-side
        // Apply the same filter/sort as the current playlist view
        const response = await client.getPlaylistSongs(playlistId, {
          count: 10000,
          sort: sortField || "custom",
          sortDir: sortDir || "asc",
          filter: filter || undefined,
          entryType: "missing", // Only fetch missing entries
        });

        // Convert entries to MissingEntry format
        const missing: MissingEntry[] = response.entries.map(
          (entry: PlaylistSongEntry) => ({
            position: entry.position,
            entryId: entry.entryId,
            missing: {
              title: entry.missing?.title ?? null,
              artist: entry.missing?.artist ?? null,
              album: entry.missing?.album ?? null,
              duration: entry.missing?.duration ?? null,
              raw: entry.missing?.raw ?? "",
            },
          }),
        );

        setMissingEntries(missing);
        setStep("options");
      } catch (error) {
        console.error("Failed to fetch missing entries:", error);
        setLoadError(
          error instanceof Error ? error.message : "Failed to load entries",
        );
      }
    };

    fetchMissingEntries();
  }, [open, playlistId, filter, sortField, sortDir]);

  // Reset state and close dialog (internal helper)
  const resetAndClose = () => {
    cancelMatching();
    setStep("loading");
    setMissingEntries([]);
    setLoadError(null);
    setMatchedTracks([]);
    setMatchingProgress(0);
    setConfirmCloseDialogOpen(false);
    onOpenChange(false);
  };

  // Handle close request with confirmation if needed
  const handleCloseRequest = () => {
    if (hasUnsavedChanges) {
      setConfirmCloseDialogOpen(true);
    } else {
      resetAndClose();
    }
  };

  // Handle dialog open/close change (only called by Dialog)
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      handleCloseRequest();
    } else {
      onOpenChange(newOpen);
    }
  };

  // Start matching process
  const doMatchTracks = async () => {
    setStep("matching");
    setMatchingProgress(0);

    // Convert entries to ParsedTrackInfo format
    const tracksToMatch = missingEntries.map((entry) => ({
      title: entry.missing.title,
      artist: entry.missing.artist,
      album: entry.missing.album,
      duration: entry.missing.duration,
      raw: entry.missing.raw,
      // Store original position for saving later
      originalPosition: entry.position,
    }));

    const result = await matchTracks(
      tracksToMatch,
      searchOptions,
      setMatchingProgress,
    );

    if (result) {
      // Add matched/unmatched entries from missing entries with their original positions and entryIds
      const tracksWithPositions: MatchableTrack[] = result.map(
        (track, index) => ({
          ...track,
          originalPosition: missingEntries[index].position,
          entryId: missingEntries[index].entryId,
        }),
      );

      setMatchedTracks(tracksWithPositions);
      setStep("preview");
    } else {
      // Matching was cancelled
      setStep("options");
    }
  };

  // Save matches mutation - uses batch API for efficiency
  const saveMatches = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Get matched entries with their entryIds (only selected ones)
      const newMatches = matchedTracks.filter(
        (t) => t.match && t.entryId !== undefined && t.selected !== false,
      );

      // Build the batch request
      const entries = newMatches.map((entry) => ({
        entryId: entry.entryId!,
        songId: entry.match!.id,
      }));

      // Use batch API for efficient matching
      const result = await client.batchMatchEntries(playlistId, entries);
      return {
        successCount: result.matchedCount,
        failCount: result.failedCount,
      };
    },
    onSuccess: async ({ successCount, failCount }) => {
      await queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });

      if (failCount === 0) {
        toast.success(
          `Matched ${successCount} ${successCount === 1 ? "entry" : "entries"}`,
        );
      } else {
        toast.warning(
          `Matched ${successCount} ${successCount === 1 ? "entry" : "entries"}, ${failCount} failed`,
        );
      }

      resetAndClose();
    },
    onError: () => {
      toast.error("Failed to save matches");
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-[95vw] max-w-[1200px] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleCloseRequest();
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5" />
              Resolve Missing Entries
            </DialogTitle>
            <DialogDescription>
              Search and match missing playlist entries to songs in your
              library.
              {missingEntries.length > 0 && (
                <span className="block mt-1">
                  {missingEntries.length} missing{" "}
                  {missingEntries.length === 1 ? "entry" : "entries"} to resolve
                  {filter && (
                    <span className="text-muted-foreground">
                      {" "}
                      (filtered by &quot;{filter}&quot;)
                    </span>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {step === "loading" && (
            <div className="py-8 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-lg font-medium">Loading missing entries...</p>
            </div>
          )}

          {loadError && (
            <div className="py-4 text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
              <p className="text-lg font-medium text-destructive">
                Failed to load entries
              </p>
              <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
            </div>
          )}

          {step === "options" && (
            <div className="flex-1 min-h-0 flex flex-col py-4 space-y-4 overflow-hidden">
              <p className="text-sm text-muted-foreground shrink-0">
                Configure search options and click &quot;Start Matching&quot; to
                automatically find matches for missing entries in your library.
              </p>
              <SearchOptionsControl
                options={searchOptions}
                onChange={setSearchOptions}
              />

              {/* Missing entries list */}
              {missingEntries.length > 0 && (
                <div className="flex-1 min-h-0 flex flex-col">
                  <h4 className="text-sm font-medium mb-2 shrink-0">
                    Missing entries to resolve ({missingEntries.length})
                  </h4>
                  <div className="flex-1 min-h-0 overflow-auto rounded-md border">
                    <div className="p-1">
                      {missingEntries.map((entry, idx) => (
                        <div
                          key={entry.entryId}
                          className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
                        >
                          <div className="shrink-0 w-6 text-center text-xs text-muted-foreground tabular-nums">
                            {idx + 1}
                          </div>
                          <Music className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0 text-sm">
                            <div className="font-medium truncate">
                              {entry.missing.title ||
                                entry.missing.raw ||
                                "Unknown"}
                            </div>
                            <div className="text-muted-foreground text-xs truncate">
                              {entry.missing.artist}
                              {entry.missing.artist &&
                                entry.missing.album &&
                                " • "}
                              {entry.missing.album}
                              {entry.missing.duration &&
                                entry.missing.duration > 0 && (
                                  <span className="ml-1">
                                    ({formatDurationMs(entry.missing.duration)})
                                  </span>
                                )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "matching" && (
            <MatchingProgress
              tracksCount={missingEntries.length}
              progress={matchingProgress}
            />
          )}

          {step === "preview" && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="grid gap-4 py-4 shrink-0">
                {/* Search options - can be changed after matching */}
                <SearchOptionsControl
                  options={searchOptions}
                  onChange={setSearchOptions}
                  onRematch={doMatchTracks}
                  isMatching={false}
                  showRematch
                />

                {/* Match summary */}
                <MatchSummary
                  matchedCount={matchedCount}
                  unmatchedCount={unmatchedCount}
                />
              </div>

              {/* Track list with tabs */}
              <TabbedTrackList
                tracks={matchedTracks}
                onUpdateMatch={(index, match, score) => {
                  setMatchedTracks((prev) => {
                    const updated = [...prev];
                    updated[index] = {
                      ...updated[index],
                      match,
                      matchScore: score,
                      // Auto-select only if match confidence is 90% or higher
                      selected: match ? score >= 0.9 : updated[index].selected,
                    };
                    return updated;
                  });
                }}
                onToggleSelection={(index, selected) => {
                  setMatchedTracks((prev) => {
                    const updated = [...prev];
                    updated[index] = { ...updated[index], selected };
                    return updated;
                  });
                }}
                onToggleAllSelection={(trackList, selected) => {
                  setMatchedTracks((prev) => {
                    // Get the indices of tracks in the trackList
                    const indicesToUpdate = new Set(
                      trackList
                        .filter((t) => t.match && !t.locked)
                        .map((t) => prev.indexOf(t)),
                    );
                    return prev.map((track, idx) =>
                      indicesToUpdate.has(idx) ? { ...track, selected } : track,
                    );
                  });
                }}
                showMatchFilter
                showCheckboxes
              />
            </div>
          )}

          {step === "saving" && (
            <div className="py-8 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-lg font-medium">Saving matches...</p>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={handleCloseRequest}>
              Cancel
            </Button>

            {step === "options" && (
              <Button
                onClick={doMatchTracks}
                disabled={missingEntries.length === 0}
              >
                Start Matching
              </Button>
            )}

            {step === "preview" && (
              <Button
                onClick={() => {
                  setStep("saving");
                  saveMatches.mutate();
                }}
                disabled={selectedMatchedCount === 0 || saveMatches.isPending}
              >
                {saveMatches.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  `Save ${selectedMatchedCount} ${selectedMatchedCount === 1 ? "Match" : "Matches"}`
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog for closing with unsaved matches */}
      <AlertDialog
        open={confirmCloseDialogOpen}
        onOpenChange={setConfirmCloseDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard matches?</AlertDialogTitle>
            <AlertDialogDescription>
              You have matched {selectedMatchedCount}{" "}
              {selectedMatchedCount === 1 ? "entry" : "entries"} that{" "}
              {selectedMatchedCount === 1 ? "hasn't" : "haven't"} been saved
              yet. Are you sure you want to close and discard your progress?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={resetAndClose}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
