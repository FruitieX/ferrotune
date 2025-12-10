"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Check, X, AlertCircle, Music, Loader2, RefreshCw } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import { TrackSearchPanel } from "./track-search-panel";

// Parsed track info - can come from import or from missing entry data
export interface ParsedTrackInfo {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
  raw?: string | null;
}

// Minimal song info for matching (doesn't need full Song type)
export interface MatchedSongInfo {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
}

// A track that can be matched
export interface MatchableTrack {
  parsed: ParsedTrackInfo;
  match: MatchedSongInfo | null;
  matchScore: number;
  // Whether this track is locked (already matched in playlist, not editable)
  locked?: boolean;
  // Position in playlist (for display)
  position?: number;
  // Original position in source data (for saving)
  originalPosition?: number;
}

export interface SearchOptions {
  useTitle: boolean;
  useArtist: boolean;
  useAlbum: boolean;
}

// Levenshtein distance
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Simple string similarity (case-insensitive)
function stringSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();

  if (aLower === bLower) return 1;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.9;

  // Levenshtein-based similarity
  const maxLen = Math.max(aLower.length, bLower.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(aLower, bLower);
  return 1 - distance / maxLen;
}

// Calculate match score between parsed track and library song
export function calculateMatchScore(
  parsed: ParsedTrackInfo,
  song: Song,
): number {
  let score = 0;
  let factors = 0;

  if (parsed.title && song.title) {
    const similarity = stringSimilarity(parsed.title, song.title);
    score += similarity * 2; // Title is weighted more
    factors += 2;
  }

  if (parsed.artist && song.artist) {
    const similarity = stringSimilarity(parsed.artist, song.artist);
    score += similarity;
    factors += 1;
  }

  if (parsed.album && song.album) {
    const similarity = stringSimilarity(parsed.album, song.album);
    score += similarity * 0.5;
    factors += 0.5;
  }

  return factors > 0 ? score / factors : 0;
}

// Build search query from parsed track in "artist - album - title" format
export function buildTrackSearchQuery(
  parsed: ParsedTrackInfo,
  options: SearchOptions,
): string {
  const parts: string[] = [];
  if (options.useArtist && parsed.artist) parts.push(parsed.artist);
  if (options.useAlbum && parsed.album) parts.push(parsed.album);
  if (options.useTitle && parsed.title) parts.push(parsed.title);
  return parts.join(" - ").trim() || parsed.raw || "";
}

interface MatchingProgressProps {
  tracksCount: number;
  progress: number;
}

export function MatchingProgress({
  tracksCount,
  progress,
}: MatchingProgressProps) {
  return (
    <div className="py-8 text-center">
      <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
      <p className="text-lg font-medium mb-2">Matching tracks...</p>
      <p className="text-sm text-muted-foreground mb-4">
        Searching your library for {tracksCount} tracks
      </p>
      <Progress value={progress} className="w-full" />
      <p className="text-sm text-muted-foreground mt-2">{progress}%</p>
    </div>
  );
}

interface SearchOptionsControlProps {
  options: SearchOptions;
  onChange: (options: SearchOptions) => void;
  onRematch?: () => void;
  isMatching?: boolean;
  showRematch?: boolean;
}

export function SearchOptionsControl({
  options,
  onChange,
  onRematch,
  isMatching,
  showRematch = false,
}: SearchOptionsControlProps) {
  return (
    <div className="p-4 rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">Search options</p>
        {showRematch && onRematch && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRematch}
            disabled={isMatching}
            className="h-7"
          >
            {isMatching ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Re-match
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {showRematch
          ? "Choose which fields to use when matching tracks, then click Re-match"
          : "Choose which fields to use when matching tracks against your library"}
      </p>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="search-title"
            checked={options.useTitle}
            onCheckedChange={(checked) =>
              onChange({ ...options, useTitle: checked === true })
            }
          />
          <label
            htmlFor="search-title"
            className="text-sm font-medium leading-none cursor-pointer"
          >
            Title
          </label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="search-artist"
            checked={options.useArtist}
            onCheckedChange={(checked) =>
              onChange({ ...options, useArtist: checked === true })
            }
          />
          <label
            htmlFor="search-artist"
            className="text-sm font-medium leading-none cursor-pointer"
          >
            Artist
          </label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="search-album"
            checked={options.useAlbum}
            onCheckedChange={(checked) =>
              onChange({ ...options, useAlbum: checked === true })
            }
          />
          <label
            htmlFor="search-album"
            className="text-sm font-medium leading-none cursor-pointer"
          >
            Album
          </label>
        </div>
      </div>
    </div>
  );
}

interface MatchSummaryProps {
  matchedCount: number;
  unmatchedCount: number;
  lockedCount?: number;
}

export function MatchSummary({
  matchedCount,
  unmatchedCount,
  lockedCount = 0,
}: MatchSummaryProps) {
  return (
    <div className="flex gap-4">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="default" className="bg-green-500">
          <Check className="w-3 h-3 mr-1" />
          {matchedCount} matched
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="secondary" className="bg-orange-500/20 text-orange-500">
          <AlertCircle className="w-3 h-3 mr-1" />
          {unmatchedCount} not found
        </Badge>
      </div>
      {lockedCount > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{lockedCount} already matched</Badge>
        </div>
      )}
    </div>
  );
}

