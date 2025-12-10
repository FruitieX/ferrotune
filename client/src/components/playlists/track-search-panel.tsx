"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Search,
  Music,
  Loader2,
  Check,
  Play,
  Pause,
  CheckCircle,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import { usePreviewAudio } from "@/lib/hooks/use-preview-audio";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Song } from "@/lib/api/types";

export interface ParsedTrackData {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  raw?: string | null;
}

export interface TrackSearchPanelProps {
  /** Parsed track info for building initial search query */
  parsed: ParsedTrackData;
  /** Callback when user confirms selection (single click + confirm button) */
  onConfirm: (song: Song) => void;
  /** Whether confirmation is in progress */
  isConfirming?: boolean;
  /** Unique ID prefix for form element IDs */
  idPrefix?: string;
  /** Whether to trigger search immediately when panel renders */
  autoSearch?: boolean;
  /** Called when panel wants to close (e.g., after confirm) */
  onClose?: () => void;
  /** Label for the confirm button */
  confirmLabel?: string;
  /** Show the original raw text at the bottom */
  showRawText?: boolean;
}

export function TrackSearchPanel({
  parsed,
  onConfirm,
  isConfirming = false,
  idPrefix = "",
  autoSearch = true,
  onClose,
  confirmLabel = "Use",
  showRawText = false,
}: TrackSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Quick search toggles
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeArtist, setIncludeArtist] = useState(true);
  const [includeAlbum, setIncludeAlbum] = useState(true);
  // Selection and preview state
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);

  const preview = usePreviewAudio();
  const volumeContainerRef = useRef<HTMLDivElement>(null);

  // Debounced search query for auto-search
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  // Track if this is a user-typed query vs toggle-based query
  const isUserTypedRef = useRef(false);
  // Track if initial search has been done
  const hasInitialSearchRef = useRef(false);

  // Build search query from selected fields in "artist - album - title" format
  const buildSearchQuery = (
    title: boolean,
    artist: boolean,
    album: boolean,
  ) => {
    const parts: string[] = [];
    if (artist && parsed.artist) parts.push(parsed.artist);
    if (album && parsed.album) parts.push(parsed.album);
    if (title && parsed.title) parts.push(parsed.title);
    return parts.join(" - ").trim() || parsed.raw || "";
  };

  // Perform search
  const doSearch = async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const client = getClient();
      if (!client) return;

      const response = await client.search3({
        query: query.trim(),
        songCount: 20,
      });
      setSearchResults(response.searchResult3?.song ?? []);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Initialize state and do initial search on mount
  useEffect(() => {
    if (!hasInitialSearchRef.current) {
      const hasTitle = !!parsed.title;
      const hasArtist = !!parsed.artist;
      const hasAlbum = !!parsed.album;

      setIncludeTitle(hasTitle);
      setIncludeArtist(hasArtist);
      setIncludeAlbum(hasAlbum);

      const initialQuery = buildSearchQuery(hasTitle, hasArtist, hasAlbum);
      isUserTypedRef.current = false;
      setSearchQuery(initialQuery);
      setSearchResults([]);
      setSelectedSong(null);
      hasInitialSearchRef.current = true;

      // Trigger initial search if autoSearch is enabled
      if (autoSearch) {
        doSearch(initialQuery);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      preview.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-search effect for debounced user-typed queries
  useEffect(() => {
    if (isUserTypedRef.current && debouncedSearchQuery.trim()) {
      doSearch(debouncedSearchQuery);
    }
  }, [debouncedSearchQuery]);

  // Handle search query changes from user typing
  const handleSearchQueryChange = (value: string) => {
    isUserTypedRef.current = true;
    setSearchQuery(value);
  };

  // Update search query when toggles change and auto-search
  const updateSearchFromToggles = (
    title: boolean,
    artist: boolean,
    album: boolean,
  ) => {
    setIncludeTitle(title);
    setIncludeArtist(artist);
    setIncludeAlbum(album);
    const newQuery = buildSearchQuery(title, artist, album);
    isUserTypedRef.current = false;
    setSearchQuery(newQuery);
    doSearch(newQuery);
  };

  // Handle scroll wheel to adjust volume
  useEffect(() => {
    const container = volumeContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;
      const newVolume = Math.max(0, Math.min(100, preview.volume + delta));
      preview.setVolume(newVolume);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [preview.volume, preview.setVolume, preview]);

  // Selection and preview handlers
  const handleSelectSong = (song: Song) => {
    if (selectedSong?.id !== song.id) {
      const wasPlaying = preview.isPlaying;
      preview.stop();
      setSelectedSong(song);
      if (wasPlaying) {
        preview.play(song.id, 30);
      }
    }
  };

  const handleDoubleClickSong = (song: Song) => {
    if (!isConfirming) {
      preview.stop();
      setSelectedSong(song);
      onConfirm(song);
      onClose?.();
    }
  };

  const handleConfirmMatch = () => {
    if (!selectedSong) return;
    preview.stop();
    onConfirm(selectedSong);
    onClose?.();
  };

  const handlePreviewToggle = () => {
    if (!selectedSong) return;
    if (preview.isPlaying) {
      preview.pause();
    } else {
      preview.play(selectedSong.id, 30);
    }
  };

  const handleSeek = (value: number[]) => {
    preview.seek(value[0]);
  };

  const handleVolumeChange = (value: number[]) => {
    preview.setVolume(value[0]);
  };

  const elementId = (name: string) => `${idPrefix}${name}`;

  return (
    <div className="space-y-3 min-w-0">
      {/* Quick field toggles */}
      <div className="flex flex-wrap gap-3 pb-2 border-b">
        {parsed.title && (
          <div className="flex items-center space-x-1.5">
            <Checkbox
              id={elementId("title")}
              checked={includeTitle}
              onCheckedChange={(checked) =>
                updateSearchFromToggles(
                  checked === true,
                  includeArtist,
                  includeAlbum,
                )
              }
              className="h-3.5 w-3.5"
            />
            <label
              htmlFor={elementId("title")}
              className="text-xs cursor-pointer"
            >
              Title
            </label>
          </div>
        )}
        {parsed.artist && (
          <div className="flex items-center space-x-1.5">
            <Checkbox
              id={elementId("artist")}
              checked={includeArtist}
              onCheckedChange={(checked) =>
                updateSearchFromToggles(
                  includeTitle,
                  checked === true,
                  includeAlbum,
                )
              }
              className="h-3.5 w-3.5"
            />
            <label
              htmlFor={elementId("artist")}
              className="text-xs cursor-pointer"
            >
              Artist
            </label>
          </div>
        )}
        {parsed.album && (
          <div className="flex items-center space-x-1.5">
            <Checkbox
              id={elementId("album")}
              checked={includeAlbum}
              onCheckedChange={(checked) =>
                updateSearchFromToggles(
                  includeTitle,
                  includeArtist,
                  checked === true,
                )
              }
              className="h-3.5 w-3.5"
            />
            <label
              htmlFor={elementId("album")}
              className="text-xs cursor-pointer"
            >
              Album
            </label>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={searchQuery}
          onChange={(e) => handleSearchQueryChange(e.target.value)}
          placeholder="Search for track..."
          className="h-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              doSearch(searchQuery);
            }
          }}
        />
        <Button
          size="sm"
          onClick={() => doSearch(searchQuery)}
          disabled={isSearching || !searchQuery.trim()}
          className="h-8"
        >
          {isSearching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </Button>
      </div>

      {searchResults.length > 0 && (
        <div
          className="h-[200px] max-w-full rounded border overflow-y-auto overflow-x-hidden"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="p-1">
            {searchResults.map((song) => {
              const isSelectedSong = selectedSong?.id === song.id;
              return (
                <button
                  key={song.id}
                  className={cn(
                    "w-full text-left p-2 rounded text-sm flex items-center gap-2 overflow-hidden",
                    isSelectedSong
                      ? "bg-primary/10 ring-1 ring-primary"
                      : "hover:bg-accent",
                  )}
                  onClick={() => handleSelectSong(song)}
                  onDoubleClick={() => handleDoubleClickSong(song)}
                >
                  {isSelectedSong ? (
                    <CheckCircle className="w-4 h-4 shrink-0 text-primary" />
                  ) : (
                    <Music className="w-4 h-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="font-medium truncate">{song.title}</div>
                    <div className="text-muted-foreground text-xs truncate">
                      {song.artist}
                      {song.album ? ` • ${song.album}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview controls for selected song */}
      {selectedSong && (
        <div className="pt-2 border-t space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handlePreviewToggle}
              disabled={preview.isLoading}
            >
              {preview.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : preview.isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {selectedSong.title}
              </div>
              <Slider
                value={[preview.progress]}
                onValueChange={handleSeek}
                max={100}
                step={0.1}
                className="cursor-pointer"
              />
            </div>
            <div
              ref={volumeContainerRef}
              className="flex items-center gap-1 shrink-0"
            >
              <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
              <Slider
                value={[preview.volume]}
                onValueChange={handleVolumeChange}
                max={100}
                step={1}
                className="w-16 cursor-pointer"
              />
            </div>
            <Button
              size="sm"
              onClick={handleConfirmMatch}
              disabled={isConfirming}
              className="shrink-0"
            >
              {isConfirming ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5 mr-1" />
              )}
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}

      {searchResults.length === 0 && searchQuery && !isSearching && (
        <div className="text-sm text-muted-foreground text-center py-4">
          No results found. Try adjusting your search.
        </div>
      )}

      {/* Original raw text */}
      {showRawText && parsed.raw && (
        <div className="text-xs text-muted-foreground pt-2 border-t overflow-hidden">
          <span className="font-medium">Original entry:</span>{" "}
          <span className="font-mono break-all">{parsed.raw}</span>
        </div>
      )}
    </div>
  );
}
