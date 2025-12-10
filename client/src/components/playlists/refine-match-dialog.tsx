"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  Music,
  Loader2,
  Play,
  Pause,
  Check,
  CheckCircle,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import { usePreviewAudio } from "@/lib/hooks/use-preview-audio";
import type { Song } from "@/lib/api/types";
import type { MissingEntryDataResponse } from "@/lib/api/generated/MissingEntryDataResponse";

interface RefineMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  position: number;
  missing: MissingEntryDataResponse;
}

export function RefineMatchDialog({
  open,
  onOpenChange,
  playlistId,
  position,
  missing,
}: RefineMatchDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeArtist, setIncludeArtist] = useState(true);
  const [includeAlbum, setIncludeAlbum] = useState(true);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);

  const queryClient = useQueryClient();
  const preview = usePreviewAudio();

  // Build search query from missing data
  const buildSearchQuery = (
    title: boolean,
    artist: boolean,
    album: boolean,
  ) => {
    const parts: string[] = [];
    if (artist && missing.artist) parts.push(missing.artist);
    if (album && missing.album) parts.push(missing.album);
    if (title && missing.title) parts.push(missing.title);
    return parts.join(" - ").trim() || missing.raw || "";
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
    setSearchQuery(newQuery);
    // Trigger search with new query
    doSearch(newQuery);
  };

  // Initialize state and trigger search when dialog opens
  useEffect(() => {
    // Local function for building search query
    const buildInitialQuery = (
      title: boolean,
      artist: boolean,
      album: boolean,
    ) => {
      const parts: string[] = [];
      if (artist && missing.artist) parts.push(missing.artist);
      if (album && missing.album) parts.push(missing.album);
      if (title && missing.title) parts.push(missing.title);
      return parts.join(" - ").trim() || missing.raw || "";
    };

    // Local function for performing initial search
    const performInitialSearch = async (query: string) => {
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

    if (open) {
      const hasTitle = !!missing.title;
      const hasArtist = !!missing.artist;
      const hasAlbum = !!missing.album;
      setIncludeTitle(hasTitle);
      setIncludeArtist(hasArtist);
      setIncludeAlbum(hasAlbum);
      setSearchResults([]);
      setSelectedSong(null);

      // Build and set initial query, then search
      const initialQuery = buildInitialQuery(hasTitle, hasArtist, hasAlbum);
      setSearchQuery(initialQuery);
      performInitialSearch(initialQuery);
    } else {
      preview.stop();
      setSelectedSong(null);
    }
  }, [open, missing, preview]);

  // Handle dialog close
  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
  };

  // Mutation for matching the entry
  const matchMutation = useMutation({
    mutationFn: async (songId: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.matchMissingEntry(playlistId, position, songId);
    },
    onSuccess: () => {
      toast.success("Match updated successfully");
      queryClient.invalidateQueries({
        queryKey: ["playlistSongs", playlistId],
      });
      setSearchQuery("");
      setSearchResults([]);
      setSelectedSong(null);
      preview.stop();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(
        `Failed to update match: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    },
  });

  const handleSelectSong = (song: Song) => {
    if (selectedSong?.id === song.id) {
      setSelectedSong(null);
      preview.stop();
    } else {
      // If preview was playing, auto-start the new track
      const wasPlaying = preview.isPlaying;
      preview.stop();
      setSelectedSong(song);
      if (wasPlaying) {
        preview.play(song.id, 30);
      }
    }
  };

  const handleConfirmMatch = () => {
    if (selectedSong) {
      matchMutation.mutate(selectedSong.id);
    }
  };

  const handlePreviewToggle = () => {
    if (selectedSong) {
      preview.toggle();
    }
  };

  const handleSeek = (values: number[]) => {
    const newPosition = values[0];
    preview.seek(newPosition);
  };

  const handleVolumeChange = (values: number[]) => {
    preview.setVolume(values[0]);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Refine match</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          {/* Quick field toggles */}
          <div className="flex flex-wrap gap-3 pb-2 border-b">
            {missing.title && (
              <div className="flex items-center space-x-1.5">
                <Checkbox
                  id={`refine-title-${position}`}
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
                  htmlFor={`refine-title-${position}`}
                  className="text-xs cursor-pointer"
                >
                  Title
                </label>
              </div>
            )}
            {missing.artist && (
              <div className="flex items-center space-x-1.5">
                <Checkbox
                  id={`refine-artist-${position}`}
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
                  htmlFor={`refine-artist-${position}`}
                  className="text-xs cursor-pointer"
                >
                  Artist
                </label>
              </div>
            )}
            {missing.album && (
              <div className="flex items-center space-x-1.5">
                <Checkbox
                  id={`refine-album-${position}`}
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
                  htmlFor={`refine-album-${position}`}
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
              onChange={(e) => setSearchQuery(e.target.value)}
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
                <div className="flex items-center gap-1 shrink-0">
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
                  disabled={matchMutation.isPending}
                  className="shrink-0"
                >
                  {matchMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5 mr-1" />
                  )}
                  Use
                </Button>
              </div>
            </div>
          )}

          {searchResults.length === 0 && searchQuery && !isSearching && (
            <div className="text-sm text-muted-foreground text-center py-4">
              Press Enter or click Search to find tracks
            </div>
          )}

          {/* Original raw text */}
          {missing.raw && (
            <div className="text-xs text-muted-foreground pt-2 border-t overflow-hidden">
              <span className="font-medium">Original entry:</span>{" "}
              <span className="font-mono break-all">{missing.raw}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