interface TrackListProps {
  tracks: MatchableTrack[];
  onUpdateMatch: (
    index: number,
    match: MatchedSongInfo | null,
    score: number,
  ) => void;
  showPosition?: boolean;
}

export function TrackList({
  tracks,
  onUpdateMatch,
  showPosition,
}: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Music className="w-6 h-6 mr-2" />
        No tracks
      </div>
    );
  }

  return (
    <ScrollArea className="h-[300px] rounded-md border">
      <div className="p-2">
        {tracks.map((track, index) => (
          <TrackRow
            key={index}
            track={track}
            index={index}
            onUpdateMatch={onUpdateMatch}
            showPosition={showPosition}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

interface TrackRowProps {
  track: MatchableTrack;
  index: number;
  onUpdateMatch: (
    index: number,
    match: MatchedSongInfo | null,
    score: number,
  ) => void;
  showPosition?: boolean;
}

export function TrackRow({
  track,
  index,
  onUpdateMatch,
  showPosition,
}: TrackRowProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  const handleConfirm = (song: Song) => {
    onUpdateMatch(index, song, 1); // Manual selection = 100% match
    setSearchOpen(false);
  };

  const handleClearMatch = () => {
    onUpdateMatch(index, null, 0);
    setSearchOpen(false);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 rounded-md group",
        track.locked && "opacity-60",
        track.match ? "hover:bg-accent/50" : "bg-orange-500/10",
      )}
    >
      {/* Position number */}
      {showPosition && track.position !== undefined && (
        <div className="shrink-0 w-6 text-center text-xs text-muted-foreground tabular-nums">
          {track.position + 1}
        </div>
      )}

      <div className="shrink-0">
        {track.match ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <X className="w-4 h-4 text-orange-500" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {track.parsed.title || track.parsed.raw || "Unknown"}
        </div>
        {(track.parsed.artist || track.parsed.album) && (
          <div className="text-sm text-muted-foreground truncate">
            {track.parsed.artist}
            {track.parsed.artist && track.parsed.album && " • "}
            {track.parsed.album}
          </div>
        )}
        {track.matchScore > 0 && track.matchScore < 1 && (
          <Badge variant="outline" className="text-xs mt-1">
            {Math.round(track.matchScore * 100)}% match
          </Badge>
        )}
      </div>

      {track.match && (
        <div className="text-right text-sm truncate max-w-[200px]">
          <div className="font-medium truncate">{track.match.title}</div>
          <div className="text-muted-foreground text-xs truncate">
            {track.match.artist}
            {track.match.artist && track.match.album && " • "}
            {track.match.album}
          </div>
        </div>
      )}

      {!track.locked && (
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[500px] p-3" align="end">
            <div className="space-y-3">
              <div className="font-medium text-sm">Find alternative match</div>

              {searchOpen && (
                <TrackSearchPanel
                  parsed={{
                    title: track.parsed.title,
                    artist: track.parsed.artist,
                    album: track.parsed.album,
                    raw: track.parsed.raw,
                  }}
                  onConfirm={handleConfirm}
                  idPrefix={`track-row-${index}-`}
                  autoSearch={true}
                />
              )}

              {track.match && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleClearMatch}
                >
                  <X className="w-3.5 h-3.5 mr-2" />
                  Remove match
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

interface TabbedTrackListProps {
  tracks: MatchableTrack[];
  onUpdateMatch: (
    originalIndex: number,
    match: MatchedSongInfo | null,
    score: number,
  ) => void;
  showPosition?: boolean;
  showLockedTab?: boolean;
}

export function TabbedTrackList({
  tracks,
  onUpdateMatch,
  showPosition,
  showLockedTab = false,
}: TabbedTrackListProps) {
  // Separate tracks
  const editableTracks = tracks.filter((t) => !t.locked);
  const lockedTracks = tracks.filter((t) => t.locked);
  const matchedTracks = editableTracks.filter((t) => t.match);
  const unmatchedTracks = editableTracks.filter((t) => !t.match);

  // Helper to find original index when updating a filtered list
  const getOriginalIndex = (
    filteredList: MatchableTrack[],
    filteredIndex: number,
  ): number => {
    const track = filteredList[filteredIndex];
    return tracks.findIndex((t) => t === track);
  };

  const defaultTab = unmatchedTracks.length > 0 ? "unmatched" : "all";

  return (
    <Tabs defaultValue={defaultTab} className="flex-1 min-h-0">
      <TabsList
        className={cn(
          "grid w-full",
          showLockedTab && lockedTracks.length > 0
            ? "grid-cols-4"
            : "grid-cols-3",
        )}
      >
        <TabsTrigger value="all">All ({editableTracks.length})</TabsTrigger>
        <TabsTrigger value="matched">
          Matched ({matchedTracks.length})
        </TabsTrigger>
        <TabsTrigger value="unmatched">
          Not Found ({unmatchedTracks.length})
        </TabsTrigger>
        {showLockedTab && lockedTracks.length > 0 && (
          <TabsTrigger value="locked">
            Already Matched ({lockedTracks.length})
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="all" className="flex-1 mt-2">
        <TrackList
          tracks={editableTracks}
          onUpdateMatch={(idx, match, score) =>
            onUpdateMatch(getOriginalIndex(editableTracks, idx), match, score)
          }
          showPosition={showPosition}
        />
      </TabsContent>
      <TabsContent value="matched" className="flex-1 mt-2">
        <TrackList
          tracks={matchedTracks}
          onUpdateMatch={(idx, match, score) =>
            onUpdateMatch(getOriginalIndex(matchedTracks, idx), match, score)
          }
          showPosition={showPosition}
        />
      </TabsContent>
      <TabsContent value="unmatched" className="flex-1 mt-2">
        <TrackList
          tracks={unmatchedTracks}
          onUpdateMatch={(idx, match, score) =>
            onUpdateMatch(getOriginalIndex(unmatchedTracks, idx), match, score)
          }
          showPosition={showPosition}
        />
      </TabsContent>
      {showLockedTab && lockedTracks.length > 0 && (
        <TabsContent value="locked" className="flex-1 mt-2">
          <TrackList
            tracks={lockedTracks}
            onUpdateMatch={() => {}} // No-op for locked tracks
            showPosition={showPosition}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

// Hook to perform automatic matching with parallel batch processing
export function useTrackMatcher() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const matchTracks = async (
    tracks: ParsedTrackInfo[],
    searchOptions: SearchOptions,
    onProgress: (progress: number) => void,
  ): Promise<MatchableTrack[] | null> => {
    // Cancel any previous matching operation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this operation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const client = getClient();
    if (!client) {
      toast.error("Not connected to server");
      return null;
    }

    // Process a single track
    const processTrack = async (
      track: ParsedTrackInfo,
    ): Promise<MatchableTrack> => {
      const query = buildTrackSearchQuery(track, searchOptions);

      if (!query) {
        return { parsed: track, match: null, matchScore: 0 };
      }

      try {
        const response = await client.search3({ query, songCount: 10 });

        if (abortController.signal.aborted) {
          throw new Error("Aborted");
        }

        const songs = response.searchResult3?.song ?? [];

        // Find best match
        let bestMatch: Song | null = null;
        let bestScore = 0;

        for (const song of songs) {
          const score = calculateMatchScore(track, song);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = song;
          }
        }

        // Only accept matches above threshold
        if (bestScore >= 0.5) {
          return { parsed: track, match: bestMatch, matchScore: bestScore };
        } else {
          return { parsed: track, match: null, matchScore: 0 };
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          throw error;
        }
        console.error("Search error:", error);
        return { parsed: track, match: null, matchScore: 0 };
      }
    };

    // Process tracks in parallel batches
    const BATCH_SIZE = 5; // Process 5 tracks concurrently
    const results: MatchableTrack[] = new Array(tracks.length);
    let completedCount = 0;

    for (
      let batchStart = 0;
      batchStart < tracks.length;
      batchStart += BATCH_SIZE
    ) {
      if (abortController.signal.aborted) {
        return null;
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, tracks.length);
      const batchTracks = tracks.slice(batchStart, batchEnd);

      try {
        // Process batch in parallel
        const batchResults = await Promise.all(
          batchTracks.map((track, i) =>
            processTrack(track).then((result) => ({
              index: batchStart + i,
              result,
            })),
          ),
        );

        // Store results in correct positions
        for (const { index, result } of batchResults) {
          results[index] = result;
        }

        completedCount += batchTracks.length;
        onProgress(Math.round((completedCount / tracks.length) * 100));
      } catch (_error) {
        if (abortController.signal.aborted) {
          return null;
        }
        // If batch fails, process remaining tracks individually
        for (let i = 0; i < batchTracks.length; i++) {
          if (!results[batchStart + i]) {
            results[batchStart + i] = {
              parsed: batchTracks[i],
              match: null,
              matchScore: 0,
            };
          }
        }
        completedCount += batchTracks.length;
        onProgress(Math.round((completedCount / tracks.length) * 100));
      }
    }

    return results;
  };

  const cancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  return { matchTracks, cancel };
}
