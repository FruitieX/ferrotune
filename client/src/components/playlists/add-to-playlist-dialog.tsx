"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  isFolderPlaceholder,
  buildFolderPathMap,
  getPlaylistFullPath,
} from "@/lib/utils/playlist-folders";
import type { Song } from "@/lib/api/types";
import type { PlaylistInFolder } from "@/lib/api/generated/PlaylistInFolder";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/hooks/use-media-query";

interface AddToPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Songs to add (provides title info for display) */
  songs?: Song[];
  /** Alternative: just song IDs when full song data isn't loaded */
  songIds?: string[];
  /** Callback when songs are successfully added to a playlist */
  onAdded?: (playlistId: string) => void;
}

interface DuplicateInfo {
  playlistId: string;
  playlistName: string;
  duplicateCount: number;
  nonDuplicateIds: string[];
}

export function AddToPlaylistDialog({
  open,
  onOpenChange,
  songs = [],
  songIds,
  onAdded,
}: AddToPlaylistDialogProps) {
  // Determine the IDs and count to use
  const idsToAdd = songIds ?? songs.map((s) => s.id);
  const songCount = idsToAdd.length;

  // For display, use song title if we have exactly one loaded song
  const displayText =
    songs.length === 1 ? `"${songs[0].title}"` : `${songCount} songs`;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null,
  );
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(
    null,
  );
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const isMobile = useIsMobile();

  // Fetch playlists with folder structure
  const { data: foldersData, isLoading } = useQuery({
    queryKey: ["playlistFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getPlaylistFoldersWithStructure();
    },
    enabled: open,
  });

  const playlists = foldersData?.playlists ?? [];
  const folders = foldersData?.folders ?? [];
  const folderPathMap = buildFolderPathMap(folders);

  // Fetch which playlists already contain the songs being added
  const { data: containingPlaylists } = useQuery({
    queryKey: ["playlists-containing-songs", idsToAdd],
    queryFn: async () => {
      const client = getClient();
      if (!client) return null;
      return client.getPlaylistsContainingSongs(idsToAdd);
    },
    enabled: open && idsToAdd.length > 0,
  });

  // Build a set of playlist IDs that already contain at least one of the songs
  const containingPlaylistIds = new Set<string>();
  if (containingPlaylists?.playlistsBySong) {
    for (const playlistList of Object.values(
      containingPlaylists.playlistsBySong,
    )) {
      if (!playlistList) continue;
      for (const p of playlistList) {
        containingPlaylistIds.add(p.playlistId);
      }
    }
  }

  // Check for duplicates before adding
  const checkDuplicates = async (playlistId: string, playlistName: string) => {
    const client = getClient();
    if (!client) return null;

    try {
      const playlistResponse = await client.getPlaylist(playlistId);
      const existingSongIds = new Set(
        playlistResponse.playlist.entry?.map((s) => s.id) ?? [],
      );

      const duplicateIds = idsToAdd.filter((id) => existingSongIds.has(id));
      const nonDuplicateIds = idsToAdd.filter((id) => !existingSongIds.has(id));

      if (duplicateIds.length > 0) {
        return {
          playlistId,
          playlistName,
          duplicateCount: duplicateIds.length,
          nonDuplicateIds,
        };
      }
      return null;
    } catch (error) {
      console.error("Failed to check for duplicates:", error);
      return null;
    }
  };

  // Add to existing playlist mutation
  const addToPlaylistMutation = useMutation({
    mutationFn: async ({
      playlistId,
      playlistName,
      songIdsToAdd,
    }: {
      playlistId: string;
      playlistName: string;
      songIdsToAdd: string[];
    }) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.updatePlaylist({
        playlistId,
        songIdToAdd: songIdsToAdd,
      });
      return { playlistId, playlistName };
    },
    onSuccess: (
      { playlistId, playlistName: _playlistName },
      { songIdsToAdd },
    ) => {
      const songText =
        songIdsToAdd.length === 1 && songs.length === 1
          ? `"${songs[0].title}"`
          : `${songIdsToAdd.length} songs`;
      toast.success(`Added ${songText} to playlist`, {
        action: {
          label: "Go to playlist",
          onClick: () => {
            router.push(`/playlists/details?id=${playlistId}`);
          },
        },
      });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistSongs"] });
      onAdded?.(playlistId);
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
        songIdToAdd: idsToAdd,
      });
      return response.playlist;
    },
    onSuccess: (playlist) => {
      toast.success(`Created "${playlist.name}" and added ${displayText}`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlistFolders"] });
      queryClient.invalidateQueries({ queryKey: ["playlistSongs"] });
      onOpenChange(false);
      setNewPlaylistName("");
      setShowCreateNew(false);
    },
    onError: (error) => {
      toast.error("Failed to create playlist");
      console.error("Create playlist error:", error);
    },
  });

  const filteredPlaylists = (Array.isArray(playlists) ? playlists : [])
    .filter((p) => {
      if (isFolderPlaceholder(p.name)) return false;
      const fullPath = getPlaylistFullPath(p.name, p.folderId, folderPathMap);
      return fullPath.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      // Sort playlists that already contain the songs to the top
      const aContains = containingPlaylistIds.has(a.id);
      const bContains = containingPlaylistIds.has(b.id);
      if (aContains && !bContains) return -1;
      if (!aContains && bContains) return 1;
      // Otherwise sort by most recently updated
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const handleAddToPlaylist = async (
    playlistId: string,
    playlistName: string,
  ) => {
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
        playlistName,
        songIdsToAdd: idsToAdd,
      });
    }
  };

  const handleDuplicateResponse = (action: "skip" | "add-all") => {
    if (!duplicateInfo) return;

    if (action === "skip") {
      if (duplicateInfo.nonDuplicateIds.length > 0) {
        addToPlaylistMutation.mutate({
          playlistId: duplicateInfo.playlistId,
          playlistName: duplicateInfo.playlistName,
          songIdsToAdd: duplicateInfo.nonDuplicateIds,
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
        playlistName: duplicateInfo.playlistName,
        songIdsToAdd: idsToAdd,
      });
    }
  };

  const handleCreateAndAdd = () => {
    if (newPlaylistName.trim()) {
      createAndAddMutation.mutate(newPlaylistName.trim());
    }
  };

  const isPending =
    addToPlaylistMutation.isPending ||
    createAndAddMutation.isPending ||
    isCheckingDuplicates;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-[480px] p-0 gap-0 overflow-hidden"
          overlayClassName="z-[70]"
          style={{ zIndex: 70 }}
        >
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <ListMusic className="w-5 h-5" />
              Add to Playlist
            </DialogTitle>
            <DialogDescription>
              Add {displayText} to a playlist
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 pb-2">
            <Input
              placeholder="Search playlists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9"
              autoFocus={!isMobile}
            />
          </div>

          <ScrollArea className="max-h-[300px] min-w-0">
            <div className="px-2 pb-2">
              {/* Create new playlist option */}
              {!showCreateNew ? (
                <button
                  onClick={() => {
                    setNewPlaylistName(searchQuery.trim());
                    setShowCreateNew(true);
                  }}
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
                    disabled={
                      !newPlaylistName.trim() || createAndAddMutation.isPending
                    }
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
                filteredPlaylists.map((playlist) => {
                  const fullPath = getPlaylistFullPath(
                    playlist.name,
                    playlist.folderId,
                    folderPathMap,
                  );
                  return (
                    <PlaylistOption
                      key={playlist.id}
                      playlist={playlist}
                      fullPath={fullPath}
                      isSelected={selectedPlaylistId === playlist.id}
                      isPending={
                        isPending && selectedPlaylistId === playlist.id
                      }
                      onSelect={() =>
                        handleAddToPlaylist(playlist.id, fullPath)
                      }
                      disabled={isPending}
                      alreadyContainsSong={containingPlaylistIds.has(
                        playlist.id,
                      )}
                    />
                  );
                })
              ) : searchQuery ? (
                <div className="py-6 text-center space-y-3">
                  <p className="text-muted-foreground text-sm">
                    No playlists match &ldquo;{searchQuery}&rdquo;
                  </p>
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
      <AlertDialog
        open={duplicateInfo !== null}
        onOpenChange={(open) => !open && setDuplicateInfo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Duplicate Songs Found
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {duplicateInfo?.duplicateCount === 1
                    ? `1 song is already in "${duplicateInfo?.playlistName}".`
                    : `${duplicateInfo?.duplicateCount} songs are already in "${duplicateInfo?.playlistName}".`}
                </p>
                {(duplicateInfo?.nonDuplicateIds.length ?? 0) > 0 && (
                  <p className="text-foreground">
                    {duplicateInfo?.nonDuplicateIds.length === 1
                      ? "1 new song can be added."
                      : `${duplicateInfo?.nonDuplicateIds.length} new songs can be added.`}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDuplicateInfo(null);
                setSelectedPlaylistId(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            {(duplicateInfo?.nonDuplicateIds.length ?? 0) > 0 && (
              <AlertDialogAction
                onClick={() => handleDuplicateResponse("skip")}
              >
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
  playlist: PlaylistInFolder;
  fullPath: string;
  isSelected: boolean;
  isPending: boolean;
  onSelect: () => void;
  disabled: boolean;
  alreadyContainsSong?: boolean;
}

function PlaylistOption({
  playlist,
  fullPath,
  isSelected,
  isPending,
  onSelect,
  disabled,
  alreadyContainsSong = false,
}: PlaylistOptionProps) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 w-full p-2 rounded-md transition-colors text-left overflow-hidden",
        "hover:bg-accent/70",
        isSelected && "bg-accent/50",
        disabled && "opacity-50 cursor-not-allowed",
        alreadyContainsSong && "bg-primary/5 border border-primary/20",
      )}
    >
      <CoverImage
        src={undefined}
        alt={playlist.name}
        size="sm"
        type="playlist"
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{fullPath}</p>
        <p className="text-xs text-muted-foreground">
          {formatCount(playlist.songCount, "song")}
          {alreadyContainsSong && (
            <span className="ml-1 text-primary">• Already added</span>
          )}
        </p>
      </div>
      {isPending ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : isSelected ? (
        <Check className="w-4 h-4 text-primary" />
      ) : alreadyContainsSong ? (
        <Check className="w-4 h-4 text-primary/50" />
      ) : null}
    </button>
  );
}
