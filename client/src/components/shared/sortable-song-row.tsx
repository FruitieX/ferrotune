"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { SongRow } from "@/components/browse/song-row";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";

interface SortableSongRowProps {
  song: Song;
  index: number;
  showCover?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  showDuration?: boolean;
  showPlayCount?: boolean;
  showYear?: boolean;
  showDateAdded?: boolean;
  queueSongs?: Song[];
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

export function SortableSongRow({
  song,
  index,
  showCover,
  showArtist,
  showAlbum,
  showDuration,
  showPlayCount,
  showYear,
  showDateAdded,
  queueSongs,
  isSelected,
  isSelectionMode,
  onSelect,
  disabled = false,
}: SortableSongRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: song.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/sortable relative",
        isDragging && "opacity-50 bg-accent/20 rounded-lg shadow-lg"
      )}
    >
      <div className="flex items-center">
        {/* Drag handle - positioned absolutely to overlay the track number area */}
        {!disabled && (
          <div
            className={cn(
              "absolute -left-2 top-0 bottom-0 flex items-center justify-center w-10 cursor-grab z-10",
              "text-muted-foreground/50 hover:text-muted-foreground",
              "opacity-0 group-hover/sortable:opacity-100 transition-opacity",
              isDragging && "cursor-grabbing opacity-100"
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        
        {/* Song row */}
        <div className="flex-1">
          <SongRow
            song={song}
            index={index}
            showCover={showCover}
            showArtist={showArtist}
            showAlbum={showAlbum}
            showDuration={showDuration}
            showPlayCount={showPlayCount}
            showYear={showYear}
            showDateAdded={showDateAdded}
            queueSongs={queueSongs}
            isSelected={isSelected}
            isSelectionMode={isSelectionMode}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}
