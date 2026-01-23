"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileMusic, Loader2, Download } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import {
  parsePlaylist,
  exportOriginalLines,
  getFormatExtension,
  getFormatMimeType,
  type ParsedTrack,
  type ParseResult,
} from "@/lib/utils/playlist-parser";
import type { ImportPlaylistEntry } from "@/lib/api/generated/ImportPlaylistEntry";
import {
  MatchableTrack,
  SearchOptions,
  MatchingProgress,
  SearchOptionsControl,
  MatchSummary,
  TabbedTrackList,
  useTrackMatcher,
} from "./track-matcher";

interface ImportPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current folder ID to create playlist in */
  folderId?: string | null;
}

type ImportStep = "upload" | "matching" | "preview" | "importing";

export function ImportPlaylistDialog({
  open,
  onOpenChange,
  folderId,
}: ImportPlaylistDialogProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [playlistName, setPlaylistName] = useState("");
  const [parsedTracks, setParsedTracks] = useState<ParsedTrack[]>([]);
  const [matchedTracks, setMatchedTracks] = useState<MatchableTrack[]>([]);
  const [matchingProgress, setMatchingProgress] = useState(0);
  const [isMatching, setIsMatching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [originalFormat, setOriginalFormat] =
    useState<ParseResult["format"]>("m3u");
  const [originalHeaderLine, setOriginalHeaderLine] = useState<
    string | undefined
  >(undefined);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    useTitle: true,
    useArtist: true,
    useAlbum: true,
    usePriorMatches: true,
  });
  const [includeMissing, setIncludeMissing] = useState(true);
  const [confirmCloseDialogOpen, setConfirmCloseDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { matchTracks, cancel: cancelMatching } = useTrackMatcher();

  // Check if there are unsaved changes
  const hasUnsavedChanges = step === "preview" && matchedTracks.length > 0;

  // Reset state when dialog closes (internal helper)
  const resetAndClose = () => {
    cancelMatching();
    setStep("upload");
    setPlaylistName("");
    setParsedTracks([]);
    setMatchedTracks([]);
    setMatchingProgress(0);
    setIsMatching(false);
    setOriginalFormat("m3u");
    setOriginalHeaderLine(undefined);
    setSearchOptions({
      useTitle: true,
      useArtist: true,
      useAlbum: false,
      usePriorMatches: true,
    });
    setIncludeMissing(true);
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

  // Match tracks against library
  const doMatchTracks = async (tracks: ParsedTrack[]) => {
    setIsMatching(true);
    setStep("matching");
    setMatchingProgress(0);

    const result = await matchTracks(
      tracks.map((t) => ({
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        raw: t.raw,
      })),
      searchOptions,
      setMatchingProgress,
    );

    if (result) {
      setMatchedTracks(result);
      setStep("preview");
    }
    setIsMatching(false);
  };

  // Handle file selection
  const handleFileSelect = async (file: File) => {
    try {
      const content = await file.text();
      const result = parsePlaylist(content, file.name);

      if (result.tracks.length === 0) {
        toast.error("No tracks found in the file");
        return;
      }

      setParsedTracks(result.tracks);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      setPlaylistName(baseName);
      setOriginalFormat(result.format);
      setOriginalHeaderLine(result.headerLine);

      // Auto-start matching
      await doMatchTracks(result.tracks);
    } catch (error) {
      console.error("Failed to parse file:", error);
      toast.error("Failed to parse playlist file");
    }
  };

  // Helper to save matched tracks to dictionary for future reuse
  const saveMatchesToDictionary = async (tracks: MatchableTrack[]) => {
    const client = getClient();
    if (!client) return;

    // Build dictionary entries from matched tracks
    const entries = tracks
      .filter((t) => t.match && t.selected !== false)
      .map((t) => ({
        title: t.parsed.title ?? null,
        artist: t.parsed.artist ?? null,
        album: t.parsed.album ?? null,
        duration: t.parsed.duration
          ? Math.round(t.parsed.duration * 1000)
          : undefined,
        songId: t.match!.id,
      }));

    if (entries.length === 0) return;

    try {
      await client.saveMatchDictionary({ entries });
    } catch {
      // Silently fail - this is a background enhancement
      console.warn("Failed to save matches to dictionary");
    }
  };

  // Create playlist mutation
  const createPlaylist = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // When includeMissing is enabled, use the new import API
      if (includeMissing) {
        // Build entries array preserving order
        // Always include missing data so matched tracks can be refined later
        const entries: ImportPlaylistEntry[] = matchedTracks.map((t) => {
          const missingData = {
            title: t.parsed.title || null,
            artist: t.parsed.artist || null,
            album: t.parsed.album || null,
            duration: t.parsed.duration ? Math.round(t.parsed.duration) : null,
            raw: buildSearchText(t.parsed),
          };

          // Only apply match if track has a match AND is selected (selected defaults to true)
          const isSelected = t.selected !== false;
          if (t.match && isSelected) {
            // Include missing data even for matched tracks so they can be refined later
            return { songId: t.match.id, missing: missingData };
          } else {
            // Unmatched or deselected tracks become missing entries
            return {
              songId: null,
              missing: missingData,
            };
          }
        });

        const response = await client.importPlaylist({
          name: playlistName.trim(),
          comment: null,
          entries,
          folderId: folderId ?? null,
        });

        return {
          matchedCount: response.matchedCount,
          missingCount: response.missingCount,
        };
      }

      // Standard import - only matched AND selected tracks
      const matchedSongIds = matchedTracks
        .filter((t) => t.match && t.selected !== false)
        .map((t) => t.match!.id);

      if (matchedSongIds.length === 0) {
        throw new Error("No tracks to import");
      }

      // Create playlist with all matched songs
      // We need to create empty playlist first, then add songs
      const response = await client.createPlaylist({
        name: playlistName.trim(),
      });
      const playlistId = response.playlist?.id;

      if (!playlistId) {
        throw new Error("Failed to create playlist");
      }

      // Add songs to playlist
      await client.updatePlaylist({
        playlistId,
        songIdToAdd: matchedSongIds,
      });

      return { matchedCount: matchedSongIds.length, missingCount: 0 };
    },
    onSuccess: async (data) => {
      // Save matches to dictionary for future reuse
      await saveMatchesToDictionary(matchedTracks);
      if (data.missingCount > 0) {
        toast.success(
          `Playlist "${playlistName}" created with ${data.matchedCount} matched tracks and ${data.missingCount} missing entries`,
        );
      } else {
        toast.success(
          `Playlist "${playlistName}" created with ${data.matchedCount} songs`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      resetAndClose();
    },
    onError: (error) => {
      toast.error(
        `Failed to create playlist: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    },
  });

  // Build search text for missing entries (for server-side filtering)
  const buildSearchText = (parsed: {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    raw?: string | null;
  }) => {
    const parts: string[] = [];
    if (parsed.artist) parts.push(parsed.artist);
    if (parsed.album) parts.push(parsed.album);
    if (parsed.title) parts.push(parsed.title);
    return parts.join(" - ").trim() || parsed.raw || "";
  };

  // Download unmatched or unselected tracks in the same format as the original file
  const downloadUnmatched = () => {
    const unmatchedIndices = matchedTracks
      .map((t, i) => (!t.match || t.selected === false ? i : -1))
      .filter((i) => i >= 0);
    if (unmatchedIndices.length === 0) return;

    // Get the original ParsedTrack objects by index for proper export
    const unmatchedParsed = unmatchedIndices.map((i) => parsedTracks[i]);

    // Export using the original format
    const content = exportOriginalLines(
      unmatchedParsed,
      originalFormat,
      originalHeaderLine,
    );

    const mimeType = getFormatMimeType(originalFormat);
    const extension = getFormatExtension(originalFormat);

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${playlistName}_unmatched${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const matchedCount = matchedTracks.filter((t) => t.match).length;
  const unmatchedCount = matchedTracks.filter((t) => !t.match).length;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="w-[95vw] max-w-[1200px] h-[90vh] max-h-[90vh] flex flex-col"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleCloseRequest();
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Import Playlist
            </DialogTitle>
            <DialogDescription>
              Import a playlist from M3U, PLS, or CSV file. Tracks will be
              matched against your library.
            </DialogDescription>
          </DialogHeader>

          {step === "upload" && (
            <>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/25",
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".m3u,.m3u8,.pls,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
                <FileMusic className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium mb-1">
                  Drop your playlist file here
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  Supports M3U, M3U8, PLS, and CSV formats
                </p>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Browse Files
                </Button>
              </div>

              {/* Search options */}
              <div className="mt-4">
                <SearchOptionsControl
                  options={searchOptions}
                  onChange={setSearchOptions}
                />
              </div>
            </>
          )}

          {step === "matching" && (
            <MatchingProgress
              tracksCount={parsedTracks.length}
              progress={matchingProgress}
            />
          )}

          {step === "preview" && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="grid gap-4 py-4 shrink-0">
                <div className="grid gap-2">
                  <Label htmlFor="import-name">Playlist Name</Label>
                  <Input
                    id="import-name"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    placeholder="My Imported Playlist"
                  />
                </div>

                {/* Search options - can be changed after file selection */}
                <SearchOptionsControl
                  options={searchOptions}
                  onChange={setSearchOptions}
                  onRematch={() => doMatchTracks(parsedTracks)}
                  isMatching={isMatching}
                  showRematch
                />

                {/* Match summary */}
                <MatchSummary
                  matchedCount={matchedCount}
                  unmatchedCount={unmatchedCount}
                />

                {/* Include missing entries option */}
                {unmatchedCount > 0 && (
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="include-missing"
                      checked={includeMissing}
                      onCheckedChange={(checked) =>
                        setIncludeMissing(checked === true)
                      }
                    />
                    <label
                      htmlFor="include-missing"
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      Include missing entries in playlist
                    </label>
                    <span className="text-xs text-muted-foreground">
                      (you can match them later from playlist details)
                    </span>
                  </div>
                )}
              </div>

              {/* Track list */}
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

          {step === "importing" && (
            <div className="py-8 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-lg font-medium">Creating playlist...</p>
            </div>
          )}

          <DialogFooter className="shrink-0">
            {step === "preview" && unmatchedCount > 0 && (
              <Button
                variant="outline"
                className="mr-auto"
                onClick={downloadUnmatched}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Unmatched
              </Button>
            )}

            <Button variant="outline" onClick={handleCloseRequest}>
              Cancel
            </Button>

            {step === "preview" && (
              <Button
                onClick={() => {
                  setStep("importing");
                  createPlaylist.mutate();
                }}
                disabled={
                  !playlistName.trim() ||
                  (matchedCount === 0 &&
                    (!includeMissing || unmatchedCount === 0)) ||
                  createPlaylist.isPending
                }
              >
                {createPlaylist.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : includeMissing && unmatchedCount > 0 ? (
                  <>Import {matchedCount + unmatchedCount} Entries</>
                ) : (
                  <>Import {matchedCount} Tracks</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog for closing with unsaved changes */}
      <AlertDialog
        open={confirmCloseDialogOpen}
        onOpenChange={setConfirmCloseDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have matched {matchedCount} tracks that haven&apos;t been
              imported yet. Are you sure you want to close and discard your
              progress?
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
