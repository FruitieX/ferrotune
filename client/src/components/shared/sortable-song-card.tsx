"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { SongCard, type QueueSource } from "@/components/browse/song-row";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/api/types";

interface SortableSongCardProps {
  song: Song;
  index: number;
  /** Unique ID for sortable context - defaults to song.id but should be unique for playlists with duplicates */
  sortableId?: string;
  queueSource?: QueueSource;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, e: React.MouseEvent) => void;
  disabled?: boolean;
  isCurrentQueuePosition?: boolean;
  showMoveToPosition?: boolean;
  onMoveToPosition?: (song: Song, index: number) => void;
  showRefineMatch?: boolean;
  onRefineMatch?: (song: Song, index: number) => void;
  showUnmatch?: boolean;
  onUnmatch?: (song: Song, index: number) => void;
  /** When true, inline images were requested from the server */
  inlineImagesRequested?: boolean;
}

export function SortableSongCard({
  song,
  index,
  sortableId,
  queueSource,
  isSelected,
  isSelectionMode,
  onSelect,
  disabled = false,
  isCurrentQueuePosition,
  showMoveToPosition,
  onMoveToPosition,
  showRefineMatch,
  onRefineMatch,
  showUnmatch,
  onUnmatch,
}: SortableSongCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId ?? song.id, disabled });

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
        isDragging && "opacity-50 bg-accent/20 rounded-lg shadow-lg",
      )}
    >
      {/* Drag handle - positioned at top-right corner */}
      {!disabled && (
        <button
          type="button"
          aria-label="Drag to reorder"
          className={cn(
            "absolute top-2 right-2 p-1.5 rounded-md cursor-grab z-10",
            "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted",
            "opacity-0 group-hover/sortable:opacity-100 transition-opacity",
            isDragging && "cursor-grabbing opacity-100",
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}

      {/* Song card */}
      <div className={cn(isDragging && "pointer-events-none")}>
        <SongCard
          song={song}
          index={index}
          inlineImagesRequested
          queueSource={queueSource}
          isSelected={isSelected}
          isSelectionMode={isSelectionMode}
          onSelect={onSelect}
          isCurrentQueuePosition={isCurrentQueuePosition}
          showMoveToPosition={showMoveToPosition}
          onMoveToPosition={onMoveToPosition}
          showRefineMatch={showRefineMatch}
          onRefineMatch={onRefineMatch}
          showUnmatch={showUnmatch}
          onUnmatch={onUnmatch}
        />
      </div>
    </div>
  );
}
