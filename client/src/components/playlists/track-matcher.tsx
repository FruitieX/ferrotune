"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Check,
  X,
  AlertCircle,
  Music,
  Loader2,
  RefreshCw,
  Search,
  History,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  formatDurationMs,
  getDurationDeltaStyle,
} from "@/lib/utils/format";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import type { TrackToMatch } from "@/lib/api/generated/TrackToMatch";
import { TrackSearchPanel } from "./track-search-panel";

// Virtualization constants
const TRACK_ROW_HEIGHT = 80; // Height of each track row in pixels
const TRACK_ROW_OVERSCAN = 5; // Extra items to render above/below viewport

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
  // Whether this match came from the user's prior matches dictionary
  fromDictionary?: boolean;
  // Whether this track is locked (already matched in playlist, not editable)
  locked?: boolean;
  // Position in playlist (for display)
  position?: number;
  // Original position in source data (for saving) - deprecated, use entryId
  originalPosition?: number;
  // Unique entry ID for the playlist entry (stable across reordering)
  entryId?: string;
  // Whether this matched track should be saved with its match (defaults to true when matched)
  selected?: boolean;
}

export interface SearchOptions {
  useTitle: boolean;
  useArtist: boolean;
  useAlbum: boolean;
  /** Whether to use previously matched tracks from the user's match dictionary */
  usePriorMatches: boolean;
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
        <div className="flex items-center space-x-2">
          <Checkbox
            id="search-prior-matches"
            checked={options.usePriorMatches}
            onCheckedChange={(checked) =>
              onChange({ ...options, usePriorMatches: checked === true })
            }
          />
          <label
            htmlFor="search-prior-matches"
            className="text-sm font-medium leading-none cursor-pointer flex items-center gap-1"
          >
            <History className="w-3 h-3" />
            Use prior matches
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
  /** Toggle selection for a track */
  onToggleSelection?: (index: number, selected: boolean) => void;
  /** Toggle selection for all tracks in the list */
  onToggleAllSelection?: (selected: boolean) => void;
  showPosition?: boolean;
  /** Show checkboxes for matched tracks */
  showCheckboxes?: boolean;
  /** Render additional info for each track (e.g., play counts) */
  renderTrackExtra?: (track: MatchableTrack) => React.ReactNode;
}

