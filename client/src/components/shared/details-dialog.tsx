"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Music, User, Disc, ListMusic, Calendar, Clock, Hash, FileAudio, HardDrive, Star, Heart, Trash2, Loader2, Play, History, Tag, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
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
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getClient } from "@/lib/api/client";
import { formatDuration, formatDate, formatFileSize } from "@/lib/utils/format";
import { toast } from "sonner";
import { TagsEditor } from "./tags-editor";
import { CoverImage } from "./cover-image";
import type { Song, Album, Artist, Playlist } from "@/lib/api/types";

type DetailsItem =
  | { type: "song"; data: Song }
  | { type: "album"; data: Album }
  | { type: "artist"; data: Artist }
  | { type: "playlist"; data: Playlist };

interface DetailsDialogProps {
  item: DetailsItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSongDeleted?: () => void;
}

export function DetailsDialog({ item, open, onOpenChange, onSongDeleted }: DetailsDialogProps) {
  if (!item) return null;

  // Stop context menu events from propagating outside the dialog
  // This allows native browser context menus to work inside the dialog
  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-xl max-h-[85vh] overflow-y-auto overflow-x-hidden"
        onContextMenu={handleContextMenu}
      >
        {item.type === "song" && (
          <SongDetails 
            song={item.data} 
            onDeleted={() => {
              onOpenChange(false);
              onSongDeleted?.();
            }} 
          />
        )}
        {item.type === "album" && <AlbumDetails album={item.data} />}
        {item.type === "artist" && <ArtistDetails artist={item.data} />}
        {item.type === "playlist" && <PlaylistDetails playlist={item.data} />}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ icon: Icon, label, value, copyable = false }: { icon: React.ElementType; label: string; value: React.ReactNode; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  
  if (!value) return null;
  
  const handleCopy = async () => {
    if (typeof value !== "string" && typeof value !== "number") return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };
  
  const canCopy = copyable && (typeof value === "string" || typeof value === "number");
  
  return (
    <div className="flex items-start gap-3 py-2 group">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium wrap-break-word whitespace-pre-wrap flex-1">{value}</p>
          {canCopy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Copy to clipboard</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function SongDetails({ song, onDeleted }: { song: Song; onDeleted?: () => void }) {
  const [coverError, setCoverError] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTagsEditor, setShowTagsEditor] = useState(false);
  const [fullSong, setFullSong] = useState<Song>(song);
  const queryClient = useQueryClient();
  const coverArtUrl = fullSong.coverArt && !coverError
    ? getClient()?.getCoverArtUrl(fullSong.coverArt, 200)
    : null;

  // Fetch full song details (including play stats) when dialog opens
  useEffect(() => {
    async function fetchSongDetails() {
      const client = getClient();
      if (!client) return;
      
      try {
        const response = await client.getSong(song.id);
        if (response.song) {
          setFullSong(response.song);
        }
      } catch (error) {
        // Use the provided song data if fetch fails
        console.debug("Could not fetch song details:", error);
      }
    }
    
    fetchSongDetails();
  }, [song.id]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.deleteSongFromDatabase(song.id);
    },
    onSuccess: (result) => {
      toast.success(result.message);
      // Invalidate queries that might contain this song
      queryClient.invalidateQueries({ queryKey: ["album"] });
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["artist"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["starred"] });
      queryClient.invalidateQueries({ queryKey: ["randomSongs"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onDeleted?.();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete song");
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Music className="w-5 h-5" />
          Track Details
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 overflow-hidden">
        {/* Cover and title */}
        <div className="flex gap-4">
          <CoverImage
              src={coverArtUrl}
              alt={fullSong.title || "Song cover"}
              colorSeed={fullSong.album || fullSong.title || "Song"}
              type="song"
              size="full"
              className="w-24 h-24 shrink-0"
            />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-lg truncate">{fullSong.title}</h3>
            <p className="text-sm text-muted-foreground truncate">{fullSong.artist}</p>
            <p className="text-sm text-muted-foreground truncate">{fullSong.album}</p>
          </div>
        </div>

        <Separator />

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-4">
          <DetailRow icon={User} label="Artist" value={fullSong.artist} copyable />
          <DetailRow icon={Disc} label="Album" value={fullSong.album} copyable />
          <DetailRow icon={Hash} label="Track" value={fullSong.track ? `${fullSong.track}${fullSong.discNumber ? ` (Disc ${fullSong.discNumber})` : ""}` : undefined} />
          <DetailRow icon={Calendar} label="Year" value={fullSong.year} copyable />
          <DetailRow icon={Clock} label="Duration" value={formatDuration(fullSong.duration)} copyable />
          <DetailRow icon={Music} label="Genre" value={fullSong.genre} copyable />
          <DetailRow icon={FileAudio} label="Format" value={fullSong.suffix?.toUpperCase()} />
          <DetailRow icon={FileAudio} label="Bitrate" value={fullSong.bitRate ? `${fullSong.bitRate} kbps` : undefined} />
          <DetailRow icon={HardDrive} label="Size" value={formatFileSize(fullSong.size)} />
          <DetailRow icon={Calendar} label="Added" value={formatDate(fullSong.created)} />
          {fullSong.starred && (
            <DetailRow icon={Heart} label="Favorited" value={formatDate(fullSong.starred)} />
          )}
          {fullSong.userRating && (
            <DetailRow 
              icon={Star} 
              label="Rating" 
              value={
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: fullSong.userRating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                  ))}
                </span>
              } 
            />
          )}
          {/* Play statistics */}
          {fullSong.playCount !== undefined && fullSong.playCount > 0 && (
            <DetailRow icon={Play} label="Play Count" value={`${fullSong.playCount} ${fullSong.playCount === 1 ? "play" : "plays"}`} />
          )}
          {fullSong.lastPlayed && (
            <DetailRow icon={History} label="Last Played" value={formatDate(fullSong.lastPlayed)} />
          )}
        </div>

        <Separator />

        <DetailRow icon={Hash} label="Track ID" value={fullSong.id} copyable />
        <DetailRow icon={HardDrive} label="File Path" value={fullSong.path} copyable />

        <Separator />

        {/* Actions */}
        <div className="pt-2 space-y-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTagsEditor(true)}
            className="w-full"
          >
            <Tag className="w-4 h-4 mr-2" />
            View / Edit Tags
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleteMutation.isPending}
            className="w-full"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Remove from Database
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            This removes the track from the database. The file will remain on disk and may be re-added on the next scan.
          </p>
        </div>
      </div>

      {/* Tags editor dialog */}
      <TagsEditor 
        song={fullSong} 
        open={showTagsEditor} 
        onOpenChange={setShowTagsEditor} 
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove track from database?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{fullSong.title}&quot; from the database, including all playlist entries, favorites, and play history. The file will remain on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AlbumDetails({ album }: { album: Album }) {
  const coverArtUrl = album.coverArt
    ? getClient()?.getCoverArtUrl(album.coverArt, 200)
    : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Disc className="w-5 h-5" />
          Album Details
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {/* Cover and title */}
        <div className="flex gap-4">
          <CoverImage
              src={coverArtUrl}
              alt={album.name || "Album cover"}
              colorSeed={album.name || "Album"}
              type="album"
              size="full"
              className="w-24 h-24 shrink-0"
            />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-lg truncate">{album.name}</h3>
            <p className="text-sm text-muted-foreground truncate">{album.artist}</p>
          </div>
        </div>

        <Separator />

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-4">
          <DetailRow icon={User} label="Artist" value={album.artist} />
          <DetailRow icon={Calendar} label="Year" value={album.year} />
          <DetailRow icon={Music} label="Genre" value={album.genre} />
          <DetailRow icon={Hash} label="Tracks" value={`${album.songCount} songs`} />
          <DetailRow icon={Clock} label="Duration" value={formatDuration(album.duration)} />
          <DetailRow icon={Calendar} label="Added" value={formatDate(album.created)} />
          {album.starred && (
            <DetailRow icon={Heart} label="Favorited" value={formatDate(album.starred)} />
          )}
          {album.userRating && (
            <DetailRow 
              icon={Star} 
              label="Rating" 
              value={
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: album.userRating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                  ))}
                </span>
              } 
            />
          )}
        </div>
      </div>
    </>
  );
}

