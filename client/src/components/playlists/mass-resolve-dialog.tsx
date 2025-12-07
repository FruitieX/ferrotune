"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getClient } from "@/lib/api/client";
import type { PlaylistEntryResponse } from "@/lib/api/generated/PlaylistEntryResponse";
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
  entries: PlaylistEntryResponse[];
}

type ResolveStep = "options" | "matching" | "preview" | "saving";

export function MassResolveDialog({
  open,
  onOpenChange,
  playlistId,
  entries,
}: MassResolveDialogProps) {
  const queryClient = useQueryClient();
  const { matchTracks, cancel: cancelMatching } = useTrackMatcher();

  const [step, setStep] = useState<ResolveStep>("options");
  const [matchedTracks, setMatchedTracks] = useState<MatchableTrack[]>([]);
  const [matchingProgress, setMatchingProgress] = useState(0);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    useTitle: true,
    useArtist: true,
    useAlbum: false,
  });

  // Get missing entries only
  const missingEntries = entries.filter((entry) => entry.missing);

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      cancelMatching();
      setStep("options");
      setMatchedTracks([]);
      setMatchingProgress(0);
    }
    onOpenChange(newOpen);
  };

  // Start matching process
  const doMatchTracks = async () => {
    setStep("matching");
    setMatchingProgress(0);

    // Convert entries to ParsedTrackInfo format
    const tracksToMatch = missingEntries.map((entry) => ({
      title: entry.missing?.title ?? null,
      artist: entry.missing?.artist ?? null,
      album: entry.missing?.album ?? null,
      duration: entry.missing?.duration ?? null,
      raw: entry.missing?.raw ?? null,
      // Store original position for saving later
      originalPosition: entry.position,
    }));

    const result = await matchTracks(
      tracksToMatch,
      searchOptions,
      setMatchingProgress
    );

    if (result) {
      // Add matched/unmatched entries from missing entries with their original positions
      const tracksWithPositions: MatchableTrack[] = result.map((track, index) => ({
        ...track,
        originalPosition: missingEntries[index].position,
      }));

      setMatchedTracks(tracksWithPositions);
      setStep("preview");
    } else {
      // Matching was cancelled
      setStep("options");
    }
  };

  // Save matches mutation
  const saveMatches = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Get matched entries with their original positions
      const newMatches = matchedTracks.filter(
        (t) => t.match && t.originalPosition !== undefined
      );

      let successCount = 0;
      let failCount = 0;

      for (const entry of newMatches) {
        try {
          await client.matchMissingEntry(
            playlistId,
            entry.originalPosition!,
            entry.match!.id
          );
          successCount++;
        } catch (error) {
          console.error(
            `Failed to match entry at position ${entry.originalPosition}:`,
            error
          );
          failCount++;
        }
      }

      return { successCount, failCount };
    },
    onSuccess: async ({ successCount, failCount }) => {
      await queryClient.invalidateQueries({ queryKey: ["playlistSongs", playlistId] });

      if (failCount === 0) {
        toast.success(`Matched ${successCount} ${successCount === 1 ? "entry" : "entries"}`);
      } else {
        toast.warning(
          `Matched ${successCount} ${successCount === 1 ? "entry" : "entries"}, ${failCount} failed`
        );
      }

      handleOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to save matches");
    },
  });

  // Count statistics
  const matchedCount = matchedTracks.filter((t) => t.match).length;
  const unmatchedCount = matchedTracks.filter((t) => !t.match).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" />
            Resolve Missing Entries
          </DialogTitle>
          <DialogDescription>
            Search and match missing playlist entries to songs in your library.
            {missingEntries.length > 0 && (
              <span className="block mt-1">
                {missingEntries.length} missing {missingEntries.length === 1 ? "entry" : "entries"} to resolve
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "options" && (
          <div className="py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure search options and click &quot;Start Matching&quot; to automatically
              find matches for missing entries in your library.
            </p>
            <SearchOptionsControl
              options={searchOptions}
              onChange={setSearchOptions}
            />
          </div>
        )}

        {step === "matching" && (
          <MatchingProgress
            tracksCount={missingEntries.length}
            progress={matchingProgress}
          />
        )}

        {step === "preview" && (
          <>
            <div className="grid gap-4 py-4">
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
                  updated[index] = { ...updated[index], match, matchScore: score };
                  return updated;
                });
              }}
            />
          </>
        )}

        {step === "saving" && (
          <div className="py-8 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
            <p className="text-lg font-medium">Saving matches...</p>
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
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
              disabled={matchedCount === 0 || saveMatches.isPending}
            >
              {saveMatches.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                `Save ${matchedCount} ${matchedCount === 1 ? "Match" : "Matches"}`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
