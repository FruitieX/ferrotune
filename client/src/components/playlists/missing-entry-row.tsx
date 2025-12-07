"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Music, AlertCircle, Loader2, RefreshCw, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api/client";
import type { Song } from "@/lib/api/types";
import type { MissingEntryDataResponse } from "@/lib/api/generated/MissingEntryDataResponse";

interface MissingEntryRowProps {
  playlistId: string;
  position: number;
  missing: MissingEntryDataResponse;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onRemove?: (position: number) => void;
}

export function MissingEntryRow({
  playlistId,
  position,
  missing,
  isSelected,
  isSelectionMode,
  onSelect,
  onRemove,
}: MissingEntryRowProps) {
  const [refineDialogOpen, setRefineDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Quick search toggles
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeArtist, setIncludeArtist] = useState(true);
  const [includeAlbum, setIncludeAlbum] = useState(true);
  
  const queryClient = useQueryClient();
  
  // Mutation for matching the entry
  const matchMutation = useMutation({
    mutationFn: async (songId: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.matchMissingEntry(playlistId, position, songId);
    },
    onSuccess: () => {
      toast.success("Entry matched successfully");
      // Invalidate queries to refresh the playlist
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlistEntries", playlistId] });
      setRefineDialogOpen(false);
      setSearchQuery("");
      setSearchResults([]);
    },
    onError: (error) => {
      toast.error(`Failed to match entry: ${error instanceof Error ? error.message : "Unknown error"}`);
    },
  });

  // Build search query from selected fields in "artist - album - title" format
  const buildSearchQuery = (title: boolean, artist: boolean, album: boolean) => {
    const parts: string[] = [];
    // Build in order: artist, album, title (common search format)
    if (artist && missing.artist) parts.push(missing.artist);
    if (album && missing.album) parts.push(missing.album);
    if (title && missing.title) parts.push(missing.title);
    return parts.join(" - ").trim() || missing.raw;
  };

  // Update search query when toggles change
  const updateSearchFromToggles = (title: boolean, artist: boolean, album: boolean) => {
    setIncludeTitle(title);
    setIncludeArtist(artist);
    setIncludeAlbum(album);
    setSearchQuery(buildSearchQuery(title, artist, album));
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const client = getClient();
      if (!client) return;
      
      const response = await client.search3({ query: searchQuery.trim(), songCount: 20 });
      setSearchResults(response.searchResult3?.song ?? []);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Initialize search query when opening
  const openRefineDialog = () => {
    const hasTitle = !!missing.title;
    const hasArtist = !!missing.artist;
    const hasAlbum = !!missing.album;
    
    setIncludeTitle(hasTitle);
    setIncludeArtist(hasArtist);
    setIncludeAlbum(hasAlbum);
    setSearchQuery(buildSearchQuery(hasTitle, hasArtist, hasAlbum));
    setSearchResults([]);
    setRefineDialogOpen(true);
  };

  // Unique ID for this entry (used for selection)
  const entryId = `missing-${position}`;

  const handleRemoveClick = () => {
    setRemoveDialogOpen(true);
  };

  const handleConfirmRemove = () => {
    onRemove?.(position);
    setRemoveDialogOpen(false);
  };

  const rowContent = (
    <div
      className={cn(
        "group flex items-center gap-4 px-4 pr-6 py-2 rounded-md transition-colors cursor-pointer",
        "bg-orange-500/5 hover:bg-orange-500/10",
        "border-l-2 border-orange-500/50",
        isSelected && "ring-2 ring-primary bg-primary/20"
      )}
    >
      {/* Selection checkbox */}
      {isSelectionMode && (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect?.(entryId, checked === true)}
            className="h-4 w-4"
          />
        </div>
      )}

      {/* Position/Index */}
      <div className="shrink-0 w-6 sm:w-8 text-center text-sm text-muted-foreground tabular-nums">
        {position + 1}
      </div>

      {/* Placeholder cover */}
      <div className="shrink-0 w-10 h-10 rounded bg-muted flex items-center justify-center">
        <AlertCircle className="w-5 h-5 text-orange-500" />
      </div>

      {/* Entry info */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="font-medium truncate text-orange-500">
          {missing.title || "Unknown Track"}
        </div>
        <div className="text-sm text-muted-foreground truncate">
          {missing.artist || "Unknown Artist"}
          {missing.album && <> • {missing.album}</>}
        </div>
      </div>

      {/* Missing badge */}
      <div className="hidden sm:flex shrink-0 items-center gap-1 text-xs text-orange-500 bg-orange-500/20 px-2 py-1 rounded">
        <AlertCircle className="w-3 h-3" />
        Not Found
      </div>

      {/* Actions: Dropdown menu only */}
      <div className="flex items-center gap-1 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="w-4 h-4" />
              <span className="sr-only">More options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={openRefineDialog}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refine Match
            </DropdownMenuItem>
            {onRemove && (
              <DropdownMenuItem onClick={handleRemoveClick} className="text-destructive focus:text-destructive">
                <Trash2 className="w-4 h-4 mr-2" />
                Remove from Playlist
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-48" onDoubleClick={(e) => e.stopPropagation()}>
          <ContextMenuItem onClick={openRefineDialog}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refine Match
          </ContextMenuItem>
          {onRemove && (
            <ContextMenuItem onClick={handleRemoveClick} className="text-destructive focus:text-destructive">
              <Trash2 className="w-4 h-4 mr-2" />
              Remove from Playlist
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Refine Match Dialog */}
      <Dialog open={refineDialogOpen} onOpenChange={setRefineDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Find matching track</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Quick field toggles */}
            <div className="flex flex-wrap gap-3 pb-2 border-b">
              {missing.title && (
                <div className="flex items-center space-x-1.5">
                  <Checkbox
                    id={`title-${position}`}
                    checked={includeTitle}
                    onCheckedChange={(checked) => 
                      updateSearchFromToggles(checked === true, includeArtist, includeAlbum)
                    }
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`title-${position}`} className="text-xs cursor-pointer">
                    Title
                  </label>
                </div>
              )}
              {missing.artist && (
                <div className="flex items-center space-x-1.5">
                  <Checkbox
                    id={`artist-${position}`}
                    checked={includeArtist}
                    onCheckedChange={(checked) => 
                      updateSearchFromToggles(includeTitle, checked === true, includeAlbum)
                    }
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`artist-${position}`} className="text-xs cursor-pointer">
                    Artist
                  </label>
                </div>
              )}
              {missing.album && (
                <div className="flex items-center space-x-1.5">
                  <Checkbox
                    id={`album-${position}`}
                    checked={includeAlbum}
                    onCheckedChange={(checked) => 
                      updateSearchFromToggles(includeTitle, includeArtist, checked === true)
                    }
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`album-${position}`} className="text-xs cursor-pointer">
                    Album
                  </label>
                </div>
              )}
            </div>
            
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for track..."
                className="h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button 
                size="sm" 
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="h-8"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div 
                className="h-[200px] rounded border overflow-y-auto"
                onWheel={(e) => e.stopPropagation()}
              >
                <div className="p-1">
                  {searchResults.map((song) => (
                    <button
                      key={song.id}
                      className="w-full text-left p-2 rounded hover:bg-accent text-sm flex items-center gap-2"
                      onClick={() => matchMutation.mutate(song.id)}
                      disabled={matchMutation.isPending}
                    >
                      <Music className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{song.title}</div>
                        <div className="text-muted-foreground text-xs truncate">
                          {song.artist}{song.album ? ` • ${song.album}` : ""}
                        </div>
                      </div>
                      {matchMutation.isPending && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {searchResults.length === 0 && searchQuery && !isSearching && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Press Enter or click Search to find tracks
              </div>
            )}

            {/* Original raw text */}
            {missing.raw && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                <span className="font-medium">Original entry:</span>{" "}
                <span className="font-mono">{missing.raw}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove missing entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{missing.title || missing.raw || "Unknown Track"}&quot; from the playlist.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function MissingEntryRowSkeleton() {
  return (
    <div className="flex items-center gap-2 lg:gap-3 px-2 sm:px-3 py-1.5 sm:py-2 rounded-md bg-muted/30">
      <div className="shrink-0 w-6 sm:w-8 text-center">
        <div className="h-4 w-4 bg-muted rounded animate-pulse mx-auto" />
      </div>
      <div className="shrink-0 w-10 h-10 rounded bg-muted animate-pulse" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        <div className="h-3 w-48 bg-muted rounded animate-pulse" />
      </div>
    </div>
  );
}

/**
 * Card version of missing entry for grid views
 */
interface MissingEntryCardProps {
  playlistId: string;
  position: number;
  missing: MissingEntryDataResponse;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onRemove?: (position: number) => void;
}

export function MissingEntryCard({
  playlistId,
  position,
  missing,
  isSelected,
  isSelectionMode,
  onSelect,
  onRemove,
}: MissingEntryCardProps) {
  const [refineDialogOpen, setRefineDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeArtist, setIncludeArtist] = useState(true);
  const [includeAlbum, setIncludeAlbum] = useState(true);
  
  const queryClient = useQueryClient();
  
  // Mutation for matching the entry
  const matchMutation = useMutation({
    mutationFn: async (songId: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      await client.matchMissingEntry(playlistId, position, songId);
    },
    onSuccess: () => {
      toast.success("Entry matched successfully");
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
      queryClient.invalidateQueries({ queryKey: ["playlistEntries", playlistId] });
      setRefineDialogOpen(false);
      setSearchQuery("");
      setSearchResults([]);
    },
    onError: (error) => {
      toast.error(`Failed to match entry: ${error instanceof Error ? error.message : "Unknown error"}`);
    },
  });

  const buildSearchQuery = (title: boolean, artist: boolean, album: boolean) => {
    const parts: string[] = [];
    if (artist && missing.artist) parts.push(missing.artist);
    if (album && missing.album) parts.push(missing.album);
    if (title && missing.title) parts.push(missing.title);
    return parts.join(" - ").trim() || missing.raw;
  };

  const updateSearchFromToggles = (title: boolean, artist: boolean, album: boolean) => {
    setIncludeTitle(title);
    setIncludeArtist(artist);
    setIncludeAlbum(album);
    setSearchQuery(buildSearchQuery(title, artist, album));
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const client = getClient();
      if (!client) return;
      
      const response = await client.search3({ query: searchQuery.trim(), songCount: 20 });
      setSearchResults(response.searchResult3?.song ?? []);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const openRefineDialog = () => {
    const hasTitle = !!missing.title;
    const hasArtist = !!missing.artist;
    const hasAlbum = !!missing.album;
    
    setIncludeTitle(hasTitle);
    setIncludeArtist(hasArtist);
    setIncludeAlbum(hasAlbum);
    setSearchQuery(buildSearchQuery(hasTitle, hasArtist, hasAlbum));
    setSearchResults([]);
    setRefineDialogOpen(true);
  };

  const entryId = `missing-${position}`;

  const handleRemoveClick = () => {
    setRemoveDialogOpen(true);
  };

  const handleConfirmRemove = () => {
    onRemove?.(position);
    setRemoveDialogOpen(false);
  };

  const cardContent = (
    <article
      data-testid="missing-entry-card"
      className={cn(
        "group relative p-4 rounded-lg cursor-pointer",
        "bg-orange-500/5 hover:bg-orange-500/10 transition-all",
        "border border-orange-500/30 hover:border-orange-500/50",
        "hover:shadow-lg hover:shadow-orange-500/10",
        isSelected && "ring-2 ring-primary bg-primary/10"
      )}
      onClick={openRefineDialog}
    >
      {/* Cover art placeholder */}
      <div className="relative mb-4">
        {/* Selection checkbox */}
        {onSelect && (
          <div 
            className={cn(
              "absolute top-1 left-1 z-20 transition-opacity",
              isSelected || isSelectionMode
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            )}
          >
            <button
              type="button"
              className={cn(
                "w-6 h-6 rounded border-2 flex items-center justify-center transition-all",
                "bg-black/50 hover:bg-black/70",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-white/80 hover:border-primary/80"
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect(entryId, !isSelected);
              }}
            >
              {isSelected && <AlertCircle className="w-4 h-4" />}
            </button>
          </div>
        )}

        {/* Dropdown menu */}
        <div className="absolute top-1 right-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openRefineDialog(); }}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refine Match
              </DropdownMenuItem>
              {onRemove && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRemoveClick(); }} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remove from Playlist
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Placeholder cover */}
        <div 
          className={cn(
            "aspect-square rounded-md overflow-hidden",
            "bg-orange-500/20 flex items-center justify-center"
          )}
        >
          <AlertCircle className="w-12 h-12 text-orange-500" />
        </div>
      </div>

      {/* Text content */}
      <div className="space-y-1 min-w-0">
        <h3 className="font-medium text-sm truncate text-orange-500">
          {missing.title || "Unknown Track"}
        </h3>
        <p className="text-sm text-muted-foreground truncate">
          {missing.artist || "Unknown Artist"}
        </p>
        <div className="flex items-center gap-1 text-xs text-orange-500 bg-orange-500/20 px-2 py-0.5 rounded w-fit">
          <AlertCircle className="w-3 h-3" />
          Not Found
        </div>
      </div>
    </article>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{cardContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-48" onDoubleClick={(e) => e.stopPropagation()}>
          <ContextMenuItem onClick={openRefineDialog}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refine Match
          </ContextMenuItem>
          {onRemove && (
            <ContextMenuItem onClick={handleRemoveClick} className="text-destructive focus:text-destructive">
              <Trash2 className="w-4 h-4 mr-2" />
              Remove from Playlist
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Refine Match Dialog */}
      <Dialog open={refineDialogOpen} onOpenChange={setRefineDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Find matching track</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 pb-2 border-b">
              {missing.title && (
                <div className="flex items-center space-x-1.5">
                  <Checkbox
                    id={`card-title-${position}`}
                    checked={includeTitle}
                    onCheckedChange={(checked) => 
                      updateSearchFromToggles(checked === true, includeArtist, includeAlbum)
                    }
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`card-title-${position}`} className="text-xs cursor-pointer">
                    Title
                  </label>
                </div>
              )}
              {missing.artist && (
                <div className="flex items-center space-x-1.5">
                  <Checkbox
                    id={`card-artist-${position}`}
                    checked={includeArtist}
                    onCheckedChange={(checked) => 
                      updateSearchFromToggles(includeTitle, checked === true, includeAlbum)
                    }
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`card-artist-${position}`} className="text-xs cursor-pointer">
                    Artist
                  </label>
                </div>
              )}
              {missing.album && (
                <div className="flex items-center space-x-1.5">
                  <Checkbox
                    id={`card-album-${position}`}
                    checked={includeAlbum}
                    onCheckedChange={(checked) => 
                      updateSearchFromToggles(includeTitle, includeArtist, checked === true)
                    }
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`card-album-${position}`} className="text-xs cursor-pointer">
                    Album
                  </label>
                </div>
              )}
            </div>
            
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for track..."
                className="h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button 
                size="sm" 
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
                className="h-8"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div 
                className="h-[200px] rounded border overflow-y-auto"
                onWheel={(e) => e.stopPropagation()}
              >
                <div className="p-1">
                  {searchResults.map((song) => (
                    <button
                      key={song.id}
                      className="w-full text-left p-2 rounded hover:bg-accent text-sm flex items-center gap-2"
                      onClick={() => matchMutation.mutate(song.id)}
                      disabled={matchMutation.isPending}
                    >
                      <Music className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{song.title}</div>
                        <div className="text-muted-foreground text-xs truncate">
                          {song.artist}{song.album ? ` • ${song.album}` : ""}
                        </div>
                      </div>
                      {matchMutation.isPending && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {searchResults.length === 0 && searchQuery && !isSearching && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Press Enter or click Search to find tracks
              </div>
            )}

            {missing.raw && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                <span className="font-medium">Original entry:</span>{" "}
                <span className="font-mono">{missing.raw}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove missing entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{missing.title || missing.raw || "Unknown Track"}&quot; from the playlist.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function MissingEntryCardSkeleton() {
  return (
    <div className="p-4 rounded-lg bg-muted/30">
      <div className="aspect-square rounded-md bg-muted animate-pulse mb-4" />
      <div className="space-y-2">
        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        <div className="h-3 w-16 bg-muted rounded animate-pulse" />
      </div>
    </div>
  );
}
