"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Music, User, Disc, ListMusic, Calendar, Clock, Hash, FileAudio, HardDrive, Star, Heart } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { getClient } from "@/lib/api/client";
import { formatDuration, formatDate, formatFileSize } from "@/lib/utils/format";
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
}

export function DetailsDialog({ item, open, onOpenChange }: DetailsDialogProps) {
  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        {item.type === "song" && <SongDetails song={item.data} />}
        {item.type === "album" && <AlbumDetails album={item.data} />}
        {item.type === "artist" && <ArtistDetails artist={item.data} />}
        {item.type === "playlist" && <PlaylistDetails playlist={item.data} />}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium wrap-break-word">{value}</p>
      </div>
    </div>
  );
}

function SongDetails({ song }: { song: Song }) {
  const [coverError, setCoverError] = useState(false);
  const coverArtUrl = song.coverArt && !coverError
    ? getClient()?.getCoverArtUrl(song.coverArt, 200)
    : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Music className="w-5 h-5" />
          Track Details
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {/* Cover and title */}
        <div className="flex gap-4">
          <div className="relative w-24 h-24 rounded-md overflow-hidden bg-muted shrink-0">
            {coverArtUrl ? (
              <Image
                src={coverArtUrl}
                alt={song.title}
                fill
                className="object-cover"
                unoptimized
                onError={() => setCoverError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
                <Music className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-lg truncate">{song.title}</h3>
            <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
            <p className="text-sm text-muted-foreground truncate">{song.album}</p>
          </div>
        </div>

        <Separator />

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-4">
          <DetailRow icon={User} label="Artist" value={song.artist} />
          <DetailRow icon={Disc} label="Album" value={song.album} />
          <DetailRow icon={Hash} label="Track" value={song.track ? `${song.track}${song.discNumber ? ` (Disc ${song.discNumber})` : ""}` : undefined} />
          <DetailRow icon={Calendar} label="Year" value={song.year} />
          <DetailRow icon={Clock} label="Duration" value={formatDuration(song.duration)} />
          <DetailRow icon={Music} label="Genre" value={song.genre} />
          <DetailRow icon={FileAudio} label="Format" value={song.suffix?.toUpperCase()} />
          <DetailRow icon={FileAudio} label="Bitrate" value={song.bitRate ? `${song.bitRate} kbps` : undefined} />
          <DetailRow icon={HardDrive} label="Size" value={formatFileSize(song.size)} />
          <DetailRow icon={Calendar} label="Added" value={formatDate(song.created)} />
          {song.starred && (
            <DetailRow icon={Heart} label="Favorited" value={formatDate(song.starred)} />
          )}
          {song.userRating && (
            <DetailRow 
              icon={Star} 
              label="Rating" 
              value={
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: song.userRating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                  ))}
                </span>
              } 
            />
          )}
        </div>

        <Separator />

        <DetailRow icon={HardDrive} label="File Path" value={song.path} />
      </div>
    </>
  );
}

function AlbumDetails({ album }: { album: Album }) {
  const [coverError, setCoverError] = useState(false);
  const coverArtUrl = album.coverArt && !coverError
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
          <div className="relative w-24 h-24 rounded-md overflow-hidden bg-muted shrink-0">
            {coverArtUrl ? (
              <Image
                src={coverArtUrl}
                alt={album.name}
                fill
                className="object-cover"
                unoptimized
                onError={() => setCoverError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
                <Disc className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
          </div>
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
  const [coverError, setCoverError] = useState(false);
  const coverArtUrl = artist.coverArt && !coverError
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
          <div className="relative w-24 h-24 rounded-full overflow-hidden bg-muted shrink-0">
            {coverArtUrl ? (
              <Image
                src={coverArtUrl}
                alt={artist.name}
                fill
                className="object-cover"
                unoptimized
                onError={() => setCoverError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
                <User className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
          </div>
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
  const [coverError, setCoverError] = useState(false);
  const coverArtUrl = playlist.coverArt && !coverError
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
          <div className="relative w-24 h-24 rounded-md overflow-hidden bg-muted shrink-0">
            {coverArtUrl ? (
              <Image
                src={coverArtUrl}
                alt={playlist.name}
                fill
                className="object-cover"
                unoptimized
                onError={() => setCoverError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-muted to-muted-foreground/20">
                <ListMusic className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
          </div>
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