export function TrackList({
  tracks,
  onUpdateMatch,
  onToggleSelection,
  onToggleAllSelection,
  showPosition,
  showCheckboxes = false,
  renderTrackExtra,
}: TrackListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TRACK_ROW_HEIGHT,
    overscan: TRACK_ROW_OVERSCAN,
  });

  if (tracks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Music className="w-6 h-6 mr-2" />
        No tracks
      </div>
    );
  }

  // Count matched and selected tracks for header checkbox state
  const matchedTracks = tracks.filter((t) => t.match && !t.locked);
  const selectedCount = matchedTracks.filter(
    (t) => t.selected !== false,
  ).length;
  const allSelected =
    matchedTracks.length > 0 && selectedCount === matchedTracks.length;
  const someSelected =
    selectedCount > 0 && selectedCount < matchedTracks.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-md border">
      {/* Header row */}
      {showCheckboxes && matchedTracks.length > 0 && (
        <div className="flex items-center gap-3 p-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground shrink-0">
          {/* Checkbox column */}
          <div className="shrink-0 w-6 flex items-center justify-center">
            <Checkbox
              checked={allSelected}
              ref={(ref) => {
                if (ref) {
                  // Set indeterminate state when some but not all are selected
                  (ref as unknown as HTMLInputElement).indeterminate =
                    someSelected;
                }
              }}
              onCheckedChange={(checked) => {
                onToggleAllSelection?.(checked === true);
              }}
              aria-label={allSelected ? "Deselect all" : "Select all"}
            />
          </div>
          {/* Position number column */}
          {showPosition && <div className="shrink-0 w-6" />}
          {/* Status icon column */}
          <div className="shrink-0 w-4" />
          {/* Source track column */}
          <div className="flex-1 min-w-0">Source Track</div>
          {/* Arrow column */}
          <div className="shrink-0 w-6" />
          {/* Matched track column */}
          <div className="flex-1 min-w-0 text-right">Matched To</div>
          {/* Action button column */}
          <div className="shrink-0 w-7" />
        </div>
      )}
      {/* Virtualized list */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => (
            <div
              key={virtualItem.key}
              className="absolute left-0 right-0 px-2"
              style={{
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <TrackRow
                track={tracks[virtualItem.index]}
                index={virtualItem.index}
                onUpdateMatch={onUpdateMatch}
                onToggleSelection={onToggleSelection}
                showPosition={showPosition}
                showCheckbox={showCheckboxes}
                renderTrackExtra={renderTrackExtra}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
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
  onToggleSelection?: (index: number, selected: boolean) => void;
  showPosition?: boolean;
  showCheckbox?: boolean;
  /** Render additional info for each track (e.g., play counts) */
  renderTrackExtra?: (track: MatchableTrack) => React.ReactNode;
}

export function TrackRow({
  track,
  index,
  onUpdateMatch,
  onToggleSelection,
  showPosition,
  showCheckbox = false,
  renderTrackExtra,
}: TrackRowProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  // Default to selected if not explicitly set
  const isSelected = track.selected !== false;

  const handleConfirm = (song: Song) => {
    // Preserve the original match score when manually re-matching
    // This prevents the track from disappearing when confidence filters are enabled
    onUpdateMatch(index, song, track.matchScore || 1);
    // Auto-select the track when manually matching
    if (onToggleSelection) {
      onToggleSelection(index, true);
    }
    setSearchOpen(false);
  };

  const handleClearMatch = () => {
    onUpdateMatch(index, null, 0);
    setSearchOpen(false);
  };

  // Handle row click to toggle checkbox (only for matched, non-locked tracks)
  const handleRowClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking on the popover trigger button or if track has no match/is locked
    if (!track.match || track.locked || !onToggleSelection) return;

    // Check if the click originated from the checkbox or popover area
    const target = e.target as HTMLElement;
    const isCheckboxClick = target.closest('[role="checkbox"]');
    const isPopoverClick =
      target.closest("[data-radix-popper-content-wrapper]") ||
      target.closest("[data-popover-trigger]");

    if (isCheckboxClick || isPopoverClick) return;

    onToggleSelection(index, !isSelected);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 rounded-md group",
        track.locked && "opacity-60",
        track.match ? "hover:bg-accent/50 cursor-pointer" : "bg-orange-500/10",
      )}
      style={{ minHeight: TRACK_ROW_HEIGHT - 4 }} // Fixed height for virtualization (minus padding)
      onClick={handleRowClick}
    >
      {/* Checkbox for matched tracks */}
      {showCheckbox && track.match && !track.locked && (
        <div className="shrink-0 w-6 flex items-center justify-center">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => {
              onToggleSelection?.(index, checked === true);
            }}
            aria-label={isSelected ? "Deselect track" : "Select track"}
          />
        </div>
      )}
      {/* Spacer for non-matched tracks when checkboxes are shown */}
      {showCheckbox && (!track.match || track.locked) && (
        <div className="shrink-0 w-6" />
      )}

      {/* Position number */}
      {showPosition && track.position !== undefined && (
        <div className="shrink-0 w-6 text-center text-xs text-muted-foreground tabular-nums">
          {track.position + 1}
        </div>
      )}

      <div className="shrink-0">
        {track.match ? (
          <Check
            className={cn(
              "w-4 h-4",
              isSelected ? "text-green-500" : "text-muted-foreground",
            )}
          />
        ) : (
          <X className="w-4 h-4 text-orange-500" />
        )}
      </div>

      <div className="flex-1 text-sm min-w-0">
        <div className="font-medium truncate">
          {track.parsed.title || track.parsed.raw || "Unknown"}
        </div>
        {(track.parsed.artist ||
          track.parsed.album ||
          track.parsed.duration) && (
          <div className="text-muted-foreground text-xs truncate">
            {track.parsed.artist}
            {track.parsed.artist && track.parsed.album && " • "}
            {track.parsed.album}
            {track.parsed.duration && track.parsed.duration > 0 && (
              <span className="ml-1">
                ({formatDurationMs(track.parsed.duration)})
              </span>
            )}
          </div>
        )}
        {track.matchScore > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                track.matchScore >= 0.9
                  ? "border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30"
                  : track.matchScore >= 0.8
                    ? "border-yellow-500 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30"
                    : track.matchScore >= 0.7
                      ? "border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/30"
                      : "border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30",
              )}
            >
              {Math.round(track.matchScore * 100)}% match
            </Badge>
            {track.fromDictionary && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-purple-100 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400">
                    <History className="w-3 h-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Matched using your prior matches
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {/* Extra info (e.g., play counts) */}
      {renderTrackExtra && (
        <div className="shrink-0 text-right text-sm text-muted-foreground">
          {renderTrackExtra(track)}
        </div>
      )}

      {track.match && (
        <>
          <div className="text-muted-foreground shrink-0 px-2">{"->"}</div>
          <div className="text-right text-sm truncate flex-1">
            <div className="font-medium truncate">{track.match.title}</div>
            <div className="text-muted-foreground text-xs truncate">
              {track.match.artist}
              {track.match.artist && track.match.album && " • "}
              {track.match.album}
              {track.match.duration &&
                track.match.duration > 0 &&
                (() => {
                  const durationStyle = getDurationDeltaStyle(
                    track.parsed.duration,
                    track.match.duration,
                  );
                  return (
                    <span
                      className={cn(
                        "ml-1 px-1 rounded",
                        durationStyle.className,
                        durationStyle.bgClassName,
                      )}
                    >
                      ({formatDuration(track.match.duration)})
                    </span>
                  );
                })()}
            </div>
          </div>
        </>
      )}

      {!track.locked && (
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
              data-popover-trigger
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
                    duration: track.parsed.duration,
                    raw: track.parsed.raw,
                  }}
                  onConfirm={handleConfirm}
                  idPrefix={`track-row-${index}-`}
                  autoSearch={true}
                  showRawText={true}
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
  /** Toggle selection for a track (uses original index) */
  onToggleSelection?: (originalIndex: number, selected: boolean) => void;
  /** Toggle selection for all tracks in a specific list */
  onToggleAllSelection?: (
    trackList: MatchableTrack[],
    selected: boolean,
  ) => void;
  showPosition?: boolean;
  showLockedTab?: boolean;
  /** Show filter by match percentage control */
  showMatchFilter?: boolean;
  /** Show quick text filter for searching tracks */
  showQuickFilter?: boolean;
  /** Show checkboxes for matched tracks */
  showCheckboxes?: boolean;
  /** Render additional info for each track (e.g., play counts) */
  renderTrackExtra?: (track: MatchableTrack) => React.ReactNode;
}

