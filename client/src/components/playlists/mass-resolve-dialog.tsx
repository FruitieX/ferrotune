"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Music, AlertCircle, Loader2, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import type { PlaylistEntryResponse } from "@/lib/api/generated/PlaylistEntryResponse";

interface MassResolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  entries: PlaylistEntryResponse[];
}

type ResolveStatus = "pending" | "matched" | "skipped";

interface MissingEntryState {
  entry: PlaylistEntryResponse;
  status: ResolveStatus;
  matchedSongId?: string;
  matchedSong?: Song;
  searchResults: Song[];
  searchQuery: string;
  isSearching: boolean;
  isExpanded: boolean;
}

export function MassResolveDialog({
  open,
  onOpenChange,
  playlistId,
  entries,
}: MassResolveDialogProps) {
  const queryClient = useQueryClient();

  // Initialize state for all missing entries
  const initialState = (): MissingEntryState[] => {
    return entries
      .filter((entry) => entry.missing)
      .map((entry) => ({
        entry,
        status: "pending" as ResolveStatus,
        searchResults: [],
        searchQuery: buildSearchQuery(entry),
        isSearching: false,
        isExpanded: false,
      }));
  };

  const [missingEntries, setMissingEntries] = useState<MissingEntryState[]>(initialState);
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setMissingEntries(initialState());
    }
    onOpenChange(newOpen);
  };

  // Build search query from entry in "artist - album - title" format
  function buildSearchQuery(entry: PlaylistEntryResponse): string {
    if (!entry.missing) return "";
    const parts: string[] = [];
    if (entry.missing.artist) parts.push(entry.missing.artist);
    if (entry.missing.album) parts.push(entry.missing.album);
    if (entry.missing.title) parts.push(entry.missing.title);
    return parts.join(" - ").trim() || entry.missing.raw || "";
  }

  // Search for a specific entry
  const handleSearch = async (index: number) => {
    const entry = missingEntries[index];
    if (!entry.searchQuery.trim()) return;

    setMissingEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, isSearching: true, isExpanded: true } : e))
    );

    try {
      const client = getClient();
      if (!client) return;

      const response = await client.search3({ query: entry.searchQuery.trim(), songCount: 10 });
      setMissingEntries((prev) =>
        prev.map((e, i) =>
          i === index ? { ...e, searchResults: response.searchResult3?.song ?? [], isSearching: false } : e
        )
      );
    } catch (error) {
      console.error("Search error:", error);
      setMissingEntries((prev) => prev.map((e, i) => (i === index ? { ...e, isSearching: false } : e)));
    }
  };

  // Select a match for an entry
  const handleSelectMatch = (index: number, song: Song) => {
    setMissingEntries((prev) =>
      prev.map((e, i) =>
        i === index
          ? { ...e, status: "matched", matchedSongId: song.id, matchedSong: song }
          : e
      )
    );
  };

  // Clear match for an entry
  const handleClearMatch = (index: number) => {
    setMissingEntries((prev) =>
      prev.map((e, i) =>
        i === index
          ? { ...e, status: "pending", matchedSongId: undefined, matchedSong: undefined }
          : e
      )
    );
  };

  // Skip an entry
  const handleSkip = (index: number) => {
    setMissingEntries((prev) =>
      prev.map((e, i) =>
        i === index
          ? { ...e, status: "skipped", matchedSongId: undefined, matchedSong: undefined }
          : e
      )
    );
  };

  // Toggle expanded state
  const handleToggleExpanded = (index: number) => {
    setMissingEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, isExpanded: !e.isExpanded } : e))
    );
  };

  // Update search query
  const handleUpdateSearchQuery = (index: number, query: string) => {
    setMissingEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, searchQuery: query } : e))
    );
  };

  // Save all matches
  const handleSave = async () => {
    const matchedEntries = missingEntries.filter(
      (e) => e.status === "matched" && e.matchedSongId
    );

    if (matchedEntries.length === 0) {
      toast.info("No matches to save");
      return;
    }

    setIsSaving(true);
    try {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Submit all matches
      let successCount = 0;
      let failCount = 0;

      for (const entry of matchedEntries) {
        try {
          await client.matchMissingEntry(playlistId, entry.entry.position, entry.matchedSongId!);
          successCount++;
        } catch (error) {
          console.error(`Failed to match entry at position ${entry.entry.position}:`, error);
          failCount++;
        }
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlistEntries", playlistId] });

      if (failCount === 0) {
        toast.success(`Matched ${successCount} ${successCount === 1 ? "entry" : "entries"}`);
      } else {
        toast.warning(
          `Matched ${successCount} ${successCount === 1 ? "entry" : "entries"}, ${failCount} failed`
        );
      }

      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to save matches");
    } finally {
      setIsSaving(false);
    }
  };

  // Count statistics
  const totalCount = missingEntries.length;
  const matchedCount = missingEntries.filter((e) => e.status === "matched").length;
  const skippedCount = missingEntries.filter((e) => e.status === "skipped").length;
  const pendingCount = totalCount - matchedCount - skippedCount;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Resolve Missing Entries</DialogTitle>
          <DialogDescription>
            Search and match missing playlist entries to songs in your library.
          </DialogDescription>
        </DialogHeader>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">{totalCount} missing</span>
          <span className="text-green-500 flex items-center gap-1">
            <Check className="w-3 h-3" />
            {matchedCount} matched
          </span>
          <span className="text-orange-500 flex items-center gap-1">
            <X className="w-3 h-3" />
            {skippedCount} skipped
          </span>
          <span className="text-muted-foreground">{pendingCount} pending</span>
        </div>

        {/* Entry list */}
        <ScrollArea className="flex-1 -mx-6 px-6 max-h-[60vh]">
          <div className="space-y-2 py-2">
            {missingEntries.map((entry, index) => (
              <div
                key={entry.entry.position}
                className={cn(
                  "border rounded-lg overflow-hidden",
                  entry.status === "matched" && "border-green-500/50 bg-green-500/5",
                  entry.status === "skipped" && "border-muted bg-muted/30"
                )}
              >
                {/* Entry header */}
                <button
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/50 transition-colors"
                  onClick={() => handleToggleExpanded(index)}
                >
                  {entry.isExpanded ? (
                    <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                  )}

                  <div className="w-6 text-center text-xs text-muted-foreground">
                    {entry.entry.position + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-sm">
                      {entry.entry.missing?.title || "Unknown Track"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {entry.entry.missing?.artist || "Unknown Artist"}
                      {entry.entry.missing?.album && ` • ${entry.entry.missing.album}`}
                    </div>
                  </div>

                  {/* Status indicator */}
                  {entry.status === "matched" && entry.matchedSong && (
                    <div className="flex items-center gap-2 text-xs text-green-500">
                      <Check className="w-3 h-3" />
                      <span className="truncate max-w-[150px]">{entry.matchedSong.title}</span>
                    </div>
                  )}
                  {entry.status === "skipped" && (
                    <div className="flex items-center gap-1 text-xs text-orange-500">
                      <X className="w-3 h-3" />
                      Skipped
                    </div>
                  )}
                </button>

                {/* Expanded content */}
                {entry.isExpanded && (
                  <div className="border-t p-3 space-y-3">
                    {/* Search input */}
                    <div className="flex gap-2">
                      <Input
                        value={entry.searchQuery}
                        onChange={(e) => handleUpdateSearchQuery(index, e.target.value)}
                        placeholder="Search for track..."
                        className="h-8"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSearch(index);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSearch(index)}
                        disabled={entry.isSearching || !entry.searchQuery.trim()}
                        className="h-8"
                      >
                        {entry.isSearching ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {/* Search results */}
                    {entry.searchResults.length > 0 && (
                      <div className="space-y-1 max-h-[200px] overflow-y-auto">
                        {entry.searchResults.map((song) => (
                          <button
                            key={song.id}
                            className={cn(
                              "w-full text-left p-2 rounded hover:bg-accent text-sm flex items-center gap-2",
                              entry.matchedSongId === song.id && "bg-green-500/20 hover:bg-green-500/30"
                            )}
                            onClick={() => handleSelectMatch(index, song)}
                          >
                            <Music className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{song.title}</div>
                              <div className="text-muted-foreground text-xs truncate">
                                {song.artist}
                                {song.album ? ` • ${song.album}` : ""}
                              </div>
                            </div>
                            {entry.matchedSongId === song.id && (
                              <Check className="w-4 h-4 text-green-500 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      {entry.status === "matched" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleClearMatch(index)}
                          className="text-muted-foreground"
                        >
                          Clear match
                        </Button>
                      ) : entry.status === "skipped" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleClearMatch(index)}
                          className="text-muted-foreground"
                        >
                          Unskip
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSkip(index)}
                          className="text-orange-500"
                        >
                          <X className="w-3 h-3 mr-1" />
                          Skip
                        </Button>
                      )}

                      {/* Original raw text */}
                      {entry.entry.missing?.raw && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          Original: {entry.entry.missing.raw}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={matchedCount === 0 || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              `Save ${matchedCount} ${matchedCount === 1 ? "match" : "matches"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
