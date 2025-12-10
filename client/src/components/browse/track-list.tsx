"use client";

import { Music } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";
import { SongRow, SongRowSkeleton, type QueueSource } from "./song-row";

interface TrackListProps {
  songs: Song[];
  isLoading?: boolean;
  showCover?: boolean;
  showAlbum?: boolean;
  showArtist?: boolean;
  showHeader?: boolean;
  emptyMessage?: string;
  className?: string;
  // Queue source for playing the list
  queueSource?: QueueSource;
  // Selection props
  isSelected?: (id: string) => boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
}

/**
 * TrackList - A simple list of songs using the shared SongRow component.
 * Used in favorites, history, playlist details, and other song list views.
 */
export function TrackList({
  songs,
  isLoading = false,
  showCover = false,
  showAlbum = true,
  showArtist = true,
  showHeader: _showHeader = true,
  emptyMessage = "No tracks",
  className,
  queueSource,
  isSelected,
  isSelectionMode,
  onSelect,
}: TrackListProps) {
  if (isLoading) {
    return (
      <div className={cn("px-4 lg:px-6 py-4", className)}>
        <div className="space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <SongRowSkeleton key={i} showCover={showCover} showIndex />
          ))}
        </div>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Music className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "px-4 lg:px-6 py-4",
        isSelectionMode && "select-none",
        className,
      )}
    >
      <div className="space-y-1">
        {songs.map((song, index) => (
          <SongRow
            key={`${song.id}-${index}`}
            song={song}
            index={index}
            showCover={showCover}
            showAlbum={showAlbum}
            showArtist={showArtist}
            queueSongs={songs}
            queueSource={queueSource}
            isSelected={isSelected?.(song.id)}
            isSelectionMode={isSelectionMode}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// Re-export SongRowSkeleton for backwards compatibility
export { SongRowSkeleton as TrackRowSkeleton } from "./song-row";
