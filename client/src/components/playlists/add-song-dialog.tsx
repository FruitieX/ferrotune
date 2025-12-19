"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Loader2,
  Music,
  Play,
  Pause,
  Volume2,
  CheckCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { usePreviewAudio } from "@/lib/hooks/use-preview-audio";
import type { Song } from "@/lib/api/types";
import { formatDuration } from "@/lib/utils/format";

interface AddSongToPlaylistDialogProps {
  playlistId: string;
  playlistName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSongToPlaylistDialog({
  playlistId,
  playlistName,
  open,
  onOpenChange,
}: AddSongToPlaylistDialogProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debouncedQuery = useDebounce(searchQuery, 300);

  const preview = usePreviewAudio();

  // Perform search when debounced query changes
  const doSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      const response = await client.search3({
        query: query.trim(),
        songCount: 30,
        albumCount: 0,
        artistCount: 0,
        inlineImages: "small",
      });

      setSearchResults(response.searchResult3.song ?? []);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Effect to trigger search on debounced query change
  useState(() => {
    doSearch(debouncedQuery);
  });

  // Trigger search when debounced query changes
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      // Will trigger via debounce
    } else {
      setSearchResults([]);
    }
  };

  // Manual search trigger for Enter key
  const handleSearchSubmit = () => {
    doSearch(searchQuery);
  };

  // Also search when debounced value changes
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  if (debouncedQuery !== lastSearchedQuery && open) {
    setLastSearchedQuery(debouncedQuery);
    doSearch(debouncedQuery);
  }

  // Add song mutation
  const addSongMutation = useMutation({
    mutationFn: async (songId: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({
        playlistId,
        songIdToAdd: [songId],
      });
      return songId;
    },
    onSuccess: () => {
      const songTitle = selectedSong?.title || "Song";
      toast.success(`Added "${songTitle}" to ${playlistName}`);
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });

      // Reset and close
      handleClose();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to add song",
      );
    },
  });

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
    setSelectedSong(song);
    addSongMutation.mutate(song.id);
  };

  const handlePreviewToggle = () => {
    if (!selectedSong) return;
    if (preview.isPlaying) {
      preview.stop();
    } else {
      preview.play(selectedSong.id, 30);
    }
  };

  const handleAddSong = () => {
    if (selectedSong) {
      addSongMutation.mutate(selectedSong.id);
    }
  };

  const handleClose = () => {
    preview.stop();
    setSearchQuery("");
    setSearchResults([]);
    setSelectedSong(null);
    setLastSearchedQuery("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) {
          handleClose();
        } else {
          onOpenChange(newOpen);
        }
      }}
    >
      <DialogContent className="w-[95vw] max-w-[600px] h-[80vh] max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add Song to Playlist
          </DialogTitle>
          <DialogDescription>
            Search for a song to add to &quot;{playlistName}&quot;
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search songs..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
            className="pl-10"
            autoFocus
          />
        </div>

        {/* Search results */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isSearching && searchQuery && searchResults.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Music className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No songs found</p>
            </div>
          )}

          {!isSearching && !searchQuery && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Start typing to search for songs</p>
            </div>
          )}

          {!isSearching && searchResults.length > 0 && (
            <div className="space-y-1">
              {searchResults.map((song) => (
                <div
                  key={song.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors",
                    selectedSong?.id === song.id
                      ? "bg-primary/10"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => handleSelectSong(song)}
                  onDoubleClick={() => handleDoubleClickSong(song)}
                >
                  {/* Cover art */}
                  <div className="w-10 h-10 bg-muted rounded overflow-hidden shrink-0">
                    {song.coverArt || song.coverArtData ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          song.coverArtData
                            ? `data:image/webp;base64,${song.coverArtData}`
                            : getClient()?.getCoverArtUrl(
                                song.coverArt!,
                                "small",
                              )
                        }
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Song info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{song.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {song.artist}
                      {song.album && ` • ${song.album}`}
                    </p>
                  </div>

                  {/* Duration */}
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDuration(song.duration)}
                  </span>

                  {/* Selected indicator */}
                  {selectedSong?.id === song.id && (
                    <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Preview controls (shown when song is selected) */}
        <div className="shrink-0 border-t pt-4 min-h-[52px]">
          {selectedSong && (
            <div className="flex items-center gap-4">
              {/* Play/Pause */}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handlePreviewToggle}
              >
                {preview.isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </Button>

              {/* Progress */}
              <Slider
                value={[preview.progress]}
                max={100}
                step={1}
                onValueChange={(value) => preview.seek(value[0])}
                className="flex-1"
              />

              {/* Volume */}
              <div className="flex items-center gap-2 w-24">
                <Volume2 className="w-4 h-4 text-muted-foreground" />
                <Slider
                  value={[preview.volume * 100]}
                  max={100}
                  step={1}
                  onValueChange={(value) => preview.setVolume(value[0] / 100)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAddSong}
            disabled={!selectedSong || addSongMutation.isPending}
          >
            {addSongMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Add Song
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
