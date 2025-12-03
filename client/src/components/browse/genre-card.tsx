"use client";

import Link from "next/link";
import { Tag, Play, ListPlus, ListEnd, Shuffle, MoreHorizontal } from "lucide-react";
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
import { rowContainerStyles, rowActionsContainerStyles, RowDropdownTrigger } from "@/components/shared/media-row";
import { playNowAtom, addToQueueAtom } from "@/lib/store/queue";
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
async function fetchGenreSongs(genreName: string): Promise<Song[]> {
  const client = getClient();
  if (!client) return [];
  
  try {
    const response = await client.getSongsByGenre(genreName, { count: 500 });
    return response.songsByGenre.song ?? [];
  } catch (error) {
    console.error("Failed to fetch genre songs:", error);
    return [];
  }
}

interface GenreCardProps {
  genre: Genre;
  className?: string;
}

/**
 * Genre card for grid view - colored gradient card with genre name
 */
export function GenreCard({ genre, className }: GenreCardProps) {
  const { gradient } = getGenreColor(genre.value);

  return (
    <GenreContextMenu genre={genre}>
      <div
        className={cn(
          "group relative h-24 rounded-lg overflow-hidden cursor-pointer",
          "hover:ring-2 hover:ring-primary/50 transition-shadow",
          className
        )}
        style={{ background: gradient }}
      >
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
}

/**
 * Genre row for list view - colored indicator with genre info
 */
export function GenreRow({ genre, className }: GenreRowProps) {
  const { hue } = getGenreColor(genre.value);
  const playNow = useSetAtom(playNowAtom);

  const handlePlay = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      playNow(songs);
      toast.success(`Playing "${genre.value}"`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  return (
    <GenreContextMenu genre={genre}>
      <div className={cn(rowContainerStyles, className)} onDoubleClick={handlePlay}>
        {/* Colored genre indicator with play overlay */}
        <div
          className="group/cover relative w-10 h-10 rounded-md shrink-0 flex items-center justify-center"
          style={{ backgroundColor: `hsl(${hue}, 60%, 40%)` }}
        >
          <Tag className="w-5 h-5 text-white group-hover/cover:opacity-0 transition-opacity" />
          {/* Play button overlay - matches MediaRow styling */}
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity rounded-md cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handlePlay();
            }}
          >
            <Play className="w-4 h-4 ml-0.5 text-white" />
          </button>
        </div>

        {/* Genre info - link only wraps the text content */}
        <div className="min-w-0 flex-1">
          <Link
            href={`/library/genres/details?name=${encodeURIComponent(genre.value)}`}
            className="font-medium text-sm truncate hover:underline block w-fit max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {genre.value}
          </Link>
          <p className="text-xs text-muted-foreground truncate">
            {genre.albumCount} albums • {genre.songCount} songs
          </p>
        </div>

        {/* Actions */}
        <div className={rowActionsContainerStyles}>
          <GenreDropdownMenu genre={genre} trigger={<RowDropdownTrigger />} />
        </div>
      </div>
    </GenreContextMenu>
  );
}

export function GenreRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 pr-6 py-2">
      <Skeleton className="w-10 h-10 rounded-md shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <Skeleton className="h-4 w-32 max-w-full" />
        <Skeleton className="h-3 w-24 max-w-[80%]" />
      </div>
    </div>
  );
}

// Context menu for genres
interface GenreContextMenuProps {
  genre: Genre;
  children: React.ReactNode;
}

function GenreContextMenu({ genre, children }: GenreContextMenuProps) {
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  const handlePlay = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      playNow(songs);
      toast.success(`Playing "${genre.value}"`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handleShuffle = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      toast.success(`Shuffling "${genre.value}"`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handlePlayNext = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      addToQueue(songs, "next");
      toast.success(`Added "${genre.value}" songs to play next`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      addToQueue(songs, "last");
      toast.success(`Added "${genre.value}" songs to queue`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56" onDoubleClick={(e) => e.stopPropagation()}>
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
  const playNow = useSetAtom(playNowAtom);
  const addToQueue = useSetAtom(addToQueueAtom);

  const handlePlay = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      playNow(songs);
      toast.success(`Playing "${genre.value}"`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handleShuffle = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      playNow(shuffled);
      toast.success(`Shuffling "${genre.value}"`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handlePlayNext = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      addToQueue(songs, "next");
      toast.success(`Added "${genre.value}" songs to play next`);
    } else {
      toast.error("No songs found in this genre");
    }
  };

  const handleAddToQueue = async () => {
    const songs = await fetchGenreSongs(genre.value);
    if (songs.length > 0) {
      addToQueue(songs, "last");
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
      <DropdownMenuContent align="end" className="w-56" onDoubleClick={(e) => e.stopPropagation()}>
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