export function TabbedTrackList({
  tracks,
  onUpdateMatch,
  onToggleSelection,
  onToggleAllSelection,
  showPosition,
  showLockedTab = false,
  showMatchFilter = false,
  showQuickFilter = true,
  showCheckboxes = false,
  renderTrackExtra,
}: TabbedTrackListProps) {
  const [maxMatchPercent, setMaxMatchPercent] = useState<number | null>(null);
  const [quickFilter, setQuickFilter] = useState("");

  // Separate tracks
  const editableTracks = tracks.filter((t) => !t.locked);
  const lockedTracks = tracks.filter((t) => t.locked);

  // Helper to check if a track matches the quick filter
  const matchesQuickFilter = (track: MatchableTrack): boolean => {
    if (!quickFilter.trim()) return true;
    const query = quickFilter.toLowerCase();
    const parsed = track.parsed;
    const match = track.match;

    // Check parsed fields
    if (parsed.title?.toLowerCase().includes(query)) return true;
    if (parsed.artist?.toLowerCase().includes(query)) return true;
    if (parsed.album?.toLowerCase().includes(query)) return true;
    if (parsed.raw?.toLowerCase().includes(query)) return true;

    // Check matched song fields
    if (match?.title?.toLowerCase().includes(query)) return true;
    if (match?.artist?.toLowerCase().includes(query)) return true;
    if (match?.album?.toLowerCase().includes(query)) return true;

    return false;
  };

  // Apply quick filter and match percentage filter to matched tracks
  const matchedTracks = editableTracks.filter((t) => {
    if (!t.match) return false;
    if (maxMatchPercent !== null) {
      if (Math.round(t.matchScore * 100) >= maxMatchPercent) return false;
    }
    return matchesQuickFilter(t);
  });

  // Apply quick filter to unmatched tracks
  const unmatchedTracks = editableTracks.filter(
    (t) => !t.match && matchesQuickFilter(t),
  );

  // Apply quick filter for all tab
  const filteredEditableTracks = editableTracks.filter(matchesQuickFilter);

  // Count tracks below 100% for the filter UI
  const belowPerfectCount = editableTracks.filter(
    (t) => t.match && t.matchScore < 1,
  ).length;

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
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Match percentage filter */}
      {showMatchFilter && belowPerfectCount > 0 && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Filter by confidence:</span>
          <div className="flex gap-1">
            <Button
              variant={maxMatchPercent === null ? "default" : "outline"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setMaxMatchPercent(null)}
            >
              All
            </Button>
            <Button
              variant={maxMatchPercent === 100 ? "default" : "outline"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setMaxMatchPercent(100)}
            >
              {"<"}100%
            </Button>
            <Button
              variant={maxMatchPercent === 90 ? "default" : "outline"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setMaxMatchPercent(90)}
            >
              {"<"}90%
            </Button>
            <Button
              variant={maxMatchPercent === 80 ? "default" : "outline"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setMaxMatchPercent(80)}
            >
              {"<"}80%
            </Button>
            <Button
              variant={maxMatchPercent === 70 ? "default" : "outline"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setMaxMatchPercent(70)}
            >
              {"<"}70%
            </Button>
            <Button
              variant={maxMatchPercent === 60 ? "default" : "outline"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setMaxMatchPercent(60)}
            >
              {"<"}60%
            </Button>
          </div>
          {maxMatchPercent !== null && (
            <span className="text-muted-foreground">
              ({matchedTracks.length} tracks)
            </span>
          )}
        </div>
      )}

      {/* Quick filter */}
      {showQuickFilter && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              placeholder="Filter tracks..."
              className="h-8 pl-8 pr-8"
            />
            {quickFilter && (
              <button
                type="button"
                onClick={() => setQuickFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {quickFilter && (
            <span className="text-sm text-muted-foreground">
              {filteredEditableTracks.length} of {editableTracks.length} tracks
            </span>
          )}
        </div>
      )}

      <Tabs defaultValue={defaultTab} className="flex-1 min-h-0 flex flex-col">
        <TabsList
          className={cn(
            "grid w-full shrink-0",
            showLockedTab && lockedTracks.length > 0
              ? "grid-cols-4"
              : "grid-cols-3",
          )}
        >
          <TabsTrigger value="all">
            All (
            {quickFilter
              ? filteredEditableTracks.length
              : editableTracks.length}
            )
          </TabsTrigger>
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

        <TabsContent
          value="all"
          className="flex-1 min-h-0 mt-2 flex flex-col data-[state=inactive]:hidden"
        >
          <TrackList
            tracks={filteredEditableTracks}
            onUpdateMatch={(idx, match, score) =>
              onUpdateMatch(
                getOriginalIndex(filteredEditableTracks, idx),
                match,
                score,
              )
            }
            onToggleSelection={
              onToggleSelection
                ? (idx, selected) =>
                    onToggleSelection(
                      getOriginalIndex(filteredEditableTracks, idx),
                      selected,
                    )
                : undefined
            }
            onToggleAllSelection={
              onToggleAllSelection
                ? (selected) =>
                    onToggleAllSelection(filteredEditableTracks, selected)
                : undefined
            }
            showPosition={showPosition}
            showCheckboxes={showCheckboxes}
            renderTrackExtra={renderTrackExtra}
          />
        </TabsContent>
        <TabsContent
          value="matched"
          className="flex-1 min-h-0 mt-2 flex flex-col data-[state=inactive]:hidden"
        >
          <TrackList
            tracks={matchedTracks}
            onUpdateMatch={(idx, match, score) =>
              onUpdateMatch(getOriginalIndex(matchedTracks, idx), match, score)
            }
            onToggleSelection={
              onToggleSelection
                ? (idx, selected) =>
                    onToggleSelection(
                      getOriginalIndex(matchedTracks, idx),
                      selected,
                    )
                : undefined
            }
            onToggleAllSelection={
              onToggleAllSelection
                ? (selected) => onToggleAllSelection(matchedTracks, selected)
                : undefined
            }
            showPosition={showPosition}
            showCheckboxes={showCheckboxes}
            renderTrackExtra={renderTrackExtra}
          />
        </TabsContent>
        <TabsContent
          value="unmatched"
          className="flex-1 min-h-0 mt-2 flex flex-col data-[state=inactive]:hidden"
        >
          <TrackList
            tracks={unmatchedTracks}
            onUpdateMatch={(idx, match, score) =>
              onUpdateMatch(
                getOriginalIndex(unmatchedTracks, idx),
                match,
                score,
              )
            }
            showPosition={showPosition}
            renderTrackExtra={renderTrackExtra}
          />
        </TabsContent>
        {showLockedTab && lockedTracks.length > 0 && (
          <TabsContent
            value="locked"
            className="flex-1 min-h-0 mt-2 flex flex-col data-[state=inactive]:hidden"
          >
            <TrackList
              tracks={lockedTracks}
              onUpdateMatch={() => {}} // No-op for locked tracks
              showPosition={showPosition}
              renderTrackExtra={renderTrackExtra}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// =============================================================================
// Track matching hook - uses server-side fuzzy matching
// =============================================================================

/** Batch size for server-side matching requests */
const MATCH_BATCH_SIZE = 100;

/**
 * Hook to perform automatic matching using server-side fuzzy matching.
 * Sends tracks in batches to the server for efficient token-based matching.
 */
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

    const results: MatchableTrack[] = [];
    const totalTracks = tracks.length;
    let processedTracks = 0;

    // Process tracks in batches
    for (let i = 0; i < totalTracks; i += MATCH_BATCH_SIZE) {
      if (abortController.signal.aborted) return null;

      const batch = tracks.slice(i, i + MATCH_BATCH_SIZE);

      // Convert to server request format
      const tracksToMatch: TrackToMatch[] = batch.map((track) => ({
        title: track.title ?? null,
        artist: track.artist ?? null,
        album: track.album ?? null,
        duration: track.duration ?? null,
        raw: track.raw ?? null,
      }));

      try {
        const response = await client.matchTracks({
          tracks: tracksToMatch,
          useTitle: searchOptions.useTitle,
          useArtist: searchOptions.useArtist,
          useAlbum: searchOptions.useAlbum,
          usePriorMatches: searchOptions.usePriorMatches,
        });

        if (abortController.signal.aborted) return null;

        // Convert server response to MatchableTrack format
        for (let j = 0; j < batch.length; j++) {
          const track = batch[j];
          const result = response.results[j];

          if (result.song && result.score >= 0.5) {
            results.push({
              parsed: track,
              match: {
                id: result.song.id,
                title: result.song.title,
                artist: result.song.artist ?? null,
                album: result.song.album ?? null,
                duration: result.song.duration ?? null,
              },
              matchScore: result.score,
              fromDictionary: result.fromDictionary ?? false,
              // Auto-select only if match confidence is 90% or higher
              selected: result.score >= 0.9,
            });
          } else {
            results.push({
              parsed: track,
              match: null,
              matchScore: 0,
            });
          }
        }

        processedTracks += batch.length;
        onProgress(Math.round((processedTracks / totalTracks) * 100));
      } catch (error) {
        if (abortController.signal.aborted) return null;
        console.error("Failed to match batch:", error);
        toast.error("Failed to match tracks");
        return null;
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
