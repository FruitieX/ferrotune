"use client";

import Link from "next/link";
import {
  Play,
  ListPlus,
  ListEnd,
  Shuffle,
  MoreHorizontal,
  Check,
} from "lucide-react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MediaRow,
  MediaRowSkeleton,
  RowDropdownTrigger,
  RowActions,
} from "@/components/shared/media-row";
import {
  startQueueAtom,
  addToQueueAtom,
  type QueueSourceType,
} from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import type { Genre, Song } from "@/lib/api/types";

// Helper to generate a consistent color from genre name
function getGenreColor(genreName: string): { hue: number; gradient: string } {
  const hash = genreName.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const hue = Math.abs(hash % 360);
  return {
    hue,
    gradient: `linear-gradient(135deg, hsl(${hue}, 70%, 35%) 0%, hsl(${(hue + 30) % 360}, 60%, 25%) 100%)`,
  };
}

// Helper to fetch songs by genre
async function fetchGenreSongs(
  genreName: string,
): Promise<{ songs: Song[]; error: boolean }> {
  const client = getClient();
  if (!client) return { songs: [], error: true };

  try {
    const response = await client.getSongsByGenre(genreName, { count: 500 });
    return { songs: response.songsByGenre.song ?? [], error: false };
  } catch (error) {
    console.error("Failed to fetch genre songs:", error);
    return { songs: [], error: true };
  }
}

interface GenreCardProps {
  genre: Genre;
  className?: string;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
}

/**
 * Genre card for grid view - colored gradient card with genre name
 */
export function GenreCard({
  genre,
  className,
  isSelected,
  isSelectionMode,
  onSelect,
}: GenreCardProps) {
  const { gradient } = getGenreColor(genre.value);

  const handleClick = (e: React.MouseEvent) => {
    if (onSelect && (e.ctrlKey || e.metaKey || e.shiftKey || isSelectionMode)) {
      e.preventDefault();
      onSelect(e);
    }
  };

  return (
    <GenreContextMenu genre={genre}>
      <div
        className={cn(
          "group relative h-24 rounded-lg overflow-hidden cursor-pointer media-card",
          "hover:ring-2 hover:ring-primary/50 transition-shadow",
          isSelected && "ring-2 ring-primary",
          className,
        )}
        style={{ background: gradient }}
        onClick={handleClick}
      >
        {/* Selection checkbox */}
        {onSelect && (
          <div
            className={cn(
              "absolute top-2 left-2 z-10 transition-opacity",
              isSelectionMode
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            <button
              type="button"
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-black/30 hover:bg-black/50 text-white",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(e);
              }}
            >
              {isSelected && <Check className="w-4 h-4" />}
            </button>
          </div>
        )}

        {/* Dropdown menu button */}
        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <GenreDropdownMenu
            genre={genre}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 bg-black/30 hover:bg-black/50 text-white"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <MoreHorizontal className="w-4 h-4" />
                <span className="sr-only">More options</span>
              </Button>
            }
          />
        </div>

        <Link
          href={`/library/genres/details?name=${encodeURIComponent(genre.value)}`}
          className="absolute inset-0 flex flex-col justify-end p-4"
          onClick={(e) => {
            if (isSelectionMode) {
              e.preventDefault();
            }
          }}
        >
          <h3 className="font-bold text-white truncate">{genre.value}</h3>
          <p className="text-xs text-white/80">
            {genre.albumCount} albums • {genre.songCount} songs
          </p>
        </Link>
      </div>
    </GenreContextMenu>
  );
}

export function GenreCardSkeleton() {
  return <Skeleton className="h-24 rounded-lg" />;
}

interface GenreRowProps {
  genre: Genre;
  className?: string;
  index?: number;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
}

/**
 * Genre row for list view - uses MediaRow with genre-colored cover placeholder
 */