function ArtistDetails({ artist }: { artist: Artist }) {
  const coverArtUrl = artist.coverArt
    ? getClient()?.getCoverArtUrl(artist.coverArt, 200)
    : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <User className="w-5 h-5" />
          Artist Details
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {/* Cover and title */}
        <div className="flex gap-4">
          <CoverImage
              src={coverArtUrl}
              alt={artist.name || "Artist image"}
              colorSeed={artist.name || "Artist"}
              type="artist"
              size="full"
              className="w-24 h-24 rounded-full shrink-0"
            />
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <h3 className="font-bold text-lg truncate">{artist.name}</h3>
            <p className="text-sm text-muted-foreground">
              {artist.albumCount} {artist.albumCount === 1 ? "album" : "albums"}
            </p>
          </div>
        </div>

        <Separator />

        {/* Details */}
        <div className="space-y-1">
          <DetailRow icon={Disc} label="Albums" value={`${artist.albumCount} ${artist.albumCount === 1 ? "album" : "albums"}`} />
          {artist.starred && (
            <DetailRow icon={Heart} label="Favorited" value={formatDate(artist.starred)} />
          )}
          {artist.userRating && (
            <DetailRow 
              icon={Star} 
              label="Rating" 
              value={
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: artist.userRating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                  ))}
                </span>
              } 
            />
          )}
        </div>
      </div>
    </>
  );
}

function PlaylistDetails({ playlist }: { playlist: Playlist }) {
  const coverArtUrl = playlist.coverArt
    ? getClient()?.getCoverArtUrl(playlist.coverArt, 200)
    : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ListMusic className="w-5 h-5" />
          Playlist Details
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {/* Cover and title */}
        <div className="flex gap-4">
          <CoverImage
              src={coverArtUrl}
              alt={playlist.name || "Playlist cover"}
              colorSeed={playlist.name || "Playlist"}
              type="playlist"
              size="full"
              className="w-24 h-24 shrink-0"
            />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-lg truncate">{playlist.name}</h3>
            {playlist.comment && (
              <p className="text-sm text-muted-foreground line-clamp-2">{playlist.comment}</p>
            )}
          </div>
        </div>

        <Separator />

        {/* Details */}
        <div className="grid grid-cols-2 gap-x-4">
          <DetailRow icon={User} label="Owner" value={playlist.owner} />
          <DetailRow icon={Hash} label="Tracks" value={`${playlist.songCount} songs`} />
          <DetailRow icon={Clock} label="Duration" value={formatDuration(playlist.duration)} />
          <DetailRow icon={Calendar} label="Created" value={formatDate(playlist.created)} />
          {playlist.changed && (
            <DetailRow icon={Calendar} label="Modified" value={formatDate(playlist.changed)} />
          )}
        </div>
      </div>
    </>
  );
}
