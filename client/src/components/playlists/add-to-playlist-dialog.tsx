"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ListMusic, Loader2, Check, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoverImage } from "@/components/shared/cover-image";
import { getClient } from "@/lib/api/client";
import { formatCount } from "@/lib/utils/format";
import type { Playlist, Song } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface AddToPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songs: Song[];
}

interface DuplicateInfo {
  playlistId: string;
  playlistName: string;
  duplicates: Song[];
  nonDuplicates: Song[];
}

export function AddToPlaylistDialog({ open, onOpenChange, songs }: AddToPlaylistDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const queryClient = useQueryClient();

  // Fetch playlists
  const { data: playlists, isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const response = await client.getPlaylists();
      return response.playlists.playlist ?? [];
    },
    enabled: open,
  });

  // Check for duplicates before adding
  const checkDuplicates = useCallback(async (playlistId: string, playlistName: string) => {
    const client = getClient();
    if (!client) return null;

    try {
      const playlistResponse = await client.getPlaylist(playlistId);
      const existingSongIds = new Set(
        playlistResponse.playlist.entry?.map(s => s.id) ?? []
      );

      const duplicates = songs.filter(s => existingSongIds.has(s.id));
      const nonDuplicates = songs.filter(s => !existingSongIds.has(s.id));

      if (duplicates.length > 0) {
        return { playlistId, playlistName, duplicates, nonDuplicates };
      }
      return null;
    } catch (error) {
      console.error("Failed to check for duplicates:", error);
      return null;
    }
  }, [songs]);

  // Add to existing playlist mutation
  const addToPlaylistMutation = useMutation({
    mutationFn: async ({ playlistId, songIds }: { playlistId: string; songIds: string[] }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({
        playlistId,
        songIdToAdd: songIds,
      });
    },
    onSuccess: (_, { songIds }) => {
      const songText = songIds.length === 1 
        ? songs.length === 1 ? `"${songs[0].title}"` : "1 song"
        : `${songIds.length} songs`;
      toast.success(`Added ${songText} to playlist`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlist"] });
      onOpenChange(false);
      setSelectedPlaylistId(null);
      setDuplicateInfo(null);
    },
    onError: (error) => {
      toast.error("Failed to add to playlist");
      console.error("Add to playlist error:", error);
    },
  });

  // Create new playlist and add songs mutation
  const createAndAddMutation = useMutation({
    mutationFn: async (name: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      // Create playlist first
      const response = await client.createPlaylist({ name });
      // Then add songs
      await client.updatePlaylist({
        playlistId: response.playlist.id,
        songIdToAdd: songs.map((s) => s.id),
      });
      return response.playlist;
    },
    onSuccess: (playlist) => {
      const songText = songs.length === 1 ? `"${songs[0].title}"` : `${songs.length} songs`;
      toast.success(`Created "${playlist.name}" and added ${songText}`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onOpenChange(false);
      setNewPlaylistName("");
      setShowCreateNew(false);
    },
    onError: (error) => {
      toast.error("Failed to create playlist");
      console.error("Create playlist error:", error);
    },
  });

  const filteredPlaylists = playlists?.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) ?? [];

  const handleAddToPlaylist = async (playlistId: string, playlistName: string) => {
    setSelectedPlaylistId(playlistId);
    setIsCheckingDuplicates(true);

    const duplicateResult = await checkDuplicates(playlistId, playlistName);
    setIsCheckingDuplicates(false);

    if (duplicateResult) {
      setDuplicateInfo(duplicateResult);
    } else {
      // No duplicates, add all songs directly
      addToPlaylistMutation.mutate({ 
        playlistId, 
        songIds: songs.map(s => s.id) 
      });
    }
  };

  const handleDuplicateResponse = (action: "skip" | "add-all") => {
    if (!duplicateInfo) return;

    if (action === "skip") {
      if (duplicateInfo.nonDuplicates.length > 0) {
        addToPlaylistMutation.mutate({
          playlistId: duplicateInfo.playlistId,
          songIds: duplicateInfo.nonDuplicates.map(s => s.id),
        });
      } else {
        toast.info("All selected songs are already in the playlist");
        setDuplicateInfo(null);
        setSelectedPlaylistId(null);
      }
    } else {
      // Add all songs including duplicates
      addToPlaylistMutation.mutate({
        playlistId: duplicateInfo.playlistId,
        songIds: songs.map(s => s.id),
      });
    }
  };

  const handleCreateAndAdd = () => {
    if (newPlaylistName.trim()) {
      createAndAddMutation.mutate(newPlaylistName.trim());
    }
  };

  const isPending = addToPlaylistMutation.isPending || createAndAddMutation.isPending || isCheckingDuplicates;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[400px] p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <ListMusic className="w-5 h-5" />
              Add to Playlist
            </DialogTitle>
            <DialogDescription>
              {songs.length === 1
                ? `Add "${songs[0].title}" to a playlist`
                : `Add ${songs.length} songs to a playlist`}
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 pb-2">
            <Input
              placeholder="Search playlists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9"
            />
          </div>

          <ScrollArea className="max-h-[300px]">
            <div className="px-2 pb-2">
              {/* Create new playlist option */}
              {!showCreateNew ? (
                <button
                  onClick={() => setShowCreateNew(true)}
                  className="flex items-center gap-3 w-full p-2 rounded-md hover:bg-accent/70 transition-all text-left"
                  disabled={isPending}
                >
                  <div className="w-10 h-10 rounded-md bg-primary/20 flex items-center justify-center">
                    <Plus className="w-5 h-5 text-primary" />
                  </div>
                  <span className="font-medium">Create new playlist</span>
                </button>
              ) : (
                <div className="flex items-center gap-2 p-2">
                  <Input
                    placeholder="Playlist name"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    className="h-9 flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newPlaylistName.trim()) {
                        handleCreateAndAdd();
                      } else if (e.key === "Escape") {
                        setShowCreateNew(false);
                        setNewPlaylistName("");
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleCreateAndAdd}
                    disabled={!newPlaylistName.trim() || createAndAddMutation.isPending}
                  >
                    {createAndAddMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Create"
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowCreateNew(false);
                      setNewPlaylistName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {/* Playlist list */}
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPlaylists.length > 0 ? (
                filteredPlaylists.map((playlist) => (
                  <PlaylistOption
                    key={playlist.id}
                    playlist={playlist}
                    isSelected={selectedPlaylistId === playlist.id}
                    isPending={isPending && selectedPlaylistId === playlist.id}
                    onSelect={() => handleAddToPlaylist(playlist.id, playlist.name)}
                    disabled={isPending}
                  />
                ))
              ) : searchQuery ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  No playlists match &ldquo;{searchQuery}&rdquo;
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  No playlists yet. Create one above!
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Duplicate confirmation dialog */}
      <AlertDialog open={duplicateInfo !== null} onOpenChange={(open) => !open && setDuplicateInfo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Duplicate Songs Found
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {duplicateInfo?.duplicates.length === 1 
                    ? `1 song is already in "${duplicateInfo?.playlistName}":`
                    : `${duplicateInfo?.duplicates.length} songs are already in "${duplicateInfo?.playlistName}":`}
                </p>
                <ul className="max-h-32 overflow-y-auto space-y-1 text-sm">
                  {duplicateInfo?.duplicates.slice(0, 5).map((song) => (
                    <li key={song.id} className="text-foreground font-medium">
                      • {song.title} — {song.artist}
                    </li>
                  ))}
                  {(duplicateInfo?.duplicates.length ?? 0) > 5 && (
                    <li className="text-muted-foreground">
                      ...and {(duplicateInfo?.duplicates.length ?? 0) - 5} more
                    </li>
                  )}
                </ul>
                {(duplicateInfo?.nonDuplicates.length ?? 0) > 0 && (
                  <p className="text-foreground">
                    {duplicateInfo?.nonDuplicates.length === 1 
                      ? "1 new song can be added."
                      : `${duplicateInfo?.nonDuplicates.length} new songs can be added.`}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDuplicateInfo(null);
              setSelectedPlaylistId(null);
            }}>
              Cancel
            </AlertDialogCancel>
            {(duplicateInfo?.nonDuplicates.length ?? 0) > 0 && (
              <AlertDialogAction onClick={() => handleDuplicateResponse("skip")}>
                Skip Duplicates
              </AlertDialogAction>
            )}
            <AlertDialogAction 
              onClick={() => handleDuplicateResponse("add-all")}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              Add Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface PlaylistOptionProps {
  playlist: Playlist;
  isSelected: boolean;
  isPending: boolean;
  onSelect: () => void;
  disabled: boolean;
}

function PlaylistOption({ playlist, isSelected, isPending, onSelect, disabled }: PlaylistOptionProps) {
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 80)
    : undefined;

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 w-full p-2 rounded-md transition-colors text-left",
        "hover:bg-accent/70",
        isSelected && "bg-accent/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <CoverImage
        src={coverArtUrl}
        alt={playlist.name}
        size="sm"
        type="playlist"
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{playlist.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatCount(playlist.songCount, "song")}
        </p>
      </div>
      {isPending ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : isSelected ? (
        <Check className="w-4 h-4 text-primary" />
      ) : null}
    </button>
  );
}