export function GenreRow({
  genre,
  className,
  index,
  isSelected,
  isSelectionMode,
  onSelect,
}: GenreRowProps) {
  const startQueue = useSetAtom(startQueueAtom);

  const handlePlay = () => {
    startQueue({
      sourceType: "genre",
      sourceId: genre.value,
      sourceName: genre.value,
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${genre.value}"`);
  };

  return (
    <MediaRow
      // No coverArt URL - CoverImage will show genre placeholder with color from colorSeed
      title={genre.value}
      subtitle={`${genre.albumCount} albums • ${genre.songCount} songs`}
      href={`/library/genres/details?name=${encodeURIComponent(genre.value)}`}
      colorSeed={genre.value}
      coverType="genre"
      index={index}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onSelect={onSelect}
      onPlay={handlePlay}
      onDoubleClick={handlePlay}
      actions={
        <RowActions
          dropdownMenu={
            <GenreDropdownMenu genre={genre} trigger={<RowDropdownTrigger />} />
          }
        />
      }
      contextMenu={(children) => (
        <GenreContextMenu genre={genre}>{children}</GenreContextMenu>
      )}
      className={className}
    />
  );
}

export function GenreRowSkeleton() {
  return <MediaRowSkeleton showIndex />;
}

// Context menu for genres
interface GenreContextMenuProps {
  genre: Genre;
  children: React.ReactNode;
}

function GenreContextMenu({ genre, children }: GenreContextMenuProps) {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  const handlePlay = () => {
    startQueue({
      sourceType: "genre",
      sourceId: genre.value,
      sourceName: genre.value,
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${genre.value}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "genre",
      sourceId: genre.value,
      sourceName: genre.value,
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${genre.value}"`);
  };

  const handlePlayNext = async () => {
    const { songs, error } = await fetchGenreSongs(genre.value);
    if (error) {
      toast.error("Failed to load genre songs");
    } else if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "next" });
      toast.success(`Added "${genre.value}" songs to play next`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handleAddToQueue = async () => {
    const { songs, error } = await fetchGenreSongs(genre.value);
    if (error) {
      toast.error("Failed to load genre songs");
    } else if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "end" });
      toast.success(`Added "${genre.value}" songs to queue`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-56"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <ContextMenuItem onClick={handlePlay}>
          <Play className="w-4 h-4 mr-2" />
          Play
        </ContextMenuItem>
        <ContextMenuItem onClick={handleShuffle}>
          <Shuffle className="w-4 h-4 mr-2" />
          Shuffle
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handlePlayNext}>
          <ListPlus className="w-4 h-4 mr-2" />
          Play Next
        </ContextMenuItem>
        <ContextMenuItem onClick={handleAddToQueue}>
          <ListEnd className="w-4 h-4 mr-2" />
          Add to Queue
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Dropdown menu for genres
interface GenreDropdownMenuProps {
  genre: Genre;
  trigger?: React.ReactNode;
}

function GenreDropdownMenu({ genre, trigger }: GenreDropdownMenuProps) {
  const startQueue = useSetAtom(startQueueAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  const handlePlay = () => {
    startQueue({
      sourceType: "genre",
      sourceId: genre.value,
      sourceName: genre.value,
      startIndex: 0,
      shuffle: false,
    });
    toast.success(`Playing "${genre.value}"`);
  };

  const handleShuffle = () => {
    startQueue({
      sourceType: "genre",
      sourceId: genre.value,
      sourceName: genre.value,
      startIndex: 0,
      shuffle: true,
    });
    toast.success(`Shuffling "${genre.value}"`);
  };

  const handlePlayNext = async () => {
    const { songs, error } = await fetchGenreSongs(genre.value);
    if (error) {
      toast.error("Failed to load genre songs");
    } else if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "next" });
      toast.success(`Added "${genre.value}" songs to play next`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handleAddToQueue = async () => {
    const { songs, error } = await fetchGenreSongs(genre.value);
    if (error) {
      toast.error("Failed to load genre songs");
    } else if (songs.length > 0) {
      addToQueue({ songIds: songs.map((s) => s.id), position: "end" });
      toast.success(`Added "${genre.value}" songs to queue`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? <RowDropdownTrigger />}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onClick={handlePlay}>
          <Play className="w-4 h-4 mr-2" />
          Play
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShuffle}>
          <Shuffle className="w-4 h-4 mr-2" />
          Shuffle
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handlePlayNext}>
          <ListPlus className="w-4 h-4 mr-2" />
          Play Next
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleAddToQueue}>
          <ListEnd className="w-4 h-4 mr-2" />
          Add to Queue
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
